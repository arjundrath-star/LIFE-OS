import test from "node:test";
import assert from "node:assert/strict";
import {
  connectionAccessForEmail,
  filterConnectionStates,
  isHealthApiPath,
  mayMutateConnection,
  visibleConnectionDefinitions,
} from "@/lib/connections/access";

const definitions = [
  { id: "mercury" },
  { id: "whoop" },
  { id: "hevy" },
  { id: "telegram" },
];
const states = definitions.map(({ id }) => ({ service: id, detail: `${id}-detail` }));

test("connection access classifies the Health owner and ordinary app users without weakening non-Health mutations", () => {
  const healthAllowed = ["owner@example.com"];
  const owner = connectionAccessForEmail("OWNER@example.com", healthAllowed);
  const ordinary = connectionAccessForEmail("ordinary@example.com", healthAllowed);

  assert.equal(owner.health, true);
  assert.equal(ordinary.health, false);
  assert.equal(mayMutateConnection(owner, "whoop"), true);
  assert.equal(mayMutateConnection(owner, "hevy"), true);
  assert.equal(mayMutateConnection(ordinary, "whoop"), false);
  assert.equal(mayMutateConnection(ordinary, "hevy"), false);
  assert.equal(mayMutateConnection(ordinary, "mercury"), true);
  assert.equal(mayMutateConnection(ordinary, "telegram"), true);
});

test("ordinary connection reads and rechecks omit Health services exactly while the owner retains them", () => {
  const owner = connectionAccessForEmail("owner@example.com", ["owner@example.com"]);
  const ordinary = connectionAccessForEmail("ordinary@example.com", ["owner@example.com"]);

  assert.deepEqual(filterConnectionStates(states, ordinary).map((row) => row.service), ["mercury", "telegram"]);
  assert.deepEqual(visibleConnectionDefinitions(definitions, ordinary).map((row) => row.id), ["mercury", "telegram"]);
  assert.deepEqual(filterConnectionStates(states, owner), states);
  assert.deepEqual(visibleConnectionDefinitions(definitions, owner), definitions);
});

test("middleware Health classification includes every WHOOP API route and excludes unrelated APIs", () => {
  for (const path of ["/health", "/health/history", "/api/health", "/api/health/log", "/api/whoop/credentials", "/api/whoop/connect", "/api/whoop/callback"]) {
    assert.equal(isHealthApiPath(path), true, path);
  }
  for (const path of ["/api/connections", "/api/connections/toggle", "/api/whoops", "/connections"]) {
    assert.equal(isHealthApiPath(path), false, path);
  }
});
