namespace Block_builders.Services;

/// <summary>
/// Gemini 呼叫設定。金鑰有兩條路，先找設定值、找不到才讀金鑰檔：
/// <list type="bullet">
/// <item>金鑰檔 <c>gemini.key</c>（預設，見 <see cref="ApiKeyFile"/>）——貼上存檔就好，
///       檔案在專案根目錄、不在 wwwroot 底下，所以不會被當靜態檔送出去。改完不必重啟。</item>
/// <item>設定值 <c>Gemini:ApiKey</c>——user-secrets 或環境變數 <c>Gemini__ApiKey</c>。
///       兩邊都有值時以設定值優先。</item>
/// </list>
/// 不要寫進 appsettings.json：那份會進版控。
/// </summary>
public sealed class GeminiOptions
{
    public const string Section = "Gemini";

    public string ApiKey { get; set; } = "";

    /// <summary>
    /// 金鑰檔的路徑，相對於專案根目錄（ContentRoot）。
    /// 內容就是那一行金鑰；空行與 <c>#</c> 開頭的行會被忽略，所以檔案裡可以留說明。
    /// </summary>
    public string ApiKeyFile { get; set; } = "gemini.key";

    /// <summary>
    /// 模型名稱。這是會隨 Google 改版變動的東西，所以做成設定值——
    /// 打不通時先去 Google AI 的模型文件對一下現在叫什麼。
    /// </summary>
    public string Model { get; set; } = "gemini-3.8-flash";

    /// <summary>
    /// 產生器頁那個下拉選單可以挑的模型。<see cref="Model"/> 是其中的預設值
    /// （不在清單裡的話會自動補進去，所以設定只寫 <c>Model</c> 也不會壞）。
    /// <para>
    /// <b>這是白名單，不是提示清單。</b>前端送上來的 <c>model</c> 一定要對得上這裡的某一項，
    /// 對不上就擋掉——模型名字會被插進呼叫網址的路徑
    /// （<c>/v1beta/models/{model}:generateContent</c>），收前端的自由字串等於讓外面的人
    /// 決定要打哪個網址。要加新模型就在這裡加一行，不必改程式。
    /// </para>
    /// </summary>
    public string[] Models { get; set; } = ["gemini-3.8-flash", "gemini-3.7-flash"];

    /// <summary>
    /// 挑出這次要用哪個模型。<paramref name="want"/> 是前端送來的，只有**逐字**對得上
    /// 白名單裡某一項才採用；空的或對不上一律退回 <see cref="Model"/>。
    /// 回傳的字串永遠是白名單（或 <see cref="Model"/>）裡那一份，不是呼叫端給的那份。
    /// </summary>
    public string ResolveModel(string? want)
    {
        if (string.IsNullOrWhiteSpace(want)) return Model;
        var w = want.Trim();
        foreach (var m in AllowedModels())
            if (string.Equals(m, w, StringComparison.Ordinal)) return m;
        return Model;
    }

    /// <summary>
    /// 產生器頁那兩個思考下拉可以挑的等級。<c>minimal</c> 這個模型不收，所以只有三格。
    /// <para>
    /// <b>這裡只列第一版與改版兩格能挑的值，自動重跑那一輪（<see cref="RepairThinkingLevel"/>）
    /// 不開放在頁面上調</b>——它是前兩格降下去之後的保單（漏參數由它接住），
    /// 讓人在頁面上關掉保單，等於讓另外兩格的下修變成沒有底。要動它只能改設定。
    /// </para>
    /// </summary>
    public string[] ThinkingLevels { get; set; } = ["low", "medium", "high"];

    /// <summary>
    /// 挑出這一格要用哪個思考強度。<paramref name="want"/> 是前端送來的，只有逐字對得上
    /// <see cref="ThinkingLevels"/> 才採用；空的或對不上一律退回 <paramref name="fallback"/>
    /// （那一格自己的設定值）。對不上不報錯——那是設定沒同步，不是使用者的錯。
    /// </summary>
    public string ResolveThink(string? want, string fallback)
    {
        if (string.IsNullOrWhiteSpace(want)) return fallback;
        var w = want.Trim();
        foreach (var t in AllowedThinkingLevels())
            if (string.Equals(t, w, StringComparison.OrdinalIgnoreCase)) return t;
        return fallback;
    }

