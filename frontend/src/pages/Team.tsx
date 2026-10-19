import { useState } from "react";
import { useLocation } from "react-router-dom";
import TeamGlanceTable from "../components/TeamGlanceTable";
import { AlertTriangle, Headset, Users } from "../icons/Icons";
import { api } from "../lib/api";
import { DEMO_DASHBOARD as DEMO, type Period } from "../lib/demo";
import { PERIOD_LABEL } from "../lib/teamLabels";
import { useLoad } from "../lib/hooks";

export default function Team() {
  const location = useLocation();
  const [period, setPeriod] = useState<Period>("week");
  const [demo, setDemo] = useState(Boolean((location.state as { demo?: boolean } | null)?.demo));
  const [showUnassigned, setShowUnassigned] = useState(false);
  const { data: live, error, reload } = useLoad(() => api.dashboard(period), [period]);
  const data = demo ? DEMO[period] : live;
  const people = data?.people ?? [];

  return (
    <>
      <div className="head row">
        <div className="grow">
          <div className="row" style={{ gap: 10 }}>
            <h1>Your team</h1>
            {demo && <span className="pill accent">Sample data</span>}
          </div>
          <p className="sub">
            {demo
              ? `Invented people and recordings, to show how this looks once your team has history. Showing ${PERIOD_LABEL[period]}.`
              : `How each salesperson did ${PERIOD_LABEL[period]}.`}
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
          <div className="seg">
            {(["day", "week", "month"] as Period[]).map((p) => (
              <button key={p} className={period === p ? "on" : ""} onClick={() => setPeriod(p)}>
                {p === "day" ? "Daily" : p === "week" ? "Weekly" : "Monthly"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!demo && error && (
        <p className="error">
          <AlertTriangle size={16} /> {error}
        </p>
      )}
      {!demo && !data && !error && <div className="skeleton" style={{ height: 220 }} />}

      {data && people.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="chips">
            <span className="chip">
              <b>{people.length}</b> named salesperson{people.length === 1 ? "" : "s"}
            </span>
            <span className="chip">
              <b>{data.jobs_counted}</b> completed recording{data.jobs_counted === 1 ? "" : "s"}
            </span>
            {data.jobs_skipped > 0 && (
              <span className="chip" title="Their saved reports are in a format that can't be read">
                {data.jobs_skipped} skipped
              </span>
            )}
            <span className="chip" title="Recordings are placed by the date they were uploaded">
              by upload date
            </span>
          </div>
        </div>
      )}

      {data && people.length === 0 && (demo || data.unassigned.length === 0) && (
        <div className="card empty">
          <div className="icon-wrap">
            <Users size={20} />
          </div>
          <h2>No data yet</h2>
          <p>Analyse a recording and your team&apos;s results will show up here.</p>
        </div>
      )}

      {!demo && data && data.unassigned.length > 0 && (
        <div className="card row" style={{ marginBottom: 16, gap: 14 }}>
          <div className="item-icon">
            <Users size={16} />
          </div>
          <div className="grow">
            <b>
              {data.unassigned.length} salesperson{data.unassigned.length > 1 ? "s" : ""} need a name
            </b>
            <div className="sub small">So their recordings get grouped together.</div>
          </div>
          <button className="btn ghost small" onClick={() => setShowUnassigned((v) => !v)}>
            {showUnassigned ? "Hide" : "Name them"}
          </button>
        </div>
      )}

      {!demo && data && data.unassigned.length > 0 && showUnassigned && (
        <div className="reveal" style={{ marginBottom: 16 }}>
          <Unassigned items={data.unassigned} onDone={reload} />
        </div>
      )}

      {data && people.length > 0 && <TeamGlanceTable people={people} demo={demo} />}
    </>
  );
}

function Unassigned({
  items,
  onDone,
}: {
  items: { job_id: string; speaker: string; filename: string; conversations: number }[];
  onDone: () => void;
}) {
  return (
    <div className="card">
      <h2>Who is this?</h2>
      <p className="sub small" style={{ marginBottom: 6 }}>
        These salespeople couldn&apos;t be matched to a name. Add one so their recordings are grouped together.
      </p>
      <ul className="list" style={{ marginTop: 8 }}>
        {items.map((u) => (
          <NameRow key={u.job_id + u.speaker} u={u} onDone={onDone} />
        ))}
      </ul>
    </div>
  );
}

function NameRow({
  u,
  onDone,
}: {
  u: { job_id: string; speaker: string; filename: string; conversations: number };
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <li className="item">
      <div className="item-icon">
        <Headset size={16} />
      </div>
      <div className="grow">
        <div className="name">{u.filename}</div>
        <div className="sub small">
          {u.conversations} conversation{u.conversations !== 1 ? "s" : ""}
        </div>
      </div>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name"
        style={{ font: "inherit", fontSize: 14, padding: "9px 12px", border: "1px solid var(--line)", borderRadius: 10, width: 150 }}
      />
      <button
        className="btn"
        disabled={!name.trim() || saving}
        onClick={async () => {
          setSaving(true);
          await api.nameSpeaker(u.job_id, u.speaker, name.trim());
          onDone();
        }}
      >
        Save
      </button>
    </li>
  );
}
