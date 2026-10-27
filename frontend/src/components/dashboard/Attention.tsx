import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { AlertTriangle, Check } from "../../icons/Icons";
import type { Person } from "../../lib/api";
import { RatingChip, isNotRated } from "../people/rating";
import { fadeUp, stagger } from "../../lib/motion";
import "./attention.css";

function shorten(text: string | undefined, max = 110) {
  const t = text?.trim();
  if (!t) return null;
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const i = cut.lastIndexOf(" ");
  return (i > 40 ? cut.slice(0, i) : cut).replace(/[\s,.;:–-]+$/, "") + "…";
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

function Row({ p, reason }: { p: Person; reason: string | undefined }) {
  const why = shorten(reason);
  return (
    <li className="attn-row">
      <span className="attn-avatar" aria-hidden="true">
        {initials(p.name)}
      </span>
      <div className="attn-main">
        <Link to={`/team/${encodeURIComponent(p.name)}`} className="attn-name">
          {p.name}
        </Link>
        {why && <div className="attn-why">{why}</div>}
      </div>
      <RatingChip person={p} short />
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

const SHOWN = 3; // rows in each card; with more people the card moves through them in pages
const ROTATE_MS = 7000;

/** The list in pages of `SHOWN` (1-3, then 4-5, then back to 1-3). Moves on every few seconds; hover, focus or "reduce motion" hold it. */
function usePages<T>(items: T[]) {
  const [page, setPage] = useState(0);
  const [paused, setPaused] = useState(false);
  const pages = Math.max(1, Math.ceil(items.length / SHOWN));
  useEffect(() => {
    const still = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (pages <= 1 || paused || still) return;
    const id = window.setInterval(() => setPage((x) => (x + 1) % pages), ROTATE_MS);
    return () => window.clearInterval(id);
  }, [pages, paused]);
  const current = page % pages; // the list can shrink while a later page is showing
  const from = current * SHOWN;
  const hold = {
    onMouseEnter: () => setPaused(true),
    onMouseLeave: () => setPaused(false),
    onFocus: () => setPaused(true),
    onBlur: () => setPaused(false),
  };
  return { visible: items.slice(from, from + SHOWN), current, pages, setPage, hold };
}

function Card({
  tone,
  id,
  title,
  items,
  reason,
  empty,
}: {
  tone: "todo" | "good";
  id: string;
  title: string;
  items: Person[];
  reason: (p: Person) => string | undefined;
  empty: React.ReactNode;
}) {
  const v = usePages(items);
  return (
    <motion.section className={`card attn-card is-${tone}`} variants={fadeUp} aria-labelledby={id}>
      <div className="attn-h">
        <span className="attn-ico" aria-hidden="true">
          {tone === "good" ? <Check size={14} /> : <AlertTriangle size={14} />}
        </span>
        <h3 id={id}>{title}</h3>
        {v.pages > 1 && (
          <div className="attn-dots" role="group" aria-label={`${title}: page`}>
            {Array.from({ length: v.pages }, (_, i) => (
              <button
                key={i}
                type="button"
                className={i === v.current ? "on" : ""}
                aria-label={`Show page ${i + 1} of ${v.pages}`}
                aria-current={i === v.current}
                onClick={() => v.setPage(i)}
              />
            ))}
          </div>
        )}
      </div>
      {items.length ? (
        <ul className="attn-list" key={v.current} {...v.hold}>
          {v.visible.map((p) => (
            <Row key={p.name} p={p} reason={reason(p)} />
          ))}
        </ul>
      ) : (
        <p className="attn-empty">{empty}</p>
      )}
    </motion.section>
  );
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
  // Excelling first; then the steadiest people on track, so the card is not left with one or two names.
  const well = [
    ...rated.filter((p) => p.assessment.rating === "strong").sort((a, b) => worstMood(a) - worstMood(b)),
    ...rated
      .filter((p) => p.assessment.rating === "solid" && worstMood(p) < 5 && highlights(p))
      .sort((a, b) => a.assessment.improvements.length - b.assessment.improvements.length || worstMood(a) - worstMood(b)),
  ];

  return (
    <motion.div className="attn" variants={stagger(0.06)}>
      <Card
        tone="todo"
        id="attn-need"
        title="Worth a look"
        items={needs}
        reason={(p) => p.assessment.improvements[0] ?? p.assessment.upsell_tips?.[0]}
        empty={
          <>
            <strong>All clear.</strong>{" "}
            {rated.length
              ? `Everyone rated is on track or better (${excelling} of ${rated.length} excelling), and nothing specific needs following up.`
              : "Nobody has enough conversations to be rated yet."}
          </>
        }
      />
      <Card tone="good" id="attn-well" title="Doing well" items={well} reason={highlights} empty="Nobody is standing out yet." />
      <div className="attn-more">
        <Link to="/team?period=month">See everyone in Team →</Link>
      </div>
    </motion.div>
  );
}
