import { useEffect, type EffectCallback } from "react";

/**
 * The only sanctioned effect in this codebase: run once on mount (and clean up on unmount).
 * Use it solely to sync with an external system (WebSocket, matchMedia, key listeners,
 * service worker). Reset on id change by giving the component a `key` instead.
 */
export function useMountEffect(fn: EffectCallback) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(fn, []);
}
