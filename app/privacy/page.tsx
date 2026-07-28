import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy · rathworkspace",
  description: "How rathworkspace handles connected-account data.",
};

// Public page (exempt from the auth gate in middleware.ts). Plain static text: no
// data, no live channels. Serves as the privacy-policy URL for connected apps such
// as WHOOP, which presents this link during the OAuth consent flow.
// The contact address is build-time config so the operator's real mailbox is not
// baked into source. OAuth reviewers require a working address here, so set it.
const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL || "operator@example.com";

export default function PrivacyPage() {
  const updated = "June 24, 2026";
  return (
    <main className="mx-auto min-h-screen max-w-2xl px-6 py-16">
      <div className="mb-10">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-inner border border-accent/40 bg-accent/5 shadow-glow-sm">
          <span className="font-mono text-lg font-bold text-accent text-glow">R</span>
        </div>
        <h1 className="font-mono text-2xl tracking-tight text-txt-primary">Privacy Policy</h1>
        <p className="mt-1 text-sm text-txt-faint">rathworkspace · last updated {updated}</p>
      </div>

      <div className="space-y-7 text-sm leading-relaxed text-txt-muted">
        <section>
          <p>
            rathworkspace is a private, single-user personal dashboard operated by Arjun Rath for his own
            use. It is not a commercial product and has no other users. Access is restricted to the owner
            by Google sign-in. This page explains what data the app handles when the owner connects an
            external account such as WHOOP.
          </p>
        </section>

        <section>
          <h2 className="mb-2 font-mono text-xs uppercase tracking-[0.14em] text-txt-faint">What we access</h2>
          <p>
            When the owner authorizes WHOOP, the app reads the owner&apos;s own WHOOP data through the WHOOP
            API: recovery, sleep, strain and physiological cycle data, heart-rate variability and resting
            heart rate, workout data, and basic profile information (name and email). The app only ever
            reads the owner&apos;s own account. It does not write to WHOOP and does not access anyone
            else&apos;s data.
          </p>
        </section>

        <section>
          <h2 className="mb-2 font-mono text-xs uppercase tracking-[0.14em] text-txt-faint">How it is stored and used</h2>
          <p>
            Data is stored on a private server controlled by the owner and is displayed only to the
            authenticated owner inside the dashboard. Authorization tokens are encrypted at rest. The data
            is used solely to show the owner their own health metrics. It is never sold, never shared with
            third parties, and never used for advertising or profiling.
          </p>
        </section>

        <section>
          <h2 className="mb-2 font-mono text-xs uppercase tracking-[0.14em] text-txt-faint">Retention and revoking access</h2>
          <p>
            Connected data is retained until the owner disconnects the integration or deletes it. The owner
            can revoke this app&apos;s access at any time from WHOOP account settings (app connections), or
            by removing the integration in the dashboard, which deletes the stored tokens.
          </p>
        </section>

        <section>
          <h2 className="mb-2 font-mono text-xs uppercase tracking-[0.14em] text-txt-faint">Contact</h2>
          <p>
            Questions about this policy can be sent to{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-accent underline-offset-2 hover:underline">
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </section>
      </div>
    </main>
  );
}
