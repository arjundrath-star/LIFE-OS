import assert from "node:assert/strict";
import test from "node:test";
import { telegramGatewayHealth } from "../lib/sources/telegram";

test("Telegram is healthy when the live Hermes gateway reports it connected", () => {
  assert.deepEqual(
    telegramGatewayHealth({
      online: true,
      reachable: true,
      platforms: [{ name: "telegram", state: "connected", error: null }],
    }),
    {
      reachable: true,
      healthy: true,
      state: "idle",
      detail: "connected via Hermes gateway",
    }
  );
});

test("Telegram follows live Hermes gateway failures instead of a legacy listener log", () => {
  assert.deepEqual(
    telegramGatewayHealth({
      online: false,
      reachable: true,
      platforms: [{ name: "telegram", state: "connected", error: null }],
    }),
    {
      reachable: true,
      healthy: false,
      state: "down",
      detail: "Hermes gateway offline",
    }
  );

  assert.deepEqual(
    telegramGatewayHealth({
      online: true,
      reachable: true,
      platforms: [
        {
          name: "telegram",
          state: "error",
          error: "Conflict: terminated by other getUpdates request (409)",
        },
      ],
    }),
    {
      reachable: true,
      healthy: false,
      state: "conflict",
      detail: "Conflict: terminated by other getUpdates request (409)",
    }
  );
});

test("Telegram is down when the Hermes status endpoint is unreachable or Telegram is absent", () => {
  assert.deepEqual(
    telegramGatewayHealth({ online: false, reachable: false, platforms: [] }),
    {
      reachable: false,
      healthy: false,
      state: "down",
      detail: "Hermes status endpoint unreachable",
    }
  );

  assert.deepEqual(
    telegramGatewayHealth({ online: true, reachable: true, platforms: [] }),
    {
      reachable: true,
      healthy: false,
      state: "down",
      detail: "Telegram is not configured in Hermes",
    }
  );
});
