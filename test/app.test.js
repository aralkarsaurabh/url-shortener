import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { AliasTakenError } from '../src/errors.js';

// A small in-memory service that behaves like the real one as far as the routes can tell.
function startApp(options = {}) {
  const links = new Map(); // code -> { url, expiresAt, clicks }
  const service = {
    async createUrl({ url, alias, expiresInSeconds }) {
      const code = alias ?? String(links.size + 1);
      if (links.has(code)) throw new AliasTakenError();
      const expiresAt = expiresInSeconds ? new Date(Date.now() + expiresInSeconds * 1000) : null;
      links.set(code, { url, expiresAt, clicks: 0 });
      return { code, expiresAt };
    },
    async visit(code) {
      const link = links.get(code);
      if (!link) return { status: 'not_found' };
      if (link.expiresAt && link.expiresAt <= new Date()) return { status: 'gone' };
      link.clicks++;
      return { status: 'found', url: link.url };
    },
    async getStats(code) {
      const link = links.get(code);
      if (!link) return null;
      return { code, originalUrl: link.url, clickCount: link.clicks, expiresAt: link.expiresAt };
    },
  };
  const server = createApp({ service, baseUrl: 'http://short.test', ...options }).listen(0);
  return { server, links, base: `http://localhost:${server.address().port}` };
}

const post = (base, body) =>
  fetch(`${base}/shorten`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

async function expectError(res, status, code) {
  assert.equal(res.status, status);
  const body = await res.json();
  assert.equal(body.error.code, code);
  assert.equal(typeof body.error.message, 'string');
  return body.error;
}

test('shortens a url and redirects to it', async (t) => {
  const { server, base } = startApp();
  t.after(() => server.close());

  const res = await post(base, { url: 'https://example.com/a/long/path' });
  assert.equal(res.status, 201);
  const { code, shortUrl, expiresAt } = await res.json();
  assert.equal(shortUrl, `http://short.test/${code}`);
  assert.equal(expiresAt, null);

  const redirect = await fetch(`${base}/${code}`, { redirect: 'manual' });
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get('location'), 'https://example.com/a/long/path');
});

test('a custom alias becomes the code', async (t) => {
  const { server, base } = startApp();
  t.after(() => server.close());

  const res = await post(base, { url: 'https://example.com', alias: 'my-link_1' });
  assert.equal(res.status, 201);
  assert.equal((await res.json()).code, 'my-link_1');

  const redirect = await fetch(`${base}/my-link_1`, { redirect: 'manual' });
  assert.equal(redirect.status, 302);
});

test('a taken alias returns 409', async (t) => {
  const { server, base } = startApp();
  t.after(() => server.close());

  await post(base, { url: 'https://example.com', alias: 'taken' });
  await expectError(await post(base, { url: 'https://other.com', alias: 'taken' }), 409, 'ALIAS_TAKEN');
});

test('an invalid request returns 400 with the field that is wrong', async (t) => {
  const { server, base } = startApp();
  t.after(() => server.close());

  const error = await expectError(
    await post(base, { url: 'not a url', alias: 'x', expiresInSeconds: 0 }),
    400,
    'VALIDATION_ERROR',
  );
  assert.deepEqual(error.details.map((d) => d.field).sort(), ['alias', 'expiresInSeconds', 'url']);
});

test('a missing url returns 400', async (t) => {
  const { server, base } = startApp();
  t.after(() => server.close());
  await expectError(await post(base, {}), 400, 'VALIDATION_ERROR');
});

test('a body that is not valid JSON returns 400', async (t) => {
  const { server, base } = startApp();
  t.after(() => server.close());
  await expectError(await post(base, '{"url": '), 400, 'INVALID_JSON');
});

test('a body that is too large returns 413', async (t) => {
  const { server, base } = startApp();
  t.after(() => server.close());
  const big = { url: 'https://example.com', padding: 'x'.repeat(20000) };
  await expectError(await post(base, big), 413, 'PAYLOAD_TOO_LARGE');
});

test('an unknown code returns 404', async (t) => {
  const { server, base } = startApp();
  t.after(() => server.close());

  await expectError(await fetch(`${base}/zzzz`, { redirect: 'manual' }), 404, 'NOT_FOUND');
  await expectError(await fetch(`${base}/bad.code!`, { redirect: 'manual' }), 404, 'NOT_FOUND');
});

test('an unknown route returns a JSON 404', async (t) => {
  const { server, base } = startApp();
  t.after(() => server.close());
  await expectError(await fetch(`${base}/a/b/c`), 404, 'NOT_FOUND');
});

test('an expired link returns 410', async (t) => {
  const { server, links, base } = startApp();
  t.after(() => server.close());

  const { code } = await (await post(base, { url: 'https://example.com', expiresInSeconds: 60 })).json();
  links.get(code).expiresAt = new Date(Date.now() - 1000);

  await expectError(await fetch(`${base}/${code}`, { redirect: 'manual' }), 410, 'LINK_EXPIRED');
});

