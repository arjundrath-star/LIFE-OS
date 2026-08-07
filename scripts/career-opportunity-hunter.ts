#!/usr/bin/env -S tsx
import { runCareerOpportunityHunter } from "@/lib/career-scout";
runCareerOpportunityHunter().then((result) => process.stdout.write(JSON.stringify(result)+"\n")).catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
