/*
 * core.js：純邏輯
 */
"use strict";
const H = require("./helpers");
const { assert, test, deq, near, SFS, sampleConfig, propFromKeys, visibleFromPlan, speedAt } = H;

console.log("core.js");

test("JSON 往返（中文、跳脫字元、巢狀）", () => {
  const v = { a: "老虎機 \"WILD\"\n\t\\", b: [1, -2.5, 3e-7, true, false, null], c: { d: [], e: {} }, f: "emoji 🎰" };
  const s = SFS.json.stringify(v);
  assert.ok(!/[^\x00-\x7f]/.test(s), "stringify output must be ASCII");
  deq(SFS.json.parse(s), v);
  deq(SFS.json.parse(SFS.json.stringify(v, 2)), v);
  deq(JSON.parse(s), v);
  deq(SFS.json.parse("﻿" + JSON.stringify(v, null, 4)), v);
});

test("JSON 錯誤輸入會丟例外", () => {
  ["{", "[1,]", "{\"a\" 1}", "tru", "\"abc", "1 2", "{'a':1}"].forEach((bad) => {
    assert.throws(() => SFS.json.parse(bad), bad);
  });
});

test("亂數可重現且在範圍內", () => {
  const a = new SFS.Rng(42), b = new SFS.Rng(42), c = new SFS.Rng(43);
  const sa = [], sb = [], sc = [];
  for (let i = 0; i < 200; i++) { sa.push(a.next()); sb.push(b.next()); sc.push(c.next()); }
  deq(sa, sb);
  assert.notDeepStrictEqual(sa, sc);
  sa.forEach((x) => assert.ok(x >= 0 && x < 1));
  const r = new SFS.Rng(0);
  for (let i = 0; i < 100; i++) { const n = r.nextInt(5); assert.ok(n >= 0 && n < 5 && Number.isInteger(n)); }
});

test("自然排序", () => {
  const arr = ["sym10.png", "sym2.png", "Sym1.png", "a.png", "B.png"];
  arr.sort(SFS.util.naturalCompare);
  deq(arr, ["a.png", "B.png", "Sym1.png", "sym2.png", "sym10.png"]);
});

test("盤面文字解析：空白 / 逗號 / Tab、大小寫、錯誤訊息", () => {
  const names = ["A", "K", "Big Win", "WILD"];
  let r = SFS.board.parseText("A K wild\n\nk a A\n", 3, 2, names);
  deq(r.errors, []);
  deq(r.board, [["A", "K"], ["K", "A"], ["WILD", "A"]]);
  r = SFS.board.parseText("A\tBig Win\tK\nBig Win, A, WILD", 3, 2, names);
  deq(r.errors, []);
  deq(r.board, [["A", "Big Win"], ["Big Win", "A"], ["K", "WILD"]]);
  r = SFS.board.parseText("A K\nX A K", 3, 2, names);
  assert.strictEqual(r.errors.length, 2);
  assert.ok(/X/.test(r.errors[1]));
  r = SFS.board.parseText("A K A", 3, 2, names);
  assert.ok(r.errors.length >= 1);
});

test("盤面 toText → parseText 往返", () => {
  const names = ["A", "K", "Big Win"];
  const b = [["A", "Big Win"], ["K", "A"]];
  const r = SFS.board.parseText(SFS.board.toText(b, 2), 2, 2, names);
  deq(r.errors, []);
  deq(r.board, b);
});

