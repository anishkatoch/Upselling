import { useState } from "react";
import { Link } from "react-router-dom";
import { api, type Person } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { clock } from "../../lib/format";
import { formatPeriod } from "../../lib/period";

const GROUPS = [
  { title: "Customer handling", aspects: [["greeting", "Greeting"], ["listening", "Listening"], ["mood", "Customer mood"], ["pressure", "Respecting a no"]] },
  { title: "Upselling", aspects: [["upselling", "Tries to upsell"], ["conversion", "Customers say yes"]] },
];

export default function RatingReview({ person }: { person: Person }) {
  const { user } = useAuth();
  const a = person.assessment;
  const count = person.total.solo_analysed_conversations;
  const reviewKey = JSON.stringify([user?.id, person.name, person.total, a]);
  return (
    <section className="rating-review" aria-labelledby="rating-explanation">
      <div className="rating-review-heading">
        <h2 id="rating-explanation">Why this rating?</h2>
        <span className="sub small">{count == null ? "Solo sample unavailable" : `${count} analysed solo conversations`} · Period starting {formatPeriod(person.total.period)}</span>
      </div>
      <p>{a.headline}</p>
      <div className="rating-summary">
        {a.strengths[0] && <p><strong>Strength</strong><span>{a.strengths[0]}</span></p>}
        {a.improvements[0] && <p><strong>Coaching focus</strong><span>{a.improvements[0]}</span></p>}
      </div>
      <details className="rating-breakdown">
        <summary>View the six rating aspects</summary>
        <div className="rating-aspect-groups">
          {GROUPS.map((group) => <section key={group.title}>
            <h3>{group.title}</h3>
            <ul className="rating-aspects">{group.aspects.map(([key, label]) => {
              const score = a.aspect_scores?.[key];
              return <li key={key}>
                <div><span>{label}</span><span>{score ? `${score[0]} / ${score[1]} points` : "Not available"}</span></div>
                {score ? <meter min={0} max={score[1]} value={score[0]} aria-label={`${label} points`} /> : <div className="rating-empty-track" />}
              </li>;
            })}</ul>
          </section>)}
        </div>
        <p className="sub small">Excelling needs at least 75% overall, at least half the points in every scored aspect, and the required conversation count. Serious frustration and repeated pressure or ignored questions can also limit the label. Upselling contributes to this rating.</p>
        <p className="sub small">These are AI judgements from recorded audio. A zero means no points under the current rules; it can also reflect too little evidence of that behaviour.</p>
      </details>
      <AudioExamples key={JSON.stringify([person.total.period, person.recent_calls])} person={person} />
      <ReviewFeedback key={reviewKey} storageKey={`souqcue:rating-review:${reviewKey}`} />
    </section>
  );
}

type Example = { href: string; quote: string; label: string; time: number };
function AudioExamples({ person }: { person: Person }) {
  const [examples, setExamples] = useState<Example[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function load() {
    setBusy(true);
    setError("");
    const calls = person.recent_calls.filter((c) => c.period === person.total.period);
    const jobs = [...new Set(calls.map((c) => c.job_id))];
    const results = await Promise.allSettled(jobs.map((id) => api.report(id)));
    const found: Example[] = [];
    results.forEach((result, i) => {
      if (result.status !== "fulfilled") return;
      const r = result.value;
      const ids = new Set(calls.filter((c) => c.job_id === jobs[i]).map((c) => c.conversation_id));
      for (const e of r.evidence) {
        const conversation = r.conversations.find((c) => c.conversation_id === e.conversation_id);
        // Do not attribute shared-conversation findings to an individual.
        if (!ids.has(e.conversation_id) || conversation?.salespeople.length !== 1) continue;
        const line = e.lines.find((l) => l.segment_id === e.segment_id);
        if (!line || !e.quote_found) continue;
        const label = e.kind === "unanswered_question" ? "Unanswered question" : e.kind === "frustration" ? "Frustration to review" : e.kind === "greeting" ? "Greeting" : e.kind === "customer_feedback" ? "Customer feedback" : "Offer and response";
        found.push({ label, quote: line.text, time: line.start, href: `/recordings/${jobs[i]}?tab=conversations&conv=${e.conversation_id}&t=${Math.max(0, line.start - 3)}` });
      }
    });
    found.sort((a, b) => Number(/question|Frustration/.test(b.label)) - Number(/question|Frustration/.test(a.label)));
    setExamples(found.slice(0, 6));
    if (results.some((r) => r.status === "rejected")) setError("Some recording examples could not be loaded. Try again.");
    setBusy(false);
  }
  return <div className="rating-examples">
    <button className="btn ghost small" onClick={load} disabled={busy}>{busy ? "Loading examples…" : examples === null ? "Review recording examples" : "Refresh examples"}</button>
    <p className="sub small">Examples from recent conversations in this period. Listen in context before judging a concern.</p>
    {error && <p role="alert">{error}</p>}
    {examples?.length === 0 && !error && <p className="sub small">No timestamped examples available. You can still open the recent conversations below.</p>}
    {examples && examples.length > 0 && <ul className="rating-example-list">{examples.map((e, i) => <li key={`${e.href}-${i}`}>
      <div><strong>{e.label}</strong><p>{e.quote}</p></div>
      <Link to={e.href} className="link">Play example · {clock(e.time)}</Link>
    </li>)}</ul>}
  </div>;
}

function ReviewFeedback({ storageKey }: { storageKey: string }) {
  const [saved] = useState(() => {
    try { return JSON.parse(localStorage.getItem(storageKey) ?? "null") as { verdict?: string; note?: string } | null; }
    catch { return null; }
  });
  const [verdict, setVerdict] = useState(saved?.verdict ?? "");
  const [note, setNote] = useState(saved?.note ?? "");
  const [status, setStatus] = useState(saved ? "Review saved on this browser." : "");
  return <form className="rating-feedback" onSubmit={(e) => {
    e.preventDefault();
    try {
      localStorage.setItem(storageKey, JSON.stringify({ verdict, note, savedAt: new Date().toISOString() }));
      setStatus("Review saved on this browser.");
    } catch { setStatus("Could not save the review. Browser storage may be unavailable."); }
  }}>
    <fieldset><legend>Does this rating look right?</legend>
      <div className="rating-feedback-options">{["Looks right", "Needs review"].map((v) => <label key={v}><input type="radio" name="rating-review" value={v} checked={verdict === v} onChange={() => { setVerdict(v); setStatus(""); }} />{v}</label>)}</div>
    </fieldset>
    {verdict && <><label htmlFor="rating-review-note">Reason <span className="sub">(optional)</span></label>
      <textarea id="rating-review-note" rows={2} maxLength={1000} value={note} onChange={(e) => { setNote(e.target.value); setStatus(""); }} />
      <button className="btn small" type="submit">Save review</button></>}
    <p className="sub small">POC feedback stays on this browser and is not shared with the team.</p>
    <p role="status" className="small">{status}</p>
  </form>;
}
