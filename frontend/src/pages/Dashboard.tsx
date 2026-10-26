import { Link } from "react-router-dom";
import { AnimatedNumber, Stagger, StaggerItem } from "../components/motion";
import LineChart from "../components/LineChart";
import { describePrevious, formatPeriod } from "../lib/period";
import Attention from "../components/dashboard/Attention";
import Funnel from "../components/dashboard/Funnel";
import OutcomeBars from "../components/dashboard/OutcomeBars";
import SentimentDonut from "../components/dashboard/SentimentDonut";
import TechniqueBars from "../components/dashboard/TechniqueBars";
import { AlertTriangle, Headset } from "../icons/Icons";
import { Metric, MetricRow, DeltaChip } from "../components/ui";
import { METRIC_INFO } from "../lib/metricInfo";
import { api, type Job } from "../lib/api";
import { pct } from "../lib/format";
import { moodFromFrustration } from "../lib/teamLabels";
import { useLoad } from "../lib/hooks";
import { analysedCount, isNotRated } from "../components/people/rating";
import "../components/people/people.css";

/** A count-up number with its width reserved (tabular digits) so nothing shifts while it counts. */
function Num({ value, suffix = "" }: { value: number; suffix?: string }) {
  const w = `${String(Math.round(value)).length}ch`;
  return (
    <>
      <span style={{ display: "inline-block", minWidth: w }}>
        <AnimatedNumber value={value} />
      </span>
      {suffix}
    </>
  );
}
const pctNum = (v: number | null) => (v == null ? "–" : <Num value={Math.round(v * 100)} suffix="%" />);

const busy = (jobs: Job[]) => jobs.some((j) => j.status === "queued" || j.status === "running");

