import { AlertTriangle, Check, Sparkle } from "../../icons/Icons";
import "./findings.css";

type Parts = { lead: string; figure?: string; advice?: string };

/** The backend writes one sentence per finding; show its claim, the number behind it and any advice separately. */
function parts(text: string): Parts {
  const accepts = text.match(/^Customers accept (\d+%) of the offers that get an answer\.?$/); // the number belongs on the right
  if (accepts) return { lead: "Customers say yes to the offers that get an answer", figure: accepts[1] };
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
  empty: { title: string; text: string };
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
                <span className="f-mark" aria-hidden="true">
                  {tone === "good" ? <Check size={11} /> : <AlertTriangle size={11} />}
                </span>
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
        <div className="f-empty">
          <span className="f-empty-ico" aria-hidden="true">
            {tone === "good" ? <Sparkle size={20} /> : <Check size={22} />}
          </span>
          <strong>{empty.title}</strong>
          <span>{empty.text}</span>
        </div>
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
      <Card
        tone="good"
        title="Doing well"
        items={strengths}
        empty={{ title: "Nothing stands out yet", text: "Strengths show once there are enough conversations." }}
      />
      <Card
        tone="warn"
        title="To work on"
        items={improvements}
        empty={{ title: "Nothing urgent", text: "No weak spots in this period." }}
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
