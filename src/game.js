/* ============================================================
   遊戲層：積木狀態、物理、小人 AI、破壞、主迴圈
   繪製一律透過 ENG（engine.js），藍圖來自 blueprints.js。

   積木的一生：
     FREE（躺在地上的建材）→ CARRY（被小人舉著）→ TOSS（拋向藍圖位置的弧線）
     → SET（就定位，變成建築的一部分）→ 被槌子打到 → FLY（飛出去）→ 落地變回 FREE

   遊戲層拆成五支（v1.120.1，本來是一支 8200 行的 game.js）。都是 classic script、
   共用同一份全域 scope，所以拆檔跟原本寫在同一支檔裡**完全等價**——沒有 import／
   export，任何一支都看得到其他支的函式與變數。index.html 照這個順序載：
     src/game.js          ← 這支：版本、常數、狀態、音效、空間雜湊、積木、藍圖與積木池、整地推土機
     src/game-workers.js  小人：施工、逃命、慶祝、彩帶、閒晃、工程師、魔法師、閒聊、閒晃事件、村子、偷懶
     src/game-save.js     紀錄、成就、存檔
     src/game-tools.js    破壞道具與各種特效
     src/game-ui.js       樹、主迴圈、輸入、HUD、面板、匯入建築、啟動（boot）
   順序不是隨便排的：頂層**原則上**只有宣告，但有兩處初始式在載入時就會跑——
   這支的 HB = ENG.BS / 2（所以引擎必須排在遊戲層前面）、game-save.js 的
   stats = freshStats()（所以它跟它用到的那兩個 fresh 函式要留在同一支、宣告在前）。
   除此之外唯一的執行入口是 game-ui.js 的 boot()，由 index.html 最後那段呼叫。
   ============================================================ */
'use strict';

/* 版本號。規則：每次 commit 都要動——一般改動 patch +1，
   功能性改動 minor +1（patch 歸零）。畫面右下角會顯示。 */
const VERSION = '1.153.0';

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
   內建那 48 座多半到自己的 hi 就停了（巨石陣 3296、羅浮宮金字塔 3865），
   真的長得到上萬的是金字塔、長城、城堡，加上 v1.143 換上的那十座（見 README〈換掉十座藍圖〉）。
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
   使用者的說法是「好像沒有音效」，其實是響完之後有八秒多是靜的，
   所以改成整段一直重放（見 stepTwist 的 w.snd）。

   v1.123 換掉音色（使用者：「龍捲風音效調整 目前沒有風聲的感覺」）。
   舊的是 `noise(1.9, 0.17, 520)` ＋ 一支往下滑的鋸齒，那是「呼」一聲的氣爆不是
   一股在吹的風，三件事各差一層：
   ① **包絡**：noise() 的取樣自帶 (1−i/n) 的線性衰減，一開聲就是最大、之後一路弱下去
      ——那是爆炸的包絡。這裡自己配一份等幅的噪音，音量交給 gain 走
      「吹起來 → 撐著 → 鬆掉」，整段才都在響。
   ② **濾波**：低通只留下悶悶的一坨低頻。風的招牌是**一段頻帶在響**，所以換成帶通，
      Q 拉到 WIND_Q（帶通要有峰值才聽得出「音高」，那就是呼嘯聲）。
   ③ **會動**：中心頻率用一支 WIND_LFO Hz 的正弦上下掃 WIND_HZ±WIND_SWEEP。
      風忽強忽弱不是音量在變，是那個峰在移動；少了這一層就只是一段固定的嘶聲。
   ④ 帶通後面再補一支低通（WIND_CUT）：帶通的裙邊只有 6dB/oct，2kHz 以上還留著
      一大截，量過占 25.2% 的能量——那是嘶不是呼嘯（舊版低通切 520，只有 14.5%）。
   低頻那支留著——帶通之後 150Hz 以下幾乎沒了，小喇叭放出來會只剩嘶聲——
   但不再往下滑：滑音是「東西從旁邊飛過去」的都卜勒，一直在原地轉的風不該有。 */
