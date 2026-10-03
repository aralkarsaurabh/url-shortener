CREATE TABLE IF NOT EXISTS urls (
  id           BIGSERIAL PRIMARY KEY,
  code         TEXT NOT NULL UNIQUE,
  original_url TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Phase 2: click counting. Safe to run again, so it can also be applied to an existing database.
ALTER TABLE urls ADD COLUMN IF NOT EXISTS click_count BIGINT NOT NULL DEFAULT 0;

-- Phase 3: remembers which click batches were already added, so a retried batch is never counted twice.
CREATE TABLE IF NOT EXISTS click_batches (
  batch_id   TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
