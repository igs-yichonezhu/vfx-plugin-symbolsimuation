/*
 * 極簡 After Effects DOM 模擬，只實作 SlotFakeSpin 用到的部分。
 * 目的：在 Node 裡跑完整建置流程，並用 Bezier 計算關鍵影格內插，驗證盤面正確。
 * 盡量模仿 AE 會丟錯的行為（例如有關鍵影格時 setValue、影響值超出範圍）。
 */
"use strict";
const fs = require("fs");
const path = require("path");

function install(globalObj, opts) {
  opts = opts || {};
  const g = globalObj;
  const imageSizes = opts.imageSizes || {};

  class Collection {
    constructor() { this._arr = []; }
    get length() { return this._arr.length; }
  }
  function indexable(coll) {
    return new Proxy(coll, {
      get(t, k) {
        if (typeof k === "string" && /^\d+$/.test(k)) {
          const v = t._arr[Number(k) - 1];
          if (v === undefined) throw new Error("index out of range: " + k);
          return v;
        }
        const v = t[k];
        return typeof v === "function" ? v.bind(t) : v;
      },
    });
  }

  // ---------------- File / Folder ----------------
  class File {
    constructor(p) { this.fsName = path.resolve(String(p)); this.encoding = "BINARY"; this._mode = null; this._buf = ""; }
    get name() { return encodeURI(path.basename(this.fsName)); }
    get exists() { return fs.existsSync(this.fsName) && fs.statSync(this.fsName).isFile(); }
    open(mode) { this._mode = mode; this._buf = mode === "r" ? fs.readFileSync(this.fsName, "utf8") : ""; return true; }
    read() { return this._buf; }
    write(s) { this._buf += s; return true; }
    close() { if (this._mode === "w") fs.writeFileSync(this.fsName, this._buf); this._mode = null; return true; }
  }
  class Folder {
    constructor(p) { this.fsName = path.resolve(String(p)); }
    get name() { return encodeURI(path.basename(this.fsName)); }
    get exists() { return fs.existsSync(this.fsName); }
    getFiles() {
      return fs.readdirSync(this.fsName).map((n) => {
        const full = path.join(this.fsName, n);
        return fs.statSync(full).isDirectory() ? new Folder(full) : new File(full);
      });
    }
  }
  File.saveDialog = () => g.__dialogResult || null;
  File.openDialog = () => g.__dialogResult || null;
  Folder.selectDialog = () => g.__dialogResult || null;

  // ---------------- Properties ----------------
  const KeyframeInterpolationType = { LINEAR: 6612, BEZIER: 6613, HOLD: 6614 };
  class KeyframeEase {
    constructor(speed, influence) {
      if (typeof speed !== "number" || isNaN(speed)) throw new Error("KeyframeEase speed must be a number");
      if (!(influence >= 0.1 && influence <= 100)) throw new Error("KeyframeEase influence out of range: " + influence);
      this.speed = speed; this.influence = influence;
    }
  }
  class MarkerValue { constructor(comment) { this.comment = comment; } }

  class Property {
    constructor(name, matchName, value, opts) {
      this.name = name; this.matchName = matchName; this.value = value;
      this.keys = []; this.expression = ""; this.dims = Array.isArray(value) ? value.length : 1;
      this.spatial = !!(opts && opts.spatial); this._sep = null; this._owner = opts && opts.owner;
      this.canSeparate = !!(opts && opts.canSeparate);
    }
    get numKeys() { return this.keys.length; }
    get dimensionsSeparated() { return !!this._sep; }
    set dimensionsSeparated(v) {
      if (!this.canSeparate) throw new Error("cannot separate " + this.name);
      if (v && !this._sep) {
        if (this.keys.length) throw new Error("mock: separate with keys not supported");
        this._sep = this.value.map((c, i) => new Property(["X", "Y", "Z"][i] + " Position", this.matchName + "_" + i, c));
      }
    }
    setValue(v) {
      if (this.keys.length) throw new Error("Can not set value: property " + this.name + " has keyframes");
      if (this._sep) throw new Error("setValue on separated position");
      this._check(v); this.value = v;
    }
    _check(v) {
      if (this.dims > 1 && (!Array.isArray(v) || v.length < 2)) throw new Error(this.name + " expects array");
      if (this.dims === 1 && typeof v !== "number" && !(v instanceof MarkerValue)) throw new Error(this.name + " expects number, got " + v);
      const arr = Array.isArray(v) ? v : [v];
      arr.forEach((x) => { if (typeof x === "number" && !isFinite(x)) throw new Error("non-finite value"); });
    }
    addKey(t) {
      if (typeof t !== "number" || !isFinite(t)) throw new Error("bad key time");
      const existing = this.keys.findIndex((k) => Math.abs(k.t - t) < 1e-9);
      if (existing >= 0) return existing + 1;
      const k = { t, v: this.valueAtTime(t), inI: KeyframeInterpolationType.LINEAR, outI: KeyframeInterpolationType.LINEAR, inE: null, outE: null };
      this.keys.push(k);
      this.keys.sort((a, b) => a.t - b.t);
      return this.keys.indexOf(k) + 1;
    }
    _key(i) { const k = this.keys[i - 1]; if (!k) throw new Error("key index out of range: " + i); return k; }
    setValueAtKey(i, v) { this._check(v); this._key(i).v = v; }
    setValueAtTime(t, v) { const i = this.addKey(t); this.setValueAtKey(i, v); }
    keyTime(i) { return this._key(i).t; }
    keyValue(i) { return this._key(i).v; }
    removeKey(i) { this._key(i); this.keys.splice(i - 1, 1); }
    setInterpolationTypeAtKey(i, inT, outT) { const k = this._key(i); k.inI = inT; k.outI = outT === undefined ? inT : outT; }
    setTemporalAutoBezierAtKey(i) { this._key(i); }
    setTemporalContinuousAtKey(i) { this._key(i); }
    setTemporalEaseAtKey(i, inE, outE) {
      const k = this._key(i);
      const n = this.spatial ? 1 : this.dims;
      if (!Array.isArray(inE) || inE.length !== n || !Array.isArray(outE) || outE.length !== n) {
        throw new Error("setTemporalEaseAtKey: ease arrays must have " + n + " element(s)");
      }
      [...inE, ...outE].forEach((e) => { if (!(e instanceof KeyframeEase)) throw new Error("not a KeyframeEase"); });
      k.inE = inE; k.outE = outE;
      k.inI = KeyframeInterpolationType.BEZIER; k.outI = KeyframeInterpolationType.BEZIER;
    }
    valueAtTime(t) {
      const K = this.keys;
      if (!K.length) return this.value;
      if (t <= K[0].t) return K[0].v;
      if (t >= K[K.length - 1].t) return K[K.length - 1].v;
      let j = 0;
      while (K[j + 1].t < t) j++;
      const a = K[j], b = K[j + 1];
      const dt = b.t - a.t;
      if (typeof a.v !== "number") return a.v;
      if (a.outI !== KeyframeInterpolationType.BEZIER || b.inI !== KeyframeInterpolationType.BEZIER || !a.outE || !b.inE) {
        return a.v + (b.v - a.v) * (t - a.t) / dt;
      }
      // AE 時間曲線：控制點 = 影響值 × 區段時間，斜率 = 速度
      let i1 = a.outE[0].influence / 100, i2 = b.inE[0].influence / 100;
      if (i1 + i2 > 1) { const s = i1 + i2; i1 /= s; i2 /= s; }
      const x0 = a.t, x1 = a.t + i1 * dt, x2 = b.t - i2 * dt, x3 = b.t;
      const y0 = a.v, y1 = a.v + a.outE[0].speed * i1 * dt, y2 = b.v - b.inE[0].speed * i2 * dt, y3 = b.v;
      const bez = (p0, p1, p2, p3, u) => {
        const m = 1 - u;
        return m * m * m * p0 + 3 * m * m * u * p1 + 3 * m * u * u * p2 + u * u * u * p3;
      };
      let lo = 0, hi = 1;
      for (let n = 0; n < 60; n++) {
        const mid = (lo + hi) / 2;
        if (bez(x0, x1, x2, x3, mid) < t) lo = mid; else hi = mid;
      }
      return bez(y0, y1, y2, y3, (lo + hi) / 2);
    }
  }

  class TransformGroup {
    constructor(layer, comp) {
      const cx = comp.width / 2, cy = comp.height / 2;
      const src = layer.source;
      const aw = src ? src.width / 2 : 0, ah = src ? src.height / 2 : 0;
      this.anchorPoint = new Property("Anchor Point", "ADBE Anchor Point", [aw, ah]);
      this.position = new Property("Position", "ADBE Position", [cx, cy], { spatial: true, canSeparate: true });
      this.scale = new Property("Scale", "ADBE Scale", [100, 100]);
      this.rotation = new Property("Rotation", "ADBE Rotate Z", 0);
      this.opacity = new Property("Opacity", "ADBE Opacity", 100);
    }
    property(mn) {
      const pos = this.position;
      if (mn === "ADBE Position_0" || mn === "X Position") { if (!pos._sep) throw new Error("not separated"); return pos._sep[0]; }
      if (mn === "ADBE Position_1" || mn === "Y Position") { if (!pos._sep) throw new Error("not separated"); return pos._sep[1]; }
      for (const k of ["anchorPoint", "position", "scale", "rotation", "opacity"]) {
        if (this[k].matchName === mn || this[k].name === mn) return this[k];
      }
      return null;
    }
  }

  // ---------------- Items ----------------
  let nextId = 1;
  class Item {
    constructor(project, name) {
      this.id = nextId++; this._name = name; this.comment = ""; this._project = project;
      this.parentFolder = project.rootFolder || null; this.label = 0; this.selected = false;
    }
    get name() { return this._name; }
    set name(v) { this._name = String(v); }
    remove() {
      if (this.usedIn && this.usedIn.length) throw new Error("mock: removing item still in use: " + this.name);
      this._project._remove(this);
    }
    get usedIn() {
      return this._project._items.filter((it) => it instanceof CompItem && it._layers.some((l) => l.source === this));
    }
  }
  class FolderItem extends Item {}
  class AVItem extends Item {
    constructor(project, name, w, h, dur, fps) {
      super(project, name); this.width = w; this.height = h; this.pixelAspect = 1; this.duration = dur; this.frameRate = fps;
    }
  }
  class FootageItem extends AVItem {
    constructor(project, name, w, h, file, opts) {
      super(project, name, w, h, 0, 0);
      this.mainSource = file ? { file } : { color: [0, 0, 0] };
      this.isSolid = !!(opts && opts.solid);
    }
  }
  class CompItem extends AVItem {
    constructor(project, name, w, h, par, dur, fps) {
      [w, h].forEach((d) => { if (!Number.isInteger(d) || d < 4 || d > 30000) throw new Error("bad comp size: " + d); });
      if (!(dur > 0 && dur <= 10800)) throw new Error("bad comp duration: " + dur);
      if (!(fps > 0)) throw new Error("bad fps");
      super(project, name, w, h, dur, fps);
      this.pixelAspect = par; this._layers = []; this.motionBlur = false; this.shutterAngle = 180; this.shutterPhase = -90;
      this.hideShyLayers = false; this.time = 0; this.openedInViewer = false;
      const self = this;
      this.layers = {
        add(item) { return self._addLayer(new Layer(self, item)); },
        addNull(duration) {
          const solid = new FootageItem(project, "Null " + (project._items.length + 1), 100, 100, null, { solid: true });
          project._add(solid);
          const l = new Layer(self, solid); l.nullLayer = true; l.name = "Null " + (self._layers.length + 1);
          if (duration !== undefined) l.outPoint = duration;
          return self._addLayer(l);
        },
        get length() { return self._layers.length; },
      };
    }
    set width(v) { if (this._layers && (!Number.isInteger(v) || v < 4)) throw new Error("bad width " + v); this._w = v; }
    get width() { return this._w; }
    set height(v) { if (this._layers && (!Number.isInteger(v) || v < 4)) throw new Error("bad height " + v); this._h = v; }
    get height() { return this._h; }
    _addLayer(l) { this._layers.unshift(l); return l; }
    get numLayers() { return this._layers.length; }
    layer(i) { const l = this._layers[i - 1]; if (!l) throw new Error("layer index out of range " + i); return l; }
    get selectedLayers() { return this._layers.filter((l) => l.selected); }
    openInViewer() { this.openedInViewer = true; }
  }

  class Layer {
    constructor(comp, source) {
      this.containingComp = comp; this.source = source; this._name = source ? source.name : "Layer";
      this.parent = null; this.comment = ""; this.label = 0; this.shy = false; this.motionBlur = false;
      this.nullLayer = false; this.selected = false; this.startTime = 0; this.inPoint = 0;
      this._timeRemap = false;
      const srcDur = source instanceof CompItem ? source.duration : null;
      this._outPoint = srcDur === null ? Math.min(comp.duration, 5) : Math.min(srcDur, comp.duration);
      this.transform = new TransformGroup(this, comp);
      this._marker = new Property("Marker", "ADBE Marker", new MarkerValue(""));
      this._remap = null;
    }
    get name() { return this._name; }
    set name(v) { this._name = String(v); }
    get index() { return this.containingComp._layers.indexOf(this) + 1; }
    get outPoint() { return this._outPoint; }
    set outPoint(v) {
      if (this.source instanceof CompItem && !this._timeRemap && v > this.startTime + this.source.duration + 1e-9) {
        throw new Error("mock: cannot extend comp layer beyond source without time remap");
      }
      this._outPoint = v;
    }
    get timeRemapEnabled() { return this._timeRemap; }
    set timeRemapEnabled(v) {
      this._timeRemap = !!v;
      if (v && !this._remap) {
        this._remap = new Property("Time Remap", "ADBE Time Remapping", 0);
        this._remap.setValueAtTime(0, 0);
        this._remap.setValueAtTime(this.source.duration, this.source.duration);
      }
    }
    property(mn) {
      if (mn === "ADBE Marker" || mn === "Marker") return this._marker;
      if (mn === "ADBE Time Remapping" || mn === "Time Remap") {
        if (!this._timeRemap) throw new Error("time remap not enabled");
        return this._remap;
      }
      if (mn === "ADBE Transform Group" || mn === "Transform") return this.transform;
      return null;
    }
    get position() { return this.transform.position; }
    moveToBeginning() { const L = this.containingComp._layers; L.splice(L.indexOf(this), 1); L.unshift(this); }
    remove() { const L = this.containingComp._layers; L.splice(L.indexOf(this), 1); }
  }

  class Project {
    constructor() {
      this._items = [];
      this.rootFolder = null;
      this.rootFolder = new FolderItem(this, "Root");
      this.activeItem = null;
      const self = this;
      const coll = new Collection();
      coll.addComp = (name, w, h, par, dur, fps) => self._add(new CompItem(self, name, w, h, par, dur, fps));
      coll.addFolder = (name) => self._add(new FolderItem(self, name));
      Object.defineProperty(coll, "_arr", { get: () => self._items });
      this.items = indexable(coll);
    }
    _add(it) { this._items.push(it); return it; }
    _remove(it) {
      const i = this._items.indexOf(it); if (i >= 0) this._items.splice(i, 1);
      if (this.activeItem === it) this.activeItem = null;
    }
    get numItems() { return this._items.length; }
    item(i) { return this._items[i - 1]; }
    itemByID(id) { return this._items.find((it) => it.id === id) || null; }
    get selection() { return this._items.filter((it) => it.selected); }
    importFile(io) {
      const f = io.file;
      if (!f.exists) throw new Error("file missing " + f.fsName);
      const size = imageSizes[path.basename(f.fsName)] || [256, 256];
      return this._add(new FootageItem(this, path.basename(f.fsName), size[0], size[1], f));
    }
  }

  const ImportAsType = { FOOTAGE: 1, COMP: 2, COMP_CROPPED_LAYERS: 3, PROJECT: 4 };
  class ImportOptions {
    constructor(file) { this.file = file; this.importAs = ImportAsType.FOOTAGE; this.sequence = false; }
    canImportAs(t) { return t === ImportAsType.FOOTAGE && /\.(png|jpe?g|psd|tga|tiff?|gif|bmp|ai|eps|exr|dpx|webp)$/i.test(this.file.fsName); }
  }

  const settings = {};
  const app = {
    project: new Project(),
    _undo: 0,
    _undoMax: 0,
    beginUndoGroup() { this._undo++; this._undoMax = Math.max(this._undoMax, this._undo); },
    endUndoGroup() { if (this._undo <= 0) throw new Error("endUndoGroup without begin"); this._undo--; },
    settings: {
      haveSetting: (s, k) => Object.prototype.hasOwnProperty.call(settings, s + "/" + k),
      getSetting: (s, k) => settings[s + "/" + k],
      saveSetting: (s, k, v) => { if (typeof v !== "string") throw new Error("setting must be string"); settings[s + "/" + k] = v; },
    },
    preferences: { getPrefAsLong: () => 1 },
  };

  Object.assign(g, {
    app, File, Folder, CompItem, FootageItem, FolderItem, AVItem, Layer, Property,
    KeyframeEase, KeyframeInterpolationType, MarkerValue, ImportOptions, ImportAsType,
    alert: (m) => { (g.__alerts = g.__alerts || []).push(String(m)); },
    confirm: () => (g.__confirm === undefined ? true : g.__confirm),
    prompt: (m, d) => (g.__prompt === undefined ? d : g.__prompt),
    $: { os: "Windows 10" },
  });
  return app;
}

module.exports = { install };
