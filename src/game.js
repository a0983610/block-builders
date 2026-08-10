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
    scale: 1, snap: 0, snapFrom: null, arc: null, wob: 0, al: 1
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
      b.slot = -1; b.holder = -1; b.arc = null; b.scale = 1;
      b.st = FLY; b.rest = false; b.snap = 0;
      b.tr = 0.80; b.tg = 0.76; b.tb = 0.68;
      b.vx = rr(-5, 5); b.vy = rr(1, 6); b.vz = rr(-5, 5);
      b.ax = rr(-6, 6); b.ay = rr(-6, 6); b.az = rr(-6, 6);
    }
  }

  const idx = pickShape();
  recent.push(idx); if (recent.length > 8) recent.shift();
  bp = makeBlueprint(idx, targetCnt);
  placedCnt = 0; slotCursor = 0;
  phase = 'build';
  buildStart = performance.now(); buildElapsed = 0;

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
        b.st = CARRY; b.rest = false; w.carry = true;
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
    }
  }
}

/* ── 破壞 ───────────────────────────────────────────────── */
let hammerR = 5.5, hammerPow = 15;
let smashedTotal = 0, destroyedBuildings = 0;

/* 重點：只有衝擊球內的積木會散，球外的原封不動。
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
      let ox = dx, oy = dy, oz = dz, ol = Math.max(0.4, d);
      ox /= ol; oy /= ol; oz /= ol;
      freeBlock(b);
      // 六成沿著揮擊方向、四成沿著離衝擊點的徑向——才有「往那個方向被打飛」的感覺
      b.vx = (dir.x * 0.62 + ox * 0.55) * f + rr(-1.4, 1.4);
      b.vy = (dir.y * 0.32 + oy * 0.62) * f + rr(2.2, 6.2);
      b.vz = (dir.z * 0.62 + oz * 0.55) * f + rr(-1.4, 1.4);
      b.ax = rr(-9, 9); b.ay = rr(-9, 9); b.az = rr(-9, 9);
      hitN++;
    } else if (d2 <= R2 * 3.4) {
      b.wob = 0.5;                        // 波及範圍：只是晃一下，不脫落
    }
  }
  smashedTotal += hitN;
  if (hitN > 0 && phase === 'done') { destroyedBuildings++; phase = 'build'; buildStart = performance.now() - buildElapsed * 1000; }
  for (const w of workers) {              // 附近的小人被嚇倒
    if (Math.hypot(w.x - point.x, w.z - point.z) < R * 1.7 && w.fall <= 0) {
      w.fall = rr(1.1, 2.3); releaseWorker(w); sndFall();
    }
  }
  spawnDust(point, R, hitN);
  ENG.shake(0.42 + Math.min(1.4, hitN * 0.02));
  sndSmash();
  return hitN;
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
  if (phase === 'build' && bp) buildElapsed = (performance.now() - buildStart) / 1000;

  for (const b of blocks) {
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
    if (w && w.fall <= 0) { w.fall = rr(1.2, 2.4); releaseWorker(w); sndFall(); }
    return;
  }
  if (hit.kind === 'block') {
    smash(hit.point, hit.dir);
    shakeTrees(hit.point, hammerR);
  }
}

/* ── HUD ────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
let hudLast = 0;
const pad2 = n => (n < 10 ? '0' : '') + n;
function fmtClock(d) { return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()); }
function fmtDur(s) { return Math.floor(s / 60) + ':' + pad2(Math.floor(s % 60)); }

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
  $('phase').textContent = phase === 'done' ? '完工' : '施工中';
  $('phase').className = 'tag ' + (phase === 'done' ? 'ok' : '');
}
function syncHud() {
  $('bname').textContent = bp ? bp.name : '';
  $('bcount').textContent = bp ? bp.slots.length + ' 塊' : '';
  $('vCnt').textContent = targetCnt;
  $('vWk').textContent = workerCnt;
  $('vSpd').textContent = timeScale.toFixed(1) + '×';
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

  $('cnt').addEventListener('input', e => { targetCnt = +e.target.value; $('vCnt').textContent = targetCnt; });
  $('cnt').addEventListener('change', () => startBuild(false));
  $('wk').addEventListener('input', e => { setWorkerCount(+e.target.value); $('vWk').textContent = workerCnt; });
  $('spd').addEventListener('input', e => { timeScale = +e.target.value; $('vSpd').textContent = timeScale.toFixed(1) + '×'; });
  $('again').addEventListener('click', () => { audio(); startBuild(false); });
  $('spin').addEventListener('change', e => { spinOn = e.target.checked; });
  $('mute').addEventListener('change', e => { muted = e.target.checked; });
  $('clockBtn').addEventListener('click', () => $('bigWrap').classList.add('on'));
  $('bigWrap').addEventListener('click', () => $('bigWrap').classList.remove('on'));
  $('panelBtn').addEventListener('click', () => $('panel').classList.toggle('hide'));

  setWorkerCount(workerCnt);
  startBuild(true);
  requestAnimationFrame(frame);
}
