import { useEffect, useState } from 'react';

/**
 * Returns a `Date.now()` value that refreshes every `intervalMs`.
 * Pass `null` to freeze the clock so no timer is registered.
 */
export function useNow(intervalMs: number | null): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (intervalMs === null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
