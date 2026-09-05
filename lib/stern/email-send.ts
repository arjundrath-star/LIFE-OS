import { execFile } from "node:child_process";
import { promisify } from "node:util";
export type NotificationRunner = (file: string, args: string[], options: { timeout: number; env: Record<string, string | undefined>; maxBuffer: number }) => Promise<{ stdout: string }>;
const execFileAsync = promisify(execFile);
export const notificationRunner: NotificationRunner = async (file, args, options) => {
  // Next augments ProcessEnv with a required NODE_ENV, which child processes do not need.
  const result = await execFileAsync(file, args, { ...options, env: options.env as NodeJS.ProcessEnv, encoding: "utf8", shell: false });
  return { stdout: result.stdout };
};
export function runnerOptions() {
  return { timeout: 20_000, maxBuffer: 1024 * 1024, env: { HOME: process.env.HOME, LANG: process.env.LANG ?? "C.UTF-8", PATH: `/home/Arjun/.local/bin:/home/Arjun/.npm-global/bin:${process.env.PATH || "/usr/bin:/bin"}` } };
}
// Same Python EmailMessage / URL-safe MIME / gws transport as stern-build/email.sh.
const MIME = `import sys, base64
from email.message import EmailMessage
m = EmailMessage()
m['From'] = 'Arjun Rath <arjun@kladeai.com>'
m['To'] = sys.argv[1]
m['Subject'] = '[Stern] ' + sys.argv[2]
m.set_content(sys.argv[3])
print(base64.urlsafe_b64encode(m.as_bytes()).decode())`;
export async function sendEmail(to: string, subject: string, body: string, runner: NotificationRunner = notificationRunner) {
  const options = runnerOptions();
  const mime = await runner("python3", ["-c", MIME, to, subject, body], options);
  const raw = mime.stdout.trim();
  if (!/^[A-Za-z0-9_=-]+$/.test(raw)) throw new Error("Invalid MIME output");
  await runner("gws", ["gmail", "users", "messages", "send", "--params", JSON.stringify({ userId: "me" }), "--json", JSON.stringify({ raw })],
    { ...options, env: { ...options.env, GOOGLE_WORKSPACE_CLI_CONFIG_DIR: "/home/Arjun/.config/gws-arjun" } });
}
