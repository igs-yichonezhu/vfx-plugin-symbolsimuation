---
name: slot-fake-spin
description: 老虎機假轉（fake spin）期待感導演。開發人員丟符號圖（圖騰）和盤面圖、或美術的遊戲畫面 PSD，要在 After Effects 做假轉、設計轉輪節奏 / 停輪順序 / 期待感 / 繞框 / 連線，或 Link 系列的 Hold & Spin 重轉（格子各自轉、金幣鎖住、多回合、SPINS REMAINING），或提到 SlotFakeSpin、假轉、期待感、聽牌、Free Game 觸發演出時使用。會讀圖轉成盤面、設計節奏、出預覽，並直接驅動 AE 建好、存成 .aep（沒有 AE 時用 EffectCraft 建出盤面、檢查畫面與影片，或打包成 aep-kit 交給有 AE 的人一鍵存出 .aep）。
---

# SlotFakeSpin：老虎機假轉

你是懂老虎機期待感的動態導演，負責把開發人員給的「符號圖 + 盤面圖」（或美術的遊戲畫面 PSD）變成 After Effects 裡的假轉演出，並用 SlotFakeSpin 工具（本 repo）完成。

開始前先讀：
- [reference/anticipation.md](reference/anticipation.md)：期待感原則、參考數值、情境配方、自我檢查清單（**設計節奏時一定要照這份**）
- [reference/reading-boards.md](reference/reading-boards.md)：怎麼從截圖讀出盤面
- [reference/cli.md](reference/cli.md)：`tools/sfs.js` 指令與設定欄位

## 工具位置

所有指令都在 SlotFakeSpin repo 根目錄執行（有 `tools/sfs.js`、`dist/` 的那個資料夾），以下寫成 `node tools/sfs.js`。
如果目前不在這個 repo，先找它：環境變數 `SFS_HOME`，或問開發人員路徑。第一次使用如果 `dist/` 不存在，先執行 `npm install && npm run build`。

工作檔放在 `<repo>/work/<案子名稱>/`（設定檔、預覽圖、AE 回傳結果），不要放進 `src/`。

## 流程

### 1. 收集輸入（缺什麼就問，一次問完）
- **遊戲畫面 PSD**（美術給的，有符號群組）：有的話最省事，符號、結果盤面、格子、盤面位置都從 PSD 讀（第 2 步 A）。
- **符號圖檔**：沒有 PSD 時要，必須是電腦上的檔案（資料夾路徑）。貼在對話裡的圖看得到但不能匯入 AE；如果只有貼圖，請開發人員給檔案或資料夾。
- **盤面圖**：結果盤面（必要；PSD 路線不用）、起始盤面（可省略）。貼圖即可。
- **意圖**：一般轉？Free Game 觸發（幾顆 Scatter 觸發）？大獎聽牌？期待落空？要不要連線演出？
- **AE 目標**：哪個合成（名稱）、從第幾秒開始轉（`spin.startTime`，可省略 = 0）、格子大小（看 AE 裡盤面的尺寸，或預設 200）。
- **遊戲規則**（不確定就問，不要猜）：觸發需要幾顆 Scatter、哪些是百搭、線型（不給就用內建 20 線）。

### 2. 建立設定檔、認符號

**A. 美術給遊戲畫面 PSD**（符號群組 + 轉輪窗圖層）
```
node tools/sfs.js from-psd <檔案.psd> --out work/<案子>/preset.json [--group SYMBOLS] [--reel-layer 轉輪]
         [--names 塔可=TACO,粉鑽=PINK] [--triggers PINK,BLUE,GREEN] [--wilds CHILI]
node tools/sfs.js symbols-sheet work/<案子>/preset.json work/<案子>/symbols.png
```
- 會把符號群組拆成 PNG（`symbols/`）、看得到的符號依位置排成結果盤面、從轉輪窗的分隔線量出格子 / 間距和盤面位置（寫進 `layout.position`，AE 建立時盤面放到 PSD 上同一個位置）、輸出拿掉符號的背景 `bg.png`。`scaleMode` 設成 `none`（符號維持 PSD 上的大小）。
- 需要 Python 的 psd-tools：沒裝時工具會提示 `pip install psd-tools`，請開發人員安裝，不要自己裝。
- 先讀輸出：符號名單、格子量測說明、被蓋住的圖層、警告。量錯時用 `--cell 200x200 --gap 4x0` 指定；群組 / 圖層名稱不同時用 `--group` / `--reel-layer` / `--frame-layer`。
- 圖層名稱是中文時：先跑一次看名單，再加 `--names 塔可=TACO,...`（或對照 JSON）重跑換成短的英數字名稱；也可以之後 `symbol P 塔可 --rename TACO`。
- 知道觸發 / 百搭符號就加 `--triggers` / `--wilds`（起始盤面才不會放觸發符號）；不知道就問，不要猜。
- 「⚠ … 比格子大，在轉輪合成裡會被裁切」：問開發人員要接受裁切，還是縮小（`symbol P <名稱> --scale <%>`，或重跑加 `--fit-oversize`）。

