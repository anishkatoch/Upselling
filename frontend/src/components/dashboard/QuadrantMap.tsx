import { Link, useNavigate } from "react-router-dom";
import type { Person } from "../../lib/api";
import { analysedCount } from "../people/rating";
import "./dashcharts.css";

const W = 640, H = 320;
const L = 52, R = 24, T = 16, B = 44;
const PW = W - L - R, PH = H - T - B;
const first = (n: string) => n.split(" ")[0];
const pc = (v: number) => `${Math.round(v * 100)}%`;

interface Pt { name: string; x: number; y: number; n: number }

/** Who needs what: upsell rate (x) vs acceptance rate (y), split at the team average. */
export default function QuadrantMap({ people }: { people: Person[] }) {
  const nav = useNavigate();
  const pts: Pt[] = [];
  const missing: string[] = [];
  for (const p of people) {
    const n = analysedCount(p.total);
    const x = n > 0 ? p.total.conversations_with_upsell / n : null;
    const y = p.total.acceptance_rate;
    if (x == null || y == null) missing.push(p.name);
    else pts.push({ name: p.name, x, y, n });
  }
  if (pts.length < 3) return null;

  const convs = people.reduce((a, p) => a + analysedCount(p.total), 0);
  const withUp = people.reduce((a, p) => a + p.total.conversations_with_upsell, 0);
  const att = people.reduce((a, p) => a + p.total.attempts, 0);
  const acc = people.reduce((a, p) => a + p.total.accepted, 0);
  const ax = convs ? withUp / convs : 0.5;
  const ay = att ? acc / att : 0.5;

  const sx = (v: number) => L + v * PW;
  const sy = (v: number) => T + (1 - v) * PH;
  const label = (p: Pt) => {
    const cx = sx(p.x), cy = sy(p.y);
    const w = first(p.name).length * 6.6 + 4;
    const flip = cx + 10 + w > W - 4;
    const below = cy < T + 12;
    return { x: flip ? cx - 10 : cx + 10, anchor: flip ? "end" : "start", y: below ? cy + 16 : cy > T + PH - 10 ? cy - 22 : cy + 4 };
  };
  const summary = `Map of upsell rate against acceptance rate. ${pts.map((p) => `${p.name}: upsell rate ${pc(p.x)}, acceptance rate ${pc(p.y)}`).join("; ")}. Team average: ${pc(ax)} upsell rate, ${pc(ay)} acceptance rate.`;

  return (
    <section className="card hbar-card quad" aria-label="Who needs what">
      <h3>Who needs what</h3>
      <p className="hint">Each dot is a salesperson. Dashed lines mark the team average on each side.</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="quad-svg" role="group" aria-label={summary}>
        <title>{summary}</title>
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <g key={v}>
            <line x1={sx(v)} x2={sx(v)} y1={T} y2={T + PH} className="q-grid" />
            <line x1={L} x2={L + PW} y1={sy(v)} y2={sy(v)} className="q-grid" />
          </g>
        ))}
        {[0, 0.5, 1].map((v) => (
          <g key={v} className="q-tick">
            <text x={sx(v)} y={T + PH + 16} textAnchor={v === 0 ? "start" : v === 1 ? "end" : "middle"}>{pc(v)}</text>
            <text x={L - 8} y={sy(v) + 4} textAnchor="end">{pc(v)}</text>
          </g>
        ))}
        <rect x={L} y={T} width={PW} height={PH} className="q-frame" />
        <line x1={sx(ax)} x2={sx(ax)} y1={T} y2={T + PH} className="q-avg" />
        <line x1={L} x2={L + PW} y1={sy(ay)} y2={sy(ay)} className="q-avg" />
        <text x={L + PW - 6} y={T + 14} textAnchor="end" className="q-corner">Tries and closes</text>
        <text x={L + PW - 6} y={T + PH - 6} textAnchor="end" className="q-corner">Tries, rarely closes</text>
        <text x={L + 6} y={T + 14} className="q-corner">Selective, closes well</text>
        <text x={L + 6} y={T + PH - 6} className="q-corner">Rarely tries</text>
        <text x={L + PW / 2} y={H - 6} textAnchor="middle" className="q-axis">Upsell rate (conversations where an upsell was tried)</text>
        <text transform={`translate(12 ${T + PH / 2}) rotate(-90)`} textAnchor="middle" className="q-axis">Acceptance rate</text>
        {pts.map((p) => {
          const lb = label(p);
          const go = () => nav(`/team/${encodeURIComponent(p.name)}`);
          return (
            <g
              key={p.name}
              className="q-pt"
              tabIndex={0}
              role="link"
              aria-label={`${p.name}: upsell rate ${pc(p.x)}, acceptance rate ${pc(p.y)}. Open profile`}
              onClick={go}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  go();
                }
              }}
            >
              <title>{`${p.name}: upsell rate ${pc(p.x)}, acceptance ${pc(p.y)} (${p.n} conversations)`}</title>
              <circle cx={sx(p.x)} cy={sy(p.y)} r="14" fill="transparent" />
              <circle cx={sx(p.x)} cy={sy(p.y)} r="6" className="q-dot" />
              <text x={lb.x} y={lb.y} textAnchor={lb.anchor as "start" | "end"} className="q-name">{first(p.name)}</text>
            </g>
          );
        })}
      </svg>
      <ul className="sr-only">
        {pts.map((p) => (
          <li key={p.name}>
            <Link to={`/team/${encodeURIComponent(p.name)}`}>{p.name}</Link>: upsell rate {pc(p.x)}, acceptance rate {pc(p.y)}
          </li>
        ))}
      </ul>
      {missing.length > 0 && <p className="hbar-foot">Not shown (no answered offers yet): {missing.join(", ")}</p>}
    </section>
  );
}
