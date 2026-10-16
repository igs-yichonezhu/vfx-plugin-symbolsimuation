# tools/sfs.js 指令與設定速查

在工具根目錄執行 `node tools/sfs.js help` 可以看完整說明。`P` = 設定檔路徑。

## 指令

| 目的 | 指令 |
| --- | --- |
| 建立設定檔 | `init --symbols <資料夾> --out P [--reels 5 --rows 3] [--cell 200\|200x180]` |
| 看摘要 | `show P` |
| 盤面 | `board P --start "A K Q J A / ..." --end "..."`（`/` = 換行，或 `@檔案`） |
| 符號 | `symbol P <名稱> --filler off`、`symbol P <名稱> --rename SC` |
| 改設定 | `set P spin.stopOrder=5,4,3,2,1 frame.color=#FF3366 ...`（改 spin.* 會自動重新產生各輪，除非已手動微調過；改 lineGen.* 會重新排所有連線的顯示時間） |
| 逐輪微調 | `reel P 5 stop=+0.3 decelCurve=soft frame=on frameStart=2.1`（`+/-` = 相對；會關掉自動套用） |
| 重新產生各輪 | `regen P`（放棄手動微調、回到快速節奏） |
| 期待感建議 | `suggest P`（只看理由）、`suggest P --apply`（寫入） |
| 連線 | `lines P --detect`、`--clear`、`--timing`、`--add 1,2,3,2,1:5:0.3+1.2`、`--add 2,0,1,0,2:box` |
| 檢查 | `check P [--fps 30]`、`check P --json` |
| 預覽 | `render P --boards b.png --sheet k.png --gif a.gif [--scale 0.5] [--fps 30]` |
| 符號總覽 | `symbols-sheet <資料夾\|P> out.png` |
| 送進 AE | `ae P --comp "合成名稱" [--mode auto\|new\|update] [--frames auto] [--out 資料夾]` |
| 沒有 AE：EffectCraft | `ec P --project 專案.ecproj [--comp "合成名稱"] [--mode auto\|new\|update] [--pos x,y] [--frames auto] [--render out.mp4] [--save-as 另存.ecproj] [--copy-assets] [--out 資料夾]` |

`ae` 的 `--mode`：
- `auto`（預設）：合成裡有選取的盤面、或只有一個盤面就更新它；否則新建。
- `new`：一定新建。
- `update`：一定更新（找不到就報錯）。可用 `--board SFS_Board_01` 指定。

`ae` 會回報：建立的盤面合成、全部停妥 / 演出結束時間、標記（秒 + 影格）、以及 AE 實際算出的檢查畫面 PNG 路徑（用 Read 看）。

### ec（EffectCraft）

