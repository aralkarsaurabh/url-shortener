import test from "node:test";
import assert from "node:assert/strict";
import { validateProbe } from "./validateProbe.ts";

const config = {
  shortener: ["http://localhost:3000", "http://localhost:3001"],
  "rate-limiter": ["http://localhost:3200"],
  balancer: ["http://localhost:3300"],
};

const ok = (input: unknown) => validateProbe(input, config);

test("a simple request gets sensible defaults", () => {
  const result = ok({ service: "balancer", path: "/" });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value, {
      baseUrl: "http://localhost:3300",
      method: "GET",
      path: "/",
      headers: {},
      body: undefined,
      repeat: 1,
      concurrency: 1,
      delayMs: 0,
    });
  }
});

test("picks the instance, lowercases header names, and turns a POST body into JSON", () => {
  const result = ok({
    service: "shortener",
    instance: 1,
    method: "POST",
    path: "/shorten",
    headers: { "X-Forwarded-For": "10.1.2.3" },
    body: { url: "https://example.com" },
    repeat: 3,
    concurrency: 2,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.baseUrl, "http://localhost:3001");
    assert.deepEqual(result.value.headers, { "x-forwarded-for": "10.1.2.3" });
    assert.equal(result.value.body, '{"url":"https://example.com"}');
  }
});

test("rejects a service that is not configured", () => {
  for (const service of ["other", "constructor", "__proto__", undefined, 5]) {
    assert.equal(ok({ service, path: "/" }).ok, false, `should reject ${String(service)}`);
  }
});

test("rejects an instance that does not exist", () => {
  assert.equal(ok({ service: "shortener", instance: 2, path: "/" }).ok, false);
  assert.equal(ok({ service: "balancer", instance: 1, path: "/" }).ok, false);
  assert.equal(ok({ service: "shortener", instance: -1, path: "/" }).ok, false);
  assert.equal(ok({ service: "shortener", instance: 0.5, path: "/" }).ok, false);
});

test("rejects paths that could leave the server", () => {
  for (const path of ["//evil.com/x", "http://evil.com/", "evil", "/a/../b", "", "/a b", "/a\nb", "\\evil", 5, undefined]) {
    assert.equal(ok({ service: "balancer", path }).ok, false, `should reject ${JSON.stringify(path)}`);
  }
});

test("accepts normal paths with a query string", () => {
  for (const path of ["/", "/abc123", "/data?user_id=alice", "/debug/code/my-alias_1", "/echo?a=1&b=two"]) {
    assert.equal(ok({ service: "balancer", path }).ok, true, `should accept ${path}`);
  }
});

test("rejects methods and headers that are not on the list", () => {
  assert.equal(ok({ service: "balancer", path: "/", method: "DELETE" }).ok, false);
  assert.equal(ok({ service: "balancer", path: "/", headers: { authorization: "x" } }).ok, false);
  assert.equal(ok({ service: "balancer", path: "/", headers: { "x-user-id": "a\r\nb: c" } }).ok, false);
  assert.equal(ok({ service: "balancer", path: "/", headers: { "x-user-id": 5 } }).ok, false);
});

test("rejects counts that are out of range", () => {
  assert.equal(ok({ service: "balancer", path: "/", repeat: 0 }).ok, false);
  assert.equal(ok({ service: "balancer", path: "/", repeat: 401 }).ok, false);
  assert.equal(ok({ service: "balancer", path: "/", concurrency: 51 }).ok, false);
  assert.equal(ok({ service: "balancer", path: "/", delayMs: 2001 }).ok, false);
  assert.equal(ok({ service: "balancer", path: "/", repeat: "5" }).ok, false);
});

test("rejects input that is not an object", () => {
  for (const input of [null, "x", 5, [], undefined]) assert.equal(ok(input).ok, false);
});

test("a body that is too large is rejected", () => {
  assert.equal(ok({ service: "shortener", method: "POST", path: "/shorten", body: "x".repeat(10_001) }).ok, false);
});