export default function Dashboard() {
  const { data: jobs, error: jobsError } = useLoad(() => api.jobs(), [], { every: 5000, keep: busy });
  const { data: board, error: boardError } = useLoad(() => api.dashboard("month"), []);

  const empty = jobs && jobs.length === 0;

  if (empty) {
    return (
      <div className="card empty" style={{ padding: "72px 24px" }}>
        <div className="icon-wrap">
          <Headset size={22} />
        </div>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 24, marginBottom: 6 }}>Welcome</h2>
        <p>No recordings to show yet.</p>
      </div>
    );
  }

  // Only people with activity in the current month count toward "this month": someone whose latest data is from an
  // earlier month would otherwise be mixed in.
  const activePeople = (board?.people ?? []).filter((p) => p.is_current !== false);
  const totals = activePeople.reduce(
    (a, p) => ({
      recordings: a.recordings + p.total.recordings,
      analysed: a.analysed + analysedCount(p.total),
      shared: a.shared + (p.total.shared_conversations ?? 0),
      greeted: a.greeted + p.total.greeted,
      solo: a.solo + (p.total.solo_analysed_conversations ?? 0),
      unanswered: a.unanswered + p.total.unanswered_questions,
      withUpsell: a.withUpsell + p.total.conversations_with_upsell,
      won: a.won + p.total.conversations_won,
      attempts: a.attempts + p.total.attempts,
      accepted: a.accepted + p.total.accepted,
      answered: a.answered + (p.total.answered_offers ?? 0),
      frustSum: a.frustSum + (p.total.avg_customer_frustration ?? 0) * analysedCount(p.total),
      frustN: a.frustN + (p.total.avg_customer_frustration != null ? analysedCount(p.total) : 0),
    }),
    { recordings: 0, analysed: 0, shared: 0, greeted: 0, solo: 0, unanswered: 0, withUpsell: 0, won: 0, attempts: 0, accepted: 0, answered: 0, frustSum: 0, frustN: 0 },
  );
  const upsellRate = totals && totals.analysed ? totals.withUpsell / totals.analysed : null;
  // Of the offers that got a clear yes or no (the same base the Team table and Person page use).
  const acceptRate = totals && totals.answered ? totals.accepted / totals.answered : null;
  const frustration = totals && totals.frustN ? totals.frustSum / totals.frustN : null;
  const greetRate = totals && totals.solo ? totals.greeted / totals.solo : null;

  const ratingCounts = (board?.people ?? []).reduce(
    (acc, p) => {
      if (isNotRated(p)) acc.not_rated += 1;
      else acc[p.assessment.rating] += 1;
      return acc;
    },
    { strong: 0, solid: 0, needs_work: 0, not_rated: 0 },
  );

  // Team point per period = weighted merge of every person's bucket for that period.
  const teamSeries = Object.entries(
    (board?.people ?? []).reduce<Record<string, { convs: number; withUpsell: number; answered: number; accepted: number; frustSum: number; frustN: number }>>((acc, p) => {
      for (const b of p.series) {
        const e = (acc[b.period] ??= { convs: 0, withUpsell: 0, answered: 0, accepted: 0, frustSum: 0, frustN: 0 });
        const n = analysedCount(b);
        e.convs += n;
        e.withUpsell += b.conversations_with_upsell;
        e.answered += b.answered_offers ?? 0;
        e.accepted += b.accepted;
        if (b.avg_customer_frustration != null) {
          e.frustSum += b.avg_customer_frustration * n;
          e.frustN += n;
        }
      }
      return acc;
    }, {}),
  )
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, v]) => ({
      period,
      rate: v.convs ? v.withUpsell / v.convs : null,
      accept: v.answered ? v.accepted / v.answered : null,
      frust: v.frustN ? v.frustSum / v.frustN : null,
    }));
  const orgTrend = teamSeries;
  const [prev, last] = teamSeries.slice(-2);
  const diff = (k: "rate" | "accept" | "frust", scale: number) =>
    prev && last && prev[k] != null && last[k] != null ? ((last[k] as number) - (prev[k] as number)) * scale : null;
  const mood = moodFromFrustration(frustration);
  const hasChange = !!(prev && last);
  const dot = (c: string) => <span style={{ width: 8, height: 8, borderRadius: "50%", background: c, display: "inline-block", flex: "none" }} />;
  const ratingStats = [
    { key: "needs_work", label: "Needs support", n: ratingCounts.needs_work, color: "var(--bad)" },
    { key: "solid", label: "On track", n: ratingCounts.solid, color: "var(--warn)" },
    { key: "strong", label: "Excelling", n: ratingCounts.strong, color: "var(--good)" },
    { key: "not_rated", label: "Not rated", n: ratingCounts.not_rated, color: "var(--faint)" },
  ];

  return (
    <Stagger gap={0.06}>
      <StaggerItem className="head row hero">
        <div className="grow">
          <div className="row" style={{ gap: 10 }}>
            <h1>Dashboard</h1>
          </div>
          <p className="sub">How your team is doing and who needs you.</p>
        </div>
      </StaggerItem>

      {(jobsError || boardError) && (
        <p className="error">
          <AlertTriangle size={16} /> {jobsError ?? boardError}
        </p>
      )}

      {hasChange && (
        <p className="sub small" style={{ margin: "0 0 8px" }}>
          Arrows show the change compared with {describePrevious("month", prev.period)}.
        </p>
      )}
      <StaggerItem>
      <MetricRow>
        <Metric
          label="Customer mood"
          info={
            <>
              {METRIC_INFO.frustration}
              {frustration != null && ` Team average score: ${frustration.toFixed(1)} out of 10 (0 is calm).`}
            </>
          }
          value={mood.label}
          foot={<DeltaChip value={diff("frust", 1)} lowerIsBetter upText="more tense" downText="calmer" />}
        />
        <Metric
          label="Greets customers"
          info={METRIC_INFO.greeting_rate}
          value={pctNum(greetRate)}
          unit={greetRate != null ? "of conversations" : undefined}
        />
        <Metric
          label="Questions left unanswered"
          info={METRIC_INFO.unanswered}
          value={totals && totals.analysed > 0 ? <Num value={totals.unanswered} /> : "–"}
        />
        <Metric
          label="Tries to upsell"
          info={METRIC_INFO.upsell_rate}
          value={pctNum(upsellRate)}
          unit={upsellRate != null ? "of conversations" : undefined}
          foot={<DeltaChip value={diff("rate", 100)} />}
        />
        <Metric
          label="Customers say yes"
          info={METRIC_INFO.acceptance_rate}
          value={pctNum(acceptRate)}
          unit={acceptRate != null ? "of offers" : undefined}
          foot={<DeltaChip value={diff("accept", 100)} />}
        />
      </MetricRow>
      </StaggerItem>

      {totals && totals.analysed > 0 && (
        <p className="sub small" style={{ margin: "10px 0 24px" }}>
          Based on {totals.analysed} conversation{totals.analysed === 1 ? "" : "s"} this month.
          {totals.shared > 0 &&
            ` ${totals.shared === 1 ? "One conversation had" : `${totals.shared} conversations had`} more than one salesperson and ${totals.shared === 1 ? "is" : "are"} left out of the greeting figures.`}
        </p>
      )}

      {board && board.people.length > 0 && (
        <>
          <StaggerItem className="metric-row" style={{ marginBottom: 24 }}>
            {ratingStats.map((r) => (
              <Link key={r.key} to={`/team?period=month&rating=${r.key}`} className="metric" style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 18px" }}>
                {dot(r.color)}
                <span style={{ color: "var(--muted)", fontSize: 13 }}>{r.label}</span>
                <b style={{ marginLeft: "auto", fontSize: 20, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{r.n}</b>
              </Link>
            ))}
          </StaggerItem>

          <StaggerItem>
            <Attention people={board.people} />
          </StaggerItem>

          {totals && totals.analysed > 0 && (
            <StaggerItem className="dash-row flip">
              <SentimentDonut people={board.people} />
              <OutcomeBars people={board.people} />
            </StaggerItem>
          )}

          {totals && totals.analysed > 0 && (
            <StaggerItem>
              <h2 className="section-title">Upselling</h2>
            </StaggerItem>
          )}

          {totals && totals.analysed > 0 && (
            <StaggerItem className="two" style={{ marginBottom: 24 }}>
              <Funnel
                steps={[
                  { label: "Customer conversations", n: totals.analysed },
                  { label: "Offered an upsell", n: totals.withUpsell },
                  { label: "Customer said yes", n: totals.won },
                ]}
              />
              {board.technique_stats && board.technique_stats.length > 0 && <TechniqueBars stats={board.technique_stats} />}
            </StaggerItem>
          )}

          {orgTrend.length > 2 && (
            <StaggerItem className="card" style={{ marginTop: 16, marginBottom: 24 }}>
              <div style={{ fontWeight: 600 }}>How often they try to upsell, over time</div>
              <div className="sub small" style={{ marginBottom: 10 }}>
                The share of conversations where an upsell was offered, for the whole team.
              </div>
              <LineChart data={orgTrend} value={(d) => d.rate} label={(d) => formatPeriod(d.period)} format={pct} xTitle="Month" yTitle="Tries to upsell" />
            </StaggerItem>
          )}
        </>
      )}
    </Stagger>
  );
}
