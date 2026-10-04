type Numbered = { n: number; status: number };

// The few rows worth showing from a long burst: the first request, the first one that was blocked
// (429), and the last. When they overlap (for example only one request was blocked) each shows once.
export function sampleRows<T extends Numbered>(results: T[]): T[] {
  if (results.length === 0) return [];
  const firstBlocked = results.find((r) => r.status === 429);
  if (!firstBlocked) return results.slice(0, 5);
  const picked = [results[0], firstBlocked, results[results.length - 1]];
  return picked.filter((row, index) => picked.findIndex((other) => other.n === row.n) === index);
}
