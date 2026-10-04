"use client";

import { useEffect, useRef, useState } from "react";
import { probe } from "@/features/probe/api/probeClient";
import type { ProbeResult } from "@/features/probe/model/types";
import { Panel } from "@/shared/components/Panel";
import { StatusBadge } from "@/shared/components/StatusBadge";
import ui from "@/shared/components/ui.module.css";

type Row = ProbeResult & { route: string; row: number };

export function HeadersAndRoutesPanel() {
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [user, setUser] = useState<string | null>(null);
  const [until, setUntil] = useState<number | null>(null); // when the last 429 says we can try again
  const [now, setNow] = useState(0);
  const counter = useRef(0);
  const userRef = useRef<string | null>(null);

  // A countdown after a 429, taken from the Retry-After header.
  useEffect(() => {
    if (until === null) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [until]);

  async function send(route: "/data" | "/heavy", repeat: number) {
    userRef.current ??= `tester-${Math.random().toString(36).slice(2, 8)}`;
    setUser(userRef.current);
    setRunning(true);
    const sent = await probe({ service: "rate-limiter", path: route, headers: { "x-user-id": userRef.current }, repeat });
    const added = sent.results.map((r) => ({ ...r, route, row: ++counter.current }));
    setRows((previous) => [...added.reverse(), ...previous].slice(0, 20));
    const blocked = sent.results.find((r) => r.status === 429);
    if (blocked && blocked.headers["retry-after"]) {
      setNow(Date.now());
      setUntil(Date.now() + Number(blocked.headers["retry-after"]) * 1000);
    }
    setRunning(false);
  }

  const secondsLeft = until === null ? 0 : Math.max(0, Math.ceil((until - now) / 1000));
  const noAnswer = rows.some((r) => r.status === 0);

  return (
    <Panel
      title="Headers and per-route limits"
      intro="Every answer from a limited route says what the limit is, how many requests are left and when to try again. /data allows 5 a minute and /heavy only 2, each with its own count. /health is never limited."
      lookFor="RateLimit-Remaining goes down by one on each call. After the limit the answer is 429 and Retry-After says how long to wait. Calling /heavy three times blocks /heavy but not /data."
    >
      <div className={ui.controls}>
        <button type="button" disabled={running} onClick={() => send("/data", 1)}>Call /data</button>
        <button type="button" disabled={running} onClick={() => send("/heavy", 1)}>Call /heavy</button>
        <button type="button" disabled={running} onClick={() => send("/heavy", 3)}>Send 3 to /heavy</button>
      </div>
      {user && <p className={ui.note}>Acting as user {user}. Each of the two limited routes counts this user separately.</p>}
      {noAnswer && <p className={ui.error}>No answer. Start the rate limiter: cd rate-limiter &amp;&amp; npm start</p>}
      {secondsLeft > 0 && <p className={ui.error}>Blocked. Try again in {secondsLeft} s.</p>}
      {rows.length > 0 && (
        <div className={ui.tableWrap}>
          <table className={ui.table}>
            <thead>
              <tr>
                <th>#</th>
                <th>Route</th>
                <th>Status</th>
                <th>RateLimit-Limit</th>
                <th>RateLimit-Remaining</th>
                <th>RateLimit-Reset</th>
                <th>Retry-After</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.row}>
                  <td>{r.row}</td>
                  <td className={ui.mono}>{r.route}</td>
                  <td><StatusBadge status={r.status} /></td>
                  <td className={ui.mono}>{r.headers["ratelimit-limit"] ?? "none"}</td>
                  <td className={ui.mono}>{r.headers["ratelimit-remaining"] ?? "none"}</td>
                  <td className={ui.mono}>{r.headers["ratelimit-reset"] ?? "none"}</td>
                  <td className={ui.mono}>{r.headers["retry-after"] ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
