#!/usr/bin/env node
/*
 * SlotFakeSpin 命令列工具：給 agent / skill 操作設定檔、檢查節奏、出預覽、驅動 AE。
 * 只用 Node 內建模組；預覽圖需要 Python + Pillow；ae 指令需要本機裝有 After Effects。
 *
 * 執行 `node tools/sfs.js help` 看全部指令。
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");
const S = require("../src/core.js");

const ROOT = path.join(__dirname, "..");
const IMAGE_RE = /\.(png|jpe?g|psd|tga|tiff?|gif|bmp|webp)$/i;

const HELP = `SlotFakeSpin CLI

設定檔
  init --symbols <資料夾> [--out preset.json] [--reels 5] [--rows 3] [--cell 200|200x180]
                                  從符號資料夾建立新設定檔（檔名 = 符號名）
  show <preset>                   顯示符號、盤面、節奏、連線
  board <preset> [--start <文字|@檔案>] [--end <文字|@檔案>]
                                  設定盤面：每行一列（由上到下），「/」也可以換行
  symbol <preset> <名稱> [--filler on|off] [--rename 新名稱]
  set <preset> key.path=value ... 改任何設定，例如 spin.stopOrder=5,4,3,2,1 frame.color=#FF3366
  reel <preset> <輪號|all|2,3> key=value ...
                                  逐輪微調，數值前加 +/- 是相對調整（stop=+0.3）（start stop speed decelTime decelCurve overshoot bounceTime
                                  frame frameStart frameSpeed），會關掉自動套用
  regen <preset>                  依快速節奏重新產生各輪

期待感 / 連線
  suggest <preset> [--apply]      依結果盤面 + 停輪順序算出期待輪（--apply 寫入）
  lines <preset> [--detect] [--clear] [--timing] [--add 線型:連數[:顯示]]
                                  例：--add 1,2,3,2,1:5:0.3+1.2；線型裡的 0 = 這輪不框
                                  連數寫 box = 只框格子不畫線（Scatter）：--add 2,0,1,0,2:box

檢查 / 預覽
  check <preset> [--fps 30] [--json]
                                  驗證 + 各輪時間表 + 文字時間軸 + 標記（音效對點）
  render <preset> [--gif out.gif] [--sheet out.png] [--boards out.png] [--fps 30] [--scale 0.5]
                                  預覽（關鍵影格與 AE 相同的 Bezier 計算；需要 Python + Pillow）
  symbols-sheet <preset|資料夾> <out.png>
                                  符號總覽圖（名稱 + 圖），用來對照盤面截圖

After Effects
  ae <preset> [--mode auto|new|update] [--comp 合成名稱] [--board 盤面合成名稱]
              [--frames auto|none|秒,秒] [--out 資料夾] [--timeout 180] [--dry-run]
                                  在執行中的 AE 建立 / 更新盤面，回傳標記時間與檢查畫面
                                  （AE 要勾選 偏好設定 > 指令碼與運算式 > 允許指令碼寫入檔案及存取網路）
                                  找不到 AE 時設定環境變數 SFS_AE（AfterFX.exe 路徑，或 macOS 的 App 名稱）
`;

// ---------------------------------------------------------------- 參數
function parseArgs(argv) {
  const pos = [], opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) opt[k] = true;
      else { opt[k] = next; i++; }
    } else pos.push(a);
  }
  return { pos, opt };
}

function fail(msg) {
  process.stderr.write("錯誤：" + msg + "\n");
  process.exit(1);
}

function load(file) {
  if (!file) fail("請指定設定檔");
  if (!fs.existsSync(file)) fail("找不到設定檔 " + file);
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); } catch (e) { fail("設定檔不是合法 JSON：" + e.message); }
  return S.normalizeConfig(raw);
}

function save(file, cfg) {
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
}

function textArg(v) {
  if (v === undefined || v === true) return null;
  if (String(v).startsWith("@")) return fs.readFileSync(String(v).slice(1), "utf8");
  return String(v).replace(/\s*\/\s*/g, "\n");
}

const r2 = (v) => Math.round(v * 100) / 100;
const pad = (s, n) => { s = String(s); let w = 0; for (const ch of s) w += ch.charCodeAt(0) > 0x2e80 ? 2 : 1; return s + " ".repeat(Math.max(0, n - w)); };
const curveLabel = (k) => S.CURVE_LABELS[S.CURVE_KEYS.indexOf(k)] || k;

