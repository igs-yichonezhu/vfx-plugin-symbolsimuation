# SlotFakeSpin

After Effects 老虎機假轉工具：ScriptUI 面板 + 給 agent 用的命令列。

- 開發人員丟符號圖 / 盤面圖、要做假轉或期待感設計時：用 `slot-fake-spin` skill（`.claude/skills/slot-fake-spin/`），節奏設計 / 審查可交給 `slot-anticipation-director` agent。
- 工作檔放 `work/<案子>/`（已在 .gitignore）。

## 開發

```
npm install
npm test          # 建置 dist/ + 跑全部測試（模擬 AE / ScriptUI）
npm run build     # 只建置
```

- 原始碼在 `src/`（ExtendScript，只能用 ES3：不能 let/const/箭頭函式/Array.forEach/JSON，保留字不能當屬性名）。`dist/` 是建置產物，不要手改，改完 `src/` 要重新建置並提交 `dist/`。
- `src/core.js` 是純邏輯（可在 Node 執行），AE DOM 只放 `src/ae.js`，面板在 `src/ui.js`，自動化入口 `src/apply.js`。
- `tools/sfs.js`（Node）與 `tools/render.py`（Python + Pillow）是給 agent 用的命令列與預覽。
- 改版本要同時改 `package.json` 和 `src/core.js` 的 `S.VERSION`（建置會檢查）。
- 介面文字、註解、文件用繁體中文。面板有英文版：介面字串一律包 `T("繁中原文 {0}", 參數)`（不要用 `+` 拼句子），並同步在 `src/i18n_en.js` 加英文（`npm test` 會檢查）。
