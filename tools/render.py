#!/usr/bin/env python3
"""
SlotFakeSpin 預覽繪製（需要 Pillow：pip install pillow）

  render.py symbols <symbols.json> <out.png>          符號總覽（名稱 + 圖），給 agent 對照盤面截圖用
  render.py scene   <scene.json> gif   <out.gif>      動畫預覽
  render.py scene   <scene.json> sheet <out.png> [欄數]  關鍵畫面總覽（每格標時間 / 事件）

scene.json 由 tools/sfs.js 產生（關鍵影格用和 AE 相同的 Bezier 計算）。這只是預覽，最終以 AE 為準。
Hold & Spin（mode = holdspin）的場景用 cells（每格一個視窗）取代 reels。
"""
import json
import math
import os
import sys

from PIL import Image, ImageDraw, ImageFont

BG = (22, 12, 34)
REEL_BG = (248, 244, 234)


def load_font(size):
    for f in ("DejaVuSans-Bold.ttf", "arialbd.ttf", "Arial Bold.ttf", "Helvetica.ttc"):
        try:
            return ImageFont.truetype(f, size)
        except OSError:
            continue
    for d in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "C:/Windows/Fonts/arialbd.ttf",
              "/System/Library/Fonts/Supplemental/Arial Bold.ttf"):
        if os.path.exists(d):
            return ImageFont.truetype(d, size)
    return ImageFont.load_default()


