import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";
import { DUR, EASE } from "../../lib/motion";

const view = { once: true, margin: "-20px" } as const;

/** A bar fill that grows from the left once when scrolled into view. Shown fully for reduced motion. */
export function GrowFill({ width, delay = 0, className }: { width: string | number; delay?: number; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      style={{ width, transformOrigin: "left center" }}
      initial={reduce ? false : { scaleX: 0 }}
      whileInView={{ scaleX: 1 }}
      viewport={view}
      transition={{ duration: DUR.slow, ease: EASE, delay }}
    />
  );
}

/** Reveals its children left to right once (clip wipe: no layout work, text is never squashed). */
export function Wipe({ children, delay = 0, className, ...aria }: { children: ReactNode; delay?: number; className?: string; role?: string; "aria-label"?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { clipPath: "inset(0 100% 0 0)" }}
      whileInView={{ clipPath: "inset(0 0% 0 0)" }}
      viewport={view}
      transition={{ duration: DUR.slow, ease: EASE, delay }}
      {...aria}
    >
      {children}
    </motion.div>
  );
}
