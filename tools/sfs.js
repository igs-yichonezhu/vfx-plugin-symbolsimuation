#!/usr/bin/env node
/*
 * SlotFakeSpin 命令列工具：給 agent / skill 操作設定檔、檢查節奏、出預覽、驅動 AE。
 * 只用 Node 內建模組；預覽圖需要 Python + Pillow；ae 指令需要本機裝有 After Effects；ec 指令需要 EffectCraft（tools/ec.js）。
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
  from-psd <檔案.psd> [--out preset.json] [--group SYMBOLS] [--reel-layer 轉輪] [--frame-layer 轉輪框]
           [--names 塔可=TACO,粉鑽=PINK|對照.json] [--triggers PINK,BLUE] [--wilds CHILI]
           [--reels N] [--rows N] [--cell 200x200] [--gap 4x0] [--bg bg.png] [--no-bg] [--fit-oversize]
                                  從遊戲畫面 PSD 建立設定檔：符號群組拆成 PNG、讀結果盤面、量格子與盤面位置、
                                  輸出拿掉符號的背景圖（需要 Python + Pillow + psd-tools）
  show <preset>                   顯示符號、盤面、節奏、連線
  board <preset> [--start <文字|@檔案>] [--end <文字|@檔案>]
                                  設定盤面：每行一列（由上到下），「/」也可以換行
  symbol <preset> <名稱> [--filler on|off] [--rename 新名稱] [--scale %]
                                  --scale = 這個符號額外縮放（比格子大的符號會被轉輪裁切時用）
  set <preset> key.path=value ... 改任何設定，例如 spin.stopOrder=5,4,3,2,1 frame.color=#FF3366
                                  layout.position=540,1434 = 盤面中心放在合成的這個位置（空白 = 置中）
  reel <preset> <輪號|all|2,3> key=value ...
                                  逐輪微調，數值前加 +/- 是相對調整（stop=+0.3）（start stop speed decelTime decelCurve overshoot bounceTime
                                  frame frameStart frameSpeed），會關掉自動套用
  regen <preset>                  依快速節奏重新產生各輪

Hold & Spin 重轉（每格各自轉、落下就鎖住、多回合；Link 系列）
  hs-init <preset> --blank <空格符號> [--grid 3x2] [--cell 200|200x180] [--gap 20|20x10] [--spins 3] [--start-spins 3]
  hs-init --symbols <資料夾> --out preset.json --blank <空格符號> [同上]
                                  把設定檔改成 Hold & Spin（--grid = 欄x列），起始盤面全部是空格
  hs-board <preset> [--start <盤面>] [--rounds <回合…|@檔案>] [--add <回合>] [--clear]
                                  盤面一行寫完：由上到下逐列、列之間用 /，- = 空格，例如「- - 200 / - - MINI」
                                  回合：每行一回合（命令列用 ; 分隔），開頭可加「@秒」= 這回合起轉時間（從 spin.startTime 算）
                                    例：--rounds "@3 - 200 - / 800 - -; @6.7 800 - - / - - -; - - - / - - -"
                                  鎖住的格子寫 - 或同一個符號；印出每回合轉幾格、鎖住哪些、剩餘次數、最後盤面
  節奏用 set：hs.speed hs.firstStop hs.stagger hs.order=col|row|all hs.roundGap hs.antCells hs.antFrame hs.lockPulse
             （拉回 / 加速 / 減速 / 衝過 / 回彈 / 期待多轉 spin.antTime 沿用 spin）

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
  ae <preset> [--mode auto|new|update] [--comp 合成名稱] [--board 盤面合成名稱] [--position x,y|center]
              [--frames auto|none|秒,秒] [--out 資料夾] [--timeout 180] [--dry-run]
                                  在執行中的 AE 建立 / 更新盤面，回傳標記時間與檢查畫面
                                  盤面放在 layout.position（--position 可臨時改；center = 置中 / 更新時不動）
                                  （AE 要勾選 偏好設定 > 指令碼與運算式 > 允許指令碼寫入檔案及存取網路）
                                  找不到 AE 時設定環境變數 SFS_AE（AfterFX.exe 路徑，或 macOS 的 App 名稱）

EffectCraft（沒有 AE 時預覽）
  ec <preset> --project <專案.ecproj> [--comp 合成名稱] [--mode auto|new|update] [--board 盤面合成名稱]
              [--pos x,y] [--frames auto|none|秒,秒] [--render out.mp4] [--range 開始秒,結束秒]
              [--save-as 另存.ecproj] [--copy-assets] [--out 資料夾] [--timeout 300] [--dry-run]
                                  用 EffectCraft 建立 / 更新盤面並存檔，回傳標記、算出檢查畫面（與影片）
                                  專案不存在時建立新專案；素材要在專案資料夾內（--copy-assets 自動複製進去）
                                  找不到 EffectCraft 時設定環境變數 SFS_EC（effectcraft-cli 的完整路徑）
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
  const cfg = S.normalizeConfig(raw);
  // 相對路徑以設定檔所在資料夾為基準
  const base = path.dirname(path.resolve(file));
  cfg.symbols.forEach((s) => { if (s.path && !path.isAbsolute(s.path)) s.path = path.resolve(base, s.path); });
  ["frame.path", "lineStyle.cellPath"].forEach((k) => {
    const [g, f] = k.split(".");
    if (cfg[g][f] && !path.isAbsolute(cfg[g][f])) cfg[g][f] = path.resolve(base, cfg[g][f]);
  });
  return cfg;
}

// 存檔時，在設定檔資料夾底下的素材寫成相對路徑（整個資料夾搬到別台電腦也能用）
function save(file, cfg) {
  const base = path.dirname(path.resolve(file));
  const rel = (p) => {
    if (!p || !path.isAbsolute(p)) return p;
    const r = path.relative(base, p);
    return r && !r.startsWith("..") && !path.isAbsolute(r) ? r.split(path.sep).join("/") : p;
  };
  const out = JSON.parse(JSON.stringify(cfg));
  out.symbols.forEach((s) => { s.path = rel(s.path); });
  out.frame.path = rel(out.frame.path);
  out.lineStyle.cellPath = rel(out.lineStyle.cellPath);
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
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
  const { wild, scat } = classifySymbols(cfg);
  const norm = S.normalizeConfig(cfg);
  const rng = new S.Rng(Date.now() % 2147483000 + 1);
  norm.startBoard = S.board.randomQuiet(norm, rng).board;
  norm.endBoard = S.board.randomize(norm.layout.reels, norm.layout.rows, S.fillerPool(norm), rng);
  const out = opt.out || "preset.json";
  save(out, norm);
  console.log("已建立 " + out + "：" + names.length + " 個符號（" + names.join(", ") + "）");
  if (wild.length) console.log("  百搭：" + wild.join(", "));
  if (scat.length) console.log("  觸發型（不當填充、不算連線）：" + scat.join(", "));
  console.log("  盤面先用亂數填好，請用 board 指令設定起始 / 結果盤面");
}

// 常見名稱自動分類：百搭 / 觸發型（觸發型不當填充、不算連線）
function classifySymbols(cfg) {
  const names = S.symbolNames(cfg);
  const wild = names.filter((n) => /wild|百搭/i.test(n));
  const scat = names.filter((n) => /scatter|bonus|free|分散|免費/i.test(n));
  if (wild.length) cfg.lineSet.wilds = wild.join(",");
  if (scat.length) {
    cfg.lineSet.exclude = scat.join(",");
    cfg.antRule.symbols = scat.join(",");
    cfg.symbols.forEach((s) => { if (scat.indexOf(s.name) >= 0) s.filler = false; });
  }
  return { wild, scat };
}

function findPsdPython() {
  for (const exe of ["python3", "python", "py"]) {
    const r = cp.spawnSync(exe, [path.join(__dirname, "psd.py"), "check"], { encoding: "utf8" });
    if (r.status === 0) return exe;
    if (r.status === 1 && /psd-tools/.test(r.stderr || "")) fail(r.stderr.trim());
  }
  fail("讀 PSD 需要 Python 3 + Pillow + psd-tools：pip install pillow psd-tools");
}

function cmdFromPsd(file, opt) {
  if (!file || !fs.existsSync(file)) fail("用法：from-psd <檔案.psd> --out work/<案子>/preset.json" + (file ? "（找不到 " + file + "）" : ""));
  const out = path.resolve(opt.out && opt.out !== true ? String(opt.out) : "preset.json");
  const outDir = path.dirname(out);
  fs.mkdirSync(outDir, { recursive: true });
  const args = [path.join(__dirname, "psd.py"), "read", path.resolve(file), outDir];
  for (const k of ["group", "reel-layer", "frame-layer", "reels", "rows", "cell", "gap"]) {
    if (opt[k] !== undefined && opt[k] !== true) args.push("--" + k, String(opt[k]));
  }
  if (opt.names && opt.names !== true) args.push("--names", fs.existsSync(String(opt.names)) ? path.resolve(String(opt.names)) : String(opt.names));
  if (opt["symbols-dir"] && opt["symbols-dir"] !== true) args.push("--symbols-dir", path.resolve(String(opt["symbols-dir"])));
  if (opt["no-bg"]) args.push("--bg", "none");
  else if (opt.bg && opt.bg !== true) args.push("--bg", path.resolve(String(opt.bg)));
  const py = findPsdPython();
  const r = cp.spawnSync(py, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: Object.assign({}, process.env, { PYTHONIOENCODING: "utf-8" }) });
  if (r.status !== 0) fail("讀 PSD 失敗：\n" + (r.stderr || r.stdout).trim());
  let res;
  try { res = JSON.parse(r.stdout); } catch (e) { fail("psd.py 輸出看不懂：" + e.message + "\n" + r.stdout.slice(0, 500)); }

  const g = res.grid;
  const cfg = S.defaultConfig();
  Object.assign(cfg.layout, { reels: g.reels, rows: g.rows, cellW: g.cellW, cellH: g.cellH, gapX: g.gapX, gapY: g.gapY,
    scaleMode: "none", symbolScale: 100, position: g.position });
  const syms = res.symbols.slice().sort((a, b) => S.util.naturalCompare(a.name, b.name));
  cfg.symbols = syms.map((s) => ({ name: s.name, path: s.file, itemId: 0, filler: true, scale: 100 }));
  let { wild, scat } = classifySymbols(cfg);
  // 先指定觸發 / 百搭：起始盤面就不會放觸發符號，也不會因為百搭出現連線
  const known = S.symbolNames(cfg);
  const pick = (k) => {
    if (!opt[k] || opt[k] === true) return null;
    const list = S.parseNames(String(opt[k])).map((n) => S.board.matchName(n, known) || fail("--" + k + " 的「" + n + "」不是符號（有：" + known.join(" ") + "）"));
    return list.filter((n, i) => list.indexOf(n) === i);
  };
  const trig = pick("triggers"), wl = pick("wilds");
  if (wl) { wild = wl; cfg.lineSet.wilds = wl.join(","); }
  if (trig) {
    scat = trig;
    cfg.antRule.symbols = cfg.lineSet.exclude = trig.join(",");
    cfg.symbols.forEach((s) => { s.filler = trig.indexOf(s.name) < 0; });
  }
  const rng = new S.Rng(Date.now() % 2147483000 + 1);
  const empty = [];
  cfg.endBoard = res.board.map((col, r) => col.map((v, y) => {
    if (v) return v;
    empty.push("第 " + (r + 1) + " 輪第 " + (y + 1) + " 列");
    return rng.pick(S.fillerPool(cfg));
  }));
  const oversize = [];
  syms.forEach((s) => {
    if (s.width <= g.cellW && s.height <= g.cellH) return;
    const fit = Math.floor(Math.min(g.cellW / s.width, g.cellH / s.height) * 100);
    oversize.push({ s, fit });
    if (opt["fit-oversize"]) cfg.symbols.find((e) => e.name === s.name).scale = fit;
  });
  const norm = S.normalizeConfig(cfg);
  const quiet = S.board.randomQuiet(norm, rng);
  norm.startBoard = quiet.board;
  save(out, norm);

  if (!syms.length) fail("符號群組「" + res.group + "」裡沒有圖");
  const rel = (p) => { const x = path.relative(outDir, p); return x && !x.startsWith("..") && !path.isAbsolute(x) ? x.split(path.sep).join("/") : p; };
  const outRel = path.relative(process.cwd(), out) || out;
  const label = (s) => s.name + (s.label !== s.name ? "(" + s.label + ")" : "") + (s.visible ? "" : "[隱藏]");
  const indent = (t) => t.split("\n").map((l) => "    " + l).join("\n");
  console.log("已建立 " + path.relative(process.cwd(), out) + "（" + path.basename(res.file) + " " + res.width + "×" + res.height + "，符號群組「" + res.group + "」）");
  console.log("  符號 " + syms.length + " 個 → " + rel(path.dirname(syms[0].file)) + "/：" + syms.map(label).join(" "));
  if (wild.length) console.log("  百搭：" + wild.join(", "));
  if (scat.length) console.log("  觸發型（不當填充、不算連線）：" + scat.join(", "));
  console.log("  格子：" + g.reels + " 輪 × " + g.rows + " 列，格子 " + g.cellW + "×" + g.cellH + "，輪距 " + g.gapX + "、列距 " + g.gapY +
    (g.source ? "（量轉輪窗「" + g.source + "」）" : ""));
  g.notes.forEach((n) => console.log("    " + n));
  console.log("  位置：格線左上 (" + g.left + ", " + g.top + ")，盤面中心 (" + g.position.join(", ") + ") → layout.position（AE 建立 / 更新時放到這裡）");
  console.log("  結果盤面（PSD）：\n" + indent(boardText(norm, "end")));
  res.covered.forEach((c) => console.log("  被蓋住、沒算進盤面：" + c.layer + "（第 " + c.reel + " 輪第 " + c.row + " 列，被「" + c.by + "」蓋住）"));
  console.log("  起始盤面（亂數" + (quiet.quiet ? "，沒有觸發符號、沒有連線" : "；找不到沒有連線的組合，請用 board --start 設定") + "）：\n" + indent(boardText(norm, "start")));
  if (res.background) console.log("  背景（拿掉符號群組）：" + rel(res.background) + "（放在 AE 主合成最底層，" + res.width + "×" + res.height + "）");
  res.notes.forEach((n) => console.log("  說明：" + n));
  res.warnings.forEach((w) => console.log("⚠ " + w));
  if (empty.length) console.log("⚠ 這些格子在 PSD 裡沒有符號，先用亂數補上，請用 board --end 設定：" + empty.join("、"));
  oversize.forEach(({ s, fit }) => console.log("⚠ " + s.name + " " + s.width + "×" + s.height + " 比格子 " + g.cellW + "×" + g.cellH +
    " 大，在轉輪合成裡會被裁切" + (opt["fit-oversize"] ? "：已設定縮放 " + fit + "%" :
    "：可縮小 node tools/sfs.js symbol " + outRel + " " + s.name + " --scale " + fit + "（或 from-psd 加 --fit-oversize）")));
  const nonAscii = syms.filter((s) => /[^\x20-\x7e]/.test(s.name));
  if (nonAscii.length) {
    console.log("提示：中文符號名稱可以改成短的英數字（盤面文字比較好打），例如：\n    node tools/sfs.js symbol " + outRel + " " + nonAscii[0].name + " --rename 新名稱" +
      "\n  或重新執行並加上 --names \"" + nonAscii.map((s) => s.name + "=").join(",") + "\"（也可以給 JSON 檔 {\"" + nonAscii[0].name + "\": \"...\"}）");
  }
  console.log("下一步：show 確認" + (trig ? "" : " → 設定觸發 / 百搭（重跑 from-psd 加 --triggers / --wilds，或 set antRule.symbols=… lineSet.exclude=… lineSet.wilds=…）") +
    " → lines --detect → suggest --apply → check → render");
}

function boardText(cfg, which) {
  return S.board.toText(which === "start" ? cfg.startBoard : cfg.endBoard, cfg.layout.rows);
}

// ---------------------------------------------------------------- Hold & Spin
const isHS = (cfg) => cfg.mode === "holdspin";
const indent = (t) => t.split("\n").map((l) => "  " + l).join("\n");

// 只有轉輪模式才有的指令
function reelsOnly(cfg, cmd) {
  if (isHS(cfg)) fail(cmd + " 只用在轉輪模式。Hold & Spin 用 hs-board 設定回合、set hs.* 調節奏（set mode=reels 可改回轉輪）");
}

function parseSize(v, label) {
  const m = /^(\d+)(?:\s*[x×]\s*(\d+))?$/i.exec(String(v));
  if (!m) fail(label + " 格式是 200 或 200x180");
  return [Number(m[1]), Number(m[2] || m[1])];
}

function symbolsFromDir(dir) {
  if (!dir || dir === true || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) fail("請用 --symbols 指定符號圖檔資料夾");
  const files = fs.readdirSync(dir).filter((f) => !f.startsWith(".") && IMAGE_RE.test(f)).sort(S.util.naturalCompare);
  if (!files.length) fail("資料夾裡沒有圖檔：" + dir);
  const names = [];
  return files.map((f) => {
    const name = S.uniqueName(S.util.baseName(f).replace(/[,\t\r\n\/|;]/g, "_"), names);
    names.push(name);
    return { name, path: path.resolve(dir, f), itemId: 0, filler: true };
  });
}

// 空格顯示成 -：[欄][列] 裡的空格符號換成 ""
const dashBlank = (board, blank) => board.map((col) => col.map((v) => (v === blank ? "" : v)));

function cmdHsInit(file, opt) {
  let cfg, out;
  if (opt.symbols) {
    cfg = S.defaultConfig();
    cfg.symbols = symbolsFromDir(opt.symbols);
    out = opt.out && opt.out !== true ? String(opt.out) : "preset.json";
  } else {
    if (!file) fail("用法：hs-init <preset> --blank <空格符號>，或 hs-init --symbols <資料夾> --out preset.json --blank <空格符號>");
    cfg = load(file);
    out = file;
  }
  const names = S.symbolNames(cfg), L = cfg.layout, H = cfg.hs;
  let blank = null;
  if (opt.blank && opt.blank !== true) {
    blank = S.board.matchName(String(opt.blank), names);
    if (!blank) fail("--blank 的「" + opt.blank + "」不是符號（有：" + names.join(" ") + "）");
  } else {
    blank = names.indexOf(H.blank) >= 0 ? H.blank : names.find((n) => /blank|empty|空/i.test(n)) || null;
    if (!blank) fail("請用 --blank 指定空格符號（空格圖案的符號名稱；有：" + names.join(" ") + "）");
  }
  const wasHS = isHS(cfg), before = [L.reels, L.rows];
  if (opt.grid && opt.grid !== true) {
    const g = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(String(opt.grid));
    if (!g) fail("--grid 格式是 欄x列，例如 3x2");
    L.reels = Number(g[1]);
    L.rows = Number(g[2]);
  } else if (!wasHS && opt.symbols) {
    L.reels = 5; L.rows = 3;
  }
  if (opt.cell) [L.cellW, L.cellH] = parseSize(opt.cell, "--cell");
  if (opt.gap) [L.gapX, L.gapY] = parseSize(opt.gap, "--gap");
  if (opt.spins) H.spins = Number(opt.spins);
  if (opt["start-spins"]) H.startSpins = Number(opt["start-spins"]);
  else if (opt.spins || !wasHS) H.startSpins = H.spins;
  cfg.mode = "holdspin";
  H.blank = blank;
  if (!wasHS || before[0] !== L.reels || before[1] !== L.rows) {
    cfg.startBoard = S.board.create(L.reels, L.rows, blank);
    H.rounds = "";
  }
  cfg.lines = [];
  const norm = S.normalizeConfig(cfg);
  norm.endBoard = S.util.clone(norm.startBoard);
  save(out, norm);
  const N = norm.layout;
  console.log("已" + (opt.symbols ? "建立 " + out + "（" + names.length + " 個符號：" + names.join(", ") + "）" : "把 " + out + " 改成") + " Hold & Spin：" +
    N.reels + " 欄 × " + N.rows + " 列，格子 " + N.cellW + "x" + N.cellH + "，間距 " + N.gapX + "x" + N.gapY + "，空格符號 " + blank +
    "，次數 " + norm.hs.spins + "（開始剩 " + norm.hs.startSpins + "）");
  console.log("下一步：hs-board 設定起始盤面（一開始就鎖住的符號）和每回合落下的符號 → check → render");
}

// --rounds / --add：@檔案 = 讀檔；否則 ; 分隔回合（不像盤面把 / 換成換行：/ 是回合裡的換列）
function roundsArg(v) {
  if (v === undefined || v === true) return null;
  const s = String(v);
  if (s.startsWith("@") && fs.existsSync(s.slice(1))) return fs.readFileSync(s.slice(1), "utf8");
  return s.replace(/\s*;\s*/g, "\n");
}

