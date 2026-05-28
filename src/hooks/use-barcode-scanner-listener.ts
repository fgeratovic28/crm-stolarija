import { useEffect, useRef } from "react";

const DEFAULT_MAX_INTER_KEY_MS = 50;

function shouldIgnoreTarget(target: EventTarget | null, ignoreInputFocus?: boolean): boolean {
  if (ignoreInputFocus) return false;
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName?.toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return false;
}

/**
 * Sluša brzi niz tastera (tipično USB barkod) koji završava Enter-om.
 * Između uzastopnih tastera mora proći najviše `maxInterKeyMs` ms (podrazumevano 50).
 */
export function useBarcodeScannerListener(
  onScan: (value: string) => void,
  options?: { enabled?: boolean; maxInterKeyMs?: number; ignoreInputFocus?: boolean },
) {
  const enabled = options?.enabled !== false;
  const maxInterKeyMs = options?.maxInterKeyMs ?? DEFAULT_MAX_INTER_KEY_MS;
  const ignoreInputFocus = options?.ignoreInputFocus === true;
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!enabled) return;

    const bufferRef = { current: "" };
    const lastKeyTsRef = { current: 0 };

    const onKeyDown = (e: KeyboardEvent) => {
      if (shouldIgnoreTarget(e.target, ignoreInputFocus)) return;

      const now = typeof performance !== "undefined" ? performance.now() : Date.now();

      if (bufferRef.current.length > 0 && now - lastKeyTsRef.current > maxInterKeyMs) {
        bufferRef.current = "";
      }
      lastKeyTsRef.current = now;

      if (e.key === "Enter") {
        const v = bufferRef.current;
        bufferRef.current = "";
        if (v.length > 0) {
          onScanRef.current(v);
        }
        return;
      }

      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        bufferRef.current += e.key;
      } else {
        bufferRef.current = "";
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [enabled, maxInterKeyMs, ignoreInputFocus]);
}
