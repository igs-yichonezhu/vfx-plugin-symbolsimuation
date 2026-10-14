#!/usr/bin/env python3
"""把 tools/preview.js 輸出的逐格資料畫成 GIF（含簡易動態模糊），只用來檢查手感。"""
import json, os, sys
from PIL import Image, ImageDraw

data_path, sym_dir, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
d = json.load(open(data_path))
L = d["layout"]
cw, ch, pitch = L["cellW"], L["cellH"], L["cellH"] + L["gapY"]
bw, bh = d["plan"]["boardW"], d["plan"]["boardH"]
pad = 14
icons = {}
for f in os.listdir(sym_dir):
    if f.lower().endswith(".png"):
        icons[os.path.splitext(f)[0]] = Image.open(os.path.join(sym_dir, f)).convert("RGBA").resize((cw, ch), Image.LANCZOS)

frames = []
for fr in d["frames"]:
    canvas = Image.new("RGB", (bw + pad * 2, bh + pad * 2), (24, 10, 40))
    for ri, reel in enumerate(d["reels"]):
        x0 = int(reel["x"] - cw / 2)
        acc = None
        for si, y in enumerate(fr[ri]):
            win = Image.new("RGBA", (cw, bh), (250, 246, 236, 255))
            for k, name in enumerate(reel["strip"]):
                top = y + k * pitch
                if top > bh or top + ch < 0:
                    continue
                win.alpha_composite(icons[name], (0, int(round(top))))
            arr = win.convert("RGB")
            acc = arr if acc is None else Image.blend(acc, arr, 1.0 / (si + 1))
        canvas.paste(acc, (pad + x0, pad))
    dr = ImageDraw.Draw(canvas)
    dr.rectangle([pad - 3, pad - 3, pad + bw + 2, pad + bh + 2], outline=(250, 200, 60), width=3)
    frames.append(canvas.convert("P", palette=Image.ADAPTIVE, colors=128))

frames[0].save(out_path, save_all=True, append_images=frames[1:] + [frames[-1]] * 20,
               duration=int(1000 / d["fps"]), loop=0, optimize=True)
print("wrote", out_path, len(frames), "frames")
