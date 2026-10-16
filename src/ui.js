/*
 * SlotFakeSpin - ui.js
 * ScriptUI 面板（可停駐）：符號 / 盤面 / 節奏 / 各輪 / 繞框 / 連線 / 設定，以及建立、更新、讀取、存檔。
 */
(function (S) {
    var U = S.util, A = S.ae, LN = S.lines, T = S.t;
    var UI = S.ui = {};
    var SEC = "SlotFakeSpin", KEY_CFG = "lastConfig_v2", KEY_THUMB = "thumbs";
    var IS_MAC = (typeof $ !== "undefined" && $.os && $.os.indexOf("Mac") >= 0);
    // EffectCraft 的 ScriptUI 版面和 AE 不同：分頁內容不會讓開分頁列、多行文字不會自動換行、
    // 多欄 listbox 只顯示第一欄、不能換字型。以下遇到 IS_EC 的地方都是為了這些差異
    var IS_EC = (typeof $ !== "undefined" && /EffectCraft/i.test(String($.os)));
    var LINE_H = 16;
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

    UI.create = function (thisObj, opts) {
        opts = opts || {};
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

        function setStatus(msg) { setMultiline(status, msg, 330, true); }

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

        // 文字實際寬度（量不到就用字數估）
        function textWidth(ctrl, text) {
            if (!fakeMetric) {
                try {
                    var sz = ctrl.graphics.measureString(text);
                    if (sz && sz[0] > 0) { return Math.ceil(sz[0]); }
                } catch (e) { /* ignore */ }
            }
            // 估算：英數平均約 6.3px（寧可寬一點）、中日韓 13px（EffectCraft 介面字型 13px）
            var w = 0;
            text = String(text);
            for (var i = 0; i < text.length; i++) { w += text.charCodeAt(i) >= 0x2E80 ? 13 : 6.3; }
            return Math.ceil(w);
        }

        // EffectCraft 0.3.1 的 measureString 不看字形，一律「字數 × 7」
        var fakeMetric = false;
        if (IS_EC) {
            try {
                var mi = win.graphics.measureString("iiiiiiiiii"), mw = win.graphics.measureString("WWWWWWWWWW");
                fakeMetric = !mi || !mw || mi[0] === mw[0];
            } catch (e) { fakeMetric = true; }
        }

        // 版面寬度是照中文排的；其他語言文字比較長時自動撐開
        function fitWidth(ctrl, text, width, pad) {
            ctrl.preferredSize.width = S.lang === "zh" ? width : Math.max(width, textWidth(ctrl, text) + (pad || (IS_EC ? 10 : 6)));
            return ctrl;
        }

        function label(parent, text, width) {
            return fitWidth(parent.add("statictext", undefined, text), text, width || 56);
        }

        // 依寬度斷行：先照空白斷，一個字就超過寬度（例如中文）時逐字斷
        function wrapText(ctrl, text, width) {
            var paras = String(text).split("\n"), out = [];
            for (var i = 0; i < paras.length; i++) {
                var words = paras[i].split(" "), line = "";
                for (var j = 0; j < words.length; j++) {
                    var cand = j === 0 ? words[j] : line + " " + words[j];
                    if (j > 0 && line !== "" && textWidth(ctrl, cand) > width) {
                        out.push(line);
                        line = words[j];
                    } else {
                        line = cand;
                    }
                    while (line.length > 1 && textWidth(ctrl, line) > width) {
                        var k = line.length - 1;
                        while (k > 1 && textWidth(ctrl, line.substring(0, k)) > width) { k--; }
                        out.push(line.substring(0, k));
                        line = line.substring(k);
                    }
                }
                out.push(line);
            }
            return out;
        }

        // 多行文字：AE 會自己換行；EffectCraft 要自己斷行，fixedHeight 以外依行數撐開高度
        function setMultiline(ctrl, text, width, fixedHeight) {
            if (!IS_EC) { ctrl.text = text; return; }
            var lines = wrapText(ctrl, text, width);
            ctrl.text = lines.join("\n");
            if (!fixedHeight) { ctrl.preferredSize.height = lines.length * LINE_H; }
        }

        function hint(parent, text) {
            var t = parent.add("statictext", undefined, "", { multiline: true });
            t.preferredSize.width = 330;
            setMultiline(t, text, 330);
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
            et.helpTip = "#RRGGBB" + (opts.allowEmpty ? T("；空白 = 自動配色") : "");
            var btn = parent.add("button", undefined, T("選色"));
            fitWidth(btn, btn.text, 44, 16);
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
            return i >= 0 ? T(S.CURVE_LABELS[i]) : k;
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
                    g.drawString(plan && plan.errors.length ? "⚠ " + plan.errors[0] : T("（尚無節奏）"), textPen, 6, 6, font);
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
                    g.drawString(T("連線"), textPen, 2, ly + (rowH - 12) / 2, font);
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
            tl.helpTip = T("藍 = 轉動、淺藍 = 減速、白線 = 停輪、灰 = 回彈、橘框 = 繞框、彩色 = 連線顯示");
            st.timelines.push(tl);
            return tl;
        }

        // ================= 版面骨架 =================
        // 外層：「快速」三步做完；「進階」是原本的 7 個分頁
        var outer = win.add("tabbedpanel");
        outer.alignChildren = ["fill", "top"];
        var tQuick = outer.add("tab", undefined, T("快速"));
        var tAdv = outer.add("tab", undefined, T("進階"));
        tQuick.orientation = "column";
        tQuick.alignChildren = ["fill", "top"];
        tQuick.spacing = 6;
        tQuick.margins = IS_EC ? [8, 34, 8, 8] : [8, 10, 8, 8];
        tAdv.orientation = "column";
        tAdv.alignChildren = ["fill", "top"];
        tAdv.margins = IS_EC ? [4, 30, 4, 4] : [4, 6, 4, 4];
        var tabs = tAdv.add("tabbedpanel");
        tabs.alignChildren = ["fill", "top"];
        var tSym = tabs.add("tab", undefined, T("符號"));
        var tBoard = tabs.add("tab", undefined, T("盤面"));
        var tRhythm = tabs.add("tab", undefined, T("節奏"));
        var tReels = tabs.add("tab", undefined, T("各輪"));
        var tFrame = tabs.add("tab", undefined, T("繞框"));
        var tLines = tabs.add("tab", undefined, T("連線"));
        var tSet = tabs.add("tab", undefined, T("設定"));
        var allTabs = [tSym, tBoard, tRhythm, tReels, tFrame, tLines, tSet];
        for (var ti = 0; ti < allTabs.length; ti++) {
            allTabs[ti].orientation = "column";
            allTabs[ti].alignChildren = ["left", "top"];
            allTabs[ti].spacing = 5;
            allTabs[ti].margins = IS_EC ? [8, 34, 8, 8] : [8, 10, 8, 8];  // EffectCraft：讓開分頁列
        }

        // ================= 符號 =================
        var gSymBtns = row(tSym);
        var btnImport = gSymBtns.add("button", undefined, T("匯入資料夾…"));
        btnImport.helpTip = T("選一個資料夾，裡面的 PNG / JPG / PSD 等圖檔都會變成符號（檔名 = 符號名稱）");
        var btnAddSel = gSymBtns.add("button", undefined, T("加入專案選取"));
        btnAddSel.helpTip = T("把專案面板中選取的素材或合成（可做動態符號）加入符號庫");

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
        var btnFiller = gSymOps.add("button", undefined, T("切換填充"));
        btnFiller.helpTip = T("● = 轉動中會隨機出現的填充符號；○ = 只會出現在你指定的盤面上（例如不想被亂數帶出來的 Scatter / Bonus）");
        var btnRename = gSymOps.add("button", undefined, T("改名"));
        var btnRemove = gSymOps.add("button", undefined, T("移除"));
        var btnClear = gSymOps.add("button", undefined, T("清空"));
        hint(tSym, T("● 填充符號（轉動中隨機出現）  ○ 不當填充　雙擊可切換"));

        // ================= 盤面 =================
        var gSize = row(tBoard);
        label(gSize, T("輪數"), 30);
        var etReels = gSize.add("edittext", undefined, String(st.cfg.layout.reels));
        etReels.characters = 3;
        label(gSize, T("列數"), 30);
        var etRows = gSize.add("edittext", undefined, String(st.cfg.layout.rows));
        etRows.characters = 3;
        var btnSize = gSize.add("button", undefined, T("套用尺寸"));

        var gMode = row(tBoard);
        var rbStart = gMode.add("radiobutton", undefined, T("起始盤面"));
        var rbEnd = gMode.add("radiobutton", undefined, T("結果盤面"));
        rbStart.value = true;
        var cbThumbs = gMode.add("checkbox", undefined, T("縮圖"));
        cbThumbs.value = st.useThumbs;
        cbThumbs.helpTip = T("格子顯示符號縮圖（PNG / JPG）。如果畫面顯示異常可以關掉。");

        var gBrush = row(tBoard);
        label(gBrush, T("畫筆"), 30);
        var ddBrush = gBrush.add("dropdownlist", undefined, []);
        ddBrush.preferredSize.width = 150;

        var grid = tBoard.add("group");
        grid.orientation = "column";
        grid.alignChildren = ["left", "top"];
        grid.spacing = 2;
        grid.margins = [0, 4, 0, 4];

        var gOps = row(tBoard);
        var btnRandom = gOps.add("button", undefined, T("隨機"));
        var btnFillAll = gOps.add("button", undefined, T("全填畫筆"));
        var btnCopy = gOps.add("button", undefined, T("複製到另一盤"));
        var btnSwap = gOps.add("button", undefined, T("互換"));
        var gOps2 = row(tBoard);
        var btnText = gOps2.add("button", undefined, T("文字編輯…"));
        btnText.helpTip = T("用文字輸入盤面，可直接從 Excel / Google 試算表貼上");
        hint(tBoard, T("點格子 = 填入畫筆　Alt+點 = 吸取符號　Shift+點 = 整輪填入"));

        // ================= 節奏（快速產生） =================
        function regen() {
            if (st.cfg.spin.autoRhythm) { st.cfg.reels = S.generateReels(st.cfg); refreshReelList(); }
        }
        var rr1 = row(tRhythm);
        var etStart = numField(rr1, T("開始時間"), "spin", "startTime", T("秒"), { min: 0, tip: T("開始轉動的時間（目標合成的時間）。各輪的時間都從這裡起算") });
        var btnCTI = rr1.add("button", undefined, T("取目前時間"));
        var rr2 = row(tRhythm);
        textField(rr2, T("起轉順序"), "spin", "startOrder", { chars: 11, after: regen, tip: T("空白 = 1,2,3…。例：1,2,3,4,5 依序起轉；1+2+3+4+5 同時起轉") });
        numField(rr2, T("間隔"), "spin", "startStagger", T("秒"), { min: 0, labelWidth: 30, after: regen });
        var rr3 = row(tRhythm);
        textField(rr3, T("停輪順序"), "spin", "stopOrder", {
            chars: 11, after: regen,
            tip: T("逗號 = 先後，+ = 同時停。\n例：1,2,3,4,5（左到右）、5,4,3,2,1（右到左）、1+2+3,4,5（前三輪一起停）、3,2,4,1,5（從中間往外）")
        });
        var rr4 = row(tRhythm);
        numField(rr4, T("第一次停"), "spin", "firstStop", T("秒"), { min: 0.05, after: regen, tip: T("從開始到第一次停輪（停輪 = 衝到最遠點那一刻，可對齊音效）") });
        numField(rr4, T("每次間隔"), "spin", "stagger", T("秒"), { min: 0, labelWidth: 52, after: regen });
        var rr5 = row(tRhythm);
        textField(rr5, T("轉速"), "spin", "speeds", {
            chars: 14, after: regen,
            tip: T("格/秒。一個數字 = 全部一樣；列表 = 依停輪順序，例如 18,18,20,24,28（越後面停的轉越快）")
        });
        rr5.add("statictext", undefined, T("格/秒"));
        var rr6 = row(tRhythm);
        numField(rr6, T("減速"), "spin", "decelTime", T("秒"), { min: 0, after: regen, tip: T("停輪前的減速時間，越短停得越乾脆") });
        dropField(rr6, "", "spin", "decelCurve", S.CURVE_KEYS, S.tList(S.CURVE_LABELS), { after: regen });
        var rr7 = row(tRhythm);
        numField(rr7, T("停輪衝過"), "spin", "overshoot", T("格"), { min: 0, after: regen, tip: T("停輪時衝過定位的距離（0 = 不回彈）") });
        numField(rr7, T("回彈"), "spin", "bounceTime", T("秒"), { min: 0, labelWidth: 30, after: regen });
        var pAnt = section(tRhythm, T("期待（會繞框）"));
        var ra1 = row(pAnt);
        textField(ra1, T("期待輪"), "spin", "antReels", { chars: 7, after: regen, tip: T("例如 4,5：第 4、5 輪會延長轉動並繞框（聽牌）") });
        numField(ra1, T("每輪多轉"), "spin", "antTime", T("秒"), { min: 0, labelWidth: 52, after: regen, tip: T("會往後累加：第 4 輪多 0.8、第 5 輪再多 0.8") });
        var ra2 = row(pAnt);
        numField(ra2, T("繞框轉速"), "spin", "antSpeed", T("格/秒"), { min: 0, after: regen, tip: T("繞框開始後切換到的轉速，0 = 不變") });
        var ra3 = row(pAnt);
        numField(ra3, T("期待減速"), "spin", "antDecelTime", T("秒"), { min: 0, after: regen });
        dropField(ra3, "", "spin", "antCurve", S.CURVE_KEYS, S.tList(S.CURVE_LABELS), { after: regen });
        var pSug = section(tRhythm, T("期待感建議（依結果盤面自動判斷期待輪）"));
        var rs1 = row(pSug);
        textField(rs1, T("觸發符號"), "antRule", "symbols", { chars: IS_EC ? 16 : 9, tip: T("Scatter / Bonus 等觸發型符號，逗號分隔") });
        numField(rs1, "", "antRule", "count", T("顆觸發"), { min: 2, integer: true, chars: 2 });
        checkField(rs1, T("達標後續追"), "antRule", "after", { tip: T("已經觸發後，後面的輪還是期待（追第 4、5 顆）") });
        var rs2 = row(pSug);
        textField(rs2, T("聽牌符號"), "antRule", "tease", { chars: 9, tip: T("大獎符號（例如 SEVEN）：同一條線從第 1 輪連到第 N 輪時，下一輪期待。空白 = 不判斷") });
        numField(rs2, T("tease\u0004連"), "antRule", "teaseMin", T("輪後"), { min: 1, integer: true, chars: 2, labelWidth: 20 });
        var btnSuggest = rs2.add("button", undefined, T("期待感建議"));
        btnSuggest.helpTip = T("依「結果盤面」和「停輪順序」模擬玩家看到的過程，算出哪幾輪要期待，並重新產生各輪");
        var rr8 = row(tRhythm);
        var cbAuto = checkField(rr8, T("自動套用到各輪"), "spin", "autoRhythm", {
            after: regen, tip: T("勾選時，改上面的參數會立刻重新產生「各輪」表格。手動改過各輪後會自動取消勾選。")
        });
        var btnApplyRhythm = rr8.add("button", undefined, T("套用節奏"));
        addTimeline(tRhythm);
        var info = tRhythm.add("statictext", undefined, "", { multiline: true });
        info.preferredSize = [340, IS_EC ? 4 * LINE_H : 44];

        // ================= 各輪 =================
        // EffectCraft 的 listbox 只顯示第一欄：改成單欄、每列自帶欄位名稱
        var reelList = tReels.add("listbox", undefined, [], IS_EC ? { multiselect: true } : {
            multiselect: true, numberOfColumns: 8, showHeaders: true,
            columnTitles: [T("輪"), T("起轉"), T("停輪"), T("轉速"), T("減速"), T("衝過"), T("回彈"), T("繞框")],
            columnWidths: S.lang === "zh" ? [30, 40, 40, 40, 70, 36, 36, 60] : [30, 38, 38, 42, 70, 34, 44, 56]
        });
        reelList.preferredSize = IS_EC ? [430, 196] : [356, 130];
        var re1 = row(tReels);
        reelField(re1, T("起轉"), "start", T("秒"), { min: 0 });
        reelField(re1, T("停輪"), "stop", T("秒"), { min: 0.05, labelWidth: 30 });
        var re2 = row(tReels);
        reelField(re2, T("轉速"), "speed", T("格/秒"), { min: 0.1 });
        var re3 = row(tReels);
        reelField(re3, T("減速"), "decelTime", T("秒"), { min: 0 });
        var ddReelCurve = re3.add("dropdownlist", undefined, S.tList(S.CURVE_LABELS));
        ddReelCurve.selection = 0;
        var re4 = row(tReels);
        reelField(re4, T("停輪衝過"), "overshoot", T("格"), { min: 0 });
        reelField(re4, T("回彈"), "bounceTime", T("秒"), { min: 0, labelWidth: 30 });
        var re5 = row(tReels);
        var cbReelFrame = re5.add("checkbox", undefined, T("繞框"));
        reelField(re5, T("開始"), "frameStart", T("秒"), { min: 0, labelWidth: 30 });
        reelField(re5, T("轉速"), "frameSpeed", "", { min: 0, labelWidth: 30, tip: T("繞框開始後切換到的轉速（格/秒），0 = 不變") });
        var re6 = row(tReels);
        var btnSelAll = re6.add("button", undefined, T("全選"));
        var btnShift = re6.add("button", undefined, T("整體平移…"));
        btnShift.helpTip = T("把選取輪的起轉 / 停輪 / 繞框時間一起往前或往後移");
        hint(tReels, T("時間都從「開始時間」算起（秒）。可多選一起改。"));
        addTimeline(tReels);

        // ================= 繞框 =================
        var fr1 = row(tFrame);
        var ddFrameSrc = dropField(fr1, T("素材"), "frame", "source", ["builtin", "custom"], [T("內建跑燈框"), T("自訂素材")]);
        var btnFrameAsset = fr1.add("button", undefined, T("指定選取"));
        btnFrameAsset.helpTip = T("在專案面板選一個素材或合成（你自己的繞框動畫），按這裡指定");
        var stFrameAsset = tFrame.add("statictext", undefined, "");
        stFrameAsset.preferredSize.width = 330;
        var fr2 = row(tFrame);
        colorField(fr2, T("顏色"), function () { return st.cfg.frame; }, "color");
        numField(fr2, T("線寬"), "frame", "width", "px", { min: 1, labelWidth: 30 });
        var fr3 = row(tFrame);
        numField(fr3, T("外擴"), "frame", "pad", "px", { min: -100, tip: T("框比轉輪大多少（每邊）") });
        numField(fr3, T("跑燈"), "frame", "laps", T("圈/秒"), { min: 0, labelWidth: 30 });
        var fr4 = row(tFrame);
        numField(fr4, T("跑燈長度"), "frame", "runner", "%", { min: 1, max: 100 });
        checkField(fr4, T("光暈"), "frame", "glow");
        var fr5 = row(tFrame);
        numField(fr5, T("淡入淡出"), "frame", "fade", T("秒"), { min: 0 });
        numField(fr5, T("停後保留"), "frame", "hold", T("秒"), { min: 0, labelWidth: 52 });
        hint(tFrame, T("哪幾輪要繞框、什麼時候開始：在「節奏」設定期待輪，或在「各輪」逐輪勾選「繞框」並設定開始時間。繞框會在該輪停妥後結束。"));

        // ================= 連線 =================
        var ln1 = row(tLines);
        var btnPaylines = ln1.add("button", undefined, T("線型表…"));
        btnPaylines.helpTip = T("每行一條線，寫每輪第幾列（1 = 最上面），例如 2 2 2 2 2");
        textField(ln1, T("百搭"), "lineSet", "wilds", { chars: 6, labelWidth: 30, tip: T("可代替任何符號，逗號分隔") });
        numField(ln1, T("最少"), "lineSet", "minCount", T("min\u0004連"), { min: 1, integer: true, chars: 2, labelWidth: 30 });
        var ln1b = row(tLines);
        textField(ln1b, T("不算連線"), "lineSet", "exclude", { chars: IS_EC ? 18 : 12, tip: T("這些符號不會算成連線（例如 SCATTER），逗號分隔") });
        var ln2 = row(tLines);
        var btnDetect = ln2.add("button", undefined, T("從結果盤面偵測"));
        var btnAddLine = ln2.add("button", undefined, T("新增"));
        var btnDelLine = ln2.add("button", undefined, T("刪除"));
        var lineList = tLines.add("listbox", undefined, [], IS_EC ? { multiselect: true } : {
            multiselect: true, numberOfColumns: 4, showHeaders: true,
            columnTitles: ["#", T("線型"), T("count\u0004連"), T("顯示（停妥後 開始+長度）")],
            columnWidths: [26, 84, 26, 200]
        });
        lineList.preferredSize = [IS_EC ? 430 : 356, 100];
        var le1 = row(tLines);
        var etLinePattern = lineField(le1, T("線型"), "pattern", { chars: 12, tip: T("每輪第幾列（1 = 最上面），例如 1,2,3,2,1。\n0 = 這輪不框：2,0,1,0,2 = 只框 3 顆 Scatter、不畫線") });
        var etLineCount = lineField(le1, T("count\u0004連"), "count", { chars: 2, labelWidth: 20, integer: true });
        var cbBoxOnly = le1.add("checkbox", undefined, T("只框"));
        cbBoxOnly.helpTip = T("只框格子、不畫線（Scatter 這類不靠連線的中獎）");
        var le2 = row(tLines);
        var etLineShows = lineField(le2, T("顯示"), "shows", { chars: 22, tip: T("停妥後幾秒開始 + 顯示幾秒，可以多段：0.3+1.2, 2.5+0.9") });
        var le3 = row(tLines);
        var lineColorEt = colorField(le3, T("顏色"), function () { return selectedLine() || { color: "" }; }, "color", {
            allowEmpty: true, after: function () { refreshLineList(); }
        });
        var pLineTime = section(tLines, T("顯示時間"));
        var lt1 = row(pLineTime);
        numField(lt1, T("停妥後"), "lineGen", "delay", T("秒"), { min: 0, labelWidth: 40 });
        dropField(lt1, "", "lineGen", "mode", S.LINE_MODES, S.tList(S.LINE_MODE_LABELS));
        var lt2 = row(pLineTime);
        numField(lt2, T("全部"), "lineGen", "allTime", T("秒"), { min: 0.05, labelWidth: 30 });
        numField(lt2, T("每條"), "lineGen", "eachTime", T("秒"), { min: 0.05, labelWidth: 30 });
        numField(lt2, T("間隔"), "lineGen", "gap", "", { min: 0, labelWidth: 30 });
        var btnLineTiming = pLineTime.add("button", undefined, T("套用到全部連線"));
        var pLineStyle = section(tLines, T("樣式"));
        var ls1 = row(pLineStyle);
        numField(ls1, T("線寬"), "lineStyle", "width", "px", { min: 1, labelWidth: 30 });
        numField(ls1, T("畫線"), "lineStyle", "drawTime", T("秒"), { min: 0, labelWidth: 30 });
        checkField(ls1, T("畫滿"), "lineStyle", "full", { tip: T("勾選 = 線畫滿整個盤面；不勾 = 只畫中獎的那幾格") });
        var ls2 = row(pLineStyle);
        checkField(ls2, T("中獎框"), "lineStyle", "boxes");
        numField(ls2, T("框寬"), "lineStyle", "boxWidth", "", { min: 1, labelWidth: 30, chars: 3 });
        numField(ls2, T("跳動"), "lineStyle", "pulse", "%", { min: 100, labelWidth: 30, chars: 4, tip: T("中獎符號放大到幾 %，100 = 不跳") });
        checkField(ls2, T("光暈"), "lineStyle", "glow");
        var ls3 = row(pLineStyle);
        dropField(ls3, T("中獎格"), "lineStyle", "cellSource", ["builtin", "custom"], [T("內建框"), T("自訂素材")], { labelWidth: 40 });
        var btnCellAsset = ls3.add("button", undefined, T("指定選取"));
        var stCellAsset = pLineStyle.add("statictext", undefined, "");
        stCellAsset.preferredSize.width = 320;

        // ================= 設定 =================
        var pLang = section(tSet, T("介面語言"));
        var lg1 = row(pLang);
        // 「繁體中文」不翻譯：介面是英文時也認得出來
        var ddLang = lg1.add("dropdownlist", undefined, [T("自動"), "繁體中文", "English"]);
        ddLang.selection = Math.max(0, U.indexOf(S.LANGS, A.langPref()));
        ddLang.helpTip = T("自動：中文版 AE 用繁體中文；EffectCraft 和其他語言的 AE 用英文。切換後面板會重新建立，設定不會遺失。");
        ddLang.onChange = function () {
            if (!this.selection) { return; }
            var v = S.LANGS[this.selection.index];
            if (v === A.langPref()) { return; }
            A.setLangPref(v);
            A.initLang();
            rebuild();
        };
        var pLayout = section(tSet, T("版面"));
        var l1 = row(pLayout);
        numField(l1, T("格寬"), "layout", "cellW", "px", { min: 4, integer: true, labelWidth: 40 });
        numField(l1, T("格高"), "layout", "cellH", "px", { min: 4, integer: true, labelWidth: 30 });
        var l2 = row(pLayout);
        numField(l2, T("輪距"), "layout", "gapX", "px", { min: 0, integer: true, labelWidth: 40, tip: T("輪與輪之間的水平間距") });
        numField(l2, T("列距"), "layout", "gapY", "px", { min: 0, integer: true, labelWidth: 30, tip: T("同一輪上下符號的間距") });
        var l3 = row(pLayout);
        numField(l3, T("上下露出"), "layout", "peek", "px", { min: 0, integer: true, tip: T("轉輪視窗上下多露出的高度（看得到半顆相鄰符號）") });
        numField(l3, T("留白"), "layout", "margin", "px", { min: 0, integer: true, labelWidth: 30, tip: T("盤面合成四周留白，給繞框 / 連線光暈用") });
        var l4 = row(pLayout);
        dropField(l4, T("符號縮放"), "layout", "scaleMode", ["fit", "none"], [T("符合格子"), T("原始尺寸")]);
        numField(l4, "", "layout", "symbolScale", "%", { min: 1 });
        var l5 = row(pLayout);
        dropField(l5, T("輸出到"), "layout", "target", ["active", "new"], [T("目前合成"), T("新建合成")]);
        numField(l5, T("新合成"), "layout", "newCompFps", "fps", { min: 1, max: 120, labelWidth: 40 });
        var pFeel = section(tSet, T("手感"));
        var f1 = row(pFeel);
        numField(f1, T("起轉拉回"), "spin", "windupDist", T("格"), { min: 0, tip: T("開始前先反方向拉一點（0 = 不拉回）") });
        numField(f1, "", "spin", "windupTime", T("秒"), { min: 0 });
        var f2 = row(pFeel);
        numField(f2, T("加速時間"), "spin", "accelTime", T("秒"), { min: 0 });
        numField(f2, T("變速過渡"), "spin", "speedRamp", T("秒"), { min: 0, labelWidth: 52, tip: T("切換到繞框轉速的過渡時間") });
        var f3 = row(pFeel);
        dropField(f3, T("方向"), "spin", "direction", ["down", "up"], [T("向下"), T("向上")]);
        var etSeed = numField(f3, T("亂數種子"), "spin", "seed", "", { min: 1, integer: true, chars: 6, labelWidth: 52, tip: T("決定轉動中填充符號的排列，同一個種子結果相同") });
        var btnSeed = f3.add("button", undefined, T("換"));
        fitWidth(btnSeed, btnSeed.text, 30, IS_EC ? 28 : 16);
        var f4 = row(pFeel);
        checkField(f4, T("動態模糊"), "spin", "motionBlur");
        numField(f4, T("快門角度"), "spin", "shutterAngle", "", { min: 0, max: 720, integer: true, labelWidth: 52 });

        // ================= 快速 =================
        var pQ1 = section(tQuick, T("① 符號"));
        var q1 = row(pQ1);
        var qImport = q1.add("button", undefined, T("匯入符號資料夾…"));
        qImport.helpTip = T("選一個資料夾，裡面的 PNG / JPG / PSD 等圖檔都會變成符號（檔名 = 符號名稱）");
        var qAddSel = q1.add("button", undefined, T("加入專案中選取的素材"));
        qAddSel.helpTip = T("把專案面板中選取的素材或合成（可做動態符號）加入符號庫");
        var qSymInfo = pQ1.add("statictext", undefined, "", { multiline: true });
        qSymInfo.preferredSize = [330, 2 * LINE_H];

        var pQ2 = section(tQuick, T("② 結果盤面"));
        var qBoard = pQ2.add("statictext", undefined, "", { multiline: true });
        qBoard.preferredSize = [330, 4 * LINE_H];
        var q2 = row(pQ2);
        var qText = q2.add("button", undefined, T("文字輸入結果盤面…"));
        qText.helpTip = T("用文字輸入盤面，可直接從 Excel / Google 試算表貼上");
        var qPaint = q2.add("button", undefined, T("點格子畫…"));
        qPaint.helpTip = T("到「進階 > 盤面」用畫筆點格子");
        var q3 = row(pQ2);
        var qStartInfo = q3.add("statictext", undefined, T("起始盤面：自動（不會中、不先期待）"));
        var qReroll = q3.add("button", undefined, T("換一個"));

        var pQ3 = section(tQuick, T("③ 演出"));
        var q4 = row(pQ3);
        var ddRecipe = q4.add("dropdownlist", undefined, S.tList(S.RECIPE_LABELS));
        ddRecipe.selection = Math.max(0, U.indexOf(S.RECIPE_KEYS, st.cfg.quick.recipe));
        ddRecipe.helpTip = T("一般轉：不期待。觸發：差一顆就開始期待、繞框，最後一輪再多拖一點，中了框住觸發符號。期待落空：一樣期待但最後沒中。大獎聽牌：同一條線連到一半就期待下一輪。快速轉：Turbo 節奏。");
        var q5 = row(pQ3);
        textField(q5, T("觸發符號"), "antRule", "symbols", { chars: IS_EC ? 16 : 12, after: applyQuick, tip: T("Scatter / Bonus 等觸發型符號，逗號分隔") });
        numField(q5, "", "antRule", "count", T("顆觸發"), { min: 1, integer: true, chars: 2, after: applyQuick });
        var q6 = row(pQ3);
        textField(q6, T("聽牌符號"), "antRule", "tease", { chars: IS_EC ? 16 : 12, after: applyQuick, tip: T("大獎符號（例如 SEVEN）：同一條線從第 1 輪連到第 N 輪時，下一輪期待。空白 = 不判斷") });
        var q7 = row(pQ3);
        numField(q7, T("開始時間"), "spin", "startTime", T("秒"), { min: 0, tip: T("開始轉動的時間（目標合成的時間）。各輪的時間都從這裡起算") });
        var qCTI = q7.add("button", undefined, T("取目前時間"));
        var qSummary = pQ3.add("statictext", undefined, "", { multiline: true });
        qSummary.preferredSize = [330, (IS_EC ? 5 : 4) * LINE_H];
        addTimeline(pQ3);
        hint(tQuick, T("最後按下方「▶ 建立假轉」。要細調節奏、繞框、連線樣式，到「進階」。"));

        // ================= 底部動作 =================
        var gAct = row(win);
        gAct.alignChildren = ["fill", "center"];
        var btnBuild = gAct.add("button", undefined, T("▶ 建立假轉"));
        btnBuild.helpTip = T("在目前合成（或新合成）建立轉輪動畫、繞框與連線");
        var btnUpdate = gAct.add("button", undefined, T("更新選取盤面"));
        btnUpdate.helpTip = T("選取之前建立的盤面圖層，用目前設定重建（保留圖層位置 / 特效）");
        var gAct2 = row(win);
        var btnLoad = gAct2.add("button", undefined, T("讀取選取盤面"));
        btnLoad.helpTip = T("把選取盤面圖層當時的設定讀回面板");
        var btnSave = gAct2.add("button", undefined, T("存設定…"));
        var btnOpen = gAct2.add("button", undefined, T("開設定…"));
        var status = win.add("statictext", undefined, "", { multiline: true });
        status.preferredSize = [340, IS_EC ? 3 * LINE_H : 32];

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
                setStatus(T("已手動調整各輪；「節奏」頁改為按「套用節奏」才會覆蓋"));
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
                var cols = [fmt2(R.start), fmt2(R.stop), fmt(R.speed), fmt2(R.decelTime) + " " + curveLabel(R.decelCurve),
                    fmt2(R.overshoot), fmt2(R.bounceTime), R.frame ? T("從 {0}{1}", fmt2(R.frameStart), R.frameSpeed > 0 ? " @" + fmt(R.frameSpeed) : "") : "-"];
                if (IS_EC) {
                    reelList.add("item", T("R{0}  {1} → {2} 秒   轉速 {3}   減速 {4}\n      衝過 {5}   回彈 {6}   繞框 {7}",
                        i + 1, cols[0], cols[1], cols[2], cols[3], cols[4], cols[5], cols[6]));
                    continue;
                }
                var it = reelList.add("item", "R" + (i + 1));
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
            lineColorEt.enabled = cbBoxOnly.enabled = !!ln;
            cbBoxOnly.value = !!(ln && ln.boxOnly);
        }

        function refreshLineList(keepSel) {
            var keep = keepSel ? selectedIndices(lineList) : [];
            lineList.removeAll();
            for (var i = 0; i < st.cfg.lines.length; i++) {
                var ln = st.cfg.lines[i];
                var hl = ln.boxOnly || /(^|[\s,])[0-]([\s,]|$)/.test(ln.pattern);
                var cols = [ln.pattern, hl ? T("框") : String(ln.count), ln.shows];
                if (IS_EC) {
                    lineList.add("item", T("{0}.  {1}   {2}   顯示 {3}", i + 1, cols[0], hl ? T("只框") : T("連 {0}", ln.count), cols[2]));
                    continue;
                }
                var it = lineList.add("item", String(i + 1));
                for (var c = 0; c < cols.length; c++) {
                    try { it.subItems[c].text = cols[c]; } catch (e) { /* 單欄 listbox */ }
                }
            }
            selectIndices(lineList, keep.length ? keep : (st.cfg.lines.length ? [0] : []));
            syncLineEditor();
        }

        function assetLabel(holder, idKey, nameKey) {
            if (!holder[nameKey] && !holder[idKey]) { return T("（尚未指定）"); }
            var it = null;
            try { it = A.itemById(holder[idKey]); } catch (e) { it = null; }
            return (it ? T("素材：") : T("素材（找不到）：")) + holder[nameKey];
        }

        function refreshAssets() {
            stFrameAsset.text = st.cfg.frame.source === "custom" ? assetLabel(st.cfg.frame, "itemId", "itemName") : T("內建：圓角框 + 兩道跑燈 + 光暈");
            stCellAsset.text = st.cfg.lineStyle.cellSource === "custom" ? assetLabel(st.cfg.lineStyle, "cellItemId", "cellItemName") : "";
        }

        // ================= 刷新 =================
        function symbolLabel(e) {
            return (e.filler ? "● " : "○ ") + e.name + (st.missing[e.name] ? T("  (遺失)") : "");
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
            setStatus(T("畫筆：{0}", name));
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
                    b.helpTip = T("第 {0} 輪 第 {1} 列：{2}", r + 1, y + 1, name || T("（空）"));
                    if (st.useThumbs) { redraw(b); }
                }
            }
        }

        function updatePlan() {
            var plan = null;
            try { plan = S.computePlan(st.cfg, currentFps(), { fillerPool: ["?"] }); } catch (e) { plan = null; }
            st.plan = plan;
            for (var i = 0; i < st.timelines.length; i++) { redraw(st.timelines[i]); }
            refreshQuick();
            if (!plan) { info.text = ""; return; }
            if (plan.errors.length) { setMultiline(info, "⚠ " + plan.errors[0], 340, true); return; }
            var stops = [], maxV = 0;
            for (i = 0; i < plan.reels.length; i++) {
                stops.push("R" + (plan.reels[i].index + 1) + " " + fmt2(plan.reels[i].stopTime - plan.startTime));
                maxV = Math.max(maxV, plan.reels[i].speed / plan.pitch);
            }
            var txt = T("停輪(秒)：{0}\n全部停妥 {1} 秒、演出結束 {2} 秒（@{3}fps，最高 {4} 格/秒）", stops.join("  "), fmt2(plan.allSettled - plan.startTime), fmt2(plan.endTime - plan.startTime), fmt(plan.fps), fmt(Math.round(maxV * 10) / 10));
            if (plan.warnings.length) { txt += "\n⚠ " + plan.warnings[0]; }
            setMultiline(info, txt, 340, true);
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
            var folder = Folder.selectDialog(T("選擇老虎機符號（圖騰）圖檔所在的資料夾"));
            if (!folder) { return; }
            app.beginUndoGroup(T("SlotFakeSpin 匯入符號"));
            var res;
            try { res = A.importFolder(folder); } finally { app.endUndoGroup(); }
            if (!res.symbols.length && !res.failed.length) {
                alert(T("這個資料夾裡沒有可用的圖檔（PNG / JPG / PSD / TGA / TIFF …）"), S.NAME);
                return;
            }
            var added = addSymbols(res.symbols);
            setStatus(T("匯入 {0} 個圖檔，新增 {1} 個符號", res.symbols.length, added));
            if (res.failed.length) { alert(T("以下檔案無法匯入：\n{0}", res.failed.join("\n")), S.NAME); }
        };

        btnAddSel.onClick = function () {
            var found = A.selectedProjectSources();
            if (!found.length) {
                alert(T("請先在「專案」面板選取素材或合成"), S.NAME);
                return;
            }
            var added = addSymbols(found);
            setStatus(T("新增 {0} 個符號", added));
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
            if (idx.length !== 1) { alert(T("請選一個符號"), S.NAME); return; }
            var e = st.cfg.symbols[idx[0]];
            var nn = prompt(T("新的符號名稱（文字編輯盤面時使用，建議簡短，例如 WILD、A、7）"), e.name, S.NAME);
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
            if (!confirm(T("移除 {0} 個符號？盤面上使用到它們的格子會清空。", idx.length), false, S.NAME)) { return; }
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
            if (!confirm(T("清空整個符號庫與兩個盤面？（專案裡已匯入的素材不會被刪除）"), false, S.NAME)) { return; }
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
            if (!st.brush) { setStatus(T("請先匯入符號並選擇畫筆")); return; }
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
                if (LN.parsePattern(st.cfg.lines[i].pattern, nr, ny, true)) { kept.push(st.cfg.lines[i]); }
            }
            var dropped = st.cfg.lines.length - kept.length;
            st.cfg.lines = kept;
            rebuildGrid();
            refreshReelList();
            refreshLineList();
            persist();
            updatePlan();
            setStatus(T("盤面改為 {0}×{1}，已重新產生各輪節奏{2}", nr, ny, dropped ? T("，移除 {0} 條不符的連線", dropped) : ""));
        };

        btnRandom.onClick = function () {
            var pool = S.fillerPool(st.cfg);
            if (!pool.length) { setStatus(T("符號庫是空的")); return; }
            var L = st.cfg.layout;
            setCurrentBoard(S.board.randomize(L.reels, L.rows, pool, new S.Rng(randomSeed())));
        };

        btnFillAll.onClick = function () {
            if (!st.brush) { setStatus(T("請先選擇畫筆")); return; }
            var L = st.cfg.layout;
            setCurrentBoard(S.board.create(L.reels, L.rows, st.brush));
        };

        btnCopy.onClick = function () {
            if (st.editing === "start") { st.cfg.endBoard = U.clone(st.cfg.startBoard); }
            else { st.cfg.startBoard = U.clone(st.cfg.endBoard); }
            persist();
            setStatus(st.editing === "start" ? T("已複製起始盤面 → 結果盤面") : T("已複製結果盤面 → 起始盤面"));
        };

        btnSwap.onClick = function () {
            var t = st.cfg.startBoard;
            st.cfg.startBoard = st.cfg.endBoard;
            st.cfg.endBoard = t;
            refreshCells();
            persist();
            setStatus(T("已互換起始 / 結果盤面"));
        };

        // 多行文字對話框；onOk(text) 回傳錯誤陣列（空 = 成功）
        function textDialog(title, intro, text, extra, onOk) {
            var d = new Window("dialog", S.NAME + " - " + title);
            d.orientation = "column";
            d.alignChildren = ["fill", "top"];
            var t1 = d.add("statictext", undefined, "", { multiline: true });
            t1.preferredSize.width = 420;
            setMultiline(t1, intro, 420);
            var et = d.add("edittext", undefined, text, { multiline: true });
            et.preferredSize = [420, 160];
            if (extra) {
                var t2 = d.add("statictext", undefined, "", { multiline: true });
                t2.preferredSize = [420, 40];
                setMultiline(t2, extra, 420);
            }
            var gb = d.add("group");
            gb.alignment = "right";
            var ok = gb.add("button", undefined, T("套用"), { name: "ok" });
            gb.add("button", undefined, T("取消"), { name: "cancel" });
            ok.onClick = function () {
                var errs = onOk(et.text);
                if (errs.length) { alert(errs.join("\n"), S.NAME); return; }
                d.close(1);
            };
            return d.show();
        }

        btnText.onClick = function () {
            var L = st.cfg.layout;
            var which = st.editing === "start" ? T("起始盤面") : T("結果盤面");
            textDialog(T("文字編輯{0}", which),
                T("每一行是一列（由上到下），每行 {0} 個符號，共 {1} 行。\n用空白分隔；名稱有空白時改用逗號或 Tab（可直接貼上試算表）。", L.reels, L.rows),
                S.board.toText(currentBoard(), L.rows),
                T("可用符號：{0}", names().join("  ")),
                function (text) {
                    var res = S.board.parseText(text, L.reels, L.rows, names());
                    if (!res.errors.length) { setCurrentBoard(res.board); }
                    return res.errors;
                });
        };

        // ================= 節奏 / 各輪事件 =================
        btnCTI.onClick = function () {
            var c = A.activeComp();
            if (!c) { alert(T("沒有作用中的合成"), S.NAME); return; }
            st.cfg.spin.startTime = Math.round(c.time * c.frameRate) / c.frameRate;
            etStart.text = fmt(st.cfg.spin.startTime);
            persist();
            updatePlan();
            setStatus(T("開始時間 = {0} 秒（第 {1} 格）", fmt(st.cfg.spin.startTime), Math.round(c.time * c.frameRate)));
        };

        btnApplyRhythm.onClick = function () {
            st.cfg.reels = S.generateReels(st.cfg);
            refreshReelList();
            persist();
            updatePlan();
            setStatus(T("已依快速節奏重新產生各輪"));
        };

        btnSuggest.onClick = function () {
            var res = S.anticipation.apply(st.cfg);
            syncFields();
            refreshReelList();
            persist();
            updatePlan();
            setStatus(res.reels.length ? T("期待輪：{0}（已重新產生各輪）", res.reels.join(", ")) : T("這個結果盤面沒有需要期待的輪"));
            alert(res.reasons.join("\n") || T("沒有需要期待的輪"), S.NAME);
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
            var v = prompt(T("把選取的 {0} 輪時間平移幾秒？（負數 = 提早）", rs.length), "0.1", S.NAME);
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
            if (!found.length) { alert(T("請先在「專案」面板選取一個素材或合成"), S.NAME); return false; }
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
            textDialog(T("線型表"),
                T("每行一條線：寫每輪第幾列（1 = 最上面），共 {0} 個數字。\n例：2 2 2 2 2 是中間直線、1 2 3 2 1 是 V 形。清空 = 用內建線型。", L.reels),
                LN.paylinesToText(cur.lines), null,
                function (text) {
                    var old = st.cfg.lineSet.paylines;
                    st.cfg.lineSet.paylines = U.trim(text) === "" ? "" : text;
                    var chk = LN.paylines(st.cfg);
                    if (chk.errors.length) { st.cfg.lineSet.paylines = old; return chk.errors; }
                    persist();
                    setStatus(T("線型表：{0} 條", chk.lines.length));
                    return [];
                });
        };

        btnDetect.onClick = function () {
            var res = LN.detect(st.cfg);
            if (res.errors.length) { alert(res.errors.join("\n"), S.NAME); return; }
            if (!res.lines.length) { setStatus(T("結果盤面沒有偵測到連線")); return; }
            var lines = [], desc = [];
            for (var i = 0; i < res.lines.length; i++) {
                var d = S.lineDefaults();
                d.pattern = res.lines[i].pattern;
                d.count = res.lines[i].count;
                d.boxOnly = !!res.lines[i].boxOnly;
                lines.push(d);
                desc.push((res.lines[i].scatter ? "" : T("線 {0}：", res.lines[i].payline)) + res.lines[i].symbol + "×" + res.lines[i].count);
            }
            st.cfg.lines = LN.applyTiming(lines, st.cfg.lineGen);
            refreshLineList();
            persist();
            updatePlan();
            setStatus(T("偵測到 {0} 條連線：{1}", lines.length, desc.join(T("、"))));
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

        cbBoxOnly.onClick = function () {
            var idx = selectedIndices(lineList);
            for (var i = 0; i < idx.length; i++) { st.cfg.lines[idx[i]].boxOnly = this.value; }
            refreshLineList(true);
            persist();
            updatePlan();
        };

        btnLineTiming.onClick = function () {
            if (!st.cfg.lines.length) { setStatus(T("還沒有連線")); return; }
            LN.applyTiming(st.cfg.lines, st.cfg.lineGen);
            refreshLineList(true);
            persist();
            updatePlan();
            setStatus(T("已重新排定 {0} 條連線的顯示時間", st.cfg.lines.length));
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
                setStatus(T("{0}失敗", verb));
                return;
            }
            var p = res.plan;
            setStatus(T("{0}完成：{1}（{2} 輪、{3} 個繞框、{4} 條連線，演出到 {5} 秒）", verb, res.boardComp.name, p.reels.length, p.frames.length, p.lines.length, fmt2(p.endTime + (res.boardLayer.startTime || 0))));
            if (res.warnings.length) { alert(res.warnings.join("\n"), S.NAME); }
            refreshSymbols(selectedIndices(list));
            refreshAssets();
            persist();
        }

        btnBuild.onClick = function () {
            report(A.build(st.cfg, {}), T("建立"));
        };

        btnUpdate.onClick = function () {
            var lyr = A.selectedBoardLayer();
            if (!lyr) {
                alert(T("請在合成中選取一個由 {0} 建立的盤面圖層", S.NAME), S.NAME);
                return;
            }
            report(A.build(st.cfg, { boardLayer: lyr }), T("更新"));
        };

        btnLoad.onClick = function () {
            var lyr = A.selectedBoardLayer();
            var cfg = lyr ? A.readBoardConfig(lyr) : null;
            if (!cfg) {
                alert(T("請在合成中選取一個由 {0} 建立的盤面圖層", S.NAME), S.NAME);
                return;
            }
            st.cfg = cfg;
            syncAll();
            persist();
            setStatus(T("已讀取：{0}", lyr.source.name));
        };

        btnSave.onClick = function () {
            if (!canWriteFiles()) {
                alert(T("請先到 偏好設定 > 指令碼與運算式，勾選「允許指令碼寫入檔案及存取網路」"), S.NAME);
                return;
            }
            var f = File.saveDialog(T("儲存 {0} 設定檔", S.NAME), jsonFilter());
            if (!f) { return; }
            if (!/\.json$/i.test(f.name)) { f = new File(f.fsName + ".json"); }
            f.encoding = "UTF-8";
            if (!f.open("w")) { alert(T("無法寫入：{0}", f.fsName), S.NAME); return; }
            f.write(S.json.stringify(st.cfg, 2));
            f.close();
            setStatus(T("已儲存：{0}", decodeURI(f.name)));
        };

        btnOpen.onClick = function () {
            var f = File.openDialog(T("開啟 {0} 設定檔", S.NAME), jsonFilter());
            if (!f) { return; }
            f.encoding = "UTF-8";
            if (!f.open("r")) { alert(T("無法讀取：{0}", f.fsName), S.NAME); return; }
            var txt = f.read();
            f.close();
            var cfg;
            try { cfg = S.absolutizePaths(S.normalizeConfig(S.json.parse(txt)), f.parent.fsName); } catch (e) {
                alert(T("設定檔格式錯誤：{0}", e.message), S.NAME);
                return;
            }
            // 設定檔可能來自別的專案：找不到的符號用檔案路徑重新匯入
            app.beginUndoGroup(T("SlotFakeSpin 讀取設定"));
            try {
                for (var i = 0; i < cfg.symbols.length; i++) { A.resolveSymbol(cfg.symbols[i], true); }
            } finally { app.endUndoGroup(); }
            st.cfg = cfg;
            syncAll();
            persist();
            setStatus(T("已開啟：{0}", decodeURI(f.name)));
        };

        // ================= 啟動 =================
        win.onResizing = win.onResize = function () {
            try { this.layout.resize(); } catch (e) { /* ignore */ }
        };
        // ================= 快速頁事件 =================
        function recipeKey() { return S.RECIPE_KEYS[ddRecipe.selection ? ddRecipe.selection.index : 0]; }
        function boardSig() { return S.json.stringify([st.cfg.endBoard, names()]); }

        // 起始盤面不安靜（有觸發符號、有連線、有空格）就換一個；force = 一定換
        function ensureQuietStart(force) {
            if (!st.cfg.symbols.length) { return; }
            if (!force && S.board.isQuiet(st.cfg, st.cfg.startBoard)) { return; }
            var res = S.board.randomQuiet(st.cfg, new S.Rng(randomSeed()), 200);
            if (res.board) { st.cfg.startBoard = res.board; }
        }

        // 依選的演出重新產生節奏、期待輪、連線（觸發符號 / 幾顆 / 聽牌符號已經綁在設定上）
        function applyQuick() {
            if (!st.cfg.symbols.length) { refreshQuick(); return; }
            var key = recipeKey();
            var res = S.recipes.apply(st.cfg, key);
            st.cfg.spin.autoRhythm = true;
            ensureQuietStart(false);
            st.quickSig = boardSig();
            syncFields();
            refreshReelList();
            refreshLineList();
            refreshCells();
            persist();
            updatePlan();
            var reels = [];
            for (var i = 0; i < res.reels.length; i++) { reels.push("R" + res.reels[i]); }
            setStatus(T("已套用「{0}」：期待輪 {1}，連線 {2} 條", T(S.RECIPE_LABELS[U.indexOf(S.RECIPE_KEYS, key)]),
                reels.length ? reels.join(T("、")) : T("無"), res.lines));
        }

        function refreshQuick() {
            if (!qSummary) { return; }  // 快速頁還沒建好
            var L = st.cfg.layout, key = recipeKey();
            setMultiline(qSymInfo, st.cfg.symbols.length ? T("{0} 個符號：{1}", st.cfg.symbols.length, names().join("  ")) : T("還沒有符號：先匯入符號圖檔資料夾"), 330, true);
            setMultiline(qBoard, st.cfg.symbols.length ? S.board.toText(st.cfg.endBoard, L.rows) : T("（匯入符號後會先亂數填滿，再改成你要的結果）"), 330, true);
            q5.enabled = key === "trigger" || key === "miss";
            q6.enabled = key === "tease";
            var plan = st.plan, lines = [];
            if (plan && !plan.errors.length && st.cfg.symbols.length) {
                var ant = S.parseNumbers(st.cfg.spin.antReels), antTxt = [];
                for (var i = 0; i < ant.length; i++) { antTxt.push("R" + ant[i]); }
                lines.push(T("期待輪：{0}", antTxt.length ? antTxt.join(T("、")) : T("無")));
                if (key === "trigger" || key === "miss" || key === "tease") {
                    var sug = S.anticipation.suggest(st.cfg), perReel = {};
                    for (var r in sug.byReel) {
                        if (sug.byReel.hasOwnProperty(r)) { perReel[T("第 {0} 輪期待：{1}", r, sug.byReel[r])] = true; }
                    }
                    for (i = 0; i < sug.reasons.length; i++) { if (!perReel[sug.reasons[i]]) { lines.push(sug.reasons[i]); } }
                }
                lines.push(T("連線 {0} 條；全部停妥 {1} 秒、演出到 {2} 秒", st.cfg.lines.length, fmt2(plan.allSettled), fmt2(plan.endTime)));
            }
            setMultiline(qSummary, lines.join("\n"), 330, true);
        }

        ddRecipe.onChange = function () { applyQuick(); };
        qImport.onClick = function () {
            btnImport.onClick();
            if (st.cfg.symbols.length) { applyQuick(); } else { refreshQuick(); }
        };
        qAddSel.onClick = function () {
            btnAddSel.onClick();
            if (st.cfg.symbols.length) { applyQuick(); } else { refreshQuick(); }
        };
        qText.onClick = function () {
            if (!st.cfg.symbols.length) { setStatus(T("符號庫是空的")); return; }
            st.editing = "end";
            rbEnd.value = true;
            rbStart.value = false;
            refreshCells();
            btnText.onClick();
            applyQuick();
        };
        qPaint.onClick = function () {
            outer.selection = tAdv;
            tabs.selection = tBoard;
            rbEnd.value = true;
            rbStart.value = false;
            rbEnd.onClick();
        };
        qReroll.onClick = function () {
            ensureQuietStart(true);
            refreshCells();
            persist();
            updatePlan();
        };
        qCTI.onClick = function () {
            btnCTI.onClick();
            syncFields();
        };
        // 回到快速頁時，如果在進階頁改過結果盤面或符號，重新套用演出
        outer.onChange = function () {
            if (outer.selection === tQuick && st.cfg.symbols.length && st.quickSig !== boardSig()) { applyQuick(); }
            updatePlan();
        };

        // 切換語言：清掉整個面板用新語言重建（浮動視窗則關掉重開），停在「設定」頁
        function rebuild() {
            persist();
            UI.instance = null;
            if (win instanceof Window) {
                win.close();
            } else {
                while (win.children.length) { win.remove(win.children[0]); }
            }
            UI.create(thisObj, { tab: "settings" });
        }

        st.quickSig = boardSig();  // 先記下目前盤面，切換分頁時才不會重新套用演出、蓋掉讀進來的設定
        outer.selection = opts.tab === "settings" ? tAdv : tQuick;
        tabs.selection = opts.tab === "settings" ? tSet : (st.cfg.symbols.length ? tBoard : tSym);
        tabs.onChange = function () { updatePlan(); };
        refreshSymbols();
        rebuildGrid();
        refreshReelList();
        refreshLineList();
        refreshAssets();
        updatePlan();
        setStatus(st.cfg.symbols.length ? T("就緒") : T("第一步：到「符號」匯入老虎機符號圖檔"));

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
