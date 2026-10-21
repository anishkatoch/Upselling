/** Shared motion tokens: short, calm easings. Reduced-motion users get no movement (see MotionConfig in main.tsx). */
export const EASE = [0.22, 1, 0.36, 1] as const; // smooth "ease-out-expo"-ish
export const DUR = { fast: 0.15, base: 0.35, slow: 0.6 } as const;

export const fadeUp = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: DUR.base, ease: EASE } },
};

export const stagger = (gap = 0.06, delay = 0) => ({
  hidden: {},
  show: { transition: { staggerChildren: gap, delayChildren: delay } },
});

export const pageVariants = {
  initial: { opacity: 0, y: 8 },
  enter: { opacity: 1, y: 0, transition: { duration: DUR.base, ease: EASE } },
  exit: { opacity: 0, transition: { duration: DUR.fast } },
};
