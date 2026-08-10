/* ============================================================
   遊戲層：積木狀態、物理、小人 AI、破壞、主迴圈
   繪製一律透過 ENG（engine.js），藍圖來自 blueprints.js。

   積木的一生：
     FREE（躺在地上的建材）→ CARRY（被小人舉著）→ TOSS（拋向藍圖位置的弧線）
     → SET（就定位，變成建築的一部分）→ 被槌子打到 → FLY（飛出去）→ 落地變回 FREE
   ============================================================ */
'use strict';

/* ── 常數 ───────────────────────────────────────────────── */
const HB = ENG.BS / 2;              // 積木半邊長
const GRAV = 26;                    // 重力
const SPREAD = 2.9;                 // 建材散落區的鬆緊：每塊積木分到幾平方單位
const WALK = 6.8;                   // 小人走路速度
const REACH = 0.9;                  // 走到多近算抵達
const CELL = 1.25;                  // 空間雜湊格子大小（分離碎塊用）

const FREE = 0, CARRY = 1, TOSS = 2, SET = 3, FLY = 4;

/* ── 狀態 ───────────────────────────────────────────────── */
let blocks = [];                    // 積木池
let workers = [];                   // 小人
let trees = [];
let dust = [];
let bp = null;                      // 目前藍圖
let placedCnt = 0;
let slotCursor = 0;
let siteR = 12;                     // 建築占地半徑
let arenaR = 40;                    // 整片工地半徑（建材散落 + 碎塊飛行上限）
let phase = 'build';                // build | done
let buildStart = 0, buildElapsed = 0;
let timeScale = 1;
let targetCnt = 900;
let workerCnt = 20;
let shapePick = -1;                 // -1 = 隨機
let running = true;
let lastT = 0;
let fps = 0;
let recent = [];                    // 最近蓋過的，避免連續重複

const restGrid = new Map();         // 空間雜湊：只放躺在地上的 FREE 積木

const _e = new THREE.Euler();
const _m = new THREE.Matrix4();

const rr = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

/* ── 音效（純合成，不外掛音檔） ───────────────────────────── */
let AC = null, muted = false;
function audio() {
  if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { AC = false; } }
  if (AC && AC.state === 'suspended') AC.resume();
  return AC;
}
function tone(freq, dur, type, vol, slide) {
  const c = audio(); if (!c || muted) return;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type || 'square'; o.frequency.value = freq;
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), c.currentTime + dur);
  g.gain.setValueAtTime(vol || 0.06, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0008, c.currentTime + dur);
  o.connect(g).connect(c.destination); o.start(); o.stop(c.currentTime + dur);
}
function noise(dur, vol, cut) {
  const c = audio(); if (!c || muted) return;
  const n = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = c.createBufferSource(); src.buffer = buf;
  const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cut || 900;
  const g = c.createGain(); g.gain.value = vol || 0.18;
  src.connect(f).connect(g).connect(c.destination); src.start();
}
/* 放置音的音高隨進度往上爬——蓋到最後會有「快完成了」的爽感 */
function sndPlace() { const p = bp ? placedCnt / bp.slots.length : 0; tone(420 + p * 620, 0.06, 'square', 0.045); }
function sndSmash() { noise(0.42, 0.3, 1500); tone(78, 0.36, 'sawtooth', 0.1, 0.35); }
function sndDone() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.22, 'triangle', 0.07), i * 110)); }
function sndFall() { tone(200, 0.16, 'square', 0.05, 0.5); }
function sndSwing() { tone(160, 0.3, 'sine', 0.06, 3.2); }
function sndWind() { noise(1.6, 0.14, 480); }
function sndBadge() { [784, 988, 1319].forEach((f, i) => setTimeout(() => tone(f, 0.18, 'triangle', 0.08), i * 90)); }

/* ── 空間雜湊：讓落地的碎塊不要疊在同一點 ─────────────────── */
const gkey = (x, z) => Math.floor(x / CELL) + ':' + Math.floor(z / CELL);
function gridAdd(b) {
  b.cell = gkey(b.x, b.z);
  let a = restGrid.get(b.cell);
  if (!a) restGrid.set(b.cell, a = []);
  a.push(b);
}
function gridDel(b) {
  const a = restGrid.get(b.cell); if (!a) return;
  const i = a.indexOf(b); if (i >= 0) a.splice(i, 1);
  b.cell = '';
}
function separate(b) {
  for (let it = 0; it < 5; it++) {
    let moved = false;
    const cx = Math.floor(b.x / CELL), cz = Math.floor(b.z / CELL);
    for (let i = -1; i <= 1; i++) for (let k = -1; k <= 1; k++) {
      const a = restGrid.get((cx + i) + ':' + (cz + k)); if (!a) continue;
      for (const o of a) {
        if (o === b) continue;
        let dx = b.x - o.x, dz = b.z - o.z;
        let d = Math.hypot(dx, dz);
        if (d >= ENG.BS) continue;
        if (d < 1e-4) { const ang = Math.random() * Math.PI * 2; dx = Math.cos(ang); dz = Math.sin(ang); d = 1e-4; }
        const push = (ENG.BS - d) * 0.5;
        b.x += dx / d * push; b.z += dz / d * push;
        moved = true;
      }
    }
    if (!moved) break;
  }
}

/* ── 積木 ───────────────────────────────────────────────── */
function newBlock() {
  return {
    st: FREE, x: 0, y: HB, z: 0, vx: 0, vy: 0, vz: 0,
    rx: 0, ry: 0, rz: 0, ax: 0, ay: 0, az: 0,
    r: 0.78, g: 0.74, b: 0.66, tr: 0.78, tg: 0.74, tb: 0.66,
    slot: -1, holder: -1, rest: true, cell: '',
    scale: 1, snap: 0, snapFrom: null, arc: null, wob: 0, al: 1, fallIn: 0
  };
}
/* 旋轉之後，這塊積木沿世界 Y 的半高。躺平是 0.47，立起來轉 45° 是 0.66，
   拿 h/2 當落地高度會讓斜著落定的積木陷進地面。 */
function halfY(b) {
  _e.set(b.rx, b.ry, b.rz);
  _m.makeRotationFromEuler(_e);
  const t = _m.elements;
  return HB * (Math.abs(t[1]) + Math.abs(t[5]) + Math.abs(t[9]));
}

function freeBlock(b) {
  if (b.slot >= 0) {
    // 已就位的被打掉，進度要跟著退回去。
    // 只認 SET：TOSS 中的積木雖然也占著 slot，但還沒計進 placedCnt。
    if (b.st === SET) placedCnt--;
    bp.slots[b.slot].filled = false; bp.slots[b.slot].claimed = -1; b.slot = -1;
  }
  // 不用 indexOf 反查——一次砸掉幾百塊時那是 O(n²)
  if (b.holder >= 0) {
    const w = workers[b.holder];
    if (w && blocks[w.block] === b) { w.block = -1; w.slot = -1; w.carry = false; w.st = 'idle'; }
    b.holder = -1;
  }
  if (b.cell) gridDel(b);
  b.st = FLY; b.rest = false; b.snap = 0; b.arc = null; b.scale = 1;
  b.tr = 0.80; b.tg = 0.76; b.tb = 0.68;
}

