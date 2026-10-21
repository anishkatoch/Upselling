import "./dashcharts.css";

export interface FunnelStep {
  label: string;
  n: number;
}

const pctOf = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "–");

/** Conversations -> offered an upsell -> customer said yes. Bars are relative to the first step. */
export default function Funnel({ steps }: { steps: FunnelStep[] }) {
  const top = steps[0]?.n ?? 0;
  return (
    <section className="card hbar-card" aria-label="Sales funnel">
      <h3>From conversation to yes</h3>
      <p className="hint">This month: how many customer conversations got as far as each step. Percentages are out of all conversations.</p>
      <ul className="hbar-list">
        {steps.map((s, i) => (
          <li className="hbar-row" key={s.label}>
            <div className="hbar-top">
              <span className="lbl">{s.label}</span>
              <span className="val">
                {s.n}
                {i > 0 && <small>({pctOf(s.n, top)})</small>}
              </span>
            </div>
            <div className="hbar-track" aria-hidden="true">
              <div className="hbar-fill" style={{ width: top > 0 ? `${(s.n / top) * 100}%` : 0 }} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
