/* ============================================================
   四視圖產生（後端版）
   跑法：
     node tools/shot-bp.cjs <候選藍圖檔> <輸出.png> [建材檔位] [給AI的邊長] [JPEG品質]
   結果以 JSON 印到 stdout（UTF-8）。成功 exit 0，失敗 exit 1。

   **建材檔位預設 9000**（預覽頁自己的預設是 3000）。說明書第 6 節寫著「上萬塊正是
   看得出像不像的那一檔——招牌、窗框、雕花在三千塊時只是幾個色塊」，而遊戲面板最大
   也是 9000。實測踩過：一隻皮卡丘在 3000 塊沒有手腳、五官糊成一片，那有一部分只是
   在看它最不利的那一檔。切檔位就是按預覽頁自己那三顆按鈕（#cnt 裡的 data-v）。

   會產**兩個**檔：
     xxx.png      1024×1024 原圖 —— 給人看的（產生器頁顯示、預覽頁下載）
     xxx-ai.jpg   同尺寸的 JPEG  —— 送給 Gemini 的那份
   分兩份的理由**不是省 token**：Gemini 3 的圖片 token 是按 mediaResolution 這個
   設定值固定計價的（一張 HIGH 就是 1120 個 token），跟像素多少、檔案多大都無關。
   分兩份只是省上傳的位元組（1.1 MB → 約 90 KB），所以**邊長預設就給原生 1024、
   不縮**——縮了不會省 token，只會讓模型看不清楚。轉檔在同一個 chromium 裡用
   canvas 做，不必為此裝任何影像處理套件。

   為什麼是「開真瀏覽器按它自己那顆按鈕」而不是自己畫：
   那張圖是 藍圖預覽.html 的 shotPng() 產的（見那支的 473 行起），裡面有一堆
   實測換來的取景細節——正面必須站在 −z（鏡頭預設站背後，拍回去會把正背面弄反）、
   每一格各自量 x／z 半寬取景（共用 fitCamera 的話主體只佔兩成畫面）、
   俯視 pitch 上限 1.45、45° 的厚度只取 0.55 倍、每格 render 完要**在同一個工作裡**
   drawImage（WebGL 的 drawingBuffer 合成後就被清空）。
   在後端重畫一份等於把這些坑再踩一輪，而且產出的圖跟玩家自己按出來的不一樣。

   playwright 與 chromium 這台機器上已經有了（@playwright/mcp 帶的），
   找法照上游 tools/e2e-3d.cjs 的解析順序。chromium.launch() 不必帶參數，
   headless 用 SwiftShader 軟體算圖就跑得動 WebGL。

   用 file:// 開而不是連自己的站台：預覽頁本來就是設計成 file:// 能用的，
   這樣產圖不必先把 ASP.NET Core 跑起來，也少一層網路。
   ============================================================ */
'use strict';
const path = require('path');
const fs = require('fs');
const url = require('url');

const ROOT = path.resolve(__dirname, '..');
const PAGE = path.join(ROOT, 'wwwroot', '藍圖預覽.html');

function out(o, code) {
  process.stdout.write(JSON.stringify(o, null, 2));
  process.exit(code);
}

/* playwright 不是這個專案的相依，是機器上已經有的。照 e2e-3d.cjs 的順序找。 */
function findPlaywright() {
  const appdata = process.env.APPDATA || '';
  const tries = [
    'playwright',
    path.join(appdata, 'npm/node_modules/@playwright/mcp/node_modules/playwright'),
    path.join(appdata, 'npm/node_modules/@playwright/cli/node_modules/playwright'),
    path.join(appdata, 'npm/node_modules/playwright')
  ];
  for (const t of tries) {
    try { return require(t); } catch (e) { /* 換下一個 */ }
  }
  return null;
}

