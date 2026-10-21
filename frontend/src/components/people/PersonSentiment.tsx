import type { Bucket } from "../../lib/api";

const R = 40;
const C = 2 * Math.PI * R;

/** "How their customers felt": thin donut of calls by customer mood, with a text legend. */
export default function PersonSentiment({ total }: { total: Bucket }) {
  const good = total.calls_positive ?? 0;
  const okay = total.calls_neutral ?? 0;
  const bad = total.calls_negative ?? 0;
  const n = good + okay + bad;
  if (n === 0) return null;
  const parts = [
    { label: "Went well", count: good, color: "var(--good)" },
    { label: "Okay", count: okay, color: "#a3b1c2" },
    { label: "Needs attention", count: bad, color: "var(--bad)" },
  ];
  let offset = 0;
  const aria = `Customer mood across ${n} calls: ${parts.map((p) => `${p.count} ${p.label.toLowerCase()}`).join(", ")}`;
  return (
    <section className="flat-card sentiment" aria-label="How their customers felt">
      <h3>How their customers felt</h3>
      <div className="sent-body">
        <svg className="sent-donut" viewBox="0 0 100 100" role="img" aria-label={aria}>
          <circle cx="50" cy="50" r={R} fill="none" stroke="var(--line-soft)" strokeWidth="9" />
          {parts.map((p) => {
            if (p.count === 0) return null;
            const len = (p.count / n) * C;
            const el = (
              <circle
                key={p.label}
                cx="50"
                cy="50"
                r={R}
                fill="none"
                stroke={p.color}
                strokeWidth="9"
                strokeDasharray={`${len} ${C - len}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 50 50)"
              />
            );
            offset += len;
            return el;
          })}
          <text x="50" y="49" textAnchor="middle" className="sent-n">{n}</text>
          <text x="50" y="63" textAnchor="middle" className="sent-w">{n === 1 ? "call" : "calls"}</text>
        </svg>
        <ul className="sent-legend">
          {parts.map((p) => (
            <li key={p.label}>
              <i style={{ background: p.color }} aria-hidden="true" />
              <span>{p.label}</span>
              <b>{p.count}</b>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
