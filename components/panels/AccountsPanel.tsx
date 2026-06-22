"use client";
import { useState } from "react";
import { Panel, EmptyState } from "@/components/Panel";
import { Button, Badge } from "@/components/ui";
import { useApi, apiPost } from "@/hooks/useApi";
import { Link2, Plus, Mail, Boxes, Globe, X, ExternalLink } from "lucide-react";
import { cn } from "@/lib/cn";

const kindIcon: Record<string, React.ReactNode> = {
  google: <Mail size={13} />,
  service: <Boxes size={13} />,
  link: <Globe size={13} />,
  plugin: <Link2 size={13} />,
};

export function AccountsPanel({ onExpand, expanded = false }: { onExpand?: () => void; expanded?: boolean }) {
  const { data, refetch } = useApi<any>("/api/accounts");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ label: "", kind: "service", url: "", note: "" });
  const accounts = data?.accounts ?? [];

  const groups: Record<string, any[]> = { google: [], service: [], link: [], plugin: [] };
  for (const a of accounts) (groups[a.kind] || groups.service).push(a);

  const add = async () => {
    if (!form.label) return;
    await apiPost("/api/accounts", { action: "add", ...form });
    setForm({ label: "", kind: "service", url: "", note: "" });
    setAdding(false);
    refetch();
  };
  const del = async (id: number) => {
    await apiPost("/api/accounts", { action: "delete", id });
    refetch();
  };

  return (
    <Panel
      title="Accounts & Links"
      icon={<Link2 size={13} />}
      subtitle={`${accounts.length} catalogued`}
      onExpand={onExpand}
      right={
        <Button variant="ghost" size="sm" onClick={() => setAdding((v) => !v)}>
          <Plus size={12} /> add
        </Button>
      }
      bodyClassName={cn("overflow-auto space-y-3", expanded ? "max-h-[70vh]" : "max-h-[340px]")}
    >
      {adding && (
        <div className="space-y-2 rounded-inner border border-accent/30 bg-accent/5 p-3">
          <div className="grid grid-cols-2 gap-2">
            <input className={inp} placeholder="label" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
            <select className={inp} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              <option value="service">service</option>
              <option value="google">google</option>
              <option value="link">link</option>
              <option value="plugin">plugin</option>
            </select>
          </div>
          <input className={inp} placeholder="url (optional)" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
          <input className={inp} placeholder="note (optional)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>cancel</Button>
            <Button size="sm" variant="accent" onClick={add}>save</Button>
          </div>
        </div>
      )}

      {accounts.length === 0 ? (
        <EmptyState title="empty" hint="catalog your accounts, links, and integrations" />
      ) : (
        Object.entries(groups).map(([kind, items]) =>
          items.length === 0 ? null : (
            <div key={kind}>
              <div className="mb-1.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-txt-faint">
                {kindIcon[kind]} {kind} ({items.length})
              </div>
              <div className="space-y-1">
                {items.map((a) => (
                  <div key={a.id} className="group/acc flex items-center gap-2 rounded-inner border border-border/60 bg-panel-2/30 px-2.5 py-1.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm text-txt-primary">{a.label}</span>
                        {a.surface && <Badge tone="muted" className="!text-[9px]">{a.surface}</Badge>}
                      </div>
                      {a.note && <div className="truncate text-[11px] text-txt-faint">{a.note}</div>}
                    </div>
                    {a.url && (
                      <a href={a.url} target="_blank" rel="noreferrer" className="text-txt-faint hover:text-accent">
                        <ExternalLink size={12} />
                      </a>
                    )}
                    <button onClick={() => del(a.id)} className="opacity-0 transition-opacity group-hover/acc:opacity-100 text-txt-faint hover:text-error" aria-label="delete">
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )
        )
      )}
    </Panel>
  );
}

const inp = "w-full rounded-inner border border-border bg-base px-2 py-1.5 text-xs text-txt-primary outline-none focus:border-accent/50";
