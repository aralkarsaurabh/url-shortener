import pg from 'pg';

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// Without this, Postgres dropping an idle connection (restart, outage) would crash the process.
pool.on('error', (err) => console.error('postgres pool error:', err.message));
