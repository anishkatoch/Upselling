import { useId } from "react";

/**
 * The SouqCue mark: a speech bubble (the conversation) holding three rising bars (what we learn from it),
 * on the indigo gradient. Same drawing as public/favicon.svg.
 */
export function Logo({ size = 26 }: { size?: number }) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false" style={{ flex: "none" }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5b5bf0" />
          <stop offset="1" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill={`url(#${id})`} />
      <path
        d="M7 9.5A2.5 2.5 0 0 1 9.5 7h13A2.5 2.5 0 0 1 25 9.5v9a2.5 2.5 0 0 1-2.5 2.5H16l-4.7 3.9a.6.6 0 0 1-1-.46V21H9.5A2.5 2.5 0 0 1 7 18.5z"
        fill="#fff"
      />
      <rect x="11" y="15" width="2.6" height="3.5" rx="1.1" fill="#5b5bf0" />
      <rect x="14.7" y="12.4" width="2.6" height="6.1" rx="1.1" fill="#6f5cf2" />
      <rect x="18.4" y="9.8" width="2.6" height="8.7" rx="1.1" fill="#8b5cf6" />
    </svg>
  );
}

/** Mark plus the name, with "Souq" and "Cue" in two colours. */
export default function Brand({ size = 26, text = true }: { size?: number; text?: boolean }) {
  return (
    <>
      <Logo size={size} />
      {text && (
        <span className="brand-text">
          <span className="brand-souq">Souq</span><b className="brand-cue">Cue</b>
        </span>
      )}
    </>
  );
}
