/**
 * Reads 课后练习/*.txt → practice-data.js
 * - 練習問題：全文完形（正文 + 文末参考答案），交互下拉已停用。
 * - まとめの問題：（n）选择题 → 答题系统。
 * 合并 scripts/extract_review_cloze.py 生成的 review-cloze.json（复习版 Markdown／PDF）。
 */
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "practice-data.js");
const PRACTICE_DIR = path.join(__dirname, "..", "..", "课后练习");

const SEP_RE = /\n={60,}\n/g;

function splitPanels(text) {
  return text.split(SEP_RE).map((s) => s.trim()).filter(Boolean);
}

function mergeTinyPanels(panels) {
  const out = [];
  for (let i = 0; i < panels.length; i++) {
    const p = panels[i];
    const next = panels[i + 1];
    if (/^練習問題\s*$/.test(p) && next) {
      out.push(`練習問題\n\n${next}`);
      i++;
      continue;
    }
    if (/^解答\s*$/.test(p) && next) {
      out.push(`解答\n${next}`);
      i++;
      continue;
    }
    if (/^答案\s*$/.test(p) && next) {
      out.push(`答案\n${next}`);
      i++;
      continue;
    }
    /** 「第n章 まとめの問題」独占一块而题干「（1）…」在下一块时合并 */
    if (
      p.includes("まとめの問題") &&
      !/[（(]\s*1\s*[）)]/.test(p) &&
      next &&
      /[（(]\s*1\s*[）)]/.test(next)
    ) {
      out.push(`${p.trim()}\n\n${next.trim()}`);
      i++;
      continue;
    }
    /** 「（解答は別冊…）」单行面板插在题干与解答之间，并入其后解答面板 */
    const pnLines = p.split("\n").map((l) => l.trim()).filter(Boolean);
    if (
      pnLines.length === 1 &&
      /^（解答は[^）]*）$/.test(pnLines[0]) &&
      next &&
      /^(解答|答案)/.test(firstLine(next))
    ) {
      out.push(`${next.trim()}\n\n${pnLines[0]}`);
      i++;
      continue;
    }
    out.push(p);
  }
  return out;
}

/** 答案（別冊…）仅有标题一行时与下一面板正文合并 */
function mergeAnswerTitleStub(panels) {
  const out = [];
  for (let i = 0; i < panels.length; i++) {
    const p = panels[i];
    const lines = p.split(/\n/).map((l) => l.trim());
    const next = panels[i + 1];
    if (/^答案/.test(lines[0] || "") && lines.length <= 2 && lines.every((l) => !l || /^答案/.test(l)) && next && !/^答案/.test(firstLine(next))) {
      out.push(`${p.trim()}\n\n${next}`);
      i++;
      continue;
    }
    out.push(p);
  }
  return out;
}

/** 「第n章 まとめの問題 解答」面板首行不是「解答」，会与题干面板配对失败；补首行使 extractChapterSummaryAnswers / parseChapterSummarySets 正常工作 */
function prependAnswerStubForChapterSummary(panels) {
  return panels.map((p) => {
    const head = firstLine(p).trim();
    if (/^第\s*\d+\s*章\s+まとめの問題\s+解答\s*$/.test(head)) return `解答\n${p.trim()}`;
    return p;
  });
}

function norm(s) {
  return String(s)
    .replace(/\u3000/g, " ")
    .replace(/\s+/g, "")
    .replace(/[。．、，]/g, "")
    .toLowerCase();
}

function firstLine(panel) {
  return panel.split("\n")[0]?.trim() || "";
}

