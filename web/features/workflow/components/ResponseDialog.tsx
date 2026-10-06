"use client";

import { useEffect, useId, useRef, useState } from "react";
import { bodyOf, type ShortenData } from "../lib/shortenFlow";
import styles from "./WorkflowPage.module.css";

type Props = {
  open: boolean;
  data: ShortenData | null;
  busy: boolean;
  onExport: () => void;
  onClose: () => void;
  onFollow: (code: string) => void;
};

export function ResponseDialog({ open, data, busy, onExport, onClose, onFollow }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) {
      setCopied(false);
      el.showModal();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  const trace = data?.trace;
  const body = trace ? bodyOf(trace) : null;

  async function copy() {
    if (!body?.shortUrl) return;
    try {
      await navigator.clipboard.writeText(body.shortUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <dialog ref={dialog} className={`${styles.dialog} ${styles.wide}`} onClose={onClose} aria-labelledby={titleId}>
      <h2 id={titleId} className={styles.dialogTitle}>Your short URL is ready</h2>
      {body?.code && body.shortUrl && trace?.response && (
        <>
          <p className={styles.shortUrl}>
            <a href={body.shortUrl} target="_blank" rel="noreferrer">{body.shortUrl}</a>
          </p>
          <dl className={styles.rows}>
            <div className={styles.row}><dt>code</dt><dd>{body.code}</dd></div>
            <div className={styles.row}><dt>expires</dt><dd>{body.expiresAt ?? "never"}</dd></div>
            <div className={styles.row}><dt>answer</dt><dd>{trace.response.status} {trace.response.statusText} in {trace.durationMs} ms</dd></div>
          </dl>
          <h4 className={styles.sectionTitle}>Response body</h4>
          <pre className={styles.code}>{JSON.stringify(trace.response.body, null, 2)}</pre>
        </>
      )}
      <div className={styles.dialogActions}>
        <button type="button" className={styles.secondary} onClick={copy}>{copied ? "Copied" : "Copy link"}</button>
        <button type="button" className={styles.secondary} onClick={() => body?.code && onFollow(body.code)}>
          Follow this link in the workflow
        </button>
        <button type="button" className={styles.secondary} onClick={onExport} disabled={busy}>Export PNG</button>
        <button type="button" className={styles.primary} onClick={onClose} autoFocus>Close</button>
      </div>
    </dialog>
  );
}
