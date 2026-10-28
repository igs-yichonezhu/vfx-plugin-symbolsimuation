/*
 * 交付 .aep：sfs.js ae --new-project / --save-aep 的工作參數，以及 aep-kit（在 AE 一鍵重建的資料夾）
 * kit 的 build_aep.jsx 在模擬 AE 裡實際執行：開新專案、建主合成、背景 / 最上層圖、額外腳本、存檔
 */
"use strict";
const os = require("os");
const cp = require("child_process");
const H = require("./helpers");
const { fs, path, vm, assert, test, deq, newContext, ROOT } = H;
const acorn = require("acorn");

console.log("交付 .aep（ae --new-project、aep-kit）");

const SFS_CLI = path.join(ROOT, "tools", "sfs.js");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sfs-aepkit-"));
const PRESET = path.join(ROOT, "examples", "freegame.json");
const sfs = (args) => cp.spawnSync("node", [SFS_CLI].concat(args), { encoding: "utf8" });
const bg = path.join(tmp, "bg.png"), top = path.join(tmp, "frame_top.png"), post = path.join(tmp, "post.jsx");
fs.writeFileSync(bg, "PNG");
fs.writeFileSync(top, "PNG");
// 額外腳本：用 SFS_BUILD 拿到盤面合成，留下記號
fs.writeFileSync(post, "// 盤面建好後執行\n$.global.POST_RAN = $.global.SFS_BUILD.board.name + \"|\" + $.global.SFS_BUILD.target.name;\n");

