import assert from "node:assert/strict";
import test, { after } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-test-"));
process.env.RATHWORKSPACE_DB = path.join(tmpDir, "test.db");

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("blocked runs are terminal, timestamped, immutable, and absent from active runs", async () => {
  const { AgentEventError, agentsOrchestrationSnapshot, recordAgentEvent, runDetail } = await import("../lib/agents");

  recordAgentEvent({
    agent: "test-agent",
    run: "blocked-run",
    status: "running",
    summary: "Started",
  });
  recordAgentEvent({
    agent: "test-agent",
    run: "blocked-run",
    status: "blocked",
    summary: "Needs operator review",
  });

  const detail = runDetail("blocked-run");
  assert.equal(detail?.run.status, "blocked");
  assert.ok(detail?.run.finished_at);

  assert.throws(
    () =>
      recordAgentEvent({
        agent: "test-agent",
        run: "blocked-run",
        summary: "Late event",
      }),
    (error: unknown) => error instanceof AgentEventError && /already blocked \(terminal\)/.test(error.message)
  );

  const snapshot = agentsOrchestrationSnapshot();
  assert.equal(snapshot.activeRuns.some((run: { id: string }) => run.id === "blocked-run"), false);
  assert.equal(snapshot.stats.runsActive, 0);
  assert.equal(snapshot.stats.blocked, 1);
});
