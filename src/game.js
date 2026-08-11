/* ============================================================
   遊戲層：積木狀態、物理、小人 AI、破壞、主迴圈
   繪製一律透過 ENG（engine.js），藍圖來自 blueprints.js。

   積木的一生：
     FREE（躺在地上的建材）→ CARRY（被小人舉著）→ TOSS（拋向藍圖位置的弧線）
     → SET（就定位，變成建築的一部分）→ 被槌子打到 → FLY（飛出去）→ 落地變回 FREE
   ============================================================ */
'use strict';

/* 版本號。規則：每次 commit 都要動——一般改動 patch +1，
   功能性改動 minor +1（patch 歸零）。畫面右下角會顯示。 */
const VERSION = '1.12.0';

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
let phase = 'build';                // clear（整地）| build | done | wreck
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
function sndDozer() { tone(58, 1.1, 'sawtooth', 0.05, 1.3); noise(1.1, 0.07, 260); }
function sndBadge() { [784, 988, 1319].forEach((f, i) => setTimeout(() => tone(f, 0.18, 'triangle', 0.08), i * 90)); }
/* 爆炸：比槌子低一個八度、拖得更長。R 越大轟得越久 */
function sndBoom(R) {
  const k = clamp(R / 11, 1, 2.6);
  noise(0.5 * k, 0.34, 900); tone(46, 0.75 * k, 'sawtooth', 0.12, 0.3);
}
function sndTick() { tone(1250, 0.045, 'square', 0.045); }
function sndSiren() { tone(560, 1.1, 'sine', 0.05, 1.7); }
/* 魔法陣長一層：越外層音越高，疊起來像在充能 */
function sndRune(i) { tone(300 + i * 120, 0.5, 'triangle', 0.05, 1.35); }

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
    let px = 0, pz = 0, moved = false;
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
        px += dx / d * push; pz += dz / d * push;
        moved = true;
      }
    }
    if (!moved) break;
    /* 一次最多推開一格。上百塊同時落在同一點時（例如整座建築垮下來），
       每個鄰居的推力累加起來會把積木一口氣彈到幾千單位外——
       實測看過積木飛到 4700，小人還傻傻追過去撿。 */
    const pl = Math.hypot(px, pz);
    if (pl > ENG.BS) { px = px / pl * ENG.BS; pz = pz / pl * ENG.BS; }
    b.x += px; b.z += pz;
  }
  const d = Math.hypot(b.x, b.z);          // 保險：擠到最後還是要留在場內
  if (d > arenaR) { b.x = b.x / d * arenaR; b.z = b.z / d * arenaR; }
}
/* separate 的溫和版：只算一輪、力道打折、位移還給上限。
   要「每幀都擠一點」的地方（推土機鏟子前那一坨）不能用 separate——
   它是為「落地瞬間一次擠開」設計的，一幀就把碎料彈到幾個單位外。 */
function nudgeApart(b, lim) {
  if (lim <= 0) return;
  const cx = Math.floor(b.x / CELL), cz = Math.floor(b.z / CELL);
  let px = 0, pz = 0;
  for (let i = -1; i <= 1; i++) for (let k = -1; k <= 1; k++) {
    const a = restGrid.get((cx + i) + ':' + (cz + k)); if (!a) continue;
    for (const o of a) {
      if (o === b) continue;
      let dx = b.x - o.x, dz = b.z - o.z;
      let d = Math.hypot(dx, dz);
      if (d >= ENG.BS) continue;
      if (d < 1e-4) { const ang = Math.random() * Math.PI * 2; dx = Math.cos(ang); dz = Math.sin(ang); d = 1e-4; }
      const push = (ENG.BS - d) * 0.25;
      px += dx / d * push; pz += dz / d * push;
    }
  }
  const pl = Math.hypot(px, pz);
  if (pl < 1e-6) return;
  if (pl > lim) { px = px / pl * lim; pz = pz / pl * lim; }
  b.x += px; b.z += pz;
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
    /* 這裡是「已就位的積木離開建築」唯一的出口，所以損失也記在這——
       不管是被槌子打飛、被龍捲風吸走，還是失去支撐自己垮下來，都算。 */
    if (b.st === SET) { placedCnt--; stats.wrecked += WRECK_COST; lossThis += WRECK_COST; }
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
/* 世界座標 ↔ 藍圖格子的換算。slot 的 x/z 是格子座標減掉一個置中定值、y 就是格子座標本身，
   世界上的積木再往上抬半塊。順便記下格子上界：查表前先擋掉界外，
   免得界外座標被 gkeyOf 的位元組合折回來，撞到某個真的存在的格子。 */
let gOffX = 0, gOffZ = 0, gMaxX = 0, gMaxY = 0, gMaxZ = 0;
function indexGrid() {
  const s0 = bp.slots[0];
  gOffX = s0.x - s0.gx; gOffZ = s0.z - s0.gz;
  gMaxX = gMaxY = gMaxZ = 0;
  for (const s of bp.slots) {
    if (s.gx > gMaxX) gMaxX = s.gx;
    if (s.gy > gMaxY) gMaxY = s.gy;
    if (s.gz > gMaxZ) gMaxZ = s.gz;
  }
}
/* 這個世界座標上有沒有一塊「已經就位」的積木（施工中／飛在半空的不算） */
function blockAt(x, y, z) {
  if (!bp) return false;
  const gx = Math.round(x - gOffX), gy = Math.round(y - HB), gz = Math.round(z - gOffZ);
  if (gx < 0 || gy < 0 || gz < 0 || gx > gMaxX || gy > gMaxY || gz > gMaxZ) return false;
  const i = bp.at.get(gkeyOf(gx, gy, gz));
  return i !== undefined && bp.slots[i].filled;
}

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
  trebs = null; ENG.putTrebs([]); ENG.putRocks([]);
  dozers = null; ENG.putDozers([]);
  // 倒數中的炸彈／核彈／魔法陣也一樣：留著的話會炸到剛換上來的新建築
  bombs = null; ENG.putBombs([]);
  nuke = null; ENG.hideNuke();
  magic = null;
  /* 火球、蘑菇雲、光環**不**清掉。它們純粹是畫面，不會動到積木，
     而且一發核彈常常直接把整棟夷平——那會立刻觸發「剩不到 25% 就換下一座」，
     清掉的話蘑菇雲會在爆炸後 0.05 秒整朵消失，等於白做。
     塵霧（dust）本來就是這樣處理的，這裡跟它一致。 */

  const idx = pickShape();
  recent.push(idx); if (recent.length > 8) recent.shift();
  bp = makeBlueprint(idx, targetCnt);
  indexGrid();
  placedCnt = 0; slotCursor = 0;
  buildElapsed = 0; spentThis = 0; lossThis = 0;

  siteR = Math.max(7, bp.radius);
  // 建材散落區從工地邊緣往外鋪，面積跟積木數成正比 → 不管 300 塊還 3000 塊都一樣鬆
  arenaR = Math.sqrt((siteR + 2) ** 2 + SPREAD * bp.slots.length / Math.PI) + 8;
  reconcilePool();

  /* 上一輪的碎料躺在新工地上：叫幾台推土機開進來把範圍推乾淨，推完小人才開工。
     開場那一座沒有前一輪的殘料，殘料少到不值得演的時候也直接清掉就好。 */
  if (instant || countDirty() < 8) { kickOutSite(); beginBuild(); }
  else startClear();

  makeTrees();
  computeSupport();                  // 派第一個工之前就要有支撐狀態可以查
  ENG.fitCamera(siteR, bp.height, arenaR, !!instant);
  syncHud();
}

/* ── 整地：推土機 ───────────────────────────────────────
   換建築時上一輪的碎料還躺在工地上，而且不是平均鋪開的——只拿槌子敲的話，
   碎料會全堆在挨打的那一區。所以推土機要做的是「去把堆起來的推散」，
   不是把整片地毯式掃一遍。

   每台機器自己找一坨最密的碎料，繞到那坨的內側，朝外把它推出工地範圍，
   然後再找下一坨。找不到值得推的堆就收工。剩下的零星碎塊在收尾時彈出去，
   不為了那幾塊讓玩家多等好幾秒。

   車速是固定的，而且比小人走路快不了多少——推土機本來就該是慢的。
   之前用「一趟固定跑幾秒」回推速度，大工地會飆到每秒 57 單位，看起來像在飛。 */
