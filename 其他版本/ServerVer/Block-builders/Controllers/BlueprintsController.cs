using Block_builders.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace Block_builders.Controllers;

/// <summary>
/// 藍圖 API。遊戲本體（wwwroot 的 index.html／藍圖預覽.html）完全沒動，
/// 這一層只做原本要人工轉手的那幾件事：呼叫 Gemini、跑體檢、存檔、維護 list.js。
/// </summary>
[ApiController]
[Route("api/blueprints")]
public sealed class BlueprintsController(
    BlueprintGenerator generator,
    BlueprintValidator validator,
    BlueprintShooter shooter,
    BlueprintStore store,
    BlueprintHistory history,
    GeminiClient gemini,
    IOptions<GeminiOptions> options,
    ILogger<BlueprintsController> log) : ControllerBase
{
    /// <summary>單張圖片上限。Gemini 吃的是 base64 inlineData，太大的圖沒必要也拖慢。</summary>
    private const long MaxImageBytes = 8 * 1024 * 1024;

    /// <summary>
    /// 參考圖最多幾張。**一張不夠**：說明書第 5 節開宗明義要模型講出「正面看是什麼形狀、
    /// 側面看是什麼形狀」，只給一張正面照的話側面是它自己編的——實測「亞洲商業中心」
    /// 只給一張正面照，蓋出來的側牆與背牆是一整片空白，帷幕玻璃只畫在正面那一面。
    ///
    /// 上限 4 的理由是成本可忽略但要有個底：一張 HIGH ＝ 1,120 個 token（約 US$0.0008），
    /// 四張加起來還不到一次呼叫的 4%。設上限只是不要讓人一次拖 20 張進來。
    /// </summary>
    private const int MaxRefImages = 4;

    private readonly GeminiOptions _opt = options.Value;

    /// <summary>現在 blueprints/ 裡有哪些藍圖，以及環境有沒有備齊。</summary>
    [HttpGet]
    public async Task<IActionResult> List(CancellationToken ct)
    {
        var files = store.ListFiles();
        string[] names = [];
        string? envError = null;
        try
        {
            names = await validator.ListNamesAsync(ct);
        }
        catch (InvalidOperationException e)
        {
            envError = e.Message;      // Node 沒裝／驗證器不在，先讓前端講得出原因
        }

        return Ok(new
        {
            files,
            names,
            hasApiKey = gemini.HasApiKey,
            apiKeyFile = gemini.ApiKeyFilePath,
            model = gemini.Model,
            /* 產生器頁那個下拉要列什麼。**白名單**（見 GeminiOptions.Models）——
               模型名字會被插進呼叫網址的路徑，所以不收前端的自由字串，
               能挑的就這幾個，要加就去 appsettings 加一行。 */
            models = _opt.AllowedModels(),
            /* 思考那兩個下拉的選項。**只有第一版與改版兩格能挑**——自動重跑那一輪
               （RepairThinkingLevel）是這兩格降下去之後的保單，不放上頁面，見 GeminiOptions。 */
            thinkingLevels = _opt.AllowedThinkingLevels(),
            // 這幾個前端要拿來把「這一次會做什麼、大概多貴」講清楚
            candidates = Math.Max(1, _opt.Candidates),
            shotSlots = _opt.ShotSlots,
            thinkingLevel = _opt.ThinkingLevel,
            // 第一版與「再改一版」思考強度不同（見 GeminiOptions.ReviseThinkingLevel），兩個都要講
            reviseThinkingLevel = _opt.ReviseThinkingLevel,
            envError
        });
    }

    /// <summary>
    /// 第一版：描述（＋可選參考圖）→ Gemini → 體檢 →
    /// **蓋不起來就自動重跑**，蓋起來就拍四視圖回傳給人看。
    /// 不存檔——要不要收下是使用者看過四視圖才決定的事（走 <c>POST save</c>）。
    /// </summary>
    [HttpPost("generate")]
    [RequestSizeLimit(MaxImageBytes * (MaxRefImages + 1) + 1024 * 1024)]
    public async Task<IActionResult> Generate(
        [FromForm] string? description,
        [FromForm] string? refColors,   // 前端縮圖那一趟順手量出來的主色，見 BlueprintGenerator.Goal
        [FromForm] List<IFormFile>? image,   // 同一個 image 欄位可以重複給，見 MaxRefImages
        [FromForm] string? model,            // 產生器頁挑的模型，一定要過白名單
        [FromForm] string? think,            // 第一版那一輪的思考強度
        [FromForm] string? reviseThink,      // 自動打磨那一輪的（這一條也可能用到）
        CancellationToken ct = default)
    {
        var (refImgs, bad) = await ReadImagesAsync(image, ct);
        if (bad is not null) return bad;

        return await RunAsync(() => generator.GenerateAsync(
            description ?? "", refImgs, refColors, Tune(model, think, reviseThink), ct));
    }

    /// <summary>
    /// 再改一版：帶著目前的藍圖、它的體檢報告、四視圖與使用者的意見（可再附一張圖）跑下一輪。
    /// 一樣是蓋不起來就自動重跑、蓋起來就回傳給人看。
    /// </summary>
    [HttpPost("revise")]
    [RequestSizeLimit(MaxImageBytes * (MaxRefImages + 2) + 1024 * 1024)]
    public async Task<IActionResult> Revise(
        [FromForm] string? description,
        [FromForm] string? refColors,
        [FromForm] string? code,
        [FromForm] string? shotUrl,
        [FromForm] string? feedback,
        [FromForm] List<IFormFile>? image,   // 原本的參考圖（前端每次全部一起送，模型才知道目標）
        IFormFile? feedbackImage,            // 這一輪使用者補的圖
        [FromForm] string? model,            // 這一輪要用哪個模型（可以跟上一輪不同）
        [FromForm] string? reviseThink,      // 這一輪的思考強度
        CancellationToken ct = default)
    {
        var (refImgs, bad1) = await ReadImagesAsync(image, ct);
        if (bad1 is not null) return bad1;
        var (fbImg, bad2) = await ReadImageAsync(feedbackImage, ct);
        if (bad2 is not null) return bad2;

        return await RunAsync(() =>
            generator.ReviseAsync(description ?? "", refImgs, refColors, code ?? "", shotUrl,
                                  feedback ?? "", fbImg, Tune(model, null, reviseThink), ct));
    }

    /// <summary>
    /// 把表單上那幾格旋鈕過一次白名單再交給產生器。
    /// <b>對不上一律靜靜退回設定值，不回 400</b>：清單是後端給前端的，對不上代表設定改過
    /// 而那一頁還是舊的，那是設定沒同步、不是使用者做錯事——為它中斷一次要跑好幾分鐘的產生
    /// 不划算，而實際用了哪一格會寫進產生紀錄，事後查得到。
    /// </summary>
    private RunTune Tune(string? model, string? think, string? reviseThink) => new(
        _opt.ResolveModel(model),
        _opt.ResolveThink(think, _opt.ThinkingLevel),
        _opt.ResolveThink(reviseThink, _opt.ReviseThinkingLevel));

    private async Task<IActionResult> RunAsync(Func<Task<ProduceResult>> run)
    {
        try
        {
            return Ok(await run());
        }
        catch (ArgumentException e)
        {
            return BadRequest(new { error = e.Message });
        }
        catch (InvalidOperationException e)
        {
            // 金鑰沒設、模型名稱不對、Node 沒裝、被模型擋掉——都是講得出原因的狀況
            log.LogWarning(e, "產生藍圖失敗");
            return StatusCode(StatusCodes.Status502BadGateway, new { error = e.Message });
        }
    }

    /// <summary>
    /// 讀一批參考圖。**超過上限直接擋，不要靜靜砍掉**——使用者會以為四張都送出去了，
    /// 然後納悶模型為什麼沒看到側面那張。
    /// </summary>
    private async Task<(List<GeminiImage>, IActionResult?)> ReadImagesAsync(
        List<IFormFile>? files, CancellationToken ct)
    {
        var list = new List<GeminiImage>();
        var real = files?.Where(f => f is { Length: > 0 }).ToList() ?? [];
        if (real.Count > MaxRefImages)
            return (list, BadRequest(new { error = $"參考圖最多 {MaxRefImages} 張（給了 {real.Count} 張）。" }));

        foreach (var f in real)
        {
            var (img, bad) = await ReadImageAsync(f, ct);
            if (bad is not null) return (list, bad);
            if (img is not null) list.Add(img);
        }
        return (list, null);
    }

    /// <summary>讀一張上傳的圖並認格式。回傳 (圖, 錯誤回應)，兩個都是 null＝沒給圖。</summary>
    private async Task<(GeminiImage?, IActionResult?)> ReadImageAsync(IFormFile? file, CancellationToken ct)
    {
        if (file is not { Length: > 0 }) return (null, null);

        if (file.Length > MaxImageBytes)
            return (null, BadRequest(new { error = $"圖片太大（上限 {MaxImageBytes / 1024 / 1024} MB）。" }));

        using var ms = new MemoryStream();
        await file.CopyToAsync(ms, ct);
        var bytes = ms.ToArray();

        /* 格式看檔頭，不看 Content-Type：那個由客戶端自己宣告，實測用 PowerShell 送
           真的 .png 也只給 application/octet-stream。而 Gemini 的 inlineData 要的是
           對的 mimeType，宣告錯了就是送一張它讀不出來的圖。 */
        var mime = SniffImageMime(bytes);
        if (mime is null)
            return (null, BadRequest(new
            {
                error = $"認不出這是什麼圖片（檔名 {file.FileName}、宣告的型別 {file.ContentType}）。" +
                        "可用：PNG／JPEG／WebP／HEIC。"
            }));

        /* mediaResolution 決定這張圖要花幾個 token（跟像素無關，見 GeminiOptions）。
           使用者上傳的圖給 HIGH＝API 預設值；四視圖另外由 BlueprintShooter 給 ULTRA_HIGH。 */
        return (new GeminiImage(bytes, mime, _opt.ImageMediaResolution), null);
    }

    /// <summary>
    /// 產生紀錄：每一份產出（含蓋不起來的）都自動存了一份，這裡列出最近的幾筆。
    /// 存在的理由很直接——在此之前藍圖程式只活在產生器那一頁的記憶體裡，**關掉分頁就沒了**，
    /// 只有四視圖 PNG 留著（圖還在、程式不見了）。
    /// </summary>
    [HttpGet("history")]
    public async Task<IActionResult> History([FromQuery] int limit, CancellationToken ct)
        => Ok(new { items = await history.ListAsync(limit <= 0 ? 60 : limit, ct) });

    /// <summary>讀一筆完整紀錄（程式 ＋ 體檢報告），前端用來把那一版載回工作區。</summary>
    [HttpGet("history/{stem}")]
    public async Task<IActionResult> HistoryOne(string stem, CancellationToken ct)
    {
        var r = await history.ReadAsync(stem, ct);
        return r is null ? NotFound(new { error = "找不到這一筆紀錄。" }) : Ok(r);
    }

    /// <summary>只驗不存。手動貼一段程式進來看體檢結果用（等同預覽頁的「檢查藍圖」）。</summary>
    [HttpPost("validate")]
    public async Task<IActionResult> Validate([FromBody] CodeRequest body, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(body.Code)) return BadRequest(new { error = "沒有程式碼。" });
        try
        {
            return Ok(await validator.CheckAsync(body.Code, ct));
        }
        catch (InvalidOperationException e)
        {
            return StatusCode(StatusCodes.Status500InternalServerError, new { error = e.Message });
        }
    }

    /// <summary>
    /// 只產四視圖，不呼叫 Gemini。給「已經有一份藍圖，想看它長什麼樣」用；
    /// 圖存進 <c>wwwroot/shots/</c>，回傳的相對網址直接就能看。
    /// </summary>
    [HttpPost("shot")]
    public async Task<IActionResult> ShotOnly([FromBody] CodeRequest body, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(body.Code)) return BadRequest(new { error = "沒有程式碼。" });
        try
        {
            // 先驗一次：蓋不起來的藍圖拍不出圖，而且驗過才有乾淨的程式與名字可用
            var check = await validator.CheckAsync(body.Code, ct);
            if (!string.IsNullOrEmpty(check.Error))
                return BadRequest(new { error = check.Error });
            if (!check.Ok)
                return BadRequest(new { error = "這份藍圖有必修，蓋不起來就拍不出四視圖。", check.Fails, check.Report });

            var stem = $"{DateTime.Now:MMdd-HHmmss}-{check.Name}";
            var shot = await shooter.TryShootAsync(check.Code ?? "", SafeName.Group(check.Name), stem, ct);
            if (shot is null)
                return StatusCode(StatusCodes.Status500InternalServerError,
                    new { error = "四視圖產不出來（多半是 playwright／chromium 的問題，看伺服器 log）。" });

            return Ok(new { shotUrl = shot.Url, name = check.Name, shot.Slots, check.Warns });
        }
        catch (InvalidOperationException e)
        {
            return StatusCode(StatusCodes.Status500InternalServerError, new { error = e.Message });
        }
    }

    /// <summary>
    /// **只跑自我對照**，不產生、不打磨、不存檔。拿一份現成的藍圖與它的四視圖，
    /// 問「當初說好要有的東西，圖上看不看得到」——跟 <see cref="Validate"/>（只體檢）、
    /// <see cref="ShotOnly"/>（只拍照）同一類的單件工具。
    ///
    /// <b>兩種來源</b>：給 <c>stem</c> 就從產生紀錄讀那一筆（程式、四視圖、描述都在裡面，
    /// 而且清單會補寫回那一筆）；否則吃 <c>code</c>／<c>shotUrl</c>／<c>description</c>。
    ///
    /// <b>兩種都沒有參考圖</b>——紀錄裡沒存（那是使用者本機的檔案），這一支也不收上傳。
    /// 所以它對的是「它自己寫下的設計」與「它自己畫出來的圖」：
    /// 那正是對帳的主軸（識別物在不在、部件漏了沒），但看不出「跟真正的目標像不像」。
    /// </summary>
    [HttpPost("compare")]
    public async Task<IActionResult> Compare([FromBody] CompareRequest body, CancellationToken ct)
    {
        var code = body.Code;
        var shotUrl = body.ShotUrl;
        var desc = body.Description ?? "";

        if (!string.IsNullOrWhiteSpace(body.Stem))
        {
            var rec = await history.ReadAsync(body.Stem, ct);
            if (rec is null) return NotFound(new { error = "找不到這一筆紀錄。" });
            code = rec.Code;
            shotUrl = rec.Head.ShotUrl;
            desc = rec.Head.Description;
        }

        if (string.IsNullOrWhiteSpace(code))
            return BadRequest(new { error = "沒有藍圖程式（給 stem，或直接給 code）。" });

        try
        {
            /* 只有模型那一格開放：對照輪的思考強度走 Gemini:CompareThinkingLevel，
               跟自動重跑那一輪同樣不放給呼叫端挑（它是每次都會付的固定成本，
               要動就去改設定，而實際用了哪一格會寫進紀錄）。 */
            return Ok(await generator.CompareOnlyAsync(code, shotUrl, desc, [], body.Stem,
                                                       new RunTune(_opt.ResolveModel(body.Model)), ct));
        }
        catch (ArgumentException e)
        {
            return BadRequest(new { error = e.Message });
        }
        catch (InvalidOperationException e)
        {
            log.LogWarning(e, "只跑對照失敗");
            return StatusCode(StatusCodes.Status502BadGateway, new { error = e.Message });
        }
    }

    /// <summary>
    /// 存檔（含沒過關的）。體檢沒過也讓存——說明書裡有幾種「不是錯」的狀況
    /// （例如「這座最小就是這麼大」），而要不要收下是玩家的判斷。
    /// </summary>
    [HttpPost("save")]
    public async Task<IActionResult> Save([FromBody] CodeRequest body, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(body.Code)) return BadRequest(new { error = "沒有程式碼。" });
        try
        {
            // 先過一次驗證：要拿它剝好圍籬的乾淨程式與檔名，順手也把撞名擋在存檔之前
            var check = await validator.CheckAsync(body.Code, ct);
            if (!string.IsNullOrEmpty(check.Error))
                return BadRequest(new { error = check.Error });
            if (!string.IsNullOrEmpty(check.RenamedFrom))
                return BadRequest(new
                {
                    error = $"name「{check.RenamedFrom}」跟現有藍圖撞號，存進去遊戲載入時會被擋掉。" +
                            "把程式裡的 name 改一個沒用過的再存。"
                });

            var file = await store.SaveAsync(body.FileName ?? check.File ?? (check.Name + ".js"), check.Code ?? "", ct);
            return Ok(new { saved = true, fileName = file, name = check.Name, check.Fails, check.Warns });
        }
        catch (InvalidOperationException e)
        {
            return StatusCode(StatusCodes.Status500InternalServerError, new { error = e.Message });
        }
    }

    /// <summary>
    /// 從檔頭認圖片格式，認不出來就回 null。只認 Gemini 讀得懂的那幾種。
    /// </summary>
    private static string? SniffImageMime(byte[] b)
    {
        if (b.Length >= 8 && b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47 &&
            b[4] == 0x0D && b[5] == 0x0A && b[6] == 0x1A && b[7] == 0x0A)
            return "image/png";

        if (b.Length >= 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF)
            return "image/jpeg";

        // RIFF....WEBP
        if (b.Length >= 12 && Ascii(b, 0, "RIFF") && Ascii(b, 8, "WEBP"))
            return "image/webp";

        // ISO-BMFF：....ftyp<brand>，HEIC／HEIF 共用這個殼
        if (b.Length >= 12 && Ascii(b, 4, "ftyp"))
        {
            var brand = System.Text.Encoding.ASCII.GetString(b, 8, 4).ToLowerInvariant();
            if (brand is "heic" or "heix" or "hevc" or "hevx") return "image/heic";
            if (brand is "mif1" or "msf1" or "heif") return "image/heif";
        }

        return null;
    }

    private static bool Ascii(byte[] b, int at, string tag)
    {
        for (var i = 0; i < tag.Length; i++)
            if (b[at + i] != (byte)tag[i]) return false;
        return true;
    }

    public sealed record CodeRequest(string Code, string? FileName);

    /// <summary>
    /// 「只跑對照」的輸入。給 <c>Stem</c> ＝ 從產生紀錄跑那一筆（其餘三格不必給）；
    /// 否則至少要給 <c>Code</c>。<c>Model</c> 要過白名單，對不上就退回設定值。
    /// </summary>
    public sealed record CompareRequest(string? Stem, string? Code, string? ShotUrl,
                                        string? Description, string? Model);
}
