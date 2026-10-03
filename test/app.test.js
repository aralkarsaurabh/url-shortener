import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

function startApp() {
  const store = new Map();
  const clicks = new Map();
  const service = {
    async createUrl(url) {
      const code = String(store.size + 1);
      store.set(code, url);
      return code;
    },
    async visit(code) {
      if (!store.has(code)) return null;
      clicks.set(code, (clicks.get(code) ?? 0) + 1);
      return store.get(code);
    },
    async getStats(code) {
      if (!store.has(code)) return null;
      return { code, originalUrl: store.get(code), clickCount: clicks.get(code) ?? 0 };
    },
  };
  const server = createApp({ service, baseUrl: 'http://short.test' }).listen(0);
  return { server, base: `http://localhost:${server.address().port}` };
}

const post = (base, body) =>
  fetch(`${base}/shorten`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

test('shortens a url and redirects to it', async (t) => {
  const { server, base } = startApp();
  t.after(() => server.close());

  const res = await post(base, { url: 'https://example.com/a/long/path' });
  assert.equal(res.status, 201);
  const { code, shortUrl } = await res.json();
  assert.equal(shortUrl, `http://short.test/${code}`);

  const redirect = await fetch(`${base}/${code}`, { redirect: 'manual' });
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get('location'), 'https://example.com/a/long/path');
});

test('rejects a missing or invalid url', async (t) => {
  const { server, base } = startApp();
  t.after(() => server.close());

  assert.equal((await post(base, {})).status, 400);
  assert.equal((await post(base, { url: 'not a url' })).status, 400);
  assert.equal((await post(base, { url: 'javascript:alert(1)' })).status, 400);
});

test('returns 404 for an unknown code', async (t) => {
  const { server, base } = startApp();
  t.after(() => server.close());

  const res = await fetch(`${base}/zzzz`, { redirect: 'manual' });
  assert.equal(res.status, 404);
});

test('stats show the click count', async (t) => {
  const { server, base } = startApp();
  t.after(() => server.close());

  const { code } = await (await post(base, { url: 'https://example.com' })).json();
  await fetch(`${base}/${code}`, { redirect: 'manual' });
  await fetch(`${base}/${code}`, { redirect: 'manual' });

  const stats = await (await fetch(`${base}/stats/${code}`)).json();
  assert.equal(stats.clickCount, 2);
  assert.equal(stats.originalUrl, 'https://example.com');
  assert.equal((await fetch(`${base}/stats/nope`)).status, 404);
});
