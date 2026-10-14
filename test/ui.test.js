/*
 * dist/SlotFakeSpin.jsx：整包載入模擬 AE + ScriptUI，操作面板按鈕跑完整流程
 */
"use strict";
const os = require("os");
const H = require("./helpers");
const { fs, path, vm, assert, test, deq, newContext, ROOT, SYMBOL_DIR, mockUI } = H;

console.log("dist/SlotFakeSpin.jsx（模擬 AE + ScriptUI 面板操作）");

function loadDist(ctx, asPanel) {
  const code = fs.readFileSync(path.join(ROOT, "dist", "SlotFakeSpin.jsx"), "utf8");
  ctx.__panel = asPanel ? new ctx.Panel() : undefined;
  vm.runInContext("(function () {\n" + code + "\n}).call(" + (asPanel ? "__panel" : "this") + ");", ctx, { filename: "SlotFakeSpin.jsx" });
  return ctx.__panel || ctx.__windows[0];
}

const find = mockUI.find, byText = mockUI.findByText, walk = mockUI.walk;
function click(el) { assert.ok(el, "element exists"); assert.ok(el.onClick, "has onClick: " + el.text); el.onClick.call(el); }
function cells(root) {
  const out = [];
  walk(root, (el) => { if (el.type === "button" && el.sfsReel !== undefined) out.push(el); });
  return out;
}
function noErrorsAlerted(ctx) {
  const bad = (ctx.__alerts || []).filter((a) => /失敗|錯誤|error|invalid/i.test(a));
  deq(bad, []);
}
function tab(panel, title) { return find(panel, (el) => el.type === "tab" && el.text === title); }
// 在某個容器裡找「標籤文字」後面的第一個 edittext
function fieldAfter(root, labelText) {
  let hit = null;
  walk(root, (el) => {
    if (hit || !el.children) return;
    const i = el.children.findIndex((c) => c.type === "statictext" && c.text === labelText);
    if (i >= 0) hit = el.children.slice(i + 1).find((c) => c.type === "edittext");
  });
  assert.ok(hit, "field after " + labelText);
  return hit;
}
function setField(et, v) { et.text = String(v); et.onChange.call(et); }
function boardLayers(comp) { return comp._layers.filter((l) => l.comment === "SFS_BOARD"); }
function drawAll(root) { walk(root, (el) => { if (el.onDraw) el.onDraw.call(el); }); }

function setup() {
  const ctx = newContext();
  const main = ctx.app.project.items.addComp("Main", 1920, 1080, 1, 12, 30);
  ctx.app.project.activeItem = main;
  const panel = loadDist(ctx, true);
  ctx.__dialogResult = new ctx.Folder(SYMBOL_DIR);
  click(byText(panel, "button", "匯入資料夾…"));
  return { ctx, main, panel };
}

test("dist 是純 ASCII 且符合 ES3", () => {
  const code = fs.readFileSync(path.join(ROOT, "dist", "SlotFakeSpin.jsx"), "utf8");
  assert.ok(!/[^\x00-\x7f]/.test(code));
  require("acorn").parse(code, { ecmaVersion: 3 });
});

test("面板：分頁齊全、啟動沒有錯誤、所有自訂繪製都能執行", () => {
  const ctx = newContext();
  const panel = loadDist(ctx, true);
  ["符號", "盤面", "節奏", "各輪", "繞框", "連線", "設定"].forEach((t) => assert.ok(tab(panel, t), t));
  deq(ctx.__alerts || [], []);
  drawAll(panel);
});

test("符號 + 盤面：匯入、填充切換、畫筆 / Shift / Alt、文字編輯", () => {
  const { ctx, panel } = setup();
  const list = find(panel, (el) => el.type === "listbox" && !el.properties.numberOfColumns);
  assert.strictEqual(list.items.length, 10);
  assert.strictEqual(list.items[0].text, "● A");
  assert.ok(cells(panel).every((c) => c.text !== "-"), "boards auto-filled after first import");

  list.selection = [list.items[7]];
  list.onChange.call(list);
  click(byText(panel, "button", "切換填充"));
  assert.strictEqual(list.items[7].text, "○ SCATTER");

  const dd = find(panel, (el) => el.type === "dropdownlist" && el.items.length === 10);
  dd.selection = 9; dd.onChange.call(dd); // WILD
  const cs = cells(panel);
  assert.strictEqual(cs.length, 15);
  click(cs[0]);
  assert.strictEqual(cs[0].text, "WILD");
  ctx.ScriptUI.environment.keyboardState.shiftKey = true;
  click(cs.find((c) => c.sfsReel === 2 && c.sfsRow === 1));
  ctx.ScriptUI.environment.keyboardState.shiftKey = false;
  deq(cs.filter((c) => c.sfsReel === 2).map((c) => c.text), ["WILD", "WILD", "WILD"]);
  dd.selection = 0; dd.onChange.call(dd);
  ctx.ScriptUI.environment.keyboardState.altKey = true;
  click(cs[0]);
  ctx.ScriptUI.environment.keyboardState.altKey = false;
  assert.strictEqual(dd.selection.text, "WILD");
  cs.forEach((c) => { c.onDraw.call(c); });
  assert.ok(ctx.__ui.graphicsCalls.indexOf("drawImage") >= 0);

  click(byText(panel, "radiobutton", "結果盤面"));
  ctx.__onDialog = (d) => {
    find(d, (el) => el.type === "edittext").text = "SEVEN SEVEN SEVEN bar bell\nwild WILD WILD A K\nQ J SCATTER A A";
    click(find(d, (el) => el.type === "button" && el.text === "套用"));
    return d.closed;
  };
  click(byText(panel, "button", "文字編輯…"));
  ctx.__onDialog = null;
  deq(cells(panel).filter((c) => c.sfsRow === 0).map((c) => c.text), ["SEVEN", "SEVEN", "SEVEN", "BAR", "BELL"]);
});

