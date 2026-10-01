/* ============================================================
   遊戲層 · 小人：施工、逃命、慶祝、彩帶、閒晃、工程師、魔法師、閒聊、閒晃事件、村子、偷懶
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
    /* 這次倒地是「自己走路絆的」嗎（v1.178，見 tripWalk）。跟被工具打倒共用 fall／tilt，
       只有這個旗標分得出來——偷懶的人被工具打倒要收心上工，自己絆一跤不算。 */
    trip: 0,
    /* 被工具波及時才用得到：air 是正在飛，vx/vy/vz 是彈道，spin 是翻滾角速度，
       lit 是「落地要著火」的記號，burn 是還要燒幾秒，burnK 是身上焦黑的深淺。 */
    air: 0, vx: 0, vy: 0, vz: 0, spin: 0, lit: 0, burn: 0, burnK: 0,
    // 被消防車噴到：wet 是還濕幾秒（這期間點不著），wetK 是身上顏色要乘的倍率
    wet: 0, wetK: 0,
    roll: 0, rspin: 0, rph: 0,
    bem: 0, bx: 0, bz: 0, br: 0, ba: 0, bo: 0,
    /* 工程師（eng）：拿藍圖 plan、站的角度 eang、下一個動作倒數 et、指揮動作剩幾秒 point。
       聊天：剩幾秒 chat、對象編號 cw、輪到誰講 side、講完多久才會再聊 chatCd、
       泡泡大小 bub、正在講話 talk。hail 是慶祝時的舉手，crun 是進場那一趟的腳程（見 CHEER_IN），
       cout 是散場錯開多久（見 CHEER_OUT），cft 是下一束彩帶還有幾秒（見 CONF_GAP）。 */
    eng: 0, plan: 0, eang: 0, et: 0, point: 0, hail: 0, spot: 0, crun: 0, cout: 0, cft: 0,
    chat: 0, cw: -1, side: 0, chatCd: 0, bub: 0, talk: 0,
    /* 談不攏就打起來（v1.178，見 startFight）：fig 是還要打幾秒、fw 是對手編號、
       guard 是舉拳的架勢、punch 是這一拳揮到哪 0～1（後兩個是畫的時候用的）。 */
    fig: 0, fw: -1, guard: 0, punch: 0, pk: -1,
    /* 閒著沒事來一段（v1.178，v1.206 加到八種，見 rollShow）：show 是哪一種（''＝沒有）、
       showT 是還剩幾秒、showA 是開演時的朝向（跳舞繞著它左右轉）、
       showN 是這一段幾拍（翻幾圈／跳幾下／拍幾下），
       showM 是射箭瞄上的那一隻牛羊、shot 是這一段的箭射出去了沒。
       danc／flip／stre／twirl／jack／clap／wave／bow／draw／lean 是畫出來要用的姿勢，
       跟 hail／plan 一樣每幀重算。 */
    show: '', showT: 0, showA: 0, showN: 0, showM: null, shot: 0,
    danc: 0, flip: 0, stre: 0, twirl: 0, jack: 0, clap: 0, wave: 0, lean: 0, bow: 0, draw: 0,
    /* 做久了停下來喘一口氣（v1.206，見 stepRest）：toil 是連續工作幾秒了、
       rst 是這一次還要喘幾秒，tire 是畫出來的呼吸深淺（每幀重算），
       swt 是太陽穴那一滴汗滑到哪 0～1（v1.237，見 REST_DROP_T）。 */
    toil: 0, rst: 0, tire: 0, swt: 0,
    /* 頭上的表情圖示（v1.121，見 showEmo）：emo 是哪一種（EMO_KINDS 裡的字，''＝沒有）、
       emoT 是還要冒幾秒、emoK 是畫出來的大小 0～1。 */
    emo: '', emoT: 0, emoK: 0,
    /* 魔法師（mage，v1.64）：不搬積木，站在建材堆旁邊隔空把建材拋上去。
       cast 是舉杖的深淺 0～1（畫杖與寶珠用），ct 是這一發還要蓄幾秒，
       mang／mrad 是他要站的地方（極座標：角度與半徑；v1.89 起會跟著料堆跑），
       mre 是還有多久重挑一坨料，
       fly 是已經送出去、還在半空的那幾塊（連發，所以是一份清單），
       trail 是下一顆星還有多久，mw 是「沒格子可蓋、正在閒晃」（v1.225，見 updMage）。 */
    mage: 0, cast: 0, mang: 0, mrad: 0, mre: 0, ct: 0, fly: [], trail: 0, mw: 0,
    /* 肌肉小人（mus，v1.112）：撿料跟一般工人一樣走過去撿，撿起來就地掄起來扔
       （見 updWorker 的 hurl）。掄的倒數借魔法師那個 ct——沒有人同時是兩種。 */
    mus: 0,
    /* 偷懶（lazy，v1.134）：1＝這一輪不上工，繼續過閒晃模式的生活（見 LAZY_MODES）。
       被工具打倒就歸零，從此這一輪都在上工（見 quitLazy）。 */
    lazy: 0,
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
       gbt 是「沒有再更近」幾秒了（見 nearGrab）。
       gvb 是追太久放掉的那一塊（v1.225，見 PICK_GIVE）：這一座他不再認它。 */
    sx: 0, sz: 0, stk: 0, ghost: 0, gbi: -1, gbd: 0, gbt: 0, gvb: -1,
    /* 巡路（v1.235，見 navAim）：nav 是規劃出來、還沒走完的那一條路線，
       navWait 是「剛規劃過、找不到路」還要等幾秒才再規劃一次，spd 是最近一次走路用的腳程
       （stuckWatch 照它判「走不動」）。
       地標那一層（v1.236，見 navBody）：nb／nbS 是照身高與身長算出來的身體（跟著 scale 重算），
       lmg 是「這一段穿地標的牆」（料在建築裡走不到、或人自己被圍在裡面，見 updWorker 的 pick）。 */
    nav: null, navWait: 0, spd: 0, nb: null, nbS: 0, lmg: 0,
    /* 自己那間家的編號（v1.109）。−1＝還沒有家。這個**跨輪留著**（w.hm 每輪會被
       stopHomes 清掉），下一次事件才知道誰已經有家、不必再蓋一間。
       記 id 不記索引：索引會被 dropHomes 重編。 */
    own: -1,
    /* 逃命：flee 是還要逃幾秒，fdel 是還愣著沒起步幾秒，fex/fez 是爆心，
       frem 是還要跑多遠，fdir 是起跑時定好的逃跑方向。 */
    flee: 0, fdel: 0, fex: 0, fez: 0, frem: 0, fdir: 0,
    /* 被打死（v1.240，見 game-tools.js 的 lifeHit）：hits 是被打幾次了、dead 是死了幾秒。
       alpha 只有死了才有（引擎看到它就搬去淡掉那一顆畫，見 stepCorpse）。 */
    hits: 0, dead: 0,
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
/* ── 偷懶 ─────────────────────────────────────────────────
   使用者：「建築模式下 10% 小人不去蓋地標建築，繼續他的閒晃模式（閒晃模式的事件）；
   被工具攻擊倒地才會進入建築模式」。三件事：
     · 抽中的人施工中走閒晃那條路（見 updWorker），閒晃事件也照跑（見 stepIdleEvent）
     · 名單**每座新建築開工時重抽**（使用者選的），所以只掛一個呼叫點：startBuild
     · 工程師與魔法師照樣抽得到（使用者選「全部人都算」）——抽中的那一輪他不看圖也不發料
   薪水不看他有沒有做事（見 game-ui.js 的 WAGE：按人頭按秒算），偷懶的照領。
   人數改了不重抽（施工中也能加減人）：新來的就是即戰力，下一座才重新抽。
   抽法是**洗牌取前 n 個**，不是每個人各擲一次點數：擲點數的話一口氣抽到一半、
   或一個都沒抽到都有可能（20 人擲 10% 實測 0～6 人），「一成」就不成立了。 */
/* 小人模式（v1.219，使用者：「增加小人模式選項／在破壞工具旁邊多個選單 選擇決定偷懶機制的
   百分比／例如悠閒 普通 高壓 決定多少%小人去建地標 多少人在做閒晃事件」）。
   三檔的比例是使用者挑的；v1.134 寫死的 LAZY_PART = 0.1 就是這張表的前身。
   只管施工中：完工之後照舊是 HOME_PART 那一半的人去蓋家（使用者選「不變」）。
   選單在 ⚙ 設定鈕旁邊（見 game-ui.js 的 renderModes、index.html 的 #corner），選哪一檔存進 pref.lazy。 */
const LAZY_MODES = [
  { id: 'chill', k: '😌', n: '悠閒', part: 0.5 },
  { id: 'norm', k: '😐', n: '普通', part: 0.2 },
  { id: 'rush', k: '😤', n: '高壓', part: 0.05 }
];
let lazyMode = 'norm';
function lazyPart() { return (LAZY_MODES.find(m => m.id === lazyMode) || LAZY_MODES[1]).part; }
/* keep＝施工中途換了一檔（見 setLazyMode）：名單不重抽，**只補差額**（使用者選的）——
   調高就從正在上工的人裡再抽幾個去偷懶，調低就讓多出來的那幾個收心；其他人不動。
   沒給 keep 是開工那一次（startBuild）：全部清掉，照現在這一檔重抽。 */
function rollLazy(keep) {
  const mix = a => {                                   // 洗牌
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  };
  const on = [], off = [];
  for (let i = 0; i < workers.length; i++) {
    const w = workers[i];
    if (!keep) w.lazy = 0;
    if (w.lazy) on.push(i);
    /* 中途只抽站得穩的：倒地的人下一幀就會收心（見 updWorker 開頭那一行），
       飛在半空、著火、在逃命、被幽浮吸走的也都不是「正在上工」。開工那一次全都抽得到
       （startBuild 剛把這些狀態清掉）。 */
    else if (!keep || !(w.air || w.burn > 0 || w.flee > 0 || w.fall > 0 || w.ufo)) off.push(i);
  }
  const n = Math.round(workers.length * lazyPart());   // 20 人：悠閒 10、普通 4、高壓 1
  if (on.length > n) {
    /* 收心跟被打倒同一條路（戳倒一個人是先 releaseWorker、下一幀 quitLazy，見 game-ui.js
       的 onUp）：聊到一半、演到一半、蓋家蓋到一半的都一起收掉，下一幀直接回去上工。 */
    for (const i of mix(on).slice(0, on.length - n)) { releaseWorker(workers[i]); quitLazy(workers[i]); }
    return;
  }
  const add = mix(off).slice(0, n - on.length);
  for (const i of add) {
    const w = workers[i];
    /* 中途被抽中的人手上可能還有地標的料、認著格子：先整個放掉，不然那幾格永遠被他認著，
       地標永遠差幾塊（開工那一次 startBuild 已經先放過了，再放一次是空轉） */
    if (keep) releaseWorker(w);
    w.lazy = 1;
    /* 上一座認定的那一塊不算數：魔法師回自己家拋料時會先看 w.gb（見 castHome），
       留著的話他會把地標的建材捲進自己家——料池剛好只夠蓋完那一座（見 homeMine）。 */
    w.gb = -1;
  }
  /* 閒晃事件的人手是**開始那一刻**派的（startHomes／startWall），中途多出來的人
     不重挑一次就只會在旁邊閒晃，等不到事件。重挑跟換場合同一套（見 stepIdleEvent）：
     蓋到一半的先擱著，原本的人回自己那一間，上一件蓋的東西還在就照舊是那一件（evAlive）。 */
  if (keep && add.length && phase === 'build') { stopIdleEvent(); evArm = 1; }
}
/* 換一檔。施工中（含整地）立刻照新比例補差額；完工之後偷懶的旗標沒有意義
   （那時候全場都在閒晃），存著就好，下一座開工 rollLazy 會照新的這一檔抽。 */
function setLazyMode(id) {
  if (!LAZY_MODES.some(m => m.id === id)) return;
  lazyMode = id;
  if (phase === 'build' || phase === 'clear') rollLazy(true);
}
/* 收心上工：蓋到一半的家先擱著（那一間留在場上，下一次事件有人會接手，見 pickUnfinished）。
   releaseWorker 要在抹掉 w.hm **之前**叫：它靠 w.hm 才找得到要放掉的那幾格（homeUnclaim）。 */
function quitLazy(w) {
  w.lazy = 0;
  if (w.hm >= 0) { releaseWorker(w); w.hm = -1; w.hst = ''; }
  w.gb = -1;
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
  /* 規劃好的路線也收掉（v1.235，見 navAim）：他要去的那個目標已經不算數了，再走過去就是白走一趟。
     穿地標的牆那一段同理（v1.236，見 updWorker 的 pick）。 */
  w.nav = null; w.navWait = 0; w.lmg = 0;
  /* 魔法師還在半空的那幾塊也從清單上劃掉。積木本身不管（它自己會落定），
     但編號要清掉——換藍圖時整池積木會重編，留著會指到別人的積木上。 */
  w.fly.length = 0;
  endChat(w);
  /* 打架與表演也一起收（v1.178）：這支是「這個人被抓離現在在做的事」的總開關
     （被炸飛、被點著、換一座、人數調少、收心上工都會經過），跟 endChat 同一個理由。
     w.trip 不在這裡收——那是**倒地中**才有的記號，而這支不會把人扶起來
     （水柱打倒就是先 w.fall = 再叫這支）；換一座那裡才連 fall 一起清（見 startBuild）。 */
  endFight(w);
  w.show = ''; w.showT = 0; w.showM = null; w.shot = 0;
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
/* 圈子是**從腳下撐開**的（v1.176.1，使用者：「著火繞圈跟原本站立位置有點距離，看起來像
   瞬移了一下才跑圈圈」）。位置每幀由「圈心＋半徑×角度」重算，圈心就是被點著時站的位置，
   所以一開始就給滿半徑的話，被點著的下一幀人就出現在圈上那個點——最遠 2.8 格，那一下就是
   使用者看到的瞬移。三件事一起改才接得順：
   ① 半徑從 0 用 smoothstep 撐到 br：起步與收尾的徑向速度都是 0，人是從站著加速跑開，
      不會看到往外彈一下。
   ② 起跑角取 ba＝90°−a：撐開的那半秒位移**是徑向的**（半徑在長、角度還沒轉多少），
      徑向方向就是 (cos ba, sin ba)，取 90°−a 才等於他原本的朝向 (sin a, cos a)。
      取 −a 會讓徑向變成朝向的側邊，看起來是橫著平移出去。
   ③ 面向改成看「這一幀真的走了哪個方向」：撐開時是往外衝、撐滿之後位移純粹是切線，
      同一行就把「衝出去 → 彎成圈」那 90° 的轉身接起來，不必分段寫。 */
const W_PANIC_OPEN = 0.5;           // 圈子撐到滿要幾秒
let burningW = 0;                   // 這一幀有幾個人在燒：火苗配額要分給他們

function tossWorker(w, vx, vy, vz, lit) {
  releaseWorker(w);
  const sp = Math.hypot(vx, vz);
  if (sp > W_TOSS_MAX) { const k = W_TOSS_MAX / sp; vx *= k; vz *= k; }
  /* 慶祝的鐘不歸零（v1.120）：被炸飛的人落地後只補完剩下的那一段，
     不是重新開始跳七秒（見 updWorker 開頭那段鐘）。 */
  w.air = 1; w.fall = 0; w.trip = 0; w.pause = 0; w.gait = 0; w.flee = 0;
  w.vx = vx; w.vy = vy; w.vz = vz;
  w.spin = rr(5, 12) * (Math.random() < 0.5 ? -1 : 1);
  if (lit) w.lit = 1;
}
/* roll=1 是摔在地上燒（就地打滾），roll=0 是站著被點著（抱頭跑圈圈） */
function igniteWorker(w, roll) {
  if (w.burn > 0 || w.wet > 0) return false;      // 剛被消防車噴過的點不著
  if (w.dead) return false;                       // 屍體點不著（v1.240，見 stepCorpse）
  releaseWorker(w);
  w.burn = W_BURN; w.roll = roll ? 1 : 0; w.bem = Math.random(); w.fall = 0; w.flee = 0;
  w.trip = 0;                                     // 燒起來就不是「自己絆的」那一跤了（v1.178）
  // 躺平角直接就位（人本來就是摔在地上才點著的），來回滾的相位每個人不一樣
  if (roll) {
    w.tilt = Math.PI * 0.5; w.rph = rr(0, Math.PI * 2);
    w.rspin = ROLL_AMP * Math.sin(w.rph);
  }
  w.bx = w.x; w.bz = w.z; w.br = rr(1.6, 2.8);
  w.ba = Math.PI * 0.5 - w.a; w.bo = 0;             // 從腳下往「他正對的方向」撐開
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
    if (hot.length > BURN_HOT) break;                  // 燃燒自己那一檔（見 BURN_HOT）
    hot.push({
      x: w.x + rr(-0.35, 0.35), y: w.y + rr(0.1, h), z: w.z + rr(-0.35, 0.35),
      vx: rr(-0.6, 0.6), vy: rr(2, 4), vz: rr(-0.6, 0.6),
      rx: Math.random() * 6, ry: Math.random() * 6,
      s: rr(0.26, 0.56), life: rr(0.3, 0.6), g: -2.6, grow: 1.06, cool: rr(0.25, 0.5),
      cr: 1, cg: rr(0.5, 0.82), cb: rr(0.06, 0.24), to: [0.6, 0.12, 0.02]
    });
  }
  if (Math.random() < dt * 2 && dust.length < BURN_SMOKE)
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
  const lim = debrisR + 22;
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
  const lim = debrisR + 22;
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
    w.bo = Math.min(1, w.bo + dt / W_PANIC_OPEN);
    const r = w.br * w.bo * w.bo * (3 - 2 * w.bo);      // 半徑從腳下撐開，不是一開始就滿
    const nx = w.bx + Math.cos(w.ba) * r, nz = w.bz + Math.sin(w.ba) * r;
    // 面向＝這一幀真的走的方向（撐開時往外衝、撐滿後就是切線＝繞著跑）
    if (Math.abs(nx - w.x) > 1e-4 || Math.abs(nz - w.z) > 1e-4)
      w.a = Math.atan2(nx - w.x, nz - w.z);
    w.x = clamp(nx, -lim, lim);
    w.z = clamp(nz, -lim, lim);
    const cx0 = w.x, cz0 = w.z;
    pushOutHome(w);                                     // 圈圈跑到人家屋子裡就推出來
    /* 推出來的位移也要加到**圈心**上（v1.104）：這裡的位置跟 ringWalk 一樣是每幀
       重算的，只推人不推圈心的話下一幀又照原本的圈心算回房子裡，等於推一輩子。
       加到圈心上，圈子會自己幾幀內滑出房子外面。 */
    w.bx += w.x - cx0; w.bz += w.z - cz0;
    w.ph += dt * 22;                                    // 腳步比平常快一倍
    w.gait = 1;
    w.tilt += (0 - w.tilt) * Math.min(1, dt * 8);
  }
}

/* ── 被打死（v1.240）───────────────────────────────────────
   規則、計數、血泊與時間軸在 game-tools.js 那一段（KILL_HITS／lifeHit／bloods／corpseAlpha）；
   這裡是小人那一份。updWorker 在飛／燒之後看到 slain(w) 就交給 stepCorpse，每幀一次。 */
const BLOOD_MAN = 0.75;             // 小人身下那一攤多大（身高倍率 scale 的幾倍）
function stepCorpse(w, wi, dt) {
  if (!w.dead) dieWorker(w);
  w.dead += dt;
  /* fall 一直撐著：聊天、蓋家、偷懶、兵器／雷／戳倒的命中判定都把 fall > 0 的人當成躺著的擋掉
     （同被里維斬殺的巨人，見 game-tools.js 的 stepDie） */
  w.fall = 1;
  w.gait += (0 - w.gait) * Math.min(1, dt * 6);
  const k = Math.min(1, dt * 9);                     // 同倒地那一行
  /* 滾著燒完的那一種（roll）：停在最近的那一面（趴著或仰著），不翻回去；其餘的往後仰躺（同被打倒）。 */
  if (w.roll) w.rspin += (Math.round(w.rspin / Math.PI) * Math.PI - w.rspin) * k;
  else w.tilt += (-Math.PI * 0.5 - w.tilt) * k;
  w.alpha = corpseAlpha(w.dead);
  if (w.dead >= DIE_HOLD + DIE_FADE) respawnWorker(wi);
}
function dieWorker(w) {
  releaseWorker(w);
  w.dead = 1e-6; w.alpha = 1; w.fall = 1; w.flee = 0; w.trip = 0; w.pause = 0; w.lazy = 0;
  w.emo = ''; w.emoT = 0; w.emoK = 0;              // 頭上的圖示收掉（同換場那一段）
  /* 血漫在身體底下：躺平的人頭朝 ±(sin a, cos a) 那一邊——仰躺是往背後倒（tilt −90°），
     滾著燒完的那一種 tilt 是 +90°（見 burnMove），頭在前面。身體中段離腳底大約 0.6 個身高倍率。 */
  const s = w.roll ? 1 : -1, sc = w.scale || 1, a = w.a || 0;
  spawnBlood(w.x + Math.sin(a) * s * 0.6 * sc, w.z + Math.cos(a) * s * 0.6 * sc, BLOOD_MAN * sc);
}
/* 淡完了：這一格換一個新的人，從島的邊上走進來（使用者：「消失後從地圖邊界走進一隻新的」）。
   **換掉整個物件**，不是把欄位一個一個清回去：身上有些欄位是別處用到才長出來的（龍捲風、巡路、射箭那幾段），
   漏清一個就是一個鬼。身分照編號（工程師 0 號、魔法師、肌肉小人，見 tagEngineer 那三支），所以重新貼一次——
   死的是工程師，新來的那一個就接著當工程師。從上一個人那裡接過來的只有三件：
     · own：住的那間家空下來給新來的住。不接的話死一個人村子就多蓋一間（已經有家的人不再蓋，見 v1.109）。
     · tone：換一組衣服顏色，同一格的新人不要長得跟剛死的那一個一模一樣（色組是 1 或 4 個，見 WCOL）。
     · 完工之後才進來的不慶祝：同逃命跑完那一行，直接算散場、挑一個閒晃點往裡走。 */
function respawnWorker(i) {
  const old = workers[i], w = newWorker(i), p = edgeSpot();
  w.tone = old.tone + 1 + Math.floor(Math.random() * 3);
  w.own = old.own;
  w.x = p.x; w.z = p.z; w.a = Math.atan2(-p.x, -p.z);   // 面向工地
  w.sx = w.x; w.sz = w.z;                          // 卡住脫困的錨點從這裡起算（見 stuckWatch）
  workers[i] = w;
  tagEngineer(); tagMage(); tagMuscle();
  if (idlePhase()) { w.cheer = CHEER_T + w.cout; idleSpot(w); }
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
/* 追一塊料追這麼久都沒更近，就放掉那一筆（v1.225）。這是**最後一道保險**，不是繞路機制：
   他認的那一格在這段時間一直鎖著，別人領不到——v1.224 實測城牆繞圈（見 開發筆記〈目標在另一面牆外、靠轉角：走出缺口又切回城裡〉）
   讓 12 個人把最後 22 格鎖了 60～143 秒以上，其餘 48 個人一格都領不到，整座停在 99%。
   門檻照實測訂：正常施工一趟最久多久沒更近——3000 塊的四座 2.05～8.7 秒，
   9000 塊的美國白宮 27.45 秒（大工地繞外圈）。放掉的那一塊記在 w.gvb，這一座他不再認它，
   不然下一幀他又把同一塊、同一格認回來。 */
const PICK_GIVE = 60;
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
/* skip（v1.225）：這一塊不挑——他追太久放掉的那一塊（見 PICK_GIVE）。 */
function findBlock(wx, wz, maxD, outside, skip) {
  let best = -1, bd = maxD ? maxD * maxD : Infinity;   // 給了 maxD 就只找那麼遠以內的
  let out = -1, od = bd;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.st !== FREE || !b.rest || b.holder >= 0 || i === skip) continue;
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
/* 站位從工地外**走不到**（在牆裡、或被蓋好的部分圍住）就改站「走得到、離那一格最近」的點丟，
   **不設上限**（v1.236，使用者：放料的站位在建築裡走不到「改成站在外面丟」，丟多遠選「不設上限」）。
   v1.60～v1.235 退太遠就「照舊走進去」，那一段是穿牆走進去的——87 座照藍圖順序蓋、每三格量一次，
   86745 次裡有 2450 次站位從外面走不到、其中 2051 次站位本身就在牆裡。巡路規則之下那條路不存在
   （見 開發筆記〈巡路規則：地標那一層〉）。實測最遠要丟 25.7 格（羅浮宮金字塔），
   肌肉小人本來就會丟 12～30 格。走得到的照舊是上面那一套（沿半徑退到牆外）。 */
const STAND_OUT = 1.3;              // 站在格子外面多遠
/* 沿半徑最多退到離格子幾格，超過就改站在格子旁邊（走不到的話下面那一條接手）。
   v1.60 從 10 拉到 13：拋得遠一點，就有更多「內部的格子」退得出牆外，不必走進去擺。 */
const TOSS_MAX = 13;
function standPos(s) {
  const d = Math.hypot(s.x, s.z);
  const ux = d < 0.001 ? 1 : s.x / d, uz = d < 0.001 ? 0 : s.z / d;
  const near = Math.max(1.5, d + STAND_OUT);
  const far = Math.max(near, siteR + KEEP);
  let r = near;
  for (let t = near; t <= far; t += 0.5)              // 由內往外掃，記住最外面那道牆
    if (footBlocked(ux * t, uz * t)) r = t + 1;
  if (r > d + STAND_OUT + TOSS_MAX) r = near;         // 退太遠了：站在格子旁邊
  const x = ux * r, z = uz * r;
  if (lmReach(x, z)) return { x, z };
  const p = lmNearReach(s.x, s.z);                    // 走不到：站到外面離它最近的地方丟
  return p ? { x: p.x, z: p.z } : { x, z };
}
function walkTo(w, dt) { return stepTo(w, w.tx, w.tz, dt); }
/* 直線走（上工、拆除／整地退場在用）。
   v1.102～v1.234 是「直直走 ＋ dodgeHome 每幀掰切線 ＋ pushOutHome 推出來」，
   v1.235 起照巡路規則走（見 navAim）：目標壓在框裡先挪到框外、直線不通就規劃、
   每一步不准踩進或切過障礙。v1.236 起地標也在同一張地圖上（見 navBody）：上工的人
   走進工地放料一樣照圖走——沒蓋的地方直接穿過去，柱子底下空的就從底下過。 */
function stepTo(w, tx, tz, dt) {
  const bd = navBody(w);
  const g = navGoal(w, tx, tz, bd);                 // 規則 2
  if (g) { tx = g.x; tz = g.z; }
  const d = Math.hypot(tx - w.x, tz - w.z);
  /* 抵達也要推一次（v1.97）：推只掛在「有移動」那條路徑上的話，
     一個站在屋子裡不動的人永遠不會被推出來。 */
  if (d < REACH) { pushOutHome(w); w.gait += (0 - w.gait) * Math.min(1, dt * 8); return true; }
  w.spd = WALK;
  const a = navAim(w, tx, tz, bd, dt);              // 規則 3～5：這一步往哪裡走
  const ax = a ? a.x : tx, az = a ? a.z : tz;
  const da = Math.hypot(ax - w.x, az - w.z) || 1;
  const ux = (ax - w.x) / da, uz = (az - w.z) / da;
  const sp = Math.min(WALK * dt, a ? da : d);
  navMove(w, ux * sp, uz * sp, bd);
  navFace(w, ux, uz);
  w.ph += dt * 11;
  w.gait += (0.85 - w.gait) * Math.min(1, dt * 8);
  return false;
}
/* 上工的走法（pick／build）就是 walkTo（v1.236）。v1.103～v1.235 是 buildWalk：把建築當成半徑 siteR 的
   一根柱子，直線通就直走（pathClear 每 0.25 秒重算、每幀往前看 1.3 格）、不通就 ringWalk 繞外圈、
   對準目標那條半徑再直直走進去（standPos 保證那條半徑往外沒有積木）；v1.195～v1.235 開頭還有一段
   「城牆隔開就先繞過去」。那一整套是「沒有地圖」時的替代品——地標在圖上之後，繞外圈、
   對準半徑、先繞城牆都是規劃會自己走出來的路（見 開發筆記〈巡路規則：地標那一層〉）。 */

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
     ① 撐過 STUCK_T 秒 → 重新找路線（v1.108～v1.234 是讓 buildWalk 重判直線通不通）
     ② 再撐 STUCK_T 秒還是沒動 → 穿透 GHOST_T 秒：這幾秒房子與地標都不擋他、也不推他出來
        （pushOutHome／blockHome／ringWalk 與巡路規則那幾支都認這個旗標）。
   為什麼不一開始就穿透：穿牆很醒目，多數卡住重找一次路線就解了；
   為什麼一定要有穿透這一段：使用者已經指定過「真的修不好的話，小房子就不要擋住小人了，
   讓他直接穿越」（v1.105），而重找路線對「四面被圍住」那種殘局沒有用。
   v1.235 起這一段就是巡路規則的第 6 條（見 navAim）：① 的「重新找路線」真的是重新規劃一次；
   「沒前進」照**自己的腳程**判（見 STUCK_R）。 */
/* 這麼久之內還沒離開錨點這麼遠，就算沒前進。**這是小人（WALK）的數字**，
   實際用的是 STUCK_R × 腳程 ÷ WALK（v1.235）：寫死 1.2 格的話，最慢的羊（1.3）1.5 秒
   最多也才 1.95 格，沿著牆邊滑的時候實際前進 0.69 格——明明一直在前進卻被判成卡住，
   3 秒後就穿牆過去了（見 開發筆記〈巡路規則〉）。小人照比例算回來剛好還是 1.2。 */
const STUCK_R = 1.2;
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
  const R = STUCK_R * (w.spd || WALK) / WALK;
  if ((w.x - w.sx) ** 2 + (w.z - w.sz) ** 2 > R * R) {
    w.sx = w.x; w.sz = w.z; w.stk = 0; return;      // 真的前進了：錨點跟上去
  }
  const first = w.stk < STUCK_T;
  w.stk += dt;
  if (w.stk < STUCK_T) return;
  if (w.stk < STUCK_T * 2) {                        // ① 重新找路線
    showEmo(w, 'quest');                            // 走不動了：頭上冒個問號（v1.121）
    /* 路線作廢、馬上重新規劃（規則 4，見 navAim）：剛好卡在「剛規劃過找不到路、還在等」的時候
       也不等。**只在進 ① 的那一幀做**：這一段每幀都會進來，每幀作廢的話路線永遠走不到第二步。
       v1.108～v1.234 這裡還會把壓在人家外框裡的目標挪出來——那件事現在是規則 2，
       strollTo／stepTo 每幀都在做（見 navGoal）。 */
    if (first) { w.nav = null; w.navWait = 0; }
    return;
  }
  w.ghost = GHOST_T;                                // ② 穿透
  w.nav = null;
}

