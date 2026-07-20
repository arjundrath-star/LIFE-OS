export const BUSINESS_UNITS = [
  { value: "all", label: "All" },
  { value: "pokemon", label: "Pokemon Vending" },
  { value: "portable-charging", label: "Portable Charging" },
  { value: "subtap", label: "Subtap" },
] as const;

export type BusinessUnit = (typeof BUSINESS_UNITS)[number]["value"];

export const BUSINESS_ROUTES = [
  { href: "/business", label: "Overview" },
  { href: "/business/crm", label: "CRM" },
  { href: "/business/locations", label: "Locations" },
  { href: "/business/inventory", label: "Inventory" },
  { href: "/business/sourcing", label: "Sourcing" },
  { href: "/business/finance", label: "Finance" },
  { href: "/business/agents", label: "Agents" },
  { href: "/business/integrations", label: "Integrations" },
] as const;

export const LEGACY_BUSINESS_REDIRECTS = {
  "/pokemon-crm": "/business/crm?unit=pokemon",
  "/pokemon-ops": "/business/inventory?unit=pokemon",
  "/vending": "/business/locations?unit=pokemon",
} as const;

export function isBusinessUnit(value: string | null | undefined): value is BusinessUnit {
  return BUSINESS_UNITS.some((unit) => unit.value === value);
}

export function resolveBusinessUnit(search: string, saved: string | null): BusinessUnit {
  const queryUnit = new URLSearchParams(search).get("unit");
  if (isBusinessUnit(queryUnit)) return queryUnit;
  return isBusinessUnit(saved) ? saved : "all";
}
