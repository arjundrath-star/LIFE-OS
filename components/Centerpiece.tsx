"use client";
// The living centerpiece. NOT decorative: every segment is a real connection state,
// the core number is the live healthy-link count, the core status is live Hermes,
// and the heartbeat speed scales with real recent agent activity.
import { useLiveData } from "@/hooks/useLiveData";
import { CountUp } from "@/components/CountUp";
import { cn } from "@/lib/cn";

type Pulse = {
  hermesOnline: boolean;
  activeSessions: number;
  agentsActive: number;
  agentsTotal: number;
  connectionsHealthy: number;
  connectionsBroken: number;
  connectionsOff: number;
  connectionsTotal: number;
  activityRate: number;
  lastActivityAt: string | null;
};

export function Centerpiece({ mode, size = 340 }: { mode: "working" | "ambient"; size?: number }) {
  const pulse = useLiveData<Pulse>("pulse");

  const total = pulse?.connectionsTotal ?? 0;
  const healthy = pulse?.connectionsHealthy ?? 0;
  const broken = pulse?.connectionsBroken ?? 0;
  const off = pulse?.connectionsOff ?? 0;
  const hermesOnline = pulse?.hermesOnline ?? false;
  const activityRate = pulse?.activityRate ?? 0;

  // heartbeat: faster when busy; calm cinematic breathing in ambient mode
  const beat = mode === "ambient" ? 5.5 : Math.max(1.4, 3.2 - Math.min(activityRate, 12) * 0.15);

  const cx = size / 2;
  const cy = size / 2;
  const rOuter = size * 0.42;
  const rInner = size * 0.36;

  // segmented ring — one tick per connection surface-state, colored by real state
  const ticks = Math.max(total, 1);
  const startAngle = -125;
  const sweep = 250;
  const step = sweep / Math.max(ticks - 1, 1);
  const colorFor = (i: number) =>
    i < healthy ? "#22D3EE" : i < healthy + broken ? "#F59E0B" : "#4B5563";

  return (
    <div className="relative select-none" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className={cn(mode === "ambient" && "animate-breathe")}
      >
        <defs>
          <radialGradient id="coreGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={hermesOnline ? "rgba(34,211,238,0.35)" : "rgba(239,68,68,0.22)"} />
            <stop offset="70%" stopColor="rgba(34,211,238,0.02)" />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
          <linearGradient id="sweepGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgba(34,211,238,0)" />
            <stop offset="100%" stopColor="rgba(34,211,238,0.55)" />
          </linearGradient>
        </defs>

        {/* core glow */}
        <circle cx={cx} cy={cy} r={rInner} fill="url(#coreGlow)" />

        {/* faint guide ring */}
        <circle cx={cx} cy={cy} r={rOuter} fill="none" stroke="#1E1E24" strokeWidth={1} />
        <circle cx={cx} cy={cy} r={rInner} fill="none" stroke="#1E1E24" strokeWidth={1} />

        {/* radar sweep — only when an agent is actually active */}
        {(pulse?.agentsActive ?? 0) > 0 && (
          <g style={{ transformOrigin: `${cx}px ${cy}px` }} className="animate-spin-slow">
            <path
              d={`M ${cx} ${cy} L ${cx + rOuter} ${cy} A ${rOuter} ${rOuter} 0 0 0 ${cx + rOuter * Math.cos(-0.5)} ${cy + rOuter * Math.sin(-0.5)} Z`}
              fill="url(#sweepGrad)"
              opacity={0.5}
            />
          </g>
        )}

        {/* connection ticks — literal: each tick is one real surface-state */}
        {Array.from({ length: ticks }).map((_, i) => {
          const a = ((startAngle + i * step) * Math.PI) / 180;
          const x1 = cx + rInner * Math.cos(a);
          const y1 = cy + rInner * Math.sin(a);
          const x2 = cx + rOuter * Math.cos(a);
          const y2 = cy + rOuter * Math.sin(a);
          const c = colorFor(i);
          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={c}
              strokeWidth={3}
              strokeLinecap="round"
              opacity={c === "#4B5563" ? 0.5 : 0.95}
              style={c === "#22D3EE" ? { filter: "drop-shadow(0 0 3px rgba(34,211,238,0.7))" } : undefined}
            />
          );
        })}

        {/* heartbeat ring */}
        <circle
          cx={cx}
          cy={cy}
          r={rInner * 0.82}
          fill="none"
          stroke={hermesOnline ? "#22D3EE" : "#EF4444"}
          strokeWidth={1.5}
          opacity={0.5}
          style={{
            transformOrigin: `${cx}px ${cy}px`,
            animation: `breathe ${beat}s ease-in-out infinite`,
          }}
        />
      </svg>

      {/* core readout */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-txt-faint">links live</div>
        <div className="my-0.5 flex items-baseline gap-1">
          <CountUp
            value={healthy}
            className={cn("text-5xl font-semibold", hermesOnline ? "text-accent text-glow" : "text-error")}
          />
          <span className="font-mono text-lg text-txt-faint">/{total}</span>
        </div>
        <div className="flex items-center gap-1.5 font-mono text-[11px]">
          <span className={cn("h-1.5 w-1.5 rounded-full", hermesOnline ? "bg-healthy" : "bg-error")} />
          <span className={hermesOnline ? "text-txt-muted" : "text-error"}>
            HERMES {hermesOnline ? "ONLINE" : "OFFLINE"}
          </span>
        </div>
        <div className="mt-1 flex gap-3 font-mono text-[10px] text-txt-faint">
          <span>{pulse?.activeSessions ?? 0} sessions</span>
          {broken > 0 && <span className="text-warn">{broken} broken</span>}
          {off > 0 && <span className="text-off">{off} off</span>}
        </div>
      </div>
    </div>
  );
}
