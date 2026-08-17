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
const VERSION = '1.56.0';

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
/* 面板上的三檔。做成按鈕不是滑桿：這三檔就是「小場地／標準／大場面」，
   中間那些數字沒人特別要，滑桿反而每次都得對半天，手機上更難對。
   這三個陣列是唯一的來源——index.html 只留空盒子，按鈕照這裡生（見 makeSeg）。

   建材開到 9000 是為了自訂藍圖的「相似度」——上萬塊才刻得出招牌、窗框、屋脊那種細節。
   實測 10000 塊時每幀 step 0.20ms + draw 0.77ms（預算 4ms），拆到一半連鎖垮塌時
   平均 2.08ms、最壞單幀 7.2ms（3000 塊時是 0.78／5.8ms）——用 60fps 的 16.7ms 看都還很寬。
   內建那 48 座多半到自己的 hi 就停了（金門大橋 3347、巨石陣 3296），
   真的長得到上萬的是金字塔、長城、城堡、聖家堂、吳哥窟這幾座。
   （藍圖體檢仍然照 300／1600／3000／10000 四個目標量，那是藍圖的事，跟面板無關。） */
const CNT_OPTS = [1800, 3000, 9000];
const WK_OPTS = [20, 40, 60];
const SPD_OPTS = [0.5, 1, 4];
const CNT_MAX = CNT_OPTS[CNT_OPTS.length - 1];
let targetCnt = 3000;
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
/* 同一瞬間放同一支音效，波形會「同相疊加」：每個 OscillatorNode 都從相位 0 起跳、
   頻率又一模一樣，N 個疊起來就是振幅 N 倍的同一個波。
   一發核彈打在建築上會同時掀倒二十個小人 → 二十個一模一樣的 200Hz 方波
   → 實測峰值 0.047 疊成 0.95，幾乎滿刻度的方波。**這才是「炸到建築特別刺耳」的來源**，
   不是爆炸本身（爆炸自己只有 0.144）；炸空地時附近沒那麼多人，所以聽起來就沒事。
   所以同一支音效在 VOICE_WIN 秒內最多疊 VOICE_MAX 個，超過的直接不放——
   二十個一模一樣的聲音本來也聽不出是二十個，只會變大聲。
   計數表綁在 context 上：離線量測時每次都是新的 context（currentTime 恆為 0），
   不跟著換的話第二次之後全部會被當成「同一瞬間」擋掉。 */
const VOICE_WIN = 0.06, VOICE_MAX = 3;
let voiceCtx = null;
const voices = new Map();
function voiceOK(key, c) {
  if (voiceCtx !== c) { voices.clear(); voiceCtx = c; }
  const v = voices.get(key);
  if (!v || c.currentTime - v.t > VOICE_WIN) { voices.set(key, { t: c.currentTime, n: 1 }); return true; }
  if (v.n >= VOICE_MAX) return false;
  v.n++; return true;
}
/* key：把「同一支音效」歸成同一組。不給的話用波形＋音高當 key，
   但音高有抖動的那些（跌倒聲）每次都會算成不同組，所以那種要自己指定。 */
