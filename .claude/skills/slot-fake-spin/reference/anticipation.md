# 老虎機期待感設計手冊

這份是「期待感導演」的判斷依據。數值是 30fps、一般 5×3 視訊老虎機的經驗值，遇到不同遊戲以開發人員的要求和該遊戲實機為準。

## 1. 核心原則

1. **期待 = 看得到的可能性 × 被拖延的時間。** 只有玩家「已經看到」前面的輪讓下一輪有意義（差 1 顆 Scatter、大獎已經連到一半）時，拖延才是期待。沒有可能性的拖延只會讓人不耐煩。
2. **三段式：建立 → 拉高 → 釋放。**
   - 建立：前面的輪穩定、規律地停（固定間隔、標準減速），讓玩家建立節奏感。
   - 拉高：期待輪跟正常輪要有明顯落差：繞框、轉更久、可以先加速再長長的緩停、配上音效漸強（R# FRAME 標記）。
   - 釋放：停輪要「重」（衝過頭＋回彈），接著是連線、Scatter 框或大獎演出。
3. **對比比絕對值重要。** 期待輪多轉 0.8 秒、減速從 0.08 秒變成 0.5 秒緩停，玩家才感覺得到；只差 0.2 秒等於沒做。
4. **一層比一層強。** 連續兩個以上的期待輪時，後面的要更久、更強（多轉時間遞增、或繞框轉速更快），不要每輪都一樣。
5. **不要過量。** 一次假轉裡期待的總長度建議在 3~4 秒以內；連續期待超過 3 輪會疲乏。
6. **節奏要能對音效。** 停輪 = 衝到最遠點的那一刻（R# STOP 標記），這是停輪音效「咚」的位置；R# FRAME 是期待音效的起點。
7. **結果要合理。** 宣傳 / 展示影片裡的結果盤面應該是真實遊戲可能出現的結果（符號分布、每輪 Scatter 數量都要符合遊戲規則），也要遵守當地的博弈廣告規範。看到不可能的盤面要跟開發人員確認。

## 2. 參考數值（30fps）

| 項目 | 一般轉 | 快速轉 / Turbo | 期待輪 |
| --- | --- | --- | --- |
| 第一次停（firstStop） | 0.8–1.2 s | 0.5–0.7 s | — |
| 每次間隔（stagger） | 0.2–0.3 s | 0.08–0.12 s | — |
| 多轉時間（antTime） | — | — | 第一個 0.8–1.0 s，之後每輪 +0.2~0.4 s |
| 轉速（speeds） | 16–22 格/秒 | 22–28 格/秒 | 不變，或繞框時加速到 1.3–1.6 倍（antSpeed） |
| 減速 | 0.06–0.12 s 標準 | 0.05–0.08 s 急停 | 0.4–0.7 s 緩停 |
| 停輪衝過 / 回彈 | 0.1–0.2 格 / 0.15–0.25 s | 0.08 格 / 0.12 s | 0.15–0.25 格 / 0.2–0.3 s |
| 起轉拉回 | 0.15–0.3 格 / 0.1–0.2 s | 0.1 格 / 0.08 s | — |
| 起轉間隔（startStagger） | 0–0.05 s | 0 | — |

減速曲線：
- **標準**：等減速，一般停輪。
- **緩停**：先掉速，再長長地慢慢靠站，看得到符號一顆顆經過，最適合期待輪。
- **急停**：幾乎全速衝到底才煞住，乾脆、有力，適合快速轉或「重擊」感。

繞框：
- 從「讓期待成立的那一輪停下」那一刻開始（例如第 2 顆 Scatter 落地）。這是工具的預設。
- 停妥後保留 0.1–0.2 秒再淡出。
- 跑燈 1–1.5 圈/秒；越後面的期待輪可以越快。

連線 / 中獎：
- 全部停妥後 0.2–0.5 秒開始。
- 先全部一起亮 1.0–1.5 秒，再逐條 0.8–1.2 秒。
- 畫線 0.2–0.3 秒；符號跳動 110–120%。
- Scatter 觸發不是連線：用「只框格子」（線型裡 0 = 這輪不框，或 boxOnly）框住所有 Scatter，並讓它們跳動。

## 3. 常見情境配方

以下指令都在工具根目錄執行，`P` = 設定檔路徑。

### A. 一般轉、沒中
```
node tools/sfs.js set P spin.antReels= spin.firstStop=1 spin.stagger=0.25 spin.speeds=18
node tools/sfs.js lines P --clear
```

### B. Free Game 觸發（3 顆 Scatter）
最常見的期待。第 2 顆 Scatter 落地後，後面的輪全部期待。
```
node tools/sfs.js set P antRule.symbols=SCATTER antRule.count=3 antRule.after=true \
  spin.antTime=0.9 spin.antDecelTime=0.55 spin.antCurve=soft spin.antSpeed=0
node tools/sfs.js suggest P --apply
node tools/sfs.js reel P 5 stop=+0.3        # 最後一輪再多拖一點：一層比一層強
node tools/sfs.js lines P --clear --detect   # 會自動加「只框 Scatter」
node tools/sfs.js set P lineGen.delay=0.2 lineGen.mode=all lineGen.allTime=1.8 lineStyle.pulse=120
```

### C. 期待落空（差一顆沒中）
節奏同 B，但最後一輪沒有 Scatter。期待要做得一樣足，落空才有「可惜」感；不要加任何中獎演出。
落空常用在宣傳片的鋪陳段落，同一支影片裡不要連續用。

### D. 大獎聽牌（例如 7-7 後期待第 3 輪）
```
node tools/sfs.js set P antRule.tease=SEVEN antRule.teaseMin=2 spin.antTime=0.7 spin.antSpeed=24
node tools/sfs.js suggest P --apply
node tools/sfs.js lines P --clear --detect
```
連線一路延伸時期待也一路延伸（第 3 輪中 → 第 4 輪也期待），越後面越久。

### E. 快速轉 / Turbo
```
node tools/sfs.js set P spin.firstStop=0.55 spin.stagger=0.1 spin.speeds=24 spin.decelCurve=hard \
  spin.decelTime=0.06 spin.overshoot=0.08 spin.bounceTime=0.12 spin.windupDist=0.1 spin.windupTime=0.08
```

### F. 同時停 / 鎖定感
前三輪一起落下再接期待：`spin.stopOrder=1+2+3,4,5`。三輪同時停時，停輪音效只要一下。

### G. 由右往左 / 從中間往外
`spin.stopOrder=5,4,3,2,1`、`spin.stopOrder=3,2,4,1,5`。期待感建議會依實際停輪順序判斷（玩家沒看到的輪不算）。

## 4. 自我檢查清單

設計完先跑 `check` 和 `render --sheet`，看圖逐項確認：

- [ ] 開始前畫面 = 起始盤面；全部停妥畫面 = 結果盤面（和開發人員給的圖一格一格比對）。
- [ ] 期待輪真的有「可能性」（看 `suggest` 的理由），沒有無意義的拖延。
- [ ] 期待輪和正常輪的差距夠大（多轉 ≥ 0.6 秒、減速明顯變長）。
- [ ] 連續期待一層比一層強；期待總長度 ≤ 3~4 秒。
- [ ] 繞框在對的輪、從對的時間開始（讓期待成立的那一輪停下時）。
- [ ] 連線 / Scatter 框只在全部停妥後出現，框的格子正確。
- [ ] 標記時間合理，可以直接交給音效對點。
- [ ] 目標合成夠長（`ae` 的警告）。
