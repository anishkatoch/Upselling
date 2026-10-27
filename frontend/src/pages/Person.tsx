import { useEffect } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import LineChart from "../components/LineChart";
import { describePrevious, formatPeriod, type Period } from "../lib/period";
import { AlertTriangle, ArrowLeft, Ban, Check, Hand, MessageQuestion, Minus, Smile, Target, TrendDown, TrendUp } from "../icons/Icons";
import { api, type Person, type RatingFactor } from "../lib/api";
import { pct } from "../lib/format";
import { useLoad } from "../lib/hooks";
import { METRIC_INFO } from "../lib/metricInfo";
import { Reveal } from "../components/motion";
import Findings from "../components/people/Findings";
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
  // The period lives in the address (?period=month), so a view can be reloaded and linked.
  const [params, setParams] = useSearchParams();
  const asked = params.get("period");
  const period: Period = asked === "day" || asked === "week" || asked === "month" ? asked : "week";
  const setPeriod = (p: Period) => setParams({ period: p }, { replace: true });

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

      {board && person && <PersonDetail key={person.name} person={person} people={board.people} period={period} setPeriod={setPeriod} />}
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

  // The sample size is stated once in the caption under the headline (SampleNote), and "compared with ..." once above the tiles.
  // Shown as final values (a count-up could be captured mid-animation as a wrong figure).
  const num = (v: number | null | undefined, kind: "pct" | "dec" | "int") =>
    v == null ? "–" : kind === "pct" ? `${Math.round(v * 100)}%` : kind === "dec" ? (Math.round(v * 10) / 10).toFixed(1) : String(v);
  const vs = (value: number | null | undefined) => (value == null ? null : <DeltaChip value={value} />);
  // "3 of 4 offers" under a share, so a percentage on a few cases can be read for what it is.
  const countFoot = (count: string | null, value: number | null | undefined) => (
    <>
      {count && <span className="m-count">{count}</span>}
      {vs(value)}
    </>
  );
  const mood = moodFromFrustration(t.avg_customer_frustration);
  const moodChange = seriesDelta(p.series, "avg_customer_frustration");
  const worst = t.max_customer_frustration != null ? moodFromFrustration(t.max_customer_frustration) : null;
  const showWorst = worst != null && worst.label !== mood.label;
  const before = p.series.length >= 2 ? p.series[p.series.length - 2] : null;
  const comparedWith = before ? describePrevious(period, before.period) : "";
  const hasChange = p.series.length >= 2;
  // Each rating factor's tile gets a dot from the same status the rating was built on (nothing shows when there is no rating).
  const factorState = Object.fromEntries((a.factors ?? []).map((f) => [f.key, f.status]));
  const factorTone = (key: RatingFactor["key"]) =>
    ({ good: "good", fair: "warn", weak: "bad", none: "neutral" } as const)[factorState[key] as RatingFactor["status"]];
  const factorWord = (key: RatingFactor["key"]) => ({ good: "Strong", fair: "Fair", weak: "Needs work", none: undefined } as const)[factorState[key] as RatingFactor["status"]];
  const solo = t.solo_analysed_conversations ?? 0;
  const judgedNo = t.attempts > 0 && solo > 0; // offers in shared conversations alone leave nothing to judge
  const unansweredConvs = t.conversations_with_unanswered ?? t.unanswered_questions;

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
              {t.conversations !== 1 ? "s" : ""} · {p.is_current === false ? `period starting ${formatPeriod(t.period)}` : PERIOD_LABEL[period]}
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

        <p className="person-headline">{a.headline}</p>
        <SampleNote bucket={t} when={`in the period starting ${formatPeriod(t.period)}`} />
      </Reveal>

      <Reveal className="metric-group" delay={0.06}>
        {hasChange && <p className="sub small metric-caption">Arrows show the change compared with {comparedWith}.</p>}
        <p className="metric-group-title">How they treat customers</p>
        <MetricRow>
          <Metric
            label="Greets customers"
            info={METRIC_INFO.greeting_rate}
            value={num(t.greeting_rate, "pct")}
            unit={t.greeting_rate != null ? "of conversations" : undefined}
            meter={t.greeting_rate}
            tone={factorTone("greeting")}
            status={factorWord("greeting")}
            icon={<Hand />}
            pips={{ on: t.greeted, total: solo }}
            foot={countFoot(t.greeting_rate != null ? `${t.greeted} of ${t.solo_analysed_conversations}` : null, seriesDelta(p.series, "greeting_rate", 100))}
          />
          <Metric
            label="Every question answered"
            info={METRIC_INFO.unanswered}
            value={solo > 0 && factorState.listening !== "none" ? String(solo - unansweredConvs) : "–"}
            unit={solo > 0 && factorState.listening !== "none" ? `of ${solo} conversations` : undefined}
            tone={factorTone("listening")}
            status={factorWord("listening")}
            icon={<MessageQuestion />}
            pips={{ on: solo - unansweredConvs, total: solo }}
            foot={
              solo > 0 && factorState.listening !== "none" ? (
                <span className="m-count">
                  {unansweredConvs === 0 ? "Every question was answered" : `${t.unanswered_questions} ${t.unanswered_questions === 1 ? "question" : "questions"} went unanswered`}
                </span>
              ) : null
            }
          />
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
            tone={factorTone("mood") ?? mood.tone}
            status={factorWord("mood")}
            icon={<Smile />}
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
          <Metric
            label="Respects a 'no'"
            info={METRIC_INFO.pitch_after_no}
            value={judgedNo ? String(solo - t.pushy_conversations) : "–"}
            unit={judgedNo ? `of ${solo} conversations` : undefined}
            tone={factorTone("pressure")}
            status={factorWord("pressure")}
            icon={<Ban />}
            pips={{ on: solo - t.pushy_conversations, total: solo }}
            foot={
              <span className="m-count">
                {!judgedNo
                  ? "No offers to judge"
                  : t.pushy_conversations === 0
                    ? "Never pitched again after a 'no'"
                    : `Pitched again in ${t.pushy_conversations} · ${t.re_offers} ${t.re_offers === 1 ? "offer" : "offers"} repeated`}
              </span>
            }
          />
        </MetricRow>
        <p className="metric-group-title">Selling</p>
        <MetricRow>
          <Metric
            label="Tries to upsell"
            info={METRIC_INFO.upsell_rate}
            value={num(t.upsell_rate, "pct")}
            unit={t.upsell_rate != null ? "of conversations" : undefined}
            meter={t.upsell_rate}
            tone={factorTone("offers")}
            status={factorWord("offers")}
            icon={<Target />}
            pips={{ on: t.conversations_with_upsell, total: t.analysed_conversations ?? 0 }}
            foot={countFoot(t.upsell_rate != null ? `${t.conversations_with_upsell} of ${t.analysed_conversations}` : null, seriesDelta(p.series, "upsell_rate", 100))}
          />
          <Metric
            label="Customers say yes"
            info={METRIC_INFO.acceptance_rate}
            value={num(t.acceptance_rate, "pct")}
            unit={t.acceptance_rate != null ? "of offers" : undefined}
            meter={t.acceptance_rate}
            tone={factorTone("yes")}
            status={factorWord("yes")}
            icon={<Check />}
            pips={{ on: t.accepted, total: t.answered_offers ?? 0 }}
            foot={countFoot(t.acceptance_rate != null ? `${t.accepted} of ${t.answered_offers ?? 0} answered` : null, seriesDelta(p.series, "acceptance_rate", 100))}
          />
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
            <Metric label="Objections answered" info={METRIC_INFO.objections} value={num(t.objections_handled, "int")} />
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
        <Reveal>
          <Findings strengths={a.strengths} improvements={a.improvements} upsellTips={a.upsell_tips ?? []} />
        </Reveal>
      )}

      {p.recent_coaching.length > 0 && (
        <Reveal className="flat-card coaching">
          <div className="card-head">
            <h3>
              What to coach <span className="ai-badge">✦ AI</span>
            </h3>
          </div>
          <p className="small coach-from ai-glow-text">
            From their {p.recent_coaching.length === 1 ? "latest conversation" : `${p.recent_coaching.length} latest conversations`}, whichever
            tab is open.
          </p>
          <ul>
            {p.recent_coaching.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </Reveal>
      )}

      <Reveal>
        <RecentConversations calls={p.recent_calls} period={t.period} />
      </Reveal>

      <p className="ai-note">AI-generated and indicative - check the evidence in the recordings before using it in a review.</p>
    </div>
  );
}
