"use client";

import { useEffect, useState, useSyncExternalStore, type ComponentType } from "react";
import { loadConfig } from "@/features/probe/api/probeClient";
import type { ProbeConfig } from "@/features/probe/model/types";
import { RateLimiterTaskPage } from "@/features/assignment/components/RateLimiterTaskPage";
import { LoadBalancerTaskPage } from "@/features/assignment/components/LoadBalancerTaskPage";
import { CachePanel } from "@/features/checks/components/CachePanel";
import { ClicksPanel } from "@/features/checks/components/ClicksPanel";
import { ExpiryPanel } from "@/features/checks/components/ExpiryPanel";
import { FilterPanel } from "@/features/checks/components/FilterPanel";
import { HealthPanel } from "@/features/checks/components/HealthPanel";
import { RateLimitPanel } from "@/features/checks/components/RateLimitPanel";
import { ShortenerPanel } from "@/features/shortener/components/ShortenerPanel";
import { CheckerContext } from "../hooks/useChecker";
import styles from "./CheckerPage.module.css";

const TABS: { id: string; group: string; title: string; Component: ComponentType }[] = [
  { id: "shortener", group: "Task 1: URL shortener", title: "Shorten and redirect", Component: ShortenerPanel },
  { id: "cache", group: "Task 1: URL shortener", title: "Cache and leases", Component: CachePanel },
  { id: "clicks", group: "Task 1: URL shortener", title: "Click batching", Component: ClicksPanel },
  { id: "ratelimit", group: "Task 1: URL shortener", title: "Rate limit", Component: RateLimitPanel },
  { id: "filter", group: "Task 1: URL shortener", title: "Code filter", Component: FilterPanel },
  { id: "expiry", group: "Task 1: URL shortener", title: "Link expiry", Component: ExpiryPanel },
  { id: "instances", group: "Task 1: URL shortener", title: "Instances and health", Component: HealthPanel },
  { id: "task2", group: "Task 2: Rate limiter", title: "GET /data", Component: RateLimiterTaskPage },
  { id: "task3", group: "Task 3: Load balancer", title: "Round robin", Component: LoadBalancerTaskPage },
];

// The selected tab lives in the address (#cache), so a tab can be linked to and survives a reload.
const subscribe = (notify: () => void) => {
  window.addEventListener("hashchange", notify);
  return () => window.removeEventListener("hashchange", notify);
};
const readHash = () => window.location.hash.slice(1);

export function CheckerPage() {
  const hash = useSyncExternalStore(subscribe, readHash, () => "");
  const active = TABS.find((tab) => tab.id === hash) ?? TABS[0];

  const [config, setConfig] = useState<ProbeConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [instance, setInstance] = useState(0);

  useEffect(() => {
    loadConfig().then(setConfig).catch((err: Error) => setConfigError(err.message));
  }, []);

  return (
    <CheckerContext.Provider value={{ config, instance }}>
      <div className={styles.page}>
        <header className={styles.header}>
          <h1>System Design Checker</h1>
          <p className={styles.services}>
            {configError
              ? configError
              : config
                ? `Shortener: ${config.shortener.join(", ")}  ·  Rate limiter: ${config["rate-limiter"][0]}  ·  Balancer: ${config.balancer[0]}`
                : "Loading the settings..."}
          </p>
          {config && config.shortener.length > 1 && (
            <label className={styles.instance}>
              Shortener instance to test
              <select value={instance} onChange={(e) => setInstance(Number(e.target.value))}>
                {config.shortener.map((url, i) => (
                  <option key={`${url}-${i}`} value={i}>
                    {url}
                  </option>
                ))}
              </select>
            </label>
          )}
        </header>

        <div className={styles.layout}>
          <nav className={styles.nav} aria-label="Checks">
            {TABS.map((tab, index) => {
              const heading = index === 0 || TABS[index - 1].group !== tab.group ? <div className={styles.group}>{tab.group}</div> : null;
              return (
                <div key={tab.id} style={{ display: "contents" }}>
                  {heading}
                  <button
                    type="button"
                    className={`${styles.tab} ${tab.id === active.id ? styles.active : ""}`}
                    aria-current={tab.id === active.id ? "page" : undefined}
                    onClick={() => (window.location.hash = tab.id)}
                  >
                    {tab.title}
                  </button>
                </div>
              );
            })}
          </nav>
          <main className={styles.content}>
            <active.Component key={active.id} />
          </main>
        </div>
      </div>
    </CheckerContext.Provider>
  );
}
