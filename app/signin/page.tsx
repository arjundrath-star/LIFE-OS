import { SignInButton } from "./SignInButton";

export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const sp = await searchParams;
  const error = sp.error;
  const callbackUrl = sp.callbackUrl || "/";

  const denied = error === "AccessDenied";

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm animate-fade-in">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-inner border border-accent/40 bg-accent/5 shadow-glow-sm">
            <span className="font-mono text-lg font-bold text-accent text-glow">R</span>
          </div>
          <h1 className="font-mono text-xl tracking-tight text-txt-primary">rathworkspace</h1>
          <p className="mt-1 text-sm text-txt-faint">command center · restricted access</p>
        </div>

        <div className="rounded-panel border border-border bg-panel p-6 shadow-panel panel-hairline">
          {denied ? (
            <div className="mb-4 rounded-inner border border-error/40 bg-error/10 px-4 py-3 text-sm text-error">
              That Google account is not on the allowlist. Sign in with an approved
              account.
            </div>
          ) : error ? (
            <div className="mb-4 rounded-inner border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn">
              Sign-in failed ({error}). Try again.
            </div>
          ) : null}

          <SignInButton callbackUrl={callbackUrl} />

          <p className="mt-4 text-center text-xs leading-relaxed text-txt-faint">
            Access is limited to a fixed set of Google accounts. Everything behind this
            gate is private.
          </p>
        </div>
      </div>
    </main>
  );
}
