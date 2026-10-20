# 從 FD_JP_Spin.png 與影片畫面裁出 MAJOR / MEGA 牌（只取牌面內容，統一加金框），
# 另做背景（影片畫面，把滾輪窗蓋成金色滾筒）與固定的金色指針。
# 用法：python make_assets.py --assets <FortuneDoors 素材資料夾> --frame <MEGA 停在正中間的影片畫面.png> [--out 輸出資料夾]
#   --assets：裡面要有 圖騰/FD_JP_Spin.png
#   --frame：競品影片 D_210.mp4 第 20.1 秒那一格（1920x1080），例如
#            ffmpeg -ss 20.1 -i D_210.mp4 -frames:v 1 mega_frame.png
#   座標（牌面裁切、滾輪窗、指針位置）是照那支影片量的，換別的素材要重新量。
import sys, os, argparse
from PIL import Image, ImageDraw, ImageFilter
ap = argparse.ArgumentParser()
ap.add_argument("--assets", required=True)
ap.add_argument("--frame", required=True)
ap.add_argument("--out", default=os.path.dirname(os.path.abspath(__file__)))
args = ap.parse_args()
R = args.assets
W = args.out
os.makedirs(W + "/symbols", exist_ok=True)
PW, PH, RIM = 560, 290, 16

def plate(interior):
    """牌面內容 + 金框（外亮內暗兩層）"""
    out = Image.new("RGBA", (PW, PH), (0, 0, 0, 0))
    d = ImageDraw.Draw(out)
    d.rounded_rectangle((0, 0, PW - 1, PH - 1), radius=18, fill=(250, 196, 52, 255))
    d.rounded_rectangle((4, 4, PW - 5, PH - 5), radius=15, fill=(255, 228, 120, 255))
    d.rounded_rectangle((9, 9, PW - 10, PH - 10), radius=12, fill=(196, 128, 18, 255))
    d.rounded_rectangle((RIM - 3, RIM - 3, PW - RIM + 2, PH - RIM + 2), radius=8, fill=(40, 22, 10, 255))
    inner = interior.convert("RGB").resize((PW - 2 * RIM, PH - 2 * RIM), Image.LANCZOS)
    mask = Image.new("L", inner.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, inner.width - 1, inner.height - 1), radius=6, fill=255)
    out.paste(inner, (RIM, RIM), mask)
    return out

jp = Image.open(R + "/圖騰/FD_JP_Spin.png")
major = plate(jp.crop((88, 136, 562, 396)))
frame = Image.open(args.frame)
mega = plate(frame.crop((582, 342, 1038, 584)))
major.save(W + "/symbols/MAJOR.png")
mega.save(W + "/symbols/MEGA.png")
# 4:1（MEGA 機率 1/5，規格書）：MAJOR 多放 3 份當填充
for i in (2, 3, 4):
    major.save(W + "/symbols/MAJOR_%d.png" % i)

# 背景：影片畫面（1920x1080），滾輪窗蓋成金色滾筒
bg = frame.convert("RGB").copy()
win = (500, 150, 1100, 720)
drum = Image.new("RGB", (win[2] - win[0], win[3] - win[1]))
dd = ImageDraw.Draw(drum)
for y in range(drum.height):
    t = abs(y - drum.height / 2) / (drum.height / 2)
    c = (int(255 - 70 * t), int(190 - 90 * t), int(40 - 20 * t))
    dd.line([(0, y), (drum.width, y)], fill=c)
for x in range(drum.width):
    t = abs(x - drum.width / 2) / (drum.width / 2)
    if t > 0.86:
        k = (t - 0.86) / 0.14
        dd.line([(x, 0), (x, drum.height)], fill=(int(255 - 120 * k), int(200 - 120 * k), int(60 - 40 * k)))
m = Image.new("L", drum.size, 0)
ImageDraw.Draw(m).rounded_rectangle((0, 0, drum.width - 1, drum.height - 1), radius=40, fill=255)
m = m.filter(ImageFilter.GaussianBlur(6))
bg.paste(drum, win[:2], m)
bg.save(W + "/bg.png")

# 指針：左右兩個金色三角形（盤面中心列），透明背景
ptr = Image.new("RGBA", (1920, 1080), (0, 0, 0, 0))
pd = ImageDraw.Draw(ptr)
cx, cy = (win[0] + win[2]) // 2, 465   # 盤面中心（與 layout.position 一致）
for side in (-1, 1):
    ex = cx + side * (PW // 2 + 6)
    tip = cx + side * (PW // 2 - 34)
    pd.polygon([(ex + side * 36, cy - 52), (tip, cy), (ex + side * 36, cy + 52)], fill=(255, 214, 70, 255), outline=(150, 90, 10, 255))
    pd.polygon([(ex + side * 30, cy - 36), (tip + side * 14, cy), (ex + side * 30, cy + 36)], fill=(255, 240, 150, 255))
ptr.save(W + "/pointers.png")
print("ok", major.size, mega.size, bg.size, "board center", (cx, cy))