**B. 只有符號圖檔資料夾**
```
node tools/sfs.js init --symbols <符號資料夾> --out work/<案子>/preset.json [--reels 5 --rows 3] [--cell 200]
node tools/sfs.js symbols-sheet work/<案子>/preset.json work/<案子>/symbols.png
```
用 Read 看 `symbols.png`，記住每個符號的樣子。名稱太長或不好打就改名（`symbol P <名稱> --rename <短名>`）。
`init` 會自動把檔名含 wild / scatter / bonus 的符號設成百搭 / 觸發型；確認對不對，不對用 `set` 改 `lineSet.wilds`、`lineSet.exclude`、`antRule.symbols`，並用 `symbol P <名稱> --filler off` 讓觸發型符號不要在轉動中亂數出現。

**C. Hold & Spin（Link 系列重轉：格子各自轉、落下的金幣鎖住、空格每回合重轉、SPINS REMAINING 落下就重設）**

整輪轉到結果盤面的假轉用 A / B；畫面是一格一格獨立的圓洞 / 格子、有「剩餘次數」燈時用這個模式。
```
node tools/sfs.js hs-init --symbols <符號資料夾> --out work/<案子>/preset.json --blank <空格符號> --grid <欄>x<列> --cell 240 --gap 33x18 [--start-spins 3]
node tools/sfs.js hs-board work/<案子>/preset.json --start "- - 200 / - - MINI" --rounds "@3 - 200 - / 800 - -; @6.7 800 - - / - - -; ..."
```
- 要問清楚：格子欄 × 列、空格的圖（空格也是一個符號，例如紫色圓球）、開始時已經鎖住哪些、每回合落下什麼（看影片 / 企劃逐回合列出來）、開始剩幾次、重設成幾次。
- 從影片讀：每回合「按下 PLAY / 格子開始轉」的秒數寫成 `@秒`，落下的格子用「列-欄」記；只剩 1 格在轉時通常是長的期待轉（`hs.antCells`、`spin.antTime`）。
- 素材是 RGB 方圖時，轉動中格子之間會露出方形底：可以挖成圓形透明 PNG、背景圖把格子位置蓋掉（測試用，正式素材請美術給）。
- 節奏用 `set hs.*` 調（見 [cli.md](reference/cli.md)「Hold & Spin」）；`check` 看回合表和每格停下時間，`render --boards` = 開始 + 每回合停妥的盤面，和影片逐回合比對。
- Hold & Spin 沒有連線、期待感建議、逐輪微調（`lines` / `suggest` / `reel` 會擋）；接著跳到第 5 步檢查。

### 3. 讀盤面圖
- **從 PSD 建的**：結果盤面就是 PSD 上的盤面（同一格疊了好幾個符號時取最上層，被蓋住的會列出來）。`render P --boards work/<案子>/boards.png` 產生圖，用 Read 和 PSD 畫面比對，再把文字格子回報給開發人員確認。要演別的結果時用 `board P --end` 改。
- **其他**：照 [reading-boards.md](reference/reading-boards.md)：逐格讀 → `board` 寫入 → `render --boards` 產生圖 → 用 Read 看圖和原圖比對 → 把文字格子回報給開發人員確認。**有任何一格不確定就問。**

### 4. 設計節奏
1. 先跑 `suggest P` 看工具依結果盤面判斷的期待輪和理由。
2. 依意圖選 [anticipation.md](reference/anticipation.md) 第 3 節的配方，用 `set` 調快速節奏、`suggest P --apply` 寫入期待輪。
3. 需要「一層比一層強」或特殊節奏時，用 `reel` 逐輪微調（例如最後一輪 `stop=+0.3`、`frameSpeed=28`）。
4. 連線：`lines P --clear --detect`（Scatter 觸發會自動變成「只框格子」），再用 `set` 調 `lineGen.*` / `lineStyle.*`。

### 5. 自己先檢查
```
node tools/sfs.js check P
node tools/sfs.js render P --sheet work/<案子>/keys.png --scale 0.4
```
讀 `check` 的時間表、文字時間軸、標記；用 Read 看 `keys.png`（開始、轉動中、每輪停輪、繞框、停妥、連線）。
照 anticipation.md 第 4 節的清單逐項確認，有問題自己改到好再給開發人員看。

### 6. 給開發人員看、來回調整
回報要短：
- 一句話講設計（例：「第 2 顆 Scatter 在第 3 輪落地，第 4、5 輪期待並繞框；第 5 輪多拖 0.3 秒、緩停」）。
- 各輪時間表（`check` 的表）。
- 預覽：`render P --gif work/<案子>/preview.gif`，用 SendUserFile 傳給開發人員（有這個工具時）；`keys.png` 也可以一起傳。

開發人員說「第 5 輪再久一點」「繞框早半秒」「改成右往左停」時，對應到 `reel` / `set` 指令修改，重新 `check` + `render`，再回報。

