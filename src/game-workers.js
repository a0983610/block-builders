/* ============================================================
   遊戲層 · 小人：施工、逃命、慶祝、彩帶、閒晃、工程師、魔法師、閒聊、閒晃事件、村子
   從 game.js 拆出來的一段（v1.120.1）。classic script、共用同一份全域 scope，
   跟原本寫在同一支檔裡完全等價；五支的分工與載入順序見 src/game.js 檔頭。
   ============================================================ */
'use strict';

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
    /* 頭上的表情圖示（v1.121，見 showEmo）：emo 是哪一種（EMO_KINDS 裡的字，''＝沒有）、
       emoT 是還要冒幾秒、emoK 是畫出來的大小 0～1。 */
    emo: '', emoT: 0, emoK: 0,
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
    /* 挖料（v1.129）：dig 是「這一鏟挖到哪了」0～1（畫鏟子用，0＝沒拿鏟子），
       dug 是這一趟已經挖出幾塊躺在地上了（挖出來的不在手上，所以算在人身上）。 */
    dig: 0, dug: 0,
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
    /* 「我要搬的那塊不見了」：頭上冒個問號（v1.121）。這條路徑一律是被搶走、被打飛、
       手上那塊被打掉——玩家砸一下就看得到幾個人愣在那裡，因果很清楚。 */
    showEmo(w, 'quest');
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
  /* 慶祝的鐘不歸零（v1.120）：被炸飛的人落地後只補完剩下的那一段，
     不是重新開始跳七秒（見 updWorker 開頭那段鐘）。 */
  w.air = 1; w.fall = 0; w.pause = 0; w.gait = 0; w.flee = 0;
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
    showEmo(w, 'quest');                            // 走不動了：頭上冒個問號（v1.121）
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
  showEmo(w, 'bang');                             // 嚇到了：頭上冒個驚嘆號（v1.121）
  w.flee = d.t + FLEE_TAIL;
  w.fdel = rr(FLEE_REACT[0], FLEE_REACT[1]);
  w.fex = d.x; w.fez = d.z;
  w.frem = rr(FLEE_RUN[0], FLEE_RUN[1]);
  const dx = w.x - d.x, dz = w.z - d.z;
  // 剛好站在爆心正上方就隨便挑一邊
  const away = dx * dx + dz * dz < 1e-6 ? rr(0, Math.PI * 2) : Math.atan2(dx, dz);
  w.fdir = away + rr(-FLEE_SKEW, FLEE_SKEW);
  /* 慶祝中被嚇跑就算散場了（v1.120，使用者：「有觀察到小人慶祝 被核彈嚇跑 然後又跑回去
     慶祝，慶祝應該只要完工後一次就好」）。這裡本來是把 w.cheer 歸零，等於一發核彈把整場
     慶祝**重新開始**：核彈的逃命只有 3.4 秒（NUKE_WAIT + NUKE_FALL + FLEE_TAIL）、
     魔法陣 6.6 秒，兩個都比七秒的慶祝短，所以人跑回來時窗口還開著，又站一圈跳滿七秒。
     現在改成把窗口直接推到底，並且先挑好回頭要去閒晃的點（同 v1.96 散場那一段的理由：
     不挑的話沿用的是完工時留下的目標）。 */
  if (idlePhase()) { w.cheer = CHEER_T + w.cout; idleSpot(w); }
  else w.cheer = 0;
  w.pause = 0;
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
    /* 散場錯開多久（見 CHEER_OUT）。**已經散場的人不重抽**（v1.120）：這裡在慶祝中
       加減人也會跑一次，抽到比較大的延遲就等於把已經關掉的窗口重新打開，那個人會
       走回圈上再跳一下（同「慶祝只有完工後那一次」那條規則）。 */
    if (cheerOn(w)) w.cout = rr(0, CHEER_OUT);
    /* 彩帶的節拍要錯開，不然一圈人同一幀噴（第一束是「站定那一刻」，
       而近的人幾乎同時站定）。第一束隨機提前一點，之後每 CONF_GAP 秒一束。 */
    w.cft = rr(0, CONF_GAP * 0.8);
  }
}