test("節奏：快速節奏自動套用、各輪手動微調後停止自動、套用節奏覆蓋", () => {
  const { panel } = setup();
  const tR = tab(panel, "節奏"), tE = tab(panel, "各輪");
  const reelList = find(tE, (el) => el.type === "listbox");
  assert.strictEqual(reelList.items.length, 5);
  setField(fieldAfter(tR, "停輪順序"), "5,4,3,2,1");
  // R5 第一個停
  assert.strictEqual(reelList.items[4].subItems[1].text, "1");
  assert.strictEqual(reelList.items[0].subItems[1].text, "2");
  setField(fieldAfter(tR, "期待輪"), "1");
  assert.ok(/^從 /.test(reelList.items[0].subItems[6].text), reelList.items[0].subItems[6].text);
  // 手動改第 2 輪停輪時間 → 自動套用取消
  reelList.selection = [reelList.items[1]];
  reelList.onChange.call(reelList);
  setField(fieldAfter(tE, "停輪"), 3.3);
  assert.strictEqual(reelList.items[1].subItems[1].text, "3.3");
  const auto = byText(tR, "checkbox", "自動套用到各輪");
  assert.strictEqual(auto.value, false);
  setField(fieldAfter(tR, "每次間隔"), 0.5);
  assert.strictEqual(reelList.items[1].subItems[1].text, "3.3", "manual edit kept");
  click(byText(tR, "button", "套用節奏"));
  assert.notStrictEqual(reelList.items[1].subItems[1].text, "3.3");
  // 多選一起改曲線、繞框、整體平移
  click(byText(tE, "button", "全選"));
  const curve = find(tE, (el) => el.type === "dropdownlist");
  curve.selection = 1; curve.onChange.call(curve);
  assert.ok(reelList.items.every((it) => /緩停/.test(it.subItems[3].text)));
  reelList.selection = [reelList.items[2]];
  reelList.onChange.call(reelList);
  const cb = byText(tE, "checkbox", "繞框");
  cb.value = true; cb.onClick.call(cb);
  assert.ok(/^從 /.test(reelList.items[2].subItems[6].text));
  drawAll(panel);
});

test("連線：偵測、新增、編輯、顯示時間、顏色", () => {
  const { ctx, panel } = setup();
  click(byText(panel, "radiobutton", "結果盤面"));
  ctx.__onDialog = (d) => {
    find(d, (el) => el.type === "edittext").text = "K WILD K Q J\nSEVEN SEVEN SEVEN WILD Q\nA A BAR BELL CHERRY";
    click(find(d, (el) => el.type === "button" && el.text === "套用"));
    return d.closed;
  };
  click(byText(panel, "button", "文字編輯…"));
  ctx.__onDialog = null;
  const tL = tab(panel, "連線");
  const lineList = find(tL, (el) => el.type === "listbox");
  click(byText(tL, "button", "從結果盤面偵測"));
  assert.ok(lineList.items.length >= 2, "lines detected: " + lineList.items.length);
  const mid = lineList.items.find((it) => it.subItems[0].text === "2,2,2,2,2");
  assert.ok(mid && mid.subItems[1].text === "4");
  assert.ok(/\+/.test(mid.subItems[2].text));
  // 新增 + 編輯
  const n = lineList.items.length;
  click(byText(tL, "button", "新增"));
  assert.strictEqual(lineList.items.length, n + 1);
  setField(fieldAfter(tL, "線型"), "1,2,3,2,1");
  setField(fieldAfter(tL, "連"), "9");
  setField(fieldAfter(tL, "顯示"), "0.5+2");
  const last = lineList.items[n];
  deq([last.subItems[0].text, last.subItems[1].text, last.subItems[2].text], ["1,2,3,2,1", "5", "0.5+2"]);
  ctx.__color = 0x00ff00;
  click(find(tL, (el) => el.type === "button" && el.text === "選色" && el.parent.children.some((c) => c.text === "顏色")));
  // 顯示時間全部重排
  setField(fieldAfter(tL, "停妥後"), 0.5);
  click(byText(tL, "button", "套用到全部連線"));
  assert.ok(lineList.items.every((it) => /^0\.5\+/.test(it.subItems[2].text)));
  click(byText(tL, "button", "刪除"));
  assert.strictEqual(lineList.items.length, n);
  drawAll(panel);
  noErrorsAlerted(ctx);
});

