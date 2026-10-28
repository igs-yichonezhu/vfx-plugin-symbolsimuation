/*
 * Hold & Spin 重轉模式（cfg.mode = "holdspin"）：盤面 / 回合文字、推演（鎖定、次數）、每格轉動計畫、
 * 模擬 AE 建置（每回合停妥時畫面上的符號、鎖住的格子不動、標記時間）、命令列、套用腳本與 EffectCraft 後端。
 */
"use strict";
const os = require("os");
const cp = require("child_process");
const H = require("./helpers");
const { fs, path, vm, assert, test, deq, near, newContext, loadSrc, ROOT, SYMBOL_DIR, SFS } = H;
const EC = require("../tools/ec.js");

console.log("Hold & Spin 重轉");

const NAMES = ["A", "BAR", "BELL", "CHERRY", "J", "K", "Q", "SCATTER", "SEVEN", "WILD"];
// 仿 D_210 祿盤：3 欄 × 2 列，右邊一欄一開始就鎖住，4 回合：落 2 顆 → 落 1 顆 → 落空（期待）→ 最後一格（期待）全滿
const START = "- - SEVEN / - - BAR";
const ROUNDS = "@3 - BELL - / A - -\n@6.7 K - - / - - -\n@9.25 - - - / - - -\n@12.2 - - - / - Q -";

function hsConfig(S, overrides, symbols) {
  const cfg = S.defaultConfig();
  cfg.symbols = symbols || NAMES.map((n) => ({ name: n, path: "", itemId: 0, filler: n !== "SCATTER" }));
  cfg.mode = "holdspin";
  Object.assign(cfg.layout, { reels: 3, rows: 2, cellW: 200, cellH: 200, gapX: 20, gapY: 20, margin: 40 });
  Object.assign(cfg.hs, { blank: "CHERRY", startSpins: 1, rounds: ROUNDS });
  const st = S.hs.parseBoard(START, 3, 2, NAMES, "CHERRY").board;
  cfg.startBoard = st.map((col) => col.map((v) => v || "CHERRY"));
  if (overrides) overrides(cfg);
  return S.normalizeConfig(cfg);
}

// 時間 t 時，格子裡停在視窗正中的符號（不在格線上 = null）
function cellSymbolAt(S, plan, cell, t) {
  const y = cell.keys.length ? H.propFromKeys(cell.keys).valueAtTime(t) : cell.startY;
  const k = -y / plan.pitch;
  return Math.abs(k - Math.round(k)) < 1e-6 ? cell.strip[Math.round(k)].name : null;
}

// ---------------------------------------------------------------- core
test("盤面文字：/ 分列、一行寫滿、- 和空格符號都是空格、錯誤訊息", () => {
  const P = SFS.hs.parseBoard;
  deq(P("- - SEVEN / - a BAR", 3, 2, NAMES, "CHERRY").board, [["", ""], ["", "A"], ["SEVEN", "BAR"]]);
  deq(P("- . SEVEN cherry A BAR", 3, 2, NAMES, "CHERRY").board, [["", ""], ["", "A"], ["SEVEN", "BAR"]]);
  deq(P("A, -, K\n-, Q, -", 3, 2, NAMES, "CHERRY").board, [["A", ""], ["", "Q"], ["K", ""]]);
  assert.ok(/要有 6 格/.test(P("A A", 3, 2, NAMES, "CHERRY").errors[0]));
  assert.ok(/第 2 列要有 3 格，目前有 2 格/.test(P("A A A / A A", 3, 2, NAMES, "CHERRY").errors[0]));
  assert.ok(/要有 2 列/.test(P("A / A / A", 3, 2, NAMES, "CHERRY").errors[0]));
  assert.ok(/第 1 列第 2 欄：找不到符號「NOPE」/.test(P("A NOPE A / - - -", 3, 2, NAMES, "CHERRY").errors[0]));
  assert.strictEqual(SFS.hs.boardText([["A", ""], ["", "Q"], ["K", ""]], 2), "A - K / - Q -");
});

test("回合文字：@秒、; 分隔、# 註解；整理回去每行一回合", () => {
  const cfg = hsConfig(SFS, (c) => { c.hs.rounds = "# 註解\n@3 - BELL - / A - -; K - - / - - -\n\n@0.5 - - - - Q -"; });
  const res = SFS.hs.parseRounds(cfg);
  deq(res.errors, []);
  deq(res.rounds.map((r) => r.at), [3, null, 0.5]);
  deq(res.rounds[2].board, [["", ""], ["", "Q"], ["", ""]]);
  assert.strictEqual(SFS.hs.roundsText(res.rounds, 2), "@3 - BELL - / A - -\nK - - / - - -\n@0.5 - - - / - Q -");
  const bad = SFS.hs.parseRounds(hsConfig(SFS, (c) => { c.hs.rounds = "@x - - - / - - -\n- - - / - NOPE -"; }));
  assert.ok(/第 1 回合：時間格式/.test(bad.errors[0]) && /第 2 回合：第 2 列第 2 欄：找不到符號「NOPE」/.test(bad.errors[1]), bad.errors.join("\n"));
});

