import { AlertTriangle, Check } from "../../icons/Icons";
import "./findings.css";

type Parts = { lead: string; figure?: string; advice?: string };

/** The backend writes one sentence per finding; show its claim, the number behind it and any advice separately. */
function parts(text: string): Parts {
  const withFigure = text.match(/^(.*?)\s*\(([^)]*)\)\.?$/); // "Greets customers consistently (100% of conversations)."
  if (withFigure) return { lead: withFigure[1], figure: withFigure[2] };
  const [lead, ...rest] = text.split(" - "); // "2 questions went unanswered - answer every question first."
  const clean = (s: string) => s.trim().replace(/\.$/, "");
  return { lead: clean(lead), advice: rest.length ? clean(rest.join(" - ")) : undefined };
}

function Card({
  tone,
  title,
  items,
  empty,
  extra,
}: {
  tone: "good" | "warn";
  title: string;
  items: string[];
  empty: string;
  extra?: React.ReactNode;
}) {
  return (
    <section className={`finding-card ${tone === "good" ? "is-good" : "is-todo"}`}>
      <header>
        <span className="f-ico" aria-hidden="true">
          {tone === "good" ? <Check size={14} /> : <AlertTriangle size={14} />}
        </span>
        <h3>{title}</h3>
      </header>
      {items.length ? (
        <ul className="f-list">
          {items.map((s) => {
            const p = parts(s);
            return (
              <li key={s}>
                <span className="f-mark" aria-hidden="true" />
                <div className="f-text">
                  <div className="f-lead">{p.lead}</div>
                  {p.advice && <div className="f-advice">{p.advice}</div>}
                </div>
                {p.figure && <span className="f-fig">{p.figure}</span>}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="f-empty">{empty}</p>
      )}
      {extra}
    </section>
  );
}

/** "Doing well" and "To work on" side by side, every finding visible, optional upselling ideas last. */
export default function Findings({
  strengths,
  improvements,
  upsellTips,
}: {
  strengths: string[];
  improvements: string[];
  upsellTips: string[];
}) {
  return (
    <div className="findings">
      <Card tone="good" title="Doing well" items={strengths} empty="Nothing stands out yet." />
      <Card
        tone="warn"
        title="To work on"
        items={improvements}
        empty="Nothing urgent. No weak spots in this period."
        extra={
          upsellTips.length > 0 && (
            <div className="f-tips">
              <h4>Upselling (optional)</h4>
              <ul>
                {upsellTips.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          )
        }
      />
    </div>
  );
}
