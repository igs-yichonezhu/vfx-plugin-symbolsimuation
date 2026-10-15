# tools/sfs.js 指令與設定速查

在工具根目錄執行 `node tools/sfs.js help` 可以看完整說明。`P` = 設定檔路徑。

## 指令

| 目的 | 指令 |
| --- | --- |
| 建立設定檔 | `init --symbols <資料夾> --out P [--reels 5 --rows 3] [--cell 200\|200x180]` |
| 從 PSD 建立 | `from-psd <檔案.psd> --out P [--names 塔可=TACO,...] [--triggers A,B] [--wilds W]`（見下方「from-psd」） |
| 看摘要 | `show P` |
| 盤面 | `board P --start "A K Q J A / ..." --end "..."`（`/` = 換行，或 `@檔案`） |
| 符號 | `symbol P <名稱> --filler off`、`symbol P <名稱> --rename SC`、`symbol P <名稱> --scale 87`（這個符號縮小到 87%） |
| 改設定 | `set P spin.stopOrder=5,4,3,2,1 frame.color=#FF3366 ...`（改 spin.* 會自動重新產生各輪，除非已手動微調過；改 lineGen.* 會重新排所有連線的顯示時間）；`set P layout.position=540,1434`（盤面中心位置，`layout.position=` 清掉 = 置中） |
| 逐輪微調 | `reel P 5 stop=+0.3 decelCurve=soft frame=on frameStart=2.1`（`+/-` = 相對；會關掉自動套用） |
| 重新產生各輪 | `regen P`（放棄手動微調、回到快速節奏） |
| 期待感建議 | `suggest P`（只看理由）、`suggest P --apply`（寫入） |
| 連線 | `lines P --detect`、`--clear`、`--timing`、`--add 1,2,3,2,1:5:0.3+1.2`、`--add 2,0,1,0,2:box` |
| 檢查 | `check P [--fps 30]`、`check P --json` |
| 預覽 | `render P --boards b.png --sheet k.png --gif a.gif [--scale 0.5] [--fps 30]` |
| 符號總覽 | `symbols-sheet <資料夾\|P> out.png` |
| 送進 AE | `ae P --comp "合成名稱" [--mode auto\|new\|update] [--position x,y\|center] [--frames auto] [--out 資料夾]` |

`ae` 的 `--mode`：
- `auto`（預設）：合成裡有選取的盤面、或只有一個盤面就更新它；否則新建。
- `new`：一定新建。
- `update`：一定更新（找不到就報錯）。可用 `--board SFS_Board_01` 指定。

盤面位置：設定檔有 `layout.position` 時，建立和更新都會把盤面中心放到合成的這個位置（錨點設在盤面中心）；沒有就新建時放合成中央、更新時不動。`--position` 只改這一次（`center` = 不套用）。`--dry-run` 會印出這次的盤面位置，啟動腳本裡也帶著（`position`）。

`ae` 會回報：建立的盤面合成、全部停妥 / 演出結束時間、標記（秒 + 影格）、以及 AE 實際算出的檢查畫面 PNG 路徑（用 Read 看）。

## from-psd

```
node tools/sfs.js from-psd <檔案.psd> --out work/<案子>/preset.json [選項]
```
需要 Python 3 + Pillow + psd-tools（`pip install pillow psd-tools`；工具不會自動安裝）。

| 選項 | 說明 | 預設 |
| --- | --- | --- |
| `--group` | 符號群組名稱 | SYMBOLS |
| `--reel-layer` | 轉輪窗圖層（量格子 / 位置、做背景） | 轉輪 |
| `--frame-layer` | 做背景時一起蓋回去的轉輪框（找不到就略過） | 轉輪框 |
| `--names` | 名稱對照：`塔可=TACO,粉鑽=PINK` 或 JSON 檔 `{"塔可": "TACO"}` | 保留原名 |
| `--triggers` / `--wilds` | 觸發型（不當填充、不算連線、`antRule.symbols`）/ 百搭 | 依名稱自動判斷 |
| `--reels` / `--rows` | 指定輪數 / 列數 | 從分隔線偵測 |
| `--cell` / `--gap` | 指定格子 `200x200` / 間距 `4x0`（只給一個數字 = 輪距，列距 0） | 從轉輪窗量 |
| `--bg` / `--no-bg` | 背景圖路徑 / 不輸出 | `<設定檔資料夾>/bg.png` |
| `--symbols-dir` | 符號 PNG 輸出資料夾 | `<設定檔資料夾>/symbols` |
| `--fit-oversize` | 比格子大的符號自動設 `scale` 縮到放得下 | 只警告 |

