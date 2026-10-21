import "./dashcharts.css";

export interface FunnelStep {
  label: string;
  n: number;
}

const pctOf = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "–");

/** Conversations -> upsell tried -> customer said yes: where the opportunity is lost. Bars are relative to the first step. */
export default function Funnel({ steps }: { steps: FunnelStep[] }) {
  const top = steps[0]?.n ?? 0;
  return (
    <section className="card hbar-card" aria-label="Sales funnel">
      <h3>From conversation to yes</h3>
      <p className="hint">Latest month: of all analysed customer conversations, how many reached each step.</p>
      <ul className="hbar-list">
        {steps.map((s, i) => (
          <li className="hbar-row" key={s.label}>
            <div className="hbar-top">
              <span className="lbl">{s.label}</span>
              <span className="val">
                {s.n}
                <small>{pctOf(s.n, top)} of all</small>
              </span>
            </div>
            <div className="hbar-track" aria-hidden="true">
              <div className="hbar-fill" style={{ width: top > 0 ? `${(s.n / top) * 100}%` : 0 }} />
            </div>
            {i > 0 && <div className="hbar-sub">{pctOf(s.n, steps[i - 1].n)} of the step before</div>}
          </li>
        ))}
      </ul>
    </section>
  );
}
