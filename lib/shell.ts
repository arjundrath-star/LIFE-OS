// Tiny shell helper for cheap health checks (tailscale, systemctl). Server-only.
import { execFile } from "node:child_process";

export function run(
  cmd: string,
  args: string[],
  timeoutMs = 4000
): Promise<{ ok: boolean; stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        stdout: stdout?.toString() ?? "",
        stderr: stderr?.toString() ?? "",
        code: err && typeof (err as any).code === "number" ? (err as any).code : err ? 1 : 0,
      });
    });
  });
}
