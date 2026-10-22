import type { Mood, ReplyKind, Sentiment, UpsellResult } from "./api";

export function clock(s: number): string {
  const t = Math.max(0, Math.round(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = t % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0");
  return `${h ? h + ":" : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

export function length(s: number): string {
  const m = Math.round(s / 60);
  if (m < 1) return "under a minute";
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function ago(iso: string): string {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function pct(v: number | null | undefined): string {
  return v == null ? "–" : `${Math.round(v * 100)}%`;
}

export function money(v: number | null | undefined): string {
  return v == null ? "–" : `$${v.toFixed(v < 1 ? 4 : 2)}`;
}

/** snake_case / terse backend strings -> readable words, for anything without its own label map. */
export function nice(s: string): string {
  return s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export const MOOD_TONE: Record<Mood, "good" | "neutral" | "bad"> = {
  happy: "good",
  calm: "good",
  neutral: "neutral",
  confused: "neutral",
  impatient: "bad",
  irritated: "bad",
  frustrated: "bad",
  angry: "bad",
};

export const SENTIMENT: Record<Sentiment, { label: string; tone: "good" | "neutral" | "bad" }> = {
  positive: { label: "Went well", tone: "good" },
  neutral: { label: "Okay", tone: "neutral" },
  negative: { label: "Needs attention", tone: "bad" },
};

export const RESULT: Record<UpsellResult, { label: string; tone: "good" | "neutral" | "bad" | "accent" }> = {
  won: { label: "Customer said yes", tone: "good" },
  lost: { label: "Customer said no", tone: "bad" },
  open: { label: "No clear answer", tone: "neutral" },
  none: { label: "No upsell tried", tone: "neutral" },
  unknown: { label: "Not analysed", tone: "neutral" },
};

export const REPLY: Record<ReplyKind, { label: string; tone: "good" | "neutral" | "bad" }> = {
  accepted: { label: "Said yes", tone: "good" },
  rejected: { label: "Said no", tone: "bad" },
  undecided: { label: "Unsure", tone: "neutral" },
  no_response: { label: "No reply", tone: "neutral" },
};

const TECHNIQUE: Record<string, string> = {
  cross_sell: "Suggested an extra item",
  upgrade: "Offered an upgrade",
  bundle: "Offered a bundle",
  discount_offer: "Offered a discount",
  warranty_protection: "Offered a warranty",
  plan_upgrade: "Offered a better plan",
  membership_loyalty: "Offered a membership",
  scarcity_urgency: "Created urgency",
  social_proof: "Used social proof",
  other: "Other approach",
};
export const technique = (t: string) => TECHNIQUE[t] ?? t.replace(/_/g, " ");

export const STEPS = [
  { key: "extracting_audio", label: "Preparing the audio" },
  { key: "transcribing", label: "Writing out the conversation" },
  { key: "detecting_roles", label: "Finding who is who" },
  { key: "splitting_conversations", label: "Separating customer conversations" },
  { key: "analyzing_conversations", label: "Looking for upsell attempts and mood" },
  { key: "building_report", label: "Putting the report together" },
] as const;

/** A readable name for a recording: who it belongs to and when, instead of the file name. */
export function recordingTitle(j: { salesperson_name?: string | null; created_at: string }): string {
  const when = new Date(j.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return j.salesperson_name ? `${j.salesperson_name} - ${when}` : `Conversation - ${when}`;
}
