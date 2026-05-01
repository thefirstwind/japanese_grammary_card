/**
 * Assign examLevel N1/N2 using JLPT Global N1 grammar table (local copy).
 * Source file: scripts/data/jlptglobal_n1_full.txt (Markdown export).
 * Logic: extract Japanese signatures from table → longest-first substring match on card title variants.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const DATA_FILE = path.join(__dirname, "data", "jlptglobal_n1_full.txt");
const CARDS_FILE = path.join(ROOT, "cards-data.js");

/** Exact JP signatures that are too ambiguous when matched by substring alone */
const BLACKLIST_EXACT = new Set([
  "に",
  "わ",
  "さ",
  "て",
  "で",
  "と",
  "の",
  "が",
  "を",
  "は",
  "も",
  "か",
  "や",
  "ね",
  "よ",
  // Row「という」would match almost every「〜という〜」card title.
  "という",
]);

function extractSignaturesFromCell(cell) {
  const out = new Set();
  if (!cell || cell === "文法レッスン") return out;
  const chunks = cell.split("/").map((s) => s.trim()).filter(Boolean);
  for (let chunk of chunks) {
    chunk = chunk.replace(/\s+/g, "");
    const re = /（([^）]+)）/g;
    let m;
    while ((m = re.exec(chunk)) !== null) {
      const inner = m[1].trim().replace(/\s+/g, "").normalize("NFKC");
      if (inner.length >= 3 && !BLACKLIST_EXACT.has(inner)) out.add(inner);
    }
    const surface = chunk.replace(/（[^）]*）/g, "").trim().normalize("NFKC");
    if (surface.length >= 3 && !BLACKLIST_EXACT.has(surface)) out.add(surface);
  }
  return out;
}

function parseN1Signatures(text) {
  const all = new Set();
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("|")) continue;
    const parts = line.split("|").map((s) => s.trim());
    if (parts.length < 5 || parts[1] === "#" || parts[1].startsWith("---")) continue;
    const jpCol = parts[3];
    extractSignaturesFromCell(jpCol).forEach((s) => all.add(s));
  }
  return [...all].sort((a, b) => b.length - a.length);
}

function titleVariants(title) {
  const base = String(title)
    .normalize("NFKC")
    .replace(/\u301c/g, "")
    .replace(/〜/g, "")
    .trim();
  return base.split(/[／\/]/).map((s) => s.trim()).filter(Boolean);
}

function variantMatchesSignature(variant, sig) {
  if (sig.length < 3) return false;
  const v = variant.normalize("NFKC");
  const s = sig.normalize("NFKC");
  if (v === s) return true;
  if (v.includes(s)) return true;
  if (s.includes(v) && v.length >= 5) return true;
  return false;
}

function examLevelForTitle(title, signatures) {
  const variants = titleVariants(title);
  for (const v of variants) {
    for (const sig of signatures) {
      if (variantMatchesSignature(v, sig)) return "N1";
    }
  }
  return "N2";
}

function main() {
  const raw = fs.readFileSync(DATA_FILE, "utf8");
  const signatures = parseN1Signatures(raw);
  const sandbox = { window: {}, console };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(CARDS_FILE, "utf8"), sandbox);
  const cards = sandbox.window.N1N2_CARDS;
  let n1 = 0;
  let n2 = 0;
  for (const card of cards) {
    card.examLevel = examLevelForTitle(card.title, signatures);
    if (card.examLevel === "N1") n1++;
    else n2++;
  }
  fs.writeFileSync(CARDS_FILE, `window.N1N2_CARDS = ${JSON.stringify(cards, null, 2)};\n`, "utf8");
  console.log(`examLevel assigned: N1=${n1}, N2=${n2}, signatures=${signatures.length}`);
}

main();
