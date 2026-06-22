"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { NAV } from "@/components/shell/nav";
import { useLiveData } from "@/hooks/useLiveData";
import { cn } from "@/lib/cn";
import {
  Search,
  CornerDownLeft,
  Moon,
  RefreshCw,
  Plus,
  Sparkles,
  LogOut,
  FolderGit2,
  type LucideIcon,
} from "lucide-react";

type Cmd = { id: string; label: string; group: string; Icon: LucideIcon; hint?: string; run: () => void };

// subsequence fuzzy score: lower is better, null = no match
function score(query: string, text: string): number | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 0;
  let ti = 0;
  let firstHit = -1;
  let gaps = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi];
    let found = -1;
    for (; ti < t.length; ti++) {
      if (t[ti] === c) {
        found = ti;
        break;
      }
    }
    if (found === -1) return null;
    if (firstHit === -1) firstHit = found;
    if (qi > 0) gaps += 1;
    ti = found + 1;
  }
  return firstHit + gaps; // earlier + tighter match ranks first
}

export function CommandPalette({
  open,
  onClose,
  onToggleAmbient,
}: {
  open: boolean;
  onClose: () => void;
  onToggleAmbient: () => void;
}) {
  const router = useRouter();
  const projects = useLiveData<any[]>("projects");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const go = (href: string) => {
    router.push(href);
    onClose();
  };

  const commands: Cmd[] = useMemo(() => {
    const nav: Cmd[] = NAV.map((n) => ({
      id: `nav-${n.key}`,
      label: n.label,
      group: "Go to",
      Icon: n.Icon,
      run: () => go(n.href),
    }));
    const actions: Cmd[] = [
      { id: "act-ambient", label: "Toggle ambient mode", group: "Action", Icon: Moon, run: () => { onToggleAmbient(); onClose(); } },
      {
        id: "act-recheck",
        label: "Recheck all connections",
        group: "Action",
        Icon: RefreshCw,
        run: () => { fetch("/api/connections/recheck", { method: "POST" }).catch(() => {}); onClose(); },
      },
      { id: "act-connect-google", label: "Connect a Google account", group: "Action", Icon: Plus, run: () => { window.location.href = "/api/google/connect"; } },
      { id: "act-generate", label: "Generate a video (Higgsfield)", group: "Action", Icon: Sparkles, run: () => { window.open("https://higgsfield.ai/create", "_blank"); onClose(); } },
      { id: "act-signout", label: "Sign out", group: "Action", Icon: LogOut, run: () => signOut({ callbackUrl: "/signin" }) },
    ];
    const proj: Cmd[] = (projects || []).slice(0, 8).map((p: any) => ({
      id: `proj-${p.slug}`,
      label: p.name,
      group: "Project",
      Icon: FolderGit2,
      hint: `${p.fileCount} files`,
      run: () => go("/projects"),
    }));
    return [...nav, ...actions, ...proj];
  }, [projects]);

  const results = useMemo(() => {
    const scored = commands
      .map((c) => ({ c, s: score(q, c.label) }))
      .filter((x) => x.s !== null) as { c: Cmd; s: number }[];
    scored.sort((a, b) => a.s - b.s);
    return scored.map((x) => x.c);
  }, [commands, q]);

  useEffect(() => {
    if (open) {
      setQ("");
      setSel(0);
      // focus after paint
      const t = setTimeout(() => inputRef.current?.focus(), 10);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => setSel(0), [q]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSel((s) => Math.min(s + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSel((s) => Math.max(s - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        results[sel]?.run();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, results, sel, onClose]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${sel}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  if (!open) return null;

  // group preserving sort order
  const groups: { name: string; items: { c: Cmd; idx: number }[] }[] = [];
  results.forEach((c, idx) => {
    let g = groups.find((x) => x.name === c.group);
    if (!g) {
      g = { name: c.group, items: [] };
      groups.push(g);
    }
    g.items.push({ c, idx });
  });

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center px-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div className="relative w-full max-w-xl overflow-hidden rounded-panel border border-border bg-panel shadow-glow-lg animate-fade-in">
        <div className="flex items-center gap-2 border-b border-border px-4">
          <Search size={16} className="shrink-0 text-txt-faint" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Jump to a section, project, or action…"
            className="h-12 flex-1 bg-transparent font-sans text-sm text-txt-primary outline-none placeholder:text-txt-faint"
          />
          <kbd className="hidden rounded border border-border bg-base px-1.5 py-0.5 font-mono text-[10px] text-txt-faint sm:block">esc</kbd>
        </div>
        <div ref={listRef} className="max-h-[52vh] overflow-y-auto py-2">
          {results.length === 0 ? (
            <div className="px-4 py-8 text-center font-mono text-xs text-txt-faint">no matches</div>
          ) : (
            groups.map((g) => (
              <div key={g.name} className="mb-1">
                <div className="px-4 py-1 font-mono text-[10px] uppercase tracking-widest text-txt-faint/70">{g.name}</div>
                {g.items.map(({ c, idx }) => (
                  <button
                    key={c.id}
                    data-idx={idx}
                    onMouseMove={() => setSel(idx)}
                    onClick={() => c.run()}
                    className={cn(
                      "flex w-full items-center gap-3 px-4 py-2 text-left transition-colors",
                      idx === sel ? "bg-accent/10 text-accent" : "text-txt-muted hover:bg-white/5"
                    )}
                  >
                    <c.Icon size={15} className="shrink-0" />
                    <span className="flex-1 truncate text-sm">{c.label}</span>
                    {c.hint && <span className="font-mono text-[10px] text-txt-faint">{c.hint}</span>}
                    {idx === sel && <CornerDownLeft size={13} className="shrink-0 text-accent/70" />}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
