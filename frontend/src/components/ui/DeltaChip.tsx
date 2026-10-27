import "./ui.css";

/**
 * "▲ 25 points" / "▼ 10 points" / "– no change": how a figure moved since the previous period.
 * Green is good, red is bad, grey is no change. `value` is in the metric's own unit (percentage points for
 * percent figures); `lowerIsBetter` flips the colours. `upText` / `downText` replace the number with words
 * (used where the number would mean nothing to a reader, e.g. customer mood).
 */
export default function DeltaChip({
  value,
  unit = "points",
  lowerIsBetter = false,
  upText,
  downText,
}: {
  value: number | null | undefined;
  unit?: string;
  lowerIsBetter?: boolean;
  upText?: string;
  downText?: string;
}) {
  if (value == null || !Number.isFinite(value)) return null;
  const whole = Math.round(Math.abs(value));
  const flat = whole === 0;
  const good = lowerIsBetter ? value < 0 : value > 0;
  const cls = flat ? "flat" : good ? "up" : "down";
  const arrow = flat ? "–" : good ? "▲" : "▼"; // up is always the better direction, whichever way the number moved
  const words = value > 0 ? upText : downText;
  const unitText = unit === "points" && whole === 1 ? "point" : unit;
  const text = flat ? "no change" : (words ?? `${whole}${unitText ? ` ${unitText}` : ""}`);
  return (
    <span className={`delta ${cls}`} title="Compared with the previous period">
      <span className="ar">{arrow}</span> {text}
    </span>
  );
}
