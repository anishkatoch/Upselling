import type { Evidence, Mood, Report, ReplyKind, Segment } from "../../lib/api";
import { clock, MOOD_TONE, nice } from "../../lib/format";
import { ChatBubble, ChatGroup } from "./chat";
import { sideOf } from "./chatUtils";

/**
 * The mood-fusion model occasionally echoes back the role-annotated label it was shown
 * in the prompt ("A (salesperson)") instead of the bare speaker id ("A") in its `speaker`
 * field. Strip that annotation before matching against `report.speakers`, so older
 * analyzed jobs with this in their saved data still resolve to the right name/color/title.
 */
export function canon(speaker: string): string {
  return speaker.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

/** A stable, pleasant color per speaker label, cycling through a small palette. */
const PALETTE = ["#c7502b", "#2c6e4f", "#3a5a9c", "#9c6b12", "#7a4fa3", "#2a7d7d"];
export function colorFor(speaker: string, report: Report): string {
  const key = canon(speaker);
  const i = report.speakers.findIndex((s) => s.speaker === key);
  // No match (e.g. an id that's out of sync with report.speakers) gets a neutral color of its
  // own, rather than silently reusing speaker index 0's color and looking like the same person.
  return i < 0 ? "var(--faint)" : PALETTE[i % PALETTE.length];
}

export function titleFor(speaker: string, report: Report): string | undefined {
  return report.speakers.find((s) => s.speaker === canon(speaker))?.title ?? undefined;
}

export function Spk({ speaker, report, who }: { speaker: string; report: Report; who?: (s: string) => string }) {
  const title = titleFor(speaker, report);
  return (
    <span className="spk" style={{ "--c": colorFor(speaker, report) } as React.CSSProperties} title={title}>
      <i />
      {who ? who(canon(speaker)) : speaker}
    </span>
  );
}

/** Muted role text beside a speaker, only when it adds something (not "Customer customer"). */
/**
 * The speaker-name function to use INSIDE one conversation: a conversation has a single customer, so they are
 * just "Customer" there; the numbered names only matter when the whole recording is listed.
 */
export function convWho(report: Report, who: (s: string) => string, conversationId: number | undefined): (s: string) => string {
  const customers = report.conversations.find((c) => c.conversation_id === conversationId)?.customers ?? [];
  const only = customers.length === 1 ? canon(customers[0]) : null;
  return (s) => (only && canon(s) === only ? "Customer" : who(s));
}

export function RoleNote({ speaker, report, who, role }: { speaker: string; report: Report; who?: (s: string) => string; role?: string | null }) {
  const r = role ?? report.speakers.find((s) => s.speaker === canon(speaker))?.role;
  const shown = (who ? who(canon(speaker)) : speaker).trim().toLowerCase();
  if (!r || r.trim().toLowerCase() === shown) return null;
  return <span className="sub small"> {r}</span>;
}

/** Jump to a moment in the recording when playback is available. */
export function TimeBtn({ t, seek }: { t: number; seek?: (t: number) => void }) {
  if (seek) return <button type="button" className="chip" aria-label={`Play recording at ${clock(t)}`} onClick={() => seek(Math.max(0, t - 3))}>{clock(t)}</button>;
  return (
    <span className="chip" style={{ fontVariantNumeric: "tabular-nums" }}>
      {clock(t)}
    </span>
  );
}

export function RespPill({ r }: { r: ReplyKind }) {
  const tone = r === "accepted" ? "good" : r === "rejected" ? "bad" : "neutral";
  return <span className={`pill ${tone}`}>{nice(r)}</span>;
}

export function MoodPill({ m }: { m: Mood }) {
  return <span className={`pill ${MOOD_TONE[m]}`}>{m}</span>;
}

const EVIDENCE_LABEL: Record<string, string> = {
  upsell_attempt: "upsell attempt",
  frustration: "frustration",
  unanswered_question: "unanswered question",
  greeting: "greeting",
  customer_feedback: "customer feedback",
};

/** Split lines into runs of consecutive lines by the same speaker. */
function groupLines<T extends { speaker: string }>(lines: T[]): T[][] {
  const out: T[][] = [];
  for (const l of lines) {
    const last = out[out.length - 1];
    if (last && canon(last[0].speaker) === canon(l.speaker)) last.push(l);
    else out.push([l]);
  }
  return out;
}

export function evidenceIndex(evidence: Evidence[]): Map<string, Evidence> {
  return new Map(evidence.map((e) => [`${e.conversation_id}:${e.kind}:${e.index}`, e]));
}

export function EvidenceBlock({
  ev,
  report,
  gotoLine,
  who,
  compact,
  openAll,
}: {
  ev: Evidence | undefined;
  report: Report;
  seek: (t: number) => void;
  gotoLine: (segId: number) => void;
  who?: (s: string) => string;
  compact?: boolean;
  openAll?: boolean;
}) {
  if (!ev) return null;
  const label = EVIDENCE_LABEL[ev.kind] ?? ev.kind;
  if (ev.lines.length === 0) {
    return (
      <p className="sub small" style={{ marginTop: 6 }}>
        Evidence for this {label} could not be matched to a transcript line.
      </p>
    );
  }
  const warn =
    ev.kind === "customer_feedback" ? (
      <span className="pill neutral" title="A short paraphrase of what the customer meant, not a direct quote.">
        paraphrased
      </span>
    ) : !ev.quote_found ? (
      <span className="pill warn" title="The quoted words were not found verbatim in the transcript. Check the lines below.">
        quote not matched exactly
      </span>
    ) : null;
  return (
    <details className="evidence" open={openAll}>
      <summary>
        Evidence: {label}
        {!compact && ` · conversation #${ev.conversation_id}`} {warn}
        <button
          className="link small"
          onClick={(e) => {
            e.preventDefault();
            gotoLine(ev.segment_id);
          }}
        >
          Open in full transcript →
        </button>
      </summary>
      <div className="chat chat-mini">
        {groupLines(ev.lines).map((g, gi) => (
          <ChatGroup key={gi} speaker={g[0].speaker} report={report} who={who ? convWho(report, who, ev.conversation_id) : undefined} role={g[0].role}>
            {g.map((l, i) => (
              <ChatBubble
                key={i}
                side={sideOf(l.speaker, report, l.role)}
                time={clock(l.start)}
                edge={l.is_highlighted ? "hit" : undefined}
                tag={l.is_highlighted ? label : undefined}
              >
                {l.text}
              </ChatBubble>
            ))}
          </ChatGroup>
        ))}
      </div>
    </details>
  );
}

export function Meter({ level }: { level: number }) {
  const cls = level >= 7 ? "bad" : level >= 4 ? "warn" : "good";
  return (
    <div className="meter">
      {Array.from({ length: 10 }, (_, i) => (
        <i key={i} className={i < level ? cls : ""} />
      ))}
    </div>
  );
}

export interface RecCtx {
  report: Report;
  outcomes: import("../../lib/api").Outcomes;
  segments: Segment[];
  segById: Map<number, Segment>;
  evBy: Map<string, Evidence>;
  who: (s: string) => string;
  seek: (t: number) => void;
  gotoConversation: (cid: number) => void;
  gotoLine: (segId: number) => void;
}
