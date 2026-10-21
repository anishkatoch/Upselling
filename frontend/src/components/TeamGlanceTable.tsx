import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Minus, TrendDown, TrendUp } from "../icons/Icons";
import type { Person } from "../lib/api";
import { pct } from "../lib/format";
import { METRIC_INFO } from "../lib/metricInfo";
import { analysedCount, isNotRated, RatingChip, seriesDelta, StalePeriodBadge } from "./people/rating";
import { DeltaChip, InfoTip } from "./ui";
import "./people/people.css";

type SortKey = "name" | "rating" | "upsell" | "accepted";
type SortState = { key: SortKey; dir: "asc" | "desc" } | null;
const RATING_ORDER = { strong: 3, solid: 2, needs_work: 1 } as const;

const sortValue = (p: Person, k: SortKey): number | string => {
  switch (k) {
    case "name":
      return p.name.toLowerCase();
    case "rating":
      return isNotRated(p) ? 0 : RATING_ORDER[p.assessment.rating];
    case "upsell":
      return p.total.upsell_rate ?? -1;
    case "accepted":
      return p.total.acceptance_rate ?? -1;
  }
};

function Th({
  children,
  info,
  num,
  sortKey,
  sort,
  onSort,
}: {
  children: ReactNode;
  info?: string;
  num?: boolean;
  sortKey?: SortKey;
  sort: SortState;
  onSort: (k: SortKey) => void;
}) {
  const active = sortKey != null && sort?.key === sortKey ? sort : null;
  const aria = sortKey ? (active ? (active.dir === "asc" ? "ascending" : "descending") : "none") : undefined;
  return (
    <th scope="col" className={num ? "num" : undefined} aria-sort={aria}>
      <span className="th-in">
        {sortKey ? (
          <button type="button" className="sort" onClick={() => onSort(sortKey)}>
            {children}
            <span aria-hidden="true">{active ? (active.dir === "asc" ? "↑" : "↓") : ""}</span>
          </button>
        ) : (
          children
        )}
        {info && <InfoTip>{info}</InfoTip>}
      </span>
    </th>
  );
}

/**
 * The "how is everyone doing right now" table - shared by Dashboard (fixed month snapshot)
 * and Team (whichever period is selected). The whole row opens /team/:name; the name stays a real link for keyboard users.
 *
 * `collapsedRows`, when set, shows only the first N people plus a "Show full team table" button
 * that reveals the rest in place. Omit it (Team.tsx's usage) for the unchanged, always-full table.
 */
