---
name: slot-ad-recreate
description: 老虎機假廣告還原（模仿競品）。開發人員丟一支競品影片（實機錄影 / 廣告）和一整包素材資料夾（遊戲畫面分層 PSD、轉盤、符號、角色 / 特效影片、連續圖、音效），要「照競品做出來」「模仿競品」「做假廣告」「fake AD」「還原競品演出」時使用。會拆競品節奏、盤點素材、照 PSD 對位整理、用 SlotFakeSpin 做轉輪 / 格子與報獎，產生一支 AE / EffectCraft 共用的建置腳本，直接先做完第一版影片（30 秒內）＋ 與競品並排的對比影片，再列出差異和缺的素材給開發人員確認。
---

# 老虎機假廣告還原（模仿競品）

目標：**不來回問，直接先做完一版**（v1 影片 + 對比影片 + 清單），讓開發人員看完再指出要改的地方。
做過的案例（第一次用先讀）：
- [reference/spicy-fortunes.md](reference/spicy-fortunes.md)：轉盤 → MINOR JACKPOT → FG 符號飛入落格 → 噴火 → BIG WIN（範本 `make_ad.js`）
- [reference/spicy-extra-rows.md](reference/spicy-extra-rows.md)：寶石進碗 → 轉盤停 +3 → EXTRA ROWS 綠 / 金 / 紅格落格 → 噴火 → BIG WIN 6,660（範本 `make_ad_extrarows.js`；`director.jsx` 兩個案子共用，最新版）

需要：Node、Python 3 + Pillow（PSD 要 psd-tools；本機哪一個 Python 有裝要先查）、ffmpeg、EffectCraft（沒有 AE 時建置 / 算圖）。轉輪 / 格子 / 報獎用本 repo 的 SlotFakeSpin（`slot-fake-spin` skill、`tools/sfs.js`）。

## 規則（先看）
- **只看競品和素材，不看答案**：資料夾旁邊如果有別人做好的完成檔 / .aep，不要打開，除非開發人員明說可以對照。
- 成品 **30 秒內**（預設 29.5 秒），停輪、觸發、高潮、報獎用原速。
- 工作檔放 `work/<案子>/`（gitignore）。repo 是公開的：素材、截圖、本機路徑都不進 git。
- 回報用中文。
- **競品優先、不硬塞素材**：每個素材先問「競品同一段有沒有這個效果」，有才放。素材要盤點、用不上的列在回報裡說明原因，但不要為了「用到」而塞（例：競品轉盤底下是小火，就不要塞滿版篝火）。
- **盤面照競品，不照 FG.psd**：PSD 只拿美術和格子位置；格子內容、落下順序、數值照競品那一段的畫面排。
- **黑底特效要放時一律滿版**（縮放到蓋滿 1080×1920、Add 混合，用 director 的 `full()`）；帶透明的局部光效（能量元素包）照原大小放在事件位置。

## 流程（照順序，一次做完）

### 1. 盤點（不動手做）
```
python scripts/sheet.py <競品.mp4> work/<案子>/ref/overview.png 0 <長度> 4 12 150        # 整支每 4 秒
python scripts/assets_sheet.py <素材資料夾> work/<案子>/psd/assets.jpg                    # 每支影片 / 連續圖 / 靜態圖
py311 scripts/psd_tree.py work/<案子>/psd <每個 PSD ...>                                  # 圖層樹 + 預覽
```
- 競品：先看整支，再對**每個關鍵段落每 0.25 秒**抽一張（`sheet.py ... 0.25`）：符號**怎麼進場**（原地轉？從上面飛下來？掉落？）、落地後變成什麼、特效 / 音效在哪。這一步省掉的話，後面一定重做。
- 素材資料夾旁邊的「基礎素材包」等其他資料夾也要掃。檔名有 `[ ]` 等特殊字元時 ffmpeg 開不了：先複製成英數字檔名。
- 特效包（energy-combined-elements、seamless-energy-anime-transition 這類）是很多段接在一條時間軸上：每 0.25 ~ 0.5 秒抽格看，記下每段的秒數再切（`templates/prep_fx.py`）。
- 素材：PSD 的每個智慧物件、隱藏圖層也要看（`psd_export.py` 會強制顯示）；**內嵌的智慧物件可能和外面的同名 PSD 不一樣**（MG 裡的轉盤是另一個版本），以畫面上用的那份為準。

### 2. 三份清單（寫在回報裡，先不用等確認）
1. **競品逐段表**：每段秒數、畫面、符號表演、特效、音效。
2. **素材對照表**：競品每個元素 → 我們哪個檔案；沒有的標「缺，用 ○○ 代替」。
3. **分鏡時間表**：每段幾秒（總長 ≤ 29.8 秒）。

