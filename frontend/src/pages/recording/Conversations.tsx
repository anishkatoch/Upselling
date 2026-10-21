import { useEffect, useRef, useState } from "react";
import type { Conversation } from "../../lib/api";
import { ChevronRight, Check } from "../../icons/Icons";
import { clock, technique } from "../../lib/format";
import { EvidenceBlock, Meter, MoodPill, RespPill, RoleNote, Spk, TimeBtn, type RecCtx } from "./shared";

/** A conversation needs eyes-on-it immediately if it went pushy, could not be fully analysed, or
 * left someone noticeably frustrated - those rows start expanded, everything else starts closed. */
function needsAttention(c: Conversation): boolean {
  const frustLevels = (c.mood?.speakers ?? []).map((m) => m.frustration_level);
  const maxFrust = frustLevels.length ? Math.max(...frustLevels) : 0;
  return Boolean(c.upsell?.pushy_upsell) || Boolean(c.budget_note) || maxFrust >= 6;
}

export default function Conversations({ ctx, scrollTo, onScrolled }: { ctx: RecCtx; scrollTo: number | null; onScrolled: () => void }) {
  const { report: r, who, seek, evBy, gotoConversation, segById } = ctx;
  const refs = useRef<Record<number, HTMLDivElement | null>>({});
  const segTime = (id: number) => segById.get(id)?.start;

  const [open, setOpen] = useState<Set<number>>(
    () => new Set(r.conversations.filter(needsAttention).map((c) => c.conversation_id)),
  );
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
        <div className="conv-list">
          {r.conversations.map((c) => {
            const u = c.upsell;
            const isOpen = open.has(c.conversation_id);
            const sentCls = u?.pushy_upsell ? "bad" : c.attempted_upsell ? "good" : "neutral";
            return (
              <div
                className={`conv-row ${isOpen ? "open" : ""} ${flashId === c.conversation_id ? "flash" : ""}`}
                key={c.conversation_id}
                ref={(el) => {
                  refs.current[c.conversation_id] = el;
                }}
              >
                <button className="call-head" onClick={() => toggle(c.conversation_id)}>
                  <span className={`sent-bar ${sentCls}`} />
                  <span className="grow">
                    <b>
                      #{c.conversation_id} {c.topic}
                    </b>
                    <div className="sub small" style={{ marginTop: 3 }}>
                      {clock(c.start)}&ndash;{clock(c.end)}
                    </div>
                  </span>
                  <span className="row" style={{ gap: 6, flexWrap: "wrap", justifyContent: "flex-end", flex: "0 1 auto" }}>
                    {c.is_sales_interaction ? (
                      c.attempted_upsell ? (
                        <span className="pill good">upsell attempted</span>
                      ) : (
                        <span className="pill neutral">no upsell</span>
                      )
                    ) : (
                      <span className="pill neutral">not a sale</span>
                    )}
                    {u?.pushy_upsell && (
                      <span className="pill bad" title={u.pushy_reason}>
                        pushy
                      </span>
                    )}
                    {c.budget_note && (
                      <span className="pill bad" title="Part of this conversation could not be analysed">
                        analysis incomplete
                      </span>
                    )}
                    {u && (
                      <span className="pill neutral" title="Confidence in this finding">
                        {Math.round(u.confidence * 100)}% sure
                      </span>
                    )}
                  </span>
                  <span className="chev-wrap">
                    <ChevronRight size={16} />
                  </span>
                </button>

                {isOpen && (
                  <div className="call-body">
                    <div className="row sub small">
                      <TimeBtn t={c.start} seek={seek} />
                      <span>
                        to {clock(c.end)} · {c.language}
                      </span>
                      {c.salespeople.length > 0 && <span>· sales: {c.salespeople.map((p) => who(p)).join(", ")}</span>}
                      {c.customers.length > 0 && <span>· customers: {c.customers.map((p) => who(p)).join(", ")}</span>}
                    </div>

                    {c.budget_note && !u && (
                      <p className="error" style={{ marginTop: 10 }}>
                        This conversation could not be fully analysed, so no upsell findings are shown for it.
                      </p>
                    )}

                    {u && (
                      <>
                        <p style={{ marginTop: 10 }}>{u.summary}</p>
                        <div className="effort" style={{ marginTop: 8 }}>
                          Effort {c.effort_score}/10
                          <div className="bar">
                            <i style={{ width: `${c.effort_score * 10}%` }} />
                          </div>
                          {u.customer_requested.length > 0 && <span>· asked for: {u.customer_requested.join(", ")}</span>}
                        </div>

                        <div className="tip" style={{ marginTop: 12 }}>
                          <div className="row">
                            {u.greeting_given ? (
                              <span className="pill good">
                                <Check size={12} /> greeted
                              </span>
                            ) : (
                              <span className="pill warn">no greeting detected</span>
                            )}
                            {u.products_discussed.length > 0 && <span className="sub small">Discussed: {u.products_discussed.join(", ")}</span>}
                          </div>
                          {u.greeting_given &&
                            (evBy.get(`${c.conversation_id}:greeting:0`) ? (
                              <EvidenceBlock
                                ev={evBy.get(`${c.conversation_id}:greeting:0`)}
                                report={r}
                                seek={seek}
                                gotoLine={ctx.gotoLine}
                                who={who}
                                compact
                              />
                            ) : (
                              <p className="sub small" style={{ marginTop: 6 }}>
                                Greeting detected, but no quote was captured to show as evidence.
                              </p>
                            ))}
                          {u.customer_feedback && (
                            <>
                              <p style={{ marginTop: 10 }}>
                                <b>Customer feedback:</b> {u.customer_feedback}
                              </p>
                              {evBy.get(`${c.conversation_id}:customer_feedback:0`) ? (
                                <EvidenceBlock
                                  ev={evBy.get(`${c.conversation_id}:customer_feedback:0`)}
                                  report={r}
                                  seek={seek}
                                  gotoLine={ctx.gotoLine}
                                  who={who}
                                  compact
                                />
                              ) : (
                                <p className="sub small" style={{ marginTop: 6 }}>
                                  No specific transcript line was cited for this feedback.
                                </p>
                              )}
                            </>
                          )}
                          <p style={{ marginTop: 10 }}>
                            <b>Coaching:</b> {u.coaching_feedback}
                          </p>
                        </div>
                      </>
                    )}

                    {c.mood && c.mood.speakers.length > 0 && (
                      <div className="stack" style={{ marginTop: 14 }}>
                        {c.mood.speakers.map((m) => {
                          const hasMoment = c.mood!.frustration_moments.some((fm) => fm.speaker === m.speaker);
                          return (
                            <div className="mood" key={m.speaker}>
                              <div className="row">
                                <Spk speaker={m.speaker} report={r} who={who} />
                                <RoleNote speaker={m.speaker} report={r} who={who} />
                                <span className="grow" />
                                <MoodPill m={m.overall_mood} />
                              </div>
                              <Meter level={m.frustration_level} />
                              <div className="sub small">
                                Frustration {m.frustration_level}/10 · {m.trend} — {m.summary}
                              </div>
                              {m.frustration_level >= 3 && !hasMoment && (
                                <p className="sub small" style={{ marginTop: 4 }}>
                                  No specific frustration moment was flagged for this score - see the summary above.
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {u && u.upsell_attempts.length > 0 && (
                      <>
                        <h3 className="eyebrow" style={{ marginTop: 18 }}>
                          Upsell attempts
                        </h3>
                        {u.upsell_attempts.map((a, n) => (
                          <div className="attempt" key={n}>
                            <div className="row">
                              {segTime(a.segment_id) != null ? (
                                <TimeBtn t={segTime(a.segment_id)!} seek={seek} />
                              ) : (
                                <span className="sub small">#{a.segment_id}</span>
                              )}
                            </div>
                            <div>
                              <Spk speaker={a.salesperson} report={r} who={who} /> <span className="quote">&ldquo;{a.quote}&rdquo;</span>
                              <div className="tags">
                                <span className="pill info">{technique(a.technique)}</span>
                                <span className="pill neutral">{a.offered_item}</span>
                                <RespPill r={a.customer_response} />
                                <MoodPill m={a.customer_mood} />
                                {a.after_customer_rejection && <span className="pill warn">after a &ldquo;no&rdquo;</span>}
                                {a.handled_objection && <span className="pill neutral">handled objection</span>}
                              </div>
                              <EvidenceBlock ev={evBy.get(`${c.conversation_id}:upsell_attempt:${n}`)} report={r} seek={seek} gotoLine={ctx.gotoLine} who={who} compact />
                            </div>
                          </div>
                        ))}
                      </>
                    )}

                    {u && u.unanswered_questions.length > 0 && (
                      <>
                        <h3 className="eyebrow" style={{ marginTop: 18 }}>
                          Unanswered questions
                        </h3>
                        {u.unanswered_questions.map((q, n) => (
                          <div className="attempt" key={n}>
                            <div className="row">{segTime(q.segment_id) != null && <TimeBtn t={segTime(q.segment_id)!} seek={seek} />}</div>
                            <div>
                              <Spk speaker={q.speaker} report={r} who={who} /> <span className="quote">&ldquo;{q.question}&rdquo;</span>
                              <div className="sub small" style={{ marginTop: 4 }}>{q.note}</div>
                              <EvidenceBlock
                                ev={evBy.get(`${c.conversation_id}:unanswered_question:${n}`)}
                                report={r}
                                seek={seek}
                                gotoLine={ctx.gotoLine}
                                who={who}
                                compact
                              />
                            </div>
                          </div>
                        ))}
                      </>
                    )}

                    {c.mood && c.mood.frustration_moments.length > 0 && (
                      <>
                        <h3 className="eyebrow" style={{ marginTop: 18 }}>
                          Frustration moments
                        </h3>
                        {c.mood.frustration_moments.map((m, n) => (
                          <div className="attempt" key={n}>
                            <div className="row">{segTime(m.segment_id) != null && <TimeBtn t={segTime(m.segment_id)!} seek={seek} />}</div>
                            <div>
                              <Spk speaker={m.speaker} report={r} who={who} /> <span className="quote">&ldquo;{m.quote}&rdquo;</span>
                              <div className="sub small" style={{ marginTop: 4 }}>
                                {m.evidence} <span className="pill neutral">{m.evidence_source}</span>
                              </div>
                              <EvidenceBlock ev={evBy.get(`${c.conversation_id}:frustration:${n}`)} report={r} seek={seek} gotoLine={ctx.gotoLine} who={who} compact />
                            </div>
                          </div>
                        ))}
                      </>
                    )}

                    {u && u.excluded_candidates.length > 0 && (
                      <details style={{ marginTop: 14 }}>
                        <summary className="sub small">Not counted as upsell ({u.excluded_candidates.length})</summary>
                        <ul className="plain small" style={{ marginTop: 8 }}>
                          {u.excluded_candidates.map((x) => (
                            <li key={x}>{x}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
