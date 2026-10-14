/*
 * ae.js：在模擬 AE 中建置，檢查合成結構，並用 Bezier 內插算出每個時間點畫面上的符號
 */
"use strict";
const H = require("./helpers");
const { assert, test, deq, near, newContext, loadSrc, SYMBOL_DIR } = H;

console.log("ae.js（模擬 AE）");

function aeSetup(opts) {
  const ctx = newContext(opts);
  const S = loadSrc(ctx);
  const app = ctx.app;
  const main = app.project.items.addComp("Main", 1920, 1080, 1, 10, 30);
  app.project.activeItem = main;
  return { ctx, S, app, main };
}

function importSamples(env) {
  const res = env.S.ae.importFolder(new env.ctx.Folder(SYMBOL_DIR));
  assert.strictEqual(res.failed.length, 0);
  return res;
}

function cfgFromImport(env, res, overrides) {
  const S = env.S;
  const cfg = S.defaultConfig();
  cfg.symbols = res.symbols.map((s) => ({ name: s.name, path: s.path, itemId: s.item.id, filler: s.name !== "SCATTER" }));
  cfg.startBoard = [["A", "K", "Q"], ["J", "A", "K"], ["Q", "J", "A"], ["K", "Q", "J"], ["A", "BAR", "BELL"]];
  cfg.endBoard = [["WILD", "SEVEN", "SCATTER"], ["SEVEN", "SEVEN", "SEVEN"], ["SCATTER", "WILD", "A"], ["K", "SEVEN", "Q"], ["J", "J", "SEVEN"]];
  cfg.spin.startTime = 2;
  if (overrides) overrides(cfg);
  cfg.reels = S.generateReels(cfg);
  return cfg;
}

// 從建好的合成中讀出某輪在時間 t 的可見符號
function visibleInReel(L, reelComp, t) {
  const ctrl = reelComp._layers.find((l) => l.name === "STRIP_CTRL");
  assert.ok(ctrl, "STRIP_CTRL exists");
  const ny = ctrl.transform.property("ADBE Position_1").valueAtTime(t);
  const nx = ctrl.transform.property("ADBE Position_0").valueAtTime(t);
  const anchor = ctrl.transform.anchorPoint.value;
  const out = [];
  for (let r = 0; r < L.rows; r++) {
    const want = L.peek + r * (L.cellH + L.gapY) + L.cellH / 2;
    const hits = reelComp._layers.filter((l) => {
      if (l.parent !== ctrl) return false;
      const p = l.transform.position.value;
      return Math.abs(ny - anchor[1] + p[1] - want) < 0.01 && Math.abs(nx - anchor[0] + p[0] - L.cellW / 2) < 0.01;
    });
    assert.strictEqual(hits.length, 1, "exactly one symbol in row " + r + " at t=" + t);
    out.push(hits[0].source.name.replace(/\.png$/, ""));
  }
  return out;
}

const reelLayers = (board) => board._layers.filter((l) => /^Reel /.test(l.name));
const byName = (comp, name) => comp._layers.find((l) => l.name === name);

// 形狀圖層內容：依名稱路徑找節點
function shapeNode(layer, pathNames) {
  let n = layer._contents;
  for (const name of pathNames) {
    n = n.children.find((c) => (c.group ? c.name : c.prop.name) === name || c.matchName === name);
    assert.ok(n, "shape node " + pathNames.join(" > "));
  }
  return n;
}
const vectors = (layer, group) => shapeNode(layer, [group, "ADBE Vectors Group"]).children;
const leaf = (node, mn) => node.children.find((c) => c.matchName === mn).prop;

test("匯入資料夾：自然排序、檔名 = 符號名、放進 SFS_Symbols、重複匯入不重複", () => {
  const env = aeSetup();
  const res = importSamples(env);
  deq(res.symbols.map((s) => s.name), ["A", "BAR", "BELL", "CHERRY", "J", "K", "Q", "SCATTER", "SEVEN", "WILD"]);
  const folder = env.S.ae.findFolder("SFS_Symbols", env.S.ae.findFolder("SlotFakeSpin"));
  assert.ok(folder);
  res.symbols.forEach((s) => assert.strictEqual(s.item.parentFolder.id, folder.id));
  const before = env.app.project.numItems;
  const again = importSamples(env);
  assert.strictEqual(env.app.project.numItems, before);
  assert.strictEqual(again.symbols[0].item.id, res.symbols[0].item.id);
});

