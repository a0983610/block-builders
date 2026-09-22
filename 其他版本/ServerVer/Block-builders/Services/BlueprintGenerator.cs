using Microsoft.Extensions.Options;

namespace Block_builders.Services;

/// <summary>
/// 使用者在產生器頁挑的那幾格旋鈕。每一格都是 null＝照設定的預設。
/// <para>
/// <b>裡面的值必定已經過白名單</b>（<see cref="GeminiOptions.ResolveModel"/>／
/// <see cref="GeminiOptions.ResolveThink"/>，Controller 收表單時就挑好）：模型名字會被插進
/// 呼叫網址的路徑，思考等級送錯值 API 會回 400，兩個都不能直接收前端的字串。
/// </para>
/// <para>
/// <b>自動重跑那一輪的思考強度刻意不在這裡</b>（<see cref="GeminiOptions.RepairThinkingLevel"/>）：
/// 它是前兩格降下去之後的保單——漏參數的藍圖由體檢擋下、由那一輪以 high 重修。
/// 讓人在頁面上關掉保單，等於讓另外兩格的下修變成沒有底。要動它只能改設定。
/// </para>
/// </summary>
/// <param name="Model">整條鏈共用哪個模型（混著用的話帳單會是兩個模型加起來，分不出貴在哪）。</param>
/// <param name="Think">第一版那一輪的思考強度。</param>
/// <param name="ReviseThink">「再改一版」與「自動打磨」那一輪的思考強度。</param>
public sealed record RunTune(string? Model = null, string? Think = null, string? ReviseThink = null)
{
    public static readonly RunTune Default = new();
}

/// <summary>一輪＝一次 Gemini 呼叫，加上它產出那份藍圖的體檢與（過關才有的）四視圖。</summary>
/// <param name="Usage">
/// <b>這一輪自己</b>的用量。整條鏈的總帳在 <see cref="ProduceResult.Usage"/>——
/// 分開記才看得出「那 3 輪裡哪一輪最貴」（實測一次 high 的修復輪約是 medium 的 10 倍）。
/// </param>
public sealed record AttemptRound(
    int Round,
    string? Code,
    string? Report,
    string[] Fails,
    string[] Warns,
    string? Error,
    string? RenamedFrom,
    string? ShotUrl,
    UsageTotals? Usage = null,
    int? Slots = null);

/// <summary>
/// 一個候選版本。<c>Ok</c>＝蓋得起來，可以拿去給人看。
/// 一次「產生第一版」會有 <c>Gemini:Candidates</c> 個候選並行跑出來，使用者挑一個。
/// </summary>
public sealed record BpCandidate(
    int No,
    /// <summary>
    /// 給人看的標籤（「候選 1」／「打磨前」／「打磨後」）。前端那一排照這個顯示——
    /// 一律叫「候選 N」會騙人：打磨出來的那兩份是同一個候選的前後，不是兩個候選。
    /// </summary>
    string Label,
    bool Ok,
    string? Name,
    string? FileName,
    string? Code,
    string? Report,
    string[] Warns,
    /// <summary><see cref="Warns"/> 裡「值得順手修」的那幾項，見 <see cref="BlueprintCheck.Fixable"/>。</summary>
    string[] Fixable,
    /// <summary><see cref="Fixable"/> 裡夠嚴重、有資格自己觸發一輪打磨的那幾項。</summary>
    string[] Important,
    string? ShotUrl,
    int? Slots,
    string Message,
    IReadOnlyList<AttemptRound> Rounds,
    /// <summary>
    /// 這一份在產生紀錄裡的檔名主幹（<c>history/{Group}/{Stem}.json</c>，也就是四視圖那個檔名）。
    /// 自我對照是整條鏈都跑完、紀錄也寫好之後才跑的，要回頭把清單補進那一筆，所以得帶著它。
    /// 蓋不起來的那幾份沒有（那時還解不出名字）。
    /// </summary>
    string? Stem = null);

/// <summary>
/// 這一次操作總共用掉多少 token 與大約多少錢。
/// <paramref name="Cached"/> 是 <paramref name="Prompt"/> 裡命中隱式快取的部分（打一折）。
/// </summary>
public sealed record UsageTotals(int Calls, int Prompt, int Cached, int Output, int Thoughts, double Usd);

/// <summary>
/// 一次「產生」或「再改一版」的結果。
/// 平的那幾個欄位（<c>Code</c>／<c>Report</c>／<c>ShotUrl</c>…）是**挑出來當主角的那個候選**，
/// 完整清單在 <c>Candidates</c> 裡。只有一個候選時兩者一樣。
/// </summary>
public sealed record ProduceResult(
    bool Ok,
    string? Name,
    string? FileName,
    string? Code,
    string? Report,
    string[] Warns,
    string? ShotUrl,
    string Message,
    IReadOnlyList<AttemptRound> Rounds,
    IReadOnlyList<BpCandidate> Candidates,
    /// <summary>平的那幾個欄位對應的是哪一個候選（<c>BpCandidate.No</c>）。</summary>
    int PickedNo,
    UsageTotals Usage,
    /// <summary>
    /// 自我對照列出來的差異清單（見 <see cref="GeminiOptions.CompareRounds"/>）。
    /// null＝沒做或做不了：設定關掉、多候選、蓋不起來、四視圖拍不出來、那一次呼叫失敗。
    /// <b>它對應的是平的那幾個欄位那一份</b>，所以前端切換候選時要把它清掉。
    /// </summary>
    string? Diff = null);

/// <summary>
/// 「只跑對照」的結果（<see cref="BlueprintGenerator.CompareOnlyAsync"/>）。
/// 不含程式與報告——那一支不改藍圖，手上那一份就是傳進去的那一份。
/// </summary>
/// <param name="Diff">差異清單。null＝設定把對照關掉了、或那一次呼叫失敗。</param>
/// <param name="ShotUrl">對帳看的是哪一張四視圖（沿用現成的，檔案不在才現拍）。</param>
public sealed record CompareOnly(string? Diff, string ShotUrl, string? Name, UsageTotals Usage);

