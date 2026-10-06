"use client";

import { useState, type FormEvent } from "react";
import { useShortener } from "../hooks/useShortener";
import styles from "./ShortenerPage.module.css";

export function ShortenerPage() {
  const { items, loading, error, submit } = useShortener();
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (await submit(url)) setUrl("");
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
              <li key={item.createdAt} className={styles.item}>
                <a href={item.shortUrl} target="_blank" rel="noreferrer" className={styles.short}>
                  {item.shortUrl}
                </a>
                <span className={styles.original}>{item.originalUrl}</span>
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