/* ── 巡路規則（v1.235）─────────────────────────────────────
   > 使用者：「巡路能力 是要寫出巡路規則 而盡量不該有一推根據特例去修」
   規則全文、定案過程與量到的數字見 開發筆記〈巡路規則〉。第一輪是房子與城牆那一層，
   第二輪（v1.236）把地標也放上同一張地圖（見下面〈地標那一層〉與 navBody）。
     1 可走地圖：不在房子／樹幹外框、砌好的城牆（門洞與沒砌的段除外）裡的地方（footHome），
       也不碰到地標擋路的柱子（照各自身高與身長，見 lmFree）。
       框碰在一起就是連成一塊——格子地圖上它們本來就是連著的，不必另外認
     2 目標不在可走區域裡 → 改成離它最近的可走點（navGoal）
     3 直線走得通就直走，不通就在格子地圖上找最短路、拉直成幾個轉角（navAim → navPlan）
     4 目標換了、眼前這一段被新長出來的東西擋住（每 NAV_CHK 看一次）、卡住（stuckWatch ①）就重新規劃
     5 每一步不准踩進或切過障礙，碰到就沿邊滑（navMove）；看得到再下一段才跳到下一個轉角（navAim）
     6 真的沒路才穿透（stuckWatch ②）
   strollTo／stepTo 照這個順序叫：navGoal → navAim → navMove。走的人換腳程就是換一種生物，
   換身體（bd，見 navBody）就是換一張地標的地圖；bd 給 null 就只看房子與城牆。 */
const NAV_CELL = 0.5;               // 格子多大：最窄的縫（窄巷 1 格、城門洞 5 格）要分得出來
const NAV_MAX = 160;                // 一邊最多幾格：範圍再大就把格子放粗，一次最多 160×160
const NAV_PAD = [10, 25, 45];       // 兩端外接框往外多看幾格；找不到路就放大再找（U 形口袋的出口在背面）
const NAV_SOFT = 4;                 // 貼著牆那一圈的代價倍率：路線寧可離牆半格，窄巷才貼著走
const NAV_HIT = REACH + 0.1;        // 離轉角多近算走到了。要比 REACH 大：不然走到 REACH 以內時
                                    // strollTo 說「到了」、這裡說「還沒」，他就站在那裡不動
const NAV_MOVE = 1.5;               // 目標挪了這麼遠就不算同一個目標（路線作廢）
const NAV_CHK = 0.25;               // 多久看一次眼前那一段還通不通（同 v1.235 以前 buildWalk 的 PATH_CHK）
const NAV_RETRY = 1;                // 規劃不出路之後隔多久再試（每幀重算一次失敗的 A* 太貴）
const NAV_GOAL_R = 20;              // 目標壓在框裡時往外找可走點找多遠（最大的房子半寬 8）
const NAV_EPS = 1e-3;               // 判斷「切過框」時框往外擴一點點：角碰角那一點本身不在任何一間裡
/* 這一段直線有沒有碰到障礙（規則 1）。門洞走得過：命中門樓的外框之後改拿兩側墩座去比（同 wallHit）。
   框往外擴 NAV_EPS：正對著角碰角那一點的線段不擴就量不到。
   bd 是走的那個身體（見 navBody）：給了就連地標一起看（lmSeg），null／false 只看房子與城牆。
   v1.235 這裡的第五個參數是 noGap（門洞也算擋住），可是每一個呼叫端給的都是 false——
   唯一給 true 的巨人本來就不規劃（見 strollTo），v1.236 換成 bd。 */
function navSeg(x0, z0, x1, z1, bd) {
  if (homes) {
    const E = NAV_EPS;
    for (const h of homes.list) {
      if (!(h.x0 < h.x1 && h.z0 < h.z1)) continue;              // 一塊都還沒砌的空框
      if (!segBox(x0, z0, x1, z1, h.x0 - E, h.z0 - E, h.x1 + E, h.z1 + E)) continue;
      const g = h.gap;
      if (!g) return false;
      if (g.x1 - g.x0 < h.x1 - h.x0) {                           // 門洞窄的是 x 軸＝這一面沿 x 走
        if (segBox(x0, z0, x1, z1, h.x0 - E, h.z0 - E, g.x0 + E, h.z1 + E) ||
            segBox(x0, z0, x1, z1, g.x1 - E, h.z0 - E, h.x1 + E, h.z1 + E)) return false;
      } else if (segBox(x0, z0, x1, z1, h.x0 - E, h.z0 - E, h.x1 + E, g.z0 + E) ||
                 segBox(x0, z0, x1, z1, h.x0 - E, g.z1 - E, h.x1 + E, h.z1 + E)) return false;
    }
  }
  return lmSeg(x0, z0, x1, z1, bd);
}
/* 走一步（規則 5）：這一步的終點不在障礙裡、而且從起點到終點不切過任何障礙才走；
   不行就沿邊滑——先留走得比較多的那一軸，不行換另一軸，兩軸都不行就這一幀不動。
   v1.97～v1.234 是「先走進去、再從最近的那一面推出來」（pushOutHome）：框碰在一起時
   推出這一間剛好落進隔壁、一來一回順著接縫鑽過去；兩間只有角碰角時一步就跨過那個點，推都推不到。
   pushOutHome 還是留在最後當保險：房子剛好在這一幀長到他腳下（這一步規則管不到）。
   地標沒有「推出來」這一步（v1.236）：人已經在地標的身位裡（砌上去的那一塊剛好在他腳邊、被炸進來），
   這一步只准**往外**走（離地標越走越遠），不管切不切過——不然每一步都不准、只能等 3 秒穿透。
   實際走了多少記在 _nm（navFace 與閒晃里程要用）。 */
const _nm = { x: 0, z: 0 };
function navMove(w, dx, dz, bd) {
  const px = w.x, pz = w.z;
  const f = bd && bd.H ? lmField(bd.H) : null;
  const d0 = f ? lmDist(px, pz, f, bd.r) : Infinity;
  const inLm = d0 < (f ? bd.r : 0);
  const ok = (x, z) => w.ghost > 0 || (!footHome(x, z) &&
    (inLm ? navSeg(px, pz, x, z, null) && lmDist(x, z, f, bd.r) > d0 : navSeg(px, pz, x, z, bd)));
  if (ok(px + dx, pz + dz)) { w.x = px + dx; w.z = pz + dz; }
  else {
    const xFirst = Math.abs(dx) >= Math.abs(dz);
    for (let k = 0; k < 2; k++) {
      const keepX = (k === 0) === xFirst;
      const qx = keepX ? px + dx : px, qz = keepX ? pz : pz + dz;
      if (ok(qx, qz)) { w.x = qx; w.z = qz; break; }
    }
  }
  pushOutHome(w);
  _nm.x = w.x - px; _nm.z = w.z - pz;
}
/* 面向真正在走的方向（沿邊滑的時候不是想走的方向）；這一幀沒動就面向想走的方向 */
function navFace(w, ux, uz) {
  w.a = _nm.x * _nm.x + _nm.z * _nm.z > 1e-8 ? Math.atan2(_nm.x, _nm.z) : Math.atan2(ux, uz);
}
/* 規則 2：目標壓在障礙裡就改走到離它最近的可走點。一圈一圈往外找（半格一圈），
   同一圈上一樣近的挑離自己近的那一邊（從哪邊來就停在哪邊）。不在障礙裡就 null。
   v1.108～v1.234 這件事是 stuckWatch 在管（卡 1.5 秒才挪），可是目標壓得深的時候他**不算卡**——
   繞著那間房子一直轉（實測 30 秒走了 198 格）；呼叫端每幀重算目標的（吉祥物砸村子那一趟的站位，
   見 game-tools.js 的 fun），挪完下一幀又被蓋回去。所以改在走路這一層每幀問。
   同一點算過就不再找（stepTo 的呼叫端每幀傳同一點進來）。回傳同一個暫存物件，呼叫端當場抄走。 */
/* 「可走點」要離障礙至少四分之一格（規則 1 的「縫小於身位也算牆」）：兩間貼在一起時，
   接縫那一條線本身不在任何一間裡（footHome 是開區間），不留這一點餘裕的話目標會被挪到縫上——
   那是走不到的一條線（實測目標壓在接縫旁邊：每一種走法都卡住、靠穿透才到）。
   地標那一層同一個道理（v1.236）：離擋路的柱子要比身位再多這麼一點。 */
const NAV_ROOM = NAV_CELL / 2;
const navRoom = (x, z, bd) =>
  !footHome(x, z) && !footHome(x - NAV_ROOM, z) && !footHome(x + NAV_ROOM, z) &&
  !footHome(x, z - NAV_ROOM) && !footHome(x, z + NAV_ROOM) && lmFree(x, z, bd, NAV_ROOM);
const _ng = { x: 0, z: 0 };
function navGoal(w, x, z, bd) {
  if (w.ghost > 0 || (!footHome(x, z) && lmFree(x, z, bd))) return null;
  /* 同一點算過就沿用——**挪過去的那一點還站得下才算數**：地標一直在長，上一次挪到的地方可能剛砌上一塊 */
  if (w.ngx === x && w.ngz === z && w.ngb === bd && navRoom(w.ngX, w.ngZ, bd)) {
    _ng.x = w.ngX; _ng.z = w.ngZ; return _ng;
  }
  /* 找多遠：房子最寬半寬 8，NAV_GOAL_R 夠了；壓在地標裡的（點到建築正中央、撿地標旁邊的料）
     要能一路找到建築外面，最大那幾座 siteR 45 */
  const R = lmFree(x, z, bd) ? NAV_GOAL_R : Math.max(NAV_GOAL_R, siteR + bd.r + 2);
  let bx = x, bz = z, best = Infinity;
  for (let r = NAV_CELL; r <= R && best === Infinity; r += NAV_CELL) {
    const n = Math.ceil(2 * Math.PI * r / NAV_CELL);
    for (let k = 0; k < n; k++) {
      const a = k / n * Math.PI * 2, qx = x + Math.cos(a) * r, qz = z + Math.sin(a) * r;
      if (!navRoom(qx, qz, bd)) continue;
      const d = Math.hypot(qx - w.x, qz - w.z);
      if (d < best) { best = d; bx = qx; bz = qz; }
    }
  }
  if (best === Infinity) return null;
  w.ngx = x; w.ngz = z; w.ngX = bx; w.ngZ = bz; w.ngb = bd;
  _ng.x = bx; _ng.z = bz;
  return _ng;
}
/* 規則 3～5：這一幀往哪裡走。回傳路線上的下一個轉角，直走（直線通、或規劃不出路）就 null。
   bd 是走的那個身體（見 navBody），地標照它的身高與身長擋。
   直線一通就把路線丟掉（繞過轉角之後常常就看得到目標了）。
   v1.235 這裡還有一個 keep（工地圈的半徑，規劃時當牆）：那是地標還不在地圖上時的替代品，v1.236 收掉。 */
function navAim(w, tx, tz, bd, dt) {
  if (w.ghost > 0) { w.nav = null; return null; }
  if (bd && bd.H && !lmFree(w.x, w.z, bd)) { w.nav = null; return navEscape(w, bd, tx, tz); }
  let n = w.nav;
  if (n && (n.bd !== bd || Math.hypot(n.tx - tx, n.tz - tz) > NAV_MOVE)) n = w.nav = null;   // 目標換了
  if (navSeg(w.x, w.z, tx, tz, bd)) { w.nav = null; return null; }
  if (!n) {
    if (w.navWait > 0) { w.navWait -= dt; return null; }
    n = navPlan(w, tx, tz, bd);
    if (!n) { w.navWait = NAV_RETRY; return null; }   // 沒路：照直線走，卡住了由規則 6 接手
    w.nav = n;
  }
  /* 跳到下一個轉角的條件：**看得到再下一段**（從現在的位置到下下一點直線走得通），或已經走到了。
     只看「走進一格內就跳」的話會在還沒繞過屋角時就跳，下一段直線切進那一間，
     只好貼著牆慢慢滑（L 形留兩格縫那一場，羊就是這樣被當成卡住、3 秒後穿牆）。 */
  while (n.i < n.p.length) {
    const q = n.p[n.i], last = n.i + 1 >= n.p.length;
    const qx = last ? tx : n.p[n.i + 1].x, qz = last ? tz : n.p[n.i + 1].z;
    if (navSeg(w.x, w.z, qx, qz, bd) || Math.hypot(q.x - w.x, q.z - w.z) < NAV_HIT) n.i++;
    else break;
  }
  if (n.i >= n.p.length) { w.nav = null; return null; }
  const q = n.p[n.i];
  n.chk -= dt;
  if (n.chk <= 0) {                                   // 規則 4：眼前這一段被新長出來的東西擋住了
    n.chk = NAV_CHK;
    if (!navSeg(w.x, w.z, q.x, q.z, bd)) { w.nav = null; w.navWait = 0; }
  }
  return q;
}
/* 人已經在地標的身位裡（砌上去的那一塊剛好在他腳邊、被炸進來）：先往最近站得下的地方走——規則 2 用在自己身上，
   不規劃。從身位裡接不上格子，規劃一定失敗，而失敗的 A* 最貴（三段範圍都搜過一遍）：〈效能〉那一幕
   （吉薩 3000 從零開始蓋、60 人）240 幀裡 35 次規劃全部是這樣失敗的，平均每幀 0.21 ms。
   一圈一圈往外找（NAV_ROOM 一圈），第一圈有站得下的點就挑離目標最近的那一個（往要去的那一邊出去）；
   找不到回 null（照直線走，navMove 只准往外）。回傳同一個暫存物件。 */
const _ne = { x: 0, z: 0 };
function navEscape(w, bd, tx, tz) {
  const f = lmField(bd.H);
  for (let r = NAV_ROOM; r <= bd.r + 2; r += NAV_ROOM) {
    const n = Math.ceil(2 * Math.PI * r / NAV_ROOM);
    let best = Infinity;
    for (let k = 0; k < n; k++) {
      const a = k / n * Math.PI * 2, qx = w.x + Math.cos(a) * r, qz = w.z + Math.sin(a) * r;
      if (footHome(qx, qz) || lmDist(qx, qz, f, bd.r) < bd.r) continue;
      const d = Math.hypot(qx - tx, qz - tz);
      if (d < best) { best = d; _ne.x = qx; _ne.z = qz; }
    }
    if (best < Infinity) return _ne;
  }
  return null;
}
/* 規劃一條路（規則 3）。找到回傳 { p: 轉角們, i: 走到第幾個, tx, tz, bd, chk }；
   找不到、或格子上根本是直線（不必繞）就 null。
   v1.235 起點或終點在工地圈裡不規劃（那時地標還不在地圖上，交給 ringWalk／standPos），v1.236 收掉。 */
function navPlan(w, tx, tz, bd) {
  if ((!homes || !homes.list.length) && !lmAny(bd)) return null;   // 地圖上什麼都沒有
  for (const pad of NAV_PAD) {
    const p = navGrid(w.x, w.z, tx, tz, pad, bd);
    if (p === false) return null;           // 起點或終點接不上格子：範圍放大也一樣，不必再搜
    if (p) return p.length ? { p, i: 0, tx, tz, bd, chk: NAV_CHK } : null;
  }
  return null;
}
/* 一次 A*。格子半格一格，擋住＝格子中心在障礙裡（房子、城牆，與這個身體碰得到的地標柱子），
   貼著牆那一圈加價（NAV_SOFT），不准斜切兩個擋住的格子之間（角碰角那道縫就是這樣關起來的）。
   找到回傳拉直過的轉角陣列（可能是空的＝格子上是直線），這個範圍裡找不到回傳 null，
   起點或終點根本接不上格子回傳 false（範圍放大也沒用）。 */
function navGrid(sx, sz, tx, tz, pad, bd) {
  const X0 = Math.min(sx, tx) - pad, Z0 = Math.min(sz, tz) - pad;
  const W = Math.max(sx, tx) + pad - X0, H = Math.max(sz, tz) + pad - Z0;
  const c = Math.max(NAV_CELL, Math.max(W, H) / NAV_MAX);
  const nx = Math.ceil(W / c), nz = Math.ceil(H / c), N = nx * nz;
  const blk = new Uint8Array(N);                   // 0 空地、1 貼著牆、2 擋住
  const f = bd && bd.H ? lmField(bd.H) : null;
  for (let j = 0, k = 0; j < nz; j++) {
    const z = Z0 + (j + 0.5) * c;
    for (let i = 0; i < nx; i++, k++) {
      const x = X0 + (i + 0.5) * c;
      if (footHome(x, z) || (f && lmDist(x, z, f, bd.r) < bd.r)) blk[k] = 2;
    }
  }
  for (let j = 0, k = 0; j < nz; j++) for (let i = 0; i < nx; i++, k++) {
    if (blk[k]) continue;
    for (let dj = -1; dj <= 1 && !blk[k]; dj++) for (let di = -1; di <= 1; di++) {
      const a = i + di, b = j + dj;
      if (a >= 0 && b >= 0 && a < nx && b < nz && blk[b * nx + a] === 2) { blk[k] = 1; break; }
    }
  }
  const ci = x => Math.min(nx - 1, Math.max(0, Math.floor((x - X0) / c)));
  const cj = z => Math.min(nz - 1, Math.max(0, Math.floor((z - Z0) / c)));
  /* 起點與終點接到「離那一點最近、中間真的走得過去」的那一格，**不是那一點所在的那一格**：
     格子中心跟人不一定在同一邊。角碰角那一場，人站在縫的東南側，他那一格的中心卻落在
     東北那一間裡——從那一格往西一步就過了縫（原型第一版就是這樣算出一條穿過角縫的路）。 */
  const snap = (x, z) => {
    const i0 = ci(x), j0 = cj(z);
    let best = -1, sd = Infinity;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const i = i0 + di, j = j0 + dj;
      if (i < 0 || j < 0 || i >= nx || j >= nz || blk[j * nx + i] === 2) continue;
      const qx = X0 + (i + 0.5) * c, qz = Z0 + (j + 0.5) * c, d = Math.hypot(qx - x, qz - z);
      if (d < sd && !footHome(qx, qz) && navSeg(x, z, qx, qz, bd)) { sd = d; best = j * nx + i; }
    }
    return best;
  };
  const S = snap(sx, sz), G = snap(tx, tz);
  if (S < 0 || G < 0) return false;                // 接不上：跟範圍大小無關（見 navPlan）
  const gi = G % nx, gj = (G - gi) / nx;
  const g = new Float32Array(N).fill(Infinity), from = new Int32Array(N).fill(-1);
  const hk = [], hf = [];                          // 二元堆：格子編號／f 值
  const push = (k, f) => {
    let n = hk.length; hk.push(k); hf.push(f);
    while (n > 0) {
      const p = (n - 1) >> 1;
      if (hf[p] <= f) break;
      hk[n] = hk[p]; hf[n] = hf[p]; n = p;
    }
    hk[n] = k; hf[n] = f;
  };
  const pop = () => {
    const top = hk[0], lk = hk.pop(), lf = hf.pop();
    if (hk.length) {
      let n = 0;
      for (;;) {
        const l = 2 * n + 1, r = l + 1;
        let m = -1;
        if (l < hk.length && hf[l] < lf) m = l;
        if (r < hk.length && hf[r] < (m < 0 ? lf : hf[l])) m = r;
        if (m < 0) break;
        hk[n] = hk[m]; hf[n] = hf[m]; n = m;
      }
      hk[n] = lk; hf[n] = lf;
    }
    return top;
  };
  const hh = k => {
    const i = k % nx, dx = Math.abs(i - gi), dz = Math.abs((k - i) / nx - gj);
    return Math.max(dx, dz) + 0.4142 * Math.min(dx, dz);
  };
  g[S] = 0; push(S, hh(S));
  let found = false;
  while (hk.length) {
    const k = pop();
    if (k === G) { found = true; break; }
    const i = k % nx, j = (k - i) / nx;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= nx || b >= nz) continue;
      const q = b * nx + a;
      if (blk[q] === 2) continue;
      if (di && dj && (blk[j * nx + a] === 2 || blk[b * nx + i] === 2)) continue;   // 不斜切
      const st = g[k] + (di && dj ? 1.4142 : 1) * (blk[q] ? NAV_SOFT : 1);
      if (st < g[q]) { g[q] = st; from[q] = k; push(q, st + hh(q)); }
    }
  }
  if (!found) return null;
  const cells = [];
  for (let k = G; k >= 0; k = from[k]) cells.push(k);
  cells.reverse();
  const px = k => X0 + (k % nx + 0.5) * c, pz = k => Z0 + ((k - k % nx) / nx + 0.5) * c;
  /* 拉直：從現在這一格往前看，看得到的最遠那一格才是下一個轉角。「看得到」要兩個都成立：
     中間的格子沒有擋住、也不貼牆（留半格餘裕），而且真的幾何上不切過障礙（navSeg：格子只取樣）。 */
  const see = (ax, az, bx, bz) => {
    const n = Math.ceil(Math.hypot(bx - ax, bz - az) / (c / 2));
    for (let s = 1; s < n; s++) {
      const t = s / n;
      if (blk[cj(az + (bz - az) * t) * nx + ci(ax + (bx - ax) * t)]) return false;
    }
    return navSeg(ax, az, bx, bz, bd);
  };
  /* **從接上去的那一格開始拉，不是從人站的那一點**：人常常貼著牆站（剛沿邊滑過來），
     從那一點起算的話第一段會被跳過驗證，直接連到第二格——那一段會切過屋角
     （寫測試時量到的：轉角之間走不通的有 6 段，全是第一段）。人看得到第一個轉角就直接過去，
     看不到就先走到接上去的那一格（snap 保證那一段走得通）。 */
  const out = [];
  let cx = px(S), cz = pz(S);
  for (let a = 0; a < cells.length - 1;) {
    let b = a + 1;
    while (b + 1 < cells.length && see(cx, cz, px(cells[b + 1]), pz(cells[b + 1]))) b++;
    cx = px(cells[b]); cz = pz(cells[b]); a = b;
    out.push({ x: cx, z: cz });
  }
  out.pop();                        // 最後一格＝目標那一格：交給呼叫端直接走向真正的目標
  const fx = out.length ? out[0].x : tx, fz = out.length ? out[0].z : tz;
  if (!navSeg(sx, sz, fx, fz, bd)) out.unshift({ x: px(S), z: pz(S) });
  return out;
}
/* 工地圈把目標推到圈上。v1.235 是 strollTo 開頭那一段（每一種走法都推）；v1.236 起地標在地圖上了，
   走法不再推，剩下兩個「去哪」的呼叫端：巨人（牠不規劃，照舊把工地圈當牆，見 strollTo）、
   天災與吉祥物進場（come：走到工地外圈就算到了，見 game-tools.js 的 stepBeast0）。回傳暫存物件。 */
const _kp = { x: 0, z: 0 };
function keepOut(w, x, z, keep) {
  const tr = Math.hypot(x, z);
  _kp.x = x; _kp.z = z;
  if (tr < keep) {
    const a = tr < 0.001 ? Math.atan2(w.z, w.x) : Math.atan2(z, x);
    _kp.x = Math.cos(a) * keep; _kp.z = Math.sin(a) * keep;
  }
  return _kp;
}
/* 從這裡照規則走不走得到那一點（天災「有門走門、沒門破牆而入」要問的，見 game-tools.js 的 gateNeed）。
   目標照 strollTo 的算法先換過（壓在障礙裡就挪到最近的可走點），走得到就把路線記在 w.nav，
   接著走的那一段（gate）直接沿用。走不到的記下來，隔 NAV_RETRY 秒才再算
   （呼叫端每幀都會問，而失敗的 A* 最貴：整個範圍都搜過一遍）。
   v1.235 目標還會先推到工地圈上（keepMore 是那一圈再往外幾格），v1.236 地標在地圖上了，收掉。 */
function navReach(w, tx, tz) {
  const bd = navBody(w);
  let gx = tx, gz = tz;
  const g = navGoal(w, gx, gz, bd);
  if (g) { gx = g.x; gz = g.z; }
  if (navSeg(w.x, w.z, gx, gz, bd)) return true;
  if (w.nav && w.nav.bd === bd && Math.hypot(w.nav.tx - gx, w.nav.tz - gz) <= NAV_MOVE) return true;
  if (w.nrf > frameNo && Math.hypot(w.nrx - gx, w.nrz - gz) <= NAV_MOVE) return false;
  const p = navPlan(w, gx, gz, bd);
  if (p) { w.nav = p; return true; }
  w.nrf = frameNo + Math.round(NAV_RETRY / 0.05); w.nrx = gx; w.nrz = gz;
  return false;
}

