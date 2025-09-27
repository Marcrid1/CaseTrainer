// tools/questionBank.js (CommonJS)
const fs = require("fs/promises");
const path = require("path");

let cache = null;

async function loadAll() {
  if (cache) return cache;
  const fp = path.join(__dirname, "question-bank.json"); // liegt im selben Ordner
  const raw = await fs.readFile(fp, "utf8");
  cache = JSON.parse(raw);
  return cache;
}

/** getQuestion({ qtype }) – qtype: "personal-fit" | "behavioral" */
async function getQuestion({ qtype }) {
  const all = await loadAll();
  const list = all.filter(q => q.type === qtype);
  if (list.length) return list[Math.floor(Math.random() * list.length)];
  if (all.length)  return all[Math.floor(Math.random() * all.length)];
  throw new Error("Question bank is empty");
}

module.exports = { getQuestion, loadAll };
