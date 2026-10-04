"use client";

import { LoadBalancerTaskPanel } from "./LoadBalancerTaskPanel";

// The Task 3 tab: one section for each slice of the load balancer, in order.
export function LoadBalancerTaskPage() {
  return (
    <div style={{ display: "grid", gap: 40 }}>
      <LoadBalancerTaskPanel />
    </div>
  );
}
