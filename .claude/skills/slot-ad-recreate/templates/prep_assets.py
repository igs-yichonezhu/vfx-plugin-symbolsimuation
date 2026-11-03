# Spicy Fortunes 假廣告：把 Footage 整理成建置用的素材（work/spicyad/kit/assets）與 meta.json
#   py311 prep_assets.py <Footage 資料夾> <kit 資料夾> [--step all|psd|video|audio]
# 需要 Pillow + psd-tools（PSD）與 ffmpeg（影片去背 / 轉檔）
import json
import os
import shutil
import subprocess
import sys

from PIL import Image, ImageFilter, ImageEnhance
from psd_tools import PSDImage

sys.stdout.reconfigure(encoding="utf-8")
FOOT, KIT = sys.argv[1], sys.argv[2]
STEP = sys.argv[sys.argv.index("--step") + 1] if "--step" in sys.argv else "all"
A = os.path.join(KIT, "assets")
PIC = os.path.join(FOOT, "3_Picture")
VID = os.path.join(FOOT, "2_Video")
AUD = os.path.join(FOOT, "4_Audio")
os.makedirs(A, exist_ok=True)
meta_path = os.path.join(KIT, "meta.json")
meta = json.load(open(meta_path, encoding="utf-8")) if os.path.exists(meta_path) else {}