test("完整流程：建立（含繞框 + 連線）→ 讀取 → 改尺寸 → 更新 → 存 / 開設定檔 → 重開面板還原", () => {
  const { ctx, main, panel } = setup();
  const app = ctx.app;
  const tR = tab(panel, "節奏"), tL = tab(panel, "連線"), tF = tab(panel, "繞框");
  setField(fieldAfter(tR, "期待輪"), "4,5");
  click(byText(tL, "button", "新增"));
  // 自訂繞框素材
  const fx = app.project.items.addComp("MyFrame", 300, 800, 1, 1, 30);
  fx.selected = true;
  click(byText(tF, "button", "指定選取"));
  fx.selected = false;
  assert.ok(find(tF, (el) => el.type === "statictext" && el.text === "素材：MyFrame"), "asset label");

  main.time = 1.5;
  click(byText(panel, "button", "取目前時間"));
  click(byText(panel, "button", "▶ 建立假轉"));
  noErrorsAlerted(ctx);
  const boardLayer = boardLayers(main)[0];
  assert.ok(boardLayer, "board layer in main comp");
  const board = boardLayer.source;
  assert.ok(board._layers.some((l) => l.name === "Frame R4" && l.source === fx));
  assert.ok(board._layers.some((l) => l.name === "Line 1"));
  const cfg = JSON.parse(board.comment).config;
  assert.strictEqual(cfg.spin.startTime, 1.5);
  assert.strictEqual(cfg.frame.source, "custom");
  const status = panel.children[panel.children.length - 1];
  assert.ok(/建立完成/.test(status.text) && /2 個繞框/.test(status.text) && /1 條連線/.test(status.text), status.text);

  // 改動面板 → 讀取選取盤面會還原
  click(byText(panel, "button", "互換"));
  boardLayer.selected = true;
  click(byText(panel, "button", "讀取選取盤面"));
  deq(cells(panel).filter((c) => c.sfsRow === 0).map((c) => c.text), cfg.startBoard.map((col) => col[0]));

  // 改尺寸 → 各輪重新產生、不符的連線移除 → 更新
  const etReels = find(tab(panel, "盤面"), (el) => el.type === "edittext" && el.characters === 3);
  etReels.text = "6";
  click(byText(panel, "button", "套用尺寸"));
  assert.strictEqual(cells(panel).length, 18);
  assert.strictEqual(find(tab(panel, "各輪"), (el) => el.type === "listbox").items.length, 6);
  assert.strictEqual(find(tL, (el) => el.type === "listbox").items.length, 0);
  click(byText(panel, "button", "更新選取盤面"));
  noErrorsAlerted(ctx);
  assert.strictEqual(board._layers.filter((l) => /^Reel /.test(l.name)).length, 6);
  assert.strictEqual(boardLayers(main).length, 1);

  // 數字欄位：不合法輸入會還原，超出範圍會夾住
  const etFirst = fieldAfter(tR, "第一次停");
  setField(etFirst, "abc");
  assert.strictEqual(etFirst.text, "1");
  setField(etFirst, "-5");
  assert.strictEqual(etFirst.text, "0.05");
  setField(etFirst, "1.2");

  // 存 / 開設定檔
  const tmp = path.join(os.tmpdir(), "sfs-test-" + process.pid + ".json");
  ctx.__dialogResult = new ctx.File(tmp.replace(/\.json$/, ""));
  click(byText(panel, "button", "存設定…"));
  assert.ok(fs.existsSync(tmp), "preset written with .json extension");
  const saved = JSON.parse(fs.readFileSync(tmp, "utf8"));
  assert.strictEqual(saved.layout.reels, 6);
  assert.strictEqual(saved.reels.length, 6);
  saved.spin.firstStop = 2.5;
  fs.writeFileSync(tmp, JSON.stringify(saved));
  ctx.__dialogResult = new ctx.File(tmp);
  click(byText(panel, "button", "開設定…"));
  assert.strictEqual(fieldAfter(tR, "第一次停").text, "2.5");
  fs.unlinkSync(tmp);
  noErrorsAlerted(ctx);
  assert.strictEqual(app._undo, 0);

  const again = loadDist(ctx, true);
  assert.strictEqual(cells(again).length, 18);
  drawAll(again);
});

test("以「執行指令碼」方式開啟時建立浮動視窗", () => {
  const ctx = newContext();
  const win = loadDist(ctx, false);
  assert.ok(win instanceof ctx.Window);
  assert.ok(win.shown);
  deq(ctx.__alerts || [], []);
});
