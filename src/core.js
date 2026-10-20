/*
 * SlotFakeSpin - core.js
 * 純邏輯：設定、盤面、亂數、JSON、轉輪動態計算。
 * 不碰 AE DOM，可在 Node 測試（ExtendScript ES3 相容寫法：不使用 let/const/箭頭函式/Array.forEach 等）。
 */
var SFS = SFS || {};

(function (S) {
    S.VERSION = "1.5.0";
    S.NAME = "SlotFakeSpin";
    S.TAG = "SFS_BOARD";

    // ------------------------------------------------------------------
    // 介面語言：原始碼的繁中字串就是 key，英文對照在 i18n_en.js
    // ------------------------------------------------------------------
    S.LANGS = ["auto", "zh", "en"];
    S.lang = "zh";
    S.I18N = {};

    // pref：auto / zh / en。auto 時 EffectCraft（Windows 介面字型沒有中文）與非中文 AE 用英文
    S.detectLang = function (pref) {
        if (pref === "zh" || pref === "en") { return pref; }
        try {
            if (typeof $ !== "undefined" && /EffectCraft/i.test(String($.os))) { return "en"; }
        } catch (e) { /* ignore */ }
        try {
            if (typeof app !== "undefined" && app.isoLanguage) { return /^zh/i.test(String(app.isoLanguage)) ? "zh" : "en"; }
        } catch (e2) { /* ignore */ }
        return "zh";
    };

    // T("第 {0} 行", 3)：翻譯後代入參數
    // 同一個中文在不同地方要翻成不同英文時，key 前面加語境：T("count\u0004連")，中文顯示時會去掉語境
    S.t = function (s) {
        var d = S.I18N[S.lang], out = s, args = arguments, c = s.indexOf("\u0004");
        if (d && d.hasOwnProperty(s)) { out = d[s]; } else if (c >= 0) { out = s.substring(c + 1); }
        if (args.length > 1) {
            out = out.replace(/\{(\d+)\}/g, function (m, n) {
                n = Number(n) + 1;
                return n < args.length ? String(args[n]) : m;
            });
        }
        return out;
    };

    S.tList = function (arr) {
        var out = [];
        for (var i = 0; i < arr.length; i++) { out.push(S.t(arr[i])); }
        return out;
    };

    var T = S.t;

    // ------------------------------------------------------------------
    // 工具
    // ------------------------------------------------------------------
    var U = S.util = {};

    U.isArray = function (v) {
        return Object.prototype.toString.call(v) === "[object Array]";
    };

    U.indexOf = function (arr, v) {
        for (var i = 0; i < arr.length; i++) {
            if (arr[i] === v) { return i; }
        }
        return -1;
    };

    U.trim = function (s) {
        return String(s).replace(/^\s+|\s+$/g, "");
    };

    U.clamp = function (v, lo, hi) {
        return v < lo ? lo : (v > hi ? hi : v);
    };

    U.pad = function (n, w) {
        var s = String(n);
        while (s.length < w) { s = "0" + s; }
        return s;
    };

    U.clone = function (v) {
        var i, out;
        if (v === null || typeof v !== "object") { return v; }
        if (U.isArray(v)) {
            out = [];
            for (i = 0; i < v.length; i++) { out.push(U.clone(v[i])); }
            return out;
        }
        out = {};
        for (i in v) {
            if (v.hasOwnProperty(i)) { out[i] = U.clone(v[i]); }
        }
        return out;
    };

    // 檔名自然排序：A2 < A10
    U.naturalCompare = function (a, b) {
        var re = /(\d+|\D+)/g;
        var pa = String(a).toLowerCase().match(re) || [];
        var pb = String(b).toLowerCase().match(re) || [];
        var n = Math.min(pa.length, pb.length);
        for (var i = 0; i < n; i++) {
            var x = pa[i], y = pb[i];
            if (x === y) { continue; }
            var nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
            if (nx && ny) { return parseInt(x, 10) - parseInt(y, 10); }
            return x < y ? -1 : 1;
        }
        return pa.length - pb.length;
    };

    U.baseName = function (fileName) {
        var s = String(fileName);
        var dot = s.lastIndexOf(".");
        return dot > 0 ? s.substring(0, dot) : s;
    };

    U.toNumber = function (v, fallback) {
        var n = parseFloat(v);
        return (isNaN(n) || !isFinite(n)) ? fallback : n;
    };

    // ------------------------------------------------------------------
    // JSON（ExtendScript 沒有內建 JSON）。非 ASCII 字元一律轉成 \uXXXX，
    // 這樣存進 comment / settings / 檔案時不會有編碼問題。
    // ------------------------------------------------------------------
    var J = S.json = {};

    function quote(str) {
        var out = "\"";
        for (var i = 0; i < str.length; i++) {
            var c = str.charAt(i), code = str.charCodeAt(i);
            if (c === "\"") { out += "\\\""; }
            else if (c === "\\") { out += "\\\\"; }
            else if (c === "\n") { out += "\\n"; }
            else if (c === "\r") { out += "\\r"; }
            else if (c === "\t") { out += "\\t"; }
            else if (code < 0x20 || code > 0x7e) {
                out += "\\u" + U.pad(code.toString(16).toUpperCase(), 4);
            } else { out += c; }
        }
        return out + "\"";
    }

    function str(v, indent, cur) {
        var i, parts, inner, keys;
        if (v === null || v === undefined) { return "null"; }
        if (typeof v === "string") { return quote(v); }
        if (typeof v === "number") { return isFinite(v) ? String(v) : "null"; }
        if (typeof v === "boolean") { return v ? "true" : "false"; }
        if (typeof v === "function") { return "null"; }
        inner = indent ? cur + indent : "";
        var nl = indent ? "\n" : "";
        var sep = indent ? ": " : ":";
        if (U.isArray(v)) {
            if (!v.length) { return "[]"; }
            parts = [];
            for (i = 0; i < v.length; i++) { parts.push(inner + str(v[i], indent, inner)); }
            return "[" + nl + parts.join("," + nl) + nl + cur + "]";
        }
        keys = [];
        for (i in v) {
            if (v.hasOwnProperty(i) && typeof v[i] !== "function" && v[i] !== undefined) { keys.push(i); }
        }
        if (!keys.length) { return "{}"; }
        parts = [];
        for (i = 0; i < keys.length; i++) {
            parts.push(inner + quote(keys[i]) + sep + str(v[keys[i]], indent, inner));
        }
        return "{" + nl + parts.join("," + nl) + nl + cur + "}";
    }

    J.stringify = function (v, indent) {
        var ind = "";
        if (typeof indent === "number") { while (ind.length < indent) { ind += " "; } }
        else if (typeof indent === "string") { ind = indent; }
        return str(v, ind, "");
    };

    J.parse = function (text) {
        var s = String(text), i = 0;
        // 去掉 BOM
        if (s.charCodeAt(0) === 0xFEFF) { i = 1; }

        function fail(msg) { throw new Error("JSON parse error at " + i + ": " + msg); }
        function ws() { while (i < s.length && /\s/.test(s.charAt(i))) { i++; } }
        function value() {
            ws();
            var c = s.charAt(i);
            if (c === "{") { return obj(); }
            if (c === "[") { return arr(); }
            if (c === "\"") { return string(); }
            if (c === "t" && s.substring(i, i + 4) === "true") { i += 4; return true; }
            if (c === "f" && s.substring(i, i + 5) === "false") { i += 5; return false; }
            if (c === "n" && s.substring(i, i + 4) === "null") { i += 4; return null; }
            return num();
        }
        function num() {
            var m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+\-]?\d+)?/.exec(s.substring(i));
            if (!m) { fail("unexpected '" + s.charAt(i) + "'"); }
            i += m[0].length;
            return parseFloat(m[0]);
        }
        function string() {
            var out = "";
            i++;
            while (i < s.length) {
                var c = s.charAt(i++);
                if (c === "\"") { return out; }
                if (c === "\\") {
                    var e = s.charAt(i++);
                    if (e === "n") { out += "\n"; }
                    else if (e === "r") { out += "\r"; }
                    else if (e === "t") { out += "\t"; }
                    else if (e === "b") { out += "\b"; }
                    else if (e === "f") { out += "\f"; }
                    else if (e === "u") {
                        var hex = s.substring(i, i + 4);
                        if (!/^[0-9a-fA-F]{4}$/.test(hex)) { fail("bad unicode escape"); }
                        out += String.fromCharCode(parseInt(hex, 16));
                        i += 4;
                    } else { out += e; }
                } else { out += c; }
            }
            fail("unterminated string");
        }
        function arr() {
            var out = [];
            i++; ws();
            if (s.charAt(i) === "]") { i++; return out; }
            while (true) {
                out.push(value()); ws();
                var c = s.charAt(i++);
                if (c === "]") { return out; }
                if (c !== ",") { fail("expected , or ]"); }
            }
        }
        function obj() {
            var out = {};
            i++; ws();
            if (s.charAt(i) === "}") { i++; return out; }
            while (true) {
                ws();
                if (s.charAt(i) !== "\"") { fail("expected key"); }
                var k = string(); ws();
                if (s.charAt(i++) !== ":") { fail("expected :"); }
                out[k] = value(); ws();
                var c = s.charAt(i++);
                if (c === "}") { return out; }
                if (c !== ",") { fail("expected , or }"); }
            }
        }
        var result = value();
        ws();
        if (i < s.length) { fail("trailing characters"); }
        return result;
    };

    // ------------------------------------------------------------------
    // 可重現的亂數（Park-Miller，double 運算不會溢位）
    // ------------------------------------------------------------------
    S.Rng = function (seed) {
        var x = Math.floor(Math.abs(U.toNumber(seed, 1))) % 2147483647;
        if (x <= 0) { x += 2147483646; }
        this.state = x;
    };
    S.Rng.prototype.next = function () {
        this.state = (this.state * 16807) % 2147483647;
        return (this.state - 1) / 2147483646;
    };
    S.Rng.prototype.nextInt = function (n) {
        return Math.min(n - 1, Math.floor(this.next() * n));
    };
    S.Rng.prototype.pick = function (arr) {
        return arr[this.nextInt(arr.length)];
    };

    // ------------------------------------------------------------------
    // 減速曲線
    // i1 = 開始減速那格的影響值、i2 = 停輪那格的影響值、k = 減速距離 ÷ (速度 × 減速時間)。
    // Bezier 控制多邊形的斜率依序是 v、(k-i1)/(1-i1-i2)·v、0，曲線速度一定落在 0~v 之間：
    // 不會倒退、也不會比等速段還快。
    // ------------------------------------------------------------------
    S.CURVES = {
        standard: { i1: 1 / 3, i2: 1 / 3, k: 0.5 },  // 標準：等減速
        soft: { i1: 0.25, i2: 0.6, k: 0.35 },         // 緩停：先掉速，再長長地慢慢靠站（期待感）
        hard: { i1: 0.3, i2: 0.1, k: 0.7 }            // 急停：幾乎全速衝到底才煞住
    };
    S.CURVE_KEYS = ["standard", "soft", "hard"];
    S.CURVE_LABELS = ["標準", "緩停", "急停"];
    S.LINE_MODES = ["all_each", "all", "each"];
    S.LINE_MODE_LABELS = ["先全部再逐條", "全部一起", "逐條輪播"];
    S.LINE_COLORS = ["#FFD23C", "#3CDCFF", "#FF5A8C", "#78FF5A", "#B48CFF",
        "#FF9A3C", "#5AFFD2", "#FF3C3C", "#3C8CFF", "#F0F0F0"];
    S.MODES = ["reels", "holdspin"];
    var HS = S.hs = {};
    HS.ORDERS = ["col", "row", "all"];

    // ------------------------------------------------------------------
    // 預設設定
    // ------------------------------------------------------------------
    S.defaultConfig = function () {
        var cfg = {
            version: 2,
            // 符號庫：{ name, path, itemId, filler, scale（這個符號額外縮放 %，預設 100）}
            symbols: [],
            layout: {
                reels: 5,          // 輪數（直排數）
                rows: 3,           // 列數（每輪可見格數）
                cellW: 200,        // 格寬 px
                cellH: 200,        // 格高 px
                gapX: 10,          // 輪與輪的間距 px
                gapY: 0,           // 同一輪符號間距 px
                peek: 0,           // 上下額外露出 px
                margin: 60,        // 盤面合成四周留白 px（給繞框 / 連線光暈用）
                scaleMode: "fit",  // fit = 縮放到符合格子；none = 原尺寸
                symbolScale: 100,  // 額外縮放 %
                target: "active",  // active = 目前合成；new = 新建合成
                newCompFps: 30,
                position: null     // 盤面中心在目標合成的位置 [x, y]；null = 新建時放合成中央、更新時不動
            },
            spin: {
                startTime: 0,          // 開始轉動時間（秒，目標合成時間）
                // ---- 快速節奏：產生各輪表格（autoRhythm = 改了就自動套用）----
                autoRhythm: true,
                startOrder: "",        // 起轉順序，空白 = 1,2,3…
                startStagger: 0,       // 起轉間隔（秒）
                stopOrder: "",         // 停輪順序：逗號 = 先後、+ = 同時，例如 1+2,3,4,5 或 5,4,3,2,1
                firstStop: 1.0,        // 開始到第一次停輪（秒）
                stagger: 0.25,         // 每次停輪間隔（秒）
                speeds: "18",          // 轉速（格/秒）：一個數字 = 全部；列表 = 依停輪順序
                decelTime: 0.08,       // 減速時間（秒）
                decelCurve: "standard",
                overshoot: 0.15,       // 停輪衝過頭（格）
                bounceTime: 0.2,       // 回彈時間（秒）
                antReels: "",          // 期待輪（會繞框），例如 4,5
                antTime: 0.8,          // 每個期待輪多轉幾秒（會往後累加）
                antSpeed: 0,           // 繞框期間轉速（格/秒），0 = 不變
                antDecelTime: 0.45,
                antCurve: "soft",
                // ---- 手感 ----
                windupDist: 0.25,      // 起轉前反向拉回（格）
                windupTime: 0.15,
                accelTime: 0.15,
                speedRamp: 0.2,        // 切換到繞框轉速的過渡時間（秒）
                direction: "down",     // down / up
                seed: 1,
                motionBlur: true,
                shutterAngle: 180
            },
            // 期待感建議規則（S.anticipation.suggest 用）
            antRule: {
                symbols: "SCATTER",    // 觸發符號，可多個：SCATTER,BONUS
                count: 3,              // 幾顆觸發
                after: true,           // 已經達標後，後面的輪還要不要繼續期待（追更多顆）
                tease: "",             // 大獎聽牌符號，例如 SEVEN：同一條線連到第 N 輪時，下一輪期待
                teaseMin: 2            // 連幾輪後開始聽牌
            },
            // 各輪節奏（秒，從開始時間算起）；由「套用節奏」產生，可逐輪微調
            reels: [],
            // 繞框
            frame: {
                source: "builtin",     // builtin = 內建跑燈框；custom = 自訂素材
                itemId: 0, itemName: "", path: "",
                color: "#FFC83C",
                width: 8,              // 框線寬 px
                pad: 10,               // 框比轉輪外擴 px
                laps: 1.2,             // 跑燈每秒繞幾圈
                runner: 22,            // 跑燈長度 %
                glow: true,
                fade: 0.1,             // 淡入淡出（秒）
                hold: 0.15             // 停妥後再留多久（秒）
            },
            // 連線：{ pattern: "2,2,2,2,2"（每輪第幾列，1 起算；0 = 這輪不框）, count: 連幾個,
            //        shows: "0.3+1.2, 1.6+0.9"（停妥後開始+長度）, color: "", boxOnly: 只框格子不畫線（Scatter） }
            lines: [],
            lineSet: {
                paylines: "",          // 線型表（每行一條），空白 = 內建
                wilds: "WILD",         // 百搭符號
                exclude: "SCATTER",    // 不算連線的符號
                minCount: 3
            },
            lineGen: {
                delay: 0.3,            // 全部停妥後多久開始顯示（秒）
                mode: "all_each",
                allTime: 1.2,
                eachTime: 0.9,
                gap: 0.1
            },
            lineStyle: {
                width: 10,
                drawTime: 0.25,        // 畫線時間（秒）
                full: true,            // true = 線畫滿整個盤面；false = 只畫中獎段
                boxes: true,           // 中獎格框
                boxWidth: 6,
                pulse: 115,            // 中獎符號跳動放大 %，100 = 不跳
                glow: true,
                cellSource: "builtin", // builtin / custom（中獎格改用自訂素材）
                cellItemId: 0, cellItemName: "", cellPath: ""
            },
            // 面板「快速」頁：選的演出配方（S.RECIPE_KEYS）
            quick: {
                recipe: "normal"
            },
            // 盤面類型：reels = 整輪從起始盤面轉到結果盤面；holdspin = Hold & Spin 重轉（每格各自轉、鎖定、多回合）
            mode: "reels",
            // Hold & Spin（mode = holdspin）：layout.reels = 欄數、layout.rows = 列數，每格一條 1 格高的轉帶。
            // 起始盤面裡的空格符號 = 空格，其他符號一開始就鎖住；手感（拉回 / 加速 / 減速 / 衝過 / 回彈 / 期待）沿用 spin。
            hs: {
                blank: "",             // 空格符號名稱（例如 BLANK）
                rounds: "",            // 每回合一行：「@秒（可省略）盤面」，盤面由上到下逐列、列之間用 / 分隔，- = 這回合還是空格
                spins: 3,              // 落下新符號就重設成幾次
                startSpins: 3,         // 開始時剩幾次
                speed: 12,             // 轉速（格/秒）
                order: "col",          // 停格順序：col = 一欄一欄（上到下、左到右）；row = 一列一列；all = 同時
                firstStop: 0.85,       // 回合開始到第一格停下（秒）
                stagger: 0.22,         // 每格停下間隔（秒）
                roundGap: 1.2,         // 回合停妥到下一回合起轉（秒；回合沒寫 @秒 時用）
                antCells: 1,           // 這回合轉的格子 ≤ 幾格時當期待格（多轉 spin.antTime 秒）；0 = 不期待
                antFrame: true,        // 期待格繞框
                lockPulse: 115         // 鎖住時符號跳動放大 %，100 = 不跳
            },
            // 盤面 [輪][列]，列 0 = 最上方
            startBoard: [],
            endBoard: []
        };
        cfg.reels = S.generateReels(cfg);
        return cfg;
    };

    S.reelDefaults = function () {
        return {
            start: 0,              // 起轉（秒）
            stop: 1,               // 停輪（秒）= 衝到最遠點那一刻，可對齊音效
            speed: 18,             // 轉速（格/秒）
            decelTime: 0.08,
            decelCurve: "standard",
            overshoot: 0.15,
            bounceTime: 0.2,
            frame: false,          // 繞框
            frameStart: 0,         // 繞框開始（秒）；結束 = 停妥
            frameSpeed: 0          // 繞框期間轉速，0 = 不變
        };
    };

    S.lineDefaults = function () {
        return { pattern: "", count: 3, shows: "", color: "", boxOnly: false };
    };

    // 依預設值的型別複製欄位，忽略未知欄位
    function copyTyped(def, src) {
        var out = U.clone(def);
        if (!src || typeof src !== "object") { return out; }
        for (var k in def) {
            if (def.hasOwnProperty(k) && src.hasOwnProperty(k) && src[k] !== null && src[k] !== undefined) {
                var dv = def[k], v = src[k];
                if (typeof dv === "number") { out[k] = U.toNumber(v, dv); }
                else if (typeof dv === "boolean") { out[k] = typeof v === "string" ? /^(true|1|yes|on)$/i.test(U.trim(v)) : !!v; }
                else { out[k] = String(v); }
            }
        }
        return out;
    }

    function oneOf(v, list, fallback) {
        return U.indexOf(list, v) >= 0 ? v : fallback;
    }

    // 把讀入的設定補齊缺少欄位（舊版設定檔 / 手改的 JSON）
    S.normalizeConfig = function (cfg) {
        var def = S.defaultConfig();
        var out = U.clone(def), k;
        if (!cfg || typeof cfg !== "object") { cfg = {}; }
        if (U.isArray(cfg.symbols)) {
            for (k = 0; k < cfg.symbols.length; k++) {
                var e = cfg.symbols[k];
                if (!e || !e.name) { continue; }
                out.symbols.push({
                    name: String(e.name),
                    path: e.path ? String(e.path) : "",
                    itemId: e.itemId ? Number(e.itemId) : 0,
                    filler: e.filler !== false,
                    scale: U.toNumber(e.scale, 100)
                });
            }
        }
        var groups = ["layout", "spin", "antRule", "frame", "lineSet", "lineGen", "lineStyle", "quick", "hs"];
        for (var g = 0; g < groups.length; g++) {
            out[groups[g]] = copyTyped(def[groups[g]], cfg[groups[g]]);
        }
        out.mode = oneOf(cfg.mode, S.MODES, "reels");
        out.hs.order = oneOf(out.hs.order, HS.ORDERS, "col");
        out.hs.blank = U.trim(out.hs.blank);
        var hsInts = ["spins", "startSpins", "antCells"];
        for (k = 0; k < hsInts.length; k++) { out.hs[hsInts[k]] = Math.round(out.hs[hsInts[k]]); }
        var L = out.layout, P = out.spin;
        L.position = S.parsePosition(cfg.layout ? cfg.layout.position : null);
        L.reels = Math.round(U.clamp(L.reels, 1, 20));
        L.rows = Math.round(U.clamp(L.rows, 1, 20));
        // AE 合成尺寸必須是整數
        var ints = ["cellW", "cellH", "gapX", "gapY", "peek", "margin"];
        for (k = 0; k < ints.length; k++) { L[ints[k]] = Math.round(L[ints[k]]); }
        P.direction = oneOf(P.direction, ["down", "up"], "down");
        P.decelCurve = oneOf(P.decelCurve, S.CURVE_KEYS, "standard");
        out.quick.recipe = oneOf(out.quick.recipe, S.RECIPE_KEYS, "normal");
        P.antCurve = oneOf(P.antCurve, S.CURVE_KEYS, "soft");
        out.lineGen.mode = oneOf(out.lineGen.mode, S.LINE_MODES, "all_each");
        out.frame.source = oneOf(out.frame.source, ["builtin", "custom"], "builtin");
        out.lineStyle.cellSource = oneOf(out.lineStyle.cellSource, ["builtin", "custom"], "builtin");

        out.startBoard = S.board.resize(U.isArray(cfg.startBoard) ? cfg.startBoard : [], L.reels, L.rows, "");
        out.endBoard = S.board.resize(U.isArray(cfg.endBoard) ? cfg.endBoard : [], L.reels, L.rows, "");

        if (U.isArray(cfg.reels) && cfg.reels.length === L.reels) {
            out.reels = [];
            for (k = 0; k < cfg.reels.length; k++) {
                var r = copyTyped(S.reelDefaults(), cfg.reels[k]);
                r.decelCurve = oneOf(r.decelCurve, S.CURVE_KEYS, "standard");
                out.reels.push(r);
            }
        } else {
            out.reels = S.generateReels(out);
        }
        if (U.isArray(cfg.lines)) {
            for (k = 0; k < cfg.lines.length; k++) {
                var ln = copyTyped(S.lineDefaults(), cfg.lines[k]);
                ln.count = Math.round(ln.count);
                out.lines.push(ln);
            }
        }
        return out;
    };

    // ------------------------------------------------------------------
    // 節奏產生
    // ------------------------------------------------------------------
    S.parseNumbers = function (text) {
        var out = [], parts = String(text || "").split(/[\s,，;]+/);
        for (var i = 0; i < parts.length; i++) {
            if (parts[i] === "") { continue; }
            var n = parseFloat(parts[i]);
            if (!isNaN(n) && isFinite(n)) { out.push(n); }
        }
        return out;
    };

    // 盤面位置：[540, 1434] 或 "540,1434" -> [540, 1434]；空白 / 格式不對 -> null（= 維持置中）
    S.parsePosition = function (v) {
        var nums = U.isArray(v) ? v : S.parseNumbers(v === null || v === undefined ? "" : String(v).replace(/[xX×]/g, ","));
        if (!nums || nums.length !== 2) { return null; }
        var x = U.toNumber(nums[0], NaN), y = U.toNumber(nums[1], NaN);
        if (isNaN(x) || isNaN(y)) { return null; }
        return [x, y];
    };

    // "1+2, 3, 4, 5" -> [[0,1],[2],[3],[4]]；沒寫到的輪依序補在後面，重複的忽略
    S.parseOrder = function (text, n) {
        var steps = [], used = {}, i, j;
        var src = String(text || "").replace(/＋/g, "+").replace(/\s*\+\s*/g, "+");
        var parts = U.trim(src) === "" ? [] : U.trim(src).split(/[\s,，;>]+/);
        for (i = 0; i < parts.length; i++) {
            var nums = parts[i].split("+"), step = [];
            for (j = 0; j < nums.length; j++) {
                var k = parseInt(nums[j], 10) - 1;
                if (!isNaN(k) && k >= 0 && k < n && !used[k]) { step.push(k); used[k] = true; }
            }
            if (step.length) { steps.push(step); }
        }
        for (i = 0; i < n; i++) { if (!used[i]) { steps.push([i]); } }
        return steps;
    };

    function r3(v) { return Math.round(v * 1000) / 1000; }

    // 用「快速節奏」參數產生各輪表格
    S.generateReels = function (cfg) {
        var L = cfg.layout, P = cfg.spin, n = L.reels, i, k;
        var stopSteps = S.parseOrder(P.stopOrder, n);
        var startSteps = S.parseOrder(P.startOrder, n);
        var startOf = [];
        for (k = 0; k < startSteps.length; k++) {
            for (i = 0; i < startSteps[k].length; i++) { startOf[startSteps[k][i]] = k * P.startStagger; }
        }
        var speeds = S.parseNumbers(P.speeds);
        if (!speeds.length) { speeds = [18]; }
        var ant = {}, antList = S.parseNumbers(P.antReels);
        for (i = 0; i < antList.length; i++) { ant[Math.round(antList[i]) - 1] = true; }

        var reels = [];
        for (i = 0; i < n; i++) { reels.push(null); }
        var extra = 0, prevStop = -1;
        for (k = 0; k < stopSteps.length; k++) {
            var step = stopSteps[k], stepAnt = false;
            for (i = 0; i < step.length; i++) { if (ant[step[i]]) { stepAnt = true; } }
            if (stepAnt) { extra += P.antTime; }
            var stop = P.firstStop + k * P.stagger + extra;
            var speed = speeds[Math.min(k, speeds.length - 1)];
            for (i = 0; i < step.length; i++) {
                var r = step[i], isAnt = !!ant[r];
                var rd = S.reelDefaults();
                rd.start = r3(startOf[r] || 0);
                rd.stop = r3(stop);
                rd.speed = speed;
                rd.decelTime = isAnt ? P.antDecelTime : P.decelTime;
                rd.decelCurve = isAnt ? P.antCurve : P.decelCurve;
                rd.overshoot = P.overshoot;
                rd.bounceTime = P.bounceTime;
                rd.frame = isAnt;
                // 繞框從「上一次停輪」開始；第一步就期待的話從加速完成開始
                rd.frameStart = isAnt ? r3(prevStop >= 0 ? prevStop : rd.start + P.windupTime + P.accelTime) : 0;
                rd.frameSpeed = isAnt ? P.antSpeed : 0;
                reels[r] = rd;
            }
            prevStop = stop;
        }
        return reels;
    };

    // 設定檔裡的相對路徑（例如 symbols/A.png）以設定檔所在資料夾為基準轉成絕對路徑
    S.isAbsolutePath = function (p) {
        return /^([A-Za-z]:[\\\/]|[\\\/]|~)/.test(String(p || ""));
    };

    S.absolutizePaths = function (cfg, baseDir) {
        function fix(p) {
            if (!p || S.isAbsolutePath(p) || !baseDir) { return p; }
            return String(baseDir).replace(/[\\\/]+$/, "") + "/" + String(p).replace(/^\.[\\\/]/, "");
        }
        for (var i = 0; i < cfg.symbols.length; i++) { cfg.symbols[i].path = fix(cfg.symbols[i].path); }
        cfg.frame.path = fix(cfg.frame.path);
        cfg.lineStyle.cellPath = fix(cfg.lineStyle.cellPath);
        return cfg;
    };

    S.symbolNames = function (cfg) {
        var out = [];
        for (var i = 0; i < cfg.symbols.length; i++) { out.push(cfg.symbols[i].name); }
        return out;
    };

    // 單一符號的額外縮放 %（沒設定 = 100）
    S.entryScale = function (entry) {
        return entry && entry.scale !== undefined && entry.scale !== null ? Number(entry.scale) : 100;
    };

    // 符號名稱 -> 額外縮放 %
    S.symbolScales = function (cfg) {
        var out = {};
        for (var i = 0; i < cfg.symbols.length; i++) { out[cfg.symbols[i].name] = S.entryScale(cfg.symbols[i]); }
        return out;
    };

    S.fillerPool = function (cfg) {
        var out = [], i;
        for (i = 0; i < cfg.symbols.length; i++) {
            if (cfg.symbols[i].filler) { out.push(cfg.symbols[i].name); }
        }
        if (!out.length) { out = S.symbolNames(cfg); }
        return out;
    };

    // 名稱不重複：A, A_2, A_3...
    S.uniqueName = function (name, existing) {
        if (U.indexOf(existing, name) < 0) { return name; }
        var n = 2;
        while (U.indexOf(existing, name + "_" + n) >= 0) { n++; }
        return name + "_" + n;
    };

    // ------------------------------------------------------------------
    // 盤面
    // ------------------------------------------------------------------
    var B = S.board = {};

    B.create = function (reels, rows, fill) {
        var b = [];
        for (var r = 0; r < reels; r++) {
            var col = [];
            for (var y = 0; y < rows; y++) { col.push(fill); }
            b.push(col);
        }
        return b;
    };

    // 調整大小，保留原有內容
    B.resize = function (board, reels, rows, fill) {
        var out = B.create(reels, rows, fill);
        for (var r = 0; r < reels && r < board.length; r++) {
            if (!U.isArray(board[r])) { continue; }
            for (var y = 0; y < rows && y < board[r].length; y++) {
                out[r][y] = board[r][y] === null || board[r][y] === undefined ? fill : String(board[r][y]);
            }
        }
        return out;
    };

    B.randomize = function (reels, rows, pool, rng) {
        var b = B.create(reels, rows, "");
        if (!pool.length) { return b; }
        for (var r = 0; r < reels; r++) {
            for (var y = 0; y < rows; y++) { b[r][y] = rng.pick(pool); }
        }
        return b;
    };

    // 起始盤面用：亂數填充符號，不放觸發符號、也不要有連線（試 tries 次；都有連線就回傳最後一個，quiet = false）
    B.randomQuiet = function (cfg, rng, tries) {
        var L = cfg.layout, trig = S.parseNames(cfg.antRule.symbols), all = S.fillerPool(cfg), pool = [], i, b = null;
        for (i = 0; i < all.length; i++) { if (U.indexOf(trig, all[i]) < 0) { pool.push(all[i]); } }
        if (!pool.length) { pool = all; }
        var probe = { layout: L, lineSet: cfg.lineSet, antRule: cfg.antRule, endBoard: null };
        for (var k = 0; k < (tries || 200); k++) {
            b = B.randomize(L.reels, L.rows, pool, rng);
            probe.endBoard = b;
            if (!LN.detect(probe).lines.length) { return { board: b, quiet: true }; }
        }
        return { board: b, quiet: false };
    };

    B.matchName = function (token, names) {
        var i, t = U.trim(token);
        for (i = 0; i < names.length; i++) { if (names[i] === t) { return names[i]; } }
        var lt = t.toLowerCase();
        for (i = 0; i < names.length; i++) { if (names[i].toLowerCase() === lt) { return names[i]; } }
        return null;
    };

    // 文字格式：每一行是一列（由上到下），每行有「輪數」個符號名稱。
    // 有逗號或 Tab（從試算表貼上）就用逗號/Tab 分隔，否則用空白分隔。
    B.toText = function (board, rows) {
        var lines = [];
        for (var y = 0; y < rows; y++) {
            var cells = [];
            var useComma = false;
            for (var r = 0; r < board.length; r++) {
                cells.push(board[r][y] || "-");
                if (/\s/.test(board[r][y] || "")) { useComma = true; }
            }
            lines.push(cells.join(useComma ? ", " : " "));
        }
        return lines.join("\n");
    };

    B.parseText = function (text, reels, rows, names) {
        var errors = [];
        var raw = String(text).split(/\r\n|\r|\n/);
        var lines = [], i;
        for (i = 0; i < raw.length; i++) {
            if (U.trim(raw[i]) !== "") { lines.push(raw[i]); }
        }
        var board = B.create(reels, rows, "");
        if (lines.length !== rows) {
            errors.push(T("需要 {0} 行（每行一列），目前有 {1} 行", rows, lines.length));
        }
        for (var y = 0; y < Math.min(rows, lines.length); y++) {
            var line = lines[y];
            var tokens = /[,\t]/.test(line) ? line.split(/[,\t]/) : U.trim(line).split(/\s+/);
            var clean = [];
            for (i = 0; i < tokens.length; i++) {
                if (U.trim(tokens[i]) !== "") { clean.push(U.trim(tokens[i])); }
            }
            if (clean.length !== reels) {
                errors.push(T("第 {0} 行需要 {1} 個符號，目前有 {2} 個", y + 1, reels, clean.length));
            }
            for (var r = 0; r < Math.min(reels, clean.length); r++) {
                var m = B.matchName(clean[r], names);
                if (m === null) {
                    errors.push(T("第 {0} 行第 {1} 個：找不到符號「{2}」", y + 1, r + 1, clean[r]));
                } else {
                    board[r][y] = m;
                }
            }
        }
        return { board: board, errors: errors };
    };

    B.validate = function (board, reels, rows, names, label) {
        var errors = [];
        if (!U.isArray(board) || board.length !== reels) {
            errors.push(T("{0}：輪數不符", label));
            return errors;
        }
        for (var r = 0; r < reels; r++) {
            for (var y = 0; y < rows; y++) {
                var v = board[r] ? board[r][y] : "";
                if (!v) {
                    errors.push(T("{0}：第 {1} 輪第 {2} 列是空的", label, r + 1, y + 1));
                } else if (U.indexOf(names, v) < 0) {
                    errors.push(T("{0}：第 {1} 輪第 {2} 列的符號「{3}」不在符號庫裡", label, r + 1, y + 1, v));
                }
            }
        }
        return errors;
    };

    // ------------------------------------------------------------------
    // 連線
    // ------------------------------------------------------------------
    var LN = S.lines = {};

    // 線型 "2,2,2,2,2" -> [1,1,1,1,1]（0 起算）；錯誤回傳 null
    // allowGaps：0 或 - 代表這輪沒有格子（-1），用在 Scatter 等「只框格子、不畫線」的中獎
    LN.parsePattern = function (text, reels, rows, allowGaps) {
        var parts = String(text || "").replace(/-/g, " 0 ").split(/[\s,\uFF0C;]+/), nums = [], i;
        for (i = 0; i < parts.length; i++) {
            if (parts[i] === "") { continue; }
            var n = parseFloat(parts[i]);
            if (isNaN(n)) { return null; }
            nums.push(n);
        }
        if (nums.length !== reels) { return null; }
        var out = [], cells = 0;
        for (i = 0; i < nums.length; i++) {
            var v = Math.round(nums[i]);
            if (v !== nums[i]) { return null; }
            if (v === 0 && allowGaps) { out.push(-1); continue; }
            if (v < 1 || v > rows) { return null; }
            out.push(v - 1);
            cells++;
        }
        return cells ? out : null;
    };

    LN.isHighlight = function (pat) {
        for (var i = 0; i < pat.length; i++) { if (pat[i] < 0) { return true; } }
        return false;
    };

    // "0.3+1.2, 1.6+0.9" -> [{start:0.3,dur:1.2},{start:1.6,dur:0.9}]；錯誤回傳 null
    LN.parseShows = function (text) {
        var out = [], parts = U.trim(text || "") === "" ? [] : U.trim(text).split(/[,，;]+/);
        for (var i = 0; i < parts.length; i++) {
            var p = U.trim(parts[i]);
            if (p === "") { continue; }
            var m = /^(-?[\d.]+)\s*\+\s*([\d.]+)$/.exec(p);
            if (!m) { return null; }
            var s = parseFloat(m[1]), d = parseFloat(m[2]);
            if (isNaN(s) || isNaN(d) || d <= 0) { return null; }
            out.push({ start: s, dur: d });
        }
        return out;
    };

    LN.formatShows = function (shows) {
        var out = [];
        for (var i = 0; i < shows.length; i++) { out.push(r3(shows[i].start) + "+" + r3(shows[i].dur)); }
        return out.join(", ");
    };

    // 內建線型：5x3 用常見的 20 線，其他尺寸用直線 + V 形
    LN.defaultPaylines = function (reels, rows) {
        var out = [], r, y;
        if (reels === 5 && rows === 3) {
            return [[2, 2, 2, 2, 2], [1, 1, 1, 1, 1], [3, 3, 3, 3, 3], [1, 2, 3, 2, 1], [3, 2, 1, 2, 3],
                [1, 1, 2, 1, 1], [3, 3, 2, 3, 3], [2, 3, 3, 3, 2], [2, 1, 1, 1, 2], [2, 1, 2, 1, 2],
                [2, 3, 2, 3, 2], [1, 2, 1, 2, 1], [3, 2, 3, 2, 3], [2, 2, 1, 2, 2], [2, 2, 3, 2, 2],
                [1, 2, 2, 2, 1], [3, 2, 2, 2, 3], [1, 3, 1, 3, 1], [3, 1, 3, 1, 3], [1, 3, 3, 3, 1]];
        }
        var mid = Math.floor((rows - 1) / 2);
        var order = [mid];
        for (y = 0; y < rows; y++) { if (y !== mid) { order.push(y); } }
        for (var i = 0; i < order.length; i++) {
            var line = [];
            for (r = 0; r < reels; r++) { line.push(order[i] + 1); }
            out.push(line);
        }
        if (rows >= 2 && reels >= 3) {
            var v = [], w = [];
            for (r = 0; r < reels; r++) {
                var depth = Math.min(r, reels - 1 - r, rows - 1);
                v.push(depth + 1);
                w.push(rows - depth);
            }
            out.push(v);
            out.push(w);
        }
        return out;
    };

    LN.paylinesToText = function (lines) {
        var out = [];
        for (var i = 0; i < lines.length; i++) { out.push(lines[i].join(" ")); }
        return out.join("\n");
    };

    LN.paylines = function (cfg) {
        var L = cfg.layout, text = cfg.lineSet.paylines;
        if (U.trim(text || "") === "") { return { lines: LN.defaultPaylines(L.reels, L.rows), errors: [] }; }
        var rawLines = String(text).split(/\r\n|\r|\n/), out = [], errors = [];
        for (var i = 0; i < rawLines.length; i++) {
            if (U.trim(rawLines[i]) === "") { continue; }
            var p = LN.parsePattern(rawLines[i], L.reels, L.rows);
            if (!p) {
                errors.push(T("線型表第 {0} 行要有 {1} 個 1~{2} 的數字：{3}", i + 1, L.reels, L.rows, rawLines[i]));
            } else {
                var one = [];
                for (var k = 0; k < p.length; k++) { one.push(p[k] + 1); }
                out.push(one);
            }
        }
        return { lines: out, errors: errors };
    };

    // 從結果盤面找出中獎線：由第 1 輪往右連續相同（百搭可代替）
    LN.detect = function (cfg) {
        var L = cfg.layout, b = cfg.endBoard;
        var pl = LN.paylines(cfg);
        var wilds = S.parseNames(cfg.lineSet.wilds), exclude = S.parseNames(cfg.lineSet.exclude);
        var minCount = Math.max(1, Math.round(cfg.lineSet.minCount));
        var found = [];
        for (var i = 0; i < pl.lines.length; i++) {
            var line = pl.lines[i], seq = [], r;
            for (r = 0; r < L.reels; r++) { seq.push(b[r][line[r] - 1]); }
            var target = null;
            for (r = 0; r < seq.length; r++) {
                if (U.indexOf(wilds, seq[r]) < 0) { target = seq[r]; break; }
            }
            if (target === null) { target = seq[0]; }
            if (!target || U.indexOf(exclude, target) >= 0) { continue; }
            var count = 0;
            for (r = 0; r < seq.length; r++) {
                if (seq[r] === target || U.indexOf(wilds, seq[r]) >= 0) { count++; } else { break; }
            }
            if (count >= minCount) {
                found.push({ pattern: line.join(","), count: count, symbol: target, payline: i + 1 });
            }
        }
        // 觸發型（Scatter）不靠線：數到觸發數就框住所有觸發符號
        var trig = S.parseNames(cfg.antRule.symbols), need = Math.round(cfg.antRule.count);
        if (trig.length && need > 0) {
            var pat = [], n = 0, sym = "";
            for (var r = 0; r < L.reels; r++) {
                var hit = 0;
                for (var y = 0; y < L.rows; y++) {
                    if (U.indexOf(trig, b[r][y]) >= 0) { if (!hit) { hit = y + 1; sym = b[r][y]; } n++; }
                }
                pat.push(hit);
            }
            if (n >= need) { found.push({ pattern: pat.join(","), count: n, symbol: sym, payline: 0, scatter: true, boxOnly: true }); }
        }
        return { lines: found, errors: pl.errors };
    };

    // 依顯示模式排時間（停妥後秒數）
    LN.applyTiming = function (lines, gen) {
        var n = lines.length, i, t;
        for (i = 0; i < n; i++) {
            var shows = [];
            if (gen.mode === "all" || gen.mode === "all_each") {
                shows.push({ start: gen.delay, dur: gen.allTime });
            }
            if (gen.mode === "each" || gen.mode === "all_each") {
                t = gen.delay + (gen.mode === "all_each" ? gen.allTime + gen.gap : 0);
                shows.push({ start: t + i * (gen.eachTime + gen.gap), dur: gen.eachTime });
            }
            lines[i].shows = LN.formatShows(shows);
        }
        return lines;
    };

    S.parseNames = function (text) {
        var out = [], parts = String(text || "").split(/[,，;]+/);
        for (var i = 0; i < parts.length; i++) {
            var p = U.trim(parts[i]);
            if (p !== "") { out.push(p); }
        }
        return out;
    };

    S.hexToRgb = function (hex, fallback) {
        var m = /^#?([0-9a-fA-F]{6})$/.exec(U.trim(hex || ""));
        if (!m) { return fallback || [1, 1, 1]; }
        var n = parseInt(m[1], 16);
        return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    };

    S.rgbToHex = function (rgb) {
        var s = "#";
        for (var i = 0; i < 3; i++) {
            var h = Math.round(U.clamp(rgb[i], 0, 1) * 255).toString(16).toUpperCase();
            s += h.length < 2 ? "0" + h : h;
        }
        return s;
    };

    S.lineColor = function (line, index) {
        if (line.color && /^#?[0-9a-fA-F]{6}$/.test(U.trim(line.color))) { return S.hexToRgb(line.color); }
        return S.hexToRgb(S.LINE_COLORS[index % S.LINE_COLORS.length]);
    };

    // ------------------------------------------------------------------
    // 期待感建議
    //
    // 依「實際停輪順序」模擬玩家看到的過程：
    //  1. 觸發型（Scatter / Bonus）：已停的輪累積到「觸發數 - 1」顆時，之後停的輪都要期待；
    //     達標後是否繼續期待（追第 4、5 顆）由 after 決定。
    //  2. 聽牌型（大獎連線）：某條線從第 1 輪起已連到 teaseMin 輪以上（百搭可代替），
    //     下一輪就期待；連線一路延伸就一路期待到斷掉的那一輪為止。
    //     只有在前面的輪都比這一輪先停時才成立（玩家看得到才有期待）。
    // 回傳 { reels: [1 起算輪號], reasons: [說明], byReel: {輪號: 說明} }
    // ------------------------------------------------------------------
    var AN = S.anticipation = {};

    AN.suggest = function (cfg) {
        var L = cfg.layout, R = cfg.antRule, b = cfg.endBoard, i, r, k;
        var steps = S.parseOrder(cfg.spin.stopOrder, L.reels);
        var stepOf = [];
        for (k = 0; k < steps.length; k++) {
            for (i = 0; i < steps[k].length; i++) { stepOf[steps[k][i]] = k; }
        }
        var byReel = {}, reasons = [];
        function mark(reel, why) {
            if (!byReel[reel + 1]) { byReel[reel + 1] = why; }
        }

        // 1. 觸發型
        var trig = S.parseNames(R.symbols), need = Math.round(R.count);
        if (trig.length && need > 1) {
            var landed = 0;
            for (k = 0; k < steps.length; k++) {
                if (landed >= need - 1 && (landed < need || R.after)) {
                    for (i = 0; i < steps[k].length; i++) {
                        mark(steps[k][i], T("已停的輪有 {0} 顆 {1}{2}", landed, trig.join("/"), landed < need ? T("（差 1 顆觸發）") : T("（已觸發，追更多顆）")));
                    }
                }
                for (i = 0; i < steps[k].length; i++) {
                    r = steps[k][i];
                    for (var y = 0; y < L.rows; y++) {
                        if (U.indexOf(trig, b[r][y]) >= 0) { landed++; }
                    }
                }
            }
            reasons.push(T("{0} 共 {1} 顆（{2} 顆觸發）{3}", trig.join("/"), landed, need, landed >= need ? T("：觸發") : T("：未觸發")));
        }

        // 2. 聽牌型
        var tease = S.parseNames(R.tease), teaseMin = Math.max(1, Math.round(R.teaseMin));
        if (tease.length) {
            var wilds = S.parseNames(cfg.lineSet.wilds);
            var pl = LN.paylines(cfg).lines;
            for (var li = 0; li < pl.length; li++) {
                var line = pl[li], target = null, run = 0;
                for (r = 0; r < L.reels; r++) {
                    var sym = b[r][line[r] - 1];
                    if (U.indexOf(wilds, sym) >= 0) { run++; continue; }
                    if (target === null) { target = sym; }
                    if (sym === target) { run++; } else { break; }
                }
                if (target === null || U.indexOf(tease, target) < 0 || run < teaseMin) { continue; }
                // 第 teaseMin+1 輪 ~ 斷掉的那一輪都期待
                for (r = teaseMin; r <= Math.min(run, L.reels - 1); r++) {
                    var visible = true;
                    for (var p = 0; p < r; p++) { if (stepOf[p] >= stepOf[r]) { visible = false; } }
                    if (visible) { mark(r, T("線 {0} 的 {1} 已連 {2} 輪（聽牌）", li + 1, target, r)); }
                }
            }
        }

        var list = [];
        for (r = 1; r <= L.reels; r++) {
            if (byReel[r]) {
                list.push(r);
                reasons.push(T("第 {0} 輪期待：{1}", r, byReel[r]));
            }
        }
        return { reels: list, reasons: reasons, byReel: byReel };
    };

    // 套用建議：寫入 antReels 並重新產生各輪
    AN.apply = function (cfg) {
        var res = AN.suggest(cfg);
        cfg.spin.antReels = res.reels.join(",");
        cfg.reels = S.generateReels(cfg);
        return res;
    };

    // ------------------------------------------------------------------
    // 演出配方（面板「快速」頁用）：照 .claude/skills/slot-fake-spin/reference/anticipation.md 第 3 節
    // ------------------------------------------------------------------
    S.RECIPE_KEYS = ["normal", "trigger", "miss", "tease", "turbo"];
    S.RECIPE_LABELS = ["一般轉", "觸發（Scatter / 寶石…）", "期待落空", "大獎聽牌", "快速轉"];
    var RC = S.recipes = {};
    // 配方會動到的節奏參數：每次套用前先還原成一般轉的值，切換配方才不會殘留上一個的設定
    var RECIPE_SPIN = ["firstStop", "stagger", "speeds", "decelTime", "decelCurve", "overshoot", "bounceTime",
        "windupDist", "windupTime", "antReels", "antTime", "antSpeed", "antDecelTime", "antCurve"];

    // 偵測結果盤面的連線並排好顯示時間
    LN.detectInto = function (cfg) {
        var res = LN.detect(cfg), out = [];
        for (var i = 0; i < res.lines.length; i++) {
            var d = S.lineDefaults();
            d.pattern = res.lines[i].pattern;
            d.count = res.lines[i].count;
            d.boxOnly = !!res.lines[i].boxOnly;
            out.push(d);
        }
        cfg.lines = LN.applyTiming(out, cfg.lineGen);
        return res;
    };

    // 起始盤面是否「安靜」：填滿、沒有觸發符號、沒有連線（不會先讓人期待或以為中了）
    B.isQuiet = function (cfg, board) {
        var trig = S.parseNames(cfg.antRule.symbols), r, y;
        for (r = 0; r < board.length; r++) {
            for (y = 0; y < board[r].length; y++) {
                if (!board[r][y] || U.indexOf(trig, board[r][y]) >= 0) { return false; }
            }
        }
        var probe = { layout: cfg.layout, lineSet: cfg.lineSet, antRule: cfg.antRule, endBoard: board };
        var res = LN.detect(probe);
        for (r = 0; r < res.lines.length; r++) { if (!res.lines[r].scatter) { return false; } }
        return true;
    };

    // key：S.RECIPE_KEYS 之一；opts：{ symbols, count（觸發 / 落空）, tease（聽牌）}
    // 回傳 { key, reels: 期待輪（1 起算）, reasons, lines: 連線數 }
    RC.apply = function (cfg, key, opts) {
        opts = opts || {};
        var P = cfg.spin, R = cfg.antRule, def = S.defaultConfig().spin, i;
        if (U.indexOf(S.RECIPE_KEYS, key) < 0) { key = "normal"; }
        for (i = 0; i < RECIPE_SPIN.length; i++) { P[RECIPE_SPIN[i]] = def[RECIPE_SPIN[i]]; }
        if (opts.symbols !== undefined) { R.symbols = String(opts.symbols); }
        if (opts.count !== undefined && Number(opts.count) >= 1) { R.count = Math.round(Number(opts.count)); }
        if (opts.tease !== undefined) { R.tease = String(opts.tease); }
        var res = { key: key, reels: [], reasons: [], lines: 0 };

        if (key === "turbo") {
            P.firstStop = 0.55; P.stagger = 0.1; P.speeds = "24"; P.decelCurve = "hard"; P.decelTime = 0.06;
            P.overshoot = 0.08; P.bounceTime = 0.12; P.windupDist = 0.1; P.windupTime = 0.08;
        } else if (key === "trigger" || key === "miss") {
            R.after = true;
            P.antTime = 0.9; P.antDecelTime = 0.55; P.antCurve = "soft"; P.antSpeed = 0;
        } else if (key === "tease") {
            P.antTime = 0.7; P.antSpeed = 24;
        }
        if (key === "trigger" || key === "miss" || key === "tease") {
            var sug = AN.suggest(cfg);
            res.reels = sug.reels;
            res.reasons = sug.reasons;
            P.antReels = sug.reels.join(",");
        }
        cfg.reels = S.generateReels(cfg);

        // 一層比一層強：最後一個期待輪如果也是最後停的，再多拖 0.3 秒
        if ((key === "trigger" || key === "miss") && res.reels.length >= 2) {
            var steps = S.parseOrder(P.stopOrder, cfg.layout.reels), lastStep = steps[steps.length - 1];
            var lastAnt = res.reels[res.reels.length - 1] - 1;
            if (lastStep.length === 1 && lastStep[0] === lastAnt) { cfg.reels[lastAnt].stop = r3(cfg.reels[lastAnt].stop + 0.3); }
        }

        // 連線：落空不要任何中獎演出；觸發型一起亮久一點、符號跳大一點
        if (key === "miss") {
            cfg.lines = [];
        } else {
            if (key === "trigger") {
                cfg.lineGen.delay = 0.2; cfg.lineGen.mode = "all"; cfg.lineGen.allTime = 1.8;
                cfg.lineStyle.pulse = 120;
            }
            LN.detectInto(cfg);
        }
        res.lines = cfg.lines.length;
        if (cfg.quick) { cfg.quick.recipe = key; }
        return res;
    };

    // ------------------------------------------------------------------
    // 設定驗證
    // ------------------------------------------------------------------
    S.validateConfig = function (cfg) {
        var e = [], L = cfg.layout, P = cfg.spin, i;
        var names = S.symbolNames(cfg);
        if (!names.length) { e.push(T("符號庫是空的：請先匯入符號圖檔")); }
        if (L.cellW < 4 || L.cellH < 4) { e.push(T("格子寬高至少要 4px")); }
        if (L.gapX < 0 || L.gapY < 0 || L.peek < 0 || L.margin < 0) { e.push(T("間距 / 露出 / 留白不能是負數")); }
        if (L.symbolScale <= 0) { e.push(T("符號縮放必須大於 0")); }
        for (i = 0; i < cfg.symbols.length; i++) {
            if (!(S.entryScale(cfg.symbols[i]) > 0)) { e.push(T("符號「{0}」的縮放必須大於 0", cfg.symbols[i].name)); }
        }
        if (P.startTime < 0) { e.push(T("開始時間不能是負數")); }
        var nonNeg = ["windupDist", "windupTime", "accelTime", "speedRamp"];
        for (i = 0; i < nonNeg.length; i++) {
            if (P[nonNeg[i]] < 0) { e.push(T("手感參數不能是負數：{0}", nonNeg[i])); }
        }
        if (cfg.mode === "holdspin") { return e.concat(HS.validate(cfg, names)); }
        var bw = L.reels * L.cellW + (L.reels - 1) * L.gapX + 2 * L.margin;
        var bh = S.reelHeight(L) + 2 * L.margin;
        if (bw > 30000 || bh > 30000) { e.push(T("盤面尺寸超過 AE 上限 30000px")); }
        if (!U.isArray(cfg.reels) || cfg.reels.length !== L.reels) {
            e.push(T("各輪節奏表與輪數不符，請按「套用節奏」"));
        } else {
            for (i = 0; i < cfg.reels.length; i++) {
                var R = cfg.reels[i], tag = T("第 {0} 輪：", i + 1);
                if (R.speed <= 0) { e.push(T("{0}轉速必須大於 0", tag)); }
                if (R.start < 0) { e.push(T("{0}起轉時間不能是負數", tag)); }
                if (R.stop <= R.start) { e.push(T("{0}停輪時間必須晚於起轉時間", tag)); }
                if (R.decelTime < 0 || R.overshoot < 0 || R.bounceTime < 0) { e.push(T("{0}減速 / 衝過 / 回彈不能是負數", tag)); }
                if (R.frame && R.frameStart >= R.stop) { e.push(T("{0}繞框開始時間必須早於停輪時間", tag)); }
                if (R.frame && R.frameSpeed < 0) { e.push(T("{0}繞框轉速不能是負數", tag)); }
            }
        }
        for (i = 0; i < cfg.lines.length; i++) {
            var ln = cfg.lines[i], lt = T("連線 {0}：", i + 1);
            var lp = LN.parsePattern(ln.pattern, L.reels, L.rows, true);
            if (!lp) {
                e.push(T("{0}線型要有 {1} 個 1~{2} 的數字（每輪第幾列；0 = 這輪不框），目前是「{3}」", lt, L.reels, L.rows, ln.pattern));
            } else if (!ln.boxOnly && !LN.isHighlight(lp) && (ln.count < 1 || ln.count > L.reels)) {
                e.push(T("{0}連線數要在 1~{1} 之間", lt, L.reels));
            }
            var shows = LN.parseShows(ln.shows);
            if (!shows) { e.push(T("{0}顯示時間格式是「開始+長度」，例如 0.3+1.2, 1.6+0.9", lt)); }
            else if (!shows.length) { e.push(T("{0}沒有設定顯示時間", lt)); }
        }
        if (names.length) {
            e = e.concat(B.validate(cfg.startBoard, L.reels, L.rows, names, T("起始盤面")));
            e = e.concat(B.validate(cfg.endBoard, L.reels, L.rows, names, T("結果盤面")));
        }
        return e;
    };

    S.reelHeight = function (L) {
        return L.rows * (L.cellH + L.gapY) - L.gapY + 2 * L.peek;
    };

    // 盤面合成座標：第 r 輪中心 x
    S.reelCenterX = function (L, r) {
        return L.margin + r * (L.cellW + L.gapX) + L.cellW / 2;
    };

    // 盤面合成座標：第 r 輪第 row 列格子中心
    S.cellCenter = function (L, r, row) {
        return [S.reelCenterX(L, r), L.margin + L.peek + row * (L.cellH + L.gapY) + L.cellH / 2];
    };

    // ------------------------------------------------------------------
    // 轉輪動態計算
    //
    // 每一輪是一條長長的「轉帶」（strip），由一顆 null 帶著上下移動。
    // 向下轉時，轉帶由上到下為：
    //   [緩衝 b 格][結果盤面 rows 格][填充 N 格][起始盤面 rows 格][緩衝 b 格]
    // 一開始畫面看到「起始盤面」，轉帶往下移 (rows+N) 格後看到「結果盤面」。向上轉則反過來。
    //
    // null 的 Y Position 由一串「速度區段」組成，關鍵影格都對齊影格：
    //   起轉 → 反向拉回 → 加速(0→v1) → 等速 v1 → [繞框：v1→v2 → 等速 v2] → 減速(曲線) → 停輪(衝過頭) → 回彈
    // 先用設定的轉速算出要經過幾格（取整數 N），再把所有速度等比例微調，讓停輪位置分毫不差。
    // 加速、變速區段用 33.333% 影響值 = 精準的等加速度；等速區段是精準的直線，所以速度處處連續。
    // ------------------------------------------------------------------
    S.INF_LINEAR = 100 / 3;

    S.computePlan = function (cfg, fps, opts) {
        if (cfg.mode === "holdspin") { return HS.computePlan(cfg, fps, opts); }
        opts = opts || {};
        var L = cfg.layout, P = cfg.spin, F = cfg.frame;
        var errors = [], warnings = [];
        if (!(fps > 0)) { return { errors: [T("影格速率錯誤")], warnings: [] }; }
        var frame = 1 / fps, EPS = 1e-9;
        function snap(t) { return Math.round(t * fps) / fps; }
        function atLeast(t, min) { return t < min - EPS ? min : t; }

        var rows = L.rows, reels = L.reels;
        var pitch = L.cellH + L.gapY;
        var reelH = S.reelHeight(L);
        var dir = P.direction === "up" ? -1 : 1;
        var timeOffset = opts.timeOffset || 0;
        var windup = (P.windupDist > 0 && P.windupTime > 0) ? P.windupDist * L.cellH : 0;
        var minFill = Math.max(rows, 2);
        var pool = opts.fillerPool || S.fillerPool(cfg);
        var rng = new S.Rng(P.seed);
        var reelCfg = cfg.reels;
        if (!U.isArray(reelCfg) || reelCfg.length !== reels) { reelCfg = S.generateReels(cfg); }

        var T0 = snap(P.startTime - timeOffset);
        var reelsW = reels * L.cellW + (reels - 1) * L.gapX;
        var plan = {
            fps: fps,
            pitch: pitch,
            reelW: L.cellW,
            reelH: reelH,
            margin: L.margin,
            reelsW: reelsW,
            boardW: reelsW + 2 * L.margin,
            boardH: reelH + 2 * L.margin,
            direction: dir,
            startTime: T0,
            reels: [],
            frames: [],
            lines: [],
            markers: [{ t: T0, label: "SPIN" }],
            allSettled: T0,
            endTime: T0,
            errors: errors,
            warnings: warnings
        };

        var E = motionEnv(cfg, fps);
        for (var i = 0; i < reels; i++) {
            var R = reelCfg[i], tag = T("第 {0} 輪", i + 1);
            var tStop = snap(T0 + R.stop);
            var mo = spinMotion(E, {
                tS: snap(T0 + R.start), tStop: tStop, speed: R.speed, decelTime: R.decelTime, decelCurve: R.decelCurve,
                overshoot: R.overshoot, bounceTime: R.bounceTime,
                frameStart: R.frame && R.frameSpeed > 0 ? snap(T0 + R.frameStart) : -1, frameSpeed: R.frameSpeed
            });
            if (mo.tooShort) {
                errors.push(T("{0}停得太早：從起轉到停輪至少要 {1} 秒（拉回+加速+減速）", tag, mo.tooShort));
                continue;
            }
            if (mo.rampIgnored) { warnings.push(T("{0}：繞框轉速的切換時間不在等速區段內，已忽略", tag)); }
            var buffer = Math.ceil((L.peek + Math.max(windup, mo.overshoot) + L.gapY) / pitch) + 1;
            var fit = fitTravel(E, mo, rows, minFill);

            // 轉帶內容
            var strip = buildStrip(cfg.startBoard[i], cfg.endBoard[i], rows, fit.fill, buffer, dir, pool, rng);
            var y0 = L.peek - strip.startIndex * pitch;
            var yEnd = L.peek - strip.endIndex * pitch;
            var keys = [];
            spinKeys(keys, mo, y0, yEnd, dir, fit.scale, windup);

            var rp = {
                index: i,
                x: S.reelCenterX(L, i),
                strip: strip.items,
                startIndex: strip.startIndex,
                endIndex: strip.endIndex,
                fill: fit.fill,
                speed: fit.scale * Math.max(mo.v1, mo.vLast),
                speeds: [fit.scale * mo.v1, fit.scale * mo.vLast],
                startY: y0,
                endY: yEnd,
                spinStart: mo.tS,
                accelEnd: mo.t2,
                decelStart: mo.t3,
                stopTime: tStop,
                settleTime: mo.t5,
                keys: keys
            };
            var t5 = mo.t5;
            plan.reels.push(rp);
            plan.markers.push({ t: tStop, label: "R" + (i + 1) + " STOP" });
            if (t5 > plan.allSettled) { plan.allSettled = t5; }

            if (R.frame) {
                var fs = snap(T0 + R.frameStart);
                if (fs >= tStop - EPS) {
                    errors.push(T("{0}繞框開始時間必須早於停輪時間", tag));
                } else {
                    plan.frames.push({ reel: i, start: fs, end: snap(t5 + Math.max(0, F.hold)), x: rp.x });
                    plan.markers.push({ t: fs, label: "R" + (i + 1) + " FRAME" });
                }
            }
        }
        plan.endTime = plan.allSettled;
        for (i = 0; i < plan.frames.length; i++) {
            plan.endTime = Math.max(plan.endTime, plan.frames[i].end + Math.max(0, F.fade));
        }

        // 連線
        for (i = 0; i < cfg.lines.length; i++) {
            var ln = cfg.lines[i];
            var pat = LN.parsePattern(ln.pattern, reels, rows, true);
            var shows = LN.parseShows(ln.shows);
            if (!pat || !shows || !shows.length) {
                errors.push(T("連線 {0} 設定錯誤", i + 1));
                continue;
            }
            var highlight = !!ln.boxOnly || LN.isHighlight(pat);
            var count = Math.round(U.clamp(ln.count, 1, reels));
            var cells = [], points = [], r;
            for (r = 0; r < reels; r++) {
                if (highlight) {
                    if (pat[r] >= 0) { cells.push([r, pat[r]]); }
                    continue;
                }
                if (r < count) { cells.push([r, pat[r]]); }
                if (cfg.lineStyle.full || r < count) { points.push(S.cellCenter(L, r, pat[r])); }
            }
            // 頭尾延伸到格子邊緣
            if (points.length) {
                points.unshift([points[0][0] - L.cellW / 2, points[0][1]]);
                var lp = points[points.length - 1];
                points.push([lp[0] + L.cellW / 2, lp[1]]);
            }
            var abs = [];
            for (var k = 0; k < shows.length; k++) {
                var st = snap(plan.allSettled + shows[k].start);
                var en = atLeast(snap(st + shows[k].dur), st + frame);
                abs.push({ start: st, end: en });
                plan.markers.push({ t: st, label: "LINE " + (i + 1) });
                if (en > plan.endTime) { plan.endTime = en; }
            }
            plan.lines.push({ index: i, cells: cells, points: points, shows: abs, color: S.lineColor(ln, i), pattern: pat, highlight: highlight });
        }
        if (plan.reels.length === reels) {
            plan.markers.push({ t: plan.allSettled, label: "ALL SETTLED" });
        }
        plan.markers = mergeMarkers(plan.markers);
        return plan;
    };

    // 依 AE 的時間 Bezier 規則計算關鍵影格在時間 t 的值（給預覽 / 檢查用，和 AE 結果一致）
    S.evalKeys = function (keys, t) {
        var n = keys.length;
        if (!n) { return 0; }
        if (t <= keys[0].t) { return keys[0].y; }
        if (t >= keys[n - 1].t) { return keys[n - 1].y; }
        var j = 0;
        while (keys[j + 1].t < t) { j++; }
        var a = keys[j], b = keys[j + 1], dt = b.t - a.t;
        var i1 = a.outInf / 100, i2 = b.inInf / 100;
        if (i1 + i2 > 1) { var sum = i1 + i2; i1 /= sum; i2 /= sum; }
        var x1 = a.t + i1 * dt, x2 = b.t - i2 * dt;
        var y1 = a.y + a.outSpeed * i1 * dt, y2 = b.y - b.inSpeed * i2 * dt;
        function bez(p0, p1, p2, p3, u) {
            var m = 1 - u;
            return m * m * m * p0 + 3 * m * m * u * p1 + 3 * m * u * u * p2 + u * u * u * p3;
        }
        var lo = 0, hi = 1;
        for (var it = 0; it < 50; it++) {
            var mid = (lo + hi) / 2;
            if (bez(a.t, x1, x2, b.t, mid) < t) { lo = mid; } else { hi = mid; }
        }
        return bez(a.y, y1, y2, b.y, (lo + hi) / 2);
    };

    // AE 同一時間只能有一個標記：排序後把同一格的標記合併成「A / B」
    function mergeMarkers(list) {
        list.sort(function (a, b) { return a.t - b.t; });
        var out = [];
        for (var i = 0; i < list.length; i++) {
            var last = out[out.length - 1];
            if (last && Math.abs(last.t - list[i].t) < 1e-6) {
                if (U.indexOf(last.label.split(" / "), list[i].label) < 0) { last.label += " / " + list[i].label; }
            } else {
                out.push({ t: list[i].t, label: list[i].label });
            }
        }
        return out;
    }

    function mkKey(t, y, inSpeed, inInf, outSpeed, outInf) {
        return { t: t, y: y, inSpeed: inSpeed, inInf: inInf, outSpeed: outSpeed, outInf: outInf };
    }

    // ------------------------------------------------------------------
    // 一次轉動：起轉 → 反向拉回 → 加速 → 等速 →[繞框變速]→ 減速 → 停輪(衝過頭) → 回彈
    // 轉輪模式每輪轉一次；Hold & Spin 每格每回合轉一次（同一條轉帶接著轉）。
    // ------------------------------------------------------------------
    function motionEnv(cfg, fps) {
        var L = cfg.layout, P = cfg.spin, frame = 1 / fps;
        return {
            P: P, frame: frame, EPS: 1e-9,
            snap: function (t) { return Math.round(t * fps) / fps; },
            atLeast: function (t, min) { return t < min - 1e-9 ? min : t; },
            pitch: L.cellH + L.gapY,
            cellH: L.cellH,
            windup: (P.windupDist > 0 && P.windupTime > 0) ? P.windupDist * L.cellH : 0
        };
    }

    // m：{ tS, tStop（已對齊影格）, speed（格/秒）, decelTime, decelCurve, overshoot（格）, bounceTime,
    //      frameStart（已對齊影格；-1 = 不變速）, frameSpeed（格/秒）}
    // 回傳時間點與速度區段（名目速度，fitTravel 再等比例縮放）；tooShort = 時間不夠時需要的最短秒數
    function spinMotion(E, m) {
        var P = E.P, frame = E.frame, EPS = E.EPS, snap = E.snap, atLeast = E.atLeast;
        var overshoot = (m.overshoot > 0 && m.bounceTime > 0) ? m.overshoot * E.cellH : 0;
        var tS = m.tS, tStop = m.tStop;
        var t1 = E.windup > 0 ? atLeast(snap(tS + P.windupTime), tS + frame) : tS;
        var t2 = atLeast(snap(t1 + P.accelTime), t1 + frame);
        var t3 = snap(tStop - m.decelTime);
        if (t3 > tStop - frame + EPS) { t3 = tStop - frame; }
        var t5 = overshoot > 0 ? atLeast(snap(tStop + m.bounceTime), tStop + frame) : tStop;
        if (t2 > t3 + EPS) { return { tooShort: Math.round((t2 - tS + (tStop - t3)) * 100) / 100 }; }

        var v1 = Math.max(0.01, m.speed) * E.pitch, vLast = v1, rampIgnored = false;
        var segs = [{ a: t1, b: t2, va: 0, vb: v1, d: v1 * (t2 - t1) / 2 }];
        var tA = m.frameStart, tB = -1;
        if (tA >= 0) { tB = atLeast(snap(tA + P.speedRamp), tA + frame); }
        if (tA >= 0 && tA >= t2 - EPS && tB <= t3 + EPS) {
            var v2 = m.frameSpeed * E.pitch;
            if (tA - t2 > EPS) { segs.push({ a: t2, b: tA, va: v1, vb: v1, d: v1 * (tA - t2) }); }
            segs.push({ a: tA, b: tB, va: v1, vb: v2, d: (v1 + v2) / 2 * (tB - tA) });
            if (t3 - tB > EPS) { segs.push({ a: tB, b: t3, va: v2, vb: v2, d: v2 * (t3 - tB) }); }
            vLast = v2;
        } else {
            rampIgnored = tA >= 0;
            if (t3 - t2 > EPS) { segs.push({ a: t2, b: t3, va: v1, vb: v1, d: v1 * (t3 - t2) }); }
        }
        var curve = S.CURVES[m.decelCurve] || S.CURVES.standard;
        segs.push({ a: t3, b: tStop, va: vLast, vb: 0, d: curve.k * vLast * (tStop - t3), infA: curve.i1 * 100, infB: curve.i2 * 100 });
        var nominal = 0;
        for (var s = 0; s < segs.length; s++) { nominal += segs[s].d; }
        return { tS: tS, t1: t1, t2: t2, t3: t3, tStop: tStop, t5: t5, segs: segs, v1: v1, vLast: vLast,
            overshoot: overshoot, nominal: nominal, rampIgnored: rampIgnored };
    }

    // 用名目速度算出要經過幾格（取整數），回傳 { fill, scale }：所有速度乘上 scale，停輪位置就分毫不差。
    // rows = 視窗格數：轉輪 = 列數；Hold & Spin 一格 = 1（從目前的符號移到結果，中間經過 fill 格）
    function fitTravel(E, mo, rows, minFill) {
        var fill = Math.round((mo.nominal - E.windup - mo.overshoot) / E.pitch - rows);
        if (fill < minFill) { fill = minFill; }
        return { fill: fill, scale: (E.windup + (rows + fill) * E.pitch + mo.overshoot) / mo.nominal };
    }

    // 把一次轉動寫成關鍵影格，接在 keys 後面：從 y0 轉到 yEnd（停妥位置）
    function spinKeys(keys, mo, y0, yEnd, dir, scale, windup) {
        var y = y0, s;
        if (windup > 0) {
            keys.push(mkKey(mo.tS, y0, 0, S.INF_LINEAR, 0, 50));
            y = y0 - dir * windup;
            keys.push(mkKey(mo.t1, y, 0, 50, 0, S.INF_LINEAR));
        } else {
            keys.push(mkKey(mo.tS, y0, 0, S.INF_LINEAR, 0, S.INF_LINEAR));
        }
        for (s = 0; s < mo.segs.length; s++) {
            var sg = mo.segs[s], last = keys[keys.length - 1];
            last.outSpeed = dir * scale * sg.va;
            last.outInf = sg.infA || S.INF_LINEAR;
            y += dir * scale * sg.d;
            keys.push(mkKey(sg.b, y, dir * scale * sg.vb, sg.infB || S.INF_LINEAR, dir * scale * sg.vb, S.INF_LINEAR));
        }
        var stopKey = keys[keys.length - 1];
        stopKey.y = yEnd + dir * mo.overshoot; // 消除浮點誤差
        if (mo.overshoot > 0) {
            stopKey.outSpeed = 0;
            stopKey.outInf = 40;
            keys.push(mkKey(mo.t5, yEnd, 0, 60, 0, S.INF_LINEAR));
        }
    }

    // 隨機填充：避免同一個符號連續出現（符號庫只有 1 種時例外）
    function buildStrip(startCol, endCol, rows, fill, buffer, dir, pool, rng) {
        var items = [];
        var last = null;
        function rand(kind, n) {
            for (var k = 0; k < n; k++) {
                var name = rng.pick(pool);
                var guard = 0;
                while (pool.length > 1 && name === last && guard++ < 16) { name = rng.pick(pool); }
                items.push({ name: name, kind: kind, n: k + 1 });
                last = name;
            }
        }
        function board(kind, col) {
            for (var y = 0; y < rows; y++) {
                items.push({ name: col[y], kind: kind, n: y + 1 });
                last = col[y];
            }
        }
        var first = dir > 0 ? ["end", endCol] : ["start", startCol];
        var second = dir > 0 ? ["start", startCol] : ["end", endCol];
        rand("buffer", buffer);
        var firstIdx = items.length;
        board(first[0], first[1]);
        rand("fill", fill);
        var secondIdx = items.length;
        board(second[0], second[1]);
        rand("buffer", buffer);
        return {
            items: items,
            startIndex: dir > 0 ? secondIdx : firstIdx,
            endIndex: dir > 0 ? firstIdx : secondIdx
        };
    }

    // 轉帶上第 k 格符號在 null 座標系中的中心點
    S.stripLocalPos = function (L, k) {
        return [L.cellW / 2, k * (L.cellH + L.gapY) + L.cellH / 2];
    };

    // owner：圖層名稱開頭，預設 R<輪號>（Hold & Spin 的格子是 C<列>-<欄>）
    // S = 起始、E = 結果、H = Hold & Spin 第幾回合停下的符號、F = 填充、B = 緩衝
    S.layerNameFor = function (reelIndex, item, owner) {
        var prefix = { start: "S", end: "E", round: "H", fill: "F", buffer: "B" }[item.kind] || "X";
        return (owner || "R" + (reelIndex + 1)) + "_" + prefix + U.pad(item.n, 2) + "_" + item.name;
    };

    // ------------------------------------------------------------------
    // Hold & Spin 重轉（cfg.mode = "holdspin"）
    //
    // 盤面是 layout.reels 欄 × layout.rows 列個獨立格子，每格是一條 1 格高的轉帶（格子沒有露出 peek）。
    // 起始盤面：hs.blank（空格符號）= 空格，其他符號一開始就鎖住。
    // hs.rounds 每行一回合（也可以用 ; 分隔）：「@秒」（可省略）+ 盤面。盤面由上到下逐列、列之間用 / 分隔
    //   （不分列就要依序寫滿 欄×列 格）；- / . / 空格符號 = 這回合還是空格，符號名稱 = 這回合落下並鎖住，
    //   已鎖住的格子寫 - 或同一個符號都可以。
    // 每回合所有空格一起起轉、依 hs.order 錯開停下，鎖住的格子不再動；同一格每回合的轉動接在同一條轉帶上，
    // 速度區段、減速曲線、衝過回彈都和轉輪模式相同（spinMotion），停下的位置分毫不差。
    // 次數：每回合用掉 1 次，有新符號落下就重設成 hs.spins；用完或全滿就結束。
    // 「@秒」從 spin.startTime 算；沒寫就接在上一回合停妥後 hs.roundGap 秒（第 1 回合 = 0）。
    // ------------------------------------------------------------------
    function isEmptyToken(tok, blank) {
        return tok === "-" || tok === "." || (blank !== "" && String(tok).toLowerCase() === String(blank).toLowerCase());
    }

    function splitTokens(s) {
        var parts = /[,\t]/.test(s) ? s.split(/[,\t]/) : U.trim(s).split(/\s+/), out = [];
        for (var i = 0; i < parts.length; i++) { if (U.trim(parts[i]) !== "") { out.push(U.trim(parts[i])); } }
        return out;
    }

    // 一回合（或起始盤面）的文字 -> { board: [欄][列]（"" = 空格）, errors }
    HS.parseBoard = function (text, cols, rows, names, blank) {
        var errors = [], board = B.create(cols, rows, ""), parts = String(text || "").split(/[\/|\r\n]+/), rowTokens = [], cells = [], i, c, r;
        for (i = 0; i < parts.length; i++) {
            if (U.trim(parts[i]) !== "") { rowTokens.push(splitTokens(parts[i])); }
        }
        if (rowTokens.length === 1 && rows > 1) {
            cells = rowTokens[0];
            if (cells.length !== cols * rows) {
                errors.push(T("要有 {0} 格（{1} 欄 × {2} 列，由上到下逐列），目前有 {3} 格", cols * rows, cols, rows, cells.length));
                return { board: board, errors: errors };
            }
        } else {
            if (rowTokens.length !== rows) {
                errors.push(T("要有 {0} 列（列之間用 / 分隔），目前有 {1} 列", rows, rowTokens.length));
                return { board: board, errors: errors };
            }
            for (r = 0; r < rows; r++) {
                if (rowTokens[r].length !== cols) { errors.push(T("第 {0} 列要有 {1} 格，目前有 {2} 格", r + 1, cols, rowTokens[r].length)); }
                cells = cells.concat(rowTokens[r]);
            }
            if (errors.length) { return { board: board, errors: errors }; }
        }
        for (i = 0; i < cells.length; i++) {
            c = i % cols;
            r = Math.floor(i / cols);
            if (isEmptyToken(cells[i], blank)) { continue; }
            var m = B.matchName(cells[i], names);
            if (m === null) { errors.push(T("第 {0} 列第 {1} 欄：找不到符號「{2}」", r + 1, c + 1, cells[i])); } else { board[c][r] = m; }
        }
        return { board: board, errors: errors };
    };

    // [欄][列] -> "- 200 - / 800 - -"（"" = -）
    HS.boardText = function (board, rows) {
        var out = [], comma = false, r, c;
        for (c = 0; c < board.length; c++) {
            for (r = 0; r < rows; r++) { if (/\s/.test(board[c][r] || "")) { comma = true; } }
        }
        for (r = 0; r < rows; r++) {
            var cells = [];
            for (c = 0; c < board.length; c++) { cells.push(board[c][r] || "-"); }
            out.push(cells.join(comma ? ", " : " "));
        }
        return out.join(" / ");
    };

    // hs.rounds -> { rounds: [{ at: 秒 | null, board }], errors }
    HS.parseRounds = function (cfg) {
        var L = cfg.layout, names = S.symbolNames(cfg), lines = String(cfg.hs.rounds || "").split(/\r\n|\r|\n|;/);
        var out = [], errors = [];
        for (var i = 0; i < lines.length; i++) {
            var line = U.trim(lines[i]), at = null, n = out.length + 1;
            if (line === "" || line.charAt(0) === "#") { continue; }
            if (line.charAt(0) === "@") {
                var m = /^@\s*(\d*\.?\d+)\s*(.*)$/.exec(line);
                if (m) {
                    at = parseFloat(m[1]);
                    line = m[2];
                } else {
                    errors.push(T("第 {0} 回合：時間格式是「@秒」，例如 @3.5", n));
                    line = line.replace(/^@\S*\s*/, "");
                }
            }
            var res = HS.parseBoard(line, L.reels, L.rows, names, cfg.hs.blank);
            for (var k = 0; k < res.errors.length; k++) { errors.push(T("第 {0} 回合：{1}", n, res.errors[k])); }
            out.push({ at: at, board: res.board });
        }
        return { rounds: out, errors: errors };
    };

    HS.roundsText = function (rounds, rows) {
        var out = [];
        for (var i = 0; i < rounds.length; i++) {
            out.push((rounds[i].at !== null && rounds[i].at !== undefined ? "@" + r3(rounds[i].at) + " " : "") + HS.boardText(rounds[i].board, rows));
        }
        return out.join("\n");
    };

    // 停格順序：[[欄, 列], ...]；col = 一欄一欄（上到下、左到右），row = 一列一列（左到右、上到下）
    HS.cellOrder = function (cols, rows, order) {
        var out = [], c, r;
        if (order === "row") {
            for (r = 0; r < rows; r++) { for (c = 0; c < cols; c++) { out.push([c, r]); } }
        } else {
            for (c = 0; c < cols; c++) { for (r = 0; r < rows; r++) { out.push([c, r]); } }
        }
        return out;
    };

    // 依回合推演：每回合哪些格子轉（依停格順序）、落下什麼、剩幾次、什麼時候結束
    // 回傳 { rounds: [{ index, at, spin: [[欄, 列, 落下的符號 | ""]...], locks: 鎖住幾格, spinsLeft（起轉後）, spinsAfter（回合結束）,
    //        full, end: "" | "full"（全滿）| "out"（次數用完）}], board: [欄][列]（"" = 空格）, finalBoard（空格填空格符號）, ended, errors, warnings }
    HS.simulate = function (cfg) {
        var L = cfg.layout, H = cfg.hs, cols = L.reels, rows = L.rows, i, k, c, r;
        var parsed = HS.parseRounds(cfg), errors = parsed.errors.slice(), warnings = [];
        var cur = B.create(cols, rows, ""), order = HS.cellOrder(cols, rows, H.order), filled = 0;
        for (c = 0; c < cols; c++) {
            for (r = 0; r < rows; r++) {
                var v = cfg.startBoard[c] ? cfg.startBoard[c][r] : "";
                if (v && !isEmptyToken(v, H.blank)) { cur[c][r] = v; filled++; }
            }
        }
        if (filled === cols * rows) { errors.push(T("起始盤面已經沒有空格（空格請放空格符號「{0}」）", H.blank)); }
        if (!parsed.rounds.length) { errors.push(T("還沒有設定回合（hs.rounds，每行一回合）")); }
        var left = H.startSpins, ended = "", out = [];
        for (k = 0; k < parsed.rounds.length && !errors.length; k++) {
            if (ended) {
                errors.push(T("第 {0} 回合：Hold & Spin 在第 {1} 回合已經結束（{2}），後面不能再有回合", k + 1, k, ended === "full" ? T("全滿") : T("次數用完")));
                break;
            }
            var pr = parsed.rounds[k], rd = { index: k, at: pr.at, spin: [], locks: 0 };
            for (i = 0; i < order.length; i++) {
                c = order[i][0];
                r = order[i][1];
                var want = pr.board[c][r];
                if (cur[c][r]) {
                    if (want && want !== cur[c][r]) {
                        errors.push(T("第 {0} 回合：第 {1} 列第 {2} 欄已經鎖住「{3}」，不能換成「{4}」", k + 1, r + 1, c + 1, cur[c][r], want));
                    }
                    continue;
                }
                rd.spin.push([c, r, want]);
            }
            for (i = 0; i < rd.spin.length; i++) {
                if (rd.spin[i][2]) { cur[rd.spin[i][0]][rd.spin[i][1]] = rd.spin[i][2]; filled++; rd.locks++; }
            }
            left -= 1;
            rd.spinsLeft = left;
            if (rd.locks) { left = H.spins; }
            rd.spinsAfter = left;
            rd.full = filled === cols * rows;
            ended = rd.full ? "full" : (left <= 0 ? "out" : "");
            rd.end = ended;
            out.push(rd);
        }
        if (!errors.length && !ended && out.length) {
            warnings.push(T("最後一回合（第 {0} 回合）後還剩 {1} 次、盤面也沒滿：演出停在這裡", out.length, left));
        }
        var fin = B.create(cols, rows, H.blank);
        for (c = 0; c < cols; c++) {
            for (r = 0; r < rows; r++) { if (cur[c][r]) { fin[c][r] = cur[c][r]; } }
        }
        return { rounds: out, board: cur, finalBoard: fin, ended: ended, errors: errors, warnings: warnings };
    };

    // 推演並把最後盤面寫進 endBoard（給 show / 讀回設定用）
    HS.apply = function (cfg) {
        var sim = HS.simulate(cfg);
        if (!sim.errors.length) { cfg.endBoard = sim.finalBoard; }
        return sim;
    };

    HS.validate = function (cfg, names) {
        var e = [], L = cfg.layout, P = cfg.spin, H = cfg.hs;
        var bw = L.reels * L.cellW + (L.reels - 1) * L.gapX + 2 * L.margin;
        var bh = L.rows * L.cellH + (L.rows - 1) * L.gapY + 2 * L.margin;
        if (bw > 30000 || bh > 30000) { e.push(T("盤面尺寸超過 AE 上限 30000px")); }
        if (!H.blank) { e.push(T("請設定空格符號（hs.blank），例如空格圖案的符號名稱")); }
        else if (names.length && U.indexOf(names, H.blank) < 0) { e.push(T("空格符號「{0}」不在符號庫裡", H.blank)); }
        if (H.spins < 1 || H.startSpins < 1) { e.push(T("次數（hs.spins / hs.startSpins）至少要 1")); }
        if (!(H.speed > 0)) { e.push(T("轉速（hs.speed）必須大於 0")); }
        if (!(H.firstStop > 0)) { e.push(T("第一格停下時間（hs.firstStop）必須大於 0")); }
        if (H.stagger < 0 || H.roundGap < 0 || H.antCells < 0) { e.push(T("停格間隔 / 回合間停頓 / 期待格數不能是負數")); }
        if (P.decelTime < 0 || P.overshoot < 0 || P.bounceTime < 0 || P.antTime < 0 || P.antDecelTime < 0 || P.antSpeed < 0) {
            e.push(T("減速 / 衝過 / 回彈 / 期待參數不能是負數"));
        }
        if (names.length) {
            var be = B.validate(cfg.startBoard, L.reels, L.rows, names, T("起始盤面"));
            e = e.concat(be);
            if (!e.length) { e = e.concat(HS.simulate(cfg).errors); }
        }
        return e;
    };

    // 格子中心（盤面合成座標）
    HS.cellCenter = function (L, c, r) {
        return [L.margin + c * (L.cellW + L.gapX) + L.cellW / 2, L.margin + r * (L.cellH + L.gapY) + L.cellH / 2];
    };

    // 每格的轉動計畫。plan.cells[i]：{ index, row, col, tag: "列-欄", x, y, strip, startIndex, startY, keys,
    //   spins: [{ round, start, stop, settle, decelStart, result, lock, ant, fill, speed, endY }], lockRound（0 = 一開始就鎖住、-1 = 沒鎖）}
    // plan.rounds[k]：{ index, start, firstStop, settle, cells: [轉的格子], locks: [鎖住的格子], spinsLeft, spinsAfter, full, end, ant }
    HS.computePlan = function (cfg, fps, opts) {
        opts = opts || {};
        var L = cfg.layout, P = cfg.spin, H = cfg.hs, F = cfg.frame, i, k, s;
        var errors = [], warnings = [];
        if (!(fps > 0)) { return { errors: [T("影格速率錯誤")], warnings: [] }; }
        var E = motionEnv(cfg, fps), snap = E.snap, EPS = E.EPS, frame = E.frame;
        var cols = L.reels, rows = L.rows, pitch = E.pitch, windup = E.windup;
        var dir = P.direction === "up" ? -1 : 1;
        var T0 = snap(P.startTime - (opts.timeOffset || 0));
        var gridW = cols * L.cellW + (cols - 1) * L.gapX, gridH = rows * L.cellH + (rows - 1) * L.gapY;
        var sim = HS.simulate(cfg);
        var plan = {
            mode: "holdspin", fps: fps, pitch: pitch, cellW: L.cellW, cellH: L.cellH, reelW: L.cellW, reelH: L.cellH,
            margin: L.margin, reelsW: gridW, boardW: gridW + 2 * L.margin, boardH: gridH + 2 * L.margin, direction: dir,
            startTime: T0, reels: [], cells: [], rounds: [], frames: [], lines: [], pulses: [],
            markers: [{ t: T0, label: "HS START" }], allSettled: T0, endTime: T0,
            board: sim.board, finalBoard: sim.finalBoard, ended: sim.ended, errors: errors, warnings: warnings
        };
        for (i = 0; i < sim.errors.length; i++) { errors.push(sim.errors[i]); }
        if (errors.length) { return plan; }
        for (i = 0; i < sim.warnings.length; i++) { warnings.push(sim.warnings[i]); }
        if (cfg.lines.length) { warnings.push(T("Hold & Spin 模式不畫連線，已略過 {0} 條連線", cfg.lines.length)); }

        var cells = [], c, r;
        for (r = 0; r < rows; r++) {
            for (c = 0; c < cols; c++) {
                var ctr = HS.cellCenter(L, c, r), st = cfg.startBoard[c][r];
                cells.push({ index: cells.length, row: r, col: c, tag: (r + 1) + "-" + (c + 1), x: ctr[0], y: ctr[1], start: st,
                    spins: [], lockRound: isEmptyToken(st, H.blank) ? -1 : 0, lockTime: -1, busyUntil: -1e9 });
            }
        }

        var ant = Math.max(0, H.antCells), prevSettle = T0;
        for (k = 0; k < sim.rounds.length; k++) {
            var sr = sim.rounds[k], n = k + 1;
            var tR = snap(T0 + (sr.at !== null ? sr.at : (k ? prevSettle - T0 + H.roundGap : 0)));
            var rd = { index: k, start: tR, firstStop: -1, settle: tR, cells: [], locks: [], spinsLeft: sr.spinsLeft,
                spinsAfter: sr.spinsAfter, full: sr.full, end: sr.end, ant: ant > 0 && sr.spin.length <= ant };
            plan.markers.push({ t: tR, label: "HS ROUND " + n });
            plan.markers.push({ t: tR, label: "HS SPINS " + sr.spinsLeft });
            var extra = 0, prevStop = -1, reset = false;
            for (i = 0; i < sr.spin.length; i++) {
                var cell = cells[sr.spin[i][1] * cols + sr.spin[i][0]], res = sr.spin[i][2];
                if (rd.ant) { extra += P.antTime; }
                var tStop = snap(tR + H.firstStop + (H.order === "all" ? 0 : i * H.stagger) + extra);
                if (tR < cell.busyUntil + frame - EPS) {
                    errors.push(T("第 {0} 回合開始得太早：格子 {1}（列-欄）在 {2} 秒才停妥", n, cell.tag, Math.round((cell.busyUntil - T0) * 100) / 100));
                    continue;
                }
                var fs = rd.ant ? (prevStop >= 0 ? prevStop : snap(tR + P.windupTime + P.accelTime)) : -1;
                var mo = spinMotion(E, {
                    tS: tR, tStop: tStop, speed: H.speed, decelTime: rd.ant ? P.antDecelTime : P.decelTime,
                    decelCurve: rd.ant ? P.antCurve : P.decelCurve, overshoot: P.overshoot, bounceTime: P.bounceTime,
                    frameStart: rd.ant && P.antSpeed > 0 ? fs : -1, frameSpeed: P.antSpeed
                });
                if (mo.tooShort) {
                    errors.push(T("第 {0} 回合格子 {1} 停得太早：從起轉到停下至少要 {2} 秒（拉回+加速+減速）", n, cell.tag, mo.tooShort));
                    continue;
                }
                if (mo.rampIgnored) { warnings.push(T("第 {0} 回合格子 {1}：期待轉速的切換時間不在等速區段內，已忽略", n, cell.tag)); }
                var fit = fitTravel(E, mo, 1, 2);
                cell.spins.push({ round: k, mo: mo, scale: fit.scale, fill: fit.fill, result: res || H.blank, lock: !!res, ant: rd.ant });
                cell.busyUntil = mo.t5;
                rd.cells.push(cell.index);
                if (rd.firstStop < 0 || tStop < rd.firstStop) { rd.firstStop = tStop; }
                if (mo.t5 > rd.settle) { rd.settle = mo.t5; }
                if (res) {
                    rd.locks.push(cell.index);
                    cell.lockRound = n;
                    cell.lockTime = tStop;
                    plan.markers.push({ t: tStop, label: "HS CELL " + cell.tag + " LOCK " + res });
                    if (!reset) { reset = true; plan.markers.push({ t: tStop, label: "HS SPINS " + H.spins }); }
                    if (H.lockPulse > 100) { plan.pulses.push({ cell: cell.index, name: res, t: mo.t5, x: cell.x, y: cell.y }); }
                } else {
                    plan.markers.push({ t: tStop, label: "HS CELL " + cell.tag + " STOP" });
                }
                if (rd.ant && H.antFrame) {
                    if (fs >= tStop - EPS) {
                        errors.push(T("第 {0} 回合格子 {1}：繞框開始時間必須早於停下時間", n, cell.tag));
                    } else {
                        plan.frames.push({ reel: -1, cell: cell.index, name: "Frame C" + cell.tag, start: fs, end: snap(mo.t5 + Math.max(0, F.hold)),
                            x: cell.x, y: cell.y, w: L.cellW + 2 * F.pad, h: L.cellH + 2 * F.pad });
                        plan.markers.push({ t: fs, label: "HS CELL " + cell.tag + " FRAME" });
                    }
                }
                prevStop = tStop;
            }
            if (sr.end === "full") { plan.markers.push({ t: rd.settle, label: "HS FULL" }); }
            else if (sr.end === "out") { plan.markers.push({ t: rd.settle, label: "HS END" }); }
            prevSettle = rd.settle;
            if (rd.settle > plan.allSettled) { plan.allSettled = rd.settle; }
            plan.rounds.push(rd);
        }

        // 轉帶與關鍵影格：同一格每回合的轉動接在同一條轉帶上，回合之間停住不動
        var pool = opts.fillerPool || S.fillerPool(cfg), rng = new S.Rng(P.seed);
        var overshootPx = (P.overshoot > 0 && P.bounceTime > 0) ? P.overshoot * L.cellH : 0;
        var buffer = Math.ceil((Math.max(windup, overshootPx) + L.gapY) / pitch) + 1;
        for (i = 0; i < cells.length; i++) {
            var cl = cells[i], strip = buildCellStrip(cl, buffer, dir, pool, rng);
            var keys = [], y = -strip.startIndex * pitch, spins = [];
            var startY = y;
            for (s = 0; s < cl.spins.length; s++) {
                var sp = cl.spins[s], yEnd = -strip.resultIndex[s] * pitch;
                spinKeys(keys, sp.mo, y, yEnd, dir, sp.scale, windup);
                spins.push({ round: sp.round, start: sp.mo.tS, stop: sp.mo.tStop, settle: sp.mo.t5, decelStart: sp.mo.t3,
                    result: sp.result, lock: sp.lock, ant: sp.ant, fill: sp.fill, speed: sp.scale * Math.max(sp.mo.v1, sp.mo.vLast),
                    stripIndex: strip.resultIndex[s], endY: yEnd });
                y = yEnd;
            }
            plan.cells.push({ index: cl.index, row: cl.row, col: cl.col, tag: cl.tag, x: cl.x, y: cl.y, start: cl.start,
                final: plan.finalBoard[cl.col][cl.row], strip: strip.items, startIndex: strip.startIndex, startY: startY,
                keys: keys, spins: spins, lockRound: cl.lockRound, lockTime: cl.lockTime });
        }

        plan.endTime = plan.allSettled;
        for (i = 0; i < plan.frames.length; i++) { plan.endTime = Math.max(plan.endTime, plan.frames[i].end + Math.max(0, F.fade)); }
        for (i = 0; i < plan.pulses.length; i++) { plan.endTime = Math.max(plan.endTime, plan.pulses[i].t + HS.PULSE_UP + HS.PULSE_DOWN); }
        if (!errors.length) { plan.markers.push({ t: plan.allSettled, label: "ALL SETTLED" }); }
        plan.markers = mergeMarkers(plan.markers);
        return plan;
    };

    // 鎖住時符號跳動：放大 0.1 秒、縮回 0.22 秒（和中獎符號跳動一樣）
    HS.PULSE_UP = 0.1;
    HS.PULSE_DOWN = 0.22;

    // 一格的轉帶：時間順序是 [起始][填充][第 1 次停下][填充][第 2 次停下]…；向下轉時由上到下反過來排（null 往下移看到上面的格子）
    function buildCellStrip(cell, buffer, dir, pool, rng) {
        var seq = [{ name: cell.start, kind: "start", n: 1 }], resultAt = [], last = cell.start, fillN = 0, i, k;
        function pick(avoid) {
            var name = rng.pick(pool), guard = 0;
            while (pool.length > 1 && (name === last || name === avoid) && guard++ < 16) { name = rng.pick(pool); }
            last = name;
            return name;
        }
        for (k = 0; k < cell.spins.length; k++) {
            var sp = cell.spins[k];
            for (i = 0; i < sp.fill; i++) { seq.push({ name: pick(i === sp.fill - 1 ? sp.result : null), kind: "fill", n: ++fillN }); }
            resultAt.push(seq.length);
            seq.push({ name: sp.result, kind: "round", n: sp.round + 1, lock: sp.lock });
            last = sp.result;
        }
        // 兩端的緩衝（拉回、衝過頭時會露出來）：第一個是緊鄰的那格
        function bufferRun(from) {
            var out = [];
            last = from;
            for (var b = 0; b < buffer; b++) { out.push({ name: pick(null), kind: "buffer", n: 0 }); }
            return out;
        }
        var nearStart = bufferRun(cell.start), nearEnd = bufferRun(seq[seq.length - 1].name);
        var top = dir > 0 ? nearEnd.reverse() : nearStart.reverse();
        var items = top.concat(dir > 0 ? seq.slice().reverse() : seq, dir > 0 ? nearStart : nearEnd);
        var bufN = 0;
        for (i = 0; i < items.length; i++) { if (items[i].kind === "buffer") { items[i].n = ++bufN; } }
        function indexOf(j) { return top.length + (dir > 0 ? seq.length - 1 - j : j); }
        var resultIndex = [];
        for (k = 0; k < resultAt.length; k++) { resultIndex.push(indexOf(resultAt[k])); }
        return { items: items, startIndex: indexOf(0), resultIndex: resultIndex };
    }

    // 檢查畫面：開始、每回合轉動中與停妥；offset = 盤面圖層的起點
    HS.shots = function (plan, offset) {
        offset = offset || 0;
        var shots = [], out = [], i;
        if (!plan.rounds.length || plan.rounds[0].firstStop < 0 || plan.rounds[0].start > plan.startTime + 1e-6) {
            shots.push({ t: plan.startTime, label: "HS START" });
        }
        for (i = 0; i < plan.rounds.length; i++) {
            var rd = plan.rounds[i], n = i + 1;
            if (rd.firstStop > rd.start) { shots.push({ t: (rd.start + rd.firstStop) / 2, label: "ROUND " + n + " SPINNING" }); }
            shots.push({ t: rd.settle, label: "ROUND " + n + " SETTLED" + (rd.full ? " / FULL" : (rd.end === "out" ? " / END" : "")) });
        }
        shots.sort(function (a, b) { return a.t - b.t; });
        for (i = 0; i < shots.length; i++) {
            var lastShot = out[out.length - 1];
            if (lastShot && Math.abs(lastShot.t - shots[i].t - offset) < 1e-6) { lastShot.label += " / " + shots[i].label; }
            else { out.push({ t: shots[i].t + offset, label: shots[i].label }); }
        }
        return out;
    };
})(SFS);

if (typeof module !== "undefined" && module.exports) { module.exports = SFS; }