/* ── 巡路規則：地標那一層（v1.236）─────────────────────────
   > 使用者：「可走區域 地標的部分 有些底部很空 其實要算可以走 可能可以當作最底層兩格高是空的
   >   或還沒蓋上去的就可以走 除非是去撿料來蓋」
   > 使用者：「有時候碎料掉在已經建起來的建築內 這時可以穿牆進去撿」
   v1.235 以前地標在走路這一層是「半徑 siteR + KEEP 的一個圓」（strollTo 推目標、掰切線，buildWalk／ringWalk
   繞外圈）——蓋好的部分實際只佔那個圓的 39%（87 座蓋完的中位數；噴射客機 0.4%、焦糖布丁 77%），
   剩下那六成走得過卻一律繞圈；62 座有底下三層是空的柱子（合計 10389 根，佔全部柱子的 22%）。
   這一層把地標放上規則 1 的地圖，照使用者定的兩件事：
     · **身高**：一根柱子從地面往上「身高那麼多層」都沒有砌好的積木才走得過。照各自的身高
       （小人 2.1～2.4 格＝三層，同 footBlocked 看三層的理由；牛羊兩三層、鹿四層、飛龍獅鷲六層）。
       還沒蓋的柱子當然不擋。
     · **身長**：身體照身長一半往外擴（使用者選的「照身長往外擴」）——離每一根擋路的柱子至少這麼遠
       （小人 0.62～0.73、黑獼猴 0.64、牛 1.7、羊 1.1、獅鷲 3.9、飛龍 9）。只套在地標上：
       房子與城牆照第一輪當一個點（使用者選項裡定的）。
   詳細與量到的數字見 開發筆記〈巡路規則：地標那一層〉。 */
const LM_NONE = 32767;              // 這一根柱子一塊都沒砌
/* 每一根柱子最低那一塊砌在第幾層（藍圖格子座標 gz × (gMaxX+1) + gx）。一幀重算一次：
   地標會被三個地方改（放上去、被打掉、瞬間蓋好），測試也會直接改 slot.filled，
   逐一追著改不如每幀掃一遍（三千塊 ≒ 幾十微秒）。內容真的變了 lmVer 才加一，距離表照它判新舊。 */
let lmLo = null, lmScan = null, lmAt = -1, lmOf = null, lmVer = 0;
function lmLow() {
  if (!bp) return null;
  if (lmAt === frameNo && lmOf === bp) return lmLo;
  const nx = gMaxX + 1, N = nx * (gMaxZ + 1);
  if (!lmScan || lmScan.length !== N) lmScan = new Int16Array(N);
  lmScan.fill(LM_NONE);
  for (const s of bp.slots) {
    if (!s.filled) continue;
    const k = s.gz * nx + s.gx;
    if (s.gy < lmScan[k]) lmScan[k] = s.gy;
  }
  let same = lmOf === bp && lmLo && lmLo.length === N;
  if (same) for (let k = 0; k < N; k++) if (lmLo[k] !== lmScan[k]) { same = false; break; }
  if (!same) { lmLo = Int16Array.from(lmScan); lmVer++; }
  lmOf = bp; lmAt = frameNo;
  return lmLo;
}
/* 距離表：每一種身高一張（身高決定哪幾根柱子擋路）。格子跟藍圖的柱子對齊、往外多留 LM_PAD 格，
   每一格記「離它最近的那一根擋路柱子」是哪一根（兩趟掃過去傳遞，dead reckoning）。
   查一點的距離時拿它自己與周圍八格記的那幾根，量**點到那幾個方塊**的真距離取最小——
   比單純存一個距離精準得多：身體半徑 0.62 的小人要分得出 2 格寬的縫（中線離兩邊各 1 格）。
   擋路的柱子沒變（只是上面多砌了幾層）就沿用舊的表：蓋到上半段之後大半的幀都是這樣。
   **只多了幾根**（蓋下面那幾層時幾乎每幀都是）就就地更新：從新的那幾根往外灌，
   鄰格記的那一根比它遠才換、換了才繼續往外（整張重掃一次，羅浮宮金字塔那種大的要 0.3 ms，
   蓋底下三層的那幾十秒幾乎每幀都要付）。少了柱子（被打掉）才整張重算。
   gen 是這張表的內容版本（就地更新也加一）：走得到的範圍照它判新舊（見 lmReachMap）。 */
const LM_PAD = 12;                  // 要比最大的身體半徑（飛龍 9）再多 2 格以上：表外一律當作離得很遠
const LM_INC = 64;                  // 一次多這麼多根以內就地更新，再多就整張重算
const lmFields = new Map();         // 身高 → 距離表
let lmGen = 0;
function lmField(H) {
  const lo = lmLow();
  if (!lo) return null;
  let f = lmFields.get(H);
  if (f && f.ver === lmVer && f.of === bp) return f;
  const bx = gMaxX + 1, bz = gMaxZ + 1, P = LM_PAD, nx = bx + 2 * P, nz = bz + 2 * P, N = nx * nz;
  const blk = new Uint8Array(N);
  let n = 0;
  for (let gz = 0; gz < bz; gz++) for (let gx = 0; gx < bx; gx++)
    if (lo[gz * bx + gx] < H) { blk[(gz + P) * nx + gx + P] = 1; n++; }
  if (f && f.of === bp && f.nx === nx && f.nz === nz) {
    const add = [];
    let gone = false;
    for (let k = 0; k < N && !gone; k++) {
      if (f.blk[k] === blk[k]) continue;
      if (blk[k]) add.push(k); else gone = true;
    }
    if (!gone && add.length <= LM_INC) {
      f.ver = lmVer;
      if (!add.length) return f;
      const { site, d2, dc } = f, q = add;
      for (const k of add) { site[k] = k; d2[k] = 0; dc[k] = 0; }
      for (let p = 0; p < q.length; p++) {
        const k = q[p], s = site[k], si = s % nx, sj = (s - si) / nx, i = k % nx, j = (k - i) / nx;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const a = i + di, b = j + dj;
          if ((!di && !dj) || a < 0 || b < 0 || a >= nx || b >= nz) continue;
          const m = b * nx + a, d = (si - a) ** 2 + (sj - b) ** 2;
          if (d < d2[m]) { d2[m] = d; site[m] = s; dc[m] = Math.sqrt(d); q.push(m); }
        }
      }
      f.blk = blk; f.n = n; f.gen = ++lmGen;
      return f;
    }
  }
  const site = new Int32Array(N).fill(-1), d2 = new Float64Array(N).fill(Infinity);
  for (let k = 0; k < N; k++) if (blk[k]) { site[k] = k; d2[k] = 0; }
  const take = (k, i, j, q) => {                     // 鄰格 q 記的那一根，離 (i, j) 比較近就換成它
    const s = site[q];
    if (s < 0) return;
    const si = s % nx, sj = (s - si) / nx, d = (si - i) ** 2 + (sj - j) ** 2;
    if (d < d2[k]) { d2[k] = d; site[k] = s; }
  };
  if (n) {
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (j > 0) { take(k, i, j, k - nx); if (i > 0) take(k, i, j, k - nx - 1); if (i < nx - 1) take(k, i, j, k - nx + 1); }
      if (i > 0) take(k, i, j, k - 1);
    }
    for (let j = nz - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) {
      const k = j * nx + i;
      if (j < nz - 1) { take(k, i, j, k + nx); if (i > 0) take(k, i, j, k + nx - 1); if (i < nx - 1) take(k, i, j, k + nx + 1); }
      if (i < nx - 1) take(k, i, j, k + 1);
    }
  }
  f = { ver: lmVer, of: bp, nx, nz, n, blk, site, d2, dc: d2.map(Math.sqrt), gen: ++lmGen };
  lmFields.set(H, f);
  return f;
}
/* 這一點離擋路的柱子（方塊，不是中心）多遠。r 給了就可以偷懶：這一格記的那一根的**中心**
   離它 dc，點在格子裡最多偏 0.71、方塊的角離中心 0.71，再留半格給「兩趟掃出來的那一根不一定
   真的最近」，所以 dc − LM_LB 以上都一定比 r 遠——直接回那個下限（呼叫端只拿它跟 r 比）。
   表外的點回「到表邊的距離 ＋ LM_PAD − 0.5」（也是下限）。 */
const LM_LB = 2;
function lmDist(x, z, f, r) {
  if (!f || !f.n) return Infinity;
  const u = x - gOffX + LM_PAD, v = z - gOffZ + LM_PAD;     // 柱子中心在整數上
  const i = Math.round(u), j = Math.round(v), nx = f.nx, nz = f.nz;
  if (i < 0 || j < 0 || i >= nx || j >= nz) {
    const ex = Math.max(-0.5 - u, u - (nx - 0.5), 0), ez = Math.max(-0.5 - v, v - (nz - 0.5), 0);
    return Math.hypot(ex, ez) + LM_PAD - 0.5;
  }
  if (f.blk[j * nx + i]) return 0;                           // 就站在擋路的那一根上
  const lb = f.dc[j * nx + i] - LM_LB;
  if (r !== undefined && lb >= r) return lb;
  let best = Infinity;
  for (let dj = -1; dj <= 1; dj++) {
    const b = j + dj;
    if (b < 0 || b >= nz) continue;
    for (let di = -1; di <= 1; di++) {
      const a = i + di;
      if (a < 0 || a >= nx) continue;
      const s = f.site[b * nx + a];
      if (s < 0) continue;
      const si = s % nx, sj = (s - si) / nx;
      const d = Math.hypot(Math.max(Math.abs(u - si) - 0.5, 0), Math.max(Math.abs(v - sj) - 0.5, 0));
      if (d < best) best = d;
    }
  }
  return best;
}
/* 這一點站得下這個身體嗎（只看地標；more＝再多留這麼多，見 navRoom）。bd 沒給、或 H 是 0
   （穿地標的牆那一段，見 NB_OFF）＝地標不擋。 */
function lmFree(x, z, bd, more) {
  if (!bd || !bd.H) return true;
  const f = lmField(bd.H), r = bd.r + (more || 0);
  return !f || lmDist(x, z, f, r) >= r;
}
/* 地圖上有沒有擋這個身體的柱子（沒有的話規劃只看房子，見 navPlan） */
function lmAny(bd) {
  if (!bd || !bd.H) return false;
  const f = lmField(bd.H);
  return !!f && f.n > 0;
}
/* 這一段直線走過去，身體碰不碰得到地標。從起點往終點一段一段量：每一步量這一點離柱子多遠，
   離身位還有多遠就一次跳多遠（那一圈裡保證沒有東西）；貼著牆的時候最少也走 LM_STEP——
   擴出來的障礙最薄也有兩個身位（小人 1.24），這一步跨不過去，最多削過轉角的一點點圓角。 */
const LM_STEP = 0.2;
function lmSeg(x0, z0, x1, z1, bd) {
  if (!bd || !bd.H) return true;
  const f = lmField(bd.H);
  if (!f || !f.n) return true;
  const L = Math.hypot(x1 - x0, z1 - z0), r = bd.r;
  for (let t = 0; ;) {
    const k = L > 0 ? t / L : 0;
    const d = lmDist(x0 + (x1 - x0) * k, z0 + (z1 - z0) * k, f, r);
    if (d < r) return false;
    if (t >= L) return true;
    t = Math.min(L, t + Math.max(LM_STEP, d - r));
  }
}
/* ── 誰的身體多大（v1.236）──
   照造型表量（ENG.MODELS，跟畫出來的是同一份）：身長＝前後的長度、身高＝腳底到頭頂，都乘上自己的縮放。
   小人只量**每個人身上都有的那幾塊**（身體、頭、安全帽、手腳），道具（設計圖、聊天泡泡、鏟子、弓、槍）、
   魔法師與肌肉小人獨有的那幾塊不算：安全帽的帽緣到帽舌 0.78 就是最長的那一段。 */
let navDim = null;
function navDims() {
  if (navDim) return navDim;
  const M = ENG.MODELS;
  const scan = (parts, skip) => {
    let z0 = Infinity, z1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const b of parts) {
      if (!b || (skip && skip(b))) continue;
      z0 = Math.min(z0, b.p[2] - b.s[2] / 2); z1 = Math.max(z1, b.p[2] + b.s[2] / 2);
      y0 = Math.min(y0, b.p[1] - b.s[1] / 2); y1 = Math.max(y1, b.p[1] + b.s[1] / 2);
    }
    return { len: z1 - z0, h: y1 - y0 };
  };
  navDim = { man: scan(M.man, b => b.plan || b.bub || b.dig || b.bow || b.gun || b.kasa || b.wiz || b.mus) };
  for (const k in M) if (ENG.BEASTS[k] || k === 'saber' || k === 'levi') navDim[k] = scan(M[k]);
  return navDim;
}
/* 這個人（這隻）走路的身體：H 是幾層高的柱子擋得住他、r 是離柱子至少多遠。
   縮放變了（肌肉小人、人數重調）才重算。穿地標的牆那一段（w.lmg）回 NB_OFF：地標不擋，房子照擋。 */
const NB_OFF = { H: 0, r: 0 };
function navBody(w) {
  if (w.lmg) return NB_OFF;
  const sc = w.kind ? (w.sc || 1) : (w.scale || 1);
  if (w.nb && w.nbS === sc) return w.nb;
  const D = navDims(), d = D[w.kind || 'man'] || D.man;
  w.nb = { H: Math.max(1, Math.ceil(d.h * sc - 1e-6)), r: d.len * sc / 2 };
  w.nbS = sc;
  return w.nb;
}
/* ── 從工地外走不走得到（v1.236）──
   小人那一種身體在地標那一層的連通圖：半格一格、跟柱子對齊（柱子中心 ± 0.25，2 格寬的縫中線才落在格子上），
   從表的外框往裡灌。用在兩個地方：放料的站位走不到就改站外面丟（standPos）、撿的料走不到或人自己被圍在
   裡面就穿地標的牆（updWorker 的 pick／build）。身體取最大那一號（W_HI）：大個子走得到的，每個人都走得到。
   **最多每 LM_RM_EVERY 幀重算一次**：蓋底下三層的時候擋路的柱子幾乎每幀都在變，每幀整張重灌的話
   羅浮宮金字塔那種大的平均每幀 0.46 ms（實測 120 秒 1.1 秒）。晚幾幀才知道哪裡被圍住，
   影響的只是「要不要穿牆去撿、站位要不要改站外面」，走路本身照的是即時的距離表。 */
const LM_RM_EVERY = 10;
let lmRm = null;
function lmReachMap() {
  const D = navDims().man;
  const H = Math.max(1, Math.ceil(D.h * W_HI - 1e-6)), r = D.len * W_HI / 2;
  const f = lmField(H);
  if (!f) return null;
  if (lmRm && lmRm.of === bp && (lmRm.gen === f.gen || frameNo - lmRm.at < LM_RM_EVERY)) return lmRm;
  const M = Math.ceil(r) + 2, C = NAV_CELL;
  const x0 = gOffX - 0.5 - M, z0 = gOffZ - 0.5 - M;
  const nx = Math.round((gMaxX + 1 + 2 * M) / C), nz = Math.round((gMaxZ + 1 + 2 * M) / C), N = nx * nz;
  const ok = new Uint8Array(N);
  if (f.n) {
    const free = new Uint8Array(N);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++)
      free[j * nx + i] = lmDist(x0 + (i + 0.5) * C, z0 + (j + 0.5) * C, f, r) >= r ? 1 : 0;
    const q = [];
    for (let i = 0; i < nx; i++) { q.push(i, (nz - 1) * nx + i); }
    for (let j = 0; j < nz; j++) { q.push(j * nx, j * nx + nx - 1); }
    for (const k of q) ok[k] = free[k];
    for (let p = 0; p < q.length; p++) {
      const k = q[p];
      if (!ok[k]) continue;
      const i = k % nx;
      const nb = [i > 0 ? k - 1 : -1, i < nx - 1 ? k + 1 : -1, k >= nx ? k - nx : -1, k + nx < N ? k + nx : -1];
      for (const m of nb) if (m >= 0 && !ok[m] && free[m]) { ok[m] = 1; q.push(m); }
    }
  } else ok.fill(1);
  lmRm = { of: bp, gen: f.gen, at: frameNo, x0, z0, nx, nz, ok };
  return lmRm;
}
/* 這一點從工地外走得到嗎。容許半格：貼著牆躺的料、剛好落在身位裡的站位，旁邊那一格走得到就算 */
function lmReach(x, z) {
  const m = lmReachMap();
  if (!m) return true;
  const i = Math.floor((x - m.x0) / NAV_CELL), j = Math.floor((z - m.z0) / NAV_CELL);
  if (i < 0 || j < 0 || i >= m.nx || j >= m.nz) return true;          // 表外＝工地外
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    const a = i + di, b = j + dj;
    if (a >= 0 && b >= 0 && a < m.nx && b < m.nz && m.ok[b * m.nx + a]) return true;
  }
  return false;
}
/* 走得到的地方裡離 (x, z) 最近的那一點（一圈一圈往外找，找到之後再多看到「不可能更近」為止）。
   回傳同一個暫存物件；找不到（整張表都走不到，不會發生）回 null。 */