test("建立假轉：結構、留白、標記、註解、動態模糊、起始 / 結果盤面正確", () => {
  const env = aeSetup();
  const cfg = cfgFromImport(env, importSamples(env));
  const out = env.S.ae.build(cfg, {});
  deq(out.errors, []);
  assert.strictEqual(env.app._undo, 0, "undo group balanced");
  const L = cfg.layout, M = L.margin;
  const board = out.boardComp;
  assert.strictEqual(board.width, 5 * 200 + 4 * 10 + 2 * M);
  assert.strictEqual(board.height, 600 + 2 * M);
  assert.strictEqual(board.numLayers, 5, "no frames / lines by default");
  assert.strictEqual(board.layer(1).name, "Reel 1");
  assert.ok(board.motionBlur);
  assert.strictEqual(out.boardLayer.containingComp, env.main);
  assert.strictEqual(out.boardLayer.comment, "SFS_BOARD");
  const marks = out.boardLayer.property("ADBE Marker").keys.map((k) => k.v.comment);
  deq(marks, ["SFS SPIN", "SFS R1 STOP", "SFS R2 STOP", "SFS R3 STOP", "SFS R4 STOP", "SFS R5 STOP", "SFS ALL SETTLED"]);
  deq(env.S.ae.readBoardConfig(out.boardLayer).endBoard, cfg.endBoard);
  for (let i = 0; i < 5; i++) {
    const rl = board.layer(i + 1), rc = rl.source;
    assert.strictEqual(rc.width, 200);
    assert.strictEqual(rc.height, 600);
    assert.strictEqual(rc.comment, "SFS_REEL");
    assert.ok(rc.motionBlur && rc.hideShyLayers);
    assert.strictEqual(rc.layer(1).name, "STRIP_CTRL");
    deq(rl.transform.position.value, [M + i * 210 + 100, M + 300]);
    const rp = out.plan.reels[i];
    rc._layers.forEach((l) => {
      if (l.nullLayer) return;
      assert.ok(l.motionBlur);
      near(l.outPoint, rc.duration);
      near(l.transform.scale.value[0], 200 / 256 * 100, 1e-9);
    });
    deq(visibleInReel(L, rc, 0), cfg.startBoard[i]);
    deq(visibleInReel(L, rc, 2), cfg.startBoard[i]);
    deq(visibleInReel(L, rc, rp.settleTime), cfg.endBoard[i]);
    deq(visibleInReel(L, rc, 9.9), cfg.endBoard[i]);
    assert.strictEqual(rc.layer(1).source.parentFolder.id, rc.parentFolder.id);
  }
  const rc1 = board.layer(1).source;
  assert.ok(rc1._layers.some((l) => /_S01_A$/.test(l.name) && l.label === 9));
  assert.ok(rc1._layers.some((l) => /_E01_WILD$/.test(l.name) && l.label === 1));
  assert.ok(rc1._layers.filter((l) => /_F\d+_/.test(l.name)).every((l) => l.shy));
});

test("節奏：反向停輪 + 各步轉速 + 起轉間隔反映在合成裡", () => {
  const env = aeSetup();
  const cfg = cfgFromImport(env, importSamples(env), (c) => {
    c.spin.stopOrder = "5,4,3,2,1"; c.spin.startOrder = "1,2,3,4,5"; c.spin.startStagger = 0.1; c.spin.speeds = "12,16,20,24,28";
  });
  const out = env.S.ae.build(cfg, {});
  deq(out.errors, []);
  const stops = out.plan.reels.map((r) => r.stopTime);
  for (let i = 1; i < 5; i++) assert.ok(stops[i] < stops[i - 1], "reel 5 stops first");
  const board = out.boardComp;
  for (let i = 0; i < 5; i++) {
    const rc = board.layer(i + 1).source, rp = out.plan.reels[i];
    const y = rc._layers.find((l) => l.name === "STRIP_CTRL").transform.property("ADBE Position_1");
    near(y.keys[0].t, 2 + i * 0.1, 1e-9, "start stagger");
    deq(visibleInReel(cfg.layout, rc, rp.settleTime), cfg.endBoard[i]);
  }
});

