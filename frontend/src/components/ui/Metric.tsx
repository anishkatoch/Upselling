import type { ReactNode } from "react";
import InfoTip from "./InfoTip";
import "./ui.css";

type Tone = "good" | "warn" | "bad" | "neutral";

/** One key figure: icon and label (with an optional explanation), a status word, the big value, a small visual, then a footer. */
export default function Metric({
  label,
  value,
  unit,
  info,
  foot,
  meter,
  tone,
  icon,
  status,
  pips,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  info?: ReactNode;
  foot?: ReactNode;
  /** 0 to 1: draws a bar under the value (for a share). */
  meter?: number | null;
  /** Tints the tile and colours its icon and status (how it is going). */
  tone?: Tone;
  icon?: ReactNode;
  /** A word in the corner, such as "Strong" or "Needs work". */
  status?: string;
  /** One small square per conversation (filled = it happened). Used while there are few conversations; a bar otherwise. */
  pips?: { on: number; total: number; bad?: boolean };
}) {
  const showPips = pips != null && pips.total > 0 && pips.total <= 12;
  return (
    <div className={`metric${tone ? ` tone-${tone}` : ""}${icon ? " has-icon" : ""}`}>
      <div className="metric-head">
        {icon && (
          <span className="m-ico" aria-hidden="true">
            {icon}
          </span>
        )}
        <div className="metric-label">
          {label}
          {info && <InfoTip>{info}</InfoTip>}
        </div>
      </div>
      <div className="metric-valuebar">
        <div className="metric-value">
          {tone && !status && <span className="m-dot" aria-hidden="true" />}
          {value}
          {unit && <small>{unit}</small>}
        </div>
        {status && <span className="m-status">{status}</span>}
      </div>
      {showPips && pips ? (
        <div className={`m-pips${pips.bad ? " bad" : ""}`} role="img" aria-label={`${pips.on} of ${pips.total}`}>
          {Array.from({ length: pips.total }, (_, i) => (
            <i key={i} className={i < pips.on ? "on" : ""} />
          ))}
        </div>
      ) : (
        meter != null && (
          <div className="m-meter" aria-hidden="true">
            <i style={{ width: `${Math.round(Math.min(1, Math.max(0, meter)) * 100)}%` }} />
          </div>
        )
      )}
      <div className="metric-foot">{foot}</div>
    </div>
  );
}

/** Lay Metric tiles out as one bordered strip. */
export function MetricRow({ children }: { children: ReactNode }) {
  return <div className="metric-row">{children}</div>;
}
