import { motion } from "framer-motion";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import TeamGlanceTable from "../components/TeamGlanceTable";
import "../components/people/people.css";
import { AlertTriangle, Users } from "../icons/Icons";
import { api } from "../lib/api";
import { formatPeriod, type Period } from "../lib/period";
import { PERIOD_LABEL } from "../lib/teamLabels";
import { useLoad } from "../lib/hooks";
import { DUR, EASE } from "../lib/motion";
import { Reveal } from "../components/motion";
import { isProvisional } from "../components/people/rating";
import type { Person } from "../lib/api";

type RatingFilter = "all" | "needs_work" | "solid" | "strong" | "not_rated";
const FILTERS: { key: RatingFilter; label: string }[] = [
  { key: "all", label: "Everyone" },
  { key: "needs_work", label: "Needs support" },
  { key: "solid", label: "On track" },
  { key: "strong", label: "Excelling" },
  { key: "not_rated", label: "Not rated yet" },
];
const matches = (p: Person, f: RatingFilter) =>
  f === "all" ? true : f === "not_rated" ? isProvisional(p) : !isProvisional(p) && p.assessment.rating === f;

export default function Team() {
  // The Dashboard links here with ?period=month&rating=needs_work: open on that period, filtered to that group.
  const [params, setParams] = useSearchParams();
  const urlPeriod = params.get("period");
  const urlRating = params.get("rating");
  const [period, setPeriodState] = useState<Period>(urlPeriod === "day" || urlPeriod === "week" || urlPeriod === "month" ? urlPeriod : "week");
  const [rating, setRatingState] = useState<RatingFilter>(FILTERS.some((f) => f.key === urlRating) ? (urlRating as RatingFilter) : "all");
  const setPeriod = (p: Period) => {
    setPeriodState(p);
    const next = new URLSearchParams(params);
    next.set("period", p);
    setParams(next, { replace: true });
  };
  const setRating = (r: RatingFilter) => {
    setRatingState(r);
    const next = new URLSearchParams(params);
    if (r === "all") next.delete("rating");
    else next.set("rating", r);
    setParams(next, { replace: true });
  };
  const { data, error } = useLoad(() => api.dashboard(period), [period]);
  const people = data?.people ?? [];
  // With nothing recorded in the current day/week/month, everyone is shown on their latest period: say so.
  const allStale = people.length > 0 && people.every((p) => p.is_current === false);
  const latest = people.map((p) => p.total.period).sort()[people.length - 1];
  const shown = people.filter((p) => matches(p, rating));

  return (
    <>
      <Reveal className="head row hero" style={{ flexWrap: "wrap" }}>
        <div className="grow" style={{ minWidth: 220 }}>
          <div className="row" style={{ gap: 10 }}>
            <h1>Your team</h1>
          </div>
          <p className="sub">
            {allStale
              ? `Nothing was recorded ${PERIOD_LABEL[period]}, so this shows each person's latest ${period === "day" ? "day" : period === "week" ? "week" : "month"} with recordings (${formatPeriod(latest)}).`
              : `How each salesperson did ${PERIOD_LABEL[period]}.`}
          </p>
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
      </Reveal>

      {error && (
        <p className="error">
          <AlertTriangle size={16} /> {error}
        </p>
      )}
      {!data && !error && <div className="skeleton" style={{ height: 220 }} />}

      {data && people.length > 0 && (
        <motion.p className="sub small" style={{ margin: "0 0 12px" }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: DUR.base, ease: EASE, delay: 0.06 }}>
          {people.length} salesperson{people.length === 1 ? "" : "s"} · {data.jobs_counted} completed recording
          {data.jobs_counted === 1 ? "" : "s"}
          {data.jobs_skipped > 0 && ` · ${data.jobs_skipped} skipped (could not be read)`} · grouped by when each recording was made
        </motion.p>
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

      {data && people.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0, transition: { duration: DUR.base, ease: EASE } }}
        >
        <div className="rate-filter" role="group" aria-label="Show people by rating">
          {FILTERS.map((f) => {
            const n = people.filter((p) => matches(p, f.key)).length;
            return (
              <button key={f.key} className={rating === f.key ? "on" : ""} aria-pressed={rating === f.key} onClick={() => setRating(f.key)}>
                {f.label} <span>{n}</span>
              </button>
            );
          })}
        </div>
        {shown.length > 0 ? (
          <TeamGlanceTable period={period} people={shown} />
        ) : (
          <div className="card empty">
            <p>Nobody is in this group for {PERIOD_LABEL[period]}.</p>
            <button className="btn ghost" onClick={() => setRating("all")}>
              Show everyone
            </button>
          </div>
        )}
        </motion.div>
      )}
    </>
  );
}
