# v2 素材：轉盤場景照 MG.psd 原位、轉盤換成轉輪1（MG 內嵌那份）；每個圖層存 PNG + 在畫面上的位置（中心、縮放）
#   py311 prep_v2.py <Footage 資料夾> <kit 資料夾>
import json
import os
import sys

from PIL import Image
from psd_tools import PSDImage

sys.stdout.reconfigure(encoding="utf-8")
FOOT, KIT = sys.argv[1], sys.argv[2]
A = os.path.join(KIT, "assets", "mg2")
os.makedirs(A, exist_ok=True)
meta = json.load(open(os.path.join(KIT, "meta.json"), encoding="utf-8"))
mg = PSDImage.open(os.path.join(FOOT, "3_Picture", "MG Layers", "MG.psd"))
full = mg.topil().convert("RGBA")
out = {}


def rel(p):
    return os.path.relpath(p, KIT).replace("\\", "/")


def put(key, im, x, y, scale=1.0):
    """im 的左上角放在畫面 (x, y)，scale = 圖片 → 畫面的縮放"""
    p = os.path.join(A, key + ".png")
    im.save(p)
    out[key] = {"file": rel(p), "w": im.width, "h": im.height, "scale": scale,
                "cx": round(x + im.width * scale / 2, 3), "cy": round(y + im.height * scale / 2, 3)}


def top(name):
    for l in mg:
        if l.name == name:
            return l
    raise KeyError(name)


def layer_px(l):
    l.visible = True
    return l.composite(force=True).convert("RGBA")


# 天空（漸層 + 雲）
sky = Image.new("RGBA", (1080, 1920), (0, 0, 0, 0))
for l in top("BG"):
    im = layer_px(l)
    sky.alpha_composite(im, (max(0, l.bbox[0]), max(0, l.bbox[1])), (max(0, -l.bbox[0]), max(0, -l.bbox[1])))
put("sky", sky, 0, 0)
# 轉輪2（後面的大轉盤，不動）、辣椒人、石板、三個碗：MG 圖層像素 + bbox
for name, key in [("轉輪2", "wheel2"), ("cha", "cha"), ("石板", "stone"), ("紅碗", "bowlRed"), ("藍碗", "bowlBlue"), ("綠碗", "bowlGreen")]:
    l = top(name)
    put(key, layer_px(l), l.bbox[0], l.bbox[1])
# 上方 UI：底板 + 四個彩金數字（不要合成圖裡的帽子）
tu = Image.new("RGBA", (1080, 140), (0, 0, 0, 0))
for l in top("TOP UI"):
    im = layer_px(l)
    tu.alpha_composite(im, (max(0, l.bbox[0]), max(0, l.bbox[1])), (max(0, -l.bbox[0]), max(0, -l.bbox[1])))
put("topUI", tu, 0, 0)
# 轉輪區（石板下半、轉輪框、5x3 符號、下方 UI）：碗的下緣以下直接用 PSD 合成圖（都是不動的）
REEL_Y = 1106
put("reels", full.crop((0, REEL_Y, 1080, 1920)), 0, REEL_Y)

# 轉輪1：MG 內嵌的那份（和 MG 畫面一模一樣），畫布 → 畫面 = 原點 (ox, oy)、縮放 k
so = json.load(open(os.path.join(os.path.dirname(__file__), "psd", "mg_so.json"), encoding="utf-8"))["layers"]["轉輪1"]
k = so["scale"][0]
ox = so["center"][0] - so["content"][0] * k / 2
oy = so["center"][1] - so["content"][1] * k / 2
emb = PSDImage.open(os.path.join(os.path.dirname(__file__), "psd", "embedded", "MG_轉輪1.psb"))
wheel = {"k": k, "origin": [ox, oy]}
for l in emb:
    key = {"top": "w1top", "轉盤": "w1disk", "選擇框": "w1select", "圓心": "w1hub", "指針": "w1pointer"}[l.name]
    im = layer_px(l)
    put(key, im, ox + l.bbox[0] * k, oy + l.bbox[1] * k, k)
    wheel[key] = out[key]
# 轉盤中心（盤面的 alpha 外框中心）
disk = out["w1disk"]
wheel["center"] = [disk["cx"], disk["cy"]]
meta["mg2"] = out
meta["wheel1"] = wheel
json.dump(meta, open(os.path.join(KIT, "meta.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(json.dumps({k2: (v["cx"], v["cy"], v["scale"]) for k2, v in out.items()}, ensure_ascii=False))
print("wheel center", wheel["center"], "k", k)

# 對位檢查：照 PSD 疊回去，和 PSD 合成圖比
canvas = Image.new("RGBA", (1080, 1920), (0, 0, 0, 255))
order = ["sky", "wheel2", "w1disk", "w1select", "w1hub", "w1pointer", "w1top", "cha", "stone", "reels", "bowlRed", "bowlGreen", "bowlBlue", "topUI"]
for key in order:
    o = out[key]
    im = Image.open(os.path.join(KIT, o["file"])).convert("RGBA")
    if o["scale"] != 1:
        im = im.resize((round(o["w"] * o["scale"]), round(o["h"] * o["scale"])), Image.LANCZOS)
    x, y = round(o["cx"] - im.width / 2), round(o["cy"] - im.height / 2)
    canvas.alpha_composite(im, (max(0, x), max(0, y)), (max(0, -x), max(0, -y)))
from PIL import ImageChops, ImageStat
d = ImageChops.difference(canvas.convert("RGB"), full.convert("RGB"))
print("rebuild vs PSD composite: mean diff", [round(v, 2) for v in ImageStat.Stat(d).mean])
side = Image.new("RGB", (1080, 960)); side.paste(canvas.convert("RGB").resize((540, 960)), (0, 0)); side.paste(full.convert("RGB").resize((540, 960)), (540, 0))
side.save(os.path.join(os.path.dirname(__file__), "chk", "mg_rebuild_vs_psd.jpg"), quality=85)
