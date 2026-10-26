export type Period = "day" | "week" | "month";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-08" -> "Aug 2026"; "2026-08-14" -> "14 Aug 2026". Anything else is returned untouched. */
export function formatPeriod(period: string): string {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(period);
  if (!m) return period;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return period;
  return m[3] ? `${Number(m[3])} ${month} ${m[1]}` : `${month} ${m[1]}`;
}

/** What an arrow compares with, named by its real period: the previous period that has data, which is not always the
 * one right before it (there may be gaps). "2026-09" -> "Sep 2026"; a week label -> "the week of 22 Sep 2026". */
export function describePrevious(period: Period, label: string): string {
  const text = formatPeriod(label);
  return period === "week" ? `the week of ${text}` : text;
}
