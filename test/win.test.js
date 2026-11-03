/*
 * 報獎（S.win）：Big Win 分級、跑分表達式、彩金 / Free Game 字卡、模擬 AE 建置、命令列、面板
 */
"use strict";
const os = require("os");
const cp = require("child_process");
const H = require("./helpers");
const { fs, path, vm, assert, test, deq, near, newContext, loadSrc, ROOT, SYMBOL_DIR, SFS, sampleConfig, mockUI } = H;

console.log("報獎（Big Win / 彩金 / Free Game）");

const S = SFS;
const W = S.win;
// AE 表達式最後一個敘述的值 = 結果；用函式隔開變數
const runExpr = (expr, time) => (function (time) { return eval(expr); })(time); // eslint-disable-line no-eval
const winCfg = (w, more) => sampleConfig(S, (c) => { Object.assign(c.win, w); if (more) more(c); });

test("parseTiers：名稱@倍數、可加顏色、依倍數排序、格式錯誤會說明", () => {
  const r = W.parseTiers("MEGA WIN@25, BIG WIN @ 10x，SUPER WIN@50#ff00aa");
  deq(r.errors, []);
  deq(r.tiers.map((t) => [t.name, t.at, t.color]), [["BIG WIN", 10, "#FFD54A"], ["MEGA WIN", 25, "#FF9F2E"], ["SUPER WIN", 50, "#FF00AA"]]);
  assert.ok(/BIG WIN@10/.test(W.parseTiers("BIG WIN").errors[0]));
  assert.strictEqual(W.parseTiers("@10").errors.length, 1);
  deq(W.parseTiers("").tiers, []);
});

test("format：千分位、小數無條件捨去、前綴", () => {
  assert.strictEqual(W.format(1234567, 0, ""), "1,234,567");
  assert.strictEqual(W.format(999, 0, "$"), "$999");
  assert.strictEqual(W.format(1234.567, 2, "$"), "$1,234.56");
  assert.strictEqual(W.format(0.5, 0, ""), "0");
  assert.strictEqual(W.format(1000, 1, ""), "1,000.0");
});

