# D_210 祿盤 Hold & Spin 測試素材：
#  - 金幣 C200 / C400 / C800 / C1200：試玩素材/hscoin_blank.png 寫上面額
#  - MINI：圖騰/FD_MINI_BONUS.png
#  - BLANK（空格紫色圓球）：影片第 0 秒左上格
#  素材是 RGB 裁圖，這裡統一挖成圓形（透明背景），轉動時才不會露出方形底。
#  - bg.png：影片第 0 秒，6 個格子的位置蓋成盤面紅色（格子由 SlotFakeSpin 畫）
# 用法：python make_hs_assets.py --assets <FortuneDoors 素材資料夾> --frame <影片第 0 秒畫面.png> [--out 輸出資料夾]
#   --assets：裡面要有 試玩素材/hscoin_blank.png、圖騰/FD_MINI_BONUS.png
#   --frame：競品影片 D_210.mp4 第 0 秒那一格（1920x1080），例如 ffmpeg -ss 0 -i D_210.mp4 -frames:v 1 f0.png
#   格子座標是照那支影片量的，換別的素材要重新量。
import argparse
import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ap = argparse.ArgumentParser()
ap.add_argument("--assets", required=True)
ap.add_argument("--frame", required=True)
ap.add_argument("--out", default=os.path.dirname(os.path.abspath(__file__)))
args = ap.parse_args()
R = args.assets
W = args.out
os.makedirs(W + "/symbols", exist_ok=True)

# 影片裡量到的格子中心（第 0 秒畫面）：欄 575 / 848 / 1122，列 319 / 577
COLS = (575, 848, 1122)
ROWS = (319, 577)
CELL = 240


def circle_cut(im, cx, cy, radius, feather=2):
    im = im.convert("RGBA")
    mask = Image.new("L", im.size, 0)
    ImageDraw.Draw(mask).ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=255)
    if feather:
        mask = mask.filter(ImageFilter.GaussianBlur(feather))
    im.putalpha(mask)
    box = (int(cx - radius - feather * 2), int(cy - radius - feather * 2), int(cx + radius + feather * 2), int(cy + radius + feather * 2))
    return im.crop(box)


def font(size):
    for f in ("C:/Windows/Fonts/ariblk.ttf", "C:/Windows/Fonts/arialbd.ttf"):
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


def coin(value):
    im = Image.open(R + "/試玩素材/hscoin_blank.png").convert("RGBA")
    d = ImageDraw.Draw(im)
    text = str(value)
    size = 84
    while size > 20:
        f = font(size)
        l, t, r, b = d.textbbox((0, 0), text, font=f, stroke_width=5)
        if r - l <= 180 and b - t <= 80:
            break
        size -= 2
    cx, cy = im.width / 2, 125
    pos = (cx - (r - l) / 2 - l, cy - (b - t) / 2 - t)
    # 白到淡藍的字 + 深藍描邊（像影片裡的面額）
    txt = Image.new("L", im.size, 0)
    ImageDraw.Draw(txt).text(pos, text, font=f, fill=255)
    stroke = Image.new("L", im.size, 0)
    ImageDraw.Draw(stroke).text(pos, text, font=f, fill=255, stroke_width=5, stroke_fill=255)
    im.paste((28, 34, 70, 255), (0, 0), stroke)
    grad = Image.new("RGBA", im.size)
    gd = ImageDraw.Draw(grad)
    for y in range(im.height):
        k = max(0.0, min(1.0, (y - (cy - 35)) / 70))
        gd.line([(0, y), (im.width, y)], fill=(int(250 - 70 * k), int(252 - 40 * k), 255, 255))
    im.paste(grad, (0, 0), txt)
    return circle_cut(im, im.width / 2, 125, 121)


for v in (200, 400, 800, 1200):
    coin(v).save(W + "/symbols/C%d.png" % v)

mini = Image.open(R + "/圖騰/FD_MINI_BONUS.png")
circle_cut(mini, mini.width / 2, mini.height / 2, 126).save(W + "/symbols/MINI.png")

frame0 = Image.open(args.frame).convert("RGB")
circle_cut(frame0, 581.5, 319, 117).save(W + "/symbols/BLANK.png")

# 背景：格子位置蓋成盤面紅：每一行用格子左右兩側的盤面顏色線性內插，邊緣羽化
bg = frame0.copy()
PW = CELL + 10
for cy in ROWS:
    for cx in COLS:
        x0, x1 = cx - PW // 2, cx + PW // 2
        patch = Image.new("RGB", (PW, PW))
        for j in range(PW):
            y = cy - PW // 2 + j
            def avg(xs):
                ps = [frame0.getpixel((x, y)) for x in xs]
                return [sum(p[i] for p in ps) / len(ps) for i in range(3)]
            lc, rc = avg(range(x0 - 9, x0 - 3)), avg(range(x1 + 3, x1 + 9))
            for i in range(PW):
                k = i / (PW - 1)
                patch.putpixel((i, j), tuple(int(lc[c] + (rc[c] - lc[c]) * k) for c in range(3)))
        m = Image.new("L", patch.size, 0)
        ImageDraw.Draw(m).rounded_rectangle((0, 0, PW - 1, PW - 1), radius=20, fill=255)
        m = m.filter(ImageFilter.GaussianBlur(4))
        bg.paste(patch, (x0, cy - PW // 2), m)
bg.save(W + "/bg.png")
print("ok", sorted(os.listdir(W + "/symbols")), "board center", ((COLS[0] + COLS[2]) / 2, (ROWS[0] + ROWS[1]) / 2))