const _lr = { x: 0, z: 0 };
function lmNearReach(x, z) {
  const m = lmReachMap();
  if (!m) return null;
  const C = NAV_CELL, ci = Math.floor((x - m.x0) / C), cj = Math.floor((z - m.z0) / C);
  let best = Infinity;
  const look = (i, j) => {
    if (i < 0 || j < 0 || i >= m.nx || j >= m.nz || !m.ok[j * m.nx + i]) return;
    const px = m.x0 + (i + 0.5) * C, pz = m.z0 + (j + 0.5) * C, d = Math.hypot(px - x, pz - z);
    if (d < best) { best = d; _lr.x = px; _lr.z = pz; }
  };
  for (let k = 0, K = Math.max(m.nx, m.nz); k <= K; k++) {
    if ((k - 1) * C > best) break;                    // 這一圈最近也比找到的遠
    for (let i = ci - k; i <= ci + k; i++) { look(i, cj - k); if (k) look(i, cj + k); }
    for (let j = cj - k + 1; j <= cj + k - 1; j++) { look(ci - k, j); look(ci + k, j); }
  }
  return best < Infinity ? _lr : null;
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
    if (slain(w)) continue;                         // 死了、或被打滿正要倒下的也不用喊（v1.240）
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
  const lim = debrisR + 20;
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
/* 散場那一刻的第一段路：**沿著自己現在那一圈**走 12~24 格，往哪一邊轉隨機
   （v1.183，見 idleSpot 的 near）。閒晃範圍放回整片碎料場之後，「照整片按面積抽」
   對站在慶祝圈上的人來說幾乎都是朝外，「一圈人整齊往外走」就會回來
   （實測平均徑向分量 +0.27～+0.34，跟 v1.60 的壞值同一區間）。
   **為什麼要 12 格起跳**：散場後那幾秒才是看得到的那一段（測試量的是 4 秒），
   而小人 4 秒走得了 27 格——第一段只給 10 格的話 1.5 秒就走完了，剩下的時間
   又回到「照整片抽」的外向目標上（實測 0.26～0.39，照樣紅）。
   下限也保證每個人真的動起來：長度抽到接近 0 的人會站在原地，被算成「沒起腳」。 */
const CHEER_SPREAD = [12, 24];
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

/* ── 走著走著絆一跤（v1.178）───────────────────────────────
   使用者：「白猴子 黑獼猴 小人走路時有時會跌倒(機率不用太高 不然會影響工作效率)」。
   **整套借既有的倒地**（w.fall／w.tilt，見下面 updWorker 那條分支）：趴一秒多自己爬起來、
   爬起來那一刻生氣——跟被戳倒、被水柱打倒共用同一條路，只差沒有人碰他，
   以及**這一跤是往前趴的**（使用者：「走路絆一跤 應該是往前倒」，見那條分支的註解）。
   猴子那兩隻同理，借的是牠們自己那份 fellBeast（見 game-tools.js 的 stepBeast）。

   兩個限制是使用者那句「不然會影響工作效率」換來的：
   ① **手上有貨的不絆**。倒地那條分支是 return 出去的，carryPose 這一幀不會跑——
      頭上那疊積木會停在半空看著他躺下去。要讓搬運中的人也絆，就得連「把貨撒一地」
      一起做，那是另一件事（而且那才真的會拖慢工期）。空手走路的人才絆。
   ② **機率算「每走一秒」不是「每幀」**（所以要乘 dt），而且只有腿真的在擺才算
      （gait；站著聊天、發呆、等下一塊都不算，同 stuckWatch 的判準）。 */
const TRIP_P = 0.004;               // 每走一秒絆倒的機率
const TRIP_T = [0.7, 1.3];          // 趴幾秒才爬起來
/* 這一幀絆倒了嗎。true＝他已經躺下去了，這一幀底下整段跳過（同被戳倒）。 */
function tripWalk(w, dt) {
  if (w.carry || w.load.length || w.gait < 0.6) return false;
  /* 慶祝進場那一趟不絆（v1.178）：那一段是「全員要在幾秒內到齊」才成立的（見 CHEER_IN，
     遠的人會用跑的趕回來），絆一跤就有人趕不上，圈子缺一角。實測從碎料場外緣趕回來
     那一輪，全員到齊從 2.x 秒被拖到 3.7 秒。 */
  if (idlePhase() && cheerOn(w)) return false;
  if (Math.random() >= TRIP_P * dt) return false;
  w.fall = rr(TRIP_T[0], TRIP_T[1]);
  w.trip = 1;                       // 自己絆的，不是被工具打倒（見 quitLazy 那條）
  w.gait = 0;
  sndFall();
  return true;
}

function updWorker(w, wi, dt) {
  /* 被幽浮吸走了（v1.167）：這個人這一段完全交給 stepUfo 管（在光裡飄、在艙裡等、
     從天上掉回來），這裡整段跳過。擺在最前面：下面每一條分支都會動到位置。 */
  if (w.ufo) return;
  /* 姿勢旗標每幀重算：跌倒、被炸飛、跑去躲的那幾條路徑都是 return 出去的，
     不歸零的話工程師被戳倒了還躺在地上舉著圖。 */
  w.hail = 0; w.plan = 0; w.dig = 0;   // dig：拿著鏟子挖料（v1.129，見 digTrip）
  // 跳舞／翻跟斗／打架的姿勢同理（v1.178）：只有真的在演的那條路徑會把它們撐回去
  w.danc = 0; w.flip = 0; w.guard = 0; w.punch = 0;
  /* v1.206 新的那幾種表演、射箭的弓，還有累了在喘的彎腰同理。
     lean 一定要在這裡歸零：它是站著的身體傾角，留著的話那個人會一路彎著腰去搬料。 */
  w.stre = 0; w.twirl = 0; w.jack = 0; w.clap = 0; w.wave = 0;
  w.bow = 0; w.draw = 0; w.tire = 0; w.lean = 0;
  stuckWatch(w, dt);                 // 卡住了就脫困（v1.108）。擺在最前面：下面每一條分支都會 return
  /* 穿地標的牆只在搬料那兩段（v1.236，見 pick）：其餘的路（閒晃、挖料、逃命…）照地圖走 */
  if (w.st !== 'pick' && w.st !== 'build') w.lmg = 0;
  /* 舉杖同理，只是它是漸進的（瞬間切 0/1 的話杖會用瞬移的抬起放下）：
     這裡每幀往下收，只有真的在施法那條路徑會用兩倍速把它撐回去（castPose）。
     被炸飛、跌倒、換場都是 return 出去的，不預設收的話那個人躺在地上還舉著杖。 */
  if (w.cast > 0) w.cast = Math.max(0, w.cast - dt * CAST_DOWN);
  if (w.chatCd > 0) w.chatCd -= dt;
  stepEmo(w, dt);                    // 表情圖示的鐘（v1.121）。同下面那段慶祝的鐘：擺在所有 return 之前
  /* 表演的鐘（v1.178）。也擺在所有 return 之前，理由跟上面兩個鐘一樣，但這一個更要緊：
     演到一半被抓去上工（或被炸飛）的人，鐘停在那裡的話，他下次站定發呆時會**接著演**
     ——翻跟斗那一段是照剩幾秒算角度的，接下去的第一幀身體會從站直瞬間扭到半空那個角。
     鐘照走就自己過期了，那一段就算了。 */
  if (w.showT > 0) {
    w.showT -= dt;
    /* 收工那一幀要把翻的角度**歸零**，不能留給下面那條 tilt 的漸收：翻完停在
       −2π×圈數，看起來跟站直一模一樣，但漸收會把它慢慢轉回 0——畫面上就是
       落地之後又慢慢倒轉一圈。角度本來就每一圈歸一次零（見 stepShow 的 u % 1），
       這裡收掉的是最後不到一幀的零頭。 */
    if (w.showT <= 0) { w.showT = 0; if (w.show === 'flip') w.tilt = 0; w.show = ''; }
  }
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
      /* 第一個點挑「自己附近」（v1.183 的 near，見 idleSpot）：閒晃範圍放回整片碎料場
         之後，照整片抽等於每個人的第一段路都朝外——那條「整齊往外走」會回來。 */
      idleSpot(w, CHEER_SPREAD);
    }
  }
  /* 被吹飛／點著／推倒／要逃命，或是換場要清工地了——聊天一律中斷。
     蓋完的那一刻也中斷：慶祝要全員到齊，不然聊到一半的那兩個會晚五秒才入圈。 */
  if ((w.chat > 0 || w.fig > 0) && (w.air || w.burn > 0 || w.fall > 0 || w.flee > 0 ||
      (phase !== 'build' && !idlePhase()) || (idlePhase() && cheerOn(w)))) {
    endChat(w); endFight(w);         // 打架（v1.178）用同一個判準：它是那場對話的下半場
  }
  if (w.burn > 0) {
    w.burn -= dt;
    burnFx(w, dt);
    // 燒完就拍拍灰站起來，顏色自己褪回原色
    if (w.burn <= 0) {
      /* 被打滿的那一個在地上滾著燒完（v1.240）：就這樣躺著死（見 stepCorpse），
         不先站直再倒下去——那一下 tilt 歸零是整個人從躺平瞬間立起來。 */
      if (w.roll && slain(w)) { w.burn = 0; w.rph = 0; w.gait = 0; }
      else { w.burn = 0; w.roll = 0; w.tilt = 0; w.rspin = 0; w.rph = 0; w.gait = 0; w.st = 'idle'; }
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
  /* 被工具打倒就收心上工（v1.134，使用者：「被工具攻擊倒地才會進入建築模式」）。
     擺在這裡才每一種都收得到——戳倒、水柱打倒、被掀飛落地、雷劈倒、被燒得在地上打滾，
     全都會經過這一幀（w.fall 是倒地的倒數，w.roll 是燒起來趴在地上滾）。
     站著被點燃、抱頭跑圈圈的那種不算：那個人沒有倒地，他照樣偷懶。
     自己走路絆的那一跤也不算（v1.178，w.trip）：沒有人碰他，他沒有理由因此收心。 */
  if (w.lazy && ((w.fall > 0 && !w.trip) || w.roll)) quitLazy(w);
  if (w.air) { flyWorker(w, dt); return; }            // 被吹飛／炸飛：走彈道
  if (w.burn > 0) { burnMove(w, dt); return; }        // 燒起來：打滾或跑圈圈
  /* 被打死（v1.240）：被打滿 KILL_HITS 次、最後那一下的反應演完了（落地、燒完；被震倒的就是當下）——
     躺著流血、淡掉、換一個新的人從邊上走進來。擺在飛／燒之後、倒地之前：躺著那幾秒直接接過來，
     不讓他爬起來那一刻冒個生氣。擺在上面那幾個鐘**之後**：慶祝的鐘照走，全場散場的判定不會被他卡住。 */
  if (slain(w)) { stepCorpse(w, wi, dt); return; }

  if (w.fall > 0) {                                   // 被震倒／被戳倒／自己絆倒（v1.178）
    /* 躺平就是躺平（v1.60）：以前只倒到 0.44π（79°），停在一個「快躺平又還撐著」的
       角度。現在倒滿 90°。**被工具打倒是往後仰躺**（負角）——仰躺貼地的是背面，
       那是整個模型最平的一面，而且那本來就是被推倒的。
       躺平之後身體會落在草皮那一層，所以 engine 會照傾角把人抬起半個身厚。 */
    w.fall -= dt;
    /* 自己絆的那一跤**往前趴**（v1.178，使用者：「走路絆一跤 應該是往前倒」）：
       絆到的人是往前撲，往後仰躺看起來像被人推的。被工具打倒的照舊往後——那真的是
       被推倒的。往前趴唯一會插進草地的是帽舌（前緣 0.42，抬的是 0.27）：埋進去的
       那 0.15 就是「臉朝下吃土」該有的樣子，臉、眼睛（前緣 0.20／0.215）都還在草皮上面。 */
    w.tilt += ((w.trip ? Math.PI * 0.5 : -Math.PI * 0.5) - w.tilt) * Math.min(1, dt * 9);
    w.gait += (0 - w.gait) * Math.min(1, dt * 6);
    if (w.fall <= 0) {
      w.st = 'idle';
      w.trip = 0;                    // 爬起來了，這一跤是誰害的就不必再分（v1.178）
      /* 爬起來的那一刻生氣（v1.121）：被戳、被掀飛落地、被水柱打倒、自己絆一跤
         （v1.178 的 tripWalk）都走這裡。
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
  if (w.fig > 0) { stepFight(w, wi, dt); return; }   // 談不攏就打起來（v1.178）
  if (tripWalk(w, dt)) return;                       // 走著走著絆一跤（v1.178）

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
    if (d < debrisR * 0.62) {
      const a = d < 0.01 ? Math.random() * Math.PI * 2 : Math.atan2(w.z, w.x);
      w.tx = Math.cos(a) * debrisR * 0.78; w.tz = Math.sin(a) * debrisR * 0.78;
    }
    if (walkTo(w, dt)) {
      /* 下一個閒晃點取在自己附近的角度，不是整圈亂挑。挑到對面去的話
         他會直接穿過工地正中央——拆到一半的建築裡、推土機的車道上都照走。 */
      const a = Math.atan2(w.z, w.x) + rr(-0.8, 0.8), r2 = debrisR * rr(0.6, 0.85);
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
      // 離隊去蓋自己家的人走那條路（v1.97）；其餘的在場上閒晃（見 idleSpot）
      if (w.hm >= 0) updHome(w, wi, dt);
      else wander(w, dt);
    }
    return;
  }
  w.y += (0 - w.y) * Math.min(1, dt * 6);
  w.cheer = 0;
  /* 偷懶的人不上工（v1.134）：走的是閒晃那一套，事件挑中他就去蓋自己的家。
     擺在工程師與魔法師**前面**：這一輪抽中他，他就不看圖也不發料（使用者選「全部人都算」）。
     回自己家那條路他還是用自己的方式蓋（updHome 自己分派：魔法師隔空拋、肌肉小人就地掄）。 */
  if (w.lazy) {
    if (w.hm >= 0) updHome(w, wi, dt);
    else wander(w, dt);
    return;
  }
  if (w.eng) { updEng(w, dt); return; }      // 工程師只看圖、只指揮
  if (w.mage) { updMage(w, wi, dt); return; }   // 魔法師不搬，站在旁邊隔空拋

  /* 連續工作幾秒了（v1.206，見 stepRest）：**只算真的在做事的那幾個狀態**。
     idle 不算（那一幀不是在領下一張工作單，就是根本沒工作可做在閒晃），
     rest 自己更不算。工程師與魔法師走的是上面那兩條 return，本來就數不到這裡。 */
  if (w.st !== 'idle' && w.st !== 'rest') w.toil += dt;
  /* 做滿了就當場停下來喘（v1.237，見 tireOut）：不管這一刻在做什麼——搬著走、空手去撿、
     挖到一半、剛丟完、閒著——手上有積木就先放下。v1.206～v1.236 只在 idle 那一刻判，
     而一般工人進 idle 的那一刻剛丟完最後一塊、站在建築旁邊，所以喘的地方幾乎都貼著牆。
     唯一要等的是**站的地方走不到**（穿地標的牆進去撿料、人還在牆裡，見 lmReach）：
     走出來再停，不然人卡在牆裡彎腰、放下的積木也埋在牆裡。
     轉成 rest 之後下面的 switch 這一幀就跑到 stepRest，姿勢當場擺好，不會先站直一幀。 */
  if (w.toil >= REST_AT && w.st !== 'rest' && lmReach(w.x, w.z)) tireOut(w);
  switch (w.st) {
    case 'idle': {
      // 肌肉小人一趟只領一塊（v1.112，見 MUS_WIND）
      const short = loadUp(w, wi, w.mus ? 1 : 0);
      if (!w.load.length) {
        // 有格子要蓋卻沒料可撿：自己挖（v1.141，見 digSite）。沒格子可蓋才是閒晃
        if (short) { startSiteDig(w); break; }
        wander(w, dt); return;
      }
      w.st = 'pick'; w.li = 0;
      w.leg = 0;                     // 接到工作就把閒晃里程歸零，別把它算進下次的發呆時間
      const p = pickSpot(blocks[w.load[0].b]);
      w.tx = p.x; w.tz = p.z;
      break;
    }
    case 'dig': digSite(w, dt); break;      // 缺料：走幾步挖出來（v1.141）
    case 'rest': stepRest(w, dt); break;    // 做久了當場喘一口氣（v1.206，v1.237 起到點就停）
    case 'pick': {
      // 要撿的那幾塊中途被抽掉，剩下的已經都在手上了：直接回工地
      if (w.li >= w.load.length) { w.li = 0; toSlot(w); break; }
      const j = w.load[w.li];
      const b = j && blocks[j.b];
      if (!b || b.st !== FREE) { dropJob(w, w.li); break; }
      {
        const p = pickSpot(b);                        // 躺在房子占地上的站到框外拿
        w.tx = p.x; w.tz = p.z;
        /* 料在地標裡、從工地外走不到（躺在牆裡、或被蓋好的部分圍住）：**穿地標的牆進去撿**（v1.236，
           使用者：「有時候碎料掉在已經建起來的建築內 這時可以穿牆進去撿」）。人自己在裡面、走不出來
           （上一塊就是這樣撿的、或是站著的時候四周被砌起來）也一樣穿出來。只穿地標：房子照擋（見 navBody）。
           肌肉小人那個「有外面的就先挑外面的」（findBlock 的 outside）照舊。 */
        w.lmg = !lmReach(p.x, p.z) || !lmReach(w.x, w.z) ? 1 : 0;
      }
      // 走不過去就在最近能到的距離伸手拿（v1.108，見 nearGrab）
      if (walkTo(w, dt) || nearGrab(w, j.b, dt)) {
        if (b.cell) gridDel(b);
        douse(b);                                     // 撿起來的碎料還在燒的話，先熄掉
        b.st = CARRY; b.rest = false; w.carry = true; stats.carried++;
        w.li++;
        if (w.li < w.load.length) {                   // 還沒拿滿：直接去下一塊
          /* 下一塊可能已經不在了（v1.146.2）：上面那道 `!b` 只看得到
             「這一幀 w.li 指到的那一筆」，而第二筆是他走去撿第一塊的那段路上
             才被收掉的（`dropBlocks` 把編號換成 −1）。不接住的話這一行會把
             `undefined` 送進 `pickSpot`，整個 `step()` 當場丟例外。
             不見了就什麼都不做：下一幀開頭那道 `!b` 會自己 `dropJob`，
             跟「被搶走」走同一條路（頭上冒問號、其餘照搬）。 */
          const nb = blocks[w.load[w.li].b];
          if (nb) { const p = pickSpot(nb); w.tx = p.x; w.tz = p.z; }
        } else if (w.mus) { w.li = 0; w.st = 'hurl'; w.ct = MUS_WIND; }   // 就地扔（v1.112）
        else { w.li = 0; toSlot(w); }                 // 拿滿了才回工地
      } else if (w.gbt >= PICK_GIVE) {
        // 追太久都沒更近：放掉這一筆，格子讓給別人（v1.225，見 PICK_GIVE）
        w.gvb = j.b;
        dropJob(w, w.li);
      }
      carryPose(w);                                   // 立刻舉起來，不然有一幀還黏在地上
      break;
    }
    case 'build': {
      const j = w.load[0];
      const b = j && blocks[j.b];
      if (!b || b.st !== CARRY) { dropJob(w, 0); if (w.load.length) toSlot(w); break; }
      carryPose(w);
      /* 穿牆進去撿的人，回程一路穿到走得到的地方為止（v1.236，見 pick）。站位本身一定走得到（見 standPos） */
      w.lmg = w.lmg && !lmReach(w.x, w.z) ? 1 : 0;
      if (walkTo(w, dt)) {
        /* 走過來的這幾秒建築一直在長，站位可能已經被別人補起來了。
           重新挑一個再走過去——就這樣從牆裡把積木丟出去的話，出手那一下整塊在牆裡。
           挑回同一個位置（實心造型的正中央就會這樣）就認了，不然會在原地來回。 */
        if (footBlocked(w.x, w.z)) {
          const st2 = standPos(bp.slots[j.s]);
          if (Math.hypot(st2.x - w.x, st2.z - w.z) > 1) {
            w.tx = st2.x; w.tz = st2.z;
            break;
          }
        }
        const s = bp.slots[j.s];
        /* 面向要丟的那一格（v1.236；以前是面向工地中心）：站到外面丟的站位不一定在那一格的半徑上，
           從側面、甚至從建築另一頭丟過去，面向中心就是背對著丟 */
        w.a = Math.atan2(s.x - w.x, s.z - w.z);
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
  /* 回傳「有格子要蓋、但地上一塊料都撿不到」（v1.141）：領不到工作單有兩種原因，
     這一趟該去挖還是去閒晃就看它（見 startSiteDig）。 */
  let short = 0;
  for (let k = 0; k < (cap || w.cap); k++) {
    const s = findSlot(w.x, w.z);    // 派離他現在站的地方最近的那一格
    if (s < 0) break;
    /* 魔法師只搆得到身邊那一圈的料（v1.89，見 MAGE_REACH；工地圈裡的料見 mageReach2）；
       工人是走過去撿，不限距離 */
    const bi = w.mage ? findMageBlock(w) : findBlock(sx, sz, 0, w.mus ? 1 : 0, w.gvb);
    if (bi < 0) { short = 1; break; }
    bp.slots[s].claimed = wi;        // 認領也算「這格有東西了」，會影響上面能不能蓋
    blocks[bi].holder = wi;
    blocks[bi].dug = 0;              // 進了地標的料池就不再是村子的料（v1.134，見 homeMine）
    w.load.push({ b: bi, s: s });
    sx = blocks[bi].x; sz = blocks[bi].z;
  }
  if (w.load.length) markSupportDirty(0.05);
  return short;
}

/* ── 缺料就自己挖（v1.141）─────────────────────────────
   使用者：「改成材料不夠小人自己挖」「也為以後不用考慮積木夠不夠的問題，
   需要積木又沒得撿的時候用挖的就能產生」。
   跟小人蓋自己家那條挖料是**同一套**（digSpot／digBlock／DIG_*，v1.129），差兩件事：
     · 挖的地方取在「他現在站的附近」，不是「自己家旁邊」（他沒有家，見 siteDigSpot）
     · 挖出來的不蓋「村子的料」記號（digBlock 的 own = 0）：那是這一座的建材，
       施工中村子不能收回去蓋房子（見 homeMine）
   挖完**不直接放到手上**：出土之後就是一塊躺在地上的碎料，回 idle 讓 loadUp 照常認領。
   於是「地上有料就撿、撿不到才挖」自然成立，不必另開一條搬運路——而且只要場上還有
   一塊沒人認的料，findBlock 就會挑它，沒有人會白挖。 */
function siteDigSpot(w) {
  /* 每一趟重挑：一直挖同一個坑的話，人會黏在那個點上不動（v1.100 在自己家那邊踩過）。
     三種地方不挖：工地裡（那是要蓋上去的地方，而且他會被 strollTo 推出來）、
     人家屋子裡、場地外面（走出去離工地太遠，搬回來的路比挖的時間還長）。
     v1.211 起外緣是 debrisR（場地本身），跟他閒晃走得到的那一圈同一條線。 */
  for (let t = 0; t < 20; t++) {
    const a = rr(0, Math.PI * 2), d = rr(DIG_NEAR, DIG_FAR);
    const x = w.x + Math.cos(a) * d, z = w.z + Math.sin(a) * d;
    const r = Math.hypot(x, z);
    if (r < siteR + KEEP + SDIG_OUT || r > debrisR) continue;
    if (homeAt(x, z)) continue;
    w.tx = x; w.tz = z; w.hdt = DIG_T; return;
  }
  // 挑不到（站在工地邊上、四周都是屋子）：往外推到工地外圍那一圈
  const d0 = Math.hypot(w.x, w.z) || 1;
  const r = siteR + KEEP + SDIG_OUT;
  w.tx = w.x / d0 * r; w.tz = w.z / d0 * r; w.hdt = DIG_T;
}
/* 挖的地方離工地外圍至少多遠。要大於「鏟尖伸出去多遠」（見 digPoint，約 1.2 格），
   不然人站在環上、鏟子插進工地裡，土痕會留在建材該落的地方。 */
const SDIG_OUT = 1.6;
function startSiteDig(w) {
  siteDigSpot(w);                    // 也順手把這一鏟的倒數設好（w.hdt = DIG_T）
  w.st = 'dig'; w.dug = 0; w.hp = 0;
  w.leg = 0;                         // 挖料也是上工，把閒晃里程歸零（同 idle 領到工作單）
}
/* 走去挖、挖幾塊出來，然後回 idle 去撿。
   一趟挖幾塊＝他一趟搬得動幾塊（w.cap 1～3，肌肉小人 1：他撿起來就地扔）。
   借的欄位跟自己家那條同一組（hdt 這一鏟還有幾秒、dug 這一趟挖出幾塊、hp 下一撮土、
   dig 鏟子舉多高）——施工中的人 hm 一定是 −1（蓋自己家的走 updHome），不會兩邊搶著用。 */
function digSite(w, dt) {
  /* 走去挖的路不算閒晃里程（那是拿來算發呆多久的，見 strollPause）——同 digTrip。
     不扣掉的話，一座地標挖上百趟的里程全算在一起，蓋完站定就發呆好幾分鐘。 */
  const leg = w.leg;
  const walking = !strollTo(w, dt);
  w.leg = leg;
  if (walking) return;
  w.gait += (0 - w.gait) * Math.min(1, dt * 8);
  w.a = Math.atan2(-w.x, -w.z);            // 面向工地挖（挖出來那塊往側面扔，見 digBlock）
  const cap = w.mus ? 1 : w.cap;
  /* 該挖的都挖完了，剩下的時間是在等最後那塊落定（DIG_SET）——那幾秒不是在挖：
     土不噴、鏟子停在撬起來那一格，不然他會對著挖好的洞再揮一鏟（同 digTrip）。 */
  const wait = w.dug >= cap;
  if (!wait) {
    w.hp -= dt;
    if (w.hp <= 0) { w.hp = DIG_PUFF; digPuff(w, digPoint(w)); }
  }
  w.hdt -= dt;
  w.dig = wait ? 0.001 : Math.min(1, Math.max(0.001, 1 - Math.max(0, w.hdt) / DIG_T));
  if (w.hdt > 0) return;                   // 還在挖這一鏟／還在等土落定
  /* 還缺格子才繼續挖：挖到一半剩下的格子被別人補完了就別再挖（同 digTrip 的 digNeed）。
     池子滿了 digBlock 會回 false，那就當這一趟挖完了（回 idle，領不到就去閒晃）。 */
  if (w.dug < cap && findSlot(w.x, w.z) >= 0 && digBlock(w, 0)) {
    w.dug++;
    w.hdt = w.dug < cap ? DIG_T : DIG_SET;
    return;
  }
  w.dug = 0; w.hdt = 0; w.st = 'idle';     // 回去領工作單：挖出來那幾塊就躺在腳邊
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
  w.tx = st.x; w.tz = st.z;
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
   沒事做的時候走的路。v1.99～v1.235 跟施工中的走法分開：pick／build 得走進工地擺積木，
   這裡則把建築當成以工地中心為圓心、半徑 siteR 的一根柱子繞過去。v1.236 起兩邊是同一張地圖
   （見 navBody）：蓋好的部分擋、沒蓋的與底下空的走得過，閒晃的人也會從建築腳下穿過去。 */
/* 工地外圈：建築外圍再往外這麼多。v1.236 起走路不再繞這一圈（地標在地圖上了），
   剩下的都是「去哪」：閒晃挑點的內緣、天災與吉祥物進場走到哪算到（come）、巨人（牠不規劃，見 strollTo）、
   站位沿半徑往外掃到哪裡為止（standPos）、挖料與蓋家挑的位置不落在工地上。 */
const KEEP = 1.5;
/* 閒晃目標點的內緣：離建築外圍幾格起跳（見 idleSpot）。外緣是 debrisR（場地外緣，
   v1.183 使用者：「小人跟動物 能走的範圍都是碎料範圍 但是不穿地標跟小房子」）——
   v1.210 把場地拆成兩圈時這裡跟著生活圈留在 arenaR，等於那句話被縮水了；
   v1.211 使用者重新定調「生物能走動的範圍也調整到比較大的新碎料範圍」，
   所以外緣搬回真正的碎料圈（吉薩 3000 建材：63.7 → 82.8）。 */
const IDLE_NEAR = 2;

/* 走到定點就站一會兒。站的時間跟**剛走完**那段路成比例——
   寫死秒數的話，換一座大的（工地大、走得久）站著的人就變少，比例會跟著建築跑掉；
   算成「接下來要走的那段」則更糟：剛擺完積木的人會先在工地正中央發呆快十秒才動身。
   2.4 倍是量出來的：任一瞬間大約七成的人站著不動。 */
function strollPause(w) { w.pause = w.leg / WALK * rr(1.7, 3.1); w.leg = 0; }

/* spd 給了就照它走，不給就是小人的走路速度（WALK）。
   天災那幾隻走得比人慢得多，但「怎麼繞開建築與房子」要跟小人一模一樣，
   所以是借這一支、只換速度，不是另外刻一份（見 game-tools.js 的 DOOM_WALK）。
   step 是腿擺多快的倍率（v1.154）：走得慢的還照原速擺腿的話，腳在原地空踩——
   牛羊只有猴子的三分之二速度，那四條腿看起來就是滑步（見 HERD_STEP）。 */
/* 照巡路規則走（v1.235 房子與城牆、v1.236 起連地標，見 navAim 與 navBody）：目標壓在障礙裡先挪到
   最近的可走點（規則 2）、直線不通就規劃（規則 3、4）、每一步不准踩進或切過障礙（規則 5）。
   v1.99～v1.234 是 dodgeHome 每幀掰切線 ＋ pushOutHome 推出來，那一套只看眼前一步，
   外框貼在一起、U 形口袋、目標壓在框裡都解不開（見 開發筆記〈巡路規則〉）；
   v1.99～v1.235 地標是「目標推到工地圈上、快貼圈時把方向掰到切線上」的一個圓，
   建築腳下空的、還沒蓋的也一律繞圈（見 開發筆記〈巡路規則：地標那一層〉）。
   **巨人例外**（使用者 v1.207：「行走有障礙物就發動攻擊踢掉」）：牠不規劃，走 strollGiant。 */
/* keepMore 只剩巨人在給（見 strollGiant）。v1.182～v1.235 飛龍也給（DRA_KEEP 8.5：身長 10 格上下，
   站在 siteR+1.5 上頭跟尾巴會插進地標裡），v1.236 起那件事是身位（身長一半往外擴，見 navBody）。 */
function strollTo(w, dt, spd, step, keepMore) {
  if (w.kind === 'giant') return strollGiant(w, dt, spd, step, keepMore);
  const bd = navBody(w);
  const g = navGoal(w, w.tx, w.tz, bd);
  if (g) { w.tx = g.x; w.tz = g.z; }
  const d = Math.hypot(w.tx - w.x, w.tz - w.z);
  if (d < REACH) { pushOutHome(w); w.gait += (0 - w.gait) * Math.min(1, dt * 8); return true; }
  w.spd = spd || WALK;
  const aim = navAim(w, w.tx, w.tz, bd, dt);
  const ax = aim ? aim.x : w.tx, az = aim ? aim.z : w.tz;
  const da = Math.hypot(ax - w.x, az - w.z) || 1;
  const ux = (ax - w.x) / da, uz = (az - w.z) / da;
  const sp = Math.min((spd || WALK) * dt, aim ? da : d);
  navMove(w, ux * sp, uz * sp, bd);
  w.leg += Math.hypot(_nm.x, _nm.z);   // 這趟閒晃走了多遠，抵達後拿來算站多久
  navFace(w, ux, uz);
  w.ph += dt * 11 * (step || 1);
  w.gait += (0.85 - w.gait) * Math.min(1, dt * 8);
  return false;
}
/* 巨人的走法（v1.207，使用者：「巨人太高不能走城門 行走有障礙物就發動攻擊踢掉」）：不規劃、直直走，
   擋路的由 giantBust 踹掉；踹滿放過的那一間靠 dodgeHome 繞開。地標照舊是工地圈那個圓：
   目標推到圈上、快貼圈時掰到切線（keepMore 是牠要再離遠幾格，GIA_KEEP）。
   這一支就是 v1.235 strollTo 裡巨人走的那一條，v1.236 拆出來時一個位元都沒改。 */
function strollGiant(w, dt, spd, step, keepMore) {
  const keep = siteR + KEEP + (keepMore || 0);
  /* 目標點落在建築裡就先推到外圈。不推的話牠會繞著建築打轉永遠抵達不了，
     也就永遠不換下一個目標，等於卡死在那一圈上。 */
  {
    const k = keepOut(w, w.tx, w.tz, keep);
    w.tx = k.x; w.tz = k.z;
  }
  const d = Math.hypot(w.tx - w.x, w.tz - w.z);
  if (d < REACH) { pushOutHome(w); w.gait += (0 - w.gait) * Math.min(1, dt * 8); return true; }
  w.spd = spd || WALK;
  const da = d || 1;
  let ux = (w.tx - w.x) / da, uz = (w.tz - w.z) / da;
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

  const sp = Math.min((spd || WALK) * dt, d);
  w.x += ux * sp; w.z += uz * sp;
  pushOutHome(w);
  w.leg += sp;                       // 這趟閒晃走了多遠，抵達後拿來算站多久
  w.a = Math.atan2(ux, uz);          // 面向真正在走的方向，不是目標方向
  w.ph += dt * 11 * (step || 1);
  w.gait += (0.85 - w.gait) * Math.min(1, dt * 8);
  return false;
}

/* 下一個閒晃點：**整片碎料場裡按面積平均挑**（v1.183；慶祝散場後也用這個）。
   小人與動物共用這一支，所以兩邊的活動範圍是同一件事。

   這個範圍改過兩次，兩次都是使用者定的，理由不一樣：
     v1.60～v1.95  整片草地亂挑（arenaR + 20 的方形）
     v1.96～v1.182 收成「工地外圈 IDLE_NEAR～9 那一環」——使用者：「盡量不要讓建築
                   一圈都沒人，看起來會有點明顯」
     v1.183        放回整片碎料場，但改成**按面積平均**
   為什麼放得回去：v1.183 使用者把當年那句話的意思講清楚了——「當初會說建築一圈沒人，
   是因為小人們行動範圍不會到建築邊，導致明顯空著一圈」。**問題在內緣不在外緣**：
   當年那版是方形亂數，貼著建築那一圈反而抽不太到，於是建築腳邊空出一圈。
   按面積平均抽就沒有這件事——每單位面積的機會一樣，內緣照樣貼著建築
   （下限 IDLE_NEAR，再由 strollTo 的 KEEP 擋住不穿進去），外面也不會稀掉。

   **半徑要用 sqrt 抽**：直接 rr(lo, hi) 是「按半徑平均」，外圈那一大片面積大、
   抽到的機會卻一樣，散出去會變成內密外疏。

   **near 給了就改成「沿著自己現在那一圈走一段」**（v1.183，散場那一刻在用）：
   人剛好站在慶祝圈上，而那個圈的半徑幾乎就貼著閒晃範圍的內緣——照整片抽的話，
   每個人抽到的點幾乎都在自己外面，於是**一圈人又整齊往外走**（那正是 v1.96 修掉的
   三件事之一，實測平均徑向分量回到 +0.27～+0.34，跟當年的壞值 +0.25～+0.42 同一區間）。

   為什麼不是「在自己身邊的圓裡抽」（第一版試過）：人站在內緣上，那個圓的內半邊會被
   推回內緣（徑向 0）、外半邊是正的，平均還是 +0.25 上下（實測換一顆種子量到 0.39）。
   **保持半徑、只轉角度**才是真的 0：往哪一邊轉隨機，第一段路就是繞著建築走一小段，
   之後的目標點照舊整片按面積抽。near 是這一段的弧長上限。 */
function idleSpot(w, near) {
  const lo = siteR + IDLE_NEAR, hi = Math.max(lo + 1, debrisR);
  for (let t = 0; t < 8; t++) {
    let x, z;
    if (near) {
      const r = Math.min(hi, Math.max(lo, Math.hypot(w.x, w.z) || lo));
      const arc = rr(near[0], near[1]) * (Math.random() < 0.5 ? -1 : 1);
      const a = Math.atan2(w.z, w.x) + arc / r;               // 沿著圈走 arc 格
      x = Math.cos(a) * r; z = Math.sin(a) * r;
    } else {
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(lo * lo + Math.random() * (hi * hi - lo * lo));
      x = Math.cos(a) * d; z = Math.sin(a) * d;
    }
    if (homeAt(x, z)) continue;               // 別挑在人家屋子裡（v1.97）
    /* 城牆的另一邊**照挑**（v1.235，使用者：閒晃的目標被牆隔開就「照規則規劃過去」）。
       v1.186～v1.234 會濾掉，理由是「那個點走不到、strollTo 要走到了才換下一個目標」——
       strollTo 現在會規劃路線從門洞走過去（見 navAim），那個理由沒了。 */
    w.tx = x; w.tz = z; return;
  }
  /* 8 次都挑在人家屋子裡（村子很擠的時候）：**沿著自己現在那一圈走一小段**。
     near 給了就不再往下遞迴（那一支挑的就是同一圈上的點）。 */
  if (!near) idleSpot(w, [3, 8]);
}
function wander(w, dt) {
  if (w.show || w.pause > 0) { idleWait(w, dt); return; }
  if (strollTo(w, dt)) { strollPause(w); rollShow(w); idleSpot(w); }
}

/* ── 閒著沒事來一段（v1.178，v1.206 從兩種變八種）─────────────
   使用者：「小人閒置時有時會跳舞 翻跟斗等動作」。演的時機借**現成的發呆**
   （strollPause：走到定點就站一會兒，站多久跟剛走完那段路成比例）——閒晃的人本來
   就有大把時間杵在那裡不動，把其中一部分換成表演就好，不必另外插一個狀態進狀態機。
   所以「閒置」的範圍也跟著現成的走：閒晃（wander）跟蓋完房子在自家附近走走
   （liveHome）這兩條路上的發呆都算，正在搬料、看圖、施法的人一概沒有。

   v1.206 使用者：「增加小人行為(像是原本的跳舞 翻跟斗等行為)」、「閒置小人有時會
   對牛羊射箭(中箭後牛羊倒地5秒後站起)」。時機一個字都沒改，改的只有「演什麼」——
   兩個寫死的 if 換成**一張表**（同 IDLE_EVENTS／TOOLS 的做法），加一種就多一列。
   五種新的造型（伸懶腰、原地轉圈、開合跳、拍手、揮手）先產一頁預覽請使用者挑過
   才落地，姿勢本體在 engine.js 的 putWorker（w.stre／twirl／jack／clap／wave）。

   翻跟斗的**旋轉中心在身體中段**、不在腳底（引擎那邊看 w.flip，跟被吹飛在半空翻
   同一套）：繞腳底轉的話那是「以腳為軸倒下去」，而且轉過水平時整個人會插進草皮裡
   （見 engine.js 的 ROLL_PIVOT 那段）。
   演到一半被抓去上工／被炸飛怎麼收：見 updWorker 開頭那個 showT 的鐘。 */
const SHOW_P = 0.3;                 // 每次站定發呆，有多少機率不是純發呆而是來一段
const SHOW_DANCE = [3.2, 5.5];      // 跳舞跳幾秒
const SHOW_HZ = 7.5;                // 跳舞的節拍（手、腳、彈跳共用這個相位）
const SHOW_SWAY = 0.55;             // 跳舞時左右轉幾弧度（繞著開演時的朝向）
const SHOW_HOP = 0.11;              // 跳舞時腳下彈多高（格）
const SHOW_FLIP_N = [1, 2];         // 翻跟斗翻幾圈
const SHOW_FLIP_T = 0.85;           // 一圈幾秒
const SHOW_FLIP_H = 1.25;           // 翻到最高離地幾格
/* 伸懶腰（v1.206）：撐開 → 停住 → 收回，收尾走平滑曲線（硬切的話手會「啪」一下放下）。 */
const SHOW_STRE_T = 3.2, SHOW_STRE_UP = 0.8, SHOW_STRE_DN = 1.0;
const SHOW_STRE_LEAN = 0.30;        // 撐到底時身體後仰幾弧度
const SHOW_STRE_H = 0.055;          // 腳跟踮多高
/* 原地轉圈（v1.206）：轉幾圈、幾秒轉完，起步與收尾都放慢（等速的話頭尾那一幀朝向是跳的）。 */
const SHOW_TWIRL_T = 2.6, SHOW_TWIRL_N = 2.5;
const SHOW_TWIRL_HZ = 13;           // 腳下小碎步的節拍
const SHOW_JACK_N = [5, 8];         // 開合跳幾下
const SHOW_JACK_T = 0.55;           // 一下幾秒（手腳開合與彈跳共用這個相位）
const SHOW_JACK_H = 0.20;           // 跳多高
const SHOW_CLAP_N = [6, 10];        // 拍幾下
const SHOW_CLAP_T = 0.33;           // 一下幾秒
const SHOW_CLAP_LEAN = 0.09;        // 拍手時身體前傾幾弧度
const SHOW_WAVE_T = [2.4, 3.6];     // 揮手幾秒
const SHOW_WAVE_HZ = 7;             // 揮的節拍
const SHOW_WAVE_TURN = 0.6;         // 一邊揮一邊左右轉幾弧度
/* 對牛羊射箭（v1.206）。箭、弓、45 度彈道、牛羊倒地**全是現成的**
   （箭雨 v1.171 的 shootArrow／fellBeast，見 game-tools.js 的 playShot）。 */
const SHOW_BOW_NEAR = [5, 20];      // 幾格內的牛羊才射（太近沒有拋物線、太遠純浪費）
const SHOW_BOW_DRAW = 0.75;         // 拉弓幾秒（同箭雨的 AR_DRAW 0.7）
const SHOW_BOW_T = 1.6;             // 一段幾秒：拉弓 → 放箭 → 目送一下
/* 八種演什麼。wt 是相對權重；長度兩種寫法擇一——
     t    [最短, 最長] 秒，直接抽一個
     n／beat  抽「幾拍」（記在 w.showN，姿勢那邊照它算相位）× 一拍幾秒
   need 是「這一刻抽不抽得到」（只有射箭有：附近要真的有牛羊），回傳值會存進 w.showM。 */
const SHOWS = [
  { id: 'dance', wt: 3, t: SHOW_DANCE },
  { id: 'flip',  wt: 3, n: SHOW_FLIP_N, beat: SHOW_FLIP_T },
  { id: 'stre',  wt: 3, t: [SHOW_STRE_T, SHOW_STRE_T] },
  { id: 'twirl', wt: 3, t: [SHOW_TWIRL_T, SHOW_TWIRL_T] },
  { id: 'jack',  wt: 3, n: SHOW_JACK_N, beat: SHOW_JACK_T },
  { id: 'clap',  wt: 3, n: SHOW_CLAP_N, beat: SHOW_CLAP_T },
  { id: 'wave',  wt: 3, t: SHOW_WAVE_T },
  { id: 'bow',   wt: 3, t: [SHOW_BOW_T, SHOW_BOW_T], need: w => herdNear(w, SHOW_BOW_NEAR) }
];
/* 站定的那一刻抽一次。抽中就把發呆時間**拉長到夠演完**——照原本那個時間演的話，
   剛走一小段就站定的人（pause 不到一秒）會演到一半就走人。
   **條件不成立的先濾掉再抽**（v1.206）：連在表上一起抽的話，附近沒牛羊時
   那一份權重會變成「抽中了卻什麼都不演」，等於把三成的表演吃掉八分之一。 */
function rollShow(w) {
  w.show = ''; w.showT = 0; w.showM = null; w.shot = 0;
  if (Math.random() >= SHOW_P) return;
  const ok = [];
  let tot = 0;
  for (const s of SHOWS) {
    const need = s.need ? s.need(w) : true;
    if (!need) continue;
    ok.push({ s, need }); tot += s.wt;
  }
  if (!ok.length) return;
  let r = Math.random() * tot, hit = ok[ok.length - 1];     // 浮點誤差的保險（同 pickIdleEvent）
  for (const o of ok) { r -= o.s.wt; if (r < 0) { hit = o; break; } }
  const s = hit.s;
  w.show = s.id;
  if (s.need) w.showM = hit.need;                           // 射箭瞄上的那一隻
  if (s.n) { w.showN = Math.round(rr(s.n[0], s.n[1])); w.showT = w.showN * s.beat; }
  else w.showT = rr(s.t[0], s.t[1]);
  w.showA = w.a;                    // 繞著現在的朝向演，演完還是朝這邊
  w.pause = Math.max(w.pause, w.showT);
}
/* 站定不動的那一段：抽中的話這幾秒在表演，沒抽中就純站著（原本的行為）。
   **演完之前不算站完**（w.show 那個條件，見 wander／liveHome）：pause 有可能一開始
   就是 0——strollPause 是照剛走完那段路算的，而「挑到的下一個點剛好就在腳邊」
   那一次走的距離是 0。那樣的話這一段演到一半就會被下一次 rollShow 洗掉，
   洗在翻跟斗中間的話身體會停在半空那個角度再慢慢轉回來（實測 450 秒裡出現 2 次）。 */
function idleWait(w, dt) {
  if (w.pause > 0) w.pause -= dt;
  if (w.show) stepShow(w, dt);
  else w.gait += (0 - w.gait) * Math.min(1, dt * 8);
}
/* 這一幀的表演。人**不移動**（表演是站定之後的事），動的是朝向、離地高度與姿勢旗標。
   每一種都只讀 w.showT（還剩幾秒）與自己那組常數算相位，所以被 updWorker 的鐘
   截斷時不會留下半截狀態。 */
function stepShow(w, dt) {
  w.gait += (0 - w.gait) * Math.min(1, dt * 8);
  switch (w.show) {
    case 'dance':
      w.danc = 1;
      w.ph += dt * SHOW_HZ;
      w.a = w.showA + Math.sin(w.ph * 0.5) * SHOW_SWAY;
      w.y = Math.abs(Math.sin(w.ph)) * SHOW_HOP;
      return;
    case 'flip': {
      /* 翻跟斗：u 是這一段翻到第幾圈（0 ～ showN）。角度乘 −2π（負的是往後翻，
         跟仰躺同一個方向），高度取**每一圈自己**的半個正弦，落地那一刻剛好回到 0。 */
      const u = (1 - w.showT / (w.showN * SHOW_FLIP_T)) * w.showN;
      w.flip = 1;
      w.tilt = -Math.PI * 2 * (u % 1);        // 每一圈歸一次零（−2π 跟 0 是同一個姿勢）
      w.y = Math.sin((u % 1) * Math.PI) * SHOW_FLIP_H;
      return;
    }
    case 'stre': {
      /* 伸懶腰：撐開 → 停住 → 收回。k 是「撐到幾分滿」，再過一次平滑曲線
         （k²(3−2k)）——線性的話放下來那一下是硬切的。 */
      const done = SHOW_STRE_T - w.showT;
      const k = clamp(done < SHOW_STRE_UP ? done / SHOW_STRE_UP : w.showT / SHOW_STRE_DN, 0, 1);
      const e = k * k * (3 - 2 * k);
      w.stre = e;
      w.lean = -SHOW_STRE_LEAN * e;           // 負的＝往後仰
      w.y = SHOW_STRE_H * e;                  // 腳跟踮起來
      return;
    }
    case 'twirl': {
      /* 原地轉圈：轉的角度走同一條平滑曲線，所以起步與收尾都是慢慢的。
         腳下踩的是小碎步（gait 給一半，腿才會擺但擺不大）。 */
      const u = clamp(1 - w.showT / SHOW_TWIRL_T, 0, 1);
      const e = u * u * (3 - 2 * u);
      w.twirl = 1;
      w.a = w.showA + Math.PI * 2 * SHOW_TWIRL_N * e;
      w.ph += dt * SHOW_TWIRL_HZ;
      w.gait = 0.55;
      w.y = Math.abs(Math.sin(w.ph)) * 0.035;
      return;
    }
    case 'jack':
      /* 開合跳：手、腳、彈跳共用 w.ph，所以張到最開的那一刻人剛好在半空
         （姿勢那邊也是讀 w.ph 算的，見 engine 的 w.jack）。 */
      w.jack = 1;
      w.ph += dt * (Math.PI * 2 / SHOW_JACK_T);
      w.y = Math.max(0, Math.sin(w.ph)) * SHOW_JACK_H;
      return;
    case 'clap':
      /* 拍手：一拍是半個正弦（姿勢那邊取 |sin|），所以相位一拍走 π 不是 2π。 */
      w.clap = 1;
      w.ph += dt * (Math.PI / SHOW_CLAP_T);
      w.lean = SHOW_CLAP_LEAN;
      w.y = Math.abs(Math.sin(w.ph)) * 0.035;
      return;
    case 'wave':
      // 揮手：右手高舉左右揮，人也跟著慢慢左右轉（朝不同方向各揮一下）
      w.wave = 1;
      w.ph += dt * SHOW_WAVE_HZ;
      w.a = w.showA + Math.sin(w.ph * 0.11) * SHOW_WAVE_TURN;
      return;
    case 'bow': {
      /* 對牛羊射一箭。瞄上的那一隻中途可能不在了（被工具打飛、換場清掉）——
         beasts 那份清單會被 splice，所以認的是「還在不在清單上」，不是旗標。 */
      const m = w.showM;
      if (!m || !beasts || beasts.indexOf(m) < 0) { w.show = ''; w.showT = 0; return; }
      w.bow = 1;
      w.a = Math.atan2(m.x - w.x, m.z - w.z);      // 一直對著牠（牠還在走）
      /* 弦拉了多滿。放箭那一幀明寫 1（照 done 算的話那一幀是 0.93——一幀 0.05 秒，
         拉弓 0.75 秒剛好差最後一格，畫面上就是「還沒拉滿箭就飛出去了」）。 */
      const done = SHOW_BOW_T - w.showT;
      w.draw = done < SHOW_BOW_DRAW ? done / SHOW_BOW_DRAW : (w.shot ? 0 : 1);
      if (done >= SHOW_BOW_DRAW && !w.shot) { w.shot = 1; playShot(w, m); }
      return;
    }
  }
}

/* ── 做久了停下來喘一口氣（v1.206）───────────────────────────
   使用者：「持續工作一陣子後會休息(要有勞累動作 可以先給我看過)」，
   門檻與地點都是他挑的：**連續工作 60 秒 → 就地站著喘 4~6 秒**，不走開、不坐下。
   姿勢是彎腰撐膝（engine.js 的 w.tire ＋ w.lean），三版預覽給使用者挑過
   （見 開發筆記〈「累了在喘」三版挑一版〉）。

   v1.237 改成**到點就當場停**（見 tireOut 與 updWorker 那一行），頭上冒汗。
   v1.206～v1.236 是等「一趟做完回來領下一張工作單」那一刻（case 'idle'）才看——
   使用者：「為什麼小人累了 都在建築旁邊休息」，量下來剛丟完積木就喘的 30 次全在
   最近一塊已砌積木 2.5 格內（見 開發筆記〈累了當場停、手上的先放下、頭上冒汗〉）。

   **會拖慢工期，那是這件事的定義**：一輪 60 ＋ 5 秒裡有 5 秒沒在搬，約 8%。 */
const REST_AT = 60;                 // 連續工作幾秒就該喘一下
const REST_T = [4, 6];              // 喘幾秒
const REST_LEAN = 0.50;             // 彎腰幾弧度（正的＝前傾）
const REST_BREATH = 0.045;          // 呼吸時腰再上下起伏幾弧度
const REST_HZ = 5;                  // 呼吸的節拍
const REST_FLOOR = 0.08;            // 呼吸的下限（理由見 stepRest：0 那一幀姿勢會閃掉）
/* 放下手上的積木：往他面向的方向送出去，落在腳前（v1.237，使用者挑「往前放在腳前」）。
   鬆手直直掉（逃命那一套）會落在自己腳底 0.05 格，積木跟人疊在一起；
   送 2.5 格/秒實測落在腳前 0.9～2.4 格（遠的那個是一疊裡上面那塊），他彎腰撐膝正好對著那幾塊。
   一疊裡上面那幾塊再多送一點，不然三塊會落回同一點疊成一柱。 */
const REST_PUT = 2.5;               // 往前送的速度（格/秒）
const REST_PUT_STEP = 0.6;          // 一疊裡每往上一塊再多送多少
const REST_DROP_T = 1.5;            // 太陽穴那一滴汗：冒出來、滑下去、淡掉，一輪幾秒（畫法見 engine.js 的 putEmotes）
/* 累了就停（v1.237）。這一趟作廢：認領放掉、規劃好的路線收掉——走的是 releaseWorker，
   跟逃命丟下手上東西、換一座收工同一支，所以放下的積木就是一般碎料，**誰近誰撿**
   （使用者選的；多半是他喘完自己撿回面前這幾塊）。挖到一半那一鏟也作廢，
   已經挖出來的就躺在那裡，跟 digSite 挖完回 idle 一樣讓 loadUp 照常認領。 */
function tireOut(w) {
  const held = [];
  for (const j of w.load) {
    const b = blocks[j.b];
    if (b && b.st === CARRY) held.push(b);
  }
  if (w.st === 'dig') { w.dug = 0; w.hdt = 0; }
  releaseWorker(w);
  const fx = Math.sin(w.a), fz = Math.cos(w.a);
  for (let k = 0; k < held.length; k++) {
    const sp = REST_PUT + REST_PUT_STEP * k;
    held[k].vx = fx * sp + rr(-0.25, 0.25);
    held[k].vz = fz * sp + rr(-0.25, 0.25);
    held[k].vy = 0.6;                         // releaseWorker 給的是 2（往上彈），放下用不著
  }
  /* 腳當場站定：v1.206 是從 idle 進來的（人本來就站著），現在可能是走到一半停下來。
     stepRest 那條每幀收掉 gait 的話，頭幾幀上半身已經彎下去、腳還在擺（e2e 量到 0.49）——
     跟「進休息那一幀姿勢就擺好」同一個理由（見 開發筆記〈「累了在喘」三版挑一版〉）。 */
  w.gait = 0;
  w.st = 'rest'; w.rst = rr(REST_T[0], REST_T[1]); w.swt = 0;
}
function stepRest(w, dt) {
  w.rst -= dt;
  w.gait += (0 - w.gait) * Math.min(1, dt * 8);
  w.ph += dt * REST_HZ;
  /* 呼吸 0～1。**不給到 0**：引擎那邊認的是 `w.tire > 0`，剛好踩在谷底那一幀
     會掉回「走路擺手」的姿勢，手臂閃一下。 */
  const b = REST_FLOOR + (1 - REST_FLOOR) * (Math.sin(w.ph) + 1) / 2;
  w.tire = b;                                 // 手撐在膝上、肩膀跟著起伏（engine）
  w.lean = REST_LEAN + REST_BREATH * b;
  /* 頭上冒汗（v1.237，使用者挑「頭頂 💦 ＋ 太陽穴一大滴」）：喘多久冒多久。每幀推回
     倒數（同一種連著觸發不會重彈，見 showEmo），喘完那一刻起 EMO_T.sweat 秒內收掉。 */
  showEmo(w, 'sweat');
  w.swt = (w.swt + dt / REST_DROP_T) % 1;
  // 喘完了：連續工作的鐘重新算，回去領下一張工作單
  if (w.rst <= 0) { w.rst = 0; w.toil = 0; w.st = 'idle'; }
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
   站過去：塊數多的優先、路程遠的折價（推土機 v1.61～v1.141 挑碎料堆用的是同一套算法，
   v1.142 起它改成照寬度並排掃一趟，不再挑堆，所以這套現在只剩他在用）。 */
const MAGE_REACH = 11;              // 搆得到多遠的建材
/* 走多遠不設上限（v1.95）。v1.89～v1.94 綁在工地外圍 16 格內（MAGE_ROAM），
   理由是「不設的話他會一路追著料往外走，跑出鏡頭、蓋完還得從場外走回來慶祝」。
   但 v1.89 同時把他改成「走到料旁邊才搬得動」——兩條加起來就變成：料一旦被轟到
   16 格外，他整座建築都站著不動。實測玩家丟一發核彈把碎料炸到半徑 30～60 之後，
   接下來那一座他 300 秒發 0 塊（工人不受影響，他們本來就走到哪撿到哪）。
   既然要他走到料旁邊，那就跟一般工人一樣：料在哪就走到哪，不再有上限。
   下限（MAGE_KEEP）保留——那不是行動範圍，是「不能站進建築裡伸手」。 */
/* 工地圈裡的料怎麼量（v1.225，使用者：「放寬魔法師，讓他能伸手拿工地圈裡的料」，
   範圍選「整個工地圈」）。他還是站在外圈（siteR + MAGE_KEEP）不走進建築，
   所以圈裡的料**往外投影到那一圈上**再量：投影點在他 MAGE_REACH 格內就拉得動。
   也就是「隔著建築往裡伸手那一段不算距離，只算沿著外圈的那 11 格」——
   走到離那坨料最近的外圈站好，再深都拉得到。圈外的料照舊量真實距離。
   v1.89～v1.224 圈裡的一律量真實距離，而他站不進去：實測按「換一座來蓋」之後
   （整棟打散成碎料落在新工地裡、推土機沒開），場上 678 塊料 678 塊都在圈裡，
   40 人那一座魔法師只有 15% 的時間在施法、21% 站著搆不到料。
   正中央（半徑 0）那一塊沒有方向可以投影，拿他自己的角度——從哪一邊伸手都一樣近。 */
function mageReach2(w, b) {
  const R = siteR + MAGE_KEEP, r = Math.hypot(b.x, b.z);
  if (r >= R) return (b.x - w.x) ** 2 + (b.z - w.z) ** 2;
  const a = r < 0.001 ? Math.atan2(w.z, w.x) : Math.atan2(b.z, b.x);
  return (Math.cos(a) * R - w.x) ** 2 + (Math.sin(a) * R - w.z) ** 2;
}
/* 他搆得到的料裡挑最近的那一塊（量法見 mageReach2），同 findBlock 的條件。 */
function findMageBlock(w) {
  let best = -1, bd = MAGE_REACH * MAGE_REACH;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.st !== FREE || !b.rest || b.holder >= 0) continue;
    const d = mageReach2(w, b);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
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
/* 挑一坨料站過去：塊數多的優先，路程遠的折價（判準見上面 MAGE_REACH 那段）。
   兩個條件會刷掉候選：別的魔法師已經在那一帶的、站的點壓在人家屋子裡的。
   v1.89～v1.224 還有第三個：「站定之後整坨搆不到的（在建築裡的那種）」——圈裡那一坨的
   中心離他站的點超過 MAGE_REACH × 0.6 就跳過。v1.225 起圈裡的料往外投影到他站的那一圈
   量（見 mageReach2），站的點就是那一坨中心的投影，那一刀永遠不會成立，拿掉了。
   路程量的是**走到站的點**多遠（v1.225）：圈外那一坨站的點就是它的中心，跟以前一樣；
   圈裡那一坨他只走到外圈，量到中心的話會把「伸手進去那一段」也算成路程。
   回傳 false = 沒有值得走過去的，站在原地等就好。 */
function pickMageSpot(w) {
  const heaps = listMageHeaps();
  let bx = 0, bz = 0, bn = 0, best = -1;
  for (const h of heaps) {
    const hr = Math.hypot(h.x, h.z);
    const r = Math.max(siteR + MAGE_KEEP, hr);        // 多遠都去，只是不站進工地裡（v1.95）
    const a = hr < 0.001 ? w.mang : Math.atan2(h.z, h.x);
    const sx = Math.cos(a) * r, sz = Math.sin(a) * r;
    if (mageTaken(w, sx, sz)) continue;
    if (homeAt(sx, sz)) continue;                     // 別站到人家屋子裡（v1.97）
    const s = h.n / (1 + Math.hypot(sx - w.x, sz - w.z) * MAGE_TRIP);
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
  /* 沒格子可蓋就跟大家一樣去閒晃（v1.225，使用者：「是原本魔法師缺了嗎 照理說小人們都一樣?
     是的話就補」）：站定發呆、三成機率來一段表演、走近了跟人聊天，全是 wander 那一套。
     v1.89～v1.224 他是原地面向建築站著等，理由是閒晃那條路會沿用上一輪留下的目標點
     （慶祝散場取的是整片草地），他一沒工作就往四十幾格外走。所以**接上閒晃的那一幀
     把目標設在腳下**：跟一般工人剛丟完料、在原地接上 wander 是同一個起點
     （到了 → 發呆＋抽表演 → 照 idleSpot 挑下一個點）。
     還有在飛的就先別走，舉著杖送它們到定位（下面那條路本來就這樣）。 */
  if (!w.load.length && !w.fly.length && findSlot(w.x, w.z) < 0) {
    if (!w.mw) { w.mw = 1; w.tx = w.x; w.tz = w.z; w.leg = 0; }
    w.st = 'idle';
    wander(w, dt);
    return;
  }
  w.mw = 0;
  // 一幀只能走這一次（ringWalk 會真的移動人）；下面「站定了嗎」全部看這一個值
  const stand = ringWalk(w, w.mang, w.mrad, dt);
  if (!w.load.length) {
    // 站定了才認料：搆得到的範圍是以「他站的地方」算的，走位途中認的那塊會被拖著走
    const short = stand ? loadUp(w, wi, 1) : 0;      // 一次只領一格一塊
    /* 身邊搆不到料：去找一坨料站過去（v1.89，見 pickMageSpot）。還在飛的那幾塊送到之前、
       或走位途中也會進到這裡（沒格子可蓋、手上也沒在飛的，上面那段已經接去閒晃了）。
       換地方**只在搆不到料的時候**做：不管有沒有料每隔幾秒就重挑一次的話，腳邊還有
       一整片料他也會被別處那坨大的拉走（實測他沿著外圈走十秒，路上最近的料只有 2.7 格）。
       找不到值得走過去的一坨（料被搬光了、都被別人認走了）就站在原地等。 */
    if (!w.load.length) {
      w.st = 'idle';
      /* 場上一塊料都撿不到了：自己從地面拉一塊出來（v1.141）。他不拿鏟子——蓋自己家
         那條路本來就是「隔空從地面拉一塊」（見 castHome），這裡走的是同一件事，
         只是拉出來的先躺在腳邊、下一幀照常認領。
         **擺在 pickMageSpot 前面**：那一支是「走去別處那坨料」，場上一塊料都沒有的時候
         他會沿著外圈一直走。
         loadUp 的 short 只說「他搆得到的那一圈（MAGE_REACH）裡沒有」，所以要再確認一次
         「整個場子真的一塊都沒有」——不確認的話，他站的地方附近剛好沒料就拉一塊新的
         （實測鋪滿 3177 塊的場子裡他照樣拉出 555 塊），而那不是沒得撿，是該走過去撿。
         **界線不能收成「走一小段以內」**：試過只認搆得到的兩倍（22 格），結果 34 格外
         那一大堆料他也不去了（v1.95 起「多遠都去」是他的行為），量到的是他站在原地
         自己拉。所以維持「整個場子」——遠料照舊走過去，那才是他的樣子。 */
      if (short && findBlock(w.x, w.z, 0, 0) < 0) {
        w.a = Math.atan2(-w.x, -w.z);                // 面向工地（拉出來那塊往側面落）
        w.gait += (0 - w.gait) * Math.min(1, dt * 8);
        castPose(w, dt, 1);
        w.ct -= dt;
        if (w.ct <= 0) {
          w.ct = MAGE_GAP;
          if (digBlock(w, 0)) {
            const tip = staffTip(w);
            spawnStars(tip.x, tip.z, tip.y, 0.5, 2, MAGE_STAR);
          }
        }
        return;
      }
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
  if (w.fig > 0) return false;              // 正在打架（v1.178）
  if (w.show === 'flip') return false;      // 翻到一半被叫住會在半空停格（v1.178）
  // 正在蓋自己的家的人不算閒（蓋完了在家附近走走的才算，v1.97）
  if (w.hm >= 0 && homeBusy(w)) return false;
  if (idlePhase()) return !cheerOn(w);
  // 偷懶的工程師沒在看圖，算閒（v1.134）
  return phase === 'build' && w.st === 'idle' && (w.lazy || !w.eng);
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
    const mi = w.cw, mate = workers[mi];
    endChat(w);
    const emo = Math.random() < CHAT_MAD ? 'anger' : 'heart';
    showEmo(w, emo);
    if (mate && mate.cw === wi) showEmo(mate, emo);
    /* 談不攏有時候會打起來（v1.178，見 startFight）。接在生氣後面：骰子只在
       **已經談不攏**的那幾場再擲一次，聊得來的一律不會打。
       `mate.cw === wi` 是「對方還指著自己」（被抓走的人 endChat 時已經把 cw 清成 −1）
       ——一個人是打不起來的。 */
    if (emo === 'anger' && mate && mate.cw === wi && startFight(wi, mi)) return;
    /* 聊完就走：給一個新的閒晃目標，不然兩個人會杵在原地等發呆時間跑完。
       有自己家的人挑自己家附近（v1.100）：挑 idleSpot 那種「場上任一處」的話，他會先走開幾步，
       下一幀才被 liveHome 叫回來——而在那之前如果他還在挖料那條路上，
       那個目標會把他一路帶到工地那邊去（實測跑到離自己家 38 格）。 */
    const h = w.hm >= 0 && homes ? homes.list[w.hm] : null;
    if (h) liveSpot(w, h); else idleSpot(w);
    w.pause = 0;
  }
}

/* ── 談不攏就打起來（v1.178）───────────────────────────────
   使用者：「小人遇到時交談如果結果是生氣有時會打架」。所以這件事接在**既有的那顆骰子**
   後面：聊完天有 CHAT_MAD 的機率談不攏（v1.131 就有了，兩個人各冒一個生氣），
   談不攏的那幾場再抽 FIGHT_P 打起來——聊得來的一律不會打。

   一場架長這樣：兩個人先湊近一點（聊天那個距離揮空拳），面對面**輪流**出拳
   （同時揮的話看起來是兩個人在原地各揮各的），出拳的往前壓、挨拳的往後仰，
   腳下踩著小碎步。打完各自走開，而且聊天冷卻再乘 FIGHT_CD：剛打完的兩個人
   不該下一秒又湊在一起聊天。

   兩件**沒做**的事：沒有人會因此倒地（打完都站著走開）；也不影響工期——
   打得起來的本來就只有閒著的人（chatFree 挑的就是那些）。 */
const FIGHT_P = 0.4;                // 談不攏的對話裡有幾成會打起來
const FIGHT_T = 3.6;                // 一場打幾秒
const FIGHT_TURN = 0.6;             // 一拳幾秒（輪流，所以一個人每 1.2 秒一拳）
const FIGHT_D = 1.35;               // 打架時站多近（聊天是 CHAT_D 2.6）
const FIGHT_IN = 1.6;               // 往前湊的速度（格／秒）
const FIGHT_CD = 2;                 // 打完之後聊天冷卻乘幾倍
const FIGHT_LEAN = 0.22;            // 出拳往前壓／挨拳往後仰幾弧度
function endFight(w) {
  if (w.fig > 0) w.chatCd = rr(CHAT_CD, CHAT_CD * 2) * FIGHT_CD;
  w.fig = 0; w.fw = -1; w.punch = 0; w.guard = 0; w.pk = -1;
}
/* 打起來（回傳 false＝這一場沒抽中，照舊各自走開）。a／b 是那兩個人的編號。 */
function startFight(a, b) {
  const x = workers[a], y = workers[b];
  if (!x || !y) return false;
  if (Math.random() >= FIGHT_P) return false;
  x.fig = y.fig = FIGHT_T;
  x.fw = b; y.fw = a;
  x.side = 0; y.side = 1;                   // 先出拳的是 a（同聊天先開口的那一個）
  x.pk = y.pk = -1;
  x.pause = y.pause = 0;
  x.show = y.show = ''; x.showT = y.showT = 0;   // 打架優先於表演
  return true;
}
function stepFight(w, wi, dt) {
  const p = workers[w.fw];
  if (!p || p.fig <= 0 || p.fw !== wi) { endFight(w); return; }   // 對手被抓走了
  w.fig -= dt;
  w.y += (0 - w.y) * Math.min(1, dt * 6);
  const dx = p.x - w.x, dz = p.z - w.z, d = Math.hypot(dx, dz) || 1;
  w.a = Math.atan2(dx, dz);                                       // 面對面
  /* 站到 FIGHT_D 那個距離：遠了往前湊，太近了往後退（聊天是走近了就聊，實測有從
     0.5 格開始的那種——那個距離出拳兩個人是疊在一起的）。走一半就好：兩個人都在動，
     各走一半才會停在 FIGHT_D，各走全程的話會擠成一團再彈開。 */
  {
    const sp = clamp((d - FIGHT_D) * 0.5, -FIGHT_IN * dt, FIGHT_IN * dt);
    w.x += dx / d * sp; w.z += dz / d * sp;
  }
  w.guard = 1;                              // 雙手舉在胸前
  w.ph += dt * 6;                           // 腳下小碎步
  w.gait += (0.3 - w.gait) * Math.min(1, dt * 6);
  /* 輪到誰出拳：跟聊天輪流講話同一個算法。一拳的形狀是半個正弦——揮出去、收回來，
     收回來才輪到對方。拳頭聲在**揮到一半**（打到人那一刻）才響，一拳只響一次
     （w.pk 記的是已經響過的是第幾拳）。 */
  const turn = (FIGHT_T - w.fig) / FIGHT_TURN;
  const n = Math.floor(turn);
  const mine = n % 2 === w.side;
  w.punch = mine ? Math.sin((turn % 1) * Math.PI) : 0;
  if (mine && turn % 1 >= 0.5 && w.pk !== n) { w.pk = n; sndStab(); }
  // 出拳的往前壓、挨拳的往後仰（p.punch 是對手這一刻揮到哪）
  w.tilt = (w.punch - (p.punch || 0)) * FIGHT_LEAN;
  if (w.fig <= 0) {
    /* 收尾整套照聊天那一段（見 stepChat）：兩個人各冒一個生氣、各自挑一個新的
       目標點走開，不然他們會杵在原地等發呆時間跑完。 */
    const mate = workers[w.fw];
    endFight(w);
    showEmo(w, 'anger');
    if (mate && mate.fw === wi) showEmo(mate, 'anger');
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
     生氣   anger  ① 跌倒爬起來那一刻（被戳、被掀飛、被水柱打倒，v1.178 起也包含
                      自己走路絆一跤，見 tripWalk）② 聊完天談不攏（stepChat）
                      ③ 打完一場架（v1.178，見 stepFight）
     汗     sweat  做久了停下來喘的那幾秒（v1.237，見 stepRest）：唯一一種「掛整段」的，
                      喘多久冒多久；引擎那邊會在太陽穴旁再多畫一大滴往下滑（見 putEmotes）
   v1.131 動了兩處（都是使用者指定）：碰到水不再生氣（見 wetWorker）、
   聊完天不再一律愛心（四分之一是生氣，見 CHAT_MAD）。

   冒多久：都是一兩秒。太短來不及看（鏡頭多半沒對著那個人），太長就會一直掛在頭上，
   下一件事發生時反而看不出來是在反應新的那件。 */
/* sweat 每幀都被 stepRest 推回來，這個數字只管「喘完之後還掛多久才收」 */
const EMO_T = { bang: 1.6, quest: 1.8, heart: 2.2, anger: 1.8, sweat: 0.3 };
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
let evPh = '';                      // 現在這一件是在哪個階段挑的（'build'／'idle'，見 stepIdleEvent）
/* wt 是**相對權重，不是機率**（v1.101，使用者：「閒晃模式事件改為必定發生，
   因為設計成可擴充，必定發生 隨機一種」）：散場之後一定會挑一件來跑，
   wt 大的被挑到的機會多。v1.97～v1.100 是「每一筆各擲一次 40%」——只有一筆的時候，
   六成的場次什麼事都不會發生。 */
const IDLE_EVENTS = [
  /* 小人的家。每個人的行為擺在 updHome（跟魔法師一樣是「一條自己的路」），
     所以這裡不需要每幀的 step。 */
  { id: 'home', wt: 1, start: startHomes, step: null, stop: stopHomes },
  /* 城牆（v1.186）。蓋法跟房子同一條路（都掛在 homes.list 上），所以收尾共用 stopHomes。 */
  { id: 'wall', wt: 1, start: startWall, step: null, stop: stopHomes }
];
/* 上一件事蓋出來的東西還剩多少（v1.186 的黏著，**判準 v1.188 換掉**）。
   舊的判準是「homes.list 上還有那一類的任何一筆」——實測那個門檻**沒有出口**
   （見 開發筆記〈事件永遠不會換：黏著沒有出口〉）：房子與樹散在離場中心 20~36 的整片
   碎料場，換下一座地標也徵收不到（工地半徑才 12），而**沒蓋完的（done=false）
   打光了也不會廢棄**（wrecked 那一條要 h.done），剩一筆殘骸就永遠黏著；
   更糟的是每黏一輪村子還多幾筆（實測四輪 10 → 17 筆）。

   現在改成看**塊數比例**（使用者：「原本是想說事件一或二的 小房子或城牆
   已建造數不多就抽 如果完成度比較高就繼續」）：這一類現在場上還立著的塊數，
   跌到「曾經蓋到的最高點」的四分之一以下（WRECK_AT，就是他原本說的那個門檻）就重抽。
   **分母是最高點，不是藍圖該有的總塊數**：整圈城牆 3384 塊、第一輪只蓋得了 246 塊
   （實測），拿總塊數當分母的話一開工就被判定「建造數不多」，城牆永遠蓋不起來。
   最高點記在事件這一層、不是逐筆記：逐筆的話廢棄一筆連分母也跟著消失，
   打掉三分之一反而變回 100%。 */
const EV_WALL = { home: false, wall: true };
let evPeak = 0;                     // 這一件事曾經蓋到的最高塊數（換一件才歸零，見 rollIdleEvent）
function evBlocks(e) {
  const wall = EV_WALL[e.id];
  if (wall === undefined || !homes) return 0;
  let n = 0;
  for (const h of homes.list) if (!!h.wall === wall) n += h.slots.length - h.left;
  return n;
}
function evAlive(e) {
  const n = evBlocks(e);
  return n > 0 && n >= evPeak * WRECK_AT;
}
/* 照權重挑一件。回傳 null 只有一種情況：表是空的。

   **上一件事蓋的東西還剩四分之一以上就不重抽**（v1.186，使用者：「多個閒晃事件切換問題
   (目前是想說如果小房子建築都被破壞剩下 25% 才再隨機一次? 因為城牆要蓋好幾輪吧)」；
   判準見上面 evAlive，v1.188 從「還有任何一筆」換成塊數比例）。整圈城牆兩三千塊、
   一輪蓋不完，每一輪重抽的話半成品常常好幾輪沒人理；黏著之後它一輪接一輪蓋到好。
   代價他知道：城牆蓋起來之後會一直是城牆這一件（修牆、補城內的房子），
   要換得先把牆拆掉四分之三。 */
let evLast = null;                  // 上一件跑過的（stopIdleEvent 之後還記著）
function rollIdleEvent() {
  if (evLast && evAlive(evLast)) return evLast;
  let tot = 0;
  for (const e of IDLE_EVENTS) tot += e.wt;
  if (tot <= 0) return null;
  let r = Math.random() * tot;
  let e = IDLE_EVENTS[IDLE_EVENTS.length - 1];     // 浮點誤差的保險
  for (const x of IDLE_EVENTS) { r -= x.wt; if (r < 0) { e = x; break; } }
  /* 換一件事，最高點就跟著換成「這一類現在有多少」（見 evAlive）。
     這兩個一定要一起動：只歸零 evPeak、evLast 留給呼叫端設的話，
     中間那一瞬間 evAlive 拿 peak 0 去比，什麼都會判成「還活著」。 */
  evLast = e;
  evPeak = evBlocks(e);
  return e;
}
function stopIdleEvent() {
  const e = idleEv;
  idleEv = null;
  if (e) e.stop();
}
/* 現在該不該有事件、是哪一種場合（v1.134）。'idle'＝蓋完了全場沒事幹（v1.97 那個），
   'build'＝施工中而且場上有人偷懶（那幾個人的事件，誰參加在 startHomes 那邊擋）。
   整地中（clear）兩個都不是：那時候全場都被推土機趕到外圈。 */
function evPhase() {
  if (idlePhase()) return 'idle';
  if (phase === 'build' && workers.some(w => w.lazy)) return 'build';
  return '';
}
function stepIdleEvent(dt) {
  /* 「曾經蓋到多少」每幀追一次，而且要在最前面：下面那個 `if (!ph)` 會早退
     （施工中沒人偷懶、整地中），但玩家那段時間照樣在拆村子，漏追的話峰值會停在錯的地方。 */
  if (evLast) { const n = evBlocks(evLast); if (n > evPeak) evPeak = n; }
  const ph = evPhase();
  if (!ph) { stopIdleEvent(); evArm = 1; evPh = ''; return; }
  /* 換場合就重挑（v1.134）。最要緊的是「施工中 → 蓋完了」那一刻：不重挑的話 evArm
     早就是 0，完工散場後那一輪永遠不會開始，一半的人再也不會去蓋自己的家。
     重挑會先 stopHomes（蓋到一半的先擱著），散場後照舊全員重新抽一件。 */
  if (evPh && evPh !== ph) { stopIdleEvent(); evArm = 1; }
  evPh = ph;
  if (evArm) {
    /* 等到每個人都散場才挑：還在圈上跳的時候就開始蓋房子的話，
       那幾個人會從圈上直接走掉（散場錯開最多 CHEER_OUT 秒，見那裡）。
       施工中沒有這個顧慮——偷懶的人本來就沒事幹，開工那一刻就可以開始。 */
    if (ph === 'idle' && workers.some(w => cheerOn(w))) return;
    evArm = 0;
    idleEv = rollIdleEvent();
    if (idleEv) idleEv.start();         // evLast 與最高點在 rollIdleEvent 裡一起換好了
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
   外緣是**生活圈** arenaR。範圍跟著建築大小走，大工地就散得更開。
   **v1.210 起這一圈就不再是場地邊緣了，v1.211 起連樹也不在它外面**（樹種在
   debrisR + 3～15）——使用者兩次都指名「小房子的範圍不要跟著變大」，所以
   這裡與城牆（wallRing）是整份程式裡僅存的兩個 arenaR 用戶。 */
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
/* 幾個人合蓋就從那一組裡隨機挑一款（房子與樹共用，兩張表都照 n 分組）。
   人數超過表上最多的那組就用最大那組。 */
function pickKind(tab, n) {
  const want = Math.min(n, tab[tab.length - 1].n);
  /* 表被濾過、剛好缺那一組人數的款式時（城內那一圈太窄，只有小款放得下，
     見 wallInside），就從剩下的裡面挑——原本的兩張表不會走到這條。 */
  const pool = tab.filter(k => k.n === want);
  const use = pool.length ? pool : tab;
  return use[Math.floor(Math.random() * use.length)];
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
/* ── 樹（v1.153）─────────────────────────────────────────
   使用者：「閒置的小人有點多 增加一些小人去蓋樹（積木組成版本 可以多種造型有大有小
   邏輯同小房子 只是他是樹）」、「抽幾個沒事的人去蓋樹」。
   「邏輯同小房子」是照字面做的：樹跟房子放在**同一份 homes.list**（多一個 h.tree 記號），
   於是支撐、垮塌、被砸出洞補回來、剩不到兩成五廢棄、被新工地徵收那一整套完全不必再寫。
   只有三處不一樣：誰去蓋（見 startHomes 末尾）、外型（treeSlots）、
   擋路只擋樹幹那幾層（見 homeBox 的 TREE_DUCK）。

     tw    樹幹幾格粗（1 或 2）
     th    樹幹露在樹冠底下幾層——夠高小人才走得過樹下
     form  樹冠形狀：ball 圓冠／cone 針葉塔／tier 分層傘
     rx    樹冠半徑（格）
     ry    ball＝樹冠的半高；cone／tier＝樹冠總共幾層
     fruit 樹冠外圈掛果子（果樹）

   塊數 31～220（小房子是 100～300）：一個人蓋的那三款要小到一輪蓋得完，
   三個人合蓋的才跟房子同級。 */
const TREE_KIND = [
  { n: 1, id: '灌木',   tw: 1, th: 1, form: 'ball', rx: 1.9, ry: 1.5 },
  { n: 1, id: '小樹',   tw: 1, th: 3, form: 'ball', rx: 2.3, ry: 2.0 },
  { n: 1, id: '松樹',   tw: 1, th: 2, form: 'cone', rx: 2.3, ry: 7 },
  { n: 2, id: '果樹',   tw: 1, th: 3, form: 'ball', rx: 2.7, ry: 2.2, fruit: 1 },
  { n: 2, id: '闊葉樹', tw: 1, th: 4, form: 'ball', rx: 3.0, ry: 2.6 },
  { n: 2, id: '杉樹',   tw: 1, th: 3, form: 'cone', rx: 3.0, ry: 10 },
  { n: 3, id: '大樹',   tw: 2, th: 5, form: 'ball', rx: 3.8, ry: 3.2 },
  { n: 3, id: '老榕',   tw: 2, th: 4, form: 'tier', rx: 4.4, ry: 9 }
];
/* 樹幹、深葉、淺葉、果子（每棵隨機挑一組，同 HOME_PAL）。
   綠色取自 engine.js 那組草地小樹的 LEAF（0x4e8a3c～0x6cae52）、樹幹取自 trunkMesh
   的 0x6b4a2f——蓋出來的樹跟場邊那圈本來就有的樹是同一個色系。 */
const TREE_PAL = [
  [[0.42, 0.29, 0.18], [0.28, 0.50, 0.21], [0.40, 0.66, 0.30], [0.78, 0.20, 0.16]],  // 常綠
  [[0.47, 0.34, 0.22], [0.37, 0.60, 0.25], [0.54, 0.74, 0.34], [0.90, 0.72, 0.22]],  // 嫩綠
  [[0.38, 0.26, 0.18], [0.66, 0.28, 0.12], [0.85, 0.47, 0.14], [0.74, 0.16, 0.14]]   // 秋
];
/* 地基半徑：樹冠最寬那一圈再加一點（同 homeR，方的東西用圓框寧可框大一點）。
   兩棵樹、樹與房子隔多遠都看它（見 pickHomeSite）。 */
function treeR(k) { return k.rx + 1.2; }
/* 這一輪抽幾成的閒人去種樹（使用者：「抽幾個沒事的人去蓋樹」）。
   房子那邊是「還沒有家的人抽一半」，這邊抽的是「這一輪沒被派到房子的人」。 */
const TREE_PART = 0.35;
/* 樹加起來最多幾塊（v1.153）。房子靠「一人一間」擋住無限增生（見 startHomes），
   樹沒有那條——不擋的話每一輪都再長一批，而村子跟地標**共用同一個積木池**
   （engine.js 的 MAXB）：池子滿了 digBlock 就再也挖不出東西，房子跟樹一起停在半棟。
   所以直接用塊數擋，擋在最要緊的那個地方。1800 塊大約是 8～15 棵，
   跟 60 人蓋到飽的村子（43 間 5405 格）加起來還在池子裡。 */
const TREE_BUDGET = 1800;
/* 樹擋路只擋到第幾層（v1.153）。小人的帽頂最高 2.63 格（肌肉小人 1.86×1.41），
   第 2 層的積木佔 2.00～2.94，第 3 層佔 3.00～3.94——所以第 3 層起是「走得過去的樹下」。
   不擋的話大樹會變成一片 10×10 的隱形牆，小人繞著空氣走（見 homeBox）。 */
const TREE_DUCK = 2;
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
const DIG_MARK = 1.7;              // 土痕的大小（跟鐵球的坑同一套，3 秒淡掉）
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
/* 「這個世界座標上有沒有硬東西」的**唯一入口**（v1.158.1）。
   地標的積木在藍圖那張格子表（blockAt）、小人的家各自帶一份（homeSolid），兩邊都要問。
   在這之前這個聯集是散在六處手寫的，每加一種會飛的東西就要記得再寫一次——
   v1.103 的水（solidAt）跟 v1.135 的投石機石頭（sweepRock）都是漏掉之後才補上的。
   定義擺在 homeSolid 旁邊而不是 game-tools.js，是因為載入順序是
   game.js（blockAt）→ 這一支（homeSolid）→ game-tools.js，擺這裡才輪得到所有呼叫端。 */
const hardAt = (x, y, z) => blockAt(x, y, z) || homeSolid(x, y, z);
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
/* 這一格的某個鄰居（26 鄰接，跟地標的支撐判定同一套）。回傳格子編號或 undefined。
   **鄰居表第一次問到才算，算好留在格子上**（v1.237.4，見 開發筆記〈畫面沒變就不重寫〉）：
   s.nbr 是 26 個方向（NBR 的順序）各是第幾格、沒有就 −1。v1.237.3 以前每問一次就組一次
   'i:gy:k' 字串去查 h.at——魔法師蓋家時 homeFree 每幀把整間的空格掃一遍、每一格 canPlaceHome
   問 6～26 次，實測那一幕每幀 0.05～0.07 ms，一大半花在組字串。
   h.at 都是開新家那一刻一次建好、之後不再改（wallSeg 與三處開新家的地方），所以算一次就夠；
   s.nbrAt 記算的時候是哪一份 h.at，換了一份就重算。不在 NBR／NBR6 裡的方向照舊現查。 */
const NBR_IX = new Map();
NBR.forEach((d, k) => NBR_IX.set(d, k));
for (const d of NBR6) NBR_IX.set(d, NBR.findIndex(e => e[0] === d[0] && e[1] === d[1] && e[2] === d[2]));
function homeNbr(h, s, d) {
  const k = NBR_IX.get(d);
  if (k === undefined) return h.at.get((s.i + d[0]) + ':' + (s.gy + d[1]) + ':' + (s.k + d[2]));
  if (s.nbrAt !== h.at) {
    const nb = s.nbr || (s.nbr = new Int32Array(NBR.length));
    for (let q = 0; q < NBR.length; q++) {
      const e = NBR[q], j = h.at.get((s.i + e[0]) + ':' + (s.gy + e[1]) + ':' + (s.k + e[2]));
      nb[q] = j === undefined ? -1 : j;
    }
    s.nbrAt = h.at;
  }
  const j = s.nbr[k];
  return j < 0 ? undefined : j;
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
    if (h.tree && sl.gy > TREE_DUCK) continue;    // 樹只有樹幹擋路，樹冠走得過去
    if (sl.x < x0) x0 = sl.x;
    if (sl.x > x1) x1 = sl.x;
    if (sl.z < z0) z0 = sl.z;
    if (sl.z > z1) z1 = sl.z;
  }
  h.x0 = x0 - 0.5; h.x1 = x1 + 0.5;
  h.z0 = z0 - 0.5; h.z1 = z1 + 0.5;
}
/* 同一個外框，但**不管砌起來沒有**（v1.189）。`homeBox` 只框還站著的格子，所以
   一塊都不剩的殘骸框是空的（x0 > x1）；蓋牆要問的是「這塊地被誰占著」，殘骸也算數
   （見 startWall 開頭）。樹一樣只算樹幹，理由同 homeBox。 */
function homeSpan(h) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const sl of h.slots) {
    if (h.tree && sl.gy > TREE_DUCK) continue;
    if (sl.x < x0) x0 = sl.x;
    if (sl.x > x1) x1 = sl.x;
    if (sl.z < z0) z0 = sl.z;
    if (sl.z > z1) z1 = sl.z;
  }
  return { x0: x0 - 0.5, x1: x1 + 0.5, z0: z0 - 0.5, z1: z1 + 0.5 };
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
/* noGap（v1.207）＝**門洞也算擋住**。只有巨人在給：門洞五層高，而牠有十五格
   （使用者：「巨人太高不能走城門」），對牠來說那個洞跟實心的牆沒兩樣。
   其餘呼叫端一個字都沒改，預設行為一個位元都沒變（同 explode／afterHit 的 self）。 */
function footHome(x, z, noGap) {
  if (!homes) return null;
  for (const h of homes.list) {
    if (!(x > h.x0 && x < h.x1 && z > h.z0 && z < h.z1)) continue;
    /* 城門的門洞是真的走得過去（v1.186）：門樓整座是一筆，外框當然含門洞那一塊，
       所以命中之後再問一次 h.gap。命中外框本來就少見，這一條不進熱路徑。 */
    if (!noGap && h.gap && x > h.gap.x0 && x < h.gap.x1 && z > h.gap.z0 && z < h.gap.z1) continue;
    return h;
  }
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
  /* 城牆的直牆段只准**往厚度那一軸**推出去（v1.186）。整圈是切成好幾段的，
     照「四面挑最近的」推的話，踩在兩段接縫上的那一個會被推進隔壁那一段的框裡、
     隔壁再把他推回來——一來一回之間他就順著接縫鑽過牆了（實測黑獼猴 9.4 秒穿牆進城）。
     往厚度那一軸推＝從他進來的那一面退回去，接縫上也成立。 */
  if (h.thin === 'z') { w.z = w.z - h.z0 < h.z1 - w.z ? h.z0 - e : h.z1 + e; return; }
  if (h.thin === 'x') { w.x = w.x - h.x0 < h.x1 - w.x ? h.x0 - e : h.x1 + e; return; }
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
/* skip（v1.190.2）：這一間不算擋路。只有天災那幾隻穿城門時會給——牠要穿的就是
   門樓那一段的門洞，斜著進門時 2.2 格的探針會打到兩側的墩座，一繞就永遠進不去。 */
const _dodge = { x: 0, z: 0 };
function dodgeHome(w, ux, uz, skip) {
  _dodge.x = ux; _dodge.z = uz;
  const h = blockHome(w, ux, uz, skip);
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
function blockHome(w, ux, uz, skip) {
  if (!homes || w.ghost > 0) return null;             // 穿透中（見 stuckWatch）
  for (let d = DODGE_STEP; d <= DODGE_EYE + 1e-6; d += DODGE_STEP) {
    const h = footHome(w.x + ux * d, w.z + uz * d);
    if (h && h !== skip) { _blk.d = d; return h; }    // skip：穿城門那一段（見 dodgeHome）
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
/* 一棵樹的格子清單（v1.153）。回傳的東西跟 homeSlots 一模一樣，後面那一整套才接得上。
   讀得出是樹靠這幾件事：

     · 樹幹一路長進樹冠裡（不是只長到樹冠底下、也不從樹冠頂上冒出來）：被砸開之後
       裡面也是樹幹，而且整片樹冠靠它六面連回地面（見下面的連通篩）
     · 樹冠最外那一圈挑掉六分之一：整顆完美的橢球看過去是一顆球，不是樹
     · 兩種葉色交錯撒：一色到底的樹冠是一團色塊，看不出體積
     · 針葉塔兩層一階（cone 的 +0.55）：側面才有杉木那種鋸齒

   順序是樹幹由下往上 → 樹冠一層一層、每層由內往外、一層換一個繞行方向。
   照這個順序砌看起來才是「長出來」的，而且連號的兩格是真的相鄰
   （同 homeSlots 沿周長生的理由：小人是照順序認格子的，跳來跳去就是在走路。
   實測連號平均跳 1.7～2.2 格，不排的話是 2.4～3.2）。 */
function treeSlots(hx, hz, k, pal) {
  const c0 = (k.tw - 1) / 2;                     // 樹幹中心（2 格粗時落在 0.5）
  const cells = new Map();                       // i:gy:kk → { i, gy, kk, c, d, a }
  const key = (i, gy, kk) => i + ':' + gy + ':' + kk;
  const hash = (i, gy, kk, a, b, c) => (((i * a + kk * b + gy * c) % 6) + 6) % 6;
  // 葉色交錯、外圈偶爾掛一顆果子：都用位置算，同一棵樹每次長出來要一樣
  const leafC = (i, gy, kk, edge) =>
    edge && k.fruit && hash(i, gy, kk, 23, 31, 7) === 0 ? pal[3]
      : hash(i, gy, kk, 7, 13, 5) < 2 ? pal[2] : pal[1];
  const leaf = (i, gy, kk, edge) => {
    if (edge && hash(i, gy, kk, 29, 17, 11) === 0) return;      // 外圈挑掉六分之一
    cells.set(key(i, gy, kk), { i, gy, kk, c: leafC(i, gy, kk, edge),
                                d: Math.hypot(i - c0, kk - c0),
                                a: Math.atan2(kk - c0, i - c0) * (gy % 2 ? -1 : 1) });
  };
  /* 一層樹葉：半徑 r 的圓盤。只有最外那一圈（離邊 0.55 格以內）才挑得掉，
     裡面一定留——裡面也挑的話樹冠會被打成蜂窩，看過去是一堆破洞。 */
  const disc = (gy, r) => {
    if (r < 0.4) return;
    const R = Math.ceil(r + c0);
    for (let i = -R; i <= R; i++)
      for (let kk = -R; kk <= R; kk++) {
        const d = Math.hypot(i - c0, kk - c0);
        if (d > r + 0.15) continue;                // 放寬到 0.35 的話小樹冠會是個方塊
        leaf(i, gy, kk, d > r - 0.55);
      }
  };
  let trunkTop;
  if (k.form === 'ball') {
    const ry = Math.round(k.ry);
    const cy = k.th + ry;                          // 樹冠中心那一層
    trunkTop = cy;
    for (let gy = k.th; gy <= cy + ry; gy++) {
      const dy = (gy - cy) / k.ry;
      disc(gy, k.rx * Math.sqrt(Math.max(0, 1 - dy * dy)));
    }
  } else if (k.form === 'cone') {
    /* 針葉塔：半徑一路收到 0，兩層一階讓側面有鋸齒。
       樹幹只探進樹冠底下那兩層——再高就會從塔尖冒出來（塔尖只有一格寬）。 */
    trunkTop = k.th + 1;
    for (let t = 0; t < k.ry; t++) {
      /* 最上面兩層收成一根單格的塔尖：照公式算的話那裡是 r≈0.9 的十字，
         看過去像天線不像樹（而 r 再小一點就會小於 disc 的下限、整層不見）。 */
      const r = t >= k.ry - 2 ? 0.45
                              : k.rx * (1 - t / k.ry) + (t % 2 === 0 ? 0.55 : 0);
      disc(k.th + t, r);
    }
  } else {
    /* 分層傘（老榕）：三層傘蓋，中間空兩層看得到樹幹。
       一層傘是「一片圓盤 ＋ 上面一圈小一點的」，單薄一片會像塔的簷。 */
    trunkTop = k.th + 6;
    for (let j = 0; j < 3; j++) {
      const r = k.rx * (1 - 0.24 * j), gy = k.th + j * 3;
      disc(gy, r);
      disc(gy + 1, r - 1.1);
    }
  }
  // 樹幹（蓋過樹冠：同一格上樹幹優先，被砸開才看得到裡面是幹不是葉）
  for (let gy = 0; gy <= trunkTop; gy++)
    for (let i = 0; i < k.tw; i++)
      for (let kk = 0; kk < k.tw; kk++)
        cells.set(key(i, gy, kk), { i, gy, kk, c: pal[0], d: -1, a: 0 });
  /* 連通篩：只留「六面連得回地面」的那些。挑掉外圈那一步有可能留下孤零零的一片葉子，
     而那種葉子完好時 f6 就是 false，之後永遠不會被垮塌判定收掉（見 markHomeF6）——
     與其讓它掛在半空，不如一開始就不要生出來。 */
  const live = new Set(), st = [];
  for (const [id, c] of cells) if (c.gy === 0) { live.add(id); st.push(c); }
  while (st.length) {
    const c = st.pop();
    for (const d of NBR6) {
      const id = key(c.i + d[0], c.gy + d[1], c.kk + d[2]);
      if (live.has(id) || !cells.has(id)) continue;
      live.add(id); st.push(cells.get(id));
    }
  }
  const list = [];
  for (const [id, c] of cells) if (live.has(id)) list.push(c);
  list.sort((a, b) => (a.gy - b.gy) || (a.d - b.d) || (a.a - b.a));
  return list.map(c => ({
    x: hx + c.i - c0, y: c.gy + HB, z: hz + c.kk - c0, c: c.c,
    i: c.i, k: c.kk, gy: c.gy, filled: false, claimed: -1
  }));
}
/* ── 事件二：城牆（v1.186）──────────────────────────────────────
   使用者：「小人蓋城牆把地標建築圍起來／城牆內只有幾間小房子&小樹（比事件一少
   看起來稀疏的感覺）／城牆依地標大小會不同範圍 會擋生物移動 積木組成
   能被道具等破壞（同小房子）」，造型照他給的參考圖：方牆 ＋ 四座角樓 ＋ 一座城門樓。

   **整圈不是一筆，是切成好幾段掛在同一份 homes.list 上。** 走路的擋路判定看的是
   外接矩形（見 footHome），整圈當一筆的話那個框會把城內連同地標整個框住，
   人連進城都進不去。切成段之後每一段的框都是薄薄一條，而且支撐與垮塌、
   被每一把道具打壞、打到剩兩成五整段廢棄、有人補洞、積木就地挖出來、魔法師隔空拋、
   肌肉小人就地掄——那一整套跟小房子與樹共用，一行都不必再寫
   （同〈同一件事的第二種建物：樹〉那條路）。 */
const WALL_H = 5;                   // 牆身幾層高（使用者選「大包圍、5 層」）
const WALL_TOW = 5;                 // 角樓邊長（空心方塔，實心的話一座 200 塊、外面還看不出差別）
/* 角樓的牆比城牆高幾層。2 的時候看過去就是牆上一個胖箱子（第一版實測），
   參考圖裡的角樓差不多是牆的兩倍高——牆身 5 ＋ 3 ＝ 8，再加三層四坡屋頂與旗子。 */
const WALL_TOW_UP = 3;
/* 門洞（v1.194 整組放大，使用者：「城牆四個方向都做門 門的造型調整 洞口大一點
   (還是要符合目前比例)」，參考圖 參考圖/271.png＝歐式城牆上的尖拱門）。
   **尖拱**：兩側那一柱 WALL_GATE_H 格高，往中間每一柱高一層，最中間那一柱再往上
   多 G 格收成尖的——5 寬 4 高的話是 4／5／7 格（牆身才 5 層，所以門洞比牆還高）。 */
const WALL_GATE = 5;                // 門洞幾格寬（v1.186 是 3）
const WALL_GATE_H = 4;              // 門洞最外那一柱幾格高（往中間每一柱再高一層）
const WALL_GATE_UP = 4;             // 門樓磚身比牆高幾層（磚身 9 層 ＋ 走道 ＋ 垛口＝11 層）
const WALL_PIER = 3;                // 門樓兩側的墩座各幾格寬（v1.186 是 2）
const WALL_JUT = 1;                 // 門樓比牆面往**城外**凸出幾格（使用者：「應該比牆凸出一點點吧 一格?」）
const WALL_MACH = 1;                // 垛口下那一排托架再往外挑幾格（照參考圖那排堞口）
const WALL_RUN = 16;                // 一段直牆最多幾格長（見上面：框要薄，但段數也不能爆）
/* 牆離工地至少多遠。最小的小房子地基半徑 4.6，城內要放得下一圈
   （內緣是 siteR + HOME_NEAR，所以這裡要留得下 HOME_NEAR ＋ 一間房子的直徑）。 */
const WALL_NEAR = 16;
const WALL_PAL = [[0.66, 0.63, 0.57],     // 牆身（淺灰石）
                  [0.55, 0.52, 0.48],     // 壓頂、垛口、門樓的走道與托架
                  [0.38, 0.45, 0.58],     // 角樓的屋頂（借 HOME_PAL 那組藍灰）
                  [0.24, 0.44, 0.72],     // 角樓頂上那面旗（照參考圖）
                  [0.46, 0.43, 0.39]];    // 門洞的拱圈（比牆身暗一階才看得出是拱，見 gateTower）
/* 城內每多少面積放一間房子／一棵樹，各自的上限（使用者選「按牆內面積算」）。
   事件一的密度是一間 1000 面積上下（20 人 7 間鋪滿整片碎料場），這裡再稀一階；
   上限是必要的——金門大橋那種大工地光城內就塞得下十幾間，那就變成第二個村子了。 */
const WALL_IN_AREA = 800, WALL_IN_MAX = 5;
const WALL_IN_TAREA = 1000, WALL_IN_TMAX = 4;
/* 牆圍多大（使用者選「大包圍」＝工地外緣與碎料場外緣的中間）。兩頭各夾一次：
   內緣至少 siteR + WALL_NEAR（城內要放得下房子），外緣讓**四個角**不要凸出碎料場太多
   ——方形的角離場中心是邊的 √2 倍，不夾的話大工地的角樓會蓋到場邊那圈樹裡。 */
function wallRing() {
  const lo = siteR + WALL_NEAR;
  return Math.round(Math.max(lo, Math.min((siteR + arenaR) / 2, (arenaR + 6) / Math.SQRT2)));
}
/* 把一份格子清單收成一段（一段＝homes.list 上的一筆，欄位跟房子一樣）。
   cells 的 i／k 就是**世界格座標**——整圈共用同一張整數格，四面牆才對得上角樓。
   thin 是「薄的是哪一軸」（直牆才有，見 homeStand）；gap 是門洞那塊走得過去的地方。
   wx0～wz1 是**整段蓋起來會占到哪裡**：h.x0～h.z1 只框已經砌好的那幾格（見 homeBox），
   一塊都還沒砌時是空的，拿它去擋位置的話房子會蓋在還沒砌的牆線上。 */
function wallSeg(cells, kind, thin, gap) {
  let i0 = Infinity, i1 = -Infinity, k0 = Infinity, k1 = -Infinity;
  for (const c of cells) {
    if (c.i < i0) i0 = c.i;
    if (c.i > i1) i1 = c.i;
    if (c.k < k0) k0 = c.k;
    if (c.k > k1) k1 = c.k;
  }
  const slots = cells.map(c => ({ x: c.i, y: c.gy + HB, z: c.k, c: c.c,
                                  i: c.i - i0, k: c.k - k0, gy: c.gy,
                                  filled: false, claimed: -1 }));
  const at = new Map();
  slots.forEach((sl, i) => at.set(sl.i + ':' + sl.gy + ':' + sl.k, i));
  const h = { id: homeSeq++, x: (i0 + i1) / 2, z: (k0 + k1) / 2,
              r: Math.hypot(i1 - i0, k1 - k0) / 2 + 0.7, kind, at,
              ox: (i1 - i0) / 2, oz: (k1 - k0) / 2,          // 見 homeSolid
              slots, left: slots.length, n: 1,
              wall: 1, thin: thin || null, gap: gap || null,
              wx0: i0 - 0.5, wx1: i1 + 0.5, wz0: k0 - 0.5, wz1: k1 + 0.5,
              done: false };
  homeBox(h);
  markHomeF6(h);
  return h;
}
/* 一座城門樓（v1.194 改成四面各一座，使用者：「城牆四個方向都做門 門的造型調整
   洞口大一點(還是要符合目前比例)」）。造型照他第二次給的參考圖（參考圖/271.png，
   歐式城牆上的門）——**頂上沒有樓閣屋頂**，就是一段比牆高一截的牆：
   兩側墩座 ＋ **尖拱**門洞（周圍一圈換色的拱圈石）＋ 垛口下一排往外挑的托架
   （參考圖最顯眼的那一排堞口）＋ 頂上照城牆的做法收成走道與垛口。

   > 使用者（看過第一版的中式門樓之後）：「改成這種樣式的好了」，範圍選「只換門」、
   > 配色選「維持淡灰石」——所以牆身、角樓、垛口、配色一個字都沒動。

   fix／horiz 跟 runCells 同一套：a 是沿著牆那一軸的世界座標，d 是離牆線幾格
   （fix 的正負那一邊是城外，所以 d === side 就是外牆面）。

   **門洞是真的缺口**：那一塊記在 h.gap 裡，footHome 命中外框之後會再問一次，
   所以小人與動物走得過去（使用者選的「留門洞；擋小人與動物，車照穿」）。
   缺口的深度要**含托架挑出去的那一格**（那一格讓整段的外框往城外多一格），
   不然人走到托架下面會被外框擋住、進不了門。
   整座門樓是一筆、不切兩半：切開的話外框各自薄薄一條，門洞上方那幾格就沒有人認領。 */
function gateTower(fix, horiz) {
  const G = (WALL_GATE - 1) / 2, P = G + WALL_PIER, pal = WALL_PAL;
  const H = WALL_H + WALL_GATE_UP;             // 磚身幾層高（再上去是走道與垛口）
  const side = fix > 0 ? 1 : -1;               // 哪一側是城外
  const J = side * (1 + WALL_JUT);             // 凸出去的那一面在離牆線幾格
  const M = side * (1 + WALL_JUT + WALL_MACH); // 托架／挑出去的那一排又在外面一格
  const b0 = Math.min(-1, J), b1 = Math.max(1, J);      // 磚身占到的深度（城內那面跟牆齊）
  const even = a => !(((a % 2) + 2) % 2);      // 照**世界座標**的奇偶（同 runCells 的垛口）
  const cells = [];
  const put = (a, d, gy, c) =>
    cells.push(horiz ? { i: a, k: fix + d, gy, c } : { i: fix + d, k: a, gy, c });
  /* 門洞的輪廓是**尖拱**：兩側那一柱 WALL_GATE_H 格高，往中間每一柱高一層，
     最中間那一柱再多 G 格收成尖的（5 寬 4 高＝4／5／7 格）。 */
  const open = (a, gy) => Math.abs(a) <= G &&
                          gy < WALL_GATE_H + (a === 0 ? G + 1 : G - Math.abs(a));
  // 拱圈：貼著門洞外圍那一圈石（換個色才讀得出是拱不是方洞）
  const rim = (a, gy) => open(a, gy - 1) || open(a - 1, gy) || open(a + 1, gy);
  for (let gy = 0; gy < H; gy++)
    for (let n = 0; n <= 2 * P; n++) {
      const a = gy % 2 ? P - n : -P + n;                    // 蛇行，同 runCells
      if (open(a, gy)) continue;
      // 拱圈只刷在看得到的那兩面（城外那一面是凸出去的 J，城內那一面跟牆齊）
      for (let d = b0; d <= b1; d++)
        put(a, d, gy, (d === J || d === -side) && rim(a, gy) ? pal[4] : pal[0]);
    }
  /* 垛口下那一排托架（machicolation，參考圖上最顯眼的那一排小拱）：隔一格一塊挑出去，
     上面的走道跟著挑出來壓在托架上、垛口再立在挑出來的那一格——看過去就是一排小拱。
     托架與垛口**錯開一格**（托架在奇數、垛口在偶數）：同格的話整排會變成一條直溝。
     每一塊都有下面或旁邊那一格撐著（垛口 → 走道 → 托架 → 牆面），垮塌那一套照舊。 */
  for (let a = -P; a <= P; a++) if (!even(a)) put(a, M, H - 1, pal[1]);
  for (let a = -P; a <= P; a++) {
    for (let d = b0; d <= b1; d++) put(a, d, H, pal[1]);    // 走道
    put(a, M, H, pal[1]);                                   // 挑出去的那一條
  }
  for (let a = -P; a <= P; a++) if (even(a)) put(a, M, H + 1, pal[1]);   // 垛口
  const g0 = -G - 0.5, g1 = G + 0.5;
  const d0 = fix + Math.min(b0, M) - 0.5, d1 = fix + Math.max(b1, M) + 0.5;
  const h = wallSeg(cells, '城門樓', null,
                    horiz ? { x0: g0, x1: g1, z0: d0, z1: d1 }
                          : { x0: d0, x1: d1, z0: g0, z1: g1 });
  /* 門洞中心那一點（在**牆線上**，不是外框的中心）：門樓往城外凸出去之後，
     外框的中心就偏到牆外一格，拿它當「門在哪」的話落腳點會整組往外偏
     （v1.195～v1.234 的 wallOpenSpot 在用；v1.235 起巡路走格子地圖，門洞就是地圖上的洞）。 */
  h.gmid = horiz ? { x: 0, z: fix } : { x: fix, z: 0 };
  return h;
}
/* 整圈切成哪幾段。牆線走 x = ±W 與 z = ±W，四個角各一座角樓，
   **四面正中央各一座門樓**（v1.194；v1.186~v1.193 只有朝鏡頭那一面有門）。
   整圈一定生完整（v1.189）：擋在牆線上的小房子在這之前就被拆成碎料了（見 startWall）。
   v1.186~v1.188 這裡吃一個 skip(x, z)，壓到房子的那幾格不生出來、讓房子嵌在牆上——
   那條路的兩個坑寫在 開發筆記〈蓋牆前先把擋路的拆掉〉。 */
function wallPlan() {
  const W = wallRing(), T = (WALL_TOW - 1) / 2, pal = WALL_PAL;
  const G = (WALL_GATE - 1) / 2, P = G + WALL_PIER;
  const end = W - T - 1;                       // 直牆到哪裡為止（再過去是角樓）
  const out = [];
  /* 角樓：空心方塔 ＋ 四坡屋頂（一層一層縮到剩一格）＋ 頂上一根旗桿。
     **屋頂一定要是尖的**：第一版收在「鋪滿一層 ＋ 縮一圈」，看過去是牆上擺了一個
     藍色箱子；縮到剩一格才讀得出是塔。 */
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const cx = sx * W, cz = sz * W, H = WALL_H + WALL_TOW_UP, cells = [];
    const ring = [];
    for (let i = -T; i <= T; i++) ring.push([i, -T]);
    for (let k = -T + 1; k <= T; k++) ring.push([T, k]);
    for (let i = T - 1; i >= -T; i--) ring.push([i, T]);
    for (let k = T - 1; k >= -T + 1; k--) ring.push([-T, k]);
    for (let gy = 0; gy < H; gy++)
      for (const [di, dk] of ring)
        cells.push({ i: cx + di, k: cz + dk, gy, c: gy === H - 1 ? pal[1] : pal[0] });
    // 一層一層縮的四坡頂，每層照蛇行（一排掃到底、下一排倒著回來），同 homeSlots
    for (let s = 0; s <= T; s++) {
      const q = T - s;
      for (let di = -q; di <= q; di++)
        for (let n = 0; n <= 2 * q; n++)
          cells.push({ i: cx + di, k: cz + (di % 2 ? q - n : -q + n), gy: H + s, c: pal[2] });
    }
    cells.push({ i: cx, k: cz, gy: H + T + 1, c: pal[0] });      // 旗桿
    cells.push({ i: cx, k: cz, gy: H + T + 2, c: pal[3] });      // 旗子
    out.push(wallSeg(cells, '角樓'));
  }
  /* 一段直牆（v1.186 改成 3 格厚的空心牆，使用者：「城牆看起來太單薄
     (可能到三層厚度 古代城牆上是能站人的)」）。剖面：

         外  中  內
         █  ▓  █   ← gy = WALL_H     走道鋪滿三格，外緣再立垛口
         █  ·  █
         █  ·  █   ← 中間是空的（同這個遊戲裡的房子與角樓，都是殼）
         █  ·  █

     實心要多三成塊數，而外面看起來一模一樣——會看到中空只有在被打穿的那一刻。
     「能站人」是**看起來**能站（使用者確認過）：走路判定還是平面的，小人不上牆。
     每一層沿著牆蛇行（一層掃到底、下一層倒著回來），理由同 homeSlots 沿周長生格子：
     小人是照順序認格子的，連號的兩格跳得遠就是在走路。
     內外兩面同一個位置連著生，那兩格只隔 2 格（< HOME_REACH），同一趟就砌得掉。
     垛口隔一格一個，照**世界座標**的奇偶決定，所以切了段也接得起來。 */
  const runCells = (a0, a1, fix, horiz) => {
    const cells = [];
    const side = fix > 0 ? 1 : -1;                     // 哪一側是城外
    const put = (a, d, gy, c) =>
      cells.push(horiz ? { i: a, k: fix + d, gy, c } : { i: fix + d, k: a, gy, c });
    const sweep = (gy, f) => {
      for (let n = 0; n <= a1 - a0; n++) f(gy % 2 ? a1 - n : a0 + n);
    };
    for (let gy = 0; gy < WALL_H; gy++)                // 內外兩面
      sweep(gy, a => { put(a, side, gy, pal[0]); put(a, -side, gy, pal[0]); });
    sweep(WALL_H, a => {                               // 頂上的走道
      put(a, side, WALL_H, pal[1]); put(a, 0, WALL_H, pal[1]); put(a, -side, WALL_H, pal[1]);
    });
    sweep(WALL_H + 1, a => {                           // 垛口：只立在外緣
      if (!(((a % 2) + 2) % 2)) put(a, side, WALL_H + 1, pal[1]);
    });
    return cells;
  };
  const addSide = (a0, a1, fix, horiz) => {
    if (a1 < a0) return;
    const n = Math.ceil((a1 - a0 + 1) / WALL_RUN), len = Math.ceil((a1 - a0 + 1) / n);
    for (let s = 0; s < n; s++) {
      const b0 = a0 + s * len, b1 = Math.min(a1, b0 + len - 1);
      if (b1 < b0) continue;
      out.push(wallSeg(runCells(b0, b1, fix, horiz), '城牆', horiz ? 'z' : 'x'));
    }
  };
  /* 四面各自切成「門樓左半 ＋ 門樓 ＋ 門樓右半」（v1.194）。直牆接在門樓的墩座外面
     （P+1 起算）：兩邊的外框剛好貼在一起、不重疊——疊在一起的兩個框會互推
     （見〈城牆踩到的四個坑〉①）。 */
  for (const [fix, horiz] of [[-W, true], [W, true], [-W, false], [W, false]]) {
    addSide(-end, -P - 1, fix, horiz);
    addSide(P + 1, end, fix, horiz);
  }
  for (const [fix, horiz] of [[-W, true], [W, true], [-W, false], [W, false]])
    out.push(gateTower(fix, horiz));
  for (const h of out) h.ring = W;      // 這一圈多大（見 inWall：誰在城裡、誰在城外）
  return out;
}
/* 場上這一圈城牆的半徑（沒有城牆就 0）。城牆是一段一段的，隨便問一段都行。
   **一幀只算一次**（同 homeOwners 的做法）：走路、挑站位、挑要撿哪一塊都在問它，
   而每問一次就要掃一遍 homes.list。 */
let wallR = 0, wallRAt = -1;
function wallNow() {
  if (wallRAt === frameNo) return wallR;
  wallRAt = frameNo; wallR = 0;
  if (homes) for (const h of homes.list) if (h.wall) { wallR = h.ring; break; }
  return wallR;
}
const inWall = (x, z) => {
  const W = wallNow();
  return W > 0 && Math.abs(x) < W && Math.abs(z) < W;
};
/* 這兩點被城牆隔開了嗎（一個在城裡、一個在城外）。**只是幾何**：它不知道牆蓋到哪裡。
   拿來當「要不要問下去」的廉價前篩（見 wallBlocked），不要單獨拿它當「走不走得過」。 */
const wallSplits = (x0, z0, x1, z1) => wallNow() > 0 && inWall(x0, z0) !== inWall(x1, z1);
/* 場上這一圈的每一段，一幀算一次（同 wallNow 的理由：每問一次就要掃一遍 homes.list）。
   這份清單跟個體無關，算一次給全場三十幾個個體共用。 */
let wallSg = null, wallSgAt = -1;
function wallList() {
  if (wallSgAt === frameNo) return wallSg;
  wallSgAt = frameNo; wallSg = [];
  if (homes) for (const h of homes.list) if (h.wall) wallSg.push(h);
  return wallSg;
}
/* 線段 (x0,z0)→(x1,z1) 有沒有穿過這個軸對齊的框（slab 法）。
   空框（x0 > x1，一塊都還沒砌，見 homeBox）一律不算擋——那時候地上什麼都沒有。 */
function segBox(x0, z0, x1, z1, bx0, bz0, bx1, bz1) {
  if (bx0 > bx1 || bz0 > bz1) return false;
  let t0 = 0, t1 = 1;
  const dx = x1 - x0, dz = z1 - z0;
  if (dx === 0) { if (x0 <= bx0 || x0 >= bx1) return false; }
  else {
    let a = (bx0 - x0) / dx, b = (bx1 - x0) / dx;
    if (a > b) { const t = a; a = b; b = t; }
    if (a > t0) t0 = a;
    if (b < t1) t1 = b;
    if (t0 > t1) return false;
  }
  if (dz === 0) { if (z0 <= bz0 || z0 >= bz1) return false; }
  else {
    let a = (bz0 - z0) / dz, b = (bz1 - z0) / dz;
    if (a > b) { const t = a; a = b; b = t; }
    if (a > t0) t0 = a;
    if (b < t1) t1 = b;
    if (t0 > t1) return false;
  }
  return true;
}
/* 這條直線**真的**被砌好的城牆擋住了嗎（v1.195）。
   在這之前問的是 wallSplits，而它只是「一點在方框內、一點在框外」——
   牆蓋到哪裡它完全不知道，第一段砌起來整圈方框就生效了。
   放大器：整圈城牆 3384 塊、第一輪只蓋得了 246 塊，**絕大多數時間那圈牆是七零八落的，
   程式卻一直當它是完整一圈**。使用者看到的就是這個：
   > 使用者：「猴子明明要走進城牆內 但是路過一段還沒蓋起來的地方 沒走過去 而是走到更遠的門」

   改成問**砌好的那幾格**：拿每一段已砌的外框（h.x0~h.z1，見 homeBox）跟這條線段
   做相交。門樓的外框含門洞，所以改拿門洞兩側那兩座墩座去比（門洞貫穿整個厚度，
   扣掉之後剛好剩左右兩塊）——門洞是真的走得過去的，同 footHome 的 h.gap。
   不必沿線取樣（pathClear 那一套）：城牆段都是軸對齊矩形、一圈才二十幾段，
   直接算線段／矩形相交又準又便宜。前篩擋掉同一側的那些之後，成本可以忽略。 */
function wallBlocked(x0, z0, x1, z1) {
  return wallSplits(x0, z0, x1, z1) && wallHit(x0, z0, x1, z1);
}
/* 這條線段撞不撞得到砌好的那幾格（門洞扣掉）。只算相交、不管兩端在哪一側——
   前篩是呼叫端的事：wallBlocked 篩「一內一外」，wallCut 篩「兩端都在城外」（v1.225 拆出來）。 */
function wallHit(x0, z0, x1, z1) {
  for (const h of wallList()) {
    if (!segBox(x0, z0, x1, z1, h.x0, h.z0, h.x1, h.z1)) continue;
    if (!h.gap) return true;
    const g = h.gap;
    if (g.x1 - g.x0 < h.x1 - h.x0) {          // 門洞窄的是 x 軸＝這一面沿 x 走
      if (segBox(x0, z0, x1, z1, h.x0, h.z0, g.x0, h.z1)) return true;
      if (segBox(x0, z0, x1, z1, g.x1, h.z0, h.x1, h.z1)) return true;
    } else {
      if (segBox(x0, z0, x1, z1, h.x0, h.z0, h.x1, g.z0)) return true;
      if (segBox(x0, z0, x1, z1, h.x0, g.z1, h.x1, h.z1)) return true;
    }
  }
  return false;
}
/* 兩端都在城外、直線卻切過城裡撞上砌好的牆（v1.225）。wallBlocked 的前篩是「一內一外」，
   這種它一律說不擋。先拿整圈的方框篩一次：這條線碰都沒碰到城，就不必一段一段比。
   v1.235 起它只剩「要不要先繞過城牆」的判斷（天災的 gateNeed 那幾處；v1.235 還有 buildWalk 開頭，v1.236 收掉）；
   怎麼繞交給巡路規則（見 navAim）。v1.195～v1.234 的 wallOpenSpot／crossNeed／crossStep
   （挑最近的開口、徑向出去沿圓弧轉過去再穿進去的三段繞）都收掉了——
   那一套在「城裡往對面城門外走」會在背後那一座門進進出出、永遠走不到（見 開發筆記〈巡路規則〉）。 */
function wallCut(x0, z0, x1, z1) {
  const W = wallNow();
  if (!W || inWall(x0, z0) || inWall(x1, z1)) return false;
  if (!segBox(x0, z0, x1, z1, -W, -W, W, W)) return false;
  return wallHit(x0, z0, x1, z1);
}
/* 這一段城牆跟「以場中心為圓心、半徑 r 的圓」碰到了沒有（v1.186）。
   換場要靠它決定舊城牆留不留：拿外接圓比的話（房子那條 hypot(h.x,h.z) − h.r），
   一段 16 格長的牆外接半徑就有 8，整圈每一段都會被判成「壓在新工地上」、每次換場全拆。 */
function wallHitsSite(h, r) {
  const x = Math.max(h.wx0, Math.min(0, h.wx1)), z = Math.max(h.wz0, Math.min(0, h.wz1));
  return x * x + z * z < r * r;
}
/* 找一塊空地：從這一組人現在站的方位往外找，避開已經蓋好的房子與樹。
   找不到就回 null（那一組人就照常閒晃，不硬塞）。
   capOut 給了就用它當外緣（v1.186，城內那幾間房子要留在牆裡面）。 */
function pickHomeSite(cx, cz, rad, capOut) {
  const base = Math.atan2(cz, cx);
  /* 內緣要把自己的地基半徑加進去（v1.100）：房子大了（最寬 12 格、地基半徑 9.6），
     只算中心的話整棟會壓進工地，下一座一開工就被徵收。 */
  const lo = siteR + HOME_NEAR + rad;
  const hi = capOut === undefined ? Math.max(lo + 4, homeOut()) : capOut;
  if (hi < lo) return null;                        // 城內太窄，這一間放不下
  for (let t = 0; t < 40; t++) {
    const a = base + rr(-HOME_ARC, HOME_ARC), r = rr(lo, hi);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    let ok = true;
    /* 隔多遠：至少 HOME_GAP，而且兩家的地基不能碰到（v1.99 起有圍籬大屋，
       地基半徑 6.7——固定 12 的話兩間會疊在一起）。
       城牆改用整段的外框比（v1.186）：它又直又長，外接圓半徑 8 以上，
       拿圓去比的話城內整片都會被判成「離牆太近」，一間都放不進去。 */
    for (const h of homes.list) {
      if (h.wall) {
        if (x > h.wx0 - rad - 1 && x < h.wx1 + rad + 1 &&
            z > h.wz0 - rad - 1 && z < h.wz1 + rad + 1) { ok = false; break; }
        continue;
      }
      if ((h.x - x) ** 2 + (h.z - z) ** 2 <
          Math.max(HOME_GAP, h.r + rad + 3) ** 2) { ok = false; break; }
    }
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
   **cat 說要找的是哪一種**（0＝房子、1＝樹、2＝城牆；v1.153 分出樹、v1.186 多了城牆，
   原本傳 0／1 的呼叫端一個字都沒改）：三種都在這份清單上，但蓋房子的那一批不該被
   派去接一棵蓋一半的樹（他還沒有家；接了就整輪都在種樹），反過來也一樣。
   taken 是這一次分派已經給人的，一間一組就好，其餘的人去開新的。
   **不能改成「都有人了就疊到同一間」**：這一輪剛開的新房子也是「還沒蓋完」，
   於是第二組之後全部併進第一間，一輪只蓋得出一間（實測 20 人 10 個離隊只蓋 1 間）。
   間數比組數多的時候會有一兩間排到下一輪，那是排隊、不是沒人管。 */
const homeCat = h => h.wall ? 2 : h.tree ? 1 : 0;
const NO_TAKEN = new Set();                        // 「誰都還沒被認走」：見 updHome 接下一段
function pickUnfinished(cx, cz, taken, cat) {
  let best = -1, bd = Infinity;
  for (let i = 0; i < homes.list.length; i++) {
    const h = homes.list[i];
    if (h.left <= 0 || taken.has(i) || homeCat(h) !== cat) continue;
    const d = (h.x - cx) ** 2 + (h.z - cz) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
function startHomes() {
  if (!homes) homes = { list: [] };
  const taken = new Set();
  const steady = w => !(w.air || w.burn > 0 || w.flee > 0 || w.fall > 0);
  /* 施工中只有偷懶的人參加（v1.134）：其他人在蓋地標。蓋完了（done／wreck）全場都算，
     那時候沒有「上工」這回事——偷懶的旗標只在施工中有意義。 */
  const joins = w => phase !== 'build' || w.lazy;
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
    if (w.own < 0 || !steady(w) || !joins(w)) continue;
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
    if (!steady(w) || w.own >= 0 || !joins(w)) continue;
    pool.push(i);
  }
  for (let i = pool.length - 1; i > 0; i--) {          // 洗牌
    const j = Math.floor(Math.random() * (i + 1));
    const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
  }
  /* 施工中偷懶的人**全部**參加（v1.134）：本來就只有一成的人，再砍一半常常只剩一個，
     那個事件就等於沒發生。蓋完了才照舊抽一半（HOME_PART 是使用者選的「一半左右」）。 */
  const part = phase === 'build' ? 1 : HOME_PART;
  const left = pool.slice(0, Math.max(1, Math.round(pool.length * part)));
  while (left.length) {
    const crew = takeCrew(left);
    let cx = 0, cz = 0;
    for (const w of crew) { cx += w.x; cz += w.z; }
    cx /= crew.length; cz /= crew.length;
    // 有沒有蓋不完的／破了洞的可以接手（見 pickUnfinished）。先修舊的再蓋新的
    let hi = pickUnfinished(cx, cz, taken, 0);
    if (hi >= 0) {
      /* 上一批人留下的認領要清掉：他們的 hm 早就被 stopHomes 抹了，
         那些格子沒人會去砌，留著的話 homeFree 會一直跳過它們，這間永遠差幾格。 */
      for (const sl of homes.list[hi].slots) if (!sl.filled) sl.claimed = -1;
    } else {
      // 款式要先挑：間距看的是兩家地基的大小（見 pickHomeSite）
      const kind = pickKind(HOME_KIND, crew.length);
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
  startTrees(taken);
}
/* 一組人：領頭的那個，再拉附近幾個一起蓋（使用者：「也可以跟附近的小人一起合蓋
   大一點的小房子」）。比的是現在站的位置——慶祝剛散場，所以「附近」就是圈上的鄰居。
   會從 left 裡把這一組人拿掉。 */
function takeCrew(left) {
  const lead = workers[left.shift()];
  const crew = [lead];
  for (let i = left.length - 1; i >= 0 && crew.length < HOME_TEAM; i--) {
    const o = workers[left[i]];
    if ((o.x - lead.x) ** 2 + (o.z - lead.z) ** 2 > HOME_NEARBY * HOME_NEARBY) continue;
    crew.push(o); left.splice(i, 1);
  }
  return crew;
}
/* 沒事的人抽幾個去種樹（v1.153，使用者：「閒置的小人有點多 增加一些小人去蓋樹」、
   「抽幾個沒事的人去蓋樹」）。接在房子那一批之後跑，所以「沒事」就是「這一輪沒被派到
   房子」（w.hm < 0）——已經有家、又沒有洞要補的人本來整輪都在閒晃，那就是使用者說的閒置。

   跟房子的三點差別：
     · **不設 w.own**：樹不是家。設了的話種過樹的人從此不再蓋房子（那條擋的是
       「已經有家的不要再開新的一間」，見上面），村子就不長了。
     · 棵數不靠「一人一棵」擋，靠塊數（TREE_BUDGET）——理由見那裡。
     · 蓋完之後照樣在自己種的那棵旁邊走走（updHome 那條共用的路，不必另外寫）。 */
function startTrees(taken) {
  const steady = w => !(w.air || w.burn > 0 || w.flee > 0 || w.fall > 0);
  const joins = w => phase !== 'build' || w.lazy;
  const free = [];
  for (let i = 0; i < workers.length; i++) {
    const w = workers[i];
    if (w.hm >= 0 || !steady(w) || !joins(w)) continue;
    free.push(i);
  }
  for (let i = free.length - 1; i > 0; i--) {          // 洗牌
    const j = Math.floor(Math.random() * (i + 1));
    const t = free[i]; free[i] = free[j]; free[j] = t;
  }
  let budget = TREE_BUDGET;
  for (const h of homes.list) if (h.tree) budget -= h.slots.length;
  const left = free.slice(0, Math.round(free.length * TREE_PART));
  while (left.length && budget > 0) {
    const crew = takeCrew(left);
    let cx = 0, cz = 0;
    for (const w of crew) { cx += w.x; cz += w.z; }
    cx /= crew.length; cz /= crew.length;
    let hi = pickUnfinished(cx, cz, taken, 1);         // 先接手種一半的，再種新的
    if (hi >= 0) {
      for (const sl of homes.list[hi].slots) if (!sl.filled) sl.claimed = -1;
    } else {
      const kind = pickKind(TREE_KIND, crew.length);
      const spot = pickHomeSite(cx, cz, treeR(kind));
      if (!spot) continue;                             // 沒空地了，這一組就照常閒晃
      const pal = TREE_PAL[Math.floor(Math.random() * TREE_PAL.length)];
      const slots = treeSlots(spot.x, spot.z, kind, pal);
      if (slots.length > budget) continue;             // 預算只夠再種小的，這一款先跳過
      budget -= slots.length;
      const at = new Map();
      slots.forEach((sl, i) => at.set(sl.i + ':' + sl.gy + ':' + sl.k, i));
      const h = { id: homeSeq++, x: spot.x, z: spot.z, r: treeR(kind), kind: kind.id, at,
                  ox: (kind.tw - 1) / 2, oz: (kind.tw - 1) / 2,   // 見 homeSolid
                  slots, left: slots.length, n: crew.length,
                  tree: 1, done: false };
      homeBox(h);
      markHomeF6(h);
      homes.list.push(h);
      hi = homes.list.length - 1;
    }
    taken.add(hi);
    for (const w of crew) {
      releaseWorker(w);
      w.hm = hi; w.hst = ''; w.pause = 0;              // w.own 不動：樹不是家
    }
  }
}
/* 事件二：蓋城牆把地標圍起來（v1.186）。
   **一圈只開一次**：場上還有城牆在的話，這一輪就是補牆 ＋ 把城內那幾間房子與樹補齊
   （整圈動輒兩千塊，一輪蓋不完是常態，見 開發筆記〈一圈要蓋多久〉）。

   跟事件一的差別：
     · 誰參加——站得穩的人**全部**，不管有沒有家（城牆不是誰的家，w.own 一律不動，同樹）
     · 每三組分一組去蓋城內的房子或樹，其餘全部上牆（城牆是主角，而且塊數是村子的好幾倍）
     · 蓋完一段自己接下一段（見 updHome），不站在牆邊發呆 */
function startWall() {
  if (!homes) homes = { list: [] };
  const taken = new Set();
  const steady = w => !(w.air || w.burn > 0 || w.flee > 0 || w.fall > 0);
  const joins = w => phase !== 'build' || w.lazy;
  const W = wallRing();
  if (!homes.list.some(h => h.wall)) {
    /* 擋在牆線上的小房子與樹**先拆成碎料**（v1.189，使用者：「應該蓋牆前就把小房子
       拆成碎料」）。v1.186~v1.188 是讓它嵌進牆裡（壓到的那幾格不生出來），
       實測那條路有兩個坑（見 開發筆記〈蓋牆前先把擋路的拆掉〉）：
         · 打光的殘骸外框是空的（homeBox 只框還站著的格子）→ 牆整段照蓋過去，
           之後有人回來接手補那間殘骸，231 格裡有 40 格跟牆的積木半格錯位互穿
         · 嵌進去的那間之後被打掉的話，少生的那 122 格永遠不會補回來
           （wallPlan 一圈只跑一次），牆線上就開一個十格寬的洞
       拆成碎料剛好接回原本的流程：那幾塊變成 FREE 躺在地上，小人撿去砌牆
       （等於「你家被徵收了」，同 clearHomesInSite）。 */
    const plan = wallPlan();
    const wSpan = plan.map(homeSpan);
    const blocked = h => {
      const b = homeSpan(h);
      return wSpan.some(w => b.x0 < w.x1 && b.x1 > w.x0 && b.z0 < w.z1 && b.z1 > w.z0);
    };
    dropHomes(h => !blocked(h));
    for (const h of plan) homes.list.push(h);
  }
  /* 城內要放幾間、幾棵：按**可用的環面積**算（使用者選的），扣掉已經在城裡的那些。
     內緣是房子的內緣（siteR + HOME_NEAR），外緣貼著牆內側。 */
  const area = Math.PI * Math.max(0, (W - 2) ** 2 - (siteR + HOME_NEAR) ** 2);
  let wantH = Math.min(WALL_IN_MAX, Math.round(area / WALL_IN_AREA));
  let wantT = Math.min(WALL_IN_TMAX, Math.round(area / WALL_IN_TAREA));
  for (const h of homes.list) {
    if (h.wall || Math.abs(h.x) > W || Math.abs(h.z) > W) continue;   // 城外的不算
    if (h.tree) wantT--; else wantH--;
  }
  const pool = [];
  for (let i = 0; i < workers.length; i++) {
    const w = workers[i];
    if (!steady(w) || !joins(w)) continue;
    pool.push(i);
  }
  for (let i = pool.length - 1; i > 0; i--) {          // 洗牌（同 startHomes）
    const j = Math.floor(Math.random() * (i + 1));
    const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
  }
  let nCrew = 0;
  while (pool.length) {
    const crew = takeCrew(pool);
    let cx = 0, cz = 0;
    for (const w of crew) { cx += w.x; cz += w.z; }
    cx /= crew.length; cz /= crew.length;
    let hi = -1;
    if (++nCrew % 3 === 0 && (wantH > 0 || wantT > 0)) {
      const tree = wantH <= 0;
      hi = wallInside(crew, cx, cz, tree, W);
      if (hi >= 0) { if (tree) wantT--; else wantH--; }
    }
    if (hi < 0) {
      hi = pickUnfinished(cx, cz, taken, 2);
      // 每一段都有人了就疊上去：一段十六格長，兩三組人各認各的格子不會打架
      if (hi < 0) hi = pickUnfinished(cx, cz, NO_TAKEN, 2);
      if (hi < 0) continue;                            // 整圈都蓋完了：這一組照常閒晃
      for (const sl of homes.list[hi].slots) if (!sl.filled) sl.claimed = -1;
    }
    taken.add(hi);
    const h = homes.list[hi];
    for (const w of crew) {
      releaseWorker(w);                                // 手上的建材先放掉，這趟不是上工
      w.hm = hi; w.hst = ''; w.pause = 0;
      if (!h.wall && !h.tree) w.own = h.id;            // 城內那幾間是真的家（同事件一）
    }
  }
}
/* 城內的一間房子或一棵樹。回傳 homes.list 的索引，放不下就 −1。
   蓋法、外型、被破壞的規則全部沿用事件一那一套，差別只有「外緣貼著城牆內側」。 */
function wallInside(crew, cx, cz, tree, W) {
  const tab = tree ? TREE_KIND : HOME_KIND;
  const rOf = k => tree ? treeR(k) : homeR(k);
  /* 先把放不下的款式濾掉再抽。城內可用的那一圈常常很窄（內緣 siteR + HOME_NEAR、
     外緣貼著牆內側），小地標更是只剩幾格寬——不濾的話抽到大屋就整組空手回去，
     實測 20 人跑一輪城內一間都沒有（兩組都抽到放不下的款式）。 */
  const fit = tab.filter(k => siteR + HOME_NEAR + rOf(k) <= W - 2 - rOf(k));
  if (!fit.length) return -1;
  const kind = pickKind(fit, crew.length);
  const rad = rOf(kind);
  const spot = pickHomeSite(cx, cz, rad, W - 2 - rad);
  if (!spot) return -1;
  const pal = tree ? TREE_PAL[Math.floor(Math.random() * TREE_PAL.length)]
                   : HOME_PAL[Math.floor(Math.random() * HOME_PAL.length)];
  const slots = (tree ? treeSlots : homeSlots)(spot.x, spot.z, kind, pal);
  const at = new Map();
  slots.forEach((sl, i) => at.set(sl.i + ':' + sl.gy + ':' + sl.k, i));
  const w0 = tree ? kind.tw : kind.w, d0 = tree ? kind.tw : kind.d;
  const h = { id: homeSeq++, x: spot.x, z: spot.z, r: rad, kind: kind.id, at,
              ox: (w0 - 1) / 2, oz: (d0 - 1) / 2,            // 見 homeSolid
              slots, left: slots.length, n: crew.length,
              tree: tree ? 1 : 0, done: false };
  homeBox(h);
  markHomeF6(h);
  homes.list.push(h);
  return homes.list.length - 1;
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
  /* 城牆用整段的外框比（v1.186，見 wallHitsSite）：它又直又長，拿外接圓比的話
     每換一座地標就整圈拆掉重蓋。這樣一來換到比較小的地標時，上一座留下的城牆
     就照舊站在那裡（那是已經蓋好的城，沒有理由自己倒）；換到更大的、牆會切進
     新工地的那幾段才解成碎料。 */
  dropHomes(h => h.wall ? !wallHitsSite(h, r) : Math.hypot(h.x, h.z) - h.r > r);
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
  /* 城牆的直牆段：挖料點**貼著那一段自己的外框**，沿牆那一軸取「他投影過去的那一點」，
     垂直方向取他現在站的那一側（v1.190.1，見 開發筆記〈挖出來的料自己撿不到〉）。
     v1.186 是「繞著他自己挖」（cx/cz 就是 w.x/w.z），為的是不要讓他為了一塊料走到
     十六格長的牆的另一頭去——但那條路跟「找料的範圍綁在建物上」（homeNear：離段中心
     h.r + GRAB_R，城牆一段約 20 格）打架：人被派到二十格外的那一段時，他在原地挖出來的
     料全部落在自己搆不到的範圍外，freeNearHome 挑不到、digNeed 也不算它，於是再挖一趟、
     再撿不到——而小人只有手上有料才會走向工地（layTrip），找料這一步沒有任何力量把他
     拉向牆。實測金門大橋（牆半徑 94）六分鐘：挖出來的 2798 塊裡 687 塊當場就撿不到，
     其中 622 塊是三個人挖的，最長連續 233 趟沒挖對過，他們那三段一塊都沒砌。
     投影過去就同時解決兩件事：他第一趟就往牆走（那是上工的路），而挖出來的料離段中心
     最多十一格，一定在 GRAB_R 以內。 */
  if (h.thin) {
    const zx = h.thin === 'z';                             // 薄的是 z 軸＝這一段沿 x 延伸
    const lo = zx ? h.wx0 : h.wz0, hi = zx ? h.wx1 : h.wz1;          // 沿牆那一軸的兩端
    const p0 = Math.min(Math.max(zx ? w.x : w.z, lo), hi);           // 他投影到這一段上的那一點
    const side = zx ? w.z > h.z : w.x > h.x;               // 他在哪一側就挖哪一側（同 homeStand）
    const out = zx ? h.wz1 : h.wx1, back = zx ? h.wz0 : h.wx0;
    for (let t = 0; t < 20; t++) {
      const p = Math.min(Math.max(p0 + rr(-DIG_FAR, DIG_FAR), lo), hi);
      const d = rr(DIG_NEAR, DIG_FAR);
      const q = side ? out + d : back - d;
      const x = zx ? p : q, z = zx ? q : p;
      if (Math.hypot(x, z) < siteR + KEEP) continue;
      if (homeAt(x, z)) continue;
      w.tx = x; w.tz = z; w.hdt = DIG_T; return;
    }
    const q = side ? out + DIG_NEAR : back - DIG_NEAR;
    w.tx = zx ? p0 : q; w.tz = zx ? q : p0; w.hdt = DIG_T;
    return;
  }
  /* 挖的地方取在「他現在站的那一側」，不是整圈亂挑（v1.100）。
     房子大了之後（地基半徑可以到 9.6），亂挑的話一趟裡「走去挖」跟「走回去砌」
     常常在房子的兩頭，而繞過去就是半圈——實測六成的時間花在走路上。
     同一側就只是幾步；砌的位置自己會隨格子進度繞房子跑，挖料點跟著他跑就好。 */
  const cx = h.x, cz = h.z, rad = h.r;
  const a0 = Math.atan2(w.z - h.z, w.x - h.x);
  for (let t = 0; t < 20; t++) {
    const a = a0 + rr(-DIG_ARC, DIG_ARC);
    const d = rad + rr(DIG_NEAR, DIG_FAR);
    const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
    if (Math.hypot(x, z) < siteR + KEEP) continue;
    if (homeAt(x, z)) continue;
    w.tx = x; w.tz = z; w.hdt = DIG_T; return;
  }
  w.tx = cx + rad + DIG_NEAR; w.tz = cz; w.hdt = DIG_T;
}
/* 用鏟子挖出一塊來，讓它蹦到地上（v1.129，使用者：「先用鏟子挖出積木 動作完成後
   積木在地面上（這樣就能去撿了）」）。回傳「挖到了沒有」。
   跟 v1.128 的差別是**不直接放到手上、也不當場認格子**：出土之後它就是一塊躺在地上的
   碎料，等他自己走過去撿（撿的那一下才認格子，見 takeHomeBlock）——所以「地上的碎料
   優先」那條規則自然就把它撿起來了，不必另開一條路；一趟挖幾塊也就跟手上拿幾塊分開了。
   積木是**新生出來的**，不是從料池拿的——完工那一刻場上通常一塊散料都沒有
   （料池 = 藍圖格數，見 reconcilePool），從料池拿等於把下一座的建材偷走。
   落地、彈跳、轉正都是碎料本來就有的那一套（stepBlock／stepSnap），這裡只給初速。
   own（v1.141）：1＝村子自己挖的（蓋房子用的料，見 homeMine），0＝工地缺料挖的
   （那是這一座的建材，施工中村子不能收回去蓋房子，見 digSite）。 */
function digBlock(w, own) {
  if (blocks.length >= ENG.MAXB) return false;           // 池子滿了（見 engine.js 的 MAXB）
  const g = digPoint(w);                                 // 鏟尖插進地面的那一點
  const gx = g.x, gz = g.z;
  const b = newBlock();
  b.x = gx; b.z = gz; b.y = HB;
  b.dug = own;                                           // 村子自己挖的？（v1.134，見 homeMine）
  b.fresh = own;                                         // 落地時彈進工地圈就推出去（見 separate）
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
  spawnMark({ x: gx, y: 0, z: gz }, DIG_MARK, 1);        // 挖過的土痕（跟鐵球的坑同一套）
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
  if (!h.tree || sl.gy <= TREE_DUCK) {           // 樹冠不進外框，理由同 homeBox
    if (sl.x - 0.5 < h.x0) h.x0 = sl.x - 0.5;
    if (sl.x + 0.5 > h.x1) h.x1 = sl.x + 0.5;
    if (sl.z - 0.5 < h.z0) h.z0 = sl.z - 0.5;
    if (sl.z + 0.5 > h.z1) h.z1 = sl.z + 0.5;
  }
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
  if (w.show || w.pause > 0) { idleWait(w, dt); return; }
  if (!strollTo(w, dt)) return;
  strollPause(w);
  rollShow(w);                      // 在自家門口也會來一段（v1.178，同 wander）
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
     （idleSpot 取的是場上任一處），於是他會走到別的地方去——實測有人跑到離自己家
     38 格遠。手上還有貨的例外：那幾格還算在 h.left 裡，所以這裡不會擋到砌完最後幾塊。 */
  if (h.left <= 0 && !w.load.length) {
    w.hst = '';
    /* 城牆蓋完一段就自己去接最近的下一段（v1.186）：整圈是切成十幾段的，
       蓋完就站在牆邊過日子的話，一輪只推得動幾段。整圈都好了才回去閒晃。 */
    if (h.wall) { w.hm = pickUnfinished(w.x, w.z, NO_TAKEN, 2); return; }
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
    /* 站位：從屋子中心往那一格的方向推到地基外（跟工人同一套，見 homeStand）。 */
    const g = homeStand(h, sl, w, MAGE_HOME);
    w.tx = g.x; w.tz = g.z;
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
    /* 魔法師的「挖」就是隔空從地面拉一塊新的出來，跟 digBlock 一樣是憑空多出來的塊，
       所以一樣蓋記號（v1.134，見 homeMine）：不蓋的話這一間被打爛之後，
       那些碎料在下一座施工中就再也撿不回來（村子只認得自己的料）。 */
    b.dug = 1;
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
/* 這一塊算不算「村子自己的料」（v1.134）。**施工中只認自己挖出來的**：地上其他那些是
   地標的建材，而料池剛好只夠蓋完那一座（reconcilePool 補到 bp.slots.length），
   撿走一塊那座就永遠差一格、永遠不會完工。挖出來的是憑空多出來的新塊（見 digBlock），
   拿去蓋房子不影響地標。蓋完了（done／wreck）沒有這個顧慮，照舊地上的優先
   （v1.104 使用者指定）。
   b.dug 在被地標認走時歸零（見 loadUp）：那一塊從此算地標的料池，村子不能再收回去。 */
const homeMine = b => phase !== 'build' || b.dug;
function homeNear(b, h) {
  return (b.x - h.x) ** 2 + (b.z - h.z) ** 2 <= (h.r + GRAB_R) ** 2 &&
         b.x * b.x + b.z * b.z >= (siteR + KEEP) ** 2;
}
function freeNearHome(w, h) {
  let best = -1, bd = Infinity;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.st !== FREE || !b.rest || b.holder >= 0) continue;
    if (!homeNear(b, h) || !homeMine(b)) continue;
    /* 城牆的一段橫跨城裡城外，所以要擋掉「在牆另一邊」的那些（v1.186）：
       認了走不到（牆擋著），而他認定一塊就不放——那個人會舉著空手對著牆磨到這一輪結束。
       實測不擋的話整圈砌到七成就幾乎停擺、十一個人卡在牆邊。 */
    if (wallBlocked(w.x, w.z, b.x, b.z)) continue;
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
function digNeed(w, h) {
  let n = 0;
  for (const sl of h.slots) if (!sl.filled && sl.claimed < 0) n++;
  if (n <= 0) return 0;                                  // 格子全被認走了：不必掃積木
  for (const b of blocks) {
    if (b.holder >= 0) continue;
    if (b.st === FREE ? !b.rest : b.st !== FLY) continue;
    if (!homeNear(b, h) || !homeMine(b)) continue;
    if (wallBlocked(w.x, w.z, b.x, b.z)) continue;       // 牆另一邊的撿不到（同 freeNearHome）
    if (--n <= 0) return 0;
  }
  return n;
}
/* 要去撿的那一塊躺在自己家的外框裡：站到**最近的那一面**外面伸手拿。
   回傳同一個暫存物件（每幀都會叫）。 */
const _gs = { x: 0, z: 0 };
function grabStand(h, bx, bz) {
  _gs.x = bx; _gs.z = bz;
  /* 城牆的直牆段只往厚度那一軸站出去（v1.186，同 pushOutHome 的理由）：
     照四面挑最近的話，掉在兩段接縫附近的那一塊會把人叫到牆身裡面去站。 */
  if (h.thin === 'z') {
    _gs.z = bz - h.z0 < h.z1 - bz ? h.z0 - HOME_STAND : h.z1 + HOME_STAND;
    return _gs;
  }
  if (h.thin === 'x') {
    _gs.x = bx - h.x0 < h.x1 - bx ? h.x0 - HOME_STAND : h.x1 + HOME_STAND;
    return _gs;
  }
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
     v1.235 以前 buildWalk 對搬料那條路也是這樣扣（v1.236 起搬料走 walkTo，本來就不記里程）。不扣掉的話，蓋一間房子來回幾十趟的里程
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
  if (w.dug < w.hcap && digNeed(w, h) > 0 && digBlock(w, 1)) {
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
/* 要砌這一格的話站到哪裡去（v1.186 抽出來共用，工人與魔法師都走這支）。
   **房子與樹**：從中心往那一格的方向推到地基外。
   屋頂正中央那一格 dx/dz 都是 0（3×3 的房子就有一格在正中心），那時候改用
   「他現在站的方向」——不然目標會落在屋子正中心，人一走進去就被 pushOutHome 推出來，
   永遠抵達不了，那一格也就永遠砌不上（實測 6 間有 2 間卡住）。
   推的距離要大於「走到多近算抵達」（REACH 0.9），不然他站定的位置可能還在屋裡。
   **城牆的直牆段**（h.thin）：那一段又直又長（16 格，外接半徑 8），照上面那樣推的話
   人會被推到離牆八格外、或者推到牆的兩頭去。改成走到那一格旁邊、站在**整段牆的外框外**，
   **他現在在哪一側就站哪一側**（繞到另一側要走一整段牆）。
   **站位要看整段的框，不是那一格**（v1.186 踩過）：牆是 3 格厚的，照「那一格 ±1.9」算的話，
   砌外面那一面時站位會落在牆身裡——每一幀被 pushOutHome 推開、於是永遠「還沒抵達」，
   那個人就舉著積木在牆邊原地震盪。實測第 9 分鐘起有 5～8 個人是這樣卡著的，
   整圈砌到七成五就幾乎停擺。 */
const _hst = { x: 0, z: 0 };
function homeStand(h, sl, w, pad) {
  const set = (x, z) => { _hst.x = x; _hst.z = z; return _hst; };
  if (h.thin === 'z') return set(sl.x, w.z > h.z ? h.wz1 + pad : h.wz0 - pad);
  if (h.thin === 'x') return set(w.x > h.x ? h.wx1 + pad : h.wx0 - pad, sl.z);
  let dx = sl.x - h.x, dz = sl.z - h.z;
  let d = Math.hypot(dx, dz);
  if (d < 0.001) { dx = w.x - h.x; dz = w.z - h.z; d = Math.hypot(dx, dz) || 1; }
  const a0 = Math.atan2(dz, dx), r = h.r + pad;
  /* 算出來的站位站不住（落在別的東西的框裡、或者跟他之間隔著城牆）就繞著這一間轉，
     找第一個站得住的角度（v1.186）。角樓就是這樣：它的站位正好落在接上去的那一段
     牆身上，人走過去會被 pushOutHome 推開、於是永遠「還沒抵達」——實測 11 個人
     舉著積木卡在四個角樓旁邊，整圈停在七成一不動。房子與樹走的是第一個角度，
     跟以前一模一樣。 */
  const try_ = a => {
    const x = h.x + Math.cos(a) * r, z = h.z + Math.sin(a) * r;
    return !footHome(x, z) && !wallBlocked(w.x, w.z, x, z) ? set(x, z) : null;
  };
  const p0 = try_(a0);
  if (p0) return p0;
  for (let k = 1; k <= 4; k++) {
    const p = try_(a0 + k * 0.7) || try_(a0 - k * 0.7);
    if (p) return p;
  }
  return set(h.x + Math.cos(a0) * r, h.z + Math.sin(a0) * r);   // 都站不住：照原本那一點
}
function layTrip(w, h, dt) {
  carryPose(w);
  const b0 = blocks[w.load[0].b];
  const sl = b0 && b0.hh === w.hm ? h.slots[b0.hk] : null;
  if (!sl) { dropJob(w, 0); return; }
  const g = homeStand(h, sl, w, HOME_STAND);   // 站在格子外面丟，不走進牆裡（見 homeStand）
  w.tx = g.x; w.tz = g.z;
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
  if (hardAt(b.x, b.y, b.z)) { layTrip(w, h, dt); return; }
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

