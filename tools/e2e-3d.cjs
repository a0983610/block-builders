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
const SHAPE_COUNT = 48;          // blueprints.js 內建的 SHAPES 數量
const CUSTOM_COUNT = 1;          // blueprints/ 資料夾裡預設附的自訂藍圖（範例小木屋）
const ALL_SHAPES = SHAPE_COUNT + CUSTOM_COUNT;

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
  ok('藍圖數量 = 內建 ' + SHAPE_COUNT + ' + 自訂 ' + CUSTOM_COUNT,
     boot.shapes === ALL_SHAPES, '實際 ' + boot.shapes);
  ok('開場就選好一座建築', !!boot.bp, boot.bp || '');
  ok('開場就是一座蓋好的建築', boot.phase === 'done' && boot.placed === boot.total && boot.total > 100,
     boot.bp + ' ' + boot.placed + '/' + boot.total + '，phase=' + boot.phase);
  ok('積木池已建立', boot.blocks > 100, boot.blocks + ' 塊');
  ok('小人已就位', boot.workers > 0, boot.workers + ' 人');

  /* 預設建材數：程式變數、freshPref、slider、標籤四個地方要一致，
     不然開場那座跟面板上寫的數字會對不起來 */
  const defCnt = await page.evaluate(() => ({
    target: targetCnt, fresh: freshPref().cnt,
    slider: document.getElementById('cnt').value,
    label: document.getElementById('vCnt').textContent,
    max: document.getElementById('cnt').max
  }));
  ok('預設建材 3000 塊', defCnt.target === 3000 && defCnt.fresh === 3000 &&
     defCnt.slider === '3000' && defCnt.label === '3000',
     'targetCnt=' + defCnt.target + '、freshPref=' + defCnt.fresh +
     '、slider=' + defCnt.slider + '（上限 ' + defCnt.max + '）、標籤 ' + defCnt.label);
  ok('開場那座就真的是 3000 塊上下', Math.abs(boot.total - 3000) / 3000 < 0.05,
     boot.bp + ' ' + boot.total + ' 塊');
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
  ok('每一座都產得出來（含自訂的）', bpAll.length === ALL_SHAPES,
     bpAll.length + ' / ' + ALL_SHAPES);
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
    const big = res.filter(r => r.t === 3000).sort((a, b) => b.err - a.err);
    return { worst: res[0], over50: res.filter(r => r.err > 0.5).length, total: res.length,
             bigOver: big.filter(r => r.err > 0.05).map(r => r.n + ' ' + r.c),
             bigWorst: big.slice(0, 3).map(r => r.n + ' ' + r.c) };
  });
  /* 有些造型（八節的 101、五座塔的吳哥）本身就有最少積木數，做不了太小的版本，
     所以驗兩件事：沒有任何一座離譜到 2 倍以上，而且超標的是少數。 */
  ok('積木數能自動對應目標',
     fitStat.worst.err < 1.6 && fitStat.over50 <= 6,
     fitStat.total + ' 組裡有 ' + fitStat.over50 + ' 組偏差 >50%；最差 ' +
     fitStat.worst.n + ' 目標 ' + fitStat.worst.t + ' 得到 ' + fitStat.worst.c);
  /* 預設值那一檔要抓緊：人力費算的是工時，塊數少的那座就明顯便宜。
     以前這裡最差差到 40%（鐵塔頂到尺度上限只長 1806 塊）。 */
  ok('預設 3000 塊時每座都貼近（48 座偏差都 <5%）',
     fitStat.bigOver.length === 0,
     '最遠的三座：' + fitStat.bigWorst.join('、') +
     (fitStat.bigOver.length ? '；超過 5% 的：' + fitStat.bigOver.join('、') : ''));

  /* 動物／交通工具／特殊這 12 座的設計前提是「整尊都站在地上」——
     不像風車扇葉、摩天輪車廂那樣有故意懸空的部件（那些靠 floats 機制管）。
     這裡守的是「座標算錯一格，整組就浮起來」這類錯：
     蒸汽火車第一版 3010 塊裡有 2976 塊連不到地面（只有排障器最底那排踩著地，
     底盤跟排障器中間差了三格 z）；木魚第一版魚身與坐墊之間空一格，951 塊整顆浮著。 */
  const grounded = await page.evaluate(() => {
    const NEW = ['大象', '暴龍', '長頸鹿', '貓咪', '蒸汽火車', '噴射客機', '大帆船', '雙層巴士',
                 '木魚', '大頭像', '聖誕樹', '巨型骰子'];
    const bad = [];
    let n = 0;
    for (const nm of NEW) {
      const i = SHAPES.findIndex(s => s.n === nm);
      if (i < 0) { bad.push(nm + ' 不存在'); continue; }
      n++;
      for (const t of [400, 3000]) {
        const b = makeBlueprint(i, t);
        const free = b.slots.filter(s => !s.anchor).length;
        if (free) bad.push(nm + '@' + t + ' 浮空 ' + free + '/' + b.slots.length);
      }
    }
    return { bad, n };
  });
  ok('新增的 12 座整尊都連得到地面', grounded.bad.length === 0 && grounded.n === 12,
     grounded.bad.join('、') || grounded.n + ' 座在 400 與 3000 塊都沒有一格浮空');

  /* ── 自訂藍圖（blueprints/ 資料夾） ──────────────────────
     機制是：list.js 列檔名 → index.html 逐一載入 → 檔案呼叫 customBlueprint()
     把自己接到 SHAPES 後面。之後就跟內建的走完全一樣的路。 */
  const custom = await page.evaluate(() => {
    const cs = SHAPES.filter(s => s.custom);
    const i = SHAPES.findIndex(s => s.custom);
    const sizes = [300, 1000, 3000].map(t => makeBlueprint(i, t).slots.length);
    /* 參數化的重點：每個尺寸都重畫一次，所以小尺寸也該畫得出每一種部件
       （門、窗、煙囪各自是不同的顏色索引，用到的顏色沒少就代表部件沒消失） */
    const colsAt = t => [...new Set(makeBlueprint(i, t).slots.map(s => s.c))].sort().join('');
    const parts = { min: colsAt(300), max: colsAt(3000) };
    const bpc = makeBlueprint(i, 1000);
    const optEls = [...document.querySelectorAll('#shape option')];
    const opts = optEls.map(o => o.textContent);
    const at = opts.indexOf(cs[0] ? cs[0].n : '@');
    return { n: cs.length, name: cs[0] ? cs[0].n : '', i, sizes, files: window.BP_FILES || [],
             parts, isGen: !cs[0].base,
             menuAt: at, menuVal: at >= 0 ? +optEls[at].value : -99, opts: opts.length,
             h: bpc.height, r: +bpc.radius.toFixed(1), pal: bpc.pal.length,
             ground: bpc.slots.filter(s => s.gy === 0).length,
             cols: [...new Set(bpc.slots.map(s => s.c))].sort() };
  });
  ok('blueprints/ 資料夾裡的自訂藍圖會被讀進來',
     custom.n === CUSTOM_COUNT && custom.i === SHAPE_COUNT && custom.files.length === CUSTOM_COUNT,
     'list.js 列了 ' + custom.files.join('、') + ' → 接在第 ' + custom.i + ' 個（內建 ' +
     SHAPE_COUNT + ' 座之後），名字「' + custom.name + '」');
  /* 選單第 0 項是「隨機」，自訂藍圖就緊接在後面（第 1 項）。
     同時守住那個關鍵不變量：排到前面只改顯示順序，option 的 value
     一定還是 SHAPES 的索引——不然選什麼都會蓋錯建築。 */
  ok('自訂藍圖排在下拉選單最前面，而且 value 還是 SHAPES 的索引',
     custom.menuAt === 1 && custom.menuVal === custom.i && custom.opts === ALL_SHAPES + 1,
     '「' + custom.name + '」在第 ' + custom.menuAt + ' 項（第 0 項是隨機）、value=' +
     custom.menuVal + '（SHAPES 第 ' + custom.i + ' 個），選單共 ' + custom.opts +
     ' 項（隨機 + ' + ALL_SHAPES + ' 座）');
  ok('自訂藍圖會跟著建材數縮放',
     custom.sizes[0] < 500 && custom.sizes[2] > 2400 && custom.sizes[2] > custom.sizes[0] * 4,
     '目標 300/1000/3000 得到 ' + custom.sizes.join(' / '));
  /* 範例藍圖示範的是參數化寫法（gen(v, s) 按 s 重畫），不是固定解析度的字元圖——
     說明文件叫 AI 這樣寫，附的範例自己要先做到。 */
  ok('範例藍圖是參數化寫的，縮到最小也不會掉部件',
     custom.isGen && custom.parts.min === custom.parts.max && custom.parts.min.length === 5,
     (custom.isGen ? 'gen(v,s)' : '字元圖') + '：300 塊用到顏色 ' + custom.parts.min +
     '、3000 塊用到 ' + custom.parts.max);
  ok('自訂藍圖的顏色與貼地層都正常',
     custom.pal === 5 && custom.ground > 0 && custom.cols.every(c => c >= 0 && c < 5),
     '顏色 ' + custom.pal + ' 種（用到 ' + custom.cols.join(',') + '）、貼地 ' +
     custom.ground + ' 格、高 ' + custom.h + '、半徑 ' + custom.r);
  /* 格式錯的檔案不能把整個遊戲弄壞：跳過那一份、在 console 留警告就好。
     （console.warn 不是 error，不會被「沒有 console 錯誤」那條抓到） */
  const badBp = await page.evaluate(() => {
    const n0 = SHAPES.length;
    const r = [customBlueprint({}),                                   // 沒 name
              customBlueprint({ name: '空的', layers: [] }),           // 沒圖
              customBlueprint({ name: '全空', layers: [['...', '...']] }),
              customBlueprint({ name: '吉薩金字塔', layers: [['1']] })]; // 撞號
    return { r, added: SHAPES.length - n0 };
  });
  ok('格式錯的自訂藍圖會被擋掉，不會弄壞遊戲',
     badBp.r.every(v => v === -1) && badBp.added === 0,
     '四種壞檔全部回傳 -1，SHAPES 沒有多出 ' + badBp.added + ' 座');

  /* 字元圖（layers）是給草稿用的備案路徑。範例藍圖已經改成參數化，所以它的覆蓋要自己補。
     重點在縮小：取樣點取的是輸出格「中心」而不是左邊界——取左邊界的話最後一列永遠取不到，
     而那一列就是最外面那面牆（1 格厚，掉一列就整面消失，實測小木屋縮到 300 塊時掉了兩面）。 */
  const gridBp = await page.evaluate(() => {
    const ring = ['1'.repeat(13)];
    for (let i = 0; i < 11; i++) ring.push('1' + '.'.repeat(11) + '1');
    ring.push('1'.repeat(13));
    const layers = [];
    for (let i = 0; i < 7; i++) layers.push(ring);
    const i = customBlueprint({ name: '測試用字元圖', pal: ['#c8a06a'], layers });
    if (i < 0) return { i };
    const sh = SHAPES[i];
    /* 四面外牆各自「該有的格數」＝ 跨距 × 層數。整面在就接近 1，被抽掉的話
       最外圈會退到內部那一圈，一層只剩兩個角，比值直接掉到 0.2 以下。 */
    const at = t => {
      const cells = genCells(sh, fitScale(sh, t)).cells();
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y1 = 0;
      for (const c of cells) {
        if (c.x < x0) x0 = c.x; if (c.x > x1) x1 = c.x;
        if (c.z < z0) z0 = c.z; if (c.z > z1) z1 = c.z;
        if (c.y > y1) y1 = c.y;
      }
      const ny = y1 + 1, sx = x1 - x0 + 1, sz = z1 - z0 + 1;
      const cnt = f => cells.filter(f).length;
      return { n: cells.length, size: sx + '×' + ny + '×' + sz,
               walls: [cnt(c => c.x === x0) / (sz * ny), cnt(c => c.x === x1) / (sz * ny),
                       cnt(c => c.z === z0) / (sx * ny), cnt(c => c.z === z1) / (sx * ny)]
                        .map(v => +v.toFixed(2)) };
    };
    const r = { i, lo: +sh.lo.toFixed(2), min: at(200), mid: at(300), big: at(3000) };
    SHAPES.pop();                       // 測完收掉，別影響後面掃全部 SHAPES 的測試
    return r;
  });
  ok('字元圖藍圖也會跟著建材數縮放', gridBp.i >= 0 &&
     gridBp.min.n < gridBp.big.n / 4,
     '基準 336 格（13×7×13）→ ' + gridBp.min.n + ' / ' + gridBp.mid.n + ' / ' + gridBp.big.n +
     ' 格（尺度下限 ' + gridBp.lo + '）');
  ok('字元圖縮小時四面外牆都還在',
     [gridBp.min, gridBp.mid, gridBp.big].every(a => a.walls.every(v => v >= 0.8)),
     '縮到最小 ' + gridBp.min.size + ' 時四面牆完整度 ' + gridBp.min.walls.join('／'));

  /* 金門大橋：跨距是奇數時 −L/2 是 .5，整條橋的 x 都變半格，
     吊索那行的 `x % 3 === 0` 永遠不成立 → 那個尺度整座橋沒有吊索，
     塊數比小一號的還少。修法是用整數半跨跑迴圈。 */
  const bridge = await page.evaluate(() => {
    const sh = SHAPES.find(s => s.n === '金門大橋');
    const cnt = [];
    for (let s = 40; s <= 78; s += 2) cnt.push(genCells(sh, s).m.size);
    let drops = 0;
    for (let i = 1; i < cnt.length; i++) if (cnt[i] < cnt[i - 1]) drops++;
    return { cnt, drops };
  });
  ok('金門大橋每個尺度都吊得出吊索（塊數不會忽然掉一截）', bridge.drops === 0,
     '尺度 40→78：' + bridge.cnt.slice(0, 3).join(',') + ' … ' + bridge.cnt.slice(-3).join(',') +
     '（' + bridge.drops + ' 處往下掉）');

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
     那些不是被打壞才浮著的，沒人動它就不該掉。48 座全部驗一遍。 */
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
  ok('48 座都不會無故掉塊', floaty.bad.length === 0,
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

  /* 支撐判定用 26 鄰居（角碰角就算連著），所以炸穿一面牆之後會留下「用一個角
     吊在半空」的積木或整坨。dropHung 專門收這種：基準線是藍圖的 f6
     （完好時六個面就連得到地面），本來這樣站著、現在只剩對角勾著的才掉。
     量法：打完之後從地面做一次 6 面連通，還活著卻連不到的就是漏網的。 */
  const hung = await page.evaluate(() => {
    const face = () => {
      const S = bp.slots, n = S.length;
      const here = new Uint8Array(n);
      for (const b of blocks) if (b.st === 3 && b.slot >= 0 && b.fallIn <= 0) here[b.slot] = 1;
      const F6 = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
      const seen = new Uint8Array(n), st = [];
      for (let i = 0; i < n; i++) if (here[i] && S[i].gy === 0) { seen[i] = 1; st.push(i); }
      while (st.length) {
        const s = S[st.pop()];
        for (const d of F6) {
          const j = bp.at.get(gkeyOf(s.gx + d[0], s.gy + d[1], s.gz + d[2]));
          if (j === undefined || seen[j] || !here[j]) continue;
          seen[j] = 1; st.push(j);
        }
      }
      let live = 0, bad = 0, badF6 = 0;
      for (let i = 0; i < n; i++) {
        if (!here[i]) continue;
        live++;
        if (seen[i]) continue;
        bad++;
        if (S[i].f6) badF6++;               // 本來六面站得住的才算漏網
      }
      return { live, bad, badF6 };
    };
    const run = name => {
      shapePick = SHAPES.findIndex(s => s.n === name);
      targetCnt = 1500; setWorkerCount(4); startBuild(true); completeNow();
      const f6 = bp.slots.filter(s => s.f6).length, all = bp.slots.length;
      explode({ x: siteR * 0.5, y: 1.2, z: 0 }, ROCK_R, ROCK_POW);   // 投石機石頭：最小的爆炸
      for (let i = 0; i < 300; i++) step(0.05);
      return { name, f6, all, ...face() };
    };
    /* 帝國大廈打三輪：同一發石頭有時候會引發整棟連鎖崩塌，剩幾塊是浮動的
       （實測八輪 0～641）。「還剩東西可驗」只要有一輪成立就夠，
       「沒有漏網的對角勾著」則是每一輪都必須成立。 */
    const box = [run('帝國大廈'), run('帝國大廈'), run('帝國大廈')];
    return { box: box[0], boxBad: box.reduce((s, r) => s + r.badF6, 0),
             boxLive: Math.max(...box.map(r => r.live)),
             boxAll: box.map(r => r.live), lat: run('艾菲爾鐵塔') };
  });
  ok('炸穿牆腳之後不會留下只靠對角勾著的積木',
     hung.boxBad === 0 && hung.boxLive > 100,
     '帝國大廈中一發石頭三輪：剩 ' + JSON.stringify(hung.boxAll) +
     ' 塊，只靠對角勾著的合計 ' + hung.boxBad + ' 塊（沒有這一關會留下一百多塊）');
  /* 反面：本來就靠斜格子疊起來的造型不歸這一關管，不然它們會自己解體。
     艾菲爾鐵塔完好時只有 672/1497 格是「六面連得到地面」。 */
  ok('斜格子造型不會被這一關誤殺',
     hung.lat.f6 < hung.lat.all * 0.5 && hung.lat.live > hung.lat.all * 0.75 &&
     hung.lat.bad > 400 && hung.lat.badF6 === 0,
     '艾菲爾鐵塔：完好時六面站得住的只有 ' + hung.lat.f6 + '/' + hung.lat.all +
     '；中一發石頭後還剩 ' + hung.lat.live + ' 塊，其中 ' + hung.lat.bad +
     ' 塊本來就是靠斜角連的（都還在）');

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

  /* 破壞打出來的洞排在派工游標「後面」，findSlot 是從游標往後掃、掃不到才回頭，
     所以不把游標退回去的話小人會先在上面蓋一大段才回頭補
     （改之前實測：中世紀城堡第一塊補回去要 10.5 秒，期間別處先蓋了 350 塊）。
     freeBlock 現在會把游標退到那個洞。 */
  const repair = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '中世紀城堡');
    targetCnt = 1200; setWorkerCount(30); startBuild(true);
    for (let i = 0; i < 1500 && phase === 'build'; i++) step(0.05);
    const S = bp.slots;
    const before = S.map(s => (s.filled ? 1 : 0));
    explode({ x: 0, y: 1, z: 0 }, 7, 18);
    for (let i = 0; i < 20; i++) step(0.05);
    const hole = new Set();
    for (let i = 0; i < S.length; i++) if (before[i] && !S[i].filled) hole.add(i);
    const cur = slotCursor, holes = hole.size;
    const mark = S.map(s => (s.filled ? 1 : 0));
    let fixed = 0, other = 0, first = -1, t = 0;
    for (let i = 0; i < 400; i++) {                 // 看爆炸後的 20 秒
      step(0.05); t += 0.05;
      for (let k = 0; k < S.length; k++) {
        if (!S[k].filled || mark[k]) continue;
        mark[k] = 1;
        if (hole.has(k)) { fixed++; if (first < 0) first = +t.toFixed(2); }
        else other++;
      }
    }
    return { holes, cur, fixed, other, first, phase };
  });
  /* 門檻取自 5 輪對照（同一個情境、爆炸後 20 秒）：
     退游標前 第一塊 9.4–12.3 秒、別處蓋 50–82 塊；退了之後 1.4–2.2 秒、別處 0–14 塊。
     兩邊都留兩倍以上的餘裕，才不會因為爆炸的隨機性時靈時不靈。 */
  ok('炸出來的洞會先補，不是繼續往上疊',
     repair.holes > 20 && repair.fixed > 20 && repair.first > 0 && repair.first < 5 &&
     repair.other <= 30,
     '洞 ' + repair.holes + ' 格：20 秒內補回 ' + repair.fixed + ' 格、別處只蓋了 ' +
     repair.other + ' 塊，第一塊補回去 ' + repair.first + ' 秒（爆炸當下游標在 ' + repair.cur + '）');

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

  /* ══════════ 完工慶祝 ══════════ */
  head('完工慶祝');
  /* 要讓它自己蓋到完工，不能用 completeNow：上一段測試把人放到地圖邊緣去遊蕩了，
     從 60 單位外走回工地本來就要七秒，量到的會是「走回來多久」而不是「圍圈多快」。
     真的蓋完的那一刻，人都還站在工地邊上——那才是這段要量的起點。 */
  const cheer = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 300; setWorkerCount(20); startBuild(true);
    for (let i = 0; i < 20000 && phase !== 'done'; i++) step(0.05);
    let allAt = -1, maxY = 0, jumps = 0, landed = 0, up = false, drift = 0, ring = null;
    const px = workers.map(w => w.x), pz = workers.map(w => w.z);
    for (let i = 0; i < 130; i++) {
      step(0.05);
      // 圈要在慶祝還沒結束時量：時間到了他們就散開去閒晃了
      if (i === 100) ring = workers.map(w => ({ d: +Math.hypot(w.x, w.z).toFixed(2),
                                                a: Math.atan2(w.z, w.x) }));
      if (allAt < 0 && workers.every(w => w.hail)) allAt = +(i * 0.05).toFixed(2);
      for (const w of workers) if (w.y > maxY) maxY = w.y;
      const w0 = workers[0];
      if (w0.y > 0.02 && !up) jumps++;            // 一次離地算一跳
      if (w0.y <= 0.02 && up) landed++;           // 每跳都要真的落回地面
      up = w0.y > 0.02;
      /* 就位之後就不該再有水平位移了（給一秒讓最後到的人站定）。
         舊版是繞著建築跑，這個數字會是每個人每一幀都在動。 */
      for (let k = 0; k < workers.length; k++) {
        const w = workers[k];
        if (allAt >= 0 && i * 0.05 > allAt + 1 && Math.hypot(w.x - px[k], w.z - pz[k]) > 1e-6) drift++;
        px[k] = w.x; pz[k] = w.z;
      }
    }
    // 圍成一圈：到中心的距離與相鄰角度差
    const ds = ring.map(r => r.d);
    const angs = ring.map(r => r.a).sort((a, b) => a - b);
    const gaps = angs.map((a, i) => {
      const b = i + 1 < angs.length ? angs[i + 1] : angs[0] + Math.PI * 2;
      return +((b - a) * 180 / Math.PI).toFixed(1);
    });
    // 慶祝完要散開去閒晃，不能一直杵在圈上
    for (let i = 0; i < 200; i++) step(0.05);
    const after = workers.filter(w => w.hail).length;
    const spread = Math.max(...workers.map(w => +Math.hypot(w.x, w.z).toFixed(2)));
    return { allAt, maxY: +maxY.toFixed(2), jumps, landed, drift,
             rad: { lo: Math.min(...ds), hi: Math.max(...ds), want: +(siteR + 2.6).toFixed(2) },
             gap: { lo: Math.min(...gaps), hi: Math.max(...gaps), want: +(360 / workers.length).toFixed(1) },
             after, spread, siteR: +siteR.toFixed(1) };
  });
  ok('蓋完後很快就圍成一圈', cheer.allAt > 0 && cheer.allAt < 2.5,
     cheer.allAt + ' 秒全員就位（照現況分配位置，不是照編號硬分）');
  ok('圍的是等分的一圈', cheer.gap.hi - cheer.gap.lo < 1 &&
     Math.abs(cheer.gap.lo - cheer.gap.want) < 1 && cheer.rad.hi - cheer.rad.lo < 0.1,
     '相鄰間隔 ' + cheer.gap.lo + '–' + cheer.gap.hi + '°（等分是 ' + cheer.gap.want +
     '°）、半徑 ' + cheer.rad.lo + '–' + cheer.rad.hi + '（建築 ' + cheer.siteR + ' + 2.6）');
  /* 慶祝感的重點是「跳」：離地要有高度、要落回地面、而且是站定了跳不是邊跑邊顛。
     舊版是繞著建築跑一圈，y 用 |sin| 連續起伏——那看起來像在漂浮。 */
  ok('站定原地跳，不是邊跑邊顛', cheer.jumps >= 5 && cheer.landed >= 5 &&
     cheer.maxY > 0.4 && cheer.drift === 0,
     '慶祝的六秒半裡跳 ' + cheer.jumps + ' 次、落地 ' + cheer.landed + ' 次，最高 ' +
     cheer.maxY + '；就位後還在水平移動的人次 ' + cheer.drift);
  ok('慶祝完就散開去閒晃', cheer.after === 0 && cheer.spread > cheer.rad.hi + 3,
     '還在舉手的 ' + cheer.after + ' 人，最遠走到 ' + cheer.spread);

  /* ══════════ 工程師 ══════════ */
  head('工程師');
  const engr = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 600; setWorkerCount(12); startBuild(true);
    const e = workers[0];
    let n = 0, carried = 0, claimed = 0, plan = 0, point = 0, near = Infinity, far = 0;
    const angs = [];
    /* 先等他走到定位再開始量，不然量到的第一段是「走過來」——上一段測試可能
       把他丟在四十單位外遊蕩，用寫死的秒數等會時靈時不靈。 */
    const ring = siteR + 3.4;
    for (let i = 0; i < 400 && Math.abs(Math.hypot(e.x, e.z) - ring) > 0.1; i++) step(0.05);
    for (let i = 0; i < 2400 && phase === 'build'; i++) {
      step(0.05);
      n++;
      if (e.carry) carried++;
      if (e.slot >= 0 || e.block >= 0) claimed++;
      if (e.plan) plan++;
      if (e.point > 0) point++;
      const d = Math.hypot(e.x, e.z);
      if (d < near) near = d;
      if (d > far) far = d;
      if (i % 200 === 0) angs.push(Math.round(Math.atan2(e.z, e.x) * 180 / Math.PI));
    }
    return { n, carried, claimed, planPct: +(plan / n).toFixed(2), pointPct: +(point / n).toFixed(2),
             near: +near.toFixed(1), far: +far.toFixed(1), siteR: +siteR.toFixed(1),
             moves: new Set(angs).size, others: workers.slice(1).filter(w => w.eng).length,
             placed: placedCnt, carriedAll: stats.carried };
  });
  ok('工程師只有一個，而且不搬積木', engr.others === 0 && engr.carried === 0 && engr.claimed === 0,
     '其他人當工程師的 ' + engr.others + ' 個；' + (engr.n * 0.05).toFixed(0) +
     ' 秒內他搬了 ' + engr.carried + ' 幀、認領了 ' + engr.claimed + ' 格（其他人共搬了 ' +
     engr.carriedAll + ' 趟）');
  ok('施工中一直拿著設計圖在看', engr.planPct === 1,
     '拿著圖的幀數占 ' + (engr.planPct * 100).toFixed(0) + '%');
  ok('站在建築外圍，會換位置但不會走進工地',
     engr.near > engr.siteR && engr.far < engr.siteR + 4 && engr.moves > 3,
     '離工地中心 ' + engr.near + '–' + engr.far + '（建築半徑 ' + engr.siteR +
     '），換過 ' + engr.moves + ' 個角度');
  ok('偶爾會做指揮動作', engr.pointPct > 0.03 && engr.pointPct < 0.5,
     '指揮的幀數占 ' + (engr.pointPct * 100).toFixed(0) + '%');
  /* 只有一個人的時候不能把他派去看圖，不然這座永遠蓋不起來 */
  const solo = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 300; setWorkerCount(1); startBuild(true);
    const eng1 = workers.filter(w => w.eng).length;
    for (let i = 0; i < 3000 && phase === 'build'; i++) step(0.05);
    const built = placedCnt;
    setWorkerCount(8);
    return { eng1, built, eng8: workers.filter(w => w.eng).length,
             idx: workers.findIndex(w => w.eng) };
  });
  ok('只剩一個人時不派工程師，照樣蓋得起來',
     solo.eng1 === 0 && solo.built > 30 && solo.eng8 === 1 && solo.idx === 0,
     '1 人時工程師 ' + solo.eng1 + ' 個、蓋了 ' + solo.built + ' 塊；加到 8 人後第 ' +
     solo.idx + ' 號接任');

  /* ══════════ 閒聊 ══════════ */
  head('閒聊');
  const chat = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 500; setWorkerCount(20); startBuild(true); completeNow();
    for (let i = 0; i < 200; i++) step(0.05);          // 先把慶祝跑完
    let starts = 0, frames = 0, samples = 0, broken = 0, maxD = 0, bub = 0, moved = 0;
    const durs = [];
    const seen = workers.map(() => 0);
    const px = workers.map(w => w.x), pz = workers.map(w => w.z);
    for (let i = 0; i < 2400; i++) {
      step(0.05);
      for (let k = 0; k < workers.length; k++) {
        const w = workers[k];
        samples++;
        if (w.chat > 0) {
          frames++;
          const p = workers[w.cw];
          if (!p || p.cw !== k || p.chat <= 0) broken++;      // 一定要兩邊互指
          else {
            const d = Math.hypot(p.x - w.x, p.z - w.z);
            if (d > maxD) maxD = d;
          }
          if (w.bub > 0.5) bub++;
          if (Math.hypot(w.x - px[k], w.z - pz[k]) > 1e-6) moved++;   // 聊天時不該移動
          // 開場就已經在聊的那幾場記成 -1：從中途開始數的長度不算數
          if (!seen[k]) { starts++; seen[k] = i > 0 ? i : -1; }
        } else if (seen[k]) {
          if (seen[k] > 0) durs.push(+((i - seen[k]) * 0.05).toFixed(2));
          seen[k] = 0;
        }
        px[k] = w.x; pz[k] = w.z;
      }
    }
    durs.sort((a, b) => a - b);
    return { pairs: starts / 2, pct: +(frames / samples).toFixed(2), broken, moved,
             maxD: +maxD.toFixed(2), bubPct: +(bub / (frames || 1)).toFixed(2),
             dur: durs.length ? [durs[0], durs[durs.length - 1]] : [] };
  });
  ok('閒晃時走近的兩個人會停下來聊天', chat.pairs >= 5 && chat.dur.length > 0,
     '兩分鐘內聊了 ' + chat.pairs + ' 場，占閒晃幀數 ' + (chat.pct * 100).toFixed(0) + '%');
  ok('一場聊 5 秒', chat.dur[0] >= 4.9 && chat.dur[1] <= 5.1,
     '每場 ' + chat.dur[0] + '–' + chat.dur[1] + ' 秒');
  ok('聊天一定是兩個人互指，而且站著不動',
     chat.broken === 0 && chat.moved === 0 && chat.maxD <= 2.61,
     '單向配對 ' + chat.broken + ' 幀、聊天中移動 ' + chat.moved + ' 幀、兩人最遠 ' + chat.maxD);
  /* 泡泡是輪流冒的：兩個人同時講話看起來像在吵架 */
  ok('說話的泡泡輪流冒', chat.bubPct > 0.3 && chat.bubPct < 0.7,
     '冒泡泡的幀數占聊天中的 ' + (chat.bubPct * 100).toFixed(0) + '%（輪流的話約一半）');
  /* 施工中不能聊天聊到不做事：有活幹的人 st 不會停在 idle */
  const busy = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 600; setWorkerCount(20); startBuild(true);
    let chatting = 0, working = 0;
    for (let i = 0; i < 1200 && phase === 'build'; i++) {
      step(0.05);
      for (const w of workers) {
        if (w.chat > 0 && (w.carry || w.st === 'pick' || w.st === 'build')) chatting++;
        if (w.st === 'pick' || w.st === 'build') working++;
      }
    }
    return { chatting, working, placed: placedCnt };
  });
  ok('手上有工作的人不會停下來聊天', busy.chatting === 0 && busy.working > 100,
     '搬運中聊天 ' + busy.chatting + ' 幀（同期有 ' + busy.working + ' 幀在搬運，蓋了 ' +
     busy.placed + ' 塊）');

  ok('拆完之後小人開始蓋新的', rebuild.mid > 20 && rebuild.ph0 === 'build',
     '蓋到 ' + rebuild.mid + ' / ' + rebuild.total + '（' + rebuild.ph0 + '）');
  ok('砸還沒蓋完的建築不會進入拆除中', rebuild.ph1 === 'build', 'phase=' + rebuild.ph1);
  ok('施工中被砸，小人會把洞補回去', rebuild.after > rebuild.hurt,
     '砸到剩 ' + rebuild.hurt + ' → 補回 ' + rebuild.after);

  /* 跌破門檻不會當場換場：最後那一下（常常是核彈）的火球跟碎料還在演，
     要站在原地等 SWAP_WAIT 秒才收拾。一幀一幀推，量「跌破」到「離開 wreck」隔多久。 */
  const lag = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 700; startBuild(true); completeNow();
    const gate = Math.floor(bp.slots.length * WRECK_AT), d0 = stats.destroyed;
    let t = 0, tUnder = -1, tSwap = -1, mid = null;
    for (let i = 0; i < 600 && tSwap < 0; i++) {
      if (tUnder < 0) {                       // 還沒跌破門檻就繼續砸
        const cand = blocks.filter(b => b.st === 3);
        if (cand.length) {
          const x = cand[Math.floor(Math.random() * cand.length)];
          smash(new THREE.Vector3(x.x, x.y, x.z), new THREE.Vector3(0.2, -0.95, 0.1).normalize());
        }
      }
      step(0.05); t += 0.05;
      if (tUnder < 0) { if (placedCnt <= gate) tUnder = t; continue; }
      // 等待中途取樣一次：這時候還不該有任何換場動作
      if (!mid && t - tUnder > 1.5) mid = { phase, doz: !!dozers, gained: stats.destroyed - d0 };
      if (phase !== 'wreck') tSwap = t;
    }
    return { gap: +(tSwap - tUnder).toFixed(2), mid, wait: SWAP_WAIT,
             phase, gained: stats.destroyed - d0, placed: placedCnt, gate };
  });
  ok('拆到門檻不會當場換場，先讓最後那一發演完',
     lag.mid && lag.mid.phase === 'wreck' && !lag.mid.doz && lag.mid.gained === 0,
     '跌破門檻（剩 ' + lag.gate + ' 以下）後 1.5 秒：phase=' +
     (lag.mid && lag.mid.phase) + '、推土機 ' + (lag.mid && lag.mid.doz ? '已進場' : '還沒來'));
  ok('等滿三秒才換下一座', lag.gap > lag.wait - 0.2 && lag.gap <= lag.wait &&
     lag.phase !== 'wreck' && lag.gained === 1,
     '隔 ' + lag.gap + ' 秒（設定 ' + lag.wait + '）後 phase=' + lag.phase +
     '，拆掉座數 +' + lag.gained);

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
    const wantN = Math.max(3, Math.min(6, Math.round(Math.PI * R * R / 160)));
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
    let sawPush = 0, maxSpd = 0, mFrames = 0;
    let inSite = 0, blDown = 0;
    while (phase === 'clear' && guard++ < 900) {
      const before = dozers ? dozers.list.map(m => ({ x: m.x, z: m.z })) : null;
      step(0.05);
      const d = dirtyOf();
      if (d > peak) peak = d;
      if (guard % 8 === 0) trail.push(heapOf());
      if (dozers && dozers.wait <= 0) {
        if (heap0 === 0) heap0 = heapOf();               // 開推那一刻最密的一格
        /* 鏟子該不該放下來只看位置：在工作範圍內就得放下。
           以前是「趕路抬起、推的時候放下」，機器抬著鏟子穿過工地的那一大段完全沒產出。 */
        for (const m of dozers.list) {
          mFrames++;
          if (m.st === 'push') sawPush++;
          if (Math.hypot(m.x, m.z) < siteClearR()) { inSite++; if (m.bl < 0.35) blDown++; }
        }
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
             sawPush, wantN, inSite, blDown, mFrames, maxSpd: +maxSpd.toFixed(1),
             lastIn: +(lastIn * 0.05).toFixed(1),
             gone: !dozers, phase, drove: +(g2 * 0.05).toFixed(1) };
  });
  /* 台數跟工地面積走：小工地 3 台就夠，大工地固定三台根本清不動
     （實測 siteR 44 的工地六秒半推出去 0 塊，全靠收尾彈掉）。上限 6 是畫面的容量。 */
  ok('推土機台數跟著工地大小走', doze.born === doze.wantN && doze.drawn === doze.born &&
     doze.born >= 3 && doze.born <= 6,
     doze.born + ' 台（面積換算要 ' + doze.wantN + ' 台），畫面上放了 ' + doze.drawn + ' 台');
  /* 以前是「趕路抬鏟、到位才放下」，機器抬著鏟子橫越工地那一段完全沒產出——
     實測吃掉三成到七成七的機器時間。現在鏟子只看位置：進了範圍就放下。 */
  /* 扣掉的那幾幀是鏟子放下來的緩降動畫（進場那一下 bl 從 1 降到 0 要幾幀），
     每台抓 3 幀的餘裕。 */
  ok('人在工地裡就一定在推，不會抬著鏟子空跑',
     doze.inSite > 50 && doze.blDown >= doze.inSite - doze.born * 3 &&
     doze.sawPush > doze.mFrames * 0.95,
     '範圍內 ' + doze.inSite + ' 幀，鏟子放下的有 ' + doze.blDown + ' 幀（差的是進場放鏟那幾幀）；' +
     '整段有 ' + (doze.sawPush / doze.mFrames * 100).toFixed(0) + '% 的機器時間在推');
  ok('車速在合理範圍，不會用飛的', doze.maxSpd > 3 && doze.maxSpd < 12,
     '最快 ' + doze.maxSpd + ' 單位／秒（小人走路是 6.8）');
  ok('整地時小人退出工地等，不會提早開工', doze.stillIn === 0 && doze.built === 0,
     '整完時還站在工地裡的有 ' + doze.stillIn + ' 人（最後一次有人在裡面是第 ' +
     doze.lastIn + ' 秒／共 ' + doze.secs + ' 秒），期間蓋了 ' + doze.built + ' 塊');
  /* 清得掉多少很看堆的位置，但門檻要有意義：改之前同一支量測是平均 27～33%
     （中世紀城堡四輪 15/18/32/43%），改之後 51～69%。門檻放四成，擋的是退步不是抖動。 */
  ok('機器真的把碎料推出去了，不是全靠收尾彈掉', doze.pushedOut > doze.cohort * 0.4,
     doze.cohort + ' 塊裡有 ' + doze.pushedOut + ' 塊被鏟出範圍（' +
     (doze.pushedOut / doze.cohort * 100).toFixed(0) + '%），收尾彈掉 ' + doze.kicked +
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
     dozAlign.calls + ' 個（整地中的機器共用一個 InstancedMesh，幾台都一樣）');

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

  /* 手上的積木被波及時要真的脫手：解除跟小人的綁定、回到散落佇列、掉到地上。
     上面兩條只比了「搬運中的總數有沒有變少」，那個 <= 永遠成立，證不到單一塊的下場。 */
  const unpar = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '中世紀城堡');
    targetCnt = 900; setWorkerCount(20); startBuild(true);
    for (let i = 0; i < 400; i++) step(0.05);
    // 逃命會讓人提早脫手，這裡要驗的是「被炸到才脫手」那條路徑，先關掉
    const orig = alertFlee; alertFlee = () => {};
    const held = [];
    for (let i = 0; i < workers.length; i++) {
      const b = workers[i].block;
      if (b >= 0 && (blocks[b].st === 1 || blocks[b].st === 2)) held.push({ w: i, b });
    }
    explode({ x: 0, y: 3, z: 0 }, 40, 30);
    alertFlee = orig;
    let stuck = 0, holder = 0, slot = 0;
    for (const o of held) {
      const b = blocks[o.b];
      if (b.st === 1 || b.st === 2) stuck++;                 // 還黏在手上
      if (b.holder >= 0) holder++;                           // 還記著是誰拿的
      if (b.slot >= 0) slot++;                               // 還占著藍圖格子
    }
    const hands = held.filter(o => workers[o.w].block >= 0 || workers[o.w].carry).length;
    for (let i = 0; i < 40; i++) step(0.05);
    const landed = held.filter(o => blocks[o.b].st === 0).length;   // FREE＝回到散落佇列
    return { n: held.length, stuck, holder, slot, hands, landed };
  });
  ok('被炸到時手上的積木會脫手、掉回散落佇列',
     unpar.n > 0 && unpar.stuck === 0 && unpar.holder === 0 && unpar.slot === 0 &&
     unpar.hands === 0 && unpar.landed === unpar.n,
     unpar.n + ' 塊在手上：黏著不放的 ' + unpar.stuck + ' 塊、還記著持有人的 ' + unpar.holder +
     ' 塊、還占著格子的 ' + unpar.slot + ' 塊；落地變回散料的 ' + unpar.landed + ' 塊');

  /* ══════════ 逃命 ══════════ */
  head('逃命');
  /* 核彈有 2.8 秒倒數、魔法陣有 6 秒——預告一出現，範圍內的人就該丟下東西往外跑。
     對照組把 alertFlee 換成空的，量「沒這個機制會被炸飛幾個」。 */
  const flee = await page.evaluate(() => {
    const run = on => {
      const orig = alertFlee;
      if (!on) alertFlee = () => {};
      shapePick = SHAPES.findIndex(s => s.n === '中世紀城堡');
      targetCnt = 900; setWorkerCount(20); startBuild(true);
      for (let i = 0; i < 400; i++) step(0.05);
      const near = workers.filter(w => Math.hypot(w.x, w.z) < NUKE_R);
      const d0 = near.map(w => Math.hypot(w.x, w.z));
      callNuke({ x: 0, z: 0 });
      const fleeing = workers.filter(w => w.flee > 0).length;
      // 預告期間不該有人還搬著積木、還占著格子；而且要越跑越遠
      let carry = 0, slot = 0, back = 0, maxPh = 0, prev = d0.slice();
      for (let i = 0; i < 60 && nuke; i++) {
        step(0.05);
        for (let k = 0; k < near.length; k++) {
          const w = near[k];
          if (w.flee <= 0) continue;
          if (w.carry) carry++;
          if (w.slot >= 0) slot++;
          const d = Math.hypot(w.x - 0, w.z - 0);
          if (d < prev[k] - 1e-6) back++;               // 往爆心跑＝方向錯了
          prev[k] = d;
        }
      }
      for (const w of near) if (w.gait > maxPh) maxPh = w.gait;
      for (let i = 0; i < 4; i++) step(0.05);
      const escaped = near.filter(w => Math.hypot(w.x, w.z) >= NUKE_R).length;
      const tossed = near.filter(w => w.air).length;
      for (let i = 0; i < 160; i++) step(0.05);
      alertFlee = orig;
      return { near: near.length, fleeing, carry, slot, back, escaped, tossed,
               gained: +(near.reduce((s, w, k) => s + prev[k] - d0[k], 0) / near.length).toFixed(1),
               stuckFlee: workers.filter(w => w.flee > 0).length,
               busy: workers.filter(w => w.st !== 'idle').length };
    };
    const on = run(true), off = run(false);
    /* 遠近各擺十個人，逃不逃得掉就不再看那一輪小人剛好站在哪裡：
       腳程 1.2 倍、倒數 2.8 秒、反應 0.15～0.55 秒 → 跑得動大約 20 單位。
       站在 26 的跑得出半徑 30，站在 4 的跑不到。 */
    const planted = (() => {
      shapePick = SHAPES.findIndex(s => s.n === '中世紀城堡');
      targetCnt = 900; setWorkerCount(20); startBuild(true);
      for (let i = 0; i < 60; i++) step(0.05);
      const far = [], nearW = [];
      workers.forEach((w, i) => {
        releaseWorker(w);
        const a = i / workers.length * Math.PI * 2, r = i % 2 ? 26 : 4;
        w.x = Math.cos(a) * r; w.z = Math.sin(a) * r; w.y = 0;
        (i % 2 ? far : nearW).push(w);
      });
      callNuke({ x: 0, z: 0 });
      // 軌跡彎不彎：起點到終點的直線距離 ÷ 實際走的路程。1 就是直線
      const tr = workers.map(w => ({ w, lx: w.x, lz: w.z, x0: w.x, z0: w.z, run: 0 }));
      for (let i = 0; i < 60 && nuke; i++) {
        step(0.05);
        for (const t of tr) {
          t.run += Math.hypot(t.w.x - t.lx, t.w.z - t.lz);
          t.lx = t.w.x; t.lz = t.w.z;
        }
      }
      const straight = tr.filter(t => t.run > 3)
        .map(t => Math.hypot(t.w.x - t.x0, t.w.z - t.z0) / t.run);
      const rad = workers.map(w => Math.hypot(w.x, w.z)).sort((a, b) => a - b);
      for (let i = 0; i < 4; i++) step(0.05);
      return { farOut: far.filter(w => Math.hypot(w.x, w.z) >= NUKE_R).length,
               farN: far.length, nearOut: nearW.filter(w => Math.hypot(w.x, w.z) >= NUKE_R).length,
               nearN: nearW.length,
               straight: +Math.min(...straight).toFixed(3),
               spread: +(rad[rad.length - 1] - rad[0]).toFixed(1) };
    })();
    // 魔法陣：六秒預告，圈內的人夠時間全部跑出去
    shapePick = SHAPES.findIndex(s => s.n === '中世紀城堡');
    targetCnt = 900; setWorkerCount(20); startBuild(true);
    for (let i = 0; i < 400; i++) step(0.05);
    const inRing = workers.filter(w => Math.hypot(w.x, w.z) < MAG_R);
    castMagic({ x: 0, z: 0 });
    const magFlee = workers.filter(w => w.flee > 0).length;
    for (let i = 0; i < 130 && magic; i++) step(0.05);
    const magOut = inRing.filter(w => Math.hypot(w.x, w.z) >= MAG_R).length;
    const magFar = Math.max(...inRing.map(w => Math.hypot(w.x, w.z)));
    return { on, off, planted, mag: { n: inRing.length, fleeing: magFlee, out: magOut,
                                      far: +magFar.toFixed(1) } };
  });
  ok('核彈倒數一出現，範圍內的人全部開始逃', flee.on.near > 5 && flee.on.fleeing >= flee.on.near,
     '半徑 30 內有 ' + flee.on.near + ' 人，' + flee.on.fleeing + ' 人進入逃命狀態');
  ok('逃命時會丟下手上的積木、放掉認領的格子',
     flee.on.carry === 0 && flee.on.slot === 0,
     '逃跑期間還搬著積木的有 ' + flee.on.carry + ' 幀、還占著格子的 ' + flee.on.slot + ' 幀');
  ok('跑的方向是背對爆心', flee.on.back === 0,
     '逃跑期間離爆心變近的取樣 ' + flee.on.back + ' 次');
  /* 跑得掉的逃過一劫、跑不掉的照樣被炸飛——腳程只有 1.2 倍就是為了留下這個差別。
     那一輪逃掉幾個很看小人剛好站在哪裡（實測 3～12/20），所以生死的部分改用
     下面「遠近各擺十個」那條驗，這裡只驗「整群人確實往外移動了」。 */
  ok('整群人真的往外跑了一段', flee.on.gained > 12 && flee.off.gained < 3,
     '平均離爆心多出 ' + flee.on.gained + ' 單位（關掉逃命機制只有 ' + flee.off.gained + '）');
  ok('離得夠遠的跑得掉、站在爆心那一帶的跑不掉',
     flee.planted.farOut === flee.planted.farN && flee.planted.nearOut === 0,
     '站在 26 的 ' + flee.planted.farOut + '/' + flee.planted.farN + ' 人逃出半徑 30，' +
     '站在 4 的 ' + flee.planted.nearOut + '/' + flee.planted.nearN + ' 人');
  /* 使用者回報「看起來像跑成一個圓圈」，兩個成因各驗一條：
     方向每幀重算會走成等角螺旋（改成起跑就定死一條直線）、
     安全距離給同一個值會讓所有人停在同一個圓上（改成每人各抽）。 */
  ok('逃跑路線是直的，不會繞著爆心畫圈', flee.planted.straight > 0.97,
     '最彎的一條，直線距離÷實走路程 = ' + flee.planted.straight + '（1 就是直線）');
  ok('停下來的位置不會排成一個圓', flee.planted.spread > 8,
     '停下時離爆心最遠與最近差 ' + flee.planted.spread + ' 單位');
  ok('炸完會回去工作，不會卡在逃命狀態',
     flee.on.stuckFlee === 0 && flee.on.busy > 0,
     '還在逃的 ' + flee.on.stuckFlee + ' 人，回去工作的 ' + flee.on.busy + ' 人');
  /* 下令那一刻在圈外的人不會被標記，但工地就在爆心上——他去撿料、去放積木都是往裡面走。
     只在下令那一刻掃一次的話，那些人會一路走進範圍裡被炸飛，看起來像完全沒在反應。
     所以預告範圍要留著，每幀掃：踏進來的當場開始逃。 */
  const walkIn = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '中世紀城堡');
    targetCnt = 900; setWorkerCount(24); startBuild(true);
    for (let i = 0; i < 200; i++) step(0.05);
    // 全部擺到圈外（下令時不會被標記），施法之後再一步一步推進去
    const plant = workers.slice(0, 10);
    const ang = plant.map((w, i) => i / plant.length * Math.PI * 2);
    plant.forEach((w, i) => {
      releaseWorker(w);
      w.x = Math.cos(ang[i]) * (MAG_R + 3.75); w.z = Math.sin(ang[i]) * (MAG_R + 3.75); w.y = 0;
    });
    castMagic({ x: 0, z: 0 });
    const tagged0 = plant.filter(w => w.flee > 0).length;   // 下令當下應該一個都沒有
    let frames = 0; const who = new Set();
    for (let i = 0; i < 120 && magic; i++) {
      step(0.05);
      plant.forEach((w, k) => {
        /* 還沒開始逃的，直接把他擺到更靠內的位置——模擬「去撿料、去放積木都是
           往裡面走」。用擺的不用推的：施工中的小人自己會往料堆（外圈）跑，
           推的力道跟他自己的腳程同級的話，會有一半的人根本走不進來。 */
        if (w.flee <= 0 && !w.air && w.burn <= 0) {
          /* 每一格都要明確在圈內或圈外：正好停在半徑上的話，浮點誤差會讓
             scareIn 判「在裡面」而這裡的 < 判「在外面」，一半的人就對不起來 */
          const r = Math.max(3, MAG_R + 3.75 - i * 0.5);
          w.x = Math.cos(ang[k]) * r; w.z = Math.sin(ang[k]) * r; w.y = 0;
        }
        if (w.air || w.burn > 0 || w.flee > 0) return;
        if (Math.hypot(w.x, w.z) < MAG_R) { frames++; who.add(k); }
      });
    }
    for (let i = 0; i < 4; i++) step(0.05);
    const r = { tagged0, frames, who: who.size, n: plant.length,
                tossed: plant.filter(w => w.air).length };
    /* 這一段真的炸了一次魔法陣，留下的煙雲、火星、光環會飄到後面幾段的畫面裡去
       （量到火球那段的過曝白像素從 0.38% 被壓到 0.23%）。自己收乾淨再走。 */
    clouds.length = 0; dust.length = 0; hot.length = 0;
    flashes.length = 0; fxRings.length = 0;
    clearFires();
    return r;
  });
  /* 每個踏進來的人最多只會被抓到一幀（掃描排在小人移動之前，所以是下一幀才喊）。
     自然情境下的同一份量測：改之前 428～660 幀、4～8 人被炸飛；改之後 3～6 幀、0 人。 */
  ok('預告期間走進範圍的人會當場開始逃',
     walkIn.tagged0 === 0 && walkIn.who === walkIn.n &&
     walkIn.frames <= walkIn.who && walkIn.tossed === 0,
     '下令時在圈外的 ' + walkIn.n + ' 人（標記到 ' + walkIn.tagged0 + ' 人），期間踏進範圍的 ' +
     walkIn.who + ' 人共被抓到 ' + walkIn.frames + ' 幀（每人最多一幀），最後被炸飛 ' +
     walkIn.tossed + ' 人');

  ok('魔法陣六秒預告，圈內的人來得及全部跑出去',
     flee.mag.n > 5 && flee.mag.fleeing >= flee.mag.n && flee.mag.out === flee.mag.n,
     '圈內 ' + flee.mag.n + ' 人全部起跑，跑出半徑 30 的有 ' + flee.mag.out +
     ' 人（最遠 ' + flee.mag.far + '）');

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
  /* 十二種工具的解鎖狀態拼成一長串很難讀，用「前 n 種開著」來寫 */
  const NTOOL = 12;
  const opened = n => Array(NTOOL).fill('false').fill('true', 0, n).join(',');
  const btnOpen = n => Array(NTOOL).fill('lock').fill('open', 0, n).join(',');
  ok('工具共 12 種', lock0.ids.length === NTOOL, lock0.ids.join(','));
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
    at('smashed', 500);
    at('destroyed', 2);
    at('destroyed', 4);
    at('smashed', 5000);
    at('destroyed', 8);
    at('smashed', 12000);
    at('destroyed', 12);
    at('smashed', 30000);
    at('destroyed', 18);
    at('smashed', 60000);
    stats = freshStats(); stats.destroyed = 18; stats.smashed = 60000; renderTools();     // 全開
    step2.push(TOOLS.map(t => toolOk(t)).join(','));
    return { step2, btn: [...document.querySelectorAll('.tool')].map(e => e.className.indexOf('lock') >= 0 ? 'lock' : 'open') };
  });
  /* 順序：手指／槌子／大槌／保齡球／投石機／龍捲風／煙火／放火／炸彈／隕石／核彈／魔法。
     兩種紀錄輪流當門檻，所以「擊飛」那幾關會順便開掉前面同一側的，但開不了另一側的。 */
  ok('擊飛 500 塊解鎖大槌', lock1.step2[0] === opened(3), lock1.step2[0]);
  ok('拆掉 2 座解鎖保齡球',
     lock1.step2[1] === 'true,true,false,true,false,false,false,false,false,false,false,false', lock1.step2[1]);
  ok('拆掉 4 座解鎖投石機',
     lock1.step2[2] === 'true,true,false,true,true,false,false,false,false,false,false,false', lock1.step2[2]);
  ok('擊飛 5,000 塊解鎖龍捲風',
     lock1.step2[3] === 'true,true,true,false,false,true,false,false,false,false,false,false', lock1.step2[3]);
  ok('拆掉 8 座解鎖煙火',
     lock1.step2[4] === 'true,true,false,true,true,false,true,false,false,false,false,false', lock1.step2[4]);
  ok('擊飛 12,000 塊解鎖放火',
     lock1.step2[5] === 'true,true,true,false,false,true,false,true,false,false,false,false', lock1.step2[5]);
  ok('拆掉 12 座解鎖定時炸彈',
     lock1.step2[6] === 'true,true,false,true,true,false,true,false,true,false,false,false', lock1.step2[6]);
  ok('擊飛 30,000 塊解鎖隕石',
     lock1.step2[7] === 'true,true,true,false,false,true,false,true,false,true,false,false', lock1.step2[7]);
  ok('拆掉 18 座解鎖核彈',
     lock1.step2[8] === 'true,true,false,true,true,false,true,false,true,false,true,false', lock1.step2[8]);
  ok('擊飛 60,000 塊解鎖爆裂魔法',
     lock1.step2[9] === 'true,true,true,false,false,true,false,true,false,true,false,true', lock1.step2[9]);
  ok('兩邊都推到頂就全開', lock1.step2[10] === opened(NTOOL), lock1.step2[10]);
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
    stats.destroyed = 9; stats.smashed = 99999; renderTools();
    document.querySelector('[data-tool="ball"]').click();
    return { blocked, after: tool };
  });
  ok('點鎖住的工具不會被選中', lockClick.blocked === 'hammer', '仍是 ' + lockClick.blocked);
  ok('解鎖後點得動', lockClick.after === 'ball', '選到 ' + lockClick.after);

  /* 工具選單平常收在小窗裡，滑鼠指上去才展開。要驗兩件事：
     收著的時候那塊區域是「透明的」（點下去要打到畫布，不能擋操作），
     以及小窗顯示的一定是現在拿的那把。 */
  await page.evaluate(() => { stats.destroyed = 18; stats.smashed = 60000; tool = 'hammer'; renderTools(); });
  const menuIdle = await page.evaluate(() => {
    const r = document.getElementById('tools').getBoundingClientRect();
    const mid = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { menu: getComputedStyle(document.getElementById('toolMenu')).visibility,
             now: getComputedStyle(document.getElementById('toolNow')).visibility,
             hit: mid ? mid.tagName : '—',
             label: document.getElementById('toolNow').textContent.replace(/\s+/g, ''),
             cur: document.getElementById('toolNow').dataset.cur };
  });
  ok('平常只看得到「現在拿什麼」的小窗，選單是收著的',
     menuIdle.menu === 'hidden' && menuIdle.now === 'visible',
     '小窗 ' + menuIdle.now + '、選單 ' + menuIdle.menu + '，小窗寫著「' + menuIdle.label + '」');
  ok('收著的選單不會擋住畫面', menuIdle.hit === 'CANVAS',
     '選單那塊區域點下去打到 ' + menuIdle.hit);

  await page.hover('#toolNow');
  await page.waitForTimeout(200);
  const menuOpen = await page.evaluate(() => ({
    menu: getComputedStyle(document.getElementById('toolMenu')).visibility,
    n: document.querySelectorAll('#tools .tool').length,
    on: [...document.querySelectorAll('#tools .tool.on')].map(e => e.dataset.tool).join(',')
  }));
  ok('滑鼠指到小窗才展開整份選單',
     menuOpen.menu === 'visible' && menuOpen.n === NTOOL && menuOpen.on === 'hammer',
     '展開後 ' + menuOpen.n + ' 個按鈕，標成「使用中」的是 ' + menuOpen.on);

  await page.click('#tools [data-tool="tornado"]');
  const picked = await page.evaluate(() => ({
    tool, cur: document.getElementById('toolNow').dataset.cur,
    label: document.getElementById('toolNow').textContent.replace(/\s+/g, ''),
    open: document.getElementById('toolbox').classList.contains('open')
  }));
  ok('選了哪把，小窗就換成哪把', picked.tool === 'tornado' && picked.cur === 'tornado' &&
     picked.label.indexOf('龍捲風') >= 0, '小窗寫著「' + picked.label + '」');

  /* 觸控沒有 hover：小窗自己要能點開，點畫面別的地方要收起來 */
  const tapMenu = await page.evaluate(() => {
    const box = document.getElementById('toolbox');
    box.classList.remove('open');
    document.getElementById('toolNow').click();
    const opened = box.classList.contains('open');
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    const closed = !box.classList.contains('open');
    document.getElementById('toolNow').click();
    document.querySelector('#tools [data-tool="hammer"]').click();   // 選完也要自己收
    return { opened, closed, afterPick: !box.classList.contains('open'), tool };
  });
  ok('觸控也能用：點小窗展開，點別處或選完就收起來',
     tapMenu.opened && tapMenu.closed && tapMenu.afterPick && tapMenu.tool === 'hammer',
     '點開 ' + tapMenu.opened + '、點別處收起 ' + tapMenu.closed +
     '、選完收起 ' + tapMenu.afterPick);
  await page.evaluate(() => { stats = freshStats(); tool = 'hammer'; renderTools(); });

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

  /* 槌子砸在空地上：不是點狀衝擊，而是整棟震一震，隨機一小部分自己掉下來。
     兩件事要分開驗：掉的量對不對、掉的位置是不是散在整棟（不是砸出一個洞）。 */
  const quakeT = await page.evaluate(() => {
    const one = (big) => {
      shapePick = SHAPES.findIndex(s => s.n === '中世紀城堡');
      targetCnt = 2000; startBuild(true); completeNow();
      shapePick = -1;
      const set0 = placedCnt;
      const at = blocks.map(b => b.st === 3 ? { x: b.x, y: b.y, z: b.z } : null);
      const hx = siteR + 9;                          // 建築外的空地
      launchHammer(new THREE.Vector3(hx, 0, 0), new THREE.Vector3(0, -1, 0), big, true);
      let g = 0;
      while (!quake && g++ < 20) step(0.05);         // 等槌子落下
      const born = !!quake, hitFrames = [];
      let prev = placedCnt;
      while (quake && g++ < 200) {
        step(0.05);
        if (placedCnt < prev) hitFrames.push(prev - placedCnt);
        prev = placedCnt;
      }
      const mid = placedCnt;
      for (let i = 0; i < 40; i++) step(0.05);       // 震完就該停了
      let near = 0, tot = 0, lo = 0, hi = 0;
      blocks.forEach((b, i) => {
        if (!at[i] || b.st === 3) return;
        tot++;
        if (Math.hypot(at[i].x - hx, at[i].z) < 10) near++;   // 掉在槌子那一帶的
        if (at[i].y < bp.height * 0.4) lo++; else hi++;
      });
      return { set0, born, fell: set0 - mid, frac: (set0 - mid) / set0,
               waves: hitFrames.length, after: mid - placedCnt,
               nearFrac: tot ? near / tot : -1, lo, hi };
    };
    const small = one(false), big = one(true);
    return { small, big };
  });
  ok('槌子砸空地會地震，震掉約 5% 的積木',
     quakeT.small.born && quakeT.small.frac > 0.045 && quakeT.small.frac < 0.09,
     quakeT.small.set0 + ' 塊掉了 ' + quakeT.small.fell + '（' +
     (quakeT.small.frac * 100).toFixed(1) + '%）');
  ok('是分好幾波掉的，不是同一幀全掉', quakeT.small.waves >= 4,
     '掉了 ' + quakeT.small.waves + ' 波');
  ok('震掉的散在整棟，不是在槌子那一帶砸出一個洞',
     quakeT.small.nearFrac >= 0 && quakeT.small.nearFrac < 0.35 &&
     quakeT.small.lo > 0 && quakeT.small.hi > 0,
     '落點 10 單位內只占 ' + (quakeT.small.nearFrac * 100).toFixed(0) +
     '%，下半部 ' + quakeT.small.lo + ' 塊、上半部 ' + quakeT.small.hi + ' 塊');
  /* 允許一點餘波：震掉的那批本來就是分批落下的（fallIn 按高度錯開），
     最後一兩塊落地時抽掉鄰居的支撐，連帶再掉一塊是對的物理。
     要擋的是「一直掉」不是「完全不掉」——實測十二輪 0～2 塊（門檻 0 會有三成機率誤判）。 */
  ok('震完就停，不會一直掉', quakeT.small.after <= 3,
     '地震結束後 2 秒又掉了 ' + quakeT.small.after + ' 塊');
  ok('大槌砸空地震得比較兇（兩倍）',
     quakeT.big.frac > quakeT.small.frac * 1.7 && quakeT.big.frac < 0.18,
     '槌子 ' + (quakeT.small.frac * 100).toFixed(1) + '% → 大槌 ' +
     (quakeT.big.frac * 100).toFixed(1) + '%');

  await reset(page, { shape: '吉薩金字塔', cnt: 900, workers: 4 });
  const ballR = await page.evaluate(() => {
    completeNow();
    const before = blocks.filter(b => b.st === 3).length;
    const p = { x: -42, y: 0, z: 5 };                  // 點在場邊的空地上
    launchBall(p);
    const born = !!ball, r = ball.r;
    const out = { d0: Math.hypot(ball.x - p.x, ball.z - p.z), y0: ball.y };
    let hit = 0, t = 0, settle = 0, hops = 0, apex = 0, moved = 0, maxAng = 0;
    let px = ball.x, pz = ball.z;
    for (let i = 0; i < 400 && ball; i++) {
      step(0.03); t += 0.03;
      if (!ball) break;
      hit = ball.hit; hops = ball.hops; maxAng = ball.ang;
      if (ball.y > r + 0.01) { settle = t; if (hops >= 1) apex = Math.max(apex, ball.y - r); }
      moved += Math.hypot(ball.x - px, ball.z - pz); px = ball.x; pz = ball.z;
    }
    return { before, after: blocks.filter(b => b.st === 3).length, hit, born, gone: !ball,
             settle: +settle.toFixed(2), life: +t.toFixed(2), hops, apex, spin: maxAng,
             moved, r, ...out };
  });
  ok('保齡球從你點的地方出手，而且是舉高了丟出去',
     ballR.born && ballR.d0 < 0.01 && ballR.y0 > ballR.r + 3,
     '起點就是落點（差 ' + ballR.d0.toFixed(2) + '），球心離地 ' + ballR.y0.toFixed(1));
  /* 彈跳要在前段結束：球水平 34 單位/秒，一直彈的話它是「飛」到建築上的，
     中間那段滾就不見了。所以除了「有彈」還要驗「什麼時候不再離地」。 */
  ok('像丟保齡球一樣先彈幾下，之後就一路滾',
     ballR.hops >= 2 && ballR.apex > 0.3 && ballR.settle < 1.2 &&
     ballR.life - ballR.settle > 0.5,
     '彈了 ' + ballR.hops + ' 下（第一次落地後還彈起 ' + ballR.apex.toFixed(1) +
     '），' + ballR.settle + ' 秒後不再離地，之後滾了 ' +
     (ballR.life - ballR.settle).toFixed(1) + ' 秒');
  ok('滾動角度跟滾過的距離對得上', Math.abs(ballR.spin - ballR.moved / ballR.r) < 0.5,
     '滾了 ' + ballR.moved.toFixed(0) + ' 單位、轉了 ' + ballR.spin.toFixed(1) + ' 弧度');
  ok('保齡球會撞飛沿路的積木', ballR.hit > 15 && ballR.after < ballR.before,
     'SET ' + ballR.before + ' → ' + ballR.after + '，撞飛 ' + ballR.hit + ' 塊');
  ok('滾不動之後會停下消失', ballR.gone);

  /* 丟出去的方向：朝建築中心，但每一發都帶一點隨機偏差 */
  const ballAim = await page.evaluate(() => {
    const p = { x: -30, y: 0, z: 0 };                  // 正對中心＝角度 0
    const a = [];
    for (let k = 0; k < 8; k++) { launchBall(p); a.push(Math.atan2(ball.vz, ball.vx)); }
    ball = null; ENG.hideBall();
    /* 判斷要用原始值，不能用四捨五入過的顯示值：偏差是 ±0.22 rad 的連續亂數，
       真的抽到 0.0003 這種小數字是完全正常的，但 toFixed(3) 會把它變成 0，
       「min > 0」就誤判成「這一發沒有隨機偏差」——實測 2000 輪有 1.7% 會這樣掛，
       而真的等於 0 的是 0 輪。uniq 同理，改成直接比浮點數本身（比 toFixed(4)
       少掉 8 發撞進同一格的 0.6% 誤判）。 */
    return { max: +Math.max(...a.map(Math.abs)).toFixed(3),
             min: +Math.min(...a.map(Math.abs)).toFixed(3),
             minRaw: Math.min(...a.map(Math.abs)),
             uniq: new Set(a).size, n: a.length, lim: BALL_SPREAD };
  });
  ok('球是朝建築丟的，但每一發角度都不一樣',
     ballAim.max <= ballAim.lim && ballAim.minRaw > 0 && ballAim.uniq === ballAim.n,
     ballAim.n + ' 發全部落在 ±' + ballAim.lim + ' rad 內（最大偏 ' + ballAim.max +
     '、最小 ' + ballAim.min + '），沒有兩發相同');

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
       而且會先把建築燒垮。數的是 nSpread（還站著的那種火）：碎料的火走另一份額度。 */
    for (const b of blocks) igniteBlock(b);              // 點到點不動為止
    const cap = { fires: nSpread, all: fires.length, hot: 0, HOT_MAX, FIRE_MAX };
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
     '還站著的 ' + fire.cap.fires + ' / ' + fire.cap.FIRE_MAX + ' 塊（連碎料共 ' +
     fire.cap.all + ' 塊在燒）');
  /* 火苗跟爆炸的火球共用同一個粒子池。整棟在燒時把池子吃光的話，
     這時候丟一發核彈就會沒有火球，所以火苗的配額除以 √(在燒的塊數)、並留一截給爆炸。 */
  ok('整棟在燒也不會把爆炸的火球配額吃光', fire.cap.hot < fire.cap.HOT_MAX - 30,
     fire.cap.FIRE_MAX + ' 塊在燒時 ' + fire.cap.hot + ' / ' + fire.cap.HOT_MAX + ' 顆火粒子');
  ok('換建築時火會一起收掉', fire.swap.fires === 0 && fire.swap.burning === 0,
     '換場後 ' + fire.swap.fires + ' 處在燒、' + fire.swap.burning + ' 塊還帶著火');

  /* ══════════ 碎料燃燒 ══════════
     爆炸打出來的碎料會帶著火飛出去，燒滿 3 秒變成一塊焦炭。
     一律拿大城堡的邊角開炸：塌不到 25%，量到一半才不會被「拆完換下一座」洗掉狀態。 */
  head('碎料燃燒');
  const emb2 = await page.evaluate(() => {
    running = false;
    const setup = () => {
      targetCnt = 3000; shapePick = SHAPES.findIndex(s => s.n === '中世紀城堡');
      setWorkerCount(6); startBuild(true); completeNow(); clearFires();
      const cand = blocks.filter(b => b.st === 3).sort((a, b) => b.x - a.x);
      return { x: cand[0].x, y: cand[0].y, z: cand[0].z };
    };

    /* 1. 這一發炸到的每一塊都要在燒。先自己算「範圍內有幾塊」，
       再跟點著的塊數對——只驗「有燒起來」的話，燒 5 塊跟燒 500 塊看起來一樣對。 */
    let p = setup();
    let inR = 0;
    for (const b of blocks) {
      if (b.st === 1 || b.st === 2) continue;                 // 小人手上的不算
      if ((b.x - p.x) ** 2 + (b.y - p.y) ** 2 + (b.z - p.z) ** 2 <= 121) inR++;
    }
    explode(p, 11, 17);
    const all = { inR, ember: fires.filter(f => !f.sp).length, spread: nSpread,
                  unlit: blocks.filter(b => b.st === 4 && !b.burn).length };

    // 2. 燒 3 秒：目標色一路往焦黑走，中點該剛好在一半
    const sample = fires.filter(f => !f.sp).slice(0, 40).map(f => f.b);
    const at = [];
    const snap = t => at.push({ t, tr: +sample[0].tr.toFixed(3),
                                burn: sample.filter(b => b.burn).length,
                                black: sample.filter(b => b.tr < 0.06).length });
    snap(0);
    for (let i = 0; i < 90; i++) step(1 / 60); snap(1.5);
    for (let i = 0; i < 90; i++) step(1 / 60); snap(3);
    for (let i = 0; i < 120; i++) step(1 / 60); snap(5);

    /* 3. 一塊碎料單獨燒：量準確的燒完時間，順便驗它燒完只是停在焦黑——
       建築那種火燒完會 breakBlock 再掉一次，碎料本來就在地上，不該再被打一次。 */
    p = setup();
    // 挑最底層那塊：一敲就落地躺好，3 秒後還在半空的話這條會分不出「燒完彈起來」
    const solo = blocks.filter(b => b.st === 3).sort((a, b) => a.y - b.y)[0];
    breakBlock(solo, 0, 0, 0);
    clearFires();
    igniteBlock(solo);                     // 要趁它還是 FLY：躺穩變 FREE 之後就點不著了
    const sm0 = stats.smashed, pl0 = placedCnt;
    let g = 0;
    while (solo.burn && g++ < 400) step(1 / 60);
    const one = { t: +(g / 60).toFixed(2), st: solo.st, tr: +solo.tr.toFixed(3),
                  sm: stats.smashed - sm0, pl: pl0 - placedCnt,
                  fires: fires ? fires.length : 0 };

    /* 4. 兩份額度分開：一發核彈級的爆炸點著上千塊碎料之後，
       還站著的照樣點得起來（共用一份額度的話這裡會回 false）。 */
    p = setup();
    explode(p, 30, 34);
    phase = 'done';               // 擋掉「拆完換下一座」——它會把火全收掉
    const stand = blocks.filter(b => b.st === 3 && !b.burn);
    const quota = { ember: fires.filter(f => !f.sp).length, spread: nSpread,
                    standing: stand.length, canLight: stand.length ? igniteBlock(stand[0]) : null };

    /* 5. 火苗要平順。同一幀點著上千塊，配額若從 0 起跳它們會同時湊滿一顆，
       火就變成「整片一起閃、然後一起沒有」。量 1 秒內每幀的火苗數，看谷底。 */
    const hots = [];
    for (let i = 0; i < 60; i++) { step(1 / 60); hots.push(hot.length); }
    const smooth = { min: Math.min(...hots.slice(20)), max: Math.max(...hots),
                     dust: dust.length };

    // 6. 效能：上千塊在燒的當下
    for (let i = 0; i < 12; i++) step(1 / 60);
    let t0 = performance.now();
    for (let i = 0; i < 60; i++) step(1 / 60);
    const stepMs = (performance.now() - t0) / 60;
    t0 = performance.now();
    for (let i = 0; i < 60; i++) draw();
    const drawMs = (performance.now() - t0) / 60;
    const perf = { fires: fires ? fires.length : 0, stepMs, drawMs };

    // 7. 不是爆炸的道具不該點火：投石機的石頭只是砸
    p = setup();
    const rockN = smash(p, { x: 0.12, y: -1, z: 0.12 }, ROCK_R, ROCK_POW);
    const rock = { n: rockN, fires: fires ? fires.length : 0 };

    // 8. 換場要把碎料的火與額度一起歸零
    p = setup();
    explode(p, 11, 17);
    startBuild(true);
    const swap = { fires: fires ? fires.length : 0, spread: nSpread,
                   burning: blocks.filter(b => b.burn).length };
    return { all, at, one, quota, smooth, perf, rock, swap };
  });
  ok('爆炸打出來的碎料每一塊都在燒',
     emb2.all.ember === emb2.all.inR && emb2.all.unlit === 0,
     '範圍內 ' + emb2.all.inR + ' 塊 → 點著 ' + emb2.all.ember +
     ' 塊碎料（另有 ' + emb2.all.spread + ' 塊還站著的餘火）');
  /* 目標色從建材色 0.80 線性收到焦黑 0.05，所以 1.5 秒該剛好在中點 0.425。
     只驗頭尾的話，燒 1 秒或燒 10 秒都會通過。 */
  ok('碎料燒 3 秒，顏色一路收到焦黑',
     Math.abs(emb2.at[1].tr - 0.425) < 0.02 && emb2.at[1].burn === 40 &&
     emb2.at[2].black === 40,
     '0 秒 ' + emb2.at[0].tr + ' → 1.5 秒 ' + emb2.at[1].tr + ' → 3 秒 ' + emb2.at[2].tr);
  ok('燒完就停在焦黑，不會恢復原色', emb2.at[3].burn === 0 && emb2.at[3].black === 40,
     '5 秒後 ' + emb2.at[3].black + ' / 40 塊還是黑的，' + emb2.at[3].burn + ' 塊還在燒');
  ok('單獨一塊碎料剛好燒 3.0 秒',
     Math.abs(emb2.one.t - 3) < 0.05 && emb2.one.tr < 0.06,
     '燒了 ' + emb2.one.t + ' 秒，收在 ' + emb2.one.tr);
  /* 建築那種火燒完會 breakBlock（再飛一次、記一次擊飛）。碎料走同一份程式碼，
     少了 f.sp 這道閘門的話，地上躺著的碎料會在燒完那一刻自己彈起來。 */
  ok('碎料燒完不會再被打掉一次',
     emb2.one.st === 0 && emb2.one.sm === 0 && emb2.one.pl === 0,
     '燒完 st=' + emb2.one.st + '（0=躺在地上）、擊飛 +' + emb2.one.sm + '、進度 -' + emb2.one.pl);
  ok('碎料的火不會吃掉建築那份額度',
     emb2.quota.ember > 500 && emb2.quota.canLight === true &&
     emb2.quota.spread < 150,
     emb2.quota.ember + ' 塊碎料在燒時，還站著的火只用了 ' + emb2.quota.spread +
     ' / 150，仍點得起來（' + emb2.quota.canLight + '）');
  ok('上千塊一起燒，火苗不會整片一起閃一起沒',
     emb2.smooth.min > 60 && emb2.smooth.max <= 190,
     '1 秒內火苗數 ' + emb2.smooth.min + ' ~ ' + emb2.smooth.max + ' 顆（煙 ' +
     emb2.smooth.dust + ' 團）');
  ok('上千塊碎料在燒：CPU 每幀 < 4ms', emb2.perf.stepMs + emb2.perf.drawMs < 4,
     emb2.perf.fires + ' 塊在燒：step ' + emb2.perf.stepMs.toFixed(2) + 'ms + draw ' +
     emb2.perf.drawMs.toFixed(2) + 'ms');
  /* 「爆炸類」才點火。投石機的石頭是砸不是炸，砸出來的碎料不該起火——
     一起燒的話這個道具會變成放火的低配版。 */
  ok('不是爆炸的道具不會把碎料點著', emb2.rock.n > 0 && emb2.rock.fires === 0,
     '投石機砸掉 ' + emb2.rock.n + ' 塊，起火 ' + emb2.rock.fires + ' 處');
  ok('換建築時碎料的火與額度一起歸零',
     emb2.swap.fires === 0 && emb2.swap.spread === 0 && emb2.swap.burning === 0,
     '換場後 ' + emb2.swap.fires + ' 處在燒、額度 ' + emb2.swap.spread +
     '、' + emb2.swap.burning + ' 塊還帶著火');

  /* ══════════ 煙火 ══════════
     它是「往天上灑火種」：一發打不掉任何積木，但落下來的火星碰到建築就從那一塊燒起來。 */
  head('煙火');
  await reset(page, { shape: '中世紀城堡', cnt: 2000, workers: 4 });
  const fw = await page.evaluate(() => {
    completeNow();
    clearFires();
    const set0 = placedCnt, d0 = ENG.camTarget.dist;
    launchFw({ x: 0, z: 0 });
    const dist = ENG.camTarget.dist;
    let top = 0, rise = 0, sparks = 0, burstY = 0, ndc = -9;
    while (fworks && rise < 4) { step(0.05); rise += 0.05; if (fworks) top = Math.max(top, fworks[0].y); }
    if (fwSparks) {
      sparks = fwSparks.length;
      burstY = fwSparks.reduce((s, x) => s + x.y, 0) / sparks;
      const v = new THREE.Vector3(fwSparks[0].x, fwSparks[0].y, fwSparks[0].z).project(ENG.three.camera);
      ndc = +v.y.toFixed(2);
    }
    const setAtBurst = placedCnt;
    /* 等火星飛完，數它點著了幾處、散得多開。
       火星的方向是隨機的，整發都落在空地上、或整發都擠在同一個角落，都是**正常**的，
       所以這裡連放三發看合計——要驗的是「火星真的會點著建築、而且不是只點一處」，
       不是「每一發都一定點得著」。每一發之前先 clearFires()，
       不然數到的會是上一發自己蔓延出去的火。
       三發是量出來的：中世紀城堡 2000 塊跑 60 輪，兩發合計有 1 輪散開只有 2.2
       （門檻是 4，也就是約 1.7% 會誤判）；三發 0/60，最差也散開 14.2。 */
    const shot = () => {
      let fall = 0;
      while (fwSparks && fall < 8) { step(0.05); fall += 0.05; }
      return { pts: (fires || []).filter(f => f.b.st === 3).map(f => ({ x: f.b.x, z: f.b.z })), fall };
    };
    const shots = [shot()];                 // 第一發在上面量爆開高度時就已經放上去了
    while (shots.length < 3) {
      clearFires();
      launchFw({ x: 0, z: 0 });
      let up = 0;
      while (fworks && up < 4) { step(0.05); up += 0.05; }
      shots.push(shot());
    }
    const pts = [].concat(...shots.map(s => s.pts));   // 散開程度算三發的聯集，不是各自算
    let spread = 0;
    for (const a of pts) for (const b of pts) spread = Math.max(spread, Math.hypot(a.x - b.x, a.z - b.z));
    return { set0, setAtBurst, top: +top.toFixed(1), rise: +rise.toFixed(2), sparks,
             burstY: +burstY.toFixed(1), ndc,
             seeds: pts.length, each: shots.map(s => s.pts.length), spread: +spread.toFixed(1),
             phase, d0: +d0.toFixed(0), dist: +dist.toFixed(0), fall: +shots[0].fall.toFixed(2),
             hold: +(FW_TOP * 2.1).toFixed(0) };
  });
  ok('煙火會從地面竄上天再炸開',
     fw.top > 30 && fw.rise > 0.8 && fw.rise < 2.5 && fw.sparks > 30,
     fw.rise + ' 秒竄到 ' + fw.top + '，炸開 ' + fw.sparks + ' 顆火星');
  /* 不退鏡頭的話整發都在畫面外（量過：貼著城堡的取景，火星的 NDC y 是 1.5，1 就出界了）。
     這裡驗兩件事：視距有被拉到煙火要的那個距離、火星確實落在畫面內。 */
  ok('炸開的高度框得進畫面（施放時鏡頭會退開）',
     fw.dist >= fw.hold && fw.ndc < 0.95 && fw.ndc > -1,
     '視距 ' + fw.d0 + ' → ' + fw.dist + '（煙火要 ' + fw.hold + '），火星 NDC y=' + fw.ndc);
  ok('炸開那一刻一塊積木都沒掉', fw.setAtBurst === fw.set0,
     fw.set0 + ' → ' + fw.setAtBurst + ' 塊（它是灑火種，不是爆炸）');
  ok('落下來的火星把建築點著，而且點在好幾個地方',
     fw.seeds >= 2 && fw.spread > 4 && fw.phase === 'wreck',
     '三發合計燒起來 ' + fw.seeds + ' 處（' + fw.each.join(' + ') +
     '），三發合起來最遠兩處相距 ' + fw.spread + '（phase=' + fw.phase + '）');
  const fwOff = await page.evaluate(() => {
    startBuild(true); completeNow(); clearFires();
    // 打在建築外的空地上：火星落在草地上就只是熄掉
    launchFw({ x: arenaR + 12, z: 0 });
    let g = 0;
    while ((fworks || fwSparks) && g++ < 400) step(0.05);
    return { fires: fires ? fires.length : 0, set: placedCnt, total: bp.slots.length, phase };
  });
  ok('掉在草地上的火星只是熄掉，不會憑空燒起來',
     fwOff.fires === 0 && fwOff.set === fwOff.total,
     '起火 ' + fwOff.fires + ' 處、建築仍是 ' + fwOff.set + '/' + fwOff.total + ' 塊');
  const fwSwap = await page.evaluate(() => {
    startBuild(true); completeNow();
    launchFw({ x: 0, z: 0 });
    for (let i = 0; i < 34; i++) step(0.05);          // 炸開了，火星還在天上
    const flying = fwSparks ? fwSparks.length : 0;
    startBuild(false);
    return { flying, left: (fworks ? fworks.length : 0) + (fwSparks ? fwSparks.length : 0) };
  });
  ok('換建築時還在飛的火星要收掉', fwSwap.flying > 0 && fwSwap.left === 0,
     '換場前 ' + fwSwap.flying + ' 顆在飛 → 換場後 ' + fwSwap.left + ' 顆');

  /* ══════════ 小人也會被拆除工具波及 ══════════
     邏輯跟碎料同一套：吹飛／推走／炸飛走彈道，落地那一刻才判定要不要燒起來。
     每個案例都自己把人擺到定位再動手——照原本的分布，人多半在遠處撿貨，
     量到的會是「沒打到」而不是「打到了沒反應」。 */
  head('小人被工具波及');
  await reset(page, { shape: '中世紀城堡', cnt: 900, workers: 20 });
  // 把人排在工地上，炸點就在他們中間
  const blown = await page.evaluate(() => {
    completeNow();
    workers.forEach((w, i) => {
      const a = i / workers.length * Math.PI * 2;
      w.x = Math.cos(a) * rr(3, 9); w.z = Math.sin(a) * rr(3, 9);
      w.y = 0; w.air = 0; w.burn = 0; w.fall = 0;
    });
    const p0 = workers.map(w => ({ x: w.x, z: w.z }));
    explode({ x: 0, y: 2, z: 0 }, 14, 17, false);
    const hit = { air: workers.filter(w => w.air).length, n: workers.length,
                  fall: workers.filter(w => w.fall > 0).length };
    let peak = 0, t = 0;
    while (workers.some(w => w.air) && t < 6) {
      step(0.05); t += 0.05;
      peak = Math.max(peak, ...workers.map(w => w.y));
    }
    const land = {
      t: +t.toFixed(2), peak: +peak.toFixed(1),
      burn: workers.filter(w => w.burn > 0).length,
      roll: workers.filter(w => w.roll).length,
      moved: +(workers.reduce((s, w, i) => s + Math.hypot(w.x - p0[i].x, w.z - p0[i].z), 0) / workers.length).toFixed(1),
      out: workers.filter(w => Math.max(Math.abs(w.x), Math.abs(w.z)) > arenaR + 22.5).length,
      busy: workers.filter(w => w.block >= 0 || w.carry).length
    };
    // 燒的中途看一眼：身上要有火、要在翻滾、不能回去工作
    for (let i = 0; i < 20; i++) step(0.05);
    const mid = { burn: workers.filter(w => w.burn > 0).length,
                  k: +Math.max(...workers.map(w => w.burnK)).toFixed(2),
                  busy: workers.filter(w => w.block >= 0 || w.carry).length,
                  hotNear: hot.filter(h => workers.some(w => Math.hypot(h.x - w.x, h.z - w.z) < 1.2)).length };
    for (let i = 0; i < 50; i++) step(0.05);            // 湊滿 3 秒＋
    const done = { burn: workers.filter(w => w.burn > 0).length,
                   y: +Math.max(...workers.map(w => w.y)).toFixed(2),
                   tilt: +Math.max(...workers.map(w => Math.abs(w.tilt))).toFixed(2),
                   k: +Math.max(...workers.map(w => w.burnK)).toFixed(2) };
    for (let i = 0; i < 60; i++) step(0.05);
    done.k2 = +Math.max(...workers.map(w => w.burnK)).toFixed(3);
    done.walking = workers.filter(w => w.gait > 0.1).length;
    return { hit, land, mid, done };
  });
  ok('爆炸會把小人炸飛，不是只有原地跌倒',
     blown.hit.air === blown.hit.n && blown.land.peak > 2 && blown.land.moved > 4,
     blown.hit.air + '/' + blown.hit.n + ' 人飛起來，最高 ' + blown.land.peak +
     '、平均被轟出 ' + blown.land.moved + ' 單位，滯空 ' + blown.land.t + ' 秒');
  ok('炸飛的人落地就燒起來，而且是就地打滾',
     blown.land.burn === blown.hit.n && blown.land.roll === blown.hit.n,
     blown.land.burn + ' 人著火，其中 ' + blown.land.roll + ' 人是打滾（站著被點的才跑圈圈）');
  ok('燒起來的人身上有火、身體會燒黑',
     blown.mid.hotNear > 20 && blown.mid.k > 0.5,
     '小人身上 ' + blown.mid.hotNear + ' 顆火苗，焦黑深度 ' + blown.mid.k);
  ok('燒的時候不會回去搬積木',
     blown.land.busy === 0 && blown.mid.busy === 0,
     '飛出去當下 ' + blown.land.busy + ' 人、燒到一半 ' + blown.mid.busy + ' 人還握著工作');
  ok('燒滿三秒站起來，顏色也褪回原色',
     blown.done.burn === 0 && blown.done.y === 0 && blown.done.tilt === 0 &&
     blown.done.k2 < 0.02 && blown.done.walking > 0,
     '3 秒後躺著的 ' + blown.done.burn + ' 人、傾角 ' + blown.done.tilt +
     '，焦黑 ' + blown.done.k + ' → ' + blown.done.k2 + '，走動中 ' + blown.done.walking + ' 人');
  ok('炸得再遠也不會被轟出草地', blown.land.out === 0,
     '越界 ' + blown.land.out + ' 人（邊界＝工地半徑 + 22）');

  /* 「停、躺、滾」：人是躺平之後**沿著身體長軸**滾（像滾木頭），不是頭上腳下翻筋斗。
     兩個轉軸都要驗，兩個都踩過雷：
     - 繞小人的原點（腳底）轉 → 傾角一過水平整個人插進地面下，最低到 y=-1.3，
       畫面上是「倒下去→消失→從另一邊冒出來」。要繞身體中段。
     - 繞身體的左右軸轉 → 那是翻筋斗，頭一下在上一下在下。要繞長軸。
     量法：讀 InstancedMesh 裡各部位的世界座標。 */
  const rollPose = await page.evaluate(() => {
    startBuild(true); completeNow();
    const w = workers[0];
    w.x = 0; w.z = 0; w.y = 0; w.a = 0; w.gait = 0; w.carry = false;
    w.plan = 0; w.bub = 0; w.scale = 1.2; w.roll = 0; w.tilt = 0; w.rspin = 0;
    const m = new THREE.Matrix4(), v = new THREE.Vector3();
    const pos = k => { ENG.three.workerMesh.getMatrixAt(k, m); v.setFromMatrixPosition(m); return v.clone(); };
    const read = () => {
      ENG.putWorker(0, w);
      let lo = 1e9, hi = -1e9;
      for (let k = 0; k < ENG.WPARTS; k++) {
        ENG.three.workerMesh.getMatrixAt(k, m);
        v.setFromMatrixPosition(m);
        // 道具（藍圖、泡泡）沒拿的時候縮成 0，位置沒意義，跳過
        if (m.elements[0] === 0 && m.elements[5] === 0) continue;
        if (v.y < lo) lo = v.y;
        if (v.y > hi) hi = v.y;
      }
      return { lo: +lo.toFixed(2), hi: +hi.toFixed(2), head: pos(1), leg: pos(3) };
    };
    const stand = read();                               // 站著（沒在打滾）當基準
    w.roll = 1; w.tilt = Math.PI * 0.5;                 // 躺平
    const poses = [];
    for (let i = 0; i < 12; i++) { w.rspin = i / 12 * Math.PI * 2; poses.push(read()); }
    w.roll = 1; w.tilt = 0; w.rspin = 0;
    const up = read();                                  // 打滾旗標開著、但還沒躺下
    w.roll = 0;
    const hy = poses.map(p => p.head.y);
    // 沿長軸滾的話頭一直在同一邊（車頭方向 a=0 → +Z），翻筋斗的話會前後甩
    const hz = poses.map(p => p.head.z), lz = poses.map(p => p.leg.z);
    return { stand: { lo: stand.lo, hi: stand.hi }, up: { lo: up.lo, hi: up.hi },
             flat: { lo: poses[0].lo, hi: Math.max(...poses.map(p => p.hi)) },
             lo: Math.min(...poses.map(p => p.lo)),
             headY: [+Math.min(...hy).toFixed(2), +Math.max(...hy).toFixed(2)],
             aheadMin: +Math.min(...hz.map((z, i) => z - lz[i])).toFixed(2) };
  });
  ok('打滾時整個人都在地面上，不會轉到地底下', rollPose.lo > -0.3,
     '滾一圈，最低的部位在 y=' + rollPose.lo + '（繞腳底轉的話會到 -1.3）');
  ok('打滾的樞紐不影響站姿',
     rollPose.up.lo === rollPose.stand.lo && rollPose.up.hi === rollPose.stand.hi,
     '站著 y=' + rollPose.stand.lo + '～' + rollPose.stand.hi +
     '，打滾旗標開著但還沒躺下時 y=' + rollPose.up.lo + '～' + rollPose.up.hi);
  ok('打滾時是躺在草地上，不是站著也不是浮著',
     rollPose.flat.hi < rollPose.stand.hi * 0.55 && rollPose.flat.lo > -0.3,
     '躺著時最高的部位只到 y=' + rollPose.flat.hi + '（站著是 ' + rollPose.stand.hi + '）');
  /* 滾木頭：頭全程貼著地面同一個高度、而且一直在腿的前方。
     翻筋斗的話頭會從 1.4 掃到 0、也會轉到腿的後面去。 */
  ok('滾的是身體長軸，不是頭上腳下翻筋斗',
     rollPose.headY[1] - rollPose.headY[0] < 0.05 && rollPose.headY[1] < 0.6 &&
     rollPose.aheadMin > 0.4,
     '滾一圈頭的高度 ' + rollPose.headY[0] + '～' + rollPose.headY[1] +
     '，頭一直在腿前方至少 ' + rollPose.aheadMin + ' 單位');

  /* 沿長軸滾當然是往**旁邊**移動，而且轉多少就該走多少（半徑 × 角度），
     不然看起來是一邊轉一邊在冰上滑。 */
  const rollMove = await page.evaluate(() => {
    startBuild(true); completeNow();
    const w = workers[0];
    w.x = 0; w.z = 0; w.y = 0; w.a = 0; w.air = 0; w.fall = 0; w.burn = 0;
    igniteWorker(w, true);
    // rspin 會對 2π 取餘數，總轉角要一幀一幀累加
    let prev = w.rspin, turned = 0;
    for (let i = 0; i < 20; i++) {
      step(0.05);
      let d = w.rspin - prev; if (d < 0) d += Math.PI * 2;
      turned += d; prev = w.rspin;
    }
    const fwd = w.x * Math.sin(w.a) + w.z * Math.cos(w.a);   // 沿車頭方向的位移
    const side = w.x * Math.cos(w.a) - w.z * Math.sin(w.a);  // 側向的位移
    return { fwd: +fwd.toFixed(2), side: +side.toFixed(2), turned: +turned.toFixed(2),
             ratio: +(Math.abs(side) / turned).toFixed(3) };
  });
  ok('滾的方向是身體側向，而且轉多少就走多少（不打滑）',
     Math.abs(rollMove.fwd) < 0.05 && rollMove.side < -0.5 &&
     Math.abs(rollMove.ratio - 0.28) < 0.03,
     '一秒滾了 ' + rollMove.turned + ' rad，側向走 ' + rollMove.side +
     '、正前方走 ' + rollMove.fwd + '（位移÷角度 = ' + rollMove.ratio + '，滾動半徑 0.28）');

  /* 龍捲風：吃的是跟碎料同一組力（切線繞圈＋往內吸＋往上捲），所以人也會被捲上天 */
  const twisted = await page.evaluate(() => {
    startBuild(true); completeNow();
    workers.forEach((w, i) => {
      const a = i / workers.length * Math.PI * 2;
      w.x = Math.cos(a) * rr(2, 7); w.z = Math.sin(a) * rr(2, 7);
      w.y = 0; w.air = 0; w.burn = 0; w.fall = 0;
    });
    launchTornado({ x: 0, z: 0 });
    let peak = 0, air = 0;
    for (let i = 0; i < 120; i++) {
      step(0.05);
      peak = Math.max(peak, ...workers.map(w => w.y));
      air = Math.max(air, workers.filter(w => w.air).length);
    }
    return { peak: +peak.toFixed(1), air, burn: workers.filter(w => w.burn > 0).length };
  });
  ok('龍捲風會把小人一起捲上天', twisted.air > 0 && twisted.peak > 15,
     '最多 ' + twisted.air + ' 人在空中，最高被捲到 ' + twisted.peak);
  ok('龍捲風不會點火，人落地只是摔一跤', twisted.burn === 0,
     '著火 ' + twisted.burn + ' 人');

  /* 保齡球：擋在球路上的被撞開。球速 34，人自己又一直在走——
     先讓球上路，再把人排到它正前方，不然量到的是「球從空地滾過去」。 */
  const bowled = await page.evaluate(() => {
    startBuild(true); completeNow();
    launchBall({ x: -30, y: 0, z: 0 });
    // 球是舉高了丟出去的，先等它落地開始滾——還在半空飛過頭頂時本來就不該撞到人
    let g = 0;
    while (ball && ball.y > ball.r + 0.1 && g++ < 200) step(0.05);
    workers.forEach((w, i) => {
      w.x = ball.x + 5 + (i % 5) * 1.7; w.z = (i % 3 - 1) * 0.6;
      w.y = 0; w.air = 0; w.burn = 0; w.fall = 0;
    });
    const p0 = workers.map(w => w.x);
    const top = workers.map(w => w.x);
    const flew = new Set();
    let air = 0;
    for (let i = 0; i < 60; i++) {
      step(0.05);
      workers.forEach((w, k) => { if (w.air) { flew.add(k); top[k] = Math.max(top[k], w.x); } });
      air = Math.max(air, workers.filter(w => w.air).length);
    }
    // 只看真的被撞飛的那些飛了多遠——沒被撞到的人自己也會走，混進來就不是這個數字
    const push = [...flew].map(k => top[k] - p0[k]).sort((a, b) => b - a);
    return { air, flew: flew.size, best: +(push[0] || 0).toFixed(1),
             burn: workers.filter(w => w.burn > 0).length };
  });
  ok('保齡球會把擋路的小人推走', bowled.flew > 0 && bowled.best > 4,
     bowled.flew + ' 人被撞飛（同時最多 ' + bowled.air + ' 人在空中），最遠往球的方向推了 ' +
     bowled.best + ' 單位');
  ok('保齡球也不會點火', bowled.burn === 0, '著火 ' + bowled.burn + ' 人');

  /* 放火點站著的人：抱頭跑圈圈——會一直動，但繞著被點著的那個位置轉，不會跑掉 */
  const torched = await page.evaluate(() => {
    startBuild(true); completeNow();
    const w = workers[0];
    w.x = 12; w.z = 0; w.y = 0; w.air = 0; w.burn = 0; w.fall = 0;
    const x0 = w.x, z0 = w.z;
    const lit = igniteWorker(w, false);
    let far = 0, path = 0, px = w.x, pz = w.z;
    for (let i = 0; i < 56; i++) {
      step(0.05);
      far = Math.max(far, Math.hypot(w.x - x0, w.z - z0));
      path += Math.hypot(w.x - px, w.z - pz); px = w.x; pz = w.z;
      }
    return { lit, roll: w.roll, far: +far.toFixed(1), path: +path.toFixed(1),
             gait: +w.gait.toFixed(2), y: +w.y.toFixed(2) };
  });
  ok('放火點著站著的小人 → 抱頭跑圈圈',
     torched.lit && !torched.roll && torched.far < 6 && torched.path > 14,
     '2.8 秒跑了 ' + torched.path + ' 單位，但離原地最遠只有 ' + torched.far +
     '（步伐 ' + torched.gait + '）');

  /* 燒不燒是在**落地那一刻**判定的，不是被打到的當下——所以不是被爆炸掃到的人，
     摔進一堆還在燒的碎料裡照樣會被引燃。 */
  const dropped = await page.evaluate(() => {
    startBuild(true); completeNow();
    // 弄一塊在燒的碎料躺在 (20,20)
    const b = blocks.find(x => x.st === 3);
    breakBlock(b, 0, 0, 0);
    b.x = 20; b.z = 20; b.y = 0.5; b.vx = b.vy = b.vz = 0;
    igniteBlock(b);
    const w = workers[0];
    w.x = 20; w.z = 20 - 3.69; w.y = 0; w.air = 0; w.burn = 0; w.fall = 0;
    tossWorker(w, 0, 8, 6, false);        // 沒有 lit：純粹被丟過去，落點才是關鍵
    const air0 = { air: w.air, burn: w.burn, lit: w.lit };
    let g = 0;
    while (w.air && g++ < 100) step(0.05);
    return { air0, burn: +w.burn.toFixed(2), roll: w.roll, fire: !!b.burn,
             d: +Math.hypot(w.x - b.x, w.z - b.z).toFixed(1) };
  });
  ok('摔進火堆裡的人也會被引燃（燒不燒是落地才算的）',
     dropped.air0.burn === 0 && !dropped.air0.lit && dropped.fire &&
     dropped.d < 2 && dropped.burn > 2.9 && dropped.roll === 1,
     '飛出去時沒著火 → 落在燒著的碎料旁 ' + dropped.d + ' 單位處，開始燒 ' +
     dropped.burn + ' 秒');


  /* 換場要把人身上的火收掉：積木會被回收去蓋新的那座，人也得回去上工 */
  const wswap = await page.evaluate(() => {
    workers.forEach(w => { w.y = 0; w.air = 0; w.fall = 0; igniteWorker(w, 1); });
    const before = workers.filter(w => w.burn > 0).length;
    startBuild(false);
    return { before, burn: workers.filter(w => w.burn > 0).length,
             air: workers.filter(w => w.air).length,
             k: +Math.max(...workers.map(w => w.burnK)).toFixed(2) };
  });
  ok('換建築時小人身上的火一起收掉',
     wswap.before > 0 && wswap.burn === 0 && wswap.air === 0 && wswap.k === 0,
     '換場前 ' + wswap.before + ' 人在燒 → 換場後 ' + wswap.burn + ' 人（焦黑 ' + wswap.k + '）');

  const wperf = await page.evaluate(() => {
    targetCnt = 2000; setWorkerCount(60); startBuild(true); completeNow();
    workers.forEach((w, i) => {
      const a = i / workers.length * Math.PI * 2;
      w.x = Math.cos(a) * rr(2, 12); w.z = Math.sin(a) * rr(2, 12);
      w.y = 0; w.air = 0; w.fall = 0; igniteWorker(w, i % 2);
    });
    for (let i = 0; i < 10; i++) step(0.05);
    const n = workers.filter(w => w.burn > 0).length;
    let t0 = performance.now();
    for (let i = 0; i < 30; i++) step(0.02);
    const stepMs = (performance.now() - t0) / 30;
    t0 = performance.now();
    for (let i = 0; i < 30; i++) { draw(); ENG.render(); }
    return { n, stepMs, drawMs: (performance.now() - t0) / 30, hot: hot.length };
  });
  ok('六十個人同時在燒：CPU 每幀 < 4ms', wperf.stepMs + wperf.drawMs < 4,
     wperf.n + ' 人在燒（火苗 ' + wperf.hot + ' 顆）：step ' + wperf.stepMs.toFixed(2) +
     'ms + draw ' + wperf.drawMs.toFixed(2) + 'ms');

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
    for (let i = 0; i < 4; i++) step(0.05);             // 2.15 秒：下墜中，還沒碰到樓頂
    const falling = blocks.filter(b => b.st === 3).length, inAir = !!nuke;
    const fallY = nuke ? nuke.y : -1, roof = bp.height;
    /* 掉到碰著建築才炸，所以不能數死步數。下墜末段一幀就掉快十單位，
       這裡把步長縮到 0.005 秒再逼近，記下的最後高度才等於接觸點。 */
    let boomY = -1, g = 0;
    while (nuke && g++ < 400) { boomY = nuke.y; step(0.005); }
    step(0.05); step(0.05);
    const set1 = blocks.filter(b => b.st === 3).length;
    let hitMax = 0;
    for (const b of blocks) if (b.st === 4) hitMax = Math.max(hitMax, Math.hypot(b.x, b.y - boomY, b.z));
    /* 爆炸當下該有的：火球（hot 粒子）＋ 貼地的衝擊環。
       這兩個都活不到一秒，所以要在爆完的那一刻量。 */
    const fire0 = hot.length, ring0 = fxRings.length;
    /* 冷卻要盯著「同一批粒子」看，不能看全場平均——蘑菇雲會一直補新的火光進來，
       平均值被新粒子拉高，就算每顆都有乖乖冷卻也測不出來。 */
    const sample = hot.filter(d => d.to);
    const avgG = a => a.reduce((s, d) => s + d.cg, 0) / Math.max(1, a.length);
    const lit0 = avgG(sample);
    /* 蘑菇雲那幾團的 fade 是 3.4／4／4.5，燒起來的煙是 2.2、隕石的尾煙 1.8。
       只認 d.fade 的話，爆炸點著的上千塊碎料冒的煙會被算成蘑菇雲——
       那個數字爆炸當下就有好幾十團，「雲是慢慢長出來的」就測不出來了。 */
    const cloudy = () => dust.filter(d => d.fade >= 3);
    const cloud0 = cloudy().length;
    for (let i = 0; i < 12; i++) step(0.05);            // 0.6 秒
    const lit1 = avgG(sample.filter(d => d.life > 0));
    let peak = 0, peakY = 0, y1 = 0;
    for (let i = 0; i < 12; i++) step(0.05);            // 爆後 1.2 秒：整朵雲該長齊了
    const cloud1 = cloudy().length;
    y1 = Math.max(...cloudy().map(d => d.y));
    for (let i = 0; i < 36; i++) {                      // 再 1.8 秒：雲往上飄
      step(0.05);
      const c = cloudy();
      if (c.length) peakY = Math.max(peakY, Math.max(...c.map(d => d.y)));
      peak = Math.max(peak, c.length);
    }
    const mid = cloudy();
    const midSize = mid.reduce((a, d) => a + d.s, 0) / Math.max(1, mid.length);
    for (let i = 0; i < 200; i++) step(0.05);           // 再 10 秒
    return { set0, wait, falling, inAir, fallY, roof, boomY, set1, hitMax, fire0, ring0, lit0, lit1,
             cloud0, cloud1, y1, peakY, peak, midSize,
             gone: cloudy().length, fireGone: hot.length,
             ringGone: fxRings.length, alive: !!nuke };
  });
  ok('核彈 2 秒內不會炸', nk.wait === nk.set0, nk.set0 + ' → ' + nk.wait);
  ok('2 秒後彈體才從天上掉下來', nk.inAir && nk.falling === nk.set0 && nk.fallY > nk.roof,
     '2.15 秒時彈體在 y=' + nk.fallY.toFixed(0) + '（樓頂 ' + nk.roof + '），建築仍是 ' +
     nk.falling + ' 塊');
  /* 炸點跟著接觸點走，不是固定在地面：打高樓時固定炸地面的話，上半截等於沒被炸到。
     這裡驗「炸在樓頂那一帶」——彈頭比模型原點再往前探一點，所以會比樓頂略高。 */
  ok('碰到建築的那一點就炸，不是穿到地面才炸',
     nk.boomY > nk.roof && nk.boomY < nk.roof + 5,
     '樓頂 ' + nk.roof + ' → 炸在 y=' + nk.boomY.toFixed(1));
  ok('炸開就是一大片，範圍約 30', nk.set1 < nk.set0 * 0.2 && nk.hitMax > 20 && nk.hitMax <= 31,
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
    while (nuke && nuke.t > NUKE_FALL) step(0.05);     // 兩秒倒數
    // 碰到樓頂就炸，步數是浮動的；末段用小步長逼近，boomY 才等於接觸點
    let boomY = -1, g = 0;
    while (nuke && g++ < 400) { boomY = nuke.y; step(0.005); }
    step(0.05);                                       // 爆後 0.05 秒
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
    return { born, on, off, hold, fade, left, sparkMin, capped, boomY };
  });
  /* 半徑走 sqrt，爆後第一幀（0.05 秒）就衝到一半以上——「一瞬間撐開」是刻意的，
     等速膨脹看起來像吹氣球。所以這裡量的是「一幀內有沒有到半徑的一半」。 */
  ok('爆炸中心有一顆實體火球，一幀就撐開、球心抬離爆點',
     flash.born.length === 1 && flash.born[0].r > 15 && flash.born[0].r < 20 &&
     Math.abs(flash.born[0].y - (flash.boomY + 30 * 0.22)) < 1.2,
     '爆後 0.05 秒半徑 ' + (flash.born[0] ? flash.born[0].r : '—') +
     '（上限 30）、球心 y=' + (flash.born[0] ? flash.born[0].y : '—') +
     '（爆點 ' + flash.boomY.toFixed(1) + ' + 抬升 6.6）');
  /* 絕對門檻一路在降：藍圖改瘦（0.5→0.42）讓建築長更高、取景拉遠，1.23% → 0.91%；
     核彈改成炸在接觸點之後，帝國大廈這一發是打在樓頂而不是腳邊，火球在畫面上的
     位置與遮擋都變了，再掉到 0.41%。這裡真正要驗的是「有火球才有過曝白」，
     所以看的是跟拿掉火球那幀的倍數關係，絕對值只當作「它沒有小到看不見」。 */
  ok('火球真的亮在畫面上', flash.on.pct > 0.25 && flash.on.pct > flash.off.pct * 3,
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
    /* 追蹤固定的一批：離陣心最遠那 40 塊。用「全部碎料的平均距離」當指標會被
       後來才扯下來、還在半路上的那些拉高，看不出這批到底有沒有被拉近。 */
    const far0 = blocks.filter(b => b.st === 3)
      .sort((a, b) => Math.hypot(b.x, b.z) - Math.hypot(a.x, a.z)).slice(0, 40);
    const farD = () => far0.reduce((s, b) => s + Math.hypot(b.x, b.z), 0) / far0.length;
    const mean0 = farD();
    const seq = [];
    const minD = far0.map(() => Infinity);   // 這 40 塊各自「最靠近陣心」到什麼程度
    let calm = -1, full = -1, preCrush = -1, crush = null;
    for (let i = 0; i < 119; i++) {                     // 5.95 秒
      step(0.05);
      if (i % 16 === 0) seq.push(magic ? magic.shown : -1);   // 每 0.8 秒取樣
      if (full < 0 && magic && magic.shown === 6) full = +((i + 1) * 0.05).toFixed(2);
      if (i === 89) calm = blocks.filter(b => b.st === 3).length;   // 4.5 秒：還沒開始扯
      if (i === 112) preCrush = blocks.filter(b => b.st === 3).length;  // 5.65 秒：收攏前一刻
      // 收攏是一次做完的，抓它發生的那一幀
      if (magic && magic.crush && !crush)
        crush = { left: +magic.t.toFixed(2), set: blocks.filter(b => b.st === 3).length };
      /* 收攏得看「最靠近時到哪」，不能只看爆炸前那一瞬間：扯是隨機的，
         最後幾幀才被扯下來的那幾塊還在半路上，會把當下的平均值整個拉高。 */
      if (i > 88) far0.forEach((b, j) => {
        const d = Math.hypot(b.x, b.z);
        if (d < minD[j]) minD[j] = d;
      });
    }
    const pulled = minD.reduce((s, v) => s + v, 0) / minD.length;
    const before = blocks.filter(b => b.st === 3).length, alive = !!magic;
    /* 爆炸前那一刻碎料擠在哪：陣把建築扯下來捲進陣心，所以這時候它們該全部聚在中間。
       跟施法當下建築本身的平均半徑比，才知道是「被吸過來」不是「本來就在那」。 */
    const meanOf = f => { const a = blocks.filter(f); return a.length
      ? a.reduce((s, b) => s + Math.hypot(b.x, b.z), 0) / a.length : 0; };
    const gathered = farD();
    const gatherY = far0.reduce((s, b) => s + b.y, 0) / far0.length;
    /* 推到真的爆開那一幀為止。寫死步數會踩到浮點邊界：0.05 累加 120 次不會剛好是 6，
       差一點點就變成「還沒爆」，後面量到的火球是空的。 */
    let g = 0;
    while (magic && g++ < 6) step(0.05);
    phase = 'done';    // 擋掉「拆完換下一座」：要留著現場量噴多遠，不然下一座已經開工了
    const fire = hot.length;
    const flashY = flashes.length ? flashes[flashes.length - 1].y : -1;
    const flew = meanOf(b => b.st === 4);
    for (let i = 0; i < 20; i++) step(0.05);            // 一秒：讓它們飛出去
    let hitMax = 0;
    for (const b of blocks) if (b.st === 4 || b.st === 0) hitMax = Math.max(hitMax, Math.hypot(b.x, b.z));
    const flew1 = meanOf(b => b.st === 4 || b.st === 0);
    for (let i = 0; i < 4; i++) step(0.05);             // 補到爆後 1.2 秒：雲該長齊了
    const cloud = dust.filter(d => d.fade >= 3).length;
    // 魔法版燒的是紅光、還會撒星光：粒子有自己的顏色（cr 有值）而不是灰白煙
    const tinted = dust.filter(d => d.fade >= 3 && d.cr !== undefined).length;
    return { set0, mean0, calm, seq, full, magTime: MAG_TIME, coreY: MAG_CORE_Y,
             preCrush, crush, crushAt: CRUSH_AT,
             before, alive, gathered, gatherY, pulled, flashY, flew, flew1,
             set1: blocks.filter(b => b.st === 3).length,
             hitMax, after: !!magic, fire, cloud, tinted };
  });
  ok('魔法陣是一層層長出來的', mg.seq[0] === 1 && mg.seq[mg.seq.length - 1] === 6 &&
     mg.seq.every((v, i) => i === 0 || v >= mg.seq[i - 1]), '每 0.8 秒取樣：' + mg.seq.join(' → '));
  /* 六層要快點長齊，「六層都在場上轉」那一段才留得久——那一段才是陣蓄滿的樣子。
     每層之間是 0.54 秒（擴張 0.24 ＋ 小火圈爬升 0.3），六層 2.94 秒長齊、滿陣還有 3 秒。
     火圈那一段是使用者要的效果，換來的是滿陣從 4.1 秒縮到 3 秒——所以下限就守在 2.9。 */
  ok('六層很快長齊，之後有一大段時間都是滿的',
     mg.full > 0 && mg.full < 3.1 && mg.magTime - mg.full > 2.9,
     mg.full + ' 秒就六層都在，滿陣狀態持續 ' + (mg.magTime - mg.full).toFixed(1) + ' 秒');
  /* 前四秒半只長陣、不動建築；最後一秒多才開始扯。兩段都要驗：
     只驗「六秒內沒爆」的話，第一秒就把建築拆光也會過。 */
  ok('前四秒半只長陣，不動建築', mg.calm === mg.set0 && mg.alive,
     '4.5 秒時 ' + mg.set0 + ' → ' + mg.calm + ' 塊');
  /* 收攏是**一幀之內一次做完**的，不是分好幾幀慢慢扯：分著扯的話，最後被扯下來的
     還在半路上就被炸開了——「脫離 → 收攏 → 炸開」對不起來就是這樣來的。 */
  ok('最後 0.3 秒才動手，而且整棟一次扯下來',
     mg.preCrush === mg.set0 && !!mg.crush &&
     mg.crush.left <= mg.crushAt && mg.crush.left > mg.crushAt - 0.06 && mg.crush.set === 0,
     '剩 0.35 秒時還是完好的 ' + mg.preCrush + ' 塊；剩 ' + (mg.crush ? mg.crush.left : '?') +
     ' 秒那一幀整棟脫離，剩 ' + (mg.crush ? mg.crush.set : '?') + ' 塊站著');
  ok('收攏剛好在爆炸那一刻到位（就在爆點上）',
     mg.pulled < mg.mean0 * 0.35 && mg.gathered < 5 &&
     Math.abs(mg.gatherY - mg.coreY) < 2,
     '最外圈那 40 塊原本離陣心 ' + mg.mean0.toFixed(1) + '，爆炸當下 ' +
     mg.gathered.toFixed(1) + '（最靠近 ' + mg.pulled.toFixed(1) + '），高度 ' +
     mg.gatherY.toFixed(1) + '（爆點 ' + mg.coreY.toFixed(1) + '）');
  /* 爆點要在最低那層的圓心上，不是地面：碎料被吸到那個高度，火球就該從那裡炸開。
     火球本體再往上抬 R×0.22（免得被自己炸出來的碎料堆埋掉），所以對得上 12.1 + 6.6。 */
  ok('爆點在最低層魔法陣的圓心上',
     Math.abs(mg.flashY - (mg.coreY + 30 * 0.22)) < 0.05,
     '火球中心 y=' + mg.flashY.toFixed(1) + '（陣心 ' + mg.coreY.toFixed(1) + ' + 抬升 6.6）');
  ok('六秒一到火球把它們全噴出去',
     mg.set1 < mg.set0 * 0.2 && !mg.after && mg.flew1 > mg.flew * 1.5 && mg.hitMax > 25,
     '爆炸當下離陣心 ' + mg.flew.toFixed(1) + ' → 一秒後 ' + mg.flew1.toFixed(1) +
     '，最遠 ' + mg.hitMax.toFixed(1));
  ok('魔法爆完也會留一朵蘑菇雲，而且是紅的', mg.fire > 50 && mg.cloud > 90 && mg.tinted === mg.cloud,
     mg.fire + ' 顆火球、1.2 秒後 ' + mg.cloud + ' 團煙（染紅的 ' + mg.tinted + ' 團）');

  /* 陣是一層層疊起來的，不是同心圓：層與層之間高度要遞增，
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

  /* 陣要**逆時針**慢慢轉。方向不能只看 spin 這個數字：紋路的角度是用
     (cos a, sin a) 擺到 (x, z) 上的，而畫面看下去 +Z 朝下，所以 a 變大在畫面上是順時針。
     這裡直接抓場上真的畫出來的那些紋路，投影到畫面看它往哪邊掃。 */
  const mgSpin = await page.evaluate(() => {
    startBuild(true); completeNow();
    castMagic({ x: 0, z: 0 });
    for (let i = 0; i < 100; i++) step(0.05);        // 5 秒：六層都在，紋路的編號不再變動
    draw(); ENG.render();
    const at = () => magic.rings.filter(o => !o.add).map(o => +o.spin.toFixed(4));
    const a = at();
    // 陣的紋路（螺旋臂與外圈虛線）都在 ringGroup 底下那顆 InstancedMesh 上
    let grp = null;
    ENG.three.scene.traverse(o => {
      if (!grp && o.geometry && o.geometry.type === 'RingGeometry') grp = o.parent;
    });
    const sp = grp.children.find(o => o.isInstancedMesh);
    const M = new THREE.Matrix4(), V = new THREE.Vector3();
    const posOf = i => { sp.getMatrixAt(i, M); return V.setFromMatrixPosition(M).clone(); };
    // 挑離陣心最遠的那一段：半徑越大，投影出來的角度變化越明顯
    let idx = 0, far = -1;
    for (let i = 0; i < sp.count; i++) {
      const q = posOf(i), d = Math.hypot(q.x - magic.x, q.z - magic.z);
      if (d > far) { far = d; idx = i; }
    }
    const proj = v => { const q = v.clone().project(ENG.three.camera); return [q.x, q.y]; };
    const c = proj(new THREE.Vector3(magic.x, posOf(idx).y, magic.z));
    const P0 = proj(posOf(idx));
    for (let i = 0; i < 8; i++) step(0.05);          // 0.4 秒
    draw(); ENG.render();
    const P1 = proj(posOf(idx));
    const b = at();
    // 畫面上（y 朝上）的外積 > 0 就是逆時針
    const cross = (P0[0] - c[0]) * (P1[1] - c[1]) - (P0[1] - c[1]) * (P1[0] - c[0]);
    return { a, b, cross, far: +far.toFixed(1),
             moved: a.every((v, i) => Math.abs(v - b[i]) > 1e-4),
             rate: Math.max(...a.map((v, i) => Math.abs(v - b[i]))) / 0.4,
             spread: new Set(a).size };
  });
  ok('魔法陣會逆時針轉', mgSpin.cross > 0 && mgSpin.moved,
     '0.4 秒裡最外圈那段紋路（離陣心 ' + mgSpin.far + '）在畫面上往逆時針掃，外積 ' +
     mgSpin.cross.toFixed(4));
  /* 「緩慢」也要驗：轉太快就變成電風扇。最快的那層一圈也要 11 秒以上。 */
  ok('而且是慢慢轉', mgSpin.rate > 0.1 && mgSpin.rate < 0.8,
     '最快的一層 ' + mgSpin.rate.toFixed(2) + ' rad/s（一圈 ' +
     (6.283 / mgSpin.rate).toFixed(0) + ' 秒）');
  ok('但每一層的紋路角度各自不同', mgSpin.spread === mgSpin.a.length,
     mgSpin.a.length + ' 層裡有 ' + mgSpin.spread + ' 種角度');

  /* 展開的方式：由下往上一層一層長，中間靠一個小火圈把火帶上去——
     先出現最下面那層 → 小火圈從它的圓心升到上一層的高度 → 抵達才擴張成新的一層。
     兩件事都要驗：火圈真的在爬（不是原地閃），而且「爬完才多一層」，
     不然它就只是個裝飾，六層還是各自憑空亮起來。 */
  const mgSeed = await page.evaluate(() => {
    const lay = MAG_LAYER.map(L => +(0.12 + MAG_R * L.y).toFixed(2));
    const coreY = () => magic.rings.filter(o => !o.add && !o.seed).map(o => +o.y.toFixed(2));
    const seedY = () => {
      const s = magic.rings.find(o => o.seed && !o.add);
      return s ? +s.y.toFixed(2) : -1;
    };
    // 每次施法都要從最下面那層開始（不再洗順序）
    const firsts = [];
    for (let k = 0; k < 4; k++) {
      startBuild(true); completeNow(); castMagic({ x: 0, z: 0 });
      for (let i = 0; i < 4; i++) step(0.05);        // 0.2 秒：只該有最下面那層
      firsts.push({ n: coreY().length, y: coreY()[0] });
    }
    // 追第一段的爬升：0.7 秒剛好走完「長第一層 → 火圈上升 → 長第二層」
    startBuild(true); completeNow(); castMagic({ x: 0, z: 0 });
    const trail = [];
    for (let i = 0; i < 14; i++) { step(0.05); trail.push({ n: coreY().length, s: seedY() }); }
    const up = trail.filter(o => o.s > 0);
    return { lay, firsts,
             steps: up.length, rising: up.length > 3 && up.every((o, i) => i === 0 || o.s > up[i - 1].s),
             lo: up.length ? up[0].s : -1, hi: up.length ? up[up.length - 1].s : -1,
             whileRising: up.every(o => o.n === 1), after: trail[trail.length - 1].n,
             seedGone: trail[trail.length - 1].s < 0 };
  });
  ok('一定從最下面那層開始長，不再洗出現順序',
     mgSeed.firsts.every(f => f.n === 1 && Math.abs(f.y - mgSeed.lay[0]) < 0.01),
     '四次施法在 0.2 秒時都只有 1 層、高度 ' + mgSeed.firsts.map(f => f.y).join('／') +
     '（最下層在 ' + mgSeed.lay[0] + '）');
  ok('小火圈從下面那層升到上一層，升到位才長出新的一層',
     mgSeed.rising && mgSeed.whileRising && mgSeed.after === 2 && mgSeed.seedGone &&
     Math.abs(mgSeed.lo - mgSeed.lay[0]) < 1.5 && Math.abs(mgSeed.hi - mgSeed.lay[1]) < 1.5,
     '火圈' + mgSeed.steps + ' 幀從 y' + mgSeed.lo + ' 升到 y' + mgSeed.hi +
     '（第一層 ' + mgSeed.lay[0] + ' → 第二層 ' + mgSeed.lay[1] +
     '），升的過程中都只有 1 層，抵達後變 ' + mgSeed.after + ' 層、火圈收掉');
  /* 整疊都浮在半空：最下層離地也有一段，而且不做滿爆炸半徑——
     做滿的話那一圈會比建築大一大圈，看起來像地上的跑道而不是浮空的陣。 */
  ok('最下層浮在半空，也沒有大到蓋滿爆炸範圍',
     mgRing.rings[0].y > 8 && mgRing.ground < 30 * 0.8,
     '最下層離地 ' + mgRing.rings[0].y + '、半徑 ' + mgRing.ground + '（爆炸範圍 30）');
  /* 整疊要夠高。最寬那圈直徑就有 37，疊得矮的話遠看是一疊盤子不是一座法陣——
     這條線是使用者反映「太扁平」之後訂的。 */
  ok('整疊夠高，不是扁扁的一疊',
     mgRing.rings[5].y - mgRing.rings[0].y > 20,
     '最下層 ' + mgRing.rings[0].y + ' → 最上層 ' + mgRing.rings[5].y +
     '（高 ' + (mgRing.rings[5].y - mgRing.rings[0].y).toFixed(1) + '，最寬半徑 ' +
     Math.max(...mgRing.rings.map(o => o.r)).toFixed(1) + '）');

  /* 拉高之後整疊頂端會頂出畫面上緣（矮建築取景近）。跟龍捲風、蘑菇雲同一套：
     施法期間鏡頭先退開。NDC y 超過 1 就是被切掉，量的是最上層外緣那一點。 */
  const mgCam = await page.evaluate(() => {
    const one = shape => {
      shapePick = SHAPES.findIndex(s => s.n === shape);
      targetCnt = 800; startBuild(true); completeNow();
      for (let i = 0; i < 200; i++) step(0.05);        // 先讓上一發的運鏡收乾淨
      const d0 = ENG.cam.dist;
      castMagic({ x: 0, z: 0 });
      for (let i = 0; i < 100; i++) step(0.05);        // 5 秒：六層都在
      const top = Math.max(...magic.rings.map(o => o.y));
      const wide = magic.rings.reduce((s, o) => Math.max(s, o.r), 0);
      const v = new THREE.Vector3(wide, top, 0).project(ENG.three.camera);
      return { d0: +d0.toFixed(0), dist: +ENG.cam.dist.toFixed(0),
               top: +top.toFixed(1), ndc: +v.y.toFixed(2) };
    };
    const r = { pyramid: one('吉薩金字塔'), castle: one('中世紀城堡') };
    shapePick = -1;
    return r;
  });
  ok('施法時鏡頭會退開，整疊才進得了畫面',
     mgCam.pyramid.dist > mgCam.pyramid.d0 * 1.2 &&
     mgCam.pyramid.ndc < 0.95 && mgCam.castle.ndc < 0.95,
     '吉薩金字塔視距 ' + mgCam.pyramid.d0 + ' → ' + mgCam.pyramid.dist +
     '，頂端 NDC ' + mgCam.pyramid.ndc + '／城堡 ' + mgCam.castle.ndc);

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
    /* 建築要指定：外圈那些積木是「被吸的對象」，隨機藍圖抽到小又矮的話
       siteR 會被 7 這個下限撐開，一塊都選不到，量到的就是 0 塊在吸。 */
    shapePick = SHAPES.findIndex(s => s.n === '中世紀城堡');
    targetCnt = 1500; startBuild(true); completeNow();
    shapePick = -1;
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

  /* 陣把建築扯下來捲進去的過程，一定會跌破「剩不到 25% 就換下一座」那條線。
     照換的話 startBuild 會把陣一起收掉，那一發永遠等不到爆炸——玩家只看到建築消失。 */
  const mgHold = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '中世紀城堡');
    targetCnt = 900; startBuild(true); completeNow();
    const total0 = bp.slots.length;
    castMagic({ x: 0, z: 0 });
    for (let i = 0; i < 118; i++) step(0.05);          // 5.9 秒：早就跌破那條線了
    const mid = { alive: !!magic, placed: placedCnt, gate: Math.floor(total0 * WRECK_AT),
                  same: bp.slots.length === total0, dest: stats.destroyed };
    for (let i = 0; i < 8; i++) step(0.05);            // 過 6 秒：炸完、這時候才輪得到換場
    const out = { mid, after: !!magic, boom: flashes.length > 0, dest: stats.destroyed };
    for (let i = 0; i < 70; i++) step(0.05);           // 換場前還要等 SWAP_WAIT 秒讓爆炸演完
    out.dest = stats.destroyed;
    shapePick = -1;
    return out;
  });
  ok('陣還在充能就不換下一座，那一發才炸得成',
     mgHold.mid.alive && mgHold.mid.same && mgHold.mid.placed < mgHold.mid.gate &&
     !mgHold.after && mgHold.boom && mgHold.dest > mgHold.mid.dest,
     '5.9 秒時只剩 ' + mgHold.mid.placed + ' 塊（換場線 ' + mgHold.mid.gate +
     '）仍沒換場，爆完才記一座拆除');

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
    callMeteor({ x: -4, y: 2, z: 2 });
    const cnt = () => [bombs ? bombs.length : 0, nuke ? 1 : 0, magic ? 1 : 0,
                       meteors ? meteors.length : 0].join(',');
    const armed = cnt();
    startBuild(true);
    const after = cnt();
    const n0 = placedCnt;
    for (let i = 0; i < 200; i++) step(0.05);           // 10 秒：三個的倒數都早就到了
    return { armed, after, n0, hurt: n0 - placedCnt, phase };
  });
  ok('換建築會把倒數中的道具一起收掉', swap.after === '0,0,0,0',
     '炸彈／核彈／魔法／隕石：換之前 ' + swap.armed + ' → 換之後 ' + swap.after);
  ok('新建築不會被上一輪的倒數炸到', swap.hurt <= 0,
     '換場後 10 秒內少了 ' + swap.hurt + ' 塊（phase=' + swap.phase + '）');

  /* 一發核彈常常直接把整棟夷平，那會立刻觸發「剩不到 25% 就換下一座」。
     換場如果把特效也清掉，蘑菇雲就會在爆炸後 0.05 秒整朵消失——等於白做。
     這裡驗的是「換場了、但雲還在」，兩個條件缺一不可。

     藍圖要指定，不能沿用前面留下來的隨機值：核彈半徑 30 打不平所有造型，
     49 座裡有 13 座會剩超過 25%（掃過一輪：艾菲爾鐵塔剩 89%、巨石陣 62%、
     帝國大廈 58%、金門大橋、倫敦眼、鳥居……），抽到那些這條就會無故失敗。 */
  const keepFx = await page.evaluate(() => {
    const puffs = () => dust.filter(d => d.fade >= 3).length;   // 只算雲，碎料的火苗煙是 2.2
    shapePick = SHAPES.findIndex(s => s.n === '中世紀城堡');
    startBuild(true); completeNow();
    const ph0 = phase;
    callNuke({ x: 0, z: 0 });
    for (let i = 0; i < 58; i++) step(0.05);           // 炸下去
    const ph1 = phase;
    for (let i = 0; i < 24; i++) step(0.05);           // 1.2 秒後雲該長齊了
    const grown = puffs();
    for (let i = 0; i < 44; i++) step(0.05);           // 再 2.2 秒：等滿 SWAP_WAIT，這時候才換場
    return { ph0, ph1, phase, grown, cloud: puffs(), fire: hot.length };
  });
  ok('炸到整棟夷平而自動換場時，蘑菇雲不會跟著消失',
     keepFx.ph1 !== 'done' && keepFx.phase !== 'wreck' &&
     keepFx.grown > 90 && keepFx.cloud > 90,
     'phase ' + keepFx.ph0 + ' → ' + keepFx.ph1 + ' → ' + keepFx.phase +
     '，雲 ' + keepFx.grown + ' → ' + keepFx.cloud + ' 團、火球 ' + keepFx.fire + ' 顆');

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
      clearFires();
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
    /* 「剛好被夷平」要挑矮的：核彈炸在接觸點上，打高樓時炸點在樓頂，
       下半截會留著（那些就會有站著的餘火）。金字塔頂只有 14 高，整座都在半徑內。 */
    const flatE = one('吉薩金字塔', () => callNuke({ x: 0, z: 0 }), () => !!nuke);
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

  /* ══════════ 隕石 ══════════ */
  head('隕石');
  await reset(page, { shape: '中世紀城堡', cnt: 3000, workers: 4 });
  const met = await page.evaluate(() => {
    completeNow();
    clearFires();
    hot.length = 0; flashes.length = 0; dust.length = 0;
    const dust0 = dust.length;
    callMeteor({ x: 0, y: 4, z: 0 });
    const m = meteors[0];
    const aim = { x: m.tx, y: m.ty, z: m.tz };
    for (let i = 0; i < 40; i++) step(0.05);          // 2 秒：還在倒數
    draw(); ENG.render();
    const wait = { n: meteors.length, lit: meteors.filter(k => k.lit).length,
                   mark: dust.length - dust0, calls: ENG.info().calls };
    let g = 0;
    while (meteors && !meteors[0].lit && g++ < 60) step(0.05);
    const enter = { t: +(g * 0.05).toFixed(2), y: +meteors[0].y.toFixed(1) };
    /* 45°：水平還要飛的距離要等於還沒掉的高度。取兩個時間點量，
       不是只量出現的那一刻——只量一點的話，等速直線與拋物線分不出來。 */
    const ang = [];
    for (let k = 0; k < 8; k++) {
      step(0.05);
      if (!meteors || !meteors[0]) break;
      const q = meteors[0];
      ang.push({ h: +Math.hypot(q.x - aim.x, q.z - aim.z).toFixed(2), up: +(q.y - aim.y).toFixed(2) });
    }
    /* draw call 要用「同一幀有沒有它」來量，不能比前後兩幀：
       倒數中的地面標記、飛行中的火苗與煙各自都會讓別的 mesh 現身，
       前後相減量到的是那些東西的帳。lit 歸零就等於這一幀沒有隕石在天上。 */
    draw(); ENG.render();
    const callsOn = ENG.info().calls;
    const litSaved = meteors.map(k => k.lit);
    for (const k of meteors) k.lit = 0;
    draw(); ENG.render();
    const callsOff = ENG.info().calls;
    meteors.forEach((k, i) => { k.lit = litSaved[i]; });
    const flying = { hot: hot.length, on: callsOn, off: callsOff };
    let g2 = 0;
    while (meteors && g2++ < 60) step(0.05);          // 撞下去
    /* 只數「還站著又燒起來」的：碎料的火另外算（爆炸一次就上千塊），
       混在一起的話這裡量到的是碎料的量，不是火有沒有蔓延。 */
    const nSet = () => fires ? fires.filter(f => f.sp).length : 0;
    const hit = { fires: nSet(), flash: flashes.length,
                  fy: flashes.length ? +flashes[0].y.toFixed(1) : -1, smashed: stats.smashed };
    for (let i = 0; i < 40; i++) step(0.05);          // 兩秒後火該蔓延開了
    const spread = nSet();
    return { wait, enter, ang, flying, hit, spread, R: MET_R, rockR: ROCK_R, fall: MET_FALL };
  });
  ok('點下去先倒數，天上還沒東西',
     met.wait.n === 1 && met.wait.lit === 0 && met.wait.mark > 20,
     '兩秒後：場上 ' + met.wait.n + ' 顆、在飛 ' + met.wait.lit +
     ' 顆，地面標記噴了 ' + met.wait.mark + ' 團塵');
  ok('3 秒後才進大氣層', met.enter.t >= 0.9 && met.enter.t <= 1.15 && met.enter.y > 50,
     '倒數結束後 ' + met.enter.t + ' 秒開始畫，出現高度 y=' + met.enter.y);
  /* 45° 就是「水平還要飛的距離＝還沒掉的高度」。等速直線的話這個比值全程都是 1 */
  ok('以 45 度直線插下來', met.ang.length >= 6 &&
     met.ang.every(a => Math.abs(a.h / a.up - 1) < 0.06),
     met.ang.slice(0, 4).map(a => '水平 ' + a.h + '／高度 ' + a.up).join('　'));
  /* 門檻壓在 15：尾巴的火苗壽命只有 0.1～0.4 秒又逐顆隨機，同一個取樣點量到的
     在 24～40 之間跳（原本訂 25 會偶爾誤判）。要驗的是「有一條火」，不是精確的顆數。 */
  ok('下墜時拖著一條火', met.flying.hot > 15, '同時 ' + met.flying.hot + ' 顆火苗');
  /* 一個是主畫面、一個是陰影貼圖：石頭有 castShadow，落地前地上那塊影子
     剛好提示它要砸哪裡，這個 call 是值得付的。不飛的時候兩個都不畫。 */
  ok('那顆石頭吃 2 個 draw call（畫面＋陰影），沒在飛就不畫',
     met.flying.on - met.flying.off === 2,
     '同一幀有石頭 ' + met.flying.on + ' 個 call、拿掉 ' + met.flying.off + ' 個');
  ok('落地就炸開，而且會燒起來',
     met.hit.flash > 0 && met.hit.fires > 0 && met.spread > met.hit.fires,
     '爆炸火球 ' + met.hit.flash + ' 顆、當場點著 ' + met.hit.fires +
     ' 塊，兩秒後蔓延到 ' + met.spread + ' 塊');
  ok('範圍是投石機石頭的兩倍', Math.abs(met.R - met.rockR * 2) < 1e-6,
     '石頭 ' + met.rockR + ' → 隕石 ' + met.R);

  /* 威力：同一座建築、同一個落點，隕石打掉的要明顯比投石機的石頭多。
     只比常數不算驗證——要驗的是那個半徑真的有作用到積木上。 */
  const metPow = await page.evaluate(() => {
    const one = go => {
      targetCnt = 3000; shapePick = SHAPES.findIndex(s => s.n === '美國國會大廈');
      startBuild(true); completeNow();
      const n0 = placedCnt;
      go();
      return n0 - placedCnt;            // 只看爆炸當下打飛幾塊，還沒垮塌
    };
    const rock = one(() => rockHit({ x: 0, y: 6, z: 0, s: 1.7 }));
    const meteor = one(() => meteorHit({ x: 0, y: 6, z: 0 }));
    return { rock, meteor };
  });
  ok('同一個落點，隕石打掉的比石頭多',
     metPow.meteor > metPow.rock * 2.5,
     '石頭 ' + metPow.rock + ' 塊 → 隕石 ' + metPow.meteor + ' 塊');

  const metMany = await page.evaluate(() => {
    targetCnt = 3000; shapePick = SHAPES.findIndex(s => s.n === '萬里長城');
    startBuild(true); completeNow();
    for (let i = 0; i < 3; i++) callMeteor({ x: -30 + i * 30, y: 3, z: 0 });
    const three = meteors.length;
    let g = 0, maxFly = 0;
    while (meteors && g++ < 120) {
      step(0.05);
      if (meteors) maxFly = Math.max(maxFly, meteors.filter(m => m.lit).length);
    }
    const boom = flashes.length;
    // 上限：連叫九顆只留最新的六顆
    startBuild(true); completeNow();
    for (let i = 0; i < 9; i++) callMeteor({ x: i * 4 - 16, y: 3, z: 0 });
    return { three, maxFly, boom, capped: meteors.length, cap: MET_MAX };
  });
  ok('可以同時來好幾顆', metMany.three === 3 && metMany.maxFly === 3 && metMany.boom >= 2,
     '叫了 3 顆，最多同時 ' + metMany.maxFly + ' 顆在飛，落地後場上 ' +
     metMany.boom + ' 顆火球');
  ok('同時最多 ' + metMany.cap + ' 顆', metMany.capped === metMany.cap,
     '連叫 9 顆 → 場上 ' + metMany.capped + ' 顆');

  /* 半路撞到建築就當場炸開。落點給在高塔的正下方：45° 斜插進來的話，
     一定會先擦到塔身——只在終點判定的話它會從屋頂穿過去、在地面才炸。 */
  const metSweep = await page.evaluate(() => {
    targetCnt = 3000; shapePick = SHAPES.findIndex(s => s.n === '帝國大廈');
    startBuild(true); completeNow();
    flashes.length = 0;
    callMeteor({ x: 0, y: 0.6, z: 0 });
    let g = 0;
    while (meteors && g++ < 120) step(0.05);
    return { fy: flashes.length ? +flashes[0].y.toFixed(1) : -1, h: bp.height };
  });
  ok('半路撞到建築就當場炸開，不會穿進去',
     metSweep.fy > 5,
     '落點指在 y=0.6，實際炸在 y=' + metSweep.fy + '（塔高 ' + metSweep.h + '）');

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
  ok('十二種道具都用過解鎖【工具箱清空】', toolRec.got);

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
  /* 拆 4 座、擊飛 1234 塊 → 大槌(擊飛 500)、保齡球(2 座)、投石機(4 座) 開；
     龍捲風(5,000)、煙火(8 座)、放火(12,000)、炸彈(12 座)、隕石(30,000)、
     核彈(18 座)、爆裂魔法(60,000) 還鎖著 */
  const unlockedAfterReload = await page.evaluate(() =>
    [...document.querySelectorAll('.tool')].map(e => e.className.indexOf('lock') >= 0 ? 'lock' : 'open').join(','));
  ok('重開後解鎖狀態跟著回來',
     unlockedAfterReload === 'open,open,open,open,open,lock,lock,lock,lock,lock,lock,lock',
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

  /* 預設建材從 900 改成 3000 那次：舊存檔裡的 900 分不出是玩家挑的還是舊預設，
     所以認「沒有 v 欄位」的存檔，一次性換成新預設。存過一次之後就不再動它。 */
  const prefMigrate = await page.evaluate(() => {
    localStorage.setItem('block-builders/save1',
      packSave({ s: freshStats(), p: { cnt: 900, wk: 20, spd: 1, mute: false, spin: false } }));
    stats = freshStats(); pref = freshPref(); load();
    const migrated = pref.cnt;
    pref.cnt = 900; save();                     // 這次是玩家自己選的 900
    stats = freshStats(); pref = freshPref(); load();
    return { migrated, keep: pref.cnt, v: pref.v };
  });
  ok('舊存檔的建材數換成新預設，而且只換一次',
     prefMigrate.migrated === 3000 && prefMigrate.keep === 900 && prefMigrate.v === 1,
     '舊存檔 900 → ' + prefMigrate.migrated + '；之後自己選 900 → ' + prefMigrate.keep +
     '（存檔版本 v' + prefMigrate.v + '）');

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

  /* ── 立刻建成 ──
     跳過施工過程用的。重點是它不能變成刷錢成就的捷徑：
     人力費是 step() 裡隨施工時間累積的，這顆按鈕一毛都不加。 */
  const instant = await page.evaluate(() => {
    running = false; stats = freshStats();
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 1200; setWorkerCount(12); startBuild(true);
    for (let i = 0; i < 100; i++) step(0.05);        // 先讓小人蓋一陣、也先燒一點錢
    hudLast = 0; hudTick(performance.now());
    const mid = { phase, placed: placedCnt, spent: stats.spent, spentThis,
                  dis: document.getElementById('finish').disabled };
    document.getElementById('finish').click();
    const after = { phase, placed: placedCnt, total: bp.slots.length, spent: stats.spent,
                    spentThis, elapsed: buildElapsed, built: stats.built.slice(),
                    miracle: !!stats.miracle, badges: stats.badges.slice(),
                    carry: blocks.filter(b => b.st === 1).length };
    hudLast = 0; hudTick(performance.now());
    const disAfter = document.getElementById('finish').disabled;
    for (let i = 0; i < 100; i++) step(0.05);        // 完工了就不該再燒錢
    return { mid, after, disAfter, spentLater: stats.spent };
  });
  ok('施工中「立刻建成」可以按', instant.mid.phase === 'build' && !instant.mid.dis,
     'phase=' + instant.mid.phase + '、disabled=' + instant.mid.dis);
  ok('一按就整座蓋好',
     instant.after.placed === instant.after.total && instant.after.phase === 'done' &&
     instant.after.carry === 0,
     instant.mid.placed + ' → ' + instant.after.placed + '/' + instant.after.total +
     '，phase=' + instant.after.phase);
  ok('立刻建成不加人力費（按不出花錢成就）',
     instant.after.spent === instant.mid.spent && instant.spentLater === instant.mid.spent,
     '按之前累計 $' + instant.mid.spent.toFixed(0) + '，按完 $' + instant.after.spent.toFixed(0) +
     '，再跑 5 秒還是 $' + instant.spentLater.toFixed(0));
  ok('已經花掉的工錢不會被抹掉', instant.after.spentThis === instant.mid.spentThis,
     '本次人力 $' + instant.after.spentThis.toFixed(0) + '（歸零的話會跟累計對不上）');
  ok('立刻建成拿不到【奇蹟工程】（那是比速度的）',
     !instant.after.miracle && instant.after.badges.indexOf('miracle') < 0 &&
     instant.after.elapsed === 0,
     'buildElapsed=' + instant.after.elapsed + '、miracle=' + instant.after.miracle);
  ok('蓋過哪些地標照記', instant.after.built.indexOf('吉薩金字塔') >= 0 &&
     instant.after.badges.indexOf('first') >= 0,
     '記到 ' + instant.after.built.join('、') + '，成就 ' + instant.after.badges.join(','));
  ok('完工後按鈕會灰掉', instant.disAfter);

  /* 整地中也算「還沒蓋」，按了就直接長出來、推土機收工 */
  const instantClear = await page.evaluate(() => {
    running = false; targetCnt = 1200; startBuild(true); completeNow();
    let g = 0;
    while (phase !== 'clear' && g++ < 200) {        // 砸到門檻它會自己換下一座 → 進整地
      const cand = blocks.filter(b => b.st === 3);
      if (cand.length) {
        const t = cand[Math.floor(Math.random() * cand.length)];
        smash(new THREE.Vector3(t.x, t.y, t.z), new THREE.Vector3(0.2, -0.95, 0.1).normalize());
      }
      for (let k = 0; k < 8; k++) step(0.05);
    }
    hudLast = 0; hudTick(performance.now());
    const before = { phase, dis: document.getElementById('finish').disabled, doz: !!dozers };
    document.getElementById('finish').click();
    return { before, phase, placed: placedCnt, total: bp.slots.length, doz: !!dozers };
  });
  ok('整地中按也算（推土機直接收工）',
     instantClear.before.phase === 'clear' && !instantClear.before.dis && instantClear.before.doz &&
     instantClear.phase === 'done' && instantClear.placed === instantClear.total && !instantClear.doz,
     'clear（推土機 ' + instantClear.before.doz + '）→ ' + instantClear.phase + ' ' +
     instantClear.placed + '/' + instantClear.total);
  /* 上面兩段把 rAF 迴圈關掉、也把建築蓋完了。後面的自轉與施工計時要靠真的迴圈跑、
     而且計時只在 phase='build' 時前進，所以這裡把場面還原成「正在施工」。 */
  await page.evaluate(() => {
    stats = freshStats(); shapePick = -1; targetCnt = 1200;
    startBuild(true); running = true;
  });
  await page.waitForTimeout(300);

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

  /* 工具收成一顆小窗之後就不會撐寬了，但左上角的建築資訊卡還是會隨數字變寬。
     量之前一定要先把數字灌到最寬的狀態：累計金額變成七位數那一刻，
     資訊卡會從 266px 撐到 354px——用剛開新局的空帳號去量，會量到「沒撞到」的假象。 */
  await page.evaluate(() => {
    stats.destroyed = 128; stats.smashed = 987654; stats.spent = 1234567; stats.wrecked = 9876543;
    renderTools(); hudLast = 0; hudTick(performance.now());
  });
  // 1501 是斷點上緣的第一格：工具列還留在上面，剛好要閃過撐到最寬的資訊卡
  const widths = [1600, 1520, 1501, 1400, 1280, 1100, 900, 700];
  const clash = [];
  let statTxt = '', barAt = [];
  for (const w of widths) {
    await page.setViewportSize({ width: w, height: 800 });
    await page.waitForTimeout(120);
    const r = await page.evaluate(() => {
      const box = {};
      // 量的是收起來的小窗（toolbox）：選單平常是藏著的，不占版面
      for (const id of ['head', 'time', 'toolbox', 'panelBtn', 'ver']) {
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
      return { bad, headW: Math.round(box.head.width), top: Math.round(box.toolbox.top),
               out: box.toolbox.left < -1 || box.toolbox.right > window.innerWidth + 1,
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
    const ids = ['head', 'time', 'toolbox', 'panelBtn', 'ver'];
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
    // 展開的選單也要留在畫面內——手機上它是往上開的，寬度受限於三欄
    document.getElementById('toolbox').classList.add('open');
    const menu = document.getElementById('tools').getBoundingClientRect();
    document.getElementById('toolbox').classList.remove('open');
    const out = keys.filter(k => box[k].right > window.innerWidth + 1 || box[k].left < -1);
    return { bad, out, toolsW: Math.round(box.toolbox.width),
             menu: { w: Math.round(menu.width), l: Math.round(menu.left),
                     r: Math.round(menu.right), t: Math.round(menu.top) } };
  });
  ok('手機版的 UI 不會互相疊到', overlap.bad.length === 0, overlap.bad.join('、') || '五個區塊都沒相交');
  ok('手機版工具小窗不會超出畫面', overlap.out.length === 0,
     '小窗寬 ' + overlap.toolsW + '，視窗寬 390' + (overlap.out.length ? '；超出：' + overlap.out.join(',') : ''));
  ok('手機版展開的工具選單也在畫面內',
     overlap.menu.l >= 0 && overlap.menu.r <= 390 && overlap.menu.t >= 0,
     '選單寬 ' + overlap.menu.w + '，左 ' + overlap.menu.l + '、右 ' + overlap.menu.r +
     '、上 ' + overlap.menu.t);
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

  /* ══════════ 檔案沒放齊的防呆 ══════════ */
  head('檔案沒放齊的防呆');
  /* 把遊戲寄給別人，對方直接在壓縮檔裡按兩下 index.html——Windows 只解出那一支檔，
     旁邊的 lib／src 都不在，畫面就只剩 body 的漸層背景，看起來像遊戲自己壞了。
     這裡真的做殘缺的複本去開，驗證會蓋出說明而不是一片空白。 */
  const copyInto = (rel, dir) => {
    const from = path.join(ROOT, rel), to = path.join(dir, rel);
    if (fs.statSync(from).isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      for (const e of fs.readdirSync(from)) copyInto(path.join(rel, e), dir);
    } else fs.copyFileSync(from, to);
  };
  const brokenCase = (tag, build) => {
    const d = path.join(OUT, 'broken-' + tag);
    fs.rmSync(d, { recursive: true, force: true });
    fs.mkdirSync(d, { recursive: true });
    copyInto('index.html', d);
    build(d);
    return 'file:///' + path.join(d, 'index.html').replace(/\\/g, '/');
  };
  const readFatal = async url => {
    const p = await browser.newPage({ viewport: VIEW });
    await p.goto(url);
    await p.waitForTimeout(700);
    const r = await p.evaluate(() => {
      const f = document.getElementById('fatal');
      const mid = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
      return { shown: !!f, text: f ? f.innerText : '',
               /* 掃到 DOM 不等於使用者看得到：畫面正中央點下去要真的落在遮罩裡 */
               onTop: !!(mid && mid.closest && mid.closest('#fatal')) };
    });
    r.page = p;
    return r;
  };

  const zipCase = await readFatal(brokenCase('只有index', () => {}));
  ok('只有 index.html：蓋出說明而不是一片空白', zipCase.shown && zipCase.onTop,
     zipCase.shown ? (zipCase.onTop ? '' : '有元素但被蓋住') : '完全沒有提示');
  ok('四支相依檔全被列出來',
     ['lib/three.min.js', 'src/blueprints.js', 'src/engine.js', 'src/game.js']
       .every(f => zipCase.text.includes(f)),
     zipCase.text.replace(/\s+/g, ' ').slice(0, 90));
  ok('有講怎麼救（解壓縮後再開）',
     zipCase.text.includes('解壓縮') && zipCase.text.includes('index.html'));
  await zipCase.page.screenshot({ path: path.join(OUT, '08-檔案沒放齊.png') });
  await zipCase.page.close();

  /* 只缺 three：engine.js 會執行到一半炸掉，ENG 卡在 TDZ 連 typeof 都噴 ReferenceError。
     偵測沒包 try 的話這裡會整段死掉，反而連提示都蓋不出來。 */
  const libCase = await readFatal(brokenCase('缺three', d => {
    copyInto('src', d); copyInto('blueprints', d);
  }));
  ok('只缺 three.min.js 也擋得住（TDZ 不會反過來弄死偵測）', libCase.shown && libCase.onTop);
  ok('缺的那支被點名', libCase.text.includes('lib/three.min.js'),
     libCase.text.replace(/\s+/g, ' ').slice(0, 90));

  /* 檔案齊、但初始化炸掉（對方的瀏覽器不支援 WebGL 就長這樣）：走另一條訊息 */
  const bootCase = await readFatal(brokenCase('啟動失敗', d => {
    copyInto('lib', d); copyInto('src', d); copyInto('blueprints', d);
    fs.writeFileSync(path.join(d, 'src/game.js'),
      'function boot() { throw new Error("測試用：假裝初始化失敗"); }\n');
  }));
  ok('檔案齊但啟動失敗：走「啟動失敗」那條訊息',
     bootCase.shown && bootCase.onTop && bootCase.text.includes('啟動失敗') &&
     !bootCase.text.includes('解壓縮'),
     bootCase.text.replace(/\s+/g, ' ').slice(0, 70));
  ok('原始錯誤訊息有帶出來', bootCase.text.includes('假裝初始化失敗'));
  await bootCase.page.close();
  await libCase.page.close();

  ok('正常開啟時不會誤蓋提示',
     await page.evaluate(() => !document.getElementById('fatal')));

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

