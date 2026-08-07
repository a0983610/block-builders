/* ============================================================
   拍散重建 · 小人蓋房子 — 端對端回歸測試
   跑法：node tools/e2e.cjs
   需要 Playwright 與 chromium；找不到時會印出安裝指令。
   全部通過 exit code 0，有失敗是 1，腳本自己壞掉是 2。

   為什麼一定要用真瀏覽器：這支程式的 bug 幾乎都出在「真實 DOM 與假物件的差異」
   （例如 clientWidth 是唯讀的、canvas 是 replaced element），
   自己刻的假 canvas 一定比真的寬鬆，測了也是白測。
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
  for (const t of tries) {
    try { return require(t); } catch (e) { /* 換下一個 */ }
  }
  console.error('找不到 playwright。任一方式即可：\n' +
    '  npm i -D playwright && npx playwright install chromium\n' +
    '  npm i -g @playwright/mcp（附帶的 chromium 也能用）');
  process.exit(2);
}
const { chromium } = loadPlaywright();

const APP = 'file:///' + path.resolve(__dirname, '..', 'block-builders.html').replace(/\\/g, '/');
const OUT = path.join(__dirname, '.e2e-out');
const VIEW = { width: 1280, height: 800 };
const SHAPE_COUNT = 32;          // 與程式裡 SHAPES 的數量一致

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
/* 讀內部狀態。讀原始狀態比讀畫面嚴格；「畫面真的有畫出來」另外由像素那一段驗。 */
const st = page => page.evaluate(() => ({
  phase, placed: placedCnt,
  total: bp ? bp.slots.length : 0,
  name: bp ? bp.name : '', pal: bp ? bp.pal.n : '',
  height: bp ? bp.height : 0, radius: bp ? bp.radius : 0,
  pool: blocks.length, dyingN: dying.length, partsN: parts.length, workersN: workers.length,
  free: blocks.filter(b => b.state === 'free').length,
  carried: blocks.filter(b => b.state === 'carried').length,
  placedN: blocks.filter(b => b.state === 'placed').length,
  resting: blocks.filter(b => b.state === 'free' && b.rest && b.snap <= 0).length,
  moving: blocks.filter(b => b.state === 'free' && !b.rest).length,
  nan: blocks.filter(b => !isFinite(b.x + b.y + b.z + b.w + b.h + b.d + b.cr)).length,
  under: blocks.filter(b => b.y < -0.5).length,
  filledSlots: bp ? bp.slots.filter(s => s.filled).length : 0,
  yaw: cam.yaw, pitch: cam.pitch, dist: cam.dist, zoom: camZoom, base: camBase, siteR,
  cw: cvs.width, ch: cvs.height, cssw: cvs.style.width, cssh: cvs.style.height,
  dpr: window.devicePixelRatio, iw: window.innerWidth, ih: window.innerHeight,
  drawn: DL.length,
  flags: { autoLoop, spinOn, shadOn, sfxOn, targetCnt, nWorkers, speed },
  hud: {
    name: document.getElementById('bName').textContent,
    sub: document.getElementById('bSub').textContent,
    cnt: document.getElementById('bCnt').textContent,
    bar: document.getElementById('bBar').style.width,
  },
}));

/* 開一棟指定造型的建築並停掉自動循環／自轉，讓測試可重現。
   pickShape 是 function 宣告（掛在 global object 上），覆寫它就能指定造型。 */
async function reset(page, o = {}) {
  await page.evaluate(o => {
    autoLoop = false; spinOn = false;
    /* 變數與 checkbox 要一起改，否則後面用 page.check() 操作 UI 時，
       Playwright 會看到「已經勾了」而不觸發 change，測到的就不是真的 UI 行為 */
    document.getElementById('cAuto').checked = false;
    document.getElementById('cSpin').checked = false;
    if (!window.__origPick) window.__origPick = pickShape;
    if (o.cnt != null) targetCnt = o.cnt;
    if (o.wk != null) nWorkers = o.wk;
    if (o.sp != null) speed = o.sp;
    if (o.shape) {
      const i = SHAPES.findIndex(s => s.n === o.shape);
      if (i < 0) throw new Error('沒有這個造型：' + o.shape);
      pickShape = () => i;
    } else {
      pickShape = window.__origPick;
    }
    startBuild(true);
  }, o);
  await page.waitForTimeout(150);
}

async function until(page, fn, arg, ms = 30000, step = 80) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await page.evaluate(fn, arg)) return true;
    await page.waitForTimeout(step);
  }
  return false;
}

/* 畫面像素抽樣：顏色數少到只有一兩種，代表畫布其實是空的 */
const pix = page => page.evaluate(() => {
  const d = ctx.getImageData(0, 0, cvs.width, cvs.height).data;
  const set = new Set();
  let n = 0, sum = 0;
  for (let i = 0; i < d.length; i += 4 * 31) {
    set.add((d[i] >> 3 << 10) | (d[i + 1] >> 3 << 5) | (d[i + 2] >> 3));
    sum += d[i] + d[i + 1] + d[i + 2]; n++;
  }
  return { colors: set.size, avg: +(sum / (n * 3)).toFixed(2), samples: n };
});

/* 已就位的方塊有多少比例投影落在畫布內 */
const onScreen = page => page.evaluate(() => {
  const o = [0, 0]; let inn = 0, tot = 0;
  for (const b of blocks) {
    if (b.state !== 'placed') continue;
    tot++;
    if (proj(b.x, b.y, b.z, o) > 0.4 && o[0] >= 0 && o[0] < W && o[1] >= 0 && o[1] < H) inn++;
  }
  return { inn, tot, ratio: tot ? inn / tot : 0 };
});

/* 建築物上某一點的螢幕座標（拿最高的方塊，確定不會點到地面） */
const aimTop = page => page.evaluate(() => {
  let best = null;
  for (const b of blocks) if (b.state === 'placed' && (!best || b.y > best.y)) best = b;
  const o = [0, 0]; proj(best.x, best.y, best.z, o);
  return { x: Math.round(o[0]), y: Math.round(o[1]), by: best.y };
});

const shot = (page, name) => page.screenshot({ path: path.join(OUT, name) });
const med = a => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const deg = r => (r * 180 / Math.PI).toFixed(0) + '°';

