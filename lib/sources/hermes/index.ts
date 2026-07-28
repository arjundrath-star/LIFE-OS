// Hermes gateway adapter. Polls the gateway's /api/status JSON for process and
// platform health. HERMES_URL points at the gateway on the private network;
// the loopback default keeps local dev working without any config.
const HERMES_URL = process.env.HERMES_URL || "http://127.0.0.1:9119";

export type HermesPlatform = {
  name: string;
  state: string;
  error?: string | null;
  updatedAt?: string | null;
};

export type HermesStatus = {
  online: boolean;
  reachable: boolean;
  version: string | null;
  gatewayState: string | null;
  gatewayPid: number | null;
  activeSessions: number;
  platforms: HermesPlatform[];
  configVersion: number | null;
  latestConfigVersion: number | null;
  updatedAt: string | null;
  checkedAt: string;
  error?: string;
};

export async function fetchHermesStatus(): Promise<HermesStatus> {
  const checkedAt = new Date().toISOString();
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(`${HERMES_URL}/api/status`, {
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(t);
    if (!res.ok) {
      return base(checkedAt, false, `status ${res.status}`);
    }
    const j: any = await res.json();
    const platforms: HermesPlatform[] = Object.entries(j.gateway_platforms || {}).map(
      ([name, v]: [string, any]) => ({
        name,
        state: v?.state ?? "unknown",
        error: v?.error_message ?? null,
        updatedAt: v?.updated_at ?? null,
      })
    );
    const online = !!j.gateway_running && j.gateway_state === "running";
    return {
      online,
      reachable: true,
      version: j.version ?? null,
      gatewayState: j.gateway_state ?? null,
      gatewayPid: j.gateway_pid ?? null,
      activeSessions: Number(j.active_sessions ?? 0),
      platforms,
      configVersion: j.config_version ?? null,
      latestConfigVersion: j.latest_config_version ?? null,
      updatedAt: j.gateway_updated_at ?? null,
      checkedAt,
    };
  } catch (err: any) {
    return base(checkedAt, false, err?.name === "AbortError" ? "timeout" : String(err?.message || err));
  }
}

function base(checkedAt: string, reachable: boolean, error?: string): HermesStatus {
  return {
    online: false,
    reachable,
    version: null,
    gatewayState: null,
    gatewayPid: null,
    activeSessions: 0,
    platforms: [],
    configVersion: null,
    latestConfigVersion: null,
    updatedAt: null,
    checkedAt,
    error,
  };
}
