import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { allowedEmails } from "@/lib/secrets";
import { Dashboard } from "@/components/Dashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase();
  if (!email || !allowedEmails().includes(email)) {
    redirect("/signin");
  }
  return (
    <Dashboard
      user={{
        email: session!.user!.email,
        name: session!.user!.name,
        picture: (session!.user as any).picture ?? (session!.user as any).image ?? null,
      }}
    />
  );
}
