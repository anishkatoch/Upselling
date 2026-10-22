import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import LineChart from "../components/LineChart";
import { formatPeriod, type Period } from "../lib/period";
import { AlertTriangle, ArrowLeft, Minus, TrendDown, TrendUp } from "../icons/Icons";
import { api, type Person } from "../lib/api";
import { pct } from "../lib/format";
import { useLoad } from "../lib/hooks";
import { METRIC_INFO } from "../lib/metricInfo";
import { Reveal } from "../components/motion";
import AnimatedNumber from "../components/motion/AnimatedNumber";
import { DeltaChip, Metric, MetricRow } from "../components/ui";
import { EFFORT, moodFromFrustration, PERIOD_LABEL } from "../lib/teamLabels";
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
      {!person && (
        <Link to="/team" className="back" style={{ marginBottom: 16, marginTop: 24 }}>
          <ArrowLeft size={15} /> All salespeople
        </Link>
      )}

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

  // The sample size is stated once in the caption under the headline (SampleNote), and "compared with ..." once above the tiles.
  // Numeric figures count up once; words and dashes stay as they are.
  const num = (v: number | null | undefined, kind: "pct" | "dec" | "int") =>
    v == null ? "–" : kind === "pct" ? <><AnimatedNumber value={Math.round(v * 100)} />%</> : kind === "dec" ? <AnimatedNumber value={Math.round(v * 10) / 10} decimals={1} /> : <AnimatedNumber value={v} />;
  const vs = (value: number | null | undefined) => (value == null ? null : <DeltaChip value={value} />);
  const mood = moodFromFrustration(t.avg_customer_frustration);
  const moodChange = seriesDelta(p.series, "avg_customer_frustration");
  const worst = t.max_customer_frustration != null ? moodFromFrustration(t.max_customer_frustration) : null;
  const showWorst = worst != null && worst.label !== mood.label;
  const comparedWith = period === "day" ? "yesterday" : period === "week" ? "last week" : "last month";
  const hasChange = p.series.length >= 2;
  const shownStrengths = showAllStrengths ? a.strengths : a.strengths.slice(0, 2);
  const shownImprovements = showAllImprovements ? a.improvements : a.improvements.slice(0, 2);

  return (
    <div className="person-flat">
      <Reveal className="person-hero hero">
        <Link to="/team" className="back" style={{ marginBottom: 14 }}>
          <ArrowLeft size={15} /> All salespeople
        </Link>
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
          {a.low_sample && <span className="sub"> (based on very few conversations so far)</span>}
        </p>
        <SampleNote bucket={t} when={PERIOD_LABEL[period]} />
      </Reveal>

      <Reveal className="metric-group" delay={0.06}>
        {hasChange && <p className="sub small metric-caption">Arrows show the change compared with {comparedWith}.</p>}
        <MetricRow>
          <Metric label="Greets customers" info={METRIC_INFO.greeting_rate} value={num(t.greeting_rate, "pct")} unit={t.greeting_rate != null ? "of conversations" : undefined} foot={vs(seriesDelta(p.series, "greeting_rate", 100))} />
          <Metric
            label="Customer mood"
            info={
              <>
                {METRIC_INFO.frustration}
                {t.avg_customer_frustration != null &&
                  ` Average score: ${t.avg_customer_frustration} out of 10 (0 is calm; under 3 is calm, 3 to 4 some tension, 5 and over frustrated).${t.max_customer_frustration != null ? ` Worst conversation: ${t.max_customer_frustration}.` : ""}`}
              </>
            }
            value={mood.label}
            foot={
              moodChange == null && !showWorst ? null : (
                <>
                  {moodChange != null && <DeltaChip value={moodChange} lowerIsBetter upText="more tense" downText="calmer" />}
                  {showWorst && worst && (
                    <div className="sub small" style={{ marginTop: moodChange != null ? 2 : 0 }}>
                      Worst conversation: {worst.label.toLowerCase()} ({t.max_customer_frustration}/10)
                    </div>
                  )}
                </>
              )
            }
          />
          <Metric label="Tries to upsell" info={METRIC_INFO.upsell_rate} value={num(t.upsell_rate, "pct")} unit={t.upsell_rate != null ? "of conversations" : undefined} foot={vs(seriesDelta(p.series, "upsell_rate", 100))} />
          <Metric label="Customers say yes" info={METRIC_INFO.acceptance_rate} value={num(t.acceptance_rate, "pct")} unit={t.acceptance_rate != null ? "of offers" : undefined} foot={vs(seriesDelta(p.series, "acceptance_rate", 100))} />
        </MetricRow>
        <div className="metric-compact" aria-label="More detail">
          <MetricRow>
            <Metric
              label="Selling effort"
              info={<>{METRIC_INFO.effort}{t.avg_effort != null && ` Effort score: ${t.avg_effort} out of 10.`}</>}
              value={t.avg_effort != null ? EFFORT[a.effort_level].short : "–"}
            />
            <Metric label="Offers per conversation" info={METRIC_INFO.offers_per_conversation} value={num(t.attempts_per_conversation, "dec")} />
            <Metric label="Different approaches used" info={METRIC_INFO.techniques} value={num(t.techniques.length, "int")} />
            <Metric label="Offers repeated after a 'no'" info={METRIC_INFO.reoffers} value={num(t.re_offers, "int")} />
          </MetricRow>
        </div>
      </Reveal>

      {(people.length >= 2 || t.calls_positive + t.calls_neutral + t.calls_negative > 0) && (
        <Reveal className="insight-row">
          <VsTeamBars person={p} people={people} />
          <PersonSentiment total={t} />
        </Reveal>
      )}

      {p.series.length > 2 && (
        <Reveal className="two">
          <div>
            <div className="sub small chart-title">Offers made over time</div>
            <LineChart data={p.series} value={(b) => b.attempts} label={(b) => formatPeriod(b.period)} xTitle="Date" yTitle="Offers made" />
          </div>
          <div>
            <div className="sub small chart-title">How often customers said yes over time</div>
            <LineChart data={p.series} value={(b) => b.acceptance_rate} label={(b) => formatPeriod(b.period)} format={pct} xTitle="Date" yTitle="Customers say yes" />
          </div>
        </Reveal>
      )}

      {(a.strengths.length > 0 || a.improvements.length > 0 || (a.upsell_tips?.length ?? 0) > 0) && (
        <Reveal className="two">
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
              {a.improvements.length === 0 && <li className="sub">Nothing urgent - keep it up.</li>}
            </ul>
            {a.improvements.length > 2 && (
              <button className="link small" style={{ marginTop: 8 }} onClick={() => setShowAllImprovements((v) => !v)}>
                {showAllImprovements ? "Show fewer" : `+${a.improvements.length - 2} more`}
              </button>
            )}
            {(a.upsell_tips?.length ?? 0) > 0 && (
              <div className="optional-tips">
                <h4>Upselling (optional)</h4>
                <ul>
                  {a.upsell_tips!.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </Reveal>
      )}

      <Reveal>
        <RecentConversations calls={p.recent_calls} />
      </Reveal>

      {p.recent_coaching.length > 0 && (
        <Reveal className="flat-card coaching">
          <h3>
            Recent coaching <span className="ai-badge">✦ AI</span>
          </h3>
          <ul>
            {p.recent_coaching.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </Reveal>
      )}
      <p className="ai-note">AI-generated and indicative - check the evidence in the recordings before using it in a review.</p>
    </div>
  );
}
