import type { ReactNode } from "react";
import "./ui.css";

/** A small "i" that shows a plain-English explanation on hover or keyboard focus. */
export default function InfoTip({ children, label = "What does this mean?" }: { children: ReactNode; label?: string }) {
  return (
    <span className="infotip">
      <button type="button" aria-label={label}>
        i
      </button>
      <span className="infotip-pop" role="tooltip">
        {children}
      </span>
    </span>
  );
}
