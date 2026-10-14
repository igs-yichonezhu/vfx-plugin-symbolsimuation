#!/usr/bin/env node
/*
 * 產生預覽用的逐格資料（不是 AE 算圖）：用與 AE 相同的 Bezier 關鍵影格內插計算每一輪的位置，
 * 交給 tools/preview_render.py 畫成 GIF，方便在沒有 AE 的環境檢查轉動手感。
 */
"use strict";
const path = require("path");
const fs = require("fs");
const SFS = require("../src/core.js");
const mockAE = require("../test/mock_ae");

const ctx = {};
mockAE.install(ctx);
const cfg = SFS.defaultConfig();
const names = ["A", "BAR", "BELL", "CHERRY", "J", "K", "Q", "SCATTER", "SEVEN", "WILD"];
cfg.symbols = names.map((n) => ({ name: n, path: "", itemId: 0, filler: n !== "SCATTER" }));
cfg.layout.cellW = cfg.layout.cellH = 96;
cfg.layout.gapX = 6;
cfg.spin.startTime = 0.4;
cfg.spin.delays = process.argv[2] || "0,0,0,0,0.9";
cfg.startBoard = [["A", "K", "Q"], ["J", "A", "K"], ["Q", "J", "A"], ["K", "Q", "J"], ["A", "BAR", "BELL"]];
cfg.endBoard = [["CHERRY", "SEVEN", "BELL"], ["BAR", "SEVEN", "Q"], ["J", "SEVEN", "A"], ["SCATTER", "SEVEN", "K"], ["K", "SEVEN", "BAR"]];

const fps = 30;
const plan = SFS.computePlan(cfg, fps);
if (plan.errors.length) throw new Error(plan.errors.join("\n"));
const props = plan.reels.map((rp) => {
  const P = new ctx.Property("Y", "y", 0);
  rp.keys.forEach((k) => P.setValueAtKey(P.addKey(k.t), k.y));
  rp.keys.forEach((k, j) => P.setTemporalEaseAtKey(j + 1, [new ctx.KeyframeEase(k.inSpeed, k.inInf)], [new ctx.KeyframeEase(k.outSpeed, k.outInf)]));
  return P;
});
const samples = 10, shutter = cfg.spin.shutterAngle / 360 / fps;
const frames = [];
for (let f = 0; f <= Math.ceil((plan.endTime + 0.6) * fps); f++) {
  const t = f / fps;
  frames.push(props.map((P) => {
    const ys = [];
    for (let s = 0; s < samples; s++) ys.push(P.valueAtTime(t - shutter / 2 + shutter * (s + 0.5) / samples));
    return ys;
  }));
}
const out = {
  layout: cfg.layout, fps, plan: { boardW: plan.boardW, boardH: plan.boardH, markers: plan.markers },
  reels: plan.reels.map((rp) => ({ x: rp.x, strip: rp.strip.map((s) => s.name) })), frames,
};
const file = path.join(process.argv[3] || ".", "preview_frames.json");
fs.writeFileSync(file, JSON.stringify(out));
console.log("wrote " + file + " (" + frames.length + " frames)");
