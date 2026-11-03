# 找連續圖（燒的辣椒格 / 底板）對到靜態辣椒格的縮放與位移：在靜態圖不透明的範圍內，灰階差最小
#   python calibrate.py <靜態.png> <連續圖一格.png> [縮放下限 上限]
import sys

import numpy as np
from PIL import Image

ref = Image.open(sys.argv[1]).convert("RGBA")
src = Image.open(sys.argv[2]).convert("RGBA")
lo, hi = (float(sys.argv[3]), float(sys.argv[4])) if len(sys.argv) > 4 else (0.9, 1.6)
R = np.asarray(ref.convert("L"), float)
mask = np.asarray(ref.getchannel("A")) > 230
# 中間的辣椒最有特徵：只看內部 80%
h, w = R.shape
inner = np.zeros_like(mask)
inner[int(h * .1):int(h * .9), int(w * .1):int(w * .9)] = True
mask &= inner


def score(s, dx, dy):
    W, H = round(src.width * s), round(src.height * s)
    im = src.resize((W, H), Image.BILINEAR)
    # 連續圖中心 + (dx, dy) 對到靜態圖中心
    ox = round(W / 2 - w / 2 + dx)
    oy = round(H / 2 - h / 2 + dy)
    if ox < 0 or oy < 0 or ox + w > W or oy + h > H:
        canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        canvas.alpha_composite(im, (max(0, -ox), max(0, -oy)), (max(0, ox), max(0, oy)))
        crop = canvas
    else:
        crop = im.crop((ox, oy, ox + w, oy + h))
    C = np.asarray(crop.convert("L"), float)
    return float(np.mean(np.abs(C - R)[mask]))


best = None
for s in np.arange(lo, hi + 1e-9, 0.02):
    for dx in range(-12, 13, 3):
        for dy in range(-60, 61, 3):
            v = score(s, dx, dy)
            if best is None or v < best[0]:
                best = (v, s, dx, dy)
v, s0, dx0, dy0 = best
for s in np.arange(s0 - 0.03, s0 + 0.031, 0.005):
    for dx in range(dx0 - 3, dx0 + 4):
        for dy in range(dy0 - 3, dy0 + 4):
            v = score(s, dx, dy)
            if v < best[0]:
                best = (v, s, dx, dy)
print("best diff %.2f scale %.4f dx %d dy %d" % best)