test("normalizeConfig 補齊欄位、修正型別、調整盤面、產生各輪節奏", () => {
  const c = SFS.normalizeConfig({
    symbols: [{ name: "A" }, { foo: 1 }, { name: "B", filler: false }],
    layout: { reels: "4", rows: 2, cellW: 120.6, bogus: 1 },
    spin: { firstStop: "abc", motionBlur: 0, decelCurve: "weird" },
    startBoard: [["A", "A", "A"], ["B"]],
    lines: [{ pattern: "1,1,1,1", count: "3.6", shows: "0+1", junk: 1 }],
  });
  assert.strictEqual(c.symbols.length, 2);
  assert.strictEqual(c.symbols[1].filler, false);
  assert.strictEqual(c.layout.reels, 4);
  assert.strictEqual(c.layout.cellW, 121);
  assert.strictEqual(c.layout.bogus, undefined);
  assert.strictEqual(c.spin.firstStop, 1);
  assert.strictEqual(c.spin.motionBlur, false);
  assert.strictEqual(c.spin.decelCurve, "standard");
  deq(c.startBoard, [["A", "A"], ["B", ""], ["", ""], ["", ""]]);
  assert.strictEqual(c.endBoard.length, 4);
  assert.strictEqual(c.reels.length, 4);
  deq(c.lines, [{ pattern: "1,1,1,1", count: 4, shows: "0+1", color: "" }]);
  // 各輪表格長度正確時保留原值
  const c2 = SFS.normalizeConfig({ layout: { reels: 2 }, reels: [{ stop: 3, speed: 9 }, { stop: 4, decelCurve: "soft" }] });
  assert.strictEqual(c2.reels[0].stop, 3);
  assert.strictEqual(c2.reels[0].speed, 9);
  assert.strictEqual(c2.reels[1].decelCurve, "soft");
});

test("預設設定就能直接驗證（只缺符號）", () => {
  deq(SFS.validateConfig(SFS.defaultConfig()), ["符號庫是空的：請先匯入符號圖檔"]);
});

test("validateConfig 抓出空格子 / 未知符號 / 各輪 / 連線錯誤", () => {
  const cfg = sampleConfig(SFS);
  deq(SFS.validateConfig(cfg), []);
  cfg.startBoard[2][1] = "";
  cfg.endBoard[0][0] = "NOPE";
  cfg.reels[1].speed = 0;
  cfg.reels[2].frame = true; cfg.reels[2].frameStart = cfg.reels[2].stop + 0.1;
  cfg.lines = [{ pattern: "2,2,2", count: 3, shows: "0+1", color: "" }, { pattern: "1,1,1,1,1", count: 9, shows: "abc", color: "" }];
  const e = SFS.validateConfig(cfg);
  assert.strictEqual(e.length, 7, e.join("\n"));
});

test("fillerPool 排除非填充符號；全部排除時退回全部", () => {
  const cfg = sampleConfig(SFS);
  assert.ok(SFS.fillerPool(cfg).indexOf("SCATTER") < 0);
  cfg.symbols.forEach((s) => { s.filler = false; });
  assert.strictEqual(SFS.fillerPool(cfg).length, cfg.symbols.length);
});

// ---------------- 節奏產生 ----------------
test("parseOrder：先後、同時、反向、全形、重複與超出範圍", () => {
  deq(SFS.parseOrder("", 3), [[0], [1], [2]]);
  deq(SFS.parseOrder("5,4,3,2,1", 5), [[4], [3], [2], [1], [0]]);
  deq(SFS.parseOrder("1 + 2 + 3, 4, 5", 5), [[0, 1, 2], [3], [4]]);
  deq(SFS.parseOrder("3，2＋4，1，5", 5), [[2], [1, 3], [0], [4]]);
  deq(SFS.parseOrder("2,2,9,x", 3), [[1], [0], [2]]);
});

test("generateReels：停輪順序、同時停、各步轉速、起轉間隔", () => {
  const cfg = sampleConfig(SFS, (c) => {
    c.spin.stopOrder = "5,4,3+2,1";
    c.spin.firstStop = 1; c.spin.stagger = 0.3;
    c.spin.speeds = "10, 12, 14";
    c.spin.startOrder = "1,2,3,4,5"; c.spin.startStagger = 0.05;
  });
  const R = cfg.reels;
  deq(R.map((r) => r.stop), [1.9, 1.6, 1.6, 1.3, 1]);
  deq(R.map((r) => r.speed), [14, 14, 14, 12, 10]);
  deq(R.map((r) => r.start), [0, 0.05, 0.1, 0.15, 0.2]);
  assert.ok(R.every((r) => !r.frame));
});

