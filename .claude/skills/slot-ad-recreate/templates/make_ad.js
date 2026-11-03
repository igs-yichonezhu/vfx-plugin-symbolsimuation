#!/usr/bin/env node
/*
 * Spicy Fortunes 假廣告：算好所有時間（轉盤轉動曲線、指針撥動、FG 每格鎖住、數值、音效），產生 kit/build_ad.jsx
 * build_ad.jsx 在 AE（檔案 > 指令碼 > 執行指令碼檔案）或 EffectCraft 執行，建出整支廣告：
 *   AD_SpicyFortunes（成品，1080x1920，29.5 秒）← 賭場背景 + 曲面機台（螢幕用綠幕遮罩）+ SCREEN
 *   SCREEN ← WHEEL_SCENE（彩金轉盤 → MAJOR JACKPOT）→ 綠鑽轉場 → FG_SCENE（Hold & Spin 5x6 → 辣椒人噴火 → 數值 → BIG WIN）
 * FG 的格子轉動與 BIG WIN 跑分用 SlotFakeSpin（fg.json、SlotFakeSpin_apply.jsx）建。
 *   node make_ad.js            產生 kit/build_ad.jsx（AE 用：開新專案、存 .aep）
 */
"use strict";
const fs = require("fs");
const path = require("path");
const S = require("../../src/core.js");

const KIT = path.join(__dirname, "kit");
const meta = JSON.parse(fs.readFileSync(path.join(KIT, "meta.json"), "utf8"));
const FPS = 30, DUR = 29.5;
const snap = (t) => Math.round(t * FPS) / FPS;
const r4 = (v) => Math.round(v * 10000) / 10000;

// ------------------------------------------------------------------ 時間表（成品時間，秒）
const T = {
  reveal: [0.8, 1.35],      // MG 畫面（照 PSD）→ 辣椒人往右下讓開，露出後面的轉盤
  spinPress: 1.25,          // 按 SPIN
  spinStart: 1.4,           // 轉盤起轉（先往回拉）
  windEnd: 1.65,
  accelEnd: 2.05,
  stop: 6.6,                // 停在 MINOR（差一點就到 GRAND）
  jp: 7.4,                  // MINOR JACKPOT 字卡
  jpCount: [7.75, 9.35],
  jpEnd: 10.5,
  trans: 10.35,             // 綠鑽衝向鏡頭
  flash: 10.8,              // 白光最亮、切到 FG
  fg: 10.8,                 // FG_SCENE 在 SCREEN 的起點
  fire: 19.3,               // 辣椒人噴火（角色張嘴）
  ignite: 19.95,            // 火掃到辣椒格：燒起來、出數值
  collect: 21.6,            // 收數值
  big: 22.7,                // BIG WIN
  end: DUR,
};