// ---------------------------------------------------------------- 指令
function cmdInit(opt) {
  const dir = opt.symbols;
  if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) fail("請用 --symbols 指定符號圖檔資料夾");
  const files = fs.readdirSync(dir).filter((f) => !f.startsWith(".") && IMAGE_RE.test(f)).sort(S.util.naturalCompare);
  if (!files.length) fail("資料夾裡沒有圖檔：" + dir);
  const cfg = S.defaultConfig();
  if (opt.reels) cfg.layout.reels = Number(opt.reels);
  if (opt.rows) cfg.layout.rows = Number(opt.rows);
  if (opt.cell) {
    const m = /^(\d+)(?:x(\d+))?$/.exec(String(opt.cell));
    if (!m) fail("--cell 格式是 200 或 200x180");
    cfg.layout.cellW = Number(m[1]);
    cfg.layout.cellH = Number(m[2] || m[1]);
  }
  const names = [];
  for (const f of files) {
    const name = S.uniqueName(S.util.baseName(f).replace(/[,\t\r\n]/g, "_"), names);
    names.push(name);
    cfg.symbols.push({ name, path: path.resolve(dir, f), itemId: 0, filler: true });
  }
  // 常見名稱自動分類：百搭 / 觸發型不當填充
  const wild = names.filter((n) => /wild|百搭/i.test(n));
  const scat = names.filter((n) => /scatter|bonus|free|分散|免費/i.test(n));
  if (wild.length) cfg.lineSet.wilds = wild.join(",");
  if (scat.length) {
    cfg.lineSet.exclude = scat.join(",");
    cfg.antRule.symbols = scat.join(",");
    cfg.symbols.forEach((s) => { if (scat.indexOf(s.name) >= 0) s.filler = false; });
  }
  const norm = S.normalizeConfig(cfg);
  const rng = new S.Rng(Date.now() % 2147483000 + 1);
  const pool = S.fillerPool(norm);
  norm.startBoard = S.board.randomize(norm.layout.reels, norm.layout.rows, pool, rng);
  norm.endBoard = S.board.randomize(norm.layout.reels, norm.layout.rows, pool, rng);
  const out = opt.out || "preset.json";
  save(out, norm);
  console.log("已建立 " + out + "：" + names.length + " 個符號（" + names.join(", ") + "）");
  if (wild.length) console.log("  百搭：" + wild.join(", "));
  if (scat.length) console.log("  觸發型（不當填充、不算連線）：" + scat.join(", "));
  console.log("  盤面先用亂數填好，請用 board 指令設定起始 / 結果盤面");
}

function boardText(cfg, which) {
  return S.board.toText(which === "start" ? cfg.startBoard : cfg.endBoard, cfg.layout.rows);
}

function cmdShow(file) {
  const cfg = load(file);
  const L = cfg.layout;
  console.log("盤面 " + L.reels + "x" + L.rows + "，格子 " + L.cellW + "x" + L.cellH + "，開始時間 " + cfg.spin.startTime + " 秒");
  console.log("符號：" + cfg.symbols.map((s) => s.name + (s.filler ? "" : "*")).join(" ") + "   （* = 不當填充）");
  console.log("百搭：" + (cfg.lineSet.wilds || "-") + "   不算連線：" + (cfg.lineSet.exclude || "-") + "   觸發：" + cfg.antRule.symbols + "×" + cfg.antRule.count + "   聽牌：" + (cfg.antRule.tease || "-"));
  console.log("\n起始盤面：\n" + boardText(cfg, "start") + "\n\n結果盤面：\n" + boardText(cfg, "end"));
  const P = cfg.spin;
  console.log("\n快速節奏：起轉順序 " + (P.startOrder || "1..n") + " 間隔 " + P.startStagger + "｜停輪順序 " + (P.stopOrder || "1..n") +
    "｜第一次停 " + P.firstStop + " 每次間隔 " + P.stagger + "｜轉速 " + P.speeds + "｜減速 " + P.decelTime + " " + curveLabel(P.decelCurve) +
    "｜期待輪 " + (P.antReels || "-") + " 多轉 " + P.antTime + " 繞框轉速 " + P.antSpeed + "｜自動套用 " + (P.autoRhythm ? "開" : "關"));
  printReels(cfg);
  if (cfg.lines.length) {
    console.log("\n連線：");
    cfg.lines.forEach((l, i) => console.log("  " + (i + 1) + ". 線型 " + l.pattern + (l.boxOnly ? " 只框格子" : " 連 " + l.count) + " 顯示 " + l.shows + (l.color ? " " + l.color : "")));
  }
}

function printReels(cfg) {
  console.log("\n" + pad("輪", 4) + pad("起轉", 7) + pad("停輪", 7) + pad("轉速", 7) + pad("減速", 12) + pad("衝過", 6) + pad("回彈", 6) + "繞框");
  cfg.reels.forEach((R, i) => {
    console.log(pad("R" + (i + 1), 4) + pad(r2(R.start), 7) + pad(r2(R.stop), 7) + pad(R.speed, 7) +
      pad(r2(R.decelTime) + " " + curveLabel(R.decelCurve), 12) + pad(R.overshoot, 6) + pad(R.bounceTime, 6) +
      (R.frame ? "從 " + r2(R.frameStart) + (R.frameSpeed > 0 ? " 轉速 " + R.frameSpeed : "") : "-"));
  });
}

