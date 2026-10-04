"use client";

import { LoadBalancerCountersPanel } from "./LoadBalancerCountersPanel";
import { DistributionPanel } from "./DistributionPanel";
import { ForwardingPanel } from "./ForwardingPanel";
import { HealthDrainingPanel } from "./HealthDrainingPanel";
import { HealthPanel } from "./HealthPanel";
import { LoadBalancerTaskPanel } from "./LoadBalancerTaskPanel";

// The Task 3 tab: one section for each slice of the load balancer, in order.
export function LoadBalancerTaskPage() {
  return (
    <div style={{ display: "grid", gap: 40 }}>
      <LoadBalancerTaskPanel />
      <ForwardingPanel />
      <HealthPanel />
      <DistributionPanel />
      <HealthDrainingPanel />
      <LoadBalancerCountersPanel />
    </div>
  );
}
