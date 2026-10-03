"use client";

import { useRef, useState } from "react";
import { shortenUrl } from "../api/shortenApi";
import type { ShortenInput, ShortenedUrl } from "../model/types";

export function useShortener() {
  const [items, setItems] = useState<ShortenedUrl[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextId = useRef(1);

  async function submit(input: ShortenInput): Promise<boolean> {
    setLoading(true);
    setError(null);
    try {
      const created = await shortenUrl(input);
      setItems((prev) => [{ ...created, id: nextId.current++ }, ...prev]);
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
