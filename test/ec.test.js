/*
 * EffectCraft 後端：tools/ec.js（sfs.js ec）、src/ae.js 偵測到 EffectCraft 時的相容處理、tools/build.js 的禁用方法檢查。
 * 不需要真的 EffectCraft：用模擬 AE 的 EffectCraft 模式和假的 effectcraft-cli（test/fake_effectcraft.js）。
 */
"use strict";
const os = require("os");
const cp = require("child_process");
const H = require("./helpers");
const { fs, path, vm, assert, test, deq, near, newContext, loadSrc, ROOT, SYMBOL_DIR } = H;
const EC = require("../tools/ec.js");
const { checkForbidden } = require("../tools/build.js");

console.log("EffectCraft 後端（tools/ec.js + 模擬 EffectCraft）");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sfs-ec-"));

// ---------------- 建置檢查 ----------------
test("build：src/ 不能用 substr（EffectCraft 沒有 String.prototype.substr）", () => {
  assert.throws(() => checkForbidden("var a = 1;\nvar b = s.substr(1, 2);", "src/x.js"), /src\/x\.js:2 .*substr.*substring/);
  assert.throws(() => checkForbidden("var b = s[\"substr\"](1);", "src/x.js"), /substr/);
  checkForbidden("// s.substr(1)\n/* x.substr */ var b = \"substr\"; var c = s.substring(1); var d = o.substrate;", "src/x.js");
  fs.readdirSync(path.join(ROOT, "src")).forEach((f) => checkForbidden(fs.readFileSync(path.join(ROOT, "src", f), "utf8"), f));
});

// ---------------- 模擬 EffectCraft 建置 ----------------
function ecSetup(flavor, overrides) {
  const ctx = newContext({ effectcraft: flavor === undefined ? true : flavor });
  const S = loadSrc(ctx);
  const main = ctx.app.project.items.addComp("Main", 1080, 1920, 1, 10, 30);
  ctx.app.project.activeItem = main;
  const cfg = H.sampleConfig(S, (c) => {
    c.symbols.forEach((s) => { s.path = path.join(SYMBOL_DIR, s.name + ".png"); });
    if (overrides) overrides(c);
  });
  return { ctx, S, app: ctx.app, main, cfg };
}
const byName = (comp, name) => comp._layers.find((l) => l.name === name);
const groupsOf = (layer) => layer._contents.children.map((c) => c.name);
const kids = (layer, group) => layer._contents.children.find((c) => c.name === group).children[0].children;
const leaf = (node, mn) => node.children.find((c) => c.matchName === mn).prop;
const LINES = [
  { pattern: "2,2,2,2,2", count: 3, shows: "0.3+1.2", color: "#00FF00" },
  { pattern: "1,0,3,0,1", count: 3, shows: "0.3+1.2", color: "", boxOnly: true },
];

test("偵測 EffectCraft：看 app.version 和 app.run", () => {
  assert.strictEqual(ecSetup().S.ae.isEffectCraft(), true);
  assert.strictEqual(ecSetup(false).S.ae.isEffectCraft(), false);
});

test("EffectCraft：連線用 shape.newPath 畫線（路徑、筆畫、Trim、框格子）", () => {
  const env = ecSetup(true, (c) => { c.lines = LINES; });
  const out = env.S.ae.build(env.cfg, {});
  deq(out.errors, []);
  assert.ok(!out.warnings.some((w) => /連線/.test(w)), out.warnings.join("\n"));
  const line = byName(out.boardComp, "Line 1"), pl = out.plan.lines[0];
  deq(groupsOf(line), ["Line", "Boxes"]);
  const runs = env.app.__runs.filter((r) => r.id === "shape.newPath");
  assert.strictEqual(runs.length, 1, "box-only line draws no path");
  assert.strictEqual(runs[0].params.comp, out.boardComp.id);
  assert.strictEqual(runs[0].params.layer, line.id);
  assert.strictEqual(runs[0].params.space, "layer");
  const items = kids(line, "Line");
  deq(items.map((c) => c.matchName), ["ADBE Vector Shape - Group", "ADBE Vector Graphic - Stroke", "ADBE Vector Filter - Trim"]);
  const shape = leaf(items[0], "ADBE Vector Shape").value;
  deq(shape.vertices, pl.points);
  assert.strictEqual(shape.closed, false);
  deq(leaf(items[1], "ADBE Vector Stroke Color").value, [0, 1, 0, 1]);
  assert.strictEqual(leaf(items[1], "ADBE Vector Stroke Width").value, env.cfg.lineStyle.width);
  const te = leaf(items[2], "ADBE Vector Trim End");
  near(te.valueAtTime(pl.shows[0].start), 0);
  near(te.valueAtTime(pl.shows[0].start + env.cfg.lineStyle.drawTime), 100);
  deq(groupsOf(byName(out.boardComp, "Highlight 2")), ["Boxes"]);
});

