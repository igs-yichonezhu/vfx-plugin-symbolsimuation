/*
 * 介面語言：英文對照表完整、原始碼中文都經過 T()、語言偵測、英文面板、設定頁切換語言
 */
"use strict";
const os = require("os");
const H = require("./helpers");
const { fs, path, vm, assert, test, deq, newContext, loadSrc, ROOT, SYMBOL_DIR, SFS, mockUI } = H;
const acorn = require("acorn");
require("../src/i18n_en.js");

console.log("i18n（繁中 / 英文）");

const CJK = /[　-〿一-鿿＀-￯]/;
const SRC = ["core.js", "ae.js", "ui.js", "main.js", "apply.js"];
// 刻意不翻譯的字串：語言選單裡的「繁體中文」要讓看不懂中文介面的人也認得
const KEEP = ["繁體中文"];

function walkAst(node, fn, parent) {
  if (!node || typeof node.type !== "string") return;
  fn(node, parent);
  for (const k of Object.keys(node)) {
    const c = node[k];
    if (Array.isArray(c)) c.forEach((x) => walkAst(x, fn, node));
    else if (c && typeof c.type === "string") walkAst(c, fn, node);
  }
}
const isT = (n) => n && n.type === "CallExpression" && n.callee.type === "Identifier" && n.callee.name === "T";

// 原始碼裡所有翻譯 key，以及沒有經過 T() 的中文字串
function scanSources() {
  const keys = new Set(), raw = [];
  for (const f of SRC) {
    const ast = acorn.parse(fs.readFileSync(path.join(ROOT, "src", f), "utf8"), { ecmaVersion: 5, locations: true });
    const labelArrays = new Set();
    walkAst(ast, (n) => {
      if (isT(n) && n.arguments[0] && n.arguments[0].type === "Literal") keys.add(n.arguments[0].value);
      // core.js 載入時就建立的標籤陣列（顯示時才用 S.tList 翻譯）
      if (n.type === "AssignmentExpression" && n.left.type === "MemberExpression" && /_LABELS$/.test(n.left.property.name) && n.right.type === "ArrayExpression") {
        n.right.elements.forEach((e) => { keys.add(e.value); labelArrays.add(e); });
      }
    });
    walkAst(ast, (n, p) => {
      if (n.type !== "Literal" || typeof n.value !== "string" || !CJK.test(n.value)) return;
      if ((isT(p) && p.arguments[0] === n) || labelArrays.has(n) || KEEP.indexOf(n.value) >= 0) return;
      raw.push(f + ":" + n.loc.start.line + " " + JSON.stringify(n.value));
    });
  }
  return { keys, raw };
}

const placeholders = (s) => (s.match(/\{\d+\}/g) || []).sort().join(",");

test("英文對照表：每個 key 都有翻譯、沒有多餘的 key、參數一致", () => {
  const { keys } = scanSources();
  const en = SFS.I18N.en;
  deq([...keys].filter((k) => !Object.prototype.hasOwnProperty.call(en, k)), [], "missing translations");
  deq(Object.keys(en).filter((k) => !keys.has(k)), [], "unused translations");
  for (const k of Object.keys(en)) {
    assert.ok(en[k] && !CJK.test(en[k]), "english value for " + k);
    assert.strictEqual(placeholders(en[k]), placeholders(k), "placeholders of " + k);
  }
});

test("原始碼的中文字串都經過 T()（regex 裡的全形標點不算）", () => {
  deq(scanSources().raw, []);
});

