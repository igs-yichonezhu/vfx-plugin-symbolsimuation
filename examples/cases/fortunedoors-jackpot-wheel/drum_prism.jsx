// 滾筒（六角柱）：每塊牌子是一個平面，相鄰兩面差 SIDE_DEG 度，牌子間距 = 轉帶上的格距
// θ = (STRIP_CTRL.y + 轉帶位置 − 中心) / 格距 × 每面角度
// 位置 y = 中心 + 內切半徑·sin(θ)·透視；高度 × cos(θ)·透視；寬度 × 透視；越轉離正面越暗
var SIDE_DEG = 60, D = 1400, SHADE = 120;
var rc = null, i;
for (i = 1; i <= app.project.numItems; i++) {
    var it = app.project.item(i);
    if (it instanceof CompItem && /_R1$/.test(it.name)) { rc = it; }
}
var pitch = 0, ys = [];
for (i = 1; i <= rc.numLayers; i++) { if (rc.layer(i).name !== "STRIP_CTRL") { ys.push(rc.layer(i).transform.position.value[1]); } }
ys.sort(function (a, b) { return a - b; });
pitch = ys[1] - ys[0];
var alpha = SIDE_DEG * Math.PI / 180, apo = pitch / (2 * Math.tan(alpha / 2));
var n = 0;
for (i = 1; i <= rc.numLayers; i++) {
    var L = rc.layer(i);
    if (L.name === "STRIP_CTRL") { continue; }
    var p = L.transform.position.value;
    var head = "var cy = thisComp.layer(\"STRIP_CTRL\").transform.yPosition; var c = thisComp.height / 2;" +
        " var th = (cy + " + p[1] + " - c) / " + pitch + " * " + alpha + "; var lim = Math.PI / 2;" +
        " var t = Math.max(-lim, Math.min(lim, th)); var a = " + apo + ";" +
        " var per = " + D + " / (" + D + " + a * (1 - Math.cos(t))); var k = Math.abs(th) < lim ? Math.cos(th) : 0;";
    L.transform.position.expression = head + " [value[0], c + a * Math.sin(t) * per - cy]";
    L.transform.scale.expression = head + " [value[0] * per, value[1] * k * per]";
    var fx = L.property("ADBE Effect Parade").addProperty("ADBE Brightness & Contrast 2");
    fx.property(1).expression = head + " -" + SHADE + " * (1 - k)";
    n++;
}
"prism drum on " + n + " layers, pitch " + pitch + ", apothem " + Math.round(apo) + ", comp " + rc.width + "x" + rc.height;
