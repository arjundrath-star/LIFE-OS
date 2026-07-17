import assert from "node:assert/strict";
import test from "node:test";
import {
  createFixedWindowRateLimiter,
  redactText,
  sanitizeMemory,
  validateSearchInput,
} from "../lib/agentmemory";

test("search input accepts only a bounded query and result limit", () => {
  assert.deepEqual(validateSearchInput({ query: "  deployment lessons  ", limit: 4 }), {
    ok: true,
    value: { query: "deployment lessons", limit: 4 },
  });
  assert.equal(validateSearchInput({ query: "x" }).ok, false);
  assert.equal(validateSearchInput({ query: "x".repeat(161) }).ok, false);
  assert.equal(validateSearchInput({ query: "valid", limit: 0 }).ok, false);
  assert.equal(validateSearchInput({ query: "valid", limit: 11 }).ok, false);
  assert.equal(validateSearchInput({ query: "line\nbreak" }).ok, false);
});

test("search input rejects proxy and scope override fields", () => {
  for (const extra of [
    { path: "/agentmemory/forget" },
    { project: "other" },
    { agentId: "*" },
    { includeLessons: true },
    { expandIds: ["memory-id"] },
  ]) {
    assert.equal(validateSearchInput({ query: "safe query", ...extra }).ok, false);
  }
});

test("redaction removes credential-shaped text", () => {
  const input =
    "Authorization: Bearer fabricated-token-value api_key=fabricated-value " +
    "https://example.test/callback?token=fabricated-token&mode=read";
  const output = redactText(input);
  assert.doesNotMatch(output, /fabricated-token-value/);
  assert.doesNotMatch(output, /fabricated-value/);
  assert.doesNotMatch(output, /fabricated-token&/);
  assert.match(output, /\[redacted/);
});

test("memory sanitizer returns an explicit safe schema and drops unknown sensitive fields", () => {
  const memory = sanitizeMemory({
    id: "mem_123",
    title: "Deployment note",
    content: "Bearer fabricated-upstream-credential",
    type: "lesson",
    project: "/home/example/private-project",
    concepts: ["deploy", "ops"],
    strength: 8,
    createdAt: "2026-07-17T12:00:00.000Z",
    secret: "must-not-return",
    agentId: "scope-must-not-return",
    files: ["/home/example/private-file"],
  });
  assert.deepEqual(Object.keys(memory).sort(), [
    "concepts",
    "content",
    "createdAt",
    "id",
    "project",
    "strength",
    "title",
    "type",
    "updatedAt",
  ]);
  assert.equal(memory.project, "private-project");
  assert.equal(memory.content, "Bearer [redacted]");
  assert.doesNotMatch(JSON.stringify(memory), /must-not-return|scope-must-not-return|private-file/);
});

test("fixed-window limiter enforces and resets a per-key quota", () => {
  const allow = createFixedWindowRateLimiter(2, 1_000);
  assert.deepEqual(allow("user", 10), { allowed: true, remaining: 1, resetAt: 1_010 });
  assert.deepEqual(allow("user", 20), { allowed: true, remaining: 0, resetAt: 1_010 });
  assert.deepEqual(allow("user", 30), { allowed: false, remaining: 0, resetAt: 1_010 });
  assert.deepEqual(allow("other", 30), { allowed: true, remaining: 1, resetAt: 1_030 });
  assert.deepEqual(allow("user", 1_010), { allowed: true, remaining: 1, resetAt: 2_010 });
});