// 鏟子的寬度與位置直接取畫面那邊的值，判定跟看到的才會是同一把鏟子
const DOZ_W = ENG.DOZ_W, DOZ_FRONT = ENG.DOZ_FRONT;
const DOZ_N = 3;                    // 派幾台
const DOZ_MOVE = 9.5;               // 空車趕路的速度
const DOZ_PUSH = 6.5;               // 推著碎料時的速度
const DOZ_TURN = 3.4;               // 轉向角速度（rad/s）
const DOZ_BACK = 6;                 // 停在那坨的內側多遠開始推
const DOZ_WAIT = 1.3;               // 開工前怠速幾秒，等飛在半空的碎料落地
const DOZ_CELL = 5;                 // 找堆時的格子邊長
const DOZ_HEAP = 12;                // 一格少於這麼多塊就不算「堆」，不值得專程去推
const DOZ_LIMIT = 6.5;              // 整地最多拖這麼久。碎料鋪滿整片地時堆推不完，
                                    // 但這是換場的空檔，不是關卡——時間到就收工，剩下的彈掉
/* 鏟面後方多深之內都算同一堆，一起往前帶。抓得越深一次帶越多，但也得推得更遠
   才能整堆送出範圍外——不然機器停下時，那一疊的尾巴還留在工地裡。 */
const DOZ_PILE = 7;
let dozers = null;

const siteClearR = () => siteR + 1.4;
function countDirty() {
  const r = siteClearR(); let n = 0;
  for (const b of blocks) if (b.st === FREE && Math.hypot(b.x, b.z) < r) n++;
  return n;
}
function kickOutSite() {
  const r = siteClearR();
  for (const b of blocks) if (b.st === FREE && Math.hypot(b.x, b.z) < r) kickOut(b);
}
function beginBuild() {
  phase = 'build';
  buildStart = performance.now();     // 施工計時從真正開工才起算，不含整地
}
function startClear() {
  const R = siteClearR() + 9;
  dozers = {
    t: 0, wait: DOZ_WAIT, done: false,
    list: Array.from({ length: DOZ_N }, (_, k) => {
      const ang = (k / DOZ_N + Math.random() * 0.2) * Math.PI * 2;  // 從場邊不同方向開進來
      const x = Math.cos(ang) * R, z = Math.sin(ang) * R;
      // rotation.y = a 會讓車頭（local +Z）指向 (sin a, cos a)，所以面向原點是 atan2(-x, -z)
      return { x, z, a: Math.atan2(-x, -z), st: 'seek', tx: 0, tz: 0, ux: 0, uz: 0, bl: 1, k };
    })
  };
  phase = 'clear';
  sndDozer();
}

/* 把工地上的碎料用粗格子數一數，回傳夠格稱為「堆」的那些，多的排前面。
   一幀算一次三台共用，不要每台各掃一次 blocks。 */
function listHeaps() {
  const r = siteClearR(), cnt = new Map();
  for (const b of blocks) {
    if (b.st !== FREE || Math.hypot(b.x, b.z) >= r) continue;
    const key = Math.floor(b.x / DOZ_CELL) + ':' + Math.floor(b.z / DOZ_CELL);
    let c = cnt.get(key);
    if (!c) cnt.set(key, c = { n: 0, x: 0, z: 0 });
    c.n++; c.x += b.x; c.z += b.z;
  }
  const out = [];
  for (const c of cnt.values())
    if (c.n >= DOZ_HEAP) out.push({ n: c.n, x: c.x / c.n, z: c.z / c.n });
  out.sort((a, b) => b.n - a.n);
  return out;
}
/* 派工：繞到那坨的內側，等一下朝外推。堆剛好在正中心時就照現在的車頭方向推。 */
function assignHeap(m, h) {
  const d = Math.hypot(h.x, h.z);
  const ux = d < 0.5 ? Math.sin(m.a) : h.x / d;
  const uz = d < 0.5 ? Math.cos(m.a) : h.z / d;
  m.ux = ux; m.uz = uz;
  m.tx = h.x - ux * DOZ_BACK; m.tz = h.z - uz * DOZ_BACK;
  m.st = 'move';
}
/* 開向目標點。回傳是否已抵達。轉向不是瞬間的，車頭要轉過去才走得順。 */
function driveTo(m, dt, spd) {
  const dx = m.tx - m.x, dz = m.tz - m.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.6) return true;
  const want = Math.atan2(dx, dz);              // 跟畫面同一套：rotation.y 讓 +Z 指向這裡
  let diff = want - m.a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const turn = Math.min(Math.abs(diff), DOZ_TURN * dt) * Math.sign(diff);
  m.a += turn;
  // 車頭還沒轉過來就先原地轉，不要斜著滑過去
  const go = spd * dt * Math.max(0, 1 - Math.abs(diff) / 1.2);
  m.x += Math.sin(m.a) * Math.min(go, d);
  m.z += Math.cos(m.a) * Math.min(go, d);
  return false;
}
function dozRender(D) {
  return D.list.map(m => ({ x: m.x, z: m.z, a: m.a, bl: m.bl,
                            bob: Math.sin(D.t * 26 + m.k * 1.7) * 0.045 }));
}
/* 鏟面「前面」那一疊碎料跟著車子一起平移——整疊維持原本的相對位置往前走，
   這才像被推著。只動落定的碎塊，已就位的建築、小人手上的、還在飛的都不碰。

   一開始寫反了：抓的是鏟面「後面」的積木，再一幀一幀把它們拉回鏟面前。
   等於鏟子一路穿過碎料堆，碎料在原地被扯來扯去——看起來是在震動，不是被推走。
   而且每幀還呼叫 separate 把它們互相擠開，有一半的推力是把積木推回鏟子後面，
   下一幀又被拉回來，抖得更明顯。

   平移量直接用車子這一幀實際走的位移，不是用車速去算——轉彎時車子走得比車速慢，
   用車速算的話碎料會跑到鏟子前面去。 */
function pushWithBlade(m, mvx, mvz) {
  const fx = Math.sin(m.a), fz = Math.cos(m.a);        // 車頭方向
  const frontX = m.x + fx * DOZ_FRONT, frontZ = m.z + fz * DOZ_FRONT;
  const mv = Math.hypot(mvx, mvz);
  for (const b of blocks) {
    if (b.st !== FREE) continue;
    const rx = b.x - frontX, rz = b.z - frontZ;
    const ahead = rx * fx + rz * fz;                    // 在鏟面前方多遠
    // 已被輾過去的、還沒碰到的都不動。後界抓太深的話，落後的積木會被一次拉回鏟面前，
    // 那一下就是個明顯的跳格（-0.8 會跳 1.1 個單位）
    if (ahead < -0.4 || ahead > DOZ_PILE) continue;
    if (Math.abs(-rx * fz + rz * fx) > DOZ_W) continue; // 不在鏟子寬度內
    if (b.cell) gridDel(b);
    b.x += mvx; b.z += mvz;
    /* 整疊往前擠會越擠越密（車子一直往前收新的進來），要讓它往前、往兩側慢慢散開，
       鏟子前面那一坨才長得出形狀。散開的速度必須比車子慢，這是重點——
       直接套 separate 的話一幀能推開 4.7 單位（那是為「落地瞬間擠開」設計的），
       碎料會被彈出鏟子範圍，畫面上變成機器周圍一圈空地、鏟子前面什麼都沒有。 */
    nudgeApart(b, mv * 0.9);
    // 被擠到鏟面後面的要拉回來，不然下一幀就被當成「已經輾過去」丟下了
    const d = (b.x - frontX) * fx + (b.z - frontZ) * fz;
    if (d < 0.3) { const k = 0.3 - d; b.x += fx * k; b.z += fz * k; }
    b.wob = 0.3;
    gridAdd(b);
  }
}
function finishClear() {
  kickOutSite();                     // 剩下的零星碎塊直接彈出去收尾
  dozers.done = true;                // 交給小人，機器自己開出場
  for (const m of dozers.list) {
    m.st = 'leave'; m.bl = 1;
    m.a = Math.atan2(m.x, m.z);      // 車頭轉朝外，不要再穿過工地
  }
  beginBuild();
}
function stepDozers(dt) {
  const D = dozers; if (!D) return;
  D.t += dt;
  if (D.wait > 0) { D.wait -= dt; return; }            // 怠速等碎料落地
  if (D.done) {
    let alive = 0;
    for (const m of D.list) {
      m.x += Math.sin(m.a) * DOZ_MOVE * dt;
      m.z += Math.cos(m.a) * DOZ_MOVE * dt;
      if (Math.hypot(m.x, m.z) < arenaR + 14) alive++;
    }
    if (!alive) { dozers = null; ENG.putDozers([]); }
    return;
  }
  const R = siteClearR();
  const heaps = listHeaps();
  let idle = 0;
  for (const m of D.list) {
    if (m.st === 'move') {
      m.bl += (1 - m.bl) * Math.min(1, dt * 6);        // 趕路時鏟子抬起來
      if (driveTo(m, dt, DOZ_MOVE)) {
        // 到位，開始朝外推。推到整疊都出了範圍才收手，不是車頭一出界就停
        const out = R + DOZ_PILE + 2;
        m.tx = m.ux * out; m.tz = m.uz * out;
        m.st = 'push';
      }
    } else if (m.st === 'push') {
      m.bl += (0 - m.bl) * Math.min(1, dt * 8);        // 鏟子放下來
      const px = m.x, pz = m.z;
      const at = driveTo(m, dt, DOZ_PUSH);
      pushWithBlade(m, m.x - px, m.z - pz);            // 碎料跟著車子走同樣的位移
      if (at || Math.hypot(m.x, m.z) > R + DOZ_PILE + 1) m.st = 'seek';
    }
    if (m.st === 'seek') {
      const h = heaps.shift();                         // 最大的那坨先派，三台不會擠在一起
      if (h) assignHeap(m, h); else idle++;
    }
  }
  // 全部都找不到值得推的堆了，或是拖太久，就收工——不為了零星幾塊讓玩家乾等
  if (idle >= D.list.length || D.t > DOZ_LIMIT) finishClear();
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
  dozers = null; ENG.putDozers([]);      // 建築直接長出來了，整地機沒戲唱
  placedCnt = bp.slots.length;
  phase = 'done';
  buildElapsed = 0; spentThis = 0; lossThis = 0;
  computeSupport();
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
    wait: 0, fall: 0, tilt: 0, carry: false, cheer: 0, pause: 0, leg: 0,
    /* 每個人身高略有差異。1.06–1.24 大約是積木邊長的一個半，
       比原本大一成半——太小的話遠鏡頭下只剩一撮色點，看不出在做什麼。 */
    scale: rr(1.06, 1.24)
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
    markSupportDirty(0.05);          // 放掉認領也會改變支撐狀態
  }
  w.block = -1; w.slot = -1; w.carry = false; w.st = 'idle';
}

