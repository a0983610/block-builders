using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace Block_builders.Services;

/// <summary>
/// 藍圖檔案的存取。存的就是 <c>wwwroot/blueprints/*.js</c>，格式跟原本手工放進去的一樣，
/// 整個資料夾拿回去用 <c>file://</c> 開也照樣能跑（所以 <c>list.js</c> 要一起維護）。
/// </summary>
public sealed partial class BlueprintStore(IWebHostEnvironment env, ILogger<BlueprintStore> log)
{
    /// <summary>list.js 的抬頭。只在原本那份不見時當退路——正常都是沿用檔案裡現有的抬頭。</summary>
    private const string FallbackHead =
        "/* 自訂藍圖的檔案清單。\n" +
        "   新增一份藍圖 = 在 blueprints/ 放一支 .js，然後把檔名加進這個陣列\n" +
        "   （藍圖預覽.html 的「產生 list.js」會掃資料夾直接產一份新的，不必自己編輯）。\n" +
        "\n" +
        "   為什麼要這份清單：整個遊戲是用 file:// 直接開的（不架伺服器），\n" +
        "   而 file:// 沒有辦法列出資料夾內容——fetch 會被 CORS 擋掉，\n" +
        "   一支一支去試載入又會在 console 留下一堆 404。所以檔名得自己列。\n" +
        "\n" +
        "   順序＝這些自訂藍圖之間的先後（它們一起排在選單最前面，內建 48 座在後）。 */\n";

    // 遊戲那邊的 bpFileName() 濾掉的就是這一組（路徑分隔字元 ＋ Windows 不收的字）
    [GeneratedRegex(@"[\\/:*?""<>|]")]
    private static partial Regex BadFileChars();

    [GeneratedRegex(@"^\s*var\s+BP_FILES\s*=", RegexOptions.Multiline)]
    private static partial Regex ArrayStart();

    [GeneratedRegex(@"'((?:[^'\\]|\\.)*)'")]
    private static partial Regex QuotedName();

    // list.js 的檔案順序有意義，新檔案接在後面時照中文排序（跟 藍圖預覽.html 的 bpFilesFrom 一致）
    private static readonly StringComparer ZhHant =
        StringComparer.Create(CultureInfo.GetCultureInfo("zh-Hant"), ignoreCase: false);

    // 這兩支的行尾與 BOM 要跟現有檔案一致（LF、無 BOM）：
    // 藍圖預覽.html 的 LIST_HEAD 跟 list.js 的抬頭有 e2e 測試守著逐字相同
    private static readonly UTF8Encoding Utf8NoBom = new(false);

    public string Dir => Path.Combine(env.WebRootPath, "blueprints");

    private string ListPath => Path.Combine(Dir, "list.js");

    private string DocPath => Path.Combine(Dir, "藍圖製作說明.md");

    /// <summary>
    /// 〈藍圖製作說明〉全文，就是丟給模型的 system prompt。改那份文件就等於改 prompt。
    ///
    /// 送出前會把 <c>&lt;!-- 後端不送 --&gt;</c> … <c>&lt;!-- /後端不送 --&gt;</c> 之間的段落剝掉。
    /// 那份文件同時是給人看的（人工流程還在用），裡面有幾段是教玩家「開預覽頁、按檢查、
    /// 複製報告貼回來、把檔名加進 list.js」——後端模式這些步驟都是伺服器自己做的。
    /// **剝掉比在後面用文字覆寫更好**：互相矛盾的指令比沒有指令更糟，模型會照著去叫
    /// 一個不存在的玩家做事。順手也少送一點 token，但那是附帶好處，不是目的。
    /// </summary>
    public async Task<string> ReadPromptDocAsync(CancellationToken ct)
    {
        if (!File.Exists(DocPath))
            throw new InvalidOperationException($"找不到藍圖製作說明：{DocPath}（它就是產生藍圖用的 prompt）");
        var doc = await File.ReadAllTextAsync(DocPath, ct);
        return StripHumanOnly(doc);
    }

    /// <summary>
    /// 剝掉標記起來的「只給人看」段落。標記不成對（少了結尾）時整段留著——
    /// 寧可多送一段，也不要因為打錯一個標記就把後面半份說明書吃掉。
    /// </summary>
    internal static string StripHumanOnly(string doc)
    {
        const string open = "<!-- 後端不送 -->";
        const string close = "<!-- /後端不送 -->";
        var sb = new StringBuilder(doc.Length);
        var at = 0;
        while (true)
        {
            var a = doc.IndexOf(open, at, StringComparison.Ordinal);
            if (a < 0) break;
            var b = doc.IndexOf(close, a + open.Length, StringComparison.Ordinal);
            if (b < 0) break;
            sb.Append(doc, at, a - at);
            at = b + close.Length;
            // 標記自己那一行的換行也一起吃掉，不然會留下一串空行
            if (at < doc.Length && doc[at] == '\r') at++;
            if (at < doc.Length && doc[at] == '\n') at++;
        }
        sb.Append(doc, at, doc.Length - at);
        return sb.ToString();
    }