test("繞框（內建）：跑燈群組、Trim 偏移運算式、光暈、淡入淡出、時間", () => {
  const env = aeSetup();
  const cfg = cfgFromImport(env, importSamples(env), (c) => {
    c.spin.antReels = "4,5"; c.frame.color = "#FF0000"; c.frame.laps = 2; c.frame.runner = 30;
  });
  const out = env.S.ae.build(cfg, {});
  deq(out.errors, []);
  const board = out.boardComp;
  assert.strictEqual(board.numLayers, 7);
  const f4 = byName(board, "Frame R4"), f5 = byName(board, "Frame R5");
  assert.ok(f4 && f5);
  assert.ok(f4.index < byName(board, "Reel 1").index, "frames above reels");
  const groups = f4._contents.children.map((c) => c.name);
  deq(groups, ["Runner A", "Runner B", "Frame"]);
  const rect = vectors(f4, "Frame").find((c) => c.matchName === "ADBE Vector Shape - Rect");
  deq(leaf(rect, "ADBE Vector Rect Size").value, [200 + 20, 600 + 20]);
  deq(leaf(rect, "ADBE Vector Rect Position").value, [cfg.layout.margin + 3 * 210 + 100, cfg.layout.margin + 300]);
  const stroke = vectors(f4, "Frame").find((c) => c.matchName === "ADBE Vector Graphic - Stroke");
  deq(leaf(stroke, "ADBE Vector Stroke Color").value, [1, 0, 0, 1]);
  const trimA = vectors(f4, "Runner A").find((c) => c.matchName === "ADBE Vector Filter - Trim");
  const trimB = vectors(f4, "Runner B").find((c) => c.matchName === "ADBE Vector Filter - Trim");
  assert.strictEqual(leaf(trimA, "ADBE Vector Trim End").value, 30);
  assert.strictEqual(leaf(trimA, "ADBE Vector Trim Offset").expression, "time * 360 * 2");
  assert.strictEqual(leaf(trimB, "ADBE Vector Trim Offset").expression, "time * 360 * 2 + 180");
  assert.strictEqual(f4._effects.children[0].matchName, "ADBE Glo2");
  const fp = out.plan.frames[0];
  near(f4.inPoint, fp.start);
  near(f4.outPoint, fp.end + cfg.frame.fade);
  const op = f4.transform.opacity;
  near(op.valueAtTime(fp.start), 0);
  near(op.valueAtTime(fp.start + cfg.frame.fade), 100);
  near(op.valueAtTime((fp.start + fp.end) / 2), 100);
  near(op.valueAtTime(fp.end + cfg.frame.fade), 0);
  // 第 4 輪的繞框從第 3 輪停輪開始、到第 4 輪停妥後結束
  near(fp.start, out.plan.reels[2].stopTime, 1e-9);
  near(fp.end, out.plan.reels[3].settleTime + cfg.frame.hold, 1 / 30);
  const marks = out.boardLayer.property("ADBE Marker").keys.map((k) => k.v.comment);
  assert.ok(marks.indexOf("SFS R3 STOP / R4 FRAME") >= 0, marks.join(" | "));
  assert.ok(marks.indexOf("SFS R4 STOP / R5 FRAME") >= 0, marks.join(" | "));
});

