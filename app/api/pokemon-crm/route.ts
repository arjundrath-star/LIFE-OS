import { NextResponse } from "next/server";
import { get } from "@/db";
import { requireUser } from "@/lib/guard";
import {
  pokemonCrmSnapshot,
  leadDetail,
  logTouchpoint,
  logPhoneCall,
  updatePhoneStatus,
  updateEmailStatus,
  updateLeadStage,
  updateLeadNotes,
  updateLeadNextAction,
  addContact,
  addPhone,
  cleanActor,
} from "@/lib/pokemon-crm";

export const dynamic = "force-dynamic";

function asId(v: unknown): number | null {
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET(req: Request) {
  if (!(await requireUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  if (url.searchParams.get("view") === "lead") {
    const id = asId(url.searchParams.get("id"));
    if (!id) return NextResponse.json({ error: "bad id" }, { status: 400 });
    const detail = leadDetail(id);
    if (!detail) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(detail);
  }
  return NextResponse.json(pokemonCrmSnapshot());
}

export async function POST(req: Request) {
  if (!(await requireUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const leadId = asId(body.leadId);
  const actor = cleanActor(body.actor);

  try {
    switch (body.action) {
      case "update_lead_stage": {
        if (!leadId) return NextResponse.json({ error: "leadId required" }, { status: 400 });
        updateLeadStage(leadId, String(body.stage));
        break;
      }
      case "update_lead_notes": {
        if (!leadId) return NextResponse.json({ error: "leadId required" }, { status: 400 });
        updateLeadNotes(leadId, body.notes);
        break;
      }
      case "update_lead_next_action": {
        if (!leadId) return NextResponse.json({ error: "leadId required" }, { status: 400 });
        updateLeadNextAction(leadId, body.next_action, body.next_action_due);
        break;
      }
      case "log_phone_call": {
        const phoneId = asId(body.phoneId);
        if (!leadId || !phoneId) {
          return NextResponse.json({ error: "leadId and phoneId required" }, { status: 400 });
        }
        logPhoneCall({
          leadId,
          phoneId,
          outcome: String(body.outcome),
          actor,
          notes: typeof body.notes === "string" ? body.notes : null,
        });
        break;
      }
      case "update_phone_status": {
        const phoneId = asId(body.phoneId);
        if (!phoneId) return NextResponse.json({ error: "phoneId required" }, { status: 400 });
        updatePhoneStatus(phoneId, String(body.status), body.notes);
        break;
      }
      case "update_email_status": {
        const emailId = asId(body.emailId);
        if (!leadId || !emailId) {
          return NextResponse.json({ error: "leadId and emailId required" }, { status: 400 });
        }
        updateEmailStatus({ leadId, emailId, status: String(body.status), actor });
        break;
      }
      case "log_visit":
      case "log_note":
      case "log_followup": {
        if (!leadId) return NextResponse.json({ error: "leadId required" }, { status: 400 });
        if (!get(`SELECT id FROM pokemon_leads WHERE id = ?`, leadId)) {
          return NextResponse.json({ error: "lead not found" }, { status: 404 });
        }
        const defaults: Record<string, { type: string; outcome: string }> = {
          log_visit: { type: "visit", outcome: "In-person visit" },
          log_note: { type: "note", outcome: "Manual note" },
          log_followup: { type: "followup", outcome: "Follow-up scheduled" },
        };
        const d = defaults[body.action];
        logTouchpoint({
          leadId,
          type: d.type,
          outcome: typeof body.outcome === "string" && body.outcome.trim() ? body.outcome : d.outcome,
          actor,
          notes: typeof body.notes === "string" ? body.notes : null,
          nextActionAt: typeof body.next === "string" ? body.next : null,
        });
        break;
      }
      case "add_contact": {
        if (!leadId) return NextResponse.json({ error: "leadId required" }, { status: 400 });
        if (!get(`SELECT id FROM pokemon_leads WHERE id = ?`, leadId)) {
          return NextResponse.json({ error: "lead not found" }, { status: 404 });
        }
        addContact(leadId, body.name, body.title);
        break;
      }
      case "add_phone": {
        const contactId = body.contactId == null ? null : asId(body.contactId);
        if (!leadId) return NextResponse.json({ error: "leadId required" }, { status: 400 });
        if (body.contactId != null && !contactId) {
          return NextResponse.json({ error: "bad contactId" }, { status: 400 });
        }
        if (contactId) {
          const c = get<any>(
            `SELECT id FROM pokemon_contacts WHERE id = ? AND lead_id = ?`,
            contactId,
            leadId
          );
          if (!c) return NextResponse.json({ error: "contact not on this lead" }, { status: 400 });
        } else if (!get(`SELECT id FROM pokemon_leads WHERE id = ?`, leadId)) {
          return NextResponse.json({ error: "lead not found" }, { status: 404 });
        }
        addPhone(leadId, contactId, body.phone);
        break;
      }
      default:
        return NextResponse.json({ error: "bad action" }, { status: 400 });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "write failed" }, { status: 400 });
  }

  // Return the fresh detail for the lead being worked (when known) so the client
  // can update in place without a second round trip.
  return NextResponse.json({ ok: true, detail: leadId ? leadDetail(leadId) : null });
}
