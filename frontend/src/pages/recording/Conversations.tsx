import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Conversation } from "../../lib/api";
import AiBadge from "../../components/AiBadge";
import { ChevronRight } from "../../icons/Icons";
import { clock, technique } from "../../lib/format";
import { moodFromFrustration } from "../../lib/teamLabels";
import { EASE } from "../../lib/motion";
import { canon, convWho, type RecCtx } from "./shared";
import "./conversations.css";

/** Needs a look first: pushy, a customer who said no, could not be fully analysed, or clearly frustrated. */
function needsAttention(c: Conversation): boolean {
  const frust = (c.mood?.speakers ?? []).map((m) => m.frustration_level);
  const maxFrust = frust.length ? Math.max(...frust) : 0;
  const saidNo = (c.upsell?.upsell_attempts ?? []).some((a) => a.customer_response === "rejected");
  return Boolean(c.upsell?.pushy_upsell) || Boolean(c.budget_note) || maxFrust >= 6 || saidNo;
}

function outcome(c: Conversation): { text: string; tone: "good" | "bad" | "warn" | "none" } {
  const at = c.upsell?.upsell_attempts ?? [];
  if (at.length === 0) return { text: "No upsell offered", tone: "none" };
  if (at.some((a) => a.customer_response === "accepted")) return { text: "Customer said yes", tone: "good" };
  if (at.some((a) => a.customer_response === "rejected")) return { text: "Customer said no", tone: "bad" };
  return { text: "Offer left unanswered", tone: "warn" };
}

interface Moment {
  key: string;
  t: number;
  order: number;
  kind: "offer" | "bad" | "plain" | "mute";
  title: string;
  tag?: string;
  quote?: string;
  reply?: { text: string; after?: boolean };
  seg?: number | null;
}

function buildMoments(c: Conversation, segTime: (id: number) => number | undefined): Moment[] {
  const u = c.upsell;
  const out: Moment[] = [];
  const time = (seg: number | null | undefined, fb: number) => (seg != null ? segTime(seg) : undefined) ?? fb;
  if (u) {
    if (u.greeting_given)
      out.push({ key: "greet", t: time(u.greeting_segment_id, c.start), order: 0, kind: "plain", title: "Greeted the customer", quote: u.greeting_quote ?? undefined, seg: u.greeting_segment_id });
    else out.push({ key: "greet", t: c.start, order: 0, kind: "mute", title: "No greeting" });
    u.upsell_attempts.forEach((a, n) => {
      const reply =
        a.customer_response === "accepted" ? "Customer said yes" : a.customer_response === "rejected" ? "Customer said no" : a.customer_response === "undecided" ? "Customer was unsure" : "Customer did not reply";
      out.push({
        key: `up${n}`, t: time(a.segment_id, c.start), order: 1, kind: "offer", title: "Offered an upgrade", tag: technique(a.technique) === "Offered an upgrade" ? undefined : technique(a.technique), quote: a.quote,
        reply: { text: reply, after: a.after_customer_rejection }, seg: a.segment_id,
      });
    });
    u.unanswered_questions.forEach((q, n) =>
      out.push({ key: `q${n}`, t: time(q.segment_id, c.start), order: 1, kind: "plain", title: "Customer asked and didn't get an answer", quote: q.question, seg: q.segment_id }),
    );
    if (u.customer_feedback)
      out.push({ key: "fb", t: time(u.customer_feedback_segment_id, c.end), order: 1, kind: "plain", title: "Customer feedback", quote: u.customer_feedback, seg: u.customer_feedback_segment_id });
  }
  (c.mood?.frustration_moments ?? []).forEach((m, n) =>
    out.push({ key: `f${n}`, t: time(m.segment_id, c.start), order: 1, kind: "bad", title: "Customer sounded frustrated", quote: m.quote, seg: m.segment_id }),
  );
  const seen = new Set<string>();
  const uniq = [...out].sort((a, b) => Number(b.kind === "bad") - Number(a.kind === "bad")).filter((m) => {
    if (m.seg == null || !m.quote) return true;
    const k = `${m.seg}|${m.quote}`;
    return !seen.has(k) && (seen.add(k), true);
  });
  return uniq.sort((a, b) => a.t - b.t || a.order - b.order);
}

