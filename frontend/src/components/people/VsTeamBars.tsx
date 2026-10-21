import type { Person } from "../../lib/api";
import { METRIC_INFO } from "../../lib/metricInfo";
import { InfoTip } from "../ui";

type Row = {
  key: string;
  label: string;
  info: string;
  get: (p: Person) => number | null | undefined;
  /** Value scale: rates run 0-1, frustration 0-10. */
  max: number;
  lowerIsBetter?: boolean;
  /** Gap that counts as "in line", in the metric's own units. */
  threshold: number;
  fmt: (v: number) => string;
  /** Spoken form of the value. */
  say: (v: number) => string;
};

const pctFmt = (v: number) => `${Math.round(v * 100)}%`;
const pctSay = (v: number) => `${Math.round(v * 100)} percent`;
const oneDec = (v: number) => String(Math.round(v * 10) / 10);

const ROWS: Row[] = [
  { key: "upsell", label: "Upsell rate", info: METRIC_INFO.upsell_rate, get: (p) => p.total.upsell_rate, max: 1, threshold: 0.05, fmt: pctFmt, say: pctSay },
  { key: "accept", label: "Acceptance rate", info: METRIC_INFO.acceptance_rate, get: (p) => p.total.acceptance_rate, max: 1, threshold: 0.05, fmt: pctFmt, say: pctSay },
  { key: "greet", label: "Greeted", info: METRIC_INFO.greeting_rate, get: (p) => p.total.greeting_rate, max: 1, threshold: 0.05, fmt: pctFmt, say: pctSay },
  {
    key: "frust",
    label: "Customer frustration",
    info: METRIC_INFO.frustration,
    get: (p) => p.total.avg_customer_frustration,
    max: 10,
    lowerIsBetter: true,
    threshold: 0.5,
    fmt: (v) => `${oneDec(v)} / 10`,
    say: (v) => `${oneDec(v)} out of 10`,
  },
];

type Verdict = "above" | "below" | "inline";
const VERDICT_TEXT: Record<Verdict, string> = { above: "Above team", below: "Below team", inline: "In line" };
// "above"/"below" mean better/worse than the team. For frustration, where lower is better, say it in plain words.
const VERDICT_TEXT_LOWER: Record<Verdict, string> = { above: "Calmer than team", below: "More frustrated than team", inline: "In line" };
const verdictText = (v: Verdict, lowerIsBetter?: boolean) => (lowerIsBetter ? VERDICT_TEXT_LOWER : VERDICT_TEXT)[v];
const ARROW: Record<Verdict, string> = { above: "▲", below: "▼", inline: "–" };

/** "Compared with the team": this person's value against the mean of everyone on the board. */
export default function VsTeamBars({ person, people }: { person: Person; people: Person[] }) {
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
  const n = Math.max(...rows.map((x) => x.n));

  return (
    <section className="flat-card vs-card" aria-label="Compared with the team">
      <h3>Compared with the team</h3>
      <ul className="vs-list">
        {rows.map(({ r, mine, team, verdict }) => {
          const aria =
            mine == null
              ? `${r.label}: no data`
              : `${r.label} ${r.say(mine)}${team != null ? `, team average ${r.say(team)}` : ""}${verdict ? `, ${verdictText(verdict, r.lowerIsBetter).toLowerCase()}` : ""}`;
          return (
            <li key={r.key} className="vs-row" aria-label={aria}>
              <div className="vs-top">
                <span className="vs-lbl">
                  {r.label}
                  <InfoTip label={`About ${r.label}`}>{r.info}</InfoTip>
                </span>
                <span className="vs-val">{mine == null ? "-" : r.fmt(mine)}</span>
              </div>
              <div className="vs-mid">
                <div className="vs-track" aria-hidden="true">
                  {mine != null && <div className="vs-fill" style={{ width: `${Math.min(100, Math.max(0, (mine / r.max) * 100))}%` }} />}
                  {team != null && (
                    <span className="vs-tick" style={{ left: `${Math.min(100, Math.max(0, (team / r.max) * 100))}%` }} title={`Team average ${r.fmt(team)}`} />
                  )}
                </div>
                <span className="vs-team" title={team != null ? `Team average: ${r.fmt(team)}` : undefined}>
                  {team != null ? `Team ${r.fmt(team)}` : "Team -"}
                </span>
              </div>
              <div className="vs-verdict-line">
                {verdict && (
                  <span className={`vs-verdict ${verdict === "above" ? "good" : verdict === "below" ? "bad" : ""}`} aria-hidden="true">
                    {ARROW[verdict]} {verdictText(verdict, r.lowerIsBetter)}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="vs-cap">Team average across {n} salespeople</p>
    </section>
  );
}