/* 碎塊物理：重力 + 地面彈跳 + 落定時轉正 */
function stepBlock(b, dt) {
  if (b.st !== FLY) return;
  b.vy -= GRAV * dt;
  b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
  b.rx += b.ax * dt; b.ry += b.ay * dt; b.rz += b.az * dt;

  const d = Math.hypot(b.x, b.z);
  if (d > arenaR) {                    // 別讓碎塊飛到天邊，撞牆彈回來
    const nx = b.x / d, nz = b.z / d;
    b.x = nx * arenaR; b.z = nz * arenaR;
    const dot = b.vx * nx + b.vz * nz;
    b.vx -= 2 * dot * nx * 0.55; b.vz -= 2 * dot * nz * 0.55;
  }

  const hy = halfY(b);
  if (b.y <= hy) {
    b.y = hy;
    if (b.vy < -2.2) {                 // 還有力氣就彈一下
      b.vy = -b.vy * 0.3;
      b.vx *= 0.66; b.vz *= 0.66;
      b.ax *= 0.5; b.ay *= 0.5; b.az *= 0.5;
      if (Math.random() < 0.22) noise(0.05, 0.03, 2200);
    } else {
      b.vy = 0; b.vx *= 0.82; b.vz *= 0.82;
      b.ax *= 0.7; b.ay *= 0.7; b.az *= 0.7;
      if (Math.hypot(b.vx, b.vz) < 0.55 && Math.abs(b.ax) + Math.abs(b.ay) + Math.abs(b.az) < 1.2)
        startSnap(b);
    }
  }
}
/* 落定：把旋轉緩緩轉到最近的 90 度，看起來才像「擺好了」 */
function startSnap(b) {
  const q = v => Math.round(v / (Math.PI / 2)) * (Math.PI / 2);
  b.snapFrom = { rx: b.rx, ry: b.ry, rz: b.rz, tx: q(b.rx), ty: q(b.ry), tz: q(b.rz) };
  b.snap = 0.0001;
  b.vx = b.vy = b.vz = b.ax = b.ay = b.az = 0;
}
function stepSnap(b, dt) {
  b.snap = Math.min(1, b.snap + dt * 4.5);
  const f = b.snapFrom, k = 1 - Math.pow(1 - b.snap, 3);
  b.rx = f.rx + (f.tx - f.rx) * k;
  b.ry = f.ry + (f.ty - f.ry) * k;
  b.rz = f.rz + (f.tz - f.rz) * k;
  b.y = halfY(b);
  if (b.snap >= 1) {
    b.snap = 0; b.st = FREE; b.rest = true;
    separate(b); gridAdd(b);
  }
}

/* ── 藍圖與積木池 ───────────────────────────────────────── */
function pickShape() {
  if (shapePick >= 0) return shapePick;
  for (let t = 0; t < 40; t++) {
    const i = Math.floor(Math.random() * SHAPES.length);
    if (recent.indexOf(i) < 0) return i;
  }
  return Math.floor(Math.random() * SHAPES.length);
}

function startBuild(instant) {
  /* 順序有講究：先把小人和舊建築解開（他們的 slot 指的是「舊」藍圖），
     再換 bp，最後才調整積木池——反過來做的話，
     reconcilePool 的 splice 會讓 w.block 指到別塊積木上。 */
  for (const w of workers) releaseWorker(w);
  for (const b of blocks) {
    if (b.st === SET || b.st === CARRY || b.st === TOSS) {
      b.slot = -1; b.holder = -1; b.arc = null; b.scale = 1; b.fallIn = 0;
      b.st = FLY; b.rest = false; b.snap = 0;
      b.tr = 0.80; b.tg = 0.76; b.tb = 0.68;
      b.vx = rr(-5, 5); b.vy = rr(1, 6); b.vz = rr(-5, 5);
      b.ax = rr(-6, 6); b.ay = rr(-6, 6); b.az = rr(-6, 6);
    }
  }

  // 正在作用的道具要收掉，不然拆完換新建築時，還在飛的鐵球／龍捲風會繼續砸新的那座
  swing = null; ENG.hideHammer();
  ball = null; ENG.hideBall();
  twist = null; ENG.hideTornado();

  const idx = pickShape();
  recent.push(idx); if (recent.length > 8) recent.shift();
  bp = makeBlueprint(idx, targetCnt);
  placedCnt = 0; slotCursor = 0;
  phase = 'build';
  buildStart = performance.now(); buildElapsed = 0; spentThis = 0;

  siteR = Math.max(7, bp.radius);
  // 建材散落區從工地邊緣往外鋪，面積跟積木數成正比 → 不管 300 塊還 3000 塊都一樣鬆
  arenaR = Math.sqrt((siteR + 2) ** 2 + SPREAD * bp.slots.length / Math.PI) + 8;
  reconcilePool();

  // 之前落定的碎塊如果卡在新工地範圍內，小人會走不進去、建築會長在碎料裡
  for (const b of blocks)
    if (b.st === FREE && Math.hypot(b.x, b.z) < siteR + 1.4) kickOut(b);

  makeTrees();
  ENG.fitCamera(siteR, bp.height, arenaR, !!instant);
  syncHud();
}

/* 直接把整座蓋好。開場用——一進來就有一座完整的建築可以砸，
   不用先盯著小人搬十分鐘才有東西玩。 */
function completeNow() {
  for (let i = 0; i < bp.slots.length && i < blocks.length; i++) {
    const s = bp.slots[i], b = blocks[i];
    if (b.cell) gridDel(b);
    b.st = SET; b.slot = i; b.x = s.x; b.y = s.y + HB; b.z = s.z;
    b.rx = b.ry = b.rz = 0; b.scale = 1; b.al = 1; b.holder = -1; b.snap = 0; b.fallIn = 0;
    b.vx = b.vy = b.vz = b.ax = b.ay = b.az = 0;
    const pal = bp.pal[s.c % bp.pal.length];
    b.r = b.tr = ((pal >> 16) & 255) / 255;
    b.g = b.tg = ((pal >> 8) & 255) / 255;
    b.b = b.tb = (pal & 255) / 255;
    s.filled = true; s.claimed = -1;
  }
  for (let i = bp.slots.length; i < blocks.length; i++) {     // 多的積木壓成靜止的散料
    const b = blocks[i];
    b.st = FREE; b.slot = -1; b.holder = -1; b.snap = 0; b.rest = true;
    b.vx = b.vy = b.vz = b.ax = b.ay = b.az = 0;
    if (!b.cell) gridAdd(b);
  }
  for (const w of workers) releaseWorker(w);
  placedCnt = bp.slots.length;
  phase = 'done';
  buildElapsed = 0; spentThis = 0;
  syncHud();
}

function kickOut(b) {
  if (b.cell) gridDel(b);
  const d = Math.hypot(b.x, b.z);
  const a = d < 0.001 ? Math.random() * Math.PI * 2 : Math.atan2(b.z, b.x);
  const s = rr(5, 9);
  b.st = FLY; b.rest = false; b.snap = 0;
  b.vx = Math.cos(a) * s; b.vz = Math.sin(a) * s; b.vy = rr(3.5, 7);
  b.ax = rr(-4, 4); b.ay = rr(-4, 4); b.az = rr(-4, 4);
}

/* 積木不夠就補、太多就收掉。
   補的建材鋪成工地外圍一整圈，不集中成一堆料場——
   料場如果剛好在相機背後，玩家會覺得「建材呢？」（第一版就是這樣）。 */
function reconcilePool() {
  const need = Math.min(ENG.MAXB, bp.slots.length);
  const add = need - blocks.length;
  if (add > 0) {
    const r0 = siteR + 2.5;
    for (let i = 0; i < add; i++) {
      const b = newBlock();
      const a = Math.random() * Math.PI * 2;
      // 半徑取平方根分布，密度才會均勻（直接均勻取半徑會全擠在內圈）
      const rad = Math.sqrt(r0 * r0 + Math.random() * (arenaR * arenaR - r0 * r0));
      b.x = Math.cos(a) * rad; b.z = Math.sin(a) * rad;
      b.y = HB; b.al = 0;
      b.ry = Math.floor(Math.random() * 4) * Math.PI / 2;
      const t = rr(0.72, 0.86);
      b.r = b.tr = t; b.g = b.tg = t * 0.95; b.b = b.tb = t * 0.86;
      blocks.push(b);
      separate(b); gridAdd(b);
    }
  } else if (add < 0) {
    let drop = -add;
    for (let i = blocks.length - 1; i >= 0 && drop > 0; i--) {
      const b = blocks[i];
      // FLY 的也可以收——這時候剛解開完舊建築，飛在半空的碎塊沒有主人。
      // 只認 FREE 的話，從 3000 塊換到 400 塊時會有兩千多塊永遠收不掉。
      if (b.st !== FREE && b.st !== FLY) continue;
      if (b.cell) gridDel(b);
      blocks.splice(i, 1); drop--;
    }
  }
  ENG.setBlockCount(blocks.length);
}

