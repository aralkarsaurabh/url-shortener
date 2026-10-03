import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { AliasTakenError } from '../src/errors.js';

// A small in-memory service that behaves like the real one as far as the routes can tell.
function startApp() {
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
  const server = createApp({ service, baseUrl: 'http://short.test' }).listen(0);
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
