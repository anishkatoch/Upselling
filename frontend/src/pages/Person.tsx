import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import LineChart from "../components/LineChart";
import { formatPeriod, type Period } from "../lib/period";
import { AlertTriangle, ArrowLeft, Minus, TrendDown, TrendUp } from "../icons/Icons";
import { api, type Person } from "../lib/api";
import { pct } from "../lib/format";
import { useLoad } from "../lib/hooks";
import { METRIC_INFO } from "../lib/metricInfo";
import { DeltaChip, Metric, MetricRow } from "../components/ui";
import { PERIOD_LABEL } from "../lib/teamLabels";
import VsTeamBars from "../components/people/VsTeamBars";
import PersonSentiment from "../components/people/PersonSentiment";
import RecentConversations from "../components/people/RecentConversations";
import { RatingChip, SampleNote, seriesDelta, StalePeriodNotice } from "../components/people/rating";
import "../components/people/people.css";

/**
 * One salesperson's deep-dive profile (KPI-tile styled, screenshot-B language): the dedicated
 * page a name in the team-at-a-glance table now links to, replacing Team.tsx's old inline
 * toggle card. Aggregated numbers come from the same `dashboard.py` Bucket/assessment data as
 * the glance table; the recent-conversations list links through to the call behind the numbers.
 */
export default function PersonPage() {
  const { name: rawName } = useParams<{ name: string }>();
  // react-router already decodes path params (see its decodePath()), so this is the real
  // name as-is - decoding it again here would throw on a name containing a literal "%".
  const name = rawName ?? "";
  const [period, setPeriod] = useState<Period>("week");

  // Jumping into a fresh profile page should land at the top, same as Team.tsx did when
  // switching between an inline person card and "all salespeople".
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [name]);

  const { data: board, error } = useLoad(() => api.dashboard(period), [period]);
  const person = board?.people.find((p) => p.name === name);

  return (
    <>
      <Link to="/team" className="back" style={{ marginBottom: 16 }}>
        <ArrowLeft size={15} /> All salespeople
      </Link>

      {error && (
        <p className="error">
          <AlertTriangle size={16} /> {error}
        </p>
      )}
      {!board && !error && <div className="skeleton" style={{ height: 320 }} />}

      {board && !person && (
        <div className="card empty">
          <h2>No data for {name}</h2>
          <p>They have no recorded activity in this period.</p>
        </div>
      )}

      {board && person && <PersonDetail person={person} people={board.people} period={period} setPeriod={setPeriod} />}
    </>
  );
}