function stripAnswerPanelNoise(text) {
  return String(text || "")
    .replace(/^#{1,6}\s+[^\n]+\n/gm, "")
    .replace(/^解答[:：]?\s*\n/m, "")
    .replace(/^解答[^\n]*\n/m, "")
    .replace(/^答案[^\n]*\n/m, "")
    .trim();
}

/** 去掉「まとめの問題」整块（横线分段可能带多余换行；正文里的选择题不能与 JS \\b 连用）。*/
function stripMatomeSegments(chunk) {
  let work = String(chunk || "")
    .replace(
      /\n\s*-{10,}\s*\n\s*#{0,2}\s*第\s*\d+\s*章\s+まとめの問題\s*\n\s*-{10,}\s*\n[\s\S]*?(?=\n\s*-{10,}\s*\n\s*(?:#{0,2}\s*)?練習問題\s|\n={60,}\n|$)/g,
      "\n",
    )
    .trim();
  const parts = work.split(/\n\s*-{10,}\s*\n/);
  const kept = parts.filter((p) => !p.includes("まとめの問題"));
  return kept
    .join("\n\n────────\n\n")
    .replace(/\n##?\s*第\d+章\s+まとめの問題[\s\S]*?(?=\n##?\s*第\d+日\s+練習問題|\n={10,}\n解答|\n解答[:：]?\s*\n|$)/g, "\n")
    .trim();
}

function looksLikeHomework(text) {
  return /[①②③④⑤⑥⑦⑧⑨⑩⑪⑫]|※正しい|（[^）\n]{1,80}[／/][^）\n]+）/.test(text);
}

/** 第一题①之前单独成行的废行（与 UI / 下拉标题重复或仅为作答说明）；与 app.js stripClozeLeadInBody 保持同步 */
function isClozePreambleNoiseLine(trim) {
  const t = String(trim || "").trim();
  if (!t) return false;
  if (/^={6,}$/.test(t)) return true;
  if (/^-{6,}$/.test(t)) return true;
  if (/^─{6,}$/.test(t)) return true;
  if (/^(?:##\s*)?第\s*[0-9０-９]+\s*日\s+練習問題(?:\s+[0-9０-９]+)?\s*$/.test(t)) return true;
  if (/^#{1,6}\s*練習問題(?:\s*[0-9０-９]+)?\s*$/.test(t)) return true;
  if (/^練習問題\s*$/.test(t)) return true;
  if (/^（解答[^）]*）\s*$/.test(t)) return true;
  if (/^-?\s*※[^※\n]*選びなさい[。.．〜～\s]*$/u.test(t)) return true;
  return false;
}

/** 去掉正文开头连续的废行与空行，直至第一题 */
function stripLeadingClozePreamble(text) {
  const lines = String(text || "").split("\n");
  const out = [];
  for (const line of lines) {
    const trim = line.trim();
    if (!out.length && (trim === "" || isClozePreambleNoiseLine(trim))) continue;
    out.push(line);
  }
  return out.join("\n").trim();
}

/** マークダウン見出し「## 第n日 練習問題」「第n日 練習問題」（無 #）は UI 已与下拉标题重复，正文／参考答案中除去 */
function stripMarkdownDayPracticeHeading(text) {
  let s = String(text || "");
  s = s.replace(/^#{1,6}\s*第[0-9０-９]+\s*日\s+練習問題[^\n]*\n+/gm, "");
  s = s.replace(/^第[0-9０-９]+\s*日\s+練習問題[^\n]*\n+/gm, "");
  return s.trim();
}

/** ①〜⑳ が「一行一題」の参考答案を、前几章と同様「① …　② …」で詰める（既に同行に複数題がある行はそのまま） */
function compactVerticalCircledAnswers(text) {
  const raw = String(text || "").replace(/\r\n/g, "\n");
  const lines = raw.split("\n");
  /** Unicode ① U+2460 … ⑳ U+2473 */
  const circledLine = /^([\u2460-\u2473])\s*(.+)$/;
  const out = [];
  let buf = [];

  function flushBuf() {
    if (buf.length <= 1) {
      out.push(...buf);
      buf = [];
      return;
    }
    const sep = "\u3000";
    const maxItems = 10;
    const maxChars = 108;
    const chunks = [];
    let row = [];
    let rowChars = 0;
    for (const ln of buf) {
      const m = circledLine.exec(ln.trim());
      if (!m) continue;
      const piece = `${m[1]} ${m[2].trim()}`;
      const add = piece.length + (row.length ? sep.length : 0);
      if (row.length >= maxItems || (row.length && rowChars + add > maxChars)) {
        chunks.push(row.join(sep));
        row = [];
        rowChars = 0;
      }
      row.push(piece);
      rowChars += add;
    }
    if (row.length) chunks.push(row.join(sep));
    out.push(...chunks);
    buf = [];
  }

  for (const line of lines) {
    const t = line.trimEnd();
    const trim = t.trim();
    if (!trim) {
      flushBuf();
      out.push("");
      continue;
    }
    if (circledLine.test(trim)) {
      buf.push(trim);
      continue;
    }
    flushBuf();
    out.push(t);
  }
  flushBuf();

  while (out.length && out[out.length - 1] === "") out.pop();
  while (out.length && out[0] === "") out.shift();
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** 参考答案块末尾／开头附着的排版用横线（与下一「第n日」面板之间的分隔）を除去 */
function sanitizeClozeAnswersText(text) {
  let s = String(text || "").replace(/\r\n/g, "\n").trim();
  const fence = /^(?:={6,}|─{6,}|-{6,})$/;
  for (let guard = 0; guard < 20; guard++) {
    const lines = s.split("\n");
    const last = lines[lines.length - 1]?.trim() ?? "";
    const first = lines[0]?.trim() ?? "";
    if (lines.length && fence.test(last)) {
      lines.pop();
      s = lines.join("\n").trimEnd();
      continue;
    }
    if (lines.length && fence.test(first)) {
      lines.shift();
      s = lines.join("\n").trimStart();
      continue;
    }
    break;
  }
  s = s.replace(/^#{1,6}\s*(練習問題\s+[0-9０-９]+)\s*$/gm, "【$1】");
  s = compactVerticalCircledAnswers(s);
  return s.trim();
}

function cleanClozeBody(text) {
  const lines = stripMarkdownDayPracticeHeading(text).split("\n");
  const out = [];
  let skippingMemo = false;
  for (const line of lines) {
    let t = line.trimEnd();
    const trim = t.trim();
    const isExerciseHeading = /^(?:##\s*)?(?:第[0-9０-９]+\s*日\s+)?練習問題\s*\d*[^\n]*$/.test(trim);
    if (skippingMemo) {
      if (isExerciseHeading) skippingMemo = false;
      else continue;
    }
    if (!trim) {
      out.push("");
      continue;
    }
    if (/^【需核对原PDF】/.test(trim)) continue;
    if (/^[-─]{6,}$/.test(trim)) continue;
    if (/^={6,}$/.test(trim)) continue;
    if (/^（解答[^）]*）\s*$/.test(trim)) continue;
    if (/^-?\s*※[^※\n]*選びなさい[。.．〜～\s]*$/u.test(trim)) continue;
    if (/^(?:\[|［)?メモ(?:\]|］)?[:：]?$/.test(trim)) {
      skippingMemo = true;
      continue;
    }
    if (/^(?:PDF校对补充|第\d+日補足|第\d+日补足)[:：]/.test(trim)) {
      skippingMemo = true;
      continue;
    }

    const memoIdxs = [
      t.indexOf("［メモ"),
      t.indexOf("[メモ"),
      t.indexOf("メモ："),
      t.indexOf("メモ:"),
      t.indexOf("よく使われる形"),
      t.indexOf("「〜"),
      t.indexOf("●「〜"),
    ].filter((idx) => idx >= 0);
    if (memoIdxs.length) {
      t = t.slice(0, Math.min(...memoIdxs)).trimEnd();
      if (!t.trim()) {
        skippingMemo = true;
        continue;
      }
    }
    out.push(t);
  }
  /** 与「練習問題 3」等块状練習一致：题与题之间不留空行（\\n\\n → \\n） */
  let joined = out.join("\n").replace(/\n{2,}/g, "\n").trim();
  joined = stripLeadingClozePreamble(joined);
  return joined.replace(/\n{2,}/g, "\n").trim();
}

/** 練習問題整块 → 完形展示（保留括号空白），答案附文本面板 */
function buildClozeFromPanels(chunk, answerPanel) {
  let work = stripMatomeSegments(chunk);
  if (!work || work.length < 15) return null;
  if (!looksLikeHomework(work)) return null;
  work = work.replace(/^#\s[^\n]+\n+/, "").replace(/^说明[:：][^\n]*\n+/m, "").trim();
  work = cleanClozeBody(work);
  const tm = work.match(/^練習問題[^\n]*/m);
  const title = tm ? tm[0].trim().slice(0, 96) : "練習問題（全文・完形）";
  return {
    kind: "cloze",
    title,
    body: work,
    answers: sanitizeClozeAnswersText(stripAnswerPanelNoise(answerPanel)),
  };
}

function setDedupKey(s) {
  if (s.kind === "cloze") return `cloze|${s.title}|${s.body.length}|${s.body.slice(0, 120)}`;
  const qs = s.questions || [];
  return `${s.title}|${qs.length}|${qs.map((q) => q.id).join(",")}`;
}

function chapterRangeFromFile(file) {
  const range = file.match(/(\d+)-(\d+)章/);
  if (range) {
    const start = Number(range[1]);
    const end = Number(range[2]);
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  }
  const single = file.match(/(\d+)章/);
  return single ? [Number(single[1])] : [];
}

function answerSliceByChapter(answerText, chapterNo) {
  const text = String(answerText || "").trim();
  const re = new RegExp(`(?:^|\\n)第\\s*${chapterNo}\\s*章[\\s\\S]*?(?=\\n第\\s*\\d+\\s*章|$)`);
  return text.match(re)?.[0]?.trim() || text;
}

function splitTextAtLine(text, lineRe) {
  const lines = String(text || "").split("\n");
  const idx = lines.findIndex((line) => lineRe.test(line.trim()));
  if (idx <= 0) return null;
  return [
    lines.slice(0, idx).join("\n").trim(),
    lines.slice(idx).join("\n").trim(),
  ];
}

function cloneSetForChapter(set, chapterNo, patch = {}) {
  return {
    ...set,
    ...patch,
    chapterNo,
    chapterTitle: `第${chapterNo}章`,
  };
}

function practiceDayFromSection(chapterNo, sectionNo, set = {}) {
  const n = Number(sectionNo);
  if (Number(set.dayNo)) return Number(set.dayNo);
  if (chapterNo === 1) return n;
  if (chapterNo === 2) {
    if (/2-3章/.test(set.sourceFile || "") && n === 1) return 7;
    if (n >= 8 && n <= 11) return n;
    return n || null;
  }
  if (chapterNo === 3) {
    if (n === 3) return 12;
    if (n === 4) return 13;
    return n || null;
  }
  if (chapterNo >= 4 && chapterNo <= 9) return n || null;
  if (chapterNo === 10) return [36, 37, 38][n - 1] || n || null;
  if (chapterNo === 11) return [39][n - 1] || n || null;
  if (chapterNo === 12) return [40][n - 1] || n || null;
  return n || null;
}

function formatPracticeTitle(chapterNo, dayNo, subNo = null) {
  const suffix = subNo ? ` ${subNo}` : "";
  return `第${chapterNo}章 第${dayNo}日 练习问题${suffix}`;
}

function splitCombinedClozeSet(set, file) {
  if (set.kind !== "cloze") return [set];

  if (/1-2章/.test(file)) {
    const parts = splitTextAtLine(set.body, /^練習問題\s*8\b/);
    if (parts) {
      return [
        cloneSetForChapter(set, 1, {
          title: "第1章 練習問題（全文・完形）",
          body: parts[0],
          answers: answerSliceByChapter(set.answers, 1),
        }),
        cloneSetForChapter(set, 2, {
          title: "第2章 練習問題（全文・完形）",
          body: parts[1],
          answers: answerSliceByChapter(set.answers, 2),
        }),
      ];
    }
  }

  if (/2-3章/.test(file)) {
    const parts = splitTextAtLine(set.body, /^練習問題\s*3\b/);
    if (parts) {
      return [
        cloneSetForChapter(set, 2, {
          title: "第2章 練習問題（全文・完形）",
          body: parts[0],
          answers: answerSliceByChapter(set.answers, 2),
        }),
        cloneSetForChapter(set, 3, {
          title: "第3章 練習問題（全文・完形）",
          body: parts[1],
          answers: answerSliceByChapter(set.answers, 3),
        }),
      ];
    }
  }

  if (/4-5章/.test(file)) {
    const parts = splitTextAtLine(set.body, /^##?\s*第18日\s+練習問題\b/);
    if (parts) {
      return [
        cloneSetForChapter(set, 4, {
          title: "第4章 練習問題（全文・完形）",
          body: parts[0],
          answers: answerSliceByChapter(set.answers, 4),
        }),
        cloneSetForChapter(set, 5, {
          title: "第5章 練習問題（全文・完形）",
          body: parts[1],
          answers: answerSliceByChapter(set.answers, 5),
        }),
      ];
    }
  }

  return [set];
}

function inferChapterForSet(set, file, counters) {
  if (set.chapterNo) return set.chapterNo;
  const titleMatch = String(set.title || "").match(/第\s*(\d+)\s*章/);
  if (titleMatch) return Number(titleMatch[1]);

  if (set.kind === "cloze") {
    counters.cloze += 1;
    if (/4-5章/.test(file)) return counters.cloze <= 2 ? 4 : 5;
    if (/8-9章/.test(file)) return counters.cloze <= 4 ? 8 : 9;
    if (/10-12章/.test(file)) {
      if (counters.cloze <= 3) return 10;
      if (counters.cloze === 4) return 11;
      return 12;
    }
  }

  const range = chapterRangeFromFile(file);
  return range.length === 1 ? range[0] : null;
}

function prepareChapterSets(sets, file) {
  const counters = { cloze: 0 };
  const sectionCounters = new Map();
  const out = [];
  for (const set of sets) {
    for (const splitSet of splitCombinedClozeSet(set, file)) {
      const chapterNo = inferChapterForSet(splitSet, file, counters);
      const chapterSet = chapterNo ? cloneSetForChapter(splitSet, chapterNo) : splitSet;
      if (chapterSet.kind === "cloze" && chapterNo && !chapterSet.sectionTitle) {
        const n = (sectionCounters.get(chapterNo) || 0) + 1;
        sectionCounters.set(chapterNo, n);
        chapterSet.sectionNo = n;
        chapterSet.sourceFile = file;
        const dayNo = practiceDayFromSection(chapterNo, n, chapterSet);
        chapterSet.dayNo = dayNo;
        chapterSet.sectionTitle = formatPracticeTitle(chapterNo, dayNo);
        if (/^練習問題(?:（全文・完形）)?$/.test(chapterSet.title)) {
          chapterSet.title = chapterSet.sectionTitle;
        }
      }
      out.push(...splitClozeSetIntoSections(chapterSet));
    }
  }
  return out;
}

function chapterFromPracticeDay(day, file) {
  if (/4-5章/.test(file)) return day <= 17 ? 4 : 5;
  if (/7章/.test(file)) return 7;
  if (/8-9章/.test(file)) return day <= 32 ? 8 : 9;
  const range = chapterRangeFromFile(file);
  return range.length === 1 ? range[0] : null;
}

function answerSliceByHeading(answerText, heading) {
  const text = String(answerText || "");
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|\\n)##\\s*${escaped}[\\s\\S]*?(?=\\n##\\s+|$)`);
  return text.match(re)?.[0]?.replace(/^##\s*[^\n]+\n/, "").trim() || "";
}

function answerSliceByExerciseNumber(answerText, exerciseNo) {
  const text = String(answerText || "");
  const re = new RegExp(
    `(?:^|\\n)${exerciseNo}\\s+練習問題[\\s\\S]*?(?=\\n\\d+\\s+練習問題|\\n\\s*まとめの問題|\\n\\s*(?:#{0,2}\\s*)?第\\s*\\d+\\s*章\\s+まとめの問題|$)`,
  );
  return text.match(re)?.[0]?.trim() || "";
}

/** 「練習問題 N」块与「練習問題 N+1」之间若夹有「第n章 まとめの問題」，后者不匹配練習題标题，会被误并入上一块（如第6日与第8日之间的章末小结）。横线欠落時も検出できるよう「第n章 まとめ」単独行も見る */
function indexOfChapterSummaryAfter(body, fromIndex) {
  const tail = body.slice(fromIndex);
  const patterns = [
    /\n\s*-{10,}\s*\n\s*#{0,2}\s*第\s*\d+\s*章\s+まとめの問題/,
    /\n\s*#{0,2}\s*第\s*\d+\s*章\s+まとめの問題/,
  ];
  let best = body.length;
  for (const re of patterns) {
    const m = re.exec(tail);
    if (m) best = Math.min(best, fromIndex + m.index);
  }
  return best;
}

/** 切片後もまとめ見出しが残る場合の保険（第13日に（1）試合の…が混入するのを防ぐ） */
function truncateBeforeChapterSummaryFence(slice) {
  const text = String(slice || "");
  const re =
    /\n\s*-{10,}\s*\n\s*#{0,2}\s*第\s*\d+\s*章\s+まとめの問題|\n\s*#{0,2}\s*第\s*\d+\s*章\s+まとめの問題/;
  const m = re.exec(text);
  return m ? text.slice(0, m.index).trimEnd() : text;
}

/** 参考答案先頭の「4 練習問題」行は UI 已与「第×日」对齐，除去以避免与①②题号混淆 */
function stripLeadingExerciseAnswerCaption(text) {
  let s = String(text || "").trim();
  s = s.replace(/^第\s*\d+\s*章\s*\n+/, "").replace(/^\d+\s+練習問題\s*\n/, "");
  return s.trim();
}

function splitClozeSetIntoSections(set) {
  if (set.kind !== "cloze") return [set];
  const body = String(set.body || "");
  const headingRe = /^(?:##\s*)?(?:第(\d+)日\s+)?練習問題\s*(\d+)?[^\n]*$/gm;
  const hits = [...body.matchAll(headingRe)].filter((hit) => hit.index != null);
  if (hits.length === 0) {
    if (/^第\d+章 第\d+日 练习问题(?: \d+)?$/.test(String(set.title || ""))) return [set];
    const chapterNo = Number(set.chapterNo);
    const sectionNo = Number(set.sectionNo);
    if (chapterNo && sectionNo) {
      const dayNo = practiceDayFromSection(chapterNo, sectionNo, set);
      const normalizedTitle = formatPracticeTitle(chapterNo, dayNo);
      return [{
        ...set,
        title: normalizedTitle,
        sectionTitle: normalizedTitle,
        dayNo,
      }];
    }
    return [set];
  }

  const out = [];
  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i];
    const start = hit.index;
    let end = i + 1 < hits.length ? hits[i + 1].index : body.length;
    end = Math.min(end, indexOfChapterSummaryAfter(body, start));
    const sectionSlice = truncateBeforeChapterSummaryFence(body.slice(start, end));
    const sectionBody = cleanClozeBody(sectionSlice);
    if (!looksLikeHomework(sectionBody)) continue;

    const dayNo = hit[1] ? Number(hit[1]) : null;
    const exerciseNo = hit[2] ? Number(hit[2]) : null;
    const rawTitle = hit[0].replace(/^##\s*/, "").trim();
    /** mergeTinyPanels が「練習問題」単独行を残すと exerciseNo が無く章別答案へ誤フォールバックする */
    const rawTitleHead = rawTitle.split("\n")[0].trim();
    if (/^練習問題\s*$/.test(rawTitleHead)) continue;
    const rawSectionNo = dayNo || exerciseNo || i + 1;
    const mappedDayNo = practiceDayFromSection(set.chapterNo, rawSectionNo, { ...set, dayNo: null });
    const subNo = dayNo && exerciseNo ? exerciseNo : null;
    const sectionTitle = formatPracticeTitle(set.chapterNo, mappedDayNo, subNo);
    const chapterAnswers =
      Number(set.chapterNo) > 0 ? answerSliceByChapter(set.answers, set.chapterNo) || set.answers : set.answers;
    let sectionAnswers =
      answerSliceByHeading(set.answers, rawTitle) ||
      (exerciseNo != null ? answerSliceByExerciseNumber(chapterAnswers, exerciseNo) : "") ||
      (exerciseNo != null ? "" : set.answers);
    sectionAnswers = sanitizeClozeAnswersText(stripLeadingExerciseAnswerCaption(sectionAnswers));

    out.push({
      ...set,
      title: sectionTitle,
      sectionTitle,
      sectionNo: rawSectionNo,
      dayNo: mappedDayNo,
      body: sectionBody,
      answers: sectionAnswers,
    });
  }
  return out.length ? out : [set];
}

function parseMarkdownExerciseClozeSets(fullText, file) {
  const answerStart = fullText.search(/\n={10,}\n解答\s*\n={10,}\n/);
  if (answerStart === -1) return [];
  const qText = fullText.slice(0, answerStart);
  const aText = fullText.slice(answerStart);
  /** 讲义常在「章末最后一日」与「下一章首日」之间插入「第n章 まとめの問題」，仅用下一 `第○日` 标题切片会把まとめ并进前一日的练习正文。（勿用 \\b：日文「題」后与换行不构成 ASCII 词边界） */
  const indexOfChapterSummaryHeadingAfterMarkdown = (text, fromIndex) => {
    const tail = text.slice(fromIndex);
    const m = /\n(?:##\s*)?第\s*\d+\s*章\s+まとめの問題/.exec(tail);
    return m ? fromIndex + m.index : text.length;
  };
  const headingRe = /^(?:##\s*)?((?:第(\d+)日\s+)?練習問題[^\n]*)\s*$/gm;
  const hits = [...qText.matchAll(headingRe)];
  const sets = [];
  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i];
    const title = hit[1].trim();
    const day = hit[2] ? Number(hit[2]) : null;
    const start = hit.index;
    const nextHitEnd = i + 1 < hits.length ? hits[i + 1].index : qText.length;
    const summaryEnd = indexOfChapterSummaryHeadingAfterMarkdown(qText, start);
    let end = Math.min(nextHitEnd, summaryEnd);
    if (end <= start) end = Math.min(nextHitEnd, qText.length);
    const body = cleanClozeBody(qText.slice(start, end));
    if (!looksLikeHomework(body)) continue;
    const chapterNo = day ? chapterFromPracticeDay(day, file) : chapterRangeFromFile(file)[0];
    if (!chapterNo) continue;
    const subNoMatch = title.match(/練習問題\s+(\d+)$/);
    const exerciseNo = subNoMatch ? Number(subNoMatch[1]) : null;
    const subNo = exerciseNo && day ? exerciseNo : null;
    const sectionNo = day || exerciseNo || i + 1;
    const dayNo = day || practiceDayFromSection(chapterNo, sectionNo, { sourceFile: file });
    const displayTitle = formatPracticeTitle(chapterNo, dayNo, subNo);
    sets.push(
      cloneSetForChapter(
        {
          kind: "cloze",
          title: displayTitle,
          sectionTitle: displayTitle,
          sectionNo,
          dayNo,
          body,
          answers: sanitizeClozeAnswersText(
            stripMarkdownDayPracticeHeading(
              answerSliceByHeading(aText, title) || answerSliceByChapter(aText, chapterNo),
            ),
          ),
        },
        chapterNo,
      ),
    );
  }
  return sets;
}

function parseInlineDayClozeSets(fullText, file) {
  const headingRe = /^第(\d+)日\s+練習問題\s*$/gm;
  const hits = [...fullText.matchAll(headingRe)].filter((hit) => hit.index != null);
  const sets = [];
  for (let i = 0; i < hits.length; i++) {
    const day = Number(hits[i][1]);
    const start = hits[i].index;
    const end = i + 1 < hits.length ? hits[i + 1].index : fullText.length;
    let block = fullText.slice(start, end).trim();
    block = block.split(/\n={10,}\n第\d+章\s+まとめの問題/)[0].trim();
    block = block.split(/\n={10,}\n第\d+日補足[:：]/)[0].trim();
    const qa = block.split(/\n解答[:：]\s*\n/);
    if (qa.length < 2 || !looksLikeHomework(qa[0])) continue;
    const chapterNo = chapterFromPracticeDay(day, file);
    if (!chapterNo) continue;
    const title = `第${day}日 練習問題`;
    const displayTitle = formatPracticeTitle(chapterNo, day);
    sets.push(
      cloneSetForChapter(
        {
          kind: "cloze",
          title: displayTitle,
          sectionTitle: displayTitle,
          sectionNo: day,
          dayNo: day,
          body: cleanClozeBody(qa[0]),
          answers: sanitizeClozeAnswersText(qa.slice(1).join("\n解答：\n").trim()),
        },
        chapterNo,
      ),
    );
  }
  return sets;
}

function chapterRawFromSets(sourceTitle, sourceFile, chapterNo, sets) {
  const sections = sets.map((set) => {
    if (set.kind === "cloze") {
      return [
        `## ${set.title}`,
        set.body || "",
        "",
        "### 参考答案",
        set.answers || "（未收录）",
      ].join("\n").trim();
    }
    return [
      `## ${set.title}`,
      ...(set.questions || []).map((q) => `${q.id} ${q.promptTemplate || ""}`),
    ].join("\n").trim();
  });
  return [
    `# ${sourceTitle} · 第${chapterNo}章`,
    `来源：${sourceFile}`,
    "",
    ...sections,
  ].join("\n\n").trim();
}

function makeChapterBundles(file, title, sets) {
  const chapterNos = new Set(chapterRangeFromFile(file));
  for (const set of sets) {
    if (set.chapterNo) chapterNos.add(Number(set.chapterNo));
  }
  return [...chapterNos].sort((a, b) => a - b).flatMap((chapterNo) => {
    const chapterSets = sets.filter((set) => Number(set.chapterNo) === chapterNo);
    const clozeSets = chapterSets.filter((set) => set.kind === "cloze");
    const summarySets = chapterSets.filter((set) => set.kind !== "cloze");
    const common = {
      file,
      sourceFile: file,
      chapterNo,
    };
    const bundles = [];
    if (clozeSets.length) {
      bundles.push({
        ...common,
        id: `${bundleId(file)}-chapter-${chapterNo}-practice`,
        group: "practice",
        title: `第${chapterNo}章 课后练习`,
        sets: clozeSets,
        raw: chapterRawFromSets(title, file, chapterNo, clozeSets),
      });
    }
    if (summarySets.length) {
      bundles.push({
        ...common,
        id: `${bundleId(file)}-chapter-${chapterNo}-summary`,
        group: "summary",
        title: `第${chapterNo}章 まとめの問題`,
        sets: summarySets,
        raw: chapterRawFromSets(title, file, chapterNo, summarySets),
      });
    }
    if (!bundles.length) {
      bundles.push({
        ...common,
        id: `${bundleId(file)}-chapter-${chapterNo}-empty`,
        group: "practice",
        title: `第${chapterNo}章 课后练习`,
        sets: [],
        raw: chapterRawFromSets(title, file, chapterNo, []),
      });
    }
    return bundles;
  });
}

function mergeChapterBundles(bundles) {
  const merged = [];
  const byChapter = new Map();
  for (const bundle of bundles) {
    if (!bundle.chapterNo) {
      merged.push(bundle);
      continue;
    }
    const key = `${bundle.chapterNo}:${bundle.group || "practice"}`;
    const existing = byChapter.get(key);
    if (!existing) {
      const copy = {
        ...bundle,
        sourceFiles: [bundle.sourceFile || bundle.file].filter(Boolean),
      };
      byChapter.set(key, copy);
      merged.push(copy);
      continue;
    }
    existing.sets.push(...bundle.sets);
    if (bundle.raw) existing.raw = `${existing.raw}\n\n---\n\n${bundle.raw}`.trim();
    const source = bundle.sourceFile || bundle.file;
    if (source && !existing.sourceFiles.includes(source)) existing.sourceFiles.push(source);
    existing.file = existing.sourceFiles.join(" + ");
  }
  for (const bundle of merged) {
    if (bundle.group === "practice" && Array.isArray(bundle.sets)) {
      bundle.sets.sort((a, b) => {
        const ad = Number(a.dayNo || a.sectionNo || 999);
        const bd = Number(b.dayNo || b.sectionNo || 999);
        return ad - bd || String(a.title).localeCompare(String(b.title), "zh-Hans-CN");
      });
    } else if (bundle.group === "summary" && Array.isArray(bundle.sets)) {
      const byTitle = new Map();
      for (const set of bundle.sets) {
        const title = set.title || "まとめの問題";
        if (!byTitle.has(title)) byTitle.set(title, { ...set, questions: [] });
        const target = byTitle.get(title);
        const byId = new Map(target.questions.map((q) => [q.id, q]));
        for (const q of set.questions || []) {
          const prev = byId.get(q.id);
          const prevHasBlank = String(prev?.promptTemplate || "").includes("＿＿＿＿");
          const nextHasBlank = String(q.promptTemplate || "").includes("＿＿＿＿");
          if (!prev || (!prevHasBlank && nextHasBlank) || String(q.promptTemplate || "").length > String(prev.promptTemplate || "").length) {
            byId.set(q.id, q);
          }
        }
        target.questions = [...byId.values()].sort((a, b) => {
          const an = Number(String(a.id).match(/\d+/)?.[0] || 999);
          const bn = Number(String(b.id).match(/\d+/)?.[0] || 999);
          return an - bn;
        });
      }
      bundle.sets = [...byTitle.values()];
    }
  }
  return merged.sort((a, b) => {
    const ao = a.chapterNo ? Number(a.chapterNo) : a.id === "review-edition-cloze" ? -1 : 999;
    const bo = b.chapterNo ? Number(b.chapterNo) : b.id === "review-edition-cloze" ? -1 : 999;
    const ag = a.group === "summary" ? 1 : 0;
    const bg = b.group === "summary" ? 1 : 0;
    return ao - bo || ag - bg || String(a.title).localeCompare(String(b.title), "zh-Hans-CN");
  });
}

function refreshReviewClozeJson() {
  const script = path.join(__dirname, "extract_review_cloze.py");
  const bins = [
    path.join(__dirname, "..", "..", ".venv", "bin", "python3"),
    path.join(__dirname, "..", "..", ".venv", "bin", "python"),
    "python3",
  ];
  for (const bin of bins) {
    try {
      execFileSync(bin, [script], { stdio: "ignore" });
      return;
    } catch {
      /* try next interpreter */
    }
  }
}

function loadReviewClozeBundle() {
  const p = path.join(__dirname, "..", "review-cloze.json");
  if (!fs.existsSync(p)) return null;
  let data;
  try {
    data = JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
  const sets = (data.chapters || []).map((c) => ({
    kind: "cloze",
    title: `第${c.chapterNo ?? "?"}章 · ${c.title}`,
    body: `${c.body || ""}\n\n〔来源：${c.source || ""}〕`.trim(),
    answers: String(c.answers || "").trim(),
  }));
  if (!sets.length) return null;
  return {
    id: "review-edition-cloze",
    file: "review-cloze.json",
    title: "复习版讲义 · 完形（Markdown／PDF）",
    sets,
    raw: "",
  };
}

/** 面板内「解答」「解答：」分段 */
function splitInlineQA(panel) {
  const m = /\n解答[:：]?\s*\n/.exec(panel);
  if (!m) return null;
  return { q: panel.slice(0, m.index).trim(), a: panel.slice(m.index + m[0].length).trim() };
}

/** （　）／半角 ()、顿号逗号分隔 */
function parseQuestionLine(line) {
  const m = /^([①-⑳])\s*(.+)$/.exec(line.trim());
  if (!m) return null;
  const num = m[1];
  const rest = m[2];
  const groups = [];
  const chunks = [];
  let pos = 0;
  const re = /[（(]([^）)]+)[）)]/g;
  let match;
  while ((match = re.exec(rest)) !== null) {
    const inner = match[1];
    if (!/[／、,/／]/.test(inner)) continue;
    const opts = inner.split(/[／、,／]/).map((s) => s.trim()).filter(Boolean);
    if (opts.length < 2) continue;
    chunks.push(rest.slice(pos, match.index));
    groups.push(opts);
    pos = match.index + match[0].length;
  }
  chunks.push(rest.slice(pos));
  if (!groups.length) return null;
  return { num, chunks, groups };
}

function parseAnswerPanelCircled(text) {
  const cleaned = text
    .replace(/^解答[^\n]*\n/m, "")
    .replace(/^#{1,6}\s+[^\n]+\n/gm, "");
  const map = {};
  const re = /([①-⑳])\s*/g;
  let match;
  const hits = [];
  while ((match = re.exec(cleaned)) !== null) {
    hits.push({
      num: match[1],
      contentStart: match.index + match[0].length,
      markerStart: match.index,
    });
  }
  for (let i = 0; i < hits.length; i++) {
    const contentEnd = i + 1 < hits.length ? hits[i + 1].markerStart : cleaned.length;
    const chunk = cleaned.slice(hits[i].contentStart, contentEnd).trim();
    const answers = chunk.split(/[・･]/).map((s) => s.trim()).filter(Boolean);
    map[hits[i].num] = answers;
  }
  return map;
}

function stripAnswerNoise(s) {
  return String(s)
    .replace(/\（[^）]+\）/g, "")
    .replace(/^[abAB]\s*[（(]?[^）)]*[）)]?\s*/, "")
    .trim();
}

function pickMatchingOption(options, rawCorrect) {
  const stripped = stripAnswerNoise(rawCorrect);
  const nc = norm(stripped);
  let best = options.find((o) => norm(o) === nc);
  if (best) return best;
  best = options.find((o) => nc.includes(norm(o)) || norm(o).includes(nc));
  return best || stripped || rawCorrect;
}

function blankIsValid(blank) {
  return blank.options.some((o) => norm(o) === norm(blank.correct));
}

function chunkToPrompt(chunks) {
  return chunks.map((c, i) => (i < chunks.length - 1 ? `${c}_` : c)).join("");
}

function splitQuestionSubpanels(panel) {
  const chunks = panel.split(/(?=^##\s*練習問題\b)/m).map((s) => s.trim()).filter(Boolean);
  const useful = chunks.filter((c) => !/^練習問題\s*$/.test(c));
  return useful.length ? useful : [panel.trim()];
}

function splitAnswerSubpanels(panel) {
  const body = panel.replace(/^解答\s*\n?/m, "").trim();
  const chunks = body.split(/(?=^##\s*練習問題\b)/m).map((s) => s.trim()).filter(Boolean);
  return chunks.length ? chunks : [body];
}

function parseCircledExerciseBlock(questionText, answerText) {
  const lines = questionText.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const questionLines = lines.filter((l) => /^[①-⑳]/.test(l));
  if (questionLines.length < 1) return null;
  const parsed = questionLines.map(parseQuestionLine).filter(Boolean);
  if (parsed.length < 1) return null;
  const answerMap = parseAnswerPanelCircled(answerText);
  const questions = parsed
    .map((q) => {
      const expected = answerMap[q.num];
      if (!expected || expected.length !== q.groups.length) return null;
      const blanks = q.groups.map((options, bi) => {
        const opts = [...new Set(options)];
        const raw = expected[bi];
        const correct = pickMatchingOption(opts, raw);
        return { options: opts, correct };
      });
      if (!blanks.every(blankIsValid)) return null;
      return {
        id: q.num,
        promptTemplate: chunkToPrompt(q.chunks),
        blanks,
      };
    })
    .filter(Boolean);
  if (questions.length < 1) return null;
  const titleLine =
    lines.find((l) => /^練習問題/.test(l) || /^##\s*練習問題/.test(l)) || "选择题";
  return {
    title: titleLine.replace(/^#+\s*/, "").replace(/-+/g, "").trim() || "練習問題",
    questions,
  };
}

/** 「1. aa　2. bb」同行或多行；「…ず2.…」无空格粘连也用 (?=\d+\.) 拆开 */
function parseDenseOptionsLine(line) {
  const trimmed = line.trim();
  if (!/^\d+\./.test(trimmed)) return [];
  const rawParts = trimmed
    .split(/(?=\d+\.)/)
    .map((p) => p.trim())
    .filter((p) => /^\d+\./.test(p));
  const opts = [];
  for (const part of rawParts) {
    const m = /^(\d+)\.\s*(.+)$/.exec(part);
    if (m) opts.push({ n: Number(m[1]), t: m[2].trim() });
  }
  return opts.sort((a, b) => a.n - b.n).map((x) => x.t);
}

/** （n）stem + 选项块 */
function parseNumberedMcQuestions(qText) {
  const lines = qText.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const items = [];
  let i = 0;
  while (i < lines.length) {
    const mh = /^[（(](\d+)[）)]\s*(.*)$/.exec(lines[i]);
    if (!mh) {
      i++;
      continue;
    }
    const id = mh[1];
    let stem = mh[2] || "";
    i++;
    const optionTexts = [];
    while (i < lines.length && !/^[（(]\d+[）)]/.test(lines[i])) {
      const line = lines[i];
      const dense = parseDenseOptionsLine(line);
      /** 同行「1.…2.…」解析出多项后，仍需继续读后续独占行的「3.」「4.」等（否则第2章（6）等会只剩两项） */
      if (dense.length >= 2) {
        optionTexts.push(...dense);
        i++;
        while (i < lines.length && !/^[（(]\d+[）)]/.test(lines[i])) {
          const ln = lines[i];
          if (/^\d+\./.test(ln.trim())) {
            optionTexts.push(...parseDenseOptionsLine(ln));
            i++;
            continue;
          }
          break;
        }
        break;
      }
      /** 常见「1.…」「2.…」各占一行；原先在此处无条件 break，只会读到一行选项 */
      if (/^\d+\./.test(line)) {
        if (dense.length === 1) {
          optionTexts.push(dense[0]);
          i++;
          continue;
        }
        optionTexts.push(...dense);
        i++;
        break;
      }
      stem += (stem ? " " : "") + line;
      i++;
    }
    const merged = [];
    const seen = new Set();
    for (const t of optionTexts) {
      const k = norm(t);
      if (!seen.has(k)) {
        seen.add(k);
        merged.push(t);
      }
    }
    if (merged.length >= 2) items.push({ id, stem: stem.trim(), options: merged });
  }
  return items;
}

/** （1）3 （2）4 或多空格分隔 */
function parseCompactParenAnswers(text) {
  const map = {};
  const re = /[（(]\s*(\d+)\s*[）)]\s*(\d+)/g;
  let m;
  while ((m = re.exec(text)) !== null) map[m[1]] = Number(m[2]);
  return map;
}

function extractExamBodyAfterSummary(segment) {
  const idx = segment.search(/まとめの問題/);
  if (idx === -1) return null;
  let body = segment.slice(idx);
  body = body.replace(/^[^\n]+\n/, "").trim();
  for (let k = 0; k < 20; k++) {
    const top = body.split("\n")[0]?.trim() || "";
    if (!/^-{10,}$/.test(top) && !/^（解答[^\n]*$/.test(top)) break;
    body = body.split("\n").slice(1).join("\n").trim();
  }
  body = body.replace(/^-{10,}\s*\n/m, "").trim();
  body = body.replace(/^（解答[^\n]*\n/m, "").trim();
  body = body.replace(/^-{10,}\s*\n/m, "").trim();
  return body;
}

/** 解答／答案面板中「第n章 … まとめの問題」后的 （1）2… 块（标题常与「解答」同行：`第8章 まとめの問題 解答`） */
function extractChapterSummaryAnswers(answerPanel, chapterNo) {
  const esc = String(chapterNo);
  const headerRe = new RegExp(
    `(?:^|\\n)#*\\s*第\\s*${esc}\\s*章[^\\n]*まとめの問題(?:\\s+解答)?\\s*\\n`,
  );
  const hm = headerRe.exec(answerPanel);
  if (!hm) return null;
  const start = hm.index + hm[0].length;
  const tail = answerPanel.slice(start);
  const endMatch = tail.match(/\n#*\s*第\s*\d+\s*章|\n={60,}\n|\n基本文法\b/);
  const blob = endMatch ? tail.slice(0, endMatch.index) : tail;
  return blob.trim();
}

function ensureSummaryBlank(stem) {
  let text = String(stem || "").trim().replace(/　+/g, " ");
  if (/[＿_]+/.test(text)) return text.replace(/[＿_]+/g, "＿＿＿＿");
  if (!text) return text;

  // In the scanned PDF, answer blanks are horizontal rules. OCR usually keeps
  // them as gaps inside the sentence; never invent a blank at sentence end.
  text = text
    .replace(/([ぁ-んァ-ヶ一-龯])\s*[・－-]\s*([ぁ-んァ-ヶ一-龯、，,.])/, "$1＿＿＿＿$2")
    .replace(/([ぁ-んァ-ヶ一-龯])\s+([、，,.])/, "$1＿＿＿＿$2")
    .replace(/([ぁ-んァ-ヶ一-龯])。 ([ぁ-んァ-ヶ一-龯])/, "$1＿＿＿＿$2");
  if (/\s{2,}/.test(text)) return text.replace(/\s{2,}/, "＿＿＿＿");

  const internalGapPatterns = [
    /([ぁ-んァ-ヶ一-龯])\s+((?:は|が|を|に|で|と|から|まで|なら|ない|だ|でしょう|です|のこと|のため))/,
    /((?:に|を|が|は|で|と|の|る|て|た|ない|より|まで|から|ほど|くらい))\s+([ぁ-んァ-ヶ一-龯])/,
    /([ぁ-んァ-ヶ一-龯])\s+([ぁ-んァ-ヶ一-龯])/,
  ];
  for (const re of internalGapPatterns) {
    if (re.test(text)) return text.replace(re, "$1＿＿＿＿$2");
  }
  return text;
}

const SUMMARY_PROMPT_OVERRIDES = {
  "1:1": "この会社に＿＿＿＿彼の影響力は、どんどん大きくなっていった。",
  "1:4": "この場所で営業することは、法律に＿＿＿＿禁じられている。",
  "3:3": "新曲が発売されることになり、それ＿＿＿＿プロモーションビデオが公開された。",
  "3:13": "彼は5年前に事故を起こして以来、＿＿＿＿",
  "3:14": "この仕事は、最初はつまらないと思ったが、やっているうちに＿＿＿＿",
};

/** 解答区占位（如「（25）【需核对】」）未写选项序号时的兜底 */
const SUMMARY_ANSWER_MANUAL = {
  8: { 25: 1 },
};

function buildNumberedExamSet(items, ansMap, title) {
  const questions = [];
  const chapterNo = Number(String(title || "").match(/第\s*(\d+)\s*章/)?.[1] || 0);
  for (const it of items) {
    const digit = ansMap[it.id];
    if (!digit || digit < 1 || digit > it.options.length) continue;
    const correct = it.options[digit - 1];
    if (!correct) continue;
    const opts = [...new Set(it.options)];
    if (!opts.some((o) => norm(o) === norm(correct))) continue;
    questions.push({
      id: `（${it.id}）`,
      promptTemplate: SUMMARY_PROMPT_OVERRIDES[`${chapterNo}:${it.id}`] || ensureSummaryBlank(it.stem),
      blanks: [{ options: opts, correct }],
    });
  }
  if (questions.length < 1) return null;
  return { title, questions };
}

/** 横线分段内的多个「まとめの問題」 */
function parseChapterSummarySets(questionPanel, answerPanel) {
  const sets = [];
  const parts = questionPanel.split(/\n-{10,}\n|(?=\n##?\s*第\s*\d+\s*章\s+まとめの問題)/);
  for (let pi = 0; pi < parts.length; pi++) {
    let seg = parts[pi];
    if (!seg.includes("まとめの問題")) continue;
    /** 「第n章＋まとめ」常被夹在两条 --- 之间单独成段，题干在下一分段 */
    let guard = 0;
    while (
      guard++ < 40 &&
      pi + 1 < parts.length &&
      !/[（(]\s*1\s*[）)]/.test(seg)
    ) {
      const nextTrim = parts[pi + 1].trim();
      if (/^練習問題\b/.test(nextTrim)) break;
      pi++;
      seg = `${seg}\n${parts[pi]}`;
    }
    const chm = seg.match(/第\s*(\d+)\s*章/);
    const chapterNo = chm ? chm[1] : null;
    const body = extractExamBodyAfterSummary(seg);
    if (!body) continue;
    const items = parseNumberedMcQuestions(body);
    if (items.length < 1) continue;
    let ansMap = {};
    if (chapterNo && /^(解答|答案)/.test(firstLine(answerPanel))) {
      const blob = extractChapterSummaryAnswers(answerPanel, chapterNo);
      if (blob) ansMap = parseCompactParenAnswers(blob);
    }
    if (!Object.keys(ansMap).length && /^(解答|答案)/.test(firstLine(answerPanel))) {
      ansMap = parseCompactParenAnswers(answerPanel);
    }
    const cn = chapterNo ? Number(chapterNo) : null;
    if (cn != null && SUMMARY_ANSWER_MANUAL[cn]) {
      for (const [qid, digit] of Object.entries(SUMMARY_ANSWER_MANUAL[cn])) {
        if (ansMap[qid] == null || Number.isNaN(ansMap[qid])) ansMap[qid] = digit;
      }
    }
    const title = chapterNo ? `第${chapterNo}章 まとめの問題` : "まとめの問題";
    const ex = buildNumberedExamSet(items, ansMap, title);
    if (ex) sets.push(ex);
  }
  return sets;
}

/** n. …［a／b／c］… + 解答区 n. 答案 */
function parseBracketNumberedExam(qText, aText) {
  const qLines = qText.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const bracketRe = /［([^］]+)］/;
  const items = [];
  for (const line of qLines) {
    const mh = /^(\d+)\.\s*(.+)$/.exec(line);
    if (!mh) continue;
    const bm = bracketRe.exec(mh[2]);
    if (!bm) continue;
    const opts = bm[1].split(/[／]/).map((s) => s.trim()).filter(Boolean);
    if (opts.length < 2) continue;
    const stem = mh[2].replace(bracketRe, "____").trim();
    items.push({ id: mh[1], stem, options: opts });
  }
  const ansMap = {};
  for (const line of aText.split(/\n/)) {
    const t = line.trim();
    const am = /^(\d+)\.\s*(.+)$/.exec(t);
    if (am) ansMap[am[1]] = am[2].trim();
  }
  const questions = [];
  for (const it of items) {
    const raw = ansMap[it.id];
    if (!raw) continue;
    const correct = pickMatchingOption(it.options, raw);
    if (!blankIsValid({ options: it.options, correct })) continue;
    questions.push({
      id: it.id,
      promptTemplate: it.stem.replace(/____/, "_"),
      blanks: [{ options: [...new Set(it.options)], correct }],
    });
  }
  if (questions.length < 1) return null;
  return { title: "［選択］練習", questions };
}

function parseInlineMixedFormats(qPart, aPart) {
  const sets = [];
  const strippedQ = stripMatomeSegments(qPart);
  if (strippedQ.length > 25 && looksLikeHomework(strippedQ)) {
    sets.push({
      kind: "cloze",
      title: "練習問題（全文・完形）",
      body: strippedQ.replace(/^#\s[^\n]+\n+/, "").trim(),
      answers: stripAnswerPanelNoise(aPart),
    });
  }
  if (qPart.includes("まとめの問題")) {
    sets.push(...parseChapterSummarySets(`${qPart}\n`, `解答\n${aPart}`));
  }
  return sets;
}

function parseAdjacentPanels(_chunk, _answerChunk) {
  /** 括号小题改为相邻面板的「全文完形」，见 buildClozeFromPanels */
  return [];
}

function buildSets(fullText, fallbackAnswerPanel = "") {
  const panels = prependAnswerStubForChapterSummary(
    mergeAnswerTitleStub(mergeTinyPanels(splitPanels(fullText))),
  );
  const sets = [];
  const localAnswerPanel = panels.find((p) => /^(解答|答案)/.test(firstLine(p))) || "";
  const globalAnswerPanel = localAnswerPanel || fallbackAnswerPanel || "";

  for (let i = 0; i < panels.length; i++) {
    const chunk = panels[i];
    if (/^(解答|答案)/.test(firstLine(chunk))) continue;
    /** 文件头的 markdown 标题面板（不含练习题正文） */
    if (/^#\s/.test(firstLine(chunk)) && !chunk.includes("練習問題") && !chunk.includes("まとめの問題"))
      continue;

    const inline = splitInlineQA(chunk);
    if (inline && inline.q.length > 20) {
      const extra = parseInlineMixedFormats(inline.q, inline.a);
      if (extra.length) sets.push(...extra);
      continue;
    }

    const next = panels[i + 1];
    const nextHead = next ? firstLine(next) : "";
    if (next && /^(解答|答案)/.test(nextHead)) {
      const clozeSet = buildClozeFromPanels(chunk, next);
      if (clozeSet) sets.push(clozeSet);

      sets.push(...parseChapterSummarySets(chunk, next));
      i++;
      continue;
    }

    if (globalAnswerPanel) {
      if (localAnswerPanel) {
        const looseCloze = buildClozeFromPanels(chunk, globalAnswerPanel);
        if (looseCloze) sets.push(looseCloze);
      }
      sets.push(...parseChapterSummarySets(chunk, globalAnswerPanel));
    }
  }

  const seen = new Set();
  const deduped = [];
  for (const s of sets) {
    const key = setDedupKey(s);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(s);
  }
  return deduped;
}

function bundleId(filename) {
  return filename.replace(/\.txt$/i, "").replace(/\s+/g, "-");
}

function run() {
  refreshReviewClozeJson();
  if (!fs.existsSync(PRACTICE_DIR)) {
    console.error("Missing directory:", PRACTICE_DIR);
    process.exit(1);
  }
  const files = fs.readdirSync(PRACTICE_DIR).filter((f) => f.endsWith(".txt")).sort();
  const bundles = [];
  const reviewBundle = loadReviewClozeBundle();
  if (reviewBundle) bundles.push(reviewBundle);
  /** 不使用「语法答案」全书 OCR 作兜底：易与本章题干错位；请以各章 txt 文末「解答／答案」为准。 */
  const fallbackAnswerPanel = "";
  for (const file of files) {
    const full = path.join(PRACTICE_DIR, file);
    const raw = fs.readFileSync(full, "utf8");
    const titleMatch = raw.match(/^#\s*(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : file;
    const skipParsed = /语法答案/.test(file);
    if (skipParsed) {
      continue;
    }
    let parsedSets = buildSets(raw, fallbackAnswerPanel);
    if (/4-5章|6章/.test(file)) {
      parsedSets = parsedSets.filter((set) => set.kind !== "cloze");
      parsedSets.push(...parseMarkdownExerciseClozeSets(raw, file));
    }
    if (/7章|8-9章/.test(file)) {
      const inlineDaySets = parseInlineDayClozeSets(raw, file);
      if (inlineDaySets.length) {
        parsedSets = parsedSets.filter((set) => set.kind !== "cloze");
        parsedSets.push(...inlineDaySets);
      }
    }
    const sets = prepareChapterSets(parsedSets, file);
    bundles.push(...makeChapterBundles(file, title, sets));
  }
  const outputBundles = mergeChapterBundles(bundles);
  const payload = { bundles: outputBundles, builtAt: new Date().toISOString() };
  const js = `/* auto-generated by scripts/build-practice-data.mjs — do not edit */
window.N1N2_PRACTICE = ${JSON.stringify(payload)};
`;
  fs.writeFileSync(OUT, js, "utf8");
  const setCount = outputBundles.reduce((n, b) => n + b.sets.length, 0);
  const interactiveCount = outputBundles.reduce(
    (n, b) => n + b.sets.reduce((m, s) => (s.kind === "cloze" ? m : m + s.questions.length), 0),
    0,
  );
  const clozeSections = outputBundles.reduce((n, b) => n + b.sets.filter((s) => s.kind === "cloze").length, 0);
  console.log(
    "Wrote",
    OUT,
    "| bundles:",
    outputBundles.length,
    "sets:",
    setCount,
    "interactiveQs:",
    interactiveCount,
    "clozeSections:",
    clozeSections,
  );
}

run();