const WIND_HZ = 430, WIND_SWEEP = 250, WIND_LFO = 0.55, WIND_Q = 4.5, WIND_CUT = 1500;
/* 音量。舊版的能量八成在 250Hz 以下（小喇叭推不太出來），新版搬到 250～900 那一段，
   同樣的 rms 聽起來會大不少——所以總 rms 對齊舊版（量到 0.0105），不是照著 gain 抄。 */
const WIND_VOL = 0.33;
function sndWind() {
  const c = audio(); if (!c || muted) return;
  if (!voiceOK('wind', c)) return;
  const n = Math.floor(c.sampleRate * WIND_DUR);
  const buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;    // 等幅：包絡交給下面的 gain
  const src = c.createBufferSource(); src.buffer = buf;
  const bq = c.createBiquadFilter();
  bq.type = 'bandpass'; bq.frequency.value = WIND_HZ; bq.Q.value = WIND_Q;
  const lfo = c.createOscillator(), amt = c.createGain();
  lfo.type = 'sine'; lfo.frequency.value = WIND_LFO; amt.gain.value = WIND_SWEEP;
  lfo.connect(amt).connect(bq.frequency);
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = WIND_CUT;
  /* 起音與收音各占「兩段重疊的那一截」（WIND_DUR − WIND_GAP，見 stepTwist 的 w.snd）：
     前一段開始收的那一刻正好是下一段開始吹的那一刻，兩條斜線剛好交叉。
     **一定要用線性斜坡不能用指數**：指數在前三分之一就掉掉九成，實測接縫處只剩
     「撐著」時的 4%（0.0013 對 0.031），聽起來就是「呼、呼、呼」三聲分開的；
     線性交叉最深只掉到 √½（−3dB），那個起伏本來就是風該有的陣。 */
  const fade = Math.max(0.15, WIND_DUR - WIND_GAP);
  const g = c.createGain(), t = c.currentTime;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(WIND_VOL, t + fade);
  g.gain.setValueAtTime(WIND_VOL, t + WIND_DUR - fade);
  g.gain.linearRampToValueAtTime(0, t + WIND_DUR);
  src.connect(bq).connect(lp).connect(g).connect(c.destination);
  lfo.start(t); lfo.stop(t + WIND_DUR);
  src.start(t); src.stop(t + WIND_DUR);
  tone(74, WIND_DUR * 0.92, 'sawtooth', 0.03, 0, 'windLow', fade);
}
/* 點火：短促的「噗」一聲。只在點下去那一刻響，每塊都響會變成一片白噪音 */
function sndFire() { noise(0.55, 0.16, 1600); tone(150, 0.4, 'sawtooth', 0.05, 2.4); }
/* 猴子的叫聲（v1.138）：兩短聲的「吼—吼」。波形用鋸齒是因為要粗糙、泛音多——
   三角波聽起來像笛子，不像動物。黑獼猴壓低（220 Hz 起）、白猴子高一截（330 Hz 起）：
   兩隻的體型只差一成，聲音得分得開，不然玩家聽不出來哪一隻來了。 */
/* 龍吼（v1.139）：一聲往下滑的低吼 ＋ 一層低通的噪音當氣息。
   基音壓到 90 Hz 以下——猴子的叫聲是 220／330，兩者一起在場上時要分得出來誰在叫。 */
function sndRoar() {
  tone(88, 1.15, 'sawtooth', 0.075, 0.55, 'roar');
  noise(0.9, 0.09, 420);
  setTimeout(() => tone(66, 0.8, 'sawtooth', 0.055, 0.7, 'roar'), 260);
}
/* 吐火球：一聲短促的「噴」。噪音切得比放火高（那是點著，這是噴出去），
   再墊一顆往上滑的音當「衝出去」。 */
function sndSpit() {
  noise(0.42, 0.14, 2200);
  tone(180, 0.34, 'sawtooth', 0.06, 2.2, 'spit');
}
function sndBeast(hi) {
  const f = hi ? 330 : 220;
  tone(f, 0.14, 'sawtooth', 0.05, 1.45, 'beast');
  noise(0.12, 0.03, 1500);
  setTimeout(() => tone(f * 1.18, 0.2, 'sawtooth', 0.045, 0.6, 'beast'), 170);
}
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
/* ── 王之財寶（v1.132）─────────────────────────────
   三聲：門張開的能量嗡鳴、每一發射出去的金屬破空、打中的一小聲爆炸
   （插在土裡的另有一聲悶的）。

   音量壓得比別的道具都低，是因為**發數**：連射七秒、一秒 28 發（見 GATE_RATE），
   射出與命中各一聲＝一秒四十幾聲疊在一起（一朵雷雲七秒才劈 15～20 道）。
   而且它自己的命中不再放 sndSmash（那是 0.42 秒、音量 0.3 的爆裂噪音，
   二十幾聲疊起來會糊成一片轟鳴）——見 smash() 的 hush。 */
