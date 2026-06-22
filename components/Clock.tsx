"use client";
import { useEffect, useState } from "react";
import { clockTime, dateLong } from "@/lib/time";

export function Clock({ big = false }: { big?: boolean }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  if (!now) {
    return <div className="font-mono text-txt-faint">--:--:--</div>;
  }

  return (
    <div>
      <div className={big ? "font-mono text-7xl font-semibold tracking-tight text-txt-primary tabular" : "font-mono text-3xl font-semibold tracking-tight text-txt-primary tabular"}>
        {clockTime(now)}
      </div>
      <div className={big ? "mt-2 text-base text-txt-muted" : "text-xs text-txt-faint"}>{dateLong(now)}</div>
    </div>
  );
}
