import type { Bucket, Person } from "../../lib/api";
import { formatPeriod } from "../../lib/period";
import { RATING } from "../../lib/teamLabels";

export const NOT_RATED_TEXT = "Not enough analysed calls to rate";

/** True when the backend says there is too little data to rate this person. */
export const isNotRated = (p: Person) => p.assessment.insufficient_data === true;

/** The rating chip, or a neutral "not enough data" chip. `short` is for tight table cells. */
export function RatingChip({ person, short }: { person: Person; short?: boolean }) {
  if (isNotRated(person)) {
    return (
      <span className={`pill neutral not-rated ${short ? "" : "long"}`} title={NOT_RATED_TEXT}>
        {short ? "Not rated" : NOT_RATED_TEXT}
      </span>
    );
  }
  const r = RATING[person.assessment.rating];
  return <span className={`pill ${r.tone}`}>{r.label}</span>;
}

/** Small badge for lists when `total` is an earlier period, not the current one. */
export function StalePeriodBadge({ person }: { person: Person }) {
  if (person.is_current !== false) return null;
  return (
    <span className="pill neutral stale-badge" title={`No calls this period - showing ${formatPeriod(person.total.period)}`}>
      Earlier period
    </span>
  );
}

/** Notice for the Person page. */
export function StalePeriodNotice({ person, unit }: { person: Person; unit: "day" | "week" | "month" }) {
  if (person.is_current !== false) return null;
  return (
    <p className="notice">
      No calls this {unit} - showing {unit} of {formatPeriod(person.total.period)}.
    </p>
  );
}

export const analysedCount = (b: Bucket) => b.analysed_conversations ?? b.conversations;

/** "based on N analysed conversations" plus the shared-conversation caveat when it applies. */
export function SampleNote({ bucket }: { bucket: Bucket }) {
  const n = analysedCount(bucket);
  const shared = bucket.shared_conversations ?? 0;
  return (
    <div className="sub small sample-note">
      Based on {n} analysed conversation{n === 1 ? "" : "s"}.
      {shared > 0 && (
        <>
          {" "}
          {shared} conversation{shared === 1 ? "" : "s"} with more than one salesperson {shared === 1 ? "is" : "are"} not counted in
          greeting, pushy and unanswered-question figures.
        </>
      )}
    </div>
  );
}

type NumKey = "upsell_rate" | "acceptance_rate" | "greeting_rate" | "avg_customer_frustration" | "avg_effort" | "attempts_per_conversation";

/** Change of one figure between the last two buckets of a series; null with fewer than 2 or a missing value. `scale` 100 turns a rate into percentage points. */
export function seriesDelta(series: Bucket[], key: NumKey, scale = 1): number | null {
  if (series.length < 2) return null;
  const a = series[series.length - 1][key];
  const b = series[series.length - 2][key];
  if (a == null || b == null) return null;
  return (a - b) * scale;
}