/* ── 小人 ───────────────────────────────────────────────── */
function newWorker(i) {
  const a = Math.random() * Math.PI * 2, d = siteR + rr(3, 9);
  return {
    x: Math.cos(a) * d, y: 0, z: Math.sin(a) * d, a: 0, ph: Math.random() * 6, gait: 0,
    tone: i, st: 'idle', block: -1, slot: -1, tx: 0, tz: 0,
    wait: 0, fall: 0, tilt: 0, carry: false, cheer: 0, scale: rr(0.92, 1.08)
  };
}
function setWorkerCount(n) {
  n = clamp(Math.round(n), 1, ENG.MAXW);
  while (workers.length < n) workers.push(newWorker(workers.length));
  while (workers.length > n) { releaseWorker(workers[workers.length - 1]); workers.pop(); }
  workerCnt = n;
  ENG.setWorkerCount(workers.length);
}
function releaseWorker(w) {
  if (w.block >= 0) {
    const b = blocks[w.block];
    if (b && (b.st === CARRY || b.st === TOSS)) { b.holder = -1; freeBlock(b); b.vy = 2; }
    else if (b) b.holder = -1;
  }
  if (w.slot >= 0 && bp && bp.slots[w.slot]) {
    bp.slots[w.slot].claimed = -1;
    slotCursor = Math.min(slotCursor, w.slot);
  }
  w.block = -1; w.slot = -1; w.carry = false; w.st = 'idle';
}

function findSlot() {
  while (slotCursor < bp.slots.length &&
         (bp.slots[slotCursor].filled || bp.slots[slotCursor].claimed >= 0)) slotCursor++;
  if (slotCursor >= bp.slots.length) {
    // 游標到底不代表蓋完了：中途被打掉的洞在游標後面，從頭掃一次補起來
    for (let i = 0; i < bp.slots.length; i++)
      if (!bp.slots[i].filled && bp.slots[i].claimed < 0) return i;
    return -1;
  }
  return slotCursor;
}
function findBlock(wx, wz) {
  let best = -1, bd = Infinity;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.st !== FREE || !b.rest || b.holder >= 0) continue;
    const d = (b.x - wx) ** 2 + (b.z - wz) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
/* 放置時小人站的位置：從工地中心往外推，站在建築外圈才不會卡進牆裡 */
function standPos(s) {
  const d = Math.hypot(s.x, s.z);
  const r = Math.max(1.5, d + 1.3);
  if (d < 0.001) return { x: r, z: 0 };
  return { x: s.x / d * r, z: s.z / d * r };
}
function walkTo(w, dt) {
  const dx = w.tx - w.x, dz = w.tz - w.z;
  const d = Math.hypot(dx, dz);
  if (d < REACH) { w.gait += (0 - w.gait) * Math.min(1, dt * 8); return true; }
  const sp = WALK * dt;
  w.x += dx / d * Math.min(sp, d); w.z += dz / d * Math.min(sp, d);
  w.a = Math.atan2(dx, dz);
  w.ph += dt * 11;
  w.gait += (0.85 - w.gait) * Math.min(1, dt * 8);
  return false;
}

function updWorker(w, wi, dt) {
  if (w.fall > 0) {                                   // 被震倒／被戳倒
    w.fall -= dt;
    w.tilt += (Math.PI * 0.44 - w.tilt) * Math.min(1, dt * 9);
    w.gait += (0 - w.gait) * Math.min(1, dt * 6);
    if (w.fall <= 0) w.st = 'idle';
    return;
  }
  w.tilt += (0 - w.tilt) * Math.min(1, dt * 7);

  if (phase === 'wreck') {
    // 拆除中：不修、不蓋，躲遠一點看你拆。要等這座拆完換新藍圖才會回去工作
    w.cheer = 0;
    const d = Math.hypot(w.x, w.z);
    if (d < arenaR * 0.62) {
      const a = d < 0.01 ? Math.random() * Math.PI * 2 : Math.atan2(w.z, w.x);
      w.tx = Math.cos(a) * arenaR * 0.78; w.tz = Math.sin(a) * arenaR * 0.78;
    }
    if (walkTo(w, dt)) {
      const a = Math.random() * Math.PI * 2, r2 = arenaR * rr(0.6, 0.85);
      w.tx = Math.cos(a) * r2; w.tz = Math.sin(a) * r2;
    }
    w.y += (0 - w.y) * Math.min(1, dt * 6);
    return;
  }

  if (phase === 'done') {                             // 蓋完了，繞著建築慶祝
    w.cheer += dt;
    if (w.cheer < 7) {
      const ang = Math.atan2(w.z, w.x) + dt * 1.15;
      const rad = siteR + 2.6;
      w.tx = Math.cos(ang) * rad; w.tz = Math.sin(ang) * rad;
      walkTo(w, dt);
      w.y = Math.abs(Math.sin(w.ph * 0.9)) * 0.28;    // 邊跑邊跳
    } else {
      w.y += (0 - w.y) * Math.min(1, dt * 6);
      if (walkTo(w, dt)) {
        const a = Math.random() * Math.PI * 2, d = siteR + rr(2, 12);
        w.tx = Math.cos(a) * d; w.tz = Math.sin(a) * d;
      }
    }
    return;
  }
  w.y += (0 - w.y) * Math.min(1, dt * 6);
  w.cheer = 0;

  switch (w.st) {
    case 'idle': {
      const s = findSlot();
      if (s < 0) { wander(w, dt); return; }
      const bi = findBlock(w.x, w.z);
      if (bi < 0) { wander(w, dt); return; }
      bp.slots[s].claimed = wi;
      blocks[bi].holder = wi;
      w.slot = s; w.block = bi; w.st = 'pick';
      w.tx = blocks[bi].x; w.tz = blocks[bi].z;
      break;
    }
    case 'pick': {
      const b = blocks[w.block];
      if (!b || b.st !== FREE) { releaseWorker(w); return; }
      w.tx = b.x; w.tz = b.z;
      if (walkTo(w, dt)) {
        if (b.cell) gridDel(b);
        b.st = CARRY; b.rest = false; w.carry = true; stats.carried++;
        carryPose(w, b);                              // 立刻舉起來，不然有一幀還黏在地上
        const st = standPos(bp.slots[w.slot]);
        w.tx = st.x; w.tz = st.z; w.st = 'build';
      }
      break;
    }
    case 'build': {
      const b = blocks[w.block];
      if (!b || b.st !== CARRY) { releaseWorker(w); return; }
      carryPose(w, b);
      if (walkTo(w, dt)) {
        const s = bp.slots[w.slot];
        w.a = Math.atan2(-w.x, -w.z);                 // 面向建築再丟
        b.st = TOSS;
        b.arc = {
          t: 0, dur: 0.34 + Math.hypot(s.x - w.x, s.z - w.z) * 0.02 + s.y * 0.012,
          x0: b.x, y0: b.y, z0: b.z, x1: s.x, y1: s.y + HB, z1: s.z,
          peak: Math.max(1.6, (s.y + HB - b.y) * 0.45 + 1.8)
        };
        const pal = bp.pal[s.c % bp.pal.length];
        b.tr = ((pal >> 16) & 255) / 255; b.tg = ((pal >> 8) & 255) / 255; b.tb = (pal & 255) / 255;
        b.slot = w.slot;
        w.carry = false; w.st = 'wait'; w.wait = 0.28;
      }
      break;
    }
    case 'wait':
      w.gait += (0 - w.gait) * Math.min(1, dt * 8);
      w.wait -= dt;
      if (w.wait <= 0) { w.block = -1; w.slot = -1; w.st = 'idle'; }
      break;
  }
}
/* 搬運姿勢：建材舉在頭頂上方，隨腳步微幅晃動 */
function carryPose(w, b) {
  b.x = w.x + Math.sin(w.a) * 0.05;
  b.z = w.z + Math.cos(w.a) * 0.05;
  b.y = 1.45 + Math.abs(Math.sin(w.ph)) * 0.05;
  b.rx += (0 - b.rx) * 0.2; b.rz += (0 - b.rz) * 0.2;
}
function wander(w, dt) {
  if (walkTo(w, dt)) {
    const a = Math.random() * Math.PI * 2, d = siteR + rr(2, 9);
    w.tx = Math.cos(a) * d; w.tz = Math.sin(a) * d;
  }
}
/* 拋物線飛向藍圖位置。到頂就定位，slot 標記填好 */
function stepToss(b, dt) {
  const a = b.arc;
  a.t += dt / a.dur;
  const t = Math.min(1, a.t);
  b.x = a.x0 + (a.x1 - a.x0) * t;
  b.z = a.z0 + (a.z1 - a.z0) * t;
  b.y = a.y0 + (a.y1 - a.y0) * t + Math.sin(t * Math.PI) * a.peak;
  b.rx += dt * 5; b.ry += dt * 3.5;
  if (t >= 1) {
    b.st = SET; b.arc = null; b.rest = true;
    b.x = a.x1; b.y = a.y1; b.z = a.z1;
    b.rx = b.ry = b.rz = 0;
    b.scale = 1.22;                       // 落定彈一下
    bp.slots[b.slot].filled = true;
    bp.slots[b.slot].claimed = -1;
    placedCnt++;
    sndPlace();
    if (placedCnt >= bp.slots.length && phase === 'build') {
      phase = 'done';
      buildElapsed = (performance.now() - buildStart) / 1000;
      for (const w of workers) w.cheer = 0;
      sndDone();
      toast('🎉 ' + bp.name + ' 完工', fmtDur(buildElapsed) + '　人力 ' + money(spentThis));
      noteBuilt();
    }
  }
}

