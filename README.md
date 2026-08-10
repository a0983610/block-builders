# 積木小人 · 世界地標工地

小人們把散落一地的積木一塊一塊搬去蓋世界地標；蓋好之後你一槌砸下去，
被打到的那一塊區域會炸開飛散，沒被波及的地方原封不動，然後小人再默默把它蓋回來。

**雙擊 `index.html` 就能玩**，不用開 server、不用連網路。

## 操作

| 動作 | 效果 |
|---|---|
| 點建築 | 一槌砸下去。散開的方向跟你從哪個角度點有關 |
| 點小人 | 他會跌倒，手上的積木掉下來 |
| 拖曳 | 轉視角 |
| 滾輪 / 雙指 | 縮放 |
| 左下面板 | 選建築、建材數（300–3000）、小人數（1–60）、時間倍率（0.2–4×） |
| 右上 | 現在時間、本座施工計時，可切全螢幕時鐘 |

## 檔案

```
index.html              遊戲頁面（HTML + CSS + HUD）
lib/three.min.js        three.js r185，打包成 classic script（產出物，勿手改）
src/blueprints.js       36 座地標的 voxel 產生器，不依賴 three，可單獨 require 測
src/engine.js           three 場景、光影、相機、InstancedMesh 積木池（只管怎麼畫）
src/game.js             積木狀態、物理、小人 AI、破壞、主迴圈（只管規則）
tools/build-three.cjs   把官方 three build 轉成 classic script
tools/e2e-3d.cjs        這一版的端對端測試（84 項）
block-builders.html     舊的 canvas 2D 版本，待新版驗收後移除
tools/e2e.cjs           舊版的測試（111 項），跟著舊檔一起移除
```

## three.js 為什麼要自己打包

官方 build 只出 ES module，而 **ES module 走 `file://` 會被 CORS 擋掉**：

```
Access to script at 'file:///...' from origin 'null' has been blocked by CORS policy
```

雙擊開檔就整支掛掉。classic script（`<script src>`）沒有這個限制，所以把
`three.core.min.js` + `three.module.min.js` 轉成 IIFE 掛到 `window.THREE`。

要換 three 版本時：把原始碼解壓到 `three.js-master/`（此目錄不進 git，576 MB），然後

```
node tools/build-three.cjs
```

打包器會比對對外名稱是否與官方 `three.cjs` 完全一致（441 個），少一個就直接失敗。

## 跑測試

```
node tools/e2e-3d.cjs
```

需要 Playwright 與 chromium；找不到時腳本會印出安裝方式。全部通過 exit 0。
截圖產物在 `tools/.e2e-out/`（已 gitignore）。

測試一定跑真瀏覽器，因為這支程式的坑都在「真實環境與假物件的差異」：
ES module 的 CORS、canvas 是 replaced element、WebGL 的 drawingBuffer 合成後會被清空。

headless chromium 用 SwiftShader 軟體算圖，所以測出來的 fps 沒有參考價值；
效能那段量的是 CPU 端成本（`step` + `draw`），那個跟顯示卡無關。

## 效能

所有積木共用一個 `BoxGeometry` 走 `InstancedMesh`，不管 300 塊還是 3000 塊都是
**1 個 draw call**；小人的 7 個部位也全塞在同一個 InstancedMesh 裡。
整個場景含陰影約 10 個 draw call。

實測 CPU 端每幀成本（模擬 + 寫 instance buffer）：

| 積木 | 小人 | step | draw | 合計 |
|---|---|---|---|---|
| 969 | 20 | 0.01 ms | 0.15 ms | 0.16 ms |
| 2925 | 60 | 0.03 ms | 0.36 ms | 0.38 ms |

瓶頸在 GPU 的填充率與陰影貼圖，不在 CPU。

## 目前的範圍與已知限制

已完成：36 座地標藍圖（積木數自動對應目標）、小人 FSM 搬運建造、槌子局部破壞、
碎塊物理與落定、草地與樹、HUD（時鐘／施工計時／全螢幕時鐘／時間倍率／人數／建材數）。

已知限制：

- **造型品質不齊**。金字塔、艾菲爾鐵塔、台北 101、天壇、金門大橋、城堡、五重塔這些很好認；
  雪梨歌劇院最弱（帆殼在 voxel 下不容易做像），聖母院、獅身人面像次之。
- **積木數不是每座都能貼齊**。像台北 101 有八節、吳哥窟有五塔，造型本身就有最少積木數，
  設 400 塊時它給的是 900 多塊。HUD 一律顯示真實塊數。
- **沒有結構穩定性模擬**。被打掉下半部時，上面的積木不會跟著塌——
  這是刻意的：需求是「沒有被打到波及的地方可以不用壞掉」。
- **積木之間沒有碰撞**。碎塊落地後只做水平分離避免重疊，不會堆疊成山。
