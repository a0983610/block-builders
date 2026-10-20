/* ============================================================
   藍圖總覽：每座藍圖（內建＋自訂）拍四視圖存起來，再拼成總覽，挑粗糙的來重做時直接看
   跑法：
     node tools/bp-overview.cjs                     3000、9000 兩檔都拍（只拍有變的）
     node tools/bp-overview.cjs --counts 9000       只拍這幾檔（逗號分隔）
     node tools/bp-overview.cjs --only 哆啦A夢,3     只看這幾座（名字或索引，逗號分隔）
     node tools/bp-overview.cjs --force             不管指紋，全部重拍（例如改了打光）
     node tools/bp-overview.cjs --out 資料夾         存到別處（預設 repo 旁邊的 ../blueprints，即 AgentData\blueprints）

   為什麼要留：盲測每一回開頭都要「先拍總覽挑候選」，90 座兩檔拍一輪十分鐘起跳，
   而兩回之間真正變了的只有落地那三座。每座記一個**指紋**（那一檔產出來的格子＋顏色的雜湊），
   對得上就不重拍——改了哪座、哪座就自己重拍，不必記得刪圖（見 開發筆記〈盲測第六回：聖三一修道院、美國白宮、台南孔廟三座建築（v1.312.0）〉）。

   存出來的：
     <檔>/<名字>.jpg       四視圖（跟預覽頁「下載四視圖」同一張，轉成 JPEG 省空間）
     總覽-<檔>-<n>.jpg      每座取 ① 正面＋④ 45° 拼成一張，12 座一張（給 agent 讀圖用）
     index.html            全部的總覽，點一格開四視圖（給人看）
     meta.json             每座的指紋、塊數、索引、拍的時候的預覽頁版本
   已經不在選單裡的藍圖（改名、刪掉）圖與紀錄一起清掉。
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const opt = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const has = k => argv.indexOf(k) >= 0;
const OUT = path.resolve(opt('--out') || path.join(ROOT, '..', 'blueprints'));
const COUNTS = (opt('--counts') || '3000,9000').split(',').map(Number).filter(n => n > 0);
const ONLY = opt('--only') ? opt('--only').split(',') : null;
const FORCE = has('--force');

/* 同 e2e-3d.cjs 的 loadPlaywright：本機裝的、或 @playwright/mcp／cli 附帶的都能用 */
function loadPlaywright() {
  const appdata = process.env.APPDATA || '';
  for (const t of ['playwright',
                   path.join(appdata, 'npm/node_modules/@playwright/mcp/node_modules/playwright'),
                   path.join(appdata, 'npm/node_modules/@playwright/cli/node_modules/playwright'),
                   path.join(appdata, 'npm/node_modules/playwright')]) {
    try { return require(t); } catch (e) { /* 換下一個 */ }
  }
  console.log('playwright not found (see loadPlaywright in tools/e2e-3d.cjs)');
  process.exit(2);
}