test("推演：次數用掉 1、落下重設、全滿結束；鎖住的格子寫同符號可以、換符號是錯誤", () => {
  const sim = SFS.hs.simulate(hsConfig(SFS));
  deq(sim.errors, []);
  deq(sim.warnings, []);
  deq(sim.rounds.map((r) => r.spin.length), [4, 2, 1, 1]);
  deq(sim.rounds.map((r) => r.locks), [2, 1, 0, 1]);
  deq(sim.rounds.map((r) => [r.spinsLeft, r.spinsAfter]), [[0, 3], [2, 3], [2, 2], [1, 3]]);
  deq(sim.rounds.map((r) => r.end), ["", "", "", "full"]);
  // 停格順序 col：一欄一欄、上到下
  deq(sim.rounds[0].spin.map((s) => [s[0], s[1]]), [[0, 0], [0, 1], [1, 0], [1, 1]]);
  deq(sim.board, [["K", "A"], ["BELL", "Q"], ["SEVEN", "BAR"]]);
  deq(sim.finalBoard, sim.board);
  // 累積寫法（每回合寫出整個盤面）結果一樣
  const cum = SFS.hs.simulate(hsConfig(SFS, (c) => {
    c.hs.rounds = "@3 - BELL SEVEN / A - BAR\n@6.7 K BELL - / A - -\n@9.25 K BELL SEVEN / A - BAR\n@12.2 - - - / - Q -";
  }));
  deq(cum.errors, []);
  deq(cum.board, sim.board);
  const bad = SFS.hs.simulate(hsConfig(SFS, (c) => { c.hs.rounds = "- - J / - - -"; }));
  assert.ok(/第 1 回合：第 1 列第 3 欄已經鎖住「SEVEN」，不能換成「J」/.test(bad.errors[0]), bad.errors[0]);
});

test("推演：次數用完結束、結束後還有回合是錯誤、沒結束是警告、沒有空格 / 沒有回合", () => {
  const out = SFS.hs.simulate(hsConfig(SFS, (c) => { c.hs.startSpins = 3; c.hs.rounds = "-;-;-".replace(/-/g, "- - - / - - -"); }));
  deq(out.errors, []);
  deq(out.rounds.map((r) => r.spinsLeft), [2, 1, 0]);
  assert.strictEqual(out.ended, "out");
  deq(out.finalBoard, [["CHERRY", "CHERRY"], ["CHERRY", "CHERRY"], ["SEVEN", "BAR"]]);
  const more = SFS.hs.simulate(hsConfig(SFS, (c) => { c.hs.startSpins = 1; c.hs.rounds = "- - - / - - -\nA A - / A A -"; }));
  assert.ok(/第 2 回合：Hold & Spin 在第 1 回合已經結束（次數用完）/.test(more.errors[0]), more.errors[0]);
  const open = SFS.hs.simulate(hsConfig(SFS, (c) => { c.hs.rounds = "A - - / - - -"; }));
  deq(open.errors, []);
  assert.ok(/最後一回合（第 1 回合）後還剩 3 次/.test(open.warnings[0]), open.warnings[0]);
  const full = SFS.hs.simulate(hsConfig(SFS, (c) => { c.startBoard = [["A", "A"], ["A", "A"], ["A", "A"]]; }));
  assert.ok(/起始盤面已經沒有空格/.test(full.errors[0]));
  assert.ok(/還沒有設定回合/.test(SFS.hs.simulate(hsConfig(SFS, (c) => { c.hs.rounds = ""; })).errors[0]));
});

test("驗證：空格符號、次數、轉速、起始盤面；轉輪專用的檢查不套用", () => {
  deq(SFS.validateConfig(hsConfig(SFS, (c) => { c.reels = []; c.endBoard = []; })), []);
  assert.ok(SFS.validateConfig(hsConfig(SFS, (c) => { c.hs.blank = ""; })).some((e) => /請設定空格符號/.test(e)));
  assert.ok(SFS.validateConfig(hsConfig(SFS, (c) => { c.hs.blank = "NOPE"; })).some((e) => /空格符號「NOPE」不在符號庫裡/.test(e)));
  assert.ok(SFS.validateConfig(hsConfig(SFS, (c) => { c.hs.spins = 0; })).some((e) => /至少要 1/.test(e)));
  assert.ok(SFS.validateConfig(hsConfig(SFS, (c) => { c.hs.speed = 0; })).some((e) => /hs\.speed/.test(e)));
  assert.ok(SFS.validateConfig(hsConfig(SFS, (c) => { c.startBoard[0][0] = "NOPE"; })).some((e) => /起始盤面/.test(e)));
  // 設定檔正規化：mode / hs 欄位
  const n = SFS.normalizeConfig({ mode: "weird", hs: { order: "zigzag", spins: "2.6", blank: " B " } });
  assert.strictEqual(n.mode, "reels");
  assert.strictEqual(n.hs.order, "col");
  assert.strictEqual(n.hs.spins, 3);
  assert.strictEqual(n.hs.blank, "B");
});

