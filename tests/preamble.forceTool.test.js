const { buildInstructions } = require("../agent/buildInstructions");

test("preamble mandates tool usage", async () => {
  const out = await buildInstructions({ mode: "personal-fit", language: "de" });
  const low = out.toLowerCase();
  expect(low).toContain("must be sourced via the function tool 'question_bank_get'");
  expect(low).toContain("do not invent or write your own questions");
});
