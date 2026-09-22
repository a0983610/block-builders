using System.ComponentModel;
using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Block_builders.Services;

/// <summary>
/// 跑 <c>tools/*.cjs</c> 並把 stdout 當 JSON 讀回來。
/// 體檢（validate-bp）與四視圖（shot-bp）都走這裡：兩支都是「Node 印 JSON、C# 讀」，
/// 差別只有腳本名與參數。
/// </summary>
public sealed class NodeRunner(IWebHostEnvironment env, IConfiguration config, ILogger<NodeRunner> log)
{
    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNameCaseInsensitive = true,
        NumberHandling = JsonNumberHandling.AllowReadingFromString
    };

    private string NodeExe => config["Node:Executable"] ?? "node";

    public string ToolPath(string script) => Path.Combine(env.ContentRootPath, "tools", script);

    /// <summary>
    /// 跑一支工具腳本。<paramref name="timeout"/> 到了就殺掉整棵行程樹
    /// （四視圖會開 chromium，留著會變殭屍）。
    /// </summary>
    public async Task<T> RunJsonAsync<T>(string script, string[] args, TimeSpan timeout, CancellationToken ct)
    {
        var path = ToolPath(script);
        if (!File.Exists(path))
            throw new InvalidOperationException($"找不到工具腳本：{path}");

        var psi = new ProcessStartInfo(NodeExe)
        {
            WorkingDirectory = env.ContentRootPath,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            // 報告與錯誤訊息全是中文，兩邊都得講定 UTF-8
            StandardOutputEncoding = new UTF8Encoding(false),
            StandardErrorEncoding = new UTF8Encoding(false),
            UseShellExecute = false,
            CreateNoWindow = true
        };
        psi.ArgumentList.Add(path);
        foreach (var a in args) psi.ArgumentList.Add(a);

        using var p = new Process { StartInfo = psi };
        try
        {
            p.Start();
        }
        catch (Win32Exception e)
        {
            throw new InvalidOperationException(
                $"啟動不了 Node（{NodeExe}）：{e.Message}。體檢與四視圖都要靠 Node 跑遊戲自己的程式，" +
                "請確認 node 在 PATH 上，或用設定 Node:Executable 指定完整路徑。", e);
        }

        using var kill = CancellationTokenSource.CreateLinkedTokenSource(ct);
        kill.CancelAfter(timeout);

        var stdout = p.StandardOutput.ReadToEndAsync(CancellationToken.None);
        var stderr = p.StandardError.ReadToEndAsync(CancellationToken.None);
        try
        {
            await p.WaitForExitAsync(kill.Token);
        }
        catch (OperationCanceledException)
        {
            try { p.Kill(entireProcessTree: true); } catch (InvalidOperationException) { /* 已經結束 */ }
            throw new InvalidOperationException(
                ct.IsCancellationRequested ? "工作被取消了。" : $"{script} 跑超過 {timeout.TotalSeconds:0} 秒，已中止。");
        }

        var outText = await stdout;
        var errText = await stderr;

        /* 這幾支腳本「有問題」時也是印 JSON 然後 exit 1（例如藍圖有必修），
           那是正常結果不是故障——所以判斷看的是 stdout 解不解得開，不是 exit code。 */
        if (string.IsNullOrWhiteSpace(outText))
        {
            log.LogError("{Script} 沒有輸出。exit={Code} stderr={Err}", script, p.ExitCode, errText);
            throw new InvalidOperationException(
                $"{script} 沒有回傳結果（exit {p.ExitCode}）。stderr：{Cut(errText)}");
        }

        try
        {
            return JsonSerializer.Deserialize<T>(outText, Json)
                   ?? throw new InvalidOperationException($"{script} 的 JSON 解出來是 null");
        }
        catch (JsonException e)
        {
            log.LogError(e, "{Script} 的輸出不是 JSON：{Out}", script, outText);
            throw new InvalidOperationException($"{script} 的輸出不是預期的 JSON：{Cut(outText)}", e);
        }
    }

    private static string Cut(string s) => s.Length > 800 ? s[..800] + "…" : s;
}
