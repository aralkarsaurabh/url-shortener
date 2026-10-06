"use client";

import { useEffect, useId, useRef, useState } from "react";
import styles from "./WorkflowPage.module.css";

type Props = {
  open: boolean;
  title: string;
  label: string;
  placeholder: string;
  initial: string;
  validate: (value: string) => string | null;
  onSave: (value: string) => void;
  onClose: () => void;
};

export function InputDialog({ open, title, label, placeholder, initial, validate, onSave, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) {
      setValue(initial);
      setError(null);
      el.showModal();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open, initial]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = value.trim();
    const problem = validate(trimmed);
    if (problem) {
      setError(problem);
      return;
    }
    onSave(trimmed);
  }

  return (
    <dialog ref={dialog} className={styles.dialog} onClose={onClose} aria-labelledby={`${id}-title`}>
      <form onSubmit={submit} noValidate>
        <h2 id={`${id}-title`} className={styles.dialogTitle}>{title}</h2>
        <label htmlFor={id} className={styles.label}>{label}</label>
        <input
          id={id}
          type="text"
          className={styles.input}
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          autoComplete="off"
          autoFocus
        />
        {error && <p id={`${id}-error`} role="alert" className={styles.error}>{error}</p>}
        <p className={styles.muted}>Saving starts the workflow.</p>
        <div className={styles.dialogActions}>
          <button type="button" className={styles.secondary} onClick={onClose}>Cancel</button>
          <button type="submit" className={styles.primary}>Save</button>
        </div>
      </form>
    </dialog>
  );
}