// ------------------------------------------------------------------ 轉盤：轉動曲線
// 轉輪1（MG 內嵌那份）13 格、每格 27.69°，格線在 6.1° + 27.69°k（畫面角度，0 = 右、順時針）。
// 指針在正上方（270°）。順時針轉 R 度後，原本在 φ 的格子到 φ + R。左邊的 MINOR 中心 186.1° → R ≡ 83.9 到指針；
// 接著來的是 GRAND（158.4°）。停在 R ≡ 91：MINOR 在選擇框裡（偏 7°），GRAND 差 7° 就到（差一點就中 GRAND）
const SEG = 360 / 13, PEG = 270 - 6.1;
const W = { V: 900, wind: -10, p: 3.2 };
W.Rf = 91 + 360 * 6;
{
  const { spinStart: a, windEnd: b, accelEnd: c, stop: e } = T;
  // R(d) = wind + V(c-b)/2 + V(d-c)；減速段 R = R(d) + (Rf - R(d))(1 - (1-u)^p)，起始速度 = V → Rf - R(d) = V(e-d)/p
  const base = W.wind + W.V * (c - b) / 2 - W.V * c;
  W.d = (W.Rf - base - W.V * e / W.p) / (W.V - W.V / W.p);
  W.Rd = W.wind + W.V * (c - b) / 2 + W.V * (W.d - c);
  if (!(W.d > c && W.d < e)) throw new Error("wheel decel start out of range: " + W.d);
  void a;
}
function wheelAt(t) {
  const { spinStart: a, windEnd: b, accelEnd: c, stop: e } = T;
  if (t <= a) return 0;
  if (t <= b) { const u = (t - a) / (b - a); return W.wind * (1 - Math.cos(Math.PI * u)) / 2; }
  if (t <= c) { const u = t - b; return W.wind + 0.5 * (W.V / (c - b)) * u * u; }
  if (t <= W.d) return W.wind + W.V * (c - b) / 2 + W.V * (t - c);
  if (t <= e) { const u = (t - W.d) / (e - W.d); return W.Rd + (W.Rf - W.Rd) * (1 - Math.pow(1 - u, W.p)); }
  return W.Rf;
}
// 同一條曲線寫成 AE 表達式（旋轉）
const wheelExpr = [
  "var t=time,a=" + T.spinStart + ",b=" + T.windEnd + ",c=" + T.accelEnd + ",d=" + r4(W.d) + ",e=" + T.stop + ",V=" + W.V + ",w=" + W.wind + ",p=" + W.p + ",Rd=" + r4(W.Rd) + ",Rf=" + W.Rf + ",r=0;",
  "if(t<=a){r=0;}else if(t<=b){r=w*(1-Math.cos(Math.PI*(t-a)/(b-a)))/2;}",
  "else if(t<=c){var u=t-b;r=w+0.5*(V/(c-b))*u*u;}",
  "else if(t<=d){r=w+V*(c-b)/2+V*(t-c);}",
  "else if(t<=e){var k=(t-d)/(e-d);r=Rd+(Rf-Rd)*(1-Math.pow(1-k,p));}",
  "else{r=Rf;}",
  "r;",
].join("\n");
// 指針：格線（R ≡ PEG mod SEG）撥過指針，指針被推開再彈回（用角度算，轉越慢彈越慢）
const pointerExpr = [
  "var R=thisComp.layer(\"Wheel Disk\").transform.rotation.value,S=" + r4(SEG) + ";",
  "var w=((R-" + PEG + "+5)%S+S)%S;",
  "var a=w<5?-20*(w/5):-20*Math.exp(-(w-5)/3.5)*Math.cos((w-5)/2.5);",
  "a;",
].join("\n");
// 指針撥動的時間：慢下來之後（間隔 > 0.11 秒）才放「答」聲
const ticks = [];
{
  let prev = Math.floor((wheelAt(T.spinStart) - PEG) / SEG), last = -1;
  for (let t = T.spinStart; t <= T.stop + 0.01; t += 1 / 240) {
    const k = Math.floor((wheelAt(t) - PEG) / SEG);
    if (k > prev) { if (last >= 0 && t - last > 0.11) ticks.push(snap(t)); last = t; prev = k; }
  }
}

