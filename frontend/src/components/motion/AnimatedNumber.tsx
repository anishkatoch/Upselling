import { animate, useInView, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { DUR, EASE } from "../../lib/motion";

/** Counts up to `value` once when it scrolls into view. Renders the final value straight away for reduced motion. */
export default function AnimatedNumber({ value, decimals = 0, duration = DUR.slow + 0.3 }: { value: number; decimals?: number; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(reduce ? value : 0);
  useEffect(() => {
    if (reduce) {
      setShown(value);
      return;
    }
    if (!inView) return;
    const c = animate(0, value, { duration, ease: EASE, onUpdate: (v) => setShown(v) });
    return () => c.stop();
  }, [inView, value, duration, reduce]);
  return (
    <span ref={ref} style={{ fontVariantNumeric: "tabular-nums" }}>
      {shown.toFixed(decimals)}
    </span>
  );
}
