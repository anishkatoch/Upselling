import type { TechniqueStat } from "../../lib/api";
import { technique } from "../../lib/format";
import "./dashcharts.css";

const MIN_ATTEMPTS = 5; // below this a percentage says more about luck than about the approach

/** Which selling approaches get a yes. Rates are shown only for approaches tried often enough to compare. */
export default function TechniqueBars({ stats }: { stats: TechniqueStat[] }) {
  const rated = stats.filter((s) => s.attempts >= MIN_ATTEMPTS && s.acceptance_rate != null).sort((a, b) => (b.acceptance_rate ?? 0) - (a.acceptance_rate ?? 0));
  const rare = stats.filter((s) => !rated.includes(s));
  const rareAttempts = rare.reduce((n, s) => n + s.attempts, 0);
  const rareAccepted = rare.reduce((n, s) => n + s.accepted, 0);
  return (
    <section className="card hbar-card" aria-label="Which approaches get a yes">
      <h3>Which approaches get a yes</h3>
      <p className="hint">How often customers said yes to each approach, across all recordings.</p>
      {rated.length === 0 ? (
        <p className="sub small">Not enough offers yet to compare approaches.</p>
      ) : (
        <ul className="hbar-list">
          {rated.map((s) => (
            <li className="hbar-row" key={s.technique}>
              <div className="hbar-top">
                <span className="lbl">{technique(s.technique)}</span>
                <span className="val">
                  {Math.round((s.acceptance_rate ?? 0) * 100)}%<small>{s.accepted} of {s.accepted + s.rejected} said yes</small>
                </span>
              </div>
              <div className="hbar-track" aria-hidden="true">
                <div className="hbar-fill" style={{ width: `${(s.acceptance_rate ?? 0) * 100}%` }} />
              </div>
              <div className="hbar-sub">
                Tried {s.attempts} time{s.attempts === 1 ? "" : "s"}
              </div>
            </li>
          ))}
        </ul>
      )}
      {rare.length > 0 && (
        <p className="hbar-foot hbar-other">
          Other approaches ({rare.map((s) => technique(s.technique).toLowerCase()).join(", ")}): {rareAttempts} offer{rareAttempts === 1 ? "" : "s"}, {rareAccepted} said yes
          - too few to compare. Percentages are shown for approaches tried at least {MIN_ATTEMPTS} times.
        </p>
      )}
    </section>
  );
}
