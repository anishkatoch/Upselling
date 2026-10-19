import { useState } from "react";
import type { Conversation, Evidence as EvidenceT, EvidenceKind } from "../../lib/api";
import { MoodPill, RespPill, Spk, type RecCtx } from "./shared";
import { EvidenceBlock } from "./shared";

const SECTIONS: [EvidenceKind, string][] = [
  ["upsell_attempt", "Upsell attempts"],
  ["unanswered_question", "Unanswered questions"],
  ["frustration", "Frustration moments"],
  ["greeting", "Greetings"],
  ["customer_feedback", "Customer feedback"],
];

export default function EvidenceTab({ ctx }: { ctx: RecCtx }) {
  const { report: r, who, seek, gotoConversation, gotoLine } = ctx;
  const evidence = r.evidence;
  const [person, setPerson] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [openAll, setOpenAll] = useState(false);

  const people = [...new Set(evidence.map((e) => e.speaker))].sort();
  const convOf = (cid: number) => r.conversations.find((c) => c.conversation_id === cid);
  const shown = (items: EvidenceT[]) => (person ? items.filter((e) => e.speaker === person) : items);

  const total = evidence.length;
  const count = SECTIONS.reduce(
    (n, [k]) => n + (kindFilter && kindFilter !== k ? 0 : shown(evidence.filter((e) => e.kind === k)).length),
    0,
  );

  return (
    <>
      <div className="card">
        <div className="row">
          <label className="f" style={{ minWidth: 160 }}>
            Person
            <select className="sel" value={person} onChange={(e) => setPerson(e.target.value)} style={{ marginTop: 6, width: "100%" }}>
              <option value="">All people</option>
              {people.map((p) => (
                <option key={p} value={p}>
                  {who(p)}
                </option>
              ))}
            </select>
          </label>
          <label className="f" style={{ minWidth: 220 }}>
            Type
            <select className="sel" value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} style={{ marginTop: 6, width: "100%" }}>
              <option value="">All types</option>
              {SECTIONS.filter(([k]) => evidence.some((e) => e.kind === k)).map(([k, t]) => (
                <option key={k} value={k}>
                  {t} ({evidence.filter((e) => e.kind === k).length})
                </option>
              ))}
            </select>
          </label>
          <span className="sub small grow">
            Showing <b>{count}</b> of {total}
          </span>
          {(person || kindFilter) && (
            <button
              className="btn ghost"
              onClick={() => {
                setPerson("");
                setKindFilter("");
              }}
            >
              Clear filters
            </button>
          )}
          <button className="btn ghost" onClick={() => setOpenAll(!openAll)}>
            {openAll ? "Collapse all" : "Expand all"}
          </button>
        </div>
        <p className="sub small" style={{ marginTop: 10 }}>
          Every finding, grouped by type. Open a card&apos;s evidence to read the transcript lines; click a time to play that moment.
        </p>
      </div>

      {SECTIONS.map(([kind, title]) => {
        if (kindFilter && kindFilter !== kind) return null;
        const items = shown(evidence.filter((e) => e.kind === kind)).sort((a, b) => a.conversation_id - b.conversation_id || a.index - b.index);
        if (items.length === 0) return null;
        return (
          <div key={kind} style={{ marginTop: 22 }}>
            <h2>
              {title} <span className="sub small" style={{ fontWeight: 400 }}>({items.length})</span>
            </h2>
            <div className="stack">
              {items.map((ev) => {
                const conv = convOf(ev.conversation_id);
                return (
                  <div className="card" key={`${ev.conversation_id}:${ev.kind}:${ev.index}`}>
                    <button className="link small" style={{ marginBottom: 8 }} onClick={() => gotoConversation(ev.conversation_id)}>
                      conversation #{ev.conversation_id} · {conv?.topic ?? ""} →
                    </button>
                    <Detail kind={kind} conv={conv} ev={ev} ctx={ctx} />
                    <EvidenceBlock ev={ev} report={r} seek={seek} gotoLine={gotoLine} who={who} compact openAll={openAll} />
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {count === 0 && (
        <div className="card empty" style={{ marginTop: 22 }}>
          <b>Nothing found</b>
          <p>{person || kindFilter ? "No findings match these filters." : "No findings in this recording."}</p>
        </div>
      )}
    </>
  );
}

function Detail({ kind, conv, ev, ctx }: { kind: EvidenceKind; conv: Conversation | undefined; ev: EvidenceT; ctx: RecCtx }) {
  const { report: r, who } = ctx;
  const u = conv?.upsell;
  if (kind === "upsell_attempt") {
    const a = u?.upsell_attempts[ev.index];
    if (!a) return null;
    return (
      <>
        <div className="row">
          <Spk speaker={a.salesperson} report={r} who={who} />
          <span className="quote">&ldquo;{a.quote}&rdquo;</span>
        </div>
        <div className="row" style={{ gap: 6, marginTop: 6 }}>
          <span className="pill info">{a.technique.replace(/_/g, " ")}</span>
          {a.offered_item && <span className="pill neutral">{a.offered_item}</span>}
          <RespPill r={a.customer_response} />
          <MoodPill m={a.customer_mood} />
          {a.after_customer_rejection && <span className="pill warn">after a &ldquo;no&rdquo;</span>}
          {a.handled_objection && <span className="pill neutral">handled objection</span>}
        </div>
      </>
    );
  }
  if (kind === "unanswered_question") {
    const q = u?.unanswered_questions[ev.index];
    if (!q) return null;
    return (
      <>
        <div className="row">
          <Spk speaker={q.speaker} report={r} who={who} />
          <span className="quote">&ldquo;{q.question}&rdquo;</span>
        </div>
        <p className="sub small" style={{ marginTop: 4 }}>{q.note}</p>
      </>
    );
  }
  if (kind === "frustration") {
    const m = conv?.mood?.frustration_moments[ev.index];
    if (!m) return null;
    return (
      <>
        <div className="row">
          <Spk speaker={m.speaker} report={r} who={who} />
          <span className="quote">&ldquo;{m.quote}&rdquo;</span>
        </div>
        <p className="sub small" style={{ marginTop: 4 }}>
          {m.evidence} <span className="pill neutral">{m.evidence_source}</span>
        </p>
      </>
    );
  }
  if (kind === "greeting") {
    return (
      <div className="row">
        <Spk speaker={ev.speaker} report={r} who={who} />
        <span className="quote">&ldquo;{u?.greeting_quote ?? ""}&rdquo;</span>
      </div>
    );
  }
  if (kind === "customer_feedback") {
    return (
      <div className="row">
        <Spk speaker={ev.speaker} report={r} who={who} />
        <span>{u?.customer_feedback ?? ""}</span>
        <span className="pill neutral">paraphrased</span>
      </div>
    );
  }
  return null;
}
