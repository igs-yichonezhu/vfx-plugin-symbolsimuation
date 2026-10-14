/*
 * 極簡 ScriptUI 模擬：可以建出面板樹、觸發 onClick / onChange，並呼叫 onDraw 檢查繪圖程式碼不會出錯。
 */
"use strict";

function install(g) {
  const graphicsCalls = [];
  function makeGraphics() {
    return {
      BrushType: { SOLID_COLOR: 1 },
      PenType: { SOLID_COLOR: 1 },
      font: { name: "dialog", size: 10 },
      newPath() { graphicsCalls.push("newPath"); },
      rectPath(x, y, w, h) { [x, y, w, h].forEach(check); graphicsCalls.push("rectPath"); },
      fillPath(b) { if (!b || b.kind !== "brush") throw new Error("fillPath needs brush"); },
      strokePath(p) { if (!p || p.kind !== "pen") throw new Error("strokePath needs pen"); },
      newBrush(t, c) { checkColor(c); return { kind: "brush", c }; },
      newPen(t, c, w) { checkColor(c); return { kind: "pen", c, w }; },
      drawImage(img, x, y, w, h) { [x, y, w, h].forEach(check); if (!img || !img.size) throw new Error("bad image"); graphicsCalls.push("drawImage"); },
      drawString(s, pen, x, y, font) { if (typeof s !== "string") throw new Error("drawString text"); [x, y].forEach(check); if (!pen || pen.kind !== "pen") throw new Error("pen"); graphicsCalls.push("drawString:" + s); },
      measureString(s) { return [String(s).length * 6, 12]; },
    };
  }
  function check(n) { if (typeof n !== "number" || !isFinite(n)) throw new Error("graphics: bad number " + n); }
  function checkColor(c) { if (!Array.isArray(c) || c.length < 3) throw new Error("graphics: bad color"); }

  const VALID = ["group", "panel", "tabbedpanel", "tab", "button", "iconbutton", "statictext", "edittext",
    "checkbox", "radiobutton", "dropdownlist", "listbox", "slider", "progressbar", "image", "item"];

  class Element {
    constructor(type, parent, text, props) {
      if (VALID.indexOf(type) < 0) throw new Error("ScriptUI: unknown element type " + type);
      this.type = type; this.parent = parent; this.children = []; this.text = text === undefined ? "" : text;
      this.properties = props || {}; this.visible = true; this.enabled = true; this.value = false;
      this.preferredSize = { width: -1, height: -1 };
      this.size = [60, 40];
      this.graphics = makeGraphics();
      this.items = []; this._selection = null;
      this.layout = { layout() {}, resize() {} };
    }
    add(type, bounds, text, props) {
      if (type === "item") {
        if (this.type !== "listbox" && this.type !== "dropdownlist") throw new Error("item only in list");
        // ScriptUI: list.add("item", text[, index])
        const it = { text: String(bounds), index: this.items.length, selected: false, checked: false };
        this.items.push(it);
        return it;
      }
      const el = new Element(type, this, Array.isArray(text) ? "" : text, props);
      if (Array.isArray(text)) text.forEach((t) => el.add("item", t));
      this.children.push(el);
      return el;
    }
    set preferredSize(v) {
      if (Array.isArray(v)) { this._ps = { width: v[0], height: v[1] }; this.size = [v[0] > 0 ? v[0] : 60, v[1] > 0 ? v[1] : 40]; }
      else this._ps = v;
    }
    get preferredSize() { return this._ps; }
    remove(child) {
      const i = typeof child === "number" ? child : this.children.indexOf(child);
      if (this.type === "listbox" || this.type === "dropdownlist") {
        this.items.splice(this.items.indexOf(child), 1); return;
      }
      if (i < 0) throw new Error("remove: not a child");
      this.children.splice(i, 1);
    }
    removeAll() { this.items = []; this._selection = null; }
    get selection() { return this._selection; }
    set selection(v) {
      if (v === null || v === undefined) { this._selection = null; return; }
      if (typeof v === "number") {
        if (v < 0 || v >= this.items.length) throw new Error("selection index out of range " + v);
        v = this.items[v];
      }
      if (this.type === "listbox" && this.properties.multiselect) {
        this._selection = Array.isArray(v) ? v : [v];
      } else {
        if (Array.isArray(v)) throw new Error("single-select list given array");
        this._selection = v;
      }
    }
    hide() { this.visible = false; if (this.onDraw) this.onDraw(); }
    show() { this.visible = true; }
    notify(ev) { const h = this[ev || "onClick"]; if (h) h.call(this); }
    center() {}
    close(v) { this.closed = v; }
  }

  class Window extends Element {
    constructor(type, title) { super("group", null, title); this.windowType = type; g.__windows = (g.__windows || []).concat([this]); }
    show() {
      this.shown = true;
      if (this.windowType === "dialog" && g.__onDialog) { const r = g.__onDialog(this); return r; }
      return 1;
    }
  }
  class Panel extends Element { constructor() { super("panel", null, ""); } }

  g.Window = Window;
  g.Panel = Panel;
  g.ScriptUI = {
    environment: { keyboardState: { altKey: false, shiftKey: false, ctrlKey: false, metaKey: false } },
    newImage(f) { return { size: [256, 256], path: f.fsName }; },
    newFont(name, style, size) { return { name, style, size }; },
  };
  return { graphicsCalls };
}

// 依序走訪元素樹
function walk(el, fn) {
  fn(el);
  (el.children || []).forEach((c) => walk(c, fn));
}

function find(root, pred) {
  let found = null;
  walk(root, (el) => { if (!found && pred(el)) found = el; });
  return found;
}

function findByText(root, type, text) {
  return find(root, (el) => el.type === type && el.text === text);
}

module.exports = { install, walk, find, findByText };