test("countExpr（AE 表達式）和 countAt + format 每個時間點都一樣", () => {
  const cases = [[[1, 3], [0, 500]], [[2, 4.5, 7, 9.5], [0, 1000, 2500, 4321.75]]];
  cases.forEach(([Ts, Vs]) => {
    [0, 2].forEach((d) => {
      const expr = W.countExpr(Ts, Vs, d, "WIN $");
      for (let t = Ts[0] - 0.5; t < Ts[Ts.length - 1] + 0.5; t += 0.07) {
        assert.strictEqual(runExpr(expr, t), W.format(W.countAt(Ts, Vs, t), d, "WIN $"), "t=" + t);
      }
    });
  });
  // 只用 ASCII、沒有 .substr（EffectCraft 沒有）
  const e = W.countExpr([1, 2], [0, 10], 0, "$");
  assert.ok(!/[^\x00-\x7f]/.test(e) && !/\.substr\(/.test(e));
  // 段內等速、最後一段減速：中點不到一半的「剩餘」
  near(W.countAt([0, 1, 2], [0, 100, 200], 0.5), 50);
  assert.ok(W.countAt([0, 1, 2], [0, 100, 200], 1.5) > 150);
});

test("一般贏分（沒到 Big Win）：盤面下方跑分、標記 WIN / WIN COUNT END、演出結束延長", () => {
  const cfg = winCfg({ amount: 350, bet: 100, meterTime: 1.5 });
  const plan = S.computePlan(cfg, 30), w = plan.win;
  assert.ok(w.any && !w.big && w.meter);
  near(w.meter.start, plan.allSettled + 0.3, 1e-9);
  near(w.meter.countEnd, w.meter.start + 1.5, 1e-9);
  deq(w.meter.V, [0, 350]);
  const labels = plan.markers.map((m) => m.label);
  assert.ok(labels.indexOf("WIN") >= 0 && labels.indexOf("WIN COUNT END") >= 0, labels.join(","));
  assert.ok(plan.endTime >= w.meter.countEnd);
  // 不跑分（meter 關掉）就沒有畫面
  const off = S.computePlan(winCfg({ amount: 350, bet: 100, meter: false }), 30);
  assert.ok(!off.win.any);
});

test("Big Win：32 倍 → BIG → MEGA，跨過門檻時換標題，跑到總分後停留", () => {
  const cfg = winCfg({ amount: 3200, bet: 100, tierTime: 2, bigDelay: 1, hold: 1.5 });
  const plan = S.computePlan(cfg, 30), B = plan.win.big;
  deq(B.tiers.map((t) => t.name), ["BIG WIN", "MEGA WIN"]);
  near(B.start, plan.allSettled + 0.3 + 1, 1e-9);
  deq(B.T.map((t) => Math.round(t * 30)), [B.start, B.start + 2, B.start + 4].map((t) => Math.round(t * 30)));
  deq(B.V, [0, 2500, 3200]);
  near(B.tiers[0].end, B.tiers[1].start);
  near(B.end, B.countEnd + 1.5, 1e-9);
  assert.ok(plan.markers.some((m) => m.label === "MEGA WIN"));
  near(plan.endTime, B.end + W.FADE, 1e-9);
  // 跑分也跟著 Big Win 一起跑
  deq(plan.win.meter.T, B.T);
  // 60 倍：三級全上
  deq(S.computePlan(winCfg({ amount: 6000, bet: 100 }), 30).win.big.tiers.map((t) => t.name), ["BIG WIN", "MEGA WIN", "SUPER WIN"]);
  // 時間都對齊影格
  plan.win.big.T.forEach((t) => near(t * 30, Math.round(t * 30), 1e-6));
});

test("彩金 / Free Game 字卡：依 order 排、間隔、沒設定的跳過", () => {
  const cfg = winCfg({ amount: 0, jpName: "major", jpAmount: 50000, jpTime: 1.5, hold: 2, fgCount: 8, fgTime: 2.5, gap: 0.3 });
  let plan = S.computePlan(cfg, 30), C = plan.win.cards;
  deq(C.map((c) => c.kind), ["jp", "fg"]);
  assert.strictEqual(C[0].color, W.JP_COLORS.MAJOR, "MAJOR color by name");
  near(C[1].start, C[0].end + W.FADE + 0.3, 1e-6);
  near(C[1].end - C[1].start, 2.5, 1e-6);
  assert.ok(plan.markers.some((m) => m.label === "JACKPOT MAJOR") && plan.markers.some((m) => m.label === "FREE GAMES 8"));
  cfg.win.order = "fg, win";
  plan = S.computePlan(cfg, 30);
  deq(plan.win.cards.map((c) => c.kind), ["fg", "jp"]);
  deq(W.parseOrder("fg"), ["fg", "jp", "win"]);
  // 全部沒設定：沒有報獎、不改演出結束
  const none = sampleConfig(S);
  const p0 = S.computePlan(none, 30);
  assert.ok(!p0.win.any);
  deq(W.describe(p0.win), []);
});

test("驗證：押注 0、負數、等級格式、跑分位置", () => {
  const bad = winCfg({ amount: 100, bet: 0, jpAmount: -1, tiers: "BIG", meterPos: "abc" });
  const errs = S.validateConfig(bad).join("\n");
  ["押注必須大於 0", "彩金金額不能是負數", "名稱@倍數", "跑分位置"].forEach((s) => assert.ok(errs.indexOf(s) >= 0, s + " in " + errs));
  // normalizeConfig：數字整理、補欄位
  const n = S.normalizeConfig({ win: { amount: "1200", coins: 999, fgCount: 2.6, decimals: 9, jpName: "  GRAND " } });
  assert.strictEqual(n.win.amount, 1200);
  assert.strictEqual(n.win.coins, 200);
  assert.strictEqual(n.win.fgCount, 3);
  assert.strictEqual(n.win.decimals, 4);
  assert.strictEqual(n.win.jpName, "GRAND");
  assert.strictEqual(n.win.tiers, S.defaultConfig().win.tiers);
});

test("sample（預覽）：壓暗、光芒、標題彈出、跑分數字、金幣、字卡淡出", () => {
  const plan = S.computePlan(winCfg({ amount: 3200, bet: 100, coins: 12 }), 30), w = plan.win, B = w.big;
  deq(W.sample(w, B.start - 0.01).texts, []);
  const mid = W.sample(w, B.T[1] + 0.5);
  near(mid.dim, w.dim);
  assert.strictEqual(mid.rays.length, 1);
  deq(mid.texts.map((t) => t.text), ["MEGA WIN", W.format(W.countAt(B.T, B.V, B.T[1] + 0.5), 0, "")]);
  assert.strictEqual(mid.coins.length, 12);
  assert.ok(mid.meter && /^WIN /.test(mid.meter.text));
  // 開始那一刻還沒淡入；彈出途中標題縮放在 0~1.25 之間
  deq(W.sample(w, B.start).texts, []);
  const popping = W.sample(w, B.start + 0.05).texts[0];
  assert.ok(popping.text === "BIG WIN" && popping.scale > 0 && popping.scale < 1, JSON.stringify(popping));
  // 結束後：淡出完就沒有字卡，只剩跑分
  const after = W.sample(w, B.end + W.FADE + 0.01);
  assert.strictEqual(after.dim, 0);
  deq(after.texts, []);
  assert.strictEqual(after.meter.text, "WIN 3,200");
});

test("Hold & Spin 也能報獎（全部停妥後）", () => {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, "examples", "cases", "fortunedoors-prosperity-holdspin", "preset.json"), "utf8"));
  const cfg = S.normalizeConfig(raw);
  cfg.win.amount = 2400;
  cfg.win.bet = 50;
  const plan = S.computePlan(cfg, 30);
  deq(plan.errors, []);
  assert.ok(plan.win.big && plan.win.big.start > plan.allSettled);
  assert.ok(plan.markers.some((m) => m.label === "MEGA WIN"));
});