function cmdHsBoard(file, opt) {
  const cfg = load(file);
  if (!isHS(cfg)) fail("這個設定檔不是 Hold & Spin，先用 hs-init 轉換");
  const L = cfg.layout, H = cfg.hs, names = S.symbolNames(cfg);
  const hint = "\n可用符號：" + names.join(" ") + "（- = 空格 " + H.blank + "）";
  const start = textArg(opt.start);
  if (start !== null) {
    const res = S.hs.parseBoard(start, L.reels, L.rows, names, H.blank);
    if (res.errors.length) fail("起始盤面：\n  " + res.errors.join("\n  ") + hint);
    cfg.startBoard = res.board.map((col) => col.map((v) => v || H.blank));
  }
  if (opt.clear) H.rounds = "";
  const r = roundsArg(opt.rounds);
  if (r !== null) H.rounds = r;
  const add = roundsArg(opt.add);
  if (add !== null) H.rounds = (H.rounds.trim() ? H.rounds.trim() + "\n" : "") + add;
  const parsed = S.hs.parseRounds(cfg);
  if (parsed.errors.length) fail("回合：\n  " + parsed.errors.join("\n  ") + hint);
  H.rounds = S.hs.roundsText(parsed.rounds, L.rows);
  const sim = S.hs.apply(cfg);
  if (sim.errors.length && parsed.rounds.length) fail(sim.errors.join("\n"));
  if (!parsed.rounds.length) cfg.endBoard = S.util.clone(cfg.startBoard);
  save(file, cfg);
  printHs(cfg, sim);
}

