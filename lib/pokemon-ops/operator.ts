import fs from "node:fs";
import path from "node:path";
import { all, get } from "@/db";
import { hasSecret } from "@/lib/secrets";

export type DiscordDeal = { id:number; source_guild_id:string|null; channel_id:string; message_id:string; product_text:string; price_cents:number|null; url:string|null; observed_at:string; matching_status:string; raw_excerpt:string };
export function discordDeals(limit = 100): DiscordDeal[] { return all<DiscordDeal>(`SELECT id,source_guild_id,channel_id,message_id,product_text,price_cents,url,observed_at,matching_status,substr(raw_excerpt,1,280) raw_excerpt FROM pk_discord_deals ORDER BY observed_at DESC,id DESC LIMIT ?`, limit); }

export function sourcingOperations() {
  const observations = all<any>(`SELECT o.id observation_id,o.product_id,p.set_name,p.display_name,o.source,o.observed_date,o.price_per_pack_cents,o.listing_ref,o.quantity_available,o.notes,b.price_per_pack_cents benchmark_cents,b.source benchmark_source FROM pk_price_observations o JOIN pk_products p ON p.id=o.product_id LEFT JOIN pk_v_benchmark_current b ON b.product_id=o.product_id WHERE o.id=(SELECT o2.id FROM pk_price_observations o2 WHERE o2.product_id=o.product_id AND o2.source=o.source ORDER BY o2.observed_date DESC,o2.id DESC LIMIT 1) ORDER BY o.observed_date DESC,o.id DESC`);
  const config = Object.fromEntries(all<{k:string;v:string}>(`SELECT k,v FROM pk_config`).map(r => [r.k, Number(r.v)]));
  const benchmarks = observations.filter(r => ["tcgplayer","ebay_sold","ebay_active"].includes(r.source));
  const offers = observations.filter(r => !["tcgplayer","ebay_sold","ebay_active"].includes(r.source)).map(r => ({ ...r, delta_cents: r.benchmark_cents == null ? null : r.price_per_pack_cents-r.benchmark_cents, decision: r.benchmark_cents == null ? "no-data" : ((r.benchmark_cents-r.price_per_pack_cents)/r.benchmark_cents)*100 >= (config.alert_threshold_pct || 15) ? "buy" : "hold" }));
  const vendorGroups = offers.reduce((map:Map<string,any[]>,row:any)=>map.set(row.source,[...(map.get(row.source)||[]),row]),new Map<string,any[]>());
  const vendors = Array.from(vendorGroups.entries()).map(([source,rows])=>{const best=[...rows].sort((a,b)=>a.price_per_pack_cents-b.price_per_pack_cents)[0];return {source,provider_name:source.replaceAll("_"," "),products_covered:[...new Set(rows.map(r=>r.display_name||r.set_name))],latest_quote:rows.map(r=>r.observed_date).sort().at(-1),best_price_cents:best.price_per_pack_cents,current_price_cents:best.price_per_pack_cents,delta_cents:best.delta_cents,listing_ref:best.listing_ref};});
  const bySource = all<any>(`SELECT source,COUNT(*) row_count,MAX(observed_date) latest FROM pk_price_observations GROUP BY source`);
  const sourceMap = new Map(bySource.map(r => [r.source,r]));
  const monitor = (id:string,label:string, sources:string[]) => { const rows=sources.map(s=>sourceMap.get(s)).filter(Boolean); const latest=rows.map((r:any)=>r.latest).sort().at(-1)||null; const age=latest ? Date.now()-Date.parse(latest) : Infinity; return { id,label,configured:rows.length>0,state:rows.length===0?"not_configured":age>7*86400000?"stale":"running",latest,row_count:rows.reduce((n:number,r:any)=>n+r.row_count,0) }; };
  const local = JSON.parse(fs.readFileSync(path.join(process.cwd(),"config/pokemon-local-spots.json"),"utf8"));
  const discord = discordDeals();
  const sourceProducts = all<any>(`SELECT * FROM pk_v_source_product_current ORDER BY set_name, form, name`);
  const sourceProductCoverage = all<any>(`
    SELECT p.set_name,
           MAX(o.observed_date) AS carddistro_observed_date,
           COUNT(DISTINCT sp.id) AS source_product_count,
           COUNT(DISTINCT current.source_product_id) AS valued_product_count
    FROM pk_products p
    JOIN pk_price_observations o ON o.product_id=p.id AND o.source='carddistro'
    LEFT JOIN pk_source_products sp ON sp.pack_product_id=p.id AND sp.active=1
    LEFT JOIN pk_v_source_product_current current ON current.source_product_id=sp.id
    WHERE p.form='booster' AND p.active=1
    GROUP BY p.set_name
    ORDER BY p.set_name
  `);
  return { offers, benchmarks, vendors, sourceProducts, sourceProductCoverage, local, discord, connector: { configured: hasSecret("DISCORD_BOT_TOKEN") && hasSecret("DISCORD_WATCH_CHANNEL_IDS"), channelsConfigured: hasSecret("DISCORD_WATCH_CHANNEL_IDS"), applicationConfigured: hasSecret("DISCORD_APPLICATION_ID") }, monitors: [monitor("tcgplayer","TCGplayer",["tcgplayer"]),monitor("ebay","eBay",["ebay_sold","ebay_active"]),monitor("providers","Provider quotes",["carddistro","supplier_other"]),monitor("retail","Retail restock",["costco","target","walmart","sams","amazon","retail_restock"]),{id:"local",label:"Local spots",configured:true,state:"configured",latest:local.provenance.checked_at,row_count:local.spots.length},{id:"discord",label:"Discord",configured:hasSecret("DISCORD_BOT_TOKEN")&&hasSecret("DISCORD_WATCH_CHANNEL_IDS"),state:hasSecret("DISCORD_BOT_TOKEN")&&hasSecret("DISCORD_WATCH_CHANNEL_IDS")?"configured":"not_configured",latest:discord[0]?.observed_at||null,row_count:discord.length}] };
}
