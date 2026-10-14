/*
 * SlotFakeSpin - core.js
 * 純邏輯：設定、盤面、亂數、JSON、轉輪動態計算。
 * 不碰 AE DOM，可在 Node 測試（ExtendScript ES3 相容寫法：不使用 let/const/箭頭函式/Array.forEach 等）。
 */
var SFS = SFS || {};

(function (S) {
    S.VERSION = "1.0.0";
    S.NAME = "SlotFakeSpin";
    S.TAG = "SFS_BOARD";

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
            if (c === "t" && s.substr(i, 4) === "true") { i += 4; return true; }
            if (c === "f" && s.substr(i, 5) === "false") { i += 5; return false; }
            if (c === "n" && s.substr(i, 4) === "null") { i += 4; return null; }
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
                        var hex = s.substr(i, 4);
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

    // ------------------------------------------------------------------
    // 預設設定
    // ------------------------------------------------------------------
    S.defaultConfig = function () {
        var cfg = {
            version: 2,
            // 符號庫：{ name, path, itemId, filler }
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
                newCompFps: 30
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
            // 連線：{ pattern: "2,2,2,2,2"（每輪第幾列，1 起算）, count: 連幾個, shows: "0.3+1.2, 1.6+0.9"（停妥後開始+長度）, color: "" }
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
        return { pattern: "", count: 3, shows: "", color: "" };
    };

    // 依預設值的型別複製欄位，忽略未知欄位
    function copyTyped(def, src) {
        var out = U.clone(def);
        if (!src || typeof src !== "object") { return out; }
        for (var k in def) {
            if (def.hasOwnProperty(k) && src.hasOwnProperty(k) && src[k] !== null && src[k] !== undefined) {
                var dv = def[k], v = src[k];
                if (typeof dv === "number") { out[k] = U.toNumber(v, dv); }
                else if (typeof dv === "boolean") { out[k] = !!v; }
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
                    filler: e.filler !== false
                });
            }
        }
        var groups = ["layout", "spin", "frame", "lineSet", "lineGen", "lineStyle"];
        for (var g = 0; g < groups.length; g++) {
            out[groups[g]] = copyTyped(def[groups[g]], cfg[groups[g]]);
        }
        var L = out.layout, P = out.spin;
        L.reels = Math.round(U.clamp(L.reels, 1, 20));
        L.rows = Math.round(U.clamp(L.rows, 1, 20));
        // AE 合成尺寸必須是整數
        var ints = ["cellW", "cellH", "gapX", "gapY", "peek", "margin"];
        for (k = 0; k < ints.length; k++) { L[ints[k]] = Math.round(L[ints[k]]); }
        P.direction = oneOf(P.direction, ["down", "up"], "down");
        P.decelCurve = oneOf(P.decelCurve, S.CURVE_KEYS, "standard");
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

    S.symbolNames = function (cfg) {
        var out = [];
        for (var i = 0; i < cfg.symbols.length; i++) { out.push(cfg.symbols[i].name); }
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
            errors.push("需要 " + rows + " 行（每行一列），目前有 " + lines.length + " 行");
        }
        for (var y = 0; y < Math.min(rows, lines.length); y++) {
            var line = lines[y];
            var tokens = /[,\t]/.test(line) ? line.split(/[,\t]/) : U.trim(line).split(/\s+/);
            var clean = [];
            for (i = 0; i < tokens.length; i++) {
                if (U.trim(tokens[i]) !== "") { clean.push(U.trim(tokens[i])); }
            }
            if (clean.length !== reels) {
                errors.push("第 " + (y + 1) + " 行需要 " + reels + " 個符號，目前有 " + clean.length + " 個");
            }
            for (var r = 0; r < Math.min(reels, clean.length); r++) {
                var m = B.matchName(clean[r], names);
                if (m === null) {
                    errors.push("第 " + (y + 1) + " 行第 " + (r + 1) + " 個：找不到符號「" + clean[r] + "」");
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
            errors.push(label + "：輪數不符");
            return errors;
        }
        for (var r = 0; r < reels; r++) {
            for (var y = 0; y < rows; y++) {
                var v = board[r] ? board[r][y] : "";
                if (!v) {
                    errors.push(label + "：第 " + (r + 1) + " 輪第 " + (y + 1) + " 列是空的");
                } else if (U.indexOf(names, v) < 0) {
                    errors.push(label + "：第 " + (r + 1) + " 輪第 " + (y + 1) + " 列的符號「" + v + "」不在符號庫裡");
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
    LN.parsePattern = function (text, reels, rows) {
        var nums = S.parseNumbers(text);
        if (nums.length !== reels) { return null; }
        var out = [];
        for (var i = 0; i < nums.length; i++) {
            var v = Math.round(nums[i]);
            if (v !== nums[i] || v < 1 || v > rows) { return null; }
            out.push(v - 1);
        }
        return out;
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
                errors.push("線型表第 " + (i + 1) + " 行要有 " + L.reels + " 個 1~" + L.rows + " 的數字：" + rawLines[i]);
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
    // 設定驗證
    // ------------------------------------------------------------------
    S.validateConfig = function (cfg) {
        var e = [], L = cfg.layout, P = cfg.spin, i;
        var names = S.symbolNames(cfg);
        if (!names.length) { e.push("符號庫是空的：請先匯入符號圖檔"); }
        if (L.cellW < 4 || L.cellH < 4) { e.push("格子寬高至少要 4px"); }
        if (L.gapX < 0 || L.gapY < 0 || L.peek < 0 || L.margin < 0) { e.push("間距 / 露出 / 留白不能是負數"); }
        if (L.symbolScale <= 0) { e.push("符號縮放必須大於 0"); }
        if (P.startTime < 0) { e.push("開始時間不能是負數"); }
        var nonNeg = ["windupDist", "windupTime", "accelTime", "speedRamp"];
        for (i = 0; i < nonNeg.length; i++) {
            if (P[nonNeg[i]] < 0) { e.push("手感參數不能是負數：" + nonNeg[i]); }
        }
        var bw = L.reels * L.cellW + (L.reels - 1) * L.gapX + 2 * L.margin;
        var bh = S.reelHeight(L) + 2 * L.margin;
        if (bw > 30000 || bh > 30000) { e.push("盤面尺寸超過 AE 上限 30000px"); }
        if (!U.isArray(cfg.reels) || cfg.reels.length !== L.reels) {
            e.push("各輪節奏表與輪數不符，請按「套用節奏」");
        } else {
            for (i = 0; i < cfg.reels.length; i++) {
                var R = cfg.reels[i], tag = "第 " + (i + 1) + " 輪：";
                if (R.speed <= 0) { e.push(tag + "轉速必須大於 0"); }
                if (R.start < 0) { e.push(tag + "起轉時間不能是負數"); }
                if (R.stop <= R.start) { e.push(tag + "停輪時間必須晚於起轉時間"); }
                if (R.decelTime < 0 || R.overshoot < 0 || R.bounceTime < 0) { e.push(tag + "減速 / 衝過 / 回彈不能是負數"); }
                if (R.frame && R.frameStart >= R.stop) { e.push(tag + "繞框開始時間必須早於停輪時間"); }
                if (R.frame && R.frameSpeed < 0) { e.push(tag + "繞框轉速不能是負數"); }
            }
        }
        for (i = 0; i < cfg.lines.length; i++) {
            var ln = cfg.lines[i], lt = "連線 " + (i + 1) + "：";
            if (!LN.parsePattern(ln.pattern, L.reels, L.rows)) {
                e.push(lt + "線型要有 " + L.reels + " 個 1~" + L.rows + " 的數字（每輪第幾列），目前是「" + ln.pattern + "」");
            }
            if (ln.count < 1 || ln.count > L.reels) { e.push(lt + "連線數要在 1~" + L.reels + " 之間"); }
            var shows = LN.parseShows(ln.shows);
            if (!shows) { e.push(lt + "顯示時間格式是「開始+長度」，例如 0.3+1.2, 1.6+0.9"); }
            else if (!shows.length) { e.push(lt + "沒有設定顯示時間"); }
        }
        if (names.length) {
            e = e.concat(B.validate(cfg.startBoard, L.reels, L.rows, names, "起始盤面"));
            e = e.concat(B.validate(cfg.endBoard, L.reels, L.rows, names, "結果盤面"));
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
        opts = opts || {};
        var L = cfg.layout, P = cfg.spin, F = cfg.frame;
        var errors = [], warnings = [];
        if (!(fps > 0)) { return { errors: ["影格速率錯誤"], warnings: [] }; }
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

        for (var i = 0; i < reels; i++) {
            var R = reelCfg[i], tag = "第 " + (i + 1) + " 輪";
            var overshoot = (R.overshoot > 0 && R.bounceTime > 0) ? R.overshoot * L.cellH : 0;
            var buffer = Math.ceil((L.peek + Math.max(windup, overshoot) + L.gapY) / pitch) + 1;
            var tS = snap(T0 + R.start);
            var tStop = snap(T0 + R.stop);
            var t1 = windup > 0 ? atLeast(snap(tS + P.windupTime), tS + frame) : tS;
            var t2 = atLeast(snap(t1 + P.accelTime), t1 + frame);
            var t3 = snap(tStop - R.decelTime);
            if (t3 > tStop - frame + EPS) { t3 = tStop - frame; }
            var t5 = overshoot > 0 ? atLeast(snap(tStop + R.bounceTime), tStop + frame) : tStop;
            if (t2 > t3 + EPS) {
                errors.push(tag + "停得太早：從起轉到停輪至少要 " +
                    (Math.round((t2 - tS + (tStop - t3)) * 100) / 100) + " 秒（拉回+加速+減速）");
                continue;
            }

            // 速度區段（名目速度，稍後等比例縮放）
            var v1 = Math.max(0.01, R.speed) * pitch, vLast = v1;
            var segs = [{ a: t1, b: t2, va: 0, vb: v1, d: v1 * (t2 - t1) / 2 }];
            var tA = -1, tB = -1;
            if (R.frame && R.frameSpeed > 0) {
                tA = snap(T0 + R.frameStart);
                tB = atLeast(snap(tA + P.speedRamp), tA + frame);
            }
            if (tA >= 0 && tA >= t2 - EPS && tB <= t3 + EPS) {
                var v2 = R.frameSpeed * pitch;
                if (tA - t2 > EPS) { segs.push({ a: t2, b: tA, va: v1, vb: v1, d: v1 * (tA - t2) }); }
                segs.push({ a: tA, b: tB, va: v1, vb: v2, d: (v1 + v2) / 2 * (tB - tA) });
                if (t3 - tB > EPS) { segs.push({ a: tB, b: t3, va: v2, vb: v2, d: v2 * (t3 - tB) }); }
                vLast = v2;
            } else {
                if (tA >= 0) { warnings.push(tag + "：繞框轉速的切換時間不在等速區段內，已忽略"); }
                if (t3 - t2 > EPS) { segs.push({ a: t2, b: t3, va: v1, vb: v1, d: v1 * (t3 - t2) }); }
            }
            var curve = S.CURVES[R.decelCurve] || S.CURVES.standard;
            segs.push({ a: t3, b: tStop, va: vLast, vb: 0, d: curve.k * vLast * (tStop - t3), infA: curve.i1 * 100, infB: curve.i2 * 100 });

            var nominal = 0, s;
            for (s = 0; s < segs.length; s++) { nominal += segs[s].d; }
            var fill = Math.round((nominal - windup - overshoot) / pitch - rows);
            if (fill < minFill) { fill = minFill; }
            var travel = windup + (rows + fill) * pitch + overshoot;
            var scale = travel / nominal;

            // 轉帶內容
            var strip = buildStrip(cfg.startBoard[i], cfg.endBoard[i], rows, fill, buffer, dir, pool, rng);
            var y0 = L.peek - strip.startIndex * pitch;
            var yEnd = L.peek - strip.endIndex * pitch;

            var keys = [], y = y0;
            if (windup > 0) {
                keys.push(mkKey(tS, y0, 0, S.INF_LINEAR, 0, 50));
                y = y0 - dir * windup;
                keys.push(mkKey(t1, y, 0, 50, 0, S.INF_LINEAR));
            } else {
                keys.push(mkKey(tS, y0, 0, S.INF_LINEAR, 0, S.INF_LINEAR));
            }
            for (s = 0; s < segs.length; s++) {
                var sg = segs[s], last = keys[keys.length - 1];
                last.outSpeed = dir * scale * sg.va;
                last.outInf = sg.infA || S.INF_LINEAR;
                y += dir * scale * sg.d;
                keys.push(mkKey(sg.b, y, dir * scale * sg.vb, sg.infB || S.INF_LINEAR, dir * scale * sg.vb, S.INF_LINEAR));
            }
            var stopKey = keys[keys.length - 1];
            stopKey.y = yEnd + dir * overshoot; // 消除浮點誤差
            if (overshoot > 0) {
                stopKey.outSpeed = 0;
                stopKey.outInf = 40;
                keys.push(mkKey(t5, yEnd, 0, 60, 0, S.INF_LINEAR));
            }

            var rp = {
                index: i,
                x: S.reelCenterX(L, i),
                strip: strip.items,
                startIndex: strip.startIndex,
                endIndex: strip.endIndex,
                fill: fill,
                speed: scale * Math.max(v1, vLast),
                speeds: [scale * v1, scale * vLast],
                startY: y0,
                endY: yEnd,
                spinStart: tS,
                accelEnd: t2,
                decelStart: t3,
                stopTime: tStop,
                settleTime: t5,
                keys: keys
            };
            plan.reels.push(rp);
            plan.markers.push({ t: tStop, label: "R" + (i + 1) + " STOP" });
            if (t5 > plan.allSettled) { plan.allSettled = t5; }

            if (R.frame) {
                var fs = snap(T0 + R.frameStart);
                if (fs >= tStop - EPS) {
                    errors.push(tag + "繞框開始時間必須早於停輪時間");
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
            var pat = LN.parsePattern(ln.pattern, reels, rows);
            var shows = LN.parseShows(ln.shows);
            if (!pat || !shows || !shows.length) {
                errors.push("連線 " + (i + 1) + " 設定錯誤");
                continue;
            }
            var count = Math.round(U.clamp(ln.count, 1, reels));
            var cells = [], points = [], r;
            for (r = 0; r < reels; r++) {
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
            plan.lines.push({ index: i, cells: cells, points: points, shows: abs, color: S.lineColor(ln, i), pattern: pat });
        }
        if (plan.reels.length === reels) {
            plan.markers.push({ t: plan.allSettled, label: "ALL SETTLED" });
        }
        plan.markers = mergeMarkers(plan.markers);
        return plan;
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

    S.layerNameFor = function (reelIndex, item) {
        var prefix = { start: "S", end: "E", fill: "F", buffer: "B" }[item.kind] || "X";
        return "R" + (reelIndex + 1) + "_" + prefix + U.pad(item.n, 2) + "_" + item.name;
    };
})(SFS);

if (typeof module !== "undefined" && module.exports) { module.exports = SFS; }