function sndGate() {
  // 由低往高滑的嗡鳴：門是一路撐開的，聲音也要一路長上去（atk 0.5 ＝ 慢慢起）
  tone(120, 1.8, 'sawtooth', 0.05, 2.2, 'gate', 0.5);
  // 四個音一階一階疊上來（C5–E5–G5–B5，大七和弦：金色、亮，但不刺）
  [523.25, 659.25, 783.99, 987.77].forEach((f, i) =>
    setTimeout(() => tone(f, 1.1, 'triangle', 0.04, 1, 'gate' + i, 0.3), 200 + i * 140));
}
/* 射出去那一聲。v1.136 使用者：「調整射擊音效 應該是更霸氣(目前像是弓箭聲)」。
   舊的是 2100Hz 往下滑的鋸齒 ＋ 切在 5200 的短噪音——量下去 2kHz 以上占 96.7%、
   80–250Hz 只有 21.4%，那確實就是「咻」的配方（弓箭）。
   現在改成 360→72Hz 往下墩的三角波 ＋ 切在 1300 的破空：2kHz 以上 96.7% → **24.5%**、
   80–250Hz 21.4% → **79%**，單聲 rms 0.0020 → 0.0031（重一點，但不刺）。
   不再加一層 72Hz 的低音（量過：更霸氣，但一秒份疊起來 rms 0.0150，
   距離核彈的 0.0156 只差 4%——這一聲一秒要響幾十次，不能跟核彈同等量級）。 */
function sndBlade() { tone(360, 0.15, 'triangle', 0.034, 0.20, 'blade'); noise(0.10, 0.048, 1300); }
/* 打中的那一下（v1.152，使用者：「調整王之財寶命中時音效 應該要接近爆炸音效
   （音量也不要太大 因為很多發 只是現在音效跟特效不是很搭配）」）。
   特效從 v1.148 起是一顆小爆炸火球（見 weaponBoom），聲音卻還是 v1.132 那記金屬脆響
   ——760Hz 的方波 ＋ 切在 2100 的噪音，量下去 2kHz 以上占 66.3%，聽起來像敲到鐵板，
   跟畫面上炸開的火球對不起來。

   改成 **sndBoom 的配方縮小版**：低通切在 520（爆炸是 500、槌子 1500）＋ 一支往下墩的
   低頻鋸齒（爆炸是 46Hz／0.75 秒，這裡 60Hz／0.16 秒）。音量約爆炸的三成、
   長度約三成——因為**發數**：一秒炸十幾下，拖尾長一點就糊成一片轟鳴。
   量出來（各七次取中位數）：**2kHz 以上 67.4% → 15.6%**，跟爆炸同一格（炸彈 13.0%），
   而 80–250Hz 的份量 0.0008 → 0.0016 翻倍——高頻的脆變成低頻的悶。
   而且**音量反而更小**（使用者：「音量也不要太大」）：單聲 rms 0.0027 → 0.0020、
   一秒份 0.0077 → 0.0070、peak 0.191 → 0.151；三組同時射也一樣（0.0078 → 0.0072）。

   噪音的低通刻意是 520 不是 500：voiceOK 用 'noise' ＋ 低通頻率當「同一支音效」的 key，
   給 500 的話它會跟爆炸（sndBoom）擠進同一個 0.06 秒最多三個的名額裡——
   炸彈在旁邊炸的時候，這一發的命中聲會被吃掉，反過來也是。 */
function sndGateHit() { noise(0.14, 0.075, 520); tone(60, 0.16, 'sawtooth', 0.042, 0.3, 'gatehit'); }
function sndStab() { noise(0.12, 0.055, 420); }
/* 隕石進大氣層：拖長的低頻呼嘯，滑音往下＝由遠而近砸過來。
   比爆炸本身早一步響，聽到就知道要閃了 */