// 起始盤面 + 每回合推演表 + 最後盤面
function printHs(cfg, sim) {
  const L = cfg.layout, H = cfg.hs;
  sim = sim || S.hs.simulate(cfg);
  console.log("起始盤面（- = 空格 " + H.blank + "，其他符號一開始就鎖住；開始剩 " + H.startSpins + " 次，落下新符號重設成 " + H.spins + " 次）：");
  console.log(indent(S.board.toText(dashBlank(cfg.startBoard, H.blank), L.rows)));
  const parsed = S.hs.parseRounds(cfg).rounds;
  if (!parsed.length) { console.log("\n還沒有回合：hs-board " + "<preset> --rounds \"@3 - 200 - / 800 - -; ...\""); return; }
  console.log("\n" + pad("回合", 6) + pad("起轉", 9) + pad("轉", 4) + pad("落下（列-欄）", 30) + "剩餘次數");
  let left = H.startSpins;
  sim.rounds.forEach((rd, k) => {
    const locks = rd.spin.filter((s) => s[2]).map((s) => (s[1] + 1) + "-" + (s[0] + 1) + " " + s[2]);
    const at = parsed[k].at !== null ? "@" + parsed[k].at : (k ? "接續" : "@0");
    console.log(pad(String(k + 1), 6) + pad(at, 9) + pad(rd.spin.length, 4) + pad(locks.join("、") || "-", 30) +
      left + " → " + rd.spinsLeft + (rd.locks ? " → " + rd.spinsAfter + "（重設）" : "") +
      (rd.end === "full" ? "　全滿，結束" : rd.end === "out" ? "　次數用完，結束" : ""));
    left = rd.spinsAfter;
  });
  sim.errors.forEach((e) => console.log("✗ " + e));
  sim.warnings.forEach((w) => console.log("⚠ " + w));
  console.log("\n最後盤面：\n" + indent(S.board.toText(sim.board, L.rows)));
}

