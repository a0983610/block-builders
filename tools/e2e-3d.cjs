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

  /* 每個人身高不一樣，舉東西的高度就得跟著身高走。
     寫死一個高度的話，高個子的積木會陷進自己的安全帽裡——
     這裡驗「積木中心在帽子上方、底面又還碰得到帽子」，兩邊都要。
     1.31 是安全帽頂（engine.js 的 BODY：p 1.24 + 高度 0.14 的一半）。 */
  const carry = await page.evaluate(() => {
    const HAT = 1.31;
    let n = 0, sunk = 0, float = 0, lo = Infinity, hi = -Infinity;
    for (const w of workers) {
      if (!w.carry || w.block < 0) continue;
      const b = blocks[w.block];
      if (!b || b.st !== 1) continue;
      const head = HAT * w.scale;
      n++;
      if (b.y <= head) sunk++;                 // 陷進頭裡
      if (b.y - HB > head) float++;            // 飄在半空
      if (w.scale < lo) lo = w.scale;
      if (w.scale > hi) hi = w.scale;
    }
    return { n, sunk, float, lo: +lo.toFixed(2), hi: +hi.toFixed(2) };
  });
  ok('搬運中的積木架在頭頂上，不會陷進去也不會飄著',
     carry.n > 0 && carry.sunk === 0 && carry.float === 0,
     carry.n + ' 人搬運中，陷入 ' + carry.sunk + '、飄浮 ' + carry.float +
     '；身高 ' + carry.lo + '–' + carry.hi);
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
    let moved = 0, samples = 0, near = Infinity;
    for (let i = 0; i < 1200; i++) {
      step(0.05);
      for (let k = 0; k < workers.length; k++) {
        const w = workers[k];
        const d = Math.hypot(w.x - px[k], w.z - pz[k]);
        px[k] = w.x; pz[k] = w.z; samples++;
        if (d < 1e-6) { run[k] += 0.05; if (run[k] > best[k]) best[k] = run[k]; }
        else { run[k] = 0; moved++; }
        const r = Math.hypot(w.x, w.z);         // 離工地中心多遠——閒晃不該踩進建築裡
        if (r < near) near = r;
      }
    }
    best.sort((a, b) => b - a);
    return { longest: +best[0].toFixed(2), median: +best[best.length >> 1].toFixed(2),
             least: +best[best.length - 1].toFixed(2),
             movingFrac: +(moved / samples).toFixed(2), n: workers.length,
             near: +near.toFixed(2), siteR: +siteR.toFixed(2) };
  });
  ok('遊蕩時會不時停下來站一會兒', idle.median >= 1.1,
     idle.n + ' 人在 60 秒裡最長站定：中位數 ' + idle.median + ' 秒、最久 ' +
     idle.longest + ' 秒、最短 ' + idle.least + ' 秒');
  /* 要的是「大部分人站著，但整群不是死的」。兩邊都要卡：
     全在走看起來像螞蟻竄，全站著看起來像當機。 */
  ok('閒晃時約七成的人站著不動', idle.movingFrac >= 0.2 && idle.movingFrac <= 0.4,
     '站著的幀數占 ' + ((1 - idle.movingFrac) * 100).toFixed(0) + '%（目標 70%）');
  /* 閒晃的人不會從蓋好的建築中間穿過去。走到牆邊要繞開，
     所以最近距離會停在建築外圈；踩進去的話這個數字會小於建築半徑。 */
  ok('閒晃不會穿過建築', idle.near >= idle.siteR,
     '最近只走到離工地中心 ' + idle.near + '（建築半徑 ' + idle.siteR + '）');

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
    const born = dozers ? dozers.list.length : 0;
    const drawn = dozers ? dozRender(dozers).length : 0;
    const R = siteR + 1.4;
    const dirtyOf = () => blocks.filter(b => b.st === 0 && Math.hypot(b.x, b.z) < R).length;
    // 最密的一格有幾塊——推土機的工作就是把這個數字壓下來
    const heapOf = () => {
      const c = new Map();
      for (const b of blocks) {
        if (b.st !== 0 || Math.hypot(b.x, b.z) >= R) continue;
        const k = Math.floor(b.x / 5) + ':' + Math.floor(b.z / 5);
        c.set(k, (c.get(k) || 0) + 1);
      }
      return c.size ? Math.max(...c.values()) : 0;
    };
    /* 「機器真的把料推出去了」跟「時間到直接彈掉」要分清楚。
       收尾 kickOut 的那批在被彈的當下還在範圍內，所以整地結束時人在範圍外的，
       就是被鏟子推出去的。 */
    const cohort = blocks.filter(b => b.st === 0 && Math.hypot(b.x, b.z) < R);
    const origKick = kickOut; let kicked = 0;
    kickOut = b => { kicked++; origKick(b); };
    const trail = [];
    let peak = dirtyOf(), heap0 = 0, lastIn = 0, built = 0, guard = 0;
    let sawMove = 0, sawPush = 0, maxSpd = 0;
    while (phase === 'clear' && guard++ < 900) {
      const before = dozers ? dozers.list.map(m => ({ x: m.x, z: m.z })) : null;
      step(0.05);
      const d = dirtyOf();
      if (d > peak) peak = d;
      if (guard % 8 === 0) trail.push(heapOf());
      if (dozers && dozers.wait <= 0) {
        if (heap0 === 0) heap0 = heapOf();               // 開推那一刻最密的一格
        for (const m of dozers.list) { if (m.st === 'move') sawMove++; if (m.st === 'push') sawPush++; }
        if (before) for (let i = 0; i < dozers.list.length; i++) {
          const m = dozers.list[i], p = before[i];
          const v = Math.hypot(m.x - p.x, m.z - p.z) / 0.05;
          if (v > maxSpd) maxSpd = v;
        }
      }
      if (placedCnt > built) built = placedCnt;
      // 留一張整地中的畫面：畫完就不再畫，後面截到的就是這一幀
      if (guard === 55) { for (let i = 0; i < 8; i++) ENG.updateCamera(1); draw(); ENG.render(); }
      /* 小人本來就可能剛好站在工地正中央（上一秒還在遊蕩），走出去要好幾秒，
         所以不能要求「整段期間都不在裡面」。要驗的是他們有往外走、而且整完時人不在裡面。 */
      for (const w of workers) if (Math.hypot(w.x, w.z) < R) { lastIn = guard; break; }
    }
    const stillIn = workers.filter(w => Math.hypot(w.x, w.z) < R).length;
    const pushedOut = cohort.filter(b => Math.hypot(b.x, b.z) >= R).length;
    kickOut = origKick;
    const dirty1 = dirtyOf(), secs = +(guard * 0.05).toFixed(1);
    let g2 = 0; while (dozers && g2++ < 400) step(0.05);   // 整完會自己開走
    return { born, drawn, peak, dirty1, trail, secs, built, stillIn, heap0,
             cohort: cohort.length, pushedOut, kicked,
             heapEnd: trail.length ? trail[trail.length - 1] : 0,
             sawMove, sawPush, maxSpd: +maxSpd.toFixed(1),
             lastIn: +(lastIn * 0.05).toFixed(1),
             gone: !dozers, phase, drove: +(g2 * 0.05).toFixed(1) };
  });
  ok('換建築時會開幾台推土機進來', doze.born === 3 && doze.drawn === 3,
     doze.born + ' 台，畫面上放了 ' + doze.drawn + ' 台');
  ok('會先趕路再放下鏟子推', doze.sawMove > 0 && doze.sawPush > 0,
     '趕路 ' + doze.sawMove + ' 幀、推 ' + doze.sawPush + ' 幀');
  ok('車速在合理範圍，不會用飛的', doze.maxSpd > 3 && doze.maxSpd < 12,
     '最快 ' + doze.maxSpd + ' 單位／秒（小人走路是 6.8）');
  ok('整地時小人退出工地等，不會提早開工', doze.stillIn === 0 && doze.built === 0,
     '整完時還站在工地裡的有 ' + doze.stillIn + ' 人（最後一次有人在裡面是第 ' +
     doze.lastIn + ' 秒／共 ' + doze.secs + ' 秒），期間蓋了 ' + doze.built + ' 塊');
  /* 推得出去多少很看堆的位置（堆在正中央就推得遠、六秒半跑不完幾趟），
     實測 54～301 塊。門檻只用來擋「鏟子完全沒作用」，不拿來宣稱清得多乾淨。 */
  ok('機器真的把碎料推出去了，不是全靠收尾彈掉', doze.pushedOut > 25,
     doze.cohort + ' 塊裡有 ' + doze.pushedOut + ' 塊被鏟出範圍，收尾彈掉 ' + doze.kicked +
     ' 塊；最密的一格 ' + JSON.stringify(doze.trail.slice(0, 12)));
  ok('整地完工地範圍是空的', doze.dirty1 === 0,
     '整地 ' + doze.secs + ' 秒，範圍內從最多 ' + doze.peak + ' 塊清到 ' + doze.dirty1 + ' 塊');
  ok('整完會自己開出場', doze.gone && doze.phase === 'build',
     doze.drove + ' 秒後開走，phase=' + doze.phase);
  await page.screenshot({ path: path.join(OUT, '04-整地.png') });

  /* 只拿槌子敲的話碎料會全堆在挨打的那一區——這才是推土機真正要處理的情況 */
  const dozeHeap = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '中世紀城堡');
    targetCnt = 1400; setWorkerCount(4); startBuild(true); completeNow();
    // 固定敲同一角，把碎料集中砸成一大坨
    const cand = blocks.filter(b => b.st === 3);
    const t = cand[Math.floor(cand.length * 0.35)];
    const spot = new THREE.Vector3(t.x, t.y, t.z);
    for (let i = 0; i < 40; i++) {
      smash(spot, new THREE.Vector3(0.1, -0.98, 0.1).normalize(), 7, 9);
      for (let k = 0; k < 6; k++) step(0.05);
    }
    for (let i = 0; i < 60; i++) step(0.05);
    const R = siteR + 1.4;
    const densest = () => {
      const c = new Map();
      for (const b of blocks) {
        if (b.st !== 0 || Math.hypot(b.x, b.z) >= R) continue;
        const k = Math.floor(b.x / 5) + ':' + Math.floor(b.z / 5);
        c.set(k, (c.get(k) || 0) + 1);
      }
      return c.size ? Math.max(...c.values()) : 0;
    };
    const before = densest();
    startClear();
    let g = 0, mid = 0;
    while (phase === 'clear' && g++ < 900) { step(0.05); if (g === 60) mid = densest(); }
    return { before, mid, after: densest(), secs: +(g * 0.05).toFixed(1) };
  });
  ok('只敲一個角砸出來的那一大坨也會被推散',
     dozeHeap.before > 25 && dozeHeap.after < dozeHeap.before * 0.5,
     '最密的一格 ' + dozeHeap.before + ' → ' + dozeHeap.after + ' 塊（' +
     dozeHeap.secs + ' 秒）');

  /* 大工地：機器慢慢開，不可能在時限內清光——重點是它不會沒完沒了，收尾照樣把地清乾淨 */
  const dozeBig = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '金門大橋');
    targetCnt = 2000; setWorkerCount(6); startBuild(true); completeNow();
    for (const b of blocks) { if (b.st === 3) freeBlock(b); }
    for (let i = 0; i < 120; i++) step(0.05);
    siteR = bp.radius; startClear();
    const R = siteR + 1.4;
    const dirty0 = blocks.filter(b => b.st === 0 && Math.hypot(b.x, b.z) < R).length;
    let g = 0, maxSpd = 0;
    while (phase === 'clear' && g++ < 1200) {
      const before = dozers ? dozers.list.map(m => ({ x: m.x, z: m.z })) : null;
      step(0.05);
      if (dozers && before) for (let i = 0; i < dozers.list.length; i++) {
        const m = dozers.list[i], p = before[i];
        const v = Math.hypot(m.x - p.x, m.z - p.z) / 0.05;
        if (v > maxSpd) maxSpd = v;
      }
    }
    return { dirty0, secs: +(g * 0.05).toFixed(1), phase, siteR: +siteR.toFixed(0),
             maxSpd: +maxSpd.toFixed(1),
             dirty1: blocks.filter(b => b.st === 0 && Math.hypot(b.x, b.z) < R).length };
  });
  ok('大工地的車速跟小工地一樣，不會為了趕時間飆起來', dozeBig.maxSpd < 12,
     '半徑 ' + dozeBig.siteR + ' 的工地，最快 ' + dozeBig.maxSpd + ' 單位／秒');
  ok('大工地不會沒完沒了，收尾照樣清乾淨', dozeBig.dirty1 === 0 && dozeBig.secs < 9,
     dozeBig.dirty0 + ' 塊 → ' + dozeBig.dirty1 + ' 塊，花 ' + dozeBig.secs + ' 秒');

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
    dozers.wait = 0;
    /* 先把場上其他碎料全部從空間雜湊裡拿掉並挪到場邊。留著的話，
       量到的位移會混進「碎料互相擠開」的成分——這裡要測的是鏟子推不推得到。 */
    for (const b of blocks) {
      if (b.st !== 0) continue;
      if (b.cell) gridDel(b);
      b.x = arenaR * 0.98; b.z = arenaR * 0.98; b.y = 0.47;
    }
    // 手動把三台都排進工地裡、轉成朝外推的狀態
    dozers.list.forEach((m, i) => {
      const ang = i / dozers.list.length * Math.PI * 2;
      m.ux = Math.cos(ang); m.uz = Math.sin(ang);
      m.x = m.ux * siteR * 0.3; m.z = m.uz * siteR * 0.3;
      m.a = Math.atan2(m.ux, m.uz);
      m.tx = m.ux * (siteR + 8); m.tz = m.uz * (siteR + 8);
      m.st = 'push'; m.bl = 0;
    });
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
    // 碎料應該跟車子走一樣的距離——是被推著，不是被拉扯
    const drove = dozers ? dozers.list.map((m, i) => +Math.hypot(m.x - view[i].x, m.z - view[i].z).toFixed(2)) : [];
    draw(); ENG.render();
    return { n: view.length, moved, drove, min: Math.min(...moved),
             slip: Math.max(...moved.map((v, i) => Math.abs(v - drove[i]))), calls: ENG.info().calls };
  });
  ok('鏟面前的碎料跟著車子一起走', dozAlign.min > 0.5 && dozAlign.slip < 0.35,
     '車子走了 ' + JSON.stringify(dozAlign.drove) + '，碎料走了 ' +
     JSON.stringify(dozAlign.moved) + '（最大落差 ' + dozAlign.slip.toFixed(2) + '）');
  ok('推土機沒有多吃 draw call', dozAlign.calls <= 13,
     dozAlign.calls + ' 個（整地中含 3 台機器）');

  /* 碎料要「被帶著走」，不能被彈開。踩過的雷：每幀直接呼叫 separate 擠開重疊，
     它一幀能把積木推開 4.7 單位、遠比車速快，鏟子前的碎料瞬間就被彈出作用範圍——
     畫面上是機器周圍一圈空地、鏟子前面什麼都沒有，完全不像在推。

     量「一幀最多位移多少」最能抓到這件事：被推的話一幀頂多動一點點（車速×dt），
     被彈開的話會一次跳好幾格。只看整地前後的分布是看不出來的。 */
  const dozStep = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '中世紀城堡');
    targetCnt = 1400; setWorkerCount(4); startBuild(true); completeNow();
    for (const b of blocks) if (b.st === 3) freeBlock(b);
    for (let i = 0; i < 140; i++) step(0.05);
    startClear();
    let worst = 0, samples = 0, big = 0, dt = 0.02;
    for (let i = 0; i < 500 && phase === 'clear'; i++) {
      const was = blocks.map(b => ({ st: b.st, x: b.x, z: b.z }));
      step(dt);
      for (let k = 0; k < blocks.length; k++) {
        const b = blocks[k], w = was[k];
        if (b.st !== 0 || w.st !== 0) continue;       // 只看一直是落定碎塊的那些
        const d = Math.hypot(b.x - w.x, b.z - w.z);
        if (d > worst) worst = d;
        if (d > 1e-6) samples++;
        if (d > 0.5) big++;
      }
    }
    return { worst: +worst.toFixed(3), samples, big, cap: +(6.5 * dt).toFixed(3),
             frac: samples ? +(big / samples).toFixed(4) : 1 };
  });
  /* 單幀上限這樣算：跟著車子走 0.13 ＋ 擠開 0.12 ＋ 落到鏟面後被拉回前緣最多 0.7
     ＋ 車頭轉動時鏟面掃過的橫向量最多 0.22 ≈ 1.2，所以門檻放 1.4。
     真正的判別靠 frac（超過半格的比例）：現在 0.3%，每幀 separate 是 8.4%。 */
  ok('碎料是被推著走，不是被彈開的',
     dozStep.samples > 200 && dozStep.worst < 1.4 && dozStep.frac < 0.02,
     '全程 ' + dozStep.samples + ' 次位移，單幀最大 ' + dozStep.worst + '、超過半格的占 ' +
     (dozStep.frac * 100).toFixed(2) + '%（車子一幀走 ' + dozStep.cap +
     '；改用每幀 separate 的話是 2.9 與 8.4%）');

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
  /* 十種工具的解鎖狀態拼成一長串很難讀，用「前 n 種開著」來寫 */
  const NTOOL = 10;
  const opened = n => Array(NTOOL).fill('false').fill('true', 0, n).join(',');
  const btnOpen = n => Array(NTOOL).fill('lock').fill('open', 0, n).join(',');
  ok('工具共 10 種', lock0.ids.length === NTOOL, lock0.ids.join(','));
  ok('一開始只有手指跟槌子可用',
     lock0.ok.join(',') === opened(2), lock0.ok.join(','));
  ok('鎖住的工具在畫面上也是鎖住的',
     lock0.btn.join(',') === btnOpen(2), lock0.btn.join(','));

  const lock1 = await page.evaluate(() => {
    const step2 = [];
    const at = (k, v) => { stats = freshStats(); stats[k] = v; renderTools(); step2.push(TOOLS.map(t => toolOk(t)).join(',')); };
    /* 每一關都從乾淨的紀錄重新設一個門檻值，不是一路往上疊——
       疊著設的話「拆掉 15 座」會連帶滿足前面所有拆除門檻，
       就分不出某一項到底是被自己的條件開的還是被別人順便開的。 */
    at('smashed', 300);
    at('destroyed', 3);
    at('destroyed', 6);
    at('smashed', 1000);
    at('destroyed', 8);
    at('destroyed', 10);
    at('smashed', 3000);
    stats = freshStats(); stats.destroyed = 15; stats.smashed = 3000; renderTools();      // 全開
    step2.push(TOOLS.map(t => toolOk(t)).join(','));
    return { step2, btn: [...document.querySelectorAll('.tool')].map(e => e.className.indexOf('lock') >= 0 ? 'lock' : 'open') };
  });
  ok('擊飛 300 塊解鎖大槌', lock1.step2[0] === opened(3), lock1.step2[0]);
  ok('拆掉 3 座解鎖保齡球', lock1.step2[1] === 'true,true,false,true,false,false,false,false,false,false', lock1.step2[1]);
  ok('拆掉 6 座解鎖投石機', lock1.step2[2] === 'true,true,false,true,true,false,false,false,false,false', lock1.step2[2]);
  ok('擊飛 1000 塊解鎖龍捲風', lock1.step2[3] === 'true,true,true,false,false,true,false,false,false,false', lock1.step2[3]);
  ok('拆掉 8 座解鎖放火', lock1.step2[4] === 'true,true,false,true,true,false,true,false,false,false', lock1.step2[4]);
  ok('拆掉 10 座解鎖定時炸彈', lock1.step2[5] === 'true,true,false,true,true,false,true,true,false,false', lock1.step2[5]);
  ok('擊飛 3000 塊解鎖核彈', lock1.step2[6] === 'true,true,true,false,false,true,false,false,true,false', lock1.step2[6]);
  ok('拆掉 15 座解鎖爆裂魔法', lock1.step2[7] === opened(NTOOL), lock1.step2[7]);
  ok('解鎖後畫面上的鎖頭消失',
     lock1.btn.join(',') === btnOpen(NTOOL), lock1.btn.join(','));

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
    const born = twists ? twists.length : 0;
    let lifted = 0;
    for (let i = 0; i < 260; i++) {
      step(0.03);
      lifted = Math.max(lifted, blocks.filter(b => b.st === 4 && b.y > 6).length);
    }
    for (let i = 0; i < 700; i++) step(0.05);       // 等它們全部落地
    return { before, after: blocks.filter(b => b.st === 3).length, lifted, born, gone: !twists,
             flying: blocks.filter(b => b.st === 4).length };
  });
  ok('龍捲風會生出來', twR.born === 1);
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
    return { peak, alive: !!twists };
  });
  ok('龍捲風不會讓畫面一直晃', twShake.peak < 0.05,
     '整段期間畫面震動峰值 ' + twShake.peak.toFixed(3) + '（龍捲風仍在作用 ' + twShake.alive + '）');

  /* 同時好幾道：每道各走各的、各轉各的，超過上限就擠掉最早那道。
     全部對著工地中心衝的話幾秒後會疊成一團，所以起始方向要帶點偏差——
     量「最近的兩道相距多遠」最能抓到這件事。 */
  const twMany = await page.evaluate(() => {
    /* 挑萬里長城、建材給滿：四道同時掃很快就把整棟夷平，那會觸發自動換場、
       把龍捲風一起收掉，測到的就不是「同時存在幾道」而是換場時機。
       長城拉得長，一次只咬得到一段（實測單道掃完還剩五到九成）。 */
    shapePick = SHAPES.findIndex(s => s.n === '萬里長城');
    targetCnt = 3000; startBuild(true); completeNow();
    for (let k = 0; k < 6; k++)                    // 故意多丟兩道，測上限
      launchTornado({ x: Math.cos(k * 1.6) * siteR * 0.8, z: Math.sin(k * 1.6) * siteR * 0.8 });
    const born = twists.length;
    const spins = twists.map(w => +w.spin.toFixed(2));
    const spinsRaw = twists.map(w => w.spin);
    for (let i = 0; i < 60; i++) step(0.02);       // 1.2 秒後看它們有沒有黏在一起
    const alive = twists ? twists.length : 0;
    let gap = 1e9;
    for (let i = 0; i < alive; i++)
      for (let j = i + 1; j < alive; j++)
        gap = Math.min(gap, Math.hypot(twists[i].x - twists[j].x, twists[i].z - twists[j].z));
    /* 相異與否要看原始值，不能看顯示用的兩位小數：兩個獨立亂數差不到 0.005 的機會
       約 1%，用四捨五入後的字串比會偶發假失敗（實際踩過一次）。 */
    return { born, alive, spins, gap: +gap.toFixed(1), max: TW_MAX,
             same: new Set(spinsRaw).size };
  });
  ok('龍捲風可以同時存在好幾道', twMany.born === twMany.max && twMany.alive === twMany.max,
     '連丟 6 道 → 場上 ' + twMany.born + ' 道（上限 ' + twMany.max + '，多的把最早那道擠掉）');
  ok('每一道各轉各的', twMany.same === twMany.born,
     '起始角度 ' + JSON.stringify(twMany.spins) + '（都一樣的話幾道會擺出同一個姿勢）');
  ok('幾道不會疊在同一點', twMany.gap > 6,
     '1.2 秒後最近的兩道相距 ' + twMany.gap + ' 單位');

  /* 一道跟四道畫起來一樣貴：每一層是一顆 InstancedMesh，場上幾道只是多幾個 instance */
  const twCalls = await page.evaluate(() => {
    startBuild(true); completeNow();
    draw(); ENG.render();
    const idle = ENG.info().calls;
    launchTornado({ x: siteR * 0.5, z: 0 });
    for (let i = 0; i < 10; i++) step(0.02);
    draw(); ENG.render();
    const one = ENG.info().calls;
    for (let k = 0; k < 3; k++) launchTornado({ x: -siteR * 0.5, z: siteR * 0.4 * (k - 1) });
    for (let i = 0; i < 10; i++) step(0.02);
    draw(); ENG.render();
    const four = ENG.info().calls;
    twists = null; ENG.putTornados([]);
    draw(); ENG.render();
    return { idle, one, four, after: ENG.info().calls };
  });
  ok('多幾道龍捲風不會多吃 draw call', twCalls.four === twCalls.one && twCalls.one > twCalls.idle,
     '沒有 ' + twCalls.idle + ' 個、一道 ' + twCalls.one + ' 個、四道 ' + twCalls.four + ' 個');
  ok('收掉之後畫面成本回到原點', twCalls.after === twCalls.idle, twCalls.after + ' 個');

  /* 漏斗拉高到 34 之後會頂出畫面上緣（矮建築取景近，改之前量到 NDC 1.45）。
     跟蘑菇雲同一套：作用期間鏡頭退開，結束後自己收回去。 */
  const twFrame = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '中世紀城堡');
    targetCnt = 1200; startBuild(true); completeNow();
    /* 先空跑 13 秒：前面幾段測試留下的爆炸運鏡還沒到期，
       這時候量「原本的取景」會量到被撐大的值。 */
    for (let i = 0; i < 260; i++) step(0.05);
    const nat = ENG.camTarget.dist;
    launchTornado({ x: siteR * 0.5, z: 0 });
    for (let i = 0; i < 110; i++) step(0.02);
    const wide = ENG.cam.dist;
    const w = twists[0];
    const top = new THREE.Vector3(w.x, w.h, w.z).project(ENG.three.camera).y;
    // 運鏡是 TW_LIFE + 1 秒，多等 3 秒確定到期（中途若整棟被夷平換了場也沒關係，
    // 底下的基準是拿「現在場上這座」重算的）
    for (let i = 0; i < (TW_LIFE + 4) * 50; i++) step(0.02);
    const back = ENG.camTarget.dist;
    ENG.fitCamera(siteR, bp.height, arenaR);
    return { nat: +nat.toFixed(1), wide: +wide.toFixed(1), top: +top.toFixed(2),
             back: +back.toFixed(1), now: +ENG.camTarget.dist.toFixed(1) };
  });
  ok('龍捲風期間鏡頭會退開，漏斗頂留在畫面內', twFrame.wide > twFrame.nat * 1.15 && twFrame.top < 1,
     '取景 ' + twFrame.nat + ' → ' + twFrame.wide + '，漏斗頂 NDC ' + twFrame.top);
  ok('龍捲風結束後鏡頭收回原本的取景', Math.abs(twFrame.back - twFrame.now) < 1,
     twFrame.wide + ' → ' + twFrame.back + '（這座的基準 ' + twFrame.now + '）');

  /* 持續時間拿城堡量：金字塔是實心堆疊，被掃到底層整座垮下來會提早換場，
     量到的就不是龍捲風自己的壽命（實測 4 次有 2 次被砍到 2.6 秒）。 */
  const twLife = await page.evaluate(() => {
    targetCnt = 2400; startBuild(true); completeNow();
    for (let i = 0; i < 40; i++) step(0.05);
    launchTornado({ x: siteR * 0.5, z: 0 });
    let secs = 0;
    while (twists && secs < 12) { step(0.02); secs += 0.02; }
    // 還原成這一段開始前的狀態（後面幾個測試接著用城堡 1200）
    shapePick = SHAPES.findIndex(s => s.n === '中世紀城堡'); targetCnt = 1200;
    return { secs: +secs.toFixed(2), life: TW_LIFE };
  });
  ok('龍捲風持續時間跟設定一致', Math.abs(twLife.secs - twLife.life) < 0.2,
     '撐了 ' + twLife.secs + ' 秒（設定 ' + twLife.life + ' 秒）');

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

  /* ══════════ 放火 ══════════
     這個道具沒有「一下」，威力全在蔓延，所以量的是「火有沒有沿著格子走」與
     「燒完那塊有沒有變黑掉下來」。用大建築測：小的燒到剩 25% 就整棟垮掉換場，
     量到的會是換場規則不是火。 */
  head('放火');
  await reset(page, { shape: '中世紀城堡', cnt: 2400, workers: 6 });
  const fire = await page.evaluate(() => {
    completeNow();
    tool = 'fire';
    /* 從中段高度點火：貼地那層點下去的話，燒斷幾塊就整片垮，
       量不出「火自己往旁邊走」跟「上面失去支撐垮下來」的差別。 */
    const cand = blocks.filter(b => b.st === 3).sort((a, b) => b.y - a.y);
    const t = cand[Math.floor(cand.length * 0.35)];
    const p0 = { x: t.x, y: t.y, z: t.z };
    const ph0 = phase;
    useTool({ kind: 'block', idx: blocks.indexOf(t),
              point: new THREE.Vector3(t.x, t.y, t.z), dir: new THREE.Vector3(0, -1, 0) });
    const lit = { n: fires ? fires.length : 0, burn: t.burn, ph0, ph1: phase };
    const set0 = placedCnt, sm0 = stats.smashed;
    for (let i = 0; i < 40; i++) step(0.05);            // 2 秒
    /* 蔓延中的火離點火處多遠。沿著格子走的話這時候還是一小片；
       整棟同時燒的話這個數字會直接跳到建築的尺度。 */
    const near = fires.map(f => Math.hypot(f.b.x - p0.x, f.b.y - p0.y, f.b.z - p0.z));
    const spread = { n: fires.length, far: Math.max(...near) };
    for (let i = 0; i < 160; i++) step(0.05);           // 再 8 秒
    // 焦黑：燒完的那塊會鬆脫掉下來，而且掉下來之後還是黑的
    const charred = blocks.filter(b => b.st !== 3 && b.tr < 0.1);
    const onGround = charred.filter(b => b.y < 2.5).length;
    const burnt = { n: charred.length, onGround, set: placedCnt, sm: stats.smashed };
    /* 同時在燒的上限。手動一路點到點不動為止——真的等它自己燒到 150 塊要好幾十秒，
       而且會先把建築燒垮。 */
    for (const b of blocks) igniteBlock(b);              // 點到點不動為止
    const cap = { fires: fires.length, hot: 0, HOT_MAX, FIRE_MAX };
    // 火苗要跑幾幀才生得出來，量的是這段時間的峰值
    for (let i = 0; i < 30; i++) { step(0.05); cap.hot = Math.max(cap.hot, hot.length); }
    startBuild(true);
    const swap = { fires: fires ? fires.length : 0, burning: blocks.filter(b => b.burn).length };
    return { lit, set0, sm0, spread, burnt, cap, swap };
  });
  ok('點建築就從那一塊燒起來', fire.lit.n === 1 && fire.lit.burn === 1 &&
     fire.lit.ph0 === 'done' && fire.lit.ph1 === 'wreck',
     '起火 ' + fire.lit.n + ' 塊，phase ' + fire.lit.ph0 + ' → ' + fire.lit.ph1);
  ok('火會往旁邊的格子蔓延，而且是連成一片的',
     fire.spread.n > 4 && fire.spread.far < 12,
     '2 秒後 ' + fire.spread.n + ' 塊在燒，最遠的離點火處 ' + fire.spread.far.toFixed(1));
  ok('燒完的積木會焦黑、鬆脫掉到地上',
     fire.burnt.n > 20 && fire.burnt.onGround > 10 && fire.burnt.set < fire.set0 &&
     fire.burnt.sm > fire.sm0,
     '焦黑 ' + fire.burnt.n + ' 塊（落地 ' + fire.burnt.onGround + '），建築 ' +
     fire.set0 + ' → ' + fire.burnt.set + ' 塊');
  /* freeBlock 會把目標色打回建材色（碎料就是建材），焦黑要設在它之後。
     順序錯的話積木一掉下來就恢復原本的顏色，「燒黑」等於白做——這條就是在守那個順序。 */
  ok('掉下來之後還是焦黑的，不會恢復原色', fire.burnt.onGround > 10,
     '地上有 ' + fire.burnt.onGround + ' 塊目標色還是黑的');
  ok('同時在燒的塊數有上限', fire.cap.fires === fire.cap.FIRE_MAX,
     fire.cap.fires + ' / ' + fire.cap.FIRE_MAX + ' 塊');
  /* 火苗跟爆炸的火球共用同一個粒子池。整棟在燒時把池子吃光的話，
     這時候丟一發核彈就會沒有火球，所以火苗的配額除以 √(在燒的塊數)、並留一截給爆炸。 */
  ok('整棟在燒也不會把爆炸的火球配額吃光', fire.cap.hot < fire.cap.HOT_MAX - 30,
     fire.cap.FIRE_MAX + ' 塊在燒時 ' + fire.cap.hot + ' / ' + fire.cap.HOT_MAX + ' 顆火粒子');
  ok('換建築時火會一起收掉', fire.swap.fires === 0 && fire.swap.burning === 0,
     '換場後 ' + fire.swap.fires + ' 處在燒、' + fire.swap.burning + ' 塊還帶著火');

  /* ══════════ 倒數型道具：炸彈／核彈／魔法 ══════════
     三個的共通點是「點下去不會馬上炸」。全部拿大建築來測：
     小建築被炸掉七成五就整棟垮掉換下一座，數字會被那條規則洗掉，
     量到的就不是這個道具自己的範圍。 */
  head('倒數型道具');
  await reset(page, { shape: '美國國會大廈', cnt: 3000, workers: 6 });
  const bomb = await page.evaluate(() => {
    completeNow();
    const p = { x: 12, y: 4, z: 0 };
    const inR = b => Math.hypot(b.x - p.x, b.y - p.y, b.z - p.z) <= 11;
    const outR = b => Math.hypot(b.x - p.x, b.y - p.y, b.z - p.z) > 13;
    const near0 = blocks.filter(b => b.st === 3 && inR(b)).length;
    const far0 = blocks.filter(b => b.st === 3 && outR(b)).length;
    placeBomb(p);
    const placed = bombs ? bombs.length : 0;
    for (let i = 0; i < 59; i++) step(0.05);            // 2.95 秒：引信還沒燒完
    const early = near0 - blocks.filter(b => b.st === 3 && inR(b)).length;
    step(0.05); step(0.05);                            // 過 3 秒
    const nearLeft = blocks.filter(b => b.st === 3 && inR(b)).length;
    const farLeft = blocks.filter(b => b.st === 3 && outR(b)).length;
    /* 往外噴：速度跟「離炸點的方向」同向才算。
       這個要在爆炸後馬上量——晚幾幀就被重力與碰撞改掉了。 */
    let out = 0, tot = 0, up = 0;
    for (const b of blocks) {
      if (b.st !== 4) continue;
      const dx = b.x - p.x, dz = b.z - p.z, d = Math.hypot(dx, dz);
      if (d < 1) continue;
      tot++;
      if ((b.vx * dx + b.vz * dz) / d > 0) out++;
      if (b.vy > 0) up++;
    }
    return { near0, far0, placed, early, nearLeft, farLeft, tot,
             outward: tot ? out / tot : 0, upward: tot ? up / tot : 0,
             left: bombs ? bombs.length : 0 };
  });
  ok('放下去的炸彈會留在場上倒數', bomb.placed === 1 && bomb.early === 0,
     '放了 ' + bomb.placed + ' 顆，2.95 秒時打飛 ' + bomb.early + ' 塊');
  ok('3 秒後才爆，範圍內全清光', bomb.nearLeft === 0 && bomb.near0 > 100,
     '範圍內 ' + bomb.near0 + ' 塊 → 剩 ' + bomb.nearLeft);
  ok('範圍外的積木原封不動', bomb.farLeft === bomb.far0,
     '範圍外 ' + bomb.far0 + ' 塊 → 剩 ' + bomb.farLeft);
  ok('炸開的積木是往外噴的', bomb.outward > 0.9 && bomb.upward > 0.9,
     bomb.tot + ' 塊飛出去，背離炸點 ' + (bomb.outward * 100).toFixed(0) +
     '%、往上 ' + (bomb.upward * 100).toFixed(0) + '%');
  ok('炸完的炸彈會從場上消失', bomb.left === 0);

  const nk = await page.evaluate(() => {
    startBuild(true); completeNow();
    callNuke({ x: 0, z: 0 });
    const set0 = blocks.filter(b => b.st === 3).length;
    for (let i = 0; i < 39; i++) step(0.05);            // 1.95 秒：還在倒數，彈體都還沒出現
    const wait = blocks.filter(b => b.st === 3).length;
    for (let i = 0; i < 16; i++) step(0.05);            // 2.75 秒：下墜中，還沒炸
    const falling = blocks.filter(b => b.st === 3).length, inAir = !!nuke;
    step(0.05); step(0.05);
    const set1 = blocks.filter(b => b.st === 3).length;
    let hitMax = 0;
    for (const b of blocks) if (b.st === 4) hitMax = Math.max(hitMax, Math.hypot(b.x, b.y - 2.5, b.z));
    /* 爆炸當下該有的：火球（hot 粒子）＋ 貼地的衝擊環。
       這兩個都活不到一秒，所以要在爆完的那一刻量。 */
    const fire0 = hot.length, ring0 = fxRings.length;
    /* 冷卻要盯著「同一批粒子」看，不能看全場平均——蘑菇雲會一直補新的火光進來，
       平均值被新粒子拉高，就算每顆都有乖乖冷卻也測不出來。 */
    const sample = hot.filter(d => d.to);
    const avgG = a => a.reduce((s, d) => s + d.cg, 0) / Math.max(1, a.length);
    const lit0 = avgG(sample);
    const cloud0 = dust.filter(d => d.fade).length;
    for (let i = 0; i < 12; i++) step(0.05);            // 0.6 秒
    const lit1 = avgG(sample.filter(d => d.life > 0));
    let peak = 0, peakY = 0, y1 = 0;
    for (let i = 0; i < 12; i++) step(0.05);            // 爆後 1.2 秒：整朵雲該長齊了
    const cloud1 = dust.filter(d => d.fade).length;
    y1 = Math.max(...dust.filter(d => d.fade).map(d => d.y));
    for (let i = 0; i < 36; i++) {                      // 再 1.8 秒：雲往上飄
      step(0.05);
      const c = dust.filter(d => d.fade);
      if (c.length) peakY = Math.max(peakY, Math.max(...c.map(d => d.y)));
      peak = Math.max(peak, c.length);
    }
    const mid = dust.filter(d => d.fade);
    const midSize = mid.reduce((a, d) => a + d.s, 0) / Math.max(1, mid.length);
    for (let i = 0; i < 200; i++) step(0.05);           // 再 10 秒
    return { set0, wait, falling, inAir, set1, hitMax, fire0, ring0, lit0, lit1,
             cloud0, cloud1, y1, peakY, peak, midSize,
             gone: dust.filter(d => d.fade).length, fireGone: hot.length,
             ringGone: fxRings.length, alive: !!nuke };
  });
  ok('核彈 2 秒內不會炸', nk.wait === nk.set0, nk.set0 + ' → ' + nk.wait);
  ok('2 秒後彈體才從天上掉下來', nk.inAir && nk.falling === nk.set0,
     '2.75 秒時彈體還在空中、建築仍是 ' + nk.falling + ' 塊');
  ok('落地就大爆炸，範圍約 30', nk.set1 < nk.set0 * 0.2 && nk.hitMax > 20 && nk.hitMax <= 31,
     'SET ' + nk.set0 + ' → ' + nk.set1 + '，最遠打飛到 ' + nk.hitMax.toFixed(1));
  ok('爆炸當下有火球與衝擊環', nk.fire0 > 50 && nk.ring0 >= 2,
     nk.fire0 + ' 顆火球、' + nk.ring0 + ' 圈衝擊環');
  /* 火球會冷卻：綠色分量從亮黃(高)掉到暗紅(低)。
     只看「有沒有火球」的話，顏色一路卡在白熱也測不出來。 */
  ok('火球會由亮黃冷成暗紅', nk.lit1 < nk.lit0 * 0.75,
     '同一批粒子的綠分量 0.6 秒內 ' + nk.lit0.toFixed(2) + ' → ' + nk.lit1.toFixed(2));
  /* 蘑菇雲是「長出來」的不是「跳出來」的：爆炸當下只有零星幾團，
     一秒多之後柱子與傘蓋才長齊。一次生完的話這兩個數字會一樣大。 */
  ok('蘑菇雲是隨時間長出來的', nk.cloud0 < 20 && nk.cloud1 > 90,
     '爆炸當下 ' + nk.cloud0 + ' 團 → 1.2 秒後 ' + nk.cloud1 + ' 團');
  ok('蘑菇雲會往上飄', nk.peakY > nk.y1 + 2,
     '雲頂 ' + nk.y1.toFixed(0) + ' → ' + nk.peakY.toFixed(0));
  ok('蘑菇雲會慢慢縮小、最後散掉', nk.midSize < 4 && nk.gone === 0,
     '三秒後平均大小 ' + nk.midSize.toFixed(2) + '，十三秒後剩 ' + nk.gone + ' 團');
  ok('火球與衝擊環是短暫的，不會留在場上',
     nk.fireGone === 0 && nk.ringGone === 0,
     '十三秒後火球 ' + nk.fireGone + ' 顆、光環 ' + nk.ringGone + ' 圈');

  /* 爆炸中心那顆火球（flashes）。粒子撐不出「一整顆在發光的球」，所以球本體是
     實體球殼，火星退居噴出來的碎火。這裡驗的是：球真的畫在畫面上（過曝的白像素
     只能來自它——把它拿掉重畫一次同一幀就知道差多少）、成本固定五個 draw call、
     球心有抬離爆點（不抬會被自己炸出來的碎料堆埋掉）、亮完會收乾淨。 */
  const flash = await page.evaluate(() => {
    const shot = () => {
      draw(); ENG.render();
      const gl = ENG.three.renderer.getContext();
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let n = 0, lit = 0;
      for (let i = 0; i < px.length; i += 4 * 17) {
        n++;
        if (px[i] > 245 && px[i + 1] > 240 && px[i + 2] > 200) lit++;   // 過曝的白
      }
      return { pct: lit / n * 100, calls: ENG.info().calls };
    };
    targetCnt = 2400; shapePick = SHAPES.findIndex(s => s.n === '帝國大廈');
    startBuild(true); completeNow();
    for (let i = 0; i < 240; i++) step(0.05);          // 等前一發的煙火散乾淨
    callNuke({ x: 0, z: 0 });
    for (let i = 0; i < 57; i++) step(0.05);           // 落地爆炸（2.8 秒）後約 0.05 秒
    const born = flashes.map(f => ({ r: +f.r.toFixed(1), op: f.op, y: +f.y.toFixed(1) }));
    const on = shot();
    const saved = flashes.splice(0, flashes.length);   // 同一幀只把火球拿掉，其他都不動
    const off = shot();
    flashes.push(...saved);
    step(0.05); step(0.05);                            // 爆後 0.15 秒：還在全亮期
    const hold = flashes.length ? flashes[0].op : -1;
    for (let i = 0; i < 6; i++) step(0.05);            // 爆後 0.45 秒：該撐大也該暗了
    const fade = flashes.length ? { r: +flashes[0].r.toFixed(1), op: flashes[0].op } : null;
    for (let i = 0; i < 6; i++) step(0.05);            // 爆後 0.75 秒：超過 FLASH_LIFE
    const left = flashes.length;
    /* 火星的分布單獨量：這一刻場上的 hot 混著蘑菇雲柱心的火光（那些本來就生在中心），
       混在一起量不出「火星有沒有生在球面外」。直接叫一次 spawnBlast 最乾淨。 */
    hot.length = 0; flashes.length = 0; fxRings.length = 0;
    spawnBlast({ x: 0, y: 2.5, z: 0 }, 30, false);
    const sparkMin = Math.min(...hot.map(d => Math.hypot(d.x, d.z)));
    for (let i = 0; i < 6; i++) spawnBlast({ x: i * 3, y: 2.5, z: 0 }, 30, false);
    const capped = flashes.length;
    hot.length = 0; flashes.length = 0; fxRings.length = 0;
    return { born, on, off, hold, fade, left, sparkMin, capped };
  });
  /* 半徑走 sqrt，爆後第一幀（0.05 秒）就衝到一半以上——「一瞬間撐開」是刻意的，
     等速膨脹看起來像吹氣球。所以這裡量的是「一幀內有沒有到半徑的一半」。 */
  ok('爆炸中心有一顆實體火球，一幀就撐開、球心抬離地面',
     flash.born.length === 1 && flash.born[0].r > 15 && flash.born[0].r < 20 &&
     flash.born[0].y > 6,
     '爆後 0.05 秒半徑 ' + (flash.born[0] ? flash.born[0].r : '—') +
     '（上限 30）、球心 y=' + (flash.born[0] ? flash.born[0].y : '—') + '（爆點 2.5）');
  ok('火球真的亮在畫面上', flash.on.pct > 1 && flash.on.pct > flash.off.pct * 3,
     '同一幀有火球 ' + flash.on.pct.toFixed(2) + '% 過曝、拿掉只剩 ' +
     flash.off.pct.toFixed(2) + '%');
  ok('火球固定吃五個 draw call（每層球殼一個）', flash.on.calls - flash.off.calls === 5,
     flash.off.calls + ' → ' + flash.on.calls + ' 個');
  ok('火球先全亮一下才開始暗', flash.hold === 1, '爆後 0.15 秒亮度 ' + flash.hold);
  ok('火球會一邊撐大一邊暗下來',
     !!flash.fade && flash.fade.r > flash.born[0].r + 8 && flash.fade.op < 0.7,
     '0.45 秒時半徑 ' + (flash.fade ? flash.fade.r : '—') + '、亮度 ' +
     (flash.fade ? flash.fade.op.toFixed(2) : '—'));
  ok('火球 0.75 秒內收乾淨', flash.left === 0, '剩 ' + flash.left + ' 顆');
  /* 火星要生在球面外。生在球心的話那些幾乎不透明的方塊會整片糊在球的正面，
     把最亮的核心遮成一堆橘色碎片——改成球殼的意義就沒了。 */
  ok('火星生在球面外，不會糊住核心', flash.sparkMin > 30 * 0.45,
     '最近的一顆離爆心 ' + flash.sparkMin.toFixed(1) + '（半徑 30 的 45% 是 13.5）');
  ok('同時炸好幾發也只留最新的四顆火球', flash.capped === 4,
     '連續 7 發 → 場上 ' + flash.capped + ' 顆');

  /* 腳下那圈煙：柱子不能從一塊乾淨的草地長出來。
     光看「貼地的煙有幾團」不夠——柱子底部本來就有煙。要看的是它有沒有往外鋪開，
     所以量「離爆心 R×0.25 以外、貼著地面的煙」有幾團、最遠鋪到哪。
     同時要確認它沒有把塵霧配額吃光：傘蓋是 0.45 秒一次要 112 顆的爆量，
     被擠掉的話蘑菇會變成一根沒有頭的柱子。 */
  const skirt = await page.evaluate(() => {
    startBuild(true); completeNow();
    callNuke({ x: 0, z: 0 });
    for (let i = 0; i < 58; i++) step(0.05);            // 炸下去
    for (let i = 0; i < 30; i++) step(0.05);            // 爆後 1.5 秒
    const cloud = dust.filter(d => d.fade);
    const low = cloud.filter(d => d.y < 6);
    const far = low.filter(d => Math.hypot(d.x, d.z) > NUKE_R * 0.25);
    const out = { low: low.length, far: far.length, R: NUKE_R,
             wide: +Math.max(0, ...low.map(d => Math.hypot(d.x, d.z))).toFixed(1),
             high: cloud.filter(d => d.y > 14).length };
    // 這朵散乾淨再交棒：留著的灰煙會混進下一段（魔法那朵要驗「全部染紅」）
    for (let i = 0; i < 200; i++) step(0.05);
    return out;
  });
  ok('蘑菇雲腳下有一圈往外鋪開的煙', skirt.far > 40 && skirt.wide > skirt.R * 0.4,
     '貼地 ' + skirt.low + ' 團，其中 ' + skirt.far + ' 團在爆心 ' +
     (skirt.R * 0.25).toFixed(0) + ' 單位外，最遠鋪到 ' + skirt.wide);
  ok('腳下的煙沒有把傘蓋的配額吃掉', skirt.high > 60,
     '雲上半部仍有 ' + skirt.high + ' 團');

  const mg = await page.evaluate(() => {
    startBuild(true); completeNow();
    castMagic({ x: 0, z: 0 });
    const set0 = blocks.filter(b => b.st === 3).length;
    const seq = [];
    for (let i = 0; i < 119; i++) {                     // 5.95 秒
      step(0.05);
      if (i % 16 === 0) seq.push(magic ? magic.shown : -1);   // 每 0.8 秒（＝長一層）取樣
    }
    const before = blocks.filter(b => b.st === 3).length, alive = !!magic;
    step(0.05); step(0.05);
    let hitMax = 0;
    for (const b of blocks) if (b.st === 4) hitMax = Math.max(hitMax, Math.hypot(b.x, b.y - 1.5, b.z));
    const fire = hot.length;
    for (let i = 0; i < 24; i++) step(0.05);            // 1.2 秒後：雲該長齊了
    const cloud = dust.filter(d => d.fade).length;
    // 魔法版燒的是紅光、還會撒星光：粒子有自己的顏色（cr 有值）而不是灰白煙
    const tinted = dust.filter(d => d.fade && d.cr !== undefined).length;
    return { set0, seq, before, alive, set1: blocks.filter(b => b.st === 3).length,
             hitMax, after: !!magic, fire, cloud, tinted };
  });
  ok('魔法陣是一層層長出來的', mg.seq[0] === 1 && mg.seq[mg.seq.length - 1] === 6 &&
     mg.seq.every((v, i) => i === 0 || v >= mg.seq[i - 1]), '每 0.8 秒取樣：' + mg.seq.join(' → '));
  ok('魔法 6 秒內不會炸', mg.before === mg.set0 && mg.alive, mg.set0 + ' → ' + mg.before);
  ok('6 秒到就爆，範圍約 30', mg.set1 < mg.set0 * 0.2 && mg.hitMax > 20 && mg.hitMax <= 31 && !mg.after,
     'SET ' + mg.set0 + ' → ' + mg.set1 + '，最遠打飛到 ' + mg.hitMax.toFixed(1));
  ok('魔法爆完也會留一朵蘑菇雲，而且是紅的', mg.fire > 50 && mg.cloud > 90 && mg.tinted === mg.cloud,
     mg.fire + ' 顆火球、1.2 秒後 ' + mg.cloud + ' 團煙（染紅的 ' + mg.tinted + ' 團）');

  /* 陣是由下往上疊的，不是同心圓：層與層之間高度要遞增，
     而且貼地那圈的半徑就是爆炸範圍（要讓玩家看得出會炸到哪）。 */
  const mgRing = await page.evaluate(() => {
    startBuild(true); completeNow();
    castMagic({ x: 0, z: 0 });
    for (let i = 0; i < 100; i++) step(0.05);       // 5 秒：四層都長齊
    const all = magic ? magic.rings : [];
    // 一層是兩個環疊出來的：實色的芯 + 加法混色的暈。層次要看芯那幾個
    const core = all.filter(o => !o.add).map(o => ({ y: +o.y.toFixed(1), r: +o.r.toFixed(1), c: o.c }));
    const halo = all.filter(o => o.add);
    return { n: core.length, halo: halo.length, rings: core,
             rising: core.every((o, i) => i === 0 || o.y > core[i - 1].y),
             red: core.every(o => o.c === 0xff3a1c), ground: core[0] ? core[0].r : 0,
             // 每層都要有填滿的盤與放射紋路，只有環的話看起來是「地上畫了一個圈」
             solid: all.filter(o => o.fill).length, lace: all.filter(o => o.sp).length };
  });
  ok('魔法陣是紅色、而且一層一層往上疊',
     mgRing.n === 6 && mgRing.halo === 6 && mgRing.rising && mgRing.red,
     mgRing.rings.map(o => 'y' + o.y + '/r' + o.r).join('、') + '，外圈暈 ' + mgRing.halo + ' 個');
  ok('每一層都是填滿的盤加螺旋紋路，不只是一個圈',
     mgRing.solid === 6 && mgRing.lace === 6,
     '填滿的盤 ' + mgRing.solid + ' 片、帶紋路的層 ' + mgRing.lace + ' 層');

  /* 每層半徑帶隨機抖動：兩次施法要長得不一樣，但**同一次施法內不能變**——
     每幀重抽的話整疊會一直閃。 */
  const mgVary = await page.evaluate(() => {
    const cast = () => {
      startBuild(true); completeNow();
      castMagic({ x: 0, z: 0 });
      for (let i = 0; i < 100; i++) step(0.05);
      return magic.rings.filter(o => !o.add).map(o => +o.r.toFixed(3));
    };
    const a = cast(), b = cast();
    const c = magic.rings.filter(o => !o.add).map(o => +o.r.toFixed(3));
    for (let i = 0; i < 8; i++) step(0.05);
    const d = magic.rings.filter(o => !o.add).map(o => +o.r.toFixed(3));
    return { a, b, differ: a.some((v, i) => Math.abs(v - b[i]) > 0.3), steady: c.join() === d.join() };
  });
  ok('每次施法的層半徑都不一樣', mgVary.differ,
     '第一次 ' + mgVary.a.map(v => v.toFixed(1)).join('/') +
     '、第二次 ' + mgVary.b.map(v => v.toFixed(1)).join('/'));
  ok('但同一次施法內不會逐幀跳動', mgVary.steady);

  /* 陣不轉：紋路的角度要一路固定。每層各自一個角度（六層同角度的話螺旋會對齊，
     整疊看起來像一支花紋對齊的柱子），但同一層不能隨時間變。 */
  const mgSpin = await page.evaluate(() => {
    startBuild(true); completeNow();
    castMagic({ x: 0, z: 0 });
    for (let i = 0; i < 100; i++) step(0.05);
    const at = () => magic.rings.filter(o => !o.add).map(o => +o.spin.toFixed(4));
    const a = at();
    for (let i = 0; i < 20; i++) step(0.05);          // 再一秒（越接近爆炸原本轉越快）
    const b = at();
    return { a, b, still: a.join() === b.join(), spread: new Set(a).size };
  });
  ok('魔法陣不會旋轉', mgSpin.still,
     '一秒前後的角度：' + mgSpin.a.map(v => v.toFixed(2)).join('/') + ' → ' +
     mgSpin.b.map(v => v.toFixed(2)).join('/'));
  ok('但每一層的紋路角度各自不同', mgSpin.spread === mgSpin.a.length,
     mgSpin.a.length + ' 層裡有 ' + mgSpin.spread + ' 種角度');
  /* 整疊都浮在半空：最下層離地也有一段，而且不做滿爆炸半徑——
     做滿的話那一圈會比建築大一大圈，看起來像地上的跑道而不是浮空的陣。 */
  ok('最下層浮在半空，也沒有大到蓋滿爆炸範圍',
     mgRing.rings[0].y > 2 && mgRing.ground < 30 * 0.8,
     '最下層離地 ' + mgRing.rings[0].y + '、半徑 ' + mgRing.ground + '（爆炸範圍 30）');

  /* 衝擊波是球狀的，而且越靠近炸心抬得越高——積木要沿拋物線拋上去再落下，
     不是貼著地面掃出去。只量「有沒有飛出去」的話，兩種都會過。 */
  const arc = await page.evaluate(() => {
    startBuild(true); completeNow();
    explode({ x: 0, y: 2.5, z: 0 }, 30, 34);
    const fly = blocks.filter(b => b.st === 4);
    const avgVy = a => a.reduce((s, b) => s + b.vy, 0) / Math.max(1, a.length);
    const nearVy = avgVy(fly.filter(b => Math.hypot(b.x, b.z) < 8));
    const farVy = avgVy(fly.filter(b => Math.hypot(b.x, b.z) > 20));
    let peak = 0, air = 0;
    for (let i = 0; i < 120; i++) {
      step(0.05);
      let flying = 0;
      for (const b of blocks) if (b.st === 4) { flying++; if (b.y > peak) peak = b.y; }
      if (flying > fly.length * 0.5) air += 0.05;   // 一半以上還在空中就算滯空
    }
    return { n: fly.length, nearVy, farVy, peak, air };
  });
  ok('炸開的積木是拋上去的，不是貼地掃出去', arc.peak > 25 && arc.air > 1.5,
     arc.n + ' 塊飛出去，最高 ' + arc.peak.toFixed(0) + '、滯空 ' + arc.air.toFixed(1) + ' 秒');
  ok('越靠近炸心抬得越高', arc.nearVy > arc.farVy * 1.6,
     '近處起飛速度 ' + arc.nearVy.toFixed(0) + '、遠處 ' + arc.farVy.toFixed(0));

  /* 先收縮後爆發：陣在充能時把周圍碎料往中心捲，六秒到再全部噴出去。
     只驗「有沒有吸」不夠——吸完要能噴回去才是那個反差。 */
  const imp = await page.evaluate(() => {
    startBuild(true); completeNow();
    // 把外圈的積木改成散落的碎料，當作被吸的對象
    const loose = [];
    for (const b of blocks) {
      if (loose.length >= 80) break;
      if (b.st !== 3 || Math.hypot(b.x, b.z) < siteR * 0.8) continue;
      if (b.slot >= 0) { bp.slots[b.slot].filled = false; b.slot = -1; }
      const a = Math.random() * Math.PI * 2, rad = 16 + Math.random() * 11;
      b.st = 0; b.rest = true; b.x = Math.cos(a) * rad; b.z = Math.sin(a) * rad; b.y = HB;
      b.vx = b.vy = b.vz = 0;
      loose.push(b);
    }
    const mean = () => loose.reduce((s, b) => s + Math.hypot(b.x, b.z), 0) / loose.length;
    castMagic({ x: 0, z: 0 });
    for (let i = 0; i < 30; i++) step(0.05);        // 1.5 秒：吸力剛要開始
    const d0 = mean();
    for (let i = 0; i < 80; i++) step(0.05);        // 5.5 秒：吸了四秒
    const d1 = mean(), motes = hot.filter(h => h.pull).length;
    for (let i = 0; i < 30; i++) step(0.05);        // 過 6 秒：炸開，再看一秒後噴到哪
    return { n: loose.length, d0, d1, d2: mean(), motes };
  });
  ok('魔法陣充能時會把碎料往陣心捲進去', imp.d1 < imp.d0 * 0.85,
     imp.n + ' 塊碎料離陣心 ' + imp.d0.toFixed(1) + ' → ' + imp.d1.toFixed(1));
  ok('陣上會冒出往中心捲的魔力光點', imp.motes > 10, imp.motes + ' 顆');
  ok('六秒一到再把它們全噴出去', imp.d2 > imp.d1 * 1.2,
     '爆炸後 ' + imp.d1.toFixed(1) + ' → ' + imp.d2.toFixed(1));

  /* 雲頂會升到 40 以上，貼著建築的取景根本裝不下——引爆時鏡頭要退開，
     而且事後要自己收回來，不能一直停在遠處。
     建築鎖同一座，換場後的取景距離才有得比。 */
  const camFx = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '中世紀城堡');
    targetCnt = 900; startBuild(true); completeNow();
    // 前面的測試剛炸過，運鏡還沒收完。先讓它跑完，不然量到的起點就是「已經退開」的視距
    for (let i = 0; i < 200; i++) step(0.05);
    startBuild(true); completeNow();
    const d0 = ENG.camTarget.dist;
    callNuke({ x: 0, z: 0 });
    for (let i = 0; i < 58; i++) step(0.05);        // 引爆
    const wide = ENG.camTarget.dist, ty = ENG.camTarget.ty;
    for (let i = 0; i < 60; i++) step(0.05);        // 3 秒後：雲正高，還要維持
    const hold = ENG.camTarget.dist;
    for (let i = 0; i < 160; i++) step(0.05);       // 過了 7 秒的運鏡時間
    const back = ENG.camTarget.dist;
    shapePick = -1;
    return { d0, wide, ty, hold, back };
  });
  ok('核彈引爆時鏡頭會退開，整朵雲才進得了畫面',
     camFx.wide > camFx.d0 * 1.3 && camFx.hold === camFx.wide,
     '視距 ' + camFx.d0.toFixed(0) + ' → ' + camFx.wide.toFixed(0) +
     '（視線高度 ' + camFx.ty.toFixed(0) + '），三秒後仍維持');
  ok('運鏡結束後鏡頭會自己收回來', Math.abs(camFx.back - camFx.d0) < 2,
     '七秒後回到 ' + camFx.back.toFixed(0) + '（原本 ' + camFx.d0.toFixed(0) + '）');

  /* 倒數中換建築：留著的話會炸到剛蓋好的新那座 */
  const swap = await page.evaluate(() => {
    startBuild(true); completeNow();
    placeBomb({ x: 3, y: 2, z: 3 }); callNuke({ x: 0, z: 0 }); castMagic({ x: 5, z: 5 });
    const armed = [bombs ? bombs.length : 0, nuke ? 1 : 0, magic ? 1 : 0].join(',');
    startBuild(true);
    const after = [bombs ? bombs.length : 0, nuke ? 1 : 0, magic ? 1 : 0].join(',');
    const n0 = placedCnt;
    for (let i = 0; i < 200; i++) step(0.05);           // 10 秒：三個的倒數都早就到了
    return { armed, after, n0, hurt: n0 - placedCnt, phase };
  });
  ok('換建築會把倒數中的道具一起收掉', swap.after === '0,0,0',
     '換之前 ' + swap.armed + ' → 換之後 ' + swap.after);
  ok('新建築不會被上一輪的倒數炸到', swap.hurt <= 0,
     '換場後 10 秒內少了 ' + swap.hurt + ' 塊（phase=' + swap.phase + '）');

  /* 一發核彈常常直接把整棟夷平，那會立刻觸發「剩不到 25% 就換下一座」。
     換場如果把特效也清掉，蘑菇雲就會在爆炸後 0.05 秒整朵消失——等於白做。
     這裡驗的是「換場了、但雲還在」，兩個條件缺一不可。 */
  const keepFx = await page.evaluate(() => {
    startBuild(true); completeNow();
    const ph0 = phase;
    callNuke({ x: 0, z: 0 });
    for (let i = 0; i < 58; i++) step(0.05);           // 炸下去
    const ph1 = phase;
    for (let i = 0; i < 24; i++) step(0.05);           // 1.2 秒後雲該長齊了
    return { ph0, ph1, phase, cloud: dust.filter(d => d.fade).length, fire: hot.length };
  });
  ok('炸到整棟夷平而自動換場時，蘑菇雲不會跟著消失',
     keepFx.ph1 !== 'done' && keepFx.cloud > 90,
     'phase ' + keepFx.ph0 + ' → ' + keepFx.ph1 + ' → ' + keepFx.phase +
     '，雲 ' + keepFx.cloud + ' 團、火球 ' + keepFx.fire + ' 顆');

  /* 餘火：三種爆炸都要在周圍點起火來。三個共用 explode()，但還是三個都測——
     哪天有人在某一支的路徑上繞過 explode，只測一種是看不出來的。

     兩件事決定了怎麼量：
     1. 取樣要落在**爆炸的那一幀**。整棟被夷平的話，下一幀就會觸發「剩不到 25%
        換下一座」，換場會把火一起收掉（積木要回收去蓋新的那座，不收的話新建築
        會從某幾塊莫名地燒起來）。
     2. 「還站著的燒起來」要用**比爆炸範圍大**的建築才量得到（萬里長城橫著鋪開，
        遠比半徑 30 寬）。半徑 30 蓋滿的一般建築，範圍內一塊都不會剩——
        那種情況的餘火是「帶著火飛出去的碎料」，另一條測試在量。 */
  const emb = await page.evaluate(() => {
    /* armed() 回報「道具還在倒數」，用它偵測爆炸落在哪一幀，不用自己數步數：
       倒數秒數改一下、或哪天多一幀延遲，數死的步數就會量到爆炸前或換場後。 */
    const one = (shape, go, armed) => {
      targetCnt = 3000; shapePick = SHAPES.findIndex(s => s.n === shape);
      startBuild(true); completeNow();
      if (fires) { for (const f of fires) f.b.burn = 0; fires = null; }
      go();
      let n = 0;
      while (armed() && n++ < 400) step(0.05);              // 停在爆炸的那一幀
      const lit = fires || [];
      return { set: lit.filter(f => f.b.st === 3).length,   // 還站著、會繼續蔓延的
               fly: lit.filter(f => f.b.st === 4).length,   // 被炸飛、拖著火落地的
               left: placedCnt, frame: n };
    };
    /* 變數不能取名 nuke／magic：那會遮住同名的全域狀態，armed() 讀到的就是自己 */
    const bombE = one('美國國會大廈', () => placeBomb({ x: 14, y: 4, z: 0 }), () => !!bombs);
    const nukeE = one('萬里長城', () => callNuke({ x: 0, z: 0 }), () => !!nuke);
    const magicE = one('萬里長城', () => castMagic({ x: 0, z: 0 }), () => !!magic);
    const flatE = one('美國國會大廈', () => callNuke({ x: 0, z: 0 }), () => !!nuke);
    return { bomb: bombE, nuke: nukeE, magic: magicE, flat: flatE };
  });
  ok('炸彈、核彈、魔法都會在周圍留下餘火',
     emb.bomb.set > 0 && emb.nuke.set > 0 && emb.magic.set > 0,
     '還站著又燒起來的：炸彈 ' + emb.bomb.set + ' 塊、核彈 ' + emb.nuke.set +
     ' 塊、魔法 ' + emb.magic.set + ' 塊');
  ok('剛好被夷平的那種爆炸，餘火是帶著火飛出去的碎料',
     emb.flat.fly > 0 && emb.flat.set === 0,
     '整棟只剩 ' + emb.flat.left + ' 塊站著，' + emb.flat.fly + ' 塊碎料帶著火');

  /* 沒在用的道具不該平白多吃 draw call：InstancedMesh 就算 count=0 也算一個 */
  const dc = await page.evaluate(() => {
    startBuild(true); completeNow();
    // 先等前面測試留下的煙與火球散乾淨，不然量到的是上一發爆炸的帳
    for (let i = 0; i < 320; i++) step(0.05);
    draw(); ENG.render();
    const idle = ENG.info().calls;
    castMagic({ x: 0, z: 0 });
    for (let i = 0; i < 100; i++) step(0.05);       // 5 秒：六層全開，最貴的一幀
    placeBomb({ x: 4, y: 1, z: 4 });               // 炸彈最後才放，才不會先炸掉建築換場
    draw(); ENG.render();
    return { idle, busy: ENG.info().calls };
  });
  ok('沒放道具時 draw call 不變', dc.idle <= 12, dc.idle + ' 個');
  /* 魔法陣一層是「盤 + 芯環 + 暈環」三個 draw call，六層就十八個。
     只在陣展開的那六秒會這樣，平常是 11。 */
  ok('炸彈與魔法陣在場上才多吃 draw call', dc.busy > dc.idle && dc.busy <= 36,
     '放了炸彈與六層魔法陣時 ' + dc.busy + ' 個');

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

  /* ══════════ 破壞造成的損失 ══════════ */
  head('破壞損失');
  const loss = await page.evaluate(() => {
    stats = freshStats();
    shapePick = SHAPES.findIndex(s => s.n === '中世紀城堡');
    targetCnt = 1200; setWorkerCount(2); startBuild(true); completeNow();
    const start = stats.wrecked;
    // 一槌下去：打飛幾塊就該記幾塊的損失
    const cand = blocks.filter(b => b.st === 3 && b.y > 4);
    const t = cand[Math.floor(cand.length * 0.5)];
    const n = smash(new THREE.Vector3(t.x, t.y, t.z), new THREE.Vector3(0.2, -0.95, 0.1).normalize());
    const afterHitLoss = stats.wrecked - start;
    /* 垮下來的也要算。把貼地那一層整層清掉，上面就整棟連不到地面——
       只挖幾十塊零星的洞是不會垮的（26 鄰居連通，牆夠厚就繞得過去）。 */
    for (let i = 0; i < 30; i++) step(0.05);
    const beforeFall = stats.wrecked, standing = placedCnt;
    const low = blocks.filter(b => b.st === 3 && b.y < 1.5);
    const broke = low.length;
    for (const b of low) breakBlock(b, 0, 0.5, 0);
    markSupportDirty(0);       // 直接呼叫 breakBlock 不會排重算，垮塌判定要自己叫
    for (let i = 0; i < 120; i++) step(0.05);
    const fellLoss = stats.wrecked - beforeFall, fell = standing - placedCnt;
    // 拆到門檻換下一座時，剩下沒打到的整棟報廢也要計進去
    let g = 0;
    while (phase === 'wreck' && g++ < 300) {
      const c2 = blocks.filter(b => b.st === 3);
      if (c2.length) {
        const x = c2[Math.floor(Math.random() * c2.length)];
        smash(new THREE.Vector3(x.x, x.y, x.z), new THREE.Vector3(0.2, -0.95, 0.1).normalize());
      }
      for (let k = 0; k < 8; k++) step(0.05);
    }
    const total = stats.wrecked;
    // 換建築（不是破壞）不該產生損失
    const beforeSwap = stats.wrecked;
    startBuild(true); completeNow();
    hudLast = 0; hudTick(performance.now());        // running=false 時 HUD 不會自己更新
    return { afterHitLoss, hit: n, fellLoss, fell, broke, total, cost: WRECK_COST,
             swapLoss: stats.wrecked - beforeSwap, lossThis,
             dom: document.getElementById('lossAll').textContent };
  });
  ok('打飛積木會記成損失', loss.hit > 0 && loss.afterHitLoss === loss.hit * loss.cost,
     '一槌打飛 ' + loss.hit + ' 塊 = ' + loss.afterHitLoss + '（每塊 $' + loss.cost + '）');
  ok('失去支撐自己垮下來的也算損失',
     loss.fell > loss.broke * 2 && loss.fellLoss === loss.fell * loss.cost,
     '打掉貼地那層 ' + loss.broke + ' 塊，連帶垮掉共 ' + loss.fell + ' 塊 = ' + loss.fellLoss);
  ok('拆完一座的損失是整棟的量級', loss.total > 1200 * loss.cost * 0.9,
     '這座 1200 塊，累計損失 ' + loss.total + '（滿棟約 ' + (1200 * loss.cost) + '）');
  ok('單純換建築不算損失', loss.swapLoss === 0, '換一座之後多了 ' + loss.swapLoss);
  ok('換建築後本次損失歸零', loss.lossThis === 0, 'lossThis=' + loss.lossThis);
  ok('右上角有顯示累計損失', /^\$[\d,]+$/.test(loss.dom) && loss.dom !== '$0', loss.dom);

  const lossBadge = await page.evaluate(() => {
    stats = freshStats(); stats.wrecked = 99999; checkBadges();
    const notYet = stats.badges.indexOf('loss100k') >= 0;
    stats.wrecked = 1e5; checkBadges();
    const got = stats.badges.indexOf('loss100k') >= 0;
    stats.wrecked = 2e6; checkBadges();
    const big = stats.badges.indexOf('loss2m') >= 0;
    renderBadges();
    return { notYet, got, big, dom: document.getElementById('badgeLoss').textContent };
  });
  ok('$100,000 損失解鎖【災情慘重】', !lossBadge.notYet && lossBadge.got,
     '$99,999 → ' + lossBadge.notYet + '、$100,000 → ' + lossBadge.got);
  ok('$2,000,000 損失解鎖【保險公司拒保】', lossBadge.big);
  ok('成就面板寫出累計損失', lossBadge.dom === '$2,000,000', lossBadge.dom);

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

  /* 每個成就都要真的能拿到：湊出剛好達標的紀錄，一個一個確認 */
  const reach = await page.evaluate(() => {
    const cases = {
      first: s => s.built = ['A'],
      demo50: s => s.bestHit = 51,
      boss20: s => s.poked = 20,
      miracle: s => s.miracle = true,
      wreck5: s => s.destroyed = 5,
      move10k: s => s.carried = 10000,
      world10: s => s.built = Array.from({ length: 10 }, (_, i) => 'B' + i),
      million: s => s.spent = 1e6,
      loss100k: s => s.wrecked = 1e5,
      loss2m: s => s.wrecked = 2e6,
      hit200: s => s.bestHit = 201,
      allTools: s => s.tools = TOOLS.map(t => t.id),
      bigBuild: s => s.bigBuild = 2500,
      poke100: s => s.poked = 100,
      wreck25: s => s.destroyed = 25,
      smash50k: s => s.smashed = 50000,
      move100k: s => s.carried = 100000,
      spend10m: s => s.spent = 1e7,
      worldAll: s => s.built = SHAPES.map(x => x.n)
    };
    const missing = BADGES.filter(b => !cases[b.id]).map(b => b.id);
    const fail = [];
    for (const id in cases) {
      stats = freshStats();
      cases[id](stats);
      checkBadges();
      if (stats.badges.indexOf(id) < 0) fail.push(id);
    }
    // 全部條件一起滿足時，一個都不能漏
    stats = freshStats();
    for (const id in cases) cases[id](stats);
    checkBadges();
    return { missing, fail, all: stats.badges.length, total: BADGES.length };
  });
  ok('每個成就都有對應的測試案例', reach.missing.length === 0,
     reach.missing.length ? '沒測到：' + reach.missing.join(',') : reach.total + ' 個全部有測');
  ok('每個成就都拿得到', reach.fail.length === 0,
     reach.fail.length ? '拿不到：' + reach.fail.join(',') : reach.total + ' 個都驗過');
  ok('條件全滿時全部解鎖', reach.all === reach.total, reach.all + ' / ' + reach.total);

  /* 用過的道具要記起來——【工具箱清空】靠它 */
  const toolRec = await page.evaluate(() => {
    stats = freshStats();
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 600; setWorkerCount(4); startBuild(true); completeNow();
    const target = blocks.find(b => b.st === 3 && b.y > 3);
    const hit = { kind: 'block', point: new THREE.Vector3(target.x, target.y, target.z),
                  dir: new THREE.Vector3(0.2, -0.95, 0.1).normalize() };
    for (const t of TOOLS) { tool = t.id; useTool(hit); for (let i = 0; i < 10; i++) step(0.05); }
    const got = stats.badges.indexOf('allTools') >= 0;
    // 同一種道具用兩次不會重複記
    tool = 'hammer'; useTool(hit);
    const n = stats.tools.length;
    return { list: stats.tools.slice(), n, got, total: TOOLS.length };
  });
  ok('用過哪些道具會記起來', toolRec.n === toolRec.total,
     toolRec.n + ' / ' + toolRec.total + '：' + toolRec.list.join(','));
  ok('十種道具都用過解鎖【工具箱清空】', toolRec.got);

  /* 存檔被改過時，不認得的道具 id 不該混進來 */
  const toolClean = await page.evaluate(() => {
    stats = freshStats();
    // laser／railgun 是永遠不會存在的 id——拿真道具的名字當假資料會測不出東西
    stats.tools = ['hammer', 'laser', 'ball', 'railgun', 'tornado', 'treb', 'bighammer', 'finger'];
    save(); stats = freshStats(); load();
    return { list: stats.tools.slice(), got: stats.badges.indexOf('allTools') >= 0 };
  });
  ok('存檔裡不認得的道具會被丟掉', toolClean.list.length === 6 &&
     toolClean.list.indexOf('laser') < 0 && toolClean.list.indexOf('railgun') < 0,
     toolClean.list.join(','));

  // 擺一組像玩過一陣子的紀錄再開面板，截圖才看得出版面
  await page.evaluate(() => {
    stats = freshStats();
    stats.destroyed = 7; stats.smashed = 8420; stats.wrecked = 742500;
    stats.spent = 168000; stats.poked = 23; stats.bestHit = 74; stats.carried = 6100;
    stats.built = ['吉薩金字塔', '中世紀城堡', '比薩斜塔', '羅馬競技場'];
    checkBadges(); hudLast = 0; hudTick(performance.now());
  });
  await page.click('#badgeBtn');
  ok('成就面板打得開', await page.evaluate(() => document.getElementById('badgeWrap').classList.contains('on')));
  await page.screenshot({ path: path.join(OUT, '05-成就.png') });
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
  /* 拆 4 座、擊飛 1234 塊 → 大槌(300)、保齡球(3 座)、龍捲風(1000) 開；
     投石機(6 座)、放火(8 座)、定時炸彈(10 座)、核彈(3000 塊)、爆裂魔法(15 座) 還鎖著 */
  const unlockedAfterReload = await page.evaluate(() =>
    [...document.querySelectorAll('.tool')].map(e => e.className.indexOf('lock') >= 0 ? 'lock' : 'open').join(','));
  ok('重開後解鎖狀態跟著回來',
     unlockedAfterReload === 'open,open,open,open,lock,open,lock,lock,lock,lock',
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

  /* ── 鍵盤平移 ──
     一律走真的鍵盤事件，listener 有沒有接上、e.code 對不對都一起測到。
     平移是在 frame() 裡推進的，running 關掉就不會動，所以先打開。 */
  const wasRunning = await page.evaluate(() => { const r = running; running = true; return r; });
  const resetPan = () => page.evaluate(() => {
    ENG.camTarget.tx = ENG.camTarget.tz = 0; ENG.cam.tx = ENG.cam.tz = 0;
  });
  const panBy = async (key, ms) => {
    await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key);
    return page.evaluate(() => ({ tx: ENG.camTarget.tx, tz: ENG.camTarget.tz }));
  };

  await resetPan();
  const wMove = await panBy('w', 250);
  ok('WASD 可以平移鏡頭', Math.hypot(wMove.tx, wMove.tz) > 1,
     '按住 W 250ms 移動了 ' + Math.hypot(wMove.tx, wMove.tz).toFixed(1) + ' 單位');

  /* 平移方向要以畫面為準。照世界軸走的話，轉過視角之後按 W 會往螢幕斜後方跑 */
  const dirs = [];
  for (const yaw of [0, Math.PI / 2]) {
    await page.evaluate(y => { ENG.cam.yaw = y; }, yaw);
    await resetPan();
    dirs.push(await panBy('w', 200));
  }
  let dAng = Math.abs(Math.atan2(dirs[1].tz, dirs[1].tx) - Math.atan2(dirs[0].tz, dirs[0].tx));
  if (dAng > Math.PI) dAng = 2 * Math.PI - dAng;
  ok('平移方向跟著視角轉，不是固定的世界軸', Math.abs(dAng - Math.PI / 2) < 0.2,
     '視角轉 90°，同一顆鍵的世界方向差 ' + (dAng * 57.3).toFixed(0) + '°');

  /* 草地是有限的圓島，推到底要停在場地邊緣，不能飄出去看到虛空 */
  const clamped = await page.evaluate(() => {
    ENG.camTarget.tx = ENG.camTarget.tz = 0;
    for (let i = 0; i < 600; i++) ENG.pan(1, 0.3, 0.05);
    return { d: Math.hypot(ENG.camTarget.tx, ENG.camTarget.tz), arena: arenaR };
  });
  ok('平移不會跑出場地', clamped.d <= clamped.arena + 0.01,
     '一直推 → 停在 ' + clamped.d.toFixed(1) + '，場地半徑 ' + clamped.arena.toFixed(1));

  const panReset = await page.evaluate(() => {
    ENG.camTarget.tx = 30; ENG.camTarget.tz = -20;
    startBuild(false);
    return { tx: ENG.camTarget.tx, tz: ENG.camTarget.tz };
  });
  ok('換一座建築鏡頭回到工地中心', panReset.tx === 0 && panReset.tz === 0,
     'tx ' + panReset.tx + '、tz ' + panReset.tz);

  await resetPan();
  await page.focus('#shape');
  await panBy('w', 200);
  const onSelect = await page.evaluate(() => {
    document.getElementById('shape').blur();
    return Math.hypot(ENG.camTarget.tx, ENG.camTarget.tz);
  });
  ok('焦點在建築下拉選單上時不搶鍵盤', onSelect < 0.01,
     '在選單上按 W，鏡頭移動 ' + onSelect.toFixed(2) + ' 單位');

  /* 按著 W 切去別的視窗，keyup 收不到，回來鏡頭會自己一直飄 */
  await resetPan();
  await page.keyboard.down('w');
  await page.waitForTimeout(150);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  const drift0 = await page.evaluate(() => Math.hypot(ENG.camTarget.tx, ENG.camTarget.tz));
  await page.waitForTimeout(250);
  const drift1 = await page.evaluate(() => Math.hypot(ENG.camTarget.tx, ENG.camTarget.tz));
  await page.keyboard.up('w');
  ok('視窗失焦會放開按鍵，鏡頭不會一直飄',
     drift0 > 0.5 && Math.abs(drift1 - drift0) < 0.01,
     '失焦當下 ' + drift0.toFixed(1) + '，再等 250ms 還是 ' + drift1.toFixed(1));

  await resetPan();
  await page.evaluate(r => { running = r; }, wasRunning);

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

  /* 取景距離跟畫面比例有關：轉成直式之後左右變窄，寬的地標得退更遠才框得住。
     resize 只更新 aspect 不重新取景的話，橫式轉直式就會把建築切掉。
     一定要挑又長又扁的金門大橋——高瘦的建築左右本來就不吃緊，轉向不該動距離，
     拿它來測會量到「沒變」然後誤判成壞掉。 */
  const prevShape = await page.evaluate(() => {
    const p = bp.idx; shapePick = 22; targetCnt = 900; startBuild(true); return p;
  });
  const distWide = await page.evaluate(() => ENG.camTarget.dist);
  await page.setViewportSize({ width: 620, height: 900 });
  await page.waitForTimeout(300);
  const distTall = await page.evaluate(() => ENG.camTarget.dist);
  ok('畫面比例變了會重新取景', distTall > distWide * 1.05,
     '金門大橋：橫式 ' + distWide.toFixed(1) + ' → 直式 ' + distTall.toFixed(1));
  await page.evaluate(i => { shapePick = i; startBuild(true); shapePick = -1; }, prevShape);

  /* 工具列一排排十種要 691px，視窗一窄就會壓到左上角的建築資訊卡。
     量之前一定要先把數字灌到最寬的狀態：累計金額變成七位數那一刻，
     資訊卡會從 266px 撐到 354px——用剛開新局的空帳號去量，會量到「沒撞到」的假象。 */
  await page.evaluate(() => {
    stats.destroyed = 128; stats.smashed = 987654; stats.spent = 1234567; stats.wrecked = 9876543;
    renderTools(); hudLast = 0; hudTick(performance.now());
  });
  // 1431 是斷點上緣的第一格：工具列還留在上面，剛好要閃過撐到最寬的資訊卡
  const widths = [1600, 1440, 1431, 1280, 1100, 900, 700];
  const clash = [];
  let statTxt = '', barAt = [];
  for (const w of widths) {
    await page.setViewportSize({ width: w, height: 800 });
    await page.waitForTimeout(120);
    const r = await page.evaluate(() => {
      const box = {};
      for (const id of ['head', 'time', 'tools', 'panelBtn', 'ver']) {
        const e = document.getElementById(id);
        if (getComputedStyle(e).display !== 'none') box[id] = e.getBoundingClientRect();
      }
      const bad = [], keys = Object.keys(box);
      for (let i = 0; i < keys.length; i++)
        for (let j = i + 1; j < keys.length; j++) {
          const a = box[keys[i]], b = box[keys[j]];
          if (a.right > b.left && b.right > a.left && a.bottom > b.top && b.bottom > a.top)
            bad.push(keys[i] + '×' + keys[j]);
        }
      return { bad, headW: Math.round(box.head.width), top: Math.round(box.tools.top),
               out: box.tools.left < -1 || box.tools.right > window.innerWidth + 1,
               txt: document.getElementById('stat').textContent.replace(/\s+/g, ' ').trim() };
    });
    statTxt = r.txt;
    barAt.push(w + '→' + (r.top < 200 ? '上' : '下'));
    if (r.bad.length) clash.push(w + 'px：' + r.bad.join('、'));
    if (r.out) clash.push(w + 'px：工具列超出畫面');
  }
  ok('量的時候資訊卡確實是最寬的狀態', /累計\s*\$1,234,567/.test(statTxt), statTxt);
  ok('桌機縮視窗，工具列不會壓到資訊卡', clash.length === 0,
     clash.join(' / ') || '工具列位置：' + barAt.join('、'));
  await page.evaluate(() => { stats = freshStats(); renderTools(); hudLast = 0; hudTick(performance.now()); });

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
  await page.screenshot({ path: path.join(OUT, '06-手機版.png') });

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

  /* 直式手機的水平視角比垂直窄得多，取景只算垂直 fov 的話寬的地標會被切掉：
     修之前 36 座有 24 座出界，金門大橋溢出六成。挑最寬的四座來守。 */
  const portraitFit = await page.evaluate(() => {
    const out = [];
    const v = new THREE.Vector3();
    for (const i of [22, 8, 33, 16]) {          // 金門大橋、萬里長城、嚴島神社鳥居、巨石陣
      shapePick = i; targetCnt = 3000; startBuild(true);
      for (let k = 0; k < bp.slots.length && k < blocks.length; k++) {
        const s = bp.slots[k], b = blocks[k];
        b.st = 3; b.x = s.x; b.y = s.y + HB; b.z = s.z;
      }
      for (let k = 0; k < 6; k++) ENG.updateCamera(1);      // dt=1 一次就收斂到目標距離
      const cam = ENG.three.camera;
      let worst = 0;
      for (let a = 0; a < 4; a++) {
        ENG.cam.yaw = a * Math.PI / 2 + 0.4;                // 長條形建築要轉一圈才量得到最寬那面
        ENG.updateCamera(0); cam.updateMatrixWorld();
        for (const s of bp.slots) {
          v.set(s.x, s.y + HB, s.z).project(cam);
          worst = Math.max(worst, Math.abs(v.x), Math.abs(v.y));
        }
      }
      out.push({ n: bp.name, worst });
    }
    shapePick = -1;
    return out;
  });
  const pWorst = portraitFit.reduce((a, r) => Math.max(a, r.worst), 0);
  ok('直式手機也框得住最寬的地標', pWorst < 1,
     portraitFit.map(r => r.n + ' ' + r.worst.toFixed(2)).join('、') + '（1 = 貼齊畫面邊）');

  /* 霧是給遠方地平線的，不能連建築本身一起吃掉。相機退得遠時霧沒跟著往後推的話，
     整座建築會白掉——直式手機的金門大橋要退到 460，而霧原本只到 316，吃霧 100%。
     直式是最嚴苛的情況（退得最遠），這裡守住桌機也不會出事。 */
  const fogHit = await page.evaluate(() => {
    let worst = -Infinity, name = '';       // 全都沒吃到霧時，也要記得住是哪一座最接近
    for (let i = 0; i < SHAPES.length; i++) {
      shapePick = i; targetCnt = 1500; startBuild(true);
      const f = ENG.three.scene.fog;
      // 建築中心到相機的距離就是取景距離，量它落在霧的哪一段
      const amt = (ENG.camTarget.dist - f.near) / (f.far - f.near);
      if (amt > worst) { worst = amt; name = bp.name; }
    }
    shapePick = -1;
    return { worst, name };
  });
  ok('霧不會把建築本身吃掉', fogHit.worst < 0.15,
     '最重的是 ' + fogHit.name + '，建築中心吃霧 ' +
     (Math.max(0, fogHit.worst) * 100).toFixed(0) + '%');

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

  /* 最貴的一幀是核彈剛炸完：三千塊碎料在飛，加上滿場的火球與蘑菇雲粒子。
     粒子上限從 420 拉到 560、又多了一組火球，這裡守住它沒有把成本翻上去。 */
  const perfBoom = await page.evaluate(() => {
    targetCnt = 3000; shapePick = 0; setWorkerCount(40); startBuild(true); completeNow();
    callNuke({ x: 0, z: 0 });
    for (let i = 0; i < 60; i++) step(0.016 * 3);       // 推到爆炸後不久
    const parts = dust.length + hot.length;
    let t = performance.now();
    for (let i = 0; i < 90; i++) step(0.016);
    const s = (performance.now() - t) / 90;
    t = performance.now();
    for (let i = 0; i < 90; i++) draw();
    const d = (performance.now() - t) / 90;
    return { step: s, draw: d, parts, blocks: blocks.length };
  });
  ok('核彈爆炸當下：CPU 每幀 < 4ms', perfBoom.step + perfBoom.draw < 4,
     perfBoom.blocks + ' 塊積木 + ' + perfBoom.parts + ' 顆粒子：step ' +
     perfBoom.step.toFixed(2) + 'ms + draw ' + perfBoom.draw.toFixed(2) + 'ms = ' +
     (perfBoom.step + perfBoom.draw).toFixed(2) + 'ms');

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
  await page.screenshot({ path: path.join(OUT, '07-結束畫面.png') });

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

