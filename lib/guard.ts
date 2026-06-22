// Defense-in-depth session check for route handlers (middleware already gates /api/*).
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { allowedEmails } from "@/lib/secrets";

export async function requireUser(): Promise<{ email: string } | null> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase();
  if (!email || !allowedEmails().includes(email)) return null;
  return { email };
}
