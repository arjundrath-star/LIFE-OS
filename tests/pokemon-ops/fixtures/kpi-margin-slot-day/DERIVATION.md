# DERIVATION — kpi-margin-slot-day

Single lot lotB1: landed = Math.round(18000 / 20) = 900 c/pack. Every sale is at
1500 c → margin per pack = 1500 − 900 = 600 c for every unit (FIFO: total sold
2+1+3+4 = 10 ≤ 20 packs, all draw from lotB1, unallocated 0).

Per-sale margins: s0 = 2×600 = 1200, sb = 1×600 = 600, s1 = 3×600 = 1800,
s2 = 4×600 = 2400.

## kpi7 (windowDays 7)

Window = (2026-07-10T00:00:00.000Z, 2026-07-17T00:00:00.000Z].
- s0 (07-08T12:00) — before start → out.
- sb (07-10T00:00) — EXACTLY at window start → excluded (strict >).
- s1, s2 — in.

Σ margin = 1800 + 2400 = 4200. kpi7 = Math.round(4200 / 7) = Math.round(600) = 600.

## kpi14 (windowDays 14)

Window = (2026-07-03T00:00:00.000Z, 2026-07-17T00:00:00.000Z].
All four sales are in (s0 07-08 > 07-03; sb 07-10 > 07-03).

Σ margin = 1200 + 600 + 1800 + 2400 = 6000.
kpi14 = Math.round(6000 / 14) = Math.round(428.571428…) = 429.