(async () => {
  const target = process.argv[2];
  const dest = process.argv[3];
  const want = Math.max(300, Math.min(18000, Math.round(+(process.argv[4] || 9000))));
  const aiPx = Math.max(64, Math.min(2048, +(process.argv[5] || 1024)));
  const aiQ = Math.max(0.3, Math.min(1, +(process.argv[6] || 0.90)));
  if (!target || !dest) out({ ok: false, stage: 'arg', error: '用法：node tools/shot-bp.cjs <候選藍圖檔> <輸出.png> [建材檔位] [給AI的邊長] [JPEG品質]' }, 2);
  if (!fs.existsSync(target)) out({ ok: false, stage: 'arg', error: '找不到藍圖檔：' + target }, 2);
  if (!fs.existsSync(PAGE)) out({ ok: false, stage: 'arg', error: '找不到預覽頁：' + PAGE }, 2);

  const pw = findPlaywright();
  if (!pw)
    out({
      ok: false, stage: 'playwright',
      error: '找不到 playwright（四視圖要用無頭 chromium 開預覽頁按它的「下載四視圖」）。' +
             '任一方式即可：npm i -g @playwright/mcp，或 npm i -D playwright && npx playwright install chromium'
    }, 1);

  const code = fs.readFileSync(target, 'utf8');
  let browser = null;
  const pageErrors = [];
  try {
    browser = await pw.chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
    const page = await ctx.newPage();
    page.on('pageerror', e => pageErrors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') pageErrors.push('console: ' + m.text().split('\n')[0]); });

    await page.goto(url.pathToFileURL(PAGE).href, { waitUntil: 'load', timeout: 60000 });
    // 開場那一座建好、下拉選單填好了才算 ready
    await page.waitForFunction(
      'document.getElementById("shape") && document.getElementById("shape").options.length > 0',
      null, { timeout: 60000 });

    // 貼上 → 它會自己 build + diagnose + 選到這一份
    await page.fill('#paste', code);
    await page.click('#load');
    await page.waitForFunction(
      'document.getElementById("pasteMsg").className.indexOf("on") >= 0',
      null, { timeout: 60000 });

    const msg = await page.textContent('#pasteMsg');
    const bad = await page.evaluate('document.getElementById("pasteMsg").className.indexOf("bad") >= 0');
    if (bad)
      out({ ok: false, stage: 'paste', error: '預覽頁載不進這份藍圖：' + (msg || '').trim(), pageErrors }, 1);

    /* 切到要拍的那一檔。預覽頁那三顆按鈕的 handler 是同步的（wantCnt → syncSeg → build），
       所以 click 回來時場景已經重蓋好了；還是等一下 wantCnt，這樣按錯選擇器會馬上發現。
       預覽頁預設就是 3000，是那一檔就不必按。 */
    let tier = '';
    const seg = '#cnt button[data-v="' + want + '"]';
    if (want !== 3000) {
      if (await page.locator(seg).count()) {
        await page.click(seg);
        await page.waitForFunction('wantCnt === ' + want, null, { timeout: 60000 });
      } else {
        // 面板只有 1800／3000／9000 三檔，給了別的數字就照預設那檔拍，不要整支掛掉
        tier = '預覽頁沒有 ' + want + ' 這一檔（只有 1800／3000／9000），改用預設的 3000';
        pageErrors.push(tier);
      }
    }

    const info = await page.evaluate(
      '(typeof bp !== "undefined" && bp) ? { name: bp.name, slots: bp.slots.length, height: bp.height } : null');

    // 按它自己那顆「下載四視圖」，用 download 事件把檔案接下來
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 120000 }),
      page.click('#shot')
    ]);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    await download.saveAs(dest);

    const st = fs.statSync(dest);

    /* 給 AI 的那份：在同一個頁面裡用 canvas 轉成 JPEG（aiPx 預設 1024 ＝ 原生尺寸，
       等於只換編碼、不縮）。原圖是正方形（四格拼起來），所以直接畫成 aiPx × aiPx。
       目的是省上傳位元組，不是省 token——token 由 mediaResolution 決定（見檔頭）。
       轉不出來不算失敗——退回用原圖送，只是上傳慢一點。 */
    const aiPath = dest.replace(/\.png$/i, '') + '-ai.jpg';
    let aiBytes = 0;
    try {
      const src = 'data:image/png;base64,' + fs.readFileSync(dest).toString('base64');
      const jpg = await page.evaluate(async (o) => {
        const img = new Image();
        img.src = o.src;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = c.height = o.px;
        const g = c.getContext('2d');
        g.imageSmoothingQuality = 'high';       // 預設 'low' 會把積木邊緣抽成鋸齒
        g.drawImage(img, 0, 0, o.px, o.px);
        return c.toDataURL('image/jpeg', o.q);
      }, { src, px: aiPx, q: aiQ });
      fs.writeFileSync(aiPath, Buffer.from(jpg.split(',')[1], 'base64'));
      aiBytes = fs.statSync(aiPath).size;
    } catch (e) {
      pageErrors.push('縮圖失敗（會退回用原圖送給 AI）：' + ((e && e.message) || String(e)));
    }

    out({
      ok: true, stage: 'done',
      png: dest,
      bytes: st.size,
      ai: aiBytes ? aiPath : null,
      aiBytes: aiBytes,
      aiPx: aiPx,
      suggested: download.suggestedFilename(),
      name: info ? info.name : null,
      slots: info ? info.slots : null,
      want,                               // 要求拍的檔位
      tierNote: tier || null,             // 有值＝那一檔按不到，拍的是預設檔位
      note: (msg || '').trim(),
      pageErrors
    }, 0);
  } catch (e) {
    out({ ok: false, stage: 'render', error: (e && e.message) ? e.message : String(e), pageErrors }, 1);
  } finally {
    if (browser) { try { await browser.close(); } catch (e) { /* 收工就好 */ } }
  }
})();
