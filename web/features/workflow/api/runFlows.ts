import type { ShortenData } from "../lib/shortenFlow";
import { bodyOf } from "../lib/shortenFlow";
import type { VisitData } from "../lib/visitFlow";
import { getCounters, inspectCode } from "./debugApi";
import { callShorten } from "./shortenCall";
import { callVisit } from "./visitCall";

// One real request, with the service's own counters read before and after so we can see
// which steps it really went through.
export async function runShorten(url: string): Promise<ShortenData> {
  const before = await getCounters();
  const trace = await callShorten(url);
  const after = await getCounters();
  const code = bodyOf(trace).code;
  const inspect = code ? await inspectCode(code) : null;
  return { trace, before, after, inspect };
}

export async function runVisit(code: string): Promise<VisitData> {
  const [beforeCounters, before] = await Promise.all([getCounters(), inspectCode(code)]);
  const trace = await callVisit(code);
  const [afterCounters, after] = await Promise.all([getCounters(), inspectCode(code)]);
  return { trace, beforeCounters, afterCounters, before, after };
}
