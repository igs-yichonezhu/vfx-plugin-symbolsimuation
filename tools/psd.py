#!/usr/bin/env python3
"""
SlotFakeSpin：從遊戲畫面 PSD 讀出符號、結果盤面、格子與盤面位置（需要 Pillow + psd-tools）

  psd.py read <檔案.psd> <輸出資料夾> [選項]     給 tools/sfs.js from-psd 用；結果 JSON 印到 stdout

選項
  --group SYMBOLS          符號群組名稱
  --reel-layer 轉輪        轉輪窗圖層（量格子 / 位置用）
  --frame-layer 轉輪框     做背景時和轉輪窗一起蓋回去的轉輪框圖層（找不到就略過）
  --reels N  --rows N      指定輪數 / 列數（預設從分隔線偵測）
  --cell WxH --gap XxY     指定格子 / 間距（預設從分隔線量）
  --names 對照             中文名稱 → ASCII 名稱：「塔可=TACO,粉鑽=PINK」或 JSON 檔 {"塔可": "TACO"}
  --symbols-dir 資料夾     符號 PNG 輸出位置（預設 <輸出資料夾>/symbols）
  --bg 檔案.png|none       拿掉符號群組的背景圖（預設 <輸出資料夾>/bg.png；none = 不輸出）

做法
  符號  符號群組底下每個圖層 = 一個符號；子群組不到 1.5 格大就合成一個符號，比較大的當資料夾往下找。
        「塔可 拷貝」「塔可 拷貝 2」「塔可 copy」視為同一個符號；像素完全相同的圖層只留一個。
        輸出的 PNG 是圖層本身的像素（套用圖層遮色片、剪裁圖層與不透明度，不含圖層樣式）。
  盤面  看得到的符號依圖層 bbox 中心點分配到輪 / 列；同一格有好幾個時取最上層（其他的列在 covered）。
  格子  轉輪窗的深色直線 = 輪與輪之間的分隔線：線的中心距 = 格寬 + 間距，線與線之間亮的寬度 = 格寬。
        沒有橫線時列數 = 窗內高 / 格寬，格高和格寬差不到 5% 就當正方形格子。
        線條有反鋸齒，量到的值會差 0.5px 左右：格寬離 10 的倍數不到 1px 就取 10 的倍數，
        盤面中心離畫面中線不到 1px 就對齊中線。量不準時用 --cell / --gap 指定。
  背景  用 Photoshop 存在 PSD 裡的合成圖，再把轉輪框、轉輪窗圖層蓋回去（蓋掉符號）。
        不重新合成整份 PSD：psd-tools 重算漸層疊加等圖層樣式需要 scipy，結果也和 Photoshop 不一致。
"""
import hashlib
import json
import math
import os
import re
import sys

# Windows 上用 python -I 執行時 PYTHONIOENCODING 會被忽略，直接把輸出改成 UTF-8
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except Exception:
        pass

from PIL import Image, ImageChops

INSTALL_HINT = "讀 PSD 需要 psd-tools：請執行 pip install psd-tools（Python 3.8 以上）"
COPY_RE = re.compile(r"(?:\s*(?:拷貝|拷贝|副本|複本)|\s+copy)(?:\s*\d+)?\s*$", re.I)
OUTSIDE_EFFECTS = ("DropShadow", "OuterGlow")  # 在圖層外面的樣式：合成圖裡本來就有，蓋回去不受影響


class Fail(Exception):
    pass


# ---------------------------------------------------------------- 名稱
def base_name(name):
    """「塔可 拷貝 2」→「塔可」（Photoshop 複製圖層時加的字尾）"""
    s = str(name).strip()
    while True:
        t = COPY_RE.sub("", s).strip()
        if not t or t == s:
            return s
        s = t


def clean_name(name):
    """符號名稱不能有逗號 / 分號 / 換行（盤面文字和名稱列表會用到）"""
    s = re.sub(r"[,，;\t\r\n]+", "_", str(name)).strip()
    return s or "symbol"


