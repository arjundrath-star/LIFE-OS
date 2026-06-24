#!/usr/bin/env -S tsx
// Local agent-event CLI. A TRUSTED LOCAL WRITER: it touches ONLY SQLite (via @/db and
// @/lib/agents) — no network, no email, no auth, no browser. Hermes / cron / Claude Code /
// any shell task on this box calls it to emit a named-agent run event. The running
// dashboard server reads the same DB on its scheduler tick (≤5s) and broadcasts it; this
// process never talks to the server.
//
// Usage:
//   tsx scripts/agent-event.ts --agent <slug> --run <run-id> --summary "<text>" \
//       [--kind <kind>] [--status <status>] [--level info|success|warn|error] \
//       [--detail '<json>' | --detail-file <path>] \
//       [--trigger-type <t>] [--trigger-source <s>] \
//       [--display-name <name>] [--description <text>] [--schedule-label <text>] \
//       [--enabled|--disabled] \
//       [--artifact-type <t> --artifact-title <title> --artifact-uri <uri> \
//        [--artifact-metadata '<json>' | --artifact-metadata-file <path>]]
//
// status ∈ idle|queued|running|waiting_for_review|blocked|completed|failed
// Exit codes: 0 ok · 1 write/validation error · 2 usage error.
import fs from "node:fs";
import { recordAgentEvent, AgentEventError, RUN_STATUSES } from "@/lib/agents";

function usage(msg?: string): never {
  if (msg) console.error(`error: ${msg}`);
  console.error(
    `usage: agent-event --agent <slug> --run <run-id> --summary <text>\n` +
      `       [--kind <kind>] [--status ${RUN_STATUSES.join("|")}]\n` +
      `       [--level info|success|warn|error] [--detail <json> | --detail-file <path>]\n` +
      `       [--trigger-type <t>] [--trigger-source <s>]\n` +
      `       [--display-name <n>] [--description <t>] [--schedule-label <t>] [--enabled|--disabled]\n` +
      `       [--artifact-type <t> --artifact-title <t> --artifact-uri <u> [--artifact-metadata <json> | --artifact-metadata-file <path>]]`
  );
  process.exit(2);
}

// Minimal flag parser: supports "--flag value", "--flag=value", and bare boolean flags.
function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  const BOOLEAN = new Set(["enabled", "disabled", "help"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) usage(`unexpected argument: ${a}`);
    const eq = a.indexOf("=");
    if (eq !== -1) {
      const k = a.slice(2, eq);
      const val = a.slice(eq + 1);
      // boolean flags in =value form: parse truthiness explicitly so `--enabled=false`
      // disables rather than being read as the truthy string "false".
      out[k] = BOOLEAN.has(k) ? /^(1|true|yes|on)$/i.test(val) : val;
      continue;
    }
    const key = a.slice(2);
    if (BOOLEAN.has(key)) {
      out[key] = true;
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) usage(`flag --${key} needs a value`);
    out[key] = next;
    i++;
  }
  return out;
}

function readFileArg(path: string, label: string): string {
  try {
    return fs.readFileSync(path, "utf8");
  } catch (e) {
    usage(`could not read ${label} ${path}: ${(e as Error).message}`);
  }
}

function str(v: string | boolean | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) usage();

  if (!args.agent) usage("--agent is required");
  if (!args.run) usage("--run is required");
  if (!args.summary) usage("--summary is required");

  // detail (inline xor file)
  let detail = str(args.detail);
  if (args["detail-file"]) {
    if (detail !== undefined) usage("pass only one of --detail / --detail-file");
    detail = readFileArg(String(args["detail-file"]), "--detail-file");
  }

  // optional artifact (all three core fields required together)
  const aType = str(args["artifact-type"]);
  const aTitle = str(args["artifact-title"]);
  const aUri = str(args["artifact-uri"]);
  let artifact: { type: string; title: string; uri: string; metadata?: string } | undefined;
  if (aType || aTitle || aUri) {
    if (!aType || !aTitle || !aUri) {
      usage("--artifact-type, --artifact-title and --artifact-uri must be given together");
    }
    let metadata = str(args["artifact-metadata"]);
    if (args["artifact-metadata-file"]) {
      if (metadata !== undefined) usage("pass only one of --artifact-metadata / --artifact-metadata-file");
      metadata = readFileArg(String(args["artifact-metadata-file"]), "--artifact-metadata-file");
    }
    artifact = { type: aType, title: aTitle, uri: aUri, metadata };
  }

  if ("enabled" in args && "disabled" in args) usage("pass only one of --enabled / --disabled");
  // bare --enabled / --enabled=true -> true; --enabled=false -> false; bare --disabled -> false.
  let enabled: boolean | undefined = undefined;
  if ("enabled" in args) enabled = args.enabled === true;
  else if ("disabled" in args) enabled = !(args.disabled === true);

  try {
    const res = recordAgentEvent({
      agent: String(args.agent),
      run: String(args.run),
      summary: String(args.summary),
      kind: str(args.kind),
      status: str(args.status),
      level: str(args.level),
      detail,
      triggerType: str(args["trigger-type"]),
      triggerSource: str(args["trigger-source"]),
      displayName: str(args["display-name"]),
      description: str(args.description),
      scheduleLabel: str(args["schedule-label"]),
      enabled,
      artifact,
    });
    process.stdout.write(JSON.stringify(res) + "\n");
    process.exit(0);
  } catch (e) {
    if (e instanceof AgentEventError) {
      console.error(`agent-event: ${e.message}`);
      process.exit(1);
    }
    console.error(`agent-event: ${(e as Error).message}`);
    process.exit(1);
  }
}

main();