/* ── 紀錄 · 成就 · 存檔 ───────────────────────────────── */
const WRECK_AT = 0.25;              // 剩下不到這個比例就算拆完了，換下一座
const WAGE = 3;                     // 每個小人每秒的人力成本（$）
const SAVE_KEY = 'block-builders/save1';
const SAVE_MAGIC = 'BB1';
const SAVE_XOR = 'winton-block-builders-2026';

const freshStats = () => ({
  destroyed: 0, smashed: 0, carried: 0, poked: 0, spent: 0,
  bestHit: 0, miracle: false, built: [], badges: []
});
let stats = freshStats();
/* 面板上的設定也一起存，不然每次打開都要重調一輪 */
const freshPref = () => ({ cnt: 900, wk: 20, spd: 1, mute: false, spin: false });
let pref = freshPref();
let spentThis = 0;
let savable = true;                 // 無痕模式之類的存不了，就安靜降級

const BADGES = [
  { id: 'first', n: '開工大吉', d: '蓋完第一座建築', chk: s => s.built.length >= 1 },
  { id: 'demo50', n: '拆遷大隊', d: '一次擊飛超過 50 塊積木', chk: s => s.bestHit > 50 },
  { id: 'boss20', n: '工頭嚴厲', d: '戳倒小人 20 次', chk: s => s.poked >= 20 },
  { id: 'miracle', n: '奇蹟工程', d: '3 分鐘內蓋完吉薩金字塔', chk: s => !!s.miracle },
  { id: 'wreck5', n: '拆屋大亨', d: '拆掉 5 座建築', chk: s => s.destroyed >= 5 },
  { id: 'move10k', n: '愚公移山', d: '小人累計搬運 10000 塊', chk: s => s.carried >= 10000 },
  { id: 'world10', n: '環遊世界', d: '蓋過 10 種不同地標', chk: s => s.built.length >= 10 },
  { id: 'million', n: '百萬工程', d: '累計人力支出破 $1,000,000', chk: s => s.spent >= 1e6 }
];

let toasts = [];
function toast(txt, sub) {
  toasts.push({ txt, sub: sub || '', t: 4 });
  if (toasts.length > 3) toasts.shift();
  renderToasts();
}
function checkBadges() {
  let got = false;
  for (const b of BADGES) {
    if (stats.badges.indexOf(b.id) >= 0) continue;
    if (!b.chk(stats)) continue;
    stats.badges.push(b.id);
    toast('🏅 ' + b.n, b.d);
    got = true;
  }
  if (got) { sndBadge(); save(); renderBadges(); }
  return got;
}
function noteBuilt() {
  if (!bp) return;
  if (stats.built.indexOf(bp.name) < 0) stats.built.push(bp.name);
  if (bp.name === '吉薩金字塔' && buildElapsed > 0 && buildElapsed <= 180) stats.miracle = true;
  checkBadges();
  save();
}

/* 存檔：JSON → 校驗碼 → UTF-8 → XOR → base64。
   不是真的加密（前端沒有真加密可言），目的是讓存檔不能隨手改，
   改壞了校驗碼對不上就當作沒有存檔，不會讓程式吃到爛資料。 */
function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
function xorBytes(bytes) {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] ^ SAVE_XOR.charCodeAt(i % SAVE_XOR.length);
  return out;
}
function packSave(obj) {
  const body = JSON.stringify(obj);
  const bytes = xorBytes(new TextEncoder().encode(SAVE_MAGIC + '|' + hashStr(body) + '|' + body));
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function unpackSave(txt) {
  const bin = atob(txt);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const raw = new TextDecoder().decode(xorBytes(bytes));
  const p = raw.split('|');
  if (p[0] !== SAVE_MAGIC) return null;
  const body = p.slice(2).join('|');
  if (hashStr(body) !== p[1]) return null;      // 被動過手腳
  return JSON.parse(body);
}
let saveT = 0;
/* 只把存檔裡型別對得上的欄位搬過來，其他一律用預設值。
   這樣舊版存檔、被改過的存檔都不會讓程式吃到奇怪的東西。 */
function merge(fresh, src) {
  const out = fresh;
  if (src) for (const k in out) if (src[k] !== undefined && typeof src[k] === typeof out[k]) out[k] = src[k];
  return out;
}
function save() {
  if (!savable) return;
  try { localStorage.setItem(SAVE_KEY, packSave({ s: stats, p: pref })); }
  catch (e) { savable = false; }
}
function load() {
  try {
    const txt = localStorage.getItem(SAVE_KEY);
    if (!txt) return;
    const o = unpackSave(txt);
    if (!o || !o.s) return;
    const f = merge(freshStats(), o.s);
    f.badges = f.badges.filter(id => BADGES.some(b => b.id === id));
    stats = f;
    const g = merge(freshPref(), o.p);
    // 數值一律夾回合法範圍，免得存檔壞掉時 slider 跑到界外
    g.cnt = clamp(Math.round(g.cnt), 300, 3000);
    g.wk = clamp(Math.round(g.wk), 1, ENG.MAXW);
    g.spd = clamp(g.spd, 0.2, 4);
    pref = g;
  } catch (e) { savable = false; }
}
/* 把存回來的設定套進變數與面板 */
function applyPref() {
  targetCnt = pref.cnt; timeScale = pref.spd; muted = pref.mute; spinOn = pref.spin;
  setWorkerCount(pref.wk);
  $('cnt').value = String(pref.cnt);
  $('wk').value = String(pref.wk);
  $('spd').value = String(pref.spd);
  $('mute').checked = pref.mute;
  $('spin').checked = pref.spin;
  syncHud();
}
function resetSave() {
  stats = freshStats(); spentThis = 0;
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* 存不了就算了 */ }
  renderBadges(); renderTools(); syncHud();
}

/* ── 破壞道具 ─────────────────────────────────────────────
   三種都走同一個出口 breakBlock()，差別只在「哪些積木被選中、給什麼速度」。 */
const TOOLS = [
  { id: 'hammer', n: '槌子', k: '🔨', tip: '點建築：點狀衝擊', lock: null },
  { id: 'ball', n: '保齡球', k: '🎳', tip: '點建築：保齡球滾過去撞',
    lock: { txt: '拆掉 3 座建築解鎖', ok: () => stats.destroyed >= 3 } },
  { id: 'tornado', n: '龍捲風', k: '🌪', tip: '點地面：龍捲風掃過去',
    lock: { txt: '累計擊飛 1000 塊解鎖', ok: () => stats.smashed >= 1000 } }
];
const toolOk = t => !t.lock || t.lock.ok();
let tool = 'hammer';

