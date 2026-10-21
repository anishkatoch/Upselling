import { useState } from "react";
import { Link } from "react-router-dom";
import CountUp from "../components/CountUp";
import LineChart from "../components/LineChart";
import { formatPeriod } from "../lib/period";
import TeamGlanceTable from "../components/TeamGlanceTable";
import Funnel from "../components/dashboard/Funnel";
import OutcomeBars from "../components/dashboard/OutcomeBars";
import SentimentDonut from "../components/dashboard/SentimentDonut";
import TechniqueBars from "../components/dashboard/TechniqueBars";
import { AlertTriangle, Headset } from "../icons/Icons";
import { Metric, MetricRow, DeltaChip } from "../components/ui";
import { METRIC_INFO } from "../lib/metricInfo";
import { api, type Job } from "../lib/api";
import { pct } from "../lib/format";
import { useLoad } from "../lib/hooks";
import { analysedCount, isNotRated } from "../components/people/rating";
import "../components/people/people.css";

const busy = (jobs: Job[]) => jobs.some((j) => j.status === "queued" || j.status === "running");

export default function Dashboard() {
  const [showFullTable, setShowFullTable] = useState(false);
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

  const totals = board?.people.reduce(
    (a, p) => ({
      recordings: a.recordings + p.total.recordings,
      analysed: a.analysed + analysedCount(p.total),
      shared: a.shared + (p.total.shared_conversations ?? 0),
      withUpsell: a.withUpsell + p.total.conversations_with_upsell,
      won: a.won + p.total.conversations_won,
      attempts: a.attempts + p.total.attempts,
      accepted: a.accepted + p.total.accepted,
      frustSum: a.frustSum + (p.total.avg_customer_frustration ?? 0) * analysedCount(p.total),
      frustN: a.frustN + (p.total.avg_customer_frustration != null ? analysedCount(p.total) : 0),
    }),
    { recordings: 0, analysed: 0, shared: 0, withUpsell: 0, won: 0, attempts: 0, accepted: 0, frustSum: 0, frustN: 0 },
  );
  const upsellRate = totals && totals.analysed ? totals.withUpsell / totals.analysed : null;
  const acceptRate = totals && totals.attempts ? totals.accepted / totals.attempts : null;
  const frustration = totals && totals.frustN ? totals.frustSum / totals.frustN : null;
  const recordingsCount = jobs?.length;

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
    (board?.people ?? []).reduce<Record<string, { convs: number; withUpsell: number; attempts: number; accepted: number; frustSum: number; frustN: number }>>((acc, p) => {
      for (const b of p.series) {
        const e = (acc[b.period] ??= { convs: 0, withUpsell: 0, attempts: 0, accepted: 0, frustSum: 0, frustN: 0 });
        const n = analysedCount(b);
        e.convs += n;
        e.withUpsell += b.conversations_with_upsell;
        e.attempts += b.attempts;
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
      accept: v.attempts ? v.accepted / v.attempts : null,
      frust: v.frustN ? v.frustSum / v.frustN : null,
    }));
  const orgTrend = teamSeries;
  const [prev, last] = teamSeries.slice(-2);
  const diff = (k: "rate" | "accept" | "frust", scale: number) =>
    prev && last && prev[k] != null && last[k] != null ? ((last[k] as number) - (prev[k] as number)) * scale : null;
  const sample = totals && totals.analysed > 0 ? `n = ${totals.analysed} conversation${totals.analysed === 1 ? "" : "s"}` : null;
  const dot = (c: string) => <span style={{ width: 8, height: 8, borderRadius: "50%", background: c, display: "inline-block", flex: "none" }} />;
  const ratingStats = [
    { label: "Needs support", n: ratingCounts.needs_work, color: "var(--bad)" },
    { label: "On track", n: ratingCounts.solid, color: "var(--warn)" },
    { label: "Excelling", n: ratingCounts.strong, color: "var(--good)" },
    { label: "Not rated", n: ratingCounts.not_rated, color: "var(--faint)" },
  ];

  return (
    <>
      <div className="head row">
        <div className="grow">
          <div className="row" style={{ gap: 10 }}>
            <h1>Dashboard</h1>
          </div>
          <p className="sub">A quick look at how your team is selling.</p>
        </div>
      </div>

      {(jobsError || boardError) && (
        <p className="error">
          <AlertTriangle size={16} /> {jobsError ?? boardError}
        </p>
      )}

      <MetricRow>
        <Metric
          label="Recordings analysed"
          info={METRIC_INFO.recordings}
          value={recordingsCount != null ? <CountUp value={recordingsCount} /> : "–"}
        />
        <Metric
          label="Upsell rate"
          info={METRIC_INFO.upsell_rate}
          value={pct(upsellRate)}
          foot={
            <>
              <DeltaChip value={diff("rate", 100)} />
              {sample && <span>{sample}</span>}
            </>
          }
        />
        <Metric
          label="Acceptance rate"
          info={METRIC_INFO.acceptance_rate}
          value={pct(acceptRate)}
          foot={
            <>
              <DeltaChip value={diff("accept", 100)} />
              {totals && totals.attempts > 0 && <span>n = {totals.attempts} offers</span>}
            </>
          }
        />
        <Metric
          label="Avg customer frustration"
          info={METRIC_INFO.frustration}
          value={frustration != null ? frustration.toFixed(1) : "–"}
          unit={frustration != null ? "/ 10" : undefined}
          foot={<DeltaChip value={diff("frust", 1)} unit="" lowerIsBetter />}
        />
        <Metric
          label="Salespeople tracked"
          value={board?.people.length != null ? <CountUp value={board.people.length} /> : "–"}
        />
      </MetricRow>

      {totals && totals.analysed > 0 && (
        <p className="sub small" style={{ margin: "10px 0 24px" }}>
          Based on {totals.analysed} analysed conversation{totals.analysed === 1 ? "" : "s"}. Changes compare the latest month with the one before.
          {totals.shared > 0 &&
            ` ${totals.shared} conversation${totals.shared === 1 ? "" : "s"} with more than one salesperson ${totals.shared === 1 ? "is" : "are"} not counted in greeting, pushy and unanswered-question figures.`}
        </p>
      )}

      {board && board.people.length > 0 && (
        <>
          <div className="metric-row" style={{ marginBottom: 24 }}>
            {ratingStats.map((r) => (
              <Link key={r.label} to="/team" className="metric" style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 18px" }}>
                {dot(r.color)}
                <span style={{ color: "var(--muted)", fontSize: 13 }}>{r.label}</span>
                <b style={{ marginLeft: "auto", fontSize: 20, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{r.n}</b>
              </Link>
            ))}
          </div>

          {totals && totals.analysed > 0 && (
            <div className="dash-row">
              <OutcomeBars people={board.people} />
              <SentimentDonut people={board.people} />
            </div>
          )}

          {totals && totals.analysed > 0 && (
            <div className="two" style={{ marginBottom: 24 }}>
              <Funnel
                steps={[
                  { label: "Customer conversations", n: totals.analysed },
                  { label: "Upsell tried", n: totals.withUpsell },
                  { label: "Customer accepted an offer", n: totals.won },
                ]}
              />
              {board.technique_stats && board.technique_stats.length > 0 && <TechniqueBars stats={board.technique_stats} />}
            </div>
          )}

          {orgTrend.length > 2 && (
            <div className="card" style={{ marginTop: 16, marginBottom: 24 }}>
              <div style={{ fontWeight: 600 }}>Upsell rate over time</div>
              <div className="sub small" style={{ marginBottom: 10 }}>
                Share of conversations where an upsell was tried, whole team.
              </div>
              <LineChart data={orgTrend} value={(d) => d.rate} label={(d) => formatPeriod(d.period)} format={pct} xTitle="Month" yTitle="Upsell rate" />
            </div>
          )}

          <div className="row" style={{ justifyContent: "flex-end", marginBottom: 24 }}>
            <button className="btn ghost small" onClick={() => setShowFullTable((v) => !v)}>
              {showFullTable ? "Hide full team table" : `Show full team table (${board.people.length})`}
            </button>
          </div>
          {showFullTable && (
            <div className="reveal">
              <TeamGlanceTable people={board.people} />
            </div>
          )}
        </>
      )}

    </>
  );
}
