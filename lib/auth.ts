// NextAuth gate config. Google sign-in restricted to GOOGLE_ALLOWED_EMAILS.
// Minimal scopes here (identity only) — Gmail/Calendar READ is a SEPARATE flow
// (lib/sources/google) so logging in never forces a restricted-scope grant.
import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { requireSecret, allowedEmails } from "@/lib/secrets";

export const authOptions: NextAuthOptions = {
  secret: requireSecret("NEXTAUTH_SECRET"),
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  providers: [
    GoogleProvider({
      clientId: requireSecret("GOOGLE_CLIENT_ID"),
      clientSecret: requireSecret("GOOGLE_CLIENT_SECRET"),
      authorization: {
        params: { prompt: "select_account", scope: "openid email profile" },
      },
    }),
  ],
  pages: { signIn: "/signin", error: "/signin" },
  callbacks: {
    // The allowlist gate. This is the single source of truth for who gets in.
    async signIn({ user }) {
      const email = user.email?.toLowerCase();
      if (!email) return false;
      return allowedEmails().includes(email);
    },
    async jwt({ token, profile }) {
      if (profile && (profile as any).picture) token.picture = (profile as any).picture;
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).picture = token.picture ?? null;
        // re-assert allowlist at session read time (defense in depth)
        const email = session.user.email?.toLowerCase();
        (session as any).allowed = !!email && allowedEmails().includes(email);
      }
      return session;
    },
  },
};
