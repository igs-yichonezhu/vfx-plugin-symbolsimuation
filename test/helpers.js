/*
 * 測試共用：迷你測試框架、模擬環境載入、用 AE 的 Bezier 內插算出畫面上的符號。
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");
const mockAE = require("./mock_ae");
const mockUI = require("./mock_scriptui");

const ROOT = path.join(__dirname, "..");
const SYMBOL_DIR = path.join(ROOT, "examples", "symbols");

const results = { passed: 0, failed: 0 };
function test(name, fn) {
  try {
    fn();
    results.passed++;
    console.log("  ok  " + name);
  } catch (e) {
    results.failed++;
    console.log("  FAIL " + name + "\n       " + (e.stack || e).toString().split("\n").slice(0, 7).join("\n       "));
  }
}

// vm 裡建立的陣列 / 物件跟 Node 不同 realm，deepStrictEqual 會比對 prototype；先轉成純 JSON 再比
const plain = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const deq = (a, b, msg) => assert.deepStrictEqual(plain(a), plain(b), msg);
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= (eps || 1e-6), (msg || "") + " expected " + b + " got " + a);

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

// 5x3、7 種符號的範例設定；overrides 改完後會重新產生各輪節奏（除非 overrides 自己設了 reels）
function sampleConfig(S, overrides) {
  const cfg = S.defaultConfig();
  const names = ["A", "K", "Q", "J", "WILD", "SCATTER", "SEVEN"];
  cfg.symbols = names.map((n) => ({ name: n, path: "", itemId: 0, filler: n !== "SCATTER" }));
  cfg.startBoard = [["A", "K", "Q"], ["J", "A", "K"], ["Q", "J", "A"], ["K", "Q", "J"], ["A", "A", "A"]];
  cfg.endBoard = [["WILD", "SEVEN", "SCATTER"], ["SEVEN", "SEVEN", "SEVEN"], ["SCATTER", "WILD", "A"], ["K", "SEVEN", "Q"], ["J", "J", "SEVEN"]];
  const before = cfg.reels;
  if (overrides) overrides(cfg);
  if (cfg.reels === before) cfg.reels = S.generateReels(cfg);
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

// 某一輪在時間 t 畫面上每一列的符號
function visibleFromPlan(S, cfg, reelPlan, t) {
  return rowsAt(S, cfg.layout, reelPlan.strip.map((s) => s.name), propFromKeys(reelPlan.keys).valueAtTime(t));
}

// 數值微分：時間 t 的速度（px/s）
function speedAt(prop, t, h) {
  h = h || 1e-4;
  return (prop.valueAtTime(t + h) - prop.valueAtTime(t - h)) / (2 * h);
}

module.exports = {
  fs, path, vm, assert, mockAE, mockUI, ROOT, SYMBOL_DIR, results, test, plain, deq, near,
  newContext, loadSrc, SFS, sampleConfig, propFromKeys, rowsAt, visibleFromPlan, speedAt,
};
