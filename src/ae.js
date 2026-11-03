/*
 * SlotFakeSpin - ae.js
 * 所有 After Effects DOM 操作：匯入符號、建立轉輪合成、寫入關鍵影格、讀回設定。
 */
(function (S) {
    var U = S.util, T = S.t;
    var A = S.ae = {};

    A.ROOT_FOLDER = "SlotFakeSpin";
    A.SYMBOL_FOLDER = "SFS_Symbols";
    A.IMAGE_RE = /\.(png|jpe?g|psd|tga|tiff?|gif|bmp|ai|eps|exr|dpx|webp)$/i;
    A.MARKER_PREFIX = "SFS ";
    A.SETTINGS_SECTION = "SlotFakeSpin";
    A.LANG_KEY = "language";

    // ------------------------------------------------------------------
    // 介面語言（存在 AE 偏好設定：auto / zh / en）
    // ------------------------------------------------------------------
    A.langPref = function () {
        try {
            if (app.settings.haveSetting(A.SETTINGS_SECTION, A.LANG_KEY)) {
                var v = app.settings.getSetting(A.SETTINGS_SECTION, A.LANG_KEY);
                if (U.indexOf(S.LANGS, v) >= 0) { return v; }
            }
        } catch (e) { /* ignore */ }
        return "auto";
    };

    A.setLangPref = function (v) {
        try { app.settings.saveSetting(A.SETTINGS_SECTION, A.LANG_KEY, v); } catch (e) { /* ignore */ }
    };

    // override：工作參數指定的語言（zh / en），沒有就用偏好設定
    A.initLang = function (override) {
        S.lang = S.detectLang(override === "zh" || override === "en" ? override : A.langPref());
        return S.lang;
    };

    // ------------------------------------------------------------------
    // 專案項目工具
    // ------------------------------------------------------------------
    // EffectCraft（開源的 AE 相容合成器）有幾個地方跟 AE 不同，只在偵測到它時調整，AE 的行為不變
    A.isEffectCraft = function () {
        try {
            return /EffectCraft/i.test(String(app.version)) && typeof app.run === "function";
        } catch (e) {
            return false;
        }
    };

    A.activeComp = function () {
        var it = app.project ? app.project.activeItem : null;
        return (it && it instanceof CompItem) ? it : null;
    };

    A.eachItem = function (fn) {
        var items = app.project.items;
        for (var i = 1; i <= items.length; i++) {
            if (fn(items[i]) === false) { return; }
        }
    };

    A.itemById = function (id) {
        if (!id) { return null; }
        try {
            if (app.project.itemByID) {
                var it = app.project.itemByID(id);
                if (it) { return it; }
            }
        } catch (e) { /* 舊版 AE 沒有 itemByID */ }
        var found = null;
        A.eachItem(function (it) {
            if (it.id === id) { found = it; return false; }
        });
        return found;
    };

    A.sameItem = function (a, b) {
        return !!a && !!b && a.id === b.id;
    };

    A.findFolder = function (name, parent) {
        parent = parent || app.project.rootFolder;
        var found = null;
        A.eachItem(function (it) {
            if (it instanceof FolderItem && it.name === name && A.sameItem(it.parentFolder, parent)) {
                found = it; return false;
            }
        });
        return found;
    };

    A.ensureFolder = function (name, parent) {
        parent = parent || app.project.rootFolder;
        var f = A.findFolder(name, parent);
        if (!f) {
            f = app.project.items.addFolder(name);
            f.parentFolder = parent;
        }
        return f;
    };

    A.symbolFolder = function () {
        return A.ensureFolder(A.SYMBOL_FOLDER, A.ensureFolder(A.ROOT_FOLDER));
    };

    A.isUsableSource = function (it) {
        if (!it) { return false; }
        if (!(it instanceof FootageItem) && !(it instanceof CompItem)) { return false; }
        return it.width > 0 && it.height > 0;
    };

    A.itemFilePath = function (it) {
        try {
            if (it instanceof FootageItem && it.mainSource && it.mainSource.file) {
                return it.mainSource.file.fsName;
            }
        } catch (e) { /* solid / placeholder */ }
        return "";
    };

    A.findFootageByPath = function (path) {
        if (!path) { return null; }
        var found = null;
        A.eachItem(function (it) {
            if (it instanceof FootageItem && A.itemFilePath(it) === path) { found = it; return false; }
        });
        return found;
    };

    A.findItemByName = function (name) {
        var found = null;
        A.eachItem(function (it) {
            if (!A.isUsableSource(it)) { return true; }
            if (it.name === name || U.baseName(it.name) === name) { found = it; return false; }
        });
        return found;
    };

    A.importImage = function (file, folder) {
        var io = new ImportOptions(file);
        if (!io.canImportAs(ImportAsType.FOOTAGE)) { return null; }
        io.importAs = ImportAsType.FOOTAGE;
        try { io.sequence = false; } catch (e) { /* ignore */ }
        var item = app.project.importFile(io);
        if (item && folder) { item.parentFolder = folder; }
        return item;
    };

    // ------------------------------------------------------------------
    // 符號庫
    // ------------------------------------------------------------------

    // 匯入資料夾內所有圖檔，回傳 [{ name, path, item }]
    A.importFolder = function (folder) {
        var all = folder.getFiles();
        var files = [], i;
        for (i = 0; i < all.length; i++) {
            var f = all[i];
            var fname = decodeURI(f.name);
            if (f instanceof File && fname.charAt(0) !== "." && A.IMAGE_RE.test(fname)) { files.push(f); }
        }
        files.sort(function (a, b) { return U.naturalCompare(decodeURI(a.name), decodeURI(b.name)); });
        var out = [], failed = [];
        if (!files.length) { return { symbols: out, failed: failed }; }
        var symFolder = A.symbolFolder();
        for (i = 0; i < files.length; i++) {
            var item = A.findFootageByPath(files[i].fsName);
            if (!item) {
                try { item = A.importImage(files[i], symFolder); } catch (e) { item = null; }
            }
            if (item) {
                out.push({ name: U.baseName(decodeURI(files[i].name)), path: files[i].fsName, item: item });
            } else {
                failed.push(decodeURI(files[i].name));
            }
        }
        return { symbols: out, failed: failed };
    };

    // 專案面板中選取的素材 / 合成
    A.selectedProjectSources = function () {
        var out = [];
        var sel = app.project.selection || [];
        for (var i = 0; i < sel.length; i++) {
            if (A.isUsableSource(sel[i])) {
                out.push({ name: U.baseName(sel[i].name), path: A.itemFilePath(sel[i]), item: sel[i] });
            }
        }
        return out;
    };

    // 找回符號對應的專案項目；allowImport=true 時遺失的檔案會重新匯入
    A.resolveSymbol = function (entry, allowImport) {
        var it = A.itemById(entry.itemId);
        if (it && !A.isUsableSource(it)) { it = null; }
        if (it && entry.path && A.itemFilePath(it) && A.itemFilePath(it) !== entry.path &&
            it.name !== entry.name && U.baseName(it.name) !== entry.name) {
            it = null; // id 被別的項目重用了（不同專案）
        }
        if (!it && entry.path) { it = A.findFootageByPath(entry.path); }
        if (!it && entry.path && allowImport) {
            var f = new File(entry.path);
            if (f.exists) {
                try { it = A.importImage(f, A.symbolFolder()); } catch (e) { it = null; }
            }
        }
        if (!it) { it = A.findItemByName(entry.name); }
        if (it) { entry.itemId = it.id; }
        return it;
    };

    // EffectCraft 0.3.1 不理會 ImportOptions.sequence = false：檔名結尾是數字、同資料夾有同系列檔案的圖（C200.png、C400.png…）
    // 會被匯入成連續圖檔，畫面隨時間換成別張。回傳這種符號的名稱（GIF 本來就可能是動畫，不算）。
    A.sequenceSymbols = function (cfg, map) {
        var out = [];
        for (var i = 0; i < cfg.symbols.length; i++) {
            var it = map[cfg.symbols[i].name];
            try {
                if (it instanceof FootageItem && it.mainSource && it.mainSource.isStill === false &&
                    A.IMAGE_RE.test(it.name) && !/\.gif$/i.test(it.name)) { out.push(cfg.symbols[i].name); }
            } catch (e) { /* 純色 / 佔位素材 */ }
        }
        return out;
    };

    // ------------------------------------------------------------------
    // 讀回已建立的盤面
    // ------------------------------------------------------------------
    A.readBoardConfig = function (layer) {
        try {
            if (!layer || !layer.source || !(layer.source instanceof CompItem)) { return null; }
            var txt = layer.source.comment;
            if (!txt || txt.charAt(0) !== "{") { return null; }
            var data = S.json.parse(txt);
            if (!data || data.sfs === undefined || !data.config) { return null; }
            return S.normalizeConfig(data.config);
        } catch (e) {
            return null;
        }
    };

    A.selectedBoardLayer = function () {
        var comp = A.activeComp();
        if (!comp) { return null; }
        var sel = comp.selectedLayers;
        for (var i = 0; i < sel.length; i++) {
            if (A.readBoardConfig(sel[i])) { return sel[i]; }
        }
        return null;
    };

    // ------------------------------------------------------------------
    // 建立
    // ------------------------------------------------------------------
    function uniqueProjectName(base) {
        var names = [];
        A.eachItem(function (it) { names.push(it.name); });
        for (var n = 1; n < 1000; n++) {
            var cand = base + "_" + U.pad(n, 2);
            if (U.indexOf(names, cand) < 0) { return cand; }
        }
        return base + "_" + (new Date().getTime());
    }

    // pct = 這個符號自己的額外縮放 %（symbols[i].scale）
    function symbolScale(item, L, pct) {
        var k = L.symbolScale / 100 * (pct > 0 ? pct / 100 : 1);
        if (L.scaleMode === "fit" && item.width > 0 && item.height > 0) {
            var par = item.pixelAspect || 1;
            k *= Math.min(L.cellW / (item.width * par), L.cellH / item.height);
        }
        return k * 100;
    }

    A.REEL_TAG = "SFS_REEL";

    function removeReelComp(rc) {
        var solids = [], i;
        for (i = 1; i <= rc.numLayers; i++) {
            var lyr = rc.layer(i);
            if (lyr.nullLayer && lyr.source) { solids.push(lyr.source); }
        }
        rc.remove();
        for (i = 0; i < solids.length; i++) {
            try { if (!solids[i].usedIn.length) { solids[i].remove(); } } catch (e) { /* ignore */ }
        }
    }

    // 清空盤面合成；只刪除本工具建立的轉輪合成（使用者的繞框 / 中獎素材不會被刪）
    function clearBoardComp(boardComp) {
        var reelComps = [];
        while (boardComp.numLayers > 0) {
            var lyr = boardComp.layer(1);
            var src = lyr.source;
            lyr.remove();
            if (src && src instanceof CompItem && src.comment === A.REEL_TAG) { reelComps.push(src); }
        }
        for (var i = 0; i < reelComps.length; i++) {
            try { if (!reelComps[i].usedIn.length) { removeReelComp(reelComps[i]); } } catch (e) { /* ignore */ }
        }
    }

    function setKeys(prop, keys) {
        var i, idx;
        for (i = 0; i < keys.length; i++) {
            idx = prop.addKey(keys[i].t);
            prop.setValueAtKey(idx, keys[i].y);
        }
        for (i = 0; i < keys.length; i++) {
            idx = i + 1;
            prop.setInterpolationTypeAtKey(idx, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
            try { prop.setTemporalAutoBezierAtKey(idx, false); } catch (e1) { /* ignore */ }
            try { prop.setTemporalContinuousAtKey(idx, false); } catch (e2) { /* ignore */ }
            prop.setTemporalEaseAtKey(idx,
                [new KeyframeEase(keys[i].inSpeed, keys[i].inInf)],
                [new KeyframeEase(keys[i].outSpeed, keys[i].outInf)]);
        }
    }

    // 加一個關鍵影格；hold = 這格之後保持數值（跳變）
    function key(prop, t, v, hold) {
        var idx = prop.addKey(t);
        prop.setValueAtKey(idx, v);
        if (hold) {
            prop.setInterpolationTypeAtKey(idx, KeyframeInterpolationType.HOLD, KeyframeInterpolationType.HOLD);
        }
        return idx;
    }

    function buildReel(rc, rp, cfg, map, folder) {
        var L = cfg.layout, P = cfg.spin;
        var mb = !!P.motionBlur;
        rc.comment = A.REEL_TAG;
        rc.motionBlur = mb;
        try {
            rc.shutterAngle = Math.round(U.clamp(P.shutterAngle, 0, 720));
            rc.shutterPhase = -Math.round(rc.shutterAngle / 2);
        } catch (e) { /* ignore */ }

        var ctrl = rc.layers.addNull(rc.duration);
        ctrl.name = "STRIP_CTRL";
        ctrl.label = 2;
        try {
            ctrl.source.name = rc.name + "_null";
            ctrl.source.parentFolder = folder;
        } catch (e2) { /* ignore */ }
        ctrl.transform.anchorPoint.setValue([0, 0]);
        ctrl.transform.position.setValue([0, rp.startY]);
        ctrl.transform.position.dimensionsSeparated = true;
        setKeys(ctrl.transform.property("ADBE Position_1"), rp.keys);

        var hasShy = false, scales = S.symbolScales(cfg);
        for (var k = 0; k < rp.strip.length; k++) {
            var s = rp.strip[k];
            var item = map[s.name];
            var lyr = rc.layers.add(item);
            lyr.name = S.layerNameFor(rp.index, s, rp.owner);
            lyr.parent = ctrl;
            lyr.transform.position.setValue(S.stripLocalPos(L, k));
            var sc = symbolScale(item, L, scales[s.name]);
            lyr.transform.scale.setValue([sc, sc]);
            lyr.motionBlur = mb;
            if (s.kind === "start") { lyr.label = 9; }
            else if (s.kind === "end" || (s.kind === "round" && s.lock)) { lyr.label = 1; }
            else if (s.kind === "round") { lyr.label = 9; }
            else { lyr.shy = true; hasShy = true; }
            fitDuration(lyr, item, rc.duration);
        }
        ctrl.moveToBeginning();
        if (hasShy) { rc.hideShyLayers = true; }
    }

    // 合成素材比需要的長度短時，開啟時間重映射循環播放
    function fitDuration(lyr, item, outPoint) {
        try {
            if (item instanceof CompItem && lyr.startTime + item.duration < outPoint - 1e-6) {
                lyr.timeRemapEnabled = true;
                lyr.property("ADBE Time Remapping").expression = "loopOut(\"cycle\")";
            }
            lyr.outPoint = outPoint;
        } catch (e) { /* 影片素材長度不足時保持原樣 */ }
    }

    function removeOldMarkers(layer) {
        var mk = layer.property("ADBE Marker");
        for (var i = mk.numKeys; i >= 1; i--) {
            var v = mk.keyValue(i);
            if (v && v.comment && v.comment.indexOf(A.MARKER_PREFIX) === 0) { mk.removeKey(i); }
        }
    }

    // ---------------- 形狀圖層小工具 ----------------
    // 注意：AE 在群組 addProperty 之後，同層之前取得的屬性參照會失效，所以每次都從圖層重新取。
    function newShapeLayer(comp, name) {
        var lyr = comp.layers.addShape();
        lyr.name = name;
        lyr.transform.anchorPoint.setValue([0, 0]);
        lyr.transform.position.setValue([0, 0]);
        return lyr;
    }

    function vecs(lyr, group) {
        return lyr.property("ADBE Root Vectors Group").property(group).property("ADBE Vectors Group");
    }

    function addGroup(lyr, name) {
        var g = lyr.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
        g.name = name;
    }

    function addRect(lyr, group, size, pos, roundness) {
        var r = vecs(lyr, group).addProperty("ADBE Vector Shape - Rect");
        r.property("ADBE Vector Rect Size").setValue(size);
        r.property("ADBE Vector Rect Position").setValue(pos);
        r.property("ADBE Vector Rect Roundness").setValue(roundness);
    }

    function addPath(lyr, group, points) {
        var p = vecs(lyr, group).addProperty("ADBE Vector Shape - Group");
        var sh = new Shape();
        sh.vertices = points;
        sh.closed = false;
        p.property("ADBE Vector Shape").setValue(sh);
    }

    // EffectCraft 0.3.1 不能用 addProperty("ADBE Vector Shape - Group") 建自由路徑，改用它的 shape.newPath 指令：
    // 會在最上面新增一個群組（路徑 + 筆畫），這裡把它改名成 group。要在圖層還沒有其他群組時呼叫。
    function addPathGroupEC(lyr, group, points) {
        app.run("shape.newPath", { comp: lyr.containingComp.id, layer: lyr.id, vertices: points, closed: false, fill: false, space: "layer" });
        var root = lyr.property("ADBE Root Vectors Group");
        if (root.numProperties !== 1) { throw new Error(T("shape.newPath 沒有建立群組")); }
        root.property(1).name = group;
        if (!vecs(lyr, group).property("ADBE Vector Graphic - Stroke")) {
            vecs(lyr, group).addProperty("ADBE Vector Graphic - Stroke");
        }
    }

    function addStroke(lyr, group, rgb, width) {
        styleStroke(vecs(lyr, group).addProperty("ADBE Vector Graphic - Stroke"), rgb, width);
    }

    function styleStroke(st, rgb, width) {
        st.property("ADBE Vector Stroke Color").setValue([rgb[0], rgb[1], rgb[2], 1]);
        st.property("ADBE Vector Stroke Width").setValue(width);
        try {
            st.property("ADBE Vector Stroke Line Cap").setValue(2);
            st.property("ADBE Vector Stroke Line Join").setValue(2);
        } catch (e) { /* ignore */ }
    }

    function addTrim(lyr, group) {
        vecs(lyr, group).addProperty("ADBE Vector Filter - Trim");
        return vecs(lyr, group).property("ADBE Vector Filter - Trim");
    }

    function addGlow(lyr) {
        try { lyr.property("ADBE Effect Parade").addProperty("ADBE Glo2"); } catch (e) { /* 沒有 Glow 特效就算了 */ }
    }

    function mixWhite(rgb, k) {
        return [rgb[0] + (1 - rgb[0]) * k, rgb[1] + (1 - rgb[1]) * k, rgb[2] + (1 - rgb[2]) * k];
    }

    // 淡入淡出：t0 淡入、t1 開始淡出
    function fadeInOut(lyr, t0, t1, fade) {
        lyr.inPoint = t0;
        lyr.outPoint = t1 + Math.max(0, fade);
        if (fade <= 0) { return; }
        var op = lyr.transform.opacity;
        key(op, t0, 0);
        key(op, Math.min(t0 + fade, t1), 100);
        if (t1 > t0 + fade) { key(op, t1, 100); }
        key(op, t1 + fade, 0);
    }

    function fitScale(item, w, h, mode) {
        var iw = item.width * (item.pixelAspect || 1), ih = item.height;
        if (mode === "stretch") { return [w / iw * 100, h / ih * 100]; }
        var k = Math.min(w / iw, h / ih) * 100;
        return [k, k];
    }

    function placeAsset(comp, item, name, pos, size, mode, t0, t1, fade) {
        var lyr = comp.layers.add(item);
        lyr.name = name;
        lyr.startTime = t0;
        lyr.transform.position.setValue(pos);
        lyr.transform.scale.setValue(fitScale(item, size[0], size[1], mode));
        fitDuration(lyr, item, t1 + Math.max(0, fade));
        fadeInOut(lyr, t0, t1, fade);
        return lyr;
    }

    // ---------------- 繞框 ----------------
    // fp：轉輪的繞框是 { reel, x }（框住整輪）；Hold & Spin 的期待格另外帶 { name, y, w, h }
    function buildFrame(board, fp, cfg, plan, asset) {
        var L = cfg.layout, F = cfg.frame;
        var w = fp.w || L.cellW + 2 * F.pad, h = fp.h || plan.reelH + 2 * F.pad;
        var pos = [fp.x, fp.y !== undefined ? fp.y : plan.margin + plan.reelH / 2];
        var name = fp.name || "Frame R" + (fp.reel + 1);
        if (asset) {
            return placeAsset(board, asset, name, pos, [w, h], "stretch", fp.start, fp.end, F.fade);
        }
        var rgb = S.hexToRgb(F.color, [1, 0.78, 0.24]);
        var round = Math.min(24, w / 4);
        var lyr = newShapeLayer(board, name);
        // 先加的群組在上層：兩條跑燈壓在外框上
        var runners = ["Runner A", "Runner B"];
        for (var i = 0; i < runners.length; i++) {
            addGroup(lyr, runners[i]);
            addRect(lyr, runners[i], [w, h], pos, round);
            addStroke(lyr, runners[i], mixWhite(rgb, 0.65), Math.max(1, F.width * 0.75));
            var trim = addTrim(lyr, runners[i]);
            trim.property("ADBE Vector Trim Start").setValue(0);
            trim.property("ADBE Vector Trim End").setValue(U.clamp(F.runner, 1, 100));
            trim.property("ADBE Vector Trim Offset").expression =
                "time * 360 * " + (Math.round(F.laps * 1000) / 1000) + (i ? " + 180" : "");
        }
        addGroup(lyr, "Frame");
        addRect(lyr, "Frame", [w, h], pos, round);
        addStroke(lyr, "Frame", rgb, Math.max(1, F.width));
        if (F.glow) { addGlow(lyr); }
        lyr.label = 11;
        fadeInOut(lyr, fp.start, fp.end, F.fade);
        return lyr;
    }

    // ---------------- 連線 ----------------
    // host：{ ec: 是否為 EffectCraft, pathErrors: [] 畫不出線的連線 }
    function buildLine(board, pl, cfg, plan, cellAsset, host) {
        var L = cfg.layout, LS = cfg.lineStyle, i, k;
        var lyr = newShapeLayer(board, (pl.highlight ? "Highlight " : "Line ") + (pl.index + 1));
        var hasPath = pl.points.length >= 2;
        if (hasPath && host.ec) {
            try {
                addPathGroupEC(lyr, "Line", pl.points);
                styleStroke(vecs(lyr, "Line").property("ADBE Vector Graphic - Stroke"), pl.color, Math.max(1, LS.width));
                addTrim(lyr, "Line");
            } catch (eEC) {
                // 畫不出線就只留框格子 / 符號跳動，不讓整個建置失敗
                host.pathErrors.push({ line: pl.index + 1, error: eEC.toString() });
                try {
                    var root = lyr.property("ADBE Root Vectors Group");
                    for (i = root.numProperties; i >= 1; i--) { root.property(i).remove(); }
                } catch (eRm) { /* 留下半成品群組也不影響其他部分 */ }
                hasPath = false;
            }
        } else if (hasPath) {
            addGroup(lyr, "Line");
            addPath(lyr, "Line", pl.points);
            addStroke(lyr, "Line", pl.color, Math.max(1, LS.width));
            addTrim(lyr, "Line");
        }
        if ((LS.boxes || pl.highlight) && !cellAsset) {
            addGroup(lyr, "Boxes");
            for (i = 0; i < pl.cells.length; i++) {
                addRect(lyr, "Boxes", [L.cellW - LS.boxWidth, L.cellH - LS.boxWidth],
                    S.cellCenter(L, pl.cells[i][0], pl.cells[i][1]), Math.min(20, L.cellW / 6));
            }
            addStroke(lyr, "Boxes", pl.color, Math.max(1, LS.boxWidth));
        }
        if (LS.glow) { addGlow(lyr); }
        lyr.label = 13;

        // 結構全部加完才取屬性（之前的參照可能已失效）
        var trimEnd = hasPath ? vecs(lyr, "Line").property("ADBE Vector Filter - Trim").property("ADBE Vector Trim End") : null;
        var op = lyr.transform.opacity;
        for (k = 0; k < pl.shows.length; k++) {
            var sh = pl.shows[k];
            var draw = Math.min(Math.max(0, LS.drawTime), (sh.end - sh.start) / 2);
            if (trimEnd && draw > 0) {
                key(trimEnd, sh.start, 0);
                key(trimEnd, sh.start + draw, 100, true);
            }
            key(op, sh.start, 100, true);
            key(op, sh.end, 0, true);
        }
        if (trimEnd && !trimEnd.numKeys) { trimEnd.setValue(100); }
        lyr.inPoint = pl.shows[0].start;
        lyr.outPoint = pl.shows[pl.shows.length - 1].end;

        if (cellAsset) {
            for (k = 0; k < pl.shows.length; k++) {
                for (i = 0; i < pl.cells.length; i++) {
                    placeAsset(board, cellAsset, "Win L" + (pl.index + 1) + " R" + (pl.cells[i][0] + 1) + "-" + (pl.cells[i][1] + 1),
                        S.cellCenter(L, pl.cells[i][0], pl.cells[i][1]), [L.cellW, L.cellH], "fit",
                        pl.shows[k].start, pl.shows[k].end, 0);
                }
            }
        }
        return lyr;
    }

    // 中獎符號跳動：在盤面合成放一份中獎符號（不會被轉輪合成裁切），連線出現時放大再縮回
    function buildWinOverlays(board, plan, cfg, map) {
        var L = cfg.layout, pulse = cfg.lineStyle.pulse;
        if (!(pulse > 100) || !plan.lines.length) { return; }
        var cells = {}, order = [], i, k, c;
        for (i = 0; i < plan.lines.length; i++) {
            var pl = plan.lines[i];
            for (c = 0; c < pl.cells.length; c++) {
                var id = pl.cells[c][0] + "_" + pl.cells[c][1];
                if (!cells[id]) { cells[id] = { reel: pl.cells[c][0], row: pl.cells[c][1], shows: [] }; order.push(id); }
                for (k = 0; k < pl.shows.length; k++) { cells[id].shows.push(pl.shows[k]); }
            }
        }
        var up = 0.1, down = 0.22, scales = S.symbolScales(cfg);
        for (i = 0; i < order.length; i++) {
            var cell = cells[order[i]];
            var item = map[cfg.endBoard[cell.reel][cell.row]];
            // 合併重疊的顯示區間
            cell.shows.sort(function (a, b) { return a.start - b.start; });
            var spans = [];
            for (k = 0; k < cell.shows.length; k++) {
                var sh = cell.shows[k], last = spans[spans.length - 1];
                if (last && sh.start <= last.end + 1e-6) {
                    if (sh.end > last.end) { last.end = sh.end; }
                    last.starts.push(sh.start);
                } else {
                    spans.push({ start: sh.start, end: sh.end, starts: [sh.start] });
                }
            }
            var lyr = board.layers.add(item);
            lyr.name = "Win R" + (cell.reel + 1) + "-" + (cell.row + 1) + "_" + cfg.endBoard[cell.reel][cell.row];
            lyr.transform.position.setValue(S.cellCenter(L, cell.reel, cell.row));
            var base = symbolScale(item, L, scales[cfg.endBoard[cell.reel][cell.row]]), big = base * pulse / 100;
            fitDuration(lyr, item, spans[spans.length - 1].end);
            lyr.inPoint = spans[0].start;
            lyr.outPoint = spans[spans.length - 1].end;
            var op = lyr.transform.opacity, sc = lyr.transform.scale, lastEnd = -1;
            for (k = 0; k < spans.length; k++) {
                key(op, spans[k].start, 100, true);
                key(op, spans[k].end, 0, true);
                for (var p = 0; p < spans[k].starts.length; p++) {
                    var t = spans[k].starts[p];
                    if (t < lastEnd) { continue; }
                    key(sc, t, [base, base]);
                    key(sc, t + up, [big, big]);
                    key(sc, t + up + down, [base, base]);
                    lastEnd = t + up + down + 0.01;
                }
            }
            lyr.label = 13;
        }
    }

    // Hold & Spin 鎖住時符號跳動：停妥那一刻在盤面合成放一份符號（不會被格子裁切），放大再縮回後就消失
    function buildLockPulses(board, plan, cfg, map) {
        var L = cfg.layout, big = cfg.hs.lockPulse / 100, scales = S.symbolScales(cfg);
        var up = S.hs.PULSE_UP, down = S.hs.PULSE_DOWN;
        for (var i = 0; i < plan.pulses.length; i++) {
            var pu = plan.pulses[i], item = map[pu.name], cell = plan.cells[pu.cell];
            var lyr = board.layers.add(item);
            lyr.name = "Lock " + cell.tag + "_" + pu.name;
            lyr.transform.position.setValue([pu.x, pu.y]);
            var base = symbolScale(item, L, scales[pu.name]);
            fitDuration(lyr, item, pu.t + up + down);
            lyr.inPoint = pu.t;
            lyr.outPoint = pu.t + up + down;
            var sc = lyr.transform.scale;
            key(sc, pu.t, [base, base]);
            key(sc, pu.t + up, [base * big, base * big]);
            key(sc, pu.t + up + down, [base, base]);
            lyr.label = 13;
        }
    }

    // Hold & Spin：每格一個格子合成（1 格高的轉帶），由最後一格往前加，時間軸上 Cell 1-1 在最上面
    function buildCells(boardComp, plan, cfg, map, folder, duration, fps, host) {
        var mb = !!cfg.spin.motionBlur;
        for (var i = plan.cells.length - 1; i >= 0; i--) {
            var cp = plan.cells[i];
            var cc = app.project.items.addComp(boardComp.name + "_C" + cp.tag, plan.cellW, plan.cellH, 1, duration, fps);
            cc.parentFolder = folder;
            buildReel(cc, { index: cp.index, owner: "C" + cp.tag, strip: cp.strip, startY: cp.startY, keys: cp.keys }, cfg, map, folder);
            var cl = boardComp.layers.add(cc);
            cl.name = "Cell " + cp.tag;
            cl.transform.position.setValue([cp.x, cp.y]);
            if (host.ec) { cl.motionBlur = mb; }
        }
    }

    // ---------------- 報獎 ----------------
    // 報獎合成（和目標合成一樣大）放在盤面圖層正上方，和盤面合成同一個資料夾；更新盤面時一起重建
    A.WIN_TAG = "SFS_WIN";

    function findWinComp(folder) {
        var found = null;
        A.eachItem(function (it) {
            if (it instanceof CompItem && it.comment === A.WIN_TAG && A.sameItem(it.parentFolder, folder)) { found = it; return false; }
        });
        return found;
    }

    function removeWinComp(wc) {
        var users = [];
        try { users = wc.usedIn; } catch (e) { users = []; }
        for (var i = 0; i < users.length; i++) {
            for (var k = users[i].numLayers; k >= 1; k--) {
                var lyr = users[i].layer(k);
                if (lyr.source && A.sameItem(lyr.source, wc)) { lyr.remove(); }
            }
        }
        wc.remove();
    }

    function addFill(lyr, group, rgb) {
        vecs(lyr, group).addProperty("ADBE Vector Graphic - Fill").property("ADBE Vector Fill Color").setValue([rgb[0], rgb[1], rgb[2], 1]);
    }

    function addEllipse(lyr, group, size, pos) {
        var e = vecs(lyr, group).addProperty("ADBE Vector Shape - Ellipse");
        e.property("ADBE Vector Ellipse Size").setValue(size);
        e.property("ADBE Vector Ellipse Position").setValue(pos);
    }

    function addStar(lyr, group, points, outer, inner) {
        var s = vecs(lyr, group).addProperty("ADBE Vector Shape - Star");
        s.property("ADBE Vector Star Type").setValue(1);  // 1 = 星形
        s.property("ADBE Vector Star Points").setValue(points);
        s.property("ADBE Vector Star Outer Radius").setValue(outer);
        s.property("ADBE Vector Star Inner Radius").setValue(inner);
    }

    // 置中的文字圖層；pos = 文字視覺中心（基線往下 0.35 字高）
    function addTextLayer(comp, name, text, size, hex, pos, font) {
        var lyr = comp.layers.addText(text);
        lyr.name = name;
        var p = lyr.property("ADBE Text Properties").property("ADBE Text Document");
        var td = p.value, rgb = S.hexToRgb(hex, [1, 0.84, 0.29]);
        td.fontSize = size;
        // AE：applyFill / applyStroke 沒打開時讀寫顏色會丟錯，所以先打開
        td.applyFill = true;
        td.fillColor = rgb;
        td.applyStroke = true;
        td.strokeColor = [rgb[0] * 0.3, rgb[1] * 0.3, rgb[2] * 0.3];
        td.strokeWidth = Math.max(2, Math.round(size * 0.06));
        td.strokeOverFill = false;
        td.justification = ParagraphJustification.CENTER_JUSTIFY;
        if (font) {
            try { td.font = font; } catch (eF) { /* 沒有這個字型就用預設 */ }
        }
        p.setValue(td);
        lyr.transform.position.setValue([pos[0], pos[1] + size * 0.35]);
        return lyr;
    }

    function keysFrom(prop, t0, table, k) {
        for (var i = 0; i < table.length; i++) { key(prop, t0 + table[i][0], [table[i][1] * k, table[i][1] * k]); }
    }

    // 圖層 start 出現、end 之後淡出（fade = false 就在 end 消失）
    function showSpan(lyr, start, end, fade) {
        lyr.inPoint = start;
        lyr.outPoint = fade ? end + S.win.FADE : end;
        if (fade) {
            key(lyr.transform.opacity, end, 100);
            key(lyr.transform.opacity, end + S.win.FADE, 0);
        }
    }

    // 字卡底下的壓暗 / 光芒：start 淡入、end 之後淡出
    function cardFade(prop, start, end, top) {
        key(prop, start, 0);
        key(prop, start + S.win.DIM_IN, top);
        key(prop, end, top);
        key(prop, end + S.win.FADE, 0);
    }

    // 盤面合成座標 -> 目標合成座標（看盤面圖層的位置 / 錨點 / 縮放；不含旋轉、父子）
    function boardMapper(boardLayer, t) {
        var tr = boardLayer.transform, pos;
        if (tr.position.dimensionsSeparated) {
            pos = [tr.property("ADBE Position_0").valueAtTime(t, false), tr.property("ADBE Position_1").valueAtTime(t, false)];
        } else {
            pos = tr.position.numKeys ? tr.position.valueAtTime(t, false) : tr.position.value;
        }
        var a = tr.anchorPoint.value, s = tr.scale.value, kx = s[0] / 100, ky = s[1] / 100;
        return {
            k: Math.abs(kx),
            at: function (q) { return [pos[0] + (q[0] - a[0]) * kx, pos[1] + (q[1] - a[1]) * ky]; }
        };
    }

    // 字卡（Big Win / 彩金 / Free Game）用的換算：以盤面中心為準，字級自動時至少是畫面短邊的 12%（小盤面也看得清楚）
    function cardMapper(wc, w, M) {
        var ts = M.k;
        if (w.autoSize) { ts = Math.max(ts, Math.min(wc.width, wc.height) * 0.12 / w.size); }
        var c0 = M.at(w.center);
        return {
            k: ts,
            at: function (p) { return [c0[0] + (p[0] - w.center[0]) * ts, c0[1] + (p[1] - w.center[1]) * ts]; }
        };
    }

    function buildCoins(wc, w, M, start, end, color, tag) {
        var C = w.coin, from = M.at(C.from), sz = C.size * M.k, rgb = S.hexToRgb(color, [1, 0.78, 0.15]);
        var gold = [1, 0.78, 0.15], dark = [0.55, 0.32, 0], shine = [1, 0.95, 0.6];
        for (var j = 0; j < w.coins; j++) {
            var lyr = newShapeLayer(wc, "Coin " + tag + " " + (j + 1));
            addGroup(lyr, "Shine");
            addEllipse(lyr, "Shine", [sz * 0.45, sz * 0.45], [-sz * 0.12, -sz * 0.12]);
            addFill(lyr, "Shine", shine);
            addGroup(lyr, "Coin");
            addEllipse(lyr, "Coin", [sz, sz], [0, 0]);
            addFill(lyr, "Coin", j % 4 === 3 ? mixWhite(rgb, 0.3) : gold);
            addStroke(lyr, "Coin", dark, Math.max(1, sz * 0.08));
            lyr.transform.position.expression = S.win.coinExpr({ t0: start, life: C.life, stagger: C.stagger, x: from[0], y: from[1],
                vx: C.vx * M.k, vy0: C.vy0 * M.k, vy1: C.vy1 * M.k, g: C.g * M.k });
            lyr.transform.scale.expression = S.win.coinSpinExpr(100);
            showSpan(lyr, start, end, true);
            lyr.label = 2;
        }
    }

    function buildRays(wc, w, M, start, end, color, tag) {
        var lyr = newShapeLayer(wc, "Rays " + tag), c = M.at(w.center);
        var r = Math.max(Math.max(w.center[0], w.center[1]) * 1.5 * M.k, Math.sqrt(wc.width * wc.width + wc.height * wc.height) * 0.6);
        addGroup(lyr, "Rays");
        addStar(lyr, "Rays", 16, r, r * 0.08);
        addFill(lyr, "Rays", mixWhite(S.hexToRgb(color, [1, 0.84, 0.29]), 0.2));
        lyr.transform.position.setValue(c);
        lyr.transform.rotation.expression = "time*" + S.win.RAYS_SPEED;
        cardFade(lyr.transform.opacity, start, end, 35);
        lyr.inPoint = start;
        lyr.outPoint = end + S.win.FADE;
        lyr.label = 15;
    }

    // 跑分數字：表達式跑分、跑完跳一下
    function buildCount(wc, w, M, name, Ts, Vs, size, pos, prefix, countEnd) {
        var lyr = addTextLayer(wc, name, S.win.format(Vs[Vs.length - 1], w.decimals, prefix), size, "#FFFFFF", pos, w.font);
        lyr.property("ADBE Text Properties").property("ADBE Text Document").expression = S.win.countExpr(Ts, Vs, w.decimals, prefix);
        keysFrom(lyr.transform.scale, countEnd, S.win.BUMP, 1);
        lyr.label = 15;
        return lyr;
    }

    // 回傳報獎合成（沒有要演就刪掉舊的、回傳 null）
    function buildWin(target, boardLayer, boardComp, plan, cfg, folder, duration, fps) {
        var w = plan.win, wc = findWinComp(folder), i, k;
        if (!w || !w.any) {
            if (wc) { removeWinComp(wc); }
            return null;
        }
        if (wc) {
            while (wc.numLayers > 0) { wc.layer(1).remove(); }
            wc.width = target.width;
            wc.height = target.height;
            wc.frameRate = fps;
            if (wc.duration < duration) { wc.duration = duration; }
        } else {
            wc = app.project.items.addComp(boardComp.name + "_Win", target.width, target.height, target.pixelAspect || 1, duration, fps);
            wc.parentFolder = folder;
            wc.comment = A.WIN_TAG;
        }
        var wl = null;
        for (i = 1; i <= target.numLayers; i++) {
            if (target.layer(i).source && A.sameItem(target.layer(i).source, wc)) { wl = target.layer(i); break; }
        }
        if (!wl) {
            wl = target.layers.add(wc);
            wl.name = "Win";
            try { wl.moveBefore(boardLayer); } catch (eMv) { /* 移不動就留在最上面 */ }
        }
        wl.startTime = boardLayer.startTime;
        wl.comment = A.WIN_TAG;

        var M = boardMapper(boardLayer, boardLayer.startTime + w.start), sc = M.k;
        function at(p) { return M.at(p); }

        // 跑分（最底下，Big Win 時一起被壓暗）
        if (w.meter) {
            var mp = w.meterPos || at(w.pos.meter), ms = w.meterSize * sc;
            var bg = newShapeLayer(wc, "Win Meter BG");
            addGroup(bg, "BG");
            addRect(bg, "BG", [Math.max(w.center[0] * 0.9 * sc, ms * 7), ms * 1.6], mp, ms * 0.4);
            addFill(bg, "BG", [0.05, 0.03, 0.08]);
            addStroke(bg, "BG", [1, 0.78, 0.24], Math.max(1, ms * 0.06));
            bg.transform.opacity.setValue(85);
            bg.inPoint = w.meter.start;
            bg.label = 15;
            var mt = buildCount(wc, w, M, "Win Meter", w.meter.T, w.meter.V, ms, mp, (w.meterLabel ? w.meterLabel + " " : "") + w.prefix, w.meter.countEnd);
            mt.inPoint = w.meter.start;
        }

        // 字卡共用一層壓暗
        var cards = [];
        if (w.big) { cards.push({ start: w.big.start, end: w.big.end }); }
        for (i = 0; i < w.cards.length; i++) { cards.push(w.cards[i]); }
        cards.sort(function (a, b) { return a.start - b.start; });
        if (cards.length && w.dim > 0) {
            var dim = newShapeLayer(wc, "Win Dim");
            addGroup(dim, "Dim");
            addRect(dim, "Dim", [wc.width, wc.height], [wc.width / 2, wc.height / 2], 0);
            addFill(dim, "Dim", [0, 0, 0]);
            for (i = 0; i < cards.length; i++) { cardFade(dim.transform.opacity, cards[i].start, cards[i].end, Math.round(w.dim * 100)); }
            dim.inPoint = cards[0].start;
            dim.outPoint = cards[cards.length - 1].end + S.win.FADE;
            dim.label = 15;
        }

        M = cardMapper(wc, w, M);
        var size = w.size * M.k, numSize = w.numSize * M.k;
        if (w.big) {
            var B = w.big, top = B.tiers[B.tiers.length - 1];
            if (w.rays) { buildRays(wc, w, M, B.start, B.end, B.tiers[0].color, "Big"); }
            for (k = 0; k < B.tiers.length; k++) {
                var tr = B.tiers[k], last = k === B.tiers.length - 1;
                var tl = addTextLayer(wc, "Title " + tr.name, tr.name, size, tr.color, at(w.pos.title), w.font);
                keysFrom(tl.transform.scale, tr.start, S.win.POP, 1);
                addGlow(tl);
                showSpan(tl, tr.start, tr.end, last);
                tl.label = 15;
            }
            var bn = buildCount(wc, w, M, "Big Win Count", B.T, B.V, numSize, at(w.pos.number), w.prefix, B.countEnd);
            showSpan(bn, B.start, B.end, true);
            if (w.coins > 0) { buildCoins(wc, w, M, B.start, B.end, top.color, "Big"); }
        }
        for (i = 0; i < w.cards.length; i++) {
            var cd = w.cards[i], tag = cd.kind === "jp" ? "JP" : "FG";
            if (w.rays) { buildRays(wc, w, M, cd.start, cd.end, cd.color, tag); }
            if (cd.kind === "jp") {
                var jt = addTextLayer(wc, "Title " + cd.title, cd.title, size, cd.color, at(w.pos.title), w.font);
                keysFrom(jt.transform.scale, cd.start, S.win.POP, 1);
                addGlow(jt);
                showSpan(jt, cd.start, cd.end, true);
                jt.label = 15;
                if (cd.V[1] > 0) {
                    var jn = buildCount(wc, w, M, "Jackpot Count", cd.T, cd.V, numSize, at(w.pos.number), w.prefix, cd.countEnd);
                    showSpan(jn, cd.start, cd.end, true);
                }
                if (w.coins > 0) { buildCoins(wc, w, M, cd.start, cd.end, cd.color, tag); }
            } else {
                var ft = addTextLayer(wc, "Title " + cd.title, cd.title, Math.round(size * 0.75), cd.color, at(w.pos.fgTitle), w.font);
                keysFrom(ft.transform.scale, cd.start, S.win.POP, 1);
                addGlow(ft);
                showSpan(ft, cd.start, cd.end, true);
                ft.label = 15;
                var fn = addTextLayer(wc, "Free Games Count", String(cd.count), Math.round(size * 1.5), "#FFFFFF", at(w.pos.fgCount), w.font);
                keysFrom(fn.transform.scale, cd.numAt, S.win.POP, 1);
                showSpan(fn, cd.numAt, cd.end, true);
                fn.label = 15;
            }
        }
        return wc;
    }

    function resolveAsset(holder, idKey, nameKey, pathKey) {
        var entry = { name: holder[nameKey], path: holder[pathKey], itemId: holder[idKey] };
        if (!entry.name && !entry.path && !entry.itemId) { return null; }
        var it = A.resolveSymbol(entry, true);
        if (it) { holder[idKey] = it.id; }
        return it;
    }

    // 把合成的某幾個時間點輸出成 PNG（給 agent 檢查畫面用）。saveFrameToPng 是 AE 未公開但長期存在的 API。
    A.exportFrames = function (comp, shots, folder) {
        var out = [];
        if (!comp.saveFrameToPng) { return { files: out, error: T("這個版本的 AE 沒有 saveFrameToPng") }; }
        if (!folder.exists) { folder.create(); }
        for (var i = 0; i < shots.length; i++) {
            var f = new File(folder.fsName + "/" + U.pad(i + 1, 2) + "_" + String(shots[i].label).replace(/[^\w\-]+/g, "_") + ".png");
            try {
                comp.saveFrameToPng(shots[i].t, f);
                out.push({ t: shots[i].t, label: shots[i].label, file: f.fsName });
            } catch (e) {
                out.push({ t: shots[i].t, label: shots[i].label, file: "", error: e.toString() });
            }
        }
        return { files: out, error: "" };
    };

    // 把盤面中心（= 格子中心）放到目標合成的 pos：錨點設在盤面合成中心，再設位置
    function placeBoard(layer, plan, pos, result) {
        var tr = layer.transform, comp = layer.containingComp;
        var p = tr.position, xy = [pos[0], pos[1]];
        if (p.numKeys > 0 || (p.dimensionsSeparated && (tr.property("ADBE Position_0").numKeys > 0 || tr.property("ADBE Position_1").numKeys > 0))) {
            result.warnings.push(T("盤面圖層的位置有關鍵影格，沒有套用盤面位置 {0}", xy.join(", ")));
            return;
        }
        if (tr.anchorPoint.numKeys === 0) {
            var ap = [plan.boardW / 2, plan.boardH / 2];
            if (layer.threeDLayer) { ap.push(tr.anchorPoint.value[2] || 0); }
            tr.anchorPoint.setValue(ap);
        }
        if (p.dimensionsSeparated) {
            tr.property("ADBE Position_0").setValue(xy[0]);
            tr.property("ADBE Position_1").setValue(xy[1]);
        } else {
            if (layer.threeDLayer) { xy.push(p.value[2] || 0); }
            p.setValue(xy);
        }
        if (comp && (pos[0] < 0 || pos[1] < 0 || pos[0] > comp.width || pos[1] > comp.height)) {
            result.warnings.push(T("盤面位置 {0}, {1} 在合成「{2}」（{3}x{4}）外面", pos[0], pos[1], comp.name, comp.width, comp.height));
        }
    }

    A.findComp = function (name) {
        var found = null;
        A.eachItem(function (it) {
            if (it instanceof CompItem && it.name === name) { found = it; return false; }
        });
        return found;
    };

    // 在合成中找盤面圖層：先找選取的，再找指定盤面合成名稱的，最後找唯一的一個
    A.findBoardLayer = function (comp, boardName) {
        var i, lyr, all = [];
        for (i = 1; i <= comp.numLayers; i++) {
            lyr = comp.layer(i);
            if (A.readBoardConfig(lyr)) { all.push(lyr); }
        }
        for (i = 0; i < all.length; i++) { if (all[i].selected) { return all[i]; } }
        if (boardName) {
            for (i = 0; i < all.length; i++) { if (all[i].source.name === boardName) { return all[i]; } }
            return null;
        }
        return all.length === 1 ? all[0] : null;
    };

    // options: { boardLayer: 既有盤面圖層（更新模式）, targetComp: 指定目標合成 }
    // 回傳 { errors:[], warnings:[], boardComp, boardLayer, target, plan }
    A.build = function (cfg, options) {
        options = options || {};
        var result = { errors: [], warnings: [] };
        var L = cfg.layout;

        result.errors = S.validateConfig(cfg);
        if (result.errors.length) { return result; }
        if (!app.project) { result.errors.push(T("沒有開啟的專案")); return result; }

        var update = !!options.boardLayer;
        var boardLayer = update ? options.boardLayer : null;
        var boardComp = update ? boardLayer.source : null;
        var target = update ? boardLayer.containingComp :
            (options.targetComp || (L.target === "new" ? null : A.activeComp()));
        var offset = update ? boardLayer.startTime : 0;
        if (!update && !options.targetComp && L.target !== "new" && !target) {
            result.errors.push(T("請先開啟一個合成（或在「設定」把輸出改成「新建合成」）"));
            return result;
        }
        if (cfg.spin.startTime - offset < 0) {
            result.errors.push(T("開始時間早於盤面圖層的起點，請調整開始時間或圖層位置"));
            return result;
        }

        var fps = target ? target.frameRate : L.newCompFps;
        var plan = S.computePlan(cfg, fps, { timeOffset: offset });
        if (plan.errors.length) { result.errors = plan.errors; return result; }
        result.warnings = result.warnings.concat(plan.warnings);
        var host = { ec: A.isEffectCraft(), pathErrors: [] };
        var mb = !!cfg.spin.motionBlur;

        app.beginUndoGroup(update ? T("SlotFakeSpin 更新盤面") : T("SlotFakeSpin 建立假轉"));
        try {
            // 符號與自訂素材
            var map = {}, missing = [], i;
            for (i = 0; i < cfg.symbols.length; i++) {
                var it = A.resolveSymbol(cfg.symbols[i], true);
                if (it) { map[cfg.symbols[i].name] = it; } else { missing.push(cfg.symbols[i].name); }
            }
            if (missing.length) {
                result.errors.push(T("找不到這些符號的素材：{0}（請重新匯入或從符號庫移除）", missing.join(", ")));
                return result;
            }
            if (host.ec) {
                var seq = A.sequenceSymbols(cfg, map);
                if (seq.length) {
                    result.warnings.push(T("EffectCraft 把這些符號圖當成連續圖檔匯入（檔名結尾是數字、同資料夾有同系列的檔案），畫面會隨時間換成別張：{0}。請改檔名或把它們放到各自的資料夾（sfs.js ec 會自動處理）", seq.join(", ")));
                }
            }
            var frameAsset = null, cellAsset = null;
            if (cfg.frame.source === "custom" && plan.frames.length) {
                frameAsset = resolveAsset(cfg.frame, "itemId", "itemName", "path");
                if (!frameAsset) { result.errors.push(T("找不到繞框素材「{0}」，請在「繞框」重新指定", cfg.frame.itemName)); return result; }
            }
            if (cfg.lineStyle.cellSource === "custom" && plan.lines.length) {
                cellAsset = resolveAsset(cfg.lineStyle, "cellItemId", "cellItemName", "cellPath");
                if (!cellAsset) { result.errors.push(T("找不到中獎格素材「{0}」，請在「連線」重新指定", cfg.lineStyle.cellItemName)); return result; }
            }

            var root = A.ensureFolder(A.ROOT_FOLDER);
            var need = plan.endTime + 1;
            var duration;
            if (!target) {
                duration = Math.max(5, Math.ceil(need + 1));
                var fits = plan.boardW <= 1920 && plan.boardH <= 1080;
                var tw = fits ? 1920 : Math.ceil(plan.boardW * 1.1 / 2) * 2;
                var th = fits ? 1080 : Math.ceil(plan.boardH * 1.1 / 2) * 2;
                target = app.project.items.addComp(uniqueProjectName("SFS_Main"),
                    Math.max(4, tw), Math.max(4, th), 1, duration, fps);
                target.parentFolder = root;
                result.createdTarget = true;
            } else {
                duration = Math.max(target.duration - offset, need);
                if (offset + plan.endTime > target.duration) {
                    result.warnings.push(T("目標合成長度不足，演出會在合成結束後才完成（需要 {0} 秒）", Math.round((offset + plan.endTime) * 100) / 100));
                }
            }

            var folder;
            if (update) {
                folder = boardComp.parentFolder;
                clearBoardComp(boardComp);
                boardComp.width = plan.boardW;
                boardComp.height = plan.boardH;
                boardComp.frameRate = fps;
                if (boardComp.duration < duration) { boardComp.duration = duration; }
                duration = boardComp.duration;
            } else {
                // 先建合成再建同名資料夾：EffectCraft 的合成名稱不能和既有項目重複（會自動改名），資料夾則可以
                var baseName = uniqueProjectName("SFS_Board");
                boardComp = app.project.items.addComp(baseName, plan.boardW, plan.boardH, 1, duration, fps);
                folder = app.project.items.addFolder(baseName);
                folder.parentFolder = root;
                boardComp.parentFolder = folder;
            }
            boardComp.motionBlur = mb;
            if (host.ec) {
                try {
                    boardComp.shutterAngle = Math.round(U.clamp(cfg.spin.shutterAngle, 0, 720));
                    boardComp.shutterPhase = -Math.round(boardComp.shutterAngle / 2);
                } catch (eSh) { /* ignore */ }
            }

            if (plan.mode === "holdspin") { buildCells(boardComp, plan, cfg, map, folder, duration, fps, host); }
            // 由最後一輪往前加，時間軸上 R1 會在最上面；轉輪合成用盤面合成的實際名稱（EffectCraft 可能改過名）
            for (i = plan.reels.length - 1; i >= 0; i--) {
                var rp = plan.reels[i];
                var rc = app.project.items.addComp(boardComp.name + "_R" + (rp.index + 1),
                    plan.reelW, plan.reelH, 1, duration, fps);
                rc.parentFolder = folder;
                buildReel(rc, rp, cfg, map, folder);
                var rl = boardComp.layers.add(rc);
                rl.name = "Reel " + (rp.index + 1);
                rl.transform.position.setValue([rp.x, plan.margin + plan.reelH / 2]);
                // AE 依預組合自己的設定算巢狀合成的模糊；EffectCraft 要外層的開關也打開才有效
                if (host.ec) { rl.motionBlur = mb; }
            }
            for (i = 0; i < plan.frames.length; i++) { buildFrame(boardComp, plan.frames[i], cfg, plan, frameAsset); }
            if (plan.pulses) { buildLockPulses(boardComp, plan, cfg, map); }
            buildWinOverlays(boardComp, plan, cfg, map);
            for (i = 0; i < plan.lines.length; i++) { buildLine(boardComp, plan.lines[i], cfg, plan, cellAsset, host); }
            if (host.pathErrors.length) {
                var skipped = [];
                for (i = 0; i < host.pathErrors.length; i++) { skipped.push(host.pathErrors[i].line); }
                result.warnings.push(T("EffectCraft 畫不出連線路徑，已略過第 {0} 條連線的畫線（框格子、符號跳動照常）：{1}", skipped.join(T("、")), host.pathErrors[0].error));
            }

            if (!boardLayer) {
                boardLayer = target.layers.add(boardComp);
                boardLayer.transform.position.setValue([target.width / 2, target.height / 2]);
            }
            // layout.position：建立和更新都放到指定位置；沒設定就維持置中 / 不動
            var pos = S.parsePosition(L.position);
            if (pos) { placeBoard(boardLayer, plan, pos, result); }
            if (host.ec) {
                boardLayer.motionBlur = mb;
                if (mb) { target.motionBlur = true; }
            }
            result.winComp = buildWin(target, boardLayer, boardComp, plan, cfg, folder, duration, fps);
            boardLayer.comment = S.TAG;
            removeOldMarkers(boardLayer);
            var mk = boardLayer.property("ADBE Marker");
            for (i = 0; i < plan.markers.length; i++) {
                mk.setValueAtTime(offset + plan.markers[i].t, new MarkerValue(A.MARKER_PREFIX + plan.markers[i].label));
            }

            try {
                boardComp.comment = S.json.stringify({ sfs: S.VERSION, config: cfg });
            } catch (e) {
                result.warnings.push(T("無法把設定寫入合成註解，之後將不能「讀取選取盤面」"));
            }

            if (result.createdTarget) {
                try { target.openInViewer(); } catch (e2) { /* 舊版 AE */ }
            }

            result.boardComp = boardComp;
            result.boardLayer = boardLayer;
            result.target = target;
            result.plan = plan;
        } catch (err) {
            result.errors.push(T("建立時發生錯誤：{0}{1}", err.toString(), err.line ? T("（line {0}）", err.line) : ""));
        } finally {
            app.endUndoGroup();
        }
        return result;
    };
})(SFS);