test("EffectCraft：畫不出線時警告並略過畫線，盤面照樣建好", () => {
  const env = ecSetup("nopath", (c) => { c.lines = LINES; });
  const out = env.S.ae.build(env.cfg, {});
  deq(out.errors, []);
  const warn = out.warnings.find((w) => /EffectCraft/.test(w));
  assert.ok(warn && /第 1 條/.test(warn) && /unknown command shape\.newPath/.test(warn), out.warnings.join("\n"));
  const line = byName(out.boardComp, "Line 1");
  deq(groupsOf(line), ["Boxes"]);
  near(line.transform.opacity.valueAtTime(out.plan.lines[0].shows[0].start + 0.1), 100);
  assert.ok(byName(out.boardComp, "Highlight 2"));
});

test("EffectCraft：巢狀合成動態模糊要把外層開關都打開；AE 不變", () => {
  let env = ecSetup(true, (c) => { c.spin.shutterAngle = 270; });
  let out = env.S.ae.build(env.cfg, {});
  deq(out.errors, []);
  const reels = (o) => o.boardComp._layers.filter((l) => /^Reel /.test(l.name));
  assert.strictEqual(reels(out).length, 5);
  assert.ok(reels(out).every((l) => l.motionBlur), "reel layers");
  assert.ok(out.boardLayer.motionBlur, "board layer");
  assert.ok(env.main.motionBlur && out.boardComp.motionBlur, "target + board comp");
  assert.strictEqual(out.boardComp.shutterAngle, 270);
  assert.strictEqual(out.boardComp.shutterPhase, -135);
  // 關掉動態模糊：不碰使用者的目標合成
  env = ecSetup(true, (c) => { c.spin.motionBlur = false; });
  out = env.S.ae.build(env.cfg, {});
  assert.ok(reels(out).every((l) => !l.motionBlur) && !out.boardLayer.motionBlur && !env.main.motionBlur);
  // AE：只開預組合自己的開關，外層不動
  env = ecSetup(false);
  out = env.S.ae.build(env.cfg, {});
  deq(out.errors, []);
  assert.ok(reels(out).every((l) => !l.motionBlur) && !out.boardLayer.motionBlur && !env.main.motionBlur);
  assert.ok(out.boardComp.motionBlur && reels(out)[0].source.motionBlur);
});

test("EffectCraft：盤面合成不會因為和資料夾同名被改名；改名時用實際名稱", () => {
  const env = ecSetup();
  const a = env.S.ae.build(env.cfg, {});
  const b = env.S.ae.build(env.cfg, {});
  assert.strictEqual(a.boardComp.name, "SFS_Board_01");
  assert.strictEqual(b.boardComp.name, "SFS_Board_02");
  [a, b].forEach((o) => {
    assert.strictEqual(o.boardComp.parentFolder.name, o.boardComp.name);
    const rcs = env.app.project._items.filter((it) => it.comment === "SFS_REEL" && it.parentFolder === o.boardComp.parentFolder);
    deq(rcs.map((c) => c.name).sort(), [1, 2, 3, 4, 5].map((n) => o.boardComp.name + "_R" + n));
  });
  // 模擬 EffectCraft 還是改了名：轉輪合成跟著實際名稱
  const items = env.app.project.items, addComp = items.addComp;
  items.addComp = (name, ...rest) => addComp(/^SFS_Board_\d+$/.test(name) ? name + " x" : name, ...rest);
  const c = env.S.ae.build(env.cfg, {});
  assert.strictEqual(c.boardComp.name, "SFS_Board_03 x");
  assert.ok(env.app.project._items.some((it) => it.name === "SFS_Board_03 x_R1"));
});

// ---------------- 合併腳本 ----------------
function runCombined(env, job) {
  const code = EC.makeScript(job, fs.readFileSync(EC.APPLY_JSX, "utf8"));
  env.ctx.$.global = env.ctx;
  env.ctx.__output = [];
  vm.runInContext(code, env.ctx, { filename: "apply_ec.jsx" });
  return { code, res: EC.extractResult(env.ctx.__output.join("\n")) };
}