test("generateReels：期待輪會延長（累加）、繞框從上一次停輪開始、套用期待參數", () => {
  const cfg = sampleConfig(SFS, (c) => {
    c.spin.antReels = "4,5"; c.spin.antTime = 0.8; c.spin.antSpeed = 26;
    c.spin.antDecelTime = 0.5; c.spin.antCurve = "soft";
  });
  const R = cfg.reels;
  deq(R.map((r) => r.stop), [1, 1.25, 1.5, 2.55, 3.6]);
  deq(R.map((r) => r.frame), [false, false, false, true, true]);
  near(R[3].frameStart, 1.5);
  near(R[4].frameStart, 2.55);
  assert.strictEqual(R[4].decelCurve, "soft");
  assert.strictEqual(R[4].decelTime, 0.5);
  assert.strictEqual(R[4].frameSpeed, 26);
  assert.strictEqual(R[0].frameSpeed, 0);
});

// ---------------- 動態計算 ----------------
function checkPlan(cfg, fps, label) {
  const plan = SFS.computePlan(cfg, fps);
  deq(plan.errors, [], label);
  const L = cfg.layout, P = cfg.spin;
  assert.strictEqual(plan.reels.length, L.reels);
  const pool = SFS.fillerPool(cfg);
  plan.reels.forEach((rp, i) => {
    const R = cfg.reels[i];
    rp.keys.forEach((k, j) => {
      near(k.t * fps, Math.round(k.t * fps), 1e-6, label + " key on frame");
      if (j) assert.ok(k.t > rp.keys[j - 1].t + 1e-9, label + " key times increasing");
      assert.ok(k.inInf >= 0.1 && k.inInf <= 100 && k.outInf >= 0.1 && k.outInf <= 100);
    });
    for (let r = 0; r < L.rows; r++) {
      assert.strictEqual(rp.strip[rp.startIndex + r].name, cfg.startBoard[i][r]);
      assert.strictEqual(rp.strip[rp.endIndex + r].name, cfg.endBoard[i][r]);
    }
    rp.strip.forEach((s) => { if (s.kind === "fill" || s.kind === "buffer") assert.ok(pool.indexOf(s.name) >= 0, "filler from pool"); });
    // 畫面上看到的盤面
    deq(visibleFromPlan(SFS, cfg, rp, rp.keys[0].t - 0.5), cfg.startBoard[i], label + " reel " + (i + 1) + " before spin");
    deq(visibleFromPlan(SFS, cfg, rp, rp.keys[0].t), cfg.startBoard[i], label + " reel " + (i + 1) + " at start");
    deq(visibleFromPlan(SFS, cfg, rp, rp.settleTime), cfg.endBoard[i], label + " reel " + (i + 1) + " settled");
    deq(visibleFromPlan(SFS, cfg, rp, rp.settleTime + 3), cfg.endBoard[i], label + " reel " + (i + 1) + " after");
    // 從拉回點到停輪點之間單調、速度不超過算出的最高速
    const dir = plan.direction;
    const prop = propFromKeys(rp.keys);
    const hasWindup = P.windupDist > 0 && P.windupTime > 0;
    const tA = hasWindup ? rp.keys[1].t : rp.keys[0].t;
    let prev = prop.valueAtTime(tA), maxStep = 0;
    for (let t = tA + 0.002; t <= rp.stopTime; t += 0.002) {
      const v = prop.valueAtTime(t);
      assert.ok((v - prev) * dir >= -1e-6, label + " monotonic at " + t);
      maxStep = Math.max(maxStep, Math.abs(v - prev) / 0.002);
      prev = v;
    }
    assert.ok(maxStep <= rp.speed * 1.02 + 1, label + " max speed " + maxStep + " vs " + rp.speed);
    // 等速段速度接近設定轉速（受整數格數 / 最少格數影響）
    if (rp.fill > Math.max(L.rows, 2) && !(R.frame && R.frameSpeed > 0)) {
      const target = R.speed * (L.cellH + L.gapY);
      assert.ok(Math.abs(rp.speed - target) / target < 0.2, label + " speed close to target " + rp.speed + " vs " + target);
    }
  });
  return plan;
}

test("computePlan：預設參數 5x3 @30fps", () => {
  const cfg = sampleConfig(SFS, (c) => { c.spin.startTime = 1.2; });
  const plan = checkPlan(cfg, 30, "default");
  near(plan.reels[0].stopTime, 2.2, 1e-9);
  near(plan.reels[4].stopTime, 3.2, 1e-9);
  assert.strictEqual(plan.markers[0].label, "SPIN");
  assert.strictEqual(plan.markers[plan.markers.length - 1].label, "ALL SETTLED");
  near(plan.endTime, plan.reels[4].settleTime, 1e-9);
  assert.strictEqual(plan.boardW, 5 * 200 + 4 * 10 + 2 * 60);
  assert.strictEqual(plan.boardH, 600 + 2 * 60);
});

