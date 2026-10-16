#!/usr/bin/env python3
"""
tools/psd.py 測試（Pillow）。有 psd-tools 時另外用程式產生一份小 PSD 跑完整流程，沒有就略過。

  psd_test.py                 跑測試（test/cli.test.js 會呼叫）
  psd_test.py make <out.psd>  產生測試用 PSD（給 test/cli.test.js 測 from-psd；需要 psd-tools）
"""
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tools"))
import psd  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402

try:
    import psd_tools  # noqa: F401
    from psd_tools import PSDImage
    HAS_PSD_TOOLS = hasattr(PSDImage, "new") and hasattr(PSDImage, "create_group")
except ImportError:
    HAS_PSD_TOOLS = False

BEIGE, DARK = (230, 215, 180, 255), (30, 20, 10, 255)


def window_image(reels, rows, cell, gap, border=4, hlines=False):
    """畫一個轉輪窗：米色底、深色外框、輪與輪之間深色直線（hlines = 列與列之間也有橫線）"""
    cw, ch = cell
    gw = reels * cw + (reels - 1) * gap[0]
    gh = rows * ch + (rows - 1) * gap[1]
    im = Image.new("RGBA", (gw + 2 * border, gh + 2 * border), BEIGE)
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, im.width - 1, im.height - 1], outline=DARK, width=border)
    for r in range(1, reels):
        x = border + r * cw + (r - 1) * gap[0]
        d.rectangle([x, 0, x + gap[0] - 1, im.height - 1], fill=DARK)
    if hlines:
        for y in range(1, rows):
            yy = border + y * ch + (y - 1) * gap[1]
            d.rectangle([0, yy, im.width - 1, yy + gap[1] - 1], fill=DARK)
    # 轉輪中間稍亮、兩側稍暗（像真的美術圖）
    for r in range(reels):
        x0 = border + r * (cw + gap[0])
        for k in range(6):
            d.line([(x0 + k, border), (x0 + k, im.height - border - 1)], fill=(200 + k * 5, 185 + k * 5, 150 + k * 5, 255))
    return im


class Names(unittest.TestCase):
    def test_base_name(self):
        self.assertEqual(psd.base_name("塔可 拷貝"), "塔可")
        self.assertEqual(psd.base_name("塔可 拷貝 2"), "塔可")
        self.assertEqual(psd.base_name("辣椒人拷貝 3"), "辣椒人")
        self.assertEqual(psd.base_name("Taco copy 12"), "Taco")
        self.assertEqual(psd.base_name("Taco copy copy"), "Taco")
        self.assertEqual(psd.base_name("塔可 副本"), "塔可")
        self.assertEqual(psd.base_name("Recopy"), "Recopy")
        self.assertEqual(psd.base_name("copy"), "copy")
        self.assertEqual(psd.base_name("10"), "10")

    def test_clean_and_file_names(self):
        self.assertEqual(psd.clean_name("$ 1,000"), "$ 1_000")
        used = set()
        self.assertEqual(psd.file_name("A", used), "A.png")
        self.assertEqual(psd.file_name("a", used), "a_2.png")
        self.assertEqual(psd.file_name('x/y:z', used), "x_y_z.png")

    def test_parse_names(self):
        self.assertEqual(psd.parse_names("塔可=TACO, 粉鑽＝PINK"), {"塔可": "TACO", "粉鑽": "PINK"})
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as f:
            json.dump({"塔可": "TACO", "空的": ""}, f, ensure_ascii=False)
        try:
            self.assertEqual(psd.parse_names(f.name), {"塔可": "TACO"})
        finally:
            os.unlink(f.name)
        with self.assertRaises(psd.Fail):
            psd.parse_names("塔可")


