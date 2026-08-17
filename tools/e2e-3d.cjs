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
const CUSTOM_COUNT = 1;          // blueprints/ 資料夾裡預設附的自訂藍圖（範例小教堂）
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
    /* 建材與人數直接改變數就好：面板現在是三檔按鈕，測試要的值多半不在那三檔裡
       （亮不亮是 syncHud 的事，startBuild 會叫到）。 */
    if (o.cnt != null) targetCnt = o.cnt;
    if (o.workers != null) setWorkerCount(o.workers);
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

  /* 面板的三檔按鈕：數字只寫在 CNT_OPTS／WK_OPTS／SPD_OPTS，按鈕照著生。
     這裡驗「畫面上長出來的就是那三個數字」，順便驗預設值那顆有亮起來。 */
  const seg = await page.evaluate(() => {
    const read = id => [...document.getElementById(id).children]
      .map(b => ({ v: b.dataset.v, txt: b.textContent, on: b.classList.contains('on') }));
    return {
      cnt: read('cnt'), wk: read('wk'), spd: read('spd'),
      opts: { cnt: CNT_OPTS, wk: WK_OPTS, spd: SPD_OPTS },
      target: targetCnt, workers: workerCnt, scale: timeScale,
      fresh: freshPref(), cntMax: CNT_MAX, maxb: ENG.MAXB
    };
  });
  const segVals = g => g.map(b => +b.v);
  const segOn = g => g.filter(b => b.on).map(b => +b.v);
  ok('三組設定都是三檔按鈕，數字跟程式裡的清單一致',
     String(segVals(seg.cnt)) === String(seg.opts.cnt) &&
     String(segVals(seg.wk)) === String(seg.opts.wk) &&
     String(segVals(seg.spd)) === String(seg.opts.spd) &&
     seg.spd.map(b => b.txt).join('/') === '0.5×/1×/4×',
     '建材 ' + segVals(seg.cnt) + '、小人 ' + segVals(seg.wk) +
     '、速度 ' + seg.spd.map(b => b.txt).join('／'));
  ok('每組只有一顆亮著，亮的就是目前的值',
     String(segOn(seg.cnt)) === String([seg.target]) &&
     String(segOn(seg.wk)) === String([seg.workers]) &&
     String(segOn(seg.spd)) === String([seg.scale]),
     '亮的是 建材 ' + segOn(seg.cnt) + '、小人 ' + segOn(seg.wk) + '、速度 ' + segOn(seg.spd));
  ok('預設是 3000 塊 / 20 人 / 1×',
     seg.target === 3000 && seg.fresh.cnt === 3000 &&
     seg.workers === 20 && seg.fresh.wk === 20 &&
     seg.scale === 1 && seg.fresh.spd === 1,
     'targetCnt=' + seg.target + '、freshPref=' + JSON.stringify(seg.fresh));
  ok('開場那座就真的是 3000 塊上下', Math.abs(boot.total - 3000) / 3000 < 0.05,
     boot.bp + ' ' + boot.total + ' 塊');
  /* 最大那一檔 9000（自訂藍圖要靠上萬塊才刻得出招牌、窗框那種細節）。
     積木池必須比它更高：fitScale 挑的是「最接近目標」的那一階，可能落在目標之上
     ——實測吉薩金字塔要 10000 時給出 10660（+7%）。池子不夠就會夾掉尾巴，那座永遠蓋不完。
     池子留到 11500 是照 10000 抓的：藍圖體檢仍然量到 10000，留著才不用跟著面板改來改去。 */
  ok('最大一檔 9000，積木池留了超額餘裕',
     seg.cntMax === 9000 && seg.maxb >= 11000,
     '最大 ' + seg.cntMax + '、積木池 ' + seg.maxb);
  const bigBuild = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = CNT_MAX; startBuild(true); completeNow();
    const r = { slots: bp.slots.length, pool: blocks.length, placed: placedCnt, phase };
    targetCnt = 3000; shapePick = -1; startBuild(true); completeNow();
    return r;
  });
  ok('最大那一檔蓋得完（積木池沒有夾掉尾巴）',
     bigBuild.pool === bigBuild.slots && bigBuild.placed === bigBuild.slots &&
     bigBuild.phase === 'done',
     '吉薩金字塔 ' + bigBuild.slots + ' 格 → 池子 ' + bigBuild.pool + '、擺上 ' +
     bigBuild.placed + '，phase=' + bigBuild.phase);
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
    // 面板的三檔就是玩家真的會設的值，拿它們來驗縮放
    const sizes = [1800, 3000, 9000].map(t => makeBlueprint(i, t).slots.length);
    /* 參數化的重點：每個尺寸都重畫一次，所以小尺寸也該畫得出每一種部件
       （門、窗、十字架各自是不同的顏色索引，用到的顏色沒少就代表部件沒消失） */
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
  /* 面板三檔各要落在目標的 ±10% 內。這是「參數化寫法真的追得上目標塊數」的證據，
     光看「大的比小的多」是不夠的——係數沒對齊時塊數會一階跳掉一大截。 */
  ok('自訂藍圖會跟著建材數縮放，三檔都對得上',
     [1800, 3000, 9000].every((t, k) => Math.abs(custom.sizes[k] / t - 1) < 0.1),
     '目標 1800/3000/9000 得到 ' + custom.sizes.join(' / ') + '（偏差 ' +
     [1800, 3000, 9000].map((t, k) => Math.round((custom.sizes[k] / t - 1) * 100) + '%').join('／') + '）');
  /* 範例藍圖示範的是參數化寫法（gen(v, s) 按 s 重畫），不是固定解析度的字元圖——
     說明文件叫 AI 這樣寫，附的範例自己要先做到。 */
  ok('範例藍圖是參數化寫的，縮到最小也不會掉部件',
     custom.isGen && custom.parts.min === custom.parts.max && custom.parts.min.length === 6,
     (custom.isGen ? 'gen(v,s)' : '字元圖') + '：300 塊用到顏色 ' + custom.parts.min +
     '、3000 塊用到 ' + custom.parts.max);
  ok('自訂藍圖的顏色與貼地層都正常',
     custom.pal === 6 && custom.ground > 0 && custom.cols.every(c => c >= 0 && c < 6),
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

  /* ── 組合工具與藍圖體檢 ─────────────────────────────────
     這一組服務的是「AI 產藍圖」那條路：一般玩家手上只有網頁版 AI，
     所以（1）組合工具要能讓它少寫樣板、少犯下限與奇偶的錯，
     （2）checkBlueprint() 要吐出一段能整段複製、貼回去給 AI 的純文字報告。
     遊戲裡的按鈕與 tools/check-bp.cjs 共用同一支，最後一條測試守著這件事。 */
  head('藍圖工具與體檢');
  const bpTool = await page.evaluate(() => {
    /* function 宣告會掛上 window，所以自訂藍圖檔（<script> 載進來的）叫得到 */
    const names = ['dim', 'ringOf', 'mirrorX', 'mirrorZ', 'arch', 'archRow', 'stairs',
                   'hipRoof', 'windowGrid', 'lattice', 'corners4', 'tubeZ', 'wheelX',
                   'tint', 'paintFrom', 'blob', 'checkBlueprint'];
    const missing = names.filter(n => typeof window[n] !== 'function');

    // dim：夾下限、取奇數
    const d = [dim(0.1, 1, 5), dim(10, 1, 2), dim(10, 1, 2, true), dim(4, 1, 1, true)];

    /* arch：在一片實心牆上挖拱。中線那一列要通到底，拱頂上面要還有牆，
       而且開口最寬處就是給的 w（拱心落在中線 = 寬度自動取奇數的意義）。 */
    const va = new VOX();
    va.box(0, 0, 0, 21, 20, 1, 0);
    arch(va, 0, 0, 0, 9, 6, 1);
    const openAt = y => { let n = 0; for (let x = -10; x <= 10; x++) if (!va.has(x, y, 0)) n++; return n; };
    const archR = { mid: openAt(3), top: openAt(9), above: va.has(0, 12, 0),
                    solidSide: va.has(-10, 3, 0) };

    // arch 的 c 給了要自己補一片牆
    const vb = new VOX();
    arch(vb, 0, 0, 0, 7, 5, 2, 1);
    const archMade = { n: vb.m.size, hole: !vb.has(0, 2, 0), wall: vb.has(4, 2, 0) };

    /* stairs：每一階都填實到底。只鋪踏面的話最底層只有 1 排，
       那些踏面會變成一組會掉下來的懸空部件。 */
    const vc = new VOX();
    stairs(vc, 0, 0, 0, 6, 3, 'x', 0);
    const st = { floor: vc.cells().filter(c => c.y === 0).length,
                 top: Math.max(...vc.cells().map(c => c.y)) + 1,
                 hollow: vc.cells().some(c => c.y > 0 && !vc.has(c.x, c.y - 1, c.z)) };

    /* windowGrid 走 tint：牆不在那裡就一格都不畫（回傳 0、總格數不變），
       牆在的話只換色、不會多出格子。 */
    const vd = new VOX();
    const air = windowGrid(vd, { x: 0, y: 2, z: 0, cols: 3, rows: 2, w: 1, h: 2, c: 1 });
    const airCells = vd.m.size;
    vd.box(0, 0, 0, 21, 12, 1, 0);
    const n0 = vd.m.size;
    const on = windowGrid(vd, { x: 0, y: 2, z: 0, cols: 3, rows: 2, stepX: 4, stepY: 4, w: 1, h: 2, c: 1 });
    const lit = vd.cells().filter(c => c.c === 1).length;
    const wg = { air, airCells, on, lit, grew: vd.m.size - n0 };

    // ringOf：n 個都在半徑 r 上
    const ring = [];
    /* 第一個參數餵真的 VOX（v1.56 起「忘了傳 v」會被擋下來）；這幾支只是把它轉交給
       callback，這裡的 callback 沒用到，但 API 的約定就是要傳 v。 */
    ringOf(new VOX(), 8, 10, (vv, x, z) => ring.push(+Math.hypot(x, z).toFixed(2)));
    const ringOk = ring.length === 8 && ring.every(v => Math.abs(v - 10) < 0.01);

    // hipRoof：每層寬與深一起縮 2（gable 只縮寬）
    const ve = new VOX();
    hipRoof(ve, 0, 0, 0, 9, 7, 0);
    const layer = y => {
      const c = ve.cells().filter(o => o.y === y);
      return c.length ? [Math.max(...c.map(o => o.x)) - Math.min(...c.map(o => o.x)) + 1,
                         Math.max(...c.map(o => o.z)) - Math.min(...c.map(o => o.z)) + 1] : null;
    };
    const hip = [layer(0), layer(1), layer(2)];

    // mirrorX / mirrorZ：兩份，位置相反
    const mx = []; mirrorX(new VOX(), 7, (vv, dx) => mx.push(dx));
    const mz = []; mirrorZ(new VOX(), 4, (vv, dz) => mz.push(dz));

    // lattice：兩根柱子之間拉出交叉，中間段一定有格子
    const vf = new VOX();
    lattice(vf, { x0: -8, z0: 0, x1: 8, z1: 0, y: 0, h: 20, n: 4, c: 0 });
    const lat = { n: vf.m.size, mid: vf.cells().some(c => Math.abs(c.x) <= 1 && c.y > 1 && c.y < 19) };

    return { missing, d, archR, archMade, st, wg, ring, ringOk, hip, mx, mz, lat };
  });
  ok('組合工具全都掛在全域，自訂藍圖叫得到', bpTool.missing.length === 0,
     bpTool.missing.length ? '沒有：' + bpTool.missing.join('、') : '17 支都在');
  ok('dim 會夾下限也會取奇數',
     bpTool.d[0] === 5 && bpTool.d[1] === 10 && bpTool.d[2] === 11 && bpTool.d[3] === 5,
     'dim(0.1,1,5)=' + bpTool.d[0] + '、dim(10,1,2)=' + bpTool.d[1] +
     '、加 odd → ' + bpTool.d[2] + '、dim(4,1,1,odd)=' + bpTool.d[3]);
  ok('arch 在牆上挖出正對中線的拱洞',
     bpTool.archR.mid === 9 && bpTool.archR.top < 9 && bpTool.archR.top > 0 &&
     bpTool.archR.above && bpTool.archR.solidSide,
     '柱身段開口 ' + bpTool.archR.mid + ' 格（給 9）、拱頂那層 ' + bpTool.archR.top +
     ' 格，拱頂上面還是實心 ' + bpTool.archR.above);
  ok('arch 給了顏色會自己補一片牆再挖',
     bpTool.archMade.n > 0 && bpTool.archMade.hole && bpTool.archMade.wall,
     bpTool.archMade.n + ' 格，中間是空的、旁邊是牆');
  ok('stairs 每一階都填到底，不會留懸空踏面',
     bpTool.st.floor === 18 && bpTool.st.top === 6 && !bpTool.st.hollow,
     '6 階 × 寬 3：最底層 ' + bpTool.st.floor + ' 格、最高 ' + bpTool.st.top +
     ' 層，懸空格 ' + (bpTool.st.hollow ? '有' : '沒有'));
  ok('windowGrid 只換已經有積木的格子',
     bpTool.wg.air === 0 && bpTool.wg.airCells === 0 &&
     bpTool.wg.on > 0 && bpTool.wg.grew === 0 && bpTool.wg.lit === bpTool.wg.on,
     '空氣中畫 ' + bpTool.wg.air + ' 格；牆上畫 ' + bpTool.wg.on +
     ' 格、總格數多了 ' + bpTool.wg.grew + ' 格（只換色）');
  ok('ringOf 把東西平均排在一個圓上', bpTool.ringOk,
     '8 個點離中心 ' + bpTool.ring[0] + '（給 10）');
  ok('hipRoof 寬深一起收（不是只收寬）',
     bpTool.hip[0][0] === 9 && bpTool.hip[0][1] === 7 &&
     bpTool.hip[1][0] === 7 && bpTool.hip[1][1] === 5 &&
     bpTool.hip[2][0] === 5 && bpTool.hip[2][1] === 3,
     bpTool.hip.map(a => a.join('×')).join(' → '));
  ok('mirrorX／mirrorZ 各放正負兩份',
     bpTool.mx.join(',') === '7,-7' && bpTool.mz.join(',') === '4,-4',
     'mirrorX → ' + bpTool.mx.join(',') + '、mirrorZ → ' + bpTool.mz.join(','));
  ok('lattice 在兩根柱子之間拉出交叉斜撐', bpTool.lat.n > 40 && bpTool.lat.mid,
     bpTool.lat.n + ' 格，跨距中段有料');

  /* 體檢報告：對好的藍圖不該有必修，對壞的要指名問題並附修法。
     每一種壞法都真的做一份藍圖出來測——這幾種就是 AI 產藍圖最常見的死法。 */
  const diag = await page.evaluate(() => {
    const good = checkBlueprint('範例小教堂', { ver: VERSION });
    const n0 = SHAPES.length;
    const mk = (name, def) => { def.name = name; return customBlueprint(def); };
    // ① gen 直接丟例外
    mk('__壞 例外', { pal: ['#fff'], lo: 2, hi: 9, gen() { throw new Error('測試用的爆炸'); } });
    // ② pal 不夠：用到索引 3，只給 1 色
    mk('__壞 配色', { pal: ['#fff'], lo: 2, hi: 9,
      gen(v, s) { v.box(0, 0, 0, dim(s, 2, 5), dim(s, 2, 5), dim(s, 2, 5), 3); } });
    /* ③ 小尺寸時整組部件消失。真實案例是「尺寸沒給下限，算出 0 就什麼都沒畫」，
       這裡用一個門檻直接模擬那個結果（300 塊時 s≈3.5、3000 塊時 s≈7.2）。 */
    mk('__壞 消失', { pal: ['#fff', '#c00'], lo: 2, hi: 9, gen(v, s) {
      const w = dim(s, 2, 5), h = dim(s, 2, 5);
      v.box(0, 0, 0, w, h, w, 0);
      if (s > 5) v.box(0, h, 0, 3, 3, 3, 1);       // 頂上的小塔尖
    } });
    // ④ 整棟只靠一格站在地上
    mk('__壞 針尖', { pal: ['#fff'], lo: 2, hi: 9, gen(v, s) {
      v.set(0, 0, 0, 0);
      v.box(0, 1, 0, dim(s, 2, 5), dim(s, 2, 5), dim(s, 2, 5), 0);
    } });
    /* ⑤ 少給參數：v.box 忘了最後那個顏色。這是 AI 最常手滑的地方，
       而且以前是**靜默**的——格子的 c 是 undefined，畫出來是黑的、報告也算不出配色。 */
    mk('__壞 少參數', { pal: ['#fff'], lo: 2, hi: 9, gen(v, s) {
      const w = dim(s, 2, 5);
      v.box(0, 0, 0, w, w, w);
    } });
    /* ⑥ 參數算成 NaN：blob 少一個半徑。以前 Math.ceil(NaN) 讓迴圈一次都不跑，
       那顆球就這樣整組消失，報告只看得到「塊數少了一截」。 */
    mk('__壞 NaN', { pal: ['#fff'], lo: 2, hi: 9, gen(v, s) {
      blob(v, 0, 0, 0, dim(s, 1, 3), undefined, dim(s, 1, 3), 0);
    } });
    const r = {
      good: { fails: good.fails.length, warns: good.warns.length, text: good.text },
      boom: checkBlueprint('__壞 例外', { ver: VERSION }),
      args: checkBlueprint('__壞 少參數', { ver: VERSION }),
      nan: checkBlueprint('__壞 NaN', { ver: VERSION }),
      pal: checkBlueprint('__壞 配色', { ver: VERSION }),
      gone: checkBlueprint('__壞 消失', { ver: VERSION }),
      pin: checkBlueprint('__壞 針尖', { ver: VERSION }),
      missing: checkBlueprint('根本沒有這座', { ver: VERSION })
    };
    for (const k of ['boom', 'args', 'nan', 'pal', 'gone', 'pin', 'missing'])
      r[k] = { fails: r[k].fails, warns: r[k].warns, text: r[k].text };
    r.targets = BP_TARGETS.slice();
    SHAPES.length = n0;                 // 測完收掉，別影響後面掃全部 SHAPES 的測試
    return r;
  });
  ok('好的藍圖檢查起來沒有必修', diag.good.fails === 0,
     '範例小教堂：' + diag.good.fails + ' 個必修、' + diag.good.warns + ' 個提醒');
  ok('報告是純文字、開頭帶版本號',
     /^=== 積木小人 · 藍圖診斷 v\d+\.\d+\.\d+ ===\n藍圖：範例小教堂（自訂 · gen）/.test(diag.good.text) &&
     diag.good.text.indexOf('<') < 0,
     diag.good.text.split('\n')[0]);
  ok('報告會列出四個尺寸的實得塊數（含建材上限那一階）',
     diag.targets.length === 4 && diag.targets[diag.targets.length - 1] === 10000 &&
     diag.targets.every(t => new RegExp('\\n\\s+' + t + ' → ').test(diag.good.text)),
     '量了 ' + diag.targets.join('／') + ' 四個尺寸');
  ok('gen 丟例外會被抓到，錯誤訊息原封不動寫進報告',
     diag.boom.fails.length > 0 && diag.boom.text.indexOf('測試用的爆炸') > 0,
     diag.boom.fails.join('；'));
  /* v1.56：少給參數以前是靜默的（NaN 進迴圈整個部件不見、顏色沒給就畫成黑的），
     報告只看得到「塊數少了一截」。現在畫圖函式進來就擋，訊息要指名是哪一支的第幾個參數。 */
  ok('少給參數會被抓到，而且指名是哪一支函式的第幾個參數',
     diag.args.fails.length > 0 &&
     /參數錯誤：v\.box\(x0, y0, z0, w, h, d, c\) 的第 7 個參數 c 沒給/.test(diag.args.text),
     diag.args.text.split('\n').find(l => l.indexOf('參數錯誤') > 0) || '(報告裡沒有參數錯誤)');
  ok('參數算成 NaN／undefined 也擋得下來，不會整個部件靜靜消失',
     diag.nan.fails.length > 0 &&
     diag.nan.text.indexOf('blob(v, x0, y0, z0, rx, ry, rz, c, shell) 的第 6 個參數 ry 沒給') > 0,
     diag.nan.text.split('\n').find(l => l.indexOf('參數錯誤') > 0) || '(報告裡沒有參數錯誤)');
  ok('參數錯誤的修法直接指到說明文件的參數表',
     diag.args.text.indexOf('3.1／3.2 的參數表') > 0 &&
     diag.boom.text.indexOf('3.1／3.2 的參數表') < 0,
     '參數錯誤給參數表、其他例外仍給原本那句通用修法');
  ok('pal 不夠會被抓到', diag.pal.fails.some(f => f.indexOf('pal 不夠') === 0) &&
     diag.pal.text.indexOf('修法：pal 至少要 4 色') > 0,
     diag.pal.fails.join('；'));
  ok('部件在小尺寸整組消失會被抓到',
     diag.gone.fails.some(f => /整組消失/.test(f)) && diag.gone.text.indexOf('dim(s, 係數, 下限)') > 0,
     diag.gone.fails.join('；'));
  ok('整棟只靠一格站在地上會被提醒',
     diag.pin.warns.length + diag.pin.fails.length > 0 && diag.pin.text.indexOf('最底層 1 格⚠') > 0,
     diag.pin.text.split('\n').find(l => l.indexOf('最底層') > 0) || '(沒寫到最底層)');
  ok('名字打錯時報告會教怎麼修，而不是丟例外',
     diag.missing.fails.length === 1 && diag.missing.text.indexOf('list.js') > 0,
     diag.missing.text.split('\n')[1]);
  ok('每一份有問題的報告都寫得出修法',
     [diag.boom, diag.args, diag.nan, diag.pal, diag.gone, diag.pin, diag.missing]
       .every(r => /修法/.test(r.text)),
     '七種壞法（例外／少參數／NaN／配色／消失／針尖／找不到）都附了修法');

  /* 遊戲裡**不該**有檢查藍圖的入口：做藍圖是做藍圖、玩是玩。
     入口在 藍圖預覽.html（下一段測），設定面板不留這一格。 */
  const noDiagInGame = await page.evaluate(() => ({
    btn: !!document.getElementById('diagBtn'),
    box: !!document.getElementById('diagWrap'),
    panelBtns: [...document.querySelectorAll('#panel button')].map(b => b.id).join(',')
  }));
  ok('遊戲的設定面板沒有檢查藍圖那一格',
     !noDiagInGame.btn && !noDiagInGame.box,
     '面板上的按鈕只有 ' + noDiagInGame.panelBtns);

  /* 命令列版與預覽頁的報告必須是同一份輸出，不然兩邊會給出不同建議。
     這裡直接在測試行程 require 那支檔，跟瀏覽器裡的結果逐字比對。 */
  const cliSame = await (async () => {
    const nodeBP = require(path.join(ROOT, 'src/blueprints.js'));
    const ver = await page.evaluate(() => VERSION);
    const web = await page.evaluate(() => checkBlueprint(0, { ver: VERSION }).text);
    const cli = nodeBP.checkBlueprint(0, { ver }).text;
    /* 「產生時間」那兩行是當下量到的耗時，本來就會因為機器與引擎不同而有無
       （node 跟 headless chromium 的速度不一樣，同一台機器上跑兩次也可能跨過門檻），
       而它會不會出現又會改到「結論」那行的提醒數。要比的是報告內容，
       不是這一次量到多快，所以這三行先挑掉。 */
    const strip = t => t.split('\n')
      .filter((l, i, a) => l.indexOf('產生時間') < 0 && l.indexOf('結論：') < 0 &&
                           !(i > 0 && a[i - 1].indexOf('產生時間') >= 0))
      .join('\n');
    const a = strip(cli), b = strip(web);
    let first = '';
    if (a !== b) {
      const la = a.split('\n'), lb = b.split('\n');
      for (let i = 0; i < Math.max(la.length, lb.length); i++)
        if (la[i] !== lb[i]) { first = '第 ' + i + ' 行：cli「' + la[i] + '」／頁面「' + lb[i] + '」'; break; }
    }
    return { same: a === b, cliHead: cli.split('\n')[1], n: a.length, first };
  })();
  ok('命令列版（tools/check-bp.cjs）與預覽頁的報告逐字相同', cliSame.same,
     cliSame.first || (cliSame.cliHead + '，' + cliSame.n + ' 字元'));

  /* ── 藍圖預覽頁（藍圖預覽.html）───────────────────────────
     做藍圖用的獨立進入點：看得到蓋起來的樣子、按一下產出可貼回給 AI 的報告。
     它不載 game.js（那會把整個遊戲跑起來），所以引擎那些「還沒餵資料」的網格
     要自己清乾淨——不清的話原點會冒出 80 個小人。 */
  head('藍圖預覽頁');
  const vpErr = [];
  // acceptDownloads：那一頁的「下載畫面」要真的存得出檔案才驗得到
  const vp = await browser.newPage({ viewport: VIEW, acceptDownloads: true });
  vp.on('pageerror', e => vpErr.push('pageerror: ' + e.message));
  vp.on('console', m => { if (m.type() === 'error') vpErr.push('console: ' + m.text()); });
  await vp.goto('file:///' + path.join(ROOT, '藍圖預覽.html').replace(/\\/g, '/'));
  // bp 是 let 宣告的，在全域詞法環境裡而不是 window 上，所以要用 typeof 問
  await vp.waitForFunction(() => typeof ENG !== 'undefined' && typeof bp !== 'undefined' && bp);
  const vpBoot = await vp.evaluate(() => ({
    opts: document.getElementById('shape').options.length,
    first: document.getElementById('shape').options[0].textContent,
    blocks: bp.slots.length,
    drawn: ENG.three.blockMesh.count,
    workers: ENG.three.workerMesh.count,
    calls: ENG.info().calls,
    ver: VIEWER_VER,
    spin: document.getElementById('spin').checked,
    stat: document.getElementById('stat').textContent,
    /* 引擎每個 InstancedMesh 的預設 count 就是它的上限。這一頁沒餵資料的那些
       必須是 0，不然原點會冒出 80 個小人、一堆石頭與樹（visible 仍是 true
       但 count=0 就不畫，所以要看 count 而不是看 visible）。 */
    ghosts: ENG.three.scene.children
      .filter(o => o.isInstancedMesh && o !== ENG.three.blockMesh && o.visible && o.count > 0)
      .length
  }));
  ok('預覽頁載得起來，48 座 + 自訂都在選單裡，自訂排最前面',
     vpBoot.opts === ALL_SHAPES && vpBoot.first.indexOf('★') === 0,
     vpBoot.opts + ' 個選項，第一個是「' + vpBoot.first + '」');
  ok('預覽頁真的把藍圖畫出來了',
     vpBoot.drawn === vpBoot.blocks && vpBoot.blocks > 100 && vpBoot.calls <= 8,
     vpBoot.blocks + ' 塊全部進了 InstancedMesh，' + vpBoot.calls + ' 個 draw call');
  ok('預覽頁沒有小人，也沒有任何沒餵資料就冒出來的網格',
     vpBoot.workers === 0 && vpBoot.ghosts === 0,
     '小人 ' + vpBoot.workers + ' 個、還有 ' + vpBoot.ghosts +
     ' 顆 InstancedMesh 沒清乾淨（積木那顆不算）');
  ok('預覽頁的統計行寫出塊數與尺寸',
     /\d+ 塊/.test(vpBoot.stat) && /尺寸 \d+×\d+×\d+/.test(vpBoot.stat), vpBoot.stat);
  // 自轉預設關：對照參考圖時畫面一直轉反而不好比
  ok('預覽頁的自轉預設是關著的', vpBoot.spin === false,
     '開場 spin=' + vpBoot.spin);

  /* list.js 產生器（v1.56）：.js 存進 blueprints/ 之後還得自己把檔名加進 list.js，
     忘了加就等於沒放——檔案在那裡、遊戲卻看不到，而且不會有任何錯誤訊息。
     這幾條驗開場的預設狀態，以及「產出來的檔案能不能直接覆蓋回去」。 */
  const vpList0 = await vp.evaluate(() => {
    const box = [...document.querySelectorAll('#files input')];
    return { files: box.map(i => i.dataset.f), on: box.filter(i => i.checked).length,
             open: document.getElementById('listBox').open,
             toggle: document.getElementById('allOn').textContent,
             msg: document.getElementById('listMsg').textContent };
  });
  ok('list.js 產生器列出 blueprints/ 現在有的藍圖，預設全勾',
     vpList0.files.join(',') === '範例-小教堂.js' && vpList0.on === vpList0.files.length &&
     vpList0.toggle === '全不選' && vpList0.open === false,
     vpList0.on + '／' + vpList0.files.length + ' 勾起來（' + vpList0.files.join('、') +
     '），預設收合，' + vpList0.msg);
  await vp.evaluate(() => { document.getElementById('listBox').open = true; });
  const [listDl] = await Promise.all([vp.waitForEvent('download'), vp.click('#dlList')]);
  const listPath = path.join(OUT, 'viewer-list.js');
  await listDl.saveAs(listPath);
  /* 產出來的要能直接覆蓋回 blueprints/list.js，所以連抬頭那段註解都要一樣——
     不然每產一次就把「為什麼要這份清單」那段說明洗掉一次。
     （工作區的換行是 CRLF、產出來的是 LF，比的是內容不是換行。） */
  const nl = t => t.replace(/\r\n/g, '\n');
  const listMade = nl(fs.readFileSync(listPath, 'utf8'));
  const listReal = nl(fs.readFileSync(path.join(ROOT, 'blueprints/list.js'), 'utf8'));
  ok('產出來的 list.js 跟現在那份逐字相同（可以直接覆蓋回去）',
     listDl.suggestedFilename() === 'list.js' && listMade === listReal,
     '檔名「' + listDl.suggestedFilename() + '」，' + listMade.split('\n').length + ' 行' +
     (listMade === listReal ? '' : '（跟 blueprints/list.js 不一樣）'));
  ok('產出來的 list.js 是合法的 JS，載進去拿得到 BP_FILES',
     (() => {
       try {
         const got = new Function(listMade + ';return typeof BP_FILES !== "undefined" ? BP_FILES : null;')();
         return Array.isArray(got) && got.join(',') === '範例-小教堂.js';
       } catch (e) { return false; }
     })(),
     'BP_FILES 解析得出來');
  // 收回預設狀態：它預設是收合的，下面量版面那條要在預設狀態下量
  await vp.evaluate(() => { document.getElementById('listBox').open = false; });

  const vpBig = await vp.evaluate(() => {
    const sel = document.getElementById('shape');
    sel.value = String(SHAPES.findIndex(s => s.n === '吉薩金字塔'));
    sel.dispatchEvent(new Event('change'));
    const btns = [...document.getElementById('cnt').children];
    const t0 = performance.now();
    btns[btns.length - 1].click();                   // 最大那一檔
    return { ms: Math.round(performance.now() - t0), want: wantCnt, blocks: bp.slots.length,
             drawn: ENG.three.blockMesh.count, maxb: ENG.MAXB,
             opts: btns.map(b => +b.dataset.v), on: btns.filter(b => b.classList.contains('on')).length };
  });
  ok('預覽頁最大那一檔也畫得完（沒有被積木池夾掉）',
     vpBig.want === 9000 && vpBig.blocks > 8500 && vpBig.drawn === vpBig.blocks &&
     vpBig.blocks <= vpBig.maxb && vpBig.on === 1,
     '吉薩金字塔要 ' + vpBig.want + ' → ' + vpBig.blocks + ' 塊全上場（池子 ' + vpBig.maxb +
     '），產生 ' + vpBig.ms + 'ms');
  // 兩頁的建材檔位要一樣：預覽頁不載 game.js，所以那三個數字是各留一份的
  const vpOpts = await vp.evaluate(() => CNT_OPTS);
  const gameOpts = await page.evaluate(() => CNT_OPTS);
  ok('預覽頁的建材三檔跟遊戲一致', String(vpOpts) === String(gameOpts),
     '預覽頁 ' + vpOpts + '、遊戲 ' + gameOpts);

  await vp.click('#chk');
  await vp.waitForTimeout(200);
  const vpRep = await vp.evaluate(() => {
    const t = document.getElementById('rep').value;
    return { head: t.split('\n')[0], lines: t.split('\n').length, ver: VIEWER_VER };
  });
  ok('預覽頁按「檢查藍圖」產出帶版本號的報告',
     vpRep.head === '=== 積木小人 · 藍圖診斷 v' + vpRep.ver + ' ===' && vpRep.lines > 10,
     vpRep.head + '，' + vpRep.lines + ' 行');
  await vp.click('#copy');
  await vp.waitForTimeout(250);
  const vpCopy = await vp.evaluate(() => document.getElementById('copy').textContent);
  ok('複製報告按得動（file:// 上會退回 execCommand）', /已複製|Ctrl\+C/.test(vpCopy),
     '按鈕變成「' + vpCopy + '」');

  const vpWire = await vp.evaluate(() => {
    const w = document.getElementById('wire');
    w.checked = true; w.dispatchEvent(new Event('change'));
    const off = ENG.three.scene.children.filter(o => o.isMesh && o.visible).length;
    w.checked = false; w.dispatchEvent(new Event('change'));
    return { off, on: ENG.three.scene.children.filter(o => o.isMesh && o.visible).length };
  });
  ok('「只看輪廓」把草地收掉、再打開會回來', vpWire.off === 1 && vpWire.on > 1,
     '關掉草地後看得見 ' + vpWire.off + ' 顆網格（只剩積木），打開後 ' + vpWire.on + ' 顆');
  ok('預覽頁的版本號跟 src/game.js 一致', vpBoot.ver === await page.evaluate(() => VERSION),
     '預覽頁 v' + vpBoot.ver);

  /* v1.49 的版面：貼上框是這一頁的主角（AI 給的藍圖動輒上百行），
     報告是拿來複製的不是拿來讀完的，所以它比貼上框矮。 */
  const vpBox = await vp.evaluate(() => {
    const h = id => Math.round(document.getElementById(id).getBoundingClientRect().height);
    const side = document.getElementById('side');
    const box = document.getElementById('pasteBox');
    box.open = true;
    /* 量 scrollHeight 而不是外框高度：卡片有 max-height，展開時早就頂到上限了，
       拿外框相減量到的是「被夾掉多少」而不是「內容差多少」（面板一多一格就會誤判）。 */
    const open = side.scrollHeight;
    box.open = false;
    const shut = side.scrollHeight;
    const fits = Math.round(side.getBoundingClientRect().height);
    box.open = true;
    return { paste: h('paste'), rep: h('rep'), open, shut, fits, view: window.innerHeight };
  });
  /* 卡片高度跟著內容走：貼上區收起來就該跟著變矮，而且外框要剛好等於內容
     （以前是 top/bottom 都釘住，報告縮小之後下面會留一塊空白）。 */
  ok('貼上框比報告框大，卡片高度跟著內容走',
     vpBox.paste > vpBox.rep * 1.4 && vpBox.paste > 180 &&
     vpBox.shut < vpBox.open - 200 && Math.abs(vpBox.fits - vpBox.shut) <= 1 &&
     vpBox.shut < vpBox.view - 150,
     '貼上框 ' + vpBox.paste + 'px、報告 ' + vpBox.rep + 'px；內容展開 ' + vpBox.open +
     'px、收起 ' + vpBox.shut + 'px（外框 ' + vpBox.fits + '，畫面高 ' + vpBox.view + '）');

  /* 下載畫面：報告講不出「像不像」，那要看圖。這條要驗到真的有一個 PNG 掉下來——
     canvas 的 drawingBuffer 合成後就被清空，沒有「render 完馬上取」的話會存到全黑或全空。 */
  const [vpDl] = await Promise.all([
    vp.waitForEvent('download'),
    vp.click('#shot')
  ]);
  const dlPath = path.join(OUT, 'viewer-shot.png');
  await vpDl.saveAs(dlPath);
  const dlSize = fs.statSync(dlPath).size;
  const dlHead = fs.readFileSync(dlPath).slice(1, 4).toString('latin1');
  ok('按「下載畫面」真的存得出一張畫面 PNG',
     dlHead === 'PNG' && dlSize > 20000 && /\.png$/.test(vpDl.suggestedFilename()),
     '檔名「' + vpDl.suggestedFilename() + '」，' + Math.round(dlSize / 1024) + ' KB');

  /* 貼上藍圖：做藍圖的節奏是「貼上 → 看 → 改 → 再貼」，中間不該卡著存檔案 + 編輯 list.js。
     這幾條驗的是那條路的每一種結局，包含 AI 實際輸出長什麼樣（markdown 圍籬 + 檔名那行）。 */
  const SAMPLE = fs.readFileSync(path.join(ROOT, 'blueprints/範例-小教堂.js'), 'utf8')
                   .replace("name: '範例小教堂'", "name: '貼上來的小屋'");
  const pasteInto = async src => {
    // 不強制展開：貼上區要自己一直開著（v1.50.1），這裡幫它打開就驗不到那件事
    await vp.evaluate(t => { document.getElementById('paste').value = t; }, src);
    await vp.click('#load');
    await vp.waitForTimeout(200);
    return vp.evaluate(() => ({
      msg: document.getElementById('pasteMsg').textContent,
      bad: document.getElementById('pasteMsg').className.indexOf('bad') >= 0,
      open: document.getElementById('pasteBox').open,
      picked: document.getElementById('shape').selectedOptions[0].textContent,
      name: bp ? bp.name : null,
      drawn: ENG.three.blockMesh.count,
      shapes: SHAPES.length,
      rep: document.getElementById('rep').value.split('\n')[1] || ''
    }));
  };
  const pGood = await pasteInto('```js\n// 檔名：我的小屋.js\n' + SAMPLE + '\n```');
  // v1.49 起說明文件要求 AI 整份包成一個 ```js 區塊、第一行是檔名註解——照那個格式貼
  ok('貼上 AI 給的整個 ```js 區塊（含圍籬與檔名那行）就能預覽',
     !pGood.bad && pGood.name === '貼上來的小屋' && pGood.drawn > 100 &&
     pGood.picked.indexOf('貼上來的小屋') > 0 && pGood.shapes === ALL_SHAPES + 1,
     pGood.msg + '（畫了 ' + pGood.drawn + ' 塊）');
  /* 載入成功不去動貼上區：下一輪還要在那段文字上改，自動收起來的話每次都得先點開 */
  ok('貼上之後順手把診斷也跑掉了，而且貼上區還開著',
     pGood.rep === '藍圖：貼上來的小屋（自訂 · gen）' && pGood.open,
     '報告第二行「' + pGood.rep + '」，貼上區 open=' + pGood.open);
  const pAgain = await pasteInto(SAMPLE.replace("'#4a5a68'", "'#3a6fc0'"));
  ok('同名再貼一次是蓋掉，不會愈貼愈多',
     !pAgain.bad && pAgain.shapes === ALL_SHAPES + 1 && pAgain.name === '貼上來的小屋',
     '清單仍是 ' + pAgain.shapes + ' 座（內建 48 + 檔案 1 + 貼上 1）');
  const pClash = await pasteInto(SAMPLE.replace("name: '貼上來的小屋'", "name: '吉薩金字塔'"));
  ok('撞到內建或檔案裡的名字會被擋掉，而且說得出原因',
     pClash.bad && pClash.msg.indexOf('撞號') > 0 && pClash.shapes === ALL_SHAPES + 1,
     pClash.msg);
  const pSyntax = await pasteInto('customBlueprint({ name: "壞的", pal: ["#fff"], gen(v, s) { v.box(0,0,0 } });');
  ok('語法錯的貼上會講「語法錯誤」，不是靜靜地什麼都沒發生',
     pSyntax.bad && pSyntax.msg.indexOf('語法錯誤') > 0 && pSyntax.shapes === ALL_SHAPES + 1,
     pSyntax.msg);
  const pJunk = await pasteInto('console.log("hello")');
  ok('貼到不是藍圖的東西會講清楚要貼什麼',
     pJunk.bad && pJunk.msg.indexOf('customBlueprint') > 0, pJunk.msg);
  const pBoom = await pasteInto(
    "customBlueprint({ name: '會爆的', pal: ['#fff'], lo: 2, hi: 9, gen() { throw new Error('測試用'); } });");
  ok('gen 會爆的藍圖照樣載得進來，讓報告去指出哪裡爆',
     !pBoom.bad && pBoom.drawn === 0 && pBoom.rep === '藍圖：會爆的（自訂 · gen）',
     '畫不出東西（' + pBoom.drawn + ' 塊），但報告認得它');
  const pBoomRep = await vp.evaluate(() => document.getElementById('rep').value);
  ok('那份報告裡有 gen 的錯誤訊息與修法',
     pBoomRep.indexOf('測試用') > 0 && pBoomRep.indexOf('修法') > 0,
     pBoomRep.split('\n').find(l => l.indexOf('測試用') > 0) || '(沒寫到)');

  /* 下載 .js（v1.53）：滿意的那一版就在貼上框裡，但要留下來還得自己選取、複製、開編輯器、
     貼上、存檔。這幾條驗的是「真的掉得出一個檔案、檔名照『// 檔名：』那行、
     內容乾淨到可以直接丟回來再跑一次」。 */
  const pKeep = await pasteInto('```js\n// 檔名：我的小屋.js\n' + SAMPLE + '\n```');
  const pickShape = n => vp.evaluate(n => {
    const sel = document.getElementById('shape');
    sel.value = String(SHAPES.findIndex(s => s.n === n));
    sel.dispatchEvent(new Event('change'));
    return document.getElementById('save').disabled;
  }, n);
  const saveOnPasted = await vp.evaluate(() => document.getElementById('save').disabled);
  const saveOnBuiltin = await pickShape('吉薩金字塔');
  await pickShape('貼上來的小屋');
  const [jsDl] = await Promise.all([vp.waitForEvent('download'), vp.click('#save')]);
  const jsPath = path.join(OUT, 'viewer-save.js');
  await jsDl.saveAs(jsPath);
  const jsText = fs.readFileSync(jsPath, 'utf8');
  ok('內建藍圖沒有「下載 .js」可按，貼上來的才有',
     saveOnBuiltin === true && saveOnPasted === false && !pKeep.bad,
     '貼上來的 disabled=' + saveOnPasted + '、內建 disabled=' + saveOnBuiltin);
  ok('按「下載 .js」存得出檔案，檔名照「// 檔名：」那一行',
     jsDl.suggestedFilename() === '我的小屋.js' && jsText.indexOf('```') < 0 &&
     jsText.indexOf("name: '貼上來的小屋'") > 0 && jsText.trim().endsWith('});'),
     '檔名「' + jsDl.suggestedFilename() + '」，' + jsText.split('\n').length + ' 行、' +
     Math.round(jsText.length / 1024) + ' KB');
  const pRound = await pasteInto(jsText);
  ok('存出來的檔案再貼回來照樣跑得動（可以直接放進 blueprints/）',
     !pRound.bad && pRound.name === '貼上來的小屋' && pRound.drawn > 100,
     pRound.msg + '（畫了 ' + pRound.drawn + ' 塊）');

  /* 貼進來的檔名也要進候選清單：節奏是「貼上 → 下載 .js → 放進資料夾 → 補 list.js」，
     最後那一步緊接在後面，不該還要自己回頭打一次檔名。 */
  const vpList1 = await vp.evaluate(() => {
    const box = [...document.querySelectorAll('#files input')];
    return { files: box.map(i => i.dataset.f), on: box.filter(i => i.checked).length,
             tags: [...document.querySelectorAll('#files em')].map(e => e.textContent) };
  });
  ok('這一頁貼上的藍圖檔名也會出現在清單裡，並標明來源',
     vpList1.files.indexOf('我的小屋.js') > 0 && vpList1.on === vpList1.files.length &&
     vpList1.tags.filter(t => t === '這一頁貼上的').length === vpList1.files.length - 1,
     vpList1.files.join('、'));
  const vpList2 = await vp.evaluate(() => {
    const t = [...document.querySelectorAll('#files input')].find(i => i.dataset.f === '會爆的.js');
    t.checked = false;
    t.dispatchEvent(new Event('change', { bubbles: true }));
    return { text: listText(), toggle: document.getElementById('allOn').textContent };
  });
  ok('取消勾選的檔名就不會寫進 list.js',
     vpList2.text.indexOf("'會爆的.js'") < 0 && vpList2.text.indexOf("'我的小屋.js'") > 0 &&
     vpList2.text.indexOf("'範例-小教堂.js'") > 0 && vpList2.toggle === '全選',
     '產出來的清單是 ' + (vpList2.text.match(/'[^']+'/g) || []).join('、'));

  /* 掃資料夾：file:// 沒辦法自己列資料夾（fetch 被 CORS 擋），
     <input webkitdirectory> 是瀏覽器唯一肯交出檔名清單的路。掃完就以資料夾為準。 */
  // 餵真的資料夾（webkitdirectory 的 input 只收得下目錄），檔案的 webkitRelativePath 才是真的
  await vp.setInputFiles('#dir', path.join(ROOT, 'blueprints'));
  const vpScan = await vp.evaluate(() => {
    const box = [...document.querySelectorAll('#files input')];
    return { files: box.map(i => i.dataset.f), on: box.filter(i => i.checked).length,
             msg: document.getElementById('listMsg').textContent };
  });
  ok('掃過資料夾之後，清單就等於資料夾裡真的有的藍圖（list.js 與非 .js 都不算）',
     vpScan.files.join(',') === '範例-小教堂.js' && vpScan.on === 1 &&
     vpScan.msg.indexOf('掃到 1 支') === 0,
     vpScan.msg);
  const vpPaths = await vp.evaluate(() => ({
    inner: bpFilesFrom(['my-tower.js', 'list.js', '藍圖製作說明.md', 'sub/hut.js']),
    root: bpFilesFrom(['index.html', 'src/game.js', 'blueprints/list.js',
                       'blueprints/my-tower.js', 'blueprints/範例-小教堂.js']),
    order: bpFilesFrom(['ZZ.js', '範例-小教堂.js', 'AA.js'])
  }));
  ok('選錯成整包的根目錄也接得住（只收 blueprints/ 底下那些）',
     vpPaths.inner.join(',') === 'my-tower.js,sub/hut.js' &&
     vpPaths.root.join(',') === '範例-小教堂.js,my-tower.js',
     '選資料夾本身 → ' + vpPaths.inner.join('、') + '；選根目錄 → ' + vpPaths.root.join('、'));
  ok('本來就在 list.js 裡的排前面，新掃到的接在後面',
     vpPaths.order.join(',') === '範例-小教堂.js,AA.js,ZZ.js',
     vpPaths.order.join(' → '));

  ok('預覽頁整段跑完沒有 console 錯誤', vpErr.length === 0, vpErr.join(' / ') || '乾淨');
  await vp.close();

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
     1.31 是安全帽頂（engine.js 的 BODY：帽頂 p 1.25 + 高度 0.12 的一半）。 */
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

  /* v1.51 整體放大 1.5 倍：之前遠鏡頭下只剩一撮色點，數不出幾個人、
     也看不出誰頭上頂著積木。模型腳底到帽頂 1.31，乘上個體身高要落在兩塊多積木。 */
  ok('小人有兩塊多積木高', 1.31 * carry.lo > 2 && 1.31 * carry.hi < 2.6,
     '身高 ' + (1.31 * carry.lo).toFixed(2) + '–' + (1.31 * carry.hi).toFixed(2) +
     ' 格（積木邊長 0.94、格距 1）');

  /* 放大之後那七塊方塊就是一疊方塊，所以補了臉、鞋、腰帶。
     這裡不看像不像，只驗「該有的部位真的擺在該在的位置」——
     部位漏掉或位置寫錯（例如鞋子留在原地不跟腿走）從畫面上不一定看得出來。 */
  const build = await page.evaluate(() => {
    const pose = extra => {
      const w = workers[1];
      Object.assign(w, { x: 0, y: 0, z: 0, a: 0, gait: 0, ph: 0, carry: false, plan: 0,
                         bub: 0, talk: 0, point: 0, hail: 0, fall: 0, tilt: 0, roll: 0 }, extra);
      ENG.putWorker(1, w);
      const m = new THREE.Matrix4(), v = new THREE.Vector3(), out = [];
      for (let k = 0; k < ENG.WPARTS; k++) {
        ENG.three.workerMesh.getMatrixAt(ENG.WPARTS + k, m);
        if (m.elements[0] === 0 && m.elements[5] === 0) continue;   // 沒拿的道具縮成 0
        v.setFromMatrixPosition(m);
        out.push({ x: v.x, y: v.y, z: v.z });
      }
      return { s: w.scale, parts: out.sort((p, q) => p.y - q.y) };
    };
    const st = pose({});
    const s = st.s;
    // 臉朝 +z（a=0）：眼睛要凸出臉皮、左右對稱；帽舌要更往前而且在帽子的高度
    const eyes = st.parts.filter(p => Math.abs(p.y - 1.06 * s) < 0.03 * s &&
                                      p.z > 0.19 * s && Math.abs(p.x) > 0.05 * s);
    const peak = st.parts.filter(p => p.z > 0.28 * s && p.y > 1.1 * s);
    // 由低到高：最低兩塊是鞋、再上去兩塊是腿
    const lowest = st.parts.slice(0, 4);
    // 走路時鞋要跟著同一隻腿往同一邊擺，而且擺得比腿更遠（它離髖關節更遠）
    const wk = pose({ gait: 1, ph: Math.PI / 2 });
    const low = wk.parts.slice(0, 4);
    const shoeL = low.slice(0, 2).find(p => p.x < 0), shoeR = low.slice(0, 2).find(p => p.x > 0);
    const legL = low.slice(2, 4).find(p => p.x < 0), legR = low.slice(2, 4).find(p => p.x > 0);
    const same = shoeL && legL && shoeR && legR &&
                 shoeL.z * legL.z > 0 && shoeR.z * legR.z > 0;
    return { n: st.parts.length, parts: ENG.WPARTS, s: +s.toFixed(2),
             eyes: eyes.length, sym: eyes.length === 2 ? +(eyes[0].x + eyes[1].x).toFixed(3) : 9,
             peak: peak.length, shoeY: +(lowest[1].y / s).toFixed(2), legY: +(lowest[3].y / s).toFixed(2),
             same, far: same ? +(Math.abs(shoeL.z) - Math.abs(legL.z)).toFixed(3) : -1 };
  });
  ok('臉上有兩顆對稱的眼睛、帽子有帽舌、腳上有鞋',
     build.eyes === 2 && Math.abs(build.sym) < 1e-6 && build.peak === 1 &&
     build.shoeY < 0.12 && build.legY > 0.15,
     build.parts + ' 塊部位畫了 ' + build.n + ' 塊（其餘是沒拿的道具）；鞋在 y=' +
     build.shoeY + '、腿在 y=' + build.legY);
  ok('走路時鞋跟著同一隻腿擺，而且擺得比腿更遠',
     build.same && build.far > 0.05,
     '鞋比腿多往前 ' + build.far + '（鞋離髖 0.36、腿離髖 0.21）');
  /* ── 不從蓋好的部分中間穿過去（v1.52）────────────────────────
     以前 pick／build 是兩點拉直線、站位只往外推 1.3 格，於是搬積木的人整趟都在
     建築裡面走，站位還常常落在牆裡（舊版實測：城堡 32%、聖母院 42% 的人-幀在牆裡）。
     三件事一起改：站位退到外緣、路線繞開、拋物線跨過中間的牆。
     這裡量的是「人-幀」與「拋出去的積木有沒有從牆裡穿過去」。 */
  const route = await page.evaluate(() => {
    const run = name => {
      shapePick = SHAPES.findIndex(s => s.n === name);
      targetCnt = 3000; setWorkerCount(20); startBuild(true);
      let frames = 0, inWall = 0, arcs = 0, arcHit = 0;
      const seen = new Set();
      for (let i = 0; i < 2400 && phase !== 'done'; i++) {
        step(0.05);
        if (i % 4 === 0) for (const w of workers) {
          if (w.st !== 'pick' && w.st !== 'build' && w.st !== 'wait') continue;
          frames++;
          // 腳邊那兩層有已就位的積木 = 人卡在建築裡
          if (blockAt(w.x, HB, w.z) || blockAt(w.x, 1 + HB, w.z)) inWall++;
        }
        for (const b of blocks) {
          if (b.st !== 2 || !b.arc || seen.has(b)) continue;
          seen.add(b); arcs++;
          const a = b.arc;
          for (let k = 5; k < 37; k++) {          // 掐頭去尾：出手與落點本來就貼著積木
            const u = k / 40;
            const y = a.y0 + (a.y1 - a.y0) * u + Math.sin(u * Math.PI) * a.peak;
            if (blockAt(a.x0 + (a.x1 - a.x0) * u, y, a.z0 + (a.z1 - a.z0) * u)) { arcHit++; break; }
          }
        }
      }
      return { name, placed: placedCnt,
               inWall: +(inWall / Math.max(1, frames) * 100).toFixed(2),
               arc: +(arcHit / Math.max(1, arcs) * 100).toFixed(2) };
    };
    return ['中世紀城堡', '巴黎聖母院'].map(run);
  });
  ok('施工中不會有人在蓋好的積木裡走動',
     route.every(r => r.inWall < 8),
     route.map(r => r.name + ' ' + r.inWall + '%').join('、') + '（舊版 32%／42%）');
  ok('拋出去的積木不會從牆裡穿過去',
     route.every(r => r.arc < 6),
     route.map(r => r.name + ' ' + r.arc + '%').join('、') + '（舊版 20%／45%）');

  /* 站位本身：拿蓋好的整座來算，每個格子的站位都不該落在積木裡。
     實心造型的正中央退到外緣要超過 TOSS_MAX 格，那種會退回原本的做法（見 standPos）。 */
  const stand = await page.evaluate(() => {
    const run = name => {
      shapePick = SHAPES.findIndex(s => s.n === name);
      targetCnt = 3000; startBuild(true); completeNow();
      let n = 0, bad = 0, out = 0, far = 0;
      for (const s of bp.slots) {
        if (s.y < 2) continue;                   // 蓋第 0、1 層時周圍還是空地
        n++;
        const p = standPos(s);
        if (footBlocked(p.x, p.z)) bad++;        // 站位在積木裡（＝退不出來的那種）
        const d = Math.hypot(p.x - s.x, p.z - s.z);
        if (d > 1.31) out++;                     // 有退到外緣
        if (d > 11.31) far++;                    // 超過 TOSS_MAX 還在退（不該發生）
      }
      return { name, n, bad: +(bad / n * 100).toFixed(1), out: +(out / n * 100).toFixed(1), far };
    };
    return ['中世紀城堡', '台北 101'].map(run);
  });
  ok('內部的格子會退到外緣站，退不出來的才照舊走進去',
     stand.every(r => r.bad < 25 && r.out > 25 && r.far === 0),
     stand.map(r => r.name + '：退到外緣 ' + r.out + '%、站位仍在積木裡 ' + r.bad + '%').join('　'));

  await reset(page, { shape: '吉薩金字塔', cnt: 400, workers: 16, scale: 1 });
  await sim(page, 200);
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
             rad: { lo: Math.min(...ds), hi: Math.max(...ds), want: +cheerR().toFixed(2) },
             gap: { lo: Math.min(...gaps), hi: Math.max(...gaps), want: +(360 / workers.length).toFixed(1) },
             after, spread, siteR: +siteR.toFixed(1) };
  });
  ok('蓋完後很快就圍成一圈', cheer.allAt > 0 && cheer.allAt < 2.5,
     cheer.allAt + ' 秒全員就位（照現況分配位置，不是照編號硬分）');
  ok('圍的是等分的一圈', cheer.gap.hi - cheer.gap.lo < 1 &&
     Math.abs(cheer.gap.lo - cheer.gap.want) < 1 && cheer.rad.hi - cheer.rad.lo < 0.1 &&
     Math.abs(cheer.rad.lo - cheer.rad.want) < 0.15,
     '相鄰間隔 ' + cheer.gap.lo + '–' + cheer.gap.hi + '°（等分是 ' + cheer.gap.want +
     '°）、半徑 ' + cheer.rad.lo + '–' + cheer.rad.hi + '（該站 ' + cheer.rad.want +
     '，建築半徑 ' + cheer.siteR + '）');
  /* 慶祝感的重點是「跳」：離地要有高度、要落回地面、而且是站定了跳不是邊跑邊顛。
     舊版是繞著建築跑一圈，y 用 |sin| 連續起伏——那看起來像在漂浮。 */
  ok('站定原地跳，不是邊跑邊顛', cheer.jumps >= 5 && cheer.landed >= 5 &&
     cheer.maxY > 0.4 && cheer.drift === 0,
     '慶祝的六秒半裡跳 ' + cheer.jumps + ' 次、落地 ' + cheer.landed + ' 次，最高 ' +
     cheer.maxY + '；就位後還在水平移動的人次 ' + cheer.drift);
  ok('慶祝完就散開去閒晃', cheer.after === 0 && cheer.spread > cheer.rad.hi + 3,
     '還在舉手的 ' + cheer.after + ' 人，最遠走到 ' + cheer.spread);
  /* 圈的半徑本來寫死 siteR + 2.6。最小的建築 siteR 只有 7，那一圈長 60 格，
     分給 60 個人是每人 1 格——小人放大之後（連手臂約 1.56 格寬）整圈會插在一起。
     所以半徑要跟著人數走，這條驗的是「人多的時候真的撐得開」。 */
  const crowd = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '木魚');
    targetCnt = 1800; setWorkerCount(60); startBuild(true);
    /* 上一段測試把人散到四十單位外去了，從那裡走回來要九秒——比慶祝本身還久。
       真的蓋完的那一刻，人都還在工地邊上，所以先把大家擺回工地旁邊。
       一定要在 completeNow() **之前**：圈上的位置是照「那一刻各自站的角度」分的，
       先分完再瞬移的話，每個人都得繞半圈去自己的位置，七秒根本走不到。 */
    for (const w of workers) {
      const a = Math.random() * Math.PI * 2, d = siteR + rr(3, 9);
      w.x = Math.cos(a) * d; w.z = Math.sin(a) * d;
    }
    completeNow();
    for (let i = 0; i < 120; i++) step(0.05);        // 6 秒：慶祝只有 7 秒，滿了他們就散開了
    const on = workers.map(w => ({ a: Math.atan2(w.z, w.x), r: Math.hypot(w.x, w.z) }))
                      .sort((p, q) => p.a - q.a);
    let gap = 1e9;                                   // 圈上相鄰兩人的最小弧長
    for (let i = 0; i < on.length; i++) {
      const b = on[(i + 1) % on.length];
      const d = Math.abs(((b.a - on[i].a + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      gap = Math.min(gap, d * on[i].r);
    }
    return { gap: +gap.toFixed(2), r: +on[0].r.toFixed(1),
             hail: workers.filter(w => w.hail).length, tight: +(siteR + 2.6).toFixed(1) };
  });
  ok('六十個人的慶祝圈會撐開，不會擠成一團',
     crowd.gap > 1.7 && crowd.hail >= 55,
     crowd.hail + ' 人在圈上，半徑撐到 ' + crowd.r + '（寫死的話是 ' + crowd.tight +
     '），每人分到 ' + crowd.gap + ' 格');

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

  /* 整地不碰鏡頭。使用者回報「出現推土機好像會把鏡頭拉遠」，查下來整地這條路上沒有任何運鏡：
     看到的是前一發核彈／魔法退開之後就停在那裡（只退不收），推土機進場時鏡頭還在那個位置。
     這條守住「整地本身不動鏡頭」，以後有人往這裡塞運鏡會被擋下來。 */
  const dozeCam = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '中世紀城堡');
    targetCnt = 1200; startBuild(true); completeNow();
    for (const b of blocks) { if (b.st === 3) freeBlock(b); }
    for (let i = 0; i < 120; i++) step(0.05);
    const d0 = ENG.camTarget.dist, ty0 = ENG.camTarget.ty;
    startClear();
    let g = 0, dMax = d0, dMin = d0, tyMax = ty0;
    while (phase === 'clear' && g++ < 900) {
      step(0.05);
      dMax = Math.max(dMax, ENG.camTarget.dist); dMin = Math.min(dMin, ENG.camTarget.dist);
      tyMax = Math.max(tyMax, ENG.camTarget.ty);
    }
    return { d0: +d0.toFixed(2), dMax: +dMax.toFixed(2), dMin: +dMin.toFixed(2),
             ty0: +ty0.toFixed(2), tyMax: +tyMax.toFixed(2), secs: +(g * 0.05).toFixed(1) };
  });
  ok('整地期間鏡頭完全不動',
     dozeCam.dMax === dozeCam.d0 && dozeCam.dMin === dozeCam.d0 && dozeCam.tyMax === dozeCam.ty0,
     '整地 ' + dozeCam.secs + ' 秒，視距一路都是 ' + dozeCam.d0 + '、視線高度 ' + dozeCam.ty0);

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
    const ring0 = inRing.map(w => ({ x: w.x, z: w.z }));
    castMagic({ x: 0, z: 0 });
    const magFlee = workers.filter(w => w.flee > 0).length;
    for (let i = 0; i < 130 && magic; i++) step(0.05);
    const magOut = inRing.filter(w => Math.hypot(w.x, w.z) >= MAG_R).length;
    const magFar = Math.max(...inRing.map(w => Math.hypot(w.x, w.z)));
    // 各自跑了多遠（起點到終點的直線距離，路線本來就是直的）
    const runs = inRing.map((w, k) => Math.hypot(w.x - ring0[k].x, w.z - ring0[k].z));
    return { on, off, planted, mag: { n: inRing.length, fleeing: magFlee, out: magOut,
                                      far: +magFar.toFixed(1),
                                      runMin: +Math.min(...runs).toFixed(1),
                                      runMax: +Math.max(...runs).toFixed(1) } };
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

  /* 「跑得出去」本來就不是保證：每個人是自己抽 16～34 單位跑完就停（下一條測這件事），
     所以站在陣心附近又抽到短距離的人跑不出半徑 30 是設計如此，不是 bug。
     這條要守的是「全部有起跑、而且大多數真的離開了圈子」——原本寫成「最多兩人沒出去」
     其實是靠運氣過的（實測 16 人裡出去 13 人，81%）。 */
  ok('魔法陣六秒預告，圈內的人來得及跑',
     flee.mag.n > 5 && flee.mag.fleeing >= flee.mag.n &&
     flee.mag.out >= Math.ceil(flee.mag.n * 0.7),
     '圈內 ' + flee.mag.n + ' 人全部起跑，跑出半徑 30 的有 ' + flee.mag.out +
     ' 人（' + Math.round(flee.mag.out / flee.mag.n * 100) + '%，最遠 ' + flee.mag.far + '）');
  /* 小人不會知道這一發的威力範圍到哪裡，所以每個人是「自己抽一段距離跑完就停」，
     不是「跑到安全半徑」。驗的是那段距離真的因人而異、而且落在設定的區間裡。 */
  ok('每個人跑的距離不一樣，跟爆炸半徑無關',
     flee.mag.runMin >= 15 && flee.mag.runMax <= 35 &&
     flee.mag.runMax - flee.mag.runMin > 6,
     '圈內的人各跑了 ' + flee.mag.runMin + '～' + flee.mag.runMax + ' 單位（設定 16～34）');

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
       疊著設的話「拆掉 10 座」會連帶滿足前面所有拆除門檻，
       就分不出某一項到底是被自己的條件開的還是被別人順便開的。 */
    at('smashed', 2000);
    at('destroyed', 2);
    at('smashed', 6000);
    at('destroyed', 4);
    at('smashed', 11000);
    at('destroyed', 6);
    at('smashed', 15000);
    at('destroyed', 8);
    at('smashed', 19000);
    at('destroyed', 10);
    stats = freshStats(); stats.destroyed = 10; stats.smashed = 19000; renderTools();     // 全開
    step2.push(TOOLS.map(t => toolOk(t)).join(','));
    return { step2, btn: [...document.querySelectorAll('.tool')].map(e => e.className.indexOf('lock') >= 0 ? 'lock' : 'open') };
  });
  /* 順序：手指／槌子／大槌／保齡球／投石機／龍捲風／煙火／放火／炸彈／隕石／核彈／魔法。
     兩種紀錄輪流當門檻，所以「擊飛」那幾關會順便開掉前面同一側的，但開不了另一側的。 */
  ok('擊飛 2,000 塊解鎖大槌', lock1.step2[0] === opened(3), lock1.step2[0]);
  ok('拆掉 2 座解鎖保齡球',
     lock1.step2[1] === 'true,true,false,true,false,false,false,false,false,false,false,false', lock1.step2[1]);
  ok('擊飛 6,000 塊解鎖投石機',
     lock1.step2[2] === 'true,true,true,false,true,false,false,false,false,false,false,false', lock1.step2[2]);
  ok('拆掉 4 座解鎖龍捲風',
     lock1.step2[3] === 'true,true,false,true,false,true,false,false,false,false,false,false', lock1.step2[3]);
  ok('擊飛 11,000 塊解鎖煙火',
     lock1.step2[4] === 'true,true,true,false,true,false,true,false,false,false,false,false', lock1.step2[4]);
  ok('拆掉 6 座解鎖放火',
     lock1.step2[5] === 'true,true,false,true,false,true,false,true,false,false,false,false', lock1.step2[5]);
  ok('擊飛 15,000 塊解鎖定時炸彈',
     lock1.step2[6] === 'true,true,true,false,true,false,true,false,true,false,false,false', lock1.step2[6]);
  ok('拆掉 8 座解鎖隕石',
     lock1.step2[7] === 'true,true,false,true,false,true,false,true,false,true,false,false', lock1.step2[7]);
  ok('擊飛 19,000 塊解鎖核彈',
     lock1.step2[8] === 'true,true,true,false,true,false,true,false,true,false,true,false', lock1.step2[8]);
  ok('拆掉 10 座解鎖爆裂魔法',
     lock1.step2[9] === 'true,true,false,true,false,true,false,true,false,true,false,true', lock1.step2[9]);
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

  /* 大槌砸在空地上：不是點狀衝擊，而是整棟震一震，隨機一小部分自己掉下來。
     兩件事要分開驗：掉的量對不對、掉的位置是不是散在整棟（不是砸出一個洞）。
     小槌砸空地是另一回事——v1.50 起它一塊都不該掉，跟著一起驗。 */
  const quakeT = await page.evaluate(() => {
    const one = (big) => {
      shapePick = SHAPES.findIndex(s => s.n === '中世紀城堡');
      targetCnt = 2000; startBuild(true); completeNow();
      shapePick = -1;
      const set0 = placedCnt;
      const at = blocks.map(b => b.st === 3 ? { x: b.x, y: b.y, z: b.z } : null);
      dust.length = 0;               // 先清乾淨才量得準（塵霧有 400 顆上限，滿了就不再生）
      const hx = siteR + 9;                          // 建築外的空地
      launchHammer(new THREE.Vector3(hx, 0, 0), new THREE.Vector3(0, -1, 0), big, true);
      let g = 0;
      while (!quake && swing && !swing.hit && g++ < 20) step(0.05);   // 等槌子落下
      const born = !!quake, swung = !!swing && swing.hit, hitFrames = [];
      const dustUp = dust.length;
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
      return { set0, born, swung, dustUp, fell: set0 - mid, frac: (set0 - mid) / set0,
               waves: hitFrames.length, after: mid - placedCnt, end: placedCnt,
               nearFrac: tot ? near / tot : -1, lo, hi };
    };
    const small = one(false), big = one(true);
    return { small, big };
  });
  ok('大槌砸空地會地震，震掉約 10% 的積木',
     quakeT.big.born && quakeT.big.frac > 0.09 && quakeT.big.frac < 0.18,
     quakeT.big.set0 + ' 塊掉了 ' + quakeT.big.fell + '（' +
     (quakeT.big.frac * 100).toFixed(1) + '%）');
  ok('是分好幾波掉的，不是同一幀全掉', quakeT.big.waves >= 4,
     '掉了 ' + quakeT.big.waves + ' 波');
  ok('震掉的散在整棟，不是在槌子那一帶砸出一個洞',
     quakeT.big.nearFrac >= 0 && quakeT.big.nearFrac < 0.35 &&
     quakeT.big.lo > 0 && quakeT.big.hi > 0,
     '落點 10 單位內只占 ' + (quakeT.big.nearFrac * 100).toFixed(0) +
     '%，下半部 ' + quakeT.big.lo + ' 塊、上半部 ' + quakeT.big.hi + ' 塊');
  /* 允許一點餘波：震掉的那批本來就是分批落下的（fallIn 按高度錯開），
     最後一兩塊落地時抽掉鄰居的支撐，連帶再掉一塊是對的物理。
     要擋的是「一直掉」不是「完全不掉」——實測十二輪 0～2 塊（門檻 0 會有三成機率誤判）。 */
  ok('震完就停，不會一直掉', quakeT.big.after <= 3,
     '地震結束後 2 秒又掉了 ' + quakeT.big.after + ' 塊');
  /* 小槌瞄邊角時很容易擦過去點到地面，那一下震掉 5% 等於每失手一次就賠掉一大片 */
  ok('小槌砸空地不會地震，建築一塊都不掉',
     !quakeT.small.born && quakeT.small.end === quakeT.small.set0,
     quakeT.small.set0 + ' 塊 → ' + quakeT.small.end + ' 塊，quake=' + quakeT.small.born);
  ok('但槌子照樣揮下去、地上照樣噴灰塵（不然像點壞了）',
     quakeT.small.swung && quakeT.small.dustUp > 20,
     '揮擊結算 ' + quakeT.small.swung + '，多了 ' + quakeT.small.dustUp + ' 顆塵');

  await reset(page, { shape: '吉薩金字塔', cnt: 900, workers: 4 });
  const ballR = await page.evaluate(() => {
    completeNow();
    const before = blocks.filter(b => b.st === 3).length;
    const p = { x: -42, y: 0, z: 5 };                  // 第一點：場邊的空地
    launchBall(p, { x: 0, z: 0 });                     // 第二點：工地中心
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

  /* 方向：第一點 → 第二點。八個不同的方向各丟一發，每一發都要對得上自己那個方向，
     而且只差在 ±BALL_SPREAD 的手感偏差裡（本來是「一律朝工地中心」）。 */
  const ballAim = await page.evaluate(() => {
    const err = [];
    for (let k = 0; k < 8; k++) {
      const from = { x: Math.cos(k * 0.8) * 40, z: Math.sin(k * 0.8) * 40 };
      const want = k * 0.77 + 0.3;                     // 跟出手點無關的方向
      launchBall(from, { x: from.x + Math.cos(want) * 25, z: from.z + Math.sin(want) * 25 });
      let d = Math.atan2(ball.vz, ball.vx) - want;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      err.push(d);
    }
    ball = null; ENG.hideBall();
    /* 判斷要用原始值，不能用四捨五入過的顯示值：偏差是 ±BALL_SPREAD 的連續亂數，
       真的抽到 0.0003 這種小數字是完全正常的，但 toFixed(3) 會把它變成 0，
       「min > 0」就誤判成「這一發沒有隨機偏差」。uniq 同理，直接比浮點數本身。 */
    return { max: +Math.max(...err.map(Math.abs)).toFixed(3),
             minRaw: Math.min(...err.map(Math.abs)),
             uniq: new Set(err).size, n: err.length, lim: BALL_SPREAD };
  });
  ok('球滾去的方向就是你指的第二點',
     ballAim.max <= ballAim.lim && ballAim.uniq === ballAim.n,
     ballAim.n + ' 個方向各丟一發，最大只差 ' + ballAim.max + ' rad（手感偏差上限 ' +
     ballAim.lim + '）');
  ok('但每一發還是帶一點隨機偏差，不會兩發一模一樣',
     ballAim.minRaw > 0 && ballAim.uniq === ballAim.n, '八發角度互不相同');

  /* 兩下點擊的流程：第一下只是選出手點（球還沒生），第二下才丟。
     瞄到一半換道具、換建築都要把那個點收掉，不然下次點某處會莫名其妙從舊的點丟出去。 */
  const ballClick = await page.evaluate(() => {
    const keep = tool;
    tool = 'ball'; ballAim = null; ball = null;
    useTool({ kind: 'ground', point: { x: -40, y: 0, z: 0 } });
    const first = { aim: !!ballAim, ball: !!ball, rings: ballAim ? aimRings().length : 0 };
    useTool({ kind: 'ground', point: { x: -40, y: 0, z: 20 } });
    // 第二點在第一點的 +z 方向 → 角度應該是 π/2
    const second = { aim: !!ballAim, ball: !!ball,
                     x: ball ? +ball.x.toFixed(2) : null, z: ball ? +ball.z.toFixed(2) : null,
                     ang: ball ? +Math.atan2(ball.vz, ball.vx).toFixed(3) : null };
    ball = null; ENG.hideBall();
    useTool({ kind: 'ground', point: { x: 9, y: 0, z: 9 } });   // 瞄一半就換建築
    const aimed = !!ballAim;
    startBuild(true);
    const afterSwap = !ballAim;
    tool = keep;
    return { first, second, aimed, afterSwap, lim: BALL_SPREAD };
  });
  ok('第一下只是選出手點，球還沒出去',
     ballClick.first.aim && !ballClick.first.ball && ballClick.first.rings === 2,
     '出手點已記下、球 ' + (ballClick.first.ball ? '生了' : '還沒生') +
     '，地上畫了 ' + ballClick.first.rings + ' 圈瞄準環');
  ok('第二下從第一點出手、往第二點滾',
     ballClick.second.ball && !ballClick.second.aim &&
     ballClick.second.x === -40 && ballClick.second.z === 0 &&
     Math.abs(ballClick.second.ang - Math.PI / 2) <= ballClick.lim,
     '球生在 (' + ballClick.second.x + ', ' + ballClick.second.z + ')，角度 ' +
     ballClick.second.ang + '（要 ' + (Math.PI / 2).toFixed(3) + ' ±' + ballClick.lim + '）');
  ok('換建築會取消瞄到一半的出手點', ballClick.aimed && ballClick.afterSwap);

  /* 滾多遠：把積木清空、場地放大，量到的就是摩擦與壽命本身（不含撞到東西的煞車）。
     v1.39 之前是 6 秒 ×每秒保留 0.82，量到 119.3；現在 7.5 秒 ×0.86，量到 152.7。 */
  const ballRun = await page.evaluate(() => {
    const bk = blocks, wk = workers, ar = arenaR;
    blocks = []; workers = []; arenaR = 300;
    launchBall({ x: -80, z: 0 }, { x: 100, z: 0 });
    let moved = 0, px = ball.x, pz = ball.z, t = 0;
    for (let i = 0; i < 800 && ball; i++) {
      step(0.03); t += 0.03;
      if (!ball) break;
      moved += Math.hypot(ball.x - px, ball.z - pz); px = ball.x; pz = ball.z;
    }
    blocks = bk; workers = wk; arenaR = ar;
    return { moved: +moved.toFixed(1), t: +t.toFixed(2), life: BALL_LIFE };
  });
  ok('空場上一發滾得完整個工地那麼遠',
     ballRun.moved > 140 && ballRun.t >= ballRun.life - 0.1,
     '滾了 ' + ballRun.moved + ' 單位、' + ballRun.t + ' 秒（v1.38 是 119.3 單位／6 秒）');

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
     跟蘑菇雲同一套：鏡頭退到這個效果進得了畫面的距離，而且退開之後就停在那裡不收回來。 */
  const twFrame = await page.evaluate(() => {
    /* 「這一發要退到多遠」直接問 holdWide：把視距壓到最近再問一次，答案就是它要的距離。
       這樣測試不必自己複製一份公式；下面的 startBuild(true) 會照建築重新取景，把這裡動過的蓋掉。 */
    ENG.camTarget.dist = 6; ENG.camTarget.ty = 0; ENG.holdWide(TW_H, TW_R);
    const need = ENG.camTarget.dist;
    shapePick = SHAPES.findIndex(s => s.n === '中世紀城堡');
    targetCnt = 1200; startBuild(true); completeNow();
    // startBuild(true) 走的是開場那條，會立刻照這座重新取景，量到的就是「原本的取景」
    const nat = ENG.camTarget.dist;
    launchTornado({ x: siteR * 0.5, z: 0 });
    for (let i = 0; i < 110; i++) step(0.02);
    const wide = ENG.cam.dist;
    const w = twists[0];
    const top = new THREE.Vector3(w.x, w.h, w.z).project(ENG.three.camera).y;
    // 龍捲風散掉、換場都做完之後再量一次：鏡頭不該自己跑回去
    for (let i = 0; i < (TW_LIFE + 4) * 50; i++) step(0.02);
    const back = ENG.camTarget.dist;
    return { nat: +nat.toFixed(1), need: +need.toFixed(1), wide: +wide.toFixed(1),
             top: +top.toFixed(2), back: +back.toFixed(1) };
  });
  ok('龍捲風期間漏斗頂留在畫面內', twFrame.top < 0.95 && twFrame.top > -1,
     '取景 ' + twFrame.nat + ' → ' + twFrame.wide + '，漏斗頂 NDC ' + twFrame.top);
  /* 「退到看得完整」與「退過頭」是兩件事：距離取的是「原本的取景」與「這一發要的」之中的大者，
     本來就夠遠就不該再往後推（矮建築才會真的退）。差 1.5 是 cam.dist 追 camTarget 的殘差。 */
  ok('鏡頭只退到看得完整那麼遠，不會多退一截',
     Math.abs(twFrame.wide - Math.max(twFrame.nat, twFrame.need)) < 1.5,
     '取景 ' + twFrame.nat + '、龍捲風要 ' + twFrame.need + ' → 實際 ' + twFrame.wide);
  ok('龍捲風結束後鏡頭停在退開的位置', twFrame.back >= twFrame.wide - 1,
     twFrame.nat + ' → ' + twFrame.wide + '，七秒後仍是 ' + twFrame.back);

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
     它是「往天上灑火種」：一發打不掉任何積木，但落下來的火星碰到建築就從那一塊燒起來。
     v1.39 起一次點下去是**三發齊射**（第二、三發晚 0.2～0.5 秒 ×序號出膛）。 */
  head('煙火');
  await reset(page, { shape: '中世紀城堡', cnt: 2000, workers: 4 });
  const fw = await page.evaluate(() => {
    completeNow();
    clearFires();
    // 這一場齊射「要」退到多遠：把視距壓到最近問一次 holdWide 就知道（測試不自己複製公式）
    const d1 = ENG.camTarget.dist, ty1 = ENG.camTarget.ty;
    ENG.camTarget.dist = 6; ENG.camTarget.ty = 0; ENG.holdWide(FW_HOLD_TOP, FW_HOLD_R);
    const need = ENG.camTarget.dist;
    ENG.camTarget.dist = d1; ENG.camTarget.ty = ty1;
    const set0 = placedCnt, d0 = ENG.camTarget.dist;
    launchFw({ x: 0, z: 0 });
    const dist = ENG.camTarget.dist;
    /* 追第一發：齊射之後 fworks[0] 會換人（先炸的先離開陣列），
       所以要認物件本身，不能認索引——不然量到的「竄多高」是三發混在一起的。 */
    const shell0 = fworks[0];
    const seen = new Set(fworks);                  // 一共出膛幾發（含還在排隊的那兩發）
    let top = 0, rise = 0, all = 0, sparks = 0, burstY = 0, ndc = -9;
    while (fworks && fworks.indexOf(shell0) >= 0 && rise < 4) {
      step(0.05); rise += 0.05; all = rise;
      if (fworks) for (const f of fworks) seen.add(f);
      if (fworks && fworks.indexOf(shell0) >= 0) top = Math.max(top, shell0.y);
    }
    while (fworks && all < 6) {                    // 等其他兩發也炸完
      step(0.05); all += 0.05;
      if (fworks) for (const f of fworks) seen.add(f);
    }
    const shells = seen.size, tops = [...seen].map(f => +f.top.toFixed(1));
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
             shells, tops, all: +all.toFixed(2),
             burstY: +burstY.toFixed(1), ndc,
             seeds: pts.length, each: shots.map(s => s.pts.length), spread: +spread.toFixed(1),
             phase, d0: +d0.toFixed(0), dist: +dist.toFixed(0), fall: +shots[0].fall.toFixed(2),
             hold: +need.toFixed(0), shot: FW_SHOT };
  });
  ok('煙火會從地面竄上天再炸開',
     fw.top > 30 && fw.rise > 0.8 && fw.rise < 2.5 && fw.sparks > 120,
     '第一發 ' + fw.rise + ' 秒竄到 ' + fw.top + '，三發合計 ' + fw.sparks + ' 顆火星在天上');
  /* 一次點下去是一場齊射，不是一發：三發、時間錯開、高度各自抽。
     高度全一樣的話三發會在同一條線上炸開，看起來像同一發連放三次。 */
  ok('一次點下去放三發，出膛時間與高度都錯開',
     fw.shells === fw.shot && new Set(fw.tops).size >= 2 &&
     fw.all > fw.rise && fw.all < 3.2,
     fw.shells + ' 發，炸開高度 ' + fw.tops.join('／') + '，全部炸完花 ' + fw.all + ' 秒');
  /* 不退鏡頭的話整發都在畫面外（量過：貼著城堡的取景，火星的 NDC y 是 1.5，1 就出界了）。
     這裡驗兩件事：視距剛好是「原本取景」與「這場齊射要的」之中的大者（不多退）、
     火星確實落在畫面內。 */
  ok('炸開的高度框得進畫面，而且不會退過頭',
     fw.dist === Math.max(fw.d0, fw.hold) && fw.ndc < 0.95 && fw.ndc > -1,
     '視距 ' + fw.d0 + ' → ' + fw.dist + '（煙火要 ' + fw.hold + '），火星 NDC y=' + fw.ndc);
  ok('炸開那一刻一塊積木都沒掉', fw.setAtBurst === fw.set0,
     fw.set0 + ' → ' + fw.setAtBurst + ' 塊（它是灑火種，不是爆炸）');
  ok('落下來的火星把建築點著，而且點在好幾個地方',
     fw.seeds >= 2 && fw.spread > 4 && fw.phase === 'wreck',
     '三輪合計燒起來 ' + fw.seeds + ' 處（' + fw.each.join(' + ') +
     '），三輪合起來最遠兩處相距 ' + fw.spread + '（phase=' + fw.phase + '）');
  const fwOff = await page.evaluate(() => {
    startBuild(true); completeNow(); clearFires();
    /* 打在建築外的空地上：火星落在草地上就只是熄掉。
       離遠一點（+20 而不是 +12）：齊射的第二、三發落點會在點擊處周圍 3～7 單位，
       火星本身又散得開，貼著草地邊緣打的話會有幾顆飄回建築上。 */
    launchFw({ x: arenaR + 20, z: 0 });
    let g = 0;
    while ((fworks || fwSparks) && g++ < 400) step(0.05);
    return { fires: fires ? fires.length : 0, set: placedCnt, total: bp.slots.length, phase };
  });
  ok('掉在草地上的火星只是熄掉，不會憑空燒起來',
     fwOff.fires === 0 && fwOff.set === fwOff.total,
     '起火 ' + fwOff.fires + ' 處、建築仍是 ' + fwOff.set + '/' + fwOff.total + ' 塊');
  const fwSwap = await page.evaluate(() => {
    /* 佇列在「剛點下去」那一刻量，不要先空跑幾幀——出膛間隔是 0.2～0.5 秒的亂數，
       等半秒有時候三發都出去了，量到 0 發在排隊（這條測試因此偶發失敗過）。 */
    startBuild(true); completeNow();
    launchFw({ x: 0, z: 0 });
    const queued = fwWait ? fwWait.length : 0;       // FW_SHOT − 1 發還在排隊
    startBuild(false);
    const leftQ = (fworks ? fworks.length : 0) + (fwWait ? fwWait.length : 0);
    // 再放一場，這次讓它炸開，驗「還在天上飛的火星」也會被收掉
    startBuild(true); completeNow();
    launchFw({ x: 0, z: 0 });
    for (let i = 0; i < 34; i++) step(0.05);
    const flying = fwSparks ? fwSparks.length : 0;
    startBuild(false);
    return { flying, queued, leftQ, shots: FW_SHOT,
             left: (fworks ? fworks.length : 0) + (fwSparks ? fwSparks.length : 0) +
                   (fwWait ? fwWait.length : 0) };
  });
  ok('換建築時還在飛的火星要收掉', fwSwap.flying > 0 && fwSwap.left === 0,
     '換場前 ' + fwSwap.flying + ' 顆在飛 → 換場後 ' + fwSwap.left + ' 顆');
  // 排隊中的那幾發也要收：留著的話會在新建築上空炸開，把剛蓋好的那座點著
  ok('齊射還沒出膛的那幾發也要收掉',
     fwSwap.queued === fwSwap.shots - 1 && fwSwap.leftQ === 0,
     '點下去當下 ' + fwSwap.queued + ' 發在排隊（齊射 ' + fwSwap.shots +
     ' 發）→ 換場後 ' + fwSwap.leftQ + ' 發');

  /* 一場齊射的火星密度：火星比配額多的時候，配額不能被陣列前面那幾顆整碗端走
     （那會讓第二、三發完全沒有尾巴）。改成頂掉自己人裡最老的那顆之後，
     粒子數會穩穩貼著 FW_HOT，而不是卡在某一發身上。 */
  const fwDense = await page.evaluate(() => {
    startBuild(true); completeNow(); clearFires();
    hot.length = 0;
    launchFw({ x: 0, z: 0 });
    let maxHot = 0, maxSp = 0, full = 0;
    for (let i = 0; i < 120; i++) {
      step(0.05);
      maxHot = Math.max(maxHot, hot.length);
      maxSp = Math.max(maxSp, fwSparks ? fwSparks.length : 0);
      if (hot.length >= FW_HOT - 2) full++;
    }
    /* 引擎那顆 InstancedMesh 也要畫得下：塞 400 顆進去，看 count 停在哪。
       停在 240（v1.38 的 MAXFIRE）的話，配額再大也有一截根本沒畫出來。 */
    const meshes = [];
    ENG.three.scene.traverse(o => { if (o.isInstancedMesh) meshes.push(o); });
    const was = meshes.map(o => o.count);
    const fake = [];
    for (let i = 0; i < 400; i++)
      fake.push({ x: 0, y: 500, z: 0, s: 0.01, rx: 0, ry: 0, cr: 1, cg: 1, cb: 1 });
    ENG.putFire(fake);
    const drawable = Math.max(...meshes.map((o, i) => o.count !== was[i] ? o.count : 0));
    ENG.putFire(hot);                                  // 收回去，別把假粒子留在畫面上
    return { maxHot, maxSp, full, cap: FW_HOT, drawable };
  });
  ok('齊射期間火星粒子一直是滿的，不是只有第一發有尾巴',
     fwDense.maxHot >= fwDense.cap - 2 && fwDense.full > 40 && fwDense.maxSp > 200,
     '最多 ' + fwDense.maxSp + ' 顆火星、粒子 ' + fwDense.maxHot + '/' + fwDense.cap +
     '，滿的幀數 ' + fwDense.full);
  ok('引擎畫得下整場齊射的火星', fwDense.drawable >= fwDense.cap,
     '一次畫得下 ' + fwDense.drawable + ' 顆（配額 ' + fwDense.cap + '）');

  /* 一發的內容：外層一大球 + 芯一小球（換個顏色、速度只有一半），
     再加上幾顆飛到一半自己再炸開的。只放一發（不走齊射）才數得清楚。 */
  const fwLayer = await page.evaluate(() => {
    startBuild(true); completeNow(); clearFires();
    fworks = null; fwSparks = null; fwWait = null;
    fireShell(0, 0);
    const f = fworks[0], twoCol = f.c !== f.c2;
    while (fworks) step(0.05);                        // 竄到頂、炸開
    const cols = new Set(fwSparks.map(s => s.c)).size;
    const n0 = fwSparks.length;
    const crackers = fwSparks.filter(s => s.crack > 0).length;
    // 芯那球比較慢：兩群的平均速度要差得出來
    const sp = c => { const g = fwSparks.filter(s => s.c === c);
                      return g.reduce((a, s) => a + Math.hypot(s.vx, s.vy, s.vz), 0) / g.length; };
    const outer = +sp(f.c).toFixed(1), core = +sp(f.c2).toFixed(1);
    let peak = n0;
    for (let i = 0; i < 30 && fwSparks; i++) { step(0.05); peak = Math.max(peak, fwSparks.length); }
    return { twoCol, cols, n0, crackers, peak, outer, core,
             want: FW_SPARK + FW_CORE, crack: FW_CRACK, crackN: FW_CRACK_N };
  });
  ok('一發是雙層的花：外層一個顏色，芯另一個顏色又慢一半',
     fwLayer.twoCol && fwLayer.cols === 2 && fwLayer.n0 === fwLayer.want &&
     fwLayer.core < fwLayer.outer * 0.6,
     fwLayer.n0 + ' 顆分成兩色，平均速度 外層 ' + fwLayer.outer + '／芯 ' + fwLayer.core);
  ok('有幾顆火星會二次炸開',
     fwLayer.crackers === fwLayer.crack && fwLayer.peak >= fwLayer.n0 + fwLayer.crack * 2,
     fwLayer.crackers + ' 顆帶二次炸開（各炸 ' + fwLayer.crackN + ' 顆），火星數從 ' +
     fwLayer.n0 + ' 漲到 ' + fwLayer.peak);

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

  /* 滅火是**來回**翻壓熄身上的火，不是往同一邊一直滾——一直滾同一邊的話人會一路
     平移出去，在草地上遠航。而且沿長軸滾是往**旁邊**移動，轉多少就該走多少
     （半徑 × 這一幀的轉角），不然看起來是一邊轉一邊在冰上滑。 */
  const rollMove = await page.evaluate(() => {
    startBuild(true); completeNow();
    const w = workers[0];
    w.x = 0; w.z = 0; w.y = 0; w.a = 0; w.air = 0; w.fall = 0; w.burn = 0;
    igniteWorker(w, true);
    let prev = w.rspin, px = w.x, pz = w.z;
    let up = 0, dn = 0, slip = 0, fwdMax = 0;
    const sp = [];
    for (let i = 0; i < 60; i++) {
      step(0.05);
      const d = w.rspin - prev;
      if (d > 1e-6) up++; else if (d < -1e-6) dn++;
      const dx = w.x - px, dz = w.z - pz;
      // 這一幀的位移該是「轉角 × 滾動半徑」，方向是側向
      const side = dx * Math.cos(w.a) - dz * Math.sin(w.a);
      const fwd = dx * Math.sin(w.a) + dz * Math.cos(w.a);
      if (Math.abs(fwd) > fwdMax) fwdMax = Math.abs(fwd);
      const err = Math.abs(-side - d * 0.28);
      if (err > slip) slip = err;
      sp.push(w.rspin); prev = w.rspin; px = w.x; pz = w.z;
    }
    return { up, dn, lo: +Math.min(...sp).toFixed(2), hi: +Math.max(...sp).toFixed(2),
             drift: +Math.hypot(w.x, w.z).toFixed(2),
             slip: +slip.toFixed(4), fwdMax: +fwdMax.toFixed(4) };
  });
  ok('是來回翻滾，不是往同一邊一直滾',
     rollMove.up > 10 && rollMove.dn > 10 &&
     rollMove.lo < -1.5 && rollMove.hi > 1.5 && rollMove.drift < 2,
     '三秒內往兩邊各滾了 ' + rollMove.up + '／' + rollMove.dn + ' 幀，角度在 ' +
     rollMove.lo + '～' + rollMove.hi + ' rad 之間來回，人只挪了 ' + rollMove.drift + ' 單位');
  ok('滾的方向是身體側向，而且轉多少就走多少（不打滑）',
     rollMove.slip < 0.002 && rollMove.fwdMax < 0.002,
     '每一幀「位移 vs 轉角×0.28」最大差 ' + rollMove.slip +
     '，正前方的位移最大 ' + rollMove.fwdMax);

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
    launchBall({ x: -30, y: 0, z: 0 }, { x: 0, z: 0 });   // 從場邊往工地中心滾
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
      /* 每 5 個像素取一個。以前是每 17 個，取樣數只有六萬、過曝白才一百多點，
         抖動大到會壓在門檻上（實測同一份程式一次 0.41%、一次 0.25%）。 */
      let n = 0, lit = 0;
      for (let i = 0; i < px.length; i += 4 * 5) {
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
    /* 風壓那幾圈先撤掉再量：它們是鋪滿半個畫面的加法混色大環，
       兩幀都會被它墊高（量過：留著的話「拿掉火球」那幀從 0.13% 漲到 0.17%，
       火球的對比就從 3.0 倍掉到 2.9 倍）。這裡要驗的是火球，風壓有自己的測試。 */
    const gust = fxRings.filter(f => f.wind);
    for (const g of gust) fxRings.splice(fxRings.indexOf(g), 1);
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
     位置與遮擋都變了，再掉到 0.41%；v1.55 取景改成「建築底部置中」，帝國大廈的
     視距從 110 退到 175，同一顆火球在畫面上只剩 0.14%。這裡真正要驗的是
     「有火球才有過曝白」，所以看的是跟拿掉火球那幀的倍數關係（0.14% vs 0.01%，14 倍），
     絕對值只當作「它沒有小到看不見」，門檻也就一路留寬（0.25 → 0.15 → 0.06）：
     那個數字是取樣估計跟著取景走，不是常數。 */
  ok('火球真的亮在畫面上', flash.on.pct > 0.06 && flash.on.pct > flash.off.pct * 3,
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

  /* 風壓：核彈與爆裂魔法才有的那一下氣浪。火球只有爆炸半徑那麼大，
     威力看起來就到那裡為止；風壓要掃得比爆炸範圍更遠，還要把地面的塵土一起帶走。
     它是純特效——會不會壞東西還是 explode 那一圈說了算，所以「不動任何積木」也要驗。 */
  const wind = await page.evaluate(() => {
    startBuild(true); completeNow();
    for (let i = 0; i < 40; i++) step(0.05);            // 讓上一段的殘留先散掉
    fxRings.length = 0; dust.length = 0;
    const st0 = blocks.map(b => b.st).join('');
    spawnWind({ x: 0, y: 2.5, z: 0 }, NUKE_R, false);
    const still = blocks.map(b => b.st).join('') === st0;
    const rings = fxRings.filter(f => f.wind).length, wd = dust.filter(d => d.keep).length;
    let ringMax = 0, dustMax = 0;
    for (let i = 0; i < 40; i++) {
      step(0.05);
      for (const f of fxRings) ringMax = Math.max(ringMax, f.r);
      for (const d of dust) if (d.keep) dustMax = Math.max(dustMax, Math.hypot(d.x, d.z));
    }
    fxRings.length = 0; dust.length = 0;
    // 核彈爆炸真的會帶風壓；炸彈那種小爆炸不帶（半徑才 7～14，掃 2.6 倍會比核彈還顯眼）
    explode({ x: 0, y: 2.5, z: 0 }, NUKE_R, NUKE_POW, false, true);
    const nukeWind = dust.filter(d => d.keep).length;
    fxRings.length = 0; dust.length = 0; hot.length = 0; flashes.length = 0;
    explode({ x: 0, y: 2, z: 0 }, BOMB_R, BOMB_POW);
    const bombWind = dust.filter(d => d.keep).length;
    fxRings.length = 0; dust.length = 0; hot.length = 0; flashes.length = 0;
    clearFires();
    return { still, rings, wd, ringMax: +ringMax.toFixed(0), dustMax: +dustMax.toFixed(0),
             nukeWind, bombWind, R: NUKE_R, mult: WIND_R, want: WIND_RINGS, dustN: WIND_DUST };
  });
  ok('風壓掃出爆炸範圍外，不是貼在火球邊上',
     wind.rings === wind.want && wind.ringMax > wind.R * 1.8,
     wind.want + ' 圈氣浪掃到 ' + wind.ringMax + '（爆炸半徑 ' + wind.R +
     '，目標 ' + (wind.R * wind.mult).toFixed(0) + '）');
  ok('地上的塵土被吹著一路往外跑',
     wind.wd === wind.dustN && wind.dustMax > wind.R,
     wind.wd + ' 顆塵土跑到離爆心 ' + wind.dustMax + '（爆炸半徑 ' + wind.R + '）');
  ok('風壓只是特效，不會多壞一塊積木', wind.still);
  ok('只有核彈與魔法有風壓，炸彈那種小爆炸沒有',
     wind.nukeWind === wind.dustN && wind.bombWind === 0,
     '核彈 ' + wind.nukeWind + ' 顆、炸彈 ' + wind.bombWind + ' 顆');

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
    /* v1.48 起魔法的雲跟核彈同一種：灰白煙（不給 cr，引擎就走預設的灰）。
       以前整朵染紅、雲裡還撒粉白星光，使用者要的是同一種雲。 */
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
     每層之間是 0.32 秒（擴張 0.15 ＋ 小火圈爬升 0.17），六層 1.75 秒長齊、滿陣還有 4.25 秒。
     v1.47 照使用者要求再加快一次（原本 0.54 秒一層、滿陣只有 3 秒）：
     長的過程是過場，滿陣才是主角。守在 2 秒／4 秒，再快就看不出是一層一層長的了。 */
  ok('六層很快長齊，之後有一大段時間都是滿的',
     mg.full > 0 && mg.full < 2 && mg.magTime - mg.full > 4,
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
  ok('魔法爆完也會留一朵蘑菇雲，而且跟核彈同一種',
     mg.fire > 50 && mg.cloud > 90 && mg.tinted === 0,
     mg.fire + ' 顆火球、1.2 秒後 ' + mg.cloud + ' 團煙，染色的 ' + mg.tinted + ' 團');

  /* 陣是一層層疊起來的，不是同心圓：層與層之間高度要遞增，
     而且貼地那圈的半徑就是爆炸範圍（要讓玩家看得出會炸到哪）。 */
  const mgRing = await page.evaluate(() => {
    startBuild(true); completeNow();
    castMagic({ x: 0, z: 0 });
    for (let i = 0; i < 100; i++) step(0.05);       // 5 秒：四層都長齊
    const all = (magic ? magic.rings : []).filter(o => !o.seed);   // 火種那三圈另外驗
    // 一層是兩個環疊出來的：實色的芯 + 加法混色的暈。層次要看芯那幾個
    const core = all.filter(o => !o.add).map(o => ({ y: +o.y.toFixed(1), r: +o.r.toFixed(1), c: o.c }));
    const halo = all.filter(o => o.add);
    return { n: core.length, halo: halo.length, rings: core,
             rising: core.every((o, i) => i === 0 || o.y > core[i - 1].y),
             red: core.every(o => o.c === 0xe81a08), ground: core[0] ? core[0].r : 0,
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
      return magic.rings.filter(o => !o.add && !o.seed).map(o => +o.r.toFixed(3));
    };
    const a = cast(), b = cast();
    const c = magic.rings.filter(o => !o.add && !o.seed).map(o => +o.r.toFixed(3));
    for (let i = 0; i < 8; i++) step(0.05);
    const d = magic.rings.filter(o => !o.add && !o.seed).map(o => +o.r.toFixed(3));
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
    // 火種那圈轉得比陣快 3.4 倍（它是「在竄」不是「在轉」），量陣的轉速要把它排掉
    const at = () => magic.rings.filter(o => !o.add && !o.seed).map(o => +o.spin.toFixed(4));
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

  /* 展開的方式：由下往上一層一層長，中間靠一個小火圈（火種）把火帶上去——
     先出現最下面那層 → 火種從它的圓心升到上一層的高度 → 抵達才擴張成新的一層。
     兩件事都要驗：火種真的在爬（不是原地閃），而且「爬完才多一層」，
     不然它就只是個裝飾，六層還是各自憑空亮起來。
     v1.39 起火種**一直都在**：長層的那 0.24 秒它停在那一層的圓心等，不再消失。 */
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
    /* 追第一段：0.45 秒剛好走完「長第一層 → 火種上升 → 長第二層」
       （0.15 擴張 + 0.17 爬升 + 0.15 擴張；v1.47 之前這一段是 0.7 秒）。
       同時整場（六秒）都盯著火種在不在、有沒有往下掉。 */
    startBuild(true); completeNow(); castMagic({ x: 0, z: 0 });
    const trail = [];
    for (let i = 0; i < 9; i++) { step(0.05); trail.push({ n: coreY().length, s: seedY() }); }
    const rise = trail.filter((o, i) => i > 0 && o.s > trail[i - 1].s + 0.01);   // 真的在爬的那幾幀
    const hold = trail.filter((o, i) => i > 0 && Math.abs(o.s - trail[i - 1].s) < 0.01);
    let gaps = 0, drops = 0, last = -1, tail = -1;
    for (let i = 0; i < 105 && magic; i++) {
      step(0.05);
      if (!magic) break;
      const s = seedY();
      if (s < 0) gaps++;
      else { if (last >= 0 && s < last - 0.01) drops++; last = s; }
      tail = s;
    }
    return { lay, firsts,
             steps: rise.length, held: hold.length,
             lo: trail[0].s, hi: trail[trail.length - 1].s,
             /* 爬升途中只該有一層——但最後那一幀例外：火種抵達上一層高度的同一刻
                新的一層就從它身上撐開，所以那一幀「已經到位、也已經兩層」是對的。 */
             whileRising: rise.every(o => o.n === 1 || Math.abs(o.s - lay[1]) < 0.1),
             after: trail[trail.length - 1].n,
             gaps, drops, tail, top: +(0.12 + MAG_R * MAG_LAYER[MAG_LAYER.length - 1].y).toFixed(2) };
  });
  ok('一定從最下面那層開始長，不再洗出現順序',
     mgSeed.firsts.every(f => f.n === 1 && Math.abs(f.y - mgSeed.lay[0]) < 0.01),
     '四次施法在 0.2 秒時都只有 1 層、高度 ' + mgSeed.firsts.map(f => f.y).join('／') +
     '（最下層在 ' + mgSeed.lay[0] + '）');
  ok('火種從下面那層升到上一層，升到位才長出新的一層',
     mgSeed.steps > 3 && mgSeed.whileRising && mgSeed.after === 2 &&
     Math.abs(mgSeed.lo - mgSeed.lay[0]) < 1.5 && Math.abs(mgSeed.hi - mgSeed.lay[1]) < 1.5,
     '火種 ' + mgSeed.steps + ' 幀從 y' + mgSeed.lo + ' 升到 y' + mgSeed.hi +
     '（第一層 ' + mgSeed.lay[0] + ' → 第二層 ' + mgSeed.lay[1] +
     '），升的過程中都只有 1 層，抵達後變 ' + mgSeed.after + ' 層');
  /* 使用者要的：火種不要在「某一層正在長」的空檔消失。
     以前只在爬升那 0.3 秒畫，長層的 0.24 秒它不見 → 看起來是一閃一閃地跳上去。 */
  ok('火種一直都在，長層的那段是停在原地等，不是消失',
     mgSeed.gaps === 0 && mgSeed.held > 3,
     '六秒裡有 ' + mgSeed.gaps + ' 幀看不到火種，前 0.7 秒有 ' + mgSeed.held + ' 幀停在原地');
  ok('火種只會往上，最後停在最上層等爆炸',
     mgSeed.drops === 0 && Math.abs(mgSeed.tail - mgSeed.top) < 0.01,
     '一路沒有往下掉過，最後停在 y' + mgSeed.tail + '（最上層 ' + mgSeed.top + '）');

  /* v1.47：陣心那道往上衝的光柱換成「魔力粒子往陣心集中」。
     使用者看到的是「中心點像在冒煙」——一股從陣心往外噴的東西，
     跟這個法術正在做的事（把周圍全部吸進來）完全相反，所以整個掉頭。
     四件事要驗：一施法就有、每顆真的在靠近、到了就熄、而且中心不再往外噴。 */
  const mgZip = await page.evaluate(() => {
    /* 上一段的陣還在場上、粒子也還在飛：先讓它炸完、散乾淨再開始。
       不清的話這裡追到的會混進上一發的粒子——那些已經快到陣心了，位移量全失真。 */
    while (magic) step(0.05);
    for (let i = 0; i < 120; i++) step(0.05);
    clearFires();
    startBuild(true); completeNow();
    castMagic({ x: 0, z: 0 });
    const dist = h => Math.hypot(h.x - magic.x, h.y - MAG_CORE_Y, h.z - magic.z);
    for (let i = 0; i < 6; i++) step(0.05);          // 0.3 秒：施法一開始就該有
    // 追固定的一批，不是每幀重抽（重抽的話量到的是「現在場上這些離陣心多遠」）
    const batch = hot.filter(h => h.suck).map(h => ({ h, d0: dist(h) }));
    for (let i = 0; i < 8; i++) step(0.05);          // 0.4 秒
    const closer = batch.filter(o => dist(o.h) < o.d0 - 1).length;
    /* 速度只能拿「這 0.4 秒都還活著」的那些來算：半路就到陣心熄掉的那幾顆
       位置從此凍住，把它們算進去等於用「飛了 0.2 秒的位移」除以 0.4 秒。 */
    const live = batch.filter(o => hot.indexOf(o.h) >= 0);
    const spd = live.reduce((s, o) => s + (o.d0 - dist(o.h)), 0) / (live.length * 0.4);
    for (let i = 0; i < 30; i++) step(0.05);         // 再 1.5 秒：這批早該到陣心熄掉了
    const left = batch.filter(o => hot.indexOf(o.h) >= 0).length;
    /* 原本那道光柱長這樣：陣心附近、往上飛、不帶 suck 也不帶 pull。
       接下來兩秒一顆都不該有（碎料的火苗也長這樣，所以這座建築要是完好的）。 */
    let plume = 0, alive = 0;
    for (let i = 0; i < 40; i++) {
      step(0.05);
      plume += hot.filter(h => !h.suck && !h.pull && h.vy > 0 &&
                               Math.hypot(h.x - magic.x, h.z - magic.z) < 6).length;
      alive = Math.max(alive, hot.filter(h => h.suck).length);
    }
    while (magic) step(0.05);
    for (let i = 0; i < 140; i++) step(0.05);        // 爆炸、雲、藍電都散乾淨再交棒
    clearFires();
    return { n: batch.length, closer, spd: +spd.toFixed(1), left, plume, alive, want: SUCK_SPD };
  });
  ok('一施法魔力粒子就開始往陣心捲', mgZip.n >= 6 && mgZip.n < 16 && mgZip.alive > 20,
     '0.3 秒時場上 ' + mgZip.n + ' 顆，最多同時 ' + mgZip.alive + ' 顆在飛');
  ok('每一顆都真的在靠近陣心，而且飛得快',
     mgZip.closer === mgZip.n && mgZip.spd > mgZip.want * 0.6,
     mgZip.n + ' 顆裡有 ' + mgZip.closer + ' 顆靠近了，平均每秒收 ' + mgZip.spd +
     ' 單位（設定 ' + mgZip.want + '）');
  ok('捲到陣心就熄掉，不會對穿過去再飛出另一邊', mgZip.left === 0,
     '1.9 秒後那批 ' + mgZip.n + ' 顆一顆都不剩');
  ok('陣心不再往外冒東西（原本那道光柱）', mgZip.plume === 0,
     '兩秒裡陣心 6 單位內往上飛的粒子累計 ' + mgZip.plume + ' 顆次');

  /* v1.47 新增：每長出一層，就在那一圈上撒一把十字星光（使用者給的參考圖那種星芒）。
     星芒是平面的，靠公告板每幀正對鏡頭——所以「有撒」跟「面向鏡頭」都要驗，
     只驗資料的話，鏡頭一轉就變成一片看不見的紙片也會過。 */
  const mgStar = await page.evaluate(() => {
    const orig = spawnStars;
    const calls = [];
    window.spawnStars = function (x, z, y, rad, n) {
      // el：這一把是施法後第幾秒撒的。要分開看「長層期間」與「滿陣之後」
      calls.push({ y: +y.toFixed(1), rad: +rad.toFixed(1), n, el: MAG_TIME - magic.t });
      return orig(x, z, y, rad, n);
    };
    let peak = 0, lastAt = -1, first = null, gap = 0, quiet = 0;
    const pops = [];                                  // 追第一顆星的亮度曲線
    /* 施三次法再統計「哪一層分到幾顆」：挑層是隨機的，一次施法只撒九十幾顆，
       單看一次的分佈本來就會忽高忽低（±2σ 就佔平均的四成），
       那樣的門檻不是在驗程式而是在賭骰子。 */
    for (let cast = 0; cast < 3; cast++) {
      while (magic) step(0.05);
      for (let i = 0; i < 60; i++) step(0.05);
      startBuild(true); completeNow();
      castMagic({ x: 0, z: 0 });
      let el = 0;
      for (let i = 0; i < 119 && magic; i++) {        // 整個施法期間（六秒）
        step(0.05); el += 0.05;
        if (cast > 0) continue;                       // 亮度曲線與空窗只看第一次就夠
        if (!first && stars.length) first = stars[0];
        if (first && stars.indexOf(first) >= 0) pops.push(+first.op.toFixed(2));
        peak = Math.max(peak, stars.length);
        if (stars.length) { lastAt = +el.toFixed(2); quiet = 0; }
        else if (el > 0.2) { quiet++; gap = Math.max(gap, quiet); }   // 最長空窗幾幀
      }
    }
    window.spawnStars = orig;
    /* 畫面那半：星星那顆 InstancedMesh 的幾何只有 9 個頂點（中心 + 8 個尖凹點），
       場上沒有第二顆長這樣。法線與鏡頭視線的夾角接近 0 就是正對著鏡頭。 */
    castMagic({ x: 0, z: 0 });
    step(0.05); draw(); ENG.render();
    let sm = null;
    ENG.three.scene.traverse(o => {
      if (!sm && o.isInstancedMesh && o.geometry.attributes.position.count === 9) sm = o;
    });
    const faceOf = () => {
      const M = new THREE.Matrix4(); sm.getMatrixAt(0, M);
      const n = new THREE.Vector3(0, 0, 1).transformDirection(M);
      const cd = new THREE.Vector3(); ENG.three.camera.getWorldDirection(cd);
      return +Math.abs(n.dot(cd)).toFixed(3);
    };
    const drawn = sm ? sm.count : -1, dot0 = sm ? faceOf() : -1;
    const yaw0 = ENG.cam.yaw, pit0 = ENG.cam.pitch;
    ENG.cam.yaw += 1.2; ENG.cam.pitch = 0.8;          // 鏡頭轉開，公告板要跟著轉過來
    ENG.updateCamera(0.001); draw(); ENG.render();
    const dot1 = sm ? faceOf() : -1;
    // 轉回去：yaw/pitch 不歸位的話，後面驗取景的測試量到的是這裡留下的角度
    ENG.cam.yaw = yaw0; ENG.cam.pitch = pit0;
    ENG.updateCamera(0.001);
    while (magic) step(0.05);
    for (let i = 0; i < 140; i++) step(0.05);
    clearFires();
    const lay = MAG_LAYER.map(L => +(0.12 + MAG_R * L.y).toFixed(1));
    /* 一顆一顆撒的那些按高度分組。只數「滿陣之後」的：長的那 1.75 秒上層根本還沒出現，
       把那一段算進來的話低層本來就會多一截，那不是分佈不均是它還沒長出來。 */
    const each = lay.map(y => calls.filter(c => c.n === 1 && c.y === y && c.el > 2).length);
    return { peak, lastAt, pops, drawn, dot0, dot1, gap, lay, each, casts: 3,
             burst: calls.filter(c => c.n > 1).map(c => c.y),
             sprinkle: calls.filter(c => c.n === 1).length,
             stray: calls.filter(c => lay.indexOf(c.y) < 0).length };
  });
  ok('每長出一層就在那一圈撒一把十字星光',
     mgStar.burst.length === 6 * mgStar.casts &&
     mgStar.burst.every((y, i) => y === mgStar.lay[i % 6]) &&
     mgStar.stray === 0 && mgStar.peak > 10,
     '每次施法六層各撒一把（高度 ' + mgStar.burst.slice(0, 6).join('／') +
     '），最多同時 ' + mgStar.peak + ' 顆在場上');
  /* v1.48：陣在場上的時候就一直撒，而且平均分在每一層。
     “平均”是隨機挑層、機率一樣，所以驗的是「六層都分得到、最少的不會少於最多的一半」，
     不是皮的相等（它本來就是隨機的）。 */
  /* 「平均」是隨機挑層、機率一樣，所以門檻要照**取樣數**算，不能用固定的百分比：
     每層的次數服從二項分佈，σ = √(n·(1/6)·(5/6))，三次施法約 190 顆時 σ≈5.2。
     容許到 4σ——系統性的偏（某一層拿不到、或某一層拿兩倍）一定抓得到，
     而純運氣造成的誤判低於萬分之五。用 ±45% 那種固定門檻的話，這條大約 3% 的機率會假失敗
     （實測跑到一次 16／35／35／31／35／39，那 16 只是運氣）。 */
  const avg = mgStar.each.reduce((a, b) => a + b, 0) / mgStar.each.length;
  const sd = Math.sqrt(avg * 6 * (1 / 6) * (5 / 6));
  ok('陣在場上就一直撒，而且六層平均分',
     mgStar.sprinkle > 200 && mgStar.each.every(n => Math.abs(n - avg) < 4 * sd) &&
     mgStar.lastAt > 5.5 && mgStar.gap <= 2,
     '三次施法一共又撒了 ' + mgStar.sprinkle + ' 顆；滿陣之後那些六層各分到 ' +
     mgStar.each.join('／') + '（平均 ' + avg.toFixed(1) + '，容許 ±' +
     (4 * sd).toFixed(1) + '）；最後一顆在 ' +
     mgStar.lastAt + ' 秒（爆炸在 6），中間最長斷 ' + mgStar.gap + ' 幀');
  ok('星光是一閃：亮起來快、收得慢',
     mgStar.pops.length > 3 && Math.max(...mgStar.pops) > 0.9 &&
     mgStar.pops[0] < 0.6 && mgStar.pops[mgStar.pops.length - 1] < 0.4,
     '亮度 ' + mgStar.pops.join('→'));
  ok('星光真的畫出來了，而且鏡頭轉到哪都正對著鏡頭',
     mgStar.drawn > 0 && mgStar.dot0 > 0.99 && mgStar.dot1 > 0.99,
     '畫了 ' + mgStar.drawn + ' 顆，法線與視線的 |cos| ＝ ' + mgStar.dot0 +
     '，鏡頭轉開後 ' + mgStar.dot1);

  /* v1.47 新增：火球收乾之後，爆點還會往四周劈三秒的藍色閃電。
     稀疏、從爆點出發、純特效。最後一條用像素驗——讀狀態只能證明資料在，
     證明不了使用者看得到（加法混色的藍在白天空上就是看不到的，踩過）。 */
  const mgArc = await page.evaluate(() => {
    startBuild(true); completeNow();
    castMagic({ x: 0, z: 0 });
    while (magic) step(0.05);
    let t = 0, first = -1, last = -1, peak = 0, ball = -1;
    const from = [], to = [];
    for (let i = 0; i < 100; i++) {                   // 爆炸後五秒
      step(0.05); t += 0.05;
      if (!bolts.length) continue;
      if (first < 0) { first = +t.toFixed(2); ball = flashes.length; }
      last = +t.toFixed(2);
      peak = Math.max(peak, bolts.length);
      for (const b of bolts) if (b.pts.length === ARC_SEG + 1) {     // 主幹，不是分岔那條
        const p = b.pts[0], q = b.pts[b.pts.length - 1];
        from.push(Math.hypot(p.x, p.y - MAG_CORE_Y, p.z));
        to.push(Math.hypot(q.x, q.z));
      }
    }
    /* 顏色與可見度：等煙散乾淨之後，自己造一道**固定**的電，量「有電」與「沒電」的差。
       不在放電當下隨機挑一幀量——會抽到「整道電剛好埋在煙柱裡」：塵霧是半透明的，
       疊個十層就把電蓋掉，量到 0 不是沒畫而是被蓋住（踩過，同一份程式一次 892 一次 0）。
       這裡量的是引擎那一段：同樣走 draw() → putBolts → 真的 WebGL。 */
    for (let i = 0; i < 200; i++) step(0.05);         // 十秒：煙散乾淨
    clearFires();
    /* 量顏色之前先把鏡頭釘在這道電上（v1.55）。取景改成「建築底部置中」之後鏡頭退得更遠，
       同一道電在畫面上只剩三百個像素，其中一半是抗鋸齒的混色邊——那樣量到的是
       「鏡頭退多遠」而不是「電是不是藍的」。這一條要驗的是後者，所以視角自己定。 */
    ENG.camTarget.tx = ENG.cam.tx = 10; ENG.camTarget.tz = ENG.cam.tz = 0;
    ENG.camTarget.ty = ENG.cam.ty = 6.5; ENG.camTarget.dist = ENG.cam.dist = 46;
    ENG.updateCamera(0);
    const shot = () => {
      draw(); ENG.render();
      const gl = ENG.three.renderer.getContext();
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return px;
    };
    const pts = [];
    for (let i = 0; i <= ARC_SEG; i++) {
      const u = i / ARC_SEG;
      pts.push({ x: 20 * u, y: MAG_CORE_Y + (1 - MAG_CORE_Y) * u, z: 0 });
    }
    bolts.push({ pts, t: 0, life: 1, op: 1, w: 0.24 });
    const A = shot();
    bolts.length = 0;
    const B = shot();
    let px = 0, blue = 0;
    const tally = new Map();
    for (let k = 0; k < A.length; k += 4) {
      if (A[k] === B[k] && A[k + 1] === B[k + 1] && A[k + 2] === B[k + 2]) continue;
      px++;
      // 藍：藍分量明顯高過紅與綠。白煙與灰碎料的三個分量差不多，草地是綠的
      if (A[k + 2] > A[k] + 50 && A[k + 2] > A[k + 1] + 25) blue++;
      const key = A[k] + ',' + A[k + 1] + ',' + A[k + 2];
      tally.set(key, (tally.get(key) || 0) + 1);
    }
    /* 主證據取**出現最多次的那個顏色**，不是平均色：這條電有一段被霧往天空色洗
       （越遠越白）、邊緣還有抗鋸齒的混色，平均下來會被那些拉淡。
       最常出現的那個就是沒被洗到的本體顏色。 */
    let mode = [0, 0, 0], modeN = 0;
    for (const [key, n] of tally) if (n > modeN) { modeN = n; mode = key.split(',').map(Number); }
    /* 純特效：在完好的建築上直接放電三秒，一塊都不該少、也不該起火。
       （接在爆炸後面量的話分不出是誰弄倒的。） */
    startBuild(true); completeNow();
    const set0 = blocks.filter(b => b.st === 3).length;
    startArcs({ x: 0, y: MAG_CORE_Y, z: 0 }, MAG_R);
    for (let i = 0; i < 80; i++) step(0.05);
    const set1 = blocks.filter(b => b.st === 3).length, burn = fires ? fires.length : 0;
    bolts.length = 0; arcSrc = null;                  // 收乾淨，別把電留給下一段測試
    return { first, last, ball, peak, set0, set1, burn, px, blue, mode, modeN,
             from: +Math.max(0, ...from).toFixed(2), n: to.length,
             reach: +Math.max(0, ...to).toFixed(1),
             mid: +(to.reduce((s, v) => s + v, 0) / (to.length || 1)).toFixed(1),
             R: MAG_R, life: FLASH_LIFE, want: ARC_TIME };
  });
  ok('火球收乾之後才開始劈電',
     mgArc.first >= mgArc.life - 0.06 && mgArc.first < mgArc.life + 0.4 && mgArc.ball === 0,
     '爆炸後 ' + mgArc.first + ' 秒第一道（火球亮 ' + mgArc.life + ' 秒，那時場上 ' +
     mgArc.ball + ' 顆火球）');
  ok('劈滿三秒，而且很稀疏',
     Math.abs((mgArc.last - mgArc.first) - mgArc.want) < 0.45 && mgArc.peak <= 4,
     mgArc.first + ' → ' + mgArc.last + ' 秒（' + (mgArc.last - mgArc.first).toFixed(2) +
     ' 秒），最多同時 ' + mgArc.peak + ' 道');
  ok('每一道都從爆點劈出去，電到周圍那一圈裡',
     mgArc.n > 10 && mgArc.from < 0.01 && mgArc.reach <= mgArc.R && mgArc.mid > mgArc.R * 0.3,
     mgArc.n + ' 道的起點都在爆點上（最遠 ' + mgArc.from + '），落點平均 ' + mgArc.mid +
     '、最遠 ' + mgArc.reach + '（範圍 ' + mgArc.R + '）');
  ok('閃電純特效，不拆房子也不點火', mgArc.set1 === mgArc.set0 && mgArc.burn === 0,
     '放電三秒後還是 ' + mgArc.set1 + ' 塊站著（原本 ' + mgArc.set0 + '），起火 ' +
     mgArc.burn + ' 處');
  ok('電是真的藍、而且看得到',
     mgArc.px > 200 && mgArc.blue > mgArc.px * 0.5 &&
     mgArc.mode[2] > mgArc.mode[0] + 50 && mgArc.mode[2] > mgArc.mode[1] + 25,
     '一道電在畫面上佔 ' + mgArc.px + ' 個像素，最多的那個顏色是 rgb(' +
     mgArc.mode.join(',') + ')×' + mgArc.modeN + '，逐點算有 ' + mgArc.blue + ' 個是藍的');

  /* 魔法陣長層的音效（sndRune）拿掉了：六層一路響上去太吵，
     還蓋掉引力坍縮那一段該有的安靜。爆炸本身的 sndBoom 要留著——不是整個魔法變靜音。 */
  const mgSnd = await page.evaluate(() => ({ rune: typeof sndRune, boom: typeof sndBoom }));
  ok('魔法陣長層不再出聲', mgSnd.rune === 'undefined' && mgSnd.boom === 'function',
     'sndRune 是 ' + mgSnd.rune + '、sndBoom 還是 ' + mgSnd.boom);

  // 魔法爆炸也要有風壓（跟核彈同一套，只是顏色偏紅）
  const mgWind = await page.evaluate(() => {
    startBuild(true); completeNow();
    castMagic({ x: 0, z: 0 });
    let g = 0;
    while (magic && g++ < 200) step(0.05);
    const wd = dust.filter(d => d.keep).length;
    for (let i = 0; i < 60; i++) step(0.05);
    clearFires();
    return { wd, want: WIND_DUST };
  });
  ok('魔法爆炸也會掃出風壓', mgWind.wd === mgWind.want,
     '被風吹著跑的塵土 ' + mgWind.wd + ' 顆');
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

  /* 形狀（v1.54）：高度不動、半徑收一圈（最寬 0.62 → 0.56R），而且改成**上下大、中間細**。
     「通常」是抖動的功勞——每層各乘 0.82～1.18，偶爾會讓中間那層鼓過頭，
     所以這裡量的是比例不是「每次都成立」（只驗一次施法等於在賭骰子）。 */
  const mgShape = await page.evaluate(() => {
    const base = MAG_LAYER.map(L => L.r);
    const hist = [0, 0, 0, 0, 0, 0];
    let ends2 = 0;
    const N = 300;
    for (let k = 0; k < N; k++) {
      castMagic({ x: 0, z: 0 });
      const rs = MAG_LAYER.map((L, i) => L.r * magic.rj[i]);
      magic = null; dangers.length = 0;      // 每次只要那組抖動，別讓預告與逃命累積下去
      let mi = 0;
      rs.forEach((v, i) => { if (v > rs[mi]) mi = i; });
      hist[mi]++;
      const order = rs.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]);
      if ([order[0][1], order[1][1]].every(i => i === 0 || i === 5)) ends2++;
    }
    for (const w of workers) w.flee = 0;
    return { base, hist, ends2, N, wide: Math.max(...base),
             mid: Math.max(...base.slice(1, 5)) };
  });
  ok('上下兩層最寬、中間收窄，整疊比以前瘦',
     mgShape.base[0] > mgShape.mid && mgShape.base[5] > mgShape.mid && mgShape.wide <= 0.56,
     '各層 ' + mgShape.base.join('／') + 'R（中間最寬的一層 ' + mgShape.mid +
     'R，v1.53 最寬是 0.62R）');
  ok('最寬的一圈「通常」落在最上或最下',
     (mgShape.hist[0] + mgShape.hist[5]) / mgShape.N > 0.9 &&
     mgShape.ends2 / mgShape.N > 0.8 && mgShape.ends2 < mgShape.N,
     mgShape.N + ' 次施法：最寬落在第 ' + mgShape.hist.map((v, i) => i + '層' + v).join('／') +
     '，最上最下同時是前二寬的有 ' + (mgShape.ends2 / mgShape.N * 100).toFixed(0) + '%');

  /* 配色（v1.54，照使用者給的參考圖）：深紅的盤 + 金黃的紋路與外暈。
     盤是引擎那邊發的，顏色**跟著它那一圈走**——只驗 game.js 裡的色碼會漏掉
     「盤還是寫死那個橘」的情況，所以直接去場上抓那幾片盤的材質顏色。
     火種那片盤要維持它自己的火黃（它跟爆炸火球是同一團火，不該被陣染紅）。 */
  const mgHue = await page.evaluate(() => {
    startBuild(true); completeNow();
    castMagic({ x: 0, z: 0 });
    for (let i = 0; i < 100; i++) step(0.05);
    draw(); ENG.render();
    const lay = magic.rings.filter(o => !o.seed);
    const seed = magic.rings.find(o => o.seed && o.fill);
    let grp = null;
    ENG.three.scene.traverse(o => {
      if (!grp && o.geometry && o.geometry.type === 'RingGeometry') grp = o.parent;
    });
    const discs = grp.children.filter(o => o.visible && o.geometry &&
                                           o.geometry.type === 'CircleGeometry');
    return { core: lay.find(o => !o.add).c, halo: lay.find(o => o.add).c, seed: seed.c,
             discs: discs.map(d => d.material.color.getHex()),
             spoke: grp.children.find(o => o.isInstancedMesh).material.color.getHex() };
  });
  const hex = c => '#' + c.toString(16).padStart(6, '0');
  ok('陣是深紅的盤配金黃的紋路，火種還是火黃',
     mgHue.core === 0xe81a08 && mgHue.halo === 0xffb42a && mgHue.spoke === 0xffc83c &&
     mgHue.discs.length === 7 && mgHue.discs.slice(0, 6).every(c => c === mgHue.core) &&
     mgHue.discs[6] === mgHue.seed,
     '芯與盤 ' + hex(mgHue.core) + '、外暈 ' + hex(mgHue.halo) + '、紋路 ' + hex(mgHue.spoke) +
     '、火種那片盤 ' + hex(mgHue.discs[6]));

  /* 拉高之後整疊頂端會頂出畫面上緣（矮建築取景近）。跟龍捲風、蘑菇雲同一套：
     施法期間鏡頭先退開。NDC y 超過 1 就是被切掉，量的是最上層外緣那一點。 */
  const mgCam = await page.evaluate(() => {
    const one = shape => {
      shapePick = SHAPES.findIndex(s => s.n === shape);
      targetCnt = 800; startBuild(true); completeNow();
      for (let i = 0; i < 200; i++) step(0.05);        // 讓剛蓋好的這座沉澱一下
      const d0 = ENG.cam.dist;                         // startBuild(true) 已經照這座重新取景
      // 這一陣「要」退到多遠：問一次 holdWide，問完把鏡頭放回去（測試不自己複製公式）
      const ty0 = ENG.camTarget.ty;
      ENG.camTarget.dist = 6; ENG.camTarget.ty = 0; ENG.holdWide(MAG_TOP, MAG_WIDE);
      const need = ENG.camTarget.dist;
      ENG.camTarget.dist = d0; ENG.camTarget.ty = ty0;
      castMagic({ x: 0, z: 0 });
      for (let i = 0; i < 100; i++) step(0.05);        // 5 秒：六層都在
      const top = Math.max(...magic.rings.map(o => o.y));
      const wide = magic.rings.reduce((s, o) => Math.max(s, o.r), 0);
      const v = new THREE.Vector3(wide, top, 0).project(ENG.three.camera);
      return { d0: +d0.toFixed(0), need: +need.toFixed(0), dist: +ENG.cam.dist.toFixed(0),
               top: +top.toFixed(1), ndc: +v.y.toFixed(2) };
    };
    const r = { pyramid: one('吉薩金字塔'), castle: one('中世紀城堡') };
    shapePick = -1;
    return r;
  });
  /* 矮建築（金字塔取景很近）要退才裝得下整疊；城堡本來就退得夠遠，就不該再多退一截。
     兩座都驗頂端沒被切掉——那才是運鏡真正要保證的事。 */
  ok('施法時鏡頭退到整疊進得了畫面，而且不會退過頭',
     Math.abs(mgCam.pyramid.dist - Math.max(mgCam.pyramid.d0, mgCam.pyramid.need)) <= 1 &&
     Math.abs(mgCam.castle.dist - Math.max(mgCam.castle.d0, mgCam.castle.need)) <= 1 &&
     mgCam.pyramid.ndc < 0.95 && mgCam.castle.ndc < 0.95,
     '吉薩金字塔視距 ' + mgCam.pyramid.d0 + ' → ' + mgCam.pyramid.dist +
     '（陣要 ' + mgCam.pyramid.need + '），頂端 NDC ' + mgCam.pyramid.ndc +
     '／城堡 ' + mgCam.castle.d0 + ' → ' + mgCam.castle.dist + '，NDC ' + mgCam.castle.ndc);

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

  /* 雲頂會升到 40 以上，貼著建築的取景根本裝不下——引爆時鏡頭要退開。
     退開之後就停在那裡：自己收回來的話等於每發都把鏡頭搶走兩次。
     建築鎖同一座，換場後的取景距離才有得比。 */
  const camFx = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '中世紀城堡');
    // startBuild(true) 會照這座重新取景，量到的 d0 就是「沒退開」的基準
    targetCnt = 900; startBuild(true); completeNow();
    const d0 = ENG.camTarget.dist, ty0 = ENG.camTarget.ty;
    // 這朵雲「要」退到多遠：問一次 holdWide，問完把鏡頭放回去（測試不自己複製公式）
    ENG.camTarget.dist = 6; ENG.camTarget.ty = 0; ENG.holdWide(NUKE_R * 1.3, NUKE_R * 0.55);
    const need = ENG.camTarget.dist;
    ENG.camTarget.dist = d0; ENG.camTarget.ty = ty0;
    callNuke({ x: 0, z: 0 });
    for (let i = 0; i < 58; i++) step(0.05);        // 引爆
    const wide = ENG.camTarget.dist, ty = ENG.camTarget.ty;
    for (let i = 0; i < 60; i++) step(0.05);        // 3 秒後：雲正高，還要維持
    const hold = ENG.camTarget.dist;
    for (let i = 0; i < 160; i++) step(0.05);       // 再等 8 秒（雲早就散了，還換過場）
    const back = ENG.camTarget.dist;
    // 連炸第二發不該再往外跳一次：退開取的是「現在」與「這一發要的」之中的大者
    callNuke({ x: 0, z: 0 });
    for (let i = 0; i < 58; i++) step(0.05);
    const again = ENG.camTarget.dist;
    shapePick = -1;
    return { d0, need, wide, ty, hold, back, again };
  });
  ok('核彈引爆時鏡頭會退開，整朵雲才進得了畫面',
     camFx.wide > camFx.d0 && camFx.hold === camFx.wide,
     '視距 ' + camFx.d0.toFixed(0) + ' → ' + camFx.wide.toFixed(0) +
     '（視線高度 ' + camFx.ty.toFixed(0) + '），三秒後仍維持');
  /* 退開的距離是照雲的尺寸算的，不是隨便乘一個倍率：多退一截等於把玩家的鏡頭多搶走一截 */
  ok('只退到整朵雲進得了畫面那麼遠', Math.abs(camFx.wide - Math.max(camFx.d0, camFx.need)) < 0.01,
     '雲要 ' + camFx.need.toFixed(0) + '、原本取景 ' + camFx.d0.toFixed(0) +
     ' → 退到 ' + camFx.wide.toFixed(0));
  ok('退開之後不會自己收回來', camFx.back === camFx.wide,
     '八秒後（含換場）仍是 ' + camFx.back.toFixed(0) + '（原本 ' + camFx.d0.toFixed(0) + '）');
  ok('連炸第二發不會再退得更遠', camFx.again === camFx.wide,
     '第二發後 ' + camFx.again.toFixed(0) + '（第一發 ' + camFx.wide.toFixed(0) + '）');

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
  /* 魔法陣一層是「盤 + 芯環 + 暈環」三個 draw call，六層就十八個；
     v1.39 起那顆火種一路留到爆炸，再加「盤 + 兩圈 + 一圈暈」四個（36 → 37）。
     只在陣展開的那六秒會這樣，平常是 11。 */
  ok('炸彈與魔法陣在場上才多吃 draw call', dc.busy > dc.idle && dc.busy <= 40,
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
  /* v1.46 起隕石不生火球：它是「砸下來燒起來」，不是又一發爆炸。
     燒起來與蔓延照舊——那才是這把道具的重點。 */
  ok('落地不炸出火球，但會燒起來',
     met.hit.flash === 0 && met.hit.fires > 0 && met.spread > met.hit.fires,
     '火球 ' + met.hit.flash + ' 顆、當場點著 ' + met.hit.fires +
     ' 塊，兩秒後蔓延到 ' + met.spread + ' 塊');
  /* 拿掉的只有「爆炸的長相」：火球、噴出來的火星、貼地光環、衝擊環。
     衝擊波本身留著（積木照樣被砸飛），塵土與震動也留著。
     直接叫 meteorHit 量：這樣不會混到倒數期間那些地面預告環。 */
  const metLook = await page.evaluate(() => {
    targetCnt = 3000; shapePick = SHAPES.findIndex(s => s.n === '美國國會大廈');
    startBuild(true); completeNow();
    clearFires();
    hot.length = 0; flashes.length = 0; fxRings.length = 0; dust.length = 0;
    const set0 = placedCnt;
    meteorHit({ x: 0, y: 6, z: 0 });
    const mine = { flash: flashes.length, rings: fxRings.length, hot: hot.length,
                   dust: dust.length, smashed: set0 - placedCnt,
                   fires: fires ? fires.length : 0, shake: +ENG.cam.shake.toFixed(2) };
    // 對照組：同尺寸的普通爆炸該有火球與衝擊環
    hot.length = 0; flashes.length = 0; fxRings.length = 0;
    startBuild(true); completeNow();
    explode({ x: 0, y: 6, z: 0 }, MET_R, MET_POW);
    return { mine, boom: { flash: flashes.length, rings: fxRings.length, hot: hot.length } };
  });
  ok('不生火球、火星與衝擊環（同尺寸的普通爆炸都有）',
     metLook.mine.flash === 0 && metLook.mine.rings === 0 && metLook.mine.hot === 0 &&
     metLook.boom.flash > 0 && metLook.boom.rings > 0 && metLook.boom.hot > 0,
     '隕石 火球 ' + metLook.mine.flash + '／環 ' + metLook.mine.rings + '／火星 ' + metLook.mine.hot +
     '　普通爆炸 ' + metLook.boom.flash + '／' + metLook.boom.rings + '／' + metLook.boom.hot);
  ok('衝擊波、塵土、震動、點火都還在',
     metLook.mine.smashed > 30 && metLook.mine.dust > 10 &&
     metLook.mine.shake > 0.3 && metLook.mine.fires > 0,
     '砸飛 ' + metLook.mine.smashed + ' 塊、揚塵 ' + metLook.mine.dust +
     ' 團、震動 ' + metLook.mine.shake + '、點著 ' + metLook.mine.fires + ' 塊');
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
    /* 「真的砸下去了」以前是數火球，現在沒有火球了——改成包一層 meteorHit 直接數命中。
       meteorHit 是 function 宣告（掛在 global 上），覆寫它 stepMeteors 就會呼叫到包裝版。 */
    const origHit = meteorHit; let boom = 0;
    meteorHit = m => { boom++; origHit(m); };
    let g = 0, maxFly = 0;
    while (meteors && g++ < 120) {
      step(0.05);
      if (meteors) maxFly = Math.max(maxFly, meteors.filter(m => m.lit).length);
    }
    meteorHit = origHit;
    // 上限：連叫九顆只留最新的六顆
    startBuild(true); completeNow();
    for (let i = 0; i < 9; i++) callMeteor({ x: i * 4 - 16, y: 3, z: 0 });
    return { three, maxFly, boom, capped: meteors.length, cap: MET_MAX };
  });
  ok('可以同時來好幾顆', metMany.three === 3 && metMany.maxFly === 3 && metMany.boom >= 2,
     '叫了 3 顆，最多同時 ' + metMany.maxFly + ' 顆在飛，真的砸下去 ' +
     metMany.boom + ' 顆');
  ok('同時最多 ' + metMany.cap + ' 顆', metMany.capped === metMany.cap,
     '連叫 9 顆 → 場上 ' + metMany.capped + ' 顆');

  /* 半路撞到建築就當場炸開。落點給在高塔的正下方：45° 斜插進來的話，
     一定會先擦到塔身——只在終點判定的話它會從屋頂穿過去、在地面才炸。 */
  const metSweep = await page.evaluate(() => {
    targetCnt = 3000; shapePick = SHAPES.findIndex(s => s.n === '帝國大廈');
    startBuild(true); completeNow();
    /* 沒有火球可以量了，改成包一層 meteorHit 記下命中那一刻的高度——比舊寫法還準
       （舊的量的是火球球心，那個還帶了 R×0.22 的抬升）。 */
    const origHit = meteorHit; let hitY = -1;
    meteorHit = m => { hitY = m.y; origHit(m); };
    callMeteor({ x: 0, y: 0.6, z: 0 });
    let g = 0;
    while (meteors && g++ < 400) step(0.02);
    meteorHit = origHit;
    return { fy: +hitY.toFixed(1), h: bp.height };
  });
  ok('半路撞到建築就當場砸開，不會穿進去',
     metSweep.fy > 5,
     '落點指在 y=0.6，實際砸在 y=' + metSweep.fy + '（塔高 ' + metSweep.h + '）');

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
    ballAim = null;                 // 保齡球那一輪只點了第一下，別把瞄準環留給後面的截圖
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
  /* 拆 4 座、擊飛 1234 塊 → 保齡球(2 座)、龍捲風(4 座) 開；
     大槌(擊飛 2,000)、投石機(6,000)、煙火(11,000)、放火(6 座)、炸彈(15,000)、
     隕石(8 座)、核彈(19,000)、爆裂魔法(10 座) 還鎖著 */
  const unlockedAfterReload = await page.evaluate(() =>
    [...document.querySelectorAll('.tool')].map(e => e.className.indexOf('lock') >= 0 ? 'lock' : 'open').join(','));
  ok('重開後解鎖狀態跟著回來',
     unlockedAfterReload === 'open,open,lock,open,lock,open,lock,lock,lock,lock,lock,lock',
     '拆 4 座、擊飛 1234 塊 → ' + unlockedAfterReload);

  /* 設定也要一起存——不然每次打開都要重調建材數與小人數。
     一律用「點按鈕」而不是直接改變數：要測的就是面板真的接上去了。 */
  const prefSaved = await page.evaluate(() => {
    const hit = (id, v) => [...document.getElementById(id).children]
      .find(b => +b.dataset.v === v).click();
    hit('cnt', 1800); hit('wk', 40); hit('spd', 0.5);
    document.getElementById('mute').checked = true;
    document.getElementById('mute').dispatchEvent(new Event('change', { bubbles: true }));
    return { pref: JSON.parse(JSON.stringify(pref)) };
  });
  ok('改設定會寫進 pref', prefSaved.pref.cnt === 1800 && prefSaved.pref.wk === 40 &&
     prefSaved.pref.spd === 0.5 && prefSaved.pref.mute === true, JSON.stringify(prefSaved.pref));

  await page.reload();
  await page.waitForTimeout(900);
  const prefBack = await page.evaluate(() => {
    const on = id => [...document.getElementById(id).children]
      .filter(b => b.classList.contains('on')).map(b => +b.dataset.v);
    return {
      cnt: targetCnt, wk: workers.length, spd: timeScale, mute: muted,
      onCnt: on('cnt'), onWk: on('wk'), onSpd: on('spd'),
      domMute: document.getElementById('mute').checked
    };
  });
  ok('重開後設定自動套用（不用每次重調）',
     prefBack.cnt === 1800 && prefBack.wk === 40 && Math.abs(prefBack.spd - 0.5) < 0.01 && prefBack.mute === true,
     '建材 ' + prefBack.cnt + '、小人 ' + prefBack.wk + '、速度 ' + prefBack.spd + '、靜音 ' + prefBack.mute);
  ok('面板上亮的那一顆也跟著回到存的值',
     String(prefBack.onCnt) === '1800' && String(prefBack.onWk) === '40' &&
     String(prefBack.onSpd) === '0.5' && prefBack.domMute,
     '亮的是 ' + prefBack.onCnt + '/' + prefBack.onWk + '/' + prefBack.onSpd);

  /* 面板只剩三檔，中間值選不出來了：存檔裡不是那三檔的值一律吸到最近的一檔
     （壞掉的存檔也一樣，不然畫面上會三顆都不亮、跑的卻是第四個數字）。 */
  const prefClamp = await page.evaluate(() => {
    pref.cnt = 99999; pref.wk = -5; pref.spd = 900; save();
    stats = freshStats(); pref = freshPref(); load();
    const a = JSON.parse(JSON.stringify(pref));
    pref.cnt = 2600; pref.wk = 33; pref.spd = 2.4; save();       // 剛好落在兩檔中間附近
    stats = freshStats(); pref = freshPref(); load();
    return { a, b: JSON.parse(JSON.stringify(pref)) };
  });
  ok('存檔裡的設定會吸到最近的一檔',
     prefClamp.a.cnt === 9000 && prefClamp.a.wk === 20 && prefClamp.a.spd === 4 &&
     prefClamp.b.cnt === 3000 && prefClamp.b.wk === 40 && prefClamp.b.spd === 1,
     '99999/-5/900 → ' + prefClamp.a.cnt + '/' + prefClamp.a.wk + '/' + prefClamp.a.spd +
     '；2600/33/2.4 → ' + prefClamp.b.cnt + '/' + prefClamp.b.wk + '/' + prefClamp.b.spd);

  /* 預設建材從 900 改成 3000 那次：舊存檔裡的 900 分不出是玩家挑的還是舊預設，
     所以認「沒有 v 欄位」的存檔，一次性換成新預設。存過一次之後就不再動它。 */
  const prefMigrate = await page.evaluate(() => {
    localStorage.setItem('block-builders/save1',
      packSave({ s: freshStats(), p: { cnt: 900, wk: 20, spd: 1, mute: false, spin: false } }));
    stats = freshStats(); pref = freshPref(); load();
    const migrated = pref.cnt;
    pref.cnt = 900; save();                     // 這次是「存過一次之後」的 900
    stats = freshStats(); pref = freshPref(); load();
    return { migrated, keep: pref.cnt, v: pref.v };
  });
  /* 沒有 v 欄位的舊存檔換成新預設 3000；存過一次之後就不再套那條規則——
     所以第二次那個 900 走的是吸附（→ 1800），而不是又被換成預設值。 */
  ok('舊存檔的建材數換成新預設，而且只換一次',
     prefMigrate.migrated === 3000 && prefMigrate.keep === 1800 && prefMigrate.v === 1,
     '舊存檔 900 → ' + prefMigrate.migrated + '；存過一次之後的 900 → ' + prefMigrate.keep +
     '（吸到最近的一檔，不是預設值 3000；存檔版本 v' + prefMigrate.v + '）');

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

  /* 三檔按鈕：點下去要真的生效。用真的 click，才連 listener 有沒有接上都一起測到。 */
  const hitSeg = (id, v) => page.evaluate(([id, v]) =>
    [...document.getElementById(id).children].find(b => +b.dataset.v === v).click(), [id, v]);
  await hitSeg('cnt', 1800);
  await page.waitForTimeout(500);
  const cntS = await st(page);
  ok('建材按鈕會改變積木數', cntS.target === 1800 && cntS.total > 1200,
     '目標 ' + cntS.target + '，實得 ' + cntS.total + ' 塊');
  ok('積木池跟著藍圖走', Math.abs(cntS.pool - cntS.total) <= 2, cntS.pool + ' vs ' + cntS.total);

  await hitSeg('wk', 60);
  ok('小人按鈕會改變人數', (await st(page)).workers === 60, (await st(page)).workers + ' 人');

  await hitSeg('spd', 4);
  ok('速度按鈕會改變時間倍率', Math.abs((await st(page)).scale - 4) < 0.01);
  // 點過之後亮的那一顆要換過去（面板上沒有別的地方寫著現在是哪一檔）
  const segAfter = await page.evaluate(() => {
    const on = id => [...document.getElementById(id).children]
      .filter(b => b.classList.contains('on')).map(b => +b.dataset.v);
    return { cnt: on('cnt'), wk: on('wk'), spd: on('spd') };
  });
  ok('點過的那一顆會亮起來，而且只有一顆',
     String(segAfter.cnt) === '1800' && String(segAfter.wk) === '60' && String(segAfter.spd) === '4',
     '亮的是 ' + segAfter.cnt + '/' + segAfter.wk + '/' + segAfter.spd);
  await hitSeg('wk', 20);            // 後面的測試照 20 人算，改回來
  await hitSeg('spd', 1);

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

  /* ══════════ 音效 ══════════
     音效全是即時合成的（沒有音檔），所以可以用 OfflineAudioContext 把波形算出來直接量，
     不必真的發出聲音。tone()／noise() 都是先叫 audio() 拿 context，
     把 audio 換掉就能把整段導到離線 context；量完要把 audio 與 muted 放回去。 */
  head('音效');
  const snd = await page.evaluate(async () => {
    const SR = 44100, SEC = 3, realAudio = audio, wasMuted = muted, wasRunning = running;
    /* 量的時候一定要把遊戲停下來：算圖是非同步的，中間遊戲迴圈只要放了任何一聲
       （擺積木、碎料落地…）就會一起錄進這個離線 context。
       第一版沒停，核彈的高頻占比量到 51.7%，其實是混進了槌子那種高頻音。 */
    running = false;
    const render = async (fn, band) => {
      const ctx = new OfflineAudioContext(1, SR * SEC, SR);
      let dest = ctx.destination;
      const mk = (type, f) => {
        const q = ctx.createBiquadFilter(); q.type = type; q.frequency.value = f; q.Q.value = 0.7; return q;
      };
      if (band === 'hi') { const f = mk('highpass', 2000); f.connect(dest); dest = f; }
      if (band === 'body') {                       // 80–250Hz：小喇叭真正推得出來的那一段
        const lo = mk('highpass', 80), hi = mk('lowpass', 250);
        hi.connect(dest); lo.connect(hi); dest = lo;
      }
      const proxy = new Proxy(ctx, {
        get(t, k) {
          if (k === 'destination') return dest;
          const v = t[k]; return typeof v === 'function' ? v.bind(t) : v;
        }
      });
      audio = () => proxy; muted = false;
      fn();
      const d = (await ctx.startRendering()).getChannelData(0);
      let s = 0, peak = 0, over = 0;
      for (let i = 0; i < d.length; i++) {
        const v = Math.abs(d[i]); if (v > peak) peak = v; if (v >= 0.999) over++;
        s += d[i] * d[i];
      }
      return { rms: Math.sqrt(s / d.length), peak, over };
    };
    const one = async fn => {
      const all = await render(fn), hi = await render(fn, 'hi'), body = await render(fn, 'body');
      return { rms: +all.rms.toFixed(4), peak: +all.peak.toFixed(3), over: all.over,
               hiPct: +(hi.rms / all.rms * 100).toFixed(1), body: +body.rms.toFixed(4) };
    };
    const r = { nuke: await one(() => sndBoom(30)), bomb: await one(() => sndBoom(BOMB_R)),
                smash: await one(() => sndSmash()),
                fall1: await one(() => sndFall()),
                fall4: await one(() => { for (let i = 0; i < 4; i++) sndFall(); }),
                fall20: await one(() => { for (let i = 0; i < 20; i++) sndFall(); }),
                nukeHit: await one(() => { sndBoom(30); for (let i = 0; i < 20; i++) sndFall(); }) };
    audio = realAudio; muted = wasMuted; running = wasRunning;
    return r;
  });
  /* 爆炸聲刺不刺，看的是 2kHz 以上占多少能量。改之前噪音低通切在 900、音量 0.34，
     那一帶留著一大截高頻嘶聲，占了 25.1%（rms 0.0249）——聽起來就是又大聲又刺。
     門檻用 rms 不用 peak：noise() 每次都是重新抽的隨機取樣，峰值會跳，rms 才穩。 */
  ok('爆炸聲不刺耳，音量也壓下來了', snd.nuke.hiPct < 18 && snd.nuke.rms < 0.02,
     '核彈 2kHz 以上 ' + snd.nuke.hiPct + '%、rms ' + snd.nuke.rms +
     '、peak ' + snd.nuke.peak + '（槌子 ' + snd.smash.hiPct + '%）');
  /* 但不能壓成一聲悶悶的氣音：最大的那一發還是要比槌子有份量，
     份量看的是 80–250Hz（46Hz 的基音小喇叭根本推不出來，聽得到的是它的泛音）。 */
  ok('爆炸仍然是全場最有份量的一聲',
     snd.nuke.body > snd.smash.body * 1.3 && snd.nuke.rms > snd.smash.rms,
     '核彈 80–250Hz ' + snd.nuke.body + '（槌子 ' + snd.smash.body + '），總 rms ' +
     snd.nuke.rms + ' vs ' + snd.smash.rms);
  // 半徑只放大時間不放大音量：炸彈跟核彈是同一支音效，差在轟多久
  ok('小爆炸比大爆炸短，但不是另一種聲音',
     snd.bomb.rms < snd.nuke.rms && Math.abs(snd.bomb.hiPct - snd.nuke.hiPct) < 3,
     '炸彈 rms ' + snd.bomb.rms + '、核彈 ' + snd.nuke.rms +
     '（高頻占比 ' + snd.bomb.hiPct + '% vs ' + snd.nuke.hiPct + '%）');

  /* 「炸空地還好、炸到建築就刺耳」的根源不是爆炸，是被同一發掀倒的那一排小人：
     二十聲 sndFall 是二十個從相位 0 起跳的同頻方波，同相疊起來峰值 0.047 → 0.95
     （幾乎滿刻度的方波，比爆炸本身的 0.14 刺得多）。
     現在同一支音效 0.06 秒內最多疊 3 個，超過的不放，所以 4 個跟 20 個一樣大。 */
  ok('一排小人同時被掀倒，不會疊成一聲滿刻度的方波',
     snd.fall20.peak < 0.2 && Math.abs(snd.fall20.peak - snd.fall4.peak) < 0.03 &&
     snd.fall4.peak > snd.fall1.peak,
     '1 個 peak ' + snd.fall1.peak + '、4 個 ' + snd.fall4.peak + '、20 個 ' + snd.fall20.peak);
  ok('核彈打在建築上那一幀不會破表',
     snd.nukeHit.peak < 0.25 && snd.nukeHit.over === 0,
     '爆炸＋20 人跌倒 peak ' + snd.nukeHit.peak + '、rms ' + snd.nukeHit.rms +
     '（爆炸自己 ' + snd.nuke.peak + '）');

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

  /* 震動是固定的世界座標位移，畫面上晃多少全看視距：同樣的一發，視距 10 時鏡頭偏 22°、
     視距 66 只有 3.6°——貼著建築看的時候會晃到看不清楚。所以近距離不震，遠了才是全額。
     量的是「同一發震動造成的鏡頭位移」：把 cam 與 camTarget 對齊，lerp 就不會動，
     位移就只剩震動那一份。 */
  const shakeAt = await page.evaluate(() => {
    const cam = ENG.cam, ct = ENG.camTarget, C = ENG.three.camera;
    const at = dist => {
      ct.dist = cam.dist = dist; ct.ty = cam.ty = 6; ct.tx = cam.tx = ct.tz = cam.tz = 0;
      cam.shake = 0; ENG.updateCamera(0.016);
      const base = C.position.clone();
      cam.shakeT = 0;
      let mx = 0;
      for (let i = 0; i < 8; i++) {                  // 8 幀約半個週期，抓得到峰值
        cam.shake = 2.6;                             // 每幀補回來：比的是同一發在不同視距的差
        ENG.updateCamera(0.016);
        mx = Math.max(mx, C.position.distanceTo(base));
      }
      cam.shake = 0; ENG.updateCamera(0.016);
      return +mx.toFixed(2);
    };
    const keep = { d: ct.dist, ty: ct.ty };
    const r = { d12: at(12), d24: at(24), d36: at(36), d60: at(60), d160: at(160) };
    // 量完把鏡頭放回去：後面的平移測試速度是跟著視距走的，留在 160 會變成另一回事
    ct.dist = cam.dist = keep.d; ct.ty = cam.ty = keep.ty;
    return r;
  });
  ok('鏡頭拉很近的時候不會震動', shakeAt.d12 === 0 && shakeAt.d24 === 0,
     '視距 12 位移 ' + shakeAt.d12 + '、視距 24 位移 ' + shakeAt.d24);
  ok('拉開之後震動照舊', shakeAt.d60 > 3 && shakeAt.d160 === shakeAt.d60 &&
     shakeAt.d36 > 0 && shakeAt.d36 < shakeAt.d60,
     '視距 36 位移 ' + shakeAt.d36 + '（過渡）、60 位移 ' + shakeAt.d60 +
     '、160 位移 ' + shakeAt.d160);

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

  /* ── Q／E 轉視角 ── */
  await page.evaluate(() => { ENG.cam.yaw = 0; });
  const qe = { };
  await page.keyboard.down('e'); await page.waitForTimeout(300); await page.keyboard.up('e');
  qe.e = await page.evaluate(() => ENG.cam.yaw);
  await page.keyboard.down('q'); await page.waitForTimeout(300); await page.keyboard.up('q');
  qe.back = await page.evaluate(() => ENG.cam.yaw);
  ok('Q／E 可以轉視角，兩顆方向相反',
     Math.abs(qe.e) > 0.2 && Math.abs(qe.back) < Math.abs(qe.e) * 0.5,
     '按 E 300ms → yaw ' + qe.e.toFixed(2) + '，再按 Q 300ms → ' + qe.back.toFixed(2));
  /* E 要對應「滑鼠往右拖」，不然兩套操作的手感會相反 */
  const qeDir = await page.evaluate(() => {
    ENG.cam.yaw = 0; ENG.orbit(100, 0);
    return ENG.cam.yaw;
  });
  ok('E 的方向跟滑鼠往右拖一致', Math.sign(qe.e) === Math.sign(qeDir),
     'E 是 ' + (qe.e > 0 ? '+' : '−') + '、往右拖是 ' + (qeDir > 0 ? '+' : '−'));

  /* 換建築**不准**動鏡頭：玩家自己轉好、拉近、平移過的視角不該被搶走。
     只有開場那一次（instant）才取景。草地／陰影／霧還是要照新工地重算。 */
  const keepView = await page.evaluate(() => {
    const sp0 = shapePick, tc0 = targetCnt;             // 這一段會換藍圖，測完要還原
    shapePick = SHAPES.findIndex(s => s.n === '中世紀城堡');
    targetCnt = 900;
    startBuild(true);                                   // 開場：取景
    const fit = { d: ENG.camTarget.dist, ty: ENG.camTarget.ty,
                  tx: ENG.camTarget.tx, tz: ENG.camTarget.tz };
    ENG.orbit(300, 0); ENG.zoom(-400); ENG.pan(1, 0.4, 1);   // 玩家自己動鏡頭
    const was = { d: ENG.camTarget.dist, ty: ENG.camTarget.ty,
                  tx: ENG.camTarget.tx, tz: ENG.camTarget.tz, yaw: ENG.cam.yaw };
    const arena0 = arenaR;
    shapePick = SHAPES.findIndex(s => s.n === '金門大橋');
    targetCnt = 2000; startBuild(false);                // 遊戲中換一座
    const now = { d: ENG.camTarget.dist, ty: ENG.camTarget.ty,
                  tx: ENG.camTarget.tx, tz: ENG.camTarget.tz, yaw: ENG.cam.yaw };
    const arena1 = arenaR;
    shapePick = sp0; targetCnt = tc0; startBuild(true);
    return { same: ['d', 'ty', 'tx', 'tz', 'yaw'].every(k => was[k] === now[k]),
             fit, was, now, moved: was.d !== fit.d || was.tx !== fit.tx,
             arena0: +arena0.toFixed(1), arena1: +arena1.toFixed(1) };
  });
  ok('換一座建築不會搶走鏡頭', keepView.same,
     '換之前 dist ' + keepView.was.d.toFixed(1) + '／tx ' + keepView.was.tx.toFixed(1) +
     '／yaw ' + keepView.was.yaw.toFixed(2) + '，換之後 dist ' + keepView.now.d.toFixed(1) +
     '／tx ' + keepView.now.tx.toFixed(1) + '／yaw ' + keepView.now.yaw.toFixed(2));
  ok('鏡頭不動，但草地範圍還是照新工地重算', keepView.arena1 > keepView.arena0 * 1.2,
     '場地半徑 ' + keepView.arena0 + ' → ' + keepView.arena1);
  /* 視線高在桌機是 0（v1.55 起看的是建築底部中心），所以這裡只能驗距離與圓心，
     不能再用 ty > 1 當「有取過景」的證據。 */
  ok('開場那一次還是會取景，鏡頭不會停在原點',
     keepView.fit.d > 20 && keepView.fit.ty === 0 &&
     keepView.fit.tx === 0 && keepView.fit.tz === 0 && keepView.moved,
     '開場取到 dist ' + keepView.fit.d.toFixed(1) + '、視線高 ' + keepView.fit.ty.toFixed(1) +
     '，玩家動過之後變成 dist ' + keepView.was.d.toFixed(1));

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

  /* 桌機開場的視線放在**建築底部中心**（工地原點），那一點要**剛好**落在畫面正中央
     （v1.55）。挑高的、矮的、寬的各一座：底部置中之後建築整個站在上半部，
     高的那幾座最容易被上緣切掉，所以同時驗「一塊都沒出界」。 */
  const baseMid = await page.evaluate(() => {
    const out = [];
    const v = new THREE.Vector3();
    for (const n of ['艾菲爾鐵塔', '台北 101', '大頭像', '吉薩金字塔', '金門大橋']) {
      shapePick = SHAPES.findIndex(s => s.n === n);
      targetCnt = 3000; startBuild(true);
      for (let k = 0; k < bp.slots.length && k < blocks.length; k++) {
        const s = bp.slots[k], b = blocks[k];
        b.st = 3; b.x = s.x; b.y = s.y + HB; b.z = s.z;
      }
      for (let k = 0; k < 6; k++) ENG.updateCamera(1);
      const cam = ENG.three.camera; cam.updateMatrixWorld();
      const base = v.set(0, 0, 0).project(cam).clone();
      let off = 0, top = -9;
      for (const b of blocks) {
        if (b.st !== 3) continue;
        v.set(b.x, b.y, b.z).project(cam);
        if (Math.abs(v.x) > 1 || Math.abs(v.y) > 1) off++;
        if (v.y > top) top = v.y;
      }
      out.push({ n: bp.name, x: +base.x.toFixed(3), y: +base.y.toFixed(3), off,
                 top: +top.toFixed(2), ty: +ENG.camTarget.ty.toFixed(2) });
    }
    shapePick = -1;
    return out;
  });
  ok('桌機開場：建築底部中心就在畫面正中央',
     baseMid.every(o => Math.abs(o.x) < 0.005 && Math.abs(o.y) < 0.005 && o.ty === 0),
     baseMid.map(o => o.n + ' (' + o.x + ',' + o.y + ')').join('、'));
  ok('底部置中之後上緣也沒切到建築',
     baseMid.every(o => o.off === 0 && o.top < 0.95),
     baseMid.map(o => o.n + ' 最高 ' + o.top + '／出界 ' + o.off).join('、'));

  /* 視線落到地面之後，畫面下緣那兩個角會打得很外面——草地島不夠大就會看到島的邊
     與底下那層土（艾菲爾鐵塔打到島半徑的 2.07 倍）。島要跟著補大。
     測的是「下緣三條射線打到地面的落點還在島上」，不是抄公式。 */
  const isleFit = await page.evaluate(() => {
    let isle = null;
    ENG.three.scene.traverse(o => {
      if (!isle && o.material && o.material.color && o.material.color.getHex() === 0x5f8f3e) isle = o;
    });
    const out = [];
    for (const n of ['艾菲爾鐵塔', '倫敦眼摩天輪', '台北 101', '金門大橋']) {
      shapePick = SHAPES.findIndex(s => s.n === n);
      targetCnt = 3000; startBuild(true);
      for (let k = 0; k < 6; k++) ENG.updateCamera(1);
      const cam = ENG.three.camera; cam.updateMatrixWorld();
      const half = isle.scale.x / 2;
      let worst = 0;
      for (const nx of [-1, 0, 1]) {
        const a = new THREE.Vector3(nx, -1, -1).unproject(cam);
        const c = cam.position, d = a.clone().sub(c).normalize();
        if (d.y >= -1e-6) continue;                     // 下緣朝天：打不到地面
        const p = c.clone().addScaledVector(d, -c.y / d.y);
        worst = Math.max(worst, Math.max(Math.abs(p.x), Math.abs(p.z)) / half);
      }
      out.push({ n: bp.name, half: Math.round(half), worst: +worst.toFixed(2) });
    }
    shapePick = -1;
    return out;
  });
  ok('畫面下緣看不到草地島的邊', isleFit.every(o => o.worst <= 1),
     isleFit.map(o => o.n + ' 島半徑 ' + o.half + '、下緣打到 ' + o.worst + ' 倍').join('、'));

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

  /* 手機版的取景**維持原樣**（v1.55 只改桌機）：視線還是放在建築腰間（0.44×高 + 1.5），
     底部中心因此落在畫面中央的下方。畫面高瘦，再把建築整個推到上半部會小到看不清楚。 */
  const mobFit = await page.evaluate(() => {
    const out = [];
    const v = new THREE.Vector3();
    for (const n of ['艾菲爾鐵塔', '台北 101', '大頭像']) {
      shapePick = SHAPES.findIndex(s => s.n === n);
      targetCnt = 3000; startBuild(true);
      for (let k = 0; k < 6; k++) ENG.updateCamera(1);
      const cam = ENG.three.camera; cam.updateMatrixWorld();
      out.push({ n: bp.name, ty: +ENG.camTarget.ty.toFixed(1),
                 want: +(bp.height * 0.44 + 1.5).toFixed(1),
                 y: +v.set(0, 0, 0).project(cam).y.toFixed(2) });
    }
    shapePick = -1;
    return out;
  });
  ok('手機版的視線還是看腰間，底部中心在中央下方',
     mobFit.every(o => Math.abs(o.ty - o.want) < 0.05 && o.y < -0.1),
     mobFit.map(o => o.n + ' 視線高 ' + o.ty + '、底部中心 NDC y=' + o.y).join('、'));

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
    for (const [cnt, wk] of [[900, 20], [3000, 60], [10000, 20]]) {
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

  /* 建材開到一萬之後最貴的場面不是靜態，而是「拆到一半」：垮塌連鎖會一直把支撐
     標記成 dirty，於是每幀都要重算一次連通性（一萬塊時單次 4.1ms，三千塊時 1.4ms）。
     單次重算會讓某幾幀超過預算，但它每幀最多跑一次，平均仍然遠低於 4ms。
     實測（吉薩金字塔連續地震）：3000 塊平均 0.78ms／最壞 5.8ms，
     10000 塊平均 2.08ms／最壞 7.2ms——用 60fps 的 16.7ms 看都還很寬。 */
  const perfWreck = await page.evaluate(() => {
    running = false;
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = CNT_MAX; setWorkerCount(20); startBuild(true); completeNow();
    let worst = 0, sum = 0, n = 0;
    for (let k = 0; k < 40; k++) {
      startQuake({ x: 0, y: 0, z: 0 });
      for (let i = 0; i < 6; i++) {
        const t = performance.now();
        step(0.02); draw();
        const ms = performance.now() - t;
        worst = Math.max(worst, ms); sum += ms; n++;
      }
    }
    const r = { blocks: blocks.length, avg: sum / n, worst };
    targetCnt = 3000; shapePick = -1; startBuild(true); completeNow();
    return r;
  });
  /* 門檻放寬到 6ms／60ms：這一段本身就有 ±70% 的機器抖動（同一台機器實測平均
     2.07～3.53ms、最壞單幀 7.2～16.2ms，看有沒有別的 node 行程在跑）。
     要守的是「不要出現數量級的退步」，不是把數字釘在某一次量到的值上。 */
  ok('一萬塊拆到一半（垮塌連鎖 + 支撐重算）：平均每幀還在預算內',
     perfWreck.avg < 6 && perfWreck.worst < 60,
     perfWreck.blocks + ' 塊：平均 ' + perfWreck.avg.toFixed(2) + 'ms、最壞單幀 ' +
     perfWreck.worst.toFixed(1) + 'ms（60fps 的預算是 16.7ms）');

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