test("合併腳本：工作參數 + 套用腳本、全 ASCII、不用 $.evalFile、writeLn 回傳結果、不寫檔", () => {
  const env = ecSetup(true, (c) => { c.lines = LINES; });
  let exported = 0;
  env.main.saveFrameToPng = () => { exported++; };
  const job = { config: JSON.parse(JSON.stringify(env.cfg)), base: SYMBOL_DIR, mode: "auto", comp: "Main", board: "",
    frames: "auto", position: [540, 1434], print: true, result: "", framesDir: "" };
  const { code, res } = runCombined(env, job);
  assert.ok(!/[^\x00-\x7f]/.test(code), "ASCII only");
  assert.ok(!/\$\.evalFile/.test(code));
  assert.ok(/^\/\/ SlotFakeSpin job for EffectCraft/.test(code));
  assert.ok(res && res.ok, JSON.stringify(res));
  assert.strictEqual(res.mode, "new");
  assert.strictEqual(res.target, "Main");
  assert.strictEqual(res.board, "SFS_Board_01");
  deq(res.position, [540, 1434]);
  deq(res.targetSize, [1080, 1920]);
  assert.strictEqual(res.targetDuration, 10);
  assert.strictEqual(res.fps, 30);
  assert.ok(res.shots.length >= 8 && res.shots.some((s) => s.label === "SPINNING") && res.shots.some((s) => /^LINE 1/.test(s.label)));
  deq(res.frames, []);
  assert.strictEqual(exported, 0, "no saveFrameToPng");
  const layer = env.main._layers.find((l) => l.source === env.app.project._items.find((it) => it.name === res.board));
  deq(layer.transform.position.value, [540, 1434]);
  // 再跑一次 auto：更新同一個盤面，沒給位置就不動
  env.main._layers[0].transform.position.setValue([100, 200]);
  const again = runCombined(env, Object.assign({}, job, { position: null })).res;
  assert.strictEqual(again.mode, "update");
  deq(again.position, [100, 200]);
  // 錯誤也用 SFS_RESULT 回報
  const bad = runCombined(env, Object.assign({}, job, { comp: "Nope" })).res;
  assert.ok(!bad.ok && /Nope/.test(bad.errors[0]));
});

// ---------------- CLI 輸出解析 / 素材 ----------------
test("解析 CLI 輸出：單行 JSON、render 的進度文字 + JSON、SFS_RESULT、錯誤格式", () => {
  deq(EC.parseCliJson('{"ok":true,"output":"x"}\n'), { ok: true, output: "x" });
  deq(EC.parseCliJson("MG → out.mp4 (1080×1920)\ndone: MG in 0.6s\n{\"rendered\":[{\"comp\":\"MG\"}]}\n"), { rendered: [{ comp: "MG" }] });
  assert.strictEqual(EC.parseCliJson("effectcraft-cli: crash"), null);
  assert.strictEqual(EC.parseCliJson(""), null);
  const r = EC.extractResult('hello\nSFS_RESULT {"ok":false}\nSFS_RESULT {"ok":true,"board":"SFS_Board_01"}\n');
  deq(r, { ok: true, board: "SFS_Board_01" });
  assert.strictEqual(EC.extractResult("no result"), null);
  assert.strictEqual(EC.describeError({ file: "apply_ec.jsx", line: 12, column: 3, message: "boom" }), "boom（apply_ec.jsx line 12:3）");
  assert.strictEqual(EC.describeError("no active composition"), "no active composition");
});

