# Runs the same steps as the checker page's experiments, through its /api/probe route, and checks the
# numbers each panel expects. Needs the whole stack running (see documentation/frontend.md):
#   two shortener instances on 3100 and 3101 with ENABLE_DEBUG=true TRUST_PROXY=1, the rate limiter,
#   the load balancer with its servers, and the page on 3102 with
#   SHORTENER_URLS=http://localhost:3100,http://localhost:3101
#   python3 loadtest/panel-check.py
import json, random, string, time, urllib.request
BASE = "http://localhost:3102/api/probe"
def probe(**req):
    r = urllib.request.Request(BASE, data=json.dumps(req).encode(), headers={"content-type": "application/json"})
    return json.load(urllib.request.urlopen(r))["results"]
def one(**req): return probe(**req)[0]
def ip(): return f"10.{random.randrange(255)}.{random.randrange(255)}.{1+random.randrange(254)}"
def create(client, **body):
    r = one(service="shortener", method="POST", path="/shorten", headers={"x-forwarded-for": client}, body={"url": f"https://example.com/c-{time.time()}", **body})
    assert r["status"] == 201, r
    return json.loads(r["body"])["code"]
def visit(code, client, **kw): return probe(service="shortener", path=f"/{code}", headers={"x-forwarded-for": client}, **kw)
def counters(): return json.loads(one(service="shortener", path="/debug/counters")["body"])["counts"]
def reset(): one(service="shortener", method="POST", path="/debug/counters/reset")
def evict(code): one(service="shortener", method="POST", path=f"/debug/code/{code}/evict")
def inspect(code): return json.loads(one(service="shortener", path=f"/debug/code/{code}")["body"])
def show(name, ok, detail): print(("PASS" if ok else "FAIL"), name, "-", detail)

# Cache vs database
c = ip(); code = create(c); evict(code); reset()
res = visit(code, c, repeat=5); k = counters()
show("cache vs database", all(r["status"] == 302 for r in res) and k.get("cache.miss") == 1 and k.get("cache.hit") == 4 and k.get("db.reads") == 1, {x: k.get(x) for x in ("cache.miss", "cache.hit", "db.reads")})
i = inspect(code); show("cache holds the link", i["cache"]["kind"] == "url", f'ttl {i["cache"]["ttlMs"]} ms')

# Stampede
c = ip(); code = create(c); evict(code); reset()
res = visit(code, c, repeat=50, concurrency=50); k = counters()
show("stampede (lease)", all(r["status"] == 302 for r in res) and k.get("db.reads") == 1, {x: k.get(x) for x in ("db.reads", "cache.busy", "cache.hit", "cache.miss")})

# Clicks
c = ip(); code = create(c); reset(); N = 30
res = visit(code, c, repeat=N, concurrency=10); right = inspect(code)["clicks"]
saved = right["savedInDatabase"]; t = 0
while saved < N and t < 20: time.sleep(1); t += 1; saved = inspect(code)["clicks"]["savedInDatabase"]
k = counters()
show("click batching", saved == N and k.get("clicks.batches_saved", 99) < N, f"right after: {right}; saved {saved} after {t}s; queued {k.get('clicks.queued')}, batches {k.get('clicks.batches_saved')}")

# Rate limit (create)
c = ip(); res = probe(service="shortener", method="POST", path="/shorten", headers={"x-forwarded-for": c}, body={"url": "https://example.com/rl"}, repeat=13)
st = [r["status"] for r in res]; show("rate limit (create)", st.count(201) == 10 and st.count(429) == 3, f"{st.count(201)} allowed, {st.count(429)} blocked, limit header {res[0]['headers'].get('ratelimit-limit')}")
# Rate limit (lookup)
code = create(ip()); c = ip(); res = probe(service="shortener", path=f"/{code}", headers={"x-forwarded-for": c}, repeat=310, concurrency=20)
st = [r["status"] for r in res]; show("rate limit (lookup)", st.count(302) == 300 and st.count(429) == 10, f"{st.count(302)} allowed, {st.count(429)} blocked")

# Filter
c = ip(); real = create(c); reset()
fake = ["".join(random.choices(string.ascii_letters + string.digits, k=7)) for _ in range(30)]
answers = [visit(f, c)[0]["status"] for f in fake]; k = counters()
show("filter turns away unknown codes", set(answers) == {404} and k.get("filter.rejected", 0) >= 29 and k.get("db.reads", 0) == 0, {x: k.get(x) for x in ("filter.rejected", "db.reads", "cache.miss")})
i = inspect(fake[0]); show("nothing cached for a made-up code", i["filter"]["mightContain"] is False and i["cache"]["kind"] == "not_cached", i["cache"]["kind"])
reset(); r = visit(real, c)[0]; k = counters(); show("real code passes the filter", r["status"] == 302 and k.get("filter.passed") == 1, k)

# Expiry (5 s)
c = ip(); code = create(c, expiresInSeconds=5); seen = []; ttls = []
for s in range(9):
    seen.append(visit(code, c)[0]["status"]); ttls.append(inspect(code)["cache"]["ttlMs"]); time.sleep(1)
first = seen.index(410) if 410 in seen else -1
show("expiry", first > 0 and all(x == 302 for x in seen[:first]) and all(x == 410 for x in seen[first:]), f"statuses {seen}; cache ttl ms {ttls}")

# Health
for n in (0, 1):
    r = one(service="shortener", instance=n, path="/health"); b = json.loads(r["body"]); show(f"health instance {n}", r["status"] == 200 and b["status"] == "ok", b["instance"])

# Task 2
suffix = "".join(random.choices(string.ascii_lowercase, k=5)); a = f"alice-{suffix}"; b = f"bob-{suffix}"
five = probe(service="rate-limiter", path="/data", headers={"x-user-id": a}, repeat=5)
sixth = one(service="rate-limiter", path="/data", headers={"x-user-id": a}); other = one(service="rate-limiter", path="/data", headers={"x-user-id": b})
show("task 2", all(r["status"] == 200 for r in five) and sixth["status"] == 429 and sixth["body"] == "Too Many Requests: Try again later." and other["status"] == 200, f"{[r['status'] for r in five]} then {sixth['status']} {sixth['body']!r}, retry-after {sixth['headers'].get('retry-after')}, other user {other['status']}")

# Task 3
res = probe(service="balancer", path="/", repeat=9); bodies = [r["body"] for r in res]
servers = [int(x.split()[3].strip("!")) for x in bodies]
show("task 3", all(servers[i] == servers[i-1] % 3 + 1 for i in range(1, 9)) and sorted(set(servers)) == [1, 2, 3] and servers.count(1) == servers.count(2) == servers.count(3) == 3, servers)