function sndMeteor() { noise(0.9, 0.22, 700); tone(340, 0.85, 'sawtooth', 0.07, 0.22); }
function sndSiren() { tone(560, 1.1, 'sine', 0.05, 1.7); }
/* 一波一波的低頻噪音（滾雷用）。跟 noise() 的差別在包絡：
   noise() 是 (1−i/n) 一路平順地弱下去，那聽起來是「一陣風」；
   雷的招牌是「轟…轟…轟」——音量自己在起伏。這裡把整體衰減再乘上三支慢速正弦
   疊出來的起伏，一支的話是規律的顫音，三支不同週期疊起來才亂得像雷。
   低通串兩級：一級只有 12 dB/oct，切在 120 也還留著一截中頻，聽起來仍然有「碎裂」感。
   v1.131 把那三支放慢一半（2.3／3.7／6.1 Hz → 0.80／1.29／2.12 Hz）：一秒起伏兩三次
   是顫音不是雷，遠方的滾雷大約一秒才漲落一次。 */
function rumble(dur, vol, cut) {
  const c = audio(); if (!c || muted) return;
  if (!voiceOK('rumble' + cut, c)) return;
  const n = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) {
    const t = i / c.sampleRate;
    const roll = 0.5 + 0.5 * (Math.sin(t * 5.0) * 0.5 + Math.sin(t * 8.1) * 0.3 +
                              Math.sin(t * 13.3) * 0.2);
    d[i] = (Math.random() * 2 - 1) * (1 - i / n) * roll;
  }
  const src = c.createBufferSource(); src.buffer = buf;
  const f1 = c.createBiquadFilter(), f2 = c.createBiquadFilter();
  f1.type = f2.type = 'lowpass'; f1.frequency.value = f2.frequency.value = cut;
  const g = c.createGain(); g.gain.value = vol;
  src.connect(f1).connect(f2).connect(g).connect(c.destination); src.start();
}
/* 打雷。v1.117～v1.122 是「切在 2200 的一記劈」＋「切在 190 的滾雷」＋一支
   58Hz 往下滑的鋸齒。使用者：「音效應該是低頻轟轟聲(目前像是東西撞到建築那種音效)」
   ——說得沒錯，那前後兩層正好是 sndSmash／sndThud 的配方（高頻的碎裂 ＋ 掉下去的音高），
   所以聽起來像有東西砸到建築。v1.123 整支壓到低頻：
   ① 起頭那一下切點 2200 → THUNDER_CRACK（700）、音量 0.3 → 0.16。
      完全拿掉的話沒有起頭，一聲悶悶的氣音也不像雷，所以留一記悶的。
   ② 滾雷 1.3 → THUNDER_ROLL 秒、低通 190 → THUNDER_CUT（120，而且串兩級），
      並且改用 rumble()：它的音量會自己一波一波起伏，那就是「轟轟」。
   ③ 低頻那支從 58Hz 往下滑的鋸齒換成 44Hz 不滑音——滑音是「東西掉下來」的都卜勒。
      維持鋸齒不換三角，理由同 sndBoom（三角的泛音是 1/n²，小喇叭推不出那個基音）。

   v1.131 再壓一次（使用者：「打雷音效好像上次沒調好 應該是低頻比較長一點的轟轟聲」）。
   v1.123 那一版方向對但每一項都只做了一半，量出來三件事都還差著（8 秒視窗）：
   ① **不夠久**：滾雷雖然排了 2.4 秒，但 rumble 的包絡是 (1−i/n)，最後那一截早就聽不見
      ——實際只響到第 2.0 秒。THUNDER_ROLL 2.4 → 5，響到第 4.3 秒。
   ② **不夠低**：250～800Hz 還占 52.9%，那一段就是「東西撞到建築」的碎裂感。
      起頭那一下 700 → 280、滾雷切點 120 → 95，壓到 40.1%。
   ③ **不像轟轟**：rumble 的三支起伏是 2.3／3.7／6.1 Hz，一秒漲落兩三次是顫音；
      放慢一半（0.80／1.29／2.12 Hz）才像遠方一波一波滾過來的雷（見 rumble）。
   壓低之後音量會跟著掉，所以三層各補一點（0.16→0.2、0.26→0.3、0.07→0.08）：
   1.2～1.8 秒的音量占起頭的 0.10 → 0.29，2.6～3.4 秒從 0（沒聲了）→ 0.095。
   以上都是 e2e〈音效〉那一段跑出來的（8 秒視窗，兩個版本用同一個視窗）。 */
