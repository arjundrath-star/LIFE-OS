// Pokemon-placement-specific scoring. PeopleFinder's `Vending Score` is generic;
// this adjusts it toward Pokemon/card machine fit so bars/nightclubs/hotels do
// not outrank arcades, convenience, family entertainment, and collector venues.
export type PokemonFitInput = {
  venue_name?: string | null;
  category?: string | null;
  vending_score?: number | null;
  rating?: number | null;
  reviews?: number | null;
  has_owner_name?: boolean;
  has_owner_phone?: boolean;
  has_phone?: boolean;
  has_email?: boolean;
  has_address?: boolean;
  has_website?: boolean;
};

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

function includesAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

export function pokemonFitScore(input: PokemonFitInput): number {
  const name = (input.venue_name || "").toLowerCase();
  const category = (input.category || "").toLowerCase();
  const text = `${name} ${category}`;
  const base = Number.isFinite(input.vending_score as number)
    ? Number(input.vending_score)
    : 50;

  let score = base;

  // Top Pokemon placement contexts: kids/family, collectors, impulse purchase,
  // and places where ripping/trading packs makes social sense.
  if (includesAny(text, ["toy", "card", "hobby", "comic", "game store", "collectible"])) score += 18;
  if (includesAny(text, ["arcade", "amusement", "family entertainment", "playground", "trampoline", "pinball", "adventure", "activate games", "kidztopia"])) score += 15;
  if (includesAny(text, ["convenience", "7-eleven", "7 eleven", "gas station", "gas +", "market", "grocery", "supermarket", "mart", "deli", "specialty"])) score += 12;
  if (includesAny(text, ["ice cream", "dessert", "bubble tea", "boba", "pizza", "candy", "froyo"])) score += 12;
  if (includesAny(text, ["bowling", "bowl", "lanes"])) score += 8;

  // Good for other machines, weak for Pokemon. Demote hard so they do not sit
  // above family/collector/impulse venues.
  if (includesAny(text, ["nightclub", "club", "lounge", "barroom", "cocktail", "21+", "adult entertainment"])) score -= 45;
  if (includesAny(text, [" bar", "bar ", "pub", "tavern", "brewery", "taproom"])) score -= 35;
  if (includesAny(text, ["hotel", "motel", "inn", "resort"])) score -= 35;
  if (includesAny(text, ["tattoo", "piercing"])) score -= 45;
  if (includesAny(text, ["vape", "smoke shop", "liquor", "wine & smoke", "beer wine"])) score -= 22;

  // Quality modifiers. Keep them modest: a mediocre 7-Eleven can still be a
  // Pokemon test, but a 1.7-rated store should not outrank stronger fits.
  const rating = Number(input.rating);
  if (Number.isFinite(rating)) {
    if (rating >= 4.6) score += 5;
    else if (rating >= 4.3) score += 3;
    else if (rating < 2.5) score -= 18;
    else if (rating < 3.5) score -= 10;
  }

  const reviews = Number(input.reviews);
  if (Number.isFinite(reviews)) {
    if (reviews >= 1000) score += 4;
    else if (reviews >= 250) score += 2;
  }

  // Enrichment modifiers. Keep unenriched leads in the CRM, but push them down
  // until they have enough contact/routing data to be actionable. Owner phone is
  // gold; venue phone is still useful; no phone means this is mostly a research
  // backlog item, not a call queue item.
  if (input.has_owner_phone) score += 8;
  else if (input.has_phone) score -= 6;
  else score -= 26;

  if (input.has_owner_name) score += 4;
  else score -= 7;

  if (input.has_address === false) score -= 9;
  if (input.has_website === false) score -= 4;

  return clamp(score);
}

export function ownerAccessScore(input: PokemonFitInput): number {
  const category = (input.category || "").toLowerCase();
  const name = (input.venue_name || "").toLowerCase();
  const text = `${name} ${category}`;
  let score = 55;
  if (includesAny(text, ["7-eleven", "7 eleven", "franchise", "hotel", "hilton"])) score -= 15;
  if (includesAny(text, ["market", "mart", "convenience", "deli", "arcade", "toy", "card", "hobby", "pizza", "ice cream"])) score += 12;
  if (includesAny(text, ["nightclub", "club", "lounge", "bar", "tattoo"])) score -= 10;
  if (input.has_owner_phone) score += 20;
  else if (input.has_phone) score += 5;
  else score -= 25;
  if (input.has_owner_name) score += 10;
  else score -= 8;
  if (input.has_address === false) score -= 8;
  return clamp(score);
}
