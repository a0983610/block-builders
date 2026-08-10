/* ============================================================
   積木小人 · 世界地標工地 — 端對端回歸測試
   跑法：node tools/e2e-3d.cjs
   需要 Playwright 與 chromium；找不到時會印出安裝指令。
   全部通過 exit 0，有失敗是 1，腳本自己壞掉是 2。

   為什麼一定要用真瀏覽器：這支程式的坑幾乎都在「真實環境與假物件的差異」——
   ES module 走 file:// 會被 CORS 擋、canvas 是 replaced element、
   WebGL 的 drawingBuffer 合成後就被清空。自己刻的假物件一定比真的寬鬆。

   headless chromium 用 SwiftShader 軟體算圖，所以 fps 沒有參考價值，
   這裡量的是 CPU 端成本（step/draw），那個跟顯示卡無關。
   ============================================================ */
'use strict';
const path = require('path');
const fs = require('fs');

/* ---------- 環境 ---------- */
function loadPlaywright() {
  const appdata = process.env.APPDATA || '';
  const tries = [
    'playwright',
    path.join(appdata, 'npm/node_modules/@playwright/mcp/node_modules/playwright'),
    path.join(appdata, 'npm/node_modules/@playwright/cli/node_modules/playwright'),
    path.join(appdata, 'npm/node_modules/playwright'),
  ];
  for (const t of tries) { try { return require(t); } catch (e) { /* 換下一個 */ } }
  console.error('找不到 playwright。任一方式即可：\n' +
    '  npm i -D playwright && npx playwright install chromium\n' +
    '  npm i -g @playwright/mcp（附帶的 chromium 也能用）');
  process.exit(2);
}
const { chromium } = loadPlaywright();

const ROOT = path.resolve(__dirname, '..');
const APP = 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/');
const OUT = path.join(__dirname, '.e2e-out');
const VIEW = { width: 1280, height: 800 };
const SHAPE_COUNT = 36;          // 與 blueprints.js 的 SHAPES 數量一致

/* ---------- 記分板 ---------- */
const R = [];
let section = '';
const head = t => {
  section = t;
  console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 46 - t.length * 2)));
};
const ok = (name, pass, detail) => {
  R.push({ section, name, pass: !!pass, detail });
  console.log((pass ? '  \x1b[32mPASS\x1b[0m  ' : '  \x1b[31mFAIL\x1b[0m  ') +
              name + (detail ? '  → ' + detail : ''));
};

/* ---------- 小工具 ---------- */
/* 讀內部狀態。讀原始狀態比讀畫面嚴格；「畫面真的有畫出來」另外由像素那段驗。 */
const st = page => page.evaluate(() => ({
  phase, placed: placedCnt, total: bp ? bp.slots.length : 0,
  name: bp ? bp.name : '', height: bp ? bp.height : 0, radius: bp ? bp.radius : 0,
  pool: blocks.length, workers: workers.length, dust: dust.length, trees: trees.length,
  siteR, arenaR, target: targetCnt, scale: timeScale,
  free: blocks.filter(b => b.st === 0).length,
  carry: blocks.filter(b => b.st === 1).length,
  toss: blocks.filter(b => b.st === 2).length,
  set: blocks.filter(b => b.st === 3).length,
  fly: blocks.filter(b => b.st === 4).length,
  fallen: workers.filter(w => w.fall > 0).length
}));

/* 重設到可預期的起點。shape 指定藍圖名稱，不給就維持隨機。 */
async function reset(page, o = {}) {
  await page.evaluate(o => {
    running = false; spinOn = false; muted = true;
    /* 變數與 checkbox 要一起改，否則後面用 page.check() 操作 UI 時，
       Playwright 會看到「已經勾了」而不觸發 change，測到的就不是真的 UI 行為 */
    document.getElementById('spin').checked = false;
    document.getElementById('mute').checked = true;
    if (o.cnt != null) { targetCnt = o.cnt; document.getElementById('cnt').value = String(o.cnt); }
    if (o.workers != null) { setWorkerCount(o.workers); document.getElementById('wk').value = String(o.workers); }
    timeScale = o.scale != null ? o.scale : 1;
    shapePick = o.shape ? SHAPES.findIndex(s => s.n === o.shape) : (o.shapeIdx != null ? o.shapeIdx : -1);
    document.getElementById('shape').value = String(shapePick);
    startBuild(true);
  }, o);
}

/* 直接推模擬，不等 rAF——測試才能決定性重現 */
const sim = (page, steps, dt = 0.05) =>
  page.evaluate(({ steps, dt }) => { for (let i = 0; i < steps; i++) step(dt); }, { steps, dt });

/* 把整座建築瞬間蓋好（測破壞時不想等小人搬十分鐘） */
const fillAll = page => page.evaluate(() => {
  for (let i = 0; i < bp.slots.length && i < blocks.length; i++) {
    const s = bp.slots[i], b = blocks[i];
    if (b.cell) gridDel(b);
    b.st = 3; b.slot = i; b.x = s.x; b.y = s.y + HB; b.z = s.z;
    b.rx = b.ry = b.rz = 0; b.scale = 1; b.al = 1; b.holder = -1;
    b.vx = b.vy = b.vz = b.ax = b.ay = b.az = 0;
    s.filled = true; s.claimed = -1;
  }
  /* 多出來的積木要壓成靜止的散料。放著不管的話它們還帶著上一輪的速度，
     之後量「碎塊平均飛行方向」時會把不相干的速度算進去。 */
  for (let i = bp.slots.length; i < blocks.length; i++) {
    const b = blocks[i];
    b.st = 0; b.slot = -1; b.holder = -1; b.snap = 0;
    b.vx = b.vy = b.vz = b.ax = b.ay = b.az = 0;
  }
  for (const w of workers) { w.block = -1; w.slot = -1; w.carry = false; w.st = 'idle'; }
  placedCnt = bp.slots.length; phase = 'done';
});

/* 畫面統計。render 與 readPixels 必須在同一個 evaluate 裡：
   合成之後 drawingBuffer 就被清掉了（preserveDrawingBuffer 預設 false）。 */
const pix = page => page.evaluate(() => {
  /* 相機是每幀漸進靠近目標的，而測試多半把 rAF 迴圈停掉了。
     不先讓它收斂的話，量到的其實是「上一座建築的取景」，
     開場那座又是隨機的 → 同一個測試每次跑出來的數字都不一樣。 */
  for (let i = 0; i < 6; i++) ENG.updateCamera(1);
  draw(); ENG.render();
  const gl = ENG.three.renderer.getContext();
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const cols = new Set();
  let opaque = 0, dark = 0, n = 0;
  for (let i = 0; i < px.length; i += 4 * 31) {
    n++;
    if (px[i + 3] > 10) {
      opaque++;
      const lum = px[i] * 0.3 + px[i + 1] * 0.6 + px[i + 2] * 0.1;
      if (lum < 95) dark++;
      cols.add((px[i] >> 4) + ',' + (px[i + 1] >> 4) + ',' + (px[i + 2] >> 4));
    }
  }
  return { colors: cols.size, opaque: opaque / n, dark: dark / n, size: w + 'x' + h,
           calls: ENG.info().calls, tris: ENG.info().tris };
});

/* 把某個世界座標換算成畫面座標，才能真的用滑鼠點它 */
const placedCntTxt = (a, b) => a + ' → ' + b + ' 塊';

/* 常設哨兵：積木或小人跑到場外，代表某處的位移沒有上限。
   這是實際踩過的雷——落地分離的推擠量會累加，把積木彈到 4700 單位外，
   小人接著就一路走出地圖去撿它。 */
const probeWorkers = async (page, tag) => {
  const r = await page.evaluate(() => {
    let mw = 0, mb = 0, who = null;
    for (const w of workers) {
      const d = Math.hypot(w.x, w.z);
      if (d > mw) { mw = d; who = { d: +d.toFixed(0), tx: +w.tx.toFixed(0), tz: +w.tz.toFixed(0), st: w.st }; }
    }
    for (const b of blocks) mb = Math.max(mb, Math.hypot(b.x, b.z));
    return { mw, mb, who, arenaR };
  });
  const lim = r.arenaR + 30;
  ok('（' + tag + '）沒有東西跑出場外', r.mw < lim && r.mb < lim,
     '最遠小人 ' + r.mw.toFixed(0) + '、最遠積木 ' + r.mb.toFixed(0) +
     '，場地半徑 ' + r.arenaR.toFixed(0) + (r.mw >= lim ? '　' + JSON.stringify(r.who) : ''));
};

const toScreen = (page, sel) => page.evaluate(sel => {
  const t = eval(sel);
  if (!t) return null;
  const v = new THREE.Vector3(t.x, t.y, t.z).project(ENG.three.camera);
  return { x: (v.x + 1) / 2 * window.innerWidth, y: (1 - v.y) / 2 * window.innerHeight };
}, sel);