test("素材：判斷是否在專案資料夾內；--copy-assets 複製並改寫路徑（同名不同檔加編號）", () => {
  const proj = path.join(tmp, "assets", "proj"), other = path.join(tmp, "assets", "other");
  fs.mkdirSync(path.join(proj, "symbols"), { recursive: true });
  fs.mkdirSync(other, { recursive: true });
  assert.ok(EC.isInside(proj, path.join(proj, "symbols", "A.png")));
  assert.ok(!EC.isInside(proj, path.join(tmp, "assets", "proj2", "A.png")));
  assert.ok(!EC.isInside(proj, proj));
  const cfg = H.SFS.normalizeConfig(H.sampleConfig(H.SFS));
  cfg.symbols.forEach((s) => { s.path = path.join(SYMBOL_DIR, s.name + ".png"); });
  fs.copyFileSync(path.join(SYMBOL_DIR, "K.png"), path.join(other, "A.png"));
  cfg.symbols[1].path = path.join(other, "A.png"); // K 用另一個資料夾裡也叫 A.png 的檔案
  cfg.frame.source = "custom";
  cfg.frame.path = path.join(proj, "symbols", "frame.png");
  const refs = EC.assetRefs(cfg);
  assert.strictEqual(refs.length, cfg.symbols.length + 1);
  const outside = refs.filter((r) => !EC.isInside(proj, r.get()));
  assert.strictEqual(outside.length, cfg.symbols.length);
  const copied = EC.copyAssets(outside, proj, "p");
  assert.strictEqual(copied.length, cfg.symbols.length);
  assert.strictEqual(cfg.symbols[0].path, path.join(proj, "sfs_assets", "p", "A.png"));
  assert.strictEqual(cfg.symbols[1].path, path.join(proj, "sfs_assets", "p", "A_2.png"));
  assert.ok(fs.readFileSync(cfg.symbols[1].path).equals(fs.readFileSync(path.join(SYMBOL_DIR, "K.png"))));
  assert.ok(cfg.symbols.every((s) => EC.isInside(proj, s.path) && fs.existsSync(s.path)));
  // 再複製一次：同內容的檔案直接沿用
  cfg.symbols[0].path = path.join(SYMBOL_DIR, "A.png");
  EC.copyAssets(EC.assetRefs(cfg).slice(0, 1), proj, "p");
  assert.strictEqual(cfg.symbols[0].path, path.join(proj, "sfs_assets", "p", "A.png"));
  assert.strictEqual(fs.readdirSync(path.join(proj, "sfs_assets", "p")).length, cfg.symbols.length, "A, A_2 (K), Q, J, WILD, SCATTER, SEVEN");
});

// ---------------- sfs.js ec（假的 effectcraft-cli） ----------------
const SFS_CLI = path.join(ROOT, "tools", "sfs.js");
const FAKE = path.join(__dirname, "fake_effectcraft.js");
const LOG = path.join(tmp, "calls.log");
function sfsEC(args, extraEnv, expectFail) {
  if (fs.existsSync(LOG)) fs.unlinkSync(LOG);
  const env = Object.assign({}, process.env, { SFS_EC: FAKE, FAKE_EC_LOG: LOG }, extraEnv || {});
  const r = cp.spawnSync(process.execPath, [SFS_CLI, "ec"].concat(args), { cwd: tmp, encoding: "utf8", env });
  const text = r.stdout + r.stderr;
  if (!expectFail && r.status !== 0) throw new Error("sfs ec " + args.join(" ") + " failed:\n" + text);
  if (expectFail && r.status === 0) throw new Error("sfs ec " + args.join(" ") + " should fail:\n" + text);
  return text;
}
const calls = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const argOf = (call, k) => call[call.indexOf("--" + k) + 1];

// 案子資料夾：設定檔 + 符號 + 假的 EffectCraft 專案（1080×1920 的 MG）
const job = path.join(tmp, "job");
fs.mkdirSync(path.join(job, "symbols"), { recursive: true });
fs.readdirSync(SYMBOL_DIR).forEach((f) => fs.copyFileSync(path.join(SYMBOL_DIR, f), path.join(job, "symbols", f)));
const preset = H.SFS.normalizeConfig(H.sampleConfig(H.SFS, (c) => { c.lines = LINES; c.spin.startTime = 0.5; }));
preset.symbols.forEach((s) => { s.path = "symbols/" + s.name + ".png"; });
fs.writeFileSync(path.join(job, "p.json"), JSON.stringify(preset, null, 2));
const PROJ = path.join(job, "mg.ecproj");
const FAKE_PROJ = JSON.stringify({ fake: "effectcraft", comps: [{ name: "MG", width: 1080, height: 1920, duration: 8, fps: 30 }], saves: 0 });
fs.writeFileSync(PROJ, FAKE_PROJ);
const readProj = (f) => JSON.parse(fs.readFileSync(f || PROJ, "utf8"));