function tone(freq, dur, type, vol, slide, key) {
  const c = audio(); if (!c || muted) return;
  if (!voiceOK(key || (type || 'square') + Math.round(freq), c)) return;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type || 'square'; o.frequency.value = freq;
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), c.currentTime + dur);
  g.gain.setValueAtTime(vol || 0.06, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0008, c.currentTime + dur);
  o.connect(g).connect(c.destination); o.start(); o.stop(c.currentTime + dur);
}
function noise(dur, vol, cut) {
  const c = audio(); if (!c || muted) return;
  if (!voiceOK('noise' + (cut || 900), c)) return;
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
/* 跌倒聲每次抽一個音高：一排人被同一發掀倒時，同音高的那幾聲會疊成「一聲比較大的」，
   抖開之後才聽得出是好幾個人各跌各的（音高抖開也順便讓它們不再完全同相）。 */
function sndFall() { tone(rr(170, 245), 0.16, 'square', 0.05, 0.5, 'fall'); }
function sndSwing() { tone(160, 0.3, 'sine', 0.06, 3.2); }
function sndWind() { noise(1.6, 0.14, 480); }
/* 點火：短促的「噗」一聲。只在點下去那一刻響，每塊都響會變成一片白噪音 */
function sndFire() { noise(0.55, 0.16, 1600); tone(150, 0.4, 'sawtooth', 0.05, 2.4); }
/* 煙火：往上是「咻」（音高一路往上滑），到頂是「啪」 */
function sndFwUp() { tone(260, 1.1, 'sawtooth', 0.035, 4.2); noise(1, 0.045, 1100); }
function sndFwPop() { noise(0.4, 0.16, 2600); tone(120, 0.32, 'square', 0.05, 0.45); }
function sndDozer() { tone(58, 1.1, 'sawtooth', 0.05, 1.3); noise(1.1, 0.07, 260); }
function sndBadge() { [784, 988, 1319].forEach((f, i) => setTimeout(() => tone(f, 0.18, 'triangle', 0.08), i * 90)); }
/* 爆炸：比槌子低一個八度、拖得更長。R 越大轟得越久（炸彈、隕石、核彈、爆裂魔法共用這一支）。
   v1.44.1 調小：它本來是全場最大聲的一發（離線算出來 rms 0.0249，第二名的槌子 0.0143），
   而且**刺**——2 kHz 以上占了 25.1% 的能量。刺的來源幾乎全在噪音那一支：低通切在 900、
   斜率只有 12 dB/oct，2 kHz 那一帶還留著一大截，等於用全場最大的音量放一秒多的高頻嘶聲。
   所以噪音降到 0.26、切點壓到 500，低頻那支跟著從 0.12 降到 0.085。
   波形維持鋸齒不換三角：46 Hz 的基音小喇叭根本推不出來，聽得到的是它的泛音，
   而鋸齒的泛音是 1/n、三角是 1/n²——量過，三角就算開到 0.14（總音量比鋸齒 0.12 還大），
   80–250 Hz 那段也只有 0.0081，還不如鋸齒 0.085 的 0.0084，換過去只會變成一聲悶悶的氣音。
   結果：總 rms 0.0249 → 0.0165（−34%）、2 kHz 以上的能量 −66%，低頻的份量只少 25%。 */
function sndBoom(R) {
  const k = clamp(R / 11, 1, 2.6);
  noise(0.5 * k, 0.26, 500); tone(46, 0.75 * k, 'sawtooth', 0.085, 0.3);
}
/* 砸下來那一下（隕石）：一聲低沉的悶響，不是爆炸。
   跟 sndBoom 比是「短一半、暗一截」——噪音切在 340（爆炸是 500）、拖尾只有 0.3 秒
   （炸彈 0.49、核彈 1.26），聽起來才像一大塊東西撞到地上，而不是又炸了一發。
   離線量出來 rms 0.0085，比炸彈的 0.010 小一點但仍聽得清楚；
   再壓下去（第一版噪音切 250、音量 0.24）只有 0.005，砸掉上千塊卻幾乎沒聲音。 */
function sndThud(R) {
  const k = clamp(R / 11, 0.8, 1.6);
  noise(0.34 * k, 0.34, 340); tone(54, 0.55 * k, 'sawtooth', 0.11, 0.42);
}
function sndTick() { tone(1250, 0.045, 'square', 0.045); }
/* 隕石進大氣層：拖長的低頻呼嘯，滑音往下＝由遠而近砸過來。
   比爆炸本身早一步響，聽到就知道要閃了 */
function sndMeteor() { noise(0.9, 0.22, 700); tone(340, 0.85, 'sawtooth', 0.07, 0.22); }
function sndSiren() { tone(560, 1.1, 'sine', 0.05, 1.7); }
/* 魔法陣長層的音效（sndRune）拿掉了：六層一路響上去太吵，
   而且蓋掉了引力坍縮那一段該有的安靜。爆炸本身的 sndBoom 還在。 */

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
    scale: 1, snap: 0, snapFrom: null, arc: null, wob: 0, al: 1, fallIn: 0,
    burn: 0                              // 1 = 正在燒（狀態本體在 fires 那筆裡）
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
    bp.slots[b.slot].filled = false; bp.slots[b.slot].claimed = -1;
    /* 派工游標退回這個洞。不退的話洞排在游標後面，只有「游標之後找不到任何
       蓋得起來的格子」時才輪得到——地基被炸掉之後小人會先在上面蓋一大段
       （實測中世紀城堡第一塊補回去要 10.5 秒，期間別處先蓋了 350 塊）。
       releaseWorker 放掉認領時本來就是這樣做的，破壞這條路徑漏了。 */
    slotCursor = Math.min(slotCursor, b.slot);
    b.slot = -1;
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
/* 站在這個位置會不會卡進建築裡。小人約 2.2 格高，頭上還頂著一塊建材（頂到 3 格左右），
   所以要看腳邊三層；再高的樓層是從頭頂上過的，不擋路。
   只看兩層的話，人會站到挑出來的樓板底下，手上那塊建材整個埋在樓板裡。 */
function footBlocked(x, z) {
  return blockAt(x, HB, z) || blockAt(x, 1 + HB, z) || blockAt(x, 2 + HB, z);
}
/* 這根柱子從地面往上「連續」疊到第幾層（沒有就 −1）。中間斷掉就不再往上算：
   斷掉上面那些是挑出去的樓板、拱門的上緣，積木是從它們**底下**穿過去的，不是翻過去。
   算成整根最高的話，台北 101 的裙樓格子會被要求拋過四十層高的塔身。 */
function colTop(x, z) {
  let gy = -1;
  while (gy < gMaxY && blockAt(x, gy + 1 + HB, z)) gy++;
  return gy;
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
  /* 小人身上的火跟碎料的火一起收：積木待會要回收去蓋新的那座，
     人也一樣得回去上工，不能有人還在新工地旁邊打滾。 */
  for (const w of workers) {
    releaseWorker(w);
    w.air = 0; w.burn = 0; w.burnK = 0; w.lit = 0; w.roll = 0; w.fall = 0;
    w.y = 0; w.tilt = 0; w.vx = w.vy = w.vz = 0;
  }
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
  quake = null;                       // 地震點名要掉的是「這一座」的積木，換場就作廢
  ball = null; ENG.hideBall();
  ballAim = null;                     // 瞄到一半換場：那個出手點是舊工地的事了
  twists = null; ENG.putTornados([]);
  trebs = null; ENG.putTrebs([]); ENG.putRocks([]);
  dozers = null; ENG.putDozers([]);
  // 倒數中的炸彈／核彈／魔法陣也一樣：留著的話會炸到剛換上來的新建築
  bombs = null; ENG.putBombs([]);
  meteors = null; ENG.putMeteors([]);
  // 還在飛的煙火火星會把剛蓋好的新建築點著；還沒出膛的那幾發也要一起收
  fworks = null; fwSparks = null; fwWait = null;
  nuke = null; ENG.hideNuke();
  magic = null;
  dangers = [];                       // 預告沒了，警戒範圍也要跟著撤
  /* 火也要收：燒的是「哪一塊積木」，積木待會會被回收去蓋新的那座，
     不收的話新建築會從某幾塊莫名地開始燒起來。 */
  clearFires();
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
  /* 第五個參數＝保留現在的視角。開場那一次要取景（不然一進來不知道鏡頭在哪），
     之後每換一座都不再動鏡頭——玩家自己轉好、拉近、平移過的視角不該被搶走。
     草地大小、陰影範圍、霧的起點還是照新工地重算，那些不是「鏡頭」。 */
  ENG.fitCamera(siteR, bp.height, arenaR, !!instant, !instant);
  syncHud();
}

/* ── 整地：推土機 ───────────────────────────────────────
   換建築時上一輪的碎料還躺在工地上，而且不是平均鋪開的——只拿槌子敲的話，
   碎料會全堆在挨打的那一區。所以推土機要做的是「去把堆起來的推散」，
   不是把整片地毯式掃一遍。

   每台機器自己找一坨最密的碎料，從現在的位置直接對準它切進去，一路推到工地
   另一頭出去，再找下一坨。找不到值得推的堆就收工。剩下的零星碎塊在收尾時彈出去，
   不為了那幾塊讓玩家多等好幾秒。

   本來的做法是「先繞到那坨的內側，再朝外推」——推的距離短，聽起來省力，
   但機器得先抬著鏟子穿過整個工地才站得到內側。實測那趟空跑吃掉三成到七成七的
   機器時間，而且六秒半只夠跑完一趟（中世紀城堡整段整地期間只派了三次工），
   碎料有 65～100% 是時間到了直接彈掉的，不是真的被推出去的。
   對穿就沒有這個問題：進了範圍鏟子就放下來，出範圍才抬起來。

   車速是固定的，而且比小人走路快不了多少——推土機本來就該是慢的。
   之前用「一趟固定跑幾秒」回推速度，大工地會飆到每秒 57 單位，看起來像在飛。 */
// 鏟子的寬度與位置直接取畫面那邊的值，判定跟看到的才會是同一把鏟子
const DOZ_W = ENG.DOZ_W, DOZ_FRONT = ENG.DOZ_FRONT;
/* 派幾台看工地多大：地面每這麼多平方單位派一台。時限固定，一台在時限內大概只推得動
   一條線那麼寬，所以工地一大就得靠台數補。固定三台的話大工地根本清不動
   （實測 siteR 44 的工地，六秒半推出去 0 塊，1391 塊全靠收尾彈掉）。
   上限 6 是畫面那邊 MAXDOZ 的容量。 */
const DOZ_AREA = 160;
const DOZ_MIN = 3, DOZ_MAX = 6;
const DOZ_MOVE = 9.5;               // 空鏟趕路的速度
const DOZ_PUSH = 6.5;               // 鏟子上有料時的速度
const DOZ_LOAD = 0.5;               // 鏟到料之後還維持慢速幾秒
const DOZ_TURN = 3.4;               // 轉向角速度（rad/s）
const DOZ_WAIT = 1.3;               // 開工前怠速幾秒，等飛在半空的碎料落地
const DOZ_CELL = 5;                 // 找堆時的格子邊長
const DOZ_HEAP = 12;                // 一格少於這麼多塊就不算「堆」，不值得專程去推
/* 整地最多拖這麼久（含開工前的怠速）。碎料鋪滿整片地時堆推不完，但這是換場的空檔，
   不是關卡——時間到就收工，剩下的彈掉。堆推完了本來就會提早收工，這只是上限。
   試過讓時限跟工地大小走（金門大橋那種橫跨 44 單位的會拉到 11.7 秒），
   換來的只有 7～10% 清除率——多等五秒不值得，維持固定。 */
const DOZ_LIMIT = 6.5;
/* 鏟面後方多深之內都算同一堆，一起往前帶。抓得越深一次帶越多，但也得推得更遠
   才能整堆送出範圍外——不然機器停下時，那一疊的尾巴還留在工地裡。 */
const DOZ_PILE = 7;
/* 派工的距離折價：一坨的分數是「塊數 ÷ (1 + 距離×DOZ_TRIP)」。以前是「最大的那坨先派」，
   結果幾台會為了同一坨橫跨整個工地，路上鏟子還是抬著的——實測那趟空跑吃掉機器
   三成到七成七的時間。就近推小坨的產出反而比較高。
   用比值不用扣分：扣分要跟「塊數」同一個尺度，堆的大小一變就整個歪掉
   （試過每單位扣 2.2 塊，結果所有堆都被扣成負分，機器有一半時間在空轉）。 */
const DOZ_TRIP = 0.12;
let dozers = null;

const siteClearR = () => siteR + 1.4;
/* 鏟子放得下來的範圍，以及一趟推到哪裡才算送出去。
   鏟面在車體前方 DOZ_FRONT，鏟面前那一疊還會再往前延伸 DOZ_PILE，所以車體只要過了
   邊界一點點，整疊就已經在工地外面了。以前設在邊界外 9 單位收手——那多出來的
   七八個單位全是空地，卻要用推料的慢速跑完，實測整趟路線因此被灌水兩成。 */
const dozWorkR = () => siteClearR() + 3;
const dozOutR = () => siteClearR() + 2;
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
  /* 從邊界外一點點進場就好。以前擺在外面 9 單位，光是開到有碎料的地方就吃掉
     時限的兩成——而那段路上什麼都沒有。 */
  const R = siteClearR() + 4;
  const n = clamp(Math.round(Math.PI * siteClearR() ** 2 / DOZ_AREA), DOZ_MIN, DOZ_MAX);
  dozers = {
    t: 0, wait: DOZ_WAIT, done: false,
    list: Array.from({ length: n }, (_, k) => {
      const ang = (k / n + Math.random() * 0.2) * Math.PI * 2;      // 從場邊不同方向開進來
      const x = Math.cos(ang) * R, z = Math.sin(ang) * R;
      // rotation.y = a 會讓車頭（local +Z）指向 (sin a, cos a)，所以面向原點是 atan2(-x, -z)
      return { x, z, a: Math.atan2(-x, -z), st: 'seek', tx: 0, tz: 0, bl: 1, load: 0, k };
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
/* 一趟的路線：從機器現在的位置對準那一坨，穿過去、繼續往前直到出了工作範圍。
   整趟就是一條直線，中間不用掉頭也不用繞路。
   機器剛好站在那一坨上時（幾乎不會發生）就照現在的車頭方向推。 */
function dozPath(m, h) {
  const dx = h.x - m.x, dz = h.z - m.z;
  const d = Math.hypot(dx, dz);
  const fx = d < 0.5 ? Math.sin(m.a) : dx / d;
  const fz = d < 0.5 ? Math.cos(m.a) : dz / d;
  /* 解 |h + f·t| = out，取正根：沿著行進方向從那一坨再往前多遠才出得了工地。 */
  const out = dozOutR();
  const b = h.x * fx + h.z * fz;
  const t = Math.sqrt(Math.max(0, b * b + out * out - h.x * h.x - h.z * h.z)) - b;
  return { tx: h.x + fx * t, tz: h.z + fz * t, len: d + t };
}
/* 挑一坨給這台推：塊數多的優先，但整趟路線越長折價越多。挑走的從清單移除，
   幾台機器才不會擠在同一坨上。回傳 null 表示沒有值得專程去推的了。

   折的是「整趟路線」不是「到那一坨的距離」，而且剩下的時間跑不完的那趟直接當成
   沒價值——跑不完等於把鏟子前面那一疊丟在工地中間，比不推還糟。
   大工地最明顯：不看這條的話，六台會全部挑正中央那一坨最大的（實測路線 81～97 單位、
   時限內連一趟都跑不完），六秒半下來送出工地的是 0 塊。邊上的小坨雖然只有十幾塊，
   但一趟二十幾單位跑得完，真的送得出去。 */
function pickHeap(m, heaps, tLeft) {
  let bi = -1, best = -1, bestP = null;
  for (let i = 0; i < heaps.length; i++) {
    const p = dozPath(m, heaps[i]);
    // 樂觀估：整趟都用空鏟的速度跑。連這樣都來不及的就是真的來不及
    const fit = p.len / DOZ_MOVE <= tLeft ? 1 : 0.05;
    const s = heaps[i].n / (1 + p.len * DOZ_TRIP) * fit;
    if (s > best) { best = s; bi = i; bestP = p; }
  }
  if (bi < 0) return null;
  heaps.splice(bi, 1);
  return bestP;
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
   用車速算的話碎料會跑到鏟子前面去。

   回傳這一幀鏟到幾塊：鏟子空的時候可以開快一點（見 stepDozers）。 */
function pushWithBlade(m, mvx, mvz) {
  const fx = Math.sin(m.a), fz = Math.cos(m.a);        // 車頭方向
  const frontX = m.x + fx * DOZ_FRONT, frontZ = m.z + fz * DOZ_FRONT;
  const mv = Math.hypot(mvx, mvz);
  let n = 0;
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
    n++;
  }
  return n;
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
  /* 怠速等碎料落地。試過讓機器利用這一秒多先開進場中央待命，結果反而變差
     （中世紀城堡 58.5%→45.5%、大象 59.3%→46.5%）：從場中央起步的第一趟太短，
     一下就推出去了，等於少掃了一整條穿過工地的線。 */
  if (D.wait > 0) { D.wait -= dt; return; }
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
  const heaps = listHeaps();
  let idle = 0;
  for (const m of D.list) {
    if (m.st === 'push') {
      /* 鏟子只看位置，不看在跑哪一段：進了工作範圍就放下來推，出了範圍才抬起來。
         速度看鏟子上有沒有料：空鏟就開快的。工地大半是空地，整趟都用推料的慢速跑，
         等於把時限花在沒東西可推的地方（中世紀城堡實測有 2 秒多是這樣耗掉的）。 */
      const work = Math.hypot(m.x, m.z) < dozWorkR();
      m.bl += ((work ? 0 : 1) - m.bl) * Math.min(1, dt * (work ? 8 : 6));
      const px = m.x, pz = m.z;
      const at = driveTo(m, dt, work && m.load > 0 ? DOZ_PUSH : DOZ_MOVE);
      // 碎料跟著車子走同樣的位移
      const n = work ? pushWithBlade(m, m.x - px, m.z - pz) : 0;
      // 留一點餘裕再加速，不然碎料稀疏的地方會一路走走停停
      m.load = n > 0 ? DOZ_LOAD : Math.max(0, m.load - dt);
      if (at) m.st = 'seek';
    }
    if (m.st === 'seek') {
      const p = pickHeap(m, heaps, DOZ_LIMIT - D.t);      // 挑一坨，幾台不會擠在一起
      if (p) { m.tx = p.tx; m.tz = p.tz; m.st = 'push'; } else idle++;
    }
  }
  // 全部都找不到值得推的堆了，或是拖太久，就收工——不為了零星幾塊讓玩家乾等
  if (idle >= D.list.length || D.t > DOZ_LIMIT) finishClear();
}

/* 直接把整座蓋好。開場用——一進來就有一座完整的建築可以砸，
   不用先盯著小人搬十分鐘才有東西玩。設定面板的「立刻建成」也走這裡。 */
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
  /* 慶祝計時要跟著歸零，跟「小人自己蓋完」那條路徑一致（見 stepToss）。
     不歸零的話，上一座已經慶祝完、正在閒晃的人 cheer 還停在 7 秒以上，
     這一座蓋好的瞬間他們就直接跳過慶祝——一圈只站得到剛加入的那幾個。 */
  for (const w of workers) { releaseWorker(w); w.cheer = 0; w.pause = 0; }
  dozers = null; ENG.putDozers([]);      // 建築直接長出來了，整地機沒戲唱
  placedCnt = bp.slots.length;
  phase = 'done';
  assignSpots();                         // 慶祝要圍的那一圈
  /* 施工計時歸零：這一座不是小人蓋的，時間不算它的。順帶擋掉「奇蹟工程」——
     noteBuilt() 要 buildElapsed > 0 才給那個成就，按鈕就白拿不到。
     spentThis／lossThis 不動：中途按下按鈕時，小人已經領到的工錢是真的花掉了，
     歸零的話 HUD 的「本次人力」會突然變 $0，跟「累計」對不起來。
     （開場呼叫這裡時兩個本來就是 0，所以行為沒變） */
  buildElapsed = 0;
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
    /* 上工的路：clear 是「直線走得通」，chk 是還有多久要重算一次（見 buildWalk） */
    chk: 0, clear: 0,
    /* 被工具波及時才用得到：air 是正在飛，vx/vy/vz 是彈道，spin 是翻滾角速度，
       lit 是「落地要著火」的記號，burn 是還要燒幾秒，burnK 是身上焦黑的深淺。 */
    air: 0, vx: 0, vy: 0, vz: 0, spin: 0, lit: 0, burn: 0, burnK: 0,
    roll: 0, rspin: 0, rph: 0,
    bem: 0, bx: 0, bz: 0, br: 0, ba: 0,
    /* 工程師（eng）：拿藍圖 plan、站的角度 eang、下一個動作倒數 et、指揮動作剩幾秒 point。
       聊天：剩幾秒 chat、對象編號 cw、輪到誰講 side、講完多久才會再聊 chatCd、
       泡泡大小 bub、正在講話 talk。hail 是慶祝時的舉手。 */
    eng: 0, plan: 0, eang: 0, et: 0, point: 0, hail: 0, spot: 0,
    chat: 0, cw: -1, side: 0, chatCd: 0, bub: 0, talk: 0,
    /* 逃命：flee 是還要逃幾秒，fdel 是還愣著沒起步幾秒，fex/fez 是爆心，
       frem 是還要跑多遠，fdir 是起跑時定好的逃跑方向。 */
    flee: 0, fdel: 0, fex: 0, fez: 0, frem: 0, fdir: 0,
    /* 每個人身高略有差異。v1.51 整體再放大 1.5 倍（1.06–1.24 → 1.59–1.86）：
       模型從腳底到帽頂是 1.31，乘上去大約是 2.1–2.4 格，也就是兩塊多積木高。
       之前那一版遠鏡頭下只剩一撮色點，數不出幾個人、也看不出誰頭上頂著積木。 */
    scale: rr(1.59, 1.86)
  };
}
function setWorkerCount(n) {
  n = clamp(Math.round(n), 1, ENG.MAXW);
  while (workers.length < n) workers.push(newWorker(workers.length));
  while (workers.length > n) { releaseWorker(workers[workers.length - 1]); workers.pop(); }
  workerCnt = n;
  tagEngineer();
  if (phase === 'done') assignSpots();      // 慶祝中加減人：圈要重新等分
  ENG.setWorkerCount(workers.length);
}
/* 工地上派一個人當工程師：只看圖、只指揮，不搬積木。
   **只有兩個人以上才派**——剩一個人還去看圖的話，這座就永遠蓋不起來。
   固定挑 0 號是為了讓他穩定：每次重挑的話，人數一改工程師就換人。 */
function tagEngineer() {
  const on = workers.length >= 2;
  for (let i = 0; i < workers.length; i++) {
    const w = workers[i];
    const eng = on && i === 0 ? 1 : 0;
    if (eng && !w.eng) {
      releaseWorker(w);                  // 手上還有貨就先放掉，工程師不搬東西
      w.eang = Math.atan2(w.z, w.x);     // 從他現在站的角度接手，不用先跑半圈
      w.et = rr(1.5, 3);
    }
    if (!eng && w.eng) { w.plan = 0; w.point = 0; w.st = 'idle'; }
    w.eng = eng;
  }
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
  endChat(w);
}

/* ── 小人被拆除工具波及 ───────────────────────────────────
   邏輯跟碎料同一套：被吹飛／推走／炸飛就脫手、走彈道、一路翻滾。
   會不會燒起來留到**落地那一刻**才判定——所以飛在半空的還只是被丟出去的人。
   燒起來的演法看落地姿勢：摔在地上的就地打滾，站著被點著的抱頭跑圈圈。 */
const W_BURN = 3;                   // 小人燒多久（跟碎料的 EMBER_TIME 同長）
const W_TOSS_MAX = 22;              // 被拋出去的水平速度上限——不設的話一發核彈會把人送出草地
/* 打滾是**來回**滾，不是一直往同一邊滾——滅火本來就是左右翻壓熄身上的火，
   一路滾同一個方向的話人會一直往旁邊平移，變成在草地上遠航。
   角度直接用正弦波：振幅 1.9 rad（約 109°，從側躺翻過正面到另一邊）、每秒 0.9 個來回。 */
const ROLL_AMP = 1.9, ROLL_HZ = 0.9;
/* 滾動半徑＝身體橫躺時的半厚。位移用「這一幀轉了多少 × 這個」算，轉多少走多少，
   才不會看起來像一邊轉一邊在冰上滑。來回滾的淨位移接近 0，人留在原地翻。 */
const ROLL_R = 0.28;
const W_PANIC = 3.4;                // 跑圈圈的角速度
let burningW = 0;                   // 這一幀有幾個人在燒：火苗配額要分給他們

function tossWorker(w, vx, vy, vz, lit) {
  releaseWorker(w);
  const sp = Math.hypot(vx, vz);
  if (sp > W_TOSS_MAX) { const k = W_TOSS_MAX / sp; vx *= k; vz *= k; }
  w.air = 1; w.fall = 0; w.cheer = 0; w.pause = 0; w.gait = 0; w.flee = 0;
  w.vx = vx; w.vy = vy; w.vz = vz;
  w.spin = rr(5, 12) * (Math.random() < 0.5 ? -1 : 1);
  if (lit) w.lit = 1;
}
/* roll=1 是摔在地上燒（就地打滾），roll=0 是站著被點著（抱頭跑圈圈） */
function igniteWorker(w, roll) {
  if (w.burn > 0) return false;
  releaseWorker(w);
  w.burn = W_BURN; w.roll = roll ? 1 : 0; w.bem = Math.random(); w.fall = 0; w.flee = 0;
  // 躺平角直接就位（人本來就是摔在地上才點著的），來回滾的相位每個人不一樣
  if (roll) {
    w.tilt = Math.PI * 0.5; w.rph = rr(0, Math.PI * 2);
    w.rspin = ROLL_AMP * Math.sin(w.rph);
  }
  w.bx = w.x; w.bz = w.z; w.br = rr(1.6, 2.8); w.ba = Math.random() * Math.PI * 2;
  return true;
}
/* 摔下來的地方有沒有正在燒的東西。只在落地那一幀查一次，不是每幀掃 fires。 */
function nearFire(w) {
  if (!fires) return false;
  for (const f of fires) {
    const b = f.b;
    if (b.y > 2.5) continue;
    if ((b.x - w.x) ** 2 + (b.z - w.z) ** 2 < 4) return true;
  }
  return false;
}
/* 身上的火：跟燒積木共用同一個粒子池，配額同樣除以 √(在燒的人數) */
function burnFx(w, dt) {
  const h = 1.5 * w.scale;
  w.bem += dt * 26 / Math.sqrt(burningW || 1);
  while (w.bem >= 1) {
    w.bem--;
    if (hot.length > HOT_MAX - 40) break;              // 留一截給爆炸的火球
    hot.push({
      x: w.x + rr(-0.35, 0.35), y: w.y + rr(0.1, h), z: w.z + rr(-0.35, 0.35),
      vx: rr(-0.6, 0.6), vy: rr(2, 4), vz: rr(-0.6, 0.6),
      rx: Math.random() * 6, ry: Math.random() * 6,
      s: rr(0.26, 0.56), life: rr(0.3, 0.6), g: -2.6, grow: 1.06, cool: rr(0.25, 0.5),
      cr: 1, cg: rr(0.5, 0.82), cb: rr(0.06, 0.24), to: [0.6, 0.12, 0.02]
    });
  }
  if (Math.random() < dt * 2 && dust.length < 380)
    dust.push({
      x: w.x + rr(-0.3, 0.3), y: w.y + h, z: w.z + rr(-0.3, 0.3),
      vx: rr(-0.5, 0.5), vy: rr(1.2, 2.6), vz: rr(-0.5, 0.5),
      rx: Math.random() * 6, ry: Math.random() * 6,
      life: rr(1.2, 2.4), s: rr(0.4, 0.9), c: rr(0.2, 0.36), g: -0.6, fade: 2.2
    });
}
/* 飛在半空：走彈道、一路翻滾。撞到草地邊緣就彈回來——
   核彈的衝擊力算出來足夠把人送出地圖，飛出去就再也回不來了。 */
function flyWorker(w, dt) {
  w.vy -= GRAV * dt;
  w.x += w.vx * dt; w.y += w.vy * dt; w.z += w.vz * dt;
  w.tilt = (w.tilt + w.spin * dt) % (Math.PI * 2);
  w.a += w.spin * 0.35 * dt;
  const lim = arenaR + 22;
  if (Math.abs(w.x) > lim) { w.x = clamp(w.x, -lim, lim); w.vx *= -0.4; }
  if (Math.abs(w.z) > lim) { w.z = clamp(w.z, -lim, lim); w.vz *= -0.4; }
  if (w.y > 0) return;
  w.y = 0; w.air = 0; w.vx = w.vy = w.vz = 0;
  // 落地這一刻才判定燒不燒：被爆炸掃到的（lit）一定燒，摔進火堆裡的也會被引燃
  const lit = w.lit || nearFire(w);
  w.lit = 0;
  if (lit) igniteWorker(w, true);
  else { w.tilt = 0; w.fall = rr(0.8, 1.7); }          // 沒著火的就趴一下再爬起來
  sndFall();
}
/* 燒起來的兩種演法。跑圈圈是繞著「被點著時站的那個位置」轉，不是隨機亂走——
   繞定點才看得出是同一個人在原地打轉，隨機走看起來只是走得比較快。 */
function burnMove(w, dt) {
  const lim = arenaR + 22;
  if (w.roll) {
    /* 「停、躺、滾」：人是**躺平之後沿著身體長軸滾**（像滾木頭），不是頭上腳下翻筋斗。
       所以躺平角固定在 90°、轉的是另一根軸（rspin），而且滾的位移是身體的**側向**，
       不是正前方——沿著長軸滾當然是往旁邊移動。
       翻筋斗版本轉軸整個是錯的：頭會一下在上一下在下，看起來像在翻跟斗不像在滅火。 */
    w.tilt += (Math.PI * 0.5 - w.tilt) * Math.min(1, dt * 12);
    w.rph += dt * ROLL_HZ * Math.PI * 2;
    const was = w.rspin;
    w.rspin = ROLL_AMP * Math.sin(w.rph);
    /* 正向 rspin 是繞著「車頭方向」那根軸轉，接觸點在正下方，
       不打滑的話身體要往 (−cos a, sin a) 走。位移跟著**這一幀的轉角**走，
       所以往回滾的時候也往回挪，整段下來人留在原地翻。 */
    const v = (w.rspin - was) * ROLL_R;
    w.x = clamp(w.x - Math.cos(w.a) * v, -lim, lim);
    w.z = clamp(w.z + Math.sin(w.a) * v, -lim, lim);
    w.gait = 0;
  } else {
    w.ba += dt * W_PANIC;
    w.x = clamp(w.bx + Math.cos(w.ba) * w.br, -lim, lim);
    w.z = clamp(w.bz + Math.sin(w.ba) * w.br, -lim, lim);
    w.a = Math.atan2(-Math.sin(w.ba), Math.cos(w.ba));  // 面向切線＝繞著跑
    w.ph += dt * 22;                                    // 腳步比平常快一倍
    w.gait = 1;
    w.tilt += (0 - w.tilt) * Math.min(1, dt * 8);
  }
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
/* 挑「離我最近」的那一塊建材。試過改成「我走過去 ＋ 搬到定位」加起來最短，
   想省掉繞路的成本，結果兩邊都更差：那個判準會挑到躺在建築腳邊的料，
   人為了撿它反而走進工地裡（實測台北 101 的「站在牆裡」從 0.35% 跳到 5.98%，
   同樣時間蓋的塊數也少了一成）。 */
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
/* ── 放置時小人站的位置 ─────────────────────────────────
   從格子往外推 STAND_OUT 格。但對「建築內部」的格子，往外推一格還是在牆裡面——
   v1.51 之前就是這樣：中世紀城堡有 45% 的格子把人擺進牆裡，吉薩金字塔是 100%。
   小人放大之後這件事終於看得見了（頭卡在牆上、只露出安全帽）。

   現在改成沿著半徑往外掃，找**從那裡到工地外圈整段都沒有積木**的第一個位置：
   不能只找「第一個空的柱子」，中庭那種地方是空的，但外面還隔著一圈牆，
   走進去照樣得穿牆。掃不到（實心造型的正中央）就退回原本的做法——
   拋太遠的話那不是工人是投石機，而且那種地方蓋完也看不到裡面。 */
const STAND_OUT = 1.3;              // 站在格子外面多遠
const TOSS_MAX = 10;                 // 最多退到離格子幾格，超過就照舊走進去
function standPos(s) {
  const d = Math.hypot(s.x, s.z);
  const ux = d < 0.001 ? 1 : s.x / d, uz = d < 0.001 ? 0 : s.z / d;
  const near = Math.max(1.5, d + STAND_OUT);
  const far = Math.max(near, siteR + KEEP);
  let r = near;
  for (let t = near; t <= far; t += 0.5)              // 由內往外掃，記住最外面那道牆
    if (footBlocked(ux * t, uz * t)) r = t + 1;
  if (r > d + STAND_OUT + TOSS_MAX) r = near;         // 退太遠了：照舊走進去
  return { x: ux * r, z: uz * r };
}
function walkTo(w, dt) { return stepTo(w, w.tx, w.tz, dt); }
function stepTo(w, tx, tz, dt) {
  const dx = tx - w.x, dz = tz - w.z;
  const d = Math.hypot(dx, dz);
  if (d < REACH) { w.gait += (0 - w.gait) * Math.min(1, dt * 8); return true; }
  const sp = WALK * dt;
  w.x += dx / d * Math.min(sp, d); w.z += dz / d * Math.min(sp, d);
  w.a = Math.atan2(dx, dz);
  w.ph += dt * 11;
  w.gait += (0.85 - w.gait) * Math.min(1, dt * 8);
  return false;
}

/* ── 上工的走法 ─────────────────────────────────────────
   閒晃早就會繞開建築了（strollTo），但 pick／build 一直是兩點拉直線——
   於是搬積木的人整段路都從蓋好的部分中間穿過去。建築一樣當成半徑 siteR 的一根柱子：

     人在柱子裡、目標不在同一條半徑上 → 先沿半徑走出來
     兩端都在柱子外                   → 交給 strollTo 那套切線閃避
     要走進柱子裡                     → 先繞到目標那條半徑的外圈，再直直走進去

   最後那一段之所以是通的，是因為 standPos 挑的位置保證「從那裡往外到外圈沒有積木」。
   對得準不準用「離目標那條半徑線多遠」判斷，不用角度：站在中心附近時角度會亂跳。 */
/* 從現在的位置直直走到目標，腳邊會不會撞到已經蓋好的部分 */
function pathClear(w) {
  const dx = w.tx - w.x, dz = w.tz - w.z;
  const n = Math.ceil(Math.hypot(dx, dz) / 0.7);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    if (footBlocked(w.x + dx * t, w.z + dz * t)) return false;
  }
  return true;
}
const PATH_CHK = 0.25;              // 隔多久重算一次「直線通不通」
const PATH_EYE = 1.3;               // 每一幀往前看多遠（走得比重算快，會撞上新蓋的牆）
function buildWalk(w, dt) {
  /* 直線走得通就直線走。一律繞外圈的話，蓋一座要多花兩三倍時間（實測城堡的 200 秒
     從 1163 塊掉到 405 塊），而多數路線本來就沒被擋到。
     要重算是因為建築正在長：走到一半可能被新蓋起來的一面牆擋住。整條路每 0.25 秒
     重算一次，另外每一幀看一眼正前方——不看的話，那 0.25 秒足夠他走進牆裡 1.7 格。 */
  w.chk -= dt;
  if (w.clear) {
    const dx = w.tx - w.x, dz = w.tz - w.z, d = Math.hypot(dx, dz);
    if (d > REACH && footBlocked(w.x + dx / d * PATH_EYE, w.z + dz / d * PATH_EYE)) w.chk = 0;
  }
  if (w.chk <= 0) { w.chk = PATH_CHK; w.clear = pathClear(w) ? 1 : 0; }
  if (w.clear) return walkTo(w, dt);

  const outer = siteR + KEEP;
  const pr = Math.hypot(w.x, w.z), tr = Math.hypot(w.tx, w.tz);
  const aligned = tr < 0.6 ||
    (w.x * w.tx + w.z * w.tz > 0 && Math.abs(w.x * w.tz - w.z * w.tx) / tr < 0.6);
  if (pr < outer - 0.01 && !aligned) {              // 人在建築裡：先出來再說
    ringWalk(w, Math.atan2(w.z, w.x), outer, dt);
    return false;
  }
  if (tr >= outer) {                                // 目標在外面（撿積木多半是這種）
    const leg = w.leg;
    const done = strollTo(w, dt);
    w.leg = leg;             // 這段是上工的路，不算進閒晃里程（那個是拿來算發呆多久的）
    return done;
  }
  if (!aligned || pr > outer + 0.5) {               // 要進去：先繞到那條半徑的外圈
    ringWalk(w, Math.atan2(w.tz, w.tx), outer, dt);
    return false;
  }
  return walkTo(w, dt);
}

/* ── 逃命 ─────────────────────────────────────────────────
   核彈（2 秒倒數）跟爆裂魔法（6 秒魔法陣）都會先預告。預告一出現，範圍內的小人
   就丟下手上的東西往反方向跑，跑出安全距離才停下來回頭看。
   跑得掉的逃過一劫、跑不掉的照樣被炸飛——這一段完全交給位置決定，不另外判生死。

   安全距離抓比爆炸半徑再遠一點：剛好站在半徑上還是會被掃到（explode 是照距離
   衰減的，邊緣一樣有力）。 */
/* 腳程倍率跟腳步動畫倍率分開：動畫加倍，腳程只到 1.2（使用者指定）。
   兩個都給 2 的話核彈半徑 30、倒數 2.8 秒，圈內每一個人都跑得掉（實測 20/20 逃出），
   等於幫小人開了無敵。 */
const FLEE_SPD = 1.2;
const FLEE_STEP = 2;
/* 一口氣要跑多遠——**每個人抽自己的一段距離**，跟爆炸半徑無關。
   小人不會知道這一發的威力範圍到哪裡，用「半徑 + 幾單位」當目標等於幫他們開天眼；
   而且那樣算出來的終點全落在同一個圓上，二十個人會站成一圈，像在圍觀不像在逃。
   跑完就停下來回頭看——跑得夠遠的躲過去了，估錯的還站在火球裡。 */
const FLEE_RUN = [16, 34];
/* 跑的方向偏離「正背對爆心」多少。完全照半徑跑的話，一群人的路線是從同一點射出去的
   放射線，散開的那一下也很像陣型。偏一點才像各跑各的。
   方向在起跑那一刻就定死、之後走直線：每幀拿「當下的半徑方向 + 固定偏角」重算的話，
   軌跡會變成等角螺旋——真的繞著爆心畫圈圈。 */
const FLEE_SKEW = 0.5;
const FLEE_TAIL = 0.6;              // 爆炸之後再多警戒幾秒，不要炸完立刻回頭上工
const FLEE_REACT = [0.15, 0.55];    // 反應時間。全員同一幀起跑像一群機器人
/* 預告中的爆炸範圍。放成清單是因為兩發可以疊著預告（先開魔法陣再叫核彈），
   只留一個的話後叫的會蓋掉前一個，前一個剩下的時間就沒人在盯了。 */
let dangers = [];
function alertFlee(point, R, t) {
  dangers.push({ x: point.x, z: point.z, r: R, t });
  scareIn();
}
/* 每幀掃一次：站進預告範圍裡、又還沒在逃的，當場開始逃。
   只在下令那一刻掃一次是不夠的——當時離爆心遠的小人照樣會走進來
   （工地就在爆心上，他去撿料、去放積木都是往裡面走），走到一半被炸飛看起來像沒在反應。 */
function scareIn() {
  for (const d of dangers)
    for (const w of workers) {
      if (w.flee > 0 || w.air || w.burn > 0) continue;   // 已經在逃／在飛／在燒的不用再喊
      if ((w.x - d.x) ** 2 + (w.z - d.z) ** 2 > d.r * d.r) continue;
      startFlee(w, d);
    }
}
function stepDanger(dt) {
  if (!dangers.length) return;
  for (const d of dangers) d.t -= dt;
  dangers = dangers.filter(d => d.t > 0);
  scareIn();
}
function startFlee(w, d) {
  releaseWorker(w);                               // 手上的積木一律扔下（也會放掉認領的格子）
  w.flee = d.t + FLEE_TAIL;
  w.fdel = rr(FLEE_REACT[0], FLEE_REACT[1]);
  w.fex = d.x; w.fez = d.z;
  w.frem = rr(FLEE_RUN[0], FLEE_RUN[1]);
  const dx = w.x - d.x, dz = w.z - d.z;
  // 剛好站在爆心正上方就隨便挑一邊
  const away = dx * dx + dz * dz < 1e-6 ? rr(0, Math.PI * 2) : Math.atan2(dx, dz);
  w.fdir = away + rr(-FLEE_SKEW, FLEE_SKEW);
  w.cheer = 0; w.pause = 0;
}
/* 逃命這一幀。跑出安全距離就停下來面向爆心看——一路跑到地圖邊緣看起來像在鬧脾氣，
   而且六秒的魔法陣夠所有人跑出兩倍半徑那麼遠。 */
function stepFlee(w, dt) {
  w.flee -= dt;
  if (w.fdel > 0) {                                 // 愣住那零點幾秒：抬頭看，還沒起步
    w.fdel -= dt;
    w.a = Math.atan2(w.fex - w.x, w.fez - w.z);
    w.gait += (0 - w.gait) * Math.min(1, dt * 8);
    return;
  }
  if (w.frem <= 0) {                                // 跑夠了：站定回頭看
    w.a = Math.atan2(w.fex - w.x, w.fez - w.z);
    w.gait += (0 - w.gait) * Math.min(1, dt * 8);
    w.ph += dt * 4;
    return;
  }
  w.frem -= WALK * FLEE_SPD * dt;
  const ux = Math.sin(w.fdir), uz = Math.cos(w.fdir);   // 起跑時定好的那條直線
  const lim = arenaR + 20;
  w.x = clamp(w.x + ux * WALK * FLEE_SPD * dt, -lim, lim);
  w.z = clamp(w.z + uz * WALK * FLEE_SPD * dt, -lim, lim);
  w.a = w.fdir;
  w.ph += dt * 11 * FLEE_STEP;                      // 腳步加倍
  w.gait += (1 - w.gait) * Math.min(1, dt * 10);
}

/* 沿著建築外圈繞過去，不走直線——直線會從蓋好的建築正中央穿過去。
   角度先轉、半徑再收，兩個都到位才算抵達。 */
function ringWalk(w, ta, rad, dt) {
  const cr = Math.hypot(w.x, w.z);
  const ca = cr < 0.001 ? ta : Math.atan2(w.z, w.x);
  const TAU = Math.PI * 2;
  // 取最短那一邊繞。ta 可能是累加出來的（工程師換位置一次加一點），先折回 ±π
  const dA = ((((ta - ca) % TAU) + TAU + Math.PI) % TAU) - Math.PI;
  const maxA = WALK * dt / Math.max(rad, 1), maxR = WALK * dt;
  const dr = rad - cr;
  const na = ca + clamp(dA, -maxA, maxA), nr = cr + clamp(dr, -maxR, maxR);
  const px = w.x, pz = w.z;
  w.x = Math.cos(na) * nr; w.z = Math.sin(na) * nr;
  const mx = w.x - px, mz = w.z - pz;
  if (Math.hypot(mx, mz) > 1e-4) {
    w.a = Math.atan2(mx, mz);
    w.ph += dt * 11;
    w.gait += (0.85 - w.gait) * Math.min(1, dt * 8);
  }
  return Math.abs(dA) <= maxA && Math.abs(dr) <= maxR;
}

/* ── 完工慶祝 ─────────────────────────────────────────────
   七秒（維持原本的長度）。原本是繞著建築跑一圈就結束，看起來只是在趕路；
   現在改成「跑到定位 → 站定面向建築原地跳」，跳才有慶祝感。 */
const CHEER_T = 7;
const JUMP_T = 0.62;                // 一次跳躍的週期
const JUMP_AIR = 0.72;              // 週期裡有多少比例在空中，剩下的是落地停頓
const JUMP_H = 0.55;                // 跳多高
/* 圈上一個人分到多寬的弧長。小人放大後連手臂約 1.56 格寬，留一點縫 = 1.9。
   半徑本來寫死 siteR + 2.6：最小的建築 siteR 只有 7，圈長 60 格分給 60 個人
   等於每人 1 格——放大之後整圈的人會互相插在一起。 */
const CHEER_GAP = 1.9;
function cheerR() {
  return Math.max(siteR + 2.6, workers.length * CHEER_GAP / (Math.PI * 2));
}

/* 圈上的位置照「開始慶祝那一刻各自站的角度」分，不是照編號硬分——
   照編號分的話，站在對面的人得沿著外圈走半圈才就位（量過要六秒），
   七秒的慶祝就只剩一秒在跳。
   等分的起點也不取固定的 0 度：取「現況跟等分格的角度差」的平均方向當起點，
   整組人各自挪一點點就成圈。 */
function assignSpots() {
  const n = workers.length;
  if (!n) return;
  const TAU = Math.PI * 2, gap = TAU / n;
  const ord = workers.map((w, i) => i)
    .sort((a, b) => Math.atan2(workers[a].z, workers[a].x) - Math.atan2(workers[b].z, workers[b].x));
  let sx = 0, sz = 0;
  for (let k = 0; k < n; k++) {
    const w = workers[ord[k]];
    const d = Math.atan2(w.z, w.x) - k * gap;
    sx += Math.cos(d); sz += Math.sin(d);
  }
  const base = Math.atan2(sz, sx);
  for (let k = 0; k < n; k++) workers[ord[k]].spot = base + k * gap;
}

function updWorker(w, wi, dt) {
  /* 姿勢旗標每幀重算：跌倒、被炸飛、跑去躲的那幾條路徑都是 return 出去的，
     不歸零的話工程師被戳倒了還躺在地上舉著圖。 */
  w.hail = 0; w.plan = 0;
  if (w.chatCd > 0) w.chatCd -= dt;
  /* 被吹飛／點著／推倒／要逃命，或是換場要清工地了——聊天一律中斷。
     蓋完的那一刻也中斷：慶祝要全員到齊，不然聊到一半的那兩個會晚五秒才入圈。 */
  if (w.chat > 0 && (w.air || w.burn > 0 || w.fall > 0 || w.flee > 0 ||
      (phase !== 'build' && phase !== 'done') || (phase === 'done' && w.cheer < CHEER_T)))
    endChat(w);
  if (w.burn > 0) {
    w.burn -= dt;
    burnFx(w, dt);
    // 燒完就拍拍灰站起來，顏色自己褪回原色
    if (w.burn <= 0) {
      w.burn = 0; w.roll = 0; w.tilt = 0; w.rspin = 0; w.rph = 0; w.gait = 0; w.st = 'idle';
    }
  }
  if (w.burn > 0 || w.burnK > 0.002) {
    const t = w.burn > 0 ? 0.8 : 0;
    w.burnK += (t - w.burnK) * Math.min(1, dt * (w.burn > 0 ? 1.1 : 2.2));
  }
  if (w.air) { flyWorker(w, dt); return; }            // 被吹飛／炸飛：走彈道
  if (w.burn > 0) { burnMove(w, dt); return; }        // 燒起來：打滾或跑圈圈

  if (w.fall > 0) {                                   // 被震倒／被戳倒
    w.fall -= dt;
    w.tilt += (Math.PI * 0.44 - w.tilt) * Math.min(1, dt * 9);
    w.gait += (0 - w.gait) * Math.min(1, dt * 6);
    if (w.fall <= 0) w.st = 'idle';
    return;
  }
  w.tilt += (0 - w.tilt) * Math.min(1, dt * 7);

  /* 逃命優先於一切還站得起來的行為：施工、閒晃、慶祝、監工都先擱著。
     擺在跌倒／著火之後——那兩種本來就動不了，逃不掉才合理。 */
  if (w.flee > 0) { stepFlee(w, dt); w.y += (0 - w.y) * Math.min(1, dt * 6); return; }

  if (w.chat > 0) { stepChat(w, wi, dt); return; }

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

  if (phase === 'done') {                             // 蓋完了，圍成一圈慶祝
    w.cheer += dt;
    if (w.cheer < CHEER_T) {
      /* 先各自跑到自己那一格（等分一圈，所以站得開），到位就轉身面向建築
         原地跳。跳的相位照編號錯開 0.09 秒，一圈看過去是一道波浪，
         不是全場同手同腳。 */
      if (ringWalk(w, w.spot, cheerR(), dt)) {
        w.a = Math.atan2(-w.x, -w.z);                 // 面向建築
        w.gait += (0 - w.gait) * Math.min(1, dt * 8);
        w.ph += dt * 9;                               // 舉起來的手跟著擺
        w.hail = 1;
        const u = (w.cheer + wi * 0.09) % JUMP_T / JUMP_T;
        /* 落地要有停頓才看得出是「跳」：|sin| 那種連續起伏只會像在漂浮。 */
        w.y = u < JUMP_AIR ? Math.sin(u / JUMP_AIR * Math.PI) * JUMP_H : 0;
      } else {
        w.y += (0 - w.y) * Math.min(1, dt * 6);
      }
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
  if (w.eng) { updEng(w, dt); return; }      // 工程師只看圖、只指揮

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
      if (buildWalk(w, dt)) {
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
      if (buildWalk(w, dt)) {
        /* 走過來的這幾秒建築一直在長，站位可能已經被別人補起來了。
           重新挑一個再走過去——就這樣從牆裡把積木丟出去的話，出手那一下整塊在牆裡。
           挑回同一個位置（實心造型的正中央就會這樣）就認了，不然會在原地來回。 */
        if (footBlocked(w.x, w.z)) {
          const st2 = standPos(bp.slots[w.slot]);
          if (Math.hypot(st2.x - w.x, st2.z - w.z) > 1) {
            w.tx = st2.x; w.tz = st2.z; w.chk = 0;
            break;
          }
        }
        const s = bp.slots[w.slot];
        w.a = Math.atan2(-w.x, -w.z);                 // 面向建築再丟
        b.st = TOSS;
        b.arc = {
          t: 0, dur: 0.34 + Math.hypot(s.x - w.x, s.z - w.z) * 0.02 + s.y * 0.012,
          x0: b.x, y0: b.y, z0: b.z, x1: s.x, y1: s.y + HB, z1: s.z,
          peak: tossPeak(b.x, b.y, b.z, s)
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
/* 拋物線的頂點。只看高度差是不夠的（v1.51 之前那版就是）：人退到外緣之後，
   出手點跟目標之間隔著下面幾層的牆——城堡第 10 層那種，飛到三成路程時高度才 9.0，
   而那裡的牆有 10 格高，積木會從牆裡穿出去。變成「積木穿牆」換掉「人穿牆」，沒有比較好看。
   所以沿路取樣，每一點都算「頂點要多高才過得去」，取最大的那個。
   擋路的高度用 colTop（從地面連續疊上來的那一段），挑出去的樓板不算——
   那些是從底下穿過去的。 */
function tossPeak(x0, y0, z0, s) {
  const y1 = s.y + HB;
  const dx = s.x - x0, dz = s.z - z0;
  const dist = Math.hypot(dx, dz);
  let peak = Math.max(1.6, (y1 - y0) * 0.45 + 1.8);
  /* 取樣點要密，而且不能只照距離給：出手後那一小段爬得最急，
     「要多高才過得去」在 t 很小的時候最大（分母 sin(πt) 趨近 0）。
     照距離每半格取一點的話，2 格的拋擲只有 6 點，t=0.13 那個尖峰整個漏掉——
     實測台北 101 有 5.6% 的積木就是這樣從旁邊那道牆穿出去的。 */
  const n = 24;
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const cy = colTop(x0 + dx * t, z0 + dz * t);
    if (cy < 0) continue;
    // 積木中心要比那格的中心高 1.1（一格是 1，剛好 1 是擦過去）
    const need = (cy + 1.1 - y0 - (y1 - y0) * t) / Math.sin(t * Math.PI);
    if (need > peak) peak = need;
  }
  return Math.min(peak, 26);
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

/* ── 工程師 ───────────────────────────────────────────────
   施工中站在建築外圍看藍圖，不搬積木、不認領格子（所以他不占人手，
   蓋的速度就是少一個人）。偶爾抬手指揮一下，偶爾換個角度繼續看。
   換角度是沿著外圈繞過去的：拉直線的話他會從蓋到一半的建築中間穿過去。 */
const ENG_KEEP = 3.4;               // 站得比閒晃的人再外面一點，看得到整座
const ENG_POINT = 0.62;             // 每次換動作有多少機率是「指揮」，其餘是換位置

function updEng(w, dt) {
  w.plan = 1;
  if (!ringWalk(w, w.eang, siteR + ENG_KEEP, dt)) return;   // 還在走位
  w.a = Math.atan2(-w.x, -w.z);                             // 站定就面向建築
  w.gait += (0 - w.gait) * Math.min(1, dt * 8);
  if (w.point > 0) {
    w.point -= dt;
    w.ph += dt * 9;                                         // 指的那隻手要動
    if (w.point <= 0) { w.point = 0; w.et = rr(2.5, 5); }
    return;
  }
  w.et -= dt;
  if (w.et > 0) return;
  if (Math.random() < ENG_POINT) w.point = rr(1.2, 2.2);
  else { w.eang += rr(0.5, 1.5) * (Math.random() < 0.5 ? -1 : 1); w.et = rr(2.5, 5); }
}

/* ── 閒聊 ─────────────────────────────────────────────────
   沒事做的兩個人走近了就停下來聊五秒：面對面、輪流講、講的那個
   頭上冒泡泡並且比手畫腳。聊完各自散開，隔一段時間才會再聊
   （不設冷卻的話同兩個人會黏在一起聊個沒完）。 */
const CHAT_T = 5;                   // 聊多久
const CHAT_D = 2.6;                 // 多近才聊得起來
const CHAT_CD = 9;                  // 聊完至少隔幾秒才會再聊（實際是 1～2 倍隨機）
const CHAT_TURN = 1.15;             // 每個人一次講幾秒，輪流換

function endChat(w) {
  if (w.chat > 0) w.chatCd = rr(CHAT_CD, CHAT_CD * 2);
  w.chat = 0; w.cw = -1; w.bub = 0; w.talk = 0;
}
/* 閒著沒事、站得穩、剛剛沒聊過的才會被湊成一對。
   施工中只有「找不到工作」的人算閒晃（st 卡在 idle）；工程師在看圖不算閒。 */
function chatFree(w) {
  if (w.chat > 0 || w.chatCd > 0 || w.air || w.burn > 0 || w.fall > 0 || w.flee > 0 ||
      w.carry) return false;
  if (phase === 'done') return w.cheer >= CHEER_T;
  return phase === 'build' && w.st === 'idle' && !w.eng;
}
function pairChat() {
  if (phase !== 'build' && phase !== 'done') return;
  for (let i = 0; i < workers.length; i++) {
    const a = workers[i];
    if (!chatFree(a)) continue;
    for (let j = i + 1; j < workers.length; j++) {
      const b = workers[j];
      if (!chatFree(b)) continue;
      if ((a.x - b.x) ** 2 + (a.z - b.z) ** 2 > CHAT_D * CHAT_D) continue;
      a.chat = b.chat = CHAT_T;
      a.cw = j; b.cw = i;
      a.side = 0; b.side = 1;                 // 先開口的是 a
      a.pause = b.pause = 0;
      break;                                  // 一次只配一個對象
    }
  }
}
function stepChat(w, wi, dt) {
  const p = workers[w.cw];
  if (!p || p.chat <= 0 || p.cw !== wi) { endChat(w); return; }   // 對方被抓走了
  w.chat -= dt;
  w.y += (0 - w.y) * Math.min(1, dt * 6);
  w.gait += (0 - w.gait) * Math.min(1, dt * 8);
  const dx = p.x - w.x, dz = p.z - w.z;
  if (dx || dz) w.a = Math.atan2(dx, dz);                        // 面對面
  const speak = Math.floor((CHAT_T - w.chat) / CHAT_TURN) % 2 === w.side;
  w.talk = speak ? 1 : 0;
  if (speak) w.ph += dt * 9;
  w.bub += ((speak ? 1 : 0) - w.bub) * Math.min(1, dt * 12);
  if (w.chat <= 0) {
    endChat(w);
    // 聊完就走：給一個新的閒晃目標，不然兩個人會杵在原地等發呆時間跑完
    const a = Math.random() * Math.PI * 2, d = siteR + rr(2, 9);
    w.tx = Math.cos(a) * d; w.tz = Math.sin(a) * d;
    w.pause = 0;
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
      assignSpots();
      sndDone();
      toast('🎉 ' + bp.name + ' 完工', fmtDur(buildElapsed) + '　人力 ' + money(spentThis));
      noteBuilt();
    }
  }
}

/* ── 紀錄 · 成就 · 存檔 ───────────────────────────────── */
const WRECK_AT = 0.25;              // 剩下不到這個比例就算拆完了，換下一座
/* 但不要立刻換：拆完那一下常常是核彈或魔法陣，火球、蘑菇雲、滿地碎料都還在演，
   立刻叫推土機進場等於把那一發的收尾剪掉。先站在原地看這麼久再收拾。 */
const SWAP_WAIT = 3;
let swapWait = 0;                   // 已經等了幾秒（跟著模擬時間走，開快轉就等得短）
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
/* v 是設定檔版本。舊存檔沒有這個欄位，load() 靠它認出「這份存檔是預設值改掉之前存的」 */
const freshPref = () => ({ cnt: 3000, wk: 20, spd: 1, mute: false, spin: false, v: 1 });
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
  { id: 'world10', n: '環遊世界', d: '蓋過 10 種不同建築', chk: s => s.built.length >= 10 },
  { id: 'worldAll', n: '地標蒐藏家', d: '蓋過全部 ' + SHAPES.length + ' 種建築',
    chk: s => s.built.length >= SHAPES.length },
  { id: 'move10k', n: '愚公移山', d: '小人累計搬運 10000 塊', chk: s => s.carried >= 10000 },
  { id: 'move100k', n: '工蟻軍團', d: '小人累計搬運 100000 塊', chk: s => s.carried >= 100000 },
  { id: 'demo50', n: '拆遷大隊', d: '一次擊飛超過 50 塊積木', chk: s => s.bestHit > 50 },
  { id: 'hit200', n: '一發清空', d: '一次擊飛超過 200 塊積木', chk: s => s.bestHit > 200 },
  { id: 'smash50k', n: '粉塵滿天', d: '累計擊飛 50000 塊積木', chk: s => s.smashed >= 50000 },
  { id: 'wreck5', n: '拆屋大亨', d: '拆掉 5 座建築', chk: s => s.destroyed >= 5 },
  { id: 'wreck25', n: '都市更新', d: '拆掉 25 座建築', chk: s => s.destroyed >= 25 },
  { id: 'allTools', n: '工具箱清空', d: '十二種破壞道具都用過', chk: s => s.tools.length >= TOOLS.length },
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
    /* 沒有版本欄位＝預設建材還是 900 那個年代存的。那時候的 900 分不出是玩家挑的
       還是預設值，所以一次性換成新預設，不然改了預設的人永遠看不到 3000。 */
    if (o.p && o.p.v === undefined) g.cnt = freshPref().cnt;
    /* 面板改成三檔按鈕之後，中間值選不出來了：舊存檔（還有被改壞的存檔）
       一律吸到最近的一檔。不吸的話畫面上會三顆都不亮，跑的卻是第四個數字。 */
    g.cnt = snapOpt(g.cnt, CNT_OPTS);
    g.wk = snapOpt(g.wk, WK_OPTS);
    g.spd = snapOpt(g.spd, SPD_OPTS);
    pref = g;
  } catch (e) { savable = false; }
}
/* 數字吸到最近的一檔。壞掉的存檔（NaN、字串）當 0 處理，會吸到最小的那一檔 */
function snapOpt(v, opts) {
  const n = +v || 0;
  return opts.reduce((a, b) => Math.abs(b - n) < Math.abs(a - n) ? b : a);
}
/* 把存回來的設定套進變數與面板 */
function applyPref() {
  targetCnt = pref.cnt; timeScale = pref.spd; muted = pref.mute; spinOn = pref.spin;
  setWorkerCount(pref.wk);
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
/* 解鎖階梯：兩種紀錄輪流當門檻（擊飛數／拆除座數），兩邊都得推進才走得完。
   難度定在「大約拆一座建築開一格」：建材用預設的 3000 塊時，一座拆到換場門檻
   （剩 WRECK_AT＝25% 就算拆完）至少會擊飛 2,250 塊，所以擊飛那一側就照
   1／3／5／7／9 座換算成 2,000／6,000／11,000／15,000／19,000，
   拆除那一側直接寫 2／4／6／8／10 座——十格走完大約就是十座。
   建材調小的話一座擊飛得少，擊飛那一側自然要多拆幾座才追得上（工作量差不多）。 */
const TOOLS = [
  { id: 'finger', n: '手指', k: '👆', tip: '不破壞任何東西，只能戳小人', lock: null },
  { id: 'hammer', n: '槌子', k: '🔨', tip: '點建築：點狀衝擊　·　點地面：只敲地板，建築不受影響',
    lock: null },
  { id: 'bighammer', n: '大槌', k: '🔨', big: true,
    tip: '點建築：兩倍大的槌子，範圍也是兩倍　·　點地面：地震，震掉 10% 的積木',
    lock: { txt: '累計擊飛 2,000 塊解鎖', ok: () => stats.smashed >= 2000 } },
  { id: 'ball', n: '保齡球', k: '🎳', tip: '點兩下：先點出手的地方，再點要滾過去的方向',
    lock: { txt: '拆掉 2 座建築解鎖', ok: () => stats.destroyed >= 2 } },
  { id: 'treb', n: '投石機', k: '🪨', tip: '點地面：在那裡架一台投石機，朝建築丟石頭',
    lock: { txt: '累計擊飛 6,000 塊解鎖', ok: () => stats.smashed >= 6000 } },
  { id: 'tornado', n: '龍捲風', k: '🌪', tip: '點地面：龍捲風掃過去，可以同時來好幾道',
    lock: { txt: '拆掉 4 座建築解鎖', ok: () => stats.destroyed >= 4 } },
  { id: 'fw', n: '煙火', k: '🎆', tip: '點地面：一次射三發煙火，落下來的火星會把建築點著',
    lock: { txt: '累計擊飛 11,000 塊解鎖', ok: () => stats.smashed >= 11000 } },
  { id: 'fire', n: '放火', k: '🔥', tip: '點建築：從那一塊燒起來，火會往旁邊蔓延',
    lock: { txt: '拆掉 6 座建築解鎖', ok: () => stats.destroyed >= 6 } },
  { id: 'bomb', n: '定時炸彈', k: '💣', tip: '點一下：放一顆炸彈，3 秒後炸開',
    lock: { txt: '累計擊飛 15,000 塊解鎖', ok: () => stats.smashed >= 15000 } },
  { id: 'meteor', n: '隕石', k: '☄', tip: '點一下：3 秒後從斜上方砸下一顆燃燒隕石，可以同時來好幾顆',
    lock: { txt: '拆掉 8 座建築解鎖', ok: () => stats.destroyed >= 8 } },
  { id: 'nuke', n: '核彈', k: '☢', tip: '點一下：2 秒後天上掉核彈下來',
    lock: { txt: '累計擊飛 19,000 塊解鎖', ok: () => stats.smashed >= 19000 } },
  { id: 'magic', n: '爆裂魔法', k: '🔮', tip: '點一下：魔法陣一層層展開，6 秒後爆炸',
    lock: { txt: '拆掉 10 座建築解鎖', ok: () => stats.destroyed >= 10 } }
];
const toolOk = t => !t.lock || t.lock.ok();
/* 這幾種點空地也算數：它們的用法就是「選一個地點」，
   規定一定要點到建築的話，站在旁邊的空地放炸彈反而做不到。
   大槌點空地是地震、保齡球點空地是從那裡把球丟出去，所以也在這裡。
   小槌點空地什麼都不會掉，但仍然留在這裡：拿掉的話那一下完全沒反應，看起來像點壞了。 */
const GROUND_TOOL = { hammer: 1, bighammer: 1, ball: 1, tornado: 1, treb: 1, fw: 1,
                      bomb: 1, meteor: 1, nuke: 1, magic: 1 };
let tool = 'hammer';

let hammerR = 5.5, hammerPow = 15;
let swing = null;     // 正在揮下去的槌子
let ball = null;      // 飛行中的鐵球
let twists = null;    // 作用中的龍捲風（可以同時好幾道）
let bombs = null;     // 已放下、倒數中的定時炸彈
let meteors = null;   // 已呼叫的隕石（倒數或下墜中，可以好幾顆）
let nuke = null;      // 已呼叫的核彈（倒數或下墜中）
let magic = null;     // 正在展開的魔法陣
let fires = null;     // 正在燒的積木（還站著的會往鄰居蔓延，碎料的只燒自己）
let nSpread = 0;      // fires 裡有幾筆是「還站著的建築」——碎料不占那個額度
const hot = [];       // 火球粒子（走不透明那顆材質，才亮得起來）
const flashes = [];   // 爆炸正中央那顆火球本體（好幾發一起炸就好幾顆）
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
  return fell + dropHung(drop);
}

/* 只剩對角勾著的也要掉。
   26 鄰居的支撐判定放得很寬——只要角碰角就算連著，所以打穿一面牆之後，
   會留下用一個角吊在半空的積木（或一整坨）。這一關專門收這種：

   - 基準線是藍圖的 f6（完好時六個面就連得到地面）。完好時本來就靠對角相連的
     （艾菲爾鐵塔 825/1497 格）不在這關的管轄範圍，怎麼打都不會因此掉。
   - 判的是「整坨」不是單塊：六面相連的一群積木彼此黏著，只要整群都碰不到地面，
     就整群一起掉。只看單塊六面全空的話，兩塊黏在一起吊在半空就抓不到。
   - **施工中不判**。蓋到一半的建築四處都是還沒補上的鄰居，用這麼嚴的尺會把
     剛放上去的積木一直打下來，蓋不完。 */
let hung6 = null;
function dropHung(drop) {
  if (phase === 'build') return 0;
  const S = bp.slots, n = S.length;
  if (!hung6 || hung6.length !== n) hung6 = new Uint8Array(n); else hung6.fill(0);
  const stack = [];
  for (let i = 0; i < n; i++) if (S[i].filled && S[i].gy === 0) { hung6[i] = 1; stack.push(i); }
  while (stack.length) {
    const s = S[stack.pop()];
    for (let k = 0; k < NBR6.length; k++) {
      const d = NBR6[k];
      const j = bp.at.get(gkeyOf(s.gx + d[0], s.gy + d[1], s.gz + d[2]));
      if (j === undefined || hung6[j] || !S[j].filled) continue;
      hung6[j] = 1; stack.push(j);
    }
  }
  let fell = 0;
  for (let i = 0; i < n; i++) if (S[i].f6 && S[i].filled && !hung6[i]) fell += drop(i);
  return fell;
}
/* 每次造成破壞後的共通處理：計數、嚇小人、判斷這座是不是拆完了 */
function afterHit(n, point, R) {
  if (n <= 0) return;
  stats.smashed += n;
  if (n > stats.bestHit) stats.bestHit = n;
  if (phase === 'done') phase = 'wreck';        // 完工的建築被動到 → 進入拆除中
  for (const w of workers) {
    if (w.air || w.burn > 0) continue;                // 正在飛／正在燒的不用再掀一次
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

/* ── 地震：大槌砸在地上 ─────────────────────────────────
   敲空地本來什麼事都不會發生。現在改成震一下：整棟跟著晃，隨機 QUAKE_FRAC 的積木
   鬆脫掉下來。掉的是「原地垮下來」不是被打飛——它們沒有被誰打到，只是站不住了。
   分成好幾波掉，不是同一幀全掉：一次掉完看起來像被隱形的東西打到，不像在震。

   v1.50 起只有大槌會震（小槌改成 thumpGround）：小槌是拿來「點」的精準工具，
   瞄邊角時很容易擦過去點到地面，那一下震掉 5% 等於每失手一次就賠掉一大片。 */
const QUAKE_TIME = 1.65;            // 震多久
const QUAKE_FRAC = 0.1;             // 一次震掉多少比例
const QUAKE_WAVE = 0.12;            // 每隔多久掉一波
let quake = null;

function startQuake(p) {
  /* 先把要掉的那些抽好放著，不要每一波再抽一次：每波重抽的話，
     先掉的那些留下的空洞會讓後面幾波集中在同一區，看起來像被鑿了一個洞。 */
  const std = [];
  for (let i = 0; i < blocks.length; i++) if (blocks[i].st === SET) std.push(i);
  const n = Math.min(std.length, Math.round(std.length * QUAKE_FRAC));
  for (let i = 0; i < n; i++) {                     // 只洗要用到的前 n 個
    const j = i + Math.floor(Math.random() * (std.length - i));
    const t = std[i]; std[i] = std[j]; std[j] = t;
  }
  quake = { t: QUAKE_TIME, next: 0, list: std.slice(0, n), cur: 0, x: p.x, z: p.z };
  ENG.shake(1.5);
  sndSmash();
  spawnRing({ x: p.x, y: 0, z: p.z }, 9);
  return n;
}
/* 小槌砸在地上：就只是敲了一下地板。灰塵、音效照給（不然像點壞了），
   但建築一塊都不掉、畫面也不震——會震整棟的是大槌那一支。 */
function thumpGround(p) {
  spawnDust({ x: p.x, y: 0.3, z: p.z }, 3, 0);
  spawnRing({ x: p.x, y: 0, z: p.z }, 4);
  sndSmash();
  return 0;
}
function stepQuake(dt) {
  if (!quake) return;
  const q = quake;
  q.t -= dt;
  q.next -= dt;
  if (q.next > 0 && q.t > 0) return;
  q.next = QUAKE_WAVE;
  // 這一波掉幾塊：剩下的量平均分給剩下的波數，最後一波把尾數收乾淨
  const waves = Math.max(1, Math.ceil(q.t / QUAKE_WAVE));
  const take = q.t <= 0 ? q.list.length - q.cur
                        : Math.ceil((q.list.length - q.cur) / waves);
  let n = 0;
  for (let k = 0; k < take && q.cur < q.list.length; k++) {
    const b = blocks[q.list[q.cur++]];
    if (!b || b.st !== SET) continue;               // 這中間被別的東西打掉了
    breakBlock(b, rr(-1.2, 1.2), rr(-0.5, 1.2), rr(-1.2, 1.2));
    n++;
  }
  // 還沒掉的也要跟著抖：地震看的是整棟在晃，不是幾塊在掉
  for (const b of blocks) if (b.st === SET && Math.random() < 0.5) b.wob = 0.4;
  if (n) afterHit(n, { x: q.x, y: 1, z: q.z }, 5);
  ENG.shake(0.5);
  if (q.t <= 0) quake = null;
}

/* 揮槌：槌子沿著你的視線方向砸下去，槌頭碰到的那一刻才真的造成破壞。
   直接在按下的瞬間就把積木打飛的話，畫面上什麼都沒發生就散了，完全沒有打擊感。 */
const SWING_DOWN = 0.19, SWING_BACK = 0.34;
const SWING_ARM = 9, SWING_ANG = 2.15;
let swingSide = 1;
function launchHammer(point, dir, big, ground) {
  if (swing && !swing.hit) resolveSwing();        // 連點時先把上一槌結算掉，不要吃掉那一擊
  /* 側揮：揮動平面取「螢幕右方 × 世界上方」，弧線正對著鏡頭掃過來。
     沿著視線方向直直砸下去的話，槌子從頭到尾都是端面朝你，看不出那是一支槌子。 */
  let rx = -dir.z, rz = dir.x;
  const rl = Math.hypot(rx, rz);
  if (rl < 1e-4) { rx = 1; rz = 0; } else { rx /= rl; rz /= rl; }
  swingSide = -swingSide;                          // 左右輪流，連續砸才不會每次都同一邊
  swing = { px: point.x, py: point.y, pz: point.z,
            dx: dir.x, dy: dir.y, dz: dir.z,
            rx: rx * swingSide, rz: rz * swingSide, t: 0, hit: false,
            big: !!big, ground: !!ground };
  sndSwing();
}
function resolveSwing() {
  if (!swing || swing.hit) return 0;
  swing.hit = true;
  const p = { x: swing.px, y: swing.py, z: swing.pz };
  // 砸在空地上：大槌是把整棟震一震（震到的那些自己垮下來），小槌只是敲一下地板
  if (swing.ground) return swing.big ? startQuake(p) : thumpGround(p);
  const m = swing.big ? 2 : 1;                   // 大槌：範圍兩倍、力道再多五成
  return smash(p, { x: swing.dx, y: swing.dy, z: swing.dz },
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
/* 點兩下：第一點是出手的地方，第二點決定往哪邊滾（第一點 → 第二點的方向）。
   本來是「點一下，自動朝工地中心丟」——那等於方向不歸玩家管，
   想從側面掏牆角、想擦過某一排都做不到。
   出手有高度，落地彈幾下才開始往前滾——直接貼地放出去的話它就只是一顆
   在地上平移的球，看不出是被「丟」出來的。
   方向仍留一點隨機偏差，但從 ±0.22 收到 ±0.08：偏差是丟球的手感，
   不該蓋過玩家指的方向（滾 60 單位的話橫向差 ±4.8）。 */
/* 出手高度與回彈都要壓著點：球水平是 34 單位/秒，多滯空 0.1 秒就多飛 3.4 單位。
   彈太久的話它是「飛」到建築上的，看不出中間那段滾。現在兩下彈完，約 0.9 秒進入滾。 */
const BALL_DROP = 3.4;              // 出手高度（球心離「貼地時的球心」多高）
const BALL_SPREAD = 0.08;           // 方向偏差 ±rad（約 ±4.6°）
const BALL_BOUNCE = 0.42;           // 落地回彈保留多少垂直速度
/* 滾多久、掉速多快。方向改成玩家自己指之後，射程短了就白瞄——
   兩個都放寬一點：6 秒 ×0.82 的衰減滾得到約 119 單位，7.5 秒 ×0.86 約 152。 */
const BALL_LIFE = 7.5;              // 最多滾幾秒
const BALL_ROLL = 0.86;             // 滾動阻力：每秒保留多少速度
let ballAim = null;                 // 已經點好、還在等第二點的出手位置

/* 第一下記位置，第二下才丟出去。同一點連按兩下（兩點幾乎重疊）時沒有方向可用，
   就退回舊行為朝工地中心丟——不然那一下會變成沒反應。 */
function aimBall(point) {
  if (!ballAim) { ballAim = { x: point.x, z: point.z, ph: 0 }; sndTick(); return; }
  launchBall(ballAim, point);
}
function launchBall(from, toward) {
  let dx = toward ? toward.x - from.x : -from.x;
  let dz = toward ? toward.z - from.z : -from.z;
  if (Math.hypot(dx, dz) < 0.5) { dx = -from.x; dz = -from.z; }   // 兩點重疊 → 朝工地中心
  const l = Math.hypot(dx, dz);
  if (l < 1e-4) { dx = 1; dz = 0; } else { dx /= l; dz /= l; }
  const a = Math.atan2(dz, dx) + rr(-BALL_SPREAD, BALL_SPREAD);
  ball = {
    x: from.x, y: BALL_R + BALL_DROP, z: from.z,
    vx: Math.cos(a) * 34, vz: Math.sin(a) * 34, vy: rr(-3, -0.5),   // 是往下丟不是往上拋
    r: BALL_R, ang: 0, hit: 0, life: BALL_LIFE, hops: 0
  };
  ballAim = null;
  sndSwing();
}
/* 等第二點的時候在出手位置畫一圈會脈動的光環：沒有這個的話，
   第一下點下去畫面完全沒反應，看起來像點壞了。 */
const AIM_RING = [];
function aimRings() {
  AIM_RING.length = 0;
  const p = 0.5 + 0.5 * Math.sin(ballAim.ph * 4.5);
  AIM_RING.push({ x: ballAim.x, z: ballAim.z, y: 0.14, r: BALL_R * (1.1 + 0.14 * p),
                  spin: ballAim.ph * 0.8, op: 0.9, c: 0x8fe6ff, add: 1 });
  AIM_RING.push({ x: ballAim.x, z: ballAim.z, y: 0.13, r: BALL_R * 0.5,
                  spin: -ballAim.ph * 0.5, op: 0.35 + 0.5 * p, c: 0xffffff, add: 1 });
  return AIM_RING;
}
function stepBall(dt) {
  if (!ball) return;
  const o = ball;
  o.life -= dt;
  o.vy -= GRAV * dt;
  o.x += o.vx * dt; o.z += o.vz * dt; o.y += o.vy * dt;
  if (o.y <= o.r) {                              // 落地：彈一下，越彈越低
    o.y = o.r;
    if (o.vy < -2.5) {
      o.vy = -o.vy * BALL_BOUNCE; o.hops++;
      spawnDust({ x: o.x, y: 0.4, z: o.z }, 4, 6);
      ENG.shake(0.22); sndSmash();
    } else o.vy = 0;
  }
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
  /* 擋在球路上的人被撞開：方向是「球的行進方向 ＋ 從球心往外推」，
     所以正面被撞的往前飛，擦邊的往旁邊彈開。球不會點火，純粹是被推走。 */
  for (const w of workers) {
    if (w.air) continue;
    // 高度也要算：球還在半空中飛過頭頂時不該把下面的人撞飛
    const dx = w.x - o.x, dy = o.y - 0.9, dz = w.z - o.z;
    const dd = dx * dx + dy * dy + dz * dz;
    if (dd > (R + 0.8) * (R + 0.8)) continue;
    const d = Math.max(0.4, Math.hypot(dx, dz));
    tossWorker(w, o.vx * 0.6 + dx / d * 6, rr(4, 7), o.vz * 0.6 + dz / d * 6, false);
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
  const roll = Math.pow(BALL_ROLL, dt);          // 滾動阻力
  o.vx *= roll; o.vz *= roll;
  sp = Math.hypot(o.vx, o.vz);

  /* 停下來的條件。範圍放到草地邊緣（不是工地邊緣）：現在球是從玩家點的地方丟出來的，
     點在場邊時起點本來就在工地外，用工地邊緣當界的話那一發出手就被收掉。 */
  if (sp < 4.5 || o.life <= 0 || Math.hypot(o.x, o.z) > arenaR + 24) {
    spawnRing({ x: o.x, y: 0, z: o.z }, 5);
    ball = null; ENG.hideBall();
  } else {
    // 滾動軸：水平、垂直於前進方向。方向弄反的話球會像倒著滾
    ENG.setBall(o.x, o.y, o.z, o.r, o.vz / sp, -o.vx / sp, o.ang);
  }
}

/* 龍捲風：在地面走一段路，把沿路的積木吸起來繞圈，最後隨機甩出去。
   可以同時存在好幾道——畫面成本跟道數無關（引擎那邊一層一顆 InstancedMesh），
   真正的上限是塵霧配額，所以卡在 TW_MAX 道。 */
const TW_MAX = 4, TW_LIFE = 7, TW_R = 6, TW_H = 34;
function launchTornado(point) {
  /* 大致朝著工地中心掃過去，但要偏一點：好幾道都精準對著同一點的話，
     幾秒後全部疊在中心變成一團，看不出是好幾道。 */
  const a = Math.atan2(-point.z, -point.x) + rr(-0.7, 0.7);
  if (!twists) twists = [];
  if (twists.length >= TW_MAX) twists.shift();     // 放太多道就把最早那道擠掉
  twists.push({
    x: point.x, z: point.z, r: TW_R, h: TW_H, life: TW_LIFE,
    /* 起始角度隨機：漏斗的扭曲完全是 spin 的函數，都從 0 開始的話
       同時在場的幾道會擺出一模一樣的姿勢，看起來像複製貼上。 */
    spin: rr(0, 6.28), vx: Math.cos(a) * 3.2, vz: Math.sin(a) * 3.2, hit: 0
  });
  /* 拉高之後漏斗頂會超出畫面上緣（矮建築取景近，量到 NDC 1.45），
     跟核彈的蘑菇雲同一個處理：鏡頭退到整支漏斗進得了畫面的距離，之後就停在那裡不收回來。
     漏斗很瘦（半徑才 6），所以決定距離的一定是高度那一邊。 */
  ENG.holdWide(TW_H, TW_R);
  sndWind();
}
function stepTwist(dt) {
  if (!twists) return;
  for (let i = twists.length - 1; i >= 0; i--) {
    const w = twists[i];
    w.life -= dt;
    w.spin += dt * 7;
    w.x += w.vx * dt; w.z += w.vz * dt;
    // 每隔一陣子換個方向，走起來才像亂竄而不是直線
    w.vx += rr(-6, 6) * dt; w.vz += rr(-6, 6) * dt;
    const sp = Math.hypot(w.vx, w.vz);
    if (sp > 6) { w.vx = w.vx / sp * 6; w.vz = w.vz / sp * 6; }
    if (Math.hypot(w.x, w.z) > arenaR) { w.vx *= -1; w.vz *= -1; }

    const R = w.r, R2 = R * R;
    let n = 0;
    for (const b of blocks) {
      if (b.st === CARRY || b.st === TOSS) continue;
      const dx = b.x - w.x, dz = b.z - w.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > R2 || b.y > w.h) continue;
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
    /* 小人跟碎料吃同一組力：切線繞圈 ＋ 往內吸 ＋ 往上捲。
       第一次掃到才 tossWorker（把工作脫手、進入飛行），之後每幀只加速度——
       每幀都呼叫的話速度會被歸零，人就黏在漏斗底部原地抖。 */
    for (const p of workers) {
      const dx = p.x - w.x, dz = p.z - w.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > R2 || p.y > w.h) continue;
      const d = Math.max(0.5, Math.sqrt(d2));
      if (!p.air) tossWorker(p, 0, 0, 0, false);
      const pull = 1 - d / R;
      p.vx += (-dz / d * 26 + -dx / d * 10) * pull * dt * 3;
      p.vz += (dx / d * 26 + -dz / d * 10) * pull * dt * 3;
      p.vy += (16 + 30 * pull) * dt * 3;
    }
    if (n) {
      w.hit += n;
      afterHit(n, { x: w.x, y: 2, z: w.z }, R * 0.6);
    }
    spawnTwistDust(w, dt, twists.length);
    /* 這裡刻意不做畫面震動。龍捲風會持續好幾秒，每幀都加一點震動的話
       畫面就一路晃到結束，看久了很不舒服——震動留給槌子、保齡球那種單次撞擊。 */
    if (w.life <= 0) twists.splice(i, 1);
  }
  if (!twists.length) twists = null;
}

/* ── 爆炸 ───────────────────────────────────────────────
   炸彈、核彈、魔法共用的出口。跟槌子的差別是「沒有揮擊方向」——
   純徑向往外加一股上抬，所以積木是往四面八方噴，不是被打向某一側。 */
const Y_BOOST = 0.85;               // 抬升占衝擊力道的比例（重力 26，這個值約抬 16 單位高）
/* wind：要不要加那一圈往外掃的風壓（核彈與爆裂魔法專用，見 spawnWind）。
   炸彈／隕石／投石機那幾種小爆炸不給——它們的半徑才 7～14，
   掃出 2.6 倍的氣浪會比爆炸本身還顯眼，變成小道具看起來比核彈兇。 */
/* crash＝隕石那種「砸下來」的爆法：一樣把積木掃飛、一樣點火，但不走火球那一套
   （發光球殼、噴出來的火星、貼地光環、衝擊環），聲音也改成一聲悶響。
   隕石的重點本來就是火不是爆炸，掛一顆跟核彈同款的火球在上面反而搶戲。 */
function explode(point, R, power, magic, wind, crash) {
  const R2 = R * R;
  let n = 0;
  for (const b of blocks) {
    /* 只有小人手上（含正拋向工地）的不動它。
       半空中的碎料也要吃到衝擊波——魔法陣先把碎料吸到陣心，那些都是 FLY，
       漏掉的話「先收縮後爆發」會變成「吸過來然後靜靜落地」。 */
    if (b.st === CARRY || b.st === TOSS) continue;
    const dx = b.x - point.x, dy = b.y - point.y, dz = b.z - point.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > R2) { if (b.st === SET && d2 < R2 * 1.7) b.wob = 0.55; continue; }
    const d = Math.sqrt(d2), ol = Math.max(0.7, d);
    const f = Math.pow(1 - d / R, 0.55) * power;   // 越靠近炸點噴越遠
    const wasSet = b.st === SET;
    /* 衝擊波是球狀的：方向取「炸心 → 積木」的三維單位向量，再疊一股往上的抬升。
       抬升跟「離炸心多近」成正比——越近的拋得越高，落地才有明顯的拋物線；
       只給徑向的話積木是貼著地面往外掃，看起來像被推倒不像被炸飛。
       垂直分量一律取正（用 |dy|）：照 dy 正負給的話，炸點底下的積木會被往地裡壓。 */
    const lift = f * Y_BOOST * (0.35 + 0.65 * (1 - d / R));
    /* 積木剛好疊在炸點上時（魔法陣先把整棟吸到陣心就是這樣），
       「炸心 → 積木」是個接近零的向量，照算的話這些積木只剩 lift，
       會整團直直往上噴成一根柱子。這種時候方向改抽一個隨機的水平角。 */
    let nx = dx / ol, nz = dz / ol;
    if (d < 1.2) { const a = Math.random() * Math.PI * 2; nx = Math.cos(a); nz = Math.sin(a); }
    breakBlock(b,
      nx * f + rr(-2, 2),
      Math.abs(dy) / ol * f * 0.5 + lift + rr(1, 4),
      nz * f + rr(-2, 2));
    /* 爆炸打出來的碎料一律點著：拖著火飛出去、落地是一塊焦炭。
       點在這裡而不是事後用 igniteAround 撈，是因為「被這一發炸到的」就是這個迴圈掃到的這些，
       事後撈還要再掃一次全部積木、還分不出哪些是別發炸出來早就躺在那裡的。 */
    igniteBlock(b);
    if (wasSet) n++;
  }
  /* 站在火球裡的人跟碎料同一套：吃同一條衝擊力公式、被炸飛出去，而且一律點著
     （落地才開始燒）。圈外那一帶不吹飛，交給 afterHit 把他們掀倒就好。
     這段要排在 afterHit 前面：afterHit 不會再去動已經飛起來的人。
     這裡只取水平距離——人站在地上，用三維距離的話炸點抬高一點就打不到人了。 */
  for (const w of workers) {
    if (w.air) continue;
    const dx = w.x - point.x, dz = w.z - point.z;
    const d = Math.hypot(dx, dz);
    if (d > R) continue;
    const f = Math.pow(1 - d / R, 0.55) * power;
    const lift = f * Y_BOOST * (0.35 + 0.65 * (1 - d / R));   // 抬升的算法跟積木同一條
    const ol = Math.max(0.6, d);
    let nx = dx / ol, nz = dz / ol;
    if (d < 1.2) { const a = Math.random() * Math.PI * 2; nx = Math.cos(a); nz = Math.sin(a); }
    tossWorker(w, nx * f + rr(-2, 2), lift + rr(1, 4), nz * f + rr(-2, 2), true);
  }
  afterHit(n, point, R);
  /* 還站著的（SET）餘火：半徑放到 1.5 倍去找——衝擊圈內幾乎都被炸飛了，
     沒倒的都在圈外那一帶。這些會繼續往鄰居蔓延。
     碎料的火不在這裡點，在上面那個迴圈裡逐塊點——見那邊的說明。 */
  igniteAround(point, R * 1.5, Math.round(R * 0.8), SET);
  // 火球與衝擊環是「爆炸」的長相，crash 那條只留下被砸飛的積木與揚起來的塵土
  if (!crash) { spawnBlast(point, R, magic); spawnRing(point, R); }
  spawnDust(point, R, n);
  // 風壓排在最後：它吃的塵霧配額比較兇，先讓爆炸本身那些拿到自己的份
  if (wind) spawnWind(point, R, magic);
  ENG.shake(0.5 + Math.min(1.8, R * 0.03 + n * 0.015));
  if (crash) sndThud(R); else sndBoom(R);
  return n;
}

/* ── 放火 ───────────────────────────────────────────────
   點到的那一塊開始燒，火沿著格子往鄰居蔓延；一塊燒到底就焦黑、鬆脫掉到地上。
   它沒有「一下」——威力全在蔓延，放著不管整棟會自己燒垮。

   火不另外開網格：燒起來的樣子是「積木的目標色往焦黑收」＋幾顆火苗（hot）＋
   一點深色的煙（dust），三樣都是現成的，所以這個道具是 0 個 draw call。

   蔓延用 26 鄰居（含斜角），跟支撐判定共用同一份 NBR：voxel 造型很多是斜線畫的
   （鐵塔的斜撐、螺旋、圓弧），只認 6 面的話火會在斜著相鄰的地方整片停死。 */
const FIRE_MAX = 150;         // 同時最多幾塊「還站著的」在燒——粒子與 CPU 的閘門
/* 碎料的額度要蓋得住「一發核彈打出來的全部碎料」——半徑 30 幾乎蓋住整棟，
   量過一發能打出 2861 塊。訂太低的話同一發爆炸裡會有一批碎料沒燒起來，
   看起來不像設計，像額度用完了。成本量過：2511 塊在燒時每幀多 0.23ms（預算 4ms）。 */
const EMBER_MAX = 3000;
const BURN_TIME = 2.2;        // 一塊從點著到燒斷掉下來
const EMBER_TIME = 3;         // 碎料燒多久——燒完就是一塊焦炭，不會再掉一次
const BURN_SPREAD = 0.35;     // 燒到幾成才開始把火傳給鄰居
let slotOwner = null;         // slot → blocks 索引；只有蔓延需要反查，燒的時候每幀重建

/* 點著一塊。SET（還站著的）跟 FLY（碎料）都燒得起來，但燒法不同：
   前者燒 BURN_TIME、會焦黑鬆脫掉下來、還會把火傳給鄰居；
   後者燒固定 EMBER_TIME，只是拖著火飛、落地變成一塊焦炭
   （它已經離開建築了，沒有鄰居可傳，也不用再打掉一次）。 */
function igniteBlock(b) {
  if (!b || b.burn || (b.st !== SET && b.st !== FLY)) return false;
  const sp = b.st === SET;
  /* 兩種火各有各的額度。共用一個的話，一發爆炸打出來的幾百塊碎料會把額度整個吃光，
     旁邊還站著的那半棟就再也燒不起來——那才是這個道具最該看到的畫面。 */
  if (fires && (sp ? nSpread >= FIRE_MAX : fires.length - nSpread >= EMBER_MAX)) return false;
  if (!fires) fires = [];
  b.burn = 1;
  if (sp) nSpread++;
  /* 燒的快慢每塊各抽一個倍率：全部同速的話整面牆會同一秒一起變黑、一起掉下來，
     看起來像在播動畫不像在燒。碎料不抽，它就是規定的那 3 秒。
     c0 記原本的顏色，焦黑是從它往黑內插出來的。
     em（火苗的配額累積）則是從隨機的地方起跳、不是 0：一發爆炸會在同一幀點著上千塊，
     全部從 0 開始的話它們會同時湊滿第一顆火苗——火就變成「整片一起閃、然後一起沒有」。 */
  fires.push({ b, sp, dur: sp ? BURN_TIME : EMBER_TIME, t: 0, rate: sp ? rr(0.8, 1.3) : 1,
               next: rr(0.1, 0.3), em: Math.random(), c0: [b.tr, b.tg, b.tb] });
  return true;
}
/* 換建築、或測試要回到乾淨狀態時，把火整批收掉。
   b.burn 是掛在積木上的旗標，只把 fires 設成 null 的話那些積木會永遠點不著。 */
function clearFires() {
  if (fires) for (const f of fires) f.b.burn = 0;
  fires = null; nSpread = 0;
}
/* 放火道具的入口。點到的是碎料（不是建築的一部分）時就改找落點附近最近的一塊建築——
   不然點在牆前面那堆碎料上會像沒反應。 */
function torch(hit) {
  let b = hit.idx >= 0 ? blocks[hit.idx] : null;
  if (!b || b.st !== SET || b.burn) {
    let best = 25;                                     // 5 單位內才算，再遠就是點空地
    b = null;
    for (const k of blocks) {
      if (k.st !== SET || k.burn) continue;
      const d2 = (k.x - hit.point.x) ** 2 + (k.y - hit.point.y) ** 2 + (k.z - hit.point.z) ** 2;
      if (d2 < best) { best = d2; b = k; }
    }
  }
  if (!igniteBlock(b)) return;
  if (phase === 'done') phase = 'wreck';               // 完工的建築被動到 → 進入拆除中
  sndFire();
}
/* ── 煙火 ───────────────────────────────────────────────
   點地面：一次齊射三發往天上竄，到頂各自炸開成雙層的一球火星，
   火星帶著火慢慢落下來。落到建築上就從那一塊燒起來——
   所以它是「往天上灑火種」，不是爆炸：一塊積木都打不掉，
   但落點散得開，燒起來的地方比放火多。 */
const FW_TOP = 42;                  // 竄多高（每發再抽 ±20%，高度錯開才有層次）
const FW_RISE = 32;                 // 上升速度
/* 施放期間鏡頭要退到「整場齊射進得了畫面」的距離，所以給的是齊射的實際尺寸。
   實測一場齊射（三發，追七秒）：火星最高衝到 58、最遠散到 23。
   FW_TOP 只是彈體出膛的高度，炸開之後火星自己還會再往上竄十幾單位，照它抓會少算一截。 */
const FW_HOLD_TOP = 58, FW_HOLD_R = 23;
/* 一次點下去放三發：一發就是一朵花，三發錯開時間、錯開落點、錯開高度才叫「一場煙火」。
   後面兩發各晚 0.2～0.5 秒 ×序號出膛，落點在點擊處周圍 3～7 單位。 */
const FW_SHOT = 3;
const FW_GAP = [0.2, 0.5];
const FW_OFF = 7;
const FW_SPARK = 44;                // 外層炸開幾顆火星
const FW_CORE = 20;                 // 內層那球幾顆：換第二個顏色、速度只有一半 → 雙層的花
/* 煙火自己的粒子配額。通用的 HOT_MAX（220）是「爆炸火球＋幾棟在燒」抓的，
   一場齊射光是天上的火星就有三百多顆，共用那個配額的話平均每顆火星分不到一顆粒子，
   整片會變成一閃一閃的點而不是一朵花。畫得出來的上限是引擎的 MAXFIRE。 */
const FW_HOT = 300;
const FW_SPEED = 17;                // 火星炸開的初速
const FW_DRAG = 0.42;               // 火星的空氣阻力（每秒保留的比例）——飄下來，不是拋物線
const FW_FALL = 0.34;               // 火星吃多少重力（比積木輕很多）
const FW_LIFE = 3.4;                // 火星最多飛多久
/* 二次炸開：外層挑這麼多顆，飛到一半自己再炸成一小球。
   一次撒得再多也只是「炸開的那一瞬間很滿」，有二次炸開才會一直啪下去。 */
const FW_CRACK = 8;
const FW_CRACK_N = 6;               // 二次各炸出幾顆
const FW_MAX = 8;                   // 同時最多幾發在天上（一次齊射就三發）
/* 每發抽一個顏色。cr/cg/cb 是亮的那一刻，to 是冷掉之後的——
   都收成同色系的暗版，落下來那一段才看得出「這一發是綠的」。 */
const FW_COL = [
  [[1, 0.42, 0.42], [0.5, 0.08, 0.08]],   // 紅
  [[0.45, 0.75, 1], [0.08, 0.2, 0.5]],    // 藍
  [[0.55, 1, 0.55], [0.1, 0.42, 0.12]],   // 綠
  [[1, 0.88, 0.45], [0.5, 0.3, 0.05]],    // 金
  [[1, 0.55, 1], [0.45, 0.1, 0.42]]       // 粉
];
let fworks = null;                  // 正在往上竄的
let fwSparks = null;                // 炸開後落下的火星
let fwWait = null;                  // 已經點下去、還沒出膛的那幾發（齊射的第二、三發）

function launchFw(p) {
  fireShell(p.x, p.z);
  for (let i = 1; i < FW_SHOT; i++) {
    if (!fwWait) fwWait = [];
    const a = rr(0, Math.PI * 2), d = rr(FW_OFF * 0.4, FW_OFF);
    fwWait.push({ x: p.x + Math.cos(a) * d, z: p.z + Math.sin(a) * d,
                  t: i * rr(FW_GAP[0], FW_GAP[1]) });
  }
  /* 跟龍捲風、蘑菇雲同一套：不退鏡頭的話整發都在畫面外。
     量過：貼著中世紀城堡的取景，炸開那一刻火星的 NDC y 是 1.5（1 就已經出界了）。 */
  ENG.holdWide(FW_HOLD_TOP, FW_HOLD_R);
}
/* 一發：抽兩個顏色（外層一個、芯一個），高度也各抽一個 */
function fireShell(x, z) {
  if (!fworks) fworks = [];
  if (fworks.length >= FW_MAX) fworks.shift();
  const i = Math.floor(Math.random() * FW_COL.length);
  let j = Math.floor(Math.random() * (FW_COL.length - 1));
  if (j >= i) j++;                                  // 芯一定跟外層不同色
  fworks.push({ x, y: 0.8, z, vx: rr(-1.6, 1.6), vz: rr(-1.6, 1.6),
                top: FW_TOP * rr(0.8, 1.2), em: 0, c: FW_COL[i], c2: FW_COL[j] });
  sndFwUp();
}
/* 火星／尾巴共用的粒子。s 小、命短：大顆長命的話整發會糊成一團橘色方塊。
   配額滿了的時候是「頂掉自己人裡最老的那顆」，不是「這一顆不冒」——
   直接不冒的話配額會被陣列前面那幾顆火星整碗端走（實測一發就想冒 4747 顆、
   只進得去 1938 顆），齊射的第二、三發等於整發沒有尾巴。
   只頂 fw 的：爆炸火球那些不能被煙火擠掉，那是別的道具的畫面。 */
function fwHot(x, y, z, c, s, life, sp) {
  if (hot.length >= FW_HOT) {
    const i = hot.findIndex(h => h.fw);
    if (i < 0) return;
    hot.splice(i, 1);
  }
  hot.push({
    x, y, z, vx: rr(-sp, sp), vy: rr(-sp, sp), vz: rr(-sp, sp),
    rx: Math.random() * 6, ry: Math.random() * 6,
    s, life, g: -1.2, grow: 0.96, cool: rr(0.3, 0.7),
    cr: c[0][0], cg: c[0][1], cb: c[0][2], to: c[1], fw: 1
  });
}
const rgbHex = c => (Math.round(c[0] * 255) << 16) | (Math.round(c[1] * 255) << 8) |
                    Math.round(c[2] * 255);
/* 撒一球火星。crack 是「前幾顆要帶二次炸開」 */
function fwSpray(x, y, z, c, n, speed, life, crack) {
  for (let i = 0; i < n; i++) {
    if (fwSparks.length > 900) return;               // 保險絲，正常一場齊射約 500 顆
    /* 均勻撒在球面上：三個分量各自亂數的話會集中在立方體的八個角，
       炸開來是一團方的，不是一顆球。 */
    const a = Math.random() * Math.PI * 2, u = rr(-1, 1), s = Math.sqrt(1 - u * u);
    const sp = speed * rr(0.7, 1.15);
    fwSparks.push({ x, y, z,
                    vx: Math.cos(a) * s * sp, vy: u * sp, vz: Math.sin(a) * s * sp,
                    t: life * rr(0.8, 1.2), em: 0, c,
                    crack: i < crack ? rr(0.45, 0.8) : 0 });
  }
}
function burstFw(f) {
  if (!fwSparks) fwSparks = [];
  fwSpray(f.x, f.y, f.z, f.c, FW_SPARK, FW_SPEED, FW_LIFE, FW_CRACK);
  // 芯：同一個位置再撒一球慢的、換個顏色。外面一大球、裡面一小球 = 雙層的花
  fwSpray(f.x, f.y, f.z, f.c2, FW_CORE, FW_SPEED * 0.45, FW_LIFE * 0.8, 0);
  // 炸開那一瞬間的光圈，讓「啪」有個形狀。外圈快、芯那圈慢又是另一個顏色
  fxRings.push({ x: f.x, z: f.z, y: f.y, r: 1, vr: 30, op: 0.9, fade: 0.5,
                 c: rgbHex(f.c[0]), add: 1, spin: rr(0, 6.28) });
  fxRings.push({ x: f.x, z: f.z, y: f.y, r: 1, vr: 13, op: 0.85, fade: 0.75,
                 c: rgbHex(f.c2[0]), add: 1, spin: rr(0, 6.28) });
  sndFwPop();
}
/* 二次炸開：一顆火星飛到一半自己再炸成一小球。
   不放光圈——十幾顆同時炸就是十幾個環，每個環是一個 draw call。
   改成在原地補幾顆亮的粒子，「啪」一樣看得到，成本是 0 個 draw call。 */
function crackFw(s) {
  for (let i = 0; i < FW_CRACK_N; i++) {
    if (fwSparks.length > 900) break;
    const a = Math.random() * Math.PI * 2, u = rr(-1, 1), q = Math.sqrt(1 - u * u);
    const sp = 6 * rr(0.6, 1.2);
    fwSparks.push({ x: s.x, y: s.y, z: s.z,
                    vx: s.vx * 0.3 + Math.cos(a) * q * sp,
                    vy: s.vy * 0.3 + u * sp,
                    vz: s.vz * 0.3 + Math.sin(a) * q * sp,
                    t: rr(0.6, 1.2), em: 0, c: s.c, crack: 0 });
  }
  for (let i = 0; i < 3; i++) fwHot(s.x, s.y, s.z, s.c, rr(0.5, 0.9), rr(0.15, 0.3), 1.2);
}
/* 火星碰到的那一塊：燒起來的是「離落點最近、還站著」的那一塊。
   只在真的碰到（blockAt 是格子查表，很便宜）才掃一次 blocks。 */
function igniteAt(x, y, z) {
  let best = null, bd = 2.2 * 2.2;
  for (const b of blocks) {
    if (b.st !== SET || b.burn) continue;
    const d2 = (b.x - x) ** 2 + (b.y - y) ** 2 + (b.z - z) ** 2;
    if (d2 < bd) { bd = d2; best = b; }
  }
  if (!best || !igniteBlock(best)) return false;
  if (phase === 'done') phase = 'wreck';             // 完工的建築被動到 → 進入拆除中
  return true;
}
function stepFw(dt) {
  if (fwWait) {                                      // 齊射還沒出膛的那幾發
    for (let i = fwWait.length - 1; i >= 0; i--) {
      const w = fwWait[i];
      w.t -= dt;
      if (w.t <= 0) { fireShell(w.x, w.z); fwWait.splice(i, 1); }
    }
    if (!fwWait.length) fwWait = null;
  }
  if (fworks) {
    for (let i = fworks.length - 1; i >= 0; i--) {
      const f = fworks[i];
      f.y += FW_RISE * dt; f.x += f.vx * dt; f.z += f.vz * dt;
      f.em += dt * 110;                              // 尾巴要密，不然是一串點不是一條線
      while (f.em >= 1) { f.em--; fwHot(f.x + rr(-0.2, 0.2), f.y, f.z + rr(-0.2, 0.2), f.c, rr(0.3, 0.55), rr(0.2, 0.45), 0.5); }
      if (f.y >= f.top) { burstFw(f); fworks.splice(i, 1); }
    }
    if (!fworks.length) fworks = null;
  }
  if (!fwSparks) return;
  const drag = Math.pow(FW_DRAG, dt);
  for (let i = fwSparks.length - 1; i >= 0; i--) {
    const s = fwSparks[i];
    s.t -= dt;
    if (s.crack > 0) { s.crack -= dt; if (s.crack <= 0) crackFw(s); }
    s.vy -= GRAV * FW_FALL * dt;
    s.vx *= drag; s.vy *= drag; s.vz *= drag;
    const px = s.x, py = s.y, pz = s.z;
    s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
    s.em += dt * 30;
    while (s.em >= 1) { s.em--; fwHot(s.x, s.y, s.z, s.c, rr(0.36, 0.68), rr(0.25, 0.5), 0.3); }
    if (s.t <= 0 || s.y <= 0.3) { fwSparks.splice(i, 1); continue; }
    /* 打到建築就從那一塊燒起來。中點也要驗：火星一幀跑得比一格寬，
       只看終點的話會直接穿過薄牆。 */
    if (blockAt(s.x, s.y, s.z)) { igniteAt(s.x, s.y, s.z); fwSparks.splice(i, 1); continue; }
    const mx = (px + s.x) / 2, my = (py + s.y) / 2, mz = (pz + s.z) / 2;
    if (blockAt(mx, my, mz)) { igniteAt(mx, my, mz); fwSparks.splice(i, 1); }
  }
  if (!fwSparks.length) fwSparks = null;
}

/* 爆炸的餘火：範圍內 st 這個狀態的積木隨機點幾塊起來。限量是必要的——
   一發核彈的範圍內有上百塊，全點著會一次吃光 FIRE_MAX，之後別的地方就再也燒不起來了。 */
function igniteAround(p, R, n, st) {
  const R2 = R * R;
  let left = n;
  for (const b of blocks) {
    if (left <= 0) break;
    if (b.st !== st || b.burn) continue;
    if (Math.random() > 0.35) continue;                 // 稀疏地點：連成一片就不像餘火
    const d2 = (b.x - p.x) ** 2 + (b.y - p.y) ** 2 + (b.z - p.z) ** 2;
    if (d2 > R2) continue;
    if (igniteBlock(b)) left--;
  }
  return n - left;
}
function stepFire(dt) {
  if (!fires) return;
  /* slot → 積木的反查表。蔓延要沿著格子走，而積木只記得自己在哪個 slot，沒有反向的表。
     有東西在蔓延時每幀重建一次；只有碎料在燒（爆炸過後的常態）就整段跳過——
     碎料不蔓延，為它每幀掃三千塊積木是白花的。 */
  if (bp && nSpread) {
    const n = bp.slots.length;
    if (!slotOwner || slotOwner.length !== n) slotOwner = new Int32Array(n);
    slotOwner.fill(-1);
    for (let k = 0; k < blocks.length; k++) {
      const b = blocks[k];
      if (b.st === SET && b.slot >= 0) slotOwner[b.slot] = k;
    }
  }
  for (let i = fires.length - 1; i >= 0; i--) {
    const f = fires[i], b = f.b;
    f.t += dt * f.rate;
    const k = Math.min(1, f.t / f.dur);
    // 焦黑：只動目標色，實際顏色每幀自己往目標靠（見 step 裡的 b.r += (b.tr − b.r) × …）
    b.tr = f.c0[0] * (1 - k) + 0.05 * k;
    b.tg = f.c0[1] * (1 - k) + 0.045 * k;
    b.tb = f.c0[2] * (1 - k) + 0.04 * k;
    /* 火苗。整棟在燒時每塊都全速噴會把粒子池吃光，所以配額除以 √(在燒的塊數)：
       一塊燒得旺、五十塊各自小小地燒，總量才守得住。 */
    f.em += dt * 13 / Math.sqrt(fires.length);
    while (f.em >= 1) {
      f.em--;
      if (hot.length > HOT_MAX - 40) break;             // 留一截給爆炸的火球
      hot.push({
        x: b.x + rr(-0.4, 0.4), y: b.y + rr(0, 0.5), z: b.z + rr(-0.4, 0.4),
        vx: rr(-0.6, 0.6), vy: rr(2.4, 4.6), vz: rr(-0.6, 0.6),
        rx: Math.random() * 6, ry: Math.random() * 6,
        s: rr(0.3, 0.66), life: rr(0.3, 0.62), g: -2.6, grow: 1.06, cool: rr(0.25, 0.5),
        cr: 1, cg: rr(0.5, 0.82), cb: rr(0.06, 0.24), to: [0.6, 0.12, 0.02]
      });
    }
    // 煙：比爆炸的煙深，而且往上飄（g 給負的）
    if (Math.random() < dt * 2.4 && dust.length < 380)
      dust.push({
        x: b.x + rr(-0.3, 0.3), y: b.y + 0.5, z: b.z + rr(-0.3, 0.3),
        vx: rr(-0.5, 0.5), vy: rr(1.2, 2.6), vz: rr(-0.5, 0.5),
        rx: Math.random() * 6, ry: Math.random() * 6,
        life: rr(1.6, 3.2), s: rr(0.5, 1.1), c: rr(0.2, 0.36), g: -0.6, fade: 2.2
      });
    if (f.sp && f.t > BURN_TIME * BURN_SPREAD) {
      f.next -= dt;
      if (f.next <= 0) { f.next = rr(0.1, 0.24); spreadFire(b); }
    }
    if (f.t < f.dur) continue;
    // 燒完了：建築那塊焦黑鬆脫掉下來；碎料就停在焦黑
    b.burn = 0;
    if (f.sp) nSpread--;
    /* 碎料（f.sp = false）本來就在地上或半空，沒有「鬆脫」可言，燒完只剩焦黑。
       已經不是 SET 的建築塊（燒到一半被上面垮下來的帶走）也一樣不用再打掉一次；
       placedCnt 與損失在 freeBlock 那邊算，重複呼叫會多扣一次。 */
    if (f.sp && b.st === SET) {
      breakBlock(b, rr(-1.3, 1.3), rr(-0.4, 0.6), rr(-1.3, 1.3));
      stats.smashed++;
      markSupportDirty(0.05);
    }
    /* 焦黑要設在 breakBlock 之後：freeBlock 會把目標色打回建材色（碎料就是建材），
       設在前面的話積木一掉下來就恢復原本的顏色，「燒黑」等於白做。 */
    b.tr = 0.05; b.tg = 0.045; b.tb = 0.04;
    fires.splice(i, 1);
  }
  if (!fires.length) fires = null;
}
/* 傳一格給鄰居。NBR 從隨機的位置開始繞一圈，找到第一個還站著、還沒燒的就點著——
   固定順序的話火會一路往同一個方向鑽，變成一條線而不是一片。 */
function spreadFire(b) {
  if (!bp || !bp.at || b.slot < 0 || !slotOwner) return;
  const s = bp.slots[b.slot];
  const off = Math.floor(Math.random() * NBR.length);
  for (let n = 0; n < NBR.length; n++) {
    const d = NBR[(n + off) % NBR.length];
    const j = bp.at.get(gkeyOf(s.gx + d[0], s.gy + d[1], s.gz + d[2]));
    if (j === undefined) continue;
    const k = slotOwner[j];
    if (k >= 0 && igniteBlock(blocks[k])) return;
  }
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

/* ── 隕石 ───────────────────────────────────────────────
   點一下先在地上一圈一圈地標，3 秒後隕石從斜上方 45° 斜插進來。
   範圍是投石機石頭的兩倍，威力介於石頭與定時炸彈之間——它的重點是火不是威力：
   落點一帶會燒起來，火接著自己往鄰居蔓延（跟放火同一套）。
   可以同時來好幾顆，每顆各自從一個方位進來、倒數也各走各的。 */
const MET_MAX = 6;              // 同時最多幾顆（畫面那邊的 MAXMET 也是 6）
const MET_WAIT = 3;             // 點下去到出現在天上（跟定時炸彈的引信一樣長）
const MET_FALL = 0.9;           // 從天上到落點
const MET_TOP = 62;             // 出現的高度。45° → 水平也退開同樣的距離
const MET_R = ROCK_R * 2;       // 「範圍是投石機石頭的兩倍」就是字面意思
const MET_POW = 16;             // 介於石頭（12）與定時炸彈（17）之間
function callMeteor(point) {
  if (!meteors) meteors = [];
  if (meteors.length >= MET_MAX) meteors.shift();   // 超過就把最早那顆擠掉，跟定時炸彈一樣
  const m = {
    tx: point.x, ty: Math.max(0.6, point.y), tz: point.z,
    a: rr(0, Math.PI * 2),       // 從哪個方位斜進來，每顆各抽一個
    t: MET_WAIT + MET_FALL, mark: 0, lit: 0, em: 0,
    x: 0, y: 0, z: 0, rx: rr(0, 6), ry: rr(0, 6), s: 2, hot: 0, smoke: 0
  };
  posMeteor(m, 1);               // 先擺到出現的位置：第一幀掃掠要有正確的起點
  meteors.push(m);
  sndTick();
}
/* k：1 = 剛出現在天上，0 = 落到目標點。
   45° 的意思就是「水平還要飛的距離＝還沒掉的高度」，所以兩邊共用同一個 up。 */
function posMeteor(m, k) {
  const up = k * MET_TOP;
  m.x = m.tx + Math.cos(m.a) * up;
  m.y = m.ty + up;
  m.z = m.tz + Math.sin(m.a) * up;
}
function meteorHit(m) {
  const p = { x: m.x, y: Math.max(0.8, m.y), z: m.z };
  /* 第六個參數＝crash：掃飛積木、揚塵、震動、點火都照舊，但不生火球與衝擊環，
     聲音也換成悶響——隕石是「砸下來燒起來」，不是又一發爆炸。
     倒數期間地上那一圈一圈的預告環不受影響，那是預告不是爆炸。 */
  explode(p, MET_R, MET_POW, false, false, true);
  /* 爆炸本身已經帶一點餘火，但隕石是「燃燒」的——落點一帶再多點幾塊起來。
     這是它跟同尺寸的普通爆炸最明顯的差別。 */
  igniteAround(p, MET_R * 1.6, Math.round(MET_R * 1.6), SET);
}
function stepMeteors(dt) {
  if (!meteors) return;
  for (let i = meteors.length - 1; i >= 0; i--) {
    const m = meteors[i];
    m.t -= dt;
    if (m.t > MET_FALL) {
      /* 倒數期間在落點一圈一圈地標。什麼都不畫的話這三秒看起來就像點了沒反應
         （核彈第一版就是這樣）。 */
      m.mark -= dt;
      if (m.mark <= 0) { m.mark = 0.5; spawnRing({ x: m.tx, y: 0, z: m.tz }, 5); sndTick(); }
      continue;
    }
    if (!m.lit) { m.lit = 1; sndMeteor(); }        // 進大氣層：這一刻才開始畫、才有聲音
    const px = m.x, py = m.y, pz = m.z;
    posMeteor(m, Math.max(0, m.t / MET_FALL));     // 等速直線：隕石不是被丟出來的，不走拋物線
    m.rx += dt * 5.5; m.ry += dt * 4.2;
    m.hot = Math.min(1, m.hot + dt * 3);
    /* 拖著火：沿著這一幀走過的線段補火苗，不是只在現在的位置生。
       它一幀跑五個單位，只生在端點的話尾巴會斷成一節一節的。
       火苗要小、要密、要短命——大顆又長命的話尾巴會散成一串橘色方塊，
       看起來像撒紙花不像火（第一版 s 給到 1.2 就是這樣）。 */
    m.em += dt * 150;
    while (m.em >= 1) {
      m.em--;
      if (hot.length > HOT_MAX - 30) break;        // 留一截給落地那顆火球
      /* 三顆裡有一顆是「火頭」：生在石頭四周（不是沿著路徑），大顆、短命，
         整圈把石頭包起來。全部平均撒在線段上的話，畫面是「一塊石頭後面跟著一串小點」，
         看不出石頭本身在燒；生在石頭正中央也不行——那顆立方體會把火擋在後面。 */
      const head = Math.random() < 0.34;
      const u = head ? 1 : Math.random();
      const j = head ? 1.35 : 0.3;
      hot.push({
        x: px + (m.x - px) * u + rr(-j, j),
        y: py + (m.y - py) * u + rr(-j, j),
        z: pz + (m.z - pz) * u + rr(-j, j),
        vx: rr(-0.7, 0.7), vy: rr(0.6, 2.2), vz: rr(-0.7, 0.7),
        rx: Math.random() * 6, ry: Math.random() * 6,
        s: head ? rr(1, 1.8) : rr(0.24, 0.62),
        life: head ? rr(0.1, 0.2) : rr(0.16, 0.4),
        g: -1.6, grow: head ? 1.1 : 1.04, cool: rr(0.2, 0.42),
        cr: 1, cg: rr(0.5, 0.84), cb: rr(0.06, 0.22), to: [0.55, 0.1, 0.02]
      });
    }
    // 尾煙：火後面拖一條深色的煙，尾巴才有長度感（往上飄，所以 g 給負的）
    m.smoke += dt * 44;
    while (m.smoke >= 1) {
      m.smoke--;
      if (dust.length > 380) break;
      const u = Math.random();
      dust.push({
        x: px + (m.x - px) * u + rr(-0.5, 0.5),
        y: py + (m.y - py) * u + rr(-0.5, 0.5),
        z: pz + (m.z - pz) * u + rr(-0.5, 0.5),
        vx: rr(-1, 1), vy: rr(0.5, 2), vz: rr(-1, 1),
        rx: Math.random() * 6, ry: Math.random() * 6,
        life: rr(0.9, 2), s: rr(0.55, 1.35), c: rr(0.22, 0.38), g: -0.5, fade: 1.8
      });
    }
    /* 半路撞到建築就當場炸開，跟投石機的石頭共用同一套掃掠判定：
       只在終點判定的話，斜插進來的隕石會從屋頂穿過去才炸。 */
    if (m.t <= 0 || sweepRock(m, px, py, pz)) { meteors.splice(i, 1); meteorHit(m); }
  }
  if (!meteors.length) meteors = null;
}

/* ── 核彈 ───────────────────────────────────────────────
   點下去先在地上標一圈、拉警報，2 秒後彈體才從天上掉下來。
   倒數期間什麼都不畫的話，前兩秒看起來就像點了沒反應。
   一次只有一顆：倒數中再點會改打新的地點。 */
const NUKE_WAIT = 2, NUKE_FALL = 0.8, NUKE_TOP = 130, NUKE_R = 30, NUKE_POW = 34;
/* 彈頭在彈體模型的原點上（nukeGroup 的 y=0 附近），所以掃掠只要往前多探這麼一點，
   碰到的就是彈頭的鼻尖，不是等整顆彈體埋進屋頂才算。 */
const NUKE_NOSE = 1.8;
function callNuke(point) {
  nuke = { x: point.x, y: NUKE_TOP + 3, z: point.z, s: NUKE_NOSE,
           t: NUKE_WAIT + NUKE_FALL, mark: 0, spin: 0 };
  // 警報一響，準心範圍內的人就開始跑。倒數多久就給他們跑多久
  alertFlee(point, NUKE_R, NUKE_WAIT + NUKE_FALL);
  sndSiren();
}
function nukeHit(p) {
  nuke = null;
  ENG.hideNuke();
  explode(p, NUKE_R, NUKE_POW, false, true);      // true = 加風壓
  startCloud(p, NUKE_R);
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
    const py = nuke.y;
    nuke.y = k * k * NUKE_TOP + 3;                 // 平方 = 越掉越快
    /* 半路碰到建築就在碰到的那一點炸，跟隕石／投石機共用同一套掃掠判定。
       固定炸在 y=2.5 的話，打台北 101 這種高的會從樓頂穿到腳邊才炸，
       上半截等於沒被炸到——那是衝擊波半徑量得到的差別，不只是好不好看。 */
    if (sweepRock(nuke, nuke.x, py, nuke.z)) {
      nukeHit({ x: nuke.x, y: Math.max(2.5, nuke.y), z: nuke.z });
      return;
    }
    ENG.setNuke(nuke.x, nuke.y, nuke.z, nuke.spin);
  } else {
    nukeHit({ x: nuke.x, y: 2.5, z: nuke.z });     // 沒撞到東西：照樣炸在地面
  }
}

/* ── 爆裂魔法 ───────────────────────────────────────────
   魔法陣一層層往外長，最外圈就是等一下的爆炸範圍——
   讓你在那六秒裡看得出來會炸到哪。一次只有一個，再點會移到新的地點重來。 */
const MAG_TIME = 6, MAG_R = 30, MAG_POW = 34;
/* 一層擴張到定位要多久、小火圈從一層升到上一層要多久。
   兩者相加就是「每隔多久多一層」，六層在 5×0.32+0.15 ＝ 1.75 秒內長齊，
   剩下的 4.25 秒六層都在場上轉——這一段才是「陣蓄滿了」的樣子，要留得夠久。
   （v1.47 把 0.24/0.3 收成 0.15/0.17：長的過程本來就是過場，滿陣才是主角，
   滿陣從 3 秒延到 4.25 秒。再快就看不清楚是一層一層長的了。） */
const MAG_GROW = 0.15, MAG_RISE = 0.17;
const MAG_GAP = MAG_GROW + MAG_RISE;
/* 小火圈的半徑（MAG_R 的倍率）。新的一層就是從這個半徑擴張出去的，
   所以兩邊一定要用同一個數字——不然「火圈擴張成魔法陣」中間會跳一下。 */
const MAG_SEED = 0.14;
/* 陣是**六層疊起來**的，不是同心圓：整疊都浮在半空，最下面那層離地就有 12 單位，
   中間收窄、最上最下那兩層放大——照參考圖的層次。r 與 y 都是 MAG_R 的倍率。
   最下層不做滿爆炸半徑（那會比建築大一大圈，看起來像地上的跑道），
   代價是「最外圈就是爆炸範圍」這個提示沒了。
   整疊拉到 0.40～1.15R（12～34.6）：疊得矮的話整組是扁的，遠看像一疊盤子不像一座法陣。
   34.6 這個高度跟龍捲風同級，配上施法期間的運鏡塞得進畫面。 */
/* 高度不動、半徑收一圈（v1.54，最寬 0.62 → 0.56R）：一樣高但瘦一點，整疊才立得起來。
   形狀是**上下大、中間細**的沙漏——最上最下那兩層最寬，中間四層在 0.28～0.42 之間錯落
   （不照大小排：由大到小再放大會太像一個規矩的陀螺，夾一層特別小、一層又鼓回來，
   看起來才像法陣不像機械零件）。
   每次施法再各自乘一個 0.82–1.18 的抖動（施法當下決定，不是每幀跳），
   所以「最寬的是最上或最下」是**通常**而不是每次——抖動偶爾會讓中間那層鼓過頭。 */
const MAG_LAYER = [
  { r: 0.54, y: 0.40 },
  { r: 0.34, y: 0.55 },
  { r: 0.42, y: 0.70 },
  { r: 0.28, y: 0.85 },
  { r: 0.38, y: 1.00 },
  { r: 0.56, y: 1.15 }
];
const MAG_JITTER = 0.18;
const MAG_SPIN = 0.42;                    // 陣的轉速（rad/s，逆時針；六秒約轉 145°）
/* 最低那層的圓心高度。碎料被吸到這裡聚成一團，六秒一到也從這裡炸開——
   爆點放地面的話，火球會從那團碎料的下方冒出來，看起來像另一件事。 */
const MAG_CORE_Y = 0.12 + MAG_R * MAG_LAYER[0].y;
/* 整疊的頂端與最寬那一圈——施法期間的運鏡拿這兩個數字去算要退多遠。
   半徑要算進每層的抖動上限（rj 最多 1+MAG_JITTER），不然最寬那圈偶爾會被切到。 */
const MAG_TOP = 0.12 + MAG_R * MAG_LAYER[MAG_LAYER.length - 1].y;
const MAG_WIDE = MAG_R * Math.max(...MAG_LAYER.map(l => l.r)) * (1 + MAG_JITTER);
function castMagic(point) {
  /* 由下往上一層一層長，中間靠一個小火圈把火帶上去：
     先出現最下面那層 → 小火圈從它的圓心升到上一層的高度 → 抵達才擴張成新的一層。
     （原本是把六層的出現順序洗牌，每層各自憑空亮起來；改成固定順序＋看得見的火種，
     六層才像「一層帶起一層」而不是六件各自發生的事。每次施法的差異交給半徑、
     起始角度、轉速那三組抖動去做，那些本來就是每次都不一樣的。） */
  magic = {
    x: point.x, z: point.z, t: MAG_TIME, shown: 0,
    // 每層的半徑抖動：施法當下抽一次存起來，每幀重抽的話整疊會一直閃
    rj: MAG_LAYER.map(() => rr(1 - MAG_JITTER, 1 + MAG_JITTER)),
    /* 每層的紋路起始角度各抽一個定值：六層都從同一個角度起跳的話，
       螺旋會完全對齊，整疊看起來像一支花紋對齊的柱子。 */
    sj: MAG_LAYER.map(() => rr(0, 6.28)),
    /* 轉速再各乘一個倍率：同速的話整疊像一塊剛體在轉，錯開才像好幾層各自運轉。
       全部都是正的——正的就是俯視逆時針，這是使用者指定的方向。 */
    wj: MAG_LAYER.map(() => rr(0.7, 1.35))
  };
  /* 整疊頂端在 34.6，貼著建築的取景裝不下（矮建築取景更近）。
     跟龍捲風、蘑菇雲同一套：施法期間鏡頭退到整疊進得了畫面的距離，
     爆完那朵雲會再接手撐住這個距離。 */
  ENG.holdWide(MAG_TOP, MAG_WIDE);
  alertFlee(point, MAG_R, MAG_TIME);      // 魔法陣一亮，站在陣裡的人就往外跑
}
function stepMagic(dt) {
  if (!magic) return;
  magic.t -= dt;
  const el = MAG_TIME - magic.t;
  if (magic.t <= 0) {
    const p = { x: magic.x, y: MAG_CORE_Y, z: magic.z };   // 爆點＝最低那層的圓心
    magic = null;
    explode(p, MAG_R, MAG_POW, true, true);       // 第二個 true = 加風壓
    startCloud(p, MAG_R);             // 魔法爆完也留一朵，跟核彈同一種
    startArcs(p, MAG_R);              // 火球收乾之後，爆點還會劈三秒的藍電
    return;
  }
  const rings = [];
  let layers = 0;
  const seedR = MAG_R * MAG_SEED;
  for (let i = 0; i < MAG_LAYER.length; i++) {
    const g = (el - i * MAG_GAP) / MAG_GROW;       // 這一層長到幾成
    if (g <= 0) break;                             // 由下往上長，後面幾層還沒輪到
    layers++;
    const k = Math.min(1, g);
    const L = MAG_LAYER[i];
    /* 長出來的方式：位置一開始就在它該在的高度，只有半徑從小火圈的大小擴到定位。
       高度也跟著長的話，看起來是「從地上飄上去」而不是「在那裡展開」。
       起始半徑就是小火圈的半徑——火圈升到位之後直接被撐開成這一層，中間不跳。
       先快後慢（1−(1−k)²）：像被撐開的，等速擴張看起來是機械的。 */
    const full = MAG_R * L.r * magic.rj[i];
    const rad = seedR + (full - seedR) * (1 - (1 - k) * (1 - k));
    const y = 0.12 + MAG_R * L.y;
    /* 逆時針慢轉。角度一路累加，不是每幀重抽——重抽的話紋路會亂閃不是在轉。
       減不是加：紋路的角度 a 是用 (cos a, sin a) 擺到 (x, z) 上的，而畫面看下去 +Z 朝下，
       所以 a 變大在畫面上是順時針。量過的：a 遞增時螢幕外積 −0.0067（順時針）。 */
    const spin = magic.sj[i] - el * MAG_SPIN * magic.wj[i];
    /* 每一層是兩個環疊出來的：裡面一圈實色的芯，外面一圈加法混色的暈。
       只畫一個環的話它就只是地上一條紅色帶子，不像在發光。
       配色照參考圖收（v1.54）：芯與盤是**深紅**（原本 #ff3a1c 偏橘，整疊看起來是一團橘），
       外圈的暈改成**金黃**（原本 #ff9a4a 也是橘，跟芯同色等於沒有層次）——
       深紅的盤 + 金黃的紋路與外暈，紅黃分得開才有參考圖那種灼燒感。 */
    rings.push({ x: magic.x, z: magic.z, r: rad, y, spin, op: k, c: 0xe81a08, sp: 1, fill: 1 });
    rings.push({ x: magic.x, z: magic.z, r: rad * 1.04, y, spin,
                 op: k * 0.75, c: 0xffb42a, add: 1 });
  }
  /* 小火圈（火種）：第一層一亮它就在場上，之後**一直都在**，直到爆炸。
     一層長好 → 升到上一層的高度 → 停在那裡等那一層長好 → 再往上升。
     停留的那一段就待在「正在長的那一層」的圓心，新的一層等於是從它身上撐開的；
     原本只在爬升那 0.3 秒畫，長層的 0.24 秒它就不見了，看起來是一閃一閃地跳上去。
     六層長齊之後它留在頂端那層，一路燒到爆炸。
     不給 sp：紋路留給正式的六層，這裡要的是一小團在竄的火。 */
  if (layers > 0) {
    const top = layers - 1;
    const yTop = 0.12 + MAG_R * MAG_LAYER[top].y;
    let fy = yTop;
    if (top + 1 < MAG_LAYER.length) {
      // 這一層還在長的時候 u <= 0（停著），長好才開始爬，爬到 1 就換這一層當 top
      const u = (el - (top * MAG_GAP + MAG_GROW)) / MAG_RISE;
      if (u > 0) fy = yTop + (0.12 + MAG_R * MAG_LAYER[top + 1].y - yTop) * Math.min(1, u);
    }
    /* 一路等大，不忽大忽小：脈動會讓人以為它在呼吸或快要炸開，
       這個火種要傳達的只有「往上帶」。等大剛好也就是新層的起始半徑，交接不跳。
       顏色直接抄爆炸火球那組色階（FLASH_SHELL 的亮黃 → 橘），跟火球是同一團火。
       芯要疊兩圈：環的線寬是半徑的 7%，半徑才 4.2 的小圈只畫一圈的話那條線
       細到看不出顏色，剩下的只有底下那片淡淡的盤。 */
    const fs = -el * MAG_SPIN * 3.4;                            // 轉得比陣快，才像在竄
    rings.push({ x: magic.x, z: magic.z, r: seedR, y: fy, spin: fs,
                 op: 1, c: 0xffeda6, seed: 1 });
    rings.push({ x: magic.x, z: magic.z, r: seedR * 1.2, y: fy, spin: fs * 0.8,
                 op: 1, c: 0xffc44a, fill: 1, seed: 1 });
    rings.push({ x: magic.x, z: magic.z, r: seedR * 1.75, y: fy, spin: fs * 0.6,
                 op: 0.85, c: 0xff9a22, add: 1, seed: 1 });
  }
  // 一層兩個環（芯 + 暈），所以要數層數不是數環數
  if (layers > magic.shown) {
    /* 新的一層剛開始長 → 就在那一圈上撒一把十字星光。
       撒的位置用「長好之後」的半徑，不是這一瞬間的（那時它才火種那麼大）：
       星光要先標出這一層將要長到哪，環再追上來。 */
    for (let i = magic.shown; i < layers; i++) starsOn(i, STAR_PER);
    magic.shown = layers;
  }
  /* 長完之後也一直撒（v1.48）：只在長層那一下撒的話，滿陣那四秒整座陣是靜的。
     每次隨機挑一層，機率一樣——「平均撒在每一層」就是這個意思，
     不是每層各自計時（那樣看起來會像六排整齊的節拍器）。 */
  magic.star = (magic.star || 0) + dt * STAR_RATE;
  while (magic.star >= 1) {
    magic.star--;
    starsOn(Math.floor(Math.random() * layers), 1);
  }
  magic.rings = rings;
  magSuck(magic, dt);
  implode(magic, dt);
}

/* ── 往陣心捲進去的魔力粒子 ───────────────────────────────
   施法一開始就有，一路捲到爆炸：小、快、密，從陣外一路螺旋進陣心
   （就是等一下的爆點）。最後 0.3 秒真的把整棟捲進去的是 crushIn，
   這些光點是那件事的前奏——六秒裡一直在說「能量正往那一點集中」。
   v1.47 之前這裡是一道從陣心往上衝的光柱，看起來像中心在冒煙：方向反了，
   陣是在吸不是在噴，所以整個掉頭。 */
/* 第 i 層的位置與長好之後的半徑 → 撒 n 顆星光。長層那一下與滿陣期間都走這裡，
   兩邊算法一致，星星才會剛好落在那一圈上。 */
function starsOn(i, n) {
  spawnStars(magic.x, magic.z, 0.12 + MAG_R * MAG_LAYER[i].y,
             MAG_R * MAG_LAYER[i].r * magic.rj[i], n);
}
const SUCK_SPD = 34;              // 飛多快（單位／秒）：從外圈到陣心約 0.8 秒
function magSuck(m, dt) {
  const k = Math.min(1, (MAG_TIME - m.t) / MAG_TIME);      // 越接近爆炸吸得越急
  m.zip = (m.zip || 0) + dt * (30 + 54 * k);
  while (m.zip >= 1) {
    m.zip--;
    if (hot.length >= HOT_MAX - 30) break;    // 留一截給爆炸的火球與還在燒的碎料
    const a = Math.random() * Math.PI * 2, rad = rr(0.55, 1.1) * MAG_R;
    /* 冷色：紅陣上疊暖色會糊成一片，青藍與粉紫才看得出是「另一股東西被吸進去」。
       這跟那些慢慢捲上來的魔力光點是同一套配色。 */
    const cyan = Math.random() < 0.6;
    hot.push({
      x: m.x + Math.cos(a) * rad, y: rr(1.5, MAG_CORE_Y + 9), z: m.z + Math.sin(a) * rad,
      vx: 0, vy: 0, vz: 0, rx: Math.random() * 6, ry: Math.random() * 6,
      s: rr(0.18, 0.42), life: 2.5,               // 到陣心就自己熄，life 只是保險
      cr: cyan ? rr(0.2, 0.45) : rr(0.75, 1),
      cg: cyan ? rr(0.75, 1) : rr(0.3, 0.5), cb: 1,
      suck: [m.x, MAG_CORE_Y, m.z], spd: SUCK_SPD * rr(0.85, 1.2)
    });
  }
}

/* ── 引力坍縮 ─────────────────────────────────────────────
   爆炸前的最後幾秒，把周圍的東西往陣心捲進去（內吸 + 切線 = 螺旋），
   再撒一些往中心捲的魔力光點。先收縮、後爆發，張力才拉得起來——
   這是它跟核彈最大的差別：核彈是「一下打平」，魔法是「先聚成一團再炸開」。 */
const IMP_TIME = 4.5;               // 倒數剩幾秒開始吸碎料
/* 「脫離 → 收攏 → 炸開」全部擠進最後 0.3 秒，而且是**一次**扯下來、
   速度算成「剛好在爆炸那一刻抵達陣心」——分好幾幀慢慢扯的話，
   最後被扯下來的還在半路上就被炸開了，看起來就是三段各做各的、對不起來。 */
const CRUSH_AT = 0.3;               // 倒數剩幾秒把範圍內的東西整個扯下來砸向陣心
const CRUSH_BALL = 3;               // 收攏成一顆這麼大的球，不是收成一個點
function crushIn(m) {
  const T = Math.max(0.08, m.t);    // 距離爆炸還有多久：速度就照這個算
  const R2 = MAG_R * MAG_R;
  let n = 0;
  for (const b of blocks) {
    if (b.st === CARRY || b.st === TOSS) continue;      // 小人手上的不動
    const dx = b.x - m.x, dz = b.z - m.z;
    if (dx * dx + dz * dz > R2) continue;
    const wasSet = b.st === SET;
    /* 每塊各瞄陣心附近的一個隨機點。全部瞄同一個點的話，最後 0.1 秒整棟會疊成
       一顆積木大小的小點，看起來像憑空消失；散一顆球才看得到那團被壓縮的東西。 */
    const tx = m.x + rr(-CRUSH_BALL, CRUSH_BALL);
    const ty = MAG_CORE_Y + rr(-CRUSH_BALL * 0.8, CRUSH_BALL * 0.8);
    const tz = m.z + rr(-CRUSH_BALL, CRUSH_BALL);
    /* 水平：距離除以剩餘時間，遠的近的同時到。
       垂直：除了補上高度差，還要加回這段時間會被重力吃掉的 GRAV×T/2，
       不然整團會在半路往下沉，收攏的位置就不在爆點上。 */
    breakBlock(b, (tx - b.x) / T, (ty - b.y) / T + GRAV * T / 2, (tz - b.z) / T);
    if (wasSet) n++;
  }
  /* 記帳：計數、嚇小人、標記垮塌重算。半徑給 6（陣心那一圈）而不是 30，
     不然整個工地的小人都會被掀倒。 */
  if (n) afterHit(n, { x: m.x, y: MAG_CORE_Y, z: m.z }, 6);
}
function implode(m, dt) {
  const k = Math.min(1, (IMP_TIME - m.t) / IMP_TIME);   // 0 → 1，越接近爆炸吸得越猛
  if (k <= 0) return;
  if (!m.crush && m.t <= CRUSH_AT) { m.crush = 1; crushIn(m); }
  const R = MAG_R, R2 = R * R;
  /* 收攏開始之後就不再加吸力：那些積木已經在算好的彈道上，再推一把就會提早對穿過去。
     這一段只負責收攏之前那幾秒，把散落的碎料慢慢捲過來。 */
  for (const b of blocks) {
    if (m.crush) break;
    if (b.st !== FREE && b.st !== FLY) continue;        // 只吸碎料，建築等 crushIn 一次處理
    const dx = b.x - m.x, dz = b.z - m.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > R2) continue;
    if (b.st === FREE) { if (b.cell) gridDel(b); b.st = FLY; b.rest = false; b.snap = 0; }
    const d = Math.sqrt(d2);
    const pull = (0.35 + 0.65 * (1 - d / R)) * k * dt * 3;
    /* 垂直方向拉向最低層那圈的高度（＝爆點）。重力一直往下拉 26，所以這裡是
       「離目標高度多遠」的彈簧加一股固定上抬，碎料才會停在那個高度翻攪，
       而不是聚攏之後整團掉回地上。這一段放在 d2 < 1 的檢查前面：
       剛好落在陣心正上方的那幾塊要是被跳過，會從團裡掉出來。 */
    b.vy += ((MAG_CORE_Y - b.y) * 1.6 + 9) * pull;
    b.ay += rr(-6, 6) * dt;
    /* 進到陣心那一團就被拖慢。少了這一段，強吸力會讓積木直接對穿過去再飛出另一邊，
       爆炸當下反而是散開的——量過：沒有阻尼時爆炸當下平均離陣心 13.9，有的話 5.6。 */
    if (d < 7) {
      const f = 1 - Math.min(0.5, 4 * dt * (1 - d / 7));
      b.vx *= f; b.vy *= f; b.vz *= f;
    }
    if (d2 < 1) continue;                               // 已經在陣心，再算內吸會除以 0
    const nx = dx / d, nz = dz / d;
    // 內吸 + 切線；越靠近陣心吸力越強，看起來才像被捲進去而不是等速平移
    b.vx += (-nx * 30 - nz * 11) * pull;
    b.vz += (-nz * 30 + nx * 11) * pull;
  }
  /* 魔力光點：從陣的外圈生出來，靠 pull 一路捲進中心。
     三成給青藍色——參考圖裡捲上來的能量流是冷色的，跟紅陣對比才看得出「被吸進去」。 */
  m.motes = (m.motes || 0) + dt * (10 + 46 * k);
  while (m.motes >= 1) {
    m.motes--;
    if (hot.length >= HOT_MAX) break;
    const a = Math.random() * Math.PI * 2, rad = rr(0.45, 1.05) * R;
    const cold = Math.random() < 0.32;
    hot.push({
      x: m.x + Math.cos(a) * rad, y: rr(0.4, R * 0.5), z: m.z + Math.sin(a) * rad,
      vx: 0, vy: 0, vz: 0, rx: Math.random() * 6, ry: Math.random() * 6,
      s: rr(0.3, 0.85), life: rr(0.8, 1.8), g: 0, grow: 0.9,
      cr: cold ? rr(0.15, 0.4) : 1,
      cg: cold ? rr(0.7, 0.95) : rr(0.25, 0.6),
      cb: cold ? 1 : rr(0.2, 0.45),
      pull: [m.x, m.z]
    });
  }
  /* 陣心原本還有一道往上衝的光柱（六層被中間一道亮芯串起來）。v1.47 拿掉了：
     使用者看到的是「中心點在冒煙」——一股從陣心往外噴的東西，跟這個法術
     正在做的事（把周圍全部吸進來）完全相反。那股力氣改給 magSuck，方向掉頭。 */
}

/* ── 爆炸特效 ─────────────────────────────────────────────
   三層東西疊出來的：正中央一顆白熱的火球、從球面往外噴的火星、
   貼地掃出去的衝擊環。
   火星走 hot（不透明材質）而不是塵霧——塵霧那顆固定 50% 透明，
   火球混在裡面只會像幾片橘色玻璃，飛塊一擋就完全看不到了。 */
const HOT_MAX = 220;
/* 中央那顆火球。粒子撐不出「一整顆在發光的球」——96 顆小方塊再多也是一團碎火，
   中間該最亮的地方反而因為方塊之間有縫而透出背景。所以球本體交給實體球殼
   （見引擎 FLASH_SHELL），粒子留著當從球裡噴出來的火星。 */
const FLASH_MAX = 4;
const FLASH_LIFE = 0.65;         // 亮多久：蘑菇雲 0.45 秒撐傘蓋，火球要撐到那之後才收乾
const FLASH_HOLD = 0.2;          // 前 0.2 秒維持全亮，之後才開始暗
const FLASH_UP = 0.22;           // 球心抬離爆點多少（半徑的倍率）
function spawnBlast(p, R, magic) {
  /* 火球球心抬到爆點上方一點：貼著地面生的話會被自己炸出來的碎料堆整個埋掉——
     它是加法混色，擋在前面的積木照樣不透明，量過只剩一成看得到。
     抬起來之後球的下緣還是切在地面附近（埋在地下的那部分被草地擋掉），
     上半個球高過碎料堆，才是參考圖那顆罩在爆心上的火球。 */
  if (flashes.length >= FLASH_MAX) flashes.shift();
  flashes.push({ x: p.x, y: p.y + R * FLASH_UP, z: p.z, R, magic, t: 0, r: R * 0.34, op: 1 });
  const n = Math.min(96, 22 + Math.round(R * 2.4));
  for (let i = 0; i < n; i++) {
    if (hot.length >= HOT_MAX) break;
    const a = Math.random() * Math.PI * 2;
    const u = Math.pow(Math.random(), 0.6);
    /* 火星生在球面附近往外噴，不生在球心。生在球裡的話這些幾乎不透明的方塊
       會整片糊在球的正面，把中間最亮的地方遮成一堆橘色碎片——
       火球就退回「一團碎火」，正是要避開的那個樣子。 */
    const rad = R * (0.52 + 0.46 * u);
    const up = Math.random() * R * 0.3;
    /* 顏色照半徑分：貼著球面的亮黃、噴得最遠的橘。整團都給接近白的話，
       近看就只是一片奶油色，看不出是火。 */
    const core = u < 0.35;
    hot.push({
      x: p.x + Math.cos(a) * rad, y: p.y + up * 0.6 + 0.5, z: p.z + Math.sin(a) * rad,
      vx: Math.cos(a) * rad * 1.5, vy: 3 + up * 1.9, vz: Math.sin(a) * rad * 1.5,
      rx: Math.random() * 6, ry: Math.random() * 6,
      s: rr(0.45, 0.8) * (0.8 + R * 0.055), life: rr(0.45, 1.1),
      g: -1.5, grow: 1.25, cool: rr(0.5, 0.9),
      cr: 1, cg: core ? rr(0.78, 0.92) : rr(0.34, 0.5), cb: core ? rr(0.3, 0.5) : rr(0.04, 0.12),
      to: magic ? [0.85, 0.12, 0.32] : [0.5, 0.12, 0.03]            // 冷成暗紅／暗橘
    });
  }
  /* 中央的白閃原本是幾顆放大的白色方塊，現在球本體的核心就是白熱的，
     再疊那幾顆只會在球的正面糊出幾片奶油色的方形，所以拿掉了。 */
  // 貼地往外掃的兩圈光。參考圖裡那幾道橫向的環就是這個
  const c = magic ? 0xff3b6b : 0xffb038;
  for (let i = 0; i < 2; i++)
    fxRings.push({ x: p.x, z: p.z, y: 0.16 + i * 0.12, r: R * 0.2, vr: R * (2.2 - i * 0.8),
                   op: 1, fade: 0.5 + i * 0.3, c, add: 1, spin: rr(0, 6.28) });
}

/* ── 風壓 ─────────────────────────────────────────────────
   核彈與爆裂魔法才有的那一下氣浪。火球只有爆炸半徑那麼大（30），
   看起來威力就到那裡為止；風壓是「火球之外還掃出去一大圈」——
   掃到 2.6 倍半徑（78 單位，比整座工地還寬），才看得出這一發有多兇。

   兩樣東西疊出來的：
   1. 四圈往外衝的光環，越高的越小、擴得越慢 → 側面看是一個往外撐開的半球罩，
      不是地上四個同心圓（環本身是平的，靠高度差堆出弧度）。
   2. 地面被掀起來的一道塵牆，跟著環一起往外跑。它才是「地上的東西真的被吹到了」，
      只有光環的話那圈看起來像貼在地上的裝飾。
   不動任何積木與小人：這是特效，破壞範圍還是 explode 那一圈說了算。 */
const WIND_R = 2.6;                 // 氣浪掃到爆炸半徑的幾倍
const WIND_RINGS = 4;
const WIND_DUST = 64;               // 塵牆幾顆
function spawnWind(p, R, magic) {
  /* 顏色偏暖、不要接近白：這幾圈是加法混色又鋪得很大，給白的話整片畫面會過曝，
     連中間那顆火球都被洗掉（量過：拿掉火球的同一幀，過曝白從 0.13% 漲到 0.21%，
     火球本身的對比就從 3 倍掉到 2.8 倍）。風壓是被掀起來的塵，不是第二顆火球。 */
  const c = magic ? 0xff6fae : 0xffc078;
  for (let i = 0; i < WIND_RINGS; i++) {
    const k = i / (WIND_RINGS - 1);                 // 0 = 貼地那圈，1 = 最高那圈
    /* fade 是「淡掉要幾秒」，vr 要照它算：兩者不配的話環會在半路上就消失，
       掃不到該掃到的距離。目標是每一圈都在淡掉前後走到 WIND_R × R。 */
    const fade = 0.85 - 0.13 * k;
    fxRings.push({
      x: p.x, z: p.z, y: 0.2 + R * 0.4 * k,
      r: R * (0.3 - 0.14 * k),
      vr: R * WIND_R * (1 - 0.26 * k) / fade,
      vy: R * 0.05 * k,                             // 高的那幾圈邊擴邊往上飄一點
      op: 0.65 - 0.14 * k, fade, c, add: 1, spin: rr(0, 6.28), wind: 1
    });
  }
  for (let i = 0; i < WIND_DUST; i++) {
    if (dust.length > 600) break;                   // 引擎的塵霧上限是 720
    const a = i / WIND_DUST * Math.PI * 2 + rr(-0.06, 0.06);
    const sp = R * rr(1.1, 1.9);                    // 追得上光環的速度，才像同一股風
    dust.push({
      x: p.x + Math.cos(a) * R * 0.3, y: rr(0.3, 1.8), z: p.z + Math.sin(a) * R * 0.3,
      vx: Math.cos(a) * sp, vy: rr(0.4, 2.6), vz: Math.sin(a) * sp,
      // 顏色壓得比一般煙塵暗一點：這是被掀起來的土，太白會像整片起霧
      rx: 0, ry: a, life: rr(0.9, 1.7), s: rr(0.9, 2.4), c: rr(0.55, 0.82),
      keep: 0.985                                   // 預設 0.94 會讓它原地就停住
    });
  }
  ENG.shake(0.45);                                  // 疊在 explode 本來那一下上面
}

/* 火球：先一瞬間衝到大半個尺寸，之後慢慢撐開；亮度收得比半徑快。
   兩者同速的話它會像顆縮回去的氣球，火球是「膨脹的同時燒完冷掉」。 */
function stepFlash(dt) {
  for (let i = flashes.length - 1; i >= 0; i--) {
    const f = flashes[i];
    f.t += dt;
    const k = f.t / FLASH_LIFE;
    if (k >= 1) { flashes.splice(i, 1); continue; }
    f.r = f.R * (0.34 + 0.72 * Math.sqrt(k));       // sqrt：一開始猛、後面慢
    const fade = f.t < FLASH_HOLD ? 1 : 1 - (f.t - FLASH_HOLD) / (FLASH_LIFE - FLASH_HOLD);
    f.op = fade * fade;                             // 平方：亮的時間長、最後幾幀掉得乾脆
  }
}

/* ── 蘑菇雲 ───────────────────────────────────────────────
   不是一次生出來的：柱子先往上冒，半秒後才在頂端撐出傘蓋，同時腰上出現一圈環。
   一次生完的話它會「啪」地整朵出現在半空，看起來像貼圖不像爆炸長出來的。
   火光在裡面燒約 0.8 秒再冷掉，那是參考圖裡雲心會發亮的來源。 */
const CLOUD_GROW = 2.4;         // 整朵長完要多久
const SKIRT_T = 1.7;            // 腳下那圈煙要往外鋪多久
/* 核彈與爆裂魔法共用同一朵。魔法版原本是紅的、還會撒星光，v1.48 併回來——
   使用者要的是同一種雲，兩套配色只是讓同一件事看起來像兩件事。 */
function startCloud(p, R) {
  clouds.push({ x: p.x, z: p.z, R, t: 0, emit: 0 });
  /* 順手把鏡頭退到整朵雲進得了畫面的距離。用原本貼著建築的取景根本裝不下——
     量過：不退的話中型建築只看得到那根柱子，傘蓋整個在畫面上緣外。
     尺寸是實測 R=30 那朵：3.7 秒升到 39（≈R×1.3）、傘蓋半徑 15.4（≈R×0.51）。
     雲會一直往上飄，框的是「傘蓋撐開那幾秒」的樣子，不是它飄走之後的高度。 */
  ENG.holdWide(R * 1.3, R * 0.55);
}
function stepClouds(dt) {
  for (let i = clouds.length - 1; i >= 0; i--) {
    const c = clouds[i], t0 = c.t;
    c.t += dt;
    const R = c.R;
    /* 傘蓋現在爬到哪。柱子要靠這個值決定生到多高——柱子不是「自己往上長」，
       而是「傘蓋往上升，沿路留下來的那一條」。
       兩邊都從地面往上噴的話會混成一團胖雲，看不出蘑菇的頸子。 */
    const capY = R * 0.4 + Math.max(0, c.t - 0.45) * 8.5;
    if (c.t < 2.2) {                              // 柱子要一路補到傘蓋升上去為止
      c.emit += dt * 58;
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
            to: [0.6, 0.16, 0.04] });
        if (dust.length < 680)                       // 柱子的煙：沿著整根柱子生
          dust.push({ x, y: rr(0.6, capY * 0.92), z,
            vx: Math.cos(a) * rr(0.2, 1.2), vy: rr(0.8, 2.4), vz: Math.sin(a) * rr(0.2, 1.2),
            rx: Math.random() * 6, ry: Math.random() * 6,
            life: rr(6, 8.5), s: rr(1.7, 3.4), c: rr(0.34, 0.56), g: 1.4, fade: 4 });
      }
    }
    /* 傘蓋：0.45 秒時一次撐開，然後自己往上升。
       生在柱子上方、給比柱子快的初速，收尾就是「上面一團、下面一根」。 */
    if (t0 < 0.45 && c.t >= 0.45) {
      const H = R * 0.4;
      for (let k = 0; k < 112; k++) {
        if (dust.length >= 680) break;
        const a = Math.random() * Math.PI * 2;
        const rad = Math.sqrt(rr(0.03, 1)) * R * 0.5;
        dust.push({
          x: c.x + Math.cos(a) * rad, y: H + rr(-R * 0.06, R * 0.12), z: c.z + Math.sin(a) * rad,
          vx: Math.cos(a) * rr(0.4, 2), vy: rr(8, 10.5), vz: Math.sin(a) * rr(0.4, 2),
          rx: Math.random() * 6, ry: Math.random() * 6,
          life: rr(6.5, 9), s: rr(3.4, 6.2), c: rr(0.18, 0.42), g: 1.8, fade: 4.5
        });
      }
      for (let k = 0; k < 34; k++) {                 // 傘蓋裡的火光，燒一下就冷掉
        if (hot.length >= HOT_MAX) break;
        const a = Math.random() * Math.PI * 2;
        const rad = Math.sqrt(rr(0.02, 1)) * R * 0.34;
        hot.push({
          x: c.x + Math.cos(a) * rad, y: H + rr(0, R * 0.06), z: c.z + Math.sin(a) * rad,
          vx: Math.cos(a) * rr(0.3, 1.5), vy: rr(8, 10.5), vz: Math.sin(a) * rr(0.3, 1.5),
          rx: Math.random() * 6, ry: Math.random() * 6,
          s: rr(1.6, 3.2), life: rr(0.7, 1.5), g: 1.8, grow: 1.04, cool: rr(0.6, 1.1),
          cr: 1, cg: rr(0.68, 0.9), cb: rr(0.2, 0.45),
          to: [0.55, 0.14, 0.04]
        });
      }
      // 腰上那一圈：參考圖裡最好認的特徵
      fxRings.push({ x: c.x, z: c.z, y: R * 0.18, r: R * 0.2, vr: R * 0.4, vy: R * 0.12,
                     op: 0.9, fade: 1.4, c: 0xffd08a, add: 1, spin: rr(0, 6.28) });
    }
    /* 腳下的煙裙：參考圖裡蘑菇雲底部鋪開的那一圈翻滾濃煙。
       沒有它的話柱子是從一塊乾淨的草地長出來的，看起來像插在地上的柱子。

       橫向鋪開不能靠速度——塵霧每幀吃 0.94 的阻力，水平速度一秒內就沒了，
       一顆頂多滾 3 個單位，鋪不出半徑 30 那麼寬。所以「生成半徑隨時間往外擴」，
       速度只負責近處的翻滾感；重力給大一點，噴起來就會壓回地面貼著滾。 */
    if (c.t < SKIRT_T) {
      c.semit = (c.semit || 0) + dt * 62;
      while (c.semit >= 1) {
        c.semit--;
        /* 這裡的上限壓在 590，比柱子與傘蓋的 680 低：傘蓋是 0.45 秒一次要 112 顆的
           爆量，煙裙要是先把配額吃光，蘑菇就會變成一根沒有頭的柱子。
           兩個數字都比整朵雲自己要的（柱 128 + 傘 112 + 裙 105）高一截，是留給
           碎料的火苗煙——核彈會點著整棟，那些煙先搶走兩百多格，配額不夠寬的話
           煙裙就鋪不出來（量過：99 團 → 27 團，只剩柱子腳邊一小圈）。 */
        if (dust.length > 590) break;
        const a = Math.random() * Math.PI * 2;
        const k = Math.min(1, c.t / (SKIRT_T * 0.8));
        const rad = R * (0.12 + 0.36 * k) * rr(0.75, 1.15);
        dust.push({
          x: c.x + Math.cos(a) * rad, y: rr(0.3, R * 0.09), z: c.z + Math.sin(a) * rad,
          vx: Math.cos(a) * rr(1.2, 4), vy: rr(1, 3), vz: Math.sin(a) * rr(1.2, 4),
          rx: Math.random() * 6, ry: Math.random() * 6,
          life: rr(5, 7.5), s: rr(2.6, 5), c: rr(0.26, 0.46), g: 3.2, fade: 3.4
        });
      }
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
    /* 被捲進陣心的魔力粒子：每幀重新瞄準陣心，再加一股切線 → 路徑是螺旋不是直線。
       速度直接指定而不是加速度：這些要「快又準」，靠加速度追會被下面那道
       水平阻尼吃掉大半，飛到一半就停在半空了。所以整段也不吃重力與阻尼。 */
    if (d.suck) {
      const tx = d.suck[0] - d.x, ty = d.suck[1] - d.y, tz = d.suck[2] - d.z;
      const dd = Math.hypot(tx, ty, tz);
      if (dd < 1.5) { hot.splice(i, 1); continue; }   // 到了就熄，不要對穿過去再飛出另一邊
      const dh = Math.hypot(tx, tz) || 1;
      d.vx = (tx / dd - tz / dh * 0.55) * d.spd;
      d.vy = ty / dd * d.spd;
      d.vz = (tz / dd + tx / dh * 0.55) * d.spd;
      d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
      d.rx += dt * 5; d.ry += dt * 6.5;
      continue;
    }
    d.vy -= (d.g === undefined ? -1.5 : d.g) * dt;
    /* 被魔法陣吸的光點：往中心加速再加一股切線，走出螺旋。
       只給內吸的話會直直射進中心，看起來像雨點不像在聚集魔力。 */
    if (d.pull) {
      const px = d.pull[0] - d.x, pz = d.pull[1] - d.z;
      const pd = Math.hypot(px, pz) || 1;
      d.vx += (px / pd * 30 - pz / pd * 20) * dt;
      d.vz += (pz / pd * 30 + px / pd * 20) * dt;
      d.vy += 16 * dt;
    }
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

/* ── 十字星光 ─────────────────────────────────────────────
   魔法陣每長出一層就在那一圈上撒一把四角星，之後**整個施法期間一直撒**，
   每次隨機挑一層（機率一樣 → 平均分在每一層）。星芒是平面的、每幀正對鏡頭
   （公告板在引擎那邊做），所以不管軌道相機轉到哪，看到的都是那個十字。 */
const STAR_MAX = 48;
const STAR_PER = 7;              // 長出一層的那一下撒幾顆
/* 滿陣期間每秒撒幾顆。16 顆分給六層 ≈ 一層每秒不到 3 顆，加上每顆只亮 0.5–0.95 秒，
   場上同時約十來顆：夠讓整座陣一直在閃，又不會多到變成鋪在陣上的一層星星底紋。 */
const STAR_RATE = 16;
const stars = [];
function spawnStars(x, z, y, rad, n) {
  for (let i = 0; i < n; i++) {
    if (stars.length >= STAR_MAX) break;
    const a = Math.random() * Math.PI * 2;
    const r = rad * rr(0.45, 1.12);          // 有的落在圈內、有的甩到圈外一點
    /* 粉紫與金黃各半。全給暖色的話會跟紅陣糊在一起，粉的那幾顆才跳得出來。 */
    const pink = Math.random() < 0.55;
    stars.push({
      x: x + Math.cos(a) * r, y: y + rr(-1.8, 3.2), z: z + Math.sin(a) * r,
      s0: rr(1.8, 3.6), s: 0, rot: rr(0, 6.28), spin: rr(-1.3, 1.3),
      vy: rr(1.2, 3.4), t: 0, life: rr(0.5, 0.95), op: 0,
      cr: 1, cg: pink ? rr(0.45, 0.7) : rr(0.82, 0.95), cb: pink ? 1 : rr(0.42, 0.7)
    });
  }
}
function stepStars(dt) {
  for (let i = stars.length - 1; i >= 0; i--) {
    const s = stars[i];
    s.t += dt;
    if (s.t >= s.life) { stars.splice(i, 1); continue; }
    s.y += s.vy * dt;
    s.rot += s.spin * dt;
    /* 前兩成時間撐開到最亮最大，之後一路收掉。等速淡出的星星看起來像貼在那裡的圖，
       這樣才是「一閃」。大小也跟著走，但留 45% 的底——縮到 0 反而像被吸走。 */
    const k = s.t / s.life;
    s.op = k < 0.2 ? k / 0.2 : 1 - (k - 0.2) / 0.8;
    s.s = s.s0 * (0.45 + 0.55 * s.op);
  }
}

/* ── 爆裂魔法的餘電 ───────────────────────────────────────
   火球收乾之後，爆點還會往四周劈三秒的藍色閃電。
   稀疏是重點：一次一兩道、每道只亮 0.1 秒出頭，看起來才像放完電還在跳的殘餘電流，
   而不是一團持續發亮的電漿。純特效——不推積木、不燒東西、不嚇小人，
   破壞範圍還是 explode 那一下說了算。 */
const ARC_TIME = 3;              // 劈多久（使用者指定：三秒）
const ARC_SEG = 6;               // 一道電折幾段
const ARC_MAX = 6;               // 場上同時最多幾道
const ARC_JIT = 0.13;            // 折點抖多開（爆炸半徑的倍率）
let arcSrc = null;               // 正在放電的爆點（一次只有一處）
const bolts = [];
function startArcs(p, R) {
  /* 等火球亮完才開始：火球本身就是一大顆加法混色的白光，這幾道電劈在裡面
     一條都看不到，等於白劈。 */
  arcSrc = { x: p.x, y: p.y, z: p.z, R, t: -FLASH_LIFE, next: 0 };
}
/* 一道折線。兩端的抖動要收斂到 0（sin(πu) 中間最大），
   不然電會從爆點旁邊冒出來、也接不到它該打中的那一點。 */
function boltPts(x0, y0, z0, x1, y1, z1, jit, seg) {
  const pts = [];
  for (let i = 0; i <= seg; i++) {
    const u = i / seg, j = Math.sin(u * Math.PI) * jit;
    pts.push({ x: x0 + (x1 - x0) * u + rr(-j, j),
               y: y0 + (y1 - y0) * u + rr(-j, j) * 0.6,
               z: z0 + (z1 - z0) * u + rr(-j, j) });
  }
  return pts;
}
function spawnBolt(a) {
  /* 打向陣裡隨機一處、貼近地面的高度：爆點在半空，電是從那裡劈下來打在滿地的碎料上。
     全部水平掃出去的話會變成一圈圍著爆點的電網，那是另一種東西。 */
  const ang = Math.random() * Math.PI * 2, rad = rr(0.3, 1) * a.R;
  const pts = boltPts(a.x, a.y, a.z,
                      a.x + Math.cos(ang) * rad, rr(0.6, 5), a.z + Math.sin(ang) * rad,
                      a.R * ARC_JIT, ARC_SEG);
  const life = rr(0.1, 0.2);
  bolts.push({ pts, t: 0, life, op: 1, w: rr(0.16, 0.3) });
  // 三成機率從中段再岔出一條短的：分岔是閃電的招牌，但每道都岔就變成一張網
  if (Math.random() < 0.3 && bolts.length < ARC_MAX + 2) {
    const s = pts[3], b = Math.random() * Math.PI * 2, br = rr(0.15, 0.35) * a.R;
    bolts.push({
      pts: boltPts(s.x, s.y, s.z, s.x + Math.cos(b) * br, Math.max(0.6, s.y - rr(2, 8)),
                   s.z + Math.sin(b) * br, a.R * ARC_JIT * 0.6, 3),
      t: 0, life: life * 0.7, op: 1, w: rr(0.1, 0.18)
    });
  }
}
function stepArcs(dt) {
  if (arcSrc) {
    arcSrc.t += dt;
    if (arcSrc.t >= 0) {
      arcSrc.next -= dt;
      // 間隔一定要往前推，不能等「有空位」才推——排滿時會變成無窮迴圈
      while (arcSrc.next <= 0) {
        if (bolts.length < ARC_MAX) spawnBolt(arcSrc);
        arcSrc.next += rr(0.12, 0.3);
      }
    }
    if (arcSrc.t >= ARC_TIME) arcSrc = null;
  }
  for (let i = bolts.length - 1; i >= 0; i--) {
    const b = bolts[i];
    b.t += dt;
    if (b.t >= b.life) { bolts.splice(i, 1); continue; }
    /* 明滅而不是淡出：電是一閃一閃跳的，線性淡出看起來像有人在關調光器。
       只讓它一路暗到七成，剩下的交給「時間到就整道消失」。 */
    b.op = (1 - 0.3 * b.t / b.life) * rr(0.82, 1);
  }
}
/* 把每道折線攤成一段一段丟給引擎。重用同一個陣列，不要每幀配置一個新的 */
const boltSegs = [];
function boltList() {
  boltSegs.length = 0;
  for (const b of bolts)
    for (let i = 1; i < b.pts.length; i++) {
      const p = b.pts[i - 1], q = b.pts[i];
      boltSegs.push({ x1: p.x, y1: p.y, z1: p.z, x2: q.x, y2: q.y, z2: q.z, w: b.w, op: b.op });
    }
  return boltSegs;
}

/* 玩家在畫面上點一下的入口。tool 決定用哪個道具 */
function useTool(hit) {
  // 記在最前面：手指也算一種道具，成就要的是「每一種都試過」
  if (stats.tools.indexOf(tool) < 0) { stats.tools.push(tool); checkBadges(); }
  if (tool === 'finger') return 0;                 // 手指什麼都不破壞，只有戳小人有效
  const onGround = hit.kind === 'ground';
  if (tool === 'hammer') { launchHammer(hit.point, hit.dir, false, onGround); return 0; }
  if (tool === 'bighammer') { launchHammer(hit.point, hit.dir, true, onGround); return 0; }
  if (tool === 'ball') { aimBall(hit.point); return 0; }
  if (tool === 'treb') { placeTreb({ x: hit.point.x, z: hit.point.z }); return 0; }
  if (tool === 'tornado') { launchTornado({ x: hit.point.x, z: hit.point.z }); return 0; }
  if (tool === 'fw') { launchFw({ x: hit.point.x, z: hit.point.z }); return 0; }
  if (tool === 'fire') { torch(hit); return 0; }
  if (tool === 'bomb') { placeBomb(hit.point); return 0; }
  if (tool === 'meteor') { callMeteor(hit.point); return 0; }
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
/* n 是場上總共幾道：塵霧總量有上限（MAXDUST），一次好幾道全開火的話
   迴圈先跑到的那幾道會把配額吃光，排最後那道就變成沒有煙的空殼。 */
function spawnTwistDust(t, dt, n) {
  t.emit = (t.emit || 0) + dt * 78 / Math.sqrt(n || 1);
  while (t.emit >= 1) {
    t.emit--;
    if (dust.length > 380) break;
    const a = Math.random() * Math.PI * 2;
    const hy = rr(0.3, t.h * 0.85);
    // 跟著漏斗的錐度長（引擎那條公式的同一個形狀），不然煙會跟雲柱分家
    const f = hy / t.h;
    const rad = t.r * (0.2 + f * f * 1.2 + f * 0.55);
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
    d.vy -= (d.g === undefined ? 7 : d.g) * dt;
    /* 水平阻力。預設 0.94 是「爆起來一團、幾乎就地停住」的煙塵；
       風壓那道塵牆要一路掃出去，所以它自己帶一個比較鬆的 keep。 */
    const kp = d.keep === undefined ? 0.94 : d.keep;
    d.vx *= kp; d.vz *= kp;
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
  /* 拆到剩沒幾塊就當這座拆完了：剩下的自己垮掉，換下一座。
     不做這件事的話玩家得一塊一塊把最後的碎屑點掉，很煩。
     跌破門檻不馬上換，先等 SWAP_WAIT 秒讓最後那一發演完；這段時間還能繼續砸殘骸，
     所以結算（報廢的那些、拆除完畢的通知）留到真的要換場那一刻才做，
     不然等待中被打掉的積木會被算兩次錢。
     魔法陣還在充能時例外：它會先把建築扯下來捲進陣心，那個過程一定會跌破這條線——
     照換的話陣會被 startBuild 收掉，那一發永遠等不到爆炸，玩家只看到建築消失。
     （等待中途離開 wreck——按了「立刻建成」之類——就把秒數丟掉重算） */
  if (phase !== 'wreck') swapWait = 0;
  else if (!magic && bp && placedCnt <= Math.floor(bp.slots.length * WRECK_AT)) {
    swapWait += dt;
    if (swapWait >= SWAP_WAIT) {
      stats.destroyed++;
      // 剩下沒打到的那些跟著整棟報廢，也要計進損失
      const writeOff = placedCnt * WRECK_COST;
      stats.wrecked += writeOff; lossThis += writeOff;
      toast('💥 ' + bp.name + ' 拆除完畢',
            '損失 ' + money(lossThis) + '　·　累計拆掉 ' + stats.destroyed + ' 座');
      checkBadges(); save(); renderTools();
      startBuild(false);
    }
  }
  stepSwing(dt);
  stepQuake(dt);
  stepBall(dt);
  stepTwist(dt);
  stepTrebs(dt);
  stepBombs(dt);
  stepMeteors(dt);
  stepFw(dt);
  stepFire(dt);
  stepNuke(dt);
  stepMagic(dt);
  stepDanger(dt);
  stepClouds(dt);
  stepHot(dt);
  stepFlash(dt);
  stepFxRings(dt);
  stepStars(dt);
  stepArcs(dt);
  if (ballAim) ballAim.ph += dt;         // 瞄準環的脈動
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
  burningW = 0;
  for (const w of workers) if (w.burn > 0) burningW++;    // 火苗配額要照人數分
  pairChat();                                            // 湊對要在更新之前，配到的當幀就停下來
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
  /* 只把真的在天上飛的隕石丟過去（還在倒數的那幾顆連影子都不該有）。
     重用同一個陣列，不要每幀配置一個新的。 */
  metFly.length = 0;
  if (meteors) for (const m of meteors) if (m.lit) metFly.push(m);
  ENG.putMeteors(metFly);
  ENG.putTornados(twists || EMPTY);
  ENG.putFire(hot);
  ENG.putFlash(flashes);
  ENG.putStars(stars);
  ENG.putBolts(bolts.length ? boltList() : EMPTY);
  /* 魔法陣、爆炸光環、保齡球的瞄準環共用同一組環，在這裡合起來丟過去。
     魔法陣的那幾層每幀由 stepMagic 算好，爆炸那幾圈自己會擴散。
     沒東西在瞄／沒魔法陣時不做 concat：那是每幀都會跑到的路徑。 */
  let ringList = null;
  if (magic && magic.rings) ringList = fxRings.length ? magic.rings.concat(fxRings) : magic.rings;
  else if (fxRings.length) ringList = fxRings;
  if (ballAim) ringList = ringList ? ringList.concat(aimRings()) : aimRings();
  if (ringList) ENG.setRings(ringList);
  else ENG.hideRings();
  if (dozers) ENG.putDozers(dozRender(dozers));
}
const EMPTY = [];
const metFly = [];              // draw() 每幀重填：這一刻真的在天上的隕石

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
    if (!w || w.air) return;
    // 拿著火把戳人就是點他：站著被點著的會抱頭跑圈圈
    if (tool === 'fire' && igniteWorker(w, false)) { sndFire(); return; }
    if (w.fall <= 0 && w.burn <= 0) {
      w.fall = rr(1.2, 2.4); releaseWorker(w); sndFall();
      stats.poked++; checkBadges();
    }
    return;
  }
  // 這幾種點空地也算（本來就是「選一個地點」）；其他工具要點到建築
  if (hit.kind === 'block' || GROUND_TOOL[tool]) useTool(hit);
}

/* ── 鍵盤平移／旋轉鏡頭 ─────────────────────────────────────────
   用 e.code（實體鍵位）不是 e.key：非 QWERTY 的鍵盤排列也是同樣那幾顆鍵的位置。 */
const PAN_KEY = { KeyW: [1, 0], KeyS: [-1, 0], KeyA: [0, -1], KeyD: [0, 1] };
/* Q／E 轉視角。orbit 吃的是滑鼠的像素位移（yaw -= dx × 0.006），所以這裡給的是
   「每秒相當於拖曳幾像素」——220 換算過來是 1.3 rad/s。E 對應「往右拖」，跟滑鼠同手感。 */
const ORBIT_KEY = { KeyQ: -1, KeyE: 1 };
const ORBIT_RATE = 220;
const keyDown = Object.create(null);

function onKey(e) {
  if (!PAN_KEY[e.code] && !ORBIT_KEY[e.code]) return;
  /* 只擋下拉選單：字母鍵在 select 上是拿來跳選項的。
     面板的按鈕與核取方塊吃的是空白鍵／Enter，跟 WASD 不衝突，
     一起擋掉的話「剛按完設定就按不動鏡頭」反而莫名其妙。 */
  if (e.target && e.target.tagName === 'SELECT') return;
  keyDown[e.code] = e.type === 'keydown';
}
// 按著 W 切去別的視窗，keyup 收不到，切回來鏡頭會自己一直飄
function clearKeys() { for (const k in keyDown) keyDown[k] = false; }

/* 用真實時間推進，不吃時間倍率——開四倍速不該讓鏡頭也快四倍 */
function panStep(dt) {
  let r = 0;
  for (const k in ORBIT_KEY) if (keyDown[k]) r += ORBIT_KEY[k];
  if (r) ENG.orbit(r * ORBIT_RATE * dt, 0);
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
  // 已經蓋好或正在拆的時候沒什麼可以「立刻建成」，按鈕就灰掉
  $('finish').disabled = phase !== 'build' && phase !== 'clear';
}
/* ── 面板的三檔按鈕 ─────────────────────────────────────
   一組按鈕就是一個設定。數字只寫在 CNT_OPTS／WK_OPTS／SPD_OPTS 那三個陣列裡，
   按鈕照著生，所以 HTML 那邊不會有第二份數字跟程式對不起來。 */
function makeSeg(id, opts, fmt, pick) {
  const box = $(id);
  box.innerHTML = '';
  for (const v of opts) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.v = String(v);
    b.textContent = fmt(v);
    // audio()：第一次點任何東西才有資格開音訊（瀏覽器要求使用者手勢）
    b.addEventListener('click', () => { audio(); pick(v); });
    box.appendChild(b);
  }
}
/* 亮起目前這一檔。值不在清單裡就三顆都不亮——那代表有人繞過面板直接改變數（測試會這樣做） */
function syncSeg(id, v) {
  for (const b of $(id).children) b.classList.toggle('on', +b.dataset.v === v);
}
function syncHud() {
  $('bname').textContent = bp ? bp.name : '';
  $('bcount').textContent = bp ? bp.slots.length + ' 塊' : '';
  /* 亮起來的那一顆就是目前的值——面板上沒有另外一個數字標籤了。
     這裡不是只有點按鈕時才需要：測試與程式內部也會直接改 targetCnt／人數。 */
  syncSeg('cnt', targetCnt);
  syncSeg('wk', workerCnt);
  syncSeg('spd', timeScale);
}

/* 工具選單：沒解鎖的畫成鎖住並寫出解鎖條件。
   平常收在小窗裡（滑鼠指上去才展開），所以這裡順便把小窗更新成目前拿的那把。 */
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
      tool = t.id; ballAim = null; renderTools();   // 換道具就把瞄一半的出手點收掉
      $('toolbox').classList.remove('open');       // 選好就收起來，不要一直擋著畫面
      $('hint').textContent = t.tip + '　｜　拖曳／QE 轉視角　｜　WASD 平移　｜　滾輪縮放　｜　點小人會跌倒';
    });
    box.appendChild(b);
  }
  const cur = TOOLS.find(t => t.id === tool) || TOOLS[0];
  $('toolNow').innerHTML = '<span class="k">' + cur.k + '</span><span class="n">' + cur.n +
                           '</span><span class="c">▾</span>';
  $('toolNow').title = cur.tip;
  /* 這裡刻意不是 data-tool：選單裡的按鈕才是 data-tool，
     小窗也掛的話 querySelector('[data-tool=x]') 會先撈到小窗（它排在前面）。 */
  $('toolNow').dataset.cur = cur.id;
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
  /* 自訂藍圖排在最前面（緊接在「隨機」後面）：會自己丟檔案進 blueprints/ 的人
     就是想馬上看到成果，排在內建 48 座後面每次都得捲到底。
     只動顯示順序——option 的 value 一律還是 SHAPES 的索引，
     所以 shapePick、存檔記的編號、測試裡寫死的索引都不受影響。
     用兩次 filter 而不是 sort：不必依賴 sort 的穩定性，同一群內的原順序就是原順序。 */
  const ord = SHAPES.map((s, i) => i);
  sel.innerHTML = '<option value="-1">🎲 隨機</option>' +
    ord.filter(i => SHAPES[i].custom).concat(ord.filter(i => !SHAPES[i].custom))
       .map(i => '<option value="' + i + '">' + SHAPES[i].n + '</option>').join('');
  sel.addEventListener('change', () => { shapePick = +sel.value; startBuild(false); });

  /* 設定改動一律寫回 pref 並存檔——下次打開就不用重調。
     建材改了要重蓋（那是「下一座蓋多大」），小人與速度是當下就生效，不必打斷這一座。 */
  makeSeg('cnt', CNT_OPTS, v => v, v => { targetCnt = pref.cnt = v; save(); startBuild(false); });
  makeSeg('wk', WK_OPTS, v => v, v => { setWorkerCount(v); pref.wk = workerCnt; syncHud(); save(); });
  makeSeg('spd', SPD_OPTS, v => v + '×', v => { timeScale = pref.spd = v; syncHud(); save(); });
  $('again').addEventListener('click', () => { audio(); startBuild(false); });
  /* 立刻建成：不想等小人搬完時用。走的是開場那條 completeNow()，
     所以人力費一毛都不加（stats.spent 只在 step() 裡隨施工時間累積），
     按不出「百萬工程」那類花錢成就；蓋過哪些地標、幾塊的大工程照記。 */
  $('finish').addEventListener('click', () => {
    audio();
    if (phase !== 'build' && phase !== 'clear') return;
    completeNow();
    noteBuilt();
    sndDone();
    toast('⚡ ' + bp.name + ' 直接完工', '沒有算人力費');
  });
  $('spin').addEventListener('change', e => { spinOn = pref.spin = e.target.checked; save(); });
  $('mute').addEventListener('change', e => { muted = pref.mute = e.target.checked; save(); });
  $('panelBtn').addEventListener('click', () => $('panel').classList.toggle('hide'));
  /* 工具選單平常靠 :hover 展開。觸控沒有 hover，所以小窗自己也能點開；
     開著的時候點畫面上任何別的地方就收起來，不然它會一直擋著。 */
  $('toolNow').addEventListener('click', () => $('toolbox').classList.toggle('open'));
  document.addEventListener('pointerdown', e => {
    if (!$('toolbox').contains(e.target)) $('toolbox').classList.remove('open');
  });
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





