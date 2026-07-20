"use client";

import { createContext, useContext, useEffect, useState } from "react";

export type BusinessUnit = "all" | "pokemon" | "portable-charging" | "subtap";

const BusinessContext = createContext<{
  unit: BusinessUnit;
  setUnit: (unit: BusinessUnit) => void;
}>({ unit: "all", setUnit: () => {} });

export const BUSINESS_UNITS: Array<{ value: BusinessUnit; label: string }> = [
  { value: "all", label: "All" },
  { value: "pokemon", label: "Pokemon Vending" },
  { value: "portable-charging", label: "Portable Charging" },
  { value: "subtap", label: "Subtap" },
];

export function BusinessProvider({ children }: { children: React.ReactNode }) {
  const [unit, setUnitState] = useState<BusinessUnit>("all");
  useEffect(() => {
    const saved = localStorage.getItem("rathworkspace.business-unit") as BusinessUnit | null;
    if (BUSINESS_UNITS.some((item) => item.value === saved)) setUnitState(saved!);
  }, []);
  const setUnit = (next: BusinessUnit) => {
    setUnitState(next);
    localStorage.setItem("rathworkspace.business-unit", next);
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