const THUNDER_CRACK = 280, THUNDER_CUT = 95, THUNDER_ROLL = 5;
function sndThunder() {
  /* 音量壓在這裡是因為一朵雲劈 15～20 道、間隔 0.22～0.5 秒，而滾雷拖 5 秒——
     同時疊著十幾聲是常態。單獨一聲量到 rms 0.0103（v1.130 是 0.0066、隕石落地
     sndThud 0.0055，都是 8 秒視窗）；把單獨那一聲照真的間隔疊 20 道是 rms 0.0340／
     峰值 0.199（v1.130 是 0.0220／0.197），沒有任何一個取樣打到滿刻度。 */
  noise(0.26, 0.2, THUNDER_CRACK);
  rumble(THUNDER_ROLL, 0.3, THUNDER_CUT);
  /* v1.135 使用者：「打雷 音效刺耳」。量下去只有一個兇手：這支 40Hz 的**鋸齒波**。
     三層分開量 2kHz 以上的能量（rms，六秒視窗、各取五次的中位數）：
     劈裂 0.00011、滾雷 0.00001、鋸齒 **0.00145**——整支 0.00146 有 99% 是它一個人的。
     鋸齒的泛音是 1/n（跟方波同一類），40Hz 的基頻等於在 2～5kHz（耳朵最敏感的那一段）
     還鋪著一整排泛音；能量占比看起來小，聽起來就是「刺」。
     換成三角波（泛音 1/n²，跟 v1.62.3 把放置音 square → triangle 同一招）：
     2kHz 以上 0.00145 → **0.00003**（48 分之一）、1～5kHz 0.00216 → 0.00009，
     而 rms 0.0105 → 0.0124（低頻的量沒少，甚至更飽）。 */
  tone(40, THUNDER_ROLL * 0.8, 'triangle', 0.08, 0, 'thunder');
}
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
   它是為「落地瞬間一次擠開」設計的，一幀就把碎料彈到幾個單位外。

   **這是整地那一段最貴的一支**（v1.151.2，使用者：「9000 塊積木時一排推土機推過去
   有降 FPS」）。一排推土機是照工地寬度鋪滿的（最多 30 台），每台每幀把鏟面前那一坨
   都 nudge 一次——實測 9000 塊的泰姬瑪哈陵，一幀要 nudge 1300～2500 塊，
   而 step() 有 93～99% 的時間耗在推土機這條路上（拿掉這支：1.67ms → 0.36ms）。
   算式一個字都沒改，只改「怎麼算」：
   ① **不要每一對鄰居都開根號**：距離只拿來跟 BS 比大小，比平方就好，
      真的要推開時才 Math.sqrt（實測這一項就省 2.7 倍——Math.hypot 為了防溢位
      會先掃一遍找最大值再除，比 sqrt 貴得多，而這裡的座標都在 ±100 內）。
   ② **ENG.BS 提到迴圈外**：本來每一對鄰居要查兩次物件屬性。
   ③ **3×3 的 key 前綴提到外層**：九格就少組六次字串。
   ④ for...of 換成索引迴圈，省掉每格一個迭代器。
   合起來：整地那一段「每推到一千塊」的成本 **3.0ms → 1.3ms**，最壞的一幀
   10.3ms → 1.5ms；把新舊兩版放在同一坨碎料上直接對打是 1.6～2.0 → 0.76～0.87 µs／次
   （見 README〈一排推土機推過去會掉幀（v1.151.2）〉，e2e 有一條守著）。 */
