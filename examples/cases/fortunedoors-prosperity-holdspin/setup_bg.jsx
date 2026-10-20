// D_210 祿盤：1920x1080 主合成 HS（30fps、17.5 秒），最底層放影片畫面背景
var f = new File(app.project.file.parent.fsName + "/bg.png");
var io = new ImportOptions(f);
var bg = app.project.importFile(io);
var comp = app.project.items.addComp("HS", 1920, 1080, 1, 17.5, 30);
var l = comp.layers.add(bg);
l.name = "BG (D_210 0s)";
writeLn("ok " + comp.name + " " + bg.name + " " + bg.width + "x" + bg.height);