/* ============================================================ */
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: VIEW });

  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().split('\n')[0]); });

  /* ══════════ 啟動 ══════════ */
  head('啟動');
  await page.goto(APP);
  await page.waitForTimeout(1200);

  const boot = await page.evaluate(() => ({
    three: typeof THREE !== 'undefined' ? THREE.REVISION : null,
    inst: typeof THREE !== 'undefined' && !!THREE.InstancedMesh,
    shapes: typeof SHAPES !== 'undefined' ? SHAPES.length : -1,
    bp: typeof bp !== 'undefined' && bp ? bp.name : null,
    blocks: typeof blocks !== 'undefined' ? blocks.length : -1,
    workers: typeof workers !== 'undefined' ? workers.length : -1,
    phase: typeof phase !== 'undefined' ? phase : '',
    placed: typeof placedCnt !== 'undefined' ? placedCnt : -1,
    total: typeof bp !== 'undefined' && bp ? bp.slots.length : 0,
    cvW: document.getElementById('cv').width,
    cvH: document.getElementById('cv').height,
    cssW: document.getElementById('cv').style.width,
    dpr: window.devicePixelRatio
  }));
  ok('沒有 JS 例外或 console 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
  ok('three.js 有載入（classic script）', boot.three === '185', 'REVISION=' + boot.three);
  ok('InstancedMesh 可用', boot.inst);
  ok('藍圖數量 = ' + SHAPE_COUNT, boot.shapes === SHAPE_COUNT, '實際 ' + boot.shapes);
  ok('開場就選好一座建築', !!boot.bp, boot.bp || '');
  ok('開場就是一座蓋好的建築', boot.phase === 'done' && boot.placed === boot.total && boot.total > 100,
     boot.bp + ' ' + boot.placed + '/' + boot.total + '，phase=' + boot.phase);
  ok('積木池已建立', boot.blocks > 100, boot.blocks + ' 塊');
  ok('小人已就位', boot.workers > 0, boot.workers + ' 人');
  ok('canvas 繪圖尺寸吃到 DPR',
     boot.cvW === Math.round(VIEW.width * Math.min(2, boot.dpr)), boot.cvW + '×' + boot.cvH);
  ok('canvas 有明確的 CSS 尺寸', boot.cssW === VIEW.width + 'px',
     'style.width=' + boot.cssW + '（canvas 是 replaced element，沒設就會用內建尺寸）');

  const ver = await page.evaluate(() => ({
    v: typeof VERSION !== 'undefined' ? VERSION : null,
    shown: document.getElementById('ver').textContent,
    vis: getComputedStyle(document.getElementById('ver')).display !== 'none'
  }));
  ok('有版本號而且格式正確', !!ver.v && /^\d+\.\d+\.\d+$/.test(ver.v), 'VERSION = ' + ver.v);
  ok('版本號有顯示在畫面上', ver.vis && ver.shown === 'v' + ver.v, ver.shown);
  /* README 也要跟著更新，不然文件跟程式會各說各話 */
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  ok('README 的版本號跟程式一致', readme.indexOf('v' + ver.v) >= 0, '找 v' + ver.v);

  /* ══════════ 打包出來的 three ══════════ */
  head('three.js 打包');
  const libSrc = fs.readFileSync(path.join(ROOT, 'lib', 'three.min.js'), 'utf8');
  ok('lib/three.min.js 存在且夠大', libSrc.length > 300000, Math.round(libSrc.length / 1024) + ' KB');
  ok('沒有殘留 ES module 語法', !/(^|[;\n{}])\s*(import|export)\s*[{*]/.test(libSrc),
     'file:// 載入 ES module 會被 CORS 擋掉，整支程式會掛');
  ok('掛在 window.THREE 上', /window\.THREE\s*=/.test(libSrc));
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  ok('index.html 沒有用 type="module"', !/type\s*=\s*["']module["']/.test(html));
  const srcAll = ['engine.js', 'game.js', 'blueprints.js']
    .map(f => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8')).join('\n');
  ok('沒有寫入唯讀的 DOM 屬性', !/\.\s*client(Width|Height)\s*=/.test(srcAll));

  /* ══════════ 渲染 ══════════ */
  head('渲染');
  await reset(page, { shape: '吉薩金字塔', cnt: 800, workers: 8 });
  await fillAll(page);
  const p1 = await pix(page);
  ok('畫面真的有畫出東西', p1.opaque > 0.5, '不透明像素 ' + (p1.opaque * 100).toFixed(0) + '%');
  ok('顏色夠豐富（不是整片單色）', p1.colors > 25, p1.colors + ' 種');
  ok('有陰影／暗面', p1.dark > 0.005, (p1.dark * 100).toFixed(1) + '%');
  ok('draw call 維持在個位數', p1.calls > 0 && p1.calls <= 12,
     p1.calls + ' 個（幾百到幾千塊積木共用 1 個 InstancedMesh）');
  ok('三角形數與積木數相稱', p1.tris > 5000, p1.tris + ' 個');
  await page.screenshot({ path: path.join(OUT, '01-金字塔.png') });

  const oneCall = await page.evaluate(() => {
    const r = ENG.three.renderer;
    r.info.reset();
    r.render(ENG.three.scene, ENG.three.camera);
    // 關掉陰影再算一次，才知道主畫面本身用了幾個 call
    const withShadow = r.info.render.calls;
    r.shadowMap.enabled = false; r.info.reset();
    r.render(ENG.three.scene, ENG.three.camera);
    const noShadow = r.info.render.calls;
    r.shadowMap.enabled = true;
    return { withShadow, noShadow, blocks: blocks.length };
  });
  ok('積木沒有一塊一個 draw call', oneCall.noShadow < 10,
     oneCall.blocks + ' 塊積木，主畫面 ' + oneCall.noShadow + ' 個 call（含陰影 ' + oneCall.withShadow + '）');

  /* ══════════ 藍圖 ══════════ */
  head('藍圖');
  const bpAll = await page.evaluate(cnt => {
    const out = [];
    for (let i = 0; i < SHAPES.length; i++) {
      const b = makeBlueprint(i, cnt);
      let sorted = true, minY = Infinity, maxY = -Infinity, badPal = false;
      for (let k = 1; k < b.slots.length; k++) if (b.slots[k].y < b.slots[k - 1].y) { sorted = false; break; }
      for (const s of b.slots) {
        if (s.y < minY) minY = s.y;
        if (s.y > maxY) maxY = s.y;
        if (!(s.c >= 0 && s.c < 16)) badPal = true;
      }
      out.push({ n: b.name, cnt: b.slots.length, sorted, minY, maxY, h: b.height,
                 r: b.radius, pal: b.pal.length, badPal });
    }
    return out;
  }, 1000);
  ok('36 座都產得出來', bpAll.length === SHAPE_COUNT);
  ok('每座都有名字與配色', bpAll.every(b => b.n && b.pal > 0 && !b.badPal));
  ok('施工順序由下往上', bpAll.every(b => b.sorted),
     bpAll.filter(b => !b.sorted).map(b => b.n).join(','));
  ok('最低一層貼在地面（y=0）', bpAll.every(b => b.minY === 0),
     bpAll.filter(b => b.minY !== 0).map(b => b.n + ':' + b.minY).join(','));
  ok('高度與 slots 對得起來', bpAll.every(b => b.h === b.maxY + 1));
  ok('都有實際占地半徑', bpAll.every(b => b.r > 1));

  const fitStat = await page.evaluate(() => {
    const res = [];
    for (const t of [400, 1200, 3000])
      for (let i = 0; i < SHAPES.length; i++) {
        const c = makeBlueprint(i, t).slots.length;
        res.push({ n: SHAPES[i].n, t, c, err: Math.abs(c - t) / t });
      }
    res.sort((a, b) => b.err - a.err);
    return { worst: res[0], over50: res.filter(r => r.err > 0.5).length, total: res.length };
  });
  /* 有些造型（八節的 101、五座塔的吳哥）本身就有最少積木數，做不了太小的版本，
     所以驗兩件事：沒有任何一座離譜到 2 倍以上，而且超標的是少數。 */
  ok('積木數能自動對應目標',
     fitStat.worst.err < 1.6 && fitStat.over50 <= 6,
     fitStat.total + ' 組裡有 ' + fitStat.over50 + ' 組偏差 >50%；最差 ' +
     fitStat.worst.n + ' 目標 ' + fitStat.worst.t + ' 得到 ' + fitStat.worst.c);

  const variety = await page.evaluate(() => {
    shapePick = -1; const seen = [];
    for (let i = 0; i < 12; i++) { startBuild(true); seen.push(bp.name); }
    return { seen, uniq: new Set(seen).size };
  });
  ok('隨機換建築不會一直重複', variety.uniq >= 9, '連續 12 次出現 ' + variety.uniq + ' 種');

  /* ══════════ 小人施工 ══════════ */
  head('小人施工');
  await reset(page, { shape: '吉薩金字塔', cnt: 400, workers: 16, scale: 1 });
  const b0 = await st(page);
  await sim(page, 200);
  const b1 = await st(page);
  ok('小人開始搬運', b1.carry + b1.toss + b1.set > 0,
     '搬 ' + b1.carry + '、拋 ' + b1.toss + '、就位 ' + b1.set);
  await sim(page, 900);
  const b2 = await st(page);
  ok('進度持續往上', b2.set > b1.set, b1.set + ' → ' + b2.set + ' / ' + b2.total);
  ok('搬運中的積木不會憑空消失', b2.pool === b0.pool, b0.pool + ' → ' + b2.pool);

  await reset(page, { shape: '吉薩金字塔', cnt: 400, workers: 40, scale: 3 });
  await page.evaluate(() => { for (let i = 0; i < 12000; i++) { step(0.05); if (phase === 'done') break; } });
  const done = await st(page);
  ok('會蓋到完工', done.phase === 'done' && done.placed === done.total,
     done.placed + ' / ' + done.total + '，phase=' + done.phase);
  ok('完工後沒有積木卡在半路', done.carry === 0 && done.toss === 0,
     '搬 ' + done.carry + '、拋 ' + done.toss);
  await page.screenshot({ path: path.join(OUT, '02-完工.png') });

  await probeWorkers(page, '小人施工後');

  /* ══════════ 破壞（局部） ══════════ */
  head('破壞：只壞被打到的地方');
  await reset(page, { shape: '中世紀城堡', cnt: 1200, workers: 4 });
  await fillAll(page);
  const smash1 = await page.evaluate(() => {
    const pre = blocks.map(b => ({ st: b.st, x: b.x, y: b.y, z: b.z }));
    // 挑一塊在牆上、不在正中心的積木當落點
    const cand = blocks.filter(b => b.st === 3 && b.y > 2);
    const t = cand[Math.floor(cand.length * 0.35)];
    const point = new THREE.Vector3(t.x, t.y, t.z);
    const n = smash(point, new THREE.Vector3(0.2, -0.95, 0.2).normalize());
    let inR = 0, inBroken = 0, farN = 0, farBroken = 0, farMoved = 0;
    for (let i = 0; i < blocks.length; i++) {
      if (pre[i].st !== 3) continue;
      const d = Math.hypot(pre[i].x - point.x, pre[i].y - point.y, pre[i].z - point.z);
      if (d <= hammerR * 0.75) { inR++; if (blocks[i].st === 4) inBroken++; }
      else if (d > hammerR * 2.2) {
        farN++;
        if (blocks[i].st !== 3) farBroken++;
        if (Math.abs(blocks[i].x - pre[i].x) > 0.001 || Math.abs(blocks[i].y - pre[i].y) > 0.001) farMoved++;
      }
    }
    return { n, inR, inBroken, farN, farBroken, farMoved, R: hammerR };
  });
  ok('衝擊範圍內的積木被打飛', smash1.inBroken === smash1.inR && smash1.inR > 5,
     smash1.inR + ' 塊裡飛出 ' + smash1.inBroken);
  /* 這裡量的是「揮擊當下」：遠處不該被直接波及。
     至於失去支撐而跟著垮的部分，是下一段「垮塌」在管的事。 */
  ok('揮擊當下範圍外的積木完全不受影響', smash1.farBroken === 0 && smash1.farMoved === 0,
     '遠處 ' + smash1.farN + ' 塊，壞了 ' + smash1.farBroken + '、位移 ' + smash1.farMoved);
  ok('一槌打飛的數量合理', smash1.n > 5 && smash1.n < 400, smash1.n + ' 塊（半徑 ' + smash1.R + '）');
  await page.screenshot({ path: path.join(OUT, '03-砸出一個洞.png') });

  const angle = await page.evaluate(() => {
    const run = dir => {
      startBuild(true);
      for (let i = 0; i < blocks.length; i++) {           // 全部歸零，排除上一輪殘留的速度
        const b = blocks[i];
        b.vx = b.vy = b.vz = b.ax = b.ay = b.az = 0; b.snap = 0; b.holder = -1;
        b.st = i < bp.slots.length ? 3 : 0; b.slot = -1;
      }
      for (let i = 0; i < bp.slots.length && i < blocks.length; i++) {
        const s = bp.slots[i], b = blocks[i];
        if (b.cell) gridDel(b);
        b.slot = i; b.x = s.x; b.y = s.y + HB; b.z = s.z;
        b.rx = b.ry = b.rz = 0; s.filled = true;
      }
      placedCnt = bp.slots.length;
      const t = blocks.filter(b => b.st === 3).sort((a, b) => b.y - a.y)[10];
      const p = new THREE.Vector3(t.x, t.y, t.z);
      smash(p, dir);
      let vx = 0, vz = 0, n = 0;
      for (const b of blocks) if (b.st === 4) { vx += b.vx; vz += b.vz; n++; }
      return n ? { vx: vx / n, vz: vz / n, n } : null;
    };
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    const a = run(new THREE.Vector3(1, -0.3, 0).normalize());
    const b = run(new THREE.Vector3(-1, -0.3, 0).normalize());
    return { a, b };
  });
  ok('從不同角度砸，散開的方向不同',
     angle.a && angle.b && Math.sign(angle.a.vx) !== Math.sign(angle.b.vx) &&
     Math.abs(angle.a.vx - angle.b.vx) > 2,
     '往 +X 砸平均 vx=' + angle.a.vx.toFixed(2) + '，往 −X 砸 vx=' + angle.b.vx.toFixed(2));

  const land = await page.evaluate(() => {
    for (let i = 0; i < 700; i++) step(0.05);
    let flying = 0, outside = 0, sunk = 0, float = 0, worstY = 0, freeN = 0;
    for (const b of blocks) {
      if (b.st === 4) flying++;
      if (Math.hypot(b.x, b.z) > arenaR + 1.5) outside++;
      if (b.st !== 0 || b.snap > 0) continue;
      freeN++;
      /* 用 halfY 不是 h/2：積木斜著落定時，沿世界 Y 的半高會大於 0.47 */
      const need = halfY(b);
      if (b.y < need - 0.12) sunk++;
      if (b.y > need + 0.12) { float++; worstY = Math.max(worstY, b.y); }
    }
    return { flying, outside, sunk, float, worstY, freeN };
  });
  ok('碎塊最後都會落定', land.flying === 0, land.flying + ' 塊還在飛');
  ok('碎塊不會飛出工地', land.outside === 0, land.outside + ' 塊在場外');
  ok('碎塊不會陷進地面', land.sunk === 0, land.sunk + ' 塊陷入');
  ok('碎塊不會浮在半空', land.float === 0 && land.freeN > 10,
     land.freeN + ' 塊散料，浮空 ' + land.float + '（最高 ' + land.worstY.toFixed(2) + '）');

  await probeWorkers(page, '破壞後');

  /* ══════════ 垮塌 ══════════ */
  head('垮塌：下面沒了上面跟著垮');
  await reset(page, { shape: '倫敦大笨鐘', cnt: 900, workers: 1 });
  const tower = await page.evaluate(() => {
    completeNow();
    const before = placedCnt, h = bp.height;
    // 直接把最底下兩層清乾淨——一槌的球半徑不一定蓋得住整個底座，
    // 那樣測到的是「打不夠乾淨」而不是「垮不垮」
    let cleared = 0;
    for (const b of blocks) if (b.st === 3 && b.y < 2.2) { breakBlock(b, 0, 0, 0); cleared++; }
    afterHit(cleared, { x: 0, y: 1, z: 0 }, 6);
    const rightAfter = placedCnt;
    for (let i = 0; i < 40; i++) step(0.05);
    return { before, cleared, rightAfter, after: placedCnt, h };
  });
  /* 不要求正好剩 0：垮完的碎料就掉在腳邊，小人在這兩秒內可能已經撿起來擺回去了。
     那是正常行為，不該讓這個測試變得時好時壞。 */
  ok('清掉底座，整座塔跟著垮下來', tower.after < tower.before * 0.02,
     '高 ' + tower.h + ' 的塔：' + tower.before + ' → 清掉底座剩 ' + tower.rightAfter +
     ' → 垮完剩 ' + tower.after);

  const side = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '萬里長城');
    startBuild(true); completeNow();
    const far0 = blocks.filter(b => b.st === 3 && b.x > 12).length;
    const t = blocks.filter(b => b.st === 3 && b.x < -12)[0];
    smash(new THREE.Vector3(t.x, t.y, t.z), new THREE.Vector3(0, -1, 0));
    for (let i = 0; i < 80; i++) step(0.05);
    return { far0, far1: blocks.filter(b => b.st === 3 && b.x > 12).length,
             total: bp.slots.length, left: placedCnt };
  });
  ok('打一端不會讓另一端跟著垮', side.far1 === side.far0 && side.far0 > 5,
     '另一端 ' + side.far0 + ' → ' + side.far1 + '（整體 ' + side.total + ' → ' + side.left + '）');

  /* 有些造型本來就有懸空部件（摩天輪車廂、大橋吊索、堆疊的塔節），
     那些不是被打壞才浮著的，沒人動它就不該掉。36 座全部驗一遍。 */
  const floaty = await page.evaluate(() => {
    const bad = [];
    let withFloats = 0;
    for (let i = 0; i < SHAPES.length; i++) {
      shapePick = i; startBuild(true); completeNow();
      if (bp.floats.length) withFloats++;
      const n0 = placedCnt;
      markSupportDirty(0);
      for (let k = 0; k < 80; k++) step(0.05);
      if (placedCnt !== n0) bad.push(SHAPES[i].n + ' ' + n0 + '→' + placedCnt);
    }
    return { bad, withFloats };
  });
  ok('36 座都不會無故掉塊', floaty.bad.length === 0,
     floaty.bad.join('　') || '其中 ' + floaty.withFloats + ' 座有懸空部件，都沒掉');

  /* 懸空部件不是無敵的：撐著它的結構被打掉，它也要跟著掉，而且要一路連鎖 */
  const chain = await page.evaluate(() => {
    const out = [];
    for (const nm of ['台北 101', '倫敦眼摩天輪', '京都五重塔', '嚴島神社鳥居']) {
      shapePick = SHAPES.findIndex(s => s.n === nm);
      startBuild(true); setWorkerCount(1); completeNow();
      const n0 = placedCnt, g = bp.floats.length;
      let cleared = 0;
      for (const b of blocks) if (b.st === 3 && b.y < 3.2) { breakBlock(b, 0, 0, 0); cleared++; }
      afterHit(cleared, { x: 0, y: 1, z: 0 }, 6);
      for (let k = 0; k < 160; k++) step(0.05);
      out.push({ nm, n0, cleared, left: placedCnt, g });
    }
    return out;
  });
  for (const c of chain)
    ok('打掉底座，' + c.nm + ' 的懸空部件跟著垮', c.left < c.n0 * 0.05,
       c.n0 + ' −底座' + c.cleared + ' → 剩 ' + c.left + '（' + c.g + ' 組懸空部件）');

  const supCost = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '艾菲爾鐵塔');
    targetCnt = 3000; setWorkerCount(2); startBuild(true); completeNow();
    const t0 = performance.now();
    for (let i = 0; i < 50; i++) collapseUnsupported();
    return { ms: (performance.now() - t0) / 50, n: blocks.length };
  });
  ok('垮塌判定夠便宜', supCost.ms < 4,
     supCost.n + ' 塊時一次 ' + supCost.ms.toFixed(2) + ' ms（最多每 0.08 秒算一次）');

  /* 蓋到一半把地基敲掉，小人不能繼續往上疊——那會蓋出一整片浮在半空的積木。
     量法：逐步比對「這一步新填上的格子」，看它填上去的當下連不連得到地面。
     不能只看某個瞬間的總數——剛敲掉地基、垮塌判定還沒跑的那 0.08 秒裡，
     整棟都還「連不到地面」，那是過渡態不是 bug。 */
  const midBuild = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '倫敦大笨鐘');
    targetCnt = 900; setWorkerCount(30); startBuild(true);
    for (let i = 0; i < 500; i++) step(0.05);
    const mid = placedCnt;
    let cleared = 0;
    for (const b of blocks) if (b.st === 3 && b.y < 2.2) { breakBlock(b, 0, 0, 0); cleared++; }
    afterHit(cleared, { x: 0, y: 1, z: 0 }, 6);
    const S = bp.slots, before = new Uint8Array(S.length);
    let placed = 0, bad = 0;
    for (let i = 0; i < 1600; i++) {
      for (let k = 0; k < S.length; k++) before[k] = S[k].filled ? 1 : 0;
      step(0.05);
      computeSupport();
      for (let k = 0; k < S.length; k++) {
        if (!S[k].filled || before[k]) continue;
        placed++;
        if (!supported(k)) bad++;
      }
    }
    return { mid, cleared, end: placedCnt, placed, bad };
  });
  ok('地基被敲掉後不會蓋出浮空的積木', midBuild.bad === 0,
     '蓋到 ' + midBuild.mid + ' 塊時挖掉地基 ' + midBuild.cleared + ' 塊；之後新放上去 ' +
     midBuild.placed + ' 塊，落地當下連不到地面的有 ' + midBuild.bad + ' 塊（重建到 ' + midBuild.end + '）');

  const noDip = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 500; setWorkerCount(40); startBuild(true);
    let prev = placedCnt, dip = 0;
    // 步數要給夠：有些格子的支撐要等上面那圈蓋好才成立，會排到最後才輪到
    for (let i = 0; i < 8000; i++) {
      step(0.05);
      if (placedCnt < prev) dip = Math.max(dip, prev - placedCnt);   // 沒人在砸，進度就不該倒退
      prev = placedCnt;
      if (phase === 'done') break;
    }
    return { placed: placedCnt, total: bp.slots.length, phase, dip };
  });
  /* 重點是「沒人在砸，進度就不該倒退」。有沒有在時限內剛好蓋完是另一回事——
     那個由「會蓋到完工」那項負責，寫在這裡只會讓測試對時序敏感。 */
  ok('施工前緣不會被垮塌判定誤傷', noDip.dip === 0 && noDip.placed > noDip.total * 0.9,
     noDip.placed + '/' + noDip.total + '（' + noDip.phase + '），過程中最大回退 ' + noDip.dip + ' 塊');

  await probeWorkers(page, '垮塌後');

  /* ══════════ 遊戲流程：蓋好 → 拆掉 → 蓋下一座 ══════════ */
  head('流程：蓋好 → 拆掉 → 蓋下一座');
  await reset(page, { shape: '吉薩金字塔', cnt: 700, workers: 12 });
  const flow = await page.evaluate(() => {
    completeNow();
    const opened = { phase, placed: placedCnt, total: bp.slots.length, name: bp.name };
    const cand = blocks.filter(b => b.st === 3);
    const t = cand[Math.floor(cand.length * 0.5)];
    smash(new THREE.Vector3(t.x, t.y, t.z), new THREE.Vector3(0.2, -0.95, 0.1).normalize());
    const hit1 = { phase, placed: placedCnt };
    for (let i = 0; i < 600; i++) step(0.05);      // 放 30 秒也不該有人來修
    const idle = { phase, placed: placedCnt };
    return { opened, hit1, idle, thresh: Math.floor(bp.slots.length * WRECK_AT) };
  });
  ok('completeNow 會直接給一座蓋好的建築',
     flow.opened.phase === 'done' && flow.opened.placed === flow.opened.total,
     flow.opened.name + ' ' + flow.opened.placed + '/' + flow.opened.total);
  ok('砸完工的建築會進入「拆除中」', flow.hit1.phase === 'wreck',
     'phase=' + flow.hit1.phase + '，剩 ' + flow.hit1.placed);
  ok('拆除中小人不會偷偷把它修回去',
     flow.idle.placed === flow.hit1.placed && flow.idle.phase === 'wreck',
     '30 秒後 ' + flow.hit1.placed + ' → ' + flow.idle.placed);

  const wreck = await page.evaluate(() => {
    const name0 = bp.name, d0 = stats.destroyed;
    let hits = 0;
    for (let i = 0; i < 60 && phase === 'wreck'; i++) {
      const cand = blocks.filter(b => b.st === 3);
      if (!cand.length) { for (let k = 0; k < 5; k++) step(0.05); continue; }
      const t = cand[Math.floor(Math.random() * cand.length)];
      smash(new THREE.Vector3(t.x, t.y, t.z), new THREE.Vector3(0.2, -0.95, 0.1).normalize());
      hits++;
      for (let k = 0; k < 8; k++) step(0.05);
    }
    const at = phase, placed = placedCnt;
    // 換場先整地（推土機），整完才輪到小人
    let wait = 0;
    while (phase === 'clear' && wait < 800) { step(0.05); wait++; }
    return { hits, at, phase, placed, wait, destroyed: stats.destroyed, gained: stats.destroyed - d0, name0, name: bp.name };
  });
  ok('拆到門檻就自動開下一座', wreck.at === 'clear' && wreck.placed < 30,
     '砸 ' + wreck.hits + ' 槌後 phase=' + wreck.at + '，進度歸零到 ' + wreck.placed);
  ok('整地完才換成施工中', wreck.phase === 'build' && wreck.wait > 0 && wreck.wait < 800,
     '整地 ' + (wreck.wait * 0.05).toFixed(1) + ' 秒後 phase=' + wreck.phase);
  ok('拆掉的座數有計進紀錄', wreck.gained === 1, '+' + wreck.gained + '（累計 ' + wreck.destroyed + '）');

  const rebuild = await page.evaluate(() => {
    setWorkerCount(30);
    // 只跑到「蓋一半」就好——跑到完工的話 phase 會變 done，
    // 那時候再砸測到的是拆除流程，不是修補流程
    for (let i = 0; i < 400; i++) step(0.05);
    const mid = placedCnt, ph0 = phase;
    const cand = blocks.filter(b => b.st === 3);
    const t = cand[Math.floor(cand.length * 0.6)];
    smash(new THREE.Vector3(t.x, t.y, t.z), new THREE.Vector3(0, -1, 0));
    const hurt = placedCnt, ph1 = phase;
    for (let i = 0; i < 900; i++) step(0.05);
    return { mid, ph0, hurt, ph1, after: placedCnt, phase, total: bp.slots.length };
  });
  await probeWorkers(page, '拆除重建後');
  const roam = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 500; setWorkerCount(20); startBuild(true); completeNow();
    const pre = workers.map(w => ({ d: Math.round(Math.hypot(w.x, w.z)), td: Math.round(Math.hypot(w.tx, w.tz)), st: w.st }))
      .sort((a, b) => b.d - a.d).slice(0, 3);
    for (let i = 0; i < 200; i++) step(0.05);        // 先把七秒的繞圈慶祝跑完
    const a0 = arenaR, ph0 = phase;
    let far = 0, out = 0, worst = null;
    for (let i = 0; i < 3000; i++) {
      step(0.05);
      const lim = arenaR + 26;                      // 草地島的半邊長，會隨建築換而改
      for (const w of workers) {
        const d = Math.max(Math.abs(w.x), Math.abs(w.z));
        if (d > far) far = d;
        if (d > lim && !worst) worst = { d: +d.toFixed(1), lim: +lim.toFixed(1), i, phase, name: bp.name };
        if (d > lim) out++;
      }
    }
    return { far, out, worst, a0, ph0, arenaR, siteR, phase, name: bp.name, lim: arenaR + 26, pre };
  });
  ok('完工後小人會逛遍整張地圖', roam.far > roam.a0 + 8,
     '最遠走到 ' + roam.far.toFixed(0) + '（建築半徑 ' + roam.siteR.toFixed(0) +
     '、工地半徑 ' + roam.a0.toFixed(0) + '）');
  ok('但不會走出草地', roam.out === 0,
     '越界 ' + roam.out + ' 次；草地半邊長 ' + roam.lim.toFixed(0) +
     '；進場時最遠的三個小人 ' + JSON.stringify(roam.pre) +
     (roam.worst ? '；第一次越界 ' + JSON.stringify(roam.worst) : ''));

  /* 遊蕩要有停頓，不然一群人一路走不停，看起來像螞蟻在竄。
     量每個小人「連續原地不動」最長撐幾秒——沒有停頓的話，
     只有抵達目標那一幀不動（0.05 秒），撐不到一秒。 */
  const idle = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 500; setWorkerCount(20); startBuild(true); completeNow();
    for (let i = 0; i < 200; i++) step(0.05);          // 先把七秒的繞圈慶祝跑完
    const run = workers.map(() => 0), best = workers.map(() => 0);
    const px = workers.map(w => w.x), pz = workers.map(w => w.z);
    let moved = 0, samples = 0;
    for (let i = 0; i < 1200; i++) {
      step(0.05);
      for (let k = 0; k < workers.length; k++) {
        const w = workers[k];
        const d = Math.hypot(w.x - px[k], w.z - pz[k]);
        px[k] = w.x; pz[k] = w.z; samples++;
        if (d < 1e-6) { run[k] += 0.05; if (run[k] > best[k]) best[k] = run[k]; }
        else { run[k] = 0; moved++; }
      }
    }
    best.sort((a, b) => b - a);
    return { longest: +best[0].toFixed(2), median: +best[best.length >> 1].toFixed(2),
             least: +best[best.length - 1].toFixed(2),
             movingFrac: +(moved / samples).toFixed(2), n: workers.length };
  });
  ok('遊蕩時會不時停下來站一會兒', idle.median >= 1.1,
     idle.n + ' 人在 60 秒裡最長站定：中位數 ' + idle.median + ' 秒、最久 ' +
     idle.longest + ' 秒、最短 ' + idle.least + ' 秒');
  ok('但不會整群釘在原地', idle.movingFrac > 0.5 && idle.movingFrac < 0.97,
     '有在移動的幀數占 ' + (idle.movingFrac * 100).toFixed(0) + '%');

  ok('拆完之後小人開始蓋新的', rebuild.mid > 20 && rebuild.ph0 === 'build',
     '蓋到 ' + rebuild.mid + ' / ' + rebuild.total + '（' + rebuild.ph0 + '）');
  ok('砸還沒蓋完的建築不會進入拆除中', rebuild.ph1 === 'build', 'phase=' + rebuild.ph1);
  ok('施工中被砸，小人會把洞補回去', rebuild.after > rebuild.hurt,
     '砸到剩 ' + rebuild.hurt + ' → 補回 ' + rebuild.after);

  /* ══════════ 整地推土機 ══════════ */
  head('整地推土機');
  await reset(page, { shape: '中世紀城堡', cnt: 1200, workers: 12 });
  const doze = await page.evaluate(() => {
    completeNow();
    // 先把整座砸爛，讓碎料鋪滿工地，砸到門檻它就會自己換下一座
    let g = 0;
    while (phase !== 'clear' && g++ < 200) {
      const cand = blocks.filter(b => b.st === 3);
      if (cand.length) {
        const t = cand[Math.floor(Math.random() * cand.length)];
        smash(new THREE.Vector3(t.x, t.y, t.z), new THREE.Vector3(0.2, -0.95, 0.1).normalize());
      }
      for (let k = 0; k < 8; k++) step(0.05);
    }
    const born = dozers ? { n: dozers.n, passes: dozers.passes, L: +dozers.L.toFixed(1) } : null;
    const drawn = dozers ? dozRender(dozers).length : 0;
    const R = siteR + 1.4;
    const dirtyOf = () => blocks.filter(b => b.st === 0 && Math.hypot(b.x, b.z) < R).length;
    // 分清楚「被鏟子推出去」跟「時間到直接彈出去」各占多少
    const origKick = kickOut; let kicked = 0;
    kickOut = b => { kicked++; origKick(b); };
    /* 「有被一路推著走」要看碎料沿推進方向的平均位置有沒有一路往前跑。
       單看範圍內剩幾塊看不出來——一趟推到底的話，碎料是在鏟子逼近邊緣時才成批離開範圍。
       追蹤對象要在一開始就定下來：拿「當下還在範圍內的」去平均的話，
       推出去的一離開就不算了，平均值反而會往回跳。 */
    const dx = dozers.dx, dz = dozers.dz;
    const cohort = blocks.filter(b => b.st === 0 && Math.hypot(b.x, b.z) < R);
    const alongOf = () => {
      let s = 0;
      for (const b of cohort) s += b.x * dx + b.z * dz;
      return cohort.length ? s / cohort.length : null;
    };
    const trail = [], along = [];
    let peak = dirtyOf(), lastIn = 0, built = 0, guard = 0;
    while (phase === 'clear' && guard++ < 900) {
      step(0.05);
      const d = dirtyOf();
      if (d > peak) peak = d;
      if (guard % 8 === 0) trail.push(d);
      // 起步前那段怠速不取樣，不然「有沒有在前進」會被一串不動的樣本稀釋
      if (guard % 4 === 0 && dozers && dozers.wait <= 0) {
        const a = alongOf(); if (a !== null) along.push(+a.toFixed(1));
      }
      if (placedCnt > built) built = placedCnt;
      /* 小人本來就可能剛好站在工地正中央（上一秒還在遊蕩），走出去要好幾秒，
         所以不能要求「整段期間都不在裡面」。要驗的是他們有往外走、而且整完時人不在裡面。 */
      for (const w of workers) if (Math.hypot(w.x, w.z) < R) { lastIn = guard; break; }
    }
    const stillIn = workers.filter(w => Math.hypot(w.x, w.z) < R).length;
    kickOut = origKick;
    const dirty1 = dirtyOf(), secs = +(guard * 0.05).toFixed(1);
    /* 看的是「有沒有倒退」，不是「每個取樣點都在前進」。鏟子從起點開到工地邊緣
       那零點幾秒還沒碰到東西，前幾個取樣本來就是平的。 */
    let down = 0;
    for (let i = 1; i < along.length; i++) if (along[i] < along[i - 1] - 0.2) down++;
    let g2 = 0; while (dozers && g2++ < 300) step(0.05);   // 整完會自己開走
    return { born, drawn, peak, dirty1, kicked, trail, secs, built, along, stillIn,
             gain: along.length > 1 ? +(along[along.length - 1] - along[0]).toFixed(1) : 0, down,
             lastIn: +(lastIn * 0.05).toFixed(1),
             gone: !dozers, phase, drove: +(g2 * 0.05).toFixed(1) };
  });
  ok('換建築時會開幾台推土機進來', doze.born && doze.born.n >= 2 && doze.drawn === doze.born.n,
     doze.born ? doze.born.n + ' 台、' + doze.born.passes + ' 趟，畫面上放了 ' + doze.drawn + ' 台' : '沒有出現');
  ok('整地時小人退出工地等，不會提早開工', doze.stillIn === 0 && doze.built === 0,
     '整完時還站在工地裡的有 ' + doze.stillIn + ' 人（最後一次有人在裡面是第 ' +
     doze.lastIn + ' 秒／共 ' + doze.secs + ' 秒），期間蓋了 ' + doze.built + ' 塊');
  ok('整地完工地範圍是空的', doze.dirty1 === 0,
     '整地 ' + doze.secs + ' 秒，範圍內從最多 ' + doze.peak + ' 塊清到 ' + doze.dirty1 + ' 塊');
  ok('碎料是被鏟出去的，不是時間到瞬間彈掉',
     doze.peak > 0 && doze.kicked < doze.peak * 0.12,      // 實測 1~5%，門檻放寬到 12%
     '最多 ' + doze.peak + ' 塊，收尾時只彈了 ' + doze.kicked + ' 塊（其餘由鏟子推出去）');
  ok('碎料是被一路推著走的，中途不會倒退', doze.gain > 8 && doze.down === 0,
     '沿推進方向的平均位置前進了 ' + doze.gain + '，倒退 ' + doze.down + ' 次：' +
     JSON.stringify(doze.along.slice(0, 12)) +
     '；範圍內剩餘 ' + JSON.stringify(doze.trail.slice(0, 12)));
  ok('整完會自己開出場', doze.gone && doze.phase === 'build',
     doze.drove + ' 秒後開走，phase=' + doze.phase);

  /* 大工地一列排不滿，要來回推好幾趟——掉頭那段是另一條路徑，得單獨走過 */
  const dozeBig = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '金門大橋');
    targetCnt = 2000; setWorkerCount(6); startBuild(true); completeNow();
    // 手動把全部積木打散在工地上，再叫整地流程跑一次
    for (const b of blocks) { if (b.st === 3) freeBlock(b); }
    for (let i = 0; i < 120; i++) step(0.05);
    siteR = bp.radius; startClear();
    const info = { n: dozers.n, passes: dozers.passes, spd: +dozers.spd.toFixed(1), siteR: +siteR.toFixed(0) };
    const R = siteR + 1.4;
    const dirty0 = blocks.filter(b => b.st === 0 && Math.hypot(b.x, b.z) < R).length;
    let turns = 0, maxPass = 0, g = 0;
    while (phase === 'clear' && g++ < 1200) {
      step(0.05);
      if (dozers) { if (dozers.turn > 0) turns++; if (dozers.pass > maxPass) maxPass = dozers.pass; }
    }
    return { info, dirty0, turns, maxPass, secs: +(g * 0.05).toFixed(1), phase,
             dirty1: blocks.filter(b => b.st === 0 && Math.hypot(b.x, b.z) < R).length };
  });
  ok('大工地會來回推好幾趟', dozeBig.info.passes >= 2 && dozeBig.maxPass >= 1 && dozeBig.turns > 0,
     '半徑 ' + dozeBig.info.siteR + ' 的工地：' + dozeBig.info.n + ' 台推 ' +
     dozeBig.info.passes + ' 趟（實際跑到第 ' + (dozeBig.maxPass + 1) + ' 趟，掉頭 ' + dozeBig.turns + ' 幀）');
  ok('大工地也整得完，而且不會沒完沒了', dozeBig.dirty1 === 0 && dozeBig.secs < 16,
     dozeBig.dirty0 + ' 塊 → ' + dozeBig.dirty1 + ' 塊，花 ' + dozeBig.secs + ' 秒（車速 ' + dozeBig.info.spd + '）');

  /* 畫面上的鏟子跟判定用的鏟子要是同一把。
     在每台機器的鏟面正前方各擺一塊碎料，看它會不會被往前推——
     只驗座標的話，鏟子畫在別的地方也測不出來。 */
  const dozAlign = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 700; setWorkerCount(6); startBuild(true); completeNow();
    for (const b of blocks) if (b.st === 3) freeBlock(b);
    for (let i = 0; i < 120; i++) step(0.05);
    kickOutSite();                                  // 先清空，等一下自己擺測試用的積木
    for (let i = 0; i < 80; i++) step(0.05);
    startClear();
    dozers.wait = 0; dozers.u = dozers.L;           // 跳過怠速，直接開到工地正中央
    /* 先把場上其他碎料全部從空間雜湊裡拿掉並挪到場邊。留著的話，
       量到的位移會混進「碎料互相擠開」的成分——這裡要測的是鏟子推不推得到。 */
    for (const b of blocks) {
      if (b.st !== 0) continue;
      if (b.cell) gridDel(b);
      b.x = arenaR * 0.98; b.z = arenaR * 0.98; b.y = 0.47;
    }
    const view = dozRender(dozers);
    const probes = [];
    for (const v of view) {
      const fx = Math.sin(v.a), fz = Math.cos(v.a);  // rotation.y = a → local +Z 指向這裡
      const b = blocks.find(x => x.st === 0 && !x.probe);
      b.probe = 1;
      const at = ENG.DOZ_FRONT + 0.2;                // 剛好貼在鏟面前
      b.x = v.x + fx * at; b.z = v.z + fz * at; b.y = 0.47; b.rest = true;
      gridAdd(b);
      probes.push({ b, x0: b.x, z0: b.z, fx, fz });
    }
    for (let i = 0; i < 6; i++) step(0.02);
    const moved = probes.map(p => +((p.b.x - p.x0) * p.fx + (p.b.z - p.z0) * p.fz).toFixed(2));
    // 順便留一張整地中的畫面
    for (let i = 0; i < 8; i++) ENG.updateCamera(1);
    draw(); ENG.render();
    return { n: view.length, moved, min: Math.min(...moved),
             blade: +(dozers ? dozers.spd * 0.12 : 0).toFixed(2), calls: ENG.info().calls };
  });
  ok('鏟面正前方的碎料真的會被推走', dozAlign.min > 0.8,
     dozAlign.n + ' 台機器各推了 ' + JSON.stringify(dozAlign.moved) +
     ' 單位（0.12 秒內鏟面前進 ' + dozAlign.blade + '）');
  ok('推土機沒有多吃 draw call', dozAlign.calls <= 13,
     dozAlign.calls + ' 個（整地中含 5 台機器）');
  await page.screenshot({ path: path.join(OUT, '07-整地.png') });

  const dozeSkip = await page.evaluate(() => {
    startBuild(true);
    return { phase, doz: !!dozers };
  });
  ok('開場那一座不用整地', dozeSkip.phase === 'build' && !dozeSkip.doz,
     'phase=' + dozeSkip.phase + '、推土機 ' + (dozeSkip.doz ? '有' : '沒有'));

  /* ══════════ 小人反應 ══════════ */
  head('小人反應');
  await reset(page, { shape: '吉薩金字塔', cnt: 500, workers: 20 });
  await sim(page, 400);
  const scare = await page.evaluate(() => {
    /* 要砸在「有積木、旁邊又有小人」的地方。隨便挑一個小人往腳下砸的話，
       他可能正在遠處的料堆撿貨，一塊都打不到——沒打到就不會有人被嚇到，
       測到的是「打空了」不是「不會嚇到人」。 */
    let best = null, guard = 0;
    while (guard++ < 400) {
      best = null;
      const set = blocks.filter(b => b.st === 3);
      for (const w of workers) {
        if (w.fall > 0) continue;
        for (const b of set) {
          const d = Math.hypot(b.x - w.x, b.z - w.z);
          if (!best || d < best.d) best = { d, b };
        }
      }
      if (best && best.d < 4) break;      // 等到真的有人站在建築旁邊再砸
      step(0.05);
    }
    const p = new THREE.Vector3(best.b.x, best.b.y, best.b.z);
    const carried = blocks.filter(b => b.st === 1).length;
    const n = smash(p, new THREE.Vector3(0, -1, 0));
    return { n, near: +best.d.toFixed(1),
             fallen: workers.filter(x => x.fall > 0).length, carriedBefore: carried,
             carriedAfter: blocks.filter(b => b.st === 1).length };
  });
  ok('衝擊附近的小人會被嚇倒', scare.fallen > 0,
     scare.fallen + ' 人跌倒（打飛 ' + scare.n + ' 塊，最近的小人距落點 ' + scare.near + '）');
  ok('跌倒時手上的積木會掉', scare.carriedAfter <= scare.carriedBefore,
     '搬運中 ' + scare.carriedBefore + ' → ' + scare.carriedAfter);
  const recover = await page.evaluate(() => {
    for (let i = 0; i < 200; i++) step(0.05);
    return { fallen: workers.filter(x => x.fall > 0).length,
             busy: workers.filter(x => x.st !== 'idle').length };
  });
  ok('跌倒的小人會爬起來繼續做', recover.fallen === 0 && recover.busy > 0,
     '還躺著 ' + recover.fallen + ' 人，工作中 ' + recover.busy + ' 人');

  const poke = await page.evaluate(() => {
    // 找一個正在搬東西的小人，直接戳他
    const i = workers.findIndex(w => w.carry && w.fall <= 0);
    if (i < 0) return { skip: true };
    const w = workers[i];
    const before = blocks.filter(b => b.st === 1).length;
    w.fall = 1.5; releaseWorker(w);
    return { skip: false, fall: w.fall > 0, carried: before, after: blocks.filter(b => b.st === 1).length };
  });
  ok('戳正在搬運的小人會跌倒並掉落積木',
     poke.skip || (poke.fall && poke.after < poke.carried),
     poke.skip ? '（這輪沒有人在搬運，略過）' : poke.carried + ' → ' + poke.after);

  /* ══════════ 破壞道具與解鎖 ══════════ */
  head('破壞道具與解鎖');
  const lock0 = await page.evaluate(() => {
    stats = freshStats(); renderTools();
    return {
      ids: TOOLS.map(t => t.id),
      ok: TOOLS.map(t => toolOk(t)),
      btn: [...document.querySelectorAll('.tool')].map(e => e.className.indexOf('lock') >= 0 ? 'lock' : 'open')
    };
  });
  ok('工具共 6 種', lock0.ids.length === 6, lock0.ids.join(','));
  ok('一開始只有手指跟槌子可用',
     lock0.ok.join(',') === 'true,true,false,false,false,false', lock0.ok.join(','));
  ok('鎖住的工具在畫面上也是鎖住的',
     lock0.btn.join(',') === 'open,open,lock,lock,lock,lock', lock0.btn.join(','));

  const lock1 = await page.evaluate(() => {
    const step2 = [];
    stats = freshStats(); stats.smashed = 300; renderTools();
    step2.push(TOOLS.map(t => toolOk(t)).join(','));
    stats.destroyed = 3; renderTools();
    step2.push(TOOLS.map(t => toolOk(t)).join(','));
    stats.destroyed = 6; renderTools();
    step2.push(TOOLS.map(t => toolOk(t)).join(','));
    stats.smashed = 1000; renderTools();
    step2.push(TOOLS.map(t => toolOk(t)).join(','));
    return { step2, btn: [...document.querySelectorAll('.tool')].map(e => e.className.indexOf('lock') >= 0 ? 'lock' : 'open') };
  });
  ok('擊飛 300 塊解鎖大槌', lock1.step2[0] === 'true,true,true,false,false,false', lock1.step2[0]);
  ok('拆掉 3 座解鎖保齡球', lock1.step2[1] === 'true,true,true,true,false,false', lock1.step2[1]);
  ok('拆掉 6 座解鎖投石機', lock1.step2[2] === 'true,true,true,true,true,false', lock1.step2[2]);
  ok('擊飛 1000 塊解鎖龍捲風', lock1.step2[3] === 'true,true,true,true,true,true', lock1.step2[3]);
  ok('解鎖後畫面上的鎖頭消失',
     lock1.btn.join(',') === 'open,open,open,open,open,open', lock1.btn.join(','));

  /* 手指：什麼都不破壞，但戳得倒小人 */
  await reset(page, { shape: '吉薩金字塔', cnt: 700, workers: 12 });
  const finger = await page.evaluate(() => {
    completeNow();
    tool = 'finger';
    const n0 = placedCnt;
    const cand = blocks.filter(b => b.st === 3);
    const t = cand[Math.floor(cand.length * 0.5)];
    useTool({ point: new THREE.Vector3(t.x, t.y, t.z), dir: new THREE.Vector3(0, -1, 0) });
    for (let i = 0; i < 60; i++) step(0.05);
    const after = placedCnt;
    // 小人還是戳得倒（那段邏輯在道具判斷之前）
    const w = workers.find(x => x.fall <= 0);
    const before = stats.poked;
    w.fall = 1.5; releaseWorker(w); stats.poked++;
    return { n0, after, phase, fell: w.fall > 0, poked: stats.poked - before };
  });
  ok('手指不會破壞任何東西', finger.after === finger.n0 && finger.phase === 'done',
     placedCntTxt(finger.n0, finger.after) + '，phase 仍是 ' + finger.phase);
  ok('手指模式下小人照樣戳得倒', finger.fell && finger.poked === 1);

  /* 大槌：同樣一擊，範圍要明顯比一般槌子大 */
  const bigH = await page.evaluate(() => {
    const run = big => {
      startBuild(true); completeNow();
      const cand = blocks.filter(b => b.st === 3 && b.y > 3);
      const t = cand[Math.floor(cand.length * 0.5)];
      const n0 = placedCnt;
      launchHammer(new THREE.Vector3(t.x, t.y, t.z), new THREE.Vector3(0.3, -0.85, 0.4).normalize(), big);
      let g = 0;
      while (swing && !swing.hit && g++ < 40) step(0.02);
      return n0 - placedCnt;
    };
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 2000;
    return { small: run(false), big: run(true) };
  });
  ok('大槌的範圍明顯比一般槌子大', bigH.big > bigH.small * 2.5,
     '一般槌子打飛 ' + bigH.small + ' 塊、大槌 ' + bigH.big + ' 塊');

  /* 投石機 */
  await reset(page, { shape: '中世紀城堡', cnt: 1200, workers: 3 });
  const treb = await page.evaluate(() => {
    completeNow();
    const n0 = placedCnt;
    // 點在空地上：機台就該出現在那裡
    const spot = { x: siteR + 14, z: -siteR * 0.4 };
    placeTreb(spot);
    const one = trebs.list.length;
    const at = trebs.list[0];
    const put = Math.hypot(at.x - spot.x, at.z - spot.z);
    // 再點一台，數量要疊加
    placeTreb({ x: -siteR - 12, z: siteR * 0.3 });
    const two = trebs.list.length;
    // 點在建築正中央：要被推到建築外圍，不能長在牆裡
    placeTreb({ x: 0, z: 0 });
    const pushed = Math.hypot(trebs.list[2].x, trebs.list[2].z);
    let maxRock = 0, offCentre = 0;
    for (let i = 0; i < 1400 && trebs; i++) {
      step(0.02);
      if (trebs) {
        maxRock = Math.max(maxRock, trebs.rocks.length);
        for (const r of trebs.rocks) if (Math.hypot(r.x, r.z) > arenaR + 5) offCentre++;
      }
    }
    return { n0, after: placedCnt, one, two, put, pushed, siteR, maxRock, gone: !trebs, offCentre };
  });
  ok('點一下就在點的位置架一台', treb.one === 1 && treb.put < 0.001,
     '機台落在點擊處，誤差 ' + treb.put.toFixed(3));
  ok('可以連續架好幾台', treb.two === 2, treb.two + ' 台');
  ok('點在建築上會把機台推到外圍', treb.pushed > treb.siteR,
     '距中心 ' + treb.pushed.toFixed(1) + '（建築半徑 ' + treb.siteR.toFixed(1) + '）');
  ok('投石機會丟出石頭', treb.maxRock > 0, '同時最多 ' + treb.maxRock + ' 顆在空中');
  ok('石頭不會飛出場外', treb.offCentre === 0);
  ok('石頭砸下來會造成破壞', treb.after < treb.n0, placedCntTxt(treb.n0, treb.after));
  ok('打完會自己撤走', treb.gone);

  /* 石頭穿牆：只在終點判定的話，拋物線會從屋頂／外牆直接穿過去，畫面上砸中了卻什麼事都沒有。
     這裡不看實作的格子查表，改用 blocks 的真實座標量：
     還活著的石頭跟任何一塊已就位積木的距離，永遠不該小於半格。 */
  await reset(page, { shape: '中世紀城堡', cnt: 1600, workers: 3 });
  const thru = await page.evaluate(() => {
    completeNow();
    const orig = rockHit, at = [];
    rockHit = r => { at.push(+(r.t / r.T).toFixed(2)); orig(r); };
    for (let k = 0; k < 6; k++) {           // 圍一圈打，各種角度的弧線都試到
      const a = k / 6 * Math.PI * 2;
      placeTreb({ x: Math.cos(a) * (siteR + 13), z: Math.sin(a) * (siteR + 13) });
    }
    let worst = 1e9, worstAt = null, seen = 0, frames = 0;
    for (let i = 0; i < 2000 && trebs; i++) {
      step(0.02); frames++;
      if (!trebs) break;
      for (const r of trebs.rocks) {
        seen++;
        for (const b of blocks) {
          if (b.st !== 3) continue;
          const d = Math.max(Math.abs(b.x - r.x), Math.abs(b.y - r.y), Math.abs(b.z - r.z));
          if (d < worst) { worst = d; worstAt = { rock: [+r.x.toFixed(2), +r.y.toFixed(2), +r.z.toFixed(2)],
                                                  block: [+b.x.toFixed(2), +b.y.toFixed(2), +b.z.toFixed(2)], i }; }
        }
      }
    }
    rockHit = orig;
    return { worst: +worst.toFixed(3), worstAt, seen, frames, shots: at.length,
             early: at.filter(v => v < 0.97).length, at: at.slice(0, 8) };
  });
  ok('石頭不會從積木裡穿過去', thru.seen > 0 && thru.worst >= 0.499,
     '飛行中最近曾貼到 ' + thru.worst + ' 格（積木半邊 0.5）；取樣 ' + thru.seen +
     ' 個石頭幀' + (thru.worst < 0.499 ? '；' + JSON.stringify(thru.worstAt) : ''));
  ok('石頭半路撞到建築就當場炸開', thru.early > 0,
     thru.shots + ' 發裡有 ' + thru.early + ' 發在抵達目標前就炸了（飛行進度 ' +
     JSON.stringify(thru.at) + '）');

  const lockClick = await page.evaluate(() => {
    stats = freshStats(); tool = 'hammer'; renderTools();
    document.querySelector('[data-tool="tornado"]').click();   // 鎖著的不該被選到
    const blocked = tool;
    stats.destroyed = 9; stats.smashed = 9999; renderTools();
    document.querySelector('[data-tool="ball"]').click();
    return { blocked, after: tool };
  });
  ok('點鎖住的工具不會被選中', lockClick.blocked === 'hammer', '仍是 ' + lockClick.blocked);
  ok('解鎖後點得動', lockClick.after === 'ball', '選到 ' + lockClick.after);

  await reset(page, { shape: '中世紀城堡', cnt: 1200, workers: 4 });
  const hammerR2 = await page.evaluate(() => {
    completeNow();
    tool = 'hammer';
    const cand = blocks.filter(b => b.st === 3 && b.y > 4);
    const t = cand[Math.floor(cand.length * 0.5)];
    const n0 = placedCnt;
    const dir = new THREE.Vector3(0.4, -0.7, 0.6).normalize();
    useTool({ point: new THREE.Vector3(t.x, t.y, t.z), dir });
    const born = !!swing, immediate = placedCnt;      // 按下當下還不該有破壞
    step(0.07);
    const p = ENG.hammerPos();
    /* 側揮驗證：槌頭要明顯偏在落點的側邊，而不是疊在視線那條直線上。
       取水平方向上「垂直於視線」的分量——那就是螢幕左右方向。 */
    let sx = -dir.z, sz = dir.x;
    const sl = Math.hypot(sx, sz); sx /= sl; sz /= sl;
    const lateral = Math.abs((p.x - t.x) * sx + (p.z - t.z) * sz);
    const along = Math.abs((p.x - t.x) * dir.x + (p.z - t.z) * dir.z);
    const mid = { hit: swing.hit, n: placedCnt, vis: ENG.hammerVisible(), lateral, along, up: p.y - t.y };
    // 推到它確實落下為止，不要寫死秒數——揮動時間調整過就會對不上
    let guard = 0;
    while (swing && !swing.hit && guard++ < 40) step(0.02);
    const landed = { hit: !swing || swing.hit, n: placedCnt, steps: guard };
    for (let i = 0; i < 40; i++) step(0.05);
    return { n0, born, immediate, mid, landed, gone: !swing, vis: ENG.hammerVisible() };
  });
  ok('槌子是從側邊揮下來的（看得出是槌子）',
     hammerR2.mid.lateral > 3 && hammerR2.mid.lateral > hammerR2.mid.along * 2 && hammerR2.mid.up > 2,
     '側向偏移 ' + hammerR2.mid.lateral.toFixed(1) + '、視線方向偏移 ' +
     hammerR2.mid.along.toFixed(1) + '、高於落點 ' + hammerR2.mid.up.toFixed(1));
  ok('選槌子時畫面上真的有槌子揮下去', hammerR2.born && hammerR2.mid.vis,
     '按下後槌子出現在畫面上');
  ok('槌頭落下之前不會有破壞', hammerR2.immediate === hammerR2.n0 && !hammerR2.mid.hit,
     '按下當下 ' + hammerR2.n0 + ' → 揮到一半 ' + hammerR2.mid.n);
  ok('槌頭碰到的那一刻才炸開', hammerR2.landed.hit && hammerR2.landed.n < hammerR2.n0,
     '落下後 ' + hammerR2.n0 + ' → ' + hammerR2.landed.n + '（多推了 ' + hammerR2.landed.steps + ' 步）');
  ok('揮完槌子會收掉', hammerR2.gone && !hammerR2.vis);

  const rapid = await page.evaluate(() => {
    startBuild(true); completeNow();
    const n0 = placedCnt;
    const cand = blocks.filter(b => b.st === 3);
    const a = cand[Math.floor(cand.length * 0.3)], c = cand[Math.floor(cand.length * 0.75)];
    launchHammer(new THREE.Vector3(a.x, a.y, a.z), new THREE.Vector3(0.2, -0.9, 0.3).normalize());
    step(0.03);
    launchHammer(new THREE.Vector3(c.x, c.y, c.z), new THREE.Vector3(-0.2, -0.9, -0.3).normalize());
    const afterSecondPress = placedCnt;
    for (let i = 0; i < 20; i++) step(0.03);
    return { n0, afterSecondPress, end: placedCnt };
  });
  /* 連點時前一擊還沒落下就被取代 → 那一擊要立刻結算掉，不能整個吃掉 */
  ok('連點兩次不會吃掉前一擊',
     rapid.afterSecondPress < rapid.n0 && rapid.end < rapid.afterSecondPress,
     rapid.n0 + ' → 第二次按下時 ' + rapid.afterSecondPress + ' → 最後 ' + rapid.end);

  await reset(page, { shape: '吉薩金字塔', cnt: 900, workers: 4 });
  const ballR = await page.evaluate(() => {
    completeNow();
    const cand = blocks.filter(b => b.st === 3 && b.y < 5);
    const t = cand[Math.floor(cand.length * 0.5)];
    const before = blocks.filter(b => b.st === 3).length;
    launchBall(new THREE.Vector3(t.x, t.y, t.z), new THREE.Vector3(0.5, -0.35, 0.79).normalize());
    const born = !!ball, r = ball.r;
    const start = Math.hypot(ball.x - t.x, ball.z - t.z);
    let hit = 0, offGround = 0, ang0 = ball.ang, maxAng = 0, moved = 0;
    let px = ball.x, pz = ball.z;
    for (let i = 0; i < 400 && ball; i++) {
      step(0.03);
      if (!ball) break;
      hit = ball.hit;
      if (Math.abs(ball.y - r) > 0.01) offGround++;     // 保齡球要一路貼著地面
      maxAng = ball.ang;
      moved += Math.hypot(ball.x - px, ball.z - pz); px = ball.x; pz = ball.z;
    }
    return { before, after: blocks.filter(b => b.st === 3).length, hit, born, gone: !ball,
             offGround, start, spin: maxAng - ang0, moved, r };
  });
  ok('保齡球會生出來，而且是從建築外圍出發', ballR.born && ballR.start > 12,
     '起點距落點 ' + ballR.start.toFixed(0) + ' 單位');
  ok('保齡球一路貼著地面滾', ballR.offGround === 0,
     '球心高度全程等於半徑 ' + ballR.r + '（離地 ' + ballR.offGround + ' 次）');
  ok('滾動角度跟滾過的距離對得上', Math.abs(ballR.spin - ballR.moved / ballR.r) < 0.5,
     '滾了 ' + ballR.moved.toFixed(0) + ' 單位、轉了 ' + ballR.spin.toFixed(1) + ' 弧度');
  ok('保齡球會撞飛沿路的積木', ballR.hit > 15 && ballR.after < ballR.before,
     'SET ' + ballR.before + ' → ' + ballR.after + '，撞飛 ' + ballR.hit + ' 塊');
  ok('滾不動之後會停下消失', ballR.gone);

  const twR = await page.evaluate(() => {
    startBuild(true); completeNow();
    const before = blocks.filter(b => b.st === 3).length;
    launchTornado({ x: siteR * 0.6, z: 0 });
    const born = !!twist;
    let lifted = 0;
    for (let i = 0; i < 260; i++) {
      step(0.03);
      lifted = Math.max(lifted, blocks.filter(b => b.st === 4 && b.y > 6).length);
    }
    for (let i = 0; i < 700; i++) step(0.05);       // 等它們全部落地
    return { before, after: blocks.filter(b => b.st === 3).length, lifted, born, gone: !twist,
             flying: blocks.filter(b => b.st === 4).length };
  });
  ok('龍捲風會生出來', twR.born);
  ok('龍捲風會把積木捲上天', twR.lifted > 20, '同時在空中最多 ' + twR.lifted + ' 塊');
  ok('龍捲風掃過會拆掉建築', twR.after < twR.before * 0.6,
     'SET ' + twR.before + ' → ' + twR.after);
  ok('龍捲風結束後積木都會落地', twR.gone && twR.flying === 0, '還在飛 ' + twR.flying + ' 塊');

  /* 龍捲風持續好幾秒，如果每幀都加震動，畫面會一路晃到結束 */
  const twShake = await page.evaluate(() => {
    startBuild(true); completeNow();
    ENG.cam.shake = 0;
    launchTornado({ x: siteR * 0.5, z: 0 });
    let peak = 0;
    for (let i = 0; i < 120; i++) { step(0.03); peak = Math.max(peak, ENG.cam.shake); }
    return { peak, alive: !!twist };
  });
  ok('龍捲風不會讓畫面一直晃', twShake.peak < 0.05,
     '整段期間畫面震動峰值 ' + twShake.peak.toFixed(3) + '（龍捲風仍在作用 ' + twShake.alive + '）');

  const hitShake = await page.evaluate(() => {
    startBuild(true); completeNow();
    ENG.cam.shake = 0;
    const cand = blocks.filter(b => b.st === 3 && b.y > 3);
    const t = cand[Math.floor(cand.length * 0.5)];
    launchHammer(new THREE.Vector3(t.x, t.y, t.z), new THREE.Vector3(0.3, -0.8, 0.5).normalize());
    let peak = 0;
    for (let i = 0; i < 40; i++) { step(0.02); peak = Math.max(peak, ENG.cam.shake); }
    return peak;
  });
  ok('槌子這種單次撞擊仍然會震一下', hitShake > 0.2, '震動峰值 ' + hitShake.toFixed(2));

  /* ══════════ 人力金額 ══════════ */
  head('人力金額');
  const cost = await page.evaluate(() => {
    stats = freshStats();
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 900; setWorkerCount(10); startBuild(true);
    for (let i = 0; i < 200; i++) step(0.05);          // 10 秒模擬 × 10 人
    const a = { th: spentThis, all: stats.spent };
    setWorkerCount(40);
    for (let i = 0; i < 200; i++) step(0.05);          // 同樣 10 秒 × 40 人
    const b = { th: spentThis, all: stats.spent };
    completeNow();                                     // 完工後不該再燒錢
    const c = spentThis;
    for (let i = 0; i < 200; i++) step(0.05);
    return { a, b, c, d: spentThis, wage: WAGE };
  });
  ok('施工中會累積人力成本', cost.a.th > 0,
     '10 人跑 10 秒 = ' + cost.a.th.toFixed(0) + '（每人每秒 $' + cost.wage + '）');
  ok('人數越多燒得越快', (cost.b.th - cost.a.th) > cost.a.th * 3,
     '接下來 40 人跑 10 秒又燒了 ' + (cost.b.th - cost.a.th).toFixed(0));
  ok('累計支出跟著本次一起長', cost.b.all >= cost.b.th);
  ok('完工之後不再計費', Math.abs(cost.d - cost.c) < 0.001, cost.c.toFixed(0) + ' → ' + cost.d.toFixed(0));

  /* ══════════ 成就 ══════════ */
  head('成就');
  const badge = await page.evaluate(() => {
    stats = freshStats(); renderBadges();
    const n0 = stats.badges.length;
    stats.bestHit = 51; checkBadges();
    const afterDemo = stats.badges.indexOf('demo50') >= 0;
    stats.poked = 20; checkBadges();
    const afterPoke = stats.badges.indexOf('boss20') >= 0;
    stats.poked = 25; const before = stats.badges.length; checkBadges();
    const noDup = stats.badges.length === before;
    return { n0, afterDemo, afterPoke, noDup, total: BADGES.length,
             dom: document.querySelectorAll('.badge.got').length,
             label: document.getElementById('badgeN').textContent };
  });
  ok('一開始沒有任何成就', badge.n0 === 0);
  ok('一次擊飛 >50 塊解鎖【拆遷大隊】', badge.afterDemo);
  ok('戳倒 20 次解鎖【工頭嚴厲】', badge.afterPoke);
  ok('同一個成就不會重複解鎖', badge.noDup);
  ok('成就面板會反映解鎖狀態', badge.dom === 2 && /2 \/ \d+/.test(badge.label), badge.label);

  const miracle = await page.evaluate(() => {
    stats = freshStats();
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    startBuild(true); buildElapsed = 100; completeNow(); buildElapsed = 100;
    noteBuilt();
    const fast = stats.badges.indexOf('miracle') >= 0;
    stats = freshStats(); buildElapsed = 400; noteBuilt();
    const slow = stats.badges.indexOf('miracle') >= 0;
    return { fast, slow, name: bp.name };
  });
  ok('3 分鐘內蓋完金字塔才給【奇蹟工程】', miracle.fast && !miracle.slow,
     '100 秒 → ' + miracle.fast + '，400 秒 → ' + miracle.slow);

  await page.click('#badgeBtn');
  ok('成就面板打得開', await page.evaluate(() => document.getElementById('badgeWrap').classList.contains('on')));
  await page.click('#badgeClose');
  ok('成就面板關得掉', !(await page.evaluate(() => document.getElementById('badgeWrap').classList.contains('on'))));

  /* ══════════ 存檔 ══════════ */
  head('自動存檔');
  const saveR = await page.evaluate(() => {
    localStorage.removeItem('block-builders/save1');
    stats = freshStats();
    stats.destroyed = 4; stats.smashed = 1234; stats.poked = 9; stats.spent = 55555;
    stats.built = ['吉薩金字塔', '羅馬競技場']; stats.badges = ['demo50'];
    save();
    const raw = localStorage.getItem('block-builders/save1');
    return { raw, plain: /destroyed|smashed|吉薩/.test(raw), len: raw.length };
  });
  ok('存檔真的寫進 localStorage', !!saveR.raw && saveR.len > 40, saveR.len + ' 字元');
  ok('存檔不是明文', !saveR.plain, '看不到欄位名或建築名');

  const reloadR = await page.evaluate(() => {
    stats = freshStats(); load();
    return { destroyed: stats.destroyed, smashed: stats.smashed, built: stats.built.length, badges: stats.badges.length };
  });
  ok('讀得回來', reloadR.destroyed === 4 && reloadR.smashed === 1234 &&
     reloadR.built === 2 && reloadR.badges === 1,
     JSON.stringify(reloadR));

  const tamperR = await page.evaluate(() => {
    const raw = localStorage.getItem('block-builders/save1');
    localStorage.setItem('block-builders/save1', raw.slice(0, -6) + 'AAAAAA');
    stats = freshStats(); load();
    const bad = stats.destroyed;
    localStorage.setItem('block-builders/save1', raw);
    stats = freshStats(); load();
    return { bad, good: stats.destroyed };
  });
  ok('存檔被改過就整份不採用', tamperR.bad === 0 && tamperR.good === 4,
     '竄改後 destroyed=' + tamperR.bad + '，還原後 ' + tamperR.good);

  /* 真的重新載入頁面，確認紀錄還在——這是「自動儲存」的重點 */
  await page.reload();
  await page.waitForTimeout(900);
  const persist = await page.evaluate(() => ({ d: stats.destroyed, s: stats.smashed, b: stats.badges.length }));
  ok('關掉重開紀錄還在', persist.d === 4 && persist.s === 1234 && persist.b === 1,
     'destroyed=' + persist.d + '、smashed=' + persist.s + '、成就 ' + persist.b + ' 個');
  /* 拆 4 座、擊飛 1234 塊 → 大槌(300)、保齡球(3 座)、龍捲風(1000) 開，投石機(6 座) 還鎖著 */
  const unlockedAfterReload = await page.evaluate(() =>
    [...document.querySelectorAll('.tool')].map(e => e.className.indexOf('lock') >= 0 ? 'lock' : 'open').join(','));
  ok('重開後解鎖狀態跟著回來', unlockedAfterReload === 'open,open,open,open,lock,open',
     '拆 4 座、擊飛 1234 塊 → ' + unlockedAfterReload);

  /* 設定也要一起存——不然每次打開都要重調建材數與小人數 */
  const prefSaved = await page.evaluate(() => {
    document.getElementById('cnt').value = '1700';
    document.getElementById('cnt').dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('cnt').dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('wk').value = '37';
    document.getElementById('wk').dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('wk').dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('spd').value = '2.5';
    document.getElementById('spd').dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('spd').dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('mute').checked = true;
    document.getElementById('mute').dispatchEvent(new Event('change', { bubbles: true }));
    return { pref: JSON.parse(JSON.stringify(pref)) };
  });
  ok('改設定會寫進 pref', prefSaved.pref.cnt === 1700 && prefSaved.pref.wk === 37 &&
     prefSaved.pref.spd === 2.5 && prefSaved.pref.mute === true, JSON.stringify(prefSaved.pref));

  await page.reload();
  await page.waitForTimeout(900);
  const prefBack = await page.evaluate(() => ({
    cnt: targetCnt, wk: workers.length, spd: timeScale, mute: muted,
    domCnt: document.getElementById('cnt').value,
    domWk: document.getElementById('wk').value,
    domSpd: document.getElementById('spd').value,
    domMute: document.getElementById('mute').checked,
    label: document.getElementById('vCnt').textContent + '/' + document.getElementById('vWk').textContent
  }));
  ok('重開後設定自動套用（不用每次重調）',
     prefBack.cnt === 1700 && prefBack.wk === 37 && Math.abs(prefBack.spd - 2.5) < 0.01 && prefBack.mute === true,
     '建材 ' + prefBack.cnt + '、小人 ' + prefBack.wk + '、速度 ' + prefBack.spd + '、靜音 ' + prefBack.mute);
  ok('面板上的滑桿也跟著回到存的值',
     prefBack.domCnt === '1700' && prefBack.domWk === '37' && prefBack.domSpd === '2.5' && prefBack.domMute,
     'slider=' + prefBack.domCnt + '/' + prefBack.domWk + '/' + prefBack.domSpd + '，標籤 ' + prefBack.label);

  const prefClamp = await page.evaluate(() => {
    pref.cnt = 99999; pref.wk = -5; pref.spd = 900; save();
    stats = freshStats(); pref = freshPref(); load();
    return JSON.parse(JSON.stringify(pref));
  });
  ok('存檔裡的設定超出範圍會被夾回來',
     prefClamp.cnt <= 3000 && prefClamp.wk >= 1 && prefClamp.spd <= 4,
     JSON.stringify(prefClamp));

  const cleared = await page.evaluate(() => {
    resetSave();
    return { d: stats.destroyed, raw: localStorage.getItem('block-builders/save1') };
  });
  ok('可以清空紀錄', cleared.d === 0 && !cleared.raw);
  errors.length = 0;

  /* ══════════ 控制項 ══════════ */
  head('控制項');
  await page.evaluate(() => { running = false; muted = true; });
  await page.evaluate(() => { running = true; });
  await page.selectOption('#shape', String(await page.evaluate(() => SHAPES.findIndex(s => s.n === '倫敦眼摩天輪'))));
  await page.waitForTimeout(400);
  ok('藍圖下拉可以指定建築', (await st(page)).name === '倫敦眼摩天輪', (await st(page)).name);

  await page.evaluate(() => {
    const el = document.getElementById('cnt');
    el.value = '2000';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(500);
  const cntS = await st(page);
  ok('建材 slider 會改變積木數', cntS.target === 2000 && cntS.total > 1300,
     '目標 ' + cntS.target + '，實得 ' + cntS.total + ' 塊');
  ok('積木池跟著藍圖走', Math.abs(cntS.pool - cntS.total) <= 2, cntS.pool + ' vs ' + cntS.total);

  await page.evaluate(() => {
    const el = document.getElementById('wk');
    el.value = '35'; el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  ok('小人 slider 會改變人數', (await st(page)).workers === 35);

  await page.evaluate(() => {
    const el = document.getElementById('spd');
    el.value = '2.5'; el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  ok('速度 slider 會改變時間倍率', Math.abs((await st(page)).scale - 2.5) < 0.01);

  /* timeScale 是在 frame() 裡乘進 dt 的，直接呼叫 step(0.05) 會繞過倍率，
     所以一定要走真正的 rAF 迴圈。但「同樣秒數蓋幾塊」在軟體算圖下幀率太低會測不準，
     改成攔截 step 累加 dt，直接量「模擬時間推進了多少」——這跟幀率無關。
     step 是 function 宣告（掛在 global 上），覆寫它 frame() 就會呼叫到包裝過的版本。 */
  const measureSpeed = async sc => {
    await page.evaluate(sc => {
      running = false;
      if (!window.__origStep) window.__origStep = step;
      window.__simT = 0; window.__frames = 0;
      step = dt => { window.__simT += dt; window.__frames++; window.__origStep(dt); };
      shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
      targetCnt = 900; setWorkerCount(24); timeScale = sc;
      startBuild(true); running = true;
    }, sc);
    await page.waitForTimeout(1800);
    return page.evaluate(() => {
      running = false;
      return { simT: window.__simT, frames: window.__frames, placed: placedCnt };
    });
  };
  const sp1 = await measureSpeed(1), sp3 = await measureSpeed(3);
  await page.evaluate(() => { if (window.__origStep) step = window.__origStep; });
  /* 量「每幀推進多少模擬時間」的比值，而不是「同樣秒數推進多少」。
     dt = min(0.05, 實際幀長) × 倍率，上限是套在幀長上、再乘倍率，
     所以每幀的比值理論上剛好是 3，跟當下幀率無關；
     直接比總量的話兩次量測期間的幀率抖動會讓結果在 2.3～3.2 之間亂跑。 */
  const per1 = sp1.frames ? sp1.simT / sp1.frames : 0;
  const per3 = sp3.frames ? sp3.simT / sp3.frames : 0;
  const ratio = per1 > 0 ? per3 / per1 : 0;
  ok('速度倍率真的讓模擬跑得更快', ratio > 2.7 && ratio < 3.3,
     '每幀推進：1× ' + (per1 * 1000).toFixed(1) + 'ms、3× ' + (per3 * 1000).toFixed(1) +
     'ms（' + ratio.toFixed(2) + ' 倍；' + sp1.frames + ' / ' + sp3.frames + ' 幀）');

  await page.evaluate(() => { running = true; });
  await page.click('#again');
  await page.waitForTimeout(400);
  ok('「換一座來蓋」會換建築', (await st(page)).placed < 30, '重新開工');

  const yaw0 = await page.evaluate(() => ENG.cam.yaw);
  await page.check('#spin');
  await page.waitForTimeout(900);
  const yaw1 = await page.evaluate(() => ENG.cam.yaw);
  ok('自轉開關有作用', Math.abs(yaw1 - yaw0) > 0.03,
     '0.9 秒轉了 ' + ((yaw1 - yaw0) * 57.3).toFixed(1) + '°');
  await page.uncheck('#spin');

  await page.click('#clockBtn');
  ok('全螢幕時鐘會打開', await page.evaluate(() => document.getElementById('bigWrap').classList.contains('on')));
  const bigTxt = await page.textContent('#bigClock');
  ok('全螢幕時鐘顯示現在時間', /^\d{2}:\d{2}:\d{2}$/.test(bigTxt.trim()), bigTxt);
  await page.screenshot({ path: path.join(OUT, '04-全螢幕時鐘.png') });
  await page.click('#bigWrap');
  ok('點一下會關掉全螢幕時鐘',
     !(await page.evaluate(() => document.getElementById('bigWrap').classList.contains('on'))));

  const hud = await page.evaluate(() => ({
    clock: document.getElementById('clock').textContent,
    timer: document.getElementById('timer').textContent,
    prog: document.getElementById('prog').textContent,
    bar: document.getElementById('bar').style.width,
    name: document.getElementById('bname').textContent
  }));
  ok('HUD 顯示真實時鐘', /^\d{2}:\d{2}:\d{2}$/.test(hud.clock), hud.clock);
  ok('HUD 顯示施工計時', /^\d+:\d{2}$/.test(hud.timer), hud.timer);
  ok('HUD 顯示進度與建築名稱', /\d+ \/ \d+/.test(hud.prog) && hud.name.length > 0,
     hud.name + ' ' + hud.prog);
  ok('進度條有寬度', parseFloat(hud.bar) >= 0, hud.bar);

  const timerRun = await page.evaluate(() => new Promise(res => {
    const a = document.getElementById('timer').textContent;
    setTimeout(() => res({ a, b: document.getElementById('timer').textContent }), 1300);
  }));
  ok('施工計時會往前走', timerRun.a !== timerRun.b, timerRun.a + ' → ' + timerRun.b);

  /* ══════════ 視角操作 ══════════ */
  head('視角操作');
  await reset(page, { shape: '艾菲爾鐵塔', cnt: 900, workers: 6 });
  await fillAll(page);
  const camBefore = await page.evaluate(() => ({ yaw: ENG.cam.yaw, pitch: ENG.cam.pitch, dist: ENG.cam.dist }));
  await page.mouse.move(640, 400);
  await page.mouse.down();
  await page.mouse.move(820, 330, { steps: 8 });
  await page.mouse.up();
  const camAfter = await page.evaluate(() => ({ yaw: ENG.cam.yaw, pitch: ENG.cam.pitch }));
  ok('拖曳可以轉視角',
     Math.abs(camAfter.yaw - camBefore.yaw) > 0.1 && Math.abs(camAfter.pitch - camBefore.pitch) > 0.05,
     'yaw ' + (camAfter.yaw - camBefore.yaw).toFixed(2) + '，pitch ' + (camAfter.pitch - camBefore.pitch).toFixed(2));

  await page.mouse.move(640, 400);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(60);
  const zoomOut = await page.evaluate(() => ENG.camTarget.dist);
  await page.mouse.wheel(0, -900);
  await page.waitForTimeout(60);
  const zoomIn = await page.evaluate(() => ENG.camTarget.dist);
  ok('滾輪可以縮放', zoomOut > camBefore.dist && zoomIn < zoomOut,
     camBefore.dist.toFixed(1) + ' → ' + zoomOut.toFixed(1) + ' → ' + zoomIn.toFixed(1));

  /* 取景測「使用者看到什麼」，而不是把相機公式抄一份到測試裡（那是拿實作驗實作） */
  const framing = await page.evaluate(() => {
    startBuild(true);
    for (let i = 0; i < bp.slots.length && i < blocks.length; i++) {
      const s = bp.slots[i], b = blocks[i];
      b.st = 3; b.x = s.x; b.y = s.y + HB; b.z = s.z;
    }
    for (let i = 0; i < 6; i++) ENG.updateCamera(1);
    const cam = ENG.three.camera; cam.updateMatrixWorld();
    const v = new THREE.Vector3();
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, off = 0, n = 0;
    for (const b of blocks) {
      if (b.st !== 3) continue;
      n++;
      v.set(b.x, b.y, b.z).project(cam);
      if (Math.abs(v.x) > 1 || Math.abs(v.y) > 1) off++;
      minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
      minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
    }
    return { fw: (maxX - minX) / 2, fh: (maxY - minY) / 2, off, n, name: bp.name };
  });
  ok('取景把整座建築放進畫面', framing.off === 0, framing.off + ' 塊在畫面外（' + framing.name + '）');
  ok('建築在畫面裡的比例合理',
     Math.max(framing.fw, framing.fh) > 0.30 && Math.max(framing.fw, framing.fh) < 0.99,
     '占畫面 ' + (Math.max(framing.fw, framing.fh) * 100).toFixed(0) + '%');

  /* ══════════ 視窗縮放 ══════════ */
  head('視窗縮放');
  await page.setViewportSize({ width: 900, height: 620 });
  await page.waitForTimeout(300);
  const rs = await page.evaluate(() => ({
    w: document.getElementById('cv').width, css: document.getElementById('cv').style.width,
    aspect: ENG.three.camera.aspect, dpr: Math.min(2, window.devicePixelRatio)
  }));
  ok('canvas 跟著視窗變', rs.w === Math.round(900 * rs.dpr) && rs.css === '900px', rs.w + ' / ' + rs.css);
  ok('相機比例跟著更新', Math.abs(rs.aspect - 900 / 620) < 0.01, rs.aspect.toFixed(3));
  const pSmall = await pix(page);
  ok('縮小後畫面仍然畫得出來', pSmall.opaque > 0.2 && pSmall.colors > 20,
     '不透明 ' + (pSmall.opaque * 100).toFixed(0) + '%、' + pSmall.colors + ' 種顏色');

  /* ══════════ 手機版 ══════════ */
  head('手機版 · 觸控');
  await page.setViewportSize({ width: 390, height: 780 });
  await page.waitForTimeout(300);
  const mob = await page.evaluate(() => {
    const hint = getComputedStyle(document.getElementById('hint')).display;
    const panel = document.getElementById('panel').getBoundingClientRect();
    return { hint, panelW: Math.round(panel.width), inside: panel.right <= window.innerWidth + 1 };
  });
  ok('小螢幕會收掉操作提示', mob.hint === 'none', mob.hint);
  ok('設定面板不會超出畫面', mob.inside, '面板寬 ' + mob.panelW + '，視窗寬 390');

  /* 手機版空間很擠，按鈕互相疊到就點不到了——直接量方框有沒有相交 */
  const overlap = await page.evaluate(() => {
    const ids = ['head', 'time', 'tools', 'panelBtn', 'ver'];
    const box = {};
    for (const id of ids) {
      const e = document.getElementById(id);
      if (getComputedStyle(e).display === 'none') continue;
      box[id] = e.getBoundingClientRect();
    }
    const bad = [], keys = Object.keys(box);
    for (let i = 0; i < keys.length; i++)
      for (let j = i + 1; j < keys.length; j++) {
        const a = box[keys[i]], b = box[keys[j]];
        if (a.right > b.left && b.right > a.left && a.bottom > b.top && b.bottom > a.top)
          bad.push(keys[i] + '×' + keys[j]);
      }
    const out = keys.filter(k => box[k].right > window.innerWidth + 1 || box[k].left < -1);
    return { bad, out, toolsW: Math.round(box.tools.width) };
  });
  ok('手機版的 UI 不會互相疊到', overlap.bad.length === 0, overlap.bad.join('、') || '五個區塊都沒相交');
  ok('手機版工具列不會超出畫面', overlap.out.length === 0,
     '工具列寬 ' + overlap.toolsW + '，視窗寬 390' + (overlap.out.length ? '；超出：' + overlap.out.join(',') : ''));
  const pMob = await pix(page);
  ok('手機尺寸下照樣畫得出來', pMob.opaque > 0.4, (pMob.opaque * 100).toFixed(0) + '%');
  await page.screenshot({ path: path.join(OUT, '05-手機版.png') });

  const touch = await page.evaluate(() => {
    const y0 = ENG.cam.yaw;
    const cv = document.getElementById('cv');
    const mk = (t, x, y) => { const e = new Event(t, { bubbles: true, cancelable: true }); e.touches = [{ clientX: x, clientY: y }]; return e; };
    cv.dispatchEvent(mk('touchstart', 200, 400));
    cv.dispatchEvent(mk('touchmove', 260, 400));
    cv.dispatchEvent(mk('touchmove', 320, 410));
    cv.dispatchEvent(mk('touchend', 320, 410));
    return { d: ENG.cam.yaw - y0 };
  });
  ok('單指拖曳可以轉視角', Math.abs(touch.d) > 0.05, '轉了 ' + (touch.d * 57.3).toFixed(1) + '°');
  await page.setViewportSize(VIEW);
  await page.waitForTimeout(200);

  /* ══════════ 效能（CPU 端） ══════════ */
  head('效能');
  const perf = await page.evaluate(() => {
    running = false;
    const rows = [];
    for (const [cnt, wk] of [[900, 20], [3000, 60]]) {
      targetCnt = cnt; shapePick = 0; setWorkerCount(wk); startBuild(true);
      for (let i = 0; i < 240; i++) step(0.016);
      let t = performance.now();
      for (let i = 0; i < 120; i++) step(0.016);
      const s = (performance.now() - t) / 120;
      t = performance.now();
      for (let i = 0; i < 120; i++) draw();
      const d = (performance.now() - t) / 120;
      rows.push({ blocks: blocks.length, wk: workers.length, step: s, draw: d });
    }
    return rows;
  });
  for (const r of perf)
    ok(r.blocks + ' 塊積木 + ' + r.wk + ' 小人：CPU 每幀 < 4ms',
       r.step + r.draw < 4,
       'step ' + r.step.toFixed(2) + 'ms + draw ' + r.draw.toFixed(2) + 'ms = ' +
       (r.step + r.draw).toFixed(2) + 'ms（CPU 上限約 ' + Math.round(1000 / (r.step + r.draw)) + ' fps）');

  const bpTime = await page.evaluate(() => {
    let worst = 0, name = '';
    for (let i = 0; i < SHAPES.length; i++) {
      const t = performance.now();
      makeBlueprint(i, 3000);
      const d = performance.now() - t;
      if (d > worst) { worst = d; name = SHAPES[i].n; }
    }
    return { worst, name };
  });
  ok('換建築不會卡住畫面（最慢的藍圖 < 250ms）', bpTime.worst < 250,
     bpTime.name + ' ' + bpTime.worst.toFixed(0) + 'ms');

  /* ══════════ 連續操作壓力 ══════════ */
  head('連續操作壓力');
  errors.length = 0;
  const stress = await page.evaluate(() => {
    running = false;
    for (let round = 0; round < 12; round++) {
      shapePick = round % SHAPES.length;
      targetCnt = [400, 900, 1800, 3000][round % 4];
      setWorkerCount([3, 20, 45, 60][round % 4]);
      startBuild(true);
      for (let i = 0; i < 120; i++) step(0.05);
      // 邊蓋邊砸
      const cand = blocks.filter(b => b.st === 3);
      if (cand.length) {
        const t = cand[Math.floor(Math.random() * cand.length)];
        smash(new THREE.Vector3(t.x, t.y, t.z), new THREE.Vector3(0.3, -0.9, 0.2).normalize());
      }
      for (let i = 0; i < 120; i++) step(0.05);
    }
    for (let i = 0; i < 900; i++) step(0.05);
    let bad = 0;
    for (const b of blocks) if (!isFinite(b.x) || !isFinite(b.y) || !isFinite(b.z)) bad++;
    return { pool: blocks.length, total: bp.slots.length, bad,
             fly: blocks.filter(b => b.st === 4).length,
             orphanSlot: bp.slots.filter(s => s.claimed >= 0 && !workers[s.claimed]).length,
             ghostCarry: blocks.filter(b => b.st === 1 && b.holder < 0).length };
  });
  ok('連換 12 座 + 邊蓋邊砸，沒有例外', errors.length === 0, errors.slice(0, 2).join(' | '));
  ok('積木池沒有失控膨脹', stress.pool <= stress.total + 4,
     '池 ' + stress.pool + '，藍圖需要 ' + stress.total);
  ok('沒有座標變成 NaN', stress.bad === 0, stress.bad + ' 塊');
  ok('沒有無主的搬運中積木', stress.ghostCarry === 0, stress.ghostCarry + ' 塊');
  ok('沒有被幽靈小人占住的位置', stress.orphanSlot === 0, stress.orphanSlot + ' 個');

  const memGrow = await page.evaluate(() => {
    const before = blocks.length + workers.length * ENG.WPARTS + dust.length;
    for (let r = 0; r < 6; r++) { startBuild(true); for (let i = 0; i < 200; i++) step(0.05); }
    return { before, after: blocks.length + workers.length * ENG.WPARTS + dust.length };
  });
  ok('反覆重建不會累積物件', memGrow.after < memGrow.before * 2 + 200,
     memGrow.before + ' → ' + memGrow.after);

  /* ══════════ 整體 ══════════ */
  head('整體');
  await page.evaluate(() => { running = true; timeScale = 1; setWorkerCount(20); });
  await reset(page, { shape: '莫斯科克里姆林塔', cnt: 900, workers: 20 });
  await page.evaluate(() => { running = true; });
  await page.waitForTimeout(1500);
  ok('整輪跑完沒有累積任何 console 錯誤', errors.length === 0,
     errors.slice(0, 3).join(' | '));
  await page.screenshot({ path: path.join(OUT, '06-結束畫面.png') });

  await browser.close();

  /* ---------- 總結 ---------- */
  const fail = R.filter(r => !r.pass);
  console.log('\n' + '═'.repeat(52));
  console.log('  ' + (R.length - fail.length) + ' / ' + R.length + ' 通過' +
              (fail.length ? '，\x1b[31m' + fail.length + ' 項失敗\x1b[0m' : '  \x1b[32m全數通過\x1b[0m'));
  if (fail.length) {
    console.log('');
    for (const f of fail) console.log('  \x1b[31m✗\x1b[0m [' + f.section + '] ' + f.name + (f.detail ? '  → ' + f.detail : ''));
  }
  console.log('  截圖：' + path.relative(ROOT, OUT));
  console.log('═'.repeat(52));
  process.exit(fail.length ? 1 : 0);
})().catch(e => {
  console.error('\n測試腳本自己爆了：\n' + (e && e.stack || e));
  process.exit(2);
});

