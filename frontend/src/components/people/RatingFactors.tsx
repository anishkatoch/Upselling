import type { RatingFactor } from "../../lib/api";
import "./rating-factors.css";

const WORD: Record<RatingFactor["status"], string> = { good: "Strong", fair: "Fair", weak: "Needs work", none: "Not enough to judge" };

/**
 * What the rating looks at, one cell per thing: how it went, in words, with the count behind it.
 * Deliberately no points, weights or cut-offs: it explains the rating without publishing the formula.
 */
export default function RatingFactors({ factors }: { factors: RatingFactor[] }) {
  if (!factors.length) return null;
  return (
    <section className="flat-card factors-card" aria-label="What shaped this rating">
      <div className="card-head">
        <h3>What shaped this rating</h3>
      </div>
      <ul className="factors">
        {factors.map((f) => (
          <li key={f.key} className={`factor is-${f.status}`}>
            <div className="factor-top">
              <span className="factor-dot" aria-hidden="true" />
              <span className="factor-label">{f.label}</span>
              <span className="factor-word">{WORD[f.status]}</span>
            </div>
            <p className="factor-detail">{f.detail}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
