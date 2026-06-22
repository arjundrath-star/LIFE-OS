"use client";
import { useState } from "react";
import { Panel } from "@/components/Panel";
import { Button } from "@/components/ui";
import { useApi, apiPost } from "@/hooks/useApi";
import { CheckSquare, Square, Plus, X } from "lucide-react";
import { cn } from "@/lib/cn";

export function TodosPanel({ onExpand }: { onExpand?: () => void }) {
  const { data, refetch } = useApi<any>("/api/todos");
  const [text, setText] = useState("");
  const todos = data?.todos ?? [];
  const open = todos.filter((t: any) => !t.done).length;

  const toggle = async (id: number) => {
    await apiPost("/api/todos", { action: "toggle", id });
    refetch();
  };
  const add = async () => {
    if (!text.trim()) return;
    await apiPost("/api/todos", { action: "add", text: text.trim() });
    setText("");
    refetch();
  };
  const del = async (id: number) => {
    await apiPost("/api/todos", { action: "delete", id });
    refetch();
  };

  return (
    <Panel title="To-do" icon={<CheckSquare size={13} />} subtitle={`${open} open`} onExpand={onExpand} bodyClassName="space-y-2">
      <div className="flex items-center gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="add a task"
          className="flex-1 rounded-inner border border-border bg-base px-2 py-1.5 text-xs text-txt-primary outline-none focus:border-accent/50"
        />
        <Button size="sm" variant="accent" onClick={add}>
          <Plus size={12} />
        </Button>
      </div>
      <div className="space-y-1">
        {todos.map((t: any) => (
          <div key={t.id} className="group/td flex items-start gap-2 rounded-inner px-1 py-1 hover:bg-white/5">
            <button onClick={() => toggle(t.id)} className={cn("mt-0.5", t.done ? "text-healthy" : "text-txt-faint hover:text-accent")}>
              {t.done ? <CheckSquare size={14} /> : <Square size={14} />}
            </button>
            <span className={cn("min-w-0 flex-1 text-xs", t.done ? "text-txt-faint line-through" : "text-txt-muted")}>
              {t.text}
              {t.due && <span className="ml-1 font-mono text-[10px] text-warn">· {t.due}</span>}
              {t.source === "spec" && <span className="ml-1 font-mono text-[9px] text-txt-faint/60">[spec]</span>}
            </span>
            <button onClick={() => del(t.id)} className="opacity-0 transition-opacity group-hover/td:opacity-100 text-txt-faint hover:text-error" aria-label="delete">
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
    </Panel>
  );
}
