// Recompute Pokemon-specific fit scores for existing CRM rows.
// Usage: npx tsx scripts/rerank-pokemon-crm.ts
import { getDb, pushEvent } from "@/db";
import { ownerAccessScore, pokemonFitScore } from "@/lib/pokemon-fit";

const db = getDb();
const rows = db
  .prepare(
    `SELECT l.id, l.venue_name, l.category, l.vending_score, l.rating, l.reviews,
            l.address, l.website,
            EXISTS(SELECT 1 FROM pokemon_contacts c WHERE c.lead_id = l.id) AS has_owner_name,
            EXISTS(SELECT 1 FROM pokemon_phone_numbers p WHERE p.lead_id = l.id AND p.phone_type = 'owner_candidate') AS has_owner_phone,
            EXISTS(SELECT 1 FROM pokemon_phone_numbers p WHERE p.lead_id = l.id) AS has_phone,
            EXISTS(SELECT 1 FROM pokemon_emails e WHERE e.lead_id = l.id) AS has_email
       FROM pokemon_leads l`
  )
  .all() as Array<{
  id: number;
  venue_name: string;
  category: string | null;
  vending_score: number | null;
  rating: number | null;
  reviews: number | null;
  address: string | null;
  website: string | null;
  has_owner_name: number;
  has_owner_phone: number;
  has_phone: number;
  has_email: number;
}>;

const update = db.prepare(
  `UPDATE pokemon_leads
      SET pokemon_fit_score = ?, owner_access_score = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id = ?`
);

const tx = db.transaction(() => {
  for (const row of rows) {
    const input = {
      ...row,
      has_owner_name: !!row.has_owner_name,
      has_owner_phone: !!row.has_owner_phone,
      has_phone: !!row.has_phone,
      has_email: !!row.has_email,
      has_address: !!row.address,
      has_website: !!row.website,
    };
    update.run(pokemonFitScore(input), ownerAccessScore(input), row.id);
  }
});

tx.immediate();
pushEvent("pokemon-crm", `reranked ${rows.length} leads with Pokemon-specific fit scores`, "success");

const top = db
  .prepare(
    `SELECT venue_name, category, vending_score, pokemon_fit_score
       FROM pokemon_leads
      ORDER BY pokemon_fit_score DESC, vending_score DESC, venue_name
      LIMIT 12`
  )
  .all();

console.log(JSON.stringify({ reranked: rows.length, top }, null, 2));
