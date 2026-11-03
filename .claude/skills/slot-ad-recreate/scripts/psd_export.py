# 把 PSD 的指定圖層（含隱藏的）各自輸出成 PNG（整張畫布大小或裁切），並寫出位置 json
# python psd_export.py <psd> <輸出資料夾> [--crop]
import json
import os
import sys

from psd_tools import PSDImage

sys.stdout.reconfigure(encoding="utf-8")
src, out = sys.argv[1], sys.argv[2]
crop = "--crop" in sys.argv
os.makedirs(out, exist_ok=True)
psd = PSDImage.open(src)
info = {"width": psd.width, "height": psd.height, "layers": []}
for i, lyr in enumerate(psd):
    if lyr.is_group():
        continue
    im = lyr.composite(force=True)  # 隱藏的也算
    if im is None:
        continue
    b = lyr.bbox
    name = lyr.name.replace("/", "_")
    fn = "%02d_%s.png" % (i, name)
    if crop:
        im.save(os.path.join(out, fn))
    else:
        from PIL import Image
        canvas = Image.new("RGBA", (psd.width, psd.height), (0, 0, 0, 0))
        canvas.alpha_composite(im.convert("RGBA"), (max(0, b[0]), max(0, b[1])), (max(0, -b[0]), max(0, -b[1])))
        canvas.save(os.path.join(out, fn))
    info["layers"].append({"index": i, "name": lyr.name, "file": fn, "bbox": list(b), "visible": lyr.visible,
                           "size": [im.width, im.height], "center": [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]})
    print(fn, b, "visible" if lyr.visible else "hidden", im.mode)
json.dump(info, open(os.path.join(out, "layers.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