test("繞框（自訂素材）：撐滿轉輪 + 外擴、循環播放、更新盤面時不刪使用者素材", () => {
  const env = aeSetup();
  const res = importSamples(env);
  const art = env.app.project.items.addComp("MyFrameFX", 300, 900, 1, 0.5, 30);
  const cfg = cfgFromImport(env, res, (c) => {
    c.spin.antReels = "5"; c.frame.source = "custom"; c.frame.itemId = art.id; c.frame.itemName = art.name;
  });
  const out = env.S.ae.build(cfg, {});
  deq(out.errors, []);
  const lyr = byName(out.boardComp, "Frame R5");
  assert.strictEqual(lyr.source, art);
  deq(lyr.transform.scale.value, [220 / 300 * 100, 620 / 900 * 100]);
  assert.ok(lyr.timeRemapEnabled, "short comp loops");
  near(lyr.startTime, out.plan.frames[0].start);
  out.boardLayer.selected = true;
  const again = env.S.ae.build(cfg, { boardLayer: out.boardLayer });
  deq(again.errors, []);
  assert.ok(env.app.project._items.indexOf(art) >= 0, "user asset kept after update");
  // 找不到素材時清楚報錯
  cfg.frame.itemId = 987654;
  cfg.frame.itemName = "Gone";
  const bad = env.S.ae.build(cfg, {});
  assert.ok(/繞框素材/.test(bad.errors[0]));
});

test("連線：路徑、畫線 Trim、顯示 / 隱藏、中獎框、符號跳動、標記", () => {
  const env = aeSetup();
  const cfg = cfgFromImport(env, importSamples(env));
  cfg.lines = [
    { pattern: "2,2,2,2,2", count: 3, shows: "0.3+1.2, 2.0+0.8", color: "#00FF00" },
    { pattern: "1,2,3,2,1", count: 4, shows: "0.3+1.2", color: "" },
  ];
  cfg.lineStyle.pulse = 120;
  const out = env.S.ae.build(cfg, {});
  deq(out.errors, []);
  const board = out.boardComp, L = cfg.layout;
  const line1 = byName(board, "Line 1"), line2 = byName(board, "Line 2");
  assert.ok(line1 && line2);
  const pl = out.plan.lines[0];
  // 路徑
  const pathNode = vectors(line1, "Line").find((c) => c.matchName === "ADBE Vector Shape - Group");
  const shape = leaf(pathNode, "ADBE Vector Shape").value;
  assert.strictEqual(shape.closed, false);
  assert.strictEqual(shape.vertices.length, 5 + 2);
  deq(shape.vertices[1], env.S.cellCenter(L, 0, 1));
  // 中獎框只框連到的格子
  assert.strictEqual(vectors(line1, "Boxes").filter((c) => c.matchName === "ADBE Vector Shape - Rect").length, 3);
  assert.strictEqual(vectors(line2, "Boxes").filter((c) => c.matchName === "ADBE Vector Shape - Rect").length, 4);
  // 畫線：每次出現都從 0 畫到 100
  const trim = vectors(line1, "Line").find((c) => c.matchName === "ADBE Vector Filter - Trim");
  const te = leaf(trim, "ADBE Vector Trim End");
  const [s1, s2] = pl.shows;
  near(te.valueAtTime(s1.start), 0);
  near(te.valueAtTime(s1.start + cfg.lineStyle.drawTime), 100);
  near(te.valueAtTime(s2.start - 0.05), 100);
  near(te.valueAtTime(s2.start), 0);
  // 顯示 / 隱藏
  const op = line1.transform.opacity;
  near(op.valueAtTime(s1.start + 0.5), 100);
  near(op.valueAtTime(s1.end + 0.1), 0);
  near(op.valueAtTime(s2.start + 0.1), 100);
  near(line1.inPoint, s1.start);
  near(line1.outPoint, s2.end);
  // 顏色
  const st = vectors(line1, "Line").find((c) => c.matchName === "ADBE Vector Graphic - Stroke");
  deq(leaf(st, "ADBE Vector Stroke Color").value, [0, 1, 0, 1]);
  // 符號跳動：第 1 輪中間（連線 1 的格子）在連線 1 每次出現時放大
  const rc1 = byName(board, "Reel 1").source;
  const e2 = rc1._layers.find((l) => /_E02_/.test(l.name));
  const base = 200 / 256 * 100;
  const sc = e2.transform.scale;
  near(sc.valueAtTime(s1.start)[0], base, 1e-6);
  near(sc.valueAtTime(s1.start + 0.1)[0], base * 1.2, 1e-6);
  near(sc.valueAtTime(s1.start + 0.4)[0], base, 1e-6);
  near(sc.valueAtTime(s2.start + 0.1)[0], base * 1.2, 1e-6);
  // 沒中獎的格子不跳（第 1 輪第 3 列不在任何連線上）
  assert.strictEqual(rc1._layers.find((l) => /_E03_/.test(l.name)).transform.scale.numKeys, 0);
  // 停妥前不會出現
  assert.ok(s1.start >= out.plan.allSettled);
  const marks = out.boardLayer.property("ADBE Marker").keys.map((k) => k.v.comment);
  // 同一格的事件合併成一個標記（AE 同時間只能有一個標記）
  assert.ok(marks.indexOf("SFS LINE 1 / LINE 2") >= 0, marks.join(" | "));
  assert.strictEqual(marks.filter((m) => /LINE 1/.test(m)).length, 2);
  assert.strictEqual(marks[marks.length - 1], "SFS LINE 1");
  assert.strictEqual(new Set(out.boardLayer.property("ADBE Marker").keys.map((k) => k.t)).size, marks.length);
});

