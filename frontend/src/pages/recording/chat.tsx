import type { ReactNode } from "react";
import type { Report } from "../../lib/api";
import { canon, RoleNote, Spk } from "./shared";
import { sideOf } from "./chatUtils";

export type ChatEdge = "upsell" | "bad" | "hit" | undefined;

function roleKind(speaker: string, report: Report, role?: string | null): string {
  return role ?? report.speakers.find((s) => s.speaker === canon(speaker))?.role ?? "speaker";
}

/** One message bubble. The tag is a text label so the highlight never relies on colour alone. */
export function ChatBubble({
  side,
  time,
  edge,
  tag,
  id,
  bubbleRef,
  children,
}: {
  side: "right" | "left";
  time: string;
  edge?: ChatEdge;
  tag?: string;
  id?: string;
  bubbleRef?: (el: HTMLDivElement | null) => void;
  children: ReactNode;
}) {
  return (
    <div className={`chat-msg ${side}`} id={id} ref={bubbleRef}>
      <div className={`chat-bubble ${edge ? `edge-${edge}` : ""}`}>
        {tag && <span className={`chat-tag ${edge ?? ""}`}>{tag}</span>}
        <div className="chat-text">{children}</div>
      </div>
      <span className="chat-time">{time}</span>
    </div>
  );
}

/** A run of consecutive bubbles from one speaker, named once at the top. */
export function ChatGroup({
  speaker,
  report,
  who,
  role,
  children,
}: {
  speaker: string;
  report: Report;
  who?: (s: string) => string;
  role?: string | null;
  children: ReactNode;
}) {
  const side = sideOf(speaker, report, role);
  const name = who ? who(canon(speaker)) : speaker;
  return (
    <div className={`chat-group ${side}`} role="group" aria-label={`${name}, ${roleKind(speaker, report, role)}`}>
      <div className="chat-who">
        <Spk speaker={speaker} report={report} who={who} />
        <RoleNote speaker={speaker} report={report} who={who} role={role} />
      </div>
      {children}
    </div>
  );
}
