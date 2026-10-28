#!/usr/bin/env node
/*
 * 假的 effectcraft-cli（測試 tools/sfs.js ec 用；SFS_EC 指到這個 .js 時 sfs.js 會用 node 執行它）。
 * 腳本在模擬 AE 的 EffectCraft 模式裡真的執行；專案檔是假的 JSON：{ fake: "effectcraft", comps: [{ name, width, height, duration, fps }], saves }。
 * 跟真的 CLI 一樣：輸出一行 JSON、腳本出錯時 exit 1 但仍會存檔、render 先印進度文字。
 * 環境變數：FAKE_EC_LOG = 記錄每次呼叫的參數（一行一個 JSON）；FAKE_EC_THROW = 1 讓腳本執行完後丟錯。
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const argv = process.argv.slice(2);
if (process.env.FAKE_EC_LOG) fs.appendFileSync(process.env.FAKE_EC_LOG, JSON.stringify(argv) + "\n");

function opt(name) {
  const i = argv.indexOf("--" + name);
  return i >= 0 ? argv[i + 1] : undefined;
}
function out(obj, code) {
  process.stdout.write(JSON.stringify(obj) + "\n");
  process.exit(code || 0);
}
function readProject(file) {
  const p = JSON.parse(fs.readFileSync(file, "utf8"));
  if (p.fake !== "effectcraft") throw new Error("not a fake project");
  return p;
}

const cmd = argv[0];
if (cmd === "script") {
  const projFile = opt("project");
  let proj;
  try { proj = projFile ? readProject(projFile) : { fake: "effectcraft", comps: [], saves: 0 }; } catch (e) { out({ error: "cannot read " + projFile + ": " + e.message }, 1); }
  const H = require("./helpers");
  const ctx = H.newContext({ effectcraft: true });
  const app = ctx.app;
  proj.comps.forEach((c) => app.project.items.addComp(c.name, c.width, c.height, 1, c.duration, c.fps));
  app.project.activeItem = app.project._items[0] || null;
  ctx.$.global = ctx;
  let error = null;
  try {
    if (opt("eval") !== undefined) vm.runInContext(opt("eval"), ctx, { filename: "eval" });
    else vm.runInContext(fs.readFileSync(argv[1], "utf8"), ctx, { filename: path.basename(argv[1]) });
    if (process.env.FAKE_EC_THROW) throw new Error("boom");
  } catch (e) {
    error = { file: argv[1] ? path.basename(argv[1]) : "eval", line: 1, column: 1, message: e.message };
  }
  // 真的 CLI 出錯時也會存檔
  const saveTo = opt("save-as") || (argv.indexOf("--save") >= 0 ? projFile : "");
  if (saveTo) {
    const comps = app.project._items.filter((it) => it instanceof ctx.CompItem && proj.comps.every((c) => c.name !== it.name));
    const saved = Object.assign({}, proj, { saves: proj.saves + 1, created: (proj.created || []).concat(comps.map((c) => c.name)) });
    fs.writeFileSync(saveTo, JSON.stringify(saved));
  }
  out({ error, ok: !error, output: (ctx.__output || []).join("\n"), result: null, saved: saveTo || undefined }, error ? 1 : 0);
} else if (cmd === "render-frame" || cmd === "render") {
  const proj = readProject(opt("project"));
  const comp = opt("comp");
  if (!proj.comps.concat((proj.created || []).map((n) => ({ name: n }))).some((c) => c.name === comp)) {
    out({ error: "no composition \"" + comp + "\" (see get_project)" }, 1);
  }
  const file = opt("out");
  if (!path.isAbsolute(file)) out({ error: "fake: --out must be absolute (relative paths resolve against the project folder)" }, 1);
  if (cmd === "render-frame") {
    fs.writeFileSync(file, "PNG " + comp + " @" + opt("time"));
    out({ comp: 1, path: file, time: Number(opt("time")), width: 1080, height: 1920 });
  }
  fs.writeFileSync(file, "VIDEO " + opt("format") + " " + opt("start") + "-" + opt("end"));
  process.stdout.write(comp + " → " + file + " (fake)\n");
  out({ rendered: [{ comp, output: file, seconds: 0.1 }] });
} else {
  out({ error: "fake effectcraft-cli: unsupported " + cmd }, 1);
}
