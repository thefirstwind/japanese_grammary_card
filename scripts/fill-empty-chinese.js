/**
 * Fill cards-data.js entries where chinese[] is empty by parsing raw markdown sections.
 */
const fs = require("fs");
const vm = require("vm");

const path = require("path").join(__dirname, "..", "cards-data.js");

function extractChineseFromRaw(raw) {
  if (!raw) return [];
  const out = [];
  const seen = new Set();

  function add(line) {
    const t = String(line).trim();
    if (!t || /^###/.test(t)) return;
    const prefixed = t.startsWith("中文：") ? t : "中文：" + t;
    if (!seen.has(prefixed)) {
      seen.add(prefixed);
      out.push(prefixed);
    }
  }

  let m;
  const re1 = /^中文：(.+)$/gm;
  while ((m = re1.exec(raw)) !== null) add(m[1]);

  const re2 = /^### 中文意思\d*\s*\n([^\n]+)$/gm;
  while ((m = re2.exec(raw)) !== null) add(m[1]);

  const re3 = /^### 中文\s*\n([^\n]+)$/gm;
  while ((m = re3.exec(raw)) !== null) add(m[1]);

  return out;
}

const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path, "utf8"), sandbox);
const cards = sandbox.window.N1N2_CARDS;

for (const c of cards) {
  if (!Array.isArray(c.chinese) || c.chinese.length === 0) {
    const ex = extractChineseFromRaw(c.raw || "");
    if (ex.length) c.chinese = ex;
  }
}

const keigoOverview = cards.find((c) => c.id === "ch12-031");
if (
  keigoOverview &&
  (!Array.isArray(keigoOverview.chinese) || keigoOverview.chinese.length === 0)
) {
  keigoOverview.chinese = [
    "中文：尊敬语、谦让语与丁宁语的总览——抬高对方或第三者的动作，压低己方说法，或以礼貌方式陈述。",
  ];
}

const left = cards.filter((c) => !Array.isArray(c.chinese) || c.chinese.length === 0);
if (left.length) {
  console.error("Still missing chinese:", left.map((c) => c.id).join(", "));
  process.exit(1);
}

const body = JSON.stringify(cards, null, 2);
fs.writeFileSync(path, `window.N1N2_CARDS = ${body};\n`, "utf8");
console.log("Updated", path, "— filled empty chinese arrays.");
