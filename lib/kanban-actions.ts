import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { kanbanSnapshot } from "@/lib/kanban";

const HOME = os.homedir();
const LOCAL_BIN = path.join(HOME, ".local", "bin");
const HERMES_BIN = process.env.HERMES_BIN || path.join(LOCAL_BIN, "hermes");
// systemd and cron do not inherit a login shell PATH, so user-installed
// binaries have to be put back on it explicitly.
const PATH = `${LOCAL_BIN}:${process.env.PATH || ""}`;
const HERMES_CWD = process.env.HERMES_WORKDIR || path.join(HOME, "command-center");

export type KanbanActionResult = { ok: true; data?: any; snapshot?: any; output?: string } | { ok: false; error: string; output?: string };

function runHermes(args: string[]): { ok: boolean; output: string } {
  const res = spawnSync(HERMES_BIN, args, {
    cwd: HERMES_CWD,
    env: { ...process.env, PATH },
    encoding: "utf8",
    timeout: 120_000,
  });
  const output = `${res.stdout || ""}${res.stderr || ""}`.trim();
  return { ok: res.status === 0, output };
}

function withBoard(args: string[], board?: string) {
  return board ? ["kanban", "--board", board, ...args] : ["kanban", ...args];
}

function parseJsonMaybe(text: string) {
  try { return JSON.parse(text); } catch { return text; }
}

export function performKanbanAction(input: any): KanbanActionResult {
  const action = String(input?.action || "");
  const board = typeof input?.board === "string" && input.board ? input.board : undefined;
  let args: string[];

  if (action === "dispatch") {
    args = withBoard(["dispatch"], board);
  } else if (action === "create") {
    const title = String(input?.title || "").trim();
    if (!title) return { ok: false, error: "title is required" };
    args = withBoard(["create", title, "--json"], board);
    if (input?.body) args.push("--body", String(input.body));
    if (input?.assignee) args.push("--assignee", String(input.assignee));
    if (input?.tenant) args.push("--tenant", String(input.tenant));
    if (input?.priority !== undefined && input.priority !== "") args.push("--priority", String(Number(input.priority) || 0));
    if (input?.status === "blocked") args.push("--initial-status", "blocked");
  } else if (action === "comment") {
    const id = String(input?.id || "").trim();
    const body = String(input?.body || "").trim();
    if (!id || !body) return { ok: false, error: "id and body are required" };
    args = withBoard(["comment", id, body], board);
  } else if (action === "promote") {
    const id = String(input?.id || "").trim();
    if (!id) return { ok: false, error: "id is required" };
    args = withBoard(["promote", id], board);
  } else if (action === "unblock") {
    const id = String(input?.id || "").trim();
    if (!id) return { ok: false, error: "id is required" };
    args = withBoard(["unblock", id], board);
  } else if (action === "block") {
    const id = String(input?.id || "").trim();
    const reason = String(input?.reason || "Blocked from Rathworkspace dashboard").trim();
    if (!id) return { ok: false, error: "id is required" };
    args = withBoard(["block", id, reason], board);
  } else if (action === "complete") {
    const id = String(input?.id || "").trim();
    const summary = String(input?.summary || "Completed from Rathworkspace dashboard").trim();
    if (!id) return { ok: false, error: "id is required" };
    args = withBoard(["complete", id, "--summary", summary], board);
  } else if (action === "archive") {
    const id = String(input?.id || "").trim();
    if (!id) return { ok: false, error: "id is required" };
    args = withBoard(["archive", id], board);
  } else if (action === "assign") {
    const id = String(input?.id || "").trim();
    const assignee = String(input?.assignee || "").trim();
    if (!id || !assignee) return { ok: false, error: "id and assignee are required" };
    args = withBoard(["assign", id, assignee], board);
  } else {
    return { ok: false, error: `unknown action: ${action}` };
  }

  const result = runHermes(args);
  if (!result.ok) return { ok: false, error: result.output || "hermes kanban command failed", output: result.output };
  return { ok: true, data: parseJsonMaybe(result.output), output: result.output, snapshot: kanbanSnapshot({ board }) };
}