沒有 AE 時，用 [EffectCraft](https://getartcraft.com/apps/effectcraft)（開源的 AE 相容合成器）的 `effectcraft-cli` 建盤面：跑的是同一份 `dist/SlotFakeSpin_apply.jsx`，盤面結構和轉輪關鍵影格與 AE 一致。

| 參數 | 說明 |
| --- | --- |
| `--project F.ecproj` | 必填。不存在時建立新專案，盤面放進新的 `SFS_Main_01` 合成（這時不能指定 `--comp`） |
| `--comp` / `--mode` / `--board` | 同 `ae`；沒給 `--comp` 時用 EffectCraft 的作用中合成，建議一律指定 |
| `--pos x,y` | 盤面圖層位置（目標合成座標，盤面中心）。新建預設放中央；更新時不給就不動 |
| `--frames auto\|none\|秒,秒` | 檢查畫面（`render-frame`），放在 `--out` 的 `frames/`，預設 auto（同 `ae`） |
| `--render out.mp4` | 輸出影片：.mp4 = H.264、.mov = ProRes、.webm、.gif（`--format` 可指定）；預設 0 秒到演出結束 + 0.6 秒，`--range 開始,結束` 可改 |
| `--save-as G.ecproj` | 另存新檔、不動原專案。沒給時改寫 `--project`，原檔備份到 `--out` 的 `before.ecproj` |
| `--copy-assets` | 符號圖不在專案資料夾內時，複製到 `<專案資料夾>/sfs_assets/<設定檔名>/`（不改你的設定檔） |
| `--out 資料夾` | 執行資料夾（預設設定檔旁的 `.sfs-run/ec-<時間>/`）：`apply_ec.jsx`、`cli.json`、`result.json`、`frames/`、`before.ecproj` |
| `--dry-run` | 只產生工作腳本、印出指令 |

回報內容同 `ae`，盤面合成名稱是 EffectCraft 裡的實際名稱（`--board` / 更新模式用這個名稱）。失敗時（找不到合成、腳本錯誤）專案不會被修改。

找 CLI 的順序：環境變數 `SFS_EC` → `%LOCALAPPDATA%\Programs\ArtCraft\effectcraft-*\effectcraft-cli.exe`（最新版）→ PATH 上的 `effectcraft-cli`。

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
`reels rows cellW cellH gapX gapY peek margin scaleMode symbolScale target newCompFps`

## AE 端需求

- AE 已開啟、專案已開、沒有對話框卡住。
- 偏好設定 > 指令碼與運算式 > 勾選「允許指令碼寫入檔案及存取網路」（回傳結果要寫檔）。
- 找不到 AE 時設定環境變數 `SFS_AE`：Windows 填 `AfterFX.exe` 完整路徑；macOS 填 App 名稱（例如 `Adobe After Effects 2025`）。
- 第一次在 macOS 執行時，系統可能會詢問是否允許終端機控制 After Effects，請允許。

## EffectCraft 已知限制（0.3.1 實測，`ec` 已處理）

| EffectCraft 的行為 | `ec` 的處理 |
| --- | --- |
| 不支援 `$.evalFile`（scripts can't run scripts） | 工作參數、設定內容和套用腳本合併成單一腳本 `apply_ec.jsx` |
| 預設不允許腳本寫檔 | 結果用 `writeLn` 輸出一行 `SFS_RESULT <json>`，從 CLI 的 `--json` 讀回；檢查畫面改用 `render-frame`。不改 EffectCraft 的偏好設定 |
| 腳本只能讀 .ecproj 所在資料夾裡的檔案（外面的檔案 `File.exists` 是 false；`--empty` 的新專案什麼都不能讀） | 設定內容直接帶進腳本；符號圖要在專案資料夾內，否則報錯並列出檔案，或 `--copy-assets` 複製進去；新專案先存成空專案再開啟 |
| 腳本出錯時 CLI 仍然會存檔 | 先另存成同資料夾的暫存檔（`.<名稱>.sfs-tmp.ecproj`），成功才取代專案 |
| 沒有 `String.prototype.substr` | `npm run build` 會擋下 `src/` 裡的 `.substr`（改用 `substring` / `slice`） |
| `addProperty("ADBE Vector Shape - Group")`（自由路徑）不支援 | 連線改用 EffectCraft 的 `shape.newPath` 指令畫；這個指令也失敗時，略過畫線並發出 ⚠ 警告（框格子、符號跳動照常），不讓整個建置失敗 |
| 巢狀合成的動態模糊要外層開關都打開才有效（AE 依預組合自己的設定） | 只在 EffectCraft：盤面合成裡的 Reel 圖層、目標合成裡的盤面圖層、目標合成本身都打開 motionBlur，盤面合成的快門角度跟設定一致 |
| 合成名稱不能和既有項目（含資料夾）重複，會自動改名（`SFS_Board_01` → `SFS_Board_ 2`） | 先建盤面合成再建同名資料夾（AE 也一樣這樣建）；回報實際名稱，轉輪合成用實際名稱命名 |
| `render` 的 `--out` 相對路徑以 .ecproj 所在資料夾為準 | 一律傳絕對路徑 |
| 圖層註解不會存進專案 | 不影響：盤面靠合成註解（設定 JSON）辨識 |