def save_meta():
    json.dump(meta, open(meta_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


def sub(*p):
    d = os.path.join(A, *p[:-1])
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, p[-1])


def layer(psd, name, parent=None):
    for lyr in (parent or psd).descendants():
        if lyr.name == name:
            return lyr
    raise KeyError(name)


def export(lyr, path):
    lyr.visible = True
    im = lyr.composite(force=True).convert("RGBA")
    im.save(path)
    b = lyr.bbox
    return {"file": os.path.relpath(path, KIT).replace("\\", "/"), "x": b[0], "y": b[1], "w": im.width, "h": im.height,
            "cx": b[0] + im.width / 2, "cy": b[1] + im.height / 2}


def ff(args):
    r = subprocess.run(["ffmpeg", "-v", "error", "-y"] + args, capture_output=True, text=True, encoding="utf-8")
    if r.returncode:
        raise RuntimeError(r.stderr[-800:])


if STEP in ("all", "psd"):
    # ---------- 賭場背景：直式裁切、模糊、壓暗 ----------
    im = Image.open(os.path.join(PIC, "view-game-gambling-table-casino.jpg")).convert("RGB")
    k = 2112 / im.height
    im = im.resize((int(im.width * k), 2112), Image.LANCZOS)
    x0 = int(im.width * 0.42 - 594)
    im = im.crop((x0, 0, x0 + 1188, 2112)).filter(ImageFilter.GaussianBlur(7))
    im = ImageEnhance.Brightness(im).enhance(0.55)
    im.save(sub("bg", "casino.jpg"), quality=88)

    # ---------- 曲面機台：綠幕 → 透明洞 + 螢幕遮罩 ----------
    cab = PSDImage.open(os.path.join(PIC, "曲面機台 Layers", "曲面機台.psd"))
    fr = layer(cab, "圖層 1")
    fr.visible = True
    frame = fr.composite(force=True).convert("RGBA")
    px = frame.load()
    W, H = frame.size
    matte = Image.new("L", (W, H), 0)
    mp = matte.load()
    for y in range(H):
        for x in range(W):
            r, g, b, a = px[x, y]
            if a > 0 and g > 150 and g > r * 1.6 and g > b * 1.6:
                mp[x, y] = 255
    bbox = matte.getbbox()
    # 遮罩往外擴 2px（蓋住綠邊），框上的綠色挖掉、邊緣去綠
    matte_d = matte.filter(ImageFilter.MaxFilter(5))
    for y in range(H):
        for x in range(W):
            r, g, b, a = px[x, y]
            if matte_d.getpixel((x, y)) > 0:
                px[x, y] = (r, g, b, 0)
            elif a > 0 and g > max(r, b):
                px[x, y] = (r, min(g, max(r, b)), b, a)
    frame.save(sub("cabinet", "frame.png"))
    mimg = Image.new("RGBA", (W, H), (255, 255, 255, 0))
    mimg.putalpha(matte_d)
    mimg.save(sub("cabinet", "screen_matte.png"))
    meta["cabinet"] = {"frame": "assets/cabinet/frame.png", "matte": "assets/cabinet/screen_matte.png", "w": W, "h": H,
                       "psdX": fr.bbox[0], "psdY": fr.bbox[1], "screen": list(bbox)}
    print("cabinet", W, H, "screen bbox", bbox)

    # ---------- 轉輪2（彩金轉盤） ----------
    wp = PSDImage.open(os.path.join(PIC, "轉輪2 Layers", "轉輪2.psd"))
    wheel = {"canvas": [wp.width, wp.height]}
    for nm, key in [("top", "top"), ("轉輪", "disk"), ("外框", "ring"), ("框", "spokes"), ("選擇框", "select"), ("指針", "pointer"), ("圓心", "hub")]:
        wheel[key] = export(layer(wp, nm), sub("wheel", key + ".png"))
    meta["wheel"] = wheel

    # ---------- MG 畫面（轉盤場景用）：天空背景、上下 UI、三個碗 ----------
    mg = PSDImage.open(os.path.join(PIC, "MG Layers", "MG.psd"))
    full = mg.topil().convert("RGBA")
    full.crop((0, 0, 1080, 136)).save(sub("mg", "top_ui.png"))
    full.crop((0, 1762, 1080, 1920)).save(sub("mg", "bottom_ui.png"))
    mgm = {"topUI": {"file": "assets/mg/top_ui.png", "x": 0, "y": 0}, "bottomUI": {"file": "assets/mg/bottom_ui.png", "x": 0, "y": 1762}}
    sky = Image.new("RGBA", (1080, 1920), (0, 0, 0, 0))
    for nm in ["漸層填色 1", "cloud_1", "cloud_1 拷貝", "cloud_1 拷貝 2", "cloud_1 拷貝 3"]:
        l = layer(mg, nm)
        l.visible = True
        c = l.composite(force=True).convert("RGBA")
        sky.alpha_composite(c, (max(0, l.bbox[0]), max(0, l.bbox[1])), (max(0, -l.bbox[0]), max(0, -l.bbox[1])))
    sky.save(sub("mg", "sky.png"))
    mgm["sky"] = {"file": "assets/mg/sky.png"}
    mgm["stone"] = export(layer(mg, "石板"), sub("mg", "stone.png"))
    for nm, key in [("紅碗", "bowlRed"), ("藍碗", "bowlBlue"), ("綠碗", "bowlGreen"), ("cha", "cha")]:
        mgm[key] = export(layer(mg, nm), sub("mg", key + ".png"))
    meta["mg"] = mgm

    # ---------- FG 畫面：背景（空格子）、符號 ----------
    fg = PSDImage.open(os.path.join(PIC, "FG Layers", "FG.psd"))
    comp = fg.topil().convert("RGBA")
    grid = layer(fg, "轉輪框")
    grid.visible = True
    gi = grid.composite(force=True).convert("RGBA")
    comp.alpha_composite(gi, (grid.bbox[0], grid.bbox[1]))
    comp.convert("RGB").save(sub("fg", "bg.jpg"), quality=92)
    fgm = {"bg": {"file": "assets/fg/bg.jpg"}, "grid": [grid.bbox[0], grid.bbox[1], gi.width, gi.height]}
    fgm["cha"] = export(layer(fg, "cha"), sub("fg", "cha_static.png"))
    sym = {}
    sym["CHILI"] = export(layer(fg, "辣椒"), sub("fg", "symbols", "CHILI.png"))
    sym["DDIA"] = export(layer(fg, "2彩鑽"), sub("fg", "symbols", "DDIA.png"))
    off = layer(fg, "SYMBOLS_off")
    names = {"藍鑽": "BLUE", "A": "A", "Q": "Q", "吉他": "GUITAR", "粉鑽": "PINK", "塔可": "TACO", "綠鑽": "GREEN", "10": "TEN", "J": "J", "K": "K"}
    done = set()
    for l in off.descendants():
        base = l.name.replace(" 拷貝 2", "").replace(" 拷貝", "")
        if l.is_group() or base not in names or base in done:
            continue
        done.add(base)
        l.visible = True
        im = l.composite(force=True).convert("RGBA")
        # FG 裡沒中的符號是暗紫色剪影：灰階後疊紫色、降低亮度
        g = im.convert("L")
        g = ImageEnhance.Contrast(g).enhance(0.8)
        tint = Image.merge("RGB", [g.point(lambda v: int(30 + v * 0.30)), g.point(lambda v: int(8 + v * 0.12)), g.point(lambda v: int(32 + v * 0.26))])
        dim = tint.convert("RGBA")
        dim.putalpha(im.getchannel("A"))
        p = sub("fg", "symbols", "OFF_" + names[base] + ".png")
        dim.save(p)
        sym["OFF_" + names[base]] = {"file": os.path.relpath(p, KIT).replace("\\", "/"), "w": im.width, "h": im.height}
    blank = Image.new("RGBA", (200, 200), (0, 0, 0, 0))
    blank.save(sub("fg", "symbols", "BLANK.png"))
    sym["BLANK"] = {"file": "assets/fg/symbols/BLANK.png", "w": 200, "h": 200}
    fgm["symbols"] = sym
    meta["fg"] = fgm

    # 格子線：轉輪框內部的暗線（列 / 欄位置）
    gl = gi.convert("L")
    gw, gh = gl.size
    cols = [sum(gl.getpixel((x, y)) for y in range(int(gh * 0.2), int(gh * 0.8), 4)) for x in range(gw)]
    rows = [sum(gl.getpixel((x, y)) for x in range(int(gw * 0.2), int(gw * 0.8), 4)) for y in range(gh)]
    meta["fg"]["gridProfile"] = {"cols": cols, "rows": rows}

    # ---------- 雙辣椒 / 辣椒底板 連續圖：縮小、只留要用的格數 ----------
    for seq, key, n, scale in [("雙辣椒_opening", "chiliOpen", 45, 0.25), ("雙辣椒_in", "chiliLoop", 150, 0.25), ("辣椒底板", "plate", 150, 0.82)]:
        src = os.path.join(PIC, seq)
        fs = sorted(os.listdir(src))[:n]
        d = os.path.join(A, "seq", key)
        os.makedirs(d, exist_ok=True)
        for i, f in enumerate(fs):
            im = Image.open(os.path.join(src, f)).convert("RGBA")
            im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
            im.save(os.path.join(d, "%s_%05d.png" % (key, i)), optimize=True)
        meta.setdefault("seq", {})[key] = {"first": "assets/seq/%s/%s_00000.png" % (key, key), "frames": n, "scale": scale,
                                           "w": im.width, "h": im.height}
        print("seq", key, n, im.size)

    for f, key in [("BIG WIN.png", "bigwin"), ("放射光_02.png", "rays")]:
        shutil.copy(os.path.join(PIC, f), sub("fx", key + ".png"))
        im = Image.open(os.path.join(PIC, f))
        meta.setdefault("fx", {})[key] = {"file": "assets/fx/%s.png" % key, "w": im.width, "h": im.height}
    save_meta()

if STEP in ("all", "video"):
    vm = meta.setdefault("video", {})
    # 角色：青色底去背 → ProRes 4444（AE / EffectCraft 都吃）
    key = "colorkey=0x2fe0e6:0.32:0.08,despill=type=blue:mix=0.5:expand=0"
    for f, k, size in [("FG_cha_idel.mp4", "chaIdle", 560), ("FG_cha_ani.mp4", "chaFire", 560), ("cha_happy.mp4", "chaHappy", 560)]:
        out = sub("video", k + ".mov")
        ff(["-i", os.path.join(VID, f), "-vf", "%s,scale=%d:-2,format=yuva444p10le" % (key, size), "-c:v", "prores_ks", "-profile:v", "4444",
            "-pix_fmt", "yuva444p10le", "-an", out])
        vm[k] = {"file": os.path.relpath(out, KIT).replace("\\", "/"), "src": f}
    # 綠鑽（黑底）→ 去黑
    out = sub("video", "gemGreen.mov")
    ff(["-i", os.path.join(VID, "diamond_idel.mp4"), "-vf", "colorkey=black:0.12:0.1,scale=600:-2,format=yuva444p10le", "-c:v", "prores_ks",
        "-profile:v", "4444", "-pix_fmt", "yuva444p10le", "-an", out])
    vm["gemGreen"] = {"file": os.path.relpath(out, KIT).replace("\\", "/")}
    # 火焰 / 星光（黑底，用 Add 混合）：縮小、裁短、轉 H.264
    for f, k, t0, dur, w in [("15549614_MotionElements_explosion-fire-particle-loop-animation-hd.mp4", "fireJet", 0, 4, 1280),
                             ("13793515_MotionElements_bonfire-cartoon-fire-animation-middle-torch-link-hd.mp4", "fireBurst", 0, 4, 960),
                             ("fire particles overlay 4k  ( Fire particials black screen .mp4", "embers", 5, 12, 1280),
                             ("4k Flashing Stars.mov", "stars", 0, 8, 1280),
                             ("Sparks_01.mp4", "sparks", 0, 0.6, 1280)]:
        out = sub("video", k + ".mp4")
        ff(["-ss", str(t0), "-t", str(dur), "-i", os.path.join(VID, f), "-vf", "scale=%d:-2" % w, "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-an", out])
        vm[k] = {"file": os.path.relpath(out, KIT).replace("\\", "/"), "blend": "add"}
    # 彩帶（ProRes 4444 有 alpha）：縮小
    out = sub("video", "confetti.mov")
    ff(["-i", os.path.join(VID, "birthday-celebration-confetti-loop-animation-hd.mov"), "-vf", "scale=1080:-2,format=yuva444p10le", "-c:v", "prores_ks",
        "-profile:v", "4444", "-pix_fmt", "yuva444p10le", "-an", out])
    vm["confetti"] = {"file": os.path.relpath(out, KIT).replace("\\", "/")}
    save_meta()
    print("video done", list(vm))

if STEP in ("all", "audio"):
    am = meta.setdefault("audio", {})
    for f, k in [("From Texas to Mexico.mp3", "music"), ("Button_02.m4a", "button"), ("138_JP_Around.wav", "jpAround"),
                 ("Slava Pogorelsky - Crystal Clear - Beer Mug Spinning on Side.wav", "wheelSpin"), ("special_stop3_common.wav", "wheelStop"),
                 ("symbol_award_small.mp3", "award"), ("Cristian Lucchetta - Practical Magic - Sudden Fire Flame.wav", "flame"),
                 ("Alan Dalcastagne - Fantasy World - Fire Ball Spell.wav", "fireball"), ("reel_scatter_stop_3.mp3", "chiliStop"),
                 ("FG_scatter_stop2.mp3", "gemStop"), ("NearWin_FG.mp3", "nearWin"), ("Winning_sound_1.wav", "bigWin"),
                 ("Ni Sound - Cute Interface -  Bubble Pop Notification.wav", "pop"), ("Bet_unlock.mp3", "unlock"), ("10_MaxBet.wav", "maxBet")]:
        out = sub("audio", k + ".wav")
        ff(["-i", os.path.join(AUD, f), "-ac", "2", "-ar", "48000", out] if k != "music" else ["-t", "40", "-i", os.path.join(AUD, f), "-ac", "2", "-ar", "48000", out])
        r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out], capture_output=True, text=True)
        am[k] = {"file": os.path.relpath(out, KIT).replace("\\", "/"), "dur": float(r.stdout.strip())}
    save_meta()
    print("audio done", list(am))
