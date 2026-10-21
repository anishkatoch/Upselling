import { motion } from "framer-motion";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Person } from "../../lib/api";
import { DUR, EASE, fadeUp, stagger } from "../../lib/motion";
import { analysedCount, RatingChip } from "../people/rating";
import "./dashcharts.css";
import "./quadrant.css";

const W = 560,
  H = 390;
const L = 116,
  R = 16,
  T = 14,
  B = 46;
const PAD = 22; // keeps the avatar badges at 0% or 100% fully inside the frame
const PW = W - L - R,
  PH = H - T - B;
const initials = (n: string) =>
  n
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
const panel = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { duration: DUR.base, ease: EASE } } };
const badgeIn = { hidden: { opacity: 0, scale: 0.9 }, show: { opacity: 1, scale: 1, transition: { duration: DUR.base, ease: EASE } } };
const pc = (v: number) => `${Math.round(v * 100)}%`;

interface Pt {
  person: Person;
  name: string;
  x: number;
  y: number | null;
  n: number;
}

type Group = "closes" | "rarely_closes" | "selective" | "rarely_tries";

const GROUPS: { key: Group; title: string; tone: string; advice: string }[] = [
  { key: "closes", title: "Tries and closes", tone: "good", advice: "Offering often and customers say yes. Worth sharing what they do." },
  { key: "rarely_closes", title: "Tries, rarely closes", tone: "bad", advice: "Coach on closing: tie the add-on to what the customer asked, and answer their questions first." },
  { key: "selective", title: "Selective, closes well", tone: "accent", advice: "Offers are accepted but made less often. Encourage them to offer more." },
  { key: "rarely_tries", title: "Below team on both", tone: "muted", advice: "Offers less often and closes less often than the team. Coach on making the offer once the customer's own request is handled, then on closing." },
];

/**
 * Who needs what: upsell rate (across) vs acceptance rate (up), split at the team average. People are avatar badges;
 * hovering or focusing a badge or a name highlights the other and shows a detail card.
 */