function updWorker(w, wi, dt) {
  /* 姿勢旗標每幀重算：跌倒、被炸飛、跑去躲的那幾條路徑都是 return 出去的，
     不歸零的話工程師被戳倒了還躺在地上舉著圖。 */
  w.hail = 0; w.plan = 0; w.dig = 0;   // dig：拿著鏟子挖料（v1.129，見 digTrip）
  stuckWatch(w, dt);                 // 卡住了就脫困（v1.108）。擺在最前面：下面每一條分支都會 return
  /* 舉杖同理，只是它是漸進的（瞬間切 0/1 的話杖會用瞬移的抬起放下）：
     這裡每幀往下收，只有真的在施法那條路徑會用兩倍速把它撐回去（castPose）。
     被炸飛、跌倒、換場都是 return 出去的，不預設收的話那個人躺在地上還舉著杖。 */
  if (w.cast > 0) w.cast = Math.max(0, w.cast - dt * CAST_DOWN);
  if (w.chatCd > 0) w.chatCd -= dt;
  stepEmo(w, dt);                    // 表情圖示的鐘（v1.121）。同下面那段慶祝的鐘：擺在所有 return 之前
  /* 慶祝的鐘（v1.120）。擺在**所有 return 之前**：完工那一刻起就一直在走，被炸飛、
     被震倒、被嚇跑、被點著的那幾秒也照算——慶祝是「完工後那一段時間」，不是「站在圈上
     跳了七秒」（使用者：「慶祝應該只要完工後一次就好」）。以前是掛在下面那條慶祝分支裡
     加的，那幾條路徑一 return 出去鐘就停了：一個人被炸飛兩秒，就會在別人都散場之後
     自己一個人補跳兩秒。 */
  if (idlePhase()) {
    const was = w.cheer;
    w.cheer += dt;
    /* 窗口到期的那一幀要做兩件事，人在逃命／在燒的時候到期也要做（那時候下面那條
       慶祝分支走不到）：交談先進冷卻（v1.60：圈上兩個人只隔 CHEER_GAP 1.9 格，
       不推冷卻的話散場那一瞬間整圈人同時配對），以及先挑好下一個閒晃點
       （v1.96：不挑的話沿用的是完工時留下的 (0, 0)，strollTo 會把它推到外圈，
       於是整圈人先一起往內走、同時抵達、再同時往外散）。 */
    if (was < CHEER_T + w.cout && !cheerOn(w)) {
      w.chatCd = rr(CHAT_CD, CHAT_CD * 2);
      idleSpot(w);
    }
  }
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
    if (w.fall <= 0) {
      w.st = 'idle';
      /* 爬起來的那一刻生氣（v1.121）：被戳、被掀飛落地、被水柱打倒都走這裡。
         **濕著爬起來的不生氣**——那是身上有火被水澆熄的人（見 wetWorker），
         他頭上那顆愛心還在，不要蓋掉。 */
      if (w.wet <= 0) showEmo(w, 'anger');
    }
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
      // 到期那一幀要做的事（交談冷卻、挑閒晃點）在這個函式開頭那段鐘裡（v1.120）
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
const CHAT_MAD = 0.25;              // 幾成的對話是不歡而散（冒生氣，其餘冒愛心）

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
    /* 聊完了，兩個人各冒一個表情（v1.121）。**不能只顧自己**：兩邊的 chat 是同一幀
       歸零的，先跑到的那個一 endChat，另一個進 stepChat 就走上面那條「對方被抓走了」
       早退（那條是被炸飛、被抓去上工用的，不該冒表情）。所以由先聊完的順手幫「還指著
       自己」的那位也冒一個——被抓走的人 cw 已經被 endChat 清成 −1，不會誤中。
       擺在 endChat 後面：endChat 會把泡泡收掉（w.bub = 0），圖示才不會跟泡泡疊著。

       冒哪一個：v1.121～v1.130 一律愛心，v1.131 改成聊得來冒愛心、談不攏冒生氣
       （使用者：「小人交談後有生氣或是愛心(目前是都愛心)」）。**兩個人一定是同一個**
       ——這是同一場對話的結果，一邊愛心一邊生氣看起來會像兩件不相干的事，
       所以骰子在這裡只擲一次，兩個人共用。 */
    const mate = workers[w.cw];
    endChat(w);
    const emo = Math.random() < CHAT_MAD ? 'anger' : 'heart';
    showEmo(w, emo);
    if (mate && mate.cw === wi) showEmo(mate, emo);
    /* 聊完就走：給一個新的閒晃目標，不然兩個人會杵在原地等發呆時間跑完。
       有自己家的人挑自己家附近（v1.100）：挑工地外圈那一環的話，他會先往工地走幾步，
       下一幀才被 liveHome 叫回來——而在那之前如果他還在挖料那條路上，
       那個目標會把他一路帶到工地那邊去（實測跑到離自己家 38 格）。 */
    const h = w.hm >= 0 && homes ? homes.list[w.hm] : null;
    if (h) liveSpot(w, h); else idleSpot(w);
    w.pause = 0;
  }
}

