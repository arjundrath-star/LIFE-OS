"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { BUSINESS_UNITS, resolveBusinessUnit, type BusinessUnit } from "@/lib/business-workspace";

export { BUSINESS_UNITS, type BusinessUnit } from "@/lib/business-workspace";

const BusinessContext = createContext<{
  unit: BusinessUnit;
  setUnit: (unit: BusinessUnit) => void;
}>({ unit: "all", setUnit: () => {} });

const STORAGE_KEY = "rathworkspace.business-unit";

export function BusinessProvider({ children }: { children: React.ReactNode }) {
  const [unit, setUnitState] = useState<BusinessUnit>("all");
  useEffect(() => {
    const syncFromLocation = () => {
      const next = resolveBusinessUnit(window.location.search, localStorage.getItem(STORAGE_KEY));
      setUnitState(next);
      if (new URLSearchParams(window.location.search).has("unit")) localStorage.setItem(STORAGE_KEY, next);
    };
    syncFromLocation();
    window.addEventListener("popstate", syncFromLocation);
    return () => window.removeEventListener("popstate", syncFromLocation);
  }, []);
  const setUnit = (next: BusinessUnit) => {
    setUnitState(next);
    localStorage.setItem(STORAGE_KEY, next);
    const url = new URL(window.location.href);
    url.searchParams.set("unit", next);
    window.history.replaceState(window.history.state, "", url);
  };
  return <BusinessContext.Provider value={{ unit, setUnit }}>{children}</BusinessContext.Provider>;
}

export function useBusinessUnit() {
  return useContext(BusinessContext);
}

export function PokemonDataBoundary({ children }: { children: React.ReactNode }) {
  const { unit } = useBusinessUnit();
  if (unit === "portable-charging" || unit === "subtap") {
    const name = unit === "portable-charging" ? "Portable Charging" : "Subtap";
    return (
      <div className="business-empty" role="status">
        <h2>{name} is not integrated here yet</h2>
        <p>This workspace only has a real Pokemon-backed data source today. Select All or Pokemon Vending to view it; no records have been inferred for {name}.</p>
      </div>
    );
  }
  return <>{children}</>;
}
