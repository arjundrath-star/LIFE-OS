"use client";
import { useEffect, useRef, type ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Dialog } from "@/components/ui";
import { X } from "lucide-react";
import { apiPost } from "@/hooks/useApi";
import { PERSON_STATUSES, type PersonStatus } from "@/lib/stern-types";
/** Only a changed network marker invalidates HTTP queries, not every Stern tick. */
export function useNetworkVersion(version: string | undefined, refetch: () => void) {
  const lastVersion = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (version === undefined || lastVersion.current === version) return;
    lastVersion.current = version;
    refetch();
  }, [version, refetch]);
}
export const networkAction = (body: Record<string, unknown>) => apiPost("/api/stern/network", body);
export const statusAllowed = (from: PersonStatus, to: PersonStatus) => from === to || to === "need_to_reach_out" || to === "dormant" || PERSON_STATUSES.indexOf(to) === PERSON_STATUSES.indexOf(from) + 1;
export function NetworkDialog({ open, onClose, title, children, sheet = false, testId }: { open: boolean; onClose: () => void; title: string; children: ReactNode; sheet?: boolean; testId: string }) {
  // Keep content inside the Stern theme scope. Radix supplies focus trap, Escape, and focus restoration.
  return <Dialog open={open} onOpenChange={value => { if (!value) onClose(); }}>
    <DialogPrimitive.Overlay className="stern-network-scrim" />
    <DialogPrimitive.Content aria-describedby={undefined} className={sheet ? "stern-network-dialog stern-add-sheet" : "stern-network-dialog stern-person-panel"} data-testid={testId}>
      <header className="stern-network-dialog-title"><DialogPrimitive.Title>{title}</DialogPrimitive.Title><button type="button" className="stern-btn ghost" aria-label="Close" data-testid={`${testId}-close`} onClick={onClose}><X size={18} /></button></header>
      {children}
    </DialogPrimitive.Content>
  </Dialog>;
}
export function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="stern-network-field"><span>{label}</span>{children}</label>; }
export function Toggle({ label, checked, onChange, testId, disabled = false }: { label: string; checked: boolean; onChange: (value: boolean) => void; testId: string; disabled?: boolean }) {
  return <label className="stern-network-toggle"><input type="checkbox" role="switch" checked={checked} onChange={e => onChange(e.target.checked)} data-testid={testId} disabled={disabled} /><span>{label}</span></label>;
}
