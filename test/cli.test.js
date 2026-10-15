/*
 * tools/sfs.js（agent 用的命令列）與 dist/SlotFakeSpin_apply.jsx（AE 自動化入口）
 */
"use strict";
const os = require("os");
const cp = require("child_process");
const H = require("./helpers");
const { fs, path, vm, assert, test, deq, near, newContext, ROOT, SYMBOL_DIR } = H;

console.log("tools/sfs.js + SlotFakeSpin_apply.jsx");

const SFS_CLI = path.join(ROOT, "tools", "sfs.js");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sfs-cli-"));
function sfs(args, expectFail) {
  const r = cp.spawnSync(process.execPath, [SFS_CLI].concat(args), { cwd: tmp, encoding: "utf8" });
  if (!expectFail && r.status !== 0) throw new Error("sfs " + args.join(" ") + " failed:\n" + r.stdout + r.stderr);
  if (expectFail && r.status === 0) throw new Error("sfs " + args.join(" ") + " should fail:\n" + r.stdout);
  return r.stdout + r.stderr;
}
const preset = () => JSON.parse(fs.readFileSync(path.join(tmp, "p.json"), "utf8"));

const END = "CHERRY SCATTER BELL K SCATTER / SEVEN SEVEN SEVEN WILD Q / J A SCATTER BAR A";

test("init：從資料夾建立、自動辨識 WILD / SCATTER", () => {
  const out = sfs(["init", "--symbols", SYMBOL_DIR, "--out", "p.json", "--cell", "180x160"]);
  assert.ok(/10 個符號/.test(out));
  const p = preset();
  assert.strictEqual(p.symbols.length, 10);
  assert.ok(path.isAbsolute(p.symbols[0].path) && fs.existsSync(p.symbols[0].path));
  assert.strictEqual(p.lineSet.wilds, "WILD");
  assert.strictEqual(p.antRule.symbols, "SCATTER");
  assert.strictEqual(p.symbols.find((s) => s.name === "SCATTER").filler, false);
  assert.strictEqual(p.layout.cellW, 180);
  assert.strictEqual(p.layout.cellH, 160);
  assert.strictEqual(p.reels.length, 5);
});

test("board：文字 / 斜線換行 / 錯誤提示", () => {
  sfs(["board", "p.json", "--start", "A K Q J A / K A J Q K / Q J A K Q", "--end", END]);
  const p = preset();
  deq(p.endBoard[1], ["SCATTER", "SEVEN", "A"]);
  const err = sfs(["board", "p.json", "--end", "A A A A A / B B"], true);
  assert.ok(/第 2 行/.test(err) && /可用符號/.test(err), err);
});

test("suggest --apply：Scatter 差一顆 → 第 4、5 輪期待 + 繞框", () => {
  const out = sfs(["suggest", "p.json", "--apply"]);
  assert.ok(/建議期待輪：4,5/.test(out), out);
  const p = preset();
  assert.strictEqual(p.spin.antReels, "4,5");
  deq(p.reels.map((r) => r.frame), [false, false, false, true, true]);
});

test("lines --detect：偵測連線並排顯示時間", () => {
  const out = sfs(["lines", "p.json", "--detect"]);
  assert.ok(/SEVEN 連 4/.test(out), out);
  assert.ok(/SCATTER × 3（框格子 0,1,3,0,1）/.test(out), out);
  const p = preset();
  assert.strictEqual(p.lines.length, 2);
  assert.strictEqual(p.lines[0].shows, "0.3+1.2, 1.6+0.9");
  assert.strictEqual(p.lines[1].shows, "0.3+1.2, 2.6+0.9");
  sfs(["lines", "p.json", "--add", "1,2,3,2,1:3:0.5+1"]);
  assert.strictEqual(preset().lines.length, 3);
  sfs(["lines", "p.json", "--add", "1,2,9,2,1:3"], true);
  sfs(["lines", "p.json", "--add", "1,1,1,1,1:box:0+1"]);
  const p2 = preset();
  assert.ok(p2.lines[1].boxOnly && p2.lines[3].boxOnly && !p2.lines[0].boxOnly);
  sfs(["lines", "p.json", "--clear", "--detect"]);
});

