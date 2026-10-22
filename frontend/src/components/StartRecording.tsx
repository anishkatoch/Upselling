import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { Mic } from "../icons/Icons";
import "./recorder.css";

type Phase = "idle" | "recording" | "saving";
interface Line {
  t: number; // seconds into the recording when this piece started
  text: string;
}

const MIN_SECONDS = 3;
const LIVE_SECONDS = 6; // how much speech goes into each piece of the live preview
const QUIET = 0.015; // pieces quieter than this are skipped, so silence never becomes made-up words
const PAUSE_AFTER_FAILURES = 3;

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function pickType(): { mime: string; ext: string } {
  for (const [mime, ext] of [
    ["audio/webm;codecs=opus", "webm"],
    ["audio/webm", "webm"],
    ["audio/mp4", "m4a"],
  ] as const) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mime)) return { mime, ext };
  }
  return { mime: "", ext: "webm" };
}

/**
 * "Start recording" button for the top bar, plus the popup it opens: choose the salesperson, record from the
 * microphone, watch the words appear live, then stop to save and analyse. The live text is only a preview
 * (no speaker labels); the saved recording gets the full analysis afterwards.
 */
export default function StartRecording() {
  const nav = useNavigate();
  const dlg = useRef<HTMLDialogElement>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const discard = useRef(false);
  const seconds = useRef(0);
  // live preview
  const liveOn = useRef(false);
  const liveRec = useRef<MediaRecorder | null>(null);
  const liveTimer = useRef<number | null>(null);
  const meterTimer = useRef<number | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const peak = useRef(0);
  const failures = useRef(0);
  const spoken = useRef("");
  const queue = useRef<Promise<void>>(Promise.resolve());
  const box = useRef<HTMLDivElement>(null);
  const nameBox = useRef<HTMLInputElement>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [secs, setSecs] = useState(0);
  const [who, setWho] = useState("");
  const [names, setNames] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const supported = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";

  useEffect(() => {
    if (phase !== "recording") return;
    const t = setInterval(() => {
      seconds.current += 1;
      setSecs(seconds.current);
    }, 1000);
    return () => clearInterval(t);
  }, [phase]);

  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight, behavior: "smooth" });
  }, [lines]);

  const stopLive = () => {
    liveOn.current = false;
    if (liveTimer.current) window.clearTimeout(liveTimer.current);
    if (meterTimer.current) window.clearInterval(meterTimer.current);
    liveTimer.current = meterTimer.current = null;
    if (liveRec.current && liveRec.current.state === "recording") liveRec.current.stop();
    liveRec.current = null;
    void audioCtx.current?.close().catch(() => undefined);
    audioCtx.current = null;
  };

  const release = () => {
    stopLive();
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };

  useEffect(() => release, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Cut the microphone into short standalone clips, send each for text, and add the words to the popup. */
  const startLive = (s: MediaStream, mime: string, ext: string) => {
    liveOn.current = true;
    failures.current = 0;
    spoken.current = "";
    peak.current = 0;
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AC();
      audioCtx.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(s).connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      meterTimer.current = window.setInterval(() => {
        analyser.getByteTimeDomainData(buf);
        let p = 0;
        for (const v of buf) p = Math.max(p, Math.abs(v - 128) / 128);
        peak.current = Math.max(peak.current, p);
      }, 150);
    } catch {
      peak.current = 1; // no level meter available: send every piece
    }

    const send = (clip: Blob, startedAt: number, loudest: number) => {
      if (loudest < QUIET || clip.size < 1000) return; // silence
      queue.current = queue.current.then(async () => {
        if (!liveOn.current) return;
        try {
          const { text } = await api.liveTranscribe(clip, `clip.${ext}`, spoken.current.slice(-200));
          failures.current = 0;
          setNote(null);
          const clean = text.trim();
          if (clean) {
            spoken.current += ` ${clean}`;
            if (liveOn.current) setLines((l) => [...l, { t: startedAt, text: clean }]);
          }
        } catch {
          failures.current += 1;
          if (failures.current >= PAUSE_AFTER_FAILURES) setNote("Live text is paused. Your recording is still being saved.");
        }
      });
    };

    const cycle = () => {
      if (!liveOn.current || !stream.current) return;
      const r = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
      const parts: Blob[] = [];
      const startedAt = seconds.current;
      const level = () => peak.current;
      peak.current = 0;
      liveRec.current = r;
      r.ondataavailable = (e) => {
        if (e.data.size > 0) parts.push(e.data);
      };
      r.onstop = () => {
        const loudest = level();
        if (!liveOn.current) return; // recording ended: the preview piece is dropped
        cycle(); // start the next piece straight away so little speech falls in the gap
        send(new Blob(parts, { type: r.mimeType || mime || "audio/webm" }), startedAt, loudest);
      };
      r.start();
      liveTimer.current = window.setTimeout(() => r.state === "recording" && r.stop(), LIVE_SECONDS * 1000);
    };
    cycle();
  };

  const open = () => {
    setError(null);
    setNote(null);
    setLines([]);
    seconds.current = 0;
    setSecs(0);
    setPhase("idle");
    api
      .roster()
      .then((r) => setNames(r.map((x) => x.name)))
      .catch(() => setNames([]));
    dlg.current?.showModal();
    requestAnimationFrame(() => nameBox.current?.focus()); // start typing the salesperson straight away
  };

  const close = () => dlg.current?.close();

  const finish = async (mime: string) => {
    release();
    if (discard.current) return;
    const { ext } = pickType();
    const blob = new Blob(chunks.current, { type: mime || "audio/webm" });
    if (seconds.current < MIN_SECONDS) {
      setPhase("idle");
      setError("That was too short to analyse. Record at least a few seconds of the conversation.");
      return;
    }
    setPhase("saving");
    try {
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
      const job = await api.upload(blob, `recording-${stamp}.${ext}`, who);
      close();
      nav(`/recordings/${job.job_id}`);
    } catch (e) {
      setPhase("idle");
      setError(e instanceof Error ? e.message : "We couldn't save the recording. Please try again.");
    }
  };

  const start = async () => {
    if (!who.trim()) {
      setError("Choose who is being recorded, so the recording counts toward their results.");
      return;
    }
    setError(null);
    setNote(null);
    setLines([]);
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("We couldn't use the microphone. Allow microphone access for this site in your browser, then try again.");
      return;
    }
    const { mime, ext } = pickType();
    const r = new MediaRecorder(stream.current, mime ? { mimeType: mime } : undefined);
    chunks.current = [];
    discard.current = false;
    r.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.current.push(e.data);
    };
    r.onstop = () => void finish(r.mimeType || mime);
    rec.current = r;
    r.start(1000);
    seconds.current = 0;
    setSecs(0);
    setPhase("recording");
    startLive(stream.current, mime, ext);
  };

  const stop = () => {
    stopLive();
    if (rec.current?.state === "recording") rec.current.stop();
  };

  const cancel = () => {
    discard.current = true;
    stopLive();
    if (rec.current?.state === "recording") rec.current.stop();
    release();
    setPhase("idle");
    close();
  };

  const recording = phase === "recording";

  return (
    <>
      <button type="button" className="rec-btn" onClick={open}>
        <span className="rec-dot" aria-hidden="true" />
        <span className="rec-btn-text">Start recording</span>
      </button>

      <dialog
        ref={dlg}
        className={`rec-dialog${recording ? " live" : ""}`}
        aria-labelledby="rec-title"
        onCancel={(e) => {
          if (phase !== "idle") e.preventDefault(); // Esc must not throw away a recording in progress
        }}
      >
        <div className="rec-head">
          <h2 id="rec-title">{recording ? "Recording" : phase === "saving" ? "Saving your recording…" : "Start a recording"}</h2>
          {recording && (
            <div className="rec-clock" role="status" aria-live="off">
              <span className="rec-pulse" aria-hidden="true" />
              <span className="rec-time">{clock(secs)}</span>
            </div>
          )}
          {phase === "idle" && (
            <button type="button" className="rec-x" onClick={close} aria-label="Close">
              ×
            </button>
          )}
        </div>

        {phase === "idle" && (
          <>
            <p className="rec-lead">Record a conversation with the microphone and watch the words appear as people speak. When you stop, we analyse it and add it to Conversations.</p>
            <label className="rec-field">
              <span>
                Salesperson <em className="rec-req">required</em>
              </span>
              <input
                list="rec-people"
                value={who}
                onChange={(e) => setWho(e.target.value)}
                placeholder="Choose or type a name"
                maxLength={80}
                autoComplete="off"
                required
                aria-required="true"
                ref={nameBox}
              />
              <small className="rec-help">Pick a name from the list, or type a new one.</small>
              <datalist id="rec-people">
                {names.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            </label>
            {!supported && <p className="rec-error">This browser can&apos;t record audio. Try a recent Chrome, Edge or Safari.</p>}
            {error && (
              <p className="rec-error" role="alert">
                {error}
              </p>
            )}
            <div className="rec-actions">
              <button type="button" className="btn ghost" onClick={close}>
                Not now
              </button>
              <button type="button" className="rec-go" onClick={start} disabled={!supported || !who.trim()}>
                <Mic size={15} /> Start recording
              </button>
            </div>
          </>
        )}

        {recording && (
          <>
            {who.trim() && <p className="rec-who">Salesperson: {who.trim()}</p>}
            <div className="rec-box" ref={box} aria-live="polite" aria-label="Live transcript">
              {lines.length === 0 ? (
                <p className="rec-empty">Listening… the words will appear here a few seconds after they are spoken.</p>
              ) : (
                lines.map((l, i) => (
                  <div className="rec-line" key={i}>
                    <span className="rec-ts">{clock(l.t)}</span>
                    <p className="rec-bubble">{l.text}</p>
                  </div>
                ))
              )}
            </div>
            <p className="rec-hint">{note ?? "A live preview. Who said what is worked out after you stop."}</p>
            <div className="rec-actions">
              <button type="button" className="btn ghost" onClick={cancel}>
                Discard
              </button>
              <button type="button" className="rec-go stop" onClick={stop}>
                Stop and analyse
              </button>
            </div>
          </>
        )}

        {phase === "saving" && <p className="rec-lead">Uploading. You&apos;ll be taken to the conversation, where you can follow the analysis.</p>}
      </dialog>
    </>
  );
}
