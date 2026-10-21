import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "../../icons/Icons";
import type { RecentCall } from "../../lib/api";
import { RESULT, SENTIMENT } from "../../lib/format";

const SHOWN = 5;

const dateLabel = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};

const sentence = (s: string) => {
  const t = (s ?? "").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "Customer conversation";
};

/**
 * A person's most recent customer conversations: topic, how it went, the upsell outcome. Each row
 * opens the call (deep-linked to that conversation) - the path from a person's numbers to the
 * proof.
 */
export default function RecentConversations({ calls }: { calls: RecentCall[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? calls : calls.slice(0, SHOWN);

  return (
    <div>
      <h3 className="section-title">Recent conversations</h3>
      <p className="sub small recent-hint">Open one to read the conversation and see what the figures above are based on.</p>

      {calls.length === 0 ? (
        <p className="sub small">No conversations to show for this period yet.</p>
      ) : (
        <>
          <ul className="recent-list" aria-label="Recent conversations">
            {shown.map((c, i) => {
              const s = SENTIMENT[c.sentiment] ?? SENTIMENT.neutral;
              const res = RESULT[c.upsell_result] ?? RESULT.unknown;
              const body = (
                <>
                  <span className="recent-date">{dateLabel(c.when)}</span>
                  <span className="recent-topic">{sentence(c.topic)}</span>
                  <span className="recent-pills">
                    <span className={`pill ${s.tone}`}>{s.label}</span>
                    <span className={`pill ${res.tone}`}>{res.label}</span>
                  </span>
                  <span className="recent-offers sub small">
                    offered {c.tried} · said yes {c.accepted}
                  </span>
                  <ChevronRight size={15} className="icon-muted recent-go" />
                </>
              );
              return (
                <li key={`${c.job_id}-${c.conversation_id}-${i}`} className={i >= SHOWN ? "reveal" : undefined}>
                  <Link className="recent-row" to={`/recordings/${c.job_id}?tab=conversations&conv=${c.conversation_id}`}>
                    {body}
                  </Link>
                </li>
              );
            })}
          </ul>
          {calls.length > SHOWN && (
            <button className="btn ghost small" style={{ marginTop: 10 }} onClick={() => setAll((v) => !v)}>
              {all ? "Show fewer" : `Show all ${calls.length}`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
