"use client";

import { useState, type FormEvent } from "react";
import { useShortener } from "../hooks/useShortener";
import styles from "./ShortenerPage.module.css";

export function ShortenerPage() {
  const { items, loading, error, submit } = useShortener();
  const [url, setUrl] = useState("");
  const [alias, setAlias] = useState("");
  const [expiry, setExpiry] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

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

  return (
    <main className={styles.main}>
      <h1>URL Shortener</h1>
      <p className={styles.sub}>Paste a long link, get a short one, click it to test the redirect.</p>

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
                <button type="button" onClick={() => copy(item.shortUrl)}>
                  {copied === item.shortUrl ? "Copied" : "Copy"}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
