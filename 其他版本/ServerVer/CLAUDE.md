# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 動手前必讀

這個 repo 的知識**已經寫在文件裡**，不要靠猜。三份分工不同：

| 檔案 | 放什麼 | 什麼時候讀 |
|---|---|---|
| `開發必讀.md` | 架構、慣例、實際踩過的雷（「為什麼這樣寫」「哪裡看起來可以改其實不行」） | **改任何東西之前** |
| `調校筆記.md` | 量出來的數字、門檻怎麼校準、個案、量錯過什麼 | 要動門檻／預設值時 |
| `Block-builders/wwwroot/blueprints/藍圖製作說明.md` | 620 行的藍圖規格，**同時就是丟給 Gemini 的 system prompt 本體** | 改藍圖規格或 prompt 時 |
| `參考/block-builders/README.md` | 上游原版的九千行 README | 想知道遊戲某段當初為什麼那樣寫 → grep 它 |

新增文件內容前先分類：**數字與個案寫進〈調校筆記〉，規則與踩雷點寫進〈開發必讀〉**，不要混。

## 這是什麼

《積木小人 · 世界地標工地》voxel 建築遊戲的**後端版**。上游是一包雙擊 `index.html`
就能玩的純靜態遊戲，這裡用 ASP.NET Core 8 架起來，加一層 API 把「請 Gemini 寫一支藍圖」
那條人工流程半自動化。

核心迴圈（`BlueprintGenerator.ProduceAsync`）：

```
Gemini 產藍圖 → node 體檢 → 蓋不起來（fails 非空）→ 自動重跑（最多 4 輪，high 思考）
                          → 蓋起來 → 無頭 chromium 拍四視圖 PNG
                                   → 還有「重要」等級的 ⚠ → 自動打磨一輪再拍
                          → 每一輪都寫進 history/{目標}/（含失敗輪）
                          → 最後一次「自我對照」：拿它開工時寫下的設計比對四視圖，
                             列出「說好要有、圖上看不到」的清單（**不改程式**）
                          → 回給前端，使用者看四視圖 ＋ 那份清單自己決定
```

**半自動的分界是刻意的**：「蓋不起來」有客觀門檻，機器自己修；「像不像」沒有任何一條
檢查看得出來，所以那一關交給使用者按鈕。`generate` / `revise` **都不存檔**（只寫 history）。
自我對照那一輪**沒有跨過這條線**：它只把差異列出來、填進意見框，送不送出由使用者按。

## 常用指令

在 repo 根執行。**建置類一律用 PowerShell 工具，不要用 Bash**（`/flag` 會被 bash 當路徑）：

```powershell
dotnet build Block-builders.sln
dotnet run --project Block-builders --launch-profile https   # https://localhost:7053 + http://localhost:5273
dotnet watch --project Block-builders run
```

藍圖體檢與四視圖不必起站台（直接 require `wwwroot/src/blueprints.js`）：

```powershell
node Block-builders/tools/validate-bp.cjs Block-builders/wwwroot/blueprints/金閣寺.js  # 體檢＋後端加驗七條，吐 JSON
node Block-builders/tools/validate-bp.cjs 某藍圖.js 10000                             # 加驗改量別檔（預設 9000＝四視圖那一檔）
node Block-builders/tools/validate-bp.cjs --names                                     # 列出現有藍圖名字
node Block-builders/tools/shot-bp.cjs 某藍圖.js out.png [1800|3000|9000]               # 四視圖，預設 9000 檔
node 參考/block-builders/tools/check-bp.cjs --all                                     # 上游那支：全部摘要，給人看
```

- **測試**：沒有測試專案，`dotnet test` 無標的。上游有 e2e（`參考/block-builders/tools/e2e-3d.cjs`），
  沒搬過來。要加測試先問使用者放哪、用哪個框架。
- **Gemini 金鑰**：貼進 `Block-builders/gemini.key` 存檔就生效（不必重啟，每次呼叫都重讀）。
  或 `dotnet user-secrets`／環境變數 `Gemini__ApiKey`（優先於檔案）。
  **三者都不要寫進 `appsettings.json`**。
- **沒金鑰要測整條流程**：架假端點頂上去
  （`$env:Gemini__BaseUrl="http://localhost:8791"`，細節見〈開發必讀〉）。
  注意 stub 只能驗「送出去的請求長什麼樣」，**不能驗 Google 回什麼**（曾經拿 stub 的
  假 usage 當實測，結論是錯的）。
- **VS 按 F5 跑的是 IIS Express**（`localhost:55362` / `44368`），不是 `dotnet run` 那組
  5273 / 7053。給使用者網址前先確認他用哪一種啟動方式。

## 結構與職責

