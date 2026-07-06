// Recompute Pokemon-specific fit scores for existing CRM rows.
// Usage: npx tsx scripts/rerank-pokemon-crm.ts
import { getDb, pushEvent } from "@/db";
import { ownerAccessScore, pokemonFitScore } from "@/lib/pokemon-fit";

const db = getDb();
const rows = db
  .prepare(
    `SELECT id, venue_name, category, vending_score, rating, reviews
     FROM pokemon_leads`
  )
  .all() as Array<{
  id: number;
  venue_name: string;
  category: string | null;
  vending_score: number | null;
  rating: number | null;
  reviews: number | null;
}>;

const update = db.prepare(
  `UPDATE pokemon_leads
      SET pokemon_fit_score = ?, owner_access_score = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id = ?`
);

const tx = db.transaction(() => {
  for (const row of rows) {
    update.run(pokemonFitScore(row), ownerAccessScore(row), row.id);
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
