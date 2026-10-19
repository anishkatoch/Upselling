import { Link } from "react-router-dom";
import StatusPill from "../components/StatusPill";
import { AlertTriangle, ChevronRight, Headset, Plus } from "../icons/Icons";
import { api, type Job } from "../lib/api";
import { ago } from "../lib/format";
import { useLoad } from "../lib/hooks";

const busy = (jobs: Job[]) => jobs.some((j) => j.status === "queued" || j.status === "running");

export default function Recordings() {
  const { data: jobs, error } = useLoad(() => api.jobs(), [], { every: 4000, keep: busy });
  return (
    <>
      <div className="head row">
        <div className="grow">
          <h1>Recordings</h1>
          <p className="sub">Every recording you&apos;ve uploaded, and what we found.</p>
        </div>
        <Link to="/upload" className="btn">
          <Plus size={16} /> New recording
        </Link>
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
            <p style={{ marginBottom: 14 }}>Nothing here yet.</p>
            <Link to="/upload" className="btn">
              <Plus size={16} /> Upload your first recording
            </Link>
          </div>
        )}
        {jobs && jobs.length > 0 && (
          <ul className="list">
            {jobs.map((j) => (
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