```
Block-builders.sln              方案在 repo 根，專案在子目錄（cwd ≠ 專案目錄）
參考/block-builders/            上游未修改原版（自帶 git repo）。唯讀對照基準，不要改
Block-builders/
  gemini.key                    金鑰（不在 wwwroot 底下）
  history/{目標}/               每一輪的 .js ＋ .json ＋ _ref/（參考圖，內容 hash 去重）
                                自動寫、會累積、不是靜態檔
  wwwroot/                      遊戲本體（從 參考/ 複製而來的工作副本）
    index.html                  玩遊戲（/ 由 UseDefaultFiles 接走）
    藍圖預覽.html                人工做藍圖：3D 互動、體檢、下載四視圖
    藍圖產生器.html              後端版新增：整條迴圈交給伺服器跑
    src/blueprints.js           引擎核心（5000 行）：checkBlueprint()、importBlueprint()、繪圖工具
    blueprints/*.js             自訂藍圖 ＋ list.js ＋ 藍圖製作說明.md
    shots/{目標}/*.png           產出的四視圖（累積，要清直接刪）
  tools/validate-bp.cjs         接線 checkBlueprint() ＋ 後端加驗七條
  tools/shot-bp.cjs             playwright 開 file:// 的藍圖預覽.html、按它自己的下載鈕
  Services/                     GeminiClient / NodeRunner / BlueprintValidator /
                                BlueprintShooter / BlueprintStore / BlueprintHistory /
                                BlueprintGenerator / SafeName
  Controllers/BlueprintsController.cs
```

API（`api/blueprints`）：`GET /`、`POST generate`、`POST revise`、`POST validate`、
`POST shot`、`POST compare`（只跑自我對照，不產生）、`POST save`、
`GET history`、`GET history/{stem}`。
`generate` / `revise` 是 multipart（`image` 欄位可重複給，上限 `MaxRefImages` = 4）。

三頁的分工是刻意的：**產生器頁只給靜態四視圖 PNG**（你評的跟 Gemini 評的是同一張圖），
要互動 3D 就按鈕交接給預覽頁（走 `localStorage['block-builders/handoff']`），
**不在產生器頁自己 init 一份引擎**。

## 改動時的硬約束

這幾條違反了會壞掉或白做，細節與實測數據都在〈開發必讀〉：

- **`參考/block-builders/` 不要改**，它是對照基準。要改遊戲行為改 `Block-builders/wwwroot/`。
- **命名不一致**：資料夾與組件是連字號 `Block-builders`，`RootNamespace` 與 C# namespace
  是底線 `Block_builders`（連字號在 C# 不合法）。
- **`TargetFramework` = `net8.0`**，本機 SDK 是 9.0.x。SDK 9 建 net8.0 沒問題，**不要擅自升 TFM**。
- **體檢邏輯不要在 C# 重寫。** `checkBlueprint()` / `importBlueprint()` 是遊戲、預覽頁、
  後端共用的同一支 JS；在 C# 重寫任何一段就等於讓報告跟〈藍圖製作說明〉第 7 節對不上。
  驗證器只做接線。
- **`藍圖製作說明.md` 改了就等於改 prompt**，別在 C# 裡另外寫一份規格。
  後端用不到的段落是用 `<!-- 後端不送 -->` 標記**剝掉**、不是用文字覆寫
  （互相矛盾的指令比沒有指令更糟）。
- **加新檢查要順便想「它進得了 `important` 嗎」**——只放 `fixable` 的檢查永遠不會自己
  觸發打磨，等於白做。加驗一律走 `warns` 不走 `fails`（`fails` 會逼模型去修沒壞的東西）。
- **`validate-bp.cjs` 的計數器要在所有 `fitScale` / `makeBlueprint` 之後才 reset**——
  那幾支內部是掃描，會把 `gen()` 跑幾十次。這個坑踩過兩次。
- **縮圖省不到 token。** Gemini 3 的圖片按 `mediaResolution` 固定計價，跟像素無關。
  能省的是思考強度與呼叫次數。
- **不要拿四視圖評顏色。** 圖上的顏色 ≠ 藍圖 `pal` 宣告的顏色：場景的天光、草綠地面反光
  與霧會把飽和色壓成灰（實測 `#fcda78` 拍出來是 `#838b7a`，飽和度 95%→7%）。
  照圖評色等於叫模型去改一份本來就正確的 `pal`，而且會越改越偏。細節見〈調校筆記〉6。
- **改 `index.html` 的 `#time` 卡要量寬度**（inline-block 按鈕會相加撐寬卡片，
  窄螢幕會跟時鐘卡疊）。隱藏東西用 `el.hidden`，不要 `style.display='none'`。
- **前端傳回的路徑一律清洗**：`BlueprintHistory.ReadAsync()` / `BlueprintShooter.TryLoadAsync()`
  只取檔名、並確認解出來的絕對路徑真的落在 `history/` / `shots/` 裡。
- **紀錄與四視圖存不進去不能影響產生流程**（吞 IO 例外只寫 log）。
- **改 `list.js` 要守三件事**：抬頭沿用檔案裡現有那段（上游 e2e 逐字比對）、LF 無 BOM、
  排序照 `藍圖預覽.html` 的 `bpFilesFrom()`。

## 版本控管

此目錄**不是 git repo**（`參考/block-builders/` 裡那個是上游自己的），沒有 `.gitignore`。
要 init git 的話先排除：`Block-builders/obj/`、`Block-builders/bin/`、`.vs/`、`*.csproj.user`、
**`Block-builders/gemini.key`**、`Block-builders/wwwroot/shots/`、`Block-builders/history/`。

## 還沒清的東西

`Controllers/HomeController.cs`、`Views/`、`Models/ErrorViewModel.cs` 是 VS 範本留下的，
`/` 已由遊戲的 `index.html` 接走，只剩 `/Home/Privacy` 還通。要清就一起把
`AddControllersWithViews()` 換成 `AddControllers()`、拿掉 `MapControllerRoute` 與
`UseExceptionHandler("/Home/Error")`。
