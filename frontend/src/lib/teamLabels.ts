import type { EffortLevel, Person } from "./api";
import type { Period } from "./period";

export const RATING: Record<Person["assessment"]["rating"], { label: string; tone: "good" | "accent" | "bad" }> = {
  strong: { label: "Excelling", tone: "good" },
  solid: { label: "On track", tone: "accent" },
  needs_work: { label: "Needs support", tone: "bad" },
};
export const EFFORT: Record<EffortLevel, { label: string; short: string; tone: "good" | "warn" | "bad" }> = {
  high: { label: "High effort", short: "High", tone: "good" },
  moderate: { label: "Moderate effort", short: "Moderate", tone: "warn" },
  low: { label: "Low effort", short: "Low", tone: "bad" },
  none: { label: "No selling effort", short: "None", tone: "bad" },
};
// A bare "3.8" means nothing without knowing the scale or which way is good - so the glance
// table shows this as a plain word instead, the same way the rest of the table already does.
export const EFFORT_TONE: Record<EffortLevel, "neutral" | "muted"> = { high: "neutral", moderate: "neutral", low: "muted", none: "muted" };
export function moodFromFrustration(v: number | null): { label: string; tone: "good" | "warn" | "bad" | "neutral" } {
  if (v == null) return { label: "No data", tone: "neutral" };
  if (v < 3) return { label: "Calm", tone: "good" };
  if (v < 5) return { label: "Some tension", tone: "warn" };
  return { label: "Frustrated", tone: "bad" };
}
export const TREND_SENTENCE: Record<NonNullable<Person["assessment"]["trend"]>, string> = {
  improving: "effort is improving",
  steady: "effort is steady",
  declining: "effort is dropping",
};
// The numbers below are scoped to the selected period (today / this week / this month), not
// all-time - this says so wherever a bare count could otherwise read as "ever".
export const PERIOD_LABEL: Record<Period, string> = { day: "today", week: "this week", month: "this month" };