// ------------------------------------------------------------------ FG：SlotFakeSpin Hold & Spin 計畫
const fgCfg = S.normalizeConfig(JSON.parse(fs.readFileSync(path.join(KIT, "fg.json"), "utf8")));
const fgPlan = S.computePlan(fgCfg, FPS);
if (fgPlan.errors.length) throw new Error("fg plan: " + fgPlan.errors.join("; "));
const FGPOS = fgCfg.layout.position;
const toFG = (x, y) => [r4(x - fgPlan.boardW / 2 + FGPOS[0]), r4(y - fgPlan.boardH / 2 + FGPOS[1])];
// 鎖住的格子（FG 本地時間）。辣椒格在 FG.psd 上不是放在格子正中間：中心 = 格子中心 + (-5, -7.5)（CHILI.png 已經內含這個偏移）
const CHILI_OFF = [-5, -7.5];
const locks = fgPlan.pulses.map((p) => {
  const c = fgPlan.cells[p.cell], pos = toFG(c.x, c.y);
  if (p.name === "CHILI") { pos[0] = r4(pos[0] + CHILI_OFF[0]); pos[1] = r4(pos[1] + CHILI_OFF[1]); }
  return { name: p.name, t: r4(p.t), row: c.row, col: c.col, pos };
});
// 連續圖對到靜態辣椒格（calibrate.py 量的）：縮放 %、連續圖中心相對辣椒格中心的位移
const SEQCAL = { chiliOpen: { scale: 126.5, dx: 0, dy: -27 }, chiliLoop: { scale: 127, dx: 0, dy: -29 }, plate: { scale: 136, dx: 2, dy: -13 } };
// 數值：辣椒格（由上到下被火掃到）+ 雙鑽；總和 = BIG WIN 28,320
const chiliValues = [2000, 5000, 1200, 3000, 8000, 1500];
const diaValues = [1500, 2500, 1620, 2000];
const chili = locks.filter((l) => l.name === "CHILI").sort((a, b) => a.row - b.row);
const dias = locks.filter((l) => l.name === "DDIA").sort((a, b) => a.row - b.row || a.col - b.col);
chili.forEach((l, i) => { l.value = chiliValues[i]; l.ignite = r4(snap(T.ignite - T.fg + i * 0.1)); });
dias.forEach((l, i) => { l.value = diaValues[i]; l.ignite = r4(snap(T.ignite - T.fg + 0.75 + i * 0.12)); });
// 三色寶石：每回合在空格子落幾顆，從同顏色的碗飛出來（粉 = EXTRA SPINS、藍 = EXTRA PAYS、綠 = EXTRA ROWS）
const GEM_CELLS = [
  [[5, 3, "PINK"], [6, 5, "GREEN"], [2, 4, "BLUE"]],
  [[4, 1, "BLUE"], [6, 3, "PINK"], [1, 4, "GREEN"], [5, 5, "PINK"]],
  [[3, 1, "GREEN"], [2, 3, "BLUE"], [6, 4, "PINK"], [3, 5, "BLUE"]],
];
const gemValues = [100, 200, 120, 160, 300, 100, 240, 200, 120, 400, 160];
const gems = [];
GEM_CELLS.forEach((list, k) => {
  const rd = fgPlan.rounds[k];
  list.forEach(([row, col, color], j) => {
    const cell = fgPlan.cells.find((c) => c.row === row - 1 && c.col === col - 1);
    gems.push({ name: "GEM_" + color, color, row: row - 1, col: col - 1, pos: toFG(cell.x, cell.y),
      t: r4(snap(rd.firstStop + 0.15 + j * ((rd.settle - rd.firstStop) / list.length))) });
  });
});
gems.forEach((g, i) => { g.value = gemValues[i % gemValues.length]; g.ignite = r4(snap(T.ignite - T.fg + 0.75 + 0.5 + i * 0.07)); });
locks.push(...gems);
locks.sort((a, b) => a.t - b.t);
const TOTAL = chiliValues.concat(diaValues, gems.map((g) => g.value)).reduce((a, b) => a + b, 0);
const collect = chili.concat(dias, gems).sort((a, b) => a.row - b.row || a.col - b.col).map((l, i) => ({ pos: l.pos, t: r4(snap(T.collect - T.fg + i * 0.09)) }));

// BIG WIN 用 SlotFakeSpin 報獎：設定寫回 fg.json（FG 本地 big = T.big - T.fg）
const bigLocal = T.big - T.fg;
Object.assign(fgCfg.win, {
  amount: TOTAL, bet: 100, tiers: "BIG WIN@1", delay: r4(bigLocal - fgPlan.allSettled), bigDelay: 0, tierTime: 3.4, hold: 3.6,
  coins: 45, dim: 62, rays: true, meter: true, meterLabel: "", meterPos: "540,1864", size: 150, order: "win", font: "Arial-BoldMT",
});
{
  const raw = JSON.parse(fs.readFileSync(path.join(KIT, "fg.json"), "utf8"));
  raw.win = fgCfg.win;
  fs.writeFileSync(path.join(KIT, "fg.json"), JSON.stringify(raw, null, 2) + "\n");
}
const fgPlan2 = S.computePlan(S.normalizeConfig(JSON.parse(fs.readFileSync(path.join(KIT, "fg.json"), "utf8"))), FPS);
const B = fgPlan2.win.big;
if (!B || Math.abs(B.start - bigLocal) > 0.05) throw new Error("big win timing off: " + (B && B.start));

