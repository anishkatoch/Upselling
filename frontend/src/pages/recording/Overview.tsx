import { Check, Headset, Minus, TrendUp } from "../../icons/Icons";
import { clock, pct } from "../../lib/format";
import { moodFromFrustration } from "../../lib/teamLabels";
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
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Salesperson</th>
                <th className="num">Greeted the customer</th>
                <th className="num">Questions left unanswered</th>
                <th className="num">Pushy after a "no"</th>
                <th>Worst customer mood</th>
                <th className="num">Tries to upsell</th>
              </tr>
            </thead>
            <tbody>
              {r.salespeople.map((p) => {
                // Conversation-level findings are counted only where this was the one salesperson (as everywhere else).
                const solo = sales.filter((c) => c.salespeople.length === 1 && c.salespeople[0] === p.speaker);
                const greetedN = solo.filter((c) => c.upsell?.greeting_given).length;
                const unansweredN = solo.reduce((a, c) => a + (c.upsell?.unanswered_questions.length ?? 0), 0);
                const moods = sales
                  .filter((c) => c.salespeople.includes(p.speaker))
                  .flatMap((c) => (c.mood?.speakers ?? []).filter((m) => c.customers.includes(m.speaker)).map((m) => m.frustration_level));
                const worst = moods.length ? Math.max(...moods) : null;
                const mood = moodFromFrustration(worst);
                return (
                  <tr key={p.speaker}>
                    <td>
                      <Spk speaker={p.speaker} report={r} who={who} />
                    </td>
                    <td className="num">{solo.length ? `${greetedN} of ${solo.length}` : "–"}</td>
                    <td className="num">{solo.length ? unansweredN : "–"}</td>
                    <td className="num">{p.pushy_conversations ? <span className="pill bad">{p.pushy_conversations}</span> : "0"}</td>
                    <td>
                      {worst == null ? (
                        <span className="sub">–</span>
                      ) : (
                        <span className={`wd wd-${mood.tone}`}>
                          {mood.label} <span className="sub small">({worst}/10)</span>
                        </span>
                      )}
                    </td>
                    <td className="num">{pct(p.upsell_rate)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="sub">No salesperson detected in this recording.</p>
      )}

      <h2 style={{ marginTop: 28 }}>Who spoke</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Speaker</th>
              <th>Role</th>
              <th>Share of the talking</th>
              <th className="num">Talk time</th>
            </tr>
          </thead>
          <tbody>
            {r.speakers.map((s) => (
              <tr key={s.speaker}>
                <td style={{ width: "22%" }}>
                  <Spk speaker={s.speaker} report={r} who={who} />
                </td>
                <td style={{ width: "18%" }}>
                  <span className="pill neutral">{s.role}</span>
                  {s.title && (
                    <div className="sub small" style={{ marginTop: 4 }}>
                      {s.title}
                    </div>
                  )}
                </td>
                <td style={{ width: "40%" }}>
                  <div className="talk" style={{ "--c": colorFor(s.speaker, r), width: `${(s.talk_time_s / maxTalk) * 100}%` } as React.CSSProperties} />
                </td>
                <td className="num sub">{clock(s.talk_time_s)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
