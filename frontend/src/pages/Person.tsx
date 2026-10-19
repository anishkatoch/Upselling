import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import CountUp from "../components/CountUp";
import LineChart from "../components/LineChart";
import { formatPeriod } from "../lib/period";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronRight,
  Headset,
  Mic,
  Minus,
  Repeat,
  Target,
  TrendDown,
  TrendUp,
  Users,
} from "../icons/Icons";
import { api, type Person, type RecordingSummary } from "../lib/api";
import { DEMO_DASHBOARD as DEMO, type Period } from "../lib/demo";
import { ago, pct, RESULT, SENTIMENT } from "../lib/format";
import { useLoad } from "../lib/hooks";
import { PERIOD_LABEL, RATING } from "../lib/teamLabels";

/**
 * One salesperson's deep-dive profile (KPI-tile styled, screenshot-B language): the dedicated
 * page a name in the team-at-a-glance table now links to, replacing Team.tsx's old inline
 * toggle card. Aggregated numbers come from the same `dashboard.py` Bucket/assessment data as
 * the glance table; the one new piece is the full per-recording list (section 6), since nothing
 * before this returned every job a person appears in, not just the latest period's top 8.
 */
export default function PersonPage() {
  const { name: rawName } = useParams<{ name: string }>();
  // react-router already decodes path params (see its decodePath()), so this is the real
  // name as-is - decoding it again here would throw on a name containing a literal "%".
  const name = rawName ?? "";
  const location = useLocation();
  const navigate = useNavigate();
  const [period, setPeriod] = useState<Period>("week");
  const [demo] = useState(Boolean((location.state as { demo?: boolean } | null)?.demo));

  // Jumping into a fresh profile page should land at the top, same as Team.tsx did when
  // switching between an inline person card and "all salespeople".
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [name]);

  const { data: live, error } = useLoad(() => api.dashboard(period), [period]);
  const board = demo ? DEMO[period] : live;
  const person = board?.people.find((p) => p.name === name);

  const { data: recordings, error: recordingsError } = useLoad(
    () => (demo ? Promise.resolve<RecordingSummary[]>([]) : api.personRecordings(name)),
    [name, demo],
  );

  return (
    <>
      <Link to="/team" state={{ demo }} className="back" style={{ marginBottom: 16 }}>
        <ArrowLeft size={15} /> All salespeople
      </Link>

      {!demo && error && (
        <p className="error">
          <AlertTriangle size={16} /> {error}
        </p>
      )}
      {!demo && !board && !error && <div className="skeleton" style={{ height: 320 }} />}

      {board && !person && (
        <div className="card empty">
          <h2>No data for {name}</h2>
          <p>They have no recorded activity in this period.</p>
        </div>
      )}

      {person && <PersonDetail person={person} period={period} setPeriod={setPeriod} demo={demo} recordings={recordings} recordingsError={recordingsError} navigate={navigate} />}
    </>
  );
}