test("轉動計畫：每回合停妥時畫面上的符號正確、回合之間與鎖住後不動、一開始鎖住的格子沒有關鍵影格", () => {
  const cfg = hsConfig(SFS);
  const plan = SFS.computePlan(cfg, 30);
  deq(plan.errors, []);
  deq(plan.warnings, []);
  assert.strictEqual(plan.mode, "holdspin");
  assert.strictEqual(plan.boardW, 3 * 200 + 2 * 20 + 80);
  assert.strictEqual(plan.boardH, 2 * 200 + 20 + 80);
  assert.strictEqual(plan.cells.length, 6);
  const byTag = {};
  plan.cells.forEach((c) => { byTag[c.tag] = c; });
  deq([byTag["1-1"].x, byTag["1-1"].y], [140, 140]);
  deq([byTag["2-3"].x, byTag["2-3"].y], [40 + 2 * 220 + 100, 40 + 220 + 100]);
  // 一開始就鎖住：沒有關鍵影格、一直是起始符號
  ["1-3", "2-3"].forEach((t) => {
    assert.strictEqual(byTag[t].keys.length, 0);
    assert.strictEqual(byTag[t].lockRound, 0);
    [0, 5, 14.5].forEach((tt) => assert.strictEqual(cellSymbolAt(SFS, plan, byTag[t], tt), byTag[t].start));
  });
  // 每回合停妥：畫面上是推演出來的符號；到下一回合起轉前都不動
  const expect = { "1-1": ["CHERRY", "K"], "1-2": ["BELL"], "2-1": ["A"], "2-2": ["CHERRY", "CHERRY", "CHERRY", "Q"] };
  Object.keys(expect).forEach((t) => {
    const c = byTag[t];
    deq(c.spins.map((s) => s.result), expect[t], t);
    assert.strictEqual(cellSymbolAt(SFS, plan, c, 0), "CHERRY", t + " starts blank");
    c.spins.forEach((sp, k) => {
      assert.strictEqual(cellSymbolAt(SFS, plan, c, sp.settle), sp.result, t + " spin " + k);
      assert.strictEqual(cellSymbolAt(SFS, plan, c, sp.start), k ? c.spins[k - 1].result : "CHERRY", t + " before spin " + k);
      assert.strictEqual(cellSymbolAt(SFS, plan, c, (sp.start + sp.stop) / 2), null, t + " spinning " + k);
      const next = c.spins[k + 1];
      const holdEnd = next ? next.start : plan.endTime + 1;
      [0.25, 0.5, 0.75].forEach((f) => near(H.propFromKeys(c.keys).valueAtTime(sp.settle + (holdEnd - sp.settle) * f), sp.endY, 1e-6, t + " holds"));
    });
    // 鎖住之後就不再轉
    const last = c.spins[c.spins.length - 1];
    if (last.lock) {
      assert.strictEqual(c.lockRound, last.round + 1);
      assert.ok(c.keys[c.keys.length - 1].t <= last.settle + 1e-9, t + " no keys after lock");
    }
  });
  assert.strictEqual(byTag["1-2"].spins.length, 1, "1-2 locked in round 1, never spins again");
  // 最後盤面
  deq(plan.board, [["K", "A"], ["BELL", "Q"], ["SEVEN", "BAR"]]);
  deq(plan.cells.map((c) => c.final), ["K", "BELL", "SEVEN", "A", "Q", "BAR"]);
  // 等速段的實際速度接近 hs.speed（等比例微調）
  const c22 = byTag["2-2"];
  c22.spins.forEach((sp) => near(sp.speed / plan.pitch, cfg.hs.speed, cfg.hs.speed * 0.15));
  const v = H.speedAt(H.propFromKeys(c22.keys), (c22.spins[0].start + c22.spins[0].decelStart) / 2 + 0.1);
  near(v / plan.pitch, c22.spins[0].speed / plan.pitch, 0.01, "constant speed segment");
});

