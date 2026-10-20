# Spicy Fortunes：寶石觸發

直式（1080×1920）遊戲畫面，5 輪 × 3 列。第 2 輪整輪辣椒人（百搭），粉 / 藍 / 綠鑽任 3 顆觸發。

結果盤面（照 PSD）：

```
TACO   CHILI BLUE K     TACO
PINK   CHILI J    A     PINK
GUITAR CHILI 10   GREEN GUITAR
```

設計：R3 停下時第 2 顆寶石落地 → R4、R5 期待並繞框；R4 的綠鑽是第 3 顆（觸發），R5 再追第 4 顆、多拖 0.3 秒；停妥後 0.2 秒框住 4 顆寶石、跳動 120%。

`preset.json` 是做好的設定（符號圖不在 repo 裡，`from-psd` 會從你的 PSD 拆出來）。

## 重現

```
P=work/spicy/preset.json
node tools/sfs.js from-psd MG.psd --out $P --names "塔可=TACO,粉鑽=PINK,吉他=GUITAR,辣椒人=CHILI,藍鑽=BLUE,綠鑽=GREEN" --triggers PINK,BLUE,GREEN --wilds CHILI
node tools/sfs.js set $P spin.startTime=0.5 antRule.count=3 antRule.after=true spin.antTime=0.9 spin.antDecelTime=0.55 spin.antCurve=soft spin.antSpeed=0
node tools/sfs.js suggest $P --apply
node tools/sfs.js reel $P 5 stop=+0.3
node tools/sfs.js lines $P --clear --detect
node tools/sfs.js set $P lineGen.delay=0.2 lineGen.mode=all lineGen.allTime=1.8 lineStyle.pulse=120
node tools/sfs.js check $P
```

在面板做的話：快速頁 ① 匯入 `from-psd` 拆出的 `symbols/` → ② 文字輸入結果盤面 → ③ 演出選「觸發」、觸發符號填 `PINK,BLUE,GREEN`、3 顆。

建立：

```
node tools/sfs.js ae $P --comp MG                                    # After Effects（主合成 1080×1920、至少 8 秒）
node tools/sfs.js ec $P --project MG.ecproj --comp MG --render gem.mp4  # 沒有 AE：EffectCraft
```

盤面會依 `layout.position` 放到 (540, 1434)，對準 PSD 的轉輪窗；背景用 `from-psd` 輸出的 `bg.png`（拿掉符號群組的遊戲畫面）。

## 音效對點（合成時間）

| 秒 | 影格 | 標記 |
| --- | --- | --- |
| 0.50 | 15 | SPIN |
| 1.50 | 45 | R1 STOP |
| 1.77 | 53 | R2 STOP |
| 2.00 | 60 | R3 STOP / R4 FRAME |
| 3.17 | 95 | R4 STOP / R5 FRAME |
| 4.60 | 138 | R5 STOP |
| 4.80 | 144 | ALL SETTLED |
| 5.00 | 150 | LINE 1（寶石框） |

辣椒人的圖（229×206）比格子（200×200）大，會被轉輪裁到左右；`from-psd --fit-oversize` 或 `symbol $P CHILI --scale 87` 可以縮小。