class Grid(unittest.TestCase):
    def test_vertical_lines_square_cells(self):
        # 5×3、格子 180、輪距 6、沒有橫線
        win = window_image(5, 3, (180, 180), (6, 0))
        g = psd.finish_grid(psd.measure_window(win, (100, 300)))
        self.assertEqual((g["reels"], g["rows"], g["cellW"], g["cellH"], g["gapX"], g["gapY"]), (5, 3, 180, 180, 6, 0))
        self.assertEqual((g["left"], g["top"]), (104, 304))
        self.assertEqual(g["position"], [104 + (5 * 180 + 4 * 6) / 2, 304 + 270])

    def test_horizontal_lines(self):
        win = window_image(3, 4, (150, 120), (4, 4), hlines=True)
        g = psd.finish_grid(psd.measure_window(win, (0, 0)))
        self.assertEqual((g["reels"], g["rows"], g["cellW"], g["cellH"], g["gapX"], g["gapY"]), (3, 4, 150, 120, 4, 4))

    def test_transparent_margin_and_forced_counts(self):
        win = window_image(5, 3, (100, 100), (4, 0))
        pad = Image.new("RGBA", (win.width + 20, win.height + 20), (0, 0, 0, 0))
        pad.alpha_composite(win, (10, 10))
        g = psd.finish_grid(psd.measure_window(pad, (0, 0)))
        self.assertEqual((g["left"], g["top"], g["cellW"], g["gapX"]), (14, 14, 100, 4))
        # 指定的輪數和線條數不合：平均分配並在說明裡寫出來
        g = psd.measure_window(win, (0, 0), reels=4)
        self.assertEqual(g["reels"], 4)
        self.assertTrue(any("平均分成 4 輪" in n for n in g["notes"]), g["notes"])

    def test_no_lines(self):
        win = Image.new("RGBA", (600, 350), BEIGE)
        g = psd.measure_window(win, (0, 0))
        self.assertEqual((g["reels"], g["rows"], g["cellW"], g["cellH"], g["gapX"]), (5, 3, 120, 120, 0))
        g = psd.measure_window(win, (0, 0), rows=2)
        self.assertEqual((g["rows"], g["cellH"]), (2, 175))

    def test_snap(self):
        self.assertEqual(psd.snap10(199.4), 200)
        self.assertEqual(psd.snap10(198.6), 199)
        self.assertEqual(psd.snap10(128.3), 128)
        g = {"reels": 5, "rows": 3, "cellW": 200, "cellH": 200, "gapX": 4, "gapY": 0, "centerX": 540.6, "centerY": 900.2, "notes": []}
        g = psd.finish_grid(g, canvas=(1080, 1920))
        self.assertEqual((g["left"], g["position"]), (32, [540, 900]))
        g = psd.finish_grid(dict(g, centerX=545, notes=[]), cell=(180, 160), gap=(2, 0), canvas=(1080, 1920))
        self.assertEqual((g["cellW"], g["cellH"], g["gapX"], g["left"]), (180, 160, 2, 545 - (5 * 180 + 8) // 2))

    def test_assign_cells(self):
        g = psd.finish_grid({"reels": 2, "rows": 2, "cellW": 100, "cellH": 100, "gapX": 10, "gapY": 0,
                             "centerX": 105, "centerY": 100, "notes": []})
        items = [  # 由上到下
            ("CHILI", "辣椒人", (0, 90, 110, 200)),
            ("Q", "Q", (20, 110, 80, 170)),
            ("A", "A 拷貝", (120, 10, 200, 90)),
            ("A", "A", (120, 10, 200, 90)),
            ("K", "K", (130, 110, 190, 190)),
            ("J", "J", (400, 400, 450, 450)),
        ]
        board, covered, outside = psd.assign_cells(items, g)
        self.assertEqual(board, [["", "CHILI"], ["A", "K"]])
        self.assertEqual(covered, [{"layer": "Q", "symbol": "Q", "by": "辣椒人", "reel": 1, "row": 2}])
        self.assertEqual(outside, ["J"])


# ---------------------------------------------------------------- 測試用 PSD
def dot(color, size, label=None):
    im = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.ellipse([1, 1, size[0] - 2, size[1] - 2], fill=color)
    if label:
        d.rectangle([size[0] // 3, size[1] // 3, size[0] // 3 + 6, size[1] // 3 + 6], fill=label)
    return im


def make_psd(path):
    """600×480 遊戲畫面：5×3、格子 100、輪距 4，盤面左右置中（格線左上 42,120）"""
    doc = PSDImage.new("RGBA", (600, 480), color=(90, 20, 20, 255))

    def add(parent, im, name, left=0, top=0):
        layer = parent.create_pixel_layer(im, left=left, top=top)
        layer.name = name  # 用屬性設定才會寫入 Unicode 圖層名稱（和 Photoshop 一樣）
        return layer

    add(doc, Image.new("RGBA", (600, 480), (120, 30, 30, 255)), "BG")
    win = window_image(5, 3, (100, 100), (4, 0))  # (38,116) 524×308
    ring = Image.new("RGBA", (win.width + 24, win.height + 24), (240, 190, 40, 255))
    ImageDraw.Draw(ring).rectangle([12, 12, ring.width - 13, ring.height - 13], fill=(0, 0, 0, 0))
    add(doc, ring, "轉輪框", 26, 104)
    add(doc, win, "轉輪", 38, 116)
    grp = doc.create_group(name="SYMBOLS")

    def put(name, im, reel, row, visible=True):
        cx, cy = 42 + reel * 104 + 50, 120 + row * 100 + 50
        add(grp, im, name, cx - im.width // 2, cy - im.height // 2).visible = visible

    taco, pink, a = dot((250, 180, 40, 255), (80, 70)), dot((220, 60, 200, 255), (76, 60)), dot((240, 140, 20, 255), (60, 64))
    put("Q", dot((40, 90, 220, 255), (70, 70)), 1, 0)
    put("辣椒人", dot((230, 30, 30, 255), (110, 104), (20, 160, 40, 255)), 1, 0)  # 比格子大、蓋住 Q
    put("辣椒人 拷貝", dot((230, 30, 30, 255), (110, 104), (20, 160, 40, 255)), 1, 1)
    put("辣椒人 拷貝 2", dot((230, 30, 30, 255), (110, 104), (20, 160, 40, 255)), 1, 2)
    put("塔可", taco, 0, 0)
    put("塔可 拷貝", taco, 4, 0)
    put("粉鑽", pink, 0, 1)
    put("粉鑽 拷貝", pink, 4, 1)
    put("A", a, 0, 2)
    put("A2", a, 4, 2)  # 像素和 A 完全一樣 → 同一個符號
    put("K", dot((40, 40, 160, 255), (70, 72)), 2, 0)
    put("J", dot((120, 40, 160, 255), (60, 72)), 2, 1)
    put("10", dot((60, 160, 40, 255), (74, 64)), 2, 2)
    put("藍鑽", dot((40, 120, 250, 255), (80, 62)), 3, 0)
    put("綠鑽", dot((40, 200, 90, 255), (82, 64)), 3, 1)
    put("K 拷貝", dot((40, 40, 160, 255), (70, 72)), 3, 2)
    put("WILD", dot((250, 250, 250, 255), (90, 90)), 3, 0, visible=False)  # 隱藏：算符號、不算盤面
    add(doc, Image.new("RGBA", (60, 10), (10, 200, 230, 255)), "LOGO", 270, 105)  # 蓋在轉輪框上
    doc.save(path)


@unittest.skipUnless(HAS_PSD_TOOLS, "沒有 psd-tools（pip install psd-tools）")
class ReadPsd(unittest.TestCase):
    def test_read(self):
        tmp = tempfile.mkdtemp(prefix="sfs-psd-")
        path = os.path.join(tmp, "game.psd")
        make_psd(path)
        res = psd.read_psd(path, tmp, {"names": "塔可=TACO,粉鑽=PINK,辣椒人=CHILI,藍鑽=BLUE"})
        g = res["grid"]
        self.assertEqual((g["reels"], g["rows"], g["cellW"], g["cellH"], g["gapX"], g["gapY"]), (5, 3, 100, 100, 4, 0))
        self.assertEqual((g["left"], g["top"], g["position"]), (42, 120, [300, 270]))
        names = sorted(s["name"] for s in res["symbols"])
        self.assertEqual(names, sorted(["Q", "CHILI", "TACO", "PINK", "A", "K", "J", "10", "BLUE", "綠鑽", "WILD"]))
        board = res["board"]
        rows = [" ".join(board[r][y] for r in range(5)) for y in range(3)]
        self.assertEqual(rows, ["TACO CHILI K BLUE TACO", "PINK CHILI J 綠鑽 PINK", "A CHILI 10 K A"])
        self.assertEqual([c["layer"] for c in res["covered"]], ["Q"])
        sym = {s["name"]: s for s in res["symbols"]}
        self.assertFalse(sym["WILD"]["visible"])
        self.assertEqual(sym["A"]["layers"], ["A", "A2"])
        self.assertEqual(sym["CHILI"]["layers"], ["辣椒人", "辣椒人 拷貝", "辣椒人 拷貝 2"])
        self.assertEqual((sym["CHILI"]["width"], sym["CHILI"]["height"]), (110, 104))
        self.assertTrue(os.path.isfile(sym["綠鑽"]["file"]))
        self.assertEqual(Image.open(sym["TACO"]["file"]).size, (80, 70))
        bg = Image.open(res["background"]).convert("RGB")
        self.assertEqual(bg.size, (600, 480))
        for r in range(5):  # 格子中心都是轉輪窗的米色（符號已拿掉）
            for y in range(3):
                self.assertEqual(bg.getpixel((42 + r * 104 + 50, 120 + y * 100 + 50)), BEIGE[:3])
        self.assertEqual(bg.getpixel((290, 108)), (10, 200, 230))  # 轉輪框上面的 LOGO 補回來
        self.assertEqual(bg.getpixel((30, 300)), (240, 190, 40))  # 轉輪框
        self.assertEqual(res["warnings"], [])

    def test_missing_group(self):
        tmp = tempfile.mkdtemp(prefix="sfs-psd-")
        path = os.path.join(tmp, "game.psd")
        make_psd(path)
        with self.assertRaises(psd.Fail) as cm:
            psd.read_psd(path, tmp, {"group": "NOPE"})
        self.assertIn("SYMBOLS", str(cm.exception))
        res = psd.read_psd(path, tmp, {"reel-layer": "沒有這層", "bg": "none", "names": "沒有=X"})
        self.assertIsNone(res["background"])
        self.assertTrue(any("轉輪窗" in w for w in res["warnings"]))
        self.assertTrue(any("沒有" in w and "找不到" in w for w in res["warnings"]))
        self.assertEqual((res["grid"]["cellW"], res["grid"]["reels"]), (104, 5))  # 用符號中心估計（間距 0）


if __name__ == "__main__":
    for _s in (sys.stdout, sys.stderr):
        try:
            _s.reconfigure(encoding="utf-8")
        except Exception:
            pass
    if len(sys.argv) == 3 and sys.argv[1] == "make":
        if not HAS_PSD_TOOLS:
            sys.stderr.write("需要 psd-tools\n")
            sys.exit(2)
        make_psd(sys.argv[2])
        sys.exit(0)
    unittest.main(verbosity=1)
