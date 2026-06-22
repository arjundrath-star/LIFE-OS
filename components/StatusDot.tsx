"use client";
import { cn } from "@/lib/cn";

export type DotState = "healthy" | "warn" | "error" | "off" | "live";

const COLORS: Record<DotState, string> = {
  healthy: "bg-healthy",
  warn: "bg-warn",
  error: "bg-error",
  off: "bg-off",
  live: "bg-accent",
};

export function StatusDot({
  state,
  pulse = false,
  size = 8,
  className,
}: {
  state: DotState;
  pulse?: boolean;
  size?: number;
  className?: string;
}) {
  const color = COLORS[state];
  return (
    <span className={cn("relative inline-flex shrink-0", className)} style={{ width: size, height: size }}>
      {pulse && state !== "off" && (
        <span
          className={cn("absolute inset-0 rounded-full opacity-60 animate-pulse-ring", color)}
          aria-hidden
        />
      )}
      <span
        className={cn("relative rounded-full", color)}
        style={{
          width: size,
          height: size,
          boxShadow: pulse && state !== "off" ? `0 0 8px 1px var(--tw-shadow-color, currentColor)` : undefined,
        }}
      />
    </span>
  );
}