function cmdBoard(file, opt) {
  const cfg = load(file);
  const names = S.symbolNames(cfg), L = cfg.layout;
  for (const which of ["start", "end"]) {
    const t = textArg(opt[which]);
    if (t === null) continue;
    const res = S.board.parseText(t, L.reels, L.rows, names);
    if (res.errors.length) fail((which === "start" ? "起始" : "結果") + "盤面：\n  " + res.errors.join("\n  ") + "\n可用符號：" + names.join(" "));
    cfg[which === "start" ? "startBoard" : "endBoard"] = res.board;
  }
  save(file, cfg);
  console.log("起始盤面：\n" + boardText(cfg, "start") + "\n\n結果盤面：\n" + boardText(cfg, "end"));
}

function cmdSymbol(file, name, opt) {
  const cfg = load(file);
  const e = cfg.symbols.find((s) => s.name === name) || cfg.symbols.find((s) => s.name.toLowerCase() === String(name).toLowerCase());
  if (!e) fail("找不到符號 " + name + "（有：" + S.symbolNames(cfg).join(" ") + "）");
  if (opt.filler !== undefined) e.filler = !/^(off|false|0|no)$/i.test(String(opt.filler));
  if (opt.rename && opt.rename !== true) {
    const nn = String(opt.rename).trim();
    if (S.symbolNames(cfg).indexOf(nn) >= 0) fail("名稱已存在：" + nn);
    const swap = (b) => b.forEach((col) => col.forEach((v, y) => { if (v === e.name) col[y] = nn; }));
    swap(cfg.startBoard); swap(cfg.endBoard);
    const ren = (txt) => S.parseNames(txt).map((x) => (x === e.name ? nn : x)).join(",");
    cfg.lineSet.wilds = ren(cfg.lineSet.wilds); cfg.lineSet.exclude = ren(cfg.lineSet.exclude);
    cfg.antRule.symbols = ren(cfg.antRule.symbols); cfg.antRule.tease = ren(cfg.antRule.tease);
    e.name = nn;
  }
  save(file, cfg);
  console.log(e.name + "：" + (e.filler ? "填充符號" : "不當填充") + "  " + e.path);
}

function setPath(obj, keyPath, value) {
  const keys = keyPath.split(".");
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (o[keys[i]] === undefined || typeof o[keys[i]] !== "object") fail("沒有這個設定：" + keyPath);
    o = o[keys[i]];
  }
  const last = keys[keys.length - 1];
  if (!(last in o)) fail("沒有這個設定：" + keyPath);
  o[last] = value;
}

function cmdSet(file, pairs) {
  let cfg = load(file);
  if (!pairs.length) fail("用法：set <preset> key.path=value ...");
  let touchedSpin = false, touchedSize = false;
  for (const p of pairs) {
    const i = p.indexOf("=");
    if (i < 0) fail("格式是 key.path=value：" + p);
    const k = p.slice(0, i), v = p.slice(i + 1);
    if (/^(symbols|reels|lines|startBoard|endBoard)\b/.test(k)) fail(k + " 請用專用指令（symbol / reel / lines / board）");
    setPath(cfg, k, v);
    if (k.startsWith("spin.")) touchedSpin = true;
    if (k === "layout.reels" || k === "layout.rows") touchedSize = true;
  }
  const before = cfg.layout.reels;
  cfg = S.normalizeConfig(cfg);
  if (touchedSize) {
    const pool = S.fillerPool(cfg), rng = new S.Rng(Date.now() % 2147483000 + 1);
    for (const b of [cfg.startBoard, cfg.endBoard]) b.forEach((col) => col.forEach((v, y) => { if (!v) col[y] = rng.pick(pool); }));
    cfg.reels = S.generateReels(cfg);
    cfg.lines = cfg.lines.filter((l) => S.lines.parsePattern(l.pattern, cfg.layout.reels, cfg.layout.rows, true));
  } else if (touchedSpin && cfg.spin.autoRhythm) {
    cfg.reels = S.generateReels(cfg);
  }
  save(file, cfg);
  console.log("已更新 " + pairs.join(" ") + (touchedSpin && cfg.spin.autoRhythm ? "（已重新產生各輪）" : "") +
    (touchedSize && before !== cfg.layout.reels ? "（盤面尺寸改變，各輪已重新產生、空格已亂數補上）" : ""));
  if (touchedSpin || touchedSize) printReels(cfg);
}

const REEL_KEYS = Object.keys(S.reelDefaults());

