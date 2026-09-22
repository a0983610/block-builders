using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;

namespace Block_builders.Services;

/// <summary>
/// 一張要一起送出去的圖（參考圖、四視圖）。
/// </summary>
/// <param name="MediaResolution">
/// 這一張的 <c>mediaResolution</c>（<c>MEDIA_RESOLUTION_LOW</c>／<c>MEDIUM</c>／<c>HIGH</c>／
/// <c>ULTRA_HIGH</c>）。**圖片的 token 由這個值固定決定**（280／560／1120／2240），
/// 跟像素與檔案大小無關，所以「縮圖省 token」對 Gemini 3 是不成立的。
/// null／空＝不送這個欄位，照 API 預設（等於 HIGH）。
/// </param>
public sealed record GeminiImage(byte[] Bytes, string MimeType, string? MediaResolution = null);

/// <summary>對話裡的一則訊息。修復迴圈靠「把前幾輪原封不動帶回去」保住上下文。</summary>
/// <param name="FromModel">true＝這是模型上一輪的回答（Gemini 的 role 是 model）</param>
public sealed record GeminiTurn(bool FromModel, string Text, IReadOnlyList<GeminiImage>? Images = null);

/// <summary>這一次呼叫要用的溫度與思考強度。null＝照設定檔的預設值。</summary>
/// <param name="Model">
/// 這一次要用哪個模型。null＝照設定的 <c>Gemini:Model</c>。
/// <b>整條產生鏈（第一版、自動重跑、自動打磨）要用同一個</b>，不然那一份的帳單與
/// 產生紀錄會混到兩個模型的數字，之後就分不出「這次比較貴」是題目還是模型造成的。
/// 值一定是 <see cref="GeminiOptions.ResolveModel"/> 挑過的白名單項目。
/// </param>
public sealed record GeminiTune(
    double? Temperature = null, string? ThinkingLevel = null, string? Model = null);

/// <summary>
/// 一次呼叫用掉多少 token。<paramref name="Cached"/> 是 <paramref name="Prompt"/> 裡
/// 命中隱式快取的那一部分（不是額外的），打一折計價。
/// <paramref name="Thoughts"/> 是思考用掉的，**按輸出計價**。
/// </summary>
public sealed record GeminiUsage(int Prompt, int Cached, int Output, int Thoughts)
{
    public static readonly GeminiUsage Zero = new(0, 0, 0, 0);

    public GeminiUsage Add(GeminiUsage o) =>
        new(Prompt + o.Prompt, Cached + o.Cached, Output + o.Output, Thoughts + o.Thoughts);

    /// <summary>照設定裡的單價估一個美金金額。估算而已，帳單以 Google 為準。</summary>
    public double Usd(GeminiOptions o)
    {
        var fresh = Math.Max(0, Prompt - Cached);
        return (fresh * o.InputPricePerMTok
                + Cached * o.CachedInputPricePerMTok
                + (Output + Thoughts) * o.OutputPricePerMTok) / 1_000_000d;
    }
}

/// <summary>模型回的文字，加上這一次的 token 用量。</summary>
public sealed record GeminiReply(string Text, GeminiUsage Usage);

