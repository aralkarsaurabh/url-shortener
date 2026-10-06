"use client";

import { useEffect, useId, useRef } from "react";
import type { Atom } from "../model/types";
import styles from "./WorkflowPage.module.css";

type Props = {
  title: string;
  atoms: Atom[] | null; // null keeps the dialog closed
  busy: boolean;
  onExport: () => void;
  onClose: () => void;
};

export function DetailDialog({ title, atoms, busy, onExport, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const open = atoms !== null;

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog ref={dialog} className={`${styles.dialog} ${styles.wide}`} onClose={onClose} aria-labelledby={titleId}>
      <h2 id={titleId} className={styles.dialogTitle}>{title}</h2>
      {atoms?.map((atom) => (
        <section key={atom.id} className={styles.atomBlock}>
          {atoms.length > 1 && <h3 className={styles.atomTitle}>{atom.title}</h3>}
          {atom.verdict && <p className={atom.verdict.ok ? styles.verdictOk : styles.verdictBad}>{atom.verdict.text}</p>}
          {atom.sections.map((section) => (
            <div key={section.title}>
              <h4 className={styles.sectionTitle}>{section.title}</h4>
              {section.text && <p className={styles.text}>{section.text}</p>}
              {section.code && <pre className={styles.code}>{section.code}</pre>}
              {section.rows && section.rows.length > 0 && (
                <dl className={styles.rows}>
                  {section.rows.map(([key, value]) => (
                    <div key={key} className={styles.row}>
                      <dt>{key}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          ))}
        </section>
      ))}
      <div className={styles.dialogActions}>
        <button type="button" className={styles.secondary} onClick={onExport} disabled={busy}>Export PNG</button>
        <button type="button" className={styles.primary} onClick={onClose} autoFocus>Close</button>
      </div>
    </dialog>
  );
}