    /// <summary>思考等級白名單，去掉空白與重複，順序穩定。</summary>
    public IReadOnlyList<string> AllowedThinkingLevels()
    {
        var list = new List<string>();
        foreach (var t in ThinkingLevels ?? [])
        {
            var v = (t ?? "").Trim();
            if (v.Length > 0 && !list.Contains(v, StringComparer.OrdinalIgnoreCase)) list.Add(v);
        }
        return list.Count > 0 ? list : ["low", "medium", "high"];
    }

    /// <summary>白名單，保證含 <see cref="Model"/>、去掉空白與重複，順序穩定。</summary>
    public IReadOnlyList<string> AllowedModels()
    {
        var list = new List<string> { Model.Trim() };
        foreach (var m in Models ?? [])
        {
            var t = (m ?? "").Trim();
            if (t.Length > 0 && !list.Contains(t, StringComparer.Ordinal)) list.Add(t);
        }
        return list;
    }

    public string BaseUrl { get; set; } = "https://generativelanguage.googleapis.com";

    /// <summary>
    /// 診斷有必修時最多再要幾次（第一次產生不算）。
    /// 一輪就是一次完整的模型呼叫，設太大會等很久。
    /// </summary>
    public int MaxRepairRounds { get; set; } = 3;

    /// <summary>單次呼叫的逾時。藍圖有六百行說明書要讀、輸出也長，給寬一點。</summary>
    public int TimeoutSeconds { get; set; } = 300;

    /// <summary>
    /// 溫度。**刻意壓低**：這件事是「照一份規格產出必須跑得起來的程式」，
    /// 溫度高換來的不是創意而是漏參數、算錯座標。
    /// 候選之間的差異不靠溫度亂數，靠給每個候選不同的「取向」
    /// （見 <c>BlueprintGenerator.Angle()</c>）——那樣拿到的是三個真的不同的做法，
    /// 而不是同一個做法擲三次骰子。
    ///
    /// 曾經是 0.35，留那個高度是為了讓候選之間有差異；候選預設關掉之後
    /// （<see cref="Candidates"/>＝1）那個理由就不成立了，所以降到跟修復輪同一格。
    /// **注意它不是成本旋鈕**：溫度不改變 token 量，降它省到的是「少出錯→少觸發重跑」，
    /// 而重跑實測只佔 14 次呼叫裡的 1 次，上限就那麼多。
    /// </summary>
    public double Temperature { get; set; } = 0.2;

    /// <summary>蓋不起來、自動重跑那幾輪用的溫度。要的是照報告改對，所以更低。</summary>
    public double RepairTemperature { get; set; } = 0.2;

    /// <summary>
    /// 第一版的思考強度。<c>low</c>／<c>medium</c>／<c>high</c>（gemini-3.8-flash 預設 medium，
    /// 不接受 <c>minimal</c>）。**思考的 token 按輸出計價、量又是輸出的兩倍**
    /// （使用者實測），所以這是整條流程最貴的一格。空字串＝不送這個設定。
    ///
    /// 曾經是 high，理由是「讀六百行規格 ＋ 算幾何 ＋ 對照參考圖」符合官方文件對 high 的
    /// 描述（difficult multi-step tasks）。**降到 medium 的依據是 13 筆真實產出**：
    /// <list type="bullet">
    /// <item><b>13 筆全部都有參考圖</b>（都量到 8 個主色），純文字的一筆都沒有。
    ///       所以「從零規劃」這個說法站不住——它手上永遠有圖、有量好的色盤、有兩萬多字的規格。
    ///       這也是為什麼**不需要**做一個「有圖才降」的條件分支：有圖就是 100% 的流量，
    ///       那條分支永遠成立，另一條永遠不會被走到。</item>
    /// <item>那 13 筆的成績（92% 第一次就蓋得起來、平均 0.8 個 ⚠、`fails` 全空）
    ///       本來就是「有圖 ＋ 量好主色 ＋ high」量出來的。它證明這個組合很穩，
    ///       但沒有證明那 92% 是 high 買來的。</item>
    /// <item>降錯的代價有界：蓋不起來由體檢擋下、自動重跑一輪，而那一輪是
    ///       <see cref="RepairThinkingLevel"/>（high）。細節變少的話使用者看四視圖就看得出來，
    ///       按「再改一版」即可。</item>
    /// </list>
    /// 使用者用手動網頁版的經驗：**開思考的時候明顯比較不會產出缺參數的藍圖**
    /// （那正是體檢裡「第 7 個參數 c 沒給」那一類，也是修復迴圈最常在修的東西）。
    /// 所以是降一級、不是關掉——`minimal` 這個模型也不收。
    /// </summary>
    public string ThinkingLevel { get; set; } = "medium";

