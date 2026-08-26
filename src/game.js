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
const VERSION = '1.115.0';

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
/* 小人「沒有工地要顧」的兩個階段。拆除中（wreck）純粹是換場的記帳狀態：
   拆到剩不到 WRECK_AT 就換下一座（見 step 尾巴）。v1.106 之前拆除中還會讓全場退場，
   使用者：「敲一下持續驚嚇不合理」——現在拆除中小人照樣過自己的生活。 */
const idlePhase = () => phase === 'done' || phase === 'wreck';
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
/* atk：起音要花幾秒爬到滿音量（省略＝0，跟以前一樣一開聲就是滿的）。
   從 0 直接跳到音量會有「喀」的一聲，短音特別明顯——放置音那種要敲幾百次的才需要。 */
function tone(freq, dur, type, vol, slide, key, atk) {
  const c = audio(); if (!c || muted) return;
  if (!voiceOK(key || (type || 'square') + Math.round(freq), c)) return;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type || 'square'; o.frequency.value = freq;
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), c.currentTime + dur);
  const v = vol || 0.06;
  // 指數斜坡碰不到 0，所以起訖都用 0.0008 當「無聲」
  if (atk) {
    g.gain.setValueAtTime(0.0008, c.currentTime);
    g.gain.exponentialRampToValueAtTime(v, c.currentTime + atk);
  } else g.gain.setValueAtTime(v, c.currentTime);
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
/* 放置音的音高隨進度往上爬——蓋到最後會有「快完成了」的爽感。
   v1.62.3 照使用者要求改成「低頻、悅耳」，三件事一起改（本來是 420→1040Hz 的方波，
   蓋一整棟就是幾百聲尖尖的「嗶」）：
   ① 音色 square → triangle。方波的奇次泛音是 1/n、三角是 1/n²，同一個音高柔得多。
   ② 音高整組往下降約一個八度：420～1040 → 196～587（G3～D5）。
   ③ 音高**吸到五聲音階上**，不再是連續的滑音。連續的頻率會落在半音與微分音上，
      一路蓋下來像走音的哨子；吸到五聲音階（C 大調，沒有半音）之後，
      不管前後跳到哪兩個音都是協和的，蓋房子就變成在敲一串木琴。
   ④ 給 8ms 的起音：從 0 直接跳到音量會有「喀」的一聲，這種要敲幾百次的短音最明顯。 */
const PLACE_SCALE = [196.00, 220.00, 261.63, 293.66, 329.63,
                     392.00, 440.00, 523.25, 587.33];
function sndPlace() {
  const p = bp ? placedCnt / bp.slots.length : 0;
  const i = clamp(Math.floor(p * PLACE_SCALE.length), 0, PLACE_SCALE.length - 1);
  tone(PLACE_SCALE[i], 0.14, 'triangle', 0.05, 0, 0, 0.008);
}
function sndSmash() { noise(0.42, 0.3, 1500); tone(78, 0.36, 'sawtooth', 0.1, 0.35); }
function sndDone() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.22, 'triangle', 0.07), i * 110)); }
/* 跌倒聲每次抽一個音高：一排人被同一發掀倒時，同音高的那幾聲會疊成「一聲比較大的」，
   抖開之後才聽得出是好幾個人各跌各的（音高抖開也順便讓它們不再完全同相）。 */
function sndFall() { tone(rr(170, 245), 0.16, 'square', 0.05, 0.5, 'fall'); }
function sndSwing() { tone(160, 0.3, 'sine', 0.06, 3.2); }
/* 龍捲風的風聲。v1.62.3 之前只在出場放**一聲** 1.6 秒的噪音，而它現在活 10 秒——
   使用者的說法是「好像沒有音效」，其實是響完之後有八秒多是靜的。
   改成整段一直重放（見 stepTwist 的 w.snd），並且加一支低頻的呼嘯：
   純噪音低通切在 480，小喇叭放出來很薄，配一支往下滑的鋸齒才聽得出是「一股風在轉」。 */
function sndWind() { noise(WIND_DUR, 0.17, 520); tone(82, WIND_DUR * 0.9, 'sawtooth', 0.035, 0.75); }
/* 點火：短促的「噗」一聲。只在點下去那一刻響，每塊都響會變成一片白噪音 */
function sndFire() { noise(0.55, 0.16, 1600); tone(150, 0.4, 'sawtooth', 0.05, 2.4); }
// 倒水：低通壓得比火低（水聲沒有火那種高頻的嘶），再墊一顆往下滑的低音當「灌下去」
function sndWater() { noise(0.6, 0.13, 620); tone(210, 0.45, 'sine', 0.04, 0.5); }
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
    /* 這塊是「某一間小人的家」的第幾格（v1.97，見 homes）。−1＝不是。
       家不進藍圖那套（slot 一律 −1），所以拆除、垮塌、計價那些看 slot 的地方
       本來就會跳過它；反過來，破壞道具只看 st === SET，所以照樣打得掉。 */
    hh: -1, hk: -1,
    scale: 1, snap: 0, snapFrom: null, arc: null, wob: 0, al: 1, fallIn: 0,
    gone: 0,                             // >0＝完工後多餘的碎料正在淡出（v1.109，見 clearSpare）
    burn: 0,                             // 1 = 正在燒（狀態本體在 fires 那筆裡）
    wet: 0                               // 還濕幾秒（>0 就點不著，顏色也壓深一點）
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
  /* 家的那一塊被打掉了（v1.97）：那一格重新算成「還沒蓋」。
     事件還在跑的話小人會自己補回去（h.left 加回來就是他們的工作清單）；
     已經回去上工的話就是一間破了個洞的房子。 */
  if (b.hh >= 0) {
    const h = homes && homes.list[b.hh], sl = h && h.slots[b.hk];
    /* 只有**已經砌上去**的那一格才把工作加回去。還在手上（CARRY）的那塊掉了，
       那一格從來沒被填過——加回去的話 h.left 會越算越多，那間永遠蓋不完。 */
    if (sl) {
      if (sl.filled) { h.left++; markHomeDirty(); }     // 少一塊：上面可能垮（v1.102）
      sl.filled = false; sl.claimed = -1;
    }
    b.hh = -1; b.hk = -1;
  }
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
  // 不用 indexOf 反查 blocks——一次砸掉幾百塊時那是 O(n²)。
  // 工作單只有幾筆，那一份 findIndex 是常數成本
  if (b.holder >= 0) {
    const w = workers[b.holder];
    if (w) {
      const k = w.load.findIndex(j => blocks[j.b] === b);
      if (k >= 0) dropJob(w, k);
    }
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
  stopIdleEvent();                   // 閒晃事件收掉，人叫回去上工（v1.97）
  /* 順序有講究：先把小人和舊建築解開（他們的 slot 指的是「舊」藍圖），
     再換 bp，最後才調整積木池——反過來做的話，
     reconcilePool 的 splice 會讓工作單（w.load）上的編號指到別塊積木上。 */
  /* 小人身上的火跟碎料的火一起收：積木待會要回收去蓋新的那座，
     人也一樣得回去上工，不能有人還在新工地旁邊打滾。 */
  for (const w of workers) {
    releaseWorker(w);
    w.air = 0; w.burn = 0; w.burnK = 0; w.lit = 0; w.roll = 0; w.fall = 0;
    w.wet = 0; w.wetK = 0;
    w.y = 0; w.tilt = 0; w.vx = w.vy = w.vz = 0;
  }
  for (const b of blocks) {
    // 家的那些不解（v1.97）：房子留在場上（使用者指定），只有被新工地蓋到才拆（見下面）
    if (b.hh >= 0) continue;
    if (b.st === SET || b.st === CARRY || b.st === TOSS) {
      b.slot = -1; b.holder = -1; b.arc = null; b.scale = 1; b.fallIn = 0;
      b.st = FLY; b.rest = false; b.snap = 0;
      b.tr = 0.80; b.tg = 0.76; b.tb = 0.68;
      b.wet = 0;                     // 上一座淋到的水不要跟著進新工地（人那邊同理，見上面）
      b.vx = rr(-5, 5); b.vy = rr(1, 6); b.vz = rr(-5, 5);
      b.ax = rr(-6, 6); b.ay = rr(-6, 6); b.az = rr(-6, 6);
    }
  }

  /* 正在作用的破壞道具**不收**（v1.59）。本來是換場時一次全部清掉，理由是
     「留著會砸到剛換上來的那一座」——但那一瞬間畫面上所有東西同時消失
     （還在滾的球、天上的龍捲風、倒數中的核彈、整棟的火），「換場感」就是這麼來的。
     現在它們照樣跑完自己的壽命，會不會波及新的那座是它們的事，本來就該是。

     只有兩樣還是要收，因為它們記的是「哪幾塊積木」，而那些積木待會就會被回收去
     蓋新的那座：地震點名的那份清單，還有推土機（它不是道具，是整地流程的一部分，
     下面的 startClear 會重派）。 */
  quake = null;
  dozers = null; ENG.putDozers([]);
  trucks = null;                     // 上一座的消防車也一起收（它跟整地一樣是流程的一部分）
  /* 水也收：積水記的是「哪一格」，藍圖一換那些格子就不存在了，
     留著會變成半空中的一攤水。火留得住是因為它記的是積木本身（見下面）。 */
  water = null;
  /* 火留著（v1.59）：一整棟在燒的建築忽然全暗，是換場感最重的一筆。
     燒著的積木這一刻全部被打散成碎料，會拖著火飛出去、落地燒成焦炭，很自然。
     唯一要擋的是「小人把還在燒的碎料撿去蓋新的那座」——那一步在 pick 那裡熄掉
     （見 douse），不然火會被砌進新建築裡。 */
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
  clearHomesInSite();                // 新工地蓋到誰家，那一間解成碎料（v1.97）
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
   機器時間，而且當時的時限（6.5 秒）只夠跑完一趟（中世紀城堡整段整地只派了三次工），
   碎料有 65～100% 是時間到了直接彈掉的，不是真的被推出去的。
   對穿就沒有這個問題：進了範圍鏟子就放下來，出範圍才抬起來。

   車速是固定的，而且比小人走路快不了多少——推土機本來就該是慢的。
   之前用「一趟固定跑幾秒」回推速度，大工地會飆到每秒 57 單位，看起來像在飛。 */
// 鏟子的寬度與位置直接取畫面那邊的值，判定跟看到的才會是同一把鏟子
const DOZ_W = ENG.DOZ_W, DOZ_FRONT = ENG.DOZ_FRONT;
/* 派幾台看工地多大：地面每這麼多平方單位派一台。時限固定，一台在時限內大概只推得動
   一條線那麼寬，所以工地一大就得靠台數補。固定三台的話大工地根本清不動
   （實測 siteR 44 的工地，固定三台推出去 0 塊，1391 塊全靠收尾彈掉）。
   上限 6 是畫面那邊 MAXDOZ 的容量。 */
const DOZ_AREA = 160;
const DOZ_MIN = 3, DOZ_MAX = 6;
const DOZ_MOVE = 9.5;               // 空鏟趕路的速度
const DOZ_PUSH = 6.5;               // 鏟子上有料時的速度
const DOZ_LOAD = 0.5;               // 鏟到料之後還維持慢速幾秒
const DOZ_TURN = 3.4;               // 轉向角速度（rad/s）
/* 從地圖邊緣進場（v1.61）：以前是「在工地邊上憑空出現、原地怠速 1.3 秒等碎料落地」，
   換場那一下三到六台機器同時冒出來。現在從碎料場外緣開進來，那段路本身就是等碎料
   落地的時間，不必再站著等。
   進場那一段不算進 DOZ_LIMIT——時限是給「推」的，不是給趕路的（見 stepDozers）。 */
const DOZ_FAR = 6;                  // 進場點在碎料場外緣（arenaR）再外面幾格
const DOZ_ENTER_MAX = 6;            // 進場最多算幾秒（保險絲，時限一定要開始跑）
/* 每台走自己的一條弦，橫向錯開這麼多（乘上工地半徑）。全部對著場中心開的話，
   幾台會在中間撞成一團、清的是同一個點，工地兩側反而沒人碰。 */
const DOZ_LANE = 0.55;
const DOZ_CELL = 5;                 // 找堆時的格子邊長
const DOZ_HEAP = 12;                // 一格少於這麼多塊就不算「堆」，不值得專程去推
/* 開始推之後最多推這麼久（進場那段路不算，見 stepDozers）。碎料鋪滿整片地時堆推不完，
   但這是換場的空檔，不是關卡——時間到就收工，剩下的彈掉。堆推完了本來就會提早收工，
   這只是上限。
   v1.61.1 從 6.5 拉到 10（使用者指定）：6.5 秒扣掉進場之後，一台大概只推得完一趟半，
   拉到 10 秒多的那一趟是實推。試過讓時限跟工地大小走則是另一回事，那個沒有採用
   （金門大橋那種會拉到 11.7 秒，只換到 7～10% 清除率）。 */
const DOZ_LIMIT = 10;
/* 鏟面後方多深之內都算同一堆，一起往前帶。抓得越深一次帶越多，但也得推得更遠
   才能整堆送出範圍外——不然機器停下時，那一疊的尾巴還留在工地裡。 */
const DOZ_PILE = 7;
/* 派工的距離折價：一坨的分數是「塊數 ÷ (1 + 距離×DOZ_TRIP)」。以前是「最大的那坨先派」，
   結果幾台會為了同一坨橫跨整個工地，路上鏟子還是抬著的——實測那趟空跑吃掉機器
   三成到七成七的時間。就近推小坨的產出反而比較高。
   用比值不用扣分：扣分要跟「塊數」同一個尺度，堆的大小一變就整個歪掉
   （試過每單位扣 2.2 塊，結果所有堆都被扣成負分，機器有一半時間在空轉）。 */
const DOZ_TRIP = 0.12;
/* 兩台的目標離這麼近就算「在清同一個點」，後挑的那台改挑別坨（v1.61）。
   一格是 DOZ_CELL=5，抓 1.6 格：隔壁格還可以，同一格與貼著的那幾格不行。 */
const DOZ_APART = DOZ_CELL * 1.6;
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
/* 進場：從地圖邊緣直線開進來，一路穿過工地再從另一邊出去（v1.61）。
   每台的方向不同（照台數等分一圈），而且各自的路線橫向錯開一段（DOZ_LANE），
   所以第一趟就分頭掃過工地的不同地帶，不會全部擠到中央那一坨。
   出發點、進場、穿過、出場全在同一條直線上——中間不用轉彎，
   鏟子自己會在進入工作範圍時放下、離開時抬起（見 stepDozers 的 work）。 */
function dozLane(ang, off) {
  const ux = -Math.cos(ang), uz = -Math.sin(ang);      // 往場中心開
  const px = -uz, pz = ux;                             // 這條弦的橫向
  const out = dozOutR();
  // 這條弦從進場到出場的另一端：|off·p + t·u| = 出場半徑 → t = √(out² − off²)
  const half = Math.sqrt(Math.max(1, out * out - off * off));
  const far = arenaR + DOZ_FAR;
  return {
    x: px * off - ux * far, z: pz * off - uz * far,     // 地圖邊緣的出發點
    a: Math.atan2(ux, uz),                             // rotation.y = a 讓車頭指向 (sin a, cos a)
    tx: px * off + ux * half, tz: pz * off + uz * half, // 直線穿到另一邊出去
    hx: px * off, hz: pz * off                          // 這條弦掃的是工地的哪一帶
  };
}
function startClear() {
  const n = clamp(Math.round(Math.PI * siteClearR() ** 2 / DOZ_AREA), DOZ_MIN, DOZ_MAX);
  const spin = Math.random() * Math.PI * 2;            // 整組進場方向每次隨機轉一下
  dozers = {
    t: 0, all: 0, on: false, done: false,
    list: Array.from({ length: n }, (_, k) => {
      const off = ((k + 0.5) / n - 0.5) * 2 * DOZ_LANE * siteClearR();
      /* 進場方向要**扣掉橫向錯開造成的偏角**（entry 的角度是 ang − asin(off/工作半徑)）：
         不扣的話，錯開得多的那幾條線入口會被推到隔壁那台旁邊，等於白錯開了。
         隨機只在自己那一格裡晃（±¼ 格），晃過頭一樣會把兩台湊到一起。 */
      const slot = Math.PI * 2 / n;
      const ang = spin + (k + rr(-0.25, 0.25)) * slot +
                  Math.asin(clamp(off / dozWorkR(), -1, 1));
      const p = dozLane(ang, off);
      return { x: p.x, z: p.z, a: p.a, st: 'push', tx: p.tx, tz: p.tz,
               bl: 1, load: 0, k, hx: p.hx, hz: p.hz };
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
   時限內連一趟都跑不完），整段下來送出工地的是 0 塊。邊上的小坨雖然只有十幾塊，
   但一趟二十幾單位跑得完，真的送得出去。 */
function pickHeap(m, heaps, tLeft) {
  let bi = -1, best = -1, bestP = null;
  for (let i = 0; i < heaps.length; i++) {
    const h = heaps[i];
    if (dozTaken(m, h)) continue;               // 別台已經在清那一帶了
    const p = dozPath(m, h);
    // 樂觀估：整趟都用空鏟的速度跑。連這樣都來不及的就是真的來不及
    const fit = p.len / DOZ_MOVE <= tLeft ? 1 : 0.05;
    const s = h.n / (1 + p.len * DOZ_TRIP) * fit;
    if (s > best) { best = s; bi = i; bestP = p; bestP.hx = h.x; bestP.hz = h.z; }
  }
  if (bi < 0) return null;
  heaps.splice(bi, 1);
  return bestP;
}
/* 這一坨是不是已經有別台在清了（v1.61）。heaps 每幀重算、幾台又不是同一幀改派，
   光靠「挑走就從清單移除」擋不住：A 這一幀挑了中央那坨，B 下一幀看到的是新的清單，
   照樣挑得到同一坨。所以直接比對「別台正在清的那一點」。 */
function dozTaken(m, h) {
  for (const o of dozers.list) {
    if (o === m || o.st !== 'push') continue;
    if ((o.hx - h.x) ** 2 + (o.hz - h.z) ** 2 < DOZ_APART * DOZ_APART) return true;
  }
  return false;
}
/* 還有碎料、但夠格的那幾坨都有人在清了：自己換一條線再穿一趟（v1.61）。
   停在原地等一樣是浪費時限，畫面上還像機器卡住了。
   路線是「從現在的位置對穿到另一邊」，橫向錯開一段——五個檔位裡挑離別台正在清的
   那一帶最遠的那一條，這樣兩台不會又走成同一條線。 */
const LANE_OPT = [-0.6, -0.3, 0, 0.3, 0.6];
function lanePass(m) {
  const d = Math.hypot(m.x, m.z) || 1;
  const ux = -m.x / d, uz = -m.z / d;                 // 對著場中心
  const px = -uz, pz = ux;
  const out = dozOutR();
  let best = null, bestGap = -1;
  for (const f of LANE_OPT) {
    const off = f * siteClearR();
    const hx = px * off, hz = pz * off;               // 這條弦掃過的是哪一帶
    let gap = Infinity;
    for (const o of dozers.list)
      if (o !== m && o.st === 'push') gap = Math.min(gap, Math.hypot(o.hx - hx, o.hz - hz));
    if (gap > bestGap) { bestGap = gap; best = { off, hx, hz }; }
  }
  const half = Math.sqrt(Math.max(1, out * out - best.off * best.off));
  m.tx = best.hx + ux * half; m.tz = best.hz + uz * half;
  m.hx = best.hx; m.hz = best.hz; m.st = 'push';
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
    m.st = 'leave';
    m.a = Math.atan2(m.x, m.z);      // 車頭轉朝外，不要再穿過工地
  }
  beginBuild();
}
/* 開一步。鏟子放不放下來、推不推料**只看位置**，不看在跑哪一段（v1.64.2）：
   進了工作範圍就放下來推，出了範圍才抬起來。速度看鏟子上有沒有料——空鏟就開快的，
   工地大半是空地，整趟都用推料的慢速跑等於把時限花在沒東西可推的地方
   （中世紀城堡實測有 2 秒多是這樣耗掉的）。
   怎麼開由呼叫端給：推的時候是 driveTo 追目標，離場是直線往外。 */
function dozeMove(m, dt, move) {
  const work = Math.hypot(m.x, m.z) < dozWorkR();
  m.bl += ((work ? 0 : 1) - m.bl) * Math.min(1, dt * (work ? 8 : 6));
  const px = m.x, pz = m.z;
  const at = move(work && m.load > 0 ? DOZ_PUSH : DOZ_MOVE);
  // 碎料跟著車子走同樣的位移
  const n = work ? pushWithBlade(m, m.x - px, m.z - pz) : 0;
  // 留一點餘裕再加速，不然碎料稀疏的地方會一路走走停停
  m.load = n > 0 ? DOZ_LOAD : Math.max(0, m.load - dt);
  return at;
}
function stepDozers(dt) {
  const D = dozers; if (!D) return;
  /* 時限只算「已經有人開進工作範圍」之後的時間（v1.61）：進場那段路是趕路，
     碎料也還在落地，把它算進去等於把推的時間吃掉。
     以前的做法是原地怠速 1.3 秒再開工，那 1.3 秒同樣不算在內。
     （試過讓機器先開到場中央待命，反而更差：中世紀城堡 58.5%→45.5%、
     大象 59.3%→46.5%，因為第一趟太短，等於少掃了一整條穿過工地的線。） */
  D.all += dt;
  if (!D.on && !D.done) {
    for (const m of D.list) if (Math.hypot(m.x, m.z) < dozWorkR()) { D.on = true; break; }
    // 保險絲：不管進沒進得去，超過這麼久一律開始計時，整地不能沒完沒了
    if (D.all > DOZ_ENTER_MAX) D.on = true;
  }
  if (D.on) D.t += dt;
  if (D.done) {
    /* 離場的路上照樣推（v1.64.2）：時限到了不代表鏟子當場該抬起來——
       車子還在工地裡就繼續推，開出工作範圍鏟子才自己升上去。
       收尾的 kickOut 只彈掉 siteClearR 以內的，外圈那一圈剛推出來的料還在路上。 */
    let alive = 0;
    for (const m of D.list) {
      dozeMove(m, dt, sp => { m.x += Math.sin(m.a) * sp * dt; m.z += Math.cos(m.a) * sp * dt; });
      if (Math.hypot(m.x, m.z) < arenaR + 14) alive++;
    }
    if (!alive) { dozers = null; ENG.putDozers([]); }
    return;
  }
  const heaps = listHeaps();
  let idle = 0;
  for (const m of D.list) {
    if (m.st === 'push') {
      if (dozeMove(m, dt, sp => driveTo(m, dt, sp))) m.st = 'seek';
    }
    if (m.st === 'seek') {
      // 出了工地還有很多碎料就轉個彎再直線推一趟，挑的是別台沒在清的那一坨
      const p = pickHeap(m, heaps, DOZ_LIMIT - D.t);
      if (p) { m.tx = p.tx; m.tz = p.tz; m.hx = p.hx; m.hz = p.hz; m.st = 'push'; }
      else if (heaps.length) lanePass(m);      // 還有碎料，只是都被別台認走了
      else idle++;
    }
  }
  // 全部都找不到值得推的堆了，或是拖太久，就收工——不為了零星幾塊讓玩家乾等
  if (idle >= D.list.length || D.t > DOZ_LIMIT) finishClear();
}

/* 直接把整座蓋好。開場用——一進來就有一座完整的建築可以砸，
   不用先盯著小人搬十分鐘才有東西玩。設定面板的「立刻建成」也走這裡。 */
function completeNow() {
  /* 房子的積木要跳過（v1.109）：那些不是這一座的料。以前是照編號硬取
     blocks[0..格數)，編號更後面的一律壓成散料——場上有村落的時候按下「立刻建成」，
     整村的積木就全變成地上的碎料（實測 6 間 876 塊全躺平），而 homes.list 還記著
     「這幾間都蓋好了、一格都不缺」，於是村子憑空消失、也沒有人會去補。
     跳過之後那些房子原封不動，散料也只剩真正多出來的那些（接著就淡出，見 clearSpare）。 */
  let i = 0;
  for (let k = 0; k < bp.slots.length; k++) {
    while (i < blocks.length && blocks[i].hh >= 0) i++;
    if (i >= blocks.length) break;
    const s = bp.slots[k], b = blocks[i++];
    if (b.cell) gridDel(b);
    b.st = SET; b.slot = k; b.x = s.x; b.y = s.y + HB; b.z = s.z;
    b.rx = b.ry = b.rz = 0; b.scale = 1; b.al = 1; b.holder = -1; b.snap = 0; b.fallIn = 0;
    b.vx = b.vy = b.vz = b.ax = b.ay = b.az = 0;
    const pal = bp.pal[s.c % bp.pal.length];
    b.r = b.tr = ((pal >> 16) & 255) / 255;
    b.g = b.tg = ((pal >> 8) & 255) / 255;
    b.b = b.tb = (pal & 255) / 255;
    s.filled = true; s.claimed = -1;
  }
  for (; i < blocks.length; i++) {                           // 多的積木壓成靜止的散料
    const b = blocks[i];
    if (b.hh >= 0) continue;                                 // 房子的不是多的（見上面）
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
  clearSpare();                          // 用不到的碎料淡出（v1.109，同 stepToss 那條）
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
  /* 家的那些積木不算在料池裡（v1.97）：它們是從地上挖出來的，不是這一座的建材。
     算進去的話，池子看起來「太多了」，補料那一段會反過來把地上的碎料收掉——
     等於小人蓋了幾間房子，下一座就少了那麼多建材。 */
  let own = 0;
  for (const b of blocks) if (b.hh < 0) own++;
  const need = Math.min(ENG.MAXB - (blocks.length - own), bp.slots.length);
  const add = need - own;
  if (add > 0) {
    const r0 = siteR + 2.5;
    for (let i = 0; i < add; i++) {
      const b = newBlock();
      const a = Math.random() * Math.PI * 2;
      // 半徑取平方根分布，密度才會均勻（直接均勻取半徑會全擠在內圈）
      let rad = Math.sqrt(r0 * r0 + Math.random() * (arenaR * arenaR - r0 * r0));
      b.x = Math.cos(a) * rad; b.z = Math.sin(a) * rad;
      /* 別鋪到人家屋子裡（v1.97）：小人不撿屋子裡的料（見 findBlock），
         鋪進去就等於這幾塊永遠沒人搬。 */
      for (let t = 0; t < 6 && homeAt(b.x, b.z); t++) {
        const a2 = Math.random() * Math.PI * 2;
        rad = Math.sqrt(r0 * r0 + Math.random() * (arenaR * arenaR - r0 * r0));
        b.x = Math.cos(a2) * rad; b.z = Math.sin(a2) * rad;
      }
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

/* 把一批積木整個從池子裡拿掉（v1.109）。跟 reconcilePool 的收法差在**時機**：
   那一支只在換場時跑，那時候每個人都 releaseWorker 過、沒有任何地方還記著積木編號；
   這一支是遊戲進行中跑的，所以「記著編號」的那幾個地方要一起重編——
   跟 dropHomes 重編 b.hh 是同一件事。哪幾個地方：
     w.load[].b（認走的建材）· w.fly[].b（魔法師還在飛的）· w.gb／w.gbi（要去撿的那一塊）
     · quake.list（地震點名的那份清單）
   收掉的一定是沒人要的自由碎料（見 clearSpare），所以前三者指到的不會被收，
   只是要換算新編號；w.gb／w.gbi 有可能指到被收掉的，換成 −1（下一幀自己會重挑）。 */
function dropBlocks(kill) {
  const map = new Array(blocks.length), list = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (kill(b)) { map[i] = -1; if (b.cell) gridDel(b); continue; }
    map[i] = list.length; list.push(b);
  }
  const gone = blocks.length - list.length;
  if (!gone) return 0;
  blocks = list;
  const to = i => (i >= 0 && i < map.length ? map[i] : -1);
  for (const w of workers) {
    for (const j of w.load) j.b = to(j.b);
    for (const f of w.fly) f.b = to(f.b);
    w.gb = to(w.gb); w.gbi = to(w.gbi);
  }
  if (quake) for (let i = 0; i < quake.list.length; i++) quake.list[i] = to(quake.list[i]);
  homeOwnAt = -1;                      // 那份「格子 → 積木編號」的快取這一幀作廢了
  ENG.setBlockCount(blocks.length);
  return gone;
}
/* ── 完工之後把多餘的碎料收掉（v1.109）─────────────────
   使用者：「地標建築完工後 可以讓多餘的碎料消失」。
   完工那一刻還躺在地上的自由碎料，這一座已經用不到了（料池本來就是照藍圖格數配的）。
   多出來的幾乎都是小人的家帶進來的：家的積木是從地上**挖出來的新塊**，
   那一間被打爛廢棄、或被下一座工地徵收之後就解成碎料留在場上，一輪一輪越積越多。
   以前要等下一次 startBuild 的 reconcilePool 才收得掉，中間整片草地都是瓦礫。

   收法是淡出，不是瞬間消失：離場中心越遠的越晚開始，看過去是一圈往外掃的波。
   標記的當下就把 rest 清掉——每一條找料的路（findBlock／freeNearHome／listMageHeaps
   ／mageBlock）都要求 rest，所以淡出中的不會被誰撿走。 */
const SPARE_FADE = 0.5;             // 一塊淡出幾秒
const SPARE_WAVE = 0.012;           // 每遠一格晚開始幾秒（0.012 × 40 格 ≈ 半秒的波）
function clearSpare() {
  let n = 0;
  for (const b of blocks) {
    if (b.st !== FREE || !b.rest || b.holder >= 0 || b.hh >= 0 || b.gone) continue;
    b.gone = SPARE_FADE + Math.hypot(b.x, b.z) * SPARE_WAVE;
    b.rest = false;
    n++;
  }
  return n;
}

/* ── 小人 ───────────────────────────────────────────────── */
/* 一趟搬幾塊（v1.60）。以前一個人一次只搬一塊：走過去、撿起來、走回工地、丟上去，
   四段路只換到一塊積木，遠看是一群人在跑空車。現在一次領好幾塊，
   撿滿了才回工地，回程一路把手上的貨丟完。
   幾塊看**個子**：高的搬得多。但不照身高線性換算——那樣 1／2／3 塊各佔三分之一，
   像刻意分成三組。以 2 塊為中心抽常態亂數，身高只把中心往上／往下推半塊，
   於是多數人搬 2 塊，1 塊跟 3 塊都是少數。 */
const CARRY_MIN = 1, CARRY_MAX = 3;
const CARRY_MID = 2;                // 常態分布的中心（塊）
const CARRY_SD = 0.55;              // 標準差（塊）
const CARRY_SIZE = 0.5;             // 身高最多把中心推幾塊
const W_LO = 1.59, W_HI = 1.86;     // 身高的抽樣範圍
/* 標準常態亂數（Box–Muller）。均勻亂數做不出「中間多、兩端少」那個形狀。 */
function gauss() {
  const u = Math.random() || 1e-9;
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(Math.random() * Math.PI * 2);
}
function carryCap(scale) {
  const mid = (W_LO + W_HI) / 2;
  const size = (scale - mid) / ((W_HI - W_LO) / 2);         // 身高換算成 −1 ~ +1
  return clamp(Math.round(CARRY_MID + size * CARRY_SIZE + gauss() * CARRY_SD),
               CARRY_MIN, CARRY_MAX);
}
function newWorker(i) {
  const a = Math.random() * Math.PI * 2, d = siteR + rr(3, 9);
  /* 每個人身高略有差異。v1.51 整體再放大 1.5 倍（1.06–1.24 → 1.59–1.86）：
     模型從腳底到帽頂是 1.31，乘上去大約是 2.1–2.4 格，也就是兩塊多積木高。
     之前那一版遠鏡頭下只剩一撮色點，數不出幾個人、也看不出誰頭上頂著積木。 */
  const scale = rr(W_LO, W_HI);
  return {
    x: Math.cos(a) * d, y: 0, z: Math.sin(a) * d, a: 0, ph: Math.random() * 6, gait: 0,
    tone: i, st: 'idle', tx: 0, tz: 0,
    /* 這一趟的工作單：load 是 {b 積木, s 藍圖格子} 一對一對排好的，
       cap 是一趟最多領幾對，li 是撿到第幾對（回程時一律從第 0 對開始丟）。 */
    load: [], cap: carryCap(scale), li: 0,
    wait: 0, fall: 0, tilt: 0, carry: false, cheer: 0, pause: 0, leg: 0,
    /* 上工的路：clear 是「直線走得通」，chk 是還有多久要重算一次（見 buildWalk） */
    chk: 0, clear: 0,
    /* 被工具波及時才用得到：air 是正在飛，vx/vy/vz 是彈道，spin 是翻滾角速度，
       lit 是「落地要著火」的記號，burn 是還要燒幾秒，burnK 是身上焦黑的深淺。 */
    air: 0, vx: 0, vy: 0, vz: 0, spin: 0, lit: 0, burn: 0, burnK: 0,
    // 被消防車噴到：wet 是還濕幾秒（這期間點不著），wetK 是身上顏色要乘的倍率
    wet: 0, wetK: 0,
    roll: 0, rspin: 0, rph: 0,
    bem: 0, bx: 0, bz: 0, br: 0, ba: 0,
    /* 工程師（eng）：拿藍圖 plan、站的角度 eang、下一個動作倒數 et、指揮動作剩幾秒 point。
       聊天：剩幾秒 chat、對象編號 cw、輪到誰講 side、講完多久才會再聊 chatCd、
       泡泡大小 bub、正在講話 talk。hail 是慶祝時的舉手，crun 是進場那一趟的腳程（見 CHEER_IN），
       cout 是散場錯開多久（見 CHEER_OUT），cft 是下一束彩帶還有幾秒（見 CONF_GAP）。 */
    eng: 0, plan: 0, eang: 0, et: 0, point: 0, hail: 0, spot: 0, crun: 0, cout: 0, cft: 0,
    chat: 0, cw: -1, side: 0, chatCd: 0, bub: 0, talk: 0,
    /* 魔法師（mage，v1.64）：不搬積木，站在建材堆旁邊隔空把建材拋上去。
       cast 是舉杖的深淺 0～1（畫杖與寶珠用），ct 是這一發還要蓄幾秒，
       mang／mrad 是他要站的地方（極座標：角度與半徑；v1.89 起會跟著料堆跑），
       mre 是還有多久重挑一坨料，
       fly 是已經送出去、還在半空的那幾塊（連發，所以是一份清單），
       trail 是下一顆星還有多久。 */
    mage: 0, cast: 0, mang: 0, mrad: 0, mre: 0, ct: 0, fly: [], trail: 0,
    /* 肌肉小人（mus，v1.112）：撿料跟一般工人一樣走過去撿，撿起來就地掄起來扔
       （見 updWorker 的 hurl）。掄的倒數借魔法師那個 ct——沒有人同時是兩種。 */
    mus: 0,
    /* 蓋自己的家（v1.97 的閒晃事件，見 homes）：hm 是哪一間（−1＝沒在蓋），
       hst 是這一趟在做什麼（dig／lay），hcap 是這一趟要挖幾塊，
       hdt 是還要挖幾秒（砌的時候是下一塊還有幾秒），hp 是下一撮土花幾秒。
       認走的是哪一格記在積木身上（b.hk），不記在人身上——一趟不只一塊。 */
    hm: -1, hst: '', hcap: 0, hdt: 0, hp: 0, gb: -1,   // gb＝這一趟要去撿的那一塊（v1.104）
    /* 抽到的身高（v1.113）。scale 是「實際畫多大」，肌肉小人要在它上面再乘 MUS_SIZE，
       所以抽到的那個值要另外留一份：直接乘 scale 的話，setWorkerCount 每叫一次
       tagMuscle 就再乘一次，人數調個幾輪他會長成一棟樓。 */
    sc0: scale,
    /* 卡住脫困（v1.108）：sx/sz 是「上一次真的前進到的位置」（錨點），
       stk 是「腿在擺卻沒離開那個錨點」累積幾秒，ghost 是還要穿透幾秒（見 stuckWatch）。
       伸手拿（v1.108）：gbi 是正在走去撿的那一塊，gbd 是離它最近到過多少，
       gbt 是「沒有再更近」幾秒了（見 nearGrab）。 */
    sx: 0, sz: 0, stk: 0, ghost: 0, gbi: -1, gbd: 0, gbt: 0,
    /* 自己那間家的編號（v1.109）。−1＝還沒有家。這個**跨輪留著**（w.hm 每輪會被
       stopHomes 清掉），下一次事件才知道誰已經有家、不必再蓋一間。
       記 id 不記索引：索引會被 dropHomes 重編。 */
    own: -1,
    /* 逃命：flee 是還要逃幾秒，fdel 是還愣著沒起步幾秒，fex/fez 是爆心，
       frem 是還要跑多遠，fdir 是起跑時定好的逃跑方向。 */
    flee: 0, fdel: 0, fex: 0, fez: 0, frem: 0, fdir: 0,
    scale: scale
  };
}
function setWorkerCount(n) {
  n = clamp(Math.round(n), 1, ENG.MAXW);
  while (workers.length < n) workers.push(newWorker(workers.length));
  while (workers.length > n) { releaseWorker(workers[workers.length - 1]); workers.pop(); }
  workerCnt = n;
  tagEngineer();
  tagMage();
  tagMuscle();
  if (idlePhase()) assignSpots();           // 慶祝中加減人：圈要重新等分
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
/* 十個人裡有一個是魔法師（v1.64）。跟工程師一樣**照編號固定挑**、不隨機抽：
   隨機的話人數一動整組人就換一輪身分，剛才那個戴巫師帽的下一秒又變回工人。
   排在 5 號起算是為了跟 0 號的工程師錯開——沒有人是既看圖又施法的。 */
const MAGE_EVERY = 10, MAGE_AT = 5;
function tagMage() {
  for (let i = 0; i < workers.length; i++) {
    const w = workers[i];
    const mage = i % MAGE_EVERY === MAGE_AT ? 1 : 0;
    if (mage && !w.mage) {
      releaseWorker(w);                  // 手上還有貨就先放掉，魔法師不搬東西
      w.mang = Math.atan2(w.z, w.x);     // 從他現在站的位置接手，不用先繞半圈
      w.mrad = Math.max(siteR + MAGE_KEEP, Math.hypot(w.x, w.z));
      w.mre = 0;                         // 下一幀就挑一坨料站過去
      w.ct = 0;
    }
    if (!mage && w.mage) { releaseWorker(w); w.ct = 0; }
    w.mage = mage;
  }
}
/* 十個人裡有一個是肌肉小人（v1.112）。跟工程師、魔法師同一套：照編號固定挑。
   排在 8 號起算是為了跟 0 號的工程師、5 號的魔法師錯開——沒有人是兩種身分。
   身分其實不會中途換人（編號固定，而 workers 只從尾端增減），下面那一條是保險：
   停在 hurl 上的人如果變回一般工人，他會拿著那塊站在料堆那裡等一個不會來的出手。 */
const MUS_EVERY = 10, MUS_AT = 8;
/* 整個人再放大 8%（v1.113，使用者：「肌肉小人應該會長比較大隻一點點」）。
   身高從 1.59–1.86 變成 1.72–2.01（帽頂 2.25–2.63 格，一般工人是 2.08–2.44）。
   只放大這一成：肩寬本來就已經是別人的 1.38 倍（見引擎那五塊），再往上加會變巨人。
   乘的是 sc0（抽到的身高）不是 scale，理由見 newWorker。 */
const MUS_SIZE = 1.08;
function tagMuscle() {
  for (let i = 0; i < workers.length; i++) {
    const w = workers[i];
    const mus = i % MUS_EVERY === MUS_AT ? 1 : 0;
    if (!mus && w.mus && w.st === 'hurl') releaseWorker(w);
    w.mus = mus;
    w.scale = w.sc0 * (mus ? MUS_SIZE : 1);
  }
}
/* 放掉一個認領的格子。放掉也會改變支撐狀態，而且派工游標要退回去補這個洞 */
function freeClaim(s) {
  if (s < 0 || !bp || !bp.slots[s]) return;
  bp.slots[s].claimed = -1;
  slotCursor = Math.min(slotCursor, s);
  markSupportDirty(0.05);
}
function releaseWorker(w) {
  for (const j of w.load) {
    const b = blocks[j.b];
    // 先把 holder 清掉再 freeBlock：不然它會回頭再抽一次這個人的工作單
    if (b && b.st === CARRY) { b.holder = -1; freeBlock(b); b.vy = 2; }
    else if (b) b.holder = -1;
    freeClaim(j.s);
  }
  homeUnclaim(w);                    // 家的那一格也要放掉（v1.97）
  w.load.length = 0; w.li = 0; w.carry = false; w.st = 'idle';
  /* 魔法師還在半空的那幾塊也從清單上劃掉。積木本身不管（它自己會落定），
     但編號要清掉——換藍圖時整池積木會重編，留著會指到別人的積木上。 */
  w.fly.length = 0;
  endChat(w);
}
/* 工作單裡的某一塊出事了（被打飛、被搶走、藍圖換掉）：只抽掉那一筆，其餘照搬。
   一塊出事就整趟作廢的話，搬三塊的人被抽掉一塊就得回頭重領一次。 */
function dropJob(w, k) {
  const j = w.load[k];
  if (j) {
    const b = blocks[j.b];
    if (b && b.st !== CARRY) b.holder = -1;   // 還在手上的不動（那是 releaseWorker 的事）
    freeClaim(j.s);
    w.load.splice(k, 1);
    if (w.li > k) w.li--;
  }
  if (w.li > w.load.length) w.li = w.load.length;
  if (!w.load.length) { w.carry = false; w.li = 0; w.st = 'idle'; }
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
  if (w.burn > 0 || w.wet > 0) return false;      // 剛被消防車噴過的點不著
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
  /* 被炸飛剛好落在人家屋子裡：推出來（v1.104）。落地之後接著是躺平那幾秒
     （w.fall，那條路徑完全不動），不推的話他就躺在人家的牆裡等時間跑完。 */
  pushOutHome(w);
  // 落地這一刻才判定燒不燒：被爆炸掃到的（lit）一定燒，摔進火堆裡的也會被引燃
  const lit = w.lit || nearFire(w);
  w.lit = 0;
  // igniteWorker 會擋掉濕的人，擋掉之後要走「沒著火」這條，不然他會躺著不動
  if (!lit || !igniteWorker(w, true)) { w.tilt = 0; w.fall = rr(0.8, 1.7); }
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
    const cx0 = w.x, cz0 = w.z;
    pushOutHome(w);                                     // 圈圈跑到人家屋子裡就推出來
    /* 推出來的位移也要加到**圈心**上（v1.104）：這裡的位置跟 ringWalk 一樣是每幀
       重算的，只推人不推圈心的話下一幀又照原本的圈心算回房子裡，等於推一輩子。
       加到圈心上，圈子會自己幾幀內滑出房子外面。 */
    w.bx += w.x - cx0; w.bz += w.z - cz0;
    w.a = Math.atan2(-Math.sin(w.ba), Math.cos(w.ba));  // 面向切線＝繞著跑
    w.ph += dt * 22;                                    // 腳步比平常快一倍
    w.gait = 1;
    w.tilt += (0 - w.tilt) * Math.min(1, dt * 8);
  }
}

/* ── 派格子 ───────────────────────────────────────────────
   v1.65 之前是「照藍圖順序往下派」，誰來領都給游標那一格。藍圖的排序是
   先照高度、同高再照離中心遠近（blueprints.js 的 slots.sort），
   所以同一層同一圈的格子在**角度上是亂的**——工人撿完腳邊的料，被指派的格子
   平均在四分之一圈外（實測建材與格子的方位角差：中位數 81°、平均 89°、
   最差的一成幾乎在正對面），只能沿著建築外圈繞過去。
   繞外圈本身沒錯（不繞就穿牆，而且目標貼在牆上時弧線就是最短路），
   問題是他被叫去對面：實測整趟 8.7 秒裡有 3 秒在繞，全部走路距離的 39% 是弧。

   現在改成：從游標往後看 SLOT_NEAR 個「蓋得起來」的格子，派其中離人最近的那個。
   不改成「所有格子裡最近的」是要留住藍圖順序——那個順序決定建築一層一層長上來的
   樣子。實測兩者差不多（同樣 200 秒 2367 vs 2401 塊），但全掃描每一步多 0.08ms，
   視窗版量不出成本。 */
const SLOT_NEAR = 24;               // 一次從幾個候選裡挑
function findSlot(wx, wz) {
  const S = bp.slots;
  while (slotCursor < S.length && (S[slotCursor].filled || S[slotCursor].claimed >= 0)) slotCursor++;
  /* 只派「現在真的蓋得起來」的格子。游標之後找不到才從頭掃一次——
     中途被打掉的洞會落在游標後面，尤其地基被敲掉時要能回頭補。 */
  const near = (from, to) => {
    let best = -1, bd = Infinity, seen = 0;
    for (let i = from; i < to; i++) {
      if (S[i].filled || S[i].claimed >= 0 || !canPlace(i)) continue;
      const d = (S[i].x - wx) ** 2 + (S[i].z - wz) ** 2;
      if (d < bd) { bd = d; best = i; }
      if (++seen >= SLOT_NEAR) break;
    }
    return best;
  };
  const i = near(slotCursor, S.length);
  return i >= 0 ? i : near(0, slotCursor);
}
/* 挑「離我最近」的那一塊建材。試過改成「我走過去 ＋ 搬到定位」加起來最短，
   想省掉繞路的成本，結果兩邊都更差：那個判準會挑到躺在建築腳邊的料，
   人為了撿它反而走進工地裡（實測台北 101 的「站在牆裡」從 0.35% 跳到 5.98%，
   同樣時間蓋的塊數也少了一成）。 */
/* 走去撿這一塊要站在哪（v1.107）。躺在房子占地上的（那塊地走不進去）就站到外框
   最近的那一面外面伸手拿——跟小人撿自己家的碎料同一套（grabStand）。
   回傳的可能是那個共用暫存物件，取完 x/z 就別留著。 */
function pickSpot(b) {
  const h = footHome(b.x, b.z);
  return h ? grabStand(h, b.x, b.z) : b;
}
/* ── 搆不到就伸手拿 ─────────────────────────────────────
   使用者：「撿不到的積木都能到最近能到的距離直接撿起來」。
   走去撿的路上每幀記「離那塊料最近到過多少」；一直沒有再更近，就是走不過去了——
   站位剛好被另一間房子壓住、料卡在兩間房子的外框夾縫裡、目標落在藍圖的牆裡都會這樣。
   這時候只要還在 GRAB_FAR 以內就直接撿起來，不要卡在那條路上。

   判準用「有沒有更近」而不是「站著不動」：走不過去的人多半還在繞（貼著外框滑過去、
   繞外圈），位置一直在變，但離那塊料永遠差那麼一段。
   換一塊料就重新開始算（gbi 記的是正在追哪一塊），不然上一塊的計時會被算進這一塊。 */
const GRAB_WAIT = 1.5;              // 沒有再更近超過這麼久，就當作搆不到了
const GRAB_FAR = 7;                 // 最遠伸手拿多遠。再遠就繼續走，不要隔半個場撿東西
const GRAB_GAIN = 0.1;              // 近了這麼多才算「有進展」（浮點抖動不算）
function nearGrab(w, bi, dt) {
  const b = blocks[bi];
  if (!b) return false;
  if (w.gbi !== bi) { w.gbi = bi; w.gbd = Infinity; w.gbt = 0; }
  const d = Math.hypot(b.x - w.x, b.z - w.z);
  if (d < w.gbd - GRAB_GAIN) { w.gbd = d; w.gbt = 0; return false; }
  w.gbt += dt;
  return w.gbt >= GRAB_WAIT && d <= GRAB_FAR;
}
/* 這個位置是不是被蓋好的部分圍住了（v1.113）：腳下就是牆，或者兩側各有一道牆
   （躺在實心建築中間那個空柱子裡的料就是這樣——它自己的柱子是空的，但四周都填起來了）。
   兩層以上才算牆：一層跨得過去。 */
function walledIn(x, z) {
  if (footBlocked(x, z)) return true;
  return (colTop(x + 1, z) >= 2 && colTop(x - 1, z) >= 2) ||
         (colTop(x, z + 1) >= 2 && colTop(x, z - 1) >= 2);
}
/* outside（v1.113）：優先挑「沒被蓋好的部分圍住」的料，肌肉小人專用。
   他是就地扔的，站的地方就是出手點——挑到躺在實心建築裡的那些，他就得走進去撿，
   然後手上那塊被埋住、只能退回去走回工地（實測吉薩金字塔有 17% 的時間在走那條）。
   一律跳過**不行**：料被蓋進去之後就沒人撿得出來了，那是 v1.97～v1.106 踩過的坑
   （見下面那段註解）。所以是「外面還有就挑外面的，只剩裡面的照撿」。 */
function findBlock(wx, wz, maxD, outside) {
  let best = -1, bd = maxD ? maxD * maxD : Infinity;   // 給了 maxD 就只找那麼遠以內的
  let out = -1, od = bd;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.st !== FREE || !b.rest || b.holder >= 0) continue;
    const d = (b.x - wx) ** 2 + (b.z - wz) ** 2;
    /* 躺在房子占地上的照撿（v1.107）：站到外框旁邊伸手拿（見 pickSpot），
       跟小人撿自己家的碎料同一套。
       v1.97～v1.106 是一律跳過的，理由是「走過去會被推出屋外、永遠抵達不了，
       那個人就卡在 pick 上」——那是真的，但代價是那些料**永遠回收不了**：
       實測換一座地標之後，場上 730 塊自由碎料裡有 338 塊埋在房子的外框裡
       （使用者：「小房子內的積木也撿不出來」），一半的料撿不到，
       於是一堆人領不到工作就在房子旁邊閒晃——看起來就是「卡住」。 */
    if (d < bd) { bd = d; best = i; }
    // 牆裡那些只在「還有別的可挑」時才讓過（擺在距離判斷後面，不必每塊都查）
    if (outside && d < od && !walledIn(b.x, b.z)) { od = d; out = i; }
  }
  return outside && out >= 0 ? out : best;
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
/* 最多退到離格子幾格，超過就照舊走進去。v1.60 從 10 拉到 13：拋得遠一點，
   就有更多「內部的格子」退得出牆外，不必走進去擺。 */
const TOSS_MAX = 13;
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
  /* 抵達也要推一次（v1.97）：推只掛在「有移動」那條路徑上的話，
     一個站在屋子裡不動的人永遠不會被推出來。 */
  if (d < REACH) { pushOutHome(w); w.gait += (0 - w.gait) * Math.min(1, dt * 8); return true; }
  /* 直線走也要繞開房子（v1.102）。這條路是上工（buildWalk 判斷「直線通得過」時）
     與拆除／整地退場在用的，而 pathClear 只認得藍圖的格子表——房子不在裡面，
     所以他會直直走進去、被 pushOutHome 推回來，貼著牆磨。 */
  const g = dodgeHome(w, dx / d, dz / d);
  const sp = WALK * dt;
  w.x += g.x * Math.min(sp, d); w.z += g.z * Math.min(sp, d);
  pushOutHome(w);
  w.a = Math.atan2(g.x, g.z);                       // 面向真正在走的方向
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
/* 從現在的位置直直走到目標，腳邊會不會撞到已經蓋好的部分。
   小人的家也算（v1.103）：不算的話這條路被判成「通的」，人就直直走進人家的牆，
   全靠 dodgeHome 每幀反應式地掰方向；算進來的話 buildWalk 會直接改走繞外圈那條。 */
function pathClear(w) {
  if (w.ghost > 0) return true;                    // 穿透中：什麼都擋不住他（見 stuckWatch）
  const dx = w.tx - w.x, dz = w.tz - w.z;
  const n = Math.ceil(Math.hypot(dx, dz) / 0.7);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const px = w.x + dx * t, pz = w.z + dz * t;
    if (footBlocked(px, pz) || homeFoot(px, pz)) return false;
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
    const ex = w.x + dx / d * PATH_EYE, ez = w.z + dz / d * PATH_EYE;
    if (d > REACH && (footBlocked(ex, ez) || homeFoot(ex, ez))) w.chk = 0;
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
  /* 要進去：先繞到那條半徑的外圈，對準了就直直走進去。
     v1.104 起「對準了」就夠，不再要求先回到圈上（原本是 pr > outer + 0.5 才繞）。
     對準之後那條路**就是同一條半徑線**，從 32 格外走進來跟從圈上走進來是同一條路
     （standPos 保證的是「從那個站位往外到外圈沒有積木」），差別只在 walkTo 會閃房子、
     ringWalk 的徑向不會。舊的寫法在「房子擋在他跟圈之間」時會一直想擠回圈上、
     每幀被推回來（實測 5163 → 968 人-幀，換這一條之後 0）。 */
  if (!aligned) {
    ringWalk(w, Math.atan2(w.tz, w.tx), outer, dt);
    return false;
  }
  return walkTo(w, dt);
}

/* ── 卡住了就脫困 ───────────────────────────────────────
   使用者：「評估增加機制　小人走路狀態卻位置一樣　重新尋找路線或是能直接穿過所有障礙」。
   這是**最後一道保險**，不是主要的繞路機制——繞路是 dodgeHome／ringWalk／pathClear 那一套，
   這裡處理的是「那一套也解不開」的殘局：兩間房子的外框疊在一起把人夾在中間、
   目標點被別的房子壓住、四面外框圍出一個走不出去的口袋。

   判準是**腿在擺（gait > 0.6）卻沒前進**，而且「沒前進」是拿**一段時間**比的，
   不是拿一幀比：實測卡住的人多半不是站著不動，而是在兩點之間來回——每一幀都走滿
   一步（0.34），位置卻在 0.32 × 0.27 的框裡跳了幾百幀（目標點壓在人家的外框裡，
   走過去就被推回來）。用「這一幀走了多少」判的話，那個人永遠不算卡住。
   反過來，站著聊天、發呆、等下一塊、慶祝時站定都是合法的不動，腿沒在擺就不算。
   （v1.107 追這件事時，第一版用「位置沒動超過 N 秒」，
   結果卡最久的那個人其實是在聊天。）

   兩段式，先便宜的再貴的：
     ① 撐過 STUCK_T 秒 → 重新找路線（w.chk = 0，讓 buildWalk 下一幀重判直線通不通，
        通常會從「直線」改成「繞外圈」）
     ② 再撐 STUCK_T 秒還是沒動 → 穿透 GHOST_T 秒：這幾秒房子不擋他、也不推他出來
        （pushOutHome／blockHome／pathClear／ringWalk 都認這個旗標）。
   為什麼不一開始就穿透：穿牆很醒目，多數卡住重找一次路線就解了；
   為什麼一定要有穿透這一段：使用者已經指定過「真的修不好的話，小房子就不要擋住小人了，
   讓他直接穿越」（v1.105），而重找路線對「四面被圍住」那種殘局沒有用。 */
const STUCK_R = 1.2;                // 這麼久之內還沒離開錨點這麼遠，就算沒前進
const STUCK_T = 1.5;                // 每一段各撐多久（腳程 6.8，正常走 1.5 秒是 10 格）
const GHOST_T = 3;                  // 穿透幾秒。要夠他走穿一間房子（最寬的約 10 格）
function stuckWatch(w, dt) {
  if (w.ghost > 0) {                                // 穿透中：計時凍住，結束才重新量
    w.ghost -= dt;
    if (w.ghost <= 0) w.ghost = 0;
    w.sx = w.x; w.sz = w.z; w.stk = 0;
    return;
  }
  /* 腿沒在擺就不算（站著聊天、發呆、等下一塊都是合法的不動）；
     被炸飛與著火那兩條走的是自己的軌跡（彈道、打滾繞圈），不歸這裡管。 */
  if (w.gait <= 0.6 || w.air || w.burn > 0) { w.sx = w.x; w.sz = w.z; w.stk = 0; return; }
  if ((w.x - w.sx) ** 2 + (w.z - w.sz) ** 2 > STUCK_R * STUCK_R) {
    w.sx = w.x; w.sz = w.z; w.stk = 0; return;      // 真的前進了：錨點跟上去
  }
  w.stk += dt;
  if (w.stk < STUCK_T) return;
  if (w.stk < STUCK_T * 2) {                        // ① 重新找路線
    w.chk = 0;                                      // 直線／繞外圈重判一次
    /* 目標點本身壓在人家的外框裡（閒晃的目標被推到外圈、剛好推進屋子裡就會這樣）：
       挪到外框最近的那一面外邊。走得到的目標才有得走。 */
    const h = footHome(w.tx, w.tz);
    if (h) { const g = grabStand(h, w.tx, w.tz); w.tx = g.x; w.tz = g.z; }
    return;
  }
  w.ghost = GHOST_T; w.chk = 0;                     // ② 穿透
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
/* 預告一出現，**全場**都逃（v1.96，使用者指定「不用每幀掃，全場都逃命就可以了」）。
   v1.59～v1.95 是「只喊範圍內的人」＋每幀重掃一次預告範圍——後者是必要的補丁，
   因為工地就在爆心上，下令時站在圈外的人照樣會往裡面走（去撿料、去放積木），
   走到一半被炸飛看起來像完全沒在反應。全場都逃就不需要那個補丁了：
   誰都不會「還沒被喊到」，預告範圍也不必留著給下一幀掃，一起拿掉。
   跑不跑得掉照舊完全交給位置決定（腳程只有 1.2 倍，見 FLEE_SPD）——
   遠處的人本來就跑得掉，喊他一起跑只是讓整場一起動起來。 */
function alertFlee(point, t) {
  for (const w of workers) {
    if (w.air || w.burn > 0) continue;              // 在飛／在燒的動不了，不用喊
    startFlee(w, { x: point.x, z: point.z, t });
  }
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
  /* 起跑時定好的那條直線；路上有房子就繞過去（v1.102）——逃命不看路的話，
     他會頂著人家的牆原地跑。fdir 本身不改，繞過去之後自己會接回原本的方向。 */
  const g = dodgeHome(w, Math.sin(w.fdir), Math.cos(w.fdir));
  const ux = g.x, uz = g.z;
  const lim = arenaR + 20;
  w.x = clamp(w.x + ux * WALK * FLEE_SPD * dt, -lim, lim);
  w.z = clamp(w.z + uz * WALK * FLEE_SPD * dt, -lim, lim);
  pushOutHome(w);
  w.a = Math.atan2(ux, uz);
  w.ph += dt * 11 * FLEE_STEP;                      // 腳步加倍
  w.gait += (1 - w.gait) * Math.min(1, dt * 10);
}

/* 沿著建築外圈繞過去，不走直線——直線會從蓋好的建築正中央穿過去。
   角度與半徑一起收，兩個都到位才算抵達。 */
/* 一幀只能走 WALK×dt 這麼遠，「轉角度」跟「收半徑」要分同一份腳程（v1.60）。
   舊版是兩邊各自吃滿 WALK×dt，於是繞路的人會用飄的：
     · 光是同時收半徑又轉角度，斜邊就有 1.41 倍
     · 角度那一份還是拿**目標**半徑換算的，站得比那個圈遠的人弧速直接爆掉——
       實測站在半徑 20 要繞半徑 8 的圈，最快衝到 2.69 倍腳程
   修法：把「還差多少」看成一個向量（弧長 dA×當下半徑、徑向 dr），照比例縮到這一步
   走得完的長度。兩邊同時收、合起來剛好是 WALK（實測全程 1.00 倍），而且同時到位。
   不改成「半徑先走完再轉角度」是因為那樣繞遠路：慶祝進場實測會慢一秒。
   「從建築裡走出來」那條路不受影響——它傳進來的目標角度就是人自己現在的角度
   （dA = 0），整份腳程本來就全給徑向。 */
/* spd 給了就用那個腳程（單位／秒），沒給就照平常走。慶祝進場會給——
   遠的人要跑（見 CHEER_IN）。 */
/* 繞外圈的路上有房子：往外鼓出去繞過它（v1.104）。
   圈子的**內側是地標**，所以只能往外閃——往內閃會走進建築裡。
   為什麼一定要在這裡算，光靠 pushOutHome 不行：ringWalk 每一幀是用極座標
   **重算**位置的（w.x = cos(na) × nr），推出來的位移下一幀就被丟掉，於是人頂著房子
   外框每幀被推一次、位移永遠是 0——實測換一座大的地標之後，離工地中心 16.4 的那一間
   （走路的圈在 16.3）讓小人磨掉 **5163 幀**，全部貼在外框上（離框 0.02）。
   鼓多遠是**算出來的**：從場中心朝那個方向的射線離開那個外框的距離，再加一點餘裕。
   一步一步試的話，長條屋徑向擺的時候要試十幾次。 */
const RING_OUT = 0.6;               // 鼓出去之後離外框留多少餘裕
const RING_LOOK = 2.5;              // 往前看幾格（弧長）再決定這一步要鼓多外
function ringClear(a, r) {
  const cx = Math.cos(a), cz = Math.sin(a);
  for (let n = 0; n < 4; n++) {                       // 最多連著閃過四間
    const h = footHome(cx * r, cz * r);
    if (!h) return r;
    const tx = cx > 0 ? h.x1 / cx : cx < 0 ? h.x0 / cx : Infinity;
    const tz = cz > 0 ? h.z1 / cz : cz < 0 ? h.z0 / cz : Infinity;
    const out = Math.min(tx, tz);
    if (!(out > r)) return r;                         // 算不出來就別鼓（保險）
    r = out + RING_OUT;
  }
  return r;
}
/* 這一步的目標半徑：現在的角度、以及**往前看一段**的角度，兩個要的半徑取大的。
   一定要往前看，不能等踩到了才往外挪——把算好的位置事後往外推是一次好幾格的傳送，
   下一幀又被「半徑差」拉回來，等於原地震盪（實測 200 幀裡有 116 幀在原地）。
   看的距離要大於一幀的步幅（0.34），不然還沒鼓到位就已經進去了。 */
function ringGoal(ca, dA, rad, cr) {
  const lookA = RING_LOOK / Math.max(1, cr);
  const look = dA >= 0 ? Math.min(dA, lookA) : Math.max(dA, -lookA);
  return Math.max(ringClear(ca, rad), ringClear(ca + look, rad));
}
/* 這一步實際能走到哪個半徑。想走到的那一點被房子占著時分兩種，順序很重要：
   ① 房子在**我內側**（從外圈往工地走，房子擋在中間）→ 半徑不動，只沿著圈滑過去，
      繞過那一間的角度範圍再往內收。往外鼓沒用（房子不在我這個半徑上），
      照原樣往內收則是每幀被推回來（實測 600 人-幀貼在外框上磨）。
   ② 連**現在的半徑**都被占著（房子壓在圈上）→ 往外鼓，一步最多一個步幅。
   回傳值不等於 want 的時候呼叫端要把步幅整個重新分給角度——原本的 k 是「弧長 + 徑向」
   一起算的，從 32 走到 16 的時候 k 只有 0.02，把徑向那份丟掉就等於原地不動。 */
function ringHold(na, cr, want, budget) {
  if (!footHome(Math.cos(na) * want, Math.sin(na) * want)) return want;
  if (!footHome(Math.cos(na) * cr, Math.sin(na) * cr)) return cr;
  return Math.min(ringClear(na, cr), cr + budget);
}
function ringWalk(w, ta, rad, dt, spd) {
  const cr = Math.hypot(w.x, w.z);
  const ca = cr < 0.001 ? ta : Math.atan2(w.z, w.x);
  const TAU = Math.PI * 2;
  // 取最短那一邊繞。ta 可能是累加出來的（工程師換位置一次加一點），先折回 ±π
  const dA = ((((ta - ca) % TAU) + TAU + Math.PI) % TAU) - Math.PI;
  const sp = spd || WALK;
  const budget = sp * dt;
  /* 這一步的目標半徑：現在的角度、以及**往前看一段**的角度，兩個要的半徑取大的。
     一定要往前看，不能等踩到了才往外挪——把算好的位置事後往外推是一次好幾格的傳送，
     下一幀又被「半徑差」拉回來，等於原地震盪（實測 200 幀裡有 116 幀在原地）。
     看的距離要大於一幀的步幅（0.34），不然還沒鼓到位就已經進去了。 */
  const gh = w.ghost > 0;                             // 穿透中：不鼓、不擠、不推（見 stuckWatch）
  const rad2 = gh ? rad : ringGoal(ca, dA, rad, cr);
  const dr = rad2 - cr;
  const left = Math.hypot(dA * cr, dr);               // 還差多遠（弧長 + 徑向）
  const arrive = left <= budget;
  const k = arrive ? 1 : budget / left;
  let na = ca + dA * k;
  const want = cr + dr * k;
  const px = w.x, pz = w.z;
  /* 想走到的那一點被房子占著怎麼辦。分兩種，順序很重要：
     ① 房子在**我內側**（從外圈往工地走，房子擋在中間）→ 這一步半徑不動，只沿著圈
        滑過去，繞過那一間的角度範圍再往內收。往外鼓沒用（房子不在我這個半徑上），
        照原樣往內收則是每幀被推回來（實測 600 人-幀貼在外框上磨）。
        **步幅要整個重新分給角度**：原本的 k 是「弧長 + 徑向」一起算的，
        從 32 走到 16 的時候 k 只有 0.02，把徑向那份丟掉就等於原地不動（實測 968 幀）。
     ② 連**現在的半徑**都被占著（房子壓在圈上）→ 往外鼓，一步最多一個步幅。 */
  let nr = gh ? want : ringHold(na, cr, want, budget);
  if (nr !== want) {
    const arc = Math.abs(dA) * cr;
    na = ca + dA * (arc <= budget ? 1 : budget / arc);
    nr = ringHold(na, cr, want, budget);              // 角度變了，再問一次
  }
  w.x = Math.cos(na) * nr; w.z = Math.sin(na) * nr;
  pushOutHome(w);                                     // 保險（房子剛好在這一幀長出來）
  const mx = w.x - px, mz = w.z - pz;
  if (Math.hypot(mx, mz) > 1e-4) {
    w.a = Math.atan2(mx, mz);
    w.ph += dt * 11 * sp / WALK;                      // 跑起來腳步也要快（同 FLEE_STEP 的道理）
    w.gait += (0.85 - w.gait) * Math.min(1, dt * 8);
  } else {
    // 沒在動就把腿收掉（v1.104）。不收的話站定之後腿還在原地擺——就是使用者說的那個樣子
    w.gait += (0 - w.gait) * Math.min(1, dt * 8);
  }
  /* 「到位」是照 rad2（鼓出去之後的目標半徑）算的。另外，目標那一點被房子占著時
     （nr 沒能走到 want），角度到了就算到位——不然他會一直想擠進去。
     慶祝入圈、工程師走位、魔法師站位都靠這個回傳值。 */
  return arrive || (Math.abs(dA) * cr <= budget && nr !== want);
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
/* 幾秒內要就位。離得遠的人自己加速——v1.95 起魔法師會跟著料走到碎料場外緣，
   實測蓋完那一刻四個人都站在半徑 63，用平常的腳程要走六秒半，慶祝總共只有七秒
   （趕到就散場，四個人整段都在路上）。腳程在 assignSpots 那裡照距離算一次就固定：
   每幀用「剩下的距離 ÷ 秒數」重算會越走越慢，永遠差最後一點。 */
const CHEER_IN = 2.5;
/* 散場時間每個人各抽 0～這麼多秒的延遲（v1.96）。w.cheer 是每個人各自從 0 累加的，
   完工那一刻全員歸零，所以七秒是**同一幀**到期：實測 20 個人第一次動起來全落在
   散場後第 5 幀，一圈人整齊往外走（使用者回報）。抽個延遲就散得開了。
   為什麼不是把 CHEER_T 本身改成隨機：那個是慶祝長度，跳幾下、什麼時候可以聊天
   都掛在它上面；這裡要動的只有「什麼時候起腳走人」。 */
const CHEER_OUT = 1.6;
/* 這個人還在慶祝嗎。三個地方要用同一個判準（跳與不跳、聊天冷卻、可不可以聊），
   拿 CHEER_T 直接比的話，先散場的那幾個會被當成「還在慶祝」不准聊。 */
const cheerOn = w => w.cheer < CHEER_T + w.cout;
function cheerR() {
  return Math.max(siteR + 2.6, workers.length * CHEER_GAP / (Math.PI * 2));
}

/* ── 彩帶（v1.96）─────────────────────────────────────────
   圍成一圈跳的時候一束一束往上噴。紙片是塵霧那個池子畫的（instanced cube 給非等比
   的縮放就是一張薄紙片），所以 0 個新 draw call；代價是共用同一份材質，
   透明度跟煙塵一樣是 0.62——紙片會偏淡，像淡彩色的紙屑，不是不透明的緞帶。
   往上噴、稍微往建築那邊斜：往外噴的話紙片全落在圈外，圈裡反而是空的。
   落地那一下由 stepDust 接手（y 到 0.1 就停住），所以草地上會留一層紙屑到淡出為止。 */
const CONF_GAP = 1.4;               // 一個人每隔幾秒噴一束
const CONF_N = 11;                  // 一束幾片
/* 塵霧池總共 720 顆，留這麼多給彩帶。慶祝時本來沒別的東西在噴煙，
   但玩家隨時可以在慶祝中丟一發核彈——那朵蘑菇雲要有位子站。 */
const CONF_MAX = 380;
const CONF_LIFE = [2.1, 3.3];
const CONF_G = 3.4;                 // 落得比煙塵慢（預設 7），紙才會飄
/* 水平阻力比煙塵（0.94）鬆很多：0.94 那個是「爆起來一團、就地停住」的煙，
   套在紙片上的話横向只飛得動 0.7 格（實測整束紙片都落在圈上±1 格內），
   看起來是直上直下不是噴出去。 */
const CONF_KEEP = 0.982;
const CONF_L = 0.34, CONF_W = 0.17, CONF_TH = 0.035;   // 一片紙的長、寬、厚
const CONF_COL = [[1, 0.36, 0.48], [1, 0.82, 0.25], [0.31, 0.76, 0.97],
                  [0.48, 0.85, 0.56], [1, 1, 1], [0.78, 0.57, 0.92]];
function spawnConfetti(w) {
  const inx = -w.x, inz = -w.z;                        // 往建築的方向
  const d = Math.hypot(inx, inz) || 1;
  const ux = inx / d, uz = inz / d;
  for (let i = 0; i < CONF_N; i++) {
    if (dust.length > CONF_MAX) break;
    const c = CONF_COL[Math.floor(Math.random() * CONF_COL.length)];
    const a = Math.random() * Math.PI * 2, sp = rr(1.2, 4.2);
    dust.push({
      // 從舉起來的手那個高度噴（模型連手臂大約 1.5 格高，再乘上這個人的身高）
      x: w.x + rr(-0.2, 0.2), y: w.y + 1.5 * w.scale, z: w.z + rr(-0.2, 0.2),
      vx: Math.cos(a) * sp + ux * rr(1, 3),
      vy: rr(3.6, 5.8),
      vz: Math.sin(a) * sp + uz * rr(1, 3),
      rx: Math.random() * 6, ry: Math.random() * 6,
      life: rr(CONF_LIFE[0], CONF_LIFE[1]),
      s: CONF_L, sy: CONF_TH, sz: CONF_W,
      g: CONF_G, keep: CONF_KEEP,
      cr: c[0], cg: c[1], cb: c[2]
    });
  }
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
  const R = cheerR();
  for (let k = 0; k < n; k++) {
    const w = workers[ord[k]];
    w.spot = base + k * gap;
    /* 這一趟要用多快才 CHEER_IN 秒內進得了圈。距離用 ringWalk 的同一份算法
       （弧長 + 徑向），不然遠的人會算短、還是趕不到。 */
    const cr = Math.hypot(w.x, w.z);
    const ca = cr < 0.001 ? w.spot : Math.atan2(w.z, w.x);
    const dA = ((((w.spot - ca) % TAU) + TAU + Math.PI) % TAU) - Math.PI;
    w.crun = Math.max(WALK, Math.hypot(dA * cr, R - cr) / CHEER_IN);
    w.cout = rr(0, CHEER_OUT);       // 散場錯開多久（見 CHEER_OUT）
    /* 彩帶的節拍要錯開，不然一圈人同一幀噴（第一束是「站定那一刻」，
       而近的人幾乎同時站定）。第一束隨機提前一點，之後每 CONF_GAP 秒一束。 */
    w.cft = rr(0, CONF_GAP * 0.8);
  }
}

function updWorker(w, wi, dt) {
  /* 姿勢旗標每幀重算：跌倒、被炸飛、跑去躲的那幾條路徑都是 return 出去的，
     不歸零的話工程師被戳倒了還躺在地上舉著圖。 */
  w.hail = 0; w.plan = 0;
  stuckWatch(w, dt);                 // 卡住了就脫困（v1.108）。擺在最前面：下面每一條分支都會 return
  /* 舉杖同理，只是它是漸進的（瞬間切 0/1 的話杖會用瞬移的抬起放下）：
     這裡每幀往下收，只有真的在施法那條路徑會用兩倍速把它撐回去（castPose）。
     被炸飛、跌倒、換場都是 return 出去的，不預設收的話那個人躺在地上還舉著杖。 */
  if (w.cast > 0) w.cast = Math.max(0, w.cast - dt * CAST_DOWN);
  if (w.chatCd > 0) w.chatCd -= dt;
  /* 被吹飛／點著／推倒／要逃命，或是換場要清工地了——聊天一律中斷。
     蓋完的那一刻也中斷：慶祝要全員到齊，不然聊到一半的那兩個會晚五秒才入圈。 */
  if (w.chat > 0 && (w.air || w.burn > 0 || w.fall > 0 || w.flee > 0 ||
      (phase !== 'build' && !idlePhase()) || (idlePhase() && cheerOn(w))))
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
  /* 濕度（v1.68）。wetK 是引擎那邊要乘的倍率，所以「沒濕」是 0 而不是 1——
     0 讓引擎整段跳過，不必為了每個人都乘一次 1。乾了才歸零，中間都在漸變。 */
  if (w.wet > 0) {
    w.wet = Math.max(0, w.wet - dt);
    if (!w.wetK) w.wetK = 1;                        // 剛淋到：從原色開始往深的走
    w.wetK += (WET_DARK - w.wetK) * Math.min(1, dt * 6);
  } else if (w.wetK) {
    w.wetK += (1 - w.wetK) * Math.min(1, dt * 4);
    if (w.wetK > 0.99) w.wetK = 0;                  // 乾了歸零，引擎那邊整段跳過
  }
  if (w.air) { flyWorker(w, dt); return; }            // 被吹飛／炸飛：走彈道
  if (w.burn > 0) { burnMove(w, dt); return; }        // 燒起來：打滾或跑圈圈

  if (w.fall > 0) {                                   // 被震倒／被戳倒
    /* 躺平就是躺平（v1.60）：以前只倒到 0.44π（79°），停在一個「快躺平又還撐著」的
       角度。現在倒滿 90°，而且是**往後仰躺**（負角）——往前趴的話帽舌、鼻尖那幾塊
       會插進草地裡，仰躺貼地的是背面，那是整個模型最平的一面。
       躺平之後身體會落在草皮那一層，所以 engine 會照傾角把人抬起半個身厚。 */
    w.fall -= dt;
    w.tilt += (-Math.PI * 0.5 - w.tilt) * Math.min(1, dt * 9);
    w.gait += (0 - w.gait) * Math.min(1, dt * 6);
    if (w.fall <= 0) w.st = 'idle';
    return;
  }
  w.tilt += (0 - w.tilt) * Math.min(1, dt * 7);

  /* 逃命優先於一切還站得起來的行為：施工、閒晃、慶祝、監工都先擱著。
     擺在跌倒／著火之後——那兩種本來就動不了，逃不掉才合理。 */
  if (w.flee > 0) { stepFlee(w, dt); w.y += (0 - w.y) * Math.min(1, dt * 6); return; }

  if (w.chat > 0) { stepChat(w, wi, dt); return; }

  if (phase === 'clear') {
    /* 整地中退到旁邊等——推土機還在推，這時候進場只會被鏟到。
       **拆除中（wreck）v1.106 起不再退場**：使用者「敲一下持續驚嚇不合理」。
       敲完工的建築一下就會把 phase 推進 wreck，而這條分支會讓全場二十個人立刻
       往外跑、而且一直待在外圈不做事——實測敲一下之後 60 秒裡 24000/24000 人-幀
       都停在這裡，平均半徑從 23.7 被推到 28.1，沒有人回去做自己的事。
       現在拆除中照 `done` 那條走（閒晃、蓋自己的家、慶祝），玩家在拆、小人過自己的生活。
       「不會偷偷把它修回去」還是成立——那條是 build 的狀態機，這裡走不到。 */
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

  if (idlePhase()) {                                  // 蓋完了，圍成一圈慶祝
    const was = w.cheer;
    w.cheer += dt;
    if (cheerOn(w)) {
      /* 先各自跑到自己那一格（等分一圈，所以站得開），到位就轉身面向建築
         原地跳。跳的相位照編號錯開 0.09 秒，一圈看過去是一道波浪，
         不是全場同手同腳。 */
      if (ringWalk(w, w.spot, cheerR(), dt, w.crun)) {
        w.a = Math.atan2(-w.x, -w.z);                 // 面向建築
        w.gait += (0 - w.gait) * Math.min(1, dt * 8);
        w.ph += dt * 9;                               // 舉起來的手跟著擺
        w.hail = 1;
        w.cft -= dt;
        if (w.cft <= 0) { w.cft = CONF_GAP; spawnConfetti(w); }
        const u = (w.cheer + wi * 0.09) % JUMP_T / JUMP_T;
        /* 落地要有停頓才看得出是「跳」：|sin| 那種連續起伏只會像在漂浮。 */
        w.y = u < JUMP_AIR ? Math.sin(u / JUMP_AIR * Math.PI) * JUMP_H : 0;
      } else {
        w.y += (0 - w.y) * Math.min(1, dt * 6);
      }
    } else {
      /* 慶祝完的那一刻，交談先進冷卻（v1.60）。圈上兩個人只隔 CHEER_GAP 1.9 格，
         比「多近才聊得起來」的 2.6 還近——不推冷卻的話散場那一瞬間整圈人同時配對，
         剛跳完就變成一圈人兩兩站著講話。 */
      if (was < CHEER_T + w.cout) {
        w.chatCd = rr(CHAT_CD, CHAT_CD * 2);
        /* 起腳那一刻就先挑好下一個閒晃點（v1.96）。不挑的話沿用的是上一輪留下的
           目標——完工時那個是 (0, 0)，strollTo 會把落在建築裡的目標推到外圈，
           於是整圈人先一起往內走 1.1 格、同時抵達、再同時往外散（實測 20/20）。 */
        idleSpot(w);
      }
      w.y += (0 - w.y) * Math.min(1, dt * 6);
      // 離隊去蓋自己家的人走那條路（v1.97）；其餘的在建築外圈那一環閒晃
      if (w.hm >= 0) updHome(w, wi, dt);
      else wander(w, dt);
    }
    return;
  }
  w.y += (0 - w.y) * Math.min(1, dt * 6);
  w.cheer = 0;
  if (w.eng) { updEng(w, dt); return; }      // 工程師只看圖、只指揮
  if (w.mage) { updMage(w, wi, dt); return; }   // 魔法師不搬，站在旁邊隔空拋

  switch (w.st) {
    case 'idle': {
      loadUp(w, wi, w.mus ? 1 : 0);        // 肌肉小人一趟只領一塊（v1.112，見 MUS_WIND）
      if (!w.load.length) { wander(w, dt); return; }
      w.st = 'pick'; w.li = 0;
      w.leg = 0;                     // 接到工作就把閒晃里程歸零，別把它算進下次的發呆時間
      const p = pickSpot(blocks[w.load[0].b]);
      w.tx = p.x; w.tz = p.z;
      break;
    }
    case 'pick': {
      // 要撿的那幾塊中途被抽掉，剩下的已經都在手上了：直接回工地
      if (w.li >= w.load.length) { w.li = 0; toSlot(w); break; }
      const j = w.load[w.li];
      const b = j && blocks[j.b];
      if (!b || b.st !== FREE) { dropJob(w, w.li); break; }
      {
        const p = pickSpot(b);                        // 躺在房子占地上的站到框外拿
        w.tx = p.x; w.tz = p.z;
      }
      // 走不過去就在最近能到的距離伸手拿（v1.108，見 nearGrab）
      if (buildWalk(w, dt) || nearGrab(w, j.b, dt)) {
        if (b.cell) gridDel(b);
        douse(b);                                     // 撿起來的碎料還在燒的話，先熄掉
        b.st = CARRY; b.rest = false; w.carry = true; stats.carried++;
        w.li++;
        if (w.li < w.load.length) {                   // 還沒拿滿：直接去下一塊
          const p = pickSpot(blocks[w.load[w.li].b]);
          w.tx = p.x; w.tz = p.z; w.chk = 0;
        } else if (w.mus) { w.li = 0; w.st = 'hurl'; w.ct = MUS_WIND; }   // 就地扔（v1.112）
        else { w.li = 0; toSlot(w); }                 // 拿滿了才回工地
      }
      carryPose(w);                                   // 立刻舉起來，不然有一幀還黏在地上
      break;
    }
    case 'build': {
      const j = w.load[0];
      const b = j && blocks[j.b];
      if (!b || b.st !== CARRY) { dropJob(w, 0); if (w.load.length) toSlot(w); break; }
      carryPose(w);
      if (buildWalk(w, dt)) {
        /* 走過來的這幾秒建築一直在長，站位可能已經被別人補起來了。
           重新挑一個再走過去——就這樣從牆裡把積木丟出去的話，出手那一下整塊在牆裡。
           挑回同一個位置（實心造型的正中央就會這樣）就認了，不然會在原地來回。 */
        if (footBlocked(w.x, w.z)) {
          const st2 = standPos(bp.slots[j.s]);
          if (Math.hypot(st2.x - w.x, st2.z - w.z) > 1) {
            w.tx = st2.x; w.tz = st2.z; w.chk = 0;
            break;
          }
        }
        const s = bp.slots[j.s];
        w.a = Math.atan2(-w.x, -w.z);                 // 面向建築再丟
        b.st = TOSS;
        b.arc = {
          t: 0, dur: 0.34 + Math.hypot(s.x - w.x, s.z - w.z) * 0.02 + s.y * 0.012,
          x0: b.x, y0: b.y, z0: b.z, x1: s.x, y1: s.y + HB, z1: s.z,
          peak: tossPeak(b.x, b.y, b.z, s)
        };
        const pal = bp.pal[s.c % bp.pal.length];
        b.tr = ((pal >> 16) & 255) / 255; b.tg = ((pal >> 8) & 255) / 255; b.tb = (pal & 255) / 255;
        b.slot = j.s;
        b.holder = -1;                                // 出手了就不再屬於任何人
        w.load.shift();
        if (!w.load.length) w.carry = false;
        carryPose(w);                                 // 剩下的那疊要馬上往下遞補一格
        w.st = 'wait'; w.wait = 0.28;
      }
      break;
    }
    /* 肌肉小人撿起來之後就站在原地掄（v1.112）。不必先走位——他站的地方就是剛剛
       那塊料躺著的地方，那裡本來就站得住（下面只擋一種情況，見出手前那一行）。 */
    case 'hurl': {
      const j = w.load[0];
      const b = j && blocks[j.b];
      if (!b || b.st !== CARRY) { dropJob(w, 0); break; }   // 手上那塊被打掉了
      carryPose(w);
      w.gait += (0 - w.gait) * Math.min(1, dt * 8);
      const s = bp.slots[j.s];
      w.a = Math.atan2(s.x - w.x, s.z - w.z);         // 面向要扔到的那一格
      w.ct -= dt;
      /* 手上那塊真的被埋進牆裡才不出手（撿的時候還是空地，掄的這幾秒別人在他身上補了幾層）：
         出手那一下整塊在牆裡。那就退回一般工人那條路，走到工地邊上再丟（build 那段本來就有
         這條）。**看的是那塊積木、不是他的腳**（footBlocked 是腳邊三層）：積木舉在頭頂
         兩格半高，腳邊填起來一兩層不影響它——實測拿 footBlocked 當條件的話，
         金字塔那種實心底盤會讓四成的趟數退回去走回工地，那就不是「就地扔」了。 */
      if (w.ct <= 0) { if (blockAt(b.x, b.y, b.z)) toSlot(w); else hurl(w, j, b); }
      break;
    }
    case 'wait':
      carryPose(w);                                   // 手上還有貨的話要跟著站好
      w.gait += (0 - w.gait) * Math.min(1, dt * 8);
      w.wait -= dt;
      // 一趟丟完才回去重領。還有貨就**站在原地**繼續丟，不必走去下一格的站位
      if (w.wait <= 0) { if (w.load.length) toSlot(w, true); else w.st = 'idle'; }
      break;
  }
}
/* 領一趟的工作單：格子與建材成對領，領到 cap 對為止（不夠就領幾對算幾對）。
   cap 給了就用給的（魔法師一次只領一對），沒給就用這個人搬得動的量。
   下一塊建材是從「上一塊建材那裡」找最近的，不是從人現在站的地方找——
   撿完第一塊人就站在那裡了，一直用人的位置算會挑到同一個方向的料。 */
function loadUp(w, wi, cap) {
  let sx = w.x, sz = w.z;
  for (let k = 0; k < (cap || w.cap); k++) {
    const s = findSlot(w.x, w.z);    // 派離他現在站的地方最近的那一格
    if (s < 0) break;
    // 魔法師只搆得到身邊那一圈的料（v1.89，見 MAGE_REACH）；工人是走過去撿，不限距離
    const bi = findBlock(sx, sz, w.mage ? MAGE_REACH : 0, w.mus ? 1 : 0);
    if (bi < 0) break;
    bp.slots[s].claimed = wi;        // 認領也算「這格有東西了」，會影響上面能不能蓋
    blocks[bi].holder = wi;
    w.load.push({ b: bi, s: s });
    sx = blocks[bi].x; sz = blocks[bi].z;
  }
  if (w.load.length) markSupportDirty(0.05);
}
/* 去丟手上第一塊。stay = 已經站在工地邊上了（剛丟完前一塊）：
   **原地繼續丟**，不必走去下一格的站位（v1.60.1）——一趟三塊卻要跑三趟站位的話，
   那三塊之間的路比省下來的還多，看起來是在原地繞圈。
   一次領的幾格都是同一個視窗裡「離他最近」的那幾格（findSlot），彼此就在附近，
   從同一個位置丟得到；拋物線本來就會沿路算「要多高才過得去」（tossPeak），
   中間隔著牆的話它會自己拉高。
   只有一種情況要重走：站的地方被補起來了（下面 build 那段的 footBlocked）。 */
function toSlot(w, stay) {
  if (!w.load.length) { w.st = 'idle'; return; }   // 整趟都被抽光了
  w.st = 'build';
  const st = stay ? { x: w.x, z: w.z } : standPos(bp.slots[w.load[0].s]);
  w.tx = st.x; w.tz = st.z; w.chk = 0;
}
/* 拋物線的頂點。只看高度差是不夠的（v1.51 之前那版就是）：人退到外緣之後，
   出手點跟目標之間隔著下面幾層的牆——城堡第 10 層那種，飛到三成路程時高度才 9.0，
   而那裡的牆有 10 格高，積木會從牆裡穿出去。變成「積木穿牆」換掉「人穿牆」，沒有比較好看。
   所以沿路取樣，每一點都算「頂點要多高才過得去」，取最大的那個。
   擋路的高度用 colTop（從地面連續疊上來的那一段），挑出去的樓板不算——
   那些是從底下穿過去的。 */
/* 拋物線的弧頂要多高才閃得過中間的東西。
   x1／y1／z1 是落點（y1 已經是世界座標），base 是沒有障礙時的下限，
   top(x, z) 回傳「那一根柱子從地面連續疊到第幾層」——
   地標查藍圖（colTop）、小人的家查自己那一份格子表（homeColTop）。 */
function arcPeak(x0, y0, z0, x1, y1, z1, top, base) {
  const dx = x1 - x0, dz = z1 - z0;
  let peak = base;
  /* 取樣點要密，而且不能只照距離給：出手後那一小段爬得最急，
     「要多高才過得去」在 t 很小的時候最大（分母 sin(πt) 趨近 0）。
     照距離每半格取一點的話，2 格的拋擲只有 6 點，t=0.13 那個尖峰整個漏掉——
     實測台北 101 有 5.6% 的積木就是這樣從旁邊那道牆穿出去的。
     所以 24 點是**下限**，遠的再照距離加密（v1.115）：一格的東西要每 0.25 格看一次
     才不會被整格跨過去。四五格的拋擲本來就是每 0.2 格一點，加了也沒變；
     真正需要的是長程那些——肌肉小人回自己家是站在挖料的地方直接扔（見 hurlTrip），
     一趟 12～16 格，固定 24 點等於每 0.65 格才看一次，比一格還粗：
     實測 14 條穿過自己屋頂的弧線裡有 5 條就是這樣把牆頭整格跨過去的。 */
  const n = Math.max(24, Math.ceil(Math.hypot(dx, dz) * 4));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const cy = top(x0 + dx * t, z0 + dz * t);
    if (cy < 0) continue;
    // 積木中心要比那格的中心高 1.1（一格是 1，剛好 1 是擦過去）
    const need = (cy + 1.1 - y0 - (y1 - y0) * t) / Math.sin(t * Math.PI);
    if (need > peak) peak = need;
  }
  return Math.min(peak, 26);
}
function tossPeak(x0, y0, z0, s) {
  const y1 = s.y + HB;
  return arcPeak(x0, y0, z0, s.x, y1, s.z, colTop,
                 Math.max(1.6, (y1 - y0) * 0.45 + 1.8));
}
/* ── 肌肉小人（v1.112）─────────────────────────────────
   十個人有一個是肌肉小人（8、18、28… 號，跟 0 號的工程師、5 號的魔法師錯開）：
   裸著上半身，肩膀與手臂比別人粗一圈。**撿料跟一般工人一模一樣**——走過去撿、
   多遠都去（不像魔法師只搆得到腳邊 11 格，也不像他一塊都不碰）；
   差別在撿起來之後**不走回工地**：站在料堆那裡把那塊掄起來，直接扔到藍圖的位置上，
   整段路是一條拋物線（跟魔法師一樣），中途不落地。
   飛得比魔法師快得多、也比他平——那是靠力氣扔出去的，不是浮過去的。
   所以他一趟只領一塊：「撿起來就扔」的節奏不允許先湊滿三塊再一起處理。 */
const MUS_WIND = 0.3;               // 撿起來之後掄多久才出手（看得出是「掄」的最短時間）
/* 飛行時間：起手 0.3 秒，再照水平距離與高度加。三十格外大約 0.8 秒——
   魔法師同一段是 2.6 秒（他是飄的），一般工人在工地邊上那一下是 0.34 秒起跳。
   弧頂就用 tossPeak（沒有魔法師那個 +1.6 的加高）：同樣的高度飛更遠，
   看過去就是一條平的、快的線。 */
const MUS_DUR0 = 0.3, MUS_DUR_D = 0.016, MUS_DUR_Y = 0.01;
/* 扔完的停頓跟一般工人丟完那一下一樣（0.28）。v1.112 給 0.4「喘一下」，
   但他沒有理由喘得比別人久——那多出來的 0.12 秒是每一塊都要付的（見〈他有比較快嗎〉）。 */
const MUS_REST = 0.28;
/* 出手：那一塊從他頭頂上（撿起來就舉在那裡）進入拋物線。跟一般工人丟的是同一套 arc，
   除了時間與 hurl 記號之外沒有第二套規則——半路被打掉、落不下去都由 stepToss 處理。 */
function hurl(w, j, b) {
  const s = bp.slots[j.s];
  b.st = TOSS;
  b.arc = {
    t: 0,
    dur: MUS_DUR0 + Math.hypot(s.x - b.x, s.z - b.z) * MUS_DUR_D + s.y * MUS_DUR_Y,
    x0: b.x, y0: b.y, z0: b.z, x1: s.x, y1: s.y + HB, z1: s.z,
    peak: tossPeak(b.x, b.y, b.z, s),
    hurl: 1                    // 這條是從料堆那裡直接扔的，量「工人原地連丟拋多遠」要濾掉
  };
  const pal = bp.pal[s.c % bp.pal.length];
  b.tr = ((pal >> 16) & 255) / 255; b.tg = ((pal >> 8) & 255) / 255; b.tb = (pal & 255) / 255;
  b.slot = j.s;
  b.holder = -1;                                     // 出手了就不再屬於任何人
  w.load.shift();
  w.carry = false;                                   // 一趟就一塊，出手就空手了
  carryPose(w);
  w.st = 'wait'; w.wait = MUS_REST;
}

/* 搬運姿勢：建材舉在頭頂上方，隨腳步微幅晃動。
   一趟可以搬好幾塊（v1.60），所以頭上是一疊——間距用格距 1（跟建築上的疊法一樣，
   看得出一塊一塊）。工作單裡已經在手上的才算，還沒撿的那幾塊還躺在地上。 */
function carryPose(w) {
  let k = 0;
  for (const j of w.load) {
    const b = blocks[j.b];
    if (!b || b.st !== CARRY) continue;
    b.x = w.x + Math.sin(w.a) * 0.05;
    b.z = w.z + Math.cos(w.a) * 0.05;
    // 舉的高度要跟著身高走，不然高個子的積木會陷進自己的安全帽裡
    b.y = (1.45 + Math.abs(Math.sin(w.ph)) * 0.05) * w.scale + k;
    b.rx += (0 - b.rx) * 0.2; b.rz += (0 - b.rz) * 0.2;
    k++;
  }
}
/* ── 閒晃 ─────────────────────────────────────────────────
   沒事做的時候走的路，跟施工中的走法分開：
   pick／build 本來就得走進工地擺積木，這裡則是要繞開已經蓋好的建築。
   把建築當成以工地中心為圓心、半徑 siteR 的一根柱子繞過去就好——
   要的是「不要從建築中間穿過去」，不是貼著每一塊積木算精確的邊。 */
const KEEP = 1.5;                   // 閒晃時跟建築外圍保持的距離
/* 閒晃的目標點取在工地外圍這一環裡（見 idleSpot）。外緣給到 9 格是為了讓人散得開，
   又還在「建築周圍」——鏡頭取的是建築那一帶，走到碎料場外緣就等於走出畫面。 */
const IDLE_NEAR = 2, IDLE_FAR = 9;

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
  if (d < REACH) { pushOutHome(w); w.gait += (0 - w.gait) * Math.min(1, dt * 8); return true; }

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
  /* 房子擋路就繞過去（見 dodgeHome）。先正規化：dodgeHome 是照「往前探幾格」找牆的，
     方向向量沒歸一的話探的距離會跟著放大（上面那兩段會把它拉到 2.5 倍長）。 */
  {
    const m0 = Math.hypot(ux, uz) || 1;
    const g = dodgeHome(w, ux / m0, uz / m0);
    ux = g.x; uz = g.z;
  }
  const m = Math.hypot(ux, uz) || 1;
  ux /= m; uz /= m;

  const sp = Math.min(WALK * dt, d);
  w.x += ux * sp; w.z += uz * sp;
  pushOutHome(w);
  w.leg += sp;                         // 這趟閒晃走了多遠，抵達後拿來算站多久
  w.a = Math.atan2(ux, uz);            // 面向真正在走的方向，不是目標方向
  w.ph += dt * 11;
  w.gait += (0.85 - w.gait) * Math.min(1, dt * 8);
  return false;
}

/* 下一個閒晃點：建築外圈那一環裡隨便挑（v1.96 起慶祝散場後也用這個）。
   範圍只有這一環，不是整片草地——使用者要的是「不要讓建築一圈都沒人」：
   散場後改成整片草地亂挑（v1.60 那版）的話，實測目標半徑中位數 46，
   人站在半徑 14.9 上，於是每個人的第一段路都朝外，一圈人整齊往外走。
   下限（strollTo 的 KEEP）保證他不會穿進建築裡。 */
function idleSpot(w) {
  for (let t = 0; t < 8; t++) {
    const a = Math.random() * Math.PI * 2, d = siteR + rr(IDLE_NEAR, IDLE_FAR);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (t < 7 && homeAt(x, z)) continue;      // 別挑在人家屋子裡（v1.97）
    w.tx = x; w.tz = z; return;
  }
}
function wander(w, dt) {
  if (w.pause > 0) { w.pause -= dt; w.gait += (0 - w.gait) * Math.min(1, dt * 8); return; }
  if (strollTo(w, dt)) { strollPause(w); idleSpot(w); }
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

/* ── 魔法師 ───────────────────────────────────────────────
   十個人有一個是魔法師：戴巫師帽、拿法杖，一塊積木都不搬。他走到建材堆旁邊
   （v1.89，搆得到的只有腳邊那一圈，見 MAGE_REACH），把料一塊接著一塊隔空拋到藍圖的
   位置上——整段路都是那條拋物線，中途不經過任何人的手。
   單塊飛得比工人自己丟的慢一倍以上（看得出是飄過去的），
   但**上一塊還在半空就送下一塊**（v1.64.1）：他每 MAGE_GAP 秒發一塊，
   一塊要飛兩三秒，所以天上隨時掛著兩到五塊，連成一條往建築流過去的線。
   等一塊落定才動下一塊的話，那是「一塊一塊搬」，不是「一路把料吸過去」。

   施法特效刻意留得小（使用者要的是「一點點、看得出是他在施法」）：
   杖頭的寶珠亮起來、出手時腳下一圈淡光加杖頭一小撮星，飛行途中每隔一段撒一顆。 */
const MAGE_KEEP = 5.5;              // 站得離工地外圍至少多遠（工程師 3.4、閒晃的人 1.5，他站最外面）
/* 隔空拉得動的範圍（v1.89，使用者指定「只能搬運一定範圍的積木，所以變成要走到積木堆附近，
   優先找積木多的地方」）。搆得到的只有身邊 MAGE_REACH 格內躺著的料，**拋出去那一段不受限**——
   還是一條拋物線直接飛到藍圖上，中途不經過任何人的手。
   所以他站的位置不再是「工地外圈的一個角度」（v1.64～v1.88 是釘死的），而是自己找一坨料
   站過去：塊數多的優先、路程遠的折價，跟推土機挑碎料堆同一套算法（見 pickHeap）。 */
const MAGE_REACH = 11;              // 搆得到多遠的建材
/* 走多遠不設上限（v1.95）。v1.89～v1.94 綁在工地外圍 16 格內（MAGE_ROAM），
   理由是「不設的話他會一路追著料往外走，跑出鏡頭、蓋完還得從場外走回來慶祝」。
   但 v1.89 同時把他改成「走到料旁邊才搬得動」——兩條加起來就變成：料一旦被轟到
   16 格外，他整座建築都站著不動。實測玩家丟一發核彈把碎料炸到半徑 30～60 之後，
   接下來那一座他 300 秒發 0 塊（工人不受影響，他們本來就走到哪撿到哪）。
   既然要他走到料旁邊，那就跟一般工人一樣：料在哪就走到哪，不再有上限。
   下限（MAGE_KEEP）保留——那不是行動範圍，是「不能站進建築裡伸手」。 */
const MAGE_CELL = 9;                // 數料堆用的粗格邊長。要小於 MAGE_REACH，站在中心才整格都搆得到
const MAGE_TRIP = 0.06;             // 路程折價：每遠一格，那一坨的吸引力打幾折
const MAGE_APART = 9;               // 別的魔法師已經站在這麼近就換一坨，不然幾個人會疊在同一堆上
const MAGE_REPICK = 1.2;            // 搆不到料時每隔幾秒重挑一次（走過去的路上料會被工人搬掉）
const MAGE_HEAP_T = 0.4;            // 料堆清單重算的間隔，幾個魔法師共用一份
const MAGE_GAP = 0.85;              // 每隔幾秒發一塊（也是「面向那塊料舉著杖」的時間）
/* 飛行時間：起手 0.9 秒，再照水平距離與高度加。二十格外的建材大約飛兩秒——
   工人自己丟那一下是 0.34 秒起跳，慢到這個程度才看得出「這塊是飄過去的」。 */
const MAGE_DUR0 = 0.9, MAGE_DUR_D = 0.055, MAGE_DUR_Y = 0.02;
const MAGE_LIFT = 1.6;              // 弧頂比工人丟的再高一點（tossPeak 只保證閃得過牆）
/* 飛行中每隔幾秒撒一顆星。節拍是**一個人一份**，不是一塊一份：同時飛兩三塊的話
   一塊一份就是三倍的星，那池星只有 48 顆，滿場魔法師會把它吃光。 */
const MAGE_TRAIL = 0.35;
const MAGE_STAR = 0.22;             // 那些星是魔法陣那種星的幾分之幾大
const CAST_UP = 8, CAST_DOWN = 4;   // 舉杖／收杖的速度（每秒），舉的要比收的快才撐得住

/* 舉杖的姿勢。收杖是 updWorker 每幀預設在做的事，這裡只負責把它撐回去。 */
function castPose(w, dt, on) {
  if (on) w.cast = Math.min(1, w.cast + dt * CAST_UP);
  if (w.cast > 0.02) w.ph += dt * 3;        // 站著不走也要讓 ph 跑，寶珠才會明滅
}
/* 杖頭在世界座標的位置。偏移量向引擎拿（ENG.WAND_TIP，那是杖真正被畫在哪），
   再照這個人的朝向繞 Y 轉、照身高縮放——不轉的話星星會撒進他身體裡。 */
function staffTip(w) {
  const t = ENG.WAND_TIP, sa = Math.sin(w.a), ca = Math.cos(w.a), s = w.scale;
  return { x: w.x + (t[0] * ca + t[2] * sa) * s,
           y: w.y + t[1] * s,
           z: w.z + (-t[0] * sa + t[2] * ca) * s };
}
/* ── 魔法師要站哪裡（v1.89）─────────────────────────────
   場上還躺著的建材用粗格數一數，回傳每一坨的中心與塊數。
   幾個魔法師共用一份、每 MAGE_HEAP_T 秒重算一次（計時在 step 裡扣）：一坨料不會在
   半秒內跑掉，而每人每幀各掃一次 blocks（九千塊 × 六個人）純粹是白花的成本。 */
let mageHeapT = 0, mageHeapList = null;
function listMageHeaps() {
  if (mageHeapList && mageHeapT > 0) return mageHeapList;
  mageHeapT = MAGE_HEAP_T;
  const cnt = new Map();
  for (const b of blocks) {
    if (b.st !== FREE || !b.rest || b.holder >= 0) continue;
    const key = Math.floor(b.x / MAGE_CELL) + ':' + Math.floor(b.z / MAGE_CELL);
    let c = cnt.get(key);
    if (!c) cnt.set(key, c = { n: 0, x: 0, z: 0 });
    c.n++; c.x += b.x; c.z += b.z;
  }
  mageHeapList = [];
  for (const c of cnt.values()) mageHeapList.push({ n: c.n, x: c.x / c.n, z: c.z / c.n });
  return mageHeapList;
}
/* 他要站的那個點（極座標轉回世界座標）。站位一律在工地外圈以外——
   一坨料躺在建築裡（玩家自己打出來的碎料）的時候，他要站在牆外面伸手，不能走進去。 */
function mageSpot(w) {
  return { x: Math.cos(w.mang) * w.mrad, z: Math.sin(w.mang) * w.mrad };
}
/* 挑一坨料站過去：塊數多的優先，路程遠的折價（跟 pickHeap 同一個判準）。
   兩個條件會刷掉候選：站定之後整坨搆不到的（在建築裡的那種）、別的魔法師已經在那一帶的。
   回傳 false = 沒有值得走過去的，站在原地等就好。 */
function pickMageSpot(w) {
  const heaps = listMageHeaps();
  let bx = 0, bz = 0, bn = 0, best = -1;
  for (const h of heaps) {
    const hr = Math.hypot(h.x, h.z);
    const r = Math.max(siteR + MAGE_KEEP, hr);        // 多遠都去，只是不站進工地裡（v1.95）
    const a = hr < 0.001 ? w.mang : Math.atan2(h.z, h.x);
    const sx = Math.cos(a) * r, sz = Math.sin(a) * r;
    // 站定之後那一坨的中心要在搆得到的範圍內，不然走過去也是白站
    if (Math.hypot(h.x - sx, h.z - sz) > MAGE_REACH * 0.6) continue;
    if (mageTaken(w, sx, sz)) continue;
    if (homeAt(sx, sz)) continue;                     // 別站到人家屋子裡（v1.97）
    const s = h.n / (1 + Math.hypot(h.x - w.x, h.z - w.z) * MAGE_TRIP);
    if (s > best) { best = s; bx = a; bz = r; bn = h.n; }
  }
  if (best < 0) return false;
  w.mang = bx; w.mrad = bz;
  return bn > 0;
}
/* 這一帶是不是已經有別的魔法師認走了。比的是**他們要站的點**不是現在的位置：
   比現在的位置的話，兩個人會一路並肩走到同一坨料上才發現撞在一起。 */
function mageTaken(w, sx, sz) {
  for (const o of workers) {
    if (o === w || !o.mage) continue;
    const p = mageSpot(o);
    if ((p.x - sx) ** 2 + (p.z - sz) ** 2 < MAGE_APART * MAGE_APART) return true;
  }
  return false;
}
/* 已經送出去的那幾塊：落定了（或半路被打掉）就從清單移掉。留著只為了兩件事——
   沿路撒星，以及「還有東西在飛就先別收杖」。
   s < 0 是隔空蓋自己家的那些（v1.102）：那些不占藍圖的格子，只看還在不在飛。 */
function mageTrail(w, dt) {
  for (let i = w.fly.length - 1; i >= 0; i--) {
    const f = w.fly[i], b = blocks[f.b];
    if (!b || b.st !== TOSS || (f.s >= 0 && b.slot !== f.s)) w.fly.splice(i, 1);
  }
  if (!w.fly.length) return;
  w.trail -= dt;
  if (w.trail <= 0) {                                // 隨機挑一塊還在飛的撒（見 MAGE_TRAIL）
    const b = blocks[w.fly[Math.floor(Math.random() * w.fly.length)].b];
    if (b) spawnStars(b.x, b.z, b.y, 0.5, 1, MAGE_STAR);
    w.trail = MAGE_TRAIL;
  }
}
function updMage(w, wi, dt) {
  mageTrail(w, dt);
  /* 站位只夾下限：換一座建築時 siteR 會變，上一輪挑的那個半徑可能落在新工地裡面
     （他會站進牆裡），所以每幀夾一次。上限 v1.95 拿掉了（見 MAGE_KEEP 上面那段）。 */
  if (w.mrad < siteR + MAGE_KEEP) w.mrad = siteR + MAGE_KEEP;
  // 一幀只能走這一次（ringWalk 會真的移動人）；下面「站定了嗎」全部看這一個值
  const stand = ringWalk(w, w.mang, w.mrad, dt);
  if (!w.load.length) {
    // 站定了才認料：搆得到的範圍是以「他站的地方」算的，走位途中認的那塊會被拖著走
    if (stand) loadUp(w, wi, 1);                     // 一次只領一格一塊
    /* 沒格子可蓋、或身邊搆不到料：去找一坨料站過去（v1.89，見 pickMageSpot），
       不跟一般人一樣去閒晃——閒晃那條路會沿用上一輪留下的目標點（慶祝散場時取的是
       整片草地），他一沒工作就往四十幾格外走，蓋完要圍圈時得從場外跑回來。
       換地方**只在搆不到料的時候**做：不管有沒有料每隔幾秒就重挑一次的話，腳邊還有
       一整片料他也會被別處那坨大的拉走（實測他沿著外圈走十秒，路上最近的料只有 2.7 格）。
       找不到值得走過去的一坨（料被搬光了、都被別人認走了）就站在原地等。 */
    if (!w.load.length) {
      w.st = 'idle';
      if (w.fly.length) castPose(w, dt, 1);          // 還有在飛的就先舉著杖送它們到定位
      w.mre -= dt;
      if (w.mre <= 0) { w.mre = MAGE_REPICK; pickMageSpot(w); }
      if (stand) {
        w.a = Math.atan2(-w.x, -w.z);                // 站定就面向建築等下一批
        w.gait += (0 - w.gait) * Math.min(1, dt * 8);
      }
      return;
    }
    /* 領到了就開始蓄這一發。這裡不設的話，站定在原地的人會在領到的同一幀就出手；
       它同時也是連發的節拍——上一塊出手後 load 就空了，下一幀馬上領下一塊重新蓄。 */
    w.st = 'cast'; w.leg = 0; w.ct = MAGE_GAP;
  }
  const j = w.load[0];
  const b = blocks[j.b];
  if (!b || b.st !== FREE || !b.rest) { dropJob(w, 0); return; }   // 認的那塊被搶走／被打飛了
  // 還在走位：蓄力從「站定」那一刻才開始算，不然半路被撞倒的人一站起來就發一塊
  if (!stand) { w.ct = MAGE_GAP; return; }
  w.gait += (0 - w.gait) * Math.min(1, dt * 8);
  w.a = Math.atan2(b.x - w.x, b.z - w.z);            // 面向要拉起來的那一塊
  castPose(w, dt, 1);
  w.ct -= dt;
  if (w.ct <= 0) launchMage(w, j, b);
}
/* 出手：那一塊直接從躺著的地方進入拋物線，不經過 CARRY。 */
function launchMage(w, j, b) {
  const s = bp.slots[j.s];
  if (b.cell) gridDel(b);
  douse(b);                                          // 還在燒的話先熄掉，跟工人撿起來一樣
  b.st = TOSS; b.rest = false;
  b.arc = {
    t: 0,
    dur: MAGE_DUR0 + Math.hypot(s.x - b.x, s.z - b.z) * MAGE_DUR_D + s.y * MAGE_DUR_Y,
    x0: b.x, y0: b.y, z0: b.z, x1: s.x, y1: s.y + HB, z1: s.z,
    peak: tossPeak(b.x, b.y, b.z, s) + MAGE_LIFT,
    mage: 1                       // 這條是隔空拋的，量「工人丟多遠」的地方要濾掉它
  };
  const pal = bp.pal[s.c % bp.pal.length];
  b.tr = ((pal >> 16) & 255) / 255; b.tg = ((pal >> 8) & 255) / 255; b.tb = (pal & 255) / 255;
  b.slot = j.s;
  b.holder = -1;                                     // 出手了就不再屬於任何人
  w.fly.push({ b: j.b, s: j.s });
  w.load.shift();
  stats.carried++;                                   // 「累計搬運」照算：這一塊也是小人送上去的
  /* 出手那一下的特效。連發之後這兩樣每 0.85 秒就來一次，所以量都比單發時再收一點：
     杖頭兩顆星、腳下那圈也淡一些，不然整個人會被自己的特效裹住。 */
  const tip = staffTip(w);
  spawnStars(tip.x, tip.z, tip.y, 0.5, 2, MAGE_STAR);
  fxRings.push({ x: w.x, z: w.z, y: 0.14, r: 0.5, vr: 2.2, op: 0.42, fade: 0.7,
                 c: 0xff8ec4, add: 1, spin: rr(0, 6.28) });
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
  // 正在蓋自己的家的人不算閒（蓋完了在家附近走走的才算，v1.97）
  if (w.hm >= 0 && homeBusy(w)) return false;
  if (idlePhase()) return !cheerOn(w);
  return phase === 'build' && w.st === 'idle' && !w.eng;
}
function pairChat() {
  if (phase !== 'build' && !idlePhase()) return;
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
    /* 聊完就走：給一個新的閒晃目標，不然兩個人會杵在原地等發呆時間跑完。
       有自己家的人挑自己家附近（v1.100）：挑工地外圈那一環的話，他會先往工地走幾步，
       下一幀才被 liveHome 叫回來——而在那之前如果他還在挖料那條路上，
       那個目標會把他一路帶到工地那邊去（實測跑到離自己家 38 格）。 */
    const h = w.hm >= 0 && homes ? homes.list[w.hm] : null;
    if (h) liveSpot(w, h); else idleSpot(w);
    w.pause = 0;
  }
}

/* ── 閒晃事件 ─────────────────────────────────────────────
   慶祝散完場、場上真的沒事幹的那段時間會發生一件事（v1.97，使用者要的，
   而且指定「設計成可擴充」）。所以做成一張表：每一筆是
     { id, p 機率, start(), step(dt) 或 null, stop() }
   全員都散場那一刻照 p 擲一次骰子，中了就跑那一件；一開始建造（或建築被動到
   進了拆除／整地）就收掉，直接回建造模式。
   「收掉」只是把人叫回去上工——事件蓋出來的東西留在場上，那是它自己的事。
   目前只有一筆（小人的家）。加第二筆就是往這張表再放一列。 */
let idleEv = null;                  // 現在在跑的那一件（null＝純閒晃）
let evArm = 1;                      // 這一輪還沒挑過
/* wt 是**相對權重，不是機率**（v1.101，使用者：「閒晃模式事件改為必定發生，
   因為設計成可擴充，必定發生 隨機一種」）：散場之後一定會挑一件來跑，
   wt 大的被挑到的機會多。v1.97～v1.100 是「每一筆各擲一次 40%」——只有一筆的時候，
   六成的場次什麼事都不會發生。 */
const IDLE_EVENTS = [
  /* 小人的家。每個人的行為擺在 updHome（跟魔法師一樣是「一條自己的路」），
     所以這裡不需要每幀的 step。 */
  { id: 'home', wt: 1, start: startHomes, step: null, stop: stopHomes }
];
/* 照權重挑一件。回傳 null 只有一種情況：表是空的。 */
function rollIdleEvent() {
  let tot = 0;
  for (const e of IDLE_EVENTS) tot += e.wt;
  if (tot <= 0) return null;
  let r = Math.random() * tot;
  for (const e of IDLE_EVENTS) { r -= e.wt; if (r < 0) return e; }
  return IDLE_EVENTS[IDLE_EVENTS.length - 1];      // 浮點誤差的保險
}
function stopIdleEvent() {
  const e = idleEv;
  idleEv = null;
  if (e) e.stop();
}
function stepIdleEvent(dt) {
  if (!idlePhase()) { stopIdleEvent(); evArm = 1; return; }
  if (evArm) {
    /* 等到每個人都散場才挑：還在圈上跳的時候就開始蓋房子的話，
       那幾個人會從圈上直接走掉（散場錯開最多 CHEER_OUT 秒，見那裡）。 */
    if (workers.some(w => cheerOn(w))) return;
    evArm = 0;
    idleEv = rollIdleEvent();
    if (idleEv) idleEv.start();
  }
  if (idleEv && idleEv.step) idleEv.step(dt);
}

/* ── 事件一：小人的家 ─────────────────────────────────────
   使用者的規格：一半左右的人找個地方蓋自己的小房子（50 塊以內），積木就近從地上
   挖出來，也可以跟附近的小人一起合蓋大一點的，蓋完就在自己家附近走走。

   房子**不進藍圖那一套**（bp.slots／支撐／派工游標／placedCnt 全是「那一座地標」
   專用的），它自己帶一份格子清單，積木用 hh／hk 記住是哪一間的哪一格。所以：
     · 推土機碰不到它——那台只推工地內（siteR + 1.4）的 FREE 碎料
     · 破壞道具照樣打得掉——那些只看 st === SET
     · 打掉的那一格小人會補回來（freeBlock 把 h.left 加回去）
     · 換場時「整棟解成碎料」那一段要跳過它（見 startBuild）
   「物理上該有的東西」是各自實作、規則抄地標那一套（v1.102／v1.103）：
   支撐與垮塌 collapseHome、只剩對角勾著的 dropHungHome、砌得上去嗎 canPlaceHome、
   拋物線閃得過自己的屋頂 homePeak、腳邊三層擋路 homeFoot、水的固體判定 solidAt。
   房子留在場上不收（使用者指定），唯一的例外是下一座工地正好蓋到它身上——
   那一間解成碎料（見 clearHomesInSite）。 */
let homes = null;                   // { list: [home] }。蓋好的房子不隨事件收掉
/* 每間房子一個不會變的編號（v1.109）。小人記「自己家是哪一間」記的是這個，
   不是 homes.list 的索引——索引會被 dropHomes 重編。 */
let homeSeq = 0;
const HOME_PART = 0.5;              // 大約幾成的人離隊去蓋（使用者選「一半左右」）
/* 蓋在哪一帶（v1.98 放寬，使用者：「應該分散一點，地標建築範圍外到小樹圈內」）。
   v1.97 是 siteR + 8～22 的窄環，幾間房子擠在同一圈上。現在內緣貼著地標外圍、
   外緣就是碎料場外緣——樹種在那外面（makeTrees 是 arenaR + 3～15），
   所以「小樹圈內」＝整片碎料場。範圍跟著建築大小走，大工地就散得更開。 */
const HOME_NEAR = 5;
const homeOut = () => Math.max(siteR + HOME_NEAR + 5, arenaR);
const HOME_ARC = 1.6;               // 挑位置時偏離「這組人現在站的方位」多少弧度
const HOME_GAP = 12;                // 兩間的中心至少隔多遠
const HOME_TREE = 3.5;              // 離樹至少多遠（樹種在碎料場外圍，通常碰不到）
const HOME_TEAM = 3;                // 一間最多幾個人合蓋
const HOME_NEARBY = 8;              // 多近算「附近的小人」，會被拉進同一組
/* 房子的款式。v1.99 加了種類（門廊、圍籬、兩層樓、塔屋、長屋），
   v1.100 整組放大到 **100～300 塊**（使用者：「調整小房子塊數 在 100~300 之間
   比較有城市村落感」；v1.99 是 25～115）。
   一款就是一組參數，全部走同一支 homeSlots：

     w／d   平面。d 給 4 以上——屋頂縮一圈之後還要剩得下屋脊
     h      牆幾層高。窗戶每隔一層開一排（見 homeSlots），
            五層以上還會在半高處把整圈牆換成屋頂色當腰線，看得出樓層
     porch  門口一個小門廊：兩根兩格高的柱子 ＋ 上面一片雨遮
     fence  外面一圈及膝的圍籬，門那一側留一個出入口

   人多蓋大的。房子大了蓋的時間也長（實測一間 100～280 塊要兩三分鐘），
   所以同一趟改成搬好幾塊（見 HOME_CARRY）——一塊一趟的話八成時間在走路。 */
const HOME_KIND = [
  { n: 1, id: '小屋', w: 6, d: 5, h: 3, porch: 1 },
  { n: 1, id: '塔屋', w: 4, d: 4, h: 8 },
  { n: 1, id: '小院', w: 5, d: 4, h: 3, porch: 1, fence: 1 },
  { n: 2, id: '大屋', w: 7, d: 5, h: 4, porch: 1 },
  { n: 2, id: '長屋', w: 9, d: 4, h: 3, fence: 1 },
  { n: 2, id: '兩層樓', w: 6, d: 5, h: 5, porch: 1 },
  { n: 3, id: '三層樓', w: 8, d: 6, h: 7, porch: 1, fence: 1 },
  { n: 3, id: '大長屋', w: 12, d: 4, h: 4, porch: 1, fence: 1 },
  { n: 3, id: '農莊', w: 9, d: 6, h: 4, porch: 1, fence: 1 }
];
/* 幾個人合蓋就從那一組裡隨機挑一款。人數超過表上最多的那組就用最大那組。 */
function pickHomeKind(n) {
  const want = Math.min(n, HOME_KIND[HOME_KIND.length - 1].n);
  const pool = HOME_KIND.filter(k => k.n === want);
  return pool[Math.floor(Math.random() * pool.length)];
}
/* 地基半徑：閒晃的人要繞開這麼多，圍籬也要圈進來（圍籬在外面兩格）。
   取對角的一半再加一點——方的東西用圓框，寧可框大一點。 */
function homeR(k) {
  const pad = k.fence ? 4 : 0;
  return Math.hypot(k.w + pad, k.d + pad) / 2 + 0.7;
}
const HOME_PAL = [                  // 牆、屋頂、煙囪（每間隨機挑一組）
  [[0.82, 0.70, 0.52], [0.72, 0.31, 0.26], [0.56, 0.53, 0.50]],
  [[0.86, 0.83, 0.74], [0.38, 0.45, 0.58], [0.56, 0.53, 0.50]],
  [[0.74, 0.60, 0.44], [0.36, 0.52, 0.36], [0.56, 0.53, 0.50]]
];
const DIG_T = 0.8;                  // 挖一塊要幾秒
/* 挖料的地方離自己家的**地基邊緣**多遠（v1.99 改成相對於 h.r）。
   v1.98 是直接實測中心 3.5～8 格——平房小屋沒問題，但圍籬大屋的地基半徑就有 6.7，
   那個範圍幾乎全在自己屋子裡，挖料點全被刷掉（掉到 fallback、而那一點也在屋子裡）。 */
const DIG_NEAR = 1.5, DIG_FAR = 6;
const DIG_PUFF = 0.16;              // 挖的時候每隔幾秒噴一撮土
/* 一趟挖幾塊（v1.100）。跟工人一趟搬 1～3 塊同一個道理：房子大了（100～300 塊），
   一塊一趟的話八成的時間在走路——實測一趟一塊要 6.4 秒才砌上一塊，
   一趟三塊是 2 秒上下。上限跟工人一樣是 3，再多手上那疊會高過頭頂。 */
const HOME_CARRY = [2, 3];
const LAY_GAP = 0.26;               // 站定之後每隔幾秒丟一塊（工人是 0.28）
const HOME_REACH = 3;               // 同一趟認的格子最多隔多遠（見 digBlock）
const DIG_ARC = 0.8;                // 挖料點偏離「他現在站的方位」多少弧度（見 digSpot）
const DIG_MARK = 1.7;              // 土痕的大小（跟隕石坑同一套，3 秒淡掉）
const LIVE_R = 6;                   // 蓋完在家附近多大範圍裡走
/* 站位離地基邊緣多遠。要大於 REACH（0.9）＝「走到多近算抵達」，
   不然他停下來的那一點可能還在屋子裡（停下來就不會再被 pushOutHome 推了）。 */
const HOME_STAND = 1.4;

/* 「哪一間的哪一格 → 哪一塊積木」的反查表（v1.102）。垮塌判定與火勢蔓延都要它：
   積木記得自己在哪一格（b.hh／b.hk），但反過來查不到。
   一幀最多建一次（跟地標那邊的 buildSlotOwner 同一個做法）。 */
let homeOwn = null, homeOwnAt = -1;
function homeOwners() {
  if (homeOwnAt === frameNo && homeOwn) return homeOwn;
  homeOwn = new Map();
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.hh >= 0 && b.hk >= 0 && b.st === SET) homeOwn.set(b.hh + ':' + b.hk, i);
  }
  homeOwnAt = frameNo;
  return homeOwn;
}
/* 這個世界座標上有沒有一塊「已經砌上去」的房子積木（v1.102）。
   房子不在藍圖的格子表裡，所以 blockAt 查不到它——那些「先用格子便宜地擋一下、
   有東西才去掃 blocks」的地方（煙火的火星、點擊落點重驗）都要另外問這一支。
   一間房子一次查表，房子又不多，成本跟 blockAt 同級。 */
function homeSolid(x, y, z) {
  if (!homes) return false;
  const gy = Math.round(y - HB);
  if (gy < 0) return false;
  for (const h of homes.list) {
    if ((x - h.x) ** 2 + (z - h.z) ** 2 > (h.r + 1.5) ** 2) continue;
    const j = h.at.get(Math.round(x - h.x + h.ox) + ':' + gy + ':' +
                       Math.round(z - h.z + h.oz));
    if (j !== undefined && h.slots[j].filled) return true;
  }
  return false;
}
/* 房子的這一根柱子從地面連續疊到第幾層（沒有就 −1）。中間斷掉就不再往上算，
   跟 colTop 同一個道理：斷掉上面那些（門廊的雨遮）是從它底下穿過去的，不是翻過去。 */
function homeColTop(h, x, z) {
  const i = Math.round(x - h.x + h.ox), k = Math.round(z - h.z + h.oz);
  let gy = -1;
  for (;;) {
    const j = h.at.get(i + ':' + (gy + 1) + ':' + k);
    if (j === undefined || !h.slots[j].filled) return gy;
    gy++;
  }
}
/* 往房子上丟一塊要多高（v1.103）。跟地標的 tossPeak 同一套取樣，只是查自己那份格子表。
   沒有這一段的話，往屋子**另一側**那幾格丟的時候，積木是從自己的屋頂穿過去的
   （原本的弧頂是固定公式，完全不看路上有什麼）。
   弧頂下限沿用房子原本那條（1.1，比地標的 1.8 低）：房子矮，抓一樣高會變成拋高球。 */
function homePeak(x0, y0, z0, sl, h) {
  return arcPeak(x0, y0, z0, sl.x, sl.y, sl.z,
                 (x, z) => homeColTop(h, x, z),
                 Math.max(1.1, (sl.y - y0) * 0.45 + 1.1));
}
/* 這一格的某個鄰居（26 鄰接，跟地標的支撐判定同一套）。回傳格子編號或 undefined。 */
function homeNbr(h, s, d) {
  return h.at.get((s.i + d[0]) + ':' + (s.gy + d[1]) + ':' + (s.k + d[2]));
}
/* 占地的外框（v1.103）：把這一間所有格子的世界座標框起來，含門廊與圍籬。
   走路的擋路判定看這個（見 footHome），一次算好放著——每格 ±0.5 是積木的半邊長。 */
/* 只框**還站著的**那些格子（v1.105）。一開始一塊都沒砌，框是空的（x0 > x1，
   任何一點都不在裡面）——蓋起來一格一格長大（見 landHome 的就地擴框），
   被打掉就跟著縮小。整份格子清單去框的話，打成廢墟的房子還是擋著一整塊地，
   人繞著一片空地走（使用者：「換地標建築後小人依然會被破損的小房子卡住」）。 */
function homeBox(h) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const sl of h.slots) {
    if (!sl.filled) continue;
    if (sl.x < x0) x0 = sl.x;
    if (sl.x > x1) x1 = sl.x;
    if (sl.z < z0) z0 = sl.z;
    if (sl.z > z1) z1 = sl.z;
  }
  h.x0 = x0 - 0.5; h.x1 = x1 + 0.5;
  h.z0 = z0 - 0.5; h.z1 = z1 + 0.5;
}
/* 完好時「只靠六個面連不連得到地面」，蓋之前算一次（v1.103）。
   跟藍圖那邊同名的 f6 同一個用途：那是退化偵測的**基準線**，不是支撐判定。
   房子本來就有靠對角勾著的部件（屋脊往內縮一格、煙囪站在屋脊上、雨遮搭在柱子上），
   那些不該因為「只剩對角」被判掉；只有本來六面疊得好好的，被打到剩對角勾著才該掉。 */
function markHomeF6(h) {
  const S = h.slots, st = [];
  for (let i = 0; i < S.length; i++) {
    S[i].f6 = false;
    if (S[i].gy === 0) { S[i].f6 = true; st.push(i); }
  }
  while (st.length) {
    const s = S[st.pop()];
    for (const d of NBR6) {
      const j = homeNbr(h, s, d);
      if (j === undefined || S[j].f6) continue;
      S[j].f6 = true; st.push(j);
    }
  }
}
/* 這一格現在放得上去嗎（v1.102）。地面那一層隨時可以，其他要有鄰居撐著——
   跟地標那邊的 canPlace 擋的是同一件事：建築中被打掉底下幾層時，
   不擋的話小人會把積木砌在半空，下一幀就被垮塌判定打掉，看起來像在做白工。

   蓋好之後（h.done）改用六鄰接（v1.103）。理由是「砌得上去的尺」跟「會不會被判掉的尺」
   必須是同一把：蓋好之後 dropHungHome 那一關開始生效，還用 26 鄰接的話，
   補牆的人會把積木砌在只有對角勾著的位置、下一幀被打下來、那一格又加回工作清單，
   於是他就在同一格上無限做白工。第一次蓋的時候不必嚴（那時 dropHungHome 不判），
   而且完工那一刻整棟都填滿了，六面本來就通（見 markHomeF6）。 */
function canPlaceHome(h, i) {
  const s = h.slots[i];
  if (s.gy === 0) return true;
  const N = h.done ? NBR6 : NBR;
  for (const d of N) {
    const j = homeNbr(h, s, d);
    if (j !== undefined && h.slots[j].filled) return true;
  }
  return false;
}
/* 挑一格來蓋：還沒填、沒人認、而且放得上去。
   anchor 給了就只找它附近（同一趟認的幾格要在一起，見 digBlock）。 */
function homeFree(h, anchor) {
  for (let i = 0; i < h.slots.length; i++) {
    const sl = h.slots[i];
    if (sl.filled || sl.claimed >= 0 || !canPlaceHome(h, i)) continue;
    if (anchor && Math.hypot(sl.x - anchor.x, sl.z - anchor.z) > HOME_REACH) continue;
    return i;
  }
  return -1;
}
/* 房子被打掉一塊之後重算「還連得到地面嗎」，連不到的整組鬆脫掉下來（v1.102，
   使用者：「小房子也要底部拆掉上面一起垮掉（同地標建築邏輯）」）。
   規則跟地標那套（collapseUnsupported）一樣：26 鄰接、從地面那一層往上找連通，
   越高的越晚鬆脫（垮下來才有由下往上的層次）。
   房子不進藍圖的格子表，所以自己算一次——一間最多 300 格，比整棟地標便宜得多。 */
function collapseHome(hi) {
  const h = homes && homes.list[hi];
  if (!h) return 0;
  const S = h.slots, n = S.length;
  const own = homeOwners();
  const drop = i => {
    const k = own.get(hi + ':' + i);
    const b = k === undefined ? null : blocks[k];
    if (!b || b.fallIn > 0) return 0;
    b.fallIn = 0.02 + S[i].gy * 0.012 + Math.random() * 0.06;
    return 1;
  };
  const seen = homeFlood(h, NBR);
  let fell = 0;
  for (let i = 0; i < n; i++) if (S[i].filled && !seen[i]) fell += drop(i);
  return fell + dropHungHome(h, drop);
}
/* 從地面那一層往上，照 N 這組鄰接關係走過所有「已經砌上去」的格子。
   26 鄰接（NBR）是支撐判定用的，六鄰接（NBR6）是退化偵測用的。 */
function homeFlood(h, N) {
  const S = h.slots, n = S.length;
  const seen = new Uint8Array(n);
  const stack = [];
  for (let i = 0; i < n; i++)
    if (S[i].filled && S[i].gy === 0) { seen[i] = 1; stack.push(i); }
  while (stack.length) {
    const s = S[stack.pop()];
    for (const d of N) {
      const j = homeNbr(h, s, d);
      if (j === undefined || seen[j] || !S[j].filled) continue;
      seen[j] = 1; stack.push(j);
    }
  }
  return seen;
}
/* 只剩對角勾著的也要掉（v1.103）。26 鄰接的支撐判定放得很寬——角碰角就算連著，
   所以打穿一面牆之後會留下用一個角吊在半空的積木（屋頂、雨遮最明顯）。
   規則跟地標那邊的 dropHung 一模一樣：基準線是完好時的 f6、判的是整坨不是單塊
   （六面相連的一群彼此黏著，整群都碰不到地面才整群掉）。
   **第一次蓋的時候不判**（h.done 為假）：蓋到一半四處都是還沒補上的鄰居，
   用這麼嚴的尺會把剛砌上去的屋脊一直打下來。 */
function dropHungHome(h, drop) {
  if (!h.done) return 0;
  const S = h.slots, n = S.length;
  const seen = homeFlood(h, NBR6);
  let fell = 0;
  for (let i = 0; i < n; i++) if (S[i].f6 && S[i].filled && !seen[i]) fell += drop(i);
  return fell;
}
/* 有房子被動到就排一次重算（跟 markSupportDirty 同一個道理：一次爆炸打掉幾十塊，
   每一塊都重算一遍是白花的，等塵埃落定再算一次）。 */
let homeDirty = 0;
function markHomeDirty() { homeDirty = 0.06; }
function stepHomeFall(dt) {
  if (homeDirty <= 0) return;
  homeDirty -= dt;
  if (homeDirty > 0) return;
  homeDirty = 0;
  if (!homes) return;
  for (let i = 0; i < homes.list.length; i++) collapseHome(i);
  for (const h of homes.list) homeBox(h);      // 擋路的外框跟著縮（見 homeBox）
  wreckHomes();                                // 剩不到兩成五就整間廢棄
}

/* 這個點在不在某一間房子的地基上。房子不在藍圖的格子表裡（footBlocked 查的是那個），
   所以會走路的東西都得自己避開，不然人會從房子中間穿過去。 */
function homeAt(x, z) {
  return !!footHome(x, z);
}
/* 走路擋不擋：這個位置踩在哪一間房子的占地上（沒有就 null，v1.103）。
   擋的是**房子自己那份格子的外框**（x0/x1/z0/z1，含門廊與圍籬），不是外接圓。
   為什麼是外框而不是「一格一格照牆擋」：牆與圍籬本來就把裡面圍成封閉區，
   只有門口與圍籬缺口一格寬，走進去就出不來——實測改成照牆擋之後，六間房子有
   十幾個人從門口走進屋裡／院子裡，目標在對面、切線閃避只讓他們繞著內牆打轉，
   位移 0、手上抓著三塊石頭，整個村落停在 451／755 格（原本 240 秒蓋完）。
   對走路的東西來說，封閉區就該是實心的，這才是對的形狀。
   為什麼不是外接圓（v1.99～v1.102）：那個圓把方房子外接起來（小院 5×4 帶圍籬
   半徑 6.72、實際半寬只有 4.5），面積差一倍，看過去每間房子外面都空一圈，
   跟使用者要的「不要讓建築一圈都沒人」剛好相反。長條屋差更多（大長屋 128 → 292）。
   一塊都還沒砌、或被拆平了的就不擋——那時候地上什麼都沒有。 */
function footHome(x, z) {
  if (!homes) return null;
  for (const h of homes.list)
    if (x > h.x0 && x < h.x1 && z > h.z0 && z < h.z1) return h;
  return null;
}
const homeFoot = (x, z) => !!footHome(x, z);
/* 踩進去就推出來。煞停不行：貼著邊會原地發抖。
   從**最近的那一面**出去（四面裡穿透最少的那一個方向），所以退出去的路是單向的，
   不會像「沿著屋子中心往外推」那樣把人從屋子另一頭推出去。
   擺在每一種走法的位移之後。 */
function pushOutHome(w) {
  if (w.ghost > 0) return;                            // 穿透中（見 stuckWatch）
  const h = footHome(w.x, w.z);
  if (!h) return;
  const e = 0.02;                    // 剛好推到邊上會被浮點誤差判成還在裡面
  const xl = w.x - h.x0, xr = h.x1 - w.x, zl = w.z - h.z0, zr = h.z1 - w.z;
  const m = Math.min(xl, xr, zl, zr);
  if (m === xl) w.x = h.x0 - e;
  else if (m === xr) w.x = h.x1 + e;
  else if (m === zl) w.z = h.z0 - e;
  else w.z = h.z1 + e;
}
/* 房子擋路就把方向掰到切線上（v1.99 只有閒晃在用，v1.102 抽出來給每一種走法用）。
   回傳的是同一個暫存物件（每幀每個人都會叫，不要每次配置一個新的）。
   只有硬推（pushOutHome）是不夠的：目標在房子另一邊時，人會直直走進去、每幀被推回來，
   看起來是「面向房子原地走路」（使用者回報過兩次）。實測施工中搬料的人有 236 幀
   是這樣貼著人家的牆磨過去的。 */
const _dodge = { x: 0, z: 0 };
function dodgeHome(w, ux, uz) {
  _dodge.x = ux; _dodge.z = uz;
  const h = blockHome(w, ux, uz);
  if (!h) return _dodge;
  const bx = w.x - h.x, bz = w.z - h.z;
  const bd = Math.hypot(bx, bz) || 1;
  const mx = bx / bd, mz = bz / bd;                  // 由房子中心往外
  let sx = -mz, sz = mx;
  if (ux * sx + uz * sz < 0) { sx = mz; sz = -mx; }  // 跟原方向同側的那一條切線
  const k = 1 - (_blk.d - DODGE_STEP) / DODGE_EYE;   // 牆越近掰得越兇
  let nx = ux + (sx - ux) * k, nz = uz + (sz - uz) * k;
  const m = Math.hypot(nx, nz) || 1;
  _dodge.x = nx / m; _dodge.z = nz / m;
  return _dodge;
}
/* 走在 (ux, uz) 這個方向上、快撞到的那一間房子（v1.99；v1.103 改成往前探）。
   沿著要走的方向往前探幾步，第一個踩進占地的那一間就是它——
   以前判的是「進到 h.r + 3 這個圓裡而且還朝著中心走」，那個圓框住整棟房子，
   所以人在離牆三四格外就開始被掰方向，繞出一個比房子大得多的弧。
   探的距離要比一步大（WALK 6.8，一幀約 0.34），不然掰的時候已經踩進去了。 */
const DODGE_EYE = 2.2, DODGE_STEP = 0.55;
const _blk = { d: 0 };
function blockHome(w, ux, uz) {
  if (!homes || w.ghost > 0) return null;             // 穿透中（見 stuckWatch）
  for (let d = DODGE_STEP; d <= DODGE_EYE + 1e-6; d += DODGE_STEP) {
    const h = footHome(w.x + ux * d, w.z + uz * d);
    if (h) { _blk.d = d; return h; }
  }
  return null;
}
/* 這個人是不是「還在蓋」（蓋完了在家附近走走的不算）。聊天要用這個判斷。 */
function homeBusy(w) {
  const h = homes && homes.list[w.hm];
  return !!h && (h.left > 0 || w.load.length > 0);
}
/* 手上這幾塊認走的格子全部放掉。releaseWorker（逃命、被炸飛、換場、換人數）會叫。
   是哪一格記在積木自己身上（b.hk），所以掃一遍手上那疊就好。 */
function homeUnclaim(w) {
  const h = homes && homes.list[w.hm];
  if (!h) return;
  for (const j of w.load) {
    const b = blocks[j.b];
    if (b && b.hh === w.hm && b.hk >= 0 && h.slots[b.hk]) h.slots[b.hk].claimed = -1;
  }
}
/* 一間房子的格子清單。v1.98 重做過外型（v1.97 那版是「開了小洞的方盒子」，
   使用者說「外型不像房子」），v1.99 再加上款式（見 HOME_KIND）。
   讀得出是房子靠這幾件事：

     · 兩層的斜屋頂：第一層鋪滿，第二層沿著短邊縮進一格，於是頂上剩一道屋脊
     · 屋脊上站一根煙囪（v1.97 是站在屋簷的角落上，看起來像多出來的一塊）
     · 兩格高的門（一格高的洞看起來是牆破了，不是門）
     · 跟門垂直的那兩面牆各開一扇窗，離地第二格；牆四層以上再多開一排（＝兩層樓）
     · 長方形的平面（5×3 而不是 5×4）：正方形＋平頂就是箱子
     · 選配：門口的門廊、外面一圈圍籬

   屋頂只做兩層階梯、不做一層一層縮的真斜頂：同樣的塊數（使用者給的上限）
   只蓋得起更小的房子。
   門開在**朝著大建築那一面**：背對著開的話，從鏡頭看過去就只是一面平牆。
   順序是牆一層一層往上 → 屋頂 → 屋脊 → 煙囪 → 門廊 → 圍籬，
   照這個順序砌看起來才是「蓋起來」的（圍籬最後圍，不會擋住自己搬料的路）。 */
function homeSlots(hx, hz, k, pal) {
  const out = [];
  const ox = (k.w - 1) / 2, oz = (k.d - 1) / 2;
  const put = (i, kk, gy, c) =>
    out.push({ x: hx + i - ox, y: gy + HB, z: hz + kk - oz, c, i, k: kk, gy,
               filled: false, claimed: -1 });
  const mi = Math.floor((k.w - 1) / 2), mk = Math.floor((k.d - 1) / 2);
  // 哪一面朝場中心：看房子中心相對場中心是 x 遠還是 z 遠
  const xFace = Math.abs(hx) > Math.abs(hz);
  const door = xFace ? { i: hx > 0 ? 0 : k.w - 1, k: mk }
                     : { i: mi, k: hz > 0 ? 0 : k.d - 1 };
  /* 窗開在跟門垂直的那兩面牆上。牆長 6 格以上開兩扇（三分之一、三分之二處），
     短牆開正中間一扇——長牆只開一扇的話，一面九格的牆看起來是實心的。 */
  const along = xFace ? k.w : k.d;                  // 那兩面牆有多長
  const spots = along >= 6 ? [Math.floor(along / 3), Math.floor(along * 2 / 3)]
                           : [Math.floor((along - 1) / 2)];
  const win = [];
  for (const q of spots) {
    if (xFace) { win.push({ i: q, k: 0 }); win.push({ i: q, k: k.d - 1 }); }
    else { win.push({ i: 0, k: q }); win.push({ i: k.w - 1, k: q }); }
  }
  /* 每隔一層開一排（1、3、5…）。不另外把「最上面那一層」也算進來：
     牆高 3 的房子那就是 1 跟 2 兩排黏在一起，兩排窗戶黏成一個大洞。 */
  const winRow = gy => gy % 2 === 1;
  const isWin = (i, kk, gy) => winRow(gy) && win.some(q => q.i === i && q.k === kk);
  /* 腰線：五層以上在半高處把整圈牆換成屋頂色，看得出是兩三層樓而不是一面高牆。
     不多花積木——那一圈牆本來就要砌。 */
  const belt = k.h >= 5 ? Math.floor(k.h / 2) : -1;
  /* 牆要照「沿著周長跑一圈」的順序生，不是一排一排掃（v1.100）。
     一排一排掃的話，i 固定、kk 只取 0 跟 d−1 兩個值——連號的兩格會落在**屋子兩側的
     長牆上**，而小人是照順序認格子的，於是一趟一趟在房子兩頭來回繞
     （實測三成六的時間花在「走回去砌」的路上）。沿周長生的話，連號就是真的相鄰。 */
  const ring = [];
  for (let i = 0; i < k.w; i++) ring.push([i, 0]);
  for (let kk = 1; kk < k.d; kk++) ring.push([k.w - 1, kk]);
  for (let i = k.w - 2; i >= 0; i--) ring.push([i, k.d - 1]);
  for (let kk = k.d - 2; kk >= 1; kk--) ring.push([0, kk]);
  for (let gy = 0; gy < k.h; gy++)
    for (const [i, kk] of ring) {
      if (i === door.i && kk === door.k) continue;                      // 門（整面兩格高）
      if (isWin(i, kk, gy)) continue;                                   // 窗
      put(i, kk, gy, gy === belt ? pal[1] : pal[0]);
    }
  /* 屋頂與屋脊照蛇行（一排掃到底、下一排倒著回來）：一律從同一頭開始的話，
     每換一排就要從屋子這頭走到那頭。 */
  for (let i = 0; i < k.w; i++)
    for (let n = 0; n < k.d; n++) {
      const kk = i % 2 ? k.d - 1 - n : n;
      put(i, kk, k.h, pal[1]);                                           // 屋頂第一層
    }
  for (let i = 0; i < k.w; i++)
    for (let n = 1; n < k.d - 1; n++) {
      const kk = i % 2 ? k.d - 1 - n : n;
      put(i, kk, k.h + 1, pal[1]);                                       // 屋脊
    }
  put(0, mk, k.h + 2, pal[2]);                                           // 煙囪
  /* 門廊：門外那一格的左右兩根柱子（兩格高）＋ 上面一片三格的雨遮。
     柱子不擺在門正前方——那樣就把門堵住了。 */
  const oi = door.i === 0 ? -1 : door.i === k.w - 1 ? 1 : 0;
  const ok = door.k === 0 ? -1 : door.k === k.d - 1 ? 1 : 0;
  if (k.porch) {
    const ai = ok ? 1 : 0, ak = oi ? 1 : 0;              // 沿著牆的方向
    for (const sgn of [-1, 1]) {
      put(door.i + oi + ai * sgn, door.k + ok + ak * sgn, 0, pal[0]);
      put(door.i + oi + ai * sgn, door.k + ok + ak * sgn, 1, pal[0]);
    }
    for (const sgn of [-1, 0, 1])
      put(door.i + oi + ai * sgn, door.k + ok + ak * sgn, 2, pal[1]);
  }
  /* 圍籬：外面兩格的一圈，只有一層高，門那一側留一格出入口。
     用屋頂的顏色，看起來是同一戶人家的。 */
  if (k.fence) {
    for (let i = -2; i < k.w + 2; i++)
      for (let kk = -2; kk < k.d + 2; kk++) {
        const edge = i === -2 || i === k.w + 1 || kk === -2 || kk === k.d + 1;
        if (!edge) continue;
        if (i === door.i + oi * 2 && kk === door.k + ok * 2) continue;    // 出入口
        put(i, kk, 0, pal[1]);
      }
  }
  return out;
}
/* 找一塊空地：從這一組人現在站的方位往外找，避開已經蓋好的房子與樹。
   找不到就回 null（那一組人就照常閒晃，不硬塞）。 */
function pickHomeSite(cx, cz, rad) {
  const base = Math.atan2(cz, cx);
  for (let t = 0; t < 40; t++) {
    /* 內緣要把自己的地基半徑加進去（v1.100）：房子大了（最寬 12 格、地基半徑 9.6），
       只算中心的話整棟會壓進工地，下一座一開工就被徵收。 */
    const lo = siteR + HOME_NEAR + rad;
    const a = base + rr(-HOME_ARC, HOME_ARC), r = rr(lo, Math.max(lo + 4, homeOut()));
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    let ok = true;
    /* 隔多遠：至少 HOME_GAP，而且兩家的地基不能碰到（v1.99 起有圍籬大屋，
       地基半徑 6.7——固定 12 的話兩間會疊在一起）。 */
    for (const h of homes.list)
      if ((h.x - x) ** 2 + (h.z - z) ** 2 <
          Math.max(HOME_GAP, h.r + rad + 3) ** 2) { ok = false; break; }
    if (ok) for (const t2 of trees)
      if ((t2.x - x) ** 2 + (t2.z - z) ** 2 < (HOME_TREE + t2.r) ** 2) { ok = false; break; }
    if (ok) return { x, z };
  }
  return null;
}
/* 還沒蓋完的房子裡離這一組人最近的那一間（v1.103）。回傳 −1＝沒有可接手的。
   h.left > 0 有兩種來源：上一輪蓋到一半就開下一座（stopHomes 把每個人的 hm 清掉了），
   或是蓋好之後被砸出洞（freeBlock 把那一格加回 h.left）。以前這裡一律開新的一間，
   所以這兩種都永遠沒人管——實測「蓋一半換場、下一輪再閒晃」的房子停在半棟不動。
   taken 是這一次分派已經給人的，一間一組就好，其餘的人去開新的。
   **不能改成「都有人了就疊到同一間」**：這一輪剛開的新房子也是「還沒蓋完」，
   於是第二組之後全部併進第一間，一輪只蓋得出一間（實測 20 人 10 個離隊只蓋 1 間）。
   間數比組數多的時候會有一兩間排到下一輪，那是排隊、不是沒人管。 */
function pickUnfinished(cx, cz, taken) {
  let best = -1, bd = Infinity;
  for (let i = 0; i < homes.list.length; i++) {
    const h = homes.list[i];
    if (h.left <= 0 || taken.has(i)) continue;
    const d = (h.x - cx) ** 2 + (h.z - cz) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
function startHomes() {
  if (!homes) homes = { list: [] };
  const taken = new Set();
  const steady = w => !(w.air || w.burn > 0 || w.flee > 0 || w.fall > 0);
  /* 已經有家的人不再蓋新的（v1.109，使用者：「已經有房子的小人不用再蓋小房子，
     不然會越來越多間」）。不擋的話每一輪都有一半的人離隊開新的一間，
     村子會一輪一輪長下去，最後整片草地都是房子。
     家沒了才重新算成沒家——打爛到廢棄（wreckHomes）、被下一座工地徵收
     （clearHomesInSite）之後那個 id 就不在清單上了，他可以再蓋一間。 */
  const live = new Set();
  for (const h of homes.list) live.add(h.id);
  for (const w of workers) if (w.own >= 0 && !live.has(w.own)) w.own = -1;
  /* 自己家還缺格子的先回去補（被砸出洞、上一輪沒蓋完），而且**標進 taken**：
     那一間有主人在顧了，沒家的人就別再插一腳，去蓋自己的。
     試過反過來（不標，讓沒家的人也來接手）：那些人變成現成房子的共同主人、
     從此不再蓋新的，實測村子從 6 間一路縮到 3 間、20 個人全擠在那 3 間上，
     再也不長了——使用者要的是「不要越來越多間」，不是「不要有新的」。 */
  for (const w of workers) {
    if (w.own < 0 || !steady(w)) continue;
    const hi = homes.list.findIndex(h => h.id === w.own);
    if (hi < 0 || homes.list[hi].left <= 0) continue;
    releaseWorker(w);
    w.hm = hi; w.hst = ''; w.pause = 0;
    taken.add(hi);
  }
  /* 誰離隊：從**還沒有家**又站得穩的人裡抽大約一半。工程師與魔法師照樣抽得到——
     沒在施工的時候他們就是普通人（圖跟法杖只在施工那條路上畫）。 */
  const pool = [];
  for (let i = 0; i < workers.length; i++) {
    const w = workers[i];
    if (!steady(w) || w.own >= 0) continue;
    pool.push(i);
  }
  for (let i = pool.length - 1; i > 0; i--) {          // 洗牌
    const j = Math.floor(Math.random() * (i + 1));
    const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
  }
  const left = pool.slice(0, Math.max(1, Math.round(pool.length * HOME_PART)));
  while (left.length) {
    const lead = workers[left.shift()];
    /* 附近的人一起蓋（使用者：「也可以跟附近的小人一起合蓋大一點的小房子」）。
       比的是現在站的位置——慶祝剛散場，所以「附近」就是圈上的鄰居。 */
    const crew = [lead];
    for (let i = left.length - 1; i >= 0 && crew.length < HOME_TEAM; i--) {
      const o = workers[left[i]];
      if ((o.x - lead.x) ** 2 + (o.z - lead.z) ** 2 > HOME_NEARBY * HOME_NEARBY) continue;
      crew.push(o); left.splice(i, 1);
    }
    let cx = 0, cz = 0;
    for (const w of crew) { cx += w.x; cz += w.z; }
    cx /= crew.length; cz /= crew.length;
    // 有沒有蓋不完的／破了洞的可以接手（見 pickUnfinished）。先修舊的再蓋新的
    let hi = pickUnfinished(cx, cz, taken);
    if (hi >= 0) {
      /* 上一批人留下的認領要清掉：他們的 hm 早就被 stopHomes 抹了，
         那些格子沒人會去砌，留著的話 homeFree 會一直跳過它們，這間永遠差幾格。 */
      for (const sl of homes.list[hi].slots) if (!sl.filled) sl.claimed = -1;
    } else {
      // 款式要先挑：間距看的是兩家地基的大小（見 pickHomeSite）
      const kind = pickHomeKind(crew.length);
      const spot = pickHomeSite(cx, cz, homeR(kind));
      if (!spot) continue;                             // 沒空地了，這一組就照常閒晃
      const pal = HOME_PAL[Math.floor(Math.random() * HOME_PAL.length)];
      const slots = homeSlots(spot.x, spot.z, kind, pal);
      /* at 是「格子座標 → 第幾格」的表，垮塌、火勢蔓延、放不放得上去都要查它。
         鍵用房子自己的格座標（i／gy／k），所以圍籬與門廊那些負的座標也放得進去。 */
      const at = new Map();
      slots.forEach((sl, i) => at.set(sl.i + ':' + sl.gy + ':' + sl.k, i));
      const h = { id: homeSeq++, x: spot.x, z: spot.z, r: homeR(kind), kind: kind.id, at,
                  ox: (kind.w - 1) / 2, oz: (kind.d - 1) / 2,    // 見 homeSolid
                  slots, left: slots.length, n: crew.length,
                  done: false };          // 蓋好過一次了嗎（見 dropHungHome）
      homeBox(h);                          // 走路擋不擋看這個外框（見 footHome）
      markHomeF6(h);                       // 退化偵測的基準線，趁完好時算
      homes.list.push(h);
      hi = homes.list.length - 1;
    }
    taken.add(hi);
    for (const w of crew) {
      releaseWorker(w);                                // 手上的建材先放掉，這趟不是上工
      w.hm = hi; w.hst = ''; w.pause = 0;
      w.own = homes.list[hi].id;                       // 從現在起這是他家（v1.109）
    }
  }
}
function stopHomes() {
  for (const w of workers) {
    if (w.hm < 0) continue;
    releaseWorker(w);                 // 挖出來還在手上的那塊掉回地上，變成一般碎料
    w.hm = -1; w.hst = '';
  }
}
/* 新工地蓋到房子身上的話，那一間解成碎料。房子本來是留著不收的（使用者指定），
   但下一座的 siteR 可能比這一間還遠——留著就會跟新建築長在同一個位置。
   解成碎料剛好接回原本的流程：那些塊變成 FREE，整地的推土機把它們推出工地，
   小人再撿去蓋新的那一座（等於「你家被徵收了」）。
   索引會變，所以積木的 hh 跟小人的 hm 要一起重編。 */
function clearHomesInSite() {
  const r = siteR + KEEP;
  dropHomes(h => Math.hypot(h.x, h.z) - h.r > r);
}
/* 把不要的那幾間解成碎料，其餘重編索引。keep(h) 回傳 true 就留著，回傳解掉了幾間。
   索引會變，所以積木的 hh、**還在飛的那些的 arc.hm**、以及小人的 hm 都要一起重編。
   （v1.105 從 clearHomesInSite 抽出來共用：打成廢墟被廢棄的那些也走這條。
   換場那條路上所有人早就 releaseWorker 過、arc 也清光了，所以以前不必管這兩樣。） */
function dropHomes(keep) {
  if (!homes || !homes.list.length) return 0;
  const map = [], list = [];
  for (const h of homes.list) {
    const ok = keep(h);
    map.push(ok ? list.length : -1);
    if (ok) list.push(h);
  }
  const gone = homes.list.length - list.length;
  if (!gone) return 0;
  // 手上還抓著那幾間的積木的人先放掉，不然那幾塊會在他手上變成碎料
  for (const w of workers) if (w.hm >= 0 && map[w.hm] < 0) releaseWorker(w);
  for (const b of blocks) {
    if (b.hh < 0) continue;
    const to = map[b.hh];
    if (to >= 0) {
      b.hh = to;
      if (b.arc && b.arc.hm !== undefined) b.arc.hm = to;
      continue;
    }
    b.hh = -1; b.hk = -1;
    b.slot = -1; b.holder = -1; b.arc = null; b.scale = 1; b.fallIn = 0;
    b.st = FLY; b.rest = false; b.snap = 0;
    b.tr = 0.80; b.tg = 0.76; b.tb = 0.68;               // 變回一般建材的顏色
    b.vx = rr(-3, 3); b.vy = rr(1, 4); b.vz = rr(-3, 3);
    b.ax = rr(-5, 5); b.ay = rr(-5, 5); b.az = rr(-5, 5);
  }
  for (const w of workers) w.hm = w.hm >= 0 ? map[w.hm] : -1;
  homes.list = list;
  return gone;
}
/* 打到剩不到兩成五就整間廢棄，解成碎料（v1.105，使用者：「小房子被破壞剩下 25%
   比照地標建築直接被破壞廢棄」）。門檻用地標那條同一個 WRECK_AT。
   只算**蓋好過一次的**（h.done）：第一次蓋本來就是從 0 長起來的，不然一開工就被廢棄。
   廢棄的好處是連鎖的：那塊地不再擋路，倒在裡面撿不到的碎料也一起變成撿得到的料。 */
const wrecked = h => h.done && h.slots.length - h.left < h.slots.length * WRECK_AT;
function wreckHomes() {
  if (!homes) return 0;
  for (const h of homes.list) if (wrecked(h)) return dropHomes(q => !wrecked(q));
  return 0;
}
/* 挖土那一撮塵。用塵霧那個池子（跟彩帶一樣），顏色調成土色。 */
function digPuff(w) {
  if (dust.length > 460) return;
  const a = Math.random() * Math.PI * 2, sp = rr(0.8, 2.6);
  dust.push({
    x: w.x + rr(-0.3, 0.3), y: 0.2, z: w.z + rr(-0.3, 0.3),
    vx: Math.cos(a) * sp, vy: rr(1.4, 3.4), vz: Math.sin(a) * sp,
    rx: Math.random() * 6, ry: Math.random() * 6,
    life: rr(0.35, 0.7), s: rr(0.14, 0.3),
    cr: 0.52, cg: 0.40, cb: 0.28
  });
}
/* 這一趟去哪裡挖。每一趟重挑：一直挖同一個坑的話，人會黏在那個點上不動。
   不挖工地裡（那是別人的建材場，而且他會被 strollTo 推出來）、不挖在人家屋子裡。 */
function digSpot(w, h) {
  /* 挖的地方取在「他現在站的那一側」，不是整圈亂挑（v1.100）。
     房子大了之後（地基半徑可以到 9.6），亂挑的話一趟裡「走去挖」跟「走回去砌」
     常常在房子的兩頭，而繞過去就是半圈——實測六成的時間花在走路上。
     同一側就只是幾步；砌的位置自己會隨格子進度繞房子跑，挖料點跟著他跑就好。 */
  const a0 = Math.atan2(w.z - h.z, w.x - h.x);
  for (let t = 0; t < 20; t++) {
    const a = a0 + rr(-DIG_ARC, DIG_ARC), d = h.r + rr(DIG_NEAR, DIG_FAR);
    const x = h.x + Math.cos(a) * d, z = h.z + Math.sin(a) * d;
    if (Math.hypot(x, z) < siteR + KEEP) continue;
    if (homeAt(x, z)) continue;
    w.tx = x; w.tz = z; w.hdt = DIG_T; return;
  }
  w.tx = h.x + h.r + DIG_NEAR; w.tz = h.z; w.hdt = DIG_T;
}
/* 挖出一塊來放到手上（就近從地面挖，使用者指定）。回傳「挖到了沒有」。
   積木是**新生出來的**，不是從料池拿的——完工那一刻場上通常一塊散料都沒有
   （料池 = 藍圖格數，見 reconcilePool），從料池拿等於把下一座的建材偷走。
   認的格子是清單上「還沒人認」的第一格，所以一趟認到的幾格是連號的——
   而格子是照砌的順序生出來的（一層一層、一排一排），連號就等於彼此在旁邊，
   站定之後從同一個位置丟得到（跟工人一趟領幾格是同一個道理）。 */
function digBlock(w, wi, h) {
  const a0 = w.load.length ? blocks[w.load[0].b] : null;
  const anchor = a0 && a0.hh === w.hm ? h.slots[a0.hk] : null;
  /* 同一趟認的幾格要在一起（隔不到 HOME_REACH，見 homeFree）。格子是照砌的順序生出來的
     （一層一層、一排一排），所以連號多半就在旁邊——但一排的尾跟下一排的頭在房子兩頭。
     不限的話，他會為了手上的第二塊再繞半圈房子（實測整體反而慢三成）。 */
  const k = homeFree(h, anchor);
  if (k < 0 || blocks.length >= ENG.MAXB) return false;   // 都被同組認走了／池子滿了
  const b = newBlock();
  b.x = w.x; b.z = w.z; b.y = HB;
  b.st = CARRY; b.rest = false; b.holder = wi; b.hh = w.hm; b.hk = k;
  const c = h.slots[k].c;
  b.r = b.tr = c[0]; b.g = b.tg = c[1]; b.b = b.tb = c[2];
  blocks.push(b);
  h.slots[k].claimed = wi;
  /* 借工作單那份欄位裝（s 給 −1＝不占藍圖的格子）：這樣「舉在手上的高度」
     （carryPose）、逃命與被炸飛時的脫手（releaseWorker／dropJob）全部是現成的。
     是哪一間的哪一格記在積木自己身上（b.hh／b.hk），不必再開一份清單。 */
  w.load.push({ b: blocks.length - 1, s: -1 });
  w.carry = true;
  spawnMark({ x: w.x, y: 0, z: w.z }, DIG_MARK, 1);      // 挖過的土痕（跟隕石坑同一套）
  digPuff(w); digPuff(w); digPuff(w);
  ENG.setBlockCount(blocks.length);
  return true;
}
/* 砌上去：把手上第一塊丟到它自己認的那一格，跟工人丟積木同一套拋物線，
   只是落定走 landHome。手上還有的就下一輪再丟（見 LAY_GAP）。 */
function layHome(w, h) {
  const j = w.load[0];
  const b = j && blocks[j.b];
  const sl = b && b.hh === w.hm ? h.slots[b.hk] : null;
  if (!b || b.st !== CARRY || !sl) { if (j) dropJob(w, 0); return; }
  w.a = Math.atan2(sl.x - w.x, sl.z - w.z);
  b.st = TOSS; b.rest = false;
  b.arc = {
    t: 0, dur: 0.3 + Math.hypot(sl.x - b.x, sl.z - b.z) * 0.02 + sl.y * 0.012,
    x0: b.x, y0: b.y, z0: b.z, x1: sl.x, y1: sl.y, z1: sl.z,
    peak: homePeak(b.x, b.y, b.z, sl, h),
    hm: w.hm, hk: b.hk
  };
  b.holder = -1;
  w.load.shift();
  if (!w.load.length) w.carry = false;
  carryPose(w);                     // 剩下那疊要馬上往下遞補一格
}
/* 家的那一塊落定。跟藍圖那條分開：沒有支撐計算、不動 placedCnt、不算進「累計搬運」
   （那是幫地標搬的量）。 */
function landHome(b, a) {
  const h = homes && homes.list[a.hm];
  const sl = h && h.slots[a.hk];
  b.arc = null;
  if (!sl) { freeBlock(b); b.vy = 1.5; return; }         // 那一間已經不在了
  /* 飛的這一秒裡撐著它的鄰居可能被打掉了（玩家正在砸這間房子）：那就別擺上去，
     當碎料掉下來——擺上去的話下一幀就被垮塌判定打掉，看起來像砌在半空。
     跟地標那條一樣（見 stepToss 的 canPlace）。 */
  if (!canPlaceHome(h, a.hk)) { sl.claimed = -1; freeBlock(b); b.vy = 1.5; return; }
  b.st = SET; b.rest = true;
  b.x = a.x1; b.y = a.y1; b.z = a.z1;
  b.rx = b.ry = b.rz = 0;
  b.scale = 1.22;                                       // 落定彈一下
  b.hh = a.hm; b.hk = a.hk;
  sl.filled = true; sl.claimed = -1;
  h.left--;
  // 擋路的外框跟著長（見 homeBox）。就地擴一格就好，不必整份重算
  if (sl.x - 0.5 < h.x0) h.x0 = sl.x - 0.5;
  if (sl.x + 0.5 > h.x1) h.x1 = sl.x + 0.5;
  if (sl.z - 0.5 < h.z0) h.z0 = sl.z - 0.5;
  if (sl.z + 0.5 > h.z1) h.z1 = sl.z + 0.5;
  /* 蓋好過一次了。這個旗標一旦立起來就不收回去（被砸出洞、補回去都還算「蓋好過」）：
     它管的是「要不要用完好時的標準判退化」，見 dropHungHome 與 canPlaceHome。 */
  if (h.left <= 0) h.done = true;
  sndPlace();
}
/* 蓋完就在自己家附近走走（使用者的規格）。跟一般閒晃同一套（會發呆、走近了會聊天），
   只是目標點以自己的房子為中心，不是以工地為中心。 */
function liveSpot(w, h) {
  for (let t = 0; t < 12; t++) {
    const a = rr(0, Math.PI * 2), d = rr(h.r + HOME_STAND, h.r + LIVE_R);
    const x = h.x + Math.cos(a) * d, z = h.z + Math.sin(a) * d;
    if (t < 11 && homeAt(x, z)) continue;
    w.tx = x; w.tz = z; return;
  }
}
function liveHome(w, h, dt) {
  /* 剛從「蓋」切到「住」的那一刻，目標點可能還是上一份工作留下的——挖料的坑，
     或者（房子被同組的人蓋完、他一塊都沒搬到時）事件開始前的閒晃點，
     那個可能在工地的另一邊（實測有人因此先走了 46 格才回家）。離家太遠就先重挑。 */
  if (Math.hypot(w.tx - h.x, w.tz - h.z) > h.r + LIVE_R) liveSpot(w, h);
  if (w.pause > 0) { w.pause -= dt; w.gait += (0 - w.gait) * Math.min(1, dt * 8); return; }
  if (!strollTo(w, dt)) return;
  strollPause(w);
  liveSpot(w, h);
}
/* 這一幀的「蓋自己的家」。跟魔法師一樣是一條自己的路，不走 idle／pick／build 那套——
   那一套的格子與建材全看 bp（findSlot／loadUp／standPos）。
   一趟是「走去挖 → 挖到手上滿了 → 走回房子 → 站定原地丟完」，丟完再走下一趟。
   **挖那一段要排在「手上有貨」前面**：反過來的話，挖到第一塊的下一幀就被叫去砌，
   一趟永遠只搬一塊（實測 carryMax 卡在 1，等於白做）。
   **每一種人都用自己的方式蓋**（使用者指定）：魔法師隔空拋（castTrip，v1.102）、
   肌肉小人就地掄（hurlTrip，v1.115）；他們在工地是什麼樣子，回自己家就是什麼樣子。 */
function updHome(w, wi, dt) {
  const h = homes && homes.list[w.hm];
  if (!h) { w.hm = -1; return; }                        // 那一間被徵收了：回去閒晃
  /* 蓋完了就換「住」那條路——**這一條要排在挖料前面**。反過來的話，最後一塊落定那一刻
     還在挖料途中的人會把那一趟走完才回家；而他手上的目標點可能是聊完天時挑的閒晃點
     （idleSpot 取在工地外圈那一環），於是他會走到工地那邊去——實測有人跑到離自己家
     38 格遠。手上還有貨的例外：那幾格還算在 h.left 裡，所以這裡不會擋到砌完最後幾塊。 */
  if (h.left <= 0 && !w.load.length) {
    w.hst = '';
    liveHome(w, h, dt);
    return;
  }
  if (w.mage) { castTrip(w, wi, h, dt); return; }         // 魔法師隔空蓋（v1.102）
  if (w.hst === 'grab') { grabTrip(w, wi, h, dt); return; }
  if (w.hst === 'dig') { digTrip(w, wi, h, dt); return; }
  // 手上有貨：一般工人走回去砌，肌肉小人站在原地掄（v1.115）
  if (w.load.length) { (w.mus ? hurlTrip : layTrip)(w, h, dt); return; }
  // 肌肉小人扔完喘那一下（同工地的 MUS_REST），喘完才開下一趟
  if (w.mus && w.ct > 0) { w.ct -= dt; w.gait += (0 - w.gait) * Math.min(1, dt * 8); return; }
  w.hcap = w.mus ? 1 : Math.round(rr(HOME_CARRY[0], HOME_CARRY[1]));   // 這一趟要拿幾塊
  startTrip(w, h);                                        // 開下一趟：先撿地上的，沒有才挖
}
/* 開一趟料。**地上的碎料優先**（v1.104，使用者指定）：房子蓋一半被拆掉會留下一地自己的
   碎料，那些就該撿回去用，而不是視而不見再從地上挖新的。撿不到才挖。 */
function startTrip(w, h) {
  const i = freeNearHome(w, h);
  if (i >= 0) { w.gb = i; w.hst = 'grab'; w.hdt = 0; return; }
  digSpot(w, h);
  w.hst = 'dig';
}
/* 魔法師蓋自己的家（v1.102，使用者：「魔法師小人 要用魔法師的方式蓋小房子」）。
   他不挖也不搬：站在自己家旁邊舉著杖，把腳邊的地面拉出一塊、直接隔空拋到格子上，
   節拍跟他在工地發料一樣（MAGE_GAP），飛的也是那條又慢又高的弧線。
   站位跟著「下一格在哪一邊」跑，所以他會繞著房子慢慢移動、面向自己在蓋的那一面。 */
const MAGE_HOME = 2.6;              // 站得離地基邊緣多遠（工人是 HOME_STAND 1.4）
function castTrip(w, wi, h, dt) {
  mageTrail(w, dt);
  const k = homeFree(h);
  if (k < 0) {                                          // 都被同組認走了：站著等
    if (w.fly.length) castPose(w, dt, 1);
    w.gait += (0 - w.gait) * Math.min(1, dt * 8);
    w.ct = MAGE_GAP;
    return;
  }
  const sl = h.slots[k];
  /* 這一發要用哪一塊料。**地上的碎料優先**（v1.106，跟工人同一條規則）：
     認定一塊（w.gb）就不放，走到它旁邊再拋；地上沒有才從地面拉新的出來。
     不認定、每幀重挑的話會來回震盪：走到搆得到的那一刻，目標又跳回屋子旁邊的站位，
     於是他在兩點之間來回、永遠沒有「站定」那一刻，一發都拋不出去
     （實測 600 秒只砌 1 塊）。不撿的話則是站在原地把新的變出來
     （實測一間 75 格的破洞旁邊躺著 74 塊碎料，他一塊沒用、憑空生了 72 塊）。 */
  let b = mageBlock(w);
  if (!b) { w.gb = freeNearHome(w, h); b = mageBlock(w); }
  if (b) {
    // 倒在房子占地裡的要站到框外（同 grabTrip），不然走進去只會被推出來
    const g = pickSpot(b);
    w.tx = g.x; w.tz = g.z;
  } else {
    /* 站位：從屋子中心往那一格的方向推到地基外（跟工人同一套，見 layTrip 的說明）。 */
    let dx = sl.x - h.x, dz = sl.z - h.z;
    let d = Math.hypot(dx, dz);
    if (d < 0.001) { dx = w.x - h.x; dz = w.z - h.z; d = Math.hypot(dx, dz) || 1; }
    w.tx = h.x + dx / d * (h.r + MAGE_HOME); w.tz = h.z + dz / d * (h.r + MAGE_HOME);
  }
  const leg = w.leg;                                    // 上工的路不算閒晃里程
  const walking = !strollTo(w, dt);
  w.leg = leg;
  if (walking) { w.ct = MAGE_GAP; return; }             // 蓄力從站定才開始算
  w.gait += (0 - w.gait) * Math.min(1, dt * 8);
  w.a = Math.atan2(sl.x - w.x, sl.z - w.z);             // 面向要砌的那一格
  castPose(w, dt, 1);
  w.ct -= dt;
  if (w.ct <= 0) { w.ct = MAGE_GAP; castHome(w, wi, h, k); }
}
/* 出手：從腳邊的地面拉一塊出來，直接進拋物線飛到那一格（不經過 CARRY）。 */
/* 魔法師這一發認定的那一塊料還在不在（v1.106）：還躺在地上、沒被別人拿走。
   挑是用工人那條同一份 freeNearHome（所以倒在自己家占地裡的也算），
   認定之後就記在 w.gb 上不再重挑（見 castTrip）。 */
function mageBlock(w) {
  const b = w.gb >= 0 ? blocks[w.gb] : null;
  return b && b.st === FREE && b.rest && b.holder < 0 ? b : null;
}
function castHome(w, wi, h, k) {
  const sl = h.slots[k];
  /* 地上的碎料優先（v1.104）：認定的那一塊搆得到就吸起來，搆不到才從地面拉新的出來。
     搆多遠沿用他在工地發料的那個範圍（MAGE_REACH）。 */
  const has = mageBlock(w);
  let bi = has && (has.x - w.x) ** 2 + (has.z - w.z) ** 2 <= MAGE_REACH * MAGE_REACH
           ? w.gb : -1;
  let b;
  if (bi >= 0) {
    b = blocks[bi];
    w.gb = -1;                                          // 用掉了，下一發重挑
    douse(b);
    if (b.cell) gridDel(b);
    b.tr = sl.c[0]; b.tg = sl.c[1]; b.tb = sl.c[2];     // 顏色慢慢變過去（撿回來重新用的料）
    b.snap = 0; b.scale = 1; b.wet = 0;
    b.hh = w.hm; b.hk = k;
  } else {
    if (blocks.length >= ENG.MAXB) return false;
    const a = rr(0, Math.PI * 2), d = rr(0.9, 1.9);
    b = newBlock();
    b.x = w.x + Math.cos(a) * d; b.z = w.z + Math.sin(a) * d; b.y = HB;
    b.hh = w.hm; b.hk = k;
    b.r = b.tr = sl.c[0]; b.g = b.tg = sl.c[1]; b.b = b.tb = sl.c[2];
    blocks.push(b);
    bi = blocks.length - 1;
    spawnMark({ x: b.x, y: 0, z: b.z }, DIG_MARK, 1);   // 地上留一個拉走積木的痕
  }
  b.st = TOSS; b.rest = false;
  b.arc = {
    t: 0,
    dur: MAGE_DUR0 + Math.hypot(sl.x - b.x, sl.z - b.z) * MAGE_DUR_D + sl.y * MAGE_DUR_Y,
    x0: b.x, y0: b.y, z0: b.z, x1: sl.x, y1: sl.y, z1: sl.z,
    peak: homePeak(b.x, b.y, b.z, sl, h) + MAGE_LIFT,
    mage: 1, hm: w.hm, hk: k
  };
  sl.claimed = wi;                                      // 飛到之前先占著，別人不要再認
  w.fly.push({ b: bi, s: -1 });                         // s < 0＝家的那些（見 mageTrail）
  digPuff(w); digPuff(w);
  const tip = staffTip(w);
  spawnStars(tip.x, tip.z, tip.y, 0.5, 2, MAGE_STAR);
  fxRings.push({ x: w.x, z: w.z, y: 0.14, r: 0.5, vr: 2.2, op: 0.42, fade: 0.7,
                 c: 0xff8ec4, add: 1, spin: rr(0, 6.28) });
  ENG.setBlockCount(blocks.length);
  return true;
}

const GRAB_R = 12;                  // 找碎料的範圍：離自己家外框這麼遠以內
/* 家附近地上躺著的碎料裡離他最近的那一塊（沒有就 −1，v1.104）。
   條件跟工人撿料那條一樣（FREE、落定了、沒人拿），兩個不撿：在工地裡的（那是地標的
   料場，而且要走進建築裡）、離自己家太遠的（走過去比挖還久）。
   **倒在房子占地裡的照撿**（v1.105 自己家、v1.107 連別人家）：站在外框旁邊伸手拿就好
   （見 pickSpot／grabStand），跟 layTrip 站在框外往裡丟是同一套。
   不撿的話，砸爛一間房子的碎料有將近四成躺在自己的地基上（實測 458 塊裡 173 塊），
   使用者看到的就是「一地碎料還在挖新的」。 */
function freeNearHome(w, h) {
  let best = -1, bd = Infinity;
  const lim = (h.r + GRAB_R) ** 2, site = (siteR + KEEP) ** 2;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.st !== FREE || !b.rest || b.holder >= 0) continue;
    if ((b.x - h.x) ** 2 + (b.z - h.z) ** 2 > lim) continue;
    if (b.x * b.x + b.z * b.z < site) continue;
    const d = (b.x - w.x) ** 2 + (b.z - w.z) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
/* 要去撿的那一塊躺在自己家的外框裡：站到**最近的那一面**外面伸手拿。
   回傳同一個暫存物件（每幀都會叫）。 */
const _gs = { x: 0, z: 0 };
function grabStand(h, bx, bz) {
  _gs.x = bx; _gs.z = bz;
  const xl = bx - h.x0, xr = h.x1 - bx, zl = bz - h.z0, zr = h.z1 - bz;
  const m = Math.min(xl, xr, zl, zr);
  if (m === xl) _gs.x = h.x0 - HOME_STAND;
  else if (m === xr) _gs.x = h.x1 + HOME_STAND;
  else if (m === zl) _gs.z = h.z0 - HOME_STAND;
  else _gs.z = h.z1 + HOME_STAND;
  return _gs;
}
/* 把地上這一塊收成「自己家的第 k 格」。跟 digBlock 的差別只有兩件事：
   積木是現成的（不 newBlock、不留土痕、不噴土），而且顏色是**慢慢**變過去的
   （只設目標色，讓它自己 lerp）——那是一塊撿回來重新用的料，不是憑空長出來的。 */
function takeHomeBlock(w, wi, h, i) {
  const b = blocks[i];
  if (!b || b.st !== FREE || b.holder >= 0) return false;
  const a0 = w.load.length ? blocks[w.load[0].b] : null;
  const anchor = a0 && a0.hh === w.hm ? h.slots[a0.hk] : null;
  const k = homeFree(h, anchor);
  if (k < 0) return false;
  douse(b);                                             // 還在燒的先熄掉（同工人撿料）
  if (b.cell) gridDel(b);
  b.st = CARRY; b.rest = false; b.holder = wi; b.hh = w.hm; b.hk = k;
  b.snap = 0; b.arc = null; b.scale = 1; b.wet = 0;
  const c = h.slots[k].c;
  b.tr = c[0]; b.tg = c[1]; b.tb = c[2];
  h.slots[k].claimed = wi;
  w.load.push({ b: i, s: -1 });
  w.carry = true;
  return true;
}
/* 走去撿、撿到手上滿了。撿不到就改去挖。 */
function grabTrip(w, wi, h, dt) {
  if (w.load.length) carryPose(w);
  /* 目標那一塊隨時可能被別人撿走、被推土機推走、被炸飛，所以每一幀重新確認。 */
  let b = blocks[w.gb];
  if (!b || b.st !== FREE || !b.rest || b.holder >= 0) {
    const i = freeNearHome(w, h);
    if (i < 0) { endTrip(w, h); return; }
    w.gb = i; b = blocks[i];
  }
  const g = pickSpot(b);            // 躺在房子外框裡的，站到框外伸手拿
  w.tx = g.x; w.tz = g.z;
  const leg = w.leg;                                     // 上工的路不算閒晃里程（同 digTrip）
  const walking = !strollTo(w, dt);
  w.leg = leg;
  if (walking && !nearGrab(w, w.gb, dt)) return;         // 搆不到就伸手拿（v1.108）
  if (!takeHomeBlock(w, wi, h, w.gb) || w.load.length >= w.hcap) { endTrip(w, h); return; }
  const i2 = freeNearHome(w, h);
  if (i2 < 0) { endTrip(w, h); return; }
  w.gb = i2;
}
/* 這一趟收工：手上有貨就去砌（hst 清掉，updHome 下一幀會走 layTrip），
   空手就改去挖——地上沒料了還空手回去的話，那一格永遠沒人補。 */
function endTrip(w, h) {
  w.hst = '';
  w.hdt = 0;                                             // 走到就丟第一塊（同 digTrip）
  w.ct = MUS_WIND;                                       // 肌肉小人：就地掄的倒數（見 hurlTrip）
  if (w.load.length) return;
  digSpot(w, h);
  w.hst = 'dig';
}
/* 走去挖、挖到手上滿了。挖的地方每一趟重挑（見 digSpot）。 */
function digTrip(w, wi, h, dt) {
  if (w.load.length) carryPose(w);                       // 手上那疊要跟著手走
  /* 這一段是上工的路，不算進閒晃里程（那個是拿來算發呆多久的，見 strollPause）——
     跟 buildWalk 對搬料那條路的處理一樣。不扣掉的話，蓋一間房子來回幾十趟的里程
     全算在一起，蓋完第一次站定就會發呆好幾分鐘（實測抽到 147.8 秒）。 */
  const leg = w.leg;
  const walking = !strollTo(w, dt);
  w.leg = leg;
  if (walking) return;                                   // 還在走去挖的路上
  w.gait += (0 - w.gait) * Math.min(1, dt * 8);
  w.a = Math.atan2(h.x - w.x, h.z - w.z);                // 面向自己的房子挖
  w.hp -= dt;
  if (w.hp <= 0) { w.hp = DIG_PUFF; digPuff(w); }
  w.hdt -= dt;
  if (w.hdt > 0) return;
  const got = digBlock(w, wi, h);
  if (got && w.load.length < w.hcap) { w.hdt = DIG_T; return; }   // 還沒滿：繼續挖
  /* 挖滿了、或格子都被同組的認完了就收工：手上有貨就去砌，空手就換個地方
     （等同組的人把格子放掉再看）。 */
  w.hst = '';
  w.hdt = 0;                                             // 走到就丟第一塊
  w.ct = MUS_WIND;                                       // 肌肉小人：就地掄的倒數（見 hurlTrip）
}
/* 走回房子、站定原地把手上的丟完。 */
function layTrip(w, h, dt) {
  carryPose(w);
  const b0 = blocks[w.load[0].b];
  const sl = b0 && b0.hh === w.hm ? h.slots[b0.hk] : null;
  if (!sl) { dropJob(w, 0); return; }
  /* 站在格子外面丟（跟工人一樣不走進牆裡）：從屋子中心往那一格的方向推到地基外。
     **屋頂正中央那一格 dx/dz 都是 0**（3×3 的房子就有一格在正中心），
     那時候改用「他現在站的方向」——不然目標會落在屋子正中心，人一走進去就被
     pushOutHome 推出來，永遠抵達不了，那一格也就永遠砌不上（實測 6 間有 2 間卡住）。
     推的距離要大於「走到多近算抵達」（REACH 0.9），不然他站定的位置可能還在屋裡。 */
  let dx = sl.x - h.x, dz = sl.z - h.z;
  let d = Math.hypot(dx, dz);
  if (d < 0.001) { dx = w.x - h.x; dz = w.z - h.z; d = Math.hypot(dx, dz) || 1; }
  w.tx = h.x + dx / d * (h.r + HOME_STAND); w.tz = h.z + dz / d * (h.r + HOME_STAND);
  const leg = w.leg;                                     // 同上：上工的路不算里程
  const done = strollTo(w, dt);
  w.leg = leg;
  if (!done) return;
  // 站定就原地把手上的丟完（跟工人一樣，見 toSlot 的 stay）：那幾格本來就在附近
  w.hdt -= dt;
  if (w.hdt <= 0) { layHome(w, h); w.hdt = LAY_GAP; }
}
/* 肌肉小人蓋自己的家（v1.115，使用者：「肌肉小人蓋小房子時也要用肌肉小人的方式蓋」）。
   跟他在工地一模一樣（見 MUS_WIND 那一段）：撿料／挖料的路數跟一般工人相同，
   差別在**撿到手上就不走回房子**——站在料躺著的地方掄起來，直接扔到那一格上。
   所以一趟只認一塊（updHome 給 hcap = 1）：「撿起來就扔」的節拍不允許先湊滿三塊。
   飛的那一段用工地那組 MUS_* 的時間（平、快），弧頂還是走房子自己的 homePeak——
   他站在屋子外面，往另一側那幾格扔的時候要能閃過自己的屋頂（見 homePeak）。 */
function hurlTrip(w, h, dt) {
  carryPose(w);
  const b = blocks[w.load[0].b];
  const sl = b && b.hh === w.hm ? h.slots[b.hk] : null;
  if (!sl) { dropJob(w, 0); return; }
  w.gait += (0 - w.gait) * Math.min(1, dt * 8);
  w.a = Math.atan2(sl.x - w.x, sl.z - w.z);              // 面向要扔到的那一格
  w.ct -= dt;
  if (w.ct > 0) return;                                  // 還在掄
  /* 手上那塊真的被埋起來了才不出手（掄的這幾秒同組的人在他身上砌了幾層、
     或者旁邊又長出一間房子）：出手那一下整塊在牆裡。那就退回一般工人那條路——
     往房子走，走到不被埋住的地方就扔，走到房子邊上都還埋著就照一般工人那樣砌。
     **看的是那塊積木、不是他的腳**，理由同工地那條。 */
  if (blockAt(b.x, b.y, b.z) || homeSolid(b.x, b.y, b.z)) { layTrip(w, h, dt); return; }
  b.st = TOSS; b.rest = false;
  b.arc = {
    t: 0,
    dur: MUS_DUR0 + Math.hypot(sl.x - b.x, sl.z - b.z) * MUS_DUR_D + sl.y * MUS_DUR_Y,
    x0: b.x, y0: b.y, z0: b.z, x1: sl.x, y1: sl.y, z1: sl.z,
    peak: homePeak(b.x, b.y, b.z, sl, h),
    hm: w.hm, hk: b.hk
  };
  b.holder = -1;                                         // 出手了就不再屬於任何人
  w.load.shift();
  /* 一趟就一塊，出手照理就空手了。還是照 layHome 那樣判一次：調人數時 tagMuscle
     會重新掛身分，手上還抱著三塊的一般工人可能在這一刻變成肌肉小人。 */
  if (!w.load.length) w.carry = false;
  carryPose(w);
  w.ct = MUS_REST;                                       // 喘一下再開下一趟（見 updHome）
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
    if (a.hm !== undefined) { landHome(b, a); return; }   // 家的那一塊（v1.97）
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
      clearSpare();                     // 用不到的碎料淡出（v1.109）
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
  { id: 'allTools', n: '工具箱清空', d: '十三種道具都用過', chk: s => s.tools.length >= TOOLS.length },
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
    applySave(o);
  } catch (e) { savable = false; }
}
/* 把一份解包好的存檔套進 stats／pref。開場的 load() 與「匯入存檔」都走這裡——
   兩邊都要做同一套整理（認不得的成就丟掉、舊版設定吸到最近的一檔），
   各寫一份的話遲早會有一邊漏掉。這一層不碰 DOM，畫面由呼叫端自己刷。 */
function applySave(o) {
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
  { id: 'bucket', n: '水桶', k: '🪣',
    tip: '點一下：往那裡倒一大缸水（馬克杯半杯的量）。積起來的水共用一個水位，杯壁破洞就從破口噴出去；淋到的積木與小人濕 5 秒，點不著',
    lock: null },
  { id: 'hammer', n: '槌子', k: '🔨', tip: '點建築：點狀衝擊　·　點地面：只敲地板，建築不受影響',
    lock: null },
  { id: 'bighammer', n: '大槌', k: '🔨', big: true,
    tip: '點建築：兩倍大的槌子，範圍也是兩倍　·　點地面：地震，震掉 10% 的積木',
    lock: { txt: '累計擊飛 2,000 塊解鎖', ok: () => stats.smashed >= 2000 } },
  { id: 'ball', n: '保齡球', k: '🎳', tip: '點兩下：先點出手的地方，再點要滾過去的方向',
    lock: { txt: '拆掉 2 座建築解鎖', ok: () => stats.destroyed >= 2 } },
  { id: 'treb', n: '投石機', k: '🪨', tip: '點地面：在那裡架一台投石機，朝建築丟石頭',
    lock: { txt: '累計擊飛 6,000 塊解鎖', ok: () => stats.smashed >= 6000 } },
  { id: 'tornado', n: '龍捲風', k: '🌪',
    tip: '點兩下：先點龍捲風出現的地方，再點要掃過去的方向（會一路亂竄 10 秒，罩到的建築每秒吸走兩成）',
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
  { id: 'magic', n: '爆裂魔法', k: '💥', tip: '點一下：魔法陣一層層展開，6 秒後爆炸',
    lock: { txt: '拆掉 10 座建築解鎖', ok: () => stats.destroyed >= 10 } }
];
const toolOk = t => !t.lock || t.lock.ok();
/* 這幾種點空地也算數：它們的用法就是「選一個地點」，
   規定一定要點到建築的話，站在旁邊的空地放炸彈反而做不到。
   大槌點空地是地震、保齡球點空地是從那裡把球丟出去，所以也在這裡。
   小槌點空地什麼都不會掉，但仍然留在這裡：拿掉的話那一下完全沒反應，看起來像點壞了。 */
const GROUND_TOOL = { hammer: 1, bighammer: 1, ball: 1, tornado: 1, treb: 1, fw: 1,
                      bomb: 1, meteor: 1, nuke: 1, magic: 1, bucket: 1 };
let tool = 'hammer';

let hammerR = 5.5, hammerPow = 15;
let swing = null;     // 正在揮下去的槌子
let ball = null;      // 飛行中的鐵球
let twists = null;    // 作用中的龍捲風（可以同時好幾道）
let bombs = null;     // 已放下、倒數中的定時炸彈
let meteors = null;   // 已呼叫的隕石（倒數或下墜中，可以好幾顆）
let nukes = null;     // 已呼叫的核彈（倒數或下墜中，可以好幾顆）
let magics = null;    // 正在展開的魔法陣（可以好幾個）
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
      if (alive > g.props.length * PROP_ALIVE) { supStand[gi] = 1; changed = true; }
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
/* 每次造成破壞後的共通處理：計數、嚇小人、判斷這座是不是拆完了。
   own＝這一下裡有幾塊是**地標的**（v1.102）。只砸到小人的家不算動到地標——
   算的話，玩家去拆村落裡的房子會讓整座地標進入拆除中、閒晃事件也跟著被收掉，
   那一組人就再也沒回去蓋，房子永遠停在半棟（實測 600 秒補回 2 塊）。
   不給就照舊全部算地標的（那些呼叫端本來就只可能打到地標）。 */
function afterHit(n, point, R, own) {
  if (n <= 0) return;
  stats.smashed += n;
  if (n > stats.bestHit) stats.bestHit = n;
  if ((own === undefined ? n : own) > 0 && phase === 'done') phase = 'wreck';
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
/* quiet：不要震畫面。給投石機用的——它一台連丟好幾顆、還能架好幾台，
   每一顆都晃一下的話畫面會一路抖到它撤走（見 rockHit）。 */
function smash(point, dir, R0, pow0, quiet) {
  const R = R0 || hammerR, R2 = R * R;
  const power = pow0 || hammerPow;
  let hitN = 0, ownN = 0;                       // ownN＝其中有幾塊是地標的（見 afterHit）
  for (const b of blocks) {
    if (b.st !== SET) continue;
    const dx = b.x - point.x, dy = b.y - point.y, dz = b.z - point.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 <= R2) {
      const d = Math.sqrt(d2);
      const f = Math.pow(1 - d / R, 0.65) * power;
      const ol = Math.max(0.4, d);
      /* 「是不是地標的」要在 breakBlock **之前**記下來：那一支會把 b.hh 清掉
         （積木離開房子就不屬於它了），之後再看就每一塊都像地標的。 */
      const own = b.hh < 0;
      // 六成沿著揮擊方向、四成沿著離衝擊點的徑向——才有「往那個方向被打飛」的感覺
      breakBlock(b,
        (dir.x * 0.62 + dx / ol * 0.55) * f + rr(-1.4, 1.4),
        (dir.y * 0.32 + dy / ol * 0.62) * f + rr(2.2, 6.2),
        (dir.z * 0.62 + dz / ol * 0.55) * f + rr(-1.4, 1.4));
      hitN++;
      if (own) ownN++;
    } else if (d2 <= R2 * 3.4) {
      b.wob = 0.5;                        // 波及範圍：只是晃一下，不脫落
    }
  }
  afterHit(hitN, point, R, ownN);
  spawnDust(point, R, hitN);
  spawnRing(point, R);
  if (!quiet) ENG.shake(0.42 + Math.min(1.4, hitN * 0.02));
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
  let n = 0, own = 0;                 // own＝其中有幾塊是地標的（見 afterHit）
  for (let k = 0; k < take && q.cur < q.list.length; k++) {
    const b = blocks[q.list[q.cur++]];
    if (!b || b.st !== SET) continue;               // 這中間被別的東西打掉了
    const wasOwn = b.hh < 0;                        // breakBlock 會把 hh 清掉
    breakBlock(b, rr(-1.2, 1.2), rr(-0.5, 1.2), rr(-1.2, 1.2));
    n++; if (wasOwn) own++;
  }
  // 還沒掉的也要跟著抖：地震看的是整棟在晃，不是幾塊在掉
  for (const b of blocks) if (b.st === SET && Math.random() < 0.5) b.wob = 0.4;
  if (n) afterHit(n, { x: q.x, y: 1, z: q.z }, 5, own);
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
const TREB_NEAR = 14;               // 放下去的地方幾格內有房子就轟那一間（見 placeTreb）
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
  /* 轟哪一座（v1.102，使用者：「小房子也要能被所有破壞工具作用」）。原本一律照
     工地中心取落點，所以擺在小人的家旁邊也是在轟地標。改成「擺在誰旁邊就轟誰」：
     放下去的地方 TREB_NEAR 格內有房子就轟那一間，沒有才轟地標。 */
  let hm = -1, best = TREB_NEAR * TREB_NEAR;
  if (homes) homes.list.forEach((h, i) => {
    const d2 = (h.x - point.x) ** 2 + (h.z - point.z) ** 2;
    if (d2 < best) { best = d2; hm = i; }
  });
  const aim = hm >= 0 ? homes.list[hm] : { x: 0, z: 0 };
  // 面向要轟的那一座：rotation.y = a 之後 local +Z 會指到 (sin a, 0, cos a)
  trebs.list.push({ x, z, a: Math.atan2(aim.x - x, aim.z - z), hm,
                    arm: -0.8, next: 0.4, left: TREB_SHOTS, idle: 0 });
  sndWind();
}
function fireRock(m) {
  /* 落點以「它要轟的那一座」的中心為準隨機取（開根號讓分布均勻，不然會全擠在中心）。
     那一座是放下去的時候決定的（見 placeTreb）；房子被拆掉了就回頭轟地標。 */
  const h = m.hm >= 0 && homes ? homes.list[m.hm] : null;
  const cx = h ? h.x : 0, cz = h ? h.z : 0;
  const spread = h ? h.r : siteR * 0.85;
  const a = Math.random() * Math.PI * 2;
  const rad = Math.sqrt(Math.random()) * spread;
  const tx = cx + Math.cos(a) * rad, tz = cz + Math.sin(a) * rad;
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
  /* 不震畫面（v1.58）：一台投石機連丟好幾顆、又可以同時架好幾台，
     每一顆落地都晃一下的話畫面會一路抖到它們撤走——跟龍捲風同一個道理，
     震動留給槌子那種「點一下、響一聲」的單次撞擊。灰塵與氣浪照舊，打擊感靠它們。 */
  const n = smash(p, { x: 0.12, y: -1, z: 0.12 }, ROCK_R, ROCK_POW, true);
  spawnDust(p, ROCK_R, n);
  spawnRing({ x: p.x, y: 0, z: p.z }, 5);
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
/* 已經點好、還在等第二點的那一點。保齡球與龍捲風共用（v1.58 起兩個都是點兩下）：
   {x, z, ph 光環的脈動相位, r 光環半徑, c 光環顏色}。 */
let aim = null;

/* 兩點式的第一下：記位置、畫個光環、等第二下。 */
function aimFirst(point, r, c) {
  aim = { x: point.x, z: point.z, ph: 0, r: r, c: c };
  sndTick();
}
/* 第一點 → 第二點的方向。兩點幾乎重疊（同一個地方連點兩下）時沒有方向可用，
   就退回「朝工地中心」——不然那一下會變成沒反應。回傳的是弧度。 */
function aimDir(from, toward, spread) {
  let dx = toward ? toward.x - from.x : -from.x;
  let dz = toward ? toward.z - from.z : -from.z;
  if (Math.hypot(dx, dz) < 0.5) { dx = -from.x; dz = -from.z; }
  if (Math.hypot(dx, dz) < 1e-4) { dx = 1; dz = 0; }
  return Math.atan2(dz, dx) + rr(-spread, spread);
}

/* 第一下記位置，第二下才丟出去。 */
function aimBall(point) {
  if (!aim) { aimFirst(point, BALL_R, 0x8fe6ff); return; }
  launchBall(aim, point);
}
function launchBall(from, toward) {
  const a = aimDir(from, toward, BALL_SPREAD);
  ball = {
    x: from.x, y: BALL_R + BALL_DROP, z: from.z,
    vx: Math.cos(a) * 34, vz: Math.sin(a) * 34, vy: rr(-3, -0.5),   // 是往下丟不是往上拋
    r: BALL_R, ang: 0, hit: 0, life: BALL_LIFE, hops: 0
  };
  aim = null;
  sndSwing();
}
/* 等第二點的時候在第一點畫一圈會脈動的光環：沒有這個的話，
   第一下點下去畫面完全沒反應，看起來像點壞了。 */
const AIM_RING = [];
function aimRings() {
  AIM_RING.length = 0;
  const p = 0.5 + 0.5 * Math.sin(aim.ph * 4.5);
  AIM_RING.push({ x: aim.x, z: aim.z, y: 0.14, r: aim.r * (1.1 + 0.14 * p),
                  spin: aim.ph * 0.8, op: 0.9, c: aim.c, add: 1 });
  AIM_RING.push({ x: aim.x, z: aim.z, y: 0.13, r: aim.r * 0.5,
                  spin: -aim.ph * 0.5, op: 0.35 + 0.5 * p, c: 0xffffff, add: 1 });
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
      sndSmash();                                // 不震畫面（v1.58），理由同下面撞到積木那段
    } else o.vy = 0;
  }
  let sp = Math.hypot(o.vx, o.vz);
  o.ang += sp / o.r * dt;                        // 滾動角度：走多遠就轉多少
  const R = o.r + 0.7, R2 = R * R;
  let n = 0, own = 0;                 // own＝其中有幾塊是地標的（見 afterHit）
  for (const b of blocks) {
    if (b.st !== SET && b.st !== FREE) continue;
    const dx = b.x - o.x, dy = b.y - o.y, dz = b.z - o.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > R2) { if (b.st === SET && d2 < R2 * 2.6) b.wob = 0.4; continue; }
    const d = Math.max(0.4, Math.sqrt(d2));
    const wasSet = b.st === SET;
    const wasOwn = b.hh < 0;                   // 同 smash：breakBlock 會把 hh 清掉
    breakBlock(b,
      o.vx * 0.5 + dx / d * 7 + rr(-2, 2),
      Math.max(3, sp * 0.26) + dy / d * 3 + rr(1, 5),
      o.vz * 0.5 + dz / d * 7 + rr(-2, 2));
    if (wasSet) { n++; if (wasOwn) own++; }      // 地上的散料被撞開不算破壞
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
    afterHit(n, { x: o.x, y: o.y, z: o.z }, R, own);
    spawnDust({ x: o.x, y: o.y, z: o.z }, R, n);
    /* 不震畫面（v1.58）：球一路滾過去是「每一幀都在撞」，每幀加一點震動的話
       畫面從出手晃到停下，看久了很不舒服——跟龍捲風、投石機同一個道理。 */
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

/* 龍捲風：在地面走一段路，把沿路的碎料與部分積木吸起來繞圈，最後隨機甩出去。
   可以同時存在好幾道——畫面成本跟道數無關（引擎那邊一層一顆 InstancedMesh），
   真正的上限是塵霧配額，所以卡在 TW_MAX 道。 */
/* 壽命 10 秒（v1.62，本來 5）：改成「路過不再把建築整段吸光」之後，
   掃過去的那幾秒不夠看出它在幹什麼——時間還回去讓它多掃幾趟。
   （v1.58 曾從 7 收到 5，理由是尾巴那兩秒它早就亂竄到別處；現在那反而是好事：
   停在同一個地方會一路啃到見底，竄到別處反而讓破壞散得開。） */
const TW_MAX = 4, TW_LIFE = 10, TW_R = 6, TW_H = 34;
/* **每秒**啃掉範圍內的幾成（v1.87，使用者指定「吸走破壞是持續性的」）。
   v1.62～v1.86 是「同一道對同一塊只抽一次」：停在建築上也只啃那一口就沒事了，
   看起來像路過蹭一下。現在改成一路啃——罩著多久就啃多久（撐得住的話一秒剩八成、
   十秒剩 0.8¹⁰ ≈ 一成），這樣「吸走」才是持續發生的事。
   每幀的機率是 1−(1−這個數)^dt，所以啃掉幾成跟幀率無關（見 stepTwist）。
   碎料（FREE／FLY）不受這條限制，照樣全部捲走。 */
const TW_TAKE = 0.2;
/* 走多快（單位／秒）：出發時 TW_SPD0，之後每幀被亂數推一下，夾在 MIN～MAX 之間。
   v1.62.2 整組乘 1.6（3.2／2.2／6 → 5.2／3.6／9.6，使用者指定「提升移動速度」）：
   漏斗半徑才 6，舊的速度連自己的直徑都要走 3.75 秒，看起來像在原地磨。
   轉向的擺幅（TW_SWAY）不跟著調——那是「每秒轉幾弧度」，跟走多快無關；
   跟著調的話走得快、轉得也快，等於原地繞圈，路線反而不會拉開。 */
const TW_SPD0 = 5.2, TW_SPD_MIN = 3.6, TW_SPD_MAX = 9.6;
/* 風聲一段多長、每隔多久補一段（v1.62.3）。間隔比長度短，兩段有 0.5 秒重疊，
   接起來才是「一直在吹」而不是「呼、呼、呼」三聲分開的；
   最後 WIND_TAIL 秒不再補新的，不然漏斗都散了風還在吹。 */
const WIND_DUR = 1.9, WIND_GAP = 1.4, WIND_TAIL = 0.9;
const TW_SPREAD = 0.12;             // 方向偏差 ±rad（約 ±7°），跟保齡球同一個用意
const TW_SWAY = 0.85;               // 轉向角的擺幅（rad/s）：一路歪來歪去用的
/* 點兩下：第一點是龍捲風出現的地方，第二點決定往哪邊掃（跟保齡球同一套操作）。
   本來是「點一下，自動朝工地中心掃、方向再亂加 ±0.7」——那等於方向不歸玩家管。
   出發方向照指的走，之後仍然一路亂竄（見 stepTwist），所以不會是一條直線。 */
function aimTornado(point) {
  if (!aim) { aimFirst(point, TW_R, 0xd6e6f0); return; }
  launchTornado(aim, point);
}
function launchTornado(from, toward) {
  const a = aimDir(from, toward, TW_SPREAD);
  aim = null;
  if (!twists) twists = [];
  if (twists.length >= TW_MAX) twists.shift();     // 放太多道就把最早那道擠掉
  twists.push({
    x: from.x, z: from.z, r: TW_R, h: TW_H, life: TW_LIFE,
    /* 起始角度隨機：漏斗的扭曲完全是 spin 的函數，都從 0 開始的話
       同時在場的幾道會擺出一模一樣的姿勢，看起來像複製貼上。 */
    spin: rr(0, 6.28), vx: Math.cos(a) * TW_SPD0, vz: Math.sin(a) * TW_SPD0, hit: 0,
    /* 擺動的相位與頻率各自抽（見 stepTwist）：同時來好幾道時，
       都用同一組的話它們會擺得一模一樣，看起來像複製貼上。 */
    ph: rr(0, 6.28), sw: rr(0.9, 1.5),
    snd: WIND_GAP                     // 出場那一聲在下面放了，下一段等 WIND_GAP 秒
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
    // 風聲一段一段接下去（見 sndWind）。快散了就不再補，讓最後那段自己收尾
    w.snd -= dt;
    if (w.snd <= 0 && w.life > WIND_TAIL) { sndWind(); w.snd = WIND_GAP; }
    w.x += w.vx * dt; w.z += w.vz * dt;
    /* 走的路要歪（v1.58）。本來是每幀加一點亂數加速度，但那種東西左右互相抵銷——
       實測整段 10 單位的路只偏離直線 0.27 單位，看起來就是直直推過去。
       改成「轉向角自己在擺」：每道各有自己的擺動頻率與起始相位，5 秒的壽命裡
       剛好掃出一道 S 形，而且不會原地打轉（純亂數轉向會）。 */
    w.ph += dt * w.sw;
    const ang = Math.atan2(w.vz, w.vx) + (Math.sin(w.ph) * TW_SWAY + rr(-0.5, 0.5)) * dt;
    const sp = Math.max(TW_SPD_MIN,
                        Math.min(TW_SPD_MAX, Math.hypot(w.vx, w.vz) + rr(-3, 3) * dt));
    w.vx = Math.cos(ang) * sp; w.vz = Math.sin(ang) * sp;
    if (Math.hypot(w.x, w.z) > arenaR) { w.vx *= -1; w.vz *= -1; }

    const R = w.r, R2 = R * R;
    /* 這一幀啃掉幾成：一秒 TW_TAKE 成換算成這一幀的機率（見 TW_TAKE）。
       直接每幀抽 TW_TAKE 的話，一秒 33 幀就等於全部啃光。 */
    const take = 1 - Math.pow(1 - TW_TAKE, dt);
    let n = 0, own = 0;                 // own＝其中有幾塊是地標的（見 afterHit）
    for (const b of blocks) {
      if (b.st === CARRY || b.st === TOSS) continue;
      const dx = b.x - w.x, dz = b.z - w.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > R2 || b.y > w.h) continue;
      const d = Math.max(0.5, Math.sqrt(d2));
      // 切線方向繞圈 + 往內吸 + 往上捲
      const tx = -dz / d, tz = dx / d;
      const pull = (1 - d / R);
      /* 還站著的積木：這一幀只啃得走一小部分，這次沒抽中的原地留著
         （連力都不加——SET 的積木本來就不吃速度，加了只是等它下次被算到時
         帶著一組舊的速度脫離）。下一幀重新抽，所以罩著不走就會一路啃下去。 */
      if (b.st === SET) {
        if (Math.random() >= take) continue;
        const wasOwn = b.hh < 0;                    // breakBlock 會把 hh 清掉
        breakBlock(b, 0, 0, 0); n++; if (wasOwn) own++;
      }
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
      afterHit(n, { x: w.x, y: 2, z: w.z }, R * 0.6, own);
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
  let n = 0, ownN = 0;                          // ownN＝其中有幾塊是地標的（見 afterHit）
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
    const wasOwn = b.hh < 0;                   // 同 smash：breakBlock 會把 hh 清掉
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
    if (wasSet) { n++; if (wasOwn) ownN++; }
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
  afterHit(n, point, R, ownN);
  /* 還站著的（SET）餘火：半徑放到 1.5 倍去找——衝擊圈內幾乎都被炸飛了，
     沒倒的都在圈外那一帶。這些會繼續往鄰居蔓延。
     碎料的火不在這裡點，在上面那個迴圈裡逐塊點——見那邊的說明。 */
  igniteAround(point, R * 1.5, Math.round(R * 0.8), SET);
  // 火球與衝擊環是「爆炸」的長相，crash 那條只留下被砸飛的積木與揚起來的塵土
  if (!crash) { spawnBlast(point, R, magic); spawnRing(point, R); }
  // 地上留一塊痕跡：一般爆炸是焦黑，砸下來的（隕石）是坑洞
  spawnMark(point, R, crash);
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
/* 重建那張反查表。積木只記得自己在哪個 slot，沒有反向的表，而「沿著格子走」的東西
   （火的蔓延、水沿表面流）都得從格子反查回積木。要用的那一幀自己重建一次：
   三千格的整數陣列填一趟，比維護一份增量的表單純得多。 */
function buildSlotOwner() {
  const n = bp.slots.length;
  if (!slotOwner || slotOwner.length !== n) slotOwner = new Int32Array(n);
  slotOwner.fill(-1);
  for (let k = 0; k < blocks.length; k++) {
    const b = blocks[k];
    if (b.st === SET && b.slot >= 0) slotOwner[b.slot] = k;
  }
}
// 這一格站著哪一塊積木（沒有就 null）。呼叫前這一幀要先 buildSlotOwner() 過
function blockOn(gx, gy, gz) {
  if (!bp || !bp.at || !slotOwner) return null;
  const j = bp.at.get(gkeyOf(gx, gy, gz));
  if (j === undefined) return null;
  const k = slotOwner[j];
  return k >= 0 ? blocks[k] : null;
}

/* 點著一塊。SET（還站著的）跟 FLY（碎料）都燒得起來，但燒法不同：
   前者燒 BURN_TIME、會焦黑鬆脫掉下來、還會把火傳給鄰居；
   後者燒固定 EMBER_TIME，只是拖著火飛、落地變成一塊焦炭
   （它已經離開建築了，沒有鄰居可傳，也不用再打掉一次）。 */
function igniteBlock(b) {
  if (!b || b.burn || b.wet > 0 || (b.st !== SET && b.st !== FLY)) return false;
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
/* 把單獨一塊上的火弄熄。用在「小人撿起還在燒的碎料」：換建築時火不再整批收掉
   （v1.59），上一座的碎料會拖著火躺在新工地上等著被撿去蓋，撿起來還燒著的話，
   火就跟著被砌進新建築裡了。燒黑的顏色留著不還原——那是一塊真的被燒過的積木。 */
function douse(b) {
  if (!b || !b.burn) return;
  b.burn = 0;
  if (!fires) return;
  const i = fires.findIndex(f => f.b === b);
  if (i < 0) return;
  if (fires[i].sp) nSpread--;
  fires.splice(i, 1);
  if (!fires.length) { fires = null; nSpread = 0; }
}
/* ── 潮濕 ───────────────────────────────────────────────
   被水噴到的東西濕 5 秒（使用者指定），這 5 秒內點不著，顏色壓深一點點。
   積木的濕度就掛在 b.wet 一個數字上，每幀在顏色那條 lerp 旁邊自己遞減
   （見 step 裡的 b.wet -= dt）——不另外開清單，因為那條迴圈本來就每幀跑過每一塊。
   小人的濕度是 w.wet，深淺走 w.wetK（引擎那邊乘上去的倍率）。 */
const WET_TIME = 5;                 // 濕多久
const WET_DARK = 0.8;               // 濕的時候顏色乘多少（使用者指定 ×0.8：深一點點）
/* 淋濕一塊。還在燒的先熄掉——「噴水滅火」就是這一行，douse 會把它從 fires 拿掉，
   燒黑的顏色留著不還原（那是真的被燒過的痕跡，v1.59 訂的規則）。 */
function wetBlock(b) {
  if (!b) return false;
  douse(b);
  b.wet = WET_TIME;
  return true;
}
/* 淋濕一個人。身上有火就一起澆熄，站起來的收尾跟「燒完了」走同一組欄位
   （見 updWorker 裡 w.burn <= 0 那段），不然人會一直躺在地上打滾。 */
function wetWorker(w) {
  if (!w) return false;
  w.wet = WET_TIME;
  if (w.burn > 0) {
    w.burn = 0; w.roll = 0; w.tilt = 0; w.rspin = 0; w.rph = 0; w.gait = 0; w.st = 'idle';
    w.fall = rr(0.5, 1.1);            // 被水柱打到會先蹲一下再起來
  }
  return true;
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
  // 只點著小人的家不算動到地標（v1.102，見 afterHit）
  if (b.hh < 0 && phase === 'done') phase = 'wreck';
  sndFire();
}
/* ── 消防車 ─────────────────────────────────────────────
   建造中失火會卡死：小人把積木補回火場旁邊 → 新放上去的又被蔓延點著。
   實測（在蓋到一半的巴黎聖母院放一把火，20 人、3000 塊）三輪都跑到 600 秒還沒完工，
   放上去只有 741／728／1032 塊（共 3121），結束時還有二十幾塊在燒；
   同一座沒放火是 334 秒完工。所以消防車不是特效，它是這個死結的解。

   只在**建造中**派車（使用者指定）：拆除中你自己點的火不該被 AI 滅掉。
   車走**外圈**——建造中不能像整地那樣叫小人退到旁邊等，所以車停在 siteClearR 外面
   往裡面噴，工地裡的路一條都不占（代價是它打不到工地正中央深處，見 ftRange）。 */
const FT_MAX = 2;                   // 最多幾台，跟畫面那邊的 MAXTRUCK 綁在一起
/* 工地每這麼多平方單位派一台（1～FT_MAX）。2000 是照「一般工地一台、大工地兩台」訂的：
   siteR 14 的小工地面積 745 → 1 台，siteR 33 以上（面積 3700+）→ 2 台。 */
const FT_AREA = 2000;
const FT_CALL = 6;                  // 同時燒著幾塊才叫車：一兩塊自己就燒完了，不值得出動
const FT_MOVE = 13;                 // 車速。比推土機快（DOZ_MOVE 9.5）——它是趕著來的
const FT_WET_R = 3.2;               // 水柱落點這麼近的積木都會被淋濕
const FT_SWEEP = 17;                // 落點每秒掃多快：掃過去才像在澆，瞬移看起來像在閃
const FT_PICK = 0.4;                // 多久重挑一次目標
const FT_QUIT = 2.5;                // 火滅乾淨之後再待這麼久才走（復燃就不用重新叫車）
const FT_LIMIT = 120;               // 保險絲：待再久也要收工
/* 一次最多轉這麼多弧度去找下一個路點。直接朝目標角度切過去的話，火在對面時
   那條直線會穿過工地正中央——「車走外圈」就白寫了。算過：從場外開進來時
   0.3 rad 的路點讓整條路離場中心最近 20（外圈半徑本身 20、工地 16），0.5 rad 會掉到 13。 */
const FT_ARC = 0.3;
const ftRing = () => siteClearR() + 4;      // 停在外圈這個半徑上（比推土機的工作圈還外面）
const ftRange = () => ftRing() + 7;         // 射程：打得到場中心再過去一點
const WATER_G = 12;                 // 水滴的重力（塵霧預設 7；水要沉一點才像水）
let trucks = null;                  // 在場的消防車 { t, quit, out, list }

/* 還站著在燒的那些塊的平均位置角度——車從這個方向的場外進來。 */
function fireAngle() {
  let x = 0, z = 0, n = 0;
  if (fires) for (const f of fires) {
    if (!f.sp || f.b.st !== SET) continue;
    x += f.b.x; z += f.b.z; n++;
  }
  return n ? Math.atan2(x / n, z / n) : Math.random() * Math.PI * 2;
}
function callTrucks() {
  const n = clamp(Math.round(Math.PI * siteClearR() ** 2 / FT_AREA), 1, FT_MAX);
  const base = fireAngle();
  const far = arenaR + DOZ_FAR;             // 跟推土機同一個進場圈
  trucks = {
    t: 0, quit: 0, out: false,
    list: Array.from({ length: n }, (_, k) => {
      const off = (k - (n - 1) / 2) * 0.5;  // 兩台在外圈上錯開一點，不要擠在同一個點
      const ang = base + off;
      return { x: Math.sin(ang) * far, z: Math.cos(ang) * far, a: ang + Math.PI,
               off, t: rr(0, 2), bob: 0, bk: 0, tx: 0, tz: 0,
               pick: 0, aim: null, jet: 0, jx: 0, jy: 0, jz: 0, em: 0 };
    })
  };
}
/* 還澆得到的目標：離這台車最近、**還站著**在燒的那一塊。
   碎料的火（f.sp = false）不追——它們散得到處都是，而且燒完自己就成焦炭，
   追著跑的話車會一路被拉離建築；掃到的碎料照樣會被水淋濕（見 wetSpray）。 */
function pickFire(m) {
  if (!fires) return null;
  let best = null, bd = Infinity;
  for (const f of fires) {
    if (!f.sp || f.b.st !== SET) continue;
    const d = (f.b.x - m.x) ** 2 + (f.b.z - m.z) ** 2;
    if (d < bd) { bd = d; best = f.b; }
  }
  return best;
}
const aimOk = b => !!b && b.burn === 1 && b.st === SET;
/* 只轉車頭、不前進。停下來噴水時要對著火場轉，driveTo 那支會連帶把車開走。 */
function faceTo(m, dt, x, z) {
  let d = Math.atan2(x - m.x, z - m.z) - m.a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  m.a += Math.min(Math.abs(d), DOZ_TURN * dt) * Math.sign(d);
}
/* 下一個路點：外圈上、離車子現在的角度最多 FT_ARC 的那一點（見 FT_ARC 的註解）。 */
function ftWaypoint(m, ang) {
  const now = Math.atan2(m.x, m.z);
  let d = ang - now;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  const a = now + clamp(d, -FT_ARC, FT_ARC);
  m.tx = Math.sin(a) * ftRing();
  m.tz = Math.cos(a) * ftRing();
}
/* 水柱：從砲口噴到落點的一串水滴，走現成的塵霧粒子池（那邊支援每顆自己的顏色），
   所以整個水效果是 0 個新 draw call。
   速度是解彈道解出來的（給定飛行時間，垂直初速要補上重力那一段），
   不是「往那個方向噴一個固定速度」——後者近的打太遠、遠的掉在半路。
   keep: 1 是關掉水平阻尼：塵霧預設每幀乘 0.94，水滴吃了那個會在半空停住。 */
function sprayFx(m, dt) {
  const nx = m.x + Math.sin(m.a) * 1.4, nz = m.z + Math.cos(m.a) * 1.4, ny = 3.05;
  const d = Math.hypot(m.jx - nx, m.jz - nz);
  const t = Math.max(0.12, d / 30);
  /* 水柱的粗細（使用者說了兩次「粗一點」，v1.68.2 再加一級）：
     一秒 230 顆、每顆 0.3～0.6 格，出口左右散開 ±0.36 格、速度再抖 ±1.4。
     三個數字要一起加才會變「粗」：只放大顆粒是一串大冰塊，只加量是同一條線變密，
     只散開是霧。歷程：75 顆／0.16～0.34（像飛石）→ 130／0.12～0.26（太細）
     → 175／0.2～0.42 → 現在這組。 */
  m.em += dt * 230;
  while (m.em >= 1) {
    m.em--;
    if (dust.length > 560) break;               // 留一截給煙塵：火場本來就在冒煙
    dust.push({
      x: nx + rr(-0.36, 0.36), y: ny + rr(-0.28, 0.28), z: nz + rr(-0.36, 0.36),
      vx: (m.jx - nx) / t + rr(-1.4, 1.4),
      vy: (m.jy - ny) / t + 0.5 * WATER_G * t + rr(-0.65, 0.65),
      vz: (m.jz - nz) / t + rr(-1.4, 1.4),
      rx: Math.random() * 6, ry: Math.random() * 6,
      life: t * rr(0.92, 1.12), s: rr(0.3, 0.6),
      cr: 0.58, cg: 0.82, cb: 1, g: WATER_G, keep: 1
    });
  }
  // 打在牆上濺開的那幾滴：往上彈、吃一點阻尼，落點才看得出來是「打到東西了」
  if (Math.random() < dt * 55 && dust.length < 620)
    dust.push({
      x: m.jx + rr(-0.7, 0.7), y: m.jy + rr(-0.5, 0.5), z: m.jz + rr(-0.7, 0.7),
      vx: rr(-2.4, 2.4), vy: rr(1.6, 4.4), vz: rr(-2.4, 2.4),
      rx: Math.random() * 6, ry: Math.random() * 6,
      life: rr(0.3, 0.6), s: rr(0.26, 0.52),
      cr: 0.74, cg: 0.91, cb: 1, g: WATER_G, keep: 0.9
    });
}
/* 水柱落點附近的東西都淋濕。一幀掃一趟積木，兩台車共用這一趟——
   一台掃一趟的話同一塊會被判兩次，而且掃兩遍三千塊是白花的。 */
function wetSpray() {
  const jets = [];
  for (const m of trucks.list) if (m.jet) jets.push(m);
  if (!jets.length) return;
  const r2 = FT_WET_R * FT_WET_R;
  for (const b of blocks) {
    if (b.holder >= 0) continue;                 // 扛在人身上的不算（人自己會被淋到）
    for (const m of jets)
      if ((b.x - m.jx) ** 2 + (b.y - m.jy) ** 2 + (b.z - m.jz) ** 2 < r2) { wetBlock(b); break; }
  }
  for (const w of workers) {
    if (w.wet > WET_TIME - 0.2) continue;        // 剛淋過就不必再算一次
    for (const m of jets)
      if ((w.x - m.jx) ** 2 + (w.z - m.jz) ** 2 < r2 &&
          Math.abs(m.jy - w.y) < FT_WET_R + 1.5) { wetWorker(w); break; }
  }
}
function stepTrucks(dt) {
  // 叫車：只有建造中，而且火勢到一定規模
  if (!trucks && phase === 'build' && nSpread >= FT_CALL) callTrucks();
  if (!trucks) return;
  const T = trucks;
  T.t += dt;
  /* 收工／回頭。收工條件：不在建造中了（換場、完工、開始拆）、火滅乾淨、或待太久。
     還沒開出地圖前火又燒起來的話直接回頭，不必等這批走光再叫新的一批。 */
  if (T.out) {
    if (phase === 'build' && nSpread >= FT_CALL) { T.out = false; T.quit = 0; }
  } else {
    if (phase !== 'build' || T.t > FT_LIMIT) T.out = true;
    else if (nSpread) T.quit = 0;
    else { T.quit += dt; if (T.quit > FT_QUIT) T.out = true; }
  }
  for (let i = T.list.length - 1; i >= 0; i--) {
    const m = T.list[i];
    m.t += dt;
    m.bob = Math.sin(m.t * 24) * 0.05;            // 引擎抖動：停著也在抖
    m.bk = Math.floor(m.t * 3.4) % 2;             // 警示燈：一秒閃三下多
    if (T.out) {
      m.jet = 0;
      faceTo(m, dt, m.x * 3, m.z * 3);            // 車頭轉朝外，直線開出去
      m.x += Math.sin(m.a) * FT_MOVE * dt;
      m.z += Math.cos(m.a) * FT_MOVE * dt;
      if (Math.hypot(m.x, m.z) > arenaR + 14) T.list.splice(i, 1);
      continue;
    }
    m.pick -= dt;
    if (m.pick <= 0 || !aimOk(m.aim)) { m.pick = FT_PICK; m.aim = pickFire(m); }
    const a = m.aim;
    if (!a) { m.jet = 0; continue; }               // 沒得澆：停在原地等，外圈本來就是它的位置
    /* 要先開到外圈上才噴（v1.68）。只看「打得到了嗎」的話，車會停在剛好進入射程的
       那個位置——聖母院實測停在半徑 33，外圈才 21.4，遠遠停在場外對著建築噴。
       所以兩個條件都要成立：人已經在外圈那一帶、目標也在射程內。 */
    const reach = Math.hypot(a.x - m.x, a.z - m.z) <= ftRange();
    if (!reach || Math.hypot(m.x, m.z) > ftRing() + 2) {
      m.jet = 0;                                  // 還在路上就先收水柱，不要邊開邊亂噴
      ftWaypoint(m, Math.atan2(a.x, a.z) + m.off);
      driveTo(m, dt, FT_MOVE);
      continue;
    }
    // 打得到了：停下來、車頭轉向火場、水柱往目標掃過去
    faceTo(m, dt, a.x, a.z);
    if (!m.jet) { m.jet = 1; m.jx = a.x; m.jy = a.y; m.jz = a.z; }
    else {
      const dx = a.x - m.jx, dy = a.y - m.jy, dz = a.z - m.jz;
      const d = Math.hypot(dx, dy, dz), go = FT_SWEEP * dt;
      if (d <= go) { m.jx = a.x; m.jy = a.y; m.jz = a.z; }
      else { m.jx += dx / d * go; m.jy += dy / d * go; m.jz += dz / d * go; }
    }
    sprayFx(m, dt);
  }
  if (!T.list.length) { trucks = null; return; }
  wetSpray();
}

/* ── 水桶：積木型的水（v1.81 全部重寫） ─────────────────
   水就是**一格一格的方塊**，每一格記一個 0～1 的水量。每一拍（WT_TICK）做三件事：

   ① **往下掉**：腳下有空間就把水送下去。一拍最多送一格的量，所以看得出水在往下流
      （落下速度＝每秒 1/WT_TICK 格）。由下往上處理，整條水柱才會一起往下移。
   ② **往旁邊攤**：掉不下去的水，往比自己少的鄰居分掉高低差的一部分。水面自己會平，
      而且攤到懸空的格子上、下一拍就掉下去——水從破口流出去、從屋簷瀉下來都是這一條。
   ③ **滲掉**：貼在地面／積木上的那一格慢慢乾（地面快、積木縫隙慢），最後全部滲進地下。

   為什麼從「一團水共用一個水位」（v1.73～1.80）換回一格一格：使用者回報
   **「看不出水的體積」**。水位模型畫出來永遠是一片平面，「有多少水」只剩一個數字；
   破口噴多少、腳下垮掉時水怎麼落、退水怎麼退，全都得另外用數值近似，
   改了五版都還是一眼看得出不對。一格一格的水直接就有體積，往下流是規則本身。

   座標：格子座標 (gx,gy,gz)。第 gy 層的水占 y ∈ [gy, gy + 水量]，
   積木在第 gy 層占 y ∈ [gy, gy+BS]（BS 0.94，所以滿的水比積木高一點點，不會有縫）。 */
const WB_CLICK = 2300;              // 點一下倒幾格的水（＝馬克杯半杯，v1.71 訂的基準）
const WB_POUR = 2.5;                // 那一下倒完要幾秒——看得到水一路淹上來，不是瞬間滿
const WB_DROPS = 100;               // 相容用：呼叫端給的「幾團 × 每團幾格」＝總量
const WB_VOL = WB_CLICK / WB_DROPS; // 一團 23 格
const WB_UP = 0.55;                 // 倒水口比點到的地方高多少
const WB_WET = 0.12;                // 每隔多久把碰到水的積木與小人淋濕一次
const WB_DUST = 640;                // 水花最多用到塵霧池的第幾顆（池子共 720，留一截給煙）

const WT_TICK = 1 / 30;             // 水一秒算幾拍（也決定落下速度：一拍掉一格）
const WT_FALL = 1;                  // 一拍最多往下送幾格的量（一格就是上限，＝落下 30 格/秒）
const WT_FLOW = 0.5;                // 水面找平：一次搬走高低差的幾成（0.5 ＝ 兩格平分，剛好不會來回盪）
const WT_ORI = 2;                   // 水壓推力：頭上壓 h 格水 → 一格出口一拍推得出 √h × 這個數
const WT_LEVEL = 0.02;              // 高低差小於這個就當它平了
const WT_MIN = 0.02;                // 一格少於這個就當它乾了
const WT_CELLS = 9000;              // 同時最多幾格水（馬克杯裝滿是 4632 格，要裝得下、滿得出來）
const WT_POUR_N = 900;              // 倒水口最多找幾格位置（一拍要塞得下 46 格的水）
const WT_SEED = 0.12;               // 攤到新的一格至少要給這麼多水（太少會一閃一閃地生出來又乾掉）
const WT_SHOW = 0.05;               // 少於這麼多就不畫（配合 c.vis 的遲滯，邊緣才不會閃）
const WT_STILL = 0.15;              // 少於這麼多水就不再往旁邊攤（薄薄一層就地滲掉，不然邊緣會一直生生滅滅）
const WT_JET = 6;                   // 有水壓時最多把水甩出去幾格
const WT_JET_K = 0.5;               // 頭上壓幾格水 → 甩出去幾格
const WT_STREAM = 0.5;              // 桶口倒出來的那道水，一格裝多少（自由落下的水柱就是這個值）
const WT_AIR = 2;                   // 半空中的水畫成幾倍高（上限一格）——見 faceMask
const WT_HIGH = 60;                 // 找「這一柱的水面」時最多往上看幾層
const WT_SPRAY = 0.22;              // 正在往下流的水，每一格每一拍灑水花的機率
const WT_STAND = 0.75;              // 腳下那格有這麼多水就不算「半空中」（畫面用，見 faceMask）
const WT_EASE = 0.1;                // 站住的水：畫出來的水面追上實際水位的時間常數（秒）
const WT_EASE_AIR = 0.02;           // 半空中的水：幾乎不延遲（落下的水一拍就該掉一格）
const SEEP_G = 0.6;                 // 貼在草地上的那一格每秒滲掉多少（一格約 1.7 秒）
const SEEP_B = 0.02;                // 貼在積木上的那一格每秒漏多少（縫隙，慢——太快的話水還沒流到地面就乾了）
let water = null;                   // { cells: Map, pours: [], acc, wt, wave }

/* 世界座標 ↔ 格子座標。gOffX/gOffZ 是藍圖角落的偏移。 */
const cellX = x => Math.round(x - gOffX);
const cellZ = z => Math.round(z - gOffZ);
const wldX = gx => gx + gOffX;
const wldZ = gz => gz + gOffZ;
/* 水撞到的「固體」。藍圖的格子表問一次，小人的家再問一次（v1.103）——
   不問的話水從房子中間流過去、不會積在屋裡、杯壁破洞也不會從破口噴出來。
   兩邊的格線不同源（藍圖的原點隨每一座地標平移，房子各自有自己的原點），
   所以拿世界座標分別問，對不齊的誤差最多半格。 */
const solidAt = (gx, gy, gz) => {
  const x = wldX(gx), y = gy + HB, z = wldZ(gz);
  return blockAt(x, y, z) || homeSolid(x, y, z);
};
const DIR4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const wkey = (gx, gy, gz) => gx + ':' + gy + ':' + gz;

function newWater() {
  if (!water) water = { cells: new Map(), pours: [], acc: 0, wt: 0, wave: 0 };
  return water;
}
/* 這一格有多少水（0～1） */
function watAt(gx, gy, gz) {
  if (!water) return 0;
  const c = water.cells.get(wkey(gx, gy, gz));
  return c ? c.v : 0;
}
/* 這一柱最高的水面在哪（沒水回 -1）。給「站在水裡」「泡在水裡」那些判斷用。 */
function waterTop(gx, gz) {
  if (!water) return -1;
  let top = -1;
  for (let gy = 0; gy < WT_HIGH; gy++) {
    const v = watAt(gx, gy, gz);
    if (v > WT_MIN) top = gy + v;
  }
  return top;
}
/* 把水加進某一格，回傳**真的加進去多少**。頂到格數上限時回 0——
   呼叫端要把沒加進去的水留著（吃掉的話畫面上的水會憑空變少）。 */
function addWater(gx, gy, gz, v) {
  const W = newWater(), k = wkey(gx, gy, gz);
  const c = W.cells.get(k);
  if (c) { const put = Math.min(v, 1 - c.v); c.v += put; return put; }
  if (W.cells.size >= WT_CELLS) return 0;          // 保險絲：不會無限長
  const put = Math.min(1, v);
  W.cells.set(k, { gx, gy, gz, v: put, f: 63, rim: 0, sub: 0, sup: 0, hd: 0,
                   h: put, hv: put, sb: [0, 0, 0, 0], vis: put > WT_SHOW ? 1 : 0 });
  return put;
}
/* 把 amount 格的水倒進落點附近，回傳真的倒進去多少。

   **形狀比總量重要。** 一格只裝得下 1 格的水，一柱水（不管幾格高）一拍也只送得走
   一格的量——所以「一拍要塞 46 格」如果就近硬塞，會鋪成一片 12×11 格的水牆往下砸
   （實測；使用者：「點在杯子內壁看起來瞬間出水量太大」）。分兩段倒：

   ① **一道水流**：從桶口往下灌，一格灌到半格（見 WT_STREAM）再往下一格，直到踩到
      水面或地板——看得見的那股水就是這一柱，一格寬，就是從桶口倒出來的樣子。
   ② **剩下的從落地那一格灌進去**：那裡是水面下／地板上，畫面上就只是水位在漲，
      不會有一大片水憑空出現在半空中。

   桶口泡在滿的水裡要先往上找到水面，不然 BFS 只能在滿的水裡繞、繞不出去就一滴也
   倒不進去（點在杯壁內側、或杯子越裝越滿都會遇到）。

   ②那段 **一定要用 BFS 走出去，不能一圈一圈掃座標**：掃座標會穿牆——
   使用者實測「點在杯子內側，杯子外面也有水」，就是那一圈掃過了杯壁、
   把水倒在牆外面的空氣裡。BFS 碰到實心就不再往那邊擴，水只會進得去走得到的地方。
   塞不下的留在 pour 裡等下一幀，水量不會憑空少。 */
function injectWater(gx, gy, gz, amount) {
  let left = amount;
  /* 保險：落點還是實心的話，**往上**找第一格空的當起點（不然一滴都倒不出來）。
     只往上、不往旁邊：旁邊那一格可能在牆的另一邊，那樣水會倒到建築背面的地上去
     （使用者：「點杯壁內側，實際出水的點卻穿過建築，變成在背後的地面出水」）。
     往上倒最多就是從屋頂淋下來，看起來還說得過去。 */
  if (solidAt(gx, gy, gz)) {
    let ok = false;
    for (let up = 1; up <= WT_HIGH && !ok; up++)
      if (!solidAt(gx, gy + up, gz)) { gy += up; ok = true; }
    if (!ok) return 0;
  }
  /* 桶口泡在水裡：往上找到水面那一格（那一格還有空間，倒得進去）。
     只能穿過**站住的滿水**（c.sup）：不加這個條件的話，桶口會踩著自己上一幀倒出來的
     那道水流一路往上爬，倒個幾秒就爬到天上去了（實測從第 20 層爬到第 66 層）。 */
  for (let k = 0; k < WT_HIGH; k++) {
    const wc = water && water.cells.get(wkey(gx, gy, gz));
    if (!wc || !wc.sup || wc.v < 1 - WT_LEVEL) break;
    if (solidAt(gx, gy + 1, gz)) break;
    gy++;
  }
  /* ① 往下灌成一道水流。一格只灌到 WT_STREAM（半格），**不能灌滿**：
     灌滿的一柱水彼此讓不出空間（腳下那一格是滿的就掉不下去），踩到地面之後整柱都算
     「站住了」，於是在半空中往旁邊塌下來——實測就是一大塊 8×7 格的水牆。
     半格正好是自由落下的平衡點（一拍掉一格，要讓出多少就得空出多少），
     一直接得上、一直往下掉；畫出來接不接得起來是 WT_AIR 那邊的事。 */
  for (let k = 0; k < WT_HIGH && left > 1e-4; k++) {
    const room = WT_STREAM - watAt(gx, gy, gz);
    if (room > 0) left -= addWater(gx, gy, gz, Math.min(left, room));
    if (gy <= 0 || solidAt(gx, gy - 1, gz)) break;          // 踩到地板
    /* 踩到水面：剩下的從水面下灌。只算**站住的水**（c.sup）——
       不加這個條件的話，下一拍會把自己上一拍倒出來的那道水流當成水面，
       就在半空中那一層往旁邊鋪開來（實測平地倒一桶會疊出 8×7 格的水塊）。 */
    const bc = water && water.cells.get(wkey(gx, gy - 1, gz));
    if (bc && bc.sup && bc.v > WT_MIN) { gy--; break; }
    gy--;
  }
  /* ② 剩下的從落地那一格走出去：**一層一層填**，這一層走得到的地方填滿了才往上一層。
     一個佇列混著往旁邊也往上走的話（一般的 BFS），填出來會是一顆立體的水球——
     實測平地倒一桶會在半空中疊出 8×7 格、二十層高的水塊，那正是使用者說的
     「瞬間出水量太大」。一層一層填的話，畫面上就只是水位一層一層漲上來。 */
  let cur = [gx, gz];                              // 這一層要走的欄位（攤平存 x,z）
  let nodes = 0;
  for (let lv = 0; lv < WT_HIGH && left > 1e-4 && nodes < WT_POUR_N * 2; lv++, gy++) {
    const seen = new Set();
    for (let i = 0; i < cur.length; i += 2) seen.add(cur[i] + ':' + cur[i + 1]);
    const up = [];                                 // 這一層倒得進去的欄位＝上一層的起點
    for (let i = 0; i < cur.length && left > 1e-4 && nodes < WT_POUR_N * 2; i += 2, nodes++) {
      const x = cur[i], z = cur[i + 1];
      if (solidAt(x, gy, z)) continue;             // 實心：不倒、也不從這裡往外走
      left -= addWater(x, gy, z, Math.min(left, 1 - watAt(x, gy, z)));
      up.push(x, z);
      for (const d of DIR4) {
        const nx = x + d[0], nz = z + d[1], k = nx + ':' + nz;
        if (!seen.has(k)) { seen.add(k); cur.push(nx, nz); }
      }
    }
    if (!up.length) break;                         // 這一層一格都倒不進去：上面也不用試
    cur = up;
  }
  return amount - left;
}
/* 倒一桶。n × vol ＝ 總共幾格的水（預設 100 × 23 ＝ 2300）。 */
function pourBucket(x, y, z, n, vol) {
  const total = (n || 1) * (vol || WB_VOL);
  newWater().pours.push({ gx: cellX(x), gy: Math.max(0, Math.round(y)), gz: cellZ(z),
                          x, y, z, left: total, rate: total / WB_POUR });
}
/* 點下去倒一桶。出水點**要用格子把射線重走一次**，不能直接拿 pick 給的落點：

   ① **落點本身是積木的表面**，那個點算起來還在積木自己那一格。在實心格裡的話
      injectWater 一開始就走不動，一滴都倒不出來（v1.82 踩過）。
   ② **射線鑽得過積木之間的縫**：積木畫出來只有 0.94 格寬（BS），上下左右都留 0.06 格的
      縫。射線正對著縫或很擦邊地飛過去時真的會穿過去，pick 就回報打到牆**後面**的東西
      ——使用者：「我點杯壁內側，看起來實際出水的點好像判定穿過建築了，變成在背後
      （就像沒建築）的地面出水」。很陡的射線也會從**橫縫**鑽進去、打到下面那一塊的頂面
      （對玩家來說那就是杯壁內側），那種落點本身就在牆裡。

   所以沿著射線**從鏡頭那頭往落點走**（`hit.dist` ＝ 射線飛了多遠），碰到第一個實心格
   就停在它前面。停下來的位置一定在玩家看得到的那一面外側、而且一定不是實心格。
   一步 0.3 格（＜半格，不會跳過中間那一格）。
   **不能改成「往旁邊找一格空的」**（v1.84 的做法）：旁邊那一格可能在牆的另一邊，
   水就倒到建築背面的地上去了。 */
function pourWater(hit) {
  const d = hit.dir || { x: 0, y: -1, z: 0 };
  const solidHere = (x, y, z) => solidAt(cellX(x), Math.max(0, Math.round(y)), cellZ(z));
  let x = hit.point.x, y = hit.point.y, z = hit.point.z, got = false;
  /* 沒有 dist 的呼叫端（測試用的假 hit）就只往回走 2 格——不知道鏡頭在哪的話走遠了
     會走到鏡頭後面的積木裡去。 */
  for (let t = Math.min(hit.dist || 2, 60); t >= 0; t -= 0.3) {
    const qx = hit.point.x - d.x * t, qy = hit.point.y - d.y * t, qz = hit.point.z - d.z * t;
    if (solidHere(qx, qy, qz)) { if (got) break; continue; }   // 鏡頭本身在積木裡：跳過
    x = qx; y = qy; z = qz; got = true;
  }
  if (!solidHere(x, y + WB_UP, z)) y += WB_UP;     // 出水口比落點高一點（上面是積木就不抬）
  pourBucket(x, y, z, WB_DROPS);
  sndWater();
}

function stepWater(dt) {
  if (!water) return;
  const W = water;
  // 倒水：一下的量分 WB_POUR 秒倒完（塞不下就留著，下一幀再塞）
  for (let i = W.pours.length - 1; i >= 0; i--) {
    const p = W.pours[i];
    const give = Math.min(p.left, p.rate * dt);
    p.left -= injectWater(p.gx, p.gy, p.gz, give);
    sprayAt(p.x, p.y - 0.3, p.z, 0.45);
    if (p.left <= 1e-3) W.pours.splice(i, 1);
  }
  /* 水用固定的拍子算（跟畫面幀率無關，4× 速也不會算出不一樣的結果）。
     一幀最多追 4 拍：追不上就不追，不然卡一下之後會爆一長串。 */
  W.acc += dt;
  W.wave += dt;                                    // 水面波紋的相位（畫面那邊用）
  for (let k = 0; k < 4 && W.acc >= WT_TICK; k++) { waterTick(); W.acc -= WT_TICK; }
  if (W.acc > WT_TICK) W.acc = WT_TICK;
  /* 畫出來的水面**追**實際水位，不是直接等於它（v1.94.1）。兩個毛病一起治：
     ① 水一秒只算 30 拍（WT_TICK）而畫面跑 60 幀，直接畫 c.h 的話水面兩幀才動一次——
        實測只推水、連續 16 幀，變動的像素是 0／18801／0／14500／0…完全交替。
     ② 一拍之內一格的水位可以改 0.3 格以上（WT_FLOW 一次搬走半個差額），
        於是每幀有十幾格整格跳一下——那是「一跳一跳」看到的東西。
     v1.93 也是這樣跳（0／8867／0…），只是那時候水是一片均勻的死藍：同一份幾何
     只換材質實測，不吃光每幀變動 1199 個像素、吃光 6121 個（5 倍）——**動的一直都在動，
     是吃光之後才看得出來**。
     用時間常數（不是每幀固定比例）才跟幀率無關：1 - e^(-dt/τ)。站住的水給 0.1 秒，
     看起來像水面有慣性；**半空中的水幾乎不延遲**——落下的水一拍本來就該掉一格，
     那個要延遲的話水柱會斷成一節一節。
     面（c.f）不追——那是每一拍算好的，這裡只動高度。 */
  const kS = 1 - Math.exp(-dt / WT_EASE), kA = 1 - Math.exp(-dt / WT_EASE_AIR);
  for (const c of W.cells.values()) c.hv += (c.h - c.hv) * (c.sup ? kS : kA);
  W.wt -= dt;
  if (W.wt <= 0) { W.wt = WB_WET; wetByWater(); }
  if (!W.cells.size && !W.pours.length) water = null;
}

/* 一拍：往下掉 → 往旁邊攤 → 滲掉。 */
function waterTick() {
  const W = water, cs = W.cells;
  const list = [];
  for (const c of cs.values()) list.push(c);
  /* **由下往上**處理：下面那一格先把水讓出去，上面那一格這一拍才掉得下來，
     整條水柱才會一起往下移（由上往下處理的話一拍只有最底下那一格會動）。 */
  list.sort((a, b) => a.gy - b.gy);
  /* 每一格的**水壓**＝這一柱的水面高度 − 這一格的頂（頭上壓了幾格水）。
     先用「每柱水面」算一次（一格一格往上數會是幾萬次查表）。
     出口那一格頭上其實沒有水，壓力是從水缸那邊「傳」過來的——見下面往旁邊攤那段。 */
  const colTop = new Map();
  for (const c of list) {
    const k = c.gx + ':' + c.gz, t = c.gy + c.v;
    if (!(colTop.get(k) >= t)) colTop.set(k, t);
  }
  for (const c of list) {
    const own = Math.max(0, colTop.get(c.gx + ':' + c.gz) - (c.gy + c.v));
    /* 取「自己頭上壓的水」與「上一拍從水缸那邊傳過來的壓力（每拍衰減 1）」的大的那個。
       只用自己頭上的水的話，破口出口那一格每一拍都被歸零——傳過來的壓力還沒用到就沒了，
       噴不出去（實測只甩得到 2 格）。 */
    c.hd = Math.max(own, (c.hd || 0) - 1);
  }

  for (const c of list) {                          // ① 往下掉
    if (c.v <= 0) continue;
    const gy = c.gy - 1;
    if (gy < 0 || solidAt(c.gx, gy, c.gz)) { c.sup = 1; continue; }   // 站在地面／積木上
    const bl = cs.get(wkey(c.gx, gy, c.gz));
    const move = Math.min(c.v, 1 - (bl ? bl.v : 0), WT_FALL);
    /* 只挪得動一點點就當它**站住了**（下一段才會往旁邊攤）。
       這裡不能只判斷「腳下滿了沒有」：腳下那一格是 0.997 這種數字時 room 還有 0.003，
       水就會一直往下滴 0.003、永遠不算站住、也就永遠不往旁邊攤——
       實測倒進馬克杯的水會變成一根 26 格高的細柱站在杯子裡不肯攤平。

       **c.sup ＝ 腳下那一疊水一路撐到地面／積木**（由下往上算，所以下面那格已經算好了）。
       半空中的水不算站住：往下掉的水不會往旁邊散開，一柱水掉下去就是一柱
       （不分這件事的話，一股水掉個十幾格就散成一大片薄薄的水簾——
       使用者：「往下流的水體只有頂部一層的感覺」）。 */
    if (move <= WT_LEVEL) { c.sup = bl && bl.sup && bl.v >= 1 - WT_LEVEL ? 1 : 0; continue; }
    c.v -= move;
    addWater(c.gx, gy, c.gz, move);
    c.sup = 0;
    if (move > 0.25) sprayAt(wldX(c.gx), c.gy, wldZ(c.gz), WT_SPRAY);
  }
  for (const c of list) {                          // ② 往旁邊攤（只有站在東西上的才攤）
    if (c.v <= WT_MIN || !c.sup) continue;
    for (const d of DIR4) {
      const nx = c.gx + d[0], nz = c.gz + d[1];
      if (solidAt(nx, c.gy, nz)) continue;
      const nv = watAt(nx, c.gy, nz);
      const diff = c.v - nv;
      if (diff <= WT_LEVEL) continue;
      /* 什麼算「往外流」：**倒過去的水會自己掉走**——鄰居腳下不是實心，而且腳下那一格
         還有空間。破口、屋簷邊就是這樣；杯子裡不是（每一格腳下都是滿的水），所以杯內
         的水只會慢慢找平，不會互相亂甩。
         這個判斷只看鄰居腳下，不看「鄰居那一柱的水面高不高」：看水面的話，破口一開始
         流，外面那一柱馬上就被自己流出去的水填起來，判斷就失效了（v1.83 踩過）。
         **地面那一層（gy 0）不算往外流**：地底下沒有東西擋著，不排除的話整片地面水
         每一格都以為自己在瀑布邊，一路往外飆——實測一下的水會鋪成 183 格寬。 */
      const spill = c.gy > 0 && !solidAt(nx, c.gy - 1, nz) &&
                    watAt(nx, c.gy - 1, nz) < 1 - WT_LEVEL;
      /* 往外流多少看**水壓**：頭上壓 h 格水，一格出口一拍推得出 √h × WT_ORI 格的水
         （托里切利：出口流速 ∝ √h）。只按高低差搬一半的話，破口內外一樣滿、差值幾乎是
         零，整杯水一秒只漏 56 格，看起來像在滴水（使用者：「先裝水然後打破側面出水，
         應該更大量更快速湧出才正常」）。
         推力再大也搬不走比一格多的水（1 − nv）——真正的上限是外面那一柱掉得多快。 */
      let move = spill ? Math.min(c.v, 1 - nv, diff + WT_ORI * Math.sqrt(c.hd))
                       : Math.min(c.v, 1 - nv, diff * WT_FLOW);
      /* **開一格新的水**才有門檻：薄薄一層還往外開新格的話，開出來的馬上又乾掉、
         又往外開——實測地面上每一幀有九百格生出來、九百格消失，整片水在閃。
         但「跟已經有水的鄰居互相平衡」不設門檻：設了的話薄水會卡成互不相讓，
         中間乾掉的那幾格補不回來，畫面上就是水裡有幾個會閃的洞（使用者第二次回報）。 */
      if (nv <= WT_MIN) {
        if (c.v < WT_STILL) continue;
        if (move < WT_SEED) move = Math.min(WT_SEED, c.v);
      }
      if (move <= 1e-4) continue;
      /* **水壓**：這一格頭上壓了幾格水，往外就甩幾格遠。
         往外那一格腳下是空的（＝破口、屋簷邊）才算——那才是「噴出去」。
         不然水只會滴在破口正下方（使用者：「應該會有一定水壓，噴遠一點」）。 */
      /* 往外那一格腳下是空的（＝破口、屋簷邊）＋ 有水壓 → **噴出去**。
         這一份水沿著一條拋物線鋪出去（往外 k 格、往下 k²/2r 格），不是傳送到最遠
         那一格。只放最遠那一格的話，水會憑空出現在遠處再往下掉，看起來就不像噴的
         （使用者：「噴出去立刻就往下落，導致看起來沒有噴出來」）。 */
      const reach = spill ? Math.min(WT_JET, Math.floor(c.hd * WT_JET_K)) : 0;
      c.v -= move;
      let left = move;
      if (reach > 0) {
        const n = reach + 1;
        for (let k = 1; k <= n && left > 1e-5; k++) {
          const ax = c.gx + d[0] * k, az = c.gz + d[1] * k;
          const ay = c.gy - Math.floor(k * k / (2 * n));       // 拋物線：越遠越低
          if (ay < 0 || solidAt(ax, ay, az)) break;
          const share = Math.min(left, move / n);
          const put = addWater(ax, ay, az, share);
          left -= put;
          const tc = water.cells.get(wkey(ax, ay, az));
          /* 水壓跟著水一起往外傳，每走一格掉 1：出口那一格頭上沒有水，壓力是水缸給的。
             不傳的話出口只會滴在腳邊（實測甩不到 2 格，傳了之後 4 格）。 */
          if (tc && c.hd - k > (tc.hd || 0)) tc.hd = c.hd - k;
          if (k > 1) sprayAt(wldX(ax), ay, wldZ(az), 0.35);
        }
      } else {
        left -= addWater(nx, c.gy, nz, move);
        const tc = water.cells.get(wkey(nx, c.gy, nz));
        if (tc && c.hd - 1 > (tc.hd || 0)) tc.hd = c.hd - 1;
      }
      c.v += left;                                 // 放不下的水留在原地，不吃掉
    }
  }
  /* ③ 滲掉、收掉乾了的。只有**貼著地面／積木**的那一格會滲（一疊水的最底下那一格），
     不然一疊 20 格高的水會 20 格一起滲，一下就乾了。 */
  for (const c of list) {
    if (c.gy === 0) c.v -= SEEP_G * WT_TICK;
    else if (solidAt(c.gx, c.gy - 1, c.gz)) c.v -= SEEP_B * WT_TICK;
    if (c.v <= WT_MIN) cs.delete(wkey(c.gx, c.gy, c.gz));
  }
  faceMask();
}

/* 每一格**畫出來多高**（c.h），以及哪幾面看得到（c.f）。每拍算一次，畫的時候直接用。

   高度：站住的水就是水量本身——那才是水面。**半空中的水要拉高**（WT_AIR 倍、上限一格）：
   一柱自由落下的水每格最多只裝得到 0.5 格（一拍掉一格，這一格要讓出多少、下一格就
   得空出多少，平衡點就在一半），照著 0.5 畫的話每一格中間都空半格，畫出來是一疊薄片
   ——使用者：「往下流的水體只有頂部一層的感覺」。一拍掉一格的水本來就掃過整格，
   拉到滿格才接得成一股水；水量本身沒有變，只有畫出來的高度。

   位元：1=+x　2=−x　4=+z　8=−z　16=底面　32=頂面（對應引擎的 putPools）。
   旁邊那一格比自己低（或是積木、或是空的）→ 那一面就看得到；一樣高就不畫——
   被水包住的面根本不存在，一大片水才不會疊出方格紋。
   頂面／底面比的是「滿不滿」：半滿的那一格上面就是空氣，看得到水面。 */
function faceMask() {
  const cs = water.cells;
  for (const c of cs.values()) {
    const up = cs.get(wkey(c.gx, c.gy + 1, c.gz));
    c.sub = up && up.v > WT_SHOW ? 1 : 0;          // 頭上有水＝泡在水裡
  }
  for (const c of cs.values()) {
    /* **泡在水裡的格子一律畫成滿格。** 它裡面不可能有空氣——頭上壓著一整格水。
       照著 c.v 畫的話那 0.97、0.98 的零頭會讓它的側面矮一點點，而水一直在流動，
       那個零頭每一拍都在改：實測滿杯 5383 格裡有 4651 格泡在水裡，於是幾千道側面
       每兩幀抖一次。畫成滿格之後只有**真正的水面**那一層在動（732 格），
       而那一層本來就該動。水量 c.v 一滴都沒變，只有畫出來的高度。 */
    if (c.sub) { c.h = 1; continue; }
    /* 「半空中」（要畫成 WT_AIR 倍高）**不能直接用 c.sup 判斷**（v1.94.2）。
       sup 要求腳下那一格 v ≥ 1 − WT_LEVEL（0.98），而杯子裡那層薄薄的水面坐在
       0.97～1.00 的那一格上——0.97 那一拍 sup 就翻成 0，這一格立刻被當成半空中的水、
       畫成兩倍高，下一拍又翻回來。實測靜止的馬克杯裡有一格 v 一直是 0.231，
       畫出來的高度卻在 0.231 ↔ 0.462 之間跳，而且一次七八十格一起跳
       ——使用者：「靜止水面會高一下高一下」。這是 v1.81 就在的，v1.94.0 水面開始吃光
       才看得見（不吃光的時候整片同一個藍，跳一下幾乎不換像素）。
       所以這裡自己判斷：**腳下那一格有大半格水就算站住了**。真正在落下的那一柱，
       每格最多只裝到 0.5 格（一拍掉一格的平衡點），離 0.75 有夠遠，照樣會被拉高。 */
    const bl = cs.get(wkey(c.gx, c.gy - 1, c.gz));
    const stand = c.sup || (bl && bl.v > WT_STAND);
    c.h = stand ? c.v : Math.min(1, c.v * WT_AIR);
  }
  /* 先標出「頭上有水」的格（v1.94.1）。這是「被水包住的面根本不存在」缺的那一半：
     原本頂面只看自己滿不滿（`c.h < 1 - WT_LEVEL`），所以一格 0.97 滿、頭上還壓著一整格水，
     照樣畫一片水面出來——那是**水體內部**的面，疊在別的面後面只是讓水變濃，
     而且水在流動時每一拍都在生生滅滅。實測滿杯（5383 格）：真正的水面只有 193 格，
     卻畫了 749～1135 片，一幀最多 513 格在改自己的面——那就是使用者看到的「一跳一跳」。
     用 v（真實水量）而不是 h（畫出來的高度）判斷「頭上有沒有水」，門檻取跟畫不畫
     同一個 WT_SHOW：門檻不一致的話會出現「上面那格沒畫、下面那格又不畫頂面」的破洞。 */
  for (const c of cs.values()) {
    let f = 0, rim = 0;
    for (let k = 0; k < 4; k++) {
      /* 差 WT_SHOW 以上才畫側面：一片水深淺差個 0.03 格的話，那道側面是看不見的細絲，
         但一格會多算一面——實測一片 2000 格的地面水會多出四千多面，把引擎的頂點上限
         吃掉，後面的水就整格畫不出來（破口的水柱就是這樣被丟掉的）。
         **兩邊都泡在水裡的那道台階不畫**：它在水體內部。旁邊那格自己的水面露在外面時
         要畫，不然會從那個台階看穿進水體裡。旁邊根本沒有水（積木、杯壁、空氣）
         一律要畫——破口噴出來的那股水就是這樣才有側面。 */
      const n = cs.get(wkey(c.gx + DIR4[k][0], c.gy, c.gz + DIR4[k][1]));
      /* 遲滯（v1.94.1）：**已經在畫的**維持原門檻，**還沒畫的**要差兩倍才生出來。
         單一門檻時，深淺剛好在門檻附近的兩格會一拍畫一拍不畫——實測一幀有三十幾格
         在翻面，那是補間之後還剩下的抖動來源。消失門檻不放寬（維持 WT_SHOW），
         所以面數只會比原本少，不會多吃頂點上限。 */
      const on = (c.f & (1 << k)) !== 0;
      if (!n || (n.h < c.h - (on ? WT_SHOW : WT_SHOW * 2) && !(c.sub && n.sub))) f |= 1 << k;
      /* 那道側面**從哪裡開始畫**（v1.94.1）。旁邊也是水的話，低於它水面的那一段
         在它的水體裡面，畫出來只是多疊一層——所以只畫「它的水面到我的水面」這一段。
         這件事是這次最關鍵的一刀：原本一律從格底畫到格頂，於是**0.05 格的高低差
         會讓一整片全格高的面出現或消失**，水一流動每拍有兩百多道在生滅，
         那就是「一跳一跳」看起來最重的來源。改成只畫露出來的那一小段之後，
         同一次生滅只換掉幾個像素。旁邊沒有水（積木、杯壁、空氣）還是整格畫。 */
      c.sb[k] = n ? Math.min(n.h, c.h) : 0;
      /* 外緣（v1.94，給畫面那邊的泡沫用）：旁邊那格**根本沒有水**——水體到這裡就結束了，
         或者旁邊是積木／杯壁。不能用上面那個「有側面」來判斷：一片還在攤開的水，
         每格深淺差個 0.1 格就會標出側面，那樣幾乎每一格都算外緣，畫出來是一片白磁磚（踩過）。 */
      if (!n || n.v <= WT_SHOW) rim = 1;
    }
    const bl = cs.get(wkey(c.gx, c.gy - 1, c.gz));
    /* 腳下沒接滿 → 看得到底面。但「自己泡在水裡、腳下那格也有水」的話，那個縫是
       水體內部的氣泡，不畫。**腳下根本沒有水就一定要畫**——正在落下的那股水，
       下緣就是靠這一面（見上面 WT_AIR 那段）。 */
    if (c.gy > 0 && (!bl || bl.h < 1 - WT_LEVEL) && !(c.sub && bl && bl.v > WT_SHOW) &&
        !solidAt(c.gx, c.gy - 1, c.gz)) f |= 16;
    if (!c.sub) f |= 32;                           // 頭上沒水才有水面
    c.f = f;
    c.rim = rim && !c.sub ? 1 : 0;                 // 泡沫不長在水裡面
  }
}

/* 畫面上的水：一格交一筆「從 y0 到 y1」＋ 哪幾面要畫。 */
const poolBuf = [];
function poolList() {
  poolBuf.length = 0;
  /* 跑兩趟：**先交半空中的水**（正在流的那幾格），再交站住的水。
     頂到引擎的格數／頂點上限時，被丟掉的是清單後面那些——眼睛在看的就是正在流的那股水，
     不能讓它排在一整杯靜水後面被丟掉（那正是「破口在流水卻看不到水柱」的原因）。 */
  for (let pass = 0; pass < 2; pass++)
    for (const c of water.cells.values()) {
      if ((pass === 0) === !!c.sup) continue;
      /* 遲滯：水多過 WT_SHOW 才開始畫，少到 WT_MIN 才停——
         只用一個門檻的話，滲到門檻附近的那一格會一幀有一幀沒有地閃。 */
      if (c.v > WT_SHOW) c.vis = 1;
      else if (c.v <= WT_MIN) c.vis = 0;
      if (!c.vis) continue;
      poolBuf.push({ x: wldX(c.gx), z: wldZ(c.gz), y0: c.gy,
                     y1: c.gy + Math.max(c.hv, WT_SHOW), f: c.f, rim: c.rim, sb: c.sb });
      if (poolBuf.length >= WT_CELLS) return poolBuf;
    }
  return poolBuf;
}

/* 碰到水的積木與小人要濕（跟消防車共用〈潮濕〉那一段）。每 WB_WET 秒跑一趟。
   先把水壓成「每一柱從第幾層到第幾層有水」（幾千格 → 幾百柱），再逐塊查一次表：
   逐塊去查 6 個鄰居格會是幾萬次查表，壓成柱之後跟改版前同一個成本。
   碎料被搬進水裡也算（不能只查蓋好的那些——泡在水裡的碎料點得著就說不過去）。 */
function wetByWater() {
  const W = water;
  if (!W.cells.size) return;
  const col = new Map();
  for (const c of W.cells.values()) {
    if (c.v < 0.12) continue;
    const k = c.gx + ':' + c.gz, e = col.get(k);
    if (!e) col.set(k, { lo: c.gy, hi: c.gy });
    else { if (c.gy < e.lo) e.lo = c.gy; if (c.gy > e.hi) e.hi = c.gy; }
  }
  const soaked = (e, y) => e && y >= e.lo - 1 && y <= e.hi;
  for (const b of blocks) {
    if (b.holder >= 0) continue;                   // 扛在人身上的不算（人自己會被淋到）
    const gx = cellX(b.x), gz = cellZ(b.z), y = Math.round(b.y - HB);
    if (soaked(col.get(gx + ':' + gz), y)) { wetBlock(b); continue; }
    for (const d of DIR4)                          // 貼著水的那一面牆
      if (soaked(col.get((gx + d[0]) + ':' + (gz + d[1])), y)) { wetBlock(b); break; }
  }
  for (const w of workers) {
    if (w.wet > WET_TIME - 0.5) continue;          // 剛淋過就不必再算一次
    const e = col.get(cellX(w.x) + ':' + cellZ(w.z));
    if (soaked(e, Math.max(0, Math.round(w.y)))) wetWorker(w);
  }
}

/* 水花：正在往下流的水、倒水口那一帶灑的小水珠。走現成的塵霧粒子池，0 個新 draw call。 */
function sprayAt(x, y, z, chance) {
  if (Math.random() > chance || dust.length > WB_DUST) return;
  dust.push({
    x: x + rr(-0.45, 0.45), y: y + rr(0, 0.9), z: z + rr(-0.45, 0.45),
    vx: rr(-0.8, 0.8), vy: rr(-1.5, 0.5), vz: rr(-0.8, 0.8),
    rx: Math.random() * 6, ry: Math.random() * 6,
    life: rr(0.25, 0.5), s: rr(0.24, 0.42), fade: 0.4,
    cr: 0.42, cg: 0.74, cb: 1, g: WATER_G, keep: 1
  });
}
function splashFx(x, y, z) {
  for (let i = 0; i < 5; i++) sprayAt(x, y, z, 1);
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
/* 煙火自己的粒子配額（只管往上竄那幾發的尾巴與二次炸開的火花）。
   通用的 HOT_MAX（220）是「爆炸火球＋幾棟在燒」抓的，跟它共用會互相排擠。
   火星本身不吃這個配額——它是每幀重畫的一條拖線，見 fwStreaks。 */
const FW_HOT = 240;
/* 火星畫成一條拖線，不是沿路灑一串小點（v1.58）。
   參考圖那種放射狀的細線是長曝光：一顆火星在底片上留下一整條軌跡。
   照舊那樣「每秒灑 30 顆小方塊」做不出來——一場齊射有三百多顆火星，
   配額 300 顆平均下來每顆火星只分得到一顆粒子，畫出來就是一片閃爍的點。
   改成一顆火星一條線之後，一顆火星只吃一個 instance，長度還能跟著速度走。 */
const FW_TAIL = 0.34;               // 拖線代表最近這麼多秒的軌跡（速度 × 它 = 線長）
const FW_TAIL_MAX = 9;              // 線最長到這裡，剛炸開那一瞬間不要拉成一條掃把
const FW_TAIL_W = 0.17;             // 線多粗
const FW_TAIL_MIN = 0.6;            // 慢到這個速度以下就不畫線了：那已經是一顆餘燼
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
function fwHot(x, y, z, c, s, life, sp, seg) {
  if (hot.length >= FW_HOT) {
    const i = hot.findIndex(h => h.fw);
    if (i < 0) return;
    hot.splice(i, 1);
  }
  const h = {
    x, y, z, vx: rr(-sp, sp), vy: rr(-sp, sp), vz: rr(-sp, sp),
    rx: Math.random() * 6, ry: Math.random() * 6,
    s, life, g: -1.2, grow: 0.96, cool: rr(0.3, 0.7),
    cr: c[0][0], cg: c[0][1], cb: c[0][2], to: c[1], fw: 1
  };
  // seg 有給就拉成一小段線（往上竄那一段的尾巴），沒給就是一顆亂翻的碎火
  if (seg) { h.dx = seg.dx; h.dy = seg.dy; h.dz = seg.dz; h.ln = seg.ln; }
  hot.push(h);
}
/* 每一顆火星的拖線：從「它 FW_TAIL 秒前所在的位置」拉到現在的位置。
   每幀重算，所以不進 hot（那裡放的是會自己活一段時間的粒子）。
   物件掛在火星身上重複用，不要每幀配置幾百個新的。 */
function fwStreaks(out) {
  for (const s of fwSparks) {
    const sp = Math.hypot(s.vx, s.vy, s.vz);
    if (sp < FW_TAIL_MIN) continue;
    const ln = Math.min(FW_TAIL_MAX, sp * FW_TAIL);
    const dx = s.vx / sp, dy = s.vy / sp, dz = s.vz / sp;
    const o = s.st || (s.st = { s: FW_TAIL_W, fw: 1 });
    // 位置擺在線段中點，頭才會落在火星身上（putFire 是以中心擺的）
    o.x = s.x - dx * ln * 0.5; o.y = s.y - dy * ln * 0.5; o.z = s.z - dz * ln * 0.5;
    o.dx = dx; o.dy = dy; o.dz = dz; o.ln = ln;
    // 最後 1.2 秒收成同色系的暗版，落下來那一段才看得出「這一發是綠的」
    const k = Math.min(1, s.t / 1.2), c0 = s.c[0], c1 = s.c[1];
    o.cr = c1[0] + (c0[0] - c1[0]) * k;
    o.cg = c1[1] + (c0[1] - c1[1]) * k;
    o.cb = c1[2] + (c0[2] - c1[2]) * k;
    out.push(o);
  }
}
/* 送去畫的火粒子＝hot ＋ 那幾百條拖線。沒有煙火在天上時直接把 hot 交出去，
   那是每幀都會跑到的路徑，不要白白複製一次。 */
const fireOut = [];
function fireList() {
  if (!fwSparks) return hot;
  fireOut.length = 0;
  for (const h of hot) fireOut.push(h);
  fwStreaks(fireOut);
  return fireOut;
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
                    t: life * rr(0.8, 1.2), c,
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
                    t: rr(0.6, 1.2), c: s.c, crack: 0 });
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
  if (best.hh < 0 && phase === 'done') phase = 'wreck';   // 同上（v1.102）
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
      /* 往上竄那一段的尾巴。這裡的一發是一個物件（不是幾百顆火星），
         所以灑得起 110/s；每一顆再沿著飛行方向拉成一小段，接起來就是一條線。 */
      f.em += dt * 110;
      const fsp = Math.hypot(f.vx, FW_RISE, f.vz);
      const seg = { dx: f.vx / fsp, dy: FW_RISE / fsp, dz: f.vz / fsp, ln: fsp / 110 * 1.6 };
      while (f.em >= 1) {
        f.em--;
        fwHot(f.x + rr(-0.08, 0.08), f.y, f.z + rr(-0.08, 0.08), f.c,
              rr(0.14, 0.24), rr(0.2, 0.45), 0.3, seg);
      }
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
    /* 這裡本來每秒灑 30 顆小方塊當尾巴。現在火星自己就是一條拖線（fwStreaks），
       再灑一層點只會把線糊掉，配額也是它在吃。 */
    if (s.t <= 0 || s.y <= 0.3) { fwSparks.splice(i, 1); continue; }
    /* 打到建築就從那一塊燒起來。中點也要驗：火星一幀跑得比一格寬，
       只看終點的話會直接穿過薄牆。 */
    // 房子也要點得著（v1.102）：blockAt 只認藍圖的格子表
    if (blockAt(s.x, s.y, s.z) || homeSolid(s.x, s.y, s.z)) {
      igniteAt(s.x, s.y, s.z); fwSparks.splice(i, 1); continue;
    }
    const mx = (px + s.x) / 2, my = (py + s.y) / 2, mz = (pz + s.z) / 2;
    if (blockAt(mx, my, mz) || homeSolid(mx, my, mz)) { igniteAt(mx, my, mz); fwSparks.splice(i, 1); }
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
  if (bp && nSpread) buildSlotOwner();
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
  if (b.hh >= 0) { spreadHomeFire(b); return; }        // 小人的家（v1.102）
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

/* 房子裡的火勢蔓延（v1.102）。跟地標那邊同一個規則（26 鄰接裡隨機挑一個點著），
   只是格子表換成房子自己的那一份。沒有這一段的話，房子只會燒掉被點著的那一塊——
   使用者要的是「所有破壞工具都作用得到」。 */
function spreadHomeFire(b) {
  const h = homes && homes.list[b.hh];
  if (!h || b.hk < 0) return;
  const s = h.slots[b.hk];
  const own = homeOwners();
  const off = Math.floor(Math.random() * NBR.length);
  for (let n = 0; n < NBR.length; n++) {
    const j = homeNbr(h, s, NBR[(n + off) % NBR.length]);
    if (j === undefined || !h.slots[j].filled) continue;
    const k = own.get(b.hh + ':' + j);
    if (k !== undefined && igniteBlock(blocks[k])) return;
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
   v1.59 起可以同時好幾顆（本來是「一次一顆，再點會改打新地點」）：
   一顆一個 instance，畫面成本跟顆數無關（引擎那邊七個部位共用一顆 InstancedMesh）。 */
const NUKE_WAIT = 2, NUKE_FALL = 0.8, NUKE_TOP = 130, NUKE_R = 30, NUKE_POW = 34;
const NUKE_MAX = 4;                 // 跟引擎的 NUKE_MAX 一致，多的把最早那顆擠掉
/* 彈頭在彈體模型的原點上（nukeGroup 的 y=0 附近），所以掃掠只要往前多探這麼一點，
   碰到的就是彈頭的鼻尖，不是等整顆彈體埋進屋頂才算。 */
const NUKE_NOSE = 1.8;
function callNuke(point) {
  if (!nukes) nukes = [];
  if (nukes.length >= NUKE_MAX) nukes.shift();     // 放太多顆就把最早那顆擠掉
  nukes.push({ x: point.x, y: NUKE_TOP + 3, z: point.z, s: NUKE_NOSE,
               t: NUKE_WAIT + NUKE_FALL, mark: 0, spin: 0 });
  // 警報一響，全場都開始跑（v1.96）。倒數多久就給他們跑多久
  alertFlee(point, NUKE_WAIT + NUKE_FALL);
  sndSiren();
}
function nukeHit(p) {
  explode(p, NUKE_R, NUKE_POW, false, true);      // true = 加風壓
  startCloud(p, NUKE_R);
}
/* 畫面上要畫的那幾顆（倒數中的還在天上等，不畫）。重用同一個陣列，不要每幀配一個新的 */
const nukeFly = [];
function stepNuke(dt) {
  if (!nukes) return;
  nukeFly.length = 0;
  for (let i = nukes.length - 1; i >= 0; i--) {
    const n = nukes[i];
    n.t -= dt;
    n.spin += dt * 1.7;
    if (n.t > NUKE_FALL) {
      n.mark -= dt;
      if (n.mark <= 0) { n.mark = 0.5; spawnRing({ x: n.x, y: 0, z: n.z }, 6); }
    } else if (n.t > 0) {
      const k = n.t / NUKE_FALL;                   // 1 → 0
      const py = n.y;
      n.y = k * k * NUKE_TOP + 3;                  // 平方 = 越掉越快
      /* 半路碰到建築就在碰到的那一點炸，跟隕石／投石機共用同一套掃掠判定。
         固定炸在 y=2.5 的話，打台北 101 這種高的會從樓頂穿到腳邊才炸，
         上半截等於沒被炸到——那是衝擊波半徑量得到的差別，不只是好不好看。 */
      if (sweepRock(n, n.x, py, n.z)) {
        nukes.splice(i, 1);
        nukeHit({ x: n.x, y: Math.max(2.5, n.y), z: n.z });
        continue;
      }
      nukeFly.push(n);
    } else {
      nukes.splice(i, 1);
      nukeHit({ x: n.x, y: 2.5, z: n.z });         // 沒撞到東西：照樣炸在地面
      continue;
    }
  }
  ENG.putNukes(nukeFly);
  if (!nukes.length) nukes = null;
}

/* ── 爆裂魔法 ───────────────────────────────────────────
   魔法陣一層層往外長，最外圈就是等一下的爆炸範圍——
   讓你在那六秒裡看得出來會炸到哪。
   v1.59 起可以同時好幾個（本來是「一次一個，再點會移到新地點重來」）。
   一個陣要吃掉 15 個圓環（六層×2 ＋ 火種 3）與 6 片圓盤（火種 v1.62 起不墊盤），引擎那邊的池子
   照 MAG_CAST 開好了；沒用到的環是 visible=false，不佔 draw call。 */
const MAG_TIME = 6, MAG_R = 30, MAG_POW = 34;
const MAG_CAST = 3;                       // 最多同時幾個陣，跟引擎的池子大小綁在一起
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
/* 形狀是**上下大、中間細**的沙漏——最上最下那兩層最寬，中間四層錯落
   （不照大小排：由大到小再放大會太像一個規矩的陀螺，夾一層特別小、一層又鼓回來，
   看起來才像法陣不像機械零件）。
   v1.93 照使用者新給的參考圖把整疊撐寬（最寬 0.56 → 0.78R、最下那層 0.54 → 0.62R）：
   參考圖那疊是**寬而扁**的，最上面一圈是罩下來的一片大蓋子，比整疊的高度還寬一截。
   0.56R 那版最寬直徑 33.6、整疊高 22.5，比例上是一根柱子；撐寬之後直徑 46.8，
   超過疊高的兩倍，遠看才是參考圖那個輪廓。
   （高度不動：22.5 那組是使用者反映「太扁平」之後訂的，動高度會踩回那個問題。）
   每次施法再各自乘一個 0.82–1.18 的抖動（施法當下決定，不是每幀跳），
   所以每一發的大小都不一樣（使用者：「半徑保持有點隨機性」）。
   最寬的那一圈**一定**在兩端（中間那幾層的上限 0.46×1.18 ＝ 0.54 搶不到），
   但**兩端都會輪到**：最下那圈的上限 0.62×1.18 ＝ 0.73 大過最上那圈的下限
   0.78×0.82 ＝ 0.64，所以偶爾會反過來——實測 300 次是最上 278～287、最下 13～22。 */
const MAG_LAYER = [
  { r: 0.62, y: 0.40 },
  { r: 0.36, y: 0.55 },
  { r: 0.46, y: 0.70 },
  { r: 0.30, y: 0.85 },
  { r: 0.42, y: 1.00 },
  { r: 0.78, y: 1.15 }
];
const MAG_JITTER = 0.18;
const MAG_SPIN = 0.42;                    // 陣的轉速（rad/s，逆時針；六秒約轉 145°）
/* 最低那層的圓心高度。碎料被吸到這裡聚成一團，六秒一到也從這裡炸開——
   爆點放地面的話，火球會從那團碎料的下方冒出來，看起來像另一件事。 */
const MAG_CORE_Y = 0.12 + MAG_R * MAG_LAYER[0].y;
/* 整疊的頂端與最寬那一圈——施法期間的運鏡拿這兩個數字去算要退多遠。 */
const MAG_TOP = 0.12 + MAG_R * MAG_LAYER[MAG_LAYER.length - 1].y;
/* 半徑要算進每層的抖動上限（rj 最多 1+MAG_JITTER），還要算進邊上那些筆觸
   掃出去的那一截（引擎的 MAG_RIM_OUT，目前 1.2 倍）——不然最寬那圈的筆觸偶爾會被切到。 */
const MAG_WIDE = MAG_R * Math.max(...MAG_LAYER.map(l => l.r)) * (1 + MAG_JITTER) * ENG.MAG_RIM_OUT;
function castMagic(point) {
  /* 由下往上一層一層長，中間靠一個小火圈把火帶上去：
     先出現最下面那層 → 小火圈從它的圓心升到上一層的高度 → 抵達才擴張成新的一層。
     （原本是把六層的出現順序洗牌，每層各自憑空亮起來；改成固定順序＋看得見的火種，
     六層才像「一層帶起一層」而不是六件各自發生的事。每次施法的差異交給半徑、
     起始角度、轉速那三組抖動去做，那些本來就是每次都不一樣的。） */
  if (!magics) magics = [];
  if (magics.length >= MAG_CAST) magics.shift();     // 放太多個就把最早那個擠掉
  magics.push({
    x: point.x, z: point.z, t: MAG_TIME, shown: 0,
    // 每層的半徑抖動：施法當下抽一次存起來，每幀重抽的話整疊會一直閃
    rj: MAG_LAYER.map(() => rr(1 - MAG_JITTER, 1 + MAG_JITTER)),
    /* 每層的紋路起始角度各抽一個定值：六層都從同一個角度起跳的話，
       螺旋會完全對齊，整疊看起來像一支花紋對齊的柱子。 */
    sj: MAG_LAYER.map(() => rr(0, 6.28)),
    /* 轉速再各乘一個倍率：同速的話整疊像一塊剛體在轉，錯開才像好幾層各自運轉。
       全部都是正的——正的就是俯視逆時針，這是使用者指定的方向。 */
    wj: MAG_LAYER.map(() => rr(0.7, 1.35))
  });
  /* 整疊頂端在 34.6，貼著建築的取景裝不下（矮建築取景更近）。
     跟龍捲風、蘑菇雲同一套：施法期間鏡頭退到整疊進得了畫面的距離，
     爆完那朵雲會再接手撐住這個距離。 */
  ENG.holdWide(MAG_TOP, MAG_WIDE);
  alertFlee(point, MAG_TIME);             // 魔法陣一亮，全場就往外跑（v1.96）
}
function stepMagic(dt) {
  if (!magics) return;
  for (let i = magics.length - 1; i >= 0; i--)
    if (stepOneMagic(magics[i], dt)) magics.splice(i, 1);
  if (!magics.length) magics = null;
}
/* 一個陣的一幀。回傳 true = 這個陣炸掉了、可以從清單移除。 */
function stepOneMagic(magic, dt) {
  magic.t -= dt;
  const el = MAG_TIME - magic.t;
  if (magic.t <= 0) {
    const p = { x: magic.x, y: MAG_CORE_Y, z: magic.z };   // 爆點＝最低那層的圓心
    explode(p, MAG_R, MAG_POW, true, true);       // 第二個 true = 加風壓
    startCloud(p, MAG_R);             // 魔法爆完也留一朵，跟核彈同一種
    startArcs(p, MAG_R);              // 火球收乾之後，爆點還會劈三秒的藍電
    return true;
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
       只畫一個環的話它就只是地上一條帶子，不像在發光。
       配色 v1.62.1 照參考圖重排（使用者說「顏色也不對」）：參考圖是
       **桃紅的場 + 亮黃的鑲邊與線條**，外圈再暈出一圈紅粉——
       v1.54 那組（深紅的盤 + 金黃的暈）整疊偏紅橘，跟參考圖差一個色相。
       所以芯環改成**亮黃**（它就是參考圖裡那條最亮的鑲邊），盤另外用 fc 指定成**桃紅**
       （不指定的話盤會跟著芯變黃，整片糊成一大片黃，鑲邊就不見了），
       外暈改成**紅粉**。
       v1.67 三色各往橘黃挪一點點（使用者：「魔法陣顏色調整偏橘黃一點點」）：
       鑲邊 #ffe14a→#ffd33f、盤 #ef1f6b→#f33658、外暈 #ff3a6e→#ff4a5a。
       v1.93 換成使用者從新的參考圖挑出來的兩個色碼：**紅 #cb2306 ＋ 黃 #fcf534**。
       新的參考圖是火系的陣（紅橘的場、亮黃的線條），不是 v1.62 那張桃紅的，
       所以整疊從「桃紅」整批換成「紅橘」：盤直接吃 #cb2306、鑲邊吃 #fcf534。
       外暈不能照抄這兩個色碼——它是加法混色的，#cb2306 這種暗紅疊在亮綠的草地上
       幾乎看不見（v1.62.1 記過同一件事：黑底的參考圖搬到大白天的綠地要更濃）。
       所以外暈取**同色相、明度推滿**的 #ff2e0a（色相 8.8°，跟 #cb2306 同一度），
       它是盤的亮版而不是另一個顏色。
       紋路那條（引擎的 magSpokeMesh）跟著改成 #fcf534：參考圖裡盤上那些捲進去的
       線條就是這個亮黃。它本來要靠「比盤黃」跟盤分開，盤現在是暗紅的，分得更開。 */
    rings.push({ x: magic.x, z: magic.z, r: rad, y, spin, op: k,
                 c: 0xfcf534, fc: 0xcb2306, sp: 1, fill: 1 });
    rings.push({ x: magic.x, z: magic.z, r: rad * 1.04, y, spin,
                 op: k * 0.75, c: 0xff2e0a, add: 1 });
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
       照參考圖，這個火圈要的是三件事（v1.62 收成「單純的火圈」，v1.62.1 再修圓與配色）：
       ①**中間不墊那片填滿的盤**——參考圖裡它中間是空的、透得到背景，
         墊了盤就成了一團在發光的餅，不是一個圈。
       ②**正圓**。v1.62 曾經給它跟陣同一種火焰邊，使用者看了說「上升火圈要圓」，
         拿掉——它是一個乾淨的環，質感靠顏色的漸層，不靠邊緣的凹凸。
       ③三圈**貼著疊成一條管子**（半徑 1／1.07／1.14）。環的線寬是半徑的 7%，
         所以下一圈的內緣剛好接在上一圈的外緣上，三圈連起來就是一條有厚度的火環，
         顏色由內而外**接近白的亮黃 → 橘 → 紅粉**（照參考圖那圈的漸層；原本是
         1／1.2／1.75 加琥珀、橘紅，中間空一大段又整條偏橘）。三圈轉速統一。 */
    const fs = -el * MAG_SPIN * 3.4;                            // 轉得比陣快，才像在竄
    rings.push({ x: magic.x, z: magic.z, r: seedR, y: fy, spin: fs,
                 op: 1, c: 0xfff3c4, seed: 1 });
    rings.push({ x: magic.x, z: magic.z, r: seedR * 1.07, y: fy, spin: fs,
                 op: 0.9, c: 0xff8a3c, add: 1, seed: 1 });
    rings.push({ x: magic.x, z: magic.z, r: seedR * 1.14, y: fy, spin: fs,
                 op: 0.75, c: 0xff2f6b, add: 1, seed: 1 });
  }
  // 一層兩個環（芯 + 暈），所以要數層數不是數環數
  if (layers > magic.shown) {
    /* 新的一層剛開始長 → 就在那一圈上撒一把十字星光。
       撒的位置用「長好之後」的半徑，不是這一瞬間的（那時它才火種那麼大）：
       星光要先標出這一層將要長到哪，環再追上來。 */
    for (let i = magic.shown; i < layers; i++) starsOn(magic, i, STAR_PER);
    magic.shown = layers;
  }
  /* 長完之後也一直撒（v1.48）：只在長層那一下撒的話，滿陣那四秒整座陣是靜的。
     每次隨機挑一層，機率一樣——「平均撒在每一層」就是這個意思，
     不是每層各自計時（那樣看起來會像六排整齊的節拍器）。 */
  magic.star = (magic.star || 0) + dt * STAR_RATE;
  while (magic.star >= 1) {
    magic.star--;
    starsOn(magic, Math.floor(Math.random() * layers), 1);
  }
  magic.rings = rings;
  magSuck(magic, dt);
  implode(magic, dt);
  return false;
}

/* ── 往陣心捲進去的魔力粒子 ───────────────────────────────
   施法一開始就有，一路捲到爆炸：小、快、密，從陣外一路螺旋進陣心
   （就是等一下的爆點）。真的把牆一片片剝下來捲進去的是 implode（最後 CRUSH_AT 秒
   換成快速往內吸，見 crushIn），
   這些光點是那件事的前奏——六秒裡一直在說「能量正往那一點集中」。
   v1.47 之前這裡是一道從陣心往上衝的光柱，看起來像中心在冒煙：方向反了，
   陣是在吸不是在噴，所以整個掉頭。 */
/* 第 i 層的位置與長好之後的半徑 → 撒 n 顆星光。長層那一下與滿陣期間都走這裡，
   兩邊算法一致，星星才會剛好落在那一圈上。 */
function starsOn(magic, i, n) {
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
const IMP_TIME = 4.5;               // 倒數剩幾秒開始吸
/* 吸的這一整段路，總共剝得走幾成還站著的積木（v1.87，使用者指定
   「吸的過程共破壞兩成」）。v1.62～v1.86 是「倒數剩 0.3 秒，一幀之內抽兩成扯下來、
   速度算成剛好在爆炸那一刻抵達陣心」（crushIn）：吸的那四秒半建築完全沒事，
   然後忽然少兩成、緊接著就炸開——使用者看到的就是「忽然吸兩成然後爆炸飛出去」。
   現在整段吸的過程一直在剝，剝下來的跟碎料吃同一組力被捲進陣心，
   所以「先收縮、後爆發」是一件連續發生的事，不是兩件事接在一起。
   每幀的機率是 1−(1−這個數)^(dt/IMP_TIME)：整段加起來剛好兩成，而且跟幀率無關。 */
const MAG_TAKE = 0.2;
/* 吸的過程分兩段（v1.93，使用者指定「緩慢吸部分積木 → 爆炸前快速吸往爆炸中心 → 爆炸」）：
   前面 IMP_TIME−CRUSH_AT 秒是慢慢吸（一路剝牆，剝下來的被捲著繞進來），
   最後 CRUSH_AT 秒改成**快速往內吸**——範圍內的碎料全部改走算好的彈道，
   剛好在爆炸那一刻抵達陣心。
   這一段是 v1.87 連著 crushIn 一起拆掉的，使用者反映「快速往內吸的效果被你拿掉了」，
   所以收回來；但這次只搬碎料、不再多剝牆：剝走的兩成是慢吸那一段的事，
   v1.62～v1.86 那個「一幀之內抽兩成」不重演。
   0.6 → 0.3（v1.93.1，使用者：「最後 0.3 秒快速往內吸（速度快 看起來比較像是超強烈爆炸）」）：
   同一段距離用一半的時間走完，速度就翻一倍——收攏那一下更像被硬拽進去的，
   接在後面的火球才像「壓到極限才炸開」。0.3 也剛好是 v1.62～v1.86 那支 crushIn 的老數字。 */
const CRUSH_AT = 0.3;
/* 收攏成一顆多大的球。全部瞄同一個點的話，最後那幾幀整團會疊成一顆積木大小的小點，
   看起來像憑空消失；散成一小顆球才看得到那團被壓在一起的東西。 */
const CRUSH_BALL = 2.6;
/* 甩向陣心：速度算成剛好在爆炸那一刻抵達陣心附近的一個隨機點。
   水平是距離除以剩餘時間（遠的近的同時到）；垂直除了補高度差，還要加回這段路
   會被重力吃掉的 GRAV×T/2，不然整團會在半路往下沉，收攏的位置就不在爆點上。 */
function aimCore(m, b) {
  if (b.st === FREE) { if (b.cell) gridDel(b); b.st = FLY; b.rest = false; b.snap = 0; }
  const T = Math.max(0.08, m.t);
  b.vx = (m.x + rr(-CRUSH_BALL, CRUSH_BALL) - b.x) / T;
  b.vy = (MAG_CORE_Y + rr(-CRUSH_BALL * 0.8, CRUSH_BALL * 0.8) - b.y) / T + GRAV * T / 2;
  b.vz = (m.z + rr(-CRUSH_BALL, CRUSH_BALL) - b.z) / T;
}
/* 快吸開始那一下：範圍內已經是碎料的全部推上彈道（還站著的留到爆炸）。
   只跑一次，之後才剝下來的在 implode 裡當場甩——那時 m.t 更小，飛得更急。 */
function crushIn(m) {
  const R2 = MAG_R * MAG_R;
  for (const b of blocks) {
    if (b.st !== FREE && b.st !== FLY) continue;
    const dx = b.x - m.x, dz = b.z - m.z;
    if (dx * dx + dz * dz > R2) continue;
    aimCore(m, b);
  }
}
function implode(m, dt) {
  const k = Math.min(1, (IMP_TIME - m.t) / IMP_TIME);   // 0 → 1，越接近爆炸吸得越猛
  if (k <= 0) return;
  const fast = m.t <= CRUSH_AT;                         // 最後這一段改成快速往內吸
  if (fast && !m.crush) { m.crush = 1; crushIn(m); }
  const R = MAG_R, R2 = R * R;
  // 這一幀從還站著的積木裡剝走幾成（見 MAG_TAKE）
  const take = 1 - Math.pow(1 - MAG_TAKE, dt / IMP_TIME);
  let n = 0, own = 0;                 // own＝其中有幾塊是地標的（見 afterHit）
  for (const b of blocks) {
    if (b.st === CARRY || b.st === TOSS) continue;      // 小人手上的不動
    const dx = b.x - m.x, dz = b.z - m.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > R2) continue;
    /* 還站著的積木：這一幀抽中的當場剝下來，剝完就是碎料，下面那組吸力馬上吃得到；
       沒抽中的原地留著、連力都不加（SET 不吃速度，加了只是留一組舊速度給下次）。
       剝下來之後**不另外算彈道**：離爆炸還有好幾秒，光靠內吸就會被捲到陣心，
       而且看起來是「被吸過去」而不是「被丟過去」。 */
    if (b.st === SET) {
      if (Math.random() >= take) continue;
      const wasOwn = b.hh < 0;                      // breakBlock 會把 hh 清掉
      breakBlock(b, 0, 0, 0); n++; if (wasOwn) own++;
      if (fast) { aimCore(m, b); continue; }     // 快吸那一段剝下來的：當場甩向陣心
    }
    /* 快吸開始之後，已經在彈道上的就別再加力——再推一把會提早對穿過陣心，
       爆炸當下反而是散開的。這一段只補「剛滾進範圍的碎料」。 */
    if (fast) { if (b.st === FREE) aimCore(m, b); continue; }
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
  /* 記帳：計數、嚇小人、標記垮塌重算。半徑給 6（陣心那一圈）而不是 30，
     不然整個工地的小人都會被掀倒。 */
  if (n) afterHit(n, { x: m.x, y: MAG_CORE_Y, z: m.z }, 6, own);
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

/* ── 地面痕跡 ─────────────────────────────────────────────
   炸過的地方留一塊焦黑、隕石留一個坑，兩種都會漸漸淡掉（v1.88，使用者指定）。

   **為什麼是畫上去的，不是真的挖一個洞**：草地是一整塊 scale 出來的方塊
   （見引擎 setGroundSize），要挖洞得把那塊網格切開重建、洞口的側壁還要自己補。
   所以坑用**同心圈**畫：中間深、外面一圈翻出來的土（亮的），俯視角就讀得出是個坑。
   焦黑同一套，只是全部都是深色、也不需要那圈土。

   輪廓在生的時候就抽好（每片一個半徑倍率）：不抽是正圓，一眼看出是貼上去的；
   每幀重抽的話輪廓會一直抖。 */
const MARK_MAX = 24;          // 同時最多幾塊（滿了擠掉最舊那塊；引擎那邊的上限要一樣大）
/* 一塊活幾秒（v1.88.1，使用者指定「漸漸消失大概 3 秒就好」，本來是 26 秒）。
   淡的那一段占 MARK_FADE 秒，前面 1 秒維持全濃：整段線性淡的話，
   剛炸出來的那一塊就已經是半透明的，看起來像「痕跡本來就很淡」而不是「痕跡在消失」。 */
const MARK_LIFE = 3;
const MARK_FADE = 2;
const MARK_SCORCH_R = 0.55;   // 焦黑的半徑＝爆炸半徑的幾成
const MARK_CRATER_R = 0.5;    // 坑小一點：坑是砸出來的，不是燒開的
const MARK_JIT = 0.26;        // 輪廓抖動 ±幾成
const marks = [];
function spawnMark(point, R, crater) {
  /* 爆點比自己的半徑還高就不留：那是炸在屋頂上的那一發，地面沒被燒到。
     （魔法陣照樣留——火球半徑 30、陣心才 12.1，地面在火球裡面。） */
  if (point.y > R) return;
  if (marks.length >= MARK_MAX) marks.shift();
  /* 輪廓：兩道正弦疊起來，不是每片各抽一個亂數——各抽的話相鄰兩片沒有關聯，
     邊緣會長出一根一根的尖刺（實測就是一顆海星）。兩道諧波疊出來是圓潤的幾瓣，
     像燒開的一塊地。次數取整數圈才接得回起點。 */
  const j = [];
  const p1 = rr(0, 6.28), p2 = rr(0, 6.28), h = Math.random() < 0.5 ? 3 : 4;
  for (let i = 0; i < ENG.MARK_SEG; i++) {
    const a = i / ENG.MARK_SEG * Math.PI * 2;
    j.push(1 + MARK_JIT * (Math.sin(a * 2 + p1) * 0.6 + Math.sin(a * h + p2) * 0.4));
  }
  marks.push({ x: point.x, z: point.z, j, crater: crater ? 1 : 0, t: MARK_LIFE, a: 1,
               r: R * (crater ? MARK_CRATER_R : MARK_SCORCH_R) });
}
function stepMarks(dt) {
  for (let i = marks.length - 1; i >= 0; i--) {
    const m = marks[i];
    m.t -= dt;
    if (m.t <= 0) { marks.splice(i, 1); continue; }
    m.a = Math.min(1, m.t / MARK_FADE);
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
/* k 是尺寸倍率（不給就是 1）：魔法師杖頭那幾顆用的是同一套星，但只有魔法陣的兩成大——
   星星本身、散開的高度、往上飄的速度要一起縮，只縮大小的話會變成幾顆小星星飛得像煙火。 */
function spawnStars(x, z, y, rad, n, k) {
  k = k || 1;
  for (let i = 0; i < n; i++) {
    if (stars.length >= STAR_MAX) break;
    const a = Math.random() * Math.PI * 2;
    const r = rad * rr(0.45, 1.12);          // 有的落在圈內、有的甩到圈外一點
    /* 粉紫與金黃各半。全給暖色的話會跟紅陣糊在一起，粉的那幾顆才跳得出來。 */
    const pink = Math.random() < 0.55;
    stars.push({
      x: x + Math.cos(a) * r, y: y + rr(-1.8, 3.2) * k, z: z + Math.sin(a) * r,
      s0: rr(1.8, 3.6) * k, s: 0, rot: rr(0, 6.28), spin: rr(-1.3, 1.3),
      vy: rr(1.2, 3.4) * k, t: 0, life: rr(0.5, 0.95), op: 0,
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
const ARC_MAX = 6;               // **一處**爆點同時最多幾道（不是全場的額度，見 boltsOf）
const ARC_JIT = 0.13;            // 折點抖多開（爆炸半徑的倍率）
/* 正在放電的那幾處爆點。v1.67 從一個變數改成清單：本來後爆的那一發會把前一處
   **整個蓋掉**（`arcSrc = {...}`），所以同時開好幾個陣（v1.59 起最多三個）時，
   只有最後爆的那一發劈得出電——使用者回報的就是這件事。
   上限跟陣一樣是 MAG_CAST：三個陣同時爆就是三處在放電，真的更多就擠掉最早那處。 */
let arcSrcs = null;
const bolts = [];
function startArcs(p, R) {
  /* 等火球亮完才開始：火球本身就是一大顆加法混色的白光，這幾道電劈在裡面
     一條都看不到，等於白劈。 */
  if (!arcSrcs) arcSrcs = [];
  if (arcSrcs.length >= MAG_CAST) arcSrcs.shift();
  arcSrcs.push({ x: p.x, y: p.y, z: p.z, R, t: -FLASH_LIFE, next: 0 });
}
/* 這一處爆點現在場上有幾道電（含它自己岔出去的那些）。
   額度是**每一處**各算的：全場共用六道的話，三處同時放電就變成三處分六道，
   每一處都比原本稀疏——那不是「同時三處都在劈」該有的樣子。 */
function boltsOf(a) {
  let n = 0;
  for (const b of bolts) if (b.src === a) n++;
  return n;
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
  // src 記著是哪一處爆點劈的：六道的額度按爆點分開算（boltsOf）
  bolts.push({ pts, t: 0, life, op: 1, w: rr(0.16, 0.3), src: a });
  // 三成機率從中段再岔出一條短的：分岔是閃電的招牌，但每道都岔就變成一張網
  if (Math.random() < 0.3 && boltsOf(a) < ARC_MAX + 2) {
    const s = pts[3], b = Math.random() * Math.PI * 2, br = rr(0.15, 0.35) * a.R;
    bolts.push({
      pts: boltPts(s.x, s.y, s.z, s.x + Math.cos(b) * br, Math.max(0.6, s.y - rr(2, 8)),
                   s.z + Math.sin(b) * br, a.R * ARC_JIT * 0.6, 3),
      t: 0, life: life * 0.7, op: 1, w: rr(0.1, 0.18), src: a
    });
  }
}
function stepArcs(dt) {
  if (arcSrcs) {
    for (let i = arcSrcs.length - 1; i >= 0; i--) {
      const a = arcSrcs[i];
      a.t += dt;
      if (a.t >= 0) {
        a.next -= dt;
        // 間隔一定要往前推，不能等「有空位」才推——排滿時會變成無窮迴圈
        while (a.next <= 0) {
          if (boltsOf(a) < ARC_MAX) spawnBolt(a);
          a.next += rr(0.12, 0.3);
        }
      }
      if (a.t >= ARC_TIME) arcSrcs.splice(i, 1);
    }
    if (!arcSrcs.length) arcSrcs = null;
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
/* 記下「這一把用過了」。成就〈工具箱清空〉要的是每一種都試過，
   而水桶按住不放那條路不經過 useTool（見 startPourAt），所以抽成一支共用。 */
function markTool(id) {
  if (stats.tools.indexOf(id) < 0) { stats.tools.push(id); checkBadges(); }
}
/* 拿格子把 pick 的結果重驗一次。

   `pick` 是對**畫出來的積木**做射線判定，而積木畫出來只有 0.94 格寬（BS），上下左右都
   留 0.06 格的縫。射線正對著縫、或很擦邊地飛過去時真的會鑽過去，於是回報打到牆**後面**
   的東西——使用者最先是在水桶上看到的（「點杯壁內側，實際出水的點好像判定穿過建築了，
   變成在背後（就像沒建築）的地面出水」），其他工具也一樣：明明敲在牆上，破壞卻發生在
   後面那一塊、或是後面的地上。

   所以沿著同一條射線**從鏡頭那頭往落點走**（`hit.dist` ＝ 射線飛了多遠），一步 0.3 格
   （＜半格，不會跳過中間那一格）。真的有一格實心擋在前面、而且明顯比 pick 給的近
   （> 0.6 格）時，就把這一下改成「打在那面牆的外側」——那才是玩家看到、也真的點到的面。
   差不到 0.6 格就當它是同一塊，原封不動回傳（正常的點擊一律不動，風險就限在這一種情形）。

   **小人的那一下不驗**：手指本來就設計成「人排第一」，隔著建築也戳得到（見 onUp）。
   改出來的 hit 不帶 idx（那是引擎的 instance 編號）：只有 torch 在用它，而它本來就有
   「找落點附近最近的一塊建築」的後路，落點退到牆前面之後找到的就是那面牆。 */
function fixHit(hit) {
  if (!hit || hit.kind === 'worker' || !hit.dir || !(hit.dist > 0)) return hit;
  const d = hit.dir, p = hit.point;
  let fx = p.x, fy = p.y, fz = p.z, wall = -1, got = false;
  for (let t = Math.min(hit.dist, 60); t >= 0; t -= 0.3) {
    const qx = p.x - d.x * t, qy = p.y - d.y * t, qz = p.z - d.z * t;
    /* 這裡要的是「這個點在不在積木裡」，所以 y 用 round(y − HB)：
       第 g 層的積木占 y ∈ [g, g+BS]，中心在 g+HB。 */
    if (solidAt(cellX(qx), Math.round(qy - HB), cellZ(qz)) || homeSolid(qx, qy, qz)) {
      if (got) { wall = t; break; }               // 擋在前面的那面牆
      continue;                                   // 鏡頭本身在積木裡：跳過
    }
    fx = qx; fy = qy; fz = qz; got = true;
  }
  if (wall < 0.6) return hit;                     // 沒有東西擋在前面（或就是同一塊）
  return { kind: 'block', idx: -1, dir: d, dist: hit.dist - wall,
           point: { x: fx, y: fy, z: fz } };
}

function useTool(hit) {
  markTool(tool);                     // 手指也算一種道具
  if (tool === 'finger') return 0;                 // 手指什麼都不破壞，只有戳小人有效
  const onGround = hit.kind === 'ground';
  if (tool === 'hammer') { launchHammer(hit.point, hit.dir, false, onGround); return 0; }
  if (tool === 'bighammer') { launchHammer(hit.point, hit.dir, true, onGround); return 0; }
  if (tool === 'ball') { aimBall(hit.point); return 0; }
  if (tool === 'treb') { placeTreb({ x: hit.point.x, z: hit.point.z }); return 0; }
  if (tool === 'tornado') { aimTornado({ x: hit.point.x, z: hit.point.z }); return 0; }
  if (tool === 'fw') { launchFw({ x: hit.point.x, z: hit.point.z }); return 0; }
  if (tool === 'fire') { torch(hit); return 0; }
  if (tool === 'bucket') { pourWater(hit); return 0; }
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
let frameNo = 0;                    // 幀序號：一幀只建一次的快取靠它判斷新舊
function step(dt) {
  frameNo++;
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
     魔法陣還在充能時例外。v1.59 之前的理由是「換場會把陣收掉，那一發永遠等不到爆炸」；
     現在道具換場不收了，但這條還是留著——那一發是衝著**這一座**來的，就該讓它炸完，
     換到一半的話玩家看到的是建築憑空消失。
     （v1.62 之前是「陣一定會先把整棟扯下來捲進陣心，所以一定會跌破這條線」；
     現在整段吸下來只剝得走兩成，跌破多半是玩家在那六秒裡又補了幾發，但要擋的事情一樣。）
     （等待中途離開 wreck——按了「立刻建成」之類——就把秒數丟掉重算） */
  if (phase !== 'wreck') swapWait = 0;
  else if (!magics && bp && placedCnt <= Math.floor(bp.slots.length * WRECK_AT)) {
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
  stepClouds(dt);
  stepHot(dt);
  stepFlash(dt);
  stepFxRings(dt);
  stepMarks(dt);
  stepStars(dt);
  stepArcs(dt);
  if (aim) aim.ph += dt;                 // 瞄準環的脈動
  stepDozers(dt);
  stepTrucks(dt);
  stepWater(dt);
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
  stepHomeFall(dt);                    // 小人的家：撐不住的也要垮（v1.102）

  let spareDead = false;              // 這一幀有沒有碎料淡完了（見 clearSpare）
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
    if (b.gone > 0) {
      /* 淡出中（v1.109）。淡到一半被炸飛／被吸走的就取消——那一塊又變成場上的東西了。 */
      if (b.st !== FREE) { b.gone = 0; b.al = 1; }
      else {
        b.gone -= dt;
        b.al = Math.max(0, Math.min(1, b.gone / SPARE_FADE));
        if (b.gone <= 0) { b.gone = -1; spareDead = true; }
      }
    } else if (b.al < 1) b.al = Math.min(1, b.al + dt * 2);
    /* 淋濕的積木顏色壓深一點點（v1.68）。做法是**只動這裡的目標值**，不去改 b.tr——
       b.tr 是「這塊積木自己的顏色」，被燒黑、被打成碎料、被砌進新建築都會改寫它，
       濕度若也寫進 b.tr，乾了要還原就得記一份原色、還要在那三條路上各補一次還原。
       乘在目標上就沒有這些事：乾了自己乘回 1，而且淋濕與變乾的漸變是現成的那條 lerp。 */
    if (b.wet > 0) b.wet = Math.max(0, b.wet - dt);
    const wk = b.wet > 0 ? WET_DARK : 1;
    b.r += (b.tr * wk - b.r) * Math.min(1, dt * 5);
    b.g += (b.tg * wk - b.g) * Math.min(1, dt * 5);
    b.b += (b.tb * wk - b.b) * Math.min(1, dt * 5);
  }
  if (spareDead) dropBlocks(b => b.gone < 0);            // 淡完的收掉（見 clearSpare）
  burningW = 0;
  for (const w of workers) if (w.burn > 0) burningW++;    // 火苗配額要照人數分
  mageHeapT -= dt;                                       // 料堆清單的重算計時（見 listMageHeaps）
  stepIdleEvent(dt);                                     // 閒晃事件（v1.97）
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
  ENG.putFire(fireList());
  ENG.putFlash(flashes);
  ENG.putStars(stars);
  ENG.putBolts(bolts.length ? boltList() : EMPTY);
  /* 魔法陣、爆炸光環、保齡球的瞄準環共用同一組環，在這裡合起來丟過去。
     魔法陣的那幾層每幀由 stepMagic 算好，爆炸那幾圈自己會擴散。
     沒東西在瞄／沒魔法陣時不做 concat：那是每幀都會跑到的路徑。 */
  let ringList = null;
  if (magics) {
    /* 好幾個陣的環接在一起（v1.59）。只有一個的話就直接用它那份，不多配一個陣列——
       這是每幀都會跑到的路徑。 */
    ringList = magics.length === 1 ? (magics[0].rings || null) : null;
    if (!ringList) {
      ringList = [];
      for (const m of magics) if (m.rings) for (const r of m.rings) ringList.push(r);
    }
    if (fxRings.length) ringList = ringList.concat(fxRings);
  } else if (fxRings.length) ringList = fxRings;
  if (aim) ringList = ringList ? ringList.concat(aimRings()) : aimRings();
  if (ringList) ENG.setRings(ringList);
  else ENG.hideRings();
  if (dozers) ENG.putDozers(dozRender(dozers));
  ENG.putTrucks(trucks ? trucks.list : EMPTY);      // 沒車就是空的，那顆網格自己 visible=false
  ENG.putPools(water ? poolList() : EMPTY, water ? water.wave : 0);   // 水窪同理
  ENG.putMarks(marks);                              // 地上的焦黑與坑洞（沒有就 visible=false）
}
const EMPTY = [];
const metFly = [];              // draw() 每幀重填：這一刻真的在天上的隕石

/* ── 輸入 ───────────────────────────────────────────────── */
let spinOn = false;
let drag = null;

/* 觸控之後瀏覽器還會補送一組 mousedown／mouseup（給沒寫觸控的網頁用的相容事件）。
   兩組都收的話，手機上點一下地板等於用了兩次道具——同一個位置冒出兩顆隕石、
   兩台投石機，而點兩下才發動的保齡球與龍捲風則會在原地立刻發動（第一點就是第二點）。
   記下最後一次真的碰到螢幕的時間，緊接著那組滑鼠事件一律不理。
   700ms：相容事件是 touchend 之後馬上送的（含舊瀏覽器那 300ms 的點擊延遲），
   留一倍餘裕；混用滑鼠與觸控的機器最多就是「剛戳完螢幕的那一下滑鼠點擊不算」。 */
const GHOST_MS = 700;
let lastTouch = 0;
function onDown(e) {
  if (e.touches) lastTouch = performance.now();
  else if (performance.now() - lastTouch < GHOST_MS) return;
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
  // touchend 的 e.touches 是空的 TouchList，仍然是物件——分得出這是不是觸控來的
  if (e.touches) lastTouch = performance.now();
  else if (performance.now() - lastTouch < GHOST_MS) { drag = null; return; }
  if (!drag) return;
  const isClick = drag.moved < 8 && performance.now() - drag.t < 650;
  const x = drag.x0, y = drag.y0;
  drag = null;
  if (!isClick) return;
  audio();                                // 使用者互動後才允許出聲
  /* 拿哪一把決定「小人算不算被點到」（v1.60）：
     手指只戳人，人排第一（不然站在建築前面的戳不到）；火把兩種用途都有，照舊；
     其餘破壞道具**一律不理小人**——那些是對著建築用的，被路過的人擋掉那一下就白點了。 */
  /* pick 的結果要用格子重驗一次（見 fixHit）：射線鑽得過積木之間的縫，
     不驗的話這一下會落在牆後面那一塊、或牆後面的地上。 */
  const hit = fixHit(ENG.pick(x, y, tool === 'finger' ? 'man'
                                  : tool === 'fire' || tool === 'bucket' ? '' : 'skip'));
  if (!hit) return;
  if (hit.kind === 'worker') {            // 戳小人：跌倒、手上的積木掉下來
    const w = workers[hit.idx];
    if (!w || w.air) return;
    // 拿著火把戳人就是點他：站著被點著的會抱頭跑圈圈
    if (tool === 'fire' && igniteWorker(w, false)) { sndFire(); return; }
    // 拿水桶澆人：濕 5 秒（身上有火的當場熄），不會把人打倒
    if (tool === 'bucket') { wetWorker(w); splashFx(w.x, w.y + 1.4, w.z); sndWater(); return; }
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
/* Z／X 升降視線高度（Z 降、X 升），C 回到開場的鏡頭。實際的速度、上下界與復位
   都在 engine 那邊（lift／resetCamera），這裡只負責把鍵接上去。 */
const LIFT_KEY = { KeyZ: -1, KeyX: 1 };
const RESET_KEY = 'KeyC';
const keyDown = Object.create(null);

function onKey(e) {
  if (!PAN_KEY[e.code] && !ORBIT_KEY[e.code] && !LIFT_KEY[e.code] && e.code !== RESET_KEY) return;
  /* 只擋下拉選單與輸入框：字母鍵在 select 上是拿來跳選項的，在「匯入建築」的
     貼上框裡是真的在打字（不擋的話貼一段藍圖進去，鏡頭會跟著 WASD 一路飄走）。
     面板的按鈕與核取方塊吃的是空白鍵／Enter，跟 WASD 不衝突，
     一起擋掉的話「剛按完設定就按不動鏡頭」反而莫名其妙。 */
  const tag = e.target && e.target.tagName;
  if (tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'INPUT') return;
  /* C 是按一下就做完的事，不進 keyDown。Ctrl／⌘＋C 是複製，不能被當成復位；
     按著不放時 keydown 會一直重送（e.repeat），也只復位一次。 */
  if (e.code === RESET_KEY) {
    if (e.type === 'keydown' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) ENG.resetCamera();
    return;
  }
  keyDown[e.code] = e.type === 'keydown';
}
// 按著 W 切去別的視窗，keyup 收不到，切回來鏡頭會自己一直飄
function clearKeys() { for (const k in keyDown) keyDown[k] = false; }

/* 用真實時間推進，不吃時間倍率——開四倍速不該讓鏡頭也快四倍 */
function panStep(dt) {
  let r = 0;
  for (const k in ORBIT_KEY) if (keyDown[k]) r += ORBIT_KEY[k];
  if (r) ENG.orbit(r * ORBIT_RATE * dt, 0);
  let up = 0;
  for (const k in LIFT_KEY) if (keyDown[k]) up += LIFT_KEY[k];
  if (up) ENG.lift(up, dt);
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
      tool = t.id; aim = null; renderTools();       // 換道具就把瞄一半的第一點收掉
      $('toolbox').classList.remove('open');       // 選好就收起來，不要一直擋著畫面
      $('hint').textContent = t.tip + '　｜　拖曳／QE 轉視角　｜　WASD 平移、ZX 升降、C 復位　｜　滾輪縮放　｜　點小人會跌倒';
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

/* ── 匯入建築 ─────────────────────────────────────────────
   遊戲本來只吃檔案（.js 放進 blueprints/ 再加進 list.js），那對「拿到一份 AI 給的
   藍圖、想馬上蓋來看看」太遠了。這一格把整條路收進遊戲裡：
   取得 prompt → 去 Gemini／GPT 要一份 → 貼進來 → 匯入 → 立刻選得到。

   跟藍圖預覽.html 走同一支 importBlueprint()（清洗、撞名規則、錯誤訊息都一樣），
   差別是這邊會存下來：預覽頁是做藍圖的工作台，F5 就沒了才對；遊戲是拿來玩的，
   關掉再開還要在。這等於在遊戲裡執行使用者自己貼進來的程式碼——跟把 .js 丟進
   blueprints/ 同一個信任等級，差別只在「存起來的每次開頁都會再跑一次」。 */
const IMPORT_KEY = 'block-builders/bp1';
/* 存原始碼而不是產生出來的格子：藍圖是一支會跟著建材檔位重畫的函式，
   存格子等於把它釘死在某一個大小。一次匯入算一筆——一支檔案可以呼叫好幾次
   customBlueprint，那幾座就一起進來、一起刪、一起匯出。 */
let imported = [];                 // [{file, code, names:[…]}]
const importedIdx = new Set();     // 這幾座在 SHAPES 的索引；importBlueprint 靠它判斷能不能蓋掉

const esc = t => String(t).replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function loadImports() {
  let txt = null;
  try { txt = localStorage.getItem(IMPORT_KEY); } catch (e) { return; }   // 無痕模式會直接丟例外
  if (!txt) return;
  let list;
  try { list = JSON.parse(txt); } catch (e) { return; }
  if (!Array.isArray(list)) return;
  for (const it of list) {
    if (!it || typeof it.code !== 'string') continue;
    /* 一份壞的不能把遊戲弄到開不起來，也不能拖垮其他份——存檔可能是舊版存的，
       也可能被手改過。跳過它、其餘照常，理由留在 console。 */
    try {
      const added = importBlueprint(it.code, importedIdx);
      imported.push({ file: added[0].file, code: added[0].code, names: added.map(a => a.name) });
    } catch (e) {
      console.warn('[匯入的藍圖] ' + ((it.names && it.names[0]) || it.file || '?') +
                   ' 載不起來，跳過：' + e.message);
    }
  }
}
function saveImports() {
  try { localStorage.setItem(IMPORT_KEY, JSON.stringify(imported)); return true; }
  catch (e) { return false; }               // 空間滿了：這一輪還在，關掉就沒了
}

/* 下拉選單重建。匯入／刪除之後都要叫一次，不然新的那座選不到、刪掉的還留在單子上。
   自訂藍圖排在最前面（緊接在「隨機」後面）：會自己弄藍圖的人就是想馬上看到成果，
   排在內建 48 座後面每次都得捲到底。只動顯示順序——option 的 value 一律還是
   SHAPES 的索引，所以 shapePick、存檔記的編號、測試裡寫死的索引都不受影響。
   用兩次 filter 而不是 sort：不必依賴 sort 的穩定性，同一群內的原順序就是原順序。 */
function refreshShapeMenu() {
  const sel = $('shape'), ord = SHAPES.map((s, i) => i);
  sel.innerHTML = '<option value="-1">🎲 隨機</option>' +
    ord.filter(i => SHAPES[i].custom).concat(ord.filter(i => !SHAPES[i].custom))
       .map(i => '<option value="' + i + '">' + esc(SHAPES[i].n) + '</option>').join('');
  sel.value = String(shapePick);
  if (sel.value !== String(shapePick)) sel.value = '-1';    // 指定的那座剛被刪掉
}

/* 把某一座從 SHAPES 拿掉。匯進來的一律排在最後面（內建 48 → blueprints/ → 匯入），
   所以只會動到其他匯入的索引；splice 之後那些要整組往前挪一格。
   shapePick 也得跟著挪，不然「指定要蓋的那一座」會悄悄變成別座。 */
function dropShape(at) {
  SHAPES.splice(at, 1);
  const moved = [];
  for (const i of importedIdx) if (i !== at) moved.push(i > at ? i - 1 : i);
  importedIdx.clear();
  for (const i of moved) importedIdx.add(i);
  if (shapePick === at) shapePick = -1;
  else if (shapePick > at) shapePick--;
}

function renderImports() {
  $('impList').innerHTML = imported.length
    ? imported.map((e, i) => '<div class="it"><b>' + esc(e.names.join('、')) + '</b><span>' +
        esc(e.file) + '</span><button data-out="' + i + '">匯出</button>' +
        '<button data-del="' + i + '">刪除</button></div>').join('')
    : '<div class="none">還沒有匯入過。上面那四顆是「去弄一份藍圖」的捷徑。</div>';
}

function doImport() {
  const msg = $('impMsg');
  try {
    const added = importBlueprint($('impPaste').value, importedIdx);
    /* 同名再匯一次是「換一版」：舊那筆要拿掉，不然清單多一列、匯出也會重複一份。
       SHAPES 那邊 importBlueprint 已經自己蓋掉了。 */
    imported = imported.filter(e => !e.names.some(n => added.some(a => a.name === n)));
    imported.push({ file: added[0].file, code: added[0].code, names: added.map(a => a.name) });
    const kept = saveImports();
    refreshShapeMenu();
    renderImports();
    $('impPaste').value = '';               // 免得手滑再按一次又匯一遍
    const who = added.map(a => a.name).join('、');
    /* 被改過名的要講出來，不然使用者在清單裡找不到自己貼的那個名字（v1.111） */
    const renamed = added.filter(a => a.was);
    msg.className = 'on good';
    msg.textContent = '✔ 匯入「' + who + '」，設定面板的下拉選單裡選得到了。' +
      (renamed.length ? '（原名「' + renamed.map(a => a.was).join('、') +
        '」跟內建或 blueprints/ 裡的撞號，自動加了編號）' : '') +
      (kept ? '' : '（存不下來：瀏覽器的儲存空間滿了，這一份關掉頁面就沒了）');
    toast('📥 ' + who, '匯入完成');
  } catch (e) {
    msg.className = 'on bad';
    msg.textContent = '✘ ' + ((e && e.message) ? e.message : e);
  }
}

/* 存成檔案。data: URL 直接掛 <a download> 有些瀏覽器會擋，轉成 blob 最保險（file:// 也通）。 */
function download(name, text) {
  const href = URL.createObjectURL(new Blob([text], { type: 'text/javascript;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 4000);
}
/* 匯出：一列一支 .js，檔名就是它自己那個（傳給別人，對方放進 blueprints/，
   或一樣從「匯入建築」貼進去）。一份一支而不是整包一支：分享的單位是「一座建築」，
   整包丟過去的話對方想留哪座、不想留哪座都得自己拆。 */
function exportOne(i) {
  const e = imported[i];
  if (!e) return;
  const text = '/* 積木小人 · 匯出的藍圖（' + e.names.join('、') + '）\n' +
               '   用法二選一：放進 blueprints/ 並把檔名加進 list.js，\n' +
               '   或在遊戲裡按「📥 匯入建築」把整份貼進去。 */\n\n' +
               e.code.replace(/\s*$/, '') + '\n';
  download(e.file, text);
  const btn = document.querySelector('#impList [data-out="' + i + '"]');
  if (!btn) return;
  btn.textContent = '已下載 ✓';
  setTimeout(() => {
    /* 這一秒半內可能已經刪過、重畫過了，重抓一次才不會寫到別列身上 */
    const b = document.querySelector('#impList [data-out="' + i + '"]');
    if (b) b.textContent = '匯出';
  }, 1600);
}

/* ── 存檔搬家 ─────────────────────────────────────────────
   紀錄平常只活在這台電腦的 localStorage 裡：換電腦、換瀏覽器、清了瀏覽資料就沒了。
   匯出下載一份檔案、匯入把它讀回來，換一台機器也接得下去。
   檔案內容就是 localStorage 裡那一份（packSave 出來的那串），前面加幾行給人看的抬頭——
   另外設計一種格式的話，同一份東西就有兩套解析要維護。
   帶的是「紀錄與設定」，不含匯入的建築：那些一座一支 .js，在「匯入建築」那邊各自匯出。 */
const SAVE_FILE_HEAD = '積木小人 · 世界地標工地 — 存檔\n' +
                       '把整個檔案從「🏅 成就 → 匯入存檔」讀回去就接得下去。\n' +
                       '下面那一行是存檔本體，改壞了就讀不回來。\n';
function saveText() {
  return SAVE_FILE_HEAD + '\n' + packSave({ s: stats, p: pref }) + '\n';
}
/* 檔名帶日期：備份好幾份時分得出哪份新。日期用本地時間，不是 UTC——
   玩家看到的日期要跟他的桌曆一樣。 */
function saveName() {
  const d = new Date(), p2 = n => (n < 10 ? '0' : '') + n;
  return '積木小人-存檔-' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '.txt';
}
function exportSave() {
  download(saveName(), saveText());
  const b = $('saveOut');
  b.textContent = '已下載 ✓';
  setTimeout(() => { b.textContent = '⬇ 匯出存檔'; }, 1600);
}
/* 抬頭那幾行是給人看的，解析時要跳過：取「最後一行非空白的」當本體，
   順便也吃得下「只複製存檔那一行」存成的檔案。 */
function saveBody(txt) {
  const lines = String(txt).split(/\r?\n/).map(l => l.trim()).filter(l => l);
  return lines.length ? lines[lines.length - 1] : '';
}
/* 匯入＝**直接覆蓋**（使用者指定）：不合併、不問「確定嗎」。
   讀壞了就原封不動——先解包驗過校驗碼才動 stats，不會讀到一半把紀錄弄丟。 */
function importSave(file) {
  const msg = $('saveMsg');
  const fail = why => { msg.className = 'on bad'; msg.textContent = '✘ ' + why; };
  const r = new FileReader();
  r.onerror = () => fail('讀不到這個檔案');
  r.onload = () => {
    let o = null;
    try { o = unpackSave(saveBody(r.result)); } catch (e) { o = null; }
    if (!o || !o.s) { fail('這不是這個遊戲的存檔，或檔案內容被改壞了'); return; }
    applySave(o);
    applyPref();                       // 設定要立刻套到面板與變數上，不然要重開才生效
    spentThis = 0;                     // 這一座已經花掉的錢是舊紀錄的帳，不要帶進來
    save(); renderBadges(); renderTools(); syncHud();
    msg.className = 'on good';
    msg.textContent = '✔ 讀進來了：拆掉 ' + stats.destroyed + ' 座、擊飛 ' +
                      stats.smashed + ' 塊、' + stats.badges.length + ' 個成就（原本的紀錄已被蓋掉）';
    toast('📤 存檔已匯入', '拆掉 ' + stats.destroyed + ' 座　·　' +
          stats.badges.length + ' 個成就');
  };
  r.readAsText(file);
}

/* 複製到剪貼簿。file:// 上 clipboard API 給不給要看瀏覽器政策，
   所以留一條 execCommand 的退路（跟藍圖預覽.html 那顆「複製報告」同一套）。 */
function copyText(text, btn, back) {
  const done = () => { btn.textContent = '已複製 ✓'; setTimeout(() => { btn.textContent = back; }, 1600); };
  const legacy = () => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    if (ok) { done(); return; }
    btn.textContent = '複製不了 · 按 F12 貼';
    setTimeout(() => { btn.textContent = back; }, 2200);
  };
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, legacy);
      return;
    }
  } catch (e) { /* 往下走舊路 */ }
  legacy();
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

  /* 上次匯進來的藍圖要在建選單之前進 SHAPES，不然這一輪選單裡沒有它們 */
  loadImports();
  refreshShapeMenu();
  $('shape').addEventListener('change', e => { shapePick = +e.target.value; startBuild(false); });

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
  $('badgeBtn').addEventListener('click', () => {
    renderBadges();
    $('saveMsg').className = '';              // 上一次匯入的結果不要留到下一次開啟
    $('badgeWrap').classList.add('on');
  });
  $('badgeWrap').addEventListener('click', e => {
    if (e.target.id === 'badgeWrap' || e.target.id === 'badgeClose') $('badgeWrap').classList.remove('on');
  });
  $('resetBtn').addEventListener('click', () => {
    if (confirm('清掉所有紀錄與成就？（建築不受影響）')) { resetSave(); toast('紀錄已清空'); }
  });
  $('saveOut').addEventListener('click', exportSave);
  // 真正的 <input type=file> 藏起來，按鈕代點：它自己的樣子在各瀏覽器長得都不一樣
  $('saveIn').addEventListener('click', () => $('saveFile').click());
  $('saveFile').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    // 清掉才能連續選同一個檔案（值沒變就不會再觸發 change）
    e.target.value = '';
    if (f) importSave(f);
  });

  $('impBtn').addEventListener('click', () => {
    renderImports();
    $('impMsg').className = '';               // 上一次的結果不要留到下一次開啟
    $('impWrap').classList.add('on');
  });
  $('impWrap').addEventListener('click', e => {
    if (e.target.id === 'impWrap' || e.target.id === 'impClose') $('impWrap').classList.remove('on');
  });
  $('impGo').addEventListener('click', doImport);
  /* ⓘ：整條路怎麼走。收在按鈕後面而不是攤在面板上——知道怎麼用的人不必每次讀一遍 */
  $('impInfo').addEventListener('click', () => {
    const on = $('impHelp').classList.toggle('on');
    $('impInfo').classList.toggle('on', on);
  });
  /* 沒放 src/bpdoc.js 的話遊戲照跑，只有這顆拿不到說明全文 */
  if (typeof BP_DOC === 'string')
    $('impDoc').addEventListener('click', () => copyText(BP_DOC, $('impDoc'), '📋 取得 prompt'));
  else {
    $('impDoc').disabled = true;
    $('impDoc').title = 'src/bpdoc.js 沒放進來，拿不到〈藍圖製作說明〉全文';
  }
  $('impList').addEventListener('click', e => {
    if (e.target.dataset.out !== undefined) { exportOne(+e.target.dataset.out); return; }
    const at = e.target.dataset.del;
    if (at === undefined) return;
    const it = imported[+at];
    if (!it || !confirm('刪掉「' + it.names.join('、') + '」？刪了就沒有備份了。')) return;
    /* 由後往前拿掉，才不會刪一座就讓下一座的索引跑掉 */
    const gone = [];
    for (const n of it.names) {
      const g = SHAPES.findIndex(s => s.n === n);
      if (g >= 0) gone.push(g);
    }
    gone.sort((a, b) => b - a);
    for (const g of gone) dropShape(g);
    imported.splice(+at, 1);
    saveImports();
    refreshShapeMenu();
    renderImports();
    toast('已刪除', it.names.join('、'));
  });

  load();
  applyPref();
  renderTools();
  renderBadges();
  startBuild(true);
  completeNow();          // 開場直接給一座蓋好的建築，砸掉之後才會開始蓋下一座
  requestAnimationFrame(frame);
}





