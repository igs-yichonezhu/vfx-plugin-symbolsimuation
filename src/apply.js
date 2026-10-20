/*
 * SlotFakeSpin - apply.js
 * 自動化入口（給 tools/sfs.js / agent 用）：讀設定檔 → 在 AE 建立或更新盤面 → 輸出結果與檢查用畫面。
 *
 * 由啟動腳本先設定 $.global.SFS_APPLY 再 $.evalFile 本檔：
 *   { preset: 設定檔路徑, mode: "auto"|"new"|"update", comp: 目標合成名稱（可省略 = 目前合成）,
 *     board: 盤面合成名稱（可省略）, result: 結果 JSON 路徑, frames: "auto"|"none"|[秒...], framesDir: 輸出資料夾,
 *     position: [x, y] 盤面中心位置 | null 置中（可省略 = 用設定檔的 layout.position） }
 * EffectCraft（tools/sfs.js ec）另外用：
 *   config: 直接帶設定內容（取代 preset；腳本只能讀專案資料夾裡的檔案）, base: 設定裡相對路徑的基準資料夾,
 *   print: true = 結果用 writeLn 輸出一行「SFS_RESULT <json>」、不寫檔、不輸出檢查畫面（只回傳 shots，由 CLI 算圖）
 * 從頭建一個 AE 專案並存檔（sfs.js ae --new-project / aep-kit 用；檔案路徑可以是相對於 base 或設定檔資料夾）：
 *   newProject: true = 先開新專案, mainComp: { name, width, height, duration, fps } = 建主合成當目標,
 *   layers: [{ file, name, at: "bottom"|"top" }] = 主合成最底層 / 最上層放圖（背景、固定的框或指針）,
 *   postScripts: [檔案] = 盤面建好後執行（例如滾筒表達式；可以用 $.global.SFS_BUILD 拿到盤面合成）,
 *   saveAs: 檔案.aep = 最後存檔
 * 結果另外放在 $.global.SFS_APPLY_RESULT（不用寫檔就能讀）。
 * 直接從「檔案 > 指令碼 > 執行指令碼檔案」執行時，會跳出對話框選設定檔。
 */
var T = SFS.t;
var job = null;
try { job = $.global.SFS_APPLY || null; $.global.SFS_APPLY = null; } catch (e0) { job = null; }
SFS.ae.initLang(job && job.lang);
var interactive = !job;
var result = { ok: false, version: SFS.VERSION, errors: [], warnings: [], frames: [] };

function readText(path) {
    var f = new File(path);
    if (!f.exists) { throw new Error(T("找不到設定檔：{0}", path)); }
    f.encoding = "UTF-8";
    f.open("r");
    var t = f.read();
    f.close();
    return t;
}

// 工作參數裡的檔案路徑：絕對路徑照用，相對路徑以 base（或設定檔資料夾）為準
function jobFile(p) {
    if (SFS.isAbsolutePath(p)) { return new File(p); }
    var base = job.base || (job.preset ? new File(job.preset).parent.fsName : "");
    return new File(base ? base + "/" + p : p);
}

// 執行額外腳本：讀進來 eval（EffectCraft 沒有 $.evalFile，這樣 AE / EffectCraft 都能用）
function runScriptFile(file) {
    var code = readText(file.fsName);
    eval(code);
}

function addJobLayer(comp, spec) {
    var f = jobFile(spec.file);
    if (!f.exists) { throw new Error(T("找不到圖檔：{0}", f.fsName)); }
    var lyr = comp.layers.add(app.project.importFile(new ImportOptions(f)));
    if (spec.name) { lyr.name = spec.name; }
    if (spec.at === "top") { lyr.moveToBeginning(); } else { lyr.moveToEnd(); }
    return lyr;
}

function writeResult() {
    if (!job || !job.result) { return; }
    var f = new File(job.result);
    f.encoding = "UTF-8";
    if (f.open("w")) {
        f.write(SFS.json.stringify(result, 2));
        f.close();
    }
}