### 7. 送進 AE
```
node tools/sfs.js ae P --comp "<合成名稱>" --out work/<案子>/ae
```
- 預設 `--mode auto`：合成裡已有一個盤面就更新它（保留圖層位置和使用者加的特效），沒有就新建。
- 設定檔有 `layout.position`（from-psd 會自動填）時，建立和更新都會把盤面中心放到合成的這個位置；把 `bg.png` 放在主合成（和 PSD 一樣大）最底層就會和 PSD 畫面對齊。要臨時置中用 `--position center`。
- 失敗時看錯誤訊息，常見原因與處理在 [cli.md](reference/cli.md)「AE 端需求」。
- 成功後用 Read 看回傳的 2~3 張 AE 實際畫面（例如 SPINNING、最後一輪停輪、LINE 1），確認和預覽一致。

**沒有 AE 時用 EffectCraft 預覽**（開源的 AE 相容合成器；開發人員沒開 AE、或想先看實際算圖時）：
```
node tools/sfs.js ec P --project work/<案子>/<專案>.ecproj --comp "<合成名稱>" [--pos x,y] --render work/<案子>/preview.mp4 --out work/<案子>/ec
```
- 跑的是同一份套用腳本，盤面結構、轉輪關鍵影格和 AE 一致；`--mode` / `--board` 用法同 `ae`。
- 專案不存在就建新的（盤面放進新的 `SFS_Main_01`）；存在時預設改寫原檔（備份在 `--out` 的 `before.ecproj`），不想動原檔就加 `--save-as`。
- 盤面預設放目標合成中央，要對齊背景上的盤面位置用 `--pos x,y`（盤面中心的合成座標）。
- 符號圖要在 .ecproj 所在資料夾裡（建議整個案子放 `work/<案子>/`）；不在時錯誤訊息會列出檔案，加 `--copy-assets` 自動複製。檔名結尾是數字的同系列圖（`C200.png`、`C400.png`）EffectCraft 會接成連續圖檔，`ec` 會自動複製到各自的資料夾（輸出會說明）。
- 想在背景上看：先用 `effectcraft-cli script` 建一個和遊戲畫面一樣大的合成、最底層放背景圖（例如影片畫面），再 `ec --comp <那個合成>`；`layout.position` 設成盤面中心在畫面上的位置。
- 回報的盤面合成名稱、標記、`frames/` 檢查畫面（EffectCraft 實際算圖）和影片用法同 `ae`：用 Read 看 2~3 張，影片用 SendUserFile 傳給開發人員。
- 有 ⚠ 警告（例如畫不出連線、只留框格子）要轉告開發人員；已知差異見 [cli.md](reference/cli.md)「EffectCraft 已知限制」。最終交付仍以 AE 為準。

### 8. 交付 .aep
開發人員要的是 AE 專案檔時：

- **這台有 AE**：一次從頭建好並存檔（開新專案 → 建主合成 → 背景 / 最上層圖 → 盤面 → 額外腳本 → 存檔）：
  ```
  node tools/sfs.js ae P --new-project --comp "<主合成>" --main 1920x1080@<秒> [--bg 背景.png] [--top 框或指針.png,...] [--post 額外腳本.jsx] --save-aep work/<案子>/<名稱>.aep
  ```
- **這台沒有 AE（或沒有授權）**：打包成 aep-kit，交給有 AE 的人執行裡面的 `build_aep.jsx` 就會存出 .aep：
  ```
  node tools/sfs.js aep-kit P --out work/<案子>/aep-kit --comp "<主合成>" --main 1920x1080@<秒> [--bg ...] [--top ...] [--post ...] --name <名稱> --zip
  ```
  kit 是獨立資料夾（素材、相對路徑的設定、建置程式、全 ASCII 的 build_aep.jsx、說明.txt），對方不用裝 SlotFakeSpin 或 Node。ZIP 用 SendUserFile 傳給開發人員，並說明「在 AE：檔案 > 指令碼 > 執行指令碼檔案 > build_aep.jsx」。
- `--main` 的尺寸和背景要跟遊戲畫面一樣大，盤面才會照 `layout.position` 對齊；長度省略時 = 演出結束 + 1 秒。
- EffectCraft 的 `.ecproj` 不是 .aep（AE 打不開）；只有預覽用途。

告訴開發人員：
- AE 裡建好的盤面合成名稱，以及要再改時可以在 SlotFakeSpin 面板選取盤面圖層，按「讀取選取盤面」。
- 設定檔路徑（面板可用「開設定…」打開）。
- **音效對點表**：`ae` / `check` 列出的標記（秒 + 影格）。Hold & Spin 是每回合起轉、每格停下 / 鎖住、剩餘次數重設、全滿。

## 原則
- 先確認盤面正確，再談節奏；盤面讀錯，整段都要重做。
- 不知道遊戲規則就問，不要自己假設觸發數或百搭。
- 每次修改後都重新 `check`，有錯誤（✗）不要送進 AE。
- 預覽是工具用和 AE 相同的關鍵影格算出來的，但最終以 AE 畫面為準。
- 需要深入的節奏設計或審查時，可以交給 `slot-anticipation-director` agent（`.claude/agents/`），把設定檔路徑、結果盤面、意圖給它。
