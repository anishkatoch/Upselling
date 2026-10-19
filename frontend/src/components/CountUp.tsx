import { useEffect, useRef, useState } from "react";

/**
 * Tweens from 0 to `value` over `duration` ms using requestAnimationFrame - no charting/animation
 * dependency needed for this. Non-numeric values (e.g. "–" for missing data) pass through as-is,
 * so callers can use this unconditionally on fields that are sometimes a placeholder string.
 */
export default function CountUp({ value, duration = 600 }: { value: number | string; duration?: number }) {
  const numeric = typeof value === "number" && Number.isFinite(value);
  const [display, setDisplay] = useState(numeric ? 0 : value);
  const raf = useRef<number>(0);

  useEffect(() => {
    if (!numeric) {
      setDisplay(value);
      return;
    }
    const target = value as number;
    const start = performance.now();
    const from = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) * (1 - t); // ease-out
      const current = from + (target - from) * eased;
      setDisplay(Math.round(current * 10) / 10);
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration, numeric]);

  return <>{display}</>;
}
