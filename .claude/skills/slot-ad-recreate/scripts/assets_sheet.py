# 素材總覽：每支影片抽 3 張（開頭 / 中間 / 結尾）、每個連續圖抽 3 張、靜態圖各一張，標名稱、長度、尺寸、是否有 alpha
# python assets_sheet.py <Footage 資料夾> <輸出.jpg>
import json
import os
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw, ImageFont

sys.stdout.reconfigure(encoding="utf-8")
root, out = sys.argv[1], sys.argv[2]
font = ImageFont.truetype("C:/Windows/Fonts/msjh.ttc", 14)
tmp = tempfile.mkdtemp()
rows = []


def probe(f):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_name,width,height,pix_fmt,r_frame_rate",
                        "-of", "json", f], capture_output=True, text=True, encoding="utf-8")
    return json.loads(r.stdout)


def grab(f, t, i):
    p = os.path.join(tmp, "g%d_%d.png" % (len(rows), i))
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", "%.3f" % t, "-i", f, "-frames:v", "1", p])
    return Image.open(p).convert("RGBA") if os.path.exists(p) else None


vids = sorted(os.listdir(os.path.join(root, "2_Video")))
for v in vids:
    f = os.path.join(root, "2_Video", v)
    info = probe(f)
    d = float(info["format"].get("duration", 0))
    st = [s for s in info["streams"] if s.get("width")][0]
    ims = [grab(f, t, i) for i, t in enumerate([0.05, d / 2, max(0, d - 0.2)])]
    rows.append(("%s  %.1fs %dx%d %s %s" % (v, d, st["width"], st["height"], st.get("codec_name"), st.get("pix_fmt")), ims))
pic = os.path.join(root, "3_Picture")
for seq in ["辣椒底板", "雙辣椒_in", "雙辣椒_opening"]:
    fs = sorted(os.listdir(os.path.join(pic, seq)))
    ims = [Image.open(os.path.join(pic, seq, fs[k])).convert("RGBA") for k in (0, len(fs) // 2, len(fs) - 1)]
    rows.append(("%s  %d frames %dx%d %s" % (seq, len(fs), ims[0].width, ims[0].height, Image.open(os.path.join(pic, seq, fs[0])).mode), ims))
for still in ["BIG WIN.png", "放射光_02.png", "view-game-gambling-table-casino.jpg"]:
    im = Image.open(os.path.join(pic, still))
    rows.append(("%s  %dx%d %s" % (still, im.width, im.height, im.mode), [im.convert("RGBA")]))

H = 150
canvas_rows = []
for label, ims in rows:
    tiles = []
    for im in ims:
        if im is None:
            continue
        k = H / im.height
        t = im.resize((max(1, int(im.width * k)), H))
        bg = Image.new("RGBA", t.size, (90, 90, 90, 255))
        # 棋盤格看 alpha
        dd = ImageDraw.Draw(bg)
        for y in range(0, t.height, 12):
            for x in range(0, t.width, 12):
                if (x // 12 + y // 12) % 2:
                    dd.rectangle([x, y, x + 11, y + 11], fill=(140, 140, 140, 255))
        bg.alpha_composite(t)
        tiles.append(bg.convert("RGB"))
    w = sum(t.width for t in tiles) + 4 * len(tiles)
    row = Image.new("RGB", (max(w, 700), H + 20), (20, 20, 20))
    ImageDraw.Draw(row).text((4, 2), label, font=font, fill=(255, 230, 120))
    x = 0
    for t in tiles:
        row.paste(t, (x, 20))
        x += t.width + 4
    canvas_rows.append(row)
W = max(r.width for r in canvas_rows)
# 兩欄排
half = (len(canvas_rows) + 1) // 2
colH = sum(r.height for r in canvas_rows[:half])
sheet = Image.new("RGB", (W * 2 + 10, colH), (0, 0, 0))
y = 0
for r in canvas_rows[:half]:
    sheet.paste(r, (0, y))
    y += r.height
y = 0
for r in canvas_rows[half:]:
    sheet.paste(r, (W + 10, y))
    y += r.height
sheet.save(out, quality=82)
print("wrote", out, sheet.size)
for label, _ in rows:
    print(label)