test("S.t：參數代入、語境前綴、找不到 key 時用原文", () => {
  const old = SFS.lang;
  try {
    SFS.lang = "zh";
    assert.strictEqual(SFS.t("第 {0} 輪", 3), "第 3 輪");
    assert.strictEqual(SFS.t("count\u0004連"), "連");
    assert.strictEqual(SFS.t("{0}完成：{1}（{2} 輪、{3} 個繞框、{4} 條連線，演出到 {5} 秒）", "建立", "B", 5, 2, 1, 6.3), "建立完成：B（5 輪、2 個繞框、1 條連線，演出到 6.3 秒）");
    SFS.lang = "en";
    assert.strictEqual(SFS.t("第 {0} 輪", 3), "Reel 3");
    assert.strictEqual(SFS.t("count\u0004連"), "Count");
    assert.strictEqual(SFS.t("tease\u0004連"), "after");
    assert.strictEqual(SFS.t("沒有這個 key {0}", 1), "沒有這個 key 1");
    deq(SFS.tList(SFS.CURVE_LABELS), ["Standard", "Soft", "Hard"]);
  } finally { SFS.lang = old; }
});

test("語言偵測：EffectCraft / 非中文 AE 用英文，中文 AE 用繁中，偏好設定優先", () => {
  const ctx = newContext();
  const S = loadSrc(ctx);
  assert.strictEqual(S.detectLang("auto"), "zh", "沒有語系資訊時維持繁中");
  ctx.app.isoLanguage = "zh_TW"; assert.strictEqual(S.detectLang("auto"), "zh");
  ctx.app.isoLanguage = "zh_CN"; assert.strictEqual(S.detectLang("auto"), "zh");
  ctx.app.isoLanguage = "en_US"; assert.strictEqual(S.detectLang("auto"), "en");
  ctx.app.isoLanguage = "ja_JP"; assert.strictEqual(S.detectLang("auto"), "en");
  ctx.app.isoLanguage = "zh_TW"; ctx.$.os = "EffectCraft"; assert.strictEqual(S.detectLang("auto"), "en");
  assert.strictEqual(S.detectLang("zh"), "zh");
  ctx.$.os = "Windows 10"; assert.strictEqual(S.detectLang("en"), "en");
  // 偏好設定存在 AE settings
  assert.strictEqual(S.ae.langPref(), "auto");
  S.ae.setLangPref("en");
  assert.strictEqual(S.ae.langPref(), "en");
  assert.strictEqual(S.ae.initLang(), "en");
  assert.strictEqual(S.ae.initLang("zh"), "zh", "工作參數指定的語言優先");
  ctx.app.settings.saveSetting("SlotFakeSpin", "language", "fr");
  assert.strictEqual(S.ae.langPref(), "auto", "不認得的值當成 auto");
});

// ---------------------------------------------------------------- 面板
function loadPanel(ctx) {
  const code = fs.readFileSync(path.join(ROOT, "dist", "SlotFakeSpin.jsx"), "utf8");
  ctx.__panel = new ctx.Panel();
  vm.runInContext("(function () {\n" + code + "\n}).call(__panel);", ctx, { filename: "SlotFakeSpin.jsx" });
  return ctx.__panel;
}
const find = mockUI.find, byText = mockUI.findByText, walk = mockUI.walk;
function click(el) { assert.ok(el, "element exists"); el.onClick.call(el); }
function tabTitles(panel) { const out = []; walk(panel, (el) => { if (el.type === "tab") out.push(el.text); }); return out; }
// 面板上所有使用者看得到的文字
function visibleTexts(panel) {
  const out = [];
  walk(panel, (el) => {
    [el.text, el.helpTip].forEach((t) => { if (t) out.push(t); });
    (el.items || []).forEach((it) => out.push(it.text));
    (el.properties.columnTitles || []).forEach((t) => out.push(t));
  });
  return out;
}
function langDropdown(panel) { return find(panel, (el) => el.type === "dropdownlist" && el.items.some((it) => it.text === "English")); }
function pickLang(panel, i) { const dd = langDropdown(panel); dd.selection = i; dd.onChange.call(dd); }

