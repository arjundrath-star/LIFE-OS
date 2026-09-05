// Shared by the people domain and audit undo, without importing either back into the other.
import type { Person } from "@/lib/stern-types";
import { readNote, upsertNote } from "./vault-write";
type NotePerson = Pick<Person, "id" | "display_name" | "org" | "relationship_type" | "strength" | "status" | "notes">;
export function writePersonNote(p: NotePerson, undone = false, existingOnly = false) {
  const filename = `People/person-${p.id}.md`;
  // Preserve a human note after undoing its capture, but clearly mark it withdrawn.
  // Do not manufacture a tombstone when this capture never had a vault note.
  if ((undone || existingOnly) && readNote(filename) === null) return;
  return upsertNote(filename, { name: p.display_name, org: p.org, relationship: p.relationship_type, strength: p.strength, status: p.status, ...(undone ? { capture_undone: true } : {}) }, p.notes);
}
