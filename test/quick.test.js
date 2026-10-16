/*
 * 快速模式：core 的演出配方（S.recipes）與面板「快速」頁
 */
"use strict";
const H = require("./helpers");
const { fs, path, vm, assert, test, deq, newContext, ROOT, SYMBOL_DIR, SFS, sampleConfig, mockUI } = H;

console.log("快速模式（演出配方 + 快速頁）");

const S = SFS;
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, (msg || "") + " expected " + b + " got " + a);
// sampleConfig 的結果盤面：SCATTER 在第 1、3 輪（差一顆觸發）
const threeScatters = (c) => { c.endBoard[4] = ["J", "SCATTER", "SEVEN"]; };

test("配方：觸發 → 差一顆的輪開始期待、最後一輪多拖 0.3 秒、框住觸發符號", () => {
  const cfg = sampleConfig(S, threeScatters);
  const res = S.recipes.apply(cfg, "trigger", { symbols: "SCATTER", count: 3 });
  deq(res.reels, [4, 5]);
  assert.strictEqual(cfg.spin.antReels, "4,5");
  assert.ok(cfg.reels[3].frame && cfg.reels[4].frame && !cfg.reels[2].frame);
  near(cfg.reels[4].stop, S.generateReels(cfg)[4].stop + 0.3, "last anticipation reel");
  assert.strictEqual(cfg.spin.antCurve, "soft");
  assert.ok(cfg.lines.some((l) => l.boxOnly), "trigger symbols boxed");
  assert.strictEqual(cfg.lineGen.mode, "all");
  assert.strictEqual(cfg.lineStyle.pulse, 120);
  assert.strictEqual(cfg.quick.recipe, "trigger");
  deq(S.validateConfig(cfg), []);
  assert.strictEqual(S.computePlan(cfg, 30).frames.length, 2);
});

test("配方：期待落空 → 一樣期待，但不要任何中獎演出", () => {
  const cfg = sampleConfig(S);
  const res = S.recipes.apply(cfg, "miss", { symbols: "SCATTER", count: 3 });
  deq(res.reels, [4, 5]);
  deq(cfg.lines, []);
  assert.strictEqual(cfg.quick.recipe, "miss");
});

test("配方：切換時先還原節奏（快速轉 → 一般轉不殘留），一般轉照樣偵測連線", () => {
  const cfg = sampleConfig(S);
  const def = S.defaultConfig().spin;
  S.recipes.apply(cfg, "turbo");
  assert.strictEqual(cfg.spin.firstStop, 0.55);
  assert.strictEqual(cfg.spin.speeds, "24");
  assert.strictEqual(cfg.spin.decelCurve, "hard");
  const res = S.recipes.apply(cfg, "normal");
  assert.strictEqual(cfg.spin.firstStop, def.firstStop);
  assert.strictEqual(cfg.spin.speeds, def.speeds);
  assert.strictEqual(cfg.spin.decelCurve, def.decelCurve);
  assert.strictEqual(cfg.spin.antReels, "");
  deq(res.reels, []);
  assert.ok(cfg.lines.length > 0 && cfg.lines.every((l) => !l.boxOnly), "line wins detected");
  // 不認得的配方 = 一般轉
  assert.strictEqual(S.recipes.apply(cfg, "nope").key, "normal");
});

test("配方：大獎聽牌 → 連到一半就期待下一輪、繞框加速", () => {
  const cfg = sampleConfig(S);
  const res = S.recipes.apply(cfg, "tease", { tease: "SEVEN" });
  assert.ok(res.reels.indexOf(3) >= 0, "reel 3 anticipates: " + res.reels);
  assert.strictEqual(cfg.spin.antSpeed, 24);
  assert.ok(res.reasons.some((r) => /聽牌/.test(r)));
});

test("起始盤面：有觸發符號 / 連線就不安靜；randomQuiet 產生的一定安靜", () => {
  const cfg = sampleConfig(S);
  assert.ok(!S.board.isQuiet(cfg, cfg.endBoard), "result board has wins and scatters");
  const q = S.board.randomQuiet(cfg, new S.Rng(7), 200);
  assert.ok(q.quiet && S.board.isQuiet(cfg, q.board));
  const empty = S.board.create(5, 3, "");
  assert.ok(!S.board.isQuiet(cfg, empty), "empty cells are not quiet");
});

test("設定：quick.recipe 會保存，不認得的值回到一般轉", () => {
  const cfg = S.normalizeConfig({ quick: { recipe: "miss" } });
  assert.strictEqual(cfg.quick.recipe, "miss");
  assert.strictEqual(S.normalizeConfig({ quick: { recipe: "xx" } }).quick.recipe, "normal");
  assert.strictEqual(S.normalizeConfig({}).quick.recipe, "normal");
});

