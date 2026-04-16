import { useEffect, useRef } from 'react';

export function usePolling<T>(
  getKey: () => T | null,
  callback: (key: T) => Promise<void>,
  intervalMs: number,
) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  const getKeyRef = useRef(getKey);
  getKeyRef.current = getKey;

  useEffect(() => {
    const key = getKeyRef.current();
    if (key === null) return;

    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      try {
        await callbackRef.current(key);
      } catch {
        // ignore polling errors
      }
    };

    const id = window.setInterval(tick, intervalMs);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [getKey, intervalMs]);
}
