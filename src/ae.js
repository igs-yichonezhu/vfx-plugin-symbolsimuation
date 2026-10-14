/*
 * SlotFakeSpin - ae.js
 * 所有 After Effects DOM 操作：匯入符號、建立轉輪合成、寫入關鍵影格、讀回設定。
 */
(function (S) {
    var U = S.util;
    var A = S.ae = {};

    A.ROOT_FOLDER = "SlotFakeSpin";
    A.SYMBOL_FOLDER = "SFS_Symbols";
    A.IMAGE_RE = /\.(png|jpe?g|psd|tga|tiff?|gif|bmp|ai|eps|exr|dpx|webp)$/i;
    A.MARKER_PREFIX = "SFS ";

    // ------------------------------------------------------------------
    // 專案項目工具
    // ------------------------------------------------------------------
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

    function symbolScale(item, L) {
        var k = L.symbolScale / 100;
        if (L.scaleMode === "fit" && item.width > 0 && item.height > 0) {
            var par = item.pixelAspect || 1;
            k *= Math.min(L.cellW / (item.width * par), L.cellH / item.height);
        }
        return k * 100;
    }

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

    function clearBoardComp(boardComp) {
        var reelComps = [];
        while (boardComp.numLayers > 0) {
            var lyr = boardComp.layer(1);
            var src = lyr.source;
            lyr.remove();
            if (src && src instanceof CompItem) { reelComps.push(src); }
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

    function buildReel(rc, rp, cfg, map, folder) {
        var L = cfg.layout, P = cfg.spin;
        var mb = !!P.motionBlur;
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
        var yProp = ctrl.transform.property("ADBE Position_1");
        setKeys(yProp, rp.keys);

        var hasShy = false;
        for (var k = 0; k < rp.strip.length; k++) {
            var s = rp.strip[k];
            var item = map[s.name];
            var lyr = rc.layers.add(item);
            lyr.name = S.layerNameFor(rp.index, s);
            lyr.parent = ctrl;
            lyr.transform.position.setValue(S.stripLocalPos(L, k));
            var sc = symbolScale(item, L);
            lyr.transform.scale.setValue([sc, sc]);
            lyr.motionBlur = mb;
            if (s.kind === "start") { lyr.label = 9; }
            else if (s.kind === "end") { lyr.label = 1; }
            else { lyr.shy = true; hasShy = true; }
            try {
                if (item instanceof CompItem && item.duration < rc.duration) {
                    lyr.timeRemapEnabled = true;
                    lyr.property("ADBE Time Remapping").expression = "loopOut(\"cycle\")";
                }
                lyr.outPoint = rc.duration;
            } catch (e3) { /* 影片素材長度不足時保持原樣 */ }
        }
        ctrl.moveToBeginning();
        if (hasShy) { rc.hideShyLayers = true; }
    }

    function removeOldMarkers(layer) {
        var mk = layer.property("ADBE Marker");
        for (var i = mk.numKeys; i >= 1; i--) {
            var v = mk.keyValue(i);
            if (v && v.comment && v.comment.indexOf(A.MARKER_PREFIX) === 0) { mk.removeKey(i); }
        }
    }

    // options: { boardLayer: 既有盤面圖層（更新模式） }
    // 回傳 { errors:[], warnings:[], boardComp, boardLayer, target, plan }
    A.build = function (cfg, options) {
        options = options || {};
        var result = { errors: [], warnings: [] };
        var L = cfg.layout;

        result.errors = S.validateConfig(cfg);
        if (result.errors.length) { return result; }
        if (!app.project) { result.errors.push("沒有開啟的專案"); return result; }

        var update = !!options.boardLayer;
        var boardLayer = update ? options.boardLayer : null;
        var boardComp = update ? boardLayer.source : null;
        var target = update ? boardLayer.containingComp : (L.target === "new" ? null : A.activeComp());
        var offset = update ? boardLayer.startTime : 0;
        if (!update && L.target !== "new" && !target) {
            result.errors.push("請先開啟一個合成（或在「版面」把目標改成「新建合成」）");
            return result;
        }
        if (cfg.spin.startTime - offset < 0) {
            result.errors.push("開始時間早於盤面圖層的起點，請調整開始時間或圖層位置");
            return result;
        }

        var fps = target ? target.frameRate : L.newCompFps;
        var plan = S.computePlan(cfg, fps, { timeOffset: offset });
        if (plan.errors.length) { result.errors = plan.errors; return result; }

        app.beginUndoGroup(update ? "SlotFakeSpin 更新盤面" : "SlotFakeSpin 建立假轉");
        try {
            // 符號
            var map = {}, missing = [], i;
            for (i = 0; i < cfg.symbols.length; i++) {
                var it = A.resolveSymbol(cfg.symbols[i], true);
                if (it) { map[cfg.symbols[i].name] = it; } else { missing.push(cfg.symbols[i].name); }
            }
            if (missing.length) {
                result.errors.push("找不到這些符號的素材：" + missing.join(", ") + "（請重新匯入或從符號庫移除）");
                return result;
            }

            var root = A.ensureFolder(A.ROOT_FOLDER);
            var need = plan.endTime + 1;
            var duration;
            if (!target) {
                duration = Math.max(5, Math.ceil(need + 1));
                var tw = plan.boardW <= 1720 && plan.boardH <= 880 ? 1920 : Math.ceil(plan.boardW * 1.1 / 2) * 2;
                var th = plan.boardW <= 1720 && plan.boardH <= 880 ? 1080 : Math.ceil(plan.boardH * 1.1 / 2) * 2;
                target = app.project.items.addComp(uniqueProjectName("SFS_Main"),
                    Math.max(4, tw), Math.max(4, th), 1, duration, fps);
                target.parentFolder = root;
                result.createdTarget = true;
            } else {
                duration = Math.max(target.duration - offset, need);
                if (offset + plan.endTime > target.duration) {
                    result.warnings.push("目標合成長度不足，最後一輪會在合成結束後才停（需要 " +
                        (Math.round((offset + plan.endTime) * 100) / 100) + " 秒）");
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
                var baseName = uniqueProjectName("SFS_Board");
                folder = app.project.items.addFolder(baseName);
                folder.parentFolder = root;
                boardComp = app.project.items.addComp(baseName, plan.boardW, plan.boardH, 1, duration, fps);
                boardComp.parentFolder = folder;
            }
            boardComp.motionBlur = !!cfg.spin.motionBlur;

            // 由最後一輪往前加，時間軸上 R1 會在最上面
            for (i = plan.reels.length - 1; i >= 0; i--) {
                var rp = plan.reels[i];
                var rc = app.project.items.addComp(boardComp.name + "_R" + (rp.index + 1),
                    plan.reelW, plan.reelH, 1, duration, fps);
                rc.parentFolder = folder;
                buildReel(rc, rp, cfg, map, folder);
                var rl = boardComp.layers.add(rc);
                rl.name = "Reel " + (rp.index + 1);
                rl.transform.position.setValue([rp.x, plan.boardH / 2]);
            }

            if (!boardLayer) {
                boardLayer = target.layers.add(boardComp);
                boardLayer.transform.position.setValue([target.width / 2, target.height / 2]);
            }
            boardLayer.comment = S.TAG;
            removeOldMarkers(boardLayer);
            var mk = boardLayer.property("ADBE Marker");
            for (i = 0; i < plan.markers.length; i++) {
                mk.setValueAtTime(offset + plan.markers[i].t, new MarkerValue(A.MARKER_PREFIX + plan.markers[i].label));
            }

            try {
                boardComp.comment = S.json.stringify({ sfs: S.VERSION, config: cfg });
            } catch (e) {
                result.warnings.push("無法把設定寫入合成註解，之後將不能「讀取選取盤面」");
            }

            if (result.createdTarget) {
                try { target.openInViewer(); } catch (e2) { /* 舊版 AE */ }
            }

            result.boardComp = boardComp;
            result.boardLayer = boardLayer;
            result.target = target;
            result.plan = plan;
        } catch (err) {
            result.errors.push("建立時發生錯誤：" + err.toString() + (err.line ? "（line " + err.line + "）" : ""));
        } finally {
            app.endUndoGroup();
        }
        return result;
    };
})(SFS);
