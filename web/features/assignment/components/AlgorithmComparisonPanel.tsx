"use client";

import { useState } from "react";
import { parseBody, probeOne } from "@/features/probe/api/probeClient";
import { Panel } from "@/shared/components/Panel";
import ui from "@/shared/components/ui.module.css";
import styles from "./AlgorithmComparisonPanel.module.css";

type SimulationResult = {
  algorithm: "sliding-log" | "fixed-window" | "token-bucket";
  allowed: boolean[];
  allowedCount: number;
  blockedCount: number;
  maxAllowedInAnyWindow: number;
};
type Simulation = { limit: number; windowMs: number; results: SimulationResult[] };

const NAMES: Record<SimulationResult["algorithm"], string> = {
  "sliding-log": "Sliding window log",
  "fixed-window": "Fixed window counter",
  "token-bucket": "Token bucket",
};
const MEANING: Record<SimulationResult["algorithm"], string> = {
  "sliding-log": "Exact: never more than the limit in any window.",
  "fixed-window": "Cheapest, but a burst across a window edge gets through.",
  "token-bucket": "A burst of the limit, then about one request every window / limit.",
};

// The traffic each preset sends, as request times in milliseconds.
function presetTimes(preset: string, limit: number, windowMs: number): number[] {
  const repeat = (count: number, time: number) => Array<number>(count).fill(time);
  if (preset === "boundary") return [...repeat(limit, windowMs - 1000), ...repeat(limit, windowMs + 1000)];
  if (preset === "steady") {
    const gap = Math.ceil(windowMs / limit) + 1; // a little slower than the limit
    return Array.from({ length: limit * 2 }, (_, i) => i * gap);
  }
  const gap = Math.round(windowMs / limit); // burst, then a pause
  return [...repeat(limit + 1, 0), gap, gap, gap * 2];
}

const PRESETS = [
  { id: "boundary", label: "Boundary burst", says: "The limit is sent just before a minute is up and again just after. Fixed window sees two different windows and allows all of them." },
  { id: "steady", label: "Steady, under the limit", says: "Traffic a little slower than the limit. Every method should allow every request." },
  { id: "pause", label: "Burst, then a pause", says: "A burst of one more than the limit, then single requests after a pause. The token bucket gives a request back every window / limit." },
];

export function AlgorithmComparisonPanel() {
  const [preset, setPreset] = useState("boundary");
  const [limit, setLimit] = useState(5);
  const [windowSeconds, setWindowSeconds] = useState(60);
  const [simulation, setSimulation] = useState<Simulation | null>(null);
  const [times, setTimes] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    setError(null);
    const windowMs = windowSeconds * 1000;
    const requestTimesMs = presetTimes(preset, limit, windowMs);
    const result = await probeOne({ service: "rate-limiter", method: "POST", path: "/simulate", body: { limit, windowMs, requestTimesMs } });
    const body = parseBody<Simulation & { error?: { message: string } }>(result);
    if (result.status === 0) setError("No answer. Start the rate limiter: cd rate-limiter && npm start");
    else if (result.status !== 200 || !body?.results) setError(body?.error?.message ?? `The service answered ${result.status}`);
    else {
      setSimulation(body);
      setTimes(requestTimesMs);
    }
    setRunning(false);
  }

  const chosen = PRESETS.find((p) => p.id === preset);
  return (
    <Panel
      title="Algorithm comparison"
      intro="The same stream of requests goes through three rate limiting methods. Green is allowed, red is blocked. The service keeps no state for this: it runs each method on a fake clock."
      lookFor="In the boundary burst, the fixed window allows 10 (twice the limit) while the sliding log allows 5. The token bucket also allows 5, but gives a request back every 12 seconds."
    >
      <div className={ui.controls}>
        <label>
          Traffic
          <select value={preset} onChange={(e) => setPreset(e.target.value)}>
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </label>
        <label>
          Limit
          <input type="number" min={1} max={50} value={limit} onChange={(e) => setLimit(Math.min(50, Math.max(1, Number(e.target.value) || 1)))} />
        </label>
        <label>
          Window (seconds)
          <input type="number" min={1} max={600} value={windowSeconds} onChange={(e) => setWindowSeconds(Math.min(600, Math.max(1, Number(e.target.value) || 1)))} />
        </label>
        <button type="button" disabled={running} onClick={run}>Run</button>
      </div>
      {chosen && <p className={ui.note}>{chosen.says}</p>}
      {error && <p className={ui.error}>{error}</p>}
      {simulation && (
        <div className={styles.rows}>
          {simulation.results.map((r) => (
            <div key={r.algorithm} className={styles.row}>
              <div className={styles.name}>{NAMES[r.algorithm]}</div>
              <div className={styles.strip}>
                {r.allowed.map((allowed, i) => (
                  <span key={i} className={`${styles.tick} ${allowed ? styles.yes : styles.no}`} title={`t = ${(times[i] / 1000).toFixed(1)} s: ${allowed ? "allowed" : "blocked"}`} />
                ))}
              </div>
              <div className={ui.note}>
                allowed {r.allowedCount} of {r.allowed.length}. Most allowed in any {simulation.windowMs / 1000} s window: <strong>{r.maxAllowedInAnyWindow}</strong>. {MEANING[r.algorithm]}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
