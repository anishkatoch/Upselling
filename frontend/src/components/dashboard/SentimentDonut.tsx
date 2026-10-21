import { animate, motion, useInView, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import type { Person } from "../../lib/api";
import { EASE } from "../../lib/motion";
import "./dashcharts.css";

const R = 52;
const C = 2 * Math.PI * R;
const GAP = 3;

/** Team-wide split of calls by how the customer felt. */
export default function SentimentDonut({ people }: { people: Person[] }) {
  const sum = (k: "calls_positive" | "calls_neutral" | "calls_negative") => people.reduce((a, p) => a + (p.total[k] ?? 0), 0);
  const parts = [
    { label: "Went well", n: sum("calls_positive"), color: "var(--accent)" },
    { label: "Okay", n: sum("calls_neutral"), color: "#c3cbe0" },
    { label: "Needs attention", n: sum("calls_negative"), color: "#b0605a" },
  ];
  const total = parts.reduce((a, p) => a + p.n, 0);
  const pc = (n: number) => `${Math.round((n / total) * 100)}%`;
  const summary = `${total} calls: ${parts.map((p) => `${p.n} ${p.label.toLowerCase()}`).join(", ")}.`;
  const visible = parts.filter((p) => p.n > 0);
  let offset = 0;
  let drawn = 0; // fraction of the ring already drawn before this segment (segments sweep clockwise one after another)
  const SWEEP = 0.8;
  const reduce = useReducedMotion();
  const svgRef = useRef<SVGSVGElement>(null);
  const inView = useInView(svgRef, { once: true, margin: "-20px" });
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (reduce || !inView) return;
    const c = animate(0, total, { duration: SWEEP, ease: EASE, onUpdate: (v) => setShown(Math.round(v)), onComplete: () => setShown(total) });
    return () => c.stop();
  }, [inView, total, reduce]);
  return (
    <section className="card hbar-card" aria-label="How customers felt">
      <h3>
        How customers felt
        <span className="ai-badge" style={{ marginLeft: 8 }} title="Assessed by AI">
          ✦ AI
        </span>
      </h3>
      <p className="hint">This month, how the customers felt on their calls.</p>
      {total === 0 ? (
        <p className="sub small">No calls rated yet.</p>
      ) : (
        <div className="donut-wrap">
          <svg ref={svgRef} className="donut" viewBox="0 0 140 140" role="img" aria-label={summary}>
            <circle cx="70" cy="70" r={R} fill="none" stroke="var(--line-soft)" strokeWidth="9" />
            <g transform="rotate(-90 70 70)">
              {visible.map((p) => {
                const len = (p.n / total) * C;
                const dash = visible.length > 1 ? Math.max(len - GAP, 0.5) : len;
                const delay = drawn * SWEEP;
                const dur = Math.max((len / C) * SWEEP, 0.15);
                drawn += len / C;
                const el = (
                  <motion.circle
                    key={p.label}
                    cx="70"
                    cy="70"
                    r={R}
                    fill="none"
                    stroke={p.color}
                    strokeWidth="9"
                    strokeDashoffset={-offset}
                    initial={reduce ? false : { strokeDasharray: `0 ${C}` }}
                    animate={{ strokeDasharray: inView || reduce ? `${dash} ${C - dash}` : `0 ${C}` }}
                    transition={{ duration: dur, ease: "linear", delay }}
                  >
                    <title>{`${p.label}: ${p.n} calls (${pc(p.n)})`}</title>
                  </motion.circle>
                );
                offset += len;
                return el;
              })}
            </g>
            <text x="70" y="70" textAnchor="middle" className="donut-num">{reduce ? total : shown}</text>
            <text x="70" y="88" textAnchor="middle" className="donut-cap">calls</text>
          </svg>
          <ul className="donut-legend">
            {parts.map((p) => (
              <li key={p.label}>
                <i className="sw" style={{ background: p.color }} />
                <span className="lbl">{p.label}</span>
                <span className="val">
                  {p.n}
                  <small>{pc(p.n)}</small>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