test("時間與標記：@秒、停格順序 col、期待格（多轉 + 繞框）、鎖住跳動、全滿", () => {
  const cfg = hsConfig(SFS);
  const plan = SFS.computePlan(cfg, 30), H2 = cfg.hs, f = (t) => Math.round(t * 30) / 30;
  deq(plan.rounds.map((r) => r.start), [3, 6.7, f(9.25), 12.2].map(f));
  const r1 = plan.rounds[0];
  deq(r1.cells.map((i) => plan.cells[i].tag), ["1-1", "2-1", "1-2", "2-2"]);
  r1.cells.forEach((i, k) => near(plan.cells[i].spins[0].stop, f(3 + H2.firstStop + k * H2.stagger), 1e-9));
  deq(plan.rounds.map((r) => r.ant), [false, false, true, true]);
  const r3 = plan.rounds[2], c22 = plan.cells[4];
  near(c22.spins[2].stop, f(r3.start + H2.firstStop + cfg.spin.antTime), 1e-9, "anticipation adds antTime");
  deq(plan.frames.map((fr) => [fr.name, fr.cell]), [["Frame C2-2", 4], ["Frame C2-2", 4]]);
  near(plan.frames[0].start, f(r3.start + cfg.spin.windupTime + cfg.spin.accelTime), 1e-9);
  near(plan.frames[0].end, f(c22.spins[2].settle + cfg.frame.hold), 1e-9);
  deq([plan.frames[0].w, plan.frames[0].h], [200 + 2 * cfg.frame.pad, 200 + 2 * cfg.frame.pad]);
  deq(plan.pulses.map((p) => [plan.cells[p.cell].tag, p.name]), [["2-1", "A"], ["1-2", "BELL"], ["1-1", "K"], ["2-2", "Q"]]);
  near(plan.pulses[3].t, c22.spins[3].settle, 1e-9);
  near(plan.endTime, plan.pulses[3].t + 0.32, 1e-9);
  const at = (label) => plan.markers.find((m) => m.label.split(" / ").indexOf(label) >= 0);
  deq(plan.markers.map((m) => m.label), [
    "HS START", "HS ROUND 1 / HS SPINS 0", "HS CELL 1-1 STOP", "HS CELL 2-1 LOCK A / HS SPINS 3", "HS CELL 1-2 LOCK BELL",
    "HS CELL 2-2 STOP", "HS ROUND 2 / HS SPINS 2", "HS CELL 1-1 LOCK K / HS SPINS 3", "HS CELL 2-2 STOP",
    "HS ROUND 3 / HS SPINS 2", "HS CELL 2-2 FRAME", "HS CELL 2-2 STOP", "HS ROUND 4 / HS SPINS 1", "HS CELL 2-2 FRAME",
    "HS CELL 2-2 LOCK Q / HS SPINS 3", "HS FULL / ALL SETTLED"]);
  near(at("HS ROUND 2").t, 6.7, 1e-9);
  near(at("HS CELL 2-1 LOCK A").t, plan.cells[3].spins[0].stop, 1e-9);
  near(at("HS FULL").t, plan.rounds[3].settle, 1e-9);
  near(plan.allSettled, plan.rounds[3].settle, 1e-9);
  // 檢查畫面
  deq(SFS.hs.shots(plan).map((s) => s.label), ["HS START", "ROUND 1 SPINNING", "ROUND 1 SETTLED", "ROUND 2 SPINNING", "ROUND 2 SETTLED",
    "ROUND 3 SPINNING", "ROUND 3 SETTLED", "ROUND 4 SPINNING", "ROUND 4 SETTLED / FULL"]);
  near(SFS.hs.shots(plan, 2)[0].t, 2, 1e-9);
});

test("時間：沒寫 @秒 就接在上一回合停妥 + roundGap；順序 row / all；期待格關掉；向上轉", () => {
  const cfg = hsConfig(SFS, (c) => {
    c.hs.rounds = ROUNDS.replace(/@[\d.]+ /g, "");
    c.hs.order = "row"; c.hs.antCells = 0; c.hs.lockPulse = 100; c.spin.startTime = 0.5; c.spin.direction = "up";
  });
  const plan = SFS.computePlan(cfg, 30);
  deq(plan.errors, []);
  near(plan.rounds[0].start, 0.5, 1e-9);
  for (let k = 1; k < 4; k++) near(plan.rounds[k].start, Math.round((plan.rounds[k - 1].settle + cfg.hs.roundGap) * 30) / 30, 1e-9);
  deq(plan.rounds[0].cells.map((i) => plan.cells[i].tag), ["1-1", "1-2", "2-1", "2-2"]);
  deq(plan.frames, []);
  deq(plan.pulses, []);
  assert.ok(plan.rounds.every((r) => !r.ant));
  plan.cells.forEach((c) => c.spins.forEach((sp) => assert.strictEqual(cellSymbolAt(SFS, plan, c, sp.settle), sp.result)));
  assert.ok(plan.cells[0].keys[1].y < plan.cells[0].keys[0].y || plan.cells[0].keys[2].y < plan.cells[0].keys[0].y, "moves up");
  const all = SFS.computePlan(hsConfig(SFS, (c) => { c.hs.order = "all"; }), 30);
  const stops = all.rounds[0].cells.map((i) => all.cells[i].spins[0].stop);
  assert.ok(stops.every((s) => Math.abs(s - stops[0]) < 1e-9), "all stop together");
});

test("錯誤：回合開始時上一回合還沒停妥、停得太早；連線會被略過", () => {
  const early = SFS.computePlan(hsConfig(SFS, (c) => { c.hs.rounds = ROUNDS.replace("@6.7", "@3.5"); }), 30);
  assert.ok(early.errors.some((e) => /第 2 回合開始得太早：格子 1-1（列-欄）在 [\d.]+ 秒才停妥/.test(e)), early.errors.join("\n"));
  const short = SFS.computePlan(hsConfig(SFS, (c) => { c.hs.firstStop = 0.1; }), 30);
  assert.ok(short.errors.some((e) => /第 1 回合格子 1-1 停得太早/.test(e)), short.errors.join("\n"));
  const lines = SFS.computePlan(hsConfig(SFS, (c) => { c.lines = [{ pattern: "1,1,1", count: 3, shows: "0.3+1" }]; }), 30);
  assert.ok(/不畫連線/.test(lines.warnings[0]));
  assert.strictEqual(SFS.computePlan(hsConfig(SFS), 0).errors.length, 1);
});

