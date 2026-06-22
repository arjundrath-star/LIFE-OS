// Obsidian command-center vault adapter. Read-mostly. Powers the Projects module
// and any note rendering. Never writes destructively.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const VAULT =
  process.env.COMMAND_CENTER_VAULT || path.join(os.homedir(), "command-center");

// Folders that are not "projects" (handled by their own modules or noise).
const NOT_PROJECTS = new Set([
  ".git",
  ".obsidian",
  ".claude",
  ".hermes",
  ".trash",
  "scripts",
  "Daily",
  "Health",
  "Assistant",
  "Hermes",
  "jewel_machine_images",
]);

export type ProjectCard = {
  name: string;
  slug: string;
  fileCount: number;
  latestFile: string | null;
  latestModified: string | null; // ISO
  preview: string | null;
};

function walkMd(dir: string, acc: { file: string; mtime: number }[], depth = 0) {
  if (depth > 4) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules") continue;
      walkMd(full, acc, depth + 1);
    } else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) {
      try {
        const st = fs.statSync(full);
        acc.push({ file: full, mtime: st.mtimeMs });
      } catch {
        /* skip */
      }
    }
  }
}

function firstMeaningfulLine(file: string): string | null {
  try {
    const txt = fs.readFileSync(file, "utf8").slice(0, 4000);
    const lines = txt.split("\n");
    let inFrontmatter = false;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i].trim();
      if (i === 0 && l === "---") {
        inFrontmatter = true;
        continue;
      }
      if (inFrontmatter) {
        if (l === "---") inFrontmatter = false;
        continue;
      }
      const clean = l.replace(/^#+\s*/, "").replace(/[*_`>]/g, "").trim();
      if (clean.length > 2) return clean.slice(0, 140);
    }
  } catch {
    /* skip */
  }
  return null;
}

export function listProjects(): ProjectCard[] {
  let dirs: fs.Dirent[];
  try {
    dirs = fs.readdirSync(VAULT, { withFileTypes: true });
  } catch {
    return [];
  }
  const cards: ProjectCard[] = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    if (d.name.startsWith(".") || NOT_PROJECTS.has(d.name)) continue;
    const dir = path.join(VAULT, d.name);
    const files: { file: string; mtime: number }[] = [];
    walkMd(dir, files);
    files.sort((a, b) => b.mtime - a.mtime);
    const latest = files[0];
    cards.push({
      name: d.name,
      slug: d.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      fileCount: files.length,
      latestFile: latest ? path.basename(latest.file) : null,
      latestModified: latest ? new Date(latest.mtime).toISOString() : null,
      preview: latest ? firstMeaningfulLine(latest.file) : null,
    });
  }
  cards.sort((a, b) => {
    const ta = a.latestModified ? Date.parse(a.latestModified) : 0;
    const tb = b.latestModified ? Date.parse(b.latestModified) : 0;
    return tb - ta;
  });
  return cards;
}

export function vaultRoot() {
  return VAULT;
}
