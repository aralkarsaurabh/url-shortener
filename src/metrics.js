// Simple in-memory counters, so the test frontend can show what the service did (for example
// how many requests were answered from the cache and how many reached the database).
// They are per instance and start again from zero when it restarts.
export function createMetrics() {
  const counts = {};
  let startedAt = Date.now();
  return {
    inc(name, amount = 1) {
      counts[name] = (counts[name] ?? 0) + amount;
    },
    snapshot() {
      return { ...counts };
    },
    reset() {
      for (const name of Object.keys(counts)) delete counts[name];
      startedAt = Date.now();
    },
    sinceSeconds: () => Math.round((Date.now() - startedAt) / 1000),
  };
}

// Used when nothing needs the numbers.
export const noMetrics = { inc() {}, snapshot: () => ({}), reset() {}, sinceSeconds: () => 0 };
