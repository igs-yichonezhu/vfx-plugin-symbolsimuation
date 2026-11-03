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
  gemFly: [0.5, 1.3],       // MG：轉輪上的寶石飛進同色的碗（競品開頭）
  celebrate: 1.4,           // 辣椒人跳一下、火花
  reveal: [2.4, 3.2],       // 轉盤畫面：轉輪區淡出、火焰升起、紅藍碗淡出、綠碗移到右下、辣椒人讓開
  spinPress: 4.4,           // 按 SPIN
  spinStart: 4.6,
  windEnd: 4.85,
  accelEnd: 5.25,
  stop: 9.8,                // 停在 +3（差一點就到 MINOR）
  plus: 10.0,               // +3 字卡
  trans: 11.3,              // 綠鑽衝向鏡頭（競品是綠色閃光）
  flash: 11.7,
  fg: 11.7,                 // FG_SCENE 起點（EXTRA ROWS）
  fire: 20.25,
  ignite: 20.9,
  collect: 22.5,
  big: 23.6,                // BIG WIN 6,660
  end: DUR,
};

// ------------------------------------------------------------------ 轉盤：轉動曲線
// 轉輪1（MG 內嵌那份）13 格、每格 27.69°，格線在 6.1° + 27.69°k（畫面角度，0 = 右、順時針）。
// 指針在正上方（270°）。順時針轉 R 度後，原本在 φ 的格子到 φ + R。左邊的 MINOR 中心 186.1° → R ≡ 83.9 到指針；
// 接著來的是 GRAND（158.4°）。停在 R ≡ 91：MINOR 在選擇框裡（偏 7°），GRAND 差 7° 就到（差一點就中 GRAND）
const SEG = 360 / 13, PEG = 270 - 6.1;
const W = { V: 900, wind: -10, p: 3.2 };
W.Rf = 56.25 + 360 * 6;   // +3 中心 213.8° → R ≡ 56.2；停在 +7°，接著來的是 MINOR
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
// 免費遊戲盤面照競品（不是 FG.psd 的排法）：R = 紅辣椒格、G = 綠色格、Y = 金色格、. = 空
// 第幾回合落下（1~4）寫在後面；格子位置用 SlotFakeSpin 的格子（和 FG 背景的格線對齊）
const CHILI_OFF = [-5, -7.5];
const FG_MAP = [
  ".  G1 G3 R2 Y2",
  "G2 .  Y2 Y3 G1",
  "G1 G3 G2 G4 G3",
  ".  .  Y2 G4 Y2",
  ".  R3 .  G2 G4",
  "G4 .  .  R4 G3",
];
// 寶石：第 1 回合落在這幾格，第 2 回合開始時 UPGRADE 變成金格（競品的藍白火焰寶石）
const GEM_AT = [[3, 4], [3, 2], [1, 2]];
const ROUND_T = [0.8, 2.75, 4.7, 6.65], ROUND_LEN = 1.5;
const locks = [], gemsLand = [];
FG_MAP.forEach((line, r) => line.trim().split(/ +/).forEach((tok, c) => {
  if (tok === ".") return;
  const cell = fgPlan.cells.find((x) => x.row === r && x.col === c), pos = toFG(cell.x, cell.y), kind = tok[0], rd = Number(tok[1]) - 1;
  if (kind === "R") { pos[0] = r4(pos[0] + CHILI_OFF[0]); pos[1] = r4(pos[1] + CHILI_OFF[1]); }
  const fromGem = kind === "Y" && GEM_AT.some(([gr, gc]) => gr === r && gc === c);
  locks.push({ name: kind === "R" ? "CHILI" : kind === "G" ? "GREEN" : "GOLD", tile: kind, round: fromGem ? 1 : rd, row: r, col: c, pos, fromGem });
  if (fromGem) gemsLand.push({ row: r, col: c, pos: toFG(cell.x, cell.y) });
}));
[0, 1, 2, 3].forEach((rd) => {
  const list = locks.filter((l) => l.round === rd && !l.fromGem).sort((p, q) => p.col - q.col || p.row - q.row);
  list.forEach((l, j) => { l.t = r4(snap(ROUND_T[rd] + 0.6 + j * (ROUND_LEN - 0.6) / Math.max(1, list.length - 1))); });
});
gemsLand.forEach((g, j) => { g.t = r4(snap(ROUND_T[0] + 0.7 + j * 0.35)); g.upgrade = r4(snap(ROUND_T[1] + 0.2 + j * 0.15)); });
locks.forEach((l) => { if (l.fromGem) l.t = gemsLand.find((g) => g.row === l.row && g.col === l.col).upgrade; });
locks.sort((p, q) => p.t - q.t);
const SEQCAL = { chiliOpen: { scale: 126.5, dx: 0, dy: -27 }, chiliLoop: { scale: 127, dx: 0, dy: -29 }, plate: { scale: 136, dx: 2, dy: -13 } };
// 數值（競品）：綠格噴火後就出數值；金格、紅辣椒格收分時才翻出來。總和 = BIG WIN 6,660
const VAL = { G: [50, 150, 60, 60, 60, 80, 60, 60, 100, 150, 200, 200, 50, 80], Y: [250, 250, 250, 250, 250], R: [800, 750, 2500] };
const used = { R: 0, Y: 0, G: 0 };
const order = locks.slice().sort((p, q) => p.row - q.row || p.col - q.col);
order.forEach((l) => {
  l.value = VAL[l.tile][used[l.tile]++ % VAL[l.tile].length];
  l.ignite = r4(snap(T.ignite - T.fg + l.row * 0.08 + l.col * 0.03));
});
const collect = order.map((l, i) => ({ pos: l.pos, t: r4(snap(T.collect - T.fg + i * 0.04)) }));
order.forEach((l, i) => { if (l.tile !== "G") l.ignite = collect[i].t; });
const chili = locks.filter((l) => l.name === "CHILI"), dias = [], gems = locks.filter((l) => l.name !== "CHILI");
const TOTAL = locks.reduce((n, l) => n + l.value, 0);
const plusPops = ROUND_T.map((t, i) => ({ t, text: "+" + [3, 2, 2, 1][i] }));

