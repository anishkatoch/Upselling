import { animate, motion, useInView, useMotionValue, useReducedMotion, useTransform } from "framer-motion";
import { useEffect, useRef } from "react";
import { DUR, EASE } from "../../lib/motion";
import type { Bucket } from "../../lib/api";

const R = 40;
const C = 2 * Math.PI * R;

/** "How their customers felt": thin donut of calls by customer mood, with a text legend. */
export default function PersonSentiment({ total }: { total: Bucket }) {
  const good = total.calls_positive ?? 0;
  const okay = total.calls_neutral ?? 0;
  const bad = total.calls_negative ?? 0;
  const n = good + okay + bad;
  const reduce = useReducedMotion();
  const ref = useRef<SVGSVGElement>(null);
  const inView = useInView(ref, { once: true });
  const mv = useMotionValue(reduce ? n : 0);
  const shown = useTransform(mv, (v) => Math.round(v));
  useEffect(() => {
    if (reduce) {
      mv.set(n);
      return;
    }
    if (!inView) return;
    const c = animate(mv, n, { duration: DUR.slow + 0.2, ease: EASE });
    return () => c.stop();
  }, [inView, n, reduce, mv]);
  if (n === 0) return null;
  const parts = [
    { label: "Went well", count: good, color: "var(--accent)" },
    { label: "Okay", count: okay, color: "#c3cbe0" },
    { label: "Needs attention", count: bad, color: "#b0605a" },
  ];
  let offset = 0;
  const aria = `How customers felt across ${n} calls: ${parts.map((p) => `${p.count} ${p.label.toLowerCase()}`).join(", ")}`;
  return (
    <section className="flat-card sentiment" aria-label="How their customers felt">
      <h3>
        How their customers felt <span className="ai-badge">✦ AI</span>
      </h3>
      <div className="sent-body">
        <svg ref={ref} className="sent-donut" viewBox="0 0 100 100" role="img" aria-label={aria}>
          <circle cx="50" cy="50" r={R} fill="none" stroke="var(--line-soft)" strokeWidth="6" />
          {parts.map((p, idx) => {
            if (p.count === 0) return null;
            const len = (p.count / n) * C;
            const el = (
              <motion.circle
                key={p.label}
                cx="50"
                cy="50"
                r={R}
                fill="none"
                stroke={p.color}
                strokeWidth="6"
                initial={reduce ? false : { strokeDasharray: `0 ${C}` }}
                animate={inView || reduce ? { strokeDasharray: `${len} ${C - len}` } : undefined}
                transition={{ duration: DUR.slow, ease: EASE, delay: idx * 0.1 }}
                strokeDashoffset={-offset}
                transform="rotate(-90 50 50)"
              />
            );
            offset += len;
            return el;
          })}
          <motion.text x="50" y="49" textAnchor="middle" className="sent-n">{shown}</motion.text>
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
