# Fortune Doors：祿盤 Hold & Spin（6 格重轉）

照競品影片（Fortune Doors: Sapphire Sage，「祿」次級 Hold & Spin）還原 3 欄 × 2 列的格子重轉：每格各自轉，落下的金幣 / MINI BONUS 鎖住，空格（紫色圓球）每回合重轉；有新符號落下時剩餘次數重設為 3，6 格全滿就結束（接著是 JACKPOT SPIN）。

起始：右邊一欄已經鎖住 200 和 MINI，剩 1 次（LAST SPIN）。4 個回合：

| 回合 | 起轉（秒） | 結果 | 剩餘次數 |
| --- | --- | --- | --- |
| 1 | 3.0 | 左下 800、中上 200 | 1 → 3 |
| 2 | 6.7 | 左上 800 | 3 |
| 3 | 9.25 | 只剩中下一格：期待轉（多轉、緩停、繞框），落空 | 2 |
| 4 | 12.2 | 中下 1200 → 6 格全滿 | — |

最終盤面：`800 200 200 / 800 1200 MINI`。

| 檔案 | 說明 |
| --- | --- |
| `preset.json` | `mode: "holdspin"`：格子 240、間距 33×18、`hs.rounds` 是上面 4 個回合；盤面中心 (848, 448) |
| `make_hs_assets.py` | 產生 `symbols/`：金幣 C200 / C400 / C800 / C1200（空白金幣寫上面額）、MINI、BLANK（影片裡的空格），都挖成圓形透明背景；`bg.png`（影片第 0 秒，6 個格子蓋成盤面紅） |
| `setup_bg.jsx` | 在專案裡建 1920×1080、30fps、17.5 秒的 `HS` 合成，最底層放 `bg.png` |

## 重現

```
python make_hs_assets.py --assets <FortuneDoors 素材資料夾> --frame f0.png    # f0.png = 影片第 0 秒那一格
node tools/sfs.js check preset.json
node tools/sfs.js ec preset.json --project HS.ecproj --comp HS --mode new --render hs.mp4   # 先在 HS.ecproj 執行 setup_bg.jsx
```

After Effects：開新專案、執行 `setup_bg.jsx`，再 `node tools/sfs.js ae preset.json --comp HS`。

標記：`SFS HS ROUND n`（回合起轉）、`HS SPINS k`（剩餘次數）、`HS CELL 2-1 LOCK C800`（格子鎖住，格子一律「列-欄」）、`HS FULL`。

注意：EffectCraft 0.3.1 會把同一個資料夾裡 `C200.png`、`C400.png` 這種檔名結尾是數字的圖檔接成連續圖檔，`sfs.js ec` 會自動把它們複製到各自的資料夾再匯入。格子是方形視窗，影片裡的圓洞遮罩要自己加。