let hammerR = 5.5, hammerPow = 15;
let swing = null;     // 正在揮下去的槌子
let ball = null;      // 飛行中的鐵球
let twist = null;     // 作用中的龍捲風

function breakBlock(b, vx, vy, vz) {
  freeBlock(b);
  b.fallIn = 0;
  b.vx = vx; b.vy = vy; b.vz = vz;
  b.ax = rr(-9, 9); b.ay = rr(-9, 9); b.az = rr(-9, 9);
}

/* ── 垮塌 ───────────────────────────────────────────────
   把下面打掉，上面連不到地面的部分要跟著垮。
   做法是從地面那一層做連通性搜尋，走不到的就鬆脫。

   兩個要小心的地方：
   1. 只處理 anchor 的格子。有些藍圖本身就有懸空部件（風車扇葉），
      那些不是被打壞才浮著的，不該掉。
   2. 施工中「已被小人認領、正在路上」的格子也算存在。
      不然施工前緣一定有洞，剛放上去的積木會被自己的判定打下來。 */
let supportDirty = false, supportT = 0;
function markSupportDirty(delay) {
  supportDirty = true;
  supportT = delay === undefined ? 0.08 : delay;
}
function collapseUnsupported() {
  if (!bp || !bp.at) return 0;
  const S = bp.slots, n = S.length;
  const here = i => S[i].filled || S[i].claimed >= 0;
  const seen = new Uint8Array(n);
  const stack = [];
  for (let i = 0; i < n; i++) if (S[i].gy === 0 && here(i)) { seen[i] = 1; stack.push(i); }
  while (stack.length) {
    const s = S[stack.pop()];
    for (let k = 0; k < NBR.length; k++) {
      const d = NBR[k];
      const j = bp.at.get(gkeyOf(s.gx + d[0], s.gy + d[1], s.gz + d[2]));
      if (j === undefined || seen[j] || !here(j)) continue;
      seen[j] = 1; stack.push(j);
    }
  }
  const owner = new Int32Array(n).fill(-1);
  for (let k = 0; k < blocks.length; k++) {
    const b = blocks[k];
    if (b.st === SET && b.slot >= 0) owner[b.slot] = k;
  }
  const drop = i => {
    const k = owner[i];
    if (k < 0) return 0;
    const b = blocks[k];
    if (b.fallIn > 0) return 0;
    // 越高的越晚鬆脫，垮下來才有由下往上的層次，不是整團同時消失
    b.fallIn = 0.02 + S[i].gy * 0.012 + Math.random() * 0.06;
    return 1;
  };

  let fell = 0;
  for (let i = 0; i < n; i++) if (S[i].anchor && !seen[i]) fell += drop(i);

  /* 懸空部件（扇葉、車廂、堆疊的塔節）本來就不連到地面，靠旁邊的結構撐著。
     旁邊撐著它的格子被打掉四分之三以上，這一組就整組掉下來。

     這裡從「全部先當作沒支撐」開始往上長，而不是「全部先當作站著」再往下拆。
     方向反過來的話，兩組互相當對方靠山的懸空部件（例如 101 疊起來的八節）
     會形成循環支撐，誰都不會倒——實測整座塔只掉了底座、上面 733 塊卡在半空。 */
  const F = bp.floats;
  if (F && F.length) {
    const standing = new Uint8Array(F.length);
    const supported = i => {
      if (!here(i)) return false;
      const s = S[i];
      return s.anchor ? !!seen[i] : (s.fg >= 0 ? !!standing[s.fg] : true);
    };
    let changed = true;
    while (changed) {
      changed = false;
      for (let gi = 0; gi < F.length; gi++) {
        if (standing[gi]) continue;
        const g = F[gi];
        if (!g.props.length) { standing[gi] = 1; changed = true; continue; }  // 找不到靠山的永遠豁免
        let alive = 0;
        for (let k = 0; k < g.props.length; k++) if (supported(g.props[k])) alive++;
        if (alive > g.props.length * 0.25) { standing[gi] = 1; changed = true; }
      }
    }
    for (let gi = 0; gi < F.length; gi++) {
      if (standing[gi]) continue;
      const cells = F[gi].cells;
      for (let k = 0; k < cells.length; k++) fell += drop(cells[k]);
    }
  }
  return fell;
}
/* 每次造成破壞後的共通處理：計數、嚇小人、判斷這座是不是拆完了 */
function afterHit(n, point, R) {
  if (n <= 0) return;
  stats.smashed += n;
  if (n > stats.bestHit) stats.bestHit = n;
  if (phase === 'done') phase = 'wreck';        // 完工的建築被動到 → 進入拆除中
  for (const w of workers) {
    if (Math.hypot(w.x - point.x, w.z - point.z) < R * 1.7 && w.fall <= 0) {
      w.fall = rr(1.1, 2.3); releaseWorker(w); sndFall();
    }
  }
  shakeTrees(point, R);
  markSupportDirty();
  checkBadges();
}

/* 槌子：點狀衝擊。只有衝擊球內的積木會散，球外的原封不動；
   方向來自滑鼠射線，所以從上面砸跟從側面砸，塌的方式不一樣。 */
function smash(point, dir) {
  const R = hammerR, R2 = R * R;
  let hitN = 0;
  for (const b of blocks) {
    if (b.st !== SET) continue;
    const dx = b.x - point.x, dy = b.y - point.y, dz = b.z - point.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 <= R2) {
      const d = Math.sqrt(d2);
      const f = Math.pow(1 - d / R, 0.65) * hammerPow;
      const ol = Math.max(0.4, d);
      // 六成沿著揮擊方向、四成沿著離衝擊點的徑向——才有「往那個方向被打飛」的感覺
      breakBlock(b,
        (dir.x * 0.62 + dx / ol * 0.55) * f + rr(-1.4, 1.4),
        (dir.y * 0.32 + dy / ol * 0.62) * f + rr(2.2, 6.2),
        (dir.z * 0.62 + dz / ol * 0.55) * f + rr(-1.4, 1.4));
      hitN++;
    } else if (d2 <= R2 * 3.4) {
      b.wob = 0.5;                        // 波及範圍：只是晃一下，不脫落
    }
  }
  afterHit(hitN, point, R);
  spawnDust(point, R, hitN);
  spawnRing(point, R);
  ENG.shake(0.42 + Math.min(1.4, hitN * 0.02));
  sndSmash();
  return hitN;
}

/* 揮槌：槌子沿著你的視線方向砸下去，槌頭碰到的那一刻才真的造成破壞。
   直接在按下的瞬間就把積木打飛的話，畫面上什麼都沒發生就散了，完全沒有打擊感。 */
