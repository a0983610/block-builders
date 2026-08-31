/* ============================================================
   遊戲層 · 樹、主迴圈、輸入、HUD、面板、匯入建築、啟動
   從 game.js 拆出來的一段（v1.120.1）。classic script、共用同一份全域 scope，
   跟原本寫在同一支檔裡完全等價；五支的分工與載入順序見 src/game.js 檔頭。
   ============================================================ */
'use strict';

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
  stepStorms(dt);
  stepGates(dt);
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
  stepDoom(dt);                                          // 天災（v1.138）
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
  ENG.putEmotes(workers);            // 頭上的表情圖示（v1.122：一片貼圖，不是小人身上的部位）
  ENG.putBeasts(beastList());        // 天災那幾隻 ＋ 飛在半空的香蕉（v1.138）

  ENG.putTrees(trees);
  ENG.putDust(dustList());
  ENG.putTrebs(trebs ? trebs.list : EMPTY);
  ENG.putRocks(trebs ? trebs.rocks : EMPTY);
  ENG.putBombs(bombs || EMPTY);
  /* 只把真的在天上飛的隕石丟過去（還在倒數的那幾顆連影子都不該有）。
     重用同一個陣列，不要每幀配置一個新的。 */
  metFly.length = 0;
  if (meteors) for (const m of meteors) if (m.lit) metFly.push(m);
  ENG.putMeteors(metFly);
  ENG.putBalls(balls || EMPTY);
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
  /* 王之財寶（v1.132）：門與兵器是兩份清單——門收掉之後兵器還在飛、還躺在地上慢慢淡，
     所以兩邊各自判斷有沒有東西要畫。 */
  ENG.putGates(gates ? gateList() : EMPTY);
  ENG.putWeapons(weapons || EMPTY);
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
      /* 選好就收起來，不要一直擋著畫面。兩個 class 都要動（v1.123，使用者：
         「選擇工具點擊後 就可以把工具清單收起來 目前要把滑鼠移開才會收」）：
         只拿掉 .open 的話 CSS 那條 `#toolbox:hover` 還按著它——指標就停在剛點的
         那顆按鈕上，選單原地不動，非得把滑鼠移開才收。.shut 就是「這次先別展開」，
         等指標離開小窗再撤掉（見下面的 pointerleave）。 */
      $('toolbox').classList.remove('open');
      $('toolbox').classList.add('shut');
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

/* 從剪貼簿倒進框裡（v1.140）。讀剪貼簿要瀏覽器同意，file:// 給不給
   要看政策（跟上面 copyText 同一個問題），不給就退回「自己按 Ctrl+V」。
   退路要先把游標放進框裡、整段選起來，Ctrl+V 才是「換掉舊那段」
   而不是插在游標處。 */
function pasteText(ta, btn, back) {
  const flash = t => { btn.textContent = t; setTimeout(() => { btn.textContent = back; }, 1600); };
  const manual = () => {
    ta.focus();
    ta.select();
    btn.textContent = '請按 Ctrl+V';
    setTimeout(() => { btn.textContent = back; }, 2200);
  };
  let p = null;
  try {
    if (navigator.clipboard && navigator.clipboard.readText) p = navigator.clipboard.readText();
  } catch (e) { p = null; }
  if (!p) { manual(); return; }
  /* 空的就別動框裡那段：剪貼簿是空的多半是「以為複製到了其實沒有」，
     這時把已經貼好的一段洗掉最惱人。 */
  p.then(t => { if (!t) { flash('剪貼簿是空的'); return; }
                ta.value = t; flash('已貼上 ✓'); }, manual);
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
  /* 選完之後掛上的 .shut（見 renderTools）要在「滑鼠再指回小窗」時撤掉，
     不然指回來也叫不出選單。聽 pointerover（會冒泡）而不是 pointerleave／pointerenter：
     選單是被 CSS 藏起來的，指標底下那顆按鈕當場消失，而 Chrome 這時只補一發
     「進到畫布」的 pointerover，**不補** #toolbox 的 pointerleave——實測整段
     只有 `pointerover target=canvas`，一個 leave 都沒有。少了那一發 leave，
     它就一直記著「指標還在 #toolbox 裡」，之後再指回來連 pointerenter 也不會響。
     pointerover 是每次越過元素邊界都補一發，所以指回小窗那一下一定收得到。 */
  $('toolbox').addEventListener('pointerover', () => $('toolbox').classList.remove('shut'));
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
  /* 貼上（v1.140）：只倒進框裡，不順手匯入——貼完先看一眼才按匯入是對的順序 */
  $('impPasteBtn').addEventListener('click',
    () => pasteText($('impPaste'), $('impPasteBtn'), '📋 貼上'));
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