// 檔名不能有的字元換掉（藍圖名是使用者取的）
const fileOf = n => n.replace(/[\\/:*?"<>|]/g, '_') + '.jpg';
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const metaFile = path.join(OUT, 'meta.json');
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch (e) { /* 第一次 */ }
  delete meta._failed;

  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e && e.message || e)));
  await page.goto('file:///' + path.join(ROOT, '藍圖預覽.html').replace(/\\/g, '/'));
  await page.waitForFunction(() => {
    try { return typeof SHAPES !== 'undefined' && typeof ENG !== 'undefined' && typeof build === 'function'; } catch (e) { return false; }
  }, null, { timeout: 60000 });
  await page.waitForTimeout(500);                  // 自訂藍圖是 list.js 一支一支載進來的
  const list = await page.evaluate(() => SHAPES.map((s, i) => ({ i, n: s.n, custom: !!s.custom })));
  const ver = await page.evaluate(() => typeof VIEWER_VER !== 'undefined' ? VIEWER_VER : '');
  const picked = s => !ONLY || ONLY.includes(s.n) || ONLY.includes(String(s.i));

  let shot = 0, cached = 0, removed = 0;
  const failed = [];
  for (const cnt of COUNTS) {
    const dir = path.join(OUT, String(cnt));
    fs.mkdirSync(dir, { recursive: true });
    const m = meta[cnt] = meta[cnt] || {};
    await page.click('#cnt button[data-v="' + cnt + '"]');
    for (const s of list) {
      if (!picked(s)) continue;
      await page.selectOption('#shape', String(s.i));
      /* 指紋：格子位置＋實際顏色，排序過（蓋的順序變了但長相沒變就不算變） */
      const r = await page.evaluate(() => {
        build();
        if (!bp) return null;
        const a = bp.slots.map(t => t.x + ',' + t.y + ',' + t.z + ',' + bp.pal[t.c % bp.pal.length]).sort().join(';');
        let h = 0x811c9dc5;
        for (let k = 0; k < a.length; k++) { h ^= a.charCodeAt(k); h = Math.imul(h, 16777619); }
        return { fp: (h >>> 0).toString(16).padStart(8, '0') + '-' + bp.slots.length, blocks: bp.slots.length };
      });
      if (!r) { failed.push(cnt + ' ' + s.n); continue; }
      const f = path.join(dir, fileOf(s.n));
      const old = m[s.n];
      if (!FORCE && old && old.fp === r.fp && fs.existsSync(f)) {
        old.i = s.i; old.custom = s.custom; cached++;
        continue;
      }
      const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#shot')]);
      const png = fs.readFileSync(await dl.path());
      const jpg = await page.evaluate(async b64 => {
        const img = new Image();
        img.src = 'data:image/png;base64,' + b64;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        c.getContext('2d').drawImage(img, 0, 0);
        return c.toDataURL('image/jpeg', 0.85).split(',')[1];
      }, png.toString('base64'));
      fs.writeFileSync(f, Buffer.from(jpg, 'base64'));
      m[s.n] = { fp: r.fp, blocks: r.blocks, i: s.i, custom: s.custom, ver, at: new Date().toISOString() };
      shot++;
    }
    // 已經不在選單裡的清掉（只看 --only 的時候不清，那時沒有掃全部）
    if (!ONLY) {
      const names = new Set(list.map(s => s.n));
      for (const n of Object.keys(m)) {
        if (names.has(n)) continue;
        try { fs.unlinkSync(path.join(dir, fileOf(n))); } catch (e) { /* 本來就沒有 */ }
        delete m[n]; removed++;
      }
    }
  }
  fs.writeFileSync(metaFile, JSON.stringify(meta, null, 1));

  /* 拼總覽：每座一格 ＝ 四視圖的左上（① 正面）＋右下（④ 45°），照選單的順序 */
  const T = 240, PER = 12;
  for (const f of fs.readdirSync(OUT)) if (/^總覽-.*\.(jpg|html)$/.test(f)) fs.unlinkSync(path.join(OUT, f));
  const cell = (cnt, s, e) => {
    const u = cnt + '/' + encodeURIComponent(fileOf(s.n));
    const crop = (x, y) => '<div style="width:' + T + 'px;height:' + T + 'px;overflow:hidden;display:inline-block">' +
      '<img src="' + u + '" style="width:' + (T * 2) + 'px;height:' + (T * 2) + 'px;margin-left:' + (-x * T) + 'px;margin-top:' + (-y * T) + 'px"></div>';
    return '<a href="' + u + '" style="display:inline-block;margin:3px;border:1px solid #888;background:#fff;color:#222;text-decoration:none">' +
      '<div style="font:600 15px sans-serif;padding:2px 6px">#' + s.i + ' ' + esc(s.n) + '（' + e.blocks + '）</div>' +
      crop(0, 0) + crop(1, 1) + '</a>';
  };
  const W = 3 * (2 * T + 10);
  let index = '';
  for (const cnt of Object.keys(meta).filter(k => /^\d+$/.test(k)).map(Number).sort((a, b) => a - b)) {
    const rows = list.filter(s => meta[cnt][s.n]).map(s => cell(cnt, s, meta[cnt][s.n]));
    index += '<h2 style="font:700 20px sans-serif;margin:12px 6px 4px">' + cnt + ' 塊</h2>' + rows.join('');
    for (let k = 0; k * PER < rows.length; k++) {
      const hf = path.join(OUT, '總覽-' + cnt + '-' + k + '.html');
      fs.writeFileSync(hf, '<html><body style="margin:0;background:#ccc;width:' + W + 'px">' + rows.slice(k * PER, k * PER + PER).join('') + '</body></html>');
      const p2 = await browser.newPage({ viewport: { width: W, height: 600 } });
      await p2.goto('file:///' + hf.replace(/\\/g, '/'));
      await p2.waitForTimeout(300);
      await p2.screenshot({ path: path.join(OUT, '總覽-' + cnt + '-' + k + '.jpg'), type: 'jpeg', quality: 85, fullPage: true });
      await p2.close();
      fs.unlinkSync(hf);
    }
  }
  fs.writeFileSync(path.join(OUT, 'index.html'),
    '<!doctype html><meta charset="utf-8"><title>藍圖總覽</title>' +
    '<body style="margin:0;background:#ccc;max-width:' + W + 'px">' +
    '<p style="font:14px sans-serif;margin:8px 6px">預覽頁 ' + esc(ver) + '　每格左邊 ① 正面、右邊 ④ 45°，點一下開四視圖</p>' +
    index + '</body>');
  await browser.close();
  console.log('shot ' + shot + ', cached ' + cached + ', removed ' + removed +
              (failed.length ? ', FAILED ' + failed.length + ' (see meta.json)' : '') +
              (errors.length ? ', page errors ' + errors.length : '') + ' -> ' + OUT.replace(/[^\x20-\x7e]/g, '?'));
  if (failed.length) { meta._failed = failed; fs.writeFileSync(metaFile, JSON.stringify(meta, null, 1)); }
})().catch(e => { console.log('ERROR ' + String(e && e.message || e).replace(/[^\x20-\x7e]/g, '?')); process.exit(2); });
