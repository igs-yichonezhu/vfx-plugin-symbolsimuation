/*
 * SlotFakeSpin - ui.js
 * ScriptUI 面板（可停駐）：符號庫 / 盤面編輯 / 動態參數 / 版面，以及建立、更新、讀取、存檔。
 */
(function (S) {
    var U = S.util, A = S.ae;
    var UI = S.ui = {};
    var SEC = "SlotFakeSpin", KEY_CFG = "lastConfig_v1", KEY_THUMB = "thumbs";
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

    UI.create = function (thisObj) {
        var st = {
            cfg: UI.loadLast() || S.defaultConfig(),
            editing: "start",
            brush: "",
            thumbs: {},
            missing: {},
            useThumbs: getSetting(KEY_THUMB) !== "0",
            cells: [],
            fields: []
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

        function label(parent, text, width) {
            var t = parent.add("statictext", undefined, text);
            t.preferredSize.width = width || 64;
            return t;
        }

        function relayout() {
            try { win.layout.layout(true); win.layout.resize(); } catch (e) { /* ignore */ }
        }

        // 數字欄位：直接綁定 st.cfg[group][key]
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
                persist();
                if (opts.onChange) { opts.onChange(v); }
                updateInfo();
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
                persist();
                updateInfo();
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
                persist();
                updateInfo();
            };
            st.fields.push({ kind: "drop", ctrl: dd, group: group, key: key, values: values });
            return dd;
        }

        function checkField(parent, text, group, key) {
            var cb = parent.add("checkbox", undefined, text);
            cb.value = !!st.cfg[group][key];
            cb.onClick = function () {
                st.cfg[group][key] = this.value;
                persist();
            };
            st.fields.push({ kind: "check", ctrl: cb, group: group, key: key });
            return cb;
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

        // 自訂繪製：縮圖 + 名稱。不支援 onDraw 的平台會退回一般按鈕文字。
        function drawThumb(ctrl, name, w, h, bgColor) {
            var g = ctrl.graphics;
            g.newPath();
            g.rectPath(0, 0, w, h);
            g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, bgColor));
            var pen = g.newPen(g.PenType.SOLID_COLOR, [0.92, 0.92, 0.92, 1], 1);
            var img = getThumb(name);
            var text = name || "-";
            var labelH = img ? 12 : 0;
            if (img) {
                var iw = img.size[0], ih = img.size[1];
                var sc = Math.min((w - 6) / iw, (h - 6 - labelH) / ih);
                var dw = Math.max(1, iw * sc), dh = Math.max(1, ih * sc);
                g.drawImage(img, (w - dw) / 2, (h - labelH - dh) / 2 + 1, dw, dh);
            }
            var font = g.font;
            try { font = ScriptUI.newFont("dialog", "REGULAR", img ? 9 : 11); } catch (e1) { /* 預設字型 */ }
            var maxChars = Math.max(2, Math.floor(w / 6));
            if (text.length > maxChars) { text = text.substring(0, maxChars - 1) + "…"; }
            var tw = g.measureString(text, font)[0];
            var ty = img ? h - labelH - 2 : (h - 12) / 2;
            g.drawString(text, pen, Math.max(1, (w - tw) / 2), ty, font);
            g.newPath();
            g.rectPath(0, 0, w, h);
            g.strokePath(g.newPen(g.PenType.SOLID_COLOR, [0.45, 0.45, 0.45, 1], 1));
        }

        function drawCell() {
            try {
                var bg = st.editing === "start" ? [0.15, 0.24, 0.17, 1] : [0.27, 0.15, 0.15, 1];
                drawThumb(this, this.sfsName, this.size[0], this.size[1], bg);
            } catch (e) { /* 繪製失敗就算了 */ }
        }

        // ================= 版面骨架 =================
        var tabs = win.add("tabbedpanel");
        tabs.alignChildren = ["fill", "top"];
        var tSym = tabs.add("tab", undefined, "1 符號");
        var tBoard = tabs.add("tab", undefined, "2 盤面");
        var tSpin = tabs.add("tab", undefined, "3 動態");
        var tLayout = tabs.add("tab", undefined, "4 版面");
        var allTabs = [tSym, tBoard, tSpin, tLayout];
        for (var ti = 0; ti < allTabs.length; ti++) {
            allTabs[ti].orientation = "column";
            allTabs[ti].alignChildren = ["left", "top"];
            allTabs[ti].spacing = 5;
            allTabs[ti].margins = [8, 10, 8, 8];
        }

        // ================= 1 符號 =================
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
                var sel = list.selection && list.selection.length ? list.selection[0] : null;
                var name = sel ? st.cfg.symbols[sel.index].name : "";
                drawThumb(this, name, this.size[0], this.size[1], [0.12, 0.12, 0.12, 1]);
            } catch (e) { /* ignore */ }
        };

        var gSymOps = row(tSym);
        var btnFiller = gSymOps.add("button", undefined, "切換填充");
        btnFiller.helpTip = "● = 轉動中會隨機出現的填充符號；○ = 只會出現在你指定的盤面上（例如不想被亂數帶出來的 Scatter / Bonus）";
        var btnRename = gSymOps.add("button", undefined, "改名");
        var btnRemove = gSymOps.add("button", undefined, "移除");
        var btnClear = gSymOps.add("button", undefined, "清空");
        var symHint = tSym.add("statictext", undefined, "● 填充符號（轉動中隨機出現）  ○ 不當填充　雙擊可切換", { multiline: true });
        symHint.preferredSize.width = 300;

        // ================= 2 盤面 =================
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
        var boardHint = tBoard.add("statictext", undefined,
            "點格子 = 填入畫筆　Alt+點 = 吸取符號　Shift+點 = 整輪填入", { multiline: true });
        boardHint.preferredSize.width = 300;

        // ================= 3 動態 =================
        var r1 = row(tSpin);
        var etStart = numField(r1, "開始時間", "spin", "startTime", "秒", { min: 0, tip: "開始轉動的時間（目標合成的時間）" });
        var btnCTI = r1.add("button", undefined, "取目前時間");
        var r2 = row(tSpin);
        numField(r2, "第一輪停", "spin", "firstStop", "秒", { min: 0.05, tip: "從開始轉動到第 1 輪停下的時間（停輪 = 衝到最遠點那一刻，可對齊音效）" });
        numField(r2, "每輪間隔", "spin", "stagger", "秒", { min: 0, labelWidth: 56 });
        var r3 = row(tSpin);
        textField(r3, "期待延遲", "spin", "delays", {
            chars: 16,
            tip: "各輪額外延遲秒數，用逗號分隔，例如 0,0,0,0.8,0.8\n延遲會累加到後面的輪（聽牌 / 期待感用）"
        });
        var r4 = row(tSpin);
        numField(r4, "轉速", "spin", "speed", "格/秒", { min: 0.5, tip: "等速轉動時每秒經過幾格" });
        dropField(r4, "方向", "spin", "direction", ["down", "up"], ["向下", "向上"], { labelWidth: 30 });
        var r5 = row(tSpin);
        numField(r5, "起轉拉回", "spin", "windupDist", "格", { min: 0, tip: "開始前先反方向拉一點（0 = 不拉回）" });
        numField(r5, "", "spin", "windupTime", "秒", { min: 0 });
        var r6 = row(tSpin);
        numField(r6, "加速時間", "spin", "accelTime", "秒", { min: 0 });
        numField(r6, "減速時間", "spin", "decelTime", "秒", { min: 0, labelWidth: 56, tip: "停輪前的減速時間，越小停得越乾脆" });
        var r7 = row(tSpin);
        numField(r7, "停輪衝過", "spin", "overshoot", "格", { min: 0, tip: "停輪時衝過定位的距離（0 = 不回彈）" });
        numField(r7, "回彈", "spin", "bounceTime", "秒", { min: 0, labelWidth: 30 });
        var r8 = row(tSpin);
        var etSeed = numField(r8, "亂數種子", "spin", "seed", "", { min: 1, integer: true, chars: 8, tip: "決定轉動中填充符號的排列，同一個種子結果相同" });
        var btnSeed = r8.add("button", undefined, "換一組");
        var r9 = row(tSpin);
        checkField(r9, "動態模糊", "spin", "motionBlur");
        numField(r9, "快門角度", "spin", "shutterAngle", "", { min: 0, max: 720, integer: true, labelWidth: 56 });
        var info = tSpin.add("statictext", undefined, "", { multiline: true });
        info.preferredSize = [320, 46];

        // ================= 4 版面 =================
        var l1 = row(tLayout);
        numField(l1, "格寬", "layout", "cellW", "px", { min: 4, integer: true });
        numField(l1, "格高", "layout", "cellH", "px", { min: 4, integer: true, labelWidth: 40 });
        var l2 = row(tLayout);
        numField(l2, "輪距", "layout", "gapX", "px", { min: 0, integer: true, tip: "輪與輪之間的水平間距" });
        numField(l2, "列距", "layout", "gapY", "px", { min: 0, integer: true, labelWidth: 40, tip: "同一輪上下符號的間距" });
        var l3 = row(tLayout);
        numField(l3, "上下露出", "layout", "peek", "px", { min: 0, integer: true, tip: "轉輪視窗上下多露出的高度（看得到半顆相鄰符號）" });
        var l4 = row(tLayout);
        dropField(l4, "符號縮放", "layout", "scaleMode", ["fit", "none"], ["符合格子", "原始尺寸"]);
        numField(l4, "", "layout", "symbolScale", "%", { min: 1 });
        var l5 = row(tLayout);
        dropField(l5, "輸出到", "layout", "target", ["active", "new"], ["目前合成", "新建合成"]);
        numField(l5, "新合成", "layout", "newCompFps", "fps", { min: 1, max: 120, labelWidth: 40 });
        var layoutHint = tLayout.add("statictext", undefined,
            "盤面寬 = 輪數×格寬 + 輪距；高 = 列數×(格高+列距) − 列距 + 2×露出", { multiline: true });
        layoutHint.preferredSize.width = 300;

        // ================= 底部動作 =================
        var gAct = row(win);
        gAct.alignChildren = ["fill", "center"];
        var btnBuild = gAct.add("button", undefined, "▶ 建立假轉");
        btnBuild.helpTip = "在目前合成（或新合成）建立轉輪動畫，開始時間在「動態」頁設定";
        var btnUpdate = gAct.add("button", undefined, "更新選取盤面");
        btnUpdate.helpTip = "選取之前建立的盤面圖層，用目前設定重建（保留圖層位置 / 特效）";
        var gAct2 = row(win);
        var btnLoad = gAct2.add("button", undefined, "讀取選取盤面");
        btnLoad.helpTip = "把選取盤面圖層當時的設定讀回面板";
        var btnSave = gAct2.add("button", undefined, "存設定…");
        var btnOpen = gAct2.add("button", undefined, "開設定…");
        var status = win.add("statictext", undefined, "", { multiline: true });
        status.preferredSize = [320, 32];

        // ================= 刷新 =================
        function symbolLabel(e) {
            return (e.filler ? "● " : "○ ") + e.name + (st.missing[e.name] ? "  (遺失)" : "");
        }

        function selectedSymbolIndices() {
            var out = [];
            var sel = list.selection;
            if (!sel) { return out; }
            if (sel.length === undefined) { sel = [sel]; }
            for (var i = 0; i < sel.length; i++) { out.push(sel[i].index); }
            out.sort(function (a, b) { return a - b; });
            return out;
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
            if (keepIdx && keepIdx.length) {
                var sel = [];
                for (var k = 0; k < keepIdx.length; k++) {
                    if (keepIdx[k] < list.items.length) { sel.push(list.items[keepIdx[k]]); }
                }
                if (sel.length) { list.selection = sel; }
            }
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
                    if (st.useThumbs) {
                        try { b.hide(); b.show(); } catch (e) { /* 觸發重繪 */ }
                    }
                }
            }
        }

        function updateInfo() {
            try {
                var c = A.activeComp();
                var fps = (st.cfg.layout.target !== "new" && c) ? c.frameRate : st.cfg.layout.newCompFps;
                var plan = S.computePlan(st.cfg, fps, { fillerPool: ["?"] });
                if (plan.errors.length) { info.text = "⚠ " + plan.errors[0]; return; }
                var stops = [], maxV = 0;
                for (var i = 0; i < plan.reels.length; i++) {
                    stops.push(fmt(Math.round(plan.reels[i].stopTime * 100) / 100));
                    maxV = Math.max(maxV, plan.reels[i].speed / plan.pitch);
                }
                info.text = "@" + fmt(fps) + "fps　停輪(秒)：" + stops.join(" / ") +
                    "\n全部停妥：" + fmt(Math.round(plan.endTime * 100) / 100) + " 秒　實際轉速 ≈ " +
                    (Math.round(maxV * 10) / 10) + " 格/秒";
            } catch (e) {
                info.text = "";
            }
        }

        function syncAll() {
            syncFields();
            etReels.text = String(st.cfg.layout.reels);
            etRows.text = String(st.cfg.layout.rows);
            refreshSymbols();
            rebuildGrid();
            updateInfo();
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
            var idx = selectedSymbolIndices();
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
            var idx = selectedSymbolIndices();
            if (idx.length) { setBrush(st.cfg.symbols[idx[0]].name); }
            try { preview.hide(); preview.show(); } catch (e) { /* 觸發重繪 */ }
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

        btnRename.onClick = function () {
            var idx = selectedSymbolIndices();
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
            if (st.brush === e.name) { st.brush = nn; }
            e.name = nn;
            refreshSymbols(idx);
            refreshCells();
            persist();
        };

        btnRemove.onClick = function () {
            var idx = selectedSymbolIndices();
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
            rebuildGrid();
            persist();
            updateInfo();
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

        btnText.onClick = function () {
            var L = st.cfg.layout;
            var which = st.editing === "start" ? "起始盤面" : "結果盤面";
            var d = new Window("dialog", S.NAME + " - 文字編輯" + which);
            d.orientation = "column";
            d.alignChildren = ["fill", "top"];
            var t1 = d.add("statictext", undefined,
                "每一行是一列（由上到下），每行 " + L.reels + " 個符號，共 " + L.rows + " 行。\n用空白分隔；名稱有空白時改用逗號或 Tab（可直接貼上試算表）。",
                { multiline: true });
            t1.preferredSize.width = 420;
            var et = d.add("edittext", undefined, S.board.toText(currentBoard(), L.rows), { multiline: true });
            et.preferredSize = [420, 150];
            var t2 = d.add("statictext", undefined, "可用符號：" + names().join("  "), { multiline: true });
            t2.preferredSize = [420, 40];
            var gb = d.add("group");
            gb.alignment = "right";
            var ok = gb.add("button", undefined, "套用", { name: "ok" });
            gb.add("button", undefined, "取消", { name: "cancel" });
            ok.onClick = function () {
                var res = S.board.parseText(et.text, L.reels, L.rows, names());
                if (res.errors.length) { alert(res.errors.join("\n"), S.NAME); return; }
                setCurrentBoard(res.board);
                d.close(1);
            };
            d.show();
        };

        // ================= 動態事件 =================
        btnCTI.onClick = function () {
            var c = A.activeComp();
            if (!c) { alert("沒有作用中的合成", S.NAME); return; }
            st.cfg.spin.startTime = Math.round(c.time * c.frameRate) / c.frameRate;
            etStart.text = fmt(st.cfg.spin.startTime);
            persist();
            updateInfo();
            setStatus("開始時間 = " + fmt(st.cfg.spin.startTime) + " 秒（第 " + Math.round(c.time * c.frameRate) + " 格）");
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
            setStatus(verb + "完成：" + res.boardComp.name + "（" + p.reels.length + " 輪，全部停妥 " +
                fmt(Math.round((p.endTime + (res.boardLayer.startTime || 0)) * 100) / 100) + " 秒）");
            if (res.warnings.length) { alert(res.warnings.join("\n"), S.NAME); }
            refreshSymbols(selectedSymbolIndices());
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
        refreshSymbols();
        rebuildGrid();
        updateInfo();
        setStatus(st.cfg.symbols.length ? "就緒" : "第一步：到「1 符號」匯入老虎機符號圖檔");

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
