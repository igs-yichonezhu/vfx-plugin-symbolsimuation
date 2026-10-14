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
    // 預設設定
    // ------------------------------------------------------------------
    S.defaultConfig = function () {
        return {
            version: 1,
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
                scaleMode: "fit",  // fit = 縮放到符合格子；none = 原尺寸
                symbolScale: 100,  // 額外縮放 %
                target: "active",  // active = 目前合成；new = 新建合成
                newCompFps: 30
            },
            spin: {
                startTime: 0,      // 開始轉動時間（秒，目標合成時間）
                firstStop: 1.0,    // 從開始到第 1 輪停下（秒）
                stagger: 0.25,     // 每輪停止間隔（秒）
                delays: "",        // 各輪額外延遲（期待感），逗號分隔，會往後累加
                speed: 18,         // 轉速（格/秒）
                windupDist: 0.25,  // 起轉前反向拉回距離（格）
                windupTime: 0.15,  // 拉回時間（秒）
                accelTime: 0.15,   // 加速時間（秒）
                decelTime: 0.08,   // 停輪減速時間（秒）
                overshoot: 0.15,   // 停輪衝過頭距離（格）
                bounceTime: 0.2,   // 回彈時間（秒）
                direction: "down", // down / up
                seed: 1,
                motionBlur: true,
                shutterAngle: 180
            },
            // 盤面 [輪][列]，列 0 = 最上方
            startBoard: [],
            endBoard: []
        };
    };

    // 把讀入的設定補齊缺少欄位（舊版設定檔 / 手改的 JSON）
    S.normalizeConfig = function (cfg) {
        var def = S.defaultConfig();
        var out = U.clone(def), k, group;
        if (!cfg || typeof cfg !== "object") { return out; }
        if (U.isArray(cfg.symbols)) {
            out.symbols = [];
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
        var groups = ["layout", "spin"];
        for (var g = 0; g < groups.length; g++) {
            group = groups[g];
            if (!cfg[group]) { continue; }
            for (k in def[group]) {
                if (def[group].hasOwnProperty(k) && cfg[group].hasOwnProperty(k)) {
                    var dv = def[group][k], v = cfg[group][k];
                    if (typeof dv === "number") { out[group][k] = U.toNumber(v, dv); }
                    else if (typeof dv === "boolean") { out[group][k] = !!v; }
                    else { out[group][k] = String(v); }
                }
            }
        }
        var L = out.layout;
        L.reels = Math.round(U.clamp(L.reels, 1, 20));
        L.rows = Math.round(U.clamp(L.rows, 1, 20));
        // AE 合成尺寸必須是整數
        var ints = ["cellW", "cellH", "gapX", "gapY", "peek"];
        for (k = 0; k < ints.length; k++) { L[ints[k]] = Math.round(L[ints[k]]); }
        out.startBoard = S.board.resize(U.isArray(cfg.startBoard) ? cfg.startBoard : [], L.reels, L.rows, "");
        out.endBoard = S.board.resize(U.isArray(cfg.endBoard) ? cfg.endBoard : [], L.reels, L.rows, "");
        return out;
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
    // 設定驗證
    // ------------------------------------------------------------------
    S.parseDelays = function (text, reels) {
        var out = [], parts = U.trim(text || "") === "" ? [] : U.trim(text).split(/[\s,]+/);
        for (var i = 0; i < reels; i++) {
            out.push(i < parts.length ? Math.max(0, U.toNumber(parts[i], 0)) : 0);
        }
        return out;
    };

    S.validateConfig = function (cfg) {
        var e = [], L = cfg.layout, P = cfg.spin;
        var names = S.symbolNames(cfg);
        if (!names.length) { e.push("符號庫是空的：請先匯入符號圖檔"); }
        if (L.cellW < 4 || L.cellH < 4) { e.push("格子寬高至少要 4px"); }
        if (L.gapX < 0 || L.gapY < 0 || L.peek < 0) { e.push("間距 / 露出不能是負數"); }
        if (L.symbolScale <= 0) { e.push("符號縮放必須大於 0"); }
        if (P.speed <= 0) { e.push("轉速必須大於 0"); }
        if (P.firstStop <= 0) { e.push("第一輪停止時間必須大於 0"); }
        if (P.stagger < 0) { e.push("每輪間隔不能是負數"); }
        if (P.startTime < 0) { e.push("開始時間不能是負數"); }
        var nonNeg = ["windupDist", "windupTime", "accelTime", "decelTime", "overshoot", "bounceTime"];
        for (var i = 0; i < nonNeg.length; i++) {
            if (P[nonNeg[i]] < 0) { e.push("動態參數不能是負數：" + nonNeg[i]); }
        }
        if (P.direction !== "down" && P.direction !== "up") { e.push("方向必須是 down 或 up"); }
        var bw = L.reels * L.cellW + (L.reels - 1) * L.gapX;
        var bh = S.reelHeight(L);
        if (bw > 30000 || bh > 30000) { e.push("盤面尺寸超過 AE 上限 30000px"); }
        if (names.length) {
            e = e.concat(B.validate(cfg.startBoard, L.reels, L.rows, names, "起始盤面"));
            e = e.concat(B.validate(cfg.endBoard, L.reels, L.rows, names, "結果盤面"));
        }
        return e;
    };

    S.reelHeight = function (L) {
        return L.rows * (L.cellH + L.gapY) - L.gapY + 2 * L.peek;
    };

    // ------------------------------------------------------------------
    // 轉輪動態計算
    //
    // 每一輪是一條長長的「轉帶」（strip），由一顆 null 帶著上下移動。
    // 向下轉時，轉帶由上到下為：
    //   [緩衝 b 格][結果盤面 rows 格][填充 N 格][起始盤面 rows 格][緩衝 b 格]
    // 一開始畫面看到「起始盤面」，轉帶往下移 (rows+N) 格後看到「結果盤面」。
    // 向上轉則把順序反過來。
    //
    // null 的 Y Position 關鍵影格（時間都會對齊影格）：
    //   K0 開始  -> K1 反向拉回(windup) -> K2 加速完成(等速 v)
    //   -> K3 開始減速 -> K4 停輪(衝過頭最遠點，速度 0) -> K5 回彈到定位
    // 用 Bezier 影響值 33.333% 可以精準做出「等加速度」與「等速」的區段，
    // 所以各段之間速度連續，graph editor 裡也很乾淨好調。
    // ------------------------------------------------------------------
    S.INF_LINEAR = 100 / 3;

    S.computePlan = function (cfg, fps, opts) {
        opts = opts || {};
        var L = cfg.layout, P = cfg.spin;
        var errors = [];
        if (!(fps > 0)) { return { errors: ["影格速率錯誤"] }; }
        var frame = 1 / fps;
        function snap(t) { return Math.round(t * fps) / fps; }
        function atLeast(t, min) { return t < min - 1e-9 ? min : t; }

        var rows = L.rows, reels = L.reels;
        var pitch = L.cellH + L.gapY;
        var reelH = S.reelHeight(L);
        var dir = P.direction === "up" ? -1 : 1;
        var timeOffset = opts.timeOffset || 0;

        var windup = (P.windupDist > 0 && P.windupTime > 0) ? P.windupDist * L.cellH : 0;
        var overshoot = (P.overshoot > 0 && P.bounceTime > 0) ? P.overshoot * L.cellH : 0;
        var buffer = Math.ceil((L.peek + Math.max(windup, overshoot) + L.gapY) / pitch) + 1;
        var vTarget = P.speed * pitch;
        var minFill = Math.max(rows, 2);
        var delays = S.parseDelays(P.delays, reels);
        var pool = opts.fillerPool || S.fillerPool(cfg);
        var rng = new S.Rng(P.seed);

        var tStart = snap(P.startTime - timeOffset);
        var plan = {
            fps: fps,
            pitch: pitch,
            reelW: L.cellW,
            reelH: reelH,
            boardW: reels * L.cellW + (reels - 1) * L.gapX,
            boardH: reelH,
            buffer: buffer,
            direction: dir,
            startTime: tStart,
            reels: [],
            markers: [{ t: tStart, label: "SPIN" }],
            endTime: tStart,
            errors: errors
        };

        var extra = 0;
        for (var i = 0; i < reels; i++) {
            extra += delays[i];
            var tStop = snap(tStart + P.firstStop + i * P.stagger + extra);
            var t1 = windup > 0 ? atLeast(snap(tStart + P.windupTime), tStart + frame) : tStart;
            var t2 = atLeast(snap(t1 + P.accelTime), t1 + frame);
            var t3 = snap(tStop - P.decelTime);
            if (t3 > tStop - frame + 1e-9) { t3 = tStop - frame; }
            var t5 = overshoot > 0 ? atLeast(snap(tStop + P.bounceTime), tStop + frame) : tStop;

            if (t2 > t3 + 1e-9) {
                errors.push("第 " + (i + 1) + " 輪停得太早：停止時間至少要大於 拉回+加速+減速 的時間（約 " +
                    (Math.round((t2 - tStart + (tStop - t3)) * 100) / 100) + " 秒）");
                continue;
            }

            var ta = t2 - t1, tc = t3 - t2, td = tStop - t3;
            var denom = ta / 2 + tc + td / 2;
            var fill = Math.round((vTarget * denom - windup - overshoot) / pitch - rows);
            if (fill < minFill) { fill = minFill; }
            var travel = windup + (rows + fill) * pitch + overshoot;
            var v = travel / denom;

            // 轉帶內容
            var strip = buildStrip(cfg.startBoard[i], cfg.endBoard[i], rows, fill, buffer, dir, pool, rng);
            var startIdx = strip.startIndex, endIdx = strip.endIndex;
            var y0 = L.peek - startIdx * pitch;
            var yEnd = L.peek - endIdx * pitch;

            var keys = [];
            var y1 = y0 - dir * windup;
            if (windup > 0) {
                keys.push(mkKey(tStart, y0, 0, S.INF_LINEAR, 0, 50));
                keys.push(mkKey(t1, y1, 0, 50, 0, S.INF_LINEAR));
            } else {
                keys.push(mkKey(tStart, y0, 0, S.INF_LINEAR, 0, S.INF_LINEAR));
            }
            var y2 = y1 + dir * v * ta / 2;
            var y3 = y2 + dir * v * tc;
            var yPeak = yEnd + dir * overshoot;
            keys.push(mkKey(t2, y2, dir * v, S.INF_LINEAR, dir * v, S.INF_LINEAR));
            if (tc > 1e-9) {
                keys.push(mkKey(t3, y3, dir * v, S.INF_LINEAR, dir * v, S.INF_LINEAR));
            }
            if (overshoot > 0) {
                keys.push(mkKey(tStop, yPeak, 0, S.INF_LINEAR, 0, 40));
                keys.push(mkKey(t5, yEnd, 0, 60, 0, S.INF_LINEAR));
            } else {
                keys.push(mkKey(tStop, yEnd, 0, S.INF_LINEAR, 0, S.INF_LINEAR));
            }

            plan.reels.push({
                index: i,
                x: i * (L.cellW + L.gapX) + L.cellW / 2,
                strip: strip.items,
                startIndex: startIdx,
                endIndex: endIdx,
                fill: fill,
                speed: v,
                startY: y0,
                endY: yEnd,
                stopTime: tStop,
                settleTime: t5,
                keys: keys
            });
            plan.markers.push({ t: tStop, label: "R" + (i + 1) + " STOP" });
            if (t5 > plan.endTime) { plan.endTime = t5; }
        }
        if (plan.reels.length === reels) {
            plan.markers.push({ t: plan.endTime, label: "ALL SETTLED" });
        }
        return plan;
    };

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
