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
| 從頭建專案並存 .aep（有 AE） | `ae P --new-project --comp 主合成 --main 1920x1080@7[@30] [--bg 圖] [--top 圖,圖] [--post 腳本,腳本] --save-aep 檔案.aep` |
| 打包給有 AE 的人存 .aep | `aep-kit P --out 資料夾 --comp 主合成 --main 1920x1080@7[@30] [--bg 圖] [--top 圖,圖] [--post 腳本,腳本] [--name 檔名] [--position x,y] [--zip] [--force]` |
| 沒有 AE：EffectCraft | `ec P --project 專案.ecproj [--comp "合成名稱"] [--mode auto\|new\|update] [--pos x,y] [--frames auto] [--render out.mp4] [--save-as 另存.ecproj] [--copy-assets] [--out 資料夾]` |
| Hold & Spin：建立 / 轉換 | `hs-init P --blank BLANK [--grid 3x2] [--cell 240] [--gap 33x18] [--spins 3] [--start-spins 1]`；新建：`hs-init --symbols <資料夾> --out P --blank BLANK ...` |
| Hold & Spin：盤面與回合 | `hs-board P --start "- - 200 / - - MINI" --rounds "@3 - 200 - / 800 - -; @6.7 800 - - / - - -"`、`--add <回合>`、`--clear`（見下方「Hold & Spin」） |

Hold & Spin 設定檔（`mode = holdspin`）不能用 `board` / `reel` / `regen` / `suggest` / `lines`（會提示改用 `hs-board` / `set hs.*`）；`show` / `check` / `render` / `ae` / `ec` 都支援。

`ae` 的 `--mode`：
- `auto`（預設）：合成裡有選取的盤面、或只有一個盤面就更新它；否則新建。
- `new`：一定新建。
- `update`：一定更新（找不到就報錯）。可用 `--board SFS_Board_01` 指定。

盤面位置：設定檔有 `layout.position` 時，建立和更新都會把盤面中心放到合成的這個位置（錨點設在盤面中心）；沒有就新建時放合成中央、更新時不動。`--position` 只改這一次（`center` = 不套用）。`--dry-run` 會印出這次的盤面位置，啟動腳本裡也帶著（`position`）。

`ae` 會回報：建立的盤面合成、全部停妥 / 演出結束時間、標記（秒 + 影格）、以及 AE 實際算出的檢查畫面 PNG 路徑（用 Read 看）。

### 交付 .aep（ae --new-project / aep-kit）

| 參數 | 說明 |
| --- | --- |
| `--new-project` | 先開新專案（AE 會問要不要存目前的專案；取消就不建）。有 `--main` 時自動開啟 |
| `--comp` + `--main 寬x高[@秒][@fps]` | 建主合成當目標；名稱預設 Main，長度預設 = 演出結束 + 1 秒，fps 預設 `layout.newCompFps` |
| `--bg 圖` | 放在主合成最底層（遊戲畫面背景，和 `layout.position` 一起對齊盤面） |
| `--top 圖,圖` | 放在主合成最上層（固定的框、指針），逗號分隔 |
| `--post 腳本,腳本` | 盤面建好後執行（讀進來 eval；腳本裡可以用 `$.global.SFS_BUILD.board / target / layer`），例如 examples/cases 的滾筒表達式 |
| `--save-aep 檔案.aep`（ae） / `--name 檔名`（aep-kit） | 最後存檔；aep-kit 存在 kit 資料夾裡 |

aep-kit 的內容：`preset.json`（符號路徑改成 `assets/...` 相對路徑、AE 項目 ID 清空）、`assets/`（檔名結尾是數字的放各自資料夾）、`SlotFakeSpin_apply.jsx`、`build_aep.jsx`（全 ASCII；結果放在 `$.global.SFS_KIT_RESULT`，`$.global.SFS_KIT_QUIET = true` 時不跳訊息，方便一次跑好幾個）、`說明.txt`。`--zip` 另外壓成 `<資料夾>.zip`（需要 Python）。

### ec（EffectCraft）