    /// <summary>
    /// 「照意見再改一版」與「自動打磨」那一輪的思考強度。**預設 medium。**
    ///
    /// 現在跟 <see cref="ThinkingLevel"/> 同一格（兩邊都降過一次），但**這一格不要再往 low 走**，
    /// 至少不要在 medium 還沒實跑過之前：revise 每一輪都要重吐整份 8 KB 藍圖，
    /// 思考太低時它可能**安靜地把使用者原本喜歡的部件簡化掉**——而那個病徵
    /// **沒有任何一條檢查抓得到**（`fails` 只擋載不進來，⚠ 只擋東西沒畫上去），
    /// 只有使用者看四視圖看得出來。第一版沒有這個風險（本來就沒有前一版可以弄壞）。
    ///
    /// 這一格獨立存在的理由（13 筆產生紀錄）：
    /// <list type="bullet">
    /// <item>revise 手上已經有一份**能跑的藍圖**、它的體檢報告、參考圖與四視圖三張圖。
    ///       難的那一半（從零規劃幾何、決定係數比例）第一版付過錢了。</item>
    /// <item>實際的意見長這樣：「加個手銬好了」「手銬換個顏色吧 看不出來」「五官看不太清楚
    ///       改黑色的吧」——都是一句話的局部修改，卻要以 high 思考重吐整份 8 KB 藍圖。</item>
    /// <item>13 條產生鏈裡 **12 條第一次呼叫就蓋得起來**（92%），「缺參數」那一類一次都沒發生。
    ///       high 買的東西已經接近天花板，而它買不到「像不像」——那才是每一輪 revise 在追的東西。</item>
    /// <item>使用者實測：**思考大約是輸出的兩倍用量**，也就是這一格佔了按輸出計價那一半帳單的三分之二。
    ///       revise ＋ 打磨佔全部呼叫的 36%（14 次裡的 5 次）。</item>
    /// </list>
    /// **缺參數那一類的保險早就買好了**：真的吐出缺參數的藍圖，體檢會擋下來、自動重跑一輪，
    /// 而那一輪照樣是 <see cref="RepairThinkingLevel"/>（high）。所以最壞情況是偶爾多一次呼叫。
    /// 上面那個「安靜地簡化掉」則**不在這張保單的範圍內**——那才是這一格不能再往下的理由。
    /// 要退回舊行為就填 high。
    /// </summary>
    public string ReviseThinkingLevel { get; set; } = "medium";

    /// <summary>
    /// 自動重跑那幾輪的思考強度。**跟第一版那一輪一樣是 high，不要調低。**
    /// 曾經設成 low，理由是「照報告修錯不必想很久」——那個理由是錯的：
    /// 每一輪都要**重新輸出整份藍圖**（連撞名那一輪的指示都是「只改 name，其餘不要動，
    /// 輸出完整的藍圖」），所以每一輪都同樣有「某支函式漏給參數」的風險。
    /// 在最該防缺參數的那幾輪把思考關小是反的，而且修復鏈跑完 4 輪失敗
    /// 比一次高思考貴得多。
    ///
    /// 這一格也**不是成本問題**：實測 13 條產生鏈只有 1 條需要重跑（14 次呼叫裡的 1 次）。
    /// 它反而是把 <see cref="ReviseThinkingLevel"/> 調低之後的那張保單——調低換來的漏參數
    /// 由這一輪接住。
    /// </summary>
    public string RepairThinkingLevel { get; set; } = "high";

