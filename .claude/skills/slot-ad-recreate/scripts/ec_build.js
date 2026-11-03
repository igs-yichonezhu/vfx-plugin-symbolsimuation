// 在 EffectCraft 建整支廣告（內嵌 SlotFakeSpin 套用程式，因為 EffectCraft 沒有 $.evalFile），存成 <案子>/kit/ad.ecproj，算幾張畫面拼總覽
// node ec_build.js <案子資料夾> [秒,秒,...] [--screen] [--video out.mp4]
const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const ROOT = path.join(__dirname, "../../../..");
const CASE = path.resolve(process.argv[2] || ".");
process.argv.splice(2, 1);
const KIT = path.join(CASE, "kit").split(path.sep).join("/");
const EC = process.env.LOCALAPPDATA + "/Programs/ArtCraft/effectcraft-0.3.1-windows-x64-portable/effectcraft-cli.exe";
const apply = fs.readFileSync(path.join(ROOT, "dist/SlotFakeSpin_apply.jsx"), "utf8");
fs.copyFileSync(path.join(ROOT, "dist/SlotFakeSpin_apply.jsx"), path.join(KIT, "SlotFakeSpin_apply.jsx"));
const build = fs.readFileSync(path.join(KIT, "build_ad.jsx"), "utf8");
const script = "var SFS_AD_DIR = " + JSON.stringify(KIT) + ";\nfunction SFS_APPLY_INLINE() {\n" + apply + "\n}\n" + build +
  "\nvar R = $.global.SFS_AD_RESULT; (R.ok ? 'OK ' + R.comps.join(',') + (R.warnings.length ? ' | WARN ' + R.warnings.join(' | ') : '') : 'FAIL ' + R.errors.join(' | '));\n";
fs.writeFileSync(path.join(KIT, "_ec_ad.jsx"), script);
const run = (args, opts) => cp.execFileSync(EC, args, Object.assign({ encoding: "utf8", maxBuffer: 1 << 28 }, opts || {}));
run(["script", "--eval", "1", "--empty", "--save-as", KIT + "/_seed.ecproj", "--json"]);
const t0 = Date.now();
const out = JSON.parse(run(["script", KIT + "/_ec_ad.jsx", "--project", KIT + "/_seed.ecproj", "--save-as", KIT + "/ad.ecproj", "--json"]));
console.log("build (" + ((Date.now() - t0) / 1000).toFixed(1) + "s):", out.ok ? out.result : "SCRIPT ERROR " + JSON.stringify(out.error));
const times = (process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "").split(",").filter(Boolean).map(Number);
const comp = process.argv.includes("--screen") ? "SCREEN" : "AD_SpicyFortunes";
const pngs = [];
fs.mkdirSync(path.join(CASE, "frames"), { recursive: true });
for (const t of times) {
  const f = path.join(CASE, "frames", comp + "_" + t.toFixed(2) + ".png");
  try {
    run(["render-frame", "--comp", comp, "--time", String(t), "--out", f, "--project", KIT + "/ad.ecproj", "--json"]);
    pngs.push([f, t]);
  } catch (e) { console.log("render-frame failed at", t, String(e.stdout || e.message).slice(0, 300)); }
}
if (pngs.length) {
  const py = "import sys\nfrom PIL import Image, ImageDraw\na=sys.argv[2:]\nims=[Image.open(f).convert('RGB') for f in a[0::2]]\n" +
    "k=300/ims[0].width\nims=[im.resize((300,int(im.height*k))) for im in ims]\ncols=min(6,len(ims))\nrows=(len(ims)+cols-1)//cols\n" +
    "w,h=ims[0].size\nsh=Image.new('RGB',(cols*w+(cols-1)*6,rows*h+(rows-1)*6))\n" +
    "for i,im in enumerate(ims):\n  d=ImageDraw.Draw(im); d.rectangle([0,0,64,18],fill=(0,0,0)); d.text((4,3),a[1::2][i]+'s',fill=(255,230,120))\n  sh.paste(im,((i%cols)*(w+6),(i//cols)*(h+6)))\nsh.save(sys.argv[1])\n";
  const sheet = path.join(CASE, "frames", "sheet_" + comp + ".png");
  cp.execFileSync("python", ["-I", "-c", py, sheet].concat(...pngs.map(([f, t]) => [f, t.toFixed(2)])));
  console.log("sheet:", sheet);
}
const vi = process.argv.indexOf("--video");
if (vi > 0) {
  const v = path.resolve(process.argv[vi + 1]);
  const t1 = Date.now();
  const r = run(["render", "--comp", comp, "--out", v, "--audio", "on", "--project", KIT + "/ad.ecproj", "--json"]);
  console.log("video (" + ((Date.now() - t1) / 1000).toFixed(0) + "s):", v, r.trim().split("\n").slice(-1)[0].slice(0, 200));
}
