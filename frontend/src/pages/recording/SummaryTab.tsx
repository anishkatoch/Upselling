import { AlertTriangle, Check } from "../../icons/Icons";
import { canon, TimeBtn, type RecCtx } from "./shared";

interface Note {
  sev: "bad" | "warn" | "good";
  title: string;
  conv?: number;
  text: string;
}

export default function SummaryTab({ ctx }: { ctx: RecCtx }) {
  const { report: r, who, seek, gotoConversation } = ctx;
  const sales = r.conversations.filter((c) => c.is_sales_interaction);
  const notes: Note[] = [];

  const greetedCount = sales.filter((c) => c.upsell?.greeting_given).length;
  if (sales.length && greetedCount < sales.length) {
    notes.push({
      sev: "warn",
      title: "Missed greetings",
      text: `Greeted the customer in only ${greetedCount} of ${sales.length} sales conversation${sales.length === 1 ? "" : "s"}.`,
    });
  }
  sales.forEach((c) => {
    const t = `#${c.conversation_id} ${c.topic}`;
    if (c.budget_note) notes.push({ sev: "warn", title: "Analysis incomplete", conv: c.conversation_id, text: `${t}: this conversation could not be fully analysed, so upsell findings are missing.` });
    if (c.upsell?.pushy_upsell) notes.push({ sev: "bad", title: "Pushy upselling", conv: c.conversation_id, text: `${t}: ${c.upsell.pushy_reason}` });
    (c.upsell?.unanswered_questions ?? []).forEach((q) =>
      notes.push({ sev: "warn", title: `Unanswered question from ${who(q.speaker)}`, conv: c.conversation_id, text: `${t}: "${q.question}"` }),
    );
    (c.mood?.speakers ?? []).forEach((m) => {
      const role = r.speakers.find((s) => s.speaker === canon(m.speaker))?.role;
      if (m.frustration_level >= 6 && role === "customer") {
        notes.push({ sev: "bad", title: `${who(m.speaker)} highly frustrated (${m.frustration_level}/10)`, conv: c.conversation_id, text: `${t}: ${m.summary}` });
      }
    });
  });

  const bad = notes.filter((n) => n.sev === "bad").length;
  const warn = notes.filter((n) => n.sev === "warn").length;
  const good = sales.filter((c) => !c.upsell?.pushy_upsell && c.upsell?.greeting_given).length;

  return (
    <>
      <div className="glance">
        <div className="stat bad">
          <b>{bad}</b>
          <span>need attention</span>
        </div>
        <div className="stat warn">
          <b>{warn}</b>
          <span>worth a look</span>
        </div>
        <div className="stat good">
          <b>{good}</b>
          <span>
            of {sales.length} conversation{sales.length === 1 ? "" : "s"} greeted &amp; not pushy
          </span>
        </div>
      </div>

      <h2>Points to note</h2>
      <ul className="notes">
        {notes.length === 0 && (
          <li className="note good">
            <span className="note-ico">
              <Check size={14} />
            </span>
            <div>
              <div className="note-head">
                <b>All clear</b>
              </div>
              <div className="note-text">Greetings given, no pushy upselling, no unanswered questions, frustration stayed low.</div>
            </div>
          </li>
        )}
        {notes.map((n, i) => (
          <li className={`note ${n.sev}`} key={i}>
            <span className="note-ico">
              <AlertTriangle size={14} />
            </span>
            <div>
              <div className="note-head">
                <b>{n.title}</b>
                {n.conv != null && (
                  <button className="link small" onClick={() => gotoConversation(n.conv!)}>
                    View conversation →
                  </button>
                )}
              </div>
              <div className="note-text">{n.text}</div>
            </div>
          </li>
        ))}
      </ul>

      <h2 style={{ marginTop: 24 }}>Conversation summaries</h2>
      {r.conversations.length === 0 && <p className="sub">No conversations found.</p>}
      <div className="stack">
        {r.conversations.map((c) => {
          const text =
            c.upsell?.summary ??
            (c.budget_note
              ? "Mood was assessed, but the upsell analysis is incomplete - see Points to note above."
              : c.is_sales_interaction
                ? "No upsell activity to report."
                : "Not a sales interaction.");
          return (
            <div className="card" key={c.conversation_id}>
              <div className="row">
                <h3 style={{ fontSize: 15.5, flex: 1 }}>
                  #{c.conversation_id} {c.topic}
                </h3>
                {c.attempted_upsell && <span className="pill good">upsell attempted</span>}
                <TimeBtn t={c.start} seek={seek} />
                <span className="sub small">to {Math.round(c.end)}s</span>
              </div>
              <p style={{ marginTop: 10 }}>{text}</p>
              {c.upsell?.coaching_feedback && (
                <div className="tip" style={{ marginTop: 10 }}>
                  <b>Coaching:</b> {c.upsell.coaching_feedback}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