function hsRhythmLine(cfg) {
  const H = cfg.hs, P = cfg.spin;
  return "節奏：轉速 " + H.speed + " 格/秒｜第一格停 " + H.firstStop + " 每格間隔 " + H.stagger + " 順序 " + H.order +
    "｜回合間停頓 " + H.roundGap + "｜期待：轉 ≤" + H.antCells + " 格時每格多轉 " + P.antTime + " 秒、繞框 " + (H.antFrame ? "開" : "關") +
    "｜鎖住跳動 " + H.lockPulse + "%";
}

function cmdShow(file) {
  const cfg = load(file);
  const L = cfg.layout;
  if (isHS(cfg)) {
    console.log("Hold & Spin " + L.reels + " 欄 × " + L.rows + " 列，格子 " + L.cellW + "x" + L.cellH + "，間距 " + L.gapX + "x" + L.gapY +
      "，開始時間 " + cfg.spin.startTime + " 秒，位置 " + (L.position ? L.position.join(", ") : "置中"));
    console.log("符號：" + cfg.symbols.map((s) => s.name + (s.filler ? "" : "*") + (s.scale !== 100 ? "(" + s.scale + "%)" : "")).join(" ") +
      "   （* = 不當填充）   空格符號：" + (cfg.hs.blank || "（未設定）"));
    console.log(hsRhythmLine(cfg) + "\n");
    printHs(cfg);
    return;
  }
  console.log("盤面 " + L.reels + "x" + L.rows + "，格子 " + L.cellW + "x" + L.cellH + "，開始時間 " + cfg.spin.startTime + " 秒" +
    "，位置 " + (L.position ? L.position.join(", ") : "置中"));
  console.log("符號：" + cfg.symbols.map((s) => s.name + (s.filler ? "" : "*") + (s.scale !== 100 ? "(" + s.scale + "%)" : "")).join(" ") + "   （* = 不當填充）");
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
  if (isHS(cfg)) fail("Hold & Spin 的盤面用 hs-board 設定（--start 起始盤面、--rounds 每回合）");
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
  if (opt.scale !== undefined) {
    const v = Number(String(opt.scale).replace(/%$/, ""));
    if (!(v > 0)) fail("--scale 要是大於 0 的百分比，例如 87");
    e.scale = v;
  }
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
  console.log(e.name + "：" + (e.filler ? "填充符號" : "不當填充") + (e.scale !== 100 ? "，縮放 " + e.scale + "%" : "") + "  " + e.path);
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
  let touchedSpin = false, touchedSize = false, touchedLineGen = false;
  for (const p of pairs) {
    const i = p.indexOf("=");
    if (i < 0) fail("格式是 key.path=value：" + p);
    const k = p.slice(0, i), v = p.slice(i + 1);
    if (/^(symbols|reels|lines|startBoard|endBoard)\b/.test(k)) fail(k + " 請用專用指令（symbol / reel / lines / board）");
    setPath(cfg, k, v);
    if (k.startsWith("spin.")) touchedSpin = true;
    if (k.startsWith("lineGen.")) touchedLineGen = true;
    if (k === "layout.reels" || k === "layout.rows") touchedSize = true;
  }
  const before = cfg.layout.reels;
  cfg = S.normalizeConfig(cfg);
  if (isHS(cfg)) {
    // Hold & Spin：改尺寸時新格子補空格；回合、最後盤面重新推演
    if (touchedSize) cfg.startBoard.forEach((col) => col.forEach((v, y) => { if (!v) col[y] = cfg.hs.blank; }));
    const sim = S.hs.apply(cfg);
    save(file, cfg);
    console.log("已更新 " + pairs.join(" "));
    console.log(hsRhythmLine(cfg));
    sim.errors.forEach((e) => console.log("✗ " + e));
    return;
  }
  if (touchedSize) {
    const pool = S.fillerPool(cfg), rng = new S.Rng(Date.now() % 2147483000 + 1);
    for (const b of [cfg.startBoard, cfg.endBoard]) b.forEach((col) => col.forEach((v, y) => { if (!v) col[y] = rng.pick(pool); }));
    cfg.reels = S.generateReels(cfg);
    cfg.lines = cfg.lines.filter((l) => S.lines.parsePattern(l.pattern, cfg.layout.reels, cfg.layout.rows, true));
  } else if (touchedSpin && cfg.spin.autoRhythm) {
    cfg.reels = S.generateReels(cfg);
  }
  if (touchedLineGen && cfg.lines.length) S.lines.applyTiming(cfg.lines, cfg.lineGen);
  save(file, cfg);
  console.log("已更新 " + pairs.join(" ") + (touchedSpin && cfg.spin.autoRhythm ? "（已重新產生各輪）" : "") +
    (touchedSize && before !== cfg.layout.reels ? "（盤面尺寸改變，各輪已重新產生、空格已亂數補上）" : ""));
  if (touchedSpin || touchedSize) printReels(cfg);
  if (touchedLineGen && cfg.lines.length) {
    console.log("已依 lineGen 重新排連線顯示時間：");
    cfg.lines.forEach((l, i) => console.log("  " + (i + 1) + ". " + l.pattern + " 顯示 " + l.shows));
  }
}