test("sfs ec：建立盤面、標記、檢查畫面、影片、--pos；先存暫存檔再取代專案並備份", () => {
  const out = sfsEC(["job/p.json", "--project", "job/mg.ecproj", "--comp", "MG", "--pos", "540,1434", "--render", "out/v.mp4", "--out", "run1"]);
  assert.ok(/✓ 已建立 SFS_Board_01（合成 MG，位置 540,1434）/.test(out), out);
  assert.ok(/0\.50s +f15 +SPIN/.test(out) && /R5 STOP/.test(out) && /LINE 1/.test(out), out);
  const res = JSON.parse(fs.readFileSync(path.join(tmp, "run1", "result.json"), "utf8"));
  assert.ok(res.ok);
  deq(res.position, [540, 1434]);
  assert.ok(res.frames.length >= 8 && res.frames.every((f) => f.file && fs.existsSync(f.file)), JSON.stringify(res.frames));
  assert.ok(res.frames.every((f) => path.dirname(f.file) === path.join(tmp, "run1", "frames")));
  assert.ok(fs.existsSync(path.join(tmp, "out", "v.mp4")));
  // 呼叫順序與參數：script（另存暫存檔）→ render-frame × N → render
  const c = calls();
  assert.strictEqual(c[0][0], "script");
  assert.strictEqual(argOf(c[0], "project"), PROJ);
  const tmpProj = argOf(c[0], "save-as");
  assert.strictEqual(path.dirname(tmpProj), job);
  assert.ok(/\.sfs-tmp\.ecproj$/.test(tmpProj) && !fs.existsSync(tmpProj), "temp project renamed away");
  assert.ok(c[0].indexOf("--json") > 0);
  const script = fs.readFileSync(c[0][1], "utf8");
  assert.ok(!/[^\x00-\x7f]/.test(script) && !/\$\.evalFile/.test(script));
  const frames = c.filter((x) => x[0] === "render-frame");
  assert.strictEqual(frames.length, res.frames.length);
  frames.forEach((f) => {
    assert.strictEqual(argOf(f, "comp"), "MG");
    assert.ok(path.isAbsolute(argOf(f, "out")));
    assert.strictEqual(argOf(f, "project"), PROJ);
  });
  const render = c.find((x) => x[0] === "render");
  assert.strictEqual(argOf(render, "format"), "h264");
  assert.strictEqual(argOf(render, "out"), path.join(tmp, "out", "v.mp4"));
  assert.strictEqual(Number(argOf(render, "start")), 0);
  near(Number(argOf(render, "end")), Math.min(8, res.endTime + 0.6), 1e-9);
  // 專案已取代、原檔有備份
  assert.strictEqual(readProj().saves, 1);
  assert.ok(readProj().created.indexOf("SFS_Board_01") >= 0);
  assert.strictEqual(fs.readFileSync(path.join(tmp, "run1", "before.ecproj"), "utf8"), FAKE_PROJ);
  fs.writeFileSync(PROJ, FAKE_PROJ);
});

test("sfs ec：--save-as 另存、--frames none、--range、腳本收到的設定（絕對路徑、清掉 AE 項目 ID）", () => {
  const p = JSON.parse(fs.readFileSync(path.join(job, "p.json"), "utf8"));
  p.symbols[0].itemId = 123;
  fs.writeFileSync(path.join(job, "p2.json"), JSON.stringify(p));
  sfsEC(["job/p2.json", "--project", "job/mg.ecproj", "--save-as", "job/mg_out.ecproj", "--comp", "MG", "--frames", "none",
    "--render", "out/v.webm", "--range", "0.5,3", "--out", "run2"]);
  assert.strictEqual(readProj().saves, 0, "original untouched");
  assert.strictEqual(readProj(path.join(job, "mg_out.ecproj")).saves, 1);
  assert.ok(!fs.existsSync(path.join(tmp, "run2", "before.ecproj")));
  const c = calls();
  assert.strictEqual(c.filter((x) => x[0] === "render-frame").length, 0);
  const render = c.find((x) => x[0] === "render");
  deq([argOf(render, "format"), argOf(render, "start"), argOf(render, "end"), argOf(render, "project")], ["webm", "0.5", "3", path.join(job, "mg_out.ecproj")]);
  const code = fs.readFileSync(c[0][1], "utf8");
  const sent = vm.runInNewContext(code.slice(0, code.indexOf(";\n/*")) + "; $.global.SFS_APPLY", { $: { global: {} } });
  assert.ok(sent.print && sent.config && !sent.preset && sent.result === "" && sent.frames === "none");
  assert.ok(sent.config.symbols.every((s) => s.itemId === 0 && s.path === path.join(job, "symbols", s.name + ".png")));
});

