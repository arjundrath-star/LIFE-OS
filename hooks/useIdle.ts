"use client";
import { useEffect, useRef, useState } from "react";

/** Returns true after `ms` of no user interaction. Resets on activity. */
export function useIdle(ms: number): [boolean, () => void] {
  const [idle, setIdle] = useState(false);
  const timer = useRef<any>(null);

  const reset = () => {
    setIdle(false);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setIdle(true), ms);
  };

  useEffect(() => {
    const events = ["mousemove", "mousedown", "keydown", "touchstart", "wheel"];
    const handler = () => reset();
    events.forEach((e) => window.addEventListener(e, handler, { passive: true }));
    reset();
    return () => {
      events.forEach((e) => window.removeEventListener(e, handler));
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms]);

  return [idle, reset];
}