// ---------------------------------------------------------------- 模擬 AE
function aeSetup(opts) {
  const ctx = newContext(opts);
  const S = loadSrc(ctx);
  const main = ctx.app.project.items.addComp("Main", 1920, 1080, 1, 20, 30);
  ctx.app.project.activeItem = main;
  const res = S.ae.importFolder(new ctx.Folder(SYMBOL_DIR));
  const cfg = hsConfig(S, null, res.symbols.map((s) => ({ name: s.name, path: s.path, itemId: s.item.id, filler: s.name !== "SCATTER" })));
  return { ctx, S, app: ctx.app, main, cfg };
}

// 格子合成在時間 t 正中的符號（用模擬 AE 的 Bezier 內插）
function visibleInCell(cellComp, t) {
  const ctrl = cellComp._layers.find((l) => l.name === "STRIP_CTRL");
  const ny = ctrl.transform.property("ADBE Position_1").valueAtTime(t);
  const hits = cellComp._layers.filter((l) => l.parent === ctrl && Math.abs(ny + l.transform.position.value[1] - cellComp.height / 2) < 0.01);
  assert.ok(hits.length <= 1);
  return hits.length ? hits[0].source.name.replace(/\.png$/, "") : null;
}

test("AE 建立：格子合成、位置、標記、每回合停妥時的符號、鎖住的格子不動、鎖住跳動、期待格繞框、讀回設定", () => {
  const env = aeSetup();
  const out = env.S.ae.build(env.cfg, {});
  deq(out.errors, []);
  assert.strictEqual(env.app._undo, 0, "undo group balanced");
  const board = out.boardComp, plan = out.plan;
  assert.strictEqual(board.width, plan.boardW);
  assert.strictEqual(board.height, plan.boardH);
  const cells = board._layers.filter((l) => /^Cell /.test(l.name));
  deq(cells.map((l) => l.name), ["Cell 1-1", "Cell 1-2", "Cell 1-3", "Cell 2-1", "Cell 2-2", "Cell 2-3"]);
  cells.forEach((l, i) => {
    const cpl = plan.cells[i];
    deq(l.transform.position.value, [cpl.x, cpl.y]);
    assert.strictEqual(l.source.width, 200);
    assert.strictEqual(l.source.height, 200);
    assert.strictEqual(l.source.comment, "SFS_REEL");
    assert.strictEqual(l.source.name, board.name + "_C" + cpl.tag);
    assert.strictEqual(l.source.parentFolder.id, board.parentFolder.id);
    assert.ok(l.source.motionBlur);
    // 每回合停妥的那一刻、和下一回合起轉前：畫面上是推演的符號
    assert.strictEqual(visibleInCell(l.source, 0), cpl.start, cpl.tag + " start");
    cpl.spins.forEach((sp, k) => {
      assert.strictEqual(visibleInCell(l.source, sp.settle), sp.result, cpl.tag + " round " + (sp.round + 1));
      const next = cpl.spins[k + 1];
      assert.strictEqual(visibleInCell(l.source, next ? next.start : 19.9), sp.result, cpl.tag + " holds");
    });
    assert.strictEqual(visibleInCell(l.source, 19.9), cpl.final);
  });
  // 鎖住的格子：鎖住後 STRIP_CTRL 不再有關鍵影格
  const y11 = cells[0].source._layers.find((l) => l.name === "STRIP_CTRL").transform.property("ADBE Position_1");
  assert.ok(y11.keys[y11.keys.length - 1].t <= plan.cells[0].spins[1].settle + 1e-9);
  const y13 = cells[2].source._layers.find((l) => l.name === "STRIP_CTRL").transform.property("ADBE Position_1");
  assert.strictEqual(y13.keys.length, 0, "locked from the start: no keys");
  // 轉帶圖層名稱：C列-欄_S起始 / H回合 / F填充 / B緩衝
  const names22 = cells[4].source._layers.map((l) => l.name);
  assert.ok(names22.indexOf("C2-2_S01_CHERRY") >= 0 && names22.indexOf("C2-2_H04_Q") >= 0 && names22.some((n) => /^C2-2_F\d+_/.test(n)), names22.slice(0, 5).join(","));
  assert.strictEqual(cells[4].source._layers.find((l) => l.name === "C2-2_H04_Q").label, 1);
  // 標記
  const marks = out.boardLayer.property("ADBE Marker").keys;
  deq(marks.map((k) => k.v.comment), plan.markers.map((m) => "SFS " + m.label));
  near(marks.find((k) => k.v.comment === "SFS HS ROUND 2 / HS SPINS 2").t, 6.7, 1e-9);
  near(marks.find((k) => /HS CELL 2-2 LOCK Q/.test(k.v.comment)).t, plan.cells[4].spins[3].stop, 1e-9);
  // 鎖住跳動：停妥那一刻放大再縮回
  const pulses = board._layers.filter((l) => /^Lock /.test(l.name));
  deq(pulses.map((l) => l.name).sort(), ["Lock 1-1_K", "Lock 1-2_BELL", "Lock 2-1_A", "Lock 2-2_Q"]);
  const pq = pulses.find((l) => l.name === "Lock 2-2_Q"), t0 = plan.cells[4].spins[3].settle;
  near(pq.inPoint, t0, 1e-9);
  near(pq.outPoint, t0 + 0.32, 1e-9);
  const base = pq.transform.scale.valueAtTime(t0)[0];
  near(pq.transform.scale.valueAtTime(t0 + 0.1)[0], base * 1.15, 1e-6);
  near(pq.transform.scale.valueAtTime(t0 + 0.32)[0], base, 1e-6);
  deq(pq.transform.position.value, [plan.cells[4].x, plan.cells[4].y]);
  // 期待格繞框
  const frames = board._layers.filter((l) => /^Frame /.test(l.name));
  assert.strictEqual(frames.length, 2);
  assert.ok(frames.every((l) => l.name === "Frame C2-2"));
  const rect = frames[0]._contents.children.find((c) => c.name === "Frame").children[0].children.find((c) => c.matchName === "ADBE Vector Shape - Rect");
  deq(rect.children.find((c) => c.matchName === "ADBE Vector Rect Size").prop.value, [200 + 2 * env.cfg.frame.pad, 200 + 2 * env.cfg.frame.pad]);
  deq(rect.children.find((c) => c.matchName === "ADBE Vector Rect Position").prop.value, [plan.cells[4].x, plan.cells[4].y]);
  // 讀回設定
  const back = env.S.ae.readBoardConfig(out.boardLayer);
  assert.strictEqual(back.mode, "holdspin");
  assert.strictEqual(back.hs.rounds, env.cfg.hs.rounds);
});