export default function QuadrantMap({ people }: { people: Person[] }) {
  const nav = useNavigate();
  const [active, setActive] = useState<string | null>(null);
  const pts: Pt[] = people.map((p) => {
    const n = analysedCount(p.total);
    return { person: p, name: p.name, x: n > 0 ? p.total.conversations_with_upsell / n : 0, y: p.total.acceptance_rate, n };
  });
  const placed = pts.filter((p) => p.y != null);
  if (placed.length < 3) return null;

  const convs = people.reduce((a, p) => a + analysedCount(p.total), 0);
  const withUp = people.reduce((a, p) => a + p.total.conversations_with_upsell, 0);
  const att = people.reduce((a, p) => a + p.total.attempts, 0);
  const acc = people.reduce((a, p) => a + p.total.accepted, 0);
  const ax = convs ? withUp / convs : 0.5;
  const ay = att ? acc / att : 0.5;

  // The map is centred on the team average: each person is plotted by how far they are from it, so the cross sits in
  // the middle and the four corners are symmetrical. Axis ranges are rounded up to a tidy 10-point step.
  const nice = (m: number) => Math.max(0.1, Math.ceil(m * 20 - 1e-9) / 20);
  const Dx = nice(Math.max(...placed.map((p) => Math.abs(p.x - ax))));
  const Dy = nice(Math.max(...placed.map((p) => Math.abs((p.y as number) - ay))));
  const cx = L + PW / 2;
  const cy = T + PH / 2;
  const hx = PW / 2 - PAD;
  const hy = PH / 2 - PAD;
  const px = (p: Pt) => cx + ((p.x - ax) / Dx) * hx;
  const py = (p: Pt) => cy - (((p.y as number) - ay) / Dy) * hy;

  const groupOf = (p: Pt): Group => {
    if (p.y == null) return "rarely_tries"; // no answered offers: has not really tried
    const tries = p.x >= ax;
    return tries ? (p.y >= ay ? "closes" : "rarely_closes") : p.y >= ay ? "selective" : "rarely_tries";
  };
  const toneOf = (p: Pt) => GROUPS.find((g) => g.key === groupOf(p))?.tone ?? "muted";
  const byGroup = (g: Group) => pts.filter((p) => groupOf(p) === g);

  const summary = `Map of how often each salesperson tries to upsell against how often customers say yes. ${placed.map((p) => `${p.name}: tries to upsell in ${pc(p.x)} of conversations, customers say yes to ${pc(p.y as number)} of offers`).join("; ")}. Team average: ${pc(ax)} of conversations, ${pc(ay)} of offers.`;
  const act = active ? pts.find((p) => p.name === active) : undefined;
  const dim = (name: string) => (active && active !== name ? " dim" : active === name ? " on" : "");

  return (
    <section className="card hbar-card quad" aria-label="Who needs what">
      <h3>Who needs what</h3>
      <p className="hint">Each badge is a salesperson, placed against the team average (the dashed lines). Hover a badge or a name to see their figures.</p>
      <div className="quad-grid">
        <div className="quad-plot">
          <motion.svg viewBox={`0 0 ${W} ${H}`} className="quad-svg" role="img" aria-label={summary} variants={stagger(0.07, 0.12)} initial="hidden" animate="show">
            <title>{summary}</title>
            {/* quadrant panels, split at the team average */}
            <motion.rect variants={panel} x={cx + 1} y={T} width={PW / 2 - 1} height={PH / 2 - 1} rx="6" className="q-tint good" />
            <motion.rect variants={panel} x={cx + 1} y={cy + 1} width={PW / 2 - 1} height={PH / 2 - 1} rx="6" className="q-tint bad" />
            <motion.rect variants={panel} x={L} y={T} width={PW / 2 - 1} height={PH / 2 - 1} rx="6" className="q-tint accent" />
            <motion.rect variants={panel} x={L} y={cy + 1} width={PW / 2 - 1} height={PH / 2 - 1} rx="6" className="q-tint muted" />
            {[-1, 0, 1].map((k) => (
              <g key={k}>
                <line x1={L} x2={L + PW} y1={cy - k * hy} y2={cy - k * hy} className={k === 0 ? "q-avg" : "q-grid-line"} />
                <line x1={cx + k * hx} x2={cx + k * hx} y1={T} y2={T + PH} className={k === 0 ? "q-avg" : "q-grid-line"} />
                <g className="q-tick">
                  <text x={k === 0 ? cx : k > 0 ? L + PW : L} y={T + PH + 18} textAnchor={k === 0 ? "middle" : k > 0 ? "end" : "start"}>
                    {k === 0 ? "Team average" : k > 0 ? "More often" : "Less often"}
                  </text>
                  <text x={L - 8} y={cy - k * hy + 4} textAnchor="end">
                    {k === 0 ? "Team average" : k > 0 ? "More yeses" : "Fewer yeses"}
                  </text>
                </g>
              </g>
            ))}
            <text x={L + PW - 10} y={T + 18} textAnchor="end" className="q-corner">
              Tries and closes
            </text>
            <text x={L + PW - 10} y={T + PH - 10} textAnchor="end" className="q-corner">
              Tries, rarely closes
            </text>
            <text x={L + 10} y={T + 18} className="q-corner">
              Selective, closes well
            </text>
            <text x={L + 10} y={T + PH - 10} className="q-corner">
              Below team on both
            </text>
            <text x={L + PW / 2} y={H - 8} textAnchor="middle" className="q-axis">
              How often they offer an upsell
            </text>
            <text transform={`translate(12 ${T + PH / 2}) rotate(-90)`} textAnchor="middle" className="q-axis">
              How often customers say yes
            </text>
            {placed.map((p) => {
              const y = p.y as number;
              const go = () => nav(`/team/${encodeURIComponent(p.name)}`);
              return (
                <motion.g key={p.name} variants={badgeIn}>
                <motion.g
                  className={`q-pt ${toneOf(p)}${dim(p.name)}`}
                  animate={{ scale: active === p.name ? 1.12 : 1 }}
                  transition={{ duration: DUR.fast, ease: EASE }}
                  tabIndex={0}
                  role="link"
                  aria-label={`${p.name}: tries to upsell in ${pc(p.x)} of conversations, customers say yes to ${pc(y)} of offers. Open profile`}
                  onClick={go}
                  onMouseEnter={() => setActive(p.name)}
                  onMouseLeave={() => setActive(null)}
                  onFocus={() => setActive(p.name)}
                  onBlur={() => setActive(null)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      go();
                    }
                  }}
                >
                  <circle cx={px(p)} cy={py(p)} r="22" fill="transparent" />
                  <circle cx={px(p)} cy={py(p)} r="15" className="q-badge" />
                  <text x={px(p)} y={py(p) + 4} textAnchor="middle" className="q-initials">
                    {initials(p.name)}
                  </text>
                </motion.g>
                </motion.g>
              );
            })}
          </motion.svg>

          {act && act.y != null && (
            <div
              className="quad-tip-wrap"
              role="status"
              style={{
                left: `${(px(act) / W) * 100}%`,
                top: `${(py(act) / H) * 100}%`,
                // above the badge, or below it when the badge is near the top of the map so the card isn't clipped
                transform: `translate(${px(act) > cx + hx * 0.5 ? "-85%" : "-50%"}, ${py(act) < cy - hy * 0.4 ? "22px" : "calc(-100% - 22px)"})`,
              }}
            >
              <motion.div key={act.name} className="quad-tip" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.12 }}>
              <div className="quad-tip-head">
                <b>{act.name}</b>
                <RatingChip person={act.person} short />
              </div>
              <div className="quad-tip-row">
                <span>Tries to upsell</span>
                <b>{pc(act.x)} of conversations</b>
              </div>
              <div className="quad-tip-row">
                <span>Customers say yes</span>
                <b>{pc(act.y)} of offers</b>
              </div>
              <div className="quad-tip-n">{act.n} conversation{act.n === 1 ? "" : "s"}</div>
              </motion.div>
            </div>
          )}
        </div>

        <motion.div className="quad-read" variants={stagger(0.07, 0.15)} initial="hidden" animate="show">
          {GROUPS.map((g) => {
            const members = byGroup(g.key);
            if (members.length === 0) return null;
            return (
              <motion.div className={`quad-group ${g.tone}`} key={g.key} variants={fadeUp}>
                <div className="quad-group-title">{g.title}</div>
                <motion.div className="quad-chips" variants={stagger(0.05, 0.1)}>
                  {members.map((m) => (
                    <motion.span key={m.name} variants={fadeUp} style={{ display: "inline-flex" }}>
                    <Link
                      to={`/team/${encodeURIComponent(m.name)}`}
                      className={`quad-chip${dim(m.name)}`}
                      onMouseEnter={() => setActive(m.name)}
                      onMouseLeave={() => setActive(null)}
                      onFocus={() => setActive(m.name)}
                      onBlur={() => setActive(null)}
                    >
                      <span className="quad-chip-av" aria-hidden="true">
                        {initials(m.name)}
                      </span>
                      {m.name}
                      {m.y == null && <span className="quad-note">no answered offers yet</span>}
                    </Link>
                    </motion.span>
                  ))}
                </motion.div>
                <p className="quad-advice">{g.advice}</p>
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}
