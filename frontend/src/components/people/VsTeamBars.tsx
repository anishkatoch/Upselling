import { motion, useReducedMotion } from "framer-motion";
import { DUR, EASE } from "../../lib/motion";
import type { Person } from "../../lib/api";
import { METRIC_INFO } from "../../lib/metricInfo";
import { moodFromFrustration } from "../../lib/teamLabels";
import { InfoTip } from "../ui";

type Row = {
  key: string;
  label: string;
  info: string;
  get: (p: Person) => number | null | undefined;
  /** Where the bar and the team tick sit, 0-1 (longer is always better). */
  pos: (v: number) => number;
  lowerIsBetter?: boolean;
  /** Gap that counts as "in line", in the metric's own units. */
  threshold: number;
  fmt: (v: number) => string;
  /** Spoken form of the value. */
  say: (v: number) => string;
  /** Hover text with the underlying number, where the shown value is a word. */
  hover?: (v: number) => string;
};

const pctFmt = (v: number) => `${Math.round(v * 100)}%`;
const pctSay = (v: number) => `${Math.round(v * 100)} percent`;
const oneDec = (v: number) => String(Math.round(v * 10) / 10);
const rate = (v: number) => Math.min(1, Math.max(0, v));

const ROWS: Row[] = [
  { key: "greet", label: "Greets customers", info: METRIC_INFO.greeting_rate, get: (p) => p.total.greeting_rate, pos: rate, threshold: 0.05, fmt: pctFmt, say: (v) => `${pctSay(v)} of conversations` },
  {
    key: "mood",
    label: "Customer mood",
    info: METRIC_INFO.frustration,
    get: (p) => p.total.avg_customer_frustration,
    // the bar shows how calm customers were, so a longer bar is better like on every other row
    pos: (v) => rate(1 - v / 10),
    lowerIsBetter: true,
    threshold: 0.5,
    fmt: (v) => moodFromFrustration(v).label,
    say: (v) => moodFromFrustration(v).label.toLowerCase(),
    hover: (v) => `Average tension score ${oneDec(v)} out of 10 (0 is calm)`,
  },
  { key: "upsell", label: "Tries to upsell", info: METRIC_INFO.upsell_rate, get: (p) => p.total.upsell_rate, pos: rate, threshold: 0.05, fmt: pctFmt, say: (v) => `${pctSay(v)} of conversations` },
  { key: "accept", label: "Customers say yes", info: METRIC_INFO.acceptance_rate, get: (p) => p.total.acceptance_rate, pos: rate, threshold: 0.05, fmt: pctFmt, say: (v) => `${pctSay(v)} of offers` },
];

type Verdict = "above" | "below" | "inline";
const VERDICT_TEXT: Record<Verdict, string> = { above: "Better than the team", below: "Behind the team", inline: "About the same" };
// "above"/"below" mean better/worse than the team. For tension, where lower is better, say it in plain words.
const VERDICT_TEXT_LOWER: Record<Verdict, string> = { above: "Calmer than the team", below: "More tense than the team", inline: "About the same" };
const verdictText = (v: Verdict, lowerIsBetter?: boolean) => (lowerIsBetter ? VERDICT_TEXT_LOWER : VERDICT_TEXT)[v];
const ARROW: Record<Verdict, string> = { above: "▲", below: "▼", inline: "–" };

/** "Compared with the team": this person's value against the mean of everyone on the board. */
export default function VsTeamBars({ person, people }: { person: Person; people: Person[] }) {
  const reduce = useReducedMotion();
  if (people.length < 2) return null;
  const rows = ROWS.map((r) => {
    const vals = people.map(r.get).filter((v): v is number => v != null);
    const team = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
    const mine = r.get(person) ?? null;
    let verdict: Verdict | null = null;
    if (mine != null && team != null) {
      const d = mine - team;
      verdict = Math.abs(d) < r.threshold ? "inline" : d > 0 !== !!r.lowerIsBetter ? "above" : "below";
    }
    return { r, mine, team, verdict, n: vals.length };
  });

  const first = person.name.split(" ")[0];
  return (
    <section className="flat-card vs-card" aria-label="Compared with the team">
      <div className="card-head">
        <h3>Compared with the team</h3>
        <span className="vs-key" aria-hidden="true">
          <i className="vs-key-bar" /> {first}
          <i className="vs-key-tick" /> Team average
        </span>
      </div>
      <div className="vs-cols" aria-hidden="true">
        <span />
        <span />
        <span>{first}</span>
        <span>Team</span>
        <span />
      </div>
      <ul className="vs-list">
        {rows.map(({ r, mine, team, verdict }, idx) => {
          const aria =
            mine == null
              ? `${r.label}: no data`
              : `${r.label} ${r.say(mine)}${team != null ? `, team ${r.say(team)}` : ""}${verdict ? `, ${verdictText(verdict, r.lowerIsBetter).toLowerCase()}` : ""}`;
          return (
            <li key={r.key} className="vs-row" aria-label={aria}>
              <span className="vs-lbl">
                {r.label}
                <InfoTip label={`About ${r.label}`}>{r.info}</InfoTip>
              </span>
              <div className="vs-track" aria-hidden="true">
                {mine != null && (
                  <motion.div
                    className="vs-fill"
                    initial={reduce ? false : { width: "0%" }}
                    whileInView={{ width: `${Math.min(100, Math.max(0, r.pos(mine) * 100))}%` }}
                    viewport={{ once: true }}
                    transition={{ duration: DUR.slow, ease: EASE, delay: idx * 0.06 }}
                  />
                )}
                {team != null && (
                  <motion.span
                    className="vs-tick"
                    style={{ left: `${Math.min(100, Math.max(0, r.pos(team) * 100))}%` }}
                    title={`Team average: ${r.fmt(team)}`}
                    initial={reduce ? false : { opacity: 0 }}
                    whileInView={{ opacity: 1 }}
                    viewport={{ once: true }}
                    transition={{ duration: DUR.base, ease: EASE, delay: DUR.slow * 0.8 + idx * 0.06 }}
                  />
                )}
              </div>
              <span className="vs-val" title={mine != null ? r.hover?.(mine) : undefined}>
                {mine == null ? "–" : r.fmt(mine)}
              </span>
              <span className="vs-team" title={team != null ? `Team average: ${r.fmt(team)}` : undefined}>
                {team != null ? r.fmt(team) : "–"}
              </span>
              <span className="vs-verdict-cell" aria-hidden="true">
                {verdict && (
                  <span className={`vs-verdict ${verdict === "above" ? "good" : verdict === "below" ? "bad" : ""}`}>
                    <span className="ar">{ARROW[verdict]}</span> {verdictText(verdict, r.lowerIsBetter)}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="vs-cap">The team figure is the average of all {people.length} salespeople.</p>
    </section>
  );
}