test("AE 更新：重建時刪掉舊的格子合成；改成轉輪模式也能更新同一個盤面", () => {
  const env = aeSetup();
  const out = env.S.ae.build(env.cfg, {});
  deq(out.errors, []);
  const cellComps = () => env.app.project._items.filter((it) => it.comment === "SFS_REEL");
  assert.strictEqual(cellComps().length, 6);
  env.cfg.hs.rounds = "@1 A A - / A A -";
  const again = env.S.ae.build(env.cfg, { boardLayer: out.boardLayer });
  deq(again.errors, []);
  assert.strictEqual(cellComps().length, 6, "old cell comps removed");
  assert.ok(env.S.ae.readBoardConfig(out.boardLayer).hs.rounds === "@1 A A - / A A -");
  const reels = H.sampleConfig(env.S, (c) => { c.symbols = env.cfg.symbols; c.layout.margin = 40; });
  const back = env.S.ae.build(reels, { boardLayer: out.boardLayer });
  deq(back.errors, []);
  assert.strictEqual(cellComps().length, 5);
  assert.ok(back.boardComp._layers.every((l) => !/^Cell /.test(l.name)));
});

test("EffectCraft：格子圖層也打開動態模糊開關", () => {
  const env = aeSetup({ effectcraft: true });
  const out = env.S.ae.build(env.cfg, {});
  deq(out.errors, []);
  const cells = out.boardComp._layers.filter((l) => /^Cell /.test(l.name));
  assert.strictEqual(cells.length, 6);
  assert.ok(cells.every((l) => l.motionBlur) && out.boardLayer.motionBlur);
});

test("套用腳本（dist）：Hold & Spin 的檢查畫面與回合摘要", () => {
  const env = aeSetup({ effectcraft: true });
  const job = { config: JSON.parse(JSON.stringify(env.cfg)), base: SYMBOL_DIR, mode: "new", comp: "Main", board: "",
    frames: "auto", position: null, print: true, result: "", framesDir: "" };
  const code = EC.makeScript(job, fs.readFileSync(EC.APPLY_JSX, "utf8"));
  env.ctx.$.global = env.ctx;
  env.ctx.__output = [];
  vm.runInContext(code, env.ctx, { filename: "apply_ec.jsx" });
  const res = EC.extractResult(env.ctx.__output.join("\n"));
  assert.ok(res && res.ok, JSON.stringify(res && res.errors));
  deq(res.shots.map((s) => s.label), ["HS START", "ROUND 1 SPINNING", "ROUND 1 SETTLED", "ROUND 2 SPINNING", "ROUND 2 SETTLED",
    "ROUND 3 SPINNING", "ROUND 3 SETTLED", "ROUND 4 SPINNING", "ROUND 4 SETTLED / FULL"]);
  deq(res.rounds.map((r) => [r.round, r.cells, r.locks.map((l) => l.cell + " " + l.symbol).join(","), r.spinsLeft, r.spinsAfter, r.end]), [
    [1, 4, "2-1 A,1-2 BELL", 0, 3, ""], [2, 2, "1-1 K", 2, 3, ""], [3, 1, "", 2, 2, ""], [4, 1, "2-2 Q", 1, 3, "full"]]);
  deq(res.finalBoard, [["K", "A"], ["BELL", "Q"], ["SEVEN", "BAR"]]);
  near(res.rounds[1].start, 6.7, 1e-9);
});

