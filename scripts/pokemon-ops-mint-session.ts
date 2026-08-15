// Mints a valid NextAuth session-cookie value for an allowlisted test email.
// Smoke-test use only: not a route, adds no attack surface. Uses the same
// next-auth/jwt encode() + repo secrets loader the running server verifies
// against, so the printed value works as the __Secure-next-auth.session-token
// cookie against a locally booted `npm run start` (curl doesn't enforce the
// __Secure- cookie-name prefix that browsers do).
import { encode } from "next-auth/jwt";
import { allowedEmails, requireSecret } from "@/lib/secrets";

async function main() {
  const secret = requireSecret("NEXTAUTH_SECRET");
  const emails=allowedEmails();
  if(!emails.length)throw new Error("GOOGLE_ALLOWED_EMAILS is not configured");
  const requested=process.env.E2E_SESSION_EMAIL?.trim().toLowerCase();
  if(requested&&!emails.includes(requested))throw new Error("E2E_SESSION_EMAIL is not in GOOGLE_ALLOWED_EMAILS");
  const email=requested||emails[0];
  const token = { email, name: email.split("@")[0], picture: null, sub: email };
  const cookie = await encode({ token, secret, maxAge: 30 * 24 * 60 * 60 });
  process.stdout.write(cookie);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
