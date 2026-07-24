// Telegram health adapter. Uses the live Hermes dashboard status response so the
// Rathworkspace card reflects the gateway that actually owns the Telegram bot.
import type { HermesPlatform, HermesStatus } from "@/lib/sources/hermes";

export type TelegramActivity = {
  reachable: boolean;
  healthy: boolean;
  state: "active" | "conflict" | "idle" | "down";
  detail: string;
  lastEventAt: string | null;
  lastEvent: string | null;
  events: { ts: string; message: string }[];
  errorRate: number;
  checkedAt: string;
};

type HermesTelegramStatus = Pick<
  HermesStatus,
  "online" | "reachable" | "platforms"
>;

type TelegramGatewayHealth = Pick<
  TelegramActivity,
  "reachable" | "healthy" | "state" | "detail"
>;

const CONNECTED_STATES = new Set(["active", "connected", "ready", "running"]);

export function telegramGatewayHealth(
  hermes: HermesTelegramStatus
): TelegramGatewayHealth {
  if (!hermes.reachable) {
    return {
      reachable: false,
      healthy: false,
      state: "down",
      detail: "Hermes status endpoint unreachable",
    };
  }

  if (!hermes.online) {
    return {
      reachable: true,
      healthy: false,
      state: "down",
      detail: "Hermes gateway offline",
    };
  }

  const platform = hermes.platforms.find(
    (candidate) => candidate.name.toLowerCase() === "telegram"
  );
  if (!platform) {
    return {
      reachable: true,
      healthy: false,
      state: "down",
      detail: "Telegram is not configured in Hermes",
    };
  }

  return platformHealth(platform);
}

function platformHealth(platform: HermesPlatform): TelegramGatewayHealth {
  const state = platform.state.toLowerCase();
  const detail = platform.error || `Telegram gateway ${platform.state}`;

  if (/conflict|409/.test(`${state} ${platform.error || ""}`.toLowerCase())) {
    return {
      reachable: true,
      healthy: false,
      state: "conflict",
      detail,
    };
  }

  if (CONNECTED_STATES.has(state)) {
    return {
      reachable: true,
      healthy: true,
      state: "idle",
      detail: "connected via Hermes gateway",
    };
  }

  return {
    reachable: true,
    healthy: false,
    state: "down",
    detail,
  };
}

export function readTelegramActivity(hermes: HermesStatus): TelegramActivity {
  return {
    ...telegramGatewayHealth(hermes),
    lastEventAt: null,
    lastEvent: null,
    events: [],
    errorRate: 0,
    checkedAt: new Date().toISOString(),
  };
}
