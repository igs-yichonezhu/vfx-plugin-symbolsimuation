#!/usr/bin/env node
/*
 * SlotFakeSpin 測試：
 *  1. core.js 純邏輯
 *  2. ae.js 在模擬 AE 中建置，並以 Bezier 內插實際算出每個時間點畫面上看到的符號
 *  3. dist/SlotFakeSpin.jsx 整包載入模擬 AE + ScriptUI，操作面板按鈕跑完整流程
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const assert = require("assert");
const mockAE = require("./mock_ae");
const mockUI = require("./mock_scriptui");

const ROOT = path.join(__dirname, "..");
const SYMBOL_DIR = path.join(ROOT, "examples", "symbols");

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log("  ok  " + name);
  } catch (e) {
    failed++;
    console.log("  FAIL " + name + "\n       " + (e.stack || e).toString().split("\n").slice(0, 6).join("\n       "));
  }
}
const plain = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const deq = (a, b, msg) => assert.deepStrictEqual(plain(a), plain(b), msg);
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= (eps || 1e-6), (msg || "") + " expected " + b + " got " + a);

// ---------------------------------------------------------------------------
// 載入環境
// ---------------------------------------------------------------------------
function newContext(opts) {
  const ctx = { console };
  mockAE.install(ctx, opts);
  const ui = mockUI.install(ctx);
  vm.createContext(ctx);
  ctx.__ui = ui;
  return ctx;
}

function loadSrc(ctx) {
  for (const f of ["core.js", "ae.js"]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, "src", f), "utf8"), ctx, { filename: f });
  }
  return ctx.SFS;
}

const SFS = require("../src/core.js");

function sampleConfig(S, overrides) {
  const cfg = S.defaultConfig();
  const names = ["A", "K", "Q", "J", "WILD", "SCATTER", "SEVEN"];
  cfg.symbols = names.map((n) => ({ name: n, path: "", itemId: 0, filler: n !== "SCATTER" }));
  cfg.startBoard = [
    ["A", "K", "Q"], ["J", "A", "K"], ["Q", "J", "A"], ["K", "Q", "J"], ["A", "A", "A"],
  ];
  cfg.endBoard = [
    ["WILD", "SEVEN", "SCATTER"], ["SEVEN", "SEVEN", "SEVEN"], ["SCATTER", "WILD", "A"], ["K", "SEVEN", "Q"], ["J", "J", "SEVEN"],
  ];
  if (overrides) overrides(cfg);
  return cfg;
}

// 用模擬 Property（AE Bezier 內插）重建某一輪 null 的 Y 動畫
const evalCtx = newContext();
function propFromKeys(keys) {
  const P = new evalCtx.Property("Y", "y", 0);
  keys.forEach((k) => { P.setValueAtKey(P.addKey(k.t), k.y); });
  keys.forEach((k, j) => P.setTemporalEaseAtKey(j + 1,
    [new evalCtx.KeyframeEase(k.inSpeed, k.inInf)], [new evalCtx.KeyframeEase(k.outSpeed, k.outInf)]));
  return P;
}

// 某一輪在時間 t 畫面上每一列的符號
function visibleFromPlan(S, cfg, reelPlan, t) {
  return rowsAt(S, cfg.layout, reelPlan.strip.map((s) => s.name), propFromKeys(reelPlan.keys).valueAtTime(t));
}

function rowsAt(S, L, stripNames, nullY) {
  const pitch = L.cellH + L.gapY;
  const out = [];
  for (let r = 0; r < L.rows; r++) {
    const want = L.peek + r * pitch + L.cellH / 2;
    let hit = null;
    stripNames.forEach((name, k) => {
      const y = nullY + S.stripLocalPos(L, k)[1];
      if (Math.abs(y - want) < 0.01) hit = name;
    });
    out.push(hit);
  }
  return out;
}

// ---------------------------------------------------------------------------
console.log("core.js");
// ---------------------------------------------------------------------------
test("JSON 往返（中文、跳脫字元、巢狀）", () => {
  const v = { a: "老虎機 \"WILD\"\n\t\\", b: [1, -2.5, 3e-7, true, false, null], c: { d: [] , e: {} }, f: "emoji 🎰" };
  const s = SFS.json.stringify(v);
  assert.ok(!/[^\x00-\x7f]/.test(s), "stringify output must be ASCII");
  deq(SFS.json.parse(s), v);
  deq(SFS.json.parse(SFS.json.stringify(v, 2)), v);
  deq(JSON.parse(s), v);
  deq(SFS.json.parse("﻿" + JSON.stringify(v, null, 4)), v);
});

test("JSON 錯誤輸入會丟例外", () => {
  ["{", "[1,]", "{\"a\" 1}", "tru", "\"abc", "1 2", "{'a':1}"].forEach((bad) => {
    assert.throws(() => SFS.json.parse(bad), bad);
  });
});

test("亂數可重現且在範圍內", () => {
  const a = new SFS.Rng(42), b = new SFS.Rng(42), c = new SFS.Rng(43);
  const sa = [], sb = [], sc = [];
  for (let i = 0; i < 200; i++) { sa.push(a.next()); sb.push(b.next()); sc.push(c.next()); }
  deq(sa, sb);
  assert.notDeepStrictEqual(sa, sc);
  sa.forEach((x) => assert.ok(x >= 0 && x < 1));
  const r = new SFS.Rng(0);
  for (let i = 0; i < 100; i++) { const n = r.nextInt(5); assert.ok(n >= 0 && n < 5 && Number.isInteger(n)); }
});

test("自然排序", () => {
  const arr = ["sym10.png", "sym2.png", "Sym1.png", "a.png", "B.png"];
  arr.sort(SFS.util.naturalCompare);
  deq(arr, ["a.png", "B.png", "Sym1.png", "sym2.png", "sym10.png"]);
});

test("盤面文字解析：空白 / 逗號 / Tab、大小寫、錯誤訊息", () => {
  const names = ["A", "K", "Big Win", "WILD"];
  let r = SFS.board.parseText("A K wild\n\nk a A\n", 3, 2, names);
  deq(r.errors, []);
  deq(r.board, [["A", "K"], ["K", "A"], ["WILD", "A"]]);
  r = SFS.board.parseText("A\tBig Win\tK\nBig Win, A, WILD", 3, 2, names);
  deq(r.errors, []);
  deq(r.board, [["A", "Big Win"], ["Big Win", "A"], ["K", "WILD"]]);
  r = SFS.board.parseText("A K\nX A K", 3, 2, names);
  assert.strictEqual(r.errors.length, 2);
  assert.ok(/X/.test(r.errors[1]));
  r = SFS.board.parseText("A K A", 3, 2, names);
  assert.ok(r.errors.length >= 1);
});

test("盤面 toText → parseText 往返", () => {
  const names = ["A", "K", "Big Win"];
  const b = [["A", "Big Win"], ["K", "A"]];
  const r = SFS.board.parseText(SFS.board.toText(b, 2), 2, 2, names);
  deq(r.errors, []);
  deq(r.board, b);
});

test("normalizeConfig 補齊欄位、修正型別、調整盤面大小", () => {
  const c = SFS.normalizeConfig({
    symbols: [{ name: "A" }, { foo: 1 }, { name: "B", filler: false }],
    layout: { reels: "4", rows: 2, cellW: 120.6, bogus: 1 },
    spin: { speed: "abc", motionBlur: 0 },
    startBoard: [["A", "A", "A"], ["B"]],
  });
  assert.strictEqual(c.symbols.length, 2);
  assert.strictEqual(c.symbols[1].filler, false);
  assert.strictEqual(c.layout.reels, 4);
  assert.strictEqual(c.layout.cellW, 121);
  assert.strictEqual(c.layout.bogus, undefined);
  assert.strictEqual(c.spin.speed, 18);
  assert.strictEqual(c.spin.motionBlur, false);
  deq(c.startBoard, [["A", "A"], ["B", ""], ["", ""], ["", ""]]);
  assert.strictEqual(c.endBoard.length, 4);
});

test("validateConfig 抓出空格子 / 未知符號 / 參數錯誤", () => {
  const cfg = sampleConfig(SFS);
  deq(SFS.validateConfig(cfg), []);
  cfg.startBoard[2][1] = "";
  cfg.endBoard[0][0] = "NOPE";
  cfg.spin.speed = 0;
  const e = SFS.validateConfig(cfg);
  assert.strictEqual(e.length, 3, e.join("\n"));
  deq(SFS.validateConfig(SFS.defaultConfig()).length, 1); // 只有「符號庫是空的」
});

test("fillerPool 排除非填充符號；全部排除時退回全部", () => {
  const cfg = sampleConfig(SFS);
  assert.ok(SFS.fillerPool(cfg).indexOf("SCATTER") < 0);
  cfg.symbols.forEach((s) => { s.filler = false; });
  assert.strictEqual(SFS.fillerPool(cfg).length, cfg.symbols.length);
});

function checkPlan(cfg, fps, label) {
  const plan = SFS.computePlan(cfg, fps);
  deq(plan.errors, [], label);
  const L = cfg.layout, P = cfg.spin;
  assert.strictEqual(plan.reels.length, L.reels);
  let prevStop = -1;
  const pool = SFS.fillerPool(cfg);
  plan.reels.forEach((rp, i) => {
    // 影格對齊、時間遞增
    rp.keys.forEach((k, j) => {
      near(k.t * fps, Math.round(k.t * fps), 1e-6, label + " key on frame");
      if (j) assert.ok(k.t > rp.keys[j - 1].t + 1e-9, label + " key times increasing");
      assert.ok(k.inInf >= 0.1 && k.inInf <= 100 && k.outInf >= 0.1 && k.outInf <= 100);
    });
    assert.ok(rp.stopTime >= prevStop, "stop order");
    prevStop = rp.stopTime;
    // 轉帶內容
    for (let r = 0; r < L.rows; r++) {
      assert.strictEqual(rp.strip[rp.startIndex + r].name, cfg.startBoard[i][r]);
      assert.strictEqual(rp.strip[rp.endIndex + r].name, cfg.endBoard[i][r]);
    }
    rp.strip.forEach((s) => { if (s.kind === "fill" || s.kind === "buffer") assert.ok(pool.indexOf(s.name) >= 0, "filler from pool"); });
    // 畫面上看到的盤面
    const before = visibleFromPlan(SFS, cfg, rp, rp.keys[0].t - 0.5);
    const atStart = visibleFromPlan(SFS, cfg, rp, rp.keys[0].t);
    const settled = visibleFromPlan(SFS, cfg, rp, rp.settleTime);
    const after = visibleFromPlan(SFS, cfg, rp, rp.settleTime + 3);
    deq(before, cfg.startBoard[i], label + " reel " + (i + 1) + " before spin");
    deq(atStart, cfg.startBoard[i], label + " reel " + (i + 1) + " at start");
    deq(settled, cfg.endBoard[i], label + " reel " + (i + 1) + " settled");
    deq(after, cfg.endBoard[i], label + " reel " + (i + 1) + " after");
    // 方向：從拉回點到停輪點之間單調
    const dir = plan.direction;
    const prop = propFromKeys(rp.keys);
    const hasWindup = P.windupDist > 0 && P.windupTime > 0;
    const tA = hasWindup ? rp.keys[1].t : rp.keys[0].t;
    const tB = rp.stopTime;
    let prev = prop.valueAtTime(tA), maxStep = 0;
    for (let t = tA + 0.002; t <= tB; t += 0.002) {
      const v = prop.valueAtTime(t);
      assert.ok((v - prev) * dir >= -1e-6, label + " monotonic at " + t);
      maxStep = Math.max(maxStep, Math.abs(v - prev) / 0.002);
      prev = v;
    }
    // 速度不會超過計算出的等速 v 太多（區段平滑、沒有暴衝）
    assert.ok(maxStep <= rp.speed * 1.02 + 1, label + " max speed " + maxStep + " vs " + rp.speed);
    // 中段等速：實際速度與設定轉速差距合理（受整數格數 / 最少格數影響）
    if (rp.fill > Math.max(L.rows, 2)) {
      const target = P.speed * (L.cellH + L.gapY);
      assert.ok(Math.abs(rp.speed - target) / target < 0.2, label + " speed close to target " + rp.speed + " vs " + target);
    }
  });
  return plan;
}

test("computePlan：預設參數 5x3 @30fps", () => {
  const cfg = sampleConfig(SFS, (c) => { c.spin.startTime = 1.2; });
  const plan = checkPlan(cfg, 30, "default");
  near(plan.reels[0].stopTime, 2.2, 1e-9);
  near(plan.reels[4].stopTime, 3.2, 1e-9);
  assert.strictEqual(plan.markers[0].label, "SPIN");
  assert.strictEqual(plan.markers[plan.markers.length - 1].label, "ALL SETTLED");
  near(plan.endTime, plan.reels[4].settleTime, 1e-9);
});

test("computePlan：向上轉、無拉回、無回彈、間距、露出 @24fps", () => {
  const cfg = sampleConfig(SFS, (c) => {
    c.spin.direction = "up"; c.spin.windupDist = 0; c.spin.overshoot = 0;
    c.layout.gapY = 12; c.layout.peek = 40; c.layout.cellH = 180;
  });
  checkPlan(cfg, 24, "up");
});

test("computePlan：29.97fps、大回彈、期待延遲累加", () => {
  const cfg = sampleConfig(SFS, (c) => {
    c.spin.delays = "0, 0, 0, 0.8, 0.5"; c.spin.overshoot = 1.3; c.spin.windupDist = 1.6; c.layout.peek = 90;
  });
  const plan = checkPlan(cfg, 29.97, "ntsc");
  const st = plan.reels.map((r) => r.stopTime);
  // 第 4 輪多 0.8 秒，第 5 輪再多 0.5（累加 1.3）
  near(st[3] - st[2], 0.25 + 0.8, 0.04);
  near(st[4] - st[3], 0.25 + 0.5, 0.04);
});

test("computePlan：1 輪 1 列、轉速很慢（最少填充格數）", () => {
  const cfg = sampleConfig(SFS, (c) => {
    c.layout.reels = 1; c.layout.rows = 1; c.spin.speed = 1;
    c.startBoard = [["A"]]; c.endBoard = [["WILD"]];
  });
  const plan = checkPlan(cfg, 60, "tiny");
  assert.strictEqual(plan.reels[0].fill, 2);
});

test("computePlan：只有一種符號也能跑", () => {
  const cfg = sampleConfig(SFS, (c) => {
    c.symbols = [{ name: "A", path: "", itemId: 0, filler: true }];
    c.startBoard = SFS.board.create(5, 3, "A"); c.endBoard = SFS.board.create(5, 3, "A");
  });
  checkPlan(cfg, 30, "mono");
});

test("computePlan：停得太早會回報錯誤", () => {
  const cfg = sampleConfig(SFS, (c) => { c.spin.firstStop = 0.1; });
  const plan = SFS.computePlan(cfg, 30);
  assert.ok(plan.errors.length >= 1);
  assert.ok(/第 1 輪/.test(plan.errors[0]));
});

test("computePlan：同一個種子結果相同，換種子填充不同", () => {
  const a = SFS.computePlan(sampleConfig(SFS), 30);
  const b = SFS.computePlan(sampleConfig(SFS), 30);
  const c = SFS.computePlan(sampleConfig(SFS, (x) => { x.spin.seed = 999; }), 30);
  const names = (p) => p.reels.map((r) => r.strip.map((s) => s.name).join(",")).join("|");
  assert.strictEqual(names(a), names(b));
  assert.notStrictEqual(names(a), names(c));
});

test("填充符號不會連續重複", () => {
  const plan = SFS.computePlan(sampleConfig(SFS), 30);
  plan.reels.forEach((rp) => {
    for (let k = 1; k < rp.strip.length; k++) {
      const a = rp.strip[k - 1], b = rp.strip[k];
      if (b.kind === "fill" || b.kind === "buffer") assert.notStrictEqual(a.name, b.name);
    }
  });
});

// ---------------------------------------------------------------------------
console.log("ae.js（模擬 AE）");
// ---------------------------------------------------------------------------
function aeSetup(opts) {
  const ctx = newContext(opts);
  const S = loadSrc(ctx);
  const app = ctx.app;
  const main = app.project.items.addComp("Main", 1920, 1080, 1, 10, 30);
  app.project.activeItem = main;
  return { ctx, S, app, main };
}

function importSamples(env) {
  const res = env.S.ae.importFolder(new env.ctx.Folder(SYMBOL_DIR));
  assert.strictEqual(res.failed.length, 0);
  return res;
}

function cfgFromImport(env, res, overrides) {
  const S = env.S;
  const cfg = S.defaultConfig();
  cfg.symbols = res.symbols.map((s) => ({ name: s.name, path: s.path, itemId: s.item.id, filler: s.name !== "SCATTER" }));
  cfg.startBoard = [["A", "K", "Q"], ["J", "A", "K"], ["Q", "J", "A"], ["K", "Q", "J"], ["A", "BAR", "BELL"]];
  cfg.endBoard = [["WILD", "SEVEN", "SCATTER"], ["SEVEN", "SEVEN", "SEVEN"], ["SCATTER", "WILD", "A"], ["K", "SEVEN", "Q"], ["J", "J", "SEVEN"]];
  cfg.spin.startTime = 2;
  if (overrides) overrides(cfg);
  return cfg;
}

// 從建好的合成中讀出某輪在時間 t 的可見符號
function visibleInReel(S, L, reelComp, t) {
  const ctrl = reelComp._layers.find((l) => l.name === "STRIP_CTRL");
  assert.ok(ctrl, "STRIP_CTRL exists");
  const ny = ctrl.transform.property("ADBE Position_1").valueAtTime(t);
  const nx = ctrl.transform.property("ADBE Position_0").valueAtTime(t);
  const anchor = ctrl.transform.anchorPoint.value;
  const out = [];
  for (let r = 0; r < L.rows; r++) {
    const want = L.peek + r * (L.cellH + L.gapY) + L.cellH / 2;
    const hits = reelComp._layers.filter((l) => {
      if (l.parent !== ctrl) return false;
      const p = l.transform.position.value;
      return Math.abs(ny - anchor[1] + p[1] - want) < 0.01 && Math.abs(nx - anchor[0] + p[0] - L.cellW / 2) < 0.01;
    });
    assert.strictEqual(hits.length, 1, "exactly one symbol in row " + r + " at t=" + t);
    out.push(hits[0].source.name.replace(/\.png$/, ""));
  }
  return out;
}

test("匯入資料夾：自然排序、檔名 = 符號名、放進 SFS_Symbols、重複匯入不重複", () => {
  const env = aeSetup();
  const res = importSamples(env);
  deq(res.symbols.map((s) => s.name),
    ["A", "BAR", "BELL", "CHERRY", "J", "K", "Q", "SCATTER", "SEVEN", "WILD"]);
  const folder = env.S.ae.findFolder("SFS_Symbols", env.S.ae.findFolder("SlotFakeSpin"));
  assert.ok(folder);
  res.symbols.forEach((s) => assert.strictEqual(s.item.parentFolder.id, folder.id));
  const before = env.app.project.numItems;
  const again = importSamples(env);
  assert.strictEqual(env.app.project.numItems, before);
  assert.strictEqual(again.symbols[0].item.id, res.symbols[0].item.id);
});

test("建立假轉：結構、標記、註解、動態模糊、起始 / 結果盤面正確", () => {
  const env = aeSetup();
  const res = importSamples(env);
  const cfg = cfgFromImport(env, res);
  const out = env.S.ae.build(cfg, {});
  deq(out.errors, []);
  assert.strictEqual(env.app._undo, 0, "undo group balanced");
  const L = cfg.layout;
  const board = out.boardComp;
  assert.strictEqual(board.width, 5 * 200 + 4 * 10);
  assert.strictEqual(board.height, 600);
  assert.strictEqual(board.numLayers, 5);
  assert.strictEqual(board.layer(1).name, "Reel 1");
  assert.ok(board.motionBlur);
  assert.strictEqual(out.boardLayer.containingComp, env.main);
  assert.strictEqual(out.boardLayer.comment, "SFS_BOARD");
  const marks = out.boardLayer.property("ADBE Marker").keys.map((k) => k.v.comment);
  deq(marks, ["SFS SPIN", "SFS R1 STOP", "SFS R2 STOP", "SFS R3 STOP", "SFS R4 STOP", "SFS R5 STOP", "SFS ALL SETTLED"]);
  const stored = env.S.ae.readBoardConfig(out.boardLayer);
  deq(stored.endBoard, cfg.endBoard);
  for (let i = 0; i < 5; i++) {
    const rl = board.layer(i + 1);
    const rc = rl.source;
    assert.strictEqual(rc.width, 200);
    assert.strictEqual(rc.height, 600);
    assert.ok(rc.motionBlur && rc.hideShyLayers);
    assert.strictEqual(rc.layer(1).name, "STRIP_CTRL");
    near(rl.transform.position.value[0], i * 210 + 100);
    const rp = out.plan.reels[i];
    rc._layers.forEach((l) => {
      if (l.nullLayer) return;
      assert.ok(l.motionBlur);
      near(l.outPoint, rc.duration);
      near(l.transform.scale.value[0], 200 / 256 * 100, 1e-9);
    });
    deq(visibleInReel(env.S, L, rc, 0), cfg.startBoard[i]);
    deq(visibleInReel(env.S, L, rc, 2), cfg.startBoard[i]);
    deq(visibleInReel(env.S, L, rc, rp.settleTime), cfg.endBoard[i]);
    deq(visibleInReel(env.S, L, rc, 9.9), cfg.endBoard[i]);
    // null solid 收進盤面資料夾
    assert.strictEqual(rc.layer(1).source.parentFolder.id, rc.parentFolder.id);
  }
  // 起始 / 結果格子有標籤顏色，填充為 shy
  const rc1 = board.layer(1).source;
  assert.ok(rc1._layers.some((l) => /_S01_A$/.test(l.name) && l.label === 9));
  assert.ok(rc1._layers.some((l) => /_E01_WILD$/.test(l.name) && l.label === 1));
  assert.ok(rc1._layers.filter((l) => /_F\d+_/.test(l.name)).every((l) => l.shy));
});

test("更新選取盤面：重建內容、移除舊轉輪合成與 null、標記不重複、尊重圖層時間偏移", () => {
  const env = aeSetup();
  const res = importSamples(env);
  const cfg = cfgFromImport(env, res);
  const first = env.S.ae.build(cfg, {});
  deq(first.errors, []);
  const oldReels = [];
  for (let i = 1; i <= 5; i++) oldReels.push(first.boardComp.layer(i).source);
  const itemsBefore = env.app.project.numItems;
  first.boardLayer.startTime = 1; // 使用者把盤面圖層往後拖 1 秒
  first.boardLayer.selected = true;
  assert.strictEqual(env.S.ae.selectedBoardLayer(), first.boardLayer);

  const cfg2 = env.S.ae.readBoardConfig(first.boardLayer);
  cfg2.layout.reels = 4;
  cfg2.layout.rows = 4;
  cfg2.startBoard = env.S.board.create(4, 4, "BAR");
  cfg2.endBoard = env.S.board.create(4, 4, "WILD");
  cfg2.endBoard[2][3] = "SCATTER";
  const second = env.S.ae.build(cfg2, { boardLayer: first.boardLayer });
  deq(second.errors, []);
  assert.strictEqual(second.boardLayer, first.boardLayer);
  assert.strictEqual(second.boardComp, first.boardComp);
  assert.strictEqual(second.boardComp.numLayers, 4);
  assert.strictEqual(second.boardComp.height, 800);
  oldReels.forEach((rc) => assert.ok(env.app.project._items.indexOf(rc) < 0, "old reel comp removed"));
  assert.ok(!env.app.project._items.some((it) => it.isSolid && !it.usedIn.length), "no orphan null solids");
  assert.strictEqual(env.app.project.numItems, itemsBefore - 2, "4 reels + 4 nulls replace 5 + 5");
  const marks = first.boardLayer.property("ADBE Marker").keys;
  assert.strictEqual(marks.length, 1 + 4 + 1);
  near(marks[0].t, 2, 1e-9, "SPIN marker stays at target time 2s");
  // 圖層內時間 = 目標時間 - 1
  const rc = second.boardComp.layer(1).source;
  deq(visibleInReel(env.S, cfg2.layout, rc, 0.99), ["BAR", "BAR", "BAR", "BAR"]);
  near(second.plan.startTime, 1, 1e-9);
  deq(visibleInReel(env.S, cfg2.layout, second.boardComp.layer(3).source, 9), ["WILD", "WILD", "WILD", "SCATTER"]);
});

test("輸出到新建合成", () => {
  const env = aeSetup();
  env.app.project.activeItem = null;
  const res = importSamples(env);
  const cfg = cfgFromImport(env, res, (c) => { c.layout.target = "new"; c.layout.newCompFps = 24; });
  const out = env.S.ae.build(cfg, {});
  deq(out.errors, []);
  assert.ok(out.createdTarget);
  assert.strictEqual(out.target.width, 1920);
  assert.strictEqual(out.target.frameRate, 24);
  assert.ok(out.target.openedInViewer);
  assert.ok(out.target.duration >= out.plan.endTime + 1);
});

test("沒有作用中合成時給出提示", () => {
  const env = aeSetup();
  env.app.project.activeItem = null;
  const res = importSamples(env);
  const out = env.S.ae.build(cfgFromImport(env, res), {});
  assert.strictEqual(out.errors.length, 1);
  assert.ok(/合成/.test(out.errors[0]));
});

test("符號素材被刪掉：用路徑重新匯入；檔案也不在時回報缺少", () => {
  const env = aeSetup();
  const res = importSamples(env);
  const cfg = cfgFromImport(env, res);
  const wild = res.symbols.find((s) => s.name === "WILD").item;
  wild.remove();
  let out = env.S.ae.build(cfg, {});
  deq(out.errors, []);
  assert.notStrictEqual(cfg.symbols.find((s) => s.name === "WILD").itemId, wild.id);

  const env2 = aeSetup();
  const res2 = importSamples(env2);
  const cfg2 = cfgFromImport(env2, res2);
  const s = cfg2.symbols.find((x) => x.name === "SEVEN");
  res2.symbols.find((x) => x.name === "SEVEN").item.remove();
  s.path = "/nonexistent/SEVEN.png";
  s.name = "SEVEN_X";
  cfg2.endBoard[1] = ["SEVEN_X", "SEVEN_X", "SEVEN_X"];
  cfg2.endBoard[0][1] = "WILD"; cfg2.endBoard[3][1] = "WILD"; cfg2.endBoard[4][2] = "WILD";
  out = env2.S.ae.build(cfg2, {});
  assert.strictEqual(out.errors.length, 1);
  assert.ok(/SEVEN_X/.test(out.errors[0]));
  assert.strictEqual(env2.app._undo, 0);
});

test("動態符號（合成）較短時開啟時間重映射循環", () => {
  const env = aeSetup();
  const res = importSamples(env);
  const anim = env.app.project.items.addComp("WILD_anim", 300, 300, 1, 1, 30);
  const cfg = cfgFromImport(env, res);
  cfg.symbols.push({ name: "WILD_anim", path: "", itemId: anim.id, filler: false });
  cfg.endBoard[0][0] = "WILD_anim";
  const out = env.S.ae.build(cfg, {});
  deq(out.errors, []);
  const rc = out.boardComp.layer(1).source;
  const l = rc._layers.find((x) => x.source === anim);
  assert.ok(l.timeRemapEnabled);
  assert.strictEqual(l.property("ADBE Time Remapping").expression, "loopOut(\"cycle\")");
  near(l.outPoint, rc.duration);
  near(l.transform.scale.value[0], 200 / 300 * 100, 1e-9);
});

test("目標合成太短時給警告", () => {
  const env = aeSetup();
  env.main.duration = 3;
  const res = importSamples(env);
  const out = env.S.ae.build(cfgFromImport(env, res), {});
  deq(out.errors, []);
  assert.strictEqual(out.warnings.length, 1);
});

// ---------------------------------------------------------------------------
console.log("dist/SlotFakeSpin.jsx（模擬 AE + ScriptUI 面板操作）");
// ---------------------------------------------------------------------------
function loadDist(ctx, asPanel) {
  const code = fs.readFileSync(path.join(ROOT, "dist", "SlotFakeSpin.jsx"), "utf8");
  ctx.__panel = asPanel ? new ctx.Panel() : undefined;
  vm.runInContext("(function () {\n" + code + "\n}).call(" + (asPanel ? "__panel" : "this") + ");", ctx, { filename: "SlotFakeSpin.jsx" });
  return ctx.__panel || ctx.__windows[0];
}

const find = mockUI.find, byText = mockUI.findByText, walk = mockUI.walk;
function click(el) { assert.ok(el, "element exists"); assert.ok(el.onClick, "has onClick: " + el.text); el.onClick.call(el); }
function cells(root) {
  const out = [];
  walk(root, (el) => { if (el.type === "button" && el.sfsReel !== undefined) out.push(el); });
  return out;
}
function noErrorsAlerted(ctx) {
  const bad = (ctx.__alerts || []).filter((a) => /失敗|錯誤|error/i.test(a));
  deq(bad, []);
}

test("dist 是純 ASCII 且符合 ES3", () => {
  const code = fs.readFileSync(path.join(ROOT, "dist", "SlotFakeSpin.jsx"), "utf8");
  assert.ok(!/[^\x00-\x7f]/.test(code));
  require("acorn").parse(code, { ecmaVersion: 3 });
});

test("面板完整流程：匯入 → 畫盤面 → 文字編輯 → 建立 → 讀取 → 更新 → 存 / 開設定檔", () => {
  const ctx = newContext();
  const app = ctx.app;
  const main = app.project.items.addComp("Main", 1920, 1080, 1, 10, 30);
  app.project.activeItem = main;
  const panel = loadDist(ctx, true);
  assert.ok(panel.children.length > 0, "panel built");
  deq(ctx.__alerts || [], []);

  // 匯入
  ctx.__dialogResult = new ctx.Folder(SYMBOL_DIR);
  click(byText(panel, "button", "匯入資料夾…"));
  const list = find(panel, (el) => el.type === "listbox");
  assert.strictEqual(list.items.length, 10);
  assert.strictEqual(list.items[0].text, "\u25CF A");
  assert.ok(cells(panel).every((c) => c.text !== "-"), "boards auto-filled after first import");

  // 把 SCATTER 設成非填充
  list.selection = [list.items[7]];
  list.onChange.call(list);
  click(byText(panel, "button", "切換填充"));
  assert.ok(/^○ SCATTER$/.test(list.items[7].text));

  // 畫筆 + 點格子 / Shift 整輪 / Alt 吸取
  const dd = find(panel, (el) => el.type === "dropdownlist" && el.items.length === 10);
  dd.selection = 9; dd.onChange.call(dd); // WILD
  const cs = cells(panel);
  assert.strictEqual(cs.length, 15);
  click(cs[0]);
  assert.strictEqual(cs[0].text, "WILD");
  ctx.ScriptUI.environment.keyboardState.shiftKey = true;
  click(cs.find((c) => c.sfsReel === 2 && c.sfsRow === 1));
  ctx.ScriptUI.environment.keyboardState.shiftKey = false;
  deq(cs.filter((c) => c.sfsReel === 2).map((c) => c.text), ["WILD", "WILD", "WILD"]);
  dd.selection = 0; dd.onChange.call(dd);
  ctx.ScriptUI.environment.keyboardState.altKey = true;
  click(cs[0]);
  ctx.ScriptUI.environment.keyboardState.altKey = false;
  assert.strictEqual(dd.selection.text, "WILD");
  // onDraw 不會出錯
  cs.forEach((c) => { c.onDraw.call(c); });
  assert.ok(ctx.__ui.graphicsCalls.indexOf("drawImage") >= 0);

  // 文字編輯結果盤面
  click(byText(panel, "radiobutton", "結果盤面"));
  ctx.__onDialog = (d) => {
    const et = find(d, (el) => el.type === "edittext");
    et.text = "SEVEN SEVEN SEVEN bar bell\nwild WILD WILD A K\nQ J SCATTER A A";
    click(find(d, (el) => el.type === "button" && el.text === "套用"));
    return d.closed;
  };
  click(byText(panel, "button", "文字編輯…"));
  ctx.__onDialog = null;
  deq(cells(panel).filter((c) => c.sfsRow === 0).map((c) => c.text), ["SEVEN", "SEVEN", "SEVEN", "BAR", "BELL"]);

  // 開始時間取目前時間
  main.time = 1.5;
  click(byText(panel, "button", "取目前時間"));

  // 建立
  click(byText(panel, "button", "▶ 建立假轉"));
  noErrorsAlerted(ctx);
  const boardLayer = main._layers.find((l) => l.comment === "SFS_BOARD");
  assert.ok(boardLayer, "board layer in main comp");
  const cfg = JSON.parse(boardLayer.source.comment).config;
  assert.strictEqual(cfg.spin.startTime, 1.5);
  deq(cfg.endBoard.map((col) => col[0]), ["SEVEN", "SEVEN", "SEVEN", "BAR", "BELL"]);
  assert.strictEqual(cfg.symbols[7].filler, false);
  const status = panel.children[panel.children.length - 1];
  assert.ok(/建立完成/.test(status.text), status.text);

  // 改動面板 → 讀取選取盤面會還原
  click(byText(panel, "button", "互換"));
  boardLayer.selected = true;
  click(byText(panel, "button", "讀取選取盤面"));
  deq(cells(panel).filter((c) => c.sfsRow === 0).map((c) => c.text), ["SEVEN", "SEVEN", "SEVEN", "BAR", "BELL"]);

  // 改尺寸 → 更新選取盤面
  const etReels = find(panel, (el) => el.type === "edittext" && el.text === "5" && el.characters === 3);
  etReels.text = "6";
  click(byText(panel, "button", "套用尺寸"));
  assert.strictEqual(cells(panel).length, 18);
  // 新增的第 6 輪自動用填充符號補滿（不含 SCATTER）
  const reel6 = cells(panel).filter((c) => c.sfsReel === 5);
  assert.ok(reel6.every((c) => c.text !== "-" && c.text !== "SCATTER"), reel6.map((c) => c.text).join(","));
  // 清掉一格 → 更新應該被驗證擋下
  const s0 = cells(panel)[0];
  click(byText(panel, "button", "清空"));
  assert.strictEqual(s0.text, "-");
  click(byText(panel, "button", "更新選取盤面"));
  assert.ok((ctx.__alerts || []).some((a) => /符號庫是空的/.test(a)), "empty library reported");
  ctx.__alerts = [];
  ctx.__dialogResult = new ctx.Folder(SYMBOL_DIR);
  click(byText(panel, "button", "匯入資料夾…"));
  click(byText(panel, "button", "更新選取盤面"));
  noErrorsAlerted(ctx);
  assert.strictEqual(boardLayer.source.numLayers, 6);
  assert.strictEqual(main._layers.filter((l) => l.comment === "SFS_BOARD").length, 1);

  // 數字欄位：不合法輸入會還原，超出範圍會夾住
  const etSpeed = find(panel, (el) => el.type === "edittext" && el.text === "18");
  etSpeed.text = "abc"; etSpeed.onChange.call(etSpeed);
  assert.strictEqual(etSpeed.text, "18");
  etSpeed.text = "-5"; etSpeed.onChange.call(etSpeed);
  assert.strictEqual(etSpeed.text, "0.5");

  // 存 / 開設定檔
  const tmp = path.join(os.tmpdir(), "sfs-test-" + process.pid + ".json");
  ctx.__dialogResult = new ctx.File(tmp.replace(/\.json$/, ""));
  click(byText(panel, "button", "存設定…"));
  assert.ok(fs.existsSync(tmp), "preset written with .json extension");
  const saved = JSON.parse(fs.readFileSync(tmp, "utf8"));
  assert.strictEqual(saved.layout.reels, 6);
  assert.strictEqual(saved.spin.speed, 0.5);
  saved.spin.speed = 22;
  fs.writeFileSync(tmp, JSON.stringify(saved));
  ctx.__dialogResult = new ctx.File(tmp);
  click(byText(panel, "button", "開設定…"));
  assert.ok(find(panel, (el) => el.type === "edittext" && el.text === "22"), "speed field synced from preset");
  fs.unlinkSync(tmp);
  noErrorsAlerted(ctx);
  assert.strictEqual(app._undo, 0);

  // 設定會存在 app.settings，重開面板時還原
  const ctx2Panel = loadDist(ctx, true);
  assert.strictEqual(cells(ctx2Panel).length, 18);
});

test("以「執行指令碼」方式開啟時建立浮動視窗", () => {
  const ctx = newContext();
  const win = loadDist(ctx, false);
  assert.ok(win instanceof ctx.Window);
  assert.ok(win.shown);
  deq(ctx.__alerts || [], []);
});

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
