import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import type { Person } from "../../lib/api";
import { RatingChip, isNotRated } from "../people/rating";
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

function Row({ p, reason, chip }: { p: Person; reason: string | undefined; chip?: boolean }) {
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
      {chip && <RatingChip person={p} short />}
      {!chip && t && (
        <span className="attn-trend">
          <span aria-hidden="true">{ARROWS[t]}</span> {WORDS[t]}
        </span>
      )}
    </li>
  );
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

// Three short facts about why someone is doing well, from their own numbers (not just the first strength).
function highlights(p: Person): string | undefined {
  const t = p.total;
  const facts: string[] = [];
  if (t.greeting_rate != null && t.greeting_rate >= 0.8) facts.push(`Greets ${pct(t.greeting_rate)} of customers`);
  if (t.avg_customer_frustration != null && t.avg_customer_frustration < 3) facts.push("Customers stay calm");
  if (t.unanswered_questions === 0) facts.push("Answers every question");
  if (t.attempts > 0 && t.pushy_conversations === 0) facts.push("No pressure after a no");
  if (t.acceptance_rate != null && (t.answered_offers ?? 0) >= 3 && t.acceptance_rate >= 0.4)
    facts.push(`${pct(t.acceptance_rate)} of offers accepted`);
  return facts.length ? facts.slice(0, 3).join(" · ") : p.assessment.strengths[0];
}

// Who needs attention first is judged on how customers were treated (their worst conversation), not on upselling.
const worstMood = (p: Person) => p.total.max_customer_frustration ?? p.total.avg_customer_frustration ?? 0;

const SHOWN = 3; // rows in each card; with more people the card rotates through them
const ROTATE_MS = 7000;

/** The next `SHOWN` items from a ring, advancing every few seconds (paused on hover/focus, and for reduced motion). */
function useRotating<T>(items: T[]) {
  const [start, setStart] = useState(0);
  const [paused, setPaused] = useState(false);
  const n = items.length;
  useEffect(() => {
    const still = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (n <= SHOWN || paused || still) return;
    const id = window.setInterval(() => setStart((s) => (s + SHOWN) % n), ROTATE_MS);
    return () => window.clearInterval(id);
  }, [n, paused]);
  const first = n ? start % n : 0;
  const visible = n <= SHOWN ? items : Array.from({ length: SHOWN }, (_, i) => items[(first + i) % n]!);
  const hold = { onMouseEnter: () => setPaused(true), onMouseLeave: () => setPaused(false), onFocus: () => setPaused(true), onBlur: () => setPaused(false) };
  const range = n > SHOWN ? `${SHOWN} of ${n}` : null;
  return { visible, hold, range, key: first };
}

export default function Attention({ people }: { people: Person[] }) {
  const rated = people.filter((p) => !isNotRated(p));
  const byConcern = (a: Person, b: Person) =>
    Number(b.assessment.trend === "declining") - Number(a.assessment.trend === "declining") || worstMood(b) - worstMood(a);
  // Anyone who needs support first, then people who are on track but have something specific to look at.
  const needs = [
    ...rated.filter((p) => p.assessment.rating === "needs_work").sort(byConcern),
    ...rated.filter((p) => p.assessment.rating === "solid" && p.assessment.improvements.length).sort(byConcern),
  ];
  const excelling = rated.filter((p) => p.assessment.rating === "strong").length;
  const well = rated
    .filter((p) => p.assessment.rating === "strong")
    .sort((a, b) => worstMood(a) - worstMood(b));
  const needsView = useRotating(needs);
  const wellView = useRotating(well);

  return (
    <motion.div className="attn" variants={stagger(0.06)}>
      <motion.section className="card attn-card" variants={fadeUp} aria-labelledby="attn-need">
        <div className="attn-h" id="attn-need">
          Worth a look
          {needsView.range && <span className="attn-range">{needsView.range}</span>}
        </div>
        {needs.length ? (
          <ul className="attn-list" key={needsView.key} {...needsView.hold}>
            {needsView.visible.map((p) => (
              <Row key={p.name} p={p} chip reason={p.assessment.improvements[0] ?? p.assessment.upsell_tips?.[0]} />
            ))}
          </ul>
        ) : (
          <p className="attn-empty">
            <strong>All clear.</strong>{" "}
            {rated.length
              ? `Everyone rated is on track or better (${excelling} of ${rated.length} excelling), and nothing specific needs following up.`
              : "Nobody has enough conversations to be rated yet."}
          </p>
        )}
      </motion.section>
      <motion.section className="card attn-card" variants={fadeUp} aria-labelledby="attn-well">
        <div className="attn-h" id="attn-well">
          Doing well
          {wellView.range && <span className="attn-range">{wellView.range}</span>}
        </div>
        {well.length ? (
          <ul className="attn-list" key={wellView.key} {...wellView.hold}>
            {wellView.visible.map((p) => (
              <Row key={p.name} p={p} reason={highlights(p)} />
            ))}
          </ul>
        ) : (
          <p className="attn-empty">Nobody is standing out yet.</p>
        )}
      </motion.section>
      <div className="attn-more">
        <Link to="/team?period=month">See everyone in Team →</Link>
      </div>
    </motion.div>
  );
}