/// <summary>
/// 產生藍圖。分工是刻意的：
///
/// <list type="bullet">
/// <item><b>體檢錯誤（蓋不起來）→ 自動重跑</b>。那有客觀門檻（`fails` 非空），
///       機器判斷得出來，不必問人。</item>
/// <item><b>像不像 → 停下來給人看</b>。說明書第 7 節寫得很明白，沒有任何一條檢查
///       看得出像不像；讓模型自己看四視圖說「夠像了」只是讓它自我認證。
///       所以蓋得起來就收工回傳，要不要再一輪、以及要改哪裡，由使用者按鈕決定。</item>
/// </list>
///
/// <b>每一輪都是獨立的單輪呼叫，不累積對話歷史。</b> 一次呼叫裡放的就是
/// 「目標 ＋ 目前這份藍圖 ＋ 它的體檢報告 ＋ 四視圖 ＋ 使用者意見」——
/// 模型要改這一版需要的東西剛好就這些，把前面幾輪的來回都帶上只是讓 token 變貴、
/// 而且舊版的程式碼會干擾它（實際踩過的類型：它會把上一版已經修掉的東西改回來）。
///
/// <b>成本的形狀</b>（實測與官方計價，見 <see cref="GeminiOptions"/>）：一次呼叫裡
/// 說明書那兩萬多字是主體，圖片只佔一兩千個 token（Gemini 3 的圖片按 mediaResolution
/// 固定計價，跟像素無關）。所以省成本要省的是「呼叫次數」與「思考強度」，
/// 不是把圖縮小——而 systemInstruction 每輪逐字相同，隱式快取會自動打一折。
/// </summary>
public sealed class BlueprintGenerator(
    GeminiClient gemini,
    BlueprintValidator validator,
    BlueprintShooter shooter,
    BlueprintStore store,
    BlueprintHistory history,
    IOptions<GeminiOptions> options,
    ILogger<BlueprintGenerator> log)
{
    private readonly GeminiOptions _opt = options.Value;

    /// <summary>
    /// 這一次是在做什麼——只給產生紀錄用（<see cref="BlueprintHistory"/>）。
    /// 產出的程式在此之前只活在前端那個陣列裡，關掉分頁就沒了，所以每一份都要落地。
    /// </summary>
    /// <param name="RefImages">
    /// 這一次用的參考圖。整條鏈存一份進 <c>history/{目標}/_ref/</c>（hash 去重），
    /// 理由見 <see cref="BlueprintHistory.WriteRefsAsync"/>——沒有它，回頭只比得出
    /// 「產出跟它自己寫的註解像不像」，比不出「跟真正的目標像不像」。
    /// </param>
    /// <param name="FromStem">上一版是哪一筆（第一版沒有）。</param>
    private sealed record RunInfo(string Kind, string Description, string? Feedback, string? RefColors,
                                  IReadOnlyList<GeminiImage> RefImages, string? FromStem = null);

    /// <summary>
    /// 第一版：只有目標（描述／參考圖）。
    /// 會並行產 <c>Gemini:Candidates</c> 個候選讓使用者挑——同一個 prompt 不同 sample
    /// 的差距很大，挑一個好起點比在爛起點上迭代快得多。
    /// </summary>
    /// <param name="tune">使用者在產生器頁挑的旋鈕（模型／思考強度），見 <see cref="RunTune"/>。</param>
    public async Task<ProduceResult> GenerateAsync(
        string description, IReadOnlyList<GeminiImage> refImages, string? refColors,
        RunTune tune, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(description) && refImages.Count == 0)
            throw new ArgumentException("要給一段描述，或上傳一張參考圖（兩個都給最好）。");

        var goal = Goal(description, refImages.Count, refColors);
        var prompt = $"""
            請照上面的〈藍圖製作說明〉做一支藍圖。

            {goal}
            """;

        var sys = await BuildSystemPromptAsync(ct);
        var bag = new UsageBag();
        var n = Math.Max(1, _opt.Candidates);

        /* 候選之間完全獨立（單輪呼叫、不共用狀態），所以直接並行。
           四視圖那一段有自己的閘門（BlueprintShooter.Gate）擋著不會同時開太多 chromium。
           每個候選加一段不同的「取向」——溫度已經壓低了，差異要靠這個而不是亂數。 */
        var run = new RunInfo("generate", description, null, refColors, refImages);
        var cands = await Task.WhenAll(Enumerable.Range(1, n).Select(
            i => ProduceAsync(sys, prompt + Angle(i, n), refImages, goal, FirstTune(true, tune), i,
                              n > 1 ? $"候選 {i}" : "", run, bag, ct)));

        var best = Pick(cands);
        var extra = "";

        /* 自動打磨：只在「單候選」時做。產了好幾個候選的時候使用者本來就在挑，
           每個再打磨一輪只是把成本乘上候選數。
           這不是讓模型自我認證——它不判斷像不像、也不會提早收工，只是照客觀報告
           把「東西不在」那幾項修掉（窗戶沒畫上去、宣告了卻沒出現的顏色、飄著的碎塊…）。

           **觸發看的是 Important，不是 Warns 也不是 Fixable。** ⚠ 分三層（見
           BlueprintCheck.Important）：實測 28 支現有藍圖的 16 個 ⚠ 裡有 10 個是塊數偏差，
           而那一項的修法是調係數——係數的比例就是造型的長相，為了追塊數去改係數會讓它
           變得更不像；「宣告的顏色沒出現」則是普通等級，不值得為它單獨花一次呼叫。
           但真的跑了這一輪，整個 Fixable 都會一起請它修（錢都付了）。 */
        if (n == 1 && best.Ok && _opt.PolishRounds > 0 && best.Important.Length > 0)
        {
            log.LogInformation("自動打磨：{N} 項重要的（順手再修 {M} 項普通的，另有 {K} 項不修的），再叫一次",
                               best.Important.Length, best.Fixable.Length - best.Important.Length,
                               best.Warns.Length - best.Fixable.Length);
            var polished = await PolishAsync(sys, goal, refImages, best, run, bag, tune, ct);
            /* 「有沒有更好」先比重要的，同分才比普通的：只修掉普通那項、重要那項還在，
               不該算成功——不然它會用「把 pal 拿掉一色」換掉「窗戶沒畫上去」。 */
            var better = polished.Ok
                && (polished.Important.Length < best.Important.Length
                    || (polished.Important.Length == best.Important.Length
                        && polished.Fixable.Length < best.Fixable.Length));
            if (better)
            {
                extra = $"（自動打磨過一輪：重要的從 {best.Important.Length} 項降到 "
                      + $"{polished.Important.Length} 項。下面那一排可以切回打磨前那一份比一比）";
                // 兩份都留給人看：提醒變少不保證變好看，看得到前後才換得回去
                cands = [best with { Label = "打磨前" }, polished with { Label = "打磨後" }];
                best = cands[1];
            }
            else
            {
                // 打磨沒有變好就留原來那一版：多跑一輪不該讓結果變差
                extra = "（自動打磨過一輪但沒有更好，留原本那一版）";
                log.LogInformation("自動打磨沒有更好（ok={Ok} 重要的 {A}→{B}），留原本那一版",
                                   polished.Ok, best.Important.Length, polished.Important.Length);
            }
        }

        /* 自我對照擺在**最後**（打磨之後）：要對帳的是使用者真正會看到的那一份。
           只在單候選時做——清單只對得上一份藍圖，多候選時擺一份在旁邊會誤導
           （而且成本要乘候選數）。 */
        var diff = n == 1 ? await CompareCandidateAsync(description, refImages, best, tune, bag, ct) : null;

        return Result(best, cands, bag, extra, n > 1, diff);
    }

    /// <summary>
    /// 再改一版：帶著目前這份藍圖、它的體檢報告、四視圖，以及使用者的意見（可再附一張圖）。
    /// 這一條永遠只產一個版本——使用者已經有明確的意見了，這時要的是照著改，不是再擲三次骰子。
    /// </summary>
    public async Task<ProduceResult> ReviseAsync(
        string description, IReadOnlyList<GeminiImage> refImages, string? refColors,
        string currentCode, string? shotUrl,
        string feedback, GeminiImage? feedbackImage,
        RunTune tune, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(currentCode))
            throw new ArgumentException("沒有目前這一版的藍圖程式。");

        var goal = Goal(description, refImages.Count, refColors);

        // 報告當場重驗一次，不吃前端傳回來的：前端那份可能是上一版的，而報告要跟程式對得上
        var check = await validator.CheckAsync(currentCode, ct);

        /* 四視圖優先沿用前端指定的那張（已經拍過了，省 8 秒）；沒有或檔案不在才重拍。
           拍不出來也照樣往下走——那時模型看不到圖，但使用者的意見還在。 */
        var shot = await shooter.TryLoadAsync(shotUrl, ct)
                   ?? await shooter.TryShootAsync(check.Code ?? currentCode,
                                                  SafeName.Group(check.Name), $"{RunId()}-revise-in", ct);

        var (prompt, images) = RevisePrompt(
            goal, refImages, check.Code ?? currentCode, check.Report, shot,
            string.IsNullOrWhiteSpace(feedback)
                ? "（沒有寫，就照四視圖自己判斷哪裡不像、把它改得更像）"
                : feedback.Trim(),
            feedbackImage);

        var sys = await BuildSystemPromptAsync(ct);
        var bag = new UsageBag();
        // FromStem：四視圖與紀錄共用同一個 stem，所以前端傳回的那個網址就指得出上一版是哪一筆
        var run = new RunInfo("revise", description, feedback, refColors, refImages, FromShot(shotUrl));
        var c = await ProduceAsync(sys, prompt, images, goal, FirstTune(false, tune), 1, "", run, bag, ct);
        // 改完這一版照樣對一次帳：「這次到底改到了沒」正是使用者接著要判斷的事
        var diff = await CompareCandidateAsync(description, refImages, c, tune, bag, ct);
        return Result(c, [c], bag, "", false, diff);
    }

    /// <summary>
    /// 打磨一輪：拿體檢報告裡的 ⚠ 當「使用者意見」餵回去。走的是跟 revise 完全同一條路。
    /// </summary>
    private async Task<BpCandidate> PolishAsync(
        string sys, string goal, IReadOnlyList<GeminiImage> refImages, BpCandidate c, RunInfo run,
        UsageBag bag, RunTune tune, CancellationToken ct)
    {
        var shot = await shooter.TryLoadAsync(c.ShotUrl, ct);

        /* 分兩層列出來，讓它知道先後：整份 Warns 丟過去的話它會連「1600 塊偏差 11%」
           也一起修，而那一項的修法是調係數＝改造型的比例。這一輪的目的是把缺的東西
           補回來，不是為了一個數字去動長相。 */
        var minor = c.Fixable.Except(c.Important).ToArray();
        var ask = "體檢報告裡這幾項要修掉，**其餘一個字都不要動**：\n\n"
                + "### 一定要修\n· " + string.Join("\n· ", c.Important);
        if (minor.Length > 0)
            ask += "\n\n### 順手一起修（比較次要，但既然要改就一起）\n· " + string.Join("\n· ", minor);
        /* 以前這裡寫「塊數偏差那一類不用管」，但那句現在會跟清單打架：塊數偏差分兩種，
           「頂到 lo／hi」那一種已經被歸進 Fixable、會出現在上面的清單裡（見
           validate-bp.cjs 的分層），而它的修法不動比例。所以要講清楚是**係數**不能動，
           不是「塊數的事都不用管」。 */
        ask += "\n\n塊數的部分：**不要為了追塊數去調 `dim` 的係數**——"
             + "係數之間的比例就是這座造型的長相，動了它會變得更不像。"
             + "上面清單裡如果有塊數偏差，那是「s 已經頂到 `hi`／壓到 `lo`」那一種，"
             + "修法是調 `lo`／`hi`、或把各部件的**下限**（`dim` 第三個參數）改小，"
             + "那兩個都不會動到比例。清單裡沒有的塊數偏差就別管。";

        var (prompt, images) = RevisePrompt(goal, refImages, c.Code ?? "", c.Report, shot, ask, null);
        // 打磨走的是跟 revise 完全同一條路，思考強度也一樣（手上已經有能跑的藍圖 ＋ 明確的清單）
        return await ProduceAsync(sys, prompt, images, goal, FirstTune(false, tune), c.No + 1, "打磨後",
                                  run with { Kind = "polish", Feedback = ask, FromStem = c.Stem },
                                  bag, ct);
    }

    /// <summary>
    /// 對「剛跑完的那一份候選」做自我對照：讀回它的四視圖，再進 <see cref="CompareAsync"/>。
    /// 分出這一層是因為 <c>generate</c> 與 <c>revise</c> 兩條路都要做同一件事，
    /// 而「只跑對照」那支端點（<see cref="CompareOnlyAsync"/>）手上沒有 <see cref="BpCandidate"/>。
    /// </summary>
    private async Task<string?> CompareCandidateAsync(
        string description, IReadOnlyList<GeminiImage> refImages, BpCandidate c,
        RunTune tune, UsageBag bag, CancellationToken ct)
    {
        if (_opt.CompareRounds <= 0 || !c.Ok || string.IsNullOrWhiteSpace(c.Code)) return null;

        // 沒有四視圖就沒得對帳——這一輪比的就是「圖上看不看得到」
        var shot = await shooter.TryLoadAsync(c.ShotUrl, ct);
        if (shot is null) return null;

        return await CompareAsync(description, refImages, c.Code!, shot, c.Slots, c.Stem, tune, bag, ct);
    }

    /// <summary>
    /// **只跑自我對照**，不產生、不打磨、不存檔。給「已經有一份藍圖與它的四視圖，
    /// 想知道它哪裡不像」用——跟 <c>POST validate</c>（只體檢）、<c>POST shot</c>（只拍照）
    /// 同一類的單件工具。
    ///
    /// 從產生紀錄跑的時候**沒有參考圖**（那是使用者本機的檔案，紀錄裡沒存），
    /// 所以對的是「它自己寫下的設計」與「它自己畫出來的圖」。
    /// 那正是對帳的主軸，但少了參考圖就看不出「跟真正的目標像不像」——
    /// 要那一半就得從產生器頁把圖重新拖進來。
    /// </summary>
    public async Task<CompareOnly> CompareOnlyAsync(
        string code, string? shotUrl, string description, IReadOnlyList<GeminiImage> refImages,
        string? stem, RunTune tune, CancellationToken ct)
    {
        var check = await validator.CheckAsync(code, ct);
        if (!check.Ok)
            throw new ArgumentException("這份藍圖蓋不起來，沒有四視圖可以對帳。");

        // 四視圖優先沿用現成的那一張（省 8 秒），檔案不在才重拍
        var shot = await shooter.TryLoadAsync(shotUrl, ct)
                   ?? await shooter.TryShootAsync(check.Code ?? code, SafeName.Group(check.Name),
                                                  $"{RunId()}-compare-in", ct);
        if (shot is null)
            throw new InvalidOperationException("四視圖產不出來，沒有東西可以對帳。");

        var bag = new UsageBag();
        var diff = await CompareAsync(description, refImages, check.Code ?? code, shot,
                                      shot.Slots, stem, tune, bag, ct);
        return new CompareOnly(diff, shot.Url, check.Name, bag.Total(_opt));
    }

    /// <summary>
    /// 自我對照：拿這一版**開工時自己寫下的設計**（開頭那幾行註解）與參考圖，
    /// 逐條比對剛拍好的四視圖，列出「說好要有、圖上卻看不到」的地方。
    /// 定位與理由見 <see cref="GeminiOptions.CompareRounds"/>——
    /// <b>它不改程式、不判斷夠不夠像</b>，只產一份清單，送不送出由使用者按鈕決定。
    ///
    /// 三件事跟另外幾輪不一樣：
    /// <list type="bullet">
    /// <item><b>system prompt 不送〈藍圖製作說明〉。</b> 這一輪的工作是看兩張圖對帳，
    ///       用不到藍圖 DSL 的規格，而那兩萬多字全是「怎麼寫藍圖」的指令——對這一輪是雜訊
    ///       （而且實測快取一直沒命中，那是全價的一萬五千個 token）。</item>
    /// <item><b>明確禁止評顏色。</b> 四視圖的顏色會被場景光照（<c>engine.js</c> 的
    ///       <c>HemisphereLight</c> 地面色是草綠）與霧去飽和：實測 `pal` 宣告 `#fcda78` 亮黃，
    ///       圖上拍到的是 `#838b7a`（飽和度 95%→7%，見〈調校筆記〉）。
    ///       讓它照圖評色，等於叫它去改一份本來就正確的 `pal`。</item>
    /// <item><b>失敗不影響產生流程。</b> 藍圖這時已經產好、拍好、也記進紀錄了，
    ///       不能讓一個加分項把整輪打掉（跟 <c>TryShootAsync</c> 同一個原則）。</item>
    /// </list>
    /// </summary>
    private async Task<string?> CompareAsync(
        string description, IReadOnlyList<GeminiImage> refImages, string code, Shot shot,
        int? slots, string? stem, RunTune tune, UsageBag bag, CancellationToken ct)
    {
        /* **這一份 goal 刻意不帶 `refColors`**（傳 null）。產生輪的 goal 裡有
           「主體的顏色照這幾個來」那一整段，而這一輪的規則是「顏色完全不談」——
           兩段擺在同一則訊息裡就是互相矛盾的指令，比沒有指令更糟。 */
        var goal = Goal(description, refImages.Count, null);

        /* 圖片編號要**數圖不是數句子**：參考圖好幾張會擠在同一句裡（「第 1–3 張」），
           拿句子數當序號會讓四視圖那一句從第 2 張開始整個錯位。 */
        var which = new List<string>();
        if (refImages.Count == 1) which.Add("第 1 張是**參考圖**（目標長什麼樣）");
        else if (refImages.Count > 1)
            which.Add($"第 1–{refImages.Count} 張是**參考圖**"
                      + "（同一個目標的不同角度或細節，不是幾個不同的東西）");
        which.Add($"第 {refImages.Count + 1} 張是**這一版蓋出來的四視圖**"
                  + "（左上正面 −z、右上右側 +x、左下俯視、右下 45°；"
                  + $"{slots ?? _opt.ShotSlots} 塊那一檔）");

        var notes = HeadNotes(code);
        var prompt = $"""
            這一版已經蓋出來了。**這一輪不要改程式、也不要輸出程式**——只做一件事：對帳。

            {goal}

            附的圖：{string.Join("；", which)}。

            **四視圖的方向（弄反會報出假的差異，實測踩過）**：
            · ①正面格是站在藍圖**正前方**往回看的，所以**畫面左邊是 `+x`＝藍圖自己的右手邊**，
              畫面右邊才是 `-x`。講左右**一律用藍圖自己的左右**，不要照畫面的左右講——
              「招牌畫在右側（`+x`）」在①看起來就是在畫面左邊，**那是對的，不是缺陷**。
            · ②右側格是站在 `+x` 那一側往回看，所以畫面右邊是 `-z`＝正面那一側。
            · 左右判斷不確定就**不要報那一條**：報錯等於叫人去改一個本來就正確的東西。

            ## 這一版開工時自己寫下的設計

            {(notes.Length > 0
                ? notes
                : "（這一版沒有寫開頭註解，就拿上面的描述與參考圖當對帳的依據）")}

            ---
            拿上面那份設計{(refImages.Count > 0 ? "與參考圖" : "與上面那段描述")}，逐條比對四視圖，
            列出**說好要有、但圖上看不到或明顯不一樣**的地方。

            規則：

            · **不要評顏色。** 四視圖是在遊戲場景裡拍的，顏色會被光照與霧去飽和變暗
              （實測藍圖裡宣告 `#fcda78` 亮黃，拍出來是 `#838b7a` 灰綠）。
              **圖上的顏色不代表藍圖裡宣告的顏色**，拿它評色一定評錯——顏色這一輪完全不談。
            · 只講**形狀、比例、部件在不在、位置與朝向對不對**。
            · 每一條寫一行，格式：`· 東西：說好是什麼 → 圖上是什麼`
            · 對得上的不必列。真的都對得上就只回一行「都對得上」。
            · 最多 6 條，照**影響像不像的程度**由大到小排。
            · 直接給清單：不要前言、不要結論、不要解釋你怎麼判斷的。
            """;

        const string sys = """
            你在看一座 voxel（積木）模型的四視圖，工作是**對帳**：
            把「當初說要做的東西」跟「圖上實際看得到的東西」比一比，把對不上的地方列出來。

            你不改程式、不輸出程式，也不判斷「夠不夠像」——那是使用者的事。
            你只負責把差異指出來，讓使用者決定要不要拿去改。
            """;

        try
        {
            var images = new List<GeminiImage>(refImages) { shot.Ai };
            var reply = await gemini.GenerateAsync(
                sys, [new GeminiTurn(false, prompt, images)], ct,
                new GeminiTune(_opt.Temperature, _opt.CompareThinkingLevel, tune.Model));
            bag.Add(reply.Usage);

            var text = reply.Text.Trim();
            if (text.Length == 0) return null;

            log.LogInformation("自我對照：{Len} 字（思考 {Think}、{Th} token）",
                               text.Length, _opt.CompareThinkingLevel, reply.Usage.Thoughts);

            /* 補寫進那一筆產生紀錄。**這是「這一版哪裡不像」的唯一文字紀錄**——
               體檢報告講不出這件事，而清單不存的話只活在產生器那一頁的 JavaScript 裡，
               關掉分頁就沒了（那正是 BlueprintHistory 當初存在的理由）。 */
            if (stem is { Length: > 0 })
                await history.UpdateDiffAsync(stem, text, Bill(reply.Usage, 1), ct);
            return text;
        }
        /* 吞掉：藍圖這時已經產好、拍好、也寫進紀錄了。對帳是加分項，
           它掛掉不該讓使用者那一輪白跑。**取消例外不吞**（那是使用者按了停）。 */
        catch (Exception e) when (e is InvalidOperationException or HttpRequestException)
        {
            log.LogWarning(e, "自我對照那一輪失敗，略過（藍圖本身沒事）");
            return null;
        }
    }

    /// <summary>
    /// 抽出藍圖開頭那幾行註解（`// 檔名：` 下面的正面／側面／三樣識別物／部件清單）。
    /// 那是說明書第 5 節要模型開工前先寫下來的「這一版打算做什麼」，也是
    /// <b>唯一跨得過輪次的東西</b>——自我對照就是拿它當對帳的左欄。
    /// 取開頭連續的 `//` 行，碰到第一行非註解就停（再往下是程式了）；
    /// `// 檔名：` 那一行對帳用不到，跳過。
    /// </summary>
    /// <summary>
    /// 從開頭註解裡撈出「部件：…」那一行——說明書第 5 節要模型寫的**對帳單**。
    /// <see cref="RevisePrompt"/> 拿它當「這一輪不准弄丟的東西」的清單。
    /// 模型沒寫那一行時回 null（那時就不加那一段，不要憑空編一份清單給它對）。
    /// </summary>
    private static string? PartsLine(string code)
    {
        foreach (var line in HeadNotes(code).Split('\n'))
        {
            var t = line.TrimStart('/', ' ');
            if (t.StartsWith("部件")) return t;
        }
        return null;
    }

    private static string HeadNotes(string code)
    {
        var got = new List<string>();
        foreach (var line in code.Replace("\r\n", "\n").Split('\n'))
        {
            var t = line.Trim();
            if (t.Length == 0 && got.Count == 0) continue;      // 檔案開頭可能有空行
            if (!t.StartsWith("//")) break;
            if (t.Contains("檔名")) continue;
            got.Add(t);
        }
        return string.Join("\n", got);
    }

    /// <summary>
    /// 呼叫 → 體檢 → 蓋不起來就自動重跑（單輪，只帶壞掉那份與錯誤）→ 蓋起來就拍四視圖回傳。
    /// </summary>
    /// <param name="first">
    /// 第一輪的溫度與思考強度（見 <see cref="FirstTune"/>）。**由呼叫端決定**：
    /// 從零做一版跟照意見改一版不是同一件難度的事，思考強度也就不同。
    /// 重跑那幾輪不看它，一律走 <c>RepairThinkingLevel</c>。
    /// </param>
    private async Task<BpCandidate> ProduceAsync(
        string system, string prompt, IReadOnlyList<GeminiImage> images, string goal,
        GeminiTune first, int no, string label, RunInfo run, UsageBag bag, CancellationToken ct)
    {
        var names = await validator.ListNamesAsync(ct);
        var runId = RunId();
        var rounds = new List<AttemptRound>();
        var total = 1 + Math.Max(0, _opt.MaxRepairRounds);

        for (var i = 1; i <= total; i++)
        {
            /* 單輪：每次都是一則 user 訊息，不帶前幾輪的來回。
               修復輪的溫度與思考強度另外算——那一輪要的是照報告改對，不是創意，
               而思考要留著（漏參數正是它在修的東西，見 GeminiOptions.RepairThinkingLevel）。 */
            /* 重跑輪只換溫度與思考強度，**模型沿用 first.Model**：整條鏈換模型的話，
               那一份的帳單與產生紀錄會混到兩個模型的數字，之後分不出貴在哪。 */
            var tune = i == 1 ? first
                              : new GeminiTune(_opt.RepairTemperature, _opt.RepairThinkingLevel, first.Model);
            var reply = await gemini.GenerateAsync(system, [new GeminiTurn(false, prompt, images)], ct, tune);
            bag.Add(reply.Usage);
            /* bag 是整次操作的總帳（好幾個候選、打磨前後都加在一起）；
               bill 是**這一輪自己**的帳，要分開記才看得出那 3 輪裡哪一輪最貴。 */
            var bill = Bill(reply.Usage, 1);
            var think = tune.ThinkingLevel;
            var check = await validator.CheckAsync(reply.Text, ct);

            /* 撞名也算「蓋不起來」：importBlueprint 會自動加編號讓體檢過，但存出去的檔案裡
               那個 name 還是撞號的，遊戲載入時走真正的 customBlueprint —— 它直接擋掉，
               整份藍圖只留一行 console.warn 就消失（blueprints.js:4589）。 */
            var clash = !string.IsNullOrEmpty(check.RenamedFrom);

            if (check.Ok && !clash)
            {
                /* 四視圖與產生紀錄**共用同一個 stem**（shots/xxx.png ↔ history/xxx.js），
                   回頭要比對時圖跟程式才配得起來。 */
                /* 四視圖與產生紀錄**共用同一個目標資料夾與 stem**
                   （shots/{目標}/xxx.png ↔ history/{目標}/xxx.js），回頭比對時才配得起來。 */
                var group = SafeName.Group(check.Name);
                var stem = $"{runId}-{check.Name}-c{no}r{i}";
                var shot = await shooter.TryShootAsync(check.Code ?? "", group, stem, ct);
                rounds.Add(new AttemptRound(i, check.Code, check.Report, check.Fails, check.Warns,
                                            null, null, shot?.Url, bill, shot?.Slots));
                log.LogInformation("候選 {No} 第 {Round}/{Total} 輪：蓋得起來（提醒 {Warns} 項），四視圖={Shot}",
                                   no, i, total, check.Warns.Length, shot?.Url ?? "拍不出來");

                /* **整條鏈一起寫**（含前面失敗被重跑掉的那幾輪）。
                   分開寫不行：中間輪當下還不知道最後會叫什麼名字，寫不進正確的目標資料夾。
                   而失敗輪正是回頭要查的東西——實測「商業大樓」花了 NT$5 在兩次重跑上，
                   但那兩輪的程式與錯誤訊息當時沒存，沒人知道它錯在哪。 */
                await WriteChainAsync(group, runId, no, rounds, run, first.ThinkingLevel, first.Model,
                                      check.Name, check.File ?? (check.Name + ".js"), ct);

                var msg = i == 1 ? "蓋出來了" : $"第 {i} 輪蓋出來了（前 {i - 1} 輪體檢沒過，已自動重跑）";
                if (check.Warns.Length > 0) msg += $"，有 {check.Warns.Length} 項提醒";
                if (shot is null) msg += "。四視圖產不出來，只能看報告裡那三張字元輪廓圖";

                /* stem 帶回去給自我對照用：那一輪跑完要把清單補寫進這一筆紀錄。
                   跟四視圖共用的就是這個字串（shots/{群}/{stem}.png ↔ history/{群}/{stem}.json）。 */
                return new BpCandidate(no, label, true, check.Name, check.File ?? (check.Name + ".js"),
                                       check.Code, check.Report, check.Warns, check.Fixable,
                                       check.Important, shot?.Url, shot?.Slots, msg, rounds, stem);
            }

            rounds.Add(new AttemptRound(i, check.Code, check.Report, check.Fails, check.Warns,
                                        check.Error, check.RenamedFrom, null, bill));
            log.LogInformation("候選 {No} 第 {Round}/{Total} 輪：蓋不起來 stage={Stage} fails={Fails} 撞名={Clash}"
                             + "（思考 {Think}、{Th} token、估 US${Usd:0.0000}）",
                               no, i, total, check.Stage, check.Fails.Length, clash,
                               think, bill.Thoughts, bill.Usd);

            if (i == total) break;

            // 修復也是單輪：只給「壞掉那份 ＋ 錯在哪」，不帶前幾輪
            prompt = RepairPrompt(check, names, goal, reply.Text);
            images = [];                       // 修的是程式錯誤，圖幫不上忙，省 token
        }

        var last = rounds[^1];
        /* 一輪都沒成功：整條鏈照樣全部記下來，進 `_蓋不起來` 那一格。
           回頭要看「那次到底錯在哪」時，只剩這些程式與報告救得回來。 */
        await WriteChainAsync(SafeName.NoName, runId, no, rounds, run, first.ThinkingLevel, first.Model,
                              null, null, ct);

        return new BpCandidate(no, label, false, null, null, last.Code, last.Report, last.Warns, [], [], null, null,
            $"跑了 {rounds.Count} 輪都蓋不起來（體檢上限 {total} 輪）。" +
            "每一輪的報告都在下面，可以把描述寫具體一點再試，或直接改最後那版程式。",
            rounds);
    }

    /// <summary>
    /// 把一條產生鏈的**每一輪**寫成一筆紀錄，全部放進同一個目標資料夾。
    ///
    /// <b>為什麼中間輪也要存</b>：自動重跑的那幾輪以前一律丟掉，只留最後一份。
    /// 實測「商業大樓」那次 revise 跑了 3 輪、花掉 NT$6.2（其他四次加起來的兩倍），
    /// 而**沒有人知道它前兩輪錯在哪**——程式與錯誤訊息當下就沒了。
    /// 沒有這些，「修復輪值不值得開 high 思考」就沒辦法判斷。
    ///
    /// <b>為什麼整條一起寫、不是每輪寫完就存</b>：中間輪當下還不知道最後會叫什麼名字
    /// （名字要體檢過了才解得出來），寫不進正確的目標資料夾。
    /// </summary>
    private async Task WriteChainAsync(
        string group, string runId, int no, IReadOnlyList<AttemptRound> rounds,
        RunInfo run, string? think, string? model, string? name, string? file, CancellationToken ct)
    {
        /* 參考圖**整條鏈存一份**（內容 hash 去重），每一輪的紀錄各自記下用了哪幾張。
           存在這裡而不是每輪存：同一條鏈用的是同一批圖，而這裡剛好已經解出 group 了。 */
        var refs = await history.WriteRefsAsync(group, run.RefImages, ct);

        foreach (var r in rounds)
        {
            var ok = r.Fails.Length == 0 && r.Error is null && r.RenamedFrom is null;
            var tag = ok ? (name ?? "bp") : "蓋不起來";
            await history.WriteAsync(
                new HistoryHead($"{runId}-{tag}-c{no}r{r.Round}", DateTime.Now, run.Kind,
                                ok ? name : null, ok ? file : null, ok,
                                run.Description, run.Feedback, run.RefColors,
                                r.Warns, r.Fails, r.Slots, r.ShotUrl,
                                r.Usage, think, group, r.Round, rounds.Count,
                                r.RenamedFrom is { Length: > 0 }
                                    ? $"name「{r.RenamedFrom}」跟現有藍圖撞號"
                                    : r.Error,
                                model, FromStem: run.FromStem, Refs: refs.Length > 0 ? refs : null),
                r.Code, r.Report, ct);
        }
    }

    /* ── 組裝結果 ───────────────────────────────────────────── */

    /// <summary>挑一個當主角：先要蓋得起來，再取提醒最少的（提醒是客觀的，像不像不是）。</summary>
    private static BpCandidate Pick(BpCandidate[] cands)
    {
        var ok = cands.Where(c => c.Ok).OrderBy(c => c.Warns.Length).ThenBy(c => c.No).FirstOrDefault();
        return ok ?? cands[^1];
    }

    /// <param name="multi">
    /// 這一次真的是「並行產了好幾個候選」嗎。不能拿 <c>all.Count > 1</c> 判斷：
    /// 自動打磨也會留下兩份（打磨前／打磨後），那時說「產了 2 個候選」是騙人的。
    /// </param>
    /// <param name="diff">自我對照的清單（<see cref="CompareAsync"/>），沒做就是 null。</param>
    private ProduceResult Result(BpCandidate best, IReadOnlyList<BpCandidate> all, UsageBag bag,
                                 string extra, bool multi, string? diff = null)
    {
        var usage = bag.Total(_opt);
        var okCount = all.Count(c => c.Ok);
        var msg = best.Message;
        if (multi)
            msg = $"產了 {all.Count} 個候選，{okCount} 個蓋得起來。這是提醒最少的那個（{best.Message}）。" +
                  "下面那一排可以一張一張比，點了就換成那一版——" +
                  "哪個比較像只有你看得出來，機器排的是「提醒最少」，不是「最像」。";
        if (extra.Length > 0) msg += extra;

        log.LogInformation("這一次共 {Calls} 次呼叫：輸入 {In}（快取 {Cached}）、輸出 {Out}、思考 {Th}，估 US${Usd:0.0000}",
                           usage.Calls, usage.Prompt, usage.Cached, usage.Output, usage.Thoughts, usage.Usd);

        return new ProduceResult(best.Ok, best.Name, best.FileName, best.Code, best.Report,
                                 best.Warns, best.ShotUrl, msg, best.Rounds, all, best.No, usage, diff);
    }

    /* ── 旋鈕與帳單 ─────────────────────────────────────────── */

    /// <summary>
    /// 第一輪的溫度與思考強度。兩條路各有自己的一格
    /// （<see cref="GeminiOptions.ThinkingLevel"/>／<see cref="GeminiOptions.ReviseThinkingLevel"/>），
    /// 因為降下去的風險不一樣：第一版降過頭只是細節少，使用者看四視圖就看得出來；
    /// 改版降過頭可能**安靜地把上一版的部件簡化掉**，而那個沒有任何檢查抓得到。
    /// 兩格現在剛好都是 medium，但不要因此併成一個——理由見那兩個設定的註解。
    /// </summary>
    /// <param name="fromScratch">true＝從零做第一版；false＝照意見改（revise／自動打磨）</param>
    /// <param name="t">
    /// 使用者挑的旋鈕（已經過白名單）。每一格 null 就退回設定值，所以
    /// <see cref="RunTune.Default"/> ＝完全照設定跑，跟加這個功能之前一模一樣。
    /// </param>
    private GeminiTune FirstTune(bool fromScratch, RunTune t) =>
        new(_opt.Temperature,
            fromScratch ? (t.Think ?? _opt.ThinkingLevel) : (t.ReviseThink ?? _opt.ReviseThinkingLevel),
            t.Model);

    /// <summary>把一條鏈自己的用量包成帳單，寫進那一份的產生紀錄。</summary>
    private UsageTotals Bill(GeminiUsage u, int calls) =>
        new(calls, u.Prompt, u.Cached, u.Output, u.Thoughts, u.Usd(_opt));

    private sealed class UsageBag
    {
        private readonly object _lock = new();          // 候選是並行的，所以要鎖
        private GeminiUsage _sum = GeminiUsage.Zero;
        private int _calls;

        public void Add(GeminiUsage u)
        {
            lock (_lock) { _sum = _sum.Add(u); _calls++; }
        }

        public UsageTotals Total(GeminiOptions o)
        {
            lock (_lock)
                return new UsageTotals(_calls, _sum.Prompt, _sum.Cached, _sum.Output, _sum.Thoughts,
                                       _sum.Usd(o));
        }
    }

    /* ── prompt ─────────────────────────────────────────────── */

    private static string RunId() => DateTime.Now.ToString("MMdd-HHmmss");

    /// <summary>
    /// 從前端傳回的四視圖網址推出「上一版是哪一筆紀錄」。
    /// 靠的是 <c>shots/{目標}/{stem}.png</c> 與 <c>history/{目標}/{stem}.json</c>
    /// **共用同一個 stem**（<see cref="SafeName"/> 存在的唯一理由），所以不必另外傳一格回來。
    /// 手改程式碼丟進來、或載回的版本沒有圖時是 null——那時本來就沒有上一版可以指。
    /// </summary>
    private static string? FromShot(string? shotUrl)
    {
        if (string.IsNullOrWhiteSpace(shotUrl)) return null;
        var stem = SafeName.Stem(Path.GetFileNameWithoutExtension(shotUrl.Replace('\\', '/')));
        return string.IsNullOrEmpty(stem) ? null : stem;
    }

    /* 候選的「取向」：同一個目標，三種不同的側重。
       為什麼不靠溫度：溫度高換來的不是不同的構想，是漏參數與算錯座標（產藍圖是
       「照規格產出必須跑得起來的程式」，不是寫文案）。所以溫度壓到 0.2，
       差異改用**明講的取向**做出來——拿到的是三個真的不同的做法，
       而不是同一個做法擲三次骰子，而且三張圖擺在一起比才有意義。

       三段都是說明書自己已經講過的事，只是把重心挪一挪，不會跟規格打架：
       第 1 個不加話（照說明書的判斷做），第 2 個往部件數壓，第 3 個往輪廓比例壓。 */
    private static readonly string[] Angles =
    [
        "",
        """

        ## 這一版的取向

        **部件數往上堆。** 說明書第 5 節寫著「像不像幾乎全靠部件數」——寧可多做幾件小東西
        （線腳、開口、頂飾、附件、表面紋理），也不要為了省行數把部件合併掉。
        六層清單的每一層都至少挑兩件做。
        """,
        """

        ## 這一版的取向

        **先把整體輪廓與比例做對。** 開頭那三句話（正面輪廓／側面輪廓）與各部位的長短、
        粗細比例是這一版的重點：人物與動物先定頭身比，器物先定高寬比。
        細節等比例站得住了再放，不要為了塞細節把比例犧牲掉。
        """
    ];

    /// <summary>第 <paramref name="i"/> 個候選（1 起算）的取向。只有一個候選時不加。</summary>
    private static string Angle(int i, int n) => n <= 1 ? "" : Angles[(i - 1) % Angles.Length];

    /// <param name="refColors">
    /// 參考圖的主色（前端在縮圖那一趟順手量出來的 hex 清單，見 <c>topColors()</c>）。
    /// 為什麼要：說明書第 5 節只叫模型「抓圖片的 4–6 個主色」，沒有任何東西驗證它抓對——
    /// 實測產出裡皮卡丘的黃變成橄欖黃、樹懶變成水泥灰。量好了直接給，比叫它用眼睛估準。
    ///
    /// <b>但這句話曾經寫得太死。</b>原本是「<c>pal</c> 就從這幾個色挑，不要自己憑印象調」，
    /// 而 <c>topColors()</c> 是照**面積**數的——面積小卻一眼認得出來的顏色（屋瓦、招牌、
    /// 蝴蝶結）量不到。中正紀念堂那一筆量到 8 個灰（真正的藍屋瓦一個都沒進榜），
    /// 模型被這句綁住，蓋出整棟灰的紀念堂，註解還寫著「金色寶頂」。
    /// 所以現在講明「主體照它、小面積的識別色自己補」。
    /// </param>
    /// <param name="refCount">
    /// 參考圖有幾張。**多張是常態，不是例外**：說明書第 5 節第一句就要模型講出
    /// 「正面看是什麼形狀、側面看是什麼形狀」，只給一張正面照的話側面是它編的
    /// （實測「亞洲商業中心」只給一張正面照，側牆與背牆蓋出來是一整片空白）。
    /// 所以要講明那幾張是**同一個目標的不同角度**——不講的話它會當成三個不同的東西。
    /// </param>
    private static string Goal(string description, int refCount, string? refColors) => $"""
        ## 要做的東西

        {(string.IsNullOrWhiteSpace(description)
            ? "（沒有文字描述，看附的參考圖）"
            : description.Trim())}
        {(refCount switch
        {
            0 => "",
            1 => "\n（另外附了一張參考圖）",
            _ => $"\n（另外附了 {refCount} 張參考圖，**都是同一個目標**——不同角度或不同細節，"
                 + "不是幾個不同的東西。哪一張是正面、哪一張是側面自己從圖上判斷。）"
        })}
        {(string.IsNullOrWhiteSpace(refColors)
            ? ""
            : $"\n參考圖量出來的主色（照**面積**由多到少）：{refColors.Trim()}\n"
              + "**主體的顏色照這幾個來**，不要憑印象調成別的色系——量出來的才是圖上真正的顏色。\n"
              + "但這只量得到面積大的那幾塊。**面積小、卻一眼認得出它的顏色**"
              + "（屋瓦、招牌、蝴蝶結、門、眼睛、標誌）量不到，"
              + "**圖上看得到就自己加進 `pal`**——那幾格正是「認得出來」的關鍵。"
              + "量出來整批都是同一個色系（例如全是灰階）時更要這樣做。")}
        """;

    /// <summary>
    /// 「照意見再改一版」的 prompt。revise 與自動打磨共用，差別只在 feedback 那一段是誰寫的。
    /// </summary>
    private (string Prompt, List<GeminiImage> Images) RevisePrompt(
        string goal, IReadOnlyList<GeminiImage> refImages, string code, string? report, Shot? shot,
        string feedback, GeminiImage? feedbackImage)
    {
        var images = new List<GeminiImage>();
        images.AddRange(refImages);                              // 目標長什麼樣（可能好幾張）
        if (shot is not null) images.Add(shot.Ai);               // 這一版蓋出來長什麼樣
        if (feedbackImage is not null) images.Add(feedbackImage); // 使用者補的圖

        var which = new List<string>();
        if (refImages.Count == 1) which.Add("第 1 張是**參考圖**（目標長什麼樣）");
        else if (refImages.Count > 1)
            which.Add($"第 1–{refImages.Count} 張是**參考圖**"
                      + "（同一個目標的不同角度或細節，不是幾個不同的東西）");
        /* 編號要數「圖」不是數「句子」：參考圖可能好幾張擠在同一句裡（第 1–3 張），
           拿 which.Count 當序號會從第 2 張開始全部錯位。 */
        var at = refImages.Count;
        // Slots 是拍照當下量到的實際塊數；沿用舊圖（TryLoadAsync）時沒有，就講要求的那一檔
        if (shot is not null) which.Add($"第 {++at} 張是**目前這一版的四視圖**"
                                        + "（左上正面 −z、右上右側 +x、左下俯視、右下 45°；"
                                        + $"{shot.Slots ?? _opt.ShotSlots} 塊那一檔）");
        if (feedbackImage is not null) which.Add($"第 {++at} 張是**使用者這次補的圖**");

        /* 上一版的部件清單＝這一輪**不准弄丟的東西**。
           實測四組 revise（公司大樓、雙子塔、大坂城、雙層巴士）**每一組都改壞了沒被要求改的地方**，
           而且送 2 條跟送 6 條一樣壞——所以瓶頸不是意見太多，是「每輪重吐整份 8 KB 藍圖」時
           沒有任何東西在守舊的部件。〈開發必讀〉早就寫著「沒有任何一條檢查抓得到它把東西拿掉了」。
           說明書第 5 節要求寫的那行「部件：…」剛好就是現成的對帳單，拉出來明講。 */
        var keep = PartsLine(code) is not { } parts ? "" :
            "\n\n## 上一版做了哪些部件\n\n" + parts +
            "\n\n**除了上面那幾條要改的，這張清單上的每一項都必須還在。**\n" +
            "實測踩過四次：改某一個地方的時候，**沒被提到的部件會安靜地消失或變形**——" +
            "整排側窗變成只剩車尾一段、屋頂平白多一圈簷口、裙樓從過高變成扁平貼地、" +
            "下層面寬無故縮窄。\n" +
            "輸出之前拿這張清單逐項對一次：每一項在新的程式裡都還找得到嗎？";

        var prompt = $"""
            這一版蓋出來了，但使用者看過之後要你再改一版。

            {goal}

            {(which.Count > 0 ? "附的圖：" + string.Join("；", which) + "。\n" : "")}
            ## 使用者的意見（這是這一輪最重要的依據）

            {feedback}

            ## 目前這一版的藍圖

            ```js
            {code}
            ```

            ## 它的體檢報告

            {report ?? "（沒有報告）"}
            {keep}

            ---
            照使用者的意見改，輸出**改好的完整藍圖**（一個 ```js 區塊，第一行 `// 檔名：xxx.js`）。
            不要只給改動的片段或 diff。使用者沒提到的地方不要順手改掉。
            開頭那幾行註解（三句話與部件清單）跟著這一版更新。
            """;
        return (prompt, images);
    }

    /// <summary>
    /// system instruction ＝〈藍圖製作說明〉全文 ＋ 後端模式補充。
    /// **每一輪逐字相同**，隱式快取才命中得到（命中的部分打一折，這是最大的省法）。
    /// 唯一會變的是現有藍圖的名單，而那要存了新藍圖才變。
    /// </summary>
    private async Task<string> BuildSystemPromptAsync(CancellationToken ct)
    {
        var names = await validator.ListNamesAsync(ct);
        var doc = await store.ReadPromptDocAsync(ct);
        return doc + "\n\n" + $"""
        ────────────────────────────────────────────────────────
        # 這次呼叫的執行環境（與上面說明書衝突時，以這一段為準）

        你的輸出由程式直接讀取、直接跑體檢與四視圖，中間沒有玩家轉手。所以：

        1. **只輸出一個 ```js 區塊**，第一行是 `// 檔名：xxx.js`。
           **區塊外面一個字都不要寫**——說明書第 0 節叫你在區塊外寫給玩家看的安裝提醒，
           這裡不需要（程式只取那個區塊，其餘會被丟掉）。
        2. 不要叫玩家開 `藍圖預覽.html`、不要叫玩家複製報告或存圖回來、不要問玩家問題、
           不要解釋你改了什麼。那幾步伺服器自己做，而說明由使用者看圖自己判斷。
        3. **每次都輸出整份藍圖**，不要只給改動的片段或 diff——程式沒有辦法把片段拼回原本那份。
        4. `name` **不能**跟現有藍圖撞號。撞號會被 `customBlueprint` 擋掉，整份藍圖靜靜消失。
           改版時**沿用同一個 name**（那是同一座建築的新版本，不要每一版換一個名字）。
           目前已經用掉的名字（{names.Length} 個）：
           {string.Join("、", names)}
        5. 每一次呼叫都是**獨立的**：你不會看到前幾輪的來回。要改的那一份藍圖、它的體檢報告、
           四視圖、使用者的意見，全都寫在這一則訊息裡——照那些做就夠了。
        6. **說明書第 5 節那幾行開頭註解（正面／側面／三樣識別物／部件清單）一定要寫**，
           就寫在 `// 檔名：` 下面。**那是唯一會傳到下一輪的東西**（程式碼會，你的說明不會），
           下一輪的你要靠它知道這一版原本打算做什麼，不然會愈改愈偏。
        7. 四視圖是用**{_opt.ShotSlots} 塊**那一檔拍的（遊戲面板最大那一檔），所以細節要撐得住
           那個尺寸：那一檔刻得出招牌、窗框、五官，別只照三千塊的粒度設計。
        """;
    }

    /// <summary>蓋不起來時的自動重跑。單輪，所以壞掉那份程式要整份放進 prompt。</summary>
    private static string RepairPrompt(BlueprintCheck check, string[] names, string goal, string raw)
    {
        var code = check.Code ?? raw;

        if (!string.IsNullOrEmpty(check.Error))
            return $"""
                你上一版的藍圖**載不進來**：

                {check.Error}

                {goal}

                ## 載不進來的那一份

                ```js
                {code}
                ```

                ---
                修好它，輸出完整的藍圖（一個 ```js 區塊，第一行 `// 檔名：xxx.js`）。
                """;

        if (!string.IsNullOrEmpty(check.RenamedFrom))
            return $"""
                `name`「{check.RenamedFrom}」**跟現有藍圖撞號**了，會被 `customBlueprint` 擋掉、
                整份藍圖靜靜消失。換一個沒被用掉的名字。

                已經用掉的名字：{string.Join("、", names)}

                {goal}

                ## 要改名的那一份

                ```js
                {code}
                ```

                ---
                只改 `name`（連同第一行的 `// 檔名：`），其餘不要動，輸出完整的藍圖。
                """;

        return $"""
            你上一版的藍圖**體檢沒過**，蓋不起來。

            {goal}

            ## 沒過的那一份

            ```js
            {code}
            ```

            ## 體檢報告（`✘` 那幾行就是必修，後面「修法」那行是要改的方向）

            {check.Report}

            ---
            照報告把必修的都修掉，輸出完整的藍圖（一個 ```js 區塊，第一行 `// 檔名：xxx.js`）。
            """;
    }
}
