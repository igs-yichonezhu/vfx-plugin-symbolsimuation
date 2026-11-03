// 在模擬 AE（test/mock_ae.js）跑 <案子>/kit/build_ad.jsx：檢查 AE 路線（開新專案、$.evalFile 套用 SlotFakeSpin、存 .aep）沒有程式錯誤
// node mock_check.js <案子資料夾>
// 模擬環境沒有的 AE 功能在這裡補最小的替身：混合模式、遮罩類型、音訊屬性、Displacement Map
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ROOT = path.join(__dirname, "../../../..");
const H = require(path.join(ROOT, "test/helpers"));
const KIT = path.join(path.resolve(process.argv[2] || "."), "kit");
fs.copyFileSync(path.join(ROOT, "dist/SlotFakeSpin_apply.jsx"), path.join(KIT, "SlotFakeSpin_apply.jsx"));
const ctx = H.newContext();
ctx.BlendingMode = { NORMAL: 5212, ADD: 5220, SCREEN: 5223 };
ctx.TrackMatteType = { NO_TRACK_MATTE: 5012, ALPHA: 5013 };
// 音訊屬性與 Displacement Map：替身
const origProp = ctx.Layer.prototype.property;
ctx.Layer.prototype.property = function (mn) {
  if (mn === "ADBE Audio Group") {
    const lv = this.__lv || (this.__lv = new ctx.Property("Audio Levels", "ADBE Audio Levels", [0, 0]));
    return { property: () => lv };
  }
  const r = origProp.call(this, mn);
  if ((mn === "ADBE Effect Parade" || mn === "Effects") && r) {
    const add = r.addProperty.bind(r);
    r.addProperty = (m) => {
      if (m !== "ADBE Displacement Map") return add(m);
      const props = [];
      for (let i = 0; i < 8; i++) props.push(new ctx.Property("p" + (i + 1), "ADBE Displacement Map-000" + (i + 1), 0));
      return { numProperties: 8, property: (i) => props[i - 1], name: "Displacement Map" };
    };
  }
  return r;
};
ctx.$.global = ctx;
ctx.$.fileName = path.join(KIT, "build_ad.jsx");
ctx.$.evalFile = (f) => vm.runInContext(fs.readFileSync(f.fsName, "utf8"), ctx, { filename: path.basename(f.fsName) });
ctx.SFS_AD_QUIET = true;
vm.runInContext(fs.readFileSync(ctx.$.fileName, "utf8"), ctx, { filename: "build_ad.jsx" });
const R = ctx.SFS_AD_RESULT;
console.log(JSON.stringify({ ok: R.ok, errors: R.errors, warnings: R.warnings, comps: R.comps, saved: R.saved && path.basename(R.saved) }));
const items = ctx.app.project._items;
const ad = items.find((it) => it.name === "AD_SpicyFortunes");
if (ad) console.log("AD layers:", ad._layers.map((l) => l.name).join(" | "));
const fg = items.find((it) => it.name === "FG_SCENE");
if (fg) console.log("FG layers:", fg._layers.length, fg._layers.slice(0, 6).map((l) => l.name).join(" | "), "…");
try { fs.unlinkSync(path.join(KIT, "SpicyFortunes_AD.aep")); } catch (e) { /* mock file */ }
