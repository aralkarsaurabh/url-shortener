import type { ReactNode } from "react";
import ui from "./ui.module.css";

export function Panel({ title, intro, lookFor, children }: { title: string; intro: string; lookFor?: string; children: ReactNode }) {
  return (
    <section className={ui.panel}>
      <h2>{title}</h2>
      <p className={ui.intro}>{intro}</p>
      {lookFor && (
        <p className={ui.lookFor}>
          <strong>What to look for: </strong>
          {lookFor}
        </p>
      )}
      {children}
    </section>
  );
}