/* ── 頭上的表情圖示（v1.121）───────────────────────────────
   使用者：「增加小人表達力，例如驚嘆號 愛心 問號 生氣（一個小圖示 像交談那樣在小人
   旁邊表示 使用情境你決定就可以）」。圖示長什麼樣、擺多高是引擎那邊的事
   （engine.js 的 paintEmoAtlas／putEmotes），這裡定的是「什麼時候冒哪一個、冒多久」。

   四種表情各挑**玩家看得出因果**的情境，不隨機冒——隨機的話那就只是頭上有東西在閃，
   看不出小人在反應什麼（唯一擲骰子的是「聊完天冒哪一個」，見 CHAT_MAD：
   因果還在——是那場對話的結果，只是聊得來聊不來玩家看不到）：
     驚嘆號 bang   預告一出現、丟下手上的東西開始逃命（startFlee）
     問號   quest  ① 走不動要重找路線（stuckWatch）② 要搬的那塊被打飛／被搶走（dropJob）
     愛心   heart  ① 聊完天各自走開、而且聊得來（stepChat）② 身上的火被水澆熄（wetWorker）
     生氣   anger  ① 跌倒爬起來那一刻（被戳、被掀飛、被水柱打倒）② 聊完天談不攏（stepChat）
   v1.131 動了兩處（都是使用者指定）：碰到水不再生氣（見 wetWorker）、
   聊完天不再一律愛心（四分之一是生氣，見 CHAT_MAD）。

   冒多久：都是一兩秒。太短來不及看（鏡頭多半沒對著那個人），太長就會一直掛在頭上，
   下一件事發生時反而看不出來是在反應新的那件。 */
const EMO_T = { bang: 1.6, quest: 1.8, heart: 2.2, anger: 1.8 };
const EMO_POP = 9;                  // 冒出來／收回去的快慢（聊天泡泡是 12，圖示慢一點才看得到它長出來）
/* 冒一個圖示。同一種連著觸發只是把倒數推回去（工作單被抽掉三筆、卡住的那一秒半每幀都在
   喊），不會重新彈一次——重彈的話那個圖會一直停在剛冒出來的大小。 */
function showEmo(w, kind) {
  w.emo = kind;
  w.emoT = EMO_T[kind];
}
/* 圖示的鐘。擺在 updWorker **所有 return 之前**（同 v1.120 慶祝那個鐘的理由）：被炸飛、
   倒在地上、在燒的那幾秒也要照算，不然人一被掀倒，那個圖就凍在他頭上等他站起來才開始退。
   那幾秒只是**不顯示**（emoK 收回去）：圖示是掛在身體上的一組方塊，人翻過去圖也跟著翻。 */
