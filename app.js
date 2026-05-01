const cards = window.N1N2_CARDS || [];
const practiceBundles = window.N1N2_PRACTICE?.bundles || [];
const STORAGE_KEY = "n1n2GrammarCardProgress.v1";
const MEMORY_POSITION_KEY = "n1n2GrammarMemoryPosition.v1";

let progress = loadProgress();
let mode = "memory";
let index = 0;
let randomOrder = false;
let practiceState = null;
let currentList = [];
let testState = null;

const $ = (id) => document.getElementById(id);

function loadProgress() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return saved && typeof saved === "object" ? saved : {};
  } catch {
    return {};
  }
}

function saveProgress() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
}

function exitImmersive() {
  document.body.classList.remove("immersive-learning");
  const bar = $("immersiveExitBar");
  bar?.classList.add("hidden");
  bar?.setAttribute("aria-hidden", "true");
}

async function enterImmersive() {
  document.body.classList.add("immersive-learning");
  const bar = $("immersiveExitBar");
  bar?.classList.remove("hidden");
  bar?.setAttribute("aria-hidden", "false");
  try {
    await document.documentElement.requestFullscreen({ navigationUI: "hide" });
  } catch (_) {
    /* 浏览器权限、非 HTTPS 或设备不支持时仍可仅用 CSS 铺满窗口 */
  }
}

async function toggleImmersive() {
  if (document.body.classList.contains("immersive-learning")) {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
    } catch (_) {}
    exitImmersive();
  } else {
    await enterImmersive();
  }
}

function saveMemoryPosition(card) {
  if (mode === "memory" && card?.id) {
    localStorage.setItem(MEMORY_POSITION_KEY, card.id);
  }
}

function restoreMemoryPosition() {
  const savedId = localStorage.getItem(MEMORY_POSITION_KEY);
  if (!savedId) return;
  const savedIndex = filteredCards().findIndex(card => card.id === savedId);
  if (savedIndex >= 0) index = savedIndex;
}

function statusOf(card) {
  return progress[card.id]?.status || "new";
}

function statusText(status) {
  return { new: "未完成", weak: "不熟悉", mastered: "已掌握" }[status] || "未完成";
}

function statusClass(status) {
  return { new: "bad", weak: "warn", mastered: "good" }[status] || "bad";
}

function recordReview(card, status, score = null) {
  progress[card.id] = {
    status,
    score,
    updatedAt: new Date().toISOString(),
    reviews: (progress[card.id]?.reviews || 0) + 1,
  };
  saveProgress();
}

function mark(card, status, score = null) {
  recordReview(card, status, score);
  renderAll(false);
}

function examLevelOf(card) {
  return card.examLevel === "N1" ? "N1" : "N2";
}

/** 仅用于卡片记忆：可检索词条标题 + 日文「意味」列表（不含中文、例文等） */
function memorySearchText(card) {
  const meanings = Array.isArray(card.meaning) ? card.meaning : [];
  return [card.title, ...meanings].filter(Boolean).join(" ");
}