function PersonDetail({
  person: p,
  people,
  period,
  setPeriod,
}: {
  person: Person;
  people: Person[];
  period: Period;
  setPeriod: (p: Period) => void;
}) {
  const a = p.assessment;
  const t = p.total;
  const TrendIcon = a.trend === "improving" ? TrendUp : a.trend === "declining" ? TrendDown : Minus;
  const [showAllStrengths, setShowAllStrengths] = useState(false);
  const [showAllImprovements, setShowAllImprovements] = useState(false);

  // The sample size is stated once in the caption under the headline (SampleNote), not on every tile.
  const vs = (value: number | null | undefined, unit: string, lowerIsBetter = false) =>
    value == null ? null : (
      <>
        <DeltaChip value={value} unit={unit} lowerIsBetter={lowerIsBetter} />
        <span>vs previous {period}</span>
      </>
    );
  const shownStrengths = showAllStrengths ? a.strengths : a.strengths.slice(0, 2);
  const shownImprovements = showAllImprovements ? a.improvements : a.improvements.slice(0, 2);

  return (
    <div className="person-flat">
      <div className="person-hero">
        <div className="person-head">
          <div className="grow">
            <h1>{p.name}</h1>
            <div className="sub small">
              {t.recordings} recording{t.recordings !== 1 ? "s" : ""} · {t.conversations} customer conversation
              {t.conversations !== 1 ? "s" : ""} · {PERIOD_LABEL[period]}
            </div>
          </div>
          {a.trend && (
            <span className={`trend ${a.trend}`}>
              <TrendIcon size={15} /> {a.trend === "improving" ? "Improving" : a.trend === "declining" ? "Slipping" : "Steady"}
            </span>
          )}
          <RatingChip person={p} />
          <div className="seg">
            {(["day", "week", "month"] as Period[]).map((per) => (
              <button key={per} className={period === per ? "on" : ""} onClick={() => setPeriod(per)}>
                {per === "day" ? "Daily" : per === "week" ? "Weekly" : "Monthly"}
              </button>
            ))}
          </div>
        </div>

        {p.is_current === false && (
          <div style={{ marginTop: 14 }}>
            <StalePeriodNotice person={p} unit={period} />
          </div>
        )}

        <p style={{ marginTop: 12 }}>
          {a.headline}
          {a.low_sample && <span className="sub"> (based on very little data so far)</span>}
        </p>
        <SampleNote bucket={t} />
      </div>

      <div className="metric-group">
        <MetricRow>
          <Metric label="Upsell rate" info={METRIC_INFO.upsell_rate} value={pct(t.upsell_rate)} foot={vs(seriesDelta(p.series, "upsell_rate", 100), "pt")} />
          <Metric label="Acceptance rate" info={METRIC_INFO.acceptance_rate} value={pct(t.acceptance_rate)} foot={vs(seriesDelta(p.series, "acceptance_rate", 100), "pt")} />
          <Metric label="Greeted" info={METRIC_INFO.greeting_rate} value={pct(t.greeting_rate)} foot={vs(seriesDelta(p.series, "greeting_rate", 100), "pt")} />
          <Metric
            label="Customer frustration"
            info={METRIC_INFO.frustration}
            value={t.avg_customer_frustration ?? "–"}
            unit="/ 10"
            foot={vs(seriesDelta(p.series, "avg_customer_frustration"), "", true)}
          />
        </MetricRow>
        <div className="metric-compact" aria-label="More detail">
          <MetricRow>
            <Metric label="Effort score" info={METRIC_INFO.effort} value={t.avg_effort ?? "–"} unit="/ 10" />
            <Metric label="Offers per conversation" info={METRIC_INFO.offers_per_conversation} value={t.attempts_per_conversation ?? "–"} />
            <Metric label="Selling approaches used" info={METRIC_INFO.techniques} value={t.techniques.length} />
            <Metric label="Re-offers after a no" info={METRIC_INFO.reoffers} value={t.re_offers} />
          </MetricRow>
        </div>
      </div>

      {(people.length >= 2 || t.calls_positive + t.calls_neutral + t.calls_negative > 0) && (
        <div className="insight-row">
          <VsTeamBars person={p} people={people} />
          <PersonSentiment total={t} />
        </div>
      )}

      {p.series.length > 2 && (
        <div className="two">
          <div>
            <div className="sub small chart-title">Upsell attempts over time</div>
            <LineChart data={p.series} value={(b) => b.attempts} label={(b) => formatPeriod(b.period)} xTitle="Date" yTitle="Offers made" />
          </div>
          <div>
            <div className="sub small chart-title">Acceptance rate over time</div>
            <LineChart data={p.series} value={(b) => b.acceptance_rate} label={(b) => formatPeriod(b.period)} format={pct} xTitle="Date" yTitle="Acceptance rate" />
          </div>
        </div>
      )}

      {(a.strengths.length > 0 || a.improvements.length > 0) && (
        <div className="two">
          <section className="flat-card good">
            <h3>Doing well</h3>
            <ul>
              {shownStrengths.map((s) => (
                <li key={s}>{s}</li>
              ))}
              {a.strengths.length === 0 && <li className="sub">Nothing stands out yet</li>}
            </ul>
            {a.strengths.length > 2 && (
              <button className="link small" style={{ marginTop: 8 }} onClick={() => setShowAllStrengths((v) => !v)}>
                {showAllStrengths ? "Show fewer" : `+${a.strengths.length - 2} more`}
              </button>
            )}
          </section>
          <section className="flat-card warn">
            <h3>To work on</h3>
            <ul>
              {shownImprovements.map((s) => (
                <li key={s}>{s}</li>
              ))}
              {a.improvements.length === 0 && <li className="sub">Nothing to flag</li>}
            </ul>
            {a.improvements.length > 2 && (
              <button className="link small" style={{ marginTop: 8 }} onClick={() => setShowAllImprovements((v) => !v)}>
                {showAllImprovements ? "Show fewer" : `+${a.improvements.length - 2} more`}
              </button>
            )}
          </section>
        </div>
      )}

      <RecentConversations calls={p.recent_calls} />

      {p.recent_coaching.length > 0 && (
        <section className="flat-card coaching">
          <h3>Recent coaching</h3>
          <ul>
            {p.recent_coaching.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </section>
      )}
      <p className="ai-note">AI-generated and indicative - check the evidence in the recordings before using it in a review.</p>
    </div>
  );
}