test("sfs ec：素材在專案資料夾外 → 說清楚哪些檔案；--copy-assets 複製進去後成功", () => {
  const p = JSON.parse(fs.readFileSync(path.join(job, "p.json"), "utf8"));
  p.symbols.forEach((s) => { s.path = path.join(SYMBOL_DIR, s.name + ".png"); });
  fs.writeFileSync(path.join(tmp, "outside.json"), JSON.stringify(p));
  const err = sfsEC(["outside.json", "--project", "job/mg.ecproj", "--comp", "MG", "--out", "run3"], {}, true);
  assert.ok(/只能讀專案資料夾裡的檔案/.test(err) && /符號 SEVEN：/.test(err) && /--copy-assets/.test(err), err);
  assert.strictEqual(calls().length, 0, "EffectCraft not called");
  const out = sfsEC(["outside.json", "--project", "job/mg.ecproj", "--comp", "MG", "--frames", "none", "--copy-assets", "--out", "run3"]);
  assert.ok(/已把 7 個素材複製到/.test(out), out);
  assert.ok(fs.existsSync(path.join(job, "sfs_assets", "outside", "SEVEN.png")));
  const code = fs.readFileSync(calls()[0][1], "utf8");
  assert.ok(code.indexOf(JSON.stringify(path.join(job, "sfs_assets", "outside", "SEVEN.png")).slice(1, -1)) >= 0);
  // 使用者的設定檔不改
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(tmp, "outside.json"), "utf8")).symbols[0].path, path.join(SYMBOL_DIR, "A.png"));
  fs.writeFileSync(PROJ, FAKE_PROJ);
});

test("sfs ec：失敗時不動專案（找不到合成 / 腳本錯誤），暫存檔刪掉", () => {
  let err = sfsEC(["job/p.json", "--project", "job/mg.ecproj", "--comp", "Nope", "--out", "run4"], {}, true);
  assert.ok(/專案沒有修改/.test(err) && /Nope/.test(err), err);
  assert.strictEqual(readProj().saves, 0);
  assert.ok(!fs.readdirSync(job).some((f) => /sfs-tmp/.test(f)));
  err = sfsEC(["job/p.json", "--project", "job/mg.ecproj", "--comp", "MG", "--out", "run4"], { FAKE_EC_THROW: "1" }, true);
  assert.ok(/執行腳本失敗（專案沒有修改）/.test(err) && /boom/.test(err), err);
  assert.strictEqual(readProj().saves, 0);
  assert.ok(!fs.readdirSync(job).some((f) => /sfs-tmp/.test(f)));
});

test("sfs ec：新專案先存空專案再開啟（--empty 的腳本不能讀檔）；參數檢查；--dry-run 不執行", () => {
  const out = sfsEC(["job/p.json", "--project", "job/new.ecproj", "--frames", "none", "--out", "run5"]);
  assert.ok(/建立新專案/.test(out) && /合成 SFS_Main_01/.test(out), out);
  const c = calls();
  deq(c[0].slice(0, 5), ["script", "--eval", "0", "--empty", "--save-as"]);
  assert.strictEqual(argOf(c[1], "project"), argOf(c[0], "save-as"));
  assert.ok(c[1].indexOf("--save") > 0);
  assert.ok(readProj(path.join(job, "new.ecproj")).created.indexOf("SFS_Main_01") >= 0);
  assert.ok(/不要指定 --comp/.test(sfsEC(["job/p.json", "--project", "job/new2.ecproj", "--comp", "MG"], {}, true)));
  assert.ok(/--project/.test(sfsEC(["job/p.json"], {}, true)));
  assert.ok(/--pos 格式/.test(sfsEC(["job/p.json", "--project", "job/mg.ecproj", "--pos", "540"], {}, true)));
  assert.ok(/影片格式/.test(sfsEC(["job/p.json", "--project", "job/mg.ecproj", "--render", "v.avi"], {}, true)));
  const dry = sfsEC(["job/p.json", "--project", "job/mg.ecproj", "--comp", "MG", "--dry-run", "--out", "run6"]);
  assert.ok(/工作腳本/.test(dry) && /script/.test(dry), dry);
  assert.strictEqual(calls().length, 0);
  assert.ok(fs.existsSync(path.join(tmp, "run6", "apply_ec.jsx")));
});
