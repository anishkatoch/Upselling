import { Link } from "react-router-dom";
import StatusPill from "../components/StatusPill";
import { AlertTriangle, ChevronRight, Headset } from "../icons/Icons";
import { api, type Job } from "../lib/api";
import { ago, recordingTitle } from "../lib/format";
import { useLoad } from "../lib/hooks";

const busy = (jobs: Job[]) => jobs.some((j) => j.status === "queued" || j.status === "running");

export default function Recordings() {
  const { data: jobs, error } = useLoad(() => api.jobs(), [], { every: 4000, keep: busy });
  return (
    <>
      <div className="head row">
        <div className="grow">
          <h1>Recordings</h1>
          <p className="sub">Every recording, and what we found.</p>
        </div>
      </div>

      <div className="card">
        {error && (
          <p className="error">
            <AlertTriangle size={16} /> Can&apos;t reach the server. Is the backend running?
          </p>
        )}
        {!jobs && !error && <RowsSkeleton />}
        {jobs && jobs.length === 0 && (
          <div className="empty">
            <div className="icon-wrap">
              <Headset size={20} />
            </div>
            <p>No recordings to show yet.</p>
          </div>
        )}
        {jobs && jobs.length > 0 && (
          <ul className="list">
            {jobs.map((j) => (
              <Link key={j.job_id} to={`/recordings/${j.job_id}`} className="item">
                <div className="grow name">{recordingTitle(j)}</div>
                <span className="sub small">{ago(j.created_at)}</span>
                <StatusPill job={j} />
                <ChevronRight size={16} className="item-chev" />
              </Link>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function RowsSkeleton() {
  return (
    <div className="stack">
      {[0, 1, 2].map((i) => (
        <div className="skeleton" key={i} style={{ height: 52 }} />
      ))}
    </div>
  );
}