def file_name(name, used):
    """符號名稱 → 檔名（去掉檔案系統不能用的字元；不分大小寫不重複）"""
    s = re.sub(r'[\\/:*?"<>|]+', "_", name).strip(" .") or "symbol"
    cand, n = s, 2
    while cand.lower() in used:
        cand = "%s_%d" % (s, n)
        n += 1
    used.add(cand.lower())
    return cand + ".png"


def parse_names(text):
    """「塔可=TACO,粉鑽=PINK」或 JSON 檔路徑 → {"塔可": "TACO", ...}"""
    if not text:
        return {}
    if os.path.isfile(text):
        try:
            with open(text, encoding="utf-8-sig") as f:
                data = json.load(f)
        except ValueError as e:
            raise Fail("--names 的 JSON 檔讀不懂：%s" % e)
        if not isinstance(data, dict):
            raise Fail('--names 的 JSON 要是 {"中文名稱": "ASCII 名稱"}')
        return {str(k).strip(): str(v).strip() for k, v in data.items() if str(v).strip()}
    out = {}
    for part in re.split(r"[,，;\r\n]+", text):
        if not part.strip():
            continue
        kv = re.split(r"\s*[=＝]\s*", part.strip(), maxsplit=1)
        if len(kv) != 2 or not kv[0] or not kv[1]:
            raise Fail("--names 格式是「塔可=TACO,粉鑽=PINK」或 JSON 檔：%s" % part)
        out[kv[0]] = kv[1]
    return out


# ---------------------------------------------------------------- 量格子（只用 Pillow，可單獨測試）
def opaque_bbox(img):
    """不透明部分（alpha > 128）的範圍"""
    if img.mode != "RGBA":
        return (0, 0) + img.size
    return img.getchannel("A").point(lambda a: 255 if a > 128 else 0).getbbox() or ((0, 0) + img.size)


def luminance_profiles(img):
    """(每欄平均亮度, 每列平均亮度)。透明部分當白色；只取中間 60%，避開邊框轉角"""
    im = Image.new("RGBA", img.size, (255, 255, 255, 255))
    im.alpha_composite(img.convert("RGBA"))
    g = im.convert("L").convert("F")
    w, h = g.size
    band_y = g.crop((0, int(h * 0.2), w, max(int(h * 0.2) + 1, int(h * 0.8))))
    band_x = g.crop((int(w * 0.2), 0, max(int(w * 0.2) + 1, int(w * 0.8)), h))
    return list(band_y.resize((w, 1), Image.BOX).getdata()), list(band_x.resize((1, h), Image.BOX).getdata())


def _edge(p, a, b, t):
    """亮度在像素 a、b 之間跨過門檻 t 的位置（次像素；像素 i 的中心是 i + 0.5）"""
    if p[b] == p[a]:
        return b
    return a + 0.5 + (t - p[a]) / (p[b] - p[a])