// ---------------------------------------------------------------- 面板
const find = mockUI.find, byText = mockUI.findByText, walk = mockUI.walk;
function click(el) { assert.ok(el, "element exists"); el.onClick.call(el); }
function loadPanel(ctx) {
  const code = fs.readFileSync(path.join(ROOT, "dist", "SlotFakeSpin.jsx"), "utf8");
  ctx.__panel = new ctx.Panel();
  vm.runInContext("(function () {\n" + code + "\n}).call(__panel);", ctx, { filename: "SlotFakeSpin.jsx" });
  return ctx.__panel;
}
const saved = (ctx) => JSON.parse(ctx.app.settings.getSetting("SlotFakeSpin", "lastConfig_v2"));
function typeBoard(ctx, panel, buttonText, text) {
  ctx.__onDialog = (d) => {
    find(d, (el) => el.type === "edittext").text = text;
    click(find(d, (el) => el.type === "button" && el.text === "套用"));
    return d.closed;
  };
  click(byText(panel, "button", buttonText));
  ctx.__onDialog = null;
}
function pickRecipe(panel, label) {
  const dd = find(panel, (el) => el.type === "dropdownlist" && el.items.some((it) => it.text === label));
  dd.selection = dd.items.findIndex((it) => it.text === label);
  dd.onChange.call(dd);
}
function setup() {
  const ctx = newContext();
  const main = ctx.app.project.items.addComp("Main", 1920, 1080, 1, 12, 30);
  ctx.app.project.activeItem = main;
  const panel = loadPanel(ctx);
  return { ctx, main, panel };
}
const TRIGGER_BOARD = "A K SCATTER A K\nSCATTER A K Q A\nK Q A K SCATTER";

test("快速頁：預設首頁；匯入 → 文字輸入結果 → 選觸發 → 建立，起始盤面自動安靜", () => {
  const { ctx, main, panel } = setup();
  const outer = find(panel, (el) => el.type === "tabbedpanel");
  assert.strictEqual(outer.selection.text, "快速");
  ctx.__dialogResult = new ctx.Folder(SYMBOL_DIR);
  click(byText(panel, "button", "匯入符號資料夾…"));
  assert.ok(find(panel, (el) => el.type === "statictext" && /^10 個符號：/.test(el.text)), "symbol summary");

  typeBoard(ctx, panel, "文字輸入結果盤面…", TRIGGER_BOARD);
  pickRecipe(panel, "觸發（Scatter / 寶石…）");
  let cfg = saved(ctx);
  assert.strictEqual(cfg.quick.recipe, "trigger");
  assert.strictEqual(cfg.spin.antReels, "4,5");
  assert.ok(cfg.lines.some((l) => l.boxOnly));
  assert.ok(S.board.isQuiet(S.normalizeConfig(cfg), cfg.startBoard), "start board quiet: " + JSON.stringify(cfg.startBoard));
  assert.ok(find(panel, (el) => el.type === "statictext" && /期待輪：R4、R5/.test(el.text)), "summary shows anticipation reels");
  assert.ok(find(panel, (el) => el.type === "statictext" && /^已套用「觸發/.test(el.text)), "status");

  // 換一個起始盤面：一樣安靜
  const before = JSON.stringify(saved(ctx).startBoard);
  click(byText(panel, "button", "換一個"));
  cfg = saved(ctx);
  assert.ok(S.board.isQuiet(S.normalizeConfig(cfg), cfg.startBoard));
  void before;

  click(byText(panel, "button", "▶ 建立假轉"));
  deq((ctx.__alerts || []).filter((a) => /失敗|錯誤/.test(a)), []);
  assert.strictEqual(main._layers.filter((l) => l.comment === "SFS_BOARD").length, 1);
});

test("快速頁：在進階頁改了結果盤面，回到快速頁會重新套用演出", () => {
  const { ctx, panel } = setup();
  ctx.__dialogResult = new ctx.Folder(SYMBOL_DIR);
  click(byText(panel, "button", "匯入符號資料夾…"));
  typeBoard(ctx, panel, "文字輸入結果盤面…", TRIGGER_BOARD);
  pickRecipe(panel, "觸發（Scatter / 寶石…）");
  assert.ok(saved(ctx).lines.some((l) => l.boxOnly));

  // 到進階 > 盤面，把第 5 輪的 SCATTER 改掉（變成差一顆沒中）
  click(byText(panel, "button", "點格子畫…"));
  const outer = find(panel, (el) => el.type === "tabbedpanel");
  assert.strictEqual(outer.selection.text, "進階");
  typeBoard(ctx, panel, "文字編輯…", "A K SCATTER A K\nSCATTER A K Q A\nK Q A K Q");
  outer.selection = find(panel, (el) => el.type === "tab" && el.text === "快速");
  outer.onChange.call(outer);
  const cfg = saved(ctx);
  assert.strictEqual(cfg.spin.antReels, "4,5", "still anticipating (one short)");
  assert.ok(!cfg.lines.some((l) => l.boxOnly), "no trigger boxes after the change");
});

test("快速頁：選一般轉時觸發 / 聽牌欄位停用，選觸發時啟用", () => {
  const { ctx, panel } = setup();
  ctx.__dialogResult = new ctx.Folder(SYMBOL_DIR);
  click(byText(panel, "button", "匯入符號資料夾…"));
  const trigRow = find(panel, (el) => el.type === "group" && el.children.some((c) => c.type === "statictext" && c.text === "顆觸發"));
  pickRecipe(panel, "一般轉");
  assert.strictEqual(trigRow.enabled, false);
  pickRecipe(panel, "期待落空");
  assert.strictEqual(trigRow.enabled, true);
});
