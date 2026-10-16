#!/usr/bin/env node
/*
 * SlotFakeSpin 測試入口：
 *  core.test.js  純邏輯（節奏、減速曲線、連線、驗證）
 *  ae.test.js    在模擬 AE 中建置，用 Bezier 內插驗證畫面上的符號、繞框、連線
 *  ui.test.js    整包 dist 載入模擬 AE + ScriptUI，操作面板跑完整流程
 *  cli.test.js   agent 用的命令列（tools/sfs.js）與 AE 自動化入口（SlotFakeSpin_apply.jsx）
 *  i18n.test.js  介面語言（繁中 / 英文）：對照表完整、語言偵測、英文面板、切換語言
 *  ec.test.js    EffectCraft 後端（tools/ec.js、模擬 EffectCraft、假的 effectcraft-cli）
 */
"use strict";
const H = require("./helpers");
require("./core.test");
require("./ae.test");
require("./ui.test");
require("./cli.test");
require("./i18n.test");
require("./ec.test");
console.log("\n" + H.results.passed + " passed, " + H.results.failed + " failed");
process.exit(H.results.failed ? 1 : 0);