function PersonDetail({
  person: p,
  period,
  setPeriod,
  demo,
  recordings,
  recordingsError,
  navigate,
}: {
  person: Person;
  period: Period;
  setPeriod: (p: Period) => void;
  demo: boolean;
  recordings: RecordingSummary[] | null;
  recordingsError: string | null;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const a = p.assessment;
  const r = RATING[a.rating];
  const t = p.total;
  const TrendIcon = a.trend === "improving" ? TrendUp : a.trend === "declining" ? TrendDown : Minus;
  const [showAllRecordings, setShowAllRecordings] = useState(false);
  const [showAllCalls, setShowAllCalls] = useState(false);
  const [showAllStrengths, setShowAllStrengths] = useState(false);
  const [showAllImprovements, setShowAllImprovements] = useState(false);

  return (
    <div className="card person">
      <div className={`person-hero ${a.rating}`}>
        <div className="person-head">
          <div className="avatar">{p.name.slice(0, 1).toUpperCase()}</div>
          <div className="grow">
            <h1 style={{ fontSize: 26 }}>{p.name}</h1>
            <div className="sub small">
              {t.recordings} recording{t.recordings !== 1 ? "s" : ""} · {t.conversations} customer conversation
              {t.conversations !== 1 ? "s" : ""} · {PERIOD_LABEL[period]}
              {demo && " · sample data"}
            </div>
          </div>
          {a.trend && (
            <span className={`trend ${a.trend}`}>
              <TrendIcon size={15} /> {a.trend === "improving" ? "Improving" : a.trend === "declining" ? "Slipping" : "Steady"}
            </span>
          )}
          <span className={`pill ${r.tone}`}>{r.label}</span>
          <div className="seg">
            {(["day", "week", "month"] as Period[]).map((per) => (
              <button key={per} className={period === per ? "on" : ""} onClick={() => setPeriod(per)}>
                {per === "day" ? "Daily" : per === "week" ? "Weekly" : "Monthly"}
              </button>
            ))}
          </div>
        </div>

        <div className="row" style={{ gap: 8, marginTop: 14 }}>
          <p className="grow">
            {a.headline}
            {a.low_sample && <span className="sub"> (based on very little data so far)</span>}
          </p>
        </div>
      </div>

      <div className="kpis">
        <Kpi icon={<Headset size={15} />} label="Recordings" value={<CountUp value={t.recordings} />} />
        <Kpi icon={<Users size={15} />} label="Sales conversations" value={<CountUp value={t.conversations} />} />
        <Kpi icon={<TrendUp size={15} />} label="Upsell attempt %" value={pct(t.upsell_rate)} />
        <Kpi icon={<Check size={15} />} label="Offers accepted %" value={pct(t.acceptance_rate)} />
        <Kpi icon={<Mic size={15} />} label="Greeted %" value={pct(t.greeting_rate)} />
        <Kpi icon={<AlertTriangle size={15} />} label="Avg. customer frustration" value={`${t.avg_customer_frustration ?? "–"} / 10`} />
      </div>

      {/* The numbers behind the old effort_summary/trend sentence, as tiles instead of a paragraph. */}
      <div className="kpis">
        <Kpi icon={<Target size={15} />} label="Effort score" value={`${t.avg_effort ?? "–"}/10`} />
        <Kpi icon={<TrendUp size={15} />} label="Offers per conversation" value={t.attempts_per_conversation ?? "–"} />
        <Kpi icon={<Mic size={15} />} label="Techniques used" value={<CountUp value={t.techniques.length} />} />
        <Kpi icon={<Repeat size={15} />} label="Re-offered after a 'no'" value={<CountUp value={t.re_offers} />} />
      </div>

      {p.series.length > 1 && (
        <div className="two">
          <div>
            <div className="sub small" style={{ marginBottom: 7, fontWeight: 600 }}>
              Upsell attempts over time
            </div>
            <LineChart data={p.series} value={(b) => b.attempts} label={(b) => formatPeriod(b.period)} xTitle="Date" yTitle="Offers made" />
          </div>
          <div>
            <div className="sub small" style={{ marginBottom: 7, fontWeight: 600 }}>
              Acceptance rate over time
            </div>
            <LineChart data={p.series} value={(b) => b.acceptance_rate} label={(b) => formatPeriod(b.period)} format={pct} xTitle="Date" yTitle="Acceptance rate" />
          </div>
        </div>
      )}

      {(a.strengths.length > 0 || a.improvements.length > 0) && (
        <div className="two">
          <div>
            <h3>Doing well</h3>
            <ul className="plain small">
              {(showAllStrengths ? a.strengths : a.strengths.slice(0, 2)).map((s) => (
                <li key={s}>{s}</li>
              ))}
              {a.strengths.length === 0 && <li className="sub">Nothing stands out yet</li>}
            </ul>
            {a.strengths.length > 2 && (
              <button className="link small" style={{ marginTop: 6 }} onClick={() => setShowAllStrengths((v) => !v)}>
                {showAllStrengths ? "Show fewer" : `+${a.strengths.length - 2} more`}
              </button>
            )}
          </div>
          <div>
            <h3>To work on</h3>
            <ul className="plain small">
              {(showAllImprovements ? a.improvements : a.improvements.slice(0, 2)).map((s) => (
                <li key={s}>{s}</li>
              ))}
              {a.improvements.length === 0 && <li className="sub">Nothing to flag</li>}
            </ul>
            {a.improvements.length > 2 && (
              <button className="link small" style={{ marginTop: 6 }} onClick={() => setShowAllImprovements((v) => !v)}>
                {showAllImprovements ? "Show fewer" : `+${a.improvements.length - 2} more`}
              </button>
            )}
          </div>
        </div>
      )}

      <div>
        <h3 className="eyebrow">Recordings</h3>

        {!demo && recordingsError && (
          <p className="error">
            <AlertTriangle size={16} /> {recordingsError}
          </p>
        )}

        {!demo && (
          <label className="f" style={{ display: "block", maxWidth: 420, marginBottom: 14 }}>
            Jump to a recording
            <select
              className="sel"
              value=""
              onChange={(e) => e.target.value && navigate(`/recordings/${e.target.value}`)}
              style={{ marginTop: 6, width: "100%" }}
              disabled={!recordings || recordings.length === 0}
            >
              <option value="">Choose a recording…</option>
              {(recordings ?? []).map((rec) => (
                <option key={rec.job_id} value={rec.job_id}>
                  {ago(rec.created_at)} · {rec.filename}
                </option>
              ))}
            </select>
          </label>
        )}

        {!demo && recordings && recordings.length === 0 && <p className="sub small">No recordings yet.</p>}

        {!demo && recordings && recordings.length > 0 && (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Recording</th>
                    <th className="num">Conversations</th>
                    <th className="num">Upsell tries</th>
                    <th className="num">Accepted</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {(showAllRecordings ? recordings : recordings.slice(0, 5)).map((rec, i) => (
                    <tr key={rec.job_id} className={i >= 5 ? "reveal" : undefined}>
                      <td className="small sub">{ago(rec.created_at)}</td>
                      <td>{rec.filename}</td>
                      <td className="num">{rec.stats.conversations}</td>
                      <td className="num">{rec.stats.attempts}</td>
                      <td className="num">{rec.stats.accepted}</td>
                      <td>
                        <Link to={`/recordings/${rec.job_id}`} className="btn ghost small">
                          Report <ChevronRight size={13} style={{ verticalAlign: "-1px" }} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {recordings.length > 5 && (
              <button className="btn ghost small" style={{ marginTop: 10 }} onClick={() => setShowAllRecordings((v) => !v)}>
                {showAllRecordings ? "Show fewer" : `Show all ${recordings.length} recordings`}
              </button>
            )}
          </>
        )}

        {demo && p.recent_calls.length > 0 && (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Conversation</th>
                    <th>Call</th>
                    <th>Upsell</th>
                    <th className="num">Offers</th>
                  </tr>
                </thead>
                <tbody>
                  {(showAllCalls ? p.recent_calls : p.recent_calls.slice(0, 5)).map((c, i) => {
                    const s = SENTIMENT[c.sentiment];
                    const res = RESULT[c.upsell_result];
                    return (
                      <tr key={i} className={i >= 5 ? "reveal" : undefined}>
                        <td className="small sub">{ago(c.when)}</td>
                        <td>{c.topic}</td>
                        <td>
                          <span className={`pill ${s.tone}`}>{s.label}</span>
                        </td>
                        <td>
                          <span className={`pill ${res.tone}`}>{res.label}</span>
                        </td>
                        <td className="num">
                          {c.accepted}/{c.tried}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {p.recent_calls.length > 5 && (
              <button className="btn ghost small" style={{ marginTop: 10 }} onClick={() => setShowAllCalls((v) => !v)}>
                {showAllCalls ? "Show fewer" : `Show all ${p.recent_calls.length} recordings`}
              </button>
            )}
          </>
        )}
      </div>

      {p.recent_coaching.length > 0 && (
        <div className="tip">
          <b>Recent coaching</b>
          <ul className="plain small" style={{ marginTop: 6 }}>
            {p.recent_coaching.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Kpi({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="kpi">
      <span className="kpi-ico">{icon}</span>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}