const REEL_KEYS = Object.keys(S.reelDefaults());

function cmdReel(file, which, pairs) {
  const cfg = load(file);
  reelsOnly(cfg, "reel");
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
  reelsOnly(cfg, "regen");
  cfg.reels = S.generateReels(cfg);
  cfg.spin.autoRhythm = true;
  save(file, cfg);
  console.log("已依快速節奏重新產生各輪");
  printReels(cfg);
}

function cmdSuggest(file, opt) {
  const cfg = load(file);
  reelsOnly(cfg, "suggest");
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
  reelsOnly(cfg, "lines");
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

// Hold & Spin 文字時間軸：每格一行
function asciiTimelineHS(plan, width) {
  const T0 = plan.startTime, T1 = Math.max(plan.endTime, T0 + 0.5) + 0.1;
  const X = (t) => Math.max(0, Math.min(width - 1, Math.round((t - T0) / (T1 - T0) * (width - 1))));
  const rows = [];
  const head = Array(width).fill(" ");
  plan.rounds.forEach((rd, k) => String(k + 1).split("").forEach((c, j) => { if (X(rd.start) + j < width) head[X(rd.start) + j] = c; }));
  rows.push(pad("回合", 6) + head.join(""));
  plan.cells.forEach((cp) => {
    const line = Array(width).fill(" ");
    if (cp.lockRound === 0) line.fill("#");
    cp.spins.forEach((sp) => {
      for (let x = X(sp.start); x <= X(sp.decelStart); x++) line[x] = "=";
      for (let x = X(sp.decelStart); x <= X(sp.stop); x++) line[x] = "~";
      for (let x = X(sp.stop); x <= X(sp.settle); x++) line[x] = ".";
      if (sp.lock) for (let x = X(sp.settle) + 1; x < width; x++) line[x] = "#";
    });
    plan.frames.filter((f) => f.cell === cp.index).forEach((f) => {
      for (let x = X(f.start); x <= X(f.end); x++) if (line[x] === "=" || line[x] === " ") line[x] = "*";
    });
    cp.spins.forEach((sp) => { line[X(sp.stop)] = "|"; });
    rows.push(pad("C" + cp.tag, 6) + line.join(""));
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
  return rows.join("\n") + "\n      = 轉動  * 繞框  ~ 減速  | 停下  . 回彈  # 鎖住（格子 C列-欄）";
}

function checkHS(cfg, plan, fps, opt, all) {
  const T0 = plan ? plan.startTime : 0;
  if (opt.json) {
    console.log(JSON.stringify({
      ok: !all.length, mode: "holdspin", errors: all, warnings: plan ? plan.warnings : [], fps,
      rounds: plan ? plan.rounds.map((rd, k) => ({ round: k + 1, start: rd.start, firstStop: rd.firstStop, settle: rd.settle,
        cells: rd.cells.map((i) => plan.cells[i].tag), locks: rd.locks.map((i) => ({ cell: plan.cells[i].tag, symbol: plan.cells[i].final })),
        spinsLeft: rd.spinsLeft, spinsAfter: rd.spinsAfter, end: rd.end })) : [],
      cells: plan ? plan.cells.map((cp) => ({ cell: cp.tag, start: cp.start, final: cp.final, lockRound: cp.lockRound,
        spins: cp.spins.map((sp) => ({ round: sp.round + 1, start: sp.start, stop: sp.stop, settle: sp.settle, result: sp.result, lock: sp.lock, ant: sp.ant, fill: sp.fill, speed: r2(sp.speed / plan.pitch) })) })) : [],
      frames: plan ? plan.frames.map((f) => ({ cell: plan.cells[f.cell].tag, start: f.start, end: f.end })) : [],
      markers: plan ? plan.markers.map((m) => ({ t: m.t, frame: Math.round(m.t * fps), label: m.label })) : [],
      finalBoard: plan ? plan.board : null, allSettled: plan ? plan.allSettled : null, endTime: plan ? plan.endTime : null,
    }, null, 2));
    process.exit(all.length ? 1 : 0);
  }
  if (all.length) { console.log("✗ 有問題：\n  " + all.join("\n  ")); process.exit(1); }
  const L = cfg.layout;
  console.log("✓ 設定正確（Hold & Spin " + L.reels + " 欄 × " + L.rows + " 列，@" + fps + "fps，開始 " + r2(T0) + " 秒；以下時間從開始算）");
  plan.warnings.forEach((w) => console.log("⚠ " + w));
  console.log("\n" + pad("回合", 6) + pad("起轉", 7) + pad("第一格停", 10) + pad("停妥", 7) + pad("轉", 4) + pad("鎖住（列-欄）", 26) + "剩餘次數");
  let left = cfg.hs.startSpins;
  plan.rounds.forEach((rd, k) => {
    const locks = rd.locks.map((i) => plan.cells[i].tag + " " + plan.cells[i].final).join("、") || "-";
    console.log(pad(String(k + 1) + (rd.ant ? "*" : ""), 6) + pad(r2(rd.start - T0), 7) + pad(r2(rd.firstStop - T0), 10) + pad(r2(rd.settle - T0), 7) +
      pad(rd.cells.length, 4) + pad(locks, 26) + left + " → " + rd.spinsLeft + (rd.locks.length ? " → " + rd.spinsAfter : "") +
      (rd.end === "full" ? "　全滿" : rd.end === "out" ? "　用完" : ""));
    left = rd.spinsAfter;
  });
  console.log("（* = 期待回合：轉的格子 ≤ " + cfg.hs.antCells + " 格，每格多轉 " + cfg.spin.antTime + " 秒）");
  console.log("\n各格每次停下（列-欄；🔒 = 落下鎖住）：");
  plan.cells.forEach((cp) => {
    const parts = cp.lockRound === 0 ? ["一開始就鎖住 " + cp.start] :
      cp.spins.map((sp) => "R" + (sp.round + 1) + " " + r2(sp.stop - T0) + "s " + sp.result + (sp.lock ? " 🔒" : "") + "（" + sp.fill + " 格 " + r2(sp.speed / plan.pitch) + " 格/秒）");
    console.log("  " + pad(cp.tag, 5) + parts.join("　"));
  });
  console.log("\n最後盤面：\n" + indent(S.board.toText(plan.board, L.rows)));
  console.log("全部停妥 " + r2(plan.allSettled - T0) + " 秒，演出結束 " + r2(plan.endTime - T0) + " 秒");
  console.log("\n" + asciiTimelineHS(plan, 64));
  console.log("\n標記（目標合成時間，可對音效）：");
  plan.markers.forEach((m) => console.log("  " + pad(r2(m.t).toFixed(2) + "s", 8) + pad("f" + Math.round(m.t * fps), 7) + m.label));
}

function cmdCheck(file, opt) {
  const cfg = load(file);
  const fps = Number(opt.fps || cfg.layout.newCompFps || 30);
  const errors = S.validateConfig(cfg);
  const plan = errors.length ? null : S.computePlan(cfg, fps);
  const all = errors.concat(plan ? plan.errors : []);
  if (isHS(cfg)) return checkHS(cfg, plan, fps, opt, all);
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
// 繞框外框（預覽用）：轉輪的框住整輪；Hold & Spin 的框住一格
function frameOverlays(plan, F, L, t) {
  const cy = plan.margin + plan.reelH / 2;
  return plan.frames.filter((f) => t >= f.start && t <= f.end + F.fade).map((f) => {
    let a = 1;
    if (F.fade > 0) a = Math.min(1, (t - f.start) / F.fade, (f.end + F.fade - t) / F.fade);
    return { cx: f.x, cy: f.y !== undefined ? f.y : cy, w: f.w || L.cellW + 2 * F.pad, h: f.h || plan.reelH + 2 * F.pad,
      color: F.source === "custom" ? "#FFFFFF" : F.color, width: F.width, alpha: Math.max(0, a), phase: (t * F.laps) % 1, runner: F.runner / 100 };
  });
}

// Hold & Spin 的預覽場景：每格一個 1 格高的視窗；鎖住跳動和 AE 相同（0.1 秒放大、0.22 秒縮回）
function sceneForHS(cfg, plan, fps, shots, outScale) {
  const L = cfg.layout, F = cfg.frame, H = cfg.hs;
  const symbols = {};
  cfg.symbols.forEach((s) => { symbols[s.name] = s.path; });
  const shutter = cfg.spin.motionBlur ? cfg.spin.shutterAngle / 360 / fps : 0;
  const samples = shutter > 0 ? 8 : 1;
  const up = S.hs.PULSE_UP, down = S.hs.PULSE_DOWN, big = H.lockPulse / 100;
  const frames = shots.map(({ t, label }) => {
    const cells = plan.cells.map((cp) => {
      const ys = [];
      for (let s = 0; s < samples; s++) ys.push(cp.keys.length ? S.evalKeys(cp.keys, samples > 1 ? t - shutter / 2 + shutter * (s + 0.5) / samples : t) : cp.startY);
      return ys;
    });
    const wins = plan.pulses.filter((p) => t >= p.t && t < p.t + up + down).map((p) => {
      const dt = t - p.t;
      return { cx: p.x, cy: p.y, name: p.name, scale: dt < up ? 1 + (big - 1) * dt / up : big - (big - 1) * (dt - up) / down };
    });
    return { t, label, reels: [], cells, frames: frameOverlays(plan, F, L, t), wins, lines: [] };
  });
  return { width: plan.boardW, height: plan.boardH, margin: plan.margin, reelW: L.cellW, reelH: L.cellH, cellW: L.cellW, cellH: L.cellH,
    pitch: plan.pitch, scaleMode: L.scaleMode, symbolScale: L.symbolScale, symbolScales: S.symbolScales(cfg), symbols, fps, outScale: outScale || 1,
    reels: [], cells: plan.cells.map((cp) => ({ x: cp.x, y: cp.y, strip: cp.strip.map((s) => s.name) })), frames, plan };
}

function sceneFor(cfg, fps, shots, outScale) {
  const plan = S.computePlan(cfg, fps);
  if (plan.errors.length) fail(plan.errors.join("\n"));
  if (isHS(cfg)) return sceneForHS(cfg, plan, fps, shots, outScale);
  const L = cfg.layout, F = cfg.frame, LS = cfg.lineStyle;
  const symbols = {};
  cfg.symbols.forEach((s) => { symbols[s.name] = s.path; });
  const shutter = cfg.spin.motionBlur ? cfg.spin.shutterAngle / 360 / fps : 0;
  const samples = shutter > 0 ? 8 : 1;
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
    const frameOv = frameOverlays(plan, F, L, t);
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
    pitch: plan.pitch, scaleMode: L.scaleMode, symbolScale: L.symbolScale, symbolScales: S.symbolScales(cfg), symbols, fps, outScale: outScale || 1,
    reels: plan.reels.map((rp) => ({ x: rp.x, strip: rp.strip.map((s) => s.name) })), frames, plan };
}

function keyShots(plan) {
  if (plan.mode === "holdspin") return S.hs.shots(plan);
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
  shots.sort((a, b) => a.t - b.t);
  // 同一時間的畫面只留一張，標籤合併
  const out = [];
  shots.forEach((s) => {
    const last = out[out.length - 1];
    if (last && Math.abs(last.t - s.t) < 1e-6) last.label += " / " + s.label;
    else out.push({ t: s.t, label: s.label });
  });
  return out;
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
    // Hold & Spin：開始 + 每回合停妥後的盤面
    const shots = [{ t: plan.startTime - 0.001, label: "START" }].concat(isHS(cfg) ?
      plan.rounds.map((rd, k) => ({ t: rd.settle + 0.001, label: "ROUND " + (k + 1) + (rd.full ? " FULL" : rd.end === "out" ? " END" : "") })) :
      [{ t: plan.allSettled + 0.001, label: "RESULT" }]);
    runRender(["scene", tmpJson("boards", sceneFor(cfg, fps, shots, scale)), "sheet", out, String(Math.min(shots.length, isHS(cfg) ? 3 : 2))]);
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
  let position = cfg.layout.position;
  if (opt.position !== undefined && opt.position !== true) {
    const center = /^(center|none|置中)$/i.test(String(opt.position));
    position = center ? null : S.parsePosition(String(opt.position));
    if (!center && !position) fail("--position 格式是 540,1434 或 center");
  }
  let frames = opt.frames === undefined || opt.frames === true ? "auto" : String(opt.frames);
  if (frames !== "auto" && frames !== "none") frames = frames.split(",").map(Number).filter((x) => !isNaN(x));
  const job = {
    preset: path.resolve(file), mode: opt.mode && opt.mode !== true ? String(opt.mode) : "auto",
    comp: opt.comp && opt.comp !== true ? String(opt.comp) : "", board: opt.board && opt.board !== true ? String(opt.board) : "",
    result: resultFile, frames, framesDir: path.join(outDir, "frames"),
    position, // 盤面中心在目標合成的位置；null = 新建時置中、更新時不動
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
    console.log("盤面位置：" + (position ? position.join(", ") + "（盤面中心）" : "新建時放合成中央，更新時不動"));
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
  require("./ec.js").printRounds(res);
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
    case "from-psd": return cmdFromPsd(pos[0], opt);
    case "hs-init": return cmdHsInit(pos[0], opt);
    case "hs-board": return cmdHsBoard(pos[0], opt);
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
    case "ec": return require("./ec.js").cmdEC(pos[0], opt, { load, fail });
    case undefined: case "help": case "-h": case "--help": process.stdout.write(HELP); return;
    default: fail("不認得的指令 " + cmd + "\n\n" + HELP);
  }
}

if (require.main === module) main();
module.exports = { sceneFor, keyShots, asciiTimeline, asciiTimelineHS };
