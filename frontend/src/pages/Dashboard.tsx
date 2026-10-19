import { useState } from "react";
import { Link } from "react-router-dom";
import CountUp from "../components/CountUp";
import LineChart from "../components/LineChart";
import { formatPeriod } from "../lib/period";
import StatusPill from "../components/StatusPill";
import TeamGlanceTable from "../components/TeamGlanceTable";
import { AlertTriangle, ChevronRight, Headset, Plus, Users } from "../icons/Icons";
import { api, type Job, type Person } from "../lib/api";
import { DEMO_DASHBOARD } from "../lib/demo";
import { ago, pct } from "../lib/format";
import { useLoad } from "../lib/hooks";

type Rating = Person["assessment"]["rating"];
const BUCKET_LABEL: Record<Rating, string> = { needs_work: "need coaching", solid: "solid performers", strong: "performing strong" };

const busy = (jobs: Job[]) => jobs.some((j) => j.status === "queued" || j.status === "running");

export default function Dashboard() {
  const [demo, setDemo] = useState(false);
  const [showFullTable, setShowFullTable] = useState(false);
  const [activeBucket, setActiveBucket] = useState<Rating | null>(null);
  const { data: jobs, error: jobsError } = useLoad(() => api.jobs(), [], { every: 5000, keep: busy });
  const { data: liveBoard, error: boardError } = useLoad(() => api.dashboard("month"), []);
  const board = demo ? DEMO_DASHBOARD.month : liveBoard;

  const empty = jobs && jobs.length === 0;

  if (empty && !demo) {
    return (
      <div className="card empty" style={{ padding: "72px 24px" }}>
        <div className="icon-wrap">
          <Headset size={22} />
        </div>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 24, marginBottom: 6 }}>Welcome</h2>
        <p style={{ marginBottom: 20 }}>Upload your first sales recording and we&apos;ll show you how it went.</p>
        <div className="row" style={{ justifyContent: "center", gap: 12 }}>
          <Link to="/upload" className="btn big">
            <Plus size={17} /> Upload a recording
          </Link>
          <button className="btn ghost big" title="Made-up team data, to show what it looks like" onClick={() => setDemo(true)}>
            View demo
          </button>
        </div>
      </div>
    );
  }

  const totals = board?.people.reduce(
    (a, p) => ({
      recordings: a.recordings + p.total.recordings,
      conversations: a.conversations + p.total.conversations,
      withUpsell: a.withUpsell + p.total.conversations_with_upsell,
      attempts: a.attempts + p.total.attempts,
      accepted: a.accepted + p.total.accepted,
    }),
    { recordings: 0, conversations: 0, withUpsell: 0, attempts: 0, accepted: 0 },
  );
  const upsellRate = totals && totals.conversations ? totals.withUpsell / totals.conversations : null;
  const acceptRate = totals && totals.attempts ? totals.accepted / totals.attempts : null;
  const recordingsCount = demo ? totals?.recordings : jobs?.length;

  // Condensed "team pulse" for the glance view - how many people land in each rating bucket,
  // reusing the same bad/warn/good stat-tile language as the Conversations summary tab.
  const ratingCounts = (board?.people ?? []).reduce(
    (acc, p) => {
      acc[p.assessment.rating] += 1;
      return acc;
    },
    { strong: 0, solid: 0, needs_work: 0 },
  );

  // A whole-team upsell-rate trend - one more view beside the numbers, not just a bigger table.
  // Merge every person's per-period Bucket into one weighted rate per period label.
  const orgTrend = Object.entries(
    (board?.people ?? []).reduce<Record<string, { convs: number; withUpsell: number }>>((acc, p) => {
      for (const b of p.series) {
        const e = (acc[b.period] ??= { convs: 0, withUpsell: 0 });
        e.convs += b.conversations;
        e.withUpsell += b.conversations_with_upsell;
      }
      return acc;
    }, {}),
  )
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, v]) => ({ period, rate: v.convs ? v.withUpsell / v.convs : null }));

  return (
    <>
      <div className="head row">
        <div className="grow">
          <div className="row" style={{ gap: 10 }}>
            <h1>Dashboard</h1>
            {demo && <span className="pill accent">Sample data</span>}
          </div>
          <p className="sub">
            {demo
              ? "Invented people and recordings, to show how this looks once your team has history."
              : "A quick look at how your team is selling."}
          </p>
        </div>
        <div className="row" style={{ gap: 10 }}>
          {demo ? (
            <button className="btn ghost" onClick={() => setDemo(false)}>
              Back to my data
            </button>
          ) : (
            <button className="btn ghost" title="Made-up team data, to show what it looks like" onClick={() => setDemo(true)}>
              View demo
            </button>
          )}
          <Link to="/upload" className="btn">
            <Plus size={16} /> New recording
          </Link>
        </div>
      </div>

      {!demo && (jobsError || boardError) && (
        <p className="error">
          <AlertTriangle size={16} /> {jobsError ?? boardError}
        </p>
      )}

      <div className="mini" style={{ marginBottom: 24 }}>
        <div>
          <b>{recordingsCount != null ? <CountUp value={recordingsCount} /> : "–"}</b>
          <span>Recordings analysed</span>
        </div>
        <div>
          <b>{pct(upsellRate)}</b>
          <span>Conversations with an upsell try</span>
        </div>
        <div>
          <b>{pct(acceptRate)}</b>
          <span>Offers accepted</span>
        </div>
        <div>
          <b>{board?.people.length != null ? <CountUp value={board.people.length} /> : "–"}</b>
          <span>Salespeople tracked</span>
        </div>
      </div>

      {board && board.people.length > 0 && (
        <>
          <div className="glance">
            <button
              className={`stat bad stat-btn ${activeBucket === "needs_work" ? "active" : ""}`}
              disabled={ratingCounts.needs_work === 0}
              onClick={() => setActiveBucket((v) => (v === "needs_work" ? null : "needs_work"))}
            >
              <b>{ratingCounts.needs_work}</b>
              <span>need coaching</span>
            </button>
            <button
              className={`stat warn stat-btn ${activeBucket === "solid" ? "active" : ""}`}
              disabled={ratingCounts.solid === 0}
              onClick={() => setActiveBucket((v) => (v === "solid" ? null : "solid"))}
            >
              <b>{ratingCounts.solid}</b>
              <span>solid performers</span>
            </button>
            <button
              className={`stat good stat-btn ${activeBucket === "strong" ? "active" : ""}`}
              disabled={ratingCounts.strong === 0}
              onClick={() => setActiveBucket((v) => (v === "strong" ? null : "strong"))}
            >
              <b>{ratingCounts.strong}</b>
              <span>performing strong</span>
            </button>
          </div>

          {activeBucket && (
            <div className="card reveal" style={{ marginTop: -6, marginBottom: 18 }}>
              <h3 className="eyebrow">Salespeople who {BUCKET_LABEL[activeBucket]}</h3>
              <ul className="list">
                {board.people
                  .filter((p) => p.assessment.rating === activeBucket)
                  .map((p) => (
                    <Link key={p.name} to={`/team/${encodeURIComponent(p.name)}`} state={{ demo }} className="item">
                      <div className="item-icon">
                        <Users size={16} />
                      </div>
                      <div className="grow">
                        <div className="name">{p.name}</div>
                        <div className="sub small">{p.assessment.headline}</div>
                      </div>
                      <ChevronRight size={16} className="item-chev" />
                    </Link>
                  ))}
              </ul>
            </div>
          )}

          {orgTrend.length > 1 && (
            <div className="card" style={{ marginTop: 16, marginBottom: 24 }}>
              <div className="sub small" style={{ marginBottom: 7, fontWeight: 600 }}>
                Team upsell rate over time
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
              <TeamGlanceTable people={board.people} demo={demo} />
            </div>
          )}
        </>
      )}

      {!demo && board && board.unassigned.length > 0 && (
        <Link to="/team" className="card row" style={{ marginBottom: 24, gap: 14 }}>
          <div className="item-icon">
            <Users size={16} />
          </div>
          <div className="grow">
            <b>
              {board.unassigned.length} salesperson{board.unassigned.length > 1 ? "s" : ""} need a name
            </b>
            <div className="sub small">So their recordings get grouped together on the Team page.</div>
          </div>
          <ChevronRight size={16} className="item-chev" />
        </Link>
      )}

      {demo ? (
        <Link to="/team" state={{ demo: true }} className="card row" style={{ gap: 14 }}>
          <div className="item-icon">
            <Users size={16} />
          </div>
          <div className="grow">
            <b>See each salesperson&apos;s full demo report</b>
            <div className="sub small">Daily, weekly and monthly detail, coaching notes and trends, on the Team page.</div>
          </div>
          <ChevronRight size={16} className="item-chev" />
        </Link>
      ) : (
        <>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 2 }}>
            <h2 style={{ marginBottom: 0 }}>Recent recordings</h2>
            <Link to="/recordings" className="link small">
              See all
            </Link>
          </div>
          <div className="card" style={{ marginTop: 12 }}>
            {!jobs && <div className="skeleton" style={{ height: 180 }} />}
            {jobs && (
              <ul className="list">
                {jobs.slice(0, 5).map((j) => (
                  <Link key={j.job_id} to={`/recordings/${j.job_id}`} className="item">
                    <div className="item-icon">
                      <Headset size={17} />
                    </div>
                    <div className="grow">
                      <div className="name">{j.filename}</div>
                      <div className="sub small">
                        {ago(j.created_at)}
                        {j.salesperson_name ? ` · ${j.salesperson_name}` : ""}
                      </div>
                    </div>
                    <StatusPill job={j} />
                    <ChevronRight size={16} className="item-chev" />
                  </Link>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </>
  );
}
