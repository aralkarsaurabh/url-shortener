import type { Step, StepStatus } from "../hooks/useExperiment";
import ui from "./ui.module.css";

const ICONS: Record<StepStatus, string> = { running: "…", pass: "✓", fail: "✗", info: "i" };
const CLASSES: Record<StepStatus, string> = {
  running: ui.stepRunning,
  pass: ui.stepPass,
  fail: ui.stepFail,
  info: ui.stepInfo,
};

export function JsonBlock({ value }: { value: unknown }) {
  return <pre className={ui.pre}>{JSON.stringify(value, null, 2)}</pre>;
}

export function StepLog({ steps }: { steps: Step[] }) {
  if (steps.length === 0) return null;
  return (
    <ol className={ui.steps}>
      {steps.map((step, i) => (
        <li key={i} className={`${ui.step} ${CLASSES[step.status]}`}>
          <span className={ui.icon}>{ICONS[step.status]}</span>
          <div>
            <div className={ui.stepLabel}>{step.label}</div>
            {step.detail && <div className={ui.stepDetail}>{step.detail}</div>}
            {step.data !== undefined && <JsonBlock value={step.data} />}
          </div>
        </li>
      ))}
    </ol>
  );
}
