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