function nudgeApart(b, lim) {
  if (lim <= 0) return;
  const BS = ENG.BS, BS2 = BS * BS;
  const cx = Math.floor(b.x / CELL), cz = Math.floor(b.z / CELL);
  let px = 0, pz = 0;
  for (let i = -1; i <= 1; i++) {
    const pre = (cx + i) + ':';
    for (let k = -1; k <= 1; k++) {
      const a = restGrid.get(pre + (cz + k)); if (!a) continue;
      for (let q = 0; q < a.length; q++) {
        const o = a[q];
        if (o === b) continue;
        let dx = b.x - o.x, dz = b.z - o.z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= BS2) continue;
        let d = Math.sqrt(d2);
        if (d < 1e-4) { const ang = Math.random() * Math.PI * 2; dx = Math.cos(ang); dz = Math.sin(ang); d = 1e-4; }
        const push = (BS - d) * 0.25;
        px += dx / d * push; pz += dz / d * push;
      }
    }
  }
  const pl = Math.sqrt(px * px + pz * pz);
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
    /* 這塊是村子自己從地上挖出來的嗎（v1.134，見 digBlock／homeMine）。施工中小人蓋自己的
       家只撿得起這一種——地上其他那些是地標的建材，料池剛好只夠蓋完那一座。 */
    dug: 0,
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
    w.emo = ''; w.emoT = 0; w.emoK = 0;   // 上一座留下的表情圖示不要跟著進新工地（v1.121）
    w.y = 0; w.tilt = 0; w.vx = w.vy = w.vz = 0;
  }
  rollLazy();                        // 這一座誰偷懶重抽（v1.134，見 LAZY_PART）
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
   換建築時上一輪的碎料還躺在工地上。做法是照**地標的寬度**排一排推土機出來，
   從地圖邊緣並排開進去，一趟直線掃過整個工地、從另一頭出去，然後收工——
   一次，不回頭（v1.142，使用者指定）。

   台數＝工地寬度 ÷ 一把鏟子的寬度，所以寬的地標派得多、窄的派得少，
   相鄰兩台的間距一定 ≤ 鏟子寬度，整個寬度沒有縫（見下面 DOZ_CAP 與 startClear）。
   鏟子放不放下來只看位置：進了工作範圍就放下開始推，離開範圍就抬起來（見 dozeMove）。

   v1.61～v1.141 是另一套：每台自己找一坨最密的碎料切進去，推出去再回頭找下一坨，
   推滿 10 秒（DOZ_LIMIT）就收工。一般大小的工地清除率 82～87%，但大工地整個推不動
   ——一趟對穿要 126 單位、十秒連一趟都跑不完，實測金門大橋 0%。並排掃一趟沒有這個
   問題：整地的時間跟著寬度長，而不是拿一個固定時限去賭跑不跑得完。

   車速是固定的，而且比小人走路快不了多少——推土機本來就該是慢的（使用者指定
   「依目前移動速度」）。之前用「一趟固定跑幾秒」回推速度，大工地會飆到每秒 57 單位，
   看起來像在飛。 */
// 鏟子的寬度與位置直接取畫面那邊的值，判定跟看到的才會是同一把鏟子
const DOZ_W = ENG.DOZ_W, DOZ_FRONT = ENG.DOZ_FRONT;
/* 台數＝把工地的寬度用鏟子鋪滿要幾把（v1.142，使用者：「按照地標建築寬度用推土機
   並排推過去一次」）。一台的作用寬度是 2·DOZ_W、工地的寬度是 2·siteClearR()，
   所以 n = ⌈siteClearR ÷ DOZ_W⌉，再把 n 條線平均鋪滿整個寬度——間距 2R/n 一定
   ≤ 2·DOZ_W，鏟子與鏟子之間不會留縫。
   上限是畫面那邊的容量（ENG.MAXDOZ）：最寬的金門大橋（9000 建材、半徑 89）要 29 台。 */
const DOZ_CAP = ENG.MAXDOZ;
const DOZ_MOVE = 9.5;               // 空鏟趕路的速度
const DOZ_PUSH = 6.5;               // 鏟子上有料時的速度
const DOZ_LOAD = 0.5;               // 鏟到料之後還維持慢速幾秒
const DOZ_TURN = 3.4;               // 轉向角速度（rad/s）
/* 從地圖邊緣進場（v1.61）：以前是「在工地邊上憑空出現、原地怠速 1.3 秒等碎料落地」，
   換場那一下三到六台機器同時冒出來。現在從碎料場外緣開進來，那段路本身就是等碎料
   落地的時間，不必再站著等。
   進場那一段不算進時限——時限是給「推」的，不是給趕路的（見 stepDozers）。 */
