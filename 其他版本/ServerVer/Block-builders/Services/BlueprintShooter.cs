using System.Text;
using Microsoft.Extensions.Options;

namespace Block_builders.Services;

/// <summary>tools/shot-bp.cjs 的輸出。</summary>
public sealed class ShotOutput
{
    public bool Ok { get; set; }
    public string Stage { get; set; } = "";
    public string? Png { get; set; }
    public long Bytes { get; set; }

    /// <summary>給 AI 的縮圖路徑（縮過的 JPEG）。縮不出來是 null，那就退回用原圖。</summary>
    public string? Ai { get; set; }

    public long AiBytes { get; set; }
    public int AiPx { get; set; }
    public string? Suggested { get; set; }
    public string? Name { get; set; }
    public int? Slots { get; set; }
    public int Want { get; set; }
    public string? TierNote { get; set; }
    public string? Note { get; set; }
    public string? Error { get; set; }
    public string[] PageErrors { get; set; } = [];
}

/// <summary>
/// 四視圖：正面（−z）／右側（+x）／俯視／45° 四格拼起來。
/// 一份圖有兩個版本——<b>原圖給人看、縮圖給 AI</b>。
/// </summary>
/// <param name="Url">原圖（1024×1024 PNG）的相對網址，前端顯示與下載用</param>
/// <param name="Ai">要送進 Gemini 的那一份（同尺寸的 JPEG；轉不出來時就是原圖）</param>
public sealed record Shot(string Url, string FullPath, GeminiImage Ai, int? Slots);

