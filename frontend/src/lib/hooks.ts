import { useCallback, useLayoutEffect, useRef, useState } from "react";

/** Load something, and optionally reload every `every` ms while `keep(data)` is true. */
export function useLoad<T>(
  fn: () => Promise<T>,
  deps: unknown[],
  opts?: { every?: number; keep?: (d: T) => boolean },
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const keepRef = useRef(opts?.keep);
  keepRef.current = opts?.keep;
  const every = opts?.every;
  // Bumped whenever `deps` changes, so a response from a previous (now-stale) set of deps -
  // e.g. the old period/id, still in flight when the user moved on to a new one - never
  // overwrites what's current, no matter which request resolves last.
  const gen = useRef(0);

  const load = useCallback(async (g: number) => {
    try {
      const d = await fnRef.current();
      if (g !== gen.current) return null;
      setData(d);
      setError(null);
      return d;
    } catch (e) {
      if (g !== gen.current) return null;
      setError(e instanceof Error ? e.message : "Something went wrong");
      return null;
    }
  }, []);

  // Layout effect (not a plain effect) so the reset below lands before the browser paints -
  // otherwise the previous deps' data would flash on screen for one frame under the new deps.
  useLayoutEffect(() => {
    gen.current += 1;
    const g = gen.current;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    setData(null);
    setError(null);
    const tick = async () => {
      const d = await load(g);
      if (stop || !every || g !== gen.current) return;
      if (d === null || keepRef.current?.(d)) timer = setTimeout(tick, every);
    };
    tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, reload: () => load(gen.current) };
}
