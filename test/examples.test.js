/*
 * examples/：範例設定檔與 examples/cases/ 的實際案例都要能讀、驗證通過、算得出計畫
 * （案例的符號圖不在 repo 裡，這裡只檢查設定本身）
 */
"use strict";
const H = require("./helpers");
const { fs, path, assert, test, deq, ROOT, SFS } = H;

console.log("examples/（範例與實際案例）");

const CASES = path.join(ROOT, "examples", "cases");

function presets() {
  const out = [path.join(ROOT, "examples", "freegame.json")];
  for (const d of fs.readdirSync(CASES)) {
    const dir = path.join(CASES, d);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir)) if (/^preset.*\.json$/.test(f)) out.push(path.join(dir, f));
  }
  return out;
}

test("每個範例 / 案例設定檔：驗證通過、算得出計畫、符號用相對路徑", () => {
  const files = presets();
  assert.ok(files.length >= 5, "found " + files.length);
  for (const f of files) {
    const cfg = SFS.normalizeConfig(JSON.parse(fs.readFileSync(f, "utf8")));
    const rel = path.relative(ROOT, f);
    deq(SFS.validateConfig(cfg), [], rel);
    const plan = SFS.computePlan(cfg, cfg.layout.newCompFps || 30);
    deq(plan.errors, [], rel);
    assert.ok(plan.endTime > plan.startTime, rel + " has a timeline");
    cfg.symbols.forEach((s) => assert.ok(!s.path || !SFS.isAbsolutePath(s.path), rel + " absolute path " + s.path));
  }
});

test("案例：彩金滾輪的種子讓 MEGA 停在結果正下方；祿盤 4 回合到全滿", () => {
  for (const f of ["preset.json", "preset_drum.json"]) {
    const cfg = SFS.normalizeConfig(JSON.parse(fs.readFileSync(path.join(CASES, "fortunedoors-jackpot-wheel", f), "utf8")));
    const strip = SFS.computePlan(cfg, 30).reels[0].strip;
    assert.strictEqual(strip[2].kind, "end", f);
    assert.strictEqual(strip[2].name, "MAJOR", f);
    assert.strictEqual(strip[3].name, "MEGA", f + ": MEGA right below the result");
  }
  const hs = SFS.normalizeConfig(JSON.parse(fs.readFileSync(path.join(CASES, "fortunedoors-prosperity-holdspin", "preset.json"), "utf8")));
  assert.strictEqual(hs.mode, "holdspin");
  const plan = SFS.computePlan(hs, 30);
  assert.strictEqual(plan.rounds.length, 4);
  assert.ok(plan.markers.some((m) => /HS FULL/.test(m.label)), "ends full");
});

test("案例：腳本和說明裡沒有本機路徑", () => {
  const bad = /[A-Za-z]:[\\/](Users|AEPlugin)|Downloads|yichonezhu/;
  for (const d of fs.readdirSync(CASES)) {
    const dir = path.join(CASES, d);
    const files = fs.statSync(dir).isDirectory() ? fs.readdirSync(dir).map((f) => path.join(dir, f)) : [dir];
    for (const f of files) {
      if (!/\.(py|jsx|json|md)$/.test(f)) continue;
      assert.ok(!bad.test(fs.readFileSync(f, "utf8")), path.relative(ROOT, f) + " contains a local path");
    }
  }
});
