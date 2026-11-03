# PSD 智慧物件的放置變形（四個角落）→ 中心、寬高、旋轉、相對原始內容的縮放；寫成 json 給 director 對位用
#   py311 so_transforms.py <psd> <輸出.json> [圖層名 ...]
import json
import math
import sys

from psd_tools import PSDImage
from psd_tools.constants import Tag

sys.stdout.reconfigure(encoding="utf-8")
src, out = sys.argv[1], sys.argv[2]
want = set(sys.argv[3:])
psd = PSDImage.open(src)
res = {"canvas": [psd.width, psd.height], "layers": {}}


def placed(l):
    d = l.tagged_blocks.get_data(Tag.SMART_OBJECT_LAYER_DATA1) or l.tagged_blocks.get_data(Tag.SMART_OBJECT_LAYER_DATA2)
    desc = getattr(d, "data", None)
    if desc is None:
        return None
    t = desc.get(b"Trnf") or desc.get(b"transform")
    size = desc.get(b"Sz  ")
    w0 = h0 = None
    if size is not None:
        w0, h0 = float(size.get(b"Wdth")), float(size.get(b"Hght"))
    return [float(x) for x in t] if t is not None else None, (w0, h0)


for l in psd.descendants():
    if l.kind != "smartobject" or (want and l.name not in want):
        continue
    p = placed(l)
    if not p or not p[0]:
        continue
    t, (w0, h0) = p
    w = math.dist((t[0], t[1]), (t[2], t[3]))
    h = math.dist((t[2], t[3]), (t[4], t[5]))
    ang = math.degrees(math.atan2(t[3] - t[1], t[2] - t[0]))
    cx, cy = sum(t[0::2]) / 4, sum(t[1::2]) / 4
    info = {"center": [round(cx, 2), round(cy, 2)], "size": [round(w, 2), round(h, 2)], "rot": round(ang, 3),
            "content": [w0, h0], "scale": [round(w / w0, 5) if w0 else None, round(h / h0, 5) if h0 else None], "bbox": list(l.bbox)}
    key = l.name
    n = 2
    while key in res["layers"]:
        key = "%s#%d" % (l.name, n)
        n += 1
    res["layers"][key] = info
    print(key, info)
json.dump(res, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
