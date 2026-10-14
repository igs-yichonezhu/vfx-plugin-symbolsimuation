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

    function addStroke(lyr, group, rgb, width) {
        var st = vecs(lyr, group).addProperty("ADBE Vector Graphic - Stroke");
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
    function buildFrame(board, fp, cfg, plan, asset) {
        var L = cfg.layout, F = cfg.frame;
        var w = L.cellW + 2 * F.pad, h = plan.reelH + 2 * F.pad;
        var pos = [fp.x, plan.margin + plan.reelH / 2];
        var name = "Frame R" + (fp.reel + 1);
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
    function buildLine(board, pl, cfg, plan, cellAsset) {
        var L = cfg.layout, LS = cfg.lineStyle, i, k;
        var lyr = newShapeLayer(board, "Line " + (pl.index + 1));
        addGroup(lyr, "Line");
        addPath(lyr, "Line", pl.points);
        addStroke(lyr, "Line", pl.color, Math.max(1, LS.width));
        addTrim(lyr, "Line");
        if (LS.boxes && !cellAsset) {
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
        var trimEnd = vecs(lyr, "Line").property("ADBE Vector Filter - Trim").property("ADBE Vector Trim End");
        var op = lyr.transform.opacity;
        for (k = 0; k < pl.shows.length; k++) {
            var sh = pl.shows[k];
            var draw = Math.min(Math.max(0, LS.drawTime), (sh.end - sh.start) / 2);
            if (draw > 0) {
                key(trimEnd, sh.start, 0);
                key(trimEnd, sh.start + draw, 100, true);
            }
            key(op, sh.start, 100, true);
            key(op, sh.end, 0, true);
        }
        if (!trimEnd.numKeys) { trimEnd.setValue(100); }
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
        var up = 0.1, down = 0.22;
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
            var base = symbolScale(item, L), big = base * pulse / 100;
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
        if (!comp.saveFrameToPng) { return { files: out, error: "這個版本的 AE 沒有 saveFrameToPng" }; }
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
        if (!app.project) { result.errors.push("沒有開啟的專案"); return result; }

        var update = !!options.boardLayer;
        var boardLayer = update ? options.boardLayer : null;
        var boardComp = update ? boardLayer.source : null;
        var target = update ? boardLayer.containingComp :
            (options.targetComp || (L.target === "new" ? null : A.activeComp()));
        var offset = update ? boardLayer.startTime : 0;
        if (!update && !options.targetComp && L.target !== "new" && !target) {
            result.errors.push("請先開啟一個合成（或在「設定」把輸出改成「新建合成」）");
            return result;
        }
        if (cfg.spin.startTime - offset < 0) {
            result.errors.push("開始時間早於盤面圖層的起點，請調整開始時間或圖層位置");
            return result;
        }

        var fps = target ? target.frameRate : L.newCompFps;
        var plan = S.computePlan(cfg, fps, { timeOffset: offset });
        if (plan.errors.length) { result.errors = plan.errors; return result; }
        result.warnings = result.warnings.concat(plan.warnings);

        app.beginUndoGroup(update ? "SlotFakeSpin 更新盤面" : "SlotFakeSpin 建立假轉");
        try {
            // 符號與自訂素材
            var map = {}, missing = [], i;
            for (i = 0; i < cfg.symbols.length; i++) {
                var it = A.resolveSymbol(cfg.symbols[i], true);
                if (it) { map[cfg.symbols[i].name] = it; } else { missing.push(cfg.symbols[i].name); }
            }
            if (missing.length) {
                result.errors.push("找不到這些符號的素材：" + missing.join(", ") + "（請重新匯入或從符號庫移除）");
                return result;
            }
            var frameAsset = null, cellAsset = null;
            if (cfg.frame.source === "custom" && plan.frames.length) {
                frameAsset = resolveAsset(cfg.frame, "itemId", "itemName", "path");
                if (!frameAsset) { result.errors.push("找不到繞框素材「" + cfg.frame.itemName + "」，請在「演出」重新指定"); return result; }
            }
            if (cfg.lineStyle.cellSource === "custom" && plan.lines.length) {
                cellAsset = resolveAsset(cfg.lineStyle, "cellItemId", "cellItemName", "cellPath");
                if (!cellAsset) { result.errors.push("找不到中獎格素材「" + cfg.lineStyle.cellItemName + "」，請在「演出」重新指定"); return result; }
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
                    result.warnings.push("目標合成長度不足，演出會在合成結束後才完成（需要 " +
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
                rl.transform.position.setValue([rp.x, plan.margin + plan.reelH / 2]);
            }
            for (i = 0; i < plan.frames.length; i++) { buildFrame(boardComp, plan.frames[i], cfg, plan, frameAsset); }
            buildWinOverlays(boardComp, plan, cfg, map);
            for (i = 0; i < plan.lines.length; i++) { buildLine(boardComp, plan.lines[i], cfg, plan, cellAsset); }

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
