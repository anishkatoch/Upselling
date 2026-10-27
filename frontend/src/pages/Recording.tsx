import { useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, Check } from "../icons/Icons";
import { api, type Job, type Report, type Segment } from "../lib/api";
import { clock, recordingTitle, STEPS } from "../lib/format";
import { useLoad } from "../lib/hooks";
import Conversations from "./recording/Conversations";
import Evidence from "./recording/Evidence";
import Outcomes from "./recording/Outcomes";
import type { RecCtx } from "./recording/shared";
import { evidenceIndex } from "./recording/shared";
import Overview from "./recording/Overview";
import SummaryTab from "./recording/SummaryTab";
import TranscriptTab from "./recording/Transcript";

const active = (j: Job) => j.status === "queued" || j.status === "running";

export default function Recording() {
  const { id = "" } = useParams();
  const { data: job, error, reload } = useLoad(() => api.job(id), [id], { every: 2500, keep: active });

  if (error && !job)
    return (
      <p className="error">
        <AlertTriangle size={16} /> We couldn&apos;t find this recording.
      </p>
    );
  if (!job) return <div className="skeleton" style={{ height: 200 }} />;

  return (
    <>
      <div className="hero">
        <Link to="/recordings" className="back">
          <ArrowLeft size={15} /> All conversations
        </Link>
        <div className="head" style={{ marginTop: 14, marginBottom: 0 }}>
          <h1 style={{ wordBreak: "break-word" }}>{recordingTitle(job)}</h1>
        </div>
      </div>
      {active(job) && <Progress job={job} onChange={reload} />}
      {job.status === "failed" && <Failed job={job} onChange={reload} />}
      {job.status === "cancelled" && <Failed job={job} onChange={reload} stopped />}
      {job.status === "completed" && <Results job={job} key={job.job_id} />}
    </>
  );
}

function Progress({ job, onChange }: { job: Job; onChange: () => void }) {
  const idx = Math.max(0, STEPS.findIndex((s) => s.key === job.stage));
  return (
    <div className="card">
      <h2>Analysing your recording…</h2>
      <p className="sub">This can take a few minutes for long recordings. You can leave this page and come back.</p>
      <div className="bar" style={{ marginTop: 20 }}>
        <i style={{ width: `${Math.max(3, Math.round(job.progress * 100))}%` }} />
      </div>
      <ul className="steps">
        {STEPS.map((s, i) => (
          <li key={s.key} className={i < idx ? "done" : i === idx ? "now" : ""}>
            <span className="dot">{i < idx ? <Check size={12} /> : ""}</span>
            {s.label}
          </li>
        ))}
      </ul>
      <button
        className="link"
        disabled={job.cancel_requested}
        onClick={async () => {
          try {
            await api.cancel(job.job_id);
          } catch {
            /* it finished on its own in the meantime: the refresh below shows how it ended */
          }
          onChange();
        }}
      >
        {job.cancel_requested ? "Stopping…" : "Stop"}
      </button>
    </div>
  );
}

function Failed({ job, onChange, stopped }: { job: Job; onChange: () => void; stopped?: boolean }) {
  return (
    <div className="card stack">
      <h2>{stopped ? "This analysis was stopped" : "We couldn't finish this one"}</h2>
      {!stopped && <p className="sub">Something went wrong while processing. Trying again usually works, and nothing already done is repeated.</p>}
      {job.error && (
        <p className="error">
          <AlertTriangle size={16} /> {job.error}
        </p>
      )}
      <button
        className="btn"
        onClick={async () => {
          try {
            await api.retry(job.job_id);
          } catch {
            /* already running again: the refresh below shows where it is */
          }
          onChange();
        }}
      >
        Try again
      </button>
    </div>
  );
}

/** `employee` is the salesperson this recording was filed under (when exactly one person sells in it). */
function speakerName(r: Report, employee?: string | null) {
  const count: Record<string, number> = {};
  r.speakers.forEach((s) => (count[s.role] = (count[s.role] ?? 0) + 1));
  const map = new Map<string, string>();
  // Voices are labelled A, B, C by the transcription service in order of appearance. Show customers as
  // "Customer 1, 2, 3" in that same order instead of exposing those letters.
  const customerOrder = r.speakers.filter((s) => s.role === "customer").map((s) => s.speaker).sort();
  r.speakers.forEach((s) => {
    if (s.role === "customer") {
      map.set(s.speaker, customerOrder.length > 1 ? `Customer ${customerOrder.indexOf(s.speaker) + 1}` : "Customer");
      return;
    }
    const onlySeller = s.role === "salesperson" && count.salesperson === 1 && employee;
    if (onlySeller) {
      map.set(s.speaker, employee);
      return;
    }
    const base = s.role === "salesperson" ? "Salesperson" : "Other person";
    map.set(s.speaker, count[s.role] > 1 ? `${base} ${s.speaker}` : base);
  });
  // Some analysis steps echo back a role-annotated label ("A (salesperson)") instead of the
  // bare id ("A") in their own `speaker` field - strip that before the lookup.
  return (s: string) => {
    const key = s.replace(/\s*\([^)]*\)\s*$/, "").trim();
    return map.get(key) ?? `Speaker ${key}`;
  };
}

