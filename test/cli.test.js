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
  const p = preset();
  assert.strictEqual(p.lines.length, 1);
  assert.strictEqual(p.lines[0].shows, "0.3+1.2, 1.6+0.9");
  sfs(["lines", "p.json", "--add", "1,2,3,2,1:3:0.5+1"]);
  assert.strictEqual(preset().lines.length, 2);
  sfs(["lines", "p.json", "--add", "1,2,9,2,1:3"], true);
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

test("apply：沒有工作參數時跳出對話框選設定檔", () => {
  const ctx = newContext();
  ctx.app.project.activeItem = ctx.app.project.items.addComp("Main", 1920, 1080, 1, 12, 30);
  ctx.__dialogResult = new ctx.File(path.join(tmp, "p.json"));
  ctx.$.global = ctx;
  vm.runInContext(fs.readFileSync(path.join(ROOT, "dist", "SlotFakeSpin_apply.jsx"), "utf8"), ctx);
  assert.ok((ctx.__alerts || []).some((a) => /完成/.test(a)), (ctx.__alerts || []).join("\n"));
});
