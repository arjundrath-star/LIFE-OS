import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { allowedEmails } from "@/lib/secrets";
import { BusinessShell } from "@/components/business/BusinessShell";

export const dynamic = "force-dynamic";

export default async function BusinessLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase();
  if (!email || !allowedEmails().includes(email)) redirect("/signin");
  return <BusinessShell user={{ email: session!.user?.email, name: session!.user?.name, picture: (session!.user as any)?.picture ?? (session!.user as any)?.image ?? null }}>{children}</BusinessShell>;
}
