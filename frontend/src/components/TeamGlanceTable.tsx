import { useState } from "react";
import { Link } from "react-router-dom";
import LineChart from "./LineChart";
import { Minus, TrendDown, TrendUp } from "../icons/Icons";
import type { Person } from "../lib/api";
import { pct } from "../lib/format";
import { EFFORT, moodFromFrustration, RATING } from "../lib/teamLabels";

/**
 * The hero "how is everyone doing right now" table - shared by Dashboard (fixed month snapshot)
 * and Team (whichever period is selected), so there's exactly one "glance at the whole team" UI.
 * Clicking a name goes to their dedicated profile page (/team/:name), not an inline toggle.
 *
 * `collapsedRows`, when set, shows only the first N people plus a "Show full team table" button
 * that reveals the rest in place. Omit it (Team.tsx's usage) for the unchanged, always-full table.
 */
export default function TeamGlanceTable({ people, demo, collapsedRows }: { people: Person[]; demo?: boolean; collapsedRows?: number }) {
  const [expanded, setExpanded] = useState(false);
  if (people.length === 0) return null;
  const limited = collapsedRows != null && !expanded && people.length > collapsedRows;
  const shown = limited ? people.slice(0, collapsedRows) : people;
  return (
    <div className="card team-glance" style={{ marginBottom: 16 }}>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 14 }}>
        <h2 style={{ marginBottom: 0 }}>Team at a glance</h2>
        <span className="live-caption">
          <span className="live-dot" /> Live · updated just now
        </span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Salesperson</th>
              <th title="Overall performance: greetings, upselling, pushiness and customer mood combined">Overall</th>
              <th title="Upsell attempts per period, oldest to newest - direction vs. earlier periods">Trend</th>
              <th title="How hard they push to upsell - not the same as doing well; pushing hard can still go badly">
                Selling effort
              </th>
              <th className="num" title="Share of conversations where they tried to upsell something">
                Tried an upsell
              </th>
              <th className="num" title="Of the upsells they offered, the share the customer said yes to">
                Customer said yes
              </th>
              <th className="num" title="Share of conversations that started with a greeting">Greeted</th>
              <th title="How frustrated customers got, on average, across the period">Customer mood</th>
              <th className="num" title="Calls that felt positive overall, out of every call this period">
                Calls that went well
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((p, i) => {
              const r = RATING[p.assessment.rating];
              const e = EFFORT[p.assessment.effort_level];
              const t = p.total;
              const mood = moodFromFrustration(t.avg_customer_frustration);
              const totalCalls = t.calls_positive + t.calls_neutral + t.calls_negative;
              const trend = p.assessment.trend;
              const TrendIcon = trend === "improving" ? TrendUp : trend === "declining" ? TrendDown : Minus;
              const justRevealed = expanded && collapsedRows != null && i >= collapsedRows;
              return (
                <tr key={p.name} className={justRevealed ? "reveal" : undefined}>
                  <td>
                    <Link to={`/team/${encodeURIComponent(p.name)}`} state={{ demo }} className="link">
                      <b>{p.name}</b>
                    </Link>
                  </td>
                  <td>
                    <span className={`pill ${r.tone}`}>{r.label}</span>
                  </td>
                  <td>
                    <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                      {trend && (
                        <span
                          className={`trend ${trend}`}
                          title={trend === "improving" ? "Improving" : trend === "declining" ? "Slipping" : "Steady"}
                        >
                          <TrendIcon size={14} />
                        </span>
                      )}
                      {p.series.length > 1 ? (
                        <LineChart compact data={p.series} value={(b) => b.attempts} label={(b) => b.period} />
                      ) : (
                        <span className="sub small">–</span>
                      )}
                    </div>
                  </td>
                  <td>
                    <span className={`pill ${e.tone}`}>{e.short}</span>
                  </td>
                  <td className="num">{pct(t.upsell_rate)}</td>
                  <td className="num">{pct(t.acceptance_rate)}</td>
                  <td className="num">{pct(t.greeting_rate)}</td>
                  <td>
                    <span className={`pill ${mood.tone}`}>{mood.label}</span>
                  </td>
                  <td className="num">{totalCalls ? `${t.calls_positive} of ${totalCalls}` : "–"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {limited && (
        <button className="btn ghost small" style={{ marginTop: 10 }} onClick={() => setExpanded(true)}>
          Show full team table ({people.length} total)
        </button>
      )}
      <p className="sub small" style={{ marginTop: 10 }}>
        Click a name to see their full breakdown.
      </p>
    </div>
  );
}
