// agent/buildInstructions.js
const fs = require("fs/promises");
const path = require("path");

const VALID_MODES = new Set(["personal-fit", "behavioral", "case", "full"]);
const VALID_LANGS = new Set(["en", "de"]);

function normalizeMode(m) {
  const v = String(m || "").toLowerCase();
  return VALID_MODES.has(v) ? v : "full";
}

function normalizeLanguage(l) {
  const v = String(l || "").toLowerCase();
  return VALID_LANGS.has(v) ? v : "en";
}

/**
 * Builds the full instruction text by prepending a minimal preamble that
 * hard-sets language + mode, then appends the flexible recruiter_en.md body.
 */
async function buildInstructions({ mode, language }) {
  const lang = normalizeLanguage(language);
  const selMode = normalizeMode(mode);

  const mdPath = path.join(__dirname, "instructions", "recruiter_en.md");
  const md = await fs.readFile(mdPath, "utf8");

  // Minimal, model-friendly preamble (no YAML, no JSON—just directives)
const preamble = [
  `You MUST interview in ${lang === "de" ? "German" : "English"}.`,
  `Interview scope (mode): ${selMode}.`,
  `All interview questions MUST be sourced via the function tool 'question_bank_get'.`,
  `Do NOT invent or write your own questions. Whenever you need the next question, CALL 'question_bank_get' with qtype based on mode:`,
  `- personal-fit → qtype="personal-fit"`,
  `- behavioral → qtype="behavioral"`,
  `- full → choose one per turn.`,
  `The question texts in the pool are in English; you MUST translate your spoken output to the session language.`,
  `Ask ONE clear question at a time. Do NOT score or decide here.`
].join(" ");


  return `${preamble}\n\n${md}`;
}

module.exports = { buildInstructions, normalizeMode, normalizeLanguage, VALID_MODES, VALID_LANGS };
