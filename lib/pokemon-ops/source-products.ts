import fs from "node:fs";
import path from "node:path";
import { getDb } from "@/db";

export const SOURCE_TARGET_BPS = { low: 7500, medium: 8000, high: 8500 } as const;

export const SET_NAME_TO_TCG_GROUP: Record<string, number | null> = {
  "Phantasmal Flames": 24448,
  "Mega Evolution": 24380,
  "Destined Rivals": 24269,
  "Journey Together": 24073,
  "Paldean Fates": 23353,
  "151": 23237,
  "Pitch Black": 24688,
  "Chaos Rising": 24655,
  "Perfect Order": 24587,
  "Ascended Heroes": 24541,
  "White Flare": 24326,
  "Black Bolt": 24325,
  "Surging Sparks": 23651,
  "Prismatic Evolutions": 23821,
  "Storm Emerald": null,
};

interface TcgProduct {
  productId: number;
  name: string;
  url: string;
  extendedData?: Array<{ name?: string; value?: string }>;
}
interface TcgPrice {
  productId: number;
  lowPrice?: number | null;
  midPrice?: number | null;
  highPrice?: number | null;
  marketPrice?: number | null;
}
interface TcgEnvelope<T> { results: T[] }

export interface ClassifiedSourceProduct {
  form: string;
  packCount: number;
  packCountNote: string;
}

