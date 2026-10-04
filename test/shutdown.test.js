import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { closeServer, createShutdown } from '../src/shutdown.js';

function setup(steps, timeoutMs = 1000) {
  const events = [];
  const exits = [];
  const shutdown = createShutdown({
    steps: steps.map(([name, fn]) => [name, async () => { events.push(`start ${name}`); await fn?.(); }]),
    timeoutMs,
    log: () => {},
    exit: (code) => exits.push(code),
  });
  return { shutdown, events, exits };
}

test('runs the steps in order, then exits 0', async () => {
  const { shutdown, events, exits } = setup([['a'], ['b'], ['c']]);
  await shutdown.run('SIGTERM');
  assert.deepEqual(events, ['start a', 'start b', 'start c']);
  assert.deepEqual(exits, [0]);
});

test('a failing step does not stop the others, and the exit code is 1', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { shutdown, events, exits } = setup([
    ['a'],
    ['b', () => { throw new Error('boom'); }],
    ['c'],
  ]);
  await shutdown.run('SIGTERM');
  assert.deepEqual(events, ['start a', 'start b', 'start c']);
  assert.deepEqual(exits, [1]);
});

test('a second signal does nothing, and the state is visible while stopping', async () => {
  let release;
  const { shutdown, events, exits } = setup([['slow', () => new Promise((r) => (release = r))]]);
  assert.equal(shutdown.isShuttingDown(), false);

  const first = shutdown.run('SIGTERM');
  assert.equal(shutdown.isShuttingDown(), true);
  await shutdown.run('SIGINT'); // ignored
  release();
  await first;

  assert.deepEqual(events, ['start slow']);
  assert.deepEqual(exits, [0]);
});

test('forces an exit if a step hangs', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { shutdown, exits } = setup([['stuck', () => new Promise(() => {})]], 50);
  shutdown.run('SIGTERM');
  await new Promise((r) => setTimeout(r, 150));
  assert.deepEqual(exits, [1]);
});

test('closeServer lets a request in progress finish, and refuses new ones', async () => {
  let releaseHandler;
  const server = http.createServer((req, res) => {
    releaseHandler = () => res.end('finished');
  });
  await new Promise((r) => server.listen(0, r));
  const { port } = server.address();

  const inFlight = fetch(`http://localhost:${port}/`).then((r) => r.text());
  await new Promise((r) => setTimeout(r, 50)); // the request has reached the handler

  let closed = false;
  const closing = closeServer(server).then(() => (closed = true));
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(closed, false); // still waiting for the request in progress

  await assert.rejects(fetch(`http://localhost:${port}/`)); // new connections are refused

  releaseHandler();
  assert.equal(await inFlight, 'finished');
  await closing;
  assert.equal(closed, true);
});

test('closeServer does not wait for idle keep-alive connections', async () => {
  const server = http.createServer((req, res) => res.end('hi'));
  await new Promise((r) => server.listen(0, r));
  const agent = new http.Agent({ keepAlive: true });
  await new Promise((resolve) =>
    http.get({ port: server.address().port, agent }, (res) => res.resume().on('end', resolve)),
  );

  const started = Date.now();
  await closeServer(server);
  assert.ok(Date.now() - started < 1000);
  agent.destroy();
});
