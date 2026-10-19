import { useState } from "react";
import type { CallOutcome } from "../../lib/api";
import { AlertTriangle, Check, ChevronRight, TrendDown, TrendUp } from "../../icons/Icons";
import { clock, pct, RESULT, SENTIMENT, technique } from "../../lib/format";
import { RespPill, Spk, TimeBtn, type RecCtx } from "./shared";

/** Same "what needs a look first" rule as Conversations: a call that read negative overall, or
 * where the customer got visibly frustrated, starts expanded - everything else starts closed. */
function needsAttention(c: CallOutcome): boolean {
  return c.sentiment === "negative" || (c.customer_max_frustration ?? 0) >= 6;
}

export default function Outcomes({ ctx }: { ctx: RecCtx }) {
  const { outcomes: o, report: r, who, seek, segById } = ctx;
  const tried = o.by_salesperson.reduce((n, p) => n + p.tried, 0);
  const accepted = o.by_salesperson.reduce((n, p) => n + p.accepted, 0);

  const [open, setOpen] = useState<Set<number>>(
    () => new Set(o.calls.filter(needsAttention).map((c) => c.conversation_id)),
  );
  function toggle(id: number) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <>
      <div className="kpis">
        <Kpi icon={<Check size={15} />} label="Positive calls" value={o.positive} tone="good" />
        <Kpi icon={<AlertTriangle size={15} />} label="Negative calls" value={o.negative} tone="bad" />
        <Kpi icon={<TrendUp size={15} />} label="Upsells won" value={o.won} />
        <Kpi icon={<TrendDown size={15} />} label="Upsells lost" value={o.lost} />
        <Kpi icon={<Check size={15} />} label="Offers accepted" value={`${accepted} of ${tried}`} />
      </div>
      <p className="sub small" style={{ margin: "12px 2px 0" }}>
        Calls are rated from the customer&apos;s side: how frustrated they got, whether they accepted anything, pushiness and
        unanswered questions. It&apos;s an estimate from the findings, not a record of what was bought.
      </p>

      <h2 style={{ marginTop: 22 }}>What each salesperson tried to sell</h2>
      {o.by_salesperson.length === 0 && <p className="sub">No upsell offers were made in this recording.</p>}
      <div className="stack">
        {o.by_salesperson.map((p) => (
          <div className="card" key={p.speaker}>
            <div className="row">
              <Spk speaker={p.speaker} report={r} who={who} />
              <span className="pill neutral">
                {p.tried} offer{p.tried === 1 ? "" : "s"}
              </span>
              <span className="pill good">{p.accepted} accepted</span>
              <span className="pill bad">{p.rejected} declined</span>
              {p.open > 0 && <span className="pill warn">{p.open} undecided</span>}
              <span className="pill info" title="accepted ÷ (accepted + declined)">
                success {pct(p.success_rate)}
              </span>
            </div>
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table>
                <thead>
                  <tr>
                    <th>What they tried to sell</th>
                    <th className="num">Times offered</th>
                    <th className="num">Accepted</th>
                  </tr>
                </thead>
                <tbody>
                  {p.items.map((i) => (
                    <tr key={i.item}>
                      <td>{i.item}</td>
                      <td className="num">{i.tried}</td>
                      <td className="num">{i.accepted ? <span className="pill good">{i.accepted}</span> : "0"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      <h2 style={{ marginTop: 22 }}>Every call</h2>
      {o.calls.length === 0 && <p className="sub">No sales conversations found.</p>}
      {o.calls.length > 0 && (
        <div className="conv-list">
          {o.calls.map((c) => {
            const s = SENTIMENT[c.sentiment];
            const res = RESULT[c.upsell_result];
            const isOpen = open.has(c.conversation_id);
            return (
              <div className={`conv-row ${isOpen ? "open" : ""}`} key={c.conversation_id}>
                <button className="call-head" onClick={() => toggle(c.conversation_id)}>
                  <span className={`sent-bar ${s.tone}`} />
                  <span className="grow">
                    <b>
                      #{c.conversation_id} {c.topic}
                    </b>
                    <div className="sub small" style={{ marginTop: 3 }}>
                      {clock(c.start)}&ndash;{clock(c.end)}
                    </div>
                  </span>
                  <span className="row" style={{ gap: 6, flexWrap: "wrap", justifyContent: "flex-end", flex: "0 1 auto" }}>
                    <span className={`pill ${s.tone}`} title="Overall feel of the call">
                      {c.sentiment} call
                    </span>
                    <span className={`pill ${res.tone}`}>{res.label}</span>
                  </span>
                  <span className="chev-wrap">
                    <ChevronRight size={16} />
                  </span>
                </button>

                {isOpen && (
                  <div className="call-body">
                    <div className="row sub small">
                      <TimeBtn t={c.start} seek={seek} /> <span>to {clock(c.end)}</span>
                      {c.salespeople.length > 0 && <span>· sales: {c.salespeople.map((p) => who(p)).join(", ")}</span>}
                      {c.products_discussed.length > 0 && <span>· discussed: {c.products_discussed.join(", ")}</span>}
                    </div>
                    <ul className="plain small" style={{ marginTop: 10 }}>
                      {c.sentiment_reasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                    {c.pitched.length > 0 ? (
                      <div className="table-wrap" style={{ marginTop: 10 }}>
                        <table>
                          <thead>
                            <tr>
                              <th>When</th>
                              <th>Offered</th>
                              <th>Approach</th>
                              <th>Customer&apos;s answer</th>
                              <th></th>
                            </tr>
                          </thead>
                          <tbody>
                            {c.pitched.map((p, i) => {
                              const start = segById.get(p.segment_id)?.start;
                              return (
                                <tr key={i}>
                                  <td>{start != null ? <TimeBtn t={start} seek={seek} /> : `#${p.segment_id}`}</td>
                                  <td>
                                    <b>{p.item}</b>
                                    <div className="quote small">&ldquo;{p.quote}&rdquo;</div>
                                  </td>
                                  <td>
                                    <span className="pill info">{technique(p.technique)}</span>
                                    {p.after_rejection && <span className="pill warn" style={{ marginLeft: 5 }}>after a &ldquo;no&rdquo;</span>}
                                  </td>
                                  <td>
                                    <RespPill r={p.response} />
                                  </td>
                                  <td>
                                    <button className="link small" onClick={() => ctx.gotoLine(p.segment_id)}>
                                      Transcript →
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="sub small" style={{ marginTop: 10 }}>
                        No upsell was pitched in this conversation.
                      </p>
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

function Kpi({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string | number; tone?: "good" | "bad" }) {
  return (
    <div className="kpi">
      <span className="kpi-ico">{icon}</span>
      <span>{label}</span>
      <b style={tone === "good" ? { color: "var(--good)" } : tone === "bad" ? { color: "var(--bad)" } : undefined}>{value}</b>
    </div>
  );
}
