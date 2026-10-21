import { Link } from "react-router-dom";
import type { Person } from "../../lib/api";
import { analysedCount } from "../people/rating";
import "./dashcharts.css";

interface Row {
  name: string;
  n: number;
  accepted: number;
  declined: number;
  none: number;
}

const toRow = (p: Person): Row => {
  const n = analysedCount(p.total);
  const tried = Math.min(p.total.conversations_with_upsell, n);
  const accepted = Math.min(p.total.conversations_won, tried);
  return { name: p.name, n, accepted, declined: tried - accepted, none: n - tried };
};

/** One 100% stacked bar per salesperson: accepted / declined / no upsell tried. */
export default function OutcomeBars({ people }: { people: Person[] }) {
  const rows = people
    .map(toRow)
    .filter((r) => r.n > 0)
    .sort((a, b) => b.accepted / b.n - a.accepted / a.n || b.n - a.n);
  const segs = [
    { key: "accepted", label: "Accepted", cls: "ok" },
    { key: "declined", label: "Declined", cls: "no" },
    { key: "none", label: "No upsell tried", cls: "none" },
  ] as const;
  return (
    <section className="card hbar-card" aria-label="How each conversation ended">
      <h3>How each conversation ended</h3>
      <p className="hint">Latest month, per salesperson. Sorted by the share of conversations where a customer accepted.</p>
      <ul className="legend-inline" aria-hidden="true">
        {segs.map((s) => (
          <li key={s.key}>
            <i className={`sw ${s.cls}`} />
            {s.label}
          </li>
        ))}
      </ul>
      {rows.length === 0 ? (
        <p className="sub small">No analysed conversations yet.</p>
      ) : (
        <ul className="ob-list">
          {rows.map((r) => (
            <li className="ob-row" key={r.name}>
              <Link className="ob-name" to={`/team/${encodeURIComponent(r.name)}`}>
                {r.name}
              </Link>
              <div
                className="ob-bar"
                role="img"
                aria-label={`${r.name}: ${r.accepted} accepted, ${r.declined} declined, ${r.none} with no upsell tried, out of ${r.n} conversations`}
              >
                {segs.map((s) =>
                  r[s.key] > 0 ? (
                    <span
                      key={s.key}
                      className={`ob-seg ${s.cls}`}
                      style={{ width: `${(r[s.key] / r.n) * 100}%` }}
                      title={`${s.label}: ${r[s.key]} of ${r.n}`}
                    >
                      {r[s.key] / r.n >= 0.12 ? r[s.key] : ""}
                    </span>
                  ) : null,
                )}
              </div>
              <span className="ob-n">n = {r.n}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