// BIG WIN 用 SlotFakeSpin 報獎：設定寫回 fg.json（FG 本地 big = T.big - T.fg）
const bigLocal = T.big - T.fg;
Object.assign(fgCfg.win, {
  amount: TOTAL, bet: 100, tiers: "BIG WIN@1", delay: r4(bigLocal - fgPlan.allSettled), bigDelay: 0, tierTime: 3.4, hold: 2.8,
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
const jpCount = "";
const coinExpr = (t0, x, y) => S.win.coinExpr({ t0, life: 1.5, stagger: 0.8, x, y, vx: 520, vy0: 1500, vy1: 2300, g: 3600 });

// ------------------------------------------------------------------ 音效（成品時間）
const fgAbs = (t) => r4(t + T.fg);
const sfx = [
  ["button", T.spinPress, 0], ["wheelSpin", T.spinStart + 0.1, -3], ["wheelStop", T.stop - 0.05, 0],
  ["pop", T.gemFly[0] + 0.6, -6], ["flame", T.celebrate, -4], ["unlock", T.plus, 0], ["maxBet", T.trans, -2], ["flame", T.flash - 0.15, -2],
  ["fireball", T.fire, 0], ["flame", T.ignite, -1], ["award", T.collect, -3], ["bigWin", T.big, 0], ["maxBet", T.big, -6],
];
ticks.forEach((t) => sfx.push(["pop", t, -8]));
locks.forEach((l) => sfx.push([l.name === "CHILI" ? "chiliStop" : "gemStop", fgAbs(l.t - 0.05), l.name === "CHILI" ? -2 : -6]));
plusPops.forEach((p) => sfx.push(["unlock", fgAbs(p.t), -6]));
// v3 補上的音效：JP 環繞（轉盤快停）、NearWin（最後一回合）、配樂換成墨西哥戲劇版
sfx.push(["jpAround", T.stop - 2.2, -6], ["nearWin", fgAbs(6.65), -6]);

const DATA = {
  FPS, DUR, T, meta, wheelExpr, pointerExpr, jpCount, ticks, cabinet: false, seqCal: SEQCAL, jpCard: false, plusText: "+3",
  wheel: { seg: r4(SEG) },
  fg: { bg: "assets/fg/bg_dim.jpg", pos: FGPOS, dur: r4(DUR - T.fg + 0.5), locks, chili, dias, gems, collect, plusPops, gemsLand, total: TOTAL, big: { start: B.start, countEnd: B.countEnd, end: B.end } },
  coins: { jp: coinExpr(T.plus, 540, 1000) },
  sfx: sfx.map(([k, t, db]) => ({ k, t: r4(t), db: db - 4 })),
};

// ------------------------------------------------------------------ 產生 build_ad.jsx
const director = fs.readFileSync(path.join(__dirname, "director.jsx"), "utf8");
const BS = String.fromCharCode(92);
const ascii = (s) => s.replace(/[^\x00-\x7f]/g, (c) => BS + "u" + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0"));
const out = [
  "// Spicy Fortunes AD (EXTRA ROWS) - generated by make_ad.js (do not edit; edit director.jsx and re-run)",
  "// After Effects: File > Scripts > Run Script File..., pick this file. Builds the whole ad and saves SpicyFortunes_AD.aep here.",
  "var SFS_AD_DATA = " + JSON.stringify(DATA) + ";",
  director,
].join("\n");
fs.writeFileSync(path.join(KIT, "build_ad.jsx"), ascii(out));
console.log("wheel: decel from " + W.d.toFixed(3) + "s, R " + W.Rd.toFixed(1) + " -> " + W.Rf + "; ticks " + ticks.length + " (" + ticks.slice(0, 3).join(",") + " … " + ticks.slice(-3).join(",") + ")");
console.log("FG: " + locks.length + " locks, settled " + fgPlan.allSettled.toFixed(2) + " local (" + fgAbs(fgPlan.allSettled) + " abs); BIG WIN " + TOTAL + " at " + fgAbs(B.start) + "~" + fgAbs(B.end));
console.log("wrote", path.join(KIT, "build_ad.jsx"));