test("連線：自訂中獎格素材每格每次出現各放一個", () => {
  const env = aeSetup();
  const res = importSamples(env);
  const fx = env.app.project.items.addComp("WinCellFX", 256, 256, 1, 2, 30);
  const cfg = cfgFromImport(env, res);
  cfg.lines = [{ pattern: "2,2,2,2,2", count: 3, shows: "0.3+1.2, 2.0+0.8", color: "" }];
  cfg.lineStyle.cellSource = "custom"; cfg.lineStyle.cellItemId = fx.id; cfg.lineStyle.cellItemName = fx.name;
  const out = env.S.ae.build(cfg, {});
  deq(out.errors, []);
  const wins = out.boardComp._layers.filter((l) => l.source === fx);
  assert.strictEqual(wins.length, 3 * 2);
  assert.ok(!byName(out.boardComp, "Line 1")._contents.children.some((c) => c.name === "Boxes"), "no built-in boxes");
});

test("更新選取盤面：重建內容、移除舊轉輪合成與 null、標記不重複、尊重圖層時間偏移", () => {
  const env = aeSetup();
  const res = importSamples(env);
  const cfg = cfgFromImport(env, res, (c) => { c.spin.antReels = "5"; });
  cfg.lines = [{ pattern: "2,2,2,2,2", count: 3, shows: "0.3+1", color: "" }];
  const first = env.S.ae.build(cfg, {});
  deq(first.errors, []);
  const oldReels = reelLayers(first.boardComp).map((l) => l.source);
  first.boardLayer.startTime = 1;
  first.boardLayer.selected = true;
  assert.strictEqual(env.S.ae.selectedBoardLayer(), first.boardLayer);

  const cfg2 = env.S.ae.readBoardConfig(first.boardLayer);
  deq(cfg2.lines, cfg.lines);
  cfg2.layout.reels = 4;
  cfg2.layout.rows = 4;
  cfg2.startBoard = env.S.board.create(4, 4, "BAR");
  cfg2.endBoard = env.S.board.create(4, 4, "WILD");
  cfg2.endBoard[2][3] = "SCATTER";
  cfg2.spin.antReels = "";
  cfg2.reels = env.S.generateReels(cfg2);
  cfg2.lines = [];
  const second = env.S.ae.build(cfg2, { boardLayer: first.boardLayer });
  deq(second.errors, []);
  assert.strictEqual(second.boardLayer, first.boardLayer);
  assert.strictEqual(second.boardComp, first.boardComp);
  assert.strictEqual(second.boardComp.numLayers, 4, "frames and lines removed too");
  assert.strictEqual(second.boardComp.height, 800 + 2 * cfg2.layout.margin);
  oldReels.forEach((rc) => assert.ok(env.app.project._items.indexOf(rc) < 0, "old reel comp removed"));
  assert.ok(!env.app.project._items.some((it) => it.isSolid && !it.usedIn.length), "no orphan null solids");
  const marks = first.boardLayer.property("ADBE Marker").keys;
  assert.strictEqual(marks.length, 1 + 4 + 1);
  near(marks[0].t, 2, 1e-9, "SPIN marker stays at target time 2s");
  const rc = second.boardComp.layer(1).source;
  deq(visibleInReel(cfg2.layout, rc, 0.99), ["BAR", "BAR", "BAR", "BAR"]);
  near(second.plan.startTime, 1, 1e-9);
  deq(visibleInReel(cfg2.layout, second.boardComp.layer(3).source, 9), ["WILD", "WILD", "WILD", "SCATTER"]);
});

