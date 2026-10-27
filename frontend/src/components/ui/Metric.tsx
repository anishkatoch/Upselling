import type { ReactNode } from "react";
import InfoTip from "./InfoTip";
import "./ui.css";

/** One key figure: label (with an optional explanation), big value, then a small footer (change, sample size). */
export default function Metric({
  label,
  value,
  unit,
  info,
  foot,
  meter,
  tone,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  info?: ReactNode;
  foot?: ReactNode;
  /** 0 to 1: draws a thin bar under the value (for a share). */
  meter?: number | null;
  /** Colours a dot before the value (for a state such as customer mood). */
  tone?: "good" | "warn" | "bad" | "neutral";
}) {
  return (
    <div className={`metric${tone ? ` tone-${tone}` : ""}`}>
      <div className="metric-label">
        {label}
        {info && <InfoTip>{info}</InfoTip>}
      </div>
      <div className="metric-value">
        {tone && <span className="m-dot" aria-hidden="true" />}
        {value}
        {unit && <small>{unit}</small>}
      </div>
      {meter != null && (
        <div className="m-meter" aria-hidden="true">
          <i style={{ width: `${Math.round(Math.min(1, Math.max(0, meter)) * 100)}%` }} />
        </div>
      )}
      <div className="metric-foot">{foot}</div>
    </div>
  );
}

/** Lay Metric tiles out as one bordered strip. */
export function MetricRow({ children }: { children: ReactNode }) {
  return <div className="metric-row">{children}</div>;
}