// 自動挑檢查畫面：開始、轉動中、每個標記（停輪 / 繞框 / 停妥）、每條連線顯示中
// Hold & Spin：開始、每回合轉動中與停妥
function autoShots(plan, offset) {
    if (plan.mode === "holdspin") { return SFS.hs.shots(plan, offset); }
    var shots = [], i;
    for (i = 0; i < plan.markers.length; i++) {
        var m = plan.markers[i];
        if (/^LINE /.test(m.label)) { continue; }
        shots.push({ t: m.t + offset, label: m.label });
        if (m.label === "SPIN" && plan.reels.length) {
            var firstStop = plan.reels[0].stopTime;
            for (var r = 1; r < plan.reels.length; r++) { firstStop = Math.min(firstStop, plan.reels[r].stopTime); }
            shots.push({ t: (m.t + firstStop) / 2 + offset, label: "SPINNING" });
        }
    }
    for (i = 0; i < plan.lines.length; i++) {
        var sh = plan.lines[i].shows;
        for (var k = 0; k < sh.length; k++) {
            shots.push({ t: (sh[k].start + sh[k].end) / 2 + offset, label: "LINE " + (i + 1) + (sh.length > 1 ? " #" + (k + 1) : "") });
        }
    }
    shots.sort(function (a, b) { return a.t - b.t; });
    // 同一時間的畫面只留一張，標籤合併
    var out = [];
    for (i = 0; i < shots.length; i++) {
        var last = out[out.length - 1];
        if (last && Math.abs(last.t - shots[i].t) < 1e-6) { last.label += " / " + shots[i].label; }
        else { out.push({ t: shots[i].t, label: shots[i].label }); }
    }
    return out;
}

