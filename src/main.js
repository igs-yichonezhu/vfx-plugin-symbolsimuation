/*
 * SlotFakeSpin - main.js
 * 進入點：放在 ScriptUI Panels 時 thisObj 是 Panel（可停駐）；用「執行指令碼」時會開浮動視窗。
 */
var T = SFS.t;
try {
    SFS.ae.initLang();
    SFS.ui.create(thisObj);
} catch (err) {
    alert(T("SlotFakeSpin 啟動失敗：{0}{1}", err.toString(), err.line ? T("（line {0}）", err.line) : ""), "SlotFakeSpin");
}
