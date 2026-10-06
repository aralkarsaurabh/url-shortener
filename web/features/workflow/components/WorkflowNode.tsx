import type { IconName, NodeStatus } from "../model/types";
import { Icon } from "./Icon";
import styles from "./WorkflowPage.module.css";

type Props = {
  x: number;
  title: string;
  subtitle: string;
  status: NodeStatus;
  icon: IconName;
  isTrigger?: boolean;
  hasInput?: boolean;
  onOpen: () => void;
};

const STATUS_LABEL: Record<NodeStatus, string> = {
  idle: "Not run yet",
  running: "Running",
  success: "Ran successfully",
  error: "Failed",
  skipped: "Skipped",
};

export function WorkflowNode({ x, title, subtitle, status, icon, isTrigger, hasInput, onOpen }: Props) {
  return (
    <div className={styles.nodeWrap} style={{ left: x }} data-no-pan>
      <button
        type="button"
        className={`${styles.node} ${isTrigger ? styles.trigger : ""} ${styles[status]}`}
        onClick={onOpen}
        aria-label={`${title} node. ${STATUS_LABEL[status]}. ${subtitle}`}
      >
        <Icon name={icon} />
        {hasInput && <span className={`${styles.handle} ${styles.handleIn}`} aria-hidden="true" />}
        <span className={`${styles.handle} ${styles.handleOut}`} aria-hidden="true" />
        {status === "success" && <span className={styles.badge} aria-hidden="true">✓</span>}
        {status === "error" && <span className={`${styles.badge} ${styles.badgeError}`} aria-hidden="true">!</span>}
      </button>
      <div className={styles.nodeTitle}>{title}</div>
      <div className={styles.nodeSub} title={subtitle}>{subtitle}</div>
    </div>
  );
}