function stepEmo(w, dt) {
  if (w.emoT > 0) w.emoT = Math.max(0, w.emoT - dt);
  const want = w.emoT > 0 && !w.air && w.burn <= 0 && w.fall <= 0 ? 1 : 0;
  w.emoK += (want - w.emoK) * Math.min(1, dt * EMO_POP);
  if (!want && w.emoK < 0.02) { w.emoK = 0; if (!w.emoT) w.emo = ''; }
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
   一趟三塊是 2 秒上下。上限跟工人一樣是 3，再多手上那疊會高過頭頂。
   v1.129 下限從 2 改成 1（使用者：「如果是普通小人要拿多個 可以挖1~3個再撿」）。 */
const HOME_CARRY = [1, 3];
const LAY_GAP = 0.26;               // 站定之後每隔幾秒丟一塊（工人是 0.28）
const HOME_REACH = 3;               // 同一趟認的格子最多隔多遠（見 takeHomeBlock）
const DIG_ARC = 0.8;                // 挖料點偏離「他現在站的方位」多少弧度（見 digSpot）
const DIG_MARK = 1.7;              // 土痕的大小（跟隕石坑同一套，3 秒淡掉）
/* 挖出來那一塊怎麼蹦到地上（v1.129，使用者：「先用鏟子挖出積木 動作完成後
   積木在地面上（這樣就能去撿了）」）。DIG_POP 是往上的初速、DIG_SIDE 是往旁邊的，
   DIG_SET 是最後一塊挖完之後等它落定幾秒。0.8 秒上下是照物理算的（飛 0.32 秒、
   彈一下、在地上滑幾幀煞停，再轉正 0.22 秒，見 stepBlock／stepSnap），
   給 1 秒；實測 398 趟裡有 388 趟等到（剩下 10 趟退回重開一趟，下一趟自己會撿到）。
   顏色是土色：剛從地裡挖出來的就該是土，撿起來之後才慢慢變成牆的顏色
   （見 takeHomeBlock，那邊只設目標色、讓它自己 lerp）。 */
const DIG_POP = [3.6, 4.8], DIG_SIDE = [2.2, 3.4], DIG_SET = 1;
const DIG_DIRT = [0.56, 0.44, 0.31];
const DIG_TOSS = 1.3;               // 估落點會落在多遠（挑往左還是往右扔用，見 digBlock）
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
   anchor 給了就只找它附近（同一趟認的幾格要在一起，見 takeHomeBlock）。 */
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
/* 鏟尖插進地面的那一點（v1.130，使用者：「積木出現的位置也要合理(目前看起來都固定在
   小人腳下)」）。腳底往他面對的方向推 ENG.DIG_TIP 那麼遠——那個值是畫面那邊算鏟子姿勢
   時一起算出來的（還沒乘身高，所以要乘 w.scale），跟法杖的 WAND_TIP 同一個做法：
   兩邊各寫一份的話，鏟子插在腳前面、積木卻從腳底冒出來。
   回傳同一個暫存物件（一鏟會叫好幾次）。 */
const _dgp = { x: 0, z: 0 };
function digPoint(w) {
  const d = ENG.DIG_TIP[2] * (w.scale || 1);
  _dgp.x = w.x + Math.sin(w.a) * d;
  _dgp.z = w.z + Math.cos(w.a) * d;
  return _dgp;
}
/* 挖土那一撮塵。用塵霧那個池子（跟彩帶一樣），顏色調成土色。
   p 給了就從那一點噴（挖料是從鏟尖，見 digPoint），沒給就從腳下
   （魔法師隔空把腳邊的地面拉出一塊，那一撮就該在他腳邊）。 */
function digPuff(w, p) {
  if (dust.length > 460) return;
  const px = p ? p.x : w.x, pz = p ? p.z : w.z;
  const a = Math.random() * Math.PI * 2, sp = rr(0.8, 2.6);
  dust.push({
    x: px + rr(-0.3, 0.3), y: 0.2, z: pz + rr(-0.3, 0.3),
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
/* 用鏟子挖出一塊來，讓它蹦到地上（v1.129，使用者：「先用鏟子挖出積木 動作完成後
   積木在地面上（這樣就能去撿了）」）。回傳「挖到了沒有」。
   跟 v1.128 的差別是**不直接放到手上、也不當場認格子**：出土之後它就是一塊躺在地上的
   碎料，等他自己走過去撿（撿的那一下才認格子，見 takeHomeBlock）——所以「地上的碎料
   優先」那條規則自然就把它撿起來了，不必另開一條路；一趟挖幾塊也就跟手上拿幾塊分開了。
   積木是**新生出來的**，不是從料池拿的——完工那一刻場上通常一塊散料都沒有
   （料池 = 藍圖格數，見 reconcilePool），從料池拿等於把下一座的建材偷走。
   落地、彈跳、轉正都是碎料本來就有的那一套（stepBlock／stepSnap），這裡只給初速。 */
function digBlock(w, h) {
  if (blocks.length >= ENG.MAXB) return false;           // 池子滿了（見 engine.js 的 MAXB）
  const g = digPoint(w);                                 // 鏟尖插進地面的那一點
  const gx = g.x, gz = g.z;
  const b = newBlock();
  b.x = gx; b.z = gz; b.y = HB;
  b.r = b.tr = DIG_DIRT[0]; b.g = b.tg = DIG_DIRT[1]; b.b = b.tb = DIG_DIRT[2];
  /* 往**身體的側面**扔（w.a 是面向自己家的方向，± 90° 就是左右兩邊）：
     往前會扔進屋子的占地、往後會扔回工地那一側，那兩邊都可能撿不到；
     側面是切線方向，離工地中心的距離幾乎不變。
     兩邊都試一次，挑落點不在別人家占地上的那一邊（落點是照初速估的，只用來挑邊）。 */
  let a = w.a + Math.PI / 2;
  for (let t = 0; t < 2; t++) {
    const px = gx + Math.sin(a) * DIG_TOSS, pz = gz + Math.cos(a) * DIG_TOSS;
    if (!homeAt(px, pz) && px * px + pz * pz >= (siteR + KEEP) ** 2) break;
    a -= Math.PI;
  }
  const sp = rr(DIG_SIDE[0], DIG_SIDE[1]);
  b.st = FLY; b.rest = false;
  b.vx = Math.sin(a) * sp; b.vz = Math.cos(a) * sp; b.vy = rr(DIG_POP[0], DIG_POP[1]);
  b.ax = rr(-4, 4); b.ay = rr(-4, 4); b.az = rr(-4, 4);
  blocks.push(b);
  spawnMark({ x: gx, y: 0, z: gz }, DIG_MARK, 1);        // 挖過的土痕（跟隕石坑同一套）
  digPuff(w, g); digPuff(w, g); digPuff(w, g);
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
  if (w.hst === 'dig') { digTrip(w, h, dt); return; }
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
  w.hst = 'dig'; w.dug = 0;
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
/* 「這一塊在這一間搆得到的範圍裡嗎」：離自己家外框 GRAB_R 以內、又不在工地裡。
   freeNearHome（要撿哪一塊）與 digNeed（還缺幾塊）共用這一條——兩邊各寫一份的話，
   算的時候看得到、撿的時候看不到，那一間就永遠挖不完（v1.129）。
   「積木是什麼狀態才算」兩邊故意不同，各自寫在自己那邊。 */
function homeNear(b, h) {
  return (b.x - h.x) ** 2 + (b.z - h.z) ** 2 <= (h.r + GRAB_R) ** 2 &&
         b.x * b.x + b.z * b.z >= (siteR + KEEP) ** 2;
}
function freeNearHome(w, h) {
  let best = -1, bd = Infinity;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.st !== FREE || !b.rest || b.holder >= 0) continue;
    if (!homeNear(b, h)) continue;
    const d = (b.x - w.x) ** 2 + (b.z - w.z) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
/* 這一間還缺幾塊料（v1.129）。挖幾塊要照這個數字收斂，不然一趟挖三塊、格子只剩一格
   的時候會多挖兩塊沒人要的料；而且同一間有兩三個人各挖一趟，每個人都會多挖。
   算法：沒人認的空格 −「已經是這一間的料」。
   已經是料的包括躺在地上撿得到的（跟 freeNearHome 認的是同一批，兩邊條件不一致的話
   會出現「自己算的時候看得到、撿的時候看不到」→ 永遠挖不完），**還在半空的也算**：
   剛挖出來那幾塊還沒落地（見 digBlock），不算的話同一間的另一個人會在它們落地前
   再挖一輪。手上那幾塊不算——它們認走的格子也不算在空格裡，兩邊剛好對消。 */
function digNeed(h) {
  let n = 0;
  for (const sl of h.slots) if (!sl.filled && sl.claimed < 0) n++;
  if (n <= 0) return 0;                                  // 格子全被認走了：不必掃積木
  for (const b of blocks) {
    if (b.holder >= 0) continue;
    if (b.st === FREE ? !b.rest : b.st !== FLY) continue;
    if (!homeNear(b, h)) continue;
    if (--n <= 0) return 0;
  }
  return n;
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
/* 把地上這一塊收成「自己家的第 k 格」。**認格子只在這裡**（v1.129 起連挖出來的那幾塊
   也是走這條路撿起來的，見 digBlock），所以一趟認到哪幾格的規則就寫在這裡：
   認的是清單上「還沒人認」的第一格，所以一趟認到的幾格是連號的——而格子是照砌的順序
   生出來的（一層一層、一排一排），連號就等於彼此在旁邊，站定之後從同一個位置丟得到
   （跟工人一趟領幾格是同一個道理）。隔太遠的不認（HOME_REACH，見 homeFree）：
   一排的尾跟下一排的頭雖然連號，卻在房子的兩頭——不限的話他會為了手上的第二塊
   再繞半圈房子（實測整體反而慢三成）。
   顏色是**慢慢**變過去的（只設目標色，讓它自己 lerp，見 game-ui.js 的 b.r += …）：
   剛從地裡挖出來的是土色、砸下來的碎料是原本那間房子的顏色，撿起來之後才慢慢
   變成這一格該有的顏色。 */
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
  /* 借工作單那份欄位裝（s 給 −1＝不占藍圖的格子）：這樣「舉在手上的高度」（carryPose）、
     逃命與被炸飛時的脫手（releaseWorker／dropJob）全部是現成的。
     是哪一間的哪一格記在積木自己身上（b.hh／b.hk），不必再開一份清單。 */
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
  w.hst = 'dig'; w.dug = 0;
}
/* 走去挖、挖出幾塊來，然後改去撿（v1.129，使用者：「先用鏟子挖出積木 動作完成後
   積木在地面上（這樣就能去撿了）」「如果是普通小人要拿多個 可以挖1~3個再撿」）。
   挖的地方每一趟重挑（見 digSpot）；一趟挖幾塊照 hcap（1～3，見 HOME_CARRY），
   肌肉小人是 1（他撿起來就地扔，見 hurlTrip）。
   挖完不直接去砌——挖出來那幾塊躺在腳邊，他改走「撿」那條路把它們撿起來。
   進這條路的人手上一定是空的（startTrip／endTrip 都只在空手時開挖），所以不必顧搬的姿勢。 */
function digTrip(w, h, dt) {
  /* 這一段是上工的路，不算進閒晃里程（那個是拿來算發呆多久的，見 strollPause）——
     跟 buildWalk 對搬料那條路的處理一樣。不扣掉的話，蓋一間房子來回幾十趟的里程
     全算在一起，蓋完第一次站定就會發呆好幾分鐘（實測抽到 147.8 秒）。 */
  const leg = w.leg;
  const walking = !strollTo(w, dt);
  w.leg = leg;
  if (walking) return;                                   // 還在走去挖的路上
  w.gait += (0 - w.gait) * Math.min(1, dt * 8);
  w.a = Math.atan2(h.x - w.x, h.z - w.z);                // 面向自己的房子挖
  /* 這一趟該挖的都挖完了，剩下的時間是在等最後那一塊落定（見 DIG_SET）——
     那幾秒不是在挖：土不噴、鏟子停在撬起來那一格，不然他會對著已經挖好的洞
     再揮一鏟（實測那一鏟整整揮完 0.8 秒才停）。 */
  const wait = w.dug >= w.hcap;
  if (!wait) {
    w.hp -= dt;
    if (w.hp <= 0) { w.hp = DIG_PUFF; digPuff(w, digPoint(w)); }
  }
  w.hdt -= dt;
  /* 鏟子舉多高（畫面那邊照它擺，見 engine.js 的 DIG_GRIP_Y）：這一鏟挖到哪了 0～1。
     不給 0 是因為 0＝「沒拿鏟子」——一塊挖完換下一塊時歸零的話鏟子會閃一下；
     0.001 就是「鏟子撬起來」那一格，跟一鏟結束的姿勢接得上
     （見 engine.js：sin(dig × π) 頭尾都是 0）。 */
  w.dig = wait ? 0.001 : Math.min(1, Math.max(0.001, 1 - Math.max(0, w.hdt) / DIG_T));
  if (w.hdt > 0) return;                                 // 還在挖這一鏟／還在等土落定
  /* 這一趟還要挖：塊數照 hcap，而且「這一間真的還缺」才挖（見 digNeed）。 */
  if (w.dug < w.hcap && digNeed(h) > 0 && digBlock(w, h)) {
    w.dug++;
    w.hdt = w.dug < w.hcap ? DIG_T : DIG_SET;            // 挖下一鏟／等最後那一塊落定
    return;
  }
  /* 挖完了：改去撿——挖出來那幾塊就在腳邊，freeNearHome 挑的是離自己最近的那一塊。
     還沒落定（DIG_SET 不夠久）或一塊都挖不出來（池子滿了／格子都被同組的認完了）
     就先收工，updHome 下一幀會重開一趟：那時候它們多半已經躺好了，
     開的就是「撿」那一趟（見 startTrip：地上的碎料優先）。 */
  w.dug = 0; w.hdt = 0;
  const i = freeNearHome(w, h);
  if (i >= 0) { w.gb = i; w.hst = 'grab'; return; }
  w.hst = '';
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

