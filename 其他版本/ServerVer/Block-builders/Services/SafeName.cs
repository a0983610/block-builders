using System.Text;

namespace Block_builders.Services;

/// <summary>
/// 把「藍圖名字」變成能當檔名的字串。四視圖（<see cref="BlueprintShooter"/>）與
/// 產生紀錄（<see cref="BlueprintHistory"/>）**必須用同一套**——兩邊的檔名是靠
/// 同一個 stem 配對的（<c>shots/xxx.png</c> ↔ <c>history/xxx.js</c>），
/// 各自清洗一份就會在遇到怪名字時對不起來。
/// </summary>
internal static class SafeName
{
    /// <summary>檔名不合法的字換成底線，去掉頭尾的空白與點，長度上限 100。</summary>
    public static string Stem(string raw)
    {
        var s = new StringBuilder();
        foreach (var c in raw)
            s.Append(Path.GetInvalidFileNameChars().Contains(c) ? '_' : c);
        var name = s.ToString().Trim(' ', '.');
        return name.Length == 0 ? "bp" : name.Length > 100 ? name[..100] : name;
    }

    /// <summary>
    /// 同一個目標的資料夾名。<b>四視圖與產生紀錄用同一個</b>，
    /// 所以 <c>shots/{Group}/</c> 與 <c>history/{Group}/</c> 對得起來。
    ///
    /// 用藍圖的 <c>name</c> 當分類鍵：後端補充第 4 條要求改版時**沿用同一個 name**，
    /// 所以同一座建築的每一版（含自動重跑的失敗版、自動打磨的前後）都會落在同一格。
    /// 蓋不起來、連名字都解不出來的那些進 <c>_蓋不起來</c>。
    /// </summary>
    public const string NoName = "_蓋不起來";

    public static string Group(string? name) =>
        string.IsNullOrWhiteSpace(name) ? NoName : Stem(name.Trim());
}
