import { motion, type HTMLMotionProps } from "framer-motion";
import { createContext, useContext, useMemo, useState, type HTMLAttributes, type ReactNode } from "react";
import { fadeUp } from "../../lib/motion";

/** Fades and lifts its children into place once, when they first scroll into view. */
export function Reveal({ children, delay = 0, ...rest }: { children: ReactNode; delay?: number } & Omit<HTMLMotionProps<"div">, "children">) {
  return (
    <motion.div
      variants={fadeUp}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-40px" }}
      transition={{ delay }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

/** Hands out 0, 1, 2... in mount order. */
function takeNext(c: { n: number }) {
  return c.n++;
}

const StaggerCtx = createContext<{ next: () => number; gap: number; delay: number } | null>(null);

/**
 * Wrap a group; each <StaggerItem> inside fades up one after another (in render order).
 * Every item animates on its own, so items that mount later (after data loads) still appear: the earlier version
 * drove them from one parent variant, which left late-mounting children stuck invisible after a client-side navigation.
 */
export function Stagger({ children, gap = 0.06, delay = 0, ...rest }: { children: ReactNode; gap?: number; delay?: number } & HTMLAttributes<HTMLDivElement>) {
  // A plain counter object (not a ref): items take the next number when they first mount; the delay is capped.
  const [counter] = useState(() => ({ n: 0 }));
  const value = useMemo(() => ({ next: () => takeNext(counter), gap, delay }), [counter, gap, delay]);
  return (
    <StaggerCtx.Provider value={value}>
      <div {...rest}>{children}</div>
    </StaggerCtx.Provider>
  );
}

export function StaggerItem({ children, ...rest }: { children: ReactNode } & Omit<HTMLMotionProps<"div">, "children">) {
  const ctx = useContext(StaggerCtx);
  const [i] = useState(() => (ctx ? ctx.next() : 0));
  const wait = ctx ? ctx.delay + Math.min(i, 8) * ctx.gap : 0;
  return (
    <motion.div variants={fadeUp} initial="hidden" animate="show" transition={{ delay: wait }} {...rest}>
      {children}
    </motion.div>
  );
}
