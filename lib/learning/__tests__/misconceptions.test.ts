import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildDiagnosticsBlock,
  matchMisconceptions,
  misconceptionLibrarySchema,
  type MisconceptionLibrary,
} from "../misconceptions";

const dir = path.resolve(__dirname, "../../../data/misconceptions");
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
const libraries: MisconceptionLibrary[] = files.map((f) =>
  misconceptionLibrarySchema.parse(JSON.parse(readFileSync(path.join(dir, f), "utf8"))),
);

describe("misconception library files", () => {
  it("has at least four subjects, each valid and named after its file", () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
    files.forEach((file, i) => expect(libraries[i].subject).toBe(file.replace(/\.json$/, "")));
  });

  it("uses unique ids across all subjects", () => {
    const ids = libraries.flatMap((l) => l.entries.map((e) => e.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is wired into the server loader", () => {
    const loader = readFileSync(path.resolve(__dirname, "../misconception-library.ts"), "utf8");
    for (const file of files) expect(loader).toContain(`@/data/misconceptions/${file}`);
  });
});

describe("matchMisconceptions", () => {
  it("finds the bond price misconception from a concept label", () => {
    const [top] = matchMisconceptions(libraries, "Bond prices and yield to maturity");
    expect(top.id).toBe("bond-price-yield-same-direction");
  });

  it("matches the UPI sample lesson and photosynthesis", () => {
    expect(matchMisconceptions(libraries, "Teach me how UPI works").map((m) => m.id)).toContain("upi-is-a-wallet");
    expect(matchMisconceptions(libraries, "Photosynthesis").map((m) => m.id)).toContain("plants-eat-soil");
  });

  it("respects word boundaries", () => {
    // "upi" must not match inside "cupid"; "heat" not inside "theater".
    expect(matchMisconceptions(libraries, "cupid at the theater")).toEqual([]);
  });

  it("ignores case and punctuation and normalises apostrophes", () => {
    const ids = matchMisconceptions(libraries, "NEWTON'S FIRST LAW?!").map((m) => m.id);
    expect(ids).toContain("force-needed-for-motion");
  });

  it("ranks more specific (multi-word) matches first and honours the limit", () => {
    const matches = matchMisconceptions(libraries, "cash flow statement and revenue", 2);
    expect(matches).toHaveLength(2);
    expect(matches[0].id).toBe("cash-is-profit");
  });

  it("returns nothing for empty or unrelated text", () => {
    expect(matchMisconceptions(libraries, "")).toEqual([]);
    expect(matchMisconceptions(libraries, "hello there")).toEqual([]);
  });
});

describe("buildDiagnosticsBlock", () => {
  it("includes the diagnostic question and is empty with no matches", () => {
    const matches = matchMisconceptions(libraries, "stock split");
    const block = buildDiagnosticsBlock(matches);
    expect(block).toContain(matches[0].diagnosticQuestion);
    expect(buildDiagnosticsBlock([])).toBe("");
  });
});
