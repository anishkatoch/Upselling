import { Link, useNavigate } from "react-router-dom";
import "../components/people/people.css";
import StatusPill from "../components/StatusPill";
import { AlertTriangle, ChevronRight, Headset } from "../icons/Icons";
import { api, type Job } from "../lib/api";
import { useLoad } from "../lib/hooks";
import "./recordings.css";

const busy = (jobs: Job[]) => jobs.some((j) => j.status === "queued" || j.status === "running");
const dateOf = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

export default function Recordings() {
  const { data: jobs, error } = useLoad(() => api.jobs(), [], { every: 4000, keep: busy });
  const navigate = useNavigate();
  return (
    <>
      <div className="head row hero">
        <div className="grow">
          <h1>Conversations</h1>
          <p className="sub">Every conversation, and what we found.</p>
        </div>
      </div>

      {error && (
        <p className="error">
          <AlertTriangle size={16} /> Can&apos;t reach the server. Is the backend running?
        </p>
      )}
      {!jobs && !error && <RowsSkeleton />}
      {jobs && jobs.length === 0 && (
        <div className="card empty">
          <div className="icon-wrap">
            <Headset size={20} />
          </div>
          <p>No conversations to show yet.</p>
        </div>
      )}
      {jobs && jobs.length > 0 && (
        <section className="card tg rec-card">
          <div className="table-wrap rec-wrap" tabIndex={0} role="region" aria-label="Recordings table">
            <table className="rec-table">
              <caption className="sr-only">Every conversation, newest first</caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Date</th>
                  <th scope="col">Status</th>
                  <th scope="col" aria-label="Open" />
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => {
                  const href = `/recordings/${j.job_id}`;
                  const name = j.salesperson_name;
                  return (
                    <tr
                      key={j.job_id}
                      className="rowlink"
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest("a,button")) return;
                        navigate(href);
                      }}
                    >
                      <th scope="row" className="rowhead">
                        <div className="rec-who">
                          <span className={`rec-av${name ? "" : " none"}`} aria-hidden="true">
                            {name ? initials(name) : "?"}
                          </span>
                          <div>
                            <Link to={href} className="name-link">
                              {name ?? "Not named"}
                            </Link>
                            <div className="sub rec-file" dir="auto">{j.filename}</div>
                          </div>
                        </div>
                      </th>
                      <td className="rec-date">
                        {dateOf(j.created_at)} <span className="sub">{timeOf(j.created_at)}</span>
                      </td>
                      <td>
                        <StatusPill job={j} />
                      </td>
                      <td className="rec-chev" aria-hidden="true">
                        <ChevronRight size={16} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
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
