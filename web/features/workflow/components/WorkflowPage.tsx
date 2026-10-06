"use client";

import { useEffect, useState } from "react";
import { runShorten, runVisit } from "../api/runFlows";
import { useCanvasView } from "../hooks/useCanvasView";
import { useExports } from "../hooks/useExports";
import { useFlowRun } from "../hooks/useFlowRun";
import { buildLayout } from "../lib/layout";
import { bodyOf, buildShortenFlow } from "../lib/shortenFlow";
import { buildVisitFlow, codeFromInput, isPossibleCode } from "../lib/visitFlow";
import type { FlowSpec } from "../model/types";
import { DetailDialog } from "./DetailDialog";
import { Edge } from "./Edge";
import { InputDialog } from "./InputDialog";
import { ResponseDialog } from "./ResponseDialog";
import { WorkflowNode } from "./WorkflowNode";
import styles from "./WorkflowPage.module.css";

const INITIAL_VIEW = { x: 280, y: 260, scale: 1 };
const DOT_SPACING = 24;

type Tab = "shorten" | "visit";

function isValidUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function WorkflowPage() {
  const [tab, setTab] = useState<Tab>("shorten");
  const [exploded, setExploded] = useState(false);
  const [inputOpen, setInputOpen] = useState(false);
  const [responseOpen, setResponseOpen] = useState(false);
  const [detailIds, setDetailIds] = useState<string[] | null>(null);

  const shorten = useFlowRun({ build: buildShortenFlow, call: runShorten });
  const visit = useFlowRun({ build: buildVisitFlow, call: runVisit });
  const active = tab === "shorten" ? shorten : visit;

  const { view, panning, surface, zoomBy, fit, handlers } = useCanvasView(INITIAL_VIEW);
  const layout = buildLayout(active.flow, exploded);
  const gap = DOT_SPACING * view.scale;

  useEffect(() => {
    fit(layout.minX, layout.maxX);
  }, [fit, layout.minX, layout.maxX, tab, exploded]);

  const lastCode = shorten.data ? (bodyOf(shorten.data.trace).code ?? "") : "";
  const inputInitial = tab === "shorten" ? shorten.input : visit.input || lastCode;

  // After a run: open the answer if it worked, or the step that failed.
  function showOutcome(which: Tab, finished: FlowSpec | null) {
    if (!finished) return;
    const failed = finished.atoms.find((a) => a.status === "error");
    if (failed) return setDetailIds([failed.id]);
    if (which === "shorten") return setResponseOpen(true);
    setDetailIds(["redirect"]);
  }

  async function start(which: Tab, value: string) {
    const flow = which === "shorten" ? shorten : visit;
    showOutcome(which, await flow.run(value));
  }

  function execute() {
    if (!active.input && !(tab === "visit" && lastCode)) return setInputOpen(true);
    void start(tab, active.input || lastCode);
  }

  function save(raw: string) {
    setInputOpen(false);
    const value = tab === "shorten" ? raw : codeFromInput(raw);
    void start(tab, value);
  }

  function follow(code: string) {
    setResponseOpen(false);
    setTab("visit");
    void start("visit", code);
  }

  const exports = useExports({
    tabKey: tab,
    workflowName: tab === "shorten" ? "Shorten a URL" : "Open a short link",
    flow: active.flow,
    done: active.phase === "done",
  });

  const detailAtoms = detailIds ? active.flow.atoms.filter((a) => detailIds.includes(a.id)) : null;
  const detailGroup = detailAtoms && detailAtoms.length > 1 ? active.flow.groups.find((g) => g.id === detailAtoms[0].group) : null;

  return (
    <main className={styles.page}>
      <div
        ref={surface}
        className={`${styles.canvas} ${panning ? styles.panning : ""}`}
        style={{ backgroundSize: `${gap}px ${gap}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
        {...handlers}
      >
        <div className={styles.world} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
          {layout.frames.map((frame) => (
            <div key={frame.key} className={styles.frame} style={{ left: frame.x1 - 84, width: frame.x2 - frame.x1 + 168 }} aria-hidden="true">
              <span className={styles.frameTitle}>{frame.title}</span>
            </div>
          ))}
          {layout.edges.map((edge) => (
            <Edge key={edge.key} fromX={edge.fromX} toX={edge.toX} status={edge.status} label={edge.label} />
          ))}
          {layout.nodes.map((node) => (
            <WorkflowNode
              key={node.key}
              x={node.x}
              title={node.title}
              subtitle={node.summary}
              status={node.status}
              icon={node.icon}
              isTrigger={node.trigger}
              hasInput={node.hasInput}
              onOpen={() => (node.trigger ? setInputOpen(true) : setDetailIds(node.atoms.map((a) => a.id)))}
            />
          ))}
        </div>
      </div>

      <header className={styles.topbar}>
        <h1 className={styles.heading}>URL shortener workflow</h1>
        <p className={styles.hint}>Drag to move, scroll to zoom, click a step to look inside</p>
      </header>

      <div className={styles.tabs} role="tablist" aria-label="Workflow" data-no-pan>
        <button type="button" role="tab" aria-selected={tab === "shorten"} className={tab === "shorten" ? styles.tabOn : styles.tab} onClick={() => setTab("shorten")}>
          Shorten a URL
        </button>
        <button type="button" role="tab" aria-selected={tab === "visit"} className={tab === "visit" ? styles.tabOn : styles.tab} onClick={() => setTab("visit")}>
          Open a short link
        </button>
      </div>

      <div className={styles.toolbar} data-no-pan>
        <button type="button" className={exploded ? styles.tabOn : styles.tab} aria-pressed={exploded} onClick={() => setExploded((v) => !v)}>
          Exploded view
        </button>
        <button type="button" className={styles.tab} onClick={() => exports.exportFlow(exploded)} disabled={exports.busy}>
          Export PNG
        </button>
        <button
          type="button"
          className={styles.tab}
          onClick={exports.exportZip}
          disabled={exports.busy || active.phase !== "done"}
          title={active.phase === "done" ? "Workflow pictures and every step's answer, in one ZIP" : "Run the workflow first"}
        >
          {exports.busy ? "Exporting…" : "Export ZIP"}
        </button>
      </div>

      {exports.error && (
        <p className={styles.exportError} role="alert">{exports.error}</p>
      )}

      <div className={styles.zoom} data-no-pan>
        <button type="button" onClick={() => zoomBy(1.2)} aria-label="Zoom in">+</button>
        <button type="button" onClick={() => zoomBy(1 / 1.2)} aria-label="Zoom out">−</button>
        <button type="button" onClick={() => fit(layout.minX, layout.maxX)} aria-label="Fit to screen">⤢</button>
      </div>

      <div className={styles.executeBar} data-no-pan>
        <button type="button" className={styles.execute} onClick={execute} disabled={active.running}>
          {active.running ? "Executing…" : "Execute workflow"}
        </button>
      </div>

      <InputDialog
        open={inputOpen}
        title="Manual Trigger"
        label={tab === "shorten" ? "URL to shorten" : "Short code or short link"}
        placeholder={tab === "shorten" ? "https://example.com/a/very/long/link" : "KSuPN9U or http://localhost:3302/KSuPN9U"}
        initial={inputInitial}
        validate={(value) =>
          tab === "shorten"
            ? isValidUrl(value) ? null : "Enter a full address that starts with http:// or https://"
            : value ? (isPossibleCode(codeFromInput(value)) ? null : "That is not a possible short code") : "Enter a short code or link"
        }
        onSave={save}
        onClose={() => setInputOpen(false)}
      />
      <DetailDialog title={detailGroup?.title ?? detailAtoms?.[0]?.title ?? ""} atoms={detailAtoms} busy={exports.busy} onExport={() => detailIds && exports.exportAtoms(detailIds)} onClose={() => setDetailIds(null)} />
      <ResponseDialog
        open={responseOpen}
        data={shorten.data}
        busy={exports.busy}
        onExport={() => exports.exportAtoms(["response"])}
        onClose={() => setResponseOpen(false)}
        onFollow={follow}
      />
    </main>
  );
}
