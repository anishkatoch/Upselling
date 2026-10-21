import { useState } from "react";
import { Check, Headset, Minus, TrendUp } from "../../icons/Icons";
import { clock, pct } from "../../lib/format";
import { canon, type RecCtx, Spk, colorFor } from "./shared";

export default function Overview({ ctx }: { ctx: RecCtx }) {
  const { report: r, who } = ctx;
  const sales = r.conversations.filter((c) => c.is_sales_interaction);
  const withUpsell = sales.filter((c) => c.attempted_upsell).length;
  const attempts = sales.reduce((n, c) => n + (c.upsell?.upsell_attempts.length ?? 0), 0);
  const unanswered = sales.reduce((n, c) => n + (c.upsell?.unanswered_questions.length ?? 0), 0);
  const greeted = sales.filter((c) => c.upsell?.greeting_given).length;
  const custFrust = r.conversations
    .flatMap((c) => c.mood?.speakers ?? [])
    .filter((m) => r.speakers.find((s) => s.speaker === canon(m.speaker))?.role === "customer")
    .map((m) => m.frustration_level);
  const avgFrust = custFrust.length ? (custFrust.reduce((a, b) => a + b, 0) / custFrust.length).toFixed(1) : "–";
  const maxTalk = Math.max(1, ...r.speakers.map((s) => s.talk_time_s));

  const [fullBreakdown, setFullBreakdown] = useState(false);
  const [showSpeakers, setShowSpeakers] = useState(false);

  return (
    <>
      <div className="kpis">
        <Kpi icon={<Headset size={15} />} label="Sales conversations" value={sales.length} />
        <Kpi icon={<TrendUp size={15} />} label="Tried to upsell" value={sales.length ? pct(withUpsell / sales.length) : "–"} />
        <Kpi icon={<TrendUp size={15} />} label="Upsell offers made" value={attempts} />
        <Kpi icon={<Check size={15} />} label="Greeted the customer" value={sales.length ? pct(greeted / sales.length) : "–"} />
        <Kpi icon={<Minus size={15} />} label="Unanswered questions" value={unanswered} />
        <Kpi icon={<Headset size={15} />} label="Customer frustration (0 is calm)" value={`${avgFrust} / 10`} />
      </div>

      <h2 style={{ marginTop: 28 }}>Salespeople</h2>
      {r.salespeople.length > 0 ? (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Salesperson</th>
                  <th className="num">Tries to upsell</th>
                  {fullBreakdown && (
                    <>
                      <th className="num">Conversations</th>
                      <th className="num">Offers made</th>
                      <th className="num">Selling effort</th>
                      <th className="num">Talk time on upsells</th>
                      <th className="num">Customers said yes</th>
                      <th className="num">Pushy conversations</th>
                      <th>Approaches</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {r.salespeople.map((p) => (
                  <tr key={p.speaker}>
                    <td>
                      <Spk speaker={p.speaker} report={r} who={who} />
                    </td>
                    <td className="num">
                      <b>{pct(p.upsell_rate)}</b>
                    </td>
                    {fullBreakdown && (
                      <>
                        <td className="num reveal">{p.conversations}</td>
                        <td className="num reveal">{p.attempts_total}</td>
                        <td className="num reveal">{p.avg_effort_score.toFixed(1)}/10</td>
                        <td className="num reveal">{pct(p.upsell_talk_time_share)}</td>
                        <td className="num reveal">{pct(p.acceptance_rate)}</td>
                        <td className="num reveal">
                          {p.pushy_conversations ? <span className="pill bad">{p.pushy_conversations}</span> : "0"}
                        </td>
                        <td className="reveal">
                          <div className="row" style={{ gap: 5 }}>
                            {p.techniques_used.map((t) => (
                              <span className="pill neutral" key={t}>
                                {t.replace(/_/g, " ")}
                              </span>
                            ))}
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="btn ghost small" style={{ marginTop: 10 }} onClick={() => setFullBreakdown((v) => !v)}>
            {fullBreakdown ? "Show less" : "Show full breakdown"}
          </button>
        </>
      ) : (
        <p className="sub">No salesperson detected in this recording.</p>
      )}

      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginTop: 24 }}>
        <h2 style={{ marginBottom: 0 }}>Who spoke</h2>
        <button className="btn ghost small" onClick={() => setShowSpeakers((v) => !v)}>
          {showSpeakers ? "Hide" : "Show talk time"}
        </button>
      </div>
      {showSpeakers && (
        <div className="table-wrap reveal" style={{ marginTop: 12 }}>
          <table>
            <tbody>
              {r.speakers.map((s) => (
                <tr key={s.speaker}>
                  <td style={{ width: "22%" }}>
                    <Spk speaker={s.speaker} report={r} who={who} />
                  </td>
                  <td style={{ width: "16%" }}>
                    <span className="pill neutral">{s.role}</span>
                    {s.title && <div className="sub small" style={{ marginTop: 4 }}>{s.title}</div>}
                  </td>
                  <td style={{ width: "38%" }}>
                    <div className="talk" style={{ "--c": colorFor(s.speaker, r), width: `${(s.talk_time_s / maxTalk) * 100}%` } as React.CSSProperties} />
                  </td>
                  <td className="num sub">{clock(s.talk_time_s)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Kpi({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
  return (
    <div className="kpi">
      <span className="kpi-ico">{icon}</span>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}
