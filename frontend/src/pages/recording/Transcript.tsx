import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "../../icons/Icons";
import { clock } from "../../lib/format";
import { Spk, type RecCtx } from "./shared";

export default function TranscriptTab({ ctx, scrollTo, onScrolled }: { ctx: RecCtx; scrollTo: number | null; onScrolled: () => void }) {
  const { report: r, segments, who, seek } = ctx;
  const convs = r.conversations;
  const [convId, setConvId] = useState("");
  const [kind, setKind] = useState("");
  const [q, setQ] = useState("");
  const refs = useRef<Record<number, HTMLDivElement | null>>({});
  const [copied, setCopied] = useState(false);

  const upsellSegs = useMemo(() => {
    const m = new Map<number, string>();
    convs.forEach((c) => c.upsell?.upsell_attempts.forEach((a) => m.set(a.segment_id, a.technique)));
    return m;
  }, [convs]);
  const frustSegs = useMemo(() => {
    const s = new Set<number>();
    convs.forEach((c) => c.mood?.frustration_moments.forEach((m) => s.add(m.segment_id)));
    return s;
  }, [convs]);

  // Exact containment first; only fall back to a small tolerance for float-rounding at a true
  // boundary - otherwise two back-to-back conversations with almost no gap would both match a
  // line right at the seam, and `.find()` would silently attribute it to the earlier one.
  const convOf = (start: number) =>
    convs.find((c) => start >= c.start && start <= c.end) ??
    convs.find((c) => start >= c.start - 0.01 && start <= c.end + 0.01);

  const rows = useMemo(() => {
    let lastConv: number | null = null;
    const list: ({ type: "break"; conv: (typeof convs)[number] } | { type: "line"; seg: (typeof segments)[number] })[] = [];
    for (const s of segments) {
      const conv = convOf(s.start);
      if (convId && String(conv?.conversation_id) !== convId) continue;
      const isUp = upsellSegs.has(s.id);
      const isFr = frustSegs.has(s.id);
      if (kind === "upsell" && !isUp) continue;
      if (kind === "frustrated" && !isFr) continue;
      if (q.trim() && !s.text.toLowerCase().includes(q.trim().toLowerCase())) continue;
      if (!convId && conv && conv.conversation_id !== lastConv) {
        list.push({ type: "break", conv });
        lastConv = conv.conversation_id;
      }
      list.push({ type: "line", seg: s });
    }
    return list;
  }, [segments, convId, kind, q, upsellSegs, frustSegs]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (scrollTo == null) return;
    const el = refs.current[scrollTo];
    if (el) {
      el.scrollIntoView({ block: "center" });
      el.classList.add("flash");
      setTimeout(() => el.classList.remove("flash"), 1600);
    }
    onScrolled();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollTo]);

  function transcriptText() {
    let last: number | null = null;
    const out: string[] = [];
    for (const s of segments) {
      const c = convOf(s.start);
      if (c && c.conversation_id !== last) {
        out.push(`\n=== #${c.conversation_id} ${c.topic} ===`);
        last = c.conversation_id;
      }
      out.push(`[${clock(s.start)}] ${s.speaker} (${r.speakers.find((x) => x.speaker === s.speaker)?.role ?? "?"}): ${s.text}`);
    }
    return out.join("\n").trim() + "\n";
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(transcriptText());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  function download() {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([transcriptText()], { type: "text/plain;charset=utf-8" }));
    a.download = `${r.source_filename.replace(/\.[^.]+$/, "")}-transcript.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if (segments.length === 0) return <div className="card empty">Transcript not available.</div>;

  return (
    <div className="card">
      <div className="row">
        <select className="sel" value={convId} onChange={(e) => setConvId(e.target.value)}>
          <option value="">All conversations</option>
          {convs.map((c) => (
            <option key={c.conversation_id} value={c.conversation_id}>
              #{c.conversation_id} {c.topic}
            </option>
          ))}
        </select>
        <select className="sel" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">All lines</option>
          <option value="upsell">Upsell attempts</option>
          <option value="frustrated">Frustration</option>
        </select>
        <div className="row grow" style={{ position: "relative", minWidth: 180 }}>
          <Search size={15} className="icon-muted" style={{ position: "absolute", left: 11 }} />
          <input
            placeholder="Search words…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ width: "100%", font: "inherit", fontSize: 14, padding: "9px 12px 9px 34px", border: "1px solid var(--line)", borderRadius: 9 }}
          />
        </div>
        <button className="btn ghost" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
        <button className="btn ghost" onClick={download}>
          Download .txt
        </button>
      </div>
      <p className="sub small" style={{ margin: "12px 0 2px" }}>
        {segments.length} lines · {convs.length} conversation{convs.length === 1 ? "" : "s"} · {r.speakers.length} speakers
      </p>
      <p className="sub small" style={{ marginBottom: 10 }}>
        <span className="pill info">blue</span> upsell attempt · <span className="pill bad">red</span> frustration · click a time to play
      </p>

      {rows.length === 0 && <p className="sub">No matching lines.</p>}
      {rows.map((row, i) =>
        row.type === "break" ? (
          <div key={`b${i}`} className="eyebrow" style={{ marginTop: 18 }}>
            #{row.conv.conversation_id} {row.conv.topic}
          </div>
        ) : (
          <div
            key={row.seg.id}
            ref={(el) => {
              refs.current[row.seg.id] = el;
            }}
            className={`line ${upsellSegs.has(row.seg.id) ? "hl" : frustSegs.has(row.seg.id) ? "hl-bad" : ""}`}
          >
            <button className="t" onClick={() => seek(row.seg.start)} title="Play from here">
              {clock(row.seg.start)}
            </button>
            <div>
              <div className="who">
                <Spk speaker={row.seg.speaker} report={r} who={who} />
                <span className="sub small"> {r.speakers.find((x) => x.speaker === row.seg.speaker)?.role}</span>{" "}
                {upsellSegs.has(row.seg.id) && <span className="pill info">{upsellSegs.get(row.seg.id)?.replace(/_/g, " ")}</span>}
                {frustSegs.has(row.seg.id) && <span className="pill bad">frustrated</span>}
              </div>
              <div>{row.seg.text}</div>
            </div>
          </div>
        ),
      )}
    </div>
  );
}
