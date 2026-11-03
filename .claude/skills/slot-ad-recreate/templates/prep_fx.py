# v3：把沒用到的影片特效切成小段轉好（ProRes 4444 帶透明），組碗的狀態圖，寫進 meta.json
#   python prep_fx.py <Footage 資料夾>
import json
import os
import subprocess
import sys

from PIL import Image

FOOT = sys.argv[1]
VID = os.path.join(FOOT, "2_Video")
KIT = "kit"
OUT = os.path.join(KIT, "assets", "fx2")
os.makedirs(OUT, exist_ok=True)
meta = json.load(open(os.path.join(KIT, "meta.json"), encoding="utf-8"))
fx = meta.setdefault("fx2", {})


def ff(args):
    r = subprocess.run(["ffmpeg", "-v", "error", "-y"] + args, capture_output=True, text=True, encoding="utf-8")
    if r.returncode:
        raise RuntimeError(r.stderr[-600:])


def cut(src, key, t0, dur, w, vf_extra=""):
    """src 的 t0 ~ t0+dur 切成 ProRes 4444（已有 alpha 的保留；黑底的用 Add 混合，不去背）"""
    out = os.path.join(OUT, key + ".mov")
    vf = "scale=%d:-2%s,format=yuva444p10le" % (w, vf_extra)
    ff(["-ss", str(t0), "-t", str(dur), "-i", os.path.join(VID, src), "-vf", vf, "-c:v", "prores_ks", "-profile:v", "4444",
        "-pix_fmt", "yuva444p10le", "-an", out])
    fx[key] = {"file": os.path.relpath(out, KIT).replace("\\", "/"), "dur": dur}
    print(key, src, t0, dur)


# 能量元素包（帶透明）：一段一段切
E = "energy-combined-elements.mov"
cut(E, "burstGreen", 2.9, 0.6, 900)       # 綠色放射
cut(E, "starWhite", 3.4, 0.5, 900)        # 白色四角星
cut(E, "burstPink", 6.0, 0.5, 900)        # 粉紅放射
cut(E, "ringPink", 10.3, 0.9, 700)        # 粉紅魔法陣
cut(E, "ringBlue", 19.3, 0.6, 800)        # 藍色光環
cut(E, "slashGold", 16.4, 0.5, 900)       # 金色光弧
cut(E, "streakCyan", 7.3, 0.5, 900)       # 青色光束（寶石飛行）
cut(E, "burstStar", 18.3, 0.6, 800)       # 黃紫爆星（BIG WIN）
# 能量轉場包（帶透明）
X = "seamless-energy-anime-transition.mov"
cut(X, "wipeBlue", 2.4, 0.9, 1080)        # 藍白斜劃（轉盤進場）
cut(X, "burstBlue", 6.1, 0.5, 1080)       # 藍白放射（停輪）
cut(X, "wipeGold", 7.4, 0.9, 1080)        # 金色爆開（進免費遊戲）
cut(X, "boltGreen", 4.4, 0.4, 1080)       # 綠色閃電（辣椒人變綠）
# 黑底特效（Add 混合）
for src, key, t0, dur, w in [("fire-purple.mp4", "firePurple", 0, 6, 1280), ("Sparkle_01.mp4", "sparkle", 2, 6, 1280)]:
    out = os.path.join(OUT, key + ".mp4")
    ff(["-ss", str(t0), "-t", str(dur), "-i", os.path.join(VID, src), "-vf", "scale=%d:-2" % w, "-c:v", "libx264", "-crf", "18",
        "-pix_fmt", "yuv420p", "-an", out])
    fx[key] = {"file": os.path.relpath(out, KIT).replace("\\", "/"), "dur": dur, "blend": "add"}
    print(key, src)
# 角色 / 碗影片：青色底去背（和 prep_assets.py 同一組參數）
key_vf = "colorkey=0x2fe0e6:0.32:0.08,despill=type=blue:mix=0.5:expand=0"
for src, key, w in [("MG_cha_idel.mp4", "chaMGIdle", 700), ("FG_cha_idel.mp4", "chaFGIdle", 560), ("cha_happy.mp4", "chaHappy", 560),
                    ("blue_bow.mp4", "bowlBlueAni", 420)]:
    out = os.path.join(OUT, key + ".mov")
    ff(["-i", os.path.join(VID, src), "-vf", "%s,scale=%d:-2,format=yuva444p10le" % (key_vf, w), "-c:v", "prores_ks", "-profile:v", "4444",
        "-pix_fmt", "yuva444p10le", "-an", out])
    fx[key] = {"file": os.path.relpath(out, KIT).replace("\\", "/")}
    print(key, src)

# 碗的狀態：紅 / 綠 / 藍碗 PSD 的 less / half / full（已輸出在 layers/），組成完整的碗（背景 + 狀態 + 標籤）
bowls = {}
LAY = os.path.join("..", "spicyad", "layers")
for name, key, label in [("紅碗", "red", "EXTRA SPINS"), ("綠碗", "green", "EXTRA ROWS"), ("藍碗", "blue", "EXTRA PAYS")]:
    d = os.path.join(LAY, name)
    info = json.load(open(os.path.join(d, "layers.json"), encoding="utf-8")) if os.path.exists(os.path.join(d, "layers.json")) else None
    files = {f.split("_", 1)[1][:-4]: f for f in os.listdir(d) if f.endswith(".png")}
    base = [k for k in files if k in ("背景", "圖層 0")][0]
    bowls[key] = {}
    for state in ("less", "half", "full"):
        canvas = Image.new("RGBA", (900, 1080), (0, 0, 0, 0))
        for part in (state, label):
            l = [x for x in info["layers"] if x["name"] == part][0] if info else None
            im = Image.open(os.path.join(d, files[part])).convert("RGBA")
            canvas.alpha_composite(im, (max(0, l["bbox"][0]), max(0, l["bbox"][1])) if l else (0, 0))
        out = os.path.join(OUT, "bowl_%s_%s.png" % (key, state))
        canvas.save(out)
        bowls[key][state] = os.path.relpath(out, KIT).replace("\\", "/")
    print("bowl", key)
meta["bowlStates"] = bowls
json.dump(meta, open(os.path.join(KIT, "meta.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