test("輸出到新建合成", () => {
  const env = aeSetup();
  env.app.project.activeItem = null;
  const cfg = cfgFromImport(env, importSamples(env), (c) => { c.layout.target = "new"; c.layout.newCompFps = 24; });
  const out = env.S.ae.build(cfg, {});
  deq(out.errors, []);
  assert.ok(out.createdTarget);
  assert.strictEqual(out.target.width, 1920);
  assert.strictEqual(out.target.frameRate, 24);
  assert.ok(out.target.openedInViewer);
  assert.ok(out.target.duration >= out.plan.endTime + 1);
});

test("沒有作用中合成時給出提示", () => {
  const env = aeSetup();
  env.app.project.activeItem = null;
  const out = env.S.ae.build(cfgFromImport(env, importSamples(env)), {});
  assert.strictEqual(out.errors.length, 1);
  assert.ok(/合成/.test(out.errors[0]));
});

test("符號素材被刪掉：用路徑重新匯入；檔案也不在時回報缺少", () => {
  const env = aeSetup();
  const res = importSamples(env);
  const cfg = cfgFromImport(env, res);
  const wild = res.symbols.find((s) => s.name === "WILD").item;
  wild.remove();
  let out = env.S.ae.build(cfg, {});
  deq(out.errors, []);
  assert.notStrictEqual(cfg.symbols.find((s) => s.name === "WILD").itemId, wild.id);

  const env2 = aeSetup();
  const res2 = importSamples(env2);
  const cfg2 = cfgFromImport(env2, res2);
  const s = cfg2.symbols.find((x) => x.name === "SEVEN");
  res2.symbols.find((x) => x.name === "SEVEN").item.remove();
  s.path = "/nonexistent/SEVEN.png";
  s.name = "SEVEN_X";
  cfg2.endBoard[1] = ["SEVEN_X", "SEVEN_X", "SEVEN_X"];
  cfg2.endBoard[0][1] = "WILD"; cfg2.endBoard[3][1] = "WILD"; cfg2.endBoard[4][2] = "WILD";
  out = env2.S.ae.build(cfg2, {});
  assert.strictEqual(out.errors.length, 1);
  assert.ok(/SEVEN_X/.test(out.errors[0]));
  assert.strictEqual(env2.app._undo, 0);
});

test("動態符號（合成）較短時開啟時間重映射循環", () => {
  const env = aeSetup();
  const res = importSamples(env);
  const anim = env.app.project.items.addComp("WILD_anim", 300, 300, 1, 1, 30);
  const cfg = cfgFromImport(env, res);
  cfg.symbols.push({ name: "WILD_anim", path: "", itemId: anim.id, filler: false });
  cfg.endBoard[0][0] = "WILD_anim";
  const out = env.S.ae.build(cfg, {});
  deq(out.errors, []);
  const rc = out.boardComp.layer(1).source;
  const l = rc._layers.find((x) => x.source === anim);
  assert.ok(l.timeRemapEnabled);
  assert.strictEqual(l.property("ADBE Time Remapping").expression, "loopOut(\"cycle\")");
  near(l.outPoint, rc.duration);
  near(l.transform.scale.value[0], 200 / 300 * 100, 1e-9);
});

test("目標合成太短時給警告", () => {
  const env = aeSetup();
  env.main.duration = 3;
  const out = env.S.ae.build(cfgFromImport(env, importSamples(env)), {});
  deq(out.errors, []);
  assert.strictEqual(out.warnings.length, 1);
});