const DOZ_FAR = 6;                  // 進場點在碎料場外緣（arenaR）再外面幾格
const DOZ_ENTER_MAX = 6;            // 進場最多算幾秒（保險絲，時限一定要開始跑）
/* 鏟面後方多深之內都算同一堆，一起往前帶。抓得越深一次帶越多，但也得推得更遠
   才能整堆送出範圍外——不然機器停下時，那一疊的尾巴還留在工地裡。 */
const DOZ_PILE = 7;
/* 保險絲的餘裕（見 passLimit）。一趟推完自然就結束，這個只在「推得異常慢」時才生效。 */
const DOZ_SLACK = 3;
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
/* 保險絲：這一趟最壞情況要跑多久（全程都用推料的慢速）。一趟推完本來就會自己結束，
   這只是防呆的上限——不是「推這麼久就收工」（v1.61～v1.141 的 DOZ_LIMIT 是那種）。
   進場那段路不算在內（見 stepDozers 的 D.on）。 */
function passLimit() { return (2 * dozWorkR() + DOZ_PILE) / DOZ_PUSH + DOZ_SLACK; }
/* 排隊進場：整排從地圖邊緣的同一側並排開進來，一趟直線掃過整個工地、從另一頭出去。
   出發點、進場、穿過、出場全在同一條直線上——中間不用轉彎、不用掉頭，
   鏟子自己會在進入工作範圍時放下、離開範圍時抬起（見 dozeMove 的 work）。
   掃的方向見 sweepAngle()。 */
/* 從哪個方向掃過去：取碎料分布的**短邊**推。
   沿著長邊推的話，每一把鏟子要從頭到尾收整條線的料，鏟面前那一疊早就滿了，
   後面的就從鏟子兩側與底下漏掉（實測金門大橋 9000 建材沿長邊推只送出 48%）。
   長短邊看不出來（碎料鋪成一團圓的）就隨機挑一個方向，不然每次換場都從同一邊推。 */
