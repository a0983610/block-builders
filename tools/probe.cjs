/* ============================================================
   跑一支探針：開遊戲頁（或一頁預覽）、等開場跑完、執行你寫的量測、結果寫成 JSON
   跑法：
     node tools/probe.cjs 探針.cjs                          量完印 JSON
     node tools/probe.cjs 探針.cjs --out 結果.json           寫檔（中文不必經過終端機）
     node tools/probe.cjs 探針.cjs --seed 12345              同一顆種子＝同一副骰子（不給就隨機，會印出來）
     node tools/probe.cjs 探針.cjs --page tools/.e2e-out/某某預覽.html   量預覽頁（預設 index.html）
     node tools/probe.cjs 探針.cjs --live                    主迴圈照跑（預設停掉，時間由 ff() 自己推）
     node tools/probe.cjs --new 探針.cjs                     產一支探針骨架（已經有就不蓋掉）

   CLAUDE.md〈一輪是怎麼跑的〉第 1 點「先量再答」：每次都要寫探針，而每支都得重抄一遍
   「找 playwright、開頁、下種子、等開場、停主迴圈」——這支就是把那一段收起來，探針只寫量什麼。

   探針檔長這樣（module.exports 一支 async 函式，回傳值就是結果）：
     module.exports = async ({ page, run, reset, ff, shot, args }) => {
       await reset({ shape: '吉薩大金字塔', cnt: 1800, workers: 6, done: true });
       await ff(5);                                     // 推 5 秒
       return run(() => ({ n: blocks.length }));        // 在頁面裡跑，回傳要能 JSON 化
     };
   幫手：
     run(fn, arg)  ＝ page.evaluate(fn, arg)
     reset(o)      ＝ 換一座：shape（藍圖名）、cnt（建材）、workers（人數）、done（直接完工）。
                     不給 shape 就是隨機。**不像 e2e 的 reset 會把世界清乾淨**（那一套 installClean 在測試檔裡），
                     要乾淨的起點自己在 run 裡收。
     ff(秒, dt)    ＝ 照 dt（預設 0.05）一步一步推 step()，跟 e2e 一樣
     shot(名字)    ＝ 截圖到 tools/.e2e-out/名字.png
     args          ＝ 指令列上探針檔後面、不是本工具參數的那些字串
   頁面的 console 錯誤與例外會收在結果的 errors 裡（有的話 exit 1）。
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'tools/.e2e-out');
const argv = process.argv.slice(2);
const opt = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const has = k => argv.indexOf(k) >= 0;

const SKELETON = `/* 探針：（量什麼、為什麼要量） */
module.exports = async ({ page, run, reset, ff, shot, args }) => {
  await reset({ shape: '吉薩大金字塔', cnt: 1800, workers: 6, done: true });
  await ff(2);
  return run(() => {
    return { name: bp.name, blocks: blocks.length, workers: workers.length };
  });
};
`;

if (has('--new')) {
  const f = path.resolve(opt('--new') || '');
  if (!opt('--new')) { console.log('要給檔名：node tools/probe.cjs --new 探針.cjs'); process.exit(2); }
  if (fs.existsSync(f)) { console.log('已經有了，沒蓋掉：' + f); process.exit(2); }
  fs.writeFileSync(f, SKELETON);
  console.log('探針骨架：' + f);
  process.exit(0);
}

const file = argv[0] && !argv[0].startsWith('--') ? path.resolve(argv[0]) : null;
if (!file || !fs.existsSync(file)) {
  console.log('要給一支探針檔：node tools/probe.cjs 探針.cjs（骨架：node tools/probe.cjs --new 探針.cjs）');
  process.exit(2);
}
const VALUED = ['--out', '--seed', '--page'];
const args = argv.slice(1).filter((a, i, all) => !(VALUED.includes(a) || VALUED.includes(all[i - 1]) || a === '--live'));

/* 同 e2e-3d.cjs 的 loadPlaywright：本機裝的、或 @playwright/mcp／cli 附帶的都能用 */
function loadPlaywright() {
  const appdata = process.env.APPDATA || '';
  for (const t of ['playwright',
                   path.join(appdata, 'npm/node_modules/@playwright/mcp/node_modules/playwright'),
                   path.join(appdata, 'npm/node_modules/@playwright/cli/node_modules/playwright'),
                   path.join(appdata, 'npm/node_modules/playwright')]) {
    try { return require(t); } catch (e) { /* 換下一個 */ }
  }
  console.log('找不到 playwright（裝法見 tools/e2e-3d.cjs 的 loadPlaywright）');
  process.exit(2);
}

/* 種子：跟 e2e 同一支 mulberry32，頁面端由 initScript 一載入就換掉 Math.random */
const seedArg = parseInt(opt('--seed'), 10);
const SEED = Number.isFinite(seedArg) ? seedArg >>> 0 : (Math.random() * 0xffffffff) >>> 0;
const MULBERRY = 'function(a){return function(){a|=0;a=a+0x6D2B79F5|0;' +
  'var t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;' +
  'return((t^t>>>14)>>>0)/4294967296}}';

(async () => {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.addInitScript('Math.random=(' + MULBERRY + ')(' + SEED + ');');
  const errors = [];
  page.on('pageerror', e => errors.push(String(e && e.message || e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  const target = path.resolve(ROOT, opt('--page') || 'index.html');
  await page.goto('file:///' + target.replace(/\\/g, '/'));
  /* 等開場（boot）跑完：有藍圖、有積木池（同預覽頁那一套等法） */
  await page.waitForFunction(() => {
    try { return typeof bp !== 'undefined' && bp && bp.slots && typeof blocks !== 'undefined'; } catch (e) { return false; }
  }, null, { timeout: 60000 });
  if (!has('--live')) await page.evaluate(() => { running = false; });   // 主迴圈停掉，時間只由 ff() 推

  const run = (fn, arg) => page.evaluate(fn, arg);
  const reset = (o = {}) => page.evaluate(o => {
    muted = true;
    if (o.cnt != null) targetCnt = o.cnt;
    if (o.workers != null) setWorkerCount(o.workers);
    shapePick = o.shape ? SHAPES.findIndex(s => s.n === o.shape) : -1;
    if (o.shape && shapePick < 0) throw new Error('沒有這座藍圖：' + o.shape);
    document.getElementById('shape').value = String(shapePick);
    startBuild(true);
    if (o.done) completeNow();
    return bp.name;
  }, o);
  const ff = (sec, dt = 0.05) => page.evaluate(([s, d]) => { for (let t = 0; t < s - 1e-9; t += d) step(d); }, [sec, dt]);
  const shot = async name => {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const f = path.join(OUT_DIR, name.replace(/\.png$/, '') + '.png');
    if (!has('--live')) await page.evaluate(() => { draw(); ENG.render(); });   // 停著的話先畫一幀
    await page.screenshot({ path: f });
    return f;
  };

  let result, failed = null;
  try { result = await require(file)({ page, run, reset, ff, shot, args, seed: SEED }); }
  catch (e) { failed = String(e && e.stack || e); }
  await browser.close();

  const out = { probe: path.basename(file), seed: SEED, result };
  if (failed) out.failed = failed;
  if (errors.length) out.errors = errors;
  const json = JSON.stringify(out, null, 1);
  if (opt('--out')) { fs.writeFileSync(path.resolve(opt('--out')), json); console.log('寫到 ' + path.resolve(opt('--out')) + '（--seed ' + SEED + '）'); }
  else console.log(json);
  process.exit(failed || errors.length ? 1 : 0);
})().catch(e => { console.log('探針沒跑起來：' + (e && e.stack || e)); process.exit(2); });