沒有 AE 時，用 [EffectCraft](https://getartcraft.com/apps/effectcraft)（開源的 AE 相容合成器）的 `effectcraft-cli` 建盤面：跑的是同一份 `dist/SlotFakeSpin_apply.jsx`，盤面結構和轉輪關鍵影格與 AE 一致。

| 參數 | 說明 |
| --- | --- |
| `--project F.ecproj` | 必填。不存在時建立新專案，盤面放進新的 `SFS_Main_01` 合成（這時不能指定 `--comp`） |
| `--comp` / `--mode` / `--board` | 同 `ae`；沒給 `--comp` 時用 EffectCraft 的作用中合成，建議一律指定 |
| `--pos x,y` | 盤面中心在目標合成的位置。沒給時用設定檔的 `layout.position`（例如 `from-psd` 算好的）；都沒有 = 新建放中央、更新時不動 |
| `--frames auto\|none\|秒,秒` | 檢查畫面（`render-frame`），放在 `--out` 的 `frames/`，預設 auto（同 `ae`） |
| `--render out.mp4` | 輸出影片：.mp4 = H.264、.mov = ProRes、.webm、.gif（`--format` 可指定）；預設 0 秒到演出結束 + 0.6 秒，`--range 開始,結束` 可改 |
| `--save-as G.ecproj` | 另存新檔、不動原專案。沒給時改寫 `--project`，原檔備份到 `--out` 的 `before.ecproj` |
| `--copy-assets` | 符號圖不在專案資料夾內時，複製到 `<專案資料夾>/sfs_assets/<設定檔名>/`（不改你的設定檔） |
| `--out 資料夾` | 執行資料夾（預設設定檔旁的 `.sfs-run/ec-<時間>/`）：`apply_ec.jsx`、`cli.json`、`result.json`、`frames/`、`before.ecproj` |
| `--dry-run` | 只產生工作腳本、印出指令 |

回報內容同 `ae`，盤面合成名稱是 EffectCraft 裡的實際名稱（`--board` / 更新模式用這個名稱）。失敗時（找不到合成、腳本錯誤）專案不會被修改。

找 CLI 的順序：環境變數 `SFS_EC` → `%LOCALAPPDATA%\Programs\ArtCraft\effectcraft-*\effectcraft-cli.exe`（最新版）→ PATH 上的 `effectcraft-cli`。

## Hold & Spin（重轉模式，Link 系列）

盤面是「欄 × 列」個獨立格子（`layout.reels` = 欄、`layout.rows` = 列），每格是一條 1 格高的轉帶；落下的符號鎖住不動，空格每回合重轉。
格子用「列-欄」稱呼（`2-1` = 第 2 列第 1 欄），標記、`check`、回合摘要都這樣寫。

```
node tools/sfs.js hs-init --symbols work/<案子>/symbols --out work/<案子>/preset.json --blank BLANK --grid 3x2 --cell 240 --gap 33x18 --start-spins 1
node tools/sfs.js hs-board work/<案子>/preset.json --start "- - C200 / - - MINI" \
  --rounds "@3 - C200 - / C800 - -; @6.7 C800 - - / - - -; @9.25 - - - / - - -; @12.2 - - - / - C1200 -"
node tools/sfs.js check work/<案子>/preset.json
```

- **起始盤面**（`--start`）：由上到下逐列、列之間用 `/`；`-` = 空格（存成空格符號 `hs.blank`），其他符號 = 一開始就鎖住。
- **回合**（`--rounds`，命令列用 `;` 分隔回合，`@檔案` = 每行一回合）：同樣的盤面寫法，`-`（或空格符號）= 這回合還是空格，符號 = 這回合落下並鎖住；已鎖住的格子寫 `-` 或同一個符號都可以（所以「每回合寫出整個盤面」也行）。開頭 `@秒` = 這回合起轉時間（從 `spin.startTime` 算）；沒寫就接在上一回合停妥 + `hs.roundGap`。
- **次數**：開始剩 `hs.startSpins` 次，每回合用掉 1 次，有新符號落下就重設成 `hs.spins`；用完或全滿就結束。結束後還有回合 = 錯誤；最後一回合沒結束 = 警告。
- **節奏**：每回合所有空格一起起轉，依 `hs.order` 錯開停下（第 1 格 `hs.firstStop` 秒、之後每格 `hs.stagger`）。這回合只轉 ≤ `hs.antCells` 格時是**期待回合**：每格多轉 `spin.antTime`（累加）、改用 `spin.antDecelTime` / `antCurve`、`hs.antFrame` = 繞框（`spin.antSpeed` > 0 時繞框期間變速）。拉回 / 加速 / 減速 / 衝過 / 回彈 / 動態模糊沿用 `spin.*`，和轉輪模式同一套關鍵影格算法，停下位置分毫不差。
- **鎖住跳動**：落下的符號停妥時在盤面合成放大到 `hs.lockPulse`% 再縮回（0.1 + 0.22 秒；100 = 不跳）。
- **標記**：`HS START`、`HS ROUND n`、`HS SPINS k`（起轉後剩幾次；落下時 `HS SPINS 3` = 重設）、`HS CELL r-c STOP`（停下、還是空格）、`HS CELL r-c LOCK <符號>`、`HS CELL r-c FRAME`（期待繞框開始）、`HS FULL` / `HS END`（全滿 / 用完）、`ALL SETTLED`。剩餘次數的 UI（①②③）只打標記，畫面自己做。
- **AE 結構**：每格一個格子合成 `<盤面>_C<列>-<欄>`（大小 = 格子；鎖住後沒有關鍵影格），盤面合成裡是 `Cell r-c` 圖層、`Frame Cr-c`（期待繞框）、`Lock r-c_<符號>`（鎖住跳動）。轉帶圖層：`C2-2_S01_BLANK`（起始）、`C2-2_H04_C1200`（第 4 回合停下的符號）、`F` 填充 / `B` 緩衝。
- 不畫連線（有 `lines` 會警告並略過）；格子沒有 `peek`。
- `check` 印回合表（起轉、第一格停、停妥、轉幾格、鎖住哪些、剩餘次數）、各格每次停下、文字時間軸（每格一行，`#` = 鎖住）、標記；`--json` 有 `rounds` / `cells` / `finalBoard`。`render --boards` = 開始 + 每回合停妥。`ae` / `ec` 另外回報每回合摘要（`result.rounds`）。

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

### mode / hs（Hold & Spin）
`mode`：`reels`（預設，整輪從起始盤面轉到結果盤面）/ `holdspin`（Hold & Spin 重轉）。`hs`：
| 欄位 | 說明 | 預設 |
| --- | --- | --- |
| blank | 空格符號名稱 | 空（必填） |
| rounds | 回合，每行一回合（`@秒 盤面`）；用 `hs-board` 改 | 空 |
| spins / startSpins | 落下新符號重設成幾次 / 開始時剩幾次 | 3 / 3 |
| speed | 轉速（格/秒） | 12 |
| order | 停格順序：col（一欄一欄，上到下、左到右）/ row / all（同時） | col |
| firstStop / stagger | 回合開始到第一格停 / 每格間隔 | 0.85 / 0.22 |
| roundGap | 回合停妥到下一回合起轉（沒寫 `@秒` 時） | 1.2 |
| antCells | 這回合轉的格子 ≤ 幾格時當期待回合（0 = 不期待） | 1 |
| antFrame | 期待格繞框 | true |
| lockPulse | 鎖住時跳動放大 %（100 = 不跳） | 115 |

`endBoard` 在 Hold & Spin 是推演出來的最後盤面（`hs-board` 會寫入，給 `show` / 讀回用）。

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
| 不理會 `ImportOptions.sequence = false`：檔名結尾是數字、同資料夾有同系列檔案的圖（`C200.png`、`C400.png`、`MAJOR_2.png`、`MAJOR_3.png`）會被接成一段連續圖檔，畫面隨時間換成別張 | 這種符號圖自動複製到 `<專案資料夾>/sfs_assets/<設定檔名>/<檔名>/` 各自的資料夾再匯入（不用 `--copy-assets`，會印出哪些檔案）；在 EffectCraft 面板裡建立時則發出 ⚠ 警告 |