const excluded = [
  /^Code Card\s*-/i,
  /(?:Booster|Sleeved Booster) Pack Art Bundle \[Set of/i,
  /International Tin/i,
  /Binder\s*&\s*Unova Poster/i,
  /^Unova /i,
  /Mega Heroes/i,
  /\[Set of/i,
  /Costco|Sam's Club 151/i,
  /Booster Bundle \+ Surprise Box/i,
];

const countWords: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fourteen: 14,
  fifteen: 15, sixteen: 16, eighteen: 18, twenty: 20,
};

function numericCount(value: string): number | null {
  if (/^\d+$/.test(value)) return Number(value);
  return countWords[value.toLowerCase()] ?? null;
}

function packCountFromDescription(setName: string, text?: string): number | null {
  if (!text) return null;
  const clean = text.replace(/<[^>]+>/g, " ").replace(/&nbsp;|\u00a0/g, " ").replace(/\s+/g, " ");
  if (!clean.toLowerCase().includes(setName.toLowerCase())) return null;
  if (/assorted booster packs|variety of booster packs|booster packs vary by product/i.test(clean)) return null;

  const directCase = clean.match(/case contains\s+(\d+)\s+booster packs/i);
  if (directCase) return Number(directCase[1]);
  const boxes = clean.match(/case contains\s+(\d+)\s+boxes of\s+(\d+)\s+packs each/i);
  if (boxes) return Number(boxes[1]) * Number(boxes[2]);
  const bundleCase = clean.match(/case contains\s+(\d+)\s+(?:bundle boxes|booster bundles)/i);
  if (bundleCase) return Number(bundleCase[1]) * 6;
  const blisterCase = clean.match(/case contains\s+(\d+)\s+(\d+)[- ]pack blisters/i);
  if (blisterCase) return Number(blisterCase[1]) * Number(blisterCase[2]);

  const matches = [...clean.matchAll(/(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fourteen|fifteen|sixteen|eighteen|twenty)\s+(?:Pok[eé]mon\s*(?:TCG|•)?[^.]{0,100}?)?booster packs/gi)];
  const counts = matches.map((match) => numericCount(match[1])).filter((value): value is number => value !== null && value > 0 && value <= 30);
  return counts.length ? counts[counts.length - 1] : null;
}

function fixed(form: string, packCount: number, note: string): ClassifiedSourceProduct {
  return { form, packCount, packCountNote: note };
}

/**
 * Deliberately allow-listed. Products with mixed/variable pack assortments are
 * excluded rather than guessed. Every included format contains only the named
 * set's English boosters; promos/accessories are valued at $0.
 */
export function classifySourceProduct(setName: string, name: string, cardText?: string): ClassifiedSourceProduct | null {
  if (excluded.some((pattern) => pattern.test(name))) return null;

  if (/Pokemon Center Elite Trainer Box Case/i.test(name)) {
    return fixed("pokemon_center_etb_case", 44, "Factory case: 4 Pokémon Center ETBs × 11 named-set boosters; extras valued at $0.");
  }
  if (/Elite Trainer Box Case/i.test(name)) {
    return fixed("elite_trainer_box_case", 90, "Factory case: 10 ETBs × 9 named-set boosters; extras valued at $0.");
  }
  if (/(?:Enhanced )?Booster Box Case/i.test(name)) {
    return fixed("booster_box_case", 216, "Factory case: 6 booster boxes × 36 named-set boosters.");
  }
  if (/Booster Bundle Case/i.test(name)) {
    return fixed("booster_bundle_case", 150, "Factory case: 25 Booster Bundles × 6 named-set boosters.");
  }
  if (/3[- ]Pack Blister Case/i.test(name)) {
    return fixed("three_pack_blister_case", 72, "Factory case: 24 three-pack blisters, 72 named-set boosters; promos valued at $0.");
  }
  if (/Sleeved Booster Case/i.test(name)) {
    const count = /48\s*ct/i.test(name) ? 48 : 144;
    return fixed("sleeved_booster_case", count, `Factory sleeved-booster case: ${count} named-set boosters.`);
  }
  if (/\bCase\b/i.test(name)) return null;

  if (/Pokemon Center Elite Trainer Box/i.test(name)) {
    return fixed("pokemon_center_etb", 11, "Pokémon Center ETB fixed format: 11 named-set boosters; extras valued at $0.");
  }
  if (/Elite Trainer Box/i.test(name)) {
    return fixed("elite_trainer_box", 9, "ETB fixed format: 9 named-set boosters; extras valued at $0.");
  }
  if (/Half Booster Box(?:es)?$/i.test(name)) {
    return fixed("half_booster_box", 18, "English half booster box: 18 named-set boosters.");
  }
  if (/Enhanced Booster Box$/i.test(name)) {
    return fixed("enhanced_booster_box", 36, "Enhanced English booster box: 36 named-set boosters; extras valued at $0.");
  }
  if (/Booster Box$/i.test(name)) {
    return fixed("booster_box", 36, "English booster box: 36 named-set boosters.");
  }
  if (/Booster Bundle Display$/i.test(name)) {
    return fixed("booster_bundle_display", 60, "Factory Booster Bundle display: 10 six-pack bundles, 60 named-set boosters total.");
  }
  if (/Booster Bundle(?: \([^)]*\))?$/i.test(name)) {
    return fixed("booster_bundle", 6, "Booster Bundle fixed format: 6 named-set boosters.");
  }
  if (/Build\s*(?:&|and)\s*Battle (?:Box )?Display$/i.test(name)) {
    return fixed("build_battle_display", 40, "Factory Build & Battle display: 10 four-pack boxes, 40 named-set boosters total; deck/promos valued at $0.");
  }
  if (/Build\s*(?:&|and)\s*Battle Box$/i.test(name)) {
    return fixed("build_battle_box", 4, "Build & Battle Box fixed format: 4 named-set boosters; deck/promos valued at $0.");
  }
  if (/3[- ]Pack Blister/i.test(name)) {
    return fixed("three_pack_blister", 3, "3-Pack Blister fixed format: 3 named-set boosters; promo/coin valued at $0.");
  }
  if (/Single Pack Blister|Premium Checklane Blister/i.test(name)) {
    return fixed("single_pack_blister", 1, "Single-pack blister/checklane: 1 named-set booster; promo/coin valued at $0.");
  }
  if (/Sleeved Booster Pack$/i.test(name)) {
    return fixed("sleeved_booster", 1, "Sleeved booster: 1 named-set booster; outer sleeve valued at $0.");
  }
  if (/Tech Sticker Collection/i.test(name)) {
    return fixed("tech_sticker_collection", 3, "Tech Sticker Collection: 3 named-set boosters; promo/sticker valued at $0.");
  }
  if (setName === "151" && /151 Poster Collection$/i.test(name)) {
    return fixed("poster_collection", 3, "151 Poster Collection: 3 named-set boosters; promo/poster valued at $0.");
  }
  if (setName === "Prismatic Evolutions" && /Poster Collection$/i.test(name)) {
    return fixed("poster_collection", 3, "Prismatic Evolutions Poster Collection: 3 named-set boosters; promo/poster valued at $0.");
  }
  if (setName === "Ascended Heroes" && /Premium Poster Collection/i.test(name)) {
    return fixed("premium_poster_collection", 10, "Ascended Heroes Premium Poster Collection: 10 named-set boosters; promo/poster valued at $0.");
  }
  if (/Binder Collection$/i.test(name)) {
    const count = setName === "151" ? 4 : 5;
    return fixed("binder_collection", count, `${setName} Binder Collection: ${count} named-set boosters; binder valued at $0.`);
  }
  if (["Paldean Fates", "151", "Prismatic Evolutions", "Ascended Heroes"].includes(setName) && /Mini Tin \[/i.test(name)) {
    return fixed("mini_tin", 2, `${setName} Mini Tin: 2 named-set boosters; tin/art card valued at $0.`);
  }
  if (setName === "Ascended Heroes" && /Mini Tins 5-Pack/i.test(name)) {
    return fixed("mini_tin_multipack", 10, "Five Ascended Heroes Mini Tins × 2 boosters; tins/extras valued at $0.");
  }
  if (["151", "Paldean Fates", "Ascended Heroes"].includes(setName) && /Mini Tin Display$/i.test(name)) {
    return fixed("mini_tin_display", 20, `Factory ${setName} Mini Tin display: 10 tins × 2 boosters; tins/extras valued at $0.`);
  }
  if (setName === "Prismatic Evolutions" && /Mini Tin Display$/i.test(name)) {
    return fixed("mini_tin_display", 16, "Factory Prismatic Evolutions Mini Tin display: 8 tins × 2 boosters; tins/extras valued at $0.");
  }
  if (setName === "Paldean Fates" && /Paldean Fates Tin \[/i.test(name)) {
    return fixed("tin", 5, "Paldean Fates Tin: 5 named-set boosters; promo/tin valued at $0.");
  }
  if (setName === "Ascended Heroes" && /Ascended Heroes Tin \[/i.test(name)) {
    return fixed("tin", 4, "Ascended Heroes Tin: 4 named-set boosters; promo/tin valued at $0.");
  }
  if (setName === "Paldean Fates" && /Premium Collection \[/i.test(name)) {
    return fixed("premium_collection", 8, "Paldean Fates Pokémon ex Premium Collection: 8 named-set boosters; extras valued at $0.");
  }
  if (setName === "Paldean Fates" && /Great Tusk ex & Iron Treads ex Premium Collection/i.test(name)) {
    return fixed("premium_collection", 11, "Paldean Fates dual Premium Collection: 11 named-set boosters; extras valued at $0.");
  }
  if (setName === "151" && /Ultra-Premium Collection$/i.test(name)) {
    return fixed("ultra_premium_collection", 16, "151 Ultra-Premium Collection: 16 named-set boosters; extras valued at $0.");
  }
  if (setName === "151" && /(?:Alakazam|Zapdos) ex Collection/i.test(name)) {
    return fixed("collection", 4, "151 ex Collection: 4 named-set boosters; promos valued at $0.");
  }
  if (setName === "151" && /Blooming Waters Premium Collection/i.test(name)) {
    return fixed("premium_collection", 12, "Blooming Waters Premium Collection: 12 named-set boosters; promos valued at $0.");
  }
  if (setName === "Prismatic Evolutions" && /Accessory Pouch Special Collection/i.test(name)) {
    return fixed("special_collection", 5, "Prismatic Evolutions Accessory Pouch Special Collection: 5 named-set boosters; extras valued at $0.");
  }
  if (setName === "Prismatic Evolutions" && /Super-Premium Collection/i.test(name)) {
    return fixed("super_premium_collection", 15, "Prismatic Evolutions Super-Premium Collection: 15 named-set boosters; extras valued at $0.");
  }
  if (setName === "Prismatic Evolutions" && /Premium Figure Collection/i.test(name)) {
    return fixed("premium_figure_collection", 11, "Prismatic Evolutions Premium Figure Collection: 11 named-set boosters; extras valued at $0.");
  }
  if (setName === "Ascended Heroes" && /Collection - (?:Erika|Larry)$/i.test(name)) {
    return fixed("collection", 2, "Ascended Heroes Trainer Collection: 2 named-set boosters; promo/coin valued at $0.");
  }
  if (setName === "Ascended Heroes" && /First Partners Deluxe Pin Collection/i.test(name)) {
    return fixed("deluxe_pin_collection", 5, "Ascended Heroes First Partners Deluxe Pin Collection: 5 named-set boosters; extras valued at $0.");
  }
  if (setName === "Ascended Heroes" && /Focused Fighters Premium Collection/i.test(name)) {
    return fixed("premium_collection", 14, "Ascended Heroes Focused Fighters Premium Collection: 14 named-set boosters; extras valued at $0.");
  }
  const describedCount = packCountFromDescription(setName, cardText);
  if (describedCount) {
    return fixed("described_sealed_product", describedCount, `TCGplayer product description explicitly states ${describedCount} named-set booster packs; non-pack contents valued at $0.`);
  }
  return null;
}

export function computeSourceProductTargets(packCount: number, packTcgCents: number, carddistroCents: number) {
  if (!Number.isInteger(packCount) || packCount <= 0) throw new Error("packCount must be a positive integer");
  if (!Number.isInteger(packTcgCents) || packTcgCents <= 0) throw new Error("packTcgCents must be a positive integer");
  if (!Number.isInteger(carddistroCents) || carddistroCents <= 0) throw new Error("carddistroCents must be a positive integer");
  const benchmarkPppCents = Math.min(packTcgCents, carddistroCents);
  const totalAt = (bps: number) => Math.floor((benchmarkPppCents * packCount * bps) / 10_000);
  const out = {
    benchmarkPppCents,
    lowTotalCents: totalAt(SOURCE_TARGET_BPS.low),
    mediumTotalCents: totalAt(SOURCE_TARGET_BPS.medium),
    highTotalCents: totalAt(SOURCE_TARGET_BPS.high),
  };
  if (!(out.highTotalCents < packCount * packTcgCents && out.highTotalCents < packCount * carddistroCents)) {
    throw new Error("target invariant failed: high target must be below both per-pack benchmarks");
  }
  return out;
}

function dollarsToCents(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

async function getJson<T>(groupId: number, kind: "products" | "prices", fixtureDir?: string): Promise<TcgEnvelope<T>> {
  if (fixtureDir) {
    const file = path.join(fixtureDir, `${groupId}_${kind}.json`);
    return JSON.parse(fs.readFileSync(file, "utf8")) as TcgEnvelope<T>;
  }
  const response = await fetch(`https://tcgcsv.com/tcgplayer/3/${groupId}/${kind}`, {
    headers: { "user-agent": "curl/8.5.0" },
  });
  if (!response.ok) throw new Error(`TCGCSV ${kind} group ${groupId}: HTTP ${response.status}`);
  return await response.json() as TcgEnvelope<T>;
}

function latestPackPrice(productId: number, source: "tcgplayer" | "carddistro", onOrBefore: string): number | null {
  const row = getDb().prepare(
    `SELECT price_per_pack_cents
     FROM pk_price_observations
     WHERE product_id = ? AND source = ? AND observed_date <= ?
     ORDER BY observed_date DESC, id DESC LIMIT 1`
  ).get(productId, source, onOrBefore) as { price_per_pack_cents: number } | undefined;
  return row?.price_per_pack_cents ?? null;
}

export interface RefreshSourceProductsResult {
  observedDate: string;
  productsSeen: number;
  catalogUpserts: number;
  valueInserts: number;
  skippedNoBenchmark: string[];
  setsWithoutTcgGroup: string[];
}

export async function refreshSourceProducts(input: { observedDate: string; fixtureDir?: string }): Promise<RefreshSourceProductsResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.observedDate)) throw new Error("observedDate must be YYYY-MM-DD");
  const utcToday = new Date().toISOString().slice(0, 10);
  if (!input.fixtureDir && input.observedDate !== utcToday) {
    throw new Error(`live TCGCSV prices can only be recorded for UTC today (${utcToday}); use fixtures for historical snapshots`);
  }
  const db = getDb();
  const result: RefreshSourceProductsResult = {
    observedDate: input.observedDate,
    productsSeen: 0,
    catalogUpserts: 0,
    valueInserts: 0,
    skippedNoBenchmark: [],
    setsWithoutTcgGroup: [],
  };

  const packProducts = db.prepare(
    `SELECT DISTINCT p.id, p.set_name
     FROM pk_products p
     JOIN pk_price_observations o ON o.product_id = p.id AND o.source = 'carddistro'
     WHERE p.form = 'booster' AND p.active = 1
     ORDER BY p.set_name`
  ).all() as Array<{ id: number; set_name: string }>;

  for (const packProduct of packProducts) {
    const groupId = SET_NAME_TO_TCG_GROUP[packProduct.set_name];
    if (!groupId) {
      result.setsWithoutTcgGroup.push(packProduct.set_name);
      continue;
    }
    const [productEnvelope, priceEnvelope] = await Promise.all([
      getJson<TcgProduct>(groupId, "products", input.fixtureDir),
      getJson<TcgPrice>(groupId, "prices", input.fixtureDir),
    ]);
    if (productEnvelope.results.length === 0 || priceEnvelope.results.length === 0) {
      throw new Error(`TCGCSV group ${groupId} returned an empty products/prices envelope; refusing to change ${packProduct.set_name}`);
    }
    const classifiedProducts = productEnvelope.results.flatMap((product) => {
      const cardText = product.extendedData?.find((row) => row.name === "CardText")?.value;
      const classified = classifySourceProduct(packProduct.set_name, product.name, cardText);
      return classified ? [{ product, classified }] : [];
    });
    const existingActiveCount = (db.prepare(
      `SELECT COUNT(*) AS n FROM pk_source_products WHERE pack_product_id=? AND active=1`
    ).get(packProduct.id) as { n: number }).n;
    if (classifiedProducts.length === 0 || classifiedProducts.length < existingActiveCount) {
      throw new Error(
        `TCGCSV group ${groupId} produced ${classifiedProducts.length} classified products, below existing active count ${existingActiveCount}; refusing partial deactivation`
      );
    }

    const priceByProduct = new Map(priceEnvelope.results.map((row) => [row.productId, row]));
    const packTcg = latestPackPrice(packProduct.id, "tcgplayer", input.observedDate);
    const carddistro = latestPackPrice(packProduct.id, "carddistro", input.observedDate);
    const localSkipped: string[] = [];
    let localUpserts = 0;
    let localValueInserts = 0;

    db.transaction(() => {
      db.prepare(`UPDATE pk_source_products SET active=0, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE pack_product_id=?`).run(packProduct.id);

      for (const { product, classified } of classifiedProducts) {
        const sourceUrl = product.url || `https://www.tcgplayer.com/product/${product.productId}`;
        db.prepare(
          `INSERT INTO pk_source_products
             (pack_product_id, tcgplayer_product_id, name, form, pack_count,
              tcgplayer_url, pack_count_source_url, pack_count_note, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
           ON CONFLICT(tcgplayer_product_id) DO UPDATE SET
             pack_product_id = excluded.pack_product_id,
             name = excluded.name,
             form = excluded.form,
             pack_count = excluded.pack_count,
             tcgplayer_url = excluded.tcgplayer_url,
             pack_count_source_url = excluded.pack_count_source_url,
             pack_count_note = excluded.pack_count_note,
             active = 1,
             updated_at = excluded.updated_at`
        ).run(
          packProduct.id,
          product.productId,
          product.name,
          classified.form,
          classified.packCount,
          sourceUrl,
          sourceUrl,
          classified.packCountNote,
        );
        localUpserts += 1;

        if (packTcg === null || carddistro === null) {
          localSkipped.push(`${packProduct.set_name}: ${product.name}`);
          continue;
        }
        const targets = computeSourceProductTargets(classified.packCount, packTcg, carddistro);
        const price = priceByProduct.get(product.productId);
        const sourceProduct = db.prepare(`SELECT id FROM pk_source_products WHERE tcgplayer_product_id = ?`)
          .get(product.productId) as { id: number };
        const insert = db.prepare(
          `INSERT OR IGNORE INTO pk_source_product_values
             (source_product_id, observed_date, pack_count, tcg_market_cents,
              tcg_low_cents, tcg_high_cents, pack_tcg_cents, carddistro_cents,
              benchmark_ppp_cents, low_total_cents, medium_total_cents,
              high_total_cents, methodology)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          sourceProduct.id,
          input.observedDate,
          classified.packCount,
          dollarsToCents(price?.marketPrice),
          dollarsToCents(price?.lowPrice),
          dollarsToCents(price?.highPrice),
          packTcg,
          carddistro,
          targets.benchmarkPppCents,
          targets.lowTotalCents,
          targets.mediumTotalCents,
          targets.highTotalCents,
          "Pack-only acquisition targets: low/medium/high are 25%/20%/15% below the lower of TCGplayer loose-pack market and Carddistro cost. Promos/accessories=$0.",
        );
        localValueInserts += insert.changes;
      }
    })();

    result.productsSeen += classifiedProducts.length;
    result.catalogUpserts += localUpserts;
    result.valueInserts += localValueInserts;
    result.skippedNoBenchmark.push(...localSkipped);
  }
  return result;
}