test('stats show the click count and expiry', async (t) => {
  const { server, base } = startApp();
  t.after(() => server.close());

  const { code } = await (await post(base, { url: 'https://example.com' })).json();
  await fetch(`${base}/${code}`, { redirect: 'manual' });
  await fetch(`${base}/${code}`, { redirect: 'manual' });

  const stats = await (await fetch(`${base}/stats/${code}`)).json();
  assert.equal(stats.clickCount, 2);
  assert.equal(stats.originalUrl, 'https://example.com');
  assert.equal(stats.expiresAt, null);
  await expectError(await fetch(`${base}/stats/nope`), 404, 'NOT_FOUND');
});

test('a blocked client gets 429 before the request is even read', async (t) => {
  const seen = { create: 0, lookup: 0 };
  const blocking = (name) => (req, res) => {
    seen[name]++;
    res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too Many Requests: Try again later.' } });
  };
  const { server, links, base } = startApp({
    limiters: { create: blocking('create'), lookup: blocking('lookup') },
  });
  t.after(() => server.close());

  // Even a body that is not valid JSON gets the 429, because the limiter runs first.
  await expectError(await post(base, '{"url": '), 429, 'RATE_LIMITED');
  await expectError(await fetch(`${base}/abc`, { redirect: 'manual' }), 429, 'RATE_LIMITED');
  await expectError(await fetch(`${base}/stats/abc`), 429, 'RATE_LIMITED');
  assert.deepEqual(seen, { create: 1, lookup: 2 });
  assert.equal(links.size, 0);
});

test('reserved words are never treated as codes', async (t) => {
  const { server, base } = startApp();
  t.after(() => server.close());
  for (const word of ['shorten', 'stats', 'api']) {
    await expectError(await fetch(`${base}/${word}`, { redirect: 'manual' }), 404, 'NOT_FOUND');
  }
});

test('trustProxy lets the client address come from the forwarded header', async (t) => {
  let seenIp = null;
  const spy = (req, res, next) => {
    seenIp = req.ip;
    next();
  };
  const { server, base } = startApp({ limiters: { lookup: spy }, trustProxy: 1 });
  t.after(() => server.close());

  await fetch(`${base}/abc`, { headers: { 'x-forwarded-for': '203.0.113.9' } });
  assert.equal(seenIp, '203.0.113.9');
});

test('/health reports ok, degraded and unavailable with the matching status', async (t) => {
  let checks = { postgres: 'ok', redis: 'ok' };
  const { server, base } = startApp({ instanceId: 'node-1', checkHealth: async () => checks });
  t.after(() => server.close());

  let res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'ok', instance: 'node-1', checks });

  checks = { postgres: 'ok', redis: 'down' }; // still serves, so it stays in rotation
  res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, 'degraded');

  checks = { postgres: 'down', redis: 'ok' };
  res = await fetch(`${base}/health`);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).status, 'unavailable');
});

test('/health says shutting_down with 503 while stopping, and is not rate limited', async (t) => {
  let limiterCalls = 0;
  const limiter = (req, res, next) => {
    limiterCalls++;
    next();
  };
  const { server, base } = startApp({
    limiters: { create: limiter, lookup: limiter },
    isShuttingDown: () => true,
  });
  t.after(() => server.close());

  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).status, 'shutting_down');
  assert.equal(limiterCalls, 0);
});

test('every response says which instance answered', async (t) => {
  const { server, base } = startApp({ instanceId: 'node-7' });
  t.after(() => server.close());

  assert.equal((await fetch(`${base}/health`)).headers.get('x-served-by'), 'node-7');
  assert.equal((await fetch(`${base}/nope`)).headers.get('x-served-by'), 'node-7');
});

test('the debug routes exist only when debug is switched on', async (t) => {
  const off = startApp();
  t.after(() => off.server.close());
  await expectError(await fetch(`${off.base}/debug/counters`), 404, 'NOT_FOUND');

  const calls = [];
  const debug = {
    inspectCode: async (code) => ({ code }),
    evictCode: async (code) => calls.push(`evict ${code}`),
    counters: () => ({ counts: { 'db.reads': 1 } }),
    resetCounters: () => calls.push('reset'),
  };
  const on = startApp({ debug });
  t.after(() => on.server.close());

  assert.deepEqual(await (await fetch(`${on.base}/debug/counters`)).json(), { counts: { 'db.reads': 1 } });
  assert.deepEqual(await (await fetch(`${on.base}/debug/code/abc`)).json(), { code: 'abc' });
  assert.equal((await fetch(`${on.base}/debug/code/abc/evict`, { method: 'POST' })).status, 200);
  assert.equal((await fetch(`${on.base}/debug/counters/reset`, { method: 'POST' })).status, 200);
  assert.deepEqual(calls, ['evict abc', 'reset']);
});
