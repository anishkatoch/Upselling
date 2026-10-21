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
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  info?: ReactNode;
  foot?: ReactNode;
}) {
  return (
    <div className="metric">
      <div className="metric-label">
        {label}
        {info && <InfoTip>{info}</InfoTip>}
      </div>
      <div className="metric-value">
        {value}
        {unit && <small>{unit}</small>}
      </div>
      <div className="metric-foot">{foot}</div>
    </div>
  );
}

/** Lay Metric tiles out as one bordered strip. */
export function MetricRow({ children }: { children: ReactNode }) {
  return <div className="metric-row">{children}</div>;
}