const SWING_DOWN = 0.19, SWING_BACK = 0.34;
const SWING_ARM = 9, SWING_ANG = 2.15;
let swingSide = 1;
function launchHammer(point, dir) {
  if (swing && !swing.hit) resolveSwing();        // 連點時先把上一槌結算掉，不要吃掉那一擊
  /* 側揮：揮動平面取「螢幕右方 × 世界上方」，弧線正對著鏡頭掃過來。
     沿著視線方向直直砸下去的話，槌子從頭到尾都是端面朝你，看不出那是一支槌子。 */
  let rx = -dir.z, rz = dir.x;
  const rl = Math.hypot(rx, rz);
  if (rl < 1e-4) { rx = 1; rz = 0; } else { rx /= rl; rz /= rl; }
  swingSide = -swingSide;                          // 左右輪流，連續砸才不會每次都同一邊
  swing = { px: point.x, py: point.y, pz: point.z,
            dx: dir.x, dy: dir.y, dz: dir.z,
            rx: rx * swingSide, rz: rz * swingSide, t: 0, hit: false };
  sndSwing();
}
function resolveSwing() {
  if (!swing || swing.hit) return 0;
  swing.hit = true;
  return smash({ x: swing.px, y: swing.py, z: swing.pz },
               { x: swing.dx, y: swing.dy, z: swing.dz });
}
function stepSwing(dt) {
  if (!swing) return;
  const s = swing;
  s.t += dt;
  if (!s.hit && s.t >= SWING_DOWN) resolveSwing();
  if (s.t >= SWING_DOWN + SWING_BACK) { swing = null; ENG.hideHammer(); return; }
  // 掃過的角度：從側上方掃到 0（＝落點正上方落下），命中後再盪回去一些
  const k = s.t < SWING_DOWN
    ? 1 - Math.pow(s.t / SWING_DOWN, 1.7)          // 越接近落點越快
    : Math.pow((s.t - SWING_DOWN) / SWING_BACK, 0.6) * 0.7;
  const th = k * SWING_ANG, st = Math.sin(th), ct = Math.cos(th);
  /* 支點在落點正上方 SWING_ARM，槌頭繞著支點掃；th=0 時槌頭剛好落在落點上。
     槌柄方向就是「支點 → 槌頭」。 */
  const hx = s.px + SWING_ARM * st * s.rx;
  const hy = s.py + SWING_ARM * (1 - ct);
  const hz = s.pz + SWING_ARM * st * s.rz;
  ENG.setHammer(hx, hy, hz, hx + st * s.rx, hy - ct, hz + st * s.rz, 0);
}

/* 保齡球：貼著地面從場外滾進來，把沿路的東西撞飛。
   撞掉越多減速越多，滾不動就停下。滾在地面而不是飛在半空，
   剛好會先把建築的底部掏空——上面的部分接著就靠垮塌判定自己塌下來。 */
const BALL_R = 3.1;
function launchBall(point, dir) {
  let dx = dir.x, dz = dir.z;                    // 只取水平方向，球是在地上滾的
  const l = Math.hypot(dx, dz);
  if (l < 1e-4) { dx = 1; dz = 0; } else { dx /= l; dz /= l; }
  const back = siteR + 16;                       // 起點推到建築外圍，免得直接生在牆裡
  ball = {
    x: point.x - dx * back, y: BALL_R, z: point.z - dz * back,
    vx: dx * 34, vz: dz * 34, r: BALL_R, ang: 0, hit: 0, life: 6
  };
  sndSwing();
}
function stepBall(dt) {
  if (!ball) return;
  const o = ball;
  o.life -= dt;
  o.x += o.vx * dt; o.z += o.vz * dt; o.y = o.r;
  let sp = Math.hypot(o.vx, o.vz);
  o.ang += sp / o.r * dt;                        // 滾動角度：走多遠就轉多少
  const R = o.r + 0.7, R2 = R * R;
  let n = 0;
  for (const b of blocks) {
    if (b.st !== SET && b.st !== FREE) continue;
    const dx = b.x - o.x, dy = b.y - o.y, dz = b.z - o.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > R2) { if (b.st === SET && d2 < R2 * 2.6) b.wob = 0.4; continue; }
    const d = Math.max(0.4, Math.sqrt(d2));
    const wasSet = b.st === SET;
    breakBlock(b,
      o.vx * 0.5 + dx / d * 7 + rr(-2, 2),
      Math.max(3, sp * 0.26) + dy / d * 3 + rr(1, 5),
      o.vz * 0.5 + dz / d * 7 + rr(-2, 2));
    if (wasSet) n++;                             // 地上的散料被撞開不算破壞
  }
  if (n) {
    o.hit += n;
    afterHit(n, { x: o.x, y: o.y, z: o.z }, R);
    spawnDust({ x: o.x, y: o.y, z: o.z }, R, n);
    ENG.shake(0.28 + Math.min(1, n * 0.02));
    if (Math.random() < 0.4) sndSmash();
    const brake = Math.max(0.3, 1 - n * 0.006);  // 撞越多掉速越快
    o.vx *= brake; o.vz *= brake;
  }
  const roll = Math.pow(0.82, dt);               // 滾動阻力
  o.vx *= roll; o.vz *= roll;
  sp = Math.hypot(o.vx, o.vz);

  if (sp < 4.5 || o.life <= 0 || Math.hypot(o.x, o.z) > arenaR + 6) {
    spawnRing({ x: o.x, y: 0, z: o.z }, 5);
    ball = null; ENG.hideBall();
  } else {
    // 滾動軸：水平、垂直於前進方向。方向弄反的話球會像倒著滾
    ENG.setBall(o.x, o.y, o.z, o.r, o.vz / sp, -o.vx / sp, o.ang);
  }
}

/* 龍捲風：在地面走一段路，把沿路的積木吸起來繞圈，最後隨機甩出去 */
function launchTornado(point) {
  const a = Math.atan2(-point.z, -point.x);        // 大致朝著工地中心掃過去
  twist = {
    x: point.x, z: point.z, r: 6, h: 20, life: 5.5,
    spin: 0, vx: Math.cos(a) * 3.2, vz: Math.sin(a) * 3.2, hit: 0
  };
  sndWind();
}
function stepTwist(dt) {
  if (!twist) return;
  twist.life -= dt;
  twist.spin += dt * 7;
  twist.x += twist.vx * dt; twist.z += twist.vz * dt;
  // 每隔一陣子換個方向，走起來才像亂竄而不是直線
  twist.vx += rr(-6, 6) * dt; twist.vz += rr(-6, 6) * dt;
  const sp = Math.hypot(twist.vx, twist.vz);
  if (sp > 6) { twist.vx = twist.vx / sp * 6; twist.vz = twist.vz / sp * 6; }
  if (Math.hypot(twist.x, twist.z) > arenaR) { twist.vx *= -1; twist.vz *= -1; }

  const R = twist.r, R2 = R * R;
  let n = 0;
  for (const b of blocks) {
    if (b.st === CARRY || b.st === TOSS) continue;
    const dx = b.x - twist.x, dz = b.z - twist.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > R2 || b.y > twist.h) continue;
    const d = Math.max(0.5, Math.sqrt(d2));
    // 切線方向繞圈 + 往內吸 + 往上捲
    const tx = -dz / d, tz = dx / d;
    const pull = (1 - d / R);
    if (b.st === SET) { breakBlock(b, 0, 0, 0); n++; }
    if (b.st === FREE) { if (b.cell) gridDel(b); b.st = FLY; b.rest = false; b.snap = 0; }
    b.vx += (tx * 26 + -dx / d * 10) * pull * dt * 3;
    b.vz += (tz * 26 + -dz / d * 10) * pull * dt * 3;
    b.vy += (16 + 30 * pull) * dt * 3;
    b.ax += rr(-30, 30) * dt; b.ay += rr(-30, 30) * dt; b.az += rr(-30, 30) * dt;
  }
  if (n) {
    twist.hit += n;
    afterHit(n, { x: twist.x, y: 2, z: twist.z }, R * 0.6);
  }
  spawnTwistDust(twist, dt);
  /* 這裡刻意不做畫面震動。龍捲風會持續好幾秒，每幀都加一點震動的話
     畫面就一路晃到結束，看久了很不舒服——震動留給槌子、保齡球那種單次撞擊。 */
  if (twist.life <= 0) { twist = null; ENG.hideTornado(); }
  else ENG.setTornado(twist.x, twist.z, twist.r * 0.9, twist.h, twist.spin);
}

/* 玩家在畫面上點一下的入口。tool 決定用哪個道具 */
function useTool(hit) {
  if (tool === 'hammer') { launchHammer(hit.point, hit.dir); return 0; }
  if (tool === 'ball') { launchBall(hit.point, hit.dir); return 0; }
  if (tool === 'tornado') { launchTornado({ x: hit.point.x, z: hit.point.z }); return 0; }
  return 0;
}