test("EffectCraft：面板自動用英文，看得到的文字沒有中文，完整流程可用", () => {
  const ctx = newContext();
  ctx.$.os = "EffectCraft";
  const main = ctx.app.project.items.addComp("Main", 1920, 1080, 1, 12, 30);
  ctx.app.project.activeItem = main;
  const panel = loadPanel(ctx);
  deq(tabTitles(panel), ["Symbols", "Board", "Rhythm", "Reels", "Frame", "Lines", "Settings"]);
  ctx.__dialogResult = new ctx.Folder(SYMBOL_DIR);
  click(byText(panel, "button", "Import Folder..."));
  click(byText(panel, "button", "▶ Build Fake Spin"));
  deq((ctx.__alerts || []).filter((a) => CJK.test(a)), []);
  const status = find(panel, (el) => el.type === "statictext" && el.properties.multiline && /^Build done: /.test(el.text));
  assert.ok(status, "English status after build");
  walk(panel, (el) => { if (el.onDraw) el.onDraw.call(el); });
  deq(ctx.__ui.graphicsCalls.filter((c) => /^drawString:/.test(c) && CJK.test(c)), []);
  deq(visibleTexts(panel).filter((t) => CJK.test(t) && KEEP.indexOf(t) < 0), []);
  // 英文標籤比較長：寬度要撐開（欄位寬度是照中文排的）
  const lbl = find(panel, (el) => el.type === "statictext" && el.text === "Overshoot");
  assert.ok(lbl.preferredSize.width >= "Overshoot".length * 6 + 6, "label widened: " + lbl.preferredSize.width);
});

test("設定頁切換語言：重建面板、停在設定頁、記住選擇、設定不遺失", () => {
  const ctx = newContext();
  const main = ctx.app.project.items.addComp("Main", 1920, 1080, 1, 12, 30);
  ctx.app.project.activeItem = main;
  let panel = loadPanel(ctx);
  assert.strictEqual(tabTitles(panel)[0], "符號");
  ctx.__dialogResult = new ctx.Folder(SYMBOL_DIR);
  click(byText(panel, "button", "匯入資料夾…"));
  const symbolsBefore = JSON.parse(ctx.app.settings.getSetting("SlotFakeSpin", "lastConfig_v2")).symbols.length;
  assert.ok(symbolsBefore > 0);

  pickLang(panel, 2);
  assert.strictEqual(ctx.app.settings.getSetting("SlotFakeSpin", "language"), "en");
  deq(tabTitles(panel), ["Symbols", "Board", "Rhythm", "Reels", "Frame", "Lines", "Settings"]);
  const tabs = find(panel, (el) => el.type === "tabbedpanel");
  assert.strictEqual(tabs.selection.text, "Settings");
  assert.strictEqual(langDropdown(panel).selection.index, 2);
  const symList = find(panel, (el) => el.type === "listbox" && el.items.length && /^[●○] /.test(el.items[0].text));
  assert.strictEqual(symList.items.length, symbolsBefore, "symbols kept after rebuild");
  assert.strictEqual(panel.children.filter((c) => c.type === "tabbedpanel").length, 1, "old controls removed");

  pickLang(panel, 1);
  assert.strictEqual(tabTitles(panel)[0], "符號");
  pickLang(panel, 0);
  assert.strictEqual(ctx.app.settings.getSetting("SlotFakeSpin", "language"), "auto");
  assert.strictEqual(tabTitles(panel)[0], "符號", "auto + 沒有語系資訊 = 繁中");

  // 下次開面板沿用選擇
  ctx.app.settings.saveSetting("SlotFakeSpin", "language", "en");
  panel = loadPanel(ctx);
  assert.strictEqual(tabTitles(panel)[0], "Symbols");
});

test("自動化入口：工作參數 lang=en 時錯誤訊息是英文", () => {
  const ctx = newContext();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sfs-i18n-"));
  const job = { preset: path.join(ROOT, "examples", "freegame.json"), mode: "new", comp: "Nope", result: path.join(tmp, "r.json"), lang: "en" };
  ctx.$.global = ctx;
  ctx.SFS_APPLY = job;
  vm.runInContext(fs.readFileSync(path.join(ROOT, "dist", "SlotFakeSpin_apply.jsx"), "utf8"), ctx, { filename: "SlotFakeSpin_apply.jsx" });
  const res = JSON.parse(fs.readFileSync(job.result, "utf8"));
  assert.ok(!res.ok);
  assert.ok(/Composition "Nope" not found/.test(res.errors[0]), res.errors[0]);
});
