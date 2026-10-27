import { motion } from "framer-motion";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "../../icons/Icons";
import type { RecentCall } from "../../lib/api";
import { DUR, EASE } from "../../lib/motion";
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
export default function RecentConversations({ calls, period }: { calls: RecentCall[]; period?: string }) {
  const [all, setAll] = useState(false);
  const [earlier, setEarlier] = useState(false);
  // The conversations behind the figures above (the selected period) come first; older ones sit behind a button.
  const inPeriod = period ? calls.filter((c) => c.period === period) : calls;
  const before = period ? calls.filter((c) => c.period !== period) : [];
  const base = inPeriod.length || !before.length ? inPeriod : before; // nothing in the period: show what there is
  const rows = earlier ? [...base, ...(base === inPeriod ? before : [])] : base;
  const shown = all ? rows : rows.slice(0, SHOWN);

  return (
    <div>
      <h3 className="section-title">Recent conversations</h3>
      <p className="sub small recent-hint">
        {inPeriod.length
          ? `The ${inPeriod.length} conversation${inPeriod.length === 1 ? "" : "s"} the figures above are based on. Open one to read it.`
          : "Open one to read the conversation."}
      </p>

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
                <motion.li
                  key={`${c.job_id}-${c.conversation_id}-${i}`}
                  className={i >= SHOWN ? "reveal" : undefined}
                  initial={{ opacity: 0, y: 6 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: DUR.base, ease: EASE, delay: Math.min(i, SHOWN) * 0.03 }}
                >
                  <Link className="recent-row" to={`/recordings/${c.job_id}?tab=conversations&conv=${c.conversation_id}`}>
                    {body}
                  </Link>
                </motion.li>
              );
            })}
          </ul>
          <div className="recent-more">
            {rows.length > SHOWN && (
              <button className="btn ghost small" onClick={() => setAll((v) => !v)}>
                {all ? "Show fewer" : `Show all ${rows.length}`}
              </button>
            )}
            {base === inPeriod && before.length > 0 && (
              <button className="btn ghost small" onClick={() => setEarlier((v) => !v)}>
                {earlier ? "Hide earlier conversations" : `Show ${before.length} earlier conversation${before.length === 1 ? "" : "s"}`}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
