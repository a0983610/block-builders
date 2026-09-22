using Block_builders.Services;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddControllersWithViews();

builder.Services.Configure<GeminiOptions>(builder.Configuration.GetSection(GeminiOptions.Section));
builder.Services.AddHttpClient<GeminiClient>((sp, http) =>
{
    var opt = sp.GetRequiredService<Microsoft.Extensions.Options.IOptions<GeminiOptions>>().Value;
    // 讀六百行說明書、輸出上百行程式，逾時要給得比一般 API 寬
    http.Timeout = TimeSpan.FromSeconds(Math.Max(30, opt.TimeoutSeconds));
});
builder.Services.AddScoped<NodeRunner>();
builder.Services.AddScoped<BlueprintValidator>();
builder.Services.AddScoped<BlueprintShooter>();
builder.Services.AddScoped<BlueprintStore>();
builder.Services.AddScoped<BlueprintHistory>();
builder.Services.AddScoped<BlueprintGenerator>();

var app = builder.Build();

// Configure the HTTP request pipeline.
if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Home/Error");
    // The default HSTS value is 30 days. You may want to change this for production scenarios, see https://aka.ms/aspnetcore-hsts.
    app.UseHsts();
}

app.UseHttpsRedirection();
// 遊戲本體是 wwwroot/index.html（原本雙擊開的那份），所以 / 直接給它
app.UseDefaultFiles();

/* 開發時要求瀏覽器每次都回來問一次（no-cache ＝ 可以快取但必須驗證，
   有 ETag 就還是回 304，不會白傳）。
   UseStaticFiles 預設一個 Cache-Control 都不送，Chrome 就自己啟發式快取——
   結果是改了 wwwroot 裡的檔案、重啟站台、頁面卻還是舊的（實測踩過：
   index.html 加了一顆按鈕，伺服器送的是新版，瀏覽器畫的是舊版）。
   而這個專案的遊戲本體整包都是靜態檔，改的頻率很高。
   正式環境不加這條：那時要的是讓瀏覽器盡量快取。 */
app.UseStaticFiles(new StaticFileOptions
{
    OnPrepareResponse = ctx =>
    {
        if (ctx.Context.RequestServices.GetRequiredService<IWebHostEnvironment>().IsDevelopment())
            ctx.Context.Response.Headers.CacheControl = "no-cache";
    }
});

app.UseRouting();

app.UseAuthorization();

app.MapControllers();

app.MapControllerRoute(
    name: "default",
    pattern: "{controller=Home}/{action=Index}/{id?}");

app.Run();
