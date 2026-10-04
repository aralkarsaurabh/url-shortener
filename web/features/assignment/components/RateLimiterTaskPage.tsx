"use client";

import { AlgorithmComparisonPanel } from "./AlgorithmComparisonPanel";
import { RateLimiterTaskPanel } from "./RateLimiterTaskPanel";

// The Task 2 tab: one section for each slice of the rate limiter, in order.
export function RateLimiterTaskPage() {
  return (
    <div style={{ display: "grid", gap: 40 }}>
      <RateLimiterTaskPanel />
      <AlgorithmComparisonPanel />
    </div>
  );
}