// ---------------------------------------------------------------- 模擬 AE
function aeEnv(opts) {
  const ctx = newContext(opts);
  const SS = loadSrc(ctx);
  const main = ctx.app.project.items.addComp("Main", 1920, 1080, 1, 20, 30);
  ctx.app.project.activeItem = main;
  const res = SS.ae.importFolder(new ctx.Folder(SYMBOL_DIR));
  const cfg = SS.defaultConfig();
  cfg.symbols = res.symbols.map((s) => ({ name: s.name, path: s.path, itemId: s.item.id, filler: s.name !== "SCATTER" }));
  cfg.startBoard = [["A", "K", "Q"], ["J", "A", "K"], ["Q", "J", "A"], ["K", "Q", "J"], ["A", "BAR", "BELL"]];
  cfg.endBoard = [["SEVEN", "A", "K"], ["SEVEN", "K", "Q"], ["SEVEN", "J", "A"], ["K", "Q", "J"], ["A", "BAR", "BELL"]];
  cfg.spin.startTime = 1;
  cfg.reels = SS.generateReels(cfg);
  return { ctx, S: SS, main, cfg };
}
const textDoc = (l) => l.property("ADBE Text Properties").property("ADBE Text Document");

test("AE：_Win 合成（目標合成大小）放在盤面圖層正上方，標題 / 跑分 / 金幣 / 壓暗都建好", () => {
  const env = aeEnv();
  Object.assign(env.cfg.win, { amount: 3200, bet: 100, fgCount: 10, jpName: "MAJOR", jpAmount: 50000, coins: 6 });
  const r = env.S.ae.build(env.cfg, {});
  deq(r.errors, []);
  const wc = r.winComp;
  assert.ok(wc && wc.comment === "SFS_WIN" && wc.width === 1920 && wc.height === 1080);
  const names = env.main._layers.map((l) => l.name);
  assert.strictEqual(names[names.indexOf("Win") + 1], r.boardLayer.name, "Win right above the board: " + names);
  const L = (n) => wc._layers.find((l) => l.name === n);
  ["Win Meter", "Win Meter BG", "Win Dim", "Rays Big", "Title BIG WIN", "Title MEGA WIN", "Big Win Count",
    "Title MAJOR", "Jackpot Count", "Title FREE GAMES", "Free Games Count", "Coin Big 6", "Coin JP 1"].forEach((n) => assert.ok(L(n), n));
  // 跑分表達式 = 預覽算出的數字
  const B = r.plan.win.big;
  [B.start + 0.5, B.T[1] + 0.2, B.countEnd + 1].forEach((t) => {
    assert.strictEqual(runExpr(textDoc(L("Big Win Count")).expression, t), W.format(W.countAt(B.T, B.V, t), 0, ""));
  });
  assert.strictEqual(runExpr(textDoc(L("Win Meter")).expression, B.countEnd + 1), "WIN 3,200");
  // 標題：字型、顏色、置中、描邊；BIG WIN 在 MEGA WIN 出現時消失
  const td = textDoc(L("Title BIG WIN")).value;
  assert.strictEqual(td.font, "Arial-BoldMT");
  assert.strictEqual(td.justification, env.ctx.ParagraphJustification.CENTER_JUSTIFY);
  assert.ok(td.applyStroke && td.strokeWidth > 0);
  near(L("Title BIG WIN").outPoint, B.tiers[1].start);
  deq(L("Title BIG WIN").transform.scale.valueAtTime(B.start), [0, 0]);
  // 壓暗：字卡之間回到 0
  const dim = L("Win Dim").transform.opacity, jp = r.plan.win.cards[0];
  near(dim.valueAtTime((jp.start + jp.end) / 2), 70);
  near(dim.valueAtTime(jp.end + W.FADE + 0.05), 0);
  // 金幣：位置 / 翻面表達式
  assert.ok(/seedRandom/.test(L("Coin Big 1").transform.position.expression));
  // 標記
  const mk = r.boardLayer.property("ADBE Marker").keys.map((k) => k.v.comment);
  assert.ok(mk.some((c) => /MEGA WIN/.test(c)) && mk.some((c) => /FREE GAMES 10/.test(c)), mk.join(","));
});