    /// <summary>
    /// 第一版一次要幾個候選（並行呼叫，各自獨立跑完體檢與四視圖），使用者從中挑一個。
    ///
    /// <b>預設 1（關掉）。</b> 曾經預設 3，但那是錯的取捨：
    /// <list type="bullet">
    /// <item>機器**挑不出**哪個比較像——後端只能照「提醒最少」排，而提醒多寡跟像不像
    ///       幾乎無關。所以預設顯示的那個等於隨機挑，比較的工作全推給使用者。</item>
    /// <item>第二輪之後使用者的意見（「握把太小、杯口厚邊不見了」）比重擲骰子有用得多，
    ///       而那條路一次只花一次呼叫。</item>
    /// <item>三個候選的成本是 3 倍，換來的是多兩張圖要看。</item>
    /// </list>
    /// 機制留著（設 2 以上就會並行跑、前端也會擺出那一排讓你挑），
    /// 想比較同一句話的幾種做法時再開。設 1 時 <see cref="PolishRounds"/> 才會生效，
    /// 而那一輪是照客觀報告修東西，比再抽一個樣本划算。
    /// </summary>
    public int Candidates { get; set; } = 1;

    /// <summary>
    /// 「自動打磨」：第一版蓋出來、但體檢有提醒（⚠）時，自動再叫一次把那些修掉，
    /// 才把結果交給使用者看。**只在 <see cref="Candidates"/> ＝ 1 時才會做**——
    /// 產了三個候選的時候你本來就在挑，再各打磨一輪只是把成本乘三。
    ///
    /// 這跟「讓模型自己說夠像了」不是同一件事：它不做任何判斷、也不會提早收工，
    /// 只是照客觀報告固定多修一輪。「像不像」的決定權還是在使用者手上。
    /// </summary>
    public int PolishRounds { get; set; } = 1;

    /// <summary>
    /// 「自我對照」：一版蓋出來、四視圖也拍好之後再叫一次，拿它**開工時自己寫下的那幾行註解**
    /// （正面／側面／三樣識別物／部件清單）與參考圖，逐條比對四視圖，
    /// 列出「說好要有、圖上卻看不到」的地方。<b>0 ＝ 關掉，1 ＝ 做（預設）。</b>
    ///
    /// <b>這一輪不改任何東西</b>——只產一份清單顯示在產生器頁上，要不要拿去改一版
    /// 是使用者按鈕決定的。所以它跟「讓模型自己說夠像了」不是同一件事：
    /// 它不判斷像不像、不會提早收工、也碰不到程式。
    ///
    /// 補的是說明書第 5 節第 6 項留下的洞。那一項（「請玩家跑一次診斷、把報告與截圖貼回來，
    /// 不夠像就調係數、補部件再來一次」）是整份說明書裡唯一的「像不像」驗收步驟，
    /// 而後端模式把它剝掉了（`&lt;!-- 後端不送 --&gt;`，見 <c>BlueprintStore.StripHumanOnly</c>）——
    /// <b>剝掉之後沒有東西接手</b>：<see cref="PolishRounds"/> 只在有「重要」⚠ 時才觸發，
    /// 而那幾條全是客觀缺陷（窗戶落空、碎塊飄著、部件太少），跟像不像無關。
    /// 實測一份尾巴形狀不對、腮紅大了一圈的皮卡丘，體檢結論是「沒有必修、沒有提醒」。
    ///
    /// <b>只在 <see cref="Candidates"/> ＝ 1 時做</b>（跟 <see cref="PolishRounds"/> 同一個理由，
    /// 外加一條：清單只對得上一份藍圖，多候選時擺一份清單在旁邊會誤導）。
    /// </summary>
    public int CompareRounds { get; set; } = 1;

