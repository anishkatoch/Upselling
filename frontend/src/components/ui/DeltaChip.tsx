import "./ui.css";

/**
 * "▲ 4.2 pt" / "▼ 1.1": the change since the previous period. Green is good, red is bad, grey is no change.
 * `value` is in the metric's own unit (percentage points for rates); `lowerIsBetter` flips the colours.
 */
export default function DeltaChip({
  value,
  unit = "pt",
  decimals = 1,
  lowerIsBetter = false,
}: {
  value: number | null | undefined;
  unit?: string;
  decimals?: number;
  lowerIsBetter?: boolean;
}) {
  if (value == null || !Number.isFinite(value)) return null;
  const flat = Math.abs(value) < Math.pow(10, -decimals) / 2;
  const good = lowerIsBetter ? value < 0 : value > 0;
  const cls = flat ? "flat" : good ? "up" : "down";
  const arrow = flat ? "–" : value > 0 ? "▲" : "▼";
  return (
    <span className={`delta ${cls}`} title="Change since the previous period">
      {arrow} {flat ? "no change" : `${Math.abs(value).toFixed(decimals)}${unit ? ` ${unit}` : ""}`}
    </span>
  );
}
