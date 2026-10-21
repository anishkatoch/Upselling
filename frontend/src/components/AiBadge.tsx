import { Sparkle } from "../icons/Icons";

/** Small "AI" pill for AI-written content. Usage: <AiBadge /> or <AiBadge label="AI summary" />. */
export default function AiBadge({ label = "AI", title = "Written by AI" }: { label?: string; title?: string }) {
  return (
    <span className="ai-badge" title={title}>
      <Sparkle size={10} />
      {label}
    </span>
  );
}
