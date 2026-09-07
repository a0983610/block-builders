/* ============================================================
   遊戲層 · 破壞道具與各種特效
   從 game.js 拆出來的一段（v1.120.1）。classic script、共用同一份全域 scope，
   跟原本寫在同一支檔裡完全等價；五支的分工與載入順序見 src/game.js 檔頭。
   ============================================================ */
'use strict';

/* ── 破壞道具 ─────────────────────────────────────────────
   三種都走同一個出口 breakBlock()，差別只在「哪些積木被選中、給什麼速度」。 */
/* 解鎖階梯：兩種紀錄輪流當門檻（擊飛數／拆除座數），兩邊都得推進才走得完。
   難度定在「大約拆一座建築開一格」：建材用預設的 3000 塊時，一座拆到換場門檻
   （剩 WRECK_AT＝25% 就算拆完）至少會擊飛 2,250 塊，所以擊飛那一側就照
   1／3／5／7／9 座換算成 2,000／6,000／11,000／15,000／19,000，
   拆除那一側直接寫 2／4／6／8／10 座——十格走完大約就是十座。
   v1.117 加的兩把照同一把尺往上接：擊飛那側 23,000（第 11 座），拆除那側 12 座，
   十二格走完大約就是十二座。
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
    tip: '點兩下：先點龍捲風出現的地方，再點要掃過去的方向（會一路亂竄 10 秒，罩到的建築每秒吸走七成）',
    lock: { txt: '拆掉 4 座建築解鎖', ok: () => stats.destroyed >= 4 } },
  { id: 'fw', n: '煙火', k: '🎆',
    tip: '點地面：一次射三發煙火，落下來的火星會把建築點著；點在建築上就從那一點射上去',
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
    lock: { txt: '拆掉 10 座建築解鎖', ok: () => stats.destroyed >= 10 } },
  { id: 'storm', n: '打雷', k: '⚡',
    tip: '點地面：那裡慢慢聚出一朵烏雲，接著隨機劈 5～7 道雷，劈中的地方炸出一個小缺口並燒起來',
    lock: { txt: '累計擊飛 23,000 塊解鎖', ok: () => stats.smashed >= 23000 } },
  { id: 'drop', n: '天降鐵球', k: '⚫',
    tip: '點地面：一顆鐵球從正上方直直砸下來，撞爛沿路的積木，不再動就收掉',
    lock: { txt: '拆掉 12 座建築解鎖', ok: () => stats.destroyed >= 12 } },
  { id: 'gate', n: '王之財寶', k: '🗡',
    tip: '點兩下：第一下點地面決定門陣開在哪，第二下決定打哪裡——點在建築上就打那個位置附近的一片空間，點地面就打建築下段。兵器從門裡伸出來、就位後停一下，接著朝目標連射 7 秒；打中的地方炸開一個小缺口（不起火），兵器掉在地上慢慢消失',
    lock: { txt: '累計擊飛 27,000 塊解鎖', ok: () => stats.smashed >= 27000 } },
  { id: 'sword', n: '大劍', k: '⚔',
    tip: '點兩下：其中一下要點在建築上（那一下的高度就是劍柄旋轉點的高度）。一把大劍在「兩點與劍柄決定的那個斜面」上從第一點揮向第二點——點建築的高、點地面的低，就是斜著砍下去。刃掃過的那一片整片削掉、被切斷的部分接著自己垮；揮完原地化成金光淡掉',
    lock: { txt: '拆掉 14 座建築解鎖', ok: () => stats.destroyed >= 14 } }
];
const toolOk = t => !t.lock || t.lock.ok();
/* 這幾種點空地也算數：它們的用法就是「選一個地點」，
   規定一定要點到建築的話，站在旁邊的空地放炸彈反而做不到。
   大槌點空地是地震、保齡球點空地是從那裡把球丟出去，所以也在這裡。
   小槌點空地什麼都不會掉，但仍然留在這裡：拿掉的話那一下完全沒反應，看起來像點壞了。 */
/* 大劍也在這裡：它兩下之中**只要一下**點在建築上就夠（另一下點空地是正常用法，
   那一下決定的是揮擊的起點或終點，不是高度）。 */
const GROUND_TOOL = { hammer: 1, bighammer: 1, ball: 1, tornado: 1, treb: 1, fw: 1,
                      bomb: 1, meteor: 1, nuke: 1, magic: 1, bucket: 1,
                      storm: 1, drop: 1, gate: 1, sword: 1 };
let tool = 'hammer';

let hammerR = 5.5, hammerPow = 15;
let swing = null;     // 正在揮下去的槌子
let balls = null;     // 在場的鐵球（可以同時好幾顆，v1.116）
let twists = null;    // 作用中的龍捲風（可以同時好幾道）
let bombs = null;     // 已放下、倒數中的定時炸彈
let meteors = null;   // 已呼叫的隕石（倒數或下墜中，可以好幾顆）
let nukes = null;     // 已呼叫的核彈（倒數或下墜中，可以好幾顆）
let magics = null;    // 正在展開的魔法陣（可以好幾個）
let storms = null;    // 正在打雷的烏雲（可以好幾朵）
let gates = null;     // 正在發動的王之財寶（同時最多三組，見 castGate）
let weapons = null;   // 場上所有兵器：門裡待發、飛行中、翻滾中、躺在地上的（v1.132）
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
  /* 震倒的判定高度也要算（v1.147，使用者：「炸彈炸在屋頂、槌子砸在高處，
     下面的人不被震倒」）。以前只取水平距離，所以天降鐵球還在四十層樓高
     鑿樓板的時候，地面那一圈人就先倒了（實測球還在 44.2 高，落地是 0.85 秒後）。
     0.9 是胸口高度，同 stepBall 那段。 */
  for (const w of workers) {
    if (w.air || w.burn > 0) continue;                // 正在飛／正在燒的不用再掀一次
    const dy = (point.y || 0) - (w.y || 0) - 0.9;     // 衝擊點在他胸口上方多高
    if (Math.hypot(w.x - point.x, dy, w.z - point.z) < R * 1.7 && w.fall <= 0) {
      w.fall = rr(1.1, 2.3); releaseWorker(w); sndFall();
    }
  }
  /* 那幾隻生物同樣被震倒（v1.146）；飛龍被震到就是從天上摔下來（見 crashDragon）。 */
  eachBeastNear(point, R * 1.7, m => {
    if (m.air || m.burn > 0 || m.fall > 0) return;      // 正在飛／正在燒的不用再掀一次
    if (fellBeast(m, rr(B_FALL[0], B_FALL[1]))) sndFall();
  });
  shakeTrees(point, R);
  markSupportDirty();
  checkBadges();
}

/* 槌子：點狀衝擊。只有衝擊球內的積木會散，球外的原封不動；
   方向來自滑鼠射線，所以從上面砸跟從側面砸，塌的方式不一樣。 */
/* quiet：不要震畫面。給投石機用的——它一台連丟好幾顆、還能架好幾台，
   每一顆都晃一下的話畫面會一路抖到它撤走（見 rockHit）。 */
/* hush＝這一下不出聲（v1.132 為王之財寶加的）。它七秒射一百九十幾發、其中九十幾發
   打中建築，每一發都放 sndSmash 的話是一秒十幾聲爆裂噪音疊在一起；那一把自己有
   一聲短促的小爆炸（sndGateHit），所以把這裡的聲音讓給它。
   quiet 管的是**畫面震動**、hush 管的是**聲音**，兩件事分開給：
   投石機與雷是「不震但要響」，王之財寶是兩個都不要。 */