function cmdReel(file, which, pairs) {
  const cfg = load(file);
  const n = cfg.layout.reels;
  let idx;
  if (which === "all") idx = cfg.reels.map((_, i) => i);
  else idx = String(which || "").split(",").map((x) => Number(x) - 1);
  if (!idx.length || idx.some((i) => !(i >= 0 && i < n))) fail("輪號要在 1~" + n + "（可用 all 或 2,3）");
  for (const p of pairs) {
    const i = p.indexOf("=");
    const k = p.slice(0, i), v = p.slice(i + 1);
    if (i < 0 || REEL_KEYS.indexOf(k) < 0) fail("各輪欄位只有：" + REEL_KEYS.join(" "));
    idx.forEach((r) => {
      const R = cfg.reels[r];
      if (typeof R[k] === "number") {
        // +0.3 / -0.2 = 相對調整（這些欄位不會是負數，所以不會跟絕對值混淆）
        const num = Number(v);
        if (isNaN(num)) fail(k + " 要是數字：" + v);
        R[k] = /^[+-]/.test(v) ? Math.round((R[k] + num) * 1000) / 1000 : num;
      } else if (typeof R[k] === "boolean") R[k] = /^(on|true|1|yes)$/i.test(v);
      else R[k] = v;
    });
  }
  cfg.spin.autoRhythm = false;
  const norm = S.normalizeConfig(cfg);
  save(file, norm);
  console.log("已微調 R" + idx.map((i) => i + 1).join(",R") + "（快速節奏改為手動套用）");
  printReels(norm);
}

function cmdRegen(file) {
  const cfg = load(file);
  cfg.reels = S.generateReels(cfg);
  cfg.spin.autoRhythm = true;
  save(file, cfg);
  console.log("已依快速節奏重新產生各輪");
  printReels(cfg);
}

function cmdSuggest(file, opt) {
  const cfg = load(file);
  const res = opt.apply ? S.anticipation.apply(cfg) : S.anticipation.suggest(cfg);
  res.reasons.forEach((r) => console.log(r));
  console.log("建議期待輪：" + (res.reels.length ? res.reels.join(",") : "（無）"));
  if (opt.apply) {
    save(file, cfg);
    console.log("已寫入 spin.antReels 並重新產生各輪");
    printReels(cfg);
  }
}

function cmdLines(file, opt) {
  const cfg = load(file);
  const L = cfg.layout;
  if (opt.clear) cfg.lines = [];
  if (opt.detect) {
    const res = S.lines.detect(cfg);
    if (res.errors.length) fail(res.errors.join("\n"));
    cfg.lines = res.lines.map((l) => ({ pattern: l.pattern, count: l.count, shows: "", color: "", boxOnly: !!l.boxOnly }));
    S.lines.applyTiming(cfg.lines, cfg.lineGen);
    res.lines.forEach((l) => console.log(l.scatter ? "偵測到：" + l.symbol + " × " + l.count + "（框格子 " + l.pattern + "）"
      : "偵測到：線 " + l.payline + "（" + l.pattern + "）" + l.symbol + " 連 " + l.count));
    if (!res.lines.length) console.log("結果盤面沒有連線");
  }
  if (opt.add && opt.add !== true) {
    const [pattern, count, shows] = String(opt.add).split(":");
    if (!S.lines.parsePattern(pattern, L.reels, L.rows, true)) fail("線型要有 " + L.reels + " 個 1~" + L.rows + " 的數字（0 = 這輪不框）：" + pattern);
    const boxOnly = /^box$/i.test(count || "");
    cfg.lines.push({ pattern, count: boxOnly ? L.reels : Number(count || L.reels), shows: shows || "", color: "", boxOnly });
    if (!shows) S.lines.applyTiming(cfg.lines, cfg.lineGen);
  }
  if (opt.timing) S.lines.applyTiming(cfg.lines, cfg.lineGen);
  const norm = S.normalizeConfig(cfg);
  save(file, norm);
  norm.lines.forEach((l, i) => console.log("  " + (i + 1) + ". 線型 " + l.pattern + (l.boxOnly ? " 只框格子" : " 連 " + l.count) + " 顯示 " + l.shows));
}