// ---------------------------------------------------------------- 命令列
const SFS_CLI = path.join(ROOT, "tools", "sfs.js");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sfs-hs-"));
function sfs(args, expectFail, env) {
  const r = cp.spawnSync(process.execPath, [SFS_CLI].concat(args), { cwd: tmp, encoding: "utf8", env: Object.assign({}, process.env, env || {}) });
  if (!expectFail && r.status !== 0) throw new Error("sfs " + args.join(" ") + " failed:\n" + r.stdout + r.stderr);
  if (expectFail && r.status === 0) throw new Error("sfs " + args.join(" ") + " should fail:\n" + r.stdout);
  return r.stdout + r.stderr;
}
const preset = () => JSON.parse(fs.readFileSync(path.join(tmp, "hs.json"), "utf8"));

test("hs-init：從資料夾建立 / 轉換既有設定檔；找不到空格符號時提示", () => {
  const out = sfs(["hs-init", "--symbols", SYMBOL_DIR, "--out", "hs.json", "--blank", "cherry", "--grid", "3x2", "--cell", "200", "--gap", "20", "--start-spins", "1"]);
  assert.ok(/Hold & Spin：3 欄 × 2 列，格子 200x200，間距 20x20，空格符號 CHERRY，次數 3（開始剩 1）/.test(out), out);
  const p = preset();
  assert.strictEqual(p.mode, "holdspin");
  assert.strictEqual(p.hs.blank, "CHERRY");
  assert.strictEqual(p.hs.startSpins, 1);
  deq(p.startBoard, [["CHERRY", "CHERRY"], ["CHERRY", "CHERRY"], ["CHERRY", "CHERRY"]]);
  assert.ok(/--blank 的「NOPE」不是符號/.test(sfs(["hs-init", "hs.json", "--blank", "NOPE"], true)));
  sfs(["init", "--symbols", SYMBOL_DIR, "--out", "reels.json"]);
  assert.ok(/請用 --blank 指定空格符號/.test(sfs(["hs-init", "reels.json"], true)));
  assert.ok(/改成 Hold & Spin：5 欄 × 3 列/.test(sfs(["hs-init", "reels.json", "--blank", "J"])));
});

test("hs-board：起始盤面、回合（; 分隔 / @檔案 / --add）、推演表；錯誤時不存檔", () => {
  let out = sfs(["hs-board", "hs.json", "--start", START]);
  assert.ok(/還沒有回合/.test(out), out);
  out = sfs(["hs-board", "hs.json", "--rounds", ROUNDS.split("\n").slice(0, 2).join("; ")]);
  assert.ok(/1 +@3 +4 +2-1 A、1-2 BELL +1 → 0 → 3（重設）/.test(out), out);
  fs.writeFileSync(path.join(tmp, "more.txt"), ROUNDS.split("\n").slice(2).join("\n"));
  out = sfs(["hs-board", "hs.json", "--add", "@more.txt"]);
  assert.ok(/4 +@12\.2 +1 +2-2 Q +2 → 1 → 3（重設）　全滿，結束/.test(out), out);
  assert.ok(/最後盤面：\n  K BELL SEVEN\n  A Q BAR/.test(out), out);
  let p = preset();
  assert.strictEqual(p.hs.rounds, ROUNDS);
  deq(p.endBoard, [["K", "A"], ["BELL", "Q"], ["SEVEN", "BAR"]]);
  deq(p.startBoard, [["CHERRY", "CHERRY"], ["CHERRY", "CHERRY"], ["SEVEN", "BAR"]]);
  const err = sfs(["hs-board", "hs.json", "--add", "- - - / - - -"], true);
  assert.ok(/在第 4 回合已經結束（全滿）/.test(err), err);
  assert.ok(/找不到符號「NOPE」/.test(sfs(["hs-board", "hs.json", "--start", "NOPE - - / - - -"], true)));
  assert.strictEqual(preset().hs.rounds, ROUNDS, "unchanged after errors");
});

