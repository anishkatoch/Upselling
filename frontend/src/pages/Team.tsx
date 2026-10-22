import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import QuadrantMap from "../components/dashboard/QuadrantMap";
import TeamGlanceTable from "../components/TeamGlanceTable";
import "../components/people/people.css";
import { AlertTriangle, Users } from "../icons/Icons";
import { api } from "../lib/api";
import type { Period } from "../lib/period";
import { PERIOD_LABEL } from "../lib/teamLabels";
import { useLoad } from "../lib/hooks";
import { DUR, EASE } from "../lib/motion";
import { Reveal } from "../components/motion";
import { isNotRated } from "../components/people/rating";
import type { Person } from "../lib/api";

type RatingFilter = "all" | "needs_work" | "solid" | "strong" | "not_rated";
const FILTERS: { key: RatingFilter; label: string }[] = [
  { key: "all", label: "Everyone" },
  { key: "needs_work", label: "Needs support" },
  { key: "solid", label: "On track" },
  { key: "strong", label: "Excelling" },
  { key: "not_rated", label: "Not rated" },
];
const matches = (p: Person, f: RatingFilter) =>
  f === "all" ? true : f === "not_rated" ? isNotRated(p) : !isNotRated(p) && p.assessment.rating === f;

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
  const [view, setView] = useState<"table" | "map">("table");
  const { data, error } = useLoad(() => api.dashboard(period), [period]);
  const people = data?.people ?? [];
  const shown = people.filter((p) => matches(p, rating));

  return (
    <>
      <Reveal className="head row hero" style={{ flexWrap: "wrap" }}>
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
          className="view-switch vs-anim"
          role="tablist"
          aria-label="Choose how to see the team: as a table or as a map"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: DUR.base, ease: EASE, delay: 0.12 }}
        >
          {(["table", "map"] as const).map((v) => (
            <button key={v} role="tab" aria-selected={view === v} className={view === v ? "on" : ""} onClick={() => setView(v)}>
              {view === v && <motion.span layoutId="view-pill" className="vs-pill" transition={{ duration: 0.25, ease: EASE }} />}
              <span className="vs-label">{v === "table" ? "Table" : "Upsell map"}</span>
            </button>
          ))}
        </motion.div>
      )}

      {data && people.length > 0 && (
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={view}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.2, ease: EASE } }}
            exit={{ opacity: 0, y: -8, transition: { duration: 0.15 } }}
          >
            {view === "map" ? (
              <QuadrantMap people={people} />
            ) : (
              <>
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
                  <TeamGlanceTable people={shown} />
                ) : (
                  <div className="card empty">
                    <p>Nobody is in this group for {PERIOD_LABEL[period]}.</p>
                    <button className="btn ghost" onClick={() => setRating("all")}>
                      Show everyone
                    </button>
                  </div>
                )}
              </>
            )}
          </motion.div>
        </AnimatePresence>
      )}
    </>
  );
}
