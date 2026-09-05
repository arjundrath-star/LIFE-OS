import { NextResponse } from "next/server";
import { requireUser } from "@/lib/guard";
import * as people from "@/lib/stern/people";
import { newBatchId } from "@/lib/stern/audit";
import { broadcastStern } from "@/lib/stern/snapshot";
import { SternError, toErrorResponse } from "@/lib/stern/errors";
import type { PeopleFilters } from "@/lib/stern-types";
export const dynamic = "force-dynamic";
function failure(error: unknown) {
  const known = toErrorResponse(error);
  return NextResponse.json({ error: known.message }, { status: known.status });
}
function filtersFrom(params: URLSearchParams): PeopleFilters {
  const array = (key: string) => params.getAll(key).flatMap(v => v.split(",")).filter(Boolean);
  return { q: params.get("q") || "", relationshipType: array("relationshipType"), status: array("status"), strengthMin: params.has("strengthMin") ? Number(params.get("strengthMin")) : undefined, clubId: params.has("clubId") ? Number(params.get("clubId")) : undefined, sphere: params.get("sphere") || "", followUpOwed: params.get("followUpOwed") === "1" || params.get("followUpOwed") === "true", archived: params.get("archived") === "1" || params.get("archived") === "true", sort: (params.get("sort") || "name") as PeopleFilters["sort"], page: params.has("page") ? Number(params.get("page")) : 1 };
}
export async function GET(req: Request) {
  if (!(await requireUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const params = new URL(req.url).searchParams;
    if (params.has("person")) return NextResponse.json(people.getPerson(Number(params.get("person"))));
    const filters = filtersFrom(params);
    if (params.has("export")) {
      const format = params.get("export");
      if (format !== "csv" && format !== "json") throw new SternError(400, "Invalid export format");
      return new Response(people.exportPeople(format, filters), { headers: { "Content-Type": format === "csv" ? "text/csv; charset=utf-8" : "application/json", "Content-Disposition": `attachment; filename="stern-people.${format}"`, "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ ...people.networkSnapshot(), ...people.listPeople(filters), clubs: people.clubPicker() });
  } catch (error) { return failure(error); }
}
export async function POST(req: Request) {
  if (!(await requireUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const body = await req.json().catch(() => { throw new SternError(400, "Invalid JSON"); });
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new SternError(400, "Expected an object");
    const m = { source: "manual", batchId: newBatchId("network") }, id = Number(body.id ?? body.personId);
    const result = people.peopleWrite(() => {
      switch (body.action) {
        case "person.create": {
          const created = people.createPerson({ ...(body.person || body), source: "manual" }, m);
          if (body.affiliation) people.addAffiliation(created.person.id, body.affiliation, m);
          return created;
        }
        case "person.update": return people.updatePerson(id, body.patch, m);
        case "person.set_status": return people.setStatus(id, body.status, m);
        case "person.set_relationship": return people.setRelationship(id, body.relationshipType ?? body.type, body.strength, m);
        case "person.upgrade_friend": return people.upgradeToFriend(id, m);
        case "person.merge": return people.mergePeople(Number(body.keepId), Number(body.dropId), m);
        case "person.archive": return people.archivePerson(id, m);
        case "affiliation.add": return people.addAffiliation(Number(body.personId), body.affiliation || body, m);
        case "affiliation.update": return people.updateAffiliation(id, body.patch, m);
        case "affiliation.remove": return people.removeAffiliation(id, m) ?? { removed: true };
        case "touchpoint.add": return people.addTouchpoint(Number(body.personId), body.kind || "note", { ...(body.touchpoint || body), source: "manual" }, m);
        case "people.import": return people.importPeople(body.people, m);
        default: throw new SternError(400, "Unknown network action");
      }
    });
    return NextResponse.json({ result, batchId: m.batchId, snapshot: broadcastStern() });
  } catch (error) { return failure(error); }
}