function smash(point, dir, R0, pow0, quiet, hush) {
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
  if (!hush) sndSmash();
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
/* 連小人的家也算固體（v1.135）。blockAt 只認地標藍圖的格子表，房子不在裡面
   （房子自己帶一份格子清單，見 game-workers.js 的 homes）——水那條路 v1.103 已經踩過同一件事
   （見 solidAt）。破壞本身本來就打得到：smash 只看 st === SET，房子的積木照樣敲得掉，
   缺的只有「撞到了沒」這一半。
   那個聯集 v1.158.1 起收在 game-workers.js 的 hardAt（定義擺在 homeSolid 旁邊，
   因為它要用到那一支），這裡直接用。 */
/* 掃掠判定用的「固體」。預設只認地標藍圖的格子表（blockAt），要連小人的家一起認的
   自己傳一支進來（見 hardAt）。 */
function sweepRock(r, px, py, pz, solid) {
  const at = solid || blockAt;
  if (at(r.x, r.y, r.z)) return true;           // 這一幀停的位置本身就埋在積木裡
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
    if (at(px + ux * t, py + uy * t, pz + uz * t)) {
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
/* 最多同時幾顆（v1.116，使用者：「保齡球可以多顆（目前如果前一顆球還在滾，
   再用一次保齡球，前一個會消失）」）。以前是一個 ball 變數，第二顆一出手就把第一顆
   蓋掉——球還在滾就整顆憑空不見。現在跟龍捲風同一套：一份清單、滿了把最早那顆擠掉。
   **要跟引擎那邊的 MAXBALL 一樣大**，小於它才不會有球算得到卻畫不出來。
   6 顆的理由：每顆每幀都要掃一次整池積木（同龍捲風），實測 6 顆 ＋ 一萬五千塊
   仍在每幀預算內（見 README〈保齡球可以同時好幾顆〉）。 */
const BALL_MAX = 6;
/* 撞到東西之後掉速多少（每一幀、每撞一塊）。v1.123 放鬆（使用者：「稍微降低碰撞後
   動能減弱的幅度」）：每塊 0.006 → 0.0042、單幀下限 0.3 → 0.42。
   空場上滾得多遠不受影響（那是 BALL_ROLL 在管），變的是「鑿進建築之後還推得動多少」。
   實測從場邊丟過整座新天鵝堡 3000（每組 10 趟取平均，只算真的撞到的那幾趟）：
     正中央　滾過的路 60.9 → 67.1、撞到之後往前推到 x −9.2 → −3.2、打掉 263 → 351 塊
     擦邊 z=±7　滾過的路 74.6／84.0 → 95.6／102.7、往前推到 x 4.6／14.0 → 25.1／32.1
   天降鐵球維持原值：它的水平速度是被積木彈起來時帶的那一點，放鬆之後會一路飄出去，
   不是這次要改的。 */
const BALL_BRAKE = 0.0042, BALL_BRAKE_MIN = 0.42;
/* 撞到東西要偏一下方向（v1.123，使用者：「水平移動的碰撞參考 天降鐵球 也要計算
   碰撞後偏移方向」）。跟天降鐵球取**同一個接觸法線**（hx, hz ＝ 這一幀撞到的每一塊
   指向球心的單位向量總和），差別在保齡球是「貼地滾」不是「砸下去彈開」，所以三件事不同：
   ① 不動垂直速度，只轉水平方向。
   ② **只取法線垂直於行進方向的那一半**。法線正對著球（正面撞上一整面牆）時整個加上去
      等於再踩一次煞車，而減速已經有 brake 那條在管了——這一條要的是
      「擦到左邊就往右偏」，不是「撞到就慢下來」。
   ③ **用轉角不是加速度**。天降鐵球那邊是把法線速度直接加上去，它撐得住是因為
      一幀只咬到十幾塊；保齡球一幀常常撞上百塊，同樣寫法會把球整顆彈飛。
      轉角還有一個好處：轉不改變速度大小，所以「掉多少速」仍然只由 brake 決定。
   轉多少：撞越多轉越多（n / BALL_VEER_N 封頂），滿額是每秒 BALL_VEER 弧度。 */
const BALL_VEER = 2.6;              // 滿額時每秒轉幾弧度（約 149°／秒）
const BALL_VEER_N = 40;             // 這一幀撞掉幾塊算滿額
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
  if (!balls) balls = [];
  if (balls.length >= BALL_MAX) balls.shift();     // 放太多顆就把最早那顆擠掉（同龍捲風）
  balls.push({
    x: from.x, y: BALL_R + BALL_DROP, z: from.z,
    vx: Math.cos(a) * 34, vz: Math.sin(a) * 34, vy: rr(-3, -0.5),   // 是往下丟不是往上拋
    r: BALL_R, ang: 0, hit: 0, life: BALL_LIFE, hops: 0,
    // 滾動軸（水平、垂直於前進方向）。畫的時候直接讀這兩個，見 ENG.putBalls
    ax: Math.sin(a), az: -Math.cos(a)
  });
  aim = null;
  sndSwing();
}
/* 天降鐵球（v1.117，使用者：「點擊地面 與地面垂直 落下一顆鐵球（碰撞 參考保齡球
   只是從天而降 不再移動後消失）」）。
   「碰撞參考保齡球」就照字面做：跟保齡球共用同一份 balls 清單、同一支 stepBall
   ——同一套掃描、同一組撞擊力、同一份顆數上限（BALL_MAX），畫面那邊也是同一顆
   InstancedMesh，不必為它多開一種東西。差別只有兩點，都掛在 drop 這個旗標上：
   ① 出手沒有水平速度，純自由落體（「與地面垂直」）；
   ② 落地幾乎不彈——鐵球不是橡皮球，而且彈太久就不符合「不再移動後消失」。
   一路上撞到的積木都算（球每幀移動 2.7 單位，小於它的判定半徑 3.8，不會整層穿過去）。 */
/* 從多高開始掉。v1.119 起跟著建築走（同烏雲），使用者：「天降鐵球 初始高度也能像
   烏雲一樣 根據建築高度 有些建築很高 導致鐵球在建築中間位置高度落下」——固定 58 的話，
   高一點的地標（大笨鐘 9000 塊有 138 高）等於直接生在建築腰上，從裡面往外炸，
   完全沒有「從天上砸下來」那一段。
   高過屋頂 26：那段落差決定砸到屋頂時多快（36.8 單位／秒）也決定看得到它掉多久
   （1.4 秒）。固定值而不是按比例，砸到屋頂的力道才不會因建築高矮而不同。
   量過畫面上緣大約在建築高度的 1.3 倍，所以起點最多只高出畫面 9 單位
   （帝國大廈 3000）、最高的大笨鐘 9000 反而整段都在畫面內；球掉得快，
   進畫面只差那一瞬間，所以不像烏雲那樣需要把鏡頭退開。 */
const DROP_TOP = 58;                // 矮建築的下限（維持 v1.117 的手感）
const DROP_UP = 26;                 // 高過屋頂多少
const DROP_BOUNCE = 0.22;           // 落地回彈保留多少垂直速度（保齡球是 0.42）
/* 撞到東西要彈起來（v1.118，使用者：「少了鐵球撞到東西彈起來的感覺（目前就一路
   摧毀直直落下 可以撞到破壞後彈起來一點撞到其他位置）」）。
   門檻是「這一幀撞掉幾塊」：實測 60fps 直直落下時，帝國大廈那根天線一幀只碰到 1 塊、
   真正的樓板是 10～27 塊（金字塔 12、競技場 12、凱旋門 12 都是中位數）。
   收在 DROP_BITE＝10 就是「擦過細桿子不算，砸到一片實的才算」。
   彈起來的高度**直接指定**、不照反射算：照反射算的話砸得越快彈得越高，
   從 58 掉下來那一下會把球射出場外（第一版就是這樣，實測橫向跑了 30～87 單位、
   只撞掉 10 塊就飛走了，反而不摧毀了）。 */
const DROP_BITE = 10;               // 這一幀撞掉幾塊才算「砸到一片實的」
const DROP_POP = 3.6;               // 第一下彈多高（換算成 v = √(2gh)）
const DROP_AWAY = 5;                // 第一下往旁邊帶多少速度
const DROP_DECAY = 0.62;            // 每彈一次高度與橫移各乘這個——彈幾次就沒力了
/* 最多彈幾次。遞減到後面只剩十幾公分的碎跳，球會賴在屋頂上磨到壽命結束、
   在半空中憑空消失，連落地那個坑都留不下（實測凱旋門八次裡有一次是這樣）。
   彈滿這麼多次就不再彈，讓它一路鑿到地面收尾。 */
const DROP_POPS = 4;
function dropBall(point) {
  if (!balls) balls = [];
  if (balls.length >= BALL_MAX) balls.shift();     // 滿了把最早那顆擠掉（同保齡球）
  const top = Math.max(DROP_TOP, (bp ? bp.height : 0) + DROP_UP);
  balls.push({
    x: point.x, y: top, z: point.z,
    vx: 0, vz: 0, vy: 0,             // 純自由落體
    /* 壽命要把「掉下來那一段」外加進去（v1.119）：起點跟著建築走之後，
       最高的地標要掉 3.55 秒，那等於先吃掉 BALL_LIFE 的一半——實測大笨鐘 9000
       落地才第 6.9 秒，剩不到 0.6 秒就被壽命收掉。外加之後不管從多高丟下來，
       「落地之後還能滾多久」都是同一份預算。 */
    r: BALL_R, ang: 0, hit: 0, life: BALL_LIFE + Math.sqrt(2 * top / GRAV), hops: 0,
    ax: 1, az: 0,                    // 直直掉不滾（ang 也不會動），軸給個定值就好
    drop: 1, pops: 0                 // pops＝在積木上彈過幾次（跟落地的 hops 分開算）
  });
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
/* 每一顆各自跑（v1.116：以前只有一顆，第二顆一出手就把第一顆蓋掉——球還在滾就整顆
   憑空不見，那正是使用者看到的）。每顆都要掃一次整池積木，所以顆數卡在 BALL_MAX。
   畫在 draw() 那邊統一送出去（ENG.putBalls），跟龍捲風、炸彈那些清單型道具同一套。 */
function stepBall(dt) {
  if (!balls) return;
  for (let i = balls.length - 1; i >= 0; i--) {
    const o = balls[i];
    o.life -= dt;
    o.vy -= GRAV * dt;
    o.x += o.vx * dt; o.z += o.vz * dt; o.y += o.vy * dt;
    if (o.y <= o.r) {                              // 落地：彈一下，越彈越低
      o.y = o.r;
      if (o.vy < -2.5) {
        /* 天降鐵球砸到地面的**第一下**：整個場震一下、地上留一個坑。
           保齡球沒有這一段——它落地那兩下是「丟出去」的延續，不是撞擊。
           只認 hops === 0：後面那幾下是越彈越小的餘波，每一下都震會抖個沒完
           （持續破壞不震畫面，v1.58 那條）。 */
        if (o.drop && !o.hops) {
          spawnRing({ x: o.x, y: 0, z: o.z }, o.r * 2);
          spawnMark({ x: o.x, y: 0, z: o.z }, o.r * 1.6, true);   // 坑洞，跟隕石同一種
          ENG.shake(1.1); sndThud(o.r * 3);
        }
        o.vy = -o.vy * (o.drop ? DROP_BOUNCE : BALL_BOUNCE); o.hops++;
        spawnDust({ x: o.x, y: 0.4, z: o.z }, 4, 6);
        sndSmash();                                // 不震畫面（v1.58），理由同下面撞到積木那段
      } else o.vy = 0;
    }
    let sp = Math.hypot(o.vx, o.vz);
    o.ang += sp / o.r * dt;                        // 滾動角度：走多遠就轉多少
    const R = o.r + 0.7, R2 = R * R;
    let n = 0, own = 0;                 // own＝其中有幾塊是地標的（見 afterHit）
    let hx = 0, hz = 0;                 // 接觸法線的水平分量（撞到的積木指向球心）
    for (const b of blocks) {
      if (b.st !== SET && b.st !== FREE) continue;
      const dx = b.x - o.x, dy = b.y - o.y, dz = b.z - o.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > R2) { if (b.st === SET && d2 < R2 * 2.6) b.wob = 0.4; continue; }
      const d = Math.max(0.4, Math.sqrt(d2));
      hx -= dx / d; hz -= dz / d;                // 積木在哪一邊，球就被往反方向頂
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
    /* 球也撞得動那幾隻（v1.146）。飛龍在天上，球滾不到牠——eachBeastNear 對牠算的是
       三維距離，天上那條線本來就在半徑外。 */
    eachBeastNear({ x: o.x, y: o.y, z: o.z }, R + 0.8, (m, d) => {
      if (m.air) return;
      const dd = Math.max(0.4, Math.hypot(m.x - o.x, m.z - o.z));
      tossBeast(m, o.vx * 0.6 + (m.x - o.x) / dd * 6, rr(4, 7),
                o.vz * 0.6 + (m.z - o.z) / dd * 6, false);
    });
    if (n) {
      o.hit += n;
      afterHit(n, { x: o.x, y: o.y, z: o.z }, R, own);
      spawnDust({ x: o.x, y: o.y, z: o.z }, R, n);
      /* 不震畫面（v1.58）：球一路滾過去是「每一幀都在撞」，每幀加一點震動的話
         畫面從出手晃到停下，看久了很不舒服——跟龍捲風、投石機同一個道理。 */
      if (Math.random() < 0.4) sndSmash();
      const brake = o.drop ? Math.max(0.3, 1 - n * 0.006)          // 撞越多掉速越快
                           : Math.max(BALL_BRAKE_MIN, 1 - n * BALL_BRAKE);
      o.vx *= brake; o.vz *= brake;
      /* 保齡球撞完要偏一下方向（見 BALL_VEER）。天降鐵球不吃這一段：
         它走的是下面那條「彈起來、往旁邊帶」，那才是砸下去該有的反應。 */
      if (!o.drop) {
        const sp2 = Math.hypot(o.vx, o.vz), hxz = Math.hypot(hx, hz);
        if (sp2 > 1 && hxz > 0.25) {
          const px = -o.vz / sp2, pz = o.vx / sp2;     // 行進方向的左手邊
          const side = (hx * px + hz * pz) / hxz;      // −1～1：法線偏在左邊還是右邊
          const a = side * Math.min(1, n / BALL_VEER_N) * BALL_VEER * dt;
          const cs = Math.cos(a), sn = Math.sin(a);
          const vx = o.vx * cs - o.vz * sn;
          o.vz = o.vx * sn + o.vz * cs; o.vx = vx;
        }
      }
      /* 天降鐵球砸到一片實的就彈起來（v1.118，見 DROP_BITE 那一段的說明）。
         每彈一次高度與橫移都乘 DROP_DECAY：前幾下跳得開、跳幾次之後就沒力了，
         接著才一路鑿到地面——不遞減的話它會在屋頂上一路跳到壽命結束，
         連落地那個坑都留不下。
         偏的方向優先取接觸法線的水平分量：從屋簷邊緣砸下去會往外彈，那是對的方向感；
         法線接近正上方（砸在平屋頂正中央）時沒有方向可用，才隨機抽一個。
         保齡球不吃這一段：它貼著地面滾，n 常常上百，跟著跳起來就變成在打水漂。 */
      if (o.drop && n >= DROP_BITE && o.vy < 0 && o.pops < DROP_POPS) {
        const k = Math.pow(DROP_DECAY, o.pops++);
        o.vy = Math.sqrt(2 * GRAV * DROP_POP * k);
        const hxz = Math.hypot(hx, hz);
        const a = hxz > 0.25 ? Math.atan2(hz, hx) + rr(-0.9, 0.9)
                             : Math.random() * Math.PI * 2;
        o.vx += Math.cos(a) * DROP_AWAY * k;
        o.vz += Math.sin(a) * DROP_AWAY * k;
      }
    }
    const roll = Math.pow(BALL_ROLL, dt);          // 滾動阻力
    o.vx *= roll; o.vz *= roll;
    sp = Math.hypot(o.vx, o.vz);

    /* 停下來的條件。範圍放到草地邊緣（不是工地邊緣）：現在球是從玩家點的地方丟出來的，
       點在場邊時起點本來就在工地外，用工地邊緣當界的話那一發出手就被收掉。 */
    /* 天降鐵球沒有水平速度，套保齡球那條（滾不動就收）的話出手第一幀就被收掉，
       所以它自己一條：落到地上、垂直方向停了、而且也滾不動了，才算「不再移動」。
       三個條件缺一不可——少了 vy 那條，彈起來的空檔會被當成停住；
       少了 sp 那條，被積木彈到帶著水平速度落地時會在滑行途中憑空消失。 */
    const done = o.drop ? (o.y <= o.r && o.vy === 0 && sp < 4.5) : sp < 4.5;
    if (done || o.life <= 0 || Math.hypot(o.x, o.z) > arenaR + 24) {
      spawnRing({ x: o.x, y: 0, z: o.z }, 5);
      balls.splice(i, 1);
    } else {
      // 滾動軸：水平、垂直於前進方向。方向弄反的話球會像倒著滾
      o.ax = o.vz / sp; o.az = -o.vx / sp;
    }
  }
  if (!balls.length) balls = null;
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
   看起來像路過蹭一下。現在改成一路啃——罩著多久就啃多久（撐得住的話一秒剩六成半、
   十秒剩 0.65¹⁰ ≈ 千分之一），這樣「吸走」才是持續發生的事。
   每幀的機率是 1−(1−這個數)^dt，所以啃掉幾成跟幀率無關（見 stepTwist）。
   碎料（FREE／FLY）不受這條限制，照樣全部捲走。
   **v1.116 從 0.2 拉到 0.35**（使用者：「提升龍捲風每單位時間的破壞積木百分比」）。
   釘在建築上實測：一／二／三秒累計吸走 17／33／46% → 37／58／73%。
   掃過去那一趟（新天鵝堡 3000 塊，12 輪）15.8～38.1%、平均 27.4%，
   仍然是「啃出缺口」不是「整段刨掉」——那條是 v1.62 使用者指定的界線，測試守著。
   **v1.123 再拉到 0.46**（使用者：「龍捲風威力再稍微增強」）。「稍微」照著上一次的
   步幅收一半：v1.116 是乘 1.75，這次乘 1.31。釘住不走的話一／二／三秒
   45／71／84%（理論 46／71／84）。掃過去那一趟（新天鵝堡 3000 塊，照測試那組參數
   跑 16 輪）13.4～58.0%、平均 31.9%（v1.116 是 15.8～38.1%、平均 27.4%）——
   平均只多四個百分點，但那條隨機漫步的路線偶爾會賴在建築上，尾巴拉到 58%，
   所以測試守的那條線跟著從「最多啃掉 55%」放到 65%（見 e2e）。
   「整段刨掉」（八成以上）那條 v1.62 使用者指定的界線沒有動。
   只動這個數不動半徑（TW_R）與速度：那兩個改的是「掃到多大一片」，
   使用者要的是同一片裡吃得更兇。
   **v1.151 拉到 0.71**（使用者：「龍捲風整體效果加速兩倍」，選的是「動作 ×2 ＋
   每秒吸走加倍」那一種）。0.71 是「兩秒壓成一秒」：1−(1−0.46)² ＝ 0.708，
   所以現在一秒吸走的，就是舊版兩秒吸走的量。釘住不走的話一／二／三秒
   71／92／98%（理論 71／92／98）。這次**壽命沒有跟著減半**（使用者選的），
   而移動速度同時乘 2，所以整趟掃過的路變兩倍長、罩過的地方也多一倍——
   「掃過去那一趟」的破壞量因此明顯跳上去（見 e2e 那條的量測）。
   v1.62 使用者指定的「不整段刨掉」那條線，已經事先跟使用者說過會被頂破。 */
const TW_TAKE = 0.71;
/* 走多快（單位／秒）：出發時 TW_SPD0，之後每幀被亂數推一下，夾在 MIN～MAX 之間。
   v1.62.2 整組乘 1.6（3.2／2.2／6 → 5.2／3.6／9.6，使用者指定「提升移動速度」）：
   漏斗半徑才 6，舊的速度連自己的直徑都要走 3.75 秒，看起來像在原地磨。
   **v1.116 再乘 1.5**（→ 7.8／5.4／14.4，使用者再次指定「也提升它的移動速度」）：
   八道實測的平均速度 5.2 → 7.9，整條壽命走的路 49 → 77 單位。
   轉向的擺幅（TW_SWAY）不跟著調——那是「每秒轉幾弧度」，跟走多快無關；
   跟著調的話走得快、轉得也快，等於原地繞圈，路線反而不會拉開。
   **v1.151 整組乘 2**（→ 15.6／10.8／28.8，使用者：「龍捲風整體效果加速兩倍」）。
   TW_SWAY 照樣不跟著調，理由同上（v1.62.2 就是這麼定的）。 */
const TW_SPD0 = 15.6, TW_SPD_MIN = 10.8, TW_SPD_MAX = 28.8;
/* 漏斗自轉（rad/s）。v1.151 從 7 乘 2（同上）：這是「加速兩倍」看得最明顯的一半——
   漏斗的扭曲完全是 spin 的函數（見引擎 putTornados），轉得多快就是它看起來多急。 */
const TW_SPIN = 14;
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
    w.spin += dt * TW_SPIN;
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
    /* 那幾隻也一起被捲上去（v1.146）：同一組力，第一次掃到才 tossBeast。
       飛龍不吃這一套——牠在漏斗頂上飛，被捲的話會變成一條在龍捲風裡打轉的龍。 */
    if (beasts) for (const p of beasts) {
      if (p.kind === 'dragon') continue;
      const dx = p.x - w.x, dz = p.z - w.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > R2 || p.y > w.h) continue;
      const d = Math.max(0.5, Math.sqrt(d2));
      if (!p.air) tossBeast(p, 0, 0, 0, false);
      const pull = 1 - d / R;
      p.vx += (-dz / d * 26 + -dx / d * 10) * pull * dt * 3 * B_BLOW;
      p.vz += (dx / d * 26 + -dz / d * 10) * pull * dt * 3 * B_BLOW;
      p.vy += (16 + 30 * pull) * dt * 3 * B_BLOW;
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
   炸彈／投石機那幾種小爆炸不給——它們的半徑才 7～14，
   掃出 2.6 倍的氣浪會比爆炸本身還顯眼，變成小道具看起來比核彈兇。
   隕石 v1.151.1 放大到 18.4 之後**照樣不給**：它走的是 crash 那一路
   ——「砸下來燒起來」，而那一圈往外掃的氣浪是「炸開」的長相。 */
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
     距離算三維（v1.147，使用者：「炸彈炸在屋頂、槌子砸在高處，下面的人
     不被震倒」）——跟上面掃積木那個迴圈同一個算法。以前這裡只取水平距離，
     炸在屋頂時地面那一圈人照樣被炸飛。**方向仍然取水平單位向量**：
     人是被往外推，不是被往地裡壓。 */
  for (const w of workers) {
    if (w.air) continue;
    const dx = w.x - point.x, dz = w.z - point.z;
    const dy = (point.y || 0) - (w.y || 0) - 0.9;              // 炸點在他胸口上方多高
    const hd = Math.hypot(dx, dz);                             // 水平距離（只用來決方向）
    const d = Math.hypot(dx, dy, dz);
    if (d > R) continue;
    const f = Math.pow(1 - d / R, 0.55) * power;
    const lift = f * Y_BOOST * (0.35 + 0.65 * (1 - d / R));   // 抬升的算法跟積木同一條
    const ol = Math.max(0.6, hd);
    let nx = dx / ol, nz = dz / ol;
    if (hd < 1.2) { const a = Math.random() * Math.PI * 2; nx = Math.cos(a); nz = Math.sin(a); }
    tossWorker(w, nx * f + rr(-2, 2), lift + rr(1, 4), nz * f + rr(-2, 2), true);
  }
  /* 生物也一起掀（v1.146）。同一條公式，只是力道打個折——牠們比人重一些。 */
  eachBeastNear(point, R, (m, d) => {
    if (m.air) return;
    const f = Math.pow(1 - d / R, 0.55) * power * B_BLOW;
    const lift = f * Y_BOOST * (0.35 + 0.65 * (1 - d / R));
    const hd = Math.hypot(m.x - point.x, m.z - point.z);   // 方向取水平的，同上面那段
    const ol = Math.max(0.6, hd);
    let nx = (m.x - point.x) / ol, nz = (m.z - point.z) / ol;
    if (hd < 1.2) { const a = Math.random() * Math.PI * 2; nx = Math.cos(a); nz = Math.sin(a); }
    tossBeast(m, nx * f + rr(-2, 2), lift + rr(1, 4), nz * f + rr(-2, 2), true);
  });
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
  /* 表情（v1.121，v1.131 拿掉生氣）：身上有火的被澆熄是「被救了」，冒愛心。
     沒火的以前冒生氣（被無故淋一身），使用者：「小人碰到水不生氣」——現在什麼都不冒。
     那顆怒氣本來就不只是「被水桶潑到那一下」：噴泉的水柱與淹水每 0.2／0.5 秒就會把
     還站在水裡的人重新淋一次（見 wetSpray／wetByWater 那兩個 `w.wet > WET_TIME - …`
     的門檻），而圖示只有 1.8 秒——人只要沒走開，那顆怒氣就一直掛在頭上。
     一定要在下面把 burn 歸零**之前**判。 */
  if (w.burn > 0) showEmo(w, 'heart');
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
  /* 燒起來的生物也澆得熄（v1.146）：牠身上的火跟小人是同一套，救的路徑也該是同一條。
     v1.154 起飛龍也在裡面（牠身上會有火了）——在天上那條龍不必另外擋，
     下面那條高度判斷本來就搆不到牠。 */
  if (beasts) for (const p of beasts) {
    if (p.wet > WET_TIME - 0.2) continue;
    for (const m of jets)
      if ((p.x - m.jx) ** 2 + (p.z - m.jz) ** 2 < r2 &&
          Math.abs(m.jy - p.y) < FT_WET_R + 1.5) { wetBeast(p); break; }
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
/* 一拍讓下去的量不到這個，就當它是「跟著滲水往下坐」、不算在往下掉（見①的 c.grd）。
   ＝草地一拍滲掉的量（0.6 ÷ 30 ＝ 0.02 格）再留五成餘裕。跟著 SEEP_G 走，
   哪天滲快一點也不用回來改這個數字。 */
const WT_SINK = SEEP_G * WT_TICK * 1.5;
let water = null;                   // { cells: Map, pours: [], acc, wt, wave }

/* 世界座標 ↔ 格子座標。gOffX/gOffZ 是藍圖角落的偏移。 */
const cellX = x => Math.round(x - gOffX);
const cellZ = z => Math.round(z - gOffZ);
const wldX = gx => gx + gOffX;
const wldZ = gz => gz + gOffZ;
/* 水撞到的「固體」＝**格子座標版的 hardAt**：藍圖的格子表問一次、小人的家再問一次
   （v1.103；那個聯集 v1.158.1 起收在 hardAt）——不問的話水從房子中間流過去、
   不會積在屋裡、杯壁破洞也不會從破口噴出來。
   兩邊的格線不同源（藍圖的原點隨每一座地標平移，房子各自有自己的原點），
   所以先換算回世界座標再分別問，對不齊的誤差最多半格。 */
const solidAt = (gx, gy, gz) => hardAt(wldX(gx), gy + HB, wldZ(gz));
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
  W.cells.set(k, { gx, gy, gz, v: put, f: 63, rim: 0, sub: 0, sup: 0, grd: 0, hd: 0,
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
    if (gy < 0 || solidAt(c.gx, gy, c.gz)) { c.sup = c.grd = 1; continue; }  // 站在地面／積木上
    const bl = cs.get(wkey(c.gx, gy, c.gz));
    const move = Math.min(c.v, 1 - (bl ? bl.v : 0), WT_FALL);
    /* 只挪得動一點點就當它**站住了**（下一段才會往旁邊攤）。
       這裡不能只判斷「腳下滿了沒有」：腳下那一格是 0.997 這種數字時 room 還有 0.003，
       水就會一直往下滴 0.003、永遠不算站住、也就永遠不往旁邊攤——
       實測倒進馬克杯的水會變成一根 26 格高的細柱站在杯子裡不肯攤平。

       **兩個旗標都是「腳下那一疊水一路撐到地面／積木」**（由下往上算，所以下面那格
       已經算好了），差在對「這一拍讓了多少水下去」的容忍度：
       　c.sup＝**定下來的水**（桶口找水面、畫面那邊在讀）——這一拍讓了水下去就不算。
       　c.grd＝**腳下撐得住**（②往旁邊攤在讀）——只讓下去一拍滲掉的量還是算，見下面。
       半空中的水兩個都不是：往下掉的水不會往旁邊散開，一柱水掉下去就是一柱
       （不分這件事的話，一股水掉個十幾格就散成一大片薄薄的水簾——
       使用者：「往下流的水體只有頂部一層的感覺」）。 */
    if (move <= WT_LEVEL) {
      c.sup = bl && bl.sup && bl.v >= 1 - WT_LEVEL ? 1 : 0;
      c.grd = bl && bl.grd && bl.v >= 1 - WT_LEVEL ? 1 : 0;
      continue;
    }
    c.v -= move;
    addWater(c.gx, gy, c.gz, move);
    c.sup = 0;
    /* **讓下去的量只有「一拍滲掉的那一點」的，腳下照樣算撐到地面**（c.grd，v1.155）。
       那不是在往下掉，是跟著草地滲水往下坐；②往旁邊攤認的就是這個旗標。

       不分這件事的話，草地上那一柱水永遠塌不下來：貼著草地的那一格每一拍滲掉
       0.02 格（SEEP_G 0.6 ÷ 30 拍），剛好開出一個比 WT_LEVEL 大一絲的洞，於是整柱水
       每一拍往下滴 0.02 格、每一格都被記成「在半空中」——而②只有站著的才攤，所以
       誰都不攤。實測（裝滿的馬克杯，杯子瞬間消失）：2181 格水裡有 1863 格自認在
       半空中，水面 5.8 秒只降 3.6 格（0.6 格/秒，剛好就是滲水的速度）、重心 6 秒不動。
       使用者：「杯子瞬間消失…流下的速度很慢，現實中會類似自由落體快速流下」。
       杯子裡的水沒這毛病：它坐在積木上，SEEP_B 一拍只滲 0.0007 格，開不出那個洞。

       門檻用 WT_SINK（滲一拍的量），不能用「腳下填滿了沒有」：桶口倒出來的那道水流
       每一格都是先把自己的半格全部讓下去、再從上面接半格回來（讓下去的是 0.5），
       只看「腳下填滿了」的話它也會算站著，一道水流就往旁邊攤成一片水簾
       （實測半空中每層 12 格，該是 1 格）。

       **還要看自己是不是滿的**（c.v）：算是水體的是「一整塊靜止的水」，正在流的不算。
       少了這個條件，破口外面那道水柱會攤開來——實測平均 4.8 → 9.1 格寬、每格
       0.59 → 0.28 格水，那正是 v1.84 修掉的「往下流的水體只有頂部一層的感覺」。

       **為什麼另開一個旗標、不直接放寬 c.sup**：c.sup 還有別的讀者——桶口找水面
       （injectWater）跟畫面那邊。把草地上那一疊算成 sup 的話，桶口會停在水堆頂上倒，
       而那一層的旁邊是空氣，BFS 就往半空中鋪開來：實測平地倒一桶會長成一座
       10×10×14 格的水塔（本來是灌到地面那一層、攤成一大片 51 格寬的水窪）。 */
    c.grd = move <= WT_SINK && c.v >= 1 - WT_SINK &&
            bl && bl.grd && bl.v >= 1 - WT_LEVEL ? 1 : 0;
    if (move > 0.25) sprayAt(wldX(c.gx), c.gy, wldZ(c.gz), WT_SPRAY);
  }
  for (const c of list) {                          // ② 往旁邊攤（只有站在東西上的才攤）
    if (c.v <= WT_MIN || !c.grd) continue;
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
  if (beasts) for (const m of beasts) {            // 站在水裡的生物同理（v1.146）
    if (m.wet > WET_TIME - 0.5) continue;
    const e = col.get(cellX(m.x) + ':' + cellZ(m.z));
    if (soaked(e, Math.max(0, Math.round(m.y)))) wetBeast(m);
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
/* 出膛高度：地面是這個，點在建築上就是「點到的那一點再高這麼多」（v1.137）。 */
const FW_Y0 = 0.8;
/* 點在建築上時，出膛點往鏡頭方向退多少（v1.137）。hit.point 正好落在積木表面上，
   不退的話尾巴有一半埋在那塊裡面。 */
const FW_OUT = 0.6;
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

/* p.y＝從多高射上去（v1.137，使用者：「如果點擊在建築上 則從建築位置發射煙火」）。
   不給就是地面。齊射的三發**共用同一個高度**：點在屋頂上就是三發都從屋頂那一帶射，
   各自照 FW_OFF 散開——散出去那兩發可能落在建築外緣的半空中，那看起來就是
   「從屋頂那一區放的一輪」，比「一發從屋頂、兩發從地面」讀得懂。 */
function launchFw(p) {
  const y = (p.y || 0) + FW_Y0;
  fireShell(p.x, p.z, y);
  for (let i = 1; i < FW_SHOT; i++) {
    if (!fwWait) fwWait = [];
    const a = rr(0, Math.PI * 2), d = rr(FW_OFF * 0.4, FW_OFF);
    fwWait.push({ x: p.x + Math.cos(a) * d, z: p.z + Math.sin(a) * d, y,
                  t: i * rr(FW_GAP[0], FW_GAP[1]) });
  }
  /* 跟龍捲風、蘑菇雲同一套：不退鏡頭的話整發都在畫面外。
     量過：貼著中世紀城堡的取景，炸開那一刻火星的 NDC y 是 1.5（1 就已經出界了）。
     **但這一發是「用完要還」的**（v1.123，使用者：「如果是會讓鏡頭往高的方向調整的
     運鏡 結束後高度要調回來（煙火一起調整）」）：煙火十秒就放完了，鏡頭卻一直仰著
     看天空——量過羅馬競技場是視線高 0 → 29，之後就停在那裡。
     所以第三個參數給 true，火星全熄之後在 fwEnd() 還回去。
     視距不還，只還高度：把建築推出畫面的是仰角不是距離（見 ENG.holdWide）。 */
  fwHold++;
  /* 取景要**連出膛高度一起算**（v1.137）：從屋頂射上去的話炸開的位置就高了那一截
     （台北 101 的屋頂 65 ＋ 竄高 42 ＋ 火星自己再往上十幾單位），不加的話整發在畫面外。 */
  ENG.holdWide(FW_HOLD_TOP + y - FW_Y0, FW_HOLD_R, true);
}
/* 還欠幾次「把視線高度還回去」。一次點下去是三發、還可以連點，
   所以要記次數——見 fwEnd()。 */
let fwHold = 0;
/* 一輪煙火真的放完了（沒有待發、沒有在竄、沒有火星）就把高度還回去。
   stepFw 的兩個出口都要叫：上面那個 early return 是「沒有火星要算」的捷徑，
   而最後一顆火星熄掉的下一幀走的正是它。 */
function fwEnd() {
  if (fwWait || fworks || fwSparks) return;
  while (fwHold > 0) { fwHold--; ENG.releaseWide(); }
}
/* 一發：抽兩個顏色（外層一個、芯一個），高度也各抽一個。
   y0＝從多高出膛（不給就是地面）。**炸開的高度是相對的**（v1.137）：寫死絕對高度的話，
   從台北 101 的屋頂（65）射上去會「還沒竄就已經超過 42」，當場在腳邊炸開。 */
function fireShell(x, z, y0) {
  if (!fworks) fworks = [];
  if (fworks.length >= FW_MAX) fworks.shift();
  const i = Math.floor(Math.random() * FW_COL.length);
  let j = Math.floor(Math.random() * (FW_COL.length - 1));
  if (j >= i) j++;                                  // 芯一定跟外層不同色
  const y = y0 || FW_Y0;
  fworks.push({ x, y, z, vx: rr(-1.6, 1.6), vz: rr(-1.6, 1.6),
                top: y + FW_TOP * rr(0.8, 1.2), em: 0, c: FW_COL[i], c2: FW_COL[j] });
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
/* 火星打到活的東西就點著他（v1.158.3，使用者：「煙火調整 火星對小人動物等生效」）。
   在這之前煙火是**唯一一支誰都打不到**的道具：火星只呼叫 igniteAt，而那一支的迴圈是
   `for (const b of blocks)`——站在花火底下淋一身火星，人跟動物都不痛不癢。

   規則沿用兩條既有的：
     · **命中判定同王之財寶的兵器**（weaponVsWorker／weaponVsBeast）：半徑 0.75，
       高度用「腳底到頭頂」，動物照身形放大、飛龍改用身體中段上下各半身高。
       抄它是因為那也是「一個小東西飛過來打到人」，判定形狀本來就一樣。
     · **點著的演法同火把**（game-ui.js 那支）：roll 給 0 ＝「站著被點著」——
       他們是站著中的，不是被炸飛摔在地上，所以是抱頭跑圈圈不是就地打滾。

   剛被消防車或水桶淋濕的點不著（igniteWorker／igniteBeast 自己會擋、回 false），
   **那一顆火星就不算用掉**，繼續往下掉去點別的東西——同積木那條的寫法。 */
const FW_MAN_R = 0.75;               // 火星離身體中心多近算打到（同 GATE_MAN_R）
function fwBurn(x, y, z) {
  for (const w of workers) {
    if (w.air || w.burn > 0) continue;
    const h = 1.5 * (w.scale || 1);                  // 頭頂（同 weaponVsWorker）
    if (y < (w.y || 0) || y > (w.y || 0) + h) continue;
    if ((w.x - x) ** 2 + (w.z - z) ** 2 > FW_MAN_R * FW_MAN_R) continue;
    if (igniteWorker(w, 0)) return true;
  }
  if (beasts) for (const m of beasts) {
    if (m.air || m.burn > 0) continue;
    const mid = ENG.BEAST_MID[m.kind] * (m.sc || 1);
    const lo = m.kind === 'dragon' ? (m.y || 0) - mid : 0;
    const hi = m.kind === 'dragon' ? (m.y || 0) + mid : mid * 2;
    if (y < lo || y > hi) continue;
    const R = FW_MAN_R + mid * 0.8;
    if ((m.x - x) ** 2 + (m.z - z) ** 2 > R * R) continue;
    if (igniteBeast(m, 0)) return true;
  }
  return false;
}
function stepFw(dt) {
  if (fwWait) {                                      // 齊射還沒出膛的那幾發
    for (let i = fwWait.length - 1; i >= 0; i--) {
      const w = fwWait[i];
      w.t -= dt;
      if (w.t <= 0) { fireShell(w.x, w.z, w.y); fwWait.splice(i, 1); }
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
  if (!fwSparks) { fwEnd(); return; }
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
    /* 活的東西排在積木前面（v1.158.3）：人多半就站在牆邊，同一個取樣點兩邊都沾到時，
       該燒的是站在前面的那個人，不是他背後那面牆。 */
    if (fwBurn(s.x, s.y, s.z)) { fwSparks.splice(i, 1); continue; }
    // 房子也要點得著（v1.102）：blockAt 只認藍圖的格子表，所以用 hardAt
    if (hardAt(s.x, s.y, s.z)) {
      igniteAt(s.x, s.y, s.z); fwSparks.splice(i, 1); continue;
    }
    const mx = (px + s.x) / 2, my = (py + s.y) / 2, mz = (pz + s.z) / 2;
    if (fwBurn(mx, my, mz)) { fwSparks.splice(i, 1); continue; }
    if (hardAt(mx, my, mz)) { igniteAt(mx, my, mz); fwSparks.splice(i, 1); }
  }
  if (!fwSparks.length) fwSparks = null;
  fwEnd();
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
   範圍是投石機石頭的四倍（v1.151.1 半徑放大 2 倍），威力介於石頭與定時炸彈之間——
   它的重點是火不是威力：
   落點一帶會燒起來，火接著自己往鄰居蔓延（跟放火同一套）。
   可以同時來好幾顆，每顆各自從一個方位進來、倒數也各走各的。 */
const MET_MAX = 6;              // 同時最多幾顆（畫面那邊的 MAXMET 也是 6）
const MET_WAIT = 3;             // 點下去到出現在天上（跟定時炸彈的引信一樣長）
const MET_FALL = 0.9;           // 從天上到落點
const MET_TOP = 62;             // 出現的高度。45° → 水平也退開同樣的距離
/* v1.151（使用者：「隕石大幅提高大小 約5倍(包含隕石本體&破壞範圍)」）先做成半徑 ×5，
   **v1.151.1 收回成半徑 ×2**（使用者：「隕石現在有點過大了 因為你是半徑變為五倍
   體積就會變 5^3 如果是這樣大概半徑接近兩倍的程度」）——「5 倍」講的是**體積**：
   半徑 ×5 等於體積 ×125，實測一顆就把一座 3000 塊的地標整個掃成瓦礫（2931 塊），
   而且範圍 46 比核彈的 30 還大一圈，解鎖卻早得多。
   現在是半徑 ×2（體積 ×8，使用者說的「接近兩倍」；體積正好 5 倍是 ×1.71）：
   石身 2 → 4 格、破壞範圍 9.2 → 18.4（＝投石機石頭的四倍，仍然小於核彈的 30）。
   **威力（MET_POW）沒動**：使用者要的是「大小」不是「打得更痛」，而半徑本身
   就是破壞量的主因——explode 的力道照 1−d/R 衰減。
   跟著半徑自己長大的：落地的火（igniteAround 吃 MET_R×1.6）、坑洞、揚塵、震動。
   **不跟著長大的**：倒數那圈預告環（固定 5，跟核彈的 6 同一套慣例，半徑 30 也是給 6）、
   飛龍的火球（見〈火球〉FB_R／FB_POW，v1.151 起自己一組數字）。 */
const MET_S = 4;                // 石身畫多大（v1.150 之前是 2）；sweepRock 也拿它當碰撞半徑
/* 包住石頭那圈「火頭」（見 stepMeteors）跟著石身**等比**放大。
   v1.151 石身放到 10 格時不能等比——每顆 5～9 格實測是一片糊在一起的大黃板（截圖確認過），
   跟那邊「火苗要小、要密、要短命」那條原則正好相反，所以當時大小只放 2.5 倍、顆數補兩倍。
   v1.151.1 收回成 ×2 之後那個問題不存在了（每顆 2～3.6 格），等比就好，顆數也回原本。 */
const MET_FIRE = MET_S / 2;     // 火頭的散布半徑與大小倍率（×2）
const MET_R = ROCK_R * 4;       // 破壞範圍（18.4）
const MET_POW = 16;             // 介於石頭（12）與定時炸彈（17）之間
function callMeteor(point) {
  if (!meteors) meteors = [];
  if (meteors.length >= MET_MAX) meteors.shift();   // 超過就把最早那顆擠掉，跟定時炸彈一樣
  const m = {
    tx: point.x, ty: Math.max(0.6, point.y), tz: point.z,
    a: rr(0, Math.PI * 2),       // 從哪個方位斜進來，每顆各抽一個
    t: MET_WAIT + MET_FALL, mark: 0, lit: 0, em: 0,
    x: 0, y: 0, z: 0, rx: rr(0, 6), ry: rr(0, 6), s: MET_S, hot: 0, smoke: 0
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
      /* 火頭的散布與大小跟著石身等比走（MET_FIRE，v1.151.1 是 ×2）：寫死的話那圈火
         會縮在石頭裡面，看起來石頭沒在燒。尾巴那些（沿著路徑撒的）**不**跟著放大
         ——它們要小、要密，理由見上面。 */
      const head = Math.random() < 0.34;
      const u = head ? 1 : Math.random();
      const j = head ? 1.35 * MET_FIRE : 0.3;
      hot.push({
        x: px + (m.x - px) * u + rr(-j, j),
        y: py + (m.y - py) * u + rr(-j, j),
        z: pz + (m.z - pz) * u + rr(-j, j),
        vx: rr(-0.7, 0.7), vy: rr(0.6, 2.2), vz: rr(-0.7, 0.7),
        rx: Math.random() * 6, ry: Math.random() * 6,
        s: head ? rr(1, 1.8) * MET_FIRE : rr(0.24, 0.62),
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
/* 最多同時幾顆（要跟引擎的 FLASH_MAX 一樣大，理由見那邊）。爆炸類與王之財寶的
   擊中小火球共用這一池：小火球滿了就那一發沒有（不擠掉別人），大爆炸照舊擠得掉最早那顆。
   實測王之財寶的擊中需求：一組同時要 7～11 顆、三組 16～28 顆。 */
const FLASH_MAX = 24;
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
   兩者同速的話它會像顆縮回去的氣球，火球是「膨脹的同時燒完冷掉」。
   life／hold 沒給就走上面那兩個常數（爆炸類一律用預設）；王之財寶那顆小火球
   自己帶一份短的，理由見 weaponBoom。 */
function stepFlash(dt) {
  for (let i = flashes.length - 1; i >= 0; i--) {
    const f = flashes[i];
    f.t += dt;
    const life = f.life || FLASH_LIFE, hold = f.hold === undefined ? FLASH_HOLD : f.hold;
    const k = f.t / life;
    if (k >= 1) { flashes.splice(i, 1); continue; }
    f.r = f.R * (0.34 + 0.72 * Math.sqrt(k));       // sqrt：一開始猛、後面慢
    const fade = f.t < hold ? 1 : 1 - (f.t - hold) / (life - hold);
    f.op = fade * fade;                             // 平方：亮的時間長、最後幾幀掉得乾脆
  }
}

/* ── 蘑菇雲 ───────────────────────────────────────────────
   不是一次生出來的：柱子先往上冒，半秒後才在頂端撐出傘蓋，同時腰上出現一圈環。
   一次生完的話它會「啪」地整朵出現在半空，看起來像貼圖不像爆炸長出來的。
   火光在裡面燒約 0.8 秒再冷掉，那是參考圖裡雲心會發亮的來源。 */
const CLOUD_GROW = 2.4;         // 整朵長完要多久
const SKIRT_T = 1.7;            // 腳下那圈煙要往外鋪多久
/* 多少顆、多大（v1.123 一起變細，使用者：「烏雲效果太過粗糙(核彈&爆裂魔法蘑菇雲一起
   調整)」）。跟烏雲同一個做法：**顆數往上、單顆往下，總覆蓋度不動**——
   邊長 5、6 的方塊擺在半徑 15 的傘蓋上，輪廓就是一顆一顆數得出來的骰子。
     傘蓋 112 顆 × 3.4～6.2 → 440 顆 × 1.6～3.2（覆蓋度 3.75 → 3.72，幾乎一樣）
     柱子 每秒 58 顆 × 1.7～3.4 → 160 顆 × 0.95～1.9
     煙裙 每秒 62 顆 × 2.6～5.0 → 165 顆 × 1.45～2.7
   傘蓋裡的火光也跟著（34 顆 × 1.6～3.2 → 60 顆 × 1.1～2.2）：煙細了之後，
   兩三顆大的橘色方塊會從一團碎煙裡整個凸出來——顯眼的是**落差**不是絕對大小。
   配額跟著抬：一朵雲自己要的從 345 顆變成約 1070 顆，兩個關卡（傘蓋與柱子共用的
   CLOUD_CAP、煙裙的 CLOUD_SKIRT_CAP）本來就是「留一截給碎料的火苗煙」，
   照原本的比例往上抬（680／590 → 1550／1350，引擎的 MAXDUST 同時 900 → 2200）。
   煙裙那一關比較低的理由沒變：傘蓋是 0.45 秒一次要四百多顆的爆量，
   煙裙要是先把配額吃光，蘑菇就會變成一根沒有頭的柱子。 */
const CLOUD_TOP = 440, CLOUD_STEM = 160, CLOUD_SKIRT = 165;
const CLOUD_CAP = 1550, CLOUD_SKIRT_CAP = 1350;
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
      c.emit += dt * CLOUD_STEM;
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
        if (dust.length < CLOUD_CAP)                 // 柱子的煙：沿著整根柱子生
          dust.push({ x, y: rr(0.6, capY * 0.92), z,
            vx: Math.cos(a) * rr(0.2, 1.2), vy: rr(0.8, 2.4), vz: Math.sin(a) * rr(0.2, 1.2),
            rx: Math.random() * 6, ry: Math.random() * 6,
            life: rr(6, 8.5), s: rr(0.95, 1.9), c: rr(0.34, 0.56), g: 1.4, fade: 4 });
      }
    }
    /* 傘蓋：0.45 秒時一次撐開，然後自己往上升。
       生在柱子上方、給比柱子快的初速，收尾就是「上面一團、下面一根」。 */
    if (t0 < 0.45 && c.t >= 0.45) {
      const H = R * 0.4;
      for (let k = 0; k < CLOUD_TOP; k++) {
        if (dust.length >= CLOUD_CAP) break;
        const a = Math.random() * Math.PI * 2;
        const rad = Math.sqrt(rr(0.03, 1)) * R * 0.5;
        dust.push({
          x: c.x + Math.cos(a) * rad, y: H + rr(-R * 0.06, R * 0.12), z: c.z + Math.sin(a) * rad,
          vx: Math.cos(a) * rr(0.4, 2), vy: rr(8, 10.5), vz: Math.sin(a) * rr(0.4, 2),
          rx: Math.random() * 6, ry: Math.random() * 6,
          life: rr(6.5, 9), s: rr(1.6, 3.2), c: rr(0.18, 0.42), g: 1.8, fade: 4.5
        });
      }
      /* 傘蓋裡的火光，燒一下就冷掉。v1.123 跟著煙一起變細（60 顆 × 1.1～2.2，
         本來是 34 顆 × 1.6～3.2）：煙細了之後，兩三顆大的橘色方塊會從一團碎煙裡
         整個凸出來，反而更顯眼——量的不是絕對大小，是跟旁邊那些的落差。 */
      for (let k = 0; k < 60; k++) {
        if (hot.length >= HOT_MAX) break;
        const a = Math.random() * Math.PI * 2;
        const rad = Math.sqrt(rr(0.02, 1)) * R * 0.34;
        hot.push({
          x: c.x + Math.cos(a) * rad, y: H + rr(0, R * 0.06), z: c.z + Math.sin(a) * rad,
          vx: Math.cos(a) * rr(0.3, 1.5), vy: rr(8, 10.5), vz: Math.sin(a) * rr(0.3, 1.5),
          rx: Math.random() * 6, ry: Math.random() * 6,
          s: rr(1.1, 2.2), life: rr(0.7, 1.5), g: 1.8, grow: 1.04, cool: rr(0.6, 1.1),
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
      c.semit = (c.semit || 0) + dt * CLOUD_SKIRT;
      while (c.semit >= 1) {
        c.semit--;
        /* 這裡的上限（CLOUD_SKIRT_CAP）壓得比柱子與傘蓋的 CLOUD_CAP 低：
           傘蓋是 0.45 秒一次要兩百多顆的爆量，煙裙要是先把配額吃光，
           蘑菇就會變成一根沒有頭的柱子。
           兩個數字都比整朵雲自己要的（v1.123 起：柱 352 + 傘 440 + 裙 280）高一截，
           是留給碎料的火苗煙——核彈會點著整棟，那些煙先搶走兩百多格，配額不夠寬的話
           煙裙就鋪不出來（量過：99 團 → 27 團，只剩柱子腳邊一小圈）。 */
        if (dust.length > CLOUD_SKIRT_CAP) break;
        const a = Math.random() * Math.PI * 2;
        const k = Math.min(1, c.t / (SKIRT_T * 0.8));
        const rad = R * (0.12 + 0.36 * k) * rr(0.75, 1.15);
        dust.push({
          x: c.x + Math.cos(a) * rad, y: rr(0.3, R * 0.09), z: c.z + Math.sin(a) * rad,
          vx: Math.cos(a) * rr(1.2, 4), vy: rr(1, 3), vz: Math.sin(a) * rr(1.2, 4),
          rx: Math.random() * 6, ry: Math.random() * 6,
          life: rr(5, 7.5), s: rr(1.45, 2.7), c: rr(0.26, 0.46), g: 3.2, fade: 3.4
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

/* ── 打雷 ───────────────────────────────────────────────
   使用者指定的順序就是這支的骨架：點地面 → 慢慢出現一朵烏雲 → 隨機劈 5～7 道雷 →
   被劈到的點小破壞（幾格積木）＋燒起來。

   雲用塵霧粒子堆（跟蘑菇雲同一套，不另外開一種畫面物件）：一團一團地聚出來，
   聚滿了才開始劈。一次生一整朵的話它會「啪」地整朵出現在半空，看起來像貼圖
   不像雲聚過來——蘑菇雲那邊踩過同一個雷（見〈蘑菇雲〉）。

   閃電重用爆裂魔法那套折線（boltPts／bolts）：一道雷是「一條主幹 ＋ 兩條從主幹
   中段折出去、停在半空的分岔」。只畫主幹的話是一條光滑的折線，看起來像電線不像雷。
   段數：主幹 11 ＋ 分岔 2×4 ＝ 19 段，三朵雲各自劈到最密也就 114 段，
   加上三處爆裂魔法的餘電 126 段仍在引擎的 MAXBOLT（288）以內。 */
const STORM_MAX = 3;             // 同時最多幾朵
/* 雲底高度（v1.118 改成跟著建築走）。本來是固定 26，但地標最高到 138（大笨鐘 9000 塊）
   ——雲整個埋在建築裡，電等於從樓層之間冒出來，看不出打在哪；使用者回報的就是這件事。
   現在是「屋頂再上去 STORM_UP」，矮建築另外有個下限，不然雲會貼在屋簷上、電只剩一小截。 */
const STORM_Y0 = 34;             // 最低就這麼高（矮建築用）
const STORM_UP = 16;             // 高過屋頂多少
/* 雲的半徑。v1.123 從 12 放到 17（使用者：「烏雲面積 閃電破壞面積 加大(2倍)」）——
   照字面是**面積**兩倍，所以半徑乘 √2（12 × 1.414 = 16.97）。
   厚度（STORM_TH）不跟著放：使用者指定的是面積，而且薄而寬本來就比較像一層雷雨雲。 */
const STORM_R = 17;
const STORM_TH = 3.4;            // 雲心的厚度（往邊緣收，見 stormSeeds）
/* 雲要聚多久才聚滿（使用者：「慢慢出現」）。v1.123 從 1.6 拉到 2.6：
   要看得出「先外圈、再往中心收」（見 stormSeeds），1.6 秒整朵就長完了，
   那個順序一閃就過去。 */
const STORM_GROW = 2.6;
/* 一朵雲幾團、一團多大。v1.117 是 44 團 × 3.4～6.4，使用者：「烏雲方塊太少 太大塊
   看起來像一堆立方體」——量過就是這樣：半徑 11 的圓要用 44 顆邊長 5 的方塊鋪，
   一顆一顆之間有縫，邊緣露出整齊的立方體側面。改成「多而小」（截圖比對 44／90／150／220
   四種，150 團 × 1.4～3.0 最像雲，220 團反而在邊緣散成一堆小骰子）。
   **v1.123 再細一級**（使用者：「烏雲效果太過粗糙」）。第一版只把團數補到「面積放大
   一倍之後密度不變」（150 → 380）就去截圖，結果還是一團看得出邊長的方塊——
   關鍵不是密度而是**單顆多大**：一顆邊長 3 的方塊擺在半徑 17 的雲裡，
   輪廓上就是一顆一顆數得出來的骰子。所以三件事一起做：
   ① 團數 150 → 700、單顆 1.4～3.0 → **1.4～2.9 再乘 taper**（見 ②）。
      覆蓋度（Σ 邊長² ÷ 面積）1.68 → 2.21：顆粒變小、疊得更厚，輪廓才連成一片。
   ② 大小跟著「離雲心多遠」收（STORM_TAPER）：會露出立方體側面的地方永遠是輪廓，
      中心那些本來就被別團擋住。邊緣的一團只有中心的 60%。
   ③ 引擎的 MAXDUST 跟著 900 → 2200（三朵同時在場就是 2100 團）。
      **顆數變多不等於變貴**：覆蓋度沒變多少，GPU 那邊的填色量就差不多；
      CPU 那邊量過一顆約 0.06µs（draw() 0 顆 0.29ms、900 顆 0.347ms），
      2200 顆也只多 0.08ms，每幀預算是 4ms。 */
const STORM_PUFF = 700;
const STORM_S = [1.4, 2.9];
const STORM_TAPER = 0.4;        // 邊緣的一團縮到中心的 (1 − 這個)
/* 怎麼聚（v1.123，使用者：「烏雲出現時細節 先在中心外圍慢慢出現 然後往中心聚攏」）。
   ① 出場順序：整朵的位置先抽好、照離雲心的距離**由外往內**排（見 stormSeeds），
      所以一定是外圈先亮、中心最後補滿。本來是每次現抽一個位置，抽到哪就長在哪，
      整朵一起淡入，看不出方向。
   ② 每一團生在自己歸位點的外側，再一路飄回去。偏移量是「歸位點離雲心的距離 × STORM_IN
      ＋ STORM_OUT」：只乘比例的話，歸位點就在雲心的那幾團等於原地生出來，
      中心那一塊就沒有聚攏可看，所以要再加一個固定量。
   ③ 飄回去用指數逼近（每秒追上的比例由 STORM_PULL 決定）：出場那一下最快、
      快到位時慢下來，看起來像被吸過去而不是等速平移。 */
const STORM_IN = 1.45;
const STORM_OUT = 7;
const STORM_PULL = 2.4;
const STORM_FADE = 0.45;         // 劈完之後整朵縮掉的半衰期
const STORM_N = [15, 20];        // 劈幾道（使用者指定，v1.118 從 5～7 加到 7～15、v1.123 到 15～20）
const STORM_GAP = [0.22, 0.5];   // 兩道之間隔多久
/* 雷打在雲心多遠以內。跟著雲一起放大（12 → 17 是乘 √2，這裡 9 → 13 也是）：
   雲大了落點卻沒跟著散開的話，一朵三十四單位寬的雲只在正中央那一小圈劈，
   看起來會像雲跟電是兩回事。 */
const STRIKE_R = 13;
const STRIKE_NEAR = 1.6;         // 找「這一點上方最高那塊」的水平容差
/* 一道雷打掉的範圍。使用者指定「小破壞（可能就幾格積木）」，所以這個數是照著
   「打中那一塊 ＋ 它的面鄰居」湊的：格子間距是 1，收在 1.3 的話對角線（1.41）就進不來，
   一道雷最多七格、打在牆面上實際多半是三到五格。
   第一版給 3.2（比槌子的 5.5 小就好）——實測六道劈掉 726 塊，那不是「幾格」是拆房子。
   雷的重點跟隕石一樣不在威力在火，見下面的 BOLT_FIRE_*。 */
/* v1.123 從 1.3 放到 1.84（使用者：「閃電破壞面積 加大(2倍)」）——跟雲一樣照
   **面積**兩倍算，半徑乘 √2。跨過 1.73 之後 3×3×3 的角落（√3）也進得來，
   所以一道雷咬得到的上限從 7 格變成 27 格；打在牆面上實際咬到的還是少得多（見測試）。 */
const BOLT_R = 1.84;
const BOLT_POW = 13;             // 力道（投石機的石頭 12、槌子 15）
const BOLT_FIRE_R = 5;           // 點火的範圍（比破壞範圍大得多：燒才是它的主要傷害）
const BOLT_FIRE_N = 5;           // 一道雷最多點著幾塊，其餘交給火自己蔓延
/* 劈到人的範圍（v1.133，使用者：「打雷⋯⋯沒對小人生效」，指定「打倒 ＋ 燒起來」）。
   為什麼本來沒有：所有道具掀倒小人都靠共用的 afterHit，而它**只在真的打掉積木時**
   才動人（第一行就是 `if (n <= 0) return`）——雷劈在空地上一塊積木都沒掉，
   等於整段沒跑；就算劈在建築上，半徑也只有 BOLT_R × 1.7 ＝ 3.1。
   實測：12 個人站在落點正下方，一整朵雲劈完 0 個有反應。
   取 BOLT_FIRE_R（點火範圍 5）而不是 BOLT_R（破壞範圍 1.84）：這一下的主要傷害
   本來就是燒，而不是砸——焦黑範圍內的人一起著火才對得上畫面。 */
const BOLT_MAN_R = BOLT_FIRE_R;
const BOLT_MARK = 4;             // 地上那塊焦黑多大（劈在屋頂上就不留，見 spawnMark）
function callStorm(p) {
  if (!storms) storms = [];
  if (storms.length >= STORM_MAX) storms.shift();   // 滿了把最早那朵擠掉（同其他清單型道具）
  const y = Math.max(STORM_Y0, (bp ? bp.height : 0) + STORM_UP);
  const s = {
    x: p.x, z: p.z, y, t: 0, out: 0, puffs: [], seeds: null, seed: 0,
    // 均勻抽。用 rr 再四捨五入的話頭尾兩個值只有一半的機會，中間會偏多
    left: STORM_N[0] + Math.floor(Math.random() * (STORM_N[1] - STORM_N[0] + 1)),
    next: STORM_GROW + rr(0.1, 0.4)                 // 雲聚滿了才開始劈
  };
  s.seeds = stormSeeds(s);
  storms.push(s);
  /* 順手把鏡頭退到看得見整朵雲的距離（跟蘑菇雲共用 ENG.holdWide）。
     量過：預設取景的「畫面上緣」差不多就在鏡頭自己的高度——矮建築（羅馬競技場 h=15）
     只看得到 26 以下，雲擺在 34 就整朵在畫面外，點下去等於什麼都沒發生。
     holdWide 只會把鏡頭往外／往上帶，不會搶走玩家自己拉近的視角。
     **這一發是「用完要還」的**（v1.128，使用者：「如果是會讓鏡頭往高的方向調整的運鏡
     結束後高度要調回來」——一開始寫在天降鐵球底下，查證之後確認那支從頭到尾不動鏡頭，
     真正會抬高又停在那裡的是這一支）。雲擺得比屋頂高，視線就跟著抬到雲的腰間：
     矮建築抬到 18.7、台北 101 抬到 67——劈完雲散了，鏡頭卻還仰在那裡看空的天空。
     第三個參數給 true，最後一朵散掉之後在 stormEnd() 還回去。
     視距不還，只還高度：把建築推出畫面的是仰角不是距離（見 ENG.holdWide）。 */
  stormHold++;
  ENG.holdWide(y + STORM_TH, Math.max(STORM_R, bp ? bp.radius : STORM_R), true);
  sndTick();
}
/* 還欠幾次「把視線高度還回去」。同時最多三朵、還可以連點，所以要記次數——見 stormEnd()。 */
let stormHold = 0;
/* 雲全部收乾淨了就把高度還回去。stepStorms 的兩個出口都要叫：
   上面那個 early return 是「場上沒有雲」的捷徑，而最後一朵縮完的下一幀走的正是它。 */
function stormEnd() {
  if (storms) return;
  while (stormHold > 0) { stormHold--; ENG.releaseWide(); }
}
/* 整朵雲的「歸位點」，一次抽好、照離雲心的距離**由外往內**排（v1.123，
   使用者：「烏雲出現時細節 先在中心外圍慢慢出現 然後往中心聚攏」）。
   半徑往中心偏（0.7 次方；均勻鋪滿是 0.5），厚度再跟著半徑收——
   整朵是中間厚、邊緣薄的透鏡，不是一塊等厚的圓餅。圓餅的邊緣會露出一排
   一樣大的方塊側面，那正是「看起來像一堆立方體」的來源。
   排序放在這裡而不是每次現抽：現抽的話「外圈先出現」只能靠機率，
   一定會有幾團中心的先冒出來，那個順序就看不出來了。 */
function stormSeeds(s) {
  const out = [];
  for (let i = 0; i < STORM_PUFF; i++) {
    const a = Math.random() * Math.PI * 2;
    const k = Math.pow(Math.random(), 0.7);
    const th = STORM_TH * (1 - 0.55 * k);
    out.push({
      a, k,
      hx: s.x + Math.cos(a) * k * STORM_R, hy: s.y + rr(-th, th),
      hz: s.z + Math.sin(a) * k * STORM_R,
      vx: rr(-0.35, 0.35), vz: rr(-0.35, 0.35),
      rx: Math.random() * 6, ry: Math.random() * 6,
      // 大小跟著離雲心多遠收：輪廓上那些變小，整朵的邊緣才不會是一排立方體側面
      s: rr(STORM_S[0], STORM_S[1]) * (1 - STORM_TAPER * k),
      // 壓到 0.1～0.22（一般揚塵 0.62～0.9、蘑菇雲 0.18～0.42）：這是雷雲不是煙
      c: rr(0.1, 0.22)
    });
  }
  out.sort((p, q) => q.k - p.k);            // 離雲心遠的排前面 ＝ 先出場
  return out;
}
/* 讓下一團出場：生在自己歸位點的外側，之後每幀往歸位點飄（見 stepStorms）。 */
function popPuff(s) {
  const q = s.seeds[s.seed++];
  const out = q.k * STORM_R * STORM_IN + STORM_OUT;
  q.x = s.x + Math.cos(q.a) * out;
  q.y = q.hy + rr(-0.6, 0.6);
  q.z = s.z + Math.sin(q.a) * out;
  return q;
}
/* 一道雷。落點是雲底下隨機一處：那一點上方有東西就打在最高那一塊上，沒有就打在地上。
   固定瞄整棟最高點的話七道全劈在同一根避雷針上，看起來像鎖定不像天氣。 */
function strike(s) {
  const a = Math.random() * Math.PI * 2;
  const rad = Math.sqrt(Math.random()) * STRIKE_R;   // 開根號：落點才會均勻鋪滿整個圓
  const x = s.x + Math.cos(a) * rad, z = s.z + Math.sin(a) * rad;
  /* 這裡掃整池積木而不是用 colTop：colTop 只認地標藍圖的格子表，小人的家不在裡面
     （隕石的掃掠判定也有同一個限制）。一道雷掃一次、一朵雲最多七次，划得來。 */
  let top = null;
  for (const b of blocks) {
    if (b.st !== SET) continue;
    if (Math.abs(b.x - x) > STRIKE_NEAR || Math.abs(b.z - z) > STRIKE_NEAR) continue;
    if (!top || b.y > top.y) top = b;
  }
  const p = top ? { x: top.x, y: top.y, z: top.z } : { x, y: 0.6, z };
  const cx = s.x + rr(-STORM_R * 0.4, STORM_R * 0.4);
  const cz = s.z + rr(-STORM_R * 0.4, STORM_R * 0.4);
  const cy = s.y - rr(0.5, 2.5);
  const life = rr(0.16, 0.26);
  const main = boltPts(cx, cy, cz, p.x, p.y, p.z, 2.2, 11);
  /* src 記著是哪一朵雲劈的。餘電那邊靠它算每一處的額度（boltsOf），雷不需要——
     但 bolts 是共用的一份清單，每一筆都有 src 才不會讓走訪它的地方踩到 undefined。 */
  bolts.push({ pts: main, t: 0, life, op: 1, w: rr(0.42, 0.6), src: s });
  for (let k = 0; k < 2; k++) {
    const q = main[3 + Math.floor(Math.random() * (main.length - 5))];
    const b = Math.random() * Math.PI * 2, br = rr(2.5, 6);
    bolts.push({
      pts: boltPts(q.x, q.y, q.z, q.x + Math.cos(b) * br, Math.max(0.6, q.y - rr(3, 9)),
                   q.z + Math.sin(b) * br, 1.2, 4),
      t: 0, life: life * 0.75, op: 1, w: rr(0.18, 0.3), src: s
    });
  }
  /* 小破壞（使用者：「可能就幾格積木」）：半徑比槌子還小的一次點狀衝擊。
     quiet＝不震畫面，震動下面自己給——雷該震的是「一記」，不是槌子那條曲線。 */
  smash(p, { x: 0, y: -1, z: 0 }, BOLT_R, BOLT_POW, true);
  /* 附帶燃燒（使用者指定）：劈中那一帶還站著的積木點幾塊起來，火再自己往鄰居蔓延。
     跟隕石共用同一支 igniteAround，差別只在半徑小得多——它是「劈出一個焦黑的小洞」。 */
  igniteAround(p, BOLT_FIRE_R, BOLT_FIRE_N, SET);
  /* 劈到的人：**打倒並且在地上燒**（使用者指定）。igniteWorker(w, 1) 就是「摔在地上燒」
     那一種姿勢（roll=1，就地打滾）；剛被消防車噴濕的點不著，那就只打倒——
     同小人被炸飛落地那一段的寫法（`if (!lit || !igniteWorker(w, true))`）。
     只認水平距離：人站在地上，用三維距離的話劈在屋頂就打不到腳下的人（同 explode）。 */
  for (const w of workers) {
    if (w.air || w.burn > 0 || w.fall > 0) continue;
    if (Math.hypot(w.x - p.x, w.z - p.z) > BOLT_MAN_R) continue;
    if (!igniteWorker(w, 1)) { releaseWorker(w); w.tilt = 0; w.fall = rr(1.1, 2.3); }
    sndFall();
  }
  /* 劈到的生物同理（v1.146）。**飛龍 v1.154 起劈得著火**（igniteBeast 走 burnDragon）：
     牠會拖著火飛一段再摔下來；已經在燒或剛被澆濕的回 false，那就走「只打倒」這條——
     對牠來說就是被劈下來（crashDragon）。
     **這裡只認水平距離**（flat）：雷是從雲底一路劈到地面的一條線，天上那條龍就在
     這條線上。照三維距離算的話牠飛在 30 格高、雷的判定半徑才 5 格，等於永遠劈不到。 */
  eachBeastNear(p, BOLT_MAN_R, m => {
    if (m.air || m.burn > 0 || m.fall > 0) return;
    if (!igniteBeast(m, 1)) fellBeast(m, rr(B_FALL[0], B_FALL[1]));
    sndFall();
  }, true);
  spawnMark(p, BOLT_MARK, false);           // 焦黑不是坑洞：雷是燒不是砸（劈在屋頂就不留）
  /* 只有劈到建築才震（v1.123，使用者：「閃電打到地面不震動」）。
     `top` 是那一點上方最高的那塊積木，沒有就是劈在空地上——
     那一下沒有東西被打歪，畫面跟著跳反而像是打到了什麼。
     一朵雲現在劈 15～20 道，全部都震的話畫面會抖上七八秒。 */
  if (top) ENG.shake(0.8);
  sndThunder();
}
function stepStorms(dt) {
  if (!storms) { stormEnd(); return; }
  for (let i = storms.length - 1; i >= 0; i--) {
    const s = storms[i];
    s.t += dt;
    /* 一團一團地聚出來。照時間算「現在該有幾團」而不是每幀累加固定的量：
       累加的話 dt 一變（4 倍速、掉幀）聚雲的快慢就跟著跑。 */
    const want = Math.min(STORM_PUFF, Math.round(STORM_PUFF * s.t / STORM_GROW));
    while (s.puffs.length < want) s.puffs.push(popPuff(s));
    /* 歸位點自己慢慢飄（本來就有的那股 churn），每一團再往自己的歸位點逼近。
       指數逼近而不是等速：剛出場那一下最快，快到位時慢下來，像被吸過去。 */
    const pull = 1 - Math.exp(-STORM_PULL * dt);
    for (const q of s.puffs) {
      q.hx += q.vx * dt; q.hz += q.vz * dt;
      q.x += (q.hx - q.x) * pull;
      q.y += (q.hy - q.y) * pull;
      q.z += (q.hz - q.z) * pull;
      q.ry += dt * 0.22;
    }
    if (s.left > 0) {
      s.next -= dt;
      if (s.next <= 0) { strike(s); s.left--; s.next = rr(STORM_GAP[0], STORM_GAP[1]); }
    } else {
      /* 劈完了：整朵縮掉再收。直接 splice 的話一朵雲會「啪」地整團消失。 */
      s.out += dt;
      const k = Math.pow(0.5, dt / STORM_FADE);
      for (const q of s.puffs) q.s *= k;
      if (s.out > STORM_FADE * 3) storms.splice(i, 1);
    }
  }
  if (!storms.length) storms = null;
  stormEnd();
}
/* 塵霧與烏雲共用同一顆 mesh（還是一個 draw call），但烏雲**不放進 dust 那一池**：
   spawnDust／spawnRing／煙塵那些都拿 dust.length 當配額關卡（超過 400 就不再生），
   一朵一百五十團的雲擠進去會把雷自己的揚塵整個擋掉。
   接在後面而不是前面：真的滿到 MAXDUST 時，被切掉的該是雲的尾巴，不是打擊感。
   重用同一個陣列，不要每幀配置一個新的。 */
const dustAll = [];
function dustList() {
  if (!storms) return dust;
  dustAll.length = 0;
  for (const d of dust) dustAll.push(d);
  for (const s of storms) for (const q of s.puffs) dustAll.push(q);
  return dustAll;
}

/* ── 王之財寶（v1.132）─────────────────────────────────
   使用者指定的順序就是這支的骨架：點地面 → **參考鏡頭方向**開出一整片金色的圓（由小而大）
   → 冷兵器從圓心慢慢伸出來、一半留在圓外 → 全部就位後停 3 秒 → 對範圍內的隨機位置
   連射 7 秒（不規則，不是一波一波）→ 射出去的那個圓縮小消失、換個位置再開 →
   打中積木就炸開一個小缺口、兵器掉到地面，打空地就插在地上，最後都慢慢消失。
   出自 Fate 系列的〈王之財寶〉。

   四件事跟別的道具不一樣，寫在這裡免得日後看不懂：

   ① **門的朝向就是兵器的朝向**（v1.132.1 改；v1.132.0 是一律正對鏡頭的公告板）。
      門是虛空裂開的一個洞，兵器從洞裡垂直探出來，所以斜著看時它本來就該是橢圓
      （使用者：「同心波紋 不一定是正對鏡頭的圓」）。而「參考鏡頭方向」指的是
      **兵器往鏡頭的方向伸出來**——所以門陣鋪在「鏡頭看過去」那個方向的橫斷面上、
      整片退到場心的**另一側**（GATE_BACK），建築剛好站在門陣與鏡頭之間，
      兵器朝著鏡頭往下射進工地（參考圖那個構圖）。
      不能用魔法陣那組環：那組是**貼地**的（引擎裡 rotation.x 寫死 −π/2）。

   ①' **還沒伸出來的那一段真的不畫**（v1.132.1，使用者回報）。每一把兵器帶一個
      世界座標的切面（w.cut，面就是它那個門所在的平面），比那個面後面的片元在
      shader 裡直接 discard。v1.132.0 是靠門那片圖去擋，只擋得住它蓋得到的地方——
      斜著看的時候柄會從門的邊上露出來。

   ② **沒有燃燒效果**（使用者指定：「類似打雷 但是沒有燃燒效果」）。所以它只走槌子那條
      smash()，不叫 igniteAround——這正是它跟打雷最大的差別（打雷的傷害其實在火不在力，
      見 BOLT_FIRE_*）。

   ③ **不震、不出聲（指 smash 那一聲）**。七秒射一百多發，每一發都震的話畫面會抖到結束
      （見〈會「持續破壞」的不震畫面〉）；聲音同理，讓給它自己那聲短促的金屬撞擊。

   ③' **插著／躺著的兵器是「慢慢變淡」消失**（v1.132.1，使用者回報：本來是縮小）。
      走的是逐 instance 的不透明度（w.fade → 引擎的 aFade），不是把長度乘小——
      縮小看起來像被吸走，不像化掉。

   ④ **門與兵器是兩份清單**。門收掉之後兵器還在飛、還躺在地上慢慢淡，所以 weapons
      不掛在 gates 底下——一發打完 gates 變 null，weapons 得自己活到最後一把淡完。 */
const GATE_N = 100;              // 一次開幾個門（使用者：「先預計 100 個」）
/* 門陣的形狀。100 個門排成抖動格點——純隨機撒的話會擠出一塊塊空洞與疊死的堆，
   參考圖裡那是**鋪得很勻但不整齊**的一片。

   多寬多高**跟著建築走**（見 gateSpan）：寫死 62×32 的時候，打台北 101（高 65）
   得把鏡頭退到看得下整棟的距離，那片門在畫面上只剩中間一小塊（截圖比對過）。
   欄列數再從長寬比算回來，格子才會接近正方形；門的半徑是格子邊長的幾成，
   所以不管建築是矮胖還是細高，門與門的疏密都一樣。

   v1.132.1 整片**放寬、壓低**（使用者：「排列應該要偏向比較寬 上下高度比較低一點
   ⋯⋯目前看起來像正方形」）：參考圖那是一道橫著鋪開的牆。細高的建築最明顯——
   台北 101 本來算出來是 48.7 寬 × 64.8 高（直的），現在有一條「高不得超過寬的
   1/GATE_FLAT」把它壓回橫的。單雙列再各自錯開半格、抖動放大到四分之一格，
   才不會看得出是格點。 */
/* 前後再抖多厚（門陣要有遠近，不是一片貼紙）。**只往離鏡頭遠的那一側抖**：
   往兩側抖的話門陣的近面會落在 GATE_BACK − 5 ＝ 19，比打擊範圍 22 還近，
   最遠那一圈落點就跑到門的後面去了，瞄過去的那幾把變成背對鏡頭飛
   （實測 100 把裡漏 1 把）。單側抖之後近面就是 GATE_BACK 本身。 */
const GATE_DEEP = 5;
/* 整片門陣是**凹的**（v1.132.2 使用者：「就位也可以加一點弧度（像凹面鏡）」）：
   邊上的門往鏡頭這一側凸出來、中間留在最深處，一整片像一面對著工地的凹面鏡。
   這是曲率半徑（球面的 sagitta ＝ 離中心多遠的平方 ÷ 2R），55 的話最外圈那一排
   往前凸 8 單位（門陣半寬 30）。試過 90（凸 5），從玩家的鏡頭幾乎看不出是弧的；
   55 才讀得出整片是「兜著工地的一面凹鏡」。上限在近面：門陣近面 ＝ GATE_BACK − sagitta，
   要遠大於落點沿視軸能落到多深（±6.6），55 算出來是 16.6，還有一大截。 */
const GATE_BOWL = 55;
const GATE_RAD = [0.31, 0.50];   // 門的半徑是格子邊長的幾成（範圍拉開一點，比較不整齊）
const GATE_FLAT = 2.2;           // 高最多是寬的幾分之一
/* 門陣擺在場心的**另一側**多遠（背對鏡頭那一側）——所以兵器是朝著鏡頭、
   往下射進工地，建築剛好站在門陣與鏡頭之間（參考圖就是這個構圖）。

   為什麼是這一側而不是鏡頭這一側（第一版擺錯邊，截圖比對才發現）：
   門是一片正對鏡頭的公告板，它**不寫深度但會測深度**，所以「比門近的」畫在門上面、
   「比門遠的」被門擋掉。兵器停在門心時剛好一半在門前、一半在門後——
   要讓露出來的是**刃**而不是柄，刃就得朝著鏡頭；刃朝鏡頭 ＝ 它是朝鏡頭飛的 ＝
   門陣在建築後面。擺在鏡頭這一側的話露出來的會是柄與劍柄頭，刃反而整支埋在門裡。

   **這個數要大於落點能落到多深**：落點落在門陣**後面**的話，瞄過去的那幾把就變成背對
   鏡頭飛（v1.132.1 實測 100 把裡有 1～11 把是這樣，露出來的是柄）。v1.132.1 的落點是
   「場心 22 以內隨機」，所以門陣退 24、前後的抖動又只往遠處抖（見 GATE_DEEP），近面
   剛好壓在 24。v1.132.2 之後落點沿視軸只抖 ±6.6（GATE_SPRAY × 打擊範圍），而凹面鏡
   最多把邊上那一排往前推 8（見 GATE_BOWL）＝ 近面 16.6，離 6.6 還有一大截。 */
const GATE_BACK = 24;
/* 兩下點得比這近就退回舊取景（見 castGate）。門陣的凹面自己就有 8 格深。 */
const GATE_NEAR = 10;
const GATE_AIM_R = 6;               // 第一下在地上畫的那圈光環多大
const GATE_AIM_C = 0xffd24a;        // 金色（同門陣）
/* 門陣中心擺多高。**v1.132.1 整片壓低**（本來是 0.6 倍樓高 + 20、下限 32）：
   使用者要的是「兵器往鏡頭的方向伸出來」，而門的朝向就是兵器的朝向——門陣擺太高的話
   兵器是**朝下**射的，門於是變成幾乎側著看的一條扁橢圓（截圖比對過，像一片油漬）。
   壓到 0.55 倍樓高 + 8、下限 20 之後，加上落點改瞄建築的身體（見 aimGate），
   出手角度落在水平往下 20～30 度，門就轉回接近正圓、刃也變成朝著鏡頭的短樁
   ——參考圖就是這個樣子。 */
const GATE_UP = 0.5, GATE_UP_ADD = 6;
const GATE_Y0 = 12;              // 矮建築用的下限
const GATE_GROW = 0.55;          // 一個門張開要多久（由小而大）
const GATE_STAG = 1.5;           // 一百個門的出場錯開在這麼多秒裡
const GATE_DRAW = 0.7;           // 兵器從門心伸出來要多久
const GATE_HOLD = 2;             // 全部就位後停幾秒（v1.136 使用者：3 秒「停頓太久」）             // 全部就位後停多久（使用者指定）
const GATE_FIRE = 7;             // 連射多久（使用者指定）
/* 連射的節奏：平均每秒幾發，還有兩發之間的間隔可以差幾倍。
   **整發共用一個節奏器**，不是每個門各自抽自己的射擊時刻——後者做不出「從頭到尾
   一樣密」：一開始一百個門把第一發鋪在七秒裡（每秒 14 發），但一個門射完換位置再開
   只要兩秒多，於是後段是好幾輪疊起來的，密度一路往上爬（實測每半秒 5～9 發爬到
   26～36 發，前段稀後段擠）。改成節奏器之後密度就是這裡寫的數字，
   間隔再乘一個 0.4～1.6 的亂數 ＝ 忽快忽慢的不規則連射（使用者：「不要看起來像
   一堆同時發射一波一波的」）。28 發/秒 × 7 秒 ≈ 196 發。 */
const GATE_RATE = 28;
const GATE_JIT = [0.4, 1.6];
const GATE_SHUT = 0.3;           // 射完那個門縮掉要多久
/* 打哪裡：場心這個半徑內的隨機位置——但**跟著建築的外接半徑收**（見 gateZone）。
   固定 22 的話打細長的塔幾乎全落在空地上：實測台北 101（外接半徑 9.5）219 發只有
   53 發碰得到建築，整趟只掉 88 塊（3%）；羅馬競技場（18.3）則是 160 發、323 塊（11%）。 */
const GATE_ZONE = 13;
const GATE_ZONE_MIN = 10;
/* 落點怎麼抽（v1.132.2，使用者：「目前瞄準的方向太散了 要集中到點擊的附近的空間範圍
   （部分射歪沒關係）」）。v1.132.1 是每個門各自在場心那個圓盤裡亂抽一點——一百條線
   互相交叉，畫面上就是一把扇子往四面八方掃。而且**射歪的會歪很遠**：瞄的是半空中的
   一點，沒打到東西就沿著那條線繼續往下滑，仰角越平飛得越遠（實測落點離場心中位 13、
   四分之三位 30、最遠 218，而場地半徑才 18——那幾把等於射到畫面外去了）。

   改成三件事：
   ① 落點跟著這個門**自己的橫向位置**收縮 GATE_CONV 倍再加抖動 ＝ 一整片往內收的齊射，
      線不再互相交叉（也順帶讓出手角度天生就落在錐面內，被錐面夾到的從 44% 掉到 26%）；
   ② 瞄的高度**跟著這個門自己的高度**收（GATE_AIM_K 倍）：這樣「沒打到就一路滑出去」
      有一個**跟建築無關的上界**——瞄 h 高、門在 Y 高、水平距離 L，滑過頭的距離是
      h × L ÷ (Y − h)，把 h 綁成 K×Y 之後它就是 K ÷ (1−K) × L ＝ 定值（0.45 → 20 單位）。
      這一條是給細高建築用的：台北 101 的門陣在 27～50 高，先前拿「建築高度的一半」
      當上限＝瞄到 36 高，俯角只剩幾度，實測最遠落點 135～252（同一份設定跑兩次的差距
      就這麼大，尾巴本來就抖）。改成跟門自己的高度綁之後同一座收在 41～42。

   改完落點離場心（吉薩金字塔，外接半徑 18；只換 aimGate 這一支量的，其餘都一樣）：
   中位 13.4 → 9.8、四分之三位 30 → 12、九成位 61 → 14、最遠 218 → 29；
   打中積木的從 111 發變成 178 發。

   試過但**沒採用**：把整片門陣抬高（貼地那一排是平射的，直覺上該修）。量出來落點分布
   幾乎一樣（中位 7.7、九成位 12.4、最遠 87），而它會把 v1.132.1 剛調好的門陣高度動掉。 */
const GATE_CONV = 0.25;
const GATE_SPRAY = 0.25;         // 落點再抖多少（打擊範圍的幾成）
const GATE_AIM_K = 0.28;
/* ── 以下三個是「第二下點在建築上」那一發專用的（v1.152）─────────────
   點空地那一發全部走不到，行為跟 v1.151 逐字一樣。 */
/* 落點至少要比這個門低這麼多，才准瞄過去。飛行段沒有重力，瞄得比自己高的那一把
   出手就是往上飛（見下面那條「落點一定要比這個門低」）；差太少則等於平射。
   5 配上兩點最近的距離（GATE_NEAR＝10）是俯角 27 度，跟現在多數門的出手角度同一級。
   代價是**低於「點擊高度＋5」的門瞄不到那一點**，那些退回舊規則（見 aimGate）。 */
const GATE_DIP = 5;
/* 落點最多被「吸」到多遠的那一塊積木上（見 gateSpots／aimGate）。
   收在這一發自己的散布尺標（gateZone 是 10～13）：拉得比這更遠就不是「點擊位置附近」了，
   寧可讓那一把退回舊規則。 */
const GATE_SNAP = 12;
/* 瞄過那一塊積木、往下再飛這麼多還是什麼都沒碰到，就當它落空了（見 stepWeapons）。
   一塊積木高 1、刃尖又比重心前 len/2，所以 1.5 是「確實已經穿過去了」而不是還沒到。 */
const GATE_PASS = 1.5;
/* 推力斷掉之後，橫向速度每秒衰減的指數（v1.152.1）。**0 ＝ 純拋物線**，
   給一點阻力是為了把尾巴收住，不是為了讓它停下來：
   兵器出手 62／秒、俯角又被錐面壓在 41 度內，純拋物線從 39 高落下來要滑 76 格
   （實測台北 101 插在地上的九成位 87、最遠 97）——那是半片草地。
   0.8 一路減速到落地時剩三分之一（59 → 38／秒），畫面上還是一條看得出來的弧
   （泰姬瑪哈陵實測：橫向走 24 格的同時往下掉 10 格），尾巴收到九成位 58、最遠 66。
   **再大就不行**：2.4 的時候最後那一段橫向只剩 4／秒，等於又變回「扭一扭直直往下落」
   ——那正是 v1.152.0 被退回來的原因。 */
const GATE_DRAG = 0.8;
/* 出手方向最多能偏離「朝著鏡頭」這個軸幾弧度。

   為什麼要管：**門的朝向就是兵器的朝向**，所以方向偏多少、門就側多少。各自瞄自己的
   落點時，站在門陣邊上的那些要瞄到另一側，方向會偏到六七十度——那個門在畫面上就是
   一條線（截圖比對過，整片像一片油漬）。
   為什麼不能一律拉平：拉平就等於整片平行射出去，落點只剩門本身的位置在散，
   打不打得到建築全看運氣（實測命中率從 47% 掉到 10%、破壞量剩四分之一）。

   所以是**錐形夾角**：方向照樣各自瞄落點（會收斂到建築上），只有超出這個錐面的那些
   才沿著大圓拉回錐面上。軸取「水平、朝著鏡頭」，0.72 rad ≈ 41 度。

   為什麼是這一條軸、這個角度：兵器要打到建築就得往下飛，而鏡頭本身是**由上往下**
   看的（俯角約 24 度），所以「往下飛的兵器」跟「視軸」天生就差 40～60 度——這是
   幾何上跑不掉的，門本來就不會是正圓。能做的是別讓它更糟：把方向夾在水平軸附近
   41 度內，門偏離視軸就落在 24～65 度、短軸 0.4 以上，讀得出是個圓；
   而多數的門根本沒被拉到，所以還是各自瞄各自的落點（命中率保住）。 */
const GATE_CONE = 0.72;
const GATE_SPD = 62;             // 兵器飛多快
const GATE_FLY_MAX = 5;          // 飛這麼久還沒碰到東西就收掉（保險，見 stepWeapons）
const GATE_HIT_R = 1.5;          // 打中的地方咬掉多大一片（雷是 1.84）
const GATE_HIT_POW = 12;         // 力道（雷 13、投石機 12、槌子 15）
/* 兵器全長是它那個門半徑的幾倍。v1.132.0 卡在 1.3～1.6，因為那時候「埋在門裡那一半」
   是靠門那片圖擋住的，半長超過門半徑柄就會從邊上戳出來。v1.132.1 改成 shader 切面之後
   這條限制沒了（見檔頭 ①'），所以照參考圖的比例重訂：
   刃是**斜對著鏡頭**探出來的（與視軸夾角中位數 38 度），所以畫面上看到的長度只有
   半長的 sin38° ≈ 0.62 倍。要讓刃尖大約落在門的邊上，半長就得是門半徑的 1.6 倍左右
   ——全長 2.8～3.6 倍半徑（再乘每一種自己的長度倍率 0.72～1.18）剛好跨在那個值兩邊，
   於是有的收在門裡、有的探出邊緣，跟參考圖一樣。
   v1.132.2 使用者要「長度也縮小一點」，所以收成 2.5～3.2；門的半徑（GATE_RAD）
   **同步收一成**，不然刃尖會整個退回門裡去（比例是這兩個數的比，不是各自的絕對值）。 */
const GATE_LONG = [2.5, 3.2];
/* 每一種兵器的長度倍率（造型表在引擎的 WEAP_KIND，那邊一律正規化成長度 1）。
   順序：劍、大劍、刀、矛、戟、騎槍、短劍。 */
const WEAP_SCALE = [1, 1.18, 1, 1.15, 1.12, 1.05, 0.72];
/* 插在地上時刃尖沒入地面多深。**跟俯角成正比**（越斜插得越深，最淺三成）：
   一律 0.4 的話，擦著地面進來的那些整把會埋在草皮下（實測重心到 y=−0.03）。 */
const GATE_INTO = 0.4;
const GATE_STICK_MIN = 0.12;     // 俯角的正弦要大於這個才插得住，不然是躺平（7 度）
const GATE_LIE = [1.4, 2.8];     // 掉在地上／插在地上撐多久才開始淡
const GATE_FADE = 1.6;           // 淡多久（透明度歸零，再化成金色光塵）
/* 化成金光的速度是淡出的幾倍（v1.148）。1.8 ＝ 不透明度掉到 0.45 時金光已經滿格，
   剩下那 0.45 是「一團完整的金色形體慢慢消失」的那一段。 */
const GATE_GLOW_K = 1.8;
/* 場上最多幾把。要 **≤ 引擎的 WEAP_MAX（360）**——超過的會被 putWeapons 默默切掉，
   而被切掉的是清單後面那些＝最新射出來的那幾把。
   量過的峰值：門裡待發 100 ＋ 飛在半空約 15 ＋ 躺著還沒淡完的約 90。 */
const WEAP_KEEP = 560;
/* 同時最多幾組（v1.136，使用者：「可以同時存在多組(3組)」）。算的是「還在開新門」的組——
   推進收尾的那些不占名額（它們不再開新門，只是把手上的射完，見 drainGate）。 */
const GATE_SETS = 3;
/* 連收尾中的一起算的硬上限。收尾要三秒多，一直點下去還是會疊上去；
   超過就把最早那一組直接撤掉——不擋的話門與兵器沒有上限，每幀成本與 WEAP_KEEP 都撐不住。 */
const GATE_KEEP = 5;

/* 點下去。一次一發（一發就是一百個門、連射七秒），還在跑的時候再點就換新的一發——
   同其他清單型道具「滿了把最早那個擠掉」的規矩。舊那一發的門當場收掉，
   但**已經射出去的兵器不收**：它們在 weapons 裡，會自己飛完、自己淡掉。 */
/* 第一下決定門陣開在哪，第二下決定打哪裡（v1.135，使用者指定）。
   跟保齡球、龍捲風共用同一套兩段點擊（aimFirst ＋ 地面那圈光環，見 AIM_RING）。 */
/* 第二下點在**建築**上時，那一點的高度也算目標（v1.152，使用者：「第二下也能點擊
   建築做目標（點擊位置的一個空間範圍 目前好像會在點擊位置的平面座標地面上）」）。
   點空地的那一下照舊（onBlock 為假 ＝ 不指定高度，落點回到「瞄建築的身體」那條規則，
   見 aimGate）——使用者要的是「**也**能」，本來就能用的那一種不動。 */
function pickGate(point, onBlock) {
  if (!aim) { aimFirst(point, GATE_AIM_R, GATE_AIM_C); return; }
  castGate(aim, point, onBlock ? point.y : 0);
}
/* from＝門陣開在哪（第一下），toward＝打哪裡（第二下）。
   v1.135 之前是一個點：目標由點擊決定，門陣自己退到「鏡頭方向的另一側 GATE_BACK 遠」。 */
function castGate(from, toward, aimY) {
  aim = null;
  const ty = aimY > 0 ? aimY : 0;         // 0 ＝ 沒指定高度（點空地／舊的單點呼叫）
  if (!gates) gates = [];
  /* 名額（v1.136）。滿了就把最早那一組推進收尾：它不再開新的門，把還裝著兵器的門
     射完就收（使用者：「結束的時候繼續把還有武器的門射完」）——v1.135 之前是連門帶
     兵器一起撤掉，等於一發有一百把兵器憑空消失。 */
  const live = gates.filter(q => q.ph !== 'drain');
  for (let i = 0; i <= live.length - GATE_SETS; i++) drainGate(live[i]);
  while (gates.length >= GATE_KEEP) closeGate(gates[0]);
  /* f＝從目標看回門陣（門陣的深度方向），a＝兵器飛出去的方向，u＝門陣的橫向。
     兩點太近就退回 v1.135 之前的取景（照鏡頭方向、退到另一側 GATE_BACK 遠）：
     門陣自己的凹面就有 8 格深（GATE_BOWL 的 sagitta），目標比 GATE_NEAR 還近的話
     它整個落在門陣裡面，兵器等於從目標背後往回射。 */
  let dx = from.x - toward.x, dz = from.z - toward.z;
  let d = Math.hypot(dx, dz);
  if (d < GATE_NEAR) {
    const yaw = ENG.cam.yaw;
    dx = -Math.cos(yaw) * GATE_BACK; dz = -Math.sin(yaw) * GATE_BACK; d = GATE_BACK;
    from = { x: toward.x + dx, z: toward.z + dz };
  }
  const fx = dx / d, fz = dz / d;
  const ux = -fz, uz = fx;

  const sp = gateSpan();
  /* 門陣高度**沒有跟著目標動**（v1.152 試過，被實測擋下來）：把整片抬到目標上方之後，
     門陣就整個高過屋頂，被錐面拉平的那些會從屋頂上空掠過去——泰姬瑪哈陵打掉的積木
     2275 → 798、插在地上的最遠 17 → 131；抬到「俯角夠陡、滑不遠」的高度更慘，
     台北 101 一整趟只打中 6 發。高門陣搆不到低處是錐面的硬限制（見 aimGate 的 lo），
     所以維持原高度，改用「搆得到的門才瞄那一點」（見 aimGate）。 */
  const y = Math.max(GATE_Y0, (bp ? bp.height : 0) * GATE_UP + GATE_UP_ADD);
  const g = {
    x: toward.x, z: toward.z, y, ty, fx, fz, ux, uz,
    /* 錐形夾角的軸：水平、朝著鏡頭（見 GATE_CONE）。**一定要在這裡就給值**——
       下面那個迴圈開門時就會叫 aimGate 用到它，留到迴圈後面才設的話，整趟的錐形
       夾角都是拿 (0,0,0) 當軸在算：夾角不會生效，而且回傳的方向長度變成 sin(錐角)
       ＝ 0.659（不是單位向量），門的朝向、切面的法線、飛行速度全部跟著錯。 */
    ax: -fx, ay: 0, az: -fz,
    cx: from.x, cz: from.z, back: d,          // back＝門陣離目標多遠（aimGate 的錐面下限要用）
    /* 點在建築上時，落點要吸到的那一批積木（v1.152，見 gateSpots）。整發收一次。 */
    spots: ty > 0 ? gateSpots(toward.x, ty, toward.z) : null,
    w: sp.w, h: sp.h, cols: sp.cols, rows: sp.rows,
    ph: 'open', t: 0, fireT: 0, next: 0, ports: []
  };
  if (!weapons) weapons = [];
  for (let i = 0; i < GATE_N; i++) g.ports.push(newPort(g, i, Math.random() * GATE_STAG));
  gates.push(g);
  /* 順手把鏡頭退到看得見整片門的距離（跟烏雲、蘑菇雲共用 ENG.holdWide）。
     門陣飄在屋頂上方，矮建築的預設取景只看得到 26 以下——不退的話點下去
     整片門都在畫面外。第三個參數 true ＝ **用完要還**（v1.128 使用者指定的那條規矩：
     會把鏡頭往高處帶的運鏡，結束後高度要調回來），在 gateEnd() 還。 */
  gateHold++;
  ENG.holdWide(y + sp.h * 0.5, Math.max(sp.w * 0.5, bp ? bp.radius : sp.w * 0.5), true);
  sndGate();
}
/* 還欠幾次「把視線高度還回去」。連點會換發，所以要記次數——同 stormHold。 */
let gateHold = 0;
function gateEnd() {
  if (gates) return;
  while (gateHold > 0) { gateHold--; ENG.releaseWide(); }
}
/* 把一組門收掉。門裡還沒射出去的那把兵器跟著撤掉：它從來沒離開過門，
   留在地上會變成憑空掉下來的一把鐵。
   正常收場是走 drainGate（射完才收），這裡只剩兩種：收尾跑完了（那時候門都空了），
   以及硬上限踢掉最早那一組。 */
function closeGate(g) {
  if (!gates) return;
  const i = gates.indexOf(g);
  if (i < 0) return;
  for (const p of g.ports) if (p.w) { dropWeapon(p.w); p.w = null; }
  gates.splice(i, 1);
  if (!gates.length) gates = null;
}
/* 收尾（v1.136，使用者：「結束的時候繼續把還有武器的門射完」）：不再開新的門，
   照原本的節奏把還裝著兵器的門射完，全部熄掉才收。
   不必在這裡做別的事——「射完換個位置再開」那一段的條件是 ph === 'fire'，
   改成 drain 之後射完的門自然就熄掉不再生；還在張開／伸出的那些照樣會走到 ready，
   然後被這一輪節奏器射出去。 */
function drainGate(g) {
  if (g.ph === 'open' || g.ph === 'hold' || g.ph === 'fire') g.ph = 'drain';
}
/* 門陣多寬多高、切幾欄幾列。寬跟著外接半徑、高跟著樓高，兩邊各自夾在一個區間裡
   （太小的話一百個門會疊成一坨，太大的話鏡頭要退到門變成一片小點）。
   欄數由長寬比算：cols × rows ≈ GATE_N 而且 cols/rows ≈ w/h，
   解出來就是 cols = √(N × w ÷ h)，這樣格子才會接近正方形。 */
function gateSpan() {
  const R = bp ? bp.radius : 18, H = bp ? bp.height : 15;
  /* 寬度直接決定鏡頭要退多遠（holdWide 拿它當取景半徑），所以不能一味放寬——
     放到 80 的時候整片門在畫面上反而變小、變遠。收到「外接半徑的兩倍多一點」，
     鏡頭近了，門就大了。 */
  const w = clamp(R * 2.2 + 20, 50, 100);
  const h = Math.min(clamp(H * 0.5 + 14, 22, 46), w / GATE_FLAT);
  const cols = Math.max(4, Math.round(Math.sqrt(GATE_N * w / h)));
  return { w, h, cols, rows: Math.ceil(GATE_N / cols) };
}
/* 一個門的位置。抖動格點：單雙列各自錯開半格，每一格的中心再往四周抖四分之一格——
   純隨機撒會擠出空洞與疊死的堆，參考圖那是「鋪得勻但不整齊」的一片。
   i 給 −1 就是隨機挑一格（射完換位置時用，見 stepGates）。 */
function portSpot(g, i) {
  const n = i < 0 ? Math.floor(Math.random() * g.cols * g.rows) : i;
  const col = n % g.cols, row = Math.floor(n / g.cols);
  const cw = g.w / g.cols, ch = g.h / g.rows;
  const u = ((col + 0.5 + (row % 2 ? 0.5 : 0)) / g.cols - 0.5) * g.w + rr(-1, 1) * cw * 0.25;
  const v = ((row + 0.5) / g.rows - 0.5) * g.h + rr(-1, 1) * ch * 0.25;
  const d = rr(0, GATE_DEEP) - (u * u + v * v) / (2 * GATE_BOWL);   // 凹面鏡，見 GATE_BOWL
  return { x: g.cx + g.ux * u + g.fx * d, y: g.y + v, z: g.cz + g.uz * u + g.fz * d,
           u: u, r: Math.min(cw, ch) * rr(GATE_RAD[0], GATE_RAD[1]) };
}
/* 開一個門，並且在門裡放一把兵器。delay＝這個門晚幾秒才開始張開。 */
function newPort(g, i, delay) {
  const sp = portSpot(g, i);
  const p = {
    x: sp.x, y: sp.y, z: sp.z, r: sp.r,
    /* 這個門在門陣裡的橫向偏移。aimGate 拿它算落點（見 GATE_CONV），
       所以**一定要在這裡就給值**——下面 newWeapon 就會用到。 */
    u: sp.u,
    rot: Math.random() * Math.PI * 2, spin: rr(0.35, 0.9) * (Math.random() < 0.5 ? -1 : 1),
    ph0: Math.random() * Math.PI * 2,             // 亮度脈動的相位（每個門各自呼吸）
    /* 這個門的朝向 ＝ 從它探出來那一把的方向（見 newWeapon）。存在門身上是因為
       射出去之後那個門還要縮 GATE_SHUT 秒，那時候 p.w 已經是 null 了。 */
    dx: 0, dy: 0, dz: -1,
    t: -delay, st: 'grow', k: 0, k0: 1, op: 0, w: null
  };
  p.w = newWeapon(g, p);
  /* 擺到「整把都在切面後面」的起始位置（v1.132.2 使用者：「同心波紋先出現 然後武器
     才伸出來（現在是武器出現 然後消失 波紋出現武器伸出來）」）。newWeapon 生出來的
     那一刻兵器是**擺在門心**的，一半在切面前面 ＝ 看得見；而這個門要等 delay 秒才輪到
     出場（p.t < 0 那段 stepGates 是 continue 掉的，不會叫 posInGate），所以開場那一下
     有七八十把半截兵器浮在空中、等輪到它才縮回門裡（實測 0.3 秒時 84 個門全是這樣）。 */
  if (p.w) posInGate(p);
  return p;
}
/* 這一發打得多開。上限是 GATE_ZONE，但細的建築要收進來——
   1.25 倍外接半徑是「整棟都在範圍內、外面再留一圈」。v1.132.2 起它是**抖動的尺標**
   （落點抖多遠、見 GATE_SPRAY），不再是「在這個圓盤裡亂抽一點」。 */
function gateZone() {
  return clamp((bp ? bp.radius : GATE_ZONE) * 1.25, GATE_ZONE_MIN, GATE_ZONE);
}
/* 點擊那一點附近**還站著**的積木（v1.152）。castGate 收一次、整發共用；
   途中被打掉的那些在 aimGate 用 b.st !== SET 濾掉，不必重收。
   收的半徑就是這一發的散布尺標（gateZone），跟落點的抖動同一個量級。 */
function gateSpots(x, y, z) {
  const R = gateZone(), R2 = R * R, out = [];
  for (const b of blocks) {
    if (b.st !== SET) continue;
    const dx = b.x - x, dy = b.y - y, dz = b.z - z;
    if (dx * dx + dy * dy + dz * dz <= R2) out.push(b);
  }
  return out.length ? out : null;
}
/* 這一把要射去哪：點擊處附近的一點，橫向跟著這個門自己的位置收縮（見 GATE_CONV）。
   回傳的是**指向**——兵器在門裡就照這個方向擺，
   所以「伸出來的那一半」指的已經是它等一下要飛的方向。 */
function aimGate(g, p) {
  const z = gateZone();
  /* 落點：把這個門自己的橫向偏移收縮 GATE_CONV 倍當中心，再抖 GATE_SPRAY（見那邊）。
     縱深（沿著視軸）愛抖多少都行——那個方向順著飛行方向，不會把出手角度撐開。 */
  const lat = p.u * GATE_CONV + rr(-1, 1) * z * GATE_SPRAY;
  const dep = rr(-1, 1) * z * GATE_SPRAY;
  /* 瞄的高度**跟著建築的身體**，不是只瞄腳邊（v1.132.1）：只瞄地面的話出手角度會被
     壓成一路往下，門跟著側過去（見 GATE_UP）。上限則是**這個門自己高度的 GATE_AIM_K 倍**
     （v1.132.2）——瞄越高俯角越平，沒打到的那一把就滑得越遠，綁在門的高度上才有定值上界。 */
  /* 落點一定要**比這個門低**（v1.132.1）：門陣壓低之後有近一半的門低於建築頂，
     瞄上去的那些會斜著往上飛——飛行段沒有重力，它就永遠不落地了（實測一趟結束
     還有 30 把掛在場上）。 */
  /* 瞄的**下限**是「錐面夠不夠得到」（v1.133.1）。被錐面夾住的那一把一定偏，而且偏的
     方式是最壞的那種——俯角被拉平 → 飛得更遠。細高建築就是這樣爆掉的：台北 101 的門陣
     在 50 高，瞄 14 高需要俯角 59 度，夾成 41 度之後從 50 高飛出去要 57 單位才落地，
     落點落在目標外 33（實測九成位 32.4）。所以下限取「錐面剛好夠得到的那個高度」
     ＝ 門高 − tan(錐角) × 水平距離：瞄得到的地方才瞄，這一把就真的會落在範圍裡。
     矮建築（門陣本來就低）算出來是負的，等於沒有這條限制。 */
  const lo = Math.max(0.3, p.y - Math.tan(GATE_CONE) * (g.back || GATE_BACK));
  /* 第二下點在建築上的那一發（v1.152，g.ty > 0）瞄的是**點擊的那一點**，不是上面
     那條「建築的身體」。三個軸都用同一個尺標抖（gateZone × GATE_SPRAY），所以落點是
     點擊位置附近的一顆球——使用者要的那個「空間範圍」。
     高度夾在 [lo, 這個門再低 GATE_DIP] 之間，所以**低於「點擊高度＋5」的門瞄不到
     那一點**，它們退回下面那條舊規則。實測（第一下點在建築外 20 格）：台北 101 打中的
     高度中位數 12.5 → 31.5（點在 39 高，打中的發數兩邊都是 165）、泰姬瑪哈陵 3 → 11
     （點在 15.6）——上半片門陣轉過去打，下半片照舊在啃底下那一段，
     整體看得出火力被拉到點擊的高度，而且火力沒有變弱。 */
  const bx = g.x + g.ux * lat + g.fx * dep, bz = g.z + g.uz * lat + g.fz * dep;
  const cone = Math.cos(GATE_CONE);
  const aimAt = (tx, ty2, tz) => {
    let dx = tx - p.x, dy = ty2 - p.y, dz = tz - p.z;
    const L = Math.hypot(dx, dy, dz) || 1;
    return { dx: dx / L, dy: dy / L, dz: dz / L };
  };
  let d = null;
  if (g.ty > 0) {
    const hiY = Math.max(lo, p.y - GATE_DIP);
    const aimH = clamp(g.ty + rr(-1, 1) * z * GATE_SPRAY, lo, hiY);
    /* 再把落點**吸到最近的那一塊還站著的積木上**。
       為什麼一定要吸：沒打到的那一把不會停，它照原方向一路滑到落地為止，而瞄得越高
       滑得越遠（滑過頭的距離 ＝ 落點高度 × 水平距離 ÷ 落差）。只瞄「點擊位置附近的
       一顆球」的話，球心多半落在建築外面的空氣裡——實測瞄八成樓高：台北 101 打中
       168 → 20 發、插在地上的最遠 43 → 262，泰姬瑪哈陵 203 → 68 發、13.5 → 134，
       整片門射出去的東西大半飛出場外。吸到積木上之後這條線一定終止在實心裡。
       只收 [lo, hiY] 之間的：太低的錐面搆不到、太高的落不下來（同上面那兩條）。
       一塊都合格不了（那一片打光了、或這個門搆不到）就退回下面那條舊規則。 */
    let best = null, bd = GATE_SNAP * GATE_SNAP;
    if (g.spots) for (const b of g.spots) {
      if (b.st !== SET || b.y > hiY || b.y < lo) continue;
      const ddx = b.x - bx, ddy = b.y - aimH, ddz = b.z - bz;
      const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
      if (d2 < bd) { bd = d2; best = b; }
    }
    /* **搆得到才瞄**：算出來的方向被錐面夾到的話就不用它——被夾的那一把方向會被拉平，
       既打不到點擊的那一點、又因為俯角變小而滑得特別遠（實測整片門陣都瞄過去時，
       插在地上的最遠從 17 變成 131）。那種就退回下面那條舊規則，跟 v1.151 一樣。 */
    if (best) {
      const q = aimAt(best.x, best.y, best.z);
      if (q.dx * g.ax + q.dy * g.ay + q.dz * g.az >= cone) { d = q; d.aimY = best.y; }
    }
  }
  if (!d) {
    const top = Math.max(lo + 0.5,
      Math.min(Math.max(2, (bp ? bp.height : 12) * 0.9), Math.max(0.8, p.y * GATE_AIM_K)));
    d = aimAt(bx, rr(lo, top), bz);
  }
  let dx = d.dx, dy = d.dy, dz = d.dz;
  /* 夾進以「朝著鏡頭」為軸的錐面內（見 GATE_CONE）。超出去的沿著大圓拉回錐面上：
     把方向拆成「軸向」與「垂直軸的那一截」，再照 cos／sin 重組——這是精確解，
     不是逼近，而且錐內的方向原封不動。 */
  const ax = g.ax, ay = g.ay, az = g.az;         // 朝著鏡頭（含俯角）
  const dot = dx * ax + dy * ay + dz * az;
  const aimY = d.aimY || 0;
  if (dot >= cone) return { dx, dy, dz, aimY };
  let px = dx - ax * dot, py = dy - ay * dot, pz = dz - az * dot;   // 垂直軸的那一截
  const pl = Math.hypot(px, py, pz) || 1;
  px /= pl; py /= pl; pz /= pl;
  const sn = Math.sin(GATE_CONE);
  return { dx: ax * cone + px * sn, dy: ay * cone + py * sn, dz: az * cone + pz * sn, aimY: 0 };
}
function newWeapon(g, p) {
  const k = Math.floor(Math.random() * WEAP_SCALE.length);
  const len = p.r * rr(GATE_LONG[0], GATE_LONG[1]) * WEAP_SCALE[k];
  const a = aimGate(g, p);
  if (!weapons) weapons = [];
  /* 額度滿了就把最早那把「已經躺在地上」的收掉。躺著的才收：飛在半空的收掉會
     憑空消失，門裡那把收掉等於這個門啞了。 */
  if (weapons.length >= WEAP_KEEP) {
    const i = weapons.findIndex(w => w.st === 'lie');
    if (i < 0) return null;
    weapons.splice(i, 1);
  }
  /* cut ＝ 這個門所在的平面（法線就是兵器的方向、面過門心）。比這個面後面的片元
     在 shader 裡被 discard，所以「還沒伸出來的那一段」是真的不存在，不是被擋住。
     順便：還沒輪到出場的門，兵器整把都在面後面，自然什麼都看不到
     （v1.132.0 是靠「長度先給 0」擋的，那招在切面上位之後就不需要了）。 */
  const w = {
    x: p.x, y: p.y, z: p.z, dx: a.dx, dy: a.dy, dz: a.dz,
    roll: Math.random() * Math.PI * 2, len, k, s: len, aimY: a.aimY || 0,
    cut: [a.dx, a.dy, a.dz, a.dx * p.x + a.dy * p.y + a.dz * p.z],
    st: 'gate', out: 0, vx: 0, vy: 0, vz: 0, drop: 0,
    ax: 0, ay: 0, az: 0, spin: 0, lie: 0, fade: 1, glow: 0, em: 0, age: 0
  };
  p.dx = a.dx; p.dy = a.dy; p.dz = a.dz;         // 門跟著兵器擺（見 newPort）
  weapons.push(w);
  return w;
}
/* 撤掉一把（門裡那把沒射出去就被收走）。 */
function dropWeapon(w) {
  const i = weapons ? weapons.indexOf(w) : -1;
  if (i >= 0) weapons.splice(i, 1);
}
/* 射出去。門跟著縮掉（使用者：「兵器射出後 黃色魔法縮小消失」）。 */
function fireGate(g, p) {
  const w = p.w;
  p.w = null; p.st = 'shut'; p.t = 0; p.k0 = p.k;
  if (!w) return;
  w.st = 'fly';
  w.cut = null;                                  // 離開門了，整把都該看得見
  w.vx = w.dx * GATE_SPD; w.vy = w.dy * GATE_SPD; w.vz = w.dz * GATE_SPD;
  sndBlade();
}
/* 隨機挑一個已就位的門。從隨機一格起往後找，不 filter 出一個新陣列——
   這是每秒要跑二十幾次的路徑。 */
function pickReady(g) {
  const n = g.ports.length, s0 = Math.floor(Math.random() * n);
  for (let i = 0; i < n; i++) {
    const p = g.ports[(s0 + i) % n];
    if (p.st === 'ready') return p;
  }
  return null;
}
function stepGates(dt) {
  stepWeapons(dt);                    // 兵器自己飛：門收掉了也要繼續
  if (!gates) { gateEnd(); return; }
  // 倒著跑：收工的那一組會就地從清單上拿掉（closeGate）
  for (let i = gates.length - 1; i >= 0; i--) stepGate(gates[i], dt);
  gateEnd();
}
function stepGate(g, dt) {
  g.t += dt;
  let ready = 0;
  for (const p of g.ports) {
    p.t += dt;
    if (p.t < 0) continue;            // 還沒輪到這個門出場
    p.rot += p.spin * dt;
    if (p.st === 'grow') {
      /* 由小而大（使用者指定）。三次方的 ease-out ＋ 一點點過衝：
         線性放大看起來像貼圖被拉開，過衝才像「撐開」一個洞。 */
      const u = Math.min(1, p.t / GATE_GROW);
      const e = 1 - Math.pow(1 - u, 3);
      p.k = e * (1 + 0.10 * Math.sin(Math.PI * u));
      if (u >= 1) { p.st = 'draw'; p.t = 0; p.k = 1; }
    } else if (p.st === 'draw') {
      const u = Math.min(1, p.t / GATE_DRAW);
      if (u >= 1) { p.st = 'ready'; p.t = 0; }
    } else if (p.st === 'shut') {
      // 從「開始縮的那一刻有多大」縮起（k0）。一律從 1 縮的話，連射結束時
      // 那幾個才張開到一半的門會先「啪」地跳到全開再縮
      p.k = p.k0 * Math.max(0, 1 - p.t / GATE_SHUT);
      if (p.t >= GATE_SHUT) {
        /* 射完換個位置再開（使用者：「因為持續射擊 可以又在其他位置出現」）。
           時間不夠再走完一輪「張開 → 伸出 → 射」的就直接熄掉，
           不然連射結束的那一刻會有一排開到一半的門硬生生被切掉。 */
        const need = GATE_GROW + GATE_DRAW + 0.25;
        if (g.ph === 'fire' && g.fireT + need < GATE_FIRE) {
          const sp = portSpot(g, -1);
          p.x = sp.x; p.y = sp.y; p.z = sp.z; p.r = sp.r; p.u = sp.u;
          p.rot = Math.random() * Math.PI * 2;
          p.st = 'grow'; p.t = 0; p.k = 0;
          p.w = newWeapon(g, p);
        } else { p.st = 'off'; p.k = 0; }
      }
    }
    if (p.st === 'ready') ready++;
    /* 亮度：張開／縮掉照 k 走，開著的時候自己呼吸。門與門的相位是錯開的
       （ph0），整片才不會像同一顆燈泡在閃。 */
    p.op = (p.st === 'off' ? 0 : p.k) * (0.82 + 0.18 * Math.sin(g.t * 3.1 + p.ph0));
    // 門裡那把兵器：跟著門走，並且照 draw 的進度往外滑
    if (p.w) posInGate(p);
  }
  if (g.ph === 'open') {
    // 全部伸出、就定位了才開始數那三秒（使用者：「全部伸出就定位後 3秒」）
    if (ready >= g.ports.length) { g.ph = 'hold'; g.t = 0; }
  } else if (g.ph === 'hold') {
    if (g.t >= GATE_HOLD) { g.ph = 'fire'; g.fireT = 0; g.next = rr(0.05, 0.2); }
  } else if (g.ph === 'fire' || g.ph === 'drain') {
    if (g.ph === 'fire') {
      g.fireT += dt;
      // 連射時間到：不再開新的門，剩下的照原本的節奏射完（v1.136，見 drainGate）
      if (g.fireT >= GATE_FIRE) g.ph = 'drain';
    }
    /* 節奏器：時間到就隨機挑一個已就位的門射出去（見 GATE_RATE）。
       while 不是 if——一幀 dt 大於一個間隔時（4 倍速、掉幀）要補射，
       不然快轉時發數會憑空變少。 */
    g.next -= dt;
    while (g.next <= 0) {
      const p = pickReady(g);
      if (!p) break;                       // 全部都還在張開／伸出：這一發等下一幀
      fireGate(g, p);
      g.next += rr(GATE_JIT[0], GATE_JIT[1]) / GATE_RATE;
    }
    /* 沒門可射的那幾幀別讓它一路欠下去：不夾住的話收尾剛開始（門都還在縮）欠了幾秒，
       等門一開就會在同一幀把好幾發一次噴出來。 */
    if (g.next < -1 / GATE_RATE) g.next = -1 / GATE_RATE;
    if (g.ph === 'drain' && g.ports.every(p => p.st === 'off')) closeGate(g);
  }
}
/* 門裡那把兵器擺在哪。從「整把縮在門後面」滑到「正中間卡在門上」——
   停在正中間，一半就在門外（使用者：「一半的長度在魔法圓形外面」）。
   ease-out：出來那一下快、快到位時慢下來，像被推出來而不是等速平移。 */
function posInGate(p) {
  const w = p.w;
  const u = p.st === 'draw' ? Math.min(1, p.t / GATE_DRAW) : (p.st === 'grow' ? 0 : 1);
  const e = 1 - Math.pow(1 - u, 2.2);
  /* 從「刃尖剛好抵在門上」（整把都在切面後面，看不見）滑到「正中間卡在門上」
     ＝ 一半在門外（使用者指定的就位姿勢）。 */
  const off = -w.len * 0.5 * (1 - e);
  w.x = p.x + w.dx * off; w.y = p.y + w.dy * off; w.z = p.z + w.dz * off;
}
function stepWeapons(dt) {
  if (!weapons) return;
  for (let i = weapons.length - 1; i >= 0; i--) {
    const w = weapons[i];
    if (w.st === 'gate') continue;               // 位置由門那邊給（posInGate）
    if (w.st === 'fly') {
      const px = w.x, py = w.y, pz = w.z;
      /* 推力用完了的那一把（w.drop，見這一段最後面）：**剩下的是拋物線**——
         速度原封不動留著、只加上重力，指向跟著速度走，所以刃尖是一路壓下來的。
         其餘完全照舊：它還在 fly，照樣撞得到東西、照樣插在地上。
         v1.152.0 是直接丟給 fallWeapon（那支會把速度砍到 1～5），看起來像撞到一面
         看不見的牆（使用者：「穿過去 1.5 格 然後扭一扭直直往下落」）。 */
      if (w.drop) {
        const k = Math.exp(-GATE_DRAG * dt);
        w.vx *= k; w.vz *= k;
        w.vy -= GRAV * dt;
        const L = Math.hypot(w.vx, w.vy, w.vz) || 1;
        w.dx = w.vx / L; w.dy = w.vy / L; w.dz = w.vz / L;
      }
      w.x += w.vx * dt; w.y += w.vy * dt; w.z += w.vz * dt;
      goldTrail(w, px, py, pz, dt);
      /* 半路撞到建築就在撞到的那一點停住，跟隕石／投石機／核彈共用同一套掃掠判定
         （w.s ＝ 全長，sweepRock 會往前多探半個 s，探到的正好是刃尖）。
         只在終點判定的話，斜插進來的兵器會從屋頂穿過去才算打到。 */
      if (sweepRock(w, px, py, pz, hardAt)) { hitWeapon(w); continue; }
      const man = weaponVsWorker(w, px, py, pz);
      if (man) { manWeapon(w, man); continue; }
      /* 兵器也射得中那幾隻（v1.146）。人排前面：牠們比人大得多，同一條線上兩個都碰到時
         先算人，不然站在猴子旁邊的小人永遠被擋掉。 */
      const bst = weaponVsBeast(w, px, py, pz);
      if (bst) { beastWeapon(w, bst); continue; }
      /* 刃尖碰到地面：插在地上（使用者指定）。但**擦著地面進來的不插、改成躺平**——
         幾乎水平飛進來的那些插進去之後整把會埋在地面下（實測重心到 y=−0.03），
         看起來像陷進草皮。斜度不夠就當它是滑一下躺下來。 */
      if (w.y + w.dy * w.len * 0.5 <= 0) {
        if (-w.dy < GATE_STICK_MIN) lieWeapon(w); else stickWeapon(w);
        continue;
      }
      /* 瞄著某一塊積木、卻整個穿過去的那一把（v1.152，只有點在建築上那一發會有
         w.aimY）：**推力到此為止**，剩下交給重力（見這一段開頭的 w.drop）。
         **不是**讓它消失——v1.133.1 那個「飛過落點就化成金色光塵」使用者不要；
         它照樣飛完、照樣落地、照樣插在地上淡掉，只是軌跡從直線變成拋物線。

         為什麼非有不可：滑過頭的距離 ＝ 落點高度 × 水平距離 ÷ 落差，而俯角被錐面
         夾在 41 度內（見 GATE_CONE），所以瞄得越高滑得越遠，這是幾何上跑不掉的。
         而一發打七秒、瞄同一小塊地方，那一塊打光之後**後面的全部落空**（實測瞄準線
         在出手那一刻還是實心的只剩一成多）。沒有這一條的話：泰姬瑪哈陵插在地上的
         中位數 7 → 26～42、最遠 16 → 143，台北 101 九成位 27 → 175～198、最遠 248
         ——畫面上就是一條刀劍拖出去的彗星尾巴橫過整片草地（截圖比對過）。 */
      if (w.aimY > 0 && !w.drop && w.y < w.aimY - GATE_PASS) w.drop = 1;
      /* 保險：飛到地底下、或飛太久還沒碰到任何東西的，直接收掉。
         **沒打到東西的一律讓它飛到落地、插在地上等淡掉**（使用者指定「照舊」）。
         GATE_SPD × GATE_FLY_MAX ＝ 310 單位，比整片場地還長，
         所以這條只在極端角度下才會碰到。 */
      w.age += dt;
      if (w.y < -6 || w.age > GATE_FLY_MAX) { weapons.splice(i, 1); }
    } else if (w.st === 'fall') {
      /* 被擋下來之後就是一塊會翻滾的鐵，落到地面為止。這一段**不再跟建築碰撞**：
         打在高樓半腰的那一把會穿過樓層掉到地上。跟碎料（stepBlock）同一個取捨——
         一趟有一百多把在掉，每一把每幀都做掃掠判定划不來，而且它已經不再造成破壞。 */
      w.vy -= 26 * dt;
      w.x += w.vx * dt; w.y += w.vy * dt; w.z += w.vz * dt;
      tumbleWeapon(w, dt);
      if (w.y <= 0.4) { lieWeapon(w); }
    } else {
      /* 插著／躺著：撐一段時間再**慢慢變淡**（v1.132.1 使用者回報；本來是縮小）。
         fade 是逐 instance 的不透明度，長度一路不變。
         淡的同時整把化成金光（v1.148，使用者：「兵器消失時 兵器整體金色光芒的形體
         慢慢消失」）：glow 爬得比 fade 掉得快（GATE_GLOW_K），所以還有四成多不透明度
         的時候就已經是一團完整的金色形體，之後才連光一起淡掉——
         兩者同速的話金色最亮的那一刻剛好也快看不見了，等於沒有這一段。 */
      w.lie -= dt;
      if (w.lie <= 0) {
        w.fade -= dt / GATE_FADE;
        w.glow = Math.min(1, (1 - w.fade) * GATE_GLOW_K);
        if (w.fade <= 0) { goldPuff(w); weapons.splice(i, 1); }
      }
    }
  }
  if (!weapons.length) weapons = null;
}
/* 打中積木：炸開一個小缺口，兵器被擋下來、掉到地面（使用者指定）。
   quiet＋hush ＝ 不震畫面也不出 smash 那一聲，理由見檔頭那四點的第 ③ 點。
   **不點火**（使用者：「沒有燃燒效果」），所以這裡沒有 igniteAround。 */
function hitWeapon(w) {
  /* 炸在**刃尖**不是重心。sweepRock 探到的是「刃尖再往前 半個全長」那一段
     （它拿 r.s * 0.5 當探長，而這裡的 s 就是全長），可是它把物件停在**這一幀該到的
     位置**——也就是刃尖有可能還差半把劍才碰到那塊積木。拿重心當爆點的話，
     觸發這一下的那塊積木常常剛好落在半徑邊上，實測一發只咬掉 1.8 塊
     （半徑 1.5 應該要有五、六塊）。改成刃尖之後才是「刺進去的那一點」。 */
  const t = w.len * 0.5;
  const p = { x: w.x + w.dx * t, y: Math.max(0.5, w.y + w.dy * t), z: w.z + w.dz * t };
  smash(p, { x: w.dx, y: w.dy, z: w.dz }, GATE_HIT_R, GATE_HIT_POW, true, true);
  weaponSpark(p, w);
  weaponBoom(p, w);
  sndGateHit();
  fallWeapon(w);
}
/* 被擋下來之後就是一塊會翻滾的鐵：往前的勁道剩一點點，剩下交給重力。
   打到積木、射到小人都走這一段（v1.133 拆出來共用）。 */
function fallWeapon(w) {
  w.st = 'fall';
  w.vx = w.dx * rr(1, 5) + rr(-2.5, 2.5);
  w.vy = rr(1, 5);
  w.vz = w.dz * rr(1, 5) + rr(-2.5, 2.5);
  const a = Math.random() * Math.PI * 2, b = rr(-1, 1);
  const c = Math.sqrt(Math.max(0, 1 - b * b));
  w.ax = Math.cos(a) * c; w.ay = b; w.az = Math.sin(a) * c;
  w.spin = rr(6, 13) * (Math.random() < 0.5 ? -1 : 1);
}
/* 射到小人（v1.133，使用者：「王之財寶⋯⋯沒對小人生效」，指定「撞飛」）。
   為什麼本來沒有：兵器只跟積木做掃掠判定（sweepRock），對人沒有任何判定——
   實測 12 個人站在打擊範圍正中間，一整趟 190 幾發過去 0 個有反應。

   判定用**刃尖走過的那一小段**（上一幀的刃尖 → 這一幀的刃尖）取三個點，不是只看
   這一幀的位置：一幀飛 62 ÷ 60 ＝ 1.03 單位，而人的身體半寬才 0.35，只測端點會穿過去。
   高度用「腳底到頭頂」那一段：兵器多半是斜著往下飛，從頭上飛過去的不該算中。 */
const GATE_MAN_R = 0.75;         // 刃尖離人中心多近算射中（身體半寬 0.35 ＋ 一點寬容）
function weaponVsWorker(w, px, py, pz) {
  if (!workers.length) return null;
  const t = w.len * 0.5;
  const ax = px + w.dx * t, ay = py + w.dy * t, az = pz + w.dz * t;   // 上一幀的刃尖
  const bx = w.x + w.dx * t, by = w.y + w.dy * t, bz = w.z + w.dz * t;
  for (const p of workers) {
    if (p.air || p.burn > 0 || p.fall > 0) continue;
    const h = 1.5 * (p.scale || 1);              // 頭頂（同 burnFx 那邊的算法）
    for (let k = 0; k <= 2; k++) {
      const u = k / 2;
      const y = ay + (by - ay) * u;
      if (y < 0 || y > h) continue;
      const dx = ax + (bx - ax) * u - p.x, dz = az + (bz - az) * u - p.z;
      if (dx * dx + dz * dz <= GATE_MAN_R * GATE_MAN_R) return p;
    }
  }
  return null;
}
/* 撞飛的力道：方向沿飛行方向（使用者指定），水平速度由 tossWorker 自己夾在
   W_TOSS_MAX（22）。兵器本身跟打到積木一樣被擋下來、掉到地上。

   v1.132～v1.147 這裡**不叫 smash**（原註解：「那會連旁邊的積木一起炸開，
   打到人不該拆房子」）。v1.148 使用者要「擊中小人或吉祥物時增加小小爆炸火球特效
   （把 3～4 塊積木炸飛的程度）」，並確認火球本身要有破壞力——所以那個取捨翻掉了，
   改成炸一小片（GATE_BLAST_R，比打積木那一發小一號，見那邊的實測表）。
   撞飛排在爆破**前面**：smash 收尾的 afterHit 會把附近還站著的人掀倒，
   而它不動已經飛起來的人——順序反了的話被射中那一個會變成「原地倒下」而不是被撞飛。 */
function manWeapon(w, p) {
  const t = w.len * 0.5;
  const pt = { x: w.x + w.dx * t, y: Math.max(0.5, w.y + w.dy * t), z: w.z + w.dz * t };
  weaponSpark(pt, w);
  tossWorker(p, w.dx * 16 + rr(-2, 2), rr(5, 8), w.dz * 16 + rr(-2, 2), false);
  weaponBlast(pt, w);
  sndFall();
  fallWeapon(w);
}
/* 插在地上（使用者指定）：刃尖沒入地面一點點，柄還斜著露在外面。
   沿著飛行方向把整把推到「刃尖剛好沒入 into」那個位置，而不是用這一幀停下來的
   地方——它一幀飛一格，直接用的話沒入多深全看那一幀剛好飛到哪。
   幾乎水平飛過來、擦到地面的那種（dy 接近 0）算不出這個位移，就讓它躺在原地。 */
function stickWeapon(w) {
  const into = GATE_INTO * clamp(-w.dy / 0.7, 0.3, 1);
  const tipY = w.y + w.dy * w.len * 0.5;
  const k = w.dy < -0.05 ? (-into - tipY) / w.dy : 0;
  w.x = w.x + w.dx * k; w.y = w.y + w.dy * k; w.z = w.z + w.dz * k;
  w.st = 'lie';
  w.lie = rr(GATE_LIE[0], GATE_LIE[1]);
  /* 插進去揚一小撮土。不用 spawnDust：那一支一次生二十幾顆（它是給爆炸用的），
     而一趟有一百多把插在地上——整池 400 顆的額度會被它吃光，
     打在建築上那些真正該有的煙塵就生不出來了。 */
  for (let i = 0; i < 4; i++) {
    if (dust.length > 380) break;
    const a = Math.random() * Math.PI * 2, sp = rr(1.5, 4);
    dust.push({
      x: w.x + rr(-0.3, 0.3), y: 0.25, z: w.z + rr(-0.3, 0.3),
      vx: Math.cos(a) * sp, vy: rr(1, 3), vz: Math.sin(a) * sp,
      rx: Math.random() * 6, ry: Math.random() * 6,
      life: rr(0.3, 0.6), s: rr(0.16, 0.34), c: rr(0.62, 0.86)
    });
  }
  sndStab();
}
/* 掉到地面：躺平。方向取它落地時的水平分量，沒有的話隨便給一個角度。 */
function lieWeapon(w) {
  const h = Math.hypot(w.dx, w.dz);
  if (h > 0.05) { w.dx /= h; w.dz /= h; } else { const a = Math.random() * Math.PI * 2; w.dx = Math.cos(a); w.dz = Math.sin(a); }
  w.dy = 0;
  w.y = w.len * 0.06 + 0.1;                     // 貼著地面躺著（刃面本來就薄）
  w.st = 'lie';
  w.lie = rr(GATE_LIE[0], GATE_LIE[1]);
}
/* 翻滾（掉下來那一段）：把指向繞著一根固定的轉軸轉，就是羅德里格旋轉公式。
   只轉 roll 的話它會像根定住的針在原地自轉，看不出在翻。 */
function tumbleWeapon(w, dt) {
  const a = w.spin * dt, c = Math.cos(a), s = Math.sin(a);
  const dot = w.ax * w.dx + w.ay * w.dy + w.az * w.dz;
  const cx = w.ay * w.dz - w.az * w.dy;
  const cy = w.az * w.dx - w.ax * w.dz;
  const cz = w.ax * w.dy - w.ay * w.dx;
  const nx = w.dx * c + cx * s + w.ax * dot * (1 - c);
  const ny = w.dy * c + cy * s + w.ay * dot * (1 - c);
  const nz = w.dz * c + cz * s + w.az * dot * (1 - c);
  const L = Math.hypot(nx, ny, nz) || 1;
  w.dx = nx / L; w.dy = ny / L; w.dz = nz / L;
}
/* 飛行時的金色光軌（gemini 的描述：「拖曳著筆直耀眼的金色光軌與粒子尾跡」）。
   每一顆沿著飛行方向拉成一小段（ln，跟煙火往上竄那條尾巴同一招），首尾接起來
   才是一條線而不是一串點。走 hot 那一池（不透明的亮材質），但額度留 40 顆給
   還在燒的東西——這一把自己不點火，不該把別人的火吃光。 */
function goldTrail(w, px, py, pz, dt) {
  w.em += dt * 70;
  const seg = { dx: w.dx, dy: w.dy, dz: w.dz, ln: GATE_SPD / 70 * 1.7 };
  while (w.em >= 1) {
    w.em--;
    if (hot.length > HOT_MAX - 40) break;
    const u = Math.random();
    hot.push({
      x: px + (w.x - px) * u, y: py + (w.y - py) * u, z: pz + (w.z - pz) * u,
      vx: rr(-0.3, 0.3), vy: rr(-0.2, 0.5), vz: rr(-0.3, 0.3),
      rx: Math.random() * 6, ry: Math.random() * 6,
      s: rr(0.09, 0.20), life: rr(0.08, 0.17), g: -0.9, grow: 0.95,
      cool: rr(0.2, 0.5), cr: 1, cg: rr(0.80, 0.92), cb: rr(0.24, 0.48),
      to: [1, 0.55, 0.06], dx: seg.dx, dy: seg.dy, dz: seg.dz, ln: seg.ln
    });
  }
}
/* 擊中的那一下（v1.132.3，使用者：「王之財寶擊中時增加個打擊特效」）。
   兩層疊起來：**一顆瞬間的金色星芒**（stars，撞擊點一閃，佔面積、遠看也讀得到）
   ＋ **往回濺的金色火花**（hot，拉成短條，才像金屬撞上石頭迸出來的）。
   火花一律**往回**濺（沿 −方向開一個錐面）：順著飛行方向噴的話看起來像穿過去了，
   不像被擋下來。星芒的顏色寫死金黃，不走 spawnStars——那一支是粉紫金黃各半的
   （魔法陣用的），粉的混進來會跟這一發的金色打架。

   粒子額度：火花的門檻放在 HOT_MAX − 8，比拖尾的 −40 寬。兩者搶同一池的時候
   **撞擊優先**：拖尾少幾顆看不出來，撞擊少一下就整個沒特效了。

   整團要**沿著來的方向往回挪 SPARK_BACK**：hitWeapon 給的是刃尖，而刃尖那一刻常常
   已經戳進積木裡了——生在那裡的話星芒與火花整團被積木擋住，畫面上什麼都看不到
   （第一版就是這樣，對著撞擊點拍特寫只拍到一面牆）。挪到牆面外側才看得見。 */
const SPARK_BACK = 0.7;
function weaponSpark(pt, w) {
  const p = { x: pt.x - w.dx * SPARK_BACK, y: pt.y - w.dy * SPARK_BACK,
              z: pt.z - w.dz * SPARK_BACK };
  if (stars.length < STAR_MAX) stars.push({
    x: p.x, y: p.y, z: p.z, s0: rr(2.8, 3.8), s: 0,
    rot: Math.random() * Math.PI * 2, spin: rr(-2.5, 2.5), vy: rr(0.3, 1.1),
    t: 0, life: rr(0.18, 0.30), op: 0,
    cr: 1, cg: rr(0.85, 0.97), cb: rr(0.42, 0.62)
  });
  /* 以「來的反方向」為軸開一個錐：先造一組垂直於它的基底（u、v），
     再照 cos／sin 把方向轉出去——同 aimGate 那個錐面的算法。 */
  const bx = -w.dx, by = -w.dy, bz = -w.dz;
  let ux = -bz, uz = bx;                       // 垂直於軸的水平向量
  const ul = Math.hypot(ux, uz) || 1;
  ux /= ul; uz /= ul;
  const vx = by * uz, vy = bz * ux - bx * uz, vz = -by * ux;      // 軸 × u
  for (let i = 0; i < 11; i++) {
    if (hot.length > HOT_MAX - 8) break;
    const a = Math.random() * Math.PI * 2, th = rr(0.35, 1.15);
    const cs = Math.cos(th), sn = Math.sin(th);
    const dx = bx * cs + (ux * Math.cos(a) + vx * Math.sin(a)) * sn;
    const dy = by * cs + (vy * Math.sin(a)) * sn;
    const dz = bz * cs + (uz * Math.cos(a) + vz * Math.sin(a)) * sn;
    const sp = rr(6, 15);
    hot.push({
      x: p.x, y: p.y, z: p.z,
      vx: dx * sp, vy: dy * sp + rr(0.5, 2.5), vz: dz * sp,
      rx: Math.random() * 6, ry: Math.random() * 6,
      s: rr(0.13, 0.24), life: rr(0.13, 0.28), g: 6, grow: 0.9,
      cool: rr(0.15, 0.45), cr: 1, cg: rr(0.86, 0.98), cb: rr(0.35, 0.62),
      to: [1, 0.6, 0.1], dx: dx, dy: dy, dz: dz, ln: rr(0.7, 1.6)
    });
  }
}
/* 擊中那一下的小爆炸火球（v1.148，使用者：「兵器擊中積木或小人或吉祥物時
   (如果是地面就跟現在一樣插著就好) 增加小小爆炸火球特效(把 3~4 塊積木炸飛的程度)」）。
   打在地面的**不給**——那一發照舊插在地上（使用者指定）。
   疊在原本的金色星芒＋往回濺的火花上面：那兩層是「金屬撞上石頭」，這一層是「炸開」。

   為什麼不直接叫 spawnBlast（爆炸那一套的火球）：
   ① 它會在**地面**鋪兩圈貼地光環（y ≈ 0.16）。兵器多半打在半空的牆上，
      光環會出現在腳下十幾格外的草地上，看起來是另一件事。
   ② 它那顆火球的壽命是核彈的 0.65 秒。這一把一秒炸十幾下，FLASH_MAX 個位置
      會被最早那幾顆卡死，多數的擊中根本排不到火球——所以自己帶一份短的。
   ③ 額度**不搶**：滿了就這一發沒有火球（spawnBlast 是把最早那顆擠掉）。
      核彈那顆大火球不該被一把劍擠掉，反過來則照舊（大爆炸擠得掉這幾顆小的）。
   一律不點火、不震畫面：這一把從 v1.132 起就是「不起火、不震畫面」的（使用者指定）。 */
const GATE_BOOM_R = 1.7;         // 火球撐開到多大（外殼到 1.1 倍 ≈ 兩格，四塊積木寬）
const GATE_BOOM_LIFE = 0.24;     // 亮多久（爆炸那顆是 0.65）
const GATE_BOOM_HOLD = 0.05;     // 前這麼久維持全亮
const GATE_BOOM_N = 9;           // 從球面往外噴幾顆火星
function weaponBoom(pt, w) {
  /* 跟星芒一樣要沿著來的方向往回挪：刃尖那一刻常常已經戳進積木裡，
     生在那裡的話整顆球被牆擋住（見 weaponSpark 的 SPARK_BACK）。 */
  const p = { x: pt.x - w.dx * SPARK_BACK, y: pt.y - w.dy * SPARK_BACK,
              z: pt.z - w.dz * SPARK_BACK };
  if (flashes.length < FLASH_MAX)
    flashes.push({ x: p.x, y: p.y, z: p.z, R: GATE_BOOM_R, magic: false,
                   t: 0, r: GATE_BOOM_R * 0.34, op: 1,
                   life: GATE_BOOM_LIFE, hold: GATE_BOOM_HOLD });
  /* 從球面往外噴的火星。跟爆炸那一套同一個道理：生在球心的話這些幾乎不透明的
     方塊會糊在球的正面，把最亮的核心遮掉。額度用 HOT_MAX − 8（跟星芒同一級，
     比拖尾的 −40 寬）——拖尾少幾顆看不出來，擊中少一下就整個沒特效了。 */
  for (let i = 0; i < GATE_BOOM_N; i++) {
    if (hot.length > HOT_MAX - 8) break;
    const a = Math.random() * Math.PI * 2, u = Math.pow(Math.random(), 0.6);
    const rad = GATE_BOOM_R * (0.52 + 0.46 * u);
    const core = u < 0.35;
    hot.push({
      x: p.x + Math.cos(a) * rad, y: p.y + rr(-0.2, 0.5), z: p.z + Math.sin(a) * rad,
      vx: Math.cos(a) * rad * 3.2, vy: rr(1.4, 4.2), vz: Math.sin(a) * rad * 3.2,
      rx: Math.random() * 6, ry: Math.random() * 6,
      s: rr(0.26, 0.48), life: rr(0.16, 0.34), g: -1.2, grow: 1.22,
      cool: rr(0.5, 0.9),
      cr: 1, cg: core ? rr(0.80, 0.94) : rr(0.40, 0.56), cb: core ? rr(0.34, 0.54) : rr(0.06, 0.16),
      to: [0.6, 0.14, 0.03]
    });
  }
}
/* 打到小人／吉祥物那一下的火球＋那一小片爆破（v1.148）。
   quiet＋hush 照舊：這一把不震畫面、爆裂聲讓給它自己那一聲 sndGateHit／sndFall。
   打積木那一發不走這裡——它本來就有 smash（GATE_HIT_R 1.5），不該疊第二發。

   半徑是量出來的，不是估的。使用者要「把 3～4 塊積木炸飛的程度」，而這一發的爆點
   是「刃尖停在人身上」那一點——人站在牆外，離最近那排積木還有一格多，所以同一個
   半徑在這裡咬掉的比打在積木上少得多。實測（射中站在牆邊的小人，每次換一座隨機建築、
   發射距離也隨機，各 48 發，量的是當場被打散的 SET 塊數）：
     1.2 → 平均 1.2（中位 1）      1.3 → 平均 2.1（中位 2）
     1.4 → 平均 3.5（中位 3）      1.5 → 平均 3.5（中位 3）
   1.4 就是使用者說的「3～4 塊」。1.5 量到一樣，但那已經等於打積木那一發的半徑，
   這一發該比它小，所以取 **1.4**。

   量的時候踩到一個坑，記在這裡：**發射距離不能固定**。刃尖一幀飛 1.03 格，停在哪要看
   「到達的相位」——同一個半徑 1.3，發射距離 3.4 量到平均 4.3 塊、距離 5.0 量到 1.6 塊
   （差半格，最近那一排就整排進出半徑）。真實遊戲裡相位是隨機的，夾具也得隨機，
   不然量到的是那一個相位，不是這一發的力道。 */
const GATE_BLAST_R = 1.4;
const GATE_BLAST_POW = 10;
function weaponBlast(pt, w) {
  smash(pt, { x: w.dx, y: w.dy, z: w.dz }, GATE_BLAST_R, GATE_BLAST_POW, true, true);
  weaponBoom(pt, w);
}
/* 淡完那一刻化成一小撮金色光塵（gemini 的描述：「化為金色光塵消散」）。
   只有幾顆：一百多把兵器陸續淡完，一把撒二十顆的話整片草地會亮成一團。 */
function goldPuff(w) {
  for (let i = 0; i < 4; i++) {
    if (hot.length > HOT_MAX - 20) return;
    hot.push({
      x: w.x + rr(-0.3, 0.3), y: w.y + rr(0, 0.5), z: w.z + rr(-0.3, 0.3),
      vx: rr(-0.6, 0.6), vy: rr(0.6, 1.8), vz: rr(-0.6, 0.6),
      rx: Math.random() * 6, ry: Math.random() * 6,
      s: rr(0.12, 0.26), life: rr(0.3, 0.6), g: -1.4, grow: 0.94,
      cool: rr(0.3, 0.6), cr: 1, cg: rr(0.88, 1), cb: rr(0.5, 0.75),
      to: [1, 0.7, 0.2]
    });
  }
}
/* 畫面上要畫的那些門。一個門畫兩層：外圈的漣漪 ＋ 小一圈、反向轉的核——
   兩層互相滑過去，疊出來的環才會一直在變（參考圖那是水面泛開的漣漪，
   不是一張固定的圓貼紙）。重用同一個陣列，不要每幀配一個新的。 */
/* 畫在哪：就是門心，朝向就是兵器的方向（見引擎的 putGates）。
   「一半在門外、一半在門裡」不是靠遮擋做的，是切面把後面那一段整個 discard 掉
   （見檔頭 ①'）——所以這裡不必管誰畫在誰前面。 */
const gateDraw = [];
function gateList() {
  gateDraw.length = 0;
  if (!gates) return gateDraw;
  for (const g of gates) for (const p of g.ports) {
    if (p.op <= 0.002) continue;
    const r = p.r * p.k;
    const d = { x: p.x, y: p.y, z: p.z, dx: p.dx, dy: p.dy, dz: p.dz };
    gateDraw.push({ ...d, r, rot: p.rot, op: p.op });
    gateDraw.push({ ...d, r: r * 0.62, rot: -p.rot * 1.7, op: p.op * 0.8 });
  }
  return gateDraw;
}

/* ── 大劍（v1.161）──────────────────────────────────────
   使用者：「操作方式點擊兩個位置 其中一次要在建築上／出現一隻大劍從第一個位置揮往
   第二個位置／劍柄旋轉點的高度 大約在點在建築上的那次高度／劍刃攻擊方向從第一次位置
   到第二次位置」，看過第一版之後追加：「點在建築那個點 跟地面的點 是會砍成斜的才對／
   所以地面那個點的位置也是有影響的／建築物點擊位置 與該位置同高度的點 與地面的點
   形成一個面 劍刃是在這個平面上揮動」。

   所以它**不是**躺平橫掃（那是第一版，缺口是水平的一條）：樞紐（劍柄的旋轉點）在
   「點到建築那一下」的高度上、離兩點一樣遠，刃尖起手落在第一點、收手落在第二點，
   整把在「樞紐 ＋ 那兩點」決定的那個**平面**上繞平面的法線轉。兩點高度不同時
   那個平面就是斜的，缺口跟著斜。幾何細節見 castSword。
   v1.162 使用者又追加三件（都在這個平面上，幾何沒動）：「大劍長度增加（約兩倍
   大劍比例也要微調）」、「出現後先有一段 往攻擊反方向移動一小段距離 然後向攻擊方向
   加速 揮完後會超過一點」（見 SW_BACK_K／SW_OVER_K 與 stepSwords）、
   「點兩下都是建築時 就從第一點位置揮到第二點」（見 aimSword 的 py）。
   另外「中段刃尖入地」使用者說沒關係，所以不夾住。 */
const SW_AIM_R = 5.5;            // 第一下在地上畫的那圈光環多大
const SW_AIM_C = 0xdfe6ee;       // 鋼色（同刃）
/* 全長跟兩點的**水平**距離成正比，再夾在這個範圍裡：兩點點得很近時劍不能縮成一根
   牙籤，點得很開也不能長到半個工地。
   v1.162 使用者：「大劍長度增加（約兩倍）」——三個數字一起乘二（0.80→1.60、
   24→48、46→92），下限 48 ＝ 兩座金字塔疊起來、上限 92 ＝ 台北 101（65）再加一半。
   造型的比例另外微調過（放大兩倍還用原比例看起來是鐵板，見 engine.js 的 SWORD_PART）。
   兩點高低差很大時這個長度可能短到「樞紐無解」，那一段會自己再拉長（見 castSword）。 */
const SW_LEN_K = 1.60, SW_LEN_MIN = 48, SW_LEN_MAX = 92;
const SW_KEEP = 3;               // 同時最多幾把。**要 ≤ 引擎的 SWORD_MAX**，多的畫不出來
const SW_RISE = 0.22;            // 出現＋回抽：淡入的同時往攻擊的反方向拉開（見 stepSwords）
const SW_SWING = 0.42;           // 揮過去要幾秒
/* 回抽與收手超過的角度（使用者：「先有一段往攻擊反方向移動一小段距離 然後向攻擊方向
   加速 揮完後會超過一點」）。用「掃過的角度的幾成」而不是寫死幾度——掃 40° 的一刀
   回抽 30° 會變成往回砍；再各給一個上限，免得掃 170° 的那種一刀回抽到背後去。 */
const SW_BACK_K = 0.35, SW_BACK_MAX = 0.30;
const SW_OVER_K = 0.18, SW_OVER_MAX = 0.16;
const SW_HOLD = 0.22;            // 揮到終點停多久
const SW_FADE = 1.1;            // 原地化成金光淡掉要幾秒（使用者選的收尾）
/* 刃掃到的厚度 ＝ 揮動平面兩側各一個刃寬，使用者選的是「刃掃過的整片削掉」。
   全長 30 時刃寬 3.6 單位，兩側各一個 ＝ 7.2 單位 ＝ 七塊多厚的一道缺口，
   被切斷的那一段接著靠現成的垮塌判定自己塌下來。 */
const SW_BAND_K = 1.0;
const SW_HIT_K = 0.45;           // 擊飛速度 ＝ 那一塊所在半徑的刃速 × 這個
const SW_HIT_MAX = 34;           // 擊飛速度上限（同一把尺：槌子 15、大槌 15×1.5＝22.5）
let swords = null;               // 場上的大劍（出現 → 揮 → 停 → 淡完為止）

/* 第一下記位置與高度，第二下才揮。
   兩下都點在地面時沒有高度可用（使用者：其中一次要在建築上）——**第一點留著不清掉**，
   直接再點一次建築就發動，不必整套重來（那一下完全沒反應會像點壞了）。 */
function aimSword(point, onBlock) {
  if (!aim) {
    aimFirst(point, SW_AIM_R, SW_AIM_C);
    aim.sy = point.y; aim.son = onBlock;      // 光環只讀 x/z/r/c，多帶兩個欄位不影響
    return;
  }
  if (!aim.son && !onBlock) {
    toast('⚔ 大劍：其中一下要點在建築上', '那一下的高度就是劍柄旋轉點的高度');
    return;
  }
  /* 樞紐的高度：點在建築上那一下的高度。
     **兩下都點在建築上就用第一下的**（v1.162 使用者：「點兩下都是建築時 就從第一點
     位置揮到第二點」）——樞紐跟第一點同高，刃就從第一點那個高度平平地起手、
     一路砍到第二點。原本取兩點的中間，樞紐會落在第一點的下面，起手是先往上撈。
     兩點各自的高度另外給——揮動平面是「樞紐 ＋ 那兩點」決定的，見 castSword。 */
  const py = aim.son ? aim.sy : point.y;
  castSword(aim, point, py, aim.sy, point.y);
}
/* py＝樞紐的高度（點在建築上那一下的高度）、y1／y2＝兩點各自的高度。
   幾何（使用者第二、三、四句講的就是這個）：
     ① 樞紐的高度 ＝ py，而且**離兩點一樣遠**（3D 距離都是「樞紐到刃尖」r1）
        ——刃尖起手落在第一點、收手落在第二點。
        設樞紐比某一點高 h，那麼樞紐到那一點的**水平**距離是 √(r1² − h²)；
        於是樞紐就是「以兩點為心、以那兩個水平距離為半徑」的兩個圓的交點。
     ② 樞紐、第一點、第二點三個點決定**一個平面**，刃就在那個平面上繞
        「平面的法線」轉（見 swordAim 的 u(θ)）。兩點高度不同時那個平面是斜的，
        所以砍出來的缺口是斜的——這正是使用者說的「會砍成斜的才對」。
     ③ 地面那一點因此管三件事：揮擊的終點方向、平面的傾角、以及刃長（跟水平距離成正比）。 */
function castSword(from, toward, py, y1, y2) {
  aim = null;
  let dx = toward.x - from.x, dz = toward.z - from.z;
  let D = Math.hypot(dx, dz);
  /* 同一個地方連點兩下：沿著「場心 → 那一點」的**切線**挪 8 單位當第二點
     （同 aimDir 對兩點重疊的處理，只是這裡要的是切線不是徑向——徑向那一刀
     會變成朝著鏡頭方向切，看不出是橫過去的一刀）。 */
  if (D < 0.5) {
    const rl = Math.hypot(from.x, from.z);
    const tx = rl > 1e-4 ? -from.z / rl : 1, tz = rl > 1e-4 ? from.x / rl : 0;
    dx = tx * 8; dz = tz * 8; D = 8;
  }
  const ex = dx / D, ez = dz / D;
  const p2x = from.x + dx, p2z = from.z + dz;
  /* 刃長跟水平距離成正比，但**至少要夠長到兩個圓碰得到**：樞紐落在其中一點的高度上
     （h1 ＝ 0）時，兩圓相切的條件解出來是 r1 ≥ (D² + Δ²) / 2D，Δ ＝ 兩點的高度差。
     不夠長就先照這條拉長（頂到 SW_LEN_MAX 為止）；兩點都在建築上那種一般情形不見得
     適用這條，所以真正的判斷還是下面那個「兩圓有沒有交點」（hq2 > 0），沒有就退到中點。 */
  const h1 = py - y1, h2 = py - y2;
  const need = (D * D + (h1 - h2) * (h1 - h2)) / (2 * D) * 1.03;   // 留 3% 餘裕，別剛好相切
  const tipK = ENG.SWORD_TIP - ENG.SWORD_PIVOT;
  const len = Math.min(SW_LEN_MAX, Math.max(SW_LEN_MIN, D * SW_LEN_K, need / tipK));
  const r1 = len * tipK;                                  // 樞紐到刃尖
  const r0 = len * (ENG.SWORD_EDGE - ENG.SWORD_PIVOT);    // 樞紐到刃根
  const a1 = Math.sqrt(Math.max(0, r1 * r1 - h1 * h1));   // 樞紐到第一點的水平距離
  const a2 = Math.sqrt(Math.max(0, r1 * r1 - h2 * h2));
  let px, pz;
  const xf = (D * D + a1 * a1 - a2 * a2) / (2 * D);
  const hq2 = a1 * a1 - xf * xf;
  if (hq2 > 1e-9) {
    const hq = Math.sqrt(hq2);
    const bx = from.x + ex * xf, bz = from.z + ez * xf;   // 兩圓連心線上的垂足
    const c1x = bx - ez * hq, c1z = bz + ex * hq;
    const c2x = bx + ez * hq, c2z = bz - ex * hq;
    /* 兩個交點取**離場心遠**的那一個：劍從場外掃進來，不是從建築肚子裡長出來。 */
    const far1 = c1x * c1x + c1z * c1z >= c2x * c2x + c2z * c2z;
    px = far1 ? c1x : c2x; pz = far1 ? c1z : c2z;
  } else {
    /* 兩點比刃還開（刃已經頂到上限）：樞紐退到中點。刃尖到不了那兩點，
       但起手與收手的**方向**仍然是那兩點。 */
    px = from.x + dx / 2; pz = from.z + dz / 2;
  }
  /* 起手／收手的方向，以及它們決定的那個平面 */
  let u0x = from.x - px, u0y = y1 - py, u0z = from.z - pz;
  let u1x = p2x - px, u1y = y2 - py, u1z = p2z - pz;
  const l0 = Math.hypot(u0x, u0y, u0z) || 1, l1 = Math.hypot(u1x, u1y, u1z) || 1;
  u0x /= l0; u0y /= l0; u0z /= l0;
  u1x /= l1; u1y /= l1; u1z /= l1;
  let nx = u0y * u1z - u0z * u1y,
      ny = u0z * u1x - u0x * u1z,
      nz = u0x * u1y - u0y * u1x;
  let nl = Math.hypot(nx, ny, nz);
  const dot = Math.max(-1, Math.min(1, u0x * u1x + u0y * u1y + u0z * u1z));
  /* 兩個方向剛好共線（同向或正反向）時沒有平面可算——退回「水平面上掃」，
     那是躺平橫掃的老樣子，至少方向仍然對。 */
  if (nl < 1e-6) { nx = 0; ny = 1; nz = 0; nl = 1; }
  nx /= nl; ny /= nl; nz /= nl;
  const span = Math.atan2(nl, dot);       // 掃過的角度（0～π）
  /* 平面內的第二個軸：從 u0 往 u1 轉的方向（e2 ＝ n × u0，跟 u0 垂直、長度 1）。
     刃尖 u(θ) ＝ u0·cos θ ＋ e2·sin θ，θ 從 0 掃到 span。 */
  const e2x = ny * u0z - nz * u0y,
        e2y = nz * u0x - nx * u0z,
        e2z = nx * u0y - ny * u0x;
  /* 回抽多少、收手超過多少（見 SW_BACK_K／SW_OVER_K）。超過的那一段還要留一點餘裕
     別讓總角度頂到 180°——刃尖方向的角度是用 atan2 算的，過了 π 會翻到負的那一側，
     那一幀的判定就會漏掉。 */
  const back = Math.min(SW_BACK_MAX, span * SW_BACK_K);
  const over = Math.min(SW_OVER_MAX, span * SW_OVER_K, Math.max(0, Math.PI * 0.995 - span));
  if (!swords) swords = [];
  while (swords.length >= SW_KEEP) swords.shift();        // 滿了擠掉最早那把（同其他清單型道具）
  swords.push({ x: px, y: py, z: pz, len: len, r0: r0, r1: r1, back: back, over: over,
                band: ENG.SWORD_W * len * SW_BAND_K,
                u0x: u0x, u0y: u0y, u0z: u0z,             // 起手方向（平面內的第一軸）
                e2x: e2x, e2y: e2y, e2z: e2z,             // 平面內的第二軸
                nx: nx, ny: ny, nz: nz,                   // 揮動平面的法線
                span: span, ang: 0,
                ux: u0x, uy: u0y, uz: u0z,                // 這一刻的刃尖方向（畫的時候用）
                ph: 'rise', t: 0, fade: 0, glow: 0, hit: false });
  sndTick();
}
/* 刃尖轉到 θ：在揮動平面上從 u0 轉向 e2。 */
function swordAim(s, th) {
  const c = Math.cos(th), n = Math.sin(th);
  s.ang = th;
  s.ux = s.u0x * c + s.e2x * n;
  s.uy = s.u0y * c + s.e2y * n;
  s.uz = s.u0z * c + s.e2z * n;
}
function stepSwords(dt) {
  if (!swords) return;
  for (let i = swords.length - 1; i >= 0; i--) {
    const s = swords[i];
    s.t += dt;
    if (s.ph === 'rise') {
      /* 出現＋回抽：淡入的同時往攻擊的**反方向**拉開一段（θ 從 0 走到 −back）。
         淡入比回抽快收完，不然是一把半透明的劍在那裡拉弓。
         這一段**不切**——它是往回走的，掃過的那一片等一下正著揮過去時會一起削掉。 */
      const p = Math.min(1, s.t / SW_RISE);
      s.fade = Math.min(1, s.t / (SW_RISE * 0.55));
      swordAim(s, -s.back * p * p * (3 - 2 * p));
      if (p >= 1) { s.ph = 'swing'; s.t = 0; s.fade = 1; sndSwing(); }
    } else if (s.ph === 'swing') {
      const p = Math.min(1, s.t / SW_SWING);
      const th0 = s.ang;
      /* 從回抽的位置一路揮到「第二點再過去一點」（−back → span ＋ over）。
         這條曲線 ＝ 平滑階梯套在 p² 上，速度的峰值落在 p≈0.78：
         起手是從靜止的回抽開始**加速**，最快的一段落在後半、收手才煞住
         （使用者：「然後向攻擊方向加速 揮完後會超過一點」）。 */
      const q = p * p;
      swordAim(s, -s.back + (s.back + s.span + s.over) * q * q * (3 - 2 * q));
      swordCut(s, th0, s.ang, dt);
      if (p >= 1) { s.ph = 'hold'; s.t = 0; }
    } else if (s.ph === 'hold') {
      if (s.t >= SW_HOLD) { s.ph = 'fade'; s.t = 0; }
    } else {
      const p = Math.min(1, s.t / SW_FADE);
      s.fade = 1 - p;
      s.glow = Math.min(1, p * 1.5);       // 淡的同時整把推向金色（同兵器的化成金光）
      if (p >= 1) swords.splice(i, 1);
    }
  }
  if (!swords.length) swords = null;
}
/* 這一幀刃掃過的那一小段：**揮動平面**上的扇形（r0～r1）× 平面兩側各一個刃寬，
   裡面的建築整片削掉。平面通常是斜的，所以缺口也是斜的。
   每一幀的角度段**首尾相接**，所以整趟下來扇形裡的每一塊剛好被算到一次
   ——不會漏、也不會同一塊被切兩次。 */
function swordCut(s, aFrom, aTo, dt) {
  const sweep = aTo - aFrom;
  if (sweep <= 1e-6 || dt <= 0) return;                   // θ 一律從 0 往 span 增加
  const om = sweep / dt;                                  // 這一幀的角速度（弧度／秒）
  const r02 = s.r0 * s.r0, r12 = s.r1 * s.r1;
  let n = 0, own = 0, cx = 0, cy = 0, cz = 0;
  for (const b of blocks) {
    if (b.st !== SET) continue;
    const vx = b.x - s.x, vy = b.y - s.y, vz = b.z - s.z;
    // 先看「離揮動平面多遠」：這一刀就這麼薄，絕大多數積木在這裡就被篩掉
    if (Math.abs(vx * s.nx + vy * s.ny + vz * s.nz) > s.band) continue;
    const a = vx * s.u0x + vy * s.u0y + vz * s.u0z;       // 平面內座標
    const c = vx * s.e2x + vy * s.e2y + vz * s.e2z;
    const d2 = a * a + c * c;
    if (d2 < r02 || d2 > r12) continue;
    const th = Math.atan2(c, a);
    if (th < aFrom || th > aTo) continue;                 // 這一幀掃過的那一小段角度
    const r = Math.sqrt(d2);
    const sp = Math.min(SW_HIT_MAX, om * r * SW_HIT_K);
    /* 刃前進的方向（平面內的切線）＝ 對 θ 微分：−sin θ·u0 ＋ cos θ·e2。
       用 a／c 直接寫就是 (−c·u0 ＋ a·e2) / r。 */
    const tx = (-c * s.u0x + a * s.e2x) / r,
          ty = (-c * s.u0y + a * s.e2y) / r,
          tz = (-c * s.u0z + a * s.e2z) / r;
    const gx = (a * s.u0x + c * s.e2x) / r,               // 平面內的徑向（往刃尖那一頭）
          gy = (a * s.u0y + c * s.e2y) / r,
          gz = (a * s.u0z + c * s.e2z) / r;
    const ow = b.hh < 0;                     // 同 smash：breakBlock 會把 hh 清掉，要先看
    /* 主要沿著刃前進的方向飛，另外帶兩成五的徑向（削出去的碎料才會散成一把扇形，
       不是一整排平移），再加一股往上的抬升——抬升一律往上：斜著往下砍的那一刀，
       切線本身是朝下的，照切線給的話碎料會被壓進地面。 */
    breakBlock(b,
      tx * sp + gx * sp * 0.25 + rr(-1.6, 1.6),
      Math.abs(ty * sp + gy * sp * 0.25) * 0.35 + rr(2.4, 6.8) + sp * 0.12,
      tz * sp + gz * sp * 0.25 + rr(-1.6, 1.6));
    n++; if (ow) own++;
    cx += b.x; cy += b.y; cz += b.z;
  }
  if (!n) return;
  const at = { x: cx / n, y: cy / n, z: cz / n };
  afterHit(n, at, s.band, own);
  spawnDust(at, s.band, n);
  /* 一趟揮擊只震一次、只響一聲：它是「會持續破壞」的道具（每一幀都在切），
     每幀都震的話畫面會一路抖到揮完（同投石機與雷，見 README〈會持續破壞的不震畫面〉）。 */
  if (!s.hit) {
    s.hit = true;
    ENG.shake(0.6 + Math.min(1.4, n * 0.02));
    sndSmash();
  }
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
       第 g 層的積木占 y ∈ [g, g+BS]，中心在 g+HB。
       這一行**不要**收成 hardAt 一次（v1.158.1 整理時特地留著）：前半是把座標對齊
       藍圖格線之後才問的（cellX／round／cellZ），後面那次 homeSolid 用的是**沒對齊的
       原始座標**——兩邊格線不同源（見 solidAt），房子要用自己的原點問才準。
       併成一次的話，房子邊界上那半格會漏判。 */
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
  if (tool === 'fw') {
    /* 點在建築上就從那一點射上去（v1.137，使用者指定）；點地面照舊從地面。
       往鏡頭方向退 FW_OUT 才不會有一半的尾巴埋在那塊積木裡。 */
    const q = hit.point, d = hit.dir;
    launchFw(hit.kind === 'block' && d
      ? { x: q.x - d.x * FW_OUT, y: Math.max(0, q.y - d.y * FW_OUT), z: q.z - d.z * FW_OUT }
      : { x: q.x, z: q.z });
    return 0;
  }
  if (tool === 'fire') { torch(hit); return 0; }
  if (tool === 'bucket') { pourWater(hit); return 0; }
  if (tool === 'bomb') { placeBomb(hit.point); return 0; }
  if (tool === 'meteor') { callMeteor(hit.point); return 0; }
  if (tool === 'nuke') { callNuke({ x: hit.point.x, z: hit.point.z }); return 0; }
  if (tool === 'magic') { castMagic({ x: hit.point.x, z: hit.point.z }); return 0; }
  if (tool === 'storm') { callStorm({ x: hit.point.x, z: hit.point.z }); return 0; }
  if (tool === 'drop') { dropBall(hit.point); return 0; }
  // 第二下點在建築上就連高度一起當目標（v1.152，見 pickGate）
  if (tool === 'gate') { pickGate(hit.point, hit.kind === 'block'); return 0; }
  // 兩下之中點在建築上的那一下決定劍柄的高度（v1.161，見 aimSword）
  if (tool === 'sword') { aimSword(hit.point, hit.kind === 'block'); return 0; }
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


/* ── 天災（v1.138）─────────────────────────────────────
   地標蓋完之後過一陣子，會有東西從場邊慢慢走進來砸場（使用者：「自動天災事件
   設計成可擴充多種／地標建築完成後 計時 10~15 分鐘之間啟動」）。

   跟閒晃事件（game-workers.js 的 IDLE_EVENTS）同一個做法：一張表，每一筆是
   { id, wt 相對權重, start() }。加第三種天災就是往這張表再放一列，別處一個字都不必動。

   倒數只在 phase === 'done' 走——那才是「地標蓋完、還好端端站著」。開工（build）、
   整地（clear）、已經在拆了（wreck）都不數：那幾個階段沒有一座完好的地標可以砸。
   場上還有東西在演的時候也不數（一次一件）；等牠走了、地標還在，才重抽一次時間再數。 */
const DOOM_LO = 600, DOOM_HI = 900;   // 10~15 分鐘。照模擬時間走，所以開 4 倍速就快 4 倍
/* 「小人大小」＝照小人身高倍率的中間值放大。兩隻的模型高（黑獼猴 1.31、白猴子 1.45）
   本來就是拿小人連安全帽的 1.31 當尺畫的，所以乘同一個倍率，站在一起就是那個比例。 */
const DOOM_SC = (W_LO + W_HI) / 2;
const DOOM_WALK = 2.2;                // 「慢慢走過來」：小人走路是 WALK 6.8，這是三分之一
const DOOM_OUT = 3;                   // 從碎料場外緣再往外幾格出現／退場
const DOOM_AIM = 1.1;                 // 站定到動手之間停幾秒（看得出牠在瞄）
const DOOM_ARM = 4;                   // 抬手的快慢
const DOOM_NEAR = 3.2;                // 走到離目標這麼近就夠了（火把搆得到）
const DOOM_RAISE = { ape: 1.5, snow: 2.6 };   // 右手抬到底幾度：送火把 vs 舉過頭要丟
let beasts = null;                    // 場上那幾隻（天災來的 ＋ 吉祥物，差在 m.fun）
let nanas = null;                     // 飛在半空的香蕉炸彈
let doomT = -1;                       // 倒數（−1＝沒在數）

const DOOMS = [
  /* 事件一：黑獼猴，拿手上的火把把地標點著。火會自己往鄰居蔓延（見 spreadFire），
     所以牠只要點著腳邊那幾塊就可以走了。 */
  { id: 'ape', wt: 1, start: () => spawnBeast('ape') },
  /* 事件二：白猴子，把香蕉形狀的炸彈拋到地標上。 */
  { id: 'snow', wt: 1, start: () => spawnBeast('snow') },
  /* 事件三：飛龍，從場外飛進來、在工地上空盤旋一圈多，中途吐幾顆火球。 */
  /* 包一層再叫，不要直接把 spawnDragon 掛上去：牠從 v1.144 起吃一個 fun 參數，
     哪天有人改成 start(i) 之類的，天災那條龍就會變成吉祥物版（不吐火球）。 */
  { id: 'dragon', wt: 1, start: () => spawnDragon() }
];
/* 照權重挑一件。回傳 null 只有一種情況：表是空的。（同 rollIdleEvent） */
function rollDoom() {
  let tot = 0;
  for (const d of DOOMS) tot += d.wt;
  if (tot <= 0) return null;
  let r = Math.random() * tot;
  for (const d of DOOMS) { r -= d.wt; if (r < 0) return d; }
  return DOOMS[DOOMS.length - 1];      // 浮點誤差的保險
}
/* 誰來了就做什麼。表在上面、動作在下面，加新的天災時兩邊各加一列，互不干擾。 */
const DOOM_ACT = { ape: apeStrike, snow: nanaThrow };

/* 從場邊放一隻進來。方位隨機——固定一邊的話，鏡頭剛好對著另一邊就永遠看不到牠走過來。
   fun＝這一隻是吉祥物（v1.144）：同一份造型、同一套走路，只是不動手（見檔案最後那一節）。 */
function spawnBeast(kind, fun) {
  const a = Math.random() * Math.PI * 2, d = arenaR + DOOM_OUT;
  const m = {
    kind, x: Math.cos(a) * d, y: 0, z: Math.sin(a) * d,
    a: Math.atan2(-Math.cos(a), -Math.sin(a)),      // 一出現就面向工地
    ph: 0, gait: 0, leg: 0, tx: 0, tz: 0, ghost: 0, pause: 0,
    sc: DOOM_SC, arm: 0, raise: DOOM_RAISE[kind], bomb: 1, st: 'come', t: 0,
    fun: fun ? 1 : 0, stay: fun ? rr(MASC_STAY[0], MASC_STAY[1]) : 0,
    /* 被破壞工具打到之後要用的（v1.146）。spin 是躺平角、roll 是打滾角，
       其餘欄位跟小人同名同義（見檔案最後那一節的 hurtBeast）。 */
    spin: 0, roll: 0, lie: 0, air: 0, vx: 0, vy: 0, vz: 0, tsp: 0, fall: 0,
    lit: 0, burn: 0, brl: 0, bem: 0, rph: 0, wet: 0, bx: 0, bz: 0, br: 0, ba: 0
  };
  if (!beasts) beasts = [];
  beasts.push(m);
  sndBeast(kind === 'snow');
  const nm = kind === 'ape' ? '🐒 黑獼猴' : '🐵 白猴子';
  if (fun) toast(nm + '來工地逛逛', '牠不會動手，晃一圈就走');
  else toast(nm + '朝工地過來了',
             kind === 'ape' ? '牠手上有一支火把' : '牠手上有一根綁著膠帶的香蕉');
  return m;
}
/* 離這個位置最近的那一塊地標（還站著的）。天災那幾隻拿它當「要砸哪裡」。
   小人的家不算：使用者指定的是「對地標」動手。 */
function nearSet(x, z) {
  let best = null, bd = Infinity;
  for (const b of blocks) {
    if (b.st !== SET || b.hh >= 0) continue;
    const d = (b.x - x) ** 2 + (b.z - z) ** 2;
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}
function leaveBeast(m) {
  m.st = 'go';
  const d = Math.hypot(m.x, m.z) || 1;
  m.tx = m.x / d * (arenaR + DOOM_OUT);
  m.tz = m.z / d * (arenaR + DOOM_OUT);
}
/* 一隻的一幀。回傳 true＝走出場外了，收掉。

   走法**借小人那一套**（使用者：「可以按照小人行走邏輯 不要穿越地標建築&小房子」）：
     come  strollTo：它會把「工地中心」這個目標推到建築外圈那一環上，所以牠停在
           建築邊上不會走進去；路上有小人的家也是它繞開的（dodgeHome／pushOutHome）。
     near  那一環是照 siteR 畫的圓，而 siteR 有 7 的下限，小一點的地標離環還有幾格。
           所以再往最近那一塊走幾步——但**下一步會踩進建築或房子的格子就停**，
           「不要穿越」在這裡是硬條件，不是靠繞路碰運氣。
     act   站定、轉向、抬手，停 DOOM_AIM 秒才動手（看得出牠在瞄）。
     go    原路走回場外。 */
function stepBeast(m, dt) {
  if (m.kind === 'dragon') return stepDragon(m, dt);      // 牠不走路，自己一套（見下面）
  /* 被破壞工具打到了（v1.146）：飛、躺、燒那幾段自己一套，這一幀底下整段跳過（同小人）。 */
  if (hurtBeast(m, dt)) return false;
  const spd = m.herd ? HERD_WALK : DOOM_WALK;             // 牛羊散步，比猴子再慢一截
  /* 開工／整地就放棄走人：天災是衝著「蓋好的那一座」來的，半成品不在它的守備範圍
     （也免得牠站在推土機的路線上）。
     吉祥物只避整地（v1.144）：牠不挑地標的狀態，施工中照樣可以來逛（使用者選的），
     但整地那一段推土機會把整片工地掃過去，走路的先讓開。
     牛羊哪一段都不避（v1.154）：牠們住在這裡，沒有「走人」這件事——而且本來就只在
     建築外圈那一環上晃（strollTo 會把目標推到圈外），推土機掃的是圈內。 */
  const away = m.herd ? false
             : m.fun ? phase === 'clear' : (phase === 'build' || phase === 'clear');
  if (away && m.st !== 'go') leaveBeast(m);
  m.arm += ((m.st === 'act' ? 1 : 0) - m.arm) * Math.min(1, dt * DOOM_ARM);
  if (m.st === 'come') {
    m.tx = 0; m.tz = 0;
    if (strollTo(m, dt, spd, m.herd ? HERD_STEP : 0)) {
      /* 吉祥物走到建築外圈就開始逛，不進 near／act——那兩段是要動手的人才走的。 */
      m.st = m.fun ? 'fun' : 'near';
      /* 進場那一段路不算進「站多久」：strollPause 是照剛走完那段路算的，
         不歸零的話牠一到工地就會照著「從場外走進來的那五十幾格」站著發呆十幾秒。 */
      m.leg = 0;
    }
    return false;
  }
  /* 吉祥物：在建築外圈那一環上晃，晃夠 m.stay 秒就走人（使用者：「只是出現逛一逛
     一段時間又走了」）。逛的點跟小人閒晃借同一支 idleSpot——那一環本來就是
     「繞著建築、又還在鏡頭裡」的範圍，也已經會避開小人的家；站多久也照小人那套
     （strollPause，跟剛走完那段路成比例）。 */
  if (m.st === 'fun') {
    /* 牛羊沒有這個倒數（v1.154）：逛完不走人，這一段就是牠們的日常。 */
    if (!m.herd) {
      m.stay -= dt;
      if (m.stay <= 0) { leaveBeast(m); return false; }
    }
    if (m.pause > 0) {
      m.pause -= dt;
      m.gait += (0 - m.gait) * Math.min(1, dt * 8);
      return false;
    }
    if (strollTo(m, dt, spd, m.herd ? HERD_STEP : 0)) {
      /* 站多久：猴子照剛走完那段路算（strollPause），牛羊改成固定抽——
         牠們一趟只走幾格，照比例算的話停不到一秒，看起來是一直在繞圈。 */
      if (m.herd) { m.pause = rr(HERD_STAY[0], HERD_STAY[1]); m.leg = 0; }
      else strollPause(m);
      idleSpot(m);
    }
    return false;
  }
  if (m.st === 'near') {
    const b = nearSet(m.x, m.z);
    if (!b) { leaveBeast(m); return false; }          // 沒東西可砸了（都被拆光）
    const dx = b.x - m.x, dz = b.z - m.z, d = Math.hypot(dx, dz) || 1;
    m.a = Math.atan2(dx, dz);
    /* 還想再走多遠。**要留一格浮點的餘裕**：走到剩下剛好 DOOM_NEAR 時，
       d 會是 3.2000000000000006 這種數，`d <= DOOM_NEAR` 永遠不成立，
       而該走的距離已經是 0——牠就會站在那裡不動、也不動手（實測 12 次卡住 2 次）。 */
    const adv = Math.max(0, d - DOOM_NEAR);
    // 往前探半格：等踩進去才判斷的話，這一幀已經站在牆裡面了
    const ex = m.x + dx / d * (adv + 0.5), ez = m.z + dz / d * (adv + 0.5);
    if (adv < 0.05 || footBlocked(ex, ez) || homeFoot(ex, ez)) {
      m.st = 'act'; m.t = DOOM_AIM;
      return false;
    }
    const sp = Math.min(DOOM_WALK * dt, adv);
    m.x += dx / d * sp; m.z += dz / d * sp;
    pushOutHome(m);
    m.ph += dt * 11;
    m.gait += (0.85 - m.gait) * Math.min(1, dt * 8);
    return false;
  }
  if (m.st === 'act') {
    m.gait += (0 - m.gait) * Math.min(1, dt * 8);
    m.t -= dt;
    if (m.t > 0) return false;
    DOOM_ACT[m.kind](m);
    leaveBeast(m);
    return false;
  }
  return strollTo(m, dt, DOOM_WALK);
}

/* ── 事件一：黑獼猴放火 ─────────────────────────────────
   點的是離牠最近的那一塊地標——牠就站在旁邊，那一塊正在火把底下。
   再照餘火那套往周圍撒幾塊（igniteAround），剩下的交給火自己蔓延。
   igniteAt 會順手把 phase 從 done 推到 wreck（那是「地標開始垮了」的記號）。 */
const DOOM_FIRE_R = 4, DOOM_FIRE_N = 5;
function apeStrike(m) {
  const b = nearSet(m.x, m.z);
  if (!b) return 0;
  const p = { x: b.x, y: b.y, z: b.z };
  let n = igniteAt(p.x, p.y, p.z) ? 1 : 0;
  n += igniteAround(p, DOOM_FIRE_R, DOOM_FIRE_N, SET);
  sndFire();
  return n;
}

/* ── 事件二：白猴子丟香蕉炸彈 ───────────────────────────
   落點與拋物線跟投石機的石頭同一套（見 fireRock）：地標中心一帶隨機取一點、
   高度取那附近最高的一塊，湊出剛好 NANA_T 秒抵達的初速。 */
const NANA_R = 9, NANA_POW = 14;      // 威力在投石機的石頭（12）與定時炸彈（17）之間
const NANA_T = 1.15;                  // 飛多久
const NANA_HAND = 1.55;               // 出手高度（模型單位，舉過頭的那隻手）
const NANA_SPIN = 9;                  // 飛的時候翻多快
function nanaThrow(m) {
  const a = Math.random() * Math.PI * 2, rad = Math.sqrt(Math.random()) * siteR * 0.7;
  const tx = Math.cos(a) * rad, tz = Math.sin(a) * rad;
  let ty = 0;
  for (const b of blocks) {
    if (b.st !== SET) continue;
    if (Math.abs(b.x - tx) > 1.8 || Math.abs(b.z - tz) > 1.8) continue;
    if (b.y > ty) ty = b.y;
  }
  const sy = NANA_HAND * DOOM_SC;
  const n = {
    kind: 'nana', x: m.x, y: sy, z: m.z,
    s: 0.7 * DOOM_SC,                                  // sweepRock 拿它當碰撞半徑
    sc: DOOM_SC, a: Math.atan2(tx - m.x, tz - m.z), spin: 0, t: 0,
    vx: (tx - m.x) / NANA_T, vz: (tz - m.z) / NANA_T,
    vy: (ty + 0.6 - sy) / NANA_T + 0.5 * GRAV * NANA_T   // 解拋物線：湊出剛好 NANA_T 秒抵達
  };
  if (!nanas) nanas = [];
  nanas.push(n);
  m.bomb = 0;                         // 手上那根跟著不見（見引擎的 putBeasts）
  sndSwing();
  return n;
}
function stepNanas(dt) {
  if (!nanas) return;
  for (let i = nanas.length - 1; i >= 0; i--) {
    const n = nanas[i];
    const px = n.x, py = n.y, pz = n.z;
    n.t += dt;
    n.vy -= GRAV * dt;
    n.x += n.vx * dt; n.y += n.vy * dt; n.z += n.vz * dt;
    n.spin += dt * NANA_SPIN;
    /* 撞到就當場炸。小人的家也算固體（hardAt）：blockAt 只認地標的格子表，
       不算的話香蕉會從人家屋頂穿過去（v1.135 那條的同一個坑）。
       飛過頭或落地也炸——不然丟歪的那一根會一路飛出場外。 */
    if (sweepRock(n, px, py, pz, hardAt) || n.t > NANA_T * 2.5 || n.y <= 0.4) {
      nanas.splice(i, 1);
      explode({ x: n.x, y: Math.max(0.5, n.y), z: n.z }, NANA_R, NANA_POW);
    }
  }
  if (!nanas.length) nanas = null;
}

/* 天災的鐘。主迴圈每幀叫一次（見 game-ui.js 的 step）。 */
function stepDoom(dt) {
  stepNanas(dt);
  stepFballs(dt);
  if (beasts) {
    for (let i = beasts.length - 1; i >= 0; i--)
      if (stepBeast(beasts[i], dt)) beasts.splice(i, 1);
    if (!beasts.length) beasts = null;
  }
  if (phase !== 'done') { doomT = -1; return; }     // 沒有一座完好的地標可砸
  /* 一次一件，等這一件演完。**吉祥物不算**（v1.144）：那是另一條線，場上有牠在逛的
     時候天災的鐘照數——不排除的話，三隻輪流來逛就等於把天災關掉了。 */
  if (nanas || fballs || (beasts && beasts.some(m => !m.fun && !m.herd))) return;
  if (doomT < 0) { doomT = rr(DOOM_LO, DOOM_HI); return; }
  doomT -= dt;
  if (doomT > 0) return;
  doomT = -1;
  const d = rollDoom();
  if (!d) return;
  /* 抽到的剛好是場上那隻吉祥物的同一種：讓牠**就地翻臉**，不要再從場外放一隻同款的
     進來（不然畫面上會是兩隻一模一樣的猴子，一隻在放火、一隻在散步）。見 turnBad。 */
  if (!turnBad(d.id)) d.start();
}
/* 要畫的清單：場上那幾隻 ＋ 飛在半空的香蕉，引擎那邊一顆網格畫完。
   重用同一個陣列，不要每幀配置一個新的。 */
const _beasts = [];
function beastList() {
  _beasts.length = 0;
  if (beasts) for (const m of beasts) _beasts.push(m);
  if (nanas) for (const n of nanas) _beasts.push(n);
  if (fballs) for (const f of fballs) _beasts.push(f);
  return _beasts;
}

/* ── 事件三：飛龍（v1.139）───────────────────────────────
   使用者：「一隻飛龍從空中飛過 隨機對目標噴出火球」，並附了一張參考圖；
   看過造型之後追加：「飛的翅膀跟身體太過僵硬／火球大約隕石那樣大 不要連噴／
   從場外飛進工地稍微盤旋一下 中途吐幾顆火球」。

   航線是**用轉向速度開出來的**，不是照圓的參數式擺位置：
     in    朝工地中心飛
     ring  沿切線飛（同時把半徑誤差修回來），繞滿 DRA_RING 圈
     out   照當下的朝向直直飛出場外
   每一幀只准轉 DRA_TURN，所以圓弧是「轉出來的」——半徑 ≒ 速度 ÷ 轉向速度。
   這樣做的好處是**轉多急就側傾多少**（roll 直接拿轉向速率算），不必另外編動畫；
   照參數式擺位置的話，進場那一刻朝向會瞬間跳到切線上，看起來像瞬移。 */
const DRA_SC = 2.1;                  // 模型翼展 9.7 → 場上 20.4 格
const DRA_SPD = 15;                  // 飛多快（格／秒）
const DRA_TURN = 0.62;               // 每秒最多轉幾弧度 → 盤旋半徑 ≒ 15 ÷ 0.62 = 24 格
const DRA_UP = 12;                   // 飛在建築頂上多高
const DRA_MIN = 30;                  // 最低飛行高度（矮建築也要飛得夠高才像在天上）
const DRA_RING = 1.35;               // 在工地上空繞幾圈（「稍微盤旋一下」）
const DRA_ROLL = 0.42;               // 轉到最急時往內側傾斜幾弧度
const DRA_FLAP = 3.1;                // 拍翅的快慢（弧度／秒）
const DRA_PITCH = 0.11, DRA_BOB = 0.32;   // 身體跟著拍翅俯仰／上下浮（相位比翅膀晚一點）
const DRA_OUT = 14;                  // 從場外多遠進來／飛到多遠收掉
const DRA_SHOT = [3, 5];             // 一趟吐幾顆
const DRA_GAP = [1.1, 2.2];          // 兩顆之間隔幾秒（「不要連噴」）
let fballs = null;                   // 飛在半空的火球

/* 放一條龍進來。方位隨機，順時針逆時針也隨機——固定的話每次看到的都一樣。
   fun＝吉祥物那一版（v1.144）：航線一模一樣，只是 left 給 0，一顆火球都不吐。 */
function spawnDragon(fun) {
  const a = Math.random() * Math.PI * 2, d = arenaR + DRA_OUT;
  const m = {
    kind: 'dragon', x: Math.cos(a) * d, z: Math.sin(a) * d,
    y: Math.max(DRA_MIN, (bp ? bp.height : 20) + DRA_UP),
    a: Math.atan2(-Math.cos(a), -Math.sin(a)),      // 一出現就朝著工地
    ph: 0, roll: 0, spin: 0, sc: DRA_SC, gait: 0,
    st: 'in', rc: Math.min(arenaR - 6, siteR + 12), dir: Math.random() < 0.5 ? 1 : -1,
    turned: 0, left: fun ? 0 : Math.round(rr(DRA_SHOT[0], DRA_SHOT[1])), gap: rr(0.4, 1.2),
    fun: fun ? 1 : 0,
    /* 被打下來之後要用的（v1.146，見 crashDragon）：was 是摔之前在哪一段、
       t 是趴著的倒數、tsp 是摔下去時的翻滾角速度。 */
    was: '', t: 0, tsp: 0, vx: 0, vy: 0, vz: 0, lie: 0, wet: 0, burn: 0, air: 0, fall: 0
  };
  if (!beasts) beasts = [];
  beasts.push(m);
  sndRoar();
  if (fun) toast('🐉 一條龍飛過工地上空', '牠只是繞一圈就走，不會吐火球');
  else toast('🐉 一條龍朝工地飛過來了', '牠會在上空繞一圈，邊繞邊吐火球');
  return m;
}
/* 一條龍的一幀。回傳 true＝飛出場外了，收掉。 */
function stepDragon(m, dt) {
  /* 濕度自己在這裡遞減：走地上的那幾隻是 hurtBeast 在減，而牠不走那一支（v1.154）。 */
  if (m.wet > 0) m.wet = Math.max(0, m.wet - dt);
  /* 被打下來了（v1.146）：摔 → 趴 → 拍翅起飛，那三段自己一套（見 fallenDragon）。 */
  if (m.st === 'crash' || m.st === 'down' || m.st === 'rise') return fallenDragon(m, dt);
  if (m.st === 'ablaze') return ablazeDragon(m, dt);      // 身上著火（v1.154，見 burnDragon）
  m.ph += dt * DRA_FLAP;
  const r = Math.hypot(m.x, m.z) || 1;
  let want = m.a;
  if (m.st === 'in') {
    /* 朝**圓的切點**飛，不是朝中心飛：朝中心飛的話，到了圓上還得再轉 90 度才轉得到
       切線方向，而每秒只准轉 DRA_TURN——那 2.5 秒牠已經衝進圈內去了
       （實測盤旋半徑在 18~39 之間晃，圈整個偏掉）。偏開 asin(rc / 距離) 這個角度
       就會擦著圓進去，到圓上時朝向剛好就是切線。 */
    const off = Math.asin(Math.min(1, m.rc / r));
    want = Math.atan2(-m.x, -m.z) + m.dir * off;
    if (r <= m.rc * 1.04) m.st = 'ring';
  } else if (m.st === 'ring') {
    /* 切線方向 ＋ 半徑誤差修正：飛太遠就往內偏、太近就往外偏。
       只給切線的話，進場時半徑差多少就一直差多少，繞出來的是一個偏心的圈。 */
    const nx = m.x / r, nz = m.z / r;
    const err = Math.max(-1, Math.min(1, (r - m.rc) / (m.rc * 0.5)));
    want = Math.atan2(-nz * m.dir - nx * err, nx * m.dir - nz * err);
    m.turned += dt * DRA_SPD / m.rc;
    if (m.turned >= DRA_RING * Math.PI * 2) m.st = 'out';
    /* 邊繞邊吐（「中途吐幾顆火球」）。隔開來吐，不連噴。 */
    m.gap -= dt;
    if (m.gap <= 0 && m.left > 0) { spitFire(m); m.left--; m.gap = rr(DRA_GAP[0], DRA_GAP[1]); }
  }
  /* 轉向限速——圓弧是這樣轉出來的。轉多急就側傾多少（往內側倒）。 */
  let d = want - m.a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  const rate = Math.max(-DRA_TURN, Math.min(DRA_TURN, d / Math.max(dt, 1e-4)));
  m.a += rate * dt;
  m.roll += (-rate / DRA_TURN * DRA_ROLL - m.roll) * Math.min(1, dt * 3);
  m.x += Math.sin(m.a) * DRA_SPD * dt;
  m.z += Math.cos(m.a) * DRA_SPD * dt;
  /* 身體跟著拍翅俯仰與上下浮，相位比翅膀晚一點——先拍翅，身體才被抬起來。 */
  m.spin = DRA_PITCH * Math.sin(m.ph + 0.8);
  m.y = Math.max(DRA_MIN, (bp ? bp.height : 20) + DRA_UP) + DRA_BOB * Math.sin(m.ph - 1.0);
  return m.st === 'out' && Math.hypot(m.x, m.z) > arenaR + DRA_OUT;
}

/* ── 火球 ───────────────────────────────────────────────
   大小與威力比照隕石（使用者：「火球大約隕石那樣大」）：範圍 9.2、威力 16，
   落點一帶再多點幾塊起來——重點在火不在爆炸，剩下的交給火自己蔓延。
   **v1.151 起這兩個數字自己一組，不再寫成 MET_R／MET_POW**：使用者那句話講的是
   v1.146 當時的隕石（9.2／16），而隕石在 v1.151 被指定放大（v1.151.1 定案是半徑 ×2、
   範圍 18.4）。跟著走的話，飛龍的火球會被隕石的每一次調整帶著跑——那是另一把道具。 */
const FB_R = 9.2, FB_POW = 16;
const FB_SC = 2.6;                   // 畫多大：模型的芯 0.62 → 場上 1.6 格（同上，比的是當年的石身 2）
const FB_SPD = 30;                   // 吐出去多快
const FB_MOUTH = 3.3, FB_JAW = 0.7;  // 嘴巴在模型的哪裡（往前 3.3、往上 0.7）
function spitFire(m) {
  /* 隨機挑一個目標：地標中心一帶取一點，高度取那附近最高的一塊——
     不取高度的話火球會穿過屋頂才炸。 */
  const a = Math.random() * Math.PI * 2, rad = Math.sqrt(Math.random()) * siteR * 0.8;
  const tx = Math.cos(a) * rad, tz = Math.sin(a) * rad;
  let ty = 0;
  for (const b of blocks) {
    if (b.st !== SET) continue;
    if (Math.abs(b.x - tx) > 1.8 || Math.abs(b.z - tz) > 1.8) continue;
    if (b.y > ty) ty = b.y;
  }
  const sx = m.x + Math.sin(m.a) * FB_MOUTH * DRA_SC;
  const sz = m.z + Math.cos(m.a) * FB_MOUTH * DRA_SC;
  const sy = m.y + FB_JAW * DRA_SC;
  const dist = Math.hypot(tx - sx, ty - sy, tz - sz);
  const T = Math.max(0.35, dist / FB_SPD);
  const f = {
    kind: 'fball', x: sx, y: sy, z: sz, sc: FB_SC, s: 1.1,   // s 是 sweepRock 的碰撞半徑
    a: Math.atan2(tx - sx, tz - sz), spin: 0, em: 0, t: 0, T,
    vx: (tx - sx) / T, vz: (tz - sz) / T,
    vy: (ty + 0.5 - sy) / T + 0.5 * GRAV * T          // 解拋物線：湊出剛好 T 秒抵達
  };
  if (!fballs) fballs = [];
  fballs.push(f);
  sndSpit();
}
function stepFballs(dt) {
  if (!fballs) return;
  for (let i = fballs.length - 1; i >= 0; i--) {
    const f = fballs[i];
    const px = f.x, py = f.y, pz = f.z;
    f.t += dt;
    f.vy -= GRAV * dt;
    f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt;
    f.spin += dt * 6;
    /* 拖著火：沿著這一幀走過的線段補火苗（同隕石那一套，見 stepMeteors）。
       只在端點生的話，尾巴會斷成一節一節的。 */
    f.em += dt * 90;
    while (f.em >= 1) {
      f.em--;
      if (hot.length > HOT_MAX - 40) break;
      const head = Math.random() < 0.34;
      const u = head ? 1 : Math.random();
      const j = head ? 1.1 : 0.28;
      hot.push({
        x: px + (f.x - px) * u + rr(-j, j),
        y: py + (f.y - py) * u + rr(-j, j),
        z: pz + (f.z - pz) * u + rr(-j, j),
        vx: rr(-0.7, 0.7), vy: rr(0.5, 1.9), vz: rr(-0.7, 0.7),
        rx: Math.random() * 6, ry: Math.random() * 6,
        s: head ? rr(0.8, 1.5) : rr(0.22, 0.55),
        life: head ? rr(0.1, 0.2) : rr(0.14, 0.36),
        g: -1.6, grow: head ? 1.1 : 1.04, cool: rr(0.2, 0.42),
        cr: 1, cg: rr(0.5, 0.84), cb: rr(0.06, 0.22), to: [0.55, 0.1, 0.02]
      });
    }
    /* 撞到就炸。小人的家也算固體（hardAt）：blockAt 只認地標的格子表。
       飛過頭或落地也炸——不然吐歪的那一顆會一路飛出場外。 */
    if (sweepRock(f, px, py, pz, hardAt) || f.t > f.T * 2 || f.y <= 0.5) {
      fballs.splice(i, 1);
      fballHit(f);
    }
  }
  if (!fballs.length) fballs = null;
}
function fballHit(f) {
  const p = { x: f.x, y: Math.max(0.8, f.y), z: f.z };
  explode(p, FB_R, FB_POW);
  /* 爆炸本身帶一點餘火，但這是火球——落點一帶再多點幾塊起來，
     這是它跟同尺寸的普通爆炸最明顯的差別（同隕石）。 */
  igniteAround(p, FB_R * 1.6, Math.round(FB_R * 1.6), SET);
}

/* ── 吉祥物（v1.144）─────────────────────────────────────
   使用者：「黑獼猴 白猴子 飛龍 列為吉祥物／吉祥物一段時間就會出來刷存在感
   （不搞破壞 只是出現逛一逛 一段時間又走了）／各吉祥物出來刷存在感的事件各自獨立
   （所以有機會一起出沒）」。

   跟天災是同一批動物、同一份造型、同一套走路（spawnBeast／spawnDragon 多吃一個 fun
   旗標就是了），差在三件事：
     · **各自一個鐘**：不是天災那個共用的 doomT，一隻一個倒數，所以三隻有機會一起在場上。
     · **不動手**：猴子走到建築外圈就開始逛，不進 near／act 那兩段，DOOM_ACT 根本不會被
       叫到（不點火、不丟香蕉）；龍的 left 給 0，一顆火球都不吐。
     · **不挑階段**：施工中、蓋好、拆除中都會來（使用者選的「任何時候都可能」）。天災那條
       phase === 'done' 是因為「要有一座完好的地標可以砸」，吉祥物沒有這個需求；只有整地
       那一段走路的先不放進來（推土機會把整片工地掃過去，見 stepBeast 的 away）。
   兩條線互不擋：吉祥物在場上時天災的鐘照數（見 stepDoom），反過來也一樣。 */
const MASC_LO = 180, MASC_HI = 360;   // 3~6 分鐘。跟天災一樣照模擬時間走，開 4 倍速就快 4 倍
const MASC_STAY = [25, 45];           // 走到工地邊之後逛幾秒才走人（「一段時間又走了」）
/* 一隻一列。加第四隻吉祥物＝往這張表再放一列，別處一個字都不必動（同 DOOMS）。
   ground＝用走的，整地那一段先不放進來；龍在天上，推土機碰不到牠，照樣可以來。 */
const MASCOTS = [
  { id: 'ape', ground: 1, spawn: () => spawnBeast('ape', 1) },
  { id: 'snow', ground: 1, spawn: () => spawnBeast('snow', 1) },
  { id: 'dragon', ground: 0, spawn: () => spawnDragon(1) }
];
const mascT = MASCOTS.map(() => -1);  // 每隻各自的倒數（−1＝還沒抽），跟 MASCOTS 同索引
/* 這一種現在在不在場上。**不分吉祥物還是天災**：同款的已經在場上了就別再放一隻進來，
   不然會看到兩隻一模一樣的猴子並排走過去。 */
function beastOn(id) {
  if (!beasts) return false;
  for (const m of beasts) if (m.kind === id) return true;
  return false;
}
/* 吉祥物的鐘。主迴圈每幀叫一次（見 game-ui.js 的 step），三隻各數各的、互不干擾。 */
function stepMascot(dt) {
  for (let i = 0; i < MASCOTS.length; i++) {
    const k = MASCOTS[i];
    if (beastOn(k.id)) { mascT[i] = -1; continue; }   // 還在場上，等牠走了再重抽下一次
    if (k.ground && phase === 'clear') continue;      // 整地中：鐘先停著，不推進也不放人
    if (mascT[i] < 0) { mascT[i] = rr(MASC_LO, MASC_HI); continue; }
    mascT[i] -= dt;
    if (mascT[i] > 0) continue;
    mascT[i] = -1;
    k.spawn();
  }
}
/* 把場上那隻吉祥物就地轉成天災（v1.145，使用者：「如果吉祥物進來剛好抽到天災
   能直接把行為轉換成天災嗎」）。轉得成回傳 true，stepDoom 就不再放新的進來。

   只轉**同一種**：DOOMS 抽的是「哪一件天災」，而那一件本來就綁定哪一隻動物
   （id 跟 m.kind 是同一組字），場上是白猴子卻抽到黑獼猴那件，還是得放黑獼猴進來。
   **已經在往場外走的那一隻不轉**：牠都走到一半了又掉頭回來很怪，那種情況照舊
   從場外放一隻新的。 */
function turnBad(id) {
  if (!beasts) return false;
  for (const m of beasts) {
    if (m.kind !== id || !m.fun) continue;
    if (m.kind === 'dragon') {
      if (m.st === 'out') continue;             // 已經在飛出場了
      m.left = Math.round(rr(DRA_SHOT[0], DRA_SHOT[1]));
      /* 繞的圈數歸零＝再繞一圈，這一圈是來吐火球的。不歸零的話牠可能只差幾度就繞滿了，
         配額給了也吐不完就飛走。gap 也要重給：吉祥物那一路 left 是 0，
         gap 早就一直減成負的，不重給的話下一幀就噴，看不出「牠繞回來了」。 */
      m.turned = 0;
      m.gap = rr(0.4, 1.2);
      sndRoar();
      toast('🐉 那條龍又繞回來了', '這一圈牠是來吐火球的');
    } else {
      if (m.st === 'go') continue;              // 已經在走回場外了
      /* 逛到一半就地轉頭去找最近的那一塊。fun 那一段沒有通往 near／act 的路，
         所以狀態要一起推過去；還在 come 的不用動，fun 一拿掉牠到了自己就會進 near。 */
      if (m.st === 'fun') m.st = 'near';
      sndBeast(m.kind === 'snow');
      toast(m.kind === 'ape' ? '🐒 黑獼猴不逛了' : '🐵 白猴子不逛了',
            m.kind === 'ape' ? '牠舉起手上那支火把，朝地標走過去'
                             : '牠舉起手上那根香蕉，朝地標走過去');
    }
    /* 最後才拿掉旗標：上面那幾行還要靠它分辨「牠原本是來逛的」。
       拿掉之後牠就算天災那一件了——stepDoom 的「一次一件」跟著擋住下一件。 */
    m.fun = 0;
    return true;
  }
  return false;
}

/* ── 閒逛的牛羊（v1.154）──────────────────────────────────
   使用者：「增加場上幾隻閒逛的動物（會被破壞工具作用 也會著火類似小人）／
   牛羊 2~3 隻 依照小人行走邏輯不要走進建物裡面」，看過造型之後追加
   「也可以牛羊多種造型隨機出現」（四款：乳牛、黃牛、綿羊、黑面羊）。

   **整套借吉祥物那條路**：同一份 beasts 清單、同一套走路（strollTo／idleSpot，
   所以「不走進建築與小房子」是同一份程式在管）、同一套被打到的反應。差三件事：
     · **不走**：沒有 stay 倒數、也不會 leaveBeast；場上少了就補到滿（stepHerd）。
     · **不挑階段**：整地、施工、拆除都在（牠們只在建築外圈那一環上晃）。
     · **不算天災的「一次一件」**：牠們永遠在場上，算進去的話天災就再也不會來
       （見 stepDoom 的 m.herd）。
   被吹飛、被點著、被水澆熄、被兵器打到那一整套是白吃的——牠們就在 beasts 裡，
   eachBeastNear／tossBeast／igniteBeast／fellBeast／weaponVsBeast 一個字都不必改。 */
const HERD_N = [2, 3];               // 場上養幾隻（使用者：「牛羊2~3隻」）
const HERD_KIND = ['cow', 'ox', 'sheep', 'ram'];
const HERD_WALK = 1.5;               // 走多快（小人 6.8、猴子 2.2；牛羊是散步）
const HERD_STEP = 0.62;              // 腿擺多快（倍率，見 strollTo 的 step）
const HERD_SC = [0.90, 1.08];        // 每一隻的大小抽一個倍率，同一款也不會一模一樣
const HERD_STAY = [3.5, 9];          // 走到了站著吃草幾秒
let herdN = 0;                       // 這一場養幾隻（第一次叫 stepHerd 時抽）

/* 放一隻進來。**直接站在建築外圈那一環上**，不像猴子那樣從場外走進來：
   牠們是這片草地的住戶不是訪客，而且走那麼慢（1.5）的話，從碎料場外緣走到工地
   要半分鐘——開場那半分鐘場上一隻動物都沒有。落腳點借 idleSpot 挑（那一支本來就
   會避開小人的家），先挑一個站著、再挑一個當第一個目標。 */
function spawnCattle() {
  const kind = HERD_KIND[Math.floor(Math.random() * HERD_KIND.length)];
  const m = {
    kind, x: 0, y: 0, z: 0, a: Math.random() * Math.PI * 2,
    ph: 0, gait: 0, leg: 0, tx: 0, tz: 0, ghost: 0,
    pause: rr(0, HERD_STAY[1]),                    // 錯開，不然幾隻同時起步同時停
    sc: DOOM_SC * rr(HERD_SC[0], HERD_SC[1]), arm: 0, bomb: 0, st: 'fun', t: 0,
    /* fun 是「在外圈那一環上逛、不動手」那條路（見 stepBeast）；herd 才是牛羊自己的記號。
       side＝四條腿的，倒下來是往側邊倒（見 lieAng／engine 的 BEAST_SIDE）。 */
    fun: 1, herd: 1, stay: 0, side: 1, sdir: 1,
    spin: 0, roll: 0, lie: 0, air: 0, vx: 0, vy: 0, vz: 0, tsp: 0, fall: 0,
    lit: 0, burn: 0, brl: 0, bem: 0, rph: 0, wet: 0, bx: 0, bz: 0, br: 0, ba: 0
  };
  idleSpot(m);
  m.x = m.tx; m.z = m.tz;
  pushOutHome(m);                                  // 剛好挑在人家屋子裡：推出來
  idleSpot(m);
  if (!beasts) beasts = [];
  beasts.push(m);
  return m;
}
/* 牛羊的鐘。主迴圈每幀叫一次（見 game-ui.js 的 step）：場上不足就補一隻進來。
   平常這一支什麼都不做——牛羊不會走人，所以只有開場那幾幀真的放人。 */
function stepHerd(dt) {
  if (!herdN) herdN = Math.round(rr(HERD_N[0], HERD_N[1]));
  let n = 0;
  if (beasts) for (const m of beasts) if (m.herd) n++;
  if (n < herdN) spawnCattle();
}

/* ── 破壞工具打得到那幾隻（v1.146）────────────────────────
   使用者：「破壞工具也能對吉祥物生效(著火或是被吹飛或是倒地)／黑獼猴 白猴子可以同小人
   的方式製作／飛龍會需要倒地起飛的動作」。

   猴子那兩隻**整套借小人的**：被吹飛就走彈道、落地躺一下再爬起來、著火就在地上打滾
   或抱頭跑圈圈——規則跟 game-workers.js 的 tossWorker／igniteWorker／flyWorker／
   burnMove 一模一樣，只是欄位名照 beast 這邊原本的叫法（躺平角是 m.spin、打滾角是
   m.roll，見 engine 的 putBeasts）。飛龍不一樣：牠在天上，被打到是**摔下來**，
   趴一下再拍翅起飛回航線（見 crashDragon）。

   **吉祥物與天災那幾隻都打得到**：牠們是同一種生物、同一份程式，只差 m.fun 一個旗標，
   只讓其中一邊會痛的話，同一發炸彈打散步的猴子會倒、打放火的猴子沒事，看起來是壞的。
   打倒天災那一隻也只是拖延——躺完牠會爬起來繼續走（而那正是「被工具攻擊倒地」
   這套互動本來的意思）。 */
const B_FALL = [1.4, 2.6];           // 倒地躺幾秒（小人 0.8~2.4，這幾隻大一點、久一點）
const B_BURN = 4.5;                  // 身上的火燒幾秒（小人 W_BURN 是 3）
const B_TOSS_MAX = 18;               // 被拋出去的水平速度上限（小人 W_TOSS_MAX 是 22）
const B_ROLL_AMP = 1.9, B_ROLL_HZ = 0.9, B_ROLL_R = 0.42;   // 打滾（同小人，半徑照身形放大）
const B_BLOW = 0.75;                 // 爆炸掀飛的力道打幾折（牠們比人重一些）
/* 打滾時要抬幾倍的半身厚（m.lie 的值，見 engine 的 putBeasts）。躺著不動是 1.0；
   沿長軸滾到最側面時肩膀那一帶會轉下去，實測最深陷進草皮 0.178（滾到 −0.86 弧度時），
   換算回模型是 0.103 ÷ 半身厚 0.365 ＝ 多 28%，所以取 1.3。 */
const B_ROLL_LIFT = 1.3;
const B_PANIC = 2.6;                 // 抱頭跑圈圈的角速度（小人 W_PANIC 是 3.4）
/* 四條腿的那幾隻**側躺**（v1.154，見 engine 的 BEAST_SIDE）：兩條腿的往後仰躺
   （繞 x 轉 −90°），牛羊照這樣躺會變成用尾巴站著、鼻子朝天——牠們要往側邊倒
   （繞 z 轉 ±90°）。躺著壓火的時候只小幅度前後晃：擺幅大的話抬升的補正
   （SIDE·|sin(roll)|）在 90° 之外就對不準，整隻會浮起來。 */
const B_SIDE_ROCK = 0.14;
/* 往哪一邊倒，每次隨機。兩條腿的沒有這回事（牠們只往後仰）。 */
function lieSide(m) { if (m.side) m.sdir = Math.random() < 0.5 ? 1 : -1; }
/* 這一隻躺平時的角度：側躺的是 roll、仰躺的是 spin。 */
function lieAng(m) { return m.side ? m.sdir * Math.PI * 0.5 : -Math.PI * 0.5; }
/* 側躺著晃的時候 m.lie 要給多少（倍率）。躺平在 90° 時剛好是 1，引擎那邊抬的
   `SIDE·|sin(roll)|` 正好等於半個身寬；偏開 δ 之後**本來朝上那一側會轉到地面下**，
   要多抬 (身高 ÷ 身寬)·tan δ 那麼多。取「最寬 × 最高」那個角來算，所以是寧可
   浮一點點也不陷進去（實測浮 0.09 格，而不補的話陷 0.15~0.25 格）。 */
function sideLift(m) {
  const d = Math.min(0.5, Math.abs(m.roll - lieAng(m)));
  return 1 + ENG.BEAST_MID[m.kind] * 2 / (ENG.BEAST_SIDE[m.kind] || 0.01) * Math.tan(d);
}

/* 被吹飛／炸飛。回傳 true＝真的打到了。飛龍改成摔下來（牠本來就在天上）。
   帶火的那一下（爆炸都是 lit＝true）v1.154 起會點著牠：跟走地上的那幾隻同一條規則
   （牠們是 m.lit 記著、落地那一刻才燒），只是龍在天上，當場就開始拖火。
   點不著（已經在燒／剛被澆濕）就照舊只把牠打下來。 */
function tossBeast(m, vx, vy, vz, lit) {
  if (m.kind === 'dragon') return (lit && igniteBeast(m, 1)) || crashDragon(m);
  if (m.air) return false;                           // 已經在飛了，不用再掀一次
  const sp = Math.hypot(vx, vz);
  if (sp > B_TOSS_MAX) { const k = B_TOSS_MAX / sp; vx *= k; vz *= k; }
  /* roll 也歸零：那是躺平／打滾留下的角度，飛在半空沒有意義——不清的話
     側躺中被炸飛的牛會維持著 90° 側傾在天上翻（v1.154）。 */
  m.air = 1; m.fall = 0; m.lie = 0; m.burn = 0; m.brl = 0; m.pause = 0; m.gait = 0;
  m.roll = 0;
  m.vx = vx; m.vy = vy; m.vz = vz;
  m.tsp = rr(4, 9) * (Math.random() < 0.5 ? -1 : 1);   // 翻滾的角速度
  if (lit) m.lit = 1;
  reaim(m);
  return true;
}
/* 點著。roll=1 是摔在地上燒（就地打滾），roll=0 是站著被點著（抱頭跑圈圈）——同小人。
   飛龍自己一套（v1.154，見 burnDragon）：牠在天上，著火是「拖著火飛一段 → 墜地 →
   在地上燒完 → 拍翅起飛」。v1.153 以前牠是完全點不著的（回 false ＝ 改成打倒牠）。 */
function igniteBeast(m, roll) {
  if (m.burn > 0 || m.wet > 0) return false;
  if (m.kind === 'dragon') return burnDragon(m);
  m.burn = B_BURN; m.brl = roll ? 1 : 0; m.bem = Math.random(); m.fall = 0;
  m.gait = 0; m.pause = 0;
  if (roll) {                                        // 躺平角直接就位（本來就是摔著才點著的）
    m.rph = rr(0, Math.PI * 2);
    if (m.side) {                                    // 四條腿的：側躺著前後晃（v1.154）
      lieSide(m);
      m.spin = 0; m.roll = lieAng(m) + m.sdir * B_SIDE_ROCK * Math.sin(m.rph);
      m.lie = sideLift(m);
    } else {
      m.spin = Math.PI * 0.5;
      m.roll = B_ROLL_AMP * Math.sin(m.rph); m.lie = B_ROLL_LIFT;
    }
  } else {
    m.lie = 0; m.spin = 0; m.roll = 0;
  }
  m.bx = m.x; m.bz = m.z; m.br = rr(2.2, 3.6); m.ba = Math.random() * Math.PI * 2;
  reaim(m);
  return true;
}
/* 被震倒／被戳倒／被水柱打到。t 是躺幾秒。 */
function fellBeast(m, t) {
  if (m.kind === 'dragon') return crashDragon(m);
  if (m.air || m.burn > 0 || m.fall > 0) return false;
  m.fall = t; m.lie = 1; m.gait = 0; m.pause = 0;
  if (!m.side) m.roll = 0;                           // 側躺的那個角度就是 roll，別歸零
  lieSide(m);
  reaim(m);
  return true;
}
/* 淋濕：身上的火當場熄掉，再蹲一下才起來（同 wetWorker）。
   飛龍也澆得到了（v1.154，牠身上會有火了）：火滅掉、在天上燒的那一段直接回航線；
   已經摔在地上的就讓牠燒完那段結束、照原本的節奏爬起來飛走。 */
function wetBeast(m) {
  if (!m) return false;
  if (m.kind === 'dragon') {
    m.wet = WET_TIME;
    if (m.burn > 0) {
      m.burn = 0;
      if (m.st === 'ablaze') { m.st = m.was === 'out' ? 'out' : 'in'; m.spin = 0; }
    }
    return true;
  }
  m.wet = WET_TIME;
  if (m.burn > 0) {
    m.burn = 0; m.brl = 0; m.spin = 0; m.rph = 0; m.gait = 0;
    if (!m.side) m.roll = 0;             // 側躺的那個角度就是 roll，歸零的話牠會先站起來再倒下去
    m.fall = rr(0.5, 1.1); m.lie = 1;
  }
  return true;
}
/* 站定要動手那一刻被打斷的，爬起來要重新走過去瞄（不然牠一起身就當場放火）。 */
function reaim(m) {
  if (m.st === 'act') { m.st = 'near'; m.t = DOOM_AIM; m.arm = 0; }
}

/* 一幀的「被打到」處理。回傳 true＝這一幀牠動不了，正常那一套整段跳過（同 updWorker）。 */
function hurtBeast(m, dt) {
  if (m.wet > 0) m.wet = Math.max(0, m.wet - dt);
  if (m.air) { flyBeast(m, dt); return true; }
  if (m.burn > 0) { burnBeast(m, dt); return true; }
  if (m.fall > 0) {
    /* 躺平就是躺平：兩條腿的往後仰躺（負角）——同小人，往前趴的話臉那幾塊會插進草地裡；
       四條腿的往側邊倒（見 lieAng）。 */
    m.fall -= dt;
    if (m.side) m.roll += (lieAng(m) - m.roll) * Math.min(1, dt * 9);
    else m.spin += (lieAng(m) - m.spin) * Math.min(1, dt * 9);
    m.gait += (0 - m.gait) * Math.min(1, dt * 6);
    if (m.fall <= 0) { m.fall = 0; m.lie = 0; }
    return true;
  }
  // 爬起來，躺平角收回去（側躺的收 roll，仰躺的收 spin）
  if (m.spin) m.spin += (0 - m.spin) * Math.min(1, dt * 7);
  if (m.roll) m.roll += (0 - m.roll) * Math.min(1, dt * 7);
  return false;
}
/* 飛在半空：走彈道、一路翻滾，撞到草地邊緣就彈回來（同 flyWorker）。 */
function flyBeast(m, dt) {
  m.vy -= GRAV * dt;
  m.x += m.vx * dt; m.y += m.vy * dt; m.z += m.vz * dt;
  m.spin = (m.spin + m.tsp * dt) % (Math.PI * 2);
  m.a += m.tsp * 0.35 * dt;
  const lim = arenaR + 22;
  if (Math.abs(m.x) > lim) { m.x = clamp(m.x, -lim, lim); m.vx *= -0.4; }
  if (Math.abs(m.z) > lim) { m.z = clamp(m.z, -lim, lim); m.vz *= -0.4; }
  if (m.y > 0) return;
  m.y = 0; m.air = 0; m.vx = m.vy = m.vz = 0;
  pushOutHome(m);                                    // 剛好摔進人家屋子裡：推出來
  const lit = m.lit || nearFire(m);                  // 落地這一刻才判定燒不燒
  m.lit = 0;
  if (!lit || !igniteBeast(m, 1)) {
    m.spin = 0; m.fall = rr(B_FALL[0], B_FALL[1]); m.lie = 1;
    lieSide(m);
  }
  sndFall();
}
/* 身上著火的兩種演法（同 burnMove）：躺著沿身體長軸滾，或站著繞定點跑圈圈。 */
function burnBeast(m, dt) {
  m.burn -= dt;
  burnBeastFx(m, dt);
  if (m.burn <= 0) {                                 // 燒完拍拍灰站起來
    m.burn = 0; m.brl = 0; m.spin = 0; m.roll = 0; m.rph = 0; m.gait = 0; m.lie = 0;
    return;
  }
  const lim = arenaR + 22;
  if (m.brl) {
    m.rph += dt * B_ROLL_HZ * Math.PI * 2;
    const was = m.roll;
    if (m.side) {
      /* 四條腿的：側躺著前後晃（v1.154），幅度小、留在原地。 */
      m.spin += (0 - m.spin) * Math.min(1, dt * 12);
      m.roll = lieAng(m) + m.sdir * B_SIDE_ROCK * Math.sin(m.rph);
      m.lie = sideLift(m);
    } else {
      m.spin += (Math.PI * 0.5 - m.spin) * Math.min(1, dt * 12);
      m.roll = B_ROLL_AMP * Math.sin(m.rph);
      m.lie = B_ROLL_LIFT;
    }
    /* 沿長軸滾＝往身體的**側向**移動，位移跟著這一幀的轉角走，所以來回滾就留在原地翻。 */
    const v = (m.roll - was) * B_ROLL_R * (m.sc || 1);
    m.x = clamp(m.x - Math.cos(m.a) * v, -lim, lim);
    m.z = clamp(m.z + Math.sin(m.a) * v, -lim, lim);
    m.gait = 0;
  } else {
    m.ba += dt * B_PANIC;
    m.x = clamp(m.bx + Math.cos(m.ba) * m.br, -lim, lim);
    m.z = clamp(m.bz + Math.sin(m.ba) * m.br, -lim, lim);
    const cx0 = m.x, cz0 = m.z;
    pushOutHome(m);
    m.bx += m.x - cx0; m.bz += m.z - cz0;             // 圈圈整個跟著挪出房子外面
    m.a = Math.atan2(-Math.sin(m.ba), Math.cos(m.ba));
    m.ph += dt * 18;
    m.gait = 1; m.lie = 0;
    m.spin += (0 - m.spin) * Math.min(1, dt * 8);
  }
}
/* 身上的火苗。跟燒積木、燒小人共用同一個粒子池與同一份配額（burningW 也算牠們）。 */
function burnBeastFx(m, dt) {
  const sc = m.sc || 1, h = ENG.BEAST_MID[m.kind] * 2 * sc, r = 0.35 * sc;
  m.bem += dt * 26 / Math.sqrt(burningW || 1);
  while (m.bem >= 1) {
    m.bem--;
    if (hot.length > HOT_MAX - 40) break;
    hot.push({
      x: m.x + rr(-r, r), y: m.y + rr(0.1, h), z: m.z + rr(-r, r),
      vx: rr(-0.6, 0.6), vy: rr(2, 4), vz: rr(-0.6, 0.6),
      rx: Math.random() * 6, ry: Math.random() * 6,
      s: rr(0.26, 0.56) * sc, life: rr(0.3, 0.6), g: -2.6, grow: 1.06, cool: rr(0.25, 0.5),
      cr: 1, cg: rr(0.5, 0.82), cb: rr(0.06, 0.24), to: [0.6, 0.12, 0.02]
    });
  }
}

/* ── 飛龍：倒地起飛（v1.146）──────────────────────────────
   使用者：「飛龍會需要倒地起飛的動作」。牠在天上，所以「被打倒」對牠來說是三段：
     crash 被打下來，帶著翻滾走彈道摔到地上（翅膀還在無力地拍）
     down  趴在草皮上，翅膀攤平不動，喘幾秒
     rise  用力拍翅、鼻子抬起來、一路爬升回巡航高度，然後歸隊接回原本那一段
   歸隊接回 m.was（被打下來時在哪一段）：本來就要飛出場的別讓牠又繞一圈回來。
   繞了幾圈（m.turned）不歸零——那是「這一趟盤旋進度」，摔一跤不該重來。 */
const DRA_DOWN = [2.2, 3.6];         // 趴幾秒才起飛
const DRA_DOWN_PH = 0.23;            // 趴著時翅膀攤在哪個相位（翼面大致水平，見 wingAng）
const DRA_DOWN_PITCH = 0.10, DRA_DOWN_ROLL = 0.18;   // 趴著的俯仰與側傾（不是站得直挺挺的）
const DRA_RISE_PITCH = -0.30;        // 起飛時鼻子抬起來
const DRA_RISE_FLAP = 2.2;           // 起飛拍翅比巡航用力幾倍
const DRA_RISE_UP = 14;              // 爬升速度（格／秒）
/* 摔下去的初速。vy 是垂直那一下（挨打是往上彈一點點，失速就是 0）；
   水平保留一點前衝——原地直落看起來不像摔，像電梯。翻滾方向隨機。 */
function draDive(m, vy) {
  m.st = 'crash';
  m.vy = vy;
  m.vx = Math.sin(m.a) * DRA_SPD * 0.35;
  m.vz = Math.cos(m.a) * DRA_SPD * 0.35;
  m.tsp = rr(1.2, 2.6) * (Math.random() < 0.5 ? -1 : 1);
}
/* 把牠打下來。回傳 true＝真的打到了（已經在摔的不重複觸發）。 */
function crashDragon(m) {
  if (m.st === 'crash' || m.st === 'down' || m.st === 'rise') return false;
  m.was = m.st;
  draDive(m, rr(-2, 1.5));
  m.left = 0;                                        // 摔下去就不吐火球了
  sndRoar();
  toast('🐉 那條龍被打下來了', '牠在地上趴一下就會再飛起來');
  return true;
}
/* 趴在地上時原點要離地多高。BEAST_FLOOR 是照造型表算的「最低的那一塊剛好貼草皮」，
   但翅膀是每一幀照翼弧重擺的（wingArc），趴著那個相位會低於表上的位置——實測還會
   再陷進草皮 0.295（世界單位），換算回模型是 0.14，所以補 DRA_DOWN_PAD。 */
const DRA_DOWN_PAD = 0.15;
function draGround() { return (ENG.BEAST_FLOOR.dragon + DRA_DOWN_PAD) * DRA_SC; }
function fallenDragon(m, dt) {
  const gnd = draGround();
  if (m.burn > 0) draBurn(m, dt);                    // 著火摔下來的，火還在燒（v1.154）
  if (m.st === 'crash') {
    m.vy -= GRAV * dt;
    m.x += m.vx * dt; m.y += m.vy * dt; m.z += m.vz * dt;
    m.spin += m.tsp * dt;                            // 翻著摔下去
    m.roll += m.tsp * 0.6 * dt;
    m.ph += dt * DRA_FLAP * 0.4;                     // 翅膀還在無力地拍
    if (m.y > gnd) return false;
    m.y = gnd; m.vx = m.vy = m.vz = 0;
    m.spin = DRA_DOWN_PITCH; m.roll = DRA_DOWN_ROLL; m.ph = DRA_DOWN_PH;
    m.st = 'down'; m.t = rr(DRA_DOWN[0], DRA_DOWN[1]);
    spawnRing({ x: m.x, y: 0, z: m.z }, 6);          // 砸出一圈塵
    sndFall();
    return false;
  }
  if (m.st === 'down') {
    /* 趴著喘：翼面攤平不動，只有很小幅度的起伏（完全靜止看起來像壞掉的模型）。 */
    m.t -= dt;
    m.ph = DRA_DOWN_PH + 0.10 * Math.sin(m.t * 3.4);
    m.y += (gnd - m.y) * Math.min(1, dt * 8);
    /* 身上還在燒就先不起飛（v1.154）：趴在地上左右翻著把火壓掉，燒完才拍翅。
       翻的是側傾（roll），跟猴子在地上打滾同一個意思，只是牠這麼大隻不真的滾起來。 */
    if (m.burn > 0) {
      m.roll = DRA_DOWN_ROLL + DRA_BURN_ROLL * Math.sin(m.burn * DRA_BURN_HZ * Math.PI * 2);
      return false;
    }
    m.roll += (DRA_DOWN_ROLL - m.roll) * Math.min(1, dt * 6);
    if (m.t <= 0) { m.st = 'rise'; sndRoar(); }
    return false;
  }
  /* rise：拍翅起飛。鼻子抬起來、側傾收平，一路爬升到巡航高度才歸隊。 */
  const top = Math.max(DRA_MIN, (bp ? bp.height : 20) + DRA_UP);
  m.ph += dt * DRA_FLAP * DRA_RISE_FLAP;
  m.spin += (DRA_RISE_PITCH - m.spin) * Math.min(1, dt * 3);
  m.roll += (0 - m.roll) * Math.min(1, dt * 3);
  m.y += DRA_RISE_UP * dt;
  /* 爬升的同時把前進速度加回來：原地直上直下不像鳥，像電梯。 */
  const f = Math.min(1, Math.max(0, (m.y - gnd) / Math.max(1, top - gnd)));
  m.x += Math.sin(m.a) * DRA_SPD * f * dt;
  m.z += Math.cos(m.a) * DRA_SPD * f * dt;
  if (m.y < top) return false;
  m.y = top; m.spin = 0;
  m.st = m.was === 'out' ? 'out' : 'in';             // 歸隊，接回原本那一段
  return false;
}

/* ── 飛龍：著火（v1.154）─────────────────────────────────
   使用者：「飛龍也要做著火狀態反應」，形態選的是「空中拖火 → 墜地 → 燒完 → 起飛」。

   前兩段是新的（ablaze），後兩段就是 v1.146 那套倒地起飛（crash／down／rise），
   只是「趴著」那一段多了一條「還在燒就先不起飛」。所以牠著火的完整一趟是：
     ablaze 身上竄火，航向不修了、左右晃、一路掉高度（撐 DRA_ABLAZE 秒）
     crash  失速摔下去（跟被打下來同一段）
     down   趴在草皮上左右翻著壓火，燒完才進 rise
     rise   拍翅起飛，歸隊接回原本那一段
   火可以澆熄（wetBeast）：在天上就直接回航線，在地上就照原本的節奏爬起來。 */
const DRA_BURN = 7;                  // 身上的火燒幾秒（猴子 B_BURN 4.5、小人 W_BURN 3）
const DRA_ABLAZE = [1.6, 2.8];       // 拖著火還能飛幾秒
const DRA_ABL_SINK = 6.5;            // 這段每秒掉幾格（看得出牠在往下沉）
const DRA_ABL_YAW = 0.55, DRA_ABL_ROLL = 0.5;   // 失控的偏航與側傾擺幅
const DRA_ABL_PITCH = 0.18;          // 鼻子往下垂
const DRA_BURN_ROLL = 0.3, DRA_BURN_HZ = 0.55;  // 趴在地上壓火時左右翻的幅度與快慢
/* 點著牠。回傳 true＝真的點著了（呼叫端那條 `if (!lit || !igniteBeast(...))` 靠它分岔）。 */
function burnDragon(m) {
  m.burn = DRA_BURN;
  m.bem = Math.random();
  m.left = 0;                                    // 著火就不吐火球了（同被打下來）
  sndRoar();
  /* 摔下去／趴著的那兩段：就地燒，不必再摔一次。 */
  if (m.st === 'crash' || m.st === 'down') {
    toast('🐉 趴在地上那條龍被點著了', '牠會先把火壓掉才飛得起來');
    return true;
  }
  /* 才剛拍翅爬到一半又被點著：再摔一次（走同一段 crash）。 */
  if (m.st === 'rise') {
    draDive(m, 0);
    toast('🐉 那條龍剛飛起來又被點著了', '牠會再摔一次，在地上把火燒完');
    return true;
  }
  m.was = m.st === 'out' ? 'out' : 'in';         // 火滅了要接回原本那一段
  m.st = 'ablaze';
  m.t = rr(DRA_ABLAZE[0], DRA_ABLAZE[1]);
  toast('🐉 那條龍身上著火了', '牠撐不了多久，會摔下來在地上把火滅掉');
  return true;
}
/* 身上的火：倒數 ＋ 冒火苗（跟燒積木、燒小人、燒猴子共用同一個粒子池與配額）。 */
function draBurn(m, dt) {
  m.burn -= dt;
  burnBeastFx(m, dt);
  if (m.burn <= 0) m.burn = 0;
}
/* 拖著火在天上的那一段。回傳 true＝飛出場外了（跟 stepDragon 同一個約定）。 */
function ablazeDragon(m, dt) {
  draBurn(m, dt);
  m.t -= dt;
  m.ph += dt * DRA_FLAP * 1.35;                  // 翅膀拍得又快又亂
  /* 不修航向了：照當下的朝向往前飄，左右晃、鼻子往下垂、一路掉高度。 */
  m.a += Math.sin(m.t * 5.2) * DRA_ABL_YAW * dt;
  m.roll += (Math.sin(m.t * 3.7) * DRA_ABL_ROLL - m.roll) * Math.min(1, dt * 4);
  m.spin += (DRA_ABL_PITCH - m.spin) * Math.min(1, dt * 3);
  m.x += Math.sin(m.a) * DRA_SPD * 0.8 * dt;
  m.z += Math.cos(m.a) * DRA_SPD * 0.8 * dt;
  m.y = Math.max(draGround(), m.y - DRA_ABL_SINK * dt);
  /* 火被澆熄了（wetBeast 會把 st 推回航線），或撐到底了就摔下去。 */
  if (m.t > 0 && m.burn > 0) return false;
  draDive(m, 0);                                 // 不是被打的那一下，所以沒有往上彈
  return false;
}

/* 一發範圍傷害掃過場上那幾隻。cb 收到「這一隻」與「離爆心多遠」。
   一律算**三維**距離（v1.147，使用者：「炸彈炸在屋頂、槌子砸在高處，下面的人
   不被震倒」）。飛龍本來就是三維（牠在天上，不算高度的話地面上一顆小炸彈也能
   把牠打下來），現在走地上的那幾隻也一樣。這是比照積木那邊來的：
   `explode`、`smash` 掃積木一向都是三維，只有活的那幾個迴圈是水平的。
   `flat`：這一發本身就是一條從雲底到地面的線（雷），或者呼叫端已經自己
   把高度算進去了，才要水平。 */
function eachBeastNear(point, R, cb, flat) {
  if (!beasts) return;
  for (const m of beasts) {
    const d = flat
      ? Math.hypot(m.x - point.x, m.z - point.z)
      : Math.hypot(m.x - point.x, (m.y || 0) - (point.y || 0), m.z - point.z);
    if (d <= R) cb(m, d);
  }
}
/* 場上第幾隻（beastList 的索引，畫面點選用）。飛在半空的香蕉與火球排在生物後面，
   點到那兩種不算打到誰。 */
function beastAt(i) {
  return beasts && i >= 0 && i < beasts.length ? beasts[i] : null;
}

/* 兵器射中生物（v1.146）。做法跟 weaponVsWorker 一樣——沿這一幀走過的線段取三個點，
   高度落在牠的身高內、水平又夠近就算中。差別只有兩個：命中半徑照身形放大，
   飛龍是照身體中段上下各半個身高抓（牠不站在地上，不能用「腳底到頭頂」）。 */
function weaponVsBeast(w, px, py, pz) {
  if (!beasts) return null;
  const t = w.len * 0.5;
  const ax = px + w.dx * t, ay = py + w.dy * t, az = pz + w.dz * t;   // 上一幀的刃尖
  const bx = w.x + w.dx * t, by = w.y + w.dy * t, bz = w.z + w.dz * t;
  for (const m of beasts) {
    if (m.air || m.burn > 0 || m.fall > 0) continue;
    const sc = m.sc || 1, mid = ENG.BEAST_MID[m.kind] * sc;
    const lo = m.kind === 'dragon' ? (m.y || 0) - mid : 0;
    const hi = m.kind === 'dragon' ? (m.y || 0) + mid : mid * 2;
    const R = GATE_MAN_R + mid * 0.8;
    for (let k = 0; k <= 2; k++) {
      const u = k / 2;
      const y = ay + (by - ay) * u;
      if (y < lo || y > hi) continue;
      const dx = ax + (bx - ax) * u - m.x, dz = az + (bz - az) * u - m.z;
      if (dx * dx + dz * dz <= R * R) return m;
    }
  }
  return null;
}
/* 撞飛的力道跟打到小人同一條（方向沿飛行方向），力道打個折；兵器自己照樣掉在地上。
   火球與那一小片爆破也跟打到小人同一條（v1.148，使用者：「小人或吉祥物」）。 */
function beastWeapon(w, m) {
  const t = w.len * 0.5;
  const pt = { x: w.x + w.dx * t, y: Math.max(0.5, w.y + w.dy * t), z: w.z + w.dz * t };
  weaponSpark(pt, w);
  tossBeast(m, w.dx * 16 * B_BLOW + rr(-2, 2), rr(5, 8),
            w.dz * 16 * B_BLOW + rr(-2, 2), false);
  weaponBlast(pt, w);
  sndFall();
  fallWeapon(w);
}
