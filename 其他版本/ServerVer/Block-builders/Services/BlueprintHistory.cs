using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Block_builders.Services;

/// <summary>
/// 一筆產生紀錄的「表頭」——清單頁要的東西，不含程式與報告全文（那兩個很長）。
/// </summary>
/// <param name="Stem">檔名主幹，同時也是四視圖的檔名（<c>shots/{Stem}.png</c>）</param>
/// <param name="Kind">generate／revise／polish</param>
/// <param name="Usage">
/// <b>這一份產出自己的帳單</b>（只算它那一條鏈的呼叫，不含同一次操作裡別的候選、
/// 也不含打磨前的那一份——那兩者各自有自己的紀錄）。
/// 在此之前 token 數只寫進 console log 與畫面上那一行，關掉就沒了，
/// 「思考到底佔多少」變成查不到的事；記下來之後每一筆產出都自己帶帳單。
/// 舊紀錄沒有這一格，所以是 null。
/// </param>
/// <param name="Think">
/// 第一輪用的思考強度（<c>high</c>／<c>medium</c>／<c>low</c>）。
/// <b>沒有它 <paramref name="Usage"/> 就沒辦法互相比</b>——調過設定之後，
/// 兩筆數字不同到底是題目不同還是旋鈕不同會分不出來。
/// 重跑那幾輪走的是 <c>RepairThinkingLevel</c>，所以 <c>Usage.Calls &gt; 1</c> 時
/// 這個等級只代表第一輪。舊紀錄沒有這一格，所以是 null。
/// </param>
/// <param name="Group">
/// 同一個目標的資料夾（<see cref="SafeName.Group"/>）。<c>history/{Group}/</c> 與
/// <c>shots/{Group}/</c> 是同一座建築的東西。舊紀錄沒有這一格。
/// </param>
/// <param name="Round">這是那一條產生鏈的第幾輪（1 起算）。</param>
/// <param name="Rounds">那一條鏈總共跑了幾輪。<c>Round &lt; Rounds</c> ＝ 這是失敗被重跑掉的中間輪。</param>
/// <param name="Error">載不進來時的錯誤訊息（體檢連跑都跑不起來那種）。</param>
/// <param name="Model">
/// 這一條鏈用的模型。理由跟 <paramref name="Think"/> 一模一樣：模型可以在產生器頁上挑，
/// <b>不記下來的話 <paramref name="Usage"/> 又沒辦法互相比了</b>——兩筆數字差很多到底是
/// 題目不同、旋鈕不同還是**模型不同**會分不出來。整條鏈（含重跑、打磨）共用同一個，
/// 所以一筆紀錄只會有一個值。舊紀錄沒有這一格，所以是 null。
/// </param>
public sealed record HistoryHead(
    string Stem,
    DateTime At,
    string Kind,
    string? Name,
    string? FileName,
    bool Ok,
    string Description,
    string? Feedback,
    string? RefColors,
    string[] Warns,
    string[] Fails,
    int? Slots,
    string? ShotUrl,
    UsageTotals? Usage = null,
    string? Think = null,
    string? Group = null,
    int Round = 1,
    int Rounds = 1,
    string? Error = null,
    string? Model = null,
    /// <summary>
    /// 自我對照那一輪列出來的差異清單（<see cref="GeminiOptions.CompareRounds"/>）。
    /// <b>它是「這一版哪裡不像」的唯一文字紀錄</b>——體檢報告從頭到尾講不出這件事。
    /// 由 <see cref="BlueprintHistory.UpdateDiffAsync"/> 事後補寫（那一輪比紀錄晚跑，見那支的註解）。
    /// 舊紀錄、以及沒做對照的那幾筆沒有這一格，所以是 null。
    /// </summary>
    string? Diff = null,
    /// <summary>
    /// 自我對照**那一次呼叫自己**的帳單。跟 <paramref name="Usage"/> 分開記：
    /// 那一格是產生那一輪的，對照輪的 token 原本只併進整次操作的總帳、回給前端顯示就沒了，
    /// 事後就答不出「對照輪到底多貴」「<c>CompareThinkingLevel</c> 降到 low 能省多少」。
    /// </summary>
    UsageTotals? CompareUsage = null,
    /// <summary>
    /// 這一版是從哪一筆改出來的（上一版的 <c>Stem</c>）。
    /// 沒有它就只能靠時間順序與名字猜同一條線上的前後版，改了什麼比不出來。
    /// 第一版、以及手改程式碼丟進來的那些沒有上一版，所以是 null。
    /// </summary>
    string? FromStem = null,
    /// <summary>
    /// 這一版用了哪幾張參考圖（<c>history/{目標}/_ref/</c> 底下的檔名，見
    /// <see cref="BlueprintHistory.WriteRefsAsync"/>）。
    /// 一個目標可能跑很多版、各版用的圖不一定一樣，所以要逐版記。
    /// </summary>
    string[]? Refs = null);