try {
    if (interactive) {
        var pf = File.openDialog(T("選擇 SlotFakeSpin 設定檔（.json）"));
        if (!pf) { throw new Error(T("已取消")); }
        job = { preset: pf.fsName, mode: "auto" };
    }
    var cfg = job.config ? SFS.absolutizePaths(SFS.normalizeConfig(job.config), job.base || "") :
        SFS.absolutizePaths(SFS.normalizeConfig(SFS.json.parse(readText(job.preset))), new File(job.preset).parent.fsName);
    // 啟動腳本帶的盤面位置（sfs.js ae --position 可以臨時改；null = 置中 / 更新時不動）
    if (job.hasOwnProperty("position")) { cfg.layout.position = SFS.parsePosition(job.position); }
    if (job.newProject && !app.newProject()) { throw new Error(T("無法開新專案（目前的專案沒有關閉）")); }
    var target;
    if (job.mainComp) {
        var mc = job.mainComp;
        target = app.project.items.addComp(String(mc.name || job.comp || "Main"), Math.round(Number(mc.width)), Math.round(Number(mc.height)), 1,
            Number(mc.duration), Number(mc.fps) || cfg.layout.newCompFps || 30);
    } else {
        target = job.comp ? SFS.ae.findComp(job.comp) : SFS.ae.activeComp();
        if (job.comp && !target) { throw new Error(T("找不到合成「{0}」", job.comp)); }
    }
    var mode = job.mode || "auto";
    var boardLayer = null;
    if (target && mode !== "new") {
        boardLayer = SFS.ae.findBoardLayer(target, job.board || "");
        if (mode === "update" && !boardLayer) { throw new Error(T("在合成「{0}」裡找不到要更新的盤面圖層", target.name)); }
    }
    var res = SFS.ae.build(cfg, boardLayer ? { boardLayer: boardLayer } : { targetComp: target });
    result.errors = res.errors;
    result.warnings = res.warnings;
    if (!res.errors.length) {
        var offset = res.boardLayer.startTime || 0;
        result.ok = true;
        result.mode = boardLayer ? "update" : "new";
        result.target = res.target.name;
        result.targetSize = [res.target.width, res.target.height];
        result.targetDuration = res.target.duration;
        result.fps = res.plan.fps;
        result.board = res.boardComp.name;
        // 盤面位置已由 SFS.ae.build 依 layout.position 放好（job.position 在上面覆寫過），這裡只回報實際位置
        var pos = res.boardLayer.transform.position.value;
        result.position = [pos[0], pos[1]];
        result.startTime = res.plan.startTime + offset;
        result.allSettled = res.plan.allSettled + offset;
        result.endTime = res.plan.endTime + offset;
        result.markers = [];
        for (var i = 0; i < res.plan.markers.length; i++) {
            result.markers.push({ t: res.plan.markers[i].t + offset, frame: Math.round((res.plan.markers[i].t + offset) * res.plan.fps), label: res.plan.markers[i].label });
        }
        // Hold & Spin：每回合的時間、鎖住的格子（列-欄）、剩餘次數
        if (res.plan.mode === "holdspin") {
            result.rounds = [];
            for (i = 0; i < res.plan.rounds.length; i++) {
                var rd = res.plan.rounds[i], locks = [];
                for (var j = 0; j < rd.locks.length; j++) {
                    var lc = res.plan.cells[rd.locks[j]];
                    locks.push({ cell: lc.tag, symbol: lc.final });
                }
                result.rounds.push({ round: i + 1, start: rd.start + offset, settle: rd.settle + offset, cells: rd.cells.length,
                    locks: locks, spinsLeft: rd.spinsLeft, spinsAfter: rd.spinsAfter, end: rd.end });
            }
            result.finalBoard = res.plan.finalBoard;
        }
        // 主合成的背景 / 最上層圖、額外腳本、存檔（sfs.js ae --new-project、aep-kit）
        var specs = job.layers || [];
        for (i = 0; i < specs.length; i++) { addJobLayer(res.target, specs[i]); }
        $.global.SFS_BUILD = { board: res.boardComp, target: res.target, layer: res.boardLayer };
        var posts = job.postScripts || [];
        for (i = 0; i < posts.length; i++) {
            var ps = jobFile(posts[i]);
            if (!ps.exists) { throw new Error(T("找不到腳本：{0}", ps.fsName)); }
            try { runScriptFile(ps); } catch (ePost) { throw new Error(T("執行 {0} 時發生錯誤：{1}", decodeURI(ps.name), ePost.toString())); }
        }
        if (job.saveAs) {
            var sf = jobFile(job.saveAs);
            app.project.save(sf);
            result.saved = sf.fsName;
        }
        try { res.target.openInViewer(); res.target.time = Math.min(result.allSettled, res.target.duration); } catch (e1) { /* 舊版 AE */ }
        var shots = [];
        if (job.frames === "auto") { shots = autoShots(res.plan, offset); }
        else if (job.frames && job.frames.length && typeof job.frames !== "string") {
            for (i = 0; i < job.frames.length; i++) { shots.push({ t: Number(job.frames[i]), label: "T" + job.frames[i] }); }
        }
        result.shots = shots;
        var framesDir = job.framesDir || (job.result ? new File(job.result).parent.fsName + "/frames" : "");
        if (shots.length && framesDir && !job.print) {
            var ex = SFS.ae.exportFrames(res.target, shots, new Folder(framesDir));
            result.frames = ex.files;
            if (ex.error) { result.warnings.push(ex.error); }
        }
    }
} catch (err) {
    result.ok = false;
    result.errors.push(err.toString() + (err.line ? T("（line {0}）", err.line) : ""));
}

writeResult();
try { $.global.SFS_APPLY_RESULT = result; } catch (eG) { /* ignore */ }
if (job && job.print && typeof writeLn === "function") { writeLn("SFS_RESULT " + SFS.json.stringify(result)); }
if (interactive) {
    if (result.ok) {
        alert(T("SlotFakeSpin：完成 {0}（全部停妥 {1} 秒）{2}", result.board, Math.round(result.allSettled * 100) / 100, result.warnings.length ? "\n" + result.warnings.join("\n") : ""), "SlotFakeSpin");
    } else if (result.errors.join("") !== T("Error: 已取消")) {
        alert(result.errors.join("\n"), "SlotFakeSpin");
    }
}