### 3. 照 PSD 對位整理素材
把 `templates/` 複製到 `work/<案子>/` 再改（範本是 Spicy Fortunes 的，圖層名稱 / 場景要換）。
- **位置一律用 PSD 的**：`so_transforms.py` 讀智慧物件的變形（中心、縮放），圖層像素 + bbox 輸出；**不要自己排版**。整理完把場景照 PSD 疊回去和 PSD 合成圖比（`prep_v2.py` 最後一段），平均差要 < 3。
- 有圖層效果（陰影、顏色覆蓋、描邊）的圖層，psd-tools 沒有 scikit-image 畫不出來：用 PSD 存的合成圖（`topil()`）取顏色、原圖層取 alpha，不要自己調色。
- 連續圖 / 影片要疊在靜態符號上時，用 `calibrate.py 靜態.png 連續圖一格.png` 量縮放和位移，不要用估的。
- 純色底影片（青色、洋紅、黑）用 ffmpeg 去背成 ProRes 4444；黑底火焰用 Add 混合。

### 4. 演出設計 → 產生建置腳本
- 轉盤：偵測格線角度（每格幾度、哪一格在哪），決定停哪一格、離下一個大獎差幾度（差一點就中）。轉動曲線、指針撥動、答答聲時間都在 `make_ad.js` 算。
- 轉輪 / 格子：用 SlotFakeSpin（`hs-init` / `hs-board` / `win`）。**先確認競品的符號是「原地轉」還是「飛入落格」**；飛入落格時隱藏 SlotFakeSpin 的盤面，只留它的時間和報獎，飛入在 director 裡做。
- 報獎：SlotFakeSpin 的 `win`，標題換成 BIG WIN 美術圖（`dressBigWin`）。
- 鏡頭：事件瞬間推近再回彈，幅度小（不裁掉要讀的數字）。
- `node make_ad.js` → `kit/build_ad.jsx`（資料 + director，全 ASCII，AE / EffectCraft 共用）。

### 5. 建出來、自己檢查、出片
```
node scripts/mock_check.js work/<案子>          # AE 路線（開新專案、$.evalFile、存 .aep）在模擬 AE 跑得通
node scripts/ec_build.js work/<案子> 0.5,2,4,... --screen   # EffectCraft 建出來，抽格看（SCREEN = 不含機台）
effectcraft-cli render --comp AD_... --out v1.mp4 --audio on --project work/<案子>/kit/ad.ecproj
node scripts/compare.js work/<案子>             # 依 compare.json 做競品並排對比
```
- 抽格檢查：對位（和 PSD 合成圖比）、符號表演和競品同一秒比、報獎在最上層、片尾停在 BIG WIN。
- ffprobe 確認 < 30 秒；ffmpeg volumedetect 確認峰值 < -1 dB。
- 影片 > 30MB 傳不到手機：另外壓一份 `_preview.mp4`（crf 24）再 SendUserFile。

### 6. 回報（第一版就交）
- v1 影片、對比影片、三份清單、**和競品還不一樣的地方**（逐點）、**缺的素材**（照 [reference/checklist.md](reference/checklist.md) 的格式）。
- AE kit：`kit/` 裡的 build_ad.jsx + SlotFakeSpin_apply.jsx + fg.json + assets 打包成 ZIP（說明.txt 寫用法和音效對點）。

## 踩過的坑（每一條都讓那個案子重做過）
| 坑 | 正確做法 |
| --- | --- |
| 設父層後 AE / EffectCraft 會保留畫面變形，子層縮放被改成 1/父層 | `L()` 設父層後一定重設縮放、旋轉（範本已處理） |
| 自己排版、自己估連續圖大小 | 位置用 PSD 智慧物件變形；連續圖用 `calibrate.py` |
| 只用「亮的特殊符號」，畫面符號種類太少 | 素材對照表把 PSD 裡所有亮版符號都列出來再選 |
| 把競品的「飛入落格」做成原地轉 | 第 1 步每 0.25 秒看符號進場 |
| 圖層效果做的壓暗 / 變色，自己調色結果不同 | 用 PSD 合成圖取色 |
| EffectCraft 沒有 `$.evalFile`、不存圖層註解 | 測試時內嵌 apply；用來源合成的註解認圖層 |
| EffectCraft 的 Displacement Map 多一個參數 | `numProperties >= 9` 時參數往後一格（範本已處理） |
| 影片圖層出點超過素材長度會丟錯 | 要延長就開時間重映射 + loopOut |
| ffmpeg drawtext 在這台壞掉（fontconfig） | 文字用 Pillow 畫成 PNG 再 overlay |
| 轉盤停在格子邊緣（為了「差一點」），固定的中獎框跨兩格 | 停在中獎那一格正中間；「差一點」用減速的節奏表現 |
| 競品的格子圖沒有（綠 / 金辣椒格） | 用同造型的格子轉色相（HSV）做出來，回報時列為「改色代替」 |
| 空格子是純色、競品底下有壓暗符號 | 從 FG.psd 合成圖逐格取壓暗符號，亮的格子用別格補 |
| 碗 PSD 的「背景」是黑底圖層 | 只疊狀態（less / half / full）+ 標籤 |
| 影片底色不一定是青色（blue_bow 是洋紅） | 先取角落顏色再 colorkey |
| 轉場特效有黑白色塊 | Add 混合 + 放大到滿版 |
| 機台曲面螢幕 | 綠幕做遮罩 + Displacement Map 每列壓進螢幕寬度（`make_map.py`）；開發人員說先不用機台就整個關掉（`cabinet: false`） |
