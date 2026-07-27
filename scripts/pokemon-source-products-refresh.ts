import path from "node:path";
import { refreshSourceProducts } from "../lib/pokemon-ops/source-products";

function valueAfter(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const observedDate = valueAfter("--date") ?? new Date().toISOString().slice(0, 10);
  const fixtureArg = valueAfter("--fixture-dir");
  const fixtureDir = fixtureArg ? path.resolve(fixtureArg) : undefined;
  const expectedTcgArg = valueAfter("--expected-tcg-csv");
  const expectedCarddistroArg = valueAfter("--expected-carddistro-csv");
  const expectedBenchmarkCsv = expectedTcgArg || expectedCarddistroArg ? {
    ...(expectedTcgArg ? { tcgplayer: path.resolve(expectedTcgArg) } : {}),
    ...(expectedCarddistroArg ? { carddistro: path.resolve(expectedCarddistroArg) } : {}),
  } : undefined;

  const result = await refreshSourceProducts({ observedDate, fixtureDir, expectedBenchmarkCsv });
  console.log(JSON.stringify(result, null, 2));
  if (result.setsWithoutTcgGroup.length) {
    console.warn(`No TCGplayer product group yet: ${result.setsWithoutTcgGroup.join(", ")}`);
  }
  if (!result.catalogUpserts) {
    console.error("No source products were discovered; refusing silent success.");
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