def hex_rgb(h, fallback=(255, 200, 60)):
    h = (h or "").strip().lstrip("#")
    if len(h) != 6:
        return fallback
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def placeholder(name, w, h):
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([4, 4, w - 5, h - 5], radius=min(w, h) // 8, fill=(90, 90, 110, 255), outline=(255, 255, 255, 200), width=3)
    f = load_font(max(10, min(w, h) // 6))
    tw = d.textlength(name, font=f)
    d.text(((w - tw) / 2, h / 2 - f.size / 2), name, font=f, fill=(255, 255, 255, 255))
    return im


class SymbolCache:
    def __init__(self, paths, cell_w, cell_h, mode="fit", scale=100, scales=None):
        self.paths, self.cw, self.ch, self.mode, self.scale = paths, cell_w, cell_h, mode, scale
        self.scales = scales or {}  # 個別符號的額外縮放 %（symbols[i].scale）
        self.src, self.cache = {}, {}

    def source(self, name):
        if name not in self.src:
            im = None
            p = self.paths.get(name) or ""
            if p and os.path.exists(p):
                try:
                    im = Image.open(p).convert("RGBA")
                except Exception:
                    im = None
            self.src[name] = im
        return self.src[name]

    def get(self, name, rel=1.0):
        key = (name, round(rel, 3))
        if key in self.cache:
            return self.cache[key]
        im = self.source(name)
        if im is None:
            out = placeholder(name, max(4, int(self.cw * rel)), max(4, int(self.ch * rel)))
        else:
            k = self.scale / 100.0 * self.scales.get(name, 100) / 100.0
            if self.mode == "fit":
                k *= min(self.cw / im.width, self.ch / im.height)
            k *= rel
            out = im.resize((max(1, int(round(im.width * k))), max(1, int(round(im.height * k)))), Image.LANCZOS)
        self.cache[key] = out
        return out


def paste_center(dst, im, cx, cy):
    """以中心點貼上（超出邊界的部分自動裁切）"""
    dst.paste(im, (int(round(cx - im.width / 2)), int(round(cy - im.height / 2))), im)


def reel_window(sc, syms, strip, y):
    win = Image.new("RGBA", (sc["reelW"], sc["reelH"]), REEL_BG + (255,))
    pitch, ch = sc["pitch"], sc["cellH"]
    for k, name in enumerate(strip):
        cy = y + k * pitch + ch / 2
        if cy + ch < -ch or cy - ch > sc["reelH"] + ch:
            continue
        paste_center(win, syms.get(name), sc["reelW"] / 2, cy)
    return win


def perimeter_point(cx, cy, w, h, u):
    """矩形周長上比例 u（0~1，從右上角順時針）的點"""
    p = 2 * (w + h)
    d = (u % 1.0) * p
    x0, y0, x1, y1 = cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2
    if d < w:
        return x1 - d, y0
    d -= w
    if d < h:
        return x0, y0 + d
    d -= h
    if d < w:
        return x0 + d, y1
    d -= w
    return x1, y1 - d


def draw_frame(img, fr):
    over = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(over)
    col = hex_rgb(fr["color"])
    a = int(255 * fr["alpha"])
    box = [fr["cx"] - fr["w"] / 2, fr["cy"] - fr["h"] / 2, fr["cx"] + fr["w"] / 2, fr["cy"] + fr["h"] / 2]
    r = int(min(24, fr["w"] / 4))
    wid = max(1, int(fr["width"]))
    d.rounded_rectangle(box, radius=r, outline=col + (a // 3,), width=wid * 3)
    d.rounded_rectangle(box, radius=r, outline=col + (a,), width=wid)
    light = tuple(int(c + (255 - c) * 0.65) for c in col)
    for base in (fr["phase"], fr["phase"] + 0.5):
        steps = 24
        pts = [perimeter_point(fr["cx"], fr["cy"], fr["w"], fr["h"], 1 - (base + fr["runner"] * i / steps)) for i in range(steps + 1)]
        d.line(pts, fill=light + (a,), width=max(2, int(wid * 1.2)))
    img.alpha_composite(over)


def draw_line(img, ln):
    over = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(over)
    col = hex_rgb(ln["color"])
    for c in ln["boxes"]:
        bw = ln["boxW"]
        d.rounded_rectangle([c[0] - ln["cellW"] / 2 + bw / 2, c[1] - ln["cellH"] / 2 + bw / 2,
                             c[0] + ln["cellW"] / 2 - bw / 2, c[1] + ln["cellH"] / 2 - bw / 2],
                            radius=int(min(20, ln["cellW"] / 6)), outline=col + (255,), width=max(1, int(bw)))
    pts = ln["points"]
    if len(pts) < 2:
        img.alpha_composite(over)
        return
    seg = [math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1)]
    total, want = sum(seg), sum(seg) * max(0.0, min(1.0, ln["progress"]))
    drawn, acc = [pts[0]], 0.0
    for i, s in enumerate(seg):
        if acc + s <= want:
            drawn.append(pts[i + 1])
            acc += s
        else:
            k = (want - acc) / s if s else 0
            drawn.append((pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k))
            break
    w = max(1, int(ln["width"]))
    if len(drawn) > 1 and total > 0:
        d.line(drawn, fill=col + (90,), width=w * 3, joint="curve")
        d.line(drawn, fill=col + (255,), width=w, joint="curve")
        for p in drawn:
            d.ellipse([p[0] - w / 2, p[1] - w / 2, p[0] + w / 2, p[1] + w / 2], fill=col + (255,))
    img.alpha_composite(over)


def render_frame(sc, syms, fr):
    img = Image.new("RGBA", (sc["width"], sc["height"]), BG + (255,))
    for ri, reel in enumerate(sc["reels"]):
        ys = fr["reels"][ri]
        acc = None
        for si, y in enumerate(ys):
            win = reel_window(sc, syms, reel["strip"], y).convert("RGB")
            acc = win if acc is None else Image.blend(acc, win, 1.0 / (si + 1))
        img.paste(acc, (int(round(reel["x"] - sc["reelW"] / 2)), sc["margin"]))
    # Hold & Spin：每格一個 1 格高的視窗（reelW × reelH = 格子大小），以格子中心貼上
    for ci, cell in enumerate(sc.get("cells", [])):
        acc = None
        for si, y in enumerate(fr["cells"][ci]):
            win = reel_window(sc, syms, cell["strip"], y).convert("RGB")
            acc = win if acc is None else Image.blend(acc, win, 1.0 / (si + 1))
        img.paste(acc, (int(round(cell["x"] - sc["reelW"] / 2)), int(round(cell["y"] - sc["reelH"] / 2))))
    for fo in fr["frames"]:
        draw_frame(img, fo)
    for w in fr["wins"]:
        paste_center(img, syms.get(w["name"], w["scale"]), w["cx"], w["cy"])
    for ln in fr["lines"]:
        draw_line(img, ln)
    return img


def scaled(img, k):
    if k == 1:
        return img
    return img.resize((max(1, int(img.width * k)), max(1, int(img.height * k))), Image.LANCZOS)


def cmd_scene(scene_path, mode, out, extra):
    sc = json.load(open(scene_path, encoding="utf-8"))
    syms = SymbolCache(sc["symbols"], sc["cellW"], sc["cellH"], sc.get("scaleMode", "fit"), sc.get("symbolScale", 100),
                       sc.get("symbolScales"))
    k = sc.get("outScale", 1.0)
    if mode == "gif":
        frames = [scaled(render_frame(sc, syms, fr), k).convert("RGB").convert("P", palette=Image.ADAPTIVE, colors=160)
                  for fr in sc["frames"]]
        frames[0].save(out, save_all=True, append_images=frames[1:], duration=int(1000 / sc["fps"]), loop=0, optimize=True)
        print("wrote", out, len(frames), "frames")
        return
    cols = int(extra[0]) if extra else 2
    tiles = []
    font = load_font(max(14, int(22 * max(k, 0.5))))
    for fr in sc["frames"]:
        im = scaled(render_frame(sc, syms, fr), k).convert("RGB")
        d = ImageDraw.Draw(im)
        label = "%s  %.2fs (f%d)" % (fr["label"], fr["t"], round(fr["t"] * sc["fps"]))
        d.rectangle([0, 0, d.textlength(label, font=font) + 16, font.size + 10], fill=(0, 0, 0))
        d.text((8, 4), label, font=font, fill=(255, 230, 120))
        tiles.append(im)
    tw, th = tiles[0].size
    rows = (len(tiles) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * tw + (cols - 1) * 8, rows * th + (rows - 1) * 8), (0, 0, 0))
    for i, t in enumerate(tiles):
        sheet.paste(t, ((i % cols) * (tw + 8), (i // cols) * (th + 8)))
    sheet.save(out)
    print("wrote", out, len(tiles), "tiles")


def cmd_symbols(data_path, out):
    data = json.load(open(data_path, encoding="utf-8"))
    items = data["symbols"]
    cell, cols = 160, min(6, max(1, len(items)))
    rows = (len(items) + cols - 1) // cols
    font = load_font(18)
    sheet = Image.new("RGB", (cols * cell, rows * (cell + 30)), (30, 30, 36))
    syms = SymbolCache({s["name"]: s["path"] for s in items}, cell - 20, cell - 20)
    for i, s in enumerate(items):
        x, y = (i % cols) * cell, (i // cols) * (cell + 30)
        im = syms.get(s["name"])
        sheet.paste(im, (int(x + cell / 2 - im.width / 2), int(y + 10 + (cell - 20) / 2 - im.height / 2)), im)
        d = ImageDraw.Draw(sheet)
        tag = s["name"] + ("" if s.get("filler", True) else " *")
        d.text((x + cell / 2 - d.textlength(tag, font=font) / 2, y + cell + 2), tag, font=font, fill=(255, 255, 255))
    sheet.save(out)
    print("wrote", out, len(items), "symbols")


if __name__ == "__main__":
    if len(sys.argv) >= 4 and sys.argv[1] == "symbols":
        cmd_symbols(sys.argv[2], sys.argv[3])
    elif len(sys.argv) >= 5 and sys.argv[1] == "scene":
        cmd_scene(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5:])
    else:
        print(__doc__)
        sys.exit(2)