test("AE：盤面縮放 / 移動時字卡跟著盤面中心；小盤面字級至少畫面短邊 12%", () => {
  const env = aeEnv();
  Object.assign(env.cfg.win, { amount: 2000, bet: 100, coins: 0, meter: false });
  env.cfg.layout.position = [700, 500];
  const r = env.S.ae.build(env.cfg, {});
  const title = r.winComp._layers.find((l) => l.name === "Title BIG WIN");
  const w = r.plan.win, size = textDoc(title).value.fontSize;
  assert.ok(size >= 1080 * 0.12 - 1e-6, "min size " + size);
  near(title.transform.position.value[0], 700, 1e-6);
  // 盤面中心在 (700, 500)，標題在中心上方
  assert.ok(title.transform.position.value[1] < 500);
  void w;
});

test("AE：更新盤面時重建同一個 _Win 合成；報獎全關時刪掉", () => {
  const env = aeEnv();
  Object.assign(env.cfg.win, { amount: 500, bet: 100 });
  const r1 = env.S.ae.build(env.cfg, {});
  const id = r1.winComp.id;
  env.cfg.win.fgCount = 5;
  const r2 = env.S.ae.build(env.cfg, { boardLayer: r1.boardLayer });
  deq(r2.errors, []);
  assert.strictEqual(r2.winComp.id, id, "same comp reused");
  assert.strictEqual(env.main._layers.filter((l) => l.name === "Win").length, 1);
  assert.ok(r2.winComp._layers.some((l) => l.name === "Title FREE GAMES"));
  Object.assign(env.cfg.win, { amount: 0, fgCount: 0 });
  const r3 = env.S.ae.build(env.cfg, { boardLayer: r1.boardLayer });
  assert.strictEqual(r3.winComp, null);
  assert.strictEqual(env.ctx.app.project._items.filter((it) => it.comment === "SFS_WIN").length, 0);
  assert.strictEqual(env.main._layers.filter((l) => l.name === "Win").length, 0);
});

test("EffectCraft（模擬）：一樣建得出報獎", () => {
  const env = aeEnv({ effectcraft: true });
  Object.assign(env.cfg.win, { amount: 3000, bet: 100, coins: 3, fgCount: 3 });
  const r = env.S.ae.build(env.cfg, {});
  deq(r.errors, []);
  assert.ok(r.winComp && r.winComp._layers.length > 8);
});

// ---------------------------------------------------------------- 命令列
const SFS_CLI = path.join(ROOT, "tools", "sfs.js");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sfs-win-"));
const sfs = (args) => cp.spawnSync(process.execPath, [SFS_CLI].concat(args), { cwd: tmp, encoding: "utf8" });

