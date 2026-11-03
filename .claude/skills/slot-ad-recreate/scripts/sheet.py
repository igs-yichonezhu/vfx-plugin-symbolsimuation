# 影片總覽：每隔 step 秒抽一張、標時間、拼成總覽圖
# python sheet.py <影片> <輸出.png> <開始秒> <結束秒> <間隔秒> [欄數] [寬]
import subprocess
import sys
import tempfile
import os
from PIL import Image, ImageDraw, ImageFont

src, out, t0, t1, step = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4]), float(sys.argv[5])
cols = int(sys.argv[6]) if len(sys.argv) > 6 else 8
w = int(sys.argv[7]) if len(sys.argv) > 7 else 180
tmp = tempfile.mkdtemp()
tiles = []
t = t0
font = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 16)
while t <= t1 + 1e-6:
    f = os.path.join(tmp, "%08.3f.png" % t)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", "%.3f" % t, "-i", src, "-frames:v", "1", "-vf", "scale=%d:-2" % w, f], check=True)
    if os.path.exists(f):
        im = Image.open(f).convert("RGB")
        d = ImageDraw.Draw(im)
        label = "%.1fs" % t
        d.rectangle([0, 0, d.textlength(label, font=font) + 8, 20], fill=(0, 0, 0))
        d.text((4, 1), label, font=font, fill=(255, 230, 80))
        tiles.append(im)
    t += step
tw, th = tiles[0].size
rows = (len(tiles) + cols - 1) // cols
sheet = Image.new("RGB", (cols * tw + (cols - 1) * 4, rows * th + (rows - 1) * 4), (0, 0, 0))
for i, im in enumerate(tiles):
    sheet.paste(im, ((i % cols) * (tw + 4), (i // cols) * (th + 4)))
sheet.save(out)
print("wrote", out, len(tiles), "tiles", sheet.size)
