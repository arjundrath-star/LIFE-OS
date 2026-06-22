"use client";
import { SessionProvider } from "next-auth/react";
import { LiveProvider } from "@/hooks/useLiveData";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider refetchInterval={0} refetchOnWindowFocus={false}>
      <LiveProvider>{children}</LiveProvider>
    </SessionProvider>
  );
}
