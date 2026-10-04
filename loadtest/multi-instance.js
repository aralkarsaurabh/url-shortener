// Checks that several running instances behave as one service.
//
//   TRUST_PROXY=1 RATE_LIMIT_LOOKUP_PER_MINUTE=20 RATE_LIMIT_CREATE_PER_MINUTE=1000 \
//     docker compose --profile app up -d
//   node loadtest/multi-instance.js http://localhost:4000 http://localhost:4001 --lookup-limit 20
//
// TRUST_PROXY=1 lets each check pretend to be a different client (X-Forwarded-For), so the
// checks do not use up each other's rate limit.

const args = process.argv.slice(2);
const urls = args.filter((a) => a.startsWith('http'));
const limitFlag = args.indexOf('--lookup-limit');
const lookupLimit = limitFlag === -1 ? 20 : Number(args[limitFlag + 1]);
if (urls.length < 2) {
  console.error('Give at least two instance URLs.');
  process.exit(2);
}

let failures = 0;
function check(name, passed, detail = '') {
  if (!passed) failures++;
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (i) => urls[i % urls.length]; // instances in turn
let clientCounter = 0;
const newClient = () => `10.${Math.floor(clientCounter / 250)}.${clientCounter++ % 250}.1`;

async function create(base, body, client = newClient()) {
  return fetch(`${base}/shorten`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': client },
    body: JSON.stringify(body),
  });
}
const visit = (base, code, client = newClient()) =>
  fetch(`${base}/${code}`, { redirect: 'manual', headers: { 'x-forwarded-for': client } });

async function main() {
  // 1. Every instance is up and has its own name.
  const health = await Promise.all(urls.map((u) => fetch(`${u}/health`).then((r) => r.json())));
  const names = health.map((h) => h.instance);
  check('every instance is healthy', health.every((h) => h.status === 'ok'), health.map((h) => h.status).join(', '));
  check('instances have different names', new Set(names).size === urls.length, names.join(', '));

  // 2. A link made on one instance works at once on the others (shared filter, cache and database).
  const crossResults = [];
  for (let i = 0; i < 20; i++) {
    const made = await (await create(pick(i), { url: `https://example.com/cross-${Date.now()}-${i}` })).json();
    const res = await visit(pick(i + 1), made.code);
    crossResults.push(res.status);
  }
  check(
    'a link created on one instance redirects on the next one straight away',
    crossResults.every((s) => s === 302),
    `20 links, statuses: ${[...new Set(crossResults)].join(', ')}`,
  );

  // 3. The same alias requested on every instance at once: exactly one wins.
  const alias = `race-${Date.now().toString(36)}`;
  const raced = await Promise.all(
    Array.from({ length: 20 }, (_, i) => create(pick(i), { url: `https://example.com/race-${i}`, alias })),
  );
  const raceStatuses = raced.map((r) => r.status);
  check(
    'the same alias asked for on both instances at once: one wins',
    raceStatuses.filter((s) => s === 201).length === 1 && raceStatuses.filter((s) => s === 409).length === 19,
    `${raceStatuses.filter((s) => s === 201).length} created, ${raceStatuses.filter((s) => s === 409).length} refused`,
  );

  // 4. One client spread over both instances still has one shared limit.
  const limited = await (await create(pick(0), { url: 'https://example.com/limited' })).json();
  const client = newClient();
  const total = lookupLimit + 10;
  const statuses = [];
  for (let i = 0; i < total; i++) statuses.push((await visit(pick(i), limited.code, client)).status);
  const served = statuses.filter((s) => s === 302).length;
  const blocked = statuses.filter((s) => s === 429).length;
  check(
    `one client alternating between instances gets ${lookupLimit} requests in total, not ${lookupLimit} each`,
    served === lookupLimit && blocked === 10,
    `${served} served, ${blocked} blocked`,
  );

  // 5. Clicks counted on different instances add up, and nothing is counted twice.
  const clicked = await (await create(pick(0), { url: 'https://example.com/clicks' })).json();
  const perInstance = 100;
  await Promise.all(
    urls.flatMap((u) => Array.from({ length: perInstance }, () => visit(u, clicked.code))),
  );
  const expected = perInstance * urls.length;
  const count = async () => (await (await fetch(`${urls[0]}/stats/${clicked.code}`, { headers: { 'x-forwarded-for': newClient() } })).json()).clickCount;
  let seen = 0;
  for (let i = 0; i < 30 && seen !== expected; i++) {
    await sleep(1000);
    seen = await count();
  }
  check(`${expected} clicks over ${urls.length} instances are all counted`, seen === expected, `database says ${seen}`);
  await sleep(7000); // longer than a flush interval: a batch counted twice would show up now
  const later = await count();
  check('and nothing is counted twice afterwards', later === expected, `database says ${later}`);

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
