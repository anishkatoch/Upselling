import { forwardRef, useEffect, useRef, useState } from "react";
import { Pause, Play } from "../icons/Icons";
import { clock } from "../lib/format";

/** A fully custom player - no native browser widget is ever shown. */
const AudioPlayer = forwardRef<HTMLAudioElement, { src: string }>(({ src }, ref) => {
  const el = useRef<HTMLAudioElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [ready, setReady] = useState(false);
  const [drag, setDrag] = useState<number | null>(null);

  useEffect(() => {
    const a = el.current;
    if (!a) return;
    const onTime = () => setTime(a.currentTime);
    const onMeta = () => {
      setDuration(a.duration || 0);
      setReady(true);
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnd = () => setPlaying(false);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onMeta);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("ended", onEnd);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onMeta);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("ended", onEnd);
    };
  }, []);

  const setRefs = (node: HTMLAudioElement | null) => {
    el.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) (ref as React.MutableRefObject<HTMLAudioElement | null>).current = node;
  };

  const toggle = () => {
    const a = el.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => {});
    else a.pause();
  };

  const ratioFromEvent = (e: { clientX: number }) => {
    const r = bar.current?.getBoundingClientRect();
    if (!r) return 0;
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  };

  const seekTo = (ratio: number) => {
    const a = el.current;
    if (!a || !duration) return;
    a.currentTime = ratio * duration;
    setTime(a.currentTime);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    const r = ratioFromEvent(e);
    setDrag(r);
    seekTo(r);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (drag === null) return;
    const r = ratioFromEvent(e);
    setDrag(r);
  };
  const onPointerUp = () => {
    if (drag !== null) seekTo(drag);
    setDrag(null);
  };

  const shown = drag ?? (duration ? time / duration : 0);

  return (
    <div className="player">
      <audio ref={setRefs} src={src} preload="metadata" />
      <button className="player-btn" onClick={toggle} disabled={!ready} aria-label={playing ? "Pause" : "Play"}>
        {playing ? <Pause size={18} /> : <Play size={18} />}
      </button>
      <span className="player-time">{clock(drag !== null ? drag * duration : time)}</span>
      <div
        className="player-track"
        ref={bar}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <div className="player-fill" style={{ width: `${shown * 100}%` }} />
        <div className="player-knob" style={{ left: `${shown * 100}%` }} />
      </div>
      <span className="player-time">{duration ? clock(duration) : "--:--"}</span>
    </div>
  );
});
AudioPlayer.displayName = "AudioPlayer";
export default AudioPlayer;
