// ---- director.jsx：用 SFS_AD_DATA（make_ad.js 算好的時間表）建整支 Spicy Fortunes 廣告 ----
// AE 與 EffectCraft 共用（ES3）。全域選項：SFS_AD_DIR（kit 資料夾）、SFS_AD_NEWPROJECT（預設 AE 開新專案）、
// SFS_AD_SAVE（預設 AE 存 SpicyFortunes_AD.aep）、SFS_APPLY_INLINE（EffectCraft 沒有 $.evalFile 時，內嵌的 SlotFakeSpin 套用程式）
(function () {
    var D = SFS_AD_DATA, T = D.T, M = D.meta, FPS = D.FPS;
    var isEC = /EffectCraft/i.test(String(app.version));
    var dir = (typeof SFS_AD_DIR !== "undefined" && SFS_AD_DIR) ? SFS_AD_DIR : new File($.fileName).parent.fsName;
    var report = { ok: false, errors: [], warnings: [], comps: [] };
    $.global.SFS_AD_RESULT = report;
    var cache = {}, folders = {};

    function folder(name) {
        if (!folders[name]) {
            folders[name] = app.project.items.addFolder(name);
            if (name !== "SpicyFortunes_AD") { folders[name].parentFolder = folder("SpicyFortunes_AD"); }
        }
        return folders[name];
    }
    function imp(rel, seq) {
        if (cache[rel]) { return cache[rel]; }
        var f = new File(dir + "/" + rel);
        if (!f.exists) { throw new Error("missing asset " + rel); }
        var io = new ImportOptions(f);
        try { io.sequence = !!seq; } catch (e0) { /* ignore */ }
        var it = app.project.importFile(io);
        if (seq) { try { it.mainSource.conformFrameRate = FPS; } catch (e1) { /* ignore */ } }
        it.parentFolder = folder("Footage");
        cache[rel] = it;
        return it;
    }
    function newComp(name, w, h, dur) {
        var c = app.project.items.addComp(name, w, h, 1, dur, FPS);
        c.parentFolder = folder("Comps");
        report.comps.push(c.name);
        return c;
    }
    // 加圖層：o = { name, start, tin, tout, pos, scale, rot, opacity, blend, loop, parent, anchor }
    function L(c, item, o) {
        o = o || {};
        var l = c.layers.add(item);
        if (o.name) { l.name = o.name; }
        if (o.start !== undefined) { l.startTime = o.start; }
        if (o.loop) {
            try { l.timeRemapEnabled = true; l.property("ADBE Time Remapping").expression = "loopOut(\"cycle\")"; } catch (eL) { /* still */ }
        }
        // 設父層時 AE / EffectCraft 會保留圖層目前的畫面變形（自動改子層的縮放 / 旋轉），所以之後一定要重設
        if (o.parent) { l.parent = o.parent; }
        if (o.anchor) { l.transform.anchorPoint.setValue(o.anchor); }
        if (o.pos) { l.transform.position.setValue(o.pos); }
        if (o.scale !== undefined || o.parent) {
            var sv = o.scale === undefined ? 100 : o.scale;
            l.transform.scale.setValue(typeof sv === "number" ? [sv, sv] : sv);
        }
        if (o.rot || o.parent) { l.transform.rotation.setValue(o.rot || 0); }
        if (o.opacity !== undefined) { l.transform.opacity.setValue(o.opacity); }
        if (o.blend === "add") { l.blendingMode = BlendingMode.ADD; }
        if (o.blend === "screen") { l.blendingMode = BlendingMode.SCREEN; }
        if (o.tout !== undefined) { l.outPoint = o.tout; }
        if (o.tin !== undefined) { l.inPoint = o.tin; }
        return l;
    }
    function K(prop, keys) {
        for (var i = 0; i < keys.length; i++) { prop.setValueAtTime(keys[i][0], keys[i][1]); }
    }
    function K2(prop, keys) {  // 縮放：數字 → [v, v]
        for (var i = 0; i < keys.length; i++) { prop.setValueAtTime(keys[i][0], [keys[i][1], keys[i][1]]); }
    }
    function pop(l, t, base, k) {
        base = base || 100; k = k || 1;
        K2(l.transform.scale, [[t, 0], [t + 0.18 * k, base * 1.25], [t + 0.3 * k, base]]);
    }
    function bump(l, t, base) {
        K2(l.transform.scale, [[t, base], [t + 0.1, base * 1.22], [t + 0.28, base]]);
    }
    function fadeOut(l, t, d) { K(l.transform.opacity, [[t, 100], [t + (d || 0.3), 0]]); }
    function hexRgb(h) { h = String(h).replace("#", ""); return [parseInt(h.substring(0, 2), 16) / 255, parseInt(h.substring(2, 4), 16) / 255, parseInt(h.substring(4, 6), 16) / 255]; }
    function text(c, name, str, size, hex, pos, strokeHex) {
        var l = c.layers.addText(str);
        l.name = name;
        var p = l.property("ADBE Text Properties").property("ADBE Text Document");
        var td = p.value, rgb = hexRgb(hex);
        td.fontSize = size;
        td.applyFill = true;
        td.fillColor = rgb;
        td.applyStroke = true;
        td.strokeColor = strokeHex ? hexRgb(strokeHex) : [rgb[0] * 0.3, rgb[1] * 0.3, rgb[2] * 0.3];
        td.strokeWidth = Math.max(2, Math.round(size * 0.08));
        td.strokeOverFill = false;
        td.justification = ParagraphJustification.CENTER_JUSTIFY;
        try { td.font = "Arial-BoldMT"; } catch (eF) { /* default font */ }
        p.setValue(td);
        l.transform.position.setValue([pos[0], pos[1] + size * 0.35]);
        return l;
    }
    function shape(c, name) {
        var l = c.layers.addShape();
        l.name = name;
        l.transform.anchorPoint.setValue([0, 0]);
        l.transform.position.setValue([0, 0]);
        return l;
    }
    function rectFill(c, name, w, h, rgb, pos) {
        var l = shape(c, name);
        var g = l.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
        g.property("ADBE Vectors Group").addProperty("ADBE Vector Shape - Rect").property("ADBE Vector Rect Size").setValue([w, h]);
        l.property("ADBE Root Vectors Group").property(1).property("ADBE Vectors Group").addProperty("ADBE Vector Graphic - Fill")
            .property("ADBE Vector Fill Color").setValue([rgb[0], rgb[1], rgb[2], 1]);
        l.transform.position.setValue(pos);
        return l;
    }
    function nul(c, name, pos) {
        var n = c.layers.addNull(c.duration);
        n.name = name;
        n.transform.anchorPoint.setValue([0, 0]);
        n.transform.position.setValue(pos);
        return n;
    }
    function fx(c, key, t, pos, sc, o) {
        var X = M.fx2[key]; if (!X) { return null; }
        o = o || {};
        var l = L(c, imp(X.file), { name: "FX " + key, start: t, pos: pos, scale: sc || 100, blend: X.blend || o.blend, rot: o.rot,
            loop: !!o.loop, tin: t, tout: o.tout || t + (X.dur || 1) - 0.02, opacity: o.opacity });
        return l;
    }
    // 黑底特效滿版：縮放到蓋滿 1080x1920（Add 混合，黑色等於透明）
    function full(c, X, name, t, tout, o) {
        o = o || {};
        var sc = Math.max(1080 / X.w, 1920 / X.h) * 100 * (o.k || 1);
        return L(c, imp(X.file), { name: "FULL " + name, start: t - (o.skip || 0), pos: [540, o.y || 960], scale: sc, blend: "add", loop: !!o.loop,
            tin: t, tout: tout, opacity: o.opacity, rot: o.rot });
    }
    function glow(l) { try { l.property("ADBE Effect Parade").addProperty("ADBE Glo2"); } catch (eG) { /* no glow */ } }
    function coins(c, n, start, end, expr, sz, tag) {
        for (var j = 0; j < n; j++) {
            var l = shape(c, "Coin " + tag + " " + (j + 1));
            var root = l.property("ADBE Root Vectors Group");
            var g = root.addProperty("ADBE Vector Group");
            g.property("ADBE Vectors Group").addProperty("ADBE Vector Shape - Ellipse").property("ADBE Vector Ellipse Size").setValue([sz, sz]);
            root.property(1).property("ADBE Vectors Group").addProperty("ADBE Vector Graphic - Fill").property("ADBE Vector Fill Color").setValue([1, 0.78, 0.15, 1]);
            var st = root.property(1).property("ADBE Vectors Group").addProperty("ADBE Vector Graphic - Stroke");
            st.property("ADBE Vector Stroke Color").setValue([0.55, 0.32, 0, 1]);
            st.property("ADBE Vector Stroke Width").setValue(Math.max(1, sz * 0.08));
            l.transform.position.expression = expr;
            l.transform.scale.expression = "var s=100;[s*Math.cos(time*8+index),s];";
            l.inPoint = start;
            l.outPoint = end + 0.3;
            fadeOut(l, end, 0.3);
        }
    }
    function db(layer, v) {
        try { layer.property("ADBE Audio Group").property("ADBE Audio Levels").setValue([v, v]); } catch (eA) { /* no audio */ }
    }

    // ================================================================ 轉盤場景
    // 每個圖層照 MG.psd 的位置（prep_v2.py 量好的中心 / 縮放），不另外排版
    function buildWheel() {
        var c = newComp("WHEEL_SCENE", 1080, 1920, T.flash + 0.6);
        var g = M.mg2, w1 = M.wheel1;
        function at(key, name, extra) {
            var p = g[key], o = { name: name, pos: [p.cx, p.cy], scale: p.scale * 100 };
            for (var k in extra) { if (extra.hasOwnProperty(k)) { o[k] = extra[k]; } }
            return L(c, imp(p.file), o);
        }
        at("sky", "Sky");
        if (T.celebrate !== undefined) {
            // 轉盤畫面的火焰底（競品轉盤下半部是暗紅色火海）：轉盤出來時淡入，蓋住天空下面的白色
            var fire = rectFill(c, "Fire BG", 1080, 1100, [0.32, 0.03, 0.02], [540, 1370]);
            K(fire.transform.opacity, [[T.reveal[0], 0], [T.reveal[1], 100]]);
            fire.inPoint = T.reveal[0];
            var glowBg = rectFill(c, "Fire BG Glow", 1080, 500, [0.85, 0.25, 0.02], [540, 1700]);
            K(glowBg.transform.opacity, [[T.reveal[0], 0], [T.reveal[1], 70]]);
            glowBg.inPoint = T.reveal[0];
            try { glowBg.property("ADBE Effect Parade").addProperty("ADBE Gaussian Blur 2").property(1).setValue(120); } catch (eB) { /* 沒有模糊就算了 */ }
        }
        at("wheel2", "Super Wheel");
        var disk = at("w1disk", "Wheel Disk");
        disk.transform.rotation.expression = D.wheelExpr;
        disk.motionBlur = true;
        var sel = at("w1select", "Wheel Select");
        K(sel.transform.opacity, [[0, 0], [T.stop + 0.05, 0]]);
        for (var b = 0; b < 7; b++) {
            var tb = T.stop + 0.1 + b * 0.13;
            sel.transform.opacity.setValueAtTime(tb, 100);
            sel.transform.opacity.setValueAtTime(tb + 0.065, b < 6 ? 25 : 100);
        }
        for (var kk = 1; kk <= sel.transform.opacity.numKeys; kk++) {
            sel.transform.opacity.setInterpolationTypeAtKey(kk, KeyframeInterpolationType.HOLD, KeyframeInterpolationType.HOLD);
        }
        at("w1hub", "Wheel Hub");
        // 指針繞上方的軸擺動：錨點設在圖的上方中間，位置 = 那一點在畫面上的座標
        var pp = g.w1pointer, pivot = [pp.w / 2, 30];
        var ptr = at("w1pointer", "Wheel Pointer", { anchor: pivot, pos: [pp.cx - pp.w * pp.scale / 2 + pivot[0] * pp.scale, pp.cy - pp.h * pp.scale / 2 + pivot[1] * pp.scale] });
        ptr.transform.rotation.expression = D.pointerExpr;
        at("w1top", "Wheel Banner");
        // 辣椒人：一開始在 PSD 位置（輕微呼吸），轉盤要轉之前往右下讓開
        var cp = g.cha, cha = at("cha", "Cha", { anchor: [cp.w / 2, cp.h], pos: [cp.cx, cp.cy + cp.h / 2] });
        var base = [cp.cx, cp.cy + cp.h / 2];
        // 跳一下慶祝（寶石收進碗之後）→ 轉盤要出來時往右下讓開
        K(cha.transform.position, [[T.celebrate, base], [T.celebrate + 0.18, [base[0], base[1] - 70]], [T.celebrate + 0.36, base],
            [T.celebrate + 0.5, [base[0], base[1] - 30]], [T.celebrate + 0.62, base], [T.reveal[0], base], [T.reveal[1], [cp.cx + 330, cp.cy + cp.h / 2 + 40]]]);
        K2(cha.transform.scale, [[T.reveal[0], 100], [T.reveal[1], 62]]);
        cha.transform.scale.expression = "var s=1.2*Math.sin(time*5.2);value+[-s*0.4,s];";
        var i, fade = function (l) { K(l.transform.opacity, [[T.reveal[0], 100], [T.reveal[1] - 0.2, 0]]); };
        // 轉盤畫面：火焰從下面升起（競品的轉盤畫面下半部都是火）
        var V = M.video;
        for (i = 0; i < 3; i++) {
            var fl = L(c, imp(V.fireBurst.file), { name: "Wheel Fire " + (i + 1), start: T.reveal[0] - 0.2 + i * 0.4, blend: "add", pos: [180 + i * 360, 1560], scale: 95,
                loop: true, tin: T.reveal[0], tout: T.flash + 0.5 });
            K(fl.transform.opacity, [[T.reveal[0], 0], [T.reveal[1], 100]]);
        }
        fade(at("stone", "Stone"));
        fade(at("reels", "Reels"));
        L(c, imp(M.mg.bottomUI.file), { name: "Bottom UI", pos: [540, 1841] });
        var BS = M.bowlStates;
        function bowlState(key, gk, name) {
            var p = g[gk], half = L(c, imp(BS[key].half), { name: name + " Half", pos: [p.cx, p.cy], scale: p.w / 900 * 100 * 1.0 });
            var fullB = L(c, imp(BS[key].full), { name: name + " Full", pos: [p.cx, p.cy], scale: p.w / 900 * 100 * 1.0 });
            var tf = T.gemFly[0] + 0.6;
            K(fullB.transform.opacity, [[tf, 0], [tf + 0.08, 100]]);
            K2(fullB.transform.scale, [[tf, p.w / 9 * 1.0], [tf + 0.12, p.w / 9 * 1.12], [tf + 0.3, p.w / 9 * 1.0]]);
            half.outPoint = tf + 0.1;
            fade(fullB);
            return fullB;
        }
        bowlState("red", "bowlRed", "Bowl Red");
        var gb = at("bowlGreen", "Bowl Green"), gp = g.bowlGreen;
        K(gb.transform.position, [[T.reveal[0], [gp.cx, gp.cy]], [T.reveal[1], [900, 1430]]]);
        K2(gb.transform.scale, [[T.reveal[0], 100], [T.reveal[1], 88]]);
        bowlState("blue", "bowlBlue", "Bowl Blue");
        // 藍碗動畫（素材的 blue_bow）：碗變滿時閃一下
        fx(c, "bowlBlueAni", T.gemFly[0] + 0.6, [g.bowlBlue.cx, g.bowlBlue.cy - 20], 95, { tout: T.reveal[0] });
        at("topUI", "Top UI");
        // 開頭：轉輪上的寶石飛進同顏色的碗，碗跳一下
        var GG = M.mgGems, bowls = { PINK: g.bowlRed, PINK2: g.bowlRed, BLUE: g.bowlBlue, GREEN: g.bowlGreen }, k2 = 0;
        for (var gk in GG) {
            if (!GG.hasOwnProperty(gk)) { continue; }
            var gm = GG[gk], bw = bowls[gk], t0 = T.gemFly[0] + k2 * 0.12, t1 = t0 + 0.55;
            var fly = L(c, imp(gm.file), { name: "Gem Fly " + gk, tin: t0, tout: t1 + 0.05 });
            K(fly.transform.position, [[t0, [gm.cx, gm.cy]], [t0 + 0.3, [(gm.cx + bw.cx) / 2, Math.min(gm.cy, bw.cy) - 120]], [t1, [bw.cx, bw.cy - 40]]]);
            K2(fly.transform.scale, [[t0, 100], [t0 + 0.2, 130], [t1, 60]]);
            glow(fly);
            L(c, imp(V.sparks.file), { name: "Gem In " + gk, start: t1 - 0.05, blend: "add", pos: [bw.cx, bw.cy - 40], scale: 40, tin: t1 - 0.05, tout: t1 + 0.4 });
            k2++;
        }
        fx(c, "burstGreen", T.gemFly[0] + 0.55, [g.bowlGreen.cx, g.bowlGreen.cy - 60], 70);
        fx(c, "burstPink", T.gemFly[0] + 0.6, [g.bowlRed.cx, g.bowlRed.cy - 60], 70);
        fx(c, "starWhite", T.celebrate, [cp.cx + 260, cp.cy - 260], 45, { opacity: 80 });
        L(c, imp(V.fireBurst.file), { name: "Cha Burst", start: T.celebrate - 0.1, blend: "add", pos: [cp.cx, cp.cy - 80], scale: 110, tin: T.celebrate - 0.1, tout: T.celebrate + 1.2 });
        // SPIN 在轉盤中心
        var w1h = g.w1hub, spin = text(c, "SPIN", "SPIN", 72, "#FFFFFF", [w1h.cx, w1h.cy], "#00366A");
        K2(spin.transform.scale, [[T.reveal[1], 0], [T.reveal[1] + 0.2, 115], [T.reveal[1] + 0.35, 100], [T.spinPress, 100], [T.spinPress + 0.08, 85], [T.spinPress + 0.16, 100]]);
        spin.inPoint = T.reveal[1];
        spin.outPoint = T.spinStart + 0.05;

        if (!D.jpCard) {
            // 停在 +N：大字彈出 + 放射光（競品停在 +3 之後直接進 EXTRA ROWS）
            fx(c, "wipeBlue", T.reveal[0] - 0.2, [540, 960], 320);
            fx(c, "burstBlue", T.stop - 0.05, [w1h.cx, w1h.cy], 120);
            fx(c, "ringBlue", T.stop, [540, 330], 80);
            fx(c, "slashGold", T.plus + 0.1, [540, 700], 120);
            var pr = L(c, imp(M.fx.rays.file), { name: "Plus Rays", pos: [w1h.cx, 640], scale: 120, blend: "add", tin: T.plus });
            pr.transform.rotation.expression = "time*22";
            K(pr.transform.opacity, [[T.plus, 0], [T.plus + 0.2, 80], [T.trans, 80], [T.flash, 0]]);
            var pt = text(c, "Plus", D.plusText, 260, "#FFFFFF", [540, 640], "#6A1A9A");
            pop(pt, T.plus, 100); glow(pt); pt.inPoint = T.plus;
            var ps = text(c, "Plus Spins", "SPINS", 90, "#FFE45C", [540, 820], "#5A2A00");
            pop(ps, T.plus + 0.15, 100); ps.inPoint = T.plus + 0.15;
            c.motionBlur = true;
            return c;
        }
        // ---- MINOR JACKPOT 字卡（和競品一樣：停在 MINOR、獎 4,000）----
        var dim = rectFill(c, "JP Dim", 1080, 1920, [0, 0, 0], [540, 960]);
        K(dim.transform.opacity, [[T.jp, 0], [T.jp + 0.2, 62], [T.jpEnd, 62], [T.jpEnd + 0.3, 0]]);
        dim.inPoint = T.jp;
        var rays = L(c, imp(M.fx.rays.file), { name: "JP Rays", pos: [540, 930], scale: 150, blend: "add", tin: T.jp });
        rays.transform.rotation.expression = "time*22";
        K(rays.transform.opacity, [[T.jp, 0], [T.jp + 0.3, 70], [T.jpEnd, 70], [T.jpEnd + 0.3, 0]]);
        var t1 = text(c, "JP MINOR", "MINOR", 200, "#4DA6FF", [540, 780], "#06204A");
        pop(t1, T.jp, 100); glow(t1); t1.inPoint = T.jp;
        var t2 = text(c, "JP Awarded", "JACKPOT AWARDED", 66, "#FFFFFF", [540, 920], "#3A1060");
        pop(t2, T.jp + 0.15, 100); t2.inPoint = T.jp + 0.15;
        var t3 = text(c, "JP Count", "4,000", 170, "#FFE45C", [540, 1075], "#5A2A00");
        t3.property("ADBE Text Properties").property("ADBE Text Document").expression = D.jpCount;
        pop(t3, T.jpCount[0] - 0.15, 100);
        bump(t3, T.jpCount[1], 100);
        glow(t3); t3.inPoint = T.jpCount[0] - 0.15;
        var t4 = text(c, "JP Credits", "CREDITS", 62, "#FFFFFF", [540, 1205], "#3A1060");
        pop(t4, T.jpCount[0], 100); t4.inPoint = T.jpCount[0];
        coins(c, 28, T.jp, T.jpEnd, D.coins.jp, 64, "JP");
        var cardLayers = [t1, t2, t3, t4];
        for (i = 0; i < cardLayers.length; i++) { fadeOut(cardLayers[i], T.jpEnd, 0.3); }
        c.motionBlur = true;
        return c;
    }

    // ================================================================ FG 場景
    function runApply(job) {
        $.global.SFS_APPLY = job;
        $.global.SFS_APPLY_RESULT = null;
        if (typeof SFS_APPLY_INLINE === "function") { SFS_APPLY_INLINE(); }
        else { $.evalFile(new File(dir + "/SlotFakeSpin_apply.jsx")); }
        return $.global.SFS_APPLY_RESULT;
    }
    function buildFG() {
        var G = D.fg, c = newComp("FG_SCENE", 1080, 1920, G.dur), fg = M.fg, V = M.video, S = M.seq;
        var local = function (t) { return t - T.fg; };
        L(c, imp(G.bg || fg.bg.file), { name: "FG BG", pos: [540, 960] });
        // 辣椒人：平常用 PSD 上的那張（位置一模一樣，輕微呼吸）；噴火時換成張嘴的影片（底部對齊）
        var chaPos = [fg.cha.cx, fg.cha.cy + 14], chaScale = 78;
        var fireIn = local(T.fire) - 0.75, fireOut = local(T.fire) + 1.6;
        L(c, imp(M.fx2.chaFGIdle.file), { name: "Cha Idle Video", pos: chaPos, scale: chaScale, loop: true, tout: fireIn });
        L(c, imp(M.fx2.chaHappy.file), { name: "Cha Happy", pos: chaPos, scale: chaScale, start: fireOut + 0.15, loop: true, tin: fireOut + 0.15, tout: G.dur });
        var st = L(c, imp(fg.cha.file), { name: "Cha", tout: 0.01, anchor: [fg.cha.w / 2, fg.cha.h], pos: [fg.cha.cx, fg.cha.cy + fg.cha.h / 2] });
        st.transform.scale.expression = "var s=1.2*Math.sin(time*5.2);value+[-s*0.4,s];";
        K(st.transform.opacity, [[fireIn, 100], [fireIn + 0.12, 0], [fireOut, 0], [fireOut + 0.15, 100]]);
        L(c, imp(V.chaFire.file), { name: "Cha Fire", pos: chaPos, scale: chaScale, start: fireIn, tin: fireIn, tout: fireOut + 0.15 });

        // SlotFakeSpin：Hold & Spin 5x6 + BIG WIN 報獎
        var r = runApply({ preset: dir + "/fg.json", base: dir, mode: "new", comp: c.name, frames: "none", result: "", lang: "en" });
        if (!r || !r.ok) { throw new Error("SlotFakeSpin: " + (r ? r.errors.join(" / ") : "no result")); }
        for (var w = 0; w < r.warnings.length; w++) { report.warnings.push("SlotFakeSpin: " + r.warnings[w]); }
        // 報獎圖層：用來源合成的註解認（EffectCraft 不保存圖層註解）
        var winLayer = null, winComp = null, i;
        for (i = 1; i <= c.numLayers; i++) {
            var src = c.layer(i).source;
            if (src && src instanceof CompItem && src.comment === "SFS_WIN") { winLayer = c.layer(i); winComp = src; }
        }
        if (!winLayer) { report.warnings.push("SlotFakeSpin win layer not found"); }

        // 辣椒格：落下時火框長出來（opening）→ 一直燒（loop）→ 被火掃到變成燒紅的底板 + 數值
        var seqOpen = imp(S.chiliOpen.first, true), seqLoop = imp(S.chiliLoop.first, true), seqPlate = imp(S.plate.first, true);
        // 連續圖照 calibrate.py 量的縮放 / 位移疊在辣椒格上（和靜態格完全重合）
        var SC = D.seqCal;
        function onTile(cal, pos) { return [pos[0] + cal.dx, pos[1] + cal.dy]; }
        var valueLayers = {};
        for (i = 0; i < G.chili.length; i++) {
            var ch = G.chili[i];
            L(c, seqOpen, { name: "Chili Open " + (i + 1), start: ch.t - 0.17, pos: onTile(SC.chiliOpen, ch.pos), scale: SC.chiliOpen.scale, tin: ch.t - 0.17, tout: ch.t + 1.3 });
            L(c, seqLoop, { name: "Chili Burn " + (i + 1), start: ch.t + 1.3, pos: onTile(SC.chiliLoop, ch.pos), scale: SC.chiliLoop.scale, loop: true, tin: ch.t + 1.3, tout: ch.ignite });
        }
        // 和競品一樣：格子不原地轉，符號從上方碗那一排帶著彩色殘影飛進格子，落地閃一下變成色塊
        var bl = $.global.SFS_BUILD ? $.global.SFS_BUILD.layer : null;
        if (bl) { bl.enabled = false; }
        var EMIT = [[200, 330], [540, 360], [880, 330]], TRAIL = [[1, 0.35, 0.8], [0.3, 0.6, 1], [0.35, 1, 0.45]], FLY = 0.45;
        // 競品：格子從自己那一欄的上方落下（帶殘影），落地變成綠 / 金 / 紅色塊
        var TILE = { GREEN: ["assets/fg/tile_GREEN.png", null, [0.3, 1, 0.4]], GOLD: ["assets/fg/tile_GOLD.png", null, [1, 0.85, 0.2]], CHILI: ["assets/fg/CHILI_tile.png", null, [1, 0.35, 0.2]] };
        // 剩餘次數（競品左上角的 3 SPINS LEFT）
        var sl = text(c, "Spins Left", "3 SPINS LEFT", 40, "#FFE45C", [190, 498], "#2A1A00"); sl.inPoint = 0.3;
        // 寶石：先落下，下一回合 UPGRADE 變成金格
        for (i = 0; i < (G.gemsLand || []).length; i++) {
            var gl = G.gemsLand[i], gt0 = gl.t - 0.45;
            var gv = L(c, imp(V.gemRainbow.file), { name: "Gem " + (i + 1), start: gt0, loop: true, tin: gt0, tout: gl.upgrade + 0.05 });
            K(gv.transform.position, [[gt0, [gl.pos[0], 560]], [gl.t, gl.pos]]);
            K2(gv.transform.scale, [[gt0, 40], [gl.t, 62]]);
            glow(gv);
            L(c, imp(V.sparks.file), { name: "Gem Land " + (i + 1), start: gl.t - 0.05, pos: gl.pos, scale: 30, blend: "add", tin: gl.t - 0.05, tout: gl.t + 0.45 });
            var up = text(c, "Upgrade " + (i + 1), "UPGRADE", 40, "#FFD54A", gl.pos, "#5A2A00");
            pop(up, gl.upgrade - 0.25, 100); up.inPoint = gl.upgrade - 0.25; up.outPoint = gl.upgrade + 0.45;
        }
        var PLATE_SCALE = SC.plate.scale * 0.62;  // 底板連續圖（0.82）縮到辣椒格大小 → 飛行中的靜態圖用同樣比例
        function artOf(lk) { return TILE[lk.name][0]; }
        for (i = 0; i < (G.plusPops || []).length; i++) {
            var pq = G.plusPops[i], pt2 = text(c, "Plus " + (i + 1), pq.text, 96, "#FFFFFF", [250, 300], "#6A1A9A");
            pop(pt2, pq.t, 100); glow(pt2); pt2.inPoint = pq.t; fadeOut(pt2, pq.t + 1.0, 0.3); pt2.outPoint = pq.t + 1.35;
        }
        for (i = 0; i < G.locks.length; i++) {
            var lk = G.locks[i], em = [lk.pos[0], 560], col = TILE[lk.name][2], t0 = lk.t - FLY;
            var noFly = !!lk.fromGem;
            var art = artOf(lk);
            var mid = [lk.pos[0] + (i % 2 ? 40 : -40), (560 + lk.pos[1]) / 2];
            for (var gh = noFly ? -1 : 4; gh >= 0; gh--) {
                var g = L(c, imp(art), { name: (gh ? "Trail " : "Fly ") + (i + 1) + (gh ? "." + gh : ""), start: 0, blend: gh ? "add" : undefined,
                    tin: t0 + gh * 0.03, tout: lk.t + gh * 0.03 });
                g.transform.position.expression = "var t0=" + t0 + ",d=" + FLY + ",u=Math.max(0,Math.min(1,(time-" + (gh * 0.03) + "-t0)/d));u=u*u*(3-2*u);" +
                    "var a=[" + em + "],m=[" + mid + "],b=[" + lk.pos + "];[(1-u)*(1-u)*a[0]+2*(1-u)*u*m[0]+u*u*b[0],(1-u)*(1-u)*a[1]+2*(1-u)*u*m[1]+u*u*b[1]];";
                g.transform.scale.expression = "var u=Math.max(0,Math.min(1,(time-" + (gh * 0.03) + "-" + t0 + ")/" + FLY + "));var s=" + (gh ? 22 - gh * 3 : 40) + "+u*" + (gh ? 6 : 55) + ";[s,s];";
                g.transform.opacity.setValue(gh ? 70 - gh * 13 : 100);
                if (gh) {
                    try {
                        var fe = g.property("ADBE Effect Parade").addProperty("ADBE Fill");
                        fe.property("ADBE Fill-0002").setValue([col[0], col[1], col[2], 1]);
                    } catch (eFill) { /* 沒有 Fill 就用原色殘影 */ }
                } else { glow(g); }
            }
            if (!noFly && i % 3 === 0) { fx(c, "ringPink", lk.t - 0.1, lk.pos, 32); }
            L(c, imp(V.sparks.file), { name: "Land Flash " + (i + 1), start: lk.t - 0.05, pos: lk.pos, scale: 34, blend: "add", tin: lk.t - 0.05, tout: lk.t + 0.5 });
            if (lk.name !== "CHILI") {
                var dl = L(c, imp(art), { name: lk.name + " " + (i + 1), pos: lk.pos, tin: lk.t, tout: G.dur });
                pop(dl, lk.t, 100, 0.8);
            }
        }
        // 噴火：從嘴巴往辣椒那一欄噴下去
        fx(c, "boltGreen", local(T.fire) - 0.35, [531, 380], 90);
        var fj = full(c, V.fireJet, "Fire Sweep", local(T.fire) + 0.15, local(T.fire) + 1.6, { k: 1.05 });
        K(fj.transform.opacity, [[local(T.fire) + 0.15, 0], [local(T.fire) + 0.35, 100], [local(T.fire) + 1.2, 100], [local(T.fire) + 1.6, 0]]);
        var jet = L(c, imp(V.fireJet.file), { name: "Fire Jet", start: local(T.fire) - 0.1, pos: [531, 470], blend: "add", tin: local(T.fire), tout: local(T.fire) + 2.2 });
        jet.transform.anchorPoint.setValue([0, 336]);
        jet.transform.rotation.setValue(99);
        K2(jet.transform.scale, [[local(T.fire), 30], [local(T.fire) + 0.35, 105], [local(T.fire) + 1.9, 105]]);
        K(jet.transform.opacity, [[local(T.fire), 0], [local(T.fire) + 0.15, 100], [local(T.fire) + 1.8, 100], [local(T.fire) + 2.2, 0]]);
        var all = G.chili.concat(G.dias, G.gems || []);
        for (i = 0; i < G.chili.length; i++) {
            var cc = G.chili[i];
            L(c, seqPlate, { name: "Plate " + (i + 1), start: cc.ignite, pos: onTile(SC.plate, cc.pos), scale: SC.plate.scale, loop: true, tin: cc.ignite, tout: G.dur });
            L(c, imp(V.fireBurst.file), { name: "Burst " + (i + 1), start: cc.ignite - 0.15, pos: [cc.pos[0], cc.pos[1] - 40], scale: 32, blend: "add", tin: cc.ignite - 0.15, tout: cc.ignite + 1.1 });
        }
        for (i = 0; i < all.length; i++) {
            var a = all[i], isChili = a.name === "CHILI";
            var vt = text(c, "Value " + (i + 1), formatNum(a.value), isChili ? 62 : 52, isChili ? "#FFE45C" : "#FFFFFF", [a.pos[0], a.pos[1] + (a.name === "DDIA" ? 52 : 0)], isChili ? "#5A0A00" : "#102A6A");
            pop(vt, a.ignite + 0.08, 100);
            vt.inPoint = a.ignite + 0.08;
            valueLayers[a.row + "_" + a.col] = vt;
        }
        // 收數值：依序跳一下
        for (i = 0; i < G.collect.length; i++) {
            var cl = G.collect[i];
            for (var key in valueLayers) {
                if (valueLayers.hasOwnProperty(key)) {
                    var vl = valueLayers[key], p0 = vl.transform.position.value;
                    if (Math.abs(p0[0] - cl.pos[0]) < 2 && Math.abs(p0[1] - cl.pos[1]) < 90) { bump(vl, cl.t, 100); }
                }
            }
        }


        // 報獎蓋在最上面；標題換成 BIG WIN 美術圖、加放射光
        if (winLayer) { winLayer.moveToBeginning(); }
        if (winComp) { dressBigWin(winComp); }
        var big = G.big;
        L(c, imp(V.confetti.file), { name: "Confetti", start: big.start + 0.3, pos: [540, 700], scale: 100, tin: big.start + 0.3, tout: big.start + 5.2 });
        fx(c, "burstStar", big.start - 0.05, [540, 820], 150);
        full(c, M.fx2.sparkle, "Big Sparkle", big.start, G.dur, { loop: true, opacity: 75 });
        full(c, V.stars, "Big Stars", big.start, G.dur, { loop: true, opacity: 85 });
        full(c, M.fx2.ring, "Big Ring", big.start, big.start + 2.9);
        full(c, V.sparks, "Big Sparks", big.start - 0.05, big.start + 0.5);
        for (var cb = 0; cb < 4; cb++) { full(c, M.fx2.coinBurst, "Big Coins " + (cb + 1), big.start + 0.2 + cb * 1.1, big.start + 1.18 + cb * 1.1); }
        return c;
    }
    function formatNum(v) {
        var s = String(Math.round(v)), o = "";
        while (s.length > 3) { o = "," + s.slice(-3) + o; s = s.slice(0, -3); }
        return s + o;
    }
    // SlotFakeSpin 報獎合成：文字標題 → BIG WIN 圖；背後加放射光
    // 字卡往上移到格子上半部（SlotFakeSpin 預設以盤面中心為準，會壓在辣椒那一欄中間）
    function dressBigWin(wc) {
        var title = null, dim = null, count = null, i, ART_Y = 820, COUNT_Y = 1075;
        for (i = 1; i <= wc.numLayers; i++) {
            if (/^Title /.test(wc.layer(i).name)) { title = wc.layer(i); }
            if (wc.layer(i).name === "Win Dim") { dim = wc.layer(i); }
            if (wc.layer(i).name === "Big Win Count") { count = wc.layer(i); }
        }
        if (!title) { report.warnings.push("BIG WIN title layer not found"); return; }
        var p = title.transform.position.value;
        var ctr = [p[0], ART_Y];
        if (count) {
            var cs = count.property("ADBE Text Properties").property("ADBE Text Document").value.fontSize;
            count.transform.position.setValue([count.transform.position.value[0], COUNT_Y + cs * 0.35]);
        }
        var bw = M.fx.bigwin, sc = 940 / bw.w * 100;
        var art = L(wc, imp(bw.file), { name: "BIG WIN Art", pos: ctr });
        var sk = title.transform.scale;
        for (var k = 1; k <= sk.numKeys; k++) { art.transform.scale.setValueAtTime(sk.keyTime(k), [sk.keyValue(k)[0] / 100 * sc, sk.keyValue(k)[1] / 100 * sc]); }
        if (!sk.numKeys) { art.transform.scale.setValue([sc, sc]); }
        var op = title.transform.opacity;
        for (k = 1; k <= op.numKeys; k++) { art.transform.opacity.setValueAtTime(op.keyTime(k), op.keyValue(k)); }
        art.inPoint = title.inPoint;
        art.outPoint = title.outPoint;
        art.moveBefore(title);
        title.enabled = false;
        var rays = L(wc, imp(M.fx.rays.file), { name: "BIG WIN Light", pos: [ctr[0], ctr[1] + 60], scale: 170, blend: "add", tin: title.inPoint, tout: title.outPoint });
        rays.transform.rotation.expression = "time*18";
        K(rays.transform.opacity, [[title.inPoint, 0], [title.inPoint + 0.3, 75], [title.outPoint - 0.3, 75], [title.outPoint, 0]]);
        if (dim) { rays.moveBefore(dim); }
    }

    // ================================================================ 螢幕（轉盤 → 轉場 → FG）
    function buildScreen(wheel, fgc) {
        var c = newComp("SCREEN", 1080, 1920, D.DUR), V = M.video;
        L(c, fgc, { name: "FG_SCENE", start: T.fg });
        L(c, wheel, { name: "WHEEL_SCENE", start: 0, tout: T.flash + 0.3 });
        var gem = L(c, imp(V.gemGreen.file), { name: "Gem Rush", start: T.trans, pos: [540, 960], tin: T.trans, tout: T.flash + 0.35 });
        K2(gem.transform.scale, [[T.trans, 40], [T.trans + 0.25, 130], [T.flash + 0.3, 900]]);
        K(gem.transform.rotation, [[T.trans, -10], [T.flash + 0.3, 30]]);
        K(gem.transform.opacity, [[T.trans, 0], [T.trans + 0.1, 100], [T.flash + 0.15, 100], [T.flash + 0.35, 0]]);
        gem.motionBlur = true;
        fx(c, "wipeGold", T.trans + 0.1, [540, 960], 320);
        var flash = rectFill(c, "Flash", 1080, 1920, [1, 1, 1], [540, 960]);
        K(flash.transform.opacity, [[T.flash - 0.2, 0], [T.flash, 100], [T.flash + 0.35, 0]]);
        flash.inPoint = T.flash - 0.2;
        flash.outPoint = T.flash + 0.4;
        c.motionBlur = true;
        return c;
    }

    // ================================================================ 成品：賭場 + 曲面機台 + 音效
    function buildAD(screen) {
        var TJ = T.jp !== undefined ? T.jp : T.plus;  // 推近：彩金字卡或 +N 字卡出現時
        var c = newComp("AD_SpicyFortunes", 1080, 1920, D.DUR), cab = M.cabinet, A = M.audio, i;
        if (!D.cabinet) {
            // 不放機台：遊戲畫面滿版；鏡頭推近只在事件瞬間，幅度小（不裁掉要讀的資訊）
            var full = L(c, screen, { name: "SCREEN", pos: [540, 960] });
            K2(full.transform.scale, [[0, 100], [T.stop, 100], [T.stop + 0.15, 104], [T.stop + 0.55, 104], [TJ - 0.05, 101.5],
                [TJ + 0.2, 104.5], [T.trans, 105], [T.flash, 100], [T.fire, 100], [T.fire + 0.2, 104], [T.fire + 1.6, 104], [T.collect, 101.5],
                [T.big, 101.5], [T.big + 0.2, 106], [T.big + 0.5, 104], [D.DUR, 105]]);
            addAudio(c, A);
            return c;
        }
        var bg = L(c, imp("assets/bg/casino.jpg"), { name: "Casino", pos: [540, 960] });
        K2(bg.transform.scale, [[0, 100], [D.DUR, 106]]);
        var rig = nul(c, "Cabinet Rig", [540, 975]);
        // 鏡頭：基準景別 → 事件瞬間快速推近、短停 → 回彈（停輪、彩金、噴火、BIG WIN）；FG 開頭在白光裡換回基準
        K2(rig.transform.scale, [[0, 91], [T.stop, 91.5], [T.stop + 0.15, 95.5], [T.stop + 0.55, 95.5], [TJ - 0.05, 93],
            [TJ + 0.2, 97], [T.trans, 97.5], [T.flash, 92], [T.fire, 92.5], [T.fire + 0.2, 96], [T.fire + 1.6, 96], [T.collect, 94],
            [T.big, 94], [T.big + 0.2, 99], [T.big + 0.5, 97], [D.DUR, 99]]);
        rig.transform.position.expression = "value+wiggle(0.6,5)-value";
        rig.transform.rotation.expression = "wiggle(0.5,0.6)";
        var fcx = cab.w / 2, fcy = cab.h / 2, sb = cab.screen;
        var scr = L(c, screen, { name: "SCREEN", parent: rig, pos: [(sb[0] + sb[2]) / 2 - fcx, (sb[1] + sb[3]) / 2 - fcy],
            scale: (cab.screenScale || Math.max((sb[2] - sb[0]) / 1080, (sb[3] - sb[1]) / 1920) + 0.006) * 100 });
        var matte = L(c, imp(cab.matte), { name: "Screen Matte", parent: rig, pos: [0, 0] });
        matte.moveBefore(scr);
        // AE 2023 以後用 setTrackMatte；舊版 AE / EffectCraft 用上一層當遮罩
        if (typeof scr.setTrackMatte === "function") { scr.setTrackMatte(matte, TrackMatteType.ALPHA); }
        else { scr.trackMatteType = TrackMatteType.ALPHA; }
        if (!isEC) { matte.enabled = false; }
        var frame = L(c, imp(cab.frame), { name: "Cabinet Frame", parent: rig, pos: [0, 0] });
        frame.moveToBeginning();
        // 曲面螢幕：位移圖把每一列壓進螢幕那一列的寬度（中間窄、上下寬）
        if (cab.map) {
            var map = L(c, imp(cab.map), { name: "Screen Warp Map", pos: [540, 960] });
            map.moveToEnd();
            map.enabled = false;
            var e = scr.property("ADBE Effect Parade").addProperty("ADBE Displacement Map");
            var off = e.numProperties >= 9 ? 1 : 0;   // EffectCraft 多一個「Layer Source」參數
            e.property(1).setValue(map.index);
            e.property(2 + off).setValue(1);          // 水平：紅色
            e.property(3 + off).setValue(cab.mapMax);
            e.property(4 + off).setValue(2);          // 垂直：綠色（位移圖都是 50% 灰 = 不動）
            e.property(5 + off).setValue(0);
            e.property(6 + off).setValue(1);          // 位移圖置中
        }
        addAudio(c, A);
        c.motionBlur = true;
        return c;
    }
    function addAudio(c, A) {
        var music = L(c, imp(A.music.file), { name: "Music", start: 0, tout: D.DUR });
        db(music, -16);
        K(music.property("ADBE Audio Group").property("ADBE Audio Levels"), [[D.DUR - 1.2, [-16, -16]], [D.DUR, [-48, -48]]]);
        for (var i = 0; i < D.sfx.length; i++) {
            var s = D.sfx[i], au = A[s.k];
            if (!au) { report.warnings.push("missing sfx " + s.k); continue; }
            var al = L(c, imp(au.file), { name: "SFX " + s.k, start: s.t });
            if (al.outPoint > D.DUR) { al.outPoint = D.DUR; }
            db(al, s.db);
        }
    }

    app.beginUndoGroup("Spicy Fortunes AD");
    try {
        if (!isEC && (typeof SFS_AD_NEWPROJECT === "undefined" || SFS_AD_NEWPROJECT)) {
            if (!app.newProject()) { throw new Error("could not start a new project (the current one was not closed)"); }
        }
        folder("SpicyFortunes_AD");
        var wheel = buildWheel();
        var fgc = buildFG();
        var screen = buildScreen(wheel, fgc);
        var ad = buildAD(screen);
        try { ad.openInViewer(); } catch (eV) { /* ignore */ }
        if (!isEC && (typeof SFS_AD_SAVE === "undefined" || SFS_AD_SAVE)) {
            var out = new File(dir + "/SpicyFortunes_AD.aep");
            app.project.save(out);
            report.saved = out.fsName;
        }
        report.ok = true;
    } catch (err) {
        report.errors.push(err.toString() + (err.line ? " (line " + err.line + ")" : ""));
    } finally {
        app.endUndoGroup();
    }
    if (!isEC && !(typeof SFS_AD_QUIET !== "undefined" && SFS_AD_QUIET)) {
        alert(report.ok ? "Spicy Fortunes AD: done" + (report.saved ? "\n" + report.saved : "") + (report.warnings.length ? "\n" + report.warnings.join("\n") : "")
            : "Spicy Fortunes AD failed:\n" + report.errors.join("\n"));
    }
})();