test("computePlan：向上轉、無拉回、無回彈、間距、露出 @24fps", () => {
  const cfg = sampleConfig(SFS, (c) => {
    c.spin.direction = "up"; c.spin.windupDist = 0; c.spin.overshoot = 0;
    c.layout.gapY = 12; c.layout.peek = 40; c.layout.cellH = 180;
  });
  checkPlan(cfg, 24, "up");
});

test("computePlan：29.97fps、大回彈、期待輪", () => {
  const cfg = sampleConfig(SFS, (c) => {
    c.spin.antReels = "4,5"; c.spin.antTime = 0.8; c.spin.overshoot = 1.3; c.spin.windupDist = 1.6; c.layout.peek = 90;
  });
  const plan = checkPlan(cfg, 29.97, "ntsc");
  const st = plan.reels.map((r) => r.stopTime);
  near(st[3] - st[2], 0.25 + 0.8, 0.04);
  near(st[4] - st[3], 0.25 + 0.8, 0.04);
  assert.strictEqual(plan.frames.length, 2);
  near(plan.frames[0].start, plan.reels[2].stopTime, 0.04);
  near(plan.frames[0].end, plan.reels[3].settleTime + cfg.frame.hold, 0.04);
});

test("computePlan：三種減速曲線都單調、不超速、停在結果盤面", () => {
  ["standard", "soft", "hard"].forEach((curve) => {
    const cfg = sampleConfig(SFS, (c) => { c.spin.decelCurve = curve; c.spin.decelTime = 0.6; });
    checkPlan(cfg, 30, curve);
  });
});

test("computePlan：減速曲線的形狀（緩停後段慢、急停後段快）", () => {
  const tailSpeed = (curve) => {
    const cfg = sampleConfig(SFS, (c) => { c.spin.decelCurve = curve; c.spin.decelTime = 0.6; c.spin.overshoot = 0; });
    const rp = SFS.computePlan(cfg, 30).reels[0];
    const prop = propFromKeys(rp.keys);
    // 減速段 70% 處的速度 / 等速
    return Math.abs(speedAt(prop, rp.decelStart + (rp.stopTime - rp.decelStart) * 0.7)) / rp.speed;
  };
  const soft = tailSpeed("soft"), std = tailSpeed("standard"), hard = tailSpeed("hard");
  assert.ok(soft < std && std < hard, [soft, std, hard].join(" / "));
});

test("computePlan：繞框轉速切換（期待時加速）", () => {
  const cfg = sampleConfig(SFS, (c) => {
    c.spin.antReels = "5"; c.spin.antTime = 1.2; c.spin.antSpeed = 30; c.spin.speeds = "15";
  });
  const plan = checkPlan(cfg, 30, "antSpeed");
  const rp = plan.reels[4], R = cfg.reels[4];
  const prop = propFromKeys(rp.keys);
  const pitch = cfg.layout.cellH + cfg.layout.gapY;
  const before = speedAt(prop, (rp.accelEnd + plan.startTime + R.frameStart) / 2) / pitch;
  const during = speedAt(prop, (plan.startTime + R.frameStart + cfg.spin.speedRamp + rp.decelStart) / 2) / pitch;
  assert.ok(Math.abs(before - 15) / 15 < 0.15, "before " + before);
  assert.ok(Math.abs(during - 30) / 30 < 0.15, "during " + during);
  assert.ok(plan.markers.some((m) => m.label.split(" / ").indexOf("R5 FRAME") >= 0));
});

test("computePlan：繞框轉速切換時間不在等速段時忽略並警告", () => {
  const cfg = sampleConfig(SFS);
  cfg.reels[0].frame = true; cfg.reels[0].frameStart = 0.05; cfg.reels[0].frameSpeed = 30;
  const plan = SFS.computePlan(cfg, 30);
  deq(plan.errors, []);
  assert.strictEqual(plan.warnings.length, 1);
});