function asciiTimeline(plan, width) {
  const T0 = plan.startTime, T1 = Math.max(plan.endTime, T0 + 0.5) + 0.1;
  const X = (t) => Math.max(0, Math.min(width - 1, Math.round((t - T0) / (T1 - T0) * (width - 1))));
  const rows = [];
  plan.reels.forEach((rp) => {
    const line = Array(width).fill(" ");
    for (let x = X(rp.spinStart); x <= X(rp.decelStart); x++) line[x] = "=";
    for (let x = X(rp.decelStart); x <= X(rp.stopTime); x++) line[x] = "~";
    for (let x = X(rp.stopTime); x <= X(rp.settleTime); x++) line[x] = ".";
    plan.frames.filter((f) => f.reel === rp.index).forEach((f) => {
      for (let x = X(f.start); x <= X(f.end); x++) if (line[x] === "=" || line[x] === " ") line[x] = "*";
    });
    line[X(rp.stopTime)] = "|";
    rows.push(pad("R" + (rp.index + 1), 6) + line.join(""));
  });
  plan.lines.forEach((pl, i) => {
    const line = Array(width).fill(" ");
    pl.shows.forEach((s) => { for (let x = X(s.start); x <= X(s.end); x++) line[x] = String((i + 1) % 10); });
    rows.push(pad("L" + (i + 1), 6) + line.join(""));
  });
  const axis = Array(width).fill("-");
  const labels = Array(width).fill(" ");
  for (let s = 0; T0 + s <= T1; s += 1) {
    const x = X(T0 + s);
    axis[x] = "+";
    String(s).split("").forEach((c, k) => { if (x + k < width) labels[x + k] = c; });
  }
  rows.push(pad("", 6) + axis.join(""));
  rows.push(pad("秒", 6) + labels.join(""));
  return rows.join("\n") + "\n      = 轉動  * 繞框  ~ 減速  | 停輪  . 回彈  數字 = 連線顯示";
}

function cmdCheck(file, opt) {
  const cfg = load(file);
  const fps = Number(opt.fps || cfg.layout.newCompFps || 30);
  const errors = S.validateConfig(cfg);
  const plan = errors.length ? null : S.computePlan(cfg, fps);
  const all = errors.concat(plan ? plan.errors : []);
  if (opt.json) {
    console.log(JSON.stringify({
      ok: !all.length, errors: all, warnings: plan ? plan.warnings : [], fps,
      reels: plan ? plan.reels.map((r) => ({ reel: r.index + 1, start: r.spinStart, stop: r.stopTime, settle: r.settleTime, speed: r2(r.speed / plan.pitch), fill: r.fill })) : [],
      frames: plan ? plan.frames.map((f) => ({ reel: f.reel + 1, start: f.start, end: f.end })) : [],
      lines: plan ? plan.lines.map((l) => ({ line: l.index + 1, shows: l.shows })) : [],
      markers: plan ? plan.markers.map((m) => ({ t: m.t, frame: Math.round(m.t * fps), label: m.label })) : [],
      allSettled: plan ? plan.allSettled : null, endTime: plan ? plan.endTime : null,
    }, null, 2));
    process.exit(all.length ? 1 : 0);
  }
  if (all.length) { console.log("✗ 有問題：\n  " + all.join("\n  ")); process.exit(1); }
  const T0 = plan.startTime;
  console.log("✓ 設定正確（@" + fps + "fps，開始 " + r2(T0) + " 秒；以下時間從開始算）");
  plan.warnings.forEach((w) => console.log("⚠ " + w));
  console.log("\n" + pad("輪", 4) + pad("起轉", 7) + pad("停輪", 7) + pad("停妥", 7) + pad("格數", 6) + pad("實際轉速", 13) + "繞框");
  plan.reels.forEach((rp) => {
    const fr = plan.frames.find((f) => f.reel === rp.index);
    console.log(pad("R" + (rp.index + 1), 4) + pad(r2(rp.spinStart - T0), 7) + pad(r2(rp.stopTime - T0), 7) + pad(r2(rp.settleTime - T0), 7) +
      pad(rp.fill, 6) + pad(r2(rp.speed / plan.pitch) + " 格/秒", 13) + (fr ? r2(fr.start - T0) + " → " + r2(fr.end - T0) : "-"));
  });
  console.log("\n全部停妥 " + r2(plan.allSettled - T0) + " 秒，演出結束 " + r2(plan.endTime - T0) + " 秒");
  console.log("\n" + asciiTimeline(plan, 64));
  console.log("\n標記（目標合成時間，可對音效）：");
  plan.markers.forEach((m) => console.log("  " + pad(r2(m.t).toFixed(2) + "s", 8) + pad("f" + Math.round(m.t * fps), 7) + m.label));
}