function sweepAngle() {
  const r = siteClearR();
  let n = 0, sx = 0, sz = 0, xx = 0, zz = 0, xz = 0;
  for (const b of blocks) {
    if (b.st !== FREE || Math.hypot(b.x, b.z) >= r) continue;
    n++; sx += b.x; sz += b.z; xx += b.x * b.x; zz += b.z * b.z; xz += b.x * b.z;
  }
  const rnd = () => Math.random() * Math.PI * 2;
  if (n < 8) return rnd();
  const mx = sx / n, mz = sz / n;
  const cxx = xx / n - mx * mx, czz = zz / n - mz * mz, cxz = xz / n - mx * mz;
  // 2×2 共變異數矩陣的兩個特徵值差多少＝長短邊差多少；差太少就是圓的，方向沒差
  const mid = (cxx + czz) / 2, d = Math.hypot((cxx - czz) / 2, cxz);
  if (d < mid * 0.1) return rnd();
  const major = 0.5 * Math.atan2(2 * cxz, cxx - czz);     // 長邊的方向
  return major + Math.PI / 2 + (Math.random() < 0.5 ? 0 : Math.PI);
}
function startClear() {
  const R = siteClearR();
  const n = clamp(Math.ceil(R / DOZ_W), 1, DOZ_CAP);
  const ang = sweepAngle();
  const ux = -Math.cos(ang), uz = -Math.sin(ang);      // 行進方向（往場中心）
  const px = -uz, pz = ux;                             // 橫向：並排就排在這條線上
  const far = arenaR + DOZ_FAR;                        // 出發點：碎料場外緣再外面幾格
  const out = dozOutR();                               // 軸向推到這裡就算穿出去了
  const gap = 2 * R / n;                               // 相鄰兩台的間距（一定 ≤ 2·DOZ_W）
  dozers = {
    t: 0, all: 0, on: false, done: false, lim: passLimit(),
    list: Array.from({ length: n }, (_, k) => {
      const off = (k + 0.5) * gap - R;                  // 這台負責的那一條帶
      /* 目標的軸向距離每台都一樣（out），整排才會維持一條線推過去。
         各自算自己那條弦的出口的話，外側那幾台的弦短、會先到，整排就散了。 */
      return { x: px * off - ux * far, z: pz * off - uz * far,
               a: Math.atan2(ux, uz),                   // rotation.y = a 讓車頭指向 (sin a, cos a)
               tx: px * off + ux * out, tz: pz * off + uz * out,
               st: 'push', bl: 1, load: 0, k };
    })
  };
  phase = 'clear';
  sndDozer();
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
  /* 車頭**不**轉（v1.142）：一趟是直線，繼續往前開就是最短的出場路徑，
     還在工地裡的那一段照樣推（見下面 done 那一段）。轉朝外會讓外側那幾台斜切回工地。 */
  for (const m of dozers.list) m.st = 'leave';
  beginBuild();
}
/* 開一步。鏟子放不放下來、推不推料**只看位置**，不看在跑哪一段（v1.64.2）：
   進了工作範圍就放下來推，出了範圍才抬起來。速度看鏟子上有沒有料——空鏟就開快的，
   工地大半是空地，整趟都用推料的慢速跑等於把時限花在沒東西可推的地方
   （中世紀城堡實測有 2 秒多是這樣耗掉的）。
   怎麼開由呼叫端給：推的時候是 driveTo 追目標，穿出去之後與離場都是照車頭直線開。 */
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
  /* 一趟直線推過去，穿出另一頭就沒事了——不回頭找料（v1.142）。
     整排都出去了就收工；拖太久（lim）也收工，那時還在工地裡的照樣一路推著出去。 */
  let outn = 0;
  for (const m of D.list) {
    if (m.st === 'push') {
      if (dozeMove(m, dt, sp => driveTo(m, dt, sp))) m.st = 'out';
    } else {
      /* 先穿出去的不要停在原地等（外側那幾條帶碎料少、空鏟跑得快）：照原方向繼續開。
         停下來等的話整排會斷成一截一截的，而且停的位置剛好在工地邊上。 */
      dozeMove(m, dt, sp => { m.x += Math.sin(m.a) * sp * dt; m.z += Math.cos(m.a) * sp * dt; });
    }
    if (m.st === 'out') outn++;
  }
  if (outn >= D.list.length || D.t > D.lim) finishClear();
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
    /* 池子不夠就當場生一塊（v1.141）：料池從此是「小人挖出多少就有多少」
       （見 reconcilePool），而這條路是**憑空建成**——開場那一座、⚡ 立刻完工都走這裡，
       不生的話那一座是空的（實測開場整片草地一塊積木都沒有）。
       生出來的直接就位，不經過「躺在地上等人搬」那一段。 */
    if (i >= blocks.length) {
      if (blocks.length >= ENG.MAXB) break;          // 池子頂到上限（見 engine.js 的 MAXB）
      blocks.push(newBlock());
      i = blocks.length - 1;
    }
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
  ENG.setBlockCount(blocks.length);       // 上面可能生了新的（見那一段）
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

/* 積木太多就收掉，**少了不補**（v1.141，使用者：「改成材料不夠小人自己挖」）。
   以前這裡會在工地外圍鋪一整圈建材，補到剛好夠蓋完這一座——換一次建築就自動長出
   幾千塊。現在缺料的人自己走幾步、拿鏟子挖出來（見 game-workers.js 的 digSite）：
   「需要積木又沒得撿的時候，用挖的就能產生」，所以「料夠不夠」不再是這裡要保證的事。
   多的還是要收：從九千塊那一檔換到一千八，上一棟解出來的幾千塊碎料留著只是白吃
   畫面成本（完工那一刻本來也會把多餘的清掉，見 clearSpare）。 */
function reconcilePool() {
  /* 家的那些積木不算在料池裡（v1.97）：它們是從地上挖出來的，不是這一座的建材。
     算進去的話，池子看起來「太多了」，下面那段會反過來把地上的碎料收掉——
     等於小人蓋了幾間房子，下一座就少了那麼多建材。 */
  let own = 0;
  for (const b of blocks) if (b.hh < 0) own++;
  const need = Math.min(ENG.MAXB - (blocks.length - own), bp.slots.length);
  const add = need - own;
  if (add < 0) {
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