做法：
- **符號**：符號群組底下每個圖層 = 一個符號（不到 1.5 格大的子群組合成一個符號，大的當資料夾往下找）。「塔可 拷貝」「塔可 拷貝 2」「copy」算同一個；像素完全相同的圖層只留一個；隱藏圖層也會輸出成符號（不放進盤面）。PNG 是圖層本身的像素（含遮色片、剪裁圖層，不含圖層樣式）。
- **結果盤面**：看得到的符號依 bbox 中心點分配到輪 / 列；同一格有好幾個時取最上層（例如 Q 被辣椒人蓋住 → 辣椒人），被蓋住的會列出來。空格子先用亂數補上並警告。
- **格子**：轉輪窗的深色直線 = 輪與輪的分隔線，線的中心距 = 格寬 + 輪距、線與線之間亮的寬度 = 格寬（離 10 的倍數不到 1px 就取 10 的倍數）。沒有橫線時列數 = 窗內高 / 格寬、格高接近格寬就是正方形。盤面中心離畫面中線不到 1px 就對齊中線。找不到轉輪窗時改用符號中心點估計（會警告）。
- **位置**：盤面中心寫進 `layout.position`；`scaleMode` = `none`（符號維持 PSD 大小）。
- **背景**：PSD 裡 Photoshop 存的合成圖，蓋回轉輪框 + 轉輪窗（符號就不見了），再補回在它們上面、和轉輪區域重疊的其他圖層。不重算整份 PSD（psd-tools 算漸層疊加等樣式要 scipy，結果也和 Photoshop 不同）。PSD 存檔時沒勾「最大相容性」就沒有合成圖，不會輸出背景。
- **起始盤面**：亂數，不放觸發符號、沒有連線（和 `init` 同規則）。
- 比格子大的符號在轉輪合成裡會被裁切：輸出會警告並給 `symbol P <名稱> --scale <%>` 指令。

## 設定欄位

時間單位都是秒；「各輪」與「連線」的時間是相對的（各輪從開始時間算、連線從全部停妥算）。

### spin（快速節奏 / 手感）
| 欄位 | 說明 | 預設 |
| --- | --- | --- |
| startTime | 開始轉動（目標合成時間） | 0 |
| startOrder / startStagger | 起轉順序 / 間隔 | 1..n / 0 |
| stopOrder | 停輪順序：`,` 先後、`+` 同時 | 1..n |
| firstStop / stagger | 第一次停 / 每次間隔 | 1.0 / 0.25 |
| speeds | 轉速（格/秒）；列表 = 依停輪順序 | 18 |
| decelTime / decelCurve | 減速時間 / 曲線（standard / soft / hard） | 0.08 / standard |
| overshoot / bounceTime | 停輪衝過（格）/ 回彈 | 0.15 / 0.2 |
| antReels | 期待輪（1 起算，逗號分隔） | 空 |
| antTime | 每個期待輪多轉（累加） | 0.8 |
| antSpeed | 繞框期間轉速，0 = 不變 | 0 |
| antDecelTime / antCurve | 期待輪減速 / 曲線 | 0.45 / soft |
| windupDist / windupTime | 起轉拉回（格）/ 時間 | 0.25 / 0.15 |
| accelTime / speedRamp | 加速時間 / 切到繞框轉速的過渡 | 0.15 / 0.2 |
| direction | down / up | down |
| seed | 填充符號亂數種子 | 1 |
| motionBlur / shutterAngle | 動態模糊 / 快門角度 | true / 180 |
| autoRhythm | 改快速節奏時自動重新產生各輪 | true |

### reels[i]（各輪，用 `reel` 指令改）
`start stop speed decelTime decelCurve overshoot bounceTime frame frameStart frameSpeed`

### antRule（期待感建議）
| 欄位 | 說明 | 預設 |
| --- | --- | --- |
| symbols / count | 觸發符號 / 幾顆觸發 | SCATTER / 3 |
| after | 達標後繼續期待（追更多顆） | true |
| tease / teaseMin | 大獎聽牌符號 / 連幾輪後聽牌 | 空 / 2 |

### frame（繞框）
`source`（builtin / custom）、`itemName`（自訂素材在專案中的名稱）、`color`、`width`、`pad`、`laps`（圈/秒）、`runner`（跑燈長度 %）、`glow`、`fade`、`hold`（停妥後保留）

### lines / lineSet / lineGen / lineStyle（連線）
- `lineSet.paylines`（空白 = 內建，5×3 是常見 20 線）、`wilds`、`exclude`、`minCount`
- `lineGen.delay`、`mode`（all_each / all / each）、`allTime`、`eachTime`、`gap`
- `lineStyle.width`、`drawTime`、`full`、`boxes`、`boxWidth`、`pulse`（%）、`glow`、`cellSource` / `cellItemName`（自訂中獎格素材）

### layout
`reels rows cellW cellH gapX gapY peek margin scaleMode symbolScale target newCompFps position`
- `position`：盤面中心在目標合成的位置 `[x, y]`；`null` = 新建時置中、更新時不動。

### symbols[i]
`name path filler scale`（`scale` = 這個符號額外縮放 %，預設 100，用 `symbol P <名稱> --scale` 改）

## AE 端需求

- AE 已開啟、專案已開、沒有對話框卡住。
- 偏好設定 > 指令碼與運算式 > 勾選「允許指令碼寫入檔案及存取網路」（回傳結果要寫檔）。
- 找不到 AE 時設定環境變數 `SFS_AE`：Windows 填 `AfterFX.exe` 完整路徑；macOS 填 App 名稱（例如 `Adobe After Effects 2025`）。
- 第一次在 macOS 執行時，系統可能會詢問是否允許終端機控制 After Effects，請允許。
