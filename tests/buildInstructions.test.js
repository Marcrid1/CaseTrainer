const { buildInstructions, normalizeMode, normalizeLanguage } = require("../agent/buildInstructions");
const fs = require("fs");

describe("Instruction builder", () => {
  test("normalizes mode and language", async () => {
    expect(normalizeMode("CASE")).toBe("case");
    expect(normalizeMode("unknown")).toBe("full");
    expect(normalizeLanguage("DE")).toBe("de");
    expect(normalizeLanguage("xx")).toBe("en");
  });

  test("injects mode and language directive + includes MD body", async () => {
    const out = await buildInstructions({ mode: "behavioral", language: "de" });
    expect(out).toMatch(/interview in German/i);
    expect(out).toMatch(/Interview scope \(mode\): behavioral/i);
    // enthält die geladene MD-Datei (Headings-Signatur)
    expect(out).toMatch(/System Instruction .* Recruiter/i);
  });

  test("case mode mentions not a full-length case", async () => {
    const out = await buildInstructions({ mode: "case", language: "en" });
    expect(out.toLowerCase()).toContain("not a full-length case");
  });
});
