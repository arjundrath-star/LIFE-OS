"use client";
// Small shadcn-flavored primitives over Radix, themed to the cyan control room.
import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/cn";
import { X } from "lucide-react";

export function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "ghost" | "outline" | "accent" | "danger";
  size?: "default" | "sm" | "icon";
}) {
  const variants: Record<string, string> = {
    default: "bg-panel-2 border border-border text-txt-primary hover:border-accent/50",
    ghost: "text-txt-muted hover:text-txt-primary hover:bg-white/5",
    outline: "border border-border text-txt-primary hover:border-accent/50 hover:bg-white/5",
    accent: "bg-accent/15 border border-accent/40 text-accent hover:bg-accent/25 hover:shadow-glow-sm",
    danger: "border border-error/40 text-error hover:bg-error/10",
  };
  const sizes: Record<string, string> = {
    default: "h-9 px-4 text-sm",
    sm: "h-7 px-2.5 text-xs",
    icon: "h-8 w-8",
  };
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-inner font-medium transition-all disabled:opacity-50 disabled:pointer-events-none",
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    />
  );
}

export function Badge({
  className,
  tone = "muted",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & {
  tone?: "muted" | "accent" | "healthy" | "warn" | "error" | "off";
}) {
  const tones: Record<string, string> = {
    muted: "border-border text-txt-muted",
    accent: "border-accent/40 text-accent bg-accent/10",
    healthy: "border-healthy/40 text-healthy bg-healthy/10",
    warn: "border-warn/40 text-warn bg-warn/10",
    error: "border-error/40 text-error bg-error/10",
    off: "border-off/40 text-off bg-off/10",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider",
        tones[tone],
        className
      )}
      {...props}
    />
  );
}

export function Switch({
  checked,
  onCheckedChange,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <SwitchPrimitive.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full border transition-colors disabled:opacity-50",
        checked ? "bg-accent/30 border-accent/60" : "bg-panel-2 border-border"
      )}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "block h-3.5 w-3.5 rounded-full transition-transform",
          checked ? "translate-x-[18px] bg-accent shadow-glow-sm" : "translate-x-[3px] bg-off"
        )}
      />
    </SwitchPrimitive.Root>
  );
}

// Dialog (drill-down overlay)
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;

export function DialogContent({
  className,
  children,
  title,
}: {
  className?: string;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm data-[state=open]:animate-fade-in" />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[94vw] max-w-6xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-panel border border-border bg-panel shadow-glow-lg data-[state=open]:animate-fade-in",
          className
        )}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <DialogPrimitive.Title className="font-mono text-sm uppercase tracking-widest text-txt-muted">
            {title}
          </DialogPrimitive.Title>
          <DialogPrimitive.Close asChild>
            <Button variant="ghost" size="icon" aria-label="Close">
              <X size={16} />
            </Button>
          </DialogPrimitive.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

// Tabs
export const Tabs = TabsPrimitive.Root;
export function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn("inline-flex gap-1 rounded-inner border border-border bg-panel-2 p-1", className)}
      {...props}
    />
  );
}
export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "rounded-[6px] px-3 py-1 font-mono text-xs uppercase tracking-wider text-txt-muted transition-colors data-[state=active]:bg-accent/15 data-[state=active]:text-accent",
        className
      )}
      {...props}
    />
  );
}
export const TabsContent = TabsPrimitive.Content;
