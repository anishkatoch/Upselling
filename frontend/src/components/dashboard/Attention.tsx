import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import type { Person } from "../../lib/api";
import { isNotRated } from "../people/rating";
import { fadeUp, stagger } from "../../lib/motion";
import "./attention.css";

const WORDS = { declining: "Slipping", improving: "Improving", steady: "Steady" } as const;
const ARROWS = { declining: "↓", improving: "↑", steady: "→" } as const;

function shorten(text: string | undefined, max = 110) {
  const t = text?.trim();
  if (!t) return null;
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const i = cut.lastIndexOf(" ");
  return (i > 40 ? cut.slice(0, i) : cut).replace(/[\s,.;:–-]+$/, "") + "…";
}

function Row({ p, reason }: { p: Person; reason: string | undefined }) {
  const why = shorten(reason);
  const t = p.assessment.trend;
  return (
    <li className="attn-row">
      <div style={{ minWidth: 0 }}>
        <Link to={`/team/${encodeURIComponent(p.name)}`} className="attn-name">
          {p.name}
        </Link>
        {why && <div className="attn-why">{why}</div>}
      </div>
      {t && (
        <span className="attn-trend">
          <span aria-hidden="true">{ARROWS[t]}</span> {WORDS[t]}
        </span>
      )}
    </li>
  );
}

const rate = (p: Person) => p.total.upsell_rate ?? 0;

export default function Attention({ people }: { people: Person[] }) {
  const rated = people.filter((p) => !isNotRated(p));
  const needs = rated
    .filter((p) => p.assessment.rating === "needs_work")
    .sort((a, b) => Number(b.assessment.trend === "declining") - Number(a.assessment.trend === "declining") || rate(a) - rate(b))
    .slice(0, 4);
  const well = rated
    .filter((p) => p.assessment.rating === "strong")
    .sort((a, b) => rate(b) - rate(a))
    .slice(0, 3);

  return (
    <motion.div className="attn" variants={stagger(0.06)}>
      <motion.section className="card attn-card" variants={fadeUp} aria-labelledby="attn-need">
        <div className="attn-h" id="attn-need">
          Needs your attention
        </div>
        {needs.length ? (
          <ul className="attn-list">
            {needs.map((p) => (
              <Row key={p.name} p={p} reason={p.assessment.improvements[0]} />
            ))}
          </ul>
        ) : (
          <p className="attn-empty">Nobody needs support right now.</p>
        )}
        <div className="attn-more">
          <Link to="/team?period=month">See everyone in Team →</Link>
        </div>
      </motion.section>
      <motion.section className="card attn-card" variants={fadeUp} aria-labelledby="attn-well">
        <div className="attn-h" id="attn-well">
          Doing well
        </div>
        {well.length ? (
          <ul className="attn-list">
            {well.map((p) => (
              <Row key={p.name} p={p} reason={p.assessment.strengths[0]} />
            ))}
          </ul>
        ) : (
          <p className="attn-empty">Nobody is standing out yet.</p>
        )}
      </motion.section>
    </motion.div>
  );
}
