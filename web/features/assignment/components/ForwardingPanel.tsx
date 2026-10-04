"use client";

import { useState } from "react";
import { parseBody, probeOne } from "@/features/probe/api/probeClient";
import type { ProbeResult } from "@/features/probe/model/types";
import { Panel } from "@/shared/components/Panel";
import { StatusBadge } from "@/shared/components/StatusBadge";
import ui from "@/shared/components/ui.module.css";

type Echo = { server: string; method: string; path: string; query: Record<string, string>; body: string; headers: Record<string, string> };

const SENT_FORWARDED_FOR = "203.0.113.9";

export function ForwardingPanel() {
  const [echo, setEcho] = useState<{ echo: Echo; result: ProbeResult } | null>(null);
  const [other, setOther] = useState<{ title: string; result: ProbeResult } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  async function checkEcho() {
    setRunning(true);
    setProblem(null);
    const result = await probeOne({
      service: "balancer",
      method: "POST",
      path: "/echo?color=red",
      headers: { "x-request-id": "abc-123", "x-forwarded-for": SENT_FORWARDED_FOR, "content-type": "text/plain" },
      body: "some text",
    });
    const body = parseBody<Echo>(result);
    if (result.status === 0) setProblem("No answer from the balancer. Start everything: cd round-robin-load-balancer && npm run start:all");
    else if (!body?.headers) setProblem(`The balancer answered ${result.status}, but not with the echo of a mock server.`);
    else setEcho({ echo: body, result });
    setRunning(false);
  }

  async function tryRequest(title: string, request: Parameters<typeof probeOne>[0]) {
    setRunning(true);
    setOther({ title, result: await probeOne(request) });
    setRunning(false);
  }

  const rows: [string, string, string][] = echo
    ? [
        ["Method and path", "POST /echo?color=red", `${echo.echo.method} ${echo.echo.path}?color=${echo.echo.query.color}`],
        ["Body", "some text", echo.echo.body],
        ["X-Request-Id", "abc-123", echo.echo.headers["x-request-id"] ?? "(missing)"],
        ["X-Forwarded-For", SENT_FORWARDED_FOR, echo.echo.headers["x-forwarded-for"] ?? "(missing)"],
        ["X-Forwarded-Proto", "(not sent)", echo.echo.headers["x-forwarded-proto"] ?? "(missing)"],
        ["X-Forwarded-Host", "(not sent)", echo.echo.headers["x-forwarded-host"] ?? "(missing)"],
        ["Via", "(not sent)", echo.echo.headers["via"] ?? "(missing)"],
        ["Host", "the balancer's", echo.echo.headers["host"] ?? "(missing)"],
        ["Connection", "keep-alive (this one is for one connection only)", echo.echo.headers["connection"] ?? "(not passed on)"],
      ]
    : [];

  return (
    <Panel
      title="Forwarding"
      intro="The balancer passes the request on as the client sent it, and adds honest information about who really sent it. It passes the answer back as it comes, without holding the whole thing in memory. It gives up on a server that does not start answering in time, and refuses a body that is too large."
      lookFor="The backend receives the method, path, query, body and your own headers unchanged. X-Forwarded-For ends with the real client. Via names the balancer. Headers that only belong to one connection are not passed on."
    >
      <div className={ui.controls}>
        <button type="button" disabled={running} onClick={checkEcho}>Check what the backend receives</button>
        <button type="button" disabled={running} onClick={() => tryRequest("A redirect", { service: "balancer", path: "/redirect" })}>Redirect</button>
        <button type="button" disabled={running} onClick={() => tryRequest("A request that has to wait for a slow server", { service: "balancer", path: "/" })}>Slow server</button>
        <button type="button" disabled={running} onClick={() => tryRequest("A body of 2000 bytes", { service: "balancer", method: "POST", path: "/echo", headers: { "content-type": "text/plain" }, body: "x".repeat(2000) })}>Send 2000 bytes</button>
      </div>
      <p className={ui.note}>
        For the last two, start the balancer with TIMEOUT_MS=200 (and a mock server with DELAY_MS=600), or with MAX_BODY_BYTES=1000. With the default settings they simply succeed.
      </p>
      {problem && <p className={ui.error}>{problem}</p>}
      {echo && (
        <div className={ui.tableWrap}>
          <table className={ui.table}>
            <thead>
              <tr><th>What</th><th>The client sent</th><th>The backend (server {echo.echo.server}) received</th></tr>
            </thead>
            <tbody>
              {rows.map(([name, sent, received]) => (
                <tr key={name}>
                  <td>{name}</td>
                  <td className={ui.mono}>{sent}</td>
                  <td className={ui.mono}>{received}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {echo && <p className={ui.note}>The answer came back through {echo.result.headers["x-backend"]} with Via: {echo.result.headers["via"]}.</p>}
      {other && (
        <p>
          <strong>{other.title}:</strong> <StatusBadge status={other.result.status} />{" "}
          {other.result.headers["x-lb-error"] && <>the balancer says <code>{other.result.headers["x-lb-error"]}</code>. </>}
          {other.result.headers["location"] && <>Location: <code>{other.result.headers["location"]}</code> (not followed). </>}
          {other.result.headers["x-backend"] && <>Answered by {other.result.headers["x-backend"]}. </>}
          <span className={ui.note}>{other.result.ms} ms</span>
        </p>
      )}
    </Panel>
  );
}