/// <summary>Gemini generateContent 的薄封裝。只做「送多輪對話、拿回文字」這一件事。</summary>
public sealed class GeminiClient(
    HttpClient http, IOptions<GeminiOptions> options, IWebHostEnvironment env, ILogger<GeminiClient> log)
{
    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    private readonly GeminiOptions _opt = options.Value;

    public string Model => _opt.Model;

    /// <summary>金鑰檔的完整路徑，講給使用者聽的時候要用。</summary>
    public string ApiKeyFilePath => Path.Combine(env.ContentRootPath, _opt.ApiKeyFile);

    public bool HasApiKey => !string.IsNullOrWhiteSpace(ResolveApiKey());

    /// <summary>
    /// 設定值優先，沒有才讀金鑰檔。每次呼叫都重讀檔案——檔案很小，
    /// 換來的是「貼上金鑰存檔就生效，不必重啟站台」。
    /// </summary>
    private string ResolveApiKey()
    {
        if (!string.IsNullOrWhiteSpace(_opt.ApiKey)) return _opt.ApiKey.Trim();

        var path = ApiKeyFilePath;
        if (!File.Exists(path)) return "";
        try
        {
            foreach (var line in File.ReadLines(path))
            {
                var t = line.Trim();
                if (t.Length == 0 || t.StartsWith('#')) continue;   // 讓金鑰檔裡能留說明
                return t;
            }
        }
        catch (IOException e)
        {
            log.LogWarning(e, "讀不動金鑰檔 {Path}", path);
        }
        return "";
    }

    public async Task<GeminiReply> GenerateAsync(
        string systemInstruction, IReadOnlyList<GeminiTurn> turns, CancellationToken ct,
        GeminiTune? tune = null)
    {
        var apiKey = ResolveApiKey();
        if (string.IsNullOrWhiteSpace(apiKey))
            throw new InvalidOperationException(
                $"還沒設 Gemini API 金鑰。把金鑰貼進這個檔案存起來就好（不必重啟）：{ApiKeyFilePath}" +
                "。金鑰去 https://aistudio.google.com/apikey 拿。");

        var think = tune?.ThinkingLevel ?? _opt.ThinkingLevel;
        /* 再過一次白名單。呼叫端（Controller）已經挑過了，這裡是第二道：
           模型名字下面會被插進網址路徑，而「插進網址的字串一定出自白名單」這件事
           要在最靠近網址的地方保證，才不會哪天多一條呼叫路徑就漏掉。 */
        var model = _opt.ResolveModel(tune?.Model);
        var body = new Request
        {
            /* systemInstruction 每一輪都一樣，而隱式快取（2.5 以後預設開著）就是靠
               前綴逐字相同來命中，命中的部分打一折。所以這一段要**穩定**：
               不要把時間、亂數、每次不同的敘述塞進來（現有藍圖名單會變，但很少變）。 */
            SystemInstruction = new Content { Parts = [new Part { Text = systemInstruction }] },
            GenerationConfig = new GenerationConfig
            {
                Temperature = tune?.Temperature ?? _opt.Temperature,
                MaxOutputTokens = _opt.MaxOutputTokens,
                ThinkingConfig = string.IsNullOrWhiteSpace(think)
                    ? null
                    : new ThinkingConfig { ThinkingLevel = think.Trim() }
            }
        };
        foreach (var t in turns)
        {
            var parts = new List<Part> { new() { Text = t.Text } };
            foreach (var img in t.Images ?? [])
            {
                if (img.Bytes.Length == 0) continue;
                parts.Add(new Part
                {
                    InlineData = new InlineData
                    {
                        MimeType = img.MimeType,
                        Data = Convert.ToBase64String(img.Bytes)
                    },
                    // 逐張指定才有 ULTRA_HIGH（generationConfig 上的全域設定沒有這一檔）
                    MediaResolution = string.IsNullOrWhiteSpace(img.MediaResolution)
                        ? null
                        : new MediaResolution { Level = img.MediaResolution!.Trim() }
                });
            }
            body.Contents.Add(new Content { Role = t.FromModel ? "model" : "user", Parts = parts });
        }

        var url = $"{_opt.BaseUrl.TrimEnd('/')}/v1beta/models/{model}:generateContent";
        using var req = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = new StringContent(JsonSerializer.Serialize(body, Json), Encoding.UTF8)
        };
        // 金鑰走 header 而不是 ?key=：query string 常被 proxy 與 log 記下來
        req.Headers.Add("x-goog-api-key", apiKey);
        req.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json") { CharSet = "utf-8" };

        using var res = await http.SendAsync(req, ct);
        var raw = await res.Content.ReadAsStringAsync(ct);
        if (!res.IsSuccessStatusCode)
        {
            log.LogError("Gemini 回 {Status}：{Body}", (int)res.StatusCode, raw);

            /* 400 的時候把「新加的那兩個欄位」點出來：thinkingConfig 與逐張的
               mediaResolution 都是 Gemini 3 才有的，換模型（或 Google 改版）就可能不收。
               兩個都能用空字串關掉，所以訊息要講得出怎麼關，不然只會看到一句 400。 */
            var hint = res.StatusCode == System.Net.HttpStatusCode.BadRequest
                ? $"　可能是這次要求裡的新欄位不被接受：thinkingConfig.thinkingLevel（現在 {_opt.ThinkingLevel}）"
                  + $"或逐張的 mediaResolution（四視圖 {_opt.ShotMediaResolution}、上傳圖 {_opt.ImageMediaResolution}）。"
                  + "把 appsettings 裡對應那一項設成空字串就不會送。"
                : $"　模型名稱（這次用的是 {model}）或金鑰可能不對。";
            throw new InvalidOperationException(
                $"Gemini 回 HTTP {(int)res.StatusCode}。{hint}原文：{Trim(raw, 800)}");
        }

        var parsed = JsonSerializer.Deserialize<Response>(raw, Json)
                     ?? throw new InvalidOperationException("Gemini 的回應解不開：" + Trim(raw, 800));

        if (parsed.PromptFeedback?.BlockReason is { Length: > 0 } blocked)
            throw new InvalidOperationException($"Gemini 擋掉了這次請求（blockReason={blocked}），請換個描述或圖片。");

        var cand = parsed.Candidates?.FirstOrDefault()
                   ?? throw new InvalidOperationException("Gemini 沒有回任何 candidate：" + Trim(raw, 800));

        var text = string.Concat(cand.Content?.Parts?.Select(p => p.Text) ?? []);

        var u = parsed.UsageMetadata;
        var usage = new GeminiUsage(
            u?.PromptTokenCount ?? 0, u?.CachedContentTokenCount ?? 0,
            u?.CandidatesTokenCount ?? 0, u?.ThoughtsTokenCount ?? 0);
        log.LogInformation(
            "Gemini {Model}（think={Think}）：輸入 {In}（快取 {Cached}）、輸出 {Out}、思考 {Think2}，估 US${Usd:0.0000}",
            model, think, usage.Prompt, usage.Cached, usage.Output, usage.Thoughts, usage.Usd(_opt));

        /* MAX_TOKENS 一定要當錯誤講出來：截斷的程式必然是語法錯誤，
           讓修復迴圈拿著「語法錯誤」跑三輪也修不好，因為問題不在程式。
           思考也吃這個額度（thoughtsTokenCount 按輸出計價），所以 thinkingLevel 調高之後
           更容易撞到——訊息裡把思考用了多少一起講出來，才看得出是被誰吃掉的。 */
        if (string.Equals(cand.FinishReason, "MAX_TOKENS", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException(
                $"Gemini 的輸出被 maxOutputTokens（{_opt.MaxOutputTokens}）截斷了，程式不完整"
                + $"（這一次思考用掉 {usage.Thoughts}、輸出 {usage.Output}）。"
                + "把 Gemini:MaxOutputTokens 調大，或把 Gemini:ThinkingLevel 降一級再試。");

        if (string.IsNullOrWhiteSpace(text))
            throw new InvalidOperationException($"Gemini 回了空的內容（finishReason={cand.FinishReason ?? "?"}）。");

        return new GeminiReply(text, usage);
    }

    private static string Trim(string s, int n) => s.Length <= n ? s : s[..n] + "…";

    // ── 線路格式（只給序列化用） ──────────────────────────────
    private sealed class Request
    {
        public Content? SystemInstruction { get; set; }
        public List<Content> Contents { get; set; } = [];
        public GenerationConfig? GenerationConfig { get; set; }
    }

    private sealed class Content
    {
        public string? Role { get; set; }
        public List<Part> Parts { get; set; } = [];
    }

    private sealed class Part
    {
        public string? Text { get; set; }
        public InlineData? InlineData { get; set; }
        public MediaResolution? MediaResolution { get; set; }
    }

    private sealed class InlineData
    {
        public string MimeType { get; set; } = "";
        public string Data { get; set; } = "";
    }

    private sealed class MediaResolution
    {
        public string Level { get; set; } = "";
    }

    private sealed class GenerationConfig
    {
        public double? Temperature { get; set; }
        public int? MaxOutputTokens { get; set; }
        public ThinkingConfig? ThinkingConfig { get; set; }
    }

    private sealed class ThinkingConfig
    {
        public string ThinkingLevel { get; set; } = "";
    }

    private sealed class Response
    {
        public List<Candidate>? Candidates { get; set; }
        public Feedback? PromptFeedback { get; set; }
        public Usage? UsageMetadata { get; set; }
    }

    private sealed class Usage
    {
        public int? PromptTokenCount { get; set; }
        public int? CachedContentTokenCount { get; set; }
        public int? CandidatesTokenCount { get; set; }
        public int? ThoughtsTokenCount { get; set; }
    }

    private sealed class Candidate
    {
        public Content? Content { get; set; }
        public string? FinishReason { get; set; }
    }

    private sealed class Feedback
    {
        public string? BlockReason { get; set; }
    }
}
