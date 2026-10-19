/**
 * A small single-series trend line (not a full dedicated chart): thin line, light area fill,
 * a recessive baseline, and a round hover marker per point. One series, so no legend - the
 * heading above it already names what's plotted (per the dataviz skill's single-series rule).
 *
 * Markers are plain HTML dots positioned by percentage, not SVG circles, so they stay
 * perfectly round even though the SVG itself stretches non-uniformly to fill the container.
 */
export default function LineChart<T>({
  data,
  value,
  label,
  format = (v: number) => String(v),
  compact = false,
  xTitle,
  yTitle,
}: {
  data: T[];
  value: (d: T) => number | null;
  label: (d: T) => string;
  format?: (v: number) => string;
  /** Sparkline mode for tight spaces (a table cell): no hover dots, smaller fixed box. */
  compact?: boolean;
  /** Axis captions, e.g. "Month" / "Upsell rate". Full-size charts only. */
  xTitle?: string;
  yTitle?: string;
}) {
  const points = data.map((d, i) => ({
    x: data.length > 1 ? (i / (data.length - 1)) * 100 : 50,
    v: value(d),
    label: label(d),
  }));
  const rawMax = Math.max(1e-9, ...points.map((p) => p.v ?? 0));
  const { max, ticks } = compact ? { max: rawMax, ticks: [] as number[] } : niceScale(rawMax);
  const plotted = points.filter((p): p is { x: number; v: number; label: string } => p.v != null);
  const y = (v: number) => 100 - (Math.max(0, v) / max) * 100;

  const linePath = plotted.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${y(p.v)}`).join(" ");
  const areaPath = plotted.length
    ? `${linePath} L${plotted[plotted.length - 1].x},100 L${plotted[0].x},100 Z`
    : "";

  const svg = (
    <>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        {!compact && ticks.map((t) => (
          <line key={t} x1="0" x2="100" y1={y(t)} y2={y(t)} stroke="var(--line-soft)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ))}
        {areaPath && <path d={areaPath} fill="var(--accent-soft)" stroke="none" />}
        {linePath && (
          <path
            d={linePath}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={compact ? 2.5 : 2}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      {!compact &&
        plotted.map((p) => (
          <div key={p.x} className="lc-dot" style={{ left: `${p.x}%`, top: `${y(p.v)}%` }} title={`${p.label}: ${format(p.v)}`} />
        ))}
    </>
  );

  if (compact) {
    return (
      <div className="linechart linechart-compact" title={plotted.map((p) => `${p.label}: ${format(p.v)}`).join(" · ")}>
        {svg}
      </div>
    );
  }

  // Show at most ~6 x labels so they never collide; always keep the first and last.
  const step = Math.max(1, Math.ceil(points.length / 6));
  return (
    <div className="chart-axes">
      {yTitle && <div className="chart-ytitle">{yTitle}</div>}
      <div className="chart-yticks">
        {ticks.map((t) => (
          <span key={t} style={{ top: `${y(t)}%` }}>{format(t)}</span>
        ))}
      </div>
      <div className="linechart">{svg}</div>
      <div className="chart-xlabels">
        {points.map((p, i) =>
          i % step === 0 || i === points.length - 1 ? (
            <span key={p.x} style={{ left: `${p.x}%` }}>{p.label}</span>
          ) : null,
        )}
      </div>
      {xTitle && <div className="chart-xtitle">{xTitle}</div>}
    </div>
  );
}

/** Round the top of the y axis up to a friendly number and return 0..max tick values. */
function niceScale(rawMax: number): { max: number; ticks: number[] } {
  const exp = Math.pow(10, Math.floor(Math.log10(rawMax)));
  const f = rawMax / exp;
  const step = (f <= 1 ? 0.2 : f <= 2 ? 0.5 : f <= 5 ? 1 : 2) * exp;
  const max = Math.ceil(rawMax / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let t = 0; t <= max + step / 2; t += step) ticks.push(Number(t.toPrecision(10)));
  return { max, ticks };
}