function filteredCards() {
  const chapter = $("chapterFilter").value;
  const status = $("statusFilter").value;
  const exam = $("examLevelFilter").value;
  const useMemorySearch = mode === "memory";
  const q = useMemorySearch ? $("searchInput").value.trim().toLowerCase() : "";
  let list = cards.filter((card) => {
    if (chapter !== "all" && String(card.chapterNo) !== chapter) return false;
    if (status !== "all" && statusOf(card) !== status) return false;
    if (exam !== "all" && examLevelOf(card) !== exam) return false;
    if (q && !memorySearchText(card).toLowerCase().includes(q)) return false;
    return true;
  });
  if (randomOrder) list = [...list].sort(() => Math.random() - 0.5);
  return list;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

/** 纯文本内按关键字高亮（大小写不敏感，与筛选逻辑一致），返回安全 HTML */
function highlightSearchHtml(rawText, query) {
  const raw = String(rawText ?? "");
  const q = String(query ?? "").trim();
  if (!q) return escapeHtml(raw);
  const lower = raw.toLowerCase();
  const qLower = q.toLowerCase();
  const qLen = q.length;
  let out = "";
  let i = 0;
  while (i < raw.length) {
    const idx = lower.indexOf(qLower, i);
    if (idx === -1) {
      out += escapeHtml(raw.slice(i));
      break;
    }
    out += escapeHtml(raw.slice(i, idx));
    const matched = raw.slice(idx, idx + qLen);
    out += `<mark class="search-hit">${escapeHtml(matched)}</mark>`;
    i = idx + qLen;
  }
  return out;
}

function listHtml(title, items, highlightQuery = "") {
  const clean = (items || []).filter(Boolean);
  if (!clean.length) return "";
  const hq = String(highlightQuery ?? "").trim();
  const liHtml = clean.map((x) => {
    const inner = hq ? highlightSearchHtml(x, hq) : escapeHtml(x);
    return `<li>${inner}</li>`;
  }).join("");
  return `<section class="answer-block"><h3>${escapeHtml(title)}</h3><ul>${liHtml}</ul></section>`;
}

function examplesHtml(examples = []) {
  if (!examples.length) return "";
  return `<section class="answer-block answer-examples"><h3>例文</h3>${examples.map(e => `<div class="example"><div class="jp">${escapeHtml(e.jp)}</div>${e.zh ? `<div>${escapeHtml(e.zh)}</div>` : ""}</div>`).join("")}</section>`;
}

function cleanMeaningText(value = "") {
  return String(value).replace(/^(中文(?:意思)?\d*|意味)[:：]\s*/, "").trim();
}

function hasKana(value = "") {
  return /[ぁ-んァ-ン]/.test(value);
}

function chineseMeanings(card) {
  const entries = (card.chinese || []).filter(Boolean);
  const explicitChinese = entries.filter(item => /^中文(?:意思)?\d*[:：]/.test(item));
  const source = explicitChinese.length ? explicitChinese : entries.filter(item => !hasKana(item));
  return source.map(cleanMeaningText).filter(Boolean);
}

function commonUsageItems(card) {
  const title = card.title;
  const rules = [
    {
      pattern: /わけだ/,
      items: [
        "常考：根据前项事实自然得出结论，常和「だから／どうりで／つまり」语感接近。",
        "易混：不是单纯原因「から」，而是“难怪／也就是说”的说明结果。",
      ],
    },
    {
      pattern: /わけにはいかない|ないわけにはいかない/,
      items: [
        "常考：社会常识、责任、人情上“不能那么做”。",
        "对比：「ないわけにはいかない」= 不能不做，常译为“必须做”。",
      ],
    },
    {
      pattern: /わけがない/,
      items: [
        "常考：强烈否定可能性，“不可能……”。",
        "易混：「わけではない」是否定判断的一部分，不是强烈断定不可能。",
      ],
    },
    {
      pattern: /わけではない/,
      items: [
        "常考：部分否定，“并不是……／并非一定……”。",
        "常和「全部／必ずしも／いつも」等范围词一起考。",
      ],
    },
    {
      pattern: /ものだ/,
      items: [
        "常考四义：当然・常识、感慨、回忆过去习惯、忠告。",
        "看到过去形「よく〜たものだ」优先判断为回忆。",
      ],
    },
    {
      pattern: /ものの/,
      items: [
        "常考：承认前项事实，后项出现不符合期待的结果。",
        "语感比「けれども」更书面，后项常带困难、未实现。",
      ],
    },
    {
      pattern: /ものか/,
      items: [
        "常考：强烈否定、反问，“哪能……／绝不……”。",
        "口语中也可作「もんか」。",
      ],
    },
    {
      pattern: /ところだった/,
      items: [
        "常考：差点发生但实际没发生，常与「もう少しで／危うく」同现。",
        "后项不能表示已经发生的结果。",
      ],
    },
    {
      pattern: /一方だ/,
      items: [
        "常考：变化只朝一个方向持续发展，前面多接变化动词。",
        "常见搭配：増える一方だ、悪くなる一方だ。",
      ],
    },
    {
      pattern: /上（に）|上に/,
      items: [
        "常考：同方向追加，“不仅……而且……”。",
        "前后评价通常同为正面或同为负面。",
      ],
    },
    {
      pattern: /末（に）|末に|あげく/,
      items: [
        "常考：经过长时间/多次过程后的结果。",
        "对比：「あげく」后项多为不理想结果；「末に」中性。",
      ],
    },
    {
      pattern: /というと|といえば|といったら/,
      items: [
        "常考区分：「というと」确认/联想；「といえば」借话题转入相关内容；「といったら」强调程度。",
        "题目常通过后项语气判断是哪一种。",
      ],
    },
    {
      pattern: /からといって|といっても/,
      items: [
        "常考：「からといって」否定“因为A就当然B”。",
        "「といっても」表示虽这么说，但实际程度有限。",
      ],
    },
    {
      pattern: /ながら（も）|つつ（も）/,
      items: [
        "常考：承认前项事实，后项逆接。",
        "「つつも」更书面，常用于心理矛盾：知っていながら／思いつつ。",
      ],
    },
    {
      pattern: /を問わず|にかかわらず|にもかかわらず/,
      items: [
        "常考：「を問わず／にかかわらず」= 不论条件如何。",
        "「にもかかわらず」= 尽管前项事实存在，后项仍出现反预期结果。",
      ],
    },
    {
      pattern: /たが最後|たきり/,
      items: [
        "常考：「たが最後」一旦发生就无法挽回。",
        "「たきり」表示某动作后状态一直没变，常见「行ったきり」。",
      ],
    },
    {
      pattern: /につき/,
      items: [
        "常考：公告、通知中的原因理由，“由于……”。",
        "也常考比例用法：一人につき、一本につき。",
      ],
    },
    {
      pattern: /一方（で）|反面|半面/,
      items: [
        "常考：同一事物的两个方面或对比并列。",
        "「反面／半面」更强调正反两面并存。",
      ],
    },
    {
      pattern: /に限って/,
      items: [
        "常考：偏偏在某种时候发生，或相信“唯独某人不会”。",
        "常带说话人的意外、不满、信任语气。",
      ],
    },
    {
      pattern: /に限らず/,
      items: [
        "常考：不限于前项，后项扩大范围。",
        "常见搭配：Aに限らずBも／AだけでなくBも。",
      ],
    },
    {
      pattern: /に応じて|に沿って|に基づいて|に即して/,
      items: [
        "常考区分：応じて=随条件变化；沿って=按方针路线；基づいて=以依据为基础；即して=贴合实际。",
        "题目常通过前项名词判断：状況、方針、資料、実情。",
      ],
    },
    {
      pattern: /によって|によると|によれば|によっては/,
      items: [
        "常考多义：「によって」原因、手段、差异、被动动作主。",
        "「によると／によれば」只表示信息来源；「によっては」表示因情况不同有时……。",
      ],
    },
    {
      pattern: /に対して|に関して|について/,
      items: [
        "常考区分：に対して=对象/对比；に関して=正式相关；について=一般话题。",
        "看到「のに対して」多判断为对比。",
      ],
    },
    {
      pattern: /として|にして|を.*として|を.*にして/,
      items: [
        "常考：身份、资格、立场、用途的设定。",
        "「として」偏身份/资格；「にして」偏设定为某状态、目标、依据。",
      ],
    },
    {
      pattern: /を中心に|をはじめ|をもとに|をきっかけに|を契機に|を皮切りに/,
      items: [
        "常考区分：中心に=以……为中心；はじめ=以……为代表；もとに=以……为基础。",
        "きっかけ/契機=契机；皮切り=一连串活动的开端。",
      ],
    },
    {
      pattern: /お／ご〜になる|れる／られる|お／ご〜する|いただく|させていただく|敬语|敬語/,
      items: [
        "常考：先判断动作是谁做的。对方动作→尊敬语；自己一方动作→谦让语。",
        "注意二重敬语：如「おっしゃられる」不自然，特殊尊敬语优先。",
      ],
    },
  ];
  return rules.find(rule => rule.pattern.test(title))?.items || [];
}

function answerHtml(card, highlightQuery = "") {
  const hq = String(highlightQuery ?? "").trim();
  return `<div class="answer-grid">
    ${listHtml("意味", card.meaning, hq)}
    ${listHtml("中文意思", chineseMeanings(card))}
    ${listHtml("接续", card.connection)}
    ${listHtml("用法", card.usage)}
    ${examplesHtml(card.examples)}
    ${listHtml("注意", card.note)}
    ${listHtml("学习重点", card.focus)}
    ${listHtml("惯用法 / 常考常用", commonUsageItems(card))}
  </div>`;
}

function renderMemoryIndex(list) {
  const select = $("memoryIndexSelect");
  if (!select) return;
  if (!list.length) {
    select.innerHTML = `<option value="">无可选卡片</option>`;
    select.disabled = true;
    return;
  }
  select.disabled = false;
  let html = "";
  let currentChapter = null;
  list.forEach((card, i) => {
    if (card.chapterTitle !== currentChapter) {
      if (currentChapter !== null) html += "</optgroup>";
      currentChapter = card.chapterTitle;
      html += `<optgroup label="${escapeHtml(currentChapter)}">`;
    }
    html += `<option value="${i}">${examLevelOf(card) === "N1" ? "[N1] " : ""}${card.number}. ${escapeHtml(card.title)}</option>`;
  });
  if (currentChapter !== null) html += "</optgroup>";
  select.innerHTML = html;
  select.value = String(index);
}

function testAnswerHtml(card) {
  const examples = card.examples?.slice(0, 2) || [];
  return `<div class="test-answer-grid">
    <section>
      <h3>正确答案</h3>
      <strong>${escapeHtml(card.title)}</strong>
    </section>
    <section>
      <h3>中文意思</h3>
      <p>${escapeHtml(primaryMeaning(card))}</p>
    </section>
    <section>
      <h3>日文意思</h3>
      <p>${escapeHtml(primaryJapaneseMeaning(card))}</p>
    </section>
    ${card.connection?.length ? `<section><h3>接续</h3><ul>${card.connection.slice(0, 3).map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section>` : ""}
    ${card.focus?.length ? `<section><h3>学习重点</h3><p>${escapeHtml(card.focus[0])}</p></section>` : ""}
    ${commonUsageItems(card).length ? `<section><h3>惯用法 / 常考常用</h3><ul>${commonUsageItems(card).map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section>` : ""}
    ${examples.length ? `<section class="test-answer-wide"><h3>例文</h3>${examples.map(e => `<div class="example"><div class="jp">${escapeHtml(e.jp)}</div>${e.zh ? `<div>${escapeHtml(e.zh)}</div>` : ""}</div>`).join("")}</section>` : ""}
  </div>`;
}

function renderCard() {
  currentList = filteredCards();
  if (index >= currentList.length) index = Math.max(0, currentList.length - 1);
  const card = currentList[index];
  $("position").textContent = currentList.length ? `${index + 1} / ${currentList.length}` : "0 / 0";
  renderMemoryIndex(currentList);
  if (!card) {
    $("card").innerHTML = `<div class="empty">当前筛选条件下没有卡片。</div>`;
    return;
  }
  saveMemoryPosition(card);
  const status = statusOf(card);
  const memoryQuery = mode === "memory" ? String($("searchInput")?.value ?? "").trim() : "";
  const titleHtml = memoryQuery ? highlightSearchHtml(card.title, memoryQuery) : escapeHtml(card.title);
  $("card").innerHTML = `
    <div class="card-top">
      <div>
        <span class="badge">${escapeHtml(card.chapterTitle)}</span>
        <span class="badge">编号 ${card.number}</span>
        <span class="badge exam-badge exam-${examLevelOf(card).toLowerCase()}">${examLevelOf(card)}</span>
        <span class="badge ${statusClass(status)}">${statusText(status)}</span>
      </div>
      <span class="badge">复习 ${progress[card.id]?.reviews || 0} 次</span>
    </div>
    <h2 class="grammar-title">${titleHtml}</h2>
    <div class="answer">${answerHtml(card, memoryQuery)}</div>
    <div class="actions">
      <button class="danger" data-mark="new">还没完成</button>
      <button data-mark="weak">不熟悉</button>
      <button data-mark="mastered">已掌握</button>
    </div>`;
  document.querySelectorAll("[data-mark]").forEach(btn => {
    btn.onclick = () => mark(card, btn.dataset.mark);
  });
}

function renderStats() {
  const total = cards.length;
  const counts = { new: 0, weak: 0, mastered: 0 };
  cards.forEach(card => counts[statusOf(card)]++);
  const percent = total ? Math.round((counts.mastered / total) * 100) : 0;
  $("stats").innerHTML = `
    <div class="stat">总卡片<strong>${total}</strong></div>
    <div class="stat">未完成<strong>${counts.new}</strong></div>
    <div class="stat">不熟悉<strong>${counts.weak}</strong></div>
    <div class="stat">已掌握<strong>${counts.mastered} / ${percent}%</strong></div>`;
}

function shuffle(list) {
  return [...list].sort(() => Math.random() - 0.5);
}

function primaryMeaning(card) {
  return chineseMeanings(card)[0] || "暂无中文释义";
}

function primaryJapaneseMeaning(card) {
  return cleanMeaningText(card.meaning?.[0] || card.usage?.[0] || card.chinese?.[0] || card.title);
}

function optionLabel(card, type) {
  if (type === "title-to-meaning") return primaryMeaning(card);
  if (type === "title-to-japanese-meaning") return primaryJapaneseMeaning(card);
  return card.title;
}

function hasChineseMeaning(card) {
  return chineseMeanings(card).length > 0;
}

function isExcludedRegularTestCard(card) {
  return card.chapterNo === 12 && (card.number === 31 || card.number === 35);
}

function isEligibleRegularTestCard(card, type) {
  if (isExcludedRegularTestCard(card)) return false;
  if (type === "title-to-meaning" || type === "meaning-to-title") return hasChineseMeaning(card);
  return true;
}

function buildOptions(card, type) {
  const pool = cards.filter(item => item.id !== card.id && isEligibleRegularTestCard(item, type));
  const distractors = shuffle(pool).slice(0, 3);
  const choices = shuffle([card, ...distractors]);
  return choices.map(choice => ({
    id: choice.id,
    label: optionLabel(choice, type),
  }));
}

function isHonorificTestType(type) {
  return type === "honorific-plain-to-keigo" || type === "honorific-keigo-to-plain";
}

function honorificPairs() {
  const overview = cards.find(card => card.chapterNo === 12 && card.number === 31);
  let category = "";
  return (overview?.connection || []).flatMap((line, i) => {
    if (line.includes("尊敬語")) {
      category = "尊敬語";
      return [];
    }
    if (line.includes("謙譲語") || line.includes("ていねい語")) {
      category = "謙譲語・ていねい語";
      return [];
    }
    if (!line.includes("→")) return [];
    const [keigo, plain] = line.split("→").map(part => part.trim());
    if (!keigo || !plain) return [];
    return [{
      id: `honorific-${i}`,
      category,
      keigo,
      plain,
    }];
  });
}

function buildHonorificOptions(pair, type, pairs) {
  const key = type === "honorific-plain-to-keigo" ? "keigo" : "plain";
  const options = [{ id: pair.id, label: pair[key] }];
  const usedLabels = new Set(options.map(option => option.label));
  for (const item of shuffle(pairs.filter(candidate => candidate.id !== pair.id))) {
    const label = item[key];
    if (usedLabels.has(label)) continue;
    options.push({ id: item.id, label });
    usedLabels.add(label);
    if (options.length === 4) break;
  }
  return shuffle(options);
}

function honorificAnswerHtml(pair) {
  return `<div class="test-answer-grid">
    <section>
      <h3>分类</h3>
      <p>${escapeHtml(pair.category)}</p>
    </section>
    <section>
      <h3>原型</h3>
      <strong>${escapeHtml(pair.plain)}</strong>
    </section>
    <section>
      <h3>敬语表达</h3>
      <strong>${escapeHtml(pair.keigo)}</strong>
    </section>
  </div>`;
}

function startTest() {
  const type = $("testType").value;
  if (isHonorificTestType(type)) {
    startHonorificTest(type);
    return;
  }
  const source = filteredCards().filter(card => isEligibleRegularTestCard(card, type));
  if (!source.length) {
    $("testArea").innerHTML = `<div class="empty">当前筛选条件下没有可测试的卡片。看中文相关题型会自动跳过缺少中文释义的卡片。</div>`;
    return;
  }
  const requested = $("testCount").value;
  const count = requested === "all" ? source.length : Math.min(Number(requested), source.length);
  const questions = shuffle(source).slice(0, count).map(card => ({
    card,
    type,
    options: buildOptions(card, type),
    answered: false,
    selectedId: null,
    correct: false,
  }));
  testState = { questions, current: 0, correct: 0, finished: false };
  renderTest();
}

function startHonorificTest(type) {
  const pairs = honorificPairs();
  if (!pairs.length) {
    $("testArea").innerHTML = `<div class="empty">没有找到第 12 章敬语对应表，无法生成敬语专项题。</div>`;
    return;
  }
  const requested = $("testCount").value;
  const count = requested === "all" ? pairs.length : Math.min(Number(requested), pairs.length);
  const questions = shuffle(pairs).slice(0, count).map(pair => ({
    kind: "honorific",
    type,
    pair,
    prompt: type === "honorific-plain-to-keigo" ? pair.plain : pair.keigo,
    helper: type === "honorific-plain-to-keigo"
      ? `请选择对应的敬语表达。（${pair.category}）`
      : `请选择对应的原型。（${pair.category}）`,
    options: buildHonorificOptions(pair, type, pairs),
    correctId: pair.id,
    answered: false,
    selectedId: null,
    correct: false,
  }));
  testState = { questions, current: 0, correct: 0, finished: false };
  renderTest();
}

function renderTest() {
  if (!testState) {
    $("testArea").innerHTML = `<div class="empty">选择题量和题型后，点击“开始测试”。测试会使用上方筛选出来的卡片范围。</div>`;
    return;
  }
  if (testState.finished) {
    const total = testState.questions.length;
    const percent = total ? Math.round((testState.correct / total) * 100) : 0;
    const isHonorificSession = testState.questions[0]?.kind === "honorific";
    $("testArea").innerHTML = `
      <div class="test-result">
        <h3>测试完成</h3>
        <strong>${testState.correct} / ${total}，正确率 ${percent}%</strong>
        <p class="prompt">${isHonorificSession ? "敬语专项用于检查对应表掌握程度，建议把错题再测一轮。" : "答对题已计入“已掌握”，答错题已计入“不熟悉”。建议继续筛选“不熟悉”再测一轮。"}</p>
        <button id="restartTestBtn" class="primary">再测一轮</button>
      </div>`;
    $("restartTestBtn").onclick = startTest;
    return;
  }
  const question = testState.questions[testState.current];
  const card = question.card;
  const isHonorificQuestion = question.kind === "honorific";
  const isMeaningToTitle = question.type === "meaning-to-title";
  const prompt = isHonorificQuestion ? question.prompt : isMeaningToTitle ? primaryMeaning(card) : card.title;
  const helperMap = {
    "title-to-meaning": "请选择对应的中文意思。",
    "title-to-japanese-meaning": "请选择对应的日文意思。",
    "meaning-to-title": "请选择对应的日语语法。",
  };
  const helper = isHonorificQuestion ? question.helper : helperMap[question.type] || "请选择正确答案。";
  const correctId = question.correctId || card.id;
  $("testArea").innerHTML = `
    <div class="test-card">
      <div class="card-top">
        <div>
          <span class="badge">${escapeHtml(isHonorificQuestion ? "第12章 敬語专项" : card.chapterTitle)}</span>
          ${!isHonorificQuestion && card ? `<span class="badge exam-badge exam-${examLevelOf(card).toLowerCase()}">${examLevelOf(card)}</span>` : ""}
          <span class="badge">第 ${testState.current + 1} / ${testState.questions.length} 题</span>
        </div>
        <span class="badge">已答对 ${testState.correct}</span>
      </div>
      <p class="prompt">${helper}</p>
      <h2 class="grammar-title">${escapeHtml(prompt)}</h2>
      <div class="option-grid">
        ${question.options.map(option => {
          const picked = question.selectedId === option.id;
          const correct = question.answered && option.id === correctId;
          const wrong = question.answered && picked && option.id !== correctId;
          return `<button class="option ${correct ? "correct" : ""} ${wrong ? "wrong" : ""}" data-option="${escapeHtml(option.id)}">${escapeHtml(option.label)}</button>`;
        }).join("")}
      </div>
      <div id="testFeedback" class="test-feedback ${question.answered ? "" : "hidden"}">
        <div class="feedback-banner ${question.correct ? "correct" : "wrong"}">
          <strong>${isHonorificQuestion ? question.correct ? "回答正确" : "回答错误" : question.correct ? "回答正确，已计入掌握" : "回答错误，已计入不熟悉"}</strong>
          <span>${question.correct ? "继续保持，下一轮可以减少这类题。" : "先看答案摘要，再回到不熟悉筛选里补一轮。"}</span>
        </div>
        ${isHonorificQuestion ? honorificAnswerHtml(question.pair) : testAnswerHtml(card)}
      </div>
      <div class="actions">
        <button id="nextTestBtn" ${question.answered ? "" : "disabled"}>${testState.current === testState.questions.length - 1 ? "完成测试" : "下一题"}</button>
        <button id="stopTestBtn" class="ghost">结束测试</button>
      </div>
    </div>`;
  document.querySelectorAll("[data-option]").forEach(btn => {
    btn.onclick = () => answerTestQuestion(btn.dataset.option);
  });
  $("nextTestBtn").onclick = nextTestQuestion;
  $("stopTestBtn").onclick = finishTest;
}

function answerTestQuestion(selectedId) {
  const question = testState?.questions[testState.current];
  if (!question || question.answered) return;
  question.answered = true;
  question.selectedId = selectedId;
  question.correct = selectedId === (question.correctId || question.card.id);
  if (question.correct) testState.correct++;
  if (question.card) {
    recordReview(question.card, question.correct ? "mastered" : "weak", question.correct ? 4 : 1);
  }
  renderStats();
  renderTest();
}

function nextTestQuestion() {
  const question = testState?.questions[testState.current];
  if (!question?.answered) return;
  if (testState.current >= testState.questions.length - 1) {
    finishTest();
    return;
  }
  testState.current++;
  renderTest();
}

function finishTest() {
  if (!testState) return;
  testState.finished = true;
  renderStats();
  renderTest();
}

function practiceNorm(s) {
  return String(s)
    .replace(/\u3000/g, " ")
    .replace(/\s+/g, "")
    .replace(/[。．、，]/g, "")
    .toLowerCase();
}

/** 课后练习正文／参考答案展示：去掉分隔线与冗余元标题；将「## 練習問題 n」（第6章起答案区常用）转为可见的【練習問題 n】 */
function stripClozeLeadInBody(raw) {
  if (!raw) return "";
  let s = String(raw).replace(/\r\n/g, "\n");
  s = s.replace(/^#{1,6}\s*(練習問題\s+[0-9０-９]+)\s*$/gm, "【$1】");
  const lines = s.split("\n");
  const kept = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      kept.push("");
      continue;
    }
    if (/^={5,}$/.test(t)) continue;
    if (/^-{5,}$/.test(t)) continue;
    if (/^#{1,6}\s*第[0-9０-９]+\s*日\s+練習問題(?:\s+[0-9０-９]+)?\s*$/i.test(t)) continue;
    if (/^第[0-9０-９]+\s*日\s+練習問題(?:\s+[0-9０-９]+)?\s*$/i.test(t)) continue;
    if (/^#{1,6}\s*練習問題(\s*[0-9０-９]+)?\s*$/i.test(t)) continue;
    if (/^練習問題(\s*[0-9０-９]+)?\s*$/i.test(t)) continue;
    if (/^（解答[^）]*）\s*$/.test(t)) continue;
    if (/^-?\s*※[^※\n]*選びなさい[。.．〜～\s]*$/u.test(t)) continue;
    kept.push(line);
  }
  while (kept.length && kept[kept.length - 1].trim() === "") kept.pop();
  while (kept.length && kept[0].trim() === "") kept.shift();
  return kept.join("\n").replace(/\n{2,}/g, "\n").trimEnd();
}

function renderPracticeSentence(question, answered, selections, correctFlags) {
  const segments = question.promptTemplate.split("_");
  let html = `<div class="practice-sentence">`;
  segments.forEach((segment, i) => {
    html += `<span>${escapeHtml(segment)}</span>`;
    if (i < question.blanks.length) {
      const blank = question.blanks[i];
      if (!answered) {
        const opts = shuffle([...blank.options]);
        html += `<span class="practice-blank-inline"><select class="practice-blank-select" data-blank="${i}" aria-label="空欄 ${i + 1}">`;
        html += `<option value="">選択</option>`;
        opts.forEach(opt => {
          html += `<option value="${escapeHtml(opt)}">${escapeHtml(opt)}</option>`;
        });
        html += `</select></span>`;
      } else {
        const sel = selections[i];
        const ok = correctFlags[i];
        html += `<strong class="${ok ? "good" : "bad"}">${escapeHtml(sel)}</strong>`;
        if (!ok) html += `<span class="prompt">（正：${escapeHtml(blank.correct)}）</span>`;
      }
    }
  });
  html += `</div>`;
  return html;
}

function practiceChapterNos() {
  return [...new Set(practiceBundles.map((b) => Number(b.chapterNo)).filter(Boolean))]
    .sort((a, b) => a - b);
}

function memoryChapterTitle(chapterNo) {
  return cards.find((card) => Number(card.chapterNo) === Number(chapterNo))?.chapterTitle || `第${chapterNo}章`;
}

function selectedPracticeChapterNo() {
  return Number($("practiceBundleSelect")?.value);
}

function selectedPracticeType() {
  return $("practiceTypeSelect")?.value || "practice";
}

function practiceChapterHasSummary(chapterNo) {
  const n = Number(chapterNo);
  if (!Number.isFinite(n) || n < 1) return false;
  return practiceBundles.some((b) => {
    if (Number(b.chapterNo) !== n) return false;
    if ((b.group || "practice") !== "summary") return false;
    return (b.sets || []).some((s) => (s.questions?.length || 0) > 0);
  });
}

/** 当前章节若无まとめ交互题（如第12章），隐藏类型下拉仅保留课后练习逻辑 */
function updatePracticeTypeDropdown() {
  const typeSel = $("practiceTypeSelect");
  if (!typeSel) return;
  const chapterNo = selectedPracticeChapterNo();
  const hasSummary = practiceChapterHasSummary(chapterNo);
  const saved = typeSel.value;
  typeSel.innerHTML = hasSummary
    ? `<option value="practice">课后练习</option><option value="summary">まとめの問題</option>`
    : `<option value="practice">课后练习</option>`;
  typeSel.value = hasSummary && saved === "summary" ? "summary" : "practice";
  $("practiceTypeLabel")?.classList.toggle("hidden", !hasSummary);
}

function practiceBundlesForSelection() {
  const chapterNo = selectedPracticeChapterNo();
  const group = selectedPracticeType();
  return practiceBundles
    .map((bundle, bundleIndex) => ({ bundle, bundleIndex }))
    .filter(({ bundle }) => Number(bundle.chapterNo) === chapterNo && (bundle.group || "practice") === group);
}

function practiceSetEntriesForSelection() {
  return practiceBundlesForSelection().flatMap(({ bundle, bundleIndex }) =>
    (bundle.sets || []).map((set, setIndex) => ({ bundle, bundleIndex, set, setIndex })),
  );
}

function populatePracticeBundleOptions() {
  const bundleSel = $("practiceBundleSelect");
  if (!bundleSel) return;
  const saved = bundleSel.value;
  if (!practiceBundles.length) {
    bundleSel.innerHTML = `<option value="">未加载 practice-data.js（请在记忆卡片目录运行 node scripts/build-practice-data.mjs）</option>`;
    return;
  }
  const chapters = practiceChapterNos();
  bundleSel.innerHTML = chapters.map((chapterNo) => {
    return `<option value="${chapterNo}">${escapeHtml(memoryChapterTitle(chapterNo))}</option>`;
  }).join("");
  if ([...bundleSel.options].some(o => o.value === saved)) bundleSel.value = saved;
  else if (chapters.length) bundleSel.value = String(chapters[0]);
}

function updatePracticeSetDropdown() {
  const bundleSel = $("practiceBundleSelect");
  const setSel = $("practiceSetSelect");
  const setLabel = $("practiceSetLabel");
  if (!bundleSel || !setSel) return;
  const entries = practiceSetEntriesForSelection();
  const isSummary = selectedPracticeType() === "summary";
  setLabel?.classList.toggle("hidden", isSummary);
  if (!entries.length) {
    setSel.innerHTML = `<option value="">无解析题组</option>`;
    setSel.disabled = true;
    return;
  }
  setSel.disabled = false;
  setSel.innerHTML = entries.map(({ set }, entryIndex) => {
    const dupTitle = entries.filter(x => x.set.title === set.title).length > 1;
    const label = dupTitle ? `${set.title}（第 ${entryIndex + 1} 套）` : set.title;
    const suffix =
      set.kind === "cloze"
        ? "完形段落"
        : `${set.questions?.length || 0} 题`;
    return `<option value="${entryIndex}">${escapeHtml(label)} · ${suffix}</option>`;
  }).join("");
}

function ensurePracticeSelectors() {
  populatePracticeBundleOptions();
  updatePracticeTypeDropdown();
  updatePracticeSetDropdown();
}

function startPracticeSession() {
  const setSel = $("practiceSetSelect");
  const entry = practiceSetEntriesForSelection()[selectedPracticeType() === "summary" ? 0 : Number(setSel?.value)];
  const set = entry?.set;
  if (!set) {
    practiceState = null;
    renderPracticeCard();
    return;
  }
  if (set.kind === "cloze") {
    practiceState = {
      mode: "cloze",
      bundleIndex: entry.bundleIndex,
      setIndex: entry.setIndex,
    };
    renderPracticeCard();
    return;
  }
  if (!set.questions?.length) {
    practiceState = null;
    renderPracticeCard();
    return;
  }
  practiceState = {
    mode: "interactive",
    bundleIndex: entry.bundleIndex,
    setIndex: entry.setIndex,
    questions: shuffle([...set.questions]),
    current: 0,
    correct: 0,
    finished: false,
  };
  renderPracticeCard();
}

function selectPracticeOption(value) {
  const st = practiceState;
  if (!st || st.mode !== "interactive" || st.finished || st.feedback) return;
  const question = st.questions[st.current];
  const correct = question?.blanks?.[0]?.correct;
  if (!question || !correct) return;
  const ok = practiceNorm(value) === practiceNorm(correct);
  if (ok) st.correct++;
  st.feedback = {
    selections: [value],
    correctFlags: [ok],
    allOk: ok,
  };
  renderPracticeCard();
}

function checkPracticeAnswer() {
  const st = practiceState;
  if (!st || st.mode !== "interactive" || st.finished || st.feedback) return;
  const question = st.questions[st.current];
  if (!question) return;
  const selects = [...document.querySelectorAll("#practiceArea .practice-blank-select")];
  const selections = selects.map(el => el.value);
  if (selections.some(v => !v)) {
    alert("请为每个空栏选择一项。");
    return;
  }
  const correctFlags = selections.map((sel, i) => practiceNorm(sel) === practiceNorm(question.blanks[i].correct));
  const allOk = correctFlags.every(Boolean);
  if (allOk) st.correct++;
  st.feedback = { selections, correctFlags, allOk };
  renderPracticeCard();
}

function renderPracticeChoiceQuestion(question, answered, feedback) {
  const blank = question.blanks?.[0];
  const options = blank?.options || [];
  const selected = feedback?.selections?.[0];
  const correct = blank?.correct || "";
  const sentence = escapeHtml(question.promptTemplate || "").replace(/_/g, "<span class=\"practice-choice-blank\">＿＿＿＿</span>");
  const optionHtml = options.map((opt) => {
    let cls = "option practice-option";
    if (answered && practiceNorm(opt) === practiceNorm(correct)) cls += " correct";
    else if (answered && practiceNorm(opt) === practiceNorm(selected)) cls += " wrong";
    return `<button class="${cls}" data-practice-option="${escapeHtml(opt)}" ${answered ? "disabled" : ""}>${escapeHtml(opt)}</button>`;
  }).join("");
  return `
    <div class="practice-choice-question">
      <div class="practice-stem">${sentence}</div>
      <div class="option-grid">${optionHtml}</div>
      ${answered && !feedback.allOk ? `<p class="prompt">正解：${escapeHtml(correct)}</p>` : ""}
    </div>`;
}


function advancePracticeQuestion() {
  const st = practiceState;
  if (!st?.feedback || st.finished || st.mode !== "interactive") return;
  delete st.feedback;
  if (st.current >= st.questions.length - 1) {
    st.finished = true;
  } else {
    st.current++;
  }
  renderPracticeCard();
}

function renderPracticeCard() {
  const area = $("practiceArea");
  if (!area) return;

  const interactiveTotal = practiceBundles.reduce(
    (n, b) => n + b.sets.reduce((m, s) => (s.kind === "cloze" ? m : m + (s.questions?.length || 0)), 0),
    0,
  );
  const clozeSectionTotal = practiceBundles.reduce((n, b) => n + b.sets.filter((s) => s.kind === "cloze").length, 0);

  const idle =
    practiceState === null ||
    (!practiceState.finished &&
      practiceState.mode !== "cloze" &&
      (!practiceState.questions || practiceState.questions.length === 0));

  if (idle) {
    area.innerHTML = `
      <div class="empty">
        <p>请选择上方文件与题组，点击「开始本题组」。</p>
        <p class="practice-empty-note">课后 <strong>練習問題</strong> 共 <strong>${clozeSectionTotal}</strong> 段全文完形；<strong>まとめの問題</strong> 另有 <strong>${interactiveTotal}</strong> 道交互题，已作为单独章节入口显示。</p>
      </div>`;
    return;
  }

  if (practiceState.mode === "cloze") {
    const bundle = practiceBundles[practiceState.bundleIndex];
    const set = bundle?.sets?.[practiceState.setIndex];
    const bodyDisplay = stripClozeLeadInBody(set?.body || "");
    const setTitle = String(set?.title || "").trim();
    const secTitle = String(set?.sectionTitle || "").trim();
    const sectionBadgeHtml =
      secTitle && secTitle !== setTitle ? `<span class="badge">${escapeHtml(secTitle)}</span>` : "";
    area.innerHTML = `
      <div class="practice-card cloze-card">
        <div class="card-top">
          <span class="badge">${escapeHtml(bundle?.title || "")}</span>
          <span class="badge">${escapeHtml(setTitle)}</span>
          ${sectionBadgeHtml}
          <span class="badge">完形 · 读写</span>
        </div>
        <p class="prompt">可先自填空白，再展开「参考答案」核对。</p>
        <pre class="cloze-body practice-stem">${escapeHtml(bodyDisplay)}</pre>
        <details class="cloze-answers panel-inner">
          <summary>参考答案</summary>
        <pre class="cloze-answers-pre">${escapeHtml(stripClozeLeadInBody(set?.answers || "") || "（未收录）")}</pre>
        </details>
      </div>`;
    return;
  }

  if (practiceState.finished) {
    const total = practiceState.questions.length;
    const pct = total ? Math.round((practiceState.correct / total) * 100) : 0;
    area.innerHTML = `
      <div class="practice-card">
        <h3 style="margin-top:0">本题组完成</h3>
        <p><strong>${practiceState.correct} / ${total}</strong>（正确率 ${pct}%）</p>
        <p class="prompt">错题可参考句内标注的正确答案。</p>
        <button id="restartPracticeBtn" class="primary">同一题组再来一轮</button>
      </div>`;
    $("restartPracticeBtn").onclick = startPracticeSession;
    return;
  }

  const q = practiceState.questions[practiceState.current];
  const fb = practiceState.feedback;
  const answered = Boolean(fb);

  area.innerHTML = `
    <div class="practice-card">
      <div class="card-top">
        <span class="badge">${escapeHtml(practiceBundles[practiceState.bundleIndex]?.title || "")}</span>
        <span class="badge">${escapeHtml(practiceBundles[practiceState.bundleIndex]?.sets[practiceState.setIndex]?.title || "")}</span>
        <span class="badge">第 ${practiceState.current + 1} / ${practiceState.questions.length} 题 · 已累计正确 ${practiceState.correct}</span>
      </div>
      <p class="prompt">选择正确答案。</p>
      ${answered ? `<div class="practice-result-banner ${fb.allOk ? "ok" : "bad"}"><strong>${fb.allOk ? "全部正确" : "有错"}</strong></div>` : ""}
      ${renderPracticeChoiceQuestion(q, answered, fb)}
      <div class="actions">
        ${answered
          ? `<button id="advancePracticeBtn">${practiceState.current >= practiceState.questions.length - 1 ? "查看结果" : "下一题"}</button>`
          : ""
        }
      </div>
    </div>`;

  if (!answered) {
    document.querySelectorAll("#practiceArea [data-practice-option]").forEach((btn) => {
      btn.onclick = () => selectPracticeOption(btn.dataset.practiceOption);
    });
  } else {
    $("advancePracticeBtn").onclick = advancePracticeQuestion;
  }
}

function renderPracticeMode() {
  ensurePracticeSelectors();
  renderPracticeCard();
}

function renderAll(resetIndex = true) {
  if (resetIndex) index = 0;
  renderStats();
  renderCard();
  if (mode === "test") renderTest();
  if (mode === "practice") renderPracticeMode();
}

function nextCard() {
  const len = filteredCards().length;
  if (!len) return;
  index = (index + 1) % len;
  renderAll(false);
}

function initFilters() {
  const chapters = [...new Map(cards.map(c => [c.chapterNo, c.chapterTitle])).entries()].filter(([no]) => no != null);
  $("chapterFilter").innerHTML = `<option value="all">全部章节</option>` + chapters.map(([no, title]) => `<option value="${no}">${escapeHtml(title)}</option>`).join("");
}

/** 记忆模式：触屏按「翻书」习惯（左滑看下一张，右滑看上一张）；需水平位移占优，以免抢纵向滚动 */
const MEMORY_SWIPE_MIN_PX = 56;

function bindMemoryViewSwipe() {
  const root = $("memoryView");
  if (!root) return;
  let track = null;

  root.addEventListener(
    "touchstart",
    (e) => {
      if (mode !== "memory") return;
      const t = e.touches[0];
      if (!t) return;
      if (e.target.closest?.("button, a, input, textarea, select, label, [contenteditable=true]")) return;
      track = { id: t.identifier, x0: t.clientX, y0: t.clientY };
    },
    { passive: true },
  );

  function endSwipeTrack(e) {
    if (!track) return;
    const t = [...e.changedTouches].find((x) => x.identifier === track.id);
    if (!t) {
      track = null;
      return;
    }
    const dx = t.clientX - track.x0;
    const dy = t.clientY - track.y0;
    track = null;
    if (mode !== "memory") return;
    if (Math.abs(dx) < MEMORY_SWIPE_MIN_PX) return;
    if (Math.abs(dx) <= Math.abs(dy)) return;
    if (dx < 0) $("nextBtn")?.click();
    else $("prevBtn")?.click();
  }

  root.addEventListener("touchend", endSwipeTrack, { passive: true });
  root.addEventListener("touchcancel", () => {
    track = null;
  }, { passive: true });
}

function bindEvents() {
  document.querySelectorAll(".tab").forEach(btn => {
    btn.onclick = () => {
      mode = btn.dataset.mode;
      document.querySelectorAll(".tab").forEach(x => x.classList.toggle("active", x === btn));
      $("memoryView").classList.toggle("hidden", mode !== "memory");
      $("testView").classList.toggle("hidden", mode !== "test");
      $("practiceView").classList.toggle("hidden", mode !== "practice");
      document.querySelector(".controls .filters")?.classList.toggle("hidden", mode === "practice");
      document.querySelector(".controls .filters label.search")?.classList.toggle("hidden", mode === "test");
      renderAll();
    };
  });
  ["chapterFilter", "statusFilter", "examLevelFilter"].forEach(id => $(id).addEventListener("input", () => renderAll()));
  $("searchInput")?.addEventListener("input", () => {
    if (mode === "memory") renderAll();
  });
  $("prevBtn").onclick = () => { const len = filteredCards().length; if (len) index = (index - 1 + len) % len; renderAll(false); };
  $("nextBtn").onclick = nextCard;
  $("memoryIndexSelect").onchange = (e) => {
    const nextIndex = Number(e.target.value);
    if (Number.isInteger(nextIndex)) {
      index = nextIndex;
      renderAll(false);
    }
  };
  $("shuffleBtn").onclick = () => { randomOrder = true; renderAll(); randomOrder = false; };
  $("resetBtn").onclick = () => { if (confirm("确定要清空所有掌握记录吗？")) { progress = {}; saveProgress(); renderAll(); } };
  $("startTestBtn").onclick = startTest;
  $("practiceBundleSelect")?.addEventListener("change", () => {
    updatePracticeTypeDropdown();
    updatePracticeSetDropdown();
    practiceState = null;
    renderPracticeCard();
  });
  $("practiceTypeSelect")?.addEventListener("change", () => {
    updatePracticeSetDropdown();
    practiceState = null;
    renderPracticeCard();
  });
  $("practiceSetSelect")?.addEventListener("change", () => {
    practiceState = null;
    renderPracticeCard();
  });
  $("startPracticeBtn")?.addEventListener("click", () => {
    practiceState = null;
    startPracticeSession();
  });

  document.querySelectorAll(".immersive-toggle").forEach((btn) => {
    btn.addEventListener("click", () => toggleImmersive());
  });
  $("immersiveExitBtn")?.addEventListener("click", () => toggleImmersive());

  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement && document.body.classList.contains("immersive-learning")) {
      exitImmersive();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.body.classList.contains("immersive-learning")) {
      const el = e.target;
      if (el?.closest?.("input, textarea, select, [contenteditable=true]")) return;
      if (!document.fullscreenElement) {
        e.preventDefault();
        exitImmersive();
      }
      return;
    }
    if (mode !== "memory") return;
    const el = e.target;
    if (!el || el.closest?.("input, textarea, select, [contenteditable=true]")) return;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      $("prevBtn")?.click();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      $("nextBtn")?.click();
    }
  });

  bindMemoryViewSwipe();
}

initFilters();
restoreMemoryPosition();
bindEvents();
renderAll(false);