/* ============================================================ */
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctxDesktop = await browser.newContext({ viewport: VIEW });
  const page = await ctxDesktop.newPage();

  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e).split('\n')[0]));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  /* ===================== 啟動 ===================== */
  head('啟動');
  await page.goto(APP);
  await page.waitForTimeout(600);

  ok('載入時沒有 JS 錯誤', errors.length === 0, errors.slice(0, 2).join(' | ') || '無');

  let s = await st(page);
  ok('一開始就有一棟蓋好的建築', s.phase === 'built' && s.total > 0 && s.placed === s.total,
     s.name + ' ' + s.placed + '/' + s.total + ' 塊');
  ok('每一塊建材都在建築上（沒有掉在地上的）',
     s.placedN === s.pool && s.free === 0 && s.carried === 0,
     '已就位 ' + s.placedN + ' / 建材池 ' + s.pool);
  ok('藍圖每一格都被填滿', s.filledSlots === s.total, s.filledSlots + '/' + s.total);
  ok('沒有 NaN 座標、沒有沉到地面下的方塊', s.nan === 0 && s.under === 0,
     'NaN ' + s.nan + '、地下 ' + s.under);

  /* 這一段就是在擋上次那個「resize 丟 TypeError 導致整頁空白」 */
  ok('canvas 畫布解析度 = 視窗 × DPR',
     s.cw === Math.round(s.iw * Math.min(2, s.dpr)) && s.ch === Math.round(s.ih * Math.min(2, s.dpr)),
     s.cw + '×' + s.ch + '（視窗 ' + s.iw + '×' + s.ih + '、DPR ' + s.dpr + '）');
  ok('canvas CSS 尺寸 = 視窗（不被 DPR 放大）',
     s.cssw === s.iw + 'px' && s.cssh === s.ih + 'px', s.cssw + ' × ' + s.cssh);
  const box = await page.locator('#c').boundingBox();
  ok('canvas 版面真的填滿視窗',
     Math.abs(box.width - VIEW.width) < 2 && Math.abs(box.height - VIEW.height) < 2,
     Math.round(box.width) + '×' + Math.round(box.height));

  const p0 = await pix(page);
  ok('畫面真的畫出東西（不是一片空白）', p0.colors > 40,
     '抽樣到 ' + p0.colors + ' 種顏色、平均亮度 ' + p0.avg);
  const os0 = await onScreen(page);
  ok('建築落在畫面內', os0.ratio > 0.9, (os0.ratio * 100).toFixed(0) + '% (' + os0.inn + '/' + os0.tot + ')');

  ok('HUD 顯示建築名稱與建材數', s.hud.name === s.name && /\d+ \/ \d+ 塊/.test(s.hud.cnt),
     s.hud.name + '｜' + s.hud.cnt);
  ok('進度條在完工時是 100%', parseFloat(s.hud.bar) > 99.5, s.hud.bar);

  await reset(page, { cnt: 170, wk: 7, sp: 1 });

  /* ===================== 3D 引擎 ===================== */
  head('3D 引擎');
  /* 一次同步跑完並還原 ctx，中間不會有 rAF 插進來 */
  const m3 = await page.evaluate(() => {
    const rec = []; let cur = [];
    const O = {};
    for (const k of ['beginPath', 'moveTo', 'lineTo', 'closePath', 'arc', 'fill', 'stroke']) O[k] = ctx[k];
    ctx.beginPath = function () { cur = []; };
    ctx.moveTo = function (x, y) { cur.push([x, y]); };
    ctx.lineTo = function (x, y) { cur.push([x, y]); };
    ctx.closePath = function () {};
    ctx.arc = function (x, y, r) { cur.push(['arc', x, y, r]); };
    ctx.fill = function () { rec.push({ p: cur.slice(), s: String(ctx.fillStyle) }); };
    ctx.stroke = function () {};

    const lum = s => {                       // canvas 會把 rgb() 正規化成 #rrggbb
      const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(s);
      if (m) return parseInt(m[1], 16) + parseInt(m[2], 16) + parseInt(m[3], 16);
      const a = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(s);
      return a ? +a[1] + +a[2] + +a[3] : -1;
    };
    const alpha = s => { const a = /rgba\([^)]*,\s*([\d.]+)\s*\)$/.exec(s); return a ? +a[1] : 1; };
    const r = {};
    try {
      const o = [0, 0];
      /* 投影 */
      cam.yaw = 0; cam.pitch = 0.4; cam.dist = 50; cam.tx = cam.ty = cam.tz = 0;
      updateCam(); cx0 = W / 2; cy0 = H / 2;
      r.vz = proj(0, 0, 0, o);
      r.center = [o[0], o[1]];
      r.camAbove = camPos.y > 0 && camPos.z > 0;
      proj(10, 0, 0, o); r.rightX = o[0];
      proj(-10, 0, 0, o); r.leftX = o[0];
      proj(0, 10, 0, o); r.upY = o[1];
      r.behind = proj(0, 0, 60, o);

      /* 背面剔除 + 打光 */
      cam.yaw = 0.7; cam.pitch = 0.42; cam.dist = 40; updateCam();
      DL.length = 0; pn = 0;
      addBox(0, 0, 0, 2, 2, 2, null, 200, 200, 200, 1, false);
      r.queued = DL.length;
      rec.length = 0; drawBoxItem(DL[0]);
      r.faces = rec.length;
      const fs2 = rec.map(f => ({ l: lum(f.s), top: Math.min(...f.p.map(q => q[1])) }));
      r.lumSpread = Math.max(...fs2.map(f => f.l)) - Math.min(...fs2.map(f => f.l));
      fs2.sort((a, b) => a.top - b.top);
      r.topBrightest = fs2[0].l === Math.max(...fs2.map(f => f.l));
      r.maxChannel = Math.max(...rec.map(f => {
        const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(f.s);
        return m ? Math.max(parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)) : 0;
      }));

      /* 隨機旋轉：可見面永遠 1~3 個 */
      const it = DL[0]; it.m = new Float64Array(9);
      let lo = 9, hi = 0;
      for (let k = 0; k < 400; k++) {
        eulerMat(it.m, Math.random() * 7, Math.random() * 7, Math.random() * 7);
        rec.length = 0; drawBoxItem(it);
        if (rec.length < lo) lo = rec.length;
        if (rec.length > hi) hi = rec.length;
      }
      r.rotLo = lo; r.rotHi = hi;

      /* halfY（任意旋轉下沿世界 Y 的半高） */
      const mm = new Float64Array(9);
      eulerMat(mm, 0, 0, 0);              r.h0 = halfY(mm, 2, 6, 2);
      eulerMat(mm, Math.PI / 2, 0, 0);    r.hx = halfY(mm, 2, 6, 2);
      eulerMat(mm, 0, 0, Math.PI / 2);    r.hz = halfY(mm, 2, 6, 2);
      eulerMat(mm, 0, 0, Math.PI / 4);    r.h45 = halfY(mm, 2, 2, 2);

      /* 陰影 */
      cam.pitch = 0.5; cam.dist = 60; updateCam();
      DL.length = 0; pn = 0;
      addBox(0, 6, 0, 2, 2, 2, null, 200, 200, 200, 1, false);
      const hiBox = DL[0]; hiBox.m = null;
      rec.length = 0; drawShadow(hiBox);
      r.shadowDrawn = rec.length === 1;
      const shY = rec.length ? rec[0].p.reduce((a, q) => a + q[1], 0) / 4 : 0;
      const shA = rec.length ? alpha(rec[0].s) : 0;
      rec.length = 0; drawBoxItem(hiBox);
      const allP = rec.flatMap(f => f.p);
      r.shadowBelow = shY > allP.reduce((a, q) => a + q[1], 0) / allP.length;
      DL.length = 0; pn = 0;
      addBox(0, 1, 0, 2, 2, 2, null, 200, 200, 200, 1, false);
      DL[0].m = null; rec.length = 0; drawShadow(DL[0]);
      r.shadowFade = alpha(rec[0].s) > shA;

      /* 地平線 */
      const hz = p => { cam.pitch = p; updateCam(); return cy0 + bF.y * focal / Math.hypot(bF.x, bF.z); };
      r.hz50 = hz(0.5); r.hz15 = hz(0.15); r.half = H / 2;
    } finally {
      for (const k in O) ctx[k] = O[k];
      cam.yaw = 0.85; cam.pitch = 0.34; updateCam();
      DL.length = 0; pn = 0;
    }
    return r;
  });

  ok('相機到目標的距離 = cam.dist', Math.abs(m3.vz - 50) < 0.01, m3.vz.toFixed(3));
  ok('世界原點投影在畫面正中央',
     Math.abs(m3.center[0] - VIEW.width / 2) < 0.5 && Math.abs(m3.center[1] - VIEW.height / 2) < 0.5,
     m3.center.map(v => v.toFixed(1)).join(', '));
  ok('相機在目標上方（yaw=0 時位於 +Z 側）', m3.camAbove);
  ok('世界 +X 在畫面右邊、+Y 在畫面上方',
     m3.rightX > VIEW.width / 2 && m3.upY < VIEW.height / 2);
  ok('±X 左右對稱',
     Math.abs((m3.rightX - VIEW.width / 2) - (VIEW.width / 2 - m3.leftX)) < 1.5);
  ok('相機後方的點會被剔除（view z <= 0）', m3.behind <= 0.06, m3.behind.toFixed(3));
  ok('addBox 會把方塊排進繪製佇列', m3.queued === 1);
  ok('斜上方看立方體恰好畫 3 個面（背面剔除）', m3.faces === 3, m3.faces + ' 面');
  ok('三個面亮度不同（有打光）', m3.lumSpread > 20, '亮度差 ' + m3.lumSpread);
  ok('畫面最上方的面（頂面）最亮', m3.topBrightest);
  ok('亮面顏色不會溢出 255', m3.maxChannel <= 255, '最大通道 ' + m3.maxChannel);
  ok('400 次隨機旋轉，可見面永遠 1~3 個', m3.rotLo >= 1 && m3.rotHi <= 3,
     m3.rotLo + '~' + m3.rotHi + ' 面');
  ok('halfY：無旋轉 = h/2', Math.abs(m3.h0 - 3) < 1e-9, m3.h0.toFixed(4));
  ok('halfY：繞 X 轉 90° = d/2', Math.abs(m3.hx - 1) < 1e-9, m3.hx.toFixed(4));
  ok('halfY：繞 Z 轉 90° = w/2', Math.abs(m3.hz - 1) < 1e-9, m3.hz.toFixed(4));
  ok('halfY：立方體轉 45° = √2', Math.abs(m3.h45 - Math.SQRT2) < 1e-9, m3.h45.toFixed(4));
  ok('高處方塊會畫陰影', m3.shadowDrawn);
  ok('陰影畫在方塊下方', m3.shadowBelow);
  ok('越高的方塊陰影越淡', m3.shadowFade);
  ok('俯視時地平線在畫面中央上方', m3.hz50 < m3.half, m3.hz50.toFixed(0) + ' < ' + m3.half);
  ok('俯角變小地平線往下移', m3.hz15 > m3.hz50,
     deg(0.15) + ' → ' + m3.hz15.toFixed(0) + '、' + deg(0.5) + ' → ' + m3.hz50.toFixed(0));

  /* ===================== 拍散 ===================== */
  head('拍散');
  await reset(page, { shape: '高塔', cnt: 170 });
  await shot(page, '1-built.png');
  const before = await st(page);
  const aim = await aimTop(page);
  await page.mouse.click(aim.x, aim.y);
  await page.waitForTimeout(90);
  s = await st(page);
  ok('點建築物會拍散它', s.phase === 'debris' && s.placedN === 0,
     '點 (' + aim.x + ',' + aim.y + ')　狀態 ' + s.phase + '、剩 ' + s.placedN + ' 塊在建築上');
  ok('每一塊都獲得了初速度', s.moving === s.pool, s.moving + '/' + s.pool + ' 在飛');
  ok('拍散會噴塵土', s.partsN > 30, s.partsN + ' 顆粒子');
  ok('HUD 顯示狼藉狀態', /狼藉/.test(s.hud.sub), s.hud.sub);
  await shot(page, '2-debris.png');

  /* 使用者要的「不同角度散掉」：直接指定衝擊點，比較碎塊平均飛行方向 */
  const dirOf = (page, ang) => page.evaluate(a => {
    startBuild(true);
    const r = Math.max(2, bp.radius * 0.6);
    smash(Math.cos(a) * r, bp.height * 0.5, Math.sin(a) * r, 20, Math.cos(a) * 0.45, Math.sin(a) * 0.45);
    let vx = 0, vz = 0;
    for (const b of blocks) { vx += b.vx; vz += b.vz; }
    return { ang: Math.atan2(vz, vx), mag: Math.hypot(vx, vz) / blocks.length };
  }, ang);
  const dE = await dirOf(page, 0);
  const dW = await dirOf(page, Math.PI);
  let diff = Math.abs(dE.ang - dW.ang); if (diff > Math.PI) diff = 2 * Math.PI - diff;
  ok('從不同角度拍，碎塊散開的方向不同', diff > 2.0,
     '東側打 → ' + deg(dE.ang) + '、西側打 → ' + deg(dW.ang) + '，夾角 ' + deg(diff));
  ok('離衝擊點近的飛得比較快', await page.evaluate(() => {
    startBuild(true);
    smash(0, bp.height * 0.5, 0, 20, 0, 0);
    let near = 0, nn = 0, far = 0, fn = 0;
    for (const b of blocks) {
      const d = Math.hypot(b.x, b.y - bp.height * 0.5, b.z);
      const v = Math.hypot(b.vx, b.vy, b.vz);
      if (d < bp.radius * 0.5) { near += v; nn++; } else { far += v; fn++; }
    }
    return nn && fn && near / nn > far / fn * 1.2;
  }));

  /* 落定行為 */
  await reset(page, { shape: '金字塔', cnt: 120, sp: 3 });
  await page.evaluate(() => autoSmash());
  const settled = await until(page,
    () => blocks.every(b => b.state !== 'free' || (b.rest && b.snap <= 0)), null, 25000);
  ok('碎塊最後都會落定停下來', settled);
  const land = await page.evaluate(() => {
    const bad = [], inside = [];
    for (const b of blocks) {
      if (b.state !== 'free') continue;
      const hy = halfY(b.m, b.w, b.h, b.d);
      if (Math.abs(b.y - hy) > 0.06) bad.push(+(b.y - hy).toFixed(3));
      if (Math.hypot(b.x, b.z) < siteR + 1.4 && b.hops < 4) inside.push(+Math.hypot(b.x, b.z).toFixed(1));
    }
    const ax = blocks.filter(b => b.state === 'free').map(b =>
      Math.min(...[b.rx, b.ry, b.rz].map(a => Math.abs(((a % (Math.PI / 2)) + Math.PI) % (Math.PI / 2)))));
    return { bad, inside, n: blocks.length, maxOff: Math.max(...ax) };
  });
  ok('落定的方塊都貼在地面上（沒有浮空或陷入）', land.bad.length === 0,
     land.bad.length ? '偏差 ' + land.bad.slice(0, 5).join(', ') : land.n + ' 塊都貼地');
  ok('碎塊不會堆在工地上（會被彈開，小人才走得動）', land.inside.length === 0,
     land.inside.length ? '仍在圈內：' + land.inside.slice(0, 5).join(', ') : '全部在工地圈外');
  ok('落定後會轉正躺平（貼齊 90° 倍數）', land.maxOff < 0.02, '最大殘餘角 ' + land.maxOff.toFixed(4));

  /* ===================== 小人重建 ===================== */
  head('小人重建');
  ok('拍散後會自己進入施工階段',
     await until(page, () => phase === 'building', null, 6000));

  const carry = await page.evaluate(() => new Promise(res => {
    /* 等到抓到「有小人正把某塊舉在頭上搬」的瞬間，記下當時的尺寸與顏色 */
    const t0 = Date.now();
    const tick = () => {
      const w = workers.find(w => w.st === 'toSite' && w.blk && w.slot);
      if (w) {
        const b = w.blk, s = w.slot;
        return res({
          got: true, state: b.state, aboveHead: b.y > 1.5,
          before: { w: +b.w.toFixed(3), col: [b.cr, b.cg, b.cb] },
          want: { w: +s.tw.toFixed(3), col: [s.cr, s.cg, s.cb] },
          sameSize: Math.abs(b.w - s.tw) < 0.01,
          sameCol: b.cr === s.cr && b.cg === s.cg && b.cb === s.cb,
          slotKey: bp.slots.indexOf(s),
        });
      }
      if (Date.now() - t0 > 20000) return res({ got: false });
      requestAnimationFrame(tick);
    };
    tick();
  }));
  await until(page, () => bp && placedCnt > bp.slots.length * 0.3, null, 30000);
  await shot(page, '3-building.png');       // 蓋到三成，截圖比較看得出在施工
  ok('小人會把建材舉在頭上搬運', carry.got && carry.state === 'carried' && carry.aboveHead,
     carry.got ? '狀態 ' + carry.state + '、高度 ' + (carry.aboveHead ? '過頭' : '過低') : '20 秒內沒抓到搬運中的小人');
  /* 使用者要的「不用照之前的形狀跟數量」：搬的時候還是舊尺寸／舊顏色，放上去才變 */
  ok('搬運中的建材還是舊的尺寸或顏色（不是預先變好的）',
     carry.got && (!carry.sameSize || !carry.sameCol),
     carry.got ? '搬運中 寬' + carry.before.w + ' rgb(' + carry.before.col + ')　→ 目標 寬' +
                 carry.want.w + ' rgb(' + carry.want.col + ')' : '略過');
  if (carry.got) {
    const done = await page.evaluate(async k => {
      for (let i = 0; i < 900; i++) {
        const s = bp.slots[k];
        if (s.filled) {
          const b = blocks.find(b => b.slot === s);
          return { filled: true,
                   sizeOk: Math.abs(b.w - s.tw) < 1e-6 && Math.abs(b.h - s.th) < 1e-6,
                   colOk: b.cr === s.cr && b.cg === s.cg && b.cb === s.cb,
                   rotOk: b.rx === 0 && b.ry === 0 && b.rz === 0,
                   posOk: Math.abs(b.x - s.wx) < 1e-6 && Math.abs(b.y - s.wy) < 1e-6 };
        }
        await new Promise(r => requestAnimationFrame(r));
      }
      return { filled: false };
    }, carry.slotKey);
    ok('放上去之後尺寸／顏色／角度／位置都變成藍圖要的值',
       done.filled && done.sizeOk && done.colOk && done.rotOk && done.posOk,
       done.filled ? '尺寸' + (done.sizeOk ? '✓' : '✗') + ' 顏色' + (done.colOk ? '✓' : '✗') +
                     ' 角度' + (done.rotOk ? '✓' : '✗') + ' 位置' + (done.posOk ? '✓' : '✗')
                   : '那一格沒被填上');
  }

  /* 完整蓋完一棟（用小建材數 + 多小人 + 高速度縮短測試時間） */
  await reset(page, { cnt: 80, wk: 16, sp: 3 });
  const oldName = (await st(page)).name;
  await page.evaluate(() => autoSmash());
  const built = await until(page, () => phase === 'built' && placedCnt === bp.slots.length, null, 90000);
  s = await st(page);
  ok('小人會把整棟蓋完', built && s.placed === s.total, s.name + ' ' + s.placed + '/' + s.total + ' 塊');
  ok('重建出來的是不一樣的建築', s.name !== oldName, oldName + ' → ' + s.name);
  ok('建材池數量與新藍圖需求一致（多的運走、缺的補上）', s.pool === s.total,
     '池 ' + s.pool + ' / 需求 ' + s.total);
  ok('蓋完後地上沒有剩下的散料', s.free === 0 && s.carried === 0,
     '散料 ' + s.free + '、搬運中 ' + s.carried);
  ok('全程沒有 NaN 或沉入地面', s.nan === 0 && s.under === 0);
  ok('HUD 切回完工狀態', /完工/.test(s.hud.sub) && parseFloat(s.hud.bar) > 99.5, s.hud.sub);

  const order = await page.evaluate(() => {
    /* 施工順序是由下往上：藍圖排序後前段的 y 應該低於後段 */
    const ys = bp.slots.map(s => s.wy);
    const q = Math.max(1, Math.floor(ys.length * 0.2));
    const lo = ys.slice(0, q).reduce((a, b) => a + b, 0) / q;
    const hi = ys.slice(-q).reduce((a, b) => a + b, 0) / q;
    return { lo: +lo.toFixed(2), hi: +hi.toFixed(2) };
  });
  ok('施工順序由下往上', order.hi > order.lo, '前 20% 平均高度 ' + order.lo + ' → 後 20% ' + order.hi);

  /* 料場補料：從 80 塊跳到 440 塊，會一次補上三百多塊 */
  await reset(page, { cnt: 80, wk: 8, sp: 3 });
  const poolBefore = (await st(page)).pool;
  await page.evaluate(() => { targetCnt = 440; autoSmash(); });
  ok('建材不夠時會進入施工並先補料', await until(page, () => phase === 'building', null, 8000));
  ok('建材池補到與新藍圖需求一致', (await st(page)).pool === (await st(page)).total,
     poolBefore + ' → ' + (await st(page)).pool + ' 塊');
  /* 要等碎料全部落定才量：snap>0 的方塊正在做「落地轉正」的過渡，位置本來就還在動 */
  const stable = await until(page,
    () => blocks.every(b => b.state !== 'free' || (b.rest && b.snap <= 0)), null, 30000);
  ok('補料與舊碎料都會進入穩定狀態', stable);
  const yard = await page.evaluate(() => {
    let float = 0, inside = 0, worst = 0, far = 0;
    for (const b of blocks) {
      if (b.state !== 'free') continue;
      /* 貼地高度要用 halfY（沿世界 Y 的半高）：長磚立著落定時，正確的 y 是它的長邊一半，
         寫成 h/2 會把「立著的磚」誤判成浮空 */
      const off = Math.abs(b.y - halfY(b.m, b.w, b.h, b.d));
      if (off > 0.02) { float++; worst = Math.max(worst, off); }
      const d = Math.hypot(b.x, b.z);
      if (d < siteR + 1.4 && b.hops < 4) inside++;
      far = Math.max(far, d);
    }
    return { pool: blocks.length, total: bp.slots.length, float, inside,
             worst: +worst.toFixed(2), far: +far.toFixed(0), siteR: +siteR.toFixed(0) };
  });
  ok('補的料攤平在地上（不會堆到半空中被抽空）', yard.float === 0,
     yard.float ? yard.float + ' 塊浮空，最高 ' + yard.worst : '全部貼地');
  ok('補的料與舊碎料都在工地圈外（不擋施工）', yard.inside === 0,
     yard.inside ? yard.inside + ' 塊在圈內' : '工地半徑 ' + yard.siteR + '、最遠建材 ' + yard.far);
  const shrink = await page.evaluate(async () => {
    targetCnt = 100; finishNow(); autoSmash();
    for (let i = 0; i < 600 && phase !== 'building'; i++) await new Promise(r => requestAnimationFrame(r));
    return { pool: blocks.length, total: bp.slots.length, dying: dying.length };
  });
  ok('建材過多時多的會被運走（淡出）', shrink.pool === shrink.total && shrink.dying > 0,
     '池 ' + shrink.pool + ' / 需求 ' + shrink.total + '、正在運走 ' + shrink.dying + ' 塊');
  await until(page, () => dying.length === 0, null, 6000);
  ok('運走的建材會清乾淨（不會殘留）', (await st(page)).dyingN === 0);

  /* ===================== 藍圖 ===================== */
  head('藍圖');
  const bpAll = await page.evaluate(n => {
    const out = { count: SHAPES.length, names: SHAPES.map(s => s.n), bad: [], stats: [] };
    for (let i = 0; i < SHAPES.length; i++) {
      let r;
      try { r = makeBlueprint(i, n); }
      catch (e) { out.bad.push(SHAPES[i].n + ': 例外 ' + e.message); continue; }
      const sl = r.slots;
      let minY = 1e9, maxAbsX = 0, maxAbsZ = 0, nan = 0;
      for (const s of sl) {
        if (!isFinite(s.wx + s.wy + s.wz + s.tw + s.th + s.td + s.cr + s.cg + s.cb)) nan++;
        if (s.wy < minY) minY = s.wy;
        maxAbsX = Math.max(maxAbsX, s.wx); maxAbsZ = Math.max(maxAbsZ, s.wz);
      }
      const cx = (Math.max(...sl.map(s => s.wx)) + Math.min(...sl.map(s => s.wx))) / 2;
      const cz = (Math.max(...sl.map(s => s.wz)) + Math.min(...sl.map(s => s.wz))) / 2;
      if (nan) out.bad.push(SHAPES[i].n + ': NaN×' + nan);
      if (sl.length < 12) out.bad.push(SHAPES[i].n + ': 只有 ' + sl.length + ' 塊');
      if (Math.abs(minY - 0.5) > 1e-6) out.bad.push(SHAPES[i].n + ': 最低層在 y=' + minY.toFixed(2) + '（沒貼地）');
      if (Math.abs(cx) > 1 || Math.abs(cz) > 1) out.bad.push(SHAPES[i].n + ': 沒置中 (' + cx.toFixed(1) + ',' + cz.toFixed(1) + ')');
      if (!(r.radius > 0) || !(r.height > 0)) out.bad.push(SHAPES[i].n + ': radius/height 異常');
      if (!r.pal || !r.pal.n) out.bad.push(SHAPES[i].n + ': 沒配色');
      out.stats.push({ n: SHAPES[i].n, k: sl.length, min: shapeMinCount(i) });
    }
    return out;
  }, 170);
  ok('造型數量是 ' + SHAPE_COUNT + ' 種', bpAll.count === SHAPE_COUNT, bpAll.count + ' 種');
  ok('造型名稱沒有重複', new Set(bpAll.names).size === bpAll.names.length);
  ok('每一種造型都能正常產生（無例外／無 NaN／貼地／置中）', bpAll.bad.length === 0,
     bpAll.bad.length ? bpAll.bad.slice(0, 4).join('　|　') : bpAll.count + ' 種全過');
  const fit = bpAll.stats.filter(x => x.min <= 170 * 1.6);
  const offs = fit.map(x => Math.abs(x.k - 170) / 170);
  ok('會被挑中的造型，磚數貼近設定值（中位偏差 < 20%）', med(offs) < 0.2,
     '可用 ' + fit.length + '/' + bpAll.count + ' 種，中位偏差 ' + (med(offs) * 100).toFixed(0) +
     '%、最大 ' + (Math.max(...offs) * 100).toFixed(0) + '%');
  ok('磚數天生太多的造型會在小設定值下被排除', await page.evaluate(() => {
    const big = SHAPES.map((s, i) => i).filter(i => shapeMinCount(i) > 80 * 1.6);
    if (!big.length) return true;
    for (let k = 0; k < 200; k++) if (big.includes(pickShape(80))) return false;
    return true;
  }), '共 ' + bpAll.stats.filter(x => x.min > 128).length + ' 種在「建材 80」時不會被挑到');

  const cntCmp = await page.evaluate(() => {
    if (!window.__origPick) window.__origPick = pickShape;
    pickShape = window.__origPick;
    const pick = n => { const a = []; for (let k = 0; k < 12; k++) a.push(makeBlueprint(pickShape(n), n).slots.length); return a; };
    const lo = pick(100), hi = pick(400);
    const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
    return { lo: Math.round(avg(lo)), hi: Math.round(avg(hi)) };
  });
  ok('建材數量設定真的會改變建築規模', cntCmp.hi > cntCmp.lo * 2.2,
     '設 100 → 平均 ' + cntCmp.lo + ' 塊、設 400 → 平均 ' + cntCmp.hi + ' 塊');
  ok('連續挑造型不會短期重複', await page.evaluate(() => {
    const seen = [];
    for (let k = 0; k < 24; k++) {
      const i = pickShape(300);
      if (seen.slice(-8).includes(i)) return false;
      seen.push(i);
    }
    return true;
  }), '連續 24 次，任意相鄰 8 次內都不重複');

  /* ===================== 控制項 ===================== */
  head('控制項');
  await reset(page, { cnt: 100, wk: 6, sp: 2 });
  await page.click('#btnSmash');
  await page.waitForTimeout(90);
  ok('「拍散」鈕會拍散', (await st(page)).phase === 'debris');

  await until(page, () => phase === 'building', null, 6000);
  await page.click('#btnFinish');
  await page.waitForTimeout(120);
  s = await st(page);
  ok('「立刻蓋完」鈕會馬上補完整棟', s.phase === 'built' && s.placed === s.total,
     s.placed + '/' + s.total);

  const n1 = (await st(page)).name;
  let n2 = n1;
  for (let i = 0; i < 6 && n2 === n1; i++) { await page.click('#btnNext'); await page.waitForTimeout(120); n2 = (await st(page)).name; }
  s = await st(page);
  ok('「換一棟」鈕直接換成另一棟蓋好的建築',
     n2 !== n1 && s.phase === 'built' && s.placed === s.total, n1 + ' → ' + n2);

  await page.locator('#sWk').fill('13');
  await page.waitForTimeout(250);
  ok('小人滑桿會改變小人數量', (await st(page)).workersN === 13,
     (await st(page)).workersN + ' 名');
  await page.locator('#sWk').fill('6');

  await page.locator('#sCnt').fill('300');
  await page.waitForTimeout(80);
  ok('建材滑桿會寫進設定值', (await st(page)).flags.targetCnt === 300);
  await page.click('#btnNext');
  await page.waitForTimeout(200);
  s = await st(page);
  ok('建材滑桿會影響下一棟的規模', s.total > 200, s.name + ' ' + s.total + ' 塊');
  await page.locator('#sCnt').fill('100');

  /* 速度：同樣時間內完成的塊數要明顯不同。
     要等第一批建材真的搬到才開始計時，不然慢速那邊整段都還在走路，量到 0 塊，
     比較就變成「任何數字 > 0」的假通過。 */
  const rate = async sp => {
    await reset(page, { cnt: 100, wk: 8, sp });
    await page.evaluate(() => autoSmash());
    await until(page, () => phase === 'building', null, 6000);
    await until(page, () => placedCnt >= 3, null, 40000);
    const a = (await st(page)).placed;
    await page.waitForTimeout(5000);
    return (await st(page)).placed - a;
  };
  const slow = await rate(0.6), fast = await rate(3);
  ok('速度滑桿會改變施工快慢', slow >= 2 && fast > slow * 1.8,
     '速度 0.6 → 5 秒蓋 ' + slow + ' 塊、速度 3 → ' + fast + ' 塊');

  await reset(page, { cnt: 100 });
  await page.check('#cSpin'); await page.waitForTimeout(500);
  const y1 = (await st(page)).yaw;
  await page.waitForTimeout(900);
  const y2 = (await st(page)).yaw;
  ok('自轉開關打開時鏡頭會慢慢轉', Math.abs(y2 - y1) > 0.01, '0.9 秒轉了 ' + deg(y2 - y1));
  await page.uncheck('#cSpin'); await page.waitForTimeout(600);
  const y3 = (await st(page)).yaw;
  await page.waitForTimeout(700);
  ok('關掉自轉就不動', Math.abs((await st(page)).yaw - y3) < 1e-6);

  const shadowCnt = await page.evaluate(async () => {
    if (!window.__origShadow) window.__origShadow = drawShadow;
    let n = 0;
    drawShadow = function (o) { n++; return window.__origShadow(o); };
    const run = async () => { n = 0; for (let i = 0; i < 4; i++) await new Promise(r => requestAnimationFrame(r)); return n; };
    shadOn = true;  const on = await run();
    shadOn = false; const off = await run();
    drawShadow = window.__origShadow;
    return { on, off };
  });
  ok('陰影開關真的會停掉陰影繪製', shadowCnt.on > 0 && shadowCnt.off === 0,
     '開 ' + shadowCnt.on + ' 次 / 關 ' + shadowCnt.off + ' 次');
  await page.check('#cShad');
  await page.uncheck('#cSfx');
  ok('音效開關會寫進設定', (await st(page)).flags.sfxOn === false);
  await page.check('#cSfx');
  await page.uncheck('#cAuto');
  ok('自動循環開關會寫進設定', (await st(page)).flags.autoLoop === false);

  /* ===================== 視角操作 ===================== */
  head('視角操作');
  await reset(page, { shape: '摩天樓', cnt: 150 });
  const v0 = await st(page);
  await page.mouse.move(VIEW.width / 2, 300);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) { await page.mouse.move(VIEW.width / 2 + i * 18, 300 + i * 6); await page.waitForTimeout(16); }
  await page.mouse.up();
  await page.waitForTimeout(80);
  let v1 = await st(page);
  ok('拖曳會轉視角', Math.abs(v1.yaw - v0.yaw) > 0.3, deg(v0.yaw) + ' → ' + deg(v1.yaw));
  ok('拖曳（位移超過門檻）不會誤觸拍散', v1.phase === 'built', v1.phase);
  ok('俯角有夾住，不會翻過去', v1.pitch > 0.05 && v1.pitch < 1.4, v1.pitch.toFixed(2));

  await page.mouse.move(VIEW.width / 2, 400);
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(120);
  v1 = await st(page);
  ok('滾輪可以縮放', v1.zoom > 1.05, 'camZoom ' + v1.zoom.toFixed(2) + '、dist ' + v1.dist.toFixed(0));
  const zBefore = v1.zoom;
  await page.click('#btnNext');
  await page.waitForTimeout(200);
  v1 = await st(page);
  ok('換建築後保留手動縮放倍率', Math.abs(v1.zoom - zBefore) < 1e-9,
     'camZoom ' + v1.zoom.toFixed(2));
  await page.evaluate(() => { camZoom = 1; applyZoom(); });

  /* 取景：不驗「距離公式」（那是拿實作驗實作），驗使用者真正看到的結果——
     矮胖的、高瘦的、細長的都要完整入鏡，又不能小到看不清 */
  const framing = await page.evaluate(() => {
    if (!window.__origPick) window.__origPick = pickShape;
    const rows = [];
    for (const nm of ['小屋', '摩天樓', '城牆', '高塔', '金字塔', '摩天輪', '拱橋']) {
      const i = SHAPES.findIndex(s => s.n === nm);
      if (i < 0) continue;
      pickShape = () => i; startBuild(true); updateCam();
      const o = [0, 0];
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, off = 0;
      for (const b of blocks) {
        if (b.state !== 'placed') continue;
        if (proj(b.x, b.y, b.z, o) <= 0.4) { off++; continue; }
        x0 = Math.min(x0, o[0]); x1 = Math.max(x1, o[0]);
        y0 = Math.min(y0, o[1]); y1 = Math.max(y1, o[1]);
        if (o[0] < 0 || o[0] > W || o[1] < 0 || o[1] > H) off++;
      }
      rows.push({ n: bp.name, h: +bp.height.toFixed(0), dist: +camBase.toFixed(0), off,
                  fw: +((x1 - x0) / W).toFixed(2), fh: +((y1 - y0) / H).toFixed(2) });
    }
    pickShape = window.__origPick;
    return rows;
  });
  const badFrame = framing.filter(r => r.off > 0 || Math.max(r.fw, r.fh) < 0.30 || r.fw > 0.98 || r.fh > 0.98);
  ok('各種形狀的建築都完整入鏡、又不會小到看不清', badFrame.length === 0,
     badFrame.length
       ? badFrame.map(r => r.n + '：出界 ' + r.off + ' 塊、佔畫面 ' + r.fw + '×' + r.fh).join('　|　')
       : framing.map(r => r.n + ' ' + Math.round(Math.max(r.fw, r.fh) * 100) + '%').join('、'));
  ok('取景距離會隨建築尺寸變（不是固定值）',
     new Set(framing.map(r => r.dist)).size >= 3,
     framing.map(r => r.n + ' dist' + r.dist).join('、'));

  /* 鏡頭呼吸：拍散拉遠、蓋到一半推近 */
  await reset(page, { cnt: 100, wk: 10, sp: 3 });
  const dBuilt = (await st(page)).dist;
  await page.evaluate(() => autoSmash());
  await page.waitForTimeout(1400);
  const dWide = (await st(page)).dist;
  ok('拍散後鏡頭拉遠看整片碎料', dWide > dBuilt * 1.15,
     'dist ' + dBuilt.toFixed(0) + ' → ' + dWide.toFixed(0));
  await until(page, () => phase === 'built', null, 60000);
  await page.waitForTimeout(1600);
  const dBack = (await st(page)).dist;
  ok('蓋完後鏡頭推回建築', dBack < dWide * 0.95, 'dist ' + dWide.toFixed(0) + ' → ' + dBack.toFixed(0));

  /* 點地面 */
  await reset(page, { shape: '小屋', cnt: 100 });
  const groundHit = await page.evaluate(() => {
    /* 找一個確定打不到建築、但射線會落在地面上的螢幕點 */
    const o = [0, 0];
    for (let k = 0; k < 200; k++) {
      const a = Math.random() * Math.PI * 2, r = siteR + 6 + Math.random() * 8;
      if (proj(Math.cos(a) * r, 0.02, Math.sin(a) * r, o) > 0.4 &&
          o[0] > 30 && o[0] < W - 30 && o[1] > 60 && o[1] < H - 120)
        return { x: Math.round(o[0]), y: Math.round(o[1]) };
    }
    return null;
  });
  if (groundHit) {
    await page.mouse.click(groundHit.x, groundHit.y);
    await page.waitForTimeout(90);
    s = await st(page);
    ok('點空地也會震散建築（並揚起塵土）', s.phase === 'debris' && s.partsN > 5,
     '狀態 ' + s.phase + '、粒子 ' + s.partsN);
  } else ok('點空地也會震散建築（並揚起塵土）', false, '找不到可點的空地座標');

  /* ===================== 手機版 ===================== */
  head('手機版 / 觸控');
  const mctx = await browser.newContext({
    viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3,
  });
  const mob = await mctx.newPage();
  const mErr = [];
  mob.on('pageerror', e => mErr.push(String(e.message || e).split('\n')[0]));
  await mob.goto(APP);
  await mob.waitForTimeout(700);
  await mob.evaluate(() => { autoLoop = false; spinOn = false; });
  const ms = await st(mob);
  ok('手機版載入沒有 JS 錯誤', mErr.length === 0, mErr.slice(0, 2).join(' | ') || '無');
  ok('手機版一開始就有建築', ms.phase === 'built' && ms.placed === ms.total,
     ms.name + ' ' + ms.placed + '/' + ms.total);
  ok('高 DPR 下畫布解析度上限是 2×（不會爆記憶體）',
     ms.cw === 390 * 2 && ms.ch === 780 * 2, ms.cw + '×' + ms.ch + '（DPR ' + ms.dpr + '）');
  ok('高 DPR 下 CSS 尺寸沒被放大', ms.cssw === '390px' && ms.cssh === '780px',
     ms.cssw + ' × ' + ms.cssh);
  const mp = await pix(mob);
  ok('手機版畫面有畫出東西', mp.colors > 40, mp.colors + ' 種顏色');
  const mos = await onScreen(mob);
  ok('手機版建築落在畫面內', mos.ratio > 0.9, (mos.ratio * 100).toFixed(0) + '%');
  const ctlBox = await mob.locator('#ctl').boundingBox();
  ok('控制列沒有超出手機畫面',
     ctlBox.x >= -1 && ctlBox.x + ctlBox.width <= 391 && ctlBox.y + ctlBox.height <= 781,
     'x ' + Math.round(ctlBox.x) + '、寬 ' + Math.round(ctlBox.width) + '、底 ' + Math.round(ctlBox.y + ctlBox.height));
  const mAim = await aimTop(mob);
  await mob.touchscreen.tap(mAim.x, mAim.y);
  await mob.waitForTimeout(120);
  ok('觸控輕點可以拍散', (await st(mob)).phase === 'debris');
  await shot(mob, '4-mobile.png');
  await mctx.close();

  /* ===================== 視窗縮放 ===================== */
  head('視窗縮放');
  await page.setViewportSize({ width: 700, height: 500 });
  await page.waitForTimeout(300);
  s = await st(page);
  ok('改變視窗大小後畫布跟著調整',
     s.cw === Math.round(700 * Math.min(2, s.dpr)) && s.cssw === '700px', s.cw + '×' + s.ch + '、CSS ' + s.cssw);
  ok('改變視窗大小不會丟 JS 錯誤', errors.length === 0, errors.slice(0, 2).join(' | ') || '無');
  const sp = await pix(page);
  ok('縮小後畫面仍有內容', sp.colors > 30, sp.colors + ' 種顏色');
  await page.setViewportSize(VIEW);
  await page.waitForTimeout(300);
  ok('放大回來後建築仍在畫面內', (await onScreen(page)).ratio > 0.85);

  /* ===================== 效能 ===================== */
  head('效能');
  await reset(page, { cnt: 400, wk: 10, sp: 1 });
  await page.waitForTimeout(400);
  const perfBuilt = await page.evaluate(() => new Promise(res => {
    const ts = []; let n = 0;
    const f = t => { ts.push(t); if (++n < 70) requestAnimationFrame(f); else res(ts); };
    requestAnimationFrame(f);
  }));
  const dBuiltMs = med(perfBuilt.slice(1).map((t, i) => t - perfBuilt[i]));
  s = await st(page);
  ok('400 塊建材、完工狀態下幀率夠用', dBuiltMs <= 40,
     '中位幀時間 ' + dBuiltMs.toFixed(1) + 'ms（約 ' + (1000 / dBuiltMs).toFixed(0) + 'fps）、繪製 ' + s.drawn + ' 個方塊');
  await page.evaluate(() => autoSmash());
  await page.waitForTimeout(500);
  const perfSmash = await page.evaluate(() => new Promise(res => {
    const ts = []; let n = 0;
    const f = t => { ts.push(t); if (++n < 70) requestAnimationFrame(f); else res(ts); };
    requestAnimationFrame(f);
  }));
  const dSmashMs = med(perfSmash.slice(1).map((t, i) => t - perfSmash[i]));
  ok('400 塊全部在飛、加上塵土時幀率仍夠用', dSmashMs <= 45,
     '中位幀時間 ' + dSmashMs.toFixed(1) + 'ms（約 ' + (1000 / dSmashMs).toFixed(0) + 'fps）、粒子 ' +
     (await st(page)).partsN + ' 顆');
  ok('粒子數量有上限（不會無限累積）', (await st(page)).partsN <= 620,
     (await st(page)).partsN + ' 顆');

  /* ===================== 連續操作壓力 ===================== */
  head('連續操作壓力');
  await reset(page, { cnt: 200, wk: 8, sp: 3 });
  for (let k = 0; k < 6; k++) {
    await page.evaluate(() => { if (phase === 'built') autoSmash(); });
    await page.waitForTimeout(420);            // 不等落定就再拍
  }
  await page.waitForTimeout(1200);
  s = await st(page);
  ok('連續拍散不等落定也不會壞',
     s.nan === 0 && s.under === 0 && s.pool === s.total,
     '池 ' + s.pool + '/' + s.total + '、NaN ' + s.nan);
  for (let k = 0; k < 5; k++) { await page.click('#btnNext'); await page.waitForTimeout(150); }
  s = await st(page);
  ok('連按「換一棟」不會壞', s.phase === 'built' && s.placed === s.total && s.nan === 0,
     s.name + ' ' + s.placed + '/' + s.total);
  await page.evaluate(() => { autoLoop = true; });
  await until(page, () => phase !== 'built', null, 8000);
  ok('自動循環會自己拍散重蓋', (await st(page)).phase !== 'built');

  /* ===================== 收尾 ===================== */
  head('整體');
  ok('全程沒有 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | ') || '無');
  const srcSize = fs.statSync(path.resolve(__dirname, '..', 'block-builders.html')).size;
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'block-builders.html'), 'utf8');
  ok('是單一自足檔案（沒有任何外部資源）',
     !/<(script|link|img)[^>]+(src|href)\s*=\s*["']?(?!#)(https?:|\/\/)/i.test(src),
     Math.round(srcSize / 1024) + 'KB');
  ok('沒有寫入唯讀 DOM 屬性（clientWidth／clientHeight）',
     !/\.\s*client(Width|Height)\s*=/.test(src));

  await browser.close();

  const fail = R.filter(r => !r.pass);
  console.log('\n' + '═'.repeat(52));
  console.log('  ' + (R.length - fail.length) + ' / ' + R.length + ' 通過' +
              (fail.length ? '，' + fail.length + ' 項失敗' : '  ✔'));
  console.log('═'.repeat(52));
  if (fail.length) {
    console.log('失敗項目：');
    fail.forEach(f => console.log('  [' + f.section + '] ' + f.name + (f.detail ? ' :: ' + f.detail : '')));
  }
  console.log('（截圖產物在 ' + path.relative(process.cwd(), OUT) + '）');
  process.exit(fail.length ? 1 : 0);
})().catch(e => {
  console.error('\n腳本本身出錯：', e);
  process.exit(2);
});
