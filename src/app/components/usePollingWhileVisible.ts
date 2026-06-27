import { useEffect } from "react";

/**
 * Run `fn` once on mount, then on an interval — but only while the tab is
 * visible. When the tab is hidden the interval is cleared (no background
 * polling); when it becomes visible again `fn` runs immediately and the
 * interval resumes. Keeps a polled dashboard from hammering the backend (and
 * Firestore) while nobody is looking.
 *
 * `fn` should be stable (e.g. a useCallback) to avoid re-subscribing each render.
 */
export function usePollingWhileVisible(
  fn: () => void,
  intervalMs: number
): void {
  useEffect(() => {
    fn();
    let id: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      if (id == null) id = setInterval(fn, intervalMs);
    };
    const stop = () => {
      if (id != null) {
        clearInterval(id);
        id = undefined;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        fn();
        start();
      } else {
        stop();
      }
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [fn, intervalMs]);
}
