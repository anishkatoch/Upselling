import type { ReactNode } from "react";
import type { Report } from "../../lib/api";
import { canon } from "./shared";

/** Which side a speaker sits on: the salesperson is "me" (right), everyone else is left. */
export function sideOf(speaker: string, report: Report, role?: string | null): "right" | "left" {
  const r = role ?? report.speakers.find((s) => s.speaker === canon(speaker))?.role;
  return r === "salesperson" ? "right" : "left";
}

/** Highlight case-insensitive matches of `q` inside `text` with <mark>. */
export function highlight(text: string, q: string): ReactNode {
  const needle = q.trim();
  if (!needle) return text;
  const parts = text.split(new RegExp(`(${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
  return parts.map((p, i) => (i % 2 === 1 ? <mark key={i}>{p}</mark> : p));
}