/// <summary>
/// 產四視圖。做法是用無頭 chromium 開真正的 <c>藍圖預覽.html</c>、貼上藍圖、
/// 按它自己那顆「下載四視圖」，把下載接下來——所以拿到的圖跟玩家手動按出來的
/// 逐像素同一張（同一份 three.js、同一組取景參數、同樣的角標）。
///
/// 這件事非做不可的理由：體檢報告只講得出塊數與結構，講不出「像不像」。
/// 報告裡那三張字元輪廓圖是降採樣的黑白剪影，顏色、材質、哪一塊接著哪一塊全看不出來。
/// </summary>
public sealed class BlueprintShooter(
    NodeRunner node, IWebHostEnvironment env, IOptions<GeminiOptions> options, ILogger<BlueprintShooter> log)
{
    // 要開 chromium、載 three.js、蓋一座建築再算四張圖，比體檢慢得多
    private static readonly TimeSpan Timeout = TimeSpan.FromMinutes(5);

    /* 同時最多開兩個 chromium。一次產多個候選（Gemini:Candidates）時，那幾條路是並行的，
       不擋的話會同時開三、四個瀏覽器各自用軟體算 WebGL——記憶體與 CPU 都會打結，
       每一張反而更慢。拍一張約 8 秒，排隊比搶資源划算。 */
    private static readonly SemaphoreSlim Gate = new(2, 2);

    private readonly GeminiOptions _opt = options.Value;

    /// <summary>四視圖存放處。放在 wwwroot 底下，這樣產生器那一頁可以直接把圖顯示出來。</summary>
    public string Dir => Path.Combine(env.WebRootPath, "shots");

    /// <summary>
    /// 產一張四視圖。失敗回 null（四視圖是加分項，拍不出來不該讓整條產生流程掛掉）。
    /// </summary>
    /// <param name="group">
    /// 目標資料夾（<see cref="SafeName.Group"/>）。**跟產生紀錄用同一個**，
    /// 所以 <c>shots/{group}/</c> 與 <c>history/{group}/</c> 裡是同一座建築的東西——
    /// 以前兩邊都是一大包平的檔案，跑了十幾次之後找不到哪張配哪份程式。
    /// </param>
    public async Task<Shot?> TryShootAsync(string code, string group, string fileStem, CancellationToken ct)
    {
        var tmp = Path.Combine(Path.GetTempPath(), $"bp-shot-{Guid.NewGuid():N}.js");
        var rel = SafeName.Group(group) + "/" + SafeName.Stem(fileStem);
        var dest = Path.Combine(Dir, SafeName.Group(group), SafeName.Stem(fileStem) + ".png");
        await Gate.WaitAsync(ct);
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(dest)!);
            await File.WriteAllTextAsync(tmp, code, new UTF8Encoding(false), ct);

            var r = await node.RunJsonAsync<ShotOutput>("shot-bp.cjs",
                [tmp, dest, _opt.ShotSlots.ToString(),
                 _opt.ImageMaxPx.ToString(), _opt.ImageQuality.ToString("0.00")], Timeout, ct);
            if (!r.Ok || r.Png is null || !File.Exists(r.Png))
            {
                log.LogWarning("四視圖產不出來（stage={Stage}）：{Error}｜{PageErrors}",
                               r.Stage, r.Error, string.Join(" / ", r.PageErrors));
                return null;
            }
            if (r.PageErrors.Length > 0)
                log.LogWarning("四視圖有雜訊：{PageErrors}", string.Join(" / ", r.PageErrors));

            // 送給 AI 的用轉好的 JPEG；轉不出來就退回原圖（上傳慢一點，token 一樣）
            var ai = await ReadAiCopyAsync(r.Ai, r.Png, ct);
            log.LogInformation(
                "四視圖 {File}：{Slots} 塊（要求 {Want}）、原圖 {Png} KB、送出 {Ai} KB（{Px}px {Mime}、{Res}）",
                Path.GetFileName(r.Png), r.Slots, r.Want, r.Bytes / 1024,
                ai.Bytes.Length / 1024, r.AiPx, ai.MimeType, ai.MediaResolution ?? "API 預設");

            return new Shot("shots/" + rel + ".png", r.Png, ai, r.Slots);
        }
        catch (InvalidOperationException e)
        {
            // playwright 不在、chromium 掛了、逾時——都不該讓產生流程整個失敗
            log.LogWarning(e, "四視圖產不出來");
            return null;
        }
        finally
        {
            Gate.Release();
            try { File.Delete(tmp); } catch (IOException) { /* 在系統暫存區 */ }
        }
    }

    /// <summary>
    /// 讀一張已經拍過的四視圖（前端把上一輪的 <c>shotUrl</c> 傳回來時用，省下重拍的 8 秒）。
    /// 路徑是前端給的，所以只取**最後兩段**（`{目標}/{檔名}.png`）、拆開各自清洗，
    /// 而且要求解出來的絕對路徑真的落在 shots/ 裡——不然就是目錄穿越。
    /// 舊的紀錄沒有目標那一層（平的 `shots/xxx.png`），所以也試一次只有檔名的路徑。
    /// 讀不到回 null，呼叫端自己決定要不要重拍。
    /// </summary>
    public async Task<Shot?> TryLoadAsync(string? url, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(url)) return null;
        try
        {
            var parts = url.Replace('\\', '/').Split('/', StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length == 0) return null;
            var name = SafeName.Stem(parts[^1]);
            if (!name.EndsWith(".png", StringComparison.OrdinalIgnoreCase)) return null;

            // 新版有目標那一層、舊版沒有，兩個都試
            var tries = new List<string> { name };
            if (parts.Length >= 2 && !parts[^2].Equals("shots", StringComparison.OrdinalIgnoreCase))
                tries.Insert(0, Path.Combine(SafeName.Stem(parts[^2]), name));

            var root = Path.GetFullPath(Dir) + Path.DirectorySeparatorChar;
            foreach (var rel in tries)
            {
                var full = Path.GetFullPath(Path.Combine(Dir, rel));
                if (!full.StartsWith(root, StringComparison.OrdinalIgnoreCase)) continue;
                if (!File.Exists(full)) continue;

                // 送 AI 的一律用旁邊那份 JPEG（拍照時一起產的），沒有才退回原圖
                var ai = full[..^4] + "-ai.jpg";
                return new Shot("shots/" + rel.Replace('\\', '/'), full,
                                await ReadAiCopyAsync(File.Exists(ai) ? ai : null, full, ct), null);
            }
            return null;
        }
        catch (IOException e)
        {
            log.LogWarning(e, "讀不動四視圖 {Url}", url);
            return null;
        }
    }

    /// <summary>
    /// 優先讀那份 JPEG，讀不到就退回原圖 PNG（一樣的畫面、一樣的 token，只是大一點）。
    /// mediaResolution 一律照設定給——這張是判斷「像不像」的依據，不省這裡。
    /// </summary>
    private async Task<GeminiImage> ReadAiCopyAsync(string? aiPath, string pngPath, CancellationToken ct)
    {
        if (aiPath is not null && File.Exists(aiPath))
            return new GeminiImage(await File.ReadAllBytesAsync(aiPath, ct), "image/jpeg",
                                   _opt.ShotMediaResolution);
        return new GeminiImage(await File.ReadAllBytesAsync(pngPath, ct), "image/png",
                               _opt.ShotMediaResolution);
    }

}