def find_lines(p):
    """亮度曲線上的線條（先找深色，沒有再找亮色）：回傳 [(起點, 終點)]（次像素）"""
    n = len(p)
    srt = sorted(p)
    med, lo, hi = srt[n // 2], srt[0], srt[-1]
    for dark in (True, False):
        if (med - lo if dark else hi - med) < 24:  # 對比太低 = 沒有線
            continue
        t = (med + lo) / 2 if dark else (med + hi) / 2
        inside = [(v < t) if dark else (v > t) for v in p]
        runs, i = [], 0
        while i < n:
            if not inside[i]:
                i += 1
                continue
            j = i
            while j + 1 < n and inside[j + 1]:
                j += 1
            runs.append((_edge(p, i - 1, i, t) if i > 0 else 0.0, _edge(p, j, j + 1, t) if j + 1 < n else float(n)))
            i = j + 1
        if runs:
            return runs
    return []


def axis_grid(p, count=None):
    """一個方向的格子。回傳 dict：count / cell / gap / pitch / center / inner（窗內長度）/ seps（分隔線條數）"""
    n = len(p)
    edge_zone = max(2.0, n * 0.03)
    inner_a, inner_b, seps = 0.0, float(n), []
    for a, b in find_lines(p):
        if a <= edge_zone:
            inner_a = max(inner_a, b)  # 開頭的邊框
        elif b >= n - edge_zone:
            inner_b = min(inner_b, a)  # 結尾的邊框
        elif b - a <= n * 0.15:
            seps.append((a, b))
    out = {"count": count, "cell": None, "gap": 0, "pitch": None, "center": (inner_a + inner_b) / 2,
           "inner": inner_b - inner_a, "seps": len(seps)}
    if not seps or (count and len(seps) != count - 1):
        return out
    centers = [(a + b) / 2 for a, b in seps]
    bounds = [inner_a] + [v for s in seps for v in s] + [inner_b]
    widths = [bounds[k + 1] - bounds[k] for k in range(0, len(bounds), 2)]
    cell = sum(widths) / len(widths)
    if len(seps) >= 2:
        pitch = (centers[-1] - centers[0]) / (len(seps) - 1)
    else:
        pitch = cell + (seps[0][1] - seps[0][0])
    cell_i, pitch_i = snap10(cell), int(round(pitch))
    gap = max(0, pitch_i - cell_i)
    out.update(count=len(seps) + 1, cell=pitch_i - gap, gap=gap, pitch=pitch, cell_raw=cell,
               center=sum(centers) / len(centers))
    return out


def snap10(v):
    """美術的格子多半是整數（200、180…），線條反鋸齒會讓量到的寬度差 0.5px 左右：離 10 的倍數不到 1px 就取它"""
    ten = int(round(v / 10.0)) * 10
    return ten if ten and abs(ten - v) <= 1.0 else int(round(v))


def measure_window(img, origin, reels=None, rows=None):
    """轉輪窗圖（RGBA）+ 左上角在畫面上的位置 → 格子設定（還沒套用 --cell / --gap）"""
    box = opaque_bbox(img)
    win = img.crop(box)
    ox, oy = origin[0] + box[0], origin[1] + box[1]
    cols, rws = luminance_profiles(win)
    X, Y = axis_grid(cols, reels), axis_grid(rws, rows)
    notes = ["轉輪窗 (%d,%d) %d×%d" % (ox, oy, win.width, win.height)]
    if X["cell"] is None:
        n = reels or 5
        X.update(count=n, cell=int(round(X["inner"] / n)), gap=0)
        notes.append(("找不到 %d 條分隔直線（找到 %d 條）" % (n - 1, X["seps"]) if reels else "找不到分隔直線") +
                     "，窗內寬 %.0f 平均分成 %d 輪" % (X["inner"], n))
    else:
        notes.append("分隔直線 %d 條，中心距 %.1f；線之間亮的寬度 %.1f → 格寬 %d、間距 %d" %
                     (X["seps"], X["pitch"], X["cell_raw"], X["cell"], X["gap"]))
    if Y["cell"] is None:
        n = rows or max(1, int(round(Y["inner"] / X["cell"])))
        est = Y["inner"] / n
        square = abs(est - X["cell"]) <= 0.05 * X["cell"]
        Y.update(count=n, cell=X["cell"] if square else int(round(est)), gap=0)
        notes.append("沒有橫線：窗內高 %.0f / %d 列 ≈ %.1f%s" % (Y["inner"], n, est,
                     "，接近格寬 → 正方形格子" if square else ""))
    else:
        notes.append("分隔橫線 %d 條，中心距 %.1f → 格高 %d、列距 %d" % (Y["seps"], Y["pitch"], Y["cell"], Y["gap"]))
    return {"reels": X["count"], "rows": Y["count"], "cellW": X["cell"], "cellH": Y["cell"], "gapX": X["gap"],
            "gapY": Y["gap"], "centerX": ox + X["center"], "centerY": oy + Y["center"], "notes": notes}


def grid_from_symbols(boxes, reels=None, rows=None):
    """沒有轉輪窗圖層時：用看得到的符號中心點估計（最左 / 最右 = 第一 / 最後一輪）"""
    xs = [(b[0] + b[2]) / 2 for b in boxes]
    ys = [(b[1] + b[3]) / 2 for b in boxes]
    nx, ny = reels or 5, rows or 3
    px = (max(xs) - min(xs)) / (nx - 1) if nx > 1 else max(b[2] - b[0] for b in boxes)
    py = (max(ys) - min(ys)) / (ny - 1) if ny > 1 else max(b[3] - b[1] for b in boxes)
    return {"reels": nx, "rows": ny, "cellW": int(round(px)), "cellH": int(round(py)), "gapX": 0, "gapY": 0,
            "centerX": (max(xs) + min(xs)) / 2, "centerY": (max(ys) + min(ys)) / 2,
            "notes": ["用符號中心點估計 %d×%d 格子（間距當 0）" % (nx, ny)]}


def finish_grid(g, cell=None, gap=None, canvas=None):
    """套用 --cell / --gap，算出格線左上角（整數像素）與盤面中心。
    盤面中心離畫面中線不到 1px 就對齊中線（遊戲畫面的盤面通常左右置中）"""
    if cell:
        g["cellW"], g["cellH"] = cell
    if gap:
        g["gapX"], g["gapY"] = gap
    if canvas:
        for key, size, label in (("centerX", canvas[0], "左右"), ("centerY", canvas[1], "上下")):
            if abs(g[key] - size / 2.0) <= 1.0 and g[key] != size / 2.0:
                g["notes"].append("盤面中心 %s %.1f 離畫面中線 %g 不到 1px，對齊中線（%s置中）" % (key[-1], g[key], size / 2.0, label))
                g[key] = size / 2.0
    gw = g["reels"] * g["cellW"] + (g["reels"] - 1) * g["gapX"]
    gh = g["rows"] * g["cellH"] + (g["rows"] - 1) * g["gapY"]
    g["left"] = int(round(g["centerX"] - gw / 2))
    g["top"] = int(round(g["centerY"] - gh / 2))
    g["position"] = [g["left"] + gw / 2, g["top"] + gh / 2]
    g["position"] = [int(v) if v == int(v) else v for v in g["position"]]
    return g


def assign_cells(items, g):
    """items 由上到下：[(符號名稱, 圖層名稱, bbox)]。回傳 (盤面[輪][列], 被蓋住, 不在格子裡)"""
    board = [["" for _ in range(g["rows"])] for _ in range(g["reels"])]
    who, covered, outside = {}, [], []
    px, py = g["cellW"] + g["gapX"], g["cellH"] + g["gapY"]
    for name, lname, (x0, y0, x1, y1) in items:
        r = int(math.floor(((x0 + x1) / 2 - g["left"] + g["gapX"] / 2) / px))
        y = int(math.floor(((y0 + y1) / 2 - g["top"] + g["gapY"] / 2) / py))
        if not (0 <= r < g["reels"] and 0 <= y < g["rows"]):
            outside.append(lname)
        elif not board[r][y]:
            board[r][y] = name
            who[(r, y)] = (name, lname)
        elif who[(r, y)][0] != name:
            covered.append({"layer": lname, "symbol": name, "by": who[(r, y)][1], "reel": r + 1, "row": y + 1})
    return board, covered, outside


# ---------------------------------------------------------------- 圖層像素
def over(dst, src, x, y):
    """把 src 的左上角疊在 dst 的 (x, y)（可以超出邊界）"""
    sx, sy, dx, dy = max(0, -x), max(0, -y), max(0, x), max(0, y)
    w, h = min(src.width - sx, dst.width - dx), min(src.height - sy, dst.height - dy)
    if w > 0 and h > 0:
        dst.alpha_composite(src, dest=(dx, dy), source=(sx, sy, sx + w, sy + h))


def is_clip(layer):
    v = getattr(layer, "clipping", None)
    return bool(v if v is not None else getattr(layer, "clipping_layer", False))


def active_effects(layer):
    try:
        return [type(e).__name__ for e in (layer.effects or []) if getattr(e, "enabled", True)]
    except Exception:
        return []


def blend_name(layer):
    return str(getattr(layer.blend_mode, "name", layer.blend_mode)).upper()


def flat_image(layer, notes):
    """圖層本身的像素（套用遮色片、剪裁圖層、不透明度；不含圖層樣式）→ (RGBA, 左, 上) 或 None"""
    x0, y0, x1, y1 = layer.bbox
    if x1 <= x0 or y1 <= y0:
        return None
    if layer.is_group():
        im = Image.new("RGBA", (x1 - x0, y1 - y0), (0, 0, 0, 0))
        for child in layer:
            if child.visible and not is_clip(child):
                part = flat_image(child, notes)
                if part:
                    over(im, part[0], part[1] - x0, part[2] - y0)
        left, top = x0, y0
    else:
        src = layer.topil()
        if src is None:
            return None
        im = src.convert("RGBA")
        left, top = layer.left, layer.top
        mask = getattr(layer, "mask", None)
        if layer.has_mask() and mask is not None and not getattr(mask, "disabled", False):
            m = mask.topil()
            if m is not None:
                full = Image.new("L", im.size, int(getattr(mask, "background_color", 0) or 0))
                full.paste(m.convert("L"), (mask.left - left, mask.top - top))
                im.putalpha(ImageChops.multiply(im.getchannel("A"), full))
        clips = [c for c in (getattr(layer, "clip_layers", None) or []) if c.visible]
        if clips:
            base_alpha = im.getchannel("A")
            layer_px = Image.new("RGBA", im.size, (0, 0, 0, 0))
            for c in clips:
                part = flat_image(c, notes)
                if part:
                    over(layer_px, part[0], part[1] - left, part[2] - top)
            layer_px.putalpha(ImageChops.multiply(layer_px.getchannel("A"), base_alpha))
            im.alpha_composite(layer_px)
    if layer.opacity < 255:
        im.putalpha(im.getchannel("A").point(lambda a: a * layer.opacity // 255))
    if blend_name(layer) not in ("NORMAL", "PASS_THROUGH"):
        notes.append("「%s」的混合模式是 %s，輸出時當一般模式疊" % (layer.name, blend_name(layer)))
    return im, left, top


# ---------------------------------------------------------------- PSD
def open_psd(path):
    try:
        from psd_tools import PSDImage
    except ImportError:
        raise Fail(INSTALL_HINT)
    if not os.path.isfile(path):
        raise Fail("找不到 PSD：%s" % path)
    try:
        return PSDImage.open(path)
    except Exception as e:
        raise Fail("讀不了 PSD（%s）：%s" % (type(e).__name__, e))


def find_layer(root, name, group=False):
    """依名稱找圖層（整份 PSD，由上往下；先比完全相同，再不分大小寫）"""
    layers = [l for l in root.descendants() if not group or l.is_group()]
    layers.reverse()
    for test in (lambda l: l.name == name, lambda l: l.name.strip().lower() == name.strip().lower()):
        for l in layers:
            if test(l):
                return l
    return None


def symbol_leaves(group, cell, out):
    """符號群組底下的符號圖層（由下到上）。小的子群組 = 一個符號；大的子群組 = 資料夾，往下找"""
    for layer in group:
        if is_clip(layer):
            continue  # 剪裁圖層算在下面那一層裡
        x0, y0, x1, y1 = layer.bbox
        if x1 <= x0 or y1 <= y0:
            continue
        if layer.is_group() and cell and (x1 - x0 > 1.5 * cell[0] or y1 - y0 > 1.5 * cell[1]):
            symbol_leaves(layer, cell, out)
        else:
            out.append(layer)
    return out


def visible_within(layer, root):
    while layer is not None and layer is not root:
        if not layer.visible:
            return False
        layer = layer.parent
    return True


def make_background(psd, patch, group, notes):
    """PSD 存的合成圖 + 轉輪框 / 轉輪窗蓋回去；再補回符號群組以外、在它們上面又和轉輪區域重疊的圖層"""
    comp = psd.topil()
    if comp is None:
        notes.append("PSD 裡沒有存合成圖（Photoshop 存檔時要勾「最大相容性」），沒有輸出背景圖")
        return None
    bg = comp.convert("RGBA")
    order = list(psd.descendants())
    region = None
    for layer in patch:
        part = flat_image(layer, notes)
        if not part:
            continue
        over(bg, part[0], part[1], part[2])
        inner = [e for e in active_effects(layer) if e not in OUTSIDE_EFFECTS]
        if inner:
            notes.append("「%s」有圖層樣式（%s），背景圖裡這一層不含樣式" % (layer.name, ", ".join(inner)))
        b = (part[1], part[2], part[1] + part[0].width, part[2] + part[0].height)
        region = b if region is None else (min(region[0], b[0]), min(region[1], b[1]), max(region[2], b[2]), max(region[3], b[3]))
    if region is None:
        return bg.convert("RGB")
    top = max(order.index(l) for l in patch)
    in_group = set(id(l) for l in group.descendants())
    for layer in order[top + 1:]:
        if layer.is_group() or id(layer) in in_group or layer is group or is_clip(layer) or not layer.is_visible():
            continue
        x0, y0, x1, y1 = layer.bbox
        if x1 <= region[0] or x0 >= region[2] or y1 <= region[1] or y0 >= region[3]:
            continue
        fx = active_effects(layer)
        if fx or blend_name(layer) != "NORMAL":
            notes.append("「%s」蓋在轉輪區域上而且有圖層樣式 / 混合模式，背景圖裡可能不完整" % layer.name)
        part = flat_image(layer, notes)
        if part:
            over(bg, part[0], part[1], part[2])
    return bg.convert("RGB")


def read_psd(path, out_dir, opt):
    psd = open_psd(path)
    notes, warnings = [], []
    gname = opt.get("group") or "SYMBOLS"
    group = find_layer(psd, gname, group=True)
    if group is None:
        names = [l.name for l in psd.descendants() if l.is_group()]
        raise Fail("找不到符號群組「%s」（--group 指定）。PSD 裡的群組：%s" % (gname, "、".join(names) or "（沒有）"))
    reels, rows = opt.get("reels"), opt.get("rows")

    # 格子：先量轉輪窗；找不到才用符號位置估計
    rname = opt.get("reel-layer") or "轉輪"
    reel_layer = find_layer(psd, rname)
    grid = None
    if reel_layer is not None:
        part = flat_image(reel_layer, notes)
        if part:
            grid = measure_window(part[0], (part[1], part[2]), reels, rows)
            grid["source"] = reel_layer.name
    if grid is None:
        warnings.append("找不到轉輪窗圖層「%s」（--reel-layer 指定），改用符號位置估計格子，請檢查" % rname)
        boxes = [l.bbox for l in symbol_leaves(group, None, []) if visible_within(l, group)]
        if not boxes:
            raise Fail("符號群組「%s」裡沒有看得到的圖層" % group.name)
        grid = grid_from_symbols(boxes, reels, rows)
        grid["source"] = ""
    grid = finish_grid(grid, opt.get("cell"), opt.get("gap"), (psd.width, psd.height))

    # 符號
    mapping = parse_names(opt.get("names"))
    leaves = symbol_leaves(group, (grid["cellW"], grid["cellH"]), [])
    if not leaves:
        raise Fail("符號群組「%s」是空的" % group.name)
    sym_dir = opt.get("symbols-dir") or os.path.join(out_dir, "symbols")
    os.makedirs(sym_dir, exist_ok=True)
    symbols, by_base, by_hash, layer_symbol, used_files, used_map = [], {}, {}, {}, set(), set()
    for layer in leaves:
        part = flat_image(layer, notes)
        if not part:
            continue
        im = part[0]
        digest = hashlib.md5(("%dx%d" % im.size).encode() + im.tobytes()).hexdigest()
        base = base_name(layer.name)
        if base in by_base:
            sym = by_base[base]
            if sym["hash"] != digest:
                notes.append("「%s」和「%s」名稱算同一個符號但圖不一樣，用「%s」的圖" % (layer.name, sym["layers"][0], sym["layers"][0]))
        elif digest in by_hash:
            sym = by_hash[digest]
            notes.append("「%s」和「%s」像素完全相同，當成同一個符號 %s" % (layer.name, sym["layers"][0], sym["name"]))
            by_base[base] = sym
        else:
            key = layer.name if layer.name in mapping else base
            if key in mapping:
                used_map.add(key)
            name = clean_name(mapping.get(key, base))
            if any(s["name"] == name for s in symbols):
                raise Fail("兩個不同的符號都叫「%s」，請用 --names 分開" % name)
            fname = file_name(name, used_files)
            im.save(os.path.join(sym_dir, fname))
            fx = active_effects(layer)
            if fx:
                notes.append("「%s」有圖層樣式（%s），PNG 不含樣式" % (layer.name, ", ".join(fx)))
            sym = {"name": name, "label": base, "file": os.path.abspath(os.path.join(sym_dir, fname)),
                   "width": im.width, "height": im.height, "layers": [], "visible": False, "hash": digest}
            symbols.append(sym)
            by_base[base] = sym
            by_hash.setdefault(digest, sym)
        sym["layers"].append(layer.name)
        layer_symbol[id(layer)] = sym
    fx = active_effects(group)
    if fx:
        notes.append("符號群組「%s」有圖層樣式（%s），符號 PNG 不含" % (group.name, ", ".join(fx)))
    for k in mapping:
        if k not in used_map:
            warnings.append("--names 裡的「%s」在符號群組裡找不到" % k)

    # 盤面：由上到下，同一格取最上層
    items = []
    for layer in reversed(leaves):
        sym = layer_symbol.get(id(layer))
        if sym and visible_within(layer, group):
            sym["visible"] = True
            items.append((sym["name"], layer.name, layer.bbox))
    board, covered, outside = assign_cells(items, grid)
    for name in outside:
        warnings.append("「%s」不在盤面格子裡，沒有放進結果盤面" % name)

    # 背景
    bg_path = opt.get("bg")
    if bg_path is None:
        bg_path = os.path.join(out_dir, "bg.png")
    background = None
    if bg_path and bg_path.lower() != "none":
        if reel_layer is None:
            warnings.append("沒有轉輪窗圖層可以蓋掉符號，沒有輸出背景圖")
        else:
            frame = find_layer(psd, opt.get("frame-layer") or "轉輪框")
            patch = [l for l in list(psd.descendants()) if l is reel_layer or l is frame]
            bg = make_background(psd, patch, group, notes)
            if bg is not None:
                os.makedirs(os.path.dirname(os.path.abspath(bg_path)), exist_ok=True)
                bg.save(bg_path)
                background = os.path.abspath(bg_path)

    for s in symbols:
        del s["hash"]
    return {"file": os.path.abspath(path), "width": psd.width, "height": psd.height, "group": group.name,
            "grid": grid, "symbols": symbols, "board": board, "covered": covered,
            "background": background, "notes": notes, "warnings": warnings}


# ---------------------------------------------------------------- main
def parse_pair(v, flag):
    m = re.match(r"^\s*(\d+)\s*(?:[x×*,]\s*(\d+))?\s*$", str(v))
    if not m:
        raise Fail("%s 格式是 200 或 200x180" % flag)
    a = int(m.group(1))
    return (a, int(m.group(2)) if m.group(2) is not None else a)


def parse_opts(argv):
    opt, i = {}, 0
    while i < len(argv):
        a = argv[i]
        if not a.startswith("--") or i + 1 >= len(argv):
            raise Fail("參數錯誤：%s" % a)
        opt[a[2:]] = argv[i + 1]
        i += 2
    for k in ("reels", "rows"):
        if k in opt:
            if not opt[k].isdigit() or int(opt[k]) < 1:
                raise Fail("--%s 要是正整數" % k)
            opt[k] = int(opt[k])
    if "cell" in opt:
        opt["cell"] = parse_pair(opt["cell"], "--cell")
    if "gap" in opt:
        g = parse_pair(opt["gap"], "--gap")
        opt["gap"] = g if re.search(r"[x×*,]", opt["gap"], re.I) else (g[0], 0)  # 只給一個數字 = 輪距，列距 0
    return opt


def main(argv):
    if len(argv) >= 3 and argv[0] == "read":
        res = read_psd(argv[1], argv[2], parse_opts(argv[3:]))
        sys.stdout.write(json.dumps(res, ensure_ascii=False, indent=1) + "\n")
        return 0
    if len(argv) == 1 and argv[0] == "check":
        try:
            import psd_tools  # noqa: F401
        except ImportError:
            raise Fail(INSTALL_HINT)
        return 0
    sys.stdout.write(__doc__)
    return 2


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except Fail as e:
        sys.stderr.write(str(e) + "\n")
        sys.exit(1)
