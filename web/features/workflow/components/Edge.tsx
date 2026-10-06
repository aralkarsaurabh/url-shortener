import type { NodeStatus } from "../model/types";
import styles from "./WorkflowPage.module.css";

type Props = {
  fromX: number;
  toX: number;
  status: NodeStatus; // the status of the node the line runs into
  label: string;
};

// The line between two nodes. While the next step is working, little packets travel along it.
export function Edge({ fromX, toX, status, label }: Props) {
  const length = toX - fromX;
  const tone = status === "error" ? styles.edgeError : status === "success" ? styles.edgeOk : status === "skipped" ? styles.edgeSkipped : "";
  return (
    <>
      <div className={`${styles.edge} ${tone}`} style={{ left: fromX, width: length }} aria-hidden="true" />
      {status === "running" &&
        [0, 1, 2].map((i) => (
          <span
            key={i}
            className={styles.packet}
            style={{ offsetPath: `path("M ${fromX} 0 L ${toX} 0")`, animationDelay: `${i * 0.45}s` }}
            aria-hidden="true"
          />
        ))}
      {label && status !== "idle" && status !== "skipped" && (
        <div className={`${styles.chip} ${status === "error" ? styles.chipError : ""}`} style={{ left: fromX + length / 2 }}>
          {label}
        </div>
      )}
    </>
  );
}