/// <summary>表頭 ＋ 程式 ＋ 報告全文。</summary>
public sealed record HistoryRecord(HistoryHead Head, string? Code, string? Report);

/// <summary>
/// 產生紀錄。<b>每一份產出（含蓋不起來的）都自動存一份</b>，因為在此之前
/// 藍圖程式只活在產生器那一頁的 JavaScript 陣列裡——**關掉分頁就沒了**，
/// 只有四視圖 PNG 留在 <c>wwwroot/shots/</c>（圖還在、程式不見了）。
/// 實際踩過：使用者跑出「中頭獎的樹懶」兩版，回頭想比對時只剩兩張圖。
///
/// 一份紀錄兩個檔，檔名主幹跟四視圖**完全一樣**（靠 <see cref="SafeName"/> 保證）：
/// <list type="bullet">
/// <item><c>history/{stem}.js</c>   藍圖程式原文。直接可以丟進 <c>blueprints/</c>
///       或貼進預覽頁——所以這個檔本身就是備份，不必透過這支服務才讀得回來。</item>
/// <item><c>history/{stem}.json</c> 其餘（描述、意見、體檢報告、提醒、塊數、四視圖網址）</item>
/// </list>
/// 放在專案根目錄底下而**不是** wwwroot：這些是工作紀錄，不需要被當靜態檔送出去。
/// 會累積（一份約 10–30 KB），要清就直接刪那個資料夾。
/// </summary>
public sealed class BlueprintHistory(IWebHostEnvironment env, ILogger<BlueprintHistory> log)
{
    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        WriteIndented = true,
        // 中文不要被轉成 \uXXXX：這些檔案是要給人直接打開看的
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping
    };

    private static readonly UTF8Encoding Utf8NoBom = new(false);

    public string Dir => Path.Combine(env.ContentRootPath, "history");

    /// <summary>
    /// 存一筆。<b>存不進去不能影響產生流程</b>——紀錄是加分項，
    /// 磁碟滿了、檔名怪了都不該讓使用者那一輪白跑，所以吞掉例外只寫 log。
    /// </summary>
    public async Task WriteAsync(HistoryHead head, string? code, string? report, CancellationToken ct)
    {
        try
        {
            var group = SafeName.Group(head.Group ?? head.Name);
            var dir = Path.Combine(Dir, group);
            Directory.CreateDirectory(dir);
            var stem = SafeName.Stem(head.Stem);
            if (!string.IsNullOrEmpty(code))
                await File.WriteAllTextAsync(Path.Combine(dir, stem + ".js"), code, Utf8NoBom, ct);
            await File.WriteAllTextAsync(Path.Combine(dir, stem + ".json"),
                JsonSerializer.Serialize(new HistoryRecord(head with { Group = group }, null, report), Json),
                Utf8NoBom, ct);
            log.LogInformation("紀錄 {Group}/{Stem}（{Kind}、第 {R}/{N} 輪、{Ok}）",
                               group, stem, head.Kind, head.Round, head.Rounds,
                               head.Ok ? "蓋得起來" : "蓋不起來");
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            log.LogWarning(e, "產生紀錄存不進去 {Stem}", head.Stem);
        }
    }

    /// <summary>
    /// 最近的幾筆，新的在前。讀不動的檔案直接跳過（不要讓一個壞檔擋住整張清單）。
    /// 掃目標資料夾**與**根目錄——根目錄那些是分資料夾之前留下的舊紀錄。
    /// </summary>
    public async Task<IReadOnlyList<HistoryHead>> ListAsync(int limit, CancellationToken ct)
    {
        if (!Directory.Exists(Dir)) return [];

        var files = new DirectoryInfo(Dir)
            .EnumerateFiles("*.json", SearchOption.AllDirectories)
            .OrderByDescending(f => f.LastWriteTimeUtc)
            .Take(Math.Clamp(limit, 1, 500));

        var list = new List<HistoryHead>();
        foreach (var f in files)
        {
            var r = await ReadJsonAsync(f.FullName, ct);
            if (r is not null) list.Add(r.Head);
        }
        return list;
    }

    /// <summary>
    /// 讀一筆完整紀錄（含程式與報告）。
    /// <paramref name="stem"/> 是前端傳回來的，所以只取最後一段檔名、
    /// 而且要求解出來的絕對路徑真的落在 history/ 裡——不然就是目錄穿越。
    /// </summary>
    public async Task<HistoryRecord?> ReadAsync(string stem, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(stem)) return null;

        var jsonPath = FindJson(stem);
        if (jsonPath is null) return null;

        var rec = await ReadJsonAsync(jsonPath, ct);
        if (rec is null) return null;

        var jsPath = jsonPath[..^5] + ".js";      // 去掉 ".json" 換 ".js"
        var code = File.Exists(jsPath) ? await File.ReadAllTextAsync(jsPath, ct) : null;
        return rec with { Code = code };
    }

    /// <summary>
    /// 把自我對照的清單補寫進已經存好的那一筆。
    ///
    /// <b>為什麼是事後補寫、不是一開始就一起寫</b>：自我對照是整條鏈都跑完
    /// （含自動重跑、自動打磨）之後才做的一輪，而紀錄必須在那之前就落地——
    /// 等對照跑完再一起寫的話，對照那一輪掛掉就連藍圖都沒存到，
    /// 那正是 <see cref="WriteAsync"/> 吞例外在防的事。
    ///
    /// <b>為什麼要存</b>：那份清單是「這一版哪裡不像」的唯一文字紀錄——體檢報告從頭到尾
    /// 講不出這件事。不存的話它只活在產生器那一頁的 JavaScript 裡，關掉分頁就沒了，
    /// 跟這支服務當初存在的理由一模一樣（見類別註解）。
    /// 一樣吞掉 IO 例外：補不進去不該影響任何東西。
    /// </summary>
    /// <param name="usage">對照**那一次呼叫自己**的帳單，見 <see cref="HistoryHead.CompareUsage"/>。</param>
    public async Task UpdateDiffAsync(string stem, string diff, UsageTotals? usage, CancellationToken ct)
    {
        try
        {
            var path = FindJson(stem);
            if (path is null) { log.LogWarning("要補對照清單，但找不到紀錄 {Stem}", stem); return; }

            var rec = await ReadJsonAsync(path, ct);
            if (rec is null) return;

            await File.WriteAllTextAsync(path,
                JsonSerializer.Serialize(
                    rec with { Head = rec.Head with { Diff = diff, CompareUsage = usage } }, Json),
                Utf8NoBom, ct);
            log.LogInformation("對照清單寫進紀錄 {Stem}（{Len} 字）", stem, diff.Length);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            log.LogWarning(e, "對照清單補不進紀錄 {Stem}", stem);
        }
    }

    /// <summary>
    /// 把這一次用的參考圖存進 <c>history/{目標}/_ref/</c>，回傳存成什麼檔名。
    ///
    /// <b>用內容的 SHA-256 當檔名，所以同一張圖只會存一份</b>——同一個目標會跑很多版
    /// （第一版、好幾輪改版、打磨），用的通常是同一批圖，逐版各存一份會白白膨脹十倍。
    ///
    /// <b>為什麼要存</b>：沒有它，回頭只比得出「產出跟它自己寫的那幾行註解像不像」，
    /// **比不出「跟真正的目標像不像」**——而後者才是使用者的標準，也是這整條流程在追的東西。
    /// 圖是使用者本機的檔案，這等於複製一份進專案，所以只放 <c>history/</c> 底下、
    /// 不進 wwwroot（不會被當靜態檔送出去）。要清就跟紀錄一起刪。
    ///
    /// 存不進去一樣只寫 log：跟 <see cref="WriteAsync"/> 同一個原則，
    /// 磁碟滿了不該讓使用者那一輪白跑。
    /// </summary>
    public async Task<string[]> WriteRefsAsync(
        string group, IReadOnlyList<GeminiImage> images, CancellationToken ct)
    {
        if (images.Count == 0) return [];

        var names = new List<string>();
        try
        {
            var dir = Path.Combine(Dir, SafeName.Group(group), "_ref");
            Directory.CreateDirectory(dir);
            foreach (var img in images)
            {
                var hash = Convert.ToHexString(SHA256.HashData(img.Bytes))[..16].ToLowerInvariant();
                var name = hash + ExtOf(img.MimeType);
                var path = Path.Combine(dir, name);
                if (!File.Exists(path)) await File.WriteAllBytesAsync(path, img.Bytes, ct);
                names.Add(name);                       // 真的寫進去了才記，不然清單會指到不存在的檔
            }
            log.LogInformation("參考圖 {N} 張存進 {Group}/_ref/", names.Count, group);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            log.LogWarning(e, "參考圖存不進去 {Group}", group);
        }
        return names.ToArray();
    }

    /// <summary>副檔名照**檔頭認出來的** mime 給（那是 Controller 嗅過的，不是客戶端宣告的）。</summary>
    private static string ExtOf(string mime) => mime switch
    {
        "image/png" => ".png",
        "image/jpeg" => ".jpg",
        "image/webp" => ".webp",
        "image/heic" => ".heic",
        "image/heif" => ".heif",
        _ => ".bin"
    };

    /// <summary>
    /// 從 <paramref name="stem"/> 找出那一筆的 json 路徑。
    ///
    /// <paramref name="stem"/> 可能是**前端傳回來的**，所以只取最後一段檔名、
    /// 而且是拿它去比對**自己列出來的檔案**，不是拼接前端給的字串當路徑——
    /// 目錄穿越從源頭就不成立。stem 本身是全域唯一的
    /// （`{時分秒}-{名字}-c{候選}r{輪}`），所以也不必信任前端給的目標資料夾。
    /// </summary>
    private string? FindJson(string stem)
    {
        if (string.IsNullOrWhiteSpace(stem)) return null;

        var name = SafeName.Stem(Path.GetFileNameWithoutExtension(stem.Replace('\\', '/')));
        if (string.IsNullOrEmpty(name) || !Directory.Exists(Dir)) return null;

        var want = name + ".json";
        return new DirectoryInfo(Dir)
            .EnumerateFiles("*.json", SearchOption.AllDirectories)
            .FirstOrDefault(f => f.Name.Equals(want, StringComparison.OrdinalIgnoreCase))?.FullName;
    }

    private async Task<HistoryRecord?> ReadJsonAsync(string path, CancellationToken ct)
    {
        try
        {
            var text = await File.ReadAllTextAsync(path, ct);
            return JsonSerializer.Deserialize<HistoryRecord>(text, Json);
        }
        catch (Exception e) when (e is IOException or JsonException)
        {
            log.LogWarning(e, "紀錄讀不動 {Path}", path);
            return null;
        }
    }
}