// ---------------------------------------------------------------- 預覽
function sceneFor(cfg, fps, shots, outScale) {
  const plan = S.computePlan(cfg, fps);
  if (plan.errors.length) fail(plan.errors.join("\n"));
  const L = cfg.layout, F = cfg.frame, LS = cfg.lineStyle;
  const symbols = {};
  cfg.symbols.forEach((s) => { symbols[s.name] = s.path; });
  const shutter = cfg.spin.motionBlur ? cfg.spin.shutterAngle / 360 / fps : 0;
  const samples = shutter > 0 ? 8 : 1;
  const cy = plan.margin + plan.reelH / 2;
  // 中獎符號跳動（與 AE 相同：0.1 秒放大、0.22 秒縮回）
  const winCells = {};
  plan.lines.forEach((pl) => pl.cells.forEach((c) => {
    const id = c[0] + "_" + c[1];
    (winCells[id] = winCells[id] || { cell: c, shows: [] }).shows.push(...pl.shows);
  }));
  const frames = shots.map(({ t, label }) => {
    const reels = plan.reels.map((rp) => {
      const ys = [];
      for (let s = 0; s < samples; s++) ys.push(S.evalKeys(rp.keys, samples > 1 ? t - shutter / 2 + shutter * (s + 0.5) / samples : t));
      return ys;
    });
    const frameOv = plan.frames.filter((f) => t >= f.start && t <= f.end + F.fade).map((f) => {
      let a = 1;
      if (F.fade > 0) a = Math.min(1, (t - f.start) / F.fade, (f.end + F.fade - t) / F.fade);
      return { cx: f.x, cy, w: L.cellW + 2 * F.pad, h: plan.reelH + 2 * F.pad, color: F.source === "custom" ? "#FFFFFF" : F.color,
        width: F.width, alpha: Math.max(0, a), phase: (t * F.laps) % 1, runner: F.runner / 100 };
    });
    const wins = [];
    if (LS.pulse > 100) {
      Object.values(winCells).forEach((w) => {
        const live = w.shows.filter((s) => t >= s.start && t < s.end);
        if (!live.length) return;
        const st = Math.max(...live.map((s) => s.start));
        const dt = t - st, big = LS.pulse / 100;
        const k = dt < 0.1 ? 1 + (big - 1) * dt / 0.1 : dt < 0.32 ? big - (big - 1) * (dt - 0.1) / 0.22 : 1;
        const c = S.cellCenter(L, w.cell[0], w.cell[1]);
        wins.push({ cx: c[0], cy: c[1], name: cfg.endBoard[w.cell[0]][w.cell[1]], scale: k });
      });
    }
    const lines = plan.lines.filter((pl) => pl.shows.some((s) => t >= s.start && t < s.end)).map((pl) => {
      const s = pl.shows.find((x) => t >= x.start && t < x.end);
      const draw = Math.min(LS.drawTime, (s.end - s.start) / 2);
      return { points: pl.points, boxes: LS.boxes || pl.highlight ? pl.cells.map((c) => S.cellCenter(L, c[0], c[1])) : [], color: S.rgbToHex(pl.color),
        width: LS.width, boxW: LS.boxWidth, cellW: L.cellW, cellH: L.cellH, progress: draw > 0 ? Math.min(1, (t - s.start) / draw) : 1 };
    });
    return { t, label, reels, frames: frameOv, wins, lines };
  });
  return { width: plan.boardW, height: plan.boardH, margin: plan.margin, reelW: L.cellW, reelH: plan.reelH, cellW: L.cellW, cellH: L.cellH,
    pitch: plan.pitch, scaleMode: L.scaleMode, symbolScale: L.symbolScale, symbols, fps, outScale: outScale || 1,
    reels: plan.reels.map((rp) => ({ x: rp.x, strip: rp.strip.map((s) => s.name) })), frames, plan };
}

function keyShots(plan) {
  const shots = [];
  plan.markers.forEach((m) => {
    if (/^LINE /.test(m.label)) return;
    shots.push({ t: m.t, label: m.label });
    if (m.label === "SPIN") {
      const first = Math.min(...plan.reels.map((r) => r.stopTime));
      shots.push({ t: (m.t + first) / 2, label: "SPINNING" });
    }
  });
  plan.lines.forEach((pl, i) => pl.shows.forEach((s, k) => shots.push({ t: (s.start + s.end) / 2, label: "LINE " + (i + 1) + (pl.shows.length > 1 ? " #" + (k + 1) : "") })));
  return shots.sort((a, b) => a.t - b.t);
}

function findPython() {
  for (const exe of ["python3", "python", "py"]) {
    const r = cp.spawnSync(exe, ["-c", "import PIL; print(PIL.__version__)"], { encoding: "utf8" });
    if (r.status === 0) return exe;
  }
  fail("預覽需要 Python 3 + Pillow（pip install pillow）");
}

function runRender(args) {
  const py = findPython();
  const r = cp.spawnSync(py, [path.join(__dirname, "render.py")].concat(args), { encoding: "utf8" });
  if (r.status !== 0) fail("繪製失敗：\n" + r.stdout + r.stderr);
  process.stdout.write(r.stdout);
}

function tmpJson(name, data) {
  const f = path.join(os.tmpdir(), "sfs-" + process.pid + "-" + name + ".json");
  fs.writeFileSync(f, JSON.stringify(data));
  return f;
}

