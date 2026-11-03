# 曲面螢幕的位移圖（AE / EffectCraft 的 Displacement Map 用）：SCREEN 合成每一列的整個寬度壓進機台螢幕那一列的寬度
#   python make_map.py <kit 資料夾>
# 讀 kit/meta.json 的 cabinet（螢幕遮罩、範圍），寫 assets/cabinet/screen_map.png 與 meta.cabinet.map / mapMax / screenScale
import json
import os
import sys

from PIL import Image

KIT = sys.argv[1]
meta = json.load(open(os.path.join(KIT, "meta.json"), encoding="utf-8"))
cab = meta["cabinet"]
matte = Image.open(os.path.join(KIT, cab["matte"])).getchannel("A")
W, H = matte.size
sb = cab["screen"]
scale = max((sb[2] - sb[0]) / 1080, (sb[3] - sb[1]) / 1920) + 0.006   # 和 director.jsx 的 SCREEN 縮放一樣
cx, cy = (sb[0] + sb[2]) / 2, (sb[1] + sb[3]) / 2
INSET = 4
rows = {}
for y in range(sb[1], sb[3] + 1):
    xs = [x for x in range(sb[0], sb[2] + 1) if matte.getpixel((x, y)) > 128]
    if xs:
        rows[y] = (xs[0] + INSET, xs[-1] - INSET)
ys = sorted(rows)
# 框上的反光會讓某幾段寬度突跳：左右邊界各用多項式擬合（反覆去掉離群點），得到平滑的沙漏形
import numpy as np


def robust_fit(y, v, deg=4, rounds=4):
    y = np.asarray(y, float)
    v = np.asarray(v, float)
    keep = np.ones(len(y), bool)
    t = (y - y.mean()) / (y.std() or 1)
    for _ in range(rounds):
        c = np.polyfit(t[keep], v[keep], deg)
        res = v - np.polyval(c, t)
        s = np.median(np.abs(res[keep])) * 1.4826 + 0.5
        keep = np.abs(res) < 2.5 * s
    return lambda yy: np.polyval(c, (np.asarray(yy, float) - y.mean()) / (y.std() or 1))


fl = robust_fit(ys, [rows[k][0] for k in ys])
fr = robust_fit(ys, [rows[k][1] for k in ys])
smooth = {y: (float(fl(y)), float(fr(y))) for y in ys}
print("edges top", [round(v) for v in smooth[ys[0]]], "waist", [round(v) for v in smooth[ys[len(ys) // 2]]], "bottom", [round(v) for v in smooth[ys[-1]]])

MAX = 230.0
mp = Image.new("RGB", (1080, 1920))
px = mp.load()
worst = 0
for yc in range(1920):
    yf = round((yc - 960) * scale + cy)
    yf = min(max(yf, ys[0]), ys[-1])
    while yf not in smooth:
        yf += 1
    Lf, Rf = smooth[yf]
    L = (Lf - cx) / scale + 540
    R = (Rf - cx) / scale + 540
    for x in range(1080):
        xs = (min(max(x, L), R) - L) / (R - L) * 1080
        d = xs - x
        worst = max(worst, abs(d))
        v = int(round(128 + d / MAX * 127.5))
        px[x, yc] = (max(0, min(255, v)), 128, 128)
out = os.path.join(KIT, "assets", "cabinet", "screen_map.png")
mp.save(out)
cab["map"] = "assets/cabinet/screen_map.png"
cab["mapMax"] = MAX
cab["screenScale"] = scale
json.dump(meta, open(os.path.join(KIT, "meta.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("map", out, "scale", round(scale, 4), "max displacement", round(worst, 1), "of", MAX)
