// tests/buildInstructions.toolUsage.test.js
const { buildInstructions } = require("../agent/buildInstructions");

describe("Instruction mandates tool usage", () => {
  test("requires calling question_bank_get and forbids inventing questions", async () => {
    const out = await buildInstructions({ mode: "behavioral", language: "de" });
    const low = out.toLowerCase();
    expect(low).toContain("must be sourced via the function tool 'question_bank_get'");
    expect(low).toContain("do not invent or write your own questions");
    expect(low).toContain('qtype="behavioral"');
    expect(low).toContain('qtype="personal-fit"');
  });
});