function cmdRender(file, opt) {
  const cfg = load(file);
  const errs = S.validateConfig(cfg);
  if (errs.length) fail(errs.join("\n"));
  const fps = Number(opt.fps || cfg.layout.newCompFps || 30);
  const plan = S.computePlan(cfg, fps);
  const scale = Number(opt.scale || 0.5);
  const base = path.join(path.dirname(path.resolve(file)), path.basename(file, ".json"));
  const wantAny = opt.gif || opt.sheet || opt.boards;
  if (opt.boards || !wantAny) {
    const out = opt.boards && opt.boards !== true ? opt.boards : base + "_boards.png";
    const sc = sceneFor(cfg, fps, [{ t: plan.startTime - 0.001, label: "START" }, { t: plan.allSettled + 0.001, label: "RESULT" }], scale);
    runRender(["scene", tmpJson("boards", sc), "sheet", out, "2"]);
  }
  if (opt.sheet || !wantAny) {
    const out = opt.sheet && opt.sheet !== true ? opt.sheet : base + "_keys.png";
    runRender(["scene", tmpJson("keys", sceneFor(cfg, fps, keyShots(plan), scale)), "sheet", out, "3"]);
  }
  if (opt.gif || !wantAny) {
    const out = opt.gif && opt.gif !== true ? opt.gif : base + ".gif";
    const shots = [];
    for (let f = Math.floor((plan.startTime - 0.3) * fps); f <= Math.ceil((plan.endTime + 0.5) * fps); f++) {
      if (f >= 0) shots.push({ t: f / fps, label: "" });
    }
    runRender(["scene", tmpJson("gif", sceneFor(cfg, fps, shots, opt.scale ? scale : 0.4)), "gif", out]);
  }
}

function cmdSymbolsSheet(src, out) {
  let symbols;
  if (src && fs.existsSync(src) && fs.statSync(src).isDirectory()) {
    symbols = fs.readdirSync(src).filter((f) => IMAGE_RE.test(f)).sort(S.util.naturalCompare)
      .map((f) => ({ name: S.util.baseName(f), path: path.resolve(src, f), filler: true }));
  } else {
    symbols = load(src).symbols;
  }
  if (!out) fail("用法：symbols-sheet <preset|資料夾> <out.png>");
  runRender(["symbols", tmpJson("symbols", { symbols }), out]);
}