function ConversationBody({ c, ctx }: { c: Conversation; ctx: RecCtx }) {
  const { report: r, who, segById, gotoLine } = ctx;
  const u = c.upsell;
  const cw = convWho(r, who, c.conversation_id);
  const moments = buildMoments(c, (id) => segById.get(id)?.start);
  const custKeys = new Set(c.customers.map(canon));
  const customerMoods = (c.mood?.speakers ?? []).filter((m) => custKeys.has(canon(m.speaker)));
  const lang = c.language === "other" ? "another language" : c.language ? c.language.charAt(0).toUpperCase() + c.language.slice(1) : "";
  const sales = c.salespeople.map((p) => who(p)).join(", ");
  const meta = [sales && `Salesperson: ${sales}`, lang && `spoken in ${lang}`].filter(Boolean).join(" - ");

  return (
    <div className="cv-body">
      {meta && <p className="cv-meta">{meta}</p>}
      {u && u.confidence < 0.6 && <p className="cv-low">Low confidence - check the transcript</p>}
      {c.budget_note && !u && <p className="cv-text">This conversation could not be fully analysed, so no findings are shown for it.</p>}

      {u?.summary && (
        <section className="cv-sec">
          <h4 className="cv-label">What happened <AiBadge /></h4>
          <p className="cv-text">{u.summary}</p>
        </section>
      )}

      {moments.length > 0 && (
        <section className="cv-sec">
          <h4 className="cv-label">Key moments</h4>
          <motion.ol className="cv-moments" initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.04, delayChildren: 0.05 } } }}>
            {moments.map((m) => (
              <motion.li
                key={m.key}
                className={`cv-moment ${m.kind === "offer" ? "cv-offer" : m.kind}`}
                variants={{ hidden: { opacity: 0, y: 6 }, show: { opacity: 1, y: 0, transition: { duration: 0.25, ease: EASE } } }}
              >
                <div className="cv-mhead">
                  <button type="button" className="link cv-mtime" aria-label={`Play ${m.title} at ${clock(m.t)}`} onClick={() => ctx.seek(Math.max(0, m.t - 3))}>{clock(m.t)}</button>
                  <span>
                    <span className="cv-mtitle">{m.title}</span>
                    {m.tag && <span className="cv-mtag"> - {m.tag}</span>}
                  </span>
                </div>
                {m.quote && <p className="cv-mquote">&ldquo;{m.quote}&rdquo;</p>}
                {m.reply && (
                  <p className="cv-mreply">
                    {m.reply.text} {m.reply.after && <span>(after already saying no)</span>}
                  </p>
                )}
                {m.seg != null && (
                  <button type="button" className="cv-link" onClick={() => gotoLine(m.seg!)}>
                    Read in transcript
                  </button>
                )}
              </motion.li>
            ))}
          </motion.ol>
        </section>
      )}

      {customerMoods.length > 0 && (
        <section className="cv-sec">
          <h4 className="cv-label">How the customer felt</h4>
          {customerMoods.map((m) => {
            const lab = moodFromFrustration(m.frustration_level);
            return (
              <div className="cv-felt" key={m.speaker}>
                <div className="cv-felt-line">
                  <span className={`cv-flag ${lab.tone === "neutral" ? "none" : lab.tone}`}><i /></span>
                  <span>
                    {customerMoods.length > 1 && <>{cw(canon(m.speaker))}: </>}
                    <b>{lab.label}</b>
                  </span>
                </div>
                {m.summary && <p>{m.summary}</p>}
              </div>
            );
          })}
        </section>
      )}

      {u?.coaching_feedback && (
        <section className="cv-sec">
          <h4 className="cv-label">Coaching <AiBadge /></h4>
          <p className="cv-note">{u.coaching_feedback}</p>
        </section>
      )}

      {u && u.excluded_candidates.length > 0 && (
        <section className="cv-sec">
          <details className="cv-more">
            <summary>Offers we did not count ({u.excluded_candidates.length})</summary>
            <ul>
              {u.excluded_candidates.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </details>
        </section>
      )}
    </div>
  );
}

export default function Conversations({ ctx, scrollTo, onScrolled }: { ctx: RecCtx; scrollTo: number | null; onScrolled: () => void }) {
  const { report: r, gotoConversation } = ctx;
  const refs = useRef<Record<number, HTMLDivElement | null>>({});

  const [open, setOpen] = useState<Set<number>>(() => {
    if (scrollTo != null) return new Set([scrollTo]);
    const first = r.conversations.find(needsAttention) ?? r.conversations[0];
    return new Set(first ? [first.conversation_id] : []);
  });
  const [flashId, setFlashId] = useState<number | null>(null);

  function toggle(id: number) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  useEffect(() => {
    if (scrollTo == null) return;
    setOpen((prev) => (prev.has(scrollTo) ? prev : new Set(prev).add(scrollTo)));
    setFlashId(scrollTo);
    const el = refs.current[scrollTo];
    if (el) el.scrollIntoView({ block: "start" });
    const t = setTimeout(() => setFlashId((id) => (id === scrollTo ? null : id)), 1600);
    onScrolled();
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollTo]);

  return (
    <>
      {r.conversations.length > 1 && (
        <div className="conv-nav">
          <span className="sub small">Jump to</span>
          {r.conversations.map((c) => (
            <button key={c.conversation_id} className="chip link" onClick={() => gotoConversation(c.conversation_id)}>
              #{c.conversation_id} {c.topic}
            </button>
          ))}
        </div>
      )}

      {r.conversations.length === 0 && <div className="card empty">No conversations found.</div>}

      {r.conversations.length > 0 && (
        <div className="cv-list">
          {r.conversations.map((c) => {
            const isOpen = open.has(c.conversation_id);
            const o = outcome(c);
            const panel = `cv-panel-${c.conversation_id}`;
            return (
              <div
                className={`cv-item ${isOpen ? "open" : ""} ${flashId === c.conversation_id ? "flash" : ""}`}
                key={c.conversation_id}
                ref={(el) => {
                  refs.current[c.conversation_id] = el;
                }}
              >
                <button type="button" className="cv-head" aria-expanded={isOpen} aria-controls={panel} onClick={() => toggle(c.conversation_id)}>
                  <span className="cv-chev"><ChevronRight size={16} /></span>
                  <span className="cv-title">
                    <b>#{c.conversation_id} {c.topic}</b>
                    <span className="cv-time">{clock(c.start)}&ndash;{clock(c.end)}</span>
                  </span>
                  <span className="cv-flags">
                    {c.budget_note ? (
                      <span className="cv-flag warn"><i />Could not be fully analysed</span>
                    ) : (
                      <span className={`cv-flag ${o.tone}`}><i />{o.text}</span>
                    )}
                    {c.upsell?.pushy_upsell && <span className="cv-flag bad pushy" title={c.upsell.pushy_reason}><i />Pushy</span>}
                  </span>
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      id={panel}
                      className="cv-clip"
                      key="body"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: EASE }}
                    >
                      <ConversationBody c={c} ctx={ctx} />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
