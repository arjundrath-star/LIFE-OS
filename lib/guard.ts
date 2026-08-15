// Defense-in-depth session check for route handlers (middleware already gates /api/*).
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { allowedEmails, healthAllowedEmails } from "@/lib/secrets";
import { connectionAccessForEmail, type ConnectionAccess } from "@/lib/connections/access";

export async function requireUser(): Promise<{ email: string } | null> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase();
  if (!email || !allowedEmails().includes(email)) return null;
  return { email };
}

export async function requireHealthUser(): Promise<{ email: string } | null> {
  const user = await requireUser();
  if (!user || !healthAllowedEmails().includes(user.email)) return null;
  return user;
}

export async function requireConnectionAccess(): Promise<ConnectionAccess | null> {
  const user = await requireUser();
  return user ? connectionAccessForEmail(user.email, healthAllowedEmails()) : null;
}