function findSlot() {
  const S = bp.slots;
  while (slotCursor < S.length && (S[slotCursor].filled || S[slotCursor].claimed >= 0)) slotCursor++;
  /* 只派「現在真的蓋得起來」的格子。游標之後找不到就從頭掃一次——
     中途被打掉的洞會落在游標後面，尤其地基被敲掉時要能回頭補。 */
  for (let i = slotCursor; i < S.length; i++)
    if (!S[i].filled && S[i].claimed < 0 && canPlace(i)) return i;
  for (let i = 0; i < slotCursor; i++)
    if (!S[i].filled && S[i].claimed < 0 && canPlace(i)) return i;
  return -1;
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

  if (phase === 'wreck' || phase === 'clear') {
    /* 拆除中：不修、不蓋，躲遠一點看你拆。要等這座拆完換新藍圖才會回去工作。
       整地中一樣退到旁邊等——推土機還在推，這時候進場只會被鏟到。 */
    w.cheer = 0;
    const d = Math.hypot(w.x, w.z);
    if (d < arenaR * 0.62) {
      const a = d < 0.01 ? Math.random() * Math.PI * 2 : Math.atan2(w.z, w.x);
      w.tx = Math.cos(a) * arenaR * 0.78; w.tz = Math.sin(a) * arenaR * 0.78;
    }
    if (walkTo(w, dt)) {
      /* 下一個閒晃點取在自己附近的角度，不是整圈亂挑。挑到對面去的話
         他會直接穿過工地正中央——拆到一半的建築裡、推土機的車道上都照走。 */
      const a = Math.atan2(w.z, w.x) + rr(-0.8, 0.8), r2 = arenaR * rr(0.6, 0.85);
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
      // 慶祝完就整張草地隨便晃。地圖是方的，目標點也用方形分布
      w.y += (0 - w.y) * Math.min(1, dt * 6);
      if (w.pause > 0) {
        // 到了定點站著發呆一下。全部人一路走不停的話，看起來像一群螞蟻在竄
        w.pause -= dt;
        w.gait += (0 - w.gait) * Math.min(1, dt * 8);
      } else if (strollTo(w, dt)) {
        strollPause(w);
        const R = arenaR + 20;
        w.tx = rr(-R, R); w.tz = rr(-R, R);
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
      markSupportDirty(0.05);        // 認領也算「這格有東西了」，會影響上面能不能蓋
      w.slot = s; w.block = bi; w.st = 'pick';
      w.leg = 0;                     // 接到工作就把閒晃里程歸零，別把它算進下次的發呆時間
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
  // 舉的高度要跟著身高走，不然高個子的積木會陷進自己的安全帽裡
  b.y = (1.45 + Math.abs(Math.sin(w.ph)) * 0.05) * w.scale;
  b.rx += (0 - b.rx) * 0.2; b.rz += (0 - b.rz) * 0.2;
}
/* ── 閒晃 ─────────────────────────────────────────────────
   沒事做的時候走的路，跟施工中的走法分開：
   pick／build 本來就得走進工地擺積木，這裡則是要繞開已經蓋好的建築。
   把建築當成以工地中心為圓心、半徑 siteR 的一根柱子繞過去就好——
   要的是「不要從建築中間穿過去」，不是貼著每一塊積木算精確的邊。 */
const KEEP = 1.5;                   // 閒晃時跟建築外圍保持的距離

/* 走到定點就站一會兒。站的時間跟**剛走完**那段路成比例——
   寫死秒數的話，換一座大的（工地大、走得久）站著的人就變少，比例會跟著建築跑掉；
   算成「接下來要走的那段」則更糟：剛擺完積木的人會先在工地正中央發呆快十秒才動身。
   2.4 倍是量出來的：任一瞬間大約七成的人站著不動。 */
function strollPause(w) { w.pause = w.leg / WALK * rr(1.7, 3.1); w.leg = 0; }

function strollTo(w, dt) {
  const keep = siteR + KEEP;
  /* 目標點落在建築裡就先推到外圈。不推的話他會繞著建築打轉永遠抵達不了，
     也就永遠不換下一個目標，等於卡死在那一圈上。 */
  const tr = Math.hypot(w.tx, w.tz);
  if (tr < keep) {
    const a = tr < 0.001 ? Math.atan2(w.z, w.x) : Math.atan2(w.tz, w.tx);
    w.tx = Math.cos(a) * keep; w.tz = Math.sin(a) * keep;
  }
  const dx = w.tx - w.x, dz = w.tz - w.z, d = Math.hypot(dx, dz);
  if (d < REACH) { w.gait += (0 - w.gait) * Math.min(1, dt * 8); return true; }

  let ux = dx / d, uz = dz / d;
  const pr = Math.hypot(w.x, w.z);
  const nx = pr < 0.001 ? 1 : w.x / pr, nz = pr < 0.001 ? 0 : w.z / pr;   // 由工地中心往外
  if (pr < keep) {
    // 人已經在建築範圍內（剛擺完積木站在外圈的就是這樣）——先往外走出去
    ux += nx * 1.5; uz += nz * 1.5;
  } else if (pr < keep + 3 && ux * nx + uz * nz < 0) {
    /* 快貼到牆了又還朝著中心走：把方向掰到切線上，選跟原方向同側的那一條，
       離牆越近掰得越兇。直接煞停的話他會頂著牆原地發抖。 */
    let sx = -nz, sz = nx;
    if (ux * sx + uz * sz < 0) { sx = nz; sz = -nx; }
    const k = (keep + 3 - pr) / 3;
    ux += (sx - ux) * k; uz += (sz - uz) * k;
  }
  const m = Math.hypot(ux, uz) || 1;
  ux /= m; uz /= m;

  const sp = Math.min(WALK * dt, d);
  w.x += ux * sp; w.z += uz * sp;
  w.leg += sp;                         // 這趟閒晃走了多遠，抵達後拿來算站多久
  w.a = Math.atan2(ux, uz);            // 面向真正在走的方向，不是目標方向
  w.ph += dt * 11;
  w.gait += (0.85 - w.gait) * Math.min(1, dt * 8);
  return false;
}

function wander(w, dt) {
  if (w.pause > 0) { w.pause -= dt; w.gait += (0 - w.gait) * Math.min(1, dt * 8); return; }
  if (strollTo(w, dt)) {
    strollPause(w);
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
    // 飛到一半底下被打掉的話就別擺上去了，直接當碎料掉下來
    freshSupport();
    if (!canPlace(b.slot)) {
      bp.slots[b.slot].claimed = -1;
      b.arc = null;
      freeBlock(b);
      b.vy = 1.5;
      return;
    }
    b.st = SET; b.arc = null; b.rest = true;
    b.x = a.x1; b.y = a.y1; b.z = a.z1;
    b.rx = b.ry = b.rz = 0;
    b.scale = 1.22;                       // 落定彈一下
    bp.slots[b.slot].filled = true;
    bp.slots[b.slot].claimed = -1;
    placedCnt++;
    markSupportDirty(0.05);
    sndPlace();
    if (placedCnt >= bp.slots.length && phase === 'build') {
      phase = 'done';
      buildElapsed = (performance.now() - buildStart) / 1000;
      for (const w of workers) { w.cheer = 0; w.pause = 0; }
      sndDone();
      toast('🎉 ' + bp.name + ' 完工', fmtDur(buildElapsed) + '　人力 ' + money(spentThis));
      noteBuilt();
    }
  }
}

/* ── 紀錄 · 成就 · 存檔 ───────────────────────────────── */
const WRECK_AT = 0.25;              // 剩下不到這個比例就算拆完了，換下一座
const WAGE = 3;                     // 每個小人每秒的人力成本（$）
/* 每塊積木從建築上掉下來，算多少損失。訂在 85 是要讓「拆一座」的數字有份量：
   一千塊的建築拆完約 $85,000，跟蓋它花掉的人力錢是同一個量級。 */
const WRECK_COST = 85;
const SAVE_KEY = 'block-builders/save1';
const SAVE_MAGIC = 'BB1';
const SAVE_XOR = 'winton-block-builders-2026';

const freshStats = () => ({
  destroyed: 0, smashed: 0, carried: 0, poked: 0, spent: 0, wrecked: 0,
  bestHit: 0, bigBuild: 0, miracle: false, built: [], tools: [], badges: []
});
let stats = freshStats();
/* 面板上的設定也一起存，不然每次打開都要重調一輪 */
const freshPref = () => ({ cnt: 900, wk: 20, spd: 1, mute: false, spin: false });
let pref = freshPref();
let spentThis = 0;
let lossThis = 0;                   // 這一座造成的損失（換建築時歸零）
let savable = true;                 // 無痕模式之類的存不了，就安靜降級

const BADGES = [
  /* 排列順序＝面板上的顯示順序（兩欄，橫向填）。同一件事的兩個門檻排在一起，
     一眼看得出「這個拿到了、下一階還沒」。 */
  { id: 'first', n: '開工大吉', d: '蓋完第一座建築', chk: s => s.built.length >= 1 },
  { id: 'miracle', n: '奇蹟工程', d: '3 分鐘內蓋完吉薩金字塔', chk: s => !!s.miracle },
  { id: 'bigBuild', n: '大興土木', d: '蓋完一座 2500 塊以上的建築', chk: s => s.bigBuild >= 2500 },
  { id: 'world10', n: '環遊世界', d: '蓋過 10 種不同地標', chk: s => s.built.length >= 10 },
  { id: 'worldAll', n: '地標蒐藏家', d: '蓋過全部 ' + SHAPES.length + ' 種地標',
    chk: s => s.built.length >= SHAPES.length },
  { id: 'move10k', n: '愚公移山', d: '小人累計搬運 10000 塊', chk: s => s.carried >= 10000 },
  { id: 'move100k', n: '工蟻軍團', d: '小人累計搬運 100000 塊', chk: s => s.carried >= 100000 },
  { id: 'demo50', n: '拆遷大隊', d: '一次擊飛超過 50 塊積木', chk: s => s.bestHit > 50 },
  { id: 'hit200', n: '一發清空', d: '一次擊飛超過 200 塊積木', chk: s => s.bestHit > 200 },
  { id: 'smash50k', n: '粉塵滿天', d: '累計擊飛 50000 塊積木', chk: s => s.smashed >= 50000 },
  { id: 'wreck5', n: '拆屋大亨', d: '拆掉 5 座建築', chk: s => s.destroyed >= 5 },
  { id: 'wreck25', n: '都市更新', d: '拆掉 25 座建築', chk: s => s.destroyed >= 25 },
  { id: 'allTools', n: '工具箱清空', d: '九種破壞道具都用過', chk: s => s.tools.length >= TOOLS.length },
  { id: 'boss20', n: '工頭嚴厲', d: '戳倒小人 20 次', chk: s => s.poked >= 20 },
  { id: 'poke100', n: '工安黑名單', d: '戳倒小人 100 次', chk: s => s.poked >= 100 },
  { id: 'million', n: '百萬工程', d: '累計人力支出破 $1,000,000', chk: s => s.spent >= 1e6 },
  { id: 'spend10m', n: '無底錢坑', d: '累計人力支出破 $10,000,000', chk: s => s.spent >= 1e7 },
  { id: 'loss100k', n: '災情慘重', d: '累計造成 $100,000 損失', chk: s => s.wrecked >= 1e5 },
  { id: 'loss2m', n: '保險公司拒保', d: '累計造成 $2,000,000 損失', chk: s => s.wrecked >= 2e6 }
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
  if (bp.slots.length > stats.bigBuild) stats.bigBuild = bp.slots.length;
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
    // 認得的才留：存檔被改過、或舊版留下已經不存在的 id，都不要讓它影響成就判定
    f.badges = f.badges.filter(id => BADGES.some(b => b.id === id));
    f.tools = f.tools.filter(id => TOOLS.some(t => t.id === id));
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
  { id: 'finger', n: '手指', k: '👆', tip: '不破壞任何東西，只能戳小人', lock: null },
  { id: 'hammer', n: '槌子', k: '🔨', tip: '點建築：點狀衝擊', lock: null },
  { id: 'bighammer', n: '大槌', k: '🔨', big: true, tip: '點建築：兩倍大的槌子，範圍也是兩倍',
    lock: { txt: '累計擊飛 300 塊解鎖', ok: () => stats.smashed >= 300 } },
  { id: 'ball', n: '保齡球', k: '🎳', tip: '點建築：保齡球滾過去撞',
    lock: { txt: '拆掉 3 座建築解鎖', ok: () => stats.destroyed >= 3 } },
  { id: 'treb', n: '投石機', k: '🪨', tip: '點地面：在那裡架一台投石機，朝建築丟石頭',
    lock: { txt: '拆掉 6 座建築解鎖', ok: () => stats.destroyed >= 6 } },
  { id: 'tornado', n: '龍捲風', k: '🌪', tip: '點地面：龍捲風掃過去',
    lock: { txt: '累計擊飛 1000 塊解鎖', ok: () => stats.smashed >= 1000 } },
  { id: 'bomb', n: '定時炸彈', k: '💣', tip: '點一下：放一顆炸彈，3 秒後炸開',
    lock: { txt: '拆掉 10 座建築解鎖', ok: () => stats.destroyed >= 10 } },
  { id: 'nuke', n: '核彈', k: '☢', tip: '點一下：2 秒後天上掉核彈下來',
    lock: { txt: '累計擊飛 3000 塊解鎖', ok: () => stats.smashed >= 3000 } },
  { id: 'magic', n: '爆裂魔法', k: '🔮', tip: '點一下：魔法陣一層層展開，6 秒後爆炸',
    lock: { txt: '拆掉 15 座建築解鎖', ok: () => stats.destroyed >= 15 } }
];
const toolOk = t => !t.lock || t.lock.ok();
/* 這幾種點空地也算數：它們的用法就是「選一個地點」，
   規定一定要點到建築的話，站在旁邊的空地放炸彈反而做不到。 */
const GROUND_TOOL = { tornado: 1, treb: 1, bomb: 1, nuke: 1, magic: 1 };
let tool = 'hammer';

let hammerR = 5.5, hammerPow = 15;
let swing = null;     // 正在揮下去的槌子
let ball = null;      // 飛行中的鐵球
let twist = null;     // 作用中的龍捲風
let bombs = null;     // 已放下、倒數中的定時炸彈
let nuke = null;      // 已呼叫的核彈（倒數或下墜中）
let magic = null;     // 正在展開的魔法陣
const hot = [];       // 火球粒子（走不透明那顆材質，才亮得起來）
const fxRings = [];   // 地面衝擊環與蘑菇雲腰環
const clouds = [];    // 正在成形的蘑菇雲（會隨時間往上長，不是一次生出來）

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
let supportDirty = false, supportT = 0, supFresh = false;
function markSupportDirty(delay) {
  supportDirty = true;
  supportT = delay === undefined ? 0.08 : delay;
}
/* 需要「當下就正確」的支撐狀態時用這個（例如積木正要落定的那一刻）。
   快取最多會差 0.08 秒，拿舊的去判會誤判成沒支撐而白白把積木丟掉。
   每幀最多重算一次，成本才不會失控。 */
function freshSupport() {
  if (supportDirty && !supFresh) { computeSupport(); supFresh = true; }
}
/* 支撐狀態：哪些格子連得到地面（supSeen）、哪些懸空部件還撐著（supStand）。
   垮塌判定與派工判定共用同一份，才不會出現「這邊說垮、那邊照蓋」。 */
let supSeen = null, supStand = null;
const isHere = i => bp.slots[i].filled || bp.slots[i].claimed >= 0;
function supported(i) {
  if (!supSeen || !isHere(i)) return false;
  const s = bp.slots[i];
  return s.anchor ? !!supSeen[i] : (s.fg >= 0 ? !!supStand[s.fg] : true);
}
function computeSupport() {
  if (!bp || !bp.at) return;
  const S = bp.slots, n = S.length;
  if (!supSeen || supSeen.length !== n) supSeen = new Uint8Array(n); else supSeen.fill(0);
  const stack = [];
  for (let i = 0; i < n; i++) if (S[i].gy === 0 && isHere(i)) { supSeen[i] = 1; stack.push(i); }
  while (stack.length) {
    const s = S[stack.pop()];
    for (let k = 0; k < NBR.length; k++) {
      const d = NBR[k];
      const j = bp.at.get(gkeyOf(s.gx + d[0], s.gy + d[1], s.gz + d[2]));
      if (j === undefined || supSeen[j] || !isHere(j)) continue;
      supSeen[j] = 1; stack.push(j);
    }
  }
  /* 懸空部件從「全部先當作沒支撐」開始往上長，而不是反過來往下拆。
     方向反了的話，兩組互相當對方靠山的部件（例如 101 疊起來的八節）
     會形成循環支撐，誰都不會倒。 */
  const F = bp.floats;
  if (!supStand || supStand.length !== F.length) supStand = new Uint8Array(F.length);
  else supStand.fill(0);
  let changed = true;
  while (changed) {
    changed = false;
    for (let gi = 0; gi < F.length; gi++) {
      if (supStand[gi]) continue;
      const g = F[gi];
      if (!g.props.length) { supStand[gi] = 1; changed = true; continue; }  // 找不到靠山的永遠豁免
      let alive = 0;
      for (let k = 0; k < g.props.length; k++) if (supported(g.props[k])) alive++;
      if (alive > g.props.length * 0.25) { supStand[gi] = 1; changed = true; }
    }
  }
}

/* 這一格現在蓋得起來嗎？沒有這道檢查的話，地基被敲掉之後
   小人會繼續往上疊，蓋出一整片浮在半空的積木。 */
function canPlace(i) {
  const s = bp.slots[i];
  if (s.gy === 0) return true;                       // 貼地那層永遠可以蓋
  if (!s.anchor) return s.fg >= 0 ? !!supStand[s.fg] : true;
  for (let k = 0; k < NBR.length; k++) {
    const d = NBR[k];
    const j = bp.at.get(gkeyOf(s.gx + d[0], s.gy + d[1], s.gz + d[2]));
    if (j !== undefined && supported(j)) return true;
  }
  return false;
}

function collapseUnsupported() {
  if (!bp || !bp.at) return 0;
  computeSupport();
  const S = bp.slots, n = S.length;
  const seen = supSeen;
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

  // 撐不住的懸空部件整組掉下來
  const F = bp.floats;
  if (F) for (let gi = 0; gi < F.length; gi++) {
    if (supStand[gi]) continue;
    const cells = F[gi].cells;
    for (let k = 0; k < cells.length; k++) fell += drop(cells[k]);
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
function smash(point, dir, R0, pow0) {
  const R = R0 || hammerR, R2 = R * R;
  const power = pow0 || hammerPow;
  let hitN = 0;
  for (const b of blocks) {
    if (b.st !== SET) continue;
    const dx = b.x - point.x, dy = b.y - point.y, dz = b.z - point.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 <= R2) {
      const d = Math.sqrt(d2);
      const f = Math.pow(1 - d / R, 0.65) * power;
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
function launchHammer(point, dir, big) {
  if (swing && !swing.hit) resolveSwing();        // 連點時先把上一槌結算掉，不要吃掉那一擊
  /* 側揮：揮動平面取「螢幕右方 × 世界上方」，弧線正對著鏡頭掃過來。
     沿著視線方向直直砸下去的話，槌子從頭到尾都是端面朝你，看不出那是一支槌子。 */
  let rx = -dir.z, rz = dir.x;
  const rl = Math.hypot(rx, rz);
  if (rl < 1e-4) { rx = 1; rz = 0; } else { rx /= rl; rz /= rl; }
  swingSide = -swingSide;                          // 左右輪流，連續砸才不會每次都同一邊
  swing = { px: point.x, py: point.y, pz: point.z,
            dx: dir.x, dy: dir.y, dz: dir.z,
            rx: rx * swingSide, rz: rz * swingSide, t: 0, hit: false, big: !!big };
  sndSwing();
}
function resolveSwing() {
  if (!swing || swing.hit) return 0;
  swing.hit = true;
  const m = swing.big ? 2 : 1;                   // 大槌：範圍兩倍、力道再多五成
  return smash({ x: swing.px, y: swing.py, z: swing.pz },
               { x: swing.dx, y: swing.dy, z: swing.dz },
               hammerR * m, hammerPow * (swing.big ? 1.5 : 1));
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
     槌柄方向就是「支點 → 槌頭」。大槌整支放大，揮臂也要跟著加長。 */
  const m = s.big ? 2 : 1;
  const arm = SWING_ARM * (s.big ? 1.55 : 1);
  const hx = s.px + arm * st * s.rx;
  const hy = s.py + arm * (1 - ct);
  const hz = s.pz + arm * st * s.rz;
  ENG.setHammer(hx, hy, hz, hx + st * s.rx, hy - ct, hz + st * s.rz, 0, m);
}

/* ── 投石機 ─────────────────────────────────────────────
   四周架起幾台，朝建築中心附近隨機丟石頭，走拋物線砸下來。 */
const TREB_MAX = 8, TREB_SHOTS = 5, ROCK_R = 4.6, ROCK_POW = 12;
let trebs = null;
/* 點一下就在那個位置架一台。點在建築上的話推到外圍，
   不然機台會直接長在牆裡面。 */
function placeTreb(point) {
  if (!trebs) trebs = { list: [], rocks: [] };
  if (trebs.list.length >= TREB_MAX) trebs.list.shift();
  let x = point.x, z = point.z;
  const d = Math.hypot(x, z), minD = siteR + 5;
  if (d < minD) {
    const a = d < 0.01 ? Math.random() * Math.PI * 2 : Math.atan2(z, x);
    x = Math.cos(a) * minD; z = Math.sin(a) * minD;
  }
  // 面向工地中心：rotation.y = a 之後 local +Z 會指到 (sin a, 0, cos a)
  trebs.list.push({ x, z, a: Math.atan2(-x, -z), arm: -0.8, next: 0.4, left: TREB_SHOTS, idle: 0 });
  sndWind();
}
function fireRock(m) {
  // 落點以建築中心為準隨機取（開根號讓分布均勻，不然會全擠在中心）
  const a = Math.random() * Math.PI * 2;
  const rad = Math.sqrt(Math.random()) * siteR * 0.85;
  const tx = Math.cos(a) * rad, tz = Math.sin(a) * rad;
  // 目標高度取那附近最高的積木，石頭才會砸在建築上而不是穿進去才炸
  let ty = 0;
  for (const b of blocks) {
    if (b.st !== SET) continue;
    if (Math.abs(b.x - tx) > 1.8 || Math.abs(b.z - tz) > 1.8) continue;
    if (b.y > ty) ty = b.y;
  }
  const sy = 4.4, T = 1.7;
  trebs.rocks.push({
    x: m.x, y: sy, z: m.z,
    vx: (tx - m.x) / T, vz: (tz - m.z) / T,
    vy: (ty + 0.6 - sy) / T + 0.5 * GRAV * T,     // 解拋物線：湊出剛好 T 秒抵達
    T, t: 0, rx: 0, ry: 0, s: rr(1.3, 2.1)
  });
  m.arm = 1.35;
  sndSwing();
}
/* 石頭飛行途中撞到建築就當場炸開，撞在哪就從哪散。
   只在終點判定的話，弧線會從屋頂、外牆直接穿過去——畫面上明明砸中了卻什麼事都沒有。
   一幀最多前進一格出頭，所以沿著這一幀走過的線段取樣，不能只測終點位置。 */
const ROCK_STEP = 0.4;              // 掃掠取樣間距，要小於一格才不會整格跳過去
function sweepRock(r, px, py, pz) {
  if (blockAt(r.x, r.y, r.z)) return true;      // 這一幀停的位置本身就埋在積木裡
  const dx = r.x - px, dy = r.y - py, dz = r.z - pz;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-5) return false;
  // 掃過這一幀走的線段，末端再多探一個石頭半徑：碰到的該是石頭的正面，
  // 不是等重心埋進積木裡才算
  const total = len + r.s * 0.5;
  const n = Math.ceil(total / ROCK_STEP);
  const ux = dx / len, uy = dy / len, uz = dz / len;
  for (let k = 1; k <= n; k++) {
    const t = total * k / n;
    if (blockAt(px + ux * t, py + uy * t, pz + uz * t)) {
      const c = Math.min(t, len);                // 停在撞擊點，但別飛過這一幀該到的位置
      r.x = px + ux * c; r.y = py + uy * c; r.z = pz + uz * c;
      return true;
    }
  }
  return false;
}
function rockHit(r) {
  const p = { x: r.x, y: Math.max(0.5, r.y), z: r.z };
  const n = smash(p, { x: 0.12, y: -1, z: 0.12 }, ROCK_R, ROCK_POW);
  spawnDust(p, ROCK_R, n);
  spawnRing({ x: p.x, y: 0, z: p.z }, 5);
  ENG.shake(0.34);
  sndSmash();
}
function stepTrebs(dt) {
  if (!trebs) return;
  for (let i = trebs.list.length - 1; i >= 0; i--) {
    const m = trebs.list[i];
    m.arm += (-0.8 - m.arm) * Math.min(1, dt * 5);   // 甩出去之後慢慢拉回待發位置
    if (m.left > 0) {
      m.next -= dt;
      if (m.next <= 0) { m.next = rr(1.2, 2); m.left--; fireRock(m); }
    } else {
      m.idle += dt;                                  // 打完站一下再撤走
      if (m.idle > 3.5) trebs.list.splice(i, 1);
    }
  }
  for (let i = trebs.rocks.length - 1; i >= 0; i--) {
    const r = trebs.rocks[i];
    const px = r.x, py = r.y, pz = r.z;
    r.t += dt;
    r.vy -= GRAV * dt;
    r.x += r.vx * dt; r.y += r.vy * dt; r.z += r.vz * dt;
    r.rx += dt * 3.2; r.ry += dt * 2.4;
    if (sweepRock(r, px, py, pz) || r.t >= r.T || r.y <= 0.6) {
      trebs.rocks.splice(i, 1); rockHit(r);
    }
  }
  if (!trebs.list.length && !trebs.rocks.length) { trebs = null; ENG.putTrebs([]); ENG.putRocks([]); }
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

/* ── 爆炸 ───────────────────────────────────────────────
   炸彈、核彈、魔法共用的出口。跟槌子的差別是「沒有揮擊方向」——
   純徑向往外加一股上抬，所以積木是往四面八方噴，不是被打向某一側。 */
function explode(point, R, power, magic) {
  const R2 = R * R;
  let n = 0;
  for (const b of blocks) {
    if (b.st !== SET && b.st !== FREE) continue;   // 小人手上跟飛行中的不動它
    const dx = b.x - point.x, dy = b.y - point.y, dz = b.z - point.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > R2) { if (b.st === SET && d2 < R2 * 1.7) b.wob = 0.55; continue; }
    const d = Math.sqrt(d2), ol = Math.max(0.7, d);
    const f = Math.pow(1 - d / R, 0.55) * power;   // 越靠近炸點噴越遠
    const wasSet = b.st === SET;
    /* 垂直分量一律往上：照 dy 的正負給的話，炸點底下的積木會被往地面壓，
       看起來像陷進地裡而不是被炸開。 */
    breakBlock(b,
      dx / ol * f + rr(-2, 2),
      Math.abs(dy) / ol * f * 0.45 + f * 0.3 + rr(2, 7),
      dz / ol * f + rr(-2, 2));
    if (wasSet) n++;
  }
  afterHit(n, point, R);
  /* 就算一塊都沒炸到（點在空地上），站在火球裡的人照樣要被掀倒。
     afterHit 在 n=0 時會直接 return，所以這裡自己來一次。 */
  for (const w of workers) {
    if (w.fall <= 0 && Math.hypot(w.x - point.x, w.z - point.z) < R) {
      w.fall = rr(1.2, 2.6); releaseWorker(w); sndFall();
    }
  }
  spawnBlast(point, R, magic);
  spawnDust(point, R, n);
  spawnRing(point, R);
  ENG.shake(0.5 + Math.min(1.8, R * 0.03 + n * 0.015));
  sndBoom(R);
  return n;
}

/* ── 定時炸彈 ───────────────────────────────────────────
   放下去 3 秒後炸，範圍跟大槌一樣。點在牆上就黏在牆上，
   點在地上就擺在地上——「在點選的地方」就是字面意思。 */
const BOMB_MAX = 6, BOMB_FUSE = 3, BOMB_R = 11, BOMB_POW = 17;
function placeBomb(point) {
  if (!bombs) bombs = [];
  if (bombs.length >= BOMB_MAX) bombs.shift();      // 放太多顆就把最早那顆擠掉
  bombs.push({ x: point.x, y: Math.max(0.6, point.y), z: point.z,
               t: BOMB_FUSE, beep: 0, blink: 0, a: rr(0, 6.28) });
  sndTick();
}
function stepBombs(dt) {
  if (!bombs) return;
  for (let i = bombs.length - 1; i >= 0; i--) {
    const b = bombs[i];
    b.t -= dt;
    // 嗶聲與閃燈越接近爆炸越急，最後一秒幾乎是連續的
    b.beep -= dt;
    if (b.beep <= 0) { b.beep = Math.max(0.1, b.t * 0.3); b.blink = 1; sndTick(); }
    else if (b.beep < 0.06) b.blink = 0;
    if (b.t <= 0) {
      bombs.splice(i, 1);
      explode({ x: b.x, y: b.y, z: b.z }, BOMB_R, BOMB_POW);
    }
  }
  if (!bombs.length) bombs = null;
}

/* ── 核彈 ───────────────────────────────────────────────
   點下去先在地上標一圈、拉警報，2 秒後彈體才從天上掉下來。
   倒數期間什麼都不畫的話，前兩秒看起來就像點了沒反應。
   一次只有一顆：倒數中再點會改打新的地點。 */
const NUKE_WAIT = 2, NUKE_FALL = 0.8, NUKE_TOP = 130, NUKE_R = 30, NUKE_POW = 34;
function callNuke(point) {
  nuke = { x: point.x, z: point.z, t: NUKE_WAIT + NUKE_FALL, mark: 0, spin: 0 };
  sndSiren();
}
function stepNuke(dt) {
  if (!nuke) return;
  nuke.t -= dt;
  nuke.spin += dt * 1.7;
  if (nuke.t > NUKE_FALL) {
    nuke.mark -= dt;
    if (nuke.mark <= 0) { nuke.mark = 0.5; spawnRing({ x: nuke.x, y: 0, z: nuke.z }, 6); }
  } else if (nuke.t > 0) {
    const k = nuke.t / NUKE_FALL;                  // 1 → 0
    ENG.setNuke(nuke.x, k * k * NUKE_TOP + 3, nuke.z, nuke.spin);   // 平方 = 越掉越快
  } else {
    const p = { x: nuke.x, y: 2.5, z: nuke.z };
    nuke = null;
    ENG.hideNuke();
    explode(p, NUKE_R, NUKE_POW);
    startCloud(p, NUKE_R, false);
  }
}

/* ── 爆裂魔法 ───────────────────────────────────────────
   魔法陣一層層往外長，最外圈就是等一下的爆炸範圍——
   讓你在那六秒裡看得出來會炸到哪。一次只有一個，再點會移到新的地點重來。 */
const MAG_TIME = 6, MAG_R = 30, MAG_POW = 34, MAG_LAYERS = 4;
const MAG_GAP = 1.1, MAG_GROW = 0.5;      // 每隔多久長一層、一層長多久
function castMagic(point) {
  magic = { x: point.x, z: point.z, t: MAG_TIME, spin: 0, shown: 0 };
  sndRune(0);
}
function stepMagic(dt) {
  if (!magic) return;
  magic.t -= dt;
  const el = MAG_TIME - magic.t;
  // 越接近爆炸轉越快，最後那一下像是要甩出去
  magic.spin += dt * (1.1 + Math.pow(el / MAG_TIME, 2) * 7);
  if (magic.t <= 0) {
    const p = { x: magic.x, y: 1.5, z: magic.z };
    magic = null;
    explode(p, MAG_R, MAG_POW, true);
    startCloud(p, MAG_R, true);       // 魔法爆完也留一朵，只是燒的是紅光還帶星光
    return;
  }
  const rings = [];
  for (let i = 0; i < MAG_LAYERS; i++) {
    const g = (el - i * MAG_GAP) / MAG_GROW;       // 這一層長到幾成
    if (g <= 0) break;
    const k = Math.min(1, g);
    rings.push({
      x: magic.x, z: magic.z, sp: 1,
      r: MAG_R * (0.31 + i * 0.23) * (0.55 + 0.45 * k),   // 長出來的時候由小擴到定位
      y: 0.12 + i * 0.06,                                  // 每層墊高一點，免得互相 z-fighting
      spin: magic.spin * (i % 2 ? -1.35 : 1) * (1 + i * 0.15),   // 一層順一層逆
      op: k
    });
  }
  if (rings.length > magic.shown) { magic.shown = rings.length; sndRune(magic.shown - 1); }
  magic.rings = rings;
}

/* ── 爆炸特效 ─────────────────────────────────────────────
   三層東西疊出來的：正中央一顆白閃、往外膨脹的火球、貼地掃出去的衝擊環。
   火球走 hot（不透明材質）而不是塵霧——塵霧那顆固定 50% 透明，
   火球混在裡面只會像幾片橘色玻璃，飛塊一擋就完全看不到了。 */
const HOT_MAX = 220;
function spawnBlast(p, R, magic) {
  const n = Math.min(96, 22 + Math.round(R * 2.4));
  for (let i = 0; i < n; i++) {
    if (hot.length >= HOT_MAX) break;
    const a = Math.random() * Math.PI * 2;
    const u = Math.pow(Math.random(), 0.6);              // 中間密、外圍疏
    const rad = u * R * 0.5;
    const up = Math.random() * R * 0.3;
    /* 顏色照半徑分：核心亮黃、外圍橘。整團都給接近白的話，
       近看就只是一片奶油色，看不出是火。 */
    const core = u < 0.35;
    hot.push({
      x: p.x + Math.cos(a) * rad, y: p.y + up * 0.6 + 0.5, z: p.z + Math.sin(a) * rad,
      vx: Math.cos(a) * rad * 1.5, vy: 2 + up * 1.3, vz: Math.sin(a) * rad * 1.5,
      rx: Math.random() * 6, ry: Math.random() * 6,
      s: rr(0.6, 1) * (0.8 + R * 0.055), life: rr(0.45, 1.1),
      g: -1.5, grow: 1.25, cool: rr(0.5, 0.9),
      cr: 1, cg: core ? rr(0.78, 0.92) : rr(0.34, 0.5), cb: core ? rr(0.3, 0.5) : rr(0.04, 0.12),
      to: magic ? [0.85, 0.12, 0.32] : [0.5, 0.12, 0.03]            // 冷成暗紅／暗橘
    });
  }
  // 正中央那顆閃光：白、兩三幀就收掉。爆炸的「一下」就是靠它，太大會整個畫面糊掉
  for (let i = 0; i < 6; i++) {
    if (hot.length >= HOT_MAX) break;
    const a = Math.random() * Math.PI * 2;
    hot.push({
      x: p.x + Math.cos(a) * R * 0.1, y: p.y + rr(0.5, R * 0.16), z: p.z + Math.sin(a) * R * 0.1,
      vx: 0, vy: 3, vz: 0, rx: Math.random() * 6, ry: Math.random() * 6,
      s: R * rr(0.12, 0.2), life: rr(0.12, 0.2), g: -1, grow: 0.4, cool: 0.2,
      cr: 1, cg: 1, cb: rr(0.8, 0.95), to: magic ? [1, 0.5, 0.6] : [1, 0.75, 0.3]
    });
  }
  // 貼地往外掃的兩圈光。參考圖裡那幾道橫向的環就是這個
  const c = magic ? 0xff3b6b : 0xffb038;
  for (let i = 0; i < 2; i++)
    fxRings.push({ x: p.x, z: p.z, y: 0.16 + i * 0.12, r: R * 0.2, vr: R * (2.2 - i * 0.8),
                   op: 1, fade: 0.5 + i * 0.3, c, add: 1, spin: rr(0, 6.28) });
}

/* ── 蘑菇雲 ───────────────────────────────────────────────
   不是一次生出來的：柱子先往上冒，半秒後才在頂端撐出傘蓋，同時腰上出現一圈環。
   一次生完的話它會「啪」地整朵出現在半空，看起來像貼圖不像爆炸長出來的。
   火光在裡面燒約 0.8 秒再冷掉，那是參考圖裡雲心會發亮的來源。 */
const CLOUD_GROW = 2.4;         // 整朵長完要多久
function startCloud(p, R, magic) { clouds.push({ x: p.x, z: p.z, R, magic, t: 0, emit: 0 }); }
function stepClouds(dt) {
  for (let i = clouds.length - 1; i >= 0; i--) {
    const c = clouds[i], t0 = c.t;
    c.t += dt;
    const R = c.R;
    /* 傘蓋現在爬到哪。柱子要靠這個值決定生到多高——柱子不是「自己往上長」，
       而是「傘蓋往上升，沿路留下來的那一條」。
       兩邊都從地面往上噴的話會混成一團胖雲，看不出蘑菇的頸子。 */
    const capY = R * 0.28 + Math.max(0, c.t - 0.45) * 5;
    if (c.t < 1.3) {
      c.emit += dt * 40;
      while (c.emit >= 1) {
        c.emit--;
        const a = Math.random() * Math.PI * 2, rad = rr(0.2, R * 0.07);
        const x = c.x + Math.cos(a) * rad, z = c.z + Math.sin(a) * rad;
        if (c.t < 0.8 && hot.length < HOT_MAX)      // 柱心的火光
          hot.push({ x, y: rr(0.6, Math.max(3, capY * 0.7)), z,
            vx: Math.cos(a) * 0.6, vy: rr(2, 5), vz: Math.sin(a) * 0.6,
            rx: Math.random() * 6, ry: Math.random() * 6,
            s: rr(1, 2.2), life: rr(0.5, 1.1), g: 1.4, grow: 1.04, cool: rr(0.4, 0.8),
            cr: 1, cg: rr(0.62, 0.86), cb: rr(0.16, 0.4),
            to: c.magic ? [0.9, 0.15, 0.4] : [0.6, 0.16, 0.04] });
        if (dust.length < 520)                       // 柱子的煙：沿著整根柱子生
          dust.push({ x, y: rr(0.6, capY * 0.92), z,
            vx: Math.cos(a) * rr(0.2, 1.2), vy: rr(0.8, 2.4), vz: Math.sin(a) * rr(0.2, 1.2),
            rx: Math.random() * 6, ry: Math.random() * 6,
            life: rr(6, 8.5), s: rr(1.4, 3), c: rr(0.34, 0.56), g: 1.4, fade: 4,
            cr: c.magic ? 0.55 : undefined, cg: c.magic ? 0.24 : 0, cb: c.magic ? 0.28 : 0 });
      }
    }
    /* 傘蓋：0.45 秒時一次撐開，然後自己往上升。
       生在柱子上方、給比柱子快的初速，收尾就是「上面一團、下面一根」。 */
    if (t0 < 0.45 && c.t >= 0.45) {
      const H = R * 0.28;
      for (let k = 0; k < 84; k++) {
        if (dust.length >= 520) break;
        const a = Math.random() * Math.PI * 2;
        const rad = Math.sqrt(rr(0.03, 1)) * R * 0.5;
        dust.push({
          x: c.x + Math.cos(a) * rad, y: H + rr(-R * 0.05, R * 0.1), z: c.z + Math.sin(a) * rad,
          vx: Math.cos(a) * rr(0.4, 2), vy: rr(5, 6.5), vz: Math.sin(a) * rr(0.4, 2),
          rx: Math.random() * 6, ry: Math.random() * 6,
          life: rr(6.5, 9), s: rr(3, 5.6), c: rr(0.18, 0.42), g: 1.8, fade: 4.5,
          cr: c.magic ? 0.52 : undefined, cg: c.magic ? 0.2 : 0, cb: c.magic ? 0.24 : 0
        });
      }
      for (let k = 0; k < 34; k++) {                 // 傘蓋裡的火光，燒一下就冷掉
        if (hot.length >= HOT_MAX) break;
        const a = Math.random() * Math.PI * 2;
        const rad = Math.sqrt(rr(0.02, 1)) * R * 0.34;
        hot.push({
          x: c.x + Math.cos(a) * rad, y: H + rr(0, R * 0.06), z: c.z + Math.sin(a) * rad,
          vx: Math.cos(a) * rr(0.3, 1.5), vy: rr(5, 6.5), vz: Math.sin(a) * rr(0.3, 1.5),
          rx: Math.random() * 6, ry: Math.random() * 6,
          s: rr(1.6, 3.2), life: rr(0.7, 1.5), g: 1.8, grow: 1.04, cool: rr(0.6, 1.1),
          cr: 1, cg: rr(0.68, 0.9), cb: rr(0.2, 0.45),
          to: c.magic ? [0.9, 0.15, 0.4] : [0.55, 0.14, 0.04]
        });
      }
      // 腰上那一圈：參考圖裡最好認的特徵
      fxRings.push({ x: c.x, z: c.z, y: R * 0.13, r: R * 0.2, vr: R * 0.4, vy: R * 0.07,
                     op: 0.9, fade: 1.4, c: c.magic ? 0xff5577 : 0xffd08a, add: 1, spin: rr(0, 6.28) });
    }
    /* 魔法版另外撒星光：參考圖的那些小星星。不冷卻，就是一閃一閃地飄上去 */
    if (c.magic && c.t < 1.8 && Math.random() < dt * 26 && hot.length < HOT_MAX) {
      const a = Math.random() * Math.PI * 2, rad = rr(0.2, 1) * R * 0.5;
      hot.push({
        x: c.x + Math.cos(a) * rad, y: rr(1, R * 0.4), z: c.z + Math.sin(a) * rad,
        vx: 0, vy: rr(3, 7), vz: 0, rx: Math.random() * 6, ry: Math.random() * 6,
        s: rr(0.35, 0.8), life: rr(0.7, 1.6), g: 0.6, grow: 0.75,
        cr: 1, cg: rr(0.55, 0.9), cb: 1
      });
    }
    if (c.t > CLOUD_GROW) clouds.splice(i, 1);
  }
}

/* 火球粒子。跟塵霧分開走一套：會冷卻（顏色往暗紅收）、會膨脹或縮小 */
function stepHot(dt) {
  for (let i = hot.length - 1; i >= 0; i--) {
    const d = hot[i];
    d.life -= dt;
    if (d.life <= 0) { hot.splice(i, 1); continue; }
    d.vy -= (d.g === undefined ? -1.5 : d.g) * dt;
    d.vx *= 0.9; d.vz *= 0.9;
    d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
    if (d.y < 0.4) { d.y = 0.4; d.vy = Math.max(0, d.vy); }
    d.rx += dt * 1.6; d.ry += dt * 2.2;
    if (d.to) {                                   // 亮黃 → 橘 → 暗紅
      const k = Math.min(1, dt / d.cool);
      d.cr += (d.to[0] - d.cr) * k;
      d.cg += (d.to[1] - d.cg) * k;
      d.cb += (d.to[2] - d.cb) * k;
    }
    if (d.grow) d.s *= Math.pow(d.grow, dt * 6);
  }
}
/* 地面上的光環：往外擴、淡掉就消失 */
function stepFxRings(dt) {
  for (let i = fxRings.length - 1; i >= 0; i--) {
    const f = fxRings[i];
    f.r += f.vr * dt;
    if (f.vy) f.y += f.vy * dt;
    f.op -= dt / f.fade;
    if (f.op <= 0) fxRings.splice(i, 1);
  }
}

/* 玩家在畫面上點一下的入口。tool 決定用哪個道具 */
function useTool(hit) {
  // 記在最前面：手指也算一種道具，成就要的是「六種都試過」
  if (stats.tools.indexOf(tool) < 0) { stats.tools.push(tool); checkBadges(); }
  if (tool === 'finger') return 0;                 // 手指什麼都不破壞，只有戳小人有效
  if (tool === 'hammer') { launchHammer(hit.point, hit.dir, false); return 0; }
  if (tool === 'bighammer') { launchHammer(hit.point, hit.dir, true); return 0; }
  if (tool === 'ball') { launchBall(hit.point, hit.dir); return 0; }
  if (tool === 'treb') { placeTreb({ x: hit.point.x, z: hit.point.z }); return 0; }
  if (tool === 'tornado') { launchTornado({ x: hit.point.x, z: hit.point.z }); return 0; }
  if (tool === 'bomb') { placeBomb(hit.point); return 0; }
  if (tool === 'nuke') { callNuke({ x: hit.point.x, z: hit.point.z }); return 0; }
  if (tool === 'magic') { castMagic({ x: hit.point.x, z: hit.point.z }); return 0; }
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
    // g 給負的就是會往上飄（火球、蘑菇雲）；沒給就是一般會落下的煙塵
    d.vy -= (d.g === undefined ? 7 : d.g) * dt; d.vx *= 0.94; d.vz *= 0.94;
    d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
    if (d.y < 0.1) { d.y = 0.1; d.vy = 0; d.vx *= 0.8; d.vz *= 0.8; }
    // 要慢慢淡掉的（蘑菇雲）用縮的。單靠 life 到期會「啪」地整團同時不見
    if (d.fade) d.s *= Math.pow(0.5, dt / d.fade);
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

  panStep(Math.min(0.05, raw));
  step(dt);
  draw();
  ENG.render();
  hudTick(now);
}

/* 把一步拆出來，測試才能不靠 rAF 直接推進模擬 */
function step(dt) {
  supFresh = false;
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
    // 剩下沒打到的那些跟著整棟報廢，也要計進損失
    const writeOff = placedCnt * WRECK_COST;
    stats.wrecked += writeOff; lossThis += writeOff;
    toast('💥 ' + bp.name + ' 拆除完畢',
          '損失 ' + money(lossThis) + '　·　累計拆掉 ' + stats.destroyed + ' 座');
    checkBadges(); save(); renderTools();
    startBuild(false);
  }
  stepSwing(dt);
  stepBall(dt);
  stepTwist(dt);
  stepTrebs(dt);
  stepBombs(dt);
  stepNuke(dt);
  stepMagic(dt);
  stepClouds(dt);
  stepHot(dt);
  stepFxRings(dt);
  stepDozers(dt);
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
  ENG.putTrebs(trebs ? trebs.list : EMPTY);
  ENG.putRocks(trebs ? trebs.rocks : EMPTY);
  ENG.putBombs(bombs || EMPTY);
  ENG.putFire(hot);
  /* 魔法陣與爆炸光環共用同一組環，在這裡合起來丟過去。
     魔法陣的那幾層每幀由 stepMagic 算好，爆炸那幾圈自己會擴散。 */
  if (magic && magic.rings) ENG.setRings(magic.rings.concat(fxRings));
  else if (fxRings.length) ENG.setRings(fxRings);
  else ENG.hideRings();
  if (dozers) ENG.putDozers(dozRender(dozers));
}
const EMPTY = [];

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
  // 這幾種點空地也算（本來就是「選一個地點」）；其他工具要點到建築
  if (hit.kind === 'block' || GROUND_TOOL[tool]) useTool(hit);
}

/* ── 鍵盤平移鏡頭 ─────────────────────────────────────────
   用 e.code（實體鍵位）不是 e.key：非 QWERTY 的鍵盤排列也是同樣那四顆鍵的位置。 */
const PAN_KEY = { KeyW: [1, 0], KeyS: [-1, 0], KeyA: [0, -1], KeyD: [0, 1] };
const keyDown = Object.create(null);

function onKey(e) {
  if (!PAN_KEY[e.code]) return;
  /* 只擋下拉選單：字母鍵在 select 上是拿來跳選項的。
     滑桿與核取方塊吃的是方向鍵與空白鍵，跟 WASD 不衝突，
     一起擋掉的話「剛拉完滑桿就按不動鏡頭」反而莫名其妙。 */
  if (e.target && e.target.tagName === 'SELECT') return;
  keyDown[e.code] = e.type === 'keydown';
}
// 按著 W 切去別的視窗，keyup 收不到，切回來鏡頭會自己一直飄
function clearKeys() { for (const k in keyDown) keyDown[k] = false; }

/* 用真實時間推進，不吃時間倍率——開四倍速不該讓鏡頭也快四倍 */
function panStep(dt) {
  let f = 0, s = 0;
  for (const k in PAN_KEY) if (keyDown[k]) { f += PAN_KEY[k][0]; s += PAN_KEY[k][1]; }
  if (!f && !s) return;
  const n = Math.hypot(f, s);             // 斜著按兩顆不該比只按一顆快
  ENG.pan(f / n, s / n, dt);
}

/* ── HUD ────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
let hudLast = 0;
const pad2 = n => (n < 10 ? '0' : '') + n;
function fmtClock(d) { return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()); }
function fmtDur(s) { return Math.floor(s / 60) + ':' + pad2(Math.floor(s % 60)); }

const money = v => '$' + Math.round(v).toLocaleString('en-US');

const PHASE_TXT = { clear: ['整地中', ''], build: ['施工中', ''], done: ['完工', 'ok'], wreck: ['拆除中', 'bad'] };

function hudTick(now) {
  if (now - hudLast < 120) return;
  hudLast = now;
  $('clock').textContent = fmtClock(new Date());
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
  $('lossAll').textContent = money(stats.wrecked);
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
  $('badgeLoss').textContent = money(stats.wrecked);
  $('badgeDest').textContent = stats.destroyed;
  $('badgeSmash').textContent = stats.smashed.toLocaleString('en-US');
}
function renderToasts() {
  $('toast').innerHTML = toasts.map(t =>
    '<div class="t"><b>' + t.txt + '</b>' + (t.sub ? '<span>' + t.sub + '</span>' : '') + '</div>').join('');
}

/* ── 啟動 ───────────────────────────────────────────────── */
function boot() {
  $('ver').textContent = 'v' + VERSION;
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
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);
  window.addEventListener('blur', clearKeys);

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





