// Runs the real code of each phase (from git) against the same database and measures it.
//
//   docker compose up -d                    # Postgres and Redis
//   node loadtest/compare.js [--duration 10] [--connections 50] [--work-dir /some/folder] [--only hot,clients]
//
// Scenarios:
//   hot      GET on 10 existing links, round and round
//   unknown  GET on random codes that were never created
//   clients  like "hot", but every request comes from a different client (X-Forwarded-For) and
//            stays under the default rate limit, so the limiter runs on every request but never blocks
//   limited  like "hot", but one client, with the default rate limit switched on
// For each run it prints requests per second, latency, how the answers split by status code,
// and how much work the database did (transactions and row updates per 1000 requests).

import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, symlinkSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import autocannon from 'autocannon';
import Redis from 'ioredis';
import pg from 'pg';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
const duration = Number(arg('duration', 10));
const connections = Number(arg('connections', 50));
const workDir = arg('work-dir', os.tmpdir());

const repoRoot = path.resolve(import.meta.dirname, '../..');
const PORT = 3100;
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5440/url_shortener';
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6380';
const HOT = Array.from({ length: 10 }, (_, i) => `hot000${i}`);

const VERSIONS = {
  p1: { label: 'Phase 1: database only', ref: '90f577d' },
  p2: { label: 'Phase 2: + Redis cache (click UPDATE per click)', ref: '90d11e1' },
  p3: { label: 'Phase 3: + batched clicks', ref: '7de89cc' },
  p4: { label: 'Phase 4: + validation, random codes', ref: 'efed735' },
  now: { label: 'Now: + code filter and rate limiter', ref: null },
};
const NO_LIMITS = { RATE_LIMIT_CREATE_PER_MINUTE: '100000000', RATE_LIMIT_LOOKUP_PER_MINUTE: '100000000' };

const SCENARIOS = [
  { name: 'hot', title: 'Hot links: 10 existing links, requested over and over', runs: [['p1'], ['p2'], ['p3'], ['p4'], ['now', NO_LIMITS]] },
  { name: 'unknown', title: 'Unknown codes: random 7-character codes that were never created', runs: [['p4'], ['now', NO_LIMITS]] },
  { name: 'clients', title: 'Hot links from many different clients, each under the default rate limit', runs: [['p4', { TRUST_PROXY: '1' }], ['now', { TRUST_PROXY: '1' }]] },
  { name: 'limited', title: 'Hot links again, but with the default rate limit (300 lookups a minute)', runs: [['now', {}]] },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pool = new pg.Pool({ connectionString: DATABASE_URL });
const redis = new Redis(REDIS_URL);

function randomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 7 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// Old phases are checked out into their own folders. Their dependencies are the ones in the repo.
const checkouts = [];
function folderFor(version) {
  if (!version.ref) return repoRoot;
  if (!version.dir) {
    version.dir = path.join(mkdtempSync(path.join(workDir, 'loadtest-')), 'code');
    execFileSync('git', ['-C', repoRoot, 'worktree', 'add', '--detach', version.dir, version.ref], { stdio: 'ignore' });
    symlinkSync(path.join(repoRoot, 'node_modules'), path.join(version.dir, 'node_modules'));
    checkouts.push(version.dir);
  }
  return version.dir;
}

async function startServer(dir, extraEnv) {
  const child = spawn('node', ['url-shortener/src/server.js'], {
    cwd: dir,
    env: { ...process.env, PORT: String(PORT), BASE_URL: `http://localhost:${PORT}`, DATABASE_URL, REDIS_URL, ...extraEnv },
    stdio: 'ignore',
  });
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://localhost:${PORT}/${HOT[0]}`, { redirect: 'manual' });
      if (res.status === 302) return child;
    } catch {
      // not listening yet
    }
    await sleep(250);
  }
  child.kill();
  throw new Error('server did not start');
}

async function stopServer(child) {
  const exited = new Promise((r) => child.once('exit', r));
  child.kill('SIGTERM');
  await Promise.race([exited, sleep(5000)]);
  child.kill('SIGKILL');
}

