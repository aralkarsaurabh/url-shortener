"use client";

import { useState, type FormEvent } from "react";
import { useShortener } from "../hooks/useShortener";
import { testRedirect } from "../api/shortenApi";
import styles from "./ShortenerPanel.module.css";

export function ShortenerPanel() {
  const { items, loading, error, submit } = useShortener();
  const [url, setUrl] = useState("");
  const [alias, setAlias] = useState("");
  const [expiry, setExpiry] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<number, string>>({});

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const ok = await submit({
      url: url.trim(),
      ...(alias.trim() && { alias: alias.trim() }),
      ...(expiry && { expiresInSeconds: Number(expiry) }),
    });
    if (ok) {
      setUrl("");
      setAlias("");
    }
  }

  async function copy(shortUrl: string) {
    await navigator.clipboard.writeText(shortUrl);
    setCopied(shortUrl);
    setTimeout(() => setCopied(null), 1500);
  }

  async function test(id: number, code: string) {
    setTests((prev) => ({ ...prev, [id]: "testing..." }));
    const result = await testRedirect(code);
    const where = result.headers.location ? ` to ${result.headers.location}` : "";
    const by = result.headers["x-served-by"] ? `, answered by ${result.headers["x-served-by"]}` : "";
    setTests((prev) => ({ ...prev, [id]: `${result.status}${where} in ${result.ms} ms${by}` }));
  }

  return (
    <div className={styles.main}>
      <h2>Shorten and redirect</h2>
      <p className={styles.sub}>
        Paste a long link, get a short one, then press Test to see the real answer (status, where it redirects, which instance answered).
      </p>

      <form className={styles.form} onSubmit={onSubmit}>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/a/very/long/link"
          aria-label="Long URL"
          required
        />
        <input
          type="text"
          value={alias}
          onChange={(e) => setAlias(e.target.value)}
          placeholder="Custom alias (optional)"
          aria-label="Custom alias"
          className={styles.alias}
        />
        <select value={expiry} onChange={(e) => setExpiry(e.target.value)} aria-label="Expires after">
          <option value="">Never expires</option>
          <option value="60">Expires in 1 minute</option>
          <option value="3600">Expires in 1 hour</option>
          <option value="86400">Expires in 1 day</option>
        </select>
        <button type="submit" disabled={loading}>
          {loading ? "Shortening..." : "Shorten"}
        </button>
      </form>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {items.length > 0 && (
        <section>
          <h2>Created this session</h2>
          <ul className={styles.list}>
            {items.map((item) => (
              <li key={item.id} className={styles.item}>
                <a href={item.shortUrl} target="_blank" rel="noreferrer" className={styles.short}>
                  {item.shortUrl}
                </a>
                <span className={styles.original}>
                  {item.originalUrl}
                  {item.expiresAt && ` (expires ${new Date(item.expiresAt).toLocaleString()})`}
                </span>
                <span className={styles.buttons}>
                  <button type="button" onClick={() => test(item.id, item.code)}>Test</button>
                  <button type="button" onClick={() => copy(item.shortUrl)}>
                    {copied === item.shortUrl ? "Copied" : "Copy"}
                  </button>
                </span>
                {tests[item.id] && <span className={styles.original}>Test: {tests[item.id]}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