test("computePlan：逐輪自訂（反向停、同時停、起轉間隔）", () => {
  const cfg = sampleConfig(SFS, (c) => {
    c.spin.stopOrder = "5,4,3+2+1"; c.spin.startOrder = "3,2,4,1,5"; c.spin.startStagger = 0.1; c.spin.speeds = "12,20,30";
  });
  const plan = checkPlan(cfg, 30, "custom");
  const st = plan.reels.map((r) => r.stopTime);
  assert.ok(st[4] < st[3] && st[3] < st[2]);
  near(st[0], st[1]); near(st[1], st[2]);
  near(plan.reels[2].spinStart, 0); near(plan.reels[4].spinStart, 0.4, 1e-9);
});

test("computePlan：1 輪 1 列、轉速很慢（最少填充格數）", () => {
  const cfg = sampleConfig(SFS, (c) => {
    c.layout.reels = 1; c.layout.rows = 1; c.spin.speeds = "1";
    c.startBoard = [["A"]]; c.endBoard = [["WILD"]];
  });
  const plan = checkPlan(cfg, 60, "tiny");
  assert.strictEqual(plan.reels[0].fill, 2);
});

test("computePlan：只有一種符號也能跑", () => {
  const cfg = sampleConfig(SFS, (c) => {
    c.symbols = [{ name: "A", path: "", itemId: 0, filler: true }];
    c.startBoard = SFS.board.create(5, 3, "A"); c.endBoard = SFS.board.create(5, 3, "A");
  });
  checkPlan(cfg, 30, "mono");
});

test("computePlan：停得太早會回報錯誤", () => {
  const cfg = sampleConfig(SFS, (c) => { c.spin.firstStop = 0.1; });
  const plan = SFS.computePlan(cfg, 30);
  assert.ok(plan.errors.length >= 1);
  assert.ok(/第 1 輪/.test(plan.errors[0]));
});

test("computePlan：同一個種子結果相同，換種子填充不同", () => {
  const a = SFS.computePlan(sampleConfig(SFS), 30);
  const b = SFS.computePlan(sampleConfig(SFS), 30);
  const c = SFS.computePlan(sampleConfig(SFS, (x) => { x.spin.seed = 999; }), 30);
  const names = (p) => p.reels.map((r) => r.strip.map((s) => s.name).join(",")).join("|");
  assert.strictEqual(names(a), names(b));
  assert.notStrictEqual(names(a), names(c));
});

test("填充符號不會連續重複", () => {
  const plan = SFS.computePlan(sampleConfig(SFS), 30);
  plan.reels.forEach((rp) => {
    for (let k = 1; k < rp.strip.length; k++) {
      const a = rp.strip[k - 1], b = rp.strip[k];
      if (b.kind === "fill" || b.kind === "buffer") assert.notStrictEqual(a.name, b.name);
    }
  });
});

// ---------------- 連線 ----------------
test("連線：線型 / 顯示時間解析", () => {
  deq(SFS.lines.parsePattern("1,2,3,2,1", 5, 3), [0, 1, 2, 1, 0]);
  deq(SFS.lines.parsePattern(" 2 2 2 2 2 ", 5, 3), [1, 1, 1, 1, 1]);
  assert.strictEqual(SFS.lines.parsePattern("1,2,3,2", 5, 3), null);
  assert.strictEqual(SFS.lines.parsePattern("1,2,4,2,1", 5, 3), null);
  assert.strictEqual(SFS.lines.parsePattern("1,2,1.5,2,1", 5, 3), null);
  deq(SFS.lines.parseShows("0.3+1.2, 2.5 + 0.9"), [{ start: 0.3, dur: 1.2 }, { start: 2.5, dur: 0.9 }]);
  deq(SFS.lines.parseShows(""), []);
  assert.strictEqual(SFS.lines.parseShows("0.3-1.2"), null);
  assert.strictEqual(SFS.lines.parseShows("0.3+0"), null);
  assert.strictEqual(SFS.lines.formatShows([{ start: 0.3, dur: 1.2 }, { start: 2.5, dur: 0.9 }]), "0.3+1.2, 2.5+0.9");
});

