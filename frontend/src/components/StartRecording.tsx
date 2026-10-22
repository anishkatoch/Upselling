import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { Mic } from "../icons/Icons";
import "./recorder.css";

type Phase = "idle" | "recording" | "saving";
const MIN_SECONDS = 3;

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

/** "Start recording" button for the top bar, plus the small recorder it opens: microphone in, analysed recording out. */
export default function StartRecording() {
  const nav = useNavigate();
  const dlg = useRef<HTMLDialogElement>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const discard = useRef(false);
  const seconds = useRef(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [secs, setSecs] = useState(0);
  const [who, setWho] = useState("");
  const [names, setNames] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const supported = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";

  useEffect(() => {
    if (phase !== "recording") return;
    const t = setInterval(() => {
      seconds.current += 1;
      setSecs(seconds.current);
    }, 1000);
    return () => clearInterval(t);
  }, [phase]);

  useEffect(
    () => () => {
      stream.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  const release = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };

  const open = () => {
    setError(null);
    seconds.current = 0;
    setSecs(0);
    setPhase("idle");
    api
      .roster()
      .then((r) => setNames(r.map((x) => x.name)))
      .catch(() => setNames([]));
    dlg.current?.showModal();
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
    setError(null);
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("We couldn't use the microphone. Allow microphone access for this site in your browser, then try again.");
      return;
    }
    const { mime } = pickType();
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
  };

  const stop = () => {
    if (rec.current?.state === "recording") rec.current.stop();
  };

  const cancel = () => {
    discard.current = true;
    if (rec.current?.state === "recording") rec.current.stop();
    release();
    setPhase("idle");
    close();
  };

  return (
    <>
      <button type="button" className="rec-btn" onClick={open}>
        <span className="rec-dot" aria-hidden="true" />
        <span className="rec-btn-text">Start recording</span>
      </button>

      <dialog
        ref={dlg}
        className="rec-dialog"
        aria-labelledby="rec-title"
        onCancel={(e) => {
          if (phase !== "idle") e.preventDefault(); // Esc must not throw away a recording in progress
        }}
      >
        <div className="rec-head">
          <h2 id="rec-title">{phase === "recording" ? "Recording…" : phase === "saving" ? "Saving your recording…" : "Start a recording"}</h2>
          {phase === "idle" && (
            <button type="button" className="rec-x" onClick={close} aria-label="Close">
              ×
            </button>
          )}
        </div>

        {phase === "idle" && (
          <>
            <p className="rec-lead">Record a conversation with the microphone. When you stop, we analyse it and add it to Conversations.</p>
            <label className="rec-field">
              <span>Salesperson (optional)</span>
              <input
                list="rec-people"
                value={who}
                onChange={(e) => setWho(e.target.value)}
                placeholder="Choose or type a name"
                maxLength={80}
                autoComplete="off"
              />
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
              <button type="button" className="rec-go" onClick={start} disabled={!supported}>
                <Mic size={15} /> Start recording
              </button>
            </div>
          </>
        )}

        {phase === "recording" && (
          <>
            <div className="rec-live" role="status" aria-live="polite">
              <span className="rec-pulse" aria-hidden="true" />
              <span className="rec-time">{clock(secs)}</span>
            </div>
            <p className="rec-lead">Keep this window open while the conversation happens. Press stop when it ends.</p>
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
