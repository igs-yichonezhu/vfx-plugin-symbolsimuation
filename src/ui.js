/*
 * SlotFakeSpin - ui.js
 * ScriptUI 面板（可停駐）：符號 / 盤面 / 節奏 / 各輪 / 繞框 / 連線 / 設定，以及建立、更新、讀取、存檔。
 */
(function (S) {
    var U = S.util, A = S.ae, LN = S.lines;
    var UI = S.ui = {};
    var SEC = "SlotFakeSpin", KEY_CFG = "lastConfig_v2", KEY_THUMB = "thumbs";
    var IS_MAC = (typeof $ !== "undefined" && $.os && $.os.indexOf("Mac") >= 0);
    var THUMB_RE = /\.(png|jpe?g)$/i;

    function getSetting(key) {
        try {
            if (app.settings.haveSetting(SEC, key)) { return app.settings.getSetting(SEC, key); }
        } catch (e) { /* ignore */ }
        return null;
    }

    function setSetting(key, val) {
        try { app.settings.saveSetting(SEC, key, val); } catch (e) { /* ignore */ }
    }

    UI.loadLast = function () {
        var txt = getSetting(KEY_CFG);
        if (!txt) { return null; }
        try { return S.normalizeConfig(S.json.parse(txt)); } catch (e) { return null; }
    };

    function canWriteFiles() {
        try {
            return app.preferences.getPrefAsLong("Main Pref Section", "Pref_SCRIPTING_FILE_NETWORK_SECURITY") === 1;
        } catch (e) { return true; }
    }

    function jsonFilter() {
        if (IS_MAC) {
            return function (f) { return (f instanceof Folder) || /\.json$/i.test(f.name); };
        }
        return "JSON:*.json,All files:*.*";
    }

    function fmt(v) { return String(Math.round(v * 1000) / 1000); }
    function fmt2(v) { return String(Math.round(v * 100) / 100); }

    function pickColor(hex) {
        try {
            if (typeof $ === "undefined" || !$.colorPicker) { return null; }
            var cur = parseInt(String(hex || "#FFFFFF").replace("#", ""), 16);
            var c = $.colorPicker(isNaN(cur) ? 0xFFFFFF : cur);
            if (c < 0) { return null; }
            return S.rgbToHex([((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255]);
        } catch (e) { return null; }
    }

    UI.create = function (thisObj) {
        var st = {
            cfg: UI.loadLast() || S.defaultConfig(),
            editing: "start",
            brush: "",
            thumbs: {},
            missing: {},
            useThumbs: getSetting(KEY_THUMB) !== "0",
            cells: [],
            fields: [],
            reelFields: [],
            lineFields: [],
            timelines: [],
            plan: null
        };
        var isPanel = (typeof Panel !== "undefined") && (thisObj instanceof Panel);
        var win = isPanel ? thisObj : new Window("palette", S.NAME + " " + S.VERSION, undefined, { resizeable: true });
        win.orientation = "column";
        win.alignChildren = ["fill", "top"];
        win.spacing = 6;
        win.margins = 8;

        // ================= 共用小工具 =================
        function persist() { setSetting(KEY_CFG, S.json.stringify(st.cfg)); }

        function setStatus(msg) { status.text = msg; }

        function row(parent) {
            var g = parent.add("group");
            g.orientation = "row";
            g.alignChildren = ["left", "center"];
            g.spacing = 4;
            g.margins = 0;
            return g;
        }

        function section(parent, title) {
            var p = parent.add("panel", undefined, title);
            p.orientation = "column";
            p.alignChildren = ["left", "top"];
            p.spacing = 4;
            p.margins = [8, 12, 8, 6];
            return p;
        }

        function label(parent, text, width) {
            var t = parent.add("statictext", undefined, text);
            t.preferredSize.width = width || 56;
            return t;
        }

        function hint(parent, text) {
            var t = parent.add("statictext", undefined, text, { multiline: true });
            t.preferredSize.width = 330;
            return t;
        }

        function relayout() {
            try { win.layout.layout(true); win.layout.resize(); } catch (e) { /* ignore */ }
        }

        function redraw(ctrl) {
            try { ctrl.hide(); ctrl.show(); } catch (e) { /* 觸發重繪 */ }
        }

        // 綁定 st.cfg[group][key] 的欄位。opts.after = 改完後呼叫
        function numField(parent, text, group, key, unit, opts) {
            opts = opts || {};
            if (text) { label(parent, text, opts.labelWidth); }
            var et = parent.add("edittext", undefined, fmt(st.cfg[group][key]));
            et.characters = opts.chars || 5;
            if (opts.tip) { et.helpTip = opts.tip; }
            if (unit) { parent.add("statictext", undefined, unit); }
            et.onChange = function () {
                var v = parseFloat(this.text);
                if (isNaN(v)) { this.text = fmt(st.cfg[group][key]); return; }
                if (opts.min !== undefined && v < opts.min) { v = opts.min; }
                if (opts.max !== undefined && v > opts.max) { v = opts.max; }
                if (opts.integer) { v = Math.round(v); }
                st.cfg[group][key] = v;
                this.text = fmt(v);
                changed(opts.after);
            };
            st.fields.push({ kind: "num", ctrl: et, group: group, key: key });
            return et;
        }

        function textField(parent, text, group, key, opts) {
            opts = opts || {};
            if (text) { label(parent, text, opts.labelWidth); }
            var et = parent.add("edittext", undefined, String(st.cfg[group][key]));
            et.characters = opts.chars || 12;
            if (opts.tip) { et.helpTip = opts.tip; }
            et.onChange = function () {
                st.cfg[group][key] = this.text;
                changed(opts.after);
            };
            st.fields.push({ kind: "text", ctrl: et, group: group, key: key });
            return et;
        }

        function dropField(parent, text, group, key, values, labels, opts) {
            opts = opts || {};
            if (text) { label(parent, text, opts.labelWidth); }
            var dd = parent.add("dropdownlist", undefined, labels);
            dd.selection = Math.max(0, U.indexOf(values, st.cfg[group][key]));
            dd.onChange = function () {
                if (!this.selection) { return; }
                st.cfg[group][key] = values[this.selection.index];
                changed(opts.after);
            };
            st.fields.push({ kind: "drop", ctrl: dd, group: group, key: key, values: values });
            return dd;
        }

        function checkField(parent, text, group, key, opts) {
            opts = opts || {};
            var cb = parent.add("checkbox", undefined, text);
            cb.value = !!st.cfg[group][key];
            if (opts.tip) { cb.helpTip = opts.tip; }
            cb.onClick = function () {
                st.cfg[group][key] = this.value;
                changed(opts.after);
            };
            st.fields.push({ kind: "check", ctrl: cb, group: group, key: key });
            return cb;
        }

        function colorField(parent, text, holder, key, opts) {
            opts = opts || {};
            if (text) { label(parent, text, opts.labelWidth); }
            var et = parent.add("edittext", undefined, String(holder()[key]));
            et.characters = 7;
            et.helpTip = "#RRGGBB" + (opts.allowEmpty ? "；空白 = 自動配色" : "");
            var btn = parent.add("button", undefined, "選色");
            btn.preferredSize.width = 44;
            function apply(v) {
                v = U.trim(v).toUpperCase();
                if (v !== "" && v.charAt(0) !== "#") { v = "#" + v; }
                if (v === "" ? !opts.allowEmpty : !/^#[0-9A-F]{6}$/.test(v)) { et.text = String(holder()[key]); return; }
                holder()[key] = v;
                et.text = v;
                changed(opts.after);
            }
            et.onChange = function () { apply(this.text); };
            btn.onClick = function () {
                var c = pickColor(holder()[key] || "#FFFFFF");
                if (c) { apply(c); }
            };
            return et;
        }

        function changed(after) {
            if (after) { after(); }
            persist();
            updatePlan();
        }

        function syncFields() {
            for (var i = 0; i < st.fields.length; i++) {
                var f = st.fields[i], v = st.cfg[f.group][f.key];
                if (f.kind === "num") { f.ctrl.text = fmt(v); }
                else if (f.kind === "text") { f.ctrl.text = String(v); }
                else if (f.kind === "check") { f.ctrl.value = !!v; }
                else if (f.kind === "drop") { f.ctrl.selection = Math.max(0, U.indexOf(f.values, v)); }
            }
        }

        function names() { return S.symbolNames(st.cfg); }

        function findSymbol(name) {
            for (var i = 0; i < st.cfg.symbols.length; i++) {
                if (st.cfg.symbols[i].name === name) { return st.cfg.symbols[i]; }
            }
            return null;
        }

        function currentBoard() {
            return st.editing === "start" ? st.cfg.startBoard : st.cfg.endBoard;
        }

        function setCurrentBoard(b) {
            if (st.editing === "start") { st.cfg.startBoard = b; } else { st.cfg.endBoard = b; }
            refreshCells();
            persist();
        }

        function boardIsEmpty(b) {
            for (var r = 0; r < b.length; r++) {
                for (var y = 0; y < b[r].length; y++) { if (b[r][y]) { return false; } }
            }
            return true;
        }

        function fillEmpty(b, pool, rng) {
            if (!pool.length) { return b; }
            for (var r = 0; r < b.length; r++) {
                for (var y = 0; y < b[r].length; y++) { if (!b[r][y]) { b[r][y] = rng.pick(pool); } }
            }
            return b;
        }

        function randomSeed() {
            return (new Date().getTime() % 2147483000) + Math.floor(Math.random() * 600) + 1;
        }

        function curveLabel(k) {
            var i = U.indexOf(S.CURVE_KEYS, k);
            return i >= 0 ? S.CURVE_LABELS[i] : k;
        }

        function currentFps() {
            var c = A.activeComp();
            return (st.cfg.layout.target !== "new" && c) ? c.frameRate : st.cfg.layout.newCompFps;
        }

        // ================= 縮圖 =================
        function getThumb(name) {
            if (!name) { return null; }
            var e = findSymbol(name);
            if (!e || !e.path || !THUMB_RE.test(e.path)) { return null; }
            if (st.thumbs.hasOwnProperty(e.path)) { return st.thumbs[e.path]; }
            var img = null;
            try {
                var f = new File(e.path);
                if (f.exists) { img = ScriptUI.newImage(f); }
            } catch (err) { img = null; }
            st.thumbs[e.path] = img;
            return img;
        }

        function newPen(g, rgba, w) { return g.newPen(g.PenType.SOLID_COLOR, rgba, w || 1); }

        function fillRect(g, x, y, w, h, rgba) {
            if (w <= 0 || h <= 0) { return; }
            g.newPath();
            g.rectPath(x, y, w, h);
            g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, rgba));
        }

        function smallFont(size) {
            try { return ScriptUI.newFont("dialog", "REGULAR", size); } catch (e) { return null; }
        }

        // 自訂繪製：縮圖 + 名稱。不支援 onDraw 的平台會退回一般按鈕文字。
        function drawThumb(ctrl, name, w, h, bgColor) {
            var g = ctrl.graphics;
            fillRect(g, 0, 0, w, h, bgColor);
            var pen = newPen(g, [0.92, 0.92, 0.92, 1]);
            var img = getThumb(name);
            var text = name || "-";
            var labelH = img ? 12 : 0;
            if (img) {
                var iw = img.size[0], ih = img.size[1];
                var sc = Math.min((w - 6) / iw, (h - 6 - labelH) / ih);
                var dw = Math.max(1, iw * sc), dh = Math.max(1, ih * sc);
                g.drawImage(img, (w - dw) / 2, (h - labelH - dh) / 2 + 1, dw, dh);
            }
            var font = smallFont(img ? 9 : 11) || g.font;
            var maxChars = Math.max(2, Math.floor(w / 6));
            if (text.length > maxChars) { text = text.substring(0, maxChars - 1) + "…"; }
            var tw = g.measureString(text, font)[0];
            var ty = img ? h - labelH - 2 : (h - 12) / 2;
            g.drawString(text, pen, Math.max(1, (w - tw) / 2), ty, font);
            g.newPath();
            g.rectPath(0, 0, w, h);
            g.strokePath(newPen(g, [0.45, 0.45, 0.45, 1]));
        }

        function drawCell() {
            try {
                var bg = st.editing === "start" ? [0.15, 0.24, 0.17, 1] : [0.27, 0.15, 0.15, 1];
                drawThumb(this, this.sfsName, this.size[0], this.size[1], bg);
            } catch (e) { /* 繪製失敗就算了 */ }
        }

        // ================= 時間軸圖 =================
        function drawTimeline() {
            var g = this.graphics, w = this.size[0], h = this.size[1];
            try {
                fillRect(g, 0, 0, w, h, [0.1, 0.1, 0.12, 1]);
                var font = smallFont(9) || g.font;
                var textPen = newPen(g, [0.85, 0.85, 0.85, 1]);
                var plan = st.plan;
                if (!plan || plan.errors.length || !plan.reels.length) {
                    g.drawString(plan && plan.errors.length ? "⚠ " + plan.errors[0] : "（尚無節奏）", textPen, 6, 6, font);
                    return;
                }
                var n = plan.reels.length, hasLines = plan.lines.length > 0;
                var labelW = 28, top = 4, axisH = 14;
                var rowH = Math.max(6, Math.floor((h - top - axisH) / (n + (hasLines ? 1 : 0))));
                var T0 = plan.startTime, T1 = Math.max(plan.endTime, T0 + 0.5) + 0.15;
                var sc = (w - labelW - 6) / (T1 - T0);
                var X = function (t) { return labelW + (t - T0) * sc; };
                // 刻度：每 0.5 秒細線、每 1 秒標數字
                var gridPen = newPen(g, [0.22, 0.22, 0.26, 1]);
                for (var t = 0; T0 + t <= T1; t += 0.5) {
                    var gx = X(T0 + t);
                    g.newPath(); g.moveTo(gx, top); g.lineTo(gx, h - axisH); g.strokePath(gridPen);
                    if (Math.abs(t - Math.round(t)) < 1e-6) {
                        g.drawString(String(Math.round(t)) + "s", textPen, gx - 4, h - axisH + 1, font);
                    }
                }
                for (var i = 0; i < n; i++) {
                    var rp = plan.reels[i], y = top + i * rowH, bh = Math.max(3, rowH - 3);
                    g.drawString("R" + (rp.index + 1), textPen, 4, y + (bh - 10) / 2, font);
                    fillRect(g, X(rp.spinStart), y, X(rp.decelStart) - X(rp.spinStart), bh, [0.22, 0.48, 0.92, 1]);
                    fillRect(g, X(rp.decelStart), y, X(rp.stopTime) - X(rp.decelStart), bh, [0.55, 0.75, 1, 1]);
                    fillRect(g, X(rp.stopTime), y, X(rp.settleTime) - X(rp.stopTime), bh, [0.5, 0.5, 0.55, 1]);
                    fillRect(g, X(rp.stopTime) - 1, y - 1, 2, bh + 2, [1, 1, 1, 1]);
                }
                for (i = 0; i < plan.frames.length; i++) {
                    var fr = plan.frames[i], fy = top + fr.reel * rowH;
                    var orange = [1, 0.72, 0.18, 1];
                    fillRect(g, X(fr.start), fy, X(fr.end) - X(fr.start), 2, orange);
                    fillRect(g, X(fr.start), fy + Math.max(3, rowH - 3) - 2, X(fr.end) - X(fr.start), 2, orange);
                }
                if (hasLines) {
                    var ly = top + n * rowH, stripe = Math.max(2, Math.floor((rowH - 2) / plan.lines.length));
                    g.drawString("連線", textPen, 2, ly + (rowH - 12) / 2, font);
                    for (i = 0; i < plan.lines.length; i++) {
                        var pl = plan.lines[i], c = pl.color;
                        for (var k = 0; k < pl.shows.length; k++) {
                            fillRect(g, X(pl.shows[k].start), ly + i * stripe, X(pl.shows[k].end) - X(pl.shows[k].start),
                                Math.max(1, stripe - 1), [c[0], c[1], c[2], 1]);
                        }
                    }
                }
            } catch (e) { /* 繪製失敗就算了 */ }
        }

        function addTimeline(parent) {
            var tl = parent.add("group");
            tl.preferredSize = [340, 120];
            tl.onDraw = drawTimeline;
            tl.helpTip = "藍 = 轉動、淺藍 = 減速、白線 = 停輪、灰 = 回彈、橘框 = 繞框、彩色 = 連線顯示";
            st.timelines.push(tl);
            return tl;
        }

        // ================= 版面骨架 =================
        var tabs = win.add("tabbedpanel");
        tabs.alignChildren = ["fill", "top"];
        var tSym = tabs.add("tab", undefined, "符號");
        var tBoard = tabs.add("tab", undefined, "盤面");
        var tRhythm = tabs.add("tab", undefined, "節奏");
        var tReels = tabs.add("tab", undefined, "各輪");
        var tFrame = tabs.add("tab", undefined, "繞框");
        var tLines = tabs.add("tab", undefined, "連線");
        var tSet = tabs.add("tab", undefined, "設定");
        var allTabs = [tSym, tBoard, tRhythm, tReels, tFrame, tLines, tSet];
        for (var ti = 0; ti < allTabs.length; ti++) {
            allTabs[ti].orientation = "column";
            allTabs[ti].alignChildren = ["left", "top"];
            allTabs[ti].spacing = 5;
            allTabs[ti].margins = [8, 10, 8, 8];
        }

        // ================= 符號 =================
        var gSymBtns = row(tSym);
        var btnImport = gSymBtns.add("button", undefined, "匯入資料夾…");
        btnImport.helpTip = "選一個資料夾，裡面的 PNG / JPG / PSD 等圖檔都會變成符號（檔名 = 符號名稱）";
        var btnAddSel = gSymBtns.add("button", undefined, "加入專案選取");
        btnAddSel.helpTip = "把專案面板中選取的素材或合成（可做動態符號）加入符號庫";

        var gSymList = row(tSym);
        gSymList.alignChildren = ["left", "top"];
        var list = gSymList.add("listbox", undefined, [], { multiselect: true });
        list.preferredSize = [190, 220];
        var preview = gSymList.add("group");
        preview.preferredSize = [100, 100];
        preview.onDraw = function () {
            try {
                var idx = selectedIndices(list);
                var name = idx.length ? st.cfg.symbols[idx[0]].name : "";
                drawThumb(this, name, this.size[0], this.size[1], [0.12, 0.12, 0.12, 1]);
            } catch (e) { /* ignore */ }
        };

        var gSymOps = row(tSym);
        var btnFiller = gSymOps.add("button", undefined, "切換填充");
        btnFiller.helpTip = "● = 轉動中會隨機出現的填充符號；○ = 只會出現在你指定的盤面上（例如不想被亂數帶出來的 Scatter / Bonus）";
        var btnRename = gSymOps.add("button", undefined, "改名");
        var btnRemove = gSymOps.add("button", undefined, "移除");
        var btnClear = gSymOps.add("button", undefined, "清空");
        hint(tSym, "● 填充符號（轉動中隨機出現）  ○ 不當填充　雙擊可切換");

        // ================= 盤面 =================
        var gSize = row(tBoard);
        label(gSize, "輪數", 30);
        var etReels = gSize.add("edittext", undefined, String(st.cfg.layout.reels));
        etReels.characters = 3;
        label(gSize, "列數", 30);
        var etRows = gSize.add("edittext", undefined, String(st.cfg.layout.rows));
        etRows.characters = 3;
        var btnSize = gSize.add("button", undefined, "套用尺寸");

        var gMode = row(tBoard);
        var rbStart = gMode.add("radiobutton", undefined, "起始盤面");
        var rbEnd = gMode.add("radiobutton", undefined, "結果盤面");
        rbStart.value = true;
        var cbThumbs = gMode.add("checkbox", undefined, "縮圖");
        cbThumbs.value = st.useThumbs;
        cbThumbs.helpTip = "格子顯示符號縮圖（PNG / JPG）。如果畫面顯示異常可以關掉。";

        var gBrush = row(tBoard);
        label(gBrush, "畫筆", 30);
        var ddBrush = gBrush.add("dropdownlist", undefined, []);
        ddBrush.preferredSize.width = 150;

        var grid = tBoard.add("group");
        grid.orientation = "column";
        grid.alignChildren = ["left", "top"];
        grid.spacing = 2;
        grid.margins = [0, 4, 0, 4];

        var gOps = row(tBoard);
        var btnRandom = gOps.add("button", undefined, "隨機");
        var btnFillAll = gOps.add("button", undefined, "全填畫筆");
        var btnCopy = gOps.add("button", undefined, "複製到另一盤");
        var btnSwap = gOps.add("button", undefined, "互換");
        var gOps2 = row(tBoard);
        var btnText = gOps2.add("button", undefined, "文字編輯…");
        btnText.helpTip = "用文字輸入盤面，可直接從 Excel / Google 試算表貼上";
        hint(tBoard, "點格子 = 填入畫筆　Alt+點 = 吸取符號　Shift+點 = 整輪填入");

        // ================= 節奏（快速產生） =================
        function regen() {
            if (st.cfg.spin.autoRhythm) { st.cfg.reels = S.generateReels(st.cfg); refreshReelList(); }
        }
        var rr1 = row(tRhythm);
        var etStart = numField(rr1, "開始時間", "spin", "startTime", "秒", { min: 0, tip: "開始轉動的時間（目標合成的時間）。各輪的時間都從這裡起算" });
        var btnCTI = rr1.add("button", undefined, "取目前時間");
        var rr2 = row(tRhythm);
        textField(rr2, "起轉順序", "spin", "startOrder", { chars: 11, after: regen, tip: "空白 = 1,2,3…。例：1,2,3,4,5 依序起轉；1+2+3+4+5 同時起轉" });
        numField(rr2, "間隔", "spin", "startStagger", "秒", { min: 0, labelWidth: 30, after: regen });
        var rr3 = row(tRhythm);
        textField(rr3, "停輪順序", "spin", "stopOrder", {
            chars: 11, after: regen,
            tip: "逗號 = 先後，+ = 同時停。\n例：1,2,3,4,5（左到右）、5,4,3,2,1（右到左）、1+2+3,4,5（前三輪一起停）、3,2,4,1,5（從中間往外）"
        });
        var rr4 = row(tRhythm);
        numField(rr4, "第一次停", "spin", "firstStop", "秒", { min: 0.05, after: regen, tip: "從開始到第一次停輪（停輪 = 衝到最遠點那一刻，可對齊音效）" });
        numField(rr4, "每次間隔", "spin", "stagger", "秒", { min: 0, labelWidth: 52, after: regen });
        var rr5 = row(tRhythm);
        textField(rr5, "轉速", "spin", "speeds", {
            chars: 14, after: regen,
            tip: "格/秒。一個數字 = 全部一樣；列表 = 依停輪順序，例如 18,18,20,24,28（越後面停的轉越快）"
        });
        rr5.add("statictext", undefined, "格/秒");
        var rr6 = row(tRhythm);
        numField(rr6, "減速", "spin", "decelTime", "秒", { min: 0, after: regen, tip: "停輪前的減速時間，越短停得越乾脆" });
        dropField(rr6, "", "spin", "decelCurve", S.CURVE_KEYS, S.CURVE_LABELS, { after: regen });
        var rr7 = row(tRhythm);
        numField(rr7, "停輪衝過", "spin", "overshoot", "格", { min: 0, after: regen, tip: "停輪時衝過定位的距離（0 = 不回彈）" });
        numField(rr7, "回彈", "spin", "bounceTime", "秒", { min: 0, labelWidth: 30, after: regen });
        var pAnt = section(tRhythm, "期待（會繞框）");
        var ra1 = row(pAnt);
        textField(ra1, "期待輪", "spin", "antReels", { chars: 7, after: regen, tip: "例如 4,5：第 4、5 輪會延長轉動並繞框（聽牌）" });
        numField(ra1, "每輪多轉", "spin", "antTime", "秒", { min: 0, labelWidth: 52, after: regen, tip: "會往後累加：第 4 輪多 0.8、第 5 輪再多 0.8" });
        var ra2 = row(pAnt);
        numField(ra2, "繞框轉速", "spin", "antSpeed", "格/秒", { min: 0, after: regen, tip: "繞框開始後切換到的轉速，0 = 不變" });
        var ra3 = row(pAnt);
        numField(ra3, "期待減速", "spin", "antDecelTime", "秒", { min: 0, after: regen });
        dropField(ra3, "", "spin", "antCurve", S.CURVE_KEYS, S.CURVE_LABELS, { after: regen });
        var pSug = section(tRhythm, "期待感建議（依結果盤面自動判斷期待輪）");
        var rs1 = row(pSug);
        textField(rs1, "觸發符號", "antRule", "symbols", { chars: 9, tip: "Scatter / Bonus 等觸發型符號，逗號分隔" });
        numField(rs1, "", "antRule", "count", "顆觸發", { min: 2, integer: true, chars: 2 });
        checkField(rs1, "達標後續追", "antRule", "after", { tip: "已經觸發後，後面的輪還是期待（追第 4、5 顆）" });
        var rs2 = row(pSug);
        textField(rs2, "聽牌符號", "antRule", "tease", { chars: 9, tip: "大獎符號（例如 SEVEN）：同一條線從第 1 輪連到第 N 輪時，下一輪期待。空白 = 不判斷" });
        numField(rs2, "連", "antRule", "teaseMin", "輪後", { min: 1, integer: true, chars: 2, labelWidth: 20 });
        var btnSuggest = rs2.add("button", undefined, "期待感建議");
        btnSuggest.helpTip = "依「結果盤面」和「停輪順序」模擬玩家看到的過程，算出哪幾輪要期待，並重新產生各輪";
        var rr8 = row(tRhythm);
        var cbAuto = checkField(rr8, "自動套用到各輪", "spin", "autoRhythm", {
            after: regen, tip: "勾選時，改上面的參數會立刻重新產生「各輪」表格。手動改過各輪後會自動取消勾選。"
        });
        var btnApplyRhythm = rr8.add("button", undefined, "套用節奏");
        addTimeline(tRhythm);
        var info = tRhythm.add("statictext", undefined, "", { multiline: true });
        info.preferredSize = [340, 44];

        // ================= 各輪 =================
        var reelList = tReels.add("listbox", undefined, [], {
            multiselect: true, numberOfColumns: 8, showHeaders: true,
            columnTitles: ["輪", "起轉", "停輪", "轉速", "減速", "衝過", "回彈", "繞框"],
            columnWidths: [30, 40, 40, 40, 70, 36, 36, 60]
        });
        reelList.preferredSize = [356, 130];
        var re1 = row(tReels);
        reelField(re1, "起轉", "start", "秒", { min: 0 });
        reelField(re1, "停輪", "stop", "秒", { min: 0.05, labelWidth: 30 });
        var re2 = row(tReels);
        reelField(re2, "轉速", "speed", "格/秒", { min: 0.1 });
        var re3 = row(tReels);
        reelField(re3, "減速", "decelTime", "秒", { min: 0 });
        var ddReelCurve = re3.add("dropdownlist", undefined, S.CURVE_LABELS);
        ddReelCurve.selection = 0;
        var re4 = row(tReels);
        reelField(re4, "停輪衝過", "overshoot", "格", { min: 0 });
        reelField(re4, "回彈", "bounceTime", "秒", { min: 0, labelWidth: 30 });
        var re5 = row(tReels);
        var cbReelFrame = re5.add("checkbox", undefined, "繞框");
        reelField(re5, "開始", "frameStart", "秒", { min: 0, labelWidth: 30 });
        reelField(re5, "轉速", "frameSpeed", "", { min: 0, labelWidth: 30, tip: "繞框開始後切換到的轉速（格/秒），0 = 不變" });
        var re6 = row(tReels);
        var btnSelAll = re6.add("button", undefined, "全選");
        var btnShift = re6.add("button", undefined, "整體平移…");
        btnShift.helpTip = "把選取輪的起轉 / 停輪 / 繞框時間一起往前或往後移";
        hint(tReels, "時間都從「開始時間」算起（秒）。可多選一起改。");
        addTimeline(tReels);

        // ================= 繞框 =================
        var fr1 = row(tFrame);
        var ddFrameSrc = dropField(fr1, "素材", "frame", "source", ["builtin", "custom"], ["內建跑燈框", "自訂素材"]);
        var btnFrameAsset = fr1.add("button", undefined, "指定選取");
        btnFrameAsset.helpTip = "在專案面板選一個素材或合成（你自己的繞框動畫），按這裡指定";
        var stFrameAsset = tFrame.add("statictext", undefined, "");
        stFrameAsset.preferredSize.width = 330;
        var fr2 = row(tFrame);
        colorField(fr2, "顏色", function () { return st.cfg.frame; }, "color");
        numField(fr2, "線寬", "frame", "width", "px", { min: 1, labelWidth: 30 });
        var fr3 = row(tFrame);
        numField(fr3, "外擴", "frame", "pad", "px", { min: -100, tip: "框比轉輪大多少（每邊）" });
        numField(fr3, "跑燈", "frame", "laps", "圈/秒", { min: 0, labelWidth: 30 });
        var fr4 = row(tFrame);
        numField(fr4, "跑燈長度", "frame", "runner", "%", { min: 1, max: 100 });
        checkField(fr4, "光暈", "frame", "glow");
        var fr5 = row(tFrame);
        numField(fr5, "淡入淡出", "frame", "fade", "秒", { min: 0 });
        numField(fr5, "停後保留", "frame", "hold", "秒", { min: 0, labelWidth: 52 });
        hint(tFrame, "哪幾輪要繞框、什麼時候開始：在「節奏」設定期待輪，或在「各輪」逐輪勾選「繞框」並設定開始時間。繞框會在該輪停妥後結束。");

        // ================= 連線 =================
        var ln1 = row(tLines);
        var btnPaylines = ln1.add("button", undefined, "線型表…");
        btnPaylines.helpTip = "每行一條線，寫每輪第幾列（1 = 最上面），例如 2 2 2 2 2";
        textField(ln1, "百搭", "lineSet", "wilds", { chars: 6, labelWidth: 30, tip: "可代替任何符號，逗號分隔" });
        numField(ln1, "最少", "lineSet", "minCount", "連", { min: 1, integer: true, chars: 2, labelWidth: 30 });
        var ln1b = row(tLines);
        textField(ln1b, "不算連線", "lineSet", "exclude", { chars: 12, tip: "這些符號不會算成連線（例如 SCATTER），逗號分隔" });
        var ln2 = row(tLines);
        var btnDetect = ln2.add("button", undefined, "從結果盤面偵測");
        var btnAddLine = ln2.add("button", undefined, "新增");
        var btnDelLine = ln2.add("button", undefined, "刪除");
        var lineList = tLines.add("listbox", undefined, [], {
            multiselect: true, numberOfColumns: 4, showHeaders: true,
            columnTitles: ["#", "線型", "連", "顯示（停妥後 開始+長度）"],
            columnWidths: [26, 84, 26, 200]
        });
        lineList.preferredSize = [356, 100];
        var le1 = row(tLines);
        var etLinePattern = lineField(le1, "線型", "pattern", { chars: 12, tip: "每輪第幾列（1 = 最上面），例如 1,2,3,2,1" });
        var etLineCount = lineField(le1, "連", "count", { chars: 2, labelWidth: 20, integer: true });
        var le2 = row(tLines);
        var etLineShows = lineField(le2, "顯示", "shows", { chars: 22, tip: "停妥後幾秒開始 + 顯示幾秒，可以多段：0.3+1.2, 2.5+0.9" });
        var le3 = row(tLines);
        var lineColorEt = colorField(le3, "顏色", function () { return selectedLine() || { color: "" }; }, "color", {
            allowEmpty: true, after: function () { refreshLineList(); }
        });
        var pLineTime = section(tLines, "顯示時間");
        var lt1 = row(pLineTime);
        numField(lt1, "停妥後", "lineGen", "delay", "秒", { min: 0, labelWidth: 40 });
        dropField(lt1, "", "lineGen", "mode", S.LINE_MODES, S.LINE_MODE_LABELS);
        var lt2 = row(pLineTime);
        numField(lt2, "全部", "lineGen", "allTime", "秒", { min: 0.05, labelWidth: 30 });
        numField(lt2, "每條", "lineGen", "eachTime", "秒", { min: 0.05, labelWidth: 30 });
        numField(lt2, "間隔", "lineGen", "gap", "", { min: 0, labelWidth: 30 });
        var btnLineTiming = pLineTime.add("button", undefined, "套用到全部連線");
        var pLineStyle = section(tLines, "樣式");
        var ls1 = row(pLineStyle);
        numField(ls1, "線寬", "lineStyle", "width", "px", { min: 1, labelWidth: 30 });
        numField(ls1, "畫線", "lineStyle", "drawTime", "秒", { min: 0, labelWidth: 30 });
        checkField(ls1, "畫滿", "lineStyle", "full", { tip: "勾選 = 線畫滿整個盤面；不勾 = 只畫中獎的那幾格" });
        var ls2 = row(pLineStyle);
        checkField(ls2, "中獎框", "lineStyle", "boxes");
        numField(ls2, "框寬", "lineStyle", "boxWidth", "", { min: 1, labelWidth: 30, chars: 3 });
        numField(ls2, "跳動", "lineStyle", "pulse", "%", { min: 100, labelWidth: 30, chars: 4, tip: "中獎符號放大到幾 %，100 = 不跳" });
        checkField(ls2, "光暈", "lineStyle", "glow");
        var ls3 = row(pLineStyle);
        dropField(ls3, "中獎格", "lineStyle", "cellSource", ["builtin", "custom"], ["內建框", "自訂素材"], { labelWidth: 40 });
        var btnCellAsset = ls3.add("button", undefined, "指定選取");
        var stCellAsset = pLineStyle.add("statictext", undefined, "");
        stCellAsset.preferredSize.width = 320;

        // ================= 設定 =================
        var pLayout = section(tSet, "版面");
        var l1 = row(pLayout);
        numField(l1, "格寬", "layout", "cellW", "px", { min: 4, integer: true, labelWidth: 40 });
        numField(l1, "格高", "layout", "cellH", "px", { min: 4, integer: true, labelWidth: 30 });
        var l2 = row(pLayout);
        numField(l2, "輪距", "layout", "gapX", "px", { min: 0, integer: true, labelWidth: 40, tip: "輪與輪之間的水平間距" });
        numField(l2, "列距", "layout", "gapY", "px", { min: 0, integer: true, labelWidth: 30, tip: "同一輪上下符號的間距" });
        var l3 = row(pLayout);
        numField(l3, "上下露出", "layout", "peek", "px", { min: 0, integer: true, tip: "轉輪視窗上下多露出的高度（看得到半顆相鄰符號）" });
        numField(l3, "留白", "layout", "margin", "px", { min: 0, integer: true, labelWidth: 30, tip: "盤面合成四周留白，給繞框 / 連線光暈用" });
        var l4 = row(pLayout);
        dropField(l4, "符號縮放", "layout", "scaleMode", ["fit", "none"], ["符合格子", "原始尺寸"]);
        numField(l4, "", "layout", "symbolScale", "%", { min: 1 });
        var l5 = row(pLayout);
        dropField(l5, "輸出到", "layout", "target", ["active", "new"], ["目前合成", "新建合成"]);
        numField(l5, "新合成", "layout", "newCompFps", "fps", { min: 1, max: 120, labelWidth: 40 });
        var pFeel = section(tSet, "手感");
        var f1 = row(pFeel);
        numField(f1, "起轉拉回", "spin", "windupDist", "格", { min: 0, tip: "開始前先反方向拉一點（0 = 不拉回）" });
        numField(f1, "", "spin", "windupTime", "秒", { min: 0 });
        var f2 = row(pFeel);
        numField(f2, "加速時間", "spin", "accelTime", "秒", { min: 0 });
        numField(f2, "變速過渡", "spin", "speedRamp", "秒", { min: 0, labelWidth: 52, tip: "切換到繞框轉速的過渡時間" });
        var f3 = row(pFeel);
        dropField(f3, "方向", "spin", "direction", ["down", "up"], ["向下", "向上"]);
        var etSeed = numField(f3, "亂數種子", "spin", "seed", "", { min: 1, integer: true, chars: 6, labelWidth: 52, tip: "決定轉動中填充符號的排列，同一個種子結果相同" });
        var btnSeed = f3.add("button", undefined, "換");
        btnSeed.preferredSize.width = 30;
        var f4 = row(pFeel);
        checkField(f4, "動態模糊", "spin", "motionBlur");
        numField(f4, "快門角度", "spin", "shutterAngle", "", { min: 0, max: 720, integer: true, labelWidth: 52 });

        // ================= 底部動作 =================
        var gAct = row(win);
        gAct.alignChildren = ["fill", "center"];
        var btnBuild = gAct.add("button", undefined, "▶ 建立假轉");
        btnBuild.helpTip = "在目前合成（或新合成）建立轉輪動畫、繞框與連線";
        var btnUpdate = gAct.add("button", undefined, "更新選取盤面");
        btnUpdate.helpTip = "選取之前建立的盤面圖層，用目前設定重建（保留圖層位置 / 特效）";
        var gAct2 = row(win);
        var btnLoad = gAct2.add("button", undefined, "讀取選取盤面");
        btnLoad.helpTip = "把選取盤面圖層當時的設定讀回面板";
        var btnSave = gAct2.add("button", undefined, "存設定…");
        var btnOpen = gAct2.add("button", undefined, "開設定…");
        var status = win.add("statictext", undefined, "", { multiline: true });
        status.preferredSize = [340, 32];

        // ================= 各輪欄位 =================
        function selectedIndices(lb) {
            var out = [], sel = lb.selection;
            if (!sel) { return out; }
            if (sel.length === undefined) { sel = [sel]; }
            for (var i = 0; i < sel.length; i++) { out.push(sel[i].index); }
            out.sort(function (a, b) { return a - b; });
            return out;
        }

        function selectIndices(lb, idx) {
            var sel = [];
            for (var k = 0; k < idx.length; k++) {
                if (idx[k] < lb.items.length) { sel.push(lb.items[idx[k]]); }
            }
            lb.selection = sel.length ? sel : null;
        }

        function selectedReels() {
            var idx = selectedIndices(reelList), out = [];
            for (var i = 0; i < idx.length; i++) { if (st.cfg.reels[idx[i]]) { out.push(st.cfg.reels[idx[i]]); } }
            return out;
        }

        // 手動改了各輪 → 關掉自動套用，避免被快速節奏覆蓋
        function reelsEdited() {
            if (st.cfg.spin.autoRhythm) {
                st.cfg.spin.autoRhythm = false;
                cbAuto.value = false;
                setStatus("已手動調整各輪；「節奏」頁改為按「套用節奏」才會覆蓋");
            }
            refreshReelList(true);
            persist();
            updatePlan();
        }

        function reelField(parent, text, key, unit, opts) {
            opts = opts || {};
            if (text) { label(parent, text, opts.labelWidth || 52); }
            var et = parent.add("edittext", undefined, "");
            et.characters = opts.chars || 5;
            if (opts.tip) { et.helpTip = opts.tip; }
            if (unit) { parent.add("statictext", undefined, unit); }
            et.onChange = function () {
                var rs = selectedReels();
                var v = parseFloat(this.text);
                if (!rs.length || isNaN(v)) { syncReelEditor(); return; }
                if (opts.min !== undefined && v < opts.min) { v = opts.min; }
                for (var i = 0; i < rs.length; i++) { rs[i][key] = v; }
                this.text = fmt(v);
                reelsEdited();
            };
            st.reelFields.push({ ctrl: et, key: key });
            return et;
        }

        function syncReelEditor() {
            var rs = selectedReels(), R = rs.length ? rs[0] : null;
            for (var i = 0; i < st.reelFields.length; i++) {
                var f = st.reelFields[i];
                f.ctrl.text = R ? fmt(R[f.key]) : "";
                f.ctrl.enabled = !!R;
            }
            ddReelCurve.enabled = cbReelFrame.enabled = !!R;
            if (R) {
                ddReelCurve.selection = Math.max(0, U.indexOf(S.CURVE_KEYS, R.decelCurve));
                cbReelFrame.value = !!R.frame;
            }
        }

        function refreshReelList(keepSel) {
            var keep = keepSel ? selectedIndices(reelList) : [];
            reelList.removeAll();
            for (var i = 0; i < st.cfg.reels.length; i++) {
                var R = st.cfg.reels[i];
                var it = reelList.add("item", "R" + (i + 1));
                var cols = [fmt2(R.start), fmt2(R.stop), fmt(R.speed), fmt2(R.decelTime) + " " + curveLabel(R.decelCurve),
                    fmt2(R.overshoot), fmt2(R.bounceTime), R.frame ? "從 " + fmt2(R.frameStart) + (R.frameSpeed > 0 ? " @" + fmt(R.frameSpeed) : "") : "-"];
                for (var c = 0; c < cols.length; c++) {
                    try { it.subItems[c].text = cols[c]; } catch (e) { /* 單欄 listbox */ }
                }
            }
            selectIndices(reelList, keep.length ? keep : (st.cfg.reels.length ? [0] : []));
            syncReelEditor();
        }

        // ================= 連線欄位 =================
        function selectedLine() {
            var idx = selectedIndices(lineList);
            return idx.length ? st.cfg.lines[idx[0]] : null;
        }

        function lineField(parent, text, key, opts) {
            opts = opts || {};
            if (text) { label(parent, text, opts.labelWidth || 30); }
            var et = parent.add("edittext", undefined, "");
            et.characters = opts.chars || 8;
            if (opts.tip) { et.helpTip = opts.tip; }
            et.onChange = function () {
                var idx = selectedIndices(lineList);
                if (!idx.length) { this.text = ""; return; }
                var v = U.trim(this.text);
                if (opts.integer) {
                    var n = Math.round(parseFloat(v));
                    if (isNaN(n)) { syncLineEditor(); return; }
                    v = Math.max(1, Math.min(st.cfg.layout.reels, n));
                }
                for (var i = 0; i < idx.length; i++) { st.cfg.lines[idx[i]][key] = v; }
                this.text = String(v);
                refreshLineList(true);
                persist();
                updatePlan();
            };
            st.lineFields.push({ ctrl: et, key: key });
            return et;
        }

        function syncLineEditor() {
            var ln = selectedLine();
            for (var i = 0; i < st.lineFields.length; i++) {
                st.lineFields[i].ctrl.text = ln ? String(ln[st.lineFields[i].key]) : "";
                st.lineFields[i].ctrl.enabled = !!ln;
            }
            lineColorEt.text = ln ? ln.color : "";
            lineColorEt.enabled = !!ln;
        }

        function refreshLineList(keepSel) {
            var keep = keepSel ? selectedIndices(lineList) : [];
            lineList.removeAll();
            for (var i = 0; i < st.cfg.lines.length; i++) {
                var ln = st.cfg.lines[i];
                var it = lineList.add("item", String(i + 1));
                var cols = [ln.pattern, String(ln.count), ln.shows];
                for (var c = 0; c < cols.length; c++) {
                    try { it.subItems[c].text = cols[c]; } catch (e) { /* 單欄 listbox */ }
                }
            }
            selectIndices(lineList, keep.length ? keep : (st.cfg.lines.length ? [0] : []));
            syncLineEditor();
        }

        function assetLabel(holder, idKey, nameKey) {
            if (!holder[nameKey] && !holder[idKey]) { return "（尚未指定）"; }
            var it = null;
            try { it = A.itemById(holder[idKey]); } catch (e) { it = null; }
            return (it ? "素材：" : "素材（找不到）：") + holder[nameKey];
        }

        function refreshAssets() {
            stFrameAsset.text = st.cfg.frame.source === "custom" ? assetLabel(st.cfg.frame, "itemId", "itemName") : "內建：圓角框 + 兩道跑燈 + 光暈";
            stCellAsset.text = st.cfg.lineStyle.cellSource === "custom" ? assetLabel(st.cfg.lineStyle, "cellItemId", "cellItemName") : "";
        }

        // ================= 刷新 =================
        function symbolLabel(e) {
            return (e.filler ? "● " : "○ ") + e.name + (st.missing[e.name] ? "  (遺失)" : "");
        }

        function refreshSymbols(keepIdx) {
            st.missing = {};
            list.removeAll();
            for (var i = 0; i < st.cfg.symbols.length; i++) {
                var e = st.cfg.symbols[i];
                var it = null;
                try { it = A.resolveSymbol(e, false); } catch (err) { it = null; }
                if (!it) { st.missing[e.name] = true; }
                list.add("item", symbolLabel(e));
            }
            if (keepIdx && keepIdx.length) { selectIndices(list, keepIdx); }
            refreshBrush();
        }

        function refreshBrush() {
            var n = names();
            ddBrush.removeAll();
            for (var i = 0; i < n.length; i++) { ddBrush.add("item", n[i]); }
            var idx = U.indexOf(n, st.brush);
            if (idx < 0 && n.length) { idx = 0; }
            st.brush = idx >= 0 ? n[idx] : "";
            if (idx >= 0) { ddBrush.selection = idx; }
        }

        function setBrush(name) {
            var idx = U.indexOf(names(), name);
            if (idx < 0) { return; }
            st.brush = name;
            ddBrush.selection = idx;
            setStatus("畫筆：" + name);
        }

        function cellSize() {
            return Math.max(34, Math.min(64, Math.floor(330 / st.cfg.layout.reels)));
        }

        function rebuildGrid() {
            while (grid.children.length) { grid.remove(grid.children[0]); }
            st.cells = [];
            var L = st.cfg.layout, cs = cellSize(), r, y;
            for (r = 0; r < L.reels; r++) { st.cells.push([]); }
            for (y = 0; y < L.rows; y++) {
                var rg = grid.add("group");
                rg.orientation = "row";
                rg.spacing = 2;
                rg.margins = 0;
                for (r = 0; r < L.reels; r++) {
                    var b = rg.add("button", undefined, "-");
                    b.preferredSize = [cs, cs];
                    b.sfsReel = r;
                    b.sfsRow = y;
                    b.sfsName = "";
                    b.onClick = onCellClick;
                    if (st.useThumbs) { b.onDraw = drawCell; }
                    st.cells[r][y] = b;
                }
            }
            refreshCells();
            relayout();
        }

        function refreshCells() {
            var board = currentBoard();
            for (var r = 0; r < st.cells.length; r++) {
                for (var y = 0; y < st.cells[r].length; y++) {
                    var b = st.cells[r][y];
                    var name = board[r] && board[r][y] ? board[r][y] : "";
                    b.sfsName = name;
                    b.text = name || "-";
                    b.helpTip = "第 " + (r + 1) + " 輪 第 " + (y + 1) + " 列：" + (name || "（空）");
                    if (st.useThumbs) { redraw(b); }
                }
            }
        }

        function updatePlan() {
            var plan = null;
            try { plan = S.computePlan(st.cfg, currentFps(), { fillerPool: ["?"] }); } catch (e) { plan = null; }
            st.plan = plan;
            for (var i = 0; i < st.timelines.length; i++) { redraw(st.timelines[i]); }
            if (!plan) { info.text = ""; return; }
            if (plan.errors.length) { info.text = "⚠ " + plan.errors[0]; return; }
            var stops = [], maxV = 0;
            for (i = 0; i < plan.reels.length; i++) {
                stops.push("R" + (plan.reels[i].index + 1) + " " + fmt2(plan.reels[i].stopTime - plan.startTime));
                maxV = Math.max(maxV, plan.reels[i].speed / plan.pitch);
            }
            var txt = "停輪(秒)：" + stops.join("  ") +
                "\n全部停妥 " + fmt2(plan.allSettled - plan.startTime) + " 秒、演出結束 " + fmt2(plan.endTime - plan.startTime) +
                " 秒（@" + fmt(plan.fps) + "fps，最高 " + fmt(Math.round(maxV * 10) / 10) + " 格/秒）";
            if (plan.warnings.length) { txt += "\n⚠ " + plan.warnings[0]; }
            info.text = txt;
        }

        function syncAll() {
            syncFields();
            etReels.text = String(st.cfg.layout.reels);
            etRows.text = String(st.cfg.layout.rows);
            refreshSymbols();
            rebuildGrid();
            refreshReelList();
            refreshLineList();
            refreshAssets();
            updatePlan();
        }

        // ================= 符號事件 =================
        function addSymbols(found) {
            var added = 0;
            for (var i = 0; i < found.length; i++) {
                var f = found[i], exists = false;
                for (var k = 0; k < st.cfg.symbols.length; k++) {
                    var e = st.cfg.symbols[k];
                    if ((f.path && e.path === f.path) || e.itemId === f.item.id) {
                        e.itemId = f.item.id;
                        exists = true;
                        break;
                    }
                }
                if (exists) { continue; }
                st.cfg.symbols.push({
                    name: S.uniqueName(f.name.replace(/[,\t\r\n]/g, "_"), names()),
                    path: f.path || "",
                    itemId: f.item.id,
                    filler: true
                });
                added++;
            }
            // 第一次匯入時自動亂數填滿兩個盤面，方便直接預覽
            var pool = S.fillerPool(st.cfg);
            var L = st.cfg.layout;
            if (pool.length && boardIsEmpty(st.cfg.startBoard)) {
                st.cfg.startBoard = S.board.randomize(L.reels, L.rows, pool, new S.Rng(randomSeed()));
            }
            if (pool.length && boardIsEmpty(st.cfg.endBoard)) {
                st.cfg.endBoard = S.board.randomize(L.reels, L.rows, pool, new S.Rng(randomSeed() + 7));
            }
            refreshSymbols();
            refreshCells();
            persist();
            updatePlan();
            return added;
        }

        btnImport.onClick = function () {
            var folder = Folder.selectDialog("選擇老虎機符號（圖騰）圖檔所在的資料夾");
            if (!folder) { return; }
            app.beginUndoGroup("SlotFakeSpin 匯入符號");
            var res;
            try { res = A.importFolder(folder); } finally { app.endUndoGroup(); }
            if (!res.symbols.length && !res.failed.length) {
                alert("這個資料夾裡沒有可用的圖檔（PNG / JPG / PSD / TGA / TIFF …）", S.NAME);
                return;
            }
            var added = addSymbols(res.symbols);
            setStatus("匯入 " + res.symbols.length + " 個圖檔，新增 " + added + " 個符號");
            if (res.failed.length) { alert("以下檔案無法匯入：\n" + res.failed.join("\n"), S.NAME); }
        };

        btnAddSel.onClick = function () {
            var found = A.selectedProjectSources();
            if (!found.length) {
                alert("請先在「專案」面板選取素材或合成", S.NAME);
                return;
            }
            var added = addSymbols(found);
            setStatus("新增 " + added + " 個符號");
        };

        function toggleFiller() {
            var idx = selectedIndices(list);
            for (var i = 0; i < idx.length; i++) {
                var e = st.cfg.symbols[idx[i]];
                e.filler = !e.filler;
            }
            refreshSymbols(idx);
            persist();
        }
        btnFiller.onClick = toggleFiller;
        list.onDoubleClick = toggleFiller;

        list.onChange = function () {
            var idx = selectedIndices(list);
            if (idx.length) { setBrush(st.cfg.symbols[idx[0]].name); }
            redraw(preview);
        };

        function replaceInBoards(oldName, newName) {
            var boards = [st.cfg.startBoard, st.cfg.endBoard];
            for (var b = 0; b < boards.length; b++) {
                for (var r = 0; r < boards[b].length; r++) {
                    for (var y = 0; y < boards[b][r].length; y++) {
                        if (boards[b][r][y] === oldName) { boards[b][r][y] = newName; }
                    }
                }
            }
        }

        function renameInList(text, oldName, newName) {
            var parts = S.parseNames(text);
            for (var i = 0; i < parts.length; i++) { if (parts[i] === oldName) { parts[i] = newName; } }
            return parts.join(",");
        }

        btnRename.onClick = function () {
            var idx = selectedIndices(list);
            if (idx.length !== 1) { alert("請選一個符號", S.NAME); return; }
            var e = st.cfg.symbols[idx[0]];
            var nn = prompt("新的符號名稱（文字編輯盤面時使用，建議簡短，例如 WILD、A、7）", e.name, S.NAME);
            if (nn === null) { return; }
            nn = U.trim(String(nn)).replace(/[,\t\r\n]/g, "_");
            if (!nn || nn === e.name) { return; }
            var others = names();
            others.splice(idx[0], 1);
            nn = S.uniqueName(nn, others);
            replaceInBoards(e.name, nn);
            st.cfg.lineSet.wilds = renameInList(st.cfg.lineSet.wilds, e.name, nn);
            st.cfg.lineSet.exclude = renameInList(st.cfg.lineSet.exclude, e.name, nn);
            if (st.brush === e.name) { st.brush = nn; }
            e.name = nn;
            refreshSymbols(idx);
            refreshCells();
            syncFields();
            persist();
        };

        btnRemove.onClick = function () {
            var idx = selectedIndices(list);
            if (!idx.length) { return; }
            if (!confirm("移除 " + idx.length + " 個符號？盤面上使用到它們的格子會清空。", false, S.NAME)) { return; }
            for (var i = idx.length - 1; i >= 0; i--) {
                replaceInBoards(st.cfg.symbols[idx[i]].name, "");
                st.cfg.symbols.splice(idx[i], 1);
            }
            refreshSymbols();
            refreshCells();
            persist();
        };

        btnClear.onClick = function () {
            if (!st.cfg.symbols.length) { return; }
            if (!confirm("清空整個符號庫與兩個盤面？（專案裡已匯入的素材不會被刪除）", false, S.NAME)) { return; }
            var L = st.cfg.layout;
            st.cfg.symbols = [];
            st.cfg.startBoard = S.board.create(L.reels, L.rows, "");
            st.cfg.endBoard = S.board.create(L.reels, L.rows, "");
            refreshSymbols();
            refreshCells();
            persist();
        };

        // ================= 盤面事件 =================
        function onCellClick() {
            var r = this.sfsReel, y = this.sfsRow;
            var board = currentBoard();
            var ks = { altKey: false, shiftKey: false };
            try { ks = ScriptUI.environment.keyboardState; } catch (e) { /* ignore */ }
            if (ks.altKey) {
                if (board[r][y]) { setBrush(board[r][y]); }
                return;
            }
            if (!st.brush) { setStatus("請先匯入符號並選擇畫筆"); return; }
            if (ks.shiftKey) {
                for (var yy = 0; yy < board[r].length; yy++) { board[r][yy] = st.brush; }
            } else {
                board[r][y] = st.brush;
            }
            refreshCells();
            persist();
        }

        ddBrush.onChange = function () {
            if (this.selection) { st.brush = this.selection.text; }
        };

        rbStart.onClick = function () { st.editing = "start"; refreshCells(); };
        rbEnd.onClick = function () { st.editing = "end"; refreshCells(); };

        cbThumbs.onClick = function () {
            st.useThumbs = this.value;
            setSetting(KEY_THUMB, this.value ? "1" : "0");
            rebuildGrid();
        };

        btnSize.onClick = function () {
            var L = st.cfg.layout;
            var nr = Math.round(U.clamp(U.toNumber(etReels.text, L.reels), 1, 12));
            var ny = Math.round(U.clamp(U.toNumber(etRows.text, L.rows), 1, 10));
            etReels.text = String(nr);
            etRows.text = String(ny);
            if (nr === L.reels && ny === L.rows) { return; }
            L.reels = nr;
            L.rows = ny;
            // 新增的格子用填充符號隨機補上，改完尺寸就能直接建立
            var pool = S.fillerPool(st.cfg), rng = new S.Rng(randomSeed());
            st.cfg.startBoard = fillEmpty(S.board.resize(st.cfg.startBoard, nr, ny, ""), pool, rng);
            st.cfg.endBoard = fillEmpty(S.board.resize(st.cfg.endBoard, nr, ny, ""), pool, rng);
            // 輪數變了，各輪節奏一定要重新產生；連線線型也要跟著盤面
            st.cfg.reels = S.generateReels(st.cfg);
            var kept = [];
            for (var i = 0; i < st.cfg.lines.length; i++) {
                if (LN.parsePattern(st.cfg.lines[i].pattern, nr, ny)) { kept.push(st.cfg.lines[i]); }
            }
            var dropped = st.cfg.lines.length - kept.length;
            st.cfg.lines = kept;
            rebuildGrid();
            refreshReelList();
            refreshLineList();
            persist();
            updatePlan();
            setStatus("盤面改為 " + nr + "×" + ny + "，已重新產生各輪節奏" + (dropped ? "，移除 " + dropped + " 條不符的連線" : ""));
        };

        btnRandom.onClick = function () {
            var pool = S.fillerPool(st.cfg);
            if (!pool.length) { setStatus("符號庫是空的"); return; }
            var L = st.cfg.layout;
            setCurrentBoard(S.board.randomize(L.reels, L.rows, pool, new S.Rng(randomSeed())));
        };

        btnFillAll.onClick = function () {
            if (!st.brush) { setStatus("請先選擇畫筆"); return; }
            var L = st.cfg.layout;
            setCurrentBoard(S.board.create(L.reels, L.rows, st.brush));
        };

        btnCopy.onClick = function () {
            if (st.editing === "start") { st.cfg.endBoard = U.clone(st.cfg.startBoard); }
            else { st.cfg.startBoard = U.clone(st.cfg.endBoard); }
            persist();
            setStatus(st.editing === "start" ? "已複製起始盤面 → 結果盤面" : "已複製結果盤面 → 起始盤面");
        };

        btnSwap.onClick = function () {
            var t = st.cfg.startBoard;
            st.cfg.startBoard = st.cfg.endBoard;
            st.cfg.endBoard = t;
            refreshCells();
            persist();
            setStatus("已互換起始 / 結果盤面");
        };

        // 多行文字對話框；onOk(text) 回傳錯誤陣列（空 = 成功）
        function textDialog(title, intro, text, extra, onOk) {
            var d = new Window("dialog", S.NAME + " - " + title);
            d.orientation = "column";
            d.alignChildren = ["fill", "top"];
            var t1 = d.add("statictext", undefined, intro, { multiline: true });
            t1.preferredSize.width = 420;
            var et = d.add("edittext", undefined, text, { multiline: true });
            et.preferredSize = [420, 160];
            if (extra) {
                var t2 = d.add("statictext", undefined, extra, { multiline: true });
                t2.preferredSize = [420, 40];
            }
            var gb = d.add("group");
            gb.alignment = "right";
            var ok = gb.add("button", undefined, "套用", { name: "ok" });
            gb.add("button", undefined, "取消", { name: "cancel" });
            ok.onClick = function () {
                var errs = onOk(et.text);
                if (errs.length) { alert(errs.join("\n"), S.NAME); return; }
                d.close(1);
            };
            return d.show();
        }

        btnText.onClick = function () {
            var L = st.cfg.layout;
            var which = st.editing === "start" ? "起始盤面" : "結果盤面";
            textDialog("文字編輯" + which,
                "每一行是一列（由上到下），每行 " + L.reels + " 個符號，共 " + L.rows + " 行。\n用空白分隔；名稱有空白時改用逗號或 Tab（可直接貼上試算表）。",
                S.board.toText(currentBoard(), L.rows),
                "可用符號：" + names().join("  "),
                function (text) {
                    var res = S.board.parseText(text, L.reels, L.rows, names());
                    if (!res.errors.length) { setCurrentBoard(res.board); }
                    return res.errors;
                });
        };

        // ================= 節奏 / 各輪事件 =================
        btnCTI.onClick = function () {
            var c = A.activeComp();
            if (!c) { alert("沒有作用中的合成", S.NAME); return; }
            st.cfg.spin.startTime = Math.round(c.time * c.frameRate) / c.frameRate;
            etStart.text = fmt(st.cfg.spin.startTime);
            persist();
            updatePlan();
            setStatus("開始時間 = " + fmt(st.cfg.spin.startTime) + " 秒（第 " + Math.round(c.time * c.frameRate) + " 格）");
        };

        btnApplyRhythm.onClick = function () {
            st.cfg.reels = S.generateReels(st.cfg);
            refreshReelList();
            persist();
            updatePlan();
            setStatus("已依快速節奏重新產生各輪");
        };

        btnSuggest.onClick = function () {
            var res = S.anticipation.apply(st.cfg);
            syncFields();
            refreshReelList();
            persist();
            updatePlan();
            setStatus(res.reels.length ? "期待輪：" + res.reels.join(", ") + "（已重新產生各輪）" : "這個結果盤面沒有需要期待的輪");
            alert(res.reasons.join("\n") || "沒有需要期待的輪", S.NAME);
        };

        reelList.onChange = function () { syncReelEditor(); };

        ddReelCurve.onChange = function () {
            var rs = selectedReels();
            if (!this.selection || !rs.length) { return; }
            var v = S.CURVE_KEYS[this.selection.index], diff = false;
            for (var i = 0; i < rs.length; i++) { if (rs[i].decelCurve !== v) { rs[i].decelCurve = v; diff = true; } }
            if (diff) { reelsEdited(); }
        };

        cbReelFrame.onClick = function () {
            var rs = selectedReels();
            for (var i = 0; i < rs.length; i++) {
                rs[i].frame = this.value;
                // 剛打開繞框時，預設從停輪前 1 秒開始
                if (this.value && !(rs[i].frameStart > 0 && rs[i].frameStart < rs[i].stop)) {
                    rs[i].frameStart = Math.max(0, Math.round((rs[i].stop - 1) * 100) / 100);
                }
            }
            reelsEdited();
        };

        btnSelAll.onClick = function () {
            var all = [];
            for (var i = 0; i < reelList.items.length; i++) { all.push(i); }
            selectIndices(reelList, all);
            syncReelEditor();
        };

        btnShift.onClick = function () {
            var rs = selectedReels();
            if (!rs.length) { return; }
            var v = prompt("把選取的 " + rs.length + " 輪時間平移幾秒？（負數 = 提早）", "0.1", S.NAME);
            if (v === null) { return; }
            var dt = parseFloat(v);
            if (isNaN(dt)) { return; }
            for (var i = 0; i < rs.length; i++) {
                rs[i].start = Math.max(0, Math.round((rs[i].start + dt) * 1000) / 1000);
                rs[i].stop = Math.max(0.05, Math.round((rs[i].stop + dt) * 1000) / 1000);
                if (rs[i].frame) { rs[i].frameStart = Math.max(0, Math.round((rs[i].frameStart + dt) * 1000) / 1000); }
            }
            reelsEdited();
        };

        // ================= 繞框 / 連線事件 =================
        function pickAsset(holder, idKey, nameKey, pathKey) {
            var found = A.selectedProjectSources();
            if (!found.length) { alert("請先在「專案」面板選取一個素材或合成", S.NAME); return false; }
            holder[idKey] = found[0].item.id;
            holder[nameKey] = found[0].item.name;
            holder[pathKey] = found[0].path || "";
            return true;
        }

        btnFrameAsset.onClick = function () {
            if (!pickAsset(st.cfg.frame, "itemId", "itemName", "path")) { return; }
            st.cfg.frame.source = "custom";
            syncFields();
            refreshAssets();
            persist();
        };
        ddFrameSrc.onChange = (function (orig) {
            return function () { orig.call(this); refreshAssets(); };
        })(ddFrameSrc.onChange);

        btnCellAsset.onClick = function () {
            if (!pickAsset(st.cfg.lineStyle, "cellItemId", "cellItemName", "cellPath")) { return; }
            st.cfg.lineStyle.cellSource = "custom";
            syncFields();
            refreshAssets();
            persist();
        };

        btnPaylines.onClick = function () {
            var L = st.cfg.layout;
            var cur = LN.paylines(st.cfg);
            textDialog("線型表",
                "每行一條線：寫每輪第幾列（1 = 最上面），共 " + L.reels + " 個數字。\n例：2 2 2 2 2 是中間直線、1 2 3 2 1 是 V 形。清空 = 用內建線型。",
                LN.paylinesToText(cur.lines), null,
                function (text) {
                    var old = st.cfg.lineSet.paylines;
                    st.cfg.lineSet.paylines = U.trim(text) === "" ? "" : text;
                    var chk = LN.paylines(st.cfg);
                    if (chk.errors.length) { st.cfg.lineSet.paylines = old; return chk.errors; }
                    persist();
                    setStatus("線型表：" + chk.lines.length + " 條");
                    return [];
                });
        };

        btnDetect.onClick = function () {
            var res = LN.detect(st.cfg);
            if (res.errors.length) { alert(res.errors.join("\n"), S.NAME); return; }
            if (!res.lines.length) { setStatus("結果盤面沒有偵測到連線"); return; }
            var lines = [], desc = [];
            for (var i = 0; i < res.lines.length; i++) {
                var d = S.lineDefaults();
                d.pattern = res.lines[i].pattern;
                d.count = res.lines[i].count;
                lines.push(d);
                desc.push("線 " + res.lines[i].payline + "：" + res.lines[i].symbol + "×" + res.lines[i].count);
            }
            st.cfg.lines = LN.applyTiming(lines, st.cfg.lineGen);
            refreshLineList();
            persist();
            updatePlan();
            setStatus("偵測到 " + lines.length + " 條連線：" + desc.join("、"));
        };

        btnAddLine.onClick = function () {
            var L = st.cfg.layout, d = S.lineDefaults(), p = [];
            for (var r = 0; r < L.reels; r++) { p.push(Math.floor((L.rows - 1) / 2) + 1); }
            d.pattern = p.join(",");
            d.count = L.reels;
            st.cfg.lines.push(d);
            LN.applyTiming(st.cfg.lines, st.cfg.lineGen);
            refreshLineList();
            selectIndices(lineList, [st.cfg.lines.length - 1]);
            syncLineEditor();
            persist();
            updatePlan();
        };

        btnDelLine.onClick = function () {
            var idx = selectedIndices(lineList);
            for (var i = idx.length - 1; i >= 0; i--) { st.cfg.lines.splice(idx[i], 1); }
            refreshLineList();
            persist();
            updatePlan();
        };

        lineList.onChange = function () { syncLineEditor(); };

        btnLineTiming.onClick = function () {
            if (!st.cfg.lines.length) { setStatus("還沒有連線"); return; }
            LN.applyTiming(st.cfg.lines, st.cfg.lineGen);
            refreshLineList(true);
            persist();
            updatePlan();
            setStatus("已重新排定 " + st.cfg.lines.length + " 條連線的顯示時間");
        };

        btnSeed.onClick = function () {
            st.cfg.spin.seed = Math.floor(Math.random() * 99999) + 1;
            etSeed.text = String(st.cfg.spin.seed);
            persist();
        };

        // ================= 主要動作 =================
        function report(res, verb) {
            if (res.errors.length) {
                alert(res.errors.join("\n"), S.NAME);
                setStatus(verb + "失敗");
                return;
            }
            var p = res.plan;
            setStatus(verb + "完成：" + res.boardComp.name + "（" + p.reels.length + " 輪、" + p.frames.length + " 個繞框、" +
                p.lines.length + " 條連線，演出到 " + fmt2(p.endTime + (res.boardLayer.startTime || 0)) + " 秒）");
            if (res.warnings.length) { alert(res.warnings.join("\n"), S.NAME); }
            refreshSymbols(selectedIndices(list));
            refreshAssets();
            persist();
        }

        btnBuild.onClick = function () {
            report(A.build(st.cfg, {}), "建立");
        };

        btnUpdate.onClick = function () {
            var lyr = A.selectedBoardLayer();
            if (!lyr) {
                alert("請在合成中選取一個由 " + S.NAME + " 建立的盤面圖層", S.NAME);
                return;
            }
            report(A.build(st.cfg, { boardLayer: lyr }), "更新");
        };

        btnLoad.onClick = function () {
            var lyr = A.selectedBoardLayer();
            var cfg = lyr ? A.readBoardConfig(lyr) : null;
            if (!cfg) {
                alert("請在合成中選取一個由 " + S.NAME + " 建立的盤面圖層", S.NAME);
                return;
            }
            st.cfg = cfg;
            syncAll();
            persist();
            setStatus("已讀取：" + lyr.source.name);
        };

        btnSave.onClick = function () {
            if (!canWriteFiles()) {
                alert("請先到 偏好設定 > 指令碼與運算式，勾選「允許指令碼寫入檔案及存取網路」", S.NAME);
                return;
            }
            var f = File.saveDialog("儲存 " + S.NAME + " 設定檔", jsonFilter());
            if (!f) { return; }
            if (!/\.json$/i.test(f.name)) { f = new File(f.fsName + ".json"); }
            f.encoding = "UTF-8";
            if (!f.open("w")) { alert("無法寫入：" + f.fsName, S.NAME); return; }
            f.write(S.json.stringify(st.cfg, 2));
            f.close();
            setStatus("已儲存：" + decodeURI(f.name));
        };

        btnOpen.onClick = function () {
            var f = File.openDialog("開啟 " + S.NAME + " 設定檔", jsonFilter());
            if (!f) { return; }
            f.encoding = "UTF-8";
            if (!f.open("r")) { alert("無法讀取：" + f.fsName, S.NAME); return; }
            var txt = f.read();
            f.close();
            var cfg;
            try { cfg = S.normalizeConfig(S.json.parse(txt)); } catch (e) {
                alert("設定檔格式錯誤：" + e.message, S.NAME);
                return;
            }
            // 設定檔可能來自別的專案：找不到的符號用檔案路徑重新匯入
            app.beginUndoGroup("SlotFakeSpin 讀取設定");
            try {
                for (var i = 0; i < cfg.symbols.length; i++) { A.resolveSymbol(cfg.symbols[i], true); }
            } finally { app.endUndoGroup(); }
            st.cfg = cfg;
            syncAll();
            persist();
            setStatus("已開啟：" + decodeURI(f.name));
        };

        // ================= 啟動 =================
        win.onResizing = win.onResize = function () {
            try { this.layout.resize(); } catch (e) { /* ignore */ }
        };
        tabs.selection = st.cfg.symbols.length ? tBoard : tSym;
        tabs.onChange = function () { updatePlan(); };
        refreshSymbols();
        rebuildGrid();
        refreshReelList();
        refreshLineList();
        refreshAssets();
        updatePlan();
        setStatus(st.cfg.symbols.length ? "就緒" : "第一步：到「符號」匯入老虎機符號圖檔");

        if (win instanceof Window) {
            win.center();
            win.show();
        } else {
            relayout();
        }
        UI.instance = { win: win, state: st };
        return UI.instance;
    };
})(SFS);
