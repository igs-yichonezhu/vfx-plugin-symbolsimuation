/*
 * SlotFakeSpin - main.js
 * 進入點：放在 ScriptUI Panels 時 thisObj 是 Panel（可停駐）；用「執行指令碼」時會開浮動視窗。
 */
try {
    SFS.ui.create(thisObj);
} catch (err) {
    alert("SlotFakeSpin 啟動失敗：" + err.toString() + (err.line ? "（line " + err.line + "）" : ""), "SlotFakeSpin");
}