function spawnDust(p, R, n) {
  const count = Math.min(90, 22 + n);
  for (let i = 0; i < count; i++) {
    if (dust.length > 400) break;
    const a = Math.random() * Math.PI * 2, sp = rr(2, 9);
    dust.push({
      x: p.x + rr(-1, 1), y: p.y + rr(-0.6, 1), z: p.z + rr(-1, 1),
      vx: Math.cos(a) * sp, vy: rr(1, 6), vz: Math.sin(a) * sp,
      rx: Math.random() * 6, ry: Math.random() * 6,
      life: rr(0.5, 1.35), max: 1, s: rr(0.18, 0.62), c: rr(0.62, 0.9)
    });
  }
}
/* 沿著地面往外擴散的一圈氣霧——打擊感的來源之一 */
function spawnRing(p, R) {
  const n = 28;
  for (let i = 0; i < n; i++) {
    if (dust.length > 400) break;
    const a = i / n * Math.PI * 2 + rr(-0.1, 0.1);
    dust.push({
      x: p.x + Math.cos(a) * 1.4, y: 0.35, z: p.z + Math.sin(a) * 1.4,
      vx: Math.cos(a) * rr(8, 15), vy: rr(0.3, 1.8), vz: Math.sin(a) * rr(8, 15),
      rx: 0, ry: a, life: rr(0.45, 0.9), s: rr(0.4, 0.95), c: rr(0.72, 0.94)
    });
  }
}
/* 龍捲風的塵霧：沿著漏斗表面繞圈往上竄，不是往外噴。
   往外噴的話看起來只是一團爆炸，看不出在「轉」。 */
function spawnTwistDust(t, dt) {
  t.emit = (t.emit || 0) + dt * 55;
  while (t.emit >= 1) {
    t.emit--;
    if (dust.length > 380) break;
    const a = Math.random() * Math.PI * 2;
    const hy = rr(0.3, t.h * 0.85);
    const rad = t.r * (0.2 + hy / t.h * 0.95);
    dust.push({
      x: t.x + Math.cos(a) * rad, y: hy, z: t.z + Math.sin(a) * rad,
      vx: -Math.sin(a) * 15 - Math.cos(a) * 3 + t.vx,
      vy: rr(7, 15),
      vz: Math.cos(a) * 15 - Math.sin(a) * 3 + t.vz,
      rx: Math.random() * 6, ry: a,
      life: rr(0.5, 1.1), s: rr(0.45, 1.15), c: rr(0.78, 0.98)
    });
  }
}
function stepDust(dt) {
  for (let i = dust.length - 1; i >= 0; i--) {
    const d = dust[i];
    d.life -= dt;
    if (d.life <= 0) { dust.splice(i, 1); continue; }
    d.vy -= 7 * dt; d.vx *= 0.94; d.vz *= 0.94;
    d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
    if (d.y < 0.1) { d.y = 0.1; d.vy = 0; d.vx *= 0.8; d.vz *= 0.8; }
    d.rx += dt * 2; d.ry += dt * 3;
  }
}

/* ── 樹 ───────────────────────────────────────────────── */
function makeTrees() {
  trees = [];
  const n = 18;
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2 + rr(-0.18, 0.18);
    const d = arenaR + rr(3, 15);       // 種在建材散落區外圍，不擋工地
    trees.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, h: rr(2.2, 4.2), r: rr(1.7, 3), rot: rr(0, 1), wob: 0, wv: 0 });
  }
}
function stepTrees(dt) {
  for (const t of trees) {                // 被震到會晃，用彈簧收回來
    t.wv += -t.wob * 46 * dt - t.wv * 4.4 * dt;
    t.wob += t.wv * dt;
  }
}
function shakeTrees(p, R) {
  for (const t of trees) {
    const d = Math.hypot(t.x - p.x, t.z - p.z);
    if (d < R * 4) t.wv += (1 - d / (R * 4)) * rr(2.4, 4.4) * (Math.random() < 0.5 ? -1 : 1);
  }
}

/* ── 主迴圈 ─────────────────────────────────────────────── */
function frame(now) {
  requestAnimationFrame(frame);
  if (!lastT) lastT = now;
  let raw = (now - lastT) / 1000;
  lastT = now;
  fps += (1 / Math.max(0.0005, raw) - fps) * 0.08;
  if (!running) { ENG.render(); return; }
  const dt = Math.min(0.05, raw) * timeScale;

  step(dt);
  draw();
  ENG.render();
  hudTick(now);
}

/* 把一步拆出來，測試才能不靠 rAF 直接推進模擬 */
function step(dt) {
  if (phase === 'build' && bp) {
    buildElapsed = (performance.now() - buildStart) / 1000;
    // 人力成本只在真的在施工時累積，而且跟著模擬時間走（開 4 倍速就燒得快）
    const c = workers.length * WAGE * dt;
    spentThis += c; stats.spent += c;
  }
  /* 拆到剩沒幾塊就當這座拆完了：剩下的自己垮掉，直接開下一座。
     不做這件事的話玩家得一塊一塊把最後的碎屑點掉，很煩。 */
  if (phase === 'wreck' && bp && placedCnt <= Math.floor(bp.slots.length * WRECK_AT)) {
    stats.destroyed++;
    toast('💥 ' + bp.name + ' 拆除完畢', '累計拆掉 ' + stats.destroyed + ' 座');
    checkBadges(); save(); renderTools();
    startBuild(false);
  }
  stepSwing(dt);
  stepBall(dt);
  stepTwist(dt);
  for (let i = toasts.length - 1; i >= 0; i--) {
    toasts[i].t -= dt;
    if (toasts[i].t <= 0) { toasts.splice(i, 1); renderToasts(); }
  }
  saveT += dt;
  if (saveT > 12) { saveT = 0; save(); }

  if (supportDirty) {
    supportT -= dt;
    if (supportT <= 0) { supportDirty = false; collapseUnsupported(); }
  }

  for (const b of blocks) {
    if (b.fallIn > 0) {                 // 已判定要垮，等它的鬆脫時間到
      b.fallIn -= dt;
      if (b.fallIn <= 0) {
        breakBlock(b, rr(-2.6, 2.6), rr(-1.6, 0.8), rr(-2.6, 2.6));
        stats.smashed++;                // 垮下來的也算擊飛
        // 這塊垮掉之後，原本靠它撐住的鄰居可能也懸空了，再算一次
        markSupportDirty(0.05);
      }
    }
    // 落定轉正期間 st 還是 FLY，所以 snap 要排在 FLY 前面判斷，否則重力會一直把它壓下去
    if (b.snap > 0) stepSnap(b, dt);
    else if (b.st === FLY) stepBlock(b, dt);
    else if (b.st === TOSS) stepToss(b, dt);
    if (b.scale > 1) b.scale = Math.max(1, b.scale - dt * 1.6);
    if (b.wob > 0) b.wob = Math.max(0, b.wob - dt * 2.2);
    if (b.al < 1) b.al = Math.min(1, b.al + dt * 2);
    b.r += (b.tr - b.r) * Math.min(1, dt * 5);
    b.g += (b.tg - b.g) * Math.min(1, dt * 5);
    b.b += (b.tb - b.b) * Math.min(1, dt * 5);
  }
  for (let i = 0; i < workers.length; i++) updWorker(workers[i], i, dt);
  stepDust(dt);
  stepTrees(dt);
  ENG.updateCamera(dt);
  if (spinOn) ENG.cam.yaw += dt * 0.16;
}

function draw() {
  ENG.setBlockCount(blocks.length);
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    _e.set(b.rx, b.ry, b.rz);
    const wob = b.wob > 0 ? Math.sin(b.wob * 40) * b.wob * 0.06 : 0;
    ENG.putBlock(i, b.x + wob, b.y, b.z, _e, b.scale * b.al, b.r, b.g, b.b);
  }
  ENG.commitBlocks();

  ENG.setWorkerCount(workers.length);
  for (let i = 0; i < workers.length; i++) ENG.putWorker(i, workers[i]);
  ENG.commitWorkers();

  ENG.putTrees(trees);
  ENG.putDust(dust);
}

/* ── 輸入 ───────────────────────────────────────────────── */
let spinOn = false;
let drag = null;

