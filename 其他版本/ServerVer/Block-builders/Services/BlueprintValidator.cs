using System.Text;
using Microsoft.Extensions.Options;

namespace Block_builders.Services;

/// <summary>tools/validate-bp.cjs 的輸出。欄位名對應那支的 JSON。</summary>
public sealed class BlueprintCheck
{
    public bool Ok { get; set; }

    /// <summary>走到哪一步：list／arg／import／check／done／names</summary>
    public string Stage { get; set; } = "";

    public string? Ver { get; set; }
    public string? Name { get; set; }

    /// <summary>有值＝原本的 name 跟現有藍圖撞號，被自動加了編號。</summary>
    public string? RenamedFrom { get; set; }

    public string? File { get; set; }

    /// <summary>圍籬與「檔名：」那行已經清掉的乾淨程式。存檔要存的是這一段。</summary>
    public string? Code { get; set; }

    public string[] Fails { get; set; } = [];
    public string[] Warns { get; set; } = [];

    /// <summary>
    /// <see cref="Warns"/> 的子集：值得順手修掉的那幾項。
    /// 排掉的是塊數偏差與產生時間——塊數偏差的修法是調係數，而**係數的比例就是造型的長相**，
    /// 為了追塊數去改係數會讓它變得更不像。分層規則寫在 <c>tools/validate-bp.cjs</c> 裡。
    /// </summary>
    public string[] Fixable { get; set; } = [];

    /// <summary>
    /// <see cref="Fixable"/> 的子集：夠嚴重、**有資格自己觸發一輪自動打磨**的那幾項
    /// （東西沒畫上去、有小碎塊飄著、部件偏少）。
    /// 只有「宣告的顏色沒出現」這種普通等級時不會主動花錢——但真的跑了那一輪，
    /// 整個 <see cref="Fixable"/> 都會一起請它修。
    /// </summary>
    public string[] Important { get; set; } = [];
    public string? Report { get; set; }
    public string? Error { get; set; }
    public string[] Skipped { get; set; } = [];
    public string[] Names { get; set; } = [];
}

/// <summary>
/// 叫 Node 跑 <c>tools/validate-bp.cjs</c> 做藍圖體檢。
/// 檢查邏輯一行都不在 C# 這邊——那支 .cjs 直接 require 遊戲自己的
/// <c>wwwroot/src/blueprints.js</c>，跑的是遊戲裡「檢查藍圖」那顆按鈕同一份
/// <c>checkBlueprint()</c>，報告才跟〈藍圖製作說明〉第 7 節對得上。
/// </summary>
public sealed class BlueprintValidator(NodeRunner node, IOptions<GeminiOptions> options)
{
    private static readonly TimeSpan Timeout = TimeSpan.FromMinutes(3);

    private readonly GeminiOptions _opt = options.Value;

    /// <summary>現有藍圖（內建 48 座 ＋ blueprints/ 裡的自訂）的名字，用來避開撞名。</summary>
    public async Task<string[]> ListNamesAsync(CancellationToken ct)
    {
        var r = await node.RunJsonAsync<BlueprintCheck>("validate-bp.cjs", ["--names"], Timeout, ct);
        return r.Names;
    }

    /// <summary>驗一段候選藍圖程式。傳進來的可以是含 ```js 圍籬的原文，剝殼交給 .cjs 做。</summary>
    public async Task<BlueprintCheck> CheckAsync(string code, CancellationToken ct)
    {
        // .cjs 吃檔案而不吃 stdin：Windows 的 stdin 編碼太容易把中文弄壞
        var tmp = Path.Combine(Path.GetTempPath(), $"bp-{Guid.NewGuid():N}.js");
        try
        {
            await File.WriteAllTextAsync(tmp, code, new UTF8Encoding(false), ct);
            /* 第二個參數＝後端加驗要在哪一檔量。**要跟四視圖拍的是同一檔**（ShotSlots）：
               加驗存在的理由是「把『不像』變成量得出來的東西」，而「像不像」是看那張圖
               判斷的，量別的檔位等於評的跟看的不是同一個東西。
               實測 48 支（28 自訂＋20 份產出）裡有 2 支結論會對不上，兩個方向都出現過：
               新竹火車站在 9000 檔四組 windowGrid 全畫 0 格（整組窗戶不存在），
               10000 檔卻是 12／3／12／3 一切正常——報告會說沒事；
               章魚燒反過來，10000 檔報「大檔位反而看不到」，9000 檔沒這回事——
               那會叫模型去修一個圖上不存在的缺陷。
               不傳的話 .cjs 自己退回 9000（面板最大那一檔），但兩邊各寫死一個數字
               遲早會分岔，所以照 BlueprintShooter 的做法從設定傳下去。 */
            return await node.RunJsonAsync<BlueprintCheck>("validate-bp.cjs",
                [tmp, _opt.ShotSlots.ToString()], Timeout, ct);
        }
        finally
        {
            try { File.Delete(tmp); } catch (IOException) { /* 刪不掉就算了，在系統暫存區 */ }
        }
    }
}