export default function TeamGlanceTable({ people, collapsedRows }: { people: Person[]; collapsedRows?: number }) {
  const [expanded, setExpanded] = useState(false);
  const [sort, setSort] = useState<SortState>({ key: "rating", dir: "asc" });
  const navigate = useNavigate();
  const sorted = useMemo(() => {
    if (!sort) return people;
    const m = sort.dir === "asc" ? 1 : -1;
    return [...people].sort((a, b) => {
      // People who could not be rated stay at the bottom whichever way the rating column is sorted.
      if (sort.key === "rating" && isNotRated(a) !== isNotRated(b)) return isNotRated(a) ? 1 : -1;
      const x = sortValue(a, sort.key);
      const y = sortValue(b, sort.key);
      return (x < y ? -1 : x > y ? 1 : 0) * m;
    });
  }, [people, sort]);
  if (people.length === 0) return null;
  const limited = collapsedRows != null && !expanded && sorted.length > collapsedRows;
  const shown = limited ? sorted.slice(0, collapsedRows) : sorted;

  const toggle = (key: SortKey) =>
    setSort((s) => (s?.key === key ? (s.dir === "asc" ? { key, dir: "desc" } : null) : { key, dir: key === "name" ? "asc" : "desc" }));

  return (
    <section className="card tg team-glance" style={{ marginBottom: 16 }}>
      <div className="tg-head">
        <h2>Team at a glance</h2>
        <span className="sub small">Click a row for the full breakdown</span>
      </div>
      <div className="table-wrap">
        <table>
          <caption className="sr-only">Team at a glance: one row per salesperson</caption>
          <thead>
            <tr>
              <Th sort={sort} onSort={toggle} sortKey="name">
                Salesperson
              </Th>
              <Th sort={sort} onSort={toggle} sortKey="rating" info={METRIC_INFO.rating}>
                Rating
              </Th>
              <Th sort={sort} onSort={toggle} num sortKey="upsell" info={METRIC_INFO.upsell_rate}>
                Upsell rate
              </Th>
              <Th sort={sort} onSort={toggle} num sortKey="accepted" info={METRIC_INFO.acceptance_rate}>
                Acceptance rate
              </Th>
              <Th sort={sort} onSort={toggle} num info={METRIC_INFO.greeting_rate}>
                Greeted
              </Th>
              <Th sort={sort} onSort={toggle} num info={METRIC_INFO.frustration}>
                Avg frustration
              </Th>
              <Th sort={sort} onSort={toggle} num info={METRIC_INFO.effort}>
                Effort
              </Th>
              <Th sort={sort} onSort={toggle}>
                Trend
              </Th>
            </tr>
          </thead>
          <tbody>
            {shown.map((p, i) => {
              const t = p.total;
              const trend = p.assessment.trend;
              const TrendIcon = trend === "improving" ? TrendUp : trend === "declining" ? TrendDown : Minus;
              const trendText = trend === "improving" ? "Improving" : trend === "declining" ? "Slipping" : "Steady";
              const justRevealed = expanded && collapsedRows != null && i >= collapsedRows;
              const href = `/team/${encodeURIComponent(p.name)}`;
              const shared = t.shared_conversations ?? 0;
              return (
                <tr
                  key={p.name}
                  className={`rowlink${justRevealed ? " reveal" : ""}`}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("a,button")) return;
                    navigate(href);
                  }}
                >
                  <th scope="row" className="rowhead">
                    <Link to={href} className="name-link">
                      {p.name}
                    </Link>{" "}
                    <StalePeriodBadge person={p} />
                    <div
                      className="sub small"
                      title={
                        shared > 0
                          ? `${shared} conversation(s) with more than one salesperson are not counted in greeting, pushy and unanswered-question figures.`
                          : undefined
                      }
                    >
                      {analysedCount(t)} analysed{shared > 0 ? " *" : ""}
                    </div>
                  </th>
                  <td>
                    <RatingChip person={p} short />
                  </td>
                  <td className="num">
                    {pct(t.upsell_rate)}
                    <div className="cell-sub">
                      <DeltaChip value={seriesDelta(p.series, "upsell_rate", 100)} unit="pt" />
                    </div>
                  </td>
                  <td className="num">
                    {pct(t.acceptance_rate)}
                    <div className="cell-sub">
                      <DeltaChip value={seriesDelta(p.series, "acceptance_rate", 100)} unit="pt" />
                    </div>
                  </td>
                  <td className="num">{pct(t.greeting_rate)}</td>
                  <td className="num">
                    {t.avg_customer_frustration ?? "–"}
                    {t.avg_customer_frustration != null && <span className="muted-unit"> /10</span>}
                  </td>
                  <td className="num">
                    {t.avg_effort ?? "–"}
                    {t.avg_effort != null && <span className="muted-unit"> /10</span>}
                  </td>
                  <td>
                    <span className="trend-cell">
                      {trend ? (
                        <span className={`trend ${trend}`}>
                          <TrendIcon size={14} /> {trendText}
                        </span>
                      ) : (
                        <span className="sub small">–</span>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {limited && (
        <button className="btn ghost small" style={{ marginTop: 10 }} onClick={() => setExpanded(true)}>
          Show full team table ({people.length} total)
        </button>
      )}
      <p className="sub small tg-note">
        &ldquo;Analysed&rdquo; is the number of conversations the figures are based on. Changes compare with the previous period.
        {people.some((p) => (p.total.shared_conversations ?? 0) > 0) &&
          " * Conversations with more than one salesperson are not counted in greeting, pushy and unanswered-question figures."}
      </p>
    </section>
  );
}
