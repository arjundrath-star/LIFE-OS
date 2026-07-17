"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { ProjectPage, HeroStat, Section } from "@/components/shell/ProjectPage";
import { Badge, Button } from "@/components/ui";
import {
  BrainCircuit,
  Clock3,
  Database,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

type MemoryItem = {
  id: string | null;
  title: string;
  content: string | null;
  type: string | null;
  project: string | null;
  concepts: string[];
  strength: number | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type SessionItem = {
  id: string | null;
  status: string | null;
  project: string | null;
  summary: string | null;
  observationCount: number | null;
  startedAt: string | null;
  endedAt: string | null;
  updatedAt: string | null;
};

type SearchItem = {
  id: string | null;
  sessionId: string | null;
  title: string;
  content: string | null;
  type: string | null;
  score: number | null;
  timestamp: string | null;
};

type Snapshot = {
  service: {
    status: string;
    version: string | null;
    uptimeSeconds: number | null;
    connectionState: string | null;
    kvStatus: string | null;
    circuitState: string | null;
  };
  counts: { memories: number; sessions: number };
  profile: {
    concepts: { label: string; count: number }[];
    projects: { label: string; count: number }[];
  };
  memories: MemoryItem[];
  sessions: SessionItem[];
  checkedAt: string;
};

type SearchResponse = { mode: string | null; results: SearchItem[]; error?: string };

function timeAgo(value: string | null): string {
  if (!value) return "time unknown";
  const delta = Date.now() - Date.parse(value);
  if (!Number.isFinite(delta)) return "time unknown";
  const minutes = Math.max(0, Math.floor(delta / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function uptime(value: number | null): string {
  if (value === null) return "—";
  const hours = Math.floor(value / 3_600);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function MemoryCard({ memory }: { memory: MemoryItem }) {
  return (
    <article className="rounded-inner border border-border/70 bg-panel-2/30 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-txt-primary">{memory.title}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {memory.type && <Badge tone="accent">{memory.type}</Badge>}
            {memory.project && <Badge tone="muted" className="!normal-case">{memory.project}</Badge>}
          </div>
        </div>
        <span className="shrink-0 font-mono text-[10px] text-txt-faint">
          {timeAgo(memory.updatedAt || memory.createdAt)}
        </span>
      </div>
      {memory.content && <p className="mt-3 whitespace-pre-wrap text-xs leading-relaxed text-txt-muted">{memory.content}</p>}
      {memory.concepts.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {memory.concepts.map((concept) => (
            <span key={concept} className="rounded-full border border-border/60 px-2 py-0.5 font-mono text-[10px] text-txt-faint">
              {concept}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}

function SearchCard({ result }: { result: SearchItem }) {
  return (
    <article className="rounded-inner border border-accent/20 bg-accent/[0.035] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-txt-primary">{result.title}</h3>
          <div className="mt-1 flex items-center gap-1.5">
            {result.type && <Badge tone="accent">{result.type}</Badge>}
            {result.score !== null && (
              <span className="font-mono text-[10px] text-txt-faint">score {result.score.toFixed(3)}</span>
            )}
          </div>
        </div>
        <span className="shrink-0 font-mono text-[10px] text-txt-faint">{timeAgo(result.timestamp)}</span>
      </div>
      {result.content && <p className="mt-3 whitespace-pre-wrap text-xs leading-relaxed text-txt-muted">{result.content}</p>}
    </article>
  );
}

export default function AgentMemoryPage() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResponse, setSearchResponse] = useState<SearchResponse | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch("/api/agentmemory", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load AgentMemory");
      setSnapshot(data);
    } catch (error) {
      setLoadError((error as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function submitSearch(event: FormEvent) {
    event.preventDefault();
    if (query.trim().length < 2) return;
    setSearching(true);
    setSearchError(null);
    try {
      const response = await fetch("/api/agentmemory", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: query.trim(), limit: 6 }),
      });
      const data: SearchResponse = await response.json();
      if (!response.ok) throw new Error(data.error || "Search failed");
      setSearchResponse(data);
    } catch (error) {
      setSearchError((error as Error).message);
      setSearchResponse(null);
    } finally {
      setSearching(false);
    }
  }

  const healthy = snapshot?.service.status === "healthy" || snapshot?.service.status === "ok";
  const serviceStatus = snapshot?.service.status || (loading ? "connecting" : "unavailable");

  return (
    <ProjectPage
      title="AgentMemory"
      icon={<BrainCircuit size={19} />}
      subtitle="Authenticated, read-only memory intelligence. Native AgentMemory ports and credentials remain server-side on loopback."
      statusDot={healthy ? "healthy" : loading ? "live" : "error"}
      statusLabel={serviceStatus}
      actions={
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          Refresh
        </Button>
      }
      hero={
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <HeroStat label="Service" value={serviceStatus.toUpperCase()} tone={healthy ? "healthy" : loading ? "accent" : "error"} sub={snapshot?.service.version ? `AgentMemory v${snapshot.service.version}` : "loopback BFF"} />
          <HeroStat label="Memories" value={snapshot?.counts.memories ?? "—"} tone="accent" sub={`${snapshot?.memories.length ?? 0} recent and active`} />
          <HeroStat label="Sessions" value={snapshot?.counts.sessions ?? "—"} sub={`${snapshot?.sessions.length ?? 0} recent sessions`} />
          <HeroStat label="Uptime" value={uptime(snapshot?.service.uptimeSeconds ?? null)} tone="muted" sub={`KV ${snapshot?.service.kvStatus || "unknown"}`} />
        </div>
      }
    >
      {loadError && (
        <div role="alert" className="rounded-inner border border-error/40 bg-error/10 px-4 py-3 text-sm text-error">
          {loadError}
        </div>
      )}

      <Section
        title="Smart search"
        icon={<Search size={13} />}
        right={<Badge tone="healthy" className="!normal-case"><ShieldCheck size={10} /> read-only · bounded</Badge>}
        bodyClassName="space-y-4"
      >
        <form onSubmit={submitSearch} className="flex flex-col gap-2 sm:flex-row">
          <label htmlFor="agentmemory-query" className="sr-only">Search AgentMemory</label>
          <input
            id="agentmemory-query"
            value={query}
            onChange={(event) => setQuery(event.target.value.slice(0, 160))}
            placeholder="Search decisions, lessons, files, or prior work…"
            minLength={2}
            maxLength={160}
            className="h-10 min-w-0 flex-1 rounded-inner border border-border bg-base/60 px-3 text-sm text-txt-primary outline-none placeholder:text-txt-faint focus:border-accent/60 focus:ring-1 focus:ring-accent/20"
          />
          <Button type="submit" variant="accent" disabled={searching || query.trim().length < 2}>
            {searching ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {searching ? "Searching" : "Search memory"}
          </Button>
        </form>
        <p className="font-mono text-[10px] text-txt-faint">
          160 character maximum · six results · per-user rate limit · no scope or path overrides
        </p>
        {searchError && <div role="alert" className="text-sm text-error">{searchError}</div>}
        {searchResponse && (
          <div className="space-y-3 border-t border-border/60 pt-4">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-wider text-txt-faint">
                {searchResponse.results.length} result{searchResponse.results.length === 1 ? "" : "s"}
              </span>
              {searchResponse.mode && <Badge tone="muted">{searchResponse.mode}</Badge>}
            </div>
            {searchResponse.results.length > 0 ? (
              <div className="grid gap-3 lg:grid-cols-2">
                {searchResponse.results.map((result, index) => <SearchCard key={result.id || `${result.title}-${index}`} result={result} />)}
              </div>
            ) : (
              <div className="rounded-inner border border-dashed border-border py-8 text-center text-sm text-txt-faint">No matching memories.</div>
            )}
          </div>
        )}
      </Section>

      <div className="grid gap-5 xl:grid-cols-[1.55fr_0.8fr]">
        <Section title="Recent memories" icon={<Database size={13} />} bodyClassName="space-y-3">
          {loading && !snapshot ? (
            <div className="py-10 text-center font-mono text-xs text-txt-faint">loading memory index…</div>
          ) : snapshot?.memories.length ? (
            snapshot.memories.map((memory, index) => <MemoryCard key={memory.id || `${memory.title}-${index}`} memory={memory} />)
          ) : (
            <div className="py-10 text-center text-sm text-txt-faint">No active memories yet.</div>
          )}
        </Section>

        <div className="space-y-5">
          <Section title="Memory profile" icon={<BrainCircuit size={13} />} bodyClassName="space-y-4">
            <div>
              <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-txt-faint">Top concepts</div>
              <div className="flex flex-wrap gap-1.5">
                {snapshot?.profile.concepts.length ? snapshot.profile.concepts.map((item) => (
                  <Badge key={item.label} tone="accent" className="!normal-case">{item.label} · {item.count}</Badge>
                )) : <span className="text-xs text-txt-faint">Profile builds as memories accumulate.</span>}
              </div>
            </div>
            <div>
              <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-txt-faint">Projects</div>
              <div className="flex flex-wrap gap-1.5">
                {snapshot?.profile.projects.length ? snapshot.profile.projects.map((item) => (
                  <Badge key={item.label} tone="muted" className="!normal-case">{item.label} · {item.count}</Badge>
                )) : <span className="text-xs text-txt-faint">No project distribution yet.</span>}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 border-t border-border/60 pt-3 font-mono text-[10px] text-txt-faint">
              <div>connection <span className="text-txt-muted">{snapshot?.service.connectionState || "unknown"}</span></div>
              <div>circuit <span className="text-txt-muted">{snapshot?.service.circuitState || "unknown"}</span></div>
              <div>KV <span className="text-txt-muted">{snapshot?.service.kvStatus || "unknown"}</span></div>
              <div>checked <span className="text-txt-muted">{timeAgo(snapshot?.checkedAt || null)}</span></div>
            </div>
          </Section>

          <Section title="Recent sessions" icon={<Clock3 size={13} />} bodyClassName="space-y-2">
            {snapshot?.sessions.length ? snapshot.sessions.map((session, index) => (
              <article key={session.id || index} className="rounded-inner border border-border/70 bg-panel-2/30 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <Badge tone={session.status === "completed" ? "healthy" : "muted"}>{session.status || "unknown"}</Badge>
                    {session.project && <span className="truncate text-xs text-txt-muted">{session.project}</span>}
                  </div>
                  <span className="shrink-0 font-mono text-[10px] text-txt-faint">{timeAgo(session.updatedAt || session.endedAt || session.startedAt)}</span>
                </div>
                {session.summary && <p className="mt-2 text-xs leading-relaxed text-txt-muted">{session.summary}</p>}
                {session.observationCount !== null && <div className="mt-2 font-mono text-[10px] text-txt-faint">{session.observationCount} observations</div>}
              </article>
            )) : <div className="py-8 text-center text-sm text-txt-faint">No sessions recorded yet.</div>}
          </Section>
        </div>
      </div>
    </ProjectPage>
  );
}
