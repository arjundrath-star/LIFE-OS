// Shared shell for the whole dashboard. Server-side session + allowlist check
// (defense in depth; middleware.ts already gates every route, including this group).
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { allowedEmails } from "@/lib/secrets";
import { DashShell } from "@/components/shell/DashShell";

export const dynamic = "force-dynamic";

export default async function DashLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase();
  if (!email || !allowedEmails().includes(email)) {
    redirect("/signin");
  }
  const user = {
    email: session!.user!.email,
    name: session!.user!.name,
    picture: (session!.user as any).picture ?? (session!.user as any).image ?? null,
  };
  return <DashShell user={user}>{children}</DashShell>;
}