test("set：改 lineGen 會重新排連線時間", () => {
  sfs(["set", "p.json", "lineGen.mode=all", "lineGen.allTime=1.8", "lineGen.delay=0.2"]);
  assert.ok(preset().lines.every((l) => l.shows === "0.2+1.8"));
  sfs(["set", "p.json", "lineGen.mode=all_each", "lineGen.allTime=1.2", "lineGen.delay=0.3"]);
});

test("set：改快速節奏會自動重新產生各輪；改尺寸會補盤面", () => {
  sfs(["set", "p.json", "spin.stopOrder=5,4,3,2,1", "spin.speeds=14,16,18,22,26"]);
  let p = preset();
  assert.ok(p.reels[4].stop < p.reels[0].stop);
  assert.strictEqual(p.reels[4].speed, 14);
  sfs(["set", "p.json", "spin.stopOrder=", "spin.speeds=18", "frame.color=#FF3366"]);
  p = preset();
  assert.strictEqual(p.frame.color, "#FF3366");
  sfs(["set", "p.json", "nope.key=1"], true);
  sfs(["set", "p.json", "reels=1"], true);
});

test("reel：逐輪微調（相對值）會關掉自動套用；regen 還原", () => {
  const before = preset().reels[4].stop;
  sfs(["reel", "p.json", "5", "stop=+0.4", "decelCurve=hard", "frameSpeed=30"]);
  let p = preset();
  near(p.reels[4].stop, before + 0.4, 1e-9);
  assert.strictEqual(p.reels[4].decelCurve, "hard");
  assert.strictEqual(p.spin.autoRhythm, false);
  sfs(["set", "p.json", "spin.firstStop=1.2"]);
  near(preset().reels[4].stop, before + 0.4, 1e-9, "manual edit kept");
  sfs(["reel", "p.json", "9", "stop=1"], true);
  sfs(["reel", "p.json", "1", "bogus=1"], true);
  sfs(["regen", "p.json"]);
  p = preset();
  assert.strictEqual(p.spin.autoRhythm, true);
  sfs(["reel", "p.json", "all", "overshoot=0.3"]);
  assert.ok(preset().reels.every((r) => r.overshoot === 0.3));
  sfs(["regen", "p.json"]);
});

test("check：時間表、文字時間軸、標記；--json；錯誤時非 0", () => {
  const out = sfs(["check", "p.json"]);
  assert.ok(/✓ 設定正確/.test(out));
  assert.ok(/R5 STOP/.test(out) && /R4 FRAME/.test(out) && /LINE 1/.test(out));
  assert.ok(/R4 .*\*+/.test(out), "frame shown on timeline");
  const j = JSON.parse(sfs(["check", "p.json", "--json", "--fps", "24"]));
  assert.ok(j.ok);
  assert.strictEqual(j.fps, 24);
  assert.strictEqual(j.frames.length, 2);
  j.markers.forEach((m) => near(m.frame, m.t * 24, 1e-6));
  const bad = preset();
  bad.endBoard[0][0] = "";
  fs.writeFileSync(path.join(tmp, "bad.json"), JSON.stringify(bad));
  assert.ok(/結果盤面/.test(sfs(["check", "bad.json"], true)));
});

test("show：摘要", () => {
  const out = sfs(["show", "p.json"]);
  assert.ok(/結果盤面/.test(out) && /SCATTER\*/.test(out) && /連線/.test(out));
});