const dbCounters = async () => {
  const { rows } = await pool.query(`
    SELECT (SELECT xact_commit + xact_rollback FROM pg_stat_database WHERE datname = current_database()) AS tx,
           (SELECT n_tup_upd FROM pg_stat_user_tables WHERE relname = 'urls') AS upd`);
  return { tx: Number(rows[0].tx), upd: Number(rows[0].upd) };
};

async function runOne(scenario, versionKey, extraEnv = {}) {
  const version = VERSIONS[versionKey];
  await redis.flushall(); // every run starts with a cold cache
  const server = await startServer(folderFor(version), extraEnv);
  try {
    await sleep(3000); // let database statistics settle before the baseline
    const before = await dbCounters();

    let n = 0;
    const randomIp = () => `${1 + Math.floor(Math.random() * 223)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${1 + Math.floor(Math.random() * 254)}`;
    const requests =
      scenario.name === 'unknown'
        ? [{ method: 'GET', setupRequest: (req) => ({ ...req, path: `/${randomCode()}` }) }]
        : scenario.name === 'clients'
          ? [{ method: 'GET', setupRequest: (req) => ({ ...req, path: `/${HOT[n++ % HOT.length]}`, headers: { 'x-forwarded-for': randomIp() } }) }]
          : HOT.map((code) => ({ method: 'GET', path: `/${code}` }));
    const result = await autocannon({ url: `http://localhost:${PORT}`, connections, duration, requests });

    await sleep(7000); // longer than the click flush interval, so batched clicks have been saved
    const after = await dbCounters();

    const statuses = Object.fromEntries(Object.entries(result.statusCodeStats).map(([code, s]) => [code, s.count]));
    const total = Object.values(statuses).reduce((a, b) => a + b, 0);
    return {
      scenario: scenario.name,
      label: version.label,
      rps: Math.round(result.requests.average),
      p50: result.latency.p50,
      p99: result.latency.p99,
      total,
      statuses,
      errors: result.errors + result.timeouts,
      txPer1000: total ? ((after.tx - before.tx) / total) * 1000 : 0,
      updPer1000: total ? ((after.upd - before.upd) / total) * 1000 : 0,
    };
  } finally {
    await stopServer(server);
  }
}

async function main() {
  // lsof exits with an error when nothing is listening, which is what we want.
  let listening = '';
  try {
    listening = execFileSync('lsof', ['-nP', `-iTCP:${PORT}`, '-sTCP:LISTEN'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    listening = '';
  }
  if (listening.trim()) throw new Error(`port ${PORT} is busy`);

  await pool.query(
    `INSERT INTO urls (code, original_url)
     SELECT 'hot000' || g, 'https://example.com/hot/' || g FROM generate_series(0, 9) g
     ON CONFLICT (code) DO NOTHING`,
  );

  const only = arg('only', null)?.split(',');
  const results = [];
  for (const scenario of SCENARIOS) {
    if (only && !only.includes(scenario.name)) continue;
    console.log(`\n== ${scenario.title}  (${duration} s, ${connections} connections)`);
    for (const [versionKey, env] of scenario.runs) {
      const r = await runOne(scenario, versionKey, env);
      results.push(r);
      const split = Object.entries(r.statuses).map(([c, n]) => `${c}: ${n}`).join(', ');
      console.log(
        `${r.label.padEnd(52)} ${String(r.rps).padStart(6)} req/s  p50 ${String(r.p50).padStart(4)} ms  p99 ${String(r.p99).padStart(4)} ms  ` +
          `db tx/1000 req ${r.txPer1000.toFixed(1).padStart(7)}  row updates/1000 req ${r.updPer1000.toFixed(1).padStart(7)}  [${split}]${r.errors ? ` errors: ${r.errors}` : ''}`,
      );
    }
  }
  const out = arg('out', null);
  if (out) (await import('node:fs')).writeFileSync(out, JSON.stringify({ duration, connections, results }, null, 2));
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    for (const dir of checkouts) {
      try {
        execFileSync('git', ['-C', repoRoot, 'worktree', 'remove', '--force', dir], { stdio: 'ignore' });
        rmSync(path.dirname(dir), { recursive: true, force: true });
      } catch {
        // already gone
      }
    }
    await pool.end();
    redis.disconnect();
  });
