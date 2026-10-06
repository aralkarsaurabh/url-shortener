"use client";

import { useState } from "react";
import { shortenUrl } from "../api/shortenApi";
import type { ShortenedUrl } from "../model/types";

export function useShortener() {
  const [items, setItems] = useState<ShortenedUrl[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(url: string): Promise<boolean> {
    setLoading(true);
    setError(null);
    try {
      const created = await shortenUrl(url.trim());
      setItems((prev) => [created, ...prev]);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      return false;
    } finally {
      setLoading(false);
    }
  }

  return { items, loading, error, submit };
}