test("ae --dry-run：--new-project / --main / --bg / --top / --post / --save-aep 寫進啟動腳本", () => {
  const out = path.join(tmp, "dry");
  const r = sfs(["ae", PRESET, "--comp", "Promo", "--main", "1280x720@6@24", "--bg", bg, "--top", top, "--post", post,
    "--save-aep", path.join(tmp, "out.aep"), "--out", out, "--dry-run"]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(/新專案：主合成 Promo 1280x720，6 秒，24fps/.test(r.stdout), r.stdout);
  const launch = fs.readFileSync(path.join(out, "launch.jsx"), "utf8");
  const job = JSON.parse(/SFS_APPLY = ([\s\S]*?);\n\$\.evalFile/.exec(launch)[1]);
  assert.strictEqual(job.newProject, true);
  assert.strictEqual(job.mode, "new");
  deq(job.mainComp, { name: "Promo", width: 1280, height: 720, duration: 6, fps: 24 });
  deq(job.layers.map((l) => [l.at, path.basename(l.file)]), [["bottom", "bg.png"], ["top", "frame_top.png"]]);
  assert.ok(path.isAbsolute(job.postScripts[0]) && path.isAbsolute(job.saveAs));
  // 沒給 --main：預設 1920x1080、長度 = 演出結束 + 1 秒
  const r2 = sfs(["ae", PRESET, "--new-project", "--out", path.join(tmp, "dry2"), "--dry-run"]);
  assert.ok(/新專案：主合成 Main 1920x1080，\d+ 秒，30fps/.test(r2.stdout), r2.stdout);
  assert.strictEqual(sfs(["ae", PRESET, "--main", "big", "--dry-run", "--out", path.join(tmp, "dry3")]).status, 1);
});

function makeKit(name, extra) {
  const kit = path.join(tmp, name);
  const r = sfs(["aep-kit", PRESET, "--out", kit, "--comp", "Main", "--main", "1280x720@8", "--bg", bg, "--top", top, "--post", post, "--name", "Demo"].concat(extra || []));
  assert.strictEqual(r.status, 0, r.stderr);
  return kit;
}

test("aep-kit：素材進 assets（數字結尾各自一個資料夾）、設定改相對路徑、build_aep.jsx 全 ASCII 且符合 ES3", () => {
  const kit = makeKit("kit1");
  for (const f of ["preset.json", "SlotFakeSpin_apply.jsx", "build_aep.jsx", "說明.txt", "post.jsx", "assets/bg.png", "assets/frame_top.png"]) {
    assert.ok(fs.existsSync(path.join(kit, f)), f);
  }
  const cfg = JSON.parse(fs.readFileSync(path.join(kit, "preset.json"), "utf8"));
  cfg.symbols.forEach((s) => {
    assert.ok(!path.isAbsolute(s.path) && fs.existsSync(path.join(kit, s.path)), s.path);
    assert.strictEqual(s.itemId, 0);
  });
  const script = fs.readFileSync(path.join(kit, "build_aep.jsx"), "utf8");
  assert.ok(!/[^\x00-\x7f]/.test(script), "ASCII");
  acorn.parse(script, { ecmaVersion: 3 });
  assert.ok(/"saveAs": "Demo\.aep"/.test(script));
  // 已經有東西的資料夾：要 --force
  assert.strictEqual(sfs(["aep-kit", PRESET, "--out", kit]).status, 1);
});

// 在模擬 AE 執行 kit 的 build_aep.jsx（$.evalFile 用 vm 實作）
function runKit(kit, ctx) {
  ctx.$.global = ctx;
  ctx.$.fileName = path.join(kit, "build_aep.jsx");
  ctx.$.evalFile = (f) => vm.runInContext(fs.readFileSync(f.fsName, "utf8"), ctx, { filename: path.basename(f.fsName) });
  vm.runInContext(fs.readFileSync(ctx.$.fileName, "utf8"), ctx, { filename: "build_aep.jsx" });
  return ctx.SFS_APPLY_RESULT;
}

test("aep-kit：在 AE 執行 build_aep.jsx → 新專案、主合成、背景在最底、上層圖在最上、執行額外腳本、存成 .aep", () => {
  const kit = makeKit("kit2");
  const ctx = newContext();
  const oldProject = ctx.app.project;
  oldProject.items.addComp("Old", 100, 100, 1, 1, 30);
  const res = runKit(kit, ctx);
  deq(res.errors, []);
  assert.ok(res.ok);
  assert.notStrictEqual(ctx.app.project, oldProject, "new project");
  const main = ctx.app.project._items.find((it) => it.name === "Main");
  assert.ok(main && main.width === 1280 && main.height === 720 && main.duration === 8);
  const names = main._layers.map((l) => l.name);
  assert.strictEqual(names[0], "frame_top", names.join(","));
  assert.strictEqual(names[names.length - 1], "BG", names.join(","));
  assert.ok(main._layers.some((l) => l.comment === "SFS_BOARD"), "board layer");
  assert.ok(/^SFS_Board_01\|Main$/.test(ctx.POST_RAN), String(ctx.POST_RAN));
  assert.strictEqual(path.basename(res.saved), "Demo.aep");
  assert.ok(fs.existsSync(path.join(kit, "Demo.aep")));
  assert.ok(ctx.__alerts.some((a) => /已存成 .*Demo\.aep/.test(a)), ctx.__alerts.join("|"));
});

test("aep-kit：使用者取消「關閉目前專案」→ 不建立、不存檔，跳出原因", () => {
  const kit = makeKit("kit3");
  const ctx = newContext();
  ctx.__keepProject = true;
  const res = runKit(kit, ctx);
  assert.ok(!res.ok);
  assert.ok(/無法開新專案/.test(res.errors[0]), res.errors[0]);
  assert.ok(!fs.existsSync(path.join(kit, "Demo.aep")));
  assert.ok(ctx.__alerts.some((a) => /失敗/.test(a)));
});

test("aep-kit：缺素材時說清楚是哪個檔案", () => {
  const r = sfs(["aep-kit", PRESET, "--out", path.join(tmp, "kit4"), "--bg", path.join(tmp, "nope.png")]);
  assert.strictEqual(r.status, 1);
  assert.ok(/找不到圖檔.*nope\.png/.test(r.stderr), r.stderr);
});

test("aep-kit：--post 用 examples/cases 的滾筒腳本 → 第 1 輪符號圖層加上表達式與亮度特效", () => {
  const drum = path.join(ROOT, "examples", "cases", "fortunedoors-jackpot-wheel", "drum_prism.jsx");
  const kit = path.join(tmp, "kit-drum");
  const r = sfs(["aep-kit", PRESET, "--out", kit, "--main", "1920x1080@8", "--post", drum, "--name", "Drum"]);
  assert.strictEqual(r.status, 0, r.stderr);
  const ctx = newContext();
  const res = runKit(kit, ctx);
  deq(res.errors, []);
  const r1 = ctx.app.project._items.find((it) => /_R1$/.test(it.name));
  const syms = r1._layers.filter((l) => l.name !== "STRIP_CTRL");
  assert.ok(syms.length > 5);
  syms.forEach((l) => {
    assert.ok(/STRIP_CTRL/.test(l.transform.position.expression), l.name + " position expression");
    assert.ok(/Math\.cos/.test(l.transform.scale.expression), l.name + " scale expression");
  });
  assert.ok(fs.existsSync(path.join(kit, "Drum.aep")));
});
