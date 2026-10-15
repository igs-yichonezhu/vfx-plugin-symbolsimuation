/*
 * SlotFakeSpin - apply.js
 * 自動化入口（給 tools/sfs.js / agent 用）：讀設定檔 → 在 AE 建立或更新盤面 → 輸出結果與檢查用畫面。
 *
 * 由啟動腳本先設定 $.global.SFS_APPLY 再 $.evalFile 本檔：
 *   { preset: 設定檔路徑, mode: "auto"|"new"|"update", comp: 目標合成名稱（可省略 = 目前合成）,
 *     board: 盤面合成名稱（可省略）, result: 結果 JSON 路徑, frames: "auto"|"none"|[秒...], framesDir: 輸出資料夾,
 *     position: [x, y] 盤面圖層位置（可省略 = 新建時放中央、更新時不動） }
 * EffectCraft（tools/sfs.js ec）另外用：
 *   config: 直接帶設定內容（取代 preset；腳本只能讀專案資料夾裡的檔案）, base: 設定裡相對路徑的基準資料夾,
 *   print: true = 結果用 writeLn 輸出一行「SFS_RESULT <json>」、不寫檔、不輸出檢查畫面（只回傳 shots，由 CLI 算圖）
 * 直接從「檔案 > 指令碼 > 執行指令碼檔案」執行時，會跳出對話框選設定檔。
 */
var job = null;
try { job = $.global.SFS_APPLY || null; $.global.SFS_APPLY = null; } catch (e0) { job = null; }
var interactive = !job;
var result = { ok: false, version: SFS.VERSION, errors: [], warnings: [], frames: [] };

function readText(path) {
    var f = new File(path);
    if (!f.exists) { throw new Error("找不到設定檔：" + path); }
    f.encoding = "UTF-8";
    f.open("r");
    var t = f.read();
    f.close();
    return t;
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
function autoShots(plan, offset) {
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
        var pf = File.openDialog("選擇 SlotFakeSpin 設定檔（.json）");
        if (!pf) { throw new Error("已取消"); }
        job = { preset: pf.fsName, mode: "auto" };
    }
    var cfg = job.config ? SFS.absolutizePaths(SFS.normalizeConfig(job.config), job.base || "") :
        SFS.absolutizePaths(SFS.normalizeConfig(SFS.json.parse(readText(job.preset))), new File(job.preset).parent.fsName);
    var target = job.comp ? SFS.ae.findComp(job.comp) : SFS.ae.activeComp();
    if (job.comp && !target) { throw new Error("找不到合成「" + job.comp + "」"); }
    var mode = job.mode || "auto";
    var boardLayer = null;
    if (target && mode !== "new") {
        boardLayer = SFS.ae.findBoardLayer(target, job.board || "");
        if (mode === "update" && !boardLayer) { throw new Error("在合成「" + target.name + "」裡找不到要更新的盤面圖層"); }
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
        if (job.position) {
            try { res.boardLayer.transform.position.setValue([Number(job.position[0]), Number(job.position[1])]); }
            catch (ePos) { result.warnings.push("無法設定盤面位置（位置有關鍵影格？）：" + ePos.toString()); }
        }
        var pos = res.boardLayer.transform.position.value;
        result.position = [pos[0], pos[1]];
        result.startTime = res.plan.startTime + offset;
        result.allSettled = res.plan.allSettled + offset;
        result.endTime = res.plan.endTime + offset;
        result.markers = [];
        for (var i = 0; i < res.plan.markers.length; i++) {
            result.markers.push({ t: res.plan.markers[i].t + offset, frame: Math.round((res.plan.markers[i].t + offset) * res.plan.fps), label: res.plan.markers[i].label });
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
    result.errors.push(err.toString() + (err.line ? "（line " + err.line + "）" : ""));
}

writeResult();
if (job && job.print && typeof writeLn === "function") { writeLn("SFS_RESULT " + SFS.json.stringify(result)); }
if (interactive) {
    if (result.ok) {
        alert("SlotFakeSpin：完成 " + result.board + "（全部停妥 " + (Math.round(result.allSettled * 100) / 100) + " 秒）" +
            (result.warnings.length ? "\n" + result.warnings.join("\n") : ""), "SlotFakeSpin");
    } else if (result.errors.join("") !== "Error: 已取消") {
        alert(result.errors.join("\n"), "SlotFakeSpin");
    }
}
