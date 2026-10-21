import { useState } from "react";
import QuadrantMap from "../components/dashboard/QuadrantMap";
import TeamGlanceTable from "../components/TeamGlanceTable";
import "../components/people/people.css";
import { AlertTriangle, Users } from "../icons/Icons";
import { api } from "../lib/api";
import type { Period } from "../lib/period";
import { PERIOD_LABEL } from "../lib/teamLabels";
import { useLoad } from "../lib/hooks";

export default function Team() {
  const [period, setPeriod] = useState<Period>("week");
  const { data, error } = useLoad(() => api.dashboard(period), [period]);
  const people = data?.people ?? [];

  return (
    <>
      <div className="head row" style={{ flexWrap: "wrap" }}>
        <div className="grow" style={{ minWidth: 220 }}>
          <div className="row" style={{ gap: 10 }}>
            <h1>Your team</h1>
          </div>
          <p className="sub">How each salesperson did {PERIOD_LABEL[period]}.</p>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <div className="seg">
            {(["day", "week", "month"] as Period[]).map((p) => (
              <button key={p} className={period === p ? "on" : ""} onClick={() => setPeriod(p)}>
                {p === "day" ? "Daily" : p === "week" ? "Weekly" : "Monthly"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <p className="error">
          <AlertTriangle size={16} /> {error}
        </p>
      )}
      {!data && !error && <div className="skeleton" style={{ height: 220 }} />}

      {data && people.length > 0 && (
        <p className="sub small" style={{ margin: "0 0 12px" }}>
          {people.length} salesperson{people.length === 1 ? "" : "s"} · {data.jobs_counted} completed recording
          {data.jobs_counted === 1 ? "" : "s"}
          {data.jobs_skipped > 0 && ` · ${data.jobs_skipped} skipped (reports can't be read)`} · placed by recording date
        </p>
      )}

      {data && people.length === 0 && (
        <div className="card empty">
          <div className="icon-wrap">
            <Users size={20} />
          </div>
          <h2>No data yet</h2>
          <p>No recordings to show yet.</p>
        </div>
      )}

      {data && people.length > 0 && <QuadrantMap people={people} />}

      {data && people.length > 0 && <TeamGlanceTable people={people} />}
    </>
  );
}