// ------------------------------------------------------------------ 轉盤字卡跑分 / 金幣表達式
const jpCount = S.win.countExpr([T.jpCount[0], T.jpCount[1]], [0, 4000], 0, "");
const coinExpr = (t0, x, y) => S.win.coinExpr({ t0, life: 1.5, stagger: 0.8, x, y, vx: 520, vy0: 1500, vy1: 2300, g: 3600 });

// ------------------------------------------------------------------ 音效（成品時間）
const fgAbs = (t) => r4(t + T.fg);
const sfx = [
  ["button", T.spinPress, 0], ["wheelSpin", T.spinStart + 0.1, -3], ["wheelStop", T.stop - 0.05, 0],
  ["jpAround", T.jp, -2], ["award", T.jpCount[0], -4], ["unlock", T.trans, 0], ["flame", T.flash - 0.15, -2],
  ["fireball", T.fire, 0], ["flame", T.ignite, -1], ["award", T.collect, -3], ["bigWin", T.big, 0], ["maxBet", T.big, -6],
];
ticks.forEach((t) => sfx.push(["pop", t, -8]));
locks.forEach((l) => sfx.push([l.name === "CHILI" ? "chiliStop" : "gemStop", fgAbs(l.t - 0.05), l.name === "CHILI" ? -2 : -4]));
sfx.push(["nearWin", fgAbs(fgPlan.rounds[2].start), -6]);

const DATA = {
  FPS, DUR, T, meta, wheelExpr, pointerExpr, jpCount, ticks, cabinet: false, seqCal: SEQCAL,
  wheel: { seg: r4(SEG) },
  fg: { pos: FGPOS, dur: r4(DUR - T.fg + 0.5), locks, chili, dias, gems, collect, total: TOTAL, big: { start: B.start, countEnd: B.countEnd, end: B.end } },
  coins: { jp: coinExpr(T.jp, 540, 1000) },
  sfx: sfx.map(([k, t, db]) => ({ k, t: r4(t), db: db - 4 })),
};

// ------------------------------------------------------------------ 產生 build_ad.jsx
const director = fs.readFileSync(path.join(__dirname, "director.jsx"), "utf8");
const BS = String.fromCharCode(92);
const ascii = (s) => s.replace(/[^\x00-\x7f]/g, (c) => BS + "u" + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0"));
const out = [
  "// Spicy Fortunes AD - generated by work/spicyad/make_ad.js (do not edit; edit director.jsx and re-run)",
  "// After Effects: File > Scripts > Run Script File..., pick this file. Builds the whole ad and saves SpicyFortunes_AD.aep here.",
  "var SFS_AD_DATA = " + JSON.stringify(DATA) + ";",
  director,
].join("\n");
fs.writeFileSync(path.join(KIT, "build_ad.jsx"), ascii(out));
console.log("wheel: decel from " + W.d.toFixed(3) + "s, R " + W.Rd.toFixed(1) + " -> " + W.Rf + "; ticks " + ticks.length + " (" + ticks.slice(0, 3).join(",") + " … " + ticks.slice(-3).join(",") + ")");
console.log("FG: " + locks.length + " locks, settled " + fgPlan.allSettled.toFixed(2) + " local (" + fgAbs(fgPlan.allSettled) + " abs); BIG WIN " + TOTAL + " at " + fgAbs(B.start) + "~" + fgAbs(B.end));
console.log("wrote", path.join(KIT, "build_ad.jsx"));