function onDown(e) {
  const p = e.touches ? e.touches[0] : e;
  drag = { x: p.clientX, y: p.clientY, x0: p.clientX, y0: p.clientY, moved: 0, t: performance.now(), n: e.touches ? e.touches.length : 1, pinch: 0 };
  if (e.touches && e.touches.length === 2)
    drag.pinch = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
}
function onMove(e) {
  if (!drag) return;
  if (e.touches && e.touches.length === 2 && drag.pinch) {
    const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    ENG.zoom(drag.pinch / d); drag.pinch = d; drag.moved = 99;
    e.preventDefault(); return;
  }
  const p = e.touches ? e.touches[0] : e;
  const dx = p.clientX - drag.x, dy = p.clientY - drag.y;
  drag.x = p.clientX; drag.y = p.clientY;
  drag.moved += Math.abs(dx) + Math.abs(dy);
  if (drag.moved > 6) ENG.orbit(dx, dy);
  if (e.touches) e.preventDefault();
}
function onUp(e) {
  if (!drag) return;
  const isClick = drag.moved < 8 && performance.now() - drag.t < 650;
  const x = drag.x0, y = drag.y0;
  drag = null;
  if (!isClick) return;
  audio();                                // 使用者互動後才允許出聲
  const hit = ENG.pick(x, y);
  if (!hit) return;
  if (hit.kind === 'worker') {            // 戳小人：跌倒、手上的積木掉下來
    const w = workers[hit.idx];
    if (w && w.fall <= 0) {
      w.fall = rr(1.2, 2.4); releaseWorker(w); sndFall();
      stats.poked++; checkBadges();
    }
    return;
  }
  // 龍捲風是往地面下的，點空地也算；其他工具要點到建築
  if (hit.kind === 'block' || tool === 'tornado') useTool(hit);
}

/* ── HUD ────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
let hudLast = 0;
const pad2 = n => (n < 10 ? '0' : '') + n;
function fmtClock(d) { return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()); }
function fmtDur(s) { return Math.floor(s / 60) + ':' + pad2(Math.floor(s % 60)); }

const money = v => '$' + Math.round(v).toLocaleString('en-US');

const PHASE_TXT = { build: ['施工中', ''], done: ['完工', 'ok'], wreck: ['拆除中', 'bad'] };

function hudTick(now) {
  if (now - hudLast < 120) return;
  hudLast = now;
  const d = new Date();
  $('clock').textContent = fmtClock(d);
  $('bigClock').textContent = fmtClock(d);
  $('bigDate').textContent = d.getFullYear() + '/' + pad2(d.getMonth() + 1) + '/' + pad2(d.getDate()) +
    ' 週' + '日一二三四五六'[d.getDay()];
  $('timer').textContent = fmtDur(buildElapsed);
  $('prog').textContent = placedCnt + ' / ' + (bp ? bp.slots.length : 0);
  $('fps').textContent = Math.round(fps) + ' fps';
  const pct = bp ? placedCnt / bp.slots.length * 100 : 0;
  $('bar').style.width = pct.toFixed(1) + '%';
  const ph = PHASE_TXT[phase] || PHASE_TXT.build;
  $('phase').textContent = ph[0];
  $('phase').className = 'tag ' + ph[1];
  $('cost').textContent = money(spentThis);
  $('costAll').textContent = money(stats.spent);
  $('nDest').textContent = stats.destroyed;
  $('nSmash').textContent = stats.smashed.toLocaleString('en-US');
}
function syncHud() {
  $('bname').textContent = bp ? bp.name : '';
  $('bcount').textContent = bp ? bp.slots.length + ' 塊' : '';
  $('vCnt').textContent = targetCnt;
  $('vWk').textContent = workerCnt;
  $('vSpd').textContent = timeScale.toFixed(1) + '×';
}

/* 工具列：沒解鎖的畫成鎖住並寫出解鎖條件 */
function renderTools() {
  const box = $('tools');
  box.innerHTML = '';
  for (const t of TOOLS) {
    const okNow = toolOk(t);
    const b = document.createElement('button');
    b.className = 'tool' + (tool === t.id ? ' on' : '') + (okNow ? '' : ' lock');
    b.dataset.tool = t.id;
    b.innerHTML = '<span class="k">' + (okNow ? t.k : '🔒') + '</span><span class="n">' + t.n + '</span>';
    b.title = okNow ? t.tip : t.lock.txt;
    b.addEventListener('click', () => {
      if (!toolOk(t)) { toast('🔒 ' + t.n + ' 還沒解鎖', t.lock.txt); return; }
      tool = t.id; renderTools();
      $('hint').textContent = t.tip + '　｜　拖曳轉視角　｜　滾輪縮放　｜　點小人會跌倒';
    });
    box.appendChild(b);
  }
}
function renderBadges() {
  const box = $('badges');
  box.innerHTML = BADGES.map(b => {
    const got = stats.badges.indexOf(b.id) >= 0;
    return '<div class="badge' + (got ? ' got' : '') + '"><b>' + (got ? '🏅 ' : '🔒 ') + b.n +
           '</b><span>' + b.d + '</span></div>';
  }).join('');
  $('badgeN').textContent = stats.badges.length + ' / ' + BADGES.length;
}
function renderToasts() {
  $('toast').innerHTML = toasts.map(t =>
    '<div class="t"><b>' + t.txt + '</b>' + (t.sub ? '<span>' + t.sub + '</span>' : '') + '</div>').join('');
}

/* ── 啟動 ───────────────────────────────────────────────── */
function boot() {
  ENG.init($('cv'));
  window.addEventListener('resize', () => ENG.resize());

  const cv = $('cv');
  cv.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  cv.addEventListener('touchstart', onDown, { passive: false });
  cv.addEventListener('touchmove', onMove, { passive: false });
  cv.addEventListener('touchend', onUp);
  cv.addEventListener('wheel', e => { ENG.zoom(e.deltaY > 0 ? 1.11 : 0.9); e.preventDefault(); }, { passive: false });
  cv.addEventListener('contextmenu', e => e.preventDefault());

  const sel = $('shape');
  sel.innerHTML = '<option value="-1">🎲 隨機</option>' +
    SHAPES.map((s, i) => '<option value="' + i + '">' + s.n + '</option>').join('');
  sel.addEventListener('change', () => { shapePick = +sel.value; startBuild(false); });

  /* 設定改動一律寫回 pref 並存檔——下次打開就不用重調 */
  $('cnt').addEventListener('input', e => { targetCnt = pref.cnt = +e.target.value; $('vCnt').textContent = targetCnt; });
  $('cnt').addEventListener('change', () => { save(); startBuild(false); });
  $('wk').addEventListener('input', e => { setWorkerCount(+e.target.value); pref.wk = workerCnt; $('vWk').textContent = workerCnt; });
  $('wk').addEventListener('change', save);
  $('spd').addEventListener('input', e => { timeScale = pref.spd = +e.target.value; $('vSpd').textContent = timeScale.toFixed(1) + '×'; });
  $('spd').addEventListener('change', save);
  $('again').addEventListener('click', () => { audio(); startBuild(false); });
  $('spin').addEventListener('change', e => { spinOn = pref.spin = e.target.checked; save(); });
  $('mute').addEventListener('change', e => { muted = pref.mute = e.target.checked; save(); });
  $('clockBtn').addEventListener('click', () => $('bigWrap').classList.add('on'));
  $('bigWrap').addEventListener('click', () => $('bigWrap').classList.remove('on'));
  $('panelBtn').addEventListener('click', () => $('panel').classList.toggle('hide'));
  $('badgeBtn').addEventListener('click', () => { renderBadges(); $('badgeWrap').classList.add('on'); });
  $('badgeWrap').addEventListener('click', e => {
    if (e.target.id === 'badgeWrap' || e.target.id === 'badgeClose') $('badgeWrap').classList.remove('on');
  });
  $('resetBtn').addEventListener('click', () => {
    if (confirm('清掉所有紀錄與成就？（建築不受影響）')) { resetSave(); toast('紀錄已清空'); }
  });

  load();
  applyPref();
  renderTools();
  renderBadges();
  startBuild(true);
  completeNow();          // 開場直接給一座蓋好的建築，砸掉之後才會開始蓋下一座
  requestAnimationFrame(frame);
}