test("範例設定檔：符號用相對路徑，從任何目錄都能用", () => {
  const ex = path.join(ROOT, "examples", "freegame.json");
  const raw = JSON.parse(fs.readFileSync(ex, "utf8"));
  assert.ok(raw.symbols.every((s) => /^symbols\//.test(s.path)), "example uses relative paths");
  const out = sfs(["check", ex]);
  assert.ok(/✓ 設定正確/.test(out), out);
  // 整個資料夾搬到別處：修改後仍保持相對路徑
  const dir = path.join(tmp, "moved");
  fs.mkdirSync(path.join(dir, "symbols"), { recursive: true });
  fs.readdirSync(SYMBOL_DIR).forEach((f) => fs.copyFileSync(path.join(SYMBOL_DIR, f), path.join(dir, "symbols", f)));
  fs.copyFileSync(ex, path.join(dir, "fg.json"));
  sfs(["set", path.join(dir, "fg.json"), "spin.seed=7"]);
  const moved = JSON.parse(fs.readFileSync(path.join(dir, "fg.json"), "utf8"));
  assert.strictEqual(moved.spin.seed, 7);
  assert.ok(moved.symbols.every((s) => /^symbols\//.test(s.path)), moved.symbols[0].path);
  // init 指到別處的符號資料夾時維持絕對路徑
  assert.ok(path.isAbsolute(preset().symbols[0].path));
});

test("ae --dry-run：產生啟動腳本（ASCII、帶工作參數）", () => {
  const out = sfs(["ae", "p.json", "--dry-run", "--comp", "主合成", "--out", "run1", "--frames", "1,2.5"]);
  assert.ok(/啟動腳本/.test(out));
  const launch = fs.readFileSync(path.join(tmp, "run1", "launch.jsx"), "utf8");
  assert.ok(!/[^\x00-\x7f]/.test(launch));
  assert.ok(/\$\.global\.SFS_APPLY = /.test(launch) && /SlotFakeSpin_apply\.jsx/.test(launch));
  const job = vm.runInNewContext("var $ = {global: {}}; var File = function(){}; $.evalFile = function(){};" + launch + "; $.global.SFS_APPLY");
  assert.strictEqual(job.comp, "主合成");
  deq(job.frames, [1, 2.5]);
  assert.strictEqual(job.preset, path.join(tmp, "p.json"));
});

const hasPillow = ["python3", "python"].some((exe) => cp.spawnSync(exe, ["-c", "import PIL"]).status === 0);
test("render --boards / symbols-sheet（需要 Pillow）" + (hasPillow ? "" : "：略過"), () => {
  if (!hasPillow) return;
  sfs(["render", "p.json", "--boards", "b.png", "--scale", "0.25"]);
  assert.ok(fs.statSync(path.join(tmp, "b.png")).size > 1000);
  sfs(["symbols-sheet", SYMBOL_DIR, "s.png"]);
  assert.ok(fs.statSync(path.join(tmp, "s.png")).size > 1000);
});

test("symbol --scale / set layout.position / show", () => {
  sfs(["symbol", "p.json", "SEVEN", "--scale", "87%"]);
  assert.strictEqual(preset().symbols.find((s) => s.name === "SEVEN").scale, 87);
  sfs(["symbol", "p.json", "SEVEN", "--scale", "0"], true);
  sfs(["set", "p.json", "layout.position=960,500"]);
  deq(preset().layout.position, [960, 500]);
  const out = sfs(["show", "p.json"]);
  assert.ok(/位置 960, 500/.test(out) && /SEVEN\(87%\)/.test(out), out);
  sfs(["set", "p.json", "layout.position="]);
  assert.strictEqual(preset().layout.position, null);
  assert.ok(/位置 置中/.test(sfs(["show", "p.json"])));
  sfs(["symbol", "p.json", "SEVEN", "--scale", "100"]);
});

const launchJob = (dir) => vm.runInNewContext("var $ = {global: {}}; var File = function(){}; $.evalFile = function(){};" +
  fs.readFileSync(path.join(tmp, dir, "launch.jsx"), "utf8") + "; $.global.SFS_APPLY");

test("ae --dry-run：啟動腳本帶盤面位置；--position 可臨時改或 center", () => {
  sfs(["set", "p.json", "layout.position=960,500"]);
  assert.ok(/盤面位置：960, 500/.test(sfs(["ae", "p.json", "--dry-run", "--out", "run2"])));
  deq(launchJob("run2").position, [960, 500]);
  sfs(["ae", "p.json", "--dry-run", "--out", "run3", "--position", "100,200"]);
  deq(launchJob("run3").position, [100, 200]);
  assert.ok(/合成中央/.test(sfs(["ae", "p.json", "--dry-run", "--out", "run4", "--position", "center"])));
  assert.strictEqual(launchJob("run4").position, null);
  sfs(["ae", "p.json", "--dry-run", "--out", "run5", "--position", "abc"], true);
  sfs(["set", "p.json", "layout.position="]);
  assert.strictEqual(launchJob("run1").position, null, "preset without position");
});

const PY = ["python3", "python", "py"].find((exe) => cp.spawnSync(exe, ["-c", "import PIL"]).status === 0);
const hasPsdTools = !!PY && cp.spawnSync(PY, ["-c", "import psd_tools"]).status === 0;

test("tools/psd.py 單元測試（需要 Pillow；有 psd-tools 時多跑 PSD 讀取）" + (PY ? "" : "：略過"), () => {
  if (!PY) return;
  const r = cp.spawnSync(PY, [path.join(ROOT, "test", "psd_test.py")], { encoding: "utf8" });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
});

test("from-psd（需要 Pillow + psd-tools）" + (hasPsdTools ? "" : "：略過，只檢查安裝提示"), () => {
  if (!hasPsdTools) {
    if (PY) assert.ok(/pip install psd-tools/.test(sfs(["from-psd", SFS_CLI, "--out", "x/p.json"], true)));
    return;
  }
  const dir = path.join(tmp, "psd");
  fs.mkdirSync(dir, { recursive: true });
  const psdFile = path.join(dir, "遊戲畫面.psd");
  const mk = cp.spawnSync(PY, [path.join(ROOT, "test", "psd_test.py"), "make", psdFile], { encoding: "utf8" });
  assert.strictEqual(mk.status, 0, mk.stderr);
  const out = sfs(["from-psd", psdFile, "--out", "psd/game/preset.json", "--names", "塔可=TACO,粉鑽=PINK,辣椒人=CHILI,藍鑽=BLUE",
    "--triggers", "pink,blue", "--wilds", "CHILI"]);
  const gameDir = path.join(dir, "game");
  const p = JSON.parse(fs.readFileSync(path.join(gameDir, "preset.json"), "utf8"));
  deq(p.symbols.map((s) => s.name), ["10", "A", "BLUE", "CHILI", "J", "K", "PINK", "Q", "TACO", "WILD", "綠鑽"]);
  assert.ok(p.symbols.every((s) => /^symbols\//.test(s.path) && fs.existsSync(path.join(gameDir, s.path))), "relative symbol paths");
  assert.strictEqual(H.SFS.board.toText(p.endBoard, 3), "TACO CHILI K BLUE TACO\nPINK CHILI J 綠鑽 PINK\nA CHILI 10 K A");
  const L = p.layout;
  deq([L.reels, L.rows, L.cellW, L.cellH, L.gapX, L.gapY, L.scaleMode, L.symbolScale], [5, 3, 100, 100, 4, 0, "none", 100]);
  deq(L.position, [300, 270]);
  assert.strictEqual(p.antRule.symbols, "PINK,BLUE");
  assert.strictEqual(p.lineSet.exclude, "PINK,BLUE");
  assert.strictEqual(p.lineSet.wilds, "CHILI");
  deq(p.symbols.filter((s) => !s.filler).map((s) => s.name), ["BLUE", "PINK"]);
  assert.ok(p.startBoard.every((col) => col.every((v) => v && v !== "PINK" && v !== "BLUE")), "no triggers on start board");
  deq(H.SFS.lines.detect(Object.assign(H.SFS.normalizeConfig(p), { endBoard: p.startBoard })).lines, [], "no lines on start board");
  assert.ok(/格線左上 \(42, 120\)，盤面中心 \(300, 270\)/.test(out), out);
  assert.ok(/Q（第 2 輪第 1 列，被「辣椒人」蓋住）/.test(out), out);
  assert.ok(/CHILI 110×104 比格子 100×100 大/.test(out) && /symbol .*preset\.json CHILI --scale 90/.test(out), out);
  assert.ok(/綠鑽 --rename/.test(out) && /--names "綠鑽="/.test(out), out);
  assert.ok(/WILD\[隱藏\]/.test(out), out);
  assert.ok(fs.existsSync(path.join(gameDir, "bg.png")) && /背景（拿掉符號群組）：bg\.png/.test(out), out);
  assert.ok(/✓ 設定正確/.test(sfs(["check", "psd/game/preset.json"])));
  // 指定格子 / 不輸出背景 / 自動縮小太大的符號
  const out2 = sfs(["from-psd", psdFile, "--out", "psd/fit/preset.json", "--fit-oversize", "--no-bg", "--cell", "96x100", "--gap", "8"]);
  const q = JSON.parse(fs.readFileSync(path.join(dir, "fit", "preset.json"), "utf8"));
  assert.strictEqual(q.symbols.find((s) => s.name === "辣椒人").scale, 87);
  deq([q.layout.cellW, q.layout.cellH, q.layout.gapX, q.layout.gapY], [96, 100, 8, 0]);
  deq(q.layout.position, [300, 270]);
  assert.ok(!fs.existsSync(path.join(dir, "fit", "bg.png")));
  assert.ok(/已設定縮放 87%/.test(out2), out2);
  // 錯誤：找不到符號群組 / --triggers 不是符號
  const err = sfs(["from-psd", psdFile, "--out", "psd/bad/p.json", "--group", "NOPE"], true);
  assert.ok(/找不到符號群組「NOPE」/.test(err) && /SYMBOLS/.test(err), err);
  assert.ok(/--triggers 的「NOPE」不是符號/.test(sfs(["from-psd", psdFile, "--out", "psd/bad/p.json", "--triggers", "NOPE"], true)));
});

// ---------------- AE 自動化入口（模擬 AE） ----------------
function runApply(ctx, job) {
  ctx.$.global = ctx;
  ctx.SFS_APPLY = job;
  const code = fs.readFileSync(path.join(ROOT, "dist", "SlotFakeSpin_apply.jsx"), "utf8");
  vm.runInContext(code, ctx, { filename: "SlotFakeSpin_apply.jsx" });
  return job.result ? JSON.parse(fs.readFileSync(job.result, "utf8")) : null;
}

test("apply：新建 → 自動更新同一個盤面 → 指定合成 / 檢查畫面", () => {
  const ctx = newContext();
  const main = ctx.app.project.items.addComp("Main", 1920, 1080, 1, 12, 30);
  ctx.app.project.activeItem = main;
  const run = path.join(tmp, "apply");
  let res = runApply(ctx, { preset: path.join(tmp, "p.json"), mode: "auto", result: path.join(run, "r1.json"), frames: "auto", framesDir: path.join(run, "f1") });
  deq(res.errors, []);
  assert.ok(res.ok);
  assert.strictEqual(res.mode, "new");
  assert.strictEqual(res.target, "Main");
  assert.ok(res.markers.some((m) => /R5 STOP/.test(m.label)));
  assert.ok(res.frames.length >= 8);
  res.frames.forEach((f) => assert.ok(fs.existsSync(f.file), f.file));
  assert.ok(res.frames.some((f) => f.label === "SPINNING") && res.frames.some((f) => /^LINE 1/.test(f.label)));
  assert.ok(main.openedInViewer);
  assert.ok(ctx.SFS_APPLY === null, "job consumed");
  // 第二次 auto：合成裡只有一個盤面 → 更新
  res = runApply(ctx, { preset: path.join(tmp, "p.json"), mode: "auto", result: path.join(run, "r2.json"), frames: "none" });
  assert.strictEqual(res.mode, "update");
  assert.strictEqual(main._layers.filter((l) => l.comment === "SFS_BOARD").length, 1);
  // 指定合成 + new
  const other = ctx.app.project.items.addComp("Promo", 1280, 720, 1, 10, 24);
  res = runApply(ctx, { preset: path.join(tmp, "p.json"), mode: "new", comp: "Promo", result: path.join(run, "r3.json"), frames: [1, 2] });
  assert.ok(res.ok);
  assert.strictEqual(res.target, "Promo");
  assert.strictEqual(other._layers.filter((l) => l.comment === "SFS_BOARD").length, 1);
  deq(res.frames.map((f) => f.t), [1, 2]);
  // 錯誤：找不到合成 / 更新但沒有盤面
  res = runApply(ctx, { preset: path.join(tmp, "p.json"), mode: "new", comp: "Nope", result: path.join(run, "r4.json") });
  assert.ok(!res.ok && /Nope/.test(res.errors[0]));
  const empty = ctx.app.project.items.addComp("Empty", 1920, 1080, 1, 10, 30);
  res = runApply(ctx, { preset: path.join(tmp, "p.json"), mode: "update", comp: "Empty", result: path.join(run, "r5.json") });
  assert.ok(!res.ok && /找不到要更新的盤面/.test(res.errors[0]));
  void empty;
  assert.strictEqual(ctx.app._undo, 0);
});

test("apply：設定檔裡的相對路徑以設定檔位置為準", () => {
  const ctx = newContext();
  const main = ctx.app.project.items.addComp("Main", 1920, 1080, 1, 12, 30);
  ctx.app.project.activeItem = main;
  const res = runApply(ctx, { preset: path.join(ROOT, "examples", "freegame.json"), mode: "new", result: path.join(tmp, "apply", "rel.json"), frames: "none" });
  deq(res.errors, []);
  const imported = ctx.app.project._items.filter((it) => it.mainSource && it.mainSource.file);
  assert.strictEqual(imported.length, 10);
  assert.ok(imported.every((it) => it.mainSource.file.fsName.indexOf(path.join(ROOT, "examples", "symbols")) === 0));
});

test("apply：沒有工作參數時跳出對話框選設定檔", () => {
  const ctx = newContext();
  ctx.app.project.activeItem = ctx.app.project.items.addComp("Main", 1920, 1080, 1, 12, 30);
  ctx.__dialogResult = new ctx.File(path.join(tmp, "p.json"));
  ctx.$.global = ctx;
  vm.runInContext(fs.readFileSync(path.join(ROOT, "dist", "SlotFakeSpin_apply.jsx"), "utf8"), ctx);
  assert.ok((ctx.__alerts || []).some((a) => /完成/.test(a)), (ctx.__alerts || []).join("\n"));
});

test("apply：啟動腳本的盤面位置覆蓋設定檔（null = 置中）", () => {
  const ctx = newContext();
  const main = ctx.app.project.items.addComp("Main", 1920, 1080, 1, 12, 30);
  ctx.app.project.activeItem = main;
  sfs(["set", "p.json", "layout.position=700,600"]);
  const run = path.join(tmp, "apply-pos");
  fs.mkdirSync(run, { recursive: true });
  const boards = () => main._layers.filter((l) => l.comment === "SFS_BOARD");
  let res = runApply(ctx, { preset: path.join(tmp, "p.json"), mode: "new", result: path.join(run, "a.json"), frames: "none" });
  assert.ok(res.ok, res.errors.join("\n"));
  deq(boards()[0].transform.position.value, [700, 600]);
  res = runApply(ctx, { preset: path.join(tmp, "p.json"), mode: "new", result: path.join(run, "b.json"), frames: "none", position: [300, 400] });
  deq(boards()[0].transform.position.value, [300, 400]);
  res = runApply(ctx, { preset: path.join(tmp, "p.json"), mode: "new", result: path.join(run, "c.json"), frames: "none", position: null });
  deq(boards()[0].transform.position.value, [960, 540]);
  sfs(["set", "p.json", "layout.position="]);
});
