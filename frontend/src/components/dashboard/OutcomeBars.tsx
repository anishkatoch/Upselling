import { Link } from "react-router-dom";
import type { Person } from "../../lib/api";
import { analysedCount } from "../people/rating";
import { Wipe } from "./GrowBar";
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

/** One 100% stacked bar per salesperson: how the offers went in each conversation (accepted / turned down / none made). */
export default function OutcomeBars({ people }: { people: Person[] }) {
  const rows = people
    .map(toRow)
    .filter((r) => r.n > 0)
    .sort((a, b) => a.name.localeCompare(b.name)); // alphabetical: ranking people by yes would reward whoever pushes hardest
  const segs = [
    { key: "accepted", label: "Customer accepted an offer", short: "accepted", cls: "ok" },
    { key: "declined", label: "Customer turned every offer down", short: "turned down", cls: "no" },
    { key: "none", label: "No offer made", short: "no offer", cls: "none" },
  ] as const;
  return (
    <section className="card hbar-card" aria-label="How offers went in each conversation">
      <h3>How offers went in each conversation</h3>
      <p className="hint">This month, one bar per salesperson. Each bar adds up to their conversations.</p>
      <ul className="legend-inline" aria-hidden="true">
        {segs.map((s) => (
          <li key={s.key}>
            <i className={`sw ${s.cls}`} />
            {s.label}
          </li>
        ))}
      </ul>
      {rows.length === 0 ? (
        <p className="sub small">No conversations yet.</p>
      ) : (
        <ul className="ob-list">
          {rows.map((r, i) => (
            <li className="ob-row" key={r.name}>
              <Link className="ob-name" to={`/team/${encodeURIComponent(r.name)}`}>
                {r.name}
              </Link>
              <div className="ob-main">
              <Wipe
                delay={i * 0.06}
                className="ob-bar"
                role="img"
                aria-label={`${r.name}: customer accepted an offer in ${r.accepted}, turned every offer down in ${r.declined}, no offer made in ${r.none}, out of ${r.n} conversations`}
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
              </Wipe>
              <p className="ob-text">{segs.filter((s) => r[s.key] > 0).map((s) => `${r[s.key]} ${s.short}`).join(" · ")}</p>
              </div>
              <span className="ob-n">{r.n} {r.n === 1 ? "conversation" : "conversations"}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
