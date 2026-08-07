#!/usr/bin/env -S tsx
import { runCareerEmailSync } from "@/lib/career-scout";
runCareerEmailSync().then((result) => process.stdout.write(JSON.stringify(result)+"\n")).catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