test("check：回合表、各格停下、文字時間軸、標記；--json；show；set hs.*；轉輪專用指令會擋", () => {
  const out = sfs(["check", "hs.json"]);
  assert.ok(/✓ 設定正確（Hold & Spin 3 欄 × 2 列/.test(out), out);
  assert.ok(/3\* +9\.27 /.test(out) && /2-2 +R1 4\.5s CHERRY/.test(out) && /R4 13\.87s Q 🔒/.test(out), out);
  assert.ok(/C2-2 .*\*.*\|/.test(out) && /C1-3 +#+/.test(out), "timeline");
  assert.ok(/12\.20s +f366 +HS ROUND 4 \/ HS SPINS 1/.test(out) && /HS FULL \/ ALL SETTLED/.test(out), out);
  const r = cp.spawnSync(process.execPath, [SFS_CLI, "check", "hs.json", "--json"], { cwd: tmp, encoding: "utf8" });
  const j = JSON.parse(r.stdout);
  assert.ok(j.ok && j.mode === "holdspin");
  deq(j.rounds.map((x) => x.locks.length), [2, 1, 0, 1]);
  deq(j.finalBoard, [["K", "A"], ["BELL", "Q"], ["SEVEN", "BAR"]]);
  assert.strictEqual(j.cells.find((c) => c.cell === "2-2").spins.length, 4);
  assert.ok(/空格符號：CHERRY/.test(sfs(["show", "hs.json"])));
  assert.ok(/每格間隔 0\.3 順序 row/.test(sfs(["set", "hs.json", "hs.stagger=0.3", "hs.order=row"])));
  assert.strictEqual(preset().hs.order, "row");
  ["reel hs.json 1 stop=2", "regen hs.json", "suggest hs.json", "lines hs.json --detect"].forEach((c) => {
    assert.ok(/只用在轉輪模式/.test(sfs(c.split(" "), true)), c);
  });
  assert.ok(/hs-board/.test(sfs(["board", "hs.json", "--start", "A A A"], true)));
  sfs(["set", "hs.json", "hs.stagger=0.22", "hs.order=col"]);
});

const hasPillow = ["python3", "python"].some((exe) => cp.spawnSync(exe, ["-c", "import PIL"]).status === 0);
test("render --boards / --sheet（需要 Pillow）" + (hasPillow ? "" : "：略過"), () => {
  if (!hasPillow) return;
  const out = sfs(["render", "hs.json", "--boards", "b.png", "--sheet", "k.png", "--scale", "0.25"]);
  assert.ok(/b\.png 5 tiles/.test(out) && /k\.png 9 tiles/.test(out), out);
  assert.ok(fs.statSync(path.join(tmp, "b.png")).size > 1000);
  const scene = require("../tools/sfs.js").sceneFor(H.SFS.normalizeConfig(preset()), 30, [{ t: 4.0, label: "x" }], 1);
  assert.strictEqual(scene.cells.length, 6);
  assert.strictEqual(scene.frames[0].cells.length, 6);
});

test("sfs ec（假的 effectcraft-cli）：Hold & Spin 建立、回合摘要、檢查畫面", () => {
  const job = path.join(tmp, "job");
  fs.mkdirSync(path.join(job, "symbols"), { recursive: true });
  fs.readdirSync(SYMBOL_DIR).forEach((f) => fs.copyFileSync(path.join(SYMBOL_DIR, f), path.join(job, "symbols", f)));
  const p = preset();
  p.symbols.forEach((s) => { s.path = "symbols/" + s.name + ".png"; });
  fs.writeFileSync(path.join(job, "hs.json"), JSON.stringify(p));
  fs.writeFileSync(path.join(job, "p.ecproj"), JSON.stringify({ fake: "effectcraft", comps: [{ name: "MG", width: 1920, height: 1080, duration: 20, fps: 30 }], saves: 0 }));
  const out = sfs(["ec", "job/hs.json", "--project", "job/p.ecproj", "--comp", "MG", "--out", "run"], false, { SFS_EC: path.join(__dirname, "fake_effectcraft.js") });
  assert.ok(/✓ 已建立 SFS_Board_01（合成 MG/.test(out), out);
  assert.ok(/Hold & Spin 回合/.test(out) && /R4 .*鎖住 2-2 Q .*剩 1 → 3　全滿/.test(out), out);
  const res = JSON.parse(fs.readFileSync(path.join(tmp, "run", "result.json"), "utf8"));
  assert.strictEqual(res.frames.length, 9);
  assert.ok(res.frames.every((f) => f.file && fs.existsSync(f.file)));
  // 面額金幣 C200 / C400：EffectCraft 會接成連續圖檔 → 自動複製到各自的資料夾，建置時就沒有警告
  ["C200", "C400"].forEach((n) => fs.copyFileSync(path.join(SYMBOL_DIR, "BELL.png"), path.join(job, "symbols", n + ".png")));
  p.symbols.push({ name: "C200", path: "symbols/C200.png", itemId: 0, filler: true }, { name: "C400", path: "symbols/C400.png", itemId: 0, filler: true });
  p.hs.rounds = "@3 - C200 - / C400 - -";
  fs.writeFileSync(path.join(job, "hs.json"), JSON.stringify(p));
  const out2 = sfs(["ec", "job/hs.json", "--project", "job/p.ecproj", "--comp", "MG", "--mode", "new", "--frames", "none", "--out", "run2"], false, { SFS_EC: path.join(__dirname, "fake_effectcraft.js") });
  assert.ok(/C200\.png、C400\.png 已複製到 .*sfs_assets.*hs 的各自資料夾/.test(out2), out2);
  assert.ok(!/連續圖檔匯入/.test(out2), out2);
  assert.ok(fs.existsSync(path.join(job, "sfs_assets", "hs", "C200", "C200.png")));
});
