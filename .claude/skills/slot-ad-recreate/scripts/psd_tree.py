# 列出 PSD 圖層樹（名稱、種類、範圍、顯示）並存合成縮圖
# python -I psd_tree.py <輸出資料夾> <psd> [<psd> ...]
import os
import sys

from psd_tools import PSDImage

sys.stdout.reconfigure(encoding="utf-8")
out = sys.argv[1]
os.makedirs(out, exist_ok=True)
for path in sys.argv[2:]:
    psd = PSDImage.open(path)
    name = os.path.splitext(os.path.basename(path))[0]
    print("=" * 70)
    print(name, psd.width, "x", psd.height, "layers", len(list(psd.descendants())))

    def walk(group, depth):
        for lyr in group:
            b = lyr.bbox
            print("  " * depth + "- %s [%s]%s  %s" % (lyr.name, lyr.kind, "" if lyr.visible else " (hidden)",
                                                      "%d,%d %dx%d" % (b[0], b[1], b[2] - b[0], b[3] - b[1]) if b and b[2] > b[0] else ""))
            if lyr.is_group():
                walk(lyr, depth + 1)

    walk(psd, 1)
    try:
        im = psd.composite() if psd.has_preview() is False else psd.topil()
        if im is None:
            im = psd.composite()
        im.thumbnail((540, 960))
        im.convert("RGB").save(os.path.join(out, name + "_preview.jpg"), quality=85)
    except Exception as e:  # noqa: BLE001
        print("  preview failed:", e)
