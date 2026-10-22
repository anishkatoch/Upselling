import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "./ui.css";

const WIDTH = 260; // max width of the tip, also used to keep it inside the window
const GAP = 8;
const EST_HEIGHT = 110; // rough height, to decide whether it fits below

/**
 * A small "i" that shows a plain-English explanation on hover or keyboard focus.
 * The tip is drawn on the page itself (a portal, positioned on screen), so no card, table or scrolling area it sits
 * in can cut it off.
 */
export default function InfoTip({ children, label = "What does this mean?" }: { children: ReactNode; label?: string }) {
  const btn = useRef<HTMLButtonElement>(null);
  const id = useId();
  const [pos, setPos] = useState<{ top: number; left: number; above: boolean } | null>(null);

  const show = () => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.min(Math.max(GAP, r.left + r.width / 2 - WIDTH / 2), window.innerWidth - WIDTH - GAP);
    const above = r.bottom + GAP + EST_HEIGHT > window.innerHeight && r.top > EST_HEIGHT;
    setPos({ top: above ? r.top - GAP : r.bottom + GAP, left, above });
  };
  const hide = () => setPos(null);

  useEffect(() => {
    if (!pos) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && hide();
    window.addEventListener("scroll", show, true); // the button moves when the page scrolls (also when focus scrolls it into view): follow it
    window.addEventListener("resize", show);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", show, true);
      window.removeEventListener("resize", show);
      window.removeEventListener("keydown", onKey);
    };
  }, [pos]);

  return (
    <span className="infotip" onMouseEnter={show} onMouseLeave={hide}>
      <button ref={btn} type="button" aria-label={label} aria-describedby={pos ? id : undefined} onFocus={show} onBlur={hide}>
        i
      </button>
      {pos &&
        createPortal(
          <span id={id} className={`infotip-pop${pos.above ? " above" : ""}`} role="tooltip" style={{ top: pos.top, left: pos.left }}>
            {children}
          </span>,
          document.body,
        )}
    </span>
  );
}