test("命令列 win：設定 + 時間表；check 有報獎列與 JSON；--off", () => {
  const preset = path.join(tmp, "p.json");
  fs.copyFileSync(path.join(ROOT, "examples", "freegame.json"), preset);
  let r = sfs(["win", preset, "--amount", "4,250", "--bet", "100", "--fg", "10", "--jp", "MAJOR:88888"]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(/BIG WIN → MEGA WIN：4,250（42.5 倍）/.test(r.stdout), r.stdout);
  assert.ok(/彩金 MAJOR 88,888/.test(r.stdout) && /FREE GAMES 10 場/.test(r.stdout), r.stdout);
  const saved = JSON.parse(fs.readFileSync(preset, "utf8"));
  assert.strictEqual(saved.win.amount, 4250);
  assert.strictEqual(saved.win.jpName, "MAJOR");
  r = sfs(["check", preset]);
  assert.ok(/^WIN\s+.*B+.*M+/m.test(r.stdout) && /報獎：\$ 跑分/.test(r.stdout), r.stdout);
  const j = JSON.parse(sfs(["check", preset, "--json"]).stdout);
  deq(j.win.big.tiers.map((t) => t.name), ["BIG WIN", "MEGA WIN"]);
  assert.strictEqual(j.win.cards.length, 2);
  assert.ok(j.markers.some((m) => m.label === "JACKPOT MAJOR"));
  r = sfs(["win", preset, "--bet", "0"]);
  assert.strictEqual(r.status, 1);
  assert.ok(/押注必須大於 0/.test(r.stderr), r.stderr);
  r = sfs(["win", preset, "--off"]);
  assert.ok(/不演/.test(r.stdout), r.stdout);
  assert.ok(/報獎：贏分 0/.test(sfs(["show", preset]).stdout));
});

const hasPillow = ["python3", "python"].some((exe) => cp.spawnSync(exe, ["-c", "import PIL"]).status === 0);
test("命令列 render：關鍵畫面多了報獎（需要 Pillow）" + (hasPillow ? "" : "：略過"), () => {
  if (!hasPillow) return;
  const preset = path.join(tmp, "r.json");
  fs.copyFileSync(path.join(ROOT, "examples", "freegame.json"), preset);
  sfs(["win", preset, "--amount", "3000", "--bet", "100", "--fg", "5"]);
  const out = path.join(tmp, "keys.png");
  const r = sfs(["render", preset, "--sheet", out, "--scale", "0.25"]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(out));
});

// ---------------------------------------------------------------- 面板
const find = mockUI.find, byText = mockUI.findByText;
function click(el) { assert.ok(el, "element exists"); el.onClick.call(el); }
function loadPanel(ctx) {
  const code = fs.readFileSync(path.join(ROOT, "dist", "SlotFakeSpin.jsx"), "utf8");
  ctx.__panel = new ctx.Panel();
  vm.runInContext("(function () {\n" + code + "\n}).call(__panel);", ctx, { filename: "SlotFakeSpin.jsx" });
  return ctx.__panel;
}
function typeInto(et, v) { et.text = String(v); et.onChange.call(et); }

test("面板：快速頁 ④ 報獎填贏分 / 押注 / Free Game → 摘要、建立後有 _Win 合成；進階有「報獎」分頁", () => {
  const ctx = newContext();
  const main = ctx.app.project.items.addComp("Main", 1920, 1080, 1, 20, 30);
  ctx.app.project.activeItem = main;
  const panel = loadPanel(ctx);
  ctx.__dialogResult = new ctx.Folder(SYMBOL_DIR);
  click(byText(panel, "button", "匯入符號資料夾…"));
  const sec = find(panel, (el) => el.type === "panel" && el.text === "④ 報獎");
  assert.ok(sec, "quick win section");
  const ets = [];
  mockUI.walk(sec, (el) => { if (el.type === "edittext") ets.push(el); });
  typeInto(ets[0], 3200);
  typeInto(ets[1], 100);
  typeInto(ets[2], 10);
  const cfg = JSON.parse(ctx.app.settings.getSetting("SlotFakeSpin", "lastConfig_v2"));
  assert.strictEqual(cfg.win.amount, 3200);
  assert.strictEqual(cfg.win.fgCount, 10);
  assert.ok(find(sec, (el) => el.type === "statictext" && /BIG WIN → MEGA WIN/.test(el.text) && /FREE GAMES 10/.test(el.text)), "summary");
  assert.ok(find(panel, (el) => el.type === "tab" && el.text === "報獎"), "advanced tab");
  click(byText(panel, "button", "▶ 建立假轉"));
  deq((ctx.__alerts || []).filter((a) => /失敗|錯誤/.test(a)), []);
  assert.strictEqual(main._layers.filter((l) => l.name === "Win").length, 1);
});