// ---------------------------------------------------------------- After Effects
function escapeNonAscii(s) {
  return s.replace(/[^\x00-\x7f]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0"));
}

function findAE() {
  const env = process.env.SFS_AE;
  if (process.platform === "win32") {
    if (env) return { kind: "win", exe: env };
    const bases = [process.env.ProgramFiles || "C:\\Program Files", "C:\\Program Files"];
    for (const base of bases) {
      const adobe = path.join(base, "Adobe");
      if (!fs.existsSync(adobe)) continue;
      const dirs = fs.readdirSync(adobe).filter((d) => /^Adobe After Effects/i.test(d)).sort(S.util.naturalCompare).reverse();
      for (const d of dirs) {
        const exe = path.join(adobe, d, "Support Files", "AfterFX.exe");
        if (fs.existsSync(exe)) return { kind: "win", exe };
      }
    }
    return null;
  }
  if (process.platform === "darwin") {
    if (env) return { kind: "mac", app: env };
    const dirs = fs.existsSync("/Applications") ? fs.readdirSync("/Applications").filter((d) => /^Adobe After Effects/i.test(d)).sort(S.util.naturalCompare).reverse() : [];
    for (const d of dirs) {
      const apps = fs.readdirSync(path.join("/Applications", d)).filter((a) => /^Adobe After Effects.*\.app$/i.test(a));
      if (apps.length) return { kind: "mac", app: apps[0].replace(/\.app$/i, "") };
    }
    return null;
  }
  return env ? { kind: "unknown", exe: env } : null;
}

function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

function cmdAE(file, opt) {
  const cfg = load(file);
  const errs = S.validateConfig(cfg);
  if (errs.length) fail("設定有問題，先修正再送進 AE：\n  " + errs.join("\n  "));
  const applyJsx = path.join(ROOT, "dist", "SlotFakeSpin_apply.jsx");
  if (!fs.existsSync(applyJsx)) fail("找不到 " + applyJsx + "，請先 npm run build");
  const outDir = path.resolve(opt.out && opt.out !== true ? opt.out : path.join(path.dirname(path.resolve(file)), ".sfs-run", new Date().toISOString().replace(/[:.]/g, "-")));
  fs.mkdirSync(outDir, { recursive: true });
  const resultFile = path.join(outDir, "result.json");
  if (fs.existsSync(resultFile)) fs.unlinkSync(resultFile);
  let frames = opt.frames === undefined || opt.frames === true ? "auto" : String(opt.frames);
  if (frames !== "auto" && frames !== "none") frames = frames.split(",").map(Number).filter((x) => !isNaN(x));
  const job = {
    preset: path.resolve(file), mode: opt.mode && opt.mode !== true ? String(opt.mode) : "auto",
    comp: opt.comp && opt.comp !== true ? String(opt.comp) : "", board: opt.board && opt.board !== true ? String(opt.board) : "",
    result: resultFile, frames, framesDir: path.join(outDir, "frames"),
  };
  const launcher = path.join(outDir, "launch.jsx");
  fs.writeFileSync(launcher, escapeNonAscii(
    "// SlotFakeSpin launcher (generated by tools/sfs.js)\n" +
    "$.global.SFS_APPLY = " + JSON.stringify(job, null, 2) + ";\n" +
    "$.evalFile(new File(" + JSON.stringify(applyJsx) + "));\n"));
  const ae = findAE();
  let cmd;
  if (ae && ae.kind === "win") cmd = [ae.exe, ["-r", launcher]];
  else if (ae && ae.kind === "mac") cmd = ["osascript", ["-e", "tell application \"" + ae.app + "\" to DoScriptFile \"" + launcher + "\""]];
  if (opt["dry-run"]) {
    console.log("啟動腳本：" + launcher);
    console.log(cmd ? "指令：" + [cmd[0]].concat(cmd[1]).map((x) => (/\s/.test(x) ? JSON.stringify(x) : x)).join(" ") : "找不到 After Effects（可設定環境變數 SFS_AE）");
    return;
  }
  if (!cmd) fail("找不到 After Effects。Windows 設定 SFS_AE=AfterFX.exe 的完整路徑；macOS 設定 SFS_AE=App 名稱（例如 \"Adobe After Effects 2025\"）");
  console.log("送進 AE：" + (ae.exe || ae.app));
  const child = cp.spawn(cmd[0], cmd[1], { detached: ae.kind === "win", stdio: "ignore" });
  child.on("error", (e) => fail("無法啟動 AE：" + e.message));
  if (ae.kind === "win") child.unref();
  const timeout = Number(opt.timeout || 180) * 1000;
  const t0 = Date.now();
  while (!fs.existsSync(resultFile)) {
    if (Date.now() - t0 > timeout) {
      fail("等不到 AE 回應（" + timeout / 1000 + " 秒）。請確認 AE 已開啟專案、沒有對話框卡住，並勾選「允許指令碼寫入檔案及存取網路」。\n啟動腳本：" + launcher);
    }
    sleep(500);
  }
  sleep(300);
  const res = JSON.parse(fs.readFileSync(resultFile, "utf8").replace(/^\uFEFF/, ""));
  if (!res.ok) { console.log("✗ AE 回報錯誤：\n  " + res.errors.join("\n  ")); process.exit(1); }
  console.log("✓ " + (res.mode === "update" ? "已更新" : "已建立") + " " + res.board + "（合成 " + res.target + "）");
  res.warnings.forEach((w) => console.log("⚠ " + w));
  console.log("全部停妥 " + r2(res.allSettled) + " 秒，演出結束 " + r2(res.endTime) + " 秒");
  console.log("標記：");
  res.markers.forEach((m) => console.log("  " + pad(r2(m.t).toFixed(2) + "s", 8) + pad("f" + m.frame, 7) + m.label));
  if (res.frames.length) {
    // saveFrameToPng 可能是非同步的：等檔案出現
    const t1 = Date.now();
    while (res.frames.some((f) => f.file && !fs.existsSync(f.file)) && Date.now() - t1 < 30000) sleep(300);
    console.log("檢查畫面（AE 實際算圖）：");
    res.frames.forEach((f) => console.log("  " + pad(r2(f.t).toFixed(2) + "s", 8) + pad(f.label, 22) + (f.file || f.error)));
  }
  console.log("結果：" + resultFile);
}

// ---------------------------------------------------------------- main
function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, opt } = parseArgs(rest);
  switch (cmd) {
    case "init": return cmdInit(opt);
    case "show": return cmdShow(pos[0]);
    case "board": return cmdBoard(pos[0], opt);
    case "symbol": return cmdSymbol(pos[0], pos[1], opt);
    case "set": return cmdSet(pos[0], pos.slice(1));
    case "reel": return cmdReel(pos[0], pos[1], pos.slice(2));
    case "regen": return cmdRegen(pos[0]);
    case "suggest": return cmdSuggest(pos[0], opt);
    case "lines": return cmdLines(pos[0], opt);
    case "check": return cmdCheck(pos[0], opt);
    case "render": return cmdRender(pos[0], opt);
    case "symbols-sheet": return cmdSymbolsSheet(pos[0], pos[1]);
    case "ae": return cmdAE(pos[0], opt);
    case undefined: case "help": case "-h": case "--help": process.stdout.write(HELP); return;
    default: fail("不認得的指令 " + cmd + "\n\n" + HELP);
  }
}

if (require.main === module) main();
module.exports = { sceneFor, keyShots, asciiTimeline };