    /// <summary>資料夾裡實際存在的藍圖檔（排掉 list.js），順序照 list.js。</summary>
    public IReadOnlyList<string> ListFiles()
    {
        var onDisk = Directory.Exists(Dir)
            ? Directory.EnumerateFiles(Dir, "*.js")
                .Select(Path.GetFileName)
                .OfType<string>()
                .Where(f => !string.Equals(f, "list.js", StringComparison.OrdinalIgnoreCase))
                .ToList()
            : [];

        /* 跟 藍圖預覽.html 的 bpFilesFrom() 同一條規則：以資料夾為準，
           但舊清單的順序有意義（＝選單裡的先後），所以本來就在的照舊排前面。 */
        var known = ReadListedFiles().Where(f => onDisk.Contains(f)).ToList();
        var rest = onDisk.Where(f => !known.Contains(f)).OrderBy(f => f, ZhHant);
        return [.. known, .. rest];
    }

    /// <summary>存一份藍圖並重產 list.js。回傳實際用的檔名。</summary>
    public async Task<string> SaveAsync(string fileName, string code, CancellationToken ct)
    {
        Directory.CreateDirectory(Dir);
        var safe = SafeFileName(fileName);

        /* 撞檔名就加編號，不覆蓋：名字撞號在上游已經當必修擋掉了，
           會走到這裡的通常是不同名字剛好被濾成同一個檔名。 */
        var final = safe;
        for (var i = 2; File.Exists(Path.Combine(Dir, final)); i++)
            final = $"{Path.GetFileNameWithoutExtension(safe)}{i}.js";

        await File.WriteAllTextAsync(Path.Combine(Dir, final), code, Utf8NoBom, ct);
        await RegenerateListAsync(ct);
        log.LogInformation("藍圖已存檔：{File}", final);
        return final;
    }

    /// <summary>
    /// 重產 list.js。抬頭沿用檔案裡現有那段（不重打一份）——那段跟 藍圖預覽.html 的
    /// LIST_HEAD 有測試守著逐字相同，重打等於每存一次就有一次寫歪的機會。
    /// 陣列部分的格式照 藍圖預覽.html:701-704 的 listText()。
    /// </summary>
    public async Task RegenerateListAsync(CancellationToken ct)
    {
        var head = FallbackHead;
        if (File.Exists(ListPath))
        {
            var old = await File.ReadAllTextAsync(ListPath, ct);
            var m = ArrayStart().Match(old);
            if (m.Success && m.Index > 0) head = old[..m.Index];
        }

        var files = ListFiles();
        var sb = new StringBuilder(head).Append("var BP_FILES = [");
        if (files.Count > 0)
        {
            sb.Append('\n');
            sb.AppendJoin(",\n", files.Select(f =>
                "  '" + f.Replace("\\", "\\\\").Replace("'", "\\'") + "'"));
            sb.Append('\n');
        }
        sb.Append("];\n");

        await File.WriteAllTextAsync(ListPath, sb.ToString(), Utf8NoBom, ct);
    }

    private List<string> ReadListedFiles()
    {
        if (!File.Exists(ListPath)) return [];
        try
        {
            var src = File.ReadAllText(ListPath);
            var m = ArrayStart().Match(src);
            if (!m.Success) return [];
            return [.. QuotedName().Matches(src[m.Index..])
                .Select(q => q.Groups[1].Value.Replace("\\'", "'").Replace("\\\\", "\\"))];
        }
        catch (IOException e)
        {
            log.LogWarning(e, "讀不動 list.js，這次就以資料夾內容為準");
            return [];
        }
    }

    /// <summary>
    /// 檔名是模型產出來的，不是我們給的：濾掉路徑分隔字元與 Windows 不收的字，
    /// 並確保結果落在 blueprints/ 裡（防目錄穿越）。
    /// </summary>
    private static string SafeFileName(string raw)
    {
        var name = BadFileChars().Replace(raw ?? "", "").Trim();
        name = name.Replace("..", "").Trim(' ', '.');
        if (name.Length == 0) name = "未命名藍圖";
        if (!name.EndsWith(".js", StringComparison.OrdinalIgnoreCase)) name += ".js";
        if (name.Length > 120) name = name[..117] + ".js";
        return name;
    }
}
