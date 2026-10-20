# Fortune Doors：彩金滾輪（MEGA / MAJOR）

照競品影片（Fortune Doors: Sapphire Sage，祿盤 6 格填滿後的 JACKPOT SPIN）還原上方的直式彩金滾輪：高速往下捲 → 長長的緩停 → MEGA 停輪前慢慢擦身而過 → 停在 MAJOR。

做法是 **1 輪 × 1 列**的盤面，上下露出鄰居（`layout.peek`），符號只有 MAJOR 和 MEGA（MAJOR 放 4 份當填充，MEGA 機率 1/5）。

| 檔案 | 說明 |
| --- | --- |
| `preset.json` | 平面版：格子 560×290、上下露出 140、牌間距 26；停輪 3.2 秒、亂數種子 65 |
| `preset_drum.json` | 滾筒版用：上下露出 80、牌間距 10；停輪 3.25 秒、亂數種子 41 |
| `make_assets.py` | 產生 `symbols/`（MAJOR / MEGA 牌，只裁牌面內容、統一加金框）、`bg.png`（影片畫面，滾輪窗蓋成金色滾筒）、`pointers.png`（固定不動的金色指針，疊在最上層） |
| `drum_prism.jsx` | 六角柱滾筒**原型**：在轉輪合成的符號圖層加表達式，把轉帶位置換成柱面角度（每面 60°、透視、越轉離正面越暗）。轉動的關鍵影格不變 |

## 重現

```
python make_assets.py --assets <FortuneDoors 素材資料夾> --frame mega_frame.png    # mega_frame.png = 影片第 20.1 秒那一格
```

1. 建一個 1920×1080、30fps、7 秒的合成 `JP`，最底層放 `bg.png`。
2. `node tools/sfs.js ec preset.json --project JP.ecproj --comp JP --mode new`（AE：`ae preset.json --comp JP`）。盤面依 `layout.position` 放到 (800, 465)。
3. 把 `pointers.png` 加到 `JP` 最上層。
4. 滾筒版：改用 `preset_drum.json` 建，再執行 `drum_prism.jsx`（EffectCraft：`effectcraft-cli script drum_prism.jsx --project JP.ecproj --save`；AE：開著專案用「檔案 > 指令碼 > 執行指令碼檔案」）。

## 為什麼是這個亂數種子

轉帶由上到下是 `[緩衝][結果][填充…][起始][緩衝]`，向下轉。結果正下方那格（轉帶第 4 格）就是停輪前最後經過、停妥後露在下方的那格。挑種子的條件：這格是 MEGA、結果上方是 MAJOR、整條轉帶 3～5 個 MEGA，而且 MEGA 經過視窗中心的時間要對上影片。

| 合成時間（影片 = +16.95 秒） | 影片 | 平面版（種子 65） |
| --- | --- | --- |
| 0.50 | 起轉 | 起轉 |
| ≈1.55 | MEGA 高速掃過 | 1.57 |
| ≈2.95 | MEGA 慢慢擦身（差一點） | 2.81 |
| ≈3.45 | MAJOR 到正中間，下方露出 MEGA | 3.45 |
| ≈3.70 | 停輪 | 3.70（R1 STOP） |

## 滾筒

影片的滾筒是六角柱：每塊牌子是一個平面、相鄰差 60°，上下鄰居壓成約一半高而且被窗口裁掉。`drum_prism.jsx` 只是原型（還沒做進工具）：滾筒兩側的金色端蓋、牌面金框這些美術沒有做。