test("連線：內建線型（5x3 = 20 條，其他尺寸都合法）", () => {
  const std = SFS.lines.defaultPaylines(5, 3);
  assert.strictEqual(std.length, 20);
  assert.strictEqual(new Set(std.map((l) => l.join(","))).size, 20);
  [[3, 3], [5, 4], [6, 4], [4, 1], [1, 3]].forEach(([r, y]) => {
    SFS.lines.defaultPaylines(r, y).forEach((l) => {
      assert.strictEqual(l.length, r);
      l.forEach((v) => assert.ok(v >= 1 && v <= y));
    });
  });
});

test("連線偵測：百搭代替、不算連線的符號、最少連線數、自訂線型錯誤", () => {
  const cfg = sampleConfig(SFS);
  cfg.endBoard = [
    ["K", "SEVEN", "SCATTER"],
    ["WILD", "SEVEN", "SCATTER"],
    ["K", "SEVEN", "SCATTER"],
    ["Q", "WILD", "SCATTER"],
    ["J", "Q", "SCATTER"],
  ];
  let res = SFS.lines.detect(cfg);
  const got = res.lines.map((l) => l.pattern + ":" + l.symbol + "x" + l.count).sort();
  // 中間 7 連 4（第 4 輪是 WILD）、上排 K 連 3（第 2 輪 WILD）；下排 SCATTER 不算
  assert.ok(got.indexOf("2,2,2,2,2:SEVENx4") >= 0, got.join(" "));
  assert.ok(got.indexOf("1,1,1,1,1:Kx3") >= 0, got.join(" "));
  assert.ok(!got.some((g) => /SCATTER/.test(g)), got.join(" "));
  cfg.lineSet.exclude = "";
  assert.ok(SFS.lines.detect(cfg).lines.some((l) => l.pattern === "3,3,3,3,3" && l.count === 5));
  cfg.lineSet.exclude = "SCATTER";
  cfg.lineSet.minCount = 4;
  res = SFS.lines.detect(cfg);
  assert.ok(res.lines.every((l) => l.count >= 4));
  cfg.lineSet.paylines = "2 2 2 2 2\n1 2 9 2 1";
  res = SFS.lines.detect(cfg);
  assert.strictEqual(res.errors.length, 1);
});

test("連線時間：先全部再逐條 / 全部 / 逐條", () => {
  const mk = () => [{ shows: "" }, { shows: "" }, { shows: "" }];
  const gen = { delay: 0.3, allTime: 1.2, eachTime: 0.9, gap: 0.1 };
  let l = SFS.lines.applyTiming(mk(), Object.assign({ mode: "all_each" }, gen));
  deq(l.map((x) => x.shows), ["0.3+1.2, 1.6+0.9", "0.3+1.2, 2.6+0.9", "0.3+1.2, 3.6+0.9"]);
  l = SFS.lines.applyTiming(mk(), Object.assign({ mode: "all" }, gen));
  deq(l.map((x) => x.shows), ["0.3+1.2", "0.3+1.2", "0.3+1.2"]);
  l = SFS.lines.applyTiming(mk(), Object.assign({ mode: "each" }, gen));
  deq(l.map((x) => x.shows), ["0.3+0.9", "1.3+0.9", "2.3+0.9"]);
});

test("computePlan：連線座標、顯示時間在停妥之後、標記", () => {
  const cfg = sampleConfig(SFS);
  cfg.lines = [
    { pattern: "1,2,3,2,1", count: 3, shows: "0.3+1, 2+0.5", color: "" },
    { pattern: "2,2,2,2,2", count: 5, shows: "0.3+1", color: "#00FF00" },
  ];
  cfg.lineStyle.full = false;
  let plan = SFS.computePlan(cfg, 30);
  deq(plan.errors, []);
  const L = cfg.layout;
  const l0 = plan.lines[0];
  deq(l0.cells, [[0, 0], [1, 1], [2, 2]]);
  assert.strictEqual(l0.points.length, 3 + 2);
  deq(l0.points[1], SFS.cellCenter(L, 0, 0));
  deq(l0.points[0], [SFS.cellCenter(L, 0, 0)[0] - L.cellW / 2, SFS.cellCenter(L, 0, 0)[1]]);
  near(l0.shows[0].start, plan.allSettled + 0.3, 1 / 60);
  near(l0.shows[1].end, plan.allSettled + 2.5, 1 / 60);
  deq(plan.lines[1].color, [0, 1, 0]);
  near(plan.endTime, l0.shows[1].end, 1e-9);
  assert.strictEqual(plan.markers.filter((m) => m.label.split(" / ").indexOf("LINE 1") >= 0).length, 2);
  for (let i = 1; i < plan.markers.length; i++) assert.ok(plan.markers[i].t >= plan.markers[i - 1].t);
  cfg.lineStyle.full = true;
  plan = SFS.computePlan(cfg, 30);
  assert.strictEqual(plan.lines[0].points.length, 5 + 2);
});

