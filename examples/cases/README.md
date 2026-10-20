# 實際案例

用 SlotFakeSpin 做過的三個案例，放的是**設定檔、產生素材的腳本和步驟**。
符號圖、背景、競品影片都**不在 repo 裡**（公司美術與競品素材不能公開）：照各案例的說明，用腳本從你自己手上的素材產生，再用設定檔建出來。

| 案例 | 盤面 | 重點 |
| --- | --- | --- |
| [spicy-fortunes-gem-trigger](spicy-fortunes-gem-trigger/) | 5×3 一般轉輪 | 從遊戲畫面 PSD（`from-psd`）建設定；三色寶石任 3 顆觸發，R4、R5 期待 + 繞框，最後框住 4 顆寶石 |
| [fortunedoors-jackpot-wheel](fortunedoors-jackpot-wheel/) | 1×1 彩金滾輪 | 照競品影片還原 MEGA / MAJOR 滾輪：長緩停、MEGA 停輪前擦身而過（挑亂數種子）；附六角柱滾筒原型（表達式） |
| [fortunedoors-prosperity-holdspin](fortunedoors-prosperity-holdspin/) | 3×2 Hold & Spin | 祿盤 6 格重轉：格子各自轉、金幣鎖住、4 回合到全滿 |

沒有 After Effects 時可以用 EffectCraft（`node tools/sfs.js ec`）建出來並算圖；要交 .aep 但這台沒有 AE 時，用 `aep-kit` 打包給有 AE 的人一鍵存出 .aep，例如滾筒版：

```
node tools/sfs.js aep-kit preset_drum.json --out jp_drum_kit --comp JP --main 1920x1080@7 --bg bg.png --top pointers.png --post drum_prism.jsx --name JP_drum --zip
```

指令說明見 [cli.md](../../.claude/skills/slot-fake-spin/reference/cli.md)。
