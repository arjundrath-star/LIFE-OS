"use client";
import { ProjectPage, HeroStat } from "@/components/shell/ProjectPage";
import { HealthPanel } from "@/components/panels/HealthPanel";
import { Activity } from "lucide-react";

export default function HealthPage() {
  return (
    <ProjectPage
      title="Health"
      icon={<Activity size={18} />}
      subtitle="Whoop recovery, sleep, and strain. Honest connect-me until the developer app is created — never fabricated vitals."
      statusDot="off"
      statusLabel="Whoop not connected"
      hero={
        <div className="grid gap-3 sm:grid-cols-4">
          <HeroStat label="Recovery" value="—%" tone="muted" />
          <HeroStat label="Sleep" value="—h" tone="muted" />
          <HeroStat label="Strain" value="—" tone="muted" />
          <HeroStat label="HRV / RHR" value="—" tone="muted" />
        </div>
      }
    >
      <HealthPanel />
    </ProjectPage>
  );
}