    /// <summary>
    /// 自我對照那一輪的思考強度。
    ///
    /// <b>這一格的降級風險跟另外三格都不一樣</b>：它不輸出程式，所以既不會漏參數
    /// （<see cref="RepairThinkingLevel"/> 在防的），也不會安靜地把部件簡化掉
    /// （<see cref="ReviseThinkingLevel"/> 在防的）。降過頭的唯一後果是**清單變粗**，
    /// 而清單是攤開來給使用者看的、覺得不對就自己改，壞不了東西。
    ///
    /// **實測之後降成 low**（2026-09-22，六筆真實紀錄的 <c>CompareUsage</c>）：
    /// 這一輪的**思考是輸出的 3.41 倍**——輸出才兩三百 token，錢幾乎全花在看圖思考上，
    /// 一次 US$0.0077、佔一輪產生的 22%。而它是每次 generate／revise 都會付的固定成本。
    /// 既然降級的唯一後果是清單變粗、而清單就攤在使用者眼前，那就值得降下來看看。
    ///
    /// **清單品質是這個功能的全部價值，覺得變粗就調回 medium。**
    /// 兩者的成本差比得出來——每一筆紀錄都帶 <see cref="HistoryHead.CompareUsage"/>。
    /// </summary>
    public string CompareThinkingLevel { get; set; } = "low";

    /// <summary>
    /// 輸出上限。藍圖動輒一兩百行，加上模型自己的思考預算，砍太小會在中途斷掉——
    /// 斷掉的程式一定是語法錯誤，修復迴圈會白跑好幾輪。
    /// </summary>
    public int MaxOutputTokens { get; set; } = 32768;

    /// <summary>
    /// 拍四視圖用哪一個建材檔位（面板三檔是 1800／3000／9000）。
    /// 預設 9000：說明書第 6 節寫著「上萬塊正是看得出像不像的那一檔」，而預覽頁自己的
    /// 預設是 3000——在 3000 塊評「像不像」是在看它最不利的那一檔（實測：皮卡丘在
    /// 3000 塊沒有手腳、五官糊成一片）。這一檔也是遊戲面板能挑的最大值。
    /// </summary>
    public int ShotSlots { get; set; } = 9000;

    /// <summary>
    /// 送給模型的圖片最長邊（像素）。**不要拿它省 token**——Gemini 3 的圖片是按
    /// <see cref="ShotMediaResolution"/> 固定計價的（一張 HIGH ＝ 1120 個 token），
    /// 跟像素多少、檔案多大都無關。所以預設就是四視圖的原生 1024（＝不縮），
    /// 縮小只會讓模型看不清楚而一個 token 都省不到。
    /// 這個設定真正的用途是壓上傳的位元組（手機拍的 8 MB 照片先縮再送）。
    /// </summary>
    public int ImageMaxPx { get; set; } = 1024;

    /// <summary>送給模型的圖片 JPEG 品質（0.3–1）。只影響上傳的位元組與畫質，不影響 token。</summary>
    public double ImageQuality { get; set; } = 0.90;

    /// <summary>
    /// 四視圖的 <c>mediaResolution</c>。這是**圖片 token 的唯一旋鈕**（每張固定）：
    /// LOW 280、MEDIUM 560、HIGH 1120（不指定時的預設）、ULTRA_HIGH 2240。
    /// 四視圖就是判斷「像不像」的那張圖，而 2240 個 token 在一次呼叫裡微不足道
    /// （光說明書就兩萬多個），所以給 ULTRA_HIGH。空字串＝不送、照 API 預設。
    /// ULTRA_HIGH 只能逐張指定，不能設在 generationConfig 上。
    /// </summary>
    public string ShotMediaResolution { get; set; } = "MEDIA_RESOLUTION_ULTRA_HIGH";

    /// <summary>使用者上傳的參考圖／補充圖的 <c>mediaResolution</c>。HIGH 就是 API 預設值。</summary>
    public string ImageMediaResolution { get; set; } = "MEDIA_RESOLUTION_HIGH";

    /* ── 計價（只用來把「這一輪花了多少」算給使用者看）──────────────
       gemini-3.8-flash 的優惠價（2026-12-31 前）：輸入 US$0.75／百萬、輸出 US$3.75／百萬。
       2027-01-01 起是 1.50／7.50。命中隱式快取的輸入打一折（0.075）——同一份 system
       instruction 每輪重送，這一折就是這條流程最大的省法，而且不必做任何設定。
       數字會變，所以做成設定值；算出來的是估算，帳單以 Google 為準。 */
    public double InputPricePerMTok { get; set; } = 0.75;
    public double CachedInputPricePerMTok { get; set; } = 0.075;
    public double OutputPricePerMTok { get; set; } = 3.75;
}