test("顏色轉換", () => {
  deq(SFS.hexToRgb("#FF8000"), [1, 128 / 255, 0]);
  deq(SFS.hexToRgb("bad", [0, 0, 0]), [0, 0, 0]);
  assert.strictEqual(SFS.rgbToHex([1, 0.5, 0]), "#FF8000");
});

// ---------------- 期待感建議 ----------------
test("期待感：Scatter 差一顆才期待、依停輪順序、達標後續追開關", () => {
  const cfg = sampleConfig(SFS);
  cfg.endBoard = [["A", "SCATTER", "K"], ["K", "A", "Q"], ["SCATTER", "K", "A"], ["A", "K", "A"], ["K", "SCATTER", "A"]];
  let res = SFS.anticipation.suggest(cfg);
  deq(res.reels, [4, 5]);
  assert.ok(/差 1 顆/.test(res.byReel[4]));
  // 反向停：R5 先停（1 顆）、R4、R3（第 2 顆）→ 之後的 R2、R1 期待
  cfg.spin.stopOrder = "5,4,3,2,1";
  deq(SFS.anticipation.suggest(cfg).reels, [1, 2]);
  // 已觸發後：after = true 繼續期待，false 不期待
  cfg.spin.stopOrder = "";
  cfg.endBoard[1][0] = "SCATTER"; // 前 3 輪就有 3 顆
  deq(SFS.anticipation.suggest(cfg).reels, [3, 4, 5]);
  cfg.antRule.after = false;
  deq(SFS.anticipation.suggest(cfg).reels, [3]);
  // 4 顆觸發
  cfg.antRule.after = true; cfg.antRule.count = 4;
  deq(SFS.anticipation.suggest(cfg).reels, [4, 5]);
});

test("期待感：大獎聽牌（百搭代替、連到哪期待到哪、看不到前面的輪不算）", () => {
  const cfg = sampleConfig(SFS);
  cfg.antRule.symbols = "";
  cfg.antRule.tease = "SEVEN";
  cfg.endBoard = [["SEVEN", "A", "K"], ["WILD", "A", "K"], ["SEVEN", "K", "A"], ["A", "K", "A"], ["K", "A", "A"]];
  let res = SFS.anticipation.suggest(cfg);
  deq(res.reels, [3, 4]);
  assert.ok(/聽牌/.test(res.byReel[3]));
  cfg.antRule.teaseMin = 3;
  deq(SFS.anticipation.suggest(cfg).reels, [4]);
  cfg.antRule.teaseMin = 2;
  cfg.antRule.tease = "K"; // 下排 K-K、線 7（3,3,2,3,3）K-K-K
  deq(SFS.anticipation.suggest(cfg).reels, [3, 4]);
  cfg.antRule.tease = "Q";
  deq(SFS.anticipation.suggest(cfg).reels, []);
  cfg.antRule.tease = "SEVEN";
  cfg.spin.stopOrder = "3,1,2,4,5";
  deq(SFS.anticipation.suggest(cfg).reels, [4], "reel 3 stops before 1-2 → no tease on 3");
});

test("期待感：apply 寫入期待輪並重新產生各輪", () => {
  const cfg = sampleConfig(SFS);
  cfg.endBoard = [["A", "SCATTER", "K"], ["K", "A", "Q"], ["SCATTER", "K", "A"], ["A", "K", "A"], ["K", "SCATTER", "A"]];
  const res = SFS.anticipation.apply(cfg);
  assert.strictEqual(cfg.spin.antReels, "4,5");
  deq(cfg.reels.map((r) => r.frame), [false, false, false, true, true]);
  assert.ok(res.reasons.length >= 3);
  deq(SFS.computePlan(cfg, 30).errors, []);
});