const TABS = ["overview", "summary", "outcomes", "evidence", "conversations", "transcript"] as const;
type Tab = (typeof TABS)[number];

function Results({ job }: { job: Job }) {
  const id = job.job_id;
  const outcomes = useLoad(() => api.outcomes(id), [id]);
  const report = useLoad(() => api.report(id), [id]);
  const transcript = useLoad(() => api.transcript(id), [id]);
  // Optional deep link, read once on load: ?tab=conversations&conv=<conversation_id>.
  const [params] = useSearchParams();
  const [initial] = useState(() => {
    const t = params.get("tab");
    const c = params.get("conv");
    const tab = (TABS as readonly string[]).includes(t ?? "") ? (t as Tab) : null;
    const conv = c !== null && /^\d{1,9}$/.test(c) ? Number(c) : null;
    return { tab: tab ?? (conv !== null ? "conversations" : "overview"), conv };
  });
  const [tab, setTab] = useState<Tab>(initial.tab);
  const [scrollConv, setScrollConv] = useState<number | null>(initial.tab === "conversations" ? initial.conv : null);
  const [scrollSeg, setScrollSeg] = useState<number | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const [audioError, setAudioError] = useState(false);
  const [playNotice, setPlayNotice] = useState("");
  const seek = (time: number) => {
    if (!audio.current || audioError) return;
    audio.current.currentTime = Math.max(0, time);
    audio.current.play().then(() => setPlayNotice("")).catch(() => setPlayNotice("Press play on the recording to listen."));
  };

  if (outcomes.error || report.error)
    return (
      <p className="error">
        <AlertTriangle size={16} /> {outcomes.error ?? report.error}
      </p>
    );
  if (!outcomes.data || !report.data) return <div className="skeleton" style={{ height: 240 }} />;
  const o = outcomes.data;
  const r = report.data;

  const segments: Segment[] = transcript.data?.transcript.segments ?? [];
  const segById = new Map(segments.map((s) => [s.id, s]));
  const evBy = evidenceIndex(r.evidence);
  const who = speakerName(r, job.salesperson_name);
  const sales = r.conversations.filter((c) => c.is_sales_interaction);

  const ctx: RecCtx = {
    report: r,
    outcomes: o,
    segments,
    segById,
    evBy,
    who,
    seek,
    gotoConversation: (cid) => {
      setTab("conversations");
      setScrollConv(cid);
    },
    gotoLine: (segId) => {
      setTab("transcript");
      setScrollSeg(segId);
    },
  };

  const labels: Record<Tab, string> = {
    overview: "Overview",
    summary: "Summary",
    outcomes: "Outcomes",
    evidence: `Evidence (${r.evidence.length})`,
    conversations: `Conversations (${r.conversations.length})`,
    transcript: "Full transcript",
  };

  return (
    <>
      <div className="card">
        <div className="recording-audio">
          <h3>Listen to the recording</h3>
          <audio ref={audio} controls preload="metadata" aria-label="Recording audio" src={`/api/jobs/${id}/audio`}
            onError={() => setAudioError(true)}
            onLoadedMetadata={() => {
              const value = params.get("t");
              const time = value === null ? NaN : Number(value);
              if (audio.current && Number.isFinite(time) && time >= 0) {
                audio.current.currentTime = Math.min(time, Number.isFinite(audio.current.duration) ? audio.current.duration : time);
              }
            }} />
          {audioError ? <p role="status">Audio is unavailable for this recording. The transcript and findings are still available below.</p> : <p className="sub small">Use a timestamp to listen in context. Linked examples start a few seconds before the highlighted moment; press play to listen.</p>}
          {playNotice && <p role="status">{playNotice}</p>}
        </div>
        <div className="row">
          <h2 style={{ marginBottom: 0, flex: 1 }}>Shift recording</h2>
          <span className="pill good">Ready</span>
        </div>
        <div className="chips" style={{ marginTop: 14 }}>
          <span className="chip">
            <b>{clock(r.duration_s)}</b>
          </span>
          <span className="chip">
            <b>{r.speakers.length}</b> voices
          </span>
          <span className="chip">
            <b>{sales.length}</b> sales conversation{sales.length === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      <div className="tabs" style={{ flexWrap: "wrap" }}>
        {TABS.map((t) => (
          <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
            {labels[t]}
          </button>
        ))}
      </div>

      {tab === "overview" && <Overview ctx={ctx} />}
      {tab === "summary" && <SummaryTab ctx={ctx} />}
      {tab === "outcomes" && <Outcomes ctx={ctx} />}
      {tab === "evidence" && <Evidence ctx={ctx} />}
      {tab === "conversations" && (
        <Conversations ctx={ctx} scrollTo={scrollConv} onScrolled={() => setScrollConv(null)} />
      )}
      {tab === "transcript" && <TranscriptTab ctx={ctx} scrollTo={scrollSeg} onScrolled={() => setScrollSeg(null)} />}
    </>
  );
}
