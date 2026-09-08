/* ============================================================
   積木小人 · 世界地標工地 — 端對端回歸測試
   跑法：node tools/e2e-3d.cjs
         node tools/e2e-3d.cjs --until 完工慶祝     ← 開發用：跑到那一段結束就收工
   需要 Playwright 與 chromium；找不到時會印出安裝指令。
   全部通過 exit 0，有失敗是 1，腳本自己壞掉是 2。

   --until：改一行就要等整輪（965 條）太慢，這個讓它跑到指定段落就停。
   只做「從頭跑到某一段」，不做「挑幾段跑」——**段落之間有狀態相依**，
   測試註解裡就有「上一段測試把人散到四十單位外去了」這種前提，跳過前面量到的會是別的東西。
   所以它只省後面那一段，前面照跑；驗收一律跑完整輪（部分執行時總結會標出來）。
   段名清單：grep "head('" tools/e2e-3d.cjs

   --seed：整輪的亂數種子。不給就每輪自己抽一個，印在最上面與總結裡；
   紅了照那個數字重跑（--seed 12345）就是同一副骰子——這套測試有三分之一的條目
   每輪數字都不一樣（實測 1013 條裡 336 條），沒有種子的話「紅了重跑」等於換一副骰子，
   分不出是程式壞了還是這條測試在賭。
   種子在**每一段開頭重新下**（種子 ^ 段名的雜湊），所以在某一段加測試不會位移別段的骰子。
   沒有這一層的話會這樣：three.js 的 generateUUID 每建一個物件抽四發 Math.random()，
   引擎多一顆網格就把整條序列往後推，幾百條之後某條不相干的測試就換了骰子（見 README）。
   --json <檔>：把每一條的結果寫成 JSON。給「跑十輪不同種子把偶發挖出來」用。
   --update-models：把現在的造型重新存成基準檔（tools/model-baseline.json）。
   故意改造型時才用，改完看 git diff 確認變的就是你要改的那幾塊。見〈造型基準〉那一段。

   為什麼一定要用真瀏覽器：這支程式的坑幾乎都在「真實環境與假物件的差異」——
   ES module 走 file:// 會被 CORS 擋、canvas 是 replaced element、
   WebGL 的 drawingBuffer 合成後就被清空。自己刻的假物件一定比真的寬鬆。

   headless chromium 用 SwiftShader 軟體算圖，所以 fps 沒有參考價值，
   這裡量的是 CPU 端成本（step/draw），那個跟顯示卡無關。
   ============================================================ */
'use strict';
const path = require('path');
const fs = require('fs');

/* ---------- 環境 ---------- */
function loadPlaywright() {
  const appdata = process.env.APPDATA || '';
  const tries = [
    'playwright',
    path.join(appdata, 'npm/node_modules/@playwright/mcp/node_modules/playwright'),
    path.join(appdata, 'npm/node_modules/@playwright/cli/node_modules/playwright'),
    path.join(appdata, 'npm/node_modules/playwright'),
  ];
  for (const t of tries) { try { return require(t); } catch (e) { /* 換下一個 */ } }
  console.error('找不到 playwright。任一方式即可：\n' +
    '  npm i -D playwright && npx playwright install chromium\n' +
    '  npm i -g @playwright/mcp（附帶的 chromium 也能用）');
  process.exit(2);
}
const { chromium } = loadPlaywright();

const ROOT = path.resolve(__dirname, '..');
const APP = 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/');
const OUT = path.join(__dirname, '.e2e-out');
const VIEW = { width: 1280, height: 800 };
const SHAPE_COUNT = 48;          // blueprints.js 內建的 SHAPES 數量
const WB_CLICK_MIN = 1500;       // 點一下倒 2300 格，滲掉一些之後至少該剩這麼多
const CUSTOM_COUNT = 28;         // blueprints/ 資料夾裡預設附的自訂藍圖
const CUSTOM_FILES = '範例-小教堂.js,八卦山大佛.js,大阪城天守閣.js,馬克杯.js,三色糰子與熱茶.js,五稜郭.js,孔廟建築群.js,日式醬油糰子.js,水榭戲亭.js,北海道舊本廳舍.js,吉薩大金字塔.js,松前城天守.js,林家花園觀稼樓.js,金閣寺.js,俄式白石大教堂.js,特製叉燒拉麵.js,清水寺本堂與舞台.js,章魚燒.js,焦糖布丁.js,舒芙蕾厚鬆餅.js,超商咖啡.js,新竹火車站.js,極地雪夜極光.js,聖三一修道院.js,彰化扇形車庫.js,銀閣寺.js,箱館奉行所.js,總統府.js';
const ALL_SHAPES = SHAPE_COUNT + CUSTOM_COUNT;

/* ---------- 只跑到某一段（--until，開發用，見檔頭） ---------- */
const UNTIL = (() => {
  const i = process.argv.indexOf('--until');
  return i >= 0 ? (process.argv[i + 1] || '') : '';
})();
let untilHit = false;                       // 指定的那一段跑到了
let BROWSER = null;                         // 收工時要關掉它（不關會留下 chrome-headless-shell）
/* 收工用的哨兵。不用 process.exit 直接跳車：那樣瀏覽器會被留在背景。
   丟出去讓最外層那個 catch 收（它認得 stopRun 這個記號），關瀏覽器、印總結、才離開。 */
const stopRun = () => Object.assign(new Error('--until 收工'), { stopRun: true });

/* ---------- 亂數種子（--seed，見檔頭） ---------- */
const argOf = f => { const i = process.argv.indexOf(f); return i >= 0 ? (process.argv[i + 1] || '') : ''; };
const SEED = (() => {
  const v = parseInt(argOf('--seed'), 10);
  return Number.isFinite(v) ? v >>> 0 : (Math.random() * 0xffffffff) >>> 0;
})();
const JSON_OUT = argOf('--json');
const UPDATE_MODELS = process.argv.indexOf('--update-models') >= 0;
/* mulberry32：32 位元狀態、週期 2^32，統計品質對這裡夠用，而且短到可以整支塞進 initScript。 */
const MULBERRY = 'function(a){return function(){a|=0;a=a+0x6D2B79F5|0;' +
  'var t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;' +
  'return((t^t>>>14)>>>0)/4294967296}}';
const mulberry32 = eval('(' + MULBERRY + ')');
/* 段名 → 一個穩定的數（FNV-1a）。段名沒改，那一段的骰子就沒變。 */
const hashStr = t => { let h = 2166136261 >>> 0; for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; };
const seedOf = t => (SEED ^ hashStr(t)) >>> 0;
/* 頁面端：addInitScript 每次載入都會跑，所以重新整理過的頁面也照樣是種子亂數。
   遊戲、three.js（generateUUID）與測試自己在 evaluate 裡抽的籤全部走這一支。 */
const INIT_SEED = 'window.__seed=function(n){Math.random=(' + MULBERRY + ')(n>>>0)};window.__seed(' + SEED + ');';
Math.random = mulberry32(SEED);            // Node 端（測試自己在 node 這一側抽的籤）
let PAGE = null;                           // 主頁面，head() 換段時要對它重下種子
/* 開頁面一律走這支：新的 page 各自是一個 context，addInitScript 不會自己跟過去。 */
const newPage = async o => { const p = await BROWSER.newPage(o); await p.addInitScript(INIT_SEED); return p; };

/* ---------- 記分板 ---------- */
const R = [];
let section = '';
const head = async t => {
  /* 指定的段落已經跑完，接著要開下一段了——收工。判斷用部分比對（含子字串就算），
     打 --until 慶祝 也對得到「完工慶祝」。 */
  if (UNTIL) {
    if (untilHit && t.indexOf(UNTIL) < 0) throw stopRun();
    if (t.indexOf(UNTIL) >= 0) untilHit = true;
  }
  section = t;
  /* 每一段重下種子：那一段抽到什麼只跟「種子 + 段名」有關，跟前面跑過幾條無關，
     所以在別段加測試不會位移這一段的骰子（generateUUID 抽掉的四發就是這樣推移整條序列的）。
     啟動那一段還沒 goto，頁面上還沒有 __seed，吞掉就好——它的骰子由 initScript 下的整輪種子決定。 */
  Math.random = mulberry32(seedOf(t));
  if (PAGE) await PAGE.evaluate(n => window.__seed(n), seedOf(t)).catch(() => {});
  console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 46 - t.length * 2)));
};
const ok = (name, pass, detail) => {
  R.push({ section, name, pass: !!pass, detail });
  console.log((pass ? '  \x1b[32mPASS\x1b[0m  ' : '  \x1b[31mFAIL\x1b[0m  ') +
              name + (detail ? '  → ' + detail : ''));
};

/* ---------- 小工具 ---------- */
/* 讀內部狀態。讀原始狀態比讀畫面嚴格；「畫面真的有畫出來」另外由像素那段驗。 */
const st = page => page.evaluate(() => ({
  phase, placed: placedCnt, total: bp ? bp.slots.length : 0,
  name: bp ? bp.name : '', height: bp ? bp.height : 0, radius: bp ? bp.radius : 0,
  pool: blocks.length, workers: workers.length, dust: dust.length, trees: trees.length,
  siteR, arenaR, target: targetCnt, scale: timeScale,
  free: blocks.filter(b => b.st === 0).length,
  carry: blocks.filter(b => b.st === 1).length,
  toss: blocks.filter(b => b.st === 2).length,
  set: blocks.filter(b => b.st === 3).length,
  fly: blocks.filter(b => b.st === 4).length,
  fallen: workers.filter(w => w.fall > 0).length
}));

/* 重設到可預期的起點。shape 指定藍圖名稱，不給就維持隨機。 */
async function reset(page, o = {}) {
  await installClean(page);          // 頁面重載過就沒了，每次重來都補一次
  await page.evaluate(o => {
    running = false; spinOn = false; muted = true;
    /* 變數與 checkbox 要一起改，否則後面用 page.check() 操作 UI 時，
       Playwright 會看到「已經勾了」而不觸發 change，測到的就不是真的 UI 行為 */
    document.getElementById('spin').checked = false;
    document.getElementById('mute').checked = true;
    /* 建材與人數直接改變數就好：面板現在是三檔按鈕，測試要的值多半不在那三檔裡
       （亮不亮是 syncHud 的事，startBuild 會叫到）。 */
    if (o.cnt != null) targetCnt = o.cnt;
    if (o.workers != null) setWorkerCount(o.workers);
    timeScale = o.scale != null ? o.scale : 1;
    shapePick = o.shape ? SHAPES.findIndex(s => s.n === o.shape) : (o.shapeIdx != null ? o.shapeIdx : -1);
    document.getElementById('shape').value = String(shapePick);
    cleanTools();                 // 見下面 installClean()：測試要的是乾淨的起點
    startBuild(true);
  }, o);
}

/* 把世界弄乾淨。v1.59 起換建築**不會**自動收掉正在作用的道具（畫面上所有東西
   同時消失就是「換場感」的來源），但每一條測試都需要一個乾淨的起點——上一條留在
   天上的核彈、還在滾的球會把這一條的建築拆掉，量到的就不是這一條在測的東西。
   裝成頁面上的一支函式，reset() 與那些直接呼叫 startBuild 的測試共用同一份。 */
const installClean = page => page.evaluate(() => {
  /* 閒晃事件（v1.97）預設關掉。慶祝散場後它有 40% 會自己發生，而發生了就會多出
     幾間房子與幾百塊「從地上挖出來」的積木——量積木池、draw call、閒晃範圍、
     畫面統計那些測試會被這些數字洗掉（實測「積木池沒有失控膨脹」就是這樣被撞到的）。
     要測這件事本身的那一段自己把 stepIdleEvent 裝回去（見「閒晃事件：小人的家」）。 */
  // 只抓第一次：installClean 每次 reset() 都會跑，第二次抓到的會是上一輪裝的空函式
  if (!window.evStep) window.evStep = stepIdleEvent;
  stepIdleEvent = () => {};
  /* 偷懶（v1.134）也預設關掉。每座開工會抽一成的人不上工（見 rollLazy），那幾個人不搬料、
     還會在旁邊蓋自己的家——量施工人數、完工時間、積木池、閒晃範圍的測試全都會被它洗掉。
     要測這件事本身的那一段自己把它裝回去（見「偷懶」）。 */
  if (!window.lazyRoll) window.lazyRoll = rollLazy;
  rollLazy = () => { for (const w of workers) w.lazy = 0; };
  /* 天災（v1.138）也預設關掉。地標蓋完之後 8~12 分鐘（v1.166 收短）會有猴子從場邊走進來放火／丟炸彈，
     量完工、閒晃、道具、效能那些「跑很久」的測試會被它整個洗掉。
     要測這件事本身的那一段自己把它裝回去（見「天災」）。 */
  if (!window.doomStep) window.doomStep = stepDoom;
  stepDoom = () => {};
  /* 吉祥物（v1.144）也預設關掉。三隻各自 3~6 分鐘就會來工地逛一圈，
     會走進閒晃範圍、吃掉 beastMesh 的名額，量閒晃分布與畫面統計的測試會被它洗掉；
     v1.166 起還有四分之一的機率是來砸村子那邊的（見「吉祥物」那一段的〈偶而動手〉）。
     要測這件事本身的那一段自己把它裝回去（見「吉祥物」）。 */
  if (!window.mascStep) window.mascStep = stepMascot;
  stepMascot = () => {};
  /* 閒逛的牛羊（v1.154）同理，而且更該關掉：牠們是**常駐**的（2~3 隻一直在場上），
     天災與吉祥物那兩整段都在數 beasts（「場上幾隻」「beasts[0] 是不是牠」），
     多兩隻牛在裡面全部會歪。要測這件事本身的那一段自己裝回去（見「閒逛的牛羊」）。 */
  if (!window.herdStep) window.herdStep = stepHerd;
  stepHerd = () => {};
  /* 已經蓋起來的房子也要清掉：它們是跨建築留著的（設計如此），對測試來說是殘留。
     清成一般碎料就好，下一次 startBuild 的 reconcilePool 會把多的收掉。 */
  window.clearHomes = () => {
    stopIdleEvent();
    for (const b of blocks) {
      if (b.hh < 0) continue;
      b.hh = -1; b.hk = -1; b.slot = -1; b.holder = -1;
      b.st = 0; b.rest = true; b.arc = null; b.snap = 0;
      b.vx = b.vy = b.vz = 0;
      if (!b.cell) gridAdd(b);
    }
    homes = null;
    for (const w of workers) { w.hm = -1; w.hst = ''; }
    /* 挖料的土痕也清掉（v1.100）：它跟隕石坑、焦黑共用同一份 marks，
       一個村落挖下來滴滴答答幾百塊，留著會被後面「隕石留下的是坑洞」那一段摸到。 */
    marks.length = 0;
  };
  /* 王之財寶從 v1.135 起是兩段點擊（第一下門陣、第二下目標），castGate 也跟著吃兩個點。
     多數測試只在意「朝這個目標開一發」，所以這支照 v1.135 之前的取景擺門陣：
     目標的另一側、鏡頭方向 GATE_BACK 遠——跟那時候 castGate 自己算出來的位置一模一樣，
     量到的落點、集中度、打擊數才跟舊的紀錄可比。 */
  window.gateAt = t => {
    const yaw = ENG.cam.yaw;
    castGate({ x: t.x - Math.cos(yaw) * GATE_BACK, z: t.z - Math.sin(yaw) * GATE_BACK }, t);
  };
  window.cleanTools = () => {
    clearHomes();
    swing = null; ENG.hideHammer();
    balls = null; ENG.putBalls([]); aim = null;
    twists = null; ENG.putTornados([]);
    trebs = null; ENG.putTrebs([]); ENG.putRocks([]);
    bombs = null; ENG.putBombs([]);
    meteors = null; ENG.putMeteors([]);
    nukes = null; ENG.putNukes([]);
    magics = null;
    /* 烏雲（v1.117）與閃電。電要連 arcSrcs 一起收：只清 bolts 的話，
       還在放電的那一處下一幀又補一批回來，等於沒清。 */
    storms = null; arcSrcs = null; bolts.length = 0;
    /* 王之財寶（v1.132）。門與兵器是兩份清單，兩份都要收；gateEnd() 是把
       castGate 借去的鏡頭高度還回去（不還的話下一條測試量到的視線高是被它抬過的）。 */
    gates = null; weapons = null; gateEnd();
    ENG.putGates([]); ENG.putWeapons([]);
    swords = null; ENG.putSwords([]);   // 大劍（v1.161）：一趟快兩秒，別跨到下一條
    /* 幽浮（v1.167）：一趟十六秒，而且它把積木收在地板底下、還借了鏡頭的高度。
       ufoClear() 是那兩件事的出口（同 gateEnd 的角色），不能只把 ufos 設成 null。 */
    ufoClear(); ENG.putUfos([]);
    /* 天災（v1.138）：場上那幾隻與飛在半空的香蕉。倒數也要歸零——
       不歸零的話下一條測試一進 done 就繼承上一條數到一半的秒數。 */
    beasts = null; nanas = null; fballs = null; doomT = -1;
    mascT.fill(-1);                   // 吉祥物那三個鐘（v1.144）也要歸零，同上
    ENG.putBeasts([]);
    trucks = null;
    water = null;
    fworks = null; fwSparks = null; fwWait = null;
    quake = null;
    marks.length = 0;                 // 地上的焦黑／坑洞：留著會多吃一個 draw call
    clearFires();
    // 弄乾：濕的積木點不著，留給下一條測試會讓它「放火放不起來」（踩過）
    for (const b of blocks) b.wet = 0;
    for (const w of workers) { w.wet = 0; w.wetK = 0; }
  };
  /* 建材鋪回「開場那樣」：從工地邊緣往外均勻鋪滿整片碎料場（跟 reconcilePool 同一份分布）。
     為什麼測試需要這個：startBuild(true) 會把上一輪的建築整棟解成碎料**原地**落下，
     那一刻它們還在半空，startBuild 裡的 kickOutSite() 抓不到，於是幾千塊料全躺在工地
     正中央（實測 3036 塊裡有 1971 塊落在半徑 10 以內）。真正的遊戲走的是整地那條路
     ——推土機把碎料推出工地——所以那個分布只有測試才會遇到。
     魔法師（v1.89）只搆得到腳邊一圈、又不進工地，料全在工地裡的話他會一直餓著
     （實測發料速率剩三分之一、舉杖幀數從 84% 掉到 21%），量到的就不是他的行為。 */
  window.scatterFree = () => {
    /* 先補到「剛好夠蓋完這一座」（v1.141）：料池從此是「小人挖多少就有多少」
       （reconcilePool 少了不補），而這一支是「開場那樣」的夾具——遊戲的開場是一座
       憑空建成的建築（completeNow），砸掉之後地上就有整整一座的料。不補的話
       用到這支的測試會落在「小人邊挖邊蓋」的中間狀態上，量到的不是它們要量的東西。 */
    let own = 0;
    for (const b of blocks) if (b.hh < 0) own++;
    const want = Math.min(ENG.MAXB - (blocks.length - own), bp.slots.length);
    for (let i = own; i < want; i++) blocks.push(newBlock());
    ENG.setBlockCount(blocks.length);
    const r0 = siteR + 2.5;
    for (const b of blocks) {
      if (b.st !== 0 && b.st !== 4) continue;      // 躺著的與還在飛的碎料都鋪回去
      if (b.cell) gridDel(b);
      const a = Math.random() * Math.PI * 2;
      const rad = Math.sqrt(r0 * r0 + Math.random() * (arenaR * arenaR - r0 * r0));
      b.x = Math.cos(a) * rad; b.z = Math.sin(a) * rad; b.y = HB;
      b.st = 0; b.vx = b.vy = b.vz = 0; b.rest = true; b.snap = 0; b.holder = -1;
      b.slot = -1; b.arc = null; b.scale = 1; b.al = 1;
      /* 淡出的倒數也要清。上一座完工時 clearSpare 把多餘的碎料標成「正在淡出」
         （`gone > 0`、`rest = false`），而這一行把 `rest` 打回 true：不清 `gone` 的話
         就造出一種現實不存在的料——**認得到，但死亡倒數還在跑**。實測這樣的
         有 232 塊；小人把它排進工作單第二筆、它在途中淡完被 `dropBlocks` 收掉，
         編號就變成 −1，`updWorker` 接下一塊那行會讀到 `blocks[-1]`（整輪測試
         五輪撞到一次，v1.146.1）。`al` 是淡出的結果、`gone` 是計時器，兩個要一起清。 */
      b.gone = 0;
      separate(b); gridAdd(b);
    }
  };
});

/* 直接推模擬，不等 rAF——測試才能決定性重現 */
const sim = (page, steps, dt = 0.05) =>
  page.evaluate(({ steps, dt }) => { for (let i = 0; i < steps; i++) step(dt); }, { steps, dt });

/* 把整座建築瞬間蓋好（測破壞時不想等小人搬十分鐘） */
const fillAll = page => page.evaluate(() => {
  /* 池子不夠就補到夠（v1.141）：料池從此是「小人挖多少就有多少」，開場是 0 塊。
     這一支是「瞬間蓋好」的夾具，跟遊戲裡的 completeNow 一樣得自己生得出積木。 */
  while (blocks.length < bp.slots.length && blocks.length < ENG.MAXB) blocks.push(newBlock());
  ENG.setBlockCount(blocks.length);
  for (let i = 0; i < bp.slots.length && i < blocks.length; i++) {
    const s = bp.slots[i], b = blocks[i];
    if (b.cell) gridDel(b);
    b.st = 3; b.slot = i; b.x = s.x; b.y = s.y + HB; b.z = s.z;
    b.rx = b.ry = b.rz = 0; b.scale = 1; b.al = 1; b.holder = -1;
    b.vx = b.vy = b.vz = b.ax = b.ay = b.az = 0;
    s.filled = true; s.claimed = -1;
  }
  /* 多出來的積木要壓成靜止的散料。放著不管的話它們還帶著上一輪的速度，
     之後量「碎塊平均飛行方向」時會把不相干的速度算進去。 */
  for (let i = bp.slots.length; i < blocks.length; i++) {
    const b = blocks[i];
    b.st = 0; b.slot = -1; b.holder = -1; b.snap = 0;
    b.vx = b.vy = b.vz = b.ax = b.ay = b.az = 0;
  }
  for (const w of workers) { w.load.length = 0; w.li = 0; w.carry = false; w.st = 'idle'; }
  placedCnt = bp.slots.length; phase = 'done';
});

/* 畫面統計。render 與 readPixels 必須在同一個 evaluate 裡：
   合成之後 drawingBuffer 就被清掉了（preserveDrawingBuffer 預設 false）。 */
const pix = page => page.evaluate(() => {
  /* 相機是每幀漸進靠近目標的，而測試多半把 rAF 迴圈停掉了。
     不先讓它收斂的話，量到的其實是「上一座建築的取景」，
     開場那座又是隨機的 → 同一個測試每次跑出來的數字都不一樣。 */
  for (let i = 0; i < 6; i++) ENG.updateCamera(1);
  draw(); ENG.render();
  const gl = ENG.three.renderer.getContext();
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const cols = new Set();
  let opaque = 0, dark = 0, n = 0;
  for (let i = 0; i < px.length; i += 4 * 31) {
    n++;
    if (px[i + 3] > 10) {
      opaque++;
      const lum = px[i] * 0.3 + px[i + 1] * 0.6 + px[i + 2] * 0.1;
      if (lum < 95) dark++;
      cols.add((px[i] >> 4) + ',' + (px[i + 1] >> 4) + ',' + (px[i + 2] >> 4));
    }
  }
  return { colors: cols.size, opaque: opaque / n, dark: dark / n, size: w + 'x' + h,
           calls: ENG.info().calls, tris: ENG.info().tris };
});

/* 把某個世界座標換算成畫面座標，才能真的用滑鼠點它 */
const placedCntTxt = (a, b) => a + ' → ' + b + ' 塊';

/* 常設哨兵：積木或小人跑到場外，代表某處的位移沒有上限。
   這是實際踩過的雷——落地分離的推擠量會累加，把積木彈到 4700 單位外，
   小人接著就一路走出地圖去撿它。 */
const probeWorkers = async (page, tag) => {
  const r = await page.evaluate(() => {
    let mw = 0, mb = 0, who = null;
    for (const w of workers) {
      const d = Math.hypot(w.x, w.z);
      if (d > mw) { mw = d; who = { d: +d.toFixed(0), tx: +w.tx.toFixed(0), tz: +w.tz.toFixed(0), st: w.st }; }
    }
    for (const b of blocks) mb = Math.max(mb, Math.hypot(b.x, b.z));
    return { mw, mb, who, arenaR };
  });
  const lim = r.arenaR + 30;
  ok('（' + tag + '）沒有東西跑出場外', r.mw < lim && r.mb < lim,
     '最遠小人 ' + r.mw.toFixed(0) + '、最遠積木 ' + r.mb.toFixed(0) +
     '，場地半徑 ' + r.arenaR.toFixed(0) + (r.mw >= lim ? '　' + JSON.stringify(r.who) : ''));
};

const toScreen = (page, sel) => page.evaluate(sel => {
  const t = eval(sel);
  if (!t) return null;
  const v = new THREE.Vector3(t.x, t.y, t.z).project(ENG.three.camera);
  return { x: (v.x + 1) / 2 * window.innerWidth, y: (1 - v.y) / 2 * window.innerHeight };
}, sel);

/* ============================================================ */
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = BROWSER = await chromium.launch();
  console.log('種子 --seed ' + SEED + '（紅了照這個數字重跑就是同一副骰子）');
  const page = PAGE = await newPage({ viewport: VIEW });

  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().split('\n')[0]); });

  /* ══════════ 啟動 ══════════ */
  await head('啟動');
  await page.goto(APP);
  await page.waitForTimeout(1200);
  await installClean(page);

  const boot = await page.evaluate(() => ({
    three: typeof THREE !== 'undefined' ? THREE.REVISION : null,
    inst: typeof THREE !== 'undefined' && !!THREE.InstancedMesh,
    shapes: typeof SHAPES !== 'undefined' ? SHAPES.length : -1,
    bp: typeof bp !== 'undefined' && bp ? bp.name : null,
    blocks: typeof blocks !== 'undefined' ? blocks.length : -1,
    workers: typeof workers !== 'undefined' ? workers.length : -1,
    phase: typeof phase !== 'undefined' ? phase : '',
    placed: typeof placedCnt !== 'undefined' ? placedCnt : -1,
    total: typeof bp !== 'undefined' && bp ? bp.slots.length : 0,
    cvW: document.getElementById('cv').width,
    cvH: document.getElementById('cv').height,
    cssW: document.getElementById('cv').style.width,
    dpr: window.devicePixelRatio
  }));
  ok('沒有 JS 例外或 console 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
  ok('three.js 有載入（classic script）', boot.three === '185', 'REVISION=' + boot.three);
  ok('InstancedMesh 可用', boot.inst);
  ok('藍圖數量 = 內建 ' + SHAPE_COUNT + ' + 自訂 ' + CUSTOM_COUNT,
     boot.shapes === ALL_SHAPES, '實際 ' + boot.shapes);
  ok('開場就選好一座建築', !!boot.bp, boot.bp || '');
  ok('開場就是一座蓋好的建築', boot.phase === 'done' && boot.placed === boot.total && boot.total > 100,
     boot.bp + ' ' + boot.placed + '/' + boot.total + '，phase=' + boot.phase);
  ok('積木池已建立', boot.blocks > 100, boot.blocks + ' 塊');
  ok('小人已就位', boot.workers > 0, boot.workers + ' 人');

  /* 面板的三檔按鈕：數字只寫在 CNT_OPTS／WK_OPTS／SPD_OPTS，按鈕照著生。
     這裡驗「畫面上長出來的就是那三個數字」，順便驗預設值那顆有亮起來。 */
  const seg = await page.evaluate(() => {
    const read = id => [...document.getElementById(id).children]
      .map(b => ({ v: b.dataset.v, txt: b.textContent, on: b.classList.contains('on') }));
    return {
      cnt: read('cnt'), wk: read('wk'), spd: read('spd'),
      opts: { cnt: CNT_OPTS, wk: WK_OPTS, spd: SPD_OPTS },
      target: targetCnt, workers: workerCnt, scale: timeScale,
      fresh: freshPref(), cntMax: CNT_MAX, maxb: ENG.MAXB
    };
  });
  const segVals = g => g.map(b => +b.v);
  const segOn = g => g.filter(b => b.on).map(b => +b.v);
  ok('三組設定都是三檔按鈕，數字跟程式裡的清單一致',
     String(segVals(seg.cnt)) === String(seg.opts.cnt) &&
     String(segVals(seg.wk)) === String(seg.opts.wk) &&
     String(segVals(seg.spd)) === String(seg.opts.spd) &&
     seg.spd.map(b => b.txt).join('/') === '0.5×/1×/4×',
     '建材 ' + segVals(seg.cnt) + '、小人 ' + segVals(seg.wk) +
     '、速度 ' + seg.spd.map(b => b.txt).join('／'));
  ok('每組只有一顆亮著，亮的就是目前的值',
     String(segOn(seg.cnt)) === String([seg.target]) &&
     String(segOn(seg.wk)) === String([seg.workers]) &&
     String(segOn(seg.spd)) === String([seg.scale]),
     '亮的是 建材 ' + segOn(seg.cnt) + '、小人 ' + segOn(seg.wk) + '、速度 ' + segOn(seg.spd));
  ok('預設是 3000 塊 / 20 人 / 1×',
     seg.target === 3000 && seg.fresh.cnt === 3000 &&
     seg.workers === 20 && seg.fresh.wk === 20 &&
     seg.scale === 1 && seg.fresh.spd === 1,
     'targetCnt=' + seg.target + '、freshPref=' + JSON.stringify(seg.fresh));
  /* 容差 10%：使用者定調「積木數量大約就好，容差 10% 也都還好」。
     開場那座是**隨機挑**的，而內建 48 座裡有三座固定停在 +5.9～6.1%（獅身人面像 3178、
     自由女神 3177、大阪城天守閣 3183，是尺度階距，見下面〈每座都貼近〉那條），
     所以 5% 的容差本來就會隨機紅——大約每 17 次一次。 */
  ok('開場那座就真的是 3000 塊上下（偏差 <10%）',
     Math.abs(boot.total - 3000) / 3000 < 0.1,
     boot.bp + ' ' + boot.total + ' 塊，偏差 ' +
     (Math.abs(boot.total - 3000) / 30).toFixed(1) + '%');
  /* 最大那一檔 9000（自訂藍圖要靠上萬塊才刻得出招牌、窗框那種細節）。
     積木池必須比它更高：fitScale 挑的是「最接近目標」的那一階，可能落在目標之上
     ——實測吉薩金字塔要 10000 時給出 10660（+7%）。池子不夠就會夾掉尾巴，那座永遠蓋不完。
     池子留到 11500 是照 10000 抓的：藍圖體檢仍然量到 10000，留著才不用跟著面板改來改去。 */
  ok('最大一檔 9000，積木池留了超額餘裕',
     seg.cntMax === 9000 && seg.maxb >= 11000,
     '最大 ' + seg.cntMax + '、積木池 ' + seg.maxb);
  const bigBuild = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = CNT_MAX; startBuild(true); completeNow();
    const r = { slots: bp.slots.length, pool: blocks.length, placed: placedCnt, phase };
    targetCnt = 3000; shapePick = -1; startBuild(true); completeNow();
    return r;
  });
  ok('最大那一檔蓋得完（積木池沒有夾掉尾巴）',
     bigBuild.pool === bigBuild.slots && bigBuild.placed === bigBuild.slots &&
     bigBuild.phase === 'done',
     '吉薩金字塔 ' + bigBuild.slots + ' 格 → 池子 ' + bigBuild.pool + '、擺上 ' +
     bigBuild.placed + '，phase=' + bigBuild.phase);
  ok('canvas 繪圖尺寸吃到 DPR',
     boot.cvW === Math.round(VIEW.width * Math.min(2, boot.dpr)), boot.cvW + '×' + boot.cvH);
  ok('canvas 有明確的 CSS 尺寸', boot.cssW === VIEW.width + 'px',
     'style.width=' + boot.cssW + '（canvas 是 replaced element，沒設就會用內建尺寸）');

  const ver = await page.evaluate(() => ({
    v: typeof VERSION !== 'undefined' ? VERSION : null,
    shown: document.getElementById('ver').textContent,
    vis: getComputedStyle(document.getElementById('ver')).display !== 'none'
  }));
  ok('有版本號而且格式正確', !!ver.v && /^\d+\.\d+\.\d+$/.test(ver.v), 'VERSION = ' + ver.v);
  ok('版本號有顯示在畫面上', ver.vis && ver.shown === 'v' + ver.v, ver.shown);
  /* README 也要跟著更新，不然文件跟程式會各說各話 */
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  ok('README 的版本號跟程式一致', readme.indexOf('v' + ver.v) >= 0, '找 v' + ver.v);

  /* ══════════ 打包出來的 three ══════════ */
  await head('three.js 打包');
  const libSrc = fs.readFileSync(path.join(ROOT, 'lib', 'three.min.js'), 'utf8');
  ok('lib/three.min.js 存在且夠大', libSrc.length > 300000, Math.round(libSrc.length / 1024) + ' KB');
  ok('沒有殘留 ES module 語法', !/(^|[;\n{}])\s*(import|export)\s*[{*]/.test(libSrc),
     'file:// 載入 ES module 會被 CORS 擋掉，整支程式會掛');
  ok('掛在 window.THREE 上', /window\.THREE\s*=/.test(libSrc));
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  ok('index.html 沒有用 type="module"', !/type\s*=\s*["']module["']/.test(html));
  /* 掃資料夾，不列檔名（v1.120.1 遊戲層拆成五支之後改的）：
     列檔名的話下次再拆一支就默默漏檢，而漏檢的測試看起來跟通過一模一樣。 */
  const srcFiles = fs.readdirSync(path.join(ROOT, 'src')).filter(f => f.endsWith('.js'));
  const srcAll = srcFiles.map(f => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8')).join('\n');
  ok('沒有寫入唯讀的 DOM 屬性', !/\.\s*client(Width|Height)\s*=/.test(srcAll),
     '掃了 src/ 底下 ' + srcFiles.length + ' 支：' + srcFiles.join('、'));
  /* 拆出來的每一支都要自己寫 'use strict'（v1.120.1）：strict 是**每支 classic script
     各自**的，漏寫的那支會回到非嚴格模式——打錯字的賦值不再報錯，會默默生出一個全域。 */
  /* bpdoc.js 不算：它是產出物（build-bpdoc.cjs 把〈藍圖製作說明.md〉包成一個字串），
     不是手寫的程式，也沒有賦值可以打錯。 */
  const handSrc = srcFiles.filter(f => f !== 'bpdoc.js');
  const noStrict = handSrc.filter(f => !/^\s*(\/\*[\s\S]*?\*\/\s*)*'use strict';/.test(
    fs.readFileSync(path.join(ROOT, 'src', f), 'utf8')));
  ok('src/ 底下每一支手寫的都有 use strict', noStrict.length === 0,
     noStrict.join('、') || handSrc.length + ' 支都有：' + handSrc.join('、'));

  /* ══════════ 渲染 ══════════ */
  await head('渲染');
  await reset(page, { shape: '吉薩金字塔', cnt: 800, workers: 8 });
  await fillAll(page);
  const p1 = await pix(page);
  ok('畫面真的有畫出東西', p1.opaque > 0.5, '不透明像素 ' + (p1.opaque * 100).toFixed(0) + '%');
  ok('顏色夠豐富（不是整片單色）', p1.colors > 25, p1.colors + ' 種');
  ok('有陰影／暗面', p1.dark > 0.005, (p1.dark * 100).toFixed(1) + '%');
  ok('draw call 維持在個位數', p1.calls > 0 && p1.calls <= 12,
     p1.calls + ' 個（幾百到幾千塊積木共用 1 個 InstancedMesh）');
  /* 積木的深色邊是在 Lambert 的 shader 上注入四刀做出來的（voxelMaterial），
     跟水面那六刀同一個風險：對 three 的 chunk 名字做字串取代，**取代不到不會報錯**，
     積木會默默變成扁平的色塊而測試全綠。所以一樣數刀數。 */
  const edgeCuts = await page.evaluate(() => ENG.three.blockMesh.material.userData.cuts);
  ok('積木深色邊的 shader 四個注入點都真的換到了', edgeCuts === 4, edgeCuts + ' / 4 刀');
  ok('三角形數與積木數相稱', p1.tris > 5000, p1.tris + ' 個');
  await page.screenshot({ path: path.join(OUT, '01-金字塔.png') });

  const oneCall = await page.evaluate(() => {
    const r = ENG.three.renderer;
    r.info.reset();
    r.render(ENG.three.scene, ENG.three.camera);
    // 關掉陰影再算一次，才知道主畫面本身用了幾個 call
    const withShadow = r.info.render.calls;
    r.shadowMap.enabled = false; r.info.reset();
    r.render(ENG.three.scene, ENG.three.camera);
    const noShadow = r.info.render.calls;
    r.shadowMap.enabled = true;
    return { withShadow, noShadow, blocks: blocks.length };
  });
  ok('積木沒有一塊一個 draw call', oneCall.noShadow < 10,
     oneCall.blocks + ' 塊積木，主畫面 ' + oneCall.noShadow + ' 個 call（含陰影 ' + oneCall.withShadow + '）');

  /* ══════════ 藍圖 ══════════ */
  /* ══════════ 造型基準 ══════════ */
  await head('造型基準');
  /* 使用者要的是「確認有沒有改壞就可以了……以後如果發現變了就要知道被改壞了」，
     所以這一段不訂任何美學門檻：把現在的造型整份存成基準，以後對不上就紅，
     再由人判斷「這是我故意改的」還是「改壞了」。
     故意改造型時重產基準：node tools/e2e-3d.cjs --update-models --until 造型基準
     然後看 git diff——變的應該剛好就是你要改的那幾塊，多出來的就是改壞的。

     為什麼要有這一段：飛龍從 v1.139 出場起就只有一片翅膀（bmir 鏡射時漏了 wg，
     左翼整片疊在右翼上），一路活到 v1.146.1 才被使用者用眼睛發現。那七版之間
     整輪測試每次都全綠——翅膀那兩條驗的是「有沒有在拍」「彎不彎」，兩片疊在一起
     照樣過。**行為對、外觀壞**，是這套測試原本完全沒有守的一塊。 */
  const modelNow = await page.evaluate(() => {
    const rnd = v => Math.round(v * 1e3) / 1e3;
    /* 一、造型表本身：每一塊的位移／尺寸／配色／旗標。 */
    const parts = {}, M = ENG.MODELS;
    for (const k in M) parts[k] = JSON.parse(JSON.stringify(M[k]));
    /* 二、真的畫出去的那一幀：把造型表換算成矩陣的那段數學（擺動、翼弧、鏡射）
       也一起守住。姿勢每一個欄位都釘死才可比；putBeasts 吃的是純物件，
       不必動到遊戲狀態，所以這一段完全不吃亂數。 */
    const pose = {}, mesh = ENG.three.beastMesh;
    const tmp = new THREE.Matrix4(), v = new THREE.Vector3();
    const q = new THREE.Quaternion(), sc = new THREE.Vector3();
    for (const kind in ENG.BEASTS) {
      ENG.putBeasts([{ kind, x: 0, y: 20, z: 0, a: 0, ph: 1.1, gait: 1, sc: 1,
                       arm: 0.5, spin: 0.3, roll: 0.2, lie: 0, air: 0, bomb: 1 }]);
      const rows = [];
      for (let i = 0; i < ENG.BEAST_PARTS; i++) {
        mesh.getMatrixAt(i, tmp); tmp.decompose(v, q, sc);
        rows.push([rnd(v.x), rnd(v.y), rnd(v.z), rnd(sc.x), rnd(sc.y), rnd(sc.z)]);
      }
      pose[kind] = rows;
    }
    ENG.putBeasts([]);      // 動過的狀態還回去（見 README〈測試動過的全域狀態要還回去〉）
    return { parts, pose };
  });
  const BASE = path.join(__dirname, 'model-baseline.json');
  /* 紅的時候要指得出「哪一個造型的哪一塊變了」，不能只說「對不上」。 */
  const clip = t => t.length > 100 ? t.slice(0, 100) + '…' : t;
  const oneDiff = (a, b) => {
    const na = Array.isArray(a) ? a.length : -1, nb = Array.isArray(b) ? b.length : -1;
    if (na !== nb) return '塊數 ' + na + ' → ' + nb;
    for (let i = 0; i < nb; i++)
      if (JSON.stringify(a[i]) !== JSON.stringify(b[i]))
        return '第 ' + i + ' 塊 ' + clip(JSON.stringify(a[i])) + ' → ' + clip(JSON.stringify(b[i]));
    return '內容有變';
  };
  const cmpSet = (base, now, what) => {
    const names = Array.from(new Set(Object.keys(base).concat(Object.keys(now))));
    const bad = names.filter(k => JSON.stringify(base[k]) !== JSON.stringify(now[k]));
    let n = 0;
    for (const k in now) n += Array.isArray(now[k]) ? now[k].length : 0;
    return { bad, msg: bad.length
      ? '變了：' + bad.map(k => k + '（' + oneDiff(base[k] || [], now[k] || []) + '）').join('；') +
        '　故意改的話跑 --update-models 重產基準'
      : names.length + ' 個造型、' + n + ' 塊' + what + '都對得上' };
  };
  if (UPDATE_MODELS) {
    fs.writeFileSync(BASE, JSON.stringify(modelNow, null, 1));
    ok('（--update-models）造型基準重新產好了', true,
       path.relative(ROOT, BASE) + '　→ 看 git diff 確認變的就是你要改的那幾塊');
  } else if (!fs.existsSync(BASE)) {
    ok('造型基準檔在', false, '找不到 ' + path.relative(ROOT, BASE) + '，用 --update-models 產一份');
  } else {
    const base = JSON.parse(fs.readFileSync(BASE, 'utf8'));
    const rp = cmpSet(base.parts, modelNow.parts, '');
    ok('每一個造型的部位表都跟基準一模一樣（位移、尺寸、配色、旗標）', rp.bad.length === 0, rp.msg);
    const rq = cmpSet(base.pose, modelNow.pose, '畫出來的位置');
    ok('固定姿勢畫出來的每一塊也都跟基準一模一樣（擺動、翼弧、左右鏡射的數學）',
       rq.bad.length === 0, rq.msg);
  }

  await head('藍圖');
  const bpAll = await page.evaluate(cnt => {
    const out = [];
    for (let i = 0; i < SHAPES.length; i++) {
      const b = makeBlueprint(i, cnt);
      let sorted = true, minY = Infinity, maxY = -Infinity, badPal = false;
      for (let k = 1; k < b.slots.length; k++) if (b.slots[k].y < b.slots[k - 1].y) { sorted = false; break; }
      for (const s of b.slots) {
        if (s.y < minY) minY = s.y;
        if (s.y > maxY) maxY = s.y;
        if (!(s.c >= 0 && s.c < 16)) badPal = true;
      }
      out.push({ n: b.name, cnt: b.slots.length, sorted, minY, maxY, h: b.height,
                 r: b.radius, pal: b.pal.length, badPal });
    }
    return out;
  }, 1000);
  ok('每一座都產得出來（含自訂的）', bpAll.length === ALL_SHAPES,
     bpAll.length + ' / ' + ALL_SHAPES);
  ok('每座都有名字與配色', bpAll.every(b => b.n && b.pal > 0 && !b.badPal));
  ok('施工順序由下往上', bpAll.every(b => b.sorted),
     bpAll.filter(b => !b.sorted).map(b => b.n).join(','));
  ok('最低一層貼在地面（y=0）', bpAll.every(b => b.minY === 0),
     bpAll.filter(b => b.minY !== 0).map(b => b.n + ':' + b.minY).join(','));
  ok('高度與 slots 對得起來', bpAll.every(b => b.h === b.maxY + 1));
  ok('都有實際占地半徑', bpAll.every(b => b.r > 1));

  const fitStat = await page.evaluate(() => {
    const res = [];
    for (const t of CNT_OPTS)                  // 玩家真的選得到的那三檔
      for (let i = 0; i < SHAPES.length; i++) {
        const c = makeBlueprint(i, t).slots.length;
        res.push({ n: SHAPES[i].n, t, c, err: Math.abs(c - t) / t });
      }
    res.sort((a, b) => b.err - a.err);
    const big = res.filter(r => r.t === 3000).sort((a, b) => b.err - a.err);
    return { worst: res[0], over50: res.filter(r => r.err > 0.5).length, total: res.length,
             bigOver: big.filter(r => r.err > 0.1).map(r => r.n + ' ' + r.c),
             bigWorst: big.slice(0, 3).map(r => r.n + ' ' + r.c) };
  });
  /* 有些造型（八節的 101、五座塔的吳哥）本身就有最少積木數，做不了太小的版本，
     所以驗兩件事：沒有任何一座離譜到 2 倍以上，而且超標的是少數。
     v1.66 起量的是 CNT_OPTS 那三檔（1800／3000／9000），不再量 400／1200：
     那兩個玩家選不到，而新換上來的那批藍圖細節多、最小就是一兩千塊，
     量它只是在量「藍圖的下限」，不是在量 makeBlueprint 找不找得到最接近的尺度。
     同一套量法對照換藍圖前後：>50% 的組數 10 → 11（多出來的是台北 101 在 1800 那檔
     ＋56%，那份藍圖最小 2811 塊），最差的一直是艾菲爾鐵塔在 9000 那檔 −66%。
     v1.114 換掉四座內建、自訂從 4 支變 28 支（52 → 76 座，156 → 228 組）：
     >50% 的組數 12 → 11，最差換成巨石陣在 9000 那檔 −63%
     （新鐵塔在 9000 是 −29%，不再是最差的那個）。 */
  ok('積木數能自動對應目標',
     fitStat.worst.err < 0.8 && fitStat.over50 <= 14,
     fitStat.total + ' 組裡有 ' + fitStat.over50 + ' 組偏差 >50%；最差 ' +
     fitStat.worst.n + ' 目標 ' + fitStat.worst.t + ' 得到 ' + fitStat.worst.c);
  /* 預設值那一檔要抓緊：人力費算的是工時，塊數少的那座就明顯便宜。
     以前這裡最差差到 40%（鐵塔頂到尺度上限只長 1806 塊）。
     v1.66 從 5% 放到 7%：換上來的藍圖有三座停在 +5.9～6.1%（獅身人面像 3178、
     自由女神 3177、大阪城天守閣 3183）。那是**尺度階距**造成的，不是下限撐著——
     實測把 dim 的下限縮到 ×0.6 一樣是 3178／3176，要更貼近得照說明文件的做法
     微調某一個維度的係數，讓它的跳點跟別的維度錯開。
     v1.77 放到 10%：使用者定調「積木數量大約就好，容差 10% 也都還好」。
     v1.114 之後 3000 那一檔最遠的是新的比薩斜塔 2733（−8.9%）、舒芙蕾厚鬆餅 2776（−7.5%）。 */
  ok('預設 3000 塊時每座都貼近（偏差都 <10%）',
     fitStat.bigOver.length === 0,
     '最遠的三座：' + fitStat.bigWorst.join('、') +
     (fitStat.bigOver.length ? '；超過 7% 的：' + fitStat.bigOver.join('、') : ''));

  /* 動物／交通工具／特殊這 12 座的設計前提是「整尊都站在地上」——
     不像風車扇葉、摩天輪車廂那樣有故意懸空的部件（那些靠 floats 機制管）。
     這裡守的是「座標算錯一格，整組就浮起來」這類錯：
     蒸汽火車第一版 3010 塊裡有 2976 塊連不到地面（只有排障器最底那排踩著地，
     底盤跟排障器中間差了三格 z）；木魚第一版魚身與坐墊之間空一格，951 塊整顆浮著。 */
  const grounded = await page.evaluate(() => {
    const NEW = ['大象', '暴龍', '長頸鹿', '貓咪', '蒸汽火車', '噴射客機', '大帆船', '雙層巴士',
                 '木魚', '大頭像', '聖誕樹', '巨型骰子'];
    const bad = [];
    let n = 0;
    for (const nm of NEW) {
      const i = SHAPES.findIndex(s => s.n === nm);
      if (i < 0) { bad.push(nm + ' 不存在'); continue; }
      n++;
      for (const t of [400, 3000]) {
        const b = makeBlueprint(i, t);
        const free = b.slots.filter(s => !s.anchor).length;
        if (free) bad.push(nm + '@' + t + ' 浮空 ' + free + '/' + b.slots.length);
      }
    }
    return { bad, n };
  });
  ok('新增的 12 座整尊都連得到地面', grounded.bad.length === 0 && grounded.n === 12,
     grounded.bad.join('、') || grounded.n + ' 座在 400 與 3000 塊都沒有一格浮空');

  /* ── 自訂藍圖（blueprints/ 資料夾） ──────────────────────
     機制是：list.js 列檔名 → index.html 逐一載入 → 檔案呼叫 customBlueprint()
     把自己接到 SHAPES 後面。之後就跟內建的走完全一樣的路。 */
  const custom = await page.evaluate(() => {
    const cs = SHAPES.filter(s => s.custom);
    const i = SHAPES.findIndex(s => s.custom);
    // 面板的三檔就是玩家真的會設的值，拿它們來驗縮放
    const sizes = [1800, 3000, 9000].map(t => makeBlueprint(i, t).slots.length);
    /* 參數化的重點：每個尺寸都重畫一次，所以小尺寸也該畫得出每一種部件
       （門、窗、十字架各自是不同的顏色索引，用到的顏色沒少就代表部件沒消失） */
    const colsAt = t => [...new Set(makeBlueprint(i, t).slots.map(s => s.c))].sort().join('');
    const parts = { min: colsAt(300), max: colsAt(3000) };
    const bpc = makeBlueprint(i, 1000);
    const optEls = [...document.querySelectorAll('#shape option')];
    const opts = optEls.map(o => o.textContent);
    const at = opts.indexOf(cs[0] ? cs[0].n : '@');
    return { n: cs.length, name: cs[0] ? cs[0].n : '', i, sizes, files: window.BP_FILES || [],
             parts, isGen: !cs[0].base,
             menuAt: at, menuVal: at >= 0 ? +optEls[at].value : -99, opts: opts.length,
             h: bpc.height, r: +bpc.radius.toFixed(1), pal: bpc.pal.length,
             ground: bpc.slots.filter(s => s.gy === 0).length,
             cols: [...new Set(bpc.slots.map(s => s.c))].sort() };
  });
  ok('blueprints/ 資料夾裡的自訂藍圖會被讀進來',
     custom.n === CUSTOM_COUNT && custom.i === SHAPE_COUNT && custom.files.length === CUSTOM_COUNT,
     'list.js 列了 ' + custom.files.join('、') + ' → 接在第 ' + custom.i + ' 個（內建 ' +
     SHAPE_COUNT + ' 座之後），名字「' + custom.name + '」');
  /* 選單第 0 項是「隨機」，自訂藍圖就緊接在後面（第 1 項）。
     同時守住那個關鍵不變量：排到前面只改顯示順序，option 的 value
     一定還是 SHAPES 的索引——不然選什麼都會蓋錯建築。 */
  ok('自訂藍圖排在下拉選單最前面，而且 value 還是 SHAPES 的索引',
     custom.menuAt === 1 && custom.menuVal === custom.i && custom.opts === ALL_SHAPES + 1,
     '「' + custom.name + '」在第 ' + custom.menuAt + ' 項（第 0 項是隨機）、value=' +
     custom.menuVal + '（SHAPES 第 ' + custom.i + ' 個），選單共 ' + custom.opts +
     ' 項（隨機 + ' + ALL_SHAPES + ' 座）');
  /* 面板三檔各要落在目標的 ±10% 內。這是「參數化寫法真的追得上目標塊數」的證據，
     光看「大的比小的多」是不夠的——係數沒對齊時塊數會一階跳掉一大截。 */
  ok('自訂藍圖會跟著建材數縮放，三檔都對得上',
     [1800, 3000, 9000].every((t, k) => Math.abs(custom.sizes[k] / t - 1) < 0.1),
     '目標 1800/3000/9000 得到 ' + custom.sizes.join(' / ') + '（偏差 ' +
     [1800, 3000, 9000].map((t, k) => Math.round((custom.sizes[k] / t - 1) * 100) + '%').join('／') + '）');
  /* 範例藍圖示範的是參數化寫法（gen(v, s) 按 s 重畫），不是固定解析度的字元圖——
     說明文件叫 AI 這樣寫，附的範例自己要先做到。 */
  ok('範例藍圖是參數化寫的，縮到最小也不會掉部件',
     custom.isGen && custom.parts.min === custom.parts.max && custom.parts.min.length === 6,
     (custom.isGen ? 'gen(v,s)' : '字元圖') + '：300 塊用到顏色 ' + custom.parts.min +
     '、3000 塊用到 ' + custom.parts.max);
  ok('自訂藍圖的顏色與貼地層都正常',
     custom.pal === 6 && custom.ground > 0 && custom.cols.every(c => c >= 0 && c < 6),
     '顏色 ' + custom.pal + ' 種（用到 ' + custom.cols.join(',') + '）、貼地 ' +
     custom.ground + ' 格、高 ' + custom.h + '、半徑 ' + custom.r);
  /* 格式錯的檔案不能把整個遊戲弄壞：跳過那一份、在 console 留警告就好。
     （console.warn 不是 error，不會被「沒有 console 錯誤」那條抓到） */
  const badBp = await page.evaluate(() => {
    const n0 = SHAPES.length;
    const r = [customBlueprint({}),                                   // 沒 name
              customBlueprint({ name: '空的', layers: [] }),           // 沒圖
              customBlueprint({ name: '全空', layers: [['...', '...']] }),
              customBlueprint({ name: '吉薩金字塔', layers: [['1']] })]; // 撞號
    return { r, added: SHAPES.length - n0 };
  });
  ok('格式錯的自訂藍圖會被擋掉，不會弄壞遊戲',
     badBp.r.every(v => v === -1) && badBp.added === 0,
     '四種壞檔全部回傳 -1，SHAPES 沒有多出 ' + badBp.added + ' 座');

  /* 字元圖（layers）是給草稿用的備案路徑。範例藍圖已經改成參數化，所以它的覆蓋要自己補。
     重點在縮小：取樣點取的是輸出格「中心」而不是左邊界——取左邊界的話最後一列永遠取不到，
     而那一列就是最外面那面牆（1 格厚，掉一列就整面消失，實測小木屋縮到 300 塊時掉了兩面）。 */
  const gridBp = await page.evaluate(() => {
    const ring = ['1'.repeat(13)];
    for (let i = 0; i < 11; i++) ring.push('1' + '.'.repeat(11) + '1');
    ring.push('1'.repeat(13));
    const layers = [];
    for (let i = 0; i < 7; i++) layers.push(ring);
    const i = customBlueprint({ name: '測試用字元圖', pal: ['#c8a06a'], layers });
    if (i < 0) return { i };
    const sh = SHAPES[i];
    /* 四面外牆各自「該有的格數」＝ 跨距 × 層數。整面在就接近 1，被抽掉的話
       最外圈會退到內部那一圈，一層只剩兩個角，比值直接掉到 0.2 以下。 */
    const at = t => {
      const cells = genCells(sh, fitScale(sh, t)).cells();
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y1 = 0;
      for (const c of cells) {
        if (c.x < x0) x0 = c.x; if (c.x > x1) x1 = c.x;
        if (c.z < z0) z0 = c.z; if (c.z > z1) z1 = c.z;
        if (c.y > y1) y1 = c.y;
      }
      const ny = y1 + 1, sx = x1 - x0 + 1, sz = z1 - z0 + 1;
      const cnt = f => cells.filter(f).length;
      return { n: cells.length, size: sx + '×' + ny + '×' + sz,
               walls: [cnt(c => c.x === x0) / (sz * ny), cnt(c => c.x === x1) / (sz * ny),
                       cnt(c => c.z === z0) / (sx * ny), cnt(c => c.z === z1) / (sx * ny)]
                        .map(v => +v.toFixed(2)) };
    };
    const r = { i, lo: +sh.lo.toFixed(2), min: at(200), mid: at(300), big: at(3000) };
    SHAPES.pop();                       // 測完收掉，別影響後面掃全部 SHAPES 的測試
    return r;
  });
  ok('字元圖藍圖也會跟著建材數縮放', gridBp.i >= 0 &&
     gridBp.min.n < gridBp.big.n / 4,
     '基準 336 格（13×7×13）→ ' + gridBp.min.n + ' / ' + gridBp.mid.n + ' / ' + gridBp.big.n +
     ' 格（尺度下限 ' + gridBp.lo + '）');
  ok('字元圖縮小時四面外牆都還在',
     [gridBp.min, gridBp.mid, gridBp.big].every(a => a.walls.every(v => v >= 0.8)),
     '縮到最小 ' + gridBp.min.size + ' 時四面牆完整度 ' + gridBp.min.walls.join('／'));

  /* ── 組合工具與藍圖體檢 ─────────────────────────────────
     這一組服務的是「AI 產藍圖」那條路：一般玩家手上只有網頁版 AI，
     所以（1）組合工具要能讓它少寫樣板、少犯下限與奇偶的錯，
     （2）checkBlueprint() 要吐出一段能整段複製、貼回去給 AI 的純文字報告。
     遊戲裡的按鈕與 tools/check-bp.cjs 共用同一支，最後一條測試守著這件事。 */
  await head('藍圖工具與體檢');
  const bpTool = await page.evaluate(() => {
    /* function 宣告會掛上 window，所以自訂藍圖檔（<script> 載進來的）叫得到 */
    const names = ['dim', 'ringOf', 'rowOf', 'mirrorX', 'mirrorZ', 'stampY', 'arch', 'archRow',
                   'stairs', 'hipRoof', 'boxTaper', 'windowGrid', 'lattice', 'corners4',
                   'tubeZ', 'wheelX', 'tint', 'paintFrom', 'blob', 'limb', 'checkBlueprint'];
    const missing = names.filter(n => typeof window[n] !== 'function');

    // dim：夾下限、取奇數
    const d = [dim(0.1, 1, 5), dim(10, 1, 2), dim(10, 1, 2, true), dim(4, 1, 1, true)];

    /* arch：在一片實心牆上挖拱。中線那一列要通到底，拱頂上面要還有牆，
       而且開口最寬處就是給的 w（拱心落在中線 = 寬度自動取奇數的意義）。 */
    const va = new VOX();
    va.box(0, 0, 0, 21, 20, 1, 0);
    arch(va, 0, 0, 0, 9, 6, 1);
    const openAt = y => { let n = 0; for (let x = -10; x <= 10; x++) if (!va.has(x, y, 0)) n++; return n; };
    const archR = { mid: openAt(3), top: openAt(9), above: va.has(0, 12, 0),
                    solidSide: va.has(-10, 3, 0) };

    // arch 的 c 給了要自己補一片牆
    const vb = new VOX();
    arch(vb, 0, 0, 0, 7, 5, 2, 1);
    const archMade = { n: vb.m.size, hole: !vb.has(0, 2, 0), wall: vb.has(4, 2, 0) };

    /* stairs：每一階都填實到底。只鋪踏面的話最底層只有 1 排，
       那些踏面會變成一組會掉下來的懸空部件。 */
    const vc = new VOX();
    stairs(vc, 0, 0, 0, 6, 3, 'x', 0);
    const st = { floor: vc.cells().filter(c => c.y === 0).length,
                 top: Math.max(...vc.cells().map(c => c.y)) + 1,
                 hollow: vc.cells().some(c => c.y > 0 && !vc.has(c.x, c.y - 1, c.z)) };

    /* windowGrid 走 tint：牆不在那裡就一格都不畫（回傳 0、總格數不變），
       牆在的話只換色、不會多出格子。 */
    const vd = new VOX();
    const air = windowGrid(vd, { x: 0, y: 2, z: 0, cols: 3, rows: 2, w: 1, h: 2, c: 1 });
    const airCells = vd.m.size;
    vd.box(0, 0, 0, 21, 12, 1, 0);
    const n0 = vd.m.size;
    const on = windowGrid(vd, { x: 0, y: 2, z: 0, cols: 3, rows: 2, stepX: 4, stepY: 4, w: 1, h: 2, c: 1 });
    const lit = vd.cells().filter(c => c.c === 1).length;
    const wg = { air, airCells, on, lit, grew: vd.m.size - n0 };

    // ringOf：n 個都在半徑 r 上
    const ring = [];
    /* 第一個參數餵真的 VOX（v1.56 起「忘了傳 v」會被擋下來）；這幾支只是把它轉交給
       callback，這裡的 callback 沒用到，但 API 的約定就是要傳 v。 */
    ringOf(new VOX(), 8, 10, (vv, x, z) => ring.push(+Math.hypot(x, z).toFixed(2)));
    const ringOk = ring.length === 8 && ring.every(v => Math.abs(v - 10) < 0.01);

    // hipRoof：每層寬與深一起縮 2（gable 只縮寬）
    const ve = new VOX();
    hipRoof(ve, 0, 0, 0, 9, 7, 0);
    const layer = y => {
      const c = ve.cells().filter(o => o.y === y);
      return c.length ? [Math.max(...c.map(o => o.x)) - Math.min(...c.map(o => o.x)) + 1,
                         Math.max(...c.map(o => o.z)) - Math.min(...c.map(o => o.z)) + 1] : null;
    };
    const hip = [layer(0), layer(1), layer(2)];

    // mirrorX / mirrorZ：兩份，位置相反
    const mx = []; mirrorX(new VOX(), 7, (vv, dx) => mx.push(dx));
    const mz = []; mirrorZ(new VOX(), 4, (vv, dz) => mz.push(dz));

    // lattice：兩根柱子之間拉出交叉，中間段一定有格子
    const vf = new VOX();
    lattice(vf, { x0: -8, z0: 0, x1: 8, z1: 0, y: 0, h: 20, n: 4, c: 0 });
    const lat = { n: vf.m.size, mid: vf.cells().some(c => Math.abs(c.x) <= 1 && c.y > 1 && c.y < 19) };

    /* limb（v1.157）：斜的四肢。三件事——整根接得起來、會收尖、細的也不會斷。
       連通性拿 26 鄰居數（跟遊戲的支撐判定同一套），斷掉的話畫出來就是一截一截的虛線。 */
    const oneGroup = vv => {
      const keys = new Set(vv.m.keys());
      const first = keys.values().next().value;
      if (!first) return false;
      const st = [first], seen = new Set(st);
      while (st.length) {
        const p = st.pop().split(':').map(Number);
        for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
          const q = (p[0] + i) + ':' + (p[1] + j) + ':' + (p[2] + k);
          if (keys.has(q) && !seen.has(q)) { seen.add(q); st.push(q); }
        }
      }
      return seen.size === keys.size;
    };
    const lay = (vv, y) => vv.cells().filter(c => c.y === y).length;
    const vg = new VOX();
    limb(vg, { x: 0, y: 0, z: 0, x1: 12, y1: 12, z1: 0, r: 2, c: 0 });   // 斜 45 度、等粗
    const cx = y => {
      const c = vg.cells().filter(o => o.y === y);
      return c.reduce((s, o) => s + o.x, 0) / c.length;
    };
    const vt = new VOX();
    limb(vt, { x: 0, y: 0, z: 0, x1: 0, y1: 16, z1: 8, r: 2.4, r1: 0.6, c: 0 });   // 收尖
    const vn = new VOX();
    limb(vn, { x: 0, y: 0, z: 0, x1: 9, y1: 14, z1: 5, r: 0.5, c: 0 });            // 細的
    const lb = { n: vg.m.size, one: oneGroup(vg), slope: +(cx(10) - cx(2)).toFixed(2),
                 tOne: oneGroup(vt), foot: lay(vt, 0), tip: lay(vt, 16),
                 thin: vn.m.size, thinOne: oneGroup(vn) };

    /* rowOf（v1.158）：沿一軸等距排 n 份，以中心攤開；套兩層就是方陣 */
    const vr = new VOX();
    const rowSpan = rowOf(vr, 5, 3, (vv, p) => vv.box(p, 0, 0, 1, 4, 1, 0));
    const vr2 = new VOX();
    rowOf(vr2, 3, 4, (vv, px) => rowOf(vv, 2, 5, (w, pz) => w.box(px, 0, pz, 1, 3, 1, 0)));
    const row = { xs: [...new Set(vr.cells().map(c => c.x))].sort((a, b) => a - b).join(','),
                  span: rowSpan, grid: vr2.cells().filter(c => c.y === 0).length };

    /* stampY（v1.158）：把一整組東西轉一個角度蓋上去。
       ① 實心量體轉完不能出現一格一格的縫（只做正向那一版會留 16 處）
       ② 轉的是整組東西的**朝向**，不是只把位置繞過去 */
    const gapsOf = vv => {
      const rows = {};
      for (const c of vv.cells()) (rows[c.z] = rows[c.z] || []).push(c.x);
      let n = 0;
      for (const z of Object.keys(rows)) {
        const a2 = rows[z].sort((p, q) => p - q);
        for (let i = 1; i < a2.length; i++) if (a2[i] - a2[i - 1] > 1) n++;
      }
      return n;
    };
    const vs = new VOX();
    stampY(vs, 30, w => w.box(0, 0, 0, 12, 1, 12, 0));
    const vw = new VOX();                                  // 一片長條，轉 90 度後長邊要換軸
    stampY(vw, 90, w => w.box(0, 0, 8, 3, 2, 9, 0));
    const bb = cs => ({ w: Math.max(...cs.map(c => c.x)) - Math.min(...cs.map(c => c.x)) + 1,
                        d: Math.max(...cs.map(c => c.z)) - Math.min(...cs.map(c => c.z)) + 1,
                        x: Math.round(cs.reduce((s, c) => s + c.x, 0) / cs.length),
                        z: Math.round(cs.reduce((s, c) => s + c.z, 0) / cs.length) });
    const vd45 = new VOX();
    stampY(vd45, 45, w => w.box(0, 0, 0, 21, 1, 1, 0));    // 1 格厚的斜牆
    const perRow = {};
    for (const c of vd45.cells()) perRow[c.z] = (perRow[c.z] || 0) + 1;
    const stamp = { n: vs.m.size, gaps: gapsOf(vs), wing: bb(vw.cells()),
                    diag: vd45.m.size, diagOne: oneGroup(vd45),
                    diagMax: Math.max(...Object.values(perRow)) };

    /* boxTaper（v1.158）：方形收分。taper 只收圓的、pyramid 只給等速階梯 */
    const vbt = new VOX();
    boxTaper(vbt, { x: 0, y: 0, z: 0, w: 21, d: 15, w1: 11, d1: 9, h: 6, c: 0 });
    const btLay = y => {
      const c = vbt.cells().filter(o => o.y === y);
      return (Math.max(...c.map(o => o.x)) - Math.min(...c.map(o => o.x)) + 1) + '×' +
             (Math.max(...c.map(o => o.z)) - Math.min(...c.map(o => o.z)) + 1);
    };
    const vbh = new VOX();
    boxTaper(vbh, { x: 0, y: 0, z: 0, w: 15, d: 15, w1: 7, d1: 7, h: 8, c: 0, t: 1 });
    const bt = { lay: [0, 1, 2, 3, 4, 5].map(btLay), hollowMid: !vbh.has(0, 4, 0),
                 hollowN: vbh.m.size };

    /* ringOf 的 span（v1.158）：給了就只排一段弧，頭尾落在端點；不給還是整圈 */
    const arcPts = [], fullPts = [];
    ringOf(new VOX(), 12, 10, (vv, x, z) => arcPts.push([+x.toFixed(2), +z.toFixed(2)]),
           0, 0, 0, Math.PI);
    ringOf(new VOX(), 4, 10, (vv, x, z) => fullPts.push(Math.round(x) + ',' + Math.round(z)));
    const arc = { first: arcPts[0].join(','), last: arcPts[11].join(','),
                  n: arcPts.length, full: fullPts.join(' ') };

    return { missing, d, archR, archMade, st, wg, ring, ringOk, hip, mx, mz, lat, lb,
             row, stamp, bt, arc };
  });
  ok('組合工具全都掛在全域，自訂藍圖叫得到', bpTool.missing.length === 0,
     bpTool.missing.length ? '沒有：' + bpTool.missing.join('、') : '21 支都在');
  ok('dim 會夾下限也會取奇數',
     bpTool.d[0] === 5 && bpTool.d[1] === 10 && bpTool.d[2] === 11 && bpTool.d[3] === 5,
     'dim(0.1,1,5)=' + bpTool.d[0] + '、dim(10,1,2)=' + bpTool.d[1] +
     '、加 odd → ' + bpTool.d[2] + '、dim(4,1,1,odd)=' + bpTool.d[3]);
  ok('arch 在牆上挖出正對中線的拱洞',
     bpTool.archR.mid === 9 && bpTool.archR.top < 9 && bpTool.archR.top > 0 &&
     bpTool.archR.above && bpTool.archR.solidSide,
     '柱身段開口 ' + bpTool.archR.mid + ' 格（給 9）、拱頂那層 ' + bpTool.archR.top +
     ' 格，拱頂上面還是實心 ' + bpTool.archR.above);
  ok('arch 給了顏色會自己補一片牆再挖',
     bpTool.archMade.n > 0 && bpTool.archMade.hole && bpTool.archMade.wall,
     bpTool.archMade.n + ' 格，中間是空的、旁邊是牆');
  ok('stairs 每一階都填到底，不會留懸空踏面',
     bpTool.st.floor === 18 && bpTool.st.top === 6 && !bpTool.st.hollow,
     '6 階 × 寬 3：最底層 ' + bpTool.st.floor + ' 格、最高 ' + bpTool.st.top +
     ' 層，懸空格 ' + (bpTool.st.hollow ? '有' : '沒有'));
  ok('windowGrid 只換已經有積木的格子',
     bpTool.wg.air === 0 && bpTool.wg.airCells === 0 &&
     bpTool.wg.on > 0 && bpTool.wg.grew === 0 && bpTool.wg.lit === bpTool.wg.on,
     '空氣中畫 ' + bpTool.wg.air + ' 格；牆上畫 ' + bpTool.wg.on +
     ' 格、總格數多了 ' + bpTool.wg.grew + ' 格（只換色）');
  ok('ringOf 把東西平均排在一個圓上', bpTool.ringOk,
     '8 個點離中心 ' + bpTool.ring[0] + '（給 10）');
  ok('hipRoof 寬深一起收（不是只收寬）',
     bpTool.hip[0][0] === 9 && bpTool.hip[0][1] === 7 &&
     bpTool.hip[1][0] === 7 && bpTool.hip[1][1] === 5 &&
     bpTool.hip[2][0] === 5 && bpTool.hip[2][1] === 3,
     bpTool.hip.map(a => a.join('×')).join(' → '));
  ok('mirrorX／mirrorZ 各放正負兩份',
     bpTool.mx.join(',') === '7,-7' && bpTool.mz.join(',') === '4,-4',
     'mirrorX → ' + bpTool.mx.join(',') + '、mirrorZ → ' + bpTool.mz.join(','));
  ok('lattice 在兩根柱子之間拉出交叉斜撐', bpTool.lat.n > 40 && bpTool.lat.mid,
     bpTool.lat.n + ' 格，跨距中段有料');
  /* limb（v1.157）：在此之前工具箱沒有「斜的量體」，人像的四肢只能拿 box 疊
     ——倉庫裡三尊人像（自由女神、獅身人面像、八卦山大佛）全是那樣畫的。 */
  ok('limb 在兩點之間拉出一根有粗細的東西，而且整根接得起來',
     bpTool.lb.one && bpTool.lb.n > 150 && Math.abs(bpTool.lb.slope - 8) < 0.6,
     '斜 45 度、r=2：' + bpTool.lb.n + ' 格連成一組；往上 8 層，橫向也移了 ' +
     bpTool.lb.slope + ' 格');
  ok('limb 從 r 收到 r1（一頭粗一頭細）',
     bpTool.lb.tOne && bpTool.lb.foot >= 15 && bpTool.lb.tip <= 3 &&
     bpTool.lb.foot > bpTool.lb.tip * 4,
     'r 2.4 → 0.6：底端那層 ' + bpTool.lb.foot + ' 格、頂端那層 ' + bpTool.lb.tip + ' 格');
  ok('細到 r=0.5 的 limb 不會斷成一截一截（骨幹那條 v.line 補的）',
     bpTool.lb.thinOne && bpTool.lb.thin >= 14,
     'r=0.5、跨 14 層：' + bpTool.lb.thin + ' 格連成一組');
  /* v1.158 的三支：全倉庫 20 處手刻「−總寬/2 + i × 間距」、13 處手刻方形收分，
     而斜著擺的一整組東西以前只能自己算三角函數（五稜郭的星形、扇形車庫的放射狀機庫）。 */
  ok('rowOf 沿一軸等距排開，以中心對稱，並回傳整排總長',
     bpTool.row.xs === '-6,-3,0,3,6' && bpTool.row.span === 12,
     '5 根、間距 3 → x=' + bpTool.row.xs + '，回傳 ' + bpTool.row.span);
  ok('rowOf 套兩層就是方陣', bpTool.row.grid === 6,
     '3 × 2 → ' + bpTool.row.grid + ' 根柱子');
  ok('stampY 轉完的實心量體不會出現一格一格的縫',
     bpTool.stamp.gaps === 0 && bpTool.stamp.n === 144,
     '12×12 轉 30 度：' + bpTool.stamp.n + ' 格（原本 144）、列內有縫的地方 ' +
     bpTool.stamp.gaps + ' 處');
  /* 朝向與位置都要跟著轉，而且方向要照文件寫的那個約定：正角度是 +x 轉向 +z，
     所以擺在 +z 的東西轉 90 度會跑到 −x（照抄文件的人得能預期它往哪邊去）。 */
  ok('stampY 轉的是整組東西的朝向，不是只把位置繞過去',
     bpTool.stamp.wing.w === 9 && bpTool.stamp.wing.d === 3 &&
     Math.abs(bpTool.stamp.wing.x + 8) <= 1 && Math.abs(bpTool.stamp.wing.z) <= 1,
     '3 寬 × 9 深、擺在 z=8 的一片，轉 90 度之後變成 ' + bpTool.stamp.wing.w + ' 寬 × ' +
     bpTool.stamp.wing.d + ' 深、中心在 (' + bpTool.stamp.wing.x + ', ' +
     bpTool.stamp.wing.z + ')');
  ok('1 格厚的牆轉 45 度還是一片連續的斜牆（每一列剛好一格）',
     bpTool.stamp.diagOne && bpTool.stamp.diagMax === 1 && bpTool.stamp.diag >= 14,
     '21 格的牆 → ' + bpTool.stamp.diag + ' 格（對角線一步跨 √2，本來就會變短）、連成一組');
  ok('boxTaper 一層一層從底面收到頂面（taper 只收圓的）',
     bpTool.bt.lay.join(' → ') === '21×15 → 19×14 → 17×13 → 15×11 → 13×10 → 11×9',
     bpTool.bt.lay.join(' → '));
  ok('boxTaper 給了 t 就只留四面牆', bpTool.bt.hollowMid && bpTool.bt.hollowN > 0,
     'w 15→7、高 8、t=1：' + bpTool.bt.hollowN + ' 格，中心那格是空的');
  ok('ringOf 給了 span 就排在一段弧上，頭尾落在端點；不給還是整圈',
     bpTool.arc.first === '10,0' && bpTool.arc.last === '-10,0' &&
     bpTool.arc.full === '10,0 0,10 -10,0 0,-10',
     '12 個排在 180 度弧上：' + bpTool.arc.first + ' → ' + bpTool.arc.last +
     '；不給 span 的四個點 ' + bpTool.arc.full);

  /* 體檢報告：對好的藍圖不該有必修，對壞的要指名問題並附修法。
     每一種壞法都真的做一份藍圖出來測——這幾種就是 AI 產藍圖最常見的死法。 */
  const diag = await page.evaluate(() => {
    const good = checkBlueprint('範例小教堂', { ver: VERSION });
    const n0 = SHAPES.length;
    const mk = (name, def) => { def.name = name; return customBlueprint(def); };
    // ① gen 直接丟例外
    mk('__壞 例外', { pal: ['#fff'], lo: 2, hi: 9, gen() { throw new Error('測試用的爆炸'); } });
    // ② pal 不夠：用到索引 3，只給 1 色
    mk('__壞 配色', { pal: ['#fff'], lo: 2, hi: 9,
      gen(v, s) { v.box(0, 0, 0, dim(s, 2, 5), dim(s, 2, 5), dim(s, 2, 5), 3); } });
    /* ③ 小尺寸時整組部件消失。真實案例是「尺寸沒給下限，算出 0 就什麼都沒畫」，
       這裡用一個門檻直接模擬那個結果（300 塊時 s≈3.5、3000 塊時 s≈7.2）。 */
    mk('__壞 消失', { pal: ['#fff', '#c00'], lo: 2, hi: 9, gen(v, s) {
      const w = dim(s, 2, 5), h = dim(s, 2, 5);
      v.box(0, 0, 0, w, h, w, 0);
      if (s > 5) v.box(0, h, 0, 3, 3, 3, 1);       // 頂上的小塔尖
    } });
    // ④ 整棟只靠一格站在地上
    mk('__壞 針尖', { pal: ['#fff'], lo: 2, hi: 9, gen(v, s) {
      v.set(0, 0, 0, 0);
      v.box(0, 1, 0, dim(s, 2, 5), dim(s, 2, 5), dim(s, 2, 5), 0);
    } });
    /* ⑤ 少給參數：v.box 忘了最後那個顏色。這是 AI 最常手滑的地方，
       而且以前是**靜默**的——格子的 c 是 undefined，畫出來是黑的、報告也算不出配色。 */
    mk('__壞 少參數', { pal: ['#fff'], lo: 2, hi: 9, gen(v, s) {
      const w = dim(s, 2, 5);
      v.box(0, 0, 0, w, w, w);
    } });
    /* ⑥ 參數算成 NaN：blob 少一個半徑。以前 Math.ceil(NaN) 讓迴圈一次都不跑，
       那顆球就這樣整組消失，報告只看得到「塊數少了一截」。 */
    mk('__壞 NaN', { pal: ['#fff'], lo: 2, hi: 9, gen(v, s) {
      blob(v, 0, 0, 0, dim(s, 1, 3), undefined, dim(s, 1, 3), 0);
    } });
    /* ⑦ 不是壞法，是輪廓圖要守的那件事：1 格粗的部件降採樣之後不能被抽掉
       （字元圖那條路的老毛病）。抽掉的話 AI 會以為自己畫的旗桿沒出現，去「修」沒壞的東西。 */
    mk('__測 薄片', { pal: ['#fff'], lo: 2, hi: 9, gen(v, s) {
      const w = dim(s, 2, 5);
      v.box(0, 0, 0, w, w, w, 0);                  // 主量體
      v.box(0, w, 0, 1, dim(s, 1, 3), 1, 0);       // 頂上 1 格粗的旗桿
    } });
    const r = {
      good: { fails: good.fails.length, warns: good.warns.length, text: good.text },
      thin: checkBlueprint('__測 薄片', { ver: VERSION }),
      pyr: checkBlueprint('吉薩金字塔', { ver: VERSION }),
      boom: checkBlueprint('__壞 例外', { ver: VERSION }),
      args: checkBlueprint('__壞 少參數', { ver: VERSION }),
      nan: checkBlueprint('__壞 NaN', { ver: VERSION }),
      pal: checkBlueprint('__壞 配色', { ver: VERSION }),
      gone: checkBlueprint('__壞 消失', { ver: VERSION }),
      pin: checkBlueprint('__壞 針尖', { ver: VERSION }),
      missing: checkBlueprint('根本沒有這座', { ver: VERSION })
    };
    for (const k of ['boom', 'args', 'nan', 'pal', 'gone', 'pin', 'missing', 'thin', 'pyr'])
      r[k] = { fails: r[k].fails, warns: r[k].warns, text: r[k].text };
    r.targets = BP_TARGETS.slice();
    SHAPES.length = n0;                 // 測完收掉，別影響後面掃全部 SHAPES 的測試
    return r;
  });
  ok('好的藍圖檢查起來沒有必修', diag.good.fails === 0,
     '範例小教堂：' + diag.good.fails + ' 個必修、' + diag.good.warns + ' 個提醒');
  ok('報告是純文字、開頭帶版本號',
     /^=== 積木小人 · 藍圖診斷 v\d+\.\d+\.\d+ ===\n藍圖：範例小教堂（自訂 · gen）/.test(diag.good.text) &&
     diag.good.text.indexOf('<') < 0,
     diag.good.text.split('\n')[0]);
  ok('報告會列出四個尺寸的實得塊數（含建材上限那一階）',
     diag.targets.length === 4 && diag.targets[diag.targets.length - 1] === 10000 &&
     diag.targets.every(t => new RegExp('\\n\\s+' + t + ' → ').test(diag.good.text)),
     '量了 ' + diag.targets.join('／') + ' 四個尺寸');
  ok('gen 丟例外會被抓到，錯誤訊息原封不動寫進報告',
     diag.boom.fails.length > 0 && diag.boom.text.indexOf('測試用的爆炸') > 0,
     diag.boom.fails.join('；'));
  /* v1.56：少給參數以前是靜默的（NaN 進迴圈整個部件不見、顏色沒給就畫成黑的），
     報告只看得到「塊數少了一截」。現在畫圖函式進來就擋，訊息要指名是哪一支的第幾個參數。 */
  ok('少給參數會被抓到，而且指名是哪一支函式的第幾個參數',
     diag.args.fails.length > 0 &&
     /參數錯誤：v\.box\(x0, y0, z0, w, h, d, c\) 的第 7 個參數 c 沒給/.test(diag.args.text),
     diag.args.text.split('\n').find(l => l.indexOf('參數錯誤') > 0) || '(報告裡沒有參數錯誤)');
  ok('參數算成 NaN／undefined 也擋得下來，不會整個部件靜靜消失',
     diag.nan.fails.length > 0 &&
     diag.nan.text.indexOf('blob(v, x0, y0, z0, rx, ry, rz, c, shell) 的第 6 個參數 ry 沒給') > 0,
     diag.nan.text.split('\n').find(l => l.indexOf('參數錯誤') > 0) || '(報告裡沒有參數錯誤)');
  ok('參數錯誤的修法直接指到說明文件的參數表',
     diag.args.text.indexOf('3.1／3.2 的參數表') > 0 &&
     diag.boom.text.indexOf('3.1／3.2 的參數表') < 0,
     '參數錯誤給參數表、其他例外仍給原本那句通用修法');
  ok('pal 不夠會被抓到', diag.pal.fails.some(f => f.indexOf('pal 不夠') === 0) &&
     diag.pal.text.indexOf('修法：pal 至少要 4 色') > 0,
     diag.pal.fails.join('；'));
  ok('部件在小尺寸整組消失會被抓到',
     diag.gone.fails.some(f => /整組消失/.test(f)) && diag.gone.text.indexOf('dim(s, 係數, 下限)') > 0,
     diag.gone.fails.join('；'));
  ok('整棟只靠一格站在地上會被提醒',
     diag.pin.warns.length + diag.pin.fails.length > 0 && diag.pin.text.indexOf('最底層 1 格⚠') > 0,
     diag.pin.text.split('\n').find(l => l.indexOf('最底層') > 0) || '(沒寫到最底層)');
  ok('名字打錯時報告會教怎麼修，而不是丟例外',
     diag.missing.fails.length === 1 && diag.missing.text.indexOf('list.js') > 0,
     diag.missing.text.split('\n')[1]);
  ok('每一份有問題的報告都寫得出修法',
     [diag.boom, diag.args, diag.nan, diag.pal, diag.gone, diag.pin, diag.missing]
       .every(r => /修法/.test(r.text)),
     '七種壞法（例外／少參數／NaN／配色／消失／針尖／找不到）都附了修法');

  /* 三視圖輪廓（v1.156）：報告量得出塊數、配色、連通性，就是量不出「像不像」，
     而產藍圖的 AI 看不到畫面。投影成字元圖是唯一能夾在純文字報告裡帶回去的形狀。
     驗三件事：三張圖都是等寬、可解析的字元圖；投影真的是那個形狀；
     以及 1 格粗的部件不會在降採樣時被抽掉。 */
  const artOf = (text, no) => {
    const ls = text.split('\n');
    const i = ls.findIndex(l => l.indexOf('  ' + no + ' ') === 0);
    const out = [];
    for (let k = i + 1; i >= 0 && k < ls.length && /^ {4}[#.]+$/.test(ls[k]); k++)
      out.push(ls[k].trim());
    return out;
  };
  const views = ['①', '②', '③'].map(no => artOf(diag.good.text, no));
  ok('報告附三視圖輪廓（正面／側面／俯視），三張都是等寬的字元圖',
     views.every(a => a.length >= 3 &&
                      a.every(r => r.length === a[0].length && r.length % 2 === 0)),
     views.map((a, i) => ['正面', '側面', '俯視'][i] + ' ' +
                         (a.length ? a[0].length / 2 : 0) + '×' + a.length + ' 格').join('、'));
  /* 畫最大那一階：一萬塊那一版才刻得出招牌與雕花，也就是「像不像」真正看得出來的那一檔。
     格數要跟上面那一行的實得對得上——對不上就是畫到別的尺寸去了。 */
  const artHead = /輪廓（(\d+) 塊那一階，(\d+) 格；一格字元 ＝ (\d+)×\3 格積木/.exec(diag.good.text);
  const big10k = /\n\s+10000 → \s*(\d+)/.exec(diag.good.text);
  ok('輪廓畫的是最大那一階，格數跟上面量到的實得一致',
     !!artHead && artHead[1] === '10000' && !!big10k && artHead[2] === big10k[1],
     artHead ? '輪廓 ' + artHead[1] + ' 塊那一階 ' + artHead[2] + ' 格、上面量到 ' +
               (big10k ? big10k[1] : '?') + ' 格，一格字元 ＝ ' + artHead[3] + ' 格見方'
             : '(報告裡沒有輪廓那一段)');
  /* 投影真的是那個形狀：金字塔的正面輪廓一定是由下往上一階一階變窄。
     這一條同時守住「橫軸縱軸沒接錯」——接錯的話俯視那張才是三角形。 */
  const pyrW = artOf(diag.pyr.text, '①').map(r => (r.match(/#/g) || []).length / 2);
  ok('投影真的是那個形狀：金字塔的正面輪廓由下往上一階一階變窄',
     pyrW.length >= 6 && pyrW.every((n, i) => i === 0 || n >= pyrW[i - 1]) &&
     pyrW[pyrW.length - 1] >= pyrW[0] * 3,
     '由上到下每一列 ' + pyrW.join('／') + ' 格');
  /* 降採樣取的是「這一格區塊有沒有積木」，不是取樣中心點那一格：
     1 格厚的牆、1 格寬的手臂在取樣式縮小裡會整片消失（附錄那條字元圖的老毛病）。 */
  const thinTop = artOf(diag.thin.text, '①')[0] || '';
  const thinStep = +((/一格字元 ＝ (\d+)×/.exec(diag.thin.text) || [0, 0])[1]);
  ok('1 格粗的部件不會被降採樣抽掉（旗桿還在，而且只佔一格）',
     thinStep >= 2 && thinTop.length >= 8 && /^\.*##\.*$/.test(thinTop),
     '一格字元 ＝ ' + thinStep + ' 格積木，最上面那一列是「' + thinTop + '」');

  /* 遊戲裡**不該**有檢查藍圖的入口：做藍圖是做藍圖、玩是玩。
     入口在 藍圖預覽.html（下一段測），設定面板不留這一格。 */
  const noDiagInGame = await page.evaluate(() => ({
    btn: !!document.getElementById('diagBtn'),
    box: !!document.getElementById('diagWrap'),
    panelBtns: [...document.querySelectorAll('#panel button')].map(b => b.id).join(',')
  }));
  ok('遊戲的設定面板沒有檢查藍圖那一格',
     !noDiagInGame.btn && !noDiagInGame.box,
     '面板上的按鈕只有 ' + noDiagInGame.panelBtns);

  /* 命令列版與預覽頁的報告必須是同一份輸出，不然兩邊會給出不同建議。
     這裡直接在測試行程 require 那支檔，跟瀏覽器裡的結果逐字比對。 */
  const cliSame = await (async () => {
    const nodeBP = require(path.join(ROOT, 'src/blueprints.js'));
    const ver = await page.evaluate(() => VERSION);
    const web = await page.evaluate(() => checkBlueprint(0, { ver: VERSION }).text);
    const cli = nodeBP.checkBlueprint(0, { ver }).text;
    /* 「產生時間」那兩行是當下量到的耗時，本來就會因為機器與引擎不同而有無
       （node 跟 headless chromium 的速度不一樣，同一台機器上跑兩次也可能跨過門檻），
       而它會不會出現又會改到「結論」那行的提醒數。要比的是報告內容，
       不是這一次量到多快，所以這三行先挑掉。 */
    const strip = t => t.split('\n')
      .filter((l, i, a) => l.indexOf('產生時間') < 0 && l.indexOf('結論：') < 0 &&
                           !(i > 0 && a[i - 1].indexOf('產生時間') >= 0))
      .join('\n');
    const a = strip(cli), b = strip(web);
    let first = '';
    if (a !== b) {
      const la = a.split('\n'), lb = b.split('\n');
      for (let i = 0; i < Math.max(la.length, lb.length); i++)
        if (la[i] !== lb[i]) { first = '第 ' + i + ' 行：cli「' + la[i] + '」／頁面「' + lb[i] + '」'; break; }
    }
    return { same: a === b, cliHead: cli.split('\n')[1], n: a.length, first };
  })();
  ok('命令列版（tools/check-bp.cjs）與預覽頁的報告逐字相同', cliSame.same,
     cliSame.first || (cliSame.cliHead + '，' + cliSame.n + ' 字元'));

  /* ── 藍圖預覽頁（藍圖預覽.html）───────────────────────────
     做藍圖用的獨立進入點：看得到蓋起來的樣子、按一下產出可貼回給 AI 的報告。
     它不載遊戲層那五支（那會把整個遊戲跑起來），所以引擎那些「還沒餵資料」的網格
     要自己清乾淨——不清的話原點會冒出 80 個小人。 */
  await head('藍圖預覽頁');
  const vpErr = [];
  // acceptDownloads：那一頁的「下載畫面」要真的存得出檔案才驗得到
  // clipboard：v1.63 起這一頁也有「取得 prompt」，要能讀回剪貼簿才驗得到內容
  const vp = await newPage({ viewport: VIEW, acceptDownloads: true,
                                     permissions: ['clipboard-read', 'clipboard-write'] });
  vp.on('pageerror', e => vpErr.push('pageerror: ' + e.message));
  vp.on('console', m => { if (m.type() === 'error') vpErr.push('console: ' + m.text()); });
  await vp.goto('file:///' + path.join(ROOT, '藍圖預覽.html').replace(/\\/g, '/'));
  // bp 是 let 宣告的，在全域詞法環境裡而不是 window 上，所以要用 typeof 問
  await vp.waitForFunction(() => typeof ENG !== 'undefined' && typeof bp !== 'undefined' && bp);
  const vpBoot = await vp.evaluate(() => ({
    opts: document.getElementById('shape').options.length,
    first: document.getElementById('shape').options[0].textContent,
    blocks: bp.slots.length,
    drawn: ENG.three.blockMesh.count,
    workers: ENG.three.workerMesh.count,
    calls: ENG.info().calls,
    ver: VIEWER_VER,
    spin: document.getElementById('spin').checked,
    stat: document.getElementById('stat').textContent,
    /* 引擎每個 InstancedMesh 的預設 count 就是它的上限。這一頁沒餵資料的那些
       必須是 0，不然原點會冒出 80 個小人、一堆石頭與樹（visible 仍是 true
       但 count=0 就不畫，所以要看 count 而不是看 visible）。 */
    ghosts: ENG.three.scene.children
      .filter(o => o.isInstancedMesh && o !== ENG.three.blockMesh && o.visible && o.count > 0)
      .length
  }));
  ok('預覽頁載得起來，48 座 + 自訂都在選單裡，自訂排最前面',
     vpBoot.opts === ALL_SHAPES && vpBoot.first.indexOf('★') === 0,
     vpBoot.opts + ' 個選項，第一個是「' + vpBoot.first + '」');
  ok('預覽頁真的把藍圖畫出來了',
     vpBoot.drawn === vpBoot.blocks && vpBoot.blocks > 100 && vpBoot.calls <= 8,
     vpBoot.blocks + ' 塊全部進了 InstancedMesh，' + vpBoot.calls + ' 個 draw call');
  ok('預覽頁沒有小人，也沒有任何沒餵資料就冒出來的網格',
     vpBoot.workers === 0 && vpBoot.ghosts === 0,
     '小人 ' + vpBoot.workers + ' 個、還有 ' + vpBoot.ghosts +
     ' 顆 InstancedMesh 沒清乾淨（積木那顆不算）');
  ok('預覽頁的統計行寫出塊數與尺寸',
     /\d+ 塊/.test(vpBoot.stat) && /尺寸 \d+×\d+×\d+/.test(vpBoot.stat), vpBoot.stat);
  // 自轉預設關：對照參考圖時畫面一直轉反而不好比
  ok('預覽頁的自轉預設是關著的', vpBoot.spin === false,
     '開場 spin=' + vpBoot.spin);

  /* list.js 產生器（v1.56）：.js 存進 blueprints/ 之後還得自己把檔名加進 list.js，
     忘了加就等於沒放——檔案在那裡、遊戲卻看不到，而且不會有任何錯誤訊息。
     這幾條驗開場的預設狀態，以及「產出來的檔案能不能直接覆蓋回去」。 */
  const vpList0 = await vp.evaluate(() => {
    const box = [...document.querySelectorAll('#files input')];
    return { files: box.map(i => i.dataset.f), on: box.filter(i => i.checked).length,
             open: document.getElementById('listBox').open,
             toggle: document.getElementById('allOn').textContent,
             msg: document.getElementById('listMsg').textContent };
  });
  ok('list.js 產生器列出 blueprints/ 現在有的藍圖，預設全勾',
     vpList0.files.join(',') === CUSTOM_FILES && vpList0.on === vpList0.files.length &&
     vpList0.toggle === '全不選' && vpList0.open === false,
     vpList0.on + '／' + vpList0.files.length + ' 勾起來（' + vpList0.files.join('、') +
     '），預設收合，' + vpList0.msg);
  await vp.evaluate(() => { document.getElementById('listBox').open = true; });
  const [listDl] = await Promise.all([vp.waitForEvent('download'), vp.click('#dlList')]);
  const listPath = path.join(OUT, 'viewer-list.js');
  await listDl.saveAs(listPath);
  /* 產出來的要能直接覆蓋回 blueprints/list.js，所以連抬頭那段註解都要一樣——
     不然每產一次就把「為什麼要這份清單」那段說明洗掉一次。
     （工作區的換行是 CRLF、產出來的是 LF，比的是內容不是換行。） */
  const nl = t => t.replace(/\r\n/g, '\n');
  const listMade = nl(fs.readFileSync(listPath, 'utf8'));
  const listReal = nl(fs.readFileSync(path.join(ROOT, 'blueprints/list.js'), 'utf8'));
  ok('產出來的 list.js 跟現在那份逐字相同（可以直接覆蓋回去）',
     listDl.suggestedFilename() === 'list.js' && listMade === listReal,
     '檔名「' + listDl.suggestedFilename() + '」，' + listMade.split('\n').length + ' 行' +
     (listMade === listReal ? '' : '（跟 blueprints/list.js 不一樣）'));
  ok('產出來的 list.js 是合法的 JS，載進去拿得到 BP_FILES',
     (() => {
       try {
         const got = new Function(listMade + ';return typeof BP_FILES !== "undefined" ? BP_FILES : null;')();
         return Array.isArray(got) && got.join(',') === CUSTOM_FILES;
       } catch (e) { return false; }
     })(),
     'BP_FILES 解析得出來');
  // 收回預設狀態：它預設是收合的，下面量版面那條要在預設狀態下量
  await vp.evaluate(() => { document.getElementById('listBox').open = false; });

  const vpBig = await vp.evaluate(() => {
    const sel = document.getElementById('shape');
    sel.value = String(SHAPES.findIndex(s => s.n === '吉薩金字塔'));
    sel.dispatchEvent(new Event('change'));
    const btns = [...document.getElementById('cnt').children];
    const t0 = performance.now();
    btns[btns.length - 1].click();                   // 最大那一檔
    return { ms: Math.round(performance.now() - t0), want: wantCnt, blocks: bp.slots.length,
             drawn: ENG.three.blockMesh.count, maxb: ENG.MAXB,
             opts: btns.map(b => +b.dataset.v), on: btns.filter(b => b.classList.contains('on')).length };
  });
  ok('預覽頁最大那一檔也畫得完（沒有被積木池夾掉）',
     vpBig.want === 9000 && vpBig.blocks > 8500 && vpBig.drawn === vpBig.blocks &&
     vpBig.blocks <= vpBig.maxb && vpBig.on === 1,
     '吉薩金字塔要 ' + vpBig.want + ' → ' + vpBig.blocks + ' 塊全上場（池子 ' + vpBig.maxb +
     '），產生 ' + vpBig.ms + 'ms');
  // 兩頁的建材檔位要一樣：預覽頁不載遊戲層，所以那三個數字是各留一份的
  const vpOpts = await vp.evaluate(() => CNT_OPTS);
  const gameOpts = await page.evaluate(() => CNT_OPTS);
  ok('預覽頁的建材三檔跟遊戲一致', String(vpOpts) === String(gameOpts),
     '預覽頁 ' + vpOpts + '、遊戲 ' + gameOpts);

  await vp.click('#chk');
  await vp.waitForTimeout(200);
  const vpRep = await vp.evaluate(() => {
    const t = document.getElementById('rep').value;
    return { head: t.split('\n')[0], lines: t.split('\n').length, ver: VIEWER_VER };
  });
  ok('預覽頁按「檢查藍圖」產出帶版本號的報告',
     vpRep.head === '=== 積木小人 · 藍圖診斷 v' + vpRep.ver + ' ===' && vpRep.lines > 10,
     vpRep.head + '，' + vpRep.lines + ' 行');
  await vp.click('#copy');
  await vp.waitForTimeout(250);
  const vpCopy = await vp.evaluate(() => document.getElementById('copy').textContent);
  ok('複製報告按得動（file:// 上會退回 execCommand）', /已複製|Ctrl\+C/.test(vpCopy),
     '按鈕變成「' + vpCopy + '」');

  /* 取得 prompt（v1.63）：這一頁自己也要拿得到〈藍圖製作說明〉。
     整條路是「按這顆拿說明 → 貼給 AI → 把它回的貼進上面那個框」，
     以前只有遊戲那邊有這顆，來預覽頁的人得先回遊戲一趟。
     跟遊戲那顆是同一支 BP_DOC，所以這裡驗的是「這一頁載到了、而且真的複製得出去」。 */
  await vp.click('#doc');
  await vp.waitForTimeout(250);
  const vpDoc = await vp.evaluate(async () => {
    let clip = '';
    try { clip = await navigator.clipboard.readText(); } catch (e) { clip = '(讀不到剪貼簿)'; }
    return { btn: document.getElementById('doc').textContent,
             off: document.getElementById('doc').disabled,
             len: typeof BP_DOC === 'string' ? BP_DOC.length : -1, clip };
  });
  const vpMd = fs.readFileSync(path.join(ROOT, 'blueprints/藍圖製作說明.md'), 'utf8')
                 .replace(/\r\n/g, '\n');
  ok('預覽頁也載得到〈藍圖製作說明〉全文', !vpDoc.off && vpDoc.len === vpMd.length,
     'BP_DOC ' + vpDoc.len + ' 字、.md ' + vpMd.length + ' 字');
  ok('按「取得 prompt」整份說明真的進了剪貼簿',
     /已複製|Ctrl\+C/.test(vpDoc.btn) && vpDoc.clip.replace(/\r\n/g, '\n') === vpMd,
     '按鈕變成「' + vpDoc.btn + '」，剪貼簿 ' + vpDoc.clip.length + ' 字');


  /* 📋 貼上（v1.140）：跟遊戲那顆同一件事。這一頁那一列變成三顆，所以順手驗版面——
     平分寬度的話「📋 取得 prompt」會被壓到換行，那一列就變兩層高。 */
  const vpRow = await vp.evaluate(() => {
    const b = ['doc', 'pasteBtn', 'load'].map(i => document.getElementById(i));
    const r = b.map(x => x.getBoundingClientRect());
    return { txt: b.map(x => x.textContent), h: r.map(x => Math.round(x.height)),
             oneRow: r.every(x => Math.round(x.top) === Math.round(r[0].top)),
             inBox: r[2].right <=
               document.getElementById('pasteBox').getBoundingClientRect().right };
  });
  ok('貼上框那一列排得下三顆：取得 prompt → 貼上 → 貼上並預覽',
     vpRow.txt[1] === '📋 貼上' && vpRow.oneRow && vpRow.inBox &&
     vpRow.h.every(h => h === vpRow.h[0]) && vpRow.h[0] < 46,
     vpRow.txt.join('／') + '，每顆高 ' + vpRow.h[0] + 'px');

  /* Gemini／GPT（v1.160）：這一頁的路是「取得 prompt → 去問 AI → 貼回來」，
     可是前面那兩步以前只有遊戲的匯入面板有連結（index.html 的 #impGem／#impGpt），
     真正在做藍圖的人待在這一頁，反而要自己去開分頁。兩邊同一組網址。
     擺在「重新產生／檢查藍圖」那一列是因為卡片高度已經頂滿（見下一條），只剩寬度可用——
     所以這裡要驗它真的**擠在同一列裡**、沒有把那一列撐成兩層，也沒有溢出卡片。 */
  const vpAi = await vp.evaluate(() => {
    const gem = document.getElementById('gem'), gpt = document.getElementById('gpt');
    const chk = document.getElementById('chk');
    const r = [chk, gem, gpt].map(x => x.getBoundingClientRect());
    return {
      gem: gem.getAttribute('href'),
      gpt: gpt.getAttribute('href'),
      blank: [gem, gpt].every(a => a.target === '_blank'),
      row: gem.parentElement === chk.parentElement,
      oneRow: r.every(x => Math.round(x.top) === Math.round(r[0].top)),
      // 混在一堆 <button> 中間的 <a>：沒補樣式的話沒有邊框、也不等高
      sameH: r.slice(1).every(x => Math.abs(x.height - r[0].height) <= 1),
      inCard: r[2].right <= document.getElementById('side').getBoundingClientRect().right
    };
  });
  ok('預覽頁也有 Gemini／GPT，跟「檢查藍圖」擠在同一列、開新分頁',
     vpAi.gem === 'https://gemini.google.com/app' && vpAi.gpt === 'https://chatgpt.com/' &&
     vpAi.blank && vpAi.row && vpAi.oneRow && vpAi.sameH && vpAi.inCard,
     vpAi.gem + '、' + vpAi.gpt + '（同一列、新分頁、跟按鈕等高）');

  const vpPaste = await vp.evaluate(async () => {
    await navigator.clipboard.writeText('customBlueprint({ 剪貼簿裡這一段 })');
    document.getElementById('paste').value = '';
    document.getElementById('pasteBtn').click();
    await new Promise(r => setTimeout(r, 150));
    return { v: document.getElementById('paste').value,
             btn: document.getElementById('pasteBtn').textContent,
             opts: document.getElementById('shape').options.length,
             msg: document.getElementById('pasteMsg').textContent };
  });
  /* 不順手預覽：這一頁的節奏是「貼上 → 看 → 改 → 再貼」，倒進來常常還要自己改幾個字 */
  ok('預覽頁按「貼上」也是倒進框裡就好，不會自己載入預覽',
     vpPaste.v === 'customBlueprint({ 剪貼簿裡這一段 })' && vpPaste.btn === '已貼上 ✓' &&
     vpPaste.opts === ALL_SHAPES && vpPaste.msg === '',
     '框裡「' + vpPaste.v + '」，選單還是 ' + vpPaste.opts + ' 項、沒有載入訊息');

  const vpWire = await vp.evaluate(() => {
    const w = document.getElementById('wire');
    w.checked = true; w.dispatchEvent(new Event('change'));
    const off = ENG.three.scene.children.filter(o => o.isMesh && o.visible).length;
    w.checked = false; w.dispatchEvent(new Event('change'));
    return { off, on: ENG.three.scene.children.filter(o => o.isMesh && o.visible).length };
  });
  ok('「只看輪廓」把草地收掉、再打開會回來', vpWire.off === 1 && vpWire.on > 1,
     '關掉草地後看得見 ' + vpWire.off + ' 顆網格（只剩積木），打開後 ' + vpWire.on + ' 顆');
  ok('預覽頁的版本號跟 src/game.js 一致', vpBoot.ver === await page.evaluate(() => VERSION),
     '預覽頁 v' + vpBoot.ver);

  /* v1.150 的版面：報告**一格都不佔**（使用者：「檢查報告框太大，那只需要複製給 AI 看
     就好」），畫面上只留一行結論；貼上框還是這一頁的主角。
     順便守住「整張卡片放得進畫面」——v1.150 之前內容 922px 比 800 高的畫面還高，
     最下面那排按鈕跟說明是被切掉的（1366×768 的筆電更慘）。 */
  const vpBox = await vp.evaluate(() => {
    const h = id => Math.round(document.getElementById(id).getBoundingClientRect().height);
    const side = document.getElementById('side');
    const box = document.getElementById('pasteBox');
    box.open = true;
    /* 量 scrollHeight 而不是外框高度：卡片有 max-height，展開時早就頂到上限了，
       拿外框相減量到的是「被夾掉多少」而不是「內容差多少」（面板一多一格就會誤判）。 */
    const open = side.scrollHeight;
    box.open = false;
    const shut = side.scrollHeight;
    const fits = Math.round(side.getBoundingClientRect().height);
    box.open = true;
    return { paste: h('paste'), rep: h('rep'), open, shut, fits, view: window.innerHeight };
  });
  /* 卡片高度跟著內容走：貼上區收起來就該跟著變矮，而且外框要剛好等於內容
     （以前是 top/bottom 都釘住，報告縮小之後下面會留一塊空白）。 */
  ok('報告不佔版面、貼上框仍是主角，整張卡片放得進畫面',
     vpBox.rep < 10 && vpBox.paste > 180 &&
     vpBox.shut < vpBox.open - 200 && Math.abs(vpBox.fits - vpBox.shut) <= 1 &&
     vpBox.open <= vpBox.view - 28,
     '貼上框 ' + vpBox.paste + 'px、報告 ' + vpBox.rep + 'px；內容展開 ' + vpBox.open +
     'px、收起 ' + vpBox.shut + 'px（外框 ' + vpBox.fits + '，畫面高 ' + vpBox.view + '）');

  /* 下載四視圖：報告講不出「像不像」，那要看圖。這條要驗到真的有一個 PNG 掉下來——
     canvas 的 drawingBuffer 合成後就被清空，沒有「render 完馬上取」的話會存到全黑或全空。
     尺寸一起驗：1024×1024（四格 512）是 v1.160 刻意壓的，以前存的是視窗寬高 × dpr
     （1920 螢幕配 dpr 1.5 就是 2880×1620），而這張圖是要餵給 AI 看的。 */
  const [vpDl] = await Promise.all([
    vp.waitForEvent('download'),
    vp.click('#shot')
  ]);
  const dlPath = path.join(OUT, 'viewer-shot.png');
  await vpDl.saveAs(dlPath);
  const dlBuf = fs.readFileSync(dlPath);
  const dlSize = dlBuf.length;
  const dlHead = dlBuf.slice(1, 4).toString('latin1');
  /* PNG 的寬高就在檔頭後面：8 bytes 簽章 ＋ 4 長度 ＋ 4 個字的 'IHDR'，接著寬、高各 4 bytes */
  const dlW = dlSize > 24 ? dlBuf.readUInt32BE(16) : 0;
  const dlH = dlSize > 24 ? dlBuf.readUInt32BE(20) : 0;
  ok('按「下載四視圖」真的存得出一張 1024×1024 的 PNG',
     dlHead === 'PNG' && dlW === 1024 && dlH === 1024 && dlSize > 20000 &&
     /\.png$/.test(vpDl.suggestedFilename()),
     '檔名「' + vpDl.suggestedFilename() + '」，' + dlW + '×' + dlH + '、' +
     Math.round(dlSize / 1024) + ' KB');

  /* 四個鏡頭真的站對邊（v1.160）：藍圖的正面是 −z（臉、大門朝那邊），而鏡頭的 yaw
     初值是 0.9 ＝ 相機站在 (+x, +z)——以前「下載畫面」存的其實是**背面** 45°，
     AI 拿那張去對臉的位置，前後就整個反過來（使用者：「畫臉的位置常常對不準」）。
     驗的是相機座標本身，不是像素：位置對了，那一格拍到的就是那一面。 */
  const vpCam = await vp.evaluate(() => {
    const keep = { yaw: ENG.cam.yaw, pitch: ENG.cam.pitch };
    const out = SHOT_VIEWS.map(v => {
      ENG.cam.yaw = v.yaw; ENG.cam.pitch = v.pitch;
      ENG.orbit(0, 0); ENG.updateCamera(0);
      const p = ENG.three.camera.position;
      return { t: v.t, x: +p.x.toFixed(1), y: +p.y.toFixed(1), z: +p.z.toFixed(1) };
    });
    ENG.cam.yaw = keep.yaw; ENG.cam.pitch = keep.pitch; ENG.updateCamera(0);
    return out;
  });
  const [vFront, vSide, vTop, vIso] = vpCam;
  ok('四視圖的鏡頭各站對邊：正面在 −z、右側在 +x、俯視在正上方、45° 從正面斜看',
     vpCam.length === 4 &&
     vFront.z < -1 && Math.abs(vFront.x) < 1 &&
     vSide.x > 1 && Math.abs(vSide.z) < 1 &&
     vTop.y > Math.abs(vTop.x) + Math.abs(vTop.z) &&
     vIso.x > 1 && vIso.z < -1,
     vpCam.map(v => v.t + ' (' + v.x + ', ' + v.y + ', ' + v.z + ')').join('　'));

  /* 貼上藍圖：做藍圖的節奏是「貼上 → 看 → 改 → 再貼」，中間不該卡著存檔案 + 編輯 list.js。
     這幾條驗的是那條路的每一種結局，包含 AI 實際輸出長什麼樣（markdown 圍籬 + 檔名那行）。 */
  const SAMPLE = fs.readFileSync(path.join(ROOT, 'blueprints/範例-小教堂.js'), 'utf8')
                   .replace("name: '範例小教堂'", "name: '貼上來的小屋'");
  const pasteInto = async src => {
    // 不強制展開：貼上區要自己一直開著（v1.50.1），這裡幫它打開就驗不到那件事
    await vp.evaluate(t => { document.getElementById('paste').value = t; }, src);
    await vp.click('#load');
    await vp.waitForTimeout(200);
    return vp.evaluate(() => ({
      msg: document.getElementById('pasteMsg').textContent,
      bad: document.getElementById('pasteMsg').className.indexOf('bad') >= 0,
      open: document.getElementById('pasteBox').open,
      picked: document.getElementById('shape').selectedOptions[0].textContent,
      name: bp ? bp.name : null,
      drawn: ENG.three.blockMesh.count,
      shapes: SHAPES.length,
      rep: document.getElementById('rep').value.split('\n')[1] || ''
    }));
  };
  const pGood = await pasteInto('```js\n// 檔名：我的小屋.js\n' + SAMPLE + '\n```');
  // v1.49 起說明文件要求 AI 整份包成一個 ```js 區塊、第一行是檔名註解——照那個格式貼
  ok('貼上 AI 給的整個 ```js 區塊（含圍籬與檔名那行）就能預覽',
     !pGood.bad && pGood.name === '貼上來的小屋' && pGood.drawn > 100 &&
     pGood.picked.indexOf('貼上來的小屋') > 0 && pGood.shapes === ALL_SHAPES + 1,
     pGood.msg + '（畫了 ' + pGood.drawn + ' 塊）');
  /* 載入成功不去動貼上區：下一輪還要在那段文字上改，自動收起來的話每次都得先點開 */
  ok('貼上之後順手把診斷也跑掉了，而且貼上區還開著',
     pGood.rep === '藍圖：貼上來的小屋（自訂 · gen）' && pGood.open,
     '報告第二行「' + pGood.rep + '」，貼上區 open=' + pGood.open);
  const pAgain = await pasteInto(SAMPLE.replace("'#4a5a68'", "'#3a6fc0'"));
  ok('同名再貼一次是蓋掉，不會愈貼愈多',
     !pAgain.bad && pAgain.shapes === ALL_SHAPES + 1 && pAgain.name === '貼上來的小屋',
     '清單仍是 ' + pAgain.shapes + ' 座（內建 48 + 檔案 1 + 貼上 1）');
  /* 撞到內建或 blueprints/ 的名字不再退回去叫人改（v1.111）：那個 name 是 AI 寫在程式裡的，
     要改就得回頭翻那段程式。改成自動在後面加編號，內建那座不動。 */
  const pClash = await pasteInto(SAMPLE.replace("name: '貼上來的小屋'", "name: '吉薩金字塔'"));
  const pClashN = await vp.evaluate(() => ({
    builtin: SHAPES.filter(s => s.n === '吉薩金字塔').length,
    mine: SHAPES.filter(s => s.n === '吉薩金字塔2').length,
    custom: (() => { const i = SHAPES.findIndex(s => s.n === '吉薩金字塔'); return !!SHAPES[i].custom; })()
  }));
  ok('撞到內建的名字會自動加編號（吉薩金字塔 → 吉薩金字塔2），內建那座不動',
     !pClash.bad && pClash.name === '吉薩金字塔2' && pClash.shapes === ALL_SHAPES + 2 &&
     pClash.msg.indexOf('原名') > 0 && pClashN.builtin === 1 && pClashN.mine === 1 &&
     !pClashN.custom,
     pClash.msg);
  /* 同一個 name 再貼一次要換掉那一份，不是再開一份——這一頁的節奏是「貼上→看→改→再貼」，
     每一輪都多一座的話選單很快就爛掉（也是使用者不想手動清的那件事）。 */
  const pClash2 = await pasteInto(SAMPLE.replace("name: '貼上來的小屋'", "name: '吉薩金字塔'")
                                        .replace("'#4a5a68'", "'#3a6fc0'"));
  ok('撞名的那一份改一版再貼，還是同一座（不會 2、3、4 一直長）',
     !pClash2.bad && pClash2.name === '吉薩金字塔2' && pClash2.shapes === ALL_SHAPES + 2 &&
     pClash2.picked.indexOf('吉薩金字塔2') > 0,
     '清單仍是 ' + pClash2.shapes + ' 座，選的還是「' + pClash2.picked + '」');

  /* 貼上框點一下就整段選起來（v1.111）：「再貼」是拿新的一份換掉框裡那一段，
     每次都要自己 Ctrl+A 很煩。第二下要能正常移游標，不然想手改幾個字都改不了；
     用鍵盤 focus 進來的也要選起來（那種人接著就是 Ctrl+V）。 */
  await vp.click('#paste');
  const selAll = await vp.evaluate(() => {
    const t = document.getElementById('paste');
    return { s: t.selectionStart, e: t.selectionEnd, len: t.value.length };
  });
  await vp.click('#paste');
  const selAgain = await vp.evaluate(() => {
    const t = document.getElementById('paste');
    return { s: t.selectionStart, e: t.selectionEnd };
  });
  const selKey = await vp.evaluate(() => {
    const t = document.getElementById('paste');
    t.blur(); t.focus();
    const r = { s: t.selectionStart, e: t.selectionEnd };
    t.blur();
    return r;
  });
  ok('點一下貼上框就整段選起來（再點一下是正常移游標）',
     selAll.len > 20 && selAll.s === 0 && selAll.e === selAll.len &&
     selAgain.s === selAgain.e && selKey.s === 0 && selKey.e === selAll.len,
     '第一下選 ' + selAll.s + '～' + selAll.e + '（全長 ' + selAll.len + '）、第二下 ' +
     selAgain.s + '～' + selAgain.e + '（收成游標）、用鍵盤 focus 選 ' +
     selKey.s + '～' + selKey.e);
  const pSyntax = await pasteInto('customBlueprint({ name: "壞的", pal: ["#fff"], gen(v, s) { v.box(0,0,0 } });');
  ok('語法錯的貼上會講「語法錯誤」，不是靜靜地什麼都沒發生',
     pSyntax.bad && pSyntax.msg.indexOf('語法錯誤') > 0 && pSyntax.shapes === ALL_SHAPES + 2,
     pSyntax.msg);
  const pJunk = await pasteInto('console.log("hello")');
  ok('貼到不是藍圖的東西會講清楚要貼什麼',
     pJunk.bad && pJunk.msg.indexOf('customBlueprint') > 0, pJunk.msg);
  const pBoom = await pasteInto(
    "customBlueprint({ name: '會爆的', pal: ['#fff'], lo: 2, hi: 9, gen() { throw new Error('測試用'); } });");
  ok('gen 會爆的藍圖照樣載得進來，讓報告去指出哪裡爆',
     !pBoom.bad && pBoom.drawn === 0 && pBoom.rep === '藍圖：會爆的（自訂 · gen）',
     '畫不出東西（' + pBoom.drawn + ' 塊），但報告認得它');
  const pBoomRep = await vp.evaluate(() => document.getElementById('rep').value);
  ok('那份報告裡有 gen 的錯誤訊息與修法',
     pBoomRep.indexOf('測試用') > 0 && pBoomRep.indexOf('修法') > 0,
     pBoomRep.split('\n').find(l => l.indexOf('測試用') > 0) || '(沒寫到)');

  /* 下載 .js（v1.53）：滿意的那一版就在貼上框裡，但要留下來還得自己選取、複製、開編輯器、
     貼上、存檔。這幾條驗的是「真的掉得出一個檔案、檔名照『// 檔名：』那行、
     內容乾淨到可以直接丟回來再跑一次」。 */
  const pKeep = await pasteInto('```js\n// 檔名：我的小屋.js\n' + SAMPLE + '\n```');
  const pickShape = n => vp.evaluate(n => {
    const sel = document.getElementById('shape');
    sel.value = String(SHAPES.findIndex(s => s.n === n));
    sel.dispatchEvent(new Event('change'));
    return document.getElementById('save').disabled;
  }, n);
  const saveOnPasted = await vp.evaluate(() => document.getElementById('save').disabled);
  const saveOnBuiltin = await pickShape('吉薩金字塔');
  await pickShape('貼上來的小屋');
  const [jsDl] = await Promise.all([vp.waitForEvent('download'), vp.click('#save')]);
  const jsPath = path.join(OUT, 'viewer-save.js');
  await jsDl.saveAs(jsPath);
  const jsText = fs.readFileSync(jsPath, 'utf8');
  ok('內建藍圖沒有「下載 .js」可按，貼上來的才有',
     saveOnBuiltin === true && saveOnPasted === false && !pKeep.bad,
     '貼上來的 disabled=' + saveOnPasted + '、內建 disabled=' + saveOnBuiltin);
  ok('按「下載 .js」存得出檔案，檔名照「// 檔名：」那一行',
     jsDl.suggestedFilename() === '我的小屋.js' && jsText.indexOf('```') < 0 &&
     jsText.indexOf("name: '貼上來的小屋'") > 0 && jsText.trim().endsWith('});'),
     '檔名「' + jsDl.suggestedFilename() + '」，' + jsText.split('\n').length + ' 行、' +
     Math.round(jsText.length / 1024) + ' KB');
  const pRound = await pasteInto(jsText);
  ok('存出來的檔案再貼回來照樣跑得動（可以直接放進 blueprints/）',
     !pRound.bad && pRound.name === '貼上來的小屋' && pRound.drawn > 100,
     pRound.msg + '（畫了 ' + pRound.drawn + ' 塊）');

  /* 貼進來的檔名也要進候選清單：節奏是「貼上 → 下載 .js → 放進資料夾 → 補 list.js」，
     最後那一步緊接在後面，不該還要自己回頭打一次檔名。 */
  const vpList1 = await vp.evaluate(() => {
    const box = [...document.querySelectorAll('#files input')];
    return { files: box.map(i => i.dataset.f), on: box.filter(i => i.checked).length,
             tags: [...document.querySelectorAll('#files em')].map(e => e.textContent) };
  });
  ok('這一頁貼上的藍圖檔名也會出現在清單裡，並標明來源',
     vpList1.files.indexOf('我的小屋.js') > 0 && vpList1.on === vpList1.files.length &&
     vpList1.tags.filter(t => t === '這一頁貼上的').length === vpList1.files.length - CUSTOM_COUNT,
     vpList1.files.join('、'));
  const vpList2 = await vp.evaluate(() => {
    const t = [...document.querySelectorAll('#files input')].find(i => i.dataset.f === '會爆的.js');
    t.checked = false;
    t.dispatchEvent(new Event('change', { bubbles: true }));
    return { text: listText(), toggle: document.getElementById('allOn').textContent };
  });
  ok('取消勾選的檔名就不會寫進 list.js',
     vpList2.text.indexOf("'會爆的.js'") < 0 && vpList2.text.indexOf("'我的小屋.js'") > 0 &&
     vpList2.text.indexOf("'範例-小教堂.js'") > 0 && vpList2.toggle === '全選',
     '產出來的清單是 ' + (vpList2.text.match(/'[^']+'/g) || []).join('、'));

  /* 掃資料夾：file:// 沒辦法自己列資料夾（fetch 被 CORS 擋），
     <input webkitdirectory> 是瀏覽器唯一肯交出檔名清單的路。掃完就以資料夾為準。 */
  // 餵真的資料夾（webkitdirectory 的 input 只收得下目錄），檔案的 webkitRelativePath 才是真的
  await vp.setInputFiles('#dir', path.join(ROOT, 'blueprints'));
  const vpScan = await vp.evaluate(() => {
    const box = [...document.querySelectorAll('#files input')];
    return { files: box.map(i => i.dataset.f), on: box.filter(i => i.checked).length,
             msg: document.getElementById('listMsg').textContent };
  });
  ok('掃過資料夾之後，清單就等於資料夾裡真的有的藍圖（list.js 與非 .js 都不算）',
     vpScan.files.join(',') === CUSTOM_FILES &&
     vpScan.on === CUSTOM_COUNT && vpScan.msg.indexOf('掃到 ' + CUSTOM_COUNT + ' 支') === 0,
     vpScan.msg);
  const vpPaths = await vp.evaluate(() => ({
    inner: bpFilesFrom(['my-tower.js', 'list.js', '藍圖製作說明.md', 'sub/hut.js']),
    root: bpFilesFrom(['index.html', 'src/game.js', 'blueprints/list.js',
                       'blueprints/my-tower.js', 'blueprints/範例-小教堂.js']),
    order: bpFilesFrom(['ZZ.js', '範例-小教堂.js', 'AA.js'])
  }));
  ok('選錯成整包的根目錄也接得住（只收 blueprints/ 底下那些）',
     vpPaths.inner.join(',') === 'my-tower.js,sub/hut.js' &&
     vpPaths.root.join(',') === '範例-小教堂.js,my-tower.js',
     '選資料夾本身 → ' + vpPaths.inner.join('、') + '；選根目錄 → ' + vpPaths.root.join('、'));
  ok('本來就在 list.js 裡的排前面，新掃到的接在後面',
     vpPaths.order.join(',') === '範例-小教堂.js,AA.js,ZZ.js',
     vpPaths.order.join(' → '));

  /* 報告收進去之後，「按了檢查有沒有回饋」就全靠這一行結論（v1.150）。
     順便守住兩件事：換藍圖會把上一份結論清掉（不清的話畫面上會留著別座的診斷），
     以及報告全文照樣在 #rep.value 裡——那才是要複製給 AI 的東西。 */
  const vpVerdict = await vp.evaluate(() => {
    document.getElementById('shape').dispatchEvent(new Event('change'));
    const v = document.getElementById('verdict');
    const idle = { t: v.textContent.slice(0, 6), cls: v.className };
    document.getElementById('chk').click();
    return { idle, t: v.textContent, cls: v.className,
             h: Math.round(v.getBoundingClientRect().height),
             rep: document.getElementById('rep').value.length,
             repH: Math.round(document.getElementById('rep').getBoundingClientRect().height) };
  });
  ok('報告收起來之後，按「檢查藍圖」畫面上仍看得到結論',
     vpVerdict.idle.cls === 'idle' && '✔⚠✘'.indexOf(vpVerdict.t[0]) >= 0 &&
     ['ok', 'warn', 'bad'].indexOf(vpVerdict.cls) >= 0 && vpVerdict.h > 12 &&
     vpVerdict.rep > 300 && vpVerdict.repH < 10,
     '換藍圖後回到「' + vpVerdict.idle.t + '…」，按檢查變成「' +
     vpVerdict.t.split('\n')[0] + '」（' + vpVerdict.cls + '、' + vpVerdict.h +
     'px）；報告全文 ' + vpVerdict.rep + ' 字還在，畫面上佔 ' + vpVerdict.repH + 'px');

  /* 收合鈕（v1.150）：手機上這張卡片蓋掉大半個畫面，而這一頁的重點是看藍圖。 */
  const vpFold = await vp.evaluate(() => {
    const sd = document.getElementById('side'), fb = document.getElementById('fold');
    const full = Math.round(sd.getBoundingClientRect().height);
    fb.click();
    const shut = Math.round(sd.getBoundingClientRect().height);
    const gone = [...sd.children].filter(el => el.className !== 'head' &&
      getComputedStyle(el).display === 'none').length;
    const btn = fb.textContent;
    fb.click();
    return { full, shut, gone, btn, kids: sd.children.length,
             back: Math.round(sd.getBoundingClientRect().height) };
  });
  ok('收合鈕把面板收成只剩標題列，再按一次回來',
     vpFold.shut < 70 && vpFold.shut < vpFold.full - 300 && vpFold.btn === '▼' &&
     vpFold.gone === vpFold.kids - 1 && vpFold.back === vpFold.full,
     '面板 ' + vpFold.full + ' → ' + vpFold.shut + 'px（收掉 ' + vpFold.gone + '／' +
     vpFold.kids + ' 格，鈕變「' + vpFold.btn + '」），再按一次回到 ' + vpFold.back + 'px');

  /* 使用者回報「按鈕文字折行」：390px 的手機上那三顆各自折成兩行、還被卡片下緣切掉。
     窄畫面的修法是**整顆換列**而不是把字折斷，所以這一條數的是「每顆幾行字」。
     量完要把視窗還回去（見 README〈測試動過的全域狀態要還回去〉）。 */
  await vp.setViewportSize({ width: 390, height: 844 });
  await vp.waitForTimeout(200);
  const vpNarrow = await vp.evaluate(() => {
    const lines = ids => ids.map(i => {
      const el = document.getElementById(i), cs = getComputedStyle(el);
      const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5;
      const inner = el.getBoundingClientRect().height - parseFloat(cs.paddingTop) -
        parseFloat(cs.paddingBottom) - parseFloat(cs.borderTopWidth) * 2;
      return Math.round(inner / lh);
    });
    const sd = document.getElementById('side');
    return { paste: lines(['doc', 'pasteBtn', 'load']), rep: lines(['copy', 'shot', 'save']),
             wide: sd.scrollWidth > sd.clientWidth,
             card: Math.round(sd.getBoundingClientRect().height), view: window.innerHeight };
  });
  await vp.setViewportSize(VIEW);
  await vp.waitForTimeout(200);
  ok('390px 手機：按鈕一律一行字（排不下就整顆換列），卡片也不蓋住整個畫面',
     vpNarrow.paste.every(n => n === 1) && vpNarrow.rep.every(n => n === 1) &&
     !vpNarrow.wide && vpNarrow.card < vpNarrow.view * 0.6,
     '貼上那列每顆 ' + vpNarrow.paste.join('／') + ' 行、報告那列 ' +
     vpNarrow.rep.join('／') + ' 行；卡片 ' + vpNarrow.card + 'px／畫面 ' +
     vpNarrow.view + 'px' + (vpNarrow.wide ? '（橫向溢出！）' : ''));

  ok('預覽頁整段跑完沒有 console 錯誤', vpErr.length === 0, vpErr.join(' / ') || '乾淨');
  await vp.close();

  /* ── 匯入建築（v1.57）─────────────────────────────────────
     遊戲本來只吃檔案（.js 放進 blueprints/ 再加進 list.js），拿到一份 AI 給的藍圖
     要蓋來看看得繞一大圈。這一段驗整條路：取得 prompt → 貼進來 → 匯入 → 選得到 →
     關掉再開還在 → 匯得出去給別人 → 刪得掉。

     開一個獨立的分頁跑：匯入會動到 SHAPES、還會寫 localStorage，
     混進主分頁那條長長的流程裡會影響後面每一條測試。 */
  await head('匯入建築');
  const impErr = [];
  const gp = await newPage({ viewport: VIEW, acceptDownloads: true,
                                     permissions: ['clipboard-read', 'clipboard-write'] });
  gp.on('pageerror', e => impErr.push('pageerror: ' + e.message));
  gp.on('console', m => { if (m.type() === 'error') impErr.push('console: ' + m.text().split('\n')[0]); });
  gp.on('dialog', d => d.accept());          // 刪除會 confirm 一次
  await gp.goto(APP);
  await gp.waitForFunction(() => typeof bp !== 'undefined' && bp);
  // 上一輪測試留下來的（file:// 的 localStorage 是所有 file:// 頁面共用的）
  await gp.evaluate(() => localStorage.removeItem('block-builders/bp1'));

  const impUi = await gp.evaluate(() => ({
    after: document.getElementById('badgeBtn').nextElementSibling.id,
    inCard: document.getElementById('badgeBtn').parentElement.id,
    open: document.getElementById('impWrap').classList.contains('on'),
    gem: document.getElementById('impGem').getAttribute('href'),
    gpt: document.getElementById('impGpt').getAttribute('href'),
    /* 「同網址的藍圖預覽.html」＝相對網址，解出來要剛好是這一頁旁邊那一支 */
    sameDir: document.getElementById('impView').href ===
             location.href.replace(/[^/]*$/, '') + encodeURI('藍圖預覽.html'),
    blank: ['impGem', 'impGpt', 'impView']
      .every(i => document.getElementById(i).target === '_blank'),
    shapes: SHAPES.length
  }));
  ok('成就按鈕下面多一顆「匯入建築」，面板預設是關著的',
     impUi.after === 'impBtn' && impUi.inCard === 'time' && impUi.open === false,
     '在右上那張卡裡，緊接在 badgeBtn 後面');
  ok('Gemini／GPT 連到對的網站，藍圖預覽開的是同一個資料夾裡那一支',
     impUi.gem === 'https://gemini.google.com/app' && impUi.gpt === 'https://chatgpt.com/' &&
     impUi.sameDir && impUi.blank,
     impUi.gem + '、' + impUi.gpt + '、藍圖預覽=同網址（都是新分頁）');

  await gp.click('#impBtn');
  const impOpen = await gp.evaluate(() => ({
    on: document.getElementById('impWrap').classList.contains('on'),
    none: document.getElementById('impList').textContent,
    docOff: document.getElementById('impDoc').disabled
  }));
  ok('按下去面板開起來，還沒匯過時清單是空的',
     impOpen.on && impOpen.docOff === false && impOpen.none.indexOf('還沒有匯入過') >= 0,
     impOpen.none.trim());

  /* ⓘ 說明：第一次來的人看到四顆按鈕跟一個空框，不知道要幹嘛。整條路收在這裡面。 */
  const impHelp = await gp.evaluate(() => {
    const h = document.getElementById('impHelp'), i = document.getElementById('impInfo');
    const shut0 = getComputedStyle(h).display;
    i.click();
    const open = getComputedStyle(h).display, lit = i.classList.contains('on');
    const text = h.textContent;
    i.click();
    const shut1 = getComputedStyle(h).display;
    i.click();                                  // 留著展開，下面那幾條要對照它的內容
    return { shut0, open, shut1, lit, steps: h.querySelectorAll('li').length, text,
             btns: ['impDoc', 'impGem', 'impGpt', 'impGo'].map(b =>
               document.getElementById(b).textContent.replace('📋 ', '')) };
  });
  ok('ⓘ 預設收著，點一下展開、再點收起來',
     impHelp.shut0 === 'none' && impHelp.open === 'block' && impHelp.shut1 === 'none' &&
     impHelp.lit,
     '展開後 ' + impHelp.steps + ' 個步驟');
  /* 說明裡指名的按鈕要真的叫那個名字：改了按鈕文字卻忘了改說明，
     照著做的人會在面板上找不到那顆。 */
  ok('說明從「取得 prompt」一路講到匯入，指名的按鈕都真的在面板上',
     impHelp.steps === 7 && impHelp.btns.every(t => impHelp.text.indexOf(t) >= 0) &&
     ['剪貼簿', 'Ctrl+V', '下拉選單', '匯出', '刪除', '藍圖預覽']
       .every(k => impHelp.text.indexOf(k) >= 0),
     impHelp.steps + ' 步，提到的按鈕：' + impHelp.btns.join('／'));

  /* 取得 prompt：整份〈藍圖製作說明〉進剪貼簿。玩家拿它去餵網頁版 AI，
     所以它必須跟 blueprints/ 裡那份逐字相同——那支 .js 是工具產出來的，
     改了 .md 忘了重跑就會在這裡被抓到。 */
  await gp.click('#impDoc');
  await gp.waitForTimeout(250);
  const impDoc = await gp.evaluate(async () => {
    let clip = '';
    try { clip = await navigator.clipboard.readText(); } catch (e) { clip = '(讀不到剪貼簿)'; }
    return { btn: document.getElementById('impDoc').textContent, clip: clip, doc: BP_DOC };
  });
  const mdText = fs.readFileSync(path.join(ROOT, 'blueprints/藍圖製作說明.md'), 'utf8')
                   .replace(/\r\n/g, '\n');
  ok('src/bpdoc.js 跟〈藍圖製作說明.md〉逐字相同（改了 .md 要重跑 build-bpdoc）',
     impDoc.doc === mdText,
     'BP_DOC ' + impDoc.doc.length + ' 字、.md ' + mdText.length + ' 字');
  /* 剪貼簿讀回來是 CRLF：Windows 的剪貼簿本來就存 CRLF，貼進 AI 的輸入框沒有差別 */
  ok('按「取得 prompt」整份說明真的進了剪貼簿',
     impDoc.btn === '已複製 ✓' && impDoc.clip.replace(/\r\n/g, '\n') === mdText,
     '按鈕變成「' + impDoc.btn + '」，剪貼簿 ' + impDoc.clip.length + ' 字');


  /* 📋 貼上（v1.140）：懶得按 Ctrl+C／Ctrl+V 的人按這顆，把剪貼簿倒進框裡。
     讀剪貼簿要瀏覽器同意，不給就退回「自己按 Ctrl+V」，所以三種結局都要驗。 */
  const impPos = await gp.evaluate(() => {
    const b = document.getElementById('impPasteBtn'), g = document.getElementById('impGo');
    const rb = b.getBoundingClientRect(), rg = g.getBoundingClientRect();
    return { txt: b.textContent, before: rb.right <= rg.left,
             sameRow: Math.round(rb.top) === Math.round(rg.top), w: Math.round(rb.width) };
  });
  ok('匯入面板多一顆「📋 貼上」，跟「匯入」同一列、排在它前面',
     impPos.txt === '📋 貼上' && impPos.before && impPos.sameRow && impPos.w > 60,
     '「' + impPos.txt + '」寬 ' + impPos.w + 'px，在「匯入」左邊');

  const impGot = await gp.evaluate(async () => {
    await navigator.clipboard.writeText('customBlueprint({ 剪貼簿裡這一段 })');
    document.getElementById('impPaste').value = '';
    document.getElementById('impPasteBtn').click();
    await new Promise(r => setTimeout(r, 150));
    return { v: document.getElementById('impPaste').value, shapes: SHAPES.length,
             btn: document.getElementById('impPasteBtn').textContent };
  });
  /* 只倒進框裡、不順手匯入：貼完先看一眼再按「匯入」才是對的順序（SHAPES 沒變＝沒匯） */
  ok('按「貼上」剪貼簿那段直接進框，而且不會順手匯入',
     impGot.v === 'customBlueprint({ 剪貼簿裡這一段 })' && impGot.btn === '已貼上 ✓' &&
     impGot.shapes === impUi.shapes,
     '框裡「' + impGot.v + '」，按鈕變成「' + impGot.btn + '」');

  const impNone = await gp.evaluate(async () => {
    await navigator.clipboard.writeText('');
    document.getElementById('impPaste').value = '手上這一段還在改';
    document.getElementById('impPasteBtn').click();
    await new Promise(r => setTimeout(r, 150));
    return { v: document.getElementById('impPaste').value,
             btn: document.getElementById('impPasteBtn').textContent };
  });
  ok('剪貼簿是空的就講一聲，不把框裡原本那段洗掉',
     impNone.v === '手上這一段還在改' && impNone.btn === '剪貼簿是空的',
     '按鈕變成「' + impNone.btn + '」，框裡還是「' + impNone.v + '」');

  const impDeny = await gp.evaluate(async () => {
    /* 先把前面幾條測試留下來的計時器等完再開始（v1.148.1）。`pasteText` 的 flash()
       每按一次就排一個 **1.6 秒**的「把按鈕文字還原」計時器，而前面連著兩條
       （已貼上 ✓、剪貼簿是空的）各排了一個。Node 這一趟來回慢一點的話，那些計時器
       就會落在這一條按下去之後的 150 毫秒視窗裡，把「請按 Ctrl+V」蓋回「📋 貼上」。

       第一版是「等到按鈕變回 📋 貼上 為止」——**不夠**：那只代表最早那一個跑完了，
       後面那個照樣還排著（整輪測試又踩到一次）。要等的是「比最長的那個還久」，
       所以直接睡 1.7 秒（flash 是 1.6 秒；2.2 秒那個是這一條自己按下去才排的）。 */
    await new Promise(r => setTimeout(r, 1700));
    /* 借過一下：把 readText 換成一定失敗的，驗「瀏覽器不給讀」那條退路，驗完還回去。
       file:// 上真的會不給（跟複製那顆同一個問題），退路不能只是「什麼都沒發生」。 */
    Object.defineProperty(navigator.clipboard, 'readText',
      { configurable: true, value: () => Promise.reject(new Error('denied')) });
    const ta = document.getElementById('impPaste');
    ta.value = '原本這一段';
    ta.blur();
    document.getElementById('impPasteBtn').click();
    await new Promise(r => setTimeout(r, 150));
    const got = { btn: document.getElementById('impPasteBtn').textContent,
                  focus: document.activeElement.id, v: ta.value,
                  sel: ta.selectionEnd - ta.selectionStart };
    delete navigator.clipboard.readText;
    got.back = typeof navigator.clipboard.readText === 'function';
    return got;
  });
  /* 游標要先進框裡、整段選起來，Ctrl+V 才是「換掉舊那段」而不是插在游標處 */
  ok('瀏覽器不給讀剪貼簿時退回「請按 Ctrl+V」，游標先放進框裡並整段選起來',
     impDeny.btn === '請按 Ctrl+V' && impDeny.focus === 'impPaste' &&
     impDeny.v === '原本這一段' && impDeny.sel === impDeny.v.length && impDeny.back,
     '按鈕變成「' + impDeny.btn + '」，游標在 #' + impDeny.focus + '、選了 ' +
     impDeny.sel + ' 個字');

  const impBad = await gp.evaluate(() => {
    document.getElementById('impPaste').value = 'console.log("哈囉")';
    document.getElementById('impGo').click();
    return { msg: document.getElementById('impMsg').textContent,
             bad: document.getElementById('impMsg').className.indexOf('bad') >= 0,
             shapes: SHAPES.length, saved: localStorage.getItem('block-builders/bp1') };
  });
  ok('貼到不是藍圖的東西會講清楚，而且什麼都不會被加進去',
     impBad.bad && impBad.msg.indexOf('customBlueprint') > 0 &&
     impBad.shapes === impUi.shapes && !impBad.saved,
     impBad.msg);

  const impGood = await gp.evaluate(src => {
    document.getElementById('impPaste').value = src;
    document.getElementById('impGo').click();
    const sel = document.getElementById('shape');
    return { msg: document.getElementById('impMsg').textContent,
             good: document.getElementById('impMsg').className.indexOf('good') >= 0,
             shapes: SHAPES.length,
             left: document.getElementById('impPaste').value,
             rows: document.querySelectorAll('#impList .it').length,
             row: (document.querySelector('#impList .it') || {}).textContent || '',
             inMenu: [...sel.options].map(o => o.textContent).indexOf('貼上來的小屋'),
             saved: JSON.parse(localStorage.getItem('block-builders/bp1') || '[]') };
  }, '```js\n// 檔名：我的小屋.js\n' + SAMPLE + '\n```');
  /* 下拉選單：[0] 是「🎲 隨機」，接著是 blueprints/ 裡那 CUSTOM_COUNT 支，
     自訂的都排在內建 48 座前面，剛匯入的接在自訂那一群的最後面
     → 位置就是 1 + CUSTOM_COUNT。 */
  ok('貼上並匯入之後，藍圖清單、下拉選單、存檔三邊都跟上了',
     impGood.good && impGood.shapes === impUi.shapes + 1 && impGood.rows === 1 &&
     impGood.inMenu === 1 + CUSTOM_COUNT && impGood.left === '' &&
     impGood.saved.length === 1 && impGood.saved[0].names[0] === '貼上來的小屋' &&
     impGood.saved[0].file === '我的小屋.js',
     impGood.msg + '　清單「' + impGood.row + '」，下拉第 ' + impGood.inMenu + ' 項');

  const impBuild = await gp.evaluate(() => {
    const sel = document.getElementById('shape');
    sel.value = String(SHAPES.findIndex(s => s.n === '貼上來的小屋'));
    sel.dispatchEvent(new Event('change'));
    /* 「真的蓋得出來」＝每一格都填得滿。v1.141 起料池不再預先補滿（缺料的人自己挖，
       見 reconcilePool），所以不能再拿「池子＝格數」當證據——改走憑空建成那條路，
       它會把不夠的當場生出來（開場那一座、⚡ 立刻完工都是這條）。 */
    completeNow();
    return { name: bp.name, blocks: bp.slots.length, pool: blocks.length,
             set: blocks.filter(b => b.st === 3).length, drawn: ENG.three.blockMesh.count };
  });
  ok('匯進來的藍圖選得到，也真的蓋得出來',
     impBuild.name === '貼上來的小屋' && impBuild.blocks > 100 &&
     impBuild.set === impBuild.blocks && impBuild.drawn === impBuild.pool,
     impBuild.name + '　' + impBuild.blocks + ' 格全部就位（池 ' + impBuild.pool + ' 塊）');

  /* 關掉再開還要在：預覽頁的貼上是「F5 就沒了」（那是工作台），
     遊戲這邊是拿來玩的，存下來才有意義。 */
  await gp.reload();
  await gp.waitForFunction(() => typeof bp !== 'undefined' && bp);
  const impKeep = await gp.evaluate(() => ({
    shapes: SHAPES.length,
    has: SHAPES.some(s => s.n === '貼上來的小屋'),
    inMenu: [...document.getElementById('shape').options].map(o => o.textContent)
              .indexOf('貼上來的小屋')
  }));
  ok('重開頁面之後匯進來的藍圖還在（而且還是排在自訂那一群裡）',
     impKeep.has && impKeep.shapes === impUi.shapes + 1 && impKeep.inMenu === 1 + CUSTOM_COUNT,
     '共 ' + impKeep.shapes + ' 座，下拉第 ' + impKeep.inMenu + ' 項');

  /* 匯出是**一列一顆**（v1.57.1）：分享的單位是「一座建築」，不是整包。
     所以先匯第二座進來，才驗得到「按第二列匯出來的真的只有第二座」。 */
  await gp.click('#impBtn');
  const impTwo = await gp.evaluate(src => {
    document.getElementById('impPaste').value = src;
    document.getElementById('impGo').click();
    return { rows: document.querySelectorAll('#impList .it').length,
             outs: document.querySelectorAll('#impList [data-out]').length,
             dels: document.querySelectorAll('#impList [data-del]').length,
             names: [...document.querySelectorAll('#impList .it b')].map(b => b.textContent) };
  }, '// 檔名：我的塔.js\n' + SAMPLE.replace("name: '貼上來的小屋'", "name: '貼上來的塔'"));
  ok('每一列都有自己的「匯出」與「刪除」',
     impTwo.rows === 2 && impTwo.outs === 2 && impTwo.dels === 2 &&
     impTwo.names.join(',') === '貼上來的小屋,貼上來的塔',
     impTwo.rows + ' 列：' + impTwo.names.join('、'));

  const [impDl2] = await Promise.all([
    gp.waitForEvent('download'),
    gp.click('#impList [data-out="1"]')
  ]);
  /* 按鈕的「已下載 ✓」**要在存檔之前先讀**（v1.116）：它 1.6 秒後會自己變回「匯出」，
     而 saveAs ＋ 讀檔 ＋ 一條 ok() 加起來就可能吃掉那 1.6 秒——量到的會是還原後的字。 */
  const impBtnBack = await gp.evaluate(() =>
    document.querySelector('#impList [data-out="1"]').textContent);
  const impPath2 = path.join(OUT, 'game-export-2.js');
  await impDl2.saveAs(impPath2);
  const impText2 = fs.readFileSync(impPath2, 'utf8');
  ok('按第二列的「匯出」，下載的就只有第二座（檔名也是它自己的）',
     impDl2.suggestedFilename() === '我的塔.js' &&
     impText2.indexOf("name: '貼上來的塔'") > 0 &&
     impText2.indexOf('貼上來的小屋') < 0 &&
     impText2.indexOf('積木小人 · 匯出的藍圖（貼上來的塔）') > 0,
     '檔名「' + impDl2.suggestedFilename() + '」，' + impText2.split('\n').length + ' 行、' +
     '沒夾帶另一座');
  ok('按下去那一列的按鈕會回報已下載', impBtnBack === '已下載 ✓', '按鈕變成「' + impBtnBack + '」');

  const impDel2 = await gp.evaluate(() => {
    document.querySelector('#impList [data-del="1"]').click();
    return { rows: document.querySelectorAll('#impList .it').length,
             left: [...document.querySelectorAll('#impList .it b')].map(b => b.textContent).join(','),
             has: SHAPES.some(s => s.n === '貼上來的塔'),
             shapes: SHAPES.length };
  });
  ok('刪第二列只刪掉第二座，第一座留著',
     impDel2.rows === 1 && impDel2.left === '貼上來的小屋' && !impDel2.has &&
     impDel2.shapes === impUi.shapes + 1,
     '剩下「' + impDel2.left + '」，共 ' + impDel2.shapes + ' 座');

  const [impDl] = await Promise.all([
    gp.waitForEvent('download'),
    gp.click('#impList [data-out="0"]')
  ]);
  const impPath = path.join(OUT, 'game-export.js');
  await impDl.saveAs(impPath);
  const impText = fs.readFileSync(impPath, 'utf8');
  ok('匯出來的是一支可以傳給別人的藍圖檔',
     impDl.suggestedFilename() === '我的小屋.js' && impText.indexOf('customBlueprint') > 0 &&
     impText.indexOf('```') < 0 && impText.indexOf('積木小人 · 匯出的藍圖（貼上來的小屋）') > 0,
     '檔名「' + impDl.suggestedFilename() + '」，' + impText.split('\n').length + ' 行');
  const impRound = await gp.evaluate(src => {
    document.getElementById('impPaste').value = src;
    document.getElementById('impGo').click();
    return { good: document.getElementById('impMsg').className.indexOf('good') >= 0,
             msg: document.getElementById('impMsg').textContent,
             shapes: SHAPES.length,
             rows: document.querySelectorAll('#impList .it').length };
  }, impText);
  ok('匯出來的檔案貼回去照樣匯得進來，而且是蓋掉不是又多一座',
     impRound.good && impRound.shapes === impUi.shapes + 1 && impRound.rows === 1,
     impRound.msg);

  const impDel = await gp.evaluate(() => {
    document.querySelector('#impList [data-del="0"]').click();
    const sel = document.getElementById('shape');
    return { shapes: SHAPES.length,
             has: SHAPES.some(s => s.n === '貼上來的小屋'),
             rows: document.querySelectorAll('#impList .it').length,
             inMenu: [...sel.options].map(o => o.textContent).indexOf('貼上來的小屋'),
             pick: shapePick,
             saved: JSON.parse(localStorage.getItem('block-builders/bp1') || '[]').length };
  });
  ok('刪掉之後 SHAPES、下拉選單、存檔三邊都清乾淨了',
     !impDel.has && impDel.shapes === impUi.shapes && impDel.rows === 0 &&
     impDel.inMenu < 0 && impDel.saved === 0,
     '回到 ' + impDel.shapes + ' 座，存檔 ' + impDel.saved + ' 筆');
  /* 剛才選的就是被刪掉那一座：shapePick 不能繼續指著那個索引，
     不然「指定要蓋的」會悄悄變成剛好遞補上來的別座。 */
  ok('刪掉正在指定的那一座，會退回「隨機」而不是指向別座',
     impDel.pick === -1, 'shapePick = ' + impDel.pick);

  /* ── 撞名自動加編號（v1.111）──────────────────────────
     以前撞到內建或 blueprints/ 的名字會被退回來、叫人「改個 name 再貼」，而那個 name 是
     AI 寫在程式裡的，要改就得回頭翻那段程式。更麻煩的是開場載入：撞名的那一份會整份被
     擋掉、只留一行 console.warn——「程式更新後多了同名的內建」就是這樣把人家匯進來的
     那一座弄消失的。 */
  const impRename = await gp.evaluate(src => {
    document.getElementById('impPaste').value = src;
    document.getElementById('impGo').click();
    const i = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    return { msg: document.getElementById('impMsg').textContent,
             good: document.getElementById('impMsg').className.indexOf('good') >= 0,
             rows: [...document.querySelectorAll('#impList .it b')].map(b => b.textContent),
             builtin: SHAPES.filter(s => s.n === '吉薩金字塔').length,
             mine: SHAPES.filter(s => s.n === '吉薩金字塔2').length,
             stillBuiltin: i >= 0 && !SHAPES[i].custom };
  }, '// 檔名：我的金字塔.js\n' + SAMPLE.replace("name: '貼上來的小屋'", "name: '吉薩金字塔'"));
  ok('匯入撞到內建名字的藍圖：自動加編號，內建那座不動',
     impRename.good && impRename.builtin === 1 && impRename.mine === 1 &&
     impRename.stillBuiltin && impRename.rows.join(',') === '吉薩金字塔2' &&
     impRename.msg.indexOf('原名') > 0,
     impRename.msg);

  /* 改一版再匯一次。SHAPES 那邊是共用邏輯（預覽頁那段測過），但「清單一列一筆」與
     存檔那份是遊戲自己的碼，也不能多一列——不然清單會有一列指到已經被蓋掉的那座。 */
  const impRename2 = await gp.evaluate(src => {
    document.getElementById('impPaste').value = src;
    document.getElementById('impGo').click();
    return { rows: [...document.querySelectorAll('#impList .it b')].map(b => b.textContent),
             mine: SHAPES.filter(s => s.n === '吉薩金字塔2').length,
             shapes: SHAPES.length,
             saved: JSON.parse(localStorage.getItem('block-builders/bp1') || '[]')
                      .map(e => e.names.join('、')) };
  }, '// 檔名：我的金字塔.js\n' +
     SAMPLE.replace("name: '貼上來的小屋'", "name: '吉薩金字塔'").replace("'#4a5a68'", "'#3a6fc0'"));
  ok('撞名的那一份改一版再匯一次：清單與存檔都還是一列',
     impRename2.rows.join(',') === '吉薩金字塔2' && impRename2.mine === 1 &&
     impRename2.shapes === impUi.shapes + 1 && impRename2.saved.join(',') === '吉薩金字塔2',
     '清單 ' + impRename2.rows.length + ' 列（' + impRename2.rows.join('、') +
     '）、存檔 ' + impRename2.saved.length + ' 筆（' + impRename2.saved.join('、') + '）');

  /* 存檔裡存的是原始碼，name 還是「吉薩金字塔」（改名只發生在載入的那一刻，
     不去動人家的程式），所以重開一次頁面就等於「更新後多了同名內建」那個情境。 */
  await gp.reload();
  await gp.waitForFunction(() => typeof bp !== 'undefined' && bp);
  const impMigrate = await gp.evaluate(() => {
    document.getElementById('impBtn').click();
    return { rows: [...document.querySelectorAll('#impList .it b')].map(b => b.textContent),
             builtin: SHAPES.filter(s => s.n === '吉薩金字塔').length,
             mine: SHAPES.filter(s => s.n === '吉薩金字塔2').length,
             shapes: SHAPES.length,
             inMenu: [...document.getElementById('shape').options]
                       .map(o => o.textContent).indexOf('吉薩金字塔2') };
  });
  ok('程式更新後多了同名的內建：匯進來的那一座改名留下來，不會整份消失',
     impMigrate.rows.join(',') === '吉薩金字塔2' && impMigrate.builtin === 1 &&
     impMigrate.mine === 1 && impMigrate.shapes === impUi.shapes + 1 &&
     impMigrate.inMenu === 1 + CUSTOM_COUNT,
     '清單「' + impMigrate.rows.join('、') + '」，下拉第 ' + impMigrate.inMenu +
     ' 項，共 ' + impMigrate.shapes + ' 座');
  // 收乾淨，不要留給後面「存檔搬家」那一段
  await gp.evaluate(() => {
    const del = document.querySelector('#impList [data-del="0"]');
    if (del) del.click();
    localStorage.removeItem('block-builders/bp1');
  });

  /* ── 存檔搬家（v1.63）─────────────────────────────────
     紀錄平常只活在這台電腦的 localStorage 裡，換電腦就沒了。成就頁多了匯出／匯入：
     匯出下載一份檔案、匯入**直接覆蓋**（使用者指定，不合併也不問「確定嗎」）。
     跟匯入建築同一個分頁跑：兩邊都會動 localStorage，混進主分頁會影響後面的測試。 */
  const svSet = await gp.evaluate(() => {
    // 上一段的「匯入建築」還開著，兩個都是滿版的遮罩：不關掉的話點不到成就頁的按鈕
    document.getElementById('impClose').click();
    stats.destroyed = 7; stats.smashed = 12345; stats.carried = 88;
    stats.badges = BADGES.slice(0, 3).map(b => b.id);
    stats.tools = TOOLS.slice(0, 4).map(t => t.id);
    pref.cnt = 9000; pref.wk = 60; pref.spd = 4;
    save();
    document.getElementById('badgeBtn').click();
    return { on: document.getElementById('badgeWrap').classList.contains('on'),
             btns: ['saveOut', 'saveIn'].map(id => !!document.getElementById(id)) };
  });
  ok('成就頁上有匯出／匯入存檔', svSet.on && svSet.btns.every(Boolean),
     '面板開著、兩顆按鈕都在');

  const [svDl] = await Promise.all([
    gp.waitForEvent('download'),
    gp.click('#saveOut')
  ]);
  const svPath = path.join(OUT, 'save-export.txt');
  await svDl.saveAs(svPath);
  const svText = fs.readFileSync(svPath, 'utf8');
  const svLines = svText.split(/\r?\n/).filter(l => l.trim());
  ok('按「匯出存檔」下載得到一份存檔檔案',
     /^積木小人-存檔-\d{8}\.txt$/.test(svDl.suggestedFilename()) &&
     svLines[0].indexOf('積木小人') === 0 && svLines.length === 4,
     '檔名「' + svDl.suggestedFilename() + '」，' + svLines.length + ' 行（3 行抬頭 + 1 行本體）');
  /* 存檔本體要跟 localStorage 裡那一份逐字相同：另外編一種格式的話，
     同一份東西就有兩套解析要維護，遲早有一邊沒跟上。 */
  const svSame = await gp.evaluate(() => localStorage.getItem(SAVE_KEY));
  ok('檔案裡那一行就是 localStorage 裡的那一份',
     svLines[svLines.length - 1] === svSame,
     '本體 ' + svLines[svLines.length - 1].length + ' 字，跟 localStorage 的 ' +
     (svSame || '').length + ' 字' + (svLines[svLines.length - 1] === svSame ? '一致' : '不一致'));

  // 先把紀錄弄成另一個樣子，才看得出匯入到底有沒有蓋過去
  await gp.evaluate(() => {
    stats = freshStats(); pref = freshPref(); pref.cnt = 1800; pref.wk = 20;
    save(); renderBadges(); renderTools(); syncHud(); applyPref();
  });
  await gp.setInputFiles('#saveFile', svPath);
  /* 等訊息真的出現，不要用固定的 300 毫秒（v1.148.1）：讀檔走的是 FileReader 的
     非同步回呼，機器頓一下就還沒回來——整輪測試踩到過一次，`saveMsg` 是空的，
     接著相依的五條全跟著紅（讀不進來 → 紀錄沒被蓋掉 → 設定沒帶回來 → …）。 */
  await gp.waitForFunction(() => document.getElementById('saveMsg').textContent.trim() !== '',
                           null, { timeout: 5000 });
  const svIn = await gp.evaluate(() => ({
    d: stats.destroyed, s: stats.smashed, c: stats.carried,
    b: stats.badges.length, t: stats.tools.length,
    cnt: pref.cnt, wk: pref.wk, spd: pref.spd,
    live: { cnt: targetCnt, spd: timeScale, wk: workers.length },
    msg: document.getElementById('saveMsg').textContent,
    good: document.getElementById('saveMsg').className.indexOf('good') >= 0,
    stored: localStorage.getItem(SAVE_KEY),
    badgeN: document.getElementById('badgeN').textContent
  }));
  ok('匯入存檔直接蓋掉現在的紀錄',
     svIn.d === 7 && svIn.s === 12345 && svIn.c === 88 && svIn.b === 3 && svIn.t === 4 && svIn.good,
     '拆掉 ' + svIn.d + ' 座、擊飛 ' + svIn.s + ' 塊、' + svIn.b + ' 個成就（訊息：' +
     svIn.msg.slice(0, 24) + '…）');
  /* 設定也要跟著回來，而且要**立刻**套到跑的那一份上（applyPref），
     不然玩家看到成就數字變了、建材與速度卻還是舊的，要重開才生效。 */
  ok('連設定一起帶回來，而且當場就生效',
     svIn.cnt === 9000 && svIn.wk === 60 && svIn.spd === 4 &&
     svIn.live.cnt === 9000 && svIn.live.spd === 4 && svIn.live.wk === 60,
     '建材 ' + svIn.live.cnt + '、小人 ' + svIn.live.wk + '、速度 ' + svIn.live.spd + '×');
  ok('匯進來的也存回這台電腦，關掉再開還在',
     svIn.stored === svSame, '存回去的跟匯出的' + (svIn.stored === svSame ? '一致' : '不一致'));
  ok('成就頁的數字當場就換過來', svIn.badgeN.indexOf('3 /') === 0,
     '已解鎖 ' + svIn.badgeN);

  /* 讀壞掉的檔案要原封不動：先解包驗過校驗碼才動 stats，
     不然讀到一半失敗就等於把紀錄弄丟了——那是使用者最不能接受的失敗。 */
  const svBadPath = path.join(OUT, 'save-bad.txt');
  fs.writeFileSync(svBadPath, '積木小人 · 存檔\n\nZm9vYmFyLW5vdC1hLXNhdmU=\n', 'utf8');
  await gp.setInputFiles('#saveFile', svBadPath);
  /* 同上：等那一則「這不是存檔」的訊息真的換上去（上一則是匯入成功的訊息，
     所以等的是「內容變了」，不是「非空」）。 */
  await gp.waitForFunction(m => document.getElementById('saveMsg').textContent !== m,
                           svIn.msg, { timeout: 5000 });
  const svBad = await gp.evaluate(() => ({
    d: stats.destroyed, s: stats.smashed,
    msg: document.getElementById('saveMsg').textContent,
    bad: document.getElementById('saveMsg').className.indexOf('bad') >= 0
  }));
  ok('讀到不是存檔的檔案：擋下來並且不動現有紀錄',
     svBad.bad && svBad.d === 7 && svBad.s === 12345,
     '訊息「' + svBad.msg + '」，紀錄仍是拆掉 ' + svBad.d + ' 座、擊飛 ' + svBad.s + ' 塊');

  ok('匯入建築整段跑完沒有 console 錯誤', impErr.length === 0, impErr.join(' / ') || '乾淨');
  await gp.close();

  /* 金門大橋：跨距是奇數時 −L/2 是 .5，整條橋的 x 都變半格，
     吊索那行的 `x % 3 === 0` 永遠不成立 → 那個尺度整座橋沒有吊索，
     塊數比小一號的還少。修法是用整數半跨跑迴圈。 */
  const bridge = await page.evaluate(() => {
    const sh = SHAPES.find(s => s.n === '金門大橋');
    const cnt = [];
    for (let s = 40; s <= 78; s += 2) cnt.push(genCells(sh, s).m.size);
    let drops = 0;
    for (let i = 1; i < cnt.length; i++) if (cnt[i] < cnt[i - 1]) drops++;
    return { cnt, drops };
  });
  ok('金門大橋每個尺度都吊得出吊索（塊數不會忽然掉一截）', bridge.drops === 0,
     '尺度 40→78：' + bridge.cnt.slice(0, 3).join(',') + ' … ' + bridge.cnt.slice(-3).join(',') +
     '（' + bridge.drops + ' 處往下掉）');

  const variety = await page.evaluate(() => {
    shapePick = -1; const seen = [];
    for (let i = 0; i < 12; i++) { startBuild(true); seen.push(bp.name); }
    return { seen, uniq: new Set(seen).size };
  });
  ok('隨機換建築不會一直重複', variety.uniq >= 9, '連續 12 次出現 ' + variety.uniq + ' 種');

  /* ══════════ 小人施工 ══════════ */
  await head('小人施工');
  await reset(page, { shape: '吉薩金字塔', cnt: 400, workers: 16, scale: 1 });
  const b0 = await st(page);
  await sim(page, 200);
  const b1 = await st(page);
  ok('小人開始搬運', b1.carry + b1.toss + b1.set > 0,
     '搬 ' + b1.carry + '、拋 ' + b1.toss + '、就位 ' + b1.set);

  /* 每個人身高不一樣，舉東西的高度就得跟著身高走。
     寫死一個高度的話，高個子的積木會陷進自己的安全帽裡——
     這裡驗「積木中心在帽子上方、底面又還碰得到帽子」，兩邊都要。
     1.31 是安全帽頂（engine.js 的 BODY：帽頂 p 1.25 + 高度 0.12 的一半）。 */
  /* 量 60 幀，不是量一瞬間（v1.131 修間歇性失敗）。「此刻手上疊著兩塊」只在
     撿完到砌完之間那一小段成立，只看一幀的話偶爾整場剛好每個人都只領到一塊
     ——實測紅過一次（「最多一次搬 1 塊」）。其餘幾項（陷進頭裡、飄在半空、疊距）
     本來就是每一幀都該成立的，多量幾幀只會更嚴，不會更鬆。 */
  const carry = await page.evaluate(() => {
    const HAT = 1.31;
    let n = 0, sunk = 0, float = 0, gap = 0, lo = Infinity, hi = -Infinity, most = 0;
    for (let f = 0; f < 60; f++) {
      for (const w of workers) {
        if (!w.carry) continue;
        // 一趟可以搬好幾塊（v1.60）：整疊由下往上檢查
        const held = w.load.map(j => blocks[j.b]).filter(b => b && b.st === 1);
        if (!held.length) continue;
        const head = HAT * w.scale;
        n++;
        if (held.length > most) most = held.length;
        if (held[0].y <= head) sunk++;                 // 最底下那塊陷進頭裡
        if (held[0].y - HB > head) float++;            // 最底下那塊飄在半空
        // 其餘是疊在前一塊上面的，間距要剛好一格（跟建築上的疊法一樣）
        for (let k = 1; k < held.length; k++)
          if (Math.abs(held[k].y - held[k - 1].y - 1) > 1e-6) gap++;
        // 肌肉小人不算進身高範圍：他整個人再乘 MUS_SIZE（v1.113），下面另外一條量他
        if (w.mus) continue;
        if (w.scale < lo) lo = w.scale;
        if (w.scale > hi) hi = w.scale;
      }
      step(0.05);
    }
    return { n, sunk, float, gap, most, lo: +lo.toFixed(2), hi: +hi.toFixed(2) };
  });
  ok('搬運中的積木架在頭頂上，不會陷進去也不會飄著',
     carry.n > 0 && carry.sunk === 0 && carry.float === 0,
     '三秒內 ' + carry.n + ' 人-幀在搬運，陷入 ' + carry.sunk + '、飄浮 ' + carry.float +
     '；身高 ' + carry.lo + '–' + carry.hi);
  ok('搬好幾塊時是一疊，一格一格往上疊',
     carry.most > 1 && carry.gap === 0,
     '三秒內最多一次搬 ' + carry.most + ' 塊，疊距不是 1 格的有 ' + carry.gap + ' 處');

  /* ── 一趟搬幾塊（v1.60）────────────────────────────────
     以前一個人一次只搬一塊，四段路只換到一塊積木。現在一次領 1～3 塊，
     幾塊看個子、而且是常態分布——照身高線性換算的話三種各佔三分之一，
     看起來像刻意分成三組。 */
  const capDist = await page.evaluate(() => {
    const hist = [0, 0, 0, 0], small = [0, 0, 0, 0], big = [0, 0, 0, 0];
    const mid = (W_LO + W_HI) / 2;
    for (let i = 0; i < 4000; i++) {
      const w = newWorker(0);
      hist[w.cap]++;
      (w.scale < mid ? small : big)[w.cap]++;
    }
    const avg = h => (h[1] + h[2] * 2 + h[3] * 3) / (h[1] + h[2] + h[3]);
    return { hist, lo: +avg(small).toFixed(2), hi: +avg(big).toFixed(2),
             out: hist[0] + hist.slice(4).length };
  });
  ok('一趟搬 1～3 塊，多數人搬 2 塊（常態分布）',
     capDist.out === 0 && capDist.hist[2] > capDist.hist[1] * 1.8 &&
     capDist.hist[2] > capDist.hist[3] * 1.8 && capDist.hist[1] > 200 && capDist.hist[3] > 200,
     '4000 個人：1 塊 ' + capDist.hist[1] + '、2 塊 ' + capDist.hist[2] +
     '、3 塊 ' + capDist.hist[3] + '（超出 1–3 的 ' + capDist.out + ' 人）');
  ok('個子大的搬得多', capDist.hi - capDist.lo > 0.3,
     '矮的平均 ' + capDist.lo + ' 塊、高的平均 ' + capDist.hi + ' 塊');

  /* 「去尋找積木拿滿 再去建造」：切到 build 的那一刻，工作單上每一塊都要已經在手上。
     少一塊就代表他還沒撿完就往工地走了。 */
  const full = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '新天鵝堡');
    targetCnt = 3000; setWorkerCount(20); startBuild(true);
    const was = workers.map(w => w.st);
    let trips = 0, notFull = 0, best = 0;
    const capUsed = [0, 0, 0, 0];
    for (let i = 0; i < 2000 && phase === 'build'; i++) {
      step(0.05);
      for (let k = 0; k < workers.length; k++) {
        const w = workers[k];
        if (w.st === 'build' && was[k] === 'pick') {          // 剛撿完要回工地那一幀
          trips++;
          const held = w.load.filter(j => blocks[j.b].st === 1).length;
          if (held !== w.load.length) notFull++;
          if (held > best) best = held;
          capUsed[Math.min(3, held)]++;
        }
        was[k] = w.st;
      }
    }
    return { trips, notFull, best, capUsed };
  });
  ok('拿滿了才回工地建造', full.trips > 50 && full.notFull === 0 && full.best > 1,
     full.trips + ' 趟裡沒拿滿就走的 ' + full.notFull + ' 趟；一趟最多帶了 ' + full.best +
     ' 塊（1／2／3 塊各 ' + full.capUsed.slice(1).join('／') + ' 趟）');

  /* 到了第一格的站位就**原地**把手上的丟完（v1.60.1）：一趟三塊卻要跑三次站位的話，
     那三段路比省下來的還多。代價是後面那幾發拋得比較遠（下面一起量）。 */
  const relay = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '新天鵝堡');
    targetCnt = 3000; setWorkerCount(20); startBuild(true);
    const prev = new Map(), seenArc = new Set(), stuck = new Set();
    let pairs = 0, moved = 0, far = 0, farStuck = 0, maxD = 0;
    const dist = [];
    for (let i = 0; i < 1500 && phase === 'build'; i++) {
      const was = workers.map(w => w.load.length);
      step(0.05);
      // 站的地方被別人補起來了：build 那段會重挑站位再走過去，那是唯一該移動的路徑
      for (const w of workers)
        if (w.st === 'build' && footBlocked(w.x, w.z)) stuck.add(w);
      for (let k = 0; k < workers.length; k++) {
        const w = workers[k];
        if (w.load.length !== was[k] - 1) {            // 這一幀沒丟東西
          if (w.load.length > was[k]) prev.delete(w);  // 領了新的一趟：重新算
          continue;
        }
        const p = prev.get(w);
        if (p && p.n === was[k]) {                     // 同一趟接著丟的下一發
          pairs++;
          const d = Math.hypot(w.x - p.x, w.z - p.z);
          if (d > 0.01) moved++;
          if (d > 1) { far++; if (stuck.has(w)) farStuck++; }   // 走了一格以上
          maxD = Math.max(maxD, d);
        }
        prev.set(w, { x: w.x, z: w.z, n: w.load.length });
        stuck.delete(w);
      }
      /* 每一發拋擲都是一個新的 arc 物件，拿它當「這發看過了沒」的鑰匙。
         魔法師隔空拋的（arc.mage）與肌肉小人就地扔的（arc.hurl，v1.112）要濾掉：
         這一條量的是「工人原地連丟拋多遠」，那兩種本來就是從料堆那裡直接飛過來的，
         混進來會把中位數整個拉高。 */
      for (const b of blocks) {
        if (b.st !== 2 || !b.arc || b.arc.mage || b.arc.hurl || seenArc.has(b.arc)) continue;
        seenArc.add(b.arc);
        dist.push(Math.hypot(b.arc.x1 - b.arc.x0, b.arc.z1 - b.arc.z0));
      }
    }
    dist.sort((a, b) => a - b);
    const q = p => +dist[Math.floor(dist.length * p)].toFixed(1);
    return { pairs, moved, far, farStuck, maxD: +maxD.toFixed(2),
             n: dist.length, p50: q(0.5), p95: q(0.95), max: +dist[dist.length - 1].toFixed(1) };
  });
  /* 會移動的只剩一種：站的地方被別人補起來了（`footBlocked`），那時本來就得重挑站位——
     不重挑的話他會從牆裡把積木丟出去。所以這條驗「移動的都是被埋的那些」。 */
  ok('一趟的第二、三塊原地丟完，不會再走去下一格的站位',
     relay.pairs > 30 && relay.far === relay.farStuck && relay.far < relay.pairs * 0.15,
     relay.pairs + ' 次「接著丟下一塊」裡，站著沒動的 ' + (relay.pairs - relay.far) +
     ' 次、被埋了才重挑站位的 ' + relay.far + ' 次（其中站的地方真的被補起來的 ' +
     relay.farStuck + ' 次，最多挪了 ' + relay.maxD + ' 格）');
  /* 原地連丟換來的代價：後面那幾發是從第一格的站位丟出去的，會比 TOSS_MAX 遠。
     這一條不是要它變小，是要它**別失控**——拋物線本身有測試守著不會穿牆。 */
  ok('原地連丟的拋擲距離仍在場地尺度內',
     relay.max < 45 && relay.p50 < 8,
     relay.n + ' 發：中位 ' + relay.p50 + '、p95 ' + relay.p95 + '、最遠 ' + relay.max +
     '（每格都走過去的話是中位 1.4／p95 11.5／最遠 14.6）');

  /* ── 派到的格子在哪（v1.65）────────────────────────────
     findSlot 以前照藍圖順序派，誰來領都給游標那一格。藍圖是先照高度排、同高再照
     離中心遠近，所以同一圈的格子在角度上是亂的：工人撿完腳邊的料，格子平均在
     四分之一圈外，只能沿外圈繞過去（實測整趟 8.7 秒有 3 秒在繞）。
     現在從游標往後 SLOT_NEAR 個候選裡挑離他最近的。
     門檻取自對照量測（中世紀城堡（v1.66 換掉的那份）／吉薩金字塔／台北 101／聖家堂 四座）：
     照順序派 建材與格子的方位角差中位數 81–92 度、每趟 5.8–8.7 秒；
     挑最近的 14–17 度、2.7–3.3 秒。 */
  const slotNear = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '新天鵝堡');
    targetCnt = 3000; setWorkerCount(20); startBuild(true);
    const TAU = Math.PI * 2;
    const fold = a => ((((a) % TAU) + TAU + Math.PI) % TAU) - Math.PI;
    const deg = [], dur = [];
    const t0 = new Map();
    for (let i = 0; i < 1500 && phase === 'build'; i++) {
      const was = workers.map(w => w.st);
      step(0.05);
      for (let k = 0; k < workers.length; k++) {
        const w = workers[k];
        if (w.eng || w.mage) continue;                 // 工程師不搬、魔法師隔空拋，不走這段路
        if (was[k] === 'idle' && w.st === 'pick' && w.load.length) {
          const b = blocks[w.load[0].b], s = bp.slots[w.load[0].s];
          deg.push(Math.abs(fold(Math.atan2(s.z, s.x) - Math.atan2(b.z, b.x))) * 180 / Math.PI);
          t0.set(k, i * 0.05);
        }
        if (was[k] !== 'idle' && w.st === 'idle' && t0.has(k)) {
          dur.push(i * 0.05 - t0.get(k)); t0.delete(k);
        }
      }
    }
    deg.sort((a, b) => a - b);
    const q = p => +deg[Math.min(deg.length - 1, Math.floor(deg.length * p))].toFixed(1);
    return { n: deg.length, med: deg.length ? q(0.5) : -1, p90: deg.length ? q(0.9) : -1,
             trips: dur.length,
             dur: dur.length ? +(dur.reduce((a, b) => a + b, 0) / dur.length).toFixed(2) : -1 };
  });
  ok('派到的格子就在他腳邊，不會叫他繞到工地對面',
     slotNear.n > 100 && slotNear.med < 45 && slotNear.dur > 0 && slotNear.dur < 5,
     slotNear.n + ' 趟：建材與格子的方位角差中位 ' + slotNear.med + '°、p90 ' +
     slotNear.p90 + '°，整趟平均 ' + slotNear.dur +
     ' 秒（照藍圖順序派是 81–92°／5.8–8.7 秒）');

  /* ── 繞路的腳程（v1.60）────────────────────────────────
     ringWalk 是「繞開建築」「進場慶祝」共用的走法。舊版把「轉角度」跟「收半徑」
     各給滿一份 WALK×dt，而且角度那份是拿目標半徑換算的——站得比那個圈遠的人
     弧速直接爆掉。這裡拿舊版的算式當對照組，量的是每一幀真的走了幾倍腳程。 */
  const ringSpd = await page.evaluate(() => {
    const oldRing = (w, ta, rad, dt) => {                     // 舊版（v1.59）的算式
      const cr = Math.hypot(w.x, w.z);
      const ca = cr < 0.001 ? ta : Math.atan2(w.z, w.x);
      const TAU = Math.PI * 2;
      const dA = ((((ta - ca) % TAU) + TAU + Math.PI) % TAU) - Math.PI;
      const maxA = WALK * dt / Math.max(rad, 1), maxR = WALK * dt;
      const dr = rad - cr;
      const na = ca + clamp(dA, -maxA, maxA), nr = cr + clamp(dr, -maxR, maxR);
      w.x = Math.cos(na) * nr; w.z = Math.sin(na) * nr;
      return Math.abs(dA) <= maxA && Math.abs(dr) <= maxR;
    };
    const run = (fn, cr, rad, ta) => {
      const w = newWorker(0);
      w.x = cr; w.z = 0; w.y = 0; w.a = 0; w.gait = 0;
      let worst = 0;
      const dt = 1 / 60;
      for (let i = 0; i < 3000; i++) {
        const px = w.x, pz = w.z;
        const done = fn(w, ta, rad, dt);
        worst = Math.max(worst, Math.hypot(w.x - px, w.z - pz) / dt / WALK);
        if (done) break;
      }
      return +worst.toFixed(2);
    };
    // 站在圈上／圈內／圈外三種路況，都要以正常腳程走
    const cases = [[20, 8, Math.PI], [4, 12, Math.PI], [12, 12, Math.PI], [30, 12, 0.6]];
    return cases.map(c => ({ cr: c[0], rad: c[1],
                             old: run(oldRing, c[0], c[1], c[2]), now: run(ringWalk, c[0], c[1], c[2]) }));
  });
  // 1.02 的餘裕給極座標的近似：腳程是用「弧長 + 徑向」估的，實際位移是弦，兩者差 1% 上下
  ok('繞路的速度跟平常走路一樣快',
     ringSpd.every(r => r.now <= 1.02) && Math.max(...ringSpd.map(r => r.old)) > 1.4,
     ringSpd.map(r => '半徑 ' + r.cr + '→' + r.rad + '：' + r.old + ' → ' + r.now).join('　') +
     '（倍，1 = 正常腳程）');

  /* v1.51 整體放大 1.5 倍：之前遠鏡頭下只剩一撮色點，數不出幾個人、
     也看不出誰頭上頂著積木。模型腳底到帽頂 1.31，乘上個體身高要落在兩塊多積木。 */
  ok('小人有兩塊多積木高', 1.31 * carry.lo > 2 && 1.31 * carry.hi < 2.6,
     '身高 ' + (1.31 * carry.lo).toFixed(2) + '–' + (1.31 * carry.hi).toFixed(2) +
     ' 格（積木邊長 0.94、格距 1）');

  /* 放大之後那七塊方塊就是一疊方塊，所以補了臉、鞋、腰帶。
     這裡不看像不像，只驗「該有的部位真的擺在該在的位置」——
     部位漏掉或位置寫錯（例如鞋子留在原地不跟腿走）從畫面上不一定看得出來。 */
  const build = await page.evaluate(() => {
    const pose = extra => {
      const w = workers[1];
      Object.assign(w, { x: 0, y: 0, z: 0, a: 0, gait: 0, ph: 0, carry: false, plan: 0,
                         bub: 0, talk: 0, point: 0, hail: 0, fall: 0, tilt: 0, roll: 0,
                         dig: 0 }, extra);
      ENG.putWorker(1, w);
      const m = new THREE.Matrix4(), v = new THREE.Vector3(), out = [];
      for (let k = 0; k < ENG.WPARTS; k++) {
        ENG.three.workerMesh.getMatrixAt(ENG.WPARTS + k, m);
        if (m.elements[0] === 0 && m.elements[5] === 0) continue;   // 沒拿的道具縮成 0
        v.setFromMatrixPosition(m);
        out.push({ x: v.x, y: v.y, z: v.z });
      }
      return { s: w.scale, parts: out.sort((p, q) => p.y - q.y) };
    };
    const st = pose({});
    const s = st.s;
    // 臉朝 +z（a=0）：眼睛要凸出臉皮、左右對稱；帽舌要更往前而且在帽子的高度
    const eyes = st.parts.filter(p => Math.abs(p.y - 1.06 * s) < 0.03 * s &&
                                      p.z > 0.19 * s && Math.abs(p.x) > 0.05 * s);
    const peak = st.parts.filter(p => p.z > 0.28 * s && p.y > 1.1 * s);
    // 由低到高：最低兩塊是鞋、再上去兩塊是腿
    const lowest = st.parts.slice(0, 4);
    // 走路時鞋要跟著同一隻腿往同一邊擺，而且擺得比腿更遠（它離髖關節更遠）
    const wk = pose({ gait: 1, ph: Math.PI / 2 });
    const low = wk.parts.slice(0, 4);
    const shoeL = low.slice(0, 2).find(p => p.x < 0), shoeR = low.slice(0, 2).find(p => p.x > 0);
    const legL = low.slice(2, 4).find(p => p.x < 0), legR = low.slice(2, 4).find(p => p.x > 0);
    const same = shoeL && legL && shoeR && legR &&
                 shoeL.z * legL.z > 0 && shoeR.z * legR.z > 0;
    return { n: st.parts.length, parts: ENG.WPARTS, s: +s.toFixed(2),
             eyes: eyes.length, sym: eyes.length === 2 ? +(eyes[0].x + eyes[1].x).toFixed(3) : 9,
             peak: peak.length, shoeY: +(lowest[1].y / s).toFixed(2), legY: +(lowest[3].y / s).toFixed(2),
             same, far: same ? +(Math.abs(shoeL.z) - Math.abs(legL.z)).toFixed(3) : -1 };
  });
  ok('臉上有兩顆對稱的眼睛、帽子有帽舌、腳上有鞋',
     build.eyes === 2 && Math.abs(build.sym) < 1e-6 && build.peak === 1 &&
     build.shoeY < 0.12 && build.legY > 0.15,
     build.parts + ' 塊部位畫了 ' + build.n + ' 塊（其餘是沒拿的道具）；鞋在 y=' +
     build.shoeY + '、腿在 y=' + build.legY);
  ok('走路時鞋跟著同一隻腿擺，而且擺得比腿更遠',
     build.same && build.far > 0.05,
     '鞋比腿多往前 ' + build.far + '（鞋離髖 0.36、腿離髖 0.21）');
  /* ── 不從蓋好的部分中間穿過去（v1.52）────────────────────────
     以前 pick／build 是兩點拉直線、站位只往外推 1.3 格，於是搬積木的人整趟都在
     建築裡面走，站位還常常落在牆裡（舊版實測：城堡 32%、聖母院 42% 的人-幀在牆裡）。
     三件事一起改：站位退到外緣、路線繞開、拋物線跨過中間的牆。
     這裡量的是「人-幀」與「拋出去的積木有沒有從牆裡穿過去」。 */
  const route = await page.evaluate(() => {
    const run = name => {
      /* 前面那些測試留在場上的道具／火／預告會把這裡量到的數字往上推（人被掀飛、
         逃命的人從建築中間穿過去都算進「在牆裡」）。這一條要量的是「正常施工的走法」，
         所以先清乾淨——量出來才跟單獨跑的時候對得起來。 */
      cleanTools();
      shapePick = SHAPES.findIndex(s => s.n === name);
      targetCnt = 3000; setWorkerCount(20); startBuild(true);
      let frames = 0, inWall = 0, arcs = 0, arcHit = 0, samples = 0, atOnce = 0;
      // 分三種人各自算（v1.113）：平均值會把「誰在穿牆」藏起來，見下面那條 ok
      const kn = { h: 0, m: 0, w: 0 }, kh = { h: 0, m: 0, w: 0 };
      const seen = new Set();
      for (let i = 0; i < 2400 && phase !== 'done'; i++) {
        step(0.05);
        if (i % 4 === 0) {
          samples++;
          for (const w of workers) {
            // 腳邊那兩層有已就位的積木 = 人卡在建築裡
            const bad = blockAt(w.x, HB, w.z) || blockAt(w.x, 1 + HB, w.z);
            if (bad) atOnce++;                      // 全場（含閒晃的）：畫面上同時有幾個
            if (w.st !== 'pick' && w.st !== 'build' && w.st !== 'wait') continue;
            frames++;
            if (bad) inWall++;
          }
        }
        for (const b of blocks) {
          if (b.st !== 2 || !b.arc || seen.has(b)) continue;
          seen.add(b); arcs++;
          const a = b.arc;
          const kind = a.hurl ? 'h' : a.mage ? 'm' : 'w';
          kn[kind]++;
          for (let k = 5; k < 37; k++) {          // 掐頭去尾：出手與落點本來就貼著積木
            const u = k / 40;
            const y = a.y0 + (a.y1 - a.y0) * u + Math.sin(u * Math.PI) * a.peak;
            if (blockAt(a.x0 + (a.x1 - a.x0) * u, y, a.z0 + (a.z1 - a.z0) * u)) {
              arcHit++; kh[kind]++; break;
            }
          }
        }
      }
      const pct = k => +(kh[k] / Math.max(1, kn[k]) * 100).toFixed(2);
      return { name, placed: placedCnt, wk: workers.length,
               inWall: +(inWall / Math.max(1, frames) * 100).toFixed(2),
               atOnce: +(atOnce / Math.max(1, samples)).toFixed(2),
               arc: +(arcHit / Math.max(1, arcs) * 100).toFixed(2),
               arcH: pct('h'), arcM: pct('m'), arcW: pct('w'),
               nH: kn.h, nM: kn.m, nW: kn.w };
    };
    return ['新天鵝堡', '巴黎聖母院'].map(run);
  });
  /* 門檻 v1.65 從 8% 放到 18%，另外補一條「同一瞬間幾個人」。原因：
     派工改成挑最近的格子之後同樣時間蓋兩倍的塊數，而這個百分比的**分母**是工作幀——
     不再有大量「走去對面」的路程幀可以稀釋，比例就跟著跳。
     「每塊建材進了幾次牆」幾乎沒變（0.33 → 0.37 次／塊），但同一瞬間站在牆裡的人
     從 0.8 個變成約 2 個（20 人），所以另外用絕對人數守著它別再往上跑。
     v1.66 又放寬一次（18% → 28%、3.5 → 5 人）：城堡那一格換成新天鵝堡，
     那座圍出一圈中庭，走進牆裡的機會本來就比舊城堡多。
     單獨跑三輪：新天鵝堡 16.9／19.4／16.6%（同時 2.8／3.2／2.8 人）、
     聖母院 6.3／5.6／5.9%。整套測試裡量到 24.3%（同時 4.0 人）——比單獨跑高一截，
     因為前面的測試會把碎料留在工地裡面（同樣 2400 幀只放上去 1062 塊，
     單獨跑是 1264～1528），撿那些料就得走進牆裡。門檻留在 28%／5 人。
     這個數字一路往上是有帳可查的：v1.52 的 3.4% → v1.64 的 5.5% →
     v1.65 派工改挑最近的格子（同樣時間蓋兩倍，繞路的幀不再稀釋比例）→
     v1.66 換上更封閉的城堡。真要壓回去得做「從缺口進出」的路徑規劃。
     試過讓小人避開「躺在建築裡面、要穿牆才拿得到」的料（在牆裡的人-幀掉到 1–3%），
     但那些料是必要建材：實測有一輪 65% 的人-幀領不到工作、200 秒只蓋 972 塊（對照 2396）。
     所以這裡是接受代價，不是漏掉。 */
  ok('施工中不會有人在蓋好的積木裡走動',
     route.every(r => r.inWall < 28 && r.atOnce < 5),
     route.map(r => r.name + ' ' + r.inWall + '%（同時 ' + r.atOnce + ' 人／共 ' +
                    r.wk + ' 人、放上去 ' + r.placed + ' 塊）').join('、') +
     '（舊版 32%／42%）');
  /* v1.113 起分三種人各自守著，不看平均。原因：肌肉小人（v1.112）讓工地快了兩三倍，
     同樣 2400 幀裡建築長得更高，而**工人那些貼著牆的短拋**本來就最容易擦到——
     於是平均值跟著往上跑（聖母院 4.1% → 6.5%），但那不是新的穿牆，是舊的那種變多。
     分開量就看得清楚：擦到的那一小段都在出手後不久（樣本清一色 u≈0.15～0.30）。
     為什麼壓不下去：`arcPeak` 只算「從地面連續疊上來」的柱子，挑出去的樓板／飛扶壁不算
     （那些本來就是從底下穿過去的），聖母院正好滿是那種東西。
     真要壓回去得做從缺口進出的路徑規劃——跟上面那條「在牆裡走動」同一筆帳。

     門檻 v1.114 照量的重訂（v1.113 只跑了三輪就把魔法師與肌肉小人訂在 3%，樣本太少）：
     聖母院單獨跑四輪 → 工人 10.1／11.3／13.7／11.5%、肌肉小人 0／12.4／3.3／11.8%、
     魔法師 1.2／1.9／0.4／3.9%。肌肉小人跟工人同一個量級不是新問題——他在建築裡撿到料
     就在裡面出手（`walledIn` 只是「有外面的就挑外面的」，不是硬擋），那一發跟工人貼著牆
     的短拋是同一種擦到。魔法師低是因為他撿料有距離上限（MAGE_REACH），多半站在建築外面。
     所以工人與肌肉小人守 18%、魔法師守 6%（各自是實測最大值再留幾個百分點）。 */
  ok('拋出去的積木不會從牆裡穿過去（三種人各自算）',
     route.every(r => r.arcW < 18 && r.arcH < 18 && r.arcM < 6),
     route.map(r => r.name + '：工人 ' + r.arcW + '%（' + r.nW + ' 發）、魔法師 ' +
                    r.arcM + '%（' + r.nM + '）、肌肉小人 ' + r.arcH + '%（' + r.nH +
                    '）＝整批 ' + r.arc + '%').join('　') + '（舊版整批 20%／45%）');

  /* 站位本身：拿蓋好的整座來算，每個格子的站位都不該落在積木裡。
     實心造型的正中央退到外緣要超過 TOSS_MAX 格，那種會退回原本的做法（見 standPos）。 */
  const stand = await page.evaluate(() => {
    const run = name => {
      shapePick = SHAPES.findIndex(s => s.n === name);
      targetCnt = 3000; startBuild(true); completeNow();
      let n = 0, bad = 0, out = 0, far = 0, over10 = 0;
      for (const s of bp.slots) {
        if (s.y < 2) continue;                   // 蓋第 0、1 層時周圍還是空地
        n++;
        const p = standPos(s);
        if (footBlocked(p.x, p.z)) bad++;        // 站位在積木裡（＝退不出來的那種）
        const d = Math.hypot(p.x - s.x, p.z - s.z);
        if (d > 1.31) out++;                     // 有退到外緣
        if (d > 14.31) far++;                    // 超過 TOSS_MAX（13）還在退（不該發生）
        if (d > 11.31) over10++;                 // 退得比舊上限（10）還遠：拋得更遠才做得到
      }
      return { name, n, bad: +(bad / n * 100).toFixed(1), out: +(out / n * 100).toFixed(1),
               far, over10 };
    };
    return ['新天鵝堡', '台北 101', '吉薩金字塔'].map(run);
  });
  ok('內部的格子會退到外緣站，退不出來的才照舊走進去',
     stand.every(r => r.bad < 25 && r.out > 25 && r.far === 0),
     stand.map(r => r.name + '：退到外緣 ' + r.out + '%、站位仍在積木裡 ' + r.bad + '%').join('　'));
  /* 拋遠一點（TOSS_MAX 10 → 13，v1.60）：多出來的那三格讓更多內部格子退得出牆外。
     實測退不出來的比例：中世紀城堡（v1.66 換掉的那份） 10% → 3%、吉薩金字塔 18.2% → 4.3%。 */
  ok('拋得更遠之後，退不出來的格子變少',
     stand.some(r => r.over10 > 0) && stand.every(r => r.bad < 6),
     stand.map(r => r.name + '：退超過舊上限的 ' + r.over10 + ' 格、仍在積木裡 ' + r.bad + '%').join('　'));

  await reset(page, { shape: '吉薩金字塔', cnt: 400, workers: 16, scale: 1 });
  await sim(page, 200);
  await sim(page, 900);
  const b2 = await st(page);
  ok('進度持續往上', b2.set > b1.set, b1.set + ' → ' + b2.set + ' / ' + b2.total);
  ok('搬運中的積木不會憑空消失', b2.pool === b0.pool, b0.pool + ' → ' + b2.pool);

  await reset(page, { shape: '吉薩金字塔', cnt: 400, workers: 40, scale: 3 });
  await page.evaluate(() => { for (let i = 0; i < 12000; i++) { step(0.05); if (phase === 'done') break; } });
  const done = await st(page);
  ok('會蓋到完工', done.phase === 'done' && done.placed === done.total,
     done.placed + ' / ' + done.total + '，phase=' + done.phase);
  ok('完工後沒有積木卡在半路', done.carry === 0 && done.toss === 0,
     '搬 ' + done.carry + '、拋 ' + done.toss);
  await page.screenshot({ path: path.join(OUT, '02-完工.png') });

  await probeWorkers(page, '小人施工後');

  /* 工作單第二筆中途被收掉（v1.146.2）。`case 'pick'` 開頭那道 `!b`
     只看得到「這一幀 w.li 指到的那一筆」，而第二筆是他走去撿第一塊的那段路上
     才被 `dropBlocks` 收掉的（編號換成 −1）。修之前實測就是撿到第一塊那一幀
     `step()` 當場丟「Cannot read properties of undefined (reading 'x')」（`pickSpot`
     讀 `b.x`）。這條直接把第二筆的編號打成 −1，驗它變成「跟被搶走一樣處理」。 */
  await reset(page, { shape: '吉薩金字塔', cnt: 400, workers: 16, scale: 1 });
  const gap = await page.evaluate(() => {
    let w = null;
    for (let i = 0; i < 600 && !w; i++) {
      step(0.05);
      w = workers.find(x => x.st === 'pick' && x.load.length >= 2 && x.li === 0);
    }
    if (!w) return { found: false };
    const n0 = w.load.length;
    w.load[1].b = -1;                    // 第二筆那塊「不在了」（dropBlocks 收掉就是這個值）
    let err = '';
    try { for (let i = 0; i < 600 && w.load.length === n0; i++) step(0.05); }
    catch (e) { err = String(e && e.message || e); }
    return { found: true, n0, err, len: w.load.length, carry: !!w.carry, emo: w.emo };
  });
  ok('工作單第二筆中途不見了，小人不會當掉',
     gap.found && !gap.err && gap.len === gap.n0 - 1 && gap.carry,
     gap.found ? '第一塊照樣撿到手（carry=' + gap.carry +
                 '）、死掉那筆被抽掉（' + gap.n0 + ' → ' + gap.len +
                 '）、頭上表情「' + (gap.emo || '無') +
                 '」、例外「' + (gap.err || '無') + '」'
               : '沒抓到「工作單有兩筆」的人');

  /* ══════════ 缺料就自己挖 ══════════ */
  await head('缺料就自己挖');
  /* v1.141（使用者：「目前更換建築會自動在場上灑上積木，改成材料不夠小人自己挖」
     「也為以後不用考慮積木夠不夠的問題，需要積木又沒得撿的時候用挖的就能產生」）。
     兩件事要一起成立：換場不再無中生有一整圈建材（reconcilePool 少了不補），
     而缺料的人自己走幾步、拿鏟子挖出來（digSite）——挖出來的躺在地上，
     再照原本那條「撿起來搬過去」的路走，不另開搬運路。 */
  await reset(page, { shape: '吉薩金字塔', cnt: 400, workers: 16 });
  const digNo = await page.evaluate(() => {
    dropBlocks(b => b.hh < 0);              // 池子清空（房子的不算料池，見 reconcilePool）
    const p0 = blocks.length;
    startBuild(true);                       // 以前這裡會補到「剛好夠蓋完這一座」
    return { p0, p1: blocks.length, slots: bp.slots.length, drawn: ENG.three.blockMesh.count };
  });
  ok('換建築不再自動在場上灑一整圈建材',
     digNo.p0 === 0 && digNo.p1 === 0 && digNo.slots > 100 && digNo.drawn === 0,
     '藍圖 ' + digNo.slots + ' 格，清空之後換一次場，池子還是 ' + digNo.p1 + ' 塊');

  const digGo = await page.evaluate(() => {
    const m0 = marks.length;
    let shovel = 0, digSt = 0, air = 0;
    for (let i = 0; i < 600; i++) {                    // 30 秒
      step(0.05);
      if (workers.some(w => w.dig > 0)) shovel++;      // 手上真的拿著鏟子在揮
      if (workers.some(w => w.st === 'dig')) digSt++;
      if (blocks.some(b => b.st === 4)) air++;         // 挖出來那一塊蹦到地上的那幾幀
    }
    let inSite = 0, inHome = 0, minR = 1e9;
    for (const b of blocks) {
      if (b.st !== 0) continue;
      const r = Math.hypot(b.x, b.z);
      if (r < minR) minR = r;
      if (r < siteR) inSite++;
      if (homeAt(b.x, b.z)) inHome++;
    }
    return { pool: blocks.length, free: blocks.filter(b => b.st === 0).length,
             set: blocks.filter(b => b.st === 3).length, carried: stats.carried,
             mine: blocks.filter(b => b.dug).length, shovel, digSt, air,
             /* 土痕會淡掉（3 秒，跟隕石坑同一套），所以這是「此刻還看得到幾個」，
                不是「總共挖了幾個坑」。要驗的是沒有一個落在工地裡。 */
             marks: marks.length - m0,
             markIn: marks.filter(k => Math.hypot(k.x, k.z) < siteR).length,
             inSite, inHome, minR: +minR.toFixed(1), siteR: +siteR.toFixed(1) };
  });
  ok('空地上小人自己挖出建材，一邊挖一邊蓋',
     digGo.pool > 40 && digGo.set > 15 && digGo.shovel > 100 && digGo.digSt > 100,
     '三十秒挖出 ' + digGo.pool + ' 塊、擺上去 ' + digGo.set +
     ' 塊（600 幀裡有 ' + digGo.digSt + ' 幀有人在挖、' + digGo.shovel + ' 幀鏟子在動）');
  /* 挖出來的**躺在地上**，不是直接進手裡（v1.129 在小人蓋自己家那邊定的規矩）：
     所以會看到它蹦起來（st=4）、然後被人撿走（stats.carried 有在跑）。 */
  ok('挖出來的先蹦到地上，再照原本那條路撿起來搬走',
     digGo.air > 20 && digGo.carried > 10 && digGo.free > 0,
     '有 ' + digGo.air + ' 幀看得到剛挖出來還在空中的、期間撿走了 ' +
     digGo.carried + ' 塊，地上還躺著 ' + digGo.free + ' 塊');
  ok('挖的地方在工地外面，也不挖到人家屋子裡',
     digGo.inSite === 0 && digGo.inHome === 0 && digGo.minR >= digGo.siteR &&
     digGo.marks > 0 && digGo.markIn === 0,
     '地上的料最近的離場中心 ' + digGo.minR + ' 格（工地半徑 ' + digGo.siteR +
     '）、屋子裡 ' + digGo.inHome + ' 塊；此刻看得到 ' + digGo.marks + ' 個土痕，' +
     digGo.markIn + ' 個在工地裡');
  /* 挖出來的是**這一座的建材**，不蓋「村子的料」記號（v1.134 的 homeMine）：
     蓋上記號的話，施工中小人蓋自己家會把地標的建材收去用。 */
  ok('挖出來的算這一座的建材，村子不能收回去蓋房子',
     digGo.mine === 0,
     '場上帶著「村子自己挖的」記號的積木 ' + digGo.mine + ' 塊');

  /* 地上有料就不該有人挖（「需要積木又沒得撿的時候」才挖）。
     scatterFree 會把料補到剛好夠蓋完並鋪到工地外面，等於舊版換場那一刻的場面。 */
  const digNot = await page.evaluate(() => {
    scatterFree();
    /* 再多鋪 200 塊：只鋪「剛好夠」的話，中途會有「所有沒人認的料都剛好被認走」的
       瞬間，魔法師遇到那一瞬就會自己拉一塊（那是對的，見他那一段）——這一條要抓的是
       「地上明明有料還有人去挖」，所以把場子鋪成不可能缺料。 */
    for (let i = 0; i < 200; i++) {
      const b = newBlock();
      const a = Math.random() * Math.PI * 2;
      const rad = siteR + 3 + Math.random() * (arenaR - siteR - 3);
      b.x = Math.cos(a) * rad; b.z = Math.sin(a) * rad; b.y = HB;
      blocks.push(b); separate(b); gridAdd(b);
    }
    ENG.setBlockCount(blocks.length);
    const p0 = blocks.length;
    /* 攔的是「決定去挖」那一刻（startSiteDig），不是「挖出一塊」（digBlock）：
       鋪料之前就已經出發的那幾趟會把手上這一趟做完（挖到 cap 塊才收工），
       那不算「地上有料還去挖」——他決定的時候地上確實沒料。
       攔函式也比每幀看誰的 st 是 'dig' 準：那是取樣，短的一趟會被漏掉。 */
    const origStart = startSiteDig;
    let picked = 0, minOk = 1e9;
    startSiteDig = w => {
      picked++;
      let ok = 0;
      for (const b of blocks) if (b.st === 0 && b.rest && b.holder < 0) ok++;
      minOk = Math.min(minOk, ok);
      origStart(w);
    };
    for (let i = 0; i < 600; i++) step(0.05);
    startSiteDig = origStart;
    return { p0, p1: blocks.length, picked, minOk: minOk === 1e9 ? -1 : minOk,
             tail: workers.length * 3, slots: bp.slots.length,
             set: blocks.filter(b => b.st === 3).length };
  });
  /* 池子多出來的那幾塊是「鋪料前就出發的那幾趟」挖完的，所以上限是
     「所有人各挖滿一趟」＝人數 × 一趟最多三塊（實測只多 4～5 塊）。 */
  ok('地上還有料的時候不會有人跑去挖',
     digNot.picked === 0 && digNot.set > 60 && digNot.p1 - digNot.p0 <= digNot.tail,
     '鋪好 ' + digNot.p0 + ' 塊料再跑三十秒：0 個人決定去挖（鋪料前就出發的那幾趟做完，' +
     '池子多了 ' + (digNot.p1 - digNot.p0) + ' 塊，上限 ' + digNot.tail +
     '），擺上去 ' + digNot.set + ' 塊');

  /* 從一塊料都沒有蓋到完工：料夠不夠不再是換場那一刻要保證的事（使用者：
     「以後不用考慮積木夠不夠的問題」），所以這一條驗的是那個保證真的成立。
     順便看有沒有挖過頭——只要場上還有一塊沒人認的料，findBlock 就會挑它，
     所以挖出來的總數該貼著藍圖格數（實測 3177 格的自由女神剛好 3177 塊）。 */
  await reset(page, { shape: '吉薩金字塔', cnt: 400, workers: 40, scale: 3 });
  const digDone = await page.evaluate(() => {
    dropBlocks(b => b.hh < 0);
    const p0 = blocks.length;
    for (let i = 0; i < 12000; i++) { step(0.05); if (phase === 'done') break; }
    return { p0, phase, placed: placedCnt, slots: bp.slots.length, pool: blocks.length,
             free: blocks.filter(b => b.st === 0).length,
             set: blocks.filter(b => b.st === 3).length };
  });
  ok('空地也蓋得完，而且不會挖過頭',
     digDone.p0 === 0 && digDone.phase === 'done' && digDone.placed === digDone.slots &&
     digDone.set === digDone.slots && digDone.pool <= digDone.slots * 1.1,
     '從 0 塊料開始：擺上 ' + digDone.set + ' / ' + digDone.slots +
     ' 格（phase=' + digDone.phase + '），總共挖出 ' + digDone.pool + ' 塊、地上剩 ' +
     digDone.free + ' 塊');

  /* ══════════ 破壞（局部） ══════════ */
  await head('破壞：只壞被打到的地方');
  await reset(page, { shape: '新天鵝堡', cnt: 1200, workers: 4 });
  await fillAll(page);
  const smash1 = await page.evaluate(() => {
    const pre = blocks.map(b => ({ st: b.st, x: b.x, y: b.y, z: b.z }));
    // 挑一塊在牆上、不在正中心的積木當落點
    const cand = blocks.filter(b => b.st === 3 && b.y > 2);
    const t = cand[Math.floor(cand.length * 0.35)];
    const point = new THREE.Vector3(t.x, t.y, t.z);
    const n = smash(point, new THREE.Vector3(0.2, -0.95, 0.2).normalize());
    let inR = 0, inBroken = 0, farN = 0, farBroken = 0, farMoved = 0;
    for (let i = 0; i < blocks.length; i++) {
      if (pre[i].st !== 3) continue;
      const d = Math.hypot(pre[i].x - point.x, pre[i].y - point.y, pre[i].z - point.z);
      if (d <= hammerR * 0.75) { inR++; if (blocks[i].st === 4) inBroken++; }
      else if (d > hammerR * 2.2) {
        farN++;
        if (blocks[i].st !== 3) farBroken++;
        if (Math.abs(blocks[i].x - pre[i].x) > 0.001 || Math.abs(blocks[i].y - pre[i].y) > 0.001) farMoved++;
      }
    }
    return { n, inR, inBroken, farN, farBroken, farMoved, R: hammerR };
  });
  ok('衝擊範圍內的積木被打飛', smash1.inBroken === smash1.inR && smash1.inR > 5,
     smash1.inR + ' 塊裡飛出 ' + smash1.inBroken);
  /* 這裡量的是「揮擊當下」：遠處不該被直接波及。
     至於失去支撐而跟著垮的部分，是下一段「垮塌」在管的事。 */
  ok('揮擊當下範圍外的積木完全不受影響', smash1.farBroken === 0 && smash1.farMoved === 0,
     '遠處 ' + smash1.farN + ' 塊，壞了 ' + smash1.farBroken + '、位移 ' + smash1.farMoved);
  ok('一槌打飛的數量合理', smash1.n > 5 && smash1.n < 400, smash1.n + ' 塊（半徑 ' + smash1.R + '）');
  await page.screenshot({ path: path.join(OUT, '03-砸出一個洞.png') });

  const angle = await page.evaluate(() => {
    const run = dir => {
      startBuild(true);
      for (let i = 0; i < blocks.length; i++) {           // 全部歸零，排除上一輪殘留的速度
        const b = blocks[i];
        b.vx = b.vy = b.vz = b.ax = b.ay = b.az = 0; b.snap = 0; b.holder = -1;
        b.st = i < bp.slots.length ? 3 : 0; b.slot = -1;
      }
      for (let i = 0; i < bp.slots.length && i < blocks.length; i++) {
        const s = bp.slots[i], b = blocks[i];
        if (b.cell) gridDel(b);
        b.slot = i; b.x = s.x; b.y = s.y + HB; b.z = s.z;
        b.rx = b.ry = b.rz = 0; s.filled = true;
      }
      placedCnt = bp.slots.length;
      const t = blocks.filter(b => b.st === 3).sort((a, b) => b.y - a.y)[10];
      const p = new THREE.Vector3(t.x, t.y, t.z);
      smash(p, dir);
      let vx = 0, vz = 0, n = 0;
      for (const b of blocks) if (b.st === 4) { vx += b.vx; vz += b.vz; n++; }
      return n ? { vx: vx / n, vz: vz / n, n } : null;
    };
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    const a = run(new THREE.Vector3(1, -0.3, 0).normalize());
    const b = run(new THREE.Vector3(-1, -0.3, 0).normalize());
    return { a, b };
  });
  ok('從不同角度砸，散開的方向不同',
     angle.a && angle.b && Math.sign(angle.a.vx) !== Math.sign(angle.b.vx) &&
     Math.abs(angle.a.vx - angle.b.vx) > 2,
     '往 +X 砸平均 vx=' + angle.a.vx.toFixed(2) + '，往 −X 砸 vx=' + angle.b.vx.toFixed(2));

  const land = await page.evaluate(() => {
    for (let i = 0; i < 700; i++) step(0.05);
    let flying = 0, outside = 0, sunk = 0, float = 0, worstY = 0, freeN = 0;
    for (const b of blocks) {
      if (b.st === 4) flying++;
      if (Math.hypot(b.x, b.z) > arenaR + 1.5) outside++;
      if (b.st !== 0 || b.snap > 0) continue;
      freeN++;
      /* 用 halfY 不是 h/2：積木斜著落定時，沿世界 Y 的半高會大於 0.47 */
      const need = halfY(b);
      if (b.y < need - 0.12) sunk++;
      if (b.y > need + 0.12) { float++; worstY = Math.max(worstY, b.y); }
    }
    return { flying, outside, sunk, float, worstY, freeN };
  });
  ok('碎塊最後都會落定', land.flying === 0, land.flying + ' 塊還在飛');
  ok('碎塊不會飛出工地', land.outside === 0, land.outside + ' 塊在場外');
  ok('碎塊不會陷進地面', land.sunk === 0, land.sunk + ' 塊陷入');
  ok('碎塊不會浮在半空', land.float === 0 && land.freeN > 10,
     land.freeN + ' 塊散料，浮空 ' + land.float + '（最高 ' + land.worstY.toFixed(2) + '）');

  await probeWorkers(page, '破壞後');

  /* ══════════ 垮塌 ══════════ */
  await head('垮塌：下面沒了上面跟著垮');
  await reset(page, { shape: '倫敦大笨鐘', cnt: 900, workers: 1 });
  const tower = await page.evaluate(() => {
    completeNow();
    const before = placedCnt, h = bp.height;
    // 直接把最底下兩層清乾淨——一槌的球半徑不一定蓋得住整個底座，
    // 那樣測到的是「打不夠乾淨」而不是「垮不垮」
    let cleared = 0;
    for (const b of blocks) if (b.st === 3 && b.y < 2.2) { breakBlock(b, 0, 0, 0); cleared++; }
    afterHit(cleared, { x: 0, y: 1, z: 0 }, 6);
    const rightAfter = placedCnt;
    for (let i = 0; i < 40; i++) step(0.05);
    return { before, cleared, rightAfter, after: placedCnt, h };
  });
  /* 不要求正好剩 0：垮完的碎料就掉在腳邊，小人在這兩秒內可能已經撿起來擺回去了。
     那是正常行為，不該讓這個測試變得時好時壞。 */
  ok('清掉底座，整座塔跟著垮下來', tower.after < tower.before * 0.02,
     '高 ' + tower.h + ' 的塔：' + tower.before + ' → 清掉底座剩 ' + tower.rightAfter +
     ' → 垮完剩 ' + tower.after);

  const side = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '萬里長城');
    startBuild(true); completeNow();
    const far0 = blocks.filter(b => b.st === 3 && b.x > 12).length;
    const t = blocks.filter(b => b.st === 3 && b.x < -12)[0];
    smash(new THREE.Vector3(t.x, t.y, t.z), new THREE.Vector3(0, -1, 0));
    for (let i = 0; i < 80; i++) step(0.05);
    return { far0, far1: blocks.filter(b => b.st === 3 && b.x > 12).length,
             total: bp.slots.length, left: placedCnt };
  });
  ok('打一端不會讓另一端跟著垮', side.far1 === side.far0 && side.far0 > 5,
     '另一端 ' + side.far0 + ' → ' + side.far1 + '（整體 ' + side.total + ' → ' + side.left + '）');

  /* 有些造型本來就有懸空部件（摩天輪車廂、大橋吊索、堆疊的塔節），
     那些不是被打壞才浮著的，沒人動它就不該掉。整份 SHAPES 全部驗一遍。 */
  const floaty = await page.evaluate(() => {
    const bad = [];
    let withFloats = 0;
    for (let i = 0; i < SHAPES.length; i++) {
      shapePick = i; startBuild(true); completeNow();
      if (bp.floats.length) withFloats++;
      const n0 = placedCnt;
      markSupportDirty(0);
      for (let k = 0; k < 80; k++) step(0.05);
      if (placedCnt !== n0) bad.push(SHAPES[i].n + ' ' + n0 + '→' + placedCnt);
    }
    return { bad, withFloats };
  });
  ok('每一座都不會無故掉塊（內建 + 自訂全掃）', floaty.bad.length === 0,
     floaty.bad.join('　') || '其中 ' + floaty.withFloats + ' 座有懸空部件，都沒掉');

  /* 懸空部件不是無敵的：撐著它的結構被打掉，它也要跟著掉，而且要一路連鎖 */
  const chain = await page.evaluate(() => {
    const out = [];
    // 建材數釘 3000（預設那一檔）：吳哥窟的懸空結構會隨尺寸變，不釘住量到的東西每次不同
    for (const nm of ['台北 101', '倫敦眼摩天輪', '京都五重塔', '嚴島神社鳥居', '吳哥窟']) {
      shapePick = SHAPES.findIndex(s => s.n === nm);
      targetCnt = 3000; startBuild(true); setWorkerCount(1); completeNow();
      const n0 = placedCnt, g = bp.floats.length;
      let cleared = 0;
      for (const b of blocks) if (b.st === 3 && b.y < 3.2) { breakBlock(b, 0, 0, 0); cleared++; }
      afterHit(cleared, { x: 0, y: 1, z: 0 }, 6);
      for (let k = 0; k < 160; k++) step(0.05);
      out.push({ nm, n0, cleared, left: placedCnt, g });
    }
    return out;
  });
  for (const c of chain)
    ok('打掉底座，' + c.nm + ' 的懸空部件跟著垮', c.left < c.n0 * 0.05,
       c.n0 + ' −底座' + c.cleared + ' → 剩 ' + c.left + '（' + c.g + ' 組懸空部件）');

  /* 吳哥窟：使用者報「底部拆掉卻不崩」的那一座，三檔建材數都量。
     v1.91 修規則（豁免的判準從「一組超過 2000 格」換成「完好時就撐不住」）、
     v1.92 修藍圖（三層方台的牆厚跟著層距算，彼此真的接上）。兩版之前的狀況是：
     · 3000：三層台差 1 格沒接上 → 3012 格裡只有 516 格連到地面，上面整團 2176 格
       剛好超過 2000 被永久豁免 → 敲掉底下三層「一塊都不掉」
     · 9000：差 4 格，兩團塔互相當對方的靠山、都碰不到地面 → 只能豁免（塔懸在半空）
     現在三檔都是 100% 連到地面、沒有懸空組，打掉底座就整座垮。 */
  const angkor = await page.evaluate(() => {
    const out = [];
    for (const cnt of [1800, 3000, 9000]) {
      shapePick = SHAPES.findIndex(s => s.n === '吳哥窟');
      targetCnt = cnt; setWorkerCount(1); startBuild(true); completeNow();
      const n0 = placedCnt;
      const floatCells = bp.floats.reduce((n, g) => n + g.cells.length, 0);
      const anchor = bp.slots.filter(s => s.anchor).length;
      markSupportDirty(0);
      for (let k = 0; k < 80; k++) step(0.05);      // 沒人動它
      const idle = placedCnt;
      let hit = 0;
      for (const b of blocks) if (b.st === 3 && b.y < 3.2) { breakBlock(b, 0, 0, 0); hit++; }
      afterHit(hit, { x: 0, y: 1, z: 0 }, 6);
      for (let k = 0; k < 200; k++) step(0.05);
      out.push({ cnt, n0, idle, hit, left: placedCnt, groups: bp.floats.length,
                 floatCells, anchor, total: bp.slots.length });
    }
    return out;
  });
  ok('完好的吳哥窟不會自己掉（三檔建材數都驗）',
     angkor.every(o => o.idle === o.n0),
     angkor.map(o => o.cnt + '：' + o.n0 + '→' + o.idle).join('　'));
  ok('吳哥窟打掉底座就整座垮（三檔建材數都驗）',
     angkor.every(o => o.left < o.n0 * 0.05),
     angkor.map(o => o.cnt + '：' + o.n0 + ' −底座' + o.hit + ' → 剩 ' + o.left).join('　'));
  /* 根因那一條：三層方台要真的疊在一起。v1.92 之前 3000 那檔懸空 2496 格、9000 懸空 7876 格
     （牆固定 2 格厚，而層與層的外緣落差是 round(s×0.32)/2，尺寸一大就拉開）。 */
  ok('吳哥窟三層方台彼此接上，整座都連到地面',
     angkor.every(o => o.floatCells === 0 && o.anchor === o.total),
     angkor.map(o => o.cnt + '：連到地面 ' + o.anchor + '/' + o.total + '、懸空 ' +
                     o.floatCells).join('　'));

  /* 常設哨兵：有一組懸空部件超過 2000 格卻一個靠山都沒有，就是「那一團怎麼打都不會垮」。
     可能是藍圖沒接上（吳哥窟就是這樣被抓到的），也可能真的是故意畫的巨大懸空件——
     兩種都要人來看一眼，所以在這裡卡住。整份 SHAPES × 兩檔只算藍圖、不畫圖。 */
  const noBig = await page.evaluate(() => {
    const bad = [];
    for (let i = 0; i < SHAPES.length; i++)
      for (const cnt of [3000, 9000]) {
        const b = makeBlueprint(i, cnt);
        for (const g of b.floats)
          if (g.cells.length > 2000 && !g.props.length)
            bad.push(b.name + ' @' + cnt + ' 有一組 ' + g.cells.length + ' 格沒有靠山');
      }
    return bad;
  });
  ok('沒有哪一座是靠「那一團太大」才不垮的', noBig.length === 0,
     noBig.join('　') || ALL_SHAPES + ' 座 × 3000／9000 兩檔都沒有');

  const supCost = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '艾菲爾鐵塔');
    targetCnt = 3000; setWorkerCount(2); startBuild(true); completeNow();
    const t0 = performance.now();
    for (let i = 0; i < 50; i++) collapseUnsupported();
    return { ms: (performance.now() - t0) / 50, n: blocks.length };
  });
  ok('垮塌判定夠便宜', supCost.ms < 4,
     supCost.n + ' 塊時一次 ' + supCost.ms.toFixed(2) + ' ms（最多每 0.08 秒算一次）');

  /* 支撐判定用 26 鄰居（角碰角就算連著），所以炸穿一面牆之後會留下「用一個角
     吊在半空」的積木或整坨。dropHung 專門收這種：基準線是藍圖的 f6
     （完好時六個面就連得到地面），本來這樣站著、現在只剩對角勾著的才掉。
     量法：打完之後從地面做一次 6 面連通，還活著卻連不到的就是漏網的。 */
  const hung = await page.evaluate(() => {
    const face = () => {
      const S = bp.slots, n = S.length;
      const here = new Uint8Array(n);
      for (const b of blocks) if (b.st === 3 && b.slot >= 0 && b.fallIn <= 0) here[b.slot] = 1;
      const F6 = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
      const seen = new Uint8Array(n), st = [];
      for (let i = 0; i < n; i++) if (here[i] && S[i].gy === 0) { seen[i] = 1; st.push(i); }
      while (st.length) {
        const s = S[st.pop()];
        for (const d of F6) {
          const j = bp.at.get(gkeyOf(s.gx + d[0], s.gy + d[1], s.gz + d[2]));
          if (j === undefined || seen[j] || !here[j]) continue;
          seen[j] = 1; st.push(j);
        }
      }
      let live = 0, bad = 0, badF6 = 0;
      for (let i = 0; i < n; i++) {
        if (!here[i]) continue;
        live++;
        if (seen[i]) continue;
        bad++;
        if (S[i].f6) badF6++;               // 本來六面站得住的才算漏網
      }
      return { live, bad, badF6 };
    };
    const run = name => {
      shapePick = SHAPES.findIndex(s => s.n === name);
      cleanTools(); targetCnt = 1500; setWorkerCount(4); startBuild(true); completeNow();
      const f6 = bp.slots.filter(s => s.f6).length, all = bp.slots.length;
      explode({ x: siteR * 0.5, y: 1.2, z: 0 }, ROCK_R, ROCK_POW);   // 投石機石頭：最小的爆炸
      for (let i = 0; i < 300; i++) step(0.05);
      return { name, f6, all, ...face() };
    };
    /* 兩座都打三輪：同一發石頭有時候會引發整棟連鎖崩塌，剩幾塊是浮動的
       （帝國大廈實測八輪 0～641）。「還剩東西可驗」只要有一輪成立就夠，
       「沒有漏網的對角勾著」則是每一輪都必須成立。
       鐵塔本來只打一輪，v1.131 改成跟大廈一樣打三輪——它同樣會整座塌
       （實測紅過一次：1523 塊只剩 153 塊，那一輪根本沒剩東西可驗）。 */
    const box = [run('帝國大廈'), run('帝國大廈'), run('帝國大廈')];
    const lat = [run('艾菲爾鐵塔'), run('艾菲爾鐵塔'), run('艾菲爾鐵塔')];
    const most = a => a.reduce((x, r) => r.live > x.live ? r : x);
    return { box: box[0], boxBad: box.reduce((s, r) => s + r.badF6, 0),
             boxLive: Math.max(...box.map(r => r.live)),
             boxAll: box.map(r => r.live),
             lat: most(lat), latBad: lat.reduce((s, r) => s + r.badF6, 0),
             latAll: lat.map(r => r.live) };
  });
  ok('炸穿牆腳之後不會留下只靠對角勾著的積木',
     hung.boxBad === 0 && hung.boxLive > 100,
     '帝國大廈中一發石頭三輪：剩 ' + JSON.stringify(hung.boxAll) +
     ' 塊，只靠對角勾著的合計 ' + hung.boxBad + ' 塊（沒有這一關會留下一百多塊）');
  /* 反面：本來就靠斜格子疊起來的造型不歸這一關管，不然它們會自己解體。
     v1.114 換上新的鐵塔藍圖之後量到 f6 775/1523（51%）、中一發石頭後剩 66～70%（四輪）：
     新那份底座 21×21（舊的 33×33），同一顆石頭（siteR×0.5）落得更靠腿，所以塌得多一些。
     舊那份是 672/1497（45%）、剩超過 75%。要守住的是 badF6 === 0（沒有漏網的對角勾著），
     另外兩個是「這個 fixture 真的是斜格子、也真的沒被誤殺」的門檻。
     v1.131：那兩個門檻改看**剩最多的那一輪**——鐵塔跟大廈一樣會整座連鎖崩塌，
     塌光的那一輪沒剩東西可驗，不是「被這一關誤殺」（誤殺看的是 badF6，三輪都要 0）。 */
  ok('斜格子造型不會被這一關誤殺',
     hung.lat.f6 < hung.lat.all * 0.6 && hung.lat.live > hung.lat.all * 0.6 &&
     hung.lat.bad > 400 && hung.latBad === 0,
     '艾菲爾鐵塔三輪剩 ' + JSON.stringify(hung.latAll) + ' 塊；完好時六面站得住的只有 ' +
     hung.lat.f6 + '/' + hung.lat.all + '，剩最多那一輪的 ' + hung.lat.live +
     ' 塊裡有 ' + hung.lat.bad + ' 塊本來就是靠斜角連的（都還在）');

  /* 蓋到一半把地基敲掉，小人不能繼續往上疊——那會蓋出一整片浮在半空的積木。
     量法：逐步比對「這一步新填上的格子」，看它填上去的當下連不連得到地面。
     不能只看某個瞬間的總數——剛敲掉地基、垮塌判定還沒跑的那 0.08 秒裡，
     整棟都還「連不到地面」，那是過渡態不是 bug。 */
  const midBuild = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '倫敦大笨鐘');
    targetCnt = 900; setWorkerCount(30); startBuild(true);
    for (let i = 0; i < 500; i++) step(0.05);
    const mid = placedCnt;
    let cleared = 0;
    for (const b of blocks) if (b.st === 3 && b.y < 2.2) { breakBlock(b, 0, 0, 0); cleared++; }
    afterHit(cleared, { x: 0, y: 1, z: 0 }, 6);
    const S = bp.slots, before = new Uint8Array(S.length);
    let placed = 0, bad = 0;
    for (let i = 0; i < 1600; i++) {
      for (let k = 0; k < S.length; k++) before[k] = S[k].filled ? 1 : 0;
      step(0.05);
      computeSupport();
      for (let k = 0; k < S.length; k++) {
        if (!S[k].filled || before[k]) continue;
        placed++;
        if (!supported(k)) bad++;
      }
    }
    return { mid, cleared, end: placedCnt, placed, bad };
  });
  ok('地基被敲掉後不會蓋出浮空的積木', midBuild.bad === 0,
     '蓋到 ' + midBuild.mid + ' 塊時挖掉地基 ' + midBuild.cleared + ' 塊；之後新放上去 ' +
     midBuild.placed + ' 塊，落地當下連不到地面的有 ' + midBuild.bad + ' 塊（重建到 ' + midBuild.end + '）');

  /* 破壞打出來的洞排在派工游標「後面」，findSlot 是從游標往後掃、掃不到才回頭，
     所以不把游標退回去的話小人會先在上面蓋一大段才回頭補
     （改之前實測：中世紀城堡（v1.66 換掉的那份）第一塊補回去要 10.5 秒，期間別處先蓋了 350 塊）。
     freeBlock 現在會把游標退到那個洞。 */
  const repair = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '新天鵝堡');
    targetCnt = 1200; setWorkerCount(30); startBuild(true);
    for (let i = 0; i < 1500 && phase === 'build'; i++) step(0.05);
    const S = bp.slots;
    const before = S.map(s => (s.filled ? 1 : 0));
    explode({ x: 0, y: 1, z: 0 }, 7, 18);
    for (let i = 0; i < 20; i++) step(0.05);
    const hole = new Set();
    for (let i = 0; i < S.length; i++) if (before[i] && !S[i].filled) hole.add(i);
    const cur = slotCursor, holes = hole.size;
    const mark = S.map(s => (s.filled ? 1 : 0));
    let fixed = 0, other = 0, first = -1, t = 0;
    for (let i = 0; i < 400; i++) {                 // 看爆炸後的 20 秒
      step(0.05); t += 0.05;
      for (let k = 0; k < S.length; k++) {
        if (!S[k].filled || mark[k]) continue;
        mark[k] = 1;
        if (hole.has(k)) { fixed++; if (first < 0) first = +t.toFixed(2); }
        else other++;
      }
    }
    return { holes, cur, fixed, other, first, phase };
  });
  /* 門檻取自 5 輪對照（同一個情境、爆炸後 20 秒）：
     退游標前 第一塊 9.4–12.3 秒、別處蓋 50–82 塊；退了之後 1.4–2.2 秒、別處 0–14 塊。
     **v1.60.1 重新量過**：第一塊 1.9–5.15 秒、補回 45–52 格、別處 11–41 塊。
     兩個數字都往上跑是「同樣 20 秒蓋得比以前多」的直接結果（到了工地就原地把手上的
     丟完，實測同樣時間放上去的塊數多五到八成）；
     「第一塊」變慢還多一個原因：派工單一次領三格，補洞得等他把手上那趟走完。
     門檻照新的量測放寬，但仍然離「沒退游標」那組有距離。 */
  ok('炸出來的洞會先補，不是繼續往上疊',
     repair.holes > 20 && repair.fixed > 20 && repair.first > 0 && repair.first < 8 &&
     repair.other < 60,
     '洞 ' + repair.holes + ' 格：20 秒內補回 ' + repair.fixed + ' 格、別處只蓋了 ' +
     repair.other + ' 塊，第一塊補回去 ' + repair.first + ' 秒（爆炸當下游標在 ' + repair.cur + '）');

  const noDip = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 500; setWorkerCount(40); startBuild(true);
    let prev = placedCnt, dip = 0;
    // 步數要給夠：有些格子的支撐要等上面那圈蓋好才成立，會排到最後才輪到
    for (let i = 0; i < 8000; i++) {
      step(0.05);
      if (placedCnt < prev) dip = Math.max(dip, prev - placedCnt);   // 沒人在砸，進度就不該倒退
      prev = placedCnt;
      if (phase === 'done') break;
    }
    return { placed: placedCnt, total: bp.slots.length, phase, dip };
  });
  /* 重點是「沒人在砸，進度就不該倒退」。有沒有在時限內剛好蓋完是另一回事——
     那個由「會蓋到完工」那項負責，寫在這裡只會讓測試對時序敏感。 */
  ok('施工前緣不會被垮塌判定誤傷', noDip.dip === 0 && noDip.placed > noDip.total * 0.9,
     noDip.placed + '/' + noDip.total + '（' + noDip.phase + '），過程中最大回退 ' + noDip.dip + ' 塊');

  await probeWorkers(page, '垮塌後');

  /* ══════════ 遊戲流程：蓋好 → 拆掉 → 蓋下一座 ══════════ */
  await head('流程：蓋好 → 拆掉 → 蓋下一座');
  await reset(page, { shape: '吉薩金字塔', cnt: 700, workers: 12 });
  const flow = await page.evaluate(() => {
    completeNow();
    const opened = { phase, placed: placedCnt, total: bp.slots.length, name: bp.name };
    const cand = blocks.filter(b => b.st === 3);
    const t = cand[Math.floor(cand.length * 0.5)];
    smash(new THREE.Vector3(t.x, t.y, t.z), new THREE.Vector3(0.2, -0.95, 0.1).normalize());
    const hit1 = { phase, placed: placedCnt };
    for (let i = 0; i < 600; i++) step(0.05);      // 放 30 秒也不該有人來修
    const idle = { phase, placed: placedCnt };
    return { opened, hit1, idle, thresh: Math.floor(bp.slots.length * WRECK_AT) };
  });
  ok('completeNow 會直接給一座蓋好的建築',
     flow.opened.phase === 'done' && flow.opened.placed === flow.opened.total,
     flow.opened.name + ' ' + flow.opened.placed + '/' + flow.opened.total);
  ok('砸完工的建築會進入「拆除中」', flow.hit1.phase === 'wreck',
     'phase=' + flow.hit1.phase + '，剩 ' + flow.hit1.placed);
  ok('拆除中小人不會偷偷把它修回去',
     flow.idle.placed === flow.hit1.placed && flow.idle.phase === 'wreck',
     '30 秒後 ' + flow.hit1.placed + ' → ' + flow.idle.placed);

  const wreck = await page.evaluate(() => {
    const name0 = bp.name, d0 = stats.destroyed;
    let hits = 0;
    for (let i = 0; i < 60 && phase === 'wreck'; i++) {
      const cand = blocks.filter(b => b.st === 3);
      if (!cand.length) { for (let k = 0; k < 5; k++) step(0.05); continue; }
      const t = cand[Math.floor(Math.random() * cand.length)];
      smash(new THREE.Vector3(t.x, t.y, t.z), new THREE.Vector3(0.2, -0.95, 0.1).normalize());
      hits++;
      for (let k = 0; k < 8; k++) step(0.05);
    }
    const at = phase, placed = placedCnt;
    // 換場先整地（推土機），整完才輪到小人
    let wait = 0;
    while (phase === 'clear' && wait < 800) { step(0.05); wait++; }
    return { hits, at, phase, placed, wait, destroyed: stats.destroyed, gained: stats.destroyed - d0, name0, name: bp.name };
  });
  ok('拆到門檻就自動開下一座', wreck.at === 'clear' && wreck.placed < 30,
     '砸 ' + wreck.hits + ' 槌後 phase=' + wreck.at + '，進度歸零到 ' + wreck.placed);
  ok('整地完才換成施工中', wreck.phase === 'build' && wreck.wait > 0 && wreck.wait < 800,
     '整地 ' + (wreck.wait * 0.05).toFixed(1) + ' 秒後 phase=' + wreck.phase);
  ok('拆掉的座數有計進紀錄', wreck.gained === 1, '+' + wreck.gained + '（累計 ' + wreck.destroyed + '）');

  const rebuild = await page.evaluate(() => {
    setWorkerCount(30);
    // 只跑到「蓋一半」就好——跑到完工的話 phase 會變 done，
    // 那時候再砸測到的是拆除流程，不是修補流程
    for (let i = 0; i < 400; i++) step(0.05);
    const mid = placedCnt, ph0 = phase;
    const cand = blocks.filter(b => b.st === 3);
    const t = cand[Math.floor(cand.length * 0.6)];
    smash(new THREE.Vector3(t.x, t.y, t.z), new THREE.Vector3(0, -1, 0));
    const hurt = placedCnt, ph1 = phase;
    for (let i = 0; i < 900; i++) step(0.05);
    return { mid, ph0, hurt, ph1, after: placedCnt, phase, total: bp.slots.length };
  });
  await probeWorkers(page, '拆除重建後');
  const roam = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 500; setWorkerCount(20); startBuild(true); completeNow();
    const pre = workers.map(w => ({ d: Math.round(Math.hypot(w.x, w.z)), td: Math.round(Math.hypot(w.tx, w.tz)), st: w.st }))
      .sort((a, b) => b.d - a.d).slice(0, 3);
    for (let i = 0; i < 200; i++) step(0.05);        // 先把七秒的繞圈慶祝跑完
    const a0 = arenaR, ph0 = phase;
    let far = 0, out = 0, worst = null;
    for (let i = 0; i < 3000; i++) {
      step(0.05);
      const lim = arenaR + 26;                      // 草地島的半邊長，會隨建築換而改
      for (const w of workers) {
        const d = Math.max(Math.abs(w.x), Math.abs(w.z));
        if (d > far) far = d;
        if (d > lim && !worst) worst = { d: +d.toFixed(1), lim: +lim.toFixed(1), i, phase, name: bp.name };
        if (d > lim) out++;
      }
    }
    return { far, out, worst, a0, ph0, arenaR, siteR, phase, name: bp.name, lim: arenaR + 26, pre,
             band: IDLE_FAR };
  });
  /* v1.60～v1.95 是「完工後逛遍整張地圖」（目標點取 arenaR + 20 的方形亂數）。
     v1.96 起收回工地外圈那一環（使用者指定「不要讓建築一圈都沒人，看起來會有點明顯」），
     所以這條反過來守上限：150 秒都不該有人走到碎料場那邊去。
     下限與「一圈有沒有人」由「閒晃」那一段的兩條守。 */
  ok('完工後在建築周圍閒晃，不會走到碎料場外',
     roam.far < roam.siteR + roam.band + 2,
     '150 秒最遠走到 ' + roam.far.toFixed(0) + '（環外緣 ' +
     (roam.siteR + roam.band).toFixed(0) + '、建築半徑 ' + roam.siteR.toFixed(0) +
     '、碎料場半徑 ' + roam.a0.toFixed(0) + '）');
  ok('但不會走出草地', roam.out === 0,
     '越界 ' + roam.out + ' 次；草地半邊長 ' + roam.lim.toFixed(0) +
     '；進場時最遠的三個小人 ' + JSON.stringify(roam.pre) +
     (roam.worst ? '；第一次越界 ' + JSON.stringify(roam.worst) : ''));

  /* 遊蕩要有停頓，不然一群人一路走不停，看起來像螞蟻在竄。
     量每個小人「連續原地不動」最長撐幾秒——沒有停頓的話，
     只有抵達目標那一幀不動（0.05 秒），撐不到一秒。 */
  const idle = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 500; setWorkerCount(20); startBuild(true); completeNow();
    for (let i = 0; i < 200; i++) step(0.05);          // 先把七秒的繞圈慶祝跑完
    const run = workers.map(() => 0), best = workers.map(() => 0);
    const px = workers.map(w => w.x), pz = workers.map(w => w.z);
    let moved = 0, samples = 0, near = Infinity, far = 0, empty = 0, frames = 0;
    for (let i = 0; i < 1200; i++) {
      step(0.05); frames++;
      for (let k = 0; k < workers.length; k++) {
        const w = workers[k];
        const d = Math.hypot(w.x - px[k], w.z - pz[k]);
        px[k] = w.x; pz[k] = w.z; samples++;
        if (d < 1e-6) { run[k] += 0.05; if (run[k] > best[k]) best[k] = run[k]; }
        else { run[k] = 0; moved++; }
        const r = Math.hypot(w.x, w.z);         // 離工地中心多遠——閒晃不該踩進建築裡
        if (r < near) near = r;
        if (r > far) far = r;
      }
      // 這一幀建築周圍有沒有人（見下面那條：一圈都沒人的話畫面很明顯）
      if (!workers.some(w => Math.hypot(w.x, w.z) < siteR + IDLE_FAR)) empty++;
    }
    best.sort((a, b) => b - a);
    return { longest: +best[0].toFixed(2), median: +best[best.length >> 1].toFixed(2),
             least: +best[best.length - 1].toFixed(2),
             movingFrac: +(moved / samples).toFixed(2), n: workers.length,
             near: +near.toFixed(2), siteR: +siteR.toFixed(2),
             far: +far.toFixed(2), empty, frames, arenaR: +arenaR.toFixed(1),
             band: IDLE_FAR };
  });
  ok('遊蕩時會不時停下來站一會兒', idle.median >= 1.1,
     idle.n + ' 人在 60 秒裡最長站定：中位數 ' + idle.median + ' 秒、最久 ' +
     idle.longest + ' 秒、最短 ' + idle.least + ' 秒');
  /* 要的是「大部分人站著，但整群不是死的」。兩邊都要卡：
     全在走看起來像螞蟻竄，全站著看起來像當機。 */
  ok('閒晃時約七成的人站著不動', idle.movingFrac >= 0.2 && idle.movingFrac <= 0.4,
     '站著的幀數占 ' + ((1 - idle.movingFrac) * 100).toFixed(0) + '%（目標 70%）');
  /* 閒晃的人不會從蓋好的建築中間穿過去。走到牆邊要繞開，
     所以最近距離會停在建築外圈；踩進去的話這個數字會小於建築半徑。 */
  ok('閒晃不會穿過建築', idle.near >= idle.siteR,
     '最近只走到離工地中心 ' + idle.near + '（建築半徑 ' + idle.siteR + '）');
  /* 上限（v1.96，使用者指定「盡量不要讓建築一圈都沒人，看起來會有點明顯」）。
     v1.60～v1.95 的散場後是整片草地亂挑目標（arenaR + 20 的方形），人會一路走到
     碎料場外緣去——鏡頭取的是建築那一帶，那等於走出畫面，建築周圍空掉。
     現在閒晃目標一律取在工地外圈 IDLE_NEAR～IDLE_FAR 這一環裡。 */
  ok('閒晃不會走到建築周圍以外，一圈也不會沒人',
     idle.far < idle.siteR + idle.band + 1.5 && idle.empty === 0,
     '最遠走到 ' + idle.far + '（環的外緣是 ' + (idle.siteR + idle.band).toFixed(1) +
     '，碎料場外緣 ' + idle.arenaR + '）；60 秒 ' + idle.frames + ' 幀裡「建築周圍一個人都沒有」 ' +
     idle.empty + ' 幀');

  /* ══════════ 完工慶祝 ══════════ */
  await head('完工慶祝');
  /* 要讓它自己蓋到完工，不能用 completeNow：上一段測試把人放到地圖邊緣去遊蕩了，
     量到的會是「走回來多久」而不是「圍圈多快」。
     真的蓋完的那一刻，人都還站在工地邊上——那才是這段要量的起點。
     （從場外走回來那個場景自己有一條，在這一段的最後面） */
  const cheer = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 300; setWorkerCount(20); startBuild(true);
    for (let i = 0; i < 20000 && phase !== 'done'; i++) step(0.05);
    let allAt = -1, maxY = 0, jumps = 0, landed = 0, up = false, drift = 0, ring = null;
    const px = workers.map(w => w.x), pz = workers.map(w => w.z);
    /* 蓋完那一刻各自站在哪：這段的耗時就是「最遠那個人走回圈上」，
       數字不對時要能直接看出是誰、從多遠開始走（不然只剩一個秒數可以瞪）。 */
    const at0 = workers.map(w => ({ d: +Math.hypot(w.x, w.z).toFixed(1), mage: w.mage }));
    const arrive = workers.map(() => -1);
    for (let i = 0; i < 130; i++) {
      step(0.05);
      for (let k = 0; k < workers.length; k++)
        if (arrive[k] < 0 && workers[k].hail) arrive[k] = +(i * 0.05).toFixed(2);
      // 圈要在慶祝還沒結束時量：時間到了他們就散開去閒晃了
      if (i === 100) ring = workers.map(w => ({ d: +Math.hypot(w.x, w.z).toFixed(2),
                                                a: Math.atan2(w.z, w.x) }));
      if (allAt < 0 && workers.every(w => w.hail)) allAt = +(i * 0.05).toFixed(2);
      for (const w of workers) if (w.y > maxY) maxY = w.y;
      const w0 = workers[0];
      if (w0.y > 0.02 && !up) jumps++;            // 一次離地算一跳
      if (w0.y <= 0.02 && up) landed++;           // 每跳都要真的落回地面
      up = w0.y > 0.02;
      /* 就位之後就不該再有水平位移了（給一秒讓最後到的人站定）。
         舊版是繞著建築跑，這個數字會是每個人每一幀都在動。 */
      for (let k = 0; k < workers.length; k++) {
        const w = workers[k];
        if (allAt >= 0 && i * 0.05 > allAt + 1 && Math.hypot(w.x - px[k], w.z - pz[k]) > 1e-6) drift++;
        px[k] = w.x; pz[k] = w.z;
      }
    }
    // 圍成一圈：到中心的距離與相鄰角度差
    const ds = ring.map(r => r.d);
    const angs = ring.map(r => r.a).sort((a, b) => a - b);
    const gaps = angs.map((a, i) => {
      const b = i + 1 < angs.length ? angs[i + 1] : angs[0] + Math.PI * 2;
      return +((b - a) * 180 / Math.PI).toFixed(1);
    });
    // 慶祝完要散開去閒晃，不能一直杵在圈上
    for (let i = 0; i < 200; i++) step(0.05);
    const after = workers.filter(w => w.hail).length;
    const spread = Math.max(...workers.map(w => +Math.hypot(w.x, w.z).toFixed(2)));
    const slow = arrive.indexOf(Math.max.apply(null, arrive));
    return { allAt, maxY: +maxY.toFixed(2), jumps, landed, drift,
             slow: { d: at0[slow].d, mage: at0[slow].mage },
             farD: Math.max.apply(null, at0.map(o => o.d)),
             rad: { lo: Math.min(...ds), hi: Math.max(...ds), want: +cheerR().toFixed(2) },
             gap: { lo: Math.min(...gaps), hi: Math.max(...gaps), want: +(360 / workers.length).toFixed(1) },
             after, spread, siteR: +siteR.toFixed(1) };
  });
  /* 門檻 3.2 秒（v1.89 從 2.5 放寬）：這條原本假設「蓋完那一刻所有人都還在工地邊上」，
     而魔法師現在站在建材堆裡（v1.95 起料在多遠就走多遠），走回圈上要兩秒。
     實測 1.9～3.1 秒，慶祝總共 7 秒——他還跳得到四秒以上。
     再放寬就沒有意義了：那表示有人是趕到才散場。真的從碎料場外緣走回來那個場景
     由下面「蓋完時站在場外的人也趕得回慶祝圈」守（v1.95 起遠的人會跑，見 CHEER_IN）。 */
  ok('蓋完後很快就圍成一圈', cheer.allAt > 0 && cheer.allAt < 3.2,
     cheer.allAt + ' 秒全員就位（照現況分配位置，不是照編號硬分）；最後到的那個蓋完時站在 ' +
     cheer.slow.d + '（' + (cheer.slow.mage ? '魔法師' : '工人') + '），全場最遠 ' +
     cheer.farD + '，圈半徑 ' + cheer.rad.want);
  ok('圍的是等分的一圈', cheer.gap.hi - cheer.gap.lo < 1 &&
     Math.abs(cheer.gap.lo - cheer.gap.want) < 1 && cheer.rad.hi - cheer.rad.lo < 0.1 &&
     Math.abs(cheer.rad.lo - cheer.rad.want) < 0.15,
     '相鄰間隔 ' + cheer.gap.lo + '–' + cheer.gap.hi + '°（等分是 ' + cheer.gap.want +
     '°）、半徑 ' + cheer.rad.lo + '–' + cheer.rad.hi + '（該站 ' + cheer.rad.want +
     '，建築半徑 ' + cheer.siteR + '）');
  /* 慶祝感的重點是「跳」：離地要有高度、要落回地面、而且是站定了跳不是邊跑邊顛。
     舊版是繞著建築跑一圈，y 用 |sin| 連續起伏——那看起來像在漂浮。 */
  ok('站定原地跳，不是邊跑邊顛', cheer.jumps >= 5 && cheer.landed >= 5 &&
     cheer.maxY > 0.4 && cheer.drift === 0,
     '慶祝的六秒半裡跳 ' + cheer.jumps + ' 次、落地 ' + cheer.landed + ' 次，最高 ' +
     cheer.maxY + '；就位後還在水平移動的人次 ' + cheer.drift);
  /* 蓋完那一刻站在場外的人也要趕得回圈上（v1.95）。魔法師現在會跟著料走到碎料場外緣
     （實測半徑 63），用平常的腳程 6.8 要走六秒半，而慶祝總共只有七秒——v1.94 之前
     在這個場景是「十秒內從來沒有全員到齊」，四個人整段都在路上。
     修法是進場那一趟照距離算腳程（CHEER_IN），遠的人跑回來。 */
  const cheerFar = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 900; setWorkerCount(20); startBuild(true);
    for (let i = 0; i < 40; i++) step(0.05);
    const R = arenaR;                                // 全員先放到碎料場外緣
    workers.forEach((w, i) => {
      const a = i / workers.length * Math.PI * 2;
      w.x = Math.cos(a) * R; w.z = Math.sin(a) * R;
      releaseWorker(w); w.cheer = 0; w.st = 'idle'; w.mang = a; w.mrad = R;
    });
    const from = Math.max.apply(null, workers.map(w => Math.hypot(w.x, w.z)));
    completeNow();                                   // 「立刻建成」→ 進慶祝
    let allAt = -1, jumps = 0, up = false;
    for (let i = 0; i < 200; i++) {
      step(0.05);
      if (allAt < 0 && workers.every(w => w.hail)) allAt = +(i * 0.05).toFixed(2);
      const w0 = workers[0];
      if (w0.y > 0.02 && !up) jumps++;
      up = w0.y > 0.02;
    }
    return { allAt, jumps, from: +from.toFixed(1), ring: +cheerR().toFixed(1),
             fast: +Math.max.apply(null, workers.map(w => w.crun)).toFixed(1), walk: WALK };
  });
  ok('蓋完時站在場外的人也趕得回慶祝圈',
     cheerFar.allAt > 0 && cheerFar.allAt < 3.2 && cheerFar.jumps >= 4,
     '從半徑 ' + cheerFar.from + ' 走回半徑 ' + cheerFar.ring + ' 的圈上花 ' +
     cheerFar.allAt + ' 秒（最快的人腳程 ' + cheerFar.fast + '，平常走路是 ' +
     cheerFar.walk + '），第一個人在慶祝的十秒裡跳了 ' + cheerFar.jumps + ' 次');
  ok('慶祝完就散開去閒晃', cheer.after === 0 && cheer.spread > cheer.rad.hi + 3,
     '還在舉手的 ' + cheer.after + ' 人，最遠走到 ' + cheer.spread);

  /* 使用者回報「慶祝散場有時候一圈的小人都整齊往外走」。量出來的成因有三個，
     形狀都是同一個：
       · w.cheer 是各自從 0 累加的，完工那一刻全員歸零 → 七秒同一幀到期
         （實測 20 個人第一次動起來全落在散場後第 5 幀）
       · 散場後的目標點取整片草地（arenaR + 20 的方形，實測目標半徑中位數 46），
         而人站在半徑 14.9 的圈上 → 每個人的第一段路都朝外，
         平均徑向分量 +0.25～+0.42、2.8 秒內平均半徑 14.9 → 19.9
       · 第一段還會先一起往內縮 1.1 格：沿用的是完工時留下的目標點 (0, 0)，
         strollTo 把它推到工地外圈，於是整圈人同時往內、同時抵達、再同時往外
     v1.96 三個一起修（散場時間各抽延遲 CHEER_OUT、閒晃收回外圈那一環、
     起腳那一刻重新挑目標），這條守的是「不整齊」本身。 */
  const scatter = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 900; setWorkerCount(20); startBuild(true); completeNow();
    const dt = 1 / 60;
    let t = 0;
    while (t < CHEER_T - 0.1) { step(dt); t += dt; }      // 跑到散場前一刻
    const n = workers.length;
    const first = workers.map(() => -1);
    const cnt = new Map();
    let mov = 0, radial = 0;
    let prev = workers.map(w => ({ x: w.x, z: w.z }));
    for (let i = 0; i < 240; i++) {                       // 散場後四秒
      step(dt);
      for (let k = 0; k < n; k++) {
        const w = workers[k];
        const mx = w.x - prev[k].x, mz = w.z - prev[k].z;
        const m = Math.hypot(mx, mz);
        prev[k] = { x: w.x, z: w.z };
        if (m <= 1e-4) continue;
        if (first[k] < 0) { first[k] = i; cnt.set(i, (cnt.get(i) || 0) + 1); }
        const r = Math.hypot(w.x, w.z) || 1e-9;
        radial += (mx * w.x / r + mz * w.z / r) / m;       // +1 = 正往外走
        mov++;
      }
    }
    for (let i = 0; i < 200; i++) step(0.05);             // 再閒晃十秒
    const rad = workers.map(w => Math.hypot(w.x, w.z));
    const started = first.filter(f => f >= 0);
    return { n, sync: Math.max(...cnt.values()), started: started.length,
             spread: +((Math.max(...started) - Math.min(...started)) * dt).toFixed(2),
             radial: +(radial / mov).toFixed(2),
             far: +Math.max(...rad).toFixed(1), siteR: +siteR.toFixed(1),
             band: IDLE_FAR, arenaR: +arenaR.toFixed(1) };
  });
  ok('散場不會整圈一起往外走',
     scatter.started >= scatter.n - 2 && scatter.sync <= 5 && scatter.spread > 0.5 &&
     Math.abs(scatter.radial) < 0.2 && scatter.far < scatter.siteR + scatter.band + 1.5,
     scatter.n + ' 人裡 ' + scatter.started + ' 人走了、最多 ' + scatter.sync +
     ' 人同一幀起步（改之前是 20 人全在同一幀），' +
     '起步時間前後差 ' + scatter.spread + ' 秒；平均徑向分量 ' + scatter.radial +
     '（改之前 +0.25～+0.42），十秒後最遠走到 ' + scatter.far +
     '（環外緣 ' + (scatter.siteR + scatter.band).toFixed(1) + '，碎料場外緣 ' + scatter.arenaR + '）');

  /* 彩帶（v1.96，使用者要的）。紙片借塵霧那個池子畫（給非等比縮放就是一張薄紙片），
     所以判斷「這顆是彩帶」看有沒有 sy。四件事要成立：真的有噴、飛得起來、
     多數往建築那邊噴（往外噴的話紙片全落在圈外，圈裡反而是空的）、
     而且不會把塵霧池吃光——玩家隨時可以在慶祝中丟一發核彈，那朵蘑菇雲要有位子站。 */
  const conf = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 300; setWorkerCount(20); startBuild(true);
    dust.length = 0;
    const isC = d => d.sy !== undefined;
    let build = 0;
    for (let i = 0; i < 100; i++) { step(0.05); build += dust.filter(isC).length; }
    completeNow();
    let peak = 0, ever = 0, maxY = 0, inward = 0, outward = 0, all = 0, rest = 0;
    for (let i = 0; i < 200; i++) {
      const was = new Set(dust.filter(isC));
      step(0.05);
      const c = dust.filter(isC);
      for (const d of c) if (!was.has(d)) {
        ever++;
        const r = Math.hypot(d.x, d.z) || 1;
        if (d.vx * d.x / r + d.vz * d.z / r < 0) inward++; else outward++;
      }
      peak = Math.max(peak, c.length);
      all = Math.max(all, dust.length);
      rest = Math.max(rest, c.filter(d => d.y <= 0.11).length);
      for (const d of c) maxY = Math.max(maxY, d.y);
    }
    /* 散場之後不該再**噴**（慶祝完就沒有彩帶了）。數的是「這一幀新生出來的」——
       數「還在的」會把上一束還飄在半空、還躺在草地上的紙片算進來（實測 729）。 */
    let late = 0;
    for (let i = 0; i < 120; i++) {
      const was = new Set(dust.filter(isC));
      step(0.05);
      for (const d of dust.filter(isC)) if (!was.has(d)) late++;
    }
    dust.length = 0;
    return { build, ever, peak, all, maxY: +maxY.toFixed(1), inward, outward, rest, late,
             cap: ENG.MAXDUST };
  });
  ok('圍圈慶祝時會噴彩帶，施工中不會',
     conf.build === 0 && conf.ever > 300 && conf.peak > 100 && conf.maxY > 4 &&
     conf.inward > conf.outward * 2 && conf.rest > 0 && conf.all <= conf.cap && conf.late === 0,
     '慶祝的十秒噴了 ' + conf.ever + ' 片（同時最多 ' + conf.peak + ' 片，最高飛到 ' +
     conf.maxY + '，往建築那邊的 ' + conf.inward + ' 片、往外的 ' + conf.outward +
     ' 片，落地停住的最多 ' + conf.rest + ' 片）；塵霧池同時最多 ' + conf.all +
     ' 顆（引擎上限 ' + conf.cap + '），施工中噴了 ' + conf.build + ' 片、散場後 ' +
     conf.late + ' 片');

  /* 慶祝完交談先進冷卻（v1.60）。圈上兩個人只隔 CHEER_GAP 1.9 格，比「多近才聊得起來」
     的 CHAT_D 2.6 還近——不推冷卻的話散場那一瞬間整圈人同時配對，
     剛跳完就變成一圈人兩兩站著講話。冷卻是「先不要」不是「不准」，過一陣子要聊得起來。 */
  const coolChat = await page.evaluate(() => {
    /* 要用擠得滿的那種圈：人少的時候圈上間隔就大於 CHAT_D，本來就聊不起來，
       那樣測到的是「反正沒人靠近」。六十個人的圈才是每人分到 CHEER_GAP 1.9 格。 */
    shapePick = SHAPES.findIndex(s => s.n === '木魚');
    targetCnt = 1800; setWorkerCount(60); startBuild(true);
    for (const w of workers) {
      const a = Math.random() * Math.PI * 2, d = siteR + rr(3, 9);
      w.x = Math.cos(a) * d; w.z = Math.sin(a) * d;
      w.chat = 0; w.chatCd = 0;
    }
    completeNow();
    /* 等到**每個人都散場**。v1.96 起散場時間各抽 0～CHEER_OUT 秒的延遲，
       拿 CHEER_T 直接比的話會停在「還有人在跳」那一刻，那些人的冷卻還沒推下去。 */
    let guard = 0;
    while (guard++ < 400 && workers.some(w => cheerOn(w))) step(0.05);
    // 散場那一刻的狀態：全員該進冷卻，而且真的有很多對站在聊得起來的距離內
    const cd = workers.filter(w => w.chatCd > 0).length;
    const lo = +Math.min(...workers.map(w => w.chatCd)).toFixed(1);
    let near = 0;
    for (let a = 0; a < workers.length; a++)
      for (let b = a + 1; b < workers.length; b++)
        if (Math.hypot(workers[a].x - workers[b].x, workers[a].z - workers[b].z) < CHAT_D) near++;
    let chats = 0;
    for (let i = 0; i < 150; i++) {                 // 7.5 秒：比最短的冷卻（CHAT_CD）短
      step(0.05);
      chats = Math.max(chats, workers.filter(w => w.chat > 0).length);
    }
    let later = 0;                                   // 冷卻跑完之後照樣聊得起來
    for (let i = 0; i < 1200; i++) {
      step(0.05);
      later = Math.max(later, workers.filter(w => w.chat > 0).length);
    }
    return { cd, lo, near, chats, later, n: workers.length, cdMin: CHAT_CD, out: CHEER_OUT };
  });
  /* 「最短還剩多久」的門檻要扣掉散場的錯開（v1.96）：先散場的那個人，冷卻已經比
     最後散場的那個多跑了 CHEER_OUT 秒（實測 60 人裡最短剩 7.6 秒，冷卻是 9 秒起跳）。 */
  ok('慶祝完交談進入冷卻，不會剛跳完就整圈聊起來',
     coolChat.cd === coolChat.n && coolChat.lo > coolChat.cdMin - coolChat.out - 0.3 &&
     coolChat.near > 5 && coolChat.chats === 0,
     coolChat.cd + '/' + coolChat.n + ' 人全部進冷卻（最短還剩 ' + coolChat.lo +
     ' 秒，冷卻 ' + coolChat.cdMin + ' 秒起跳、散場錯開最多 ' + coolChat.out +
     ' 秒），散場那一刻站在 2.6 格內的有 ' +
     coolChat.near + ' 對，之後 7.5 秒聊起來的 ' + coolChat.chats + ' 人');
  ok('冷卻過了照樣會聊天', coolChat.later > 0, '之後有 ' + coolChat.later + ' 人在聊');
  /* 圈的半徑本來寫死 siteR + 2.6。最小的建築 siteR 只有 7，那一圈長 60 格，
     分給 60 個人是每人 1 格——小人放大之後（連手臂約 1.56 格寬）整圈會插在一起。
     所以半徑要跟著人數走，這條驗的是「人多的時候真的撐得開」。 */
  const crowd = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '木魚');
    targetCnt = 1800; setWorkerCount(60); startBuild(true);
    /* 上一段測試把人散到四十單位外去了，從那裡走回來要九秒——比慶祝本身還久。
       真的蓋完的那一刻，人都還在工地邊上，所以先把大家擺回工地旁邊。
       一定要在 completeNow() **之前**：圈上的位置是照「那一刻各自站的角度」分的，
       先分完再瞬移的話，每個人都得繞半圈去自己的位置，七秒根本走不到。 */
    for (const w of workers) {
      const a = Math.random() * Math.PI * 2, d = siteR + rr(3, 9);
      w.x = Math.cos(a) * d; w.z = Math.sin(a) * d;
    }
    completeNow();
    for (let i = 0; i < 120; i++) step(0.05);        // 6 秒：慶祝只有 7 秒，滿了他們就散開了
    const on = workers.map(w => ({ a: Math.atan2(w.z, w.x), r: Math.hypot(w.x, w.z) }))
                      .sort((p, q) => p.a - q.a);
    let gap = 1e9;                                   // 圈上相鄰兩人的最小弧長
    for (let i = 0; i < on.length; i++) {
      const b = on[(i + 1) % on.length];
      const d = Math.abs(((b.a - on[i].a + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      gap = Math.min(gap, d * on[i].r);
    }
    return { gap: +gap.toFixed(2), r: +on[0].r.toFixed(1),
             hail: workers.filter(w => w.hail).length, tight: +(siteR + 2.6).toFixed(1) };
  });
  ok('六十個人的慶祝圈會撐開，不會擠成一團',
     crowd.gap > 1.7 && crowd.hail >= 55,
     crowd.hail + ' 人在圈上，半徑撐到 ' + crowd.r + '（寫死的話是 ' + crowd.tight +
     '），每人分到 ' + crowd.gap + ' 格');

  /* 慶祝只有完工後那一次（v1.120，使用者：「有觀察到小人慶祝 被核彈嚇跑 然後又跑回去
     慶祝，慶祝應該只要完工後一次就好」）。
     ① 被嚇跑就算散場，跑回來不會再站一圈跳。改之前 startFlee 把 w.cheer 歸零，而核彈的
        逃命只有 3.4 秒（NUKE_WAIT + NUKE_FALL + FLEE_TAIL）、魔法陣 6.6 秒，都比七秒的
        慶祝短，所以人跑回來時窗口還開著，又站一圈跳滿七秒。
        彩帶一起驗（散場後就不該再噴），順便驗他們是回到建築外圈那一環閒晃，
        不是留在原地——startFlee 那裡先幫他們挑好了閒晃點。 */
  const cheerFlee = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 3000; setWorkerCount(20); startBuild(true);
    /* 圈上的位置是照「完工那一刻各自站的角度」分的，所以要在 completeNow() 之前
       先把人擺回工地旁邊（同上一段 crowd 的理由），不然量到的是「走回來多久」。 */
    for (const w of workers) {
      const a = Math.random() * Math.PI * 2, d = siteR + rr(3, 9);
      w.x = Math.cos(a) * d; w.z = Math.sin(a) * d;
    }
    completeNow();
    for (let i = 0; i < 60; i++) step(0.05);           // 慶祝三秒：圈站起來了，正在跳
    const jumping = workers.filter(w => w.hail).length;
    dust.length = 0;
    const isC = d => d.sy !== undefined;               // 彩帶＝給了非等比縮放的那些塵霧
    callNuke({ x: 0, z: 0 });                          // 預告一出現全場就跑（v1.96）
    const fled = workers.filter(w => w.flee > 0).length;
    const still = workers.filter(w => cheerOn(w)).length;
    let hail = 0, conf = 0, t = 0;
    while (t < 20) {                                   // 逃命 3.4 秒 ＋ 走回來的時間
      const was = new Set(dust.filter(isC));
      step(0.05); t += 0.05;
      /* 一發核彈就把 3000 塊的金字塔打到剩不足 WRECK_AT，再 SWAP_WAIT 秒就自動換
         下一座（實測第 5.8 秒 phase 變 clear，人全被推到 arenaR×0.78 去等整地，
         這一條就變成「量整地」而不是「量慶祝」了）。把換場的計時壓住，
         讓場子留在 wreck：這一條要看的是嚇跑之後會不會回去跳。 */
      swapWait = 0;
      hail = Math.max(hail, workers.filter(w => w.hail).length);
      for (const d of dust.filter(isC)) if (!was.has(d)) conf++;
    }
    const r = { jumping, fled, still, hail, conf, n: workers.length, ph: phase,
                back: workers.filter(w => Math.hypot(w.x, w.z) < siteR + IDLE_FAR + 4).length,
                far: +Math.max(...workers.map(w => Math.hypot(w.x, w.z))).toFixed(1) };
    cleanTools(); dust.length = 0;
    return r;
  });
  ok('慶祝中被核彈嚇跑就算散場，不會跑回去再跳一輪',
     cheerFlee.jumping > 15 && cheerFlee.fled === cheerFlee.n &&
     cheerFlee.still === 0 && cheerFlee.hail === 0 && cheerFlee.conf === 0 &&
     (cheerFlee.ph === 'done' || cheerFlee.ph === 'wreck'),
     '嚇跑前 ' + cheerFlee.jumping + '/' + cheerFlee.n + ' 人在跳；下令那一刻 ' +
     cheerFlee.fled + ' 人起跑、' + cheerFlee.still + ' 人的慶祝窗口還開著；' +
     '之後 20 秒最多 ' + cheerFlee.hail + ' 人舉手、彩帶噴了 ' + cheerFlee.conf + ' 片');
  ok('嚇跑之後回建築外圈閒晃，不是留在跑出去的地方',
     cheerFlee.back >= cheerFlee.n * 0.7,
     cheerFlee.back + '/' + cheerFlee.n + ' 人回到外圈那一環（半徑 ' +
     '建築 + 9 + 4 以內），最遠的還在 ' + cheerFlee.far);

  /* ② 慶祝的鐘不會被中斷「暫停」：被炸飛的人落地後只補完剩下的那一段，不是重新開始
     （改之前 tossWorker 也把 w.cheer 歸零，那個人會在別人都散場之後自己跳滿七秒）。
     鐘擺在 updWorker 開頭、所有 return 之前就是為了這個：被炸飛、被震倒、在燒的那幾秒
     照算，慶祝是「完工後那一段時間」不是「站在圈上跳了七秒」。 */
  const cheerHit = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 3000; setWorkerCount(20); startBuild(true);
    for (const w of workers) {
      const a = Math.random() * Math.PI * 2, d = siteR + rr(3, 9);
      w.x = Math.cos(a) * d; w.z = Math.sin(a) * d;
    }
    completeNow();
    let t = 0;
    for (let i = 0; i < 60; i++) { step(0.05); t += 0.05; }
    const w0 = workers[0], w1 = workers[1];
    tossWorker(w0, 7, 10, 0, 0);                       // 一個人被炸飛（不是被嚇跑）
    let air = 0, last = -1;
    const end = CHEER_T + CHEER_OUT + 8;
    while (t < end) {
      step(0.05); t += 0.05;
      if (w0.air) air += 0.05;
      if (workers.some(w => w.hail)) last = +t.toFixed(2);
    }
    const r = { air: +air.toFixed(2), gap: +(w1.cheer - w0.cheer).toFixed(3), last,
                win: +(CHEER_T + CHEER_OUT).toFixed(1) };
    cleanTools();
    return r;
  });
  ok('被炸飛的人不會把慶祝重新開始，窗口過了全場都不再跳',
     cheerHit.air > 0.5 && Math.abs(cheerHit.gap) < 0.06 &&
     cheerHit.last > 0 && cheerHit.last <= cheerHit.win + 0.2,
     '被炸飛的那個人在空中 ' + cheerHit.air + ' 秒，他的慶祝鐘跟沒被炸的差 ' +
     cheerHit.gap + ' 秒（改之前是歸零重來）；最後一次有人舉手是完工後第 ' +
     cheerHit.last + ' 秒（窗口 ' + cheerHit.win + ' 秒）');

  /* ══════════ 工程師 ══════════ */
  await head('工程師');
  const engr = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 600; setWorkerCount(12); startBuild(true);
    const e = workers[0];
    let n = 0, carried = 0, claimed = 0, plan = 0, point = 0, near = Infinity, far = 0;
    const angs = [];
    /* 先等他走到定位再開始量，不然量到的第一段是「走過來」——上一段測試可能
       把他丟在四十單位外遊蕩，用寫死的秒數等會時靈時不靈。 */
    const ring = siteR + 3.4;
    for (let i = 0; i < 400 && Math.abs(Math.hypot(e.x, e.z) - ring) > 0.1; i++) step(0.05);
    for (let i = 0; i < 2400 && phase === 'build'; i++) {
      step(0.05);
      n++;
      if (e.carry) carried++;
      if (e.load.length) claimed++;
      if (e.plan) plan++;
      if (e.point > 0) point++;
      const d = Math.hypot(e.x, e.z);
      if (d < near) near = d;
      if (d > far) far = d;
      if (i % 200 === 0) angs.push(Math.round(Math.atan2(e.z, e.x) * 180 / Math.PI));
    }
    return { n, carried, claimed, planPct: +(plan / n).toFixed(2), pointPct: +(point / n).toFixed(2),
             near: +near.toFixed(1), far: +far.toFixed(1), siteR: +siteR.toFixed(1),
             moves: new Set(angs).size, samples: angs.length,
             others: workers.slice(1).filter(w => w.eng).length,
             placed: placedCnt, carriedAll: stats.carried };
  });
  ok('工程師只有一個，而且不搬積木', engr.others === 0 && engr.carried === 0 && engr.claimed === 0,
     '其他人當工程師的 ' + engr.others + ' 個；' + (engr.n * 0.05).toFixed(0) +
     ' 秒內他搬了 ' + engr.carried + ' 幀、認領了 ' + engr.claimed + ' 格（其他人共搬了 ' +
     engr.carriedAll + ' 趟）');
  ok('施工中一直拿著設計圖在看', engr.planPct === 1,
     '拿著圖的幀數占 ' + (engr.planPct * 100).toFixed(0) + '%');
  /* 「站在建築外面」是這一條真正守得住的東西：實測 near／far 是 14.0～14.3 對 siteR 10.9，
     他貼著 siteR + ENG_KEEP 那一圈站，一步都不進工地。
     **「他會換位置」那一半 v1.128 拆出去了**（見下一條）：本來是「取樣 8～12 次、
     相異角度要 ≥ 2」，但那是在賭骰子——每次決策 ENG_POINT（62%）抽到「指揮」、
     只有 38% 是換位置，整輪蓋 70 秒約 13 次決策，「一次都沒抽到換位置」的機率是
     0.62¹³ ≈ 1/830。實測單獨跑 25 輪是 4～11 個角度（中位數 9），但整輪跑的時候
     真的開出過 1 個。相異角度數留在訊息裡當參考，不再拿它當斷言。 */
  ok('站在建築外圍，一步都不進工地',
     engr.near > engr.siteR && engr.far < engr.siteR + 4,
     '離工地中心 ' + engr.near + '–' + engr.far + '（建築半徑 ' + engr.siteR +
     '），' + engr.samples + ' 次取樣裡站過 ' + engr.moves + ' 個不同角度');

  /* 「換位置」改成**把骰子固定住**直接驗那一支邏輯（v1.128，理由見上一條）。
     `Math.random` 回 0.99 → `Math.random() < ENG_POINT` 為假 → 一定走換位置那一支；
     連 `rr(0.5, 1.5)` 也被固定成 1.49、左右那一抽固定成 +1，所以角度一定加 1.49 rad。
     這樣還順便守住一件事：ENG_POINT 要是哪天被改成 1（＝永遠只指揮、不再換位置），
     `0.99 < 1` 為真，角度不會變，這一條就會抓到。
     固定亂數只包住「做決策」那一幀，走過去那 10 秒放回真的亂數——
     要驗的是他真的走到新角度，不是走位途中也照著假骰子跑。 */
  const engMove = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 900; setWorkerCount(12); startBuild(true);
    shapePick = -1;
    const e = workers[0];
    /* **直接把他放到那一圈上**，不要「走到定位為止」。第一版是等
       `|半徑 − (siteR + ENG_KEEP)| ≤ 0.1`，但建材一直在往上疊、`siteR` 跟著長，
       那一圈本身是會動的——他等於一路追著跑，`ringWalk` 永遠回報「還沒到」，
       於是 `updEng` 每幀提早 return，決策那一段根本跑不到（整輪跑的時候踩到過：
       目標角度加了 0 rad）。放好之後 dA 與 dr 都是 0，`ringWalk` 當幀就回報到位。 */
    const ring = siteR + ENG_KEEP;
    e.x = Math.cos(e.eang) * ring; e.z = Math.sin(e.eang) * ring;
    step(0.05);
    /* 再擺一次（v1.148.1）：上面那一幀裡小人又疊了幾塊上去、`siteR` 跟著長，
       他就不在那一圈上了——`ringWalk` 一樣會回報「還沒到」，決策那一段還是跑不到。
       整輪測試又踩到一次（目標角度加了 0 rad），所以擺的時機要**貼著決策那一行**，
       不能中間再隔一幀。 */
    e.x = Math.cos(e.eang) * (siteR + ENG_KEEP);
    e.z = Math.sin(e.eang) * (siteR + ENG_KEEP);
    const settled = Math.abs(Math.hypot(e.x, e.z) - (siteR + ENG_KEEP)) < 0.5;
    const a0 = Math.atan2(e.z, e.x), eang0 = e.eang;
    const real = Math.random;
    Math.random = () => 0.99;
    e.point = 0; e.et = 0;                      // 逼他這一幀就做決策
    updEng(e, 0.05);
    Math.random = real;
    const dAng = e.eang - eang0;
    /* 走過去這一段不讓他再做新決策：et 給一個大數，updEng 就只剩走位那一段。
       不這樣的話途中還會抽兩三次籤，抽到往回走的話這一條又變成在賭骰子。 */
    e.et = 999;
    /* 「有沒有抄捷徑穿過工地」量的是**離那一圈有多遠**，不是絕對半徑：
       建材一直在往上疊，siteR 會跟著長，拿固定的半徑當界線會被那件事帶著跑。 */
    let devLo = Infinity, devHi = -Infinity, n = 0;
    for (let i = 0; i < 400 && phase === 'build'; i++) {
      step(0.05); n++;
      const dev = Math.hypot(e.x, e.z) - (siteR + ENG_KEEP);
      devLo = Math.min(devLo, dev); devHi = Math.max(devHi, dev);
    }
    let turned = Math.atan2(e.z, e.x) - a0;
    turned = Math.atan2(Math.sin(turned), Math.cos(turned));
    return { settled, eng: e.eng, dAng: +dAng.toFixed(2), n,
             turned: Math.abs(Math.round(turned * 180 / Math.PI)),
             devLo: +devLo.toFixed(2), devHi: +devHi.toFixed(2),
             want: Math.round(Math.abs(dAng) * 180 / Math.PI), keep: ENG_KEEP,
             pt: ENG_POINT };
  });
  ok('骰子指到「換位置」時，他真的換一個角度站',
     engMove.settled && engMove.eng === 1 && engMove.dAng > 0.5 && engMove.dAng < 1.5 &&
     engMove.n > 200 && engMove.turned > 25,
     '把骰子固定成 0.99（＞ ENG_POINT ' + engMove.pt + '）→ 目標角度加了 ' +
     engMove.dAng + ' rad（' + engMove.want + '°），' + (engMove.n * 0.05).toFixed(0) +
     ' 秒後人真的轉了 ' + engMove.turned + '°');
  ok('換位置的路上也是貼著外圈走，不會抄捷徑穿過工地',
     engMove.devLo > -1 && engMove.devHi < 1,
     '整段離「工地外圍 + ' + engMove.keep + '」那一圈 ' + engMove.devLo + ' ～ ' +
     engMove.devHi + ' 單位');
  ok('偶爾會做指揮動作', engr.pointPct > 0.03 && engr.pointPct < 0.5,
     '指揮的幀數占 ' + (engr.pointPct * 100).toFixed(0) + '%');
  /* 只有一個人的時候不能把他派去看圖，不然這座永遠蓋不起來 */
  const solo = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 300; setWorkerCount(1); startBuild(true);
    const eng1 = workers.filter(w => w.eng).length;
    for (let i = 0; i < 3000 && phase === 'build'; i++) step(0.05);
    const built = placedCnt;
    setWorkerCount(8);
    return { eng1, built, eng8: workers.filter(w => w.eng).length,
             idx: workers.findIndex(w => w.eng) };
  });
  ok('只剩一個人時不派工程師，照樣蓋得起來',
     solo.eng1 === 0 && solo.built > 30 && solo.eng8 === 1 && solo.idx === 0,
     '1 人時工程師 ' + solo.eng1 + ' 個、蓋了 ' + solo.built + ' 塊；加到 8 人後第 ' +
     solo.idx + ' 號接任');

  /* ══════════ 魔法師 ══════════ */
  await head('魔法師');
  /* v1.64：十個人有一個是魔法師，站在工地旁邊隔空把建材拋上去。
     這一段驗的是「他真的沒搬」——不是看畫面上有沒有巫師帽，而是看那些積木
     從躺著的地方直接進拋物線，中途沒有任何一幀是被人舉在手上的。
     工人自己丟的那些拿來當對照組：同一份資料裡兩種拋物線的長度、起點距離都量。 */
  await installClean(page);            // scatterFree() 裝在這裡面
  const wz = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 900; setWorkerCount(20); startBuild(true);
    scatterFree();                     // 建材鋪回工地外面（見 installClean 裡的說明）
    const mi = workers.map((w, i) => w.mage ? i : -1).filter(i => i >= 0);
    const m = workers[mi[0]];
    let carried = 0, loadMax = 0, flyMax = 0, cast = 0, near = Infinity, far = 0;
    let starMax = 0, inHand = 0, launches = 0, frames = 0, lastN = 0, lastAt = -1;
    let jobF = 0, castJob = 0, walked = 0;
    const mDur = [], wDur = [], mY0 = [], wY0 = [], reach = [], gaps = [], arc = [];
    const spots = new Set();
    const seen = new Set();
    let px = m.x, pz = m.z;
    /* 先等他走到料堆前站定再開始量：上一段測試可能把他丟在工地正中央，
       那一段「走過來」會被算成「他站得多近」。
       v1.89 起他站的位置跟著料堆跑，不再是工地外圈的固定半徑，所以等的是「開始施法」。 */
    for (let i = 0; i < 400 && m.st !== 'cast'; i++) step(0.05);
    for (let i = 0; i < 3000 && phase === 'build'; i++) {
      step(0.05); frames++;
      if (m.carry) carried++;
      loadMax = Math.max(loadMax, m.load.length);
      if (m.cast > 0.5) cast++;
      // 手上有料的那幾幀杖該是舉著的（沒料可搆時他會收杖，那是另一條測試的事）
      if (m.load.length) { jobF++; if (m.cast > 0.5) castJob++; }
      walked += Math.hypot(m.x - px, m.z - pz); px = m.x; pz = m.z;
      if (m.st === 'cast') {                        // 施工中站哪裡（閒著沒事去閒晃的不算）
        const d = Math.hypot(m.x, m.z);
        if (d < near) near = d;
        if (d > far) far = d;
      }
      starMax = Math.max(starMax, stars.length);
      // 魔法師名下的積木，任何一幀都不該是「被舉在手上」（st 1 = CARRY）
      for (const b of blocks) if (b.st === 1 && mi.indexOf(b.holder) >= 0) inHand++;
      if (m.fly.length > lastN) {                   // 這一幀他又發了一塊
        launches++;
        const a = blocks[m.fly[m.fly.length - 1].b].arc;
        if (a) {
          reach.push(Math.hypot(a.x0 - m.x, a.z0 - m.z));        // 出手那一刻那塊料離他多遠
          arc.push(Math.hypot(a.x1 - a.x0, a.z1 - a.z0));        // 那塊料飛過去的水平距離
          spots.add(Math.round(m.x / 6) + ':' + Math.round(m.z / 6));   // 他在幾個地方發過料
        }
        if (lastAt >= 0) gaps.push((i - lastAt) * 0.05);         // 距離上一發幾秒
        lastAt = i;
      }
      lastN = m.fly.length;
      flyMax = Math.max(flyMax, m.fly.length);      // 他發出去、此刻還在飛的有幾塊
      for (let k = 0; k < blocks.length; k++) {
        const b = blocks[k];
        if (b.st !== 2 || !b.arc) continue;
        const key = k + ':' + b.slot;
        if (seen.has(key)) continue;
        seen.add(key);
        // 起飛高度就是「這塊料當時在哪」：躺在地上是半格高，被舉在頭上是兩格多
        if (b.arc.mage) { mDur.push(b.arc.dur); mY0.push(b.arc.y0); }
        else if (!b.arc.hurl) { wDur.push(b.arc.dur); wY0.push(b.arc.y0); }   // 肌肉小人那條另外量
      }
    }
    const med = a => a.length ? +a.slice().sort((x, y) => x - y)[a.length >> 1].toFixed(2) : -1;
    return { mi, carried, loadMax, flyMax, inHand, launches, frames, starMax,
             castPct: +(cast / frames).toFixed(2), near: +near.toFixed(1), far: +far.toFixed(1),
             jobCast: +(castJob / (jobF || 1)).toFixed(3), jobF,
             siteR: +siteR.toFixed(1), mN: mDur.length, wN: wDur.length,
             mDur: med(mDur), wDur: med(wDur), mY0: med(mY0), wY0: med(wY0),
             reach: med(reach), reachMax: +Math.max.apply(null, reach.concat(0)).toFixed(2),
             REACH: MAGE_REACH, arc: med(arc), walked: +walked.toFixed(0), spots: spots.size,
             gap: med(gaps), placed: placedCnt };
  });
  ok('魔法師一塊積木都不搬', wz.carried === 0 && wz.inHand === 0 && wz.launches > 20,
     wz.frames + ' 幀裡他舉著積木 ' + wz.carried + ' 幀、名下有積木被舉在手上 ' +
     wz.inHand + ' 幀；同一段時間他發了 ' + wz.launches + ' 塊出去');
  /* 「直接拋到位置上」看起飛高度：那一發是從地上起飛的（被人搬的話是從頭頂丟出去的）。 */
  ok('建材是從躺著的地方直接飛上去的，不是先搬到工地邊再丟',
     wz.mN > 20 && wz.mY0 < 1 && wz.wY0 > 2,
     '魔法師的 ' + wz.mN + ' 條拋物線從離地 ' + wz.mY0 +
     ' 格起飛；工人自己丟的 ' + wz.wN + ' 條是從頭頂 ' + wz.wY0 + ' 格丟出去的');
  /* v1.89（使用者指定「只能搬運一定範圍的積木……是為了讓他比較靠近積木堆，
     看得出來是他在施法搬運」）：搆得到的只有腳邊 MAGE_REACH 格內的料，
     **拋出去那一段不受限**——所以「出手距離」要小、「那條拋物線」要長。
     這一條同時是 v1.88 的紅檢：那時他站在工地外圈、料在哪就吸哪，出手距離沒有上限。 */
  ok('只拉得動腳邊那一圈的料，拋出去的那一段不受限',
     wz.reachMax <= wz.REACH + 0.01 && wz.reach < wz.REACH * 0.8 && wz.arc > wz.REACH * 1.5,
     '出手時那塊料離他 ' + wz.reach + ' 格（最遠 ' + wz.reachMax + '，上限 ' + wz.REACH +
     '），那塊料飛過去的水平距離 ' + wz.arc + ' 格');
  /* 腳邊那一圈搬空了就換一坨：看整段走了多遠。v1.88 之前他釘在工地外圈的一個角度上，
     暖機走到位之後就再也不動（走 0 格），所以這條同時是那一版的紅檢。
     實測 110 秒走 11～88 格（開場的料是從工地邊緣往外鋪的，所以他多半在外圈那一帶
     挪，不是滿場跑；料被轟遠時他會走過去，見下面那條）。「發過料的地點」只放進說明不當門檻——他常常在同一個 6 格方格裡
     挪好幾次，量到 1 也不代表他沒換過地方。 */
  ok('腳邊的料搬完就走去下一堆', wz.walked > 6,
     '整段走了 ' + wz.walked + ' 格、在 ' + wz.spots + ' 個 6 格方格裡發過料');
  ok('飛得比工人丟的慢一倍以上', wz.mDur > 1.2 && wz.mDur > wz.wDur * 2,
     '魔法師 ' + wz.mDur + ' 秒／塊，工人 ' + wz.wDur + ' 秒／塊（都取中位數）');
  /* v1.64.1：上一塊還在半空就送下一塊。發的間隔要明顯短於一塊飛完的時間，
     天上才會同時掛著好幾塊——兩者一樣長的話又變回「一塊一塊搬」。 */
  ok('上一塊還在飛就送下一塊，天上連成一串',
     wz.flyMax >= 2 && wz.gap < wz.mDur * 0.6 && wz.loadMax === 1,
     '每 ' + wz.gap + ' 秒發一塊、一塊飛 ' + wz.mDur + ' 秒 → 同時在飛的最多 ' +
     wz.flyMax + ' 塊（手上的工作單一次還是只有 ' + wz.loadMax + ' 格）');
  ok('站在工地旁邊施法，不走進工地', wz.near > wz.siteR + 2,
     '離工地中心 ' + wz.near + '–' + wz.far + '（建築半徑 ' + wz.siteR + '）');
  /* 連發之後杖就一直舉著（v1.64.1）：每 0.85 秒發一塊，中間沒有「放下再舉起來」的空檔。
     量的是「手上有料的那幾幀」而不是全部幀數（v1.89）：他現在會走去下一坨料、
     也會在料被工人搬光時站著等，那兩段本來就該收杖，混進來量到的是「場上還有多少料」。 */
  ok('手上有料就一直舉著杖', wz.jobCast > 0.95 && wz.jobF > 300,
     '手上有料的 ' + wz.jobF + ' 幀裡舉著杖的占 ' + (wz.jobCast * 100).toFixed(1) +
     '%（整段是 ' + (wz.castPct * 100).toFixed(0) + '%）');
  /* 使用者要的是「一點點、看得出是他在施法」，所以特效量也要驗：
     星星是跟魔法陣共用的那一池（上限 48），施工中同時亮著十來顆就是「一點點」。 */
  ok('施法特效留得小', wz.starMax > 0 && wz.starMax < 24,
     '整段最多同時 ' + wz.starMax + ' 顆星（池子上限 48）');

  /* v1.89「優先找積木多的地方」：兩堆料一樣遠，一堆 60 塊一堆 12 塊，他該走去大的那一堆。
     場景要自己鋪乾淨——場上原本的料（含上一輪還在半空的碎料）全部認走藏起來，
     不藏的話工地正中央那一大坨會蓋掉這一條要量的東西。 */
  const wzPick = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 900; setWorkerCount(6); startBuild(true);
    for (let i = 0; i < 160; i++) step(0.05);        // 先讓上一輪的碎料全部落定
    const m = workers.find(w => w.mage);
    releaseWorker(m);
    const free = blocks.filter(b => b.st === 0 && b.rest);
    for (const b of blocks) b.holder = 0;            // 全部藏起來（誰都認不到）
    const put = (list, cx, cz) => {
      for (const b of list) {
        if (b.cell) gridDel(b);
        b.x = cx + rr(-2.5, 2.5); b.z = cz + rr(-2.5, 2.5); b.y = HB;
        b.vx = b.vy = b.vz = 0; b.rest = true; b.snap = 0; b.holder = -1;
        gridAdd(b);
      }
    };
    const R = siteR + 12;
    // 大堆在 0°、小堆在 180°，他站在 90°——跟兩堆一樣遠，只差塊數
    m.x = 0; m.z = R; m.mang = Math.PI / 2; m.mrad = R; m.mre = 0;
    m.fly.length = 0; m.st = 'idle';
    put(free.slice(0, 60), R, 0);
    put(free.slice(60, 72), -R, 0);
    const lim = MAGE_REACH * 0.6;
    let t = 0;
    for (; t < 900; t++) {
      step(0.05);
      if (Math.hypot(m.x - R, m.z) < lim || Math.hypot(m.x + R, m.z) < lim) break;
    }
    return { secs: +(t * 0.05).toFixed(1), R: +R.toFixed(1),
             big: +Math.hypot(m.x - R, m.z).toFixed(1),
             small: +Math.hypot(m.x + R, m.z).toFixed(1) };
  });
  ok('兩堆料一樣遠就站到塊數多的那一堆', wzPick.big < wzPick.small && wzPick.secs < 30,
     wzPick.secs + ' 秒後離 60 塊那堆 ' + wzPick.big + ' 格、離 12 塊那堆 ' +
     wzPick.small + ' 格（兩堆都在半徑 ' + wzPick.R + '，他從等距的地方出發）');

  /* v1.95：碎料被轟到場外的時候，他還是會走過去發料。
     這個分布是實測「玩家丟一發核彈」之後的樣子——2978 塊裡有 2880 塊落在 siteR + 27 之外，
     而推土機只清工地內（siteClearR = siteR + 1.4），不會把場外的料收回來。
     v1.89～v1.94 他的站位被綁在工地外圍 16 格內（MAGE_ROAM），那一版在這個場景整座建築
     發 0 塊、100% 的幀站在原地面向建築——這條就是那一版的紅檢。 */
  const wzFar = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 900; setWorkerCount(20); startBuild(true);
    for (let i = 0; i < 160; i++) step(0.05);        // 先讓上一輪的碎料全部落定
    /* 全部的料鋪到碎料場的外圈——每一坨的中心都在 siteR + 16 之外，
       所以舊版的 pickMageSpot 會把它們整批刷掉（那一版就是發 0 塊的原因）。
       這裡用 900 塊的小場（碎料場半徑約 41）重現核彈那個形狀：
       實測核彈是 2978 塊裡 2880 塊落在 siteR + 27 之外。 */
    const far = Math.max(siteR + 20, arenaR - 12);
    for (const b of blocks) {
      if (b.st !== 0) continue;
      if (b.cell) gridDel(b);
      const a = Math.random() * Math.PI * 2;
      const rad = far + Math.random() * Math.max(4, arenaR - far);
      b.x = Math.cos(a) * rad; b.z = Math.sin(a) * rad; b.y = HB;
      b.vx = b.vy = b.vz = 0; b.rest = true; b.snap = 0; b.holder = -1; b.slot = -1;
      separate(b); gridAdd(b);
    }
    for (const w of workers) releaseWorker(w);
    const mi = workers.map((w, i) => w.mage ? i : -1).filter(i => i >= 0);
    const seen = new Set();
    let frames = 0, idle = 0, rMax = 0, rMin = Infinity;
    for (let i = 0; i < 1600 && phase === 'build'; i++) {
      step(0.05);
      for (const k of mi) {
        const w = workers[k];
        frames++;
        const d = Math.hypot(w.x, w.z);
        if (d > rMax) rMax = d;
        if (d < rMin) rMin = d;
        // 站著沒事做：手上沒料、也沒在走去下一坨（走位途中不算閒著）
        const sp = { x: Math.cos(w.mang) * w.mrad, z: Math.sin(w.mang) * w.mrad };
        if (!w.load.length && Math.hypot(sp.x - w.x, sp.z - w.z) < 0.3) idle++;
      }
      // 隔空拋的那些拋物線（arc.mage）數不重複的，就是他們一共發了幾塊
      for (let k = 0; k < blocks.length; k++) {
        const b = blocks[k];
        if (b.st === 2 && b.arc && b.arc.mage) seen.add(k + ':' + b.slot);
      }
    }
    return { launches: seen.size, frames, idlePct: +(idle / (frames || 1)).toFixed(2),
             rMax: +rMax.toFixed(1), rMin: +rMin.toFixed(1), far: +far.toFixed(1),
             siteR: +siteR.toFixed(1), arenaR: +arenaR.toFixed(1), n: mi.length };
  });
  ok('料被轟到場外，魔法師照樣走過去發料（不是站在工地邊等）',
     wzFar.launches > 20 && wzFar.rMax > wzFar.siteR + 17 && wzFar.idlePct < 0.4,
     wzFar.n + ' 個魔法師發了 ' + wzFar.launches + ' 塊，站的半徑 ' + wzFar.rMin + '～' +
     wzFar.rMax + '（料全在 ' + wzFar.far + ' 之外、碎料場外緣 ' + wzFar.arenaR +
     '，舊上限是 siteR+16=' + (wzFar.siteR + 16).toFixed(1) + '），沒事做的幀占 ' +
     (wzFar.idlePct * 100).toFixed(0) + '%');

  const wzN = await page.evaluate(() => {
    const out = {};
    for (const n of [5, 6, 10, 20, 40, 60]) { setWorkerCount(n); out[n] = workers.filter(w => w.mage).length; }
    setWorkerCount(20);
    return { out, idx: workers.map((w, i) => w.mage ? i : -1).filter(i => i >= 0),
             engMage: workers[0].mage, engIdx: workers.findIndex(w => w.eng) };
  });
  ok('十個人裡一個魔法師，而且不會派到工程師頭上',
     wzN.out[5] === 0 && wzN.out[10] === 1 && wzN.out[20] === 2 &&
     wzN.out[40] === 4 && wzN.out[60] === 6 && !wzN.engMage,
     '5／10／20／40／60 人時各有 ' + [5, 10, 20, 40, 60].map(n => wzN.out[n]).join('／') +
     ' 個；20 人時是第 ' + wzN.idx.join('、') + ' 號（工程師是第 ' + wzN.engIdx + ' 號）');

  /* 外觀：巫師帽與法杖只有魔法師有，而且他不戴安全帽（兩頂疊著會穿模）。
     用顏色認部位——位置會隨姿勢跑，顏色不會。 */
  const wiz = await page.evaluate(() => {
    const look = (i, extra) => {
      const w = workers[i];
      Object.assign(w, { x: 0, y: 0, z: 0, a: 0, gait: 0, ph: 0, carry: false, plan: 0,
                         bub: 0, talk: 0, point: 0, hail: 0, fall: 0, tilt: 0, roll: 0,
                         cast: 0, dig: 0 }, extra);
      ENG.putWorker(i, w);
      const M = new THREE.Matrix4(), v = new THREE.Vector3(), out = [];
      const col = ENG.three.workerMesh.instanceColor.array;
      for (let k = 0; k < ENG.WPARTS; k++) {
        const at = i * ENG.WPARTS + k;
        ENG.three.workerMesh.getMatrixAt(at, M);
        v.setFromMatrixPosition(M);
        out.push({ k, vis: !(M.elements[0] === 0 && M.elements[5] === 0),   // 沒拿的道具縮成 0
                   y: +(v.y / w.scale).toFixed(2), z: +(v.z / w.scale).toFixed(2),
                   c: [0, 1, 2].map(j => Math.round(col[at * 3 + j] * 255)).join(',') });
      }
      return out;
    };
    setWorkerCount(20);
    const mi = workers.findIndex(w => w.mage);
    const pi = workers.findIndex((w, i) => !w.mage && !w.eng);
    const mage = look(mi, {}), plain = look(pi, {});
    const lit = look(mi, { cast: 1 });
    const on = a => a.filter(p => p.vis);
    const cols = a => on(a).map(p => p.c);
    const orb = a => a[a.length - 1];              // 寶珠是 BODY 的最後一塊
    const lum = c => { const v = c.split(',').map(Number); return v[0] * 0.3 + v[1] * 0.6 + v[2] * 0.1; };
    /* 安全帽的顏色直接從帽緣那一塊（BODY 第 2 塊）讀，不要用「出現三次的顏色」去猜——
       膚色也剛好是三塊（頭 ＋ 兩隻手），猜出來的會是膚色。 */
    const hatC = plain[2].c;
    return { mageN: on(mage).length, plainN: on(plain).length,
             hatN: cols(plain).filter(c => c === hatC).length,
             hatOnMage: cols(mage).filter(c => c === hatC).length,
             newCols: cols(mage).filter(c => cols(plain).indexOf(c) < 0)
                        .filter((c, i, a) => a.indexOf(c) === i).length,
             top: Math.max.apply(null, on(mage).map(p => p.y)),
             plainTop: Math.max.apply(null, on(plain).map(p => p.y)),
             orbUp: +(orb(lit).y - orb(mage).y).toFixed(2),
             orbFwd: +(orb(lit).z - orb(mage).z).toFixed(2),
             orbLum: +(lum(orb(lit).c) - lum(orb(mage).c)).toFixed(0) };
  });
  ok('魔法師戴巫師帽拿法杖，而且不戴安全帽',
     wiz.hatN === 3 && wiz.hatOnMage === 0 && wiz.newCols === 3 &&
     wiz.top > wiz.plainTop + 0.3,
     '一般工人身上安全帽色 ' + wiz.hatN + ' 塊、他身上 ' + wiz.hatOnMage +
     ' 塊，多出 ' + wiz.newCols + ' 種顏色（帽、杖、寶珠）；頭頂 ' + wiz.top +
     '，一般工人 ' + wiz.plainTop);
  ok('施法時杖抬起來、杖頭往前傾、寶珠亮起來',
     wiz.orbUp > 0.25 && wiz.orbFwd > 0.1 && wiz.orbLum > 20,
     '寶珠抬高 ' + wiz.orbUp + '、往前 ' + wiz.orbFwd + ' 格，亮度 +' + wiz.orbLum);
  /* ── 挖料的鏟子（v1.129，v1.130 照使用者給的照片重做）───────────────
     挖的那幾秒才拿在手上（w.dig > 0），其他時候那兩塊縮成 0，所以「多出來的部位」
     剛好是柄與鏟面兩塊。
     照片上的用法是「人彎腰、柄近乎垂直、鏟面插在腳前面的地裡」，所以三件事一起驗：
     鏟面**插到底時沒入地面**、撬起來時抬高、插到底那一下整個人往前傾；
     而且鏟面要落在**腳前面一步以內**——v1.129 是把長柄舉在身體前方 1.18 格橫掃
     （使用者：「鏟子的用法應該是這樣 動作調整一下」），那個距離現在是回歸。
     這些值全是常數算出來的（沒有隨機），所以門檻抓得緊。 */
  const shovel = await page.evaluate(() => {
    const i = workers.findIndex(w => !w.mage && !w.mus);
    if (i < 0) return { skip: true };
    const look = dig => {
      const w = workers[i];
      Object.assign(w, { x: 0, y: 0, z: 0, a: 0, gait: 0, ph: 0, carry: false, plan: 0,
                         bub: 0, talk: 0, point: 0, hail: 0, fall: 0, tilt: 0, roll: 0,
                         cast: 0, burnK: 0, wetK: 0, dig });
      ENG.putWorker(i, w);
      const M = new THREE.Matrix4(), v = new THREE.Vector3(), out = [];
      for (let k = 0; k < ENG.WPARTS; k++) {
        ENG.three.workerMesh.getMatrixAt(i * ENG.WPARTS + k, M);
        v.setFromMatrixPosition(M);
        const e = M.elements;
        // 底面 = 中心 − 半高（半高照旋轉後的三根軸算，同「躺平沒埋進草地」那條）
        const hy = 0.5 * (Math.abs(e[1]) + Math.abs(e[5]) + Math.abs(e[9]));
        out.push({ k, vis: !(e[0] === 0 && e[5] === 0),
                   y: +(v.y / w.scale).toFixed(2), z: +(v.z / w.scale).toFixed(2),
                   lo: +((v.y - hy) / w.scale).toFixed(2) });
      }
      return out;
    };
    const off = look(0), deep = look(0.5), up = look(0.001);
    const extra = off.filter(p => !p.vis && deep[p.k].vis).map(p => p.k);
    const pan = extra.length === 2
      ? (deep[extra[0]].z > deep[extra[1]].z ? extra[0] : extra[1]) : -1;   // 遠的那塊是鏟面
    const top = p => p.reduce((a, q) => (q.vis && q.y > a.y ? q : a), { y: -9, z: 0 });
    return { skip: false, extra, pan,
             n0: off.filter(p => p.vis).length, n1: deep.filter(p => p.vis).length,
             panZ: pan < 0 ? -9 : deep[pan].z, panLo: pan < 0 ? 9 : deep[pan].lo,
             panUp: pan < 0 ? -9 : +(up[pan].y - deep[pan].y).toFixed(2),
             lean: +(top(deep).z - top(off).z).toFixed(2),
             tip: +ENG.DIG_TIP[2].toFixed(2) };
  });
  ok('挖料時手上有鏟子，不挖的時候沒有',
     !shovel.skip && shovel.extra.length === 2 && shovel.n1 === shovel.n0 + 2 &&
     shovel.pan >= 0,
     '沒在挖時畫 ' + shovel.n0 + ' 塊、挖的時候 ' + shovel.n1 +
     ' 塊（多出柄與鏟面 ' + JSON.stringify(shovel.extra) + '）');
  ok('鏟面插在腳前面一步以內的地裡，不是把柄舉在身體前方',
     !shovel.skip && shovel.panZ > 0.3 && shovel.panZ < 0.8 && shovel.panLo <= 0 &&
     Math.abs(shovel.tip - shovel.panZ) < 0.25,
     '插到底時鏟面在腳前方 ' + shovel.panZ + ' 格（v1.129 是 1.18）、底面在 y=' +
     shovel.panLo + '（0 是草皮）；規則那邊拿的鏟尖是 ' + shovel.tip + ' 格');
  ok('鏟面撬起來時抬高，插到底那一下整個人往前傾',
     !shovel.skip && shovel.panUp > 0.25 && shovel.lean > 0.1,
     '撬起來抬高 ' + shovel.panUp + ' 格；頭頂往前傾 ' + shovel.lean + ' 格');

  /* 沒建材可發的時候（v1.141 之前是「收杖站在原地等」）。
     現在場上一塊料都撿不到的話，他自己從地面拉一塊出來——跟工人拿鏟子挖是同一件事
     （使用者：「需要積木又沒得撿的時候，用挖的就能產生」），所以驗的是：
     池子真的長出新的、他還舉著杖在施法、而且沒有為了找料跑掉。 */
  const wzWait = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 900; setWorkerCount(20); startBuild(true);
    scatterFree();
    const m = workers.find(w => w.mage);
    // 先等他站定開始施法：上一段測試可能把他丟在工地正中央，那一段路會被算成「他移動了」
    for (let i = 0; i < 400 && m.st !== 'cast'; i++) step(0.05);
    for (let i = 0; i < 1200 && m.cast < 0.95; i++) step(0.05);
    const up = +m.cast.toFixed(2);
    for (const b of blocks) if (b.st === 0 && b.holder < 0) b.holder = 0;   // 建材全被認走
    /* 工人先別挖（v1.141）：他們一挖，場上就又有料了，而「場上還有料」的時候
       魔法師本來就該走過去撿（pickMageSpot），不是自己拉——那條是上面那幾條在驗的。
       這一條要的是「整個場子真的一塊都沒有」，所以把工人那條挖料的路暫時擋掉。 */
    const origDig = startSiteDig;
    startSiteDig = () => {};
    /* 分兩段量：先等他站定（斷料的那一刻他可能還在走位——上一段場上到處是料，
       他挑的那個位置可能在幾十格外，那一段路不是「為了找料跑掉」）。
       站定＝位置連二十幀沒變。 */
    let still = 0, sx = m.x, sz = m.z;
    for (let i = 0; i < 800 && still < 20; i++) {
      step(0.05);
      still = Math.hypot(m.x - sx, m.z - sz) < 0.01 ? still + 1 : 0;
      sx = m.x; sz = m.z;
    }
    const settled = still >= 20;
    const d0 = +Math.hypot(m.x, m.z).toFixed(1);
    const pool0 = blocks.length;
    /* 後六秒才是要驗的：他在原地拉料。只認他自己拉上去的那幾塊（arc.mage）——
       同一場的工人也在挖，拿「池子多了幾塊」當證據會把他們的算進來。 */
    const seen = new Set();
    let up2 = 0;
    for (let i = 0; i < 120; i++) {
      step(0.05);
      up2 = Math.max(up2, m.cast);
      for (let k = 0; k < blocks.length; k++) {
        const b = blocks[k];
        if (b.st === 2 && b.arc && b.arc.mage) seen.add(k + ':' + b.slot);
      }
    }
    startSiteDig = origDig;
    /* 他拉出來的那些 dug 記號是 0（那是這一座的建材，不是村子的料，見 homeMine） */
    return { up, after: +up2.toFixed(2), st: m.st, launched: seen.size, settled,
             made: blocks.length - pool0, mine: blocks.filter(b => b.dug).length,
             moved: +(Math.hypot(m.x, m.z) - d0).toFixed(1) };
  });
  ok('沒建材可發就自己從地面拉一塊出來，不會舉著空杖站著等',
     wzWait.up > 0.9 && wzWait.settled && wzWait.launched > 2 && wzWait.made > 2 &&
     wzWait.after > 0.9 && wzWait.mine === 0 && Math.abs(wzWait.moved) < 1,
     '站定之後那六秒他發上去 ' + wzWait.launched + ' 塊（場上多出 ' + wzWait.made +
     ' 塊、村子的料 ' + wzWait.mine + ' 塊）、杖舉到 ' + wzWait.after +
     '、站的位置挪了 ' + wzWait.moved + ' 格');

  /* 舉杖是每幀預設往下收、只有施法那條路徑撐得住的——被戳倒那一路是 return 出去的，
     不收的話那個人躺在地上還把杖舉著。 */
  const wzDown = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 900; setWorkerCount(20); startBuild(true);
    scatterFree();
    const m = workers.find(w => w.mage);
    let up = 0;
    for (let i = 0; i < 1200 && m.cast < 0.95; i++) step(0.05);
    up = +m.cast.toFixed(2);
    m.fall = 1.5; releaseWorker(m);                 // 戳倒他
    for (let i = 0; i < 10; i++) step(0.05);
    return { up, after: +m.cast.toFixed(2), tilt: +m.tilt.toFixed(2) };
  });
  ok('被戳倒的魔法師會把杖放下', wzDown.up > 0.9 && wzDown.after < 0.05,
     '倒下前舉杖 ' + wzDown.up + '，倒下半秒後 ' + wzDown.after +
     '（身體傾角 ' + wzDown.tilt + '）');

  /* ══════════ 肌肉小人 ══════════ */
  await head('肌肉小人');
  /* 使用者：「增加10%肌肉小人 大肌肉裸上半身」「類似法師小人 走到積木旁拿起來
     直接就能丟到目的地」「跟法師小人比撿積木同普通小人 拋出去像法師小人
     但是積木飛得比較快 因為是靠力量拋」。所以要驗的是三件事：
     撿的那一段跟一般工人一樣（走過去、舉在頭上）、丟的那一段像魔法師（就地一發到位）、
     而且那一發明顯比魔法師快。三種人的弧在同一份資料裡一起量，才比得出差別。 */
  const mus = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 900; setWorkerCount(20); startBuild(true);
    const idx = workers.map((w, i) => w.mus ? i : -1).filter(i => i >= 0);
    const arcs = { h: [], m: [], w: [] };
    const seen = new Set();
    const stCnt = {};
    /* 撿到手之後挪了多遠才出手：肌肉小人該是 0（就地扔），一般工人是走回工地那段路。
       一趟丟好幾塊的人只算第一發（記錄用完就丟掉），不然第二、三發會把第一發的路程重算。 */
    const pickAt = {}, moved = { mus: [], plain: [] };
    const prev = {}, winds = [];
    const hf = {};
    /* 誰送了幾塊（v1.113，使用者：「照理說他省了走路時間應該還是比一般小人蓋得快吧?」）。
       一塊離手就是 load 少一筆，跟「原地連丟」那條測試同一個算法。
       順便記每個人的狀態幀，才看得出退回去走回工地那條路占多少。 */
    const del = workers.map(() => 0), was = workers.map(w => w.load.length);
    const stAll = workers.map(() => ({}));
    let carryF = 0, buildF = 0, loadMax = 0, walked = 0, frames = 0;
    const last = idx.map(k => ({ x: workers[k].x, z: workers[k].z }));
    for (let i = 0; i < 4000 && phase === 'build'; i++) {
      step(0.05); frames++;
      for (let k = 0; k < workers.length; k++) {
        const w = workers[k];
        stAll[k][w.st] = (stAll[k][w.st] || 0) + 1;
        if (w.load.length === was[k] - 1) del[k]++;
        was[k] = w.load.length;
        if (prev[k] === 'pick' && (w.st === 'hurl' || w.st === 'build'))
          pickAt[k] = { x: w.x, z: w.z };
        const done = prev[k] === 'hurl' || prev[k] === 'build';
        if (done && w.st === 'wait' && pickAt[k]) {
          const d = Math.hypot(w.x - pickAt[k].x, w.z - pickAt[k].z);
          (w.mus ? moved.mus : moved.plain).push(d);
          delete pickAt[k];
        }
        if (w.st === 'hurl') hf[k] = (prev[k] === 'hurl' ? hf[k] : 0) + 1;
        if (prev[k] === 'hurl' && w.st === 'wait') winds.push(hf[k]);   // 掄了幾幀才出手
        prev[k] = w.st;
      }
      idx.forEach((k, n) => {
        const w = workers[k];
        stCnt[w.st] = (stCnt[w.st] || 0) + 1;
        if (w.carry) carryF++;
        if (w.st === 'build') buildF++;
        if (w.load.length > loadMax) loadMax = w.load.length;
        walked += Math.hypot(w.x - last[n].x, w.z - last[n].z);
        last[n].x = w.x; last[n].z = w.z;
      });
      for (const b of blocks) {
        const a = b.arc;
        if (b.st !== 2 || !a || seen.has(a)) continue;
        seen.add(a);
        (a.hurl ? arcs.h : a.mage ? arcs.m : arcs.w).push(
          { dur: a.dur, d: Math.hypot(a.x1 - a.x0, a.z1 - a.z0), y0: a.y0, peak: a.peak });
      }
    }
    const med = a => { const v = a.slice().sort((x, y) => x - y); return v.length ? +v[v.length >> 1].toFixed(2) : -1; };
    const sum = a => ({ n: a.length, dur: med(a.map(r => r.dur)), d: med(a.map(r => r.d)),
                        y0: med(a.map(r => r.y0)), peak: med(a.map(r => r.peak)),
                        // 每飛一格花幾秒：距離不一樣的兩種弧要這樣才比得
                        spg: a.length ? +(med(a.map(r => r.dur)) / med(a.map(r => r.d))).toFixed(4) : -1 });
    const grp = pick => {
      const ks = workers.map((w, i) => i).filter(i => pick(workers[i]));
      let d = 0, bf = 0, all = 0;
      for (const k of ks) {
        d += del[k];
        for (const s in stAll[k]) { all += stAll[k][s]; if (s === 'build') bf += stAll[k][s]; }
      }
      return { n: ks.length, per: +(d / ks.length).toFixed(1),
               buildPct: +(bf / (all || 1)).toFixed(3) };
    };
    return { idx, frames, phase, placed: placedCnt, total: bp.slots.length,
             pace: { mus: grp(w => w.mus), plain: grp(w => !w.mus && !w.mage && !w.eng) },
             stCnt, carryF, buildF, loadMax, walked: +walked.toFixed(0),
             wind: med(winds), windN: winds.length,
             movedMus: med(moved.mus), movedPlain: med(moved.plain),
             musN: moved.mus.length, plainN: moved.plain.length,
             h: sum(arcs.h), m: sum(arcs.m), w: sum(arcs.w) };
  });
  ok('撿料跟一般工人一樣：自己走過去撿起來舉在頭上（不是隔空吸過來）',
     mus.h.n > 20 && mus.h.y0 > 2 && mus.m.y0 < 1 && mus.carryF > 100 && mus.walked > 100,
     '出手 ' + mus.h.n + ' 塊，起飛高度 ' + mus.h.y0 + '（舉在頭頂；魔法師是 ' +
     mus.m.y0 + '，料躺在地上）；兩人手上有貨 ' + mus.carryF + ' 幀、走了 ' +
     mus.walked + ' 格');
  ok('一趟只領一塊：撿起來就扔，不先湊滿一疊',
     mus.loadMax === 1, '手上同時最多 ' + mus.loadMax + ' 塊（一般工人是 1～3）');
  ok('撿起來就地扔，不走回工地',
     mus.musN > 10 && mus.movedMus < 0.5 && mus.movedPlain > 2,
     '從撿到出手，他挪了 ' + mus.movedMus + ' 格（' + mus.musN + ' 趟）；' +
     '一般工人同一段是 ' + mus.movedPlain + ' 格（' + mus.plainN + ' 趟，那是走回工地的路）');
  ok('掄一下才出手，不是撿到的同一幀就飛出去',
     mus.wind >= 6 && mus.wind <= 9 && mus.windN > 10,
     mus.windN + ' 發，掄 ' + mus.wind + ' 幀（0.05 秒一幀，MUS_WIND 0.3 秒＝6 幀）');
  ok('靠力氣扔的：同樣的距離比魔法師快三倍，弧也平',
     mus.h.spg < mus.m.spg * 0.5 && mus.h.peak < mus.m.peak,
     '每飛一格 ' + mus.h.spg + ' 秒（魔法師 ' + mus.m.spg + '、一般工人 ' + mus.w.spg +
     '）；弧頂 ' + mus.h.peak + '（魔法師 ' + mus.m.peak + '）');
  ok('場上有兩個肌肉小人，整座照樣蓋完',
     mus.phase === 'done' && mus.placed === mus.total,
     mus.idx.length + ' 個（第 ' + mus.idx.join('、') + ' 號），' + mus.frames * 0.05 +
     ' 秒蓋完 ' + mus.placed + '/' + mus.total + ' 塊');
  /* 使用者：「照理說他省了走路時間應該還是比一般小人蓋得快吧?」——會，而且要守住。
     這一條量的是**最不利的那一座**：吉薩金字塔又矮又實心，碎料就散在它腳邊，
     一般工人的回程本來就短（丟出去的中位距離只有 5.5 格），他省不到多少；
     台北 101 那種高塔量到的是 2.9 倍。 */
  ok('省下回程真的比較快：同樣時間送的塊數比一般工人多',
     mus.pace.mus.per > mus.pace.plain.per * 1.3,
     '每人送 ' + mus.pace.mus.per + ' 塊（' + mus.pace.mus.n + ' 個），一般工人 ' +
     mus.pace.plain.per + ' 塊（' + mus.pace.plain.n + ' 個）＝' +
     (mus.pace.mus.per / mus.pace.plain.per).toFixed(2) + ' 倍');
  /* 他優先挑沒被牆圍住的料（v1.113 的 walledIn）。挑到牆裡那些的話他得走進實心建築中間，
     手上那塊被埋住就只能退回去走回工地——那條路是 st 停在 build 的那些幀。
     v1.112 沒有這個偏好時，這個比例在金字塔上是 17%。 */
  ok('不為了牆裡的料走進實心建築（退回去走回工地那條很少用到）',
     mus.pace.mus.buildPct < 0.1,
     '停在「走回工地」那條路上的幀占他 ' + (mus.pace.mus.buildPct * 100).toFixed(1) +
     '%（v1.112 沒有這個偏好時是 17%）');

  const musN = await page.evaluate(() => {
    const out = {};
    for (const n of [5, 8, 9, 10, 20, 40, 60]) {
      setWorkerCount(n);
      out[n] = workers.filter(w => w.mus).length;
    }
    setWorkerCount(20);
    return { out, idx: workers.map((w, i) => w.mus ? i : -1).filter(i => i >= 0),
             both: workers.filter(w => w.mus && (w.mage || w.eng)).length };
  });
  ok('十個人裡一個肌肉小人，不會跟工程師或魔法師撞在同一個人身上',
     musN.out[5] === 0 && musN.out[9] === 1 && musN.out[10] === 1 && musN.out[20] === 2 &&
     musN.out[40] === 4 && musN.out[60] === 6 && musN.both === 0,
     '5／9／10／20／40／60 人時各有 ' + [5, 9, 10, 20, 40, 60].map(n => musN.out[n]).join('／') +
     ' 個；20 人時是第 ' + musN.idx.join('、') + ' 號（工程師 0 號、魔法師 5、15 號）');

  /* 大一號（v1.113，使用者：「肌肉小人應該會長比較大隻一點點」）。
     乘的是「抽到的身高」sc0 而不是 scale——直接乘 scale 的話，setWorkerCount 每叫一次
     tagMuscle 就再乘一次，人數調個幾輪他會長成一棟樓。所以這裡也驗反覆調人數的情況。 */
  const musSize = await page.evaluate(() => {
    setWorkerCount(60);
    const avg = a => a.reduce((s, w) => s + w.scale, 0) / (a.length || 1);
    const m = workers.filter(w => w.mus), p = workers.filter(w => !w.mus);
    const one = workers[8], before = one.scale;
    /* 每個人各自比：肌肉小人的 scale 該剛好是自己抽到的 sc0 × MUS_SIZE，
       一般工人該剛好等於 sc0。比群體平均會被抽樣晃動洗掉（六個人的平均晃 ±2%）。 */
    const off = w => Math.abs(w.scale - w.sc0 * (w.mus ? MUS_SIZE : 1));
    const worst = Math.max.apply(null, workers.map(off));
    for (let i = 0; i < 5; i++) { setWorkerCount(20); setWorkerCount(60); }   // 反覆調人數
    const after = workers[8].scale;
    setWorkerCount(20);
    return { n: m.length, mus: +avg(m).toFixed(3), plain: +avg(p).toFixed(3),
             size: MUS_SIZE, worst: +worst.toExponential(1),
             hi: +Math.max.apply(null, m.map(w => w.scale)).toFixed(2),
             lo: +Math.min.apply(null, m.map(w => w.scale)).toFixed(2),
             grew: +(after - before).toFixed(4) };
  });
  ok('整個人大一號（每個人都是自己身高的 1.08 倍），但沒有大到變成巨人',
     musSize.size === 1.08 && musSize.worst < 1e-12 &&
     1.31 * musSize.hi < 2.8 && musSize.grew === 0,
     musSize.n + ' 個都剛好 ×' + musSize.size + '（最大誤差 ' + musSize.worst +
     '）；平均身高 ' + musSize.mus + '（一般工人 ' + musSize.plain + '，多 ' +
     ((musSize.mus / musSize.plain - 1) * 100).toFixed(1) + '%）、範圍 ' + musSize.lo +
     '～' + musSize.hi + '（帽頂 ' + (1.31 * musSize.hi).toFixed(2) +
     ' 格）；人數調了五輪之後身高變化 ' + musSize.grew);

  /* 手上那塊真的埋進牆裡就別硬扔（v1.112）。他撿料不限距離，所以會走進實心建築裡
     （金字塔那種）撿躺在裡面的碎料；在那裡出手的話，出手那一下整塊在牆裡。
     判準看的是**那塊積木**不是他的腳：積木舉在頭頂兩格半高，腳邊填起一兩層不影響它。 */
  const musWall = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 900; setWorkerCount(20); startBuild(true);
    const w = workers.find(q => q.mus);
    /* 先讓它長出幾層牆。等「真的長到四層以上有二十塊」而不是固定 45 秒（v1.128.1
       修間歇性失敗）：下面要找的是「站進去之後手上那塊會被埋住」的位置，而那塊舉在
       頭頂兩格半高、身高又是每個人各自抽的（1.72～2.01）——牆不夠高就一個位置都找不到，
       整條測試變成 skip=2 直接算失敗。實測整輪跑真的開出過一次。 */
    const tall = () => blocks.filter(q => q.st === 3 && q.y > HB + 3.2).length;
    for (let i = 0; i < 3000 && phase === 'build' && (i < 900 || tall() < 20); i++) step(0.05);
    let g = 0;
    while (w.st !== 'hurl' && g++ < 3000 && phase === 'build') step(0.05);
    if (w.st !== 'hurl') return { skip: 1 };
    /* 挑一個「頭頂那一格是實心」的位置站進去。**要照他的身高挑**（v1.115）：積木舉在
       頭頂，而身高是每個人各自抽的（v1.113，肌肉小人 1.72～2.01），同一格對矮的人是
       「埋在牆裡」、對高的人已經高過牆頭了。原本固定挑「離地兩格多的那些積木」，
       抽到高個子的那幾輪那一塊其實沒被埋住，他照扔——測到的就不是這條規則。
       所以擺過去、擺好姿勢，真的量到那一塊在牆裡才算數。 */
    const b = blocks[w.load[0].b];
    let spot = null;
    for (const q of blocks) {
      if (q.st !== 3) continue;
      w.x = q.x; w.z = q.z;
      carryPose(w);                                // 手上那塊跟著人走
      if (blockAt(b.x, b.y, b.z)) { spot = q; break; }
    }
    if (!spot) return { skip: 2 };
    w.x = spot.x; w.z = spot.z; w.ct = 0.3;
    carryPose(w);
    const buried = blockAt(b.x, b.y, b.z) ? 1 : 0;
    let hurled = 0;
    for (let i = 0; i < 30 && w.st === 'hurl'; i++) {
      step(0.05);
      if (b.arc && b.arc.hurl && b.st === 2) hurled = 1;
    }
    return { buried, hurled, st: w.st, hold: b.st, at: [+spot.x.toFixed(1), +spot.z.toFixed(1)] };
  });
  ok('手上那塊被牆埋住就不硬扔，退回一般工人那條路（走到工地邊上再丟）',
     musWall.skip ? false : (musWall.buried === 1 && !musWall.hurled &&
       musWall.st === 'build' && musWall.hold === 1),
     musWall.skip ? '（沒抓到掄到一半的人，skip=' + musWall.skip + '）'
       : '站到 (' + musWall.at.join(', ') + ') 之後手上那塊在牆裡，他沒出手（st=' +
         musWall.st + '，那塊還在手上）');

  /* 外觀：裸上半身、上半身比別人大一圈，安全帽照戴（他是工人，不是魔法師）。
     用「哪幾塊看得見」認部位——位置會隨姿勢跑，看得見／看不見不會。 */
  const musLook = await page.evaluate(() => {
    const read = i => {
      const w = workers[i];
      Object.assign(w, { x: 0, y: 0, z: 0, a: 0, gait: 0, ph: 0, carry: false, plan: 0,
                         bub: 0, talk: 0, point: 0, hail: 0, fall: 0, tilt: 0, roll: 0,
                         cast: 0, burnK: 0, wetK: 0, dig: 0 });
      ENG.putWorker(i, w);
      const M = new THREE.Matrix4(), v = new THREE.Vector3(), out = [];
      const col = ENG.three.workerMesh.instanceColor.array;
      for (let k = 0; k < ENG.WPARTS; k++) {
        const at = i * ENG.WPARTS + k;
        ENG.three.workerMesh.getMatrixAt(at, M);
        v.setFromMatrixPosition(M);
        const e = M.elements;
        out.push({ k, vis: !(e[0] === 0 && e[5] === 0),
                   x: +(v.x / w.scale).toFixed(2), y: +(v.y / w.scale).toFixed(2),
                   sx: +(Math.abs(e[0]) / w.scale).toFixed(2),
                   sy: +(Math.abs(e[5]) / w.scale).toFixed(2),
                   c: [0, 1, 2].map(j => Math.round(col[at * 3 + j] * 255)).join(',') });
      }
      const on = out.filter(p => p.vis);
      return { all: out, n: on.length,
               wide: +Math.max.apply(null, on.map(p => Math.abs(p.x) + p.sx / 2)).toFixed(2),
               top: +Math.max.apply(null, on.map(p => p.y + p.sy / 2)).toFixed(2) };
    };
    setWorkerCount(20);
    const mi = workers.findIndex(w => w.mus);
    const pi = workers.findIndex((w, i) => !w.mus && !w.mage && !w.eng);
    const m = read(mi), p = read(pi);
    // 只有他有的那幾塊 vs 只有一般工人有的那幾塊（第 0 塊就是工作服）
    const onlyMus = m.all.filter(q => q.vis && !p.all[q.k].vis).map(q => q.k);
    const onlyPlain = p.all.filter(q => q.vis && !m.all[q.k].vis).map(q => q.k);
    const skin = m.all[1].c;                       // 頭的顏色就是他的膚色
    return { mi, pi, onlyMus, onlyPlain, skin,
             bare: onlyMus.every(k => m.all[k].c === skin),
             hat: m.all.filter(q => q.vis && q.c === m.all[2].c).length,
             plainHat: p.all.filter(q => q.vis && q.c === p.all[2].c).length,
             wide: m.wide, plainWide: p.wide, top: m.top, plainTop: p.top,
             arm: m.all[6].sx, plainArm: p.all[6].sx,
             armX: m.all[6].x, plainArmX: p.all[6].x };
  });
  ok('裸上半身：工作服那一塊收掉，換成膚色的胸膛、肩、胸肌五塊',
     musLook.onlyMus.length === 5 && musLook.onlyPlain.length === 1 &&
     musLook.onlyPlain[0] === 0 && musLook.bare,
     '只有他有的 ' + musLook.onlyMus.length + ' 塊（第 ' + musLook.onlyMus.join('、') +
     ' 塊，全是膚色 ' + musLook.skin + '）；只有一般工人有的是第 ' +
     musLook.onlyPlain.join('、') + ' 塊（工作服）');
  ok('上半身大一圈、手臂粗一圈，安全帽照戴、身高不變',
     musLook.wide > musLook.plainWide * 1.25 && musLook.hat === 3 &&
     musLook.plainHat === 3 && Math.abs(musLook.top - musLook.plainTop) < 0.01 &&
     musLook.arm > musLook.plainArm * 1.4 && musLook.armX > musLook.plainArmX,
     '最寬 ' + musLook.wide + '（一般工人 ' + musLook.plainWide + '）、手臂寬 ' +
     musLook.arm + '（' + musLook.plainArm + '）、掛在 x=' + musLook.armX + '（' +
     musLook.plainArmX + '）；安全帽 ' + musLook.hat + ' 塊，帽頂 ' + musLook.top);

  /* ══════════ 閒聊 ══════════ */
  await head('閒聊');
  const chat = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 500; setWorkerCount(20); startBuild(true); completeNow();
    for (let i = 0; i < 200; i++) step(0.05);          // 先把慶祝跑完
    let starts = 0, frames = 0, samples = 0, broken = 0, maxD = 0, bub = 0, moved = 0;
    const durs = [];
    const seen = workers.map(() => 0);
    const px = workers.map(w => w.x), pz = workers.map(w => w.z);
    for (let i = 0; i < 2400; i++) {
      step(0.05);
      for (let k = 0; k < workers.length; k++) {
        const w = workers[k];
        samples++;
        if (w.chat > 0) {
          frames++;
          const p = workers[w.cw];
          if (!p || p.cw !== k || p.chat <= 0) broken++;      // 一定要兩邊互指
          else {
            const d = Math.hypot(p.x - w.x, p.z - w.z);
            if (d > maxD) maxD = d;
          }
          if (w.bub > 0.5) bub++;
          if (Math.hypot(w.x - px[k], w.z - pz[k]) > 1e-6) moved++;   // 聊天時不該移動
          // 開場就已經在聊的那幾場記成 -1：從中途開始數的長度不算數
          if (!seen[k]) { starts++; seen[k] = i > 0 ? i : -1; }
        } else if (seen[k]) {
          if (seen[k] > 0) durs.push(+((i - seen[k]) * 0.05).toFixed(2));
          seen[k] = 0;
        }
        px[k] = w.x; pz[k] = w.z;
      }
    }
    durs.sort((a, b) => a - b);
    return { pairs: starts / 2, pct: +(frames / samples).toFixed(2), broken, moved,
             maxD: +maxD.toFixed(2), bubPct: +(bub / (frames || 1)).toFixed(2),
             dur: durs.length ? [durs[0], durs[durs.length - 1]] : [] };
  });
  ok('閒晃時走近的兩個人會停下來聊天', chat.pairs >= 5 && chat.dur.length > 0,
     '兩分鐘內聊了 ' + chat.pairs + ' 場，占閒晃幀數 ' + (chat.pct * 100).toFixed(0) + '%');
  ok('一場聊 5 秒', chat.dur[0] >= 4.9 && chat.dur[1] <= 5.1,
     '每場 ' + chat.dur[0] + '–' + chat.dur[1] + ' 秒');
  ok('聊天一定是兩個人互指，而且站著不動',
     chat.broken === 0 && chat.moved === 0 && chat.maxD <= 2.61,
     '單向配對 ' + chat.broken + ' 幀、聊天中移動 ' + chat.moved + ' 幀、兩人最遠 ' + chat.maxD);
  /* 泡泡是輪流冒的：兩個人同時講話看起來像在吵架 */
  ok('說話的泡泡輪流冒', chat.bubPct > 0.3 && chat.bubPct < 0.7,
     '冒泡泡的幀數占聊天中的 ' + (chat.bubPct * 100).toFixed(0) + '%（輪流的話約一半）');
  /* 施工中不能聊天聊到不做事：有活幹的人 st 不會停在 idle */
  const busy = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 600; setWorkerCount(20); startBuild(true);
    let chatting = 0, working = 0;
    for (let i = 0; i < 1200 && phase === 'build'; i++) {
      step(0.05);
      for (const w of workers) {
        if (w.chat > 0 && (w.carry || w.st === 'pick' || w.st === 'build')) chatting++;
        if (w.st === 'pick' || w.st === 'build') working++;
      }
    }
    return { chatting, working, placed: placedCnt };
  });
  ok('手上有工作的人不會停下來聊天', busy.chatting === 0 && busy.working > 100,
     '搬運中聊天 ' + busy.chatting + ' 幀（同期有 ' + busy.working + ' 幀在搬運，蓋了 ' +
     busy.placed + ' 塊）');

  /* ══════════ 表情圖示 ══════════ */
  await head('表情圖示');
  /* 頭上的小圖示（v1.121，v1.122 從方塊換成貼圖）：驚嘆號／問號／愛心／生氣。
     現在是一片正對鏡頭的四邊形，貼上啟動時用 canvas 畫好的那張橫條圖，所以這裡量
     三件事——① 貼圖畫出來了、四格各一種 ② 那一片擺在頭上、正對鏡頭、從錨點長出來
     ③ 該冒的那一刻真的冒了。 */
  const emoDraw = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 300; setWorkerCount(8); startBuild(true);
    ENG.cam.shake = 0; ENG.orbit(0, 0);            // 甩掉前面測試留下的震動與鏡頭動畫
    const KINDS = ENG.EMO_KINDS, geo = ENG.three.emoMesh.geometry;
    /* 貼圖：一張橫條圖，一格一種表情。這裡把每一格的像素撈出來看
       ——有沒有畫東西、四格是不是四個顏色。 */
    const cv = ENG.three.emoMesh.material.map.image;
    const cell = cv.height, g2 = cv.getContext('2d');
    const ink = [], hue = [];
    for (let i = 0; i < KINDS.length; i++) {
      const d = g2.getImageData(i * cell, 0, cell, cell).data;
      let n = 0, r = 0, gg = 0, b = 0;
      for (let j = 0; j < d.length; j += 4) {
        if (d[j + 3] < 128) continue;              // 透明的不算
        n++; r += d[j]; gg += d[j + 1]; b += d[j + 2];
      }
      ink.push(+(n / (cell * cell)).toFixed(3));
      hue.push(n ? [r, gg, b].map(v => Math.round(v / n)).join(',') : '');
    }
    /* 擺一個人、看那一片畫在哪裡。回傳的是「相對這個人的腳底、除掉身高」的四個角。 */
    const pose = extra => {
      const w = workers[0];
      Object.assign(w, { x: 0, y: 0, z: 0, a: 0, gait: 0, ph: 0, tilt: 0, roll: 0,
                         emo: 'heart', emoT: 1, emoK: 1 }, extra);
      ENG.putEmotes([w]);
      const n = geo.drawRange.count / 6, p = geo.attributes.position.array;
      const uv = geo.attributes.uv.array, s = w.scale;
      const pt = i => ({ x: (p[i * 3] - w.x) / s, y: (p[i * 3 + 1] - w.y) / s,
                         z: (p[i * 3 + 2] - w.z) / s });
      return { n, vis: ENG.three.emoMesh.visible, corner: [0, 1, 2, 3].map(pt),
               u0: +uv[0].toFixed(4), scale: s };
    };
    /* mid 是四個角的平均高度（＝那一片的中心）。**不看最低的那個角**：那一片是正對鏡頭的，
       鏡頭有俯角時它跟著仰起來，最低的角自然會比錨點高一點（俯角 0.42 時高 0.027）。
       「從錨點長出來」要看的是中心離錨點多高，那個才會乖乖跟著 emoK 走。 */
    const box = c => ({ lo: +Math.min(...c.map(p => p.y)).toFixed(3),
                        hi: +Math.max(...c.map(p => p.y)).toFixed(3),
                        mid: +(c.reduce((a, p) => a + p.y, 0) / 4).toFixed(3),
                        w: +Math.hypot(c[1].x - c[0].x, c[1].y - c[0].y, c[1].z - c[0].z).toFixed(3) });
    const full = pose({});
    const half = pose({ emoK: 0.4 });
    const none = pose({ emo: '', emoT: 0, emoK: 0 });
    const flat = pose({ tilt: -Math.PI * 0.5 });
    const rolling = pose({ roll: 1, tilt: 0.4 });
    // 四種表情各自吃貼圖的哪一格（u0 應該是 0、0.25、0.5、0.75）
    const cells = KINDS.map(k => pose({ emo: k }).u0);
    /* 正對鏡頭：那一片的法線要跟**鏡頭的正前方**平行（公告板就是這個定義——整片跟
       近平面平行，不是每一片各自朝鏡頭的位置轉；偏離視軸的那幾片才不會歪來歪去）。
       故意連小人自己的朝向一起換——一片掛在頭上的圖，不該跟著人轉。 */
    const face = [];
    const fwd = new THREE.Vector3();
    for (const [yaw, a] of [[0, 0], [1.2, 0], [2.5, 0], [0.7, 1.4], [4.0, -2.2]]) {
      ENG.cam.yaw = yaw; ENG.updateCamera(0.016);
      const c = pose({ a }).corner;
      const e1 = [c[1].x - c[0].x, c[1].y - c[0].y, c[1].z - c[0].z];
      const e2 = [c[3].x - c[0].x, c[3].y - c[0].y, c[3].z - c[0].z];
      const nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2],
            nz = e1[0] * e2[1] - e1[1] * e2[0];
      const nl = Math.hypot(nx, ny, nz);
      fwd.set(0, 0, -1).applyQuaternion(ENG.three.camera.quaternion);
      face.push(+Math.abs((nx * fwd.x + ny * fwd.y + nz * fwd.z) / nl).toFixed(3));
    }
    ENG.cam.yaw = 0.9; ENG.updateCamera(0.016);
    // 八個人一起冒：一個人一片，沒表情的不畫
    for (const w of workers) { w.emo = ''; w.emoT = 0; w.emoK = 0; w.tilt = 0; w.roll = 0; }
    for (let i = 0; i < 3; i++) { workers[i].emo = 'bang'; workers[i].emoT = 1; workers[i].emoK = 1; }
    ENG.putEmotes(workers);
    const many = ENG.three.emoMesh.geometry.drawRange.count / 6;
    return { ink, hue, cells, face, many, n: workers.length,
             isCanvas: cv.tagName === 'CANVAS', texW: cv.width, texH: cv.height,
             fullN: full.n, noneN: none.n, noneVis: none.vis, flatN: flat.n, rollN: rolling.n,
             fullBox: box(full.corner), halfBox: box(half.corner),
             emoY: ENG.EMO_Y, emoSize: ENG.EMO_SIZE };
  });
  /* 貼圖是**啟動時用 canvas 現畫的**，不是外部檔案：file:// 下外部圖片拿去當 WebGL 貼圖
     會被當成跨來源而失敗（這支遊戲要能雙擊開檔），而且不必多帶一個檔案。
     四格要各自有東西、而且是四個顏色——畫壞成空白格的話，畫面上就是「什麼都沒冒」。 */
  ok('四種表情圖示畫在同一張程式產生的貼圖上，四格都有圖、顏色各不相同',
     emoDraw.isCanvas && emoDraw.texW === emoDraw.texH * 4 &&
     emoDraw.ink.every(v => v > 0.03 && v < 0.5) &&
     new Set(emoDraw.hue).size === 4,
     (emoDraw.isCanvas ? 'canvas ' : '外部圖檔 ') + emoDraw.texW + '×' + emoDraw.texH +
     '，各格著色比例 ' + emoDraw.ink.join('／') + '；顏色 ' + emoDraw.hue.join(' '));
  ok('四種表情各自吃貼圖的一格',
     emoDraw.cells.join(',') === '0,0.25,0.5,0.75',
     'u 起點 ' + emoDraw.cells.join('、') + '（一格 0.25）');
  /* 一個人最多一片，沒表情的人不占位子；全場都沒表情時整片關掉——
     關掉才是 0 個 draw call，只把 count 設 0 的話那顆 mesh 還是會被送去畫。 */
  ok('一個人一片，沒表情的不畫，全場都沒有就整片關掉',
     emoDraw.fullN === 1 && emoDraw.noneN === 0 && emoDraw.noneVis === false &&
     emoDraw.many === 3,
     '一個人冒 → ' + emoDraw.fullN + ' 片；沒表情 → ' + emoDraw.noneN +
     ' 片、visible=' + emoDraw.noneVis + '；八個人裡三個冒 → ' + emoDraw.many + ' 片');
  /* 浮在帽子上面：安全帽頂 1.31、巫師帽尖 1.75。低於 1.75 的話魔法師的圖示會插進帽子裡。 */
  ok('圖示浮在帽子上面，而且只有一個圖示那麼大',
     emoDraw.fullBox.lo >= 1.79 && emoDraw.fullBox.hi <= 2.45 &&
     Math.abs(emoDraw.fullBox.w - emoDraw.emoSize) < 0.01,
     '底邊 ' + emoDraw.fullBox.lo + '、頂邊 ' + emoDraw.fullBox.hi + '、邊長 ' +
     emoDraw.fullBox.w + '（錨點 ' + emoDraw.emoY + '、巫師帽尖 1.75）');
  /* 從錨點長出來：emoK 減成 0.4，那一片的邊長跟著變成 0.4 倍，而底邊**不動**
     （錨點就是圖示的底邊）。只驗大小的話，「原地放大」也會過。 */
  ok('圖示是從錨點長出來的，不是原地放大',
     Math.abs(emoDraw.halfBox.w - emoDraw.fullBox.w * 0.4) < 0.005 &&
     Math.abs((emoDraw.fullBox.mid - emoDraw.emoY) - emoDraw.emoSize / 2) < 0.005 &&
     Math.abs((emoDraw.halfBox.mid - emoDraw.emoY) - emoDraw.emoSize / 2 * 0.4) < 0.005,
     'emoK=1 時邊長 ' + emoDraw.fullBox.w + '、中心離錨點 ' +
     (emoDraw.fullBox.mid - emoDraw.emoY).toFixed(3) + '；emoK=0.4 時 ' + emoDraw.halfBox.w +
     '、' + (emoDraw.halfBox.mid - emoDraw.emoY).toFixed(3) + '（都是 0.4 倍）');
  ok('轉鏡頭、轉小人，圖示都正對著看的人',
     emoDraw.face.every(v => v > 0.999),
     '五組角度：法線與鏡頭正前方的內積 ' + emoDraw.face.join('、') + '（1＝正對）');
  ok('躺著、打滾的時候不畫圖示', emoDraw.flatN === 0 && emoDraw.rollN === 0,
     '躺平 ' + emoDraw.flatN + ' 片、打滾 ' + emoDraw.rollN + ' 片');

  /* 情境：哪一刻冒哪一個。每一條都直接觸發那個入口（不是等它自己碰巧發生），
     這樣紅了就知道是那個掛鉤斷了。 */
  const emoWhen = await page.evaluate(() => {
    const out = {};
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 400; setWorkerCount(8); startBuild(true);
    for (let i = 0; i < 40; i++) step(0.05);
    // ① 預告一出現：全場丟下東西就跑，頭上冒驚嘆號
    const alive = workers.filter(w => !w.air && w.burn <= 0);
    alertFlee({ x: 0, z: 0 }, 2);
    out.bang = alive.filter(w => w.emo === 'bang' && w.emoT > 0).length;
    out.aliveN = alive.length;
    step(0.05);
    out.bangK = alive.filter(w => w.emoK > 0).length;
    // 下面幾條要用同一批人，把逃命收掉（startBuild 不管 flee）
    for (const w of workers) { w.flee = 0; w.fdel = 0; w.emo = ''; w.emoT = 0; w.emoK = 0; }
    // ② 要搬的那塊被打飛了：冒問號。freeBlock 就是破壞道具走的那條路
    startBuild(true);
    for (let i = 0; i < 80 && !workers.some(w => w.load.length); i++) step(0.05);
    const wq = workers.find(w => w.load.length);
    out.hasJob = !!wq;
    if (wq) { wq.emo = ''; wq.emoT = 0; freeBlock(blocks[wq.load[0].b]); out.quest = wq.emo; }
    /* ③ 聊完天：兩個人冒同一個表情，多數愛心、四分之一生氣（v1.131）。
       倒數壓到剩一幀，不必等它真的聊完五秒；直接跑 stepChat 不跑整個 step——
       骰子是隨機的，要擲幾百次才看得出比例，而整個 step 跑幾百次太慢，
       中間也可能有別的事情插進來給這兩位冒別的圖示。 */
    const a = workers[1], b2 = workers[2];
    releaseWorker(a); releaseWorker(b2);
    for (const w of [a, b2]) { w.air = 0; w.burn = 0; w.fall = 0; w.flee = 0; }
    const chatN = 600, tally = {};
    let pairSame = 0;
    for (let i = 0; i < chatN; i++) {
      for (const w of [a, b2]) { w.emo = ''; w.emoT = 0; w.emoK = 0; }
      a.chat = 0.04; a.cw = 2; a.side = 0;
      b2.chat = 0.04; b2.cw = 1; b2.side = 1;
      stepChat(a, 1, 0.05);
      tally[a.emo || '沒有'] = (tally[a.emo || '沒有'] || 0) + 1;
      if (a.emo && a.emo === b2.emo) pairSame++;
    }
    out.chatN = chatN; out.chatSame = pairSame; out.chatTally = tally;
    // ④ 跌倒爬起來那一刻生氣；濕著爬起來的不生氣（那是被水柱打倒的，愛心還在頭上）
    const c = workers[3], d = workers[4];
    for (const w of [c, d]) { releaseWorker(w); w.air = 0; w.burn = 0; w.emo = '';
                              w.emoT = 0; w.emoK = 0; w.wet = 0; w.fall = 0.04; }
    d.wet = 3;
    step(0.05);
    out.anger = c.emo; out.wetUp = d.emo;
    // ⑤ 被水淋濕：碰到水不生氣（v1.131），只有身上的火被澆熄才冒愛心（被救了）
    const e1 = workers[5], f1 = workers[6];
    for (const w of [e1, f1]) { releaseWorker(w); w.air = 0; w.burn = 0; w.wet = 0;
                               w.emo = ''; w.emoT = 0; w.emoK = 0; w.fall = 0; }
    wetWorker(e1);
    out.wetMad = e1.emo;
    igniteWorker(f1, 0);
    wetWorker(f1);
    out.doused = f1.emo;
    /* ⑥ 鐘：彈出來 → 被戳倒的那幾秒只是不顯示、倒數照走 → 走完自己收掉。
       直接跑 stepEmo（不是整個 step）：這一段要量的是鐘，不要讓他同時被派工、
       被卡住那些事情插進來再冒一個。 */
    const g1 = workers[7];
    g1.air = 0; g1.burn = 0; g1.fall = 0; g1.emo = ''; g1.emoT = 0; g1.emoK = 0;
    showEmo(g1, 'bang');
    for (let i = 0; i < 6; i++) stepEmo(g1, 0.05);
    out.upK = +g1.emoK.toFixed(2);
    g1.fall = 1;
    for (let i = 0; i < 6; i++) stepEmo(g1, 0.05);
    out.downK = +g1.emoK.toFixed(2); out.downT = +g1.emoT.toFixed(2);
    g1.fall = 0;
    for (let i = 0; i < 40; i++) stepEmo(g1, 0.05);
    out.gone = g1.emo === '' && g1.emoK === 0;
    return out;
  });
  ok('預告一出現，全場都冒驚嘆號',
     emoWhen.bang === emoWhen.aliveN && emoWhen.bangK === emoWhen.aliveN,
     emoWhen.bang + '/' + emoWhen.aliveN + ' 個人冒了驚嘆號，下一幀 ' +
     emoWhen.bangK + ' 個已經看得到');
  ok('要搬的那塊被打飛，那個人冒問號',
     emoWhen.hasJob && emoWhen.quest === 'quest',
     emoWhen.hasJob ? '打掉他認的那塊 → ' + emoWhen.quest : '這輪沒有人領到工作單');
  /* 聊完天冒哪一個（v1.131，使用者：「小人交談後有生氣或是愛心(目前是都愛心)」）。
     三件事一起驗：兩種都要出現、比例對得上 CHAT_MAD（四分之一）、
     而且**同一場對話的兩個人一定同一個**（一邊愛心一邊生氣會像兩件不相干的事）。
     ±0.08 是 4.5 個標準差（n=600 時 σ=0.018），不會偶爾紅一次。 */
  const chatMad = (emoWhen.chatTally.anger || 0) / emoWhen.chatN;
  ok('聊完天兩個人冒同一個表情，多數愛心、四分之一生氣',
     emoWhen.chatSame === emoWhen.chatN && (emoWhen.chatTally.heart || 0) > 0 &&
     (emoWhen.chatTally.anger || 0) > 0 && Math.abs(chatMad - 0.25) < 0.08,
     emoWhen.chatN + ' 場：' + JSON.stringify(emoWhen.chatTally) + '（生氣占 ' +
     (chatMad * 100).toFixed(1) + '%，設定 25%）；兩個人一樣的 ' + emoWhen.chatSame + ' 場');
  ok('跌倒爬起來會生氣，被水柱打倒的不會',
     emoWhen.anger === 'anger' && emoWhen.wetUp === '',
     '爬起來 → ' + emoWhen.anger + '；濕著爬起來 → ' + (emoWhen.wetUp || '沒有圖示'));
  /* v1.131（使用者：「小人碰到水不生氣」）。以前沒火的被淋是冒生氣，但噴泉的水柱與
     淹水每 0.2／0.5 秒就會把還站在水裡的人重新淋一次，那顆怒氣會一直掛著。 */
  ok('碰到水不生氣，但身上的火被澆熄還是冒愛心',
     emoWhen.wetMad === '' && emoWhen.doused === 'heart',
     '沒火的被淋 → ' + (emoWhen.wetMad || '沒有圖示') + '（v1.130 是生氣）、火被澆熄 → ' +
     emoWhen.doused);
  ok('倒在地上的那幾秒圖示不顯示，但倒數照走，走完自己收掉',
     emoWhen.upK > 0.9 && emoWhen.downK < 0.1 && emoWhen.downT > 0.8 && emoWhen.gone,
     '站著 emoK ' + emoWhen.upK + ' → 倒下 0.3 秒後 ' + emoWhen.downK +
     '（剩 ' + emoWhen.downT + ' 秒沒被凍住）；倒數走完收掉：' + (emoWhen.gone ? '是' : '否'));

  /* ══════════ 閒晃事件：小人的家 ══════════ */
  await head('閒晃事件：小人的家');
  // 這一段要測的就是它，把 installClean 關掉的那支裝回去
  await page.evaluate(() => { stepIdleEvent = window.evStep; clearHomes(); });
  /* 慶祝散完場、場上真的沒事幹的時候**一定**會發生一件事（v1.101，使用者指定
     「閒晃模式事件改為必定發生，因為設計成可擴充，必定發生 隨機一種」）。
     v1.97～v1.100 是「每一筆各擲一次 40%」——只有一筆的時候六成的場次什麼都沒發生。
     還在跳的時候不該挑：那幾個人會從慶祝圈上直接走掉。
     權重那部分用一筆假的事件去驗（表上只有一筆的話，挑到哪一個永遠一樣，證不了東西）。 */
  const evRoll = await page.evaluate(() => {
    const out = {};
    const reset = () => {
      shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
      targetCnt = 400; setWorkerCount(12); startBuild(true); completeNow();
      stopIdleEvent(); evArm = 1;
    };
    // 還在慶祝：不該開始
    reset();
    for (let i = 0; i < 40; i++) step(0.05);            // 2 秒，慶祝是 7 秒
    out.cheerStart = idleEv ? idleEv.id : null;
    out.cheering = workers.filter(w => cheerOn(w)).length;
    // 散場之後：連跑幾輪，每一輪都該挑到一件
    out.started = 0;
    for (let r = 0; r < 5; r++) {
      reset();
      let t = 0;
      while (t < 12) { step(0.05); t += 0.05; }         // 慶祝七秒 + 散場錯開最多 1.6 秒
      if (idleEv) out.started++;
      stopIdleEvent(); clearHomes();
    }
    /* 權重：塞一筆 wt 是三倍的假事件，抽 600 次看比例（1 : 3 → 25% / 75%）。
       抽完一定要拿掉，不然後面幾段會跑到這一筆假的。 */
    const fake = { id: '__wt3', wt: 3, start: () => {}, step: null, stop: () => {} };
    IDLE_EVENTS.push(fake);
    const cnt = {};
    for (let i = 0; i < 600; i++) {
      const e = rollIdleEvent();
      cnt[e.id] = (cnt[e.id] || 0) + 1;
    }
    IDLE_EVENTS.pop();
    out.table = IDLE_EVENTS.map(e => e.id + ':' + e.wt).join('、');
    out.home = cnt.home || 0;
    out.fake = cnt.__wt3 || 0;
    out.left = IDLE_EVENTS.length;
    stopIdleEvent(); evArm = 1;
    return out;
  });
  ok('慶祝還沒散場不會觸發事件，散場後一定會發生一件，而且照權重挑',
     evRoll.cheerStart === null && evRoll.cheering > 0 && evRoll.started === 5 &&
     evRoll.left === 1 && evRoll.home > 600 * 0.25 * 0.7 && evRoll.home < 600 * 0.25 * 1.3,
     '事件表 [' + evRoll.table + ']；慶祝中（還有 ' + evRoll.cheering + ' 人在跳）挑到的是 ' +
     evRoll.cheerStart + '，散場後 5 輪挑到 ' + evRoll.started +
     ' 次；權重 1:3 抽 600 次 → ' + evRoll.home + ' : ' + evRoll.fake);

  /* 蓋家的完整一輪：離隊的人數、房子的位置與大小、真的蓋起來、積木是挖出來的。
     這一段跑一次留著給後面幾條用（每條各跑一輪要一分多鐘）。 */
  const home = await page.evaluate(() => {
    cleanTools();
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 600; setWorkerCount(20); startBuild(true); completeNow();
    let t = 0;
    while (t < 12) { step(0.05); t += 0.05; }
    /* 等散場那十二秒裡，事件本來就有 40% 會自己先發生一輪（這一段把它裝回去了）。
       那一輪的房子要先清掉，不然下面那個 startHomes 是**第二批**：人會被改派到新的
       那幾間，第一批就成了沒人蓋的空地基（實測 14 間裡有 190 格永遠補不上）。 */
    stopIdleEvent(); clearHomes(); evArm = 0;
    idleEv = IDLE_EVENTS[0]; startHomes();          // 挑哪一件另一條測，這裡直接開
    /* 房子跟樹都在 homes.list 上（v1.153），所以人數也要分開算：
       蓋房子的是「一半左右的人離隊」那條，種樹的是「沒事的人再抽幾個」那條。 */
    const crew = workers.filter(w => w.hm >= 0 && !homes.list[w.hm].tree).length;
    const crewT = workers.filter(w => w.hm >= 0 && homes.list[w.hm].tree).length;
    const pool0 = blocks.filter(b => b.hh < 0).length;
    const all0 = blocks.length;
    /* 土痕跟塵霧要量「新增的」：慶祝的彩帶還飄在半空（也是塵霧那個池子），
       前面幾條測試炸出來的焦黑也還在，拿總數比會被它們洗掉（實測塵霧 17 → 15）。
       挖出來那一撮土是照顏色認的（見 digPuff）。 */
    marks.length = 0; dust.length = 0;
    const list = homes.list.map(h => ({ n: h.n, slots: h.slots.length, kind: h.kind,
                                        rad: +Math.hypot(h.x, h.z).toFixed(1), r: h.r,
                                        x: h.x, z: h.z, tree: h.tree ? 1 : 0 }));
    /* 挖的那一下要有土痕與土塵（使用者：「積木可以就近地面上挖一挖拿出來」——
       看得出是挖出來的，不是憑空出現）。土痕跟隕石坑同一套，3 秒淡掉。 */
    let marks1 = 0, dirt1 = 0, digs = 0;
    /* 挖出來的那一塊要「躺在地上」，不是直接到手上（v1.129，使用者：「先用鏟子挖出積木
       動作完成後 積木在地面上（這樣就能去撿了）」）。出土的那一瞬間就攔下來看：
       沒有主人（holder < 0）、不是搬運中（st !== CARRY）、還沒認格子（hh < 0）、
       是土色的，而且是從地上蹦出去的（st === FLY，落地會自己轉正躺好，見 stepBlock）。 */
    const origDig = digBlock;
    let dug = 0, inHand = 0, notPop = 0, notDirt = 0;
    /* 出土的位置要在**鏟尖插進去的那一點**，不是小人腳下（v1.130，使用者：
       「積木出現的位置也要合理(目前看起來都固定在小人腳下)」）。
       fwd 是沿著他面對的方向多遠、side 是左右偏多少（鏟子在正前方，所以該是 0）。
       身高每個人不一樣（scale 1.3～1.8），鏟尖離腳底的距離跟著身高走，所以比的是比例。 */
    let fwdMin = 9, fwdMax = -9, sideMax = 0;
    digBlock = (w, h) => {
      const r = origDig(w, h);
      if (r) {
        const b = blocks[blocks.length - 1];
        dug++;
        if (b.holder >= 0 || b.st === 1 || b.hh >= 0) inHand++;
        if (b.st !== 4 || b.rest) notPop++;
        if (Math.abs(b.tr - DIG_DIRT[0]) > 1e-9) notDirt++;
        const dx = b.x - w.x, dz = b.z - w.z, k = ENG.DIG_TIP[2] * w.scale;
        const fwd = (dx * Math.sin(w.a) + dz * Math.cos(w.a)) / k;
        const side = (dx * Math.cos(w.a) - dz * Math.sin(w.a)) / k;
        fwdMin = Math.min(fwdMin, fwd); fwdMax = Math.max(fwdMax, fwd);
        sideMax = Math.max(sideMax, Math.abs(side));
      }
      return r;
    };
    /* 二十秒，不是三秒（v1.98）：房子改成蓋在整片碎料場上（最遠到 arenaR），
       前幾秒他們還在走過去的路上，一塊都還沒挖。 */
    for (let i = 0; i < 400; i++) {
      step(0.05);
      marks1 = Math.max(marks1, marks.length);
      dirt1 = Math.max(dirt1, dust.filter(d => d.cr === 0.52).length);
      digs = Math.max(digs, blocks.filter(b => b.hh >= 0).length);
    }
    // 蓋完
    let secs = 20, inside = 0, insideWalk = 0, near = 0, carry = 0;
    /* 「穿過去」要只算**正在走路的人**（v1.128.1 修間歇性失敗）。
       `pushOutHome` 掛在每一種走法的位移之後，所以在走的人同一幀就被推出來了——
       那才是這條規則真正保證的事。**站著不動的人不會被推**（剛好停在地基邊上、
       又進了聊天那五秒的，要等下一次走動才出去），飛在空中（被道具掀翻）
       與穿透中（stuckWatch 的 ghost）也不吃這一條。
       原本的計數把這些全算進去，而且算的是**幀數**不是人次：一個人在邊上站 1.2 秒
       就是 25 幀，而門檻是 10 幀（0.5 秒）——等於在賭「沒人剛好停在那裡」，
       整輪跑真的開出過 25 幀。
       現在分兩個數：`inside`（任何狀態，留在訊息裡當參考）與 `insideWalk`
       （走路中的人踩進去），斷言看後者。 */
    const px = [], pz = [];
    /* 一趟挖幾塊（v1.129）：挖那一段結束的那一幀，回頭看他挖出了幾塊、接著去做什麼。
       hst0／dug0 是「這一幀之前」的值——挖完的那一幀 dug 已經歸零了。 */
    const hst0 = [], dug0 = [], trip = {};
    let toGrab = 0, toIdle = 0;
    const snap = () => {
      for (let i = 0; i < workers.length; i++) {
        px[i] = workers[i].x; pz[i] = workers[i].z;
        hst0[i] = workers[i].hst; dug0[i] = workers[i].dug;
      }
    };
    const digTally = i => {
      if (hst0[i] !== 'dig' || workers[i].hst === 'dig') return;
      trip[dug0[i]] = (trip[dug0[i]] || 0) + 1;
      if (workers[i].hst === 'grab') toGrab++; else toIdle++;
    };
    const walked = i => Math.hypot(workers[i].x - px[i], workers[i].z - pz[i]) > 0.01;
    const tally = i => {
      const w = workers[i];
      if (!homeAt(w.x, w.z)) return;
      inside++;
      if (walked(i) && !w.air && !(w.ghost > 0)) insideWalk++;
    };
    /* 600 秒（v1.100 從 400 再拉上來）：房子放大到 100～300 塊，
       六七間共 800～950 塊，實測 219～244 秒蓋完（一趟搬 2～3 塊之前是 350 秒）。
       v1.129 起一趟多了「走過去撿」那一段、一趟的塊數下限也從 2 降到 1，
       同一場景實測 269～396 秒（同一天量的舊流程是 199～223 秒，見 README）。 */
    while (secs < 600 && homes.list.some(h => h.left > 0)) {
      snap();
      step(0.05); secs += 0.05;
      for (let i = 0; i < workers.length; i++) {
        tally(i); digTally(i);
        if (workers[i].hm >= 0) carry = Math.max(carry, workers[i].load.length);
      }
    }
    digBlock = origDig;
    const left = homes.list.reduce((n, h) => n + h.left, 0);
    const homeSet = blocks.filter(b => b.hh >= 0 && b.st === 3).length;
    const pool1 = blocks.filter(b => b.hh < 0).length;
    // 蓋完在自己家附近走走
    let far = 0, back = 0;
    for (let k = 0; k < 400; k++) {
      snap();
      step(0.05);
      for (let i = 0; i < workers.length; i++) {
        const w = workers[i];
        if (w.hm < 0) continue;
        const h = homes.list[w.hm];
        far = Math.max(far, Math.hypot(w.x - h.x, w.z - h.z) - h.r);   // 超出自己家地基多遠
        if (Math.hypot(w.x, w.z) < siteR + KEEP) back++;        // 走進工地裡了
        tally(i);
      }
    }
    // 兩間之間的距離、離樹的距離
    let gap = Infinity, tree = Infinity;
    for (let i = 0; i < homes.list.length; i++) {
      for (let j = i + 1; j < homes.list.length; j++)
        gap = Math.min(gap, Math.hypot(homes.list[i].x - homes.list[j].x,
                                       homes.list[i].z - homes.list[j].z));
      for (const tr of trees)
        tree = Math.min(tree, Math.hypot(homes.list[i].x - tr.x, homes.list[i].z - tr.z) - tr.r);
    }
    return { crew, crewT, n: workers.length, list, pool0, pool1, all0, all1: blocks.length,
             homeSet, left, secs: +secs.toFixed(1), inside, insideWalk,
             far: +far.toFixed(1), back,
             marks1, dirt1, digs, carry, cap: HOME_CARRY,
             dug, inHand, notPop, notDirt, trip, toGrab, toIdle,
             fwdMin: +fwdMin.toFixed(3), fwdMax: +fwdMax.toFixed(3),
             sideMax: +sideMax.toFixed(3), tip: +ENG.DIG_TIP[2].toFixed(2),
             gap: gap === Infinity ? -1 : +gap.toFixed(1),
             tree: tree === Infinity ? -1 : +tree.toFixed(1),
             siteR: +siteR.toFixed(1), live: LIVE_R,
             band: [siteR + HOME_NEAR, homeOut()], arenaR: +arenaR.toFixed(1),
             spread: +(Math.max(...homes.list.map(h => Math.hypot(h.x, h.z))) -
                       Math.min(...homes.list.map(h => Math.hypot(h.x, h.z)))).toFixed(1) };
  });
  const houses = home.list.filter(h => !h.tree);
  const grove = home.list.filter(h => h.tree);
  ok('一半左右的人離隊去蓋，附近的人合蓋大一點的',
     home.crew >= home.n * 0.3 && home.crew <= home.n * 0.7 &&
     houses.length > 1 && houses.every(h => h.n >= 1 && h.n <= 3) &&
     houses.some(h => h.n > 1),
     home.n + ' 人裡 ' + home.crew + ' 人離隊，蓋 ' + houses.length + ' 間（每間 ' +
     houses.map(h => h.n + ' 人 ' + h.slots + ' 塊').join('、') + '）');
  /* 塊數（v1.100，使用者：「調整小房子塊數 在 100~300 之間比較有城市村落感」）。
     v1.98 是 25～41、v1.99 是 25～115，現在 103～276。 */
  ok('一間房子在 100～300 塊之間，人多的那組蓋得比較大',
     houses.every(h => h.slots >= 100 && h.slots <= 300) &&
     Math.max(...houses.filter(h => h.n === 1).map(h => h.slots).concat(0)) <=
     Math.max(...houses.map(h => h.slots)),
     '每間 ' + houses.map(h => h.kind + ' ' + h.n + ' 人 ' + h.slots + ' 塊').join('、') +
     '（共 ' + houses.reduce((n, h) => n + h.slots, 0) + ' 塊）');
  /* 同一輪裡，房子分完之後**剩下沒事的人**再抽幾個去種樹（v1.153，使用者：
     「閒置的小人有點多 增加一些小人去蓋樹」、「抽幾個沒事的人去蓋樹」）。
     要驗的是三件事：真的有人去種、種的是樹（塊數落在樹的區間，比房子小）、
     而且**沒有人同時被派兩份工**（一個人只會在一棵樹或一間房子上）。 */
  ok('房子分完之後，沒事的人再抽幾個去種樹',
     home.crewT > 0 && home.crewT <= home.n - home.crew && grove.length > 0 &&
     grove.every(h => h.slots >= 31 && h.slots <= 220 && h.n >= 1 && h.n <= 3),
     home.n + ' 人裡 ' + home.crew + ' 人蓋房子、另外 ' + home.crewT + ' 人種樹：' +
     grove.map(h => h.kind + ' ' + h.n + ' 人 ' + h.slots + ' 塊').join('、') +
     '（共 ' + grove.reduce((n, h) => n + h.slots, 0) + ' 塊）');
  /* 一趟搬好幾塊（v1.100）。房子放大之後一塊一趟的成本就現形了：
     實測一趟一塊要 6.4 秒才砌上一塊、六成時間在走路；一趟 2～3 塊是 2.5 秒。
     這條驗「真的有一次拿到兩塊以上」，上限跟工人一樣是 3（再多手上那疊會高過頭頂）。 */
  ok('一趟挖好幾塊再一起砌上去',
     home.carry >= 2 && home.carry <= home.cap[1],
     '手上同時最多 ' + home.carry + ' 塊（設定 ' + home.cap[0] + '～' + home.cap[1] + '）');
  /* 挖出來的積木**先躺到地上**（v1.129，使用者：「先用鏟子挖出積木 動作完成後
     積木在地面上（這樣就能去撿了）」）。出土的那一瞬間就攔下來看（見上面的 digBlock 掛勾）：
     不在手上、還沒認格子、是土色的、而且是從地上蹦出去的——落地之後它就是一塊
     普通的碎料，所以「地上的碎料優先」那條規則會自己把它撿起來，不必另開一條路。 */
  ok('挖出來的積木先躺在地上，不是直接到手上',
     home.dug > 100 && home.inHand === 0 && home.notPop === 0 && home.notDirt === 0,
     '挖了 ' + home.dug + ' 塊：直接到手上 ' + home.inHand + ' 塊、沒蹦出地面 ' +
     home.notPop + ' 塊、不是土色 ' + home.notDirt + ' 塊');
  /* 出土的位置＝鏟尖插進去的那一點（v1.130）。每塊都要落在那裡：往前剛好一個
     ENG.DIG_TIP（那是畫面那邊算鏟子姿勢時一起算出來的）、左右不偏。
     v1.129 是寫死在 w.x／w.z（腳下），fwd 會是 0。 */
  ok('挖出來的積木從鏟尖那一點冒出來，不是從腳下',
     Math.abs(home.fwdMin - 1) < 0.01 && Math.abs(home.fwdMax - 1) < 0.01 &&
     home.sideMax < 0.01,
     '每一塊都在腳前方 ' + home.fwdMin + '～' + home.fwdMax +
     ' 個鏟尖距離（鏟尖 ' + home.tip + ' × 身高）、左右偏 ' + home.sideMax);
  /* 一趟挖 1～3 塊、挖完走過去撿（使用者：「如果是普通小人要拿多個 可以挖1~3個再撿」）。
     trip 是「挖那一段結束時挖出了幾塊」的分布（實測 0:10／1:94／2:177／3:89）。
     0 塊與「挖完沒接上撿」都是少數、而且兩條都會退回重開一趟：
     前者是那一間不缺料了（見 digNeed）或池子滿了，後者是最後一塊還在半空
     （等 DIG_SET 還沒落定，實測 370 趟裡 12 趟）。 */
  ok('一趟挖 1～3 塊，挖完就走過去撿',
     Object.keys(home.trip).every(k => +k <= home.cap[1]) &&
     home.trip[1] > 0 && home.trip[3] > 0 && home.toGrab > home.toIdle * 5,
     '一趟挖幾塊 ' + JSON.stringify(home.trip) + '（設定 ' + home.cap[0] + '～' +
     home.cap[1] + '）；挖完去撿 ' + home.toGrab + ' 趟、重開一趟 ' + home.toIdle + ' 趟');
  /* 外型（v1.98 重做、v1.99 加款式）。使用者先說「小房子外型不像房子要調整」，
     再說「增加小房子種類 增加豐富性」。**掃過款式表裡的每一款**，不是只看這一輪剛好
     蓋出來的那幾間——不然覆蓋率要靠運氣。每一款都要有：
     兩格高的門、至少兩扇窗、屋頂縮一圈剩一道屋脊、站在屋脊上的煙囪、
     以及該有的門廊／圍籬；而且同一個格子不能放兩塊。 */
  const shape = await page.evaluate(() => {
    const out = [];
    for (const k of HOME_KIND) {
      const sl = homeSlots(0, -30, k, HOME_PAL[0]);          // 門朝場中心（+z）
      const has = new Set(sl.map(q => q.i + ':' + q.k + ':' + q.gy));
      let door = 0, win = 0;
      for (let i = 0; i < k.w; i++)
        for (let kk = 0; kk < k.d; kk++) {
          if (i > 0 && i < k.w - 1 && kk > 0 && kk < k.d - 1) continue;
          if (!has.has(i + ':' + kk + ':0') && !has.has(i + ':' + kk + ':1')) door++;
          for (let gy = 1; gy < k.h; gy++)
            if (has.has(i + ':' + kk + ':' + (gy - 1)) &&
                !has.has(i + ':' + kk + ':' + gy)) win++;
        }
      const inBox = q => q.i >= 0 && q.i < k.w && q.k >= 0 && q.k < k.d;
      const roof = sl.filter(q => q.gy === k.h && inBox(q)).length;
      const ridge = sl.filter(q => q.gy === k.h + 1 && inBox(q)).length;
      const chim = sl.filter(q => q.gy === k.h + 2);
      const onRidge = chim.length === 1 && sl.some(q =>
        q.gy === k.h + 1 && q.i === chim[0].i && q.k === chim[0].k);
      const ring = sl.filter(q => q.gy === 0 &&
        (q.i === -2 || q.i === k.w + 1 || q.k === -2 || q.k === k.d + 1)).length;
      const canopy = sl.filter(q => q.gy === 2 && !inBox(q)).length;
      const seen = new Set();
      let dup = 0;
      for (const q of sl) {
        const key = q.i + ':' + q.gy + ':' + q.k;
        if (seen.has(key)) dup++;
        seen.add(key);
      }
      /* 腰線：五層以上的房子在半高處把整圈牆換成屋頂色（見 homeSlots 的 belt）。
         數的是「牆的高度裡、用屋頂色的那些」。 */
      const belt = sl.filter(q => q.gy < k.h && inBox(q) && q.c === HOME_PAL[0][1]).length;
      out.push({ id: k.id, n: k.n, size: k.w + '×' + k.d + '×' + k.h, total: sl.length,
                 door, win, roof, ridge, chim: chim.length, onRidge, ring, canopy, dup,
                 belt, wantBelt: k.h >= 5,
                 wantFence: !!k.fence, wantPorch: !!k.porch });
    }
    return out;
  });
  ok('每一款都有兩格高的門、窗、屋脊、屋脊上的煙囪，該有的門廊圍籬也在',
     shape.length >= 9 &&
     shape.every(o => o.door === 1 && o.win >= 2 && o.ridge > 0 && o.ridge < o.roof &&
                      o.chim === 1 && o.onRidge && o.dup === 0 &&
                      (o.wantFence ? o.ring > 8 : o.ring === 0) &&
                      (o.wantPorch ? o.canopy === 3 : o.canopy === 0) &&
                      (o.wantBelt ? o.belt > 8 : o.belt === 0) &&
                      o.total >= 100 && o.total <= 300),
     shape.map(o => o.id + ' ' + o.size + ' ' + o.total + ' 塊（門 ' + o.door + '、窗 ' +
       o.win + '、屋頂 ' + o.roof + '→屋脊 ' + o.ridge +
       (o.wantBelt ? '、腰線 ' + o.belt : '') +
       (o.wantPorch ? '、門廊 ' + o.canopy : '') +
       (o.wantFence ? '、圍籬 ' + o.ring : '') + '）').join('；'));
  /* 一輪裡真的會出現好幾款（不是每次都蓋同一種）。三個人數各三款，
     隨機挑 → 六間至少該有三種不同的。 */
  ok('一輪蓋出來的房子有好幾款',
     new Set(houses.map(h => h.kind)).size >= 3,
     houses.length + ' 間：' + houses.map(h => h.kind).join('、') +
     (grove.length ? '；樹 ' + grove.map(h => h.kind).join('、') : ''));
  /* 蓋在工地外圈那一帶（使用者選的），彼此不重疊、不壓到樹。 */
  /* 範圍是「地標建築範圍外～小樹圈內」（v1.98，使用者指定「應該分散一點」）。
     樹種在碎料場外圍（arenaR + 3～15），所以外緣就是 arenaR。
     v1.97 是 siteR + 8～22 的窄環，幾間房子擠在同一圈上。 */
  /* spread（最遠與最近的半徑差）的門檻從 6 放到 2.5（v1.119）。原本的 6 會**隨機失敗**：
     同樣的條件抽 300 輪，spread 的分布是 min 2.7／5% 6.5／中位數 11.9／max 16.6，
     有 15 輪（5%）落在 6 以下——一輪就是六七間房子各自抽一個半徑，全部落在同一段
     窄環上本來就有那個機率，不是程式壞了。
     「分散一點」真正守在另外兩條：每一間都落在整條環帶裡（band）、最近的兩間隔得開
     （gap，同 300 輪的 min 是 12.1，門檻 11 還有餘裕）。這個數字留著只是為了擋住
     「全部擺在同一個半徑上」那種退化。

     v1.148.1 再放到 1：整輪測試量到過 **2.5**（五間落在 29～31.6），比那 300 輪的
     min 2.7 還低——那條分布的下緣本來就不是 2.7，只是 300 輪沒抽到更低的。
     這個門檻是**退化偵測**（全部同一個半徑 ＝ 0），不是「散得夠不夠開」的規格，
     所以照它的用途訂：1 格（一塊積木寬）以上就不算退化，離觀察到的最低值還有 1.5 的餘裕。
     真正的「散得開」照舊由 band 與 gap 守著，那兩條一個字都沒動。 */
  ok('蓋在地標外圍到碎料場外緣之間，散得開、不重疊也不壓到樹',
     home.list.every(h => h.rad >= home.band[0] - 0.1 && h.rad <= home.band[1] + 0.1) &&
     home.spread > 1 && home.gap > 11 && home.tree > 2,
     '離工地中心 ' + home.list.map(h => h.rad).join('／') + '（該落在 ' +
     home.band[0].toFixed(1) + '～' + home.band[1].toFixed(1) + '；工地半徑 ' + home.siteR +
     '、碎料場外緣 ' + home.arenaR + '）；最遠與最近差 ' + home.spread +
     '、最近的兩間隔 ' + home.gap + '、離樹最近 ' + home.tree);
  /* 積木是**從地上挖出來的**，不是從料池借的。完工那一刻場上通常一塊散料都沒有
     （料池 = 藍圖格數），從料池拿等於把下一座的建材偷走。 */
  /* 積木是**新生出來的**，不是從料池借的——但地上躺著的碎料例外，那些優先撿（v1.104）。
     所以驗的是這條帳：新增的積木數 ＝ 蓋掉的塊數 − 從地上撿走的塊數。
     撿走幾塊就是料池少的那幾塊（pool0 − pool1）。 */
  /* 「料池不會變多」v1.129 起放寬到「最多多出三塊」，同時補上「挖出來的不超過用掉的」。
     為什麼會多出來：挖出來的積木改成先躺在地上（出土到躺定 0.8 秒），這 0.8 秒裡
     那一間的最後一格可能被同組的人用手上／憑空生的料補掉，那一塊就沒地方去了
     ——房子蓋完就沒人再撿它。實測 6 輪（4462 鏟）出現 1 次、多 1 塊。
     擋亂挖的主力是下面那條：挖之前會扣掉「地上已經有的料」（見 digNeed），
     所以挖出來的總數不會超過用掉的。 */
  ok('房子真的蓋起來，積木是撿的加挖的（沒有從料池借）',
     home.left === 0 && home.homeSet > 60 && home.pool1 - home.pool0 <= 3 &&
     home.dug <= home.homeSet &&
     home.all1 === home.all0 + home.homeSet - (home.pool0 - home.pool1),
     home.list.length + ' 間共 ' + home.homeSet + ' 塊，' + home.secs +
     ' 秒蓋完（沒補上的 ' + home.left + ' 格）；地上撿走 ' +
     (home.pool0 - home.pool1) + ' 塊（料池 ' + home.pool0 + ' → ' + home.pool1 +
     '）、挖出來 ' + home.dug + ' 塊（積木總數 ' + home.all0 + ' → ' + home.all1 + '）');
  ok('挖的那一下有土痕與土塵',
     home.marks1 > 0 && home.dirt1 > 0 && home.digs > 0,
     '二十秒內：地上的土痕最多 ' + home.marks1 + ' 塊、土色塵霧最多 ' + home.dirt1 +
     ' 顆、挖出 ' + home.digs + ' 塊積木');
  /* 蓋完就在自己家附近走走（使用者的規格），不會走回工地那一帶。 */
  ok('蓋完就在自己家附近走走',
     home.far < home.live + 1.5 && home.back === 0,
     '離自己家地基邊緣最遠 ' + home.far + '（該在 ' + home.live +
     ' 以內），走進工地裡 ' + home.back + ' 幀');
  /* 房子不在藍圖的格子表裡（footBlocked 查的是那個），所以每一種走法都得自己避開。
     沒有這一條的話實測有 34% 的人次站在別人屋子裡（推的時機漏了「站定不動」那條路徑，
     而且推到邊界上會被浮點誤差判成還在裡面）。 */
  /* 使用者回報「小房子用槌子砸好像容易點到地板，而沒砸到房子」。
     成因不在房子小，在上面那顆過期的包圍球：整池被跳過，射線直接穿到地板。
     實測（改之前）6 間裡有 2 間**每一塊都點不到**（14/14、7/7 全判成地板、一塊都沒掉）。
     這條照玩家那條路走一次：ENG.pick → fixHit → useTool（槌子）→ resolveSwing。 */
  const homeHit = await page.evaluate(() => {
    stopIdleEvent();
    for (const w of workers) w.hm = -1;             // 別讓他們一邊補一邊測
    for (let i = 0; i < 30; i++) ENG.updateCamera(1);
    draw(); ENG.render();
    const cam = ENG.three.camera, W = window.innerWidth, H = window.innerHeight;
    const v = new THREE.Vector3();
    const was = tool; tool = 'hammer';
    let tries = 0, ground = 0, broke = 0, houses = 0, redirect = 0, other = 0;
    const miss = [];
    homes.list.forEach((h, hi) => {
      const mine = () => blocks.filter(b => b.hh === hi && b.st === 3);
      const shot = [];
      /* 先把這一間每一塊都點一次、只看判定（不砸）：槌子的範圍是 3.6（v1.165 前是
         5.5），一下就把小房子端掉大半了，砸完再點剩下的等於在點空氣。 */
      for (const b of mine()) {
        v.set(b.x, b.y, b.z).project(cam);
        if (v.x < -1 || v.x > 1 || v.y < -1 || v.y > 1) continue;
        tries++;
        const raw = ENG.pick((v.x + 1) / 2 * W, (1 - v.y) / 2 * H);
        const fixed = raw && fixHit(raw);
        if (!fixed || fixed.kind === 'ground') { ground++; continue; }
        /* fixHit 把落點往前挪了＝射線是從地標的縫裡鑽過去打到後面這間房子的，
           那一下本來就該打在地標上（v1.86 那條）。這種取樣不算「對著房子點」。 */
        if (fixed !== raw) { redirect++; continue; }
        /* 射線先摸到的不是這一間的積木（別人家的屋頂、地標擋在前面）：
           那一下本來就不是「對著這一間點」。塔屋十一格高，最上面那幾塊很容易遇到。 */
        if (!(blocks[raw.idx] && blocks[raw.idx].hh === hi)) { other++; continue; }
        shot.push(fixed);
      }
      if (!shot.length) return;
      houses++;
      // 真的砸一下（挑中間那一塊），這一間要掉塊
      const before = mine().length;
      const use = shot[Math.floor(shot.length / 2)];
      swing = null; useTool(use); resolveSwing();
      if (mine().length < before) broke++;
      else miss.push({ kind: h.kind, before, r: +h.r.toFixed(1),
                       hx: +h.x.toFixed(1), hz: +h.z.toFixed(1),
                       px: +use.point.x.toFixed(1), py: +use.point.y.toFixed(1),
                       pz: +use.point.z.toFixed(1),
                       d: +Math.hypot(use.point.x - h.x, use.point.z - h.z).toFixed(1),
                       n: shot.length });
    });
    tool = was;
    swing = null; ENG.hideHammer();
    return { tries, ground, broke, houses, miss, redirect, other };
  });
  ok('對著小房子砸下去，砸得到房子（不是打到地板）',
     homeHit.houses > 1 && homeHit.tries > 20 && homeHit.ground === 0 &&
     homeHit.broke === homeHit.houses,
     homeHit.houses + ' 間、對著 ' + homeHit.tries + ' 塊各點一下：判成地板 ' +
     homeHit.ground + ' 下、被 fixHit 拉回地標 ' + homeHit.redirect +
     ' 下、先摸到別的積木 ' + homeHit.other +
     ' 下；每間真的砸一下，' + homeHit.broke + ' 間掉塊' +
     (homeHit.miss.length ? '（沒掉的：' + JSON.stringify(homeHit.miss) + '）' : ''));

  /* 斷言只看「走路中的人」（v1.128.1，理由見上面 insideWalk 那段註解）：
     推出去那一下掛在每一種走法的位移之後，所以在走的人同一幀就被推出來，這個數該是 0。
     站著不動／飛在空中／穿透中的不吃這一條，那些留在訊息裡當參考。 */
  ok('沒有人從房子中間穿過去', home.insideWalk === 0,
     '走路中踩在房子地基上 ' + home.insideWalk + ' 幀（含站著不動與被掀飛的共 ' +
     home.inside + ' 幀；' + home.list.length + ' 間、量了 ' +
     (home.secs + 20).toFixed(0) + ' 秒）');

  /* 一開始建造就回去上工（使用者：「如果要再建造時 直接恢復進入建造模式」），
     房子留在場上（使用者選的）。推土機只推工地內的 FREE 碎料，所以碰不到房子。 */
  const homeSwap = await page.evaluate(() => {
    /* 先跑兩秒：上一條測試每間房子砸了一下，垮塔是分好幾波採的（fallIn），
       還有幾塊在路上——没落定就量的話，整地那一段前後的數字會差幾塊。 */
    for (let i = 0; i < 40; i++) step(0.05);
    const kept0 = homes.list.length;
    const set0 = blocks.filter(b => b.hh >= 0 && b.st === 3).length;
    /* 換一座 siteR 差不多的，房子才不會被新工地蓋到（那條另外測）。
       用 instant = false 走整地那條路：推土機要真的開進來一趟——所以工地裡先要有
       碎料（countDirty < 8 的話 startBuild 會直接跳過整地）。把上一座敲成碎料就有了。 */
    for (const b of blocks) if (b.hh < 0 && b.st === 3) freeBlock(b);
    for (let i = 0; i < 60; i++) step(0.05);         // 等它們落地：countDirty 只數躺著的
    const dirty = countDirty();
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    startBuild(false);
    const onEvent = workers.filter(w => w.hm >= 0).length;
    const ev = idleEv;
    let clear = 0;
    for (let i = 0; i < 400 && phase === 'clear'; i++) { step(0.05); clear++; }
    const setAfterClear = blocks.filter(b => b.hh >= 0 && b.st === 3).length;
    for (let i = 0; i < 600; i++) step(0.05);
    return { kept0, set0, onEvent, ev: ev ? ev.id : null, clear, dirty,
             kept1: homes.list.length, setAfterClear,
             set1: blocks.filter(b => b.hh >= 0 && b.st === 3).length,
             pool: blocks.filter(b => b.hh < 0).length, need: bp.slots.length,
             placed: placedCnt, phase,
             carrying: workers.filter(w => w.carry || w.load.length).length };
  });
  ok('一開始建造就回去上工，房子留在場上（整地推土機也不推它）',
     homeSwap.onEvent === 0 && homeSwap.ev === null &&
     homeSwap.kept1 === homeSwap.kept0 && homeSwap.setAfterClear === homeSwap.set0 &&
     homeSwap.set1 === homeSwap.set0 && homeSwap.pool === homeSwap.need &&
     homeSwap.placed > 100 && homeSwap.clear > 100,
     '房子 ' + homeSwap.kept0 + ' 間 / ' + homeSwap.set0 + ' 塊 → 整地後 ' +
     homeSwap.setAfterClear + ' 塊、蓋 30 秒後 ' + homeSwap.set1 + ' 塊（工地裡有 ' +
     homeSwap.dirty + ' 塊碎料要清，整地跑了 ' + homeSwap.clear +
     ' 幀）；還在跑事件的 ' + homeSwap.onEvent + ' 人，料池 ' +
     homeSwap.pool + '／藍圖 ' + homeSwap.need + '，已蓋 ' + homeSwap.placed + ' 塊');

  /* 唯一會拆房子的情況：下一座工地正好蓋到它身上。留著的話新建築會跟它長在同一個位置。
     解成碎料剛好接回原本的流程——那些塊變成 FREE，推土機推出工地，小人撿去蓋新的那座。 */
  const homeTaken = await page.evaluate(() => {
    const n0 = homes.list.length;
    const set0 = blocks.filter(b => b.hh >= 0).length;
    const siteR0 = siteR;
    siteR = 60;                          // 假裝下一座是超大的一座
    clearHomesInSite();
    const freed = blocks.filter(b => b.hh < 0 && b.st === 4).length;
    siteR = siteR0;
    return { n0, set0, n1: homes.list.length, freed,
             still: blocks.filter(b => b.hh >= 0).length,
             hm: workers.filter(w => w.hm >= 0).length };
  });
  ok('新工地蓋到誰家，那一間就解成碎料變建材',
     homeTaken.n0 > 0 && homeTaken.n1 === 0 && homeTaken.still === 0 &&
     homeTaken.freed >= homeTaken.set0 && homeTaken.hm === 0,
     '工地半徑放大到 60 之後，' + homeTaken.n0 + ' 間全被徵收（' + homeTaken.set0 +
     ' 塊變成碎料 ' + homeTaken.freed + ' 塊），還掛在房子上的積木 ' + homeTaken.still + ' 塊');
  /* 魔法師蓋自己的家要用魔法（v1.102，使用者：「魔法師小人 要用魔法師的方式蓋小房子」）。
     他不挖也不搬：站在自己家旁邊舉著杖，把腳邊的地面拉出一塊直接隔空拋上去。
     20 個人裡只有兩個魔法師、又只抽一半的人離隊，所以這裡手動塞一個進第一間
     （抽不到魔法師的機率有兩成四，靠運氣的測試不算測試）。 */
  const mageHome = await page.evaluate(() => {
    cleanTools();
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 600; setWorkerCount(20); startBuild(true); completeNow();
    let t = 0;
    while (t < 12) { step(0.05); t += 0.05; }
    stopIdleEvent(); clearHomes(); evArm = 0;
    idleEv = IDLE_EVENTS[0]; startHomes();
    if (!workers.some(w => w.mage && w.hm >= 0)) {
      const m = workers.find(w => w.mage);
      releaseWorker(m); m.hm = 0; m.hst = ''; m.ct = 0;
    }
    const me = workers.find(w => w.mage && w.hm >= 0);
    const hi = me.hm;
    /* 讓他一個人蓋（v1.158.2）。房型與同組人數本來是骰子：同一顆種子 777008 抽過
       「小院 104 格、1 人」「灌木 31 格、1 人」「大屋 136 格、3 人」三種，抽到最後那種時
       他只分到 20 格，`cast > 20` 就差一票紅掉。這一條要驗的是「他用魔法而不是用手」，
       不是「他在三個人裡分到幾格」——照〈九條「偶爾飄」的測試〉裡「工程師會換位置」
       那條的規矩把骰子固定住，門檻一個字都不動。
       先 releaseWorker 再拔 hm：不放掉的話他們認走的格子會一直掛著，那間永遠蓋不完。
       fall 給大數字讓他們整段躺著，狀態機才不會又去認一間（同下面 w.fall = 99 的寫法）。
       最小的一款是灌木 31 格（見 TREE_KIND 上面那段「塊數 31～220」），一個人蓋至少
       也要拋 31 次，離門檻 20 有餘裕。 */
    for (const w of workers) {
      if (w === me) continue;
      releaseWorker(w); w.hm = -1; w.fall = 999;
    }
    const slots = homes.list[hi].slots.length;
    let cast = 0, carried = 0, pose = 0, secs = 0;
    const orig = castHome;
    castHome = (w, wi, h, k) => { const r = orig(w, wi, h, k); if (r) cast++; return r; };
    while (secs < 600 && homes.list[hi].left > 0) {
      step(0.05); secs += 0.05;
      for (const w of workers) {
        if (!w.mage || w.hm < 0) continue;
        if (w.load.length) carried++;
        if (w.cast > 0.3) pose++;
      }
    }
    castHome = orig;
    return { cast, carried, pose, secs: +secs.toFixed(1), slots,
             left: homes.list[hi].left, kind: homes.list[hi].kind,
             built: blocks.filter(b => b.hh === hi && b.st === 3).length,
             crew: workers.filter(w => w.hm === hi).length };
  });
  ok('魔法師用魔法蓋自己的家（不用手搬）',
     mageHome.cast > 20 && mageHome.carried === 0 && mageHome.pose > 100 &&
     mageHome.left === 0 && mageHome.built === mageHome.slots,
     mageHome.kind + '（' + mageHome.slots + ' 格、' + mageHome.crew + ' 人）' +
     mageHome.secs + ' 秒蓋完：隔空拋了 ' + mageHome.cast + ' 塊、手上搬過 ' +
     mageHome.carried + ' 幀、舉著杖 ' + mageHome.pose + ' 幀，砌好 ' + mageHome.built + ' 塊');

  /* 肌肉小人蓋自己的家也要用肌肉小人的方式（v1.115，使用者：「肌肉小人蓋小房子時
     也要用肌肉小人的方式蓋(小人建築都是依照他的種類去執行 不管是蓋什麼目標)」）。
     他在工地是「撿料跟一般工人一模一樣，撿到手上就地掄出去」，回自己家就該是同一套：
     料照撿照挖（所以跟魔法師不同，他手上會有貨），但**不走回房子**——站在料躺著的
     那個地方扔到格子上。跟魔法師那條一樣手動塞一個進第一間（20 個人裡只有兩個
     肌肉小人、又只抽一半的人離隊，靠運氣的測試不算測試）。 */
  const musHome = await page.evaluate(() => {
    cleanTools();
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 600; setWorkerCount(20); startBuild(true); completeNow();
    let t = 0;
    while (t < 12) { step(0.05); t += 0.05; }
    stopIdleEvent(); clearHomes(); evArm = 0;
    idleEv = IDLE_EVENTS[0]; startHomes();
    if (!workers.some(w => w.mus && w.hm >= 0)) {
      const m = workers.find(w => w.mus);
      releaseWorker(m); m.hm = 0; m.hst = ''; m.ct = 0;
    }
    const hi = workers.filter(w => w.mus && w.hm >= 0).map(w => w.hm)[0];
    const slots = homes.list[hi].slots.length;
    /* 出手的位置：離房子外框多遠。就地掄的話那是他挖到／撿到料的地方（框外好幾格，
       見 DIG_NEAR～DIG_FAR 與 GRAB_R），走回去砌的話一律是 HOME_STAND（1.4）。
       同一輪裡一般工人的數字就是對照組。 */
    const away = { mus: [], lay: [] };
    let carried = 0, secs = 0, musLay = 0;
    const oHurl = hurlTrip, oLay = layHome;
    hurlTrip = (w, h, dt) => {
      const n = w.load.length;
      const r = oHurl(w, h, dt);
      if (w.load.length < n) away.mus.push(Math.hypot(w.x - h.x, w.z - h.z) - h.r);
      return r;
    };
    layHome = (w, h) => {
      const n = w.load.length;
      const r = oLay(w, h);
      if (w.load.length < n) {
        if (w.mus) musLay++;                        // 肌肉小人不該走這條
        else away.lay.push(Math.hypot(w.x - h.x, w.z - h.z) - h.r);
      }
      return r;
    };
    while (secs < 600 && homes.list[hi].left > 0) {
      step(0.05); secs += 0.05;
      for (const w of workers) if (w.mus && w.hm >= 0 && w.load.length) carried++;
    }
    hurlTrip = oHurl; layHome = oLay;
    const avg = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
    /* 改量「有幾成掄得比走回去砌的還遠」，不再比平均（v1.131 修間歇性失敗）。
       這把尺是「離房子中心多遠 − 外接半徑」，而**外接半徑會被房子大小放大**：
       大房子（農莊 231 格）的半徑很誇張，站在長邊旁邊量出來甚至是負的（實測 −3.87）。
       所以平均值高度取決於這一輪抽到哪一款房子——實測八輪的平均差是 0.35～2.11，
       原本要求「差滿一格」紅過一次、改成差半格又紅一次，那不是取樣噪音是量錯東西。
       比例受的影響小得多，而且可以**用同一把尺量走回去砌的那些當對照組**（layFar）：
       萬一哪天肌肉小人改成走回去砌，量到的就會是那個數字。
       實測 layFar 6～8%、肌肉小人 56～92%（九輪），門檻訂在「比對照組多三成」。 */
    const layD0 = avg(away.lay);
    const far = away.mus.filter(d => d > layD0 + 0.5).length;
    // 同一把尺量走回去砌的那些：這就是「萬一他改走 layHome」會量到的比例（對照組）
    const layFar = away.lay.filter(d => d > layD0 + 0.5).length;
    return { hurl: away.mus.length, musLay, carried, secs: +secs.toFixed(1), slots,
             musD: +avg(away.mus).toFixed(2), layD: +layD0.toFixed(2),
             far, farPct: away.mus.length ? +(far / away.mus.length).toFixed(2) : 0,
             layFar: away.lay.length ? +(layFar / away.lay.length).toFixed(2) : 0,
             musMin: +Math.min(...away.mus).toFixed(2),
             layMax: +Math.max(...away.lay).toFixed(2),
             layN: away.lay.length,
             left: homes.list[hi].left, kind: homes.list[hi].kind,
             built: blocks.filter(b => b.hh === hi && b.st === 3).length,
             crew: workers.filter(w => w.hm === hi).length };
  });
  ok('肌肉小人用他自己的方式蓋家（料照撿，但站在原地掄出去）',
     musHome.hurl > 15 && musHome.musLay === 0 && musHome.carried > 0 &&
     musHome.farPct > musHome.layFar + 0.3 &&
     musHome.left === 0 && musHome.built === musHome.slots,
     musHome.kind + '（' + musHome.slots + ' 格、' + musHome.crew + ' 人）' +
     musHome.secs + ' 秒蓋完：就地掄了 ' + musHome.hurl + ' 塊、走回去砌 ' +
     musHome.musLay + ' 塊，出手時離外框平均 ' + musHome.musD + ' 格、最近 ' +
     musHome.musMin + ' 格，其中 ' + (musHome.farPct * 100).toFixed(0) +
     '% 比走回去砌的遠半格以上（一般工人同一輪 ' + musHome.layN + ' 塊、平均 ' +
     musHome.layD + ' 格、最遠 ' + musHome.layMax + ' 格，同一把尺只有 ' +
     (musHome.layFar * 100).toFixed(0) + '% 落在遠處）');

  /* 積木池要**同時**塞得下「最大的地標」與「最大的村子」（v1.115，使用者：
     「有觀察到疑似積木有上限 蓋9000積木 小人蓋小房子 挖地挖不出積木」）。
     兩份共用同一個 ENG.MAXB：地標最大的是萬里長城 9932（面板 9000 那一檔，
     fitScale 挑的那一階會超額），村子最大的是 60 人蓋到飽的 43 間 5405 格。
     v1.114 的 11500 只夠 9932 ＋ 1568，於是 digBlock 開頭的 blocks.length >= MAXB
     一直回 false——小人照挖、土照噴，就是不出積木（實測 60 人第一座就失敗 7629 次、
     第二座起每座 13000+ 次全部失敗，留下 41 間永遠蓋不完的空屋）。
     所以這裡要驗的是「挖得出來」，不是「有上限」：上限本來就有，它得夠大。 */
  const poolFit = await page.evaluate(() => {
    let big = 0, bigN = '';
    for (let i = 0; i < SHAPES.length; i++) {
      const n = makeBlueprint(i, CNT_MAX).slots.length;
      if (n > big) { big = n; bigN = SHAPES[i].n; }
    }
    cleanTools();
    shapePick = SHAPES.findIndex(s => s.n === bigN);
    targetCnt = CNT_MAX; setWorkerCount(60); startBuild(true); completeNow();
    let t = 0;
    while (t < 12) { step(0.05); t += 0.05; }
    stopIdleEvent(); clearHomes(); evArm = 0;
    const orig = digBlock;
    let full = 0;
    digBlock = (w, h) => {
      const f = blocks.length >= ENG.MAXB;
      const r = orig(w, h);
      if (!r && f) full++;                          // 挖不出來，而且是因為池子滿了
      return r;
    };
    idleEv = IDLE_EVENTS[0]; startHomes();
    /* 跑到村子**不再有進展**為止，不是跑滿一個固定的秒數（v1.134）。這一條要驗的是
       「池子夠大，挖得出積木」，不是「四百秒蓋得完」——一輪抽到的房子款式與間數每次都
       不一樣（實測 16 間 2364 格～17 間 2600 格），拿固定秒數當終點的話，抽到大村子的
       那幾輪會在還差幾十格的地方被截斷，紅的是「還沒蓋完」而不是「池子不夠」。
       收工條件：蓋完了，或者連 30 秒一格都沒補上（那才是真的卡住，該紅）。 */
    const leftNow = () => homes.list.reduce((a, h) => a + h.left, 0);
    let secs = 0, prev = Infinity, stall = 0;
    while (secs < 900) {
      for (let i = 0; i < 200; i++) step(0.05);     // 10 秒看一次進度
      secs += 10;
      const n = leftNow();
      if (!n) break;
      if (n >= prev) { if (++stall >= 3) break; } else stall = 0;
      prev = n;
    }
    digBlock = orig;
    const hs = homes.list;
    const sum = f => hs.filter(f).reduce((a, h) => a + h.slots.length, 0);
    return { big, bigN, maxb: ENG.MAXB, pool: blocks.length, full, secs,
             placed: placedCnt, total: bp.slots.length,
             homes: hs.filter(h => !h.tree).length, slots: sum(h => !h.tree),
             trees: hs.filter(h => h.tree).length, treeSlots: sum(h => h.tree),
             budget: TREE_BUDGET,
             left: hs.reduce((a, h) => a + h.left, 0) };
  });
  /* 門檻 v1.153 加上樹那一份：村子現在是「最多 43 間 5405 格的房子 ＋ 最多
     TREE_BUDGET 塊的樹」，兩者都是硬上限（房子靠一人一間、樹靠塊數），
     所以池子要留得下 5405 ＋ 1800。 */
  ok('積木池同時容得下最大的地標與整個村子（挖得出積木）',
     poolFit.full === 0 && poolFit.left === 0 && poolFit.pool <= poolFit.maxb &&
     poolFit.placed === poolFit.total &&
     poolFit.maxb - poolFit.big >= 5405 + poolFit.budget &&
     poolFit.treeSlots <= poolFit.budget,
     poolFit.bigN + ' ' + poolFit.big + ' 塊 ＋ 60 人的村子 ' + poolFit.homes + ' 間 ' +
     poolFit.slots + ' 格 ＋ 樹 ' + poolFit.trees + ' 棵 ' + poolFit.treeSlots +
     ' 格（上限 ' + poolFit.budget + '）→ 池子 ' + poolFit.pool + '／' + poolFit.maxb +
     '，挖不出來 ' + poolFit.full + ' 次、蓋了 ' + poolFit.secs + ' 秒還缺 ' +
     poolFit.left + ' 格');

  /* 房子也要「底部拆掉上面一起垮」（v1.102，使用者指定「同地標建築邏輯」）。
     規則跟 collapseUnsupported 一樣：26 鄰接、從地面那一層往上找連通，連不到的鬆脫。
     所以三種情形要分開驗：整層底部拆掉 → 整棟垮；拿槌子砸底部 → 上面跟著下來；
     只拆屋頂一塊 → 不該連坐（那一塊本來就沒撐著誰）。 */
  const homeFall = await page.evaluate(() => {
    const build = idx => {
      cleanTools();
      shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
      targetCnt = 500; setWorkerCount(6); startBuild(true); completeNow();
      stopIdleEvent(); clearHomes();
      homes = { list: [] };
      const kind = HOME_KIND[idx];
      const at = { x: 0, z: siteR + 5 + homeR(kind) + 8 };
      const slots = homeSlots(at.x, at.z, kind, HOME_PAL[0]);
      const map = new Map();
      slots.forEach((sl, i) => map.set(sl.i + ':' + sl.gy + ':' + sl.k, i));
      /* done／f6／外框都要給齊（見「目標在房子另一邊」那條的說明）：
         少給哪一項都不會報錯，只會靜靜地少驗一條規則。 */
      const hh0 = { x: at.x, z: at.z, r: homeR(kind), kind: kind.id, at: map,
                    ox: (kind.w - 1) / 2, oz: (kind.d - 1) / 2,
                    slots, left: 0, n: kind.n, done: true };
      homeBox(hh0); markHomeF6(hh0);
      homes.list.push(hh0);
      for (let i = 0; i < slots.length; i++) {
        const sl = slots[i], b = newBlock();
        b.x = sl.x; b.y = sl.y; b.z = sl.z; b.st = 3; b.rest = true;
        b.hh = 0; b.hk = i;
        b.r = b.tr = sl.c[0]; b.g = b.tg = sl.c[1]; b.b = b.tb = sl.c[2];
        blocks.push(b); sl.filled = true;
      }
      ENG.setBlockCount(blocks.length);
      for (const w of workers) { releaseWorker(w); w.hm = -1; w.x = 300; w.z = 300; }
      return homes.list[0];
    };
    const alive = () => blocks.filter(b => b.hh === 0 && b.st === 3).length;
    // 1) 整層底部拆掉
    let h = build(6);                                   // 三層樓：最高的一款
    const n0 = alive();
    let removed = 0;
    for (const b of blocks) {
      if (b.hh !== 0 || b.st !== 3 || h.slots[b.hk].gy > 0) continue;
      breakBlock(b, 0, 0, 0); removed++;
    }
    for (let i = 0; i < 200; i++) step(0.05);
    const whole = { n0, removed, after: alive() };
    // 2) 拿槌子砸底部（真的走 smash）
    h = build(0);
    const q0 = alive();
    smash({ x: h.x, y: 0.5, z: h.z - h.r }, { x: 0, y: -0.5, z: 1 }, 5.5, 15);
    for (let i = 0; i < 200; i++) step(0.05);
    const hammer = { n0: q0, after: alive() };
    // 3) 只拆屋頂最上面一塊
    h = build(0);
    const r0 = alive();
    const top = Math.max(...h.slots.map(sl => sl.gy));
    const one = blocks.find(b => b.hh === 0 && b.st === 3 && h.slots[b.hk].gy === top);
    breakBlock(one, 0, 0, 0);
    for (let i = 0; i < 120; i++) step(0.05);
    const roof = { n0: r0, after: alive() };
    /* 4) 只剩對角勾著的也要掉（v1.103）。26 鄰接的支撐判定角碰角就算連著，
       所以「拆掉煙囪底下那一塊」的時候，煙囪還斜斜地勾在旁邊那幾塊屋脊上——
       26 鄰接判它連得到地面，它就吊在半空。這一關（dropHungHome）專門收這種。
       煙囪是最乾淨的案例：單獨一塊、六個面只有底下那一個鄰居。 */
    h = build(0);
    const c0 = alive();
    const chim = h.slots.reduce((a, sl, i) => sl.gy > (a ? h.slots[a].gy : -1) ? i : a, 0);
    const below = h.at.get(h.slots[chim].i + ':' + (h.slots[chim].gy - 1) + ':' +
                           h.slots[chim].k);
    const own = homeOwners();
    breakBlock(blocks[own.get('0:' + below)], 0, 0, 0);
    for (let i = 0; i < 120; i++) step(0.05);
    const hang = { n0: c0, after: alive(),
                   chimGone: !blocks.some(b => b.hh === 0 && b.st === 3 && b.hk === chim) };
    clearHomes();
    return { whole, hammer, roof, hang };
  });
  ok('房子底部拆掉，上面跟著垮（只拆屋頂一塊不會連坐）',
     homeFall.whole.after === 0 &&
     homeFall.hammer.after < homeFall.hammer.n0 * 0.75 &&
     homeFall.roof.after === homeFall.roof.n0 - 1,
     '整層底部拆掉（' + homeFall.whole.removed + ' 塊）→ ' + homeFall.whole.n0 + ' 剩 ' +
     homeFall.whole.after + '；槌子砸底部 → ' + homeFall.hammer.n0 + ' 剩 ' +
     homeFall.hammer.after + '；只拆屋頂一塊 → ' + homeFall.roof.n0 + ' 剩 ' +
     homeFall.roof.after);
  ok('只剩對角勾著的也會掉（煙囪底下那一塊被拆掉，煙囪不會吊在半空）',
     homeFall.hang.chimGone && homeFall.hang.after === homeFall.hang.n0 - 2,
     '拆掉煙囪底下那一塊 → ' + homeFall.hang.n0 + ' 剩 ' + homeFall.hang.after +
     '（煙囪也掉了：' + homeFall.hang.chimGone + '）');

  /* 每一把破壞道具都要作用得到房子（v1.102，使用者指定）。
     兩把原本打不到：煙火的火星是用 blockAt（藍圖的格子表）判有沒有碰到東西，
     房子不在那張表裡；投石機一律照工地中心取落點，擺在小人的家旁邊也是在轟地標。
     火勢蔓延同理——原本只燒被點著的那一塊（spreadFire 走的是藍圖的鄰居表）。
     水桶不在這張表裡：積水是照藍圖的格子在流的，房子不在那個格子系統裡（見 README）。 */
  const homeTools = await page.evaluate(() => {
    const rows = [];
    const build = () => {
      cleanTools();
      shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
      targetCnt = 500; setWorkerCount(6); startBuild(true); completeNow();
      stopIdleEvent(); clearHomes();
      homes = { list: [] };
      const kind = HOME_KIND[3];                        // 大屋 7×5×4
      const at = { x: 0, z: siteR + 5 + homeR(kind) + 8 };
      const slots = homeSlots(at.x, at.z, kind, HOME_PAL[0]);
      const map = new Map();
      slots.forEach((sl, i) => map.set(sl.i + ':' + sl.gy + ':' + sl.k, i));
      /* done／f6／外框都要給齊（見「目標在房子另一邊」那條的說明）：
         少給哪一項都不會報錯，只會靜靜地少驗一條規則。 */
      const hh0 = { x: at.x, z: at.z, r: homeR(kind), kind: kind.id, at: map,
                    ox: (kind.w - 1) / 2, oz: (kind.d - 1) / 2,
                    slots, left: 0, n: kind.n, done: true };
      homeBox(hh0); markHomeF6(hh0);
      homes.list.push(hh0);
      for (let i = 0; i < slots.length; i++) {
        const sl = slots[i], b = newBlock();
        b.x = sl.x; b.y = sl.y; b.z = sl.z; b.st = 3; b.rest = true;
        b.hh = 0; b.hk = i;
        b.r = b.tr = sl.c[0]; b.g = b.tg = sl.c[1]; b.b = b.tb = sl.c[2];
        blocks.push(b); sl.filled = true;
      }
      ENG.setBlockCount(blocks.length);
      for (const w of workers) { releaseWorker(w); w.hm = -1; w.x = 300; w.z = 300; }
      return homes.list[0];
    };
    const alive = () => blocks.filter(b => b.hh === 0 && b.st === 3).length;
    /* wait 給了就用它代替固定步數（給煙火那種「灑得中才算」的用，見下面）。 */
    const run = (id, fn, steps, wait) => {
      const h = build();
      const n0 = alive();
      const top = Math.max(...h.slots.map(sl => sl.y));
      fn(h, { x: h.x, y: top - 1, z: h.z });
      if (wait) wait(h, n0);
      else for (let i = 0; i < (steps || 200); i++) step(0.05);
      rows.push({ id, gone: n0 - alive(), n0 });
    };
    run('槌子', (h, p) => { launchHammer(p, { x: 0, y: -1, z: 0 }, false, false); resolveSwing(); });
    run('大槌', (h, p) => { launchHammer(p, { x: 0, y: -1, z: 0 }, true, false); resolveSwing(); });
    run('地震', (h, p) => { launchHammer({ x: h.x + 6, y: 0, z: h.z }, { x: 0, y: -1, z: 0 }, true, true); resolveSwing(); }, 300);
    run('保齡球', h => launchBall({ x: h.x, z: h.z + 14 }, { x: h.x, z: h.z }), 400);
    run('投石機', h => placeTreb({ x: h.x + 10, z: h.z }), 900);
    run('龍捲風', h => launchTornado({ x: h.x, z: h.z }), 400);
    /* 煙火放三發：火星是從高處隨機散下來的，一發打不中一間 7×5 的房子很正常
       （地標那邊也是同一回事，只是它大得多）。這裡要驗的是「打得到」，不是機率。 */
    /* 煙火的火星是往四面八方灑的，一輪不一定灑得到屋頂上（實測六輪裡有一輪 −0）。
       所以邊放邊看：每 2 秒補三發，打中了就停，最多 35 秒。要驗的是「打得到」，
       不是「一定第一輪就中」。 */
    run('煙火', h => { for (let i = 0; i < 3; i++) launchFw({ x: h.x, z: h.z }); }, 0,
        (h, n0) => {
          for (let r = 0; r < 8 && alive() === n0; r++) {
            if (r) for (let i = 0; i < 3; i++) launchFw({ x: h.x, z: h.z });
            for (let i = 0; i < 40; i++) step(0.05);
          }
        });
    run('放火', () => igniteBlock(blocks.find(b => b.hh === 0 && b.st === 3)), 800);
    run('炸彈', h => placeBomb({ x: h.x, y: 0.5, z: h.z }), 400);
    run('隕石', h => callMeteor({ x: h.x, y: 0, z: h.z }), 400);
    run('核彈', h => callNuke({ x: h.x, z: h.z }), 400);
    run('爆裂魔法', h => castMagic({ x: h.x, z: h.z }), 500);
    cleanTools(); clearHomes();
    return rows;
  });
  ok('每一把破壞道具都打得到小人的家',
     homeTools.length === 12 && homeTools.every(r => r.gone > 0),
     homeTools.map(r => r.id + ' −' + r.gone).join('、') + '（一間 ' +
     homeTools[0].n0 + ' 塊；水桶不算——積水是照藍圖的格子流的）');

  /* 水也要積在屋裡（v1.103，使用者：「破壞&塌毀&建造等物理行為&繞路 邏輯要一樣」）。
     v1.102 之前水的固體判定只問藍圖那張格子表（solidAt → blockAt），房子不在裡面，
     所以水從牆中間流過去、屋裡積不起來。這一條把水倒在屋子正中央，
     看它有多少留在四面牆圍起來的那塊地上。 */
  const homeWater = await page.evaluate(() => {
    const mk = blind => {
      cleanTools();
      shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
      targetCnt = 500; setWorkerCount(6); startBuild(true); completeNow();
      stopIdleEvent(); clearHomes();
      homes = { list: [] };
      const kind = HOME_KIND[8];                        // 農莊 9×6×4：屋內夠大，裝得住水
      const at = { x: 0, z: siteR + 5 + homeR(kind) + 8 };
      const slots = homeSlots(at.x, at.z, kind, HOME_PAL[0]);
      const map = new Map();
      slots.forEach((sl, i) => map.set(sl.i + ':' + sl.gy + ':' + sl.k, i));
      const h = { x: at.x, z: at.z, r: homeR(kind), kind: kind.id, at: map,
                  ox: (kind.w - 1) / 2, oz: (kind.d - 1) / 2,
                  slots, left: 0, n: kind.n, done: true };
      homeBox(h); markHomeF6(h);
      homes.list.push(h);
      for (let i = 0; i < slots.length; i++) {
        const sl = slots[i], b = newBlock();
        b.x = sl.x; b.y = sl.y; b.z = sl.z; b.st = 3; b.rest = true;
        b.hh = 0; b.hk = i;
        blocks.push(b); sl.filled = true;
      }
      ENG.setBlockCount(blocks.length);
      for (const w of workers) { releaseWorker(w); w.hm = -1; w.x = 300; w.z = 300; }
      /* 屋內的地板：牆圍起來、gy 0 沒有積木的那些格。量的是「這幾根柱子上站了多深的水」
         ——不是數格數，同一根柱子疊好幾層水都算同一根。 */
      const floor = new Set();
      for (let i = 1; i < kind.w - 1; i++)
        for (let k = 1; k < kind.d - 1; k++)
          if (!map.has(i + ':0:' + k))
            floor.add(cellX(h.x + i - h.ox) + ':' + cellZ(h.z + k - h.oz));
      /* 對照組：讓水看不見房子（＝v1.102 的行為，solidAt 只問藍圖那張表）。
         倒 40 格就好，不是一整桶 2300 格——屋內只有二十幾格地板，一整桶會直接漫過牆頭
         淹掉整片草地，兩邊都測不出差別（實測一整桶時屋內只占全場水量的 3.8%）。 */
      const orig = homeSolid;
      if (blind) homeSolid = () => false;
      pourBucket(h.x, 0, h.z, 1, 40);
      for (let i = 0; i < 30; i++) step(0.05);          // 1.5 秒：夠攤平、還沒滲乾
      let deep = 0, all = 0;
      const col = new Map();
      if (water) for (const q of water.cells.values()) {
        if (q.v < 0.12) continue;
        all += q.v;
        const k = q.gx + ':' + q.gz;
        if (!floor.has(k)) continue;
        col.set(k, (col.get(k) || 0) + q.v);
      }
      for (const q of col.values()) deep += q;
      homeSolid = orig;
      return { deep: +deep.toFixed(1), all: +all.toFixed(1), cols: col.size,
               floor: floor.size };
    };
    const green = mk(false), red = mk(true);
    cleanTools(); clearHomes();
    return { green, red };
  });
  ok('水會積在屋裡（牆擋得住水）',
     homeWater.green.deep > homeWater.red.deep * 1.5 &&
     homeWater.green.deep / Math.max(0.1, homeWater.green.all) > 0.8,
     '倒 40 格在屋子正中央，1.5 秒後留在屋內地板（' + homeWater.green.floor +
     ' 格）上的水量：現在 ' + homeWater.green.deep + '（全場 ' + homeWater.green.all +
     '、蓋住 ' + homeWater.green.cols + ' 格）；水看不見房子時（v1.102）只有 ' +
     homeWater.red.deep + '（全場 ' + homeWater.red.all + '、蓋住 ' +
     homeWater.red.cols + ' 格）');

  /* 往房子上丟的積木不能穿過自己的屋頂（v1.103）。地標那邊的拋物線會沿路算
     「要多高才過得去」（tossPeak），房子那邊 v1.102 之前是固定公式、完全不看路上有什麼，
     所以往屋子另一側那幾格丟的時候是從屋頂穿過去的。
     同一批弧線用舊公式再算一次當對照組，紅綠在同一輪裡比。 */
  /* **三輪，數字合起來算**（v1.132）：一輪只量得到三十幾條「弧頂真的被墊高的」，
     一條就佔 3.3 個百分點——1/30 跟 5/30 都在正常範圍裡，門檻卻只有 16%。
     實測就這樣紅過一次（16.67%，而訂門檻時那 22 輪的最大值是 10.2%）。
     這不是程式壞了，是取樣太窄：三輪合起來約一百條，一條變成 1 個百分點。 */
  const homeArc = await page.evaluate(() => {
    const thru = (a, peak) => {
      for (let k = 5; k < 37; k++) {          // 掐頭去尾：出手與落點本來就貼著積木
        const u = k / 40;
        const y = a.y0 + (a.y1 - a.y0) * u + Math.sin(u * Math.PI) * peak;
        if (homeSolid(a.x0 + (a.x1 - a.x0) * u, y, a.z0 + (a.z1 - a.z0) * u)) return 1;
      }
      return 0;
    };
    const sum = { arcs: 0, hit: 0, hitOld: 0, up: 0, upHit: 0, upOld: 0, left: 0 };
    for (let round = 0; round < 3; round++) {
      cleanTools();
      shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
      targetCnt = 600; setWorkerCount(20); startBuild(true); completeNow();
      let t = 0;
      while (t < 12) { step(0.05); t += 0.05; }
      stopIdleEvent(); clearHomes(); evArm = 0;
      idleEv = IDLE_EVENTS[0]; startHomes();
      const seen = new Set();
      for (let i = 0; i < 5000 && homes.list.some(h => h.left > 0); i++) {
        step(0.05);
        for (const b of blocks) {
          if (b.st !== 2 || !b.arc || b.arc.hm === undefined || seen.has(b)) continue;
          seen.add(b); sum.arcs++;
          const a = b.arc;
          // v1.102 的固定公式（魔法師那條還要再加 MAGE_LIFT）
          const old = Math.max(1.1, (a.y1 - a.y0) * 0.45 + 1.1) + (a.mage ? MAGE_LIFT : 0);
          const n = thru(a, a.peak), o = thru(a, old);
          sum.hit += n; sum.hitOld += o;
          /* 大部分的拋擲是丟給旁邊那一格，路上本來就沒東西，兩個公式一樣高——
             那些會把比例稀釋掉。所以另外單獨看「弧頂真的被墊高的那幾條」：
             那才是這次改動作用得到的那些，舊公式在那裡本來就該幾乎全穿。 */
          if (a.peak > old + 0.01) { sum.up++; sum.upHit += n; sum.upOld += o; }
        }
      }
      sum.left += homes.list.reduce((n, h) => n + h.left, 0);
    }
    const pct = (a, b) => +(a / Math.max(1, b) * 100).toFixed(2);
    const out = { arcs: sum.arcs, hit: pct(sum.hit, sum.arcs),
                  old: pct(sum.hitOld, sum.arcs), up: sum.up,
                  upHit: pct(sum.upHit, sum.up), upOld: pct(sum.upOld, sum.up),
                  left: sum.left };
    cleanTools(); clearHomes();
    return out;
  });
  /* 跟地標那條（tossPeak，量到 0.86%／2.44%）同一個量法，但房子小又密，
     而且 homeColTop 跟 colTop 一樣只算「從地面連續疊上來」的高度——挑出去的屋簷
     是從底下穿過去的、不算，所以剩下的幾個百分點是這個近似的固有殘量，不是漏算。
     門檻 v1.116 照量的重訂（v1.115 加了肌肉小人就地掄，他站得遠、擦到屋簷的機會多一些）：
     22 輪實測整批 0.95～5.24%、被墊高的那幾條 0～10.2%，所以守 8% 與 16%
     （各自是實測最大值再留幾個百分點，同〈不從蓋好的部分中間穿過去〉那組的訂法）。 */
  ok('往房子上丟的積木不會從自己的屋頂穿過去（三輪合計）',
     /* 被墊高的條數看抽到哪幾款房子（高的多、矮的少），一輪實測 16～40 條，
        三輪合起來所以門檻抓 30。 */
     homeArc.arcs > 900 && homeArc.up >= 30 &&
     homeArc.hit < 8 && homeArc.upHit < 16 &&
     homeArc.upOld > 5 && homeArc.upOld > homeArc.upHit * 3,
     homeArc.arcs + ' 條弧線裡有 ' + homeArc.up + ' 條被墊高：那幾條穿過屋頂的比例 ' +
     homeArc.upHit + '%，用舊的固定公式是 ' + homeArc.upOld + '%（整批：' +
     homeArc.hit + '% ← ' + homeArc.old + '%；沒補上的 ' + homeArc.left + ' 格）');

  /* 占地外框（v1.103）：走路的擋路判定從「外接圓」換成「房子自己那份格子的外框」。
     外接圓把方房子框起來，面積差一倍，看過去每間房子外面都空一圈——
     使用者第一次提這個事件就講過「盡量不要讓建築一圈都沒人，看起來會有點明顯」。
     長條屋差最多（大長屋 12×4 帶圍籬：外框 128、外接圓 292）。 */
  const homeBoxes = await page.evaluate(() => HOME_KIND.map(k => {
    const slots = homeSlots(0, 30, k, HOME_PAL[0]);
    for (const sl of slots) sl.filled = true;          // 完好的一間（外框只框還站著的，見 homeBox）
    const map = new Map();
    slots.forEach((sl, i) => map.set(sl.i + ':' + sl.gy + ':' + sl.k, i));
    const h = { x: 0, z: 30, r: homeR(k), at: map, slots, left: 0, done: true,
                ox: (k.w - 1) / 2, oz: (k.d - 1) / 2 };
    homeBox(h);
    const bw = h.x1 - h.x0, bd = h.z1 - h.z0;
    return { id: k.id, box: +(bw * bd).toFixed(0), disc: +(Math.PI * h.r * h.r).toFixed(0),
             size: bw + '×' + bd,
             // 每一格都要在框裡（門廊與圍籬的負座標最容易漏掉）
             covers: slots.every(sl => sl.x > h.x0 && sl.x < h.x1 &&
                                       sl.z > h.z0 && sl.z < h.z1) };
  }));
  ok('擋路的是房子自己那份格子的外框，不是外接圓（含門廊與圍籬）',
     homeBoxes.length === 9 && homeBoxes.every(r => r.covers && r.box < r.disc),
     homeBoxes.map(r => r.id + ' ' + r.size + '＝' + r.box + '（外接圓 ' + r.disc + '）')
       .join('、'));

  /* 建築中被打掉的那一格會補回來（使用者指定「同地標建築邏輯」）。
     地標那邊是「派工游標退回那個洞」，房子這邊是 h.left 加回去、認領清掉，
     而挑格子一律從清單頭開始找（見 homeFree），所以那個洞是下一個被補的。
     順便驗砌之前會先看「放得上去嗎」（canPlaceHome）：不看的話，底下被打掉時
     小人會把積木砌在半空，下一幀就被垮塌判定打掉，看起來像在做白工。 */
  const homeRepair = await page.evaluate(() => {
    cleanTools();
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 600; setWorkerCount(20); startBuild(true); completeNow();
    let t = 0;
    while (t < 12) { step(0.05); t += 0.05; }
    stopIdleEvent(); clearHomes(); evArm = 0;
    idleEv = IDLE_EVENTS[0]; startHomes();
    // 挑一間人最多的**房子**來測（樹也在同一份清單上，但這條驗的是「回自己家」）
    let hi = homes.list.findIndex(h => !h.tree);
    homes.list.forEach((h, i) => { if (!h.tree && h.n > homes.list[hi].n) hi = i; });
    const h = homes.list[hi];
    // 先蓋一陣子
    let secs = 0;
    while (secs < 120 && h.left > h.slots.length * 0.5) { step(0.05); secs += 0.05; }
    const before = blocks.filter(b => b.hh === hi && b.st === 3).length;
    /* 砸房子本體的下半（不是地基圈的邊緣——三層樓的 h.r 8.5 是連圍籬算的，
       打在那裡只會掃到圍籬）。砸完**當幀**就量：中間讓它跑個兩秒的話，
       同組的人補回來的會比砸掉的還多（實測砸完反而多了一塊）。 */
    smash({ x: h.x, y: 1, z: h.z }, { x: 0, y: -1, z: 0 }, 5.5, 15);
    const hit = blocks.filter(b => b.hh === hi && b.st === 3).length;
    /* 讓他們繼續蓋完。「有沒有砌在半空」在**落定的那一刻**驗（canPlaceHome 擋的就是
       這件事）：改成每幀掃全場的話，會把「支撐剛被打掉、垮塌判定還沒跑」那幾幀
       也算進來（實測 30 次，其實是垮塌的等待時間 0.06 秒 + 鬆脫延遲）。 */
    let more = 0, floating = 0;
    const origLand = landHome;
    landHome = (b, a) => {
      /* 要抓的是「明明放不上去、卻真的砌上去了」。落定時支撐剛好被打掉是會發生的
         （飛的那一秒玩家正在砸），landHome 本來就會把它改成碎料掉下來——
         所以看的是那一格最後有沒有被填起來。 */
      const hh = homes && homes.list[a.hm];
      const bad = !!hh && !canPlaceHome(hh, a.hk);
      const r = origLand(b, a);
      if (bad && hh.slots[a.hk].filled) floating++;
      return r;
    };
    while (more < 600 && h.left > 0) { step(0.05); more += 0.05; }
    landHome = origLand;
    const done = blocks.filter(b => b.hh === hi && b.st === 3).length;
    const r = { kind: h.kind, slots: h.slots.length, before, hit, done,
                left: h.left, secs: +secs.toFixed(1), more: +more.toFixed(1), floating };
    cleanTools(); clearHomes();
    return r;
  });
  ok('蓋到一半被砸掉的那幾格會補回來，而且不會砌在半空',
     homeRepair.hit < homeRepair.before && homeRepair.left === 0 &&
     homeRepair.done === homeRepair.slots && homeRepair.floating === 0 &&
     homeRepair.more < 550,
     homeRepair.kind + ' ' + homeRepair.slots + ' 格：蓋到 ' + homeRepair.before +
     ' 塊時砸剩 ' + homeRepair.hit + ' 塊，再 ' + homeRepair.more + ' 秒補到 ' +
     homeRepair.done + ' 塊（沒補上的 ' + homeRepair.left + ' 格、落定時放不上去的 ' +
     homeRepair.floating + ' 塊）');

  /* 打到剩不到兩成五就整間廢棄（v1.105，使用者：「小房子被破壞剩下 25% 比照地標建築
     直接被破壞廢棄」）。門檻用地標那條同一個 WRECK_AT。廢棄的連鎖好處是那塊地不再擋路、
     倒在裡面的碎料也一起變回一般建材。**蓋到一半的不算**——那時候本來就是從 0 長起來的。 */
  const homeWreck = await page.evaluate(() => {
    const mk = (fill, done) => {
      cleanTools();
      shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
      targetCnt = 500; setWorkerCount(6); startBuild(true); completeNow();
      stopIdleEvent(); clearHomes();
      homes = { list: [] };
      const kind = HOME_KIND[3];                       // 大屋 7×5×4
      const at = { x: 0, z: siteR + 5 + homeR(kind) + 8 };
      const slots = homeSlots(at.x, at.z, kind, HOME_PAL[0]);
      const map = new Map();
      slots.forEach((sl, i) => map.set(sl.i + ':' + sl.gy + ':' + sl.k, i));
      const h = { x: at.x, z: at.z, r: homeR(kind), kind: kind.id, at: map,
                  ox: (kind.w - 1) / 2, oz: (kind.d - 1) / 2,
                  slots, left: slots.length, n: kind.n, done: done };
      markHomeF6(h);
      homes.list.push(h);
      // 由下往上砌 fill 塊（照格子順序＝牆一層層往上）
      for (let i = 0; i < slots.length && i < fill; i++) {
        const sl = slots[i], b = newBlock();
        b.x = sl.x; b.y = sl.y; b.z = sl.z; b.st = 3; b.rest = true;
        b.hh = 0; b.hk = i;
        blocks.push(b); sl.filled = true; h.left--;
      }
      homeBox(h);
      ENG.setBlockCount(blocks.length);
      for (const w of workers) { releaseWorker(w); w.hm = -1; w.x = 300; w.z = 300; }
      return h;
    };
    // ① 蓋好的一間打到剩兩成 → 廢棄
    const h1 = mk(136, true);
    const n1 = h1.slots.length;
    const keepN = Math.round(n1 * 0.2);
    let k = 0;
    for (const b of blocks) {
      if (b.hh !== 0 || b.st !== 3) continue;
      if (k++ < keepN) continue;                       // 留下兩成
      breakBlock(b, 0, 0, 0);
    }
    for (let i = 0; i < 60; i++) step(0.05);
    const gone = { houses: homes.list.length,
                   stillMine: blocks.filter(b => b.hh === 0).length,
                   blocked: !!footHome(h1.x, h1.z),
                   free: blocks.filter(b => b.st === 0 || b.st === 4).length };
    // ② 蓋到一半（還沒蓋好過）的不算：一樣只有兩成，但不該被廢棄
    const h2 = mk(28, false);
    for (let i = 0; i < 60; i++) step(0.05);
    markHomeDirty();
    for (let i = 0; i < 10; i++) step(0.05);
    const half = { houses: homes.list.length, frac: +((h2.slots.length - h2.left) /
                                                      h2.slots.length).toFixed(2) };
    // ③ 外框跟著損壞縮小：打掉一半（x 比較小的那半）
    const h3 = mk(136, true);
    const box0 = { x0: +h3.x0.toFixed(1), x1: +h3.x1.toFixed(1) };
    const cut = h3.x + 0.5;
    for (const b of blocks) {
      if (b.hh !== 0 || b.st !== 3 || b.x > cut) continue;
      breakBlock(b, 0, 0, 0);
    }
    for (let i = 0; i < 60; i++) step(0.05);
    const shrink = { alive: homes.list.length > 0,
                     box0, x0: +h3.x0.toFixed(1), x1: +h3.x1.toFixed(1),
                     // 被打掉那一半的地面現在走得過去了（拿**原本**的左邊界去試）
                     openLeft: !footHome(box0.x0 + 0.6, h3.z),
                     stillRight: !!footHome(h3.x1 - 0.6, h3.z) };
    cleanTools(); clearHomes();
    return { gone, half, shrink, n1, keepN };
  });
  ok('小房子打到剩不到兩成五就整間廢棄（比照地標）',
     homeWreck.gone.houses === 0 && homeWreck.gone.stillMine === 0 &&
     !homeWreck.gone.blocked && homeWreck.gone.free > homeWreck.keepN,
     '一間 ' + homeWreck.n1 + ' 塊只留兩成（' + homeWreck.keepN + ' 塊）→ 剩 ' +
     homeWreck.gone.houses + ' 間、還掛在房子上的積木 ' + homeWreck.gone.stillMine +
     ' 塊、原地還擋路：' + homeWreck.gone.blocked + '（場上碎料 ' +
     homeWreck.gone.free + ' 塊）');
  ok('蓋到一半的不算廢棄（那時候本來就是從零長起來的）',
     homeWreck.half.houses === 1,
     '只砌了 ' + homeWreck.half.frac + ' 就停手 → 還在清單上：' +
     (homeWreck.half.houses === 1));
  ok('擋路的外框跟著損壞縮小',
     homeWreck.shrink.alive && homeWreck.shrink.x0 > homeWreck.shrink.box0.x0 + 1 &&
     Math.abs(homeWreck.shrink.x1 - homeWreck.shrink.box0.x1) < 0.01 &&
     homeWreck.shrink.openLeft && homeWreck.shrink.stillRight,
     '打掉左半邊 → 外框 x 從 ' + homeWreck.shrink.box0.x0 + '～' +
     homeWreck.shrink.box0.x1 + ' 縮成 ' + homeWreck.shrink.x0 + '～' +
     homeWreck.shrink.x1 + '；打掉那半走得過去：' + homeWreck.shrink.openLeft +
     '、沒打的那半還擋著：' + homeWreck.shrink.stillRight);

  /* 積木來源：**地上的碎料優先，沒有才挖**（v1.104，使用者指定）。
     使用者觀察到的情境就是「小房子蓋一半拆掉會一堆碎料，然後小人繼續挖積木蓋」。
     這一條把一間蓋好的房子砸爛，看那一組人補回去的時候是撿地上的還是挖新的。
     躺在**任何一間房子占地上**的碎料不撿——那塊地走不進去（外框是實心的），
     走過去只會被推出來、永遠抵達不了，所以那些還是得挖。 */
  const homeGrab = await page.evaluate(() => {
    cleanTools();
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 600; setWorkerCount(20); startBuild(true); completeNow();
    let t = 0;
    while (t < 12) { step(0.05); t += 0.05; }
    stopIdleEvent(); clearHomes(); evArm = 0;
    idleEv = IDLE_EVENTS[0]; startHomes();
    let s = 0;
    while (s < 600 && homes.list.some(h => h.left > 0)) { step(0.05); s += 0.05; }
    /* 挑最大的那一間，把靠左的一片打掉。**不能整間砸爛**——剩不到兩成五會直接廢棄
       （v1.105），那一間就從清單上消失、沒有「補回去」這回事了。
       用 breakBlock 一塊一塊打（不走 smash）：爆炸範圍換一間房子就是完全不同的破壞量，
       第一版用 smash 就是這樣一路砸到剩一成、整間被廢棄，量到的變成別間的帳。

       砸多少：三成五，但**至少砸 50 塊**（v1.131 修間歇性失敗）。「最大的那一間」有多大
       是看那一組幾個人（見 HOME_KIND：一人組的小院只有 104 格），全場剛好沒有三人組時
       三成五只砸出 36～40 格的洞，下面那條「洞要 > 40 格」就會擦邊紅一次。
       上限壓在五成：留一半才離「剩不到兩成五」有安全邊際。 */
    let hi = 0;
    homes.list.forEach((q, i) => { if (q.slots.length > homes.list[hi].slots.length) hi = i; });
    const h = homes.list[hi];
    const mine = blocks.filter(b => b.hh === hi && b.st === 3)
                       .sort((a, b) => a.x - b.x);
    const nBreak = Math.min(Math.round(mine.length * 0.5),
                            Math.max(50, Math.round(mine.length * 0.35)));
    for (let i = 0; i < nBreak; i++) breakBlock(mine[i], 0, 0, 0);
    for (let i = 0; i < 120; i++) step(0.05);           // 該垮的垮完、碎料落地
    hi = homes.list.indexOf(h);                         // 別間被廢棄的話索引會變
    const hole = h.left;
    const free = () => blocks.filter(b => b.hh < 0 && b.st === 0 && b.rest);
    const rub = free();
    /* 撿得到的：不在**別人家**的地基上（自己家的照撿，v1.105 站在框外伸手拿）、
       不在工地裡、離自己家夠近。 */
    const reach = rub.filter(b => {
      const hb = footHome(b.x, b.z);
      return (!hb || hb === h) &&
             b.x * b.x + b.z * b.z >= (siteR + KEEP) ** 2 &&
             (b.x - h.x) ** 2 + (b.z - h.z) ** 2 <= (h.r + 12) ** 2;
    });
    const all0 = blocks.length, pool0 = rub.length;
    /* 派人回去補。這一輪不准開新的房子（把找空地那一支暫時關掉）——多出來的組去蓋新的
       就要挖一兩百塊新料，帳就算不清了。要測的是「補舊的那些用什麼料」。 */
    const origSite = pickHomeSite;
    pickHomeSite = () => null;
    stopIdleEvent(); idleEv = IDLE_EVENTS[0]; startHomes();
    pickHomeSite = origSite;
    const diag = { hi, houses: homes.list.length, kind: h.kind,
                   slots: h.slots.length, broke: nBreak,
                   assigned: workers.filter(w => w.hm >= 0).length,
                   left0: homes.list.reduce((n, q) => n + q.left, 0),
                   frac: +((h.slots.length - h.left) / h.slots.length).toFixed(2),
                   alive: homes.list.indexOf(h) };
    let grab = 0, dig = 0, secs = 0;
    while (secs < 600 && homes.list.some(q => q.left > 0)) {
      step(0.05); secs += 0.05;
      for (const w of workers) {
        if (w.hm < 0) continue;
        // 魔法師沒有 hst（他不走那條狀態機），照「手上有沒有在飛的」算成撿
        if (w.mage) { if (w.fly.length) grab++; continue; }
        if (w.hst === 'grab') grab++;
        else if (w.hst === 'dig') dig++;
      }
    }
    const out = { hole, rubble: pool0, reach: reach.length, all0, pool0, diag,
                  all1: blocks.length, pool1: free().length, houses: homes.list.length,
                  grab, dig, left: homes.list.reduce((n, q) => n + q.left, 0),
                  secs: +secs.toFixed(0) };
    cleanTools(); clearHomes();
    return out;
  });
  /* 比的是**塊數**不是人-幀：撿的路程短（碎料就在旁邊）、挖的路程長，
     所以人-幀反過來是正常的，拿它當判準會誤判（實測撿 167 塊只花 976 人-幀，
     挖 56 塊卻花 1143 人-幀）。
     也不去對「挖的塊數 = 洞 − 撿的塊數」這本帳：補的過程中還會繼續垮、
     還會有新的碎料落地，那個等式本來就不成立。要成立的是兩件事：
     撿得到的碎料**幾乎全部用掉**，而且撿的比新挖的多。 */
  ok('房子的積木優先撿地上的碎料，撿不到才挖',
     homeGrab.hole > 40 && homeGrab.reach > 20 && homeGrab.left === 0 &&
     /* 門檻抓八成不抓九成：補的過程中還會繼續垮、還會有新的碎料落地，
        「撿得到的」那個數字是**開工前那一刻**的快照（實測 71／79＝0.899 差一點）。 */
     homeGrab.pool0 - homeGrab.pool1 >= homeGrab.reach * 0.8 &&
     homeGrab.pool0 - homeGrab.pool1 > homeGrab.all1 - homeGrab.all0,
     '砸爛之後 ' + homeGrab.hole + ' 格要補、地上 ' + homeGrab.rubble +
     ' 塊碎料（撿得到的 ' + homeGrab.reach + ' 塊）：撿了 ' +
     (homeGrab.pool0 - homeGrab.pool1) + ' 塊、新挖 ' +
     (homeGrab.all1 - homeGrab.all0) + ' 塊（' + homeGrab.secs + ' 秒補完）；' +
     '走去撿 ' + homeGrab.grab + ' 人-幀、走去挖 ' + homeGrab.dig + ' 人-幀' +
     '｜派工 ' + JSON.stringify(homeGrab.diag));

  /* 蓋不完的、被砸出洞的，下一輪要有人接手（v1.103）。
     stopHomes 會把每個人的 hm 清掉（開下一座就是這樣），而 startHomes 以前一律開新的一間，
     所以「蓋一半換場」的房子永遠停在半棟、完工後被砸出洞的也永遠沒人修。
     兩段一起驗：① 蓋一半 → 換場 → 下一輪閒晃，原本那幾間都要有人接手並蓋完
     ② 全部蓋完 → 砸掉一間的一角 → 下一輪閒晃，那一間要補回去。 */
  const homeResume = await page.evaluate(() => {
    cleanTools();
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 600; setWorkerCount(20); startBuild(true); completeNow();
    let t = 0;
    while (t < 12) { step(0.05); t += 0.05; }
    stopIdleEvent(); clearHomes(); evArm = 0;
    idleEv = IDLE_EVENTS[0]; startHomes();
    for (let i = 0; i < 900; i++) step(0.05);          // 蓋 45 秒，都還沒蓋完
    /* 房子與樹分開數（v1.153）：蓋房子的那批人只接得了沒蓋完的房子、種樹的那批只接得了
       沒種完的樹（見 pickUnfinished 的 tree 參數），所以「舊的沒人接就不准開新的」
       這條不變式要各自成立——混在一起算的話，樹那邊開新的會被記到房子頭上。 */
    const cnt = f => homes.list.filter(f).length;
    const n0 = cnt(h => !h.tree), n0T = cnt(h => h.tree);
    const half = cnt(h => h.left > 0 && !h.tree), halfT = cnt(h => h.left > 0 && h.tree);
    const all0 = homes.list.length;
    const mid = homes.list.reduce((n, h) => n + (h.slots.length - h.left), 0);
    // 換場：大家回去上工，房子留在原地沒人管
    stopIdleEvent();
    const orphan = workers.filter(w => w.hm >= 0).length;
    // 下一輪閒晃事件
    idleEv = IDLE_EVENTS[0]; startHomes();
    const mine = homes.list.map((h, i) => workers.some(w => w.hm === i));
    // 只數「原本那幾間」有沒有被接手：組數比間數多的時候，多出來的那幾組會去開新的
    const took = f => homes.list.filter((h, i) => i < all0 && mine[i] && f(h)).length;
    const taken = took(h => !h.tree), takenT = took(h => h.tree);
    const n1 = cnt(h => !h.tree), n1T = cnt(h => h.tree);
    /* 只等「這一輪有人接手的那幾間」。組數看的是散場時大家站在哪（就近湊隊），
       所以間數多的時候會有一兩間排到下一輪——那不是壞掉，是排隊。 */
    let secs = 0;
    while (secs < 600 && homes.list.some((h, i) => mine[i] && h.left > 0)) {
      step(0.05); secs += 0.05;
    }
    const left1 = homes.list.reduce((n, h, i) => n + (mine[i] ? h.left : 0), 0);
    // ② 拆掉一間的屋頂幾塊，看下一輪有沒有人來補
    const hi = 0, h0 = homes.list[hi];
    /* 直接打掉最上面那幾塊，不走 smash：smash 的落點得自己抓，抓在外接圓上時
       牆不一定在那裡（實測有一輪一塊都沒打到、洞是 0 格）。這一條要驗的是
       「有洞就有人來補」，洞怎麼來的不重要；挑最上面那幾塊也不會連坐整棟。 */
    const tops = blocks.filter(b => b.hh === hi && b.st === 3)
                       .sort((a, b) => h0.slots[b.hk].gy - h0.slots[a.hk].gy)
                       .slice(0, 6);
    for (const b of tops) breakBlock(b, 0, 0, 0);
    for (let i = 0; i < 60; i++) step(0.05);           // 讓該垮的先垮完
    const hole = h0.left;
    stopIdleEvent();
    idleEv = IDLE_EVENTS[0]; startHomes();
    const fixer = workers.some(w => w.hm === hi);
    let s2 = 0;
    while (s2 < 400 && h0.left > 0) { step(0.05); s2 += 0.05; }
    const fixed = h0.left;
    cleanTools(); clearHomes();
    return { n0, half, mid, orphan, taken, n1, left1, secs: +secs.toFixed(0),
             n0T, halfT, takenT, n1T,
             hole, fixer, fixed, s2: +s2.toFixed(0) };
  });
  ok('蓋不完的房子與樹下一輪有人接手，砸出洞的也有人來補',
     homeResume.half > 0 && homeResume.orphan === 0 &&
     /* 舊的還沒人接就不准開新的：要嘛數量沒變，要嘛原本沒蓋完的全都有人接手了
        （組數比間數多的時候，多出來的那幾組才去開新的）。房子與樹各自成立。 */
     homeResume.taken > 0 &&
     (homeResume.n1 === homeResume.n0 || homeResume.taken === homeResume.half) &&
     (homeResume.n1T === homeResume.n0T || homeResume.takenT === homeResume.halfT) &&
     homeResume.left1 === 0 &&
     homeResume.hole > 0 && homeResume.fixer && homeResume.fixed === 0,
     '蓋 45 秒停在 ' + homeResume.mid + ' 塊（房子 ' + homeResume.half + ' / ' +
     homeResume.n0 + ' 間、樹 ' + homeResume.halfT + ' / ' + homeResume.n0T +
     ' 棵沒蓋完）→ 換場後 ' + homeResume.orphan +
     ' 人還在蓋 → 下一輪接手 ' + homeResume.taken + ' 間 ＋ ' + homeResume.takenT +
     ' 棵（房子 ' + homeResume.n0 + ' → ' + homeResume.n1 + ' 間、樹 ' +
     homeResume.n0T + ' → ' + homeResume.n1T + ' 棵），' + homeResume.secs +
     ' 秒蓋完（還差 ' + homeResume.left1 +
     ' 格）；砸出 ' + homeResume.hole + ' 格的洞 → 有人接手：' +
     homeResume.fixer + '，' + homeResume.s2 + ' 秒後還差 ' + homeResume.fixed + ' 格');

  /* 目標在房子另一邊的時候要**繞過去**（v1.99）。使用者回報「小人會面向小房子原地走路」：
     v1.98 只有 pushOutHome 硬把人推出屋外，沒有「繞開」那一步，於是他直直走進房子、
     每幀被推回來——腿一直在擺，人在原地。蓋完在家附近晃的人最常遇到，
     因為那些目標點就環繞著自己家。
     這條擺一間蓋好的房子，人站一側、目標放正對面，看他十秒內走不走得到；
     對照組把 blockHome 換成空的（＝v1.98 的行為）。 */
  const around = await page.evaluate(() => {
    stopIdleEvent();
    homes = { list: [] };
    const kind = HOME_KIND[0];
    const slots = homeSlots(0, 24, kind, HOME_PAL[0]);
    for (const sl of slots) sl.filled = true;
    /* 照 startHomes 那一份組起來，不要只給 x/z/r：擋路判定看的是格子外框
       （x0/x1/z0/z1，見 footHome），垮塌與砌得上去看的是 at／f6／done。
       少給哪一項都不會報錯，只會靜靜地變成「什麼都不擋」——這條測試就白測了。 */
    const at = new Map();
    slots.forEach((sl, i) => at.set(sl.i + ':' + sl.gy + ':' + sl.k, i));
    const h = { x: 0, z: 24, r: homeR(kind), kind: kind.id, at,
                ox: (kind.w - 1) / 2, oz: (kind.d - 1) / 2,
                slots, left: 0, n: 1, done: true };
    homeBox(h); markHomeF6(h);
    homes.list.push(h);
    const run = on => {
      const orig = blockHome;
      if (!on) blockHome = () => null;
      const w = workers[0];
      releaseWorker(w);
      w.hm = -1; w.flee = 0; w.air = 0; w.burn = 0; w.pause = 0; w.leg = 0; w.gait = 0;
      w.x = h.x; w.z = h.z - (h.r + 1.6);
      w.tx = h.x; w.tz = h.z + (h.r + 1.6);
      let walked = 0, px = w.x, pz = w.z, arrived = -1, stuck = 0;
      for (let i = 0; i < 200; i++) {
        const d0 = Math.hypot(w.tx - w.x, w.tz - w.z);
        strollTo(w, 0.05);
        walked += Math.hypot(w.x - px, w.z - pz);
        px = w.x; pz = w.z;
        const d1 = Math.hypot(w.tx - w.x, w.tz - w.z);
        if (w.gait > 0.6 && d1 > d0 - 0.02) stuck++;      // 腿在擺、卻沒靠近目標
        if (arrived < 0 && d1 < REACH) arrived = +((i + 1) * 0.05).toFixed(2);
      }
      blockHome = orig;
      return { arrived, walked: +walked.toFixed(1), stuck };
    };
    const on = run(true), off = run(false);
    /* 直線走那條路（stepTo，上工與拆除退場在用）也要繞——v1.102 之前只有閒晃會繞，
       所以施工中搬料的人會貼著人家的牆磨過去（實測 236 幀）。 */
    const line = (() => {
      const w = workers[1];
      releaseWorker(w);
      w.hm = -1; w.flee = 0; w.air = 0; w.burn = 0; w.pause = 0; w.gait = 0;
      w.x = h.x; w.z = h.z - (h.r + 1.6);
      const tx = h.x, tz = h.z + (h.r + 1.6);
      let arrived = -1, stuck = 0;
      for (let i = 0; i < 200; i++) {
        const d0 = Math.hypot(tx - w.x, tz - w.z);
        stepTo(w, tx, tz, 0.05);
        const d1 = Math.hypot(tx - w.x, tz - w.z);
        if (w.gait > 0.6 && d1 > d0 - 0.02) stuck++;
        if (arrived < 0 && d1 < REACH) arrived = +((i + 1) * 0.05).toFixed(2);
      }
      return { arrived, stuck };
    })();
    homes = null;
    return { on, off, line, straight: +(2 * (h.r + 1.6)).toFixed(1) };
  });
  ok('目標在房子另一邊時會繞過去，不是頂著牆原地走',
     around.on.arrived > 0 && around.on.arrived < 4 && around.on.stuck < 20 &&
     around.on.walked > around.straight && around.on.walked < around.straight * 2 &&
     around.off.arrived < 0 && around.off.stuck > 100 &&
     around.line.arrived > 0 && around.line.arrived < 4 && around.line.stuck < 20,
     '繞：' + around.on.arrived + ' 秒到（走了 ' + around.on.walked + '，直線 ' +
     around.straight + '），腿在擺卻沒前進 ' + around.on.stuck + ' 幀；' +
     '不繞（v1.98）：十秒' + (around.off.arrived < 0 ? '到不了' : '到了') +
     '、只走了 ' + around.off.walked + '，原地走 ' + around.off.stuck + ' 幀；' +
     '直線走法（stepTo）' + around.line.arrived + ' 秒到、原地走 ' + around.line.stuck + ' 幀');

  /* 繞工地外圈那條路（ringWalk）也要繞開房子（v1.104，使用者回報「蓋地標建築的時候
     有小人會被小房子卡住」）。它的位置是每一幀用極座標**重算**的，所以只靠 pushOutHome
     推是沒用的——推出來的位移下一幀就被丟掉，人頂著房子外框磨到天亮。
     實測換一座大的地標之後（舊房子留在場上、最近的一間離中心 16.4，而走路的圈在 16.3）
     磨掉 5163 人-幀，改完 4 幀。
     這一條把房子直接壓在圈上，人從一側繞到另一側；對照組把「往外鼓出去」關掉。 */
  const ringHome = await page.evaluate(() => {
    cleanTools();
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 600; setWorkerCount(6); startBuild(true); completeNow();
    stopIdleEvent(); clearHomes();
    homes = { list: [] };
    const kind = HOME_KIND[3];                         // 大屋 7×5×4
    const R = siteR + KEEP;                            // 走路的圈就在這個半徑上
    const slots = homeSlots(R, 0, kind, HOME_PAL[0]);
    for (const sl of slots) sl.filled = true;
    const map = new Map();
    slots.forEach((sl, i) => map.set(sl.i + ':' + sl.gy + ':' + sl.k, i));
    const h = { x: R, z: 0, r: homeR(kind), kind: kind.id, at: map,
                ox: (kind.w - 1) / 2, oz: (kind.d - 1) / 2,
                slots, left: 0, n: 1, done: true };
    homeBox(h); markHomeF6(h);
    homes.list.push(h);
    const run = on => {
      const o1 = ringGoal, o2 = ringHold;
      if (!on) {                                       // ＝v1.103 的行為（只有硬推）
        ringGoal = (ca, dA, rad) => rad;
        ringHold = (na, cr, want) => want;
      }
      const w = workers[0];
      releaseWorker(w);
      w.hm = -1; w.flee = 0; w.air = 0; w.burn = 0; w.fall = 0; w.gait = 0; w.pause = 0;
      const a0 = -1.0, a1 = 1.0;                       // 從房子這一側繞到那一側
      w.x = Math.cos(a0) * R; w.z = Math.sin(a0) * R;
      let arrived = -1, stuck = 0, inHome = 0, px = w.x, pz = w.z;
      for (let i = 0; i < 200; i++) {
        const done = ringWalk(w, a1, R, 0.05);
        const mv = Math.hypot(w.x - px, w.z - pz);
        px = w.x; pz = w.z;
        if (mv <= 0.02 && w.gait > 0.6) stuck++;
        if (footHome(w.x, w.z)) inHome++;
        if (arrived < 0 && done) arrived = +((i + 1) * 0.05).toFixed(2);
      }
      ringGoal = o1; ringHold = o2;
      return { arrived, stuck, inHome };
    };
    const on = run(true), off = run(false);
    const out = { on, off, R: +R.toFixed(1) };
    cleanTools(); clearHomes();
    return out;
  });
  ok('繞工地外圈的路上有房子也會繞過去（不是頂著外框磨）',
     ringHome.on.arrived > 0 && ringHome.on.arrived < 5 && ringHome.on.stuck < 10 &&
     ringHome.on.inHome === 0 &&
     ringHome.off.arrived < 0 && ringHome.off.stuck > 100,
     '房子壓在半徑 ' + ringHome.R + ' 的圈上：會鼓出去繞 → ' + ringHome.on.arrived +
     ' 秒到、原地走 ' + ringHome.on.stuck + ' 幀、踩進外框 ' + ringHome.on.inHome +
     ' 幀；只有硬推（v1.103）→ 十秒' + (ringHome.off.arrived < 0 ? '到不了' : '到了') +
     '、原地走 ' + ringHome.off.stuck + ' 幀');

  /* 著火跑圈圈（burnMove）跟被炸飛落地（flyWorker）也要處理房子（v1.104）。
     burnMove 的位置跟 ringWalk 一樣是每幀用圈心＋角度重算的，所以推人不推圈心的話
     下一幀又算回房子裡；flyWorker 落地之後接著是躺平那幾秒（那條路徑完全不動），
     落在人家牆裡就躺在牆裡等時間跑完。 */
  const hitHome = await page.evaluate(() => {
    cleanTools();
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 600; setWorkerCount(6); startBuild(true); completeNow();
    stopIdleEvent(); clearHomes();
    homes = { list: [] };
    const kind = HOME_KIND[3];
    const cx = siteR + 14;
    const slots = homeSlots(cx, 0, kind, HOME_PAL[0]);
    for (const sl of slots) sl.filled = true;
    const map = new Map();
    slots.forEach((sl, i) => map.set(sl.i + ':' + sl.gy + ':' + sl.k, i));
    const h = { x: cx, z: 0, r: homeR(kind), kind: kind.id, at: map,
                ox: (kind.w - 1) / 2, oz: (kind.d - 1) / 2,
                slots, left: 0, n: 1, done: true };
    homeBox(h); markHomeF6(h);
    homes.list.push(h);
    for (const w of workers) { releaseWorker(w); w.hm = -1; w.x = 300; w.z = 300; }
    // ① 著火：圈心擺在房子正中央，圈子整個壓在房子上
    const w0 = workers[0];
    w0.x = h.x; w0.z = h.z; w0.y = 0;
    igniteWorker(w0, false);
    w0.roll = 0;                                       // 逼他走「跑圈圈」那條，不是打滾
    w0.bx = h.x; w0.bz = h.z;
    let raw = 0, body = 0;
    for (let i = 0; i < 200; i++) {
      step(0.05);
      if (w0.burn <= 0) break;
      if (footHome(w0.bx + Math.cos(w0.ba) * w0.br, w0.bz + Math.sin(w0.ba) * w0.br)) raw++;
      if (footHome(w0.x, w0.z)) body++;
    }
    const burn = { raw, body, moved: +Math.hypot(w0.bx - h.x, w0.bz - h.z).toFixed(1) };
    // ② 被炸飛：往房子正中央丟過去
    const w1 = workers[1];
    w1.x = h.x - 12; w1.z = h.z; w1.y = 0;
    tossWorker(w1, 12 / 0.9, 4.4, 0, false);           // 約 0.9 秒後落在屋子中央附近
    let land = -1;
    for (let i = 0; i < 200 && land < 0; i++) {
      step(0.05);
      if (!w1.air) land = i;
    }
    const fly = { land, inHome: !!footHome(w1.x, w1.z), fall: w1.fall > 0 || w1.burn > 0,
                  d: +Math.hypot(w1.x - h.x, w1.z - h.z).toFixed(1) };
    cleanTools(); clearHomes();
    return { burn, fly, r: +h.r.toFixed(1) };
  });
  ok('著火跑圈圈會把圈子挪出房子，不是每幀被推一次',
     hitHome.burn.raw < 40 && hitHome.burn.body === 0 && hitHome.burn.moved > 1,
     '圈心從屋子正中央起跑：圈上的點還落在外框裡 ' + hitHome.burn.raw +
     ' 幀（200 幀內）、人本身踩進外框 ' + hitHome.burn.body + ' 幀、圈心挪了 ' +
     hitHome.burn.moved + ' 格');
  ok('被炸飛剛好落在人家屋子裡會被推出來',
     hitHome.fly.land >= 0 && !hitHome.fly.inHome,
     '第 ' + hitHome.fly.land + ' 幀落地，落點在外框裡：' + hitHome.fly.inHome +
     '（離屋子中心 ' + hitHome.fly.d + '、地基半徑 ' + hitHome.r + '）');

  /* 躺在房子外框裡的碎料也要撿得出來（v1.107，使用者：「小房子內的積木也撿不出來」）。
     v1.97～v1.106 是**一律跳過**的，理由是「走過去會被推出屋外、永遠抵達不了，那個人就
     卡在 pick 上」。那個理由是真的，但代價是那些料永遠回收不了——實測換一座地標之後，
     場上 730 塊自由碎料裡有 338 塊埋在房子外框裡，一半的料撿不到，於是一堆人領不到工作
     就在房子旁邊閒晃，看起來就是「卡住」。
     現在站到外框最近的那一面外面伸手拿（pickSpot → grabStand）。
     對照組把 pickSpot 換成「走到積木本身」＝v1.106 那個走不進去的版本。 */
  const buried = await page.evaluate(() => {
    const run = on => {
      cleanTools();
      shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
      targetCnt = 900; setWorkerCount(20); startBuild(true);
      stopIdleEvent(); clearHomes();
      /* 先把碎料鋪回「躺在地上、散在工地外」（v1.128.1）。startBuild(true) 那一刻
         上一輪的建築整棟解成碎料**原地落下**，那一瞬間全在半空（rest 是 false），
         下面挑「十二塊躺著的」有可能一塊都挑不到——實測整輪跑時對照組出現過
         `n = 0`，於是「撿走 0 塊 < 12」白白通過，等於根本沒有對照組。 */
      scatterFree();
      homes = { list: [] };
      const kind = HOME_KIND[3];                       // 大屋 7×5×4
      const at = { x: 0, z: siteR + 4 + homeR(kind) };
      const slots = homeSlots(at.x, at.z, kind, HOME_PAL[0]);
      const map = new Map();
      slots.forEach((sl, i) => map.set(sl.i + ':' + sl.gy + ':' + sl.k, i));
      const h = { x: at.x, z: at.z, r: homeR(kind), kind: kind.id, at: map,
                  ox: (kind.w - 1) / 2, oz: (kind.d - 1) / 2,
                  slots, left: slots.length, n: kind.n, done: true };
      markHomeF6(h); homes.list.push(h);
      // 只砌牆的第一層（外框就成立了），屋裡留空好擺碎料
      for (let i = 0; i < slots.length; i++) {
        if (slots[i].gy !== 0) continue;
        const sl = slots[i], b = newBlock();
        b.x = sl.x; b.y = sl.y; b.z = sl.z; b.st = 3; b.rest = true;
        b.hh = 0; b.hk = i;
        blocks.push(b); sl.filled = true; h.left--;
      }
      homeBox(h);
      // 把十二塊碎料搬進外框裡
      const inside = [];
      for (let i = 0; i < blocks.length && inside.length < 12; i++) {
        const b = blocks[i];
        if (b.st !== 0 || !b.rest || b.hh >= 0 || b.holder >= 0) continue;
        if (b.cell) gridDel(b);
        b.x = h.x + rr(-1.5, 1.5); b.z = h.z + rr(-1, 1); b.y = HB;
        gridAdd(b);
        inside.push(i);
      }
      /* 其餘自由碎料推到房子外圈以外（v1.128.1）：不這麼做的話工地旁邊那一圈料
         比屋裡那十二塊近得多，工人輪不到去挑它們——實測正面那一趟要 69～112 秒才撿完，
         離 150 秒的上限只差一點。現在屋裡那十二塊是**全場最近的料**，
         兩邊都變成「一定會去挑它」，剩下的差別就只有「進不進得去」。 */
      const keep = new Set(inside);
      const far0 = Math.hypot(h.x, h.z) + h.r + 12;
      for (let i = 0; i < blocks.length; i++) {
        if (keep.has(i)) continue;
        const bb = blocks[i];
        if (bb.st !== 0 || !bb.rest || bb.hh >= 0 || bb.holder >= 0) continue;
        if (bb.cell) gridDel(bb);
        const a = Math.random() * Math.PI * 2;
        const rad = far0 + Math.random() * Math.max(4, arenaR - far0);
        bb.x = Math.cos(a) * rad; bb.z = Math.sin(a) * rad; bb.y = HB;
        separate(bb); gridAdd(bb);
      }
      ENG.setBlockCount(blocks.length);
      const all = inside.every(i => footHome(blocks[i].x, blocks[i].z));
      /* 對照組＝v1.106：走到積木本身（走不進去），而且沒有「搆不到就伸手拿」。
         v1.108 之後只關 pickSpot 是不夠的——伸手拿（nearGrab）會在原地把它撿起來、
         卡住脫困（stuckWatch）會讓他穿牆走進去，兩個都會把對照組救起來，
         紅綠就分不出來了（實測 150 秒照樣撿走 12 塊）。
         **v1.128.1 再補一個：魔法師**。他是隔空撿的——`findBlock(sx, sz, MAGE_REACH, …)`，
         站在外框旁邊 11 格內就搆得到，整條路**完全不經過 pickSpot**，
         而 findBlock 從 v1.107 起就不再跳過房子外框裡的料。20 個人裡有 2 個魔法師，
         他們有沒有剛好在那 150 秒裡站到房子旁邊是隨機的——這一條的間歇性失敗就是
         這麼來的（實測整輪跑開出過「對照組也撿走 12 塊」）。
         所以對照組把 updMage 一起停掉（updWorker 對魔法師是整支委派給它，見那一行的
         `if (w.mage) { updMage(...); return; }`，停掉就等於這 2 個人不動）。 */
      const orig = pickSpot, orig2 = nearGrab, orig3 = updMage;
      if (!on) { pickSpot = b => b; nearGrab = () => false; updMage = () => {}; }
      let secs = 0, got = 0;
      while (secs < 150 && got < inside.length) {
        step(0.05); secs += 0.05;
        // 對照組連 v1.108 的脫困穿透一起關掉，不然那個也會把他救進屋裡（見下面那兩條）
        if (!on) for (const q of workers) q.ghost = 0;
        got = inside.filter(i => blocks[i].st !== 0).length;
      }
      pickSpot = orig; nearGrab = orig2; updMage = orig3;
      cleanTools(); clearHomes();
      return { n: inside.length, got, all, secs: +secs.toFixed(0),
               mages: workers.filter(q => q.mage).length };
    };
    const on = run(true), off = run(false);
    return { on, off };
  });
  ok('躺在房子外框裡的碎料撿得出來（站到框外伸手拿）',
     buried.on.all && buried.on.n === 12 && buried.on.got === 12 &&
     buried.off.n === 12 && buried.off.got < 12,
     '屋裡擺 ' + buried.on.n + ' 塊：站到框外拿 → ' + buried.on.secs + ' 秒撿走 ' +
     buried.on.got + ' 塊；走到積木本身（v1.106，連伸手拿／脫困穿透／' +
     buried.off.mages + ' 個魔法師的隔空撿一起關掉）→ ' + buried.off.secs +
     ' 秒只撿走 ' + buried.off.got + ' 塊');

  /* 敲一下完工的建築，不該把全場小人嚇跑（v1.106，使用者：「敲一下持續驚嚇不合理」）。
     phase 照樣進「拆除中」（那是換場的記帳狀態），但小人繼續過自己的生活——
     在家附近走走、聊天、蓋房子。v1.105 之前拆除中會讓全場退到外圈站著不動：
     實測敲一下之後 60 秒裡 24000/24000 人-幀都停在那條分支，平均半徑被推到 arenaR×0.78。
     順便再驗一次「拆除中不會偷偷把它修回去」——那條是 build 的狀態機，這裡走不到。 */
  const noScare = await page.evaluate(() => {
    cleanTools();
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 600; setWorkerCount(20); startBuild(true); completeNow();
    let t = 0;
    while (t < 12) { step(0.05); t += 0.05; }
    stopIdleEvent(); clearHomes(); evArm = 0;
    idleEv = IDLE_EVENTS[0]; startHomes();
    let s = 0;
    while (s < 600 && homes.list.some(h => h.left > 0)) { step(0.05); s += 0.05; }
    /* 量的是**沒有家的那些人**的平均半徑：有家的人本來就住在自己家附近（外圈到碎料場
       外緣都有），把他們算進來會把數字洗掉（實測全場平均在 20～24 之間亂跳）。
       沒有家的人該待在閒晃那一圈（siteR + 2～9）；被趕走的話會跑到 arenaR×0.78。 */
    const avgR = () => {
      const q = workers.filter(w => w.hm < 0);
      return q.length ? +(q.reduce((a, w) => a + Math.hypot(w.x, w.z), 0) /
                          q.length).toFixed(1) : 0;
    };
    const own0 = workers.filter(w => w.hm >= 0).length, r0 = avgR();
    // 敲一下（小槌打在地標側面）
    smash({ x: 0, y: bp.height * 0.4, z: siteR * 0.8 }, { x: 0, y: -0.3, z: -1 }, 5.5, 15);
    const ph = phase, placed0 = placedCnt;
    let ev = 0, out = 0;
    for (let i = 0; i < 600; i++) {                   // 30 秒
      step(0.05);
      if (idleEv) ev++;                               // 事件還在跑
      for (const w of workers) if (Math.hypot(w.x, w.z) > arenaR * 0.7) out++;
    }
    const out1 = { ph, own0, own1: workers.filter(w => w.hm >= 0).length,
                   r0, r1: avgR(), placed0, placed1: placedCnt, ev,
                   outFrac: +(out / (600 * workers.length)).toFixed(2),
                   arenaR: +arenaR.toFixed(1), siteR: +siteR.toFixed(1) };
    cleanTools(); clearHomes();
    return out1;
  });
  ok('敲完工的建築不會把全場小人嚇跑（拆除中照樣過自己的生活）',
     /* 「被趕到外圈」那個比例只列出來參考，不當判準：房子本來就散在外圈到碎料場外緣，
        住在自己家附近的人本來就在那個半徑上（實測 0.36）。分得出來的是三件事——
        事件還在不在跑、有家可住的人還有沒有、**沒有家的人還在不在閒晃那一圈**。
        v1.105 之前這三個分別是 0 幀、0 人、被推到 arenaR×0.78（≈28）。 */
     noScare.ph === 'wreck' && noScare.ev === 600 && noScare.own1 === noScare.own0 &&
     noScare.r1 > 0 && noScare.r1 < noScare.siteR + 12 &&
     noScare.placed1 === noScare.placed0,
     '敲一下之後 phase=' + noScare.ph + '：事件還在跑 ' + noScare.ev +
     '/600 幀、有家可住的 ' + noScare.own0 + ' → ' + noScare.own1 +
     ' 人、沒家的人平均半徑 ' + noScare.r0 + ' → ' + noScare.r1 +
     '（閒晃圈上限 ' + (noScare.siteR + 12).toFixed(1) + '、碎料場外緣 ' +
     noScare.arenaR + '，被趕到外圈的人-幀占 ' + noScare.outFrac +
     '）、建築 ' + noScare.placed0 + ' → ' + noScare.placed1 + ' 沒被偷偷修回去');

  /* ══════════ 一整輪的生命週期（v1.108，使用者指定的四段） ══════════
     ① 地標建造中被破壞　② 蓋完之後，小人蓋自己家的過程中小房子被破壞
     ③ 小房子蓋好之後被破壞　④ 破壞地標到換下一座，蓋完小人又開始蓋家
     為什麼要串成一輪跑，而不是四段各測各的：會出事的都在**接縫**上——
     換場時沒放掉的認領、被廢棄那一間造成的索引位移、下一座蓋完之後事件還起不起得來。
     順便量整輪有沒有人卡住（判準跟 stuckWatch 同一套，見下面那條）。 */
  const lifeRun = await page.evaluate(() => {
    cleanTools(); clearHomes(); stopIdleEvent(); evArm = 1;
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 700; setWorkerCount(20); startBuild(true);
    // 卡住：腿在擺（gait > 0.6）卻一直沒離開錨點 1.2 格。站著聊天／發呆不算
    const anc = workers.map(w => ({ x: w.x, z: w.z })), hold = workers.map(() => 0);
    let worst = 0, over4 = 0, ghost = 0, frames = 0;
    const sample = dt => {
      frames++;
      for (let i = 0; i < workers.length; i++) {
        const w = workers[i];
        if (w.ghost > 0) ghost++;
        if (w.gait <= 0.6 || w.air || w.burn > 0 ||
            (w.x - anc[i].x) ** 2 + (w.z - anc[i].z) ** 2 > 1.2 * 1.2) {
          anc[i].x = w.x; anc[i].z = w.z; hold[i] = 0; continue;
        }
        hold[i] += dt;
        if (hold[i] > worst) worst = hold[i];
        if (hold[i] > 4 && hold[i] - dt <= 4) over4++;
      }
    };
    const go = (secs, done) => {
      let t = 0;
      while (t < secs && !(done && done())) { step(0.05); sample(0.05); t += 0.05; }
      return +t.toFixed(1);
    };
    const smashOne = c => smash(new THREE.Vector3(c.x, c.y, c.z),
      new THREE.Vector3(rr(-0.3, 0.3), -0.9, rr(-0.3, 0.3)).normalize(), 5.5, 20);
    const pickOne = q => q.length ? q[Math.floor(Math.random() * q.length)] : null;
    const setBlk = () => blocks.filter(b => b.st === 3 && b.hh < 0);
    const homeBlk = h => blocks.filter(b => b.st === 3 && b.hh >= 0 && homes.list[b.hh] === h);

    /* ── ① 地標蓋到一半被砸 ── */
    go(40);
    const s1built = placedCnt;
    for (let k = 0; k < 6; k++) { const c = pickOne(setBlk()); if (c) smashOne(c); }
    go(2);
    const s1hurt = placedCnt;
    const s1secs = go(500, () => phase !== 'build');
    const s1 = { built: s1built, hurt: s1hurt, secs: s1secs,
                 placed: placedCnt, total: bp.slots.length, phase };

    /* ── ② 小房子蓋到一半被砸 ── */
    const s2start = go(30, () => homes && homes.list.length > 0);
    const need = () => homes.list.reduce((a, h) => a + h.slots.length, 0);
    const got = () => homes.list.reduce((a, h) => a + (h.slots.length - h.left), 0);
    go(400, () => got() > need() * 0.4);
    const half = got(), need0 = need();
    let hurt2 = 0;
    for (const h of homes.list.slice()) {
      if (hurt2 >= 2 || homeBlk(h).length < 8) continue;
      for (let k = 0; k < 4; k++) { const c = pickOne(homeBlk(h)); if (c) smashOne(c); }
      hurt2++;
    }
    go(2);
    const s2hurt = got();
    const s2secs = go(700, () => homes.list.every(h => h.left <= 0));
    const s2 = { start: s2start, houses: homes.list.length, half, need0, hurt: s2hurt,
                 secs: s2secs, got: got(), need: need(), hit: hurt2 };

    /* ── ③ 蓋好的小房子被破壞：一間打到剩不到兩成五（該整間廢棄）、
           另一間只敲屋頂（該被補回來）。用 breakBlock 一塊一塊打，量才穩定——
           爆炸範圍換一間房子就是完全不同的破壞量（同「小房子打到剩兩成五」那條）。 ── */
    const before3 = homes.list.length;
    const tgt = homes.list.find(h => h.slots.length >= 40) || homes.list[0];
    let other = null, od = -1;
    for (const h of homes.list) {
      if (h === tgt) continue;
      const d = Math.hypot(h.x - tgt.x, h.z - tgt.z);
      if (d > od) { od = d; other = h; }               // 挑離得最遠的：不會被同一發帶走
    }
    const tq = homeBlk(tgt), kill = Math.ceil(tq.length - tgt.slots.length * 0.2);
    for (let i = 0; i < kill && i < tq.length; i++) breakBlock(tq[i], 0, 0, 0);
    const oq = other ? homeBlk(other).sort((a, b) => b.y - a.y) : [];
    for (let i = 0; i < 6 && i < oq.length; i++) breakBlock(oq[i], 0, 0, 0);   // 只敲屋頂
    go(3);
    const s3 = { before: before3, after: homes.list.length,
                 gone: homes.list.indexOf(tgt) < 0,
                 alive: !!other && homes.list.indexOf(other) >= 0,
                 hurt: other ? other.left : -1, roof: Math.min(6, oq.length) };
    s3.secs = go(500, () => homes.list.every(h => h.left <= 0));
    s3.left = homes.list.reduce((a, h) => a + h.left, 0);

    /* ── ④ 把地標打掉換下一座，蓋完小人又開始蓋自己的家 ── */
    const d0 = stats.destroyed;
    for (let k = 0; k < 600 && placedCnt > bp.slots.length * 0.2; k++) {
      const c = pickOne(setBlk());
      if (!c) break;
      smashOne(c);
    }
    const swap = go(60, () => stats.destroyed > d0);
    const hm0 = workers.filter(w => w.hm >= 0).length;
    const build2 = go(400, () => phase === 'done' || phase === 'wreck');
    const newHome = go(60, () => idleEv && workers.some(w => w.hm >= 0));
    const s4 = { swap, destroyed: stats.destroyed - d0, name: bp.name, build: build2,
                 placed: placedCnt, total: bp.slots.length, phase, hm0,
                 crew: workers.filter(w => w.hm >= 0).length, newHome,
                 houses: homes ? homes.list.length : 0 };

    const out = { s1, s2, s3, s4,
                  stuckWD: { worst: +worst.toFixed(1), over4, ghost, frames,
                             men: workers.length } };
    cleanTools(); clearHomes();
    return out;
  });
  ok('① 地標蓋到一半被砸，小人補得回來、照樣蓋完',
     lifeRun.s1.hurt < lifeRun.s1.built && lifeRun.s1.placed === lifeRun.s1.total &&
     lifeRun.s1.phase === 'done',
     '蓋到 ' + lifeRun.s1.built + ' → 砸剩 ' + lifeRun.s1.hurt + ' → ' + lifeRun.s1.secs +
     ' 秒後 ' + lifeRun.s1.placed + '/' + lifeRun.s1.total + '（' + lifeRun.s1.phase + '）');
  ok('② 小房子蓋到一半被砸，還是有人把每一間蓋完',
     lifeRun.s2.houses >= 2 && lifeRun.s2.hit === 2 && lifeRun.s2.hurt < lifeRun.s2.half &&
     lifeRun.s2.got === lifeRun.s2.need && lifeRun.s2.secs < 700,
     '蓋完地標 ' + lifeRun.s2.start + ' 秒後起了 ' + lifeRun.s2.houses + ' 間：蓋到 ' +
     lifeRun.s2.half + '/' + lifeRun.s2.need0 + ' 時砸 ' + lifeRun.s2.hit + ' 間 → 剩 ' +
     lifeRun.s2.hurt + ' → ' + lifeRun.s2.secs + ' 秒後 ' + lifeRun.s2.got + '/' + lifeRun.s2.need);
  ok('③ 蓋好的小房子被打爛：剩不到兩成五的整間廢棄，只破了洞的補回來',
     lifeRun.s3.gone && lifeRun.s3.after === lifeRun.s3.before - 1 &&
     lifeRun.s3.alive && lifeRun.s3.hurt > 0 && lifeRun.s3.left === 0,
     '打到剩兩成的那一間廢棄了（' + lifeRun.s3.before + ' → ' + lifeRun.s3.after +
     ' 間）；另一間敲掉 ' + lifeRun.s3.roof + ' 塊屋頂 → 缺 ' +
     lifeRun.s3.hurt + ' 格，' + lifeRun.s3.secs + ' 秒後補完（全村還缺 ' + lifeRun.s3.left + ' 格）');
  ok('④ 換下一座地標，蓋完小人又開始蓋自己的家',
     lifeRun.s4.destroyed === 1 && lifeRun.s4.placed === lifeRun.s4.total &&
     lifeRun.s4.hm0 === 0 && lifeRun.s4.crew > 0 && lifeRun.s4.newHome < 60,
     '砸完 ' + lifeRun.s4.swap + ' 秒換場（拆掉 +' + lifeRun.s4.destroyed + '），' +
     lifeRun.s4.name + ' 蓋了 ' + lifeRun.s4.build + ' 秒到 ' + lifeRun.s4.placed + '/' +
     lifeRun.s4.total + '；換場當下有家的 ' + lifeRun.s4.hm0 + ' 人 → 慶祝散場 ' +
     lifeRun.s4.newHome + ' 秒後 ' + lifeRun.s4.crew + ' 人離隊，全村 ' + lifeRun.s4.houses + ' 間');
  /* 上限是機制自己給的：撐到 STUCK_T 重找路線、撐到 2×STUCK_T（3 秒）開始穿透，
     穿出去還要走一小段才離開錨點，所以量到的最壞值會落在 3 秒多一點。
     同一份量測在 v1.107 抓到過完全解不開的（下一座地標停在 678／680，900 秒沒動）。 */
  ok('整輪下來沒有人腿在擺卻走不動超過四秒（卡住了會自己脫困）',
     lifeRun.stuckWD.over4 === 0 && lifeRun.stuckWD.worst <= 4,
     '整輪 ' + lifeRun.stuckWD.frames + ' 幀 × ' + lifeRun.stuckWD.men + ' 人：卡最久 ' +
     lifeRun.stuckWD.worst + ' 秒（超過 4 秒的 ' + lifeRun.stuckWD.over4 +
     ' 次；機制在 1.5 秒重找路線、3 秒開始穿透），脫困穿透共 ' +
     lifeRun.stuckWD.ghost + ' 人-幀');

  /* 走路狀態卻位置一樣 → 先重找路線，再直接穿過去（v1.108，使用者指定）。
     這一段是**把條件做出來**驗合約：把人釘在原地（腿照樣在擺），量他幾秒後
     重找路線、幾秒後開始穿透；旁邊擺一個站著發呆的當對照——那個不該被判成卡住。
     為什麼判準要用「一段時間沒離開錨點」而不是「這一幀沒動」：實測真的卡住的人
     多半不是站著不動，是在兩點之間來回，每一幀都走滿一步 0.34，
     位置卻在 0.32 × 0.27 的框裡跳了幾百幀。 */
  const stuckWD = await page.evaluate(() => {
    cleanTools(); clearHomes(); stopIdleEvent();
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 300; setWorkerCount(2); startBuild(true); completeNow();
    homes = null;
    const w = workers[0], q = workers[1];
    w.cheer = 1e9; q.cheer = 1e9; w.hm = -1; q.hm = -1;
    w.x = 20; w.z = 0; w.sx = 20; w.sz = 0; w.tx = -20; w.tz = 0; w.stk = 0; w.ghost = 0;
    /* 腿先擺起來：gait 是漸進的（0 → 0.66 要三幀），不先設的話量到的時間會晚個 0.15 秒 */
    w.gait = 0.85;
    q.x = 26; q.z = 0; q.gait = 0; q.stk = 0; q.ghost = 0;
    let re = -1, gh = -1, idleGhost = 0;
    for (let i = 0; i < 300; i++) {
      w.chk = 99;                                    // 被重設成 0 ＝ 重找了路線
      q.pause = 9; q.gait = 0;                       // 對照組：站著發呆（腿沒在擺）
      step(0.05);
      w.x = 20; w.z = 0;                             // 釘住：走路狀態卻位置一樣
      q.x = 26; q.z = 0;
      if (re < 0 && w.chk !== 99) re = +((i + 1) * 0.05).toFixed(2);
      if (gh < 0 && w.ghost > 0) gh = +((i + 1) * 0.05).toFixed(2);
      if (q.ghost > 0) idleGhost++;
    }
    const out = { re, gh, idleGhost, T: STUCK_T, R: STUCK_R, G: GHOST_T,
                  gait: +w.gait.toFixed(2) };
    cleanTools(); clearHomes();
    return out;
  });
  ok('腿在擺卻走不動：先重找路線，再直接穿過去（站著不動的不算）',
     /* 只能晚不能早：門檻沒到就介入才是錯的。晚幾幀是量測的解析度（一幀 0.05 秒）。 */
     stuckWD.re >= stuckWD.T && stuckWD.re <= stuckWD.T + 0.25 &&
     stuckWD.gh >= stuckWD.T * 2 && stuckWD.gh <= stuckWD.T * 2 + 0.25 &&
     stuckWD.idleGhost === 0,
     '釘住的那個（腿還在擺 ' + stuckWD.gait + '）：' + stuckWD.re + ' 秒重找路線、' +
     stuckWD.gh + ' 秒開始穿透（門檻 ' + stuckWD.T + ' 秒 / 錨點 ' + stuckWD.R +
     ' 格，穿 ' + stuckWD.G + ' 秒）；旁邊站著發呆的那個穿透 ' + stuckWD.idleGhost + ' 幀');

  /* 穿透中，房子真的擋不住他。對照組是同一段路不穿透——他繞過去，
     路程變長、而且一幀都沒踩進外框。 */
  const ghostThru = await page.evaluate(() => {
    const run = on => {
      cleanTools(); clearHomes(); stopIdleEvent();
      shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
      targetCnt = 300; setWorkerCount(1); startBuild(true); completeNow();
      const w = workers[0];
      w.cheer = 1e9; w.hm = -1;
      // 一整塊外框橫在路中間（造型不重要，走路只看外框，見 footHome）
      homes = { list: [{ x: 0, z: 25, r: 7, x0: -6, x1: 6, z0: 18, z1: 32,
                         slots: [], left: 0, done: false, at: new Map() }] };
      w.x = 0; w.z = 40; w.y = 0; w.sx = 0; w.sz = 40; w.stk = 0; w.ghost = 0;
      let inBox = 0, arrive = -1, walked = 0, last = { x: w.x, z: w.z };
      for (let i = 0; i < 400; i++) {
        w.tx = 0; w.tz = 10; w.pause = 0;
        if (on) w.ghost = 9;                         // 強制穿透中
        step(0.05);
        w.ghost = on ? 9 : 0;                        // 對照組：不准穿透
        walked += Math.hypot(w.x - last.x, w.z - last.z); last = { x: w.x, z: w.z };
        if (footHome(w.x, w.z)) inBox++;
        if (arrive < 0 && Math.hypot(w.x, w.z - 10) < 1.2) arrive = +((i + 1) * 0.05).toFixed(1);
      }
      homes = null; cleanTools(); clearHomes();
      return { inBox, arrive, walked: +walked.toFixed(1) };
    };
    return { on: run(true), off: run(false), straight: 30 };
  });
  ok('穿透中房子擋不住他（直線走過去，不繞）',
     ghostThru.on.inBox > 0 && ghostThru.off.inBox === 0 &&
     ghostThru.on.arrive > 0 && ghostThru.on.arrive < ghostThru.off.arrive &&
     ghostThru.on.walked < ghostThru.off.walked,
     '同一段路（直線 ' + ghostThru.straight + ' 格）：穿透 → 踩進外框 ' + ghostThru.on.inBox +
     ' 幀、走了 ' + ghostThru.on.walked + ' 格、' + ghostThru.on.arrive + ' 秒到；' +
     '不穿透 → 踩進外框 ' + ghostThru.off.inBox + ' 幀、繞了 ' + ghostThru.off.walked +
     ' 格、' + ghostThru.off.arrive + ' 秒到');

  /* 搆不到的積木，走到最近能到的距離就伸手拿（v1.108，使用者指定）。
     造一個**真的走不到**的站位：A 屋外框裡躺著一塊料，grabStand 會挑 A 最近的
     那一面（下緣）往外 1.4 格，而 B 屋的外框剛好壓在那個站位上，
     而且壓得比「走到多近算抵達」（REACH 0.9）還深——所以他永遠抵達不了。
     三組對照：
       full  ＝ v1.108（伸手拿 + 卡住脫困）
       ghost ＝ 只留卡住脫困（穿牆走進去撿，慢很多）
       none  ＝ v1.107（兩個都沒有）——那個人一直卡在 pick 上，那塊料永遠回收不了 */
  const farGrab = await page.evaluate(() => {
    const box = (x0, x1, z0, z1) => ({ x: (x0 + x1) / 2, z: (z0 + z1) / 2,
      r: Math.max(x1 - x0, z1 - z0) / 2, x0, x1, z0, z1,
      slots: [], left: 0, done: false, at: new Map() });
    const run = mode => {                                    // 2＝v1.108、1＝只有脫困、0＝v1.107
      cleanTools(); clearHomes(); stopIdleEvent();
      shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
      targetCnt = 300; setWorkerCount(1); startBuild(true);   // 施工中：走 pick 那條狀態機
      const w = workers[0];
      w.hm = -1; w.st = 'idle'; w.load.length = 0; w.li = 0;
      homes = { list: [box(-5, 5, 20, 30), box(-5, 5, 13, 19.6)] };
      // 場上只留一塊撿得到的碎料，就擺在 A 屋外框裡
      const bi = 0;
      for (let i = 1; i < blocks.length; i++) { blocks[i].rest = false; blocks[i].holder = -1; }
      const b = blocks[bi];
      if (b.cell) gridDel(b);
      b.st = 0; b.rest = true; b.holder = -1; b.slot = -1; b.hh = -1; b.arc = null; b.snap = 0;
      b.x = 0; b.z = 21; b.y = HB; b.vx = b.vy = b.vz = 0;
      gridAdd(b);
      const g = pickSpot(b);
      const stand = { x: +g.x.toFixed(2), z: +g.z.toFixed(2), inB: !!footHome(g.x, g.z) };
      const orig = nearGrab;
      if (mode < 2) nearGrab = () => false;
      w.x = 0; w.z = 5; w.y = 0; w.sx = 0; w.sz = 5; w.stk = 0; w.ghost = 0;
      let got = -1, near = 99, gh = 0;
      for (let i = 0; i < 1200; i++) {
        // none 那一組要把計時也歸零，不然穿透一結束就又立刻重新觸發
        if (mode < 1) { w.stk = 0; w.ghost = 0; }
        step(0.05);
        if (mode < 1) { w.stk = 0; w.ghost = 0; } else if (w.ghost > 0) gh++;
        if (blocks[bi].st !== 0) { got = +((i + 1) * 0.05).toFixed(1); break; }
        near = Math.min(near, Math.hypot(blocks[bi].x - w.x, blocks[bi].z - w.z));
      }
      nearGrab = orig;
      homes = null; cleanTools(); clearHomes();
      return { got, near: +near.toFixed(2), stand, ghost: gh,
               far: GRAB_FAR, wait: GRAB_WAIT, R: REACH };
    };
    return { on: run(2), ghost: run(1), off: run(0) };
  });
  ok('搆不到的積木，走到最近能到的距離就伸手拿',
     farGrab.on.stand.inB && farGrab.on.got > 0 && farGrab.on.got < 20 &&
     farGrab.on.near > farGrab.on.R && farGrab.on.near <= farGrab.on.far &&
     farGrab.off.got < 0 && farGrab.ghost.got > farGrab.on.got,
     '站位 (' + farGrab.on.stand.x + ', ' + farGrab.on.stand.z + ') 壓在另一間的外框裡，' +
     '最近只走得到離那塊料 ' + farGrab.on.near + ' 格（伸手範圍 ' + farGrab.on.far +
     '、等 ' + farGrab.on.wait + ' 秒）：伸手拿 ' + farGrab.on.got +
     ' 秒撿起來（用掉穿透 ' + farGrab.on.ghost + ' 幀）；只靠卡住脫困穿牆進去 ' +
     farGrab.ghost.got + ' 秒（穿透 ' + farGrab.ghost.ghost +
     ' 幀）；兩個都沒有（v1.107）→ 60 秒撿到的是 ' + farGrab.off.got + '（−1＝沒撿到）');

  /* ══════════ 完工之後把多餘的碎料收掉（v1.109） ══════════
     使用者：「地標建築完工後 可以讓多餘的碎料消失」。多出來的幾乎都是小人的家
     帶進場的（家的積木是從地上挖出來的新塊，那一間被廢棄／被下一座工地徵收之後
     就解成碎料留著），所以這一段擺在房子這一章。
     這裡人為補 300 塊碎料當「上一輪留下的」，再讓小人自己把地標蓋完。 */
  const spareGone = await page.evaluate(() => {
    const run = on => {
      cleanTools(); clearHomes(); stopIdleEvent();
      shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
      targetCnt = 400; setWorkerCount(20); startBuild(true);
      /* 先把建材補齊（v1.141）：料池少了不補之後，這裡的池子可能比藍圖還少
         （上一條測試留下什麼就是什麼），那下面補的 300 塊會被當成建材蓋掉，
         完工時剩不到「多餘的」可以驗（實測只剩 122 塊）。 */
      scatterFree();
      for (let i = 0; i < 300; i++) {                    // 補一批「多餘的」碎料
        const b = newBlock();
        const a = Math.random() * Math.PI * 2;
        const rad = siteR + 3 + Math.random() * (arenaR - siteR - 3);
        b.x = Math.cos(a) * rad; b.z = Math.sin(a) * rad; b.y = HB;
        blocks.push(b); separate(b); gridAdd(b);
      }
      ENG.setBlockCount(blocks.length);
      const orig = clearSpare;
      if (!on) clearSpare = () => 0;                     // 對照＝v1.108（留在場上）
      const free = () => blocks.filter(b => b.st === 0 && b.rest && b.holder < 0 && b.hh < 0).length;
      const pool0 = blocks.length, slots = bp.slots.length;
      let lastFree = free(), t = 0;
      while (t < 600 && phase === 'build') { lastFree = free(); step(0.05); t += 0.05; }
      // 完工那一刻：該是「淡出中」而不是瞬間消失
      const fading = blocks.filter(b => b.gone > 0).length;
      let fadeSecs = 0;
      while (fadeSecs < 5 && blocks.some(b => b.gone > 0)) { step(0.05); fadeSecs += 0.05; }
      clearSpare = orig;
      const out = { slots, pool0, atDone: lastFree, fading, fadeSecs: +fadeSecs.toFixed(2),
                    pool1: blocks.length, free1: free(), placed: placedCnt,
                    /* 完工那一刻還在人手上／半空中的那幾塊不是「多餘的」，會留著 */
                    inHand: blocks.filter(b => b.st !== 3).length,
                    set: blocks.filter(b => b.st === 3).length,
                    nan: blocks.filter(b => !isFinite(b.x) || !isFinite(b.z)).length,
                    badLoad: workers.reduce((n, w) => n + w.load.filter(j => !blocks[j.b]).length, 0) };
      cleanTools(); clearHomes();
      return out;
    };
    return { on: run(true), off: run(false) };
  });
  ok('地標完工之後，多餘的碎料會淡出消失',
     spareGone.on.atDone > 200 && spareGone.on.fading === spareGone.on.atDone &&
     spareGone.on.fadeSecs > 0.4 && spareGone.on.fadeSecs < 3 &&
     spareGone.on.free1 === 0 && spareGone.on.set === spareGone.on.slots &&
     spareGone.on.placed === spareGone.on.slots &&
     spareGone.on.pool1 === spareGone.on.slots + spareGone.on.inHand &&
     spareGone.on.nan === 0 && spareGone.on.badLoad === 0 &&
     spareGone.off.free1 === spareGone.off.atDone && spareGone.off.pool1 === spareGone.off.pool0,
     '補 300 塊多餘的料（池 ' + spareGone.on.pool0 + '、藍圖 ' + spareGone.on.slots +
     '）：完工那一刻地上還有 ' + spareGone.on.atDone + ' 塊 → 淡出 ' + spareGone.on.fading +
     ' 塊、' + spareGone.on.fadeSecs + ' 秒收乾淨 → 池剩 ' + spareGone.on.pool1 +
     '（已就位 ' + spareGone.on.set + ' ＋ 還在手上的 ' + spareGone.on.inHand +
     '）；不收（v1.108）→ 地上留著 ' + spareGone.off.free1 + ' 塊、池 ' + spareGone.off.pool1);

  /* 收掉的只能是「沒人要的」：房子的積木、手上搬著的、魔法師還在飛的都不算。
     這一條同時驗**編號重編**——dropBlocks 會把積木從池子裡整個抽掉，
     w.load／w.fly／quake.list 記的是編號，抽掉之後不重編就會指到別塊積木身上。 */
  const spareKeepOK = await page.evaluate(() => {
    cleanTools(); clearHomes(); stopIdleEvent();
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 400; setWorkerCount(6); startBuild(true);
    // 一間假房子（外框成立就夠，這裡只在乎它的積木不會被收掉）
    homes = { list: [] };
    const kind = HOME_KIND[0];
    const at = { x: 0, z: siteR + 6 + homeR(kind) };
    const slots = homeSlots(at.x, at.z, kind, HOME_PAL[0]);
    const map = new Map();
    slots.forEach((sl, i) => map.set(sl.i + ':' + sl.gy + ':' + sl.k, i));
    const h = { id: 9001, x: at.x, z: at.z, r: homeR(kind), kind: kind.id, at: map,
                ox: (kind.w - 1) / 2, oz: (kind.d - 1) / 2,
                slots, left: slots.length, n: 1, done: true };
    markHomeF6(h); homes.list.push(h);
    for (let i = 0; i < slots.length; i++) {
      const sl = slots[i], b = newBlock();
      b.x = sl.x; b.y = sl.y; b.z = sl.z; b.st = 3; b.rest = true;
      b.hh = 0; b.hk = i;
      blocks.push(b); sl.filled = true; h.left--;
    }
    homeBox(h);
    // 再補 200 塊真的多餘的
    for (let i = 0; i < 200; i++) {
      const b = newBlock();
      const a = Math.random() * Math.PI * 2;
      const rad = siteR + 3 + Math.random() * (arenaR - siteR - 3);
      b.x = Math.cos(a) * rad; b.z = Math.sin(a) * rad; b.y = HB;
      blocks.push(b); separate(b); gridAdd(b);
    }
    ENG.setBlockCount(blocks.length);
    const homeN = slots.length;
    // 一個人手上抓著一塊、一塊掛在魔法師的飛行清單上、一份地震點名清單
    const w = workers.find(q => !q.eng && !q.mage) || workers[0];
    const carry = blocks.findIndex(b => b.st === 0 && b.rest && b.hh < 0);
    blocks[carry].st = 1; blocks[carry].rest = false; blocks[carry].holder = workers.indexOf(w);
    w.load.push({ b: carry, s: 0 }); bp.slots[0].claimed = workers.indexOf(w);
    const flyI = blocks.findIndex((b, i) => i !== carry && b.st === 0 && b.rest && b.hh < 0);
    {
      const fb = blocks[flyI];
      if (fb.cell) gridDel(fb);
      fb.st = 2; fb.rest = false; fb.slot = -1;
      // 飛很久的一段弧：這一條測的是「編號重編」，不要讓它在中途落地
      fb.arc = { t: 0, dur: 99, x0: fb.x, y0: fb.y, z0: fb.z,
                 x1: fb.x, y1: fb.y + 2, z1: fb.z, peak: fb.y + 4 };
    }
    const mg = workers.find(q => q.mage) || workers[0];
    mg.fly.push({ b: flyI, s: -1 });
    const setI = [];
    for (let i = 0; i < blocks.length && setI.length < 5; i++) if (blocks[i].hh >= 0) setI.push(i);
    quake = { t: 9, next: 9, list: setI.slice(), cur: 0, x: 0, z: 0 };
    const carryB = blocks[carry], flyB = blocks[flyI];
    const quakeB = setI.map(i => blocks[i]);
    /* 這兩個人整段躺著（fall），狀態機才不會把手上那塊丟掉——
       這一條要驗的是「編號重編」，不是他們會不會把工作做完。 */
    w.fall = 99; mg.fall = 99;
    const pool0 = blocks.length;
    /* 條件要跟 clearSpare 一模一樣，**b.gone 那一項不能少**（v1.158.2）：
       那一支跳過「已經在淡出的」（game.js 的 `|| b.gone`），這裡漏掉的話，
       前一段留下還在淡出的碎料會被算進 expect，gone === expect 就隨機紅。 */
    const expect = blocks.filter(b => b.st === 0 && b.rest && b.holder < 0 &&
                                      b.hh < 0 && !b.gone).length;
    const gone = clearSpare();
    let t = 0;
    while (t < 5 && blocks.some(b => b.gone > 0)) { step(0.05); t += 0.05; }
    const out = {
      pool0, gone, expect, pool1: blocks.length,
      homeLeft: blocks.filter(b => b.hh >= 0 && b.st === 3).length, homeN,
      carryOK: blocks[w.load[0] ? w.load[0].b : -1] === carryB,
      flyOK: !!mg.fly.length && blocks[mg.fly[0].b] === flyB,
      quakeOK: quake ? quake.list.every((v, i) => blocks[v] === quakeB[i]) : false,
      quakeN: quake ? quake.list.length : -1
    };
    quake = null;
    cleanTools(); clearHomes();
    return out;
  });
  ok('只收沒人要的：房子的、手上搬的、還在飛的都留著（編號也跟著重編）',
     spareKeepOK.gone > 100 && spareKeepOK.gone === spareKeepOK.expect &&
     spareKeepOK.pool1 === spareKeepOK.pool0 - spareKeepOK.gone &&
     spareKeepOK.homeLeft === spareKeepOK.homeN &&
     spareKeepOK.carryOK && spareKeepOK.flyOK && spareKeepOK.quakeOK,
     '池 ' + spareKeepOK.pool0 + ' → ' + spareKeepOK.pool1 + '（收掉 ' + spareKeepOK.gone +
     '）：房子的 ' + spareKeepOK.homeLeft + '/' + spareKeepOK.homeN +
     ' 塊都在；重編後手上那塊還對得上：' + spareKeepOK.carryOK +
     '、飛行中那塊：' + spareKeepOK.flyOK +
     '、地震點名的 ' + spareKeepOK.quakeN + ' 塊：' + spareKeepOK.quakeOK);

  /* 已經有房子的小人不會再蓋一間（v1.109，使用者：「不然會越來越多間」）。
     連跑幾輪事件：每一輪離隊的人裡，有家的只會回去補**自己那一間**，
     不會被算進「開新房子」的名額；沒家的才抽籤離隊。 */
  const ownHome = await page.evaluate(() => {
    cleanTools(); clearHomes(); stopIdleEvent();
    const ev = stepIdleEvent;
    stepIdleEvent = () => {};                // 這一段自己控制輪次，別讓事件自己又開一輪
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 500; setWorkerCount(20); startBuild(true); completeNow();
    homes = { list: [] };
    const rows = [];
    for (let r = 0; r < 4; r++) {
      /* 家在上一輪被打爛廢棄的人，這一輪本來就算「沒家」——他可以再蓋一間。
         所以「本來就有家」要對照**還活著的那幾間**，不是只看 w.own 有沒有值。 */
      const liveId = new Set(homes.list.map(h => h.id));
      const own0 = workers.map(w => (w.own >= 0 && liveId.has(w.own) ? w.own : -1));
      const homeless = own0.filter(o => o < 0).length;
      /* **只算房子**（v1.153 起同一份 homes.list 裡也有樹，這是 v1.154 補的）：這一條驗的
         是「有家的不會再蓋一間新家」，而樹不是家——種樹的人 w.hm 一樣 >= 0，混進來的話
         crew 會多算幾個（`owners > rows[0].crew` 那個邊界就會掛），「被派去別人家」
         也會把「去種樹」誤判成一次。實測就是這樣紅的。 */
      const houses0 = new Set(homes.list.filter(h => !h.tree).map(h => h.id));
      const n0 = houses0.size;
      startHomes();
      const crew = workers.filter(w => w.hm >= 0 && !homes.list[w.hm].tree);
      /* 兩個判準都只看「本來就有家的那幾個」：
         stray ＝ 被派去別人家；fresh ＝ 被派去這一輪新開的房子。
         v1.108 的抽籤是不看有沒有家的，這兩個數字都會是一大票。 */
      let stray = 0, fresh = 0;
      for (const w of crew) {
        const o = own0[workers.indexOf(w)];
        if (o < 0) continue;
        const h = homes.list[w.hm];
        if (h.id !== o) stray++;
        if (!houses0.has(h.id)) fresh++;
      }
      const n1 = homes.list.filter(h => !h.tree).length;
      rows.push({ n0, n1, add: n1 - n0,
                  crew: crew.length, homeless, hadHome: crew.length - crew.filter(
                    w => own0[workers.indexOf(w)] < 0).length,
                  stray, fresh, owners: workers.filter(w => w.own >= 0).length });
      let t = 0;
      while (t < 600 && homes.list.some(h => h.left > 0)) { step(0.05); t += 0.05; }
      const hb = blocks.filter(b => b.st === 3 && b.hh >= 0);
      for (let i = 0; i < Math.floor(hb.length * 0.1); i++) breakBlock(hb[i], 0, 0, 0);
      for (let i = 0; i < 60; i++) step(0.05);
      stopHomes();
    }
    stepIdleEvent = ev;
    const out = { rows, houses: homes.list.filter(h => !h.tree).length,
                  trees: homes.list.filter(h => h.tree).length,
                  owners: workers.filter(w => w.own >= 0).length, men: workers.length };
    cleanTools(); clearHomes();
    return out;
  });
  ok('已經有房子的小人不會再蓋一間（只回去補自己那一間）',
     ownHome.rows.every(r => r.stray === 0 && r.fresh === 0) &&
     ownHome.rows.every(r => r.add <= r.homeless) &&
     ownHome.rows[0].add > 0 && ownHome.rows[3].add < ownHome.rows[0].add &&
     ownHome.rows[3].hadHome > 0 && ownHome.owners > ownHome.rows[0].crew,
     '四輪的間數 ' + ownHome.rows.map(r => r.n0 + '→' + r.n1).join('、') +
     '（每輪還沒有家的 ' + ownHome.rows.map(r => r.homeless).join('、') + ' 人）；' +
     '本來就有家又被派工的共 ' + ownHome.rows.reduce((a, r) => a + r.hadHome, 0) +
     ' 人次，其中被派去別人家 ' + ownHome.rows.reduce((a, r) => a + r.stray, 0) +
     ' 人次、被派去新開的房子 ' + ownHome.rows.reduce((a, r) => a + r.fresh, 0) +
     ' 人次；最後 ' + ownHome.men + ' 人裡 ' + ownHome.owners + ' 人有家、村子 ' +
     ownHome.houses + ' 間（另有 ' + ownHome.trees + ' 棵樹，不算家）');

  /* 家沒了就重新算成沒家：打爛到廢棄（剩不到兩成五）之後，原主人可以再蓋一間。 */
  const ownAgain = await page.evaluate(() => {
    cleanTools(); clearHomes(); stopIdleEvent();
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 500; setWorkerCount(12); startBuild(true); completeNow();
    homes = { list: [] };
    startHomes();
    let t = 0;
    while (t < 600 && homes.list.some(h => h.left > 0)) { step(0.05); t += 0.05; }
    stopHomes();
    const tgt = homes.list[0];
    const owners = workers.filter(w => w.own === tgt.id).length;
    // 打到剩兩成 → 整間廢棄
    const q = blocks.filter(b => b.st === 3 && b.hh === 0);
    const kill = Math.ceil(q.length - tgt.slots.length * 0.2);
    for (let i = 0; i < kill && i < q.length; i++) breakBlock(q[i], 0, 0, 0);
    for (let i = 0; i < 80; i++) step(0.05);
    const gone = homes.list.indexOf(tgt) < 0;
    /* 其餘的房子先撤掉、積木還原成一般碎料（v1.128.1 修間歇性失敗）。
       這一條要驗的是「家沒了就重新算成沒家（`w.own` 被清成 −1），原主人可以再蓋一間」，
       但 startHomes 還有另一道跟這件事無關的關卡：`pickHomeSite` 找不到空地時
       那一組就照常閒晃（程式註解自己寫著）。村子已經八間的時候常常就是這樣——
       實測整輪跑開出過「8 → 8 間、0 人離隊」，那不是這條規則壞了，是沒地方蓋。
       **不動 `w.own`**：那正是這一條要看的東西（startHomes 會把不在清單上的 id 清掉）。 */
    for (const b of blocks) {
      if (b.hh < 0) continue;
      b.hh = -1; b.hk = -1; b.slot = -1; b.holder = -1;
      b.st = 0; b.rest = true; b.arc = null; b.snap = 0;
      b.vx = b.vy = b.vz = 0;
      if (!b.cell) gridAdd(b);
    }
    homes.list.length = 0;
    for (const w of workers) { w.hm = -1; w.hst = ''; }
    const n0 = homes.list.length;
    startHomes();
    const freed = workers.filter(w => w.own !== tgt.id).length;
    const back = workers.filter(w => w.hm >= 0).length;
    const out = { owners, gone, n0, n1: homes.list.length, freed, back, men: workers.length,
                  stillTagged: workers.filter(w => w.own === tgt.id).length };
    cleanTools(); clearHomes();
    return out;
  });
  ok('家被打爛廢棄之後，原主人可以再蓋一間',
     ownAgain.owners > 0 && ownAgain.gone && ownAgain.stillTagged === 0 &&
     ownAgain.n1 > ownAgain.n0 && ownAgain.back > 0,
     '那一間本來有 ' + ownAgain.owners + ' 個主人：打到剩兩成 → 整間廢棄（' +
     ownAgain.gone + '），標記歸零的還剩 ' + ownAgain.stillTagged +
     ' 人；下一輪村子 ' + ownAgain.n0 + ' → ' + ownAgain.n1 + ' 間、' +
     ownAgain.back + ' 人離隊');

  /* 按「立刻建成」不會把整村變成碎料（v1.109 修掉的舊坑）。
     completeNow 以前是照編號硬取 blocks[0..格數) 當建材、編號更後面的一律壓成散料——
     場上有村落的時候按下去，整村的積木全躺平，而 homes.list 還記著「都蓋好了」。 */
  const instaVillage = await page.evaluate(() => {
    cleanTools(); clearHomes(); stopIdleEvent();
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 500; setWorkerCount(12); startBuild(true); completeNow();
    homes = { list: [] };
    startHomes();
    let t = 0;
    while (t < 600 && homes.list.some(h => h.left > 0)) { step(0.05); t += 0.05; }
    stopHomes();
    const before = { houses: homes.list.length,
                     set: blocks.filter(b => b.hh >= 0 && b.st === 3).length,
                     left: homes.list.reduce((a, h) => a + h.left, 0) };
    // 換一座、再按立刻建成
    startBuild(false);
    completeNow();
    for (let i = 0; i < 60; i++) step(0.05);
    const after = { houses: homes.list.length,
                    set: blocks.filter(b => b.hh >= 0 && b.st === 3).length,
                    loose: blocks.filter(b => b.hh >= 0 && b.st !== 3).length,
                    dual: blocks.filter(b => b.hh >= 0 && b.slot >= 0).length,
                    placed: placedCnt, slots: bp.slots.length };
    cleanTools(); clearHomes();
    return { before, after };
  });
  ok('按下「立刻建成」不會把整村的積木變成碎料',
     instaVillage.before.set > 0 && instaVillage.after.set === instaVillage.before.set &&
     instaVillage.after.loose === 0 && instaVillage.after.dual === 0 &&
     instaVillage.after.placed === instaVillage.after.slots,
     '村子 ' + instaVillage.before.houses + ' 間 / ' + instaVillage.before.set +
     ' 塊：按下去之後還站著 ' + instaVillage.after.set + ' 塊（散掉 ' +
     instaVillage.after.loose + ' 塊、同時被當成地標建材的 ' + instaVillage.after.dual +
     ' 塊），地標 ' + instaVillage.after.placed + '/' + instaVillage.after.slots);

  /* ── 樹（v1.153）──────────────────────────────────────────
     外型掃過 TREE_KIND 每一款，不是只看這一輪剛好種出來的那幾棵（同房子那條的理由：
     不然覆蓋率要靠運氣）。每一款都要成立四件事：
       ① 塊數在 31～220（有大有小，一個人蓋的那三款要小到一輪蓋得完）
       ② 每一格都六面連得回地面——這是 markHomeF6 的基準線，連不到的葉子完好時
          f6 就是 false，之後永遠不會被垮塌判定收掉，會一直吊在半空
       ③ 照 canPlaceHome 那把尺**砌得完**（沒有「這一格永遠放不上去」的死結）
       ④ 樹幹站在地面上、而且不從樹冠頂上冒出來（冒出來看起來是根電線桿）
     另外整張表要三種樹冠都有，果樹要真的掛得出果子。 */
  const treeShape = await page.evaluate(() => {
    const N26 = NBR, N6 = NBR6;
    return TREE_KIND.map(k => {
      const sl = treeSlots(0, 0, k, TREE_PAL[0]);
      const at = new Map();
      sl.forEach((s, i) => at.set(s.i + ':' + s.gy + ':' + s.k, i));
      const nb = (s, d) => at.get((s.i + d[0]) + ':' + (s.gy + d[1]) + ':' + (s.k + d[2]));
      // ② 六面連通
      const seen = new Set(), st = [];
      sl.forEach((s, i) => { if (s.gy === 0) { seen.add(i); st.push(i); } });
      while (st.length) {
        const s = sl[st.pop()];
        for (const d of N6) {
          const j = nb(s, d);
          if (j === undefined || seen.has(j)) continue;
          seen.add(j); st.push(j);
        }
      }
      // ③ 照「第一個放得上去的」一直挑，看填不填得滿
      const fill = new Array(sl.length).fill(false);
      let laid = 0;
      for (;;) {
        let pick = -1;
        for (let i = 0; i < sl.length && pick < 0; i++) {
          if (fill[i]) continue;
          if (sl[i].gy === 0) { pick = i; break; }
          for (const d of N26) { const j = nb(sl[i], d); if (j !== undefined && fill[j]) { pick = i; break; } }
        }
        if (pick < 0) break;
        fill[pick] = true; laid++;
      }
      // ④ 樹幹：顏色等於 pal[0] 的那些
      const trunk = sl.filter(s => s.c === TREE_PAL[0][0]);
      const top = Math.max(...sl.map(s => s.gy));
      const leafAbove = trunk.length ? sl.some(s => s.c !== TREE_PAL[0][0] &&
                        s.gy > Math.max(...trunk.map(q => q.gy))) : false;
      // 連號兩格跳多遠（小人是照順序認格子的，跳來跳去就是在走路）
      let jump = 0;
      for (let i = 1; i < sl.length; i++)
        jump += Math.hypot(sl[i].x - sl[i - 1].x, sl[i].y - sl[i - 1].y, sl[i].z - sl[i - 1].z);
      return { id: k.id, form: k.form, n: k.n, total: sl.length, f6: seen.size, laid,
               trunk: trunk.length, ground: trunk.filter(s => s.gy === 0).length,
               leafAbove, top: top + 1,
               fruit: sl.filter(s => s.c === TREE_PAL[0][3]).length,
               jump: +(jump / sl.length).toFixed(2) };
    });
  });
  ok('每一款樹都連得回地面、砌得完，樹幹不從樹冠頂上冒出來',
     treeShape.every(t => t.total >= 31 && t.total <= 220 && t.f6 === t.total &&
                          t.laid === t.total && t.ground > 0 && t.leafAbove &&
                          t.jump < 2.6) &&
     new Set(treeShape.map(t => t.form)).size === 3 &&
     treeShape.filter(t => t.fruit > 0).length === 1,
     treeShape.map(t => t.id + ' ' + t.n + ' 人 ' + t.total + ' 塊／' + t.top + ' 層高（' +
       t.form + '；六面連通 ' + t.f6 + '、砌得完 ' + t.laid + '、樹幹 ' + t.trunk +
       (t.fruit ? '、果子 ' + t.fruit : '') + '、連號跳 ' + t.jump + '）').join('；'));
  /* 樹冠走得過去、樹幹擋路（v1.153）。走路的擋路判定看的是外框（見 footHome），
     整棵去框的話一棵大樹就是一片 10×10 的隱形牆，小人繞著空氣走——所以外框只框
     TREE_DUCK 層以下（小人帽頂最高 2.63 格，第 3 層的積木底面在 3.00）。
     房子不受影響：那邊本來就是整棟擋，這條也一起驗。 */
  const treeBox = await page.evaluate(() => {
    const box = h => { homeBox(h); return +((h.x1 - h.x0) * (h.z1 - h.z0)).toFixed(0); };
    const out = TREE_KIND.map(k => {
      const slots = treeSlots(0, 0, k, TREE_PAL[0]);
      for (const s of slots) s.filled = true;
      let wide = 0;
      for (const s of slots) wide = Math.max(wide, Math.abs(s.x) * 2 + 1, Math.abs(s.z) * 2 + 1);
      return { id: k.id, th: k.th, trunk: k.tw * k.tw,
               box: box({ x: 0, z: 0, tree: 1, slots, left: 0, done: true }),
               all: +(wide * wide).toFixed(0) };
    });
    // 房子照舊整棟擋（拿最小的那款比就夠）
    const hk = HOME_KIND[0], hs = homeSlots(0, 0, hk, HOME_PAL[0]);
    for (const s of hs) s.filled = true;
    return { out, duck: TREE_DUCK,
             house: box({ x: 0, z: 0, slots: hs, left: 0, done: true }),
             houseAll: hk.w * hk.d };
  });
  ok('樹冠走得過去，擋路的只有樹幹（房子照舊整棟擋）',
     /* 樹幹露 3 層以上的（帽頂 2.63 格搆不到第 3 層）：外框剛好就是樹幹那幾格。
        灌木與松樹的樹冠壓在頭頂高度以下，那就該照樹冠擋——不能一律「只擋樹幹」，
        不然人會從樹叢中間穿過去。 */
     treeBox.out.every(t => t.th >= 3 ? t.box === t.trunk : t.box > t.trunk) &&
     treeBox.out.some(t => t.all >= t.box * 20) &&
     treeBox.house >= treeBox.houseAll,
     '擋路外框／整棵：' +
     treeBox.out.map(t => t.id + ' ' + t.box + '／' + t.all).join('、') +
     '（樹幹露 ' + treeBox.duck + ' 層以上才擋）；小屋 ' + treeBox.house +
     '（平面 ' + treeBox.houseAll + '）');
  /* 棵數的上限（v1.153）：房子靠「一人一間」擋住無限增生，樹沒有那條——所以用塊數擋。
     連跑十輪事件（每輪都把人放回閒晃），樹的總塊數不該超過 TREE_BUDGET，
     而且要真的**停下來**（後幾輪不再開新的），不是一路長下去。
     順便驗兩件事：種樹的人不算「有家」（w.own 沒被設，不然他從此不再蓋房子，
     村子就不長了），以及每一輪都真的有人去種。 */
  const treeCap = await page.evaluate(() => {
    cleanTools();
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 600; setWorkerCount(20); startBuild(true); completeNow();
    let t = 0;
    while (t < 12) { step(0.05); t += 0.05; }
    stopIdleEvent(); clearHomes(); evArm = 0;
    /* 十輪要驗的是「開新的那條規則」，不是「蓋得完」（那另有測試）。真的蓋滿十輪
       要一小時的模擬，所以每輪走 10 秒讓大家散開站定，再把場上的**當成蓋好了**
       （slots 全部 filled、left 歸零）——沒蓋完的話 pickUnfinished 會一直把同一批
       半成品發下去，永遠開不了新的，量到的就不是上限而是「蓋得慢」。 */
    const rounds = [];
    let ownTree = 0;
    for (let r = 0; r < 10; r++) {
      idleEv = IDLE_EVENTS[0]; startHomes();
      // 種樹的人身上不該多出「這是我家」的記號
      for (const w of workers)
        if (w.hm >= 0 && homes.list[w.hm].tree && w.own === homes.list[w.hm].id) ownTree++;
      const tr = homes.list.filter(h => h.tree);
      rounds.push({ trees: tr.length, slots: tr.reduce((a, h) => a + h.slots.length, 0),
                    houses: homes.list.length - tr.length,
                    crew: workers.filter(w => w.hm >= 0 && homes.list[w.hm].tree).length });
      for (let i = 0; i < 200; i++) step(0.05);         // 10 秒：走開、站定
      for (const h of homes.list) {
        for (const s of h.slots) { s.filled = true; s.claimed = -1; }
        h.left = 0; h.done = true;
      }
      stopIdleEvent();
    }
    const last = rounds[rounds.length - 1];
    /* 預算那條規則要單獨驗：十輪跑下來真正先卡住的是**空地**（那一圈擺不下更多了，
       見 pickHomeSite），塊數還離上限很遠。所以把村子清空重來，只塞一筆「已經把預算
       吃光」的假樹（擺在一萬格外，不占位置）——這一輪房子照舊該蓋，樹一棵都不該多。 */
    clearHomes();
    for (const w of workers) w.own = -1;            // 清空之後每個人都算「還沒有家」
    homes = { list: [{ id: homeSeq++, x: 1e4, z: 1e4, r: 1, kind: '假樹', at: new Map(),
                       ox: 0, oz: 0, n: 1, tree: 1, done: true, left: 0,
                       x0: 1e4, x1: 1e4, z0: 1e4, z1: 1e4,
                       slots: Array.from({ length: TREE_BUDGET }, () =>
                         ({ x: 1e4, y: 0.47, z: 1e4, i: 0, k: 0,
                            gy: 0, filled: true, claimed: -1 })) }] };
    for (let i = 0; i < 40; i++) step(0.05);        // 站定（clearHomes 把大家的工作清掉了）
    idleEv = IDLE_EVENTS[0]; startHomes();
    const spent = { trees: homes.list.filter(h => h.tree).length - 1,
                    houses: homes.list.filter(h => !h.tree).length };
    stopIdleEvent();
    const out = { rounds, ownTree, budget: TREE_BUDGET, last, spent,
                  houses: last.houses,
                  grew: rounds.filter((q, i) => i && q.trees > rounds[i - 1].trees).length };
    cleanTools(); clearHomes();
    return out;
  });
  /* 「十輪之後最多 20 棵」是**退化偵測**，不是規格（同〈散得開〉那條 spread 的訂法）：
     實測十輪停在 9 棵 643 塊，一路長下去的話十輪早就三十棵了。 */
  ok('樹不會一輪一輪長下去，塊數也不超過上限；種樹的人不算「有家」',
     treeCap.last.slots <= treeCap.budget && treeCap.last.trees <= 20 &&
     treeCap.grew >= 1 && treeCap.ownTree === 0 &&
     treeCap.rounds[0].crew > 0 && treeCap.houses > 0 &&
     treeCap.spent.trees === 0 && treeCap.spent.houses > 0,
     '十輪的棵數 ' + treeCap.rounds.map(q => q.trees).join('→') + '，塊數 ' +
     treeCap.rounds.map(q => q.slots).join('→') + '（上限 ' + treeCap.budget +
     '，先卡住的其實是空地）；有長的輪次 ' + treeCap.grew +
     '／9，種樹被記成自己家的 ' + treeCap.ownTree + ' 人次，最後 ' +
     treeCap.houses + ' 間房子；把預算吃光再開一輪 → 多了 ' + treeCap.spent.trees +
     ' 棵樹、' + treeCap.spent.houses + ' 間房子');

  // 後面幾段不該再有房子與事件（見 installClean）
  await page.evaluate(() => { clearHomes(); stepIdleEvent = () => {}; });

  ok('拆完之後小人開始蓋新的', rebuild.mid > 20 && rebuild.ph0 === 'build',
     '蓋到 ' + rebuild.mid + ' / ' + rebuild.total + '（' + rebuild.ph0 + '）');
  ok('砸還沒蓋完的建築不會進入拆除中', rebuild.ph1 === 'build', 'phase=' + rebuild.ph1);
  ok('施工中被砸，小人會把洞補回去', rebuild.after > rebuild.hurt,
     '砸到剩 ' + rebuild.hurt + ' → 補回 ' + rebuild.after);

  /* 跌破門檻不會當場換場：最後那一下（常常是核彈）的火球跟碎料還在演，
     要站在原地等 SWAP_WAIT 秒才收拾。一幀一幀推，量「跌破」到「離開 wreck」隔多久。 */
  const lag = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 700; startBuild(true); completeNow();
    const gate = Math.floor(bp.slots.length * WRECK_AT), d0 = stats.destroyed;
    let t = 0, tUnder = -1, tSwap = -1, mid = null;
    for (let i = 0; i < 600 && tSwap < 0; i++) {
      if (tUnder < 0) {                       // 還沒跌破門檻就繼續砸
        const cand = blocks.filter(b => b.st === 3);
        if (cand.length) {
          const x = cand[Math.floor(Math.random() * cand.length)];
          smash(new THREE.Vector3(x.x, x.y, x.z), new THREE.Vector3(0.2, -0.95, 0.1).normalize());
        }
      }
      step(0.05); t += 0.05;
      if (tUnder < 0) { if (placedCnt <= gate) tUnder = t; continue; }
      // 等待中途取樣一次：這時候還不該有任何換場動作
      if (!mid && t - tUnder > 1.5) mid = { phase, doz: !!dozers, gained: stats.destroyed - d0 };
      if (phase !== 'wreck') tSwap = t;
    }
    return { gap: +(tSwap - tUnder).toFixed(2), mid, wait: SWAP_WAIT,
             phase, gained: stats.destroyed - d0, placed: placedCnt, gate };
  });
  ok('拆到門檻不會當場換場，先讓最後那一發演完',
     lag.mid && lag.mid.phase === 'wreck' && !lag.mid.doz && lag.mid.gained === 0,
     '跌破門檻（剩 ' + lag.gate + ' 以下）後 1.5 秒：phase=' +
     (lag.mid && lag.mid.phase) + '、推土機 ' + (lag.mid && lag.mid.doz ? '已進場' : '還沒來'));
  ok('等滿三秒才換下一座', lag.gap > lag.wait - 0.2 && lag.gap <= lag.wait &&
     lag.phase !== 'wreck' && lag.gained === 1,
     '隔 ' + lag.gap + ' 秒（設定 ' + lag.wait + '）後 phase=' + lag.phase +
     '，拆掉座數 +' + lag.gained);

  /* ══════════ 偷懶 ══════════ */
  await head('偷懶');
  /* v1.134，使用者：「建築模式下 10% 小人不去蓋地標建築 繼續他的閒晃模式（閒晃模式的事件）」
     「被工具攻擊倒地才會進入建築模式」。這一段要測的就是它，把 installClean 關掉的兩支裝回去。 */
  await page.evaluate(() => { rollLazy = window.lazyRoll; stepIdleEvent = window.evStep; clearHomes(); });

  /* 抽法是洗牌取前 n 個（不是每個人各擲一次點數），所以人數固定時抽到的**個數**也固定，
     抽到的**是誰**每座都不一樣。三種人數各驗一次：20→2、5→1、2→0（一成不到一個人）。 */
  const lazyRoll = await page.evaluate(() => {
    cleanTools();
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 400;
    const draw = (wk, n) => {
      setWorkerCount(wk);
      const seen = new Set(), tally = {};
      for (let i = 0; i < n; i++) {
        startBuild(true);
        const list = workers.map((w, k) => w.lazy ? k : -1).filter(k => k >= 0);
        tally[list.length] = (tally[list.length] || 0) + 1;
        for (const k of list) seen.add(k);
      }
      return { tally: Object.keys(tally).map(k => k + '×' + tally[k]).join('、'), who: seen.size };
    };
    return { w20: draw(20, 40), w5: draw(5, 10), w2: draw(2, 10) };
  });
  ok('每座開工重抽一成的人偷懶，人數固定、抽到的不是固定那幾個',
     lazyRoll.w20.tally === '2×40' && lazyRoll.w5.tally === '1×10' &&
     lazyRoll.w2.tally === '0×10' && lazyRoll.w20.who >= 15,
     '20 人開工 40 次 → 每次偷懶 [' + lazyRoll.w20.tally + ']、輪到過 ' + lazyRoll.w20.who +
     ' 個不同的人；5 人 [' + lazyRoll.w5.tally + ']；2 人 [' + lazyRoll.w2.tally + ']');

  /* 施工中那一整段：偷懶的人在做什麼、其他人有沒有被拖累、地標蓋不蓋得完。
     跑一輪留著給下面三條用（一輪要一分多鐘）。 */
  const lazyRun = await page.evaluate(() => {
    cleanTools(); clearHomes();
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 600; setWorkerCount(20); startBuild(true);
    /* 魔法師一定要在偷懶名單裡（人數維持 2，把名額跟別人換）：他蓋家的路數跟別人不同——
       不拿鏟子，隔空從地面拉一塊新的出來（castHome）。那條路一開始漏掉「這是村子自己挖的」
       記號，實測他蓋的 70 塊裡有 41 塊被當成從地標的料池撿走的。靠自然抽到他才驗得到的話，
       這一條就是在賭骰子。 */
    const mi = workers.findIndex(w => w.mage), k0 = workers.findIndex(w => w.lazy);
    if (mi >= 0 && k0 >= 0 && !workers[mi].lazy) { workers[k0].lazy = 0; workers[mi].lazy = 1; }
    const idx = workers.map((w, i) => w.lazy ? i : -1).filter(i => i >= 0);
    const o = { n: idx.length, carried: 0, home: 0, wander: 0, ev: 0, frames: 0, busy: 0, others: 0,
                mage: mi >= 0 && workers[mi].lazy ? 1 : 0 };
    let t = 0;
    while (phase === 'build' && t < 900) {
      step(0.05); t += 0.05; o.frames++;
      for (const i of idx) {
        const w = workers[i];
        if (!w.lazy) continue;
        if (w.hm >= 0) o.home++; else o.wander++;
        if (w.load.length && w.hm < 0) o.carried++;       // 手上有地標的料＝他跑去上工了
      }
      o.others += workers.filter(w => !w.lazy && w.hm >= 0).length;   // 沒偷懶的跑去蓋房子
      o.busy += workers.filter(w => !w.lazy && (w.load.length || w.carry)).length;
      if (idleEv) o.ev++;
    }
    o.dur = +t.toFixed(1); o.phase = phase; o.placed = placedCnt; o.total = bp.slots.length;
    o.homes = homes ? homes.list.length : 0;
    o.homeSet = blocks.filter(b => b.hh >= 0).length;
    /* 村子用掉的料裡有幾塊不是自己挖的（見 homeMine）。這是「地標永遠差一格」的直接指標：
       料池剛好只夠蓋完那一座，被撿走一塊就再也湊不齊。 */
    o.stolen = blocks.filter(b => b.hh >= 0 && !b.dug).length;
    o.busy = +(o.busy / Math.max(1, o.frames)).toFixed(1);
    o.homePct = Math.round(o.home / Math.max(1, o.home + o.wander) * 100);
    return o;
  });
  ok('施工中偷懶的人不搬地標的料，沒抽中的照常上工',
     lazyRun.n === 2 && lazyRun.carried === 0 && lazyRun.others === 0 && lazyRun.busy > 5,
     '20 人裡 ' + lazyRun.n + ' 個偷懶：手上出現地標建材 ' + lazyRun.carried + ' 幀；' +
     '沒抽中的跑去蓋房子 ' + lazyRun.others + ' 幀，平均 ' + lazyRun.busy + ' 個人手上有貨');
  ok('偷懶的人在施工中就跑閒晃事件（去蓋自己的家）',
     lazyRun.ev >= lazyRun.frames - 2 && lazyRun.homes > 0 && lazyRun.homeSet > 20 &&
     lazyRun.homePct > 50,
     '施工 ' + lazyRun.dur + ' 秒裡事件開著 ' + lazyRun.ev + '/' + lazyRun.frames +
     ' 幀，蓋出 ' + lazyRun.homes + ' 間（' + lazyRun.homeSet + ' 塊）；' +
     '偷懶的人有 ' + lazyRun.homePct + '% 的時間在蓋自己的家，其餘在閒晃');
  ok('村子不吃地標的建材，地標照樣蓋得完（魔法師隔空拉的那些也算村子自己的）',
     lazyRun.stolen === 0 && lazyRun.mage === 1 && lazyRun.phase === 'done' &&
     lazyRun.placed === lazyRun.total,
     '村子那 ' + lazyRun.homeSet + ' 塊裡，不是自己挖的有 ' + lazyRun.stolen +
     ' 塊（偷懶的那兩個裡有魔法師：' + (lazyRun.mage ? '是' : '否') + '）；地標 ' +
     lazyRun.placed + '/' + lazyRun.total + '（' + lazyRun.phase + '）');

  /* 被工具打倒才會收心上工。順便驗「倒地」的界線：站著被點著、抱頭跑圈圈的那種不算。 */
  const lazyHit = await page.evaluate(() => {
    cleanTools(); clearHomes();
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 900; setWorkerCount(20); startBuild(true);
    /* 建材鋪回開場那樣（v1.141）：這一段前面的測試會把料池吃到比藍圖還少，那時候
       二十個人搶的是「幾個蓋得起來又沒人認的格子」，抽到誰都可能整段站在旁邊沒事做——
       量到的就不是「他有沒有回去上工」。 */
    scatterFree();
    /* 會搬料的那種排前面（v1.141 挑掉魔法師、v1.142 再挑掉工程師）：這一條驗的是
       「爬起來真的去搬料」，而這兩種人**本來就不搬**——魔法師站在旁邊隔空拋
       （見 updMage）、工程師只看圖只指揮（見 updEng，而且固定是 0 號，rollLazy 抽到
       0 號的機率是 2/20＝10%）。抽到他們當 a，量到的是「0 幀手上有貨」，那不是他沒上工。
       他們收心之後照樣做自己那份工，由各自那一段守。
       （實測就是這樣飄的：同一份測試前一輪 1151/1200 幀有貨，下一輪抽到工程師 0/1200。） */
    const lz = i => i >= 0;
    /* 排序救不了「一個會搬料的都沒抽到」：20 人裡不搬料的是 0 號工程師與 5／15 號魔法師
       三個人，偷懶抽兩個，兩個都落在那三個裡的機率實測 1.32%（4000 次抽樣 53 次）。
       撞到的那一輪 idx[0] 一定是不搬料的，量到的就是「0 幀手上有貨」——那不是他沒上工
       （v1.145 補：五輪整輪測試撞到一次）。所以先重抽到至少有一個會搬料的為止。 */
    for (let k = 0; k < 50 && !workers.some(w => w.lazy && !w.mage && !w.eng); k++) rollLazy();
    const pick = f => workers.map((w, i) => w.lazy && f(w) ? i : -1).filter(lz);
    const idx = pick(w => !w.mage && !w.eng).concat(pick(w => w.mage || w.eng));
    const o = { n: idx.length };
    let t = 0;
    while (t < 40) { step(0.05); t += 0.05; }          // 先讓事件把他們派去蓋房子
    const a = workers[idx[0]], b = workers[idx[1]];
    o.hm0 = a.hm >= 0 && b.hm >= 0;
    a.fall = 1.8; releaseWorker(a);                    // 等同玩家戳一下（見 game-ui 的 poke）
    step(0.05);
    o.lazyA = a.lazy; o.hmA = a.hm; o.lazyB = b.lazy;
    while (a.fall > 0) step(0.05);
    /* 站著被點著（roll=0，抱頭跑圈圈）不算倒地：b 應該還在偷懶。
       燒完之後再點一次、這次是躺在地上打滾（roll=1），那個才算。 */
    igniteWorker(b, 0);
    for (let k = 0; k < 10; k++) step(0.05);
    o.lazyFire = b.lazy;
    while (b.burn > 0) step(0.05);
    igniteWorker(b, 1);
    step(0.05);
    o.lazyRoll = b.lazy;
    let workA = 0, n = 0;
    while (phase === 'build' && n < 1200) { step(0.05); n++; if (a.load.length || a.carry) workA++; }
    o.workA = workA; o.frames = n; o.lazyA2 = a.lazy;
    return o;
  });
  ok('被工具打倒才進建築模式：倒地那一幀就收心，爬起來真的去搬料',
     lazyHit.hm0 && lazyHit.lazyA === 0 && lazyHit.hmA === -1 && lazyHit.lazyB === 1 &&
     lazyHit.lazyA2 === 0 && lazyHit.workA > lazyHit.frames * 0.2,
     '戳倒的那個：lazy ' + lazyHit.lazyA + '、蓋到一半的家放掉（hm=' + lazyHit.hmA +
     '），起來之後 ' + lazyHit.workA + '/' + lazyHit.frames + ' 幀手上有貨；沒被戳的還在偷懶');
  ok('站著被點著、抱頭跑圈圈的不算倒地，躺在地上打滾的才算',
     lazyHit.lazyFire === 1 && lazyHit.lazyRoll === 0,
     '跑圈圈時 lazy=' + lazyHit.lazyFire + '，打滾時 lazy=' + lazyHit.lazyRoll);

  /* 完工之後那一輪照舊：事件重挑，全場都能參加（不是只有偷懶的那兩個）。
     這一條擋的是「evArm 已經是 0，完工後再也不會挑」——那會讓 v1.97 的村子整個消失。 */
  const lazyDone = await page.evaluate(() => {
    cleanTools(); clearHomes();
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 400; setWorkerCount(20); startBuild(true);
    let t = 0, during = 0;
    /* 施工中在蓋自己家的人數要**在施工中**取樣：完工那一幀事件就收掉了（見 stepIdleEvent
       的換場合重挑），跑完再數一律是 0。 */
    while (phase === 'build' && t < 900) {
      step(0.05); t += 0.05;
      during = Math.max(during, workers.filter(w => w.hm >= 0).length);
    }
    t = 0;
    while (t < 30) { step(0.05); t += 0.05; }          // 慶祝七秒 + 散場 + 重新挑一件
    return { during, crew: workers.filter(w => w.hm >= 0).length,
             ev: idleEv ? idleEv.id : null, lazy: workers.filter(w => w.lazy).length,
             homes: homes ? homes.list.length : 0 };
  });
  ok('完工之後事件重挑，全場都能參加（不只偷懶的那幾個）',
     lazyDone.ev === 'home' && lazyDone.crew > lazyDone.during && lazyDone.crew > 4,
     '施工中 ' + lazyDone.during + ' 個人在蓋自己的家（偷懶的 ' + lazyDone.lazy +
     ' 個），慶祝散場後變成 ' + lazyDone.crew + ' 個、村子 ' + lazyDone.homes + ' 間');

  // 後面幾段不該再有房子、事件與偷懶（見 installClean）
  await page.evaluate(() => {
    clearHomes();
    stepIdleEvent = () => {};
    rollLazy = () => { for (const w of workers) w.lazy = 0; };
    rollLazy();
  });

  /* ══════════ 整地推土機 ══════════ */
  await head('整地推土機');
  /* 這一段的門檻是照「1400 塊上下的工地」量出來的。v1.66 把城堡換成新天鵝堡之後，
     那一格最小就是 4450 塊（dim 的下限撐著，調 lo 沒用），工地大了三倍、10 秒的時限
     本來就清不完（實測清除率掉到 50%）。改用尺寸最接近舊城堡的泰姬瑪哈陵：
     1400 塊時 1412 塊／半徑 13.8／高 16，舊城堡是 1392／14.8／14。 */
  await reset(page, { shape: '泰姬瑪哈陵', cnt: 1200, workers: 12 });
  const doze = await page.evaluate(() => {
    completeNow();
    // 先把整座砸爛，讓碎料鋪滿工地，砸到門檻它就會自己換下一座
    let g = 0;
    while (phase !== 'clear' && g++ < 200) {
      const cand = blocks.filter(b => b.st === 3);
      if (cand.length) {
        const t = cand[Math.floor(Math.random() * cand.length)];
        smash(new THREE.Vector3(t.x, t.y, t.z), new THREE.Vector3(0.2, -0.95, 0.1).normalize());
      }
      for (let k = 0; k < 8; k++) step(0.05);
    }
    const born = dozers ? dozers.list.length : 0;
    const drawn = dozers ? dozRender(dozers).length : 0;
    const R = siteR + 1.4;
    const wantN = Math.min(Math.ceil(R / ENG.DOZ_W), ENG.MAXDOZ);
    /* 並排的檔位：把每台的位置投影到「橫向」那條軸上（行進方向是 (sin a, cos a)，
       橫向就是 (cos a, -sin a)）。相鄰兩台的間距要 ≤ 一把鏟子的寬度（2·DOZ_W），
       最外側那兩台的鏟子邊緣要碰到工地邊界——兩件都成立才叫「鋪滿整個寬度」。 */
    const a0 = dozers ? dozers.list[0].a : 0;
    const lats = (dozers ? dozers.list : []).map(m => m.x * Math.cos(a0) - m.z * Math.sin(a0))
                                            .sort((p, q) => p - q);
    let lane = 0;
    for (let i = 1; i < lats.length; i++) lane = Math.max(lane, lats[i] - lats[i - 1]);
    const edge = lats.length ? R - Math.max(-lats[0], lats[lats.length - 1]) : 99;
    const dirtyOf = () => blocks.filter(b => b.st === 0 && Math.hypot(b.x, b.z) < R).length;
    // 最密的一格有幾塊——推土機的工作就是把這個數字壓下來
    const heapOf = () => {
      const c = new Map();
      for (const b of blocks) {
        if (b.st !== 0 || Math.hypot(b.x, b.z) >= R) continue;
        const k = Math.floor(b.x / 5) + ':' + Math.floor(b.z / 5);
        c.set(k, (c.get(k) || 0) + 1);
      }
      return c.size ? Math.max(...c.values()) : 0;
    };
    /* 「機器真的把料推出去了」跟「時間到直接彈掉」要分清楚。
       收尾 kickOut 的那批在被彈的當下還在範圍內，所以整地結束時人在範圍外的，
       就是被鏟子推出去的。 */
    const cohort = blocks.filter(b => b.st === 0 && Math.hypot(b.x, b.z) < R);
    const origKick = kickOut; let kicked = 0;
    kickOut = b => { kicked++; origKick(b); };
    const trail = [];
    let peak = dirtyOf(), heap0 = 0, lastIn = 0, built = 0, guard = 0;
    let sawPush = 0, maxSpd = 0, mFrames = 0;
    let inSite = 0, blDown = 0;
    while (phase === 'clear' && guard++ < 900) {
      const before = dozers ? dozers.list.map(m => ({ x: m.x, z: m.z })) : null;
      step(0.05);
      const d = dirtyOf();
      if (d > peak) peak = d;
      if (guard % 8 === 0) trail.push(heapOf());
      if (dozers && dozers.on) {
        if (heap0 === 0) heap0 = heapOf();               // 開推那一刻最密的一格
        /* 鏟子該不該放下來只看位置：在工作範圍內就得放下。
           以前是「趕路抬起、推的時候放下」，機器抬著鏟子穿過工地的那一大段完全沒產出。 */
        for (const m of dozers.list) {
          mFrames++;
          if (m.st === 'push') sawPush++;
          if (Math.hypot(m.x, m.z) < siteClearR()) { inSite++; if (m.bl < 0.35) blDown++; }
        }
        if (before) for (let i = 0; i < dozers.list.length; i++) {
          const m = dozers.list[i], p = before[i];
          const v = Math.hypot(m.x - p.x, m.z - p.z) / 0.05;
          if (v > maxSpd) maxSpd = v;
        }
      }
      if (placedCnt > built) built = placedCnt;
      // 留一張整地中的畫面：畫完就不再畫，後面截到的就是這一幀
      if (guard === 55) { for (let i = 0; i < 8; i++) ENG.updateCamera(1); draw(); ENG.render(); }
      /* 小人本來就可能剛好站在工地正中央（上一秒還在遊蕩），走出去要好幾秒，
         所以不能要求「整段期間都不在裡面」。要驗的是他們有往外走、而且整完時人不在裡面。 */
      for (const w of workers) if (Math.hypot(w.x, w.z) < R) { lastIn = guard; break; }
    }
    const stillIn = workers.filter(w => Math.hypot(w.x, w.z) < R).length;
    const pushedOut = cohort.filter(b => Math.hypot(b.x, b.z) >= R).length;
    kickOut = origKick;
    const dirty1 = dirtyOf(), secs = +(guard * 0.05).toFixed(1);
    /* 整完會自己開走。這一段（v1.64.2）也要驗：時限到不代表鏟子當場抬起來——
       車子還在工作範圍內就得繼續推，不然最後那一趟是抬著鏟子穿過工地。 */
    const opw = pushWithBlade;
    let g2 = 0, outFrames = 0, outDown = 0, outPush = 0;
    window.pushWithBlade = (m, mx, mz) => {
      const n = opw(m, mx, mz);
      if (n && dozers && dozers.done) outPush += n;
      return n;
    };
    while (dozers && g2++ < 400) {
      const L = dozers.list;
      step(0.05);
      for (const m of L) if (Math.hypot(m.x, m.z) < dozWorkR()) { outFrames++; if (m.bl < 0.35) outDown++; }
    }
    window.pushWithBlade = opw;
    return { born, drawn, peak, dirty1, trail, secs, built, stillIn, heap0,
             cohort: cohort.length, pushedOut, kicked, outFrames, outDown, outPush,
             heapEnd: trail.length ? trail[trail.length - 1] : 0,
             sawPush, wantN, inSite, blDown, mFrames, maxSpd: +maxSpd.toFixed(1),
             lane: +lane.toFixed(2), edge: +edge.toFixed(2), dw: ENG.DOZ_W,
             lats: lats.map(v => +v.toFixed(1)),
             lastIn: +(lastIn * 0.05).toFixed(1),
             gone: !dozers, phase, drove: +(g2 * 0.05).toFixed(1) };
  });
  /* 台數照**地標寬度**算（v1.142，使用者指定）：工地寬度 ÷ 一把鏟子的寬度。
     v1.61～v1.141 是照面積算、上限 6 台，大工地根本清不動（實測金門大橋推出去 0 塊，
     全靠收尾彈掉）。這一條同時驗「並排鋪滿寬度」：間距 ≤ 鏟子寬、最外側碰到邊界。 */
  ok('推土機台數照地標寬度算，並排鋪滿整個工地',
     doze.born === doze.wantN && doze.drawn === doze.born &&
     doze.lane <= doze.dw * 2 + 0.01 && doze.edge <= doze.dw + 0.01 && doze.edge > 0,
     doze.born + ' 台（寬度換算要 ' + doze.wantN + ' 台），畫面上放了 ' + doze.drawn +
     ' 台；橫向檔位 ' + JSON.stringify(doze.lats) + '，相鄰最寬 ' + doze.lane +
     '（一把鏟子 ' + (doze.dw * 2) + '），最外側離邊界 ' + doze.edge + '（≤ 半把鏟子 ' +
     doze.dw + ' 才叫掃得到邊）');
  /* 以前是「趕路抬鏟、到位才放下」，機器抬著鏟子橫越工地那一段完全沒產出——
     實測吃掉三成到七成七的機器時間。現在鏟子只看位置：進了範圍就放下。 */
  /* 扣掉的那幾幀是鏟子放下來的緩降動畫（進場那一下 bl 從 1 降到 0 要幾幀），
     每台抓 3 幀的餘裕。 */
  ok('人在工地裡就一定在推，不會抬著鏟子空跑',
     doze.inSite > 50 && doze.blDown >= doze.inSite - doze.born * 3 &&
     doze.sawPush > doze.mFrames * 0.95,
     '範圍內 ' + doze.inSite + ' 幀，鏟子放下的有 ' + doze.blDown + ' 幀（差的是進場放鏟那幾幀）；' +
     '整段有 ' + (doze.sawPush / doze.mFrames * 100).toFixed(0) + '% 的機器時間在推');
  ok('車速在合理範圍，不會用飛的', doze.maxSpd > 3 && doze.maxSpd < 12,
     '最快 ' + doze.maxSpd + ' 單位／秒（小人走路是 6.8）');
  ok('整地時小人退出工地等，不會提早開工', doze.stillIn === 0 && doze.built === 0,
     '整完時還站在工地裡的有 ' + doze.stillIn + ' 人（最後一次有人在裡面是第 ' +
     doze.lastIn + ' 秒／共 ' + doze.secs + ' 秒），期間蓋了 ' + doze.built + ' 塊');
  /* 清得掉多少很看堆的位置，但門檻要有意義：繞內側那版是平均 27～33%
     （中世紀城堡（v1.66 換掉的那份）四輪 15/18/32/43%），對穿之後 51～69%，時限拉到 10 秒（v1.61.1）
     之後是 82～87%，v1.142 照寬度並排掃一趟之後是 92%（同一份藍圖同一支測試；
     另外六個場景 93/98/94/100/95/95%，見 README〈整地〉）。門檻跟著拉到八成，
     擋的是退步不是抖動。 */
  ok('機器真的把碎料推出去了，不是全靠收尾彈掉', doze.pushedOut > doze.cohort * 0.8,
     doze.cohort + ' 塊裡有 ' + doze.pushedOut + ' 塊被鏟出範圍（' +
     (doze.pushedOut / doze.cohort * 100).toFixed(0) + '%），收尾彈掉 ' + doze.kicked +
     ' 塊；最密的一格 ' + JSON.stringify(doze.trail.slice(0, 12)));
  ok('整地完工地範圍是空的', doze.dirty1 === 0,
     '整地 ' + doze.secs + ' 秒，範圍內從最多 ' + doze.peak + ' 塊清到 ' + doze.dirty1 + ' 塊');
  ok('整完會自己開出場', doze.gone && doze.phase === 'build',
     doze.drove + ' 秒後開走，phase=' + doze.phase);
  /* v1.64.2：以前時限一到就 `m.bl = 1`（鏟子當場抬起來）再直線開出去，
     最後那一趟等於白跑——而且畫面上是抬著鏟子從料堆中間穿過去。
     v1.142 起收工的時機是「整排都掃出另一頭了」，那一刻機器剛好落在 dozOutR 與
     dozWorkR 之間（只差 1 格），所以每台還有一兩幀在範圍內——那幾幀鏟子必須還放著，
     而且那一疊要跟著推出去（實測 4 台 6 幀、順路 2650 塊次）。 */
  ok('收工開出去的路上，還在範圍內就繼續推',
     doze.outFrames >= doze.born && doze.outDown === doze.outFrames && doze.outPush > 200,
     '開出去那 ' + doze.drove + ' 秒裡，車子在工作範圍內 ' + doze.outFrames +
     ' 幀（' + doze.born + ' 台）、鏟子放著的有 ' + doze.outDown + ' 幀，順路又推了 ' +
     doze.outPush + ' 塊次');
  await page.screenshot({ path: path.join(OUT, '04-整地.png') });

  /* ── 從地圖邊緣並排進場，一趟掃過去（v1.61 進場、v1.142 並排）─────────
     v1.61 之前是「在工地邊上憑空出現、原地怠速 1.3 秒」；v1.61～v1.141 是每台走自己的
     一條弦、各自找料；v1.142 起整排從同一側並排開進來，一趟直線掃完就收工。 */
  const dozIn = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '新天鵝堡');
    targetCnt = 1200; setWorkerCount(4); startBuild(true); completeNow();
    for (const b of blocks) if (b.st === 3) freeBlock(b);
    for (let i = 0; i < 120; i++) step(0.05);
    startClear();
    const spawnR = dozers.list.map(m => +Math.hypot(m.x, m.z).toFixed(1));
    /* 整排共用一個行進方向 a0：軸向 = (sin a0, cos a0)、橫向 = (cos a0, -sin a0)。
       「並排」＝每台的橫向座標各自一條帶、軸向座標同一側。 */
    const a0 = dozers.list[0].a;
    const axOf = p => p.x * Math.sin(a0) + p.z * Math.cos(a0);
    const latOf = p => p.x * Math.cos(a0) - p.z * Math.sin(a0);
    const lat0 = dozers.list.map(latOf);
    let drift = 0;
    const outsideAtBirth = dozers.list.filter(m => Math.hypot(m.x, m.z) > arenaR).length;
    const entry = new Map();
    let outFrames = 0, outUp = 0, inFrames = 0, inDown = 0, passes = 0;
    const wasSt = new Map();
    let g = 0;
    while (phase === 'clear' && g++ < 900) {
      step(0.05);
      if (!dozers) break;
      for (const m of dozers.list) {
        const d = Math.hypot(m.x, m.z);
        if (d < dozWorkR() && !entry.has(m)) entry.set(m, { x: m.x, z: m.z });
        /* 離開建築範圍就關掉推土效果：鏟子抬起來。留 1.5 格的餘裕給抬鏟的動畫
           （bl 是漸變的），進場那一側同理。 */
        if (d > dozWorkR() + 1.5) { outFrames++; if (m.bl > 0.5) outUp++; }
        if (d < dozWorkR() - 1.5) { inFrames++; if (m.bl < 0.5) inDown++; }
        /* 改派一趟 = 目標換了一個點。seek 那一格在同一幀就會轉回 push，
           從外面看永遠看不到 seek，所以用目標的變化來數。 */
        const key = m.tx.toFixed(2) + ',' + m.tz.toFixed(2);
        if (wasSt.has(m) && wasSt.get(m) !== key) passes++;
        wasSt.set(m, key);
        // 走的是不是一條直線：橫向座標不該偏離自己出發的那一條帶
        drift = Math.max(drift, Math.abs(latOf(m) - lat0[dozers.list.indexOf(m)]));
      }
    }
    // 各自踏進工地的入口點：分散進場的話這些點會散在工地外圍，不會擠在一起
    const es = Array.from(entry.values());
    let minEntry = Infinity;
    for (let a = 0; a < es.length; a++)
      for (let b = a + 1; b < es.length; b++)
        minEntry = Math.min(minEntry, Math.hypot(es[a].x - es[b].x, es[a].z - es[b].z));
    // 入口都在同一側（軸向為負＝還沒過場中心），而且橫向一台一條帶、間距 ≤ 一把鏟子
    const sameSide = es.filter(p => axOf(p) < 0).length;
    const eLat = es.map(latOf).sort((p, q) => p - q);
    let eGapMax = 0, eGapMin = Infinity;
    for (let i = 1; i < eLat.length; i++) {
      eGapMax = Math.max(eGapMax, eLat[i] - eLat[i - 1]);
      eGapMin = Math.min(eGapMin, eLat[i] - eLat[i - 1]);
    }
    return { n: dozers ? dozers.list.length : 0, spawnR, outsideAtBirth,
             arena: +arenaR.toFixed(1), work: +dozWorkR().toFixed(1),
             entered: es.length, minEntry: +minEntry.toFixed(1),
             sameSide, eGapMax: +eGapMax.toFixed(2), eGapMin: +eGapMin.toFixed(2),
             blade: ENG.DOZ_W * 2, drift: +drift.toFixed(3),
             outFrames, outUp, inFrames, inDown, passes, secs: +(g * 0.05).toFixed(1) };
  });
  ok('推土機從地圖邊緣進場，不是在工地邊上憑空出現',
     dozIn.outsideAtBirth === dozIn.n && Math.min(...dozIn.spawnR) > dozIn.arena,
     dozIn.n + ' 台的出發點都在半徑 ' + dozIn.spawnR.join('／') + '（碎料場外緣是 ' +
     dozIn.arena + '、工作範圍是 ' + dozIn.work + '）');
  ok('整排從同一側並排開進來，一台一條帶',
     dozIn.entered === dozIn.n && dozIn.sameSide === dozIn.n &&
     dozIn.eGapMax <= dozIn.blade + 0.01 && dozIn.eGapMin > 0.5,
     dozIn.n + ' 台都開進了工地、入口都在同一側；橫向間距 ' + dozIn.eGapMin + '～' +
     dozIn.eGapMax + '（一把鏟子 ' + dozIn.blade + '），兩兩最近的入口相隔 ' +
     dozIn.minEntry + ' 格');
  // 每台留 3 幀給放鏟／抬鏟的漸變動畫（bl 是 lerp 過去的，不是瞬間切換）
  ok('進了建築範圍才放鏟，離開就抬起來',
     dozIn.inDown >= dozIn.inFrames - dozIn.n * 3 && dozIn.outUp >= dozIn.outFrames - dozIn.n * 3 &&
     dozIn.inFrames > 50 && dozIn.outFrames > 50,
     '範圍內 ' + dozIn.inFrames + ' 幀裡放著鏟的 ' + dozIn.inDown + '、範圍外 ' +
     dozIn.outFrames + ' 幀裡抬著的 ' + dozIn.outUp + '（差的是漸變那幾幀）');
  /* v1.142：一次，不回頭。目標從出發就沒再變過（passes 0），而且整趟是一條直線——
     橫向座標不偏離自己出發的那一條帶，不然並排就會歪掉、兩台擠到同一條線上。
     v1.61～v1.141 的行為剛好相反（推完一趟就回頭再挑一坨，那時要求 passes ≥ 2）。 */
  ok('一趟直線掃完就收工，不會再回頭找料',
     dozIn.passes === 0 && dozIn.drift < 0.05,
     dozIn.n + ' 台在 ' + dozIn.secs + ' 秒裡改派 ' + dozIn.passes +
     ' 次，橫向最多偏離自己那條帶 ' + dozIn.drift + ' 格');

  /* 掃的方向：碎料鋪成長條的時候要**從短邊推**。沿著長邊推的話，一把鏟子得從頭到尾
     收整條線的料，鏟面前那一疊早就滿了，後面的就從兩側漏掉——實測金門大橋 9000 建材
     沿長邊推只送出 48%，改成推短邊 95%（萬里長城 3000 是 61% → 100%）。 */
  const dozAxis = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '萬里長城');
    targetCnt = 3000; setWorkerCount(6); startBuild(true); completeNow();
    for (const b of blocks) if (b.st === 3) freeBlock(b);
    for (let i = 0; i < 140; i++) step(0.05);
    // 碎料分布的長邊（共變異數矩陣的主軸）。這裡自己算一份，不呼叫 sweepAngle
    const r = siteClearR();
    let n = 0, sx = 0, sz = 0, xx = 0, zz = 0, xz = 0;
    for (const b of blocks) {
      if (b.st !== 0 || Math.hypot(b.x, b.z) >= r) continue;
      n++; sx += b.x; sz += b.z; xx += b.x * b.x; zz += b.z * b.z; xz += b.x * b.z;
    }
    const mx = sx / n, mz = sz / n;
    const cxx = xx / n - mx * mx, czz = zz / n - mz * mz, cxz = xz / n - mx * mz;
    const major = 0.5 * Math.atan2(2 * cxz, cxx - czz);      // 長邊的方向
    const mid = (cxx + czz) / 2, d = Math.hypot((cxx - czz) / 2, cxz);
    const ratio = (mid - d) / (mid + d);        // 短邊 ÷ 長邊的變異數比，越小越細長
    /* 每次 startClear 都重挑一次方向（左右哪一邊是隨機的），十二次都該垂直於長邊。
       角度只看 mod 180°：從左邊推還是從右邊推都算「推短邊」。 */
    let worst = 0;
    const dirs = [];
    for (let t = 0; t < 12; t++) {
      startClear();
      const a = dozers.list[0].a;                            // 車頭＝行進方向 (sin a, cos a)
      const dir = Math.atan2(Math.cos(a), Math.sin(a));      // 換成跟 major 同一套 atan2(z, x)
      let diff = Math.abs(dir - major) % Math.PI;
      if (diff > Math.PI / 2) diff = Math.PI - diff;
      const deg = diff / Math.PI * 180;
      dirs.push(+deg.toFixed(1));
      worst = Math.max(worst, Math.abs(deg - 90));
    }
    dozers = null; phase = 'build';
    return { n, ratio: +ratio.toFixed(3), worst: +worst.toFixed(1), dirs };
  });
  ok('碎料鋪成長條的時候，從短邊推過去（不是沿著長邊推）',
     dozAxis.ratio < 0.5 && dozAxis.worst < 5,
     '萬里長城的碎料短邊÷長邊 = ' + dozAxis.ratio + '（越小越細長，' + dozAxis.n +
     ' 塊）；十二次挑的方向與長邊夾角 ' + JSON.stringify(dozAxis.dirs) + '（90° 才是推短邊）');

  /* 「並排鋪滿寬度」的實證（v1.142）：把測試用的碎料橫著排滿整個工地寬度，一格一塊，
     看整排掃過去之後有沒有哪一塊沒動。鏟子之間留了縫的話，縫的位置就會剩下沒被推走的。
     只驗座標算得對是不夠的——要真的被那把鏟子推到。 */
  const dozGap = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '新天鵝堡');
    targetCnt = 1200; setWorkerCount(4); startBuild(true); completeNow();
    for (const b of blocks) if (b.st === 3) freeBlock(b);
    for (let i = 0; i < 140; i++) step(0.05);
    startClear();
    const a = dozers.list[0].a;
    const ux = Math.sin(a), uz = Math.cos(a);                // 行進方向
    const px = Math.cos(a), pz = -Math.sin(a);               // 橫向
    const R = siteClearR();
    /* 場上其他碎料先挪到場邊（連空間雜湊一起搬）：留著的話，量到的位移會混進
       「碎料互相擠開」的成分，而這裡要測的是那個橫向位置有沒有被鏟子掃到。 */
    for (const b of blocks) {
      if (b.st !== 0) continue;
      if (b.cell) gridDel(b);
      b.x = arenaR * 0.98; b.z = arenaR * 0.98; b.y = 0.47; b.rest = true;
      gridAdd(b);
    }
    // 橫向一格一塊排滿整個寬度，擺在工地中線上（軸向 0）——整排一定會壓過去
    const probes = [];
    for (let lat = -R + 0.3; lat <= R - 0.3; lat += 1) {
      const b = blocks.find(x => x.st === 0 && !x.probe);
      if (!b) break;
      b.probe = 1;
      if (b.cell) gridDel(b);
      b.x = px * lat; b.z = pz * lat; b.y = 0.47; b.rest = true;
      gridAdd(b);
      probes.push({ b, lat: +lat.toFixed(1), x0: b.x, z0: b.z });
    }
    /* 收尾的 kickOut 會把還留在工地裡的彈出去，所以位移要看**收工前**那一幀，
       不然「沒被推走的」會被彈飛的位移蓋掉。 */
    let snap = probes.map(p => ({ x: p.b.x, z: p.b.z }));
    let g = 0;
    while (phase === 'clear' && g++ < 900) {
      step(0.05);
      if (dozers && !dozers.done) snap = probes.map(p => ({ x: p.b.x, z: p.b.z }));
    }
    const moved = probes.map((p, k) => (snap[k].x - p.x0) * ux + (snap[k].z - p.z0) * uz);
    return { n: probes.length, R: +R.toFixed(1), secs: +(g * 0.05).toFixed(1),
             lanes: dozers ? dozers.list.length : 0,
             stuck: probes.filter((p, k) => moved[k] < 1).map(p => p.lat),
             minMove: +Math.min(...moved).toFixed(2), maxMove: +Math.max(...moved).toFixed(2) };
  });
  ok('整個寬度都掃得到，鏟子與鏟子之間沒有縫',
     dozGap.n > 25 && dozGap.stuck.length === 0,
     '半徑 ' + dozGap.R + ' 的工地橫向排了 ' + dozGap.n + ' 塊、' + dozGap.lanes +
     ' 台掃過去，沒被推走的：' + (dozGap.stuck.length ? JSON.stringify(dozGap.stuck) : '無') +
     '（推得最少的一塊往前 ' + dozGap.minMove + '、最多 ' + dozGap.maxMove + '）');

  /* 只拿槌子敲的話碎料會全堆在挨打的那一區——這才是推土機真正要處理的情況 */
  const dozeHeap = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '新天鵝堡');
    targetCnt = 1400; setWorkerCount(4); startBuild(true); completeNow();
    // 固定敲同一角，把碎料集中砸成一大坨
    const cand = blocks.filter(b => b.st === 3);
    const t = cand[Math.floor(cand.length * 0.35)];
    const spot = new THREE.Vector3(t.x, t.y, t.z);
    for (let i = 0; i < 40; i++) {
      smash(spot, new THREE.Vector3(0.1, -0.98, 0.1).normalize(), 7, 9);
      for (let k = 0; k < 6; k++) step(0.05);
    }
    for (let i = 0; i < 60; i++) step(0.05);
    const R = siteR + 1.4;
    const densest = () => {
      const c = new Map();
      for (const b of blocks) {
        if (b.st !== 0 || Math.hypot(b.x, b.z) >= R) continue;
        const k = Math.floor(b.x / 5) + ':' + Math.floor(b.z / 5);
        c.set(k, (c.get(k) || 0) + 1);
      }
      return c.size ? Math.max(...c.values()) : 0;
    };
    const before = densest();
    startClear();
    let g = 0, mid = 0;
    while (phase === 'clear' && g++ < 900) { step(0.05); if (g === 60) mid = densest(); }
    return { before, mid, after: densest(), secs: +(g * 0.05).toFixed(1) };
  });
  ok('只敲一個角砸出來的那一大坨也會被推散',
     dozeHeap.before > 25 && dozeHeap.after < dozeHeap.before * 0.5,
     '最密的一格 ' + dozeHeap.before + ' → ' + dozeHeap.after + ' 塊（' +
     dozeHeap.secs + ' 秒）');

  /* 整地不碰鏡頭。使用者回報「出現推土機好像會把鏡頭拉遠」，查下來整地這條路上沒有任何運鏡：
     看到的是前一發核彈／魔法退開之後就停在那裡（只退不收），推土機進場時鏡頭還在那個位置。
     這條守住「整地本身不動鏡頭」，以後有人往這裡塞運鏡會被擋下來。 */
  const dozeCam = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '新天鵝堡');
    targetCnt = 1200; startBuild(true); completeNow();
    for (const b of blocks) { if (b.st === 3) freeBlock(b); }
    for (let i = 0; i < 120; i++) step(0.05);
    const d0 = ENG.camTarget.dist, ty0 = ENG.camTarget.ty;
    startClear();
    let g = 0, dMax = d0, dMin = d0, tyMax = ty0;
    while (phase === 'clear' && g++ < 900) {
      step(0.05);
      dMax = Math.max(dMax, ENG.camTarget.dist); dMin = Math.min(dMin, ENG.camTarget.dist);
      tyMax = Math.max(tyMax, ENG.camTarget.ty);
    }
    return { d0: +d0.toFixed(2), dMax: +dMax.toFixed(2), dMin: +dMin.toFixed(2),
             ty0: +ty0.toFixed(2), tyMax: +tyMax.toFixed(2), secs: +(g * 0.05).toFixed(1) };
  });
  ok('整地期間鏡頭完全不動',
     dozeCam.dMax === dozeCam.d0 && dozeCam.dMin === dozeCam.d0 && dozeCam.tyMax === dozeCam.ty0,
     '整地 ' + dozeCam.secs + ' 秒，視距一路都是 ' + dozeCam.d0 + '、視線高度 ' + dozeCam.ty0);

  /* 大工地：機器慢慢開，不可能在時限內清光——重點是它不會沒完沒了，收尾照樣把地清乾淨 */
  const dozeBig = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '金門大橋');
    targetCnt = 2000; setWorkerCount(6); startBuild(true); completeNow();
    for (const b of blocks) { if (b.st === 3) freeBlock(b); }
    for (let i = 0; i < 120; i++) step(0.05);
    siteR = bp.radius; startClear();
    const R = siteR + 1.4;
    const dirty0 = blocks.filter(b => b.st === 0 && Math.hypot(b.x, b.z) < R).length;
    let g = 0, maxSpd = 0;
    while (phase === 'clear' && g++ < 1200) {
      const before = dozers ? dozers.list.map(m => ({ x: m.x, z: m.z })) : null;
      step(0.05);
      if (dozers && before) for (let i = 0; i < dozers.list.length; i++) {
        const m = dozers.list[i], p = before[i];
        const v = Math.hypot(m.x - p.x, m.z - p.z) / 0.05;
        if (v > maxSpd) maxSpd = v;
      }
    }
    return { dirty0, secs: +(g * 0.05).toFixed(1), phase, siteR: +siteR.toFixed(0),
             maxSpd: +maxSpd.toFixed(1), n: dozers ? dozers.list.length : 0,
             lim: +passLimit().toFixed(1),
             dirty1: blocks.filter(b => b.st === 0 && Math.hypot(b.x, b.z) < R).length };
  });
  ok('大工地的車速跟小工地一樣，不會為了趕時間飆起來', dozeBig.maxSpd < 12,
     '半徑 ' + dozeBig.siteR + ' 的工地，最快 ' + dozeBig.maxSpd + ' 單位／秒');
  /* 秒數上限跟 passLimit() 綁（半徑 60 的工地是 23.9 秒）＋ 進場那段路的餘裕，
     不要釘死某一次量到的數字。守的是「不會沒完沒了」。
     v1.142 之前這裡是 15 秒（DOZ_LIMIT 10 ＋ 進場 ＋ 收尾，實測 12.7 秒），但那時
     一趟連對穿都跑不完、推出去 0 塊；現在 20 台真的並排掃完整個 123 格寬（實測 19.8 秒
     推出去 95%）——時間是跟著寬度長的，這是使用者指定「依目前移動速度」的必然。 */
  ok('大工地不會沒完沒了，收尾照樣清乾淨',
     dozeBig.dirty1 === 0 && dozeBig.secs < dozeBig.lim + 6,
     dozeBig.dirty0 + ' 塊 → ' + dozeBig.dirty1 + ' 塊，' + dozeBig.n + ' 台花 ' +
     dozeBig.secs + ' 秒（上限 ' + (dozeBig.lim + 6).toFixed(1) + '＝一趟 ' +
     dozeBig.lim + ' ＋ 進場餘裕 6）');

  /* 畫面上的鏟子跟判定用的鏟子要是同一把。
     在每台機器的鏟面正前方各擺一塊碎料，看它會不會被往前推——
     只驗座標的話，鏟子畫在別的地方也測不出來。 */
  const dozAlign = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 700; setWorkerCount(6); startBuild(true); completeNow();
    for (const b of blocks) if (b.st === 3) freeBlock(b);
    for (let i = 0; i < 120; i++) step(0.05);
    kickOutSite();                                  // 先清空，等一下自己擺測試用的積木
    for (let i = 0; i < 80; i++) step(0.05);
    startClear();
    /* 先把場上其他碎料全部從空間雜湊裡拿掉並挪到場邊。留著的話，
       量到的位移會混進「碎料互相擠開」的成分——這裡要測的是鏟子推不推得到。 */
    for (const b of blocks) {
      if (b.st !== 0) continue;
      if (b.cell) gridDel(b);
      b.x = arenaR * 0.98; b.z = arenaR * 0.98; b.y = 0.47;
    }
    // 手動把三台都排進工地裡、轉成朝外推的狀態
    dozers.list.forEach((m, i) => {
      const ang = i / dozers.list.length * Math.PI * 2;
      m.ux = Math.cos(ang); m.uz = Math.sin(ang);
      m.x = m.ux * siteR * 0.3; m.z = m.uz * siteR * 0.3;
      m.a = Math.atan2(m.ux, m.uz);
      m.tx = m.ux * (siteR + 8); m.tz = m.uz * (siteR + 8);
      m.st = 'push'; m.bl = 0;
    });
    const view = dozRender(dozers);
    const probes = [];
    for (const v of view) {
      const fx = Math.sin(v.a), fz = Math.cos(v.a);  // rotation.y = a → local +Z 指向這裡
      const b = blocks.find(x => x.st === 0 && !x.probe);
      b.probe = 1;
      const at = ENG.DOZ_FRONT + 0.2;                // 剛好貼在鏟面前
      b.x = v.x + fx * at; b.z = v.z + fz * at; b.y = 0.47; b.rest = true;
      gridAdd(b);
      probes.push({ b, x0: b.x, z0: b.z, fx, fz });
    }
    for (let i = 0; i < 6; i++) step(0.02);
    const moved = probes.map(p => +((p.b.x - p.x0) * p.fx + (p.b.z - p.z0) * p.fz).toFixed(2));
    // 碎料應該跟車子走一樣的距離——是被推著，不是被拉扯
    const drove = dozers ? dozers.list.map((m, i) => +Math.hypot(m.x - view[i].x, m.z - view[i].z).toFixed(2)) : [];
    /* 上面那個 completeNow 讓小人慶祝了一輪，彩帶（v1.96）還飄在半空。
       塵霧那個池子只要非空就多一個 draw call，而這一條量的是推土機。 */
    dust.length = 0;
    draw(); ENG.render();
    return { n: view.length, moved, drove, min: Math.min(...moved),
             slip: Math.max(...moved.map((v, i) => Math.abs(v - drove[i]))), calls: ENG.info().calls };
  });
  ok('鏟面前的碎料跟著車子一起走', dozAlign.min > 0.5 && dozAlign.slip < 0.35,
     '車子走了 ' + JSON.stringify(dozAlign.drove) + '，碎料走了 ' +
     JSON.stringify(dozAlign.moved) + '（最大落差 ' + dozAlign.slip.toFixed(2) + '）');
  ok('推土機沒有多吃 draw call', dozAlign.calls <= 13,
     dozAlign.calls + ' 個（整地中的機器共用一個 InstancedMesh，幾台都一樣）');

  /* 碎料要「被帶著走」，不能被彈開。踩過的雷：每幀直接呼叫 separate 擠開重疊，
     它一幀能把積木推開 4.7 單位、遠比車速快，鏟子前的碎料瞬間就被彈出作用範圍——
     畫面上是機器周圍一圈空地、鏟子前面什麼都沒有，完全不像在推。

     量「一幀最多位移多少」最能抓到這件事：被推的話一幀頂多動一點點（車速×dt），
     被彈開的話會一次跳好幾格。只看整地前後的分布是看不出來的。 */
  const dozStep = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '新天鵝堡');
    targetCnt = 1400; setWorkerCount(4); startBuild(true); completeNow();
    for (const b of blocks) if (b.st === 3) freeBlock(b);
    for (let i = 0; i < 140; i++) step(0.05);
    startClear();
    let worst = 0, samples = 0, big = 0, dt = 0.02;
    for (let i = 0; i < 500 && phase === 'clear'; i++) {
      const was = blocks.map(b => ({ st: b.st, x: b.x, z: b.z }));
      step(dt);
      for (let k = 0; k < blocks.length; k++) {
        const b = blocks[k], w = was[k];
        if (b.st !== 0 || w.st !== 0) continue;       // 只看一直是落定碎塊的那些
        const d = Math.hypot(b.x - w.x, b.z - w.z);
        if (d > worst) worst = d;
        if (d > 1e-6) samples++;
        if (d > 0.5) big++;
      }
    }
    return { worst: +worst.toFixed(3), samples, big, cap: +(6.5 * dt).toFixed(3),
             frac: samples ? +(big / samples).toFixed(4) : 1 };
  });
  /* 單幀上限這樣算：跟著車子走 0.13 ＋ 擠開 0.12 ＋ 落到鏟面後被拉回前緣最多 0.7
     ＋ 車頭轉動時鏟面掃過的橫向量最多 0.22 ≈ 1.2，所以門檻放 1.4。
     真正的判別靠 frac（超過半格的比例）：現在 0.3%，每幀 separate 是 8.4%。 */
  ok('碎料是被推著走，不是被彈開的',
     dozStep.samples > 200 && dozStep.worst < 1.4 && dozStep.frac < 0.02,
     '全程 ' + dozStep.samples + ' 次位移，單幀最大 ' + dozStep.worst + '、超過半格的占 ' +
     (dozStep.frac * 100).toFixed(2) + '%（車子一幀走 ' + dozStep.cap +
     '；改用每幀 separate 的話是 2.9 與 8.4%）');

  const dozeSkip = await page.evaluate(() => {
    startBuild(true);
    return { phase, doz: !!dozers };
  });
  ok('開場那一座不用整地', dozeSkip.phase === 'build' && !dozeSkip.doz,
     'phase=' + dozeSkip.phase + '、推土機 ' + (dozeSkip.doz ? '有' : '沒有'));

  /* ══════════ 小人反應 ══════════ */
  await head('小人反應');
  await reset(page, { shape: '吉薩金字塔', cnt: 500, workers: 20 });
  await sim(page, 400);
  const scare = await page.evaluate(() => {
    /* 要砸在「有積木、旁邊又有小人」的地方。隨便挑一個小人往腳下砸的話，
       他可能正在遠處的料堆撿貨，一塊都打不到——沒打到就不會有人被嚇到，
       測到的是「打空了」不是「不會嚇到人」。 */
    let best = null, guard = 0;
    while (guard++ < 400) {
      best = null;
      const set = blocks.filter(b => b.st === 3);
      for (const w of workers) {
        if (w.fall > 0) continue;
        for (const b of set) {
          const d = Math.hypot(b.x - w.x, b.z - w.z);
          if (!best || d < best.d) best = { d, b };
        }
      }
      if (best && best.d < 4) break;      // 等到真的有人站在建築旁邊再砸
      step(0.05);
    }
    const p = new THREE.Vector3(best.b.x, best.b.y, best.b.z);
    const carried = blocks.filter(b => b.st === 1).length;
    const n = smash(p, new THREE.Vector3(0, -1, 0));
    return { n, near: +best.d.toFixed(1),
             fallen: workers.filter(x => x.fall > 0).length, carriedBefore: carried,
             carriedAfter: blocks.filter(b => b.st === 1).length };
  });
  ok('衝擊附近的小人會被嚇倒', scare.fallen > 0,
     scare.fallen + ' 人跌倒（打飛 ' + scare.n + ' 塊，最近的小人距落點 ' + scare.near + '）');
  ok('跌倒時手上的積木會掉', scare.carriedAfter <= scare.carriedBefore,
     '搬運中 ' + scare.carriedBefore + ' → ' + scare.carriedAfter);
  const recover = await page.evaluate(() => {
    for (let i = 0; i < 200; i++) step(0.05);
    return { fallen: workers.filter(x => x.fall > 0).length,
             busy: workers.filter(x => x.st !== 'idle').length };
  });
  ok('跌倒的小人會爬起來繼續做', recover.fallen === 0 && recover.busy > 0,
     '還躺著 ' + recover.fallen + ' 人，工作中 ' + recover.busy + ' 人');

  const poke = await page.evaluate(() => {
    // 找一個正在搬東西的小人，直接戳他
    const i = workers.findIndex(w => w.carry && w.fall <= 0);
    if (i < 0) return { skip: true };
    const w = workers[i];
    const before = blocks.filter(b => b.st === 1).length;
    w.fall = 1.5; releaseWorker(w);
    return { skip: false, fall: w.fall > 0, carried: before, after: blocks.filter(b => b.st === 1).length };
  });
  ok('戳正在搬運的小人會跌倒並掉落積木',
     poke.skip || (poke.fall && poke.after < poke.carried),
     poke.skip ? '（這輪沒有人在搬運，略過）' : poke.carried + ' → ' + poke.after);

  /* 倒下就躺平（v1.60）。以前只倒到 0.44π（79°），停在一個「快躺平又還撐著」的角度。
     而且是往後仰躺：往前趴的話帽舌、鼻尖那幾塊會插進草地。躺平之後身體落在草皮
     那一層，所以 engine 要照傾角把人抬起半個身厚——這裡量的是每一塊部位的**底面**
     （不是中心），一塊都不能低於草皮。 */
  const flat = await page.evaluate(() => {
    const m = new THREE.Matrix4(), v = new THREE.Vector3();
    // 這一塊畫出來的世界範圍：底面 = 中心 − 半高（半高照旋轉後的三根軸算）
    const span = () => {
      let lowest = Infinity, high = -Infinity, len = 0;
      for (let k = 0; k < ENG.WPARTS; k++) {
        ENG.three.workerMesh.getMatrixAt(k, m);
        const e = m.elements;
        if (e[0] === 0 && e[5] === 0) continue;            // 沒拿的道具縮成 0
        v.setFromMatrixPosition(m);
        const hy = 0.5 * (Math.abs(e[1]) + Math.abs(e[5]) + Math.abs(e[9]));
        lowest = Math.min(lowest, v.y - hy);
        high = Math.max(high, v.y + hy);
        len = Math.max(len, Math.abs(v.z));                // 躺平之後身體是沿著 z 攤開的（a=0）
      }
      return { lowest: +lowest.toFixed(3), high: +high.toFixed(2), len: +len.toFixed(2) };
    };
    const w = workers[0];
    Object.assign(w, { x: 0, y: 0, z: 0, a: 0, air: 0, burn: 0, roll: 0, flee: 0,
                       tilt: 0, gait: 0, fall: 1.5, st: 'idle' });
    releaseWorker(w);
    w.fall = 1.5;
    for (let i = 0; i < 20; i++) step(0.05);              // 一秒：倒下去的過渡跑完
    const tilt = w.tilt;
    ENG.putWorker(0, w);
    const down = span();
    ENG.putWorker(0, Object.assign({}, w, { tilt: 0, fall: 0 }));   // 站直的同一個人當對照
    const up = span();
    return { deg: +(tilt * 180 / Math.PI).toFixed(1), down, up };
  });
  ok('被戳倒的小人躺成水平（往後仰躺）',
     Math.abs(flat.deg + 90) < 1.5 && flat.down.len > flat.up.high * 0.5 &&
     flat.down.high < flat.up.high * 0.65,
     '傾角 ' + flat.deg + '°（舊版停在 −79°），身體攤開 ' + flat.down.len +
     '、最高只剩 ' + flat.down.high + '（站直時高 ' + flat.up.high + '）');
  // 站直時鞋底本來就壓進草皮 0.005（看起來才像踩在地上），躺平不該比那個更深
  ok('躺平之後一塊都沒埋進草地', flat.down.lowest >= flat.up.lowest,
     '最低的部位底面在 y=' + flat.down.lowest + '（0 是草皮；站直時是 ' + flat.up.lowest + '）');

  /* 手上的積木被波及時要真的脫手：解除跟小人的綁定、回到散落佇列、掉到地上。
     上面兩條只比了「搬運中的總數有沒有變少」，那個 <= 永遠成立，證不到單一塊的下場。 */
  const unpar = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '新天鵝堡');
    targetCnt = 900; setWorkerCount(20); startBuild(true);
    for (let i = 0; i < 400; i++) step(0.05);
    // 逃命會讓人提早脫手，這裡要驗的是「被炸到才脫手」那條路徑，先關掉
    const orig = alertFlee; alertFlee = () => {};
    const held = [];
    for (let i = 0; i < workers.length; i++)
      for (const j of workers[i].load)
        if (blocks[j.b].st === 1 || blocks[j.b].st === 2) held.push({ w: i, b: j.b });
    explode({ x: 0, y: 3, z: 0 }, 40, 30);
    alertFlee = orig;
    let stuck = 0, holder = 0, slot = 0;
    for (const o of held) {
      const b = blocks[o.b];
      if (b.st === 1 || b.st === 2) stuck++;                 // 還黏在手上
      if (b.holder >= 0) holder++;                           // 還記著是誰拿的
      if (b.slot >= 0) slot++;                               // 還占著藍圖格子
    }
    const hands = held.filter(o => workers[o.w].load.length || workers[o.w].carry).length;
    for (let i = 0; i < 40; i++) step(0.05);
    /* 兩秒後的下場。**「回到散落佇列」不等於「還躺在地上」**：這兩秒場上有 20 個人在
       工作，掉在他們腳邊的積木很快就被撿走了——而撿得起來本身就是「真的變回散料」的
       證據（認領走的一律是 FREE 的那些）。所以分兩堆數：躺在地上的，以及已經被重新
       撿走／重新丟向格子的。
       只驗「全部躺在地上」會紅得很隨機：同條件抽 20 輪（每輪 12～28 塊在手上），
       全部躺著的只有 2 輪，最差的一輪只剩 6/13 躺著；而「躺著 ＋ 重新進了工序」
       20 輪都是 100%（重新被撿走 62 塊、重新被丟向格子 8 塊，沒有第三種下場）。 */
    const landed = held.filter(o => blocks[o.b].st === 0).length;   // FREE＝躺在地上的散料
    const again = held.filter(o => {
      const b = blocks[o.b];
      if (b.st === 0) return false;
      // 被人重新撿走了（在某個人的工作單上），或是已經被重新丟向某個格子
      return workers.some(w => w.load.some(j => j.b === o.b)) || (b.st === 2 && b.slot >= 0);
    }).length;
    return { n: held.length, stuck, holder, slot, hands, landed, again };
  });
  ok('被炸到時手上的積木會脫手、掉回散落佇列',
     unpar.n > 0 && unpar.stuck === 0 && unpar.holder === 0 && unpar.slot === 0 &&
     unpar.hands === 0 && unpar.landed + unpar.again === unpar.n,
     unpar.n + ' 塊在手上：黏著不放的 ' + unpar.stuck + ' 塊、還記著持有人的 ' + unpar.holder +
     ' 塊、還占著格子的 ' + unpar.slot + ' 塊；兩秒後躺在地上的 ' + unpar.landed +
     ' 塊、被重新撿走／丟向格子的 ' + unpar.again + ' 塊');

  /* ══════════ 逃命 ══════════ */
  await head('逃命');
  /* 核彈有 2.8 秒倒數、魔法陣有 6 秒——預告一出現，範圍內的人就該丟下東西往外跑。
     對照組把 alertFlee 換成空的，量「沒這個機制會被炸飛幾個」。 */
  const flee = await page.evaluate(() => {
    const run = on => {
      const orig = alertFlee;
      if (!on) alertFlee = () => {};
      shapePick = SHAPES.findIndex(s => s.n === '新天鵝堡');
      targetCnt = 900; setWorkerCount(20); startBuild(true);
      for (let i = 0; i < 400; i++) step(0.05);
      const near = workers.filter(w => Math.hypot(w.x, w.z) < NUKE_R);
      const d0 = near.map(w => Math.hypot(w.x, w.z));
      callNuke({ x: 0, z: 0 });
      const fleeing = workers.filter(w => w.flee > 0).length;
      // 預告期間不該有人還搬著積木、還占著格子；而且要越跑越遠
      let carry = 0, slot = 0, back = 0, maxPh = 0, prev = d0.slice();
      for (let i = 0; i < 60 && nukes; i++) {
        step(0.05);
        for (let k = 0; k < near.length; k++) {
          const w = near[k];
          if (w.flee <= 0) continue;
          if (w.carry) carry++;
          if (w.load.length) slot++;
          const d = Math.hypot(w.x - 0, w.z - 0);
          if (d < prev[k] - 1e-6) back++;               // 往爆心跑＝方向錯了
          prev[k] = d;
        }
      }
      for (const w of near) if (w.gait > maxPh) maxPh = w.gait;
      for (let i = 0; i < 4; i++) step(0.05);
      const escaped = near.filter(w => Math.hypot(w.x, w.z) >= NUKE_R).length;
      const tossed = near.filter(w => w.air).length;
      for (let i = 0; i < 160; i++) step(0.05);
      alertFlee = orig;
      return { near: near.length, fleeing, carry, slot, back, escaped, tossed,
               gained: +(near.reduce((s, w, k) => s + prev[k] - d0[k], 0) / near.length).toFixed(1),
               stuckFlee: workers.filter(w => w.flee > 0).length,
               busy: workers.filter(w => w.st !== 'idle').length };
    };
    const on = run(true), off = run(false);
    /* 遠近各擺十個人，逃不逃得掉就不再看那一輪小人剛好站在哪裡：
       腳程 1.2 倍、倒數 2.8 秒、反應 0.15～0.55 秒 → 跑得動大約 20 單位。
       站在 26 的跑得出半徑 30，站在 4 的跑不到。 */
    const planted = (() => {
      shapePick = SHAPES.findIndex(s => s.n === '新天鵝堡');
      targetCnt = 900; setWorkerCount(20); startBuild(true);
      for (let i = 0; i < 60; i++) step(0.05);
      const far = [], nearW = [];
      workers.forEach((w, i) => {
        releaseWorker(w);
        const a = i / workers.length * Math.PI * 2, r = i % 2 ? 26 : 4;
        w.x = Math.cos(a) * r; w.z = Math.sin(a) * r; w.y = 0;
        (i % 2 ? far : nearW).push(w);
      });
      callNuke({ x: 0, z: 0 });
      // 軌跡彎不彎：起點到終點的直線距離 ÷ 實際走的路程。1 就是直線
      const tr = workers.map(w => ({ w, lx: w.x, lz: w.z, x0: w.x, z0: w.z, run: 0 }));
      for (let i = 0; i < 60 && nukes; i++) {
        step(0.05);
        for (const t of tr) {
          t.run += Math.hypot(t.w.x - t.lx, t.w.z - t.lz);
          t.lx = t.w.x; t.lz = t.w.z;
        }
      }
      const straight = tr.filter(t => t.run > 3)
        .map(t => Math.hypot(t.w.x - t.x0, t.w.z - t.z0) / t.run);
      const rad = workers.map(w => Math.hypot(w.x, w.z)).sort((a, b) => a - b);
      for (let i = 0; i < 4; i++) step(0.05);
      return { farOut: far.filter(w => Math.hypot(w.x, w.z) >= NUKE_R).length,
               farN: far.length, nearOut: nearW.filter(w => Math.hypot(w.x, w.z) >= NUKE_R).length,
               nearN: nearW.length,
               straight: +Math.min(...straight).toFixed(3),
               spread: +(rad[rad.length - 1] - rad[0]).toFixed(1) };
    })();
    /* 魔法陣：六秒預告，圈內的人夠時間全部跑出去。
       **人要自己擺**（v1.133 修間歇性失敗）：本來是「那一輪剛好站在圈內的人」，
       而跑不跑得出半徑 30 同時看兩個骰子——他站得多裡面、加上自己抽的 16～34 跑多遠。
       門檻寫七成，實測就在邊上跳（16 人裡出去 11～13 人 ＝ 69%～81%），69% 那次就掛了。
       改成全部擺在半徑 22：最短的一段 16 也跑得到 38，跑得出去變成**必然**，
       而萬一六秒不夠跑完（這條真正要驗的事）就會馬上現形。
       這是這一段本來就在用的招——爆炸那組的「遠近各擺十個人」同一個道理。 */
    shapePick = SHAPES.findIndex(s => s.n === '新天鵝堡');
    targetCnt = 900; setWorkerCount(20); startBuild(true);
    for (let i = 0; i < 400; i++) step(0.05);
    workers.forEach((w, i) => {
      releaseWorker(w);
      const a = i / workers.length * Math.PI * 2;
      w.x = Math.cos(a) * 22; w.z = Math.sin(a) * 22; w.y = 0;
    });
    const inRing = workers.filter(w => Math.hypot(w.x, w.z) < MAG_R);
    const ring0 = inRing.map(w => ({ x: w.x, z: w.z }));
    castMagic({ x: 0, z: 0 });
    const magFlee = workers.filter(w => w.flee > 0).length;
    for (let i = 0; i < 130 && magics; i++) step(0.05);
    const magOut = inRing.filter(w => Math.hypot(w.x, w.z) >= MAG_R).length;
    const magFar = Math.max(...inRing.map(w => Math.hypot(w.x, w.z)));
    // 各自跑了多遠（起點到終點的直線距離，路線本來就是直的）
    const runs = inRing.map((w, k) => Math.hypot(w.x - ring0[k].x, w.z - ring0[k].z));
    return { on, off, planted, mag: { n: inRing.length, fleeing: magFlee, out: magOut,
                                      far: +magFar.toFixed(1),
                                      runMin: +Math.min(...runs).toFixed(1),
                                      runMax: +Math.max(...runs).toFixed(1) } };
  });
  ok('核彈倒數一出現，範圍內的人全部開始逃', flee.on.near > 5 && flee.on.fleeing >= flee.on.near,
     '半徑 30 內有 ' + flee.on.near + ' 人，' + flee.on.fleeing + ' 人進入逃命狀態');
  ok('逃命時會丟下手上的積木、放掉認領的格子',
     flee.on.carry === 0 && flee.on.slot === 0,
     '逃跑期間還搬著積木的有 ' + flee.on.carry + ' 幀、還占著格子的 ' + flee.on.slot + ' 幀');
  ok('跑的方向是背對爆心', flee.on.back === 0,
     '逃跑期間離爆心變近的取樣 ' + flee.on.back + ' 次');
  /* 跑得掉的逃過一劫、跑不掉的照樣被炸飛——腳程只有 1.2 倍就是為了留下這個差別。
     那一輪逃掉幾個很看小人剛好站在哪裡（實測 3～12/20），所以生死的部分改用
     下面「遠近各擺十個」那條驗，這裡只驗「整群人確實往外移動了」。 */
  ok('整群人真的往外跑了一段', flee.on.gained > 12 && flee.off.gained < 3,
     '平均離爆心多出 ' + flee.on.gained + ' 單位（關掉逃命機制只有 ' + flee.off.gained + '）');
  ok('離得夠遠的跑得掉、站在爆心那一帶的跑不掉',
     flee.planted.farOut === flee.planted.farN && flee.planted.nearOut === 0,
     '站在 26 的 ' + flee.planted.farOut + '/' + flee.planted.farN + ' 人逃出半徑 30，' +
     '站在 4 的 ' + flee.planted.nearOut + '/' + flee.planted.nearN + ' 人');
  /* 使用者回報「看起來像跑成一個圓圈」，兩個成因各驗一條：
     方向每幀重算會走成等角螺旋（改成起跑就定死一條直線）、
     安全距離給同一個值會讓所有人停在同一個圓上（改成每人各抽）。 */
  ok('逃跑路線是直的，不會繞著爆心畫圈', flee.planted.straight > 0.97,
     '最彎的一條，直線距離÷實走路程 = ' + flee.planted.straight + '（1 就是直線）');
  ok('停下來的位置不會排成一個圓', flee.planted.spread > 8,
     '停下時離爆心最遠與最近差 ' + flee.planted.spread + ' 單位');
  ok('炸完會回去工作，不會卡在逃命狀態',
     flee.on.stuckFlee === 0 && flee.on.busy > 0,
     '還在逃的 ' + flee.on.stuckFlee + ' 人，回去工作的 ' + flee.on.busy + ' 人');
  /* v1.96 起是「下令那一刻全場都逃」（使用者指定「不用每幀掃，全場都逃命就可以了」）。
     所以連站在預告圈外一大段的人也要起跑。v1.59～v1.95 是「只喊範圍內的人」＋每幀
     重掃預告範圍，因為工地就在爆心上，下令時在圈外的人照樣會往裡面走（去撿料、去放
     積木），走到一半被炸飛看起來像完全沒在反應；全場都逃就不需要那個補丁了。
     這條守的是那個新規則：擺一半的人到圈外 12 格，下令那一刻他們就該全部在逃。 */
  const allFlee = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '新天鵝堡');
    targetCnt = 900; setWorkerCount(24); startBuild(true);
    for (let i = 0; i < 200; i++) step(0.05);
    // 擺到預告圈外很遠的地方：下令那一刻他們明明是安全的
    const outs = workers.slice(0, 12);
    outs.forEach((w, i) => {
      releaseWorker(w);
      const a = i / outs.length * Math.PI * 2;
      w.x = Math.cos(a) * (MAG_R + 12); w.z = Math.sin(a) * (MAG_R + 12); w.y = 0;
    });
    const d0 = outs.map(w => Math.hypot(w.x, w.z));
    castMagic({ x: 0, z: 0 });
    const tagged = outs.filter(w => w.flee > 0).length;
    const all = workers.filter(w => w.flee > 0).length;
    // 逃命一律先脫手（startFlee 的 releaseWorker），這裡順便驗圈外那些人也一樣
    const carry = workers.filter(w => w.carry || w.load.length).length;
    for (let i = 0; i < 130 && magics; i++) step(0.05);
    const gained = outs.reduce((t, w, k) => t + Math.hypot(w.x, w.z) - d0[k], 0) / outs.length;
    for (let i = 0; i < 200; i++) step(0.05);
    const r = { tagged, n: outs.length, all, crew: workers.length, carry,
                gained: +gained.toFixed(1), stuck: workers.filter(w => w.flee > 0).length };
    /* 這一段真的炸了一次魔法陣，留下的煙雲、火星、光環會飄到後面幾段的畫面裡去。
       自己收乾淨再走。 */
    clouds.length = 0; dust.length = 0; hot.length = 0;
    flashes.length = 0; fxRings.length = 0;
    clearFires();
    return r;
  });
  ok('預告一出現，連站在範圍外的人也一起逃',
     allFlee.tagged === allFlee.n && allFlee.all === allFlee.crew &&
     allFlee.carry === 0 && allFlee.gained > 8 && allFlee.stuck === 0,
     '站在預告圈外 12 格的 ' + allFlee.n + ' 人全部起跑（' + allFlee.tagged + ' 人），全場 ' +
     allFlee.crew + ' 人都在逃（' + allFlee.all + ' 人），還搬著積木的 ' + allFlee.carry +
     ' 人；圈外那些人又往外跑了 ' + allFlee.gained + ' 單位，最後卡在逃命狀態的 ' +
     allFlee.stuck + ' 人');

  /* 人擺在半徑 22（見上面那段註解），所以「六秒夠不夠跑」是唯一的變數：
     最短的一段 16 也跑得到 38，跑完的人一定在圈外，被時間切掉的一定還在圈內。 */
  ok('魔法陣六秒預告，圈內的人來得及跑',
     flee.mag.n > 5 && flee.mag.fleeing >= flee.mag.n && flee.mag.out === flee.mag.n,
     '圈內 ' + flee.mag.n + ' 人全部起跑，跑出半徑 30 的有 ' + flee.mag.out +
     ' 人（最遠 ' + flee.mag.far + '）');
  /* 小人不會知道這一發的威力範圍到哪裡，所以每個人是「自己抽一段距離跑完就停」，
     不是「跑到安全半徑」。驗的是那段距離真的因人而異、而且落在設定的區間裡。 */
  ok('每個人跑的距離不一樣，跟爆炸半徑無關',
     flee.mag.runMin >= 15 && flee.mag.runMax <= 35 &&
     flee.mag.runMax - flee.mag.runMin > 6,
     '圈內的人各跑了 ' + flee.mag.runMin + '～' + flee.mag.runMax + ' 單位（設定 16～34）');

  /* ══════════ 破壞道具與解鎖 ══════════ */
  await head('破壞道具與解鎖');
  /* v1.168 起門檻是**算出來的**（第 n 把破壞道具＝擊飛 n × LOCK_STEP 塊），
     所以這一段整個照 TOOLS 生出來、不寫死任何一把的名字或數字——
     加一把新道具不必回來改這裡（使用者：「不要每次新增就要改」）。 */
  const lock0 = await page.evaluate(() => {
    stats = freshStats(); renderTools();
    return {
      ids: TOOLS.map(t => t.id),
      free: TOOLS.filter(t => !t.lock).map(t => t.id),
      need: TOOLS.filter(t => t.lock).map(t => t.lock.need),
      txt: TOOLS.filter(t => t.lock).map(t => t.lock.txt),
      step: LOCK_STEP,
      uniq: new Set(TOOLS.map(t => t.id)).size,
      full: TOOLS.filter(t => t.id && t.n && t.k && t.tip).length,
      ok: TOOLS.map(t => toolOk(t)),
      btn: [...document.querySelectorAll('.tool')].map(e => e.className.indexOf('lock') >= 0 ? 'lock' : 'open')
    };
  });
  const NTOOL = lock0.ids.length;
  const openStr = open => lock0.ids.map(id => String(open.indexOf(id) >= 0)).join(',');
  ok('每一種道具都有 id、名字、圖示與說明，而且 id 不重複',
     lock0.full === NTOOL && lock0.uniq === NTOOL,
     NTOOL + ' 種：' + lock0.ids.join(','));
  ok('畫面上的工具鈕跟道具表一樣多', lock0.btn.length === NTOOL,
     lock0.btn.length + ' 顆鈕 / ' + NTOOL + ' 種道具');
  /* 手指與水桶不破壞任何東西，槌子是起手用的：這三把沒有鎖，其餘一律要解。 */
  ok('一開始只有手指、水桶跟槌子可用',
     lock0.ok.join(',') === openStr(lock0.free) &&
     lock0.free.join(',') === 'finger,bucket,hammer',
     '免解鎖的是 ' + lock0.free.join('、'));
  ok('鎖住的工具在畫面上也是鎖住的',
     lock0.btn.join(',') === lock0.ids.map(id => lock0.free.indexOf(id) >= 0 ? 'open' : 'lock').join(','),
     lock0.btn.join(','));
  ok('解鎖門檻是等差：第 n 把破壞道具就是 n × ' + lock0.step + ' 塊',
     lock0.need.length === NTOOL - lock0.free.length &&
     lock0.need.every((v, i) => v === (i + 1) * lock0.step),
     lock0.need.join('／') + '（最後一把 ' + lock0.txt[lock0.txt.length - 1] + '）');

  /* 每一把都獨立驗兩次：差一塊還鎖著、到了門檻就開，而且**只**開到那一把
     （後面的不能被順便開掉）。每次都從乾淨的紀錄重設，不一路往上疊。 */
  const lock1 = await page.evaluate(() => {
    const rows = [];
    const shot = s => {
      stats = freshStats(); stats.smashed = s; renderTools();
      return TOOLS.filter(t => toolOk(t)).map(t => t.id);
    };
    const locked = TOOLS.filter(t => t.lock);
    const free = TOOLS.filter(t => !t.lock).map(t => t.id);
    for (let i = 0; i < locked.length; i++) {
      const need = locked[i].lock.need;
      const want = free.concat(locked.slice(0, i).map(t => t.id));          // 到門檻前該開的
      rows.push({ id: locked[i].id, need,
                  before: shot(need - 1).join(','), wantBefore: want.join(','),
                  after: shot(need).join(','), wantAfter: want.concat(locked[i].id).join(',') });
    }
    const top = locked[locked.length - 1].lock.need;
    stats = freshStats(); stats.smashed = top; renderTools();               // 全開
    return { rows, all: TOOLS.every(t => toolOk(t)), top,
             btn: [...document.querySelectorAll('.tool')].map(e => e.className.indexOf('lock') >= 0 ? 'lock' : 'open') };
  });
  const lockBad = lock1.rows.filter(r => r.before !== r.wantBefore || r.after !== r.wantAfter);
  ok('每一把都卡在自己那一格：差一塊還鎖著，到了就開，而且不會順便開掉後面的',
     lockBad.length === 0 && lock1.rows.length === lock0.need.length,
     lock1.rows.length + ' 把逐一驗過' +
     (lockBad.length ? '；**對不上的：' +
        lockBad.map(r => r.id + '(' + r.need + ')　' + r.before + ' → ' + r.after).join('｜') + '**' : ''));
  ok('推到最後一格就全開', lock1.all, '擊飛 ' + lock1.top + ' 塊');
  ok('解鎖後畫面上的鎖頭消失',
     lock1.btn.join(',') === Array(NTOOL).fill('open').join(','), lock1.btn.join(','));

  /* 手指：什麼都不破壞，但戳得倒小人 */
  await reset(page, { shape: '吉薩金字塔', cnt: 700, workers: 12 });
  const finger = await page.evaluate(() => {
    completeNow();
    tool = 'finger';
    const n0 = placedCnt;
    const cand = blocks.filter(b => b.st === 3);
    const t = cand[Math.floor(cand.length * 0.5)];
    useTool({ point: new THREE.Vector3(t.x, t.y, t.z), dir: new THREE.Vector3(0, -1, 0) });
    for (let i = 0; i < 60; i++) step(0.05);
    const after = placedCnt;
    // 小人還是戳得倒（那段邏輯在道具判斷之前）
    const w = workers.find(x => x.fall <= 0);
    const before = stats.poked;
    w.fall = 1.5; releaseWorker(w); stats.poked++;
    return { n0, after, phase, fell: w.fall > 0, poked: stats.poked - before };
  });
  ok('手指不會破壞任何東西', finger.after === finger.n0 && finger.phase === 'done',
     placedCntTxt(finger.n0, finger.after) + '，phase 仍是 ' + finger.phase);
  ok('手指模式下小人照樣戳得倒', finger.fell && finger.poked === 1);

  /* 大槌：同樣一擊，範圍要明顯比一般槌子大 */
  const bigH = await page.evaluate(() => {
    const run = big => {
      startBuild(true); completeNow();
      const cand = blocks.filter(b => b.st === 3 && b.y > 3);
      const t = cand[Math.floor(cand.length * 0.5)];
      const n0 = placedCnt;
      launchHammer(new THREE.Vector3(t.x, t.y, t.z), new THREE.Vector3(0.3, -0.85, 0.4).normalize(), big);
      let g = 0;
      while (swing && !swing.hit && g++ < 40) step(0.02);
      return n0 - placedCnt;
    };
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 2000;
    return { small: run(false), big: run(true) };
  });
  ok('大槌的範圍明顯比一般槌子大', bigH.big > bigH.small * 2.5,
     '一般槌子打飛 ' + bigH.small + ' 塊、大槌 ' + bigH.big + ' 塊');

  /* 小槌收小（v1.165，使用者：「槌子　減小一點破壞範圍（可能打約 0.8~0.5 之間）」）。
     兩件事一起驗，因為大槌本來是寫成「小槌 × 2」——照那樣改的話大槌會被連帶縮小，
     而這次使用者指名要改的只有小槌：
     ① 小槌的半徑落在舊值（5.5）的 0.5～0.8 倍之間；
     ② 大槌的半徑仍然是 11（＝舊的 5.5 × 2），同一點下去打掉的塊數也對得上。 */
  const hamR = await page.evaluate(() => {
    const OLD = 5.5;
    const one = R => {
      cleanTools(); startBuild(true); completeNow();
      const set = blocks.filter(b => b.st === 3);
      let hi = 0; for (const b of set) if (b.y > hi) hi = b.y;
      let p = null, far = -1;
      for (const b of set) {
        if (Math.abs(b.y - hi * 0.4) > 0.6) continue;
        const d = Math.hypot(b.x, b.z); if (d > far) { far = d; p = b; }
      }
      const n0 = set.length;
      smash({ x: p.x, y: p.y, z: p.z }, { x: 0.2, y: -0.94, z: 0.2 }, R, hammerPow);
      return n0 - blocks.filter(b => b.st === 3).length;
    };
    shapePick = SHAPES.findIndex(s => s.n === '帝國大廈'); targetCnt = 3000;
    const r = { small: hammerR, big: BIG_R, old: OLD,
                cutNow: one(hammerR), cutOld: one(OLD), cutBig: one(BIG_R) };
    cleanTools(); shapePick = -1;
    return r;
  });
  ok('槌子的範圍收小了，大槌沒被連帶縮小',
     hamR.small >= hamR.old * 0.5 && hamR.small <= hamR.old * 0.8 &&
     Math.abs(hamR.big - hamR.old * 2) < 0.01 && hamR.cutNow < hamR.cutOld * 0.5,
     '小槌半徑 ' + hamR.old + ' → ' + hamR.small + '（' +
     (hamR.small / hamR.old).toFixed(2) + ' 倍）：同一點打掉 ' + hamR.cutOld +
     ' → ' + hamR.cutNow + ' 塊；大槌仍是 ' + hamR.big + '（打掉 ' + hamR.cutBig + ' 塊）');

  /* 投石機 */
  await reset(page, { shape: '新天鵝堡', cnt: 1200, workers: 3 });
  const treb = await page.evaluate(() => {
    completeNow();
    const n0 = placedCnt;
    // 點在空地上：機台就該出現在那裡
    const spot = { x: siteR + 14, z: -siteR * 0.4 };
    placeTreb(spot);
    const one = trebs.list.length;
    const at = trebs.list[0];
    const put = Math.hypot(at.x - spot.x, at.z - spot.z);
    // 再點一台，數量要疊加
    placeTreb({ x: -siteR - 12, z: siteR * 0.3 });
    const two = trebs.list.length;
    // 點在建築正中央：要被推到建築外圍，不能長在牆裡
    placeTreb({ x: 0, z: 0 });
    const pushed = Math.hypot(trebs.list[2].x, trebs.list[2].z);
    let maxRock = 0, offCentre = 0;
    for (let i = 0; i < 1400 && trebs; i++) {
      step(0.02);
      if (trebs) {
        maxRock = Math.max(maxRock, trebs.rocks.length);
        for (const r of trebs.rocks) if (Math.hypot(r.x, r.z) > arenaR + 5) offCentre++;
      }
    }
    return { n0, after: placedCnt, one, two, put, pushed, siteR, maxRock, gone: !trebs, offCentre };
  });
  ok('點一下就在點的位置架一台', treb.one === 1 && treb.put < 0.001,
     '機台落在點擊處，誤差 ' + treb.put.toFixed(3));
  ok('可以連續架好幾台', treb.two === 2, treb.two + ' 台');
  ok('點在建築上會把機台推到外圍', treb.pushed > treb.siteR,
     '距中心 ' + treb.pushed.toFixed(1) + '（建築半徑 ' + treb.siteR.toFixed(1) + '）');
  ok('投石機會丟出石頭', treb.maxRock > 0, '同時最多 ' + treb.maxRock + ' 顆在空中');
  ok('石頭不會飛出場外', treb.offCentre === 0);
  ok('石頭砸下來會造成破壞', treb.after < treb.n0, placedCntTxt(treb.n0, treb.after));
  ok('打完會自己撤走', treb.gone);

  /* 石頭穿牆：只在終點判定的話，拋物線會從屋頂／外牆直接穿過去，畫面上砸中了卻什麼事都沒有。
     這裡不看實作的格子查表，改用 blocks 的真實座標量：
     還活著的石頭跟任何一塊已就位積木的距離，永遠不該小於半格。 */
  await reset(page, { shape: '新天鵝堡', cnt: 1600, workers: 3 });
  const thru = await page.evaluate(() => {
    completeNow();
    const orig = rockHit, at = [];
    rockHit = r => { at.push(+(r.t / r.T).toFixed(2)); orig(r); };
    for (let k = 0; k < 6; k++) {           // 圍一圈打，各種角度的弧線都試到
      const a = k / 6 * Math.PI * 2;
      placeTreb({ x: Math.cos(a) * (siteR + 13), z: Math.sin(a) * (siteR + 13) });
    }
    let worst = 1e9, worstAt = null, seen = 0, frames = 0;
    for (let i = 0; i < 2000 && trebs; i++) {
      step(0.02); frames++;
      if (!trebs) break;
      for (const r of trebs.rocks) {
        seen++;
        for (const b of blocks) {
          if (b.st !== 3) continue;
          const d = Math.max(Math.abs(b.x - r.x), Math.abs(b.y - r.y), Math.abs(b.z - r.z));
          if (d < worst) { worst = d; worstAt = { rock: [+r.x.toFixed(2), +r.y.toFixed(2), +r.z.toFixed(2)],
                                                  block: [+b.x.toFixed(2), +b.y.toFixed(2), +b.z.toFixed(2)], i }; }
        }
      }
    }
    rockHit = orig;
    return { worst: +worst.toFixed(3), worstAt, seen, frames, shots: at.length,
             early: at.filter(v => v < 0.97).length, at: at.slice(0, 8) };
  });
  ok('石頭不會從積木裡穿過去', thru.seen > 0 && thru.worst >= 0.499,
     '飛行中最近曾貼到 ' + thru.worst + ' 格（積木半邊 0.5）；取樣 ' + thru.seen +
     ' 個石頭幀' + (thru.worst < 0.499 ? '；' + JSON.stringify(thru.worstAt) : ''));
  ok('石頭半路撞到建築就當場炸開', thru.early > 0,
     thru.shots + ' 發裡有 ' + thru.early + ' 發在抵達目標前就炸了（飛行進度 ' +
     JSON.stringify(thru.at) + '）');

  const lockClick = await page.evaluate(() => {
    stats = freshStats(); tool = 'hammer'; renderTools();
    document.querySelector('[data-tool="tornado"]').click();   // 鎖著的不該被選到
    const blocked = tool;
    stats.destroyed = 9; stats.smashed = 99999; renderTools();
    document.querySelector('[data-tool="ball"]').click();
    return { blocked, after: tool };
  });
  ok('點鎖住的工具不會被選中', lockClick.blocked === 'hammer', '仍是 ' + lockClick.blocked);
  ok('解鎖後點得動', lockClick.after === 'ball', '選到 ' + lockClick.after);

  /* 工具選單平常收在小窗裡，滑鼠指上去才展開。要驗兩件事：
     收著的時候那塊區域是「透明的」（點下去要打到畫布，不能擋操作），
     以及小窗顯示的一定是現在拿的那把。 */
  await page.evaluate(() => { stats.destroyed = 18; stats.smashed = 60000; tool = 'hammer'; renderTools(); });
  const menuIdle = await page.evaluate(() => {
    const r = document.getElementById('tools').getBoundingClientRect();
    const mid = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { menu: getComputedStyle(document.getElementById('toolMenu')).visibility,
             now: getComputedStyle(document.getElementById('toolNow')).visibility,
             hit: mid ? mid.tagName : '—',
             label: document.getElementById('toolNow').textContent.replace(/\s+/g, ''),
             cur: document.getElementById('toolNow').dataset.cur };
  });
  ok('平常只看得到「現在拿什麼」的小窗，選單是收著的',
     menuIdle.menu === 'hidden' && menuIdle.now === 'visible',
     '小窗 ' + menuIdle.now + '、選單 ' + menuIdle.menu + '，小窗寫著「' + menuIdle.label + '」');
  ok('收著的選單不會擋住畫面', menuIdle.hit === 'CANVAS',
     '選單那塊區域點下去打到 ' + menuIdle.hit);

  await page.hover('#toolNow');
  await page.waitForTimeout(200);
  const menuOpen = await page.evaluate(() => ({
    menu: getComputedStyle(document.getElementById('toolMenu')).visibility,
    n: document.querySelectorAll('#tools .tool').length,
    on: [...document.querySelectorAll('#tools .tool.on')].map(e => e.dataset.tool).join(',')
  }));
  ok('滑鼠指到小窗才展開整份選單',
     menuOpen.menu === 'visible' && menuOpen.n === NTOOL && menuOpen.on === 'hammer',
     '展開後 ' + menuOpen.n + ' 個按鈕，標成「使用中」的是 ' + menuOpen.on);

  await page.click('#tools [data-tool="tornado"]');
  const picked = await page.evaluate(() => ({
    tool, cur: document.getElementById('toolNow').dataset.cur,
    label: document.getElementById('toolNow').textContent.replace(/\s+/g, ''),
    open: document.getElementById('toolbox').classList.contains('open')
  }));
  ok('選了哪把，小窗就換成哪把', picked.tool === 'tornado' && picked.cur === 'tornado' &&
     picked.label.indexOf('龍捲風') >= 0, '小窗寫著「' + picked.label + '」');
  /* 選完就收，不必先把滑鼠移開（v1.123，使用者：「選擇工具點擊後 就可以把工具清單
     收起來 目前要把滑鼠移開才會收」）。上面那一下 page.click 之後**指標還停在剛點的
     那顆按鈕上**，這裡就在那個狀態下量：以前只拿掉 .open，CSS 的 `#toolbox:hover`
     還按著選單，量到的會是 visible。
     第二條是配套：收起來之後滑鼠指回小窗仍然要叫得出選單（.shut 沒被留著）。 */
  const shutNow = await page.evaluate(() =>
    getComputedStyle(document.getElementById('toolMenu')).visibility);
  await page.mouse.move(900, 500);
  await page.hover('#toolNow');
  await page.waitForTimeout(200);
  const reopen = await page.evaluate(() =>
    getComputedStyle(document.getElementById('toolMenu')).visibility);
  ok('選完工具，滑鼠不用移開選單就收起來', shutNow === 'hidden',
     '點完那一瞬間選單是 ' + shutNow + '（指標還停在剛點的按鈕上）');
  ok('收起來之後滑鼠再指回小窗還是叫得出選單', reopen === 'visible',
     '移開再指回來：選單 ' + reopen);

  /* 觸控沒有 hover：小窗自己要能點開，點畫面別的地方要收起來 */
  const tapMenu = await page.evaluate(() => {
    const box = document.getElementById('toolbox');
    box.classList.remove('open');
    document.getElementById('toolNow').click();
    const opened = box.classList.contains('open');
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    const closed = !box.classList.contains('open');
    document.getElementById('toolNow').click();
    document.querySelector('#tools [data-tool="hammer"]').click();   // 選完也要自己收
    return { opened, closed, afterPick: !box.classList.contains('open'), tool };
  });
  ok('觸控也能用：點小窗展開，點別處或選完就收起來',
     tapMenu.opened && tapMenu.closed && tapMenu.afterPick && tapMenu.tool === 'hammer',
     '點開 ' + tapMenu.opened + '、點別處收起 ' + tapMenu.closed +
     '、選完收起 ' + tapMenu.afterPick);
  await page.evaluate(() => { stats = freshStats(); tool = 'hammer'; renderTools(); });
  /* 滑鼠要移開小窗才算收工。Playwright 的 hover／click 會把指標留在原地，而選單是
     `#toolbox:hover` 開的（不只是 .open 那個 class）——指標停在上面它就一直開著，
     後面每一條「真的用滑鼠點畫面」的測試都會先打到選單。v1.110 把工具搬回上方中央
     之後實際踩到：水桶那兩條點的是金字塔頂端（640,271），剛好落在展開的選單裡。 */
  await page.mouse.move(900, 500);

  await reset(page, { shape: '新天鵝堡', cnt: 1200, workers: 4 });
  const hammerR2 = await page.evaluate(() => {
    completeNow();
    tool = 'hammer';
    const cand = blocks.filter(b => b.st === 3 && b.y > 4);
    const t = cand[Math.floor(cand.length * 0.5)];
    const n0 = placedCnt;
    const dir = new THREE.Vector3(0.4, -0.7, 0.6).normalize();
    useTool({ point: new THREE.Vector3(t.x, t.y, t.z), dir });
    const born = !!swing, immediate = placedCnt;      // 按下當下還不該有破壞
    step(0.07);
    const p = ENG.hammerPos();
    /* 側揮驗證：槌頭要明顯偏在落點的側邊，而不是疊在視線那條直線上。
       取水平方向上「垂直於視線」的分量——那就是螢幕左右方向。 */
    let sx = -dir.z, sz = dir.x;
    const sl = Math.hypot(sx, sz); sx /= sl; sz /= sl;
    const lateral = Math.abs((p.x - t.x) * sx + (p.z - t.z) * sz);
    const along = Math.abs((p.x - t.x) * dir.x + (p.z - t.z) * dir.z);
    const mid = { hit: swing.hit, n: placedCnt, vis: ENG.hammerVisible(), lateral, along, up: p.y - t.y };
    // 推到它確實落下為止，不要寫死秒數——揮動時間調整過就會對不上
    let guard = 0;
    while (swing && !swing.hit && guard++ < 40) step(0.02);
    const landed = { hit: !swing || swing.hit, n: placedCnt, steps: guard };
    for (let i = 0; i < 40; i++) step(0.05);
    return { n0, born, immediate, mid, landed, gone: !swing, vis: ENG.hammerVisible() };
  });
  ok('槌子是從側邊揮下來的（看得出是槌子）',
     hammerR2.mid.lateral > 3 && hammerR2.mid.lateral > hammerR2.mid.along * 2 && hammerR2.mid.up > 2,
     '側向偏移 ' + hammerR2.mid.lateral.toFixed(1) + '、視線方向偏移 ' +
     hammerR2.mid.along.toFixed(1) + '、高於落點 ' + hammerR2.mid.up.toFixed(1));
  ok('選槌子時畫面上真的有槌子揮下去', hammerR2.born && hammerR2.mid.vis,
     '按下後槌子出現在畫面上');
  ok('槌頭落下之前不會有破壞', hammerR2.immediate === hammerR2.n0 && !hammerR2.mid.hit,
     '按下當下 ' + hammerR2.n0 + ' → 揮到一半 ' + hammerR2.mid.n);
  ok('槌頭碰到的那一刻才炸開', hammerR2.landed.hit && hammerR2.landed.n < hammerR2.n0,
     '落下後 ' + hammerR2.n0 + ' → ' + hammerR2.landed.n + '（多推了 ' + hammerR2.landed.steps + ' 步）');
  ok('揮完槌子會收掉', hammerR2.gone && !hammerR2.vis);

  const rapid = await page.evaluate(() => {
    startBuild(true); completeNow();
    const n0 = placedCnt;
    const cand = blocks.filter(b => b.st === 3);
    const a = cand[Math.floor(cand.length * 0.3)], c = cand[Math.floor(cand.length * 0.75)];
    launchHammer(new THREE.Vector3(a.x, a.y, a.z), new THREE.Vector3(0.2, -0.9, 0.3).normalize());
    step(0.03);
    launchHammer(new THREE.Vector3(c.x, c.y, c.z), new THREE.Vector3(-0.2, -0.9, -0.3).normalize());
    const afterSecondPress = placedCnt;
    for (let i = 0; i < 20; i++) step(0.03);
    return { n0, afterSecondPress, end: placedCnt };
  });
  /* 連點時前一擊還沒落下就被取代 → 那一擊要立刻結算掉，不能整個吃掉 */
  ok('連點兩次不會吃掉前一擊',
     rapid.afterSecondPress < rapid.n0 && rapid.end < rapid.afterSecondPress,
     rapid.n0 + ' → 第二次按下時 ' + rapid.afterSecondPress + ' → 最後 ' + rapid.end);

  /* 大槌砸在空地上：不是點狀衝擊，而是整棟震一震，隨機一小部分自己掉下來。
     兩件事要分開驗：掉的量對不對、掉的位置是不是散在整棟（不是砸出一個洞）。
     小槌砸空地是另一回事——v1.50 起它一塊都不該掉，跟著一起驗。 */
  const quakeT = await page.evaluate(() => {
    const one = (big) => {
      shapePick = SHAPES.findIndex(s => s.n === '新天鵝堡');
      targetCnt = 2000; startBuild(true); completeNow();
      shapePick = -1;
      const set0 = placedCnt;
      const at = blocks.map(b => b.st === 3 ? { x: b.x, y: b.y, z: b.z } : null);
      dust.length = 0;               // 先清乾淨才量得準（塵霧有 400 顆上限，滿了就不再生）
      const hx = siteR + 9;                          // 建築外的空地
      launchHammer(new THREE.Vector3(hx, 0, 0), new THREE.Vector3(0, -1, 0), big, true);
      let g = 0;
      while (!quake && swing && !swing.hit && g++ < 20) step(0.05);   // 等槌子落下
      const born = !!quake, swung = !!swing && swing.hit, hitFrames = [];
      const dustUp = dust.length;
      let prev = placedCnt;
      while (quake && g++ < 200) {
        step(0.05);
        if (placedCnt < prev) hitFrames.push(prev - placedCnt);
        prev = placedCnt;
      }
      const mid = placedCnt;
      /* 震完之後**分段**量（v1.148.1）：垮塌會收斂（那一片掉完就沒了），
         而「一直掉」是穩定的速率——所以看的是「最後那一秒有沒有停」，
         不是「總共又掉幾塊」。震掉一成之後偶爾會有一整片失去支撐跟著垮
         （實測一次 56 塊，而原本的門檻是 6），那是對的物理，不該算在這一條頭上。 */
      const tail = [];
      for (let k2 = 0; k2 < 6; k2++) {              // 6 段 × 0.5 秒 ＝ 3 秒
        const p0 = placedCnt;
        for (let i = 0; i < 10; i++) step(0.05);
        tail.push(p0 - placedCnt);
      }
      for (let i = 0; i < 40; i++) step(0.05);       // 震完就該停了
      let near = 0, tot = 0, lo = 0, hi = 0;
      blocks.forEach((b, i) => {
        if (!at[i] || b.st === 3) return;
        tot++;
        if (Math.hypot(at[i].x - hx, at[i].z) < 10) near++;   // 掉在槌子那一帶的
        if (at[i].y < bp.height * 0.4) lo++; else hi++;
      });
      return { set0, born, swung, dustUp, fell: set0 - mid, frac: (set0 - mid) / set0,
               waves: hitFrames.length, after: mid - placedCnt, end: placedCnt, tail,
               nearFrac: tot ? near / tot : -1, lo, hi };
    };
    const small = one(false), big = one(true);
    return { small, big, want: QUAKE_FRAC };
  });
  /* 比例跟著 QUAKE_FRAC 走，不寫死 10%（v1.168）：這一條要守的是「有地震、掉的是
     設定的那個量級」，實際調成幾成是可以改的細節。上緣放到 1.8 倍是留給垮塌的連帶。 */
  ok('大槌砸空地會地震，震掉的比例照 QUAKE_FRAC 走',
     quakeT.big.born && quakeT.big.frac > quakeT.want * 0.85 &&
     quakeT.big.frac < quakeT.want * 1.8,
     quakeT.big.set0 + ' 塊掉了 ' + quakeT.big.fell + '（' +
     (quakeT.big.frac * 100).toFixed(1) + '%，設定 ' + (quakeT.want * 100).toFixed(0) + '%）');
  ok('是分好幾波掉的，不是同一幀全掉', quakeT.big.waves >= 4,
     '掉了 ' + quakeT.big.waves + ' 波');
  ok('震掉的散在整棟，不是在槌子那一帶砸出一個洞',
     quakeT.big.nearFrac >= 0 && quakeT.big.nearFrac < 0.35 &&
     quakeT.big.lo > 0 && quakeT.big.hi > 0,
     '落點 10 單位內只占 ' + (quakeT.big.nearFrac * 100).toFixed(0) +
     '%，下半部 ' + quakeT.big.lo + ' 塊、上半部 ' + quakeT.big.hi + ' 塊');
  /* 允許一點餘波：震掉的那批本來就是分批落下的（fallIn 按高度錯開），
     最後一兩塊落地時抽掉鄰居的支撐，連帶再掉一塊是對的物理。
     要擋的是「一直掉」不是「完全不掉」。

     v1.148.1 換掉量法。原本是「震完 2 秒內又掉幾塊 ≤ 6」，門檻照實測訂的
     （十五輪的餘波是 0 0 0 2 0 2 1 3 0 3 0 1 3 1 1，最大 3）——但那十五輪沒抽到尾巴：
     整輪測試量到過一次 **56 塊**。追下去不是地震還在掉（`stepQuake` 在 `q.t <= 0`
     那一幀就把 `quake` 設成 null，之後整支直接 return），是震掉一成之後**有一整片
     失去支撐跟著垮**——那是對的物理，跟這一條要擋的事無關。
     現在改成分段量：垮塌會**收斂**（那一片掉完就沒了），而「一直掉」是穩定的速率，
     所以驗的是「最後那一秒完全停了」。總量照樣印出來當參考。 */
  const qTail = quakeT.big.tail;
  ok('震完就停，不會一直掉', qTail.slice(-2).every(v => v === 0),
     '震完之後每半秒掉了 ' + qTail.join('／') + ' 塊（最後一秒要是 0；' +
     '這 3 秒共 ' + qTail.reduce((a, b) => a + b, 0) + ' 塊，多半是垮塌的餘波）');
  /* 小槌瞄邊角時很容易擦過去點到地面，那一下震掉 5% 等於每失手一次就賠掉一大片 */
  ok('小槌砸空地不會地震，建築一塊都不掉',
     !quakeT.small.born && quakeT.small.end === quakeT.small.set0,
     quakeT.small.set0 + ' 塊 → ' + quakeT.small.end + ' 塊，quake=' + quakeT.small.born);
  ok('但槌子照樣揮下去、地上照樣噴灰塵（不然像點壞了）',
     quakeT.small.swung && quakeT.small.dustUp > 20,
     '揮擊結算 ' + quakeT.small.swung + '，多了 ' + quakeT.small.dustUp + ' 顆塵');

  await reset(page, { shape: '吉薩金字塔', cnt: 900, workers: 4 });
  const ballR = await page.evaluate(() => {
    completeNow();
    const before = blocks.filter(b => b.st === 3).length;
    const p = { x: -42, y: 0, z: 5 };                  // 第一點：場邊的空地
    launchBall(p, { x: 0, z: 0 });                     // 第二點：工地中心
    const born = !!balls, r = balls[0].r;
    const out = { d0: Math.hypot(balls[0].x - p.x, balls[0].z - p.z), y0: balls[0].y };
    let hit = 0, t = 0, settle = 0, hops = 0, apex = 0, moved = 0, maxAng = 0;
    let px = balls[0].x, pz = balls[0].z;
    for (let i = 0; i < 400 && balls; i++) {
      step(0.03); t += 0.03;
      if (!balls) break;
      const o = balls[0];
      hit = o.hit; hops = o.hops; maxAng = o.ang;
      if (o.y > r + 0.01) { settle = t; if (hops >= 1) apex = Math.max(apex, o.y - r); }
      moved += Math.hypot(o.x - px, o.z - pz); px = o.x; pz = o.z;
    }
    return { before, after: blocks.filter(b => b.st === 3).length, hit, born, gone: !balls,
             settle: +settle.toFixed(2), life: +t.toFixed(2), hops, apex, spin: maxAng,
             moved, r, ...out };
  });
  ok('保齡球從你點的地方出手，而且是舉高了丟出去',
     ballR.born && ballR.d0 < 0.01 && ballR.y0 > ballR.r + 3,
     '起點就是落點（差 ' + ballR.d0.toFixed(2) + '），球心離地 ' + ballR.y0.toFixed(1));
  /* 彈跳要在前段結束：球水平 34 單位/秒，一直彈的話它是「飛」到建築上的，
     中間那段滾就不見了。所以除了「有彈」還要驗「什麼時候不再離地」。 */
  ok('像丟保齡球一樣先彈幾下，之後就一路滾',
     ballR.hops >= 2 && ballR.apex > 0.3 && ballR.settle < 1.2 &&
     ballR.life - ballR.settle > 0.5,
     '彈了 ' + ballR.hops + ' 下（第一次落地後還彈起 ' + ballR.apex.toFixed(1) +
     '），' + ballR.settle + ' 秒後不再離地，之後滾了 ' +
     (ballR.life - ballR.settle).toFixed(1) + ' 秒');
  ok('滾動角度跟滾過的距離對得上', Math.abs(ballR.spin - ballR.moved / ballR.r) < 0.5,
     '滾了 ' + ballR.moved.toFixed(0) + ' 單位、轉了 ' + ballR.spin.toFixed(1) + ' 弧度');
  ok('保齡球會撞飛沿路的積木', ballR.hit > 15 && ballR.after < ballR.before,
     'SET ' + ballR.before + ' → ' + ballR.after + '，撞飛 ' + ballR.hit + ' 塊');
  ok('滾不動之後會停下消失', ballR.gone);

  /* 撞完要偏一下方向（v1.123，使用者：「水平移動的碰撞參考 天降鐵球 也要計算碰撞後
     偏移方向」）。用**吉薩金字塔 ＋ 自己組的球**量：金字塔對 z=0 左右對稱，
     球也不走 launchBall（那條會加 ±BALL_SPREAD 的手感偏差），所以整組是可重現的
     ——同一個位移丟四趟，轉出來的角度到小數點後一位都一樣。
     三件事：
     ① 擦到哪一邊就往**反邊**偏（法線是「撞到的積木指向球心」），左右兩組正負相反、
        大小對稱。
     ② **從正中央鑽過去不會歪**：球埋在實心裡的時候四周的積木是均勻的，
        垂直於行進方向的那一半互相抵銷。這一條同時擋住「把整個法線加上去」那種寫法
        ——那樣正面撞牆會被當成煞車，還會把球彈飛。
     ③ 位移 4（還在塔身裡面）也一樣不歪：會不會偏看的是「有沒有擦到邊」，
        不是「離中心多遠」。
     金字塔 3000 塊的半寬是 12，所以 9 剛好擦在斜面上、13 只碰得到牆角。 */
  const ballVeer = await page.evaluate(() => {
    const shot = off => {
      cleanTools();
      shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
      targetCnt = 3000; startBuild(true); completeNow(); shapePick = -1;
      /* 自己組一顆：方向剛好是 +x，不吃 launchBall 的 ±BALL_SPREAD。
         cd 給一個大數＝把 v1.165 的跳彈鎖住（那條有冷卻，見 BALL_CD），
         這一組要量的是 v1.123 的「擦到邊偏一點」，兩條混在一起就分不出是誰做的
         ——跳彈那條自己有一組測試（見〈斜著撞上牆面會跳彈〉）。 */
      balls = [{ x: -70, y: BALL_R, z: off, vx: 34, vz: 0, vy: 0,
                 r: BALL_R, ang: 0, hit: 0, life: BALL_LIFE, hops: 2, ax: 1, az: 0,
                 cd: 999, pin: 0 }];
      let a = 0, hit = 0, pin = 0;
      for (let i = 0; i < 500 && balls; i++) {
        step(0.03);
        if (!balls) break;
        a = Math.atan2(balls[0].vz, balls[0].vx); hit = balls[0].hit; pin = balls[0].pin;
      }
      return { turn: +(a * 180 / Math.PI).toFixed(1), hit, pin };
    };
    const r = { mid: shot(0), in4: shot(4), right: shot(9), left: shot(-9),
                half: Math.max(...bp.slots.map(q => Math.abs(q.z))),
                veer: BALL_VEER, brake: BALL_BRAKE, min: BALL_BRAKE_MIN };
    cleanTools();
    return r;
  });
  ok('保齡球擦過建築側面會被推向外側，左右對稱',
     ballVeer.right.turn > 5 && ballVeer.left.turn < -5 &&
     Math.abs(ballVeer.right.turn + ballVeer.left.turn) < 3 &&
     ballVeer.right.hit > 50 && ballVeer.right.pin === 0,
     '擦右邊轉 ' + ballVeer.right.turn + '°、擦左邊 ' + ballVeer.left.turn +
     '°（各撞掉 ' + ballVeer.right.hit + '／' + ballVeer.left.hit +
     ' 塊，塔身半寬 ' + ballVeer.half + '）');
  ok('從實心裡面鑽過去不會被推歪',
     Math.abs(ballVeer.mid.turn) < 1 && Math.abs(ballVeer.in4.turn) < 1 &&
     ballVeer.mid.hit > 200,
     '正中央轉 ' + ballVeer.mid.turn + '°、偏 4 格轉 ' + ballVeer.in4.turn +
     '°（各撞掉 ' + ballVeer.mid.hit + '／' + ballVeer.in4.hit + ' 塊）');
  /* 「稍微降低碰撞後動能減弱的幅度」（v1.123 使用者指定）。這一條直接比對兩條公式：
     行為那一面已經被上面那幾趟與〈空場上滾得完整個工地那麼遠〉守著，
     而「有沒有真的放鬆、又沒有放到停不下來」是這兩個常數自己的事。 */
  const ballBrake = [10, 30, 60, 120].map(n => ({
    n,
    now: +Math.max(ballVeer.min, 1 - n * ballVeer.brake).toFixed(3),
    old: +Math.max(0.3, 1 - n * 0.006).toFixed(3)
  }));
  ok('撞完掉的速度比以前少，但還是會停下來',
     ballBrake.every(b => b.now > b.old && b.now < 1),
     ballBrake.map(b => '撞 ' + b.n + ' 塊保留 ' + b.old + ' → ' + b.now).join('、'));

  /* 斜著撞上牆面要**跳彈**（v1.165，使用者：「上次有說要計算碰撞後平面的移動方向偏移
     沒有實現（目標是更多碰撞變化 像是彈珠檯的彈珠概念）」）。
     上面那條（v1.123 的偏一下）只轉法線垂直於行進方向的那一半，正面撞牆時那一半是 0
     ——所以 v1.164 的球是直直鑿穿過去的：同一組入射線量到的方向變化只有 1°。
     這一條用圓的羅馬競技場、同一個方向（+x）不同位移的五條入射線（自己組球，
     不吃 launchBall 的 ±BALL_SPREAD，可重現），驗三件事：
       ① **正中央那一條照樣鑿穿**（不彈、方向幾乎不變）——一顆 34 單位／秒的鐵球正面
          撞上一片牆，該把牆撞開；把正面也彈掉的話球會在外殼上彈開就跑了，
          實測整趟只撞飛 6 塊（改之前 300 多塊）。
       ② **擦邊的那幾條真的彈開**，方向變化跟 v1.164 的 1° 不是同一個量級。
       ③ **彈開的方向是往外側**（擦右邊往右彈、擦左邊往左彈）。這一條是使用者回報
          「保齡球方向錯了」之後補的：第一版用主軸分解配平面，特徵向量沒有正負，
          「哪一側是材料」判錯就會把球往建築裡面彈（實測擦金字塔右側轉 −21°）。
          現在法線取的是材料分佈的梯度（外圈那一層還沒打掉的積木方向總和取反），
          方向不可能算錯邊。 */
  const ballWall = await page.evaluate(() => {
    const shot = z0 => {
      cleanTools();
      shapePick = SHAPES.findIndex(s => s.n === '羅馬競技場');
      targetCnt = 3000; startBuild(true); completeNow(); shapePick = -1;
      balls = [{ x: -70, y: BALL_R, z: z0, vx: 34, vz: 0,
                 vy: 0, r: BALL_R, ang: 0, hit: 0, life: BALL_LIFE, hops: 2,
                 ax: 1, az: 0, cd: 0, pin: 0, pn: 0 }];
      let a1 = 0, pin = 0, hit = 0;
      for (let i = 0; i < 500 && balls; i++) {
        step(0.03);
        if (!balls) break;
        const o = balls[0];
        if (Math.hypot(o.vx, o.vz) > 1) a1 = Math.atan2(o.vz, o.vx);
        pin = o.pin; hit = o.hit;
      }
      return { z0, pin, hit, turn: +(a1 * 180 / Math.PI).toFixed(0) };
    };
    const r = { mid: shot(0), runs: [shot(9), shot(12), shot(-9), shot(-12)],
                wallN: BALL_WALL_N, head: BALL_HEAD, square: BALL_SQUARE };
    cleanTools();
    return r;
  });
  const bwHit = ballWall.runs.filter(r => r.pin > 0 && Math.abs(r.turn) > 20);
  const bwWrong = bwHit.filter(r => Math.sign(r.turn) !== Math.sign(r.z0));
  ok('擦邊會往外側跳彈，正中央撞上去照樣鑿穿',
     ballWall.mid.pin === 0 && Math.abs(ballWall.mid.turn) < 10 &&
     ballWall.mid.hit > 100 && bwHit.length >= 3 && bwWrong.length === 0,
     '正中央：彈 ' + ballWall.mid.pin + ' 次、轉 ' + ballWall.mid.turn + '°、撞飛 ' +
     ballWall.mid.hit + ' 塊　·　' +
     ballWall.runs.map(r => 'z=' + r.z0 + ' → 彈 ' + r.pin + ' 次、轉 ' +
                            r.turn + '°').join('　·　') +
     '（往建築裡彈的有 ' + bwWrong.length + ' 條；v1.164 五條全是 0 次、1° 以內）');

  /* 方向：第一點 → 第二點。八個不同的方向各丟一發，每一發都要對得上自己那個方向，
     而且只差在 ±BALL_SPREAD 的手感偏差裡（本來是「一律朝工地中心」）。 */
  const ballAim = await page.evaluate(() => {
    const err = [];
    for (let k = 0; k < 8; k++) {
      const from = { x: Math.cos(k * 0.8) * 40, z: Math.sin(k * 0.8) * 40 };
      const want = k * 0.77 + 0.3;                     // 跟出手點無關的方向
      launchBall(from, { x: from.x + Math.cos(want) * 25, z: from.z + Math.sin(want) * 25 });
      const o = balls[balls.length - 1];        // 八發都還在場上（v1.116），要看剛丟的那顆
      let d = Math.atan2(o.vz, o.vx) - want;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      err.push(d);
    }
    balls = null; ENG.putBalls([]);
    /* 判斷要用原始值，不能用四捨五入過的顯示值：偏差是 ±BALL_SPREAD 的連續亂數，
       真的抽到 0.0003 這種小數字是完全正常的，但 toFixed(3) 會把它變成 0，
       「min > 0」就誤判成「這一發沒有隨機偏差」。uniq 同理，直接比浮點數本身。 */
    return { max: +Math.max(...err.map(Math.abs)).toFixed(3),
             minRaw: Math.min(...err.map(Math.abs)),
             uniq: new Set(err).size, n: err.length, lim: BALL_SPREAD };
  });
  ok('球滾去的方向就是你指的第二點',
     ballAim.max <= ballAim.lim && ballAim.uniq === ballAim.n,
     ballAim.n + ' 個方向各丟一發，最大只差 ' + ballAim.max + ' rad（手感偏差上限 ' +
     ballAim.lim + '）');
  ok('但每一發還是帶一點隨機偏差，不會兩發一模一樣',
     ballAim.minRaw > 0 && ballAim.uniq === ballAim.n, '八發角度互不相同');

  /* 兩下點擊的流程：第一下只是選出手點（球還沒生），第二下才丟。
     瞄到一半換道具、換建築都要把那個點收掉，不然下次點某處會莫名其妙從舊的點丟出去。 */
  const ballClick = await page.evaluate(() => {
    const keep = tool;
    tool = 'ball'; aim = null; balls = null;
    useTool({ kind: 'ground', point: { x: -40, y: 0, z: 0 } });
    const first = { aim: !!aim, ball: !!balls, rings: aim ? aimRings().length : 0 };
    useTool({ kind: 'ground', point: { x: -40, y: 0, z: 20 } });
    // 第二點在第一點的 +z 方向 → 角度應該是 π/2
    /* 角度要比**沒有四捨五入**的那個值：出手方向本來就帶 ±BALL_SPREAD 的隨機偏差
       （`aimDir` 的 `rr(-spread, spread)`），抽到貼著上限的那一發，先 toFixed(3) 再比
       會被進位推出界（實測 1.651 對上限 1.5708+0.08，真值其實在界內）——約 0.6% 的
       跑次會這樣假失敗。印出來的還是四捨五入過的，好讀。 */
    const second = { aim: !!aim, ball: !!balls,
                     x: balls ? +balls[0].x.toFixed(2) : null, z: balls ? +balls[0].z.toFixed(2) : null,
                     ang: balls ? +Math.atan2(balls[0].vz, balls[0].vx).toFixed(3) : null,
                     raw: balls ? Math.atan2(balls[0].vz, balls[0].vx) : null };
    balls = null; ENG.putBalls([]);
    useTool({ kind: 'ground', point: { x: 9, y: 0, z: 9 } });   // 瞄一半就換建築
    const aimed = !!aim;
    startBuild(true);
    const afterSwap = !aim;
    tool = keep;
    return { first, second, aimed, afterSwap, lim: BALL_SPREAD };
  });
  ok('第一下只是選出手點，球還沒出去',
     ballClick.first.aim && !ballClick.first.ball && ballClick.first.rings === 2,
     '出手點已記下、球 ' + (ballClick.first.ball ? '生了' : '還沒生') +
     '，地上畫了 ' + ballClick.first.rings + ' 圈瞄準環');
  ok('第二下從第一點出手、往第二點滾',
     ballClick.second.ball && !ballClick.second.aim &&
     ballClick.second.x === -40 && ballClick.second.z === 0 &&
     Math.abs(ballClick.second.raw - Math.PI / 2) <= ballClick.lim,
     '球生在 (' + ballClick.second.x + ', ' + ballClick.second.z + ')，角度 ' +
     ballClick.second.ang + '（要 ' + (Math.PI / 2).toFixed(3) + ' ±' + ballClick.lim + '）');
  /* v1.59：換建築不再收掉正在作用的道具，瞄到一半的第一點也一樣留著
     （它就是地面上的一個位置，跟哪一座建築沒關係）。換道具才會作廢。 */
  ok('換建築不會把瞄到一半的出手點吃掉', ballClick.aimed && !ballClick.afterSwap,
     '換場後那個點還在');

  /* 可以同時好幾顆（v1.116，使用者：「保齡球可以多顆（目前如果前一顆球還在滾，
     再用一次保齡球，前一個會消失）」）。改之前是一個 ball 變數，第二顆一出手就把第一顆
     整個蓋掉——球還在滾就憑空不見。改成一份清單之後要驗三件事：第二顆出手時第一顆
     還在場上、兩顆各滾各的（各自的里程都在長）、超過 BALL_MAX 才把最早那顆擠掉
     （跟龍捲風同一套）。第三件事順便驗「擠掉的是最早那顆」——留下來的第一顆不該是
     一開始那顆。 */
  const ballMany = await page.evaluate(() => {
    cleanTools(); startBuild(true); completeNow();
    const from = k => ({ x: Math.cos(k * 1.1) * 45, z: Math.sin(k * 1.1) * 45 });
    launchBall(from(0), { x: 0, z: 0 });
    for (let i = 0; i < 12; i++) step(0.03);            // 第一顆已經在滾了
    const one = balls.length, firstX = balls[0].x;
    launchBall(from(1), { x: 0, z: 0 });
    const two = balls.length, kept = balls[0].x === firstX;   // 第一顆沒被蓋掉
    const p = balls.map(b => ({ x: b.x, z: b.z }));
    for (let i = 0; i < 12; i++) step(0.03);
    const moved = balls.length >= 2 &&
      balls.slice(0, 2).every((b, i) => Math.hypot(b.x - p[i].x, b.z - p[i].z) > 1);
    // 一路丟到超過上限：滿了就把最早那顆擠掉
    cleanTools();
    launchBall(from(9), { x: 0, z: 0 });
    const oldest = balls[0];
    for (let k = 0; k < BALL_MAX + 2; k++) { launchBall(from(k), { x: 0, z: 0 }); step(0.03); }
    const capped = balls.length, pushed = balls.indexOf(oldest) < 0;
    balls = null; ENG.putBalls([]);
    return { one, two, kept, moved, capped, pushed, max: BALL_MAX };
  });
  ok('前一顆還在滾的時候再丟一顆，兩顆都在場上',
     ballMany.one === 1 && ballMany.two === 2 && ballMany.kept && ballMany.moved,
     '丟第二顆時場上 ' + ballMany.one + ' → ' + ballMany.two +
     ' 顆，第一顆沒被蓋掉、兩顆各滾各的');
  ok('顆數有上限，滿了把最早那顆擠掉',
     ballMany.capped === ballMany.max && ballMany.pushed,
     '連丟 ' + (ballMany.max + 3) + ' 顆 → 場上 ' + ballMany.capped +
     ' 顆（上限 ' + ballMany.max + '），最早那顆被擠掉了');

  /* 一顆跟六顆畫起來一樣貴：球換成 InstancedMesh 了（v1.116），場上幾顆只是多幾個
     instance。沒球的時候要回到原點——InstancedMesh 就算 count = 0 也會吃一個 draw call，
     所以沒球一定要 visible = false（見 README〈效能〉）。 */
  const ballCalls = await page.evaluate(() => {
    cleanTools(); startBuild(true); completeNow();
    draw(); ENG.render();
    const idle = ENG.info().calls;
    launchBall({ x: -45, z: 0 }, { x: 0, z: 0 });
    for (let i = 0; i < 12; i++) step(0.02);
    draw(); ENG.render();
    const one = ENG.info().calls;
    for (let k = 1; k < BALL_MAX; k++)
      launchBall({ x: Math.cos(k * 1.1) * 45, z: Math.sin(k * 1.1) * 45 }, { x: 0, z: 0 });
    for (let i = 0; i < 12; i++) step(0.02);
    const n = balls.length;
    draw(); ENG.render();
    const many = ENG.info().calls;
    balls = null; ENG.putBalls([]);
    draw(); ENG.render();
    return { idle, one, many, n, after: ENG.info().calls };
  });
  ok('多幾顆球不會多吃 draw call',
     ballCalls.many === ballCalls.one && ballCalls.one > ballCalls.idle,
     '沒球 ' + ballCalls.idle + ' 個、一顆 ' + ballCalls.one + ' 個、' +
     ballCalls.n + ' 顆 ' + ballCalls.many + ' 個');
  ok('球收掉之後畫面成本回到原點', ballCalls.after === ballCalls.idle,
     ballCalls.after + ' 個');

  /* ── 天降鐵球（v1.117）─────────────────────────────────
     使用者：「點擊地面 與地面垂直 落下一顆鐵球（碰撞 參考保齡球 只是從天而降
     不再移動後消失）」。「參考保齡球」在程式裡是字面意思——同一份 balls 清單、
     同一支 stepBall、同一顆 InstancedMesh。所以這裡只驗那三件差異：真的垂直、
     真的砸壞沿路的東西、停下來真的會自己收掉。
     第三件事有個容易寫壞的地方：保齡球的收球條件是「滾不動就收」（水平速度 < 4.5），
     直直掉下來的球從第一幀起水平速度就是 0，沿用那條的話它會在出手那一幀憑空消失
     ——所以 alive1 也要驗。 */
  await reset(page, { shape: '吉薩金字塔', cnt: 3000, workers: 12 });
  await page.evaluate(() => completeNow());
  const dropOne = await page.evaluate(() => {
    marks.length = 0;
    const P = { x: 6, z: -4 };
    tool = 'drop';
    useTool({ point: new THREE.Vector3(P.x, 0, P.z), dir: new THREE.Vector3(0, -1, 0) });
    const born = { n: balls.length, y: +balls[0].y.toFixed(1),
                   vx: balls[0].vx, vz: balls[0].vz };
    const set0 = blocks.filter(b => b.st === 3).length;
    let t = 0, drift = 0, air = 0, rise = 0, land = -1, gone = -1, alive1 = 0, pops = 0;
    let lastY = balls[0].y;
    while (t < 14) {
      step(0.05); t += 0.05;
      if (t < 0.11) alive1 = balls ? balls.length : 0;
      if (!balls) { gone = +t.toFixed(2); break; }
      const o = balls[0];
      // 垂直那條只能驗「還沒碰到東西之前」：碰到之後它本來就該被彈開
      if (!o.pops) drift = Math.max(drift, Math.hypot(o.x - P.x, o.z - P.z));
      if (o.y > lastY + 0.01) rise++;
      lastY = o.y;
      pops = o.pops;
      air = Math.max(air, Math.hypot(o.x - P.x, o.z - P.z));
      if (land < 0 && o.y <= o.r + 1e-6) land = +t.toFixed(2);
    }
    const r = { born, set0, set1: blocks.filter(b => b.st === 3).length,
                drift: +drift.toFixed(4), air: +air.toFixed(1), rise, pops,
                land, gone, alive1, crater: marks.filter(m => m.crater).length };
    /* 「落地留一個坑」改到**空地那一發**上量（v1.165）：砸在建築上的這一顆現在是
       被屋頂的坡度帶著滑下來的，撞進表面的速度有上限（DROP_SINK），落到地面時
       早就慢下來了——那一下本來就不該再震一次、再挖一個坑。
       空地那一發還是自由落體 49 單位／秒砸下去，坑照留。 */
    marks.length = 0;
    dropBall({ x: arenaR - 6, y: 0, z: 0 });
    let t2 = 0;
    while (t2 < 10 && balls) { step(0.05); t2 += 0.05; }
    r.openCrater = marks.filter(m => m.crater).length;
    cleanTools();
    return r;
  });
  ok('天降鐵球從正上方直直掉，碰到東西之前一步都不歪',
     dropOne.born.n === 1 && dropOne.born.vx === 0 && dropOne.born.vz === 0 &&
     dropOne.drift < 0.001 && dropOne.alive1 === 1,
     '從 ' + dropOne.born.y + ' 掉下來，撞到東西之前橫向偏移 ' + dropOne.drift);
  /* 撞到東西要有反應（v1.118，使用者：「少了鐵球撞到東西彈起來的感覺（目前就一路摧毀
     直直落下 可以撞到破壞後彈起來一點撞到其他位置）」）：真的被表面頂到、落點真的換了
     地方、而且**不會被彈飛**——v1.118 第一版照反射算，砸到屋頂就以幾十單位的速度
     往旁邊噴，實測橫向跑 30～87 單位、只撞掉 10 塊就飛出去，反而不摧毀了。
     **「彈起來」那一條改到平屋頂上驗**（v1.165，見〈砸在斜屋頂上…〉那一組）：
     這一發砸的是金字塔的斜面，現在它是順著坡面**磨下去**（垂直速度一路是負的），
     不是彈起來——那正是這一版要的溜滑梯。平屋頂那一發才會真的往上跳。 */
  ok('撞到東西會被頂到，落點跟著換地方（但不會被彈飛）',
     dropOne.pops >= 1 && dropOne.air > 1 && dropOne.air < 40,
     '被表面頂了 ' + dropOne.pops + ' 幀、最遠離出手點 ' + dropOne.air + ' 單位');
  ok('砸爛沿路的積木；砸在空地上那一發照樣留一個坑',
     dropOne.set0 - dropOne.set1 > 20 && dropOne.openCrater === 1,
     '打掉 ' + (dropOne.set0 - dropOne.set1) + ' 塊、砸空地留下 ' +
     dropOne.openCrater + ' 個坑洞（砸建築那一發滑下來才落地，' +
     dropOne.crater + ' 個坑）');
  /* 「落地之後還能滾多久」v1.165 從 3 秒放寬到 6：球現在是被屋頂帶著滑下來的，
     落地時還帶著水平速度（上限 DROP_HMAX＝8），要滾一段才停——那正是這一版要的。
     上限仍然要驗：沒有的話「滾不停」與「壽命到了憑空消失」就分不出來。 */
  ok('不再移動就自己收掉',
     dropOne.land > 0 && dropOne.gone > dropOne.land && dropOne.gone - dropOne.land < 6,
     '第 ' + dropOne.land + ' 秒落地、第 ' + dropOne.gone + ' 秒收掉');

  /* 順著建築造型滑下去（v1.165，使用者：「天降鐵球　減少垂直向破壞力（目的是更多
     根據建築造型的水平向滾動 例如溜滑梯）」）。
     驗的是**坡度真的把它帶走**：砸在金字塔的斜面上，撞到之後還要一路滑下坡，
     而且不能滑出草地（v1.118 那次照反射算就是被彈飛出場，反而不摧毀了）。
     v1.164 同一發撞完只跑了 10.3 單位——那時候它是原地往下鑽的。 */
  const dropSlide = await page.evaluate(() => {
    const one = (shape, k) => {
      cleanTools();
      shapePick = SHAPES.findIndex(s => s.n === shape);
      targetCnt = 3000; startBuild(true); completeNow(); shapePick = -1;
      /* 打掉多少用 stats.smashed 的增量：這一段有 12 個小人在場，
         他們會一邊撿一邊補回去，「站著的積木少了幾塊」量到的是淨值。 */
      const n0 = stats.smashed;
      dropBall({ x: bp.radius * k, y: 0, z: 0 });
      let t = 0, hx = 0, hz = 0, hit = 0, ex = 0, ez = 0, hy = 0;
      let ground = 0, rise = 0, lastY = balls[0].y;
      while (t < 16) {
        step(1 / 60); t += 1 / 60;
        const o = balls && balls[0];
        if (!o) break;
        if (!hit && o.pops > 0) { hit = 1; hx = o.x; hz = o.z; hy = +o.y.toFixed(1); }
        if (hit && o.y > lastY + 0.01) rise++;          // 撞到之後有沒有往上走
        lastY = o.y;
        if (o.y <= o.r + 1e-6) ground = 1;
        ex = o.x; ez = o.z;
      }
      return { shape, hy, ground, rise, roll: +Math.hypot(ex - hx, ez - hz).toFixed(1),
               cut: stats.smashed - n0, endR: +Math.hypot(ex, ez).toFixed(1) };
    };
    const r = { slope: one('吉薩金字塔', 0.35),          // 斜屋頂：順坡滑下去
                flat: one('帝國大廈', 0),                // 平屋頂：砸下去彈一下
                edge: +(arenaR + 24).toFixed(0) };
    cleanTools();
    return r;
  });
  ok('砸在斜屋頂上會順著坡滑下去（不是原地鑽一個洞，也不會被彈飛出場）',
     dropSlide.slope.roll > 15 && dropSlide.slope.ground === 1 &&
     dropSlide.slope.endR < dropSlide.edge && dropSlide.slope.cut > 40,
     '金字塔斜面 ' + dropSlide.slope.hy + ' 高撞上，之後又跑了 ' +
     dropSlide.slope.roll + ' 單位（v1.164 是 10.3）、打掉 ' + dropSlide.slope.cut +
     ' 塊、停在離場中心 ' + dropSlide.slope.endR + '（草地邊緣 ' + dropSlide.edge + '）');
  /* 平屋頂沒有坡度可用：那一下要**彈起來一點**（v1.118 使用者要的那個手感），
     不是把整段動能都拿去鑽。斜面那一發不驗這個——它是貼著坡面磨下去的。 */
  ok('砸在平屋頂上會彈起來一點，不是一路鑽到底',
     dropSlide.flat.rise > 0 && dropSlide.flat.ground === 1,
     '帝國大廈屋頂 ' + dropSlide.flat.hy + ' 高撞上，之後有 ' + dropSlide.flat.rise +
     ' 幀在往上走、又跑了 ' + dropSlide.flat.roll + ' 單位（打掉 ' +
     dropSlide.flat.cut + ' 塊）');

  /* 起點跟著建築走（v1.119，使用者：「天降鐵球 初始高度也能像烏雲一樣 根據建築高度
     有些建築很高 導致鐵球在建築中間位置高度落下」）。固定 58 的時候，高一點的地標
     （大笨鐘 9000 塊有 138 高）等於直接生在建築腰上，從裡面往外炸，完全沒有
     「從天上砸下來」那一段。兩件事一起驗：起點真的在屋頂上方，而且出手那一刻
     球心周圍一塊站著的積木都沒有（＝真的在建築外面）。
     順便驗壽命：起點拉高之後掉那一段要外加，不然最高的地標落地就沒剩多少時間。 */
  const dropHigh = await page.evaluate(() => {
    const out = [];
    for (const cfg of [['倫敦大笨鐘', 9000], ['羅馬競技場', 3000]]) {
      shapePick = SHAPES.findIndex(s => s.n === cfg[0]);
      targetCnt = cfg[1];
      cleanTools(); startBuild(true); completeNow();
      dropBall({ x: 0, y: 0, z: 0 });
      const o = balls[0], R = o.r + 0.7;
      // 起點要在跑之前先記下來：o 是球本身，跑完 o.y 就變成落地的高度了
      const y0 = o.y;
      const buried = blocks.filter(b => b.st === 3 &&
        b.x * b.x + (b.y - y0) ** 2 + b.z * b.z < R * R).length;
      /* 「落地」要連「落地那一幀就被收掉」也算（v1.165）：球現在是被屋頂帶著滑下來的，
         到地面時常常已經慢到 sp < 4.5、vy 歸零，同一幀就達成「不再移動」被收走，
         下一幀再看 balls[0] 就沒得看了。 */
      let t = 0, land = -1, gone = -1, lastY = o.y;
      while (t < 20) {
        const cur = balls && balls[0];
        if (cur) lastY = cur.y;
        step(1 / 60); t += 1 / 60;
        if (!balls) {
          gone = +t.toFixed(2);
          if (land < 0 && lastY <= o.r + 0.6) land = gone;
          break;
        }
        if (land < 0 && balls[0].y <= balls[0].r + 1e-6) land = +t.toFixed(2);
      }
      out.push({ shape: cfg[0], h: +bp.height.toFixed(0), y0: +y0.toFixed(0),
                 buried, floor: DROP_TOP, up: DROP_UP, land, gone,
                 crater: marks.filter(m => m.crater).length });
      cleanTools();
    }
    return out;
  });
  ok('起點跟著建築高度走，不會生在建築腰上',
     dropHigh.every(r => r.y0 === Math.max(r.floor, r.h + r.up) && r.buried === 0),
     dropHigh.map(r => r.shape + '（高 ' + r.h + '）從 ' + r.y0 +
                       ' 掉，球心周圍埋住 ' + r.buried + ' 塊').join('　·　'));
  /* 壽命夠不夠（v1.119）：不管從多高丟，球都要**撐到落地**才被收掉，
     不能在半空中壽命到期憑空消失。落地那個坑改由〈砸在空地上那一發〉守著
     （v1.165：砸在建築上的球是滑下來的，到地面時早就慢了，本來就不該再挖一個坑）。 */
  ok('不管從多高丟，都撐得到落地才收掉',
     dropHigh.every(r => r.land > 0 && r.gone >= r.land),
     dropHigh.map(r => r.shape + ' 第 ' + r.land + ' 秒落地、第 ' + r.gone +
                       ' 秒收掉').join('　·　'));

  /* 跟保齡球共用同一份清單、同一顆 mesh：兩種球同時在場也還是那幾個 draw call，
     顆數上限也是共用的那一份（BALL_MAX）。 */
  const dropShare = await page.evaluate(() => {
    cleanTools(); startBuild(true); completeNow();
    draw(); ENG.render();
    const idle = ENG.info().calls;
    launchBall({ x: -45, z: 0 }, { x: 0, z: 0 });
    for (let i = 0; i < 10; i++) step(0.02);
    draw(); ENG.render();
    const roll = ENG.info().calls;
    dropBall({ x: 8, y: 0, z: 8 });
    dropBall({ x: -8, y: 0, z: -8 });
    for (let i = 0; i < 10; i++) step(0.02);
    const kinds = balls.map(b => b.drop ? 'd' : 'r').join('');
    draw(); ENG.render();
    const both = ENG.info().calls;
    // 兩種混著丟到滿：上限是共用的那一份
    for (let k = 0; k < BALL_MAX; k++) {
      dropBall({ x: k, y: 0, z: 0 });
      launchBall({ x: -45, z: k }, { x: 0, z: 0 });
    }
    const capped = balls.length;
    cleanTools();
    return { idle, roll, both, kinds, capped, max: BALL_MAX };
  });
  ok('兩種球混在場上不會多吃 draw call',
     dropShare.both === dropShare.roll && dropShare.roll > dropShare.idle &&
     dropShare.kinds === 'rdd',
     '沒球 ' + dropShare.idle + ' 個、只有保齡球 ' + dropShare.roll +
     ' 個、再加兩顆鐵球 ' + dropShare.both + ' 個');
  ok('顆數上限是兩種球共用的那一份',
     dropShare.capped === dropShare.max,
     '混著丟 ' + (dropShare.max * 2) + ' 顆 → 場上 ' + dropShare.capped +
     ' 顆（上限 ' + dropShare.max + '）');

  /* ── 打雷（v1.117）─────────────────────────────────────
     使用者：「點擊地面 慢慢出現一朵烏雲 然後隨機打5~7道雷(閃電) 被雷打到的點造成
     小破壞(可能就幾格積木) 附帶燃燒效果」。四件事各一條：雲是**慢慢**聚出來的、
     聚滿了才開始劈、道數落在 5～7、一道雷只咬掉幾格但會燒起來。 */
  await reset(page, { shape: '吉薩金字塔', cnt: 3000, workers: 12 });
  /* 用 completeNow 不用 fillAll：fillAll 不會收掉整地推土機，剛擺好的最底層
     會被還在場上的推土機推散（實測前 0.25 秒掉 26 塊），那不是道具幹的。 */
  await page.evaluate(() => completeNow());
  const storm1 = await page.evaluate(() => {
    marks.length = 0; dust.length = 0;
    tool = 'storm';
    /* 一次點擊出三朵（v1.165）：道數要把三朵加起來，劈了幾道也要三朵一起數
       ——掛在 strike 上數，不用「bolts 這一幀變長了沒」：三朵可能同一幀一起劈，
       那樣會少算。 */
    const realStrike = window.strike;
    let fired2 = 0;
    window.strike = function (s) { fired2++; return realStrike(s); };
    useTool({ point: new THREE.Vector3(0, 0, 0), dir: new THREE.Vector3(0, -1, 0) });
    const born = storms.length;
    const want = storms.reduce((a, s) => a + s.left, 0);
    const each = storms.map(s => s.left);
    /* 雲的高度要蓋過屋頂（v1.118）：固定 26 的時候整朵埋在高一點的建築裡，
       電等於從樓層之間冒出來——使用者回報「看不太到電打在建築上」就是這件事。 */
    const above = storms[0].y - bp.height;
    const grow = [];
    /* 18 秒：聚雲 2.6 ＋ 起手 0.4 ＋ 20 道 ×0.5 ＋ 收雲 1.35 ＝ 最壞 14.4 秒（v1.123
       雲聚得比較久、道數也多了）。跑不完的話量到的會是「還沒劈完」。 */
    let t = 0, first = -1, fired = 0, prev = 0;
    while (t < 18) {
      step(0.05); t += 0.05;
      if (fired2 > fired) { fired = fired2; if (first < 0) first = +t.toFixed(2); }
      prev = bolts.length;
      /* 雲有自己一份粒子（不放進 dust，見 game-tools.js 的 dustList）。
         取樣間隔跟著 STORM_GROW 走（v1.123 從 1.6 拉到 2.6）：寫死 0.4 秒的話，
         第四次取樣落在 1.6 秒——那時候只長到六成，最後一格就對不上滿朵。 */
      while (grow.length < 4 && t >= (grow.length + 1) * (STORM_GROW / 3))
        grow.push(storms ? storms[0].puffs.length : 0);
    }
    const r = { born, want, each, fired, first, grow, full: STORM_GROW,
                above: +above.toFixed(0), trio: STORM_TRIO, nRange: STORM_N.slice(),
                puff: STORM_PUFF, burn: fires ? fires.length : 0,
                over: storms ? storms.length : 0 };
    window.strike = realStrike;
    cleanTools();
    return r;
  });
  ok('點下去先慢慢聚出烏雲，不是一次生一整朵',
     storm1.born === storm1.trio && storm1.grow[0] > 0 &&
     storm1.grow.every((n, i) => i === 0 || n >= storm1.grow[i - 1]) &&
     storm1.grow[3] > storm1.grow[0] * 2 && storm1.grow[3] === storm1.puff,
     '一次出 ' + storm1.born + ' 朵；第一朵每 ' + (storm1.full / 3).toFixed(2) +
     ' 秒量一次：' + storm1.grow.join(' → ') + ' 團（滿朵 ' + storm1.puff + ' 團）');
  ok('雲飄在屋頂上方，電才看得出打在建築上', storm1.above >= 10,
     '雲底比屋頂高 ' + storm1.above + ' 單位');
  ok('雲聚滿了才開始劈，劈完雲自己收掉',
     storm1.first > storm1.full && storm1.over === 0,
     '第一道雷在第 ' + storm1.first + ' 秒（雲要聚 ' + storm1.full + ' 秒）');
  /* 三朵各自劈自己的（v1.165，使用者：「一次出現三朵烏雲 分別打雷」）：
     每朵排 5～7 道、三朵加起來說要劈幾道就劈幾道。 */
  ok('三朵各自劈自己的，說要劈幾道就劈幾道', storm1.fired === storm1.want &&
     storm1.each.length === storm1.trio &&
     storm1.each.every(n => n >= storm1.nRange[0] && n <= storm1.nRange[1]),
     '三朵各排 ' + storm1.each.join('／') + ' 道（共 ' + storm1.want +
     '）、實際劈了 ' + storm1.fired + ' 道');
  ok('劈中的地方會燒起來，火再自己往鄰居蔓延', storm1.burn > 20,
     '整趟劈完還有 ' + storm1.burn + ' 塊在燒');

  /* 怎麼聚（v1.123，使用者：「烏雲出現時細節 先在中心外圍慢慢出現 然後往中心聚攏」）。
     兩件事要一起做，所以分兩條驗：只做出場順序的話整朵是「一圈一圈點亮」、沒有在動；
     只做飄進來的話每一團各自從外面飛進來，但先出場的散在整朵各處，看不出方向。 */
  const stormIn = await page.evaluate(() => {
    cleanTools();
    callStorm({ x: 0, z: 0 });
    const s = storms[0];
    const home = q => Math.hypot(q.hx - s.x, q.hz - s.z);      // 歸位點離雲心多遠
    const now = q => Math.hypot(q.x - s.x, q.z - s.z);         // 現在離雲心多遠
    const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
    let t = 0;
    while (t < 0.4) { step(0.05); t += 0.05; }
    // 剛出場的這一批：都還在自己歸位點的外面（＝正在飄進來）
    const fresh = s.puffs.length;
    const outside = s.puffs.filter(q => now(q) > home(q) + 1).length / fresh;
    while (t < STORM_GROW + 1.5) { step(0.05); t += 0.05; }
    const n = s.puffs.length, m = Math.round(n * 0.2);
    const r = { fresh, outside: +outside.toFixed(2), n,
                early: +avg(s.puffs.slice(0, m).map(home)).toFixed(1),
                late: +avg(s.puffs.slice(-m).map(home)).toFixed(1),
                settled: +avg(s.puffs.map(q => Math.hypot(q.x - q.hx, q.z - q.hz))).toFixed(2),
                R: STORM_R, puff: STORM_PUFF };
    cleanTools();
    return r;
  });
  ok('烏雲先在外圈出現，中心最後才補滿',
     stormIn.n === stormIn.puff &&
     stormIn.early > stormIn.R * 0.8 && stormIn.late < stormIn.R * 0.35,
     '最先出場那兩成的位置離雲心 ' + stormIn.early + '、最後兩成 ' + stormIn.late +
     '（雲半徑 ' + stormIn.R + '，滿朵 ' + stormIn.n + ' 團）');
  ok('每一團都是從外面飄回自己的位置，不是原地長出來',
     stormIn.outside > 0.9 && stormIn.settled < 1.2,
     '剛冒出來的 ' + stormIn.fresh + ' 團裡有 ' + Math.round(stormIn.outside * 100) +
     '% 還在自己位置的外面；聚滿之後平均離位 ' + stormIn.settled + ' 單位');

  /* 一次三朵、從周圍往中心點靠攏（v1.165，使用者：「烏雲出現方式 調整成周圍出現後
     再往中心點靠攏 一次出現三朵烏雲 分別打雷（出現可以故意設計微小時間差）」）。
     上面兩條驗的是「一朵之內每一團怎麼聚」，這一條驗的是**整朵怎麼移動**：
     三朵生在點擊處周圍更外面的地方（STORM_SEP ＋ STORM_COME），再一路飄向各自的
     歸位點；三朵的方位要分得開，出場時間還要差一點。 */
  const trio = await page.evaluate(() => {
    cleanTools();
    callStorm({ x: 0, z: 0 });
    const far = () => storms.map(s => +Math.hypot(s.x, s.z).toFixed(1));
    const born = storms.length;
    const start = far();
    const goal = storms.map(s => +Math.hypot(s.gx, s.gz).toFixed(1));
    const lag = storms.map(s => +s.t.toFixed(2));
    const ang = storms.map(s => Math.atan2(s.z, s.x));
    let gap = 9;
    for (let i = 0; i < ang.length; i++)
      for (let j = i + 1; j < ang.length; j++) {
        let g = Math.abs(ang[i] - ang[j]);
        if (g > Math.PI) g = Math.PI * 2 - g;
        gap = Math.min(gap, g);
      }
    let t = 0;
    while (t < STORM_GROW) { step(0.05); t += 0.05; }
    const r = { born, start, goal, lag, mid: far(),
                gap: +(gap * 180 / Math.PI).toFixed(0), trio: STORM_TRIO,
                sep: STORM_SEP, come: STORM_COME, lagStep: STORM_LAG, grow: STORM_GROW };
    cleanTools();
    return r;
  });
  ok('一次三朵烏雲，各自從周圍飄進來、往中心點靠攏',
     trio.born === trio.trio && trio.gap > 100 &&
     trio.start.every(v => v > trio.sep + trio.come * 0.9) &&
     trio.goal.every(v => Math.abs(v - trio.sep) < 0.1) &&
     trio.mid.every((v, i) => v < trio.start[i] * 0.45),
     trio.born + ' 朵，方位互差 ' + trio.gap + '°；出場離點擊處 ' +
     trio.start.join('／') + '，聚滿那一刻（第 ' + trio.grow + ' 秒）收到 ' +
     trio.mid.join('／') + '（歸位點 ' + trio.goal.join('／') + '）');
  ok('三朵的出場時間刻意差一點點',
     trio.lag.every((v, i) => i === 0 || v < trio.lag[i - 1]) &&
     Math.abs(trio.lag[trio.lag.length - 1]) < 1 &&
     Math.abs(trio.lag[1] - trio.lag[0]) > 0.05,
     '三朵各晚 ' + trio.lag.map(v => (-v).toFixed(2)).join('／') +
     ' 秒出場（設定一朵差 ' + trio.lagStep + ' 秒）');

  /* 「閃電打到地面不震動」（v1.123 使用者指定）。劈到建築才震——那一下真的有東西被打歪；
     劈在空地上什麼都沒動，畫面跟著跳反而像打到了什麼。
     一朵雲現在劈 15～20 道，每一道都震的話畫面會抖上七八秒。 */
  const stormShake = await page.evaluate(() => {
    cleanTools();
    /* 重蓋一座實心的金字塔：上面那幾條已經在同一座上劈掉好幾百塊、還燒了一陣，
       不重蓋的話「劈到建築」那一組可能真的劈到空的。 */
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 3000; startBuild(true); completeNow(); shapePick = -1;
    const real = ENG.shake;
    let n = 0;
    ENG.shake = v => { n++; return real(v); };
    const count = fn => { n = 0; fn(); bolts.length = 0; return n; };
    const hit = count(() => { for (let k = 0; k < 20; k++) strike({ x: 0, z: 0, y: 40 }); });
    const far = count(() => { for (let k = 0; k < 20; k++) strike({ x: 96, z: 96, y: 40 }); });
    ENG.shake = real;
    cleanTools();
    return { hit, far };
  });
  ok('雷劈在空地上不震畫面，劈到建築才震',
     stormShake.far === 0 && stormShake.hit >= 15,
     '劈金字塔 20 道震了 ' + stormShake.hit + ' 次、劈場外空地 20 道震了 ' +
     stormShake.far + ' 次');

  /* 劈到人（v1.133，使用者：「檢查一下 打雷 天降鐵球 王之財寶 是不是都沒對小人生效」
     ——查下去確實是，指定「打倒 ＋ 燒起來」）。所有道具掀倒小人本來都靠共用的 afterHit，
     而它**只在真的打掉積木時**才動人（`if (n <= 0) return`）：雷劈在空地上一塊積木都
     沒掉，整段等於沒跑。
     小人要**凍住**（updWorker 換成空的）：不凍的話他們在雲聚滿之前就走掉了
     （實測 16 秒走了 80 幾單位），量到的會是「沒打到」而不是「打不到」。
     量法在 v1.134 改過（見 README〈打雷劈到人那一條也在賭骰子〉）：人**鋪滿整個落點圓**，
     而且驗的是「每個人離最近的落點多遠」——一道雷的落點是在半徑 STRIKE_R 的圓裡隨機挑的，
     把人全擠在圓心的話，這一條就是在賭「這朵雲有沒有剛好劈到中間」。 */
  const stormMan = await page.evaluate(() => {
    cleanTools();
    setWorkerCount(16); targetCnt = 1800;
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    startBuild(true); completeNow(); shapePick = -1;
    for (let i = 0; i < 30; i++) step(1 / 60);
    const P = { x: 60, z: 0 };                       // 場外空地：確定一塊積木都沒有
    /* 12 個鋪在落點圓裡（三圈 × 四個方位），4 個站在圓外 25 格當對照組——
       落點最遠 13、打到人的範圍 5，那四個怎麼樣都碰不到。 */
    const RING = [1, 6, 11];
    for (let i = 0; i < workers.length; i++) {
      const w = workers[i], out = i >= 12;
      const a = (i % 4) / 4 * Math.PI * 2 + (out ? 0.7 : 0);
      const rad = out ? 25 : RING[Math.floor(i / 4)];
      w.x = P.x + Math.cos(a) * rad; w.z = P.z + Math.sin(a) * rad;
      w.y = 0; w.st = 'idle'; w.fall = 0; w.air = 0; w.burn = 0; w.wet = 0; w.tilt = 0;
    }
    const oUpd = updWorker;
    updWorker = () => {};
    /* 落點記在 smash 上：strike() 每一道雷都拿那一點打一次點狀衝擊（就在動人的那幾行
       前面），所以攔它就拿得到「這一道雷劈在哪」。這一段只有雷在動，不會有別的來源。 */
    const oSmash = smash, pts = [];
    smash = (p, d, r, pow, quiet, hush) => { pts.push({ x: p.x, z: p.z }); return oSmash(p, d, r, pow, quiet, hush); };
    tool = 'storm';
    useTool({ point: new THREE.Vector3(P.x, 0, P.z), dir: new THREE.Vector3(0, -1, 0) });
    const hit = workers.map(() => ({ burn: 0, fall: 0 }));
    let T = 0;
    while (T < 16) {
      step(1 / 60); T += 1 / 60;
      workers.forEach((w, i) => { if (w.burn > 0) hit[i].burn = 1; if (w.fall > 0) hit[i].fall = 1; });
    }
    updWorker = oUpd; smash = oSmash;
    /* 每個人離最近的那一道雷多遠：範圍內的一定要有反應（而且是燒著的——這一條沒有
       消防車，濕的人才會只被打倒），範圍外的一個都不能動。邊界上那 ±0.3 格不算，
       免得浮點誤差把人歸錯邊。 */
    const r = { n: workers.length, R: BOLT_MAN_R, bolts: pts.length,
                inN: 0, inHit: 0, inBurn: 0, outN: 0, outHit: 0 };
    workers.forEach((w, i) => {
      let d = Infinity;
      for (const p of pts) d = Math.min(d, Math.hypot(w.x - p.x, w.z - p.z));
      const any = hit[i].burn || hit[i].fall;
      if (d <= BOLT_MAN_R - 0.3) { r.inN++; if (any) r.inHit++; if (hit[i].burn) r.inBurn++; }
      else if (d > BOLT_MAN_R + 0.3) { r.outN++; if (any) r.outHit++; }
    });
    cleanTools();
    return r;
  });
  ok('雷劈到小人：落點五格內的打倒並且在地上燒起來，範圍外的一個都沒事',
     stormMan.inN >= 3 && stormMan.inHit === stormMan.inN && stormMan.inBurn === stormMan.inN &&
     stormMan.outN >= 4 && stormMan.outHit === 0,
     stormMan.n + ' 個人鋪在落點圓裡外，這朵雲劈了 ' + stormMan.bolts + ' 道：' +
     '落點 ' + stormMan.R + ' 格內的 ' + stormMan.inN + ' 個 → ' + stormMan.inHit +
     ' 個有反應、' + stormMan.inBurn + ' 個燒起來（v1.132 是 0 個）；' +
     '範圍外的 ' + stormMan.outN + ' 個 → 動到 ' + stormMan.outHit + ' 個');

  /* 劈完把視線高度還回去（v1.128，使用者：「如果是會讓鏡頭往高的方向調整的運鏡
     結束後高度要調回來」——這句一開始寫在天降鐵球底下，查證之後確認那支從頭到尾
     不動鏡頭（見〈煙火〉那一段的測試），使用者接著指出真正有運鏡的是打雷）。
     雲擺得比屋頂高，holdWide 就把視線抬到雲的腰間，而且**建築越高抬得越多**：
     羅馬競技場抬到 18.7、台北 101 抬到 67.2。劈完雲散了，鏡頭卻還仰在那裡看空的天空。
     跟煙火同一套（`temp` ＋ `releaseWide`），所以驗的東西也一樣：
     抬起來又還回去、**視距留著**、連放兩朵不會被第一朵散掉就壓回去。 */
  const stormCam = await page.evaluate(() => {
    const build = (name, cnt) => {
      cleanTools();
      shapePick = SHAPES.findIndex(s => s.n === name);
      targetCnt = cnt; startBuild(true); completeNow(); shapePick = -1;
      for (let i = 0; i < 20; i++) step(0.05);
    };
    const wait = () => { let g = 0; while (storms && g++ < 900) step(0.05); step(0.05); };
    const one = name => {
      build(name, name === '台北 101' ? 9000 : 3000);
      const ty0 = ENG.camTarget.ty, d0 = ENG.camTarget.dist;
      callStorm({ x: 0, z: 0 });
      const tyUp = ENG.camTarget.ty, dUp = ENG.camTarget.dist;
      wait();
      return { h: +bp.height.toFixed(0), ty0: +ty0.toFixed(1), tyUp: +tyUp.toFixed(1),
               ty1: +ENG.camTarget.ty.toFixed(1), d0: +d0.toFixed(1),
               dUp: +dUp.toFixed(1), d1: +ENG.camTarget.dist.toFixed(1) };
    };
    const low = one('羅馬競技場'), high = one('台北 101');
    // 第二朵在第一朵還沒散完時點下去：第一朵收工不能把鏡頭壓回去
    build('羅馬競技場', 3000);
    const ty0 = ENG.camTarget.ty;
    callStorm({ x: -20, z: 0 });
    for (let i = 0; i < 60; i++) step(0.05);          // 3 秒後再點一朵
    callStorm({ x: 20, z: 0 });
    /* 只在「還有雲在場上」時取樣：最後一幀本來就已經還回去了 */
    let mid = 1e9, g = 0;
    while (storms && g++ < 900) { step(0.05); if (!storms) break; mid = Math.min(mid, ENG.camTarget.ty); }
    step(0.05);
    const two = { ty0: +ty0.toFixed(1), mid: +mid.toFixed(1), ty1: +ENG.camTarget.ty.toFixed(1) };
    cleanTools();
    return { low, high, two };
  });
  ok('打雷期間鏡頭抬起來，雲散了就把高度還回去',
     stormCam.low.tyUp > stormCam.low.ty0 + 10 &&
     Math.abs(stormCam.low.ty1 - stormCam.low.ty0) < 0.1 &&
     Math.abs(stormCam.high.ty1 - stormCam.high.ty0) < 0.1,
     '羅馬競技場（h=' + stormCam.low.h + '）視線高 ' + stormCam.low.ty0 + ' → ' +
     stormCam.low.tyUp + ' → ' + stormCam.low.ty1 + '；台北 101（h=' +
     stormCam.high.h + '）' + stormCam.high.ty0 + ' → ' + stormCam.high.tyUp +
     ' → ' + stormCam.high.ty1);
  ok('建築越高抬得越多，還回去的只有高度、視距留著',
     stormCam.high.tyUp > stormCam.low.tyUp * 2 &&
     stormCam.low.d1 === stormCam.low.dUp && stormCam.high.d1 === stormCam.high.dUp,
     '抬到 ' + stormCam.low.tyUp + ' vs ' + stormCam.high.tyUp + '；視距 ' +
     stormCam.low.d0 + '→' + stormCam.low.d1 + '、' + stormCam.high.d0 + '→' +
     stormCam.high.d1);
  ok('連放兩朵不會被第一朵散掉就壓回去',
     stormCam.two.mid > stormCam.two.ty0 + 10 &&
     Math.abs(stormCam.two.ty1 - stormCam.two.ty0) < 0.1,
     '兩朵都在場時視線高最低只到 ' + stormCam.two.mid + '，全散完才回到 ' +
     stormCam.two.ty1);

  /* 道數：使用者指定 15～20（v1.123，v1.118 是 7～15、更早是 5～7）。抽 900 朵，
     範圍內每個值都要出現、也不能跑出範圍；順便驗頭尾兩個值沒有比中間少一半
     （用 rr 再四捨五入會有那個毛病）。 */
  const stormN = await page.evaluate(() => {
    const seen = {};
    for (let k = 0; k < 900; k++) {
      storms = null;
      callStorm({ x: 0, z: 0 });
      seen[storms[0].left] = (seen[storms[0].left] || 0) + 1;
    }
    cleanTools();
    return { seen, lo: STORM_N[0], hi: STORM_N[1] };
  });
  const stormKeys = Object.keys(stormN.seen).map(Number).sort((a, b) => a - b);
  const stormCnt = stormKeys.map(k => stormN.seen[k]);
  ok('隨機劈 15～20 道，每個道數的機會一樣',
     stormKeys.length === stormN.hi - stormN.lo + 1 &&
     stormKeys[0] === stormN.lo && stormKeys[stormKeys.length - 1] === stormN.hi &&
     Math.min(...stormCnt) > Math.max(...stormCnt) * 0.55,
     '抽 900 朵：' + stormKeys.map(k => k + '道×' + stormN.seen[k]).join('、'));

  /* 一道雷咬掉多大一片。v1.123 前是「小破壞（可能就幾格積木）」——判定半徑 1.3，
     格子間距 1，所以最多是「打中那一塊 ＋ 六個面鄰居」＝ 7 格，對角線（1.41）進不來。
     使用者：「閃電破壞面積 加大(2倍)」→ 半徑乘 √2 變 1.84（**面積**兩倍）。
     跨過 1.73 之後 3×3×3 的角落也進得來，幾何上限因此變成 27 格。
     實際咬到多少要看打在哪：金字塔上劈 60 道量到 1～23 格、平均 14.2
     （半徑 1.3 時是 1～7、平均 3）。格數比面積多得多是因為它是球不是圓——
     半徑乘 √2，體積就是 2.83 倍，再加上格子落點的零頭。
     垮塌要先擋掉：上面連不到地面而跟著垮的那些不是這一道雷打掉的。 */
  const stormBite = await page.evaluate(() => {
    const real = markSupportDirty;
    markSupportDirty = () => {};
    const per = [];
    for (let k = 0; k < 40; k++) {
      const before = blocks.filter(b => b.st === 3).length;
      strike({ x: 0, z: 0, y: 40 });          // y 是雲底高度（v1.118 起跟著建築走）
      per.push(before - blocks.filter(b => b.st === 3).length);
      bolts.length = 0;
    }
    markSupportDirty = real;
    per.sort((a, b) => a - b);
    const r = { min: per[0], max: per[per.length - 1],
                avg: +(per.reduce((a, b) => a + b, 0) / per.length).toFixed(1) };
    cleanTools();
    return r;
  });
  ok('一道雷咬掉的是「面積兩倍」那一片，不是整面牆',
     stormBite.max <= 27 && stormBite.avg > 6 && stormBite.avg < 22,
     '劈 40 道：一道 ' + stormBite.min + '～' + stormBite.max +
     ' 格、平均 ' + stormBite.avg + ' 格（幾何上限 27 格；半徑 1.3 時是 1～7、平均 3）');

  /* 劈在空地上：地上留焦黑（不是坑洞——雷是燒不是砸），旁邊的建築一塊都不能掉。 */
  await reset(page, { shape: '吉薩金字塔', cnt: 3000, workers: 12 });
  await page.evaluate(() => completeNow());
  const stormFar = await page.evaluate(() => {
    marks.length = 0;
    const set0 = blocks.filter(b => b.st === 3).length;
    tool = 'storm';
    useTool({ point: new THREE.Vector3(70, 0, 70), dir: new THREE.Vector3(0, -1, 0) });
    let t = 0, peak = 0, crater = 0;
    while (t < 18) {
      step(0.05); t += 0.05;
      peak = Math.max(peak, marks.length);
      crater += marks.filter(m => m.crater).length;
    }
    const r = { set0, set1: blocks.filter(b => b.st === 3).length, peak, crater };
    cleanTools();
    return r;
  });
  ok('劈在空地上只留焦黑，不會傷到旁邊的建築',
     stormFar.set0 === stormFar.set1 && stormFar.peak >= 4 && stormFar.crater === 0,
     '建築 ' + stormFar.set1 + ' 塊原封不動，地上同時看得到 ' + stormFar.peak + ' 塊焦黑');

  /* 同時最多幾朵：滿了把最早那朵擠掉（跟其他清單型道具同一套）。 */
  const stormCap = await page.evaluate(() => {
    cleanTools();
    const seen = [];
    for (let k = 0; k < STORM_MAX + 2; k++) {
      callStorm({ x: k * 8 - 16, z: 0 });
      seen.push(storms.length);
    }
    const oldest = storms.map(s => +s.x.toFixed(0));
    cleanTools();
    return { seen, oldest, max: STORM_MAX };
  });
  ok('同時最多幾朵，滿了把最早那朵擠掉',
     stormCap.seen[stormCap.seen.length - 1] === stormCap.max &&
     stormCap.oldest[0] !== -16,
     '連點 ' + stormCap.seen.length + ' 次 → 場上 ' + stormCap.seen.join('、') +
     ' 朵（上限 ' + stormCap.max + '）');

  /* 會「持續破壞」的那幾種不震畫面（v1.58）：球一路滾、投石機連丟好幾顆，
     每一下都震的話畫面從頭晃到尾，看久了很不舒服。震動留給槌子那種單次撞擊。 */
  const shakes = await page.evaluate(() => {
    const real = ENG.shake;
    let n = 0;
    ENG.shake = v => { n++; return real(v); };
    const count = fn => { n = 0; fn(); return n; };
    startBuild(true); completeNow();
    const ballN = count(() => {
      launchBall({ x: -60, z: 0 }, { x: 0, z: 0 });      // 從場邊滾過整座建築
      for (let i = 0; i < 160 && balls; i++) step(0.05);
    });
    const trebN = count(() => {
      placeTreb({ x: 46, z: 0 });
      for (let i = 0; i < 400 && trebs; i++) step(0.05);
    });
    /* 王之財寶（v1.132）：連射七秒、一趟一百九十幾發，同一個道理一次都不震。 */
    const gateN = count(() => {
      gateAt({ x: 0, z: 0 });
      for (let i = 0; i < 340 && gates; i++) step(0.05);
      gates = null; weapons = null; gateEnd();
    });
    // 對照組：槌子那一下還是要震，不然就是整套震動被我弄壞了
    const hamN = count(() => smash({ x: 0, y: 4, z: 0 }, { x: 0, y: -1, z: 0 }, 6, 15));
    ENG.shake = real;
    return { ballN, trebN, gateN, hamN };
  });
  ok('保齡球滾一整趟、投石機打完一整輪、王之財寶射完一整趟，畫面一次都不震',
     shakes.ballN === 0 && shakes.trebN === 0 && shakes.gateN === 0,
     '保齡球 ' + shakes.ballN + ' 次、投石機 ' + shakes.trebN + ' 次、王之財寶 ' +
     shakes.gateN + ' 次');
  ok('槌子那種單次撞擊照樣震', shakes.hamN === 1, '敲一下震 ' + shakes.hamN + ' 次');

  /* 龍捲風改成跟保齡球同一套操作（v1.58）：第一點是它出現的地方，第二點是掃過去的方向。
     本來是點一下就朝工地中心掃，方向完全不歸玩家管。 */
  const twClick = await page.evaluate(() => {
    const keep = tool;
    tool = 'tornado'; aim = null; twists = null;
    useTool({ kind: 'ground', point: { x: -30, y: 0, z: 0 } });
    const first = { aim: !!aim, n: twists ? twists.length : 0,
                    rings: aim ? aimRings().length : 0 };
    useTool({ kind: 'ground', point: { x: -30, y: 0, z: 20 } });      // 往 +z
    const w = twists && twists[0];
    const second = { aim: !!aim, n: twists ? twists.length : 0,
                     x: w ? +w.x.toFixed(2) : null, z: w ? +w.z.toFixed(2) : null,
                     ang: w ? +Math.atan2(w.vz, w.vx).toFixed(3) : null,
                     life: w ? w.life : null };
    for (let i = 0; i < 260 && twists; i++) step(0.05);      // 追到它自己消失（壽命 10 秒）
    const gone = !twists;
    twists = null; ENG.putTornados([]); aim = null;
    tool = keep;
    return { first, second, gone, lim: TW_SPREAD, life: TW_LIFE };
  });
  ok('龍捲風第一下只是選地點，還沒真的來',
     twClick.first.aim && twClick.first.n === 0 && twClick.first.rings === 2,
     '地上畫了 ' + twClick.first.rings + ' 圈瞄準環，場上 ' + twClick.first.n + ' 道');
  ok('第二下從第一點生出來，往第二點掃過去',
     twClick.second.n === 1 && !twClick.second.aim &&
     twClick.second.x === -30 && twClick.second.z === 0 &&
     Math.abs(twClick.second.ang - Math.PI / 2) <= twClick.lim,
     '生在 (' + twClick.second.x + ', ' + twClick.second.z + ')，角度 ' +
     twClick.second.ang + '（要 ' + (Math.PI / 2).toFixed(3) + ' ±' + twClick.lim + '）');
  /* 走的路不是一條直線。量「行進方向偏離出發方向多少」，每 0.25 秒取樣一次
     （每幀取的話量到的是雜訊，不是路徑）。擺動的起始相位是隨機的，單跑一道
     會忽大忽小，所以跑八道看中位數——這樣才是「這個機制會不會讓它歪」而不是手氣。
     改之前那版（每幀加亂數加速度、左右互相抵銷）同樣量法只有 0.15 rad。 */
  const twPath = await page.evaluate(() => {
    const out = [];
    for (let run = 0; run < 8; run++) {
      twists = null;
      launchTornado({ x: -30, z: 0 }, { x: -30, z: 20 });
      const a0 = Math.atan2(twists[0].vz, twists[0].vx);
      let worst = 0;
      for (let i = 0; i < 20 && twists && twists.length; i++) {
        for (let k = 0; k < 5; k++) step(0.05);
        if (!twists || !twists.length) break;
        let d = Math.atan2(twists[0].vz, twists[0].vx) - a0;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        worst = Math.max(worst, Math.abs(d));
      }
      out.push(+worst.toFixed(2));
    }
    twists = null; ENG.putTornados([]);
    return out.sort((a, b) => a - b);
  });
  ok('出發之後一路歪來歪去，不是照直線走',
     twPath[4] > 0.4 && twPath[0] > 0.15,
     '八道各自最多偏離出發方向 ' + twPath.join('／') + ' rad（中位數 ' + twPath[4] + '）');
  /* 移動速度（v1.62.2 使用者指定「提升」，整組乘 1.6）。量的是**每秒真的走幾單位**，
     不是讀常數：速度每幀被亂數推一下、又夾在上下限之間，讀常數證明不了它實際走多快。
     跑八道看中位數（單跑一道會被那組亂數帶偏），順便驗沒有任何一幀跑出上下限。 */
  const twSpd = await page.evaluate(() => {
    const out = [], spins = [];
    let lo = 1e9, hi = 0;
    for (let run = 0; run < 8; run++) {
      twists = null;
      launchTornado({ x: 0, z: 0 }, { x: 0, z: 20 });
      let d = 0, t = 0, px = twists[0].x, pz = twists[0].z;
      /* 自轉也一起量（v1.151）：跟速度同一個道理，量的是每秒真的轉幾弧度。 */
      const sp0 = twists[0].spin;
      let sr = 0;
      for (let i = 0; i < 100 && twists && twists.length; i++) {
        step(0.05); t += 0.05;
        if (!twists || !twists.length) break;
        const w = twists[0], one = Math.hypot(w.x - px, w.z - pz);
        lo = Math.min(lo, one / 0.05); hi = Math.max(hi, one / 0.05);
        d += one; px = w.x; pz = w.z;
        sr = (w.spin - sp0) / t;
      }
      out.push(+(d / t).toFixed(2));
      spins.push(+sr.toFixed(2));
    }
    twists = null; ENG.putTornados([]);
    return { spd: out.sort((a, b) => a - b), lo: +lo.toFixed(2), hi: +hi.toFixed(2),
             spin: spins, spinC: TW_SPIN,
             s0: TW_SPD0, min: TW_SPD_MIN, max: TW_SPD_MAX };
  });
  /* 門檻 v1.151 照量的重訂（使用者：「龍捲風整體效果加速兩倍」，整組再乘 2）：
     八道實測 14.8～16.79，中位數 15.4～15.8。v1.116～v1.150 是 6.96～8.21／中位 7.6，
     v1.115 是 4.36～6.0／中位 5.2。門檻照舊按中位數的 0.88／0.78 抓。 */
  ok('龍捲風走得比以前快（v1.62.2 乘 1.6、v1.116 再乘 1.5、v1.151 再乘 2）',
     twSpd.spd[4] > 13.6 && twSpd.spd[0] > 12,
     '八道各自的平均速度 ' + twSpd.spd.join('／') + ' 單位／秒（中位數 ' + twSpd.spd[4] +
     '；出發 ' + twSpd.s0 + '，v1.150 是 7.8、v1.62.2 之前是 3.2）');
  /* 漏斗的扭曲完全是 spin 的函數（見引擎 putTornados），所以「加速兩倍」看得最明顯
     的一半就是自轉。跟速度同一個道理量實際值，不是讀常數。 */
  ok('漏斗自轉一秒 14 弧度（v1.151 從 7 乘 2）',
     twSpd.spinC === 14 && twSpd.spin.every(v => Math.abs(v - 14) < 0.2),
     '八道各自量到 ' + twSpd.spin.join('／') + ' rad/s（TW_SPIN = ' + twSpd.spinC + '）');
  ok('速度一直待在上下限之間',
     twSpd.lo >= twSpd.min - 0.01 && twSpd.hi <= twSpd.max + 0.01,
     '整段量到最慢 ' + twSpd.lo + '、最快 ' + twSpd.hi +
     '（上下限 ' + twSpd.min + '～' + twSpd.max + '）');

  /* 10 秒（v1.62，本來 5）：改成「一趟只咬得走一部分」之後，五秒不夠看出它在做什麼。 */
  ok('龍捲風 10 秒才收', twClick.second.life === 10 && twClick.life === 10 && twClick.gone,
     'TW_LIFE = ' + twClick.life + ' 秒，追到它自己消失');

  /* 點下去算誰被點到：建築 > 小人 > 地板，不是「誰比較近」（v1.58）。
     拿槌子對著建築點，剛好有小人走在前面的話，那一下本來會變成戳人。 */
  const pickOrder = await page.evaluate(() => {
    startBuild(true); completeNow();
    const cam = ENG.three.camera;
    ENG.updateCamera(1); cam.updateMatrixWorld();
    draw();                       // 積木的位置是 draw() 才推進 InstancedMesh 的，不先畫射線會落空
    const b = blocks.find(x => x.st === 3 && x.y > 4);
    const v = new THREE.Vector3(b.x, b.y, b.z).project(cam);
    const px = (v.x + 1) / 2 * window.innerWidth, py = (1 - v.y) / 2 * window.innerHeight;
    const clean = ENG.pick(px, py);
    // 把一個小人搬到「相機與那塊積木之間」，正好擋在射線上
    const c = cam.position, t = 0.62;
    const w = workers[0];
    w.air = 0; w.fall = 0; w.burn = 0;
    w.x = c.x + (b.x - c.x) * t;
    w.z = c.z + (b.z - c.z) * t;
    w.y = c.y + (b.y - c.y) * t - 0.9;                  // 身體中段對準射線
    draw();
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2(v.x, v.y), cam);
    const hits = rc.intersectObjects([ENG.three.blockMesh, ENG.three.workerMesh], false);
    const order = hits.map(h => h.object === ENG.three.workerMesh ? 'w' : 'b').join('');
    const blocked = ENG.pick(px, py);
    /* 反過來也要成立：小人身後沒有建築時，點他還是點得到（不然就戳不動人了）。
       把他搬到相機正前方 40 單位、再往旁邊挪 16——那個方向看過去背景只有草地。 */
    const fwd = new THREE.Vector3(); cam.getWorldDirection(fwd);
    const side = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    w.x = c.x + fwd.x * 40 + side.x * 16;
    w.z = c.z + fwd.z * 40 + side.z * 16;
    w.y = 0;
    draw();
    const v2 = new THREE.Vector3(w.x, w.y + 0.9, w.z).project(cam);
    rc.setFromCamera(new THREE.Vector2(v2.x, v2.y), cam);
    // 自我檢查：這個方向上真的只有小人、沒有積木，不然這一條就白測了
    const only = rc.intersectObjects([ENG.three.blockMesh, ENG.three.workerMesh], false)
                   .map(h => h.object === ENG.three.workerMesh ? 'w' : 'b').join('');
    const solo = ENG.pick((v2.x + 1) / 2 * window.innerWidth, (1 - v2.y) / 2 * window.innerHeight);
    const soloPx = (v2.x + 1) / 2 * window.innerWidth, soloPy = (1 - v2.y) / 2 * window.innerHeight;
    /* 手上拿的是哪一把也算數（v1.60）：
       skip = 破壞道具，小人整個當透明；man = 手指，小人排第一。 */
    const soloSkip = ENG.pick(soloPx, soloPy, 'skip');
    // 擋在建築前面的那個位置要再擺一次（上面把他搬到草地前面了）
    w.x = c.x + (b.x - c.x) * t;
    w.z = c.z + (b.z - c.z) * t;
    w.y = c.y + (b.y - c.y) * t - 0.9;
    draw();
    const manHit = ENG.pick(px, py, 'man');
    const skipHit = ENG.pick(px, py, 'skip');
    return { clean: clean && clean.kind, blocked: blocked && blocked.kind,
             solo: solo && solo.kind, order: order.slice(0, 4), only: only.slice(0, 4),
             soloSkip: soloSkip && soloSkip.kind, man: manHit && manHit.kind,
             skip: skipHit && skipHit.kind, manIdx: manHit && manHit.idx };
  });
  ok('小人擋在建築前面時，點下去打的是建築',
     pickOrder.clean === 'block' && pickOrder.order[0] === 'w' && pickOrder.blocked === 'block',
     '射線先碰到的是「' + pickOrder.order + '」，判定仍然給 ' + pickOrder.blocked);
  ok('小人背後沒有建築時照樣戳得到他',
     pickOrder.solo === 'worker' && pickOrder.only.indexOf('b') < 0,
     '射線上只有「' + pickOrder.only + '」 → 判定給 ' + pickOrder.solo);
  /* v1.60：手指以外的破壞道具不理小人。點在人身上（背後是空地）也要打到地板，
     不然那一發就白點了——想炸的地方剛好有人走過就吃掉一次操作。 */
  ok('破壞道具點在小人身上，打的是他背後的東西',
     pickOrder.soloSkip === 'ground' && pickOrder.skip === 'block',
     '背景是草地 → ' + pickOrder.soloSkip + '、背景是建築 → ' + pickOrder.skip);
  /* 反過來，手指只有「戳人」一種用途，所以小人排第一——
     v1.58 之後「站在建築正前方的人戳不到」就是這樣解掉的。 */
  ok('拿手指時，站在建築正前方的小人也戳得到',
     pickOrder.man === 'worker' && pickOrder.manIdx === 0,
     '同一個位置：一般判定給 ' + pickOrder.blocked + '、手指判定給 ' + pickOrder.man +
     '（第 ' + pickOrder.manIdx + ' 個人）');

  /* 離工地遠的東西也要點得到（v1.98）。three 的 InstancedMesh.raycast **第一件事是拿
     this.boundingSphere 擋一次**，而那顆球是第一次射線判定時算出來、之後就一直用同一顆；
     這一池的東西卻一直在動（換建築、碎料被轟到場外、v1.97 起小人的家蓋在整片碎料場上）。
     過期的球擋掉之後，整池都被跳過，點下去直接落到地板——使用者是在小房子上遇到的
     （「用槌子砸好像容易點到地板」）。修法是每幀把球丟掉（commitBlocks／commitWorkers），
     three 看到 null 才重算，所以那個 O(n) 只發生在真的做射線判定的那一幀。
     這條同時驗兩件事：現在遠處點得到；以及**球真的是那道關卡**（把它換成過期的就點不到）。 */
  const farPick = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 500; setWorkerCount(6); startBuild(true); completeNow();
    for (let i = 0; i < 40; i++) ENG.updateCamera(1);
    const bm = ENG.three.blockMesh, cam = ENG.three.camera;
    const W = window.innerWidth, H = window.innerHeight;
    const v = new THREE.Vector3();
    const b = blocks[blocks.length - 1];
    const at = r => {
      if (b.cell) gridDel(b);
      b.x = 0; b.z = r; b.y = HB; b.st = 3;
      draw(); ENG.render();                    // draw 會 commitBlocks（球在這裡被丟掉）
      v.set(b.x, b.y, b.z).project(cam);
      return { px: (v.x + 1) / 2 * W, py: (1 - v.y) / 2 * H };
    };
    const good = [];
    for (const r of [16, 22, 28, 34, 40]) {
      const q = at(r);
      const hit = ENG.pick(q.px, q.py);
      good.push(hit && hit.kind === 'block' ? 'block' : (hit ? hit.kind : 'none'));
    }
    // 對照：把球換成「上一座小建築」時算的那種（釘在工地中央、半徑 8）
    const q = at(40);
    bm.computeBoundingSphere();
    bm.boundingSphere.center.set(0, 0, 0);
    bm.boundingSphere.radius = 8;
    const stale = ENG.pick(q.px, q.py);
    bm.boundingSphere = null;
    const fresh = ENG.pick(q.px, q.py);
    return { good, stale: stale ? stale.kind : 'none', fresh: fresh ? fresh.kind : 'none' };
  });
  ok('離工地很遠的積木也點得到（包圍球不能快取住）',
     farPick.good.every(k => k === 'block') &&
     farPick.stale === 'ground' && farPick.fresh === 'block',
     '半徑 16／22／28／34／40 各點一下：' + farPick.good.join('／') +
     '；把包圍球換成過期的（工地中央、半徑 8）→ ' + farPick.stale + '，丟掉重算 → ' +
     farPick.fresh);

  /* 滾多遠：把積木清空、場地放大，量到的就是摩擦與壽命本身（不含撞到東西的煞車）。
     v1.39 之前是 6 秒 ×每秒保留 0.82，量到 119.3；現在 7.5 秒 ×0.86，量到 152.7。 */
  const ballRun = await page.evaluate(() => {
    const bk = blocks, wk = workers, ar = arenaR;
    blocks = []; workers = []; arenaR = 300;
    launchBall({ x: -80, z: 0 }, { x: 100, z: 0 });
    let moved = 0, px = balls[0].x, pz = balls[0].z, t = 0;
    for (let i = 0; i < 800 && balls; i++) {
      step(0.03); t += 0.03;
      if (!balls) break;
      moved += Math.hypot(balls[0].x - px, balls[0].z - pz); px = balls[0].x; pz = balls[0].z;
    }
    blocks = bk; workers = wk; arenaR = ar;
    return { moved: +moved.toFixed(1), t: +t.toFixed(2), life: BALL_LIFE };
  });
  ok('空場上一發滾得完整個工地那麼遠',
     ballRun.moved > 140 && ballRun.t >= ballRun.life - 0.1,
     '滾了 ' + ballRun.moved + ' 單位、' + ballRun.t + ' 秒（v1.38 是 119.3 單位／6 秒）');

  /* 掃三趟（v1.148.1）。漏斗自己一路亂竄，同一組參數啃掉的比例是一條長尾
     （見下面那條斷言的註解：16 輪量到 13.4～58.0%），一趟就定案等於在賭那條路線。
     三趟裡「啃掉多少」取中位數，其餘（生得出來、捲得上天、收得乾淨）三趟都要成立。 */
  const twAll = [];
  for (let k = 0; k < 3; k++) twAll.push(await page.evaluate(() => {
    /* 藍圖與塊數要指定（v1.116）。沿用上一條留下的話會抽到很小的建築
       （實測 455 塊），漏斗半徑 6 一罩就是大半座——量到的是「小建築被罩滿」
       不是「掃過去」，v1.116 把每秒啃掉的比例拉高之後那一組直接吃掉 67%。
       跟下面兩條釘住不走的一樣指定新天鵝堡 3000。 */
    cleanTools();
    shapePick = SHAPES.findIndex(s => s.n === '新天鵝堡');
    targetCnt = 3000; startBuild(true); completeNow(); shapePick = -1;
    const before = blocks.filter(b => b.st === 3).length;
    launchTornado({ x: siteR * 0.6, z: 0 });
    const born = twists ? twists.length : 0;
    let lifted = 0;
    for (let i = 0; i < 400; i++) {                // 12 秒：整段壽命都在裡面
      step(0.03);
      lifted = Math.max(lifted, blocks.filter(b => b.st === 4 && b.y > 6).length);
    }
    for (let i = 0; i < 700; i++) step(0.05);       // 等它們全部落地
    return { before, after: blocks.filter(b => b.st === 3).length, lifted, born, gone: !twists,
             flying: blocks.filter(b => b.st === 4).length };
  }));
  const twR = twAll.slice().sort((a, b) => a.after - b.after)[1];      // 啃掉多少取中位那一趟
  ok('龍捲風會生出來', twAll.every(t => t.born === 1));
  ok('龍捲風會把積木捲上天', twAll.every(t => t.lifted > 20),
     '三趟同時在空中最多 ' + twAll.map(t => t.lifted).join('／') + ' 塊');
  /* v1.62（使用者指定）：掃過去要吸走一些，但**不能把建築整段刨掉**。
     上限那一邊看的是垮塌之後的結果（吸走的那些撐著上層時，上層會跟著垮），
     所以不是「剩八成」而是抓一條寬一點的線；下限是「真的有在吸」。
     改之前這一條是 after < before × 0.6（一道掃過去沿路整條不見）。
     v1.87 改成持續破壞之後這條更該守著：漏斗自己一路亂竄，罩過同一塊地的時間
     只有一秒多，所以整趟仍然是「啃出缺口」——實測八種藍圖少 11～24%。
     v1.116 把每秒啃掉的比例拉到 0.35、速度再乘 1.5 之後，同一趟少的比例往上跑：
     新天鵝堡 3000 塊跑 12 輪是 15.8～38.1%（平均 27.4%），另一組 3 輪抽到過 43.3%。
     所以下緣從 0.5 放到 0.45（＝最多啃掉 55%）：留 12 個百分點給那條隨機漫步的路線，
     但「整段刨掉」（八成以上）還是會被抓出來。
     v1.123 拉到 0.46 之後，照這一條的參數（新天鵝堡 3000、起點 siteR×0.6）跑 16 輪是
     13.4～58.0%、平均 31.9%——平均只多四個百分點，但尾巴那幾輪（漏斗賴在建築上沒竄開）
     踩到 54.4／57.2／58.0，剛好把 55% 那條頂破。所以下緣再放到 0.35（＝最多啃掉 65%）。

     v1.148.1 那條線又被踩破一次（實測 65.2%）。這次**不再放寬**，改動量測：
     重量一次分布（同一組參數 24 趟）是 13.2／14.9／16.4／18.5／20.1／20.5／21.5／26.3／
     26.8／27／28.8／29.7／30／31.3／35.2／38.4／40.5／41.5／47.1／47.8／49.1／55.4／
     59.4／68.7 ——中位 30%、九成位 55.4%、超過 65% 的占 4%。
     這是一條**本來就很寬**的分布（漏斗亂竄，賴在建築上的那幾趟就是會啃掉一大半），
     所以任何一條線用一趟去比都是在擲骰子：0.35 這條線單趟踩破的機率就是那 4%。
     改成**掃三趟取中位**（見上面）：要兩趟都超過 65% 才會紅，機率掉到 0.5%。
     門檻 0.35 一個字都沒動——「整段刨掉」（八成以上）照樣抓得出來。

     **v1.151：上限那一半退場了**（使用者選的，事先講過會撞到這條線）。
     使用者要「整體效果加速兩倍」，選的是「動作 ×2 ＋ 每秒吸走加倍、壽命不變」：
     速度乘 2 之後一趟走的路變兩倍長（77 → 154 單位）、罩過的地方多一倍，
     每秒又從 0.46 啃到 0.71。同一組參數重量 24 趟：
     34.0／36.1／36.7／39.1／39.3／40.6／41.6／41.9／44.5／47.1／48.5／48.9／
     56.8／59.2／64.4／72.2／73.2／90.4／93.9／93.9／94.6／94.6／95.4／95.9
     ——中位 52.9%，而且 24 趟裡有 7 趟（29%）啃掉九成以上。
     也就是說 v1.62 使用者指定的「不會整段刨掉」，在這一版**已經不成立了**：
     漏斗賴在建築上的那幾趟就是會把整座刨掉。硬留著上限只是每三輪紅一次。
     所以這一條改成只守**下限**（真的有在吸：三趟取中位至少啃掉 25%，實測單趟最少 34%）
     ＋一條「不會連一塊都不剩」。要把上限那條線要回來的話，得改回去
     「時間軸壓縮一半」那種加速（壽命 10 → 5 秒），那才是總量不變的加速。 */
  ok('龍捲風掃過去會吸走一大片（v1.151 起連整座刨掉都在正常範圍）',
     twR.after < twR.before * 0.75 && twR.after > twR.before * 0.01,
     'SET ' + twR.before + ' → ' + twAll.map(t => t.after).join('／') +
     '（三趟少了 ' + twAll.map(t => ((1 - t.after / t.before) * 100).toFixed(0)).join('／') +
     '%，取中位 ' + ((1 - twR.after / twR.before) * 100).toFixed(0) + '%）');
  ok('龍捲風結束後積木都會落地',
     twAll.every(t => t.gone && t.flying === 0),
     '三趟還在飛 ' + twAll.map(t => t.flying).join('／') + ' 塊');

  /* 「吸走破壞是持續性的」（v1.87，使用者指定）：罩著不走就一路啃下去，每秒 TW_TAKE 成。
     v1.62～v1.86 是「同一道對同一塊只抽一次」（抽過就用 b.twSkip 記著），所以停在
     建築上啃完那一口就再也不動它——那時候量到的是「整段壽命下來就是兩成」。
     這裡把一道釘在建築上不讓它走，看每一秒累計吸走幾成：要一路往上長，
     而且貼著 1−(1−TW_TAKE)^t（v1.151 的 0.71：一秒 0.710、兩秒 0.916、三秒 0.976；
     v1.123 的 0.46 是 0.460／0.708／0.843、v1.116 的 0.35 是 0.350／0.578／0.725、
     v1.115 的 0.2 是 0.200／0.360／0.488）。實測 0.708／0.919／0.978。
     釘的方式是每幀把座標推回去（stepTwist 每幀都會重算速度，改速度沒用）。
     藍圖指定新天鵝堡：分母要夠大抽樣誤差才壓得下去，隨機藍圖抽到中央是空的
     （金門大橋）會一塊都選不到，量到的就是 0/0。 */
  const twTake = await page.evaluate(() => {
    cleanTools();
    shapePick = SHAPES.findIndex(s => s.n === '新天鵝堡');
    targetCnt = 3000; startBuild(true); completeNow();
    shapePick = -1;
    const at = { x: siteR * 0.3, z: 0 };
    launchTornado(at);
    const w = twists[0];
    /* 量的時候把垮塌關掉（v1.116）：被吸走的那些一撐不住，上面會連帶垮下來，
       而垮下來的也不再是 SET，全算進分子裡。TW_TAKE 0.2 時那部分還藏得住
       （所以原本只放寬上緣 +0.10），拉到 0.35 之後分母剩得少、連帶的比例跟著放大——
       實測三秒量到 80.8%（理論 72.5%）。這一條要驗的是「每秒啃掉幾成」這條規則本身，
       所以停掉 markSupportDirty，量完再裝回去。 */
    const origDirty = markSupportDirty;
    markSupportDirty = () => {};
    // 一開始就在漏斗範圍內、而且還站著的那些：分母只算這批
    const near = blocks.filter(b => b.st === 3 &&
                                    Math.hypot(b.x - at.x, b.z - at.z) < w.r && b.y < w.h);
    const got = [], want = [];
    let secs = 0;
    while (twists && secs < 3.1) {
      /* 釘住不讓它飄走。先釘再 step、連速度一起歸零（v1.128.1）：
         stepTwist 啃的是「移動之後」的位置，理由見下一條 twRate 的註解。 */
      twists[0].x = at.x; twists[0].z = at.z; twists[0].vx = 0; twists[0].vz = 0;
      step(0.03); secs += 0.03;
      if (got.length < 3 && secs >= got.length + 1) {
        got.push(+(near.filter(b => b.st !== 3).length / near.length).toFixed(3));
        want.push(+(1 - Math.pow(1 - TW_TAKE, got.length)).toFixed(3));
      }
    }
    markSupportDirty = origDirty;
    return { n: near.length, got, want };
  });
  /* 容許 ±0.06：分母幾百塊，抽樣誤差本來就有兩三個百分點。v1.116 起垮塌在量的時候
     是關掉的（見上面），所以不必再為「連帶垮下來的」放寬上緣——實測三秒 74.8%／70.4%
     （理論 72.5%），兩個 dt 都在 ±0.03 以內。 */
  ok('龍捲風罩著不走就一路啃下去，每秒啃掉的比例照 TW_TAKE 走',
     twTake.n > 200 && twTake.got.length === 3 &&
     twTake.got.every((v, i) => v > twTake.want[i] - 0.06 && v < twTake.want[i] + 0.10),
     '釘在原地：範圍內 ' + twTake.n + ' 塊，每秒累計吸走 ' +
     twTake.got.map((v, i) => (v * 100).toFixed(0) + '%（理論 ' +
     (twTake.want[i] * 100).toFixed(0) + '%）').join('、'));

  /* 每幀的機率是 1−(1−兩成)^dt 換算出來的，不是每幀直接抽兩成——後者一秒 33 幀
     等於當場啃光。所以同樣三秒，幀率差六倍也要啃掉一樣多。 */
  /* 釘的方式要「**先釘再 step**」，而且連速度一起歸零（v1.128.1 修間歇性失敗）。
     stepTwist 是「先把漏斗往前移，再拿移完的位置去啃」——step 完才把座標推回來的話，
     那一幀啃的是**偏掉的位置**，範圍邊緣那些積木當幀就不在半徑內。偏多少跟 dt 成正比：
     dt 0.016 只偏 0.13，dt 0.1 偏到 0.9，於是粗 dt 系統性地少啃。
     實測 8 趟：粗 dt 平均 0.814（理論 0.843，低 2.9 個百分點）、最低 0.803，
     配上 ±0.06 的容許值就是壓在邊界上——這一條的間歇性失敗就是這麼來的。
     先釘再 step 之後兩個 dt 都回到理論值上（細 0.843、粗 0.841）。
     每個 dt 量兩趟取平均：抽樣標準差實測約 0.018，平均兩趟壓到 0.013，
     ±0.06 就有 4.7 個標準差的餘裕。 */
  const twRate = await page.evaluate(() => {
    const run = dt => {
      cleanTools();
      shapePick = SHAPES.findIndex(s => s.n === '新天鵝堡');
      targetCnt = 3000; startBuild(true); completeNow();
      shapePick = -1;
      const at = { x: siteR * 0.3, z: 0 };
      launchTornado(at);
      const w = twists[0];
      const near = blocks.filter(b => b.st === 3 &&
                                      Math.hypot(b.x - at.x, b.z - at.z) < w.r && b.y < w.h);
      const origDirty = markSupportDirty;
      markSupportDirty = () => {};        // 同上：連帶垮下來的不算（v1.116）
      let t = 0;
      while (twists && t < 3) {
        // 先釘再 step：stepTwist 啃的是「移動之後」的位置，見上面那段註解
        twists[0].x = at.x; twists[0].z = at.z; twists[0].vx = 0; twists[0].vz = 0;
        step(dt); t += dt;
      }
      markSupportDirty = origDirty;
      return near.filter(b => b.st !== 3).length / near.length;
    };
    const avg2 = dt => +((run(dt) + run(dt)) / 2).toFixed(3);
    return { fine: avg2(0.016), coarse: avg2(0.1),
             want: +(1 - Math.pow(1 - TW_TAKE, 3)).toFixed(3) };
  });
  ok('啃掉幾成跟幀率無關（每幀的機率是換算出來的）',
     twRate.fine > twRate.want - 0.06 && twRate.fine < twRate.want + 0.06 &&
     twRate.coarse > twRate.want - 0.06 && twRate.coarse < twRate.want + 0.06 &&
     Math.abs(twRate.fine - twRate.coarse) < 0.08,
     '同樣三秒：dt 0.016 吸走 ' + (twRate.fine * 100).toFixed(0) + '%、dt 0.1 吸走 ' +
     (twRate.coarse * 100).toFixed(0) + '%（理論 ' + (twRate.want * 100).toFixed(0) + '%）');

  /* 積木照 TW_TAKE 抽，碎料不抽：地上的碎塊照樣全部捲上天，
     不然「龍捲風」看起來會像只在建築上戳幾個洞。 */
  const twDebris = await page.evaluate(() => {
    /* 藍圖要指定：素材是「落點附近 4 單位內還站著的積木」，隨機藍圖抽到那一帶
       本來就是空的（金門大橋、巨石陣）就一塊都撈不到，量到的是 0 塊捲起 0 塊。 */
    cleanTools();
    shapePick = SHAPES.findIndex(s => s.n === '新天鵝堡');
    targetCnt = 3000; startBuild(true); completeNow();
    shapePick = -1;
    const at = { x: siteR * 0.35, z: 0 };
    // 就地灑一圈碎料：拿範圍內的積木打下來當素材，位置不動（st 0 = FREE）
    const junk = blocks.filter(b => b.st === 3 &&
                                    Math.hypot(b.x - at.x, b.z - at.z) < 4).slice(0, 40);
    for (const b of junk) breakBlock(b, 0, 0, 0);
    for (let i = 0; i < 60; i++) step(0.05);        // 三秒：讓它們落地變成 FREE
    const rest = junk.filter(b => b.st === 0);
    launchTornado(at);
    let up = 0;
    for (let i = 0; i < 40; i++) {
      step(0.03);
      if (twists) { twists[0].x = at.x; twists[0].z = at.z; }
      up = Math.max(up, rest.filter(b => b.st === 4).length);
    }
    twists = null; ENG.putTornados([]);
    return { n: rest.length, up };
  });
  ok('腳下的碎料全部捲走，不受 TW_TAKE 那條抽籤限制',
     twDebris.n >= 10 && twDebris.up >= twDebris.n * 0.9,
     '地上 ' + twDebris.n + ' 塊碎料 → 捲起 ' + twDebris.up + ' 塊');

  /* 龍捲風持續好幾秒，如果每幀都加震動，畫面會一路晃到結束 */
  const twShake = await page.evaluate(() => {
    startBuild(true); completeNow();
    ENG.cam.shake = 0;
    launchTornado({ x: siteR * 0.5, z: 0 });
    let peak = 0;
    for (let i = 0; i < 120; i++) { step(0.03); peak = Math.max(peak, ENG.cam.shake); }
    return { peak, alive: !!twists };
  });
  ok('龍捲風不會讓畫面一直晃', twShake.peak < 0.05,
     '整段期間畫面震動峰值 ' + twShake.peak.toFixed(3) + '（龍捲風仍在作用 ' + twShake.alive + '）');

  /* 同時好幾道：每道各走各的、各轉各的，超過上限就擠掉最早那道。
     全部對著工地中心衝的話幾秒後會疊成一團，所以起始方向要帶點偏差——
     量「最近的兩道相距多遠」最能抓到這件事。 */
  const twMany = await page.evaluate(() => {
    /* 挑萬里長城、建材給滿：四道同時掃很快就把整棟夷平，那會觸發自動換場、
       把龍捲風一起收掉，測到的就不是「同時存在幾道」而是換場時機。
       長城拉得長，一次只咬得到一段（實測單道掃完還剩五到九成）。 */
    shapePick = SHAPES.findIndex(s => s.n === '萬里長城');
    targetCnt = 3000; startBuild(true); completeNow();
    for (let k = 0; k < 6; k++)                    // 故意多丟兩道，測上限
      launchTornado({ x: Math.cos(k * 1.6) * siteR * 0.8, z: Math.sin(k * 1.6) * siteR * 0.8 });
    const born = twists.length;
    const spins = twists.map(w => +w.spin.toFixed(2));
    const spinsRaw = twists.map(w => w.spin);
    /* 0.6 秒（v1.151，本來 1.2 秒）。**量測點跟著速度換算，門檻沒動**：
       只給一個點的 launchTornado 是「朝工地中心掃」，四道從半徑 23 的圓上出發
       等於四道對衝，最近距離本來就會一路收窄——實測每 0.1 秒是
       28.9／26.8／24.8／22.8／20.5／17.8／15.0／12.3／9.6／7.2／5.2／4.6。
       v1.151 速度乘 2 之後，1.2 秒剛好落在交會點上（4.6），而 0.6 秒（15.0）
       走的路 9.4 單位跟舊版 1.2 秒完全一樣——同一個幾何時刻，同一條門檻。
       這一條要驗的是「各走各的，不是黏成一團同步移動」，不是「永遠不交會」。 */
    for (let i = 0; i < 30; i++) step(0.02);
    const alive = twists ? twists.length : 0;
    let gap = 1e9;
    for (let i = 0; i < alive; i++)
      for (let j = i + 1; j < alive; j++)
        gap = Math.min(gap, Math.hypot(twists[i].x - twists[j].x, twists[i].z - twists[j].z));
    /* 相異與否要看原始值，不能看顯示用的兩位小數：兩個獨立亂數差不到 0.005 的機會
       約 1%，用四捨五入後的字串比會偶發假失敗（實際踩過一次）。 */
    return { born, alive, spins, gap: +gap.toFixed(1), max: TW_MAX,
             same: new Set(spinsRaw).size };
  });
  ok('龍捲風可以同時存在好幾道', twMany.born === twMany.max && twMany.alive === twMany.max,
     '連丟 6 道 → 場上 ' + twMany.born + ' 道（上限 ' + twMany.max + '，多的把最早那道擠掉）');
  ok('每一道各轉各的', twMany.same === twMany.born,
     '起始角度 ' + JSON.stringify(twMany.spins) + '（都一樣的話幾道會擺出同一個姿勢）');
  ok('幾道不會疊在同一點', twMany.gap > 6,
     '0.6 秒後最近的兩道相距 ' + twMany.gap + ' 單位（v1.150 之前是量 1.2 秒，' +
     '那時候的速度走一樣的路）');

  /* 一道跟四道畫起來一樣貴：每一層是一顆 InstancedMesh，場上幾道只是多幾個 instance */
  const twCalls = await page.evaluate(() => {
    cleanTools(); startBuild(true); completeNow();
    draw(); ENG.render();
    const idle = ENG.info().calls;
    launchTornado({ x: siteR * 0.5, z: 0 });
    for (let i = 0; i < 10; i++) step(0.02);
    draw(); ENG.render();
    const one = ENG.info().calls;
    for (let k = 0; k < 3; k++) launchTornado({ x: -siteR * 0.5, z: siteR * 0.4 * (k - 1) });
    for (let i = 0; i < 10; i++) step(0.02);
    draw(); ENG.render();
    const four = ENG.info().calls;
    twists = null; ENG.putTornados([]);
    draw(); ENG.render();
    return { idle, one, four, after: ENG.info().calls };
  });
  ok('多幾道龍捲風不會多吃 draw call', twCalls.four === twCalls.one && twCalls.one > twCalls.idle,
     '沒有 ' + twCalls.idle + ' 個、一道 ' + twCalls.one + ' 個、四道 ' + twCalls.four + ' 個');
  ok('收掉之後畫面成本回到原點', twCalls.after === twCalls.idle, twCalls.after + ' 個');

  /* 漏斗拉高到 34 之後會頂出畫面上緣（矮建築取景近，改之前量到 NDC 1.45）。
     跟蘑菇雲同一套：鏡頭退到這個效果進得了畫面的距離，而且退開之後就停在那裡不收回來。 */
  const twFrame = await page.evaluate(() => {
    /* 「這一發要退到多遠」直接問 holdWide：把視距壓到最近再問一次，答案就是它要的距離。
       這樣測試不必自己複製一份公式；下面的 startBuild(true) 會照建築重新取景，把這裡動過的蓋掉。 */
    ENG.camTarget.dist = 6; ENG.camTarget.ty = 0; ENG.holdWide(TW_H, TW_R);
    const need = ENG.camTarget.dist;
    shapePick = SHAPES.findIndex(s => s.n === '新天鵝堡');
    targetCnt = 1200; startBuild(true); completeNow();
    // startBuild(true) 走的是開場那條，會立刻照這座重新取景，量到的就是「原本的取景」
    const nat = ENG.camTarget.dist;
    launchTornado({ x: siteR * 0.5, z: 0 });
    for (let i = 0; i < 110; i++) step(0.02);
    const wide = ENG.cam.dist;
    const w = twists[0];
    const top = new THREE.Vector3(w.x, w.h, w.z).project(ENG.three.camera).y;
    // 龍捲風散掉、換場都做完之後再量一次：鏡頭不該自己跑回去
    for (let i = 0; i < (TW_LIFE + 4) * 50; i++) step(0.02);
    const back = ENG.camTarget.dist;
    return { nat: +nat.toFixed(1), need: +need.toFixed(1), wide: +wide.toFixed(1),
             top: +top.toFixed(2), back: +back.toFixed(1) };
  });
  ok('龍捲風期間漏斗頂留在畫面內', twFrame.top < 0.95 && twFrame.top > -1,
     '取景 ' + twFrame.nat + ' → ' + twFrame.wide + '，漏斗頂 NDC ' + twFrame.top);
  /* 「退到看得完整」與「退過頭」是兩件事：距離取的是「原本的取景」與「這一發要的」之中的大者，
     本來就夠遠就不該再往後推（矮建築才會真的退）。差 1.5 是 cam.dist 追 camTarget 的殘差。 */
  ok('鏡頭只退到看得完整那麼遠，不會多退一截',
     Math.abs(twFrame.wide - Math.max(twFrame.nat, twFrame.need)) < 1.5,
     '取景 ' + twFrame.nat + '、龍捲風要 ' + twFrame.need + ' → 實際 ' + twFrame.wide);
  ok('龍捲風結束後鏡頭停在退開的位置', twFrame.back >= twFrame.wide - 1,
     twFrame.nat + ' → ' + twFrame.wide + '，七秒後仍是 ' + twFrame.back);

  /* 持續時間拿城堡量：金字塔是實心堆疊，被掃到底層整座垮下來會提早換場，
     量到的就不是龍捲風自己的壽命（實測 4 次有 2 次被砍到 2.6 秒）。 */
  const twLife = await page.evaluate(() => {
    targetCnt = 2400; startBuild(true); completeNow();
    for (let i = 0; i < 40; i++) step(0.05);
    launchTornado({ x: siteR * 0.5, z: 0 });
    let secs = 0;
    while (twists && secs < 15) { step(0.02); secs += 0.02; }
    // 還原成這一段開始前的狀態（後面幾個測試接著用城堡 1200）
    shapePick = SHAPES.findIndex(s => s.n === '新天鵝堡'); targetCnt = 1200;
    return { secs: +secs.toFixed(2), life: TW_LIFE };
  });
  ok('龍捲風持續時間跟設定一致', Math.abs(twLife.secs - twLife.life) < 0.2,
     '撐了 ' + twLife.secs + ' 秒（設定 ' + twLife.life + ' 秒）');

  const hitShake = await page.evaluate(() => {
    startBuild(true); completeNow();
    ENG.cam.shake = 0;
    const cand = blocks.filter(b => b.st === 3 && b.y > 3);
    const t = cand[Math.floor(cand.length * 0.5)];
    launchHammer(new THREE.Vector3(t.x, t.y, t.z), new THREE.Vector3(0.3, -0.8, 0.5).normalize());
    let peak = 0;
    for (let i = 0; i < 40; i++) { step(0.02); peak = Math.max(peak, ENG.cam.shake); }
    return peak;
  });
  ok('槌子這種單次撞擊仍然會震一下', hitShake > 0.2, '震動峰值 ' + hitShake.toFixed(2));

  /* 落點要用格子重驗一次（fixHit，v1.85）。`pick` 是對**畫出來的積木**做射線判定，
     而積木畫出來只有 0.94 格寬（BS），上下左右都留 0.06 格的縫——射線正對著縫或很擦邊
     地飛過去時真的鑽得過去，於是回報打到牆**後面**的東西。使用者先在水桶上看到
     （「點杯壁內側，出水點卻穿過建築，變成在背後的地面出水」），其他工具同一條路：
     明明敲在牆上，卻是後面那一塊、或後面的地板受害。 */
  const fixT = await page.evaluate(() => {
    cleanTools();
    targetCnt = 3000;
    shapePick = SHAPES.findIndex(s => s.n === '經典馬克杯');
    startBuild(true); completeNow();
    const mx = cellX(0), mz = cellZ(0);
    const y0 = 12;
    let wall = 0;
    while (wall < 14 && !solidAt(mx + wall, y0, mz)) wall++;   // 杯壁從第幾格開始
    const far = wall + 9;                                     // 牆外面很遠的地上
    const out = { wall, far };

    /* ① 穿牆的那一下：pick 說打到牆外 far 格的地板上。重驗之後應該變成
       「打在牆的內側」——kind 從 ground 變 block，落點退回牆這一側。 */
    const bad = { kind: 'ground', idx: -1, point: { x: wldX(mx + far), y: 0, z: wldZ(mz) },
                  dir: { x: 0.55, y: -0.83, z: 0 }, dist: 21 };
    const f = fixHit(bad);
    out.fixed = { kind: f.kind, r: +(cellX(f.point.x) - mx + 0).toFixed(1),
                  y: +f.point.y.toFixed(1) };
    /* 真的用槌子砸下去（跟 onUp 同一條路：fixHit → useTool）：
       這一下要是砸在牆上（不是砸空地），而且真的敲掉積木。 */
    tool = 'hammer';
    const n0 = placedCnt;
    useTool(f);
    out.swing = swing ? { ground: !!swing.ground, r: cellX(swing.px) - mx } : null;
    for (let i = 0; i < 90; i++) step(1 / 60);
    out.broke = n0 - placedCnt;
    /* 對照組：不重驗就照著 pick 給的落點砸下去（v1.85 之前的行為）
       ——砸的是牆後面的**地板**，牆一塊都不會掉。 */
    cleanTools(); startBuild(true); completeNow();
    tool = 'hammer';
    const m0 = placedCnt;
    useTool(bad);
    out.raw = swing ? { ground: !!swing.ground, r: cellX(swing.px) - mx } : null;
    for (let i = 0; i < 90; i++) step(1 / 60);
    out.rawBroke = m0 - placedCnt;

    /* ② 正常的那一下**不能被動到**：從天上直直砸最高那一塊的頂面，
       射線一路都是空的，fixHit 要原封不動把同一個物件回傳。 */
    cleanTools(); startBuild(true); completeNow();
    let top = null;
    for (const b of blocks) if (b.st === 3 && (!top || b.y > top.y)) top = b;
    const good = { kind: 'block', idx: blocks.indexOf(top),
                   point: { x: top.x, y: top.y + HB, z: top.z },
                   dir: { x: 0, y: -1, z: 0 }, dist: 20 };
    out.same = fixHit(good) === good;
    // ③ 點空地也不能被動到（射線上沒有任何積木）
    const grass = { kind: 'ground', idx: -1,
                    point: { x: siteR + 12, y: 0, z: siteR + 12 },
                    dir: { x: 0.3, y: -0.9, z: 0.3 }, dist: 30 };
    out.sameGround = fixHit(grass) === grass;
    cleanTools();
    return out;
  });
  ok('射線鑽過積木縫的那一下，會被拉回真正擋在前面的那面牆',
     fixT.fixed.kind === 'block' && fixT.fixed.r < fixT.wall && fixT.fixed.r > 0,
     '餵一個「穿過牆、打到牆外 ' + fixT.far + ' 格地板」的 hit（牆從第 ' + fixT.wall +
     ' 格開始）：重驗成 ' + fixT.fixed.kind + '、落點退到離軸心 ' + fixT.fixed.r +
     ' 格、第 ' + fixT.fixed.y + ' 層高');
  ok('所以槌子砸的是那面牆，不是牆後面的地板',
     fixT.swing && fixT.swing.ground === false && fixT.swing.r < fixT.wall &&
     fixT.broke > 0 && fixT.raw && fixT.raw.ground === true &&
     fixT.raw.r > fixT.wall && fixT.rawBroke === 0,
     '重驗過：落在離軸心 ' + (fixT.swing ? fixT.swing.r : '—') + ' 格、砸空地 ' +
     (fixT.swing ? fixT.swing.ground : '—') + '，敲掉 ' + fixT.broke +
     ' 塊；照著 pick 給的落點砸：離軸心 ' + (fixT.raw ? fixT.raw.r : '—') +
     ' 格、砸空地 ' + (fixT.raw ? fixT.raw.ground : '—') + '，敲掉 ' +
     fixT.rawBroke + ' 塊');
  ok('正常的那一下不會被改到（打到積木、點空地都原封不動）',
     fixT.same && fixT.sameGround,
     '從天上砸最高那一塊 ' + fixT.same + '、點遠處空地 ' + fixT.sameGround);

  /* ══════════ 王之財寶（v1.132）══════════
     使用者指定的順序就是這一段的骨架：點地面 → 參考鏡頭方向開出一整片金色的圓
     （由小而大）→ 冷兵器從圓心慢慢伸出來、一半留在圓外 → 全部就位後停 3 秒 →
     對範圍隨機位置連射 7 秒（不規則，不是一波一波）→ 射出去的圓縮小消失、
     換個位置再開 → 打中積木造成破壞（**沒有燃燒效果**）、兵器掉到地面，
     打中地面就插在地上 → 最後都慢慢消失。每一件事一條。 */
  await head('王之財寶');
  await reset(page, { shape: '吉薩金字塔', cnt: 3000, workers: 0 });
  /* 用 completeNow 不用 fillAll：fillAll 不會收掉整地推土機，剛擺好的最底層
     會被還在場上的推土機推散，那不是道具幹的（跟打雷那一段同一個理由）。 */
  await page.evaluate(() => completeNow());
  const gate1 = await page.evaluate(() => {
    marks.length = 0; dust.length = 0; clearFires();
    /* 每一發的時刻、打中什麼，都從真的那三支函式攔下來記——
       讀狀態的話只看得到「現在」，看不出七秒裡的分布。 */
    const shots = []; let hitB = 0, hitG = 0, stuck = null, fell = null;
    const oFire = fireGate, oHit = hitWeapon, oStick = stickWeapon;
    /* 落點離場心多遠（v1.132.2 使用者：「瞄準的方向太散了 要集中到點擊的附近」）。
       三個收場都要記：打中積木停在半空的、插在地上的、躺在地上的。 */
    const oLie = lieWeapon;
    const land = [];
    /* **一把只記一次**：打中積木的那一把會先進 hitWeapon（停在撞擊點）、掉到地上再進
       lieWeapon，記兩次的話近的那些會被算兩遍，分布看起來比實際集中。 */
    const mark = w => { if (!w.__mark) { w.__mark = 1; land.push(Math.hypot(w.x, w.z)); } };
    lieWeapon = w => { mark(w); oLie(w); };
    /* 出手方向背對鏡頭的（凹面鏡把邊上那排往前推之後要重驗，見 GATE_BOWL）。
       攔 newWeapon 是因為方向在生出來那一刻就定了，之後讀不到「當初瞄哪」。 */
    const oNew = newWeapon;
    let back = 0, fat = 0;
    newWeapon = (g, q) => {
      const w = oNew(g, q);
      if (w) {
        if (w.dx * g.ax + w.dy * g.ay + w.dz * g.az <= 0) back++;
        /* 這一把最粗的一塊有多粗（世界單位）。桿／環取「橫斷面兩邊都不小」的那一個
           ＝ min(x, z)——護手與斧面的寬度是輪廓，不算粗細。在這裡量是因為
           weapons 到最後會清空，事後撈不到。 */
        for (const P of ENG.WEAP_KIND[w.k]) fat = Math.max(fat, Math.min(P.s[0], P.s[2]) * w.len);
      }
      return w;
    };
    let T = 0;
    /* 連射時間到之後還有**收尾**那一段（v1.136，使用者：「結束的時候繼續把還有武器的
       門射完」）：不再開新的門，把還裝著兵器的門射完才收。所以每一發要記是哪一段射的。
       順便攔 dropWeapon：v1.135 之前時間一到就把還裝著的兵器整批撤掉（憑空消失），
       現在那個數字該是 0。 */
    const oDropW = dropWeapon;
    let dropped = 0;
    dropWeapon = w => { dropped++; oDropW(w); };
    fireGate = (g, p) => { if (p.st === 'ready') shots.push({ t: +T.toFixed(3), ph: g.ph }); oFire(g, p); };
    hitWeapon = w => {
      hitB++; mark(w); oHit(w);
      // 打中積木的：當場轉成會翻滾的掉落物（使用者：「兵器掉到地面」）
      if (!fell) fell = { st: w.st, vy: +w.vy.toFixed(2), spin: +Math.abs(w.spin).toFixed(1) };
    };
    stickWeapon = w => {
      hitG++; mark(w); oStick(w);
      // 插在地上的：刃尖沒入地面、柄還斜著露在外面
      if (!stuck) stuck = { st: w.st, tip: +(w.y + w.dy * w.len * 0.5).toFixed(2),
                            y: +w.y.toFixed(2), lie: +w.lie.toFixed(2) };
    };
    /* 兵器離門心多遠、在指向的哪一邊。負的＝整把還縮在門後面，
       0 ＝ 正中間卡在門上（＝一半在門外，使用者指定的就位姿勢）。 */
    const off = p => {
      const w = p.w;
      return w ? (w.x - p.x) * w.dx + (w.y - p.y) * w.dy + (w.z - p.z) * w.dz : NaN;
    };
    tool = 'gate';
    /* 兩段點擊（v1.135）：第一下門陣、第二下目標。門陣點在 v1.135 之前那個取景
       （鏡頭方向、目標的另一側 GATE_BACK 遠，同 installClean 的 gateAt），這一段量到的
       落點分布、集中度、打擊數才跟 v1.132～v1.134 的紀錄可比。 */
    const gyaw = ENG.cam.yaw;
    useTool({ point: new THREE.Vector3(-Math.cos(gyaw) * GATE_BACK, 0, -Math.sin(gyaw) * GATE_BACK),
              dir: new THREE.Vector3(0, -1, 0) });
    useTool({ point: new THREE.Vector3(0, 0, 0), dir: new THREE.Vector3(0, -1, 0) });
    const born = gates[0].ports.length, n0 = placedCnt;
    /* 門陣的弧度（使用者：「就位也可以加一點弧度（像凹面鏡）」）：每個門沿視軸離場心多遠。
       中間最深、邊上最淺 ＝ 凹的。順便記近面（最淺的那個），它要遠大於落點能落到的深度。 */
    const depth = gates[0].ports.map(q => ({
      u: Math.abs((q.x - gates[0].cx) * gates[0].ux + (q.z - gates[0].cz) * gates[0].uz),
      d: (q.x - gates[0].x) * gates[0].fx + (q.z - gates[0].z) * gates[0].fz
    }));
    const mid = depth.filter(q => q.u < 6), rim = depth.filter(q => q.u > 24);
    const avg = a => a.reduce((x, q) => x + q.d, 0) / (a.length || 1);
    const bowl = { mid: +avg(mid).toFixed(1), rim: +avg(rim).toFixed(1),
                   near: +Math.min.apply(null, depth.map(q => q.d)).toFixed(1),
                   nMid: mid.length, nRim: rim.length };
    const grow = [];
    let ready = -1, out0 = null, out1 = null, maxW = 0, maxG = 0, reopen = 0;
    const fired = new Set();
    /* 26 秒：開門 1.5+0.55+0.7 ＋ 停 2 ＋ 連射 7 ＋ 收尾約 2.5（v1.136）＋ 最後一把
       插在地上撐 2.8 再淡 1.6 ＝ 最壞 18.7 秒，留一點餘裕。
       跑不完的話量到的會是「還沒收乾淨」。 */
    let preOut = -1, preN = 0;
    while (T < 26) {
      step(1 / 60); T += 1 / 60;
      if (gates) {
        /* 開場 0.3 秒：還沒輪到出場的門（p.t < 0），裡面那把兵器整把都該在切面後面
           ＝ 一點都看不見（使用者：「同心波紋先出現 然後武器才伸出來」）。
           量的是「刃尖有沒有越過切面」，不是「有沒有這把兵器」。 */
        if (preOut < 0 && T >= 0.3) {
          preOut = 0;
          for (const p of gates[0].ports) if (p.t < 0 && p.w) {
            preN++;
            if (off(p) + p.w.len * 0.5 > 0.001) preOut++;
          }
        }
        // 剛開始伸的那一把：整把應該還在門後面
        if (out0 === null) {
          const p = gates[0].ports.find(q => q.st === 'draw');
          if (p) out0 = +(off(p) / p.w.len).toFixed(3);
        }
        // 全部就位那一刻：每一把都該正中間卡在門上
        if (ready < 0 && gates[0].ph !== 'open') {
          ready = +T.toFixed(2);
          out1 = +(gates[0].ports.reduce((a, p) => a + off(p), 0) / gates[0].ports.length).toFixed(4);
        }
        // 射過又在別的位置重開的門（使用者：「可以又在其他位置出現」）
        for (const p of gates[0].ports) {
          if (p.st === 'shut') fired.add(p);
          else if (p.st === 'grow' && fired.has(p)) { fired.delete(p); reopen++; }
        }
        maxG = Math.max(maxG, gateList().length);
        /* 第一個取樣點從 0.2 秒起（原本是 0.4 秒）。這一條要驗的是「由小而大張開」，
           而門檻 grow[0] < 0.3 是「才剛開始張」的守門值——問題是 0.4 秒那一刻的平均
           本身在 0.13～0.27 之間晃（每一個門的起始錯開是隨機的），**分布的上緣就壓在
           門檻上**，實測 --seed 3377532606 抽到剛好 0.30 就紅了。取樣點往前挪到 0.2 秒，
           量到的是 0.06～0.15，離門檻有兩倍餘裕；門檻一個字都沒動。 */
        while (grow.length < 6 && T >= 0.2 + grow.length * 0.4)
          grow.push(+(gates[0].ports.reduce((a, p) => a + p.k, 0) / gates[0].ports.length).toFixed(2));
      }
      if (weapons) maxW = Math.max(maxW, weapons.length);
    }
    fireGate = oFire; hitWeapon = oHit; stickWeapon = oStick;
    lieWeapon = oLie; newWeapon = oNew; dropWeapon = oDropW;
    // 連射那七秒與收尾分開算（見上面的說明）
    const fireS = shots.filter(q => q.ph === 'fire').map(q => q.t);
    const drainS = shots.filter(q => q.ph === 'drain').map(q => q.t);
    // 每半秒幾發：不規則連射看的是「每一格都有、而且差不多多」
    const t0 = fireS[0], t1 = fireS[fireS.length - 1];
    const buck = [];
    for (const t of fireS) {
      const i = Math.floor((t - t0) / 0.5);
      while (buck.length <= i) buck.push(0);
      buck[i]++;
    }
    const r = {
      born, want: GATE_N, grow, out0, out1, ready, reopen,
      n: fireS.length, nDrain: drainS.length, dropped,
      tail: drainS.length ? +(drainS[drainS.length - 1] - t1).toFixed(2) : 0,
      first: +t0.toFixed(2), span: +(t1 - t0).toFixed(2),
      gap: +(t0 - ready).toFixed(2), buck, lo: Math.min(...buck), hi: Math.max(...buck),
      hitB, hitG, stuck, fell, broke: n0 - placedCnt, n0,
      fires: fires ? fires.length : 0, burn: blocks.filter(b => b.burn > 0).length,
      maxW, maxG, keep: WEAP_KEEP, wmax: ENG.WEAP_MAX, gmax: ENG.GATE_MAX,
      left: (gates ? 1 : 0) + (weapons ? weapons.length : 0),
      rate: GATE_RATE, fire: GATE_FIRE, hold: GATE_HOLD,
      preOut, preN, back, bowl,
      zone: +gateZone().toFixed(1), strikeR: STRIKE_R,
      land: (() => {
        const d = land.sort((a, b) => a - b), q = f => +d[Math.floor(d.length * f)].toFixed(1);
        const far = gateZone() * 2.2;
        return { n: d.length, med: q(0.5), p75: q(0.75), p90: q(0.9),
                 max: +d[d.length - 1].toFixed(1),
                 /* 滑出去多遠的**比例**（不是極值）：見那條 ok 的說明 */
                 farPct: +(d.filter(v => v > far).length / d.length * 100).toFixed(1) };
      })(),
      fat: +fat.toFixed(2),
      /* 比例尺：小人手上那根法杖的粗細（使用者指定拿它對照）。0.09 是法杖在
         engine 的 BODY 裡的橫斷面，乘上身高倍率的上限 W_HI ＝ 最粗的那一根。 */
      staff: +(0.09 * W_HI).toFixed(2)
    };
    cleanTools();
    return r;
  });
  /* 「一路遞增」那個斷言原本就跟程式牴觸，只是舊的取樣格線剛好跨過去沒量到：
     門是「三次方 ease-out ＋ 10% 過衝」張開的（stepGate 裡
     `p.k = e * (1 + 0.10 * sin(PI * u))`，註解寫著線性放大看起來像貼圖被拉開、
     過衝才像撐開一個洞）。取樣點往前挪之後 1.8 秒那一刻量到平均 1.01，
     於是「後面不能比前面小」當場紅——**紅的是斷言寫錯，不是程式**。
     改成照設計驗：峰值以前一路往上、過衝不超過設計的 +10%、峰值之後只會落回
     而且不掉到 1 以下、最後停在整整 1。 */
  const gGrow = gate1.grow, gPeak = gGrow.indexOf(Math.max(...gGrow));
  ok('點地面就開出一整片門，每一個都是由小而大張開的',
     gate1.born === gate1.want && gGrow[0] < 0.3 &&
     gGrow.every((k, i) => i === 0 || i > gPeak || k >= gGrow[i - 1]) &&
     gGrow.every((k, i) => i <= gPeak || k >= 1) &&
     Math.max(...gGrow) <= 1.1 &&
     gGrow[gGrow.length - 1] === 1,
     '一次開 ' + gate1.born + ' 個門；0.2 秒起每 0.4 秒量一次平均張開到幾成：' +
     gate1.grow.join(' → '));
  ok('兵器從門心伸出來，就位時一半在門外',
     gate1.out0 < -0.4 && Math.abs(gate1.out1) < 0.001,
     '剛開始伸的那一把整把縮在門後面（離門心 ' + gate1.out0 +
     ' 個全長），就位後平均離門心 ' + gate1.out1 + ' 單位＝正中間卡在門上');
  ok('全部就位後停兩秒才開始射（v1.136 從 3 秒收短）',
     Math.abs(gate1.gap - gate1.hold) < 0.4,
     '第 ' + gate1.ready + ' 秒全部就位，第 ' + gate1.first + ' 秒射出第一發（隔 ' +
     gate1.gap + ' 秒，設定 ' + gate1.hold + ' 秒）');
  ok('連射 7 秒，密度從頭到尾一樣、不是一波一波',
     Math.abs(gate1.span - gate1.fire) < 0.6 &&
     Math.abs(gate1.n - gate1.rate * gate1.fire) < gate1.rate * gate1.fire * 0.3 &&
     gate1.lo > 0 && gate1.hi < gate1.lo * 2.6,
     '射了 ' + gate1.n + ' 發、橫跨 ' + gate1.span + ' 秒（設定每秒 ' + gate1.rate +
     ' 發 × ' + gate1.fire + ' 秒）；每半秒 ' + gate1.buck.join('／') + ' 發');
  ok('連射時間到，還裝著兵器的門會射完才收（兵器不會憑空消失）',
     gate1.nDrain > 20 && gate1.dropped === 0,
     '連射的 ' + gate1.fire + ' 秒射了 ' + gate1.n + ' 發，收尾再射 ' + gate1.nDrain +
     ' 發、多花 ' + gate1.tail + ' 秒（v1.135 是把那些門連兵器一起撤掉）；' +
     '整趟被撤掉的兵器 ' + gate1.dropped + ' 把');
  ok('射出去的門縮掉，再在別的位置開一個',
     gate1.reopen > gate1.want * 0.5,
     '一趟裡有 ' + gate1.reopen + ' 次「射完換位置重開」（門共 ' + gate1.want + ' 個）');
  ok('打中積木造成破壞，兵器被擋下來掉到地面',
     gate1.hitB > 50 && gate1.broke > 300 && gate1.fell &&
     gate1.fell.st === 'fall' && gate1.fell.spin > 0,
     gate1.hitB + ' 發打中建築、掉了 ' + gate1.broke + ' 塊（共 ' + gate1.n0 +
     ' 塊）；被擋下來那一把轉成 ' + (gate1.fell ? gate1.fell.st : '—') + '、自轉 ' +
     (gate1.fell ? gate1.fell.spin : '—') + ' rad/s');
  /* 插在地上的姿勢：刃尖沒入地面、重心還在地面上。
     **樣本要自己生**（v1.133.1）：打建築那一發「插在地上」的發數是落點分布的副產品，
     一路在縮——v1.132.1 三十幾發、v1.132.2 落點收攏之後 12～23、v1.133.1 對齊打雷的
     範圍之後只剩 0～9 發（190 幾發裡 186 發直接打中建築）。門檻跟著降了兩次還是在賭骰子
     （降到 6 之後照樣抽到 0 與 3）。所以改成**在場外空地開一發**：那裡一塊積木都沒有，
     每一把都會落到地上，陡的插著、擦地的躺平，兩種樣本都必然拿得到。 */
  const gateStick = await page.evaluate(() => {
    cleanTools();
    let stick = 0, lie = 0, first = null;
    const oS = stickWeapon, oL = lieWeapon;
    stickWeapon = w => {
      oS(w);                                   // 先讓它算好落定的位置，再讀姿勢
      stick++;
      if (!first) first = { tip: +(w.y + w.dy * w.len * 0.5).toFixed(2), y: +w.y.toFixed(2),
                            lie: +w.lie.toFixed(2), st: w.st };
    };
    lieWeapon = w => { lie++; oL(w); };
    gateAt({ x: 60, z: 0 });                 // 場外空地
    let g = 0;
    while ((gates || weapons) && g++ < 900) step(0.05);
    stickWeapon = oS; lieWeapon = oL;
    cleanTools();
    return { stick, lie, first };
  });
  ok('打中地面的插在地上：刃尖沒入地面、柄還露在外面',
     gateStick.stick > 20 && gateStick.first &&
     gateStick.first.tip <= 0 && gateStick.first.y > 0 && gateStick.first.st === 'lie',
     '空地上開一發：' + gateStick.stick + ' 發插在地上、' + gateStick.lie +
     ' 發擦著地面躺平；第一把的刃尖在 y=' + gateStick.first.tip + '（地面是 0）、重心在 y=' +
     gateStick.first.y + '（打建築那一發只有 ' + gate1.hitG + ' 發落到空地上）');
  /* 使用者指定「類似打雷 但是沒有燃燒效果」。打雷那一段量過同一件事的反面
     （一朵雲劈完還有二十幾塊在燒），所以這條驗的是「一塊都沒有」。 */
  ok('沒有燃燒效果：整趟打完一塊都沒燒起來',
     gate1.fires === 0 && gate1.burn === 0,
     '打完 ' + gate1.n + ' 發，還在燒的積木 ' + gate1.burn + ' 塊、火源清單 ' +
     gate1.fires + ' 筆');
  /* 「慢慢變淡消失」（v1.132.1，使用者回報：本來是縮小）。同一把兵器一路追：
     長度不能變，變的是送進 shader 的那個不透明度。 */
  const gateFadeT = await page.evaluate(() => {
    gates = null; weapons = null; gateEnd();
    gateAt({ x: 0, z: 0 });
    let g = 0, w = null;
    while (g++ < 900 && !w) { step(0.05); w = weapons && weapons.find(q => q.st === 'lie'); }
    const len0 = w.len;
    const seq = [];
    const a = ENG.three.weapMesh.geometry.getAttribute('aFade');
    const gl = ENG.three.weapMesh.geometry.getAttribute('aGlow');
    /* 還沒開始淡的時候（插著、還在等 lie 倒數）金光要是 0——這一段拍起來得是
       一把正常的金屬兵器，不是一路都在發光。 */
    draw();
    const glow0 = +gl.array[weapons.indexOf(w) * 8].toFixed(2);
    for (let i = 0; i < 160; i++) {
      step(0.05);
      if (!weapons || weapons.indexOf(w) < 0) break;
      draw();
      const at = weapons.indexOf(w) * 8;
      seq.push([+w.fade.toFixed(2), +w.len.toFixed(2), +a.array[at],
                +w.glow.toFixed(2), +gl.array[at]]);
    }
    const r = { len0: +len0.toFixed(2), n: seq.length, glow0,
                head: seq[0], mid: seq[Math.floor(seq.length * 0.75)], tail: seq[seq.length - 1],
                lenSame: seq.every(q => Math.abs(q[1] - len0) < 0.01),
                sameAsAttr: seq.every(q => Math.abs(q[0] - q[2]) < 0.01),
                down: seq[seq.length - 1][0] < seq[0][0] - 0.5,
                /* 金光：一路只增不減、送進 shader 的跟規則那邊一致、
                   而且**爬得比不透明度掉得快**（同一刻 glow > 1 − fade）。 */
                glowUp: seq.every((q, i) => i === 0 || q[3] >= seq[i - 1][3] - 0.001),
                glowAttr: seq.every(q => Math.abs(q[3] - q[4]) < 0.01),
                glowFast: seq.every(q => q[3] >= 1 - q[0] - 0.001),
                glowFull: Math.max(...seq.map(q => q[3])),
                /* 金光滿格那一刻還剩多少不透明度（＝「一團完整的金色形體」看得見多久） */
                fullAt: (() => { const q = seq.find(s => s[3] >= 0.999); return q ? q[0] : -1; })() };
    gates = null; weapons = null; gateEnd();
    return r;
  });
  ok('插著／躺著的是「慢慢變淡」消失，長度一路不變',
     gateFadeT.lenSame && gateFadeT.down && gateFadeT.sameAsAttr && gateFadeT.tail[0] < 0.25,
     '追一把 ' + gateFadeT.n + ' 幀：不透明度 ' + gateFadeT.head[0] + ' → ' +
     gateFadeT.mid[0] + ' → ' + gateFadeT.tail[0] + '，長度一路 ' + gateFadeT.len0 +
     '（送進 shader 的 aFade 跟規則那邊一致 ' + gateFadeT.sameAsAttr + '）');
  /* 消失的時候整把化成金光（v1.148，使用者：「兵器消失時 兵器整體金色光芒的形體
     慢慢消失」）。顏色是在 shader 裡靠 aGlow 換掉的（見引擎 weapShader），所以這裡
     驗的是那個值：插著還沒淡的時候是 0、開始淡之後只增不減、爬得比不透明度掉得快、
     而且中途真的到滿格（不然「金色形體」只是個沒到位的漸層）。 */
  ok('淡出的時候整把化成金光（爬得比變淡快，中途整把是滿格的金色）',
     gateFadeT.glow0 === 0 && gateFadeT.glowUp && gateFadeT.glowAttr &&
     gateFadeT.glowFull >= 0.999 && gateFadeT.fullAt >= 0.3,
     '插著時金光 ' + gateFadeT.glow0 + '；淡出這 ' + gateFadeT.n + ' 幀裡爬到 ' +
     gateFadeT.glowFull + '，滿格那一刻還有 ' + gateFadeT.fullAt +
     ' 的不透明度（送進 shader 的 aGlow 跟規則那邊一致 ' + gateFadeT.glowAttr +
     '、一路不比 1−不透明度 低 ' + gateFadeT.glowFast + '）');
  /* 兵器材質是在 Lambert 上注入五刀做出來的（四刀是切面與淡出，第五刀是金光那份
     自發光）——加上 voxelMaterial 自己的四刀共九刀。跟積木那邊同一個風險：
     對 three 的 chunk 名字做字串取代，**取代不到不會報錯**，金光會默默消失而測試全綠。
     所以一樣數刀數。 */
  const weapCuts = await page.evaluate(() => ({
    n: ENG.three.weapMesh.material.userData.cuts,
    glow: !!ENG.three.weapMesh.geometry.getAttribute('aGlow')
  }));
  ok('兵器材質的 shader 九個注入點都真的換到了（含金光那一刀）',
     weapCuts.n === 9 && weapCuts.glow, weapCuts.n + ' / 9 刀、aGlow 屬性 ' + weapCuts.glow);

  ok('兵器最後都慢慢消失，門與兵器都收乾淨',
     gate1.left === 0 && gate1.maxW <= gate1.keep && gate1.maxW <= gate1.wmax &&
     gate1.maxG <= gate1.gmax,
     '結束後場上剩 ' + gate1.left + ' 個東西；峰值兵器 ' + gate1.maxW + ' 把（上限 ' +
     gate1.keep + '、引擎 ' + gate1.wmax + '）、門 ' + gate1.maxG + ' 片（引擎 ' +
     gate1.gmax + '）');

  /* ── v1.132.2 使用者回饋的四件事 ─────────────────────────────
     「同心波紋先出現 然後武器才伸出來」「瞄準太散 要集中到點擊附近」
     「就位加一點弧度（像凹面鏡）」「部分兵器太粗（拿小人的兵器做對照）」 */
  ok('波紋先出現，兵器才伸出來：還沒輪到出場的門，裡面那把一點都看不見',
     gate1.preOut === 0 && gate1.preN > 30,
     '開場 0.3 秒有 ' + gate1.preN + ' 個門還沒輪到出場，其中刃尖越過切面（＝看得見）的有 ' +
     gate1.preOut + ' 個');
  /* 集中度對齊**打雷**（v1.133.1 使用者：「還是太分散了 目標範圍大約是打雷
     然後有些歪出去沒關係」）。打雷的落點是硬邊界（半徑 STRIKE_R 的圓裡抽一點）：
     實測中位 9～10.8、九成位 11.7～13。兵器做不到那麼齊——它是「瞄一點、沒打到就沿直線
     滑到落地」，尾巴收不成硬邊界（試過「飛過落點就化成金光」，使用者要照舊讓它插在地上）。
     所以驗的是**中位與九成位跟打雷同一個量級**，最遠只擋「有沒有滑出場外」。 */
  /* 尾巴那一項驗的是**比例**不是極值（v1.139 改）：兩百多發裡最遠的那一發是
     整個分布最會跳的一個數，實測會在 28～30 之間晃，而門檻是 2.2 倍 ＝ 28.6——
     同一份程式碼本來就會偶爾越線，跟改了什麼無關。使用者本來就說「有些歪出去沒關係」，
     所以要擋的是「歪出去的**變多了**」，那就該用比例量。門檻沒有放寬：
     2.2 倍這條線原封不動，只是從「一發都不准超過」改成「超過的不到 2%」。 */
  ok('齊射集中在點擊處附近，範圍跟打雷同一個量級',
     gate1.land.med <= gate1.zone && gate1.land.p90 <= gate1.zone * 1.25 &&
     gate1.land.farPct <= 2,
     gate1.land.n + ' 個落點離場心：中位 ' + gate1.land.med + '、四分之三位 ' +
     gate1.land.p75 + '、九成位 ' + gate1.land.p90 + '、最遠 ' + gate1.land.max +
     '（超出 2.2 倍打擊範圍的占 ' + gate1.land.farPct + '%；打擊範圍 ' + gate1.zone +
     '、打雷是 ' + gate1.strikeR + '；v1.132.1 的瞄準規則量到的是 13.4／30／61／218）');
  ok('門陣是凹的（像凹面鏡），而且沒有一把變成背對鏡頭飛',
     gate1.bowl.rim < gate1.bowl.mid - 4 && gate1.bowl.near > 12 && gate1.back === 0,
     '中間那圈 ' + gate1.bowl.nMid + ' 個門深 ' + gate1.bowl.mid + '、最外圈 ' +
     gate1.bowl.nRim + ' 個深 ' + gate1.bowl.rim + '（越小＝越靠近鏡頭），近面 ' +
     gate1.bowl.near + '；背對鏡頭飛的 ' + gate1.back + ' 把');
  /* 射到小人（v1.133）與擊中的特效（v1.133，使用者：「王之財寶擊中時增加個打擊特效」）。
     一發打在**場外空地**上：那裡一塊積木都沒有，所以「有反應」只可能來自兵器本身
     （打在建築上的話分不清是兵器還是碎料砸到人）。小人一樣要凍住（見打雷那一段）。 */
  const gateMan = await page.evaluate(() => {
    cleanTools();
    setWorkerCount(12); targetCnt = 3000;
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    startBuild(true); completeNow(); shapePick = -1;
    for (let i = 0; i < 30; i++) step(1 / 60);
    const P = { x: 60, z: 0 };
    for (let i = 0; i < workers.length; i++) {
      const w = workers[i], a = i / workers.length * Math.PI * 2;
      w.x = P.x + Math.cos(a) * (i % 3) * 1.2; w.z = P.z + Math.sin(a) * (i % 3) * 1.2;
      w.y = 0; w.st = 'idle'; w.fall = 0; w.air = 0; w.burn = 0; w.tilt = 0;
    }
    const oUpd = updWorker, oMan = manWeapon, oHit = hitWeapon;
    updWorker = () => {};
    /* 打擊特效：撞的那一瞬間 stars／hot／flashes 各多了幾顆。量「差值」不是「總量」——
       拖尾也在往 hot 裡丟東西，總量看不出是誰加的。
       火球只認自己帶壽命那幾顆（life），爆炸類那顆不帶（見 weaponBoom）。 */
    let fx = null, man = 0, fell = 0, smashed = 0;
    hitWeapon = w => { smashed++; oHit(w); };
    manWeapon = (w, p) => {
      man++;
      const s0 = stars.length, h0 = hot.length, n0 = placedCnt;
      const f0 = flashes.filter(q => q.life).length;
      oMan(w, p);
      if (w.st === 'fall') fell++;
      if (!fx) fx = { star: stars.length - s0, hot: hot.length - h0, blocks: n0 - placedCnt,
                      flash: flashes.filter(q => q.life).length - f0 };
    };
    tool = 'gate';
    /* 兩段點擊（v1.135）：第一下門陣、第二下目標。門陣點在 v1.135 之前那個取景
       （鏡頭方向、目標的另一側 GATE_BACK 遠，同 installClean 的 gateAt），這一段量到的
       落點分布、集中度、打擊數才跟 v1.132～v1.134 的紀錄可比。 */
    const gyaw = ENG.cam.yaw;
    useTool({ point: new THREE.Vector3(P.x - Math.cos(gyaw) * GATE_BACK, 0,
                                       P.z - Math.sin(gyaw) * GATE_BACK),
              dir: new THREE.Vector3(0, -1, 0) });
    useTool({ point: new THREE.Vector3(P.x, 0, P.z), dir: new THREE.Vector3(0, -1, 0) });
    const hit = workers.map(() => 0);
    let T = 0;
    while (T < 22) {
      step(1 / 60); T += 1 / 60;
      workers.forEach((w, i) => { if (w.air || w.fall > 0) hit[i] = 1; });
    }
    updWorker = oUpd; manWeapon = oMan; hitWeapon = oHit;
    const r = { n: workers.length, man, fell, smashed, fx,
                any: hit.filter(x => x).length, R: GATE_MAN_R };
    cleanTools();
    return r;
  });
  ok('兵器射到小人：人被撞飛，兵器自己被擋下來掉到地上',
     gateMan.any >= gateMan.n * 0.7 && gateMan.man >= 8 && gateMan.fell === gateMan.man,
     gateMan.n + ' 個人站在打擊範圍裡（判定半徑 ' + gateMan.R + '）：' + gateMan.any +
     ' 個被撞飛（v1.132 是 0 個）；射中人的 ' + gateMan.man + ' 發全部轉成掉落物 ' +
     gateMan.fell + ' 發');
  /* v1.132～v1.147 這條驗的是「射到人不拆房子」（那時候 manWeapon 刻意不叫 smash）。
     v1.148 使用者要「擊中小人或吉祥物時增加小小爆炸火球特效」，並確認火球本身要有
     破壞力，所以規則翻了——炸的量另外一條驗（見下面〈站在牆邊的人〉）。
     這一段的人是站在**場外空地**上的，周圍一塊積木都沒有，所以這裡驗的是
     「沒有積木可炸的時候就真的一塊都不掉」：火球不是憑空生積木出來的東西。 */
  ok('站在空地上被射中：火球照樣有，但一塊積木都不會掉',
     gateMan.fx && gateMan.fx.blocks === 0 && gateMan.fx.flash === 1,
     '第一發射中人的當下，掉了 ' + (gateMan.fx ? gateMan.fx.blocks : -1) + ' 塊積木、' +
     '多了 ' + (gateMan.fx ? gateMan.fx.flash : -1) + ' 顆火球');
  ok('擊中會迸出打擊特效：一顆金色星芒 ＋ 一叢往回濺的火花',
     gateMan.fx && gateMan.fx.star === 1 && gateMan.fx.hot >= 6,
     '撞的那一瞬間多了 ' + (gateMan.fx ? gateMan.fx.star : -1) + ' 顆星芒、' +
     (gateMan.fx ? gateMan.fx.hot : -1) + ' 顆火花（含火球噴出來的那幾顆）');

  /* ── 擊中的小爆炸火球（v1.148，使用者：「兵器擊中積木或小人或吉祥物時
     (如果是地面就跟現在一樣插著就好) 增加小小爆炸火球特效(把 3~4 塊積木炸飛的程度)」）──
     四種結局都要驗：打積木、打小人、打吉祥物、打地面。用手擺的兵器（不是等連射隨機
     打中）——一趟一百九十幾發裡「剛好打中吉祥物」的機率太低，等不到。

     人與吉祥物那兩種要**擺在牆邊**才量得到「炸掉幾塊」（站在空地上被射中周圍沒有
     積木可炸，那一種上面那條已經驗過了）。但擺在牆邊就會跟牆搶：stepWeapons 是
     先 sweepRock 再判定人，刃尖同一幀可能兩個都碰到。所以這裡**記下這一發走的是
     哪一支**（hitWeapon／manWeapon／beastWeapon），只把走對路徑的那幾發納入統計，
     不去賭單一發的結果——同一發打到牆也是對的行為，只是不是這條要量的東西。 */
  const gateBoom = await page.evaluate(() => {
    const oHit = hitWeapon, oMan = manWeapon, oBst = beastWeapon;
    let via = '';
    hitWeapon = w => { via = 'block'; oHit(w); };
    manWeapon = (w, p) => { via = 'man'; oMan(w, p); };
    beastWeapon = (w, m) => { via = 'masc'; oBst(w, m); };
    const build = rand => {
      cleanTools();
      setWorkerCount(12); targetCnt = 3000;
      shapePick = rand ? -1 : SHAPES.findIndex(s => s.n === '吉薩金字塔');
      startBuild(true); completeNow(); shapePick = -1;
      for (let i = 0; i < 20; i++) step(1 / 60);
      beasts = null;
      // 所有人先推到場外，免得別人擋在飛行路徑上（要打的那個下面再擺回來）
      for (const w of workers) { w.x = 300; w.z = 300; w.y = 0; w.air = 0; w.fall = 0; }
    };
    /* 從 +x 往 −x 射一把（空地那一種斜著往下），量這一發：走了哪一支、
       多了幾顆火球、炸掉幾塊、有沒有點著火、有沒有震畫面、目標有沒有被撞飛。 */
    const shoot = (kind, W) => {
      flashes.length = 0; hot.length = 0; stars.length = 0; via = '';
      let x, y, z, dy = 0, hold = null, t = null;
      if (kind === 'block') { x = W.x; y = W.y; z = W.z; }
      else if (kind === 'man') {
        x = W.x + 0.6; y = 0.9; z = W.z;
        t = workers[0];
        t.st = 'idle'; t.burn = 0; t.fall = 0; t.air = 0;
        hold = () => { if (!t.air) { t.x = x; t.z = z; t.y = 0; } };
      } else if (kind === 'masc') {
        x = W.x + 1.4; y = 1.1; z = W.z;
        spawnBeast('ape', 1);
        t = beasts[beasts.length - 1];
        t.st = 'walk'; t.t = 0; t.air = 0; t.fall = 0; t.lie = 0; t.burn = 0;
        hold = () => { if (!t.air) { t.x = x; t.z = z; t.y = 0; } };
      } else { x = 70; y = 0; z = 0; dy = -0.7071; }    // 空地：斜著飛下來才插得到地面
      if (hold) hold();
      const n0 = blocks.filter(b => b.st === SET).length;
      const f0 = (fires || []).length;
      const shakes = [];
      const oSh = ENG.shake; ENG.shake = v => shakes.push(v);
      const dx = dy ? -0.7071 : -1;
      /* 發射距離隨機 4～6 格：刃尖一幀飛 1.03 格，停在哪要看「到達的相位」，
         固定距離量到的只是那一個相位（同一個半徑，距離 3.4 量到平均 4.3 塊、
         距離 5.0 量到 1.6 塊）。真實遊戲裡相位是隨機的，夾具也要隨機。 */
      const away = 4 + Math.random() * 2;
      const w = { x: x - dx * away, y: y - dy * away, z, dx, dy, dz: 0,
                  roll: 0, len: 3, k: 0, s: 3, cut: null, st: 'fly',
                  vx: dx * GATE_SPD, vy: dy * GATE_SPD, vz: 0,
                  ax: 0, ay: 0, az: 0, spin: 0, lie: 0, fade: 1, glow: 0, em: 0, age: 0, out: 1 };
      weapons = [w];
      for (let i = 0; i < 12; i++) { if (hold) hold(); step(1 / 60); if (w.st !== 'fly') break; }
      ENG.shake = oSh;
      return { via, st: w.st, flash: flashes.filter(q => q.life).length,
               blocks: n0 - blocks.filter(b => b.st === SET).length,
               fires: (fires || []).length - f0, shake: shakes.length,
               air: t ? t.air > 0 : null };
    };
    /* 這一座底層裡「**這一排最外側**」的那幾塊：兵器從 +x 平飛過來，前面不會有別的
       東西擋著。只看緊鄰的 +x 格是不夠的（那一格空、更外面那一格有的話，兵器會先撞
       到外面那一塊，走的就變成打積木那條路）。
       從裡面**隨機挑一塊**，不是固定挑 x 最大的那一塊——x 最大的多半是整座最突出的
       那個角，旁邊本來就沒幾塊積木，量到的會是「那個角有多孤單」而不是這一發的力道
       （固定挑最外那塊時實測平均只 1.3 塊，隨機挑牆面是 4 塊上下）。 */
    const faces = () => {
      const set = blocks.filter(b => b.st === SET && b.y > 0.4 && b.y < 1.4);
      return set.filter(b => !set.some(q => q !== b && q.x > b.x &&
        Math.abs(q.y - b.y) < 0.5 && Math.abs(q.z - b.z) < 0.5));
    };
    const pickFace = f => f[Math.floor(Math.random() * f.length)];
    const out = {};
    build();
    out.block = shoot('block', pickFace(faces()));
    out.ground = shoot('ground');
    /* 人與吉祥物各射十發。**每發換一座隨機建築**：吉薩金字塔的 +x 面是階梯狀的斜坡，
       站在最外那一塊旁邊的人身邊本來就沒幾塊積木（實測平均只 1.7 塊），量到的是那一座
       的形狀不是這一發的力道。 */
    /* **射到湊滿十發真的打到目標為止**，不是「射十發、走對路徑的有幾發算幾發」。
       一發會打到目標身上還是先撞到牆，本身就是隨機的（挑到哪一塊牆、刃尖停下的相位），
       實測十發裡走到 manWeapon 的是 3～9 發——於是樣本數自己在擲骰子，
       下面那兩條的樣本數門檻（≥ 4、≥ 6）就變成在賭。十輪不同種子的掃描裡
       seed 5 抽到 3 發，兩條一起紅（那一版一行王之財寶的程式碼都沒動）。
       改成湊滿固定的十發，門檻一個字都沒動。 */
    for (const kind of ['man', 'masc']) {
      const rows = [];
      let tries = 0;
      while (rows.length < 10 && tries < 60) {
        tries++;
        build(true);
        const f = faces();
        if (!f.length) continue;
        const r = shoot(kind, pickFace(f));
        if (r.via === kind) rows.push(r);
      }
      out[kind] = rows;
      out[kind + 'N'] = tries;
    }
    /* 這一發爆破本身有多大：直接對著積木堆叫 weaponBlast（打到人／吉祥物走的就是它），
       跟「打到積木那一發」擺在一起比。爆點取現有積木的位置＝周圍都是積木，
       所以量到的是同一個半徑的**上限**；使用者說的 3～4 塊是實戰的量（人站在牆外，
       爆點離最近那排積木還有一格多，見 GATE_BLAST_R 那邊的實測表）。 */
    const dir = { dx: -1, dy: -0.2, dz: 0 };
    const bulk = R => {
      build();
      const got = [];
      for (let i = 0; i < 20; i++) {
        const set = blocks.filter(b => b.st === SET);
        if (set.length < 300) break;
        const b = set[Math.floor(Math.random() * set.length)];
        const n0 = set.length;
        if (R) smash({ x: b.x, y: b.y, z: b.z }, { x: -1, y: -0.2, z: 0 }, R, GATE_HIT_POW, true, true);
        else weaponBlast({ x: b.x, y: b.y, z: b.z }, dir);
        got.push(n0 - blocks.filter(q => q.st === SET).length);
      }
      return got.length ? +(got.reduce((s, v) => s + v, 0) / got.length).toFixed(1) : -1;
    };
    out.blastAvg = bulk(0);                 // 打到人／吉祥物那一發
    out.hitAvg = bulk(GATE_HIT_R);          // 打到積木那一發
    hitWeapon = oHit; manWeapon = oMan; beastWeapon = oBst;
    cleanTools();
    return out;
  });
  const gbAvg = a => a.length ? +(a.reduce((s, r) => s + r.blocks, 0) / a.length).toFixed(1) : -1;
  ok('擊中積木、小人、吉祥物都會迸出一顆小火球',
     gateBoom.block.flash === 1 && gateBoom.man.length >= 4 && gateBoom.masc.length >= 4 &&
     gateBoom.man.every(r => r.flash === 1) && gateBoom.masc.every(r => r.flash === 1),
     '積木 ' + gateBoom.block.flash + ' 顆；射中小人的 ' + gateBoom.man.length + '／' +
     gateBoom.manN + ' 發、射中吉祥物的 ' + gateBoom.masc.length + '／' + gateBoom.mascN +
     ' 發，每一發都 1 顆');
  ok('打到地面照舊只插著：沒有火球',
     gateBoom.ground.flash === 0 && gateBoom.ground.st === 'lie',
     '空地那一發 ' + gateBoom.ground.flash + ' 顆火球、狀態 ' + gateBoom.ground.st);
  /* 火球本身有破壞力（使用者確認的那個選項）：打到人／吉祥物時多炸一小片。
     **這一條驗的是「規則翻了」**（v1.147 以前這一種一塊都不掉），不是抓一個塊數：
     單一發的塊數同時吃三個隨機——那一座的形狀、挑到哪一塊牆、刃尖停下的相位，
     實測 48 發的分布是 0～14（平均 3.5、中位 3），十發的平均標準誤就有 1 上下，
     拿「平均 ≥ 3」當門檻等於在擲骰子。
     所以這裡看的是**幾成的發數炸得到東西**（48 發裡 46 發 ≥ 1 塊），
     量級交給下面那條「擺在積木堆裡跟打積木那一發比」（同一個位置比，穩得多）
     與 GATE_BLAST_R 那邊的 48 發實測表。平均值照樣印出來，真的縮水了看得見。
     **吉祥物不看塊數**：牠的命中半徑照身形放大（GATE_MAN_R ＋ 半身高 ×0.8 ≈ 1.6），
     刃尖離牠一格半就算中了，所以爆點停在牆外更遠處——站在牆邊時常常一塊都炸不到
     （實測 0 塊）。牠那一發有沒有走同一支爆破，看上面那條火球就知道：
     火球是 weaponBlast 裡面叫的，有火球就代表 smash 也跑了。 */
  const gbHitAny = gateBoom.man.filter(r => r.blocks > 0).length;
  ok('射中站在牆邊的小人，會多炸掉一小片積木（v1.147 以前是一塊都不掉）',
     gateBoom.man.length >= 6 && gbHitAny >= gateBoom.man.length * 0.6 &&
     gbAvg(gateBoom.man) <= 8,
     '小人 ' + gateBoom.man.length + ' 發裡有 ' + gbHitAny +
     ' 發炸到東西，平均 ' + gbAvg(gateBoom.man) + ' 塊（48 發的校準值是 3.5、中位 3）；' +
     '吉祥物 ' + gateBoom.masc.length + ' 發平均 ' + gbAvg(gateBoom.masc) +
     ' 塊——牠站得比人遠，見註解');
  ok('這一發爆破明顯小於「打到積木」那一發（同樣擺在積木堆裡比）',
     gateBoom.blastAvg >= 2 && gateBoom.blastAvg <= gateBoom.hitAvg * 0.75,
     '擺在積木堆裡各炸 20 發：打到人／吉祥物那一發平均 ' + gateBoom.blastAvg +
     ' 塊（半徑 1.4）、打到積木那一發平均 ' + gateBoom.hitAvg + ' 塊（半徑 ' +
     '1.5）');
  ok('人／吉祥物被射中還是會被撞飛（爆破不會把它換成原地倒下）',
     gateBoom.man.every(r => r.air === true) && gateBoom.masc.every(r => r.air === true),
     '小人 ' + gateBoom.man.filter(r => r.air).length + '／' + gateBoom.man.length +
     '、吉祥物 ' + gateBoom.masc.filter(r => r.air).length + '／' + gateBoom.masc.length);
  ok('火球不點火、不震畫面（這一把從 v1.132 起就是這樣）',
     gateBoom.block.fires === 0 && gateBoom.block.shake === 0 &&
     gateBoom.man.every(r => r.fires === 0 && r.shake === 0) &&
     gateBoom.masc.every(r => r.fires === 0 && r.shake === 0),
     '積木那一發起火 ' + gateBoom.block.fires + ' 筆、震 ' + gateBoom.block.shake +
     ' 次；人與吉祥物那幾發起火 ' +
     (gateBoom.man.concat(gateBoom.masc).reduce((s, r) => s + r.fires, 0)) + ' 筆、震 ' +
     (gateBoom.man.concat(gateBoom.masc).reduce((s, r) => s + r.shake, 0)) + ' 次');
  /* 額度不搶：小火球滿了就這一發沒有，不會把爆炸那顆大的擠掉（見 weaponBoom 的第 ③ 點）。
     反過來要照舊——大爆炸擠得掉這幾顆小的。 */
  const gateBoomCap = await page.evaluate(() => {
    cleanTools();
    flashes.length = 0;
    const w = { x: 0, y: 3, z: 0, dx: -1, dy: 0, dz: 0, len: 3 };
    for (let i = 0; i < FLASH_MAX + 5; i++) weaponBoom({ x: i * 4, y: 3, z: 0 }, w);
    const small = flashes.length;
    /* 位置被小火球佔滿的時候，爆炸那顆照樣進得來（它是把最早那顆擠掉） */
    spawnBlast({ x: 0, y: 2.5, z: 0 }, 30, false);
    const big = flashes.filter(q => !q.life).length;
    const total = flashes.length;
    flashes.length = 0; hot.length = 0; cleanTools();
    return { small, big, total, cap: FLASH_MAX };
  });
  ok('小火球額度滿了就這一發沒有，不會把爆炸那顆大火球擠掉',
     gateBoomCap.small === gateBoomCap.cap && gateBoomCap.big === 1 &&
     gateBoomCap.total === gateBoomCap.cap,
     '連炸 ' + (gateBoomCap.cap + 5) + ' 下 → 場上 ' + gateBoomCap.small +
     ' 顆小火球（上限 ' + gateBoomCap.cap +
     '）；接著一發大爆炸 → 大火球 ' + gateBoomCap.big + ' 顆、共 ' + gateBoomCap.total + ' 顆');

  ok('兵器不比小人手上那根法杖粗太多',
     gate1.fat > 0 && gate1.fat <= gate1.staff * 2.7,
     '最粗的一塊 ' + gate1.fat + '，小人的法杖 ' + gate1.staff + '（' +
     (gate1.fat / gate1.staff).toFixed(1) + ' 倍；v1.132.1 是騎槍的環 0.66 ＝ 4 倍）');

  /* 兩段點擊（v1.135，使用者：「操作方式調整 第一下地面點擊決定 出現門陣的位置
     第二下地面點擊決定攻擊目標位置」）。v1.134 以前是一下就開：目標由那一下決定，
     門陣自己退到「鏡頭方向的另一側 GATE_BACK 遠」。
     所以這裡驗三件事：兩下的分工、門陣真的立在第一下那個點上、兵器朝第二下那個點飛，
     而且**跟鏡頭無關**（同一組點在三個視角下量到的要一模一樣）。 */
  const gateTwo = await page.evaluate(() => {
    const yaw0 = ENG.cam.yaw;
    const reset = () => { gates = null; weapons = null; gateEnd(); aim = null; };
    // ① 兩段點擊：第一下只留光環不開門，第二下才開
    reset();
    tool = 'gate';
    useTool({ kind: 'ground', point: new THREE.Vector3(-40, 0, 0) });
    const one = { gates: !!gates, aim: aim ? { x: aim.x, z: aim.z } : null };
    useTool({ kind: 'ground', point: new THREE.Vector3(0, 0, 25) });
    const two = { gates: !!gates, aim: aim,
                  cx: gates && +gates[0].cx.toFixed(2), cz: gates && +gates[0].cz.toFixed(2),
                  tx: gates && +gates[0].x.toFixed(2), tz: gates && +gates[0].z.toFixed(2) };
    // ② 幾何：門陣在第一下、兵器朝第二下，換三個視角量到的都一樣
    const at = (yaw, from, to) => {
      reset();
      ENG.cam.yaw = yaw;
      castGate(from, to);
      const g = gates[0];
      let ax = to.x - from.x, az = to.z - from.z;
      const d = Math.hypot(ax, az); ax /= d; az /= d;
      return { off: +Math.hypot(g.cx - from.x, g.cz - from.z).toFixed(3),   // 門陣離第一下多遠
               d: +Math.hypot(g.cx - g.x, g.cz - g.z).toFixed(1),           // 門陣離目標多遠
               back: +g.back.toFixed(1),
               dot: +(g.ax * ax + g.az * az).toFixed(3),                    // 兵器方向 vs 門→目標
               perp: +Math.abs(g.ux * ax + g.uz * az).toFixed(3),           // 橫向要垂直
               toward: g.ports.filter(p => p.w && p.w.dx * ax + p.w.dz * az > 0).length };
    };
    const F = { x: -30, z: -30 }, T = { x: 6, z: 4 };
    const a = at(0.9, F, T), b = at(0.9 + Math.PI / 2, F, T), c = at(0.9 + Math.PI, F, T);
    // ③ 兩下點在同一個地方：退回舊取景（鏡頭方向、GATE_BACK 遠），不會變成除以零
    reset();
    ENG.cam.yaw = 0.9;
    castGate({ x: 0, z: 0 }, { x: 0, z: 0 });
    const same = { back: +gates[0].back.toFixed(1),
                   d: +Math.hypot(gates[0].cx - gates[0].x, gates[0].cz - gates[0].z).toFixed(1),
                   nan: !isFinite(gates[0].cx) || !isFinite(gates[0].fx) };
    reset();
    ENG.cam.yaw = yaw0;
    tool = 'hammer';
    return { one, two, a, b, c, same, from: F, to: T,
             dist: +Math.hypot(T.x - F.x, T.z - F.z).toFixed(1), back: GATE_BACK, n: GATE_N };
  });
  ok('兩段點擊：第一下只在地上畫一圈光環，第二下才開門',
     gateTwo.one.gates === false && gateTwo.one.aim &&
     Math.abs(gateTwo.one.aim.x + 40) < 0.01 && gateTwo.two.gates === true &&
     gateTwo.two.aim === null,
     '第一下 (-40, 0)：門陣 ' + (gateTwo.one.gates ? '開了' : '還沒開') + '、光環在 (' +
     gateTwo.one.aim.x + ', ' + gateTwo.one.aim.z + ')；第二下 (0, 25)：門陣開在 (' +
     gateTwo.two.cx + ', ' + gateTwo.two.cz + ')、目標 (' + gateTwo.two.tx + ', ' +
     gateTwo.two.tz + ')，光環收掉');
  ok('門陣立在第一下那個點上，兵器朝第二下那個點飛（跟鏡頭無關）',
     [gateTwo.a, gateTwo.b, gateTwo.c].every(r =>
       r.off < 0.001 && Math.abs(r.back - gateTwo.dist) < 0.1 && r.dot > 0.999 &&
       r.perp < 0.001 && r.toward === gateTwo.n),
     '第一下 (-30, -30) → 第二下 (6, 4)，相距 ' + gateTwo.dist + '：三個視角量到的門陣偏移 ' +
     [gateTwo.a.off, gateTwo.b.off, gateTwo.c.off].join('／') + '、飛行方向與「門→目標」的內積 ' +
     [gateTwo.a.dot, gateTwo.b.dot, gateTwo.c.dot].join('／') + '、朝目標的兵器 ' +
     [gateTwo.a.toward, gateTwo.b.toward, gateTwo.c.toward].join('／') + '/' + gateTwo.n + ' 把');
  ok('兩下點在同一個地方就退回舊取景，不會除以零',
     gateTwo.same.nan === false && Math.abs(gateTwo.same.back - gateTwo.back) < 0.1 &&
     Math.abs(gateTwo.same.d - gateTwo.back) < 0.1,
     '同一點連點兩下：門陣退到離目標 ' + gateTwo.same.d + '（設定 ' + gateTwo.back +
     '）、back=' + gateTwo.same.back + '、有 NaN：' + gateTwo.same.nan);

  /* 門的**朝向就是那一把兵器的方向**（v1.132.1；v1.132.0 是一律正對鏡頭的公告板）。
     門是虛空裂開的一個洞、兵器從洞裡垂直探出來，所以斜著看時它是橢圓不是正圓
     （使用者：「同心波紋 不一定是正對鏡頭的圓」）。
     從真的畫出去的矩陣讀那一片的法線（本地 +Z）——轉向整個是引擎做的，讀狀態驗不到。
     一個門畫兩層（漣漪 ＋ 核），所以第 2i、2i+1 對應同一個門。 */
  const gateFace = await page.evaluate(() => {
    gates = null; weapons = null; gateEnd();
    gateAt({ x: 0, z: 0 });
    for (let i = 0; i < 40; i++) step(0.05);
    draw();
    const m = ENG.three.gateMesh, mat = new THREE.Matrix4(), q = new THREE.Quaternion();
    const cam = ENG.three.camera;
    const lit = gates[0].ports.filter(p => p.op > 0.002);      // gateList 送出去的順序
    const dot = [], view = [];
    const vd = new THREE.Vector3();
    for (let i = 0; i < 6; i++) {
      m.getMatrixAt(i, mat);
      const p = new THREE.Vector3(), sc = new THREE.Vector3();
      mat.decompose(p, q, sc);
      const nrm = new THREE.Vector3(0, 0, 1).applyQuaternion(q);      // 這一片的法線
      const w = lit[i >> 1];
      dot.push(+nrm.dot(new THREE.Vector3(w.dx, w.dy, w.dz)).toFixed(3));
      // 順便量它有多斜：法線與「這一片指向鏡頭」的內積 ＝ 畫出來那個橢圓的短軸
      vd.copy(cam.position).sub(p).normalize();
      view.push(+Math.abs(nrm.dot(vd)).toFixed(2));
    }
    const r = { n: m.count, vis: m.visible, dot, view };
    gates = null; weapons = null; gateEnd(); draw();
    return { ...r, off: ENG.three.gateMesh.visible };
  });
  ok('門的朝向就是兵器的朝向（所以是各種角度的橢圓，不是一律正對鏡頭）',
     gateFace.vis && gateFace.n > 0 && gateFace.dot.every(d => d > 0.999) &&
     gateFace.off === false,
     '場上 ' + gateFace.n + ' 片，法線與那一把兵器方向的內積 ' + gateFace.dot.join('／') +
     '；收掉之後 visible=' + gateFace.off);
  /* 但也不能斜到變成一條線：出手方向被夾在錐面內（GATE_CONE），所以短軸有下限。
     0.4 ＝ 偏離視軸 66 度；沒有那個錐面的話實測會掉到 0.29。 */
  ok('斜歸斜，門不會扁成一條線（出手方向夾在錐面內）',
     gateFace.view.every(v => v > 0.4),
     '畫出來那幾個橢圓的短軸 ' + gateFace.view.join('／') + '（1 ＝ 正圓）');

  /* 「還沒伸出來的那一段看不見」（v1.132.1，使用者回報）。不是靠門那片圖擋——
     是每一把帶一個世界座標的切面（就是它那個門所在的平面），比切面後面的片元在
     shader 裡 discard。從**真的送進去的那個逐 instance 屬性**讀，不是讀規則的狀態。 */
  const gateCut = await page.evaluate(() => {
    gates = null; weapons = null; gateEnd();
    gateAt({ x: 0, z: 0 });
    /* 要等**全部就位**（gates[0].ph 不再是 open）才量：還在伸的時候刃尖剛好貼在切面上，
       量到的 tip 是 0 而不是「切面前面」。 */
    let g0 = 0;
    while (g0++ < 900 && gates[0].ph === 'open') step(0.05);
    draw();
    const a = ENG.three.weapMesh.geometry.getAttribute('aCut');
    const w = weapons[0], p = gates[0].ports.find(q => q.w === w);
    /* 這一把在清單裡的第幾個 ＝ 屬性的第幾組（一把 WEAP_PARTS 個 instance） */
    const i = weapons.indexOf(w) * ENG.three.weapMesh.geometry.attributes.aCut.itemSize;
    const n = [a.array[0], a.array[1], a.array[2]], d = a.array[3];
    const dotDir = n[0] * w.dx + n[1] * w.dy + n[2] * w.dz;      // 法線＝出手方向
    const onPort = n[0] * p.x + n[1] * p.y + n[2] * p.z - d;     // 面過門心 → 0
    // 刃尖在切面前面（看得見）、柄在切面後面（被切掉）
    const t = w.len * 0.5;
    const tip = (w.x + w.dx * t) * n[0] + (w.y + w.dy * t) * n[1] + (w.z + w.dz * t) * n[2] - d;
    const butt = (w.x - w.dx * t) * n[0] + (w.y - w.dy * t) * n[1] + (w.z - w.dz * t) * n[2] - d;
    /* 射出去之後就不切了：找一把飛行中的，看它那一組屬性是不是「不切」的哨兵值
       （法線 0、offset −1，dot 恆為 0，0 < −1 不成立 → 什麼都不 discard）。 */
    let g = 0, fly = null, flyCut = null;
    while (g++ < 900 && !fly) {
      step(0.05);
      fly = weapons && weapons.find(q => q.st === 'fly');
    }
    if (fly) { draw(); const j = weapons.indexOf(fly) * 8 * 4;
               flyCut = [a.array[j], a.array[j + 1], a.array[j + 2], a.array[j + 3]]; }
    const r = { dotDir: +dotDir.toFixed(3), onPort: +onPort.toFixed(3),
                tip: +tip.toFixed(2), butt: +butt.toFixed(2),
                flyCut: flyCut ? flyCut.map(v => +v.toFixed(1)) : null };
    gates = null; weapons = null; gateEnd();
    return r;
  });
  ok('埋在門裡的那一段是真的不畫：切面就是那個門所在的平面',
     Math.abs(gateCut.dotDir - 1) < 0.002 && Math.abs(gateCut.onPort) < 0.01 &&
     gateCut.tip > 0 && gateCut.butt < 0,
     '切面法線與出手方向的內積 ' + gateCut.dotDir + '、門心到切面的距離 ' +
     gateCut.onPort + '；刃尖在切面前 ' + gateCut.tip + '、柄在切面後 ' + gateCut.butt);
  ok('射出去之後整把都看得見（切面收掉）',
     gateCut.flyCut && gateCut.flyCut[0] === 0 && gateCut.flyCut[1] === 0 &&
     gateCut.flyCut[2] === 0 && gateCut.flyCut[3] === -1,
     '飛行中那一把的切面 ' + JSON.stringify(gateCut.flyCut) + '（法線 0、offset −1 ＝ 不切）');

  /* 鏡頭：門陣飄在建築上方，不退開的話矮建築整片都在畫面外（跟打雷同一個問題）。
     v1.128 使用者指定的那條規矩——會把鏡頭往高處帶的運鏡，結束後高度要調回來。 */
  const gateCamHold = await page.evaluate(() => {
    const build = (name, cnt) => {
      cleanTools();
      shapePick = SHAPES.findIndex(s => s.n === name);
      targetCnt = cnt; startBuild(true); completeNow(); shapePick = -1;
      for (let i = 0; i < 20; i++) step(0.05);
    };
    const one = shape => {
      build(shape, 3000);
      const ty0 = ENG.camTarget.ty, d0 = ENG.camTarget.dist;
      gateAt({ x: 0, z: 0 });
      const tyUp = ENG.camTarget.ty, dUp = ENG.camTarget.dist;
      let g = 0;
      while ((gates || weapons) && g++ < 900) step(0.05);
      step(0.05);
      return { h: +bp.height.toFixed(0), ty0: +ty0.toFixed(1), tyUp: +tyUp.toFixed(1),
               ty1: +ENG.camTarget.ty.toFixed(1), d0: +d0.toFixed(1),
               dUp: +dUp.toFixed(1), d1: +ENG.camTarget.dist.toFixed(1) };
    };
    const low = one('羅馬競技場'), high = one('台北 101');
    cleanTools();
    return { low, high };
  });
  ok('發動時鏡頭退開看得見整片門，收工後高度還回去',
     gateCamHold.low.tyUp > gateCamHold.low.ty0 + 5 &&
     Math.abs(gateCamHold.low.ty1 - gateCamHold.low.ty0) < 0.1 &&
     Math.abs(gateCamHold.high.ty1 - gateCamHold.high.ty0) < 0.1 &&
     gateCamHold.low.d1 === gateCamHold.low.dUp,
     '羅馬競技場（h=' + gateCamHold.low.h + '）視線高 ' + gateCamHold.low.ty0 + ' → ' +
     gateCamHold.low.tyUp + ' → ' + gateCamHold.low.ty1 + '；台北 101（h=' +
     gateCamHold.high.h + '）' + gateCamHold.high.ty0 + ' → ' + gateCamHold.high.tyUp +
     ' → ' + gateCamHold.high.ty1 + '（視距只進不退：' + gateCamHold.low.d0 + '→' +
     gateCamHold.low.d1 + '）');

  /* 同時最多三組（v1.136，使用者：「可以同時存在多組(3組)」）。第四發把最早那一組推進
     收尾——它不再開新的門，把還裝著兵器的門射完才收（使用者：「結束的時候繼續把還有
     武器的門射完」），所以那一刻**一把兵器都不該被撤掉**。
     v1.135 以前是「一次一發，再點就把上一發連門帶兵器收掉」。 */
  const gateSets = await page.evaluate(() => {
    cleanTools();
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 3000; startBuild(true); completeNow(); shapePick = -1;
    for (let i = 0; i < 20; i++) step(0.05);
    const o = { sets: GATE_SETS, keep: GATE_KEEP, want: GATE_N };
    gateAt({ x: 0, z: 0 });
    let g = 0;
    while (g++ < 400 && gates[0].ph !== 'fire') step(0.05);
    gateAt({ x: 30, z: 0 });
    for (let i = 0; i < 20; i++) step(0.05);
    gateAt({ x: -30, z: 0 });
    for (let i = 0; i < 20; i++) step(0.05);
    o.n3 = gates.length;
    o.cx3 = gates.map(q => +q.cx.toFixed(1));
    /* 每一組都有自己的一百個門（門數才是不變量）。門裡待發的把數只能要求「差不多滿」
       ——已經在射的那一組會有幾個門剛射完、正在縮掉換位置（實測 93/100）。 */
    o.ports3 = gates.map(q => q.ports.length);
    o.load3 = gates.map(q => q.ports.filter(p => p.w).length);
    o.flying = weapons.filter(w => w.st !== 'gate').length;
    /* 第四發：最早那一組進收尾（不再開新門），而且一把兵器都沒被撤掉。 */
    const oDrop = dropWeapon;
    let dropped = 0;
    dropWeapon = w => { dropped++; oDrop(w); };
    const first = gates[0];
    gateAt({ x: 0, z: 45 });
    dropWeapon = oDrop;
    o.n4 = gates.length;
    o.firstPh = first.ph;
    o.live4 = gates.filter(q => q.ph !== 'drain').length;
    o.dropped = dropped;
    o.load4 = first.ports.filter(p => p.w).length;      // 收尾中的那一組手上還有貨
    /* 收尾中的那一組最後真的會自己收掉，而且是把手上的射完（不是憑空消失）。 */
    const oFire = fireGate;
    let fired = 0;
    fireGate = (q, p) => { if (q === first) fired++; oFire(q, p); };
    let d = 0;
    dropWeapon = w => { dropped++; oDrop(w); };
    while (d++ < 900 && gates && gates.indexOf(first) >= 0) step(1 / 60);
    fireGate = oFire; dropWeapon = oDrop;
    o.drainFired = fired;
    o.droppedAll = dropped;
    o.gone = !gates || gates.indexOf(first) < 0;
    cleanTools();
    return o;
  });
  ok('同時最多三組，每一組各自帶自己的一百個門',
     gateSets.n3 === 3 && gateSets.sets === 3 &&
     gateSets.ports3.every(n => n === gateSets.want) &&
     gateSets.load3.every(n => n >= gateSets.want * 0.8) &&
     new Set(gateSets.cx3).size === 3,
     '連開三發 → 場上 ' + gateSets.n3 + ' 組（上限 ' + gateSets.sets +
     '），門陣中心 ' + gateSets.cx3.join('／') + '，各 ' +
     gateSets.ports3.join('／') + ' 個門、門裡待發 ' +
     gateSets.load3.join('／') + ' 把（已經在射的那一組會有幾個正在換位置）');
  ok('第四發把最早那一組推進收尾，不是把它連兵器一起撤掉',
     gateSets.firstPh === 'drain' && gateSets.live4 === 3 && gateSets.n4 === 4 &&
     gateSets.dropped === 0 && gateSets.load4 > 20,
     '第四發之後：場上 ' + gateSets.n4 + ' 組（還在開新門的 ' + gateSets.live4 +
     ' 組），最早那一組轉成 ' + gateSets.firstPh + '、門裡還有 ' + gateSets.load4 +
     ' 把待發；當場被撤掉的兵器 ' + gateSets.dropped + ' 把');
  ok('收尾那一組會把手上的射完才收（整趟沒有兵器憑空消失）',
     gateSets.gone && gateSets.drainFired > 20 && gateSets.droppedAll === 0,
     '收尾中又射了 ' + gateSets.drainFired + ' 發才收掉（收乾淨 ' +
     (gateSets.gone ? '是' : '否') + '）；從第四發到收乾淨，被撤掉的兵器 ' +
     gateSets.droppedAll + ' 把');

  /* 連射最凶的那幾秒，每幀的成本。**三組同時在射**才是 v1.136 的最壞情況：600 片門
     （100 個 × 兩層）＋ 兩百多把兵器 × 8 塊方塊，加上滿池的塵霧與金色光軌。
     多開 instance 不多吃 draw call，但矩陣是每幀重算的，所以要量。 */
  const gateCost = await page.evaluate(() => {
    cleanTools();
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 3000; startBuild(true); completeNow(); shapePick = -1;
    gateAt({ x: 0, z: 0 });
    let g = 0;
    for (let i = 0; i < 18; i++) step(1 / 60);
    gateAt({ x: 26, z: 10 });
    for (let i = 0; i < 18; i++) step(1 / 60);
    gateAt({ x: -22, z: -14 });
    while (g++ < 800 && gates.some(q => q.ph !== 'fire' && q.ph !== 'drain')) step(1 / 60);
    for (let i = 0; i < 60 * 2; i++) step(1 / 60);        // 射到一半、躺著的也堆起來了
    const w = weapons ? weapons.length : 0, gt = gates ? gateList().length : 0;
    const sets = gates ? gates.length : 0;
    let sum = 0, worst = 0;
    for (let i = 0; i < 90; i++) {
      const t0 = performance.now();
      step(1 / 60); draw();
      const d = performance.now() - t0;
      sum += d; worst = Math.max(worst, d);
    }
    /* 門與兵器各自吃幾個 draw call：**同一幕畫三次**，一次一份地把清單抽掉。
       跟「發動前」比是不準的——這一幕還有塵霧、金色光軌、命中的衝擊環與地面痕跡，
       那些走的都是現成的池子，一起算進去會變成 +4，證明不了是誰花的。
       另外 ENG.info() 讀的是 renderer **上一次 render** 的統計，所以每次都要真的畫過。 */
    draw(); ENG.render();
    const on = ENG.info().calls;
    const g0 = gates, w0 = weapons;
    gates = null; draw(); ENG.render();
    const noGate = ENG.info().calls;
    weapons = null; draw(); ENG.render();
    const off = ENG.info().calls;
    gates = g0; weapons = w0;
    cleanTools();
    return { w, gt, on, sets, gate: on - noGate, weap: noGate - off,
             keep: WEAP_KEEP, wmax: ENG.WEAP_MAX, gmax: ENG.GATE_MAX,
             avg: +(sum / 90).toFixed(2), worst: +worst.toFixed(2) };
  });
  /* 兵器是 2 個而不是 1 個：它會投影，陰影圖那一趟要再畫一次（積木、炸彈那些也一樣）。
     門是 1 個——它是透明的雙面材質，沒開 forceSinglePass 的話 three 會分兩趟畫，
     量到的就是 2（實測過）。 */
  ok('三組同時連射最凶的那幾秒，每幀的成本在預算內；門與兵器加起來只多三個 draw call',
     gateCost.avg < 4 && gateCost.gate === 1 && gateCost.weap === 2 &&
     gateCost.sets === 3 && gateCost.gt <= gateCost.gmax && gateCost.w <= gateCost.keep &&
     gateCost.w <= gateCost.wmax,
     gateCost.sets + ' 組同時在射：' + gateCost.gt + ' 片門（引擎 ' + gateCost.gmax +
     '）＋ ' + gateCost.w + ' 把兵器（上限 ' + gateCost.keep + '、引擎 ' + gateCost.wmax +
     '）：step + draw 平均 ' +
     gateCost.avg + ' ms、最高 ' + gateCost.worst + ' ms（預算 4ms）；' +
     '這一幕共 ' + gateCost.on + ' 個 draw call，門占 ' + gateCost.gate +
     '、兵器占 ' + gateCost.weap + '（含陰影那一趟）');

  /* 門陣要**偏寬、上下低**（v1.132.1，使用者：「目前看起來像正方形」）。
     細高的建築最容易踩到：不夾的話台北 101 算出來是 48.7 寬 × 64.8 高（直的一片）。 */
  const gateAspect = await page.evaluate(() => {
    const one = shape => {
      cleanTools();
      shapePick = SHAPES.findIndex(s => s.n === shape);
      targetCnt = 3000; startBuild(true); completeNow(); shapePick = -1;
      for (let i = 0; i < 20; i++) step(0.05);
      const sp = gateSpan();
      return { s: shape, w: +sp.w.toFixed(0), h: +sp.h.toFixed(0),
               grid: sp.cols + '×' + sp.rows,
               ratio: +(sp.w / sp.h).toFixed(2) };
    };
    const out = [one('吉薩金字塔'), one('台北 101'), one('羅馬競技場')];
    cleanTools();
    return { out, flat: GATE_FLAT, n: GATE_N };
  });
  ok('門陣是橫著鋪開的一片，不是正方形',
     gateAspect.out.every(r => r.ratio >= gateAspect.flat - 0.01) &&
     gateAspect.out.every(r => r.w >= 50),
     gateAspect.out.map(r => r.s + ' ' + r.w + '×' + r.h + '（' + r.ratio + ' 比 1，' +
       r.grid + ' 格）').join('；') + '——最扁也要 ' + gateAspect.flat + ' 比 1');

  /* 打得多開：範圍跟著建築的外接半徑收（見 gateZone）。固定 22 的話打細長的塔
     幾乎全落在空地上——實測台北 101 只有 24% 的發數碰得到建築、整趟掉 3%。 */
  const gateZoneT = await page.evaluate(() => {
    const one = shape => {
      cleanTools();
      shapePick = SHAPES.findIndex(s => s.n === shape);
      targetCnt = 3000; startBuild(true); completeNow(); shapePick = -1;
      for (let i = 0; i < 20; i++) step(0.05);
      const n0 = placedCnt;
      /* 尺寸跟範圍要**先量**（v1.136）：收尾那一段多射五十發之後，細高的塔
         有時會整棟垒完（實測台北 101 掉 100%）——那會踩到「拆到剩不到一成就換下一座」，
         事後再讀 bp.radius 讀到的是**下一座**（實測 9.5 → 12.2，範圍跟著變 11.9 → 13，
         於是「細塔的範圍比金字塔小」這件事量不出來）。 */
      const R = +bp.radius.toFixed(1), zone = +gateZone().toFixed(1);
      let hit = 0, all = 0;
      const oHit = hitWeapon, oStick = stickWeapon;
      hitWeapon = w => { hit++; all++; oHit(w); };
      stickWeapon = w => { all++; oStick(w); };
      gateAt({ x: 0, z: 0 });
      let g = 0, lost = 0;
      while ((gates || weapons) && g++ < 900) {
        step(0.05);
        if (phase !== 'done' && phase !== 'wreck') break;    // 已經在換場了：再量就是量別棟
        lost = n0 - placedCnt;
      }
      hitWeapon = oHit; stickWeapon = oStick;
      const r = { s: shape, R, zone, hit, all, pct: +(lost / n0 * 100).toFixed(1) };
      cleanTools();
      return r;
    };
    return [one('吉薩金字塔'), one('台北 101')];
  });
  ok('範圍跟著建築收，細長的塔也打得到',
     gateZoneT.every(r => r.hit / r.all > 0.3 && r.pct > 10) &&
     gateZoneT[1].zone < gateZoneT[0].zone,
     gateZoneT.map(r => r.s + '（外接半徑 ' + r.R + '、範圍 ' + r.zone + '）：' +
       r.hit + '/' + r.all + ' 發打中，掉了 ' + r.pct + '%').join('；'));

  /* 打得爛小人的家（v1.135，使用者回報「王之財寶⋯⋯對小人房子無效」）。
     兵器的掃掠判定本來只問地標藍圖的格子表（blockAt），房子不在裡面（它自己帶一份格子
     清單）——所以兵器整把從屋頂穿過去、插在屋子後面的地上。破壞那一半本來就成立
     （smash 只看 st === SET），缺的只有「撞到了沒」。
     對照組直接把 homeSolid 換成「永遠不是固體」＝ 舊行為，兩邊同一間房子、同一發。 */
  const gateHome = await page.evaluate(() => {
    const build = () => {
      cleanTools(); clearHomes();
      shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
      targetCnt = 400; setWorkerCount(6); startBuild(true); completeNow();
      stopIdleEvent(); clearHomes();
      homes = { list: [] };
      const kind = HOME_KIND[6];                     // 三層樓：最高的一款
      const at = { x: 70, z: 0 };                    // 場外空地：地標的積木擋不到
      const slots = homeSlots(at.x, at.z, kind, HOME_PAL[0]);
      const map = new Map();
      slots.forEach((sl, i) => map.set(sl.i + ':' + sl.gy + ':' + sl.k, i));
      const h = { x: at.x, z: at.z, r: homeR(kind), kind: kind.id, at: map,
                  ox: (kind.w - 1) / 2, oz: (kind.d - 1) / 2,
                  slots, left: 0, n: kind.n, done: true };
      homeBox(h); markHomeF6(h);
      homes.list.push(h);
      for (let i = 0; i < slots.length; i++) {
        const sl = slots[i], b = newBlock();
        b.x = sl.x; b.y = sl.y; b.z = sl.z; b.st = 3; b.rest = true;
        b.hh = 0; b.hk = i;
        b.r = b.tr = sl.c[0]; b.g = b.tg = sl.c[1]; b.b = b.tb = sl.c[2];
        blocks.push(b); sl.filled = true;
      }
      ENG.setBlockCount(blocks.length);
      // 小人擺到天邊去：這一條要驗的是房子，不是撞飛小人
      for (const w of workers) { releaseWorker(w); w.hm = -1; w.x = 300; w.z = 300; }
      return h;
    };
    const alive = () => blocks.filter(b => b.hh === 0 && b.st === 3).length;
    const run = () => {
      const h = build();
      const n0 = alive();
      /* 打中的那一下才算數：hitWeapon 是「撞到固體」那條路，插地面走的是 stickWeapon。 */
      const oHit = hitWeapon;
      let hits = 0;
      hitWeapon = w => { hits++; oHit(w); };
      gateAt({ x: h.x, z: h.z });
      let g = 0;
      while ((gates || weapons) && g++ < 900) step(0.05);
      hitWeapon = oHit;
      return { n0, left: alive(), lost: n0 - alive(), hits };
    };
    const oHS = homeSolid;
    homeSolid = () => false;                         // v1.134 的行為：房子不算固體
    const before = run();
    homeSolid = oHS;
    const after = run();
    cleanTools(); clearHomes();
    return { before, after };
  });
  ok('王之財寶打得爛小人的家（v1.134 是整把穿過去）',
     gateHome.before.lost === 0 && gateHome.before.hits === 0 &&
     gateHome.after.lost > 20 && gateHome.after.hits > 10,
     '同一間三層樓（' + gateHome.after.n0 + ' 塊）挨同一發：舊行為打掉 ' +
     gateHome.before.lost + ' 塊（撞到 ' + gateHome.before.hits + ' 次）→ 現在打掉 ' +
     gateHome.after.lost + ' 塊（撞到 ' + gateHome.after.hits + ' 次）');

  /* 第二下點在**建築**上就打那個高度（v1.152，使用者：「第二下也能點擊建築做目標
     （點擊位置的一個空間範圍 目前好像會在點擊位置的平面座標地面上）」）。
     拿台北 101 量：塔高 65，點在六成高（39）跟「點空地」差得夠開，量得出來。
     同一組數字要同時守住三件事，缺一不可——
     ① 火力真的被拉到點擊的高度（打中的高度中位數）；
     ② **落空的兵器沒有因此飛出場外**：瞄得越高，沒打到的那一把滑得越遠
        （滑過頭 ＝ 落點高度 × 水平距離 ÷ 落差，而俯角被錐面夾在 41 度內），
        所以這一條是這一版最容易踩的雷，靠 stepWeapons 那條 w.aimY 擋著；
     ③ 點空地那一發**一個字都沒變**（門陣高度一樣、每一把的 aimY 都是 0）。
     兩種點法各跑一趟同一座建築、同一組座標，差別只在 kind。 */
  await reset(page, { shape: '台北 101', cnt: 3000, workers: 0 });
  const gateHi = await page.evaluate(() => {
    completeNow();
    const ty = bp.height * 0.6;
    const q = (a, f) => (a.length ? +a[Math.floor((a.length - 1) * f)].toFixed(1) : -1);
    const run = kind => {
      /* 每一趟都**重蓋一次**：不重蓋的話第二趟是打在第一趟拆剩的塔上，
         沒東西可打自然就打得少、落得遠，兩趟的數字不能比（實測點空地那一趟
         打中 170 → 77 發、最遠 39 → 44）。 */
      cleanTools();
      startBuild(true);
      completeNow();
      tool = 'gate';
      useTool({ kind: 'ground', point: { x: -bp.radius - 20, y: 0, z: 0 } });
      useTool({ kind, point: { x: 0, y: ty, z: 0 } });
      const g = gates[0];
      const out = { ty0: +g.ty.toFixed(1), gy: +g.y.toFixed(1), spots: g.spots ? g.spots.length : 0 };
      /* 打中的高度從 hitWeapon 攔（那是「撞到固體」那條路，炸點在刃尖）。
         落地的距離事後從 weapons 撈——插在地上／躺著的都是 'lie'。 */
      const hy = [], oHit = hitWeapon;
      let aimN = 0, made = 0;
      const oNew = newWeapon;
      newWeapon = (gg, q) => { const w = oNew(gg, q); if (w) { made++; if (w.aimY > 0) aimN++; } return w; };
      hitWeapon = w => { hy.push(w.y + w.dy * w.len * 0.5); oHit(w); };
      let t = 0;
      while (t < 16 && (gates || (weapons && weapons.length))) { step(1 / 60); t += 1 / 60; }
      hitWeapon = oHit; newWeapon = oNew;
      const far = (weapons || []).filter(w => w.st === 'lie')
        .map(w => Math.hypot(w.x, w.z)).sort((a, b) => a - b);
      hy.sort((a, b) => a - b);
      cleanTools();
      return { ...out, made, aimN, far, hy };
    };
    /* 每一種點法跑**五趟**（v1.158.2 是三趟併成一池取百分位，v1.165 改成五趟、
       九成位取每趟的中位數，見下面）。一趟只落 80～95 把，九成位就是從那八十幾個
       樣本裡挑一個出來的，而點空地那一組尾巴很長（實測九成位 28.4、最遠 41）
       ——樣本一晃，下面那條比值就跟著跳，而門檻 2.5 離實測的 2.03 只有兩成餘裕。
       修的是樣本數與量法，兩個門檻一個字都沒動（同〈九條「偶爾飄」的測試〉裡
       「樣本數自己在擲骰子」那條的修法：射到湊滿為止）。
       **一個要記著的副作用**：farMax 取的是**整池**的最大值，趟數加上去它本來就會往上飄
       （三趟時實測點建築 61.4 → 63.2、點空地 41 → 46.6；五趟量到 65.7／42.1）。
       絕對門檻 85 仍有兩成餘裕，但下次若再把趟數加上去，要重看的是這一條
       而不是九成位那一條。
       **v1.161 整輪跑到這裡紅過一次**：點空地的九成位掉到 22.6（比值 2.55 > 2.5）。
       拿印出來的 seed 重跑兩棵樹對照——這一版 56.2／29.2（1.92）、v1.160.1 56.6／29.1
       （1.94），兩邊都過而且彼此只差 0.4，所以那一次是骰子不是回歸（三趟併起來仍然
       壓不住點空地那組的長尾）。要再修的話修的是**量法**（趟數再加、或改取每趟九成位的
       中位數），門檻仍然一個字都不要動。
       **v1.165 又紅了一次**（點空地 22.8、比值 2.504），所以照上面那句換量法：
       九成位改成**五趟各自的九成位取中位數**，不再把五趟的樣本併成一池再取百分位。
       差別在長尾：併成一池的話點空地那組的長尾會把整池的第 90 個百分位往下拉／往上推
       （一趟只落八十幾把，尾巴一晃就跳好幾單位）；取「每趟九成位的中位數」則是先在
       各趟內部消化掉自己的尾巴，再用中位數擋掉整趟偏掉的那一次。
       同一顆紅過的種子（2753267097）換量法之後：點建築 57.3／點空地 28.2 ＝ **2.03**
       ——回到註解開頭記的那個量級（1.97～2.05），離門檻 2.5 有兩成餘裕。
       **門檻仍然一個字都沒動**（85 與 2.5）。
       farMax 照舊取整池的最大值（那一條擋的是「阻力沒了」，要的就是極值）。
       ty0／gy／spots／aimN 這些每一趟都一樣，取第一趟的就好。 */
    const runN = kind => {
      const rs = [run(kind), run(kind), run(kind), run(kind), run(kind)];
      const far = rs.flatMap(r => r.far).sort((a, b) => a - b);
      const hy = rs.flatMap(r => r.hy).sort((a, b) => a - b);
      const per9 = rs.map(r => q(r.far, 0.9)).sort((a, b) => a - b);
      return { ...rs[0], rounds: rs.length, hits: hy.length, mid: q(hy, 0.5),
               lie: far.length, far9: per9[(per9.length - 1) >> 1], farMax: q(far, 1) };
    };
    const blk = runN('block'), gnd = runN('ground');
    return { ty: +ty.toFixed(1), H: +bp.height.toFixed(1), blk, gnd };
  });
  /* 點擊高度 39：block 那一趟打中的高度中位數實測 31.5，ground 那一趟 12.5（打中的發數
     兩趟都是 165，火力沒有因為改瞄準而變弱）。門檻取「比點空地高六成」（20）
     ＋「至少爬到點擊高度的六成」（23.4），兩條離實測值都有三成以上餘裕。
     v1.158.2 起每種點法跑**三趟併起來**（見 runN），所以「打中的發數」印的是三趟的總和
     （約 500），中位數與下面那條的九成位也都是併起來之後才算的——門檻沒動。 */
  ok('第二下點在建築上，火力就跟著打到那個高度（點空地照舊打身體下段）',
     gateHi.blk.ty0 === gateHi.ty && gateHi.blk.spots > 50 && gateHi.blk.hits > 100 &&
     gateHi.blk.mid > gateHi.gnd.mid * 1.6 && gateHi.blk.mid > gateHi.ty * 0.6,
     '台北 101（高 ' + gateHi.H + '）點在 ' + gateHi.ty + ' 高：打中 ' + gateHi.blk.hits +
     ' 發、高度中位數 ' + gateHi.blk.mid + '（點空地是 ' + gateHi.gnd.hits + ' 發、' +
     gateHi.gnd.mid + '）；吸得到的積木 ' + gateHi.blk.spots + ' 塊');
  /* 落空的那一把走**拋物線**落地（v1.152.1，使用者：v1.152.0 那個「穿過去 1.5 格
     然後扭一扭直直往下落」看起來很怪，「應該是變成拋物線才對」）。所以它落得比點空地遠
     ——那是拋物線本來就會有的事，要擋的是「一路滑出場外」不是「比點空地遠」。
     實測（四趟）：block 九成位 56～59、最遠 62～66；ground 九成位 28.6～29、最遠 37～42。
     兩條門檻各擋一種回歸：
     ① 絕對 85 擋「阻力沒了」——純拋物線（GATE_DRAG ＝ 0）同一座塔是九成位 87、最遠 97；
     ② 相對 2.5 倍擋「整條規則沒了」——拿掉 stepWeapons 那條 w.aimY 是九成位 175～198、
        最遠 248（畫面上是一條刀劍拖出去的尾巴橫過整片草地）。
     實測的比值 1.97～2.05，離 2.5 有兩成餘裕。 */
  ok('落空的那一把是拋物線落地，不是一路滑出場外',
     gateHi.blk.farMax < 85 && gateHi.blk.far9 < gateHi.gnd.far9 * 2.5,
     '插／躺在地上的距離：點建築 九成位 ' + gateHi.blk.far9 + '、最遠 ' + gateHi.blk.farMax +
     '（' + gateHi.blk.lie + ' 把）；點空地 九成位 ' + gateHi.gnd.far9 + '、最遠 ' +
     gateHi.gnd.farMax + '（' + gateHi.gnd.lie + ' 把）');
  // 點空地那一發完全沒被這一版動到：不指定高度、門陣高度一樣、沒有任何一把帶 aimY
  ok('點空地那一發跟 v1.151 一樣（不指定高度、門陣高度不動、沒有落空就墜落那條）',
     gateHi.gnd.ty0 === 0 && gateHi.gnd.aimN === 0 && gateHi.gnd.gy === gateHi.blk.gy &&
     gateHi.blk.aimN > 0,
     '點空地：目標高度 ' + gateHi.gnd.ty0 + '、帶落點高度的兵器 ' + gateHi.gnd.aimN + '/' +
     gateHi.gnd.made + ' 把；點建築 ' + gateHi.blk.aimN + '/' + gateHi.blk.made +
     ' 把；門陣高度兩邊都是 ' + gateHi.gnd.gy);

  /* ══════════ 大劍 ══════════
     使用者要的規格就是這幾條，一條一條驗：
       ① 點兩個位置（v1.164 起哪裡都能點：兩下都點地面就貼著地面水平橫掃）
       ② 大劍從第一個位置揮往第二個位置
       ③ 劍柄旋轉點的高度 ≈ 點在建築上那一次的高度
       ④ 刃的攻擊方向是第一點 → 第二點
       ⑤ 「建築物點擊位置 與該位置同高度的點 與地面的點 形成一個面 劍刃是在這個平面上
          揮動」——所以刃尖起手落在第一點、收手落在第二點（3D 距離都是刃尖半徑），
          而且**砍出來是斜的**（那個平面不是水平的）
     再加兩條這一把自己的：刃掃過的那一片才削得掉（不是整棟一起掉），
     以及**畫出來的刃跟判定用的扇形是同一塊**（引擎的 SWORD_* 那幾個數字兩邊共用）。 */
  await head('大劍');
  await reset(page, { shape: '美國國會大廈', cnt: 3000, workers: 6 });
  const swd = await page.evaluate(() => {
    completeNow();
    running = false;              // 主迴圈的模擬關掉，時間軸自己控（見 game-ui.js 的 frame）
    tool = 'sword';
    aim = null; swords = null;
    /* 建築上腰高、離場心最遠的那一塊當第一下（刃從那裡進去），第二下點對面的空地 */
    const set = blocks.filter(b => b.st === 3);
    let hi = 0;
    for (const b of set) if (b.y > hi) hi = b.y;
    let pick = null, far = -1;
    for (const b of set) {
      if (Math.abs(b.y - hi * 0.45) > 1) continue;
      const d = Math.hypot(b.x, b.z);
      if (d > far) { far = d; pick = b; }
    }
    /* **存快照不要存那塊積木本身**：它等一下就被這一刀打飛，
       之後 b.y 會變成「落在地上」的高度，後面幾條就會拿到錯的點（實測 9.47 → 0.47）。 */
    const p1 = { x: pick.x, y: pick.y, z: pick.z };
    const f = Math.hypot(p1.x, p1.z) || 1;
    const p2 = { x: -p1.x / f * 34, z: -p1.z / f * 34 };
    const clickB = () => useTool({ kind: 'block',
      point: new THREE.Vector3(p1.x, p1.y, p1.z),
      dir: new THREE.Vector3(0.2, -0.9, 0.2).normalize() });
    const clickG = q => useTool({ kind: 'ground',
      point: new THREE.Vector3(q.x, 0, q.z), dir: new THREE.Vector3(0, -1, 0) });

    /* ① 兩下都點地面（v1.164 使用者：「不再限定一定要點建築 如果兩下都地面就在地面
       水平橫掃就好」）：照樣揮，而且是**貼著地面水平橫掃**——樞紐在地面的高度上、
       兩點也在地面，那個平面自然是水平的（幾何沒有為它開特例）。
       v1.161～v1.163 這一下是不揮的：出一行提示、第一點留著等你再點一次建築。 */
    const t0 = toasts.length;
    clickG({ x: 30, z: 30 }); clickG(p2);
    const both = { n: swords ? swords.length : 0, aim: !!aim,
                   y: swords ? +swords[0].y.toFixed(2) : -1,
                   tilt: swords
                     ? +(Math.acos(Math.min(1, Math.abs(swords[0].ny))) * 180 / Math.PI).toFixed(3)
                     : -1,
                   toast: toasts.length > t0 ? toasts[toasts.length - 1].txt : '' };
    /* **一定要把它清掉**：不清的話下面那一把會排在 swords[1]，swords[0] 量到的是這一把 */
    swords = null; aim = null;

    /* 正常一趟：第一下建築、第二下空地 */
    clickB();
    const kept = aim ? { y: +aim.sy.toFixed(2), on: aim.son } : null;
    clickG(p2);
    const s = swords[0];
    const shot = { x: s.x, y: s.y, z: s.z, len: s.len, r0: s.r0, r1: s.r1,
                   band: s.band, span: s.span, back: s.back, over: s.over };
    /* ③④⑤ 樞紐到兩點的 **3D** 距離都該是「樞紐到刃尖」，而起手／收手的方向
       也該正對那兩點；平面的法線離垂直方向多遠 ＝ 那一刀有多斜。 */
    const dir = (q, y) => {
      const l = Math.hypot(q.x - s.x, y - s.y, q.z - s.z) || 1;
      return [(q.x - s.x) / l, (y - s.y) / l, (q.z - s.z) / l];
    };
    const at = th => {                     // 刃尖轉到 θ 的方向（同 swordAim）
      const c = Math.cos(th), n = Math.sin(th);
      return [s.u0x * c + s.e2x * n, s.u0y * c + s.e2y * n, s.u0z * c + s.e2z * n];
    };
    const off = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const d1 = dir(p1, p1.y), d2 = dir(p2, 0), uEnd = at(s.span);
    const geo = {
      r3d1: Math.hypot(p1.x - s.x, p1.y - s.y, p1.z - s.z),
      r3d2: Math.hypot(p2.x - s.x, 0 - s.y, p2.z - s.z),
      e0: off([s.u0x, s.u0y, s.u0z], d1), e1: off(uEnd, d2),
      /* 平面的傾角：法線跟垂直方向差幾度。0 ＝ 水平面（第一版那種水平的一條缺口） */
      tilt: Math.acos(Math.min(1, Math.abs(s.ny))) * 180 / Math.PI,
      clickY: p1.y
    };
    /* ⑥ 刃切到的那些，**被切的那一刻**記三個數：高度、離揮動平面多遠、當時轉到幾度
       （記飛完的位置沒有意義——它們被打飛之後就往上飛了）。
       只包到揮完為止：之後掉下來的是垮塌，不是刃切的。 */
    const oShake = ENG.shake, oBreak = breakBlock, oColl = collapseUnsupported;
    let shakes = 0;
    ENG.shake = (...a) => { shakes++; return oShake.apply(ENG, a); };
    const cutY = [];
    breakBlock = (b, vx, vy, vz) => {
      const w = swords && swords[0];
      if (w) {
        const ax = b.x - w.x, ay = b.y - w.y, az = b.z - w.z;
        /* 三個數：高度、離揮動平面多遠、以及**刃面在這一塊的水平位置上有多高**
           （yp ＝ 平面方程式解出來的高度）。斜不斜就看 yp 在整個缺口裡的落差——
           水平面算出來落差就是 0，不必訂什麼經驗門檻。
           （繞了兩圈才找到這個量法：先拿「先切到 vs 後切到」比，量到的是建築形狀
             不是斜度，因為平面是**固定**的、刃只是在平面裡轉；改拿「沿著兩點連線
             的位置」比也只差 1.46，因為連線方向不是平面的下坡方向。） */
        cutY.push([b.y, Math.abs(ax * w.nx + ay * w.ny + az * w.nz),
                   w.y - ((b.x - w.x) * w.nx + (b.z - w.z) * w.nz) / w.ny]);
      }
      return oBreak(b, vx, vy, vz);
    };
    /* 垮塌先停掉：不停的話「刃切的」跟「上面失去支撐垮下來的」會混在同一份紀錄裡
       （兩邊都走 breakBlock），就分不出刃到底掃到哪一片。垮塌本身另有一段在測。 */
    collapseUnsupported = () => 0;
    const before = blocks.filter(b => b.st === 3).length;
    const phs = [], angs = [];
    for (let i = 0; i < 50; i++) {          // 0.83 秒：出現＋回抽 0.22 ＋ 揮 0.42 都跑完
      step(0.0166);
      const w = swords && swords[0];
      phs.push(w ? w.ph : '-');
      angs.push(w ? w.ang : 0);
    }
    /* 回抽 → 加速 → 超過（v1.162 使用者要的那一段）：整趟的角度紀錄裡，最小值要落在
       0 以下（先往攻擊的反方向拉開）、最後停在 span 之後（收手超過一點），
       而「角度走最多的那一步」要落在揮擊的後半段（起手慢、加速、後段最快）。 */
    let minA = 1e9, maxA = -1e9, sw0 = -1, sw1 = -1;
    for (let i = 0; i < angs.length; i++) {
      if (angs[i] < minA) minA = angs[i];
      if (angs[i] > maxA) maxA = angs[i];
      if (phs[i] === 'swing') { if (sw0 < 0) sw0 = i; sw1 = i; }
    }
    let dMax = -1, fast = -1;
    for (let i = Math.max(1, sw0); i <= sw1; i++) {
      const d = angs[i] - angs[i - 1];
      if (d > dMax) { dMax = d; fast = (i - sw0) / Math.max(1, sw1 - sw0); }
    }
    const wind = { back: minA, end: maxA, fast: fast };
    breakBlock = oBreak; collapseUnsupported = oColl;
    /* 「一趟只震一次」要在**這裡**就把數字收起來：後面幾條（掃到人那一段）還會再叫
       swordCut，事後才數的話數到的是那幾刀加起來的。 */
    const shakeN = shakes;
    const midSet = blocks.filter(b => b.st === 3).length;
    let lo = 1e9, hiY = -1e9, offMax = 0;
    /* 刃面在缺口裡從多高掉到多低（ypHi → ypLo），以及每一塊離刃面的**垂直**距離
       有沒有超過「一個刃寬」換算成垂直的量（band / cos 傾角）。 */
    let ypHi = -1e9, ypLo = 1e9, vOff = 0;
    for (const r of cutY) {
      if (r[0] < lo) lo = r[0];
      if (r[0] > hiY) hiY = r[0];
      if (r[1] > offMax) offMax = r[1];
      if (r[2] > ypHi) ypHi = r[2];
      if (r[2] < ypLo) ypLo = r[2];
      const dv = Math.abs(r[0] - r[2]);
      if (dv > vOff) vOff = dv;
    }
    const slant = { hi: ypHi, lo: ypLo, vOff: vOff,
                    vLim: s.band / Math.max(1e-6, Math.abs(s.ny)) };

    /* ⑥ 畫面與判定是同一塊。兩件事一起驗：
       ⓐ 造型表裡**最遠那一塊的外緣**就是引擎開給規則用的 SWORD_TIP
          （規則那邊拿它算刃尖半徑；對不上的話刃會掃到判定範圍外或反過來）；
       ⓑ 那一塊**畫出來的世界位置**落在「樞紐 ＋ 現在掃到的角度 × 它自己的半徑」上，
          而且跟樞紐同一個高度（整把躺平橫掃）。 */
    draw();
    let ti = 0, tEdge = -1e9;
    for (let k = 0; k < ENG.SWORD_PARTS; k++) {
      const P = ENG.MODELS.sword[k], e = P.p[1] + P.s[1] / 2;
      if (e > tEdge) { tEdge = e; ti = k; }
    }
    const m = new THREE.Matrix4(), v = new THREE.Vector3(),
          q = new THREE.Quaternion(), sc = new THREE.Vector3();
    ENG.three.swordMesh.getMatrixAt(ti, m);
    m.decompose(v, q, sc);
    const rt = (ENG.MODELS.sword[ti].p[1] - ENG.SWORD_PIVOT) * s.len;   // 那一塊中心的半徑
    const tipErr = Math.hypot(v.x - (s.x + s.ux * rt), v.y - (s.y + s.uy * rt),
                              v.z - (s.z + s.uz * rt));
    // 刃面就是揮動平面：那一塊的中心離平面的距離該是 0
    const tipPlane = Math.abs((v.x - s.x) * s.nx + (v.y - s.y) * s.ny + (v.z - s.z) * s.nz);
    const tipEdgeErr = Math.abs(tEdge - ENG.SWORD_TIP);
    /* 刃根那一頭同理：SWORD_EDGE 該是刃主體（第 0 塊）的下緣 */
    const rootEdge = ENG.MODELS.sword[0].p[1] - ENG.MODELS.sword[0].s[1] / 2;
    const rootErr = Math.abs(rootEdge - ENG.SWORD_EDGE);

    /* 淡出：停一下、化成金光、自己收乾淨 */
    const fadeLog = [];
    for (let i = 0; i < 120; i++) {
      step(0.0166);
      const w = swords && swords[0];
      if (i % 20 === 0) fadeLog.push(w ? [w.ph, +w.fade.toFixed(2), +w.glow.toFixed(2)] : ['-', 0, 0]);
    }
    const gone = swords === null;

    /* 同時最多三把（第四把把最早那把擠掉，同其他清單型道具） */
    for (let k = 0; k < 4; k++) { aim = null; clickB(); clickG(p2); }
    const keep = swords.length;

    /* 兩點比刃還開：刃長頂到上限、樞紐退到中點（掃到接近 180 度）。
       v1.162 刃長翻倍（上限 92）之後 120 單位已經在刃長之內了，所以這一條要點更遠。 */
    aim = null; swords = null;
    clickB();
    clickG({ x: -p1.x / f * 260, z: -p1.z / f * 260 });
    const wide = { len: swords[0].len, span: swords[0].span };

    /* 兩下都點在**同高度**的建築上：那個平面就是水平的，缺口回到水平的一條
       （斜不斜完全由那兩點的高低差決定，不是寫死的） */
    aim = null; swords = null;
    clickB();
    useTool({ kind: 'block', point: new THREE.Vector3(-p1.x, p1.y, -p1.z),
              dir: new THREE.Vector3(0.2, -0.9, 0.2).normalize() });
    const flat = { tilt: Math.acos(Math.min(1, Math.abs(swords[0].ny))) * 180 / Math.PI,
                   y: swords[0].y };

    /* 兩下都點在建築上、**高度不一樣**：樞紐用第一點的高度（v1.162 使用者：
       「點兩下都是建築時 就從第一點位置揮到第二點」），刃尖照樣起手落在第一點、
       收手落在第二點（兩段 3D 距離都是刃尖半徑）。 */
    aim = null; swords = null;
    clickB();
    const p3 = { x: -p1.x, y: p1.y * 0.5, z: -p1.z };
    useTool({ kind: 'block', point: new THREE.Vector3(p3.x, p3.y, p3.z),
              dir: new THREE.Vector3(0.2, -0.9, 0.2).normalize() });
    const w2 = swords[0];
    const twoB = { y: w2.y, r1: w2.r1,
                   r3d1: Math.hypot(p1.x - w2.x, p1.y - w2.y, p1.z - w2.z),
                   r3d2: Math.hypot(p3.x - w2.x, p3.y - w2.y, p3.z - w2.z) };

    /* 刃掃到小人與動物（v1.163，使用者：「大劍也要如果剛好碰到小人&吉祥物等動物
       也要產生效果」）。直接叫 swordCut 把整趟的角度一次掃完，不用 step——
       step 的話人會自己走動，量到的變成「他走去哪」而不是「刃掃到誰」。
       擺三個人一隻吉祥物：站在刃面上的該被撞飛，站在樞紐正下方（半徑不到刃根）的
       與站在離刃面四個刃寬外的都不該飛。 */
    aim = null; swords = null;
    clickB(); clickG(p2);
    const sw = swords[0];
    /* 刃面上、離地半個身高的那一點：沿著揮動平面掃一圈角度，找「刃在這個半徑上
       剛好是 0.6 高」的那個角——那裡的刃是從站著的人身上橫過去的。 */
    let spot = null;
    for (let k = 60; k >= 1 && !spot; k--) {
      const th = sw.span * k / 60, cs = Math.cos(th), sn = Math.sin(th);
      const uy = sw.u0y * cs + sw.e2y * sn;
      if (uy > -1e-3) continue;                       // 這個角的刃是往上的，碰不到地面
      const r = (0.6 - sw.y) / uy;
      if (r < sw.r0 + 3 || r > sw.r1 - 3) continue;
      spot = { x: sw.x + (sw.u0x * cs + sw.e2x * sn) * r, z: sw.z + (sw.u0z * cs + sw.e2z * sn) * r,
               dx: sw.u0x * cs + sw.e2x * sn, dz: sw.u0z * cs + sw.e2z * sn, r: r };
    }
    if (!spot) {                       // 找不到就退到第二點（刃尖收手就落在那裡，貼著地面）
      const dl = Math.hypot(p2.x - sw.x, p2.z - sw.z) || 1;
      spot = { x: p2.x, z: p2.z, dx: (p2.x - sw.x) / dl, dz: (p2.z - sw.z) / dl, r: sw.r1 };
    }
    const put = (w, x, z) => {
      w.x = x; w.z = z; w.y = 0;
      w.air = 0; w.burn = 0; w.fall = 0; w.lit = 0; w.roll = 0;
    };
    const men = workers.slice(0, 3);
    put(men[0], spot.x, spot.z);                                   // 刃面上：該被撞飛
    put(men[1], sw.x, sw.z);                                       // 樞紐正下方：半徑不到刃根
    beasts = null;
    const mob = spawnBeast('ape', 1);                              // 吉祥物（不搞破壞的那種）
    mob.x = spot.x + spot.dx * 3; mob.z = spot.z + spot.dz * 3;    // 沿著刃挪開一點，還在刃面上
    mob.y = 0; mob.st = 'fun'; mob.stay = 999; mob.fall = 0; mob.air = 0;
    swordCut(sw, -sw.back, sw.span + sw.over, 0.42);               // 整趟一次掃完
    const lives = { on: men[0].air ? 1 : 0, pivot: men[1].air ? 1 : 0,
                    mob: mob.air ? 1 : 0,
                    sp: +Math.hypot(men[0].vx || 0, men[0].vz || 0).toFixed(1),
                    up: +(men[0].vy || 0).toFixed(1) };
    /* 一塊積木都沒切到也要有效果（使用者說的是「剛好碰到」）：同一段角度再掃一次，
       這時扇形裡的積木上一刀已經削光了，n ＝ 0，走的就是「只掃到人」那條路。 */
    put(men[1], spot.x, spot.z);
    const set0 = blocks.filter(b => b.st === 3).length;
    swordCut(sw, -sw.back, sw.span + sw.over, 0.42);
    lives.setSame = blocks.filter(b => b.st === 3).length === set0 ? 1 : 0;
    lives.noBlock = men[1].air ? 1 : 0;
    beasts = null;
    /* 刃從**頭上**掃過去的不算（同「炸在屋頂、砸在高處，下面的人不被震倒」那條）：
       兩下都點在同高度的建築上那一刀，整片刃面就停在點擊的高度上，
       站在扇形正下方的人離刃面差了快一層樓，不該被掃到。 */
    aim = null; swords = null;
    clickB();
    useTool({ kind: 'block', point: new THREE.Vector3(-p1.x, p1.y, -p1.z),
              dir: new THREE.Vector3(0.2, -0.9, 0.2).normalize() });
    const fw = swords[0];
    const fr = (fw.r0 + fw.r1) / 2, fth = fw.span * 0.5;
    put(men[2], fw.x + (fw.u0x * Math.cos(fth) + fw.e2x * Math.sin(fth)) * fr,
                fw.z + (fw.u0z * Math.cos(fth) + fw.e2z * Math.sin(fth)) * fr);
    swordCut(fw, -fw.back, fw.span + fw.over, 0.42);
    lives.under = men[2].air ? 1 : 0;
    lives.planeY = +fw.y.toFixed(2);

    ENG.shake = oShake;
    swords = null; aim = null; tool = 'hammer'; running = true;
    return { both, kept, shot, geo, before, midSet, cut: cutY.length, lives,
             lo: +lo.toFixed(2), hi: +hiY.toFixed(2), offMax, slant, shakes: shakeN, wind,
             phs: phs.filter((p, i) => i === 0 || p !== phs[i - 1]).join('→'),
             tipErr, tipEdgeErr, tipEdge: tEdge, tipPart: ti, tipPlane, rootErr,
             fadeLog, gone, keep, wide, flat, twoB };
  });
  ok('兩下都點地面照樣揮，而且是貼著地面水平橫掃（v1.164 不再限定要點建築）',
     swd.both.n === 1 && swd.both.y === 0 && swd.both.tilt < 0.01 &&
     !swd.both.aim && swd.both.toast === '',
     '揮出 ' + swd.both.n + ' 把、樞紐高度 ' + swd.both.y + '、揮動平面傾 ' +
     swd.both.tilt + '°、瞄準點收掉 ' + !swd.both.aim +
     '、沒有提示 ' + (swd.both.toast === '' ? 'true' : '「' + swd.both.toast + '」'));
  ok('劍柄旋轉點的高度 ＝ 點在建築上那一下的高度',
     swd.kept.on === true && Math.abs(swd.shot.y - swd.geo.clickY) < 1e-6,
     '點在 ' + swd.geo.clickY.toFixed(2) + ' 高，劍柄旋轉點 ' + swd.shot.y.toFixed(2));
  /* 樞紐在「點到建築那一下」的高度上、離兩點的 **3D** 距離都是「樞紐到刃尖」
     ＝ 刃尖起手落在第一點、收手落在第二點。兩點在刃長之內時誤差只會是浮點的量級。 */
  ok('刃尖起手落在第一點、收手落在第二點（樞紐到兩點的 3D 距離都是刃尖半徑）',
     Math.abs(swd.geo.r3d1 - swd.shot.r1) < 0.01 &&
     Math.abs(swd.geo.r3d2 - swd.shot.r1) < 0.01,
     '刃尖半徑 ' + swd.shot.r1.toFixed(2) + '；樞紐到第一點 ' + swd.geo.r3d1.toFixed(2) +
     '、到第二點 ' + swd.geo.r3d2.toFixed(2));
  ok('揮擊方向是第一點 → 第二點（起手正對第一點、收手正對第二點）',
     swd.geo.e0 < 1e-9 && swd.geo.e1 < 1e-9 && swd.shot.span > 0.3,
     '起手誤差 ' + swd.geo.e0.toExponential(1) + '、收手誤差 ' + swd.geo.e1.toExponential(1) +
     '、掃過 ' + (swd.shot.span * 180 / Math.PI).toFixed(1) + '°');
  ok('出現 → 揮 → 停 → 淡掉，四段依序走完',
     swd.phs === 'rise→swing→hold', swd.phs);
  /* 使用者：「出現後先有一段 往攻擊反方向移動一小段距離 然後向攻擊方向加速
     揮完後會超過一點」——三件事一條測試：回抽到 −back、收手停在 span＋over、
     角度走最快的那一步落在揮擊的後半段（起手是從靜止的回抽開始加速的）。 */
  ok('出現後先往攻擊的反方向回抽、再加速揮過去、揮完超過一點',
     swd.shot.back > 0.05 && Math.abs(swd.wind.back + swd.shot.back) < 1e-9 &&
     swd.shot.over > 0.02 &&
     Math.abs(swd.wind.end - (swd.shot.span + swd.shot.over)) < 1e-9 &&
     swd.wind.fast > 0.6,
     '回抽 ' + (-swd.wind.back * 180 / Math.PI).toFixed(1) + '°、揮到 ' +
     (swd.wind.end * 180 / Math.PI).toFixed(1) + '°（第二點在 ' +
     (swd.shot.span * 180 / Math.PI).toFixed(1) + '°，超過 ' +
     (swd.shot.over * 180 / Math.PI).toFixed(1) + '°）；最快的一步落在揮擊的 ' +
     (swd.wind.fast * 100).toFixed(0) + '% 處');
  /* 「砍成斜的」：點在建築上那一點高、地面那一點低，揮動平面就是斜的，
     所以先切到的比後切到的高。兩個都驗：平面的傾角，以及真的切下來的那些的高度。 */
  /* 兩件事一起驗，兩件都不需要經驗門檻：
     ① 缺口裡的刃面**從點在建築上那一下的高度掉到接近地面**——落差至少是點擊高度的
        一半（水平的一刀落差是 0，所以這一條只有斜的才過得了）；
     ② 每一塊離刃面的垂直距離都在「一個刃寬換算成垂直」之內，也就是缺口真的貼著那個斜面。 */
  ok('點建築的高、點地面的低 → 砍出來是斜的（不是水平的一條）',
     swd.geo.tilt > 5 && swd.slant.hi - swd.slant.lo > swd.geo.clickY * 0.5 &&
     swd.slant.vOff <= swd.slant.vLim + 1e-6,
     '揮動平面傾 ' + swd.geo.tilt.toFixed(1) + '°；缺口裡的刃面從 ' +
     swd.slant.hi.toFixed(2) + ' 高掉到 ' + swd.slant.lo.toFixed(2) +
     '（落差 ' + (swd.slant.hi - swd.slant.lo).toFixed(2) + '，點擊高度 ' +
     swd.geo.clickY.toFixed(2) + '）；離刃面最遠的一塊（垂直）' + swd.slant.vOff.toFixed(2) +
     '，上限 ' + swd.slant.vLim.toFixed(2));
  /* 刃掃過的那一片才削得掉：被刃切到的每一塊，被切的那一刻都在「揮動平面 ± 一個刃寬」裡。
     量的是**被切的那一刻**——打飛之後它們會往上飛，量飛完的位置就分不出刃切與垮塌。 */
  ok('削掉的是刃掃過的那一片（每一塊被切時都在揮動平面 ± 一個刃寬內）',
     swd.cut > 200 && swd.offMax <= swd.shot.band + 1e-6,
     '削掉 ' + swd.cut + ' 塊、離平面最遠的一塊 ' + swd.offMax.toFixed(3) +
     '（刃寬 ' + swd.shot.band.toFixed(2) + '）；被切時的高度分布 ' + swd.lo + '～' + swd.hi);
  ok('一趟揮擊只震一次畫面（它每一幀都在切，每幀都震會抖到揮完）',
     swd.shakes === 1, '震了 ' + swd.shakes + ' 次');
  /* 畫面與判定同一份：引擎的 SWORD_TIP／SWORD_PIVOT 兩邊共用，
     所以刃尖那一塊畫出來的位置就該落在判定用的刃尖半徑上。 */
  ok('畫出來的刃跟判定用的是同一份數字，而且刃面就是揮動平面',
     swd.tipEdgeErr < 1e-9 && swd.rootErr < 1e-9 && swd.tipErr < 0.02 &&
     swd.tipPlane < 0.02,
     '造型表第 ' + swd.tipPart + ' 塊的外緣 ' + swd.tipEdge + ' ＝ SWORD_TIP（差 ' +
     swd.tipEdgeErr.toExponential(1) + '）、刃主體下緣 ＝ SWORD_EDGE（差 ' +
     swd.rootErr.toExponential(1) + '）；那一塊畫出來的位置差 ' +
     swd.tipErr.toExponential(1) + '、離揮動平面 ' + swd.tipPlane.toExponential(1));
  ok('揮完原地化成金光淡掉，最後自己收乾淨',
     swd.fadeLog[0][0] === 'hold' && swd.gone &&
     swd.fadeLog.some(r => r[0] === 'fade' && r[1] < 0.6 && r[2] > 0.4),
     swd.fadeLog.map(r => r[0] + ' 濃度 ' + r[1] + ' 金光 ' + r[2]).join('　→　') +
     '　→　' + (swd.gone ? '收乾淨' : '還留著'));
  ok('同時最多三把（第四把把最早那把擠掉）', swd.keep === 3, '場上 ' + swd.keep + ' 把');
  ok('兩點比刃還開時：刃長頂到上限、樞紐退到中點（掃到接近 180 度）',
     Math.abs(swd.wide.len - 92) < 1e-6 && swd.wide.span > Math.PI * 0.92,
     '刃長 ' + swd.wide.len + '、掃過 ' + (swd.wide.span * 180 / Math.PI).toFixed(1) + '°');
  /* 斜不斜完全由那兩點的高低差決定：兩下都點在同高度的建築上，平面就是水平的 */
  ok('兩下點在同高度的建築上 → 平面回到水平（缺口是水平的一條）',
     swd.flat.tilt < 0.01 && Math.abs(swd.flat.y - swd.geo.clickY) < 1e-6,
     '揮動平面傾 ' + swd.flat.tilt.toFixed(3) + '°、樞紐高度 ' + swd.flat.y.toFixed(2));
  /* v1.163 使用者：「大劍也要如果剛好碰到小人&吉祥物等動物 也要產生效果」。
     兩件事一起驗：掃到的被撞飛（而且掃不到的三種情形都不動），以及**一塊積木都沒切到
     的那一刀照樣把人撞飛**——本來只有 afterHit 會震倒「削掉的那堆積木附近」的人，
     刃從空地上的人身上掃過去是完全沒反應的。 */
  ok('刃掃到的小人與吉祥物會被撞飛，掃不到的不動',
     swd.lives.on === 1 && swd.lives.mob === 1 &&
     swd.lives.pivot === 0 && swd.lives.under === 0 &&
     swd.lives.sp > 3 && swd.lives.up > 0,
     '刃面上的人被撞飛（水平 ' + swd.lives.sp + '、抬升 ' + swd.lives.up +
     '）、吉祥物 ' + (swd.lives.mob ? '也飛了' : '沒反應') + '；樞紐正下方的（半徑不到刃根）' +
     (swd.lives.pivot ? '飛了' : '沒動') + '、刃在 ' + swd.lives.planeY +
     ' 高橫掃時站在正下方的 ' + (swd.lives.under ? '飛了' : '沒動'));
  ok('一塊積木都沒切到的那一刀，照樣把刃掃到的人撞飛',
     swd.lives.setSame === 1 && swd.lives.noBlock === 1,
     '第二刀削掉 ' + (swd.lives.setSame ? '0' : '不只 0') + ' 塊積木，站在刃面上的人 ' +
     (swd.lives.noBlock ? '照樣被撞飛' : '沒反應'));
  /* v1.162 使用者：「點兩下都是建築時 就從第一點位置揮到第二點」——樞紐取**第一點**
     的高度（原本取兩點的中間），刃尖照樣起手落在第一點、收手落在第二點。 */
  ok('兩下都點在建築上（高度不同）→ 樞紐用第一點的高度，從第一點揮到第二點',
     Math.abs(swd.twoB.y - swd.geo.clickY) < 1e-6 &&
     Math.abs(swd.twoB.r3d1 - swd.twoB.r1) < 0.01 &&
     Math.abs(swd.twoB.r3d2 - swd.twoB.r1) < 0.01,
     '第一點 ' + swd.geo.clickY.toFixed(2) + ' 高、第二點 ' +
     (swd.geo.clickY * 0.5).toFixed(2) + ' 高，樞紐 ' + swd.twoB.y.toFixed(2) +
     '；樞紐到兩點 ' + swd.twoB.r3d1.toFixed(2) + '／' + swd.twoB.r3d2.toFixed(2) +
     '（刃尖半徑 ' + swd.twoB.r1.toFixed(2) + '）');

  /* ══════════ 幽浮 ══════════
     使用者指定的順序就是這一段的骨架：
       ① 點地面 → 一台幽浮從場外飛進來、停在那個位置上方（高度類似打雷的烏雲）
       ② 往下照光，吸引積木（類似龍捲風幾%的數量）與小人等
       ③ 吸進 UFO 後飛走
       ④ 5 秒後被吸走的所有東西從天上掉下來
     所以這一段每一條都對著其中一項；另外三條守著容易壞的地方：
     光圈外的東西不該被吸、換場中途不能把積木留在地板底下、擠掉的那一台要把東西放掉。 */
  await head('幽浮');
  await reset(page, { shape: '吉薩大金字塔', cnt: 1800, workers: 12 });
  const ufo = await page.evaluate(() => {
    completeNow();
    /* 240 幀散場：完工那一刻小人在繞圈慶祝，不散開的話落點上站著一排人，
       量「吸走幾塊積木」會被他們被吸走那幾件混進去。 */
    for (let i = 0; i < 240; i++) step(0.05);
    const y = Math.max(UFO_Y0, bp.height + UFO_UP);
    /* 光圈裡現在有幾塊還站著。用的是規則那邊真的在用的那支 ufoRad（倒錐），
       不是「半徑 UFO_R 的圓柱」——比例要對得上才知道「吸走幾成」是幾成。 */
    const probe = { x: 0, z: 0, y };
    let inLight = 0;
    for (const b of blocks)
      if (b.st === 3 && b.x * b.x + b.z * b.z <= ufoRad(probe, b.y) ** 2) inLight++;
    const set0 = blocks.filter(b => b.st === 3).length;
    const camY0 = ENG.camTarget.ty;
    const mouth = y - UFO_HULL * ENG.UFO_MOUTH_Y;
    callUfo({ x: 0, z: 0 });
    const born = { d: +Math.hypot(ufos[0].x, ufos[0].z).toFixed(1), y: ufos[0].y,
                   st: ufos[0].st, arena: +arenaR.toFixed(1) };
    let f = 0, comeT = -1, beamT = -1, goneT = -1, dropT = -1;
    let camUp = 0, hit = 0, bag = 0, rise = 0, riseTop = 0, riseLow = 99;
    let atTarget = -1, awayD = -1, park = 0;
    let taken = null, high = 0, backD = 0, backMax = 0;
    while (f < 900) {
      step(0.05); f++;
      const u = ufos && ufos[0];
      if (u) {
        camUp = Math.max(camUp, ENG.camTarget.ty);
        hit = u.hit; bag = Math.max(bag, u.bag.length + u.up.length);
        if (comeT < 0 && u.st !== 'come') {
          comeT = +(f * 0.05).toFixed(2);
          atTarget = +Math.hypot(u.x - 0, u.z - 0).toFixed(2);
        }
        if (beamT < 0 && u.beam >= 1) beamT = +(f * 0.05).toFixed(2);
        /* 光柱裡那些：先被捲上去才進艙。riseTop 是它們飛到的最高處
           （該貼著吸光口 mouth），riseLow 是還在光裡那些的最低處。 */
        rise = Math.max(rise, u.up.length);
        for (const it of u.up) {
          riseTop = Math.max(riseTop, it.o.y);
          riseLow = Math.min(riseLow, it.o.y);
        }
        // 進艙的沉在地板底下（看不見）
        if (u.bag.length) park = Math.max(park, u.bag.filter(it => it.o.y < -10).length);
        if (u.st === 'wait' && goneT < 0) {
          goneT = +(f * 0.05).toFixed(2);
          awayD = +Math.hypot(u.x, u.z).toFixed(1);
          // 記下「被吸走的地方」，等它們掉回來再量差多遠
          taken = u.bag.slice(0, 40).map(it => ({ o: it.o, x: it.x, z: it.z }));
        }
        /* 東西丟下來那一刻（'rain'：幽浮已經不畫了，只是還在借鏡頭讓那一坨掉完）。 */
        if (u.st === 'rain' && dropT < 0) {
          dropT = +(f * 0.05).toFixed(2);
          for (const t of taken) {
            high = Math.max(high, t.o.y);
            const d = Math.hypot(t.o.x - t.x, t.o.z - t.z);
            backD += d / taken.length; backMax = Math.max(backMax, d);
          }
        }
      } else if (dropT >= 0) break;
    }
    const set1 = blocks.filter(b => b.st === 3).length;
    // 落地：等它們躺下來，再確認沒有東西卡在地板底下、旗標也清乾淨了
    for (let i = 0; i < 300; i++) step(0.05);
    return {
      inLight, set0, set1, hit, bag, rise, park,
      share: +(hit / Math.max(1, inLight) * 100).toFixed(1),
      // 理論值跟著兩個常數走（同龍捲風那條）：照光 UFO_BEAM 秒、每秒抽 UFO_TAKE
      want: +((1 - Math.pow(1 - UFO_TAKE, UFO_BEAM)) * 100).toFixed(1),
      born, comeT, beamT, goneT, dropT, awayD, atTarget,
      wantY: y, mouth: +mouth.toFixed(2), riseTop: +riseTop.toFixed(1), riseLow: +riseLow.toFixed(1),
      high: +high.toFixed(1), backD: +backD.toFixed(1), backMax: +backMax.toFixed(1),
      camY0: +camY0.toFixed(1), camUp: +camUp.toFixed(1), camEnd: +ENG.camTarget.ty.toFixed(1),
      under: blocks.filter(b => b.y < -1).length,
      flagged: blocks.filter(b => b.ufo).length,
      carry: blocks.filter(b => b.st === 1).length,
      free: blocks.filter(b => b.st === 0).length,
      pool: blocks.length
    };
  });
  ok('點地面：幽浮從場外飛進來（不是憑空出現在點擊處）',
     ufo.born.d > ufo.born.arena && ufo.born.st === 'come' && ufo.atTarget < 0.01,
     '出場在半徑 ' + ufo.born.d + '（場地半徑 ' + ufo.born.arena + '），' +
     ufo.comeT + ' 秒後到位、離點擊處 ' + ufo.atTarget);
  /* 高度照烏雲那一套：屋頂上方 UFO_UP，矮建築至少 UFO_Y0（使用者：「高度類似打雷烏雲」）。 */
  ok('停的高度照屋頂算（同打雷的烏雲）',
     ufo.born.y === ufo.wantY && ufo.wantY === Math.max(34, 10 + 16),
     '飛在 ' + ufo.born.y + '（屋頂 ' + (ufo.wantY - 16) + ' ＋ 16，下限 34）');
  /* 畫出來那一根倒錐就是判定用的那一根（同 DOZ_W 的用意）：
     引擎的錐度必須等於規則那邊的 UFO_MOUTH ÷ UFO_R，不然會看到「光柱外的積木被吸走」。 */
  const ufoK = await page.evaluate(() => ({
    taper: ENG.UFO_TAPER, ratio: UFO_MOUTH / UFO_R, mouthY: ENG.UFO_MOUTH_Y,
    lastPart: ENG.UFO_PART[ENG.UFO_PARTS - 1].p[1], max: ENG.UFO_MAX, r: UFO_R
  }));
  ok('光柱畫出來的那一根就是判定用的那一根',
     Math.abs(ufoK.taper - ufoK.ratio) < 0.005 &&
     Math.abs(ufoK.mouthY + ufoK.lastPart) < 1e-6,
     '錐度 ' + ufoK.taper + '（判定 ' + ufoK.ratio.toFixed(3) + '）、吸光口 ' +
     ufoK.mouthY + '（造型最後一片在 ' + ufoK.lastPart + '）');
  /* 使用者：「吸引積木（類似龍捲風幾%的數量）」——所以驗的是**幾成**，而且比例
     跟著 UFO_TAKE／UFO_BEAM 走（v1.168 改成理論值 ±12，不再寫死 55～85%）：
     吸走幾塊是隨機抽的、也是之後會調的細節，這一條只要守住「按比例抽，
     不是整根吸光」（第一版 UFO_TAKE 0.55 就是吸光的，見 game-tools 那段註解）。 */
  ok('照光吸走的是光圈裡的「幾成」（照 UFO_TAKE 抽），不是整根吸光',
     Math.abs(ufo.share - ufo.want) < 12 && ufo.hit > 0,
     '光圈裡 ' + ufo.inLight + ' 塊還站著 → 吸走 ' + ufo.hit + ' 塊（' + ufo.share +
     '%，理論 ' + ufo.want + '%）；整座 SET ' + ufo.set0 + ' → ' + ufo.set1 +
     '（含失去支撐自己垮的）');
  ok('積木先被光捲上去，碰到吸光口才進艙',
     ufo.rise > 0 && ufo.riseTop > ufo.mouth - 1.5 && ufo.riseTop < ufo.mouth + 0.6 &&
     ufo.riseLow < 5,
     '同時最多 ' + ufo.rise + ' 塊在光裡飄，飄到最高 ' + ufo.riseTop +
     '（吸光口在 ' + ufo.mouth + '）、最低 ' + ufo.riseLow);
  ok('進艙的沉到地板底下（畫面上看不見，也不必跟著幽浮搬）',
     ufo.park > 0,
     '艙裡最多同時 ' + ufo.park + ' 件沉在地板底下（這一趟吸走 ' + ufo.hit + ' 塊）');
  ok('吸完就飛走：飛出場外才算走掉',
     ufo.awayD > ufo.born.arena, '飛到半徑 ' + ufo.awayD + ' 才收掉（場地半徑 ' + ufo.born.arena + '）');
  /* 使用者指定的「5 秒後」：從飛出場那一刻算起。 */
  ok('飛走之後 5 秒，被吸走的東西從天上掉下來',
     ufo.dropT - ufo.goneT > 4.9 && ufo.dropT - ufo.goneT < 5.2 && ufo.high > 60,
     '飛走 ' + ufo.goneT + ' 秒 → 掉下來 ' + ufo.dropT + ' 秒（差 ' +
     (ufo.dropT - ufo.goneT).toFixed(2) + ' 秒），出現在 ' + ufo.high + ' 高');
  ok('掉回「被吸走的那個地方」上方，不是幽浮飛走的方向',
     ufo.backD < 4 && ufo.backMax < 6,
     '平均離原地 ' + ufo.backD + '、最遠 ' + ufo.backMax + '（抖動是刻意加的 ±3）');
  ok('掉下來的積木最後躺在地上，沒有卡在地板底下或留著旗標',
     ufo.under === 0 && ufo.flagged === 0 && ufo.carry === 0 && ufo.free > 0 &&
     ufo.pool === ufo.set0,
     '地板底下 ' + ufo.under + ' 塊、還帶旗標 ' + ufo.flagged + ' 塊、躺在地上 ' +
     ufo.free + ' 塊，池子 ' + ufo.pool + ' 塊沒變');
  ok('照光期間鏡頭抬起來，飛走就把高度還回去',
     ufo.camUp > ufo.camY0 + 5 && Math.abs(ufo.camEnd - ufo.camY0) < 0.01,
     '視線高度 ' + ufo.camY0 + ' → 最高 ' + ufo.camUp + ' → 收工 ' + ufo.camEnd);

  /* 光圈外的東西一塊都不能被吸（倒錐的邊界），以及小人與動物照樣吸得走。
     積木自己擺位置：拿散料排成兩圈（光圈裡半徑 2、光圈外半徑 UFO_R+4）。 */
  const ufoWho = await page.evaluate(() => {
    cleanTools();
    /* 地上鋪滿散料就好，不蓋建築：這一條要量的是散料、人與動物。
       （completeNow() 會把整池積木都砌進地標，一塊散料都不剩，就沒東西可擺了。） */
    scatterFree();
    for (let i = 0; i < 20; i++) step(0.05);
    callUfo({ x: 0, z: 0 });
    /* **等光亮起來才擺**。飛進來那三秒足夠小人走出光圈（他們是會走的，
       實測 12 個人只剩 4 個還站在裡面），動物同理，所以三種都在這一刻才擺進去。 */
    let f = 0;
    while (f < 200 && !(ufos && ufos[0].st === 'beam')) { step(0.05); f++; }
    /* 兩圈散料：光圈裡 60 塊（半徑 2／4／6）、光圈外 40 塊（半徑 UFO_R + 4）。
       這一條要守的是**邊界**（外圈一塊都不能動），裡圈只要「有被吸到」就算數——
       吸走幾成是照 UFO_TAKE 抽的，量在上面那條（用 905 塊）。 */
    const near = [], far = [];
    let k = 0;
    for (const b of blocks) {
      if (b.st !== 0 && b.st !== 4) continue;
      if (k >= 100) break;
      const a = k / 20 * Math.PI * 2, rad = k < 60 ? 2 + (k % 3) * 2 : UFO_R + 4;
      if (b.cell) gridDel(b);
      b.x = Math.cos(a) * rad; b.z = Math.sin(a) * rad; b.y = HB;
      b.st = 0; b.rest = true; b.snap = 0; b.vx = b.vy = b.vz = 0;
      gridAdd(b);
      (k < 60 ? near : far).push(b);
      k++;
    }
    const men = workers.slice(0, 12);
    men.forEach((w, i) => {
      releaseWorker(w);
      w.x = Math.cos(i / 12 * Math.PI * 2) * 3; w.z = Math.sin(i / 12 * Math.PI * 2) * 3;
      w.y = 0; w.air = 0; w.fall = 0; w.burn = 0;
    });
    spawnBeast('ape', 1, 0);
    const ape = beasts[beasts.length - 1];
    ape.x = 2; ape.z = -2; ape.y = 0; ape.st = 'fun';
    /* 飛龍不吸（同龍捲風：牠在天上飛）。直接把一條放在光柱裡那個高度，
       stepDoom 在這一段是停著的（見 installClean），所以牠不會自己飛走。 */
    spawnDragon(1, 0);
    const dra = beasts[beasts.length - 1];
    dra.x = 1; dra.z = 1; dra.y = 26;
    let menUp = 0, apeUp = 0, draUp = 0, apeTop = -99;
    /* 「被吸走過」要在過程中記（旗標只在被抓著的那段時間是 1）：
       全部掉回地面之後再看的話，兩圈積木都躺在地上，分不出誰被吸過。 */
    const nearHit = new Set(), farHit = new Set();
    while (f < 900) {
      step(0.05); f++;
      apeTop = Math.max(apeTop, ape.y);      // 掉下來那一幀幽浮已經收掉了，所以擺在外面
      for (const b of near) if (b.ufo) nearHit.add(b);
      for (const b of far) if (b.ufo) farHit.add(b);
      const u = ufos && ufos[0];
      if (u) {
        const all = u.up.concat(u.bag);
        menUp = Math.max(menUp, all.filter(it => it.kind === 1).length);
        if (all.some(it => it.o === ape)) apeUp = 1;
        if (all.some(it => it.o === dra)) draUp = 1;
      } else if (f > 220) break;
    }
    // 掉下來之後：等牠們落地（stepDoom 停著，所以動物自己不動——放回去再推）
    stepDoom = window.doomStep;
    for (let i = 0; i < 300; i++) step(0.05);
    return {
      nearTaken: nearHit.size, nearN: near.length,
      farTaken: farHit.size, farN: far.length,
      menUp, apeUp, draUp, apeTop: +apeTop.toFixed(1),
      apeY: +ape.y.toFixed(2), apeUfo: ape.ufo, apeFall: +(ape.fall || 0).toFixed(1),
      menStand: workers.filter(w => !w.air && !w.ufo && w.y < 1).length,
      menUfo: workers.filter(w => w.ufo).length,
      draUfo: dra.ufo
    };
  });
  ok('光圈裡的散料被吸走，光圈外的一塊都沒動',
     ufoWho.nearTaken > 0 && ufoWho.farTaken === 0,
     '光圈裡 ' + ufoWho.nearTaken + '/' + ufoWho.nearN + ' 被吸走、外圈（半徑 ' +
     (ufoK.r + 4) + '）' + ufoWho.farTaken + '/' + ufoWho.farN);
  ok('站在光裡的小人會被吸走，掉下來之後自己站起來',
     ufoWho.menUp >= 10 && ufoWho.menUfo === 0 && ufoWho.menStand >= 10,
     '吸走 ' + ufoWho.menUp + ' 個人，最後站著的 ' + ufoWho.menStand + ' 個、還帶旗標 ' +
     ufoWho.menUfo + ' 個');
  ok('動物也吸得走（飛龍例外：牠在天上飛）',
     ufoWho.apeUp === 1 && ufoWho.draUp === 0 && !ufoWho.draUfo &&
     ufoWho.apeTop > 60 && ufoWho.apeY < 1 && !ufoWho.apeUfo,
     '猴子被吸走、從 ' + ufoWho.apeTop + ' 高掉回地面（y=' + ufoWho.apeY +
     '、旗標 ' + (ufoWho.apeUfo || 0) + '）；飛龍' +
     (ufoWho.draUp ? '也被吸了' : '沒被吸（旗標 ' + (ufoWho.draUfo || 0) + '）'));

  /* 兩件容易壞的收尾：中途換場（CARRY 的積木會被 startBuild 解成碎料）、
     第三次點擊擠掉最早那一台。兩種都不能把積木留在地板底下。 */
  const ufoEdge = await page.evaluate(() => {
    cleanTools(); completeNow();
    for (let i = 0; i < 120; i++) step(0.05);
    callUfo({ x: 0, z: 0 });
    let f = 0;
    while (f < 200 && !(ufos && ufos[0].bag.length >= 30)) { step(0.05); f++; }
    const bag = ufos && ufos[0] ? ufos[0].bag.length : -1;
    startBuild(true);                                  // 換場
    for (let i = 0; i < 400; i++) step(0.05);
    const swap = { bag, under: blocks.filter(b => b.y < -1).length,
                   flagged: blocks.filter(b => b.ufo).length,
                   ufos: ufos ? ufos.length : 0 };
    // 擠掉：連點三次
    cleanTools(); completeNow();
    for (let i = 0; i < 120; i++) step(0.05);
    callUfo({ x: 0, z: 0 });
    for (let i = 0; i < 120; i++) step(0.05);
    callUfo({ x: 14, z: 0 });
    for (let i = 0; i < 40; i++) step(0.05);
    const n2 = ufos.length, held = ufos[0].bag.length + ufos[0].up.length;
    callUfo({ x: -14, z: 0 });
    const n3 = ufos.length;
    for (let i = 0; i < 600; i++) step(0.05);
    return { swap, n2, n3, held,
             under: blocks.filter(b => b.y < -1).length,
             flagged: blocks.filter(b => b.ufo).length,
             cam: +ENG.camTarget.ty.toFixed(1), left: ufos ? ufos.length : 0 };
  });
  ok('照到一半換場：積木不會被留在地板底下',
     ufoEdge.swap.under === 0 && ufoEdge.swap.flagged === 0 && ufoEdge.swap.bag >= 30,
     '換場時艙裡有 ' + ufoEdge.swap.bag + ' 塊 → 地板底下 ' + ufoEdge.swap.under +
     ' 塊、還帶旗標 ' + ufoEdge.swap.flagged + ' 塊');
  ok('同時最多兩台，第三次點擊把最早那一台擠掉（手上的東西在原地放掉）',
     ufoEdge.n2 === 2 && ufoEdge.n3 === 2 && ufoEdge.held > 50 &&
     ufoEdge.under === 0 && ufoEdge.flagged === 0 && ufoEdge.left === 0 &&
     Math.abs(ufoEdge.cam) < 0.01,
     '第二台在場 ' + ufoEdge.n2 + ' 台、第三台照樣 ' + ufoEdge.n3 +
     ' 台；被擠掉那一台手上有 ' + ufoEdge.held + ' 件 → 地板底下 ' + ufoEdge.under +
     ' 塊、視線高度還回去（' + ufoEdge.cam + '）');

  /* 畫面：碟身、邊燈、光柱三顆 mesh。沒幽浮在場時一律 visible=false
     （沒東西在場就不吃 draw call，README〈效能〉那條規矩）。 */
  const ufoDraw = await page.evaluate(() => {
    cleanTools(); completeNow();
    for (let i = 0; i < 60; i++) step(0.05);
    draw(); ENG.render();
    const base = ENG.info().calls;
    const t = ENG.three;
    const off = { hull: t.ufoMesh.visible, lit: t.ufoLitMesh.visible, beam: t.ufoBeamMesh.visible };
    callUfo({ x: 0, z: 0 });
    let f = 0, on = null, calls = 0;
    while (f < 300) {
      step(0.05); f++;
      if (ufos && ufos[0].st === 'beam' && ufos[0].beam >= 1) {
        draw(); ENG.render();
        on = { hull: t.ufoMesh.visible, hullN: t.ufoMesh.count,
               lit: t.ufoLitMesh.visible, litN: t.ufoLitMesh.count,
               beam: t.ufoBeamMesh.visible, beamN: t.ufoBeamMesh.count };
        calls = ENG.info().calls;
        break;
      }
    }
    ufoClear();
    draw(); ENG.render();
    const after = { hull: t.ufoMesh.visible, lit: t.ufoLitMesh.visible, beam: t.ufoBeamMesh.visible,
                    calls: ENG.info().calls };
    return { base, off, on, calls, after };
  });
  ok('沒幽浮在場時三顆 mesh 都不畫（一個 draw call 都不吃）',
     !ufoDraw.off.hull && !ufoDraw.off.lit && !ufoDraw.off.beam &&
     !ufoDraw.after.hull && !ufoDraw.after.lit && !ufoDraw.after.beam &&
     ufoDraw.after.calls === ufoDraw.base,
     '沒在場 ' + ufoDraw.base + ' 個 draw call，收工後也是 ' + ufoDraw.after.calls);
  ok('在場時碟身 6 塊、邊燈與艙罩 7 塊、光柱 1 根',
     ufoDraw.on.hull && ufoDraw.on.hullN === 6 &&
     ufoDraw.on.lit && ufoDraw.on.litN === 7 &&
     ufoDraw.on.beam && ufoDraw.on.beamN === 1 &&
     ufoDraw.calls - ufoDraw.base <= 6,
     '碟身 ' + ufoDraw.on.hullN + ' ＋ 燈 ' + ufoDraw.on.litN + ' ＋ 光柱 ' +
     ufoDraw.on.beamN + '，draw call ' + ufoDraw.base + ' → ' + ufoDraw.calls);

  /* ══════════ 放火 ══════════
     這個道具沒有「一下」，威力全在蔓延，所以量的是「火有沒有沿著格子走」與
     「燒完那塊有沒有變黑掉下來」。用大建築測：小的燒到剩 25% 就整棟垮掉換場，
     量到的會是換場規則不是火。 */
  await head('放火');
  await reset(page, { shape: '新天鵝堡', cnt: 2400, workers: 6 });
  const fire = await page.evaluate(() => {
    completeNow();
    tool = 'fire';
    /* 從中段高度點火：貼地那層點下去的話，燒斷幾塊就整片垮，
       量不出「火自己往旁邊走」跟「上面失去支撐垮下來」的差別。 */
    const cand = blocks.filter(b => b.st === 3).sort((a, b) => b.y - a.y);
    const t = cand[Math.floor(cand.length * 0.35)];
    const p0 = { x: t.x, y: t.y, z: t.z };
    const ph0 = phase;
    useTool({ kind: 'block', idx: blocks.indexOf(t),
              point: new THREE.Vector3(t.x, t.y, t.z), dir: new THREE.Vector3(0, -1, 0) });
    const lit = { n: fires ? fires.length : 0, burn: t.burn, ph0, ph1: phase };
    const set0 = placedCnt, sm0 = stats.smashed;
    for (let i = 0; i < 40; i++) step(0.05);            // 2 秒
    /* 蔓延中的火離點火處多遠。沿著格子走的話這時候還是一小片；
       整棟同時燒的話這個數字會直接跳到建築的尺度。 */
    const near = fires.map(f => Math.hypot(f.b.x - p0.x, f.b.y - p0.y, f.b.z - p0.z));
    const spread = { n: fires.length, far: Math.max(...near) };
    for (let i = 0; i < 160; i++) step(0.05);           // 再 8 秒
    // 焦黑：燒完的那塊會鬆脫掉下來，而且掉下來之後還是黑的
    const charred = blocks.filter(b => b.st !== 3 && b.tr < 0.1);
    const onGround = charred.filter(b => b.y < 2.5).length;
    const burnt = { n: charred.length, onGround, set: placedCnt, sm: stats.smashed };
    /* 同時在燒的上限。手動一路點到點不動為止——真的等它自己燒到 150 塊要好幾十秒，
       而且會先把建築燒垮。數的是 nSpread（還站著的那種火）：碎料的火走另一份額度。 */
    for (const b of blocks) igniteBlock(b);              // 點到點不動為止
    const cap = { fires: nSpread, all: fires.length, hot: 0, HOT_MAX, FIRE_MAX };
    // 火苗要跑幾幀才生得出來，量的是這段時間的峰值
    for (let i = 0; i < 30; i++) { step(0.05); cap.hot = Math.max(cap.hot, hot.length); }
    startBuild(true);
    const swap = { fires: fires ? fires.length : 0, burning: blocks.filter(b => b.burn).length };
    return { lit, set0, sm0, spread, burnt, cap, swap };
  });
  ok('點建築就從那一塊燒起來', fire.lit.n === 1 && fire.lit.burn === 1 &&
     fire.lit.ph0 === 'done' && fire.lit.ph1 === 'wreck',
     '起火 ' + fire.lit.n + ' 塊，phase ' + fire.lit.ph0 + ' → ' + fire.lit.ph1);
  ok('火會往旁邊的格子蔓延，而且是連成一片的',
     fire.spread.n > 4 && fire.spread.far < 12,
     '2 秒後 ' + fire.spread.n + ' 塊在燒，最遠的離點火處 ' + fire.spread.far.toFixed(1));
  ok('燒完的積木會焦黑、鬆脫掉到地上',
     fire.burnt.n > 20 && fire.burnt.onGround > 10 && fire.burnt.set < fire.set0 &&
     fire.burnt.sm > fire.sm0,
     '焦黑 ' + fire.burnt.n + ' 塊（落地 ' + fire.burnt.onGround + '），建築 ' +
     fire.set0 + ' → ' + fire.burnt.set + ' 塊');
  /* freeBlock 會把目標色打回建材色（碎料就是建材），焦黑要設在它之後。
     順序錯的話積木一掉下來就恢復原本的顏色，「燒黑」等於白做——這條就是在守那個順序。 */
  ok('掉下來之後還是焦黑的，不會恢復原色', fire.burnt.onGround > 10,
     '地上有 ' + fire.burnt.onGround + ' 塊目標色還是黑的');
  ok('同時在燒的塊數有上限', fire.cap.fires === fire.cap.FIRE_MAX,
     '還站著的 ' + fire.cap.fires + ' / ' + fire.cap.FIRE_MAX + ' 塊（連碎料共 ' +
     fire.cap.all + ' 塊在燒）');
  /* 火苗跟爆炸的火球共用同一個粒子池。整棟在燒時把池子吃光的話，
     這時候丟一發核彈就會沒有火球，所以火苗的配額除以 √(在燒的塊數)、並留一截給爆炸。 */
  ok('整棟在燒也不會把爆炸的火球配額吃光', fire.cap.hot < fire.cap.HOT_MAX - 30,
     fire.cap.FIRE_MAX + ' 塊在燒時 ' + fire.cap.hot + ' / ' + fire.cap.HOT_MAX + ' 顆火粒子');
  /* v1.59 反過來了：換建築時火**不收**。一整棟在燒忽然全暗是「換場感」最重的一筆，
     現在那些燒著的積木會被打散成碎料、拖著火飛出去、落地燒成焦炭。
     擋的是下一步——小人把還在燒的碎料撿去蓋新的那座（見下面那條 douse 的測試）。 */
  ok('換建築時火不會被收掉，燒著的碎料繼續燒',
     fire.swap.fires > 0 && fire.swap.burning > 0,
     '換場後 ' + fire.swap.fires + ' 處還在燒、' + fire.swap.burning + ' 塊還帶著火');
  /* 火留著之後唯一要擋的：小人把還在燒的碎料撿去砌新的那座。
     不擋的話新建築會從某幾塊莫名地開始燒起來——那正是 v1.59 之前整批收火的理由。 */
  const carryFire = await page.evaluate(() => {
    cleanTools(); startBuild(true); completeNow();
    for (const b of blocks) if (b.st === 3) igniteBlock(b);
    const lit = fires ? fires.length : 0;
    startBuild(true);                                  // 整棟被打散成碎料，火跟著留下來
    const kept = fires ? fires.length : 0;
    let worst = 0, i = 0;
    while (i++ < 900 && placedCnt < 40) {              // 蓋到四十塊就夠看出來了
      step(0.05);
      if (fires) worst = Math.max(worst, fires.filter(f => f.b.st === 3).length);
    }
    const placed = placedCnt;
    cleanTools();
    return { lit, kept, worst, placed };
  });
  ok('燒著的碎料被撿去蓋新的那座之前會先熄掉',
     carryFire.lit > 0 && carryFire.kept > 0 && carryFire.placed >= 40 && carryFire.worst === 0,
     '換場時 ' + carryFire.kept + ' 塊還帶著火 → 新建築砌了 ' + carryFire.placed +
     ' 塊，其中著火的 ' + carryFire.worst + ' 塊');

  /* ══════════ 碎料燃燒 ══════════
     爆炸打出來的碎料會帶著火飛出去，燒滿 3 秒變成一塊焦炭。
     一律拿大城堡的邊角開炸：塌不到 25%，量到一半才不會被「拆完換下一座」洗掉狀態。 */
  await head('碎料燃燒');
  const emb2 = await page.evaluate(() => {
    running = false;
    const setup = () => {
      targetCnt = 3000; shapePick = SHAPES.findIndex(s => s.n === '新天鵝堡');
      setWorkerCount(6); startBuild(true); completeNow(); clearFires();
      const cand = blocks.filter(b => b.st === 3).sort((a, b) => b.x - a.x);
      return { x: cand[0].x, y: cand[0].y, z: cand[0].z };
    };

    /* 1. 這一發炸到的每一塊都要在燒。先自己算「範圍內有幾塊」，
       再跟點著的塊數對——只驗「有燒起來」的話，燒 5 塊跟燒 500 塊看起來一樣對。 */
    let p = setup();
    let inR = 0;
    for (const b of blocks) {
      if (b.st === 1 || b.st === 2) continue;                 // 小人手上的不算
      if ((b.x - p.x) ** 2 + (b.y - p.y) ** 2 + (b.z - p.z) ** 2 <= 121) inR++;
    }
    explode(p, 11, 17);
    const all = { inR, ember: fires.filter(f => !f.sp).length, spread: nSpread,
                  unlit: blocks.filter(b => b.st === 4 && !b.burn).length };

    // 2. 燒 3 秒：目標色一路往焦黑走，中點該剛好在一半
    const sample = fires.filter(f => !f.sp).slice(0, 40).map(f => f.b);
    const at = [];
    const snap = t => at.push({ t, tr: +sample[0].tr.toFixed(3),
                                burn: sample.filter(b => b.burn).length,
                                black: sample.filter(b => b.tr < 0.06).length });
    snap(0);
    for (let i = 0; i < 90; i++) step(1 / 60); snap(1.5);
    for (let i = 0; i < 90; i++) step(1 / 60); snap(3);
    for (let i = 0; i < 120; i++) step(1 / 60); snap(5);

    /* 3. 一塊碎料單獨燒：量準確的燒完時間，順便驗它燒完只是停在焦黑——
       建築那種火燒完會 breakBlock 再掉一次，碎料本來就在地上，不該再被打一次。 */
    p = setup();
    // 挑最底層那塊：一敲就落地躺好，3 秒後還在半空的話這條會分不出「燒完彈起來」
    const solo = blocks.filter(b => b.st === 3).sort((a, b) => a.y - b.y)[0];
    breakBlock(solo, 0, 0, 0);
    clearFires();
    igniteBlock(solo);                     // 要趁它還是 FLY：躺穩變 FREE 之後就點不著了
    const sm0 = stats.smashed, pl0 = placedCnt;
    let g = 0;
    while (solo.burn && g++ < 400) step(1 / 60);
    const one = { t: +(g / 60).toFixed(2), st: solo.st, tr: +solo.tr.toFixed(3),
                  sm: stats.smashed - sm0, pl: pl0 - placedCnt,
                  fires: fires ? fires.length : 0 };

    /* 4. 兩份額度分開：一發核彈級的爆炸點著上千塊碎料之後，
       還站著的照樣點得起來（共用一份額度的話這裡會回 false）。 */
    p = setup();
    explode(p, 30, 34);
    phase = 'done';               // 擋掉「拆完換下一座」——它會把火全收掉
    const stand = blocks.filter(b => b.st === 3 && !b.burn);
    const quota = { ember: fires.filter(f => !f.sp).length, spread: nSpread,
                    standing: stand.length, canLight: stand.length ? igniteBlock(stand[0]) : null };

    /* 5. 火苗要平順。同一幀點著上千塊，配額若從 0 起跳它們會同時湊滿一顆，
       火就變成「整片一起閃、然後一起沒有」。量 1 秒內每幀的火苗數，看谷底。 */
    const hots = [];
    for (let i = 0; i < 60; i++) { step(1 / 60); hots.push(hot.length); }
    const smooth = { min: Math.min(...hots.slice(20)), max: Math.max(...hots),
                     dust: dust.length };

    /* 6. 效能：上千塊在燒的當下。
       **量三次取中位**，不是一段就定案（v1.148）：這是牆上時鐘，在一輪二十分鐘的
       測試裡總會遇到一次不巧的排程／GC。實測單獨跑同一份 fixture 是
       step 0.33～0.45ms、draw 0.40～0.45ms（跟這一節記的 0.40／0.44 一致），
       而整輪跑的時候量到過一次 2.85／3.54 ——同一份程式碼、同一台機器。
       一段變慢不算，三段都慢才算（真的變慢的話三段都會慢）。
       每一段都**重新點一次火**：碎料只燒 3 秒，接著量第二、三段的話火已經熄了，
       量到的會是一個空場的成本（更快，等於這條測試不再驗它說要驗的東西）。 */
    const samples = [];
    for (let s = 0; s < 3; s++) {
      const q = setup();
      explode(q, 30, 34);
      phase = 'done';                 // 同上：擋掉「拆完換下一座」，不然火會被收掉
      for (let i = 0; i < 12; i++) step(1 / 60);
      let t0 = performance.now();
      for (let i = 0; i < 60; i++) step(1 / 60);
      const st = (performance.now() - t0) / 60;
      t0 = performance.now();
      for (let i = 0; i < 60; i++) draw();
      samples.push({ st, dr: (performance.now() - t0) / 60, n: fires ? fires.length : 0 });
    }
    const sorted = samples.slice().sort((a, b) => (a.st + a.dr) - (b.st + b.dr));
    const mid = sorted[1];
    const perf = { fires: mid.n, stepMs: mid.st, drawMs: mid.dr,
                   all: samples.map(s => +(s.st + s.dr).toFixed(2)) };

    // 7. 不是爆炸的道具不該點火：投石機的石頭只是砸
    p = setup();
    const rockN = smash(p, { x: 0.12, y: -1, z: 0.12 }, ROCK_R, ROCK_POW);
    const rock = { n: rockN, fires: fires ? fires.length : 0 };

    // 8. 換場要把碎料的火與額度一起歸零
    p = setup();
    explode(p, 11, 17);
    startBuild(true);
    const swap = { fires: fires ? fires.length : 0, spread: nSpread,
                   burning: blocks.filter(b => b.burn).length };
    return { all, at, one, quota, smooth, perf, rock, swap };
  });
  ok('爆炸打出來的碎料每一塊都在燒',
     emb2.all.ember === emb2.all.inR && emb2.all.unlit === 0,
     '範圍內 ' + emb2.all.inR + ' 塊 → 點著 ' + emb2.all.ember +
     ' 塊碎料（另有 ' + emb2.all.spread + ' 塊還站著的餘火）');
  /* 目標色從建材色 0.80 線性收到焦黑 0.05，所以 1.5 秒該剛好在中點 0.425。
     只驗頭尾的話，燒 1 秒或燒 10 秒都會通過。 */
  ok('碎料燒 3 秒，顏色一路收到焦黑',
     Math.abs(emb2.at[1].tr - 0.425) < 0.02 && emb2.at[1].burn === 40 &&
     emb2.at[2].black === 40,
     '0 秒 ' + emb2.at[0].tr + ' → 1.5 秒 ' + emb2.at[1].tr + ' → 3 秒 ' + emb2.at[2].tr);
  ok('燒完就停在焦黑，不會恢復原色', emb2.at[3].burn === 0 && emb2.at[3].black === 40,
     '5 秒後 ' + emb2.at[3].black + ' / 40 塊還是黑的，' + emb2.at[3].burn + ' 塊還在燒');
  ok('單獨一塊碎料剛好燒 3.0 秒',
     Math.abs(emb2.one.t - 3) < 0.05 && emb2.one.tr < 0.06,
     '燒了 ' + emb2.one.t + ' 秒，收在 ' + emb2.one.tr);
  /* 建築那種火燒完會 breakBlock（再飛一次、記一次擊飛）。碎料走同一份程式碼，
     少了 f.sp 這道閘門的話，地上躺著的碎料會在燒完那一刻自己彈起來。 */
  ok('碎料燒完不會再被打掉一次',
     emb2.one.st === 0 && emb2.one.sm === 0 && emb2.one.pl === 0,
     '燒完 st=' + emb2.one.st + '（0=躺在地上）、擊飛 +' + emb2.one.sm + '、進度 -' + emb2.one.pl);
  ok('碎料的火不會吃掉建築那份額度',
     emb2.quota.ember > 500 && emb2.quota.canLight === true &&
     emb2.quota.spread < 150,
     emb2.quota.ember + ' 塊碎料在燒時，還站著的火只用了 ' + emb2.quota.spread +
     ' / 150，仍點得起來（' + emb2.quota.canLight + '）');
  ok('上千塊一起燒，火苗不會整片一起閃一起沒',
     emb2.smooth.min > 60 && emb2.smooth.max <= 190,
     '1 秒內火苗數 ' + emb2.smooth.min + ' ~ ' + emb2.smooth.max + ' 顆（煙 ' +
     emb2.smooth.dust + ' 團）');
  ok('上千塊碎料在燒：CPU 每幀 < 4ms', emb2.perf.stepMs + emb2.perf.drawMs < 4,
     emb2.perf.fires + ' 塊在燒：step ' + emb2.perf.stepMs.toFixed(2) + 'ms + draw ' +
     emb2.perf.drawMs.toFixed(2) + 'ms（量三段取中位，三段各是 ' +
     emb2.perf.all.join('／') + 'ms）');
  /* 「爆炸類」才點火。投石機的石頭是砸不是炸，砸出來的碎料不該起火——
     一起燒的話這個道具會變成放火的低配版。 */
  ok('不是爆炸的道具不會把碎料點著', emb2.rock.n > 0 && emb2.rock.fires === 0,
     '投石機砸掉 ' + emb2.rock.n + ' 塊，起火 ' + emb2.rock.fires + ' 處');
  ok('換建築時碎料的火照樣留著（v1.59）',
     emb2.swap.fires > 0 && emb2.swap.burning > 0,
     '換場後 ' + emb2.swap.fires + ' 處在燒、額度 ' + emb2.swap.spread +
     '、' + emb2.swap.burning + ' 塊還帶著火');

  /* ══════════ 煙火 ══════════
     它是「往天上灑火種」：一發打不掉任何積木，但落下來的火星碰到建築就從那一塊燒起來。
     v1.39 起一次點下去是**三發齊射**（第二、三發晚 0.2～0.5 秒 ×序號出膛）。 */
  /* ══════════ 消防車與潮濕 ══════════
     建造中失火本來會卡死（沒有消防車的量測見 README）：小人把積木補回火場旁邊，
     新放上去的又被蔓延點著。v1.68 加了「被水噴到就濕 5 秒、濕的點不著」，
     以及建造中會從地圖邊緣開進來的消防車。 */
  await head('消防車與潮濕');

  const wetOne = await page.evaluate(() => {
    cleanTools(); startBuild(true); completeNow();
    const b = blocks.find(k => k.st === 3);
    for (let i = 0; i < 20; i++) step(0.05);          // 顏色先收斂到它自己的建材色
    const dry = b.r, tr0 = b.tr;
    wetBlock(b);
    const litWet = igniteBlock(b);                   // 濕的點不著
    for (let i = 0; i < 20; i++) step(0.05);          // 1 秒：顏色已經壓深了
    const wetC = b.r, trWet = b.tr;
    for (let i = 0; i < 120; i++) step(0.05);         // 再 6 秒：早就乾了
    const back = b.r, litDry = igniteBlock(b);
    cleanTools();
    return { dry: +dry.toFixed(3), wetC: +wetC.toFixed(3), back: +back.toFixed(3),
             ratio: +(wetC / dry).toFixed(3), litWet, litDry,
             sameTr: Math.abs(tr0 - trWet) < 1e-9, want: WET_DARK, life: WET_TIME };
  });
  ok('淋濕的積木點不著，乾了才又點得著',
     wetOne.litWet === false && wetOne.litDry === true,
     '濕的時候 igniteBlock ' + wetOne.litWet + '、' + wetOne.life + ' 秒後 ' + wetOne.litDry);
  ok('淋濕的積木顏色壓深 ×0.8，而且不去改它自己的顏色',
     Math.abs(wetOne.ratio - wetOne.want) < 0.02 && wetOne.sameTr &&
     Math.abs(wetOne.back - wetOne.dry) < 0.005,
     '乾 ' + wetOne.dry + ' → 濕 ' + wetOne.wetC + '（×' + wetOne.ratio + '）→ 乾 ' +
     wetOne.back + '；b.tr 沒被動過 ' + wetOne.sameTr);

  /* 讀 b.r 只證明「資料算對了」，證明不了使用者看得到（這支程式踩過幾次）。
     所以再量一次畫面：同一個機位，全乾拍一張、全濕拍一張，比「像積木的那些像素」的亮度。
     金字塔是米色的一大片，最適合量這種整體變深；順便看一眼引擎收到的 instance 顏色。 */
  const wetPix = await page.evaluate(() => {
    cleanTools();
    targetCnt = 3000; shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    startBuild(true); completeNow();
    for (let i = 0; i < 6; i++) ENG.updateCamera(1);
    const shot = () => {
      draw(); ENG.render();
      const gl = ENG.three.renderer.getContext();
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      // 只取像積木的像素：偏灰白（R≈G≈B 而且夠亮）。草地是綠的、天空是藍的
      let sum = 0, n = 0;
      for (let i = 0; i < px.length; i += 4) {
        const r = px[i], g = px[i + 1], b = px[i + 2];
        if (r > 90 && Math.abs(r - g) < 26 && r > b && r - b < 60) { sum += r; n++; }
      }
      return { avg: +(sum / Math.max(1, n)).toFixed(1), n };
    };
    const dry = shot();
    for (const b of blocks) if (b.st === 3) wetBlock(b);
    for (let i = 0; i < 40; i++) step(0.05);
    const wet = shot();
    const one = blocks.find(b => b.st === 3);
    const col = ENG.three.blockMesh.instanceColor;
    const c0 = col ? +col.array[0].toFixed(3) : -1;
    cleanTools();
    return { dry, wet, base: +one.tr.toFixed(3), drawn: +one.r.toFixed(3), c0 };
  });
  ok('濕了是真的畫得比較深，不只是資料上比較深',
     wetPix.wet.avg < wetPix.dry.avg - 8 && wetPix.dry.n > 20000 &&
     Math.abs(wetPix.c0 - wetPix.base * 0.8) < 0.01,
     '積木那些像素平均亮度 ' + wetPix.dry.avg + ' → ' + wetPix.wet.avg + '（' +
     wetPix.dry.n + ' 個像素），引擎收到的第一塊顏色 ' + wetPix.c0 +
     '（原色 ' + wetPix.base + ' × 0.8）');

  /* 「噴水滅火」就是 wetBlock 裡那一行 douse：燒黑的顏色留著不還原
     （那是真的被燒過的痕跡），但火要當場滅。 */
  const wetDouse = await page.evaluate(() => {
    cleanTools(); startBuild(true); completeNow();
    const b = blocks.find(k => k.st === 3);
    igniteBlock(b);
    for (let i = 0; i < 20; i++) step(0.05);          // 燒一秒，顏色已經往焦黑走了
    const burning = b.burn, n0 = fires ? fires.length : 0, char = +b.tr.toFixed(3);
    wetBlock(b);
    const after = { burn: b.burn, n: fires ? fires.length : 0, tr: +b.tr.toFixed(3) };
    cleanTools();
    return { burning, n0, char, after };
  });
  ok('水澆在燒著的積木上會當場滅火，燒黑的痕跡留著',
     wetDouse.burning === 1 && wetDouse.after.burn === 0 &&
     wetDouse.after.n === wetDouse.n0 - 1 && wetDouse.after.tr === wetDouse.char,
     '澆水前 ' + wetDouse.n0 + ' 處在燒 → 澆水後 ' + wetDouse.after.n +
     '，那一塊的目標色停在 ' + wetDouse.after.tr + '（燒黑的）');

  /* 派車：只有建造中。拆除中你自己點的火不該被 AI 滅掉（使用者指定）。 */
  const ftCall = await page.evaluate(() => {
    const fireUp = (n) => {                            // 一次點著 n 塊，湊到叫車門檻
      const cand = blocks.filter(k => k.st === 3 && !k.burn);
      for (let i = 0; i < n && i < cand.length; i++)
        igniteBlock(cand[Math.floor(i * cand.length / n)]);
    };
    // 建造中
    cleanTools(); startBuild(true); completeNow();
    phase = 'build';
    fireUp(FT_CALL + 4);
    const lit = nSpread;
    for (let i = 0; i < 4; i++) step(0.05);
    const inBuild = trucks ? trucks.list.length : 0;
    const startR = trucks ? Math.min(...trucks.list.map(m => Math.hypot(m.x, m.z))) : 0;
    // 拆除中
    cleanTools(); startBuild(true); completeNow();
    phase = 'wreck';
    fireUp(FT_CALL + 4);
    const litW = nSpread;
    for (let i = 0; i < 40; i++) step(0.05);
    const inWreck = trucks ? trucks.list.length : 0;
    cleanTools();
    return { lit, inBuild, startR: +startR.toFixed(1), litW, inWreck,
             call: FT_CALL, edge: +(arenaR + DOZ_FAR).toFixed(1), max: FT_MAX };
  });
  ok('建造中火勢起來會叫消防車，而且從地圖邊緣進場',
     ftCall.lit >= ftCall.call && ftCall.inBuild >= 1 && ftCall.inBuild <= ftCall.max &&
     ftCall.startR > ftCall.edge - 4,
     ftCall.lit + ' 塊在燒 → 來了 ' + ftCall.inBuild + ' 台（上限 ' + ftCall.max +
     '），出發點在半徑 ' + ftCall.startR + '（碎料場外緣 ' + ftCall.edge + '）');
  ok('拆除中不叫車：你自己點的火不該被 AI 滅掉',
     ftCall.litW >= ftCall.call && ftCall.inWreck === 0,
     ftCall.litW + ' 塊在燒，兩秒後場上 ' + ftCall.inWreck + ' 台');

  /* 車走外圈（使用者指定）：建造中不能像整地那樣叫小人退到旁邊等，
     所以車一步都不進工地，停在 siteClearR 外面往裡面噴。 */
  const ftRun = await page.evaluate(() => {
    cleanTools();
    targetCnt = 3000; shapePick = SHAPES.findIndex(s => s.n === '巴黎聖母院');
    setWorkerCount(20);
    startBuild(true);
    // 先瞬間砌好一半（真的蓋要兩分鐘，這一條要驗的是火跟車，不是搬磚）
    const half = Math.floor(bp.slots.length * 0.45);
    for (let i = 0; i < half; i++) {
      const s = bp.slots[i], b = blocks[i];
      if (b.cell) gridDel(b);
      b.st = 3; b.slot = i; b.x = s.x; b.y = s.y + HB; b.z = s.z;
      b.rx = b.ry = b.rz = 0; b.scale = 1; b.al = 1; b.holder = -1;
      b.vx = b.vy = b.vz = b.ax = b.ay = b.az = 0;
      s.filled = true; s.claimed = -1;
    }
    placedCnt = half; phase = 'build';
    for (const w of workers) { w.load.length = 0; w.li = 0; w.carry = false; w.st = 'idle'; }
    for (let i = 0; i < 40; i++) step(0.05);           // 讓小人回到工作節奏
    // 從中段高度放一把火
    const cand = blocks.filter(b => b.st === 3 && b.y > 3);
    cand.sort((a, b) => b.y - a.y);
    igniteBlock(cand[Math.floor(cand.length * 0.3)]);
    const at = placedCnt;
    let peak = 0, called = 0, arrive = -1, fireOut = -1, low = placedCnt;
    let minR = Infinity, sprayed = 0, wetMax = 0, gone = -1, t = 0;
    while (t < 60) {
      step(0.05); t += 0.05;
      peak = Math.max(peak, nSpread);
      low = Math.min(low, placedCnt);
      wetMax = Math.max(wetMax, blocks.filter(b => b.wet > 0).length);
      if (trucks) {
        called = Math.max(called, trucks.list.length);
        for (const m of trucks.list) {
          minR = Math.min(minR, Math.hypot(m.x, m.z));
          if (m.jet) { sprayed++; if (arrive < 0) arrive = +t.toFixed(1); }
        }
      } else if (called && gone < 0) gone = +t.toFixed(1);
      if (!nSpread && fireOut < 0 && t > 1) fireOut = +t.toFixed(1);
    }
    const end = placedCnt;
    cleanTools();
    return { at, peak, called, arrive, fireOut, low, end, sprayed, wetMax, gone, quit: FT_QUIT,
             minR: +minR.toFixed(1), site: +siteClearR().toFixed(1),
             ring: +ftRing().toFixed(1), range: +ftRange().toFixed(1) };
  });
  /* 噴幾幀不設高門檻：淋濕一片就把蔓延的鏈子切斷了，火自己燒完，
     所以「噴多久」是看火多快死，量到 20～29 幀（1～1.5 秒）都算正常。
     這一條要驗的是「有噴，而且沒進工地」，滅得掉不掉由下面那條驗。 */
  ok('車一步都不進工地，停在外圈往裡面噴',
     ftRun.minR > ftRun.site && ftRun.sprayed > 5,
     '最靠近場中心 ' + ftRun.minR + '（工地 ' + ftRun.site + '、外圈 ' + ftRun.ring +
     '、射程 ' + ftRun.range + '），噴了 ' + ftRun.sprayed + ' 幀');
  ok('水柱掃過的一片都會濕',
     ftRun.wetMax > 40,
     '同時最多 ' + ftRun.wetMax + ' 塊是濕的');
  ok('建造中被放一把火：火會被撲掉，工程繼續往前',
     ftRun.called >= 1 && ftRun.arrive > 0 && ftRun.arrive < 25 &&
     ftRun.fireOut > 0 && ftRun.fireOut < 40 &&
     ftRun.low > ftRun.at - 250 && ftRun.end > ftRun.at,
     // 門檻 −250：v1.67（沒有消防車）同樣的放法是從 1561 掉到 741，差 −820
     '放火時 ' + ftRun.at + ' 塊 → 最多 ' + ftRun.peak + ' 塊在燒、車 ' + ftRun.arrive +
     ' 秒後開始噴、' + ftRun.fireOut + ' 秒火全滅；進度最低 ' + ftRun.low +
     '、六十秒後 ' + ftRun.end + ' 塊');
  ok('火滅乾淨之後車自己離場',
     ftRun.gone > ftRun.fireOut && ftRun.gone < 60,
     '火滅在 ' + ftRun.fireOut + ' 秒、車在 ' + ftRun.gone + ' 秒離場（等 ' +
     ftRun.quit + ' 秒沒復燃才走）');

  /* 小人也會被噴到（使用者指定）：濕 5 秒、期間點不著，身上顏色一樣壓深。 */
  const wetWk = await page.evaluate(() => {
    cleanTools(); startBuild(true); completeNow();
    const w = workers[0];
    w.wet = 0; w.wetK = 0; w.burn = 0;
    const dryK = w.wetK;
    wetWorker(w);
    const litWet = igniteWorker(w, false);
    for (let i = 0; i < 20; i++) step(0.05);
    const k = +w.wetK.toFixed(3);
    // 身上有火的被澆到要當場熄
    w.wet = 0; w.wetK = 0;
    igniteWorker(w, true);
    const burning = w.burn > 0;
    wetWorker(w);
    const outNow = w.burn === 0 && w.roll === 0;
    for (let i = 0; i < 140; i++) step(0.05);          // 7 秒：乾了，wetK 歸零
    const dried = w.wetK;
    cleanTools();
    return { dryK, litWet, k, burning, outNow, dried, want: WET_DARK };
  });
  ok('淋濕的小人不會被點燃，身上顏色也壓深',
     wetWk.litWet === false && Math.abs(wetWk.k - wetWk.want) < 0.03 && wetWk.dried === 0,
     '濕的時候 igniteWorker ' + wetWk.litWet + '、身上顏色 ×' + wetWk.k +
     '，乾了之後 wetK 回到 ' + wetWk.dried);
  ok('身上著火的小人被水柱打到會當場熄',
     wetWk.burning && wetWk.outNow, '澆水前在燒 ' + wetWk.burning + ' → 澆水後熄掉 ' +
     wetWk.outNow);

  /* 整台車的部位塞在同一顆 InstancedMesh 裡：一台跟兩台一樣貴。
     它會投影，所以在場的時候是 **2 個** draw call（主畫面 + 陰影那一趟），
     跟隕石同一個道理；沒車的時候 visible=false，一個都不吃。 */
  const ftCalls = await page.evaluate(() => {
    cleanTools(); startBuild(true); completeNow();
    draw(); ENG.render();
    const idle = ENG.info().calls;
    callTrucks();
    const one = trucks.list.length;
    draw(); ENG.render();
    const withCar = ENG.info().calls;
    trucks = null;
    draw(); ENG.render();
    return { idle, one, withCar, after: ENG.info().calls };
  });
  ok('消防車在場多吃 2 個 draw call（含陰影），沒車的時候一個都不吃',
     ftCalls.withCar === ftCalls.idle + 2 && ftCalls.after === ftCalls.idle,
     '沒車 ' + ftCalls.idle + ' 個 → ' + ftCalls.one + ' 台 ' + ftCalls.withCar +
     ' 個 → 收掉 ' + ftCalls.after + ' 個');

  /* ══════════ 水桶 ══════════
     v1.81 起水是**一格一格的方塊**（每格記 0～1 的水量），一拍做三件事：
     往下掉 → 往旁邊攤 → 貼著地面／積木的那一格慢慢滲。
     這一節驗的就是「看得出體積」、「會往下流」、「最後滲進地面」這三件事，
     外加「一下要裝半個馬克杯」這個量的基準。 */
  await head('水桶');

  // 讀水的狀態：幾格水、總水量、最高／最低、每一層有幾格
  const wat = () => page.evaluate(() => {
    if (!water) return { on: false, cells: 0, vol: 0, top: -1, low: -1, pours: 0 };
    let vol = 0, top = -1, low = 1e9;
    for (const c of water.cells.values()) { vol += c.v; top = Math.max(top, c.gy + c.v); low = Math.min(low, c.gy); }
    return { on: true, cells: water.cells.size, vol: +vol.toFixed(1),
             top: +top.toFixed(2), low: low === 1e9 ? -1 : low, pours: water.pours.length };
  });
  // 蓋一座馬克杯、倒 n 下、等它靜下來
  const mug = (pours, wait) => page.evaluate(({ pours, wait }) => {
    cleanTools();
    targetCnt = 3000;
    shapePick = SHAPES.findIndex(s => s.n === '經典馬克杯');
    startBuild(true); completeNow();
    let rim = 0;
    for (const s of bp.slots) if (s.filled) rim = Math.max(rim, s.gy);
    const mx = cellX(0), mz = cellZ(0);
    let floor = 0;
    while (solidAt(mx, floor, mz)) floor++;                // 杯內地板在第幾層
    for (let k = 0; k < pours; k++) pourBucket(0, rim + 2, 0, WB_DROPS);
    for (let i = 0; i < wait * 60; i++) step(1 / 60);
    return { rim, floor, mx, mz };
  }, { pours, wait });

  /* 基準：使用者放進 blueprints/ 的馬克杯，**點一下要裝到半杯**（v1.71 訂的量）。
     量的是水面高度佔杯內高度的比例——「半杯」是用眼睛看的那個半杯，不是水量。 */
  const wbMug = await page.evaluate(() => {
    cleanTools();
    targetCnt = 3000;
    shapePick = SHAPES.findIndex(s => s.n === '經典馬克杯');
    startBuild(true); completeNow();
    let rim = 0;
    for (const s of bp.slots) if (s.filled) rim = Math.max(rim, s.gy);
    const mx = cellX(0), mz = cellZ(0);
    let floor = 0;
    while (solidAt(mx, floor, mz)) floor++;
    pourBucket(0, rim + 2, 0, WB_DROPS);                   // 點一下，往杯口正中央倒
    /* 「不是瞬間滿」量的是**杯子裡的水**到八成花幾秒——不能量水面高度：
       倒下去的水還在半空中往下掉，水面會先量到那些懸空的水（第 25 層）。 */
    let t = 0, t80 = -1;
    while (t < 25) {
      step(1 / 60); t += 1 / 60;
      let inCup = 0;
      for (const c of (water ? water.cells.values() : [])) if (c.gy <= rim) inCup += c.v;
      if (t80 < 0 && inCup > WB_CLICK * 0.8) t80 = t;
    }
    // 每一層有多少水：滿的層 ＋ 一層半滿的 ＝ 水面是平的
    const byY = new Map();
    let vol = 0;
    for (const c of water.cells.values()) {
      byY.set(c.gy, (byY.get(c.gy) || 0) + c.v);
      vol += c.v;
    }
    const wide = [...byY.entries()].filter(([, v]) => v > 1).length;
    const full = [...byY.entries()].filter(([y, v]) => v > 180).length;   // 幾層是「整層都是水」
    const surf = waterTop(mx, mz);
    const r = { rim, floor, cells: water.cells.size, vol: Math.round(vol),
                surf: +surf.toFixed(2), layers: wide, full,
                frac: +((surf - floor) / (rim + 1 - floor)).toFixed(2),
                t80: +t80.toFixed(1), want: WB_CLICK };
    cleanTools();
    return r;
  });
  ok('點一下把馬克杯裝到半杯（這是水量的基準）',
     wbMug.frac > 0.4 && wbMug.frac < 0.62 && wbMug.vol > WB_CLICK_MIN,
     '杯內第 ' + wbMug.floor + '～' + wbMug.rim + ' 層，一下倒完水面停在 ' + wbMug.surf +
     '（佔杯高 ' + Math.round(wbMug.frac * 100) + '%），' + wbMug.cells + ' 格水、共 ' +
     wbMug.vol + ' 格（倒了 ' + wbMug.want + ' 格，其餘滲掉）');
  /* 水是一格一格的，所以「有多少水」看得出體積：**下面那幾層是整層滿的、最上面一層半滿**
     ——水面是平的。使用者回報過「看不出水的體積」（那時候一團水只有一個水位，
     畫出來永遠是一片平面）。 */
  ok('水看得出體積：底下幾層整層都是水，最上面一層半滿，水面是平的',
     wbMug.full >= 8 && wbMug.layers >= wbMug.full + 1 && wbMug.layers <= wbMug.full + 3,
     wbMug.layers + ' 層有水，其中 ' + wbMug.full + ' 層是整層滿的（193 格）；' +
     '水面 ' + wbMug.surf + '，半滿的那一層就是水面那一層');
  // 水位不能瞬間到位：一下 2300 格分 WB_POUR 秒倒完，水還要一格一格往下掉
  ok('水面是一路淹上來的，不是瞬間滿',
     wbMug.t80 > 1.2,
     '杯子裡的水到八成（' + Math.round(wbMug.want * 0.8) + ' 格）花了 ' + wbMug.t80 + ' 秒');

  /* 破口：杯壁半腰敲一個窗，水一格一格從破口流出去，水面降到破口下緣就停。
     這一條就是「水會往下流」——不是靠算流量，是每一格自己往下掉、往旁邊攤。 */
  const wbHole = await page.evaluate(() => {
    cleanTools();
    targetCnt = 3000;
    shapePick = SHAPES.findIndex(s => s.n === '經典馬克杯');
    startBuild(true); completeNow();
    let rim = 0;
    for (const s of bp.slots) if (s.filled) rim = Math.max(rim, s.gy);
    const mx = cellX(0), mz = cellZ(0);
    let floor = 0;
    while (solidAt(mx, floor, mz)) floor++;
    pourBucket(0, rim + 2, 0, WB_DROPS);
    for (let i = 0; i < 60 * 22; i++) step(1 / 60);
    const before = { surf: +waterTop(mx, mz).toFixed(1),
                     vol: Math.round([...water.cells.values()].reduce((a, c) => a + c.v, 0)) };
    // 半腰敲一個 5 寬 × 4 高的窗（杯壁那個角度是兩格厚，要整個厚度打穿）
    const hy = Math.round((before.surf + floor) / 2);
    buildSlotOwner();
    let broke = 0;
    for (let gx = mx - 2; gx <= mx + 2; gx++)
      for (let yy = hy; yy < hy + 4; yy++)
        for (let gz = mz; gz < mz + 40; gz++) {
          const bl = blockOn(gx, yy, gz);
          if (bl) { breakBlock(bl, 0, 1, 3); broke++; }
        }
    /* 追著看：杯子裡的水一路少、水面一路降。
       「流出去多少」要用**杯子裡少了多少**來量——流出去的水一落地就開始滲，
       量「外面站著多少水」會被滲掉的速度蓋過去。 */
    let t = 0, spray = 0;
    const cup = () => {
      let v = 0;
      for (const c of (water ? water.cells.values() : [])) if (c.gy >= floor) v += c.v;
      return v;
    };
    const curve = [];
    while (t < 45 && water) {
      step(1 / 60); t += 1 / 60;
      let blue = 0;
      for (const d of dust) if (d.cr === 0.42 && d.cb === 1) blue++;
      spray = Math.max(spray, blue);
      if (Math.round(t * 60) % 120 === 0)
        curve.push([+t.toFixed(0), +waterTop(mx, mz).toFixed(1), Math.round(cup())]);
    }
    const r = { floor, hy, broke, before, spray, left: Math.round(cup()),
                after: +waterTop(mx, mz).toFixed(1), curve: curve.slice(0, 10) };
    cleanTools();
    return r;
  });
  ok('杯壁敲一個窗，水一格一格從破口流出去',
     wbHole.broke >= 10 && wbHole.left < wbHole.before.vol * 0.55 && wbHole.spray > 8,
     '破口在第 ' + wbHole.hy + '～' + (wbHole.hy + 3) + ' 層：杯子裡的水 ' +
     wbHole.before.vol + ' → ' + wbHole.left + ' 格，同時最多 ' + wbHole.spray + ' 顆水花');
  /* 水面要停在破口**下緣**：再低的水流不到破口，所以不會整杯漏光。
     這件事在一格一格的模型裡不用另外寫規則——破口下緣以下的水就是往旁邊攤不出去。 */
  ok('水面降到破口下緣就停，不會整杯漏光',
     wbHole.after < wbHole.before.surf - 2 &&
     wbHole.after >= wbHole.hy - 0.6 && wbHole.after <= wbHole.hy + 1.5,
     '杯內水面 ' + wbHole.before.surf + ' → ' + wbHole.after +
     ' 層（破口下緣 ' + wbHole.hy + '）');

  /* 杯子瞬間消失：那一柱水要**塌下來**，不是站在原地慢慢往下坐（v1.155）。
     使用者：「把水裝在杯子中、杯子瞬間消失，一顆水柱的情況下流下的速度很慢，
     現實中會類似自由落體快速流下」。

     成因不在「落下速度」那個常數（一拍掉一格 ＝ 30 格/秒，本來就比自由落體快）：
     貼著草地的那一格每一拍滲掉 0.02 格（SEEP_G 0.6 ÷ 30 拍），剛好開出一個比
     WT_LEVEL 大一絲的洞，於是整柱水每一拍往下滴 0.02 格、每一格都把自己記成
     「在半空中」——而②往旁邊攤那段只有站住的水才攤，所以誰都不攤，水柱只能跟著
     滲水的速度往下坐。實測改版前：水面 5.8 秒只降 3.6 格（0.6 格/秒，剛好是滲水
     的速度）、重心 6 秒不動、2181 格水裡有 1863 格自認在半空中。
     杯子裡的水沒這毛病：坐在積木上，SEEP_B 一拍只滲 0.0007 格，開不出那個洞。 */
  const wbFall = await page.evaluate(() => {
    cleanTools();
    targetCnt = 3000;
    shapePick = SHAPES.findIndex(s => s.n === '經典馬克杯');
    startBuild(true); completeNow();
    let rim = 0;
    for (const s of bp.slots) if (s.filled) rim = Math.max(rim, s.gy);
    const mx = cellX(0), mz = cellZ(0);
    pourBucket(0, rim + 2, 0, WB_DROPS);
    for (let i = 0; i < 60 * 22; i++) step(1 / 60);          // 裝水、等它靜下來
    /* 「這一塊水的頂」取**有 50 格以上水的最高那一層**：只看最高的那一格會被
       噴出去的零星水花帶著跑（那幾格飛在半空，跟水柱塌不塌無關）。 */
    const prof = () => {
      const byY = new Map();
      let vol = 0, cy = 0;
      for (const c of water.cells.values()) {
        byY.set(c.gy, (byY.get(c.gy) || 0) + c.v);
        vol += c.v; cy += c.v * (c.gy + c.v / 2);
      }
      let bulk = -1;
      for (const [y, v] of byY) if (v > 50 && y > bulk) bulk = y;
      return { bulk, com: +(cy / vol).toFixed(2), vol: Math.round(vol) };
    };
    // 中央那一柱：滿的格子裡，有幾格的腳下不算撐到地面（＝塌不下來的那種格子）
    const midAir = () => {
      let full = 0, air = 0;
      for (let gy = 0; gy < 40; gy++) {
        const c = water.cells.get(wkey(mx, gy, mz));
        if (!c || c.v <= 0.9) continue;
        full++; if (!c.grd) air++;
      }
      return { full, air };
    };
    const a = prof();
    // 杯子瞬間消失：已就位的積木全部原地解成碎料（bp.slots 的 filled 跟著變 false）
    let gone = 0;
    for (const b of blocks) if (b.slot >= 0) { freeBlock(b); gone++; }
    const at = {};
    let t = 0, half = -1;
    while (t < 3 && water) {
      step(1 / 60); t += 1 / 60;
      const p = prof();
      if (half < 0 && p.com <= a.com / 2) half = t;
      const k = Math.round(t * 60);
      /* 「每一格都撐得住」在**杯子剛沒的時候**量（0.3 秒）：那正是改版前卡住的狀態
         （整柱水都記著「我在半空中」、誰都不往旁邊攤）。等到塌到一半再量就沒意義了
         ——那時候柱子中段真的在往下掉，本來就不該算站著（實測 1 秒時 10 格裡有 3 格）。 */
      if (k === 18) at.air03 = midAir();
      if (k === 60) at.s10 = p;
      if (k === 180) at.s30 = p;
    }
    const r = { rim, gone, a, at, half: +half.toFixed(2),
                ff: +Math.sqrt(2 * (a.com / 2) / GRAV).toFixed(2),
                seep: +(a.com / 2 / SEEP_G).toFixed(1) };
    cleanTools();
    return r;
  });
  /* 「跟著滲水往下坐」與「塌下來」差了一個量級，所以量重心掉一半要幾秒，
     兩邊各給一個對照：自由落體 0.5 秒上下、跟著滲水要 4.7 秒。
     門檻的位置：改版前實測 1 秒後水面還在第 10 層、3 秒後第 9 層、重心 6 秒不動
     （壓根沒掉到一半），改版後是第 7 層／第 4 層／1.5 秒。 */
  ok('杯子瞬間消失，那一柱水會塌下來（不是跟著滲水慢慢往下坐）',
     wbFall.at.s10.bulk <= wbFall.a.bulk - 4 && wbFall.at.s30.bulk <= wbFall.a.bulk - 7 &&
     wbFall.half > 0 && wbFall.half < 2.5,
     '水面第 ' + wbFall.a.bulk + ' 層 → 1 秒後第 ' + wbFall.at.s10.bulk +
     ' → 3 秒後第 ' + wbFall.at.s30.bulk + ' 層；重心 ' + wbFall.a.com + ' → 掉一半花 ' +
     wbFall.half + ' 秒（自由落體 ' + wbFall.ff + ' 秒、跟著滲水要 ' + wbFall.seep +
     ' 秒；改版前 3 秒只降 4 層、重心 6 秒不動）');
  /* 成因那一層自己守一條：整柱水的腳下都算撐到地面，才輪得到②往旁邊攤。 */
  ok('站在草地上的那一柱水，每一格都知道腳下撐得住',
     wbFall.at.air03.full >= 8 && wbFall.at.air03.air === 0,
     '杯子沒了 0.3 秒後，中央那一柱有 ' + wbFall.at.air03.full + ' 格是滿的，其中 ' +
     wbFall.at.air03.air + ' 格自認在半空中（改版前是 11 格裡 10 格）');

  // 一下的水從屋頂一路流到地面，沿路把積木淋濕，但一塊都不會掉
  const wbFlow = await page.evaluate(() => {
    cleanTools();
    targetCnt = 3000;
    shapePick = SHAPES.findIndex(s => s.n === '巴黎聖母院');
    startBuild(true); completeNow();
    let top = null;
    for (const s of bp.slots) if (s.filled && (!top || s.gy > top.gy)) top = s;
    const set0 = placedCnt;
    pourWater({ point: { x: top.x, y: top.y + HB, z: top.z }, kind: 'block' });
    let t = 0, maxWet = 0, maxDust = 0, maxCells = 0, ground = 0, groundC = 0;
    while (t < 20) {
      step(1 / 60); t += 1 / 60;
      if (!water) break;
      maxCells = Math.max(maxCells, water.cells.size);
      maxDust = Math.max(maxDust, dust.length);
      maxWet = Math.max(maxWet, blocks.reduce((a, b) => a + (b.wet > 0 ? 1 : 0), 0));
      let g = 0, gc = 0;
      for (const c of water.cells.values()) if (c.gy === 0) { g += c.v; gc++; }
      ground = Math.max(ground, g);
      groundC = Math.max(groundC, gc);
    }
    const r = { topY: +top.y.toFixed(1), set0, set1: placedCnt, t: +t.toFixed(1),
                maxCells, maxWet, maxDust, ground: Math.round(ground), groundC,
                cap: ENG.MAXDUST };
    cleanTools();
    return r;
  });
  /* 「鋪成一片」量的是**地面那一層同時鋪到幾格**，不是站著多少水量：
     地面滲得快（每格每秒 0.6），水一到就開始滲，量水量會被滲的速度蓋過去。 */
  ok('一下的水從屋頂一路流到地面，最後在地上鋪成一片',
     wbFlow.groundC > 60 && wbFlow.maxCells > 500,
     '從 ' + wbFlow.topY + ' 高倒下去，同時最多 ' + wbFlow.maxCells +
     ' 格水；地面那一層最多同時鋪到 ' + wbFlow.groundC + ' 格（' + wbFlow.ground + ' 格的水）');
  ok('流過的地方會濕，但一塊積木都不會掉',
     wbFlow.maxWet > 30 && wbFlow.set1 === wbFlow.set0,
     '同時最多 ' + wbFlow.maxWet + ' 塊是濕的；建築 ' + wbFlow.set0 + ' → ' + wbFlow.set1 + ' 塊');
  ok('水花沒把塵霧粒子池吃光', wbFlow.maxDust < 700,
     '同時最多 ' + wbFlow.maxDust + ' 顆粒子（引擎上限 ' + wbFlow.cap + '，煙塵要共用）');

  /* 倒在草地上：攤成一大片，然後很快滲進地底（使用者指定「很快速滲入地下」）。
     泡在裡面的積木要一直是濕的——水還在、積木卻乾了又能點著，說不過去。 */
  const wbPool = await page.evaluate(() => {
    /* 這條不蓋建築（startBuild 之後直接當它完工）：要的是一塊躺在地上的碎料，
       蓋好的那幾座剛好把積木用光時一塊碎料都不剩，測試會抓不到東西丟進水裡。 */
    cleanTools(); startBuild(true); phase = 'done';
    for (const w of workers) releaseWorker(w);
    pourWater({ point: { x: siteR + 6, y: 0, z: 0 }, kind: 'ground' });
    let t = 0, wide = 0, cells = 0;
    while (t < 3 && water) {                       // 先攤開（還在最大的時候量寬度）
      step(1 / 60); t += 1 / 60;
      const xs = [...water.cells.values()].map(c => c.gx);
      if (xs.length) wide = Math.max(wide, Math.max.apply(null, xs) - Math.min.apply(null, xs) + 1);
      cells = Math.max(cells, water.cells.size);
    }
    const spread = { cells, wide };
    /* 丟一塊碎料進水裡，看它會不會一直濕著、點不著。
       這一段要趁**水還在**的時候做：地面滲得快（每格每秒 0.6），
       等水攤完再丟就常常已經滲光了（改版前這裡量到 0 秒就沒水）。 */
    const k = blocks.find(x => x.st === 0);
    if (k.cell) gridDel(k);                       // 搬位置前先從空間雜湊拿掉（跟 fillAll 同一招）
    const any = [...water.cells.values()].sort((a, b) => b.v - a.v)[0];
    k.x = wldX(any.gx); k.z = wldZ(any.gz); k.y = HB; k.wet = 0;
    for (let i = 0; i < 20; i++) step(1 / 60);
    const soaked = k.wet > 0, lit = igniteBlock(k);
    while (water && t < 60) { step(1 / 60); t += 1 / 60; }
    const r = { spread, soaked, lit, dry: +t.toFixed(1), gone: !water, want: WB_CLICK };
    cleanTools();
    return r;
  });
  ok('倒在草地上鋪成一大片，然後很快滲進地底',
     wbPool.spread.cells > 300 && wbPool.spread.wide > 18 && wbPool.gone &&
     wbPool.dry > 1 && wbPool.dry < 30,
     '點一下（' + wbPool.want + ' 格的水）鋪開 ' + wbPool.spread.cells + ' 格、' +
     wbPool.spread.wide + ' 格寬，倒下去 ' + wbPool.dry + ' 秒後滲光');
  ok('泡在水裡的積木一直是濕的，點不著',
     wbPool.soaked === true && wbPool.lit === false,
     '泡進去 0.5 秒後 wet>0 ' + wbPool.soaked + '、igniteBlock ' + wbPool.lit);

  /* 澆在燒著的建築上要滅火。這是水桶跟消防車共用的那條路（wetBlock → douse）。 */
  const wbDouse = await page.evaluate(() => {
    cleanTools(); startBuild(true); completeNow();
    let top = null;
    for (const s of bp.slots) if (s.filled && (!top || s.gy > top.gy)) top = s;
    const b = blocks.find(x => x.st === 3 && x.slot === bp.slots.indexOf(top));
    igniteBlock(b || blocks.find(x => x.st === 3));
    const lit0 = fires ? fires.length : 0;
    pourWater({ point: { x: top.x, y: top.y + HB, z: top.z }, kind: 'block' });
    let t = 0, out = -1;
    while (t < 12) {
      step(1 / 60); t += 1 / 60;
      if (out < 0 && (!fires || !fires.length)) out = t;
    }
    const wet = blocks.filter(x => x.wet > 0).length;
    const r = { lit0, out: out < 0 ? -1 : +out.toFixed(2), wet };
    cleanTools();
    return r;
  });
  ok('把水倒在燒著的建築上，火會被澆熄',
     wbDouse.lit0 > 0 && wbDouse.out >= 0 && wbDouse.out < 6 && wbDouse.wet > 3,
     '起火 ' + wbDouse.lit0 + ' 處 → ' + wbDouse.out + ' 秒後全滅，' + wbDouse.wet + ' 塊還濕著');

  /* 站在水裡的小人：一直是濕的，身上的火會熄。 */
  const wbMan = await page.evaluate(() => {
    cleanTools(); startBuild(true); phase = 'done';
    const w = workers[0];
    releaseWorker(w);
    w.x = siteR + 10; w.z = 0; w.y = 0; w.fall = 0; w.wet = 0;
    igniteWorker(w, true);
    const lit0 = w.burn > 0;
    pourBucket(w.x, 3, w.z, WB_DROPS);
    let t = 0;
    while (t < 4) { step(1 / 60); t += 1 / 60; }
    const r = { lit0, fire: w.burn > 0, wet: +w.wet.toFixed(1), k: +(w.wetK || 0).toFixed(2) };
    cleanTools();
    return r;
  });
  ok('站在水裡的小人一直是濕的，身上的火會熄',
     wbMan.lit0 === true && wbMan.fire === false && wbMan.wet > 1,
     '點著的人站進水裡：火熄了 ' + !wbMan.fire + '、還濕 ' + wbMan.wet + ' 秒、顏色倍率 ' + wbMan.k);

  /* 畫面成本：水在場只多 1 個 draw call（一整片網格），收掉就還回去。 */
  const wbCalls = await page.evaluate(() => {
    cleanTools(); startBuild(true); completeNow();
    // 量之前先把塵霧清掉：水花走的是塵霧那顆網格，留著會蓋掉「有沒有水」這一項
    const shot = () => { dust.length = 0; draw(); ENG.render(); return ENG.info().calls; };
    const before = shot();
    pourBucket(0, bp.height + 2, 0, WB_DROPS);
    for (let i = 0; i < 60 * 8; i++) step(1 / 60);
    const cells = water ? water.cells.size : 0;
    const on = shot();
    water = null;
    const off = shot();
    cleanTools();
    return { before, on, off, cells };
  });
  ok('水在場只多 1 個 draw call，收掉就還回去',
     wbCalls.on === wbCalls.before + 1 && wbCalls.off === wbCalls.before,
     wbCalls.cells + ' 格水：' + wbCalls.before + ' → ' + wbCalls.on + ' → 收掉 ' + wbCalls.off +
     '（水花走現成的塵霧池，0 個新的）');

  /* ══════════ 水面的樣子（v1.94）══════════
     v1.69～v1.93 的水是 MeshBasicMaterial——不吃光，任何角度都是同一片均勻的藍
     （使用者：「藍色果凍／玻璃罩」）。現在是會吃光的 Phong ＋ fragment 端的波紋法線
     ＋ 外緣的泡沫。這一段守的是「加了這些不能反過來變貴」與「東西真的有生效」。 */
  const wbSurf = await page.evaluate(() => {
    /* 先讓水真的在場、真的畫過一次：材質的 onBeforeCompile 是 three 第一次編譯那顆
       program 才跑的，水沒出場過的話 userData.cuts 還是 undefined（讀到 undefined
       這幾條會 FAIL，方向是安全的，但不該靠前面某條測試的副作用）。 */
    cleanTools(); startBuild(true); completeNow();
    pourBucket(0, bp.height + 2, 0, WB_DROPS);
    for (let i = 0; i < 60; i++) step(1 / 60);
    draw(); ENG.render();
    const m = ENG.three.poolMesh.material, g = ENG.three.poolMesh.geometry;
    return { type: m.type, flat: m.flatShading, lit: !!m.specular, shin: m.shininess,
             op: m.opacity, single: m.forceSinglePass, cuts: m.userData.cuts,
             attrs: Object.keys(g.attributes).sort().join(','),
             floats: Object.values(g.attributes).reduce((s, a) => s + a.itemSize, 0),
             cells: water ? water.cells.size : 0 };
  });
  /* **有光，但一個頂點還是只傳 4 個 float**（座標 3 ＋ 泡沫 1）。
     水的頂點每幀全部重寫，多一條 normal 就是每頂點多 3 個 float 的上傳（+75%）——
     所以法線走 flatShading：three 在 `normal_fragment_begin` 用
     cross(dFdx(vViewPosition), dFdy(vViewPosition)) 算，**用不到 normal attribute**。
     這顆網格全是軸對齊的平面，微分算出來的就是那個面真正的法線。
     哪天有人「順手」補一句 computeVertexNormals()，這一條會擋下來。 */
  ok('水面吃光了，而且沒有為此多傳法線（一個頂點還是 4 個 float）',
     wbSurf.type === 'MeshPhongMaterial' && wbSurf.flat === true && wbSurf.lit &&
     wbSurf.single === true && wbSurf.attrs === 'aFoam,position' && wbSurf.floats === 4,
     wbSurf.type + '（flatShading ' + wbSurf.flat + '、高光 ' + wbSurf.shin +
     '、不透明度 ' + wbSurf.op + '）、attribute：' + wbSurf.attrs +
     ' 共 ' + wbSurf.floats + ' 個 float／頂點');
  /* shader 是靠「對 three 的 chunk 名字做字串取代」注進去的，**取代不到不會報錯**：
     three 升版把 chunk 改個名字（`output_fragment` → `opaque_fragment` 真的發生過），
     那一刀就默默沒生效。下面那條像素哨兵擋不住單一注入點失效——實測只讓波紋那一刀
     失效（振幅歸零），變的像素只從 8% 掉到 5%，門檻抓不到。所以直接數刀數。 */
  ok('水面 shader 的六個注入點都真的換到了（chunk 改名時這裡會靜默失效）',
     wbSurf.cuts === 6 && wbSurf.cells > 0,
     wbSurf.cuts + ' / 6 刀（' + wbSurf.cells + ' 格水在場、畫過一次）');

  /* 泡沫長在哪：規則那邊的 rim ＝「旁邊那格**根本沒有水**」（水體到這裡結束，或旁邊是積木）。
     這裡曾經拿「有側面」（f & 15）當外緣——側面只要旁邊比自己低就會標出來，
     一片正在攤開的水每格深淺都差一點，於是三分之二的水面都被刷白，畫出來是一片白磁磚。
     所以這一條同時量兩個數字：新訊號要是少數，舊訊號要是多數。 */
  const wbFoam = await page.evaluate(() => {
    cleanTools();
    /* 藍圖要固定（水窪的形狀才每次一樣），**而且用完要還回去**：
       後面的測試是 startBuild(true) 直接沿用當下的 shapePick，
       留著不還的話等於偷偷替它們換了一座建築（踩過：「連倒二十下」那條的水
       被五重塔的屋簷接住，200 秒排不掉）。 */
    const keep = shapePick;
    targetCnt = 3000; shapePick = SHAPES.findIndex(s => s.n === '京都五重塔');
    startBuild(true); completeNow();
    pourBucket(26, 5, 2, WB_DROPS);                // 倒在建築外的草地上，攤成一片水窪
    for (let i = 0; i < 60 * 3; i++) step(1 / 60);
    const L = poolList();
    let rim = 0, side = 0, want = 0, ground = 0;
    for (const p of L) {
      if (!(p.f & 32)) continue;                   // 只有畫得出水面的那些格算得上「刷不刷白」
      if (p.rim) { rim++; want++; }
      if (p.f & 15) side++;
      if (p.y0 === 0) ground++;
    }
    const top = L.filter(p => p.f & 32).length;
    draw();
    const g = ENG.three.poolMesh.geometry, a = g.attributes.aFoam.array;
    let hot = 0;
    for (let i = 0; i < g.drawRange.count; i++) if (a[i] > 0) hot++;
    shapePick = keep;
    return { cells: L.length, top, rim, side, want, hot, ground };
  });
  ok('這一片水窪真的攤在地面上（下面幾條的前提）',
     wbFoam.cells > 800 && wbFoam.ground > wbFoam.top * 0.7,
     wbFoam.cells + ' 格水、其中 ' + wbFoam.top + ' 格畫得出水面，' +
     wbFoam.ground + ' 格貼著地面');
  ok('泡沫只長在水體外緣，不是三分之二的水面都刷白',
     wbFoam.rim / wbFoam.top < 0.35 && wbFoam.side / wbFoam.top > 0.55 &&
     wbFoam.side > wbFoam.rim * 2,
     '畫得出水面的 ' + wbFoam.top + ' 格裡，外緣 ' + wbFoam.rim + ' 格（' +
     Math.round(wbFoam.rim / wbFoam.top * 100) + '%）；換成舊的「有側面」會中 ' +
     wbFoam.side + ' 格（' + Math.round(wbFoam.side / wbFoam.top * 100) + '%）');
  ok('引擎只把泡沫寫在外緣那些格的水面上（每面 6 個頂點）',
     wbFoam.hot === wbFoam.want * 6 && wbFoam.want > 0,
     wbFoam.want + ' 個水面 × 6 ＝ ' + wbFoam.want * 6 + ' 個頂點，實際寫進 aFoam 的 ' +
     wbFoam.hot + ' 個');

  /* 波紋有沒有真的在動：**只把相位推 0.7 秒**（水一格都不動），再拍一張比像素。
     這一條是 shader 注入的哨兵——onBeforeCompile 那幾個 replace 是靜默的，
     哪天 three 換了 chunk 名字（`normal_fragment_begin` 之類）就會什麼都沒發生、
     也不會報錯，畫面默默退回死板的藍。相位是規則那邊用 dt 累的（water.wave），
     不是牆上時鐘：4× 速跟 1× 速是同一支波，測試也重現得出來。 */
  const wbWave = await page.evaluate(() => {
    cleanTools();
    const keep = shapePick;                        // 同上，用完還回去
    targetCnt = 3000; shapePick = SHAPES.findIndex(s => s.n === '京都五重塔');
    startBuild(true); completeNow();
    pourBucket(26, 5, 2, WB_DROPS);
    for (let i = 0; i < 60 * 3; i++) step(1 / 60);
    const wave0 = water.wave;
    const c = ENG.cam;                             // 貼著水面斜看：水面佔畫面最大的角度
    c.tx = 26; c.tz = 2; c.ty = 0.3; c.dist = 13; c.yaw = 0.9; c.pitch = 0.22;
    Object.assign(ENG.camTarget, { tx: c.tx, tz: c.tz, ty: c.ty, dist: c.dist });
    for (let i = 0; i < 6; i++) ENG.updateCamera(1);
    const shot = () => {
      dust.length = 0; draw(); ENG.render();
      const gl = ENG.three.renderer.getContext();
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return px;
    };
    /* 不能用顏色篩「像水的像素」當分母：天空也是淡藍的，一篩就把大半個畫面算進去，
       比例被稀釋成個位數（踩過）。改成**數絕對值 ＋ A／A 對照**：
       同一個狀態連拍兩張要一模一樣，推了相位才會變——變的就一定是波紋。 */
    const diff = (x, y) => {
      let n = 0;
      for (let i = 0; i < x.length; i += 4)
        if (Math.abs(x[i] - y[i]) + Math.abs(x[i + 1] - y[i + 1]) +
            Math.abs(x[i + 2] - y[i + 2]) > 6) n++;
      return n;
    };
    const a = shot();
    const a2 = shot();                             // 什麼都沒動
    water.wave += 0.7;                             // 只動相位，水本身一格都沒動
    const b = shot();
    shapePick = keep;
    return { wave0: +wave0.toFixed(2), px: a.length / 4,
             still: diff(a, a2), moved: diff(a, b) };
  });
  ok('水面會波光粼粼：只把波紋的相位推一下，水一格沒動，畫面就變了',
     wbWave.moved > 20000 && wbWave.still < wbWave.moved / 50 &&
     Math.abs(wbWave.wave0 - 3) < 0.1,
     '相位 ' + wbWave.wave0 + ' → +0.7 秒：' + wbWave.px + ' 個像素裡 ' +
     wbWave.moved + ' 個變了（' + Math.round(wbWave.moved / wbWave.px * 100) +
     '%）；什麼都不動連拍兩張只差 ' + wbWave.still +
     ' 個（相位是規則的 dt 累出來的，3 秒就是 3.00）');

  /* ══════════ 水面不再一跳一跳（v1.94.1）══════════
     使用者：「目前水面會有一跳一跳的情況，之前沒有」。查出來是兩件事疊在一起：
     ① 水一秒只算 30 拍（WT_TICK）而畫面跑 60 幀，所以**畫出來的水面兩幀才動一次**；
     ② 水面吃光之後，同一份幾何的變動看起來重了三倍（實測同一份水面狀態、同一個機位，
        連續 12 幀變動的像素：不吃光 1625、吃光 4805）——動的一直都在動，是看得出來了。
     所以 v1.93 其實也在跳，只是看不出來。 */
  const wbEase = await page.evaluate(() => {
    cleanTools();
    const keep = shapePick;
    targetCnt = 3000; shapePick = SHAPES.findIndex(s => s.n === '經典馬克杯');
    startBuild(true); completeNow();
    let rim = 0;
    for (const s of bp.slots) if (s.filled) rim = Math.max(rim, s.gy);
    pourBucket(0, rim + 2, 0, WB_DROPS);
    for (let i = 0; i < 60 * 4; i++) step(1 / 60);      // 還在往下沉、水面還在動
    /* 只推水（stepWater）不推別的：小人每幀都在走，混進來就看不出水的節奏了。
       量的是「畫出來的高度」c.hv 有幾格變了——這是規則交給引擎的那個數字。 */
    const snap = () => {
      const m = new Map();
      for (const c of water.cells.values()) m.set(c.gx + ':' + c.gy + ':' + c.gz, c.hv);
      return m;
    };
    let prev = snap();
    const seq = [];
    for (let k = 0; k < 16; k++) {
      stepWater(1 / 60);
      const cur = snap();
      let n = 0;
      for (const [key, v] of cur) {
        const o = prev.get(key);
        if (o !== undefined && Math.abs(o - v) > 1e-6) n++;
      }
      seq.push(n); prev = cur;
    }
    shapePick = keep;
    return { cells: water.cells.size, seq, min: Math.min(...seq),
             zeros: seq.filter(x => x === 0).length };
  });
  /* 這一條就是「一跳一跳」的哨兵：**每一幀都要有水面在動**。
     改版前非拍的那幾幀是原封不動的（實測 16 幀裡有 7～8 幀變動 0 個像素），
     現在畫出來的高度是用時間常數追實際水位的（WT_EASE），所以每一幀都在動。 */
  ok('畫出來的水面每一幀都在動，不是兩幀才動一次',
     wbEase.zeros === 0 && wbEase.min > 50,
     wbEase.cells + ' 格水，連續 16 幀各有 ' + wbEase.seq.slice(0, 6).join('／') +
     '… 格的高度在動（最少 ' + wbEase.min + ' 格、0 格的幀 ' + wbEase.zeros +
     ' 次）；水一秒只算 30 拍、畫面 60 幀，不追的話一半的幀會是 0');

  /* 水體內部的面：頭上有水的格子，它的水面與底面都在水裡面，畫出來只是多疊一層，
     而且水一流動就每一拍生生滅滅。原本的規則只看「自己滿不滿」（0.97 滿也算沒滿），
     所以一格 0.97 滿、頭上還壓著一整格水，照樣畫一片水面出來。
     同一個場景（滿到溢出杯口的馬克杯）改版前後實測，每 30 幀的翻面次數：
     頂面 395 → 23、底面 386 → 8、四道側面合計 913 → 586。 */
  const wbInner = await page.evaluate(() => {
    cleanTools();
    const keep = shapePick;
    targetCnt = 3000; shapePick = SHAPES.findIndex(s => s.n === '經典馬克杯');
    startBuild(true); completeNow();
    let rim = 0;
    for (const s of bp.slots) if (s.filled) rim = Math.max(rim, s.gy);
    for (let k = 0; k < 3; k++) pourBucket(0, rim + 2, 0, WB_DROPS);   // 倒到溢出杯口
    for (let i = 0; i < 60 * 8; i++) step(1 / 60);
    const snap = () => {
      const m = new Map();
      for (const c of water.cells.values())
        m.set(c.gx + ':' + c.gy + ':' + c.gz, c.f);
      return m;
    };
    let prev = snap();
    let topFlip = 0, botFlip = 0, sideFlip = 0, badTop = 0, sub = 0;
    for (let k = 0; k < 30; k++) {
      step(1 / 60);
      const cur = snap();
      for (const [key, f] of cur) {
        const o = prev.get(key);
        if (o === undefined) continue;
        if ((o & 32) !== (f & 32)) topFlip++;
        if ((o & 16) !== (f & 16)) botFlip++;
        for (const b of [1, 2, 4, 8]) if ((o & b) !== (f & b)) sideFlip++;
      }
      prev = cur;
    }
    // 收尾檢查：泡在水裡的格子一片水面都不該有
    for (const c of water.cells.values()) {
      if (!c.sub) continue;
      sub++;
      if (c.f & 32) badTop++;
    }
    const cells = water.cells.size;
    shapePick = keep;
    return { cells, sub, topFlip, botFlip, sideFlip, badTop };
  });
  ok('泡在水裡的格子不畫水面（那些面在水體內部）',
     wbInner.badTop === 0 && wbInner.sub > 3000,
     wbInner.cells + ' 格水裡有 ' + wbInner.sub + ' 格泡在水裡，其中 ' +
     wbInner.badTop + ' 格畫了水面');
  ok('水面與底面不再每一拍生生滅滅',
     wbInner.topFlip < 150 && wbInner.botFlip < 100 && wbInner.sideFlip < 700,
     '30 幀內翻面：頂面 ' + wbInner.topFlip + '（v1.94.0 是 395）、底面 ' +
     wbInner.botFlip + '（386）、四道側面合計 ' + wbInner.sideFlip + '（913）');

  /* 側面只畫「露出來的那一段」：旁邊也是水的話，低於它水面的那一段在它的水體裡面。
     原本一律從格底畫到格頂，於是 0.05 格的高低差會讓一整片全格高的面出現或消失。
     量的是「該畫的高度總和」佔「整格高度總和」幾成。 */
  const wbSlice = await page.evaluate(() => {
    cleanTools();
    const keep = shapePick;
    targetCnt = 3000; shapePick = SHAPES.findIndex(s => s.n === '京都五重塔');
    startBuild(true); completeNow();
    pourBucket(26, 5, 2, WB_DROPS);                  // 攤在草地上：格與格之間才有台階
    for (let i = 0; i < 60 * 3; i++) step(1 / 60);
    const L = poolList();
    let expo = 0, full = 0, n = 0;
    for (const p of L)
      for (let k = 0; k < 4; k++) {
        if (!(p.f & (1 << k))) continue;
        const tall = p.y1 - p.y0;
        expo += Math.max(0, tall - p.sb[k]); full += tall; n++;
      }
    shapePick = keep;
    return { faces: n, expo: +expo.toFixed(1), full: +full.toFixed(1) };
  });
  ok('側面只畫露出來的那一段，不是整格高',
     wbSlice.faces > 500 && wbSlice.expo < wbSlice.full * 0.8,
     wbSlice.faces + ' 道側面：該畫的高度合計 ' + wbSlice.expo + ' 格，整格畫的話是 ' +
     wbSlice.full + ' 格（' + Math.round(wbSlice.expo / wbSlice.full * 100) + '%）');

  /* 靜止的水面不能忽高忽低（v1.94.2）。使用者：「我說的一跳一跳，就是靜止水面會高一下
     高一下」。查出來是**畫出來的高度在 v 與 2v 之間翻**：半空中的水要畫成 WT_AIR 倍高
     （不然落下的水柱是一疊互不相連的薄片），而「是不是半空中」原本直接用 c.sup 判斷，
     sup 又要求腳下那一格 v ≥ 1 − WT_LEVEL（0.98）。杯子裡那層薄薄的水面坐在 0.97～1.00
     的那一格上，0.97 那一拍 sup 就翻成 0，這一格立刻被畫成兩倍高，下一拍又翻回來。
     實測靜止的馬克杯：有一格 v 一直是 0.231，h 卻在 0.231 ↔ 0.462 之間跳，
     一次七八十格一起跳。這是 v1.81 就在的，v1.94.0 水面開始吃光才看得見。 */
  const wbStill = await page.evaluate(() => {
    cleanTools();
    const keep = shapePick;
    targetCnt = 3000; shapePick = SHAPES.findIndex(s => s.n === '經典馬克杯');
    startBuild(true); completeNow();
    let rim = 0;
    for (const s of bp.slots) if (s.filled) rim = Math.max(rim, s.gy);
    pourBucket(0, rim + 2, 0, WB_DROPS);
    for (let i = 0; i < 60 * 20; i++) step(1 / 60);     // 等它完全靜下來
    const snap = () => {
      const m = new Map();
      for (const c of water.cells.values()) m.set(c.gx + ':' + c.gy + ':' + c.gz, c.h);
      return m;
    };
    /* 每一柱畫出來的水面（最上面那格的 gy + hv）平均起來。靜止的水只會因為滲水
       慢慢降，**不該往上升**——升回去就是在脈動。 */
    const level = () => {
      const col = new Map();
      for (const c of water.cells.values()) {
        if (!c.vis) continue;
        const k = c.gx + ':' + c.gz, top = c.gy + Math.max(c.hv, WT_SHOW);
        if (!(col.get(k) >= top)) col.set(k, top);
      }
      let s = 0;
      for (const t of col.values()) s += t;
      return s / col.size;
    };
    let prev = snap(), lv = level(), rise = 0, jump = 0, worst = 0;
    const seq = [];
    for (let k = 0; k < 30; k++) {
      step(1 / 60);
      const cur = snap();
      let n = 0;
      for (const [key, h] of cur) {
        const o = prev.get(key);
        if (o === undefined) continue;
        const d = Math.abs(o - h);
        if (d > 0.1) n++;
        if (d > worst) worst = d;
      }
      const now = level();
      rise = Math.max(rise, now - lv);
      lv = now;
      jump += n; seq.push(n); prev = cur;
    }
    shapePick = keep;
    return { cells: water.cells.size, jump, seq: seq.slice(0, 10),
             worst: +worst.toFixed(3), rise: +rise.toFixed(4) };
  });
  ok('靜止的水面不會忽高忽低（畫出來的高度不在 v 與 2v 之間翻）',
     wbStill.jump === 0 && wbStill.rise < 0.01,
     wbStill.cells + ' 格水靜置 20 秒後，30 幀內高度跳超過 0.1 格的次數 ' + wbStill.jump +
     '（改版前一次七八十格一起跳）、最大單格變化 ' + wbStill.worst +
     ' 格；平均水面往上升最多 ' + wbStill.rise + ' 格（改版前 0.064，只該因為滲水往下降）');

  // 一杯水在場時每幀的成本
  const wbCost = await page.evaluate(() => {
    cleanTools(); startBuild(true); completeNow();
    pourBucket(0, bp.height + 2, 0, WB_DROPS);
    for (let i = 0; i < 60 * 8; i++) step(1 / 60);
    const cells = water ? water.cells.size : 0;
    let sum = 0, worst = 0;
    const all = [];
    for (let i = 0; i < 90; i++) {
      const t0 = performance.now();
      step(1 / 60); draw();
      const d = performance.now() - t0;
      sum += d; worst = Math.max(worst, d); all.push(d);
    }
    cleanTools();
    all.sort((a, b) => a - b);
    return { cells, avg: +(sum / 90).toFixed(2), worst: +worst.toFixed(2),
             p95: +all[Math.floor(all.length * 0.95)].toFixed(2) };
  });
  /* 尖峰用 p95 不用「最壞那一幀」（v1.139 改）：90 幀裡最慢的那一幀是整個分布最會跳的
     一個數——軟體算圖 ＋ 垃圾回收，同一份程式碼實測會在 8～14 ms 之間晃，而門檻是 12，
     所以它本來就會偶爾紅，跟改了什麼無關。門檻沒有放寬（12 ms 原封不動），
     只是把「單一極值」換成「95% 的幀都在這條線以下」。 */
  ok('一杯水在場時每幀的成本在預算內',
     wbCost.avg < 4 && wbCost.p95 < 12,
     wbCost.cells + ' 格水：step + draw 平均 ' + wbCost.avg + ' ms、p95 ' +
     wbCost.p95 + ' ms、最慢一幀 ' + wbCost.worst + ' ms（預算 4ms）');

  // 連倒二十下也不會失控（格數有上限），最後水也走得掉
  const wbMany = await page.evaluate(() => {
    cleanTools(); startBuild(true); completeNow();
    let maxCells = 0;
    for (let k = 0; k < 20; k++) {
      pourBucket(rr(-6, 6), bp.height + 3, rr(-6, 6), WB_DROPS);
      for (let i = 0; i < 30; i++) { step(1 / 60); maxCells = Math.max(maxCells, water ? water.cells.size : 0); }
    }
    let t = 0;
    while (water && t < 200) { step(1 / 60); t += 1 / 60; if (water) maxCells = Math.max(maxCells, water.cells.size); }
    const left = water ? [...water.cells.values()].reduce((a, c) => a + c.v, 0) : 0;
    const r = { maxCells, cap: WT_CELLS, poured: 20 * WB_CLICK,
                t: +t.toFixed(0), left: Math.round(left), gone: !water };
    cleanTools();
    return r;
  });
  ok('連倒二十下也不會失控，水最後也走得掉',
     wbMany.maxCells <= wbMany.cap && wbMany.left < 60,
     '同時最多 ' + wbMany.maxCells + ' 格水（上限 ' + wbMany.cap + '）；倒了 ' +
     wbMany.poured + ' 格，' + wbMany.t + ' 秒後只剩 ' + wbMany.left + ' 格');

  // 換一座建築就把水收掉（水記的是格子，藍圖一換就不存在了）
  const wbSwap = await page.evaluate(() => {
    cleanTools(); startBuild(true); completeNow();
    pourBucket(0, bp.height + 2, 0, WB_DROPS);
    for (let i = 0; i < 120; i++) step(1 / 60);
    const on = water ? water.cells.size : 0;
    startBuild(true);
    const off = water ? water.cells.size : 0;
    cleanTools();
    return { on, off };
  });
  ok('換一座建築就把水收掉', wbSwap.on > 0 && wbSwap.off === 0,
     '換場前 ' + wbSwap.on + ' 格水 → 換場後 ' + wbSwap.off + ' 格');

  /* 沒有懸空的水：每一格水的腳下要嘛是積木、要嘛是地面、要嘛是別的水。
     這一條在六座建築上各倒一遍——一格一格的模型裡它是規則本身（掉不下去才會停），
     所以這條守的是「規則有沒有被繞過」。 */
  const wbSolid = await page.evaluate(() => {
    const names = ['巴黎凱旋門', '美國國會大廈', '巴黎聖母院', '吉薩金字塔', '經典馬克杯', '羅馬競技場'];
    const out = [];
    for (const n of names) {
      cleanTools();
      targetCnt = 3000;
      shapePick = SHAPES.findIndex(s => s.n === n);
      startBuild(true); completeNow();
      pourBucket(0, bp.height + 2, 0, WB_DROPS);
      for (let i = 0; i < 60 * 14; i++) step(1 / 60);
      let bad = 0, cells = 0;
      for (const c of (water ? water.cells.values() : [])) {
        cells++;
        if (c.gy === 0) continue;                          // 站在草地上
        if (solidAt(c.gx, c.gy - 1, c.gz)) continue;        // 站在積木上
        if (watAt(c.gx, c.gy - 1, c.gz) > WT_MIN) continue; // 站在別的水上
        bad++;                                             // 懸空（正在落下的那一拍不算，這裡是靜下來之後）
      }
      out.push({ n, cells, bad });
    }
    cleanTools();
    return out;
  });
  ok('六座建築倒過一遍：靜下來之後沒有懸空的水',
     wbSolid.every(r => r.bad === 0) && wbSolid.reduce((a, r) => a + r.cells, 0) > 500,
     wbSolid.map(r => r.n + ' ' + r.cells + ' 格').join('、'));

  /* 積水在畫面上真的看得到（草地上多出一片藍），而且**看得出是一格一格的方塊**。 */
  const wbPix = await page.evaluate(async () => {
    cleanTools(); startBuild(true); completeNow();
    const blue = () => {
      const g = ENG.three.renderer.domElement;
      const cv = document.createElement('canvas');
      cv.width = g.width; cv.height = g.height;
      cv.getContext('2d').drawImage(g, 0, 0);
      const d = cv.getContext('2d').getImageData(0, Math.floor(g.height * 0.5),
                                                 g.width, Math.floor(g.height * 0.45)).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4)
        if (d[i + 2] > d[i] + 25 && d[i + 2] > d[i + 1] + 15) n++;
      return n;
    };
    draw(); ENG.render();
    const before = blue();
    for (let k = 0; k < 3; k++) pourBucket(rr(-4, 4), 4, rr(-4, 4), WB_DROPS);
    for (let i = 0; i < 60 * 6; i++) step(1 / 60);
    draw(); ENG.render();
    const after = blue();
    const cells = water ? water.cells.size : 0;
    cleanTools();
    return { before, after, cells };
  });
  ok('積水在畫面上真的看得到（草地上多出一片藍）',
     wbPix.after > wbPix.before + 3000,
     '倒水前草地那半有 ' + wbPix.before + ' 個偏藍的像素 → 倒了三下之後 ' +
     wbPix.after + '（' + wbPix.cells + ' 格水）');

  /* 這四條是使用者拿 v1.81 玩過之後回報的四件事，各自守一件。 */
  const wbFour = await page.evaluate(() => {
    const build = () => {
      cleanTools();
      targetCnt = 3000;
      shapePick = SHAPES.findIndex(s => s.n === '經典馬克杯');
      startBuild(true); completeNow();
      let rim = 0;
      for (const s of bp.slots) if (s.filled) rim = Math.max(rim, s.gy);
      const mx = cellX(0), mz = cellZ(0);
      let floor = 0;
      while (solidAt(mx, floor, mz)) floor++;
      return { rim, mx, mz, floor };
    };
    const out = {};

    /* ① 倒在杯子**內側**，杯子外面不該有水。
       倒水口一格裝不下一拍的量，要往旁邊找位置——一圈一圈掃座標的話會穿牆
       （使用者：「我是點在杯子內側，結果外側也有水」）。現在是從落點做 BFS。 */
    let g = build();
    let wall = null;
    for (let d = 1; d < 25 && wall == null; d++) if (solidAt(g.mx, 12, g.mz - d)) wall = g.mz - d;
    /* 用**真的 pourWater** ＋ 射線打在內壁那一面（點就落在牆那一格裡）：
       這才守得住兩件事——落點要退出積木（不然一滴都倒不出來），
       而且倒水口不能穿牆（不然杯外也有水）。 */
    pourWater({ point: { x: wldX(g.mx), y: 12, z: wldZ(wall) + 0.47 },
                dir: { x: 0, y: -0.45, z: -0.89 }, kind: 'block' });
    for (let i = 0; i < 60 * 18; i++) step(1 / 60);
    let outside = 0, inside = 0;
    for (const c of (water ? water.cells.values() : []))
      if (c.gy < g.floor) outside += c.v; else inside += c.v;
    out.inner = { outside: Math.round(outside), inside: Math.round(inside) };

    /* ② 有水壓：破口噴得出去，不是滴在腳邊。
       水壓 ＝ 這一柱的水面 − 這一格，而且會沿著水流往外傳（每走一格掉 1）——
       出口那一格頭上其實沒有水，壓力是水缸給的。 */
    g = build();
    // 倒兩下（水裝得比較滿）：水壓就是水面到破口的高度差，裝半杯敲低處的洞壓力只有 5 格
    for (let k = 0; k < 2; k++) {
      pourBucket(0, g.rim + 2, 0, WB_DROPS);
      for (let i = 0; i < 60 * 11; i++) step(1 / 60);
    }
    buildSlotOwner();
    const hy = 6;
    let wz = null;
    for (let d = 1; d < 25 && wz == null; d++) if (solidAt(g.mx, hy, g.mz + d)) wz = g.mz + d;
    let broke = 0;
    for (let gx = g.mx - 1; gx <= g.mx + 1; gx++)
      for (let yy = hy; yy < hy + 3; yy++)
        for (let gz = g.mz; gz < g.mz + 40; gz++) {
          const bl = blockOn(gx, yy, gz);
          if (bl) { breakBlock(bl, 0, 1, 3); broke++; }
        }
    /* 量的是**噴出去的形狀**：牆外每一格，同高度最高的水在第幾層。
       有水壓＋走拋物線的話這串數字會「越遠越低」；只丟到最遠那一格再往下掉的話，
       中間幾格根本沒有水（使用者：「噴出去立刻就往下落，看起來沒有噴出來」）。 */
    const arc = {};
    let far = 0, hd = 0;
    for (let i = 0; i < 60 * 6; i++) {
      step(1 / 60);
      for (const c of (water ? water.cells.values() : [])) {
        if (c.gx !== g.mx || c.gz <= wz || c.v < 0.05) continue;
        const k = c.gz - wz;
        if (c.gy >= hy - 4) { arc[k] = Math.max(arc[k] || 0, c.gy); far = Math.max(far, k); }
        hd = Math.max(hd, c.hd || 0);
      }
    }
    // 一路往外走，高度不會往上（＝拋物線），而且至少掉了 2 層
    let mono = true, drop = 0;
    for (let k = 2; k <= far; k++) {
      if (arc[k] == null || arc[k - 1] == null) continue;
      if (arc[k] > arc[k - 1]) mono = false;
      drop = Math.max(drop, arc[1] - arc[k]);
    }
    out.jet = { hy, broke, far, hd: Math.round(hd), mono, drop,
                arc: Object.keys(arc).map(k => k + ':' + arc[k]).join(' ') };

    /* ③ 裝到滿出來：一直倒，水面要能升過杯口、從杯口流下去。
       改版前格數上限訂 4000（杯子裝滿要 4632 格），所以水位到一半就再也上不去了
       （使用者：「水杯裝到一定程度水位不會再上升，沒辦法滿出來」）。 */
    g = build();
    for (let k = 0; k < 3; k++) {
      pourBucket(0, g.rim + 2, 0, WB_DROPS);
      for (let i = 0; i < 60 * 10; i++) step(1 / 60);
    }
    let top = -1, over = 0;
    for (const c of (water ? water.cells.values() : [])) {
      top = Math.max(top, c.gy + c.v);
      if (c.gy < g.floor) over += c.v;                        // 溢到裙邊、地上的
    }
    out.fill = { rim: g.rim, top: +top.toFixed(1), over: Math.round(over),
                 cells: water ? water.cells.size : 0, cap: WT_CELLS };

    /* ④ 地面的水不會一閃一閃：每一幀「生出來」與「消失」的格子要很少。
       薄薄一層還往外分的話，分出去的馬上又乾掉、又往外分——實測改版前每一幀
       有九百格生出來、九百格消失（使用者：「水流到地面水會一閃一閃的」）。 */
    g = build();
    pourBucket(wldX(g.mx) + 22, 3, wldZ(g.mz), WB_DROPS);
    let born = 0, died = 0, frames = 0, prev = new Set();
    for (let i = 0; i < 60 * 5; i++) {
      step(1 / 60);
      const now = new Set();
      for (const c of (water ? water.cells.values() : []))
        if (c.vis) now.add(c.gx + ':' + c.gy + ':' + c.gz);
      if (i > 60) {                                           // 前一秒還在倒，不算
        for (const k of now) if (!prev.has(k)) born++;
        for (const k of prev) if (!now.has(k)) died++;
        frames++;
      }
      prev = now;
    }
    // 水裡有沒有「四周都有水、自己沒水」的洞（那種洞會一格一格閃）
    const g0 = new Set();
    for (const c of (water ? water.cells.values() : []))
      if (c.gy === 0 && c.vis) g0.add(c.gx + ':' + c.gz);
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, holes = 0;
    for (const k of g0) {
      const [x, z] = k.split(':').map(Number);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
    }
    for (let x = x0 + 1; x < x1; x++)
      for (let z = z0 + 1; z < z1; z++) {
        if (g0.has(x + ':' + z)) continue;
        let n = 0;
        for (const d of DIR4) if (g0.has((x + d[0]) + ':' + (z + d[1]))) n++;
        if (n === 4) holes++;
      }
    out.flick = { born: +(born / frames).toFixed(1), died: +(died / frames).toFixed(1),
                  holes, sheet: g0.size };
    cleanTools();
    return out;
  });
  ok('點在杯壁內側：水進得去杯子，杯子外面不會有水',
     wbFour.inner.inside > 1500 && wbFour.inner.outside < 30,
     '射線打在內壁面上倒一下：杯內 ' + wbFour.inner.inside + ' 格、杯外 ' +
     wbFour.inner.outside +
     ' 格（v1.81 杯外會鋪一大片；v1.82 反過來一滴都倒不出來——落點卡在積木裡）');
  ok('有水壓：破口把水噴出去，而且走的是一條往外往下的拋物線',
     wbFour.jet.broke >= 6 && wbFour.jet.far >= 4 && wbFour.jet.mono && wbFour.jet.drop >= 2,
     '破口在第 ' + wbFour.jet.hy + ' 層、水壓最大 ' + wbFour.jet.hd +
     ' 格：噴到牆外 ' + wbFour.jet.far + ' 格、一路掉了 ' + wbFour.jet.drop +
     ' 層（牆外第幾格:最高第幾層 = ' + wbFour.jet.arc + '）');
  ok('一直倒會從杯口滿出來，水位不會卡住',
     wbFour.fill.top > wbFour.fill.rim && wbFour.fill.over > 10 &&
     wbFour.fill.cells < wbFour.fill.cap,
     '倒三下：水面到第 ' + wbFour.fill.top + ' 層（杯口 ' + wbFour.fill.rim +
     '），溢出去 ' + wbFour.fill.over + ' 格；' + wbFour.fill.cells +
     ' 格水（上限 ' + wbFour.fill.cap + '）');
  ok('地面的水不會一閃一閃，水裡也不會有會閃的洞',
     wbFour.flick.born < 40 && wbFour.flick.died < 40 && wbFour.flick.holes <= 2,
     '每一幀生出來 ' + wbFour.flick.born + ' 格、消失 ' + wbFour.flick.died +
     ' 格（v1.81 是 901 / 899）；' + wbFour.flick.sheet + ' 格的水裡有 ' +
     wbFour.flick.holes + ' 個洞');

  /* 這三條是使用者拿 v1.83 玩過之後回報的三件事，各自守一件。 */
  const wbFive = await page.evaluate(() => {
    const build = () => {
      cleanTools();
      targetCnt = 3000;
      shapePick = SHAPES.findIndex(s => s.n === '經典馬克杯');
      startBuild(true); completeNow();
      let rim = 0;
      for (const s of bp.slots) if (s.filled) rim = Math.max(rim, s.gy);
      const mx = cellX(0), mz = cellZ(0);
      let floor = 0;
      while (solidAt(mx, floor, mz)) floor++;
      return { rim, mx, mz, floor };
    };
    const out = {};

    /* ① 桶口倒出來的是**一道水流**，不是一片水牆。
       一格只裝得下一格的水，一柱水一拍也只送得走一格的量——所以「一拍要塞 46 格」
       如果就近硬塞，會在半空中鋪成一片十幾格寬的水牆往下砸（實測 12×11 格、二十層高；
       使用者：「點在杯子內壁看起來瞬間出水量太大」）。
       量的是**半空中那一段每一層幾格**：一道水流的話每層就一格。 */
    let g = build();
    pourBucket(wldX(g.mx) + 26, 20, wldZ(g.mz), WB_DROPS);
    for (let i = 0; i < 90; i++) step(1 / 60);
    let top = 0;
    for (const c of water.cells.values()) if (c.v > WT_SHOW) top = Math.max(top, c.gy);
    const per = new Map();
    for (const c of water.cells.values())
      if (c.v > WT_SHOW && c.gy > top - 10) per.set(c.gy, (per.get(c.gy) || 0) + 1);
    out.pour = { top, levels: per.size, wide: Math.max(...per.values()) };

    /* ② 破口要**湧出來**，而且外面那道水柱要接得起來。
       流量看**水壓**（托里切利：出口流速 ∝ √h）。改版前只按高低差搬一半——破口內外
       一樣滿、差值幾乎是零，整杯水一秒只漏 56 格，看起來像在滴水（使用者：「先裝水
       然後打破側面出水，應該更大量更快速湧出才正常」）；而且外面每格只裝 0.27 格水，
       一拍掉一格接不起來，畫出來是一疊薄片（使用者：「往下流的水體只有頂部一層」）。 */
    g = build();
    for (let k = 0; k < 2; k++) {                    // 裝兩下：水面高、破口才有水壓
      pourBucket(0, g.rim + 2, 0, WB_DROPS);
      for (let i = 0; i < 60 * 11; i++) step(1 / 60);
    }
    buildSlotOwner();
    const hy = 14;                                   // 半腰敲一個 5 寬 × 4 高的窗
    let wz = null;
    for (let d = 1; d < 25 && wz == null; d++) if (solidAt(g.mx, hy, g.mz + d)) wz = g.mz + d;
    let broke = 0;
    for (let gx = g.mx - 2; gx <= g.mx + 2; gx++)
      for (let yy = hy; yy < hy + 4; yy++)
        for (let gz = g.mz; gz < g.mz + 40; gz++) {
          const bl = blockOn(gx, yy, gz);
          if (bl) { breakBlock(bl, 0, 1, 3); broke++; }
        }
    const cup = () => {
      let v = 0;
      for (const c of (water ? water.cells.values() : [])) if (c.gz <= wz) v += c.v;
      return v;
    };
    const v0 = cup();
    for (let i = 0; i < 60; i++) step(1 / 60);
    const drain = Math.round(v0 - cup());
    // 牆外那道水柱：每一層幾格、每格裝多少水（畫出來多高是 WT_AIR 那邊的事）
    const lv = new Map();
    for (const c of water.cells.values()) {
      if (c.gz <= wz || c.gy >= hy || c.gy < 3 || c.v <= WT_SHOW) continue;
      let e = lv.get(c.gy);
      if (!e) lv.set(c.gy, e = { n: 0, v: 0 });
      e.n++; e.v += c.v;
    }
    const rows = [...lv.values()];
    out.jet = { broke, drain, levels: rows.length,
                wide: rows.length
                  ? +(rows.reduce((a, e) => a + e.n, 0) / rows.length).toFixed(1) : 0,
                vol: rows.length
                  ? +(rows.reduce((a, e) => a + e.v, 0) / rows.reduce((a, e) => a + e.n, 0)).toFixed(2)
                  : 0 };

    /* ③ 規則交出去的水，**每一格都要畫得出來**：引擎那邊的格數上限得跟 WT_CELLS 一樣大。
       一個裝滿的馬克杯就有 4463 格，引擎舊的上限是 4000 格——多出來的整格不畫，而且被
       丟掉的是清單後面那些＝最新的水，所以畫面上就是「破口在流水，可是看不到水柱」。
       用引擎真的畫了幾個三角形來比：水想畫幾面 × 2 就是它該畫幾個三角形。 */
    let want = 0;
    const L = poolList();
    for (const p of L)
      for (let bit = 0; bit < 6; bit++) if (p.f & (1 << bit)) want++;
    draw(); ENG.render();
    const withW = ENG.info().tris;
    const keep = water; water = null;
    draw(); ENG.render();
    const without = ENG.info().tris;
    water = keep;
    out.draw = { cells: L.length, want, got: withW - without };
    cleanTools();
    return out;
  });
  ok('倒水倒出來的是一道水流，不是半空中一大片水牆',
     wbFive.pour.wide <= 2 && wbFive.pour.levels >= 8,
     '桶口在第 ' + wbFive.pour.top + ' 層：半空中那 ' + wbFive.pour.levels +
     ' 層每層最多 ' + wbFive.pour.wide + ' 格（改版前是 12×11 格、二十層高的水塊）');
  ok('有水壓：破口一秒漏得掉一大股水，外面那道水柱也接得起來',
     wbFive.jet.drain >= 75 && wbFive.jet.wide >= 3.5 && wbFive.jet.vol >= 0.4 &&
     wbFive.jet.levels >= 8,
     '敲掉 ' + wbFive.jet.broke + ' 塊：第一秒漏掉 ' + wbFive.jet.drain +
     ' 格（改版前 56 格），牆外水柱 ' + wbFive.jet.levels + ' 層、平均 ' +
     wbFive.jet.wide + ' 格寬、每格 ' + wbFive.jet.vol + ' 格水（改版前 0.27）');
  ok('規則交出去的水每一格都畫得出來（引擎的格數上限夠大）',
     wbFive.draw.got === wbFive.draw.want * 2 && wbFive.draw.cells > 4000,
     wbFive.draw.cells + ' 格水要畫 ' + wbFive.draw.want + ' 面，引擎畫了 ' +
     wbFive.draw.got + ' 個三角形（＝' + (wbFive.draw.got / 2) +
     ' 面；上限 4000 格的時候整條水柱會被丟掉）');

  /* v1.85：出水點不會穿到牆的另一邊。使用者回報「點杯壁內側，實際出水的點好像判定
     穿過建築了，變成在背後（就像沒建築）的地面出水」——兩個原因各驗一條。 */
  const wbSix = await page.evaluate(() => {
    const build = () => {
      cleanTools();
      targetCnt = 3000;
      shapePick = SHAPES.findIndex(s => s.n === '經典馬克杯');
      startBuild(true); completeNow();
      const mx = cellX(0), mz = cellZ(0);
      let rim = 0;
      for (const s of bp.slots) if (s.filled) rim = Math.max(rim, s.gy);
      let floor = 0;
      while (solidAt(mx, floor, mz)) floor++;
      /* 每一層「杯子裡面」是哪些格：從軸心 flood fill，碰到實心就停。
         漫到 14 格外還沒被圍住的就當它不是杯內（那一層是杯口以上的開放空間）。 */
      const inside = [];
      for (let gy = 0; gy <= rim + 2; gy++) {
        const set = new Set();
        if (!solidAt(mx, gy, mz)) {
          const q = [mx, mz]; set.add(mx + ':' + mz);
          for (let i = 0; i < q.length && set.size < 900; i += 2) {
            const x = q[i], z = q[i + 1];
            for (const d of DIR4) {
              const nx = x + d[0], nz = z + d[1], k = nx + ':' + nz;
              if (set.has(k) || solidAt(nx, gy, nz)) continue;
              if (Math.hypot(nx - mx, nz - mz) > 14) { set.add('OPEN'); continue; }
              set.add(k); q.push(nx, nz);
            }
          }
        }
        inside[gy] = set;
      }
      const inCup = (gx, gy, gz) => gy >= 0 && gy < inside.length &&
                                    inside[gy].has(gx + ':' + gz) && !inside[gy].has('OPEN');
      return { rim, mx, mz, floor, inside, inCup };
    };
    /* 倒完之後：杯子裡有多少水、杯子外面（裙邊、地面）有多少水。
       杯內地板在第 floor 層，所以比它低的一定是漏到外面去的。 */
    const split = (g) => {
      let inside = 0, outside = 0;
      for (const c of (water ? water.cells.values() : []))
        if (c.gy < g.floor) outside += c.v; else inside += c.v;
      return { inside: Math.round(inside), outside: Math.round(outside) };
    };
    const out = {};

    /* ① 直接餵一個「從積木之間的縫看到的頂面」的 hit。積木畫出來上下也差 0.06 格，
       很陡的射線會從那道橫縫鑽進去、打到下面那一塊的頂面——對玩家來說那就是杯壁內側。
       這種落點本身就在牆裡，而且上面幾層也都是牆（往上找不到空格）。改版前 injectWater
       會「往旁邊找一格空的」，而旁邊那一格可能就在牆的另一邊——水於是倒到杯子外面、
       沿著外牆流到地上。 */
    let g = build();
    let led = null;                                  // 貼著杯內的一根牆（上面幾層都是實心）
    for (let gy = g.floor + 2; gy < g.rim - 4 && !led; gy++)
      for (const k of g.inside[gy + 1]) {
        if (k === 'OPEN') continue;
        const [ix, iz] = k.split(':').map(Number);
        for (const d of DIR4) {
          const gx = ix + d[0], gz = iz + d[1];
          if (solidAt(gx, gy, gz) && solidAt(gx, gy + 1, gz) &&
              solidAt(gx, gy + 2, gz) && solidAt(gx, gy + 3, gz)) { led = { gy, gx, gz }; break; }
        }
        if (led) break;
      }
    // 從杯子裡面斜斜往下看那一塊的頂面：往外（離開軸心）0.64、往下 0.77
    const ux = led.gx - g.mx, uz = led.gz - g.mz, un = Math.hypot(ux, uz) || 1;
    pourWater({ point: { x: wldX(led.gx), y: led.gy + HB * 2, z: wldZ(led.gz) },
                dir: { x: ux / un * 0.64, y: -0.77, z: uz / un * 0.64 },
                dist: 2, kind: 'block' });
    const p1 = water.pours[0];
    out.ledge = { gy: led.gy, r: +Math.hypot(ux, uz).toFixed(1),
                  mouth: [p1.gx - g.mx, p1.gy, p1.gz - g.mz],
                  inCup: g.inCup(p1.gx, p1.gy, p1.gz) || p1.gy > g.rim };
    for (let i = 0; i < 60 * 14; i++) step(1 / 60);
    Object.assign(out.ledge, split(g));

    /* ② 積木畫出來只有 0.94 格寬，彼此之間有 0.06 格的縫——射線正對著縫時真的鑽得過去，
       pick 就回報打到牆後面的東西。這裡直接餵一個「穿過杯壁、打到外面地上」的 hit：
       出水點要退回牆的這一側（杯子裡），不是照著那個落點倒在地上。 */
    g = build();
    const y0 = 12;                                   // 杯內某個高度
    let wall = 0;
    while (wall < 14 && !solidAt(g.mx + wall, y0, g.mz)) wall++;   // 牆從第幾格開始
    const far = wall + 9;                            // 牆外面很遠的地上
    pourWater({ point: { x: wldX(g.mx + far), y: 0, z: wldZ(g.mz) },
                dir: { x: 0.55, y: -0.83, z: 0 }, dist: 21, kind: 'ground' });
    const p2 = water.pours[0];
    out.slip = { wall, far, mouthR: p2.gx - g.mx, mouthY: p2.gy,
                 inCup: g.inCup(p2.gx, p2.gy, p2.gz) };
    for (let i = 0; i < 60 * 14; i++) step(1 / 60);
    Object.assign(out.slip, split(g));
    cleanTools();
    return out;
  });
  ok('點在杯壁內側、落點卡在牆裡：出水點退到杯子這一側，不會跑到牆外面',
     wbSix.ledge.inCup && wbSix.ledge.inside > 1500 && wbSix.ledge.outside < 60,
     '點第 ' + wbSix.ledge.gy + ' 層、離軸心 ' + wbSix.ledge.r +
     ' 格那一塊的頂面：出水口落在 (離軸心 ' + wbSix.ledge.mouth[0] + '、第 ' +
     wbSix.ledge.mouth[1] + ' 層)，在杯子裡 ' + wbSix.ledge.inCup +
     ' → 杯內 ' + wbSix.ledge.inside + ' 格、杯外 ' + wbSix.ledge.outside + ' 格');
  ok('射線從積木縫鑽過去時，出水點退回牆的這一側（不會在建築背後出水）',
     wbSix.slip.inCup && wbSix.slip.inside > 1500 && wbSix.slip.outside < 60,
     '餵一個「穿過牆、打到牆外 ' + wbSix.slip.far + ' 格地上」的 hit（牆從第 ' +
     wbSix.slip.wall + ' 格開始）：出水口落在離軸心 ' + wbSix.slip.mouthR + ' 格（第 ' +
     wbSix.slip.mouthY + ' 層）→ 杯內 ' + wbSix.slip.inside + ' 格、杯外 ' +
     wbSix.slip.outside + ' 格');

  /* ── 水桶就是一般工具：點一下用一次、拖曳轉視角（v1.74 改回來） ──────
     v1.70～1.73 曾經是「按住不放就一直倒、這把工具下拖曳不轉視角」，
     使用者要求改回一致：一把工具一種操作，不該只有水桶特別。 */
  await reset(page, { shape: '吉薩金字塔', cnt: 3000, workers: 6 });
  await fillAll(page);
  const wbTop = await toScreen(page,
    '(() => { let t = null; for (const b of blocks) if (b.st === 3 && (!t || b.y > t.y)) t = b; return t; })()');
  await page.evaluate(() => { cleanTools(); tool = 'bucket'; });
  /* 點下去的座標、那一點打到哪個元素、當下的鏡頭，一起寫進訊息裡：這兩條要是壞了，
     幾乎都是「投影跑到畫面外」或「點到 UI 上」（滑鼠事件就進不了畫布），
     沒有這幾個數字只會看到「沒出水、也沒轉視角」，分不出是哪一種。
     鏡頭角度是跨測試累積的（reset 只重新取景，不動 yaw／pitch）。 */
  const wbAt = await page.evaluate(p => {
    const el = document.elementFromPoint(Math.round(p.x), Math.round(p.y));
    return { el: el ? (el.id || el.tagName) : null,
             inside: p.x >= 0 && p.y >= 0 && p.x <= window.innerWidth && p.y <= window.innerHeight,
             yaw: +ENG.cam.yaw.toFixed(2), pitch: +ENG.cam.pitch.toFixed(2),
             dist: +ENG.cam.dist.toFixed(1), ty: +ENG.cam.ty.toFixed(1) };
  }, wbTop);
  const wbWhere = '；點 (' + Math.round(wbTop.x) + ',' + Math.round(wbTop.y) + ') 打到 ' +
    wbAt.el + '、在畫面內 ' + wbAt.inside + '、鏡頭 yaw ' + wbAt.yaw + '／pitch ' + wbAt.pitch +
    '／dist ' + wbAt.dist + '／視線高 ' + wbAt.ty;
  await page.mouse.move(wbTop.x, wbTop.y);
  await page.mouse.down();
  await page.waitForTimeout(250);
  const wbHold = await page.evaluate(() => ({ cells: water ? water.cells.size : 0 }));
  await page.mouse.up();
  await page.waitForTimeout(80);
  await page.evaluate(() => { for (let i = 0; i < 30; i++) step(1 / 60); });
  const wbClick = await page.evaluate(() => ({ cells: water ? water.cells.size : 0 }));
  ok('點一下倒一整下的量（放開才發動，跟其他工具一樣）',
     wbHold.cells === 0 && wbClick.cells > 20,
     '按著的時候沒有水 ' + (wbHold.cells === 0) + '，放開後有 ' + wbClick.cells + ' 格水' + wbWhere);

  // 拿水桶拖曳＝轉視角（跟槌子一樣），而且拖完不會倒水
  const wbYaw0 = await page.evaluate(() => { water = null; return ENG.cam.yaw; });
  await page.mouse.move(wbTop.x, wbTop.y);
  await page.mouse.down();
  await page.mouse.move(wbTop.x + 160, wbTop.y + 60, { steps: 8 });
  await page.mouse.up();
  const wbDrag = await page.evaluate(() => ({ yaw: ENG.cam.yaw, water: !!water }));
  ok('拿水桶拖曳是轉視角，不會倒出水來',
     Math.abs(wbDrag.yaw - wbYaw0) > 0.1 && wbDrag.water === false,
     'yaw 轉了 ' + (wbDrag.yaw - wbYaw0).toFixed(2) + '，倒出水來了嗎 ' + wbDrag.water + wbWhere);

  await page.evaluate(() => { tool = 'hammer'; });         // 別把水桶留給後面的測試

  await head('煙火');
  await reset(page, { shape: '新天鵝堡', cnt: 2000, workers: 4 });
  const fw = await page.evaluate(() => {
    completeNow();
    clearFires();
    // 這一場齊射「要」退到多遠：把視距壓到最近問一次 holdWide 就知道（測試不自己複製公式）
    const d1 = ENG.camTarget.dist, ty1 = ENG.camTarget.ty;
    ENG.camTarget.dist = 6; ENG.camTarget.ty = 0; ENG.holdWide(FW_HOLD_TOP, FW_HOLD_R);
    const need = ENG.camTarget.dist;
    ENG.camTarget.dist = d1; ENG.camTarget.ty = ty1;
    const set0 = placedCnt, d0 = ENG.camTarget.dist;
    launchFw({ x: 0, z: 0 });
    const dist = ENG.camTarget.dist;
    /* 追第一發：齊射之後 fworks[0] 會換人（先炸的先離開陣列），
       所以要認物件本身，不能認索引——不然量到的「竄多高」是三發混在一起的。 */
    const shell0 = fworks[0];
    const seen = new Set(fworks);                  // 一共出膛幾發（含還在排隊的那兩發）
    let top = 0, rise = 0, all = 0, sparks = 0, burstY = 0, ndc = -9;
    while (fworks && fworks.indexOf(shell0) >= 0 && rise < 4) {
      step(0.05); rise += 0.05; all = rise;
      if (fworks) for (const f of fworks) seen.add(f);
      if (fworks && fworks.indexOf(shell0) >= 0) top = Math.max(top, shell0.y);
    }
    while (fworks && all < 6) {                    // 等其他兩發也炸完
      step(0.05); all += 0.05;
      if (fworks) for (const f of fworks) seen.add(f);
    }
    const shells = seen.size, tops = [...seen].map(f => +f.top.toFixed(1));
    if (fwSparks) {
      sparks = fwSparks.length;
      burstY = fwSparks.reduce((s, x) => s + x.y, 0) / sparks;
      const v = new THREE.Vector3(fwSparks[0].x, fwSparks[0].y, fwSparks[0].z).project(ENG.three.camera);
      ndc = +v.y.toFixed(2);
    }
    const setAtBurst = placedCnt;
    /* 等火星飛完，數它點著了幾處、散得多開。
       火星的方向是隨機的，整發都落在空地上、或整發都擠在同一個角落，都是**正常**的，
       所以這裡連放三發看合計——要驗的是「火星真的會點著建築、而且不是只點一處」，
       不是「每一發都一定點得著」。每一發之前先 clearFires()，
       不然數到的會是上一發自己蔓延出去的火。
       三發是量出來的：中世紀城堡（v1.66 換掉的那份） 2000 塊跑 60 輪，兩發合計有 1 輪散開只有 2.2
       （門檻是 4，也就是約 1.7% 會誤判）；三發 0/60，最差也散開 14.2。 */
    const shot = () => {
      let fall = 0;
      while (fwSparks && fall < 8) { step(0.05); fall += 0.05; }
      return { pts: (fires || []).filter(f => f.b.st === 3).map(f => ({ x: f.b.x, z: f.b.z })), fall };
    };
    const shots = [shot()];                 // 第一發在上面量爆開高度時就已經放上去了
    while (shots.length < 3) {
      clearFires();
      launchFw({ x: 0, z: 0 });
      let up = 0;
      while (fworks && up < 4) { step(0.05); up += 0.05; }
      shots.push(shot());
    }
    const pts = [].concat(...shots.map(s => s.pts));   // 散開程度算三發的聯集，不是各自算
    let spread = 0;
    for (const a of pts) for (const b of pts) spread = Math.max(spread, Math.hypot(a.x - b.x, a.z - b.z));
    return { set0, setAtBurst, top: +top.toFixed(1), rise: +rise.toFixed(2), sparks,
             shells, tops, all: +all.toFixed(2),
             burstY: +burstY.toFixed(1), ndc,
             seeds: pts.length, each: shots.map(s => s.pts.length), spread: +spread.toFixed(1),
             phase, d0: +d0.toFixed(0), dist: +dist.toFixed(0), fall: +shots[0].fall.toFixed(2),
             hold: +need.toFixed(0), shot: FW_SHOT };
  });
  ok('煙火會從地面竄上天再炸開',
     fw.top > 30 && fw.rise > 0.8 && fw.rise < 2.5 && fw.sparks > 120,
     '第一發 ' + fw.rise + ' 秒竄到 ' + fw.top + '，三發合計 ' + fw.sparks + ' 顆火星在天上');
  /* 一次點下去是一場齊射，不是一發：三發、時間錯開、高度各自抽。
     高度全一樣的話三發會在同一條線上炸開，看起來像同一發連放三次。 */
  ok('一次點下去放三發，出膛時間與高度都錯開',
     fw.shells === fw.shot && new Set(fw.tops).size >= 2 &&
     fw.all > fw.rise && fw.all < 3.2,
     fw.shells + ' 發，炸開高度 ' + fw.tops.join('／') + '，全部炸完花 ' + fw.all + ' 秒');
  /* 不退鏡頭的話整發都在畫面外（量過：貼著城堡的取景，火星的 NDC y 是 1.5，1 就出界了）。
     這裡驗兩件事：視距剛好是「原本取景」與「這場齊射要的」之中的大者（不多退）、
     火星確實落在畫面內。 */
  ok('炸開的高度框得進畫面，而且不會退過頭',
     fw.dist === Math.max(fw.d0, fw.hold) && fw.ndc < 0.95 && fw.ndc > -1,
     '視距 ' + fw.d0 + ' → ' + fw.dist + '（煙火要 ' + fw.hold + '），火星 NDC y=' + fw.ndc);
  ok('炸開那一刻一塊積木都沒掉', fw.setAtBurst === fw.set0,
     fw.set0 + ' → ' + fw.setAtBurst + ' 塊（它是灑火種，不是爆炸）');
  ok('落下來的火星把建築點著，而且點在好幾個地方',
     fw.seeds >= 2 && fw.spread > 4 && fw.phase === 'wreck',
     '三輪合計燒起來 ' + fw.seeds + ' 處（' + fw.each.join(' + ') +
     '），三輪合起來最遠兩處相距 ' + fw.spread + '（phase=' + fw.phase + '）');
  const fwOff = await page.evaluate(() => {
    startBuild(true); completeNow(); clearFires();
    /* 打在建築外的空地上：火星落在草地上就只是熄掉。
       離遠一點（+20 而不是 +12）：齊射的第二、三發落點會在點擊處周圍 3～7 單位，
       火星本身又散得開，貼著草地邊緣打的話會有幾顆飄回建築上。 */
    launchFw({ x: arenaR + 20, z: 0 });
    let g = 0;
    while ((fworks || fwSparks) && g++ < 400) step(0.05);
    return { fires: fires ? fires.length : 0, set: placedCnt, total: bp.slots.length, phase };
  });
  ok('掉在草地上的火星只是熄掉，不會憑空燒起來',
     fwOff.fires === 0 && fwOff.set === fwOff.total,
     '起火 ' + fwOff.fires + ' 處、建築仍是 ' + fwOff.set + '/' + fwOff.total + ' 塊');
  const fwSwap = await page.evaluate(() => {
    /* 佇列在「剛點下去」那一刻量，不要先空跑幾幀——出膛間隔是 0.2～0.5 秒的亂數，
       等半秒有時候三發都出去了，量到 0 發在排隊（這條測試因此偶發失敗過）。 */
    startBuild(true); completeNow();
    launchFw({ x: 0, z: 0 });
    const queued = fwWait ? fwWait.length : 0;       // FW_SHOT − 1 發還在排隊
    startBuild(false);
    const leftQ = (fworks ? fworks.length : 0) + (fwWait ? fwWait.length : 0);
    // 再放一場，這次讓它炸開，驗「還在天上飛的火星」也會被收掉
    startBuild(true); completeNow();
    launchFw({ x: 0, z: 0 });
    for (let i = 0; i < 34; i++) step(0.05);
    const flying = fwSparks ? fwSparks.length : 0;
    startBuild(false);
    return { flying, queued, leftQ, shots: FW_SHOT,
             left: (fworks ? fworks.length : 0) + (fwSparks ? fwSparks.length : 0) +
                   (fwWait ? fwWait.length : 0) };
  });
  /* v1.59：換建築不收道具，天上那些火星照樣飛完、照樣會把新的那座點著——
     那本來就是它們的事（「換場感」就是所有東西同時消失來的）。 */
  ok('換建築時還在飛的火星不會被收掉', fwSwap.flying > 0 && fwSwap.left > 0,
     '換場前 ' + fwSwap.flying + ' 顆在飛 → 換場後 ' + fwSwap.left + ' 顆');
  ok('齊射還沒出膛的那幾發也留著，會照原本的節奏出膛',
     fwSwap.queued === fwSwap.shots - 1 && fwSwap.leftQ > 0,
     '點下去當下 ' + fwSwap.queued + ' 發在排隊（齊射 ' + fwSwap.shots +
     ' 發）→ 換場後 ' + fwSwap.leftQ + ' 發');

  /* 火星要畫成一條拖線，不是一顆點（v1.58，參考圖是長曝光的軌跡）。
     舊做法是沿路灑小方塊當尾巴：一場齊射三百多顆火星共用 300 顆粒子的配額，
     平均一顆火星分不到一顆，畫出來就是一片閃爍的點。現在一顆火星＝一條線＝
     一個 instance，長度跟著它當下的速度走。 */
  const fwDense = await page.evaluate(() => {
    startBuild(true); completeNow(); clearFires();
    hot.length = 0;
    launchFw({ x: 0, z: 0 });
    let maxSp = 0, maxDraw = 0, maxLine = 0, minLn = 99, maxLn = 0, aligned = 0, off = 0;
    let dirBad = 0, headBad = 0, n = 0;
    for (let i = 0; i < 120; i++) {
      step(0.05);
      const list = fireList();
      /* 每一條線都要對著它那顆火星的速度方向，頭也要落在火星身上——
         這兩件事才是「看起來像放射狀的線」的來源。要在飛的當下驗，
         等它們燒完就一顆都不剩了。 */
      if (fwSparks) for (const s of fwSparks) {
        const spd = Math.hypot(s.vx, s.vy, s.vz);
        // 慢到不畫線的那幾顆身上留的是上一幀的線，本來就不會跟現在的速度對得上
        if (!s.st || spd < FW_TAIL_MIN) continue;
        n++;
        if (Math.abs(s.st.dx - s.vx / spd) > 1e-6) dirBad++;
        const hx = s.st.x + s.st.dx * s.st.ln / 2, hy = s.st.y + s.st.dy * s.st.ln / 2;
        if (Math.abs(hx - s.x) > 1e-6 || Math.abs(hy - s.y) > 1e-6) headBad++;
      }
      maxSp = Math.max(maxSp, fwSparks ? fwSparks.length : 0);
      maxDraw = Math.max(maxDraw, list.length);
      let lines = 0;
      for (const p of list) {
        if (!p.ln) continue;
        lines++;
        minLn = Math.min(minLn, p.ln); maxLn = Math.max(maxLn, p.ln);
        // 方向必須是單位向量，不然引擎那邊 setFromUnitVectors 會歪掉
        Math.abs(Math.hypot(p.dx, p.dy, p.dz) - 1) < 1e-6 ? aligned++ : off++;
      }
      maxLine = Math.max(maxLine, lines);
    }
    /* 引擎那顆 InstancedMesh 也要畫得下：塞 900 條進去，看 count 停在哪。
       停在 320（v1.57 的 MAXFIRE）的話，一場齊射有一半根本沒畫出來。 */
    const meshes = [];
    ENG.three.scene.traverse(o => { if (o.isInstancedMesh) meshes.push(o); });
    const was = meshes.map(o => o.count);
    const fake = [];
    for (let i = 0; i < 900; i++)
      fake.push({ x: 0, y: 500, z: 0, s: 0.01, rx: 0, ry: 0, cr: 1, cg: 1, cb: 1 });
    ENG.putFire(fake);
    const drawable = Math.max(...meshes.map((o, i) => o.count !== was[i] ? o.count : 0));
    ENG.putFire(hot);                                  // 收回去，別把假粒子留在畫面上
    return { maxSp, maxDraw, maxLine, aligned, off, dirBad, headBad, n,
             minLn: +minLn.toFixed(2), maxLn: +maxLn.toFixed(2), drawable,
             tail: FW_TAIL, cap: FW_TAIL_MAX };
  });
  ok('一場齊射的每一顆火星都有自己的一條拖線',
     fwDense.maxSp > 200 && fwDense.maxLine > 200 && fwDense.off === 0,
     '最多 ' + fwDense.maxSp + ' 顆火星、同時 ' + fwDense.maxLine + ' 條線，' +
     '線長 ' + fwDense.minLn + '～' + fwDense.maxLn + '（上限 ' + fwDense.cap + '）');
  ok('每條線都順著那顆火星飛的方向，線頭就在火星身上',
     fwDense.n > 0 && fwDense.dirBad === 0 && fwDense.headBad === 0,
     '量了 ' + fwDense.n + ' 條，方向錯 ' + fwDense.dirBad + '、線頭錯 ' + fwDense.headBad);
  ok('引擎畫得下整場齊射的火星', fwDense.drawable >= fwDense.maxDraw && fwDense.drawable >= 900,
     '一次畫得下 ' + fwDense.drawable + ' 顆（齊射最多送 ' + fwDense.maxDraw + ' 顆）');

  /* 一發的內容：外層一大球 + 芯一小球（換個顏色、速度只有一半），
     再加上幾顆飛到一半自己再炸開的。只放一發（不走齊射）才數得清楚。 */
  const fwLayer = await page.evaluate(() => {
    startBuild(true); completeNow(); clearFires();
    fworks = null; fwSparks = null; fwWait = null;
    fireShell(0, 0);
    const f = fworks[0], twoCol = f.c !== f.c2;
    while (fworks) step(0.05);                        // 竄到頂、炸開
    const cols = new Set(fwSparks.map(s => s.c)).size;
    const n0 = fwSparks.length;
    const crackers = fwSparks.filter(s => s.crack > 0).length;
    // 芯那球比較慢：兩群的平均速度要差得出來
    const sp = c => { const g = fwSparks.filter(s => s.c === c);
                      return g.reduce((a, s) => a + Math.hypot(s.vx, s.vy, s.vz), 0) / g.length; };
    const outer = +sp(f.c).toFixed(1), core = +sp(f.c2).toFixed(1);
    let peak = n0;
    for (let i = 0; i < 30 && fwSparks; i++) { step(0.05); peak = Math.max(peak, fwSparks.length); }
    return { twoCol, cols, n0, crackers, peak, outer, core,
             want: FW_SPARK + FW_CORE, crack: FW_CRACK, crackN: FW_CRACK_N };
  });
  ok('一發是雙層的花：外層一個顏色，芯另一個顏色又慢一半',
     fwLayer.twoCol && fwLayer.cols === 2 && fwLayer.n0 === fwLayer.want &&
     fwLayer.core < fwLayer.outer * 0.6,
     fwLayer.n0 + ' 顆分成兩色，平均速度 外層 ' + fwLayer.outer + '／芯 ' + fwLayer.core);
  ok('有幾顆火星會二次炸開',
     fwLayer.crackers === fwLayer.crack && fwLayer.peak >= fwLayer.n0 + fwLayer.crack * 2,
     fwLayer.crackers + ' 顆帶二次炸開（各炸 ' + fwLayer.crackN + ' 顆），火星數從 ' +
     fwLayer.n0 + ' 漲到 ' + fwLayer.peak);

  /* 放完把視線高度還回去（v1.123，使用者：「如果是會讓鏡頭往高的方向調整的運鏡
     結束後高度要調回來（煙火一起調整）」）。改之前量到：羅馬競技場的取景視線高 0，
     放一發煙火變成 29，然後就停在那裡——收工之後鏡頭一直仰著看天空。
     三件事一起驗：
     ① 期間抬起來、放完還回去，而**視距留著**（退遠了本來就看得到全景，
        會把建築推出畫面的是仰角；而且視距是玩家滾輪在管的）。
     ② 連放兩輪不會被第一輪放完就壓回去（所以是計數不是旗標）。
     ③ 玩家自己按 Z／X 抬得比我們更高的話就不要動它——那是他的視角。 */
  const fwCam = await page.evaluate(() => {
    const run = fn => {
      cleanTools();
      shapePick = SHAPES.findIndex(s => s.n === '羅馬競技場');
      targetCnt = 2000; startBuild(true); completeNow(); shapePick = -1;
      for (let i = 0; i < 20; i++) step(0.05);
      return fn();
    };
    const wait = () => { let g = 0; while ((fworks || fwSparks || fwWait) && g++ < 900) step(0.05); };
    const one = run(() => {
      const ty0 = ENG.camTarget.ty, d0 = ENG.camTarget.dist;
      launchFw({ x: 0, z: 0 });
      const tyUp = ENG.camTarget.ty, dUp = ENG.camTarget.dist;
      wait(); step(0.05);
      return { ty0: +ty0.toFixed(1), tyUp: +tyUp.toFixed(1), ty1: +ENG.camTarget.ty.toFixed(1),
               d0: +d0.toFixed(1), dUp: +dUp.toFixed(1), d1: +ENG.camTarget.dist.toFixed(1) };
    });
    // 第二輪在第一輪還沒放完時點下去：第一輪收工不能把鏡頭壓回去
    const two = run(() => {
      const ty0 = ENG.camTarget.ty;
      launchFw({ x: 0, z: 0 });
      for (let i = 0; i < 30; i++) step(0.05);        // 1.5 秒後再點一次
      launchFw({ x: 8, z: 8 });
      /* 只在「還有東西在天上」的時候取樣：最後一幀本來就已經還回去了，
         把它算進去的話量到的一定是還原後的高度（第一版就是這樣自己絆倒的）。 */
      let mid = 1e9, g = 0;
      while ((fworks || fwSparks || fwWait) && g++ < 900) {
        step(0.05);
        if (!(fworks || fwSparks || fwWait)) break;
        mid = Math.min(mid, ENG.camTarget.ty);
      }
      step(0.05);
      return { ty0: +ty0.toFixed(1), mid: +mid.toFixed(1), ty1: +ENG.camTarget.ty.toFixed(1) };
    });
    // 玩家自己把視線抬得更高
    const mine = run(() => {
      launchFw({ x: 0, z: 0 });
      ENG.camTarget.ty += 12;                          // 等同按著 X 往上抬
      const want = ENG.camTarget.ty;
      wait(); step(0.05);
      return { want: +want.toFixed(1), ty1: +ENG.camTarget.ty.toFixed(1) };
    });
    cleanTools();
    return { one, two, mine };
  });
  ok('煙火期間鏡頭抬起來，放完就把高度還回去',
     fwCam.one.tyUp > fwCam.one.ty0 + 10 && Math.abs(fwCam.one.ty1 - fwCam.one.ty0) < 0.1,
     '視線高 ' + fwCam.one.ty0 + ' → ' + fwCam.one.tyUp + ' → ' + fwCam.one.ty1);
  ok('視距留在退開的位置，還回去的只有高度',
     fwCam.one.dUp > fwCam.one.d0 + 5 && fwCam.one.d1 === fwCam.one.dUp,
     '視距 ' + fwCam.one.d0 + ' → ' + fwCam.one.dUp + ' → ' + fwCam.one.d1);
  ok('連放兩輪不會被第一輪放完就壓回去',
     fwCam.two.mid > fwCam.two.ty0 + 10 && Math.abs(fwCam.two.ty1 - fwCam.two.ty0) < 0.1,
     '兩輪都在場時視線高最低只到 ' + fwCam.two.mid + '，全放完才回到 ' + fwCam.two.ty1);
  ok('玩家自己抬高的視線不會被還回去',
     Math.abs(fwCam.mine.ty1 - fwCam.mine.want) < 0.1,
     '自己抬到 ' + fwCam.mine.want + '，放完仍是 ' + fwCam.mine.ty1);

  /* 點在建築上就從那一點射上去（v1.137，使用者：「如果點擊在建築上 則從建築位置發射煙火」）。
     三件事一起驗：出膛高度跟著點到的那一點、**炸開的高度是相對的**、取景也跟著抬。
     中間那件最要緊——`top` 本來是寫死的絕對高度（FW_TOP 42 上下），從台北 101 的屋頂
     （65）射上去的話「還沒竄就已經超過 42」，當場在腳邊炸開。 */
  const fwOnTop = await page.evaluate(() => {
    cleanTools(); clearFires();
    shapePick = SHAPES.findIndex(s => s.n === '台北 101');
    targetCnt = 3000; startBuild(true); completeNow(); shapePick = -1;
    for (let i = 0; i < 20; i++) step(0.05);
    // 最高的那一塊：拿它當「點在建築上」的落點
    let top = null;
    for (const b of blocks) if (b.st === 3 && (!top || b.y > top.y)) top = b;
    const one = hit => {
      fworks = null; fwWait = null; fwSparks = null; fwEnd();
      const ty0 = ENG.camTarget.ty;
      /* 三發的出膛高度都要看（齊射的後兩發是排在 fwWait 裡的），所以攔 fireShell。 */
      const oShell = fireShell, born = [];
      fireShell = (x, z, y) => {
        oShell(x, z, y);
        const f = fworks[fworks.length - 1];
        born.push({ y: +f.y.toFixed(2), rise: +(f.top - f.y).toFixed(1) });
      };
      tool = 'fw';
      useTool(hit);
      let g = 0;
      while ((fwWait || fworks) && g++ < 400) step(1 / 60);   // 等三發都出膛、炸完
      fireShell = oShell;
      const r = { born, ty0: +ty0.toFixed(1), ty: +ENG.camTarget.ty.toFixed(1) };
      let n = 0;
      while ((fwSparks || fworks || fwWait) && n++ < 600) step(1 / 60);
      r.back = +ENG.camTarget.ty.toFixed(1);                  // 放完要還回去
      return r;
    };
    const P = { x: top.x, y: top.y + 0.5, z: top.z };
    const hi = one({ kind: 'block', idx: -1, dist: 20,
                     point: new THREE.Vector3(P.x, P.y, P.z),
                     dir: new THREE.Vector3(0, -0.3, -1).normalize() });
    const lo = one({ kind: 'ground', dist: 20,
                     point: new THREE.Vector3(40, 0, 0),
                     dir: new THREE.Vector3(0, -1, 0) });
    cleanTools(); clearFires();
    return { hi, lo, at: +P.y.toFixed(1), y0: FW_Y0, fwTop: FW_TOP, shot: FW_SHOT };
  });
  ok('點在建築上：三發都從那一點射上去，不是從地面',
     fwOnTop.hi.born.length === fwOnTop.shot &&
     fwOnTop.hi.born.every(b => Math.abs(b.y - (fwOnTop.at + fwOnTop.y0)) < 1) &&
     fwOnTop.lo.born.every(b => Math.abs(b.y - fwOnTop.y0) < 0.01),
     '點在台北 101 最高那一塊（y=' + fwOnTop.at + '）：三發出膛高度 ' +
     fwOnTop.hi.born.map(b => b.y).join('／') + '（地面出膛是 ' + fwOnTop.y0 +
     '）；點地面那一發 ' + fwOnTop.lo.born.map(b => b.y).join('／'));
  ok('炸開的高度是「再竄多高」，不是寫死的絕對高度',
     fwOnTop.hi.born.every(b => b.rise > fwOnTop.fwTop * 0.75 && b.rise < fwOnTop.fwTop * 1.25) &&
     fwOnTop.lo.born.every(b => b.rise > fwOnTop.fwTop * 0.75),
     '從 ' + fwOnTop.at + ' 射上去，三發各再竄 ' + fwOnTop.hi.born.map(b => b.rise).join('／') +
     '（設定 ' + fwOnTop.fwTop + ' ±20%）；從地面那一發竄 ' +
     fwOnTop.lo.born.map(b => b.rise).join('／'));
  ok('取景跟著出膛高度抬，放完照樣還回去',
     fwOnTop.hi.ty > fwOnTop.lo.ty + 20 && fwOnTop.hi.back === fwOnTop.hi.ty0 &&
     fwOnTop.lo.back === fwOnTop.lo.ty0,
     '點屋頂視線高抬到 ' + fwOnTop.hi.ty + '、點地面抬到 ' + fwOnTop.lo.ty +
     '；放完各自回到 ' + fwOnTop.hi.back + '／' + fwOnTop.lo.back);

  /* 天降鐵球**完全不動鏡頭**（v1.123 查證）。使用者把「結束後高度要調回來」寫在
     天降鐵球底下，但量過它從頭到尾沒碰過 camTarget：球掉得快，進畫面只差那一瞬間，
     所以當初就沒有像烏雲那樣退鏡頭（見 game-tools.js 的 DROP_TOP 那一段）。
     這一條把那件事釘住——哪天它真的加了運鏡，就要一起決定收不收。 */
  const dropCam = await page.evaluate(() => {
    cleanTools();
    shapePick = SHAPES.findIndex(s => s.n === '羅馬競技場');
    targetCnt = 2000; startBuild(true); completeNow(); shapePick = -1;
    for (let i = 0; i < 20; i++) step(0.05);
    const ty0 = ENG.camTarget.ty, d0 = ENG.camTarget.dist;
    dropBall({ x: 0, z: 0 });
    let peak = ty0, g = 0;
    while (balls && g++ < 400) { step(0.05); peak = Math.max(peak, ENG.camTarget.ty); }
    const r = { ty0: +ty0.toFixed(1), peak: +peak.toFixed(1), d0: +d0.toFixed(1),
                ty1: +ENG.camTarget.ty.toFixed(1), d1: +ENG.camTarget.dist.toFixed(1) };
    cleanTools();
    return r;
  });
  ok('天降鐵球從頭到尾不動鏡頭（所以也沒有高度要還）',
     dropCam.peak === dropCam.ty0 && dropCam.ty1 === dropCam.ty0 && dropCam.d1 === dropCam.d0,
     '視線高 ' + dropCam.ty0 + '（整段最高 ' + dropCam.peak + '）、視距 ' +
     dropCam.d0 + ' → ' + dropCam.d1);

  /* ── 火星點得著人與動物（v1.159.0，使用者：「煙火調整 火星對小人動物等生效」）──
     直接叫 fwBurn 而不是放一發煙火等它燒到誰：火星的落點本來就是隨機的，
     「放一發、等它剛好燒到那個人」就是這一版在修的那種偶爾飄。
     stepFw 真的每一顆火星都會叫它，由〈每一支破壞道具的傷害都經過認得動物的那幾支〉
     那條守著（量到 fw 29240 次）。 */
  const fwHit = await page.evaluate(() => {
    cleanTools(); clearFires(); beasts = null;
    for (const w of workers) { w.air = 0; w.fall = 0; w.burn = 0; w.wet = 0; w.lit = 0; }
    const w = workers[0];
    w.x = 40; w.z = 0; w.y = 0;
    const m = spawnBeast('ape', 1);
    m.x = 40; m.z = 12; m.y = 0; m.st = 'fun'; m.stay = 999;
    m.burn = 0; m.wet = 0; m.air = 0; m.fall = 0;
    /* 打滾旗標兩邊叫法不同：小人是 w.roll、動物是 m.brl（見〈猴子那兩隻整套借小人的〉
       那張對照表）。兩個都要是 0 ＝「站著被點著」。 */
    const manHi = fwBurn(w.x, 1.0, w.z);              // 打在胸口：燒起來
    const manRoll = w.roll;
    const manBurn = w.burn;
    const beastHit = fwBurn(m.x, 0.4, m.z);
    const beastBurn = m.burn, beastRoll = m.brl;
    /* 打不到的兩種：離身體太遠、以及高過頭頂（火星從上面飄過去不該算）。
       另外**濕的點不著，而且那一顆火星不算用掉**（回 false）——同積木那條。 */
    const far = fwBurn(w.x + 3, 1.0, w.z);
    const w2 = workers[1];
    w2.x = 40; w2.z = -12; w2.y = 0; w2.burn = 0; w2.air = 0; w2.fall = 0;
    const over = fwBurn(w2.x, 4.5, w2.z);
    wetWorker(w2);
    const wet = fwBurn(w2.x, 1.0, w2.z);
    return { manHi, manBurn: +manBurn.toFixed(2), manRoll, beastHit,
             beastBurn: +beastBurn.toFixed(2), beastRoll, far, over, wet,
             wetLeft: +w2.wet.toFixed(1), w2burn: w2.burn };
  });
  ok('煙火的火星點得著小人與動物（站著被點著那一種，不是就地打滾）',
     fwHit.manHi && fwHit.manBurn > 0 && !fwHit.manRoll &&
     fwHit.beastHit && fwHit.beastBurn > 0 && !fwHit.beastRoll,
     '小人燒 ' + fwHit.manBurn + ' 秒（打滾旗標 ' + fwHit.manRoll +
     '）、猴子燒 ' + fwHit.beastBurn + ' 秒（打滾旗標 ' + fwHit.beastRoll + '）');
  ok('火星打不到的三種都回 false（太遠、高過頭頂、剛淋濕的）',
     !fwHit.far && !fwHit.over && !fwHit.wet && fwHit.wetLeft > 0 && fwHit.w2burn === 0,
     '離 3 格 ' + fwHit.far + '、高 4.5 格 ' + fwHit.over + '、濕 ' +
     fwHit.wetLeft + ' 秒那個 ' + fwHit.wet + '（沒燒起來＝' + (fwHit.w2burn === 0) + '）');

  /* ══════════ 小人也會被拆除工具波及 ══════════
     邏輯跟碎料同一套：吹飛／推走／炸飛走彈道，落地那一刻才判定要不要燒起來。
     每個案例都自己把人擺到定位再動手——照原本的分布，人多半在遠處撿貨，
     量到的會是「沒打到」而不是「打到了沒反應」。 */
  await head('小人被工具波及');
  await reset(page, { shape: '新天鵝堡', cnt: 900, workers: 20 });
  // 把人排在工地上，炸點就在他們中間
  const blown = await page.evaluate(() => {
    completeNow();
    workers.forEach((w, i) => {
      const a = i / workers.length * Math.PI * 2;
      w.x = Math.cos(a) * rr(3, 9); w.z = Math.sin(a) * rr(3, 9);
      w.y = 0; w.air = 0; w.burn = 0; w.fall = 0;
    });
    const p0 = workers.map(w => ({ x: w.x, z: w.z }));
    explode({ x: 0, y: 2, z: 0 }, 14, 17, false);
    const hit = { air: workers.filter(w => w.air).length, n: workers.length,
                  fall: workers.filter(w => w.fall > 0).length };
    let peak = 0, t = 0;
    while (workers.some(w => w.air) && t < 6) {
      step(0.05); t += 0.05;
      peak = Math.max(peak, ...workers.map(w => w.y));
    }
    const land = {
      t: +t.toFixed(2), peak: +peak.toFixed(1),
      burn: workers.filter(w => w.burn > 0).length,
      roll: workers.filter(w => w.roll).length,
      moved: +(workers.reduce((s, w, i) => s + Math.hypot(w.x - p0[i].x, w.z - p0[i].z), 0) / workers.length).toFixed(1),
      out: workers.filter(w => Math.max(Math.abs(w.x), Math.abs(w.z)) > arenaR + 22.5).length,
      busy: workers.filter(w => w.load.length || w.carry).length
    };
    // 燒的中途看一眼：身上要有火、要在翻滾、不能回去工作
    for (let i = 0; i < 20; i++) step(0.05);
    const mid = { burn: workers.filter(w => w.burn > 0).length,
                  k: +Math.max(...workers.map(w => w.burnK)).toFixed(2),
                  busy: workers.filter(w => w.load.length || w.carry).length,
                  hotNear: hot.filter(h => workers.some(w => Math.hypot(h.x - w.x, h.z - w.z) < 1.2)).length };
    for (let i = 0; i < 50; i++) step(0.05);            // 湊滿 3 秒＋
    const done = { burn: workers.filter(w => w.burn > 0).length,
                   y: +Math.max(...workers.map(w => w.y)).toFixed(2),
                   tilt: +Math.max(...workers.map(w => Math.abs(w.tilt))).toFixed(2),
                   k: +Math.max(...workers.map(w => w.burnK)).toFixed(2) };
    for (let i = 0; i < 60; i++) step(0.05);
    done.k2 = +Math.max(...workers.map(w => w.burnK)).toFixed(3);
    done.walking = workers.filter(w => w.gait > 0.1).length;
    return { hit, land, mid, done };
  });
  ok('爆炸會把小人炸飛，不是只有原地跌倒',
     blown.hit.air === blown.hit.n && blown.land.peak > 2 && blown.land.moved > 4,
     blown.hit.air + '/' + blown.hit.n + ' 人飛起來，最高 ' + blown.land.peak +
     '、平均被轟出 ' + blown.land.moved + ' 單位，滯空 ' + blown.land.t + ' 秒');
  ok('炸飛的人落地就燒起來，而且是就地打滾',
     blown.land.burn === blown.hit.n && blown.land.roll === blown.hit.n,
     blown.land.burn + ' 人著火，其中 ' + blown.land.roll + ' 人是打滾（站著被點的才跑圈圈）');
  ok('燒起來的人身上有火、身體會燒黑',
     blown.mid.hotNear > 20 && blown.mid.k > 0.5,
     '小人身上 ' + blown.mid.hotNear + ' 顆火苗，焦黑深度 ' + blown.mid.k);
  ok('燒的時候不會回去搬積木',
     blown.land.busy === 0 && blown.mid.busy === 0,
     '飛出去當下 ' + blown.land.busy + ' 人、燒到一半 ' + blown.mid.busy + ' 人還握著工作');
  ok('燒滿三秒站起來，顏色也褪回原色',
     blown.done.burn === 0 && blown.done.y === 0 && blown.done.tilt === 0 &&
     blown.done.k2 < 0.02 && blown.done.walking > 0,
     '3 秒後躺著的 ' + blown.done.burn + ' 人、傾角 ' + blown.done.tilt +
     '，焦黑 ' + blown.done.k + ' → ' + blown.done.k2 + '，走動中 ' + blown.done.walking + ' 人');
  ok('炸得再遠也不會被轟出草地', blown.land.out === 0,
     '越界 ' + blown.land.out + ' 人（邊界＝工地半徑 + 22）');

  /* 高處那一發打不到地面的人與吉祥物（v1.147，使用者：「炸彈炸在屋頂、槌子砸在高處，
     下面的人不被震倒」）。以前震倒（afterHit）與吹飛（explode 那個迴圈）都只取水平距離，
     所以定時炸彈炸在台北 101 的屋頂（65 高）時，地面那一圈八個人全部被炸飛、還被點著。
     交叉案例：同一發、同一圈人、同一座建築，只差衝擊點的高度。 */
  const high = await page.evaluate(() => {
    const put = () => {
      cleanTools();
      shapePick = SHAPES.findIndex(s => s.n === '台北 101');
      targetCnt = 3000; startBuild(true); completeNow(); shapePick = -1;
      /* 站在水平 5（v1.165 從 8 收進來）：小槌的半徑 v1.165 從 5.5 縮到 3.6，
         震倒範圍跟著 9.35 → 6.12（afterHit 是 R × 1.7）——站 8 的話「砸地面那一發
         照舊全掀」這條對照組本來就構不到人，測到的會是新半徑，不是高度差。
         炸彈那一組不受影響：半徑 11、震倒 18.7，5 跟 8 都在裡面。 */
      const ws = workers.slice(0, 8);
      ws.forEach((w, i) => {
        const a = i / 8 * Math.PI * 2;
        w.x = 5 * Math.cos(a); w.z = 5 * Math.sin(a); w.y = 0;
        w.air = 0; w.burn = 0; w.fall = 0; w.lit = 0; w.roll = 0;
      });
      beasts = null;
      const m = spawnBeast('ape', 1);
      m.x = 4; m.z = 0; m.y = 0; m.st = 'fun'; m.stay = 999; m.fall = 0;
      return { ws, m };
    };
    const hurt = s => ({ fall: s.ws.filter(w => w.fall > 0).length,
                         air: s.ws.filter(w => w.air).length,
                         beast: (s.m.fall > 0 || s.m.air) ? 1 : 0 });
    let s = put();
    const roof = bp.height;
    explode({ x: 0, y: roof, z: 0 }, BOMB_R, BOMB_POW);
    const bombHigh = hurt(s);
    s = put(); explode({ x: 0, y: 1, z: 0 }, BOMB_R, BOMB_POW);
    const bombLow = hurt(s);
    s = put(); smash({ x: 0, y: 30, z: 0 }, { x: 0, y: -1, z: 0 }, hammerR, hammerPow);
    const hamHigh = hurt(s);
    s = put(); smash({ x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 }, hammerR, hammerPow);
    const hamLow = hurt(s);
    cleanTools(); beasts = null;
    return { roof: +roof.toFixed(1), bombHigh, bombLow, hamHigh, hamLow };
  });
  ok('炸在屋頂、砸在高處，地面的人與吉祥物都不受影響',
     high.bombHigh.fall + high.bombHigh.air + high.bombHigh.beast === 0 &&
     high.hamHigh.fall + high.hamHigh.air + high.hamHigh.beast === 0,
     '炸彈炸在 ' + high.roof + ' 高的屋頂：倒 ' + high.bombHigh.fall + '、飛 ' +
     high.bombHigh.air + '、吉祥物 ' + high.bombHigh.beast + '；槌子砸 30 高：倒 ' +
     high.hamHigh.fall + '、飛 ' + high.hamHigh.air + '、吉祥物 ' + high.hamHigh.beast +
     '（八個人站在水平 5，炸彈半徑 11、震倒 18.7；小槌半徑 3.6、震倒 6.1）');
  ok('同一發打在地面照舊全掀（上面那條不是「本來就打不到」）',
     high.bombLow.air === 8 && high.bombLow.beast === 1 &&
     high.hamLow.fall === 8 && high.hamLow.beast === 1,
     '炸彈炸在地面：飛 ' + high.bombLow.air + '/8 人、吉祥物 ' + high.bombLow.beast +
     '；槌子砸地面：倒 ' + high.hamLow.fall + '/8 人、吉祥物 ' + high.hamLow.beast);

  /* 天降鐵球要落地那一刻才掀人（v1.147，使用者回報：「天降鐵球落下前 小人&吉祥物
     就先倒下」）。吉祥物那一段是 v1.146 漏的：它走 eachBeastNear，而那支對走地上的
     算水平距離，所以球一出手、正下方那隻就被掀了。
     這一條把球丟在工地外的空地上（沿路沒有積木可撞，落點不會被彈歪），量的是
     「第一個被打到的那一刻，球在多高」。門檻 8：震倒半徑是 (r+0.7)×1.7 ＝ 6.46，
     加上胸口 0.9 就是 7.4，再加一幀的落差（0.05 秒掉 1.9）——超過 8 就一定是提早。
     對照組把 eachBeastNear 強制走舊規則（水平距離），量完就換回來。 */
  const dropEarly = await page.evaluate(() => {
    const run = () => {
      cleanTools();
      shapePick = SHAPES.findIndex(s => s.n === '台北 101');
      targetCnt = 3000; startBuild(true); completeNow(); shapePick = -1;
      const ws = workers.slice(0, 6);
      ws.forEach((w, i) => {
        const a = i / 6 * Math.PI * 2;
        w.x = 45 + 3 * Math.cos(a); w.z = 3 * Math.sin(a); w.y = 0;
        w.air = 0; w.burn = 0; w.fall = 0; w.lit = 0; w.roll = 0;
      });
      beasts = null; balls = null;
      const m = spawnBeast('ape', 1);
      m.x = 46.3; m.z = 0.7; m.y = 0; m.st = 'fun'; m.stay = 999; m.fall = 0;
      dropBall({ x: 45, y: 0, z: 0 });
      const top = balls[0].y;
      const pin = ws.map(w => [w.x, w.z]);
      let fw = 0, fb = 0, land = 0, g = 0;
      while (balls && g++ < 400) {
        const y0 = balls[0].y;
        /* 每幀釘回原位：完工慶祝中他們會走開，吉祥物也會自己去晃 */
        ws.forEach((w, i) => { if (!w.air && w.fall <= 0) { w.x = pin[i][0]; w.z = pin[i][1]; } });
        if (!m.air && m.fall <= 0) { m.x = 46.3; m.z = 0.7; }
        step(0.05);
        if (!fw && ws.some(w => w.air || w.fall > 0)) fw = y0;
        if (!fb && (m.air || m.fall > 0)) fb = y0;
        if (!land && balls && balls[0].y <= balls[0].r + 0.01) land = g;
      }
      return { top: +top.toFixed(1), fw: +fw.toFixed(1), fb: +fb.toFixed(1), land };
    };
    const now = run();
    const orig = eachBeastNear;
    eachBeastNear = (p, R, cb) => orig(p, R, cb, true);      // 舊規則：只算水平距離
    const was = run();
    eachBeastNear = orig;
    cleanTools(); beasts = null;
    return { now, was };
  });
  ok('天降鐵球落地那一刻才掀人與吉祥物，不是落下前就先倒',
     dropEarly.now.fw > 0 && dropEarly.now.fw < 8 &&
     dropEarly.now.fb > 0 && dropEarly.now.fb < 8,
     '球從 ' + dropEarly.now.top + ' 掉下來：小人在球 ' + dropEarly.now.fw +
     ' 高時被掀、吉祥物在 ' + dropEarly.now.fb + ' 高（第 ' + dropEarly.now.land +
     ' 幀落地）；走舊規則的話吉祥物在 ' + dropEarly.was.fb + ' 高就倒了');
  ok('對照組：舊規則下吉祥物早在球出手那一刻就倒（所以上面那條有在守東西）',
     dropEarly.was.fb > 40 && dropEarly.was.fw === dropEarly.now.fw,
     '舊規則：吉祥物 ' + dropEarly.was.fb + ' 高就倒（小人 ' + dropEarly.was.fw +
     ' 高，跟修好後一樣——小人那段本來就算高度）');


  /* 「停、躺、滾」：人是躺平之後**沿著身體長軸**滾（像滾木頭），不是頭上腳下翻筋斗。
     兩個轉軸都要驗，兩個都踩過雷：
     - 繞小人的原點（腳底）轉 → 傾角一過水平整個人插進地面下，最低到 y=-1.3，
       畫面上是「倒下去→消失→從另一邊冒出來」。要繞身體中段。
     - 繞身體的左右軸轉 → 那是翻筋斗，頭一下在上一下在下。要繞長軸。
     量法：讀 InstancedMesh 裡各部位的世界座標。 */
  const rollPose = await page.evaluate(() => {
    startBuild(true); completeNow();
    const w = workers[0];
    w.x = 0; w.z = 0; w.y = 0; w.a = 0; w.gait = 0; w.carry = false;
    w.plan = 0; w.bub = 0; w.scale = 1.2; w.roll = 0; w.tilt = 0; w.rspin = 0; w.dig = 0;
    const m = new THREE.Matrix4(), v = new THREE.Vector3();
    const pos = k => { ENG.three.workerMesh.getMatrixAt(k, m); v.setFromMatrixPosition(m); return v.clone(); };
    const read = () => {
      ENG.putWorker(0, w);
      let lo = 1e9, hi = -1e9;
      for (let k = 0; k < ENG.WPARTS; k++) {
        ENG.three.workerMesh.getMatrixAt(k, m);
        v.setFromMatrixPosition(m);
        // 道具（藍圖、泡泡）沒拿的時候縮成 0，位置沒意義，跳過
        if (m.elements[0] === 0 && m.elements[5] === 0) continue;
        if (v.y < lo) lo = v.y;
        if (v.y > hi) hi = v.y;
      }
      return { lo: +lo.toFixed(2), hi: +hi.toFixed(2), head: pos(1), leg: pos(3) };
    };
    const stand = read();                               // 站著（沒在打滾）當基準
    w.roll = 1; w.tilt = Math.PI * 0.5;                 // 躺平
    const poses = [];
    for (let i = 0; i < 12; i++) { w.rspin = i / 12 * Math.PI * 2; poses.push(read()); }
    w.roll = 1; w.tilt = 0; w.rspin = 0;
    const up = read();                                  // 打滾旗標開著、但還沒躺下
    w.roll = 0;
    const hy = poses.map(p => p.head.y);
    // 沿長軸滾的話頭一直在同一邊（車頭方向 a=0 → +Z），翻筋斗的話會前後甩
    const hz = poses.map(p => p.head.z), lz = poses.map(p => p.leg.z);
    return { stand: { lo: stand.lo, hi: stand.hi }, up: { lo: up.lo, hi: up.hi },
             flat: { lo: poses[0].lo, hi: Math.max(...poses.map(p => p.hi)) },
             lo: Math.min(...poses.map(p => p.lo)),
             headY: [+Math.min(...hy).toFixed(2), +Math.max(...hy).toFixed(2)],
             aheadMin: +Math.min(...hz.map((z, i) => z - lz[i])).toFixed(2) };
  });
  ok('打滾時整個人都在地面上，不會轉到地底下', rollPose.lo > -0.3,
     '滾一圈，最低的部位在 y=' + rollPose.lo + '（繞腳底轉的話會到 -1.3）');
  ok('打滾的樞紐不影響站姿',
     rollPose.up.lo === rollPose.stand.lo && rollPose.up.hi === rollPose.stand.hi,
     '站著 y=' + rollPose.stand.lo + '～' + rollPose.stand.hi +
     '，打滾旗標開著但還沒躺下時 y=' + rollPose.up.lo + '～' + rollPose.up.hi);
  ok('打滾時是躺在草地上，不是站著也不是浮著',
     rollPose.flat.hi < rollPose.stand.hi * 0.55 && rollPose.flat.lo > -0.3,
     '躺著時最高的部位只到 y=' + rollPose.flat.hi + '（站著是 ' + rollPose.stand.hi + '）');
  /* 滾木頭：頭全程貼著地面同一個高度、而且一直在腿的前方。
     翻筋斗的話頭會從 1.4 掃到 0、也會轉到腿的後面去。 */
  ok('滾的是身體長軸，不是頭上腳下翻筋斗',
     rollPose.headY[1] - rollPose.headY[0] < 0.05 && rollPose.headY[1] < 0.6 &&
     rollPose.aheadMin > 0.4,
     '滾一圈頭的高度 ' + rollPose.headY[0] + '～' + rollPose.headY[1] +
     '，頭一直在腿前方至少 ' + rollPose.aheadMin + ' 單位');

  /* 滅火是**來回**翻壓熄身上的火，不是往同一邊一直滾——一直滾同一邊的話人會一路
     平移出去，在草地上遠航。而且沿長軸滾是往**旁邊**移動，轉多少就該走多少
     （半徑 × 這一幀的轉角），不然看起來是一邊轉一邊在冰上滑。 */
  const rollMove = await page.evaluate(() => {
    startBuild(true); completeNow();
    const w = workers[0];
    w.x = 0; w.z = 0; w.y = 0; w.a = 0; w.air = 0; w.fall = 0; w.burn = 0;
    igniteWorker(w, true);
    let prev = w.rspin, px = w.x, pz = w.z;
    let up = 0, dn = 0, slip = 0, fwdMax = 0;
    const sp = [];
    for (let i = 0; i < 60; i++) {
      step(0.05);
      const d = w.rspin - prev;
      if (d > 1e-6) up++; else if (d < -1e-6) dn++;
      const dx = w.x - px, dz = w.z - pz;
      // 這一幀的位移該是「轉角 × 滾動半徑」，方向是側向
      const side = dx * Math.cos(w.a) - dz * Math.sin(w.a);
      const fwd = dx * Math.sin(w.a) + dz * Math.cos(w.a);
      if (Math.abs(fwd) > fwdMax) fwdMax = Math.abs(fwd);
      const err = Math.abs(-side - d * 0.28);
      if (err > slip) slip = err;
      sp.push(w.rspin); prev = w.rspin; px = w.x; pz = w.z;
    }
    return { up, dn, lo: +Math.min(...sp).toFixed(2), hi: +Math.max(...sp).toFixed(2),
             drift: +Math.hypot(w.x, w.z).toFixed(2),
             slip: +slip.toFixed(4), fwdMax: +fwdMax.toFixed(4) };
  });
  ok('是來回翻滾，不是往同一邊一直滾',
     rollMove.up > 10 && rollMove.dn > 10 &&
     rollMove.lo < -1.5 && rollMove.hi > 1.5 && rollMove.drift < 2,
     '三秒內往兩邊各滾了 ' + rollMove.up + '／' + rollMove.dn + ' 幀，角度在 ' +
     rollMove.lo + '～' + rollMove.hi + ' rad 之間來回，人只挪了 ' + rollMove.drift + ' 單位');
  ok('滾的方向是身體側向，而且轉多少就走多少（不打滑）',
     rollMove.slip < 0.002 && rollMove.fwdMax < 0.002,
     '每一幀「位移 vs 轉角×0.28」最大差 ' + rollMove.slip +
     '，正前方的位移最大 ' + rollMove.fwdMax);

  /* 龍捲風：吃的是跟碎料同一組力（切線繞圈＋往內吸＋往上捲），所以人也會被捲上天 */
  const twisted = await page.evaluate(() => {
    startBuild(true); completeNow();
    workers.forEach((w, i) => {
      const a = i / workers.length * Math.PI * 2;
      w.x = Math.cos(a) * rr(2, 7); w.z = Math.sin(a) * rr(2, 7);
      w.y = 0; w.air = 0; w.burn = 0; w.fall = 0;
    });
    launchTornado({ x: 0, z: 0 });
    let peak = 0, air = 0;
    for (let i = 0; i < 120; i++) {
      step(0.05);
      peak = Math.max(peak, ...workers.map(w => w.y));
      air = Math.max(air, workers.filter(w => w.air).length);
    }
    /* 收掉自己召出來的那道（v1.151.1）：漏斗活 10 秒，這裡只跑 6 秒——
       剩下那 4 秒會漏進下面兩條，而它們把人排在自己指定的位置上，
       正好會被路過的漏斗掃走。v1.151 速度乘 2 之後漏得更遠，下面那條
       〈抱頭跑圈圈〉當場紅了（2.8 秒跑了 55 單位、離原地 27.8，而門檻是 6）；
       保齡球那條也早就在量錯東西——20 個人全被「撞飛」40.8 單位，那不是球做的。 */
    twists = null; ENG.putTornados([]);
    return { peak: +peak.toFixed(1), air, burn: workers.filter(w => w.burn > 0).length };
  });
  ok('龍捲風會把小人一起捲上天', twisted.air > 0 && twisted.peak > 15,
     '最多 ' + twisted.air + ' 人在空中，最高被捲到 ' + twisted.peak);
  ok('龍捲風不會點火，人落地只是摔一跤', twisted.burn === 0,
     '著火 ' + twisted.burn + ' 人');

  /* 保齡球：擋在球路上的被撞開。球速 34，人自己又一直在走——
     先讓球上路，再把人排到它正前方，不然量到的是「球從空地滾過去」。 */
  const bowled = await page.evaluate(() => {
    startBuild(true); completeNow();
    /* 前面那幾條炸過、燒過，碎料上還有火。落地要不要燒是 tossWorker 判的
       （`w.lit || nearFire(w)`）——摔進火堆裡本來就該燒，那是別條在驗的事。
       這一條要驗的是「球本身不點火」，所以先把場上的火收乾淨。
       （v1.66 之前這裡剛好沒事：城堡 900 塊的碎料少，前面點的火早燒完了；
       換成新天鵝堡之後最小 4450 塊，火還在燒，量到 4 個人著火。） */
    clearFires();
    launchBall({ x: -30, y: 0, z: 0 }, { x: 0, z: 0 });   // 從場邊往工地中心滾
    // 球是舉高了丟出去的，先等它落地開始滾——還在半空飛過頭頂時本來就不該撞到人
    let g = 0;
    while (balls && balls[0].y > balls[0].r + 0.1 && g++ < 200) step(0.05);
    workers.forEach((w, i) => {
      w.x = balls[0].x + 5 + (i % 5) * 1.7; w.z = (i % 3 - 1) * 0.6;
      w.y = 0; w.air = 0; w.burn = 0; w.fall = 0;
    });
    const p0 = workers.map(w => w.x);
    const top = workers.map(w => w.x);
    const flew = new Set();
    let air = 0;
    for (let i = 0; i < 60; i++) {
      step(0.05);
      workers.forEach((w, k) => { if (w.air) { flew.add(k); top[k] = Math.max(top[k], w.x); } });
      air = Math.max(air, workers.filter(w => w.air).length);
    }
    // 只看真的被撞飛的那些飛了多遠——沒被撞到的人自己也會走，混進來就不是這個數字
    const push = [...flew].map(k => top[k] - p0[k]).sort((a, b) => b - a);
    balls = null; ENG.putBalls([]);      // 同上：球還在滾，下一條的人就站在它的路上
    return { air, flew: flew.size, best: +(push[0] || 0).toFixed(1),
             burn: workers.filter(w => w.burn > 0).length };
  });
  ok('保齡球會把擋路的小人推走', bowled.flew > 0 && bowled.best > 4,
     bowled.flew + ' 人被撞飛（同時最多 ' + bowled.air + ' 人在空中），最遠往球的方向推了 ' +
     bowled.best + ' 單位');
  ok('保齡球也不會點火', bowled.burn === 0, '著火 ' + bowled.burn + ' 人');

  /* 放火點站著的人：抱頭跑圈圈——會一直動，但繞著被點著的那個位置轉，不會跑掉 */
  const torched = await page.evaluate(() => {
    startBuild(true); completeNow();
    const w = workers[0];
    w.x = 12; w.z = 0; w.y = 0; w.air = 0; w.burn = 0; w.fall = 0;
    const x0 = w.x, z0 = w.z;
    const lit = igniteWorker(w, false);
    let far = 0, path = 0, px = w.x, pz = w.z;
    for (let i = 0; i < 56; i++) {
      step(0.05);
      far = Math.max(far, Math.hypot(w.x - x0, w.z - z0));
      path += Math.hypot(w.x - px, w.z - pz); px = w.x; pz = w.z;
      }
    return { lit, roll: w.roll, far: +far.toFixed(1), path: +path.toFixed(1),
             gait: +w.gait.toFixed(2), y: +w.y.toFixed(2) };
  });
  ok('放火點著站著的小人 → 抱頭跑圈圈',
     torched.lit && !torched.roll && torched.far < 6 && torched.path > 14,
     '2.8 秒跑了 ' + torched.path + ' 單位，但離原地最遠只有 ' + torched.far +
     '（步伐 ' + torched.gait + '）');

  /* 燒不燒是在**落地那一刻**判定的，不是被打到的當下——所以不是被爆炸掃到的人，
     摔進一堆還在燒的碎料裡照樣會被引燃。 */
  const dropped = await page.evaluate(() => {
    startBuild(true); completeNow();
    // 弄一塊在燒的碎料躺在 (20,20)
    const b = blocks.find(x => x.st === 3);
    breakBlock(b, 0, 0, 0);
    b.x = 20; b.z = 20; b.y = 0.5; b.vx = b.vy = b.vz = 0;
    igniteBlock(b);
    const w = workers[0];
    w.x = 20; w.z = 20 - 3.69; w.y = 0; w.air = 0; w.burn = 0; w.fall = 0;
    tossWorker(w, 0, 8, 6, false);        // 沒有 lit：純粹被丟過去，落點才是關鍵
    const air0 = { air: w.air, burn: w.burn, lit: w.lit };
    let g = 0;
    while (w.air && g++ < 100) step(0.05);
    return { air0, burn: +w.burn.toFixed(2), roll: w.roll, fire: !!b.burn,
             d: +Math.hypot(w.x - b.x, w.z - b.z).toFixed(1) };
  });
  ok('摔進火堆裡的人也會被引燃（燒不燒是落地才算的）',
     dropped.air0.burn === 0 && !dropped.air0.lit && dropped.fire &&
     dropped.d < 2 && dropped.burn > 2.9 && dropped.roll === 1,
     '飛出去時沒著火 → 落在燒著的碎料旁 ' + dropped.d + ' 單位處，開始燒 ' +
     dropped.burn + ' 秒');


  /* 換場要把人身上的火收掉：積木會被回收去蓋新的那座，人也得回去上工 */
  const wswap = await page.evaluate(() => {
    workers.forEach(w => { w.y = 0; w.air = 0; w.fall = 0; igniteWorker(w, 1); });
    const before = workers.filter(w => w.burn > 0).length;
    startBuild(false);
    return { before, burn: workers.filter(w => w.burn > 0).length,
             air: workers.filter(w => w.air).length,
             k: +Math.max(...workers.map(w => w.burnK)).toFixed(2) };
  });
  ok('換建築時小人身上的火一起收掉',
     wswap.before > 0 && wswap.burn === 0 && wswap.air === 0 && wswap.k === 0,
     '換場前 ' + wswap.before + ' 人在燒 → 換場後 ' + wswap.burn + ' 人（焦黑 ' + wswap.k + '）');

  const wperf = await page.evaluate(() => {
    targetCnt = 2000; setWorkerCount(60); startBuild(true); completeNow();
    workers.forEach((w, i) => {
      const a = i / workers.length * Math.PI * 2;
      w.x = Math.cos(a) * rr(2, 12); w.z = Math.sin(a) * rr(2, 12);
      w.y = 0; w.air = 0; w.fall = 0; igniteWorker(w, i % 2);
    });
    for (let i = 0; i < 10; i++) step(0.05);
    const n = workers.filter(w => w.burn > 0).length;
    let t0 = performance.now();
    for (let i = 0; i < 30; i++) step(0.02);
    const stepMs = (performance.now() - t0) / 30;
    t0 = performance.now();
    for (let i = 0; i < 30; i++) { draw(); ENG.render(); }
    return { n, stepMs, drawMs: (performance.now() - t0) / 30, hot: hot.length };
  });
  ok('六十個人同時在燒：CPU 每幀 < 4ms', wperf.stepMs + wperf.drawMs < 4,
     wperf.n + ' 人在燒（火苗 ' + wperf.hot + ' 顆）：step ' + wperf.stepMs.toFixed(2) +
     'ms + draw ' + wperf.drawMs.toFixed(2) + 'ms');

  /* ══════════ 倒數型道具：炸彈／核彈／魔法 ══════════
     三個的共通點是「點下去不會馬上炸」。全部拿大建築來測：
     小建築被炸掉七成五就整棟垮掉換下一座，數字會被那條規則洗掉，
     量到的就不是這個道具自己的範圍。 */
  await head('倒數型道具');
  await reset(page, { shape: '美國國會大廈', cnt: 3000, workers: 6 });
  const bomb = await page.evaluate(() => {
    completeNow();
    const p = { x: 12, y: 4, z: 0 };
    const inR = b => Math.hypot(b.x - p.x, b.y - p.y, b.z - p.z) <= 11;
    const outR = b => Math.hypot(b.x - p.x, b.y - p.y, b.z - p.z) > 13;
    const near0 = blocks.filter(b => b.st === 3 && inR(b)).length;
    const far0 = blocks.filter(b => b.st === 3 && outR(b)).length;
    placeBomb(p);
    const placed = bombs ? bombs.length : 0;
    for (let i = 0; i < 59; i++) step(0.05);            // 2.95 秒：引信還沒燒完
    const early = near0 - blocks.filter(b => b.st === 3 && inR(b)).length;
    step(0.05); step(0.05);                            // 過 3 秒
    const nearLeft = blocks.filter(b => b.st === 3 && inR(b)).length;
    const farLeft = blocks.filter(b => b.st === 3 && outR(b)).length;
    /* 往外噴：速度跟「離炸點的方向」同向才算。
       這個要在爆炸後馬上量——晚幾幀就被重力與碰撞改掉了。 */
    let out = 0, tot = 0, up = 0;
    for (const b of blocks) {
      if (b.st !== 4) continue;
      const dx = b.x - p.x, dz = b.z - p.z, d = Math.hypot(dx, dz);
      if (d < 1) continue;
      tot++;
      if ((b.vx * dx + b.vz * dz) / d > 0) out++;
      if (b.vy > 0) up++;
    }
    return { near0, far0, placed, early, nearLeft, farLeft, tot,
             outward: tot ? out / tot : 0, upward: tot ? up / tot : 0,
             left: bombs ? bombs.length : 0 };
  });
  ok('放下去的炸彈會留在場上倒數', bomb.placed === 1 && bomb.early === 0,
     '放了 ' + bomb.placed + ' 顆，2.95 秒時打飛 ' + bomb.early + ' 塊');
  ok('3 秒後才爆，範圍內全清光', bomb.nearLeft === 0 && bomb.near0 > 100,
     '範圍內 ' + bomb.near0 + ' 塊 → 剩 ' + bomb.nearLeft);
  ok('範圍外的積木原封不動', bomb.farLeft === bomb.far0,
     '範圍外 ' + bomb.far0 + ' 塊 → 剩 ' + bomb.farLeft);
  ok('炸開的積木是往外噴的', bomb.outward > 0.9 && bomb.upward > 0.9,
     bomb.tot + ' 塊飛出去，背離炸點 ' + (bomb.outward * 100).toFixed(0) +
     '%、往上 ' + (bomb.upward * 100).toFixed(0) + '%');
  ok('炸完的炸彈會從場上消失', bomb.left === 0);

  const nk = await page.evaluate(() => {
    cleanTools(); startBuild(true); completeNow();
    callNuke({ x: 0, z: 0 });
    const set0 = blocks.filter(b => b.st === 3).length;
    for (let i = 0; i < 39; i++) step(0.05);            // 1.95 秒：還在倒數，彈體都還沒出現
    const wait = blocks.filter(b => b.st === 3).length;
    for (let i = 0; i < 4; i++) step(0.05);             // 2.15 秒：下墜中，還沒碰到樓頂
    const falling = blocks.filter(b => b.st === 3).length, inAir = !!nukes;
    const fallY = nukes ? nukes[0].y : -1, roof = bp.height;
    /* 炸點要對照的是「彈頭那條線真的碰得到的第一塊」，不是整座的最高點：核彈是照
       blockAt 一條直線往下探的（sweepRock 走的是點，不是球），碰到中空的圓頂時，
       正中央那條線最高的一塊會比屋脊矮一截——v1.143 換上的美國國會大廈就是這樣，
       整座 23 格、正中央那條線只有 17，彈頭是從圓頂的洞掉進去撞到鼓座才炸的。 */
    let roofAt = 0;
    for (let y = roof + 3; y >= 0; y -= 0.1) if (blockAt(0, y, 0)) { roofAt = y; break; }
    /* 掉到碰著建築才炸，所以不能數死步數。下墜末段一幀就掉快十單位，
       這裡把步長縮到 0.005 秒再逼近，記下的最後高度才等於接觸點。 */
    let boomY = -1, g = 0;
    while (nukes && g++ < 400) { boomY = nukes[0].y; step(0.005); }
    step(0.05); step(0.05);
    const set1 = blocks.filter(b => b.st === 3).length;
    let hitMax = 0;
    for (const b of blocks) if (b.st === 4) hitMax = Math.max(hitMax, Math.hypot(b.x, b.y - boomY, b.z));
    /* 爆炸當下該有的：火球（hot 粒子）＋ 貼地的衝擊環。
       這兩個都活不到一秒，所以要在爆完的那一刻量。 */
    const fire0 = hot.length, ring0 = fxRings.length;
    /* 冷卻要盯著「同一批粒子」看，不能看全場平均——蘑菇雲會一直補新的火光進來，
       平均值被新粒子拉高，就算每顆都有乖乖冷卻也測不出來。 */
    const sample = hot.filter(d => d.to);
    const avgG = a => a.reduce((s, d) => s + d.cg, 0) / Math.max(1, a.length);
    const lit0 = avgG(sample);
    /* 蘑菇雲那幾團的 fade 是 3.4／4／4.5，燒起來的煙是 2.2、隕石的尾煙 1.8。
       只認 d.fade 的話，爆炸點著的上千塊碎料冒的煙會被算成蘑菇雲——
       那個數字爆炸當下就有好幾十團，「雲是慢慢長出來的」就測不出來了。 */
    const cloudy = () => dust.filter(d => d.fade >= 3);
    const cloud0 = cloudy().length;
    for (let i = 0; i < 12; i++) step(0.05);            // 0.6 秒
    const lit1 = avgG(sample.filter(d => d.life > 0));
    let peak = 0, peakY = 0, y1 = 0;
    for (let i = 0; i < 12; i++) step(0.05);            // 爆後 1.2 秒：整朵雲該長齊了
    const cloud1 = cloudy().length;
    y1 = Math.max(...cloudy().map(d => d.y));
    for (let i = 0; i < 36; i++) {                      // 再 1.8 秒：雲往上飄
      step(0.05);
      const c = cloudy();
      if (c.length) peakY = Math.max(peakY, Math.max(...c.map(d => d.y)));
      peak = Math.max(peak, c.length);
    }
    const mid = cloudy();
    const midSize = mid.reduce((a, d) => a + d.s, 0) / Math.max(1, mid.length);
    for (let i = 0; i < 200; i++) step(0.05);           // 再 10 秒
    return { set0, wait, falling, inAir, fallY, roof, roofAt, boomY, set1, hitMax, fire0, ring0, lit0, lit1,
             cloud0, cloud1, y1, peakY, peak, midSize,
             gone: cloudy().length, fireGone: hot.length,
             ringGone: fxRings.length, alive: !!nukes };
  });
  ok('核彈 2 秒內不會炸', nk.wait === nk.set0, nk.set0 + ' → ' + nk.wait);
  ok('2 秒後彈體才從天上掉下來', nk.inAir && nk.falling === nk.set0 && nk.fallY > nk.roof,
     '2.15 秒時彈體在 y=' + nk.fallY.toFixed(0) + '（樓頂 ' + nk.roof + '），建築仍是 ' +
     nk.falling + ' 塊');
  /* 炸點跟著接觸點走，不是固定在地面：打高樓時固定炸地面的話，上半截等於沒被炸到。
     這裡驗「炸在樓頂那一帶」——彈頭比模型原點再往前探一點，所以會比樓頂略高。 */
  ok('碰到建築的那一點就炸，不是穿到地面才炸',
     nk.roofAt > 10 && nk.boomY > nk.roofAt && nk.boomY < nk.roofAt + 5,
     '正中央那條線最高 ' + nk.roofAt.toFixed(1) + '（整座 ' + nk.roof + ' 格）→ 炸在 y=' +
     nk.boomY.toFixed(1));
  ok('炸開就是一大片，範圍約 30', nk.set1 < nk.set0 * 0.2 && nk.hitMax > 20 && nk.hitMax <= 31,
     'SET ' + nk.set0 + ' → ' + nk.set1 + '，最遠打飛到 ' + nk.hitMax.toFixed(1));
  ok('爆炸當下有火球與衝擊環', nk.fire0 > 50 && nk.ring0 >= 2,
     nk.fire0 + ' 顆火球、' + nk.ring0 + ' 圈衝擊環');
  /* 火球會冷卻：綠色分量從亮黃(高)掉到暗紅(低)。
     只看「有沒有火球」的話，顏色一路卡在白熱也測不出來。 */
  ok('火球會由亮黃冷成暗紅', nk.lit1 < nk.lit0 * 0.75,
     '同一批粒子的綠分量 0.6 秒內 ' + nk.lit0.toFixed(2) + ' → ' + nk.lit1.toFixed(2));
  /* 蘑菇雲是「長出來」的不是「跳出來」的：爆炸當下只有零星幾團，
     一秒多之後柱子與傘蓋才長齊。一次生完的話這兩個數字會一樣大。
     用比例不用絕對值（v1.123）：柱子每秒生成量從 58 顆加到 160 顆之後，
     「爆炸當下」那一幀本來就會多幾團（實測 33），寫死 20 會被那件事絆倒——
     這一條要驗的是「差很多倍」，不是「當下少於幾團」。 */
  ok('蘑菇雲是隨時間長出來的',
     nk.cloud0 < nk.cloud1 * 0.1 && nk.cloud1 > 300,
     '爆炸當下 ' + nk.cloud0 + ' 團 → 1.2 秒後 ' + nk.cloud1 + ' 團');
  ok('蘑菇雲會往上飄', nk.peakY > nk.y1 + 2,
     '雲頂 ' + nk.y1.toFixed(0) + ' → ' + nk.peakY.toFixed(0));
  ok('蘑菇雲會慢慢縮小、最後散掉', nk.midSize < 4 && nk.gone === 0,
     '三秒後平均大小 ' + nk.midSize.toFixed(2) + '，十三秒後剩 ' + nk.gone + ' 團');
  ok('火球與衝擊環是短暫的，不會留在場上',
     nk.fireGone === 0 && nk.ringGone === 0,
     '十三秒後火球 ' + nk.fireGone + ' 顆、光環 ' + nk.ringGone + ' 圈');

  /* 爆炸中心那顆火球（flashes）。粒子撐不出「一整顆在發光的球」，所以球本體是
     實體球殼，火星退居噴出來的碎火。這裡驗的是：球真的畫在畫面上（過曝的白像素
     只能來自它——把它拿掉重畫一次同一幀就知道差多少）、成本固定五個 draw call、
     球心有抬離爆點（不抬會被自己炸出來的碎料堆埋掉）、亮完會收乾淨。 */
  const flash = await page.evaluate(() => {
    const shot = () => {
      draw(); ENG.render();
      const gl = ENG.three.renderer.getContext();
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      /* **每一個像素都取**（v1.158.2）。一路走過來：每 17 個時取樣數只有六萬、過曝白
         才一百多點，抖動大到會壓在門檻上（實測同一份程式一次 0.41%、一次 0.25%）；
         改成每 5 個好了一些，但還是紅過（同一個 commit、同一顆種子量到過 0.24% 與 0.05%）。
         全取是這條唯一「不改量的是什麼、也不動門檻」的收斂手段，成本只是一個迴圈。
         **這不保證修掉**：0.24 → 0.05 那個落差太大，不像純取樣雜訊，比較像取景／落點
         本身在變。真的再紅一次的話，下一步是把火球的位置釘死再量，而不是放寬 0.06。 */
      let n = 0, lit = 0;
      for (let i = 0; i < px.length; i += 4) {
        n++;
        if (px[i] > 245 && px[i + 1] > 240 && px[i + 2] > 200) lit++;   // 過曝的白
      }
      return { pct: lit / n * 100, calls: ENG.info().calls };
    };
    targetCnt = 2400; shapePick = SHAPES.findIndex(s => s.n === '帝國大廈');
    startBuild(true); completeNow();
    for (let i = 0; i < 240; i++) step(0.05);          // 等前一發的煙火散乾淨
    callNuke({ x: 0, z: 0 });
    while (nukes && nukes[0].t > NUKE_FALL) step(0.05);     // 兩秒倒數
    // 碰到樓頂就炸，步數是浮動的；末段用小步長逼近，boomY 才等於接觸點
    let boomY = -1, g = 0;
    while (nukes && g++ < 400) { boomY = nukes[0].y; step(0.005); }
    step(0.05);                                       // 爆後 0.05 秒
    const born = flashes.map(f => ({ r: +f.r.toFixed(1), op: f.op, y: +f.y.toFixed(1) }));
    /* 風壓那幾圈先撤掉再量：它們是鋪滿半個畫面的加法混色大環，
       兩幀都會被它墊高（量過：留著的話「拿掉火球」那幀從 0.13% 漲到 0.17%，
       火球的對比就從 3.0 倍掉到 2.9 倍）。這裡要驗的是火球，風壓有自己的測試。 */
    const gust = fxRings.filter(f => f.wind);
    for (const g of gust) fxRings.splice(fxRings.indexOf(g), 1);
    const on = shot();
    const saved = flashes.splice(0, flashes.length);   // 同一幀只把火球拿掉，其他都不動
    const off = shot();
    flashes.push(...saved);
    step(0.05); step(0.05);                            // 爆後 0.15 秒：還在全亮期
    const hold = flashes.length ? flashes[0].op : -1;
    for (let i = 0; i < 6; i++) step(0.05);            // 爆後 0.45 秒：該撐大也該暗了
    const fade = flashes.length ? { r: +flashes[0].r.toFixed(1), op: flashes[0].op } : null;
    for (let i = 0; i < 6; i++) step(0.05);            // 爆後 0.75 秒：超過 FLASH_LIFE
    const left = flashes.length;
    /* 火星的分布單獨量：這一刻場上的 hot 混著蘑菇雲柱心的火光（那些本來就生在中心），
       混在一起量不出「火星有沒有生在球面外」。直接叫一次 spawnBlast 最乾淨。 */
    hot.length = 0; flashes.length = 0; fxRings.length = 0;
    spawnBlast({ x: 0, y: 2.5, z: 0 }, 30, false);
    const sparkMin = Math.min(...hot.map(d => Math.hypot(d.x, d.z)));
    /* 要炸得比上限多才驗得到「只留最新的那幾顆」（上限 v1.148.1 從 4 拉到 24） */
    for (let i = 0; i < FLASH_MAX + 4; i++) spawnBlast({ x: i * 3, y: 2.5, z: 0 }, 30, false);
    const capped = flashes.length, cap = FLASH_MAX;
    hot.length = 0; flashes.length = 0; fxRings.length = 0;
    return { born, on, off, hold, fade, left, sparkMin, capped, cap, boomY };
  });
  /* 半徑走 sqrt，爆後第一幀（0.05 秒）就衝到一半以上——「一瞬間撐開」是刻意的，
     等速膨脹看起來像吹氣球。所以這裡量的是「一幀內有沒有到半徑的一半」。 */
  ok('爆炸中心有一顆實體火球，一幀就撐開、球心抬離爆點',
     flash.born.length === 1 && flash.born[0].r > 15 && flash.born[0].r < 20 &&
     Math.abs(flash.born[0].y - (flash.boomY + 30 * 0.22)) < 1.2,
     '爆後 0.05 秒半徑 ' + (flash.born[0] ? flash.born[0].r : '—') +
     '（上限 30）、球心 y=' + (flash.born[0] ? flash.born[0].y : '—') +
     '（爆點 ' + flash.boomY.toFixed(1) + ' + 抬升 6.6）');
  /* 絕對門檻一路在降：藍圖改瘦（0.5→0.42）讓建築長更高、取景拉遠，1.23% → 0.91%；
     核彈改成炸在接觸點之後，帝國大廈這一發是打在樓頂而不是腳邊，火球在畫面上的
     位置與遮擋都變了，再掉到 0.41%；v1.55 取景改成「建築底部置中」，帝國大廈的
     視距從 110 退到 175，同一顆火球在畫面上只剩 0.14%。這裡真正要驗的是
     「有火球才有過曝白」，所以看的是跟拿掉火球那幀的倍數關係（0.14% vs 0.01%，14 倍），
     絕對值只當作「它沒有小到看不見」，門檻也就一路留寬（0.25 → 0.15 → 0.06）：
     那個數字是取樣估計跟著取景走，不是常數。 */
  ok('火球真的亮在畫面上', flash.on.pct > 0.06 && flash.on.pct > flash.off.pct * 3,
     '同一幀有火球 ' + flash.on.pct.toFixed(2) + '% 過曝、拿掉只剩 ' +
     flash.off.pct.toFixed(2) + '%');
  ok('火球固定吃五個 draw call（每層球殼一個）', flash.on.calls - flash.off.calls === 5,
     flash.off.calls + ' → ' + flash.on.calls + ' 個');
  ok('火球先全亮一下才開始暗', flash.hold === 1, '爆後 0.15 秒亮度 ' + flash.hold);
  ok('火球會一邊撐大一邊暗下來',
     !!flash.fade && flash.fade.r > flash.born[0].r + 8 && flash.fade.op < 0.7,
     '0.45 秒時半徑 ' + (flash.fade ? flash.fade.r : '—') + '、亮度 ' +
     (flash.fade ? flash.fade.op.toFixed(2) : '—'));
  ok('火球 0.75 秒內收乾淨', flash.left === 0, '剩 ' + flash.left + ' 顆');
  /* 火星要生在球面外。生在球心的話那些幾乎不透明的方塊會整片糊在球的正面，
     把最亮的核心遮成一堆橘色碎片——改成球殼的意義就沒了。 */
  ok('火星生在球面外，不會糊住核心', flash.sparkMin > 30 * 0.45,
     '最近的一顆離爆心 ' + flash.sparkMin.toFixed(1) + '（半徑 30 的 45% 是 13.5）');
  ok('同時炸好幾發也只留最新的那幾顆火球', flash.capped === flash.cap,
     '連續 ' + (flash.cap + 5) + ' 發 → 場上 ' + flash.capped + ' 顆（上限 ' + flash.cap + '）');

  /* 風壓：核彈與爆裂魔法才有的那一下氣浪。火球只有爆炸半徑那麼大，
     威力看起來就到那裡為止；風壓要掃得比爆炸範圍更遠，還要把地面的塵土一起帶走。
     它是純特效——會不會壞東西還是 explode 那一圈說了算，所以「不動任何積木」也要驗。 */
  const wind = await page.evaluate(() => {
    startBuild(true); completeNow();
    for (let i = 0; i < 40; i++) step(0.05);            // 讓上一段的殘留先散掉
    fxRings.length = 0; dust.length = 0;
    const st0 = blocks.map(b => b.st).join('');
    spawnWind({ x: 0, y: 2.5, z: 0 }, NUKE_R, false);
    const still = blocks.map(b => b.st).join('') === st0;
    const rings = fxRings.filter(f => f.wind).length, wd = dust.filter(d => d.keep).length;
    let ringMax = 0, dustMax = 0;
    for (let i = 0; i < 40; i++) {
      step(0.05);
      for (const f of fxRings) ringMax = Math.max(ringMax, f.r);
      for (const d of dust) if (d.keep) dustMax = Math.max(dustMax, Math.hypot(d.x, d.z));
    }
    fxRings.length = 0; dust.length = 0;
    // 核彈爆炸真的會帶風壓；炸彈那種小爆炸不帶（半徑才 7～14，掃 2.6 倍會比核彈還顯眼）
    explode({ x: 0, y: 2.5, z: 0 }, NUKE_R, NUKE_POW, false, true);
    const nukeWind = dust.filter(d => d.keep).length;
    fxRings.length = 0; dust.length = 0; hot.length = 0; flashes.length = 0;
    explode({ x: 0, y: 2, z: 0 }, BOMB_R, BOMB_POW);
    const bombWind = dust.filter(d => d.keep).length;
    fxRings.length = 0; dust.length = 0; hot.length = 0; flashes.length = 0;
    clearFires();
    return { still, rings, wd, ringMax: +ringMax.toFixed(0), dustMax: +dustMax.toFixed(0),
             nukeWind, bombWind, R: NUKE_R, mult: WIND_R, want: WIND_RINGS, dustN: WIND_DUST };
  });
  ok('風壓掃出爆炸範圍外，不是貼在火球邊上',
     wind.rings === wind.want && wind.ringMax > wind.R * 1.8,
     wind.want + ' 圈氣浪掃到 ' + wind.ringMax + '（爆炸半徑 ' + wind.R +
     '，目標 ' + (wind.R * wind.mult).toFixed(0) + '）');
  ok('地上的塵土被吹著一路往外跑',
     wind.wd === wind.dustN && wind.dustMax > wind.R,
     wind.wd + ' 顆塵土跑到離爆心 ' + wind.dustMax + '（爆炸半徑 ' + wind.R + '）');
  ok('風壓只是特效，不會多壞一塊積木', wind.still);
  ok('只有核彈與魔法有風壓，炸彈那種小爆炸沒有',
     wind.nukeWind === wind.dustN && wind.bombWind === 0,
     '核彈 ' + wind.nukeWind + ' 顆、炸彈 ' + wind.bombWind + ' 顆');

  /* 腳下那圈煙：柱子不能從一塊乾淨的草地長出來。
     光看「貼地的煙有幾團」不夠——柱子底部本來就有煙。要看的是它有沒有往外鋪開，
     所以量「離爆心 R×0.25 以外、貼著地面的煙」有幾團、最遠鋪到哪。
     同時要確認它沒有把塵霧配額吃光：傘蓋是 0.45 秒一次要 112 顆的爆量，
     被擠掉的話蘑菇會變成一根沒有頭的柱子。 */
  const skirt = await page.evaluate(() => {
    startBuild(true); completeNow();
    callNuke({ x: 0, z: 0 });
    for (let i = 0; i < 58; i++) step(0.05);            // 炸下去
    for (let i = 0; i < 30; i++) step(0.05);            // 爆後 1.5 秒
    const cloud = dust.filter(d => d.fade);
    const low = cloud.filter(d => d.y < 6);
    const far = low.filter(d => Math.hypot(d.x, d.z) > NUKE_R * 0.25);
    const out = { low: low.length, far: far.length, R: NUKE_R,
             wide: +Math.max(0, ...low.map(d => Math.hypot(d.x, d.z))).toFixed(1),
             high: cloud.filter(d => d.y > 14).length };
    // 這朵散乾淨再交棒：留著的灰煙會混進下一段（魔法那朵要驗「全部染紅」）
    for (let i = 0; i < 200; i++) step(0.05);
    return out;
  });
  ok('蘑菇雲腳下有一圈往外鋪開的煙', skirt.far > 40 && skirt.wide > skirt.R * 0.4,
     '貼地 ' + skirt.low + ' 團，其中 ' + skirt.far + ' 團在爆心 ' +
     (skirt.R * 0.25).toFixed(0) + ' 單位外，最遠鋪到 ' + skirt.wide);
  ok('腳下的煙沒有把傘蓋的配額吃掉', skirt.high > 60,
     '雲上半部仍有 ' + skirt.high + ' 團');

  const mg = await page.evaluate(() => {
    cleanTools(); startBuild(true); completeNow();
    castMagic({ x: 0, z: 0 });
    const set0 = blocks.filter(b => b.st === 3).length;
    const seq = [];
    /* v1.87 起吸的那一整段（倒數剩 IMP_TIME 開始）一路都在剝牆，所以這一組只驗
       「吸力開始前建築完好」＋長層與爆炸那些事；剝了幾成、剝得夠不夠均勻、
       剝下來的有沒有被捲到陣心，交給下面 mgTake 那組去量。 */
    let calm = -1, full = -1, suck = -1;
    for (let i = 0; i < 119; i++) {                     // 5.95 秒
      // 吸力還沒開始的那些幀：建築該一塊都沒少（記最後一幀的值）
      if (magics && magics[0].t > IMP_TIME) {
        calm = blocks.filter(b => b.st === 3).length;
        suck = +(i * 0.05).toFixed(2);
      }
      step(0.05);
      if (i % 16 === 0) seq.push(magics ? magics[0].shown : -1);   // 每 0.8 秒取樣
      if (full < 0 && magics && magics[0].shown === 6) full = +((i + 1) * 0.05).toFixed(2);
    }
    const alive = !!magics;
    const meanOf = f => { const a = blocks.filter(f); return a.length
      ? a.reduce((s, b) => s + Math.hypot(b.x, b.z), 0) / a.length : 0; };
    /* 推到真的爆開那一幀為止。寫死步數會踩到浮點邊界：0.05 累加 120 次不會剛好是 6，
       差一點點就變成「還沒爆」，後面量到的火球是空的。 */
    let g = 0;
    while (magics && g++ < 6) step(0.05);
    phase = 'done';    // 擋掉「拆完換下一座」：要留著現場量噴多遠，不然下一座已經開工了
    const fire = hot.length;
    const flashY = flashes.length ? flashes[flashes.length - 1].y : -1;
    const flew = meanOf(b => b.st === 4);
    for (let i = 0; i < 20; i++) step(0.05);            // 一秒：讓它們飛出去
    let hitMax = 0;
    for (const b of blocks) if (b.st === 4 || b.st === 0) hitMax = Math.max(hitMax, Math.hypot(b.x, b.z));
    const flew1 = meanOf(b => b.st === 4 || b.st === 0);
    for (let i = 0; i < 4; i++) step(0.05);             // 補到爆後 1.2 秒：雲該長齊了
    const cloud = dust.filter(d => d.fade >= 3).length;
    /* v1.48 起魔法的雲跟核彈同一種：灰白煙（不給 cr，引擎就走預設的灰）。
       以前整朵染紅、雲裡還撒粉白星光，使用者要的是同一種雲。 */
    const tinted = dust.filter(d => d.fade >= 3 && d.cr !== undefined).length;
    return { set0, calm, suck, seq, full, magTime: MAG_TIME, coreY: MAG_CORE_Y,
             alive, flashY, flew, flew1,
             set1: blocks.filter(b => b.st === 3).length,
             hitMax, after: !!magics, fire, cloud, tinted };
  });
  ok('魔法陣是一層層長出來的', mg.seq[0] === 1 && mg.seq[mg.seq.length - 1] === 6 &&
     mg.seq.every((v, i) => i === 0 || v >= mg.seq[i - 1]), '每 0.8 秒取樣：' + mg.seq.join(' → '));
  /* 六層要快點長齊，「六層都在場上轉」那一段才留得久——那一段才是陣蓄滿的樣子。
     每層之間是 0.32 秒（擴張 0.15 ＋ 小火圈爬升 0.17），六層 1.75 秒長齊、滿陣還有 4.25 秒。
     v1.47 照使用者要求再加快一次（原本 0.54 秒一層、滿陣只有 3 秒）：
     長的過程是過場，滿陣才是主角。守在 2 秒／4 秒，再快就看不出是一層一層長的了。 */
  ok('六層很快長齊，之後有一大段時間都是滿的',
     mg.full > 0 && mg.full < 2 && mg.magTime - mg.full > 4,
     mg.full + ' 秒就六層都在，滿陣狀態持續 ' + (mg.magTime - mg.full).toFixed(1) + ' 秒');
  /* 陣長出來的那一秒半只長陣、不動建築，吸力開始（倒數剩 IMP_TIME）之後才剝。
     兩段都要驗：只驗「六秒內沒爆」的話，第一秒就把建築拆光也會過。 */
  ok('陣長出來的那一秒半不動建築', mg.calm === mg.set0 && mg.alive,
     '吸力開始前（第 ' + mg.suck + ' 秒）' + mg.set0 + ' → ' + mg.calm + ' 塊');

  /* 「吸的過程共破壞兩成」（v1.87，使用者指定）。v1.62～v1.86 是倒數剩 0.3 秒
     那一幀抽兩成扯下來（crushIn）：前面四秒半建築完全沒事，然後忽然少兩成、
     緊接著就炸開——使用者看到的就是「忽然吸兩成然後爆炸飛出去」。
     現在整段吸的過程一直在剝，所以要驗三件事：一路剝（沒有哪一幀忽然少一大塊）、
     整段加起來剛好兩成、剝下來的真的有被捲到陣心。
     分子用**攔 afterHit** 數，不用塊數差：連帶垮塌的也是 SET 變 FLY，數塊數分不出來，
     而 implode 記帳時半徑給 6、位置在陣心（見 game-tools.js），跟別人撞不到號。
     藍圖指定新天鵝堡、3000 塊：分母要夠大，抽樣誤差才壓得下去。 */
  const mgTake = await page.evaluate(() => {
    cleanTools(); magics = null;
    shapePick = SHAPES.findIndex(s => s.n === '新天鵝堡');
    targetCnt = 3000; startBuild(true); completeNow();
    shapePick = -1;
    const orig = afterHit;
    let torn = 0;                        // implode 直接剝下來的（不含連帶垮塌）
    afterHit = (n, p, R) => {
      if (R === 6 && Math.abs(p.y - MAG_CORE_Y) < 0.01) torn += n;
      return orig(n, p, R);
    };
    castMagic({ x: 0, z: 0 });
    let stood = -1, inR = 0, suckAt = -1, prev = 0, maxDrop = 0, dropFrames = 0, preSet = 0;
    let wall = null, wallD = null, pick = null, pickD0 = 0, minD = null;
    let gathered = 0, gatherY = 0;
    for (let i = 0; i < 200 && magics; i++) {
      const m = magics[0];
      if (stood < 0 && m.t <= IMP_TIME) {            // 吸力開始的那一幀：把分母記下來
        wall = blocks.filter(b => b.st === 3);
        wallD = wall.map(b => Math.hypot(b.x, b.z));
        stood = wall.length; prev = stood;
        // 「兩成」是**範圍內**的兩成：城堡有一截伸出半徑 30 外，那些本來就不該動
        inR = wallD.filter(v => v <= MAG_R).length;
        suckAt = +(MAG_TIME - m.t).toFixed(2);
      }
      /* 吸了兩秒時，把「已經被剝下來」的那批裡最外圈那 40 塊挑出來：它們還有
         兩秒半可以被捲進去，爆炸時該就在陣心。（最後幾幀才剝下來的本來就還在
         半路上，混進來只會糊掉這一條；近的本來就在中間，證明不了「被吸過來」。） */
      if (!pick && wall && m.t <= IMP_TIME - 2) {
        const idx = wall.map((b, j) => j).filter(j => wall[j].st !== 3 && wallD[j] <= MAG_R);
        idx.sort((a, b) => wallD[b] - wallD[a]);
        const top = idx.slice(0, 40);
        pick = top.map(j => wall[j]);
        pickD0 = top.reduce((s, j) => s + wallD[j], 0) / Math.max(1, top.length);
        minD = pick.map(() => Infinity);             // 這批各自「最靠近陣心」到什麼程度
      }
      if (pick) pick.forEach((b, j) => {
        const d = Math.hypot(b.x, b.z);
        if (d < minD[j]) minD[j] = d;
      });
      if (m.t <= 0.06) {                             // 爆炸前最後一幀
        preSet = blocks.filter(b => b.st === 3).length;
        gathered = pick.reduce((s, b) => s + Math.hypot(b.x, b.z), 0) / pick.length;
        gatherY = pick.reduce((s, b) => s + b.y, 0) / pick.length;
      }
      const alive = m.t > 0.06;         // 爆炸那一幀不算：一次噴光是火球的事，不是吸的事
      step(0.05);
      if (stood >= 0 && alive) {
        const now = blocks.filter(b => b.st === 3).length;
        if (prev - now > 0) { dropFrames++; if (prev - now > maxDrop) maxDrop = prev - now; }
        prev = now;
      }
    }
    afterHit = orig;
    return { stood, inR, suckAt, torn, take: MAG_TAKE, impTime: IMP_TIME,
             maxDrop, dropFrames, preSet, n: pick ? pick.length : 0,
             pickD0: +pickD0.toFixed(1), gathered: +gathered.toFixed(1),
             gatherY: +gatherY.toFixed(1), coreY: +MAG_CORE_Y.toFixed(1),
             pulled: +(minD ? minD.reduce((s, v) => s + v, 0) / minD.length : -1).toFixed(1) };
  });
  ok('吸的過程一路在剝牆，不是某一幀忽然少一大塊',
     mgTake.dropFrames > 50 && mgTake.torn > 0 && mgTake.maxDrop < mgTake.torn * 0.1,
     '吸的 ' + mgTake.impTime + ' 秒裡有 ' + mgTake.dropFrames + ' 幀在掉，單幀最多少 ' +
     mgTake.maxDrop + ' 塊（整段共剝 ' + mgTake.torn + ' 塊）');
  ok('吸的整段加起來剝走範圍內 MAG_TAKE 那個比例，其餘留到爆炸',
     mgTake.torn > mgTake.inR * (mgTake.take - 0.05) &&
     mgTake.torn < mgTake.inR * (mgTake.take + 0.05) &&
     mgTake.preSet > mgTake.stood * 0.7,
     '吸力從第 ' + mgTake.suckAt + ' 秒起，範圍內 ' + mgTake.inR + ' 塊 → 剝走 ' +
     mgTake.torn + ' 塊（' + (mgTake.torn / mgTake.inR * 100).toFixed(1) + '%，設定 ' +
     (mgTake.take * 100) + '%），爆炸前還有 ' + mgTake.preSet + ' 塊站著');
  ok('剝下來的會被捲到陣心，爆炸那一刻就在爆點上',
     mgTake.pulled < mgTake.pickD0 * 0.35 && mgTake.gathered < 5 &&
     Math.abs(mgTake.gatherY - mgTake.coreY) < 3.5,
     '早期剝下來那批裡最外圈 ' + mgTake.n + ' 塊原本離陣心 ' + mgTake.pickD0 +
     '，爆炸當下 ' + mgTake.gathered + '（最靠近 ' + mgTake.pulled + '），高度 ' +
     mgTake.gatherY + '（爆點 ' + mgTake.coreY + '）');
  /* 兩段吸（v1.93，使用者指定「緩慢吸部分積木 → 爆炸前快速吸往爆炸中心 → 爆炸」）：
     量的是碎料**往陣心靠近的速度**（徑向速度，往內是正的）——慢吸那一段是靠 pull
     一點一點加速度捲進來，最後 CRUSH_AT 秒改走「剛好在爆炸那一刻抵達陣心」的彈道，
     速度整個跳一級。
     為什麼不量位置：位置到後段本來就會收攏（v1.92 也會），只驗位置分不出「一路等速捲」
     跟「最後衝一段」。
     取樣範圍要挑對，不然量不出來：
     ① 慢吸那邊只取**緊接在快吸前、一樣長的那 CRUSH_AT 秒**。慢吸的徑向速度是
        **一路遞減**的（實測從 3.4 掉到 1.2：先被吸進去的都已經在陣心那一團裡，
        剩下的離陣心近、徑向速度本來就小），取的窗一拉長就把前面較快的那幾幀平均進來，
        比出來的倍數會偏小（CRUSH_AT 0.6 那版取一秒半時是 3.9 → 8.1，只有 2.1 倍）。
        兩段等長又相鄰，比的才是「同一批碎料在交界前後的速度」。
     ② 離陣心 2 格內的不算：已經到陣心的那些徑向速度沒有意義。
        （曾經改成「只看 10 格外的」想放大差距，結果那個族群只剩 1～5 塊，
        數字會隨機跳——樣本要夠多，這裡是 120～175 塊。）
     實測（v1.93.1，CRUSH_AT 0.3）：0.7～0.9 → 13.6～15.3／秒，**16～19 倍**。
     門檻只訂 2.5 倍：CRUSH_AT 一改倍數就跳很多（0.6 那版是 2.4 → 7.8 ＝ 3.2 倍），
     這一條守的是「那一段在不在」，不是「剛好幾倍」。
     紅檢（把 implode 裡的 fast 關成 false，等於退回 v1.92）：2 → 1／秒（0.5 倍），
     最後那一段反而是整段最慢的——慢吸一路遞減，不會自己冒出一段衝刺。
     幀數門檻抓 fn > 2：0.3 秒在 dt 0.05 下只有 4～5 幀（0.6 秒那版有 10 幀）。 */
  const mgFast = await page.evaluate(() => {
    cleanTools(); magics = null;
    shapePick = SHAPES.findIndex(s => s.n === '新天鵝堡');
    targetCnt = 3000; startBuild(true); completeNow();
    shapePick = -1;
    castMagic({ x: 0, z: 0 });
    const inward = () => {
      let s = 0, n = 0;
      for (const b of blocks) {
        if (b.st !== 4) continue;
        const d = Math.hypot(b.x, b.z);
        if (d > MAG_R || d < 2) continue;
        s += -(b.vx * b.x + b.vz * b.z) / d; n++;
      }
      return n ? { v: s / n, n } : null;
    };
    let slow = 0, sn = 0, fast = 0, fn = 0, slowN = 0, fastN = 0;
    for (let i = 0; i < 200 && magics; i++) {
      const m = magics[0];
      const r = m.t <= IMP_TIME && m.t > 0.06 ? inward() : null;
      if (r) {
        if (m.t > CRUSH_AT) {
          if (m.t <= CRUSH_AT * 2) { slow += r.v; sn++; slowN = r.n; }
        } else { fast += r.v; fn++; fastN = r.n; }
      }
      step(0.05);
    }
    return { slow: +(slow / Math.max(1, sn)).toFixed(1),
             fast: +(fast / Math.max(1, fn)).toFixed(1),
             sn, fn, slowN, fastN, at: CRUSH_AT };
  });
  ok('最後那一段改成快速往內吸，不是一路等速捲進來',
     mgFast.fn > 2 && mgFast.slow > 0 && mgFast.fast > mgFast.slow * 2.5,
     '快吸前那 ' + mgFast.at + ' 秒 ' + mgFast.sn + ' 幀：碎料平均往內 ' + mgFast.slow + ' ／秒（' +
     mgFast.slowN + ' 塊）→ 最後 ' + mgFast.at + ' 秒 ' + mgFast.fn + ' 幀：' +
     mgFast.fast + ' ／秒（' + mgFast.fastN + ' 塊）');

  /* 爆點要在最低那層的圓心上，不是地面：碎料被吸到那個高度，火球就該從那裡炸開。
     火球本體再往上抬 R×0.22（免得被自己炸出來的碎料堆埋掉），所以對得上 12.1 + 6.6。 */
  ok('爆點在最低層魔法陣的圓心上',
     Math.abs(mg.flashY - (mg.coreY + 30 * 0.22)) < 0.05,
     '火球中心 y=' + mg.flashY.toFixed(1) + '（陣心 ' + mg.coreY.toFixed(1) + ' + 抬升 6.6）');
  ok('六秒一到火球把它們全噴出去',
     mg.set1 < mg.set0 * 0.2 && !mg.after && mg.flew1 > mg.flew * 1.5 && mg.hitMax > 25,
     '爆炸當下離陣心 ' + mg.flew.toFixed(1) + ' → 一秒後 ' + mg.flew1.toFixed(1) +
     '，最遠 ' + mg.hitMax.toFixed(1));
  ok('魔法爆完也會留一朵蘑菇雲，而且跟核彈同一種',
     mg.fire > 50 && mg.cloud > 90 && mg.tinted === 0,
     mg.fire + ' 顆火球、1.2 秒後 ' + mg.cloud + ' 團煙，染色的 ' + mg.tinted + ' 團');

  /* 陣是一層層疊起來的，不是同心圓：層與層之間高度要遞增，
     而且貼地那圈的半徑就是爆炸範圍（要讓玩家看得出會炸到哪）。 */
  const mgRing = await page.evaluate(() => {
    startBuild(true); completeNow();
    castMagic({ x: 0, z: 0 });
    for (let i = 0; i < 100; i++) step(0.05);       // 5 秒：四層都長齊
    const all = (magics ? magics[0].rings : []).filter(o => !o.seed);   // 火種那三圈另外驗
    // 一層是兩個環疊出來的：實色的芯 + 加法混色的暈。層次要看芯那幾個
    const core = all.filter(o => !o.add)
      .map(o => ({ y: +o.y.toFixed(1), r: +o.r.toFixed(1), c: o.c, fc: o.fc }));
    const halo = all.filter(o => o.add);
    return { n: core.length, halo: halo.length, rings: core,
             rising: core.every((o, i) => i === 0 || o.y > core[i - 1].y),
             /* 照參考圖：那一圈本身是亮黃的鑲邊，場的顏色在 fc（盤）上。
                只驗 c 會漏掉「盤跟著芯一起變黃、整片糊成一大片」那種改壞法。
                v1.93 換成使用者從新參考圖挑的兩色：亮黃的鑲邊 #fcf534 ＋ 紅橘的場 #cb2306
                （v1.62.1～v1.92 是亮黃／金黃的鑲邊配桃紅的場）。 */
             red: core.every(o => o.c === 0xfcf534 && o.fc === 0xcb2306),
             ground: core[0] ? core[0].r : 0,
             // 每層都要有填滿的盤與放射紋路，只有環的話看起來是「地上畫了一個圈」
             solid: all.filter(o => o.fill).length, lace: all.filter(o => o.sp).length };
  });
  ok('魔法陣是亮黃鑲邊配紅橘的場，而且一層一層往上疊',
     mgRing.n === 6 && mgRing.halo === 6 && mgRing.rising && mgRing.red,
     mgRing.rings.map(o => 'y' + o.y + '/r' + o.r).join('、') + '，外圈暈 ' + mgRing.halo + ' 個');
  ok('每一層都是填滿的盤加螺旋紋路，不只是一個圈',
     mgRing.solid === 6 && mgRing.lace === 6,
     '填滿的盤 ' + mgRing.solid + ' 片、帶紋路的層 ' + mgRing.lace + ' 層');

  /* 每層半徑帶隨機抖動：兩次施法要長得不一樣，但**同一次施法內不能變**——
     每幀重抽的話整疊會一直閃。 */
  const mgVary = await page.evaluate(() => {
    const cast = () => {
      startBuild(true); completeNow();
      castMagic({ x: 0, z: 0 });
      for (let i = 0; i < 100; i++) step(0.05);
      return magics[0].rings.filter(o => !o.add && !o.seed).map(o => +o.r.toFixed(3));
    };
    const a = cast(), b = cast();
    const c = magics[0].rings.filter(o => !o.add && !o.seed).map(o => +o.r.toFixed(3));
    for (let i = 0; i < 8; i++) step(0.05);
    const d = magics[0].rings.filter(o => !o.add && !o.seed).map(o => +o.r.toFixed(3));
    return { a, b, differ: a.some((v, i) => Math.abs(v - b[i]) > 0.3), steady: c.join() === d.join() };
  });
  ok('每次施法的層半徑都不一樣', mgVary.differ,
     '第一次 ' + mgVary.a.map(v => v.toFixed(1)).join('/') +
     '、第二次 ' + mgVary.b.map(v => v.toFixed(1)).join('/'));
  ok('但同一次施法內不會逐幀跳動', mgVary.steady);

  /* 陣要**逆時針**慢慢轉。方向不能只看 spin 這個數字：紋路的角度是用
     (cos a, sin a) 擺到 (x, z) 上的，而畫面看下去 +Z 朝下，所以 a 變大在畫面上是順時針。
     這裡直接抓場上真的畫出來的那些紋路，投影到畫面看它往哪邊掃。 */
  const mgSpin = await page.evaluate(() => {
    startBuild(true); completeNow();
    castMagic({ x: 0, z: 0 });
    for (let i = 0; i < 100; i++) step(0.05);        // 5 秒：六層都在，紋路的編號不再變動
    draw(); ENG.render();
    // 火種那圈轉得比陣快 3.4 倍（它是「在竄」不是「在轉」），量陣的轉速要把它排掉
    const at = () => magics[0].rings.filter(o => !o.add && !o.seed).map(o => +o.spin.toFixed(4));
    const a = at();
    // 陣的紋路（螺旋臂與外圈虛線）都在 ringGroup 底下那顆 InstancedMesh 上
    let grp = null;
    ENG.three.scene.traverse(o => {
      if (!grp && o.geometry && o.geometry.type === 'RingGeometry') grp = o.parent;
    });
    const sp = grp.children.find(o => o.isInstancedMesh);
    const M = new THREE.Matrix4(), V = new THREE.Vector3();
    const posOf = i => { sp.getMatrixAt(i, M); return V.setFromMatrixPosition(M).clone(); };
    // 挑離陣心最遠的那一段：半徑越大，投影出來的角度變化越明顯
    let idx = 0, far = -1;
    for (let i = 0; i < sp.count; i++) {
      const q = posOf(i), d = Math.hypot(q.x - magics[0].x, q.z - magics[0].z);
      if (d > far) { far = d; idx = i; }
    }
    const proj = v => { const q = v.clone().project(ENG.three.camera); return [q.x, q.y]; };
    const c = proj(new THREE.Vector3(magics[0].x, posOf(idx).y, magics[0].z));
    const P0 = proj(posOf(idx));
    for (let i = 0; i < 8; i++) step(0.05);          // 0.4 秒
    draw(); ENG.render();
    const P1 = proj(posOf(idx));
    const b = at();
    // 畫面上（y 朝上）的外積 > 0 就是逆時針
    const cross = (P0[0] - c[0]) * (P1[1] - c[1]) - (P0[1] - c[1]) * (P1[0] - c[0]);
    return { a, b, cross, far: +far.toFixed(1),
             moved: a.every((v, i) => Math.abs(v - b[i]) > 1e-4),
             rate: Math.max(...a.map((v, i) => Math.abs(v - b[i]))) / 0.4,
             spread: new Set(a).size };
  });
  ok('魔法陣會逆時針轉', mgSpin.cross > 0 && mgSpin.moved,
     '0.4 秒裡最外圈那段紋路（離陣心 ' + mgSpin.far + '）在畫面上往逆時針掃，外積 ' +
     mgSpin.cross.toFixed(4));
  /* 「緩慢」也要驗：轉太快就變成電風扇。最快的那層一圈也要 11 秒以上。 */
  ok('而且是慢慢轉', mgSpin.rate > 0.1 && mgSpin.rate < 0.8,
     '最快的一層 ' + mgSpin.rate.toFixed(2) + ' rad/s（一圈 ' +
     (6.283 / mgSpin.rate).toFixed(0) + ' 秒）');
  ok('但每一層的紋路角度各自不同', mgSpin.spread === mgSpin.a.length,
     mgSpin.a.length + ' 層裡有 ' + mgSpin.spread + ' 種角度');

  /* 展開的方式：由下往上一層一層長，中間靠一個小火圈（火種）把火帶上去——
     先出現最下面那層 → 火種從它的圓心升到上一層的高度 → 抵達才擴張成新的一層。
     兩件事都要驗：火種真的在爬（不是原地閃），而且「爬完才多一層」，
     不然它就只是個裝飾，六層還是各自憑空亮起來。
     v1.39 起火種**一直都在**：長層的那 0.24 秒它停在那一層的圓心等，不再消失。 */
  const mgSeed = await page.evaluate(() => {
    const lay = MAG_LAYER.map(L => +(0.12 + MAG_R * L.y).toFixed(2));
    const coreY = () => magics[0].rings.filter(o => !o.add && !o.seed).map(o => +o.y.toFixed(2));
    const seedY = () => {
      const s = magics[0].rings.find(o => o.seed && !o.add);
      return s ? +s.y.toFixed(2) : -1;
    };
    // 每次施法都要從最下面那層開始（不再洗順序）
    const firsts = [];
    for (let k = 0; k < 4; k++) {
      cleanTools(); startBuild(true); completeNow(); castMagic({ x: 0, z: 0 });
      for (let i = 0; i < 4; i++) step(0.05);        // 0.2 秒：只該有最下面那層
      firsts.push({ n: coreY().length, y: coreY()[0] });
    }
    /* 追第一段：0.45 秒剛好走完「長第一層 → 火種上升 → 長第二層」
       （0.15 擴張 + 0.17 爬升 + 0.15 擴張；v1.47 之前這一段是 0.7 秒）。
       同時整場（六秒）都盯著火種在不在、有沒有往下掉。 */
    cleanTools(); startBuild(true); completeNow(); castMagic({ x: 0, z: 0 });
    const trail = [];
    for (let i = 0; i < 9; i++) { step(0.05); trail.push({ n: coreY().length, s: seedY() }); }
    const rise = trail.filter((o, i) => i > 0 && o.s > trail[i - 1].s + 0.01);   // 真的在爬的那幾幀
    const hold = trail.filter((o, i) => i > 0 && Math.abs(o.s - trail[i - 1].s) < 0.01);
    let gaps = 0, drops = 0, last = -1, tail = -1;
    for (let i = 0; i < 105 && magics; i++) {
      step(0.05);
      if (!magics) break;
      const s = seedY();
      if (s < 0) gaps++;
      else { if (last >= 0 && s < last - 0.01) drops++; last = s; }
      tail = s;
    }
    return { lay, firsts,
             steps: rise.length, held: hold.length,
             lo: trail[0].s, hi: trail[trail.length - 1].s,
             /* 爬升途中只該有一層——但最後那一幀例外：火種抵達上一層高度的同一刻
                新的一層就從它身上撐開，所以那一幀「已經到位、也已經兩層」是對的。 */
             whileRising: rise.every(o => o.n === 1 || Math.abs(o.s - lay[1]) < 0.1),
             after: trail[trail.length - 1].n,
             gaps, drops, tail, top: +(0.12 + MAG_R * MAG_LAYER[MAG_LAYER.length - 1].y).toFixed(2) };
  });
  ok('一定從最下面那層開始長，不再洗出現順序',
     mgSeed.firsts.every(f => f.n === 1 && Math.abs(f.y - mgSeed.lay[0]) < 0.01),
     '四次施法在 0.2 秒時都只有 1 層、高度 ' + mgSeed.firsts.map(f => f.y).join('／') +
     '（最下層在 ' + mgSeed.lay[0] + '）');
  ok('火種從下面那層升到上一層，升到位才長出新的一層',
     mgSeed.steps > 3 && mgSeed.whileRising && mgSeed.after === 2 &&
     Math.abs(mgSeed.lo - mgSeed.lay[0]) < 1.5 && Math.abs(mgSeed.hi - mgSeed.lay[1]) < 1.5,
     '火種 ' + mgSeed.steps + ' 幀從 y' + mgSeed.lo + ' 升到 y' + mgSeed.hi +
     '（第一層 ' + mgSeed.lay[0] + ' → 第二層 ' + mgSeed.lay[1] +
     '），升的過程中都只有 1 層，抵達後變 ' + mgSeed.after + ' 層');
  /* 使用者要的：火種不要在「某一層正在長」的空檔消失。
     以前只在爬升那 0.3 秒畫，長層的 0.24 秒它不見 → 看起來是一閃一閃地跳上去。 */
  ok('火種一直都在，長層的那段是停在原地等，不是消失',
     mgSeed.gaps === 0 && mgSeed.held > 3,
     '六秒裡有 ' + mgSeed.gaps + ' 幀看不到火種，前 0.7 秒有 ' + mgSeed.held + ' 幀停在原地');
  ok('火種只會往上，最後停在最上層等爆炸',
     mgSeed.drops === 0 && Math.abs(mgSeed.tail - mgSeed.top) < 0.01,
     '一路沒有往下掉過，最後停在 y' + mgSeed.tail + '（最上層 ' + mgSeed.top + '）');

  /* v1.47：陣心那道往上衝的光柱換成「魔力粒子往陣心集中」。
     使用者看到的是「中心點像在冒煙」——一股從陣心往外噴的東西，
     跟這個法術正在做的事（把周圍全部吸進來）完全相反，所以整個掉頭。
     四件事要驗：一施法就有、每顆真的在靠近、到了就熄、而且中心不再往外噴。 */
  const mgZip = await page.evaluate(() => {
    /* 上一段的陣還在場上、粒子也還在飛：先讓它炸完、散乾淨再開始。
       不清的話這裡追到的會混進上一發的粒子——那些已經快到陣心了，位移量全失真。 */
    while (magics) step(0.05);
    for (let i = 0; i < 120; i++) step(0.05);
    clearFires();
    startBuild(true); completeNow();
    castMagic({ x: 0, z: 0 });
    const dist = h => Math.hypot(h.x - magics[0].x, h.y - MAG_CORE_Y, h.z - magics[0].z);
    for (let i = 0; i < 6; i++) step(0.05);          // 0.3 秒：施法一開始就該有
    // 追固定的一批，不是每幀重抽（重抽的話量到的是「現在場上這些離陣心多遠」）
    const batch = hot.filter(h => h.suck).map(h => ({ h, d0: dist(h) }));
    for (let i = 0; i < 8; i++) step(0.05);          // 0.4 秒
    const closer = batch.filter(o => dist(o.h) < o.d0 - 1).length;
    /* 速度只能拿「這 0.4 秒都還活著」的那些來算：半路就到陣心熄掉的那幾顆
       位置從此凍住，把它們算進去等於用「飛了 0.2 秒的位移」除以 0.4 秒。 */
    const live = batch.filter(o => hot.indexOf(o.h) >= 0);
    const spd = live.reduce((s, o) => s + (o.d0 - dist(o.h)), 0) / (live.length * 0.4);
    for (let i = 0; i < 30; i++) step(0.05);         // 再 1.5 秒：這批早該到陣心熄掉了
    const left = batch.filter(o => hot.indexOf(o.h) >= 0).length;
    /* 原本那道光柱長這樣：陣心附近、往上飛、不帶 suck 也不帶 pull。
       接下來兩秒一顆都不該有（碎料的火苗也長這樣，所以這座建築要是完好的）。 */
    let plume = 0, alive = 0;
    for (let i = 0; i < 40; i++) {
      step(0.05);
      plume += hot.filter(h => !h.suck && !h.pull && h.vy > 0 &&
                               Math.hypot(h.x - magics[0].x, h.z - magics[0].z) < 6).length;
      alive = Math.max(alive, hot.filter(h => h.suck).length);
    }
    while (magics) step(0.05);
    for (let i = 0; i < 140; i++) step(0.05);        // 爆炸、雲、藍電都散乾淨再交棒
    clearFires();
    return { n: batch.length, closer, spd: +spd.toFixed(1), left, plume, alive, want: SUCK_SPD };
  });
  ok('一施法魔力粒子就開始往陣心捲', mgZip.n >= 6 && mgZip.n < 16 && mgZip.alive > 20,
     '0.3 秒時場上 ' + mgZip.n + ' 顆，最多同時 ' + mgZip.alive + ' 顆在飛');
  ok('每一顆都真的在靠近陣心，而且飛得快',
     mgZip.closer === mgZip.n && mgZip.spd > mgZip.want * 0.6,
     mgZip.n + ' 顆裡有 ' + mgZip.closer + ' 顆靠近了，平均每秒收 ' + mgZip.spd +
     ' 單位（設定 ' + mgZip.want + '）');
  ok('捲到陣心就熄掉，不會對穿過去再飛出另一邊', mgZip.left === 0,
     '1.9 秒後那批 ' + mgZip.n + ' 顆一顆都不剩');
  ok('陣心不再往外冒東西（原本那道光柱）', mgZip.plume === 0,
     '兩秒裡陣心 6 單位內往上飛的粒子累計 ' + mgZip.plume + ' 顆次');

  /* v1.47 新增：每長出一層，就在那一圈上撒一把十字星光（使用者給的參考圖那種星芒）。
     星芒是平面的，靠公告板每幀正對鏡頭——所以「有撒」跟「面向鏡頭」都要驗，
     只驗資料的話，鏡頭一轉就變成一片看不見的紙片也會過。 */
  const mgStar = await page.evaluate(() => {
    const orig = spawnStars;
    const calls = [];
    window.spawnStars = function (x, z, y, rad, n, k) {
      /* 魔法師施法也撒星（v1.64）：他那把會給第六個參數 k（縮小倍率），魔法陣這一套不給。
         上一座被這裡炸完會換場重蓋，蓋到一半魔法師就開始施法——不濾掉的話
         這裡不但統計會混到別人的星，magics 還是 null（下面那個 el 直接爆掉）。 */
      if (k === undefined)
        // el：這一把是施法後第幾秒撒的。要分開看「長層期間」與「滿陣之後」
        calls.push({ y: +y.toFixed(1), rad: +rad.toFixed(1), n, el: MAG_TIME - magics[0].t });
      return orig(x, z, y, rad, n, k);
    };
    let peak = 0, lastAt = -1, first = null, gap = 0, quiet = 0;
    const pops = [];                                  // 追第一顆星的亮度曲線
    /* 施三次法再統計「哪一層分到幾顆」：挑層是隨機的，一次施法只撒九十幾顆，
       單看一次的分佈本來就會忽高忽低（±2σ 就佔平均的四成），
       那樣的門檻不是在驗程式而是在賭骰子。 */
    for (let cast = 0; cast < 3; cast++) {
      while (magics) step(0.05);
      for (let i = 0; i < 60; i++) step(0.05);
      startBuild(true); completeNow();
      castMagic({ x: 0, z: 0 });
      /* 上一發炸完會換場重蓋，蓋到一半魔法師就在旁邊施法（v1.64），他撒的星還亮著。
         不清掉的話 first 會抓到別人的星，量到的是那顆的**尾巴**（亮度 0.02）而不是一閃。 */
      stars.length = 0;
      let el = 0;
      for (let i = 0; i < 119 && magics; i++) {        // 整個施法期間（六秒）
        step(0.05); el += 0.05;
        if (cast > 0) continue;                       // 亮度曲線與空窗只看第一次就夠
        if (!first && stars.length) first = stars[0];
        if (first && stars.indexOf(first) >= 0) pops.push(+first.op.toFixed(2));
        peak = Math.max(peak, stars.length);
        if (stars.length) { lastAt = +el.toFixed(2); quiet = 0; }
        else if (el > 0.2) { quiet++; gap = Math.max(gap, quiet); }   // 最長空窗幾幀
      }
    }
    window.spawnStars = orig;
    /* 畫面那半：星星那顆 InstancedMesh 的幾何只有 9 個頂點（中心 + 8 個尖凹點），
       場上沒有第二顆長這樣。法線與鏡頭視線的夾角接近 0 就是正對著鏡頭。 */
    castMagic({ x: 0, z: 0 });
    step(0.05); draw(); ENG.render();
    let sm = null;
    ENG.three.scene.traverse(o => {
      if (!sm && o.isInstancedMesh && o.geometry.attributes.position.count === 9) sm = o;
    });
    const faceOf = () => {
      const M = new THREE.Matrix4(); sm.getMatrixAt(0, M);
      const n = new THREE.Vector3(0, 0, 1).transformDirection(M);
      const cd = new THREE.Vector3(); ENG.three.camera.getWorldDirection(cd);
      return +Math.abs(n.dot(cd)).toFixed(3);
    };
    const drawn = sm ? sm.count : -1, dot0 = sm ? faceOf() : -1;
    const yaw0 = ENG.cam.yaw, pit0 = ENG.cam.pitch;
    ENG.cam.yaw += 1.2; ENG.cam.pitch = 0.8;          // 鏡頭轉開，公告板要跟著轉過來
    ENG.updateCamera(0.001); draw(); ENG.render();
    const dot1 = sm ? faceOf() : -1;
    // 轉回去：yaw/pitch 不歸位的話，後面驗取景的測試量到的是這裡留下的角度
    ENG.cam.yaw = yaw0; ENG.cam.pitch = pit0;
    ENG.updateCamera(0.001);
    while (magics) step(0.05);
    for (let i = 0; i < 140; i++) step(0.05);
    clearFires();
    const lay = MAG_LAYER.map(L => +(0.12 + MAG_R * L.y).toFixed(1));
    /* 一顆一顆撒的那些按高度分組。只數「滿陣之後」的：長的那 1.75 秒上層根本還沒出現，
       把那一段算進來的話低層本來就會多一截，那不是分佈不均是它還沒長出來。 */
    const each = lay.map(y => calls.filter(c => c.n === 1 && c.y === y && c.el > 2).length);
    return { peak, lastAt, pops, drawn, dot0, dot1, gap, lay, each, casts: 3,
             burst: calls.filter(c => c.n > 1).map(c => c.y),
             sprinkle: calls.filter(c => c.n === 1).length,
             stray: calls.filter(c => lay.indexOf(c.y) < 0).length };
  });
  ok('每長出一層就在那一圈撒一把十字星光',
     mgStar.burst.length === 6 * mgStar.casts &&
     mgStar.burst.every((y, i) => y === mgStar.lay[i % 6]) &&
     mgStar.stray === 0 && mgStar.peak > 10,
     '每次施法六層各撒一把（高度 ' + mgStar.burst.slice(0, 6).join('／') +
     '），最多同時 ' + mgStar.peak + ' 顆在場上');
  /* v1.48：陣在場上的時候就一直撒，而且平均分在每一層。
     “平均”是隨機挑層、機率一樣，所以驗的是「六層都分得到、最少的不會少於最多的一半」，
     不是皮的相等（它本來就是隨機的）。 */
  /* 「平均」是隨機挑層、機率一樣，所以門檻要照**取樣數**算，不能用固定的百分比：
     每層的次數服從二項分佈，σ = √(n·(1/6)·(5/6))，三次施法約 190 顆時 σ≈5.2。
     容許到 4σ——系統性的偏（某一層拿不到、或某一層拿兩倍）一定抓得到，
     而純運氣造成的誤判低於萬分之五。用 ±45% 那種固定門檻的話，這條大約 3% 的機率會假失敗
     （實測跑到一次 16／35／35／31／35／39，那 16 只是運氣）。 */
  const avg = mgStar.each.reduce((a, b) => a + b, 0) / mgStar.each.length;
  const sd = Math.sqrt(avg * 6 * (1 / 6) * (5 / 6));
  ok('陣在場上就一直撒，而且六層平均分',
     mgStar.sprinkle > 200 && mgStar.each.every(n => Math.abs(n - avg) < 4 * sd) &&
     mgStar.lastAt > 5.5 && mgStar.gap <= 2,
     '三次施法一共又撒了 ' + mgStar.sprinkle + ' 顆；滿陣之後那些六層各分到 ' +
     mgStar.each.join('／') + '（平均 ' + avg.toFixed(1) + '，容許 ±' +
     (4 * sd).toFixed(1) + '）；最後一顆在 ' +
     mgStar.lastAt + ' 秒（爆炸在 6），中間最長斷 ' + mgStar.gap + ' 幀');
  ok('星光是一閃：亮起來快、收得慢',
     mgStar.pops.length > 3 && Math.max(...mgStar.pops) > 0.9 &&
     mgStar.pops[0] < 0.6 && mgStar.pops[mgStar.pops.length - 1] < 0.4,
     '亮度 ' + mgStar.pops.join('→'));
  ok('星光真的畫出來了，而且鏡頭轉到哪都正對著鏡頭',
     mgStar.drawn > 0 && mgStar.dot0 > 0.99 && mgStar.dot1 > 0.99,
     '畫了 ' + mgStar.drawn + ' 顆，法線與視線的 |cos| ＝ ' + mgStar.dot0 +
     '，鏡頭轉開後 ' + mgStar.dot1);

  /* v1.47 新增：火球收乾之後，爆點還會往四周劈三秒的藍色閃電。
     稀疏、從爆點出發、純特效。最後一條用像素驗——讀狀態只能證明資料在，
     證明不了使用者看得到（加法混色的藍在白天空上就是看不到的，踩過）。 */
  const mgArc = await page.evaluate(() => {
    startBuild(true); completeNow();
    castMagic({ x: 0, z: 0 });
    while (magics) step(0.05);
    let t = 0, first = -1, last = -1, peak = 0, ball = -1;
    const from = [], to = [];
    for (let i = 0; i < 100; i++) {                   // 爆炸後五秒
      step(0.05); t += 0.05;
      if (!bolts.length) continue;
      if (first < 0) { first = +t.toFixed(2); ball = flashes.length; }
      last = +t.toFixed(2);
      peak = Math.max(peak, bolts.length);
      for (const b of bolts) if (b.pts.length === ARC_SEG + 1) {     // 主幹，不是分岔那條
        const p = b.pts[0], q = b.pts[b.pts.length - 1];
        from.push(Math.hypot(p.x, p.y - MAG_CORE_Y, p.z));
        to.push(Math.hypot(q.x, q.z));
      }
    }
    /* 顏色與可見度：等煙散乾淨之後，自己造一道**固定**的電，量「有電」與「沒電」的差。
       不在放電當下隨機挑一幀量——會抽到「整道電剛好埋在煙柱裡」：塵霧是半透明的，
       疊個十層就把電蓋掉，量到 0 不是沒畫而是被蓋住（踩過，同一份程式一次 892 一次 0）。
       這裡量的是引擎那一段：同樣走 draw() → putBolts → 真的 WebGL。 */
    for (let i = 0; i < 200; i++) step(0.05);         // 十秒：煙散乾淨
    clearFires();
    /* 量顏色之前先把鏡頭釘在這道電上（v1.55）。取景改成「建築底部置中」之後鏡頭退得更遠，
       同一道電在畫面上只剩三百個像素，其中一半是抗鋸齒的混色邊——那樣量到的是
       「鏡頭退多遠」而不是「電是不是藍的」。這一條要驗的是後者，所以視角自己定。 */
    ENG.camTarget.tx = ENG.cam.tx = 10; ENG.camTarget.tz = ENG.cam.tz = 0;
    ENG.camTarget.ty = ENG.cam.ty = 6.5; ENG.camTarget.dist = ENG.cam.dist = 46;
    ENG.updateCamera(0);
    const shot = () => {
      draw(); ENG.render();
      const gl = ENG.three.renderer.getContext();
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return px;
    };
    const pts = [];
    for (let i = 0; i <= ARC_SEG; i++) {
      const u = i / ARC_SEG;
      pts.push({ x: 20 * u, y: MAG_CORE_Y + (1 - MAG_CORE_Y) * u, z: 0 });
    }
    bolts.push({ pts, t: 0, life: 1, op: 1, w: 0.24 });
    const A = shot();
    bolts.length = 0;
    const B = shot();
    let px = 0, blue = 0;
    const tally = new Map();
    for (let k = 0; k < A.length; k += 4) {
      if (A[k] === B[k] && A[k + 1] === B[k + 1] && A[k + 2] === B[k + 2]) continue;
      px++;
      // 藍：藍分量明顯高過紅與綠。白煙與灰碎料的三個分量差不多，草地是綠的
      if (A[k + 2] > A[k] + 50 && A[k + 2] > A[k + 1] + 25) blue++;
      const key = A[k] + ',' + A[k + 1] + ',' + A[k + 2];
      tally.set(key, (tally.get(key) || 0) + 1);
    }
    /* 主證據取**出現最多次的那個顏色**，不是平均色：這條電有一段被霧往天空色洗
       （越遠越白）、邊緣還有抗鋸齒的混色，平均下來會被那些拉淡。
       最常出現的那個就是沒被洗到的本體顏色。 */
    let mode = [0, 0, 0], modeN = 0;
    for (const [key, n] of tally) if (n > modeN) { modeN = n; mode = key.split(',').map(Number); }
    /* 純特效：在完好的建築上直接放電三秒，一塊都不該少、也不該起火。
       （接在爆炸後面量的話分不出是誰弄倒的。） */
    startBuild(true); completeNow();
    const set0 = blocks.filter(b => b.st === 3).length;
    startArcs({ x: 0, y: MAG_CORE_Y, z: 0 }, MAG_R);
    for (let i = 0; i < 80; i++) step(0.05);
    const set1 = blocks.filter(b => b.st === 3).length, burn = fires ? fires.length : 0;
    bolts.length = 0; arcSrcs = null;                 // 收乾淨，別把電留給下一段測試
    return { first, last, ball, peak, set0, set1, burn, px, blue, mode, modeN,
             from: +Math.max(0, ...from).toFixed(2), n: to.length,
             reach: +Math.max(0, ...to).toFixed(1),
             mid: +(to.reduce((s, v) => s + v, 0) / (to.length || 1)).toFixed(1),
             R: MAG_R, life: FLASH_LIFE, want: ARC_TIME };
  });
  ok('火球收乾之後才開始劈電',
     mgArc.first >= mgArc.life - 0.06 && mgArc.first < mgArc.life + 0.4 && mgArc.ball === 0,
     '爆炸後 ' + mgArc.first + ' 秒第一道（火球亮 ' + mgArc.life + ' 秒，那時場上 ' +
     mgArc.ball + ' 顆火球）');
  ok('劈滿三秒，而且很稀疏',
     Math.abs((mgArc.last - mgArc.first) - mgArc.want) < 0.45 && mgArc.peak <= 4,
     mgArc.first + ' → ' + mgArc.last + ' 秒（' + (mgArc.last - mgArc.first).toFixed(2) +
     ' 秒），最多同時 ' + mgArc.peak + ' 道');
  ok('每一道都從爆點劈出去，電到周圍那一圈裡',
     mgArc.n > 10 && mgArc.from < 0.01 && mgArc.reach <= mgArc.R && mgArc.mid > mgArc.R * 0.3,
     mgArc.n + ' 道的起點都在爆點上（最遠 ' + mgArc.from + '），落點平均 ' + mgArc.mid +
     '、最遠 ' + mgArc.reach + '（範圍 ' + mgArc.R + '）');
  ok('閃電純特效，不拆房子也不點火', mgArc.set1 === mgArc.set0 && mgArc.burn === 0,
     '放電三秒後還是 ' + mgArc.set1 + ' 塊站著（原本 ' + mgArc.set0 + '），起火 ' +
     mgArc.burn + ' 處');
  ok('電是真的藍、而且看得到',
     mgArc.px > 200 && mgArc.blue > mgArc.px * 0.5 &&
     mgArc.mode[2] > mgArc.mode[0] + 50 && mgArc.mode[2] > mgArc.mode[1] + 25,
     '一道電在畫面上佔 ' + mgArc.px + ' 個像素，最多的那個顏色是 rgb(' +
     mgArc.mode.join(',') + ')×' + mgArc.modeN + '，逐點算有 ' + mgArc.blue + ' 個是藍的');

  /* v1.67：同時開三個陣，三處爆點就要各自劈電。
     本來放電的爆點是**一個變數**，後爆的那一發直接把前一處蓋掉，
     所以使用者看到的是「只有最後那發有藍色閃電」。
     電的起點就是它那一處的爆點（`boltPts` 兩端不抖，前一條已經量到起點離爆點 0），
     所以按 pts[0].x 分堆就分得出是哪一處劈的。 */
  const mgArc3 = await page.evaluate(() => {
    startBuild(true); completeNow();
    const at = [-20, 0, 20];
    for (const x of at) castMagic({ x, z: 0 });     // 同一幀開三個，六秒後同一幀爆
    while (magics) step(0.05);
    const frames = new Map(), peak = new Map();
    let srcs = 0, seg = 0, stray = 0;
    for (let i = 0; i < 80; i++) {                  // 爆炸後四秒（劈三秒，還有 0.65 秒的火球）
      step(0.05);
      srcs = Math.max(srcs, arcSrcs ? arcSrcs.length : 0);
      seg = Math.max(seg, boltList().length);
      const now = new Map();
      for (const b of bolts) {
        // 分岔那條是從主幹中段長出來的，起點不在爆點上——分堆只數主幹
        if (b.pts.length !== ARC_SEG + 1) continue;
        const k = Math.round(b.pts[0].x);
        now.set(k, (now.get(k) || 0) + 1);
        frames.set(k, (frames.get(k) || 0) + 1);
      }
      // 分岔也要記著自己屬於哪一處（額度是按 src 算的，記錯就會借到別處的額度）
      for (const b of bolts) if (!at.includes(Math.round(b.src.x))) stray++;
      for (const [k, n] of now) peak.set(k, Math.max(peak.get(k) || 0, n));
    }
    bolts.length = 0; arcSrcs = null;
    return { srcs, spots: frames.size, want: MAG_CAST, seg, stray,
             frames: at.map(x => frames.get(x) || 0),
             peak: at.map(x => peak.get(x) || 0), cap: ARC_MAX };
  });
  ok('三個陣同時爆，三處爆點都各自劈電（不是只有最後那發）',
     mgArc3.srcs === mgArc3.want && mgArc3.spots === 3 &&
     mgArc3.frames.every(n => n > 20),
     '同時 ' + mgArc3.srcs + ' 處在放電，四秒內三處各累計 ' + mgArc3.frames.join('／') + ' 道-幀');
  ok('額度是每一處各算的，加起來也塞得進引擎的池子',
     mgArc3.peak.every(n => n > 0 && n <= mgArc3.cap) && mgArc3.stray === 0 &&
     mgArc3.seg <= 96 * 3,
     '三處同時最多 ' + mgArc3.peak.join('／') + ' 道主幹（每處上限 ' + mgArc3.cap +
     '），畫面上最多 ' + mgArc3.seg + ' 段（池子 ' + (96 * 3) + '），認錯爆點的 ' +
     mgArc3.stray + ' 道');

  /* 魔法陣長層的音效（sndRune）拿掉了：六層一路響上去太吵，
     還蓋掉引力坍縮那一段該有的安靜。爆炸本身的 sndBoom 要留著——不是整個魔法變靜音。 */
  const mgSnd = await page.evaluate(() => ({ rune: typeof sndRune, boom: typeof sndBoom }));
  ok('魔法陣長層不再出聲', mgSnd.rune === 'undefined' && mgSnd.boom === 'function',
     'sndRune 是 ' + mgSnd.rune + '、sndBoom 還是 ' + mgSnd.boom);

  // 魔法爆炸也要有風壓（跟核彈同一套，只是顏色偏紅）
  const mgWind = await page.evaluate(() => {
    startBuild(true); completeNow();
    castMagic({ x: 0, z: 0 });
    let g = 0;
    while (magics && g++ < 200) step(0.05);
    const wd = dust.filter(d => d.keep).length;
    for (let i = 0; i < 60; i++) step(0.05);
    clearFires();
    return { wd, want: WIND_DUST };
  });
  ok('魔法爆炸也會掃出風壓', mgWind.wd === mgWind.want,
     '被風吹著跑的塵土 ' + mgWind.wd + ' 顆');
  /* 整疊都浮在半空：最下層離地也有一段，而且不做滿爆炸半徑——
     做滿的話那一圈會比建築大一大圈，看起來像地上的跑道而不是浮空的陣。 */
  ok('最下層浮在半空，也沒有大到蓋滿爆炸範圍',
     mgRing.rings[0].y > 8 && mgRing.ground < 30 * 0.8,
     '最下層離地 ' + mgRing.rings[0].y + '、半徑 ' + mgRing.ground + '（爆炸範圍 30）');
  /* 整疊要夠高。最寬那圈直徑就有 46.8，疊得矮的話遠看是一疊盤子不是一座法陣——
     這條線是使用者反映「太扁平」之後訂的（撐寬是 v1.93 照參考圖做的，高度沒動）。 */
  ok('整疊夠高，不是扁扁的一疊',
     mgRing.rings[5].y - mgRing.rings[0].y > 20,
     '最下層 ' + mgRing.rings[0].y + ' → 最上層 ' + mgRing.rings[5].y +
     '（高 ' + (mgRing.rings[5].y - mgRing.rings[0].y).toFixed(1) + '，最寬半徑 ' +
     Math.max(...mgRing.rings.map(o => o.r)).toFixed(1) + '）');

  /* 形狀（v1.93）：**上下大、中間細**的沙漏，而且照參考圖撐寬到最寬 0.78R——
     最上那圈直徑 46.8，超過整疊高度（22.5）的兩倍，遠看才是參考圖那個「寬而扁」的輪廓。
     每層各乘 0.82～1.18 的抖動（使用者要的「半徑保持有點隨機性」）。這裡守兩件事：
     ① 最寬的**一定**落在兩端（中間那幾層的上限 0.46×1.18 ＝ 0.54 搶不到）；
     ② **兩端都會輪到**——最下那圈的上限 0.62×1.18 ＝ 0.73 大過最上那圈的下限
        0.78×0.82 ＝ 0.64，所以偶爾會反過來，實測 300 次是最上 278～287、最下 13～22。
     不驗「最上最下同時是前二寬**不是每次**」：撐寬之後那句話幾乎每次都成立（實測
     98～100%），寫成 ends2 < N 等於在賭 300 次裡有沒有例外——v1.93.1 那輪就抽到 0 次
     例外而 FAIL。會變成這樣是因為抖動的隨機性搬家了：v1.54 那組上下兩層跟中間差得少，
     隨機性表現在「誰最寬」；現在表現在「兩端誰贏」。 */
  const mgShape = await page.evaluate(() => {
    const base = MAG_LAYER.map(L => L.r);
    const hist = [0, 0, 0, 0, 0, 0];
    let ends2 = 0;
    const N = 300;
    for (let k = 0; k < N; k++) {
      castMagic({ x: 0, z: 0 });
      const rs = MAG_LAYER.map((L, i) => L.r * magics[0].rj[i]);
      magics = null;                          // 每次只要那組抖動，別讓那些魔法陣累積下去
      let mi = 0;
      rs.forEach((v, i) => { if (v > rs[mi]) mi = i; });
      hist[mi]++;
      const order = rs.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]);
      if ([order[0][1], order[1][1]].every(i => i === 0 || i === 5)) ends2++;
    }
    for (const w of workers) w.flee = 0;
    return { base, hist, ends2, N, wide: Math.max(...base),
             mid: Math.max(...base.slice(1, 5)) };
  });
  ok('上下兩層最寬、中間收窄，而且整疊寬過它的高度',
     mgShape.base[0] > mgShape.mid && mgShape.base[5] > mgShape.mid &&
     mgShape.wide > 0.7 && mgShape.wide <= 0.8,
     '各層 ' + mgShape.base.join('／') + 'R（中間最寬的一層 ' + mgShape.mid +
     'R；最寬那圈直徑 ' + (mgShape.wide * 60).toFixed(1) + '，整疊高 22.5）');
  ok('最寬的一圈一定落在最上或最下，而且兩端都會輪到',
     mgShape.hist[0] + mgShape.hist[5] === mgShape.N &&
     mgShape.hist[0] > 0 && mgShape.hist[5] > 0 && mgShape.ends2 / mgShape.N > 0.95,
     mgShape.N + ' 次施法：最寬落在第 ' + mgShape.hist.map((v, i) => i + '層' + v).join('／') +
     '，最上最下同時是前二寬的有 ' + (mgShape.ends2 / mgShape.N * 100).toFixed(0) + '%');

  /* 配色（v1.93，照使用者新給的參考圖）：**紅橘的場 #cb2306 + 亮黃的鑲邊與線條
     #fcf534**，外圈再暈一圈同色相、明度推滿的 #ff2e0a（暗紅拿去加法混色會被綠地吃掉）。
     v1.62.1～v1.92 是桃紅的場配金黃的鑲邊，那是另一張參考圖。
     盤是引擎那邊發的，所以直接去場上抓那幾片盤的材質顏色——只驗 game-tools.js 裡的色碼
     會漏掉「盤沒吃到 fc、跟著芯一起變黃」的情況（那會讓整片糊成一大片黃，鑲邊就不見了）。
     v1.62 起火種不墊盤（參考圖裡那個火圈中間是空的），所以盤只剩六片，
     火種的顏色改驗它自己那三圈。 */
  const mgHue = await page.evaluate(() => {
    startBuild(true); completeNow();
    castMagic({ x: 0, z: 0 });
    for (let i = 0; i < 100; i++) step(0.05);
    draw(); ENG.render();
    const lay = magics[0].rings.filter(o => !o.seed);
    const seed = magics[0].rings.filter(o => o.seed);
    let grp = null;
    ENG.three.scene.traverse(o => {
      if (!grp && o.geometry && o.geometry.type === 'RingGeometry') grp = o.parent;
    });
    const discs = grp.children.filter(o => o.visible && o.geometry &&
                                           o.geometry.type === 'CircleGeometry');
    return { core: lay.find(o => !o.add).c, halo: lay.find(o => o.add).c,
             fc: lay.find(o => !o.add).fc,
             seed: seed.map(o => o.c), seedN: seed.length,
             seedFill: seed.filter(o => o.fill).length,
             discs: discs.map(d => d.material.color.getHex()),
             spoke: grp.children.find(o => o.isInstancedMesh).material.color.getHex() };
  });
  const hex = c => '#' + c.toString(16).padStart(6, '0');
  ok('陣是紅橘的場配亮黃的鑲邊與紋路，火圈是亮黃到紅粉',
     mgHue.core === 0xfcf534 && mgHue.fc === 0xcb2306 && mgHue.halo === 0xff2e0a &&
     mgHue.spoke === 0xfcf534 &&
     mgHue.discs.length === 6 && mgHue.discs.every(c => c === mgHue.fc) &&
     mgHue.seed.join() === [0xfff3c4, 0xff8a3c, 0xff2f6b].join(),
     '鑲邊 ' + hex(mgHue.core) + '、盤 ' + hex(mgHue.fc) + '（' + mgHue.discs.length +
     ' 片，實際畫出來的顏色 ' + hex(mgHue.discs[0]) + '）、外暈 ' + hex(mgHue.halo) +
     '、紋路 ' + hex(mgHue.spoke) + '、火圈 ' + mgHue.seed.map(hex).join(' → '));
  /* 使用者要的「比較單純的火圈」：中間**不要**那片填滿的盤（參考圖裡它是空心的），
     三圈貼著疊成一條管子——下一圈的內緣（0.93×半徑）要接得上上一圈的外緣，
     中間空一段的話看起來會是「一片光餅外面另外套一個圈」，正是要改掉的那個樣子。 */
  const mgSeedRing = await page.evaluate(() => {
    const s = magics[0].rings.filter(o => o.seed).map(o => +o.r.toFixed(3));
    return { s, fill: magics[0].rings.filter(o => o.seed && o.fill).length,
             gap: s.slice(1).map((r, i) => +(r * 0.93 - s[i]).toFixed(3)) };
  });
  ok('火種是單純的火圈：中間空的，三圈疊成一條管子',
     mgSeedRing.fill === 0 && mgSeedRing.s.length === 3 &&
     mgSeedRing.gap.every(g => g <= 0.01),
     '三圈半徑 ' + mgSeedRing.s.join('／') + '（中間 ' + mgSeedRing.fill +
     ' 片盤；下一圈內緣與上一圈外緣的落差 ' + mgSeedRing.gap.join('／') + '，要 ≤0）');

  /* 邊緣的不規則是**螺旋狀**的（v1.62.1，照參考圖）：不是把環的外緣弄皺，
     是幾道沿著邊掃出去的筆觸疊在一起，尾巴伸出環外那一截撐出鼓鼓的邊。
     （v1.62 曾經真的去弄皺環的外緣，使用者看了說「不是現在的歪歪扭扭」。）
     三件事要驗，缺一條就會退回去那個樣子：
     ① 真的有東西掃到環外（不然邊就只是那個正圓）。
     ② 輪廓是**不規則**的：某些角度伸到 1.15R 外，某些角度就停在環上。
     ③ 那些筆觸是**螺旋**：方向跟半徑方向有夾角。等半徑的圓弧夾角是 0
        （外圈那一圈虛線就是這樣，拿它當對照組）。
     直接餵 ENG.setRings 兩個環（一個要紋路、一個不要），不必挑場上第幾個是哪一層；
     順便驗環本身回到正圓、而且幾何體是共用的一顆。 */
  const mgRim = await page.evaluate(() => {
    const R = 10;
    ENG.setRings([{ x: 0, z: 0, y: 1, r: R, op: 1, c: 0xffffff, sp: 1, fill: 1 },
                  { x: 0, z: 0, y: 1, r: R, op: 1, c: 0xffffff }]);
    let grp = null;
    ENG.three.scene.traverse(o => {
      if (!grp && o.geometry && o.geometry.type === 'RingGeometry') grp = o.parent;
    });
    const ms = grp.children.filter(o => o.isMesh && o.geometry &&
                                        o.geometry.type === 'RingGeometry');
    const sp = grp.children.find(o => o.isInstancedMesh);
    const M = new THREE.Matrix4(), P = new THREE.Vector3();
    const X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3();
    const BINS = 36;
    const bins = new Array(BINS).fill(0);      // 每個角度方向上，畫到最遠是幾倍半徑
    let out = 0, radial = 0, dash = 0, dashRadial = 0;
    for (let i = 0; i < sp.count; i++) {
      sp.getMatrixAt(i, M);
      P.setFromMatrixPosition(M);
      M.extractBasis(X, Y, Z); X.normalize();          // local +X 就是這一段的走向
      const rad = Math.hypot(P.x, P.z) / R;
      const a = Math.atan2(P.z, P.x);
      const b = Math.floor(((a % 6.283) + 6.283) / 6.283 * BINS) % BINS;
      if (rad > bins[b]) bins[b] = rad;
      // 走向與半徑方向的夾角餘弦：0 = 純繞圈，越大越像往外爬
      const dot = Math.abs(X.x * Math.cos(a) + X.z * Math.sin(a));
      if (rad > 1.05) { out++; radial += dot; }
      if (Math.abs(rad - 0.88) < 0.01) { dash++; dashRadial += dot; }   // 對照組：外圈虛線
    }
    const g = ms[0].geometry.attributes.position;
    let lo = 9, hi = 0;
    for (let i = 0; i < g.count; i++) {
      const r = Math.hypot(g.getX(i), g.getY(i));
      if (r > 0.965) { lo = Math.min(lo, r); hi = Math.max(hi, r); }
    }
    return { out, radial: out ? +(radial / out).toFixed(3) : 0,
             dash, dashRadial: dash ? +(dashRadial / dash).toFixed(3) : 0,
             far: +Math.max(...bins).toFixed(2), near: +Math.min(...bins).toFixed(2),
             ringLo: +lo.toFixed(3), ringHi: +hi.toFixed(3),
             shared: ms[0].geometry.uuid === ms[1].geometry.uuid };
  });
  ok('邊上有掃出環外的筆觸，輪廓不是一條正圓',
     mgRim.out > 20 && mgRim.far >= 1.15 && mgRim.near <= 1.05,
     mgRim.out + ' 段掃到環外；36 個方向上畫到最遠 ' + mgRim.far + 'R、最近 ' +
     mgRim.near + 'R（都一樣就是一條正圓的邊）');
  ok('那些筆觸是螺旋的，不是一截等半徑的圓弧',
     mgRim.radial > 0.05 && mgRim.dash > 0 && mgRim.dashRadial < 0.02,
     '筆觸的走向與半徑方向夾角餘弦平均 ' + mgRim.radial +
     '（對照組：外圈那一圈等半徑的虛線 ' + mgRim.dashRadial + '，' + mgRim.dash + ' 段）');
  ok('環本身回到正圓，而且幾何體是共用的一顆',
     mgRim.ringLo === 1 && mgRim.ringHi === 1 && mgRim.shared,
     '環的外緣 ' + mgRim.ringLo + '～' + mgRim.ringHi + ' R（共用：' + mgRim.shared + '）');

  /* 拉高之後整疊頂端會頂出畫面上緣（矮建築取景近）。跟龍捲風、蘑菇雲同一套：
     施法期間鏡頭先退開。NDC y 超過 1 就是被切掉，量的是最上層外緣那一點。 */
  const mgCam = await page.evaluate(() => {
    const one = shape => {
      shapePick = SHAPES.findIndex(s => s.n === shape);
      targetCnt = 800; startBuild(true); completeNow();
      for (let i = 0; i < 200; i++) step(0.05);        // 讓剛蓋好的這座沉澱一下
      const d0 = ENG.cam.dist;                         // startBuild(true) 已經照這座重新取景
      // 這一陣「要」退到多遠：問一次 holdWide，問完把鏡頭放回去（測試不自己複製公式）
      const ty0 = ENG.camTarget.ty;
      ENG.camTarget.dist = 6; ENG.camTarget.ty = 0; ENG.holdWide(MAG_TOP, MAG_WIDE);
      const need = ENG.camTarget.dist;
      ENG.camTarget.dist = d0; ENG.camTarget.ty = ty0;
      castMagic({ x: 0, z: 0 });
      for (let i = 0; i < 100; i++) step(0.05);        // 5 秒：六層都在
      const top = Math.max(...magics[0].rings.map(o => o.y));
      const wide = magics[0].rings.reduce((s, o) => Math.max(s, o.r), 0);
      const v = new THREE.Vector3(wide, top, 0).project(ENG.three.camera);
      return { d0: +d0.toFixed(0), need: +need.toFixed(0), dist: +ENG.cam.dist.toFixed(0),
               top: +top.toFixed(1), ndc: +v.y.toFixed(2) };
    };
    const r = { pyramid: one('吉薩金字塔'), castle: one('新天鵝堡') };
    shapePick = -1;
    return r;
  });
  /* 矮建築（金字塔取景很近）要退才裝得下整疊；城堡本來就退得夠遠，就不該再多退一截。
     兩座都驗頂端沒被切掉——那才是運鏡真正要保證的事。 */
  ok('施法時鏡頭退到整疊進得了畫面，而且不會退過頭',
     Math.abs(mgCam.pyramid.dist - Math.max(mgCam.pyramid.d0, mgCam.pyramid.need)) <= 1 &&
     Math.abs(mgCam.castle.dist - Math.max(mgCam.castle.d0, mgCam.castle.need)) <= 1 &&
     mgCam.pyramid.ndc < 0.95 && mgCam.castle.ndc < 0.95,
     '吉薩金字塔視距 ' + mgCam.pyramid.d0 + ' → ' + mgCam.pyramid.dist +
     '（陣要 ' + mgCam.pyramid.need + '），頂端 NDC ' + mgCam.pyramid.ndc +
     '／城堡 ' + mgCam.castle.d0 + ' → ' + mgCam.castle.dist + '，NDC ' + mgCam.castle.ndc);

  /* 衝擊波是球狀的，而且越靠近炸心抬得越高——積木要沿拋物線拋上去再落下，
     不是貼著地面掃出去。只量「有沒有飛出去」的話，兩種都會過。 */
  const arc = await page.evaluate(() => {
    startBuild(true); completeNow();
    explode({ x: 0, y: 2.5, z: 0 }, 30, 34);
    const fly = blocks.filter(b => b.st === 4);
    const avgVy = a => a.reduce((s, b) => s + b.vy, 0) / Math.max(1, a.length);
    const nearVy = avgVy(fly.filter(b => Math.hypot(b.x, b.z) < 8));
    const farVy = avgVy(fly.filter(b => Math.hypot(b.x, b.z) > 20));
    let peak = 0, air = 0;
    for (let i = 0; i < 120; i++) {
      step(0.05);
      let flying = 0;
      for (const b of blocks) if (b.st === 4) { flying++; if (b.y > peak) peak = b.y; }
      if (flying > fly.length * 0.5) air += 0.05;   // 一半以上還在空中就算滯空
    }
    return { n: fly.length, nearVy, farVy, peak, air };
  });
  ok('炸開的積木是拋上去的，不是貼地掃出去', arc.peak > 25 && arc.air > 1.5,
     arc.n + ' 塊飛出去，最高 ' + arc.peak.toFixed(0) + '、滯空 ' + arc.air.toFixed(1) + ' 秒');
  ok('越靠近炸心抬得越高', arc.nearVy > arc.farVy * 1.6,
     '近處起飛速度 ' + arc.nearVy.toFixed(0) + '、遠處 ' + arc.farVy.toFixed(0));

  /* 先收縮後爆發：陣在充能時把周圍碎料往中心捲，六秒到再全部噴出去。
     只驗「有沒有吸」不夠——吸完要能噴回去才是那個反差。 */
  const imp = await page.evaluate(() => {
    /* 建築要指定：外圈那些積木是「被吸的對象」，隨機藍圖抽到小又矮的話
       siteR 會被 7 這個下限撐開，一塊都選不到，量到的就是 0 塊在吸。 */
    shapePick = SHAPES.findIndex(s => s.n === '新天鵝堡');
    targetCnt = 1500; startBuild(true); completeNow();
    shapePick = -1;
    const loose = [];
    for (const b of blocks) {
      if (loose.length >= 80) break;
      if (b.st !== 3 || Math.hypot(b.x, b.z) < siteR * 0.8) continue;
      if (b.slot >= 0) { bp.slots[b.slot].filled = false; b.slot = -1; }
      const a = Math.random() * Math.PI * 2, rad = 16 + Math.random() * 11;
      b.st = 0; b.rest = true; b.x = Math.cos(a) * rad; b.z = Math.sin(a) * rad; b.y = HB;
      b.vx = b.vy = b.vz = 0;
      loose.push(b);
    }
    const mean = () => loose.reduce((s, b) => s + Math.hypot(b.x, b.z), 0) / loose.length;
    castMagic({ x: 0, z: 0 });
    for (let i = 0; i < 30; i++) step(0.05);        // 1.5 秒：吸力剛要開始
    const d0 = mean();
    for (let i = 0; i < 80; i++) step(0.05);        // 5.5 秒：吸了四秒
    const d1 = mean(), motes = hot.filter(h => h.pull).length;
    for (let i = 0; i < 30; i++) step(0.05);        // 過 6 秒：炸開，再看一秒後噴到哪
    return { n: loose.length, d0, d1, d2: mean(), motes };
  });
  ok('魔法陣充能時會把碎料往陣心捲進去', imp.d1 < imp.d0 * 0.85,
     imp.n + ' 塊碎料離陣心 ' + imp.d0.toFixed(1) + ' → ' + imp.d1.toFixed(1));
  ok('陣上會冒出往中心捲的魔力光點', imp.motes > 10, imp.motes + ' 顆');
  ok('六秒一到再把它們全噴出去', imp.d2 > imp.d1 * 1.2,
     '爆炸後 ' + imp.d1.toFixed(1) + ' → ' + imp.d2.toFixed(1));

  /* 陣還在充能時跌破「剩不到 25% 就換下一座」那條線，也不能換：那一發是衝著這一座
     來的，換掉的話玩家看到的是建築憑空消失（v1.59 之前還會連陣一起收掉）。
     v1.62 起陣自己只剝得走兩成，光靠它跌不破那條線了，所以這裡**手動**把建築打到
     剩不到 25%（等同玩家在充能那六秒又補了幾發）——要驗的規則沒變，只是換個方式把
     場面推到那個狀態。phase 也要一起推到 wreck：那條分支只在拆除中才會走到。 */
  const mgHold = await page.evaluate(() => {
    shapePick = SHAPES.findIndex(s => s.n === '新天鵝堡');
    targetCnt = 900; startBuild(true); completeNow();
    const total0 = bp.slots.length;
    castMagic({ x: 0, z: 0 });
    const floor = Math.floor(total0 * WRECK_AT) - 20;      // 打到比換場線再低一截
    for (const b of blocks) {
      if (placedCnt <= floor) break;
      if (b.st === 3) breakBlock(b, 0, 0, 0);
    }
    phase = 'wreck';
    for (let i = 0; i < 118; i++) step(0.05);          // 5.9 秒：早就跌破那條線了
    const mid = { alive: !!magics, placed: placedCnt, gate: Math.floor(total0 * WRECK_AT),
                  same: bp.slots.length === total0, dest: stats.destroyed };
    for (let i = 0; i < 8; i++) step(0.05);            // 過 6 秒：炸完、這時候才輪得到換場
    const out = { mid, after: !!magics, boom: flashes.length > 0, dest: stats.destroyed };
    for (let i = 0; i < 70; i++) step(0.05);           // 換場前還要等 SWAP_WAIT 秒讓爆炸演完
    out.dest = stats.destroyed;
    shapePick = -1;
    return out;
  });
  ok('陣還在充能就不換下一座，那一發才炸得成',
     mgHold.mid.alive && mgHold.mid.same && mgHold.mid.placed < mgHold.mid.gate &&
     !mgHold.after && mgHold.boom && mgHold.dest > mgHold.mid.dest,
     '5.9 秒時只剩 ' + mgHold.mid.placed + ' 塊（換場線 ' + mgHold.mid.gate +
     '）仍沒換場，爆完才記一座拆除');

  /* 雲頂會升到 40 以上，貼著建築的取景根本裝不下——引爆時鏡頭要退開。
     退開之後就停在那裡：自己收回來的話等於每發都把鏡頭搶走兩次。
     建築鎖同一座，換場後的取景距離才有得比。 */
  const camFx = await page.evaluate(() => {
    /* 要一座「開場取景比雲需要的距離還近」的小建築，才驗得到鏡頭真的退開。
       v1.66 起城堡（新天鵝堡）最小就是 4450 塊、取景已經在 137，退不動了，所以改用金字塔。 */
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    // startBuild(true) 會照這座重新取景，量到的 d0 就是「沒退開」的基準
    targetCnt = 900; startBuild(true); completeNow();
    const d0 = ENG.camTarget.dist, ty0 = ENG.camTarget.ty;
    // 這朵雲「要」退到多遠：問一次 holdWide，問完把鏡頭放回去（測試不自己複製公式）
    ENG.camTarget.dist = 6; ENG.camTarget.ty = 0; ENG.holdWide(NUKE_R * 1.3, NUKE_R * 0.55);
    const need = ENG.camTarget.dist;
    ENG.camTarget.dist = d0; ENG.camTarget.ty = ty0;
    callNuke({ x: 0, z: 0 });
    for (let i = 0; i < 58; i++) step(0.05);        // 引爆
    const wide = ENG.camTarget.dist, ty = ENG.camTarget.ty;
    for (let i = 0; i < 60; i++) step(0.05);        // 3 秒後：雲正高，還要維持
    const hold = ENG.camTarget.dist;
    for (let i = 0; i < 160; i++) step(0.05);       // 再等 8 秒（雲早就散了，還換過場）
    const back = ENG.camTarget.dist;
    // 連炸第二發不該再往外跳一次：退開取的是「現在」與「這一發要的」之中的大者
    callNuke({ x: 0, z: 0 });
    for (let i = 0; i < 58; i++) step(0.05);
    const again = ENG.camTarget.dist;
    shapePick = -1;
    return { d0, need, wide, ty, hold, back, again };
  });
  ok('核彈引爆時鏡頭會退開，整朵雲才進得了畫面',
     camFx.wide > camFx.d0 && camFx.hold === camFx.wide,
     '視距 ' + camFx.d0.toFixed(0) + ' → ' + camFx.wide.toFixed(0) +
     '（視線高度 ' + camFx.ty.toFixed(0) + '），三秒後仍維持');
  /* 退開的距離是照雲的尺寸算的，不是隨便乘一個倍率：多退一截等於把玩家的鏡頭多搶走一截 */
  ok('只退到整朵雲進得了畫面那麼遠', Math.abs(camFx.wide - Math.max(camFx.d0, camFx.need)) < 0.01,
     '雲要 ' + camFx.need.toFixed(0) + '、原本取景 ' + camFx.d0.toFixed(0) +
     ' → 退到 ' + camFx.wide.toFixed(0));
  ok('退開之後不會自己收回來', camFx.back === camFx.wide,
     '八秒後（含換場）仍是 ' + camFx.back.toFixed(0) + '（原本 ' + camFx.d0.toFixed(0) + '）');
  ok('連炸第二發不會再退得更遠', camFx.again === camFx.wide,
     '第二發後 ' + camFx.again.toFixed(0) + '（第一發 ' + camFx.wide.toFixed(0) + '）');

  /* 倒數中換建築（v1.59 反過來了）：倒數中的道具**不收**，照樣數完、照樣炸下去。
     本來是全部清掉——理由是「留著會炸到剛蓋好的新那座」，但那一瞬間畫面上所有東西
     同時消失，正是「換場感」的來源。會不會波及新的那座，本來就該是它們的事。 */
  const swap = await page.evaluate(() => {
    cleanTools(); startBuild(true); completeNow();
    placeBomb({ x: 3, y: 2, z: 3 }); callNuke({ x: 0, z: 0 }); castMagic({ x: 5, z: 5 });
    callMeteor({ x: -4, y: 2, z: 2 });
    const cnt = () => [bombs ? bombs.length : 0, nukes ? nukes.length : 0, magics ? magics.length : 0,
                       meteors ? meteors.length : 0].join(',');
    const armed = cnt();
    startBuild(true);
    const after = cnt();
    /* 「真的炸了」看火球：換場當下新的那座還沒蓋起來，炸在空地上砸不到任何積木，
       拿 stats.smashed 當證據會是 0。火球是爆炸自己留下的東西，跟現場有沒有積木無關。 */
    let sawFlash = 0;
    for (let i = 0; i < 200; i++) {                     // 10 秒：四個的倒數都早就到了
      step(0.05);
      sawFlash = Math.max(sawFlash, flashes.length);
    }
    return { armed, after, sawFlash, left: cnt(), phase };
  });
  ok('換建築不會把倒數中的道具收掉', swap.after === swap.armed && swap.armed === '1,1,1,1',
     '炸彈／核彈／魔法／隕石：換之前 ' + swap.armed + ' → 換之後 ' + swap.after);
  ok('它們照樣數完、照樣炸下去', swap.sawFlash > 0 && swap.left === '0,0,0,0',
     '十秒後全部引爆完畢（' + swap.left + '），期間同時最多 ' + swap.sawFlash + ' 顆火球');

  /* 核彈可以同時好幾顆（v1.59，本來是「一次一顆，再點會改打新地點」）。
     七個部位全部塞進同一顆 InstancedMesh，所以幾顆都只吃一個 draw call。 */
  const nukeMany = await page.evaluate(() => {
    /* 場上所有 InstancedMesh 的 instance 數。核彈那一顆會從 7（一顆）變成 21（三顆），
       靠這個變化把它認出來——不必知道它在場景樹的哪個位置。 */
    const counts = () => {
      const a = [];
      ENG.three.scene.traverse(o => { if (o.isInstancedMesh) a.push(o.count); });
      return a;
    };
    /* 量 draw call 之前先把頭上的表情圖示清掉（v1.128 修間歇性失敗）。
       核彈一叫下去，警報會讓附近的人開始逃命，逃命就會在頭上冒一個「！」
       （v1.121 的 showEmo），而 emoMesh 是「有人在冒才顯示」——
       它一出現整場就多 2 個 draw call。一顆核彈嚇到幾個人、三顆嚇到幾個人、
       量的那一幀圖示還在不在，全是隨機的，於是 calls1／calls3 會在 14 與 16 之間跳。
       實測 8 輪：兩種狀態各出現過，而且**唯一**的差別就是 emoMesh 在不在
       （其餘 12 顆 mesh 完全一樣）。
       這一條要驗的是「幾顆核彈都共用同一顆 InstancedMesh」，跟表情圖示無關，
       所以量之前把它歸零——不是放寬門檻，是把不相干的變因拿掉。 */
    const noEmo = () => { for (const w of workers) { w.emo = ''; w.emoT = 0; w.emoK = 0; } };
    const fall = () => { while (nukes && nukes[0].t > NUKE_FALL) step(0.02); step(0.02); };
    cleanTools(); startBuild(true); completeNow();
    callNuke({ x: 0, z: 0 });
    fall(); noEmo(); draw(); ENG.render();
    const c1 = counts(), calls1 = ENG.info().calls;

    cleanTools();
    for (let i = 0; i < 3; i++) callNuke({ x: (i - 1) * 24, z: 0 });
    const armed = nukes.length;
    fall(); noEmo(); draw(); ENG.render();
    const c3 = counts(), calls3 = ENG.info().calls;
    const flying = nukes ? nukes.length : 0;
    const hi = nukes ? Math.max(...nukes.map(n => n.y)) : -1;

    // nukeHit 是 function 宣告（掛在 global 上），覆寫它就數得到真的炸了幾次
    const orig = nukeHit; let boom = 0;
    nukeHit = p => { boom++; orig(p); };
    let g = 0;
    while (nukes && g++ < 400) step(0.02);
    nukeHit = orig;

    cleanTools();
    for (let i = 0; i < 6; i++) callNuke({ x: i * 9 - 22, z: 0 });   // 連叫六顆
    const capped = nukes.length;
    cleanTools();
    const idx = c1.map((v, i) => (v === 7 && c3[i] === 21 ? i : -1)).filter(i => i >= 0);
    return { armed, flying, boom, capped, max: NUKE_MAX, calls1, calls3, idx: idx.length,
             hi: +hi.toFixed(0) };
  });
  ok('核彈可以同時好幾顆，每一顆各自掉、各自炸',
     nukeMany.armed === 3 && nukeMany.flying === 3 && nukeMany.boom === 3,
     '同時叫 3 顆 → 3 顆一起掉（最高的在 y=' + nukeMany.hi + '）→ 炸了 ' + nukeMany.boom + ' 次');
  ok('幾顆核彈都只吃一個 draw call',
     nukeMany.idx === 1 && nukeMany.calls3 === nukeMany.calls1,
     '一顆 7 個 instance、三顆 21 個，都是同一顆 InstancedMesh；draw call ' +
     nukeMany.calls1 + ' → ' + nukeMany.calls3);
  ok('核彈超過上限就把最早那顆擠掉', nukeMany.capped === nukeMany.max,
     '連叫 6 顆 → 場上 ' + nukeMany.capped + ' 顆（上限 ' + nukeMany.max + '）');

  /* 爆裂魔法也可以同時好幾個（v1.59）。引擎那邊的環／盤／紋路池子要放得下：
     一個陣吃 15 個環（六層×2 ＋ 火種 3）與 7 片盤，三個就是 45 與 21。 */
  const magMany = await page.evaluate(() => {
    cleanTools(); startBuild(true); completeNow();
    for (let i = 0; i < 3; i++) castMagic({ x: (i - 1) * 26, z: 0 });
    const cast = magics.length;
    for (let i = 0; i < 40; i++) step(0.05);          // 2 秒：三個陣都長滿六層了
    const rings = magics.reduce((n, m) => n + (m.rings ? m.rings.length : 0), 0);
    const layers = magics.map(m => m.shown).join('/');
    const at = magics.map(m => +m.x.toFixed(0)).join('/');
    draw();
    /* 真的畫出來幾個環／幾片盤：池子不夠的話會被截掉，畫面上就少一個陣的圖案 */
    let vis = 0, disc = 0;
    ENG.three.scene.traverse(o => {
      if (!o.isMesh || !o.visible || !o.parent.visible || !o.geometry) return;
      if (o.geometry.type === 'RingGeometry') vis++;
      if (o.geometry.type === 'CircleGeometry') disc++;
    });
    const fills = magics.reduce((n, m) => n + m.rings.filter(r => r.fill).length, 0);
    let g = 0, boom = 0;
    const orig = explode;
    while (magics && g++ < 300) {
      const before = magics.length;
      step(0.05);
      boom += before - (magics ? magics.length : 0);
    }
    cleanTools();
    for (let i = 0; i < 5; i++) castMagic({ x: i * 12 - 24, z: 8 });   // 連放五個
    const capped = magics.length;
    cleanTools();
    return { cast, rings, layers, at, vis, disc, fills, boom, capped, max: MAG_CAST };
  });
  ok('爆裂魔法可以同時好幾個，各長各的、各炸各的',
     magMany.cast === 3 && magMany.layers === '6/6/6' && magMany.boom === 3,
     '同時放 3 個（x=' + magMany.at + '）→ 兩秒後各自 ' + magMany.layers +
     ' 層 → 各自炸了（共 ' + magMany.boom + ' 次）');
  ok('三個陣的環與盤都畫得出來，不會被池子截掉',
     magMany.vis === magMany.rings && magMany.disc === magMany.fills && magMany.rings >= 45,
     '要 ' + magMany.rings + ' 個環、' + magMany.fills + ' 片盤 → 真的畫出 ' +
     magMany.vis + ' 個、' + magMany.disc + ' 片');
  ok('魔法陣超過上限就把最早那個擠掉', magMany.capped === magMany.max,
     '連放 5 個 → 場上 ' + magMany.capped + ' 個（上限 ' + magMany.max + '）');

  /* 一發核彈常常直接把整棟夷平，那會立刻觸發「剩不到 25% 就換下一座」。
     換場如果把特效也清掉，蘑菇雲就會在爆炸後 0.05 秒整朵消失——等於白做。
     這裡驗的是「換場了、但雲還在」，兩個條件缺一不可。

     藍圖要指定，不能沿用前面留下來的隨機值：核彈半徑 30 打不平所有造型，
     49 座裡有 13 座會剩超過 25%（掃過一輪：艾菲爾鐵塔剩 89%、巨石陣 62%、
     帝國大廈 58%、金門大橋、倫敦眼、鳥居……），抽到那些這條就會無故失敗。 */
  const keepFx = await page.evaluate(() => {
    const puffs = () => dust.filter(d => d.fade >= 3).length;   // 只算雲，碎料的火苗煙是 2.2
    shapePick = SHAPES.findIndex(s => s.n === '新天鵝堡');
    startBuild(true); completeNow();
    const ph0 = phase;
    callNuke({ x: 0, z: 0 });
    for (let i = 0; i < 58; i++) step(0.05);           // 炸下去
    const ph1 = phase;
    for (let i = 0; i < 24; i++) step(0.05);           // 1.2 秒後雲該長齊了
    const grown = puffs();
    for (let i = 0; i < 44; i++) step(0.05);           // 再 2.2 秒：等滿 SWAP_WAIT，這時候才換場
    return { ph0, ph1, phase, grown, cloud: puffs(), fire: hot.length };
  });
  ok('炸到整棟夷平而自動換場時，蘑菇雲不會跟著消失',
     keepFx.ph1 !== 'done' && keepFx.phase !== 'wreck' &&
     keepFx.grown > 90 && keepFx.cloud > 90,
     'phase ' + keepFx.ph0 + ' → ' + keepFx.ph1 + ' → ' + keepFx.phase +
     '，雲 ' + keepFx.grown + ' → ' + keepFx.cloud + ' 團、火球 ' + keepFx.fire + ' 顆');

  /* 餘火：三種爆炸都要在周圍點起火來。三個共用 explode()，但還是三個都測——
     哪天有人在某一支的路徑上繞過 explode，只測一種是看不出來的。

     兩件事決定了怎麼量：
     1. 取樣要落在**爆炸的那一幀**。整棟被夷平的話，下一幀就會觸發「剩不到 25%
        換下一座」，換場會把火一起收掉（積木要回收去蓋新的那座，不收的話新建築
        會從某幾塊莫名地燒起來）。
     2. 「還站著的燒起來」要用**比爆炸範圍大**的建築才量得到（萬里長城橫著鋪開，
        遠比半徑 30 寬）。半徑 30 蓋滿的一般建築，範圍內一塊都不會剩——
        那種情況的餘火是「帶著火飛出去的碎料」，另一條測試在量。
        **長城那兩發要 9000 那一檔**（v1.114）：換上新的長城藍圖之後 3000 那檔只有半徑 28.8
        （舊的 32.1），整條剛好落在魔法範圍內——實測魔法那一發打完只剩 2 塊站著，
        站著的餘火 0～2 塊，這條就變成擲骰子（四輪量到 24／1／1／0）。
        9000 那檔半徑 46、打完還剩 4010～4784 塊站著，核彈與魔法都穩定量到 24 塊。 */
  const emb = await page.evaluate(() => {
    /* armed() 回報「道具還在倒數」，用它偵測爆炸落在哪一幀，不用自己數步數：
       倒數秒數改一下、或哪天多一幀延遲，數死的步數就會量到爆炸前或換場後。 */
    const one = (shape, go, armed, cnt) => {
      targetCnt = cnt || 3000; shapePick = SHAPES.findIndex(s => s.n === shape);
      startBuild(true); completeNow();
      clearFires();
      go();
      let n = 0;
      while (armed() && n++ < 400) step(0.05);              // 停在爆炸的那一幀
      const lit = fires || [];
      return { set: lit.filter(f => f.b.st === 3).length,   // 還站著、會繼續蔓延的
               fly: lit.filter(f => f.b.st === 4).length,   // 被炸飛、拖著火落地的
               left: placedCnt, frame: n };
    };
    /* 變數不能取名 nukes／magics：那會遮住同名的全域狀態，armed() 讀到的就是自己 */
    const bombE = one('美國國會大廈', () => placeBomb({ x: 14, y: 4, z: 0 }), () => !!bombs);
    const nukeE = one('萬里長城', () => callNuke({ x: 0, z: 0 }), () => !!nukes, 9000);
    const magicE = one('萬里長城', () => castMagic({ x: 0, z: 0 }), () => !!magics, 9000);
    /* 「剛好被夷平」要挑矮的：核彈炸在接觸點上，打高樓時炸點在樓頂，
       下半截會留著（那些就會有站著的餘火）。金字塔頂只有 14 高，整座都在半徑內。 */
    const flatE = one('吉薩金字塔', () => callNuke({ x: 0, z: 0 }), () => !!nukes);
    return { bomb: bombE, nuke: nukeE, magic: magicE, flat: flatE };
  });
  ok('炸彈、核彈、魔法都會在周圍留下餘火',
     emb.bomb.set > 0 && emb.nuke.set > 0 && emb.magic.set > 0,
     '還站著又燒起來的：炸彈 ' + emb.bomb.set + ' 塊、核彈 ' + emb.nuke.set +
     ' 塊、魔法 ' + emb.magic.set + ' 塊');
  ok('剛好被夷平的那種爆炸，餘火是帶著火飛出去的碎料',
     emb.flat.fly > 0 && emb.flat.set === 0,
     '整棟只剩 ' + emb.flat.left + ' 塊站著，' + emb.flat.fly + ' 塊碎料帶著火');

  /* 沒在用的道具不該平白多吃 draw call：InstancedMesh 就算 count=0 也算一個 */
  const dc = await page.evaluate(() => {
    startBuild(true); completeNow();
    // 先等前面測試留下的煙與火球散乾淨，不然量到的是上一發爆炸的帳
    for (let i = 0; i < 320; i++) step(0.05);
    draw(); ENG.render();
    const idle = ENG.info().calls;
    castMagic({ x: 0, z: 0 });
    for (let i = 0; i < 100; i++) step(0.05);       // 5 秒：六層全開，最貴的一幀
    placeBomb({ x: 4, y: 1, z: 4 });               // 炸彈最後才放，才不會先炸掉建築換場
    draw(); ENG.render();
    return { idle, busy: ENG.info().calls };
  });
  ok('沒放道具時 draw call 不變', dc.idle <= 12, dc.idle + ' 個');
  /* 魔法陣一層是「盤 + 芯環 + 暈環」三個 draw call，六層就十八個；
     那顆火種一路留到爆炸，再加三個環（v1.39 當時還多一片盤，v1.62 起火圈中間是空的）。
     只在陣展開的那六秒會這樣，平常是 11。 */
  ok('炸彈與魔法陣在場上才多吃 draw call', dc.busy > dc.idle && dc.busy <= 40,
     '放了炸彈與六層魔法陣時 ' + dc.busy + ' 個');

  /* ══════════ 天災 ══════════ */
  /* v1.138。使用者：「自動天災事件設計成可擴充多種／地標建築完成後 計時 10~15 分鐘
     之間啟動（v1.166 使用者改成「縮短到地標完成後 8~12 分鐘」）／事件一 一隻
     小人大小的黑獼猴慢慢從邊緣走過來 對地標點火／事件二 一隻
     小人大小的白猴子(比黑獼猴略大)慢慢從邊緣走過來 對地標丟出香蕉形狀炸彈」，
     後續追加「可以按照小人行走邏輯 不要穿越地標建築&小房子」。
     造型是先做成預覽給使用者看過才落地的（白猴子改成「毛依然是黑的，只有皮膚比較白」）。 */
  await head('天災：猴子與飛龍');
  await reset(page, { shape: '吉薩大金字塔', cnt: 2600, workers: 12 });
  await page.evaluate(() => { stepDoom = window.doomStep; });   // 這一段要測它本身

  /* ── 造型（讀引擎那份部位表，跟核可過的造型稿對得起來）── */
  const bfig = await page.evaluate(() => {
    const B = ENG.BEASTS;
    const top = k => Math.max(...B[k].map(b => b.p[1] + b.s[1] / 2));
    const has = (k, c) => B[k].some(b => b.c === c);
    return {
      apeTop: +top('ape').toFixed(3), snowTop: +top('snow').toFixed(3),
      apeFace: has('ape', 0xc0625c), apePaw: has('ape', 0x17171b), apeTorch: has('ape', 0xff7a1e),
      snowBody: B.snow[0].c,
      snowSkin: B.snow.filter(b => b.c === 0xf2ece0 || b.c === 0xe3d8c6).length,
      snowFace: has('snow', 0xf2ece0), snowPaw: has('snow', 0xe3d8c6),
      nanaSeg: B.nana.filter(b => b.c === 0xf0c53a).length,
      tape: B.nana.filter(b => b.c === 0xc8322a).length,
      fuse: has('nana', 0x2c2620), spark: has('nana', 0xff8a24),
      bent: B.nana.filter(b => b.r && b.r[2]).length
    };
  });
  /* 「小人大小」：小人連安全帽是 1.31（engine.js 的 BODY），黑獼猴照這個數字畫，
     白猴子「略大」抓 +11%。兩隻在場上乘的是同一個身高倍率（DOOM_SC），
     所以模型高的比例就是場上的比例。 */
  ok('黑獼猴跟小人一樣高、白猴子高一成',
     bfig.apeTop === 1.31 && Math.abs(bfig.snowTop / bfig.apeTop - 1.11) < 0.01,
     '黑 ' + bfig.apeTop + '／白 ' + bfig.snowTop);
  /* 使用者第二版指定：「毛色依然是黑的 只是皮膚的地方比較白」。
     所以白的只有八塊：臉、兩隻耳朵、吻部、兩隻手、兩隻腳。 */
  ok('白猴子的毛是黑的，白的只有皮膚那幾塊',
     bfig.snowBody === 0x22222a && bfig.snowSkin === 8 && bfig.snowFace && bfig.snowPaw,
     '軀幹 ' + bfig.snowBody.toString(16) + '／淺色 ' + bfig.snowSkin + ' 塊');
  ok('黑獼猴是紅臉黑手腳、手上有火把',
     bfig.apeFace && bfig.apePaw && bfig.apeTorch);
  /* 純黃的香蕉在場上只是一根水果，所以要有膠帶與引信才讀得出是炸彈。
     弧線是六塊各自轉一個角度排出來的——方塊排不出弧線，只能這樣排。 */
  ok('香蕉炸彈：六節弧 ＋ 兩圈紅膠帶 ＋ 引信與火花',
     bfig.nanaSeg === 6 && bfig.tape === 2 && bfig.fuse && bfig.spark && bfig.bent >= 8,
     bfig.nanaSeg + ' 節／' + bfig.tape + ' 圈膠帶／轉過角度的 ' + bfig.bent + ' 塊');

  /* ── 畫出來 ── */
  const bdraw = await page.evaluate(() => {
    beasts = null; nanas = null;
    const a = spawnBeast('ape'), b = spawnBeast('snow');
    a.x = 30; a.z = 0; a.gait = 0; a.ph = 0;
    b.x = -30; b.z = 0; b.gait = 0; b.ph = 0;
    draw();
    const mesh = ENG.three.beastMesh, P = ENG.BEAST_PARTS;
    const tmp = new THREE.Matrix4(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    let low = 99;
    for (let k = 0; k < ENG.BEASTS.ape.length; k++) {
      mesh.getMatrixAt(k, tmp);
      v.setFromMatrixPosition(tmp); sc.setFromMatrixScale(tmp);
      low = Math.min(low, v.y - sc.y / 2);
    }
    /* 手上那根香蕉要跟著手走：走路擺了一輪，手與炸彈的距離不能變
       （會變就表示那根是自己在擺，畫面上會脫手）。 */
    const hand = ENG.BEASTS.snow.findIndex(x => x.c === 0xe3d8c6 && x.p[0] > 0 && x.p[1] < 0.3);
    const bomb = ENG.BEASTS.snow.length - 1;
    const gaps = [];
    const p1 = new THREE.Vector3(), p2 = new THREE.Vector3();
    for (let i = 0; i < 12; i++) {
      b.gait = 0.85; b.ph = i * 0.5; draw();
      mesh.getMatrixAt(P + hand, tmp); p1.setFromMatrixPosition(tmp);
      mesh.getMatrixAt(P + bomb, tmp); p2.setFromMatrixPosition(tmp);
      gaps.push(p1.distanceTo(p2));
    }
    mesh.getMatrixAt(P + bomb, tmp);
    const held = new THREE.Vector3().setFromMatrixScale(tmp).x;
    b.bomb = 0; draw();
    mesh.getMatrixAt(P + bomb, tmp);
    const gone = new THREE.Vector3().setFromMatrixScale(tmp).x;
    const cnt = mesh.count;
    beasts = null; draw();
    return { cnt, parts: P, low: +low.toFixed(3), empty: mesh.count,
             gap: +(Math.max(...gaps) - Math.min(...gaps)).toFixed(4),
             held: +held.toFixed(3), gone: +gone.toFixed(4) };
  });
  ok('兩隻都畫得出來，腳踩在草皮上（沒埋進地裡）',
     bdraw.cnt === bdraw.parts * 2 && Math.abs(bdraw.low) < 0.01 && bdraw.empty === 0,
     bdraw.cnt + ' 個 instance／最低點 ' + bdraw.low);
  ok('手上那根香蕉跟著手走，不會自己擺',
     bdraw.gap < 0.001, '走一輪的距離變化 ' + bdraw.gap);
  ok('丟出去之後手上那根就不見了',
     bdraw.held > 0.03 && bdraw.gone === 0,
     '拿著 ' + bdraw.held + ' → 丟了 ' + bdraw.gone);

  /* ── 倒數 ── */
  const btime = await page.evaluate(() => {
    completeNow();
    for (let i = 0; i < 40; i++) step(0.05);          // 散場
    beasts = null; nanas = null; doomT = -1;
    phase = 'build'; stepDoom(0.05);
    const inBuild = doomT;
    phase = 'done'; stepDoom(0.05);
    const armed = doomT;
    for (let i = 0; i < 20; i++) stepDoom(0.5);       // 數了 10 秒
    const ticked = armed - doomT;
    const rolls = [];
    for (let i = 0; i < 300; i++) { doomT = -1; stepDoom(0.05); rolls.push(doomT); }
    /* 場上有東西在演的時候不再數（一次一件）；走了才重抽。 */
    doomT = -1;
    const m = spawnBeast('ape');
    stepDoom(0.05);
    const busy = doomT;
    beasts = null; stepDoom(0.05);
    const rearm = doomT;
    return { inBuild, armed: +armed.toFixed(1), ticked: +ticked.toFixed(2),
             lo: Math.min(...rolls), hi: Math.max(...rolls), busy, rearm };
  });
  ok('只有地標蓋完（done）才開始倒數，施工中不數',
     btime.inBuild === -1 && btime.armed > 0, '施工中 ' + btime.inBuild);
  ok('倒數的長度落在 8~12 分鐘（v1.166 從 10~15 收短）',
     btime.lo >= 480 && btime.hi <= 720 && btime.hi - btime.lo > 200,
     '300 次抽樣：' + btime.lo.toFixed(0) + '～' + btime.hi.toFixed(0) + ' 秒');
  ok('倒數照模擬時間走，而且一次只來一件',
     Math.abs(btime.ticked - 10) < 0.01 && btime.busy === -1 && btime.rearm > 480,
     '10 秒扣掉 ' + btime.ticked + '／場上有東西時 ' + btime.busy);
  /* 「設計成可擴充多種」：加第三種天災＝往 DOOMS 再放一列，別處不必動。 */
  const bpick = await page.evaluate(() => {
    /* 臨時加一筆權重 2 的：總權重變成 3 種 ×1 ＋ 2 ＝ 5，所以它該拿到四成上下。 */
    DOOMS.push({ id: 'test', wt: 2, start: () => {} });
    const cnt = {};
    for (let i = 0; i < 1000; i++) { const d = rollDoom(); cnt[d.id] = (cnt[d.id] || 0) + 1; }
    DOOMS.pop();
    return { ids: DOOMS.map(d => d.id), cnt };
  });
  ok('事件表可擴充：加一筆進去就抽得到，而且照權重',
     bpick.ids.length === 3 && bpick.cnt.test > 320 && bpick.cnt.test < 480 &&
     bpick.cnt.ape > 120 && bpick.cnt.snow > 120 && bpick.cnt.dragon > 120,
     '原本三種 ＋ 臨時加一種（權重 2）抽 1000 次：' + JSON.stringify(bpick.cnt));

  /* ── 走過來（使用者：「按照小人行走邏輯 不要穿越地標建築&小房子」）── */
  await fillAll(page);
  const bwalk = await page.evaluate(() => {
    beasts = null; nanas = null;
    const m = spawnBeast('ape');
    const r0 = Math.hypot(m.x, m.z);
    let inSite = 0, frames = 0, dist = 0;
    let px = m.x, pz = m.z;
    while (m.st === 'come' && frames < 3000) {
      stepDoom(0.05); frames++;
      if (footBlocked(m.x, m.z)) inSite++;
      dist += Math.hypot(m.x - px, m.z - pz); px = m.x; pz = m.z;
    }
    const walked = frames * 0.05;
    let near = 0;
    while (m.st !== 'act' && frames < 3600) { stepDoom(0.05); frames++; near++;
      if (footBlocked(m.x, m.z)) inSite++; }
    return { r0: +r0.toFixed(1), arena: +arenaR.toFixed(1), siteR: +siteR.toFixed(1),
             inSite, secs: +walked.toFixed(1), spd: +(dist / walked).toFixed(2),
             stand: +Math.hypot(m.x, m.z).toFixed(1), near: +(near * 0.05).toFixed(1),
             reach: +(() => { const b = nearSet(m.x, m.z);
                              return Math.hypot(b.x - m.x, b.z - m.z); })().toFixed(2) };
  });
  ok('從碎料場外緣慢慢走進來（速度約小人的三分之一）',
     bwalk.r0 > bwalk.arena && bwalk.spd > 1.8 && bwalk.spd < 2.6,
     '出現在半徑 ' + bwalk.r0 + '（場地 ' + bwalk.arena + '）、' +
     bwalk.spd + '／秒、走了 ' + bwalk.secs + ' 秒');
  ok('全程沒有一幀站在地標的格子裡',
     bwalk.inSite === 0 && bwalk.reach < 4,
     '踩進去 ' + bwalk.inSite + ' 幀，停在離最近那塊 ' + bwalk.reach + ' 格');
  /* 房子擋在正前方：走法是借小人那一套（strollTo → dodgeHome／pushOutHome），
     所以牠會繞過去，不會直直穿過人家的屋子。 */
  const bhome = await page.evaluate(() => {
    beasts = null; nanas = null;
    const m = spawnBeast('ape');
    const a = Math.atan2(m.z, m.x);
    // 擋在牠回工地那條直線的中段
    const hx = Math.cos(a) * (arenaR * 0.55), hz = Math.sin(a) * (arenaR * 0.55);
    homes = { list: [{ x: hx, z: hz, r: 4, x0: hx - 4, x1: hx + 4, z0: hz - 4, z1: hz + 4 }] };
    let inHome = 0, off = 0, frames = 0;
    while (m.st === 'come' && frames < 3000) {
      stepDoom(0.05); frames++;
      if (homeFoot(m.x, m.z)) inHome++;
      // 離「出發點到工地」那條直線多遠
      off = Math.max(off, Math.abs(-Math.sin(a) * m.x + Math.cos(a) * m.z));
    }
    homes = null;
    return { inHome, off: +off.toFixed(2), got: m.st !== 'come' };
  });
  ok('房子擋路就繞開，不從人家屋子裡穿過去',
     bhome.inHome === 0 && bhome.off > 1 && bhome.got,
     '踩進去 ' + bhome.inHome + ' 幀，最多繞出去 ' + bhome.off + ' 格');

  /* ── 事件一：點火 ── */
  await fillAll(page);
  const bfire = await page.evaluate(() => {
    clearFires();
    for (const b of blocks) b.wet = 0;
    beasts = null; nanas = null;
    const m = spawnBeast('ape');
    let frames = 0;
    while (m.st !== 'act' && frames < 3600) { stepDoom(0.05); frames++; }
    const ph0 = phase;
    while (m.st === 'act' && frames < 3800) { stepDoom(0.05); frames++; }
    const lit = blocks.filter(b => b.burn > 0).length;
    const set0 = blocks.filter(b => b.st === SET).length;
    for (let i = 0; i < 200; i++) step(0.05);        // 10 秒讓火自己蔓延
    return { ph0, lit, phase, set0, spread: blocks.filter(b => b.burn > 0).length,
             set1: blocks.filter(b => b.st === SET).length };
  });
  ok('黑獼猴走到就點火，地標燒起來',
     bfire.ph0 === 'done' && bfire.lit >= 3 && bfire.phase === 'wreck',
     '點著 ' + bfire.lit + ' 塊，phase ' + bfire.ph0 + ' → ' + bfire.phase);
  ok('火會自己往鄰居蔓延（10 秒後燒得更兇）',
     bfire.spread > bfire.lit * 3 && bfire.set1 < bfire.set0,
     bfire.lit + ' 塊 → ' + bfire.spread + ' 塊，還站著的 ' +
     bfire.set0 + ' → ' + bfire.set1);

  /* ── 事件二：香蕉炸彈 ── */
  await fillAll(page);
  const bnana = await page.evaluate(() => {
    clearFires();
    beasts = null; nanas = null;
    const m = spawnBeast('snow');
    let frames = 0, flew = 0, top = 0;
    while (m.st !== 'act' && frames < 3600) { stepDoom(0.05); frames++; }
    const hold0 = m.bomb;
    while (m.st === 'act' && frames < 3800) { stepDoom(0.05); frames++; }
    const set0 = blocks.filter(b => b.st === SET).length;
    let hit = null;
    while (nanas && frames < 3900) {
      flew++; top = Math.max(top, nanas[0].y);
      hit = { x: nanas[0].x, y: nanas[0].y, z: nanas[0].z };
      stepDoom(0.02); frames++;
    }
    const set1 = blocks.filter(b => b.st === SET).length;
    return { hold0, hold1: m.bomb, flew, top: +top.toFixed(1),
             hy: hit ? +hit.y.toFixed(1) : -1,
             hr: hit ? +Math.hypot(hit.x, hit.z).toFixed(1) : -1,
             smashed: set0 - set1, set0 };
  });
  ok('白猴子把香蕉炸彈拋到建築上（手上那根跟著不見）',
     bnana.hold0 === 1 && bnana.hold1 === 0 && bnana.flew > 5 &&
     bnana.hy > 0.4 && bnana.hr < 30,
     '飛了 ' + bnana.flew + ' 幀、最高 ' + bnana.top + '，炸在高度 ' +
     bnana.hy + '、離中心 ' + bnana.hr);
  /* 使用者定的規則：「測試炸彈重點在是否正常作用，因為隨機位置而炸掉幾塊，
     炸了幾塊完全不重要」。這一條原本是 smashed > 100——而香蕉是白猴子往地標中心
     一帶**隨機**拋的，炸掉幾塊全看落在哪：十個種子量到 277～966 塊，不給種子那一輪
     量到過 88 塊（門檻 100，紅）。門檻正好卡在分布中間，跟飛龍火球是同一個病。
     量級本來就有下面那條在守（同一座、同一點，石頭／香蕉／炸彈各炸一次比），
     所以這裡只驗「有沒有正常作用」：炸在建築上就該有東西掉下來。塊數照樣印出來當參考。 */
  ok('香蕉炸在建築上真的炸得開（炸掉幾塊看落點，不當門檻）',
     bnana.smashed > 0, bnana.smashed + ' 塊（全座 ' + bnana.set0 +
     '；落點隨機，這個數字只是參考——量級看下面那條同一點的對照）');
  /* 同一座、同一點各炸一次，比三發的量級。每一發都先把建築補回來。 */
  const bpow = {};
  for (const kind of ['rock', 'nana', 'bomb']) {
    await fillAll(page);
    bpow[kind] = await page.evaluate(k => {
      const C = { rock: [ROCK_R, ROCK_POW], nana: [NANA_R, NANA_POW],
                  bomb: [BOMB_R, BOMB_POW] }[k];
      const n0 = blocks.filter(b => b.st === SET).length;
      explode({ x: 3, y: 6, z: 3 }, C[0], C[1]);
      return n0 - blocks.filter(b => b.st === SET).length;
    }, kind);
  }
  ok('同一點比一次：石頭 < 香蕉 < 定時炸彈',
     bpow.rock < bpow.nana && bpow.nana < bpow.bomb,
     '石頭 ' + bpow.rock + '／香蕉 ' + bpow.nana + '／炸彈 ' + bpow.bomb + ' 塊');


  /* ── 事件三：飛龍（v1.139）── */
  const dfig = await page.evaluate(() => {
    const D = ENG.BEASTS.dragon;
    const span = Math.max(...D.map(b => Math.abs(b.p[0]) + b.s[0] / 2)) * 2;
    const len = Math.max(...D.map(b => b.p[2] + b.s[2] / 2)) -
                Math.min(...D.map(b => b.p[2] - b.s[2] / 2));
    return { span: +span.toFixed(2), len: +len.toFixed(2), sc: DRA_SC,
             world: +(span * DRA_SC).toFixed(1), parts: D.length, max: ENG.BEAST_PARTS,
             wing: D.filter(b => b.wg).length, tail: D.filter(b => b.tl).length,
             neck: D.filter(b => b.nk).length,
             memb: D.filter(b => b.c === 0xd4685a).length,
             fball: ENG.BEASTS.fball.length };
  });
  ok('飛龍的翼展 20 格上下（小人 2.2 格，約九分之一）',
     dfig.world > 19 && dfig.world < 22 && dfig.parts === dfig.max,
     '模型翼展 ' + dfig.span + ' ×' + dfig.sc + ' ＝ ' + dfig.world +
     ' 格、體長 ' + dfig.len + '，' + dfig.parts + ' 塊');
  ok('翅膀、尾巴、脖子各有自己的擺動旗標',
     dfig.wing >= 20 && dfig.tail === 7 && dfig.neck >= 12 && dfig.memb === 10,
     '翼 ' + dfig.wing + ' 塊（翼膜 ' + dfig.memb + '）／尾 ' + dfig.tail +
     '／頸 ' + dfig.neck);

  /* 使用者第一版回饋：「飛的翅膀跟身體太過僵硬」。硬板的話翼面上每一塊都在同一條
     直線上（偏離 0），而且翼尖跟翼根的高度差是固定的。這一條就是在驗它不是硬板。 */
  const dwing = await page.evaluate(() => {
    beasts = null; nanas = null; fballs = null;
    const m = spawnDragon();
    m.x = 0; m.z = 0; m.y = 30; m.a = 0; m.roll = 0; m.spin = 0;
    const D = ENG.BEASTS.dragon, mesh = ENG.three.beastMesh;
    const tmp = new THREE.Matrix4(), v = new THREE.Vector3();
    const memb = [];
    for (let i = 0; i < D.length; i++) if (D[i].wg === 1 && D[i].c === 0xd4685a) memb.push(i);
    const tip = D.findIndex(b => b.wg === 1 && b.u > 0.9);
    const root = D.findIndex(b => b.wg === 1 && b.u < 0.2);
    const rise = [], dev = [];
    for (let k = 0; k < 8; k++) {
      m.ph = k * 0.8; draw();
      mesh.getMatrixAt(tip, tmp); v.setFromMatrixPosition(tmp);
      const ty = v.y;
      mesh.getMatrixAt(root, tmp); v.setFromMatrixPosition(tmp);
      rise.push(ty - v.y);
      // 翼膜那幾塊離「翼根→翼尖」那條直線最遠多少（硬板恆為 0）
      const pts = memb.map(i => { mesh.getMatrixAt(i, tmp); v.setFromMatrixPosition(tmp);
                                  return [v.x, v.y]; });
      const a = pts[0], b = pts[pts.length - 1];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      let d = 0;
      for (const q of pts)
        d = Math.max(d, Math.abs((b[0] - a[0]) * (a[1] - q[1]) -
                                 (a[0] - q[0]) * (b[1] - a[1])) / L);
      dev.push(d);
    }
    beasts = null; draw();
    return { swing: +(Math.max(...rise) - Math.min(...rise)).toFixed(2),
             bend: +Math.max(...dev).toFixed(2), flat: +Math.min(...dev).toFixed(2) };
  });
  ok('翅膀真的在拍（翼尖相對翼根上下擺一整個身長）',
     dwing.swing > 6, '擺動範圍 ' + dwing.swing + ' 格');
  ok('翅膀不是硬板：拍下去的時候翼面是彎的',
     dwing.bend > 0.25, '翼面最彎的時候偏離直線 ' + dwing.bend + ' 格');

  /* v1.146.1 使用者回報「飛龍一個翅膀不見了」。翼上那幾塊的位置是照 wg 的正負號
     從右半邊那條翼弧鏡射的，而 bmir 只翻了 p[0]／r／sw／am，漏了 wg——左翼整片
     疊在右翼上（實測 22 塊全落在 x ＝ +1.52～+8.68）。這一條驗兩邊真的一邊一片。 */
  const dsym = await page.evaluate(() => {
    beasts = null; nanas = null; fballs = null;
    const m = spawnDragon();
    m.x = 0; m.z = 0; m.y = 30; m.a = 0; m.roll = 0; m.spin = 0; m.ph = 1.1;
    draw();
    const D = ENG.BEASTS.dragon, mesh = ENG.three.beastMesh;
    const tmp = new THREE.Matrix4(), v = new THREE.Vector3();
    let lo = 0, hi = 0, l = 0, r = 0;
    for (let i = 0; i < D.length; i++) {
      if (!D[i].wg) continue;
      mesh.getMatrixAt(i, tmp); v.setFromMatrixPosition(tmp);
      const x = v.x - m.x;
      if (x < -1) l++; else if (x > 1) r++;
      lo = Math.min(lo, x); hi = Math.max(hi, x);
    }
    beasts = null; draw();
    return { l, r, lo: +lo.toFixed(2), hi: +hi.toFixed(2) };
  });
  ok('兩片翅膀一邊一片（不是左翼疊在右翼上）',
     dsym.l === dsym.r && dsym.l >= 11 && Math.abs(dsym.lo + dsym.hi) < 0.01,
     '左 ' + dsym.l + ' 塊到 ' + dsym.lo + ' 格／右 ' + dsym.r + ' 塊到 ' + dsym.hi + ' 格');

  /* 航線（使用者：「從場外飛進工地稍微盤旋一下 中途吐幾顆火球」）。
     圓弧是用轉向速度轉出來的，所以要驗「盤旋那一段半徑真的穩」——
     第一版朝著中心飛，到了圓上還得再轉 90 度，實測半徑在 18~39 之間晃。 */
  await fillAll(page);
  const dfly = await page.evaluate(() => {
    beasts = null; nanas = null; fballs = null;
    const m = spawnDragon();
    const r0 = Math.hypot(m.x, m.z);
    const st = {};
    let n = 0, rMin = 1e9, rMax = 0, roll = 0, inside = 0, yMin = 1e9;
    const top = Math.max(...blocks.filter(b => b.st === SET).map(b => b.y));
    while (beasts && n < 3000) {
      step(0.05); n++;
      if (!beasts) break;
      st[m.st] = (st[m.st] || 0) + 1;
      if (m.st === 'ring') { const r = Math.hypot(m.x, m.z);
                             rMin = Math.min(rMin, r); rMax = Math.max(rMax, r); }
      roll = Math.max(roll, Math.abs(m.roll));
      yMin = Math.min(yMin, m.y);
      if (blockAt(m.x, m.y, m.z)) inside++;
      if (m.st === 'out' && Math.hypot(m.x, m.z) > arenaR) break;
    }
    return { r0: +r0.toFixed(1), arena: +arenaR.toFixed(1), rc: +m.rc.toFixed(1),
             rMin: +rMin.toFixed(1), rMax: +rMax.toFixed(1), st,
             roll: +roll.toFixed(2), inside, top: +top.toFixed(1),
             yMin: +yMin.toFixed(1), secs: +(n * 0.05).toFixed(1), gone: !beasts };
  });
  ok('從場外飛進來、在工地上空盤旋、再飛出去',
     dfly.r0 > dfly.arena && dfly.st.in > 0 && dfly.st.ring > 200 && dfly.st.out > 0,
     '出現在半徑 ' + dfly.r0 + '（場地 ' + dfly.arena + '）；進場 ' +
     (dfly.st.in * 0.05).toFixed(1) + ' 秒、盤旋 ' + (dfly.st.ring * 0.05).toFixed(1) +
     ' 秒、離場 ' + (dfly.st.out * 0.05).toFixed(1) + ' 秒');
  ok('盤旋那一圈的半徑是穩的（不是繞出一個偏心的圈）',
     Math.abs(dfly.rMin - dfly.rc) < 2 && Math.abs(dfly.rMax - dfly.rc) < 2,
     '目標 ' + dfly.rc + '，實際 ' + dfly.rMin + '～' + dfly.rMax);
  ok('轉彎時整條龍往內側傾斜', dfly.roll > 0.25, '最大側傾 ' + dfly.roll + ' 弧度');
  ok('飛在建築上方，不會穿過建築',
     dfly.inside === 0 && dfly.yMin > dfly.top,
     '最低飛到 ' + dfly.yMin + '，建築頂 ' + dfly.top + '（穿模 ' + dfly.inside + ' 幀）');

  /* 火球（使用者：「火球大約隕石那樣大 不要連噴」）。
     **一趟不夠，飛三趟取中位**（v1.148）：一趟只吐 3～5 顆，而拆掉多少幾乎全看
     那幾顆**剛好落在哪**——落在金字塔中段會燒掉一大片，落在邊坡就只崩一角。
     同一份程式碼兩輪整輪測試量到「還站著 788 塊」與「1515 塊」，而門檻是一半
     （1347）——正好卡在分布中間，等於在擲骰子（那兩輪一行天災程式碼都沒動）。
     所以每一趟都是一筆樣本：吐幾顆、間隔幾秒每一趟都要對，拆掉多少取三趟的中位數。 */
  const dpass = [];
  for (let k = 0; k < 3; k++) {
    await fillAll(page);
    dpass.push(await page.evaluate(() => {
      beasts = null; nanas = null; fballs = null; clearFires();
      for (const b of blocks) b.wet = 0;
      const set0 = blocks.filter(b => b.st === SET).length;
      spawnDragon();
      const times = [];
      let n = 0, was = 0, maxAt = 0, burn = 0, lowSet = set0, ph = phase;
      while (beasts && n < 3000) {
        step(0.05); n++;
        const cur = fballs ? fballs.length : 0;
        if (cur > was) times.push(n * 0.05);
        maxAt = Math.max(maxAt, cur);
        was = cur;
        /* 燒起來的塊數要**邊打邊量**：一趟打完地標多半已經跌破換場門檻，
           等牠飛走才量的話，量到的是換場之後的新場面（全部歸零）。 */
        burn = Math.max(burn, blocks.filter(b => b.burn > 0).length);
        const st = blocks.filter(b => b.st === SET).length;
        if (st < lowSet) { lowSet = st; ph = phase; }
        if (!beasts) break;
      }
      const gaps = times.slice(1).map((t, i) => t - times[i]);
      /* 只吐一顆的那一趟沒有「間隔」可言：給 −1 當「沒得比」，
         別給 0 —— 0 會被下面那條「不連噴」當成「連噴」而誤判。 */
      return { shots: times.length, maxAt,
               minGap: gaps.length ? +Math.min(...gaps).toFixed(2) : -1,
               burn, set0, lowSet, ph, phase };
    }));
  }
  const dfire = dpass.slice().sort((a, b) => a.lowSet - b.lowSet)[1];   // 中位那一趟
  const dshot = dpass.map(d => d.shots).sort((a, b) => a - b)[1];       // 顆數的中位
  /* 上限與間隔是**程式保證的**（配額 4、每一發之間有最小間隔），所以三趟都要成立。
     下限不是：一趟吐得完幾顆要看盤旋那段時間夠不夠用完配額，實測一趟 1～5 顆
     （整輪測試量到過只吐 2 顆、也量到過只吐 1 顆的），所以「一趟有幾顆」看
     **中位那一趟**；而只吐一顆的那一趟沒有間隔可比（minGap −1），間隔那一項就跳過它。 */
  ok('一趟吐幾顆火球，而且是一顆一顆隔開的（不連噴）',
     dpass.every(d => d.shots >= 1 && d.shots <= 5 && (d.shots < 2 || d.minGap > 0.9)) &&
     dshot >= 3,
     '三趟各吐了 ' + dpass.map(d => d.shots).join('／') + ' 顆（中位 ' + dshot +
     '），最短間隔 ' + dpass.map(d => d.minGap < 0 ? '—' : d.minGap).join('／') + ' 秒');
  ok('火球打中會燒起來，一趟下來地標垮了',
     dpass.every(d => d.burn > 20 && d.ph !== 'done') &&
     dfire.lowSet < dfire.set0 * 0.5,
     '三趟最多同時燒 ' + dpass.map(d => d.burn).join('／') + ' 塊；還站著的 ' +
     dfire.set0 + ' → ' + dpass.map(d => d.lowSet).join('／') +
     ' 塊（取中位 ' + dfire.lowSet + '，門檻 ' + Math.round(dfire.set0 * 0.5) +
     '），phase ' + dpass.map(d => d.ph).join('／'));
  /* 「大約隕石那樣大」＝範圍 9.2、威力 16，那是**使用者說那句話時**（v1.146）的隕石。
     v1.151 使用者把隕石指定放大（v1.151.1 定案是半徑 ×2、範圍 18.4），火球
     **沒有跟著放大**——那是另一把道具，不該被隕石的每一次調整帶著跑，
     所以 FB_R／FB_POW 從那一版起自己一組數字，不再寫成 MET_R／MET_POW。
     這一條因此從「跟隕石一樣」改成守「還是 v1.146 那一組」：常數要對，
     而且同一點炸下去打掉的要明顯比現在的隕石少（實測 799 對 2487 塊）。 */
  const dpow = {};
  for (const kind of ['fball', 'meteor']) {
    await fillAll(page);
    dpow[kind] = await page.evaluate(k => {
      const n0 = blocks.filter(b => b.st === SET).length;
      const p = { x: 3, y: 6, z: 3 };
      const R = k === 'fball' ? FB_R : MET_R, P = k === 'fball' ? FB_POW : MET_POW;
      explode(p, R, P);
      igniteAround(p, R * 1.6, Math.round(R * 1.6), SET);
      return n0 - blocks.filter(b => b.st === SET).length;
    }, kind);
  }
  const dnum = await page.evaluate(() => ({ r: FB_R, pow: FB_POW, mr: MET_R, mpow: MET_POW }));
  ok('火球維持 v1.146 那一組數字，沒被放大的隕石帶著走',
     dnum.r === 9.2 && dnum.pow === 16 && dnum.mr > dnum.r * 1.5 &&
     dpow.fball < dpow.meteor * 0.6,
     '火球 範圍 ' + dnum.r + '／威力 ' + dnum.pow + '，隕石 ' + dnum.mr + '／' + dnum.mpow +
     '；同一點炸下去 火球 ' + dpow.fball + ' 塊、隕石 ' + dpow.meteor + ' 塊');

  const dpick = await page.evaluate(() => {
    const cnt = {};
    for (let i = 0; i < 900; i++) { const d = rollDoom(); cnt[d.id] = (cnt[d.id] || 0) + 1; }
    return { ids: DOOMS.map(d => d.id), cnt };
  });
  ok('三種天災都抽得到', dpick.ids.length === 3 && dpick.ids.indexOf('dragon') >= 0 &&
     Object.keys(dpick.cnt).length === 3 && dpick.cnt.dragon > 200,
     JSON.stringify(dpick.cnt));

  await page.evaluate(() => { stepDoom = () => {}; cleanTools(); });

  /* ══════════ 吉祥物 ══════════ */
  /* v1.144。使用者：「黑獼猴 白猴子 飛龍 列為吉祥物／吉祥物一段時間就會出來刷存在感
     (不搞破壞 只是出現逛一逛 一段時間又走了)／各吉祥物出來刷存在感的事件各自獨立
     (所以有機會一起出沒)」。出沒時機與間隔是問過使用者的：「任何時候都可能」「各自 3~6 分鐘」。
     跟天災共用同一批動物與同一套走路，所以這一段驗的是**差在哪裡**，不重驗造型。
     兩支鐘都要裝回去：走路那一段是 stepDoom 在跑（beasts 的迴圈在它裡面）。 */
  await head('吉祥物：來逛一圈就走');
  await reset(page, { shape: '吉薩大金字塔', cnt: 1800, workers: 6 });
  await page.evaluate(() => { stepDoom = window.doomStep; stepMascot = window.mascStep; });
  await fillAll(page);

  /* ── 三個鐘 ── */
  const mtime = await page.evaluate(() => {
    cleanTools(); phase = 'done'; doomT = 1e9;        // 這一段不要讓天災插進來
    stepMascot(0.05);
    const armed = mascT.slice();
    for (let i = 0; i < 20; i++) stepMascot(0.5);     // 數了 10 秒
    const ticked = armed.map((v, i) => +(v - mascT[i]).toFixed(2));
    const rolls = [];
    for (let i = 0; i < 300; i++) { mascT.fill(-1); stepMascot(0.05); rolls.push(mascT[0]); }
    return { n: mascT.length, ids: MASCOTS.map(k => k.id), ticked,
             armed: armed.map(v => +v.toFixed(1)),
             lo: Math.min(...rolls), hi: Math.max(...rolls) };
  });
  ok('三隻各有各的鐘，不是天災那個共用的倒數',
     mtime.n === 3 && mtime.ids.join() === 'ape,snow,dragon',
     mtime.ids.join('／') + '，這一輪各抽到 ' + mtime.armed.join('／') + ' 秒');
  ok('間隔落在 3~6 分鐘，而且三個鐘都照模擬時間走',
     mtime.lo >= 180 && mtime.hi <= 360 && mtime.hi - mtime.lo > 60 &&
     mtime.ticked.every(v => Math.abs(v - 10) < 0.01),
     '300 次抽樣 ' + mtime.lo.toFixed(0) + '～' + mtime.hi.toFixed(0) +
     ' 秒；過了 10 秒各扣掉 ' + mtime.ticked.join('／'));

  /* 「各自獨立」：一隻在場上的時候，只有牠自己的鐘停下來等牠走。 */
  const mind = await page.evaluate(() => {
    cleanTools(); phase = 'done'; doomT = 1e9;
    stepMascot(0.05);                                 // 三個鐘都抽好
    mascT[0] = 0.01;                                  // 黑獼猴那個先到
    stepMascot(0.05);
    const came = beasts ? beasts.map(m => m.kind) : [];
    const fun = beasts ? beasts[0].fun : -1;
    const before = [mascT[1], mascT[2]];
    for (let i = 0; i < 20; i++) stepMascot(0.5);     // 又過了 10 秒
    const moved = before.map((v, i) => +(v - mascT[i + 1]).toFixed(2));
    const apeClock = mascT[0];
    cleanTools();
    return { came, fun, moved, apeClock };
  });
  ok('鐘到了就自己出場，而且出場的是吉祥物那一版（fun）',
     mind.came.join() === 'ape' && mind.fun === 1, '出場的是 ' + mind.came.join('／'));
  ok('一隻在場上時只有牠自己的鐘停著，另外兩隻照數',
     mind.apeClock === -1 && mind.moved.every(v => Math.abs(v - 10) < 0.01),
     '黑獼猴 ' + mind.apeClock + '（＝等牠走了再重抽）／另外兩隻各扣掉 ' + mind.moved.join('／'));

  /* 「所以有機會一起出沒」：三個鐘同時到就三隻同時在場上。
     順便驗畫得下——beastMesh 有 MAXBEAST 這個上限，超出的是靜靜地不畫。 */
  const mall = await page.evaluate(() => {
    cleanTools(); phase = 'done'; doomT = 1e9;
    stepMascot(0.05);
    mascT.fill(0.01);
    stepMascot(0.05);
    const kinds = beasts ? beasts.map(m => m.kind).sort().join() : '';
    const allFun = beasts ? beasts.every(m => m.fun === 1) : false;
    spawnBeast('ape');                                // 再加一件天災（fun 沒給）
    draw();
    const drawn = ENG.three.beastMesh.count / ENG.BEAST_PARTS;
    const n = beasts.length;
    cleanTools();
    return { kinds, allFun, n, drawn, max: ENG.MAXBEAST };
  });
  ok('三隻有機會一起出沒', mall.kinds === 'ape,dragon,snow' && mall.allFun, mall.kinds);
  ok('三隻吉祥物 ＋ 一件天災同場，四隻都畫得出來',
     mall.n === 4 && mall.drawn === 4 && mall.max >= 4,
     '場上 ' + mall.n + ' 隻、畫出 ' + mall.drawn + ' 隻（上限 ' + mall.max + '）');

  /* ── 猴子：走進來、逛一逛、走了，全程不動手 ── */
  await fillAll(page);
  const mwalk = await page.evaluate(() => {
    cleanTools(); phase = 'done'; doomT = 1e9; clearFires();
    for (const b of blocks) b.wet = 0;
    const set0 = blocks.filter(b => b.st === SET).length;
    const m = spawnBeast('ape', 1);
    const stay0 = +m.stay.toFixed(2);                 // 這一趟抽到要逛幾秒
    let n = 0, come = 0, roam = 0, go = 0, inSite = 0, moved = 0;
    let burn = 0, nana = 0, fb = 0, minSet = set0, rMin = 1e9, rMax = 0;
    let px = m.x, pz = m.z;
    while (n < 5000 && beasts && beasts.indexOf(m) >= 0) {
      step(0.05); n++;
      if (m.st === 'come') come++;
      else if (m.st === 'fun') {
        roam++;
        moved += Math.hypot(m.x - px, m.z - pz);
        const r = Math.hypot(m.x, m.z);
        rMin = Math.min(rMin, r); rMax = Math.max(rMax, r);
      } else if (m.st === 'go') go++;
      px = m.x; pz = m.z;
      if (footBlocked(m.x, m.z) || homeFoot(m.x, m.z)) inSite++;
      burn = Math.max(burn, blocks.filter(b => b.burn > 0).length);
      nana = Math.max(nana, nanas ? nanas.length : 0);
      fb = Math.max(fb, fballs ? fballs.length : 0);
      minSet = Math.min(minSet, blocks.filter(b => b.st === SET).length);
    }
    return { gone: !beasts || beasts.indexOf(m) < 0, secs: +(n * 0.05).toFixed(1), stay0,
             come: +(come * 0.05).toFixed(1), roam: +(roam * 0.05).toFixed(1),
             go: +(go * 0.05).toFixed(1), moved: +moved.toFixed(1), inSite,
             rMin: +rMin.toFixed(1), rMax: +rMax.toFixed(1),
             siteR: +siteR.toFixed(1), arena: +arenaR.toFixed(1),
             burn, nana, fb, set0, minSet, ph: phase };
  });
  /* 逛的秒數直接跟「這一趟抽到的 m.stay」對，不是對 25~45 那個範圍的邊界：
     秒數是一幀一幀（0.05）數出來的，剛好抽到 45 的那一趟會量到 45.05，
     拿邊界當門檻等於埋一顆偶爾才爆的雷。 */
  ok('走進來 → 逛一逛 → 走人，逛的長度就是這一趟抽到的 MASC_STAY',
     mwalk.gone && mwalk.come > 5 && mwalk.go > 5 &&
     mwalk.stay0 >= 25 && mwalk.stay0 <= 45 && Math.abs(mwalk.roam - mwalk.stay0) < 0.2,
     '走進來 ' + mwalk.come + ' 秒、逛了 ' + mwalk.roam + ' 秒（抽到 ' + mwalk.stay0 +
     '）、走回去 ' + mwalk.go + ' 秒（全程 ' + mwalk.secs + ' 秒）');
  ok('逛的時候真的在走，而且繞著建築外圈（沒有站著發呆一整段）',
     mwalk.moved > 20 && mwalk.rMin >= mwalk.siteR && mwalk.rMax < mwalk.arena,
     '走了 ' + mwalk.moved + ' 格，半徑 ' + mwalk.rMin + '～' + mwalk.rMax +
     '（建築 ' + mwalk.siteR + '、場地 ' + mwalk.arena + '）');
  ok('不搞破壞：一塊都沒少、沒有火、沒丟香蕉，地標還是 done',
     mwalk.minSet === mwalk.set0 && mwalk.burn === 0 && mwalk.nana === 0 &&
     mwalk.fb === 0 && mwalk.ph === 'done',
     '還站著的 ' + mwalk.set0 + ' 塊（最低 ' + mwalk.minSet + '）、燒起來 ' +
     mwalk.burn + ' 塊、香蕉 ' + mwalk.nana + ' 根');
  ok('全程不穿越地標建築與小房子（跟天災那幾隻同一套走法）',
     mwalk.inSite === 0, '踩進去 ' + mwalk.inSite + ' 幀');

  /* ── 飛龍：航線照舊，一顆火球都不吐 ── */
  await fillAll(page);
  const mdra = await page.evaluate(() => {
    cleanTools(); phase = 'done'; doomT = 1e9; clearFires();
    for (const b of blocks) b.wet = 0;
    const set0 = blocks.filter(b => b.st === SET).length;
    const m = spawnDragon(1);
    const shots = m.left;
    let n = 0, fb = 0, burn = 0, ring = 0;
    while (n < 5000 && beasts && beasts.indexOf(m) >= 0) {
      step(0.05); n++;
      if (m.st === 'ring') ring++;
      fb = Math.max(fb, fballs ? fballs.length : 0);
      burn = Math.max(burn, blocks.filter(b => b.burn > 0).length);
    }
    return { gone: !beasts || beasts.indexOf(m) < 0, secs: +(n * 0.05).toFixed(1),
             ring: +(ring * 0.05).toFixed(1), shots, fb, burn, set0,
             set: blocks.filter(b => b.st === SET).length, ph: phase };
  });
  ok('飛龍吉祥物照樣繞一圈就飛走',
     mdra.gone && mdra.ring > 8, '盤旋 ' + mdra.ring + ' 秒（全程 ' + mdra.secs + ' 秒）');
  ok('牠一顆火球都不吐，地標一塊都沒少',
     mdra.shots === 0 && mdra.fb === 0 && mdra.burn === 0 &&
     mdra.set === mdra.set0 && mdra.ph === 'done',
     '配額 ' + mdra.shots + ' 顆、場上最多 ' + mdra.fb + ' 顆；' +
     mdra.set0 + ' → ' + mdra.set + ' 塊');

  /* ── 不挑階段（使用者選的「任何時候都可能」）── */
  const mph = await page.evaluate(() => {
    const out = {};
    for (const ph of ['build', 'done', 'wreck', 'clear']) {
      cleanTools(); phase = ph; doomT = 1e9;
      const fun = spawnBeast('ape', 1);
      const doom = spawnBeast('snow');                // 對照組：天災那一版
      for (let i = 0; i < 4; i++) stepDoom(0.05);
      out[ph] = fun.st + '/' + doom.st;
    }
    /* 整地那一段連放都不放走路的進來（鐘也停著），龍在天上不受影響。 */
    cleanTools(); phase = 'clear'; doomT = 1e9;
    stepMascot(0.05);
    mascT.fill(0.01);
    stepMascot(0.05);
    const inClear = beasts ? beasts.map(m => m.kind).sort().join() : '';
    const held = mascT[0] === 0.01 && mascT[1] === 0.01;
    cleanTools();
    return { out, inClear, held };
  });
  ok('施工中天災那隻會走人，吉祥物照樣留下來逛',
     mph.out.build === 'come/go' && mph.out.done === 'come/come' &&
     mph.out.wreck === 'come/come',
     Object.keys(mph.out).map(k => k + ' ' + mph.out[k]).join('，'));
  ok('整地中走路的先讓開（鐘也停著），飛龍照樣飛得進來',
     mph.out.clear === 'go/go' && mph.inClear === 'dragon' && mph.held,
     '整地中放進來的是 ' + (mph.inClear || '（沒有）') + '，兩個走路的鐘停在原地 ' + mph.held);

  /* ── 兩條線互不擋 ── */
  const mdoom = await page.evaluate(() => {
    cleanTools(); phase = 'done';
    stepDoom(0.05);                                   // 場上沒東西 → 抽一個倒數
    const armed = doomT;
    spawnBeast('ape', 1);                             // 吉祥物在場上逛
    for (let i = 0; i < 20; i++) stepDoom(0.5);
    const withFun = +(armed - doomT).toFixed(2);
    cleanTools(); phase = 'done';
    stepDoom(0.05);
    const armed2 = doomT;
    spawnBeast('ape');                                // 換成天災在場上
    for (let i = 0; i < 20; i++) stepDoom(0.5);
    const withDoom = +(armed2 - doomT).toFixed(2);
    cleanTools();
    return { withFun, withDoom };
  });
  ok('吉祥物不擋天災的鐘，只有天災自己會擋（一次一件）',
     Math.abs(mdoom.withFun - 10) < 0.01 && mdoom.withDoom === 0,
     '場上有吉祥物時 10 秒扣掉 ' + mdoom.withFun + '，有天災時扣掉 ' + mdoom.withDoom);

  /* ── 剛好抽到同一種天災就地翻臉（v1.145）── */
  /* 使用者：「如果吉祥物進來剛好抽到天災 能直接把行為轉換成天災嗎」。
     要驗的是「不會多一隻」＋「翻臉之後真的會動手」，還有三種**不該**轉的情況。 */
  await fillAll(page);
  const mturn = await page.evaluate(() => {
    cleanTools(); phase = 'done'; doomT = 1e9; clearFires();
    for (const b of blocks) b.wet = 0;
    const set0 = blocks.filter(b => b.st === SET).length;
    const m = spawnBeast('ape', 1);                   // 先讓牠走到工地邊開始逛
    let n = 0;
    while (m.st !== 'fun' && n < 2000) { stepDoom(0.05); n++; }
    const roaming = m.st, n0 = beasts.length;
    const turned = turnBad('ape');                    // 天災的鐘到了，抽到的就是黑獼猴那件
    const flip = { n: beasts.length, same: beasts[0] === m, fun: m.fun, st: m.st };
    /* 翻臉之後照天災那條路走完：走到最近那一塊 → 站定瞄 → 放火 → 走人。
       這一段要走完整的 step，不能只走 stepDoom：點著只是把 b.burn 設起來，
       真的吃掉積木的是火自己蔓延（spreadFire）那一段，它掛在主迴圈上。 */
    let burn = 0, acted = 0, lowSet = set0;
    for (let i = 0; i < 3000 && m.st !== 'go'; i++) {
      step(0.05);
      if (m.st === 'act') acted++;
      burn = Math.max(burn, blocks.filter(b => b.burn > 0).length);
    }
    const phAct = phase;                              // 動完手那一刻（igniteAt 推的）
    /* 塊數要**邊燒邊量**：這一把火會把整座吃光，燒到跌破門檻就換場了，
       等最後才量的話量到的是換場之後的新場面（同〈火球打中會燒起來〉那條的坑）。 */
    for (let i = 0; i < 600; i++) {
      step(0.05);
      burn = Math.max(burn, blocks.filter(b => b.burn > 0).length);
      lowSet = Math.min(lowSet, blocks.filter(b => b.st === SET).length);
      if (phase === 'clear' || phase === 'build') break;
    }
    return { roaming, turned, n0, flip, burn, acted, phAct, set0, lowSet };
  });
  ok('抽到同一種天災時，場上那隻吉祥物就地翻臉，不會再多一隻走進來',
     mturn.roaming === 'fun' && mturn.turned && mturn.flip.n === mturn.n0 &&
     mturn.flip.n === 1 && mturn.flip.same && mturn.flip.fun === 0 &&
     mturn.flip.st === 'near',
     '逛到一半（' + mturn.roaming + '）→ 翻臉後場上還是 ' + mturn.flip.n +
     ' 隻、同一個物件、狀態轉成 ' + mturn.flip.st);
  ok('翻臉之後牠真的動手：走過去放火，地標開始垮',
     mturn.acted > 0 && mturn.burn > 0 && mturn.lowSet < mturn.set0 &&
     mturn.phAct === 'wreck',
     '站定瞄了 ' + (mturn.acted * 0.05).toFixed(2) + ' 秒、最多同時燒 ' + mturn.burn +
     ' 塊，還站著的 ' + mturn.set0 + ' → ' + mturn.lowSet +
     ' 塊（放完火那一刻 phase ' + mturn.phAct + '）');

  /* 三種不該轉的：別種、已經在走回場外的、本來就是天災那一隻。 */
  const mkeep = await page.evaluate(() => {
    cleanTools(); phase = 'done'; doomT = 1e9;
    const s = spawnBeast('snow', 1);                  // ① 場上是白猴子，抽到黑獼猴那件
    const other = turnBad('ape');
    const snowFun = s.fun;
    cleanTools();
    const g = spawnBeast('ape', 1);                   // ② 已經在走回場外了
    leaveBeast(g);
    const going = turnBad('ape'), goFun = g.fun;
    cleanTools();
    spawnBeast('ape');                                // ③ 本來就是天災那一隻
    const already = turnBad('ape');
    cleanTools();
    return { other, snowFun, going, goFun, already };
  });
  ok('只轉同一種、不轉已經在走回場外的、也不會把天災那隻再轉一次',
     mkeep.other === false && mkeep.snowFun === 1 &&
     mkeep.going === false && mkeep.goFun === 1 && mkeep.already === false,
     '別種 ' + mkeep.other + '／走人中 ' + mkeep.going + '／本來就是天災 ' + mkeep.already +
     '（都是 false ＝ stepDoom 照舊從場外放一隻新的進來）');

  /* 飛龍那一版：翻臉＝補一圈回來吐火球（配額給了但圈數不補的話，牠可能只差幾度
     就繞滿了，火球一顆都吐不出來就飛走）。 */
  await fillAll(page);
  const mtdra = await page.evaluate(() => {
    cleanTools(); phase = 'done'; doomT = 1e9; clearFires();
    for (const b of blocks) b.wet = 0;
    const set0 = blocks.filter(b => b.st === SET).length;
    const m = spawnDragon(1);
    let n = 0;
    while (m.st !== 'ring' && n < 2000) { stepDoom(0.05); n++; }
    for (let i = 0; i < 200; i++) stepDoom(0.05);     // 先繞一段，turned 已經推進了
    const t0 = +m.turned.toFixed(2), left0 = m.left;
    const turned = turnBad('dragon');
    const flip = { left: m.left, turned: m.turned, gap: m.gap > 0, fun: m.fun,
                   n: beasts.length };
    let fb = 0, shots = 0, was = 0;
    for (let i = 0; i < 4000 && beasts && beasts.indexOf(m) >= 0; i++) {
      stepDoom(0.05);
      const cur = fballs ? fballs.length : 0;
      if (cur > was) shots++;
      was = cur;
      fb = Math.max(fb, cur);
    }
    return { t0, left0, turned, flip, shots, fb, set0,
             set: blocks.filter(b => b.st === SET).length };
  });
  ok('飛龍翻臉：圈數歸零補一圈回來，火球配額也補上',
     mtdra.turned && mtdra.left0 === 0 && mtdra.flip.left >= 3 && mtdra.flip.left <= 5 &&
     mtdra.t0 > 1 && mtdra.flip.turned === 0 && mtdra.flip.gap && mtdra.flip.n === 1,
     '繞了 ' + mtdra.t0 + ' 弧度 → 歸零重繞，配額 ' + mtdra.left0 + ' → ' + mtdra.flip.left);
  ok('補的那一圈真的吐得出火球，地標跟著垮',
     mtdra.shots >= 3 && mtdra.fb > 0 && mtdra.set < mtdra.set0,
     '吐了 ' + mtdra.shots + ' 顆，還站著的 ' + mtdra.set0 + ' → ' + mtdra.set + ' 塊');

  /* ── 偶而動手（v1.166）───────────────────────────────────
     使用者：「吉祥物出沒偶而也會對不是地標建築破壞（根據吉祥物的破壞模式）」，
     追加一句「樹也算 地標建築以外就可以了」（v1.166.1）。
     四件事要驗：多久一次（「偶而」）、砸的是村子那邊而地標沒事（「不是地標建築」，
     房子與樹都算）、三隻各用自己那一套（「根據吉祥物的破壞模式」）、砸完照舊逛完才走。 */
  const mrate = await page.evaluate(() => {
    cleanTools(); phase = 'done'; doomT = 1e9;
    /* 只攔「鐘放人的時候帶了什麼旗標」，不真的放一隻進來：放進來的話一趟要等牠走完，
       八百次抽樣得跑上幾十萬幀。 */
    const orig = MASCOTS.map(k => k.spawn);
    const got = [];
    MASCOTS[0].spawn = bad => { got.push(bad ? 1 : 0); };
    for (let i = 0; i < 800; i++) { mascT[0] = 0.01; stepMascot(0.05); }
    MASCOTS.forEach((k, i) => { k.spawn = orig[i]; });
    /* 直接叫 spawnBeast／spawnDragon 放進來的一律是乖的那一版——上面每一條測試
       （還有 turnBad）都靠這件事。 */
    beasts = null;
    const plain = [spawnBeast('ape', 1), spawnBeast('snow', 1), spawnDragon(1)]
                  .every(m => !m.bad && !m.home);
    cleanTools();
    return { n: got.length, bad: got.reduce((a, v) => a + v, 0), plain, p: MASC_BAD };
  });
  ok('「偶而」＝出場那一刻抽一次，大約四隻裡一隻是來動手的',
     mrate.p < 0.5 && Math.abs(mrate.bad / mrate.n - mrate.p) < 0.07 && mrate.plain,
     '抽 ' + mrate.n + ' 次有 ' + mrate.bad + ' 次（' +
     (mrate.bad / mrate.n * 100).toFixed(1) + '%，MASC_BAD ' + mrate.p +
     '）；直接放進來的三隻都是乖的 ' + mrate.plain);

  /* 蓋一個村落出來：上面每一條都是 cleanTools 開頭（那一支會把房子清掉），
     所以砸房子這幾條自己蓋一次，中間不再 cleanTools。
     **要從一座乾淨的地標重來（reset ＋ completeNow），不能只 fillAll**：
     上面幾條把地標燒垮了，而村子要蓋幾十秒——那幾十秒裡遊戲會自己走完
     「垮了 → 整地 → 開下一座」，一進 build 就只有偷懶的人會去蓋房子（而測試裡沒有
     偷懶的人），實測 300 秒蓋出 0 塊。reset 會把 stepDoom／stepMascot 換回空的
     （installClean），所以要再裝回來一次。 */
  await reset(page, { shape: '吉薩大金字塔', cnt: 1800, workers: 20 });
  await page.evaluate(() => { stepDoom = window.doomStep; stepMascot = window.mascStep; });
  const village = await page.evaluate(() => {
    completeNow();
    for (let i = 0; i < 240; i++) step(0.05);          // 散場
    beasts = null; nanas = null; fballs = null; clearFires();
    phase = 'done'; doomT = 1e9;
    mascT.fill(1e9);                                  // 自己走進來的先別來，這幾條要自己擺
    stopIdleEvent(); evArm = 0;
    idleEv = IDLE_EVENTS[0]; startHomes();            // 挑哪一件另一段測過了，這裡直接開
    const cnt = () => blocks.filter(b => b.st === SET && b.hh >= 0).length;
    let t = 0;
    while (t < 300 && cnt() < 100) { step(0.05); t += 0.05; }
    /* **蓋到這裡就凍住**：不停的話下面幾條一邊被砸、村子一邊在長，
       「房子少了幾塊」量到的是兩件事相減（實測砸完反而多了 300 多塊）。 */
    stopIdleEvent();
    for (let i = 0; i < 40; i++) step(0.05);           // 手上還抓著的那幾塊落地
    /* 房子與樹分開數：v1.166.1 起兩種都是目標（使用者：「樹也算 地標建築以外就
       可以了」），但「村落真的蓋起來了」還是看房子——樹是同一輪順便種的。 */
    const per = homes ? homes.list.map((h, i) =>
                          blocks.filter(b => b.st === SET && b.hh === i).length) : [];
    const house = homes ? per.filter((v, i) => v > 0 && !homes.list[i].tree) : [];
    const tree = homes ? per.filter((v, i) => v > 0 && homes.list[i].tree) : [];
    const near = homes ? Math.min(...homes.list.filter((h, i) => per[i] > 0)
                          .map(h => Math.hypot(h.x, h.z) - h.r)) : 0;
    return { secs: +t.toFixed(1), blk: cnt(), houses: house.length, trees: tree.length,
             big: Math.max(...house, 0), gap: +(near - siteR).toFixed(1),
             siteR: +siteR.toFixed(1) };
  });
  ok('先蓋一個村落出來（後面幾條要有東西可砸）',
     village.houses >= 2 && village.blk >= 60 && village.big >= 6,
     village.secs + ' 秒蓋出 ' + village.houses + ' 間房子 ＋ ' + village.trees +
     ' 棵樹、共 ' + village.blk + ' 塊站著（最大那間 ' + village.big +
     ' 塊）；最近的一個離地標外圈 ' + village.gap + ' 格（siteR ' + village.siteR + '）');

  /* 樹也算目標（v1.166.1，使用者：「樹也算 地標建築以外就可以了」）。
     直接驗那一支挑目標的述詞：把村子裡隨便一個標成樹，再挑一次——挑到的還是它。
     這樣驗才不用碰運氣（那一輪剛好有沒有種出積木的樹、猴子剛好走去哪一邊）。 */
  const mtree = await page.evaluate(() => {
    const b = blocks.find(x => x.st === SET && x.hh >= 0);
    if (!b) return { ok: false, why: '村子裡一塊都沒有' };
    const h = homes.list[b.hh], was = h.tree;
    h.tree = 1;
    const near = nearHome(b.x, b.z), any = anyHome();
    h.tree = was;
    return { ok: !!near && near.hh === b.hh && !!any,
             kind: h.kind, wasTree: was ? 1 : 0,
             nearHH: near ? near.hh : -1, hh: b.hh, anyHH: any ? any.hh : -1 };
  });
  ok('樹也算「地標建築以外」：標成樹的那一個照樣挑得到',
     mtree.ok,
     '把「' + mtree.kind + '」標成樹（本來 tree=' + mtree.wasTree + '）之後，' +
     'nearHome 挑到 ' + mtree.nearHH + '（要 ' + mtree.hh + '）、anyHome 挑到 ' +
     mtree.anyHH);

  /* 三隻各用自己那一套。共用的量法：
       站著的地標塊（st === SET && hh < 0）與站著的村子塊（hh >= 0）分開數——
       breakBlock 會把 hh 清掉，所以碎料一律落在「hh < 0」那一邊，
       只有 st === SET 才是「還站著的」（不加這個條件會把村子的碎料算成地標）。 */
  const mape = await page.evaluate(() => {
    beasts = null; nanas = null; fballs = null; clearFires();
    for (const b of blocks) b.wet = 0;
    const site = () => blocks.filter(b => b.st === SET && b.hh < 0).length;
    const home = () => blocks.filter(b => b.st === SET && b.hh >= 0).length;
    const site0 = site(), home0 = home();
    const m = spawnBeast('ape', 1, 1);
    let n = 0, acted = 0, inside = 0;
    /* `beasts &&` 不能省：逛的時間用完牠就走人（連 bad 都還沒用掉），
       走出場外之後 beasts 是 null，少了這一半會當場 TypeError。 */
    while (n < 6000 && m.bad && beasts && beasts.indexOf(m) >= 0) {
      step(0.05); n++;
      if (m.st === 'act') acted++;
      if (footBlocked(m.x, m.z) || homeFoot(m.x, m.z)) inside++;
    }
    const st = m.st, stay = m.stay;
    const burnHome = blocks.filter(b => b.burn > 0 && b.st === SET && b.hh >= 0).length;
    const burnSite = blocks.filter(b => b.burn > 0 && b.st === SET && b.hh < 0).length;
    /* 燒下去：房子那幾塊要真的被吃掉，而火不會跳到地標上（房子燒的是自己那份格子表，
       見 spreadHomeFire）。**跑到牠走出場外才停**，不是固定幀數——剩下要逛的
       （m.stay 抽 25~45 秒，這一趟用掉的只有走進來那一段之後那幾秒）加上走回場外的
       十幾秒，固定 60 秒只剩兩秒餘裕，那種門檻就是一顆偶爾才爆的雷。 */
    let low = home0, hiSite = 0, out = 0;
    while (out < 2400) {
      step(0.05); out++;
      low = Math.min(low, home());
      hiSite = Math.max(hiSite, blocks.filter(b => b.burn > 0 && b.st === SET && b.hh < 0).length);
      if (!beasts || beasts.indexOf(m) < 0) break;
    }
    return { secs: +(n * 0.05).toFixed(1), acted: +(acted * 0.05).toFixed(2), inside,
             after: +(out * 0.05).toFixed(1),
             burnHome, burnSite, hiSite, st, stay: +stay.toFixed(1),
             site0, site: site(), home0, low, ph: phase,
             gone: !beasts || beasts.indexOf(m) < 0 };
  });
  ok('黑獼猴那一趟：走過去把村子那邊點著，地標一塊都沒燒到、一塊都沒少',
     mape.acted > 0 && mape.burnHome > 0 && mape.low < mape.home0 &&
     mape.burnSite === 0 && mape.hiSite === 0 && mape.site === mape.site0 &&
     mape.ph === 'done',
     '走了 ' + mape.secs + ' 秒、站定瞄 ' + mape.acted + ' 秒，點著村子 ' +
     mape.burnHome + ' 塊（還站著的村子 ' + mape.home0 + ' → ' + mape.low +
     '）；地標燒 ' + mape.hiSite + ' 塊、' + mape.site0 + ' → ' + mape.site +
     ' 塊，phase ' + mape.ph);
  ok('砸完回去把剩下的時間逛完才走（不像天災那幾隻動完手就走人）',
     mape.st === 'fun' && mape.gone && mape.inside === 0,
     '動完手轉回 ' + mape.st + '（還剩 ' + mape.stay + ' 秒要逛）→ 又 ' + mape.after +
     ' 秒之後走了 ' + mape.gone + '；全程踩進建築或房子 ' + mape.inside + ' 幀');

  const msnow = await page.evaluate(() => {
    beasts = null; nanas = null; fballs = null; clearFires();
    for (const b of blocks) b.wet = 0;
    const site = () => blocks.filter(b => b.st === SET && b.hh < 0).length;
    const home = () => blocks.filter(b => b.st === SET && b.hh >= 0).length;
    const site0 = site(), home0 = home();
    const m = spawnBeast('snow', 1, 1);
    let n = 0, nana = 0;
    while (n < 6000 && m.bad && beasts && beasts.indexOf(m) >= 0) {   // 同上，別省 beasts &&
      step(0.05); n++;
      nana = Math.max(nana, nanas ? nanas.length : 0);
    }
    const st = m.st;
    /* 香蕉飛 1.15 秒才炸，炸完再讓碎料落地。順便量「炸點離牠多遠」與「牠飛了沒」：
       砸房子的那一趟牠要站在自己的爆炸半徑外才丟（DOOM_TOSS_NEAR，見那裡的註解）。 */
    let air = 0, lie = 0, low = home0, last = null, boomD = -1;
    for (let i = 0; i < 200; i++) {
      if (nanas && nanas[0]) last = { x: nanas[0].x, z: nanas[0].z };
      step(0.05);
      nana = Math.max(nana, nanas ? nanas.length : 0);
      if (!nanas && last && boomD < 0)
        boomD = +Math.hypot(m.x - last.x, m.z - last.z).toFixed(1);
      if (m.air) air = 1;
      if (m.lie > 0) lie = 1;
      low = Math.min(low, home());
    }
    return { secs: +(n * 0.05).toFixed(1), nana, st, air, lie, boomD, blast: NANA_R,
             site0, site: site(), home0, low, ph: phase };
  });
  ok('白猴子那一趟：香蕉丟的是村子那邊，地標沒事',
     msnow.nana > 0 && msnow.low < msnow.home0 && msnow.st === 'fun' &&
     msnow.site >= msnow.site0 - 4 && msnow.ph === 'done',
     '丟了 ' + msnow.nana + ' 根，還站著的村子 ' + msnow.home0 + ' → ' + msnow.low +
     ' 塊、地標 ' + msnow.site0 + ' → ' + msnow.site + ' 塊，phase ' + msnow.ph);
  ok('丟之前先站到自己的爆炸半徑外（不然牠會被自己的香蕉炸飛）',
     msnow.boomD > msnow.blast && msnow.air === 0,
     '炸點離牠 ' + msnow.boomD + ' 格（爆炸半徑 ' + msnow.blast + '）：牠被炸飛 ' +
     msnow.air + '、被震倒 ' + msnow.lie + '（震倒是圈外那一帶的正常反應，會自己爬起來）');

  const mdrg = await page.evaluate(() => {
    beasts = null; nanas = null; fballs = null; clearFires();
    for (const b of blocks) b.wet = 0;
    const site = () => blocks.filter(b => b.st === SET && b.hh < 0).length;
    const home = () => blocks.filter(b => b.st === SET && b.hh >= 0).length;
    const site0 = site(), home0 = home();
    /* 每一顆火球落在哪：攔 fballHit（爆炸前一刻），量落點離最近那一塊房子多遠、
       離工地中心多遠。這是「瞄的是小房子」最直接的證據。 */
    const orig = fballHit;
    const hits = [];
    fballHit = f => {
      const b = nearHome(f.x, f.z);
      hits.push({ r: +Math.hypot(f.x, f.z).toFixed(1),
                  dh: b ? +Math.hypot(b.x - f.x, b.z - f.z).toFixed(1) : -1 });
      return orig(f);
    };
    const m = spawnDragon(1, 1);
    const quota = m.left;
    let n = 0, low = home0;
    while (n < 6000 && beasts && beasts.indexOf(m) >= 0) {
      step(0.05); n++;
      low = Math.min(low, home());
    }
    for (let i = 0; i < 200; i++) { step(0.05); low = Math.min(low, home()); }
    fballHit = orig;
    const burnSite = blocks.filter(b => b.burn > 0 && b.st === SET && b.hh < 0).length;
    return { quota, hits, low, home0, site0, site: site(), burnSite,
             secs: +(n * 0.05).toFixed(1), siteR: +siteR.toFixed(1), ph: phase };
  });
  /* 顆數只驗「配額落在 1~2、而且真的吐得出來」，不驗「一顆都沒少」：
     整片村子被前兩隻砸到只剩最後一塊時，剩下的配額是故意作廢的（不改噴地標）。 */
  ok('飛龍那一趟：火球瞄的是村子那邊，不是地標',
     mdrg.quota >= 1 && mdrg.quota <= 2 &&
     mdrg.hits.length >= 1 && mdrg.hits.length <= mdrg.quota &&
     mdrg.hits.every(h => h.dh >= 0 && h.dh < 10 && h.r > mdrg.siteR) &&
     mdrg.low < mdrg.home0,
     '配額 ' + mdrg.quota + ' 顆，落點 ' +
     mdrg.hits.map(h => '半徑 ' + h.r + '／離最近那塊村子的積木 ' + h.dh).join('，') +
     '（siteR ' + mdrg.siteR + '）；還站著的村子 ' + mdrg.home0 + ' → ' + mdrg.low);
  ok('火球的餘火只燒村子那邊，不撒到旁邊的地標上',
     mdrg.burnSite === 0 && mdrg.site >= mdrg.site0 - 4 && mdrg.ph === 'done',
     '地標燒起來 ' + mdrg.burnSite + ' 塊、' + mdrg.site0 + ' → ' + mdrg.site +
     ' 塊還站著，phase ' + mdrg.ph);

  /* 村子還沒蓋起來（或都被砸光了）：抽中的那一隻照舊只是來逛的。
     cleanTools 正好把房子與樹都清掉，這一條就跑在它後面。 */
  const mnone = await page.evaluate(() => {
    cleanTools(); phase = 'done'; doomT = 1e9; clearFires();
    mascT.fill(1e9);                                  // cleanTools 把鐘歸零了，這一條要自己擺
    for (const b of blocks) b.wet = 0;
    const set0 = blocks.filter(b => b.st === SET).length;
    const m = spawnBeast('ape', 1, 1);
    let n = 0, acted = 0, burn = 0;
    while (n < 4000 && beasts && beasts.indexOf(m) >= 0) {
      step(0.05); n++;
      if (m.st === 'near' || m.st === 'act') acted++;
      burn = Math.max(burn, blocks.filter(b => b.burn > 0).length);
    }
    const out = { gone: !beasts || beasts.indexOf(m) < 0, acted, burn, bad: m.bad,
                  home: m.home, set0, set: blocks.filter(b => b.st === SET).length,
                  ph: phase };
    cleanTools();
    return out;
  });
  ok('村子那邊一塊都沒有的時候，抽中的那一隻照舊只是來逛的（不會改砸地標）',
     mnone.gone && mnone.acted === 0 && mnone.burn === 0 && mnone.bad === 0 &&
     mnone.home === 0 && mnone.set === mnone.set0 && mnone.ph === 'done',
     '旗標自己收掉（bad ' + mnone.bad + '／home ' + mnone.home +
     '）、沒進 near／act ' + mnone.acted + ' 幀、沒有火 ' + mnone.burn +
     ' 塊，還站著的 ' + mnone.set0 + ' → ' + mnone.set + ' 塊');

  await page.evaluate(() => { stepDoom = () => {}; stepMascot = () => {}; cleanTools(); });

  /* ══════════ 閒逛的牛羊 ══════════ */
  /* v1.154。使用者：「增加場上幾隻閒逛的動物(會被破壞工具作用 也會著火類似小人)／
     牛羊2~3隻 依照小人行走邏輯不要走進建物裡面」，看過造型之後追加「也可以牛羊多種造型
     隨機出現」（四款：乳牛、黃牛、綿羊、黑面羊）。
     整套借吉祥物那條路（同一份 beasts 清單、同一套走路、同一套被打到的反應），
     所以這一段驗的是**差在哪裡**：不走人、不挑階段、不佔天災的名額、四條腿繞自己的關節轉。 */
  await head('閒逛的牛羊');
  await reset(page, { shape: '吉薩大金字塔', cnt: 1800, workers: 6 });
  await page.evaluate(() => { stepDoom = window.doomStep; stepHerd = window.herdStep; });
  await fillAll(page);

  /* ── 場上養幾隻、四款都抽得到 ── */
  const cnum = await page.evaluate(() => {
    cleanTools(); phase = 'done'; doomT = 1e9;
    herdN = 0;                                        // 重抽這一場要養幾隻
    for (let i = 0; i < 10; i++) stepHerd(0.05);
    const n = beasts ? beasts.length : 0;
    const allHerd = beasts ? beasts.every(m => m.herd === 1 && m.st === 'fun') : false;
    const onRing = beasts ? beasts.every(m => Math.hypot(m.x, m.z) > siteR + KEEP) : false;
    const more = (() => { for (let i = 0; i < 20; i++) stepHerd(0.05); return beasts.length; })();
    /* 抽 400 隻看四款都出得來、大小也不是每一隻都一樣 */
    const kinds = {}, sc = [];
    for (let i = 0; i < 400; i++) {
      beasts = null;
      const m = spawnCattle();
      kinds[m.kind] = (kinds[m.kind] || 0) + 1;
      sc.push(+m.sc.toFixed(3));
    }
    const ns = [];
    for (let i = 0; i < 200; i++) { herdN = 0; beasts = null; stepHerd(0.05); ns.push(herdN); }
    cleanTools();
    return { n, more, allHerd, onRing, kinds, ids: HERD_KIND.slice(),
             lo: Math.min(...sc), hi: Math.max(...sc),
             nLo: Math.min(...ns), nHi: Math.max(...ns),
             want: HERD_N.slice(), base: DOOM_SC, k: HERD_SC.slice() };
  });
  ok('開場就有 2~3 隻站在建築外圈那一環上（不像猴子從場外走進來），補滿就不再補',
     cnum.n >= cnum.want[0] && cnum.n <= cnum.want[1] && cnum.more === cnum.n &&
     cnum.allHerd && cnum.onRing &&
     cnum.nLo === cnum.want[0] && cnum.nHi === cnum.want[1],
     '這一輪 ' + cnum.n + ' 隻（再數 1 秒還是 ' + cnum.more + ' 隻）；200 次抽樣 ' +
     cnum.nLo + '～' + cnum.nHi + ' 隻');
  ok('牛羊四款都抽得到，每一隻的大小還各抽一個',
     cnum.ids.length === 4 && Object.keys(cnum.kinds).length === 4 &&
     Math.min(...cnum.ids.map(k => cnum.kinds[k])) > 60 &&
     cnum.lo >= cnum.base * cnum.k[0] - 1e-6 && cnum.hi <= cnum.base * cnum.k[1] + 1e-6 &&
     cnum.hi - cnum.lo > 0.1,
     '400 隻裡 ' + cnum.ids.map(k => k + ' ' + cnum.kinds[k]).join('／') +
     '；放大倍率 ' + cnum.lo.toFixed(2) + '～' + cnum.hi.toFixed(2));
  const HERD_KINDS = cnum.ids;            // 下面幾條照這份掃過每一款

  /* ── 走路：借的是小人那一套，所以不會走進建築，也會停下來吃草 ── */
  const cwalk = await page.evaluate(() => {
    cleanTools(); phase = 'done'; doomT = 1e9;
    herdN = 0;
    for (let i = 0; i < 10; i++) stepHerd(0.05);
    const herd = beasts.slice();
    for (const m of herd) m.pause = 0;
    let inside = 0, moved = 0, rMin = 1e9, rMax = 0, gait = 0, grazed = 0, frames = 0;
    const px = herd.map(m => [m.x, m.z]);
    for (let i = 0; i < 1200; i++) {
      step(0.05);
      herd.forEach((m, k) => {
        frames++;
        if (footBlocked(m.x, m.z) || homeFoot(m.x, m.z)) inside++;
        const r = Math.hypot(m.x, m.z);
        rMin = Math.min(rMin, r); rMax = Math.max(rMax, r);
        moved += Math.hypot(m.x - px[k][0], m.z - px[k][1]);
        px[k] = [m.x, m.z];
        gait = Math.max(gait, m.gait);
        if (m.pause > 0) grazed++;
      });
    }
    const out = { frames, inside, moved: +moved.toFixed(1), gait: +gait.toFixed(2),
                  graze: +(grazed / frames).toFixed(2),
                  rMin: +rMin.toFixed(1), rMax: +rMax.toFixed(1),
                  keep: +(siteR + KEEP).toFixed(1), far: +(siteR + IDLE_FAR).toFixed(1),
                  walk: HERD_WALK, secs: 60 };
    cleanTools();
    return out;
  });
  ok('牛羊照小人那套走路：一格都沒踩進建築與小房子，範圍就是閒晃那一環',
     cwalk.inside === 0 && cwalk.rMin > cwalk.keep - 0.5 && cwalk.rMax < cwalk.far + 3,
     cwalk.frames + ' 個取樣 ' + cwalk.inside + ' 次踩進去；半徑 ' + cwalk.rMin + '～' +
     cwalk.rMax + '（外圈 ' + cwalk.keep + '、閒晃上限 ' + cwalk.far + '）');
  /* 站著吃草的比例不設下限太緊：一趟路可能長到二十幾秒（目標是那一環上隨機挑的），
     60 秒裡只停一次是正常的。要驗的是「會停」不是「停多久」。 */
  ok('走一段停一段：60 秒裡走走停停，腳步跟得上速度',
     cwalk.moved > 20 && cwalk.gait > 0.8 && cwalk.graze > 0 && cwalk.graze < 0.9,
     '60 秒走了 ' + cwalk.moved + ' 格（速度 ' + cwalk.walk + '）、' +
     Math.round(cwalk.graze * 100) + '% 的時間站著吃草');

  /* 「不要走進建物裡面」是硬條件，不是靠繞路碰運氣：每一幀把目標壓回工地正中央。 */
  const cin = await page.evaluate(() => {
    cleanTools(); phase = 'done'; doomT = 1e9;
    herdN = 0;
    for (let i = 0; i < 10; i++) stepHerd(0.05);
    const m = beasts[0];
    let inside = 0, rMin = 1e9;
    for (let i = 0; i < 600; i++) {
      m.tx = 0; m.tz = 0; m.pause = 0;               // 目標＝地標正中央
      step(0.05);
      if (footBlocked(m.x, m.z) || homeFoot(m.x, m.z)) inside++;
      rMin = Math.min(rMin, Math.hypot(m.x, m.z));
    }
    const out = { inside, rMin: +rMin.toFixed(1), keep: +(siteR + KEEP).toFixed(1) };
    cleanTools();
    return out;
  });
  ok('硬把目標壓在地標正中央，牠還是停在建築外圈上（同猴子那一套）',
     cin.inside === 0 && cin.rMin > cin.keep - 0.5,
     '30 秒 ' + cin.inside + ' 次踩進去，最近只到半徑 ' + cin.rMin +
     '（外圈 ' + cin.keep + '）');

  /* ── 不走人、哪一段都在（吉祥物會走人，當對照組） ── */
  const cstay = await page.evaluate(() => {
    cleanTools(); phase = 'done'; doomT = 1e9;
    herdN = 0;
    for (let i = 0; i < 10; i++) stepHerd(0.05);
    const herd = beasts.slice(), n0 = herd.length;
    const live = () => herd.every(m => beasts && beasts.indexOf(m) >= 0 && m.st !== 'go');
    for (let i = 0; i < 2000; i++) { stepDoom(0.05); stepHerd(0.05); }   // 100 秒
    const done = live() && beasts.length === n0;
    phase = 'clear';
    for (let i = 0; i < 400; i++) { stepDoom(0.05); stepHerd(0.05); }
    const clear = live();
    phase = 'build';
    for (let i = 0; i < 400; i++) { stepDoom(0.05); stepHerd(0.05); }
    const build = live();
    /* 對照組：同一段路上的吉祥物，整地那一段就會走人 */
    phase = 'clear';
    const ape = spawnBeast('ape', 1);
    ape.st = 'fun'; ape.stay = 999;
    stepDoom(0.05);
    const apeGo = ape.st === 'go';
    phase = 'done';
    cleanTools();
    return { n0, done, clear, build, apeGo };
  });
  ok('牛羊不會逛完就走人，蓋好、整地、施工三段都在（吉祥物整地那段會走人）',
     cstay.done && cstay.clear && cstay.build && cstay.apeGo,
     '100 秒後 ' + cstay.n0 + ' 隻都還在（done ' + cstay.done + '／clear ' + cstay.clear +
     '／build ' + cstay.build + '），同一段路的吉祥物整地時走人＝' + cstay.apeGo);

  const cdoom = await page.evaluate(() => {
    cleanTools(); phase = 'done';
    herdN = 0;
    for (let i = 0; i < 10; i++) stepHerd(0.05);
    const n0 = beasts.length;
    doomT = -1; stepDoom(0.05);                      // 場上有牛羊，天災的鐘照樣起跳
    const armed = doomT > 0;
    doomT = 0.01; stepDoom(0.05);
    const bad = beasts.filter(m => !m.herd && !m.fun).length;
    cleanTools();
    return { n0, armed, bad };
  });
  ok('牛羊不佔天災「一次一件」那個名額：場上一直有牠們，天災照樣來',
     cdoom.armed && cdoom.bad === 1,
     '場上 ' + cdoom.n0 + ' 隻牛羊，天災的鐘照樣起跳＝' + cdoom.armed +
     '，時間到放進來 ' + cdoom.bad + ' 件');

  /* ── 被破壞工具打到那一整套：跟猴子同一份程式 ── */
  await fillAll(page);
  const chit = await page.evaluate(() => {
    cleanTools(); phase = 'done'; doomT = 1e9;
    const put = (kind, x, z) => {
      const m = spawnCattle();
      m.kind = kind; m.x = x; m.z = z; m.y = 0; m.st = 'fun'; m.pause = 0; m.tx = x; m.tz = z;
      return m;
    };
    /* 炸飛 → 落地躺一下 → 爬起來繼續逛 */
    const fly = put('cow', 26, 0);
    const hit = tossBeast(fly, 9, 11, 0, false);
    const seen = [];
    for (let i = 0; i < 800 && beasts.indexOf(fly) >= 0; i++) {
      stepDoom(0.05);
      seen.push(fly.air ? 'air' : fly.burn > 0 ? 'burn' : fly.fall > 0 ? 'fall' : fly.st);
      if (seen.length > 4 && !fly.air && fly.fall <= 0) break;
    }
    const path = [...new Set(seen)].join('>');
    /* 兩種著火演法（同小人）：躺著滾 vs 站著繞圈跑 */
    cleanTools(); phase = 'done'; doomT = 1e9;
    hot.length = 0;
    const roll = put('ox', 26, 6), run = put('sheep', 26, -6);
    const a = igniteBeast(roll, 1), b = igniteBeast(run, 0);
    const twice = igniteBeast(roll, 1);
    for (let i = 0; i < 60; i++) stepDoom(0.05);
    /* 躺著燒的那一隻是**側躺**（四條腿的，見 lieAng）：躺平角在 roll 不在 spin。 */
    const burn = { spin: +roll.spin.toFixed(2), roll: +Math.abs(roll.roll).toFixed(2),
                   lie: +roll.lie.toFixed(2), rock: B_SIDE_ROCK,
                   runLie: run.lie, runGait: +run.gait.toFixed(2), fx: hot.length > 0,
                   runR: +Math.hypot(run.x - run.bx, run.z - run.bz).toFixed(1) };
    /* 澆得熄 */
    const wet = wetBeast(run);
    const doused = { burn: run.burn, wet: +run.wet.toFixed(1), again: igniteBeast(run, 0) };
    for (let i = 0; i < 200; i++) stepDoom(0.05);     // 燒完站起來
    const after = { burn: roll.burn, lie: roll.lie, spin: +roll.spin.toFixed(2),
                    roll: +roll.roll.toFixed(2), st: roll.st };
    /* 兵器射得中、戳得倒。**順序不能顛倒**：`weaponVsBeast` 會跳過躺著的
       （`m.fall > 0`），先戳倒就永遠射不中了。 */
    cleanTools(); phase = 'done'; doomT = 1e9;
    const ram = put('ram', 26, 0);
    const w = { x: ram.x, y: 0.6, z: ram.z - 1, dx: 0, dy: 0, dz: 1, len: 2 };
    const weap = weaponVsBeast(w, ram.x, 0.6, ram.z - 2);
    const fell = fellBeast(ram, 2);
    cleanTools();
    return { hit, path, a, b, twice, burn, wet, doused, after, fell,
             weap: weap === null ? 'null' : weap.kind, burnT: B_BURN };
  });
  ok('牛羊被炸飛：飛上去翻滾 → 落地躺一下 → 爬起來繼續逛（同猴子、同小人）',
     chit.hit && chit.path === 'air>fall>fun', chit.path);
  ok('牛羊點得著，也分側躺著壓火與站著繞圈跑兩種，燒完自己站起來',
     chit.a && chit.b && !chit.twice && chit.burn.fx &&
     Math.abs(chit.burn.spin) < 0.05 &&
     Math.abs(chit.burn.roll - 1.57) <= chit.burn.rock + 0.01 &&
     chit.burn.lie >= 1 && chit.burn.lie < 2 &&
     chit.burn.runLie === 0 && chit.burn.runGait > 0.9 && chit.burn.runR > 1 &&
     chit.after.burn === 0 && chit.after.lie === 0 && Math.abs(chit.after.roll) < 0.05,
     '側躺壓火：側傾 ' + chit.burn.roll + '（前後晃 ±' + chit.burn.rock +
     '、抬升 ' + chit.burn.lie + ' 倍）、仰角 ' + chit.burn.spin + '；繞圈跑：腳步 ' +
     chit.burn.runGait + '、繞著定點 ' + chit.burn.runR + ' 格；燒 ' + chit.burnT +
     ' 秒之後回到 ' + chit.after.st);
  ok('水澆得熄牛羊身上的火（濕的當下點不著），戳得倒，兵器也射得中',
     chit.wet && chit.doused.burn === 0 && chit.doused.wet === 5 && !chit.doused.again &&
     chit.fell && chit.weap === 'ram',
     '澆完 burn ' + chit.doused.burn + '、濕 ' + chit.doused.wet + ' 秒、再點一次 ' +
     chit.doused.again + '；兵器射中 ' + chit.weap);

  /* ── 四款站著與躺著都貼著草皮 ── */
  const cgnd = await page.evaluate(() => {
    const low = () => {
      const mesh = ENG.three.beastMesh, m4 = new THREE.Matrix4();
      let lo = 1e9;
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, m4);
        const a = m4.elements;
        if (Math.hypot(a[0], a[1], a[2]) < 1e-4 || Math.hypot(a[4], a[5], a[6]) < 1e-4 ||
            Math.hypot(a[8], a[9], a[10]) < 1e-4) continue;
        lo = Math.min(lo, a[13] - 0.5 * (Math.abs(a[1]) + Math.abs(a[5]) + Math.abs(a[9])));
      }
      return +lo.toFixed(3);
    };
    const out = {};
    for (const kind of HERD_KIND) {
      cleanTools(); phase = 'done'; doomT = 1e9;
      const m = spawnCattle();
      m.kind = kind; m.x = 26; m.z = 0; m.y = 0; m.a = 0; m.st = 'fun'; m.pause = 999;
      draw();
      const stand = low();
      /* 側躺（四條腿的倒下來是往側邊倒，不是往後仰）：躺到底那一刻 */
      fellBeast(m, 6);
      for (let i = 0; i < 30; i++) stepDoom(0.05);
      draw();
      const lie = low();
      const roll = m.roll;
      /* 躺著壓火：前後晃一整圈，取最低的那一刻 */
      m.fall = 0;
      igniteBeast(m, 1);
      let worst = 1e9;
      for (let k = 0; k < 40; k++) {
        m.rph = k / 40 * Math.PI * 2;
        m.roll = m.sdir * (Math.PI * 0.5 + B_SIDE_ROCK * Math.sin(m.rph));
        m.lie = sideLift(m);                       // 晃開 90° 就要多抬一點（同 burnBeast）
        draw();
        worst = Math.min(worst, low());
      }
      out[kind] = [stand, lie, +worst.toFixed(3), +Math.abs(roll).toFixed(2)];
    }
    cleanTools();
    return out;
  });
  ok('四款牛羊站著、側躺、躺著壓火都貼著草皮（不陷進去也不浮起來）',
     HERD_KINDS.every(k => cgnd[k][0] >= -0.02 && cgnd[k][0] < 0.05 &&
                           cgnd[k][1] >= -0.02 && cgnd[k][1] < 0.10 &&
                           cgnd[k][2] >= -0.02 && cgnd[k][2] < 0.25 &&
                           Math.abs(cgnd[k][3] - 1.57) < 0.05),
     HERD_KINDS.map(k => k + ' 站 ' + cgnd[k][0] + '／側躺 ' + cgnd[k][1] +
                    '（側傾 ' + cgnd[k][3] + '）／壓火 ' + cgnd[k][2]).join('；'));

  /* ── 四條腿：對角同步，而且各繞自己那個關節轉 ── */
  const clegs = await page.evaluate(() => {
    const out = {};
    const mesh = ENG.three.beastMesh, m4 = new THREE.Matrix4(), v = new THREE.Vector3();
    for (const kind of HERD_KIND) {
      const parts = ENG.MODELS[kind];
      const legs = [];
      parts.forEach((b, i) => { if (b.sw) legs.push({ b, i }); });
      const front = legs.filter(o => o.b.pz > 0), back = legs.filter(o => o.b.pz < 0);
      /* 對角同步：右前（x>0）跟左後（x<0）同號，左前跟右後同號 */
      const diag = front.every(o => (o.b.p[0] > 0) === (o.b.sw > 0)) &&
                   back.every(o => (o.b.p[0] > 0) === (o.b.sw < 0));
      const pzOk = legs.every(o => Math.abs(o.b.pz - o.b.p[2]) < 0.06);
      const amp = Math.max(...legs.map(o => Math.abs(o.b.sw)));
      /* 「繞自己的肩」＝那一點在任何步伐相位下都待在同一個世界點。
         照 JOINT_Z 轉的話它會跑掉 2·sin(擺幅/2)·|pz − JOINT_Z|（下面的 ctrl）。 */
      const o = front[0], b = o.b;
      const at = ph => {
        ENG.putBeasts([{ kind, x: 0, y: 0, z: 0, a: 0, ph, gait: 1, sc: 1 }]);
        mesh.getMatrixAt(o.i, m4);
        return v.set(0, (b.pv - b.p[1]) / b.s[1], (b.pz - b.p[2]) / b.s[2])
                .applyMatrix4(m4).clone();
      };
      const p0 = at(0), p1 = at(Math.PI / 2), p2 = at(-Math.PI / 2);
      out[kind] = { n: legs.length, diag, pzOk, amp: +amp.toFixed(2),
                    piv: +Math.max(p1.distanceTo(p0), p2.distanceTo(p0)).toFixed(3),
                    ctrl: +(2 * Math.sin(amp / 2) * Math.abs(b.pz - 0.03)).toFixed(3) };
    }
    ENG.putBeasts([]);
    return out;
  });
  ok('四條腿是對角同步的，擺幅比猴子小一半',
     HERD_KINDS.every(k => clegs[k].n === 8 && clegs[k].diag && clegs[k].amp <= 0.55),
     HERD_KINDS.map(k => k + ' ' + clegs[k].n + ' 塊／擺幅 ' + clegs[k].amp).join('；'));
  /* ctrl 是「照 JOINT_Z 轉的話那個關節會跑掉多少」＝ 2·sin(擺幅/2)·|pz − JOINT_Z|：
     牛 0.163、羊 0.076（羊的腳離身體中線比較近、擺幅也小一點）。 */
  ok('前腳繞自己的肩、後腳繞自己的髖（pz），不是全部繞肚子中線',
     HERD_KINDS.every(k => clegs[k].pzOk && clegs[k].piv < 0.01 &&
                           clegs[k].ctrl > clegs[k].piv + 0.05),
     HERD_KINDS.map(k => k + ' 關節跑掉 ' + clegs[k].piv + '（照 JOINT_Z 會跑掉 ' +
                    clegs[k].ctrl + '）').join('；'));

  await page.evaluate(() => { stepDoom = () => {}; stepHerd = () => {}; cleanTools(); });

  /* ══════════ 破壞工具打得到那幾隻 ══════════ */
  /* v1.146。使用者：「破壞工具也能對吉祥物生效(著火或是被吹飛或是倒地)／所以飛龍會需要
     倒地起飛的動作(可以先做給我看過再完整測試)／黑獼猴 白猴子可以同小人的方式製作／
     修正小人被吹飛的旋轉軸(目前似乎在腳底 看起來很奇怪)」。
     倒地起飛那一段是先出預覽圖給使用者看過才落地的（同天災那幾隻的造型）。
     這一段驗的是「規則跟小人一樣」與「姿勢擺得對」，不重驗小人自己那一套。 */
  await head('破壞工具打得到那幾隻');
  await reset(page, { shape: '吉薩大金字塔', cnt: 1800, workers: 8 });
  await page.evaluate(() => { stepDoom = window.doomStep; });
  await fillAll(page);

  /* ── 猴子：被炸飛 → 落地躺一下 → 爬起來繼續逛 ── */
  const hFly = await page.evaluate(() => {
    cleanTools(); phase = 'done'; doomT = 1e9; clearFires();
    for (const b of blocks) b.wet = 0;
    const m = spawnBeast('ape', 1);
    m.x = 26; m.z = 0; m.y = 0; m.st = 'fun'; m.stay = 999;
    const hit = tossBeast(m, 9, 11, 0, false);
    const twice = tossBeast(m, 9, 11, 0, false);        // 已經在飛的不重複掀
    const seen = [];
    let top = 0, spun = 0;
    for (let i = 0; i < 800 && beasts && beasts.indexOf(m) >= 0; i++) {
      stepDoom(0.05);
      seen.push(m.air ? 'air' : m.burn > 0 ? 'burn' : m.fall > 0 ? 'fall' : m.st);
      top = Math.max(top, m.y);
      if (m.air) spun = Math.max(spun, Math.abs(m.spin));
      if (seen.length > 4 && !m.air && m.fall <= 0) break;
    }
    return { hit, twice, path: [...new Set(seen)].join('>'), top: +top.toFixed(1),
             spun: +spun.toFixed(2), y: +m.y.toFixed(2), lie: m.lie,
             r: +Math.hypot(m.x, m.z).toFixed(1), lim: +(arenaR + 22).toFixed(1) };
  });
  /* 飛多高照拋物線算就好：初速 11、重力 26 → 頂點 11² ÷ (2×26) ＝ 2.33 格，
     一幀 0.05 秒抽樣抓到的會略低一點。寫 3 是我一開始沒算就填的數字。 */
  ok('猴子被炸飛：飛上去翻滾 → 落地躺一下 → 爬起來繼續逛（同小人那一套）',
     hFly.hit && !hFly.twice && hFly.path === 'air>fall>fun' &&
     hFly.top > 1.8 && hFly.top < 2.4 && hFly.spun > 1 &&
     hFly.y === 0 && hFly.lie === 0 && hFly.r < hFly.lim,
     '飛到 ' + hFly.top + ' 格高、翻了 ' + hFly.spun + ' 弧度 → ' + hFly.path +
     '，落在半徑 ' + hFly.r + '（邊界 ' + hFly.lim + '）');

  /* ── 猴子：兩種著火演法（同小人：躺著滾 / 站著抱頭跑圈圈）── */
  const hBurn = await page.evaluate(() => {
    cleanTools(); phase = 'done'; doomT = 1e9;
    const roll = spawnBeast('ape', 1);
    roll.x = 26; roll.z = 6; roll.st = 'fun'; roll.stay = 999;
    const run = spawnBeast('snow', 1);
    run.x = 26; run.z = -6; run.st = 'fun'; run.stay = 999;
    const a = igniteBeast(roll, 1), b = igniteBeast(run, 0);
    const twice = igniteBeast(roll, 1);                 // 已經在燒的不會再點一次
    /* 火苗池要先清乾淨才量得到「牠有沒有在冒火」：那一池是全場共用、上限 HOT_MAX，
       滿到剩 40 格以內就不再生（burnBeastFx 的 break，同小人）。而池子只有在
       完整的 step 才會老化，這裡只走 stepDoom——前面幾段留下來的火苗會一直卡在池子裡。 */
    hot.length = 0;
    const hot0 = hot.length;
    const rx = roll.x, rz = roll.z;
    let rollMove = 0, runR = 0;
    for (let i = 0; i < 60; i++) {
      stepDoom(0.05);
      rollMove = Math.max(rollMove, Math.hypot(roll.x - rx, roll.z - rz));
      runR = Math.max(runR, Math.hypot(run.x - run.bx, run.z - run.bz));
    }
    const mid = { rollSpin: +roll.spin.toFixed(2), rollLie: +roll.lie.toFixed(2),
                  runLie: run.lie, runGait: +run.gait.toFixed(2), fx: hot.length > hot0 };
    for (let i = 0; i < 200; i++) stepDoom(0.05);       // 燒完
    return { a, b, twice, mid, rollMove: +rollMove.toFixed(1), runR: +runR.toFixed(1),
             burnT: B_BURN,
             after: { burn: roll.burn, lie: roll.lie, spin: +roll.spin.toFixed(2) } };
  });
  ok('點得著，而且分躺著滾與站著跑圈圈兩種（已經在燒的不會再點一次）',
     hBurn.a && hBurn.b && !hBurn.twice && hBurn.mid.fx &&
     Math.abs(hBurn.mid.rollSpin - 1.57) < 0.05 && hBurn.mid.rollLie > 1 &&
     hBurn.mid.runLie === 0 && hBurn.mid.runGait > 0.9,
     '點著 ' + hBurn.a + '/' + hBurn.b + '、再點一次 ' + hBurn.twice + '、火苗 ' +
     hBurn.mid.fx + '；躺著滾：躺平角 ' + hBurn.mid.rollSpin + '、抬升 ' +
     hBurn.mid.rollLie + ' 倍、就地翻 ' + hBurn.rollMove + ' 格；跑圈圈：躺著＝' +
     hBurn.mid.runLie + '、腳步 ' + hBurn.mid.runGait + '、繞著定點 ' + hBurn.runR + ' 格');
  ok('燒完自己拍拍灰站起來',
     hBurn.after.burn === 0 && hBurn.after.lie === 0 && Math.abs(hBurn.after.spin) < 0.05,
     '燒 ' + hBurn.burnT + ' 秒之後：burn ' + hBurn.after.burn + '、躺平角 ' +
     hBurn.after.spin);

  /* ── 水澆得熄，濕的當下點不著（同小人） ── */
  const hWet = await page.evaluate(() => {
    cleanTools(); phase = 'done'; doomT = 1e9;
    const m = spawnBeast('ape', 1);
    m.x = 26; m.z = 0; m.st = 'fun'; m.stay = 999;
    igniteBeast(m, 1);
    const was = m.burn > 0;
    wetBeast(m);
    const out = { burn: m.burn, wet: +m.wet.toFixed(1), fall: m.fall > 0, lie: m.lie };
    const again = igniteBeast(m, 1);
    return { was, out, again, WET: WET_TIME };
  });
  ok('水澆得熄牠身上的火，濕的當下點不著（同小人）',
     hWet.was && hWet.out.burn === 0 && hWet.out.wet === hWet.WET &&
     hWet.out.fall && !hWet.again,
     '澆完 burn ' + hWet.out.burn + '、濕 ' + hWet.out.wet + ' 秒、蹲著起不來＝' +
     hWet.out.fall + '；再點一次 ' + hWet.again);

  /* ── 閃電：劈到猴子＝點著並打倒；劈到飛龍＝點著牠（v1.154 起牠也著得了火） ── */
  await fillAll(page);
  const hBolt = await page.evaluate(() => {
    cleanTools(); phase = 'done'; doomT = 1e9; clearFires();
    for (const b of blocks) b.wet = 0;
    const m = spawnBeast('ape', 1);
    m.x = 40; m.z = 0; m.y = 0; m.st = 'fun'; m.stay = 999;
    /* 落點是雲底半徑 STRIKE_R 內隨機的，所以打到中就停；
       一道打不中的機率是 1−(5÷13)²，150 道全都沒中約等於 0。 */
    let n = 0;
    for (; n < 150 && m.burn <= 0 && m.fall <= 0; n++) strike({ x: m.x, z: m.z, y: 40 });
    const ape = { n, burn: m.burn > 0, lie: m.lie, spin: +m.spin.toFixed(2) };
    cleanTools(); phase = 'done'; doomT = 1e9;
    const d = spawnDragon(1);
    d.x = 40; d.z = 0; d.st = 'ring'; d.y = 30;        // 巡航高度：雷認的是水平距離
    let k = 0;
    for (; k < 150 && d.st === 'ring'; k++) strike({ x: d.x, z: d.z, y: 40 });
    return { ape, dra: { k, st: d.st, burn: d.burn || 0 } };
  });
  ok('雷劈到猴子＝當場點著並打倒（同小人）',
     hBolt.ape.burn && hBolt.ape.lie > 0,
     '第 ' + hBolt.ape.n + ' 道劈中：身上有火 ' + hBolt.ape.burn + '、躺平角 ' +
     hBolt.ape.spin);
  /* v1.153 以前這一條驗的是「點不著，改成把牠打下來」。使用者：「飛龍也要做著火狀態
     反應」——現在劈中就是點著牠，摔下來變成著火那一趟裡的一段（見下面）。 */
  ok('雷劈到飛龍＝點著牠，牠拖著火飛一段才摔下來',
     hBolt.dra.st === 'ablaze' && hBolt.dra.burn > 0,
     '第 ' + hBolt.dra.k + ' 道劈中 → ' + hBolt.dra.st + '，身上的火 ' +
     hBolt.dra.burn.toFixed(1) + ' 秒');

  /* ── 飛龍：摔 → 趴 → 起飛 → 歸隊 ── */
  await fillAll(page);
  const hDra = await page.evaluate(() => {
    cleanTools(); phase = 'done'; doomT = 1e9;
    const m = spawnDragon(1);
    for (let i = 0; i < 600 && m.st !== 'ring'; i++) stepDoom(0.05);
    const before = m.st;
    m.left = 4;                                        // 假裝牠是天災版、還有火球配額
    for (let i = 0; i < 40; i++) stepDoom(0.05);       // 先繞一段，turned 已經推進了
    const turned0 = +m.turned.toFixed(2);
    const hit = crashDragon(m), twice = crashDragon(m);
    /* 摔下去之前那 40 幀牠還在盤旋、配額也還在，本來就會吐一顆出來。這裡要驗的是
       「摔了之後不再吐」，所以把已經在飛的那一顆清掉再開始數——量「場上同時有幾顆」
       會變成看那一顆有沒有剛好還在飛（實測跑兩輪就飄掉一次）。 */
    fballs = null;
    const path = [];
    let downY = 0, downT = 0, riseT = 0, fb = 0;
    for (let i = 0; i < 1500 && beasts && beasts.indexOf(m) >= 0; i++) {
      stepDoom(0.05);
      path.push(m.st);
      if (m.st === 'down') { downY = m.y; downT++; }
      if (m.st === 'rise') riseT++;
      fb = Math.max(fb, fballs ? fballs.length : 0);
      if (m.st === 'in' || m.st === 'ring' || m.st === 'out') break;
    }
    return { before, hit, twice, left: m.left, turned0, turned: +m.turned.toFixed(2),
             path: [...new Set(path)].join('>'), fb,
             downY: +downY.toFixed(2), gnd: +draGround().toFixed(2),
             downT: +(downT * 0.05).toFixed(1), riseT: +(riseT * 0.05).toFixed(1),
             back: m.st, y: +m.y.toFixed(1),
             cruise: +Math.max(DRA_MIN, (bp ? bp.height : 20) + DRA_UP).toFixed(1) };
  });
  ok('飛龍被打下來：摔 → 趴 → 拍翅起飛 → 爬回巡航高度歸隊',
     hDra.hit && !hDra.twice && hDra.path === 'crash>down>rise>in' &&
     hDra.back === 'in' && Math.abs(hDra.y - hDra.cruise) < 0.5,
     hDra.before + ' → ' + hDra.path + ' → ' + hDra.back + '；趴了 ' + hDra.downT +
     ' 秒、爬升 ' + hDra.riseT + ' 秒回到 ' + hDra.y + ' 格（巡航 ' + hDra.cruise + '）');
  ok('趴著的高度剛好貼草皮，盤旋進度不歸零，而且摔了就不吐火球',
     Math.abs(hDra.downY - hDra.gnd) < 0.01 && hDra.turned >= hDra.turned0 &&
     hDra.left === 0 && hDra.fb === 0,
     '趴在 y=' + hDra.downY + '（地面 ' + hDra.gnd + '）、繞了 ' + hDra.turned0 +
     ' 弧度沒被歸零、火球配額 4 → ' + hDra.left);

  /* 本來就要飛出場的，起飛之後不該又繞一圈回來。 */
  const hBack = await page.evaluate(() => {
    cleanTools(); phase = 'done'; doomT = 1e9;
    const m = spawnDragon(1);
    m.st = 'out'; m.x = 30; m.z = 0; m.a = 0;
    crashDragon(m);
    for (let i = 0; i < 1500 && (m.st === 'crash' || m.st === 'down' || m.st === 'rise'); i++)
      stepDoom(0.05);
    return { was: m.was, back: m.st };
  });
  ok('被打下來時本來要飛出場的，起飛之後接回原本那一段',
     hBack.was === 'out' && hBack.back === 'out', hBack.was + ' → ' + hBack.back);

  /* ── 飛龍著火（v1.154）── */
  /* 使用者：「飛龍也要做著火狀態反應」，形態選的是「空中拖火 → 墜地 → 燒完 → 起飛」。
     後兩段就是上面那套倒地起飛，所以這裡驗的是新的那兩段與接縫。 */
  await fillAll(page);
  const hFire = await page.evaluate(() => {
    cleanTools(); phase = 'done'; doomT = 1e9; clearFires();
    for (const b of blocks) b.wet = 0;
    hot.length = 0;
    const m = spawnDragon();                           // 天災版：本來有火球配額
    for (let i = 0; i < 600 && m.st !== 'ring'; i++) stepDoom(0.05);
    const left0 = m.left, y0 = m.y;
    const lit = igniteBeast(m, 1);
    const twice = igniteBeast(m, 1);                   // 已經在燒的不會再點一次
    const st0 = m.st, burn0 = +m.burn.toFixed(1);
    fballs = null;                                     // 摔之前吐出去的那幾顆不算
    const path = [];
    let abl = 0, drop = 0, downBurn = 0, riseB = 0, fb = 0, fx = false;
    let yPrev = m.y;
    for (let i = 0; i < 3000 && beasts && beasts.indexOf(m) >= 0; i++) {
      stepDoom(0.05);
      path.push(m.st);
      if (m.st === 'ablaze') { abl++; drop += Math.max(0, yPrev - m.y); fx = fx || hot.length > 0; }
      if (m.st === 'down' && m.burn > 0) downBurn++;
      if (m.st === 'rise' && m.burn > 0) riseB++;
      fb = Math.max(fb, fballs ? fballs.length : 0);
      yPrev = m.y;
      if (m.st === 'in' || m.st === 'ring' || m.st === 'out') break;
    }
    return { lit, twice, st0, burn0, left0, left: m.left, y0: +y0.toFixed(1),
             path: [...new Set(path)].join('>'), abl: +(abl * 0.05).toFixed(1),
             drop: +drop.toFixed(1), fx, fb, riseB,
             downBurn: +(downBurn * 0.05).toFixed(1), back: m.st,
             burnT: DRA_BURN, ablT: DRA_ABLAZE.slice() };
  });
  ok('飛龍著火：拖著火飛一段 → 摔下來 → 在地上燒完才拍翅起飛（已經在燒的不會再點一次）',
     hFire.lit && !hFire.twice && hFire.st0 === 'ablaze' && hFire.burn0 === hFire.burnT &&
     hFire.path === 'ablaze>crash>down>rise>in' && hFire.back === 'in' &&
     hFire.abl >= hFire.ablT[0] - 0.1 && hFire.abl <= hFire.ablT[1] + 0.1 &&
     hFire.downBurn > 0.3 && hFire.riseB === 0,
     hFire.path + '；拖著火飛了 ' + hFire.abl + ' 秒（抽樣範圍 ' + hFire.ablT.join('～') +
     '）、在地上又燒了 ' + hFire.downBurn + ' 秒，起飛時身上還有火的幀數 ' + hFire.riseB);
  ok('拖火那一段是一路往下沉的，身上會冒火苗，而且著火就不吐火球了',
     hFire.drop > 5 && hFire.fx && hFire.left0 >= 3 && hFire.left === 0 && hFire.fb === 0,
     '從 ' + hFire.y0 + ' 格往下沉了 ' + hFire.drop + ' 格、火苗 ' + hFire.fx +
     '、火球配額 ' + hFire.left0 + ' → ' + hFire.left + '（這一趟吐了 ' + hFire.fb + ' 顆）');

  const hDouse = await page.evaluate(() => {
    cleanTools(); phase = 'done'; doomT = 1e9;
    const air = spawnDragon(1);
    for (let i = 0; i < 600 && air.st !== 'ring'; i++) stepDoom(0.05);
    igniteBeast(air, 1);
    const was = air.st;
    const wet = wetBeast(air);
    const inAir = { burn: air.burn, st: air.st, wet: +air.wet.toFixed(1) };
    const again = igniteBeast(air, 1);                 // 濕的當下點不著
    for (let i = 0; i < 200; i++) stepDoom(0.05);      // 濕度自己會退（stepDragon 在減）
    const dry = +air.wet.toFixed(1);
    /* 已經摔在地上、身上還在燒的那一隻：澆熄之後照原本的節奏爬起來飛走 */
    cleanTools(); phase = 'done'; doomT = 1e9;
    const gnd = spawnDragon(1);
    for (let i = 0; i < 600 && gnd.st !== 'ring'; i++) stepDoom(0.05);
    igniteBeast(gnd, 1);
    for (let i = 0; i < 2000 && gnd.st !== 'down'; i++) stepDoom(0.05);
    const burning = gnd.burn > 0;
    wetBeast(gnd);
    let rose = 0;
    for (let i = 0; i < 2000; i++) {
      stepDoom(0.05);
      if (gnd.st === 'in' || gnd.st === 'ring' || gnd.st === 'out') { rose = 1; break; }
    }
    cleanTools();
    return { was, inAir, again, dry, burning, rose, WET: WET_TIME };
  });
  ok('著火的龍澆得熄：在天上的直接回航線，趴在地上的照原本節奏爬起來飛走',
     hDouse.was === 'ablaze' && hDouse.inAir.burn === 0 && hDouse.inAir.st === 'in' &&
     hDouse.inAir.wet === hDouse.WET && !hDouse.again && hDouse.dry === 0 &&
     hDouse.burning && hDouse.rose === 1,
     '天上：' + hDouse.was + ' → ' + hDouse.inAir.st + '（burn ' + hDouse.inAir.burn +
     '、濕 ' + hDouse.inAir.wet + ' 秒、再點一次 ' + hDouse.again + '、10 秒後濕度 ' +
     hDouse.dry + '）；地上：燒著的澆熄後爬起來＝' + hDouse.rose);

  const hDownFire = await page.evaluate(() => {
    cleanTools(); phase = 'done'; doomT = 1e9;
    const m = spawnDragon(1);
    for (let i = 0; i < 600 && m.st !== 'ring'; i++) stepDoom(0.05);
    crashDragon(m);
    for (let i = 0; i < 2000 && m.st !== 'down'; i++) stepDoom(0.05);
    const t0 = +m.t.toFixed(2);
    const lit = igniteBeast(m, 1);
    const st = m.st;                                   // 就地燒，不會再摔一次
    let waited = 0;
    for (let i = 0; i < 3000; i++) { stepDoom(0.05); if (m.st !== 'down') break; waited++; }
    const after = m.st;
    cleanTools();
    return { t0, lit, st, waited: +(waited * 0.05).toFixed(1), after, burnT: DRA_BURN };
  });
  ok('趴在地上被點著的龍會先把火壓掉才飛得起來（不會再摔一次）',
     hDownFire.lit && hDownFire.st === 'down' && hDownFire.after === 'rise' &&
     hDownFire.waited > hDownFire.t0 + 0.5 &&
     Math.abs(hDownFire.waited - hDownFire.burnT) < 1,
     '趴著還剩 ' + hDownFire.t0 + ' 秒就被點著 → 又趴了 ' + hDownFire.waited +
     ' 秒（火燒 ' + hDownFire.burnT + ' 秒）才進 ' + hDownFire.after);

  /* ── 爆炸對飛龍算三維距離：地面一顆小炸彈打不到天上的牠 ── */
  await fillAll(page);
  const hAir = await page.evaluate(() => {
    cleanTools(); phase = 'done'; doomT = 1e9;
    const m = spawnDragon(1);
    m.x = 0; m.z = 0; m.st = 'ring'; m.y = 30;
    explode({ x: 0, y: 1, z: 0 }, 6, 12);
    const small = m.st;
    explode({ x: 0, y: 1, z: 0 }, 40, 30);
    return { small, big: m.st };
  });
  /* 打得到那一發是帶火的（爆炸一律 lit＝true），所以 v1.154 起牠是**先著火**
     （ablaze）再摔——不是直接進 crash。這一條驗的是「小的打不到、大的打得到」。 */
  ok('地面一顆小炸彈打不到 30 格高的飛龍，核彈那種大的打得到',
     hAir.small === 'ring' && hAir.big === 'ablaze',
     '半徑 6 → ' + hAir.small + '；半徑 40 → ' + hAir.big);

  /* ── 龍捲風捲得走猴子，捲不走飛龍 ── */
  await fillAll(page);
  const hTw = await page.evaluate(() => {
    cleanTools(); phase = 'done'; doomT = 1e9;
    const m = spawnBeast('ape', 1);
    m.x = -30; m.z = 0; m.y = 0; m.st = 'fun'; m.stay = 999;
    const d = spawnDragon(1);
    d.x = -30; d.z = 0; d.st = 'ring'; d.y = 30;
    twists = null;
    launchTornado({ x: -30, z: 0 }, { x: -30, z: 6 });
    let up = 0, air = 0;
    /* 「離過地」要取整段的最大值，不能只看最後一刻（v1.151）：漏斗 v1.151 起
       走 15.6 單位／秒，三秒就竄到四十幾單位外，猴子被捲上去之後**會落地**——
       結尾那一刻的 m.air 是 0，但它確實被捲走了。這一條驗的是「捲得走」。 */
    for (let i = 0; i < 60; i++) {
      step(0.05);
      up = Math.max(up, m.y); air = Math.max(air, m.air ? 1 : 0);
    }
    return { up: +up.toFixed(1), air, airEnd: m.air ? 1 : 0, dra: d.st, dy: +d.y.toFixed(0) };
  });
  ok('龍捲風捲得走猴子，捲不走天上的飛龍',
     hTw.up > 2 && hTw.air === 1 && hTw.dra !== 'crash',
     '猴子被捲到 ' + hTw.up + ' 格高（三秒後落回地面＝' + (hTw.airEnd ? '還沒' : '已經') +
     '）；飛龍還在 ' + hTw.dra + '（y=' + hTw.dy + '）');

  /* ── 王之財寶的兵器射得中 ── */
  const hWeap = await page.evaluate(() => {
    cleanTools(); phase = 'done'; doomT = 1e9;
    const m = spawnBeast('snow', 1);
    m.x = 26; m.z = 0; m.y = 0; m.st = 'fun'; m.stay = 999;
    /* 一把正朝著牠飛過去的兵器（只驗命中判定，不必真的召喚門陣） */
    const w = { x: m.x, y: 1.0, z: m.z - 1, dx: 0, dy: 0, dz: 1, len: 2 };
    const on = weaponVsBeast(w, m.x, 1.0, m.z - 2) === m;
    const high = { x: m.x, y: 40, z: m.z - 1, dx: 0, dy: 0, dz: 1, len: 2 };
    const over = weaponVsBeast(high, m.x, 40, m.z - 2);        // 從頭上飛過去的不算中
    return { on, over: over === null };
  });
  ok('兵器射得中牠，從頭上飛過去的不算中（同打小人那一套）',
     hWeap.on && hWeap.over, '正面 ' + hWeap.on + '／頭上飛過 ' + hWeap.over);

  /* ── 天災那幾隻也打得到，不是只有吉祥物 ── */
  const hDoomHit = await page.evaluate(() => {
    cleanTools(); phase = 'done'; doomT = 1e9;
    const bad = spawnBeast('ape');                     // 天災版（fun 沒給）
    bad.x = 26; bad.z = 0; bad.y = 0;
    const fell = fellBeast(bad, 2);
    const st = { fun: bad.fun, fall: bad.fall > 0, lie: bad.lie };
    for (let i = 0; i < 80; i++) stepDoom(0.05);       // 躺完會爬起來繼續走
    return { fell, st, after: { fall: bad.fall, lie: bad.lie, st: bad.st } };
  });
  ok('天災那幾隻同樣打得倒（同一種生物、同一份程式），躺完會爬起來繼續走',
     hDoomHit.fell && hDoomHit.st.fun === 0 && hDoomHit.st.fall &&
     hDoomHit.after.fall === 0 && hDoomHit.after.lie === 0,
     '打倒天災版的黑獼猴：躺著 ' + hDoomHit.st.fall + ' → 爬起來回到 ' +
     hDoomHit.after.st);

  /* ── 每一種姿勢都貼著草皮，不會陷進去也不會浮起來 ── */
  const hGround = await page.evaluate(() => {
    /* 一塊轉過的方塊在世界 Y 上的半高 ＝ 把它的 OBB 投影到 Y 軸。
       用最長邊當半高會高估，站著的猴子都會被算成陷進地裡。 */
    const low = () => {
      const mesh = ENG.three.beastMesh, m4 = new THREE.Matrix4();
      let lo = 1e9;
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, m4);
        const a = m4.elements;
        if (Math.hypot(a[0], a[1], a[2]) < 1e-4 || Math.hypot(a[4], a[5], a[6]) < 1e-4 ||
            Math.hypot(a[8], a[9], a[10]) < 1e-4) continue;
        lo = Math.min(lo, a[13] - 0.5 * (Math.abs(a[1]) + Math.abs(a[5]) + Math.abs(a[9])));
      }
      return +lo.toFixed(3);
    };
    const one = (kind, setup) => {
      cleanTools(); phase = 'done'; doomT = 1e9;
      const m = spawnBeast(kind, 1);
      m.x = 26; m.z = 0; m.a = 0; m.st = 'fun'; m.stay = 999;
      setup(m);
      draw();
      return low();
    };
    const out = {};
    out.stand = one('ape', () => {});
    out.lie = one('snow', m => { fellBeast(m, 6); for (let i = 0; i < 30; i++) stepDoom(0.05); });
    /* 打滾滾到最側面時最容易陷下去，掃一整圈取最低 */
    cleanTools(); phase = 'done'; doomT = 1e9;
    const r = spawnBeast('ape', 1);
    r.x = 26; r.z = 0; r.a = 0; r.st = 'fun'; r.stay = 999;
    igniteBeast(r, 1);
    let worst = 1e9;
    for (let k = 0; k < 40; k++) {
      r.rph = k / 40 * Math.PI * 2;
      r.roll = B_ROLL_AMP * Math.sin(r.rph);
      r.spin = Math.PI / 2;
      draw();
      worst = Math.min(worst, low());
    }
    out.roll = +worst.toFixed(3);
    /* 飛龍趴著：翅膀是每一幀照翼弧重擺的，所以翼相位也掃一圈 */
    cleanTools(); phase = 'done'; doomT = 1e9;
    const d = spawnDragon(1);
    d.x = 26; d.z = 0; d.a = 0;
    crashDragon(d);
    for (let i = 0; i < 1200 && d.st !== 'down'; i++) stepDoom(0.05);
    let dw = 1e9;
    for (let k = 0; k < 40; k++) {
      d.ph = DRA_DOWN_PH + 0.10 * Math.sin(k / 40 * Math.PI * 2);
      draw();
      dw = Math.min(dw, low());
    }
    out.dragon = +dw.toFixed(3);
    cleanTools();
    return out;
  });
  ok('站著／躺著／打滾／飛龍趴著，四種姿勢都貼著草皮（不陷進去也不浮起來）',
     hGround.stand >= -0.02 && hGround.stand < 0.05 &&
     hGround.lie >= -0.02 && hGround.lie < 0.10 &&
     hGround.roll >= -0.02 && hGround.roll < 0.25 &&
     hGround.dragon >= -0.02 && hGround.dragon < 0.35,
     '最低點：站 ' + hGround.stand + '／躺 ' + hGround.lie + '／滾 ' + hGround.roll +
     '／龍趴著 ' + hGround.dragon);

  /* ── 小人被吹飛的旋轉軸（使用者：「目前似乎在腳底 看起來很奇怪」）── */
  const hPivot = await page.evaluate(() => {
    cleanTools();
    const w = workers[0];
    const box = () => {
      const mesh = ENG.three.workerMesh, m4 = new THREE.Matrix4();
      const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
      for (let k = 0; k < ENG.WPARTS; k++) {
        mesh.getMatrixAt(k, m4);
        const a = m4.elements;
        if (Math.hypot(a[0], a[1], a[2]) < 1e-4 || Math.hypot(a[4], a[5], a[6]) < 1e-4 ||
            Math.hypot(a[8], a[9], a[10]) < 1e-4) continue;
        for (let ax = 0; ax < 3; ax++) {
          const half = 0.5 * (Math.abs(a[ax]) + Math.abs(a[4 + ax]) + Math.abs(a[8 + ax]));
          lo[ax] = Math.min(lo[ax], a[12 + ax] - half);
          hi[ax] = Math.max(hi[ax], a[12 + ax] + half);
        }
      }
      return [0, 1, 2].map(i => (lo[i] + hi[i]) / 2);
    };
    for (const q of workers) { q.air = 0; q.fall = 0; q.burn = 0; q.tilt = 0; q.roll = 0; }
    const w0 = workers[0];
    w0.x = 34; w0.z = 34; w0.y = 3; w0.a = 0; w0.carry = false; w0.dig = 0; w0.plan = 0;
    w0.hail = 0; w0.gait = 0; w0.talk = 0; w0.point = 0;
    const grab = (air, tilt) => { w0.air = air; w0.tilt = tilt; draw(); return box(); };
    const spread = cs => {
      let d = 0;
      for (const a of cs) for (const b of cs)
        d = Math.max(d, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
      return +d.toFixed(2);
    };
    const tilts = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
    const now = tilts.map(t => grab(1, t));
    const was = tilts.map(t => grab(0, t));            // air=0 ＝ 改版前那條路（繞腳底）
    w0.air = 0; w0.tilt = 0; w0.y = 0; draw();
    return { now: spread(now), was: spread(was) };
  });
  /* 量的是「畫出去那 29 塊的包圍盒中心」，而中心不剛好落在旋轉軸（0.65）上——
     安全帽與手上的道具讓它偏一點，所以新的也不會剛好是 0。門檻照量到的訂：
     新 0.27 是那個偏量，舊 2.33 是真的被甩出去，差 8.6 倍。 */
  ok('小人被吹飛時繞身體中段翻，不是繞腳底（身體中心留在原地）',
     hPivot.now < 0.4 && hPivot.was > 1.5 && hPivot.was > hPivot.now * 5,
     '四個翻滾角下身體中心跑掉多少：新 ' + hPivot.now + ' 格、繞腳底 ' + hPivot.was + ' 格');

  /* ── 畫面點得到牠們（手指／火把／水桶那一把） ── */
  const hPick = await page.evaluate(() => {
    cleanTools(); phase = 'done'; doomT = 1e9;
    const m = spawnBeast('ape', 1);
    m.x = 0; m.z = 38; m.y = 0; m.a = 0; m.st = 'fun'; m.stay = 999;
    ENG.cam.yaw = Math.PI / 2; ENG.cam.pitch = 0.05; ENG.cam.dist = 12;
    ENG.cam.tx = m.x; ENG.cam.ty = 1.1; ENG.cam.tz = m.z;
    ENG.camTarget.tx = m.x; ENG.camTarget.ty = 1.1; ENG.camTarget.tz = m.z;
    /* 先把小人請到場外，量完再放回來。閒晃圈是 `siteR + 2~9`，而這隻猴子就站在
       z＝38：有人剛好滾到鏡頭跟猴子中間的話，`man` 那一把人跟獸同級（見 PICK_MAN），
       點到的就是他——實測整輪測試撞過一次。 */
    const stash = workers.map(w => [w.x, w.z]);
    for (const w of workers) { w.x = 400; w.z = 400; }
    /* 一定要真的 render 過再投影：draw() 只是把矩陣塞進 InstancedMesh，
       相機的 matrixWorld／matrixWorldInverse 是 render 才更新的，
       拿沒更新過的去 project 會投到別的地方（實測整個點空、連地面都沒點到）。 */
    ENG.updateCamera(0.001); draw(); ENG.render();
    /* 把牠的胸口投影成畫面座標再點下去，不要靠鏡頭角度湊「牠應該在正中央」 */
    const cv = ENG.three.renderer.domElement;
    const v = new THREE.Vector3(m.x, 1.1, m.z).project(ENG.three.camera);
    const px = (v.x * 0.5 + 0.5) * cv.clientWidth, py = (-v.y * 0.5 + 0.5) * cv.clientHeight;
    const hit = ENG.pick(px, py, 'man');
    const same = !!hit && hit.kind === 'beast' && beastAt(hit.idx) === m;
    /* 其餘破壞道具那一把（skip）一律不理活的東西——被路過的猴子擋掉那一下就白點了 */
    const skip = ENG.pick(px, py, 'skip');
    workers.forEach((w, i) => { w.x = stash[i][0]; w.z = stash[i][1]; });
    const poked = fellBeast(m, 2);
    return { kind: hit ? hit.kind : null, same, skip: skip ? skip.kind : null,
             poked, fall: m.fall > 0 };
  });
  ok('手指那一把點得到牠（其餘破壞道具照舊不理活的東西）',
     hPick.same && hPick.kind === 'beast' && hPick.skip !== 'beast' &&
     hPick.poked && hPick.fall,
     '手指點到 ' + hPick.kind + '（同一隻＝' + hPick.same + '）、破壞道具那一把點到 ' +
     hPick.skip);

  /* ── 每一支破壞道具的傷害都要走到「認得動物」那條路上（v1.158.2）──────────
     v1.146 補動物時是一處一處加上去的，之後再新增工具很容易漏掉——而漏掉長得跟通過
     一模一樣。這一條把 TOOLS 整張表跑一遍當守門員。

     **不賭落點。** 投石機、龍捲風、打雷的落點本來就是隨機的，「把動物擺在那裡、
     斷言牠有反應」等於再生一條會飄的測試（正是這一版在修的毛病）。所以驗的是
     **這一發有沒有經過認得動物的那幾支**：
       · eachBeastNear ── afterHit／explode／stepBall／打雷共用的那支範圍掃描
       · tossBeast／igniteBeast／fellBeast／wetBeast ── 龍捲風、積水那幾條自己寫的迴圈
       · weaponVsBeast ── 王之財寶的線段掃掠
     沾到任何一支，就代表動物在這條傷害路徑的視野裡。

     **兩支刻意不在名單上**（NO_BEAST），理由都查證過：
       · 手指：useTool 第一行就 return 0，設計上只戳小人（見 game-ui.js 的 pick 'man'）。
       · 放火：torch 只呼叫 igniteAt（那支的迴圈是 `for (const b of blocks)`）。
         它對動物是走 **game-ui.js 的點擊分派**那條（`:307` igniteBeast，見上面
         〈手指那一把點得到牠〉），不經過 useTool——所以這條測不到它是**對的**。
     水桶同樣有點擊那條，但它經由 useTool 倒下去的水積起來之後照樣淋得到
     （stepWater 那段 wetBeast），所以留在名單內。
     煙火 v1.158.2 盤點時本來也在豁免名單上（火星只呼叫 igniteAt，對小人也一樣沒作用），
     v1.159.0 依使用者要求補了 fwBurn，所以它現在要沾得到——而 fwBurn 是**每一顆火星
     每一幀都掃一次**，跟 eachBeastNear 一樣不必賭它剛好燒到誰。 */
  const hTools = await page.evaluate(() => {
    const NAMES = ['eachBeastNear', 'tossBeast', 'igniteBeast', 'fellBeast',
                   'wetBeast', 'weaponVsBeast', 'fwBurn'];
    const orig = {};
    let seen = 0;
    for (const n of NAMES) {
      orig[n] = window[n];
      window[n] = function (...a) { seen++; return orig[n].apply(null, a); };
    }
    const TWO = ['ball', 'tornado', 'gate', 'sword'];   // 要點兩下的那幾支
    const out = [];
    try {
      for (const t of TOOLS) {
        cleanTools(); clearFires(); beasts = null;
        targetCnt = 600; startBuild(true); completeNow();
        phase = 'done'; doomT = 1e9;
        const m = spawnBeast('ape', 1);
        /* 站在建築外殼上、落點就取在牠身上（v1.158.2）。**要壓在積木上**：
           槌子那一路是 smash → afterHit，而 afterHit 開頭就 `if (n <= 0) return`——
           落點取在建築外面的空地時一塊都沒打掉，那條路根本走不到動物那一段
           （第一版落點取 radius + 2，量到 hammer 0、bighammer 2，差別只是半徑大小）。 */
        m.x = bp.radius - 0.5; m.z = 0; m.y = 0; m.st = 'fun'; m.stay = 999;
        /* 落點取「離牠最近的那一塊積木」而不是牠腳下那個座標（v1.165）：
           小槌的半徑縮到 3.6 之後，牠腳邊那個點的球裡可能一塊積木都沒有 →
           afterHit 第一行就 return，這條就變成在測半徑而不是在測「有沒有經過動物」。 */
        let near = null, best = 1e9;
        for (const b of blocks) {
          if (b.st !== SET) continue;
          const d = Math.hypot(b.x - m.x, b.y - 1, b.z - m.z);
          if (d < best) { best = d; near = b; }
        }
        const P = near ? { x: near.x, y: near.y, z: near.z } : { x: m.x, y: 1, z: m.z };
        const hit = { kind: 'block', point: P, dir: { x: 0, y: -1, z: 0 } };
        tool = t.id;
        seen = 0;
        // 第一下決定「從哪裡打」，第二下才是目標；一下就發的那幾支不必先點
        if (TWO.indexOf(t.id) >= 0)
          useTool({ kind: 'ground', point: { x: -bp.radius - 12, y: 0, z: 0 } });
        useTool(hit);
        // 10 秒夠慢的那幾支走完：魔法 6 秒引信、王之財寶射 7 秒、龍捲風掃 10 秒
        for (let i = 0; i < 200; i++) step(0.05);
        out.push({ id: t.id, seen });
      }
    } finally {
      for (const n of NAMES) window[n] = orig[n];
      cleanTools(); beasts = null;
    }
    return out;
  });
  const NO_BEAST = ['finger', 'fire'];
  const tMissed = hTools.filter(r => NO_BEAST.indexOf(r.id) < 0 && r.seen === 0).map(r => r.id);
  const tWrong = hTools.filter(r => NO_BEAST.indexOf(r.id) >= 0 && r.seen > 0).map(r => r.id);
  ok('每一支破壞道具的傷害都經過認得動物的那幾支（手指與放火例外，理由見註解）',
     hTools.length === NTOOL && tMissed.length === 0 && tWrong.length === 0,
     hTools.length + ' 支：' + hTools.map(r => r.id + ' ' + r.seen).join('、') +
     (tMissed.length ? '；**沒沾到動物的：' + tMissed.join('、') + '**' : '') +
     (tWrong.length ? '；**不該沾到卻沾到的：' + tWrong.join('、') + '**' : ''));

  await page.evaluate(() => { stepDoom = () => {}; cleanTools(); });

  /* ══════════ 隕石 ══════════ */
  await head('隕石');
  /* 靶要**比爆炸範圍大**（v1.151，本來是新天鵝堡 3000）。新天鵝堡的 siteR 只有 17，
     而 v1.151.1 的隕石半徑是 18.4：一顆下去多半整座掃平，爆炸半徑外常常只剩幾十塊
     ——那幾十塊當場點著之後 2.2 秒就燒完脫落，於是「兩秒後蔓延開」反而變少。
     同一組參數各跑 10 趟：**新天鵝堡 5 趟不合格**（半徑外剩 77／1815／71／582／68／252／
     76／641／106／1174 塊，當場燒 32～44、兩秒後 20～149），**萬里長城 10 趟全過**
     （半徑外剩 1621～2039、當場燒一律 44、兩秒後 137～150）。所以改打萬里長城
     （x 跨 −27～27）並把落點壓在一端：遠端那一截在 18.4 之外活得下來、
     又落在 igniteAround 的 29.4 裡面，所以照樣被點著、照樣蔓延。 */
  await reset(page, { shape: '萬里長城', cnt: 3000, workers: 4 });
  const met = await page.evaluate(() => {
    completeNow();
    clearFires();
    hot.length = 0; flashes.length = 0; dust.length = 0;
    const dust0 = dust.length;
    callMeteor({ x: -siteR * 0.75, y: 4, z: 0 });
    const m = meteors[0];
    const aim = { x: m.tx, y: m.ty, z: m.tz };
    for (let i = 0; i < 40; i++) step(0.05);          // 2 秒：還在倒數
    draw(); ENG.render();
    const wait = { n: meteors.length, lit: meteors.filter(k => k.lit).length,
                   mark: dust.length - dust0, calls: ENG.info().calls };
    let g = 0;
    while (meteors && !meteors[0].lit && g++ < 60) step(0.05);
    const enter = { t: +(g * 0.05).toFixed(2), y: +meteors[0].y.toFixed(1) };
    /* 45°：水平還要飛的距離要等於還沒掉的高度。取兩個時間點量，
       不是只量出現的那一刻——只量一點的話，等速直線與拋物線分不出來。 */
    const ang = [];
    for (let k = 0; k < 8; k++) {
      step(0.05);
      if (!meteors || !meteors[0]) break;
      const q = meteors[0];
      ang.push({ h: +Math.hypot(q.x - aim.x, q.z - aim.z).toFixed(2), up: +(q.y - aim.y).toFixed(2) });
    }
    /* draw call 要用「同一幀有沒有它」來量，不能比前後兩幀：
       倒數中的地面標記、飛行中的火苗與煙各自都會讓別的 mesh 現身，
       前後相減量到的是那些東西的帳。lit 歸零就等於這一幀沒有隕石在天上。 */
    draw(); ENG.render();
    const callsOn = ENG.info().calls;
    const litSaved = meteors.map(k => k.lit);
    for (const k of meteors) k.lit = 0;
    draw(); ENG.render();
    const callsOff = ENG.info().calls;
    meteors.forEach((k, i) => { k.lit = litSaved[i]; });
    const flying = { hot: hot.length, on: callsOn, off: callsOff };
    let g2 = 0;
    while (meteors && g2++ < 60) step(0.05);          // 撞下去
    /* 只數「還站著又燒起來」的：碎料的火另外算（爆炸一次就上千塊），
       混在一起的話這裡量到的是碎料的量，不是火有沒有蔓延。 */
    const nSet = () => fires ? fires.filter(f => f.sp).length : 0;
    const hit = { fires: nSet(), flash: flashes.length, set: blocks.filter(b => b.st === 3).length,
                  fy: flashes.length ? +flashes[0].y.toFixed(1) : -1, smashed: stats.smashed };
    for (let i = 0; i < 40; i++) step(0.05);          // 兩秒後火該蔓延開了
    const spread = nSet();
    return { wait, enter, ang, flying, hit, spread,
             R: MET_R, rockR: ROCK_R, sz: MET_S, fall: MET_FALL };
  });
  ok('點下去先倒數，天上還沒東西',
     met.wait.n === 1 && met.wait.lit === 0 && met.wait.mark > 20,
     '兩秒後：場上 ' + met.wait.n + ' 顆、在飛 ' + met.wait.lit +
     ' 顆，地面標記噴了 ' + met.wait.mark + ' 團塵');
  ok('3 秒後才進大氣層', met.enter.t >= 0.9 && met.enter.t <= 1.15 && met.enter.y > 50,
     '倒數結束後 ' + met.enter.t + ' 秒開始畫，出現高度 y=' + met.enter.y);
  /* 45° 就是「水平還要飛的距離＝還沒掉的高度」。等速直線的話這個比值全程都是 1 */
  ok('以 45 度直線插下來', met.ang.length >= 6 &&
     met.ang.every(a => Math.abs(a.h / a.up - 1) < 0.06),
     met.ang.slice(0, 4).map(a => '水平 ' + a.h + '／高度 ' + a.up).join('　'));
  /* 門檻壓在 15：尾巴的火苗壽命只有 0.1～0.4 秒又逐顆隨機，同一個取樣點量到的
     在 24～40 之間跳（原本訂 25 會偶爾誤判）。要驗的是「有一條火」，不是精確的顆數。 */
  ok('下墜時拖著一條火', met.flying.hot > 15, '同時 ' + met.flying.hot + ' 顆火苗');
  /* 一個是主畫面、一個是陰影貼圖：石頭有 castShadow，落地前地上那塊影子
     剛好提示它要砸哪裡，這個 call 是值得付的。不飛的時候兩個都不畫。 */
  ok('那顆石頭吃 2 個 draw call（畫面＋陰影），沒在飛就不畫',
     met.flying.on - met.flying.off === 2,
     '同一幀有石頭 ' + met.flying.on + ' 個 call、拿掉 ' + met.flying.off + ' 個');
  /* v1.46 起隕石不生火球：它是「砸下來燒起來」，不是又一發爆炸。
     燒起來與蔓延照舊——那才是這把道具的重點。 */
  ok('落地不炸出火球，但會燒起來',
     met.hit.flash === 0 && met.hit.fires > 0 && met.spread > met.hit.fires,
     '火球 ' + met.hit.flash + ' 顆、當場點著 ' + met.hit.fires +
     ' 塊，兩秒後蔓延到 ' + met.spread + ' 塊（爆炸半徑外還站著 ' + met.hit.set + ' 塊）');
  /* 拿掉的只有「爆炸的長相」：火球、噴出來的火星、貼地光環、衝擊環。
     衝擊波本身留著（積木照樣被砸飛），塵土與震動也留著。
     直接叫 meteorHit 量：這樣不會混到倒數期間那些地面預告環。 */
  const metLook = await page.evaluate(() => {
    targetCnt = 3000; shapePick = SHAPES.findIndex(s => s.n === '美國國會大廈');
    startBuild(true); completeNow();
    clearFires();
    hot.length = 0; flashes.length = 0; fxRings.length = 0; dust.length = 0;
    const set0 = placedCnt;
    meteorHit({ x: 0, y: 6, z: 0 });
    const mine = { flash: flashes.length, rings: fxRings.length, hot: hot.length,
                   dust: dust.length, smashed: set0 - placedCnt,
                   fires: fires ? fires.length : 0, shake: +ENG.cam.shake.toFixed(2) };
    // 對照組：同尺寸的普通爆炸該有火球與衝擊環
    hot.length = 0; flashes.length = 0; fxRings.length = 0;
    startBuild(true); completeNow();
    explode({ x: 0, y: 6, z: 0 }, MET_R, MET_POW);
    return { mine, boom: { flash: flashes.length, rings: fxRings.length, hot: hot.length } };
  });
  ok('不生火球、火星與衝擊環（同尺寸的普通爆炸都有）',
     metLook.mine.flash === 0 && metLook.mine.rings === 0 && metLook.mine.hot === 0 &&
     metLook.boom.flash > 0 && metLook.boom.rings > 0 && metLook.boom.hot > 0,
     '隕石 火球 ' + metLook.mine.flash + '／環 ' + metLook.mine.rings + '／火星 ' + metLook.mine.hot +
     '　普通爆炸 ' + metLook.boom.flash + '／' + metLook.boom.rings + '／' + metLook.boom.hot);
  ok('衝擊波、塵土、震動、點火都還在',
     metLook.mine.smashed > 30 && metLook.mine.dust > 10 &&
     metLook.mine.shake > 0.3 && metLook.mine.fires > 0,
     '砸飛 ' + metLook.mine.smashed + ' 塊、揚塵 ' + metLook.mine.dust +
     ' 團、震動 ' + metLook.mine.shake + '、點著 ' + metLook.mine.fires + ' 塊');
  /* 使用者：「隕石大幅提高大小 約5倍(包含隕石本體&破壞範圍)」。
     兩件事寫成一條，因為使用者要的是同一件事：這顆東西整體變大。
     **5 倍講的是體積，不是半徑**（v1.151.1，使用者：「隕石現在有點過大了 因為你是
     半徑變為五倍 體積就會變 5^3 如果是這樣大概半徑接近兩倍的程度」）：v1.151 照半徑 ×5
     做出來的範圍是 46（體積 ×125、比核彈的 30 還大一圈），一顆就把 3000 塊的地標
     整個掃成瓦礫。現在是半徑 ×2（體積 ×8，使用者說的「接近兩倍」）。
     v1.150 之前是「範圍＝投石機石頭的兩倍」（9.2）、石身 2 格。 */
  ok('本體與破壞範圍都放大 2 倍（v1.151.1：5 倍講的是體積）',
     met.sz === 4 && Math.abs(met.R - met.rockR * 4) < 1e-6,
     '石身 ' + met.sz + ' 格（v1.150 是 2）、範圍 ' + met.R +
     '＝投石機石頭 ' + met.rockR + ' 的四倍（v1.150 是兩倍 9.2；核彈是 30）');

  /* 威力：同一座建築、同一個落點，隕石打掉的要明顯比投石機的石頭多。
     只比常數不算驗證——要驗的是那個半徑真的有作用到積木上。 */
  const metPow = await page.evaluate(() => {
    const one = go => {
      targetCnt = 3000; shapePick = SHAPES.findIndex(s => s.n === '美國國會大廈');
      startBuild(true); completeNow();
      const n0 = placedCnt;
      go();
      return n0 - placedCnt;            // 只看爆炸當下打飛幾塊，還沒垮塌
    };
    const rock = one(() => rockHit({ x: 0, y: 6, z: 0, s: 1.7 }));
    const meteor = one(() => meteorHit({ x: 0, y: 6, z: 0 }));
    return { rock, meteor };
  });
  ok('同一個落點，隕石打掉的比石頭多',
     metPow.meteor > metPow.rock * 2.5,
     '石頭 ' + metPow.rock + ' 塊 → 隕石 ' + metPow.meteor + ' 塊');

  const metMany = await page.evaluate(() => {
    targetCnt = 3000; shapePick = SHAPES.findIndex(s => s.n === '萬里長城');
    startBuild(true); completeNow();
    for (let i = 0; i < 3; i++) callMeteor({ x: -30 + i * 30, y: 3, z: 0 });
    const three = meteors.length;
    /* 「真的砸下去了」以前是數火球，現在沒有火球了——改成包一層 meteorHit 直接數命中。
       meteorHit 是 function 宣告（掛在 global 上），覆寫它 stepMeteors 就會呼叫到包裝版。 */
    const origHit = meteorHit; let boom = 0;
    meteorHit = m => { boom++; origHit(m); };
    let g = 0, maxFly = 0;
    while (meteors && g++ < 120) {
      step(0.05);
      if (meteors) maxFly = Math.max(maxFly, meteors.filter(m => m.lit).length);
    }
    meteorHit = origHit;
    // 上限：連叫九顆只留最新的六顆
    startBuild(true); completeNow();
    for (let i = 0; i < 9; i++) callMeteor({ x: i * 4 - 16, y: 3, z: 0 });
    return { three, maxFly, boom, capped: meteors.length, cap: MET_MAX };
  });
  ok('可以同時來好幾顆', metMany.three === 3 && metMany.maxFly === 3 && metMany.boom >= 2,
     '叫了 3 顆，最多同時 ' + metMany.maxFly + ' 顆在飛，真的砸下去 ' +
     metMany.boom + ' 顆');
  ok('同時最多 ' + metMany.cap + ' 顆', metMany.capped === metMany.cap,
     '連叫 9 顆 → 場上 ' + metMany.capped + ' 顆');

  /* 半路撞到建築就當場炸開。落點給在高塔的正下方：45° 斜插進來的話，
     一定會先擦到塔身——只在終點判定的話它會從屋頂穿過去、在地面才炸。 */
  const metSweep = await page.evaluate(() => {
    targetCnt = 3000; shapePick = SHAPES.findIndex(s => s.n === '帝國大廈');
    cleanTools(); startBuild(true); completeNow();
    /* 沒有火球可以量了，改成包一層 meteorHit 記下命中那一刻的高度——比舊寫法還準
       （舊的量的是火球球心，那個還帶了 R×0.22 的抬升）。 */
    const origHit = meteorHit; let hitY = -1;
    meteorHit = m => { hitY = m.y; origHit(m); };
    callMeteor({ x: 0, y: 0.6, z: 0 });
    let g = 0;
    while (meteors && g++ < 400) step(0.02);
    meteorHit = origHit;
    return { fy: +hitY.toFixed(1), h: bp.height };
  });
  ok('半路撞到建築就當場砸開，不會穿進去',
     metSweep.fy > 5,
     '落點指在 y=0.6，實際砸在 y=' + metSweep.fy + '（塔高 ' + metSweep.h + '）');

  /* ══════════ 地面痕跡 ══════════ */
  await head('地面痕跡');

  /* 使用者指定：「爆炸地面留下焦黑、隕石留下坑洞、會漸漸消失」。
     炸彈與隕石各放一發，看地上留下什麼——兩種痕跡的差別在 crater 這個旗標
     （引擎照它挑一組同心圈的顏色：焦黑全暗，坑洞多一圈翻出來的土）。
     下面兩條的**細節字串要防空陣列**：斷言那邊有 length === 1 擋著（&& 會短路），
     但細節字串是無論過不過都會算的——marks 空的時候 [0].r 會讓**整支腳本 TypeError
     中止**，而不是那一條 FAIL。實際踩到過一次（v1.93 那輪，重跑就過），
     偶發的斷言至少要留得住後面幾百條。 */
  const mkKind = await page.evaluate(() => {
    /* 兩發要**各自量**：痕跡只活 MARK_LIFE 秒（3 秒），等隕石倒數完落地時，
       炸彈留下的那一塊早就淡掉不見了——一起量會變成「只找到一塊」。 */
    /* 藍圖要**指定**、隕石的落點要在建築**外面**（v1.128 修間歇性失敗）。
       改之前這裡吃「上一段留下的隨機藍圖」，落點又擺在 hypot(siteR×0.8, siteR×0.5)
       ＝ siteR×0.94，正好貼著工地邊緣。隕石是 45° 斜著進來的，掃到建築就當場砸開，
       而 spawnMark 有一條「爆點比自己的半徑還高就不留」（那是炸在屋頂上的一發）——
       砸在 y=11.1 而 MET_R 只有 9.2 的話，地上一塊痕跡都沒有。
       實測 20 座隨機藍圖踩到 2 座（美國國會大廈 boomY=11.1、俄式白石大教堂 13.3），
       那兩輪量到 0 塊，這一條的間歇性失敗就是這麼來的。
       45° 進場的意思是「水平還要飛多遠 ＝ 現在還有多高」，所以落點離建築邊緣
       22 單位時，飛過屋頂那一刻它還在 22 高——比這座塔（800 塊約 9 高）高得多，
       不管從哪個方位進來都掃不到。 */
    const one = fire => {
      cleanTools();
      shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
      targetCnt = 800; startBuild(true); completeNow();
      shapePick = -1;
      fire();
      return marks.map(m => ({ crater: m.crater, r: +m.r.toFixed(1) }));
    };
    const bomb = one(() => {
      placeBomb({ x: siteR * 0.8, y: 0.5, z: 0 });
      let g = 0;
      while (bombs && g++ < 200) step(0.05);          // 引信 3 秒 + 爆完
    });
    const met = one(() => {
      callMeteor({ x: 0, y: 0.5, z: siteR + 22 });
      let g = 0;
      while (meteors && g++ < 400) step(0.05);
    });
    return { bomb, met, bombR: BOMB_R, metR: MET_R,
             scorch: MARK_SCORCH_R, crat: MARK_CRATER_R };
  });
  ok('炸彈炸過的地上留一塊焦黑',
     mkKind.bomb.length === 1 && mkKind.bomb[0].crater === 0 &&
     Math.abs(mkKind.bomb[0].r - mkKind.bombR * mkKind.scorch) < 0.1,
     '一塊焦黑，半徑 ' + (mkKind.bomb[0] ? mkKind.bomb[0].r : '—') +
     '（爆炸半徑 ' + mkKind.bombR + ' × ' + mkKind.scorch + '）');
  ok('隕石留下的是坑洞，不是焦黑',
     mkKind.met.length === 1 && mkKind.met[0].crater === 1 &&
     Math.abs(mkKind.met[0].r - mkKind.metR * mkKind.crat) < 0.1,
     '一個坑洞，半徑 ' + (mkKind.met[0] ? mkKind.met[0].r : '—') +
     '（隕石半徑 ' + mkKind.metR + ' × ' + mkKind.crat + '）');

  /* 「會漸漸消失」：前面那一段維持全濃，最後 MARK_FADE 秒才淡，時間到整塊收掉、
     那顆網格也要跟著 visible=false（不然沒痕跡還在吃一個 draw call）。 */
  const mkFade = await page.evaluate(() => {
    cleanTools(); targetCnt = 400; startBuild(true); completeNow();
    spawnMark({ x: 0, y: 0.5, z: 0 }, 20, false);
    const life = MARK_LIFE, fade = MARK_FADE;
    const run = secs => { for (let i = 0; i < Math.round(secs / 0.05); i++) step(0.05); };
    run((life - fade) * 0.5);                         // 還在維持全濃的那一段
    draw();
    const a0 = marks[0].a, vis0 = ENG.three.markMesh.visible;
    run((life - fade) * 0.5 + fade * 0.6);            // 淡掉六成
    const a1 = marks[0].a;
    run(fade * 0.4 + 0.5);                            // 過完整段壽命
    draw();
    return { life, fade, a0: +a0.toFixed(2), a1: +a1.toFixed(2), vis0,
             left: marks.length, vis1: ENG.three.markMesh.visible };
  });
  ok('痕跡會漸漸淡掉，時間到自己收乾淨',
     mkFade.a0 === 1 && mkFade.a1 < 0.55 && mkFade.a1 > 0.25 && mkFade.vis0 &&
     mkFade.left === 0 && !mkFade.vis1,
     '前 ' + (mkFade.life - mkFade.fade) + ' 秒維持全濃（' + mkFade.a0 + '），' +
     '淡到剩 ' + mkFade.a1 + '，' + mkFade.life + ' 秒後場上 ' + mkFade.left +
     ' 塊、網格 visible=' + mkFade.vis1);

  /* 炸在半空中（放在屋頂上的炸彈）不留痕跡：地面沒被燒到。
     門檻是「爆點比自己的爆炸半徑還高」，所以魔法陣（火球半徑 30、陣心 12.1）照樣留。 */
  const mkAir = await page.evaluate(() => {
    cleanTools(); targetCnt = 800; startBuild(true); completeNow();
    explode({ x: 0, y: BOMB_R + 4, z: 0 }, BOMB_R, BOMB_POW);
    const air = marks.length;
    explode({ x: 0, y: 0.6, z: 0 }, BOMB_R, BOMB_POW);
    const low = marks.length;
    // 魔法陣要六秒才爆，中間那兩塊會先淡掉，所以清乾淨再單獨量它
    marks.length = 0; magics = null;
    castMagic({ x: 0, z: 0 });
    let g = 0;
    while (magics && g++ < 200) step(0.05);
    return { air, low, mag: marks.length, airY: BOMB_R + 4, bombR: BOMB_R,
             coreY: +MAG_CORE_Y.toFixed(1), magR: MAG_R };
  });
  ok('炸在半空中不留痕跡，貼著地面炸才留',
     mkAir.air === 0 && mkAir.low === 1,
     '炸在 y=' + mkAir.airY + '（半徑 ' + mkAir.bombR + '）→ ' + mkAir.air +
     ' 塊；炸在 y=0.6 → ' + mkAir.low + ' 塊');
  ok('魔法陣飄在半空還是會燒到地面',
     mkAir.mag === 1,
     '陣心 y=' + mkAir.coreY + '、火球半徑 ' + mkAir.magR + ' → 地上留了 ' +
     mkAir.mag + ' 塊');

  /* 痕跡是浮在地面上方一點的一片三角形，超出草皮的部分底下什麼都沒有，
     會變成一塊飄在天空上的黑影（改之前實測就是這樣：核彈炸在邊緣、或換到小建築
     之後草地縮小都會看到）。所以引擎要把每個頂點夾在草皮裡面。
     這條直接讀真的送進 GPU 的頂點，不是讀規則那邊的狀態。 */
  const mkEdge = await page.evaluate(() => {
    cleanTools(); targetCnt = 400; startBuild(true); completeNow();
    const half = ENG.three.ground.scale.x / 2;        // 草地島是方的，這是半邊長
    const R = 60;                                     // 痕跡半徑 33：一大半在草皮外
    const far = () => {
      draw();
      const g = ENG.three.markMesh.geometry;
      const pos = g.attributes.position.array, n = g.drawRange.count;
      const col = g.attributes.color.array;
      let d = 0, a = 0;
      for (let i = 0; i < n; i++) {
        d = Math.max(d, Math.abs(pos[i * 3]), Math.abs(pos[i * 3 + 2]));
        a = Math.max(a, col[i * 4 + 3]);
      }
      return { d, a, n, room: pos.length / 3 };
    };
    /* 邊緣那條要**先量**：下面測上限時會把它擠掉（先擠最舊的），
       量到的就變成別塊，那條就永遠是綠的（踩過一次）。 */
    spawnMark({ x: half - 2, y: 0.5, z: half - 2 }, R, false);
    const edge = far();
    for (let i = 0; i < MARK_MAX + 6; i++) spawnMark({ x: 0, y: 0.5, z: 0 }, 12, i % 2 === 0);
    const full = far();
    return { half: +half.toFixed(1), verts: edge.n, room: edge.room,
             far: +edge.d.toFixed(1), cap: MARK_MAX, kept: marks.length,
             fullVerts: full.n, ink: +full.a.toFixed(2),
             would: +(half - 2 + R * MARK_SCORCH_R * 1.26).toFixed(1) };
  });
  ok('痕跡不會畫到草皮外面（每個頂點都夾在島上）',
     mkEdge.verts > 0 && mkEdge.far <= mkEdge.half && mkEdge.far > mkEdge.half - 1,
     '草皮半邊長 ' + mkEdge.half + '，最遠的頂點 ' + mkEdge.far +
     '（沒夾的話會到 ' + mkEdge.would + '）');
  /* 滿的時候頂點要**剛好用完整個緩衝區**：規則那邊的上限（MARK_MAX）比引擎那邊大的話，
     多出來的痕跡會被默默丟掉——水那顆網格就是這樣被抓到的（MAXPOOL 4000 < WT_CELLS，
     破口在流水卻看不到水柱）。所以這裡用 === 不用 <=。 */
  ok('痕跡有上限，滿了擠掉最舊那塊（而且每一塊都畫得出來）',
     mkEdge.kept === mkEdge.cap && mkEdge.fullVerts === mkEdge.room,
     '丟 ' + (mkEdge.cap + 7) + ' 塊進去 → 留 ' + mkEdge.kept + ' 塊（上限 ' +
     mkEdge.cap + '），畫出 ' + mkEdge.fullVerts + ' 個頂點（緩衝區 ' + mkEdge.room + '）');

  /* 痕跡要維持「淡淡的」（v1.88.1 使用者指定）。這條看的是真的送進 GPU 的 alpha：
     塵霧是半透明的灰，鋪在近黑的地面上會整片看不見（灰疊黑），爆炸最好看的那一秒
     就被自己的痕跡吃掉——所以最濃的那個頂點也不該超過半透明。 */
  ok('痕跡是淡的，不會把煙塵蓋掉',
     mkEdge.ink > 0.15 && mkEdge.ink <= 0.5,
     '最濃的頂點 alpha = ' + mkEdge.ink + '（改之前是 0.96）');

  /* ══════════ 人力金額 ══════════ */
  await head('人力金額');
  const cost = await page.evaluate(() => {
    stats = freshStats();
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 900; setWorkerCount(10); startBuild(true);
    for (let i = 0; i < 200; i++) step(0.05);          // 10 秒模擬 × 10 人
    const a = { th: spentThis, all: stats.spent };
    setWorkerCount(40);
    for (let i = 0; i < 200; i++) step(0.05);          // 同樣 10 秒 × 40 人
    const b = { th: spentThis, all: stats.spent };
    completeNow();                                     // 完工後不該再燒錢
    const c = spentThis;
    for (let i = 0; i < 200; i++) step(0.05);
    return { a, b, c, d: spentThis, wage: WAGE };
  });
  ok('施工中會累積人力成本', cost.a.th > 0,
     '10 人跑 10 秒 = ' + cost.a.th.toFixed(0) + '（每人每秒 $' + cost.wage + '）');
  ok('人數越多燒得越快', (cost.b.th - cost.a.th) > cost.a.th * 3,
     '接下來 40 人跑 10 秒又燒了 ' + (cost.b.th - cost.a.th).toFixed(0));
  ok('累計支出跟著本次一起長', cost.b.all >= cost.b.th);
  ok('完工之後不再計費', Math.abs(cost.d - cost.c) < 0.001, cost.c.toFixed(0) + ' → ' + cost.d.toFixed(0));

  /* ══════════ 破壞造成的損失 ══════════ */
  await head('破壞損失');
  const loss = await page.evaluate(() => {
    stats = freshStats();
    shapePick = SHAPES.findIndex(s => s.n === '新天鵝堡');
    targetCnt = 1200; setWorkerCount(2); startBuild(true); completeNow();
    const start = stats.wrecked;
    // 一槌下去：打飛幾塊就該記幾塊的損失
    const cand = blocks.filter(b => b.st === 3 && b.y > 4);
    const t = cand[Math.floor(cand.length * 0.5)];
    const n = smash(new THREE.Vector3(t.x, t.y, t.z), new THREE.Vector3(0.2, -0.95, 0.1).normalize());
    const afterHitLoss = stats.wrecked - start;
    /* 垮下來的也要算。把貼地那一層整層清掉，上面就整棟連不到地面——
       只挖幾十塊零星的洞是不會垮的（26 鄰居連通，牆夠厚就繞得過去）。 */
    for (let i = 0; i < 30; i++) step(0.05);
    const beforeFall = stats.wrecked, standing = placedCnt;
    const low = blocks.filter(b => b.st === 3 && b.y < 1.5);
    const broke = low.length;
    for (const b of low) breakBlock(b, 0, 0.5, 0);
    markSupportDirty(0);       // 直接呼叫 breakBlock 不會排重算，垮塌判定要自己叫
    for (let i = 0; i < 120; i++) step(0.05);
    const fellLoss = stats.wrecked - beforeFall, fell = standing - placedCnt;
    // 拆到門檻換下一座時，剩下沒打到的整棟報廢也要計進去
    let g = 0;
    while (phase === 'wreck' && g++ < 300) {
      const c2 = blocks.filter(b => b.st === 3);
      if (c2.length) {
        const x = c2[Math.floor(Math.random() * c2.length)];
        smash(new THREE.Vector3(x.x, x.y, x.z), new THREE.Vector3(0.2, -0.95, 0.1).normalize());
      }
      for (let k = 0; k < 8; k++) step(0.05);
    }
    const total = stats.wrecked;
    // 換建築（不是破壞）不該產生損失
    const beforeSwap = stats.wrecked;
    startBuild(true); completeNow();
    hudLast = 0; hudTick(performance.now());        // running=false 時 HUD 不會自己更新
    return { afterHitLoss, hit: n, fellLoss, fell, broke, total, cost: WRECK_COST,
             swapLoss: stats.wrecked - beforeSwap, lossThis,
             dom: document.getElementById('lossAll').textContent };
  });
  ok('打飛積木會記成損失', loss.hit > 0 && loss.afterHitLoss === loss.hit * loss.cost,
     '一槌打飛 ' + loss.hit + ' 塊 = ' + loss.afterHitLoss + '（每塊 $' + loss.cost + '）');
  ok('失去支撐自己垮下來的也算損失',
     loss.fell > loss.broke * 2 && loss.fellLoss === loss.fell * loss.cost,
     '打掉貼地那層 ' + loss.broke + ' 塊，連帶垮掉共 ' + loss.fell + ' 塊 = ' + loss.fellLoss);
  ok('拆完一座的損失是整棟的量級', loss.total > 1200 * loss.cost * 0.9,
     '這座 1200 塊，累計損失 ' + loss.total + '（滿棟約 ' + (1200 * loss.cost) + '）');
  ok('單純換建築不算損失', loss.swapLoss === 0, '換一座之後多了 ' + loss.swapLoss);
  ok('換建築後本次損失歸零', loss.lossThis === 0, 'lossThis=' + loss.lossThis);
  ok('右上角有顯示累計損失', /^\$[\d,]+$/.test(loss.dom) && loss.dom !== '$0', loss.dom);

  const lossBadge = await page.evaluate(() => {
    stats = freshStats(); stats.wrecked = 99999; checkBadges();
    const notYet = stats.badges.indexOf('loss100k') >= 0;
    stats.wrecked = 1e5; checkBadges();
    const got = stats.badges.indexOf('loss100k') >= 0;
    stats.wrecked = 2e6; checkBadges();
    const big = stats.badges.indexOf('loss2m') >= 0;
    renderBadges();
    return { notYet, got, big, dom: document.getElementById('badgeLoss').textContent };
  });
  ok('$100,000 損失解鎖【災情慘重】', !lossBadge.notYet && lossBadge.got,
     '$99,999 → ' + lossBadge.notYet + '、$100,000 → ' + lossBadge.got);
  ok('$2,000,000 損失解鎖【保險公司拒保】', lossBadge.big);
  ok('成就面板寫出累計損失', lossBadge.dom === '$2,000,000', lossBadge.dom);

  /* ══════════ 成就 ══════════ */
  await head('成就');
  const badge = await page.evaluate(() => {
    stats = freshStats(); renderBadges();
    const n0 = stats.badges.length;
    stats.bestHit = 51; checkBadges();
    const afterDemo = stats.badges.indexOf('demo50') >= 0;
    stats.poked = 20; checkBadges();
    const afterPoke = stats.badges.indexOf('boss20') >= 0;
    stats.poked = 25; const before = stats.badges.length; checkBadges();
    const noDup = stats.badges.length === before;
    return { n0, afterDemo, afterPoke, noDup, total: BADGES.length,
             dom: document.querySelectorAll('.badge.got').length,
             label: document.getElementById('badgeN').textContent };
  });
  ok('一開始沒有任何成就', badge.n0 === 0);
  ok('一次擊飛 >50 塊解鎖【拆遷大隊】', badge.afterDemo);
  ok('戳倒 20 次解鎖【工頭嚴厲】', badge.afterPoke);
  ok('同一個成就不會重複解鎖', badge.noDup);
  ok('成就面板會反映解鎖狀態', badge.dom === 2 && /2 \/ \d+/.test(badge.label), badge.label);

  const miracle = await page.evaluate(() => {
    stats = freshStats();
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    startBuild(true); buildElapsed = 100; completeNow(); buildElapsed = 100;
    noteBuilt();
    const fast = stats.badges.indexOf('miracle') >= 0;
    stats = freshStats(); buildElapsed = 400; noteBuilt();
    const slow = stats.badges.indexOf('miracle') >= 0;
    return { fast, slow, name: bp.name };
  });
  ok('3 分鐘內蓋完金字塔才給【奇蹟工程】', miracle.fast && !miracle.slow,
     '100 秒 → ' + miracle.fast + '，400 秒 → ' + miracle.slow);

  /* 每個成就都要真的能拿到：湊出剛好達標的紀錄，一個一個確認 */
  const reach = await page.evaluate(() => {
    const cases = {
      first: s => s.built = ['A'],
      demo50: s => s.bestHit = 51,
      boss20: s => s.poked = 20,
      miracle: s => s.miracle = true,
      wreck5: s => s.destroyed = 5,
      move10k: s => s.carried = 10000,
      world10: s => s.built = Array.from({ length: 10 }, (_, i) => 'B' + i),
      million: s => s.spent = 1e6,
      loss100k: s => s.wrecked = 1e5,
      loss2m: s => s.wrecked = 2e6,
      hit200: s => s.bestHit = 201,
      allTools: s => s.tools = TOOLS.map(t => t.id),
      bigBuild: s => s.bigBuild = 2500,
      poke100: s => s.poked = 100,
      wreck25: s => s.destroyed = 25,
      smash50k: s => s.smashed = 50000,
      move100k: s => s.carried = 100000,
      spend10m: s => s.spent = 1e7,
      worldAll: s => s.built = SHAPES.map(x => x.n)
    };
    const missing = BADGES.filter(b => !cases[b.id]).map(b => b.id);
    const fail = [];
    for (const id in cases) {
      stats = freshStats();
      cases[id](stats);
      checkBadges();
      if (stats.badges.indexOf(id) < 0) fail.push(id);
    }
    // 全部條件一起滿足時，一個都不能漏
    stats = freshStats();
    for (const id in cases) cases[id](stats);
    checkBadges();
    return { missing, fail, all: stats.badges.length, total: BADGES.length };
  });
  ok('每個成就都有對應的測試案例', reach.missing.length === 0,
     reach.missing.length ? '沒測到：' + reach.missing.join(',') : reach.total + ' 個全部有測');
  ok('每個成就都拿得到', reach.fail.length === 0,
     reach.fail.length ? '拿不到：' + reach.fail.join(',') : reach.total + ' 個都驗過');
  ok('條件全滿時全部解鎖', reach.all === reach.total, reach.all + ' / ' + reach.total);

  /* 用過的道具要記起來——【工具箱清空】靠它 */
  const toolRec = await page.evaluate(() => {
    stats = freshStats();
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 600; setWorkerCount(4); startBuild(true); completeNow();
    const target = blocks.find(b => b.st === 3 && b.y > 3);
    const hit = { kind: 'block', point: new THREE.Vector3(target.x, target.y, target.z),
                  dir: new THREE.Vector3(0.2, -0.95, 0.1).normalize() };
    for (const t of TOOLS) { tool = t.id; useTool(hit); for (let i = 0; i < 10; i++) step(0.05); }
    ballAim = null;                 // 保齡球那一輪只點了第一下，別把瞄準環留給後面的截圖
    // 王之財寶那一發會開著十三秒，留著會把後面幾條的鏡頭高度與畫面都佔走
    gates = null; weapons = null; gateEnd();
    swords = null;                  // 大劍同理：一趟快兩秒，別讓它跨到後面幾條與截圖
    /* 幽浮（v1.167）：一趟十六秒（含飛走後那五秒），而且它會借鏡頭的高度。
       ufoClear() 才會把借去的高度還回去、把艙裡的積木放掉（見 game-tools）。 */
    ufoClear();
    const got = stats.badges.indexOf('allTools') >= 0;
    // 同一種道具用兩次不會重複記
    tool = 'hammer'; useTool(hit);
    const n = stats.tools.length;
    return { list: stats.tools.slice(), n, got, total: TOOLS.length };
  });
  ok('用過哪些道具會記起來', toolRec.n === toolRec.total,
     toolRec.n + ' / ' + toolRec.total + '：' + toolRec.list.join(','));
  ok('全部道具都用過解鎖【工具箱清空】', toolRec.got);

  /* 存檔被改過時，不認得的道具 id 不該混進來 */
  const toolClean = await page.evaluate(() => {
    stats = freshStats();
    // laser／railgun 是永遠不會存在的 id——拿真道具的名字當假資料會測不出東西
    stats.tools = ['hammer', 'laser', 'ball', 'railgun', 'tornado', 'treb', 'bighammer', 'finger'];
    save(); stats = freshStats(); load();
    return { list: stats.tools.slice(), got: stats.badges.indexOf('allTools') >= 0 };
  });
  ok('存檔裡不認得的道具會被丟掉', toolClean.list.length === 6 &&
     toolClean.list.indexOf('laser') < 0 && toolClean.list.indexOf('railgun') < 0,
     toolClean.list.join(','));

  // 擺一組像玩過一陣子的紀錄再開面板，截圖才看得出版面
  await page.evaluate(() => {
    stats = freshStats();
    stats.destroyed = 7; stats.smashed = 8420; stats.wrecked = 742500;
    stats.spent = 168000; stats.poked = 23; stats.bestHit = 74; stats.carried = 6100;
    stats.built = ['吉薩金字塔', '新天鵝堡', '比薩斜塔', '羅馬競技場'];
    checkBadges(); hudLast = 0; hudTick(performance.now());
  });
  await page.click('#badgeBtn');
  ok('成就面板打得開', await page.evaluate(() => document.getElementById('badgeWrap').classList.contains('on')));
  await page.screenshot({ path: path.join(OUT, '05-成就.png') });
  await page.click('#badgeClose');
  ok('成就面板關得掉', !(await page.evaluate(() => document.getElementById('badgeWrap').classList.contains('on'))));

  /* ══════════ 存檔 ══════════ */
  await head('自動存檔');
  const saveR = await page.evaluate(() => {
    localStorage.removeItem('block-builders/save1');
    stats = freshStats();
    stats.destroyed = 4; stats.smashed = 1234; stats.poked = 9; stats.spent = 55555;
    stats.built = ['吉薩金字塔', '羅馬競技場']; stats.badges = ['demo50'];
    save();
    const raw = localStorage.getItem('block-builders/save1');
    return { raw, plain: /destroyed|smashed|吉薩/.test(raw), len: raw.length };
  });
  ok('存檔真的寫進 localStorage', !!saveR.raw && saveR.len > 40, saveR.len + ' 字元');
  ok('存檔不是明文', !saveR.plain, '看不到欄位名或建築名');

  const reloadR = await page.evaluate(() => {
    stats = freshStats(); load();
    return { destroyed: stats.destroyed, smashed: stats.smashed, built: stats.built.length, badges: stats.badges.length };
  });
  ok('讀得回來', reloadR.destroyed === 4 && reloadR.smashed === 1234 &&
     reloadR.built === 2 && reloadR.badges === 1,
     JSON.stringify(reloadR));

  const tamperR = await page.evaluate(() => {
    const raw = localStorage.getItem('block-builders/save1');
    localStorage.setItem('block-builders/save1', raw.slice(0, -6) + 'AAAAAA');
    stats = freshStats(); load();
    const bad = stats.destroyed;
    localStorage.setItem('block-builders/save1', raw);
    stats = freshStats(); load();
    return { bad, good: stats.destroyed };
  });
  ok('存檔被改過就整份不採用', tamperR.bad === 0 && tamperR.good === 4,
     '竄改後 destroyed=' + tamperR.bad + '，還原後 ' + tamperR.good);

  /* 真的重新載入頁面，確認紀錄還在——這是「自動儲存」的重點 */
  await page.reload();
  await page.waitForTimeout(900);
  const persist = await page.evaluate(() => ({ d: stats.destroyed, s: stats.smashed, b: stats.badges.length }));
  ok('關掉重開紀錄還在', persist.d === 4 && persist.s === 1234 && persist.b === 1,
     'destroyed=' + persist.d + '、smashed=' + persist.s + '、成就 ' + persist.b + ' 個');
  /* 重點是「畫面跟著讀回來的紀錄重畫」，不是哪幾把該開——該開幾把是等差算出來的
     （擊飛 1234 塊 ÷ 步幅 2,000 ＝ 0 把），寫死一長串的話每加一把道具就要改。 */
  const afterReload = await page.evaluate(() => ({
    dom: [...document.querySelectorAll('.tool')].map(e => e.className.indexOf('lock') >= 0 ? 'lock' : 'open').join(','),
    want: TOOLS.map(t => toolOk(t) ? 'open' : 'lock').join(','),
    open: TOOLS.filter(t => toolOk(t)).length,
    free: TOOLS.filter(t => !t.lock).length,
    reach: Math.floor(stats.smashed / LOCK_STEP)
  }));
  ok('重開後解鎖狀態跟著回來（畫面照讀回來的紀錄重畫）',
     afterReload.dom === afterReload.want &&
     afterReload.open === afterReload.free + afterReload.reach,
     '擊飛 1234 塊 → 免解鎖 ' + afterReload.free + ' 把＋推到第 ' + afterReload.reach +
     ' 格＝開著 ' + afterReload.open + ' 把：' + afterReload.dom);

  /* 設定也要一起存——不然每次打開都要重調建材數與小人數。
     一律用「點按鈕」而不是直接改變數：要測的就是面板真的接上去了。 */
  const prefSaved = await page.evaluate(() => {
    const hit = (id, v) => [...document.getElementById(id).children]
      .find(b => +b.dataset.v === v).click();
    hit('cnt', 1800); hit('wk', 40); hit('spd', 0.5);
    document.getElementById('mute').checked = true;
    document.getElementById('mute').dispatchEvent(new Event('change', { bubbles: true }));
    return { pref: JSON.parse(JSON.stringify(pref)) };
  });
  ok('改設定會寫進 pref', prefSaved.pref.cnt === 1800 && prefSaved.pref.wk === 40 &&
     prefSaved.pref.spd === 0.5 && prefSaved.pref.mute === true, JSON.stringify(prefSaved.pref));

  await page.reload();
  await page.waitForTimeout(900);
  const prefBack = await page.evaluate(() => {
    const on = id => [...document.getElementById(id).children]
      .filter(b => b.classList.contains('on')).map(b => +b.dataset.v);
    return {
      cnt: targetCnt, wk: workers.length, spd: timeScale, mute: muted,
      onCnt: on('cnt'), onWk: on('wk'), onSpd: on('spd'),
      domMute: document.getElementById('mute').checked
    };
  });
  ok('重開後設定自動套用（不用每次重調）',
     prefBack.cnt === 1800 && prefBack.wk === 40 && Math.abs(prefBack.spd - 0.5) < 0.01 && prefBack.mute === true,
     '建材 ' + prefBack.cnt + '、小人 ' + prefBack.wk + '、速度 ' + prefBack.spd + '、靜音 ' + prefBack.mute);
  ok('面板上亮的那一顆也跟著回到存的值',
     String(prefBack.onCnt) === '1800' && String(prefBack.onWk) === '40' &&
     String(prefBack.onSpd) === '0.5' && prefBack.domMute,
     '亮的是 ' + prefBack.onCnt + '/' + prefBack.onWk + '/' + prefBack.onSpd);

  /* 面板只剩三檔，中間值選不出來了：存檔裡不是那三檔的值一律吸到最近的一檔
     （壞掉的存檔也一樣，不然畫面上會三顆都不亮、跑的卻是第四個數字）。 */
  const prefClamp = await page.evaluate(() => {
    pref.cnt = 99999; pref.wk = -5; pref.spd = 900; save();
    stats = freshStats(); pref = freshPref(); load();
    const a = JSON.parse(JSON.stringify(pref));
    pref.cnt = 2600; pref.wk = 33; pref.spd = 2.4; save();       // 剛好落在兩檔中間附近
    stats = freshStats(); pref = freshPref(); load();
    return { a, b: JSON.parse(JSON.stringify(pref)) };
  });
  ok('存檔裡的設定會吸到最近的一檔',
     prefClamp.a.cnt === 9000 && prefClamp.a.wk === 20 && prefClamp.a.spd === 4 &&
     prefClamp.b.cnt === 3000 && prefClamp.b.wk === 40 && prefClamp.b.spd === 1,
     '99999/-5/900 → ' + prefClamp.a.cnt + '/' + prefClamp.a.wk + '/' + prefClamp.a.spd +
     '；2600/33/2.4 → ' + prefClamp.b.cnt + '/' + prefClamp.b.wk + '/' + prefClamp.b.spd);

  /* 預設建材從 900 改成 3000 那次：舊存檔裡的 900 分不出是玩家挑的還是舊預設，
     所以認「沒有 v 欄位」的存檔，一次性換成新預設。存過一次之後就不再動它。 */
  const prefMigrate = await page.evaluate(() => {
    localStorage.setItem('block-builders/save1',
      packSave({ s: freshStats(), p: { cnt: 900, wk: 20, spd: 1, mute: false, spin: false } }));
    stats = freshStats(); pref = freshPref(); load();
    const migrated = pref.cnt;
    pref.cnt = 900; save();                     // 這次是「存過一次之後」的 900
    stats = freshStats(); pref = freshPref(); load();
    return { migrated, keep: pref.cnt, v: pref.v };
  });
  /* 沒有 v 欄位的舊存檔換成新預設 3000；存過一次之後就不再套那條規則——
     所以第二次那個 900 走的是吸附（→ 1800），而不是又被換成預設值。 */
  ok('舊存檔的建材數換成新預設，而且只換一次',
     prefMigrate.migrated === 3000 && prefMigrate.keep === 1800 && prefMigrate.v === 1,
     '舊存檔 900 → ' + prefMigrate.migrated + '；存過一次之後的 900 → ' + prefMigrate.keep +
     '（吸到最近的一檔，不是預設值 3000；存檔版本 v' + prefMigrate.v + '）');

  const cleared = await page.evaluate(() => {
    resetSave();
    return { d: stats.destroyed, raw: localStorage.getItem('block-builders/save1') };
  });
  ok('可以清空紀錄', cleared.d === 0 && !cleared.raw);
  errors.length = 0;

  /* ══════════ 控制項 ══════════ */
  await head('控制項');
  await page.evaluate(() => { running = false; muted = true; });
  await page.evaluate(() => { running = true; });
  await page.selectOption('#shape', String(await page.evaluate(() => SHAPES.findIndex(s => s.n === '倫敦眼摩天輪'))));
  await page.waitForTimeout(400);
  ok('藍圖下拉可以指定建築', (await st(page)).name === '倫敦眼摩天輪', (await st(page)).name);

  /* 三檔按鈕：點下去要真的生效。用真的 click，才連 listener 有沒有接上都一起測到。 */
  const hitSeg = (id, v) => page.evaluate(([id, v]) =>
    [...document.getElementById(id).children].find(b => +b.dataset.v === v).click(), [id, v]);
  /* 先把料池灌到比藍圖多，下面那一條才量得到「池子跟著藍圖走」：v1.141 起料池是
     **多的收掉、少了不補**（缺料的人自己挖），池子本來就比藍圖小的時候，點下去它是
     不會變的。不灌的話量到的是上一段留下來的池子——上一座是**隨機**藍圖，1800 建材下
     各座 1750～1800 格不等，比倫敦眼摩天輪的 1781 少的時候這一條就假失敗
     （實測進這一段時池子 1772／雙子星塔，於是 1772 vs 1781）。 */
  const poolBig = await page.evaluate(() => {
    /* 灌到比藍圖多 300 塊，點下去才有東西可以收。位置鋪在工地外圍那一圈（跟開場一樣），
       全疊在原點的話下一幀會被 separate 炸開。
       （這裡不用 installClean 裝的 scatterFree：前面幾段重載過頁面，那支已經沒了。） */
    const want = bp.slots.length + 300;
    while (blocks.length < want) {
      const b = newBlock();
      const a = Math.random() * Math.PI * 2;
      const rad = siteR + 3 + Math.random() * (arenaR - siteR - 3);
      b.x = Math.cos(a) * rad; b.z = Math.sin(a) * rad; b.y = HB;
      blocks.push(b); separate(b); gridAdd(b);
    }
    ENG.setBlockCount(blocks.length);
    return blocks.length;
  });
  await hitSeg('cnt', 1800);
  await page.waitForTimeout(500);
  const cntS = await st(page);
  ok('建材按鈕會改變積木數', cntS.target === 1800 && cntS.total > 1200,
     '目標 ' + cntS.target + '，實得 ' + cntS.total + ' 塊');
  ok('積木池跟著藍圖走（多的會被收掉）', Math.abs(cntS.pool - cntS.total) <= 2,
     '先灌到 ' + poolBig + ' 塊，點下去之後池 ' + cntS.pool + '、藍圖 ' + cntS.total + ' 格');

  await hitSeg('wk', 60);
  ok('小人按鈕會改變人數', (await st(page)).workers === 60, (await st(page)).workers + ' 人');

  await hitSeg('spd', 4);
  ok('速度按鈕會改變時間倍率', Math.abs((await st(page)).scale - 4) < 0.01);
  // 點過之後亮的那一顆要換過去（面板上沒有別的地方寫著現在是哪一檔）
  const segAfter = await page.evaluate(() => {
    const on = id => [...document.getElementById(id).children]
      .filter(b => b.classList.contains('on')).map(b => +b.dataset.v);
    return { cnt: on('cnt'), wk: on('wk'), spd: on('spd') };
  });
  ok('點過的那一顆會亮起來，而且只有一顆',
     String(segAfter.cnt) === '1800' && String(segAfter.wk) === '60' && String(segAfter.spd) === '4',
     '亮的是 ' + segAfter.cnt + '/' + segAfter.wk + '/' + segAfter.spd);
  await hitSeg('wk', 20);            // 後面的測試照 20 人算，改回來
  await hitSeg('spd', 1);

  /* timeScale 是在 frame() 裡乘進 dt 的，直接呼叫 step(0.05) 會繞過倍率，
     所以一定要走真正的 rAF 迴圈。但「同樣秒數蓋幾塊」在軟體算圖下幀率太低會測不準，
     改成攔截 step 累加 dt，直接量「模擬時間推進了多少」——這跟幀率無關。
     step 是 function 宣告（掛在 global 上），覆寫它 frame() 就會呼叫到包裝過的版本。 */
  const measureSpeed = async sc => {
    await page.evaluate(sc => {
      running = false;
      if (!window.__origStep) window.__origStep = step;
      window.__simT = 0; window.__frames = 0;
      step = dt => { window.__simT += dt; window.__frames++; window.__origStep(dt); };
      shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
      targetCnt = 900; setWorkerCount(24); timeScale = sc;
      startBuild(true); running = true;
    }, sc);
    await page.waitForTimeout(1800);
    return page.evaluate(() => {
      running = false;
      return { simT: window.__simT, frames: window.__frames, placed: placedCnt };
    });
  };
  const sp1 = await measureSpeed(1), sp3 = await measureSpeed(3);
  await page.evaluate(() => { if (window.__origStep) step = window.__origStep; });
  /* 量「每幀推進多少模擬時間」的比值，而不是「同樣秒數推進多少」。
     dt = min(0.05, 實際幀長) × 倍率，上限是套在幀長上、再乘倍率，
     所以每幀的比值理論上剛好是 3，跟當下幀率無關；
     直接比總量的話兩次量測期間的幀率抖動會讓結果在 2.3～3.2 之間亂跑。 */
  const per1 = sp1.frames ? sp1.simT / sp1.frames : 0;
  const per3 = sp3.frames ? sp3.simT / sp3.frames : 0;
  const ratio = per1 > 0 ? per3 / per1 : 0;
  ok('速度倍率真的讓模擬跑得更快', ratio > 2.7 && ratio < 3.3,
     '每幀推進：1× ' + (per1 * 1000).toFixed(1) + 'ms、3× ' + (per3 * 1000).toFixed(1) +
     'ms（' + ratio.toFixed(2) + ' 倍；' + sp1.frames + ' / ' + sp3.frames + ' 幀）');

  await page.evaluate(() => { running = true; });
  await page.click('#again');
  await page.waitForTimeout(400);
  ok('「換一座來蓋」會換建築', (await st(page)).placed < 30, '重新開工');

  /* ── 立刻建成 ──
     跳過施工過程用的。重點是它不能變成刷錢成就的捷徑：
     人力費是 step() 裡隨施工時間累積的，這顆按鈕一毛都不加。 */
  const instant = await page.evaluate(() => {
    running = false; stats = freshStats();
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 1200; setWorkerCount(12); startBuild(true);
    for (let i = 0; i < 100; i++) step(0.05);        // 先讓小人蓋一陣、也先燒一點錢
    hudLast = 0; hudTick(performance.now());
    const mid = { phase, placed: placedCnt, spent: stats.spent, spentThis,
                  dis: document.getElementById('finish').disabled };
    document.getElementById('finish').click();
    const after = { phase, placed: placedCnt, total: bp.slots.length, spent: stats.spent,
                    spentThis, elapsed: buildElapsed, built: stats.built.slice(),
                    miracle: !!stats.miracle, badges: stats.badges.slice(),
                    carry: blocks.filter(b => b.st === 1).length };
    hudLast = 0; hudTick(performance.now());
    const disAfter = document.getElementById('finish').disabled;
    for (let i = 0; i < 100; i++) step(0.05);        // 完工了就不該再燒錢
    return { mid, after, disAfter, spentLater: stats.spent };
  });
  ok('施工中「立刻建成」可以按', instant.mid.phase === 'build' && !instant.mid.dis,
     'phase=' + instant.mid.phase + '、disabled=' + instant.mid.dis);
  ok('一按就整座蓋好',
     instant.after.placed === instant.after.total && instant.after.phase === 'done' &&
     instant.after.carry === 0,
     instant.mid.placed + ' → ' + instant.after.placed + '/' + instant.after.total +
     '，phase=' + instant.after.phase);
  ok('立刻建成不加人力費（按不出花錢成就）',
     instant.after.spent === instant.mid.spent && instant.spentLater === instant.mid.spent,
     '按之前累計 $' + instant.mid.spent.toFixed(0) + '，按完 $' + instant.after.spent.toFixed(0) +
     '，再跑 5 秒還是 $' + instant.spentLater.toFixed(0));
  ok('已經花掉的工錢不會被抹掉', instant.after.spentThis === instant.mid.spentThis,
     '本次人力 $' + instant.after.spentThis.toFixed(0) + '（歸零的話會跟累計對不上）');
  ok('立刻建成拿不到【奇蹟工程】（那是比速度的）',
     !instant.after.miracle && instant.after.badges.indexOf('miracle') < 0 &&
     instant.after.elapsed === 0,
     'buildElapsed=' + instant.after.elapsed + '、miracle=' + instant.after.miracle);
  ok('蓋過哪些地標照記', instant.after.built.indexOf('吉薩金字塔') >= 0 &&
     instant.after.badges.indexOf('first') >= 0,
     '記到 ' + instant.after.built.join('、') + '，成就 ' + instant.after.badges.join(','));
  ok('完工後按鈕會灰掉', instant.disAfter);

  /* 整地中也算「還沒蓋」，按了就直接長出來、推土機收工 */
  const instantClear = await page.evaluate(() => {
    running = false; targetCnt = 1200; startBuild(true); completeNow();
    let g = 0;
    while (phase !== 'clear' && g++ < 200) {        // 砸到門檻它會自己換下一座 → 進整地
      const cand = blocks.filter(b => b.st === 3);
      if (cand.length) {
        const t = cand[Math.floor(Math.random() * cand.length)];
        smash(new THREE.Vector3(t.x, t.y, t.z), new THREE.Vector3(0.2, -0.95, 0.1).normalize());
      }
      for (let k = 0; k < 8; k++) step(0.05);
    }
    hudLast = 0; hudTick(performance.now());
    const before = { phase, dis: document.getElementById('finish').disabled, doz: !!dozers };
    document.getElementById('finish').click();
    return { before, phase, placed: placedCnt, total: bp.slots.length, doz: !!dozers };
  });
  ok('整地中按也算（推土機直接收工）',
     instantClear.before.phase === 'clear' && !instantClear.before.dis && instantClear.before.doz &&
     instantClear.phase === 'done' && instantClear.placed === instantClear.total && !instantClear.doz,
     'clear（推土機 ' + instantClear.before.doz + '）→ ' + instantClear.phase + ' ' +
     instantClear.placed + '/' + instantClear.total);
  /* 上面兩段把 rAF 迴圈關掉、也把建築蓋完了。後面的自轉與施工計時要靠真的迴圈跑、
     而且計時只在 phase='build' 時前進，所以這裡把場面還原成「正在施工」。 */
  await page.evaluate(() => {
    stats = freshStats(); shapePick = -1; targetCnt = 1200;
    startBuild(true); running = true;
  });
  await page.waitForTimeout(300);

  const yaw0 = await page.evaluate(() => ENG.cam.yaw);
  await page.check('#spin');
  await page.waitForTimeout(900);
  const yaw1 = await page.evaluate(() => ENG.cam.yaw);
  ok('自轉開關有作用', Math.abs(yaw1 - yaw0) > 0.03,
     '0.9 秒轉了 ' + ((yaw1 - yaw0) * 57.3).toFixed(1) + '°');
  await page.uncheck('#spin');

  const hud = await page.evaluate(() => ({
    clock: document.getElementById('clock').textContent,
    timer: document.getElementById('timer').textContent,
    prog: document.getElementById('prog').textContent,
    bar: document.getElementById('bar').style.width,
    name: document.getElementById('bname').textContent
  }));
  ok('HUD 顯示真實時鐘', /^\d{2}:\d{2}:\d{2}$/.test(hud.clock), hud.clock);
  ok('HUD 顯示施工計時', /^\d+:\d{2}$/.test(hud.timer), hud.timer);
  ok('HUD 顯示進度與建築名稱', /\d+ \/ \d+/.test(hud.prog) && hud.name.length > 0,
     hud.name + ' ' + hud.prog);
  ok('進度條有寬度', parseFloat(hud.bar) >= 0, hud.bar);

  const timerRun = await page.evaluate(() => new Promise(res => {
    const a = document.getElementById('timer').textContent;
    setTimeout(() => res({ a, b: document.getElementById('timer').textContent }), 1300);
  }));
  ok('施工計時會往前走', timerRun.a !== timerRun.b, timerRun.a + ' → ' + timerRun.b);

  /* ══════════ 音效 ══════════
     音效全是即時合成的（沒有音檔），所以可以用 OfflineAudioContext 把波形算出來直接量，
     不必真的發出聲音。tone()／noise() 都是先叫 audio() 拿 context，
     把 audio 換掉就能把整段導到離線 context；量完要把 audio 與 muted 放回去。 */
  await head('音效');
  const snd = await page.evaluate(async () => {
    const SR = 44100, SEC = 3, realAudio = audio, wasMuted = muted, wasRunning = running;
    /* 量的時候一定要把遊戲停下來：算圖是非同步的，中間遊戲迴圈只要放了任何一聲
       （擺積木、碎料落地…）就會一起錄進這個離線 context。
       第一版沒停，核彈的高頻占比量到 51.7%，其實是混進了槌子那種高頻音。 */
    running = false;
    /* sec：算幾秒。預設 SEC（3 秒）夠長，只有雷聲不夠——它的滾雷排了 5 秒（v1.131），
       用 3 秒的視窗量會把拖尾整段切掉。不改 SEC 是因為 rms 是「整段的平均」，
       視窗一長所有音效的絕對值都會跟著縮，上面那些門檻全部要重訂。 */
    const render = async (fn, band, sec) => {
      const ctx = new OfflineAudioContext(1, SR * (sec || SEC), SR);
      let dest = ctx.destination;
      const mk = (type, f) => {
        const q = ctx.createBiquadFilter(); q.type = type; q.frequency.value = f; q.Q.value = 0.7; return q;
      };
      if (band === 'hi') { const f = mk('highpass', 2000); f.connect(dest); dest = f; }
      if (band === 'body') {                       // 80–250Hz：小喇叭真正推得出來的那一段
        const lo = mk('highpass', 80), hi = mk('lowpass', 250);
        hi.connect(dest); lo.connect(hi); dest = lo;
      }
      // 250–800Hz：「東西撞到建築」的碎裂感在這一段（v1.131 量雷聲用）
      if (band === 'mid') {
        const lo = mk('highpass', 250), hi = mk('lowpass', 800);
        hi.connect(dest); lo.connect(hi); dest = lo;
      }
      const proxy = new Proxy(ctx, {
        get(t, k) {
          if (k === 'destination') return dest;
          const v = t[k]; return typeof v === 'function' ? v.bind(t) : v;
        }
      });
      audio = () => proxy; muted = false;
      fn();
      /* fn() 一跑完就把 audio 換回真的（v1.128）。排程是同步做完的，但 startRendering()
         是非同步的——中間任何一支**用 setTimeout 排的**音效（sndDone 與 sndBadge 各排
         三聲）都會再呼叫一次 audio()，那時候還指著這顆離線 context 的話就會被錄進來。
         `running = false` 擋得住遊戲迴圈，擋不住已經排在 setTimeout 裡的那幾聲。
         實測踩過：對照組那一聲量到「前 2 毫秒只占 56%」而不是 100%，
         而 56% 正好是 0.045（對照組音量）÷ 0.08（sndBadge 音量）——成就音混進來了。 */
      audio = realAudio;
      const d = (await ctx.startRendering()).getChannelData(0);
      let s = 0, peak = 0, over = 0;
      for (let i = 0; i < d.length; i++) {
        const v = Math.abs(d[i]); if (v > peak) peak = v; if (v >= 0.999) over++;
        s += d[i] * d[i];
      }
      /* 20 毫秒一格的包絡。有些音要驗的是「音量怎麼走」而不是總量——
         風聲那條就是：舊版一開聲最大、之後一路弱下去（爆炸的包絡），
         新版要先吹起來再撐著。單看 rms 兩者可以一樣大。 */
      const W = Math.floor(SR * 0.02), env = [];
      for (let i = 0; i + W <= d.length; i += W) {
        let q = 0;
        for (let j = 0; j < W; j++) q += d[i + j] * d[i + j];
        env.push(Math.sqrt(q / W));
      }
      return { rms: Math.sqrt(s / d.length), peak, over, env };
    };
    const one = async (fn, sec) => {
      const all = await render(fn, '', sec), hi = await render(fn, 'hi', sec);
      const body = await render(fn, 'body', sec), mid = await render(fn, 'mid', sec);
      // 某一段時間內的平均音量（秒）
      const win = (a, b) => {
        const q = all.env.slice(Math.round(a / 0.02), Math.round(b / 0.02));
        return q.reduce((x, y) => x + y, 0) / q.length;
      };
      // 響到第幾秒：掉到起頭 0.3 秒的 5% 以下就算沒聲了
      const head = win(0, 0.3);
      let last = 0;
      all.env.forEach((v, i) => { if (v > head * 0.05) last = (i + 1) * 0.02; });
      return { rms: +all.rms.toFixed(4), peak: +all.peak.toFixed(3), over: all.over,
               hiPct: +(hi.rms / all.rms * 100).toFixed(1), body: +body.rms.toFixed(4),
               midPct: +(mid.rms / all.rms * 100).toFixed(1),
               hold: +(win(0.55, 0.75) / win(0.02, 0.2)).toFixed(2),
               tail: +(win(1.2, 1.8) / head).toFixed(2),
               tail3: +(win(2.6, 3.4) / head).toFixed(3),
               last: +last.toFixed(2) };
    };
    /* 同一發量好幾次取中位數。**噪音類的音效每次算出來都不一樣**——buffer 是當場用
       Math.random() 填的，量到的頻段占比就跟著抖。雷聲那一條（現在 vs v1.130）就被這件事
       咬過：門檻是「兩者相差 8 個百分點以上」，而同一份程式碼連量十次，單次量到的差距是
       7.6～18.3——也就是說它**本來就會間歇失敗**，跟改了什麼無關。
       取五次的中位數之後（連量六輪）：現在這一版 40.1～41.6、v1.130 那一版 51.0～55.7、
       差距 10.2～15.4，離門檻 8 有兩個百分點以上的餘裕。
       抖的主要是**對照組**：它的 250–800Hz 幾乎全來自開頭那 0.26 秒的劈裂聲，
       短的噪音爆本來就抖；門檻沒動（放寬門檻不算修，見 README〈九條偶爾飄的測試〉）。
       只有雷聲那兩發需要——其他音效不是噪音打底、就是門檻離實測值夠遠。 */
    const many = async (fn, sec, reps) => {
      const rows = [];
      for (let i = 0; i < reps; i++) rows.push(await one(fn, sec));
      const out = {};
      for (const k of Object.keys(rows[0])) {
        const v = rows.map(x => x[k]);
        out[k] = typeof v[0] === 'number' ? v.sort((a, b) => a - b)[v.length >> 1] : v[0];
      }
      return out;
    };
    const r = { nuke: await one(() => sndBoom(30)), bomb: await one(() => sndBoom(BOMB_R)),
                smash: await one(() => sndSmash()),
                fall1: await one(() => sndFall()),
                fall4: await one(() => { for (let i = 0; i < 4; i++) sndFall(); }),
                fall20: await one(() => { for (let i = 0; i < 20; i++) sndFall(); }),
                nukeHit: await one(() => { sndBoom(30); for (let i = 0; i < 20; i++) sndFall(); }),
                /* 放置音（v1.62.3 改成低頻、悅耳）。舊的那一版就地重建當對照組——
                   「變低、變柔」是相對的，沒有對照組就只是在背一組絕對數字。 */
                place: await one(() => sndPlace()),
                placeOld: await one(() => tone(420, 0.06, 'square', 0.045)),
                placeTop: await one(() => { placedCnt = bp.slots.length; sndPlace(); }),
                placeOldTop: await one(() => tone(1040, 0.06, 'square', 0.045)),
                wind: await one(() => sndWind()),
                /* 舊的風聲就地重建當對照組（v1.62.3～v1.122 那一版）：
                   「像不像風」是相對的，沒有對照組就只是在背一組絕對數字。 */
                windOld: await one(() => {
                  noise(WIND_DUR, 0.17, 520);
                  tone(82, WIND_DUR * 0.9, 'sawtooth', 0.035, 0.75);
                }),
                /* 雷聲全部用 8 秒的視窗量：v1.131 的滾雷排了 5 秒，3 秒會把拖尾切掉。
                   三個版本都用同一個視窗，數字才比得下去。 */
                thunder: await many(() => sndThunder(), 8, 5),
                /* 舊的雷聲（v1.117～v1.122）：一記切在 2200 的劈 ＋ 切在 190 的滾雷
                   ＋ 一支往下滑的鋸齒。前後那兩層正好是 sndSmash／sndThud 的配方，
                   使用者聽到的「像東西撞到建築」就是它們。 */
                thunderOld: await one(() => {
                  noise(0.22, 0.3, 2200); noise(1.3, 0.2, 190);
                  tone(58, 1.1, 'sawtooth', 0.075, 0.32);
                }, 8),
                /* v1.123～v1.130 那一版就地復刻（v1.131 的對照組）：方向對，但每一項
                   都只做了一半——使用者：「打雷音效好像上次沒調好 應該是低頻比較長一點的
                   轟轟聲」。rumble() 現在的起伏放慢了一半，所以連那三支正弦一起復刻。 */
                thunder130: await many(() => {
                  const c = audio();        // 這時候 audio 指著離線 context（見 render）
                  noise(0.26, 0.16, 700);
                  const n = Math.floor(c.sampleRate * 2.4);
                  const buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
                  for (let i = 0; i < n; i++) {
                    const t = i / c.sampleRate;
                    const roll = 0.5 + 0.5 * (Math.sin(t * 14.5) * 0.5 +
                                              Math.sin(t * 23.2) * 0.3 + Math.sin(t * 38.3) * 0.2);
                    d[i] = (Math.random() * 2 - 1) * (1 - i / n) * roll;
                  }
                  const src = c.createBufferSource(); src.buffer = buf;
                  const f1 = c.createBiquadFilter(), f2 = c.createBiquadFilter();
                  f1.type = f2.type = 'lowpass'; f1.frequency.value = f2.frequency.value = 120;
                  const g = c.createGain(); g.gain.value = 0.26;
                  src.connect(f1).connect(f2).connect(g).connect(c.destination); src.start();
                  tone(44, 2.4 * 0.8, 'sawtooth', 0.07, 0, 'thunder130');
                }, 8, 5),
                thud: await one(() => sndThud(11)),
                /* 王之財寶（v1.132）。它的音量要壓得比誰都低，因為**發數**：
                   連射七秒、每秒 28 發，射出與命中各一聲。所以除了單獨一聲，
                   還要量「一秒份全部疊在同一瞬間」的最壞情況。 */
                blade: await one(() => sndBlade()),
                /* v1.135 那一版的破空聲（就地復刻當對照組）：2100Hz 往下滑的鋸齒
                   ＋ 切在 5200 的短噪音——使用者說那「像是弓箭聲」，量下去也真的是
                   高頻占了九成幾。 */
                bladeOld: await one(() => {
                  tone(2100, 0.09, 'sawtooth', 0.018, 0.32, 'bladeOld');
                  noise(0.07, 0.035, 5200);
                }),
                /* 命中聲（v1.152 從金屬脆響換成爆炸的配方，見 sndGateHit）。
                   五次取中位數：噪音打底的音效單次量到的頻段占比本來就會抖（同雷聲，見 many）。 */
                gateHit: await many(() => sndGateHit(), 3, 5),
                /* v1.132～v1.151 那一版的命中聲就地復刻當對照組：760Hz 的方波
                   ＋ 切在 2100 的噪音。「像不像爆炸」是相對的，沒有對照組就只是在背數字。 */
                clangOld: await many(() => {
                  tone(760, 0.13, 'square', 0.022, 0.35, 'clangOld');
                  noise(0.13, 0.075, 2100);
                }, 3, 5),
                /* 五次取中位數（同雷聲那兩發，見 many）：**peak 是一堆隨機噪音疊起來的
                   最大值**，單次量的話本來就會抖。同一份程式碼連量十五次，一組一秒份量到
                   0.165～0.268、三組 0.169～0.251——門檻 0.25 兩邊都會偶爾踩到，
                   跟改了什麼無關。取五次的中位數之後（連量六輪）落在 0.183～0.208，
                   離門檻有三成餘裕。門檻沒動（放寬門檻不算修，見 README〈九條偶爾飄的測試〉）。 */
                gate1s: await many(() => {
                  for (let i = 0; i < GATE_RATE; i++) sndBlade();
                  for (let i = 0; i < 13; i++) sndGateHit();
                  for (let i = 0; i < 15; i++) sndStab();
                }, 3, 5),
                /* 同一秒份、命中聲換回 v1.151 那一版（對照組）：使用者要「音量不要太大」，
                   而這一聲一秒響十幾次，要比的就是**疊起來**的量不是單聲。 */
                gateOld1s: await many(() => {
                  for (let i = 0; i < GATE_RATE; i++) sndBlade();
                  for (let i = 0; i < 13; i++) {
                    tone(760, 0.13, 'square', 0.022, 0.35, 'clangOld');
                    noise(0.13, 0.075, 2100);
                  }
                  for (let i = 0; i < 15; i++) sndStab();
                }, 3, 5),
                /* 三組同時在射（v1.136）：發數三倍。撐住這件事的還是「同一支音效
                   0.06 秒內最多疊 3 個」那條規矩，所以量到的該跟一組差不多——
                   這一條就是在驗那件事。 */
                gate3s: await many(() => {
                  for (let i = 0; i < GATE_RATE * 3; i++) sndBlade();
                  for (let i = 0; i < 39; i++) sndGateHit();
                  for (let i = 0; i < 45; i++) sndStab();
                }, 3, 5) };
    audio = realAudio; muted = wasMuted; running = wasRunning;
    return r;
  });
  /* 爆炸聲刺不刺，看的是 2kHz 以上占多少能量。改之前噪音低通切在 900、音量 0.34，
     那一帶留著一大截高頻嘶聲，占了 25.1%（rms 0.0249）——聽起來就是又大聲又刺。
     門檻用 rms 不用 peak：noise() 每次都是重新抽的隨機取樣，峰值會跳，rms 才穩。 */
  ok('爆炸聲不刺耳，音量也壓下來了', snd.nuke.hiPct < 18 && snd.nuke.rms < 0.02,
     '核彈 2kHz 以上 ' + snd.nuke.hiPct + '%、rms ' + snd.nuke.rms +
     '、peak ' + snd.nuke.peak + '（槌子 ' + snd.smash.hiPct + '%）');
  /* 但不能壓成一聲悶悶的氣音：最大的那一發還是要比槌子有份量，
     份量看的是 80–250Hz（46Hz 的基音小喇叭根本推不出來，聽得到的是它的泛音）。 */
  ok('爆炸仍然是全場最有份量的一聲',
     snd.nuke.body > snd.smash.body * 1.3 && snd.nuke.rms > snd.smash.rms,
     '核彈 80–250Hz ' + snd.nuke.body + '（槌子 ' + snd.smash.body + '），總 rms ' +
     snd.nuke.rms + ' vs ' + snd.smash.rms);
  // 半徑只放大時間不放大音量：炸彈跟核彈是同一支音效，差在轟多久
  ok('小爆炸比大爆炸短，但不是另一種聲音',
     snd.bomb.rms < snd.nuke.rms && Math.abs(snd.bomb.hiPct - snd.nuke.hiPct) < 3,
     '炸彈 rms ' + snd.bomb.rms + '、核彈 ' + snd.nuke.rms +
     '（高頻占比 ' + snd.bomb.hiPct + '% vs ' + snd.nuke.hiPct + '%）');

  /* 王之財寶（v1.132）：一發破空聲是全場最輕的一聲（它一秒要響二十幾次），
     而且一秒份全部疊在同一瞬間也不會打到滿刻度——靠的是同一支音效 0.06 秒內
     最多疊 3 個那條規矩（跟一排小人同時被掀倒是同一個機制，見下一條）。 */
  /* 射出去那一聲要「霸氣」不要「弓箭」（v1.136，使用者：「調整射擊音效 應該是更霸氣
     (目前像是弓箭聲)」）。弓箭＝高頻的咻，霸氣＝低頻的破空，所以拿舊版當對照組
     量兩件事：2kHz 以上要掉下來、80–250Hz 要撐起來。音量可以重一點，但仍要遠低於槌子。 */
  ok('射擊聲從高頻的「咻」換成低頻的破空（不再像弓箭）',
     snd.blade.hiPct < snd.bladeOld.hiPct * 0.4 &&
     snd.blade.body > snd.bladeOld.body * 2 && snd.blade.rms > snd.bladeOld.rms,
     '2kHz 以上 ' + snd.bladeOld.hiPct + '% → ' + snd.blade.hiPct +
     '%；80–250Hz ' + snd.bladeOld.body + ' → ' + snd.blade.body +
     '；單聲 rms ' + snd.bladeOld.rms + ' → ' + snd.blade.rms);
  ok('王之財寶一發的破空聲比槌子輕得多',
     snd.blade.rms < snd.smash.rms * 0.5 && snd.gateHit.rms < snd.smash.rms * 0.6,
     '破空 rms ' + snd.blade.rms + '、命中 ' + snd.gateHit.rms +
     '（槌子 ' + snd.smash.rms + '）');
  /* 命中聲要「接近爆炸音效」而且「音量不要太大」（v1.152，使用者：「調整王之財寶命中時
     音效 應該要接近爆炸音效（音量也不要太大 因為很多發 只是現在音效跟特效不是很搭配）」）。
     特效從 v1.148 起是一顆小爆炸火球，聲音卻還是 v1.132 那記金屬脆響。
     三件事分開驗，缺一不可：
     ① **像爆炸**：2kHz 以上的占比要從舊版那一大截掉下來，而且要落在炸彈那一帶
        （±8 個百分點；實測 clangOld 67%、炸彈 13%、現在 15.6%）；
     ② **有份量不是氣音**：80–250Hz 要比舊版翻上去（那是低頻鋸齒撐出來的）；
     ③ **比舊的小聲**：單聲與「一秒份疊在一起」兩個都要比對照組小——一秒響十幾次，
        只看單聲會漏掉疊起來的量。 */
  ok('命中聲換成爆炸的配方，而且比 v1.151 那一版更小聲',
     snd.gateHit.hiPct < snd.clangOld.hiPct * 0.35 &&
     Math.abs(snd.gateHit.hiPct - snd.bomb.hiPct) < 8 &&
     snd.gateHit.body > snd.clangOld.body * 1.6 &&
     snd.gateHit.rms < snd.clangOld.rms &&
     snd.gate1s.rms < snd.gateOld1s.rms && snd.gate1s.peak < snd.gateOld1s.peak,
     '2kHz 以上 ' + snd.clangOld.hiPct + '% → ' + snd.gateHit.hiPct +
     '%（炸彈 ' + snd.bomb.hiPct + '%）；80–250Hz ' + snd.clangOld.body + ' → ' +
     snd.gateHit.body + '；單聲 rms ' + snd.clangOld.rms + ' → ' + snd.gateHit.rms +
     '；一秒份 rms ' + snd.gateOld1s.rms + ' → ' + snd.gate1s.rms +
     '、peak ' + snd.gateOld1s.peak + ' → ' + snd.gate1s.peak);
  /* 峰值用絕對門檻（跟「一排小人同時被掀倒」那條同一個 0.2 量級），不跟核彈比：
     這一秒份是幾十個短促的金屬撞擊，峰值本來就會比一聲拖很長的低頻爆炸高，
     真正要擋的是「疊到滿刻度」。總量（rms）才拿核彈當上限。 */
  ok('連射一秒份全疊在同一瞬間也不會打到滿刻度，三組同時射也不會吵三倍',
     snd.gate1s.over === 0 && snd.gate1s.peak < 0.25 &&
     snd.gate1s.rms < snd.nuke.rms &&
     snd.gate3s.over === 0 && snd.gate3s.peak < 0.25 &&
     snd.gate3s.rms < snd.gate1s.rms * 1.25,
     '一組一秒份 rms ' + snd.gate1s.rms + '／peak ' + snd.gate1s.peak +
     '；三組 rms ' + snd.gate3s.rms + '／peak ' + snd.gate3s.peak +
     '（發數三倍、量幾乎不變：同一支 0.06 秒內最多疊 3 個）；滿刻度 ' +
     (snd.gate1s.over + snd.gate3s.over) + ' 個取樣（核彈 ' + snd.nuke.rms +
     '／' + snd.nuke.peak + '）');

  /* 「炸空地還好、炸到建築就刺耳」的根源不是爆炸，是被同一發掀倒的那一排小人：
     二十聲 sndFall 是二十個從相位 0 起跳的同頻方波，同相疊起來峰值 0.047 → 0.95
     （幾乎滿刻度的方波，比爆炸本身的 0.14 刺得多）。
     現在同一支音效 0.06 秒內最多疊 3 個，超過的不放，所以 4 個跟 20 個一樣大。 */
  ok('一排小人同時被掀倒，不會疊成一聲滿刻度的方波',
     snd.fall20.peak < 0.2 && Math.abs(snd.fall20.peak - snd.fall4.peak) < 0.03 &&
     snd.fall4.peak > snd.fall1.peak,
     '1 個 peak ' + snd.fall1.peak + '、4 個 ' + snd.fall4.peak + '、20 個 ' + snd.fall20.peak);
  /* 放置音（v1.62.3，使用者要「比較低頻悅耳」）。三件事分開驗：
     ① 高頻少了很多——方波的奇次泛音是 1/n，這就是「尖」的來源。
     ② 音高整組往下——蓋到最後那一聲最高，拿新舊的最高音比才公平
        （比起手那一聲的話，光是起點不同就會過）。
     ③ 音高吸在五聲音階上，不是連續滑音：連續的頻率會落在半音與微分音上，
        一路蓋下來像走音的哨子。這一條直接攔 tone() 看它到底被餵了什麼頻率。 */
  ok('放置音變柔了（高頻少很多）',
     snd.place.hiPct < snd.placeOld.hiPct * 0.5,
     '2kHz 以上占比 ' + snd.placeOld.hiPct + '% → ' + snd.place.hiPct + '%');
  /* 音高直接攔 tone() 看它被餵了什麼頻率——這是振盪器真正在響的音，
     比從波形反推可靠。舊的那條公式（420 + p×620）就地算一份當對照組。 */
  const placeNotes = await page.evaluate(() => {
    const real = tone, hit = [], old = [];
    tone = f => hit.push(+f.toFixed(2));
    const keep = placedCnt;
    for (let i = 0; i <= 20; i++) {
      const p = i / 20;
      placedCnt = Math.round(bp.slots.length * p);
      sndPlace();
      old.push(420 + p * 620);                    // v1.62.2 之前那條連續滑音
    }
    placedCnt = keep; tone = real;
    return { hit, off: hit.filter(f => PLACE_SCALE.indexOf(f) < 0).length,
             lo: Math.min(...hit), hi: Math.max(...hit), kinds: new Set(hit).size,
             ratio: +Math.max(...hit.map((f, i) => f / old[i])).toFixed(2),
             mean: +(hit.reduce((a, f, i) => a + f / old[i], 0) / hit.length).toFixed(2) };
  });
  ok('放置音整組降下去了',
     placeNotes.ratio < 0.65 && placeNotes.mean < 0.55 && placeNotes.hi <= 588,
     '同一個進度下，新的音高平均是舊的 ' + placeNotes.mean + ' 倍、最高的那一聲也只有 ' +
     placeNotes.ratio + ' 倍（舊的 420～1040Hz → 新的 ' + placeNotes.lo + '～' +
     placeNotes.hi + 'Hz，約降一個八度）');
  ok('每一聲都落在五聲音階上，不是連續的滑音',
     placeNotes.off === 0 && placeNotes.kinds > 4 &&
     placeNotes.hi <= 588 && placeNotes.lo >= 196,
     '從 0% 蓋到 100% 取 21 個點：' + placeNotes.kinds + ' 種音、' +
     placeNotes.lo + '～' + placeNotes.hi + 'Hz，不在音階上的有 ' + placeNotes.off + ' 聲');

  /* 起音（v1.62.3）：從 0 直接跳到音量會有「喀」的一聲。一整棟要敲幾百次，
     這一聲跟音色一樣影響「悅不悅耳」。量法是把波形算出來看**前 2 毫秒**多大聲：
     沒有起音的話第一個取樣就是滿音量。 */
  const placeAtk = await page.evaluate(async () => {
    const SR = 44100, realAudio = audio, wasMuted = muted, wasRunning = running;
    running = false;
    const head = async fn => {
      const ctx = new OfflineAudioContext(1, SR, SR);
      audio = () => ctx; muted = false;
      fn();
      audio = realAudio;                    // 理由見上面 render() 那一段的註解
      const d = (await ctx.startRendering()).getChannelData(0);
      let early = 0, peak = 0;
      for (let i = 0; i < d.length; i++) {
        const v = Math.abs(d[i]);
        if (i < SR * 0.002) early = Math.max(early, v);
        peak = Math.max(peak, v);
      }
      return { early: +early.toFixed(4), peak: +peak.toFixed(4) };
    };
    const now = await head(() => sndPlace());
    const before = await head(() => tone(420, 0.06, 'square', 0.045));
    audio = realAudio; muted = wasMuted; running = wasRunning;
    return { now, before };
  });
  ok('放置音不再「喀」一聲起頭',
     placeAtk.now.early < placeAtk.now.peak * 0.35 &&
     placeAtk.before.early > placeAtk.before.peak * 0.9,
     '前 2 毫秒的音量佔整聲的 ' +
     (placeAtk.before.early / placeAtk.before.peak * 100).toFixed(0) + '% → ' +
     (placeAtk.now.early / placeAtk.now.peak * 100).toFixed(0) + '%');

  /* 龍捲風的風聲（v1.62.3）。使用者的說法是「好像沒有音效」——其實有，
     但只在出場放一聲 1.6 秒的噪音，而它現在活 10 秒，後面八秒多是靜的。
     所以要驗的不是「有沒有響」，是**整段都在響**：攔下 sndWind 記錄它在第幾秒被叫，
     然後看最長的空檔有多久（超過一段的長度就代表中間真的靜掉了）。 */
  const windLoop = await page.evaluate(() => {
    const real = sndWind, at = [];
    twists = null;
    let t = 0;
    sndWind = () => at.push(+t.toFixed(2));
    launchTornado({ x: 0, z: 0 }, { x: 0, z: 20 });
    while (twists && t < 13) { step(0.02); t += 0.02; }
    sndWind = real;
    twists = null; ENG.putTornados([]);
    const gaps = at.slice(1).map((v, i) => +(v - at[i]).toFixed(2));
    return { at, n: at.length, gaps, worst: Math.max(...gaps, at[0]),
             last: +(TW_LIFE - at[at.length - 1]).toFixed(2),
             dur: WIND_DUR, gap: WIND_GAP, tail: WIND_TAIL };
  });
  ok('風聲整段都在，不是出場響一聲就沒了',
     windLoop.n >= 6 && windLoop.worst <= windLoop.dur,
     '10 秒裡響了 ' + windLoop.n + ' 段（每段 ' + windLoop.dur + ' 秒），最長的空檔 ' +
     windLoop.worst + ' 秒——比一段還短就表示前一段還沒收就接上了');
  ok('最後一段不會拖到龍捲風散了還在吹',
     windLoop.last >= windLoop.tail && windLoop.dur - windLoop.last <= 1.1,
     '最後一段在還剩 ' + windLoop.last + ' 秒時起頭，所以它收乾淨的時間點在漏斗散掉後 ' +
     (windLoop.dur - windLoop.last).toFixed(2) + ' 秒（上限 1.1）');

  /* 幽浮的嗡嗡聲（v1.167）走的是風聲那一套「一段一段接下去」，所以守的也是同一件事：
     照光那幾秒不能有靜掉的空檔。飛進來與飛走各響一聲，中間照光那段才是接力的。 */
  const ufoLoop = await page.evaluate(() => {
    const real = sndUfo, at = [];
    ufoClear();
    let t = 0;
    sndUfo = () => at.push(+t.toFixed(2));
    callUfo({ x: 0, z: 0 });
    let beam0 = -1, beam1 = -1;
    while (ufos && t < 20) {
      step(0.02); t += 0.02;
      const u = ufos && ufos[0];
      if (u && u.st === 'beam') { if (beam0 < 0) beam0 = t; beam1 = t; }
    }
    sndUfo = real;
    ufoClear();
    const inBeam = at.filter(v => v >= beam0 - 0.1 && v <= beam1 + 0.1);
    const gaps = inBeam.slice(1).map((v, i) => +(v - inBeam[i]).toFixed(2));
    return { n: at.length, beam: inBeam.length, gaps,
             worst: gaps.length ? Math.max(...gaps) : 99,
             beamLen: +(beam1 - beam0).toFixed(1), dur: UFO_SND_DUR, gap: UFO_SND_GAP };
  });
  ok('幽浮的嗡嗡聲照光整段都在（同風聲，一段一段接下去）',
     ufoLoop.beam >= 3 && ufoLoop.worst <= ufoLoop.dur,
     '照光那 ' + ufoLoop.beamLen + ' 秒裡響了 ' + ufoLoop.beam + ' 段（每段 ' + ufoLoop.dur +
     ' 秒、間隔 ' + ufoLoop.gap + '），最長空檔 ' + ufoLoop.worst + ' 秒');

  /* 風聲的音色（v1.123，使用者：「龍捲風音效調整 目前沒有風聲的感覺」）。
     兩件事分開驗，各拿舊版當對照：
     ① **包絡**：舊版走的是 noise() 自帶的線性衰減——一開聲最大、之後一路弱下去，
        那是「爆」的包絡不是「吹」的。新版先吹起來再撐著，所以中段要比起手大。
     ② **頻段**：舊版低通切 520，八成能量悶在 250Hz 以下（小喇叭根本推不出來）；
        風的呼嘯在 250～900 那一段。搬過去的同時不能變成嘶聲，所以高頻也要守著。
     總音量刻意對齊舊版：能量搬到聽得見的那一段之後，同樣的 rms 會大不少。 */
  /* 比大小要用**沒取整**的（v1.158.2）：先 toFixed(0) 再相減的話，量到 76.6% → 66.7%
     會被讀成 77 → 67，差剛好 10，`< −10` 就差一票紅掉——飄的是四捨五入，不是音色。
     印出來的那份照樣取整（報告要好讀）。 */
  const bodyRaw = m => m.body / m.rms * 100;
  const bodyShare = m => +bodyRaw(m).toFixed(0);
  ok('風聲是「一直在吹」，不是「呼」一聲就散',
     snd.wind.hold > 2 && snd.windOld.hold < 1,
     '中段音量 ÷ 起手音量：舊版 ' + snd.windOld.hold + '（一路弱下去）→ 新版 ' +
     snd.wind.hold + '（吹起來再撐著）');
  ok('風聲從悶在低頻搬到呼嘯的那一段，也沒有變成嘶聲',
     bodyRaw(snd.wind) < bodyRaw(snd.windOld) - 10 && snd.wind.hiPct < 22 &&
     snd.wind.rms < snd.windOld.rms * 1.35,
     '80–250Hz 占比 ' + bodyShare(snd.windOld) + '% → ' + bodyShare(snd.wind) +
     '%、2kHz 以上 ' + snd.windOld.hiPct + '% → ' + snd.wind.hiPct +
     '%、總 rms ' + snd.windOld.rms + ' → ' + snd.wind.rms);

  /* 雷聲（v1.123 重做，v1.131 再壓一次）。使用者原本的說法是「音效應該是低頻轟轟聲
     (目前像是東西撞到建築那種音效)」——沒錯，v1.122 前後兩層正好是 sndSmash／sndThud
     的配方（切在 2200 的高頻碎裂 ＋ 一支往下滑的音高）。v1.123 照這個方向改完，使用者
     再回一次：「打雷音效好像上次沒調好 應該是低頻比較長一點的轟轟聲」——量下去三件事
     都還差著，所以這裡改成拿 **v1.130 那一版當對照組**，兩件事分開驗：
     ① **夠低**：2kHz 以上比 v1.122 少一大截（拿 sndThud 隕石落地的悶響當參考點），
        而且「撞到建築」真正在的那一段（250～800Hz）要比 v1.130 再低一截。
     ② **夠久**：v1.130 的滾雷雖然排了 2.4 秒，但 rumble 的包絡是 (1−i/n)，
        實際第 2 秒就沒聲了；v1.131 排 5 秒、響到第 4 秒，而且 2.6～3.4 秒那一段還有東西。 */
  ok('雷聲整支壓到低頻，不再像東西砸到建築',
     snd.thunder.hiPct < 20 && snd.thunderOld.hiPct > 50 &&
     snd.thunder.hiPct < snd.thud.hiPct * 1.5 &&
     snd.thunder.midPct < snd.thunder130.midPct - 8 && snd.thunder.midPct < snd.thud.midPct,
     '2kHz 以上 ' + snd.thunderOld.hiPct + '% → ' + snd.thunder.hiPct +
     '%（隕石落地是 ' + snd.thud.hiPct + '%）；250–800Hz（撞到建築的那一段）v1.130 ' +
     snd.thunder130.midPct + '% → ' + snd.thunder.midPct + '%（隕石落地是 ' +
     snd.thud.midPct + '%）');
  ok('滾雷拖得夠久，三秒後還在轟',
     snd.thunder.tail > 0.15 && snd.thunder.tail3 > 0.05 && snd.thunder.last > 3.5 &&
     snd.thunderOld.tail < 0.02 && snd.thunder130.tail3 < 0.02,
     '響到第幾秒：v1.122 ' + snd.thunderOld.last + '、v1.130 ' + snd.thunder130.last +
     '、現在 ' + snd.thunder.last + '；2.6～3.4 秒 ÷ 起頭 0.3 秒：v1.130 ' +
     snd.thunder130.tail3 + '（沒聲了）→ 現在 ' + snd.thunder.tail3 +
     '（1.2～1.8 秒那一段是 ' + snd.thunder130.tail + ' → ' + snd.thunder.tail + '）');

  /* 「破表」看的是 over（有幾個取樣打到 ±0.999）與 rms，peak 只放在訊息裡當參考
     ——v1.128.1 修間歇性失敗。原本的門檻是 `peak < 0.25`，但這一發是
     「爆炸的噪音 ＋ 三聲隨機音高的跌倒聲」（20 聲被 VOICE_MAX 擋成 3 聲），
     噪音每次都是重新抽的取樣，峰值本來就會跳：實測算 25 次是 0.165～0.263、
     中位數 0.204，**有 2 次超過 0.25**。同一批的 rms 是 0.0164～0.0184（只差 6%）、
     over 永遠是 0。這正是這一段開頭那條註解說的「門檻用 rms 不用 peak」，
     那條規則沒套到自己身上。
     peak 的上界留 0.32（實測最大 0.263 再加兩成），只擋「真的往滿刻度衝」那種回歸。 */
  ok('核彈打在建築上那一幀不會破表',
     snd.nukeHit.over === 0 && snd.nukeHit.rms < 0.025 && snd.nukeHit.peak < 0.32,
     '爆炸＋20 人跌倒 rms ' + snd.nukeHit.rms + '、peak ' + snd.nukeHit.peak +
     '、打到滿刻度 ' + snd.nukeHit.over + ' 個取樣（爆炸自己 peak ' +
     snd.nuke.peak + '）');

  /* ══════════ 視角操作 ══════════ */
  await head('視角操作');
  await reset(page, { shape: '艾菲爾鐵塔', cnt: 900, workers: 6 });
  await fillAll(page);
  // v1.70 起拖曳的意義跟手上拿什麼有關（水桶是把水澆過去），所以先釘住工具
  const camBefore = await page.evaluate(() => { tool = 'hammer'; return { yaw: ENG.cam.yaw, pitch: ENG.cam.pitch, dist: ENG.cam.dist }; });
  await page.mouse.move(640, 400);
  await page.mouse.down();
  await page.mouse.move(820, 330, { steps: 8 });
  await page.mouse.up();
  const camAfter = await page.evaluate(() => ({ yaw: ENG.cam.yaw, pitch: ENG.cam.pitch }));
  ok('拖曳可以轉視角',
     Math.abs(camAfter.yaw - camBefore.yaw) > 0.1 && Math.abs(camAfter.pitch - camBefore.pitch) > 0.05,
     'yaw ' + (camAfter.yaw - camBefore.yaw).toFixed(2) + '，pitch ' + (camAfter.pitch - camBefore.pitch).toFixed(2));

  await page.mouse.move(640, 400);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(60);
  const zoomOut = await page.evaluate(() => ENG.camTarget.dist);
  await page.mouse.wheel(0, -900);
  await page.waitForTimeout(60);
  const zoomIn = await page.evaluate(() => ENG.camTarget.dist);
  ok('滾輪可以縮放', zoomOut > camBefore.dist && zoomIn < zoomOut,
     camBefore.dist.toFixed(1) + ' → ' + zoomOut.toFixed(1) + ' → ' + zoomIn.toFixed(1));

  /* 震動是固定的世界座標位移，畫面上晃多少全看視距：同樣的一發，視距 10 時鏡頭偏 22°、
     視距 66 只有 3.6°——貼著建築看的時候會晃到看不清楚。所以近距離不震，遠了才是全額。
     量的是「同一發震動造成的鏡頭位移」：把 cam 與 camTarget 對齊，lerp 就不會動，
     位移就只剩震動那一份。 */
  const shakeAt = await page.evaluate(() => {
    const cam = ENG.cam, ct = ENG.camTarget, C = ENG.three.camera;
    const at = dist => {
      ct.dist = cam.dist = dist; ct.ty = cam.ty = 6; ct.tx = cam.tx = ct.tz = cam.tz = 0;
      cam.shake = 0; ENG.updateCamera(0.016);
      const base = C.position.clone();
      cam.shakeT = 0;
      let mx = 0;
      for (let i = 0; i < 8; i++) {                  // 8 幀約半個週期，抓得到峰值
        cam.shake = 2.6;                             // 每幀補回來：比的是同一發在不同視距的差
        ENG.updateCamera(0.016);
        mx = Math.max(mx, C.position.distanceTo(base));
      }
      cam.shake = 0; ENG.updateCamera(0.016);
      return +mx.toFixed(2);
    };
    const keep = { d: ct.dist, ty: ct.ty };
    const r = { d12: at(12), d24: at(24), d36: at(36), d60: at(60), d160: at(160) };
    // 量完把鏡頭放回去：後面的平移測試速度是跟著視距走的，留在 160 會變成另一回事
    ct.dist = cam.dist = keep.d; ct.ty = cam.ty = keep.ty;
    return r;
  });
  ok('鏡頭拉很近的時候不會震動', shakeAt.d12 === 0 && shakeAt.d24 === 0,
     '視距 12 位移 ' + shakeAt.d12 + '、視距 24 位移 ' + shakeAt.d24);
  ok('拉開之後震動照舊', shakeAt.d60 > 3 && shakeAt.d160 === shakeAt.d60 &&
     shakeAt.d36 > 0 && shakeAt.d36 < shakeAt.d60,
     '視距 36 位移 ' + shakeAt.d36 + '（過渡）、60 位移 ' + shakeAt.d60 +
     '、160 位移 ' + shakeAt.d160);

  /* ── 鍵盤平移 ──
     一律走真的鍵盤事件，listener 有沒有接上、e.code 對不對都一起測到。
     平移是在 frame() 裡推進的，running 關掉就不會動，所以先打開。 */
  const wasRunning = await page.evaluate(() => { const r = running; running = true; return r; });
  const resetPan = () => page.evaluate(() => {
    ENG.camTarget.tx = ENG.camTarget.tz = 0; ENG.cam.tx = ENG.cam.tz = 0;
  });
  const panBy = async (key, ms) => {
    await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key);
    return page.evaluate(() => ({ tx: ENG.camTarget.tx, tz: ENG.camTarget.tz }));
  };

  await resetPan();
  const wMove = await panBy('w', 250);
  ok('WASD 可以平移鏡頭', Math.hypot(wMove.tx, wMove.tz) > 1,
     '按住 W 250ms 移動了 ' + Math.hypot(wMove.tx, wMove.tz).toFixed(1) + ' 單位');

  /* 平移方向要以畫面為準。照世界軸走的話，轉過視角之後按 W 會往螢幕斜後方跑 */
  const dirs = [];
  for (const yaw of [0, Math.PI / 2]) {
    await page.evaluate(y => { ENG.cam.yaw = y; }, yaw);
    await resetPan();
    dirs.push(await panBy('w', 200));
  }
  let dAng = Math.abs(Math.atan2(dirs[1].tz, dirs[1].tx) - Math.atan2(dirs[0].tz, dirs[0].tx));
  if (dAng > Math.PI) dAng = 2 * Math.PI - dAng;
  ok('平移方向跟著視角轉，不是固定的世界軸', Math.abs(dAng - Math.PI / 2) < 0.2,
     '視角轉 90°，同一顆鍵的世界方向差 ' + (dAng * 57.3).toFixed(0) + '°');

  /* 草地是有限的圓島，推到底要停在場地邊緣，不能飄出去看到虛空 */
  const clamped = await page.evaluate(() => {
    ENG.camTarget.tx = ENG.camTarget.tz = 0;
    for (let i = 0; i < 600; i++) ENG.pan(1, 0.3, 0.05);
    return { d: Math.hypot(ENG.camTarget.tx, ENG.camTarget.tz), arena: arenaR };
  });
  ok('平移不會跑出場地', clamped.d <= clamped.arena + 0.01,
     '一直推 → 停在 ' + clamped.d.toFixed(1) + '，場地半徑 ' + clamped.arena.toFixed(1));

  /* ── Q／E 轉視角 ── */
  await page.evaluate(() => { ENG.cam.yaw = 0; });
  const qe = { };
  await page.keyboard.down('e'); await page.waitForTimeout(300); await page.keyboard.up('e');
  qe.e = await page.evaluate(() => ENG.cam.yaw);
  await page.keyboard.down('q'); await page.waitForTimeout(300); await page.keyboard.up('q');
  qe.back = await page.evaluate(() => ENG.cam.yaw);
  ok('Q／E 可以轉視角，兩顆方向相反',
     Math.abs(qe.e) > 0.2 && Math.abs(qe.back) < Math.abs(qe.e) * 0.5,
     '按 E 300ms → yaw ' + qe.e.toFixed(2) + '，再按 Q 300ms → ' + qe.back.toFixed(2));
  /* E 要對應「滑鼠往右拖」，不然兩套操作的手感會相反 */
  const qeDir = await page.evaluate(() => {
    ENG.cam.yaw = 0; ENG.orbit(100, 0);
    return ENG.cam.yaw;
  });
  ok('E 的方向跟滑鼠往右拖一致', Math.sign(qe.e) === Math.sign(qeDir),
     'E 是 ' + (qe.e > 0 ? '+' : '−') + '、往右拖是 ' + (qeDir > 0 ? '+' : '−'));

  /* ── Z／X 升降視線、C 回到開場的鏡頭（v1.110） ── */
  const liftBy = async (key, ms) => {
    await page.evaluate(() => { ENG.camTarget.ty = 0; ENG.cam.ty = 0; });
    await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key);
    return page.evaluate(() => ENG.camTarget.ty);
  };
  const zxKey = { up: await liftBy('x', 300) };
  zxKey.down = await liftBy('z', 300);
  ok('Z／X 可以升降視線高度，兩顆方向相反', zxKey.up > 1 && zxKey.down < -1,
     '按 X 300ms → 視線高 ' + zxKey.up.toFixed(1) + '，按 Z 300ms → ' + zxKey.down.toFixed(1));

  /* 上下界跟著這一座建築走。下界一定要是負的：桌機取景看的是建築底部（ty = 0），
     夾在 0 的話按 Z 整個沒反應。上面要能越過屋頂（才俯視得到），下面只給四分之一
     （視線落到地面以下之後看到的就只剩草地與天空）。 */
  const liftCap = await page.evaluate(() => {
    ENG.camTarget.ty = 0;
    for (let i = 0; i < 400; i++) ENG.lift(1, 0.05);
    const hi = ENG.camTarget.ty;
    for (let i = 0; i < 900; i++) ENG.lift(-1, 0.05);
    return { hi: +hi.toFixed(1), lo: +ENG.camTarget.ty.toFixed(1), h: bp.height };
  });
  ok('升降推到底會停住：上界越過屋頂，下界只到地面下一小段',
     liftCap.hi > liftCap.h && liftCap.hi < liftCap.h + 10 &&
     liftCap.lo < -1 && liftCap.lo > -(liftCap.h * 0.35 + 6),
     '建築高 ' + liftCap.h + '：一直按 X 停在 ' + liftCap.hi + '、一直按 Z 停在 ' + liftCap.lo);

  /* 爆炸運鏡（holdWide）本來就會把視線抬到上界之上。那時候只夾「往界外走」那半邊，
     不然按一下 Z 會先被拉回界內閃一下。 */
  const liftOver = await page.evaluate(() => {
    ENG.camTarget.ty = bp.height + 60;
    const start = ENG.camTarget.ty;
    ENG.lift(1, 0.2); const up = ENG.camTarget.ty;
    ENG.lift(-1, 0.2); const down = ENG.camTarget.ty;
    return { start, up, down };
  });
  ok('視線被爆炸運鏡抬到界外時，X 推不上去、Z 照樣降得下來',
     liftOver.up === liftOver.start && liftOver.down < liftOver.start - 0.5,
     '在 ' + liftOver.start.toFixed(0) + ' 按 X → ' + liftOver.up.toFixed(0) +
     '，按 Z → ' + liftOver.down.toFixed(1));

  /* C 復位。距離／視線高／中心是 fitCamera 重算的，所以按下去那一刻就到位
     （之後只剩 cam 慢慢追過去），可以直接量 camTarget。 */
  const camHome = await page.evaluate(() => {
    startBuild(true);                                   // 開場取景＝要回去的那一組
    const fit = { d: ENG.camTarget.dist, ty: ENG.camTarget.ty,
                  tx: ENG.camTarget.tx, tz: ENG.camTarget.tz };
    ENG.orbit(420, 150); ENG.zoom(0.35); ENG.pan(1, 0.6, 1.4); ENG.lift(1, 1.2);
    return { fit, moved: { d: ENG.camTarget.dist, ty: ENG.camTarget.ty,
                           tx: ENG.camTarget.tx, tz: ENG.camTarget.tz } };
  });
  await page.keyboard.press('c');
  const camBack = await page.evaluate(() => ({ d: ENG.camTarget.dist, ty: ENG.camTarget.ty,
                                               tx: ENG.camTarget.tx, tz: ENG.camTarget.tz }));
  ok('按 C 回到開場的取景：距離、視線高、中心都回去',
     Math.abs(camBack.d - camHome.fit.d) < 0.01 && Math.abs(camBack.ty - camHome.fit.ty) < 0.01 &&
     Math.abs(camBack.tx) < 0.01 && Math.abs(camBack.tz) < 0.01 &&
     Math.abs(camHome.moved.d - camHome.fit.d) > 1,
     '亂動之後 dist ' + camHome.moved.d.toFixed(1) + '／視線高 ' + camHome.moved.ty.toFixed(1) +
     '／中心 (' + camHome.moved.tx.toFixed(1) + ',' + camHome.moved.tz.toFixed(1) + ')' +
     '　→　按 C 之後 dist ' + camBack.d.toFixed(1) + '／視線高 ' + camBack.ty.toFixed(1) +
     '／中心 (' + camBack.tx.toFixed(1) + ',' + camBack.tz.toFixed(1) + ')');

  /* 角度沒有 camTarget 可以慢慢追（拖曳要即時），是另外一支過渡在滑。
     這裡自己餵 updateCamera 走完，不用等真的畫面。0.9／0.42 是 engine.js 裡
     cam 的起始角度——開場看到的就是這個方向。 */
  const camSpin = await page.evaluate(() => {
    ENG.orbit(500, 200);
    const was = { yaw: ENG.cam.yaw, pitch: ENG.cam.pitch };
    ENG.resetCamera();
    const mid = [];
    for (let i = 0; i < 200; i++) { ENG.updateCamera(0.05); if (i < 3) mid.push(+ENG.cam.yaw.toFixed(2)); }
    return { was, mid, yaw: ENG.cam.yaw, pitch: ENG.cam.pitch };
  });
  ok('C 也會把角度滑回開場的方向（不是瞬間扭過去）',
     Math.abs(camSpin.yaw - 0.9) < 0.001 && Math.abs(camSpin.pitch - 0.42) < 0.001 &&
     camSpin.mid.length === 3 && camSpin.mid[0] !== camSpin.mid[2],
     '從 yaw ' + camSpin.was.yaw.toFixed(2) + '／pitch ' + camSpin.was.pitch.toFixed(2) +
     ' 一路滑到 ' + camSpin.yaw.toFixed(3) + '／' + camSpin.pitch.toFixed(3) +
     '（前三幀 ' + camSpin.mid.join('→') + '）');

  const camGrab = await page.evaluate(() => {
    ENG.orbit(500, 0);
    ENG.resetCamera();
    for (let i = 0; i < 3; i++) ENG.updateCamera(0.05);    // 滑到一半
    ENG.orbit(-120, 0);                                    // 玩家自己轉＝接手
    const mine = ENG.cam.yaw;
    for (let i = 0; i < 60; i++) ENG.updateCamera(0.05);
    return { mine, after: ENG.cam.yaw };
  });
  ok('復位滑到一半自己轉視角，鏡頭就讓給玩家', Math.abs(camGrab.after - camGrab.mine) < 1e-9,
     '接手時 yaw ' + camGrab.mine.toFixed(3) + '，再跑 3 秒還是 ' + camGrab.after.toFixed(3));

  /* Ctrl／⌘＋C 是複製。先把鏡頭拉離取景，復位才看得出來有沒有被誤觸 */
  await page.evaluate(() => { ENG.zoom(0.5); ENG.orbit(260, 0); });
  const ctrlCopy = await page.evaluate(() => ({ yaw: ENG.cam.yaw, d: ENG.camTarget.dist }));
  await page.keyboard.down('Control');
  await page.keyboard.press('c');
  await page.keyboard.up('Control');
  await page.waitForTimeout(200);
  const ctrlAfter = await page.evaluate(() => ({ yaw: ENG.cam.yaw, d: ENG.camTarget.dist }));
  ok('Ctrl＋C 是複製，不會被當成鏡頭復位',
     Math.abs(ctrlAfter.d - ctrlCopy.d) < 0.01 && Math.abs(ctrlAfter.yaw - ctrlCopy.yaw) < 0.01,
     '按之前 dist ' + ctrlCopy.d.toFixed(1) + '／yaw ' + ctrlCopy.yaw.toFixed(2) +
     '，按之後 ' + ctrlAfter.d.toFixed(1) + '／' + ctrlAfter.yaw.toFixed(2));

  /* 「匯入建築」的貼上框裡 Z／X／C 是真的在打字，不能拿去動鏡頭 */
  const typeZX = await page.evaluate(() => {
    document.getElementById('impBtn').click();
    const ta = document.getElementById('impPaste');
    ta.value = ''; ta.focus();
    return { ty: ENG.camTarget.ty, d: ENG.camTarget.dist };
  });
  await page.keyboard.down('x'); await page.waitForTimeout(200); await page.keyboard.up('x');
  await page.keyboard.press('c');
  await page.waitForTimeout(150);
  const typed = await page.evaluate(() => {
    const ta = document.getElementById('impPaste');
    const r = { ty: ENG.camTarget.ty, d: ENG.camTarget.dist, txt: ta.value };
    ta.value = ''; ta.blur();
    document.getElementById('impClose').click();
    return r;
  });
  ok('在匯入建築的貼上框裡打 ZXC，鏡頭不動、字照樣進得去',
     typed.txt === 'xc' && Math.abs(typed.ty - typeZX.ty) < 0.01 &&
     Math.abs(typed.d - typeZX.d) < 0.01,
     '打進去「' + typed.txt + '」，視線高 ' + typeZX.ty.toFixed(1) + ' → ' + typed.ty.toFixed(1) +
     '、dist ' + typeZX.d.toFixed(1) + ' → ' + typed.d.toFixed(1));

  /* 換建築**不准**動鏡頭：玩家自己轉好、拉近、平移過的視角不該被搶走。
     只有開場那一次（instant）才取景。草地／陰影／霧還是要照新工地重算。 */
  const keepView = await page.evaluate(() => {
    const sp0 = shapePick, tc0 = targetCnt;             // 這一段會換藍圖，測完要還原
    // 第一座要小（換成金門大橋才看得出草地變大）。新天鵝堡最小 4450 塊，已經比橋大了
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 900;
    startBuild(true);                                   // 開場：取景
    const fit = { d: ENG.camTarget.dist, ty: ENG.camTarget.ty,
                  tx: ENG.camTarget.tx, tz: ENG.camTarget.tz };
    ENG.orbit(300, 0); ENG.zoom(-400); ENG.pan(1, 0.4, 1);   // 玩家自己動鏡頭
    const was = { d: ENG.camTarget.dist, ty: ENG.camTarget.ty,
                  tx: ENG.camTarget.tx, tz: ENG.camTarget.tz, yaw: ENG.cam.yaw };
    const arena0 = arenaR;
    shapePick = SHAPES.findIndex(s => s.n === '金門大橋');
    targetCnt = 2000; startBuild(false);                // 遊戲中換一座
    const now = { d: ENG.camTarget.dist, ty: ENG.camTarget.ty,
                  tx: ENG.camTarget.tx, tz: ENG.camTarget.tz, yaw: ENG.cam.yaw };
    const arena1 = arenaR;
    shapePick = sp0; targetCnt = tc0; startBuild(true);
    return { same: ['d', 'ty', 'tx', 'tz', 'yaw'].every(k => was[k] === now[k]),
             fit, was, now, moved: was.d !== fit.d || was.tx !== fit.tx,
             arena0: +arena0.toFixed(1), arena1: +arena1.toFixed(1) };
  });
  ok('換一座建築不會搶走鏡頭', keepView.same,
     '換之前 dist ' + keepView.was.d.toFixed(1) + '／tx ' + keepView.was.tx.toFixed(1) +
     '／yaw ' + keepView.was.yaw.toFixed(2) + '，換之後 dist ' + keepView.now.d.toFixed(1) +
     '／tx ' + keepView.now.tx.toFixed(1) + '／yaw ' + keepView.now.yaw.toFixed(2));
  ok('鏡頭不動，但草地範圍還是照新工地重算', keepView.arena1 > keepView.arena0 * 1.2,
     '場地半徑 ' + keepView.arena0 + ' → ' + keepView.arena1);
  /* 視線高在桌機是 0（v1.55 起看的是建築底部中心），所以這裡只能驗距離與圓心，
     不能再用 ty > 1 當「有取過景」的證據。 */
  ok('開場那一次還是會取景，鏡頭不會停在原點',
     keepView.fit.d > 20 && keepView.fit.ty === 0 &&
     keepView.fit.tx === 0 && keepView.fit.tz === 0 && keepView.moved,
     '開場取到 dist ' + keepView.fit.d.toFixed(1) + '、視線高 ' + keepView.fit.ty.toFixed(1) +
     '，玩家動過之後變成 dist ' + keepView.was.d.toFixed(1));

  await resetPan();
  await page.focus('#shape');
  await panBy('w', 200);
  const onSelect = await page.evaluate(() => {
    document.getElementById('shape').blur();
    return Math.hypot(ENG.camTarget.tx, ENG.camTarget.tz);
  });
  ok('焦點在建築下拉選單上時不搶鍵盤', onSelect < 0.01,
     '在選單上按 W，鏡頭移動 ' + onSelect.toFixed(2) + ' 單位');

  /* 按著 W 切去別的視窗，keyup 收不到，回來鏡頭會自己一直飄 */
  await resetPan();
  await page.keyboard.down('w');
  await page.waitForTimeout(150);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  const drift0 = await page.evaluate(() => Math.hypot(ENG.camTarget.tx, ENG.camTarget.tz));
  await page.waitForTimeout(250);
  const drift1 = await page.evaluate(() => Math.hypot(ENG.camTarget.tx, ENG.camTarget.tz));
  await page.keyboard.up('w');
  ok('視窗失焦會放開按鍵，鏡頭不會一直飄',
     drift0 > 0.5 && Math.abs(drift1 - drift0) < 0.01,
     '失焦當下 ' + drift0.toFixed(1) + '，再等 250ms 還是 ' + drift1.toFixed(1));

  await resetPan();
  await page.evaluate(r => { running = r; }, wasRunning);

  /* 取景測「使用者看到什麼」，而不是把相機公式抄一份到測試裡（那是拿實作驗實作） */
  const framing = await page.evaluate(() => {
    startBuild(true);
    for (let i = 0; i < bp.slots.length && i < blocks.length; i++) {
      const s = bp.slots[i], b = blocks[i];
      b.st = 3; b.x = s.x; b.y = s.y + HB; b.z = s.z;
    }
    for (let i = 0; i < 6; i++) ENG.updateCamera(1);
    const cam = ENG.three.camera; cam.updateMatrixWorld();
    const v = new THREE.Vector3();
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, off = 0, n = 0;
    for (const b of blocks) {
      if (b.st !== 3) continue;
      n++;
      v.set(b.x, b.y, b.z).project(cam);
      if (Math.abs(v.x) > 1 || Math.abs(v.y) > 1) off++;
      minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
      minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
    }
    return { fw: (maxX - minX) / 2, fh: (maxY - minY) / 2, off, n, name: bp.name };
  });
  ok('取景把整座建築放進畫面', framing.off === 0, framing.off + ' 塊在畫面外（' + framing.name + '）');
  ok('建築在畫面裡的比例合理',
     Math.max(framing.fw, framing.fh) > 0.30 && Math.max(framing.fw, framing.fh) < 0.99,
     '占畫面 ' + (Math.max(framing.fw, framing.fh) * 100).toFixed(0) + '%');

  /* 桌機開場的視線放在**建築底部中心**（工地原點），那一點要**剛好**落在畫面正中央
     （v1.55）。挑高的、矮的、寬的各一座：底部置中之後建築整個站在上半部，
     高的那幾座最容易被上緣切掉，所以同時驗「一塊都沒出界」。 */
  const baseMid = await page.evaluate(() => {
    const out = [];
    const v = new THREE.Vector3();
    for (const n of ['艾菲爾鐵塔', '台北 101', '大頭像', '吉薩金字塔', '金門大橋']) {
      shapePick = SHAPES.findIndex(s => s.n === n);
      targetCnt = 3000; startBuild(true);
      for (let k = 0; k < bp.slots.length && k < blocks.length; k++) {
        const s = bp.slots[k], b = blocks[k];
        b.st = 3; b.x = s.x; b.y = s.y + HB; b.z = s.z;
      }
      for (let k = 0; k < 6; k++) ENG.updateCamera(1);
      const cam = ENG.three.camera; cam.updateMatrixWorld();
      const base = v.set(0, 0, 0).project(cam).clone();
      let off = 0, top = -9;
      for (const b of blocks) {
        if (b.st !== 3) continue;
        v.set(b.x, b.y, b.z).project(cam);
        if (Math.abs(v.x) > 1 || Math.abs(v.y) > 1) off++;
        if (v.y > top) top = v.y;
      }
      out.push({ n: bp.name, x: +base.x.toFixed(3), y: +base.y.toFixed(3), off,
                 top: +top.toFixed(2), ty: +ENG.camTarget.ty.toFixed(2) });
    }
    shapePick = -1;
    return out;
  });
  ok('桌機開場：建築底部中心就在畫面正中央',
     baseMid.every(o => Math.abs(o.x) < 0.005 && Math.abs(o.y) < 0.005 && o.ty === 0),
     baseMid.map(o => o.n + ' (' + o.x + ',' + o.y + ')').join('、'));
  ok('底部置中之後上緣也沒切到建築',
     baseMid.every(o => o.off === 0 && o.top < 0.95),
     baseMid.map(o => o.n + ' 最高 ' + o.top + '／出界 ' + o.off).join('、'));

  /* 視線落到地面之後，畫面下緣那兩個角會打得很外面——草地島不夠大就會看到島的邊
     與底下那層土（艾菲爾鐵塔打到島半徑的 2.07 倍）。島要跟著補大。
     測的是「下緣三條射線打到地面的落點還在島上」，不是抄公式。 */
  const isleFit = await page.evaluate(() => {
    /* 草皮那顆網格直接向引擎拿（ENG.three.ground）。本來是掃整個場景找「材質顏色是那片綠」
       的那一顆——v1.90 草皮改成貼圖之後材質色變成白的，那樣找會找不到（踩過）。 */
    const isle = ENG.three.ground;
    const out = [];
    for (const n of ['艾菲爾鐵塔', '倫敦眼摩天輪', '台北 101', '金門大橋']) {
      shapePick = SHAPES.findIndex(s => s.n === n);
      targetCnt = 3000; startBuild(true);
      for (let k = 0; k < 6; k++) ENG.updateCamera(1);
      const cam = ENG.three.camera; cam.updateMatrixWorld();
      const half = isle.scale.x / 2;
      let worst = 0;
      for (const nx of [-1, 0, 1]) {
        const a = new THREE.Vector3(nx, -1, -1).unproject(cam);
        const c = cam.position, d = a.clone().sub(c).normalize();
        if (d.y >= -1e-6) continue;                     // 下緣朝天：打不到地面
        const p = c.clone().addScaledVector(d, -c.y / d.y);
        worst = Math.max(worst, Math.max(Math.abs(p.x), Math.abs(p.z)) / half);
      }
      out.push({ n: bp.name, half: Math.round(half), worst: +worst.toFixed(2) });
    }
    shapePick = -1;
    return out;
  });
  ok('畫面下緣看不到草地島的邊', isleFit.every(o => o.worst <= 1),
     isleFit.map(o => o.n + ' 島半徑 ' + o.half + '、下緣打到 ' + o.worst + ' 倍').join('、'));

  /* 轉鏡頭時碎料不會黑白亂跳（v1.160.1，使用者：「碎料有黑有白時轉動攝影機
     會有白黑抖動」）。落定的碎料都是軸向的、高度又完全一樣，兩塊斜著相鄰就會有
     一小塊重疊區的頂面共面，深度緩衝分不出前後——鏡頭一轉就換一個贏。
     修法是畫的時候讓碎料按編號各下沉一點點（見 game-ui.js 的 REST_SINK）。

     怎麼量：鏡頭**每次只轉 0.0004 rad（0.023°）**，真的邊緣只會移動 0.03 個像素，
     不可能讓一個像素的亮度翻過去；所以「亮度差超過 96 的像素」全都是共面在打架。
     同一份碎料排列跑兩次（先重下同一顆種子，位置一模一樣）：一次黑白相間、
     一次全白。全白那一次就是這台機器的地板（正常的邊緣移動）。
     實測：改之前黑白 380～592 個像素／幀，改之後 36～53，全白是 9～14。 */
  const shimmer = await page.evaluate(() => {
    running = false;
    targetCnt = 3000; shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    startBuild(true);
    const q = () => Math.round(Math.random() * 3) * Math.PI / 2;
    // 把整池壓成「躺在地上的碎料」——落定的碎料就是這個樣子（見 stepSnap）
    const layout = mono => {
      window.__seed(20250904);                 // 兩次的排列要一模一樣，只差顏色
      for (const b of blocks) if (b.cell) gridDel(b);
      let i = 0;
      for (const b of blocks) {
        b.st = 0; b.rest = true; b.holder = -1; b.slot = -1; b.snap = 0;
        b.gone = 0; b.hh = -1; b.burn = 0; b.wet = 0;
        b.vx = b.vy = b.vz = b.ax = b.ay = b.az = 0;
        const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * arenaR;
        b.x = Math.cos(a) * d; b.z = Math.sin(a) * d;
        b.rx = q(); b.ry = q(); b.rz = q();
        b.y = halfY(b);
        b.scale = 1; b.al = 1; b.wob = 0;
        const w = mono ? 1 : (i % 2);          // 一塊焦炭一塊白積木交錯
        b.r = b.tr = w ? 0.95 : 0.03;
        b.g = b.tg = w ? 0.95 : 0.03;
        b.b = b.tb = w ? 0.95 : 0.03;
        separate(b); gridAdd(b);
        i++;
      }
    };
    const cv = ENG.three.renderer.domElement, W = cv.width, H = cv.height;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    const scan = () => {
      ENG.cam.pitch = ENG.camTarget.pitch = 0.42;
      ENG.cam.dist = ENG.camTarget.dist = 46;
      ENG.cam.ty = ENG.camTarget.ty = 2;
      ENG.cam.tx = ENG.camTarget.tx = ENG.cam.tz = ENG.camTarget.tz = 0;
      let prev = null, flips = 0, n = 0;
      for (let k = 0; k < 10; k++) {
        ENG.cam.yaw = ENG.camTarget.yaw = 0.9 + k * 0.0004;
        ENG.orbit(0, 0); ENG.updateCamera(0);
        draw(); ENG.render();
        g.drawImage(cv, 0, 0);                 // 同一個 task 內畫完就抓（不然緩衝已經清掉）
        const d = g.getImageData(0, 0, W, H).data;
        const lum = new Uint8Array(W * H);
        for (let p = 0, j = 0; p < d.length; p += 4, j++)
          lum[j] = (d[p] * 77 + d[p + 1] * 151 + d[p + 2] * 28) >> 8;
        if (prev) {
          let m = 0;
          for (let j = 0; j < lum.length; j++) if (Math.abs(lum[j] - prev[j]) > 96) m++;
          flips += m; n++;
        }
        prev = lum;
      }
      return +(flips / Math.max(1, n)).toFixed(1);
    };
    layout(false); const bw = scan();
    layout(true);  const white = scan();
    shapePick = -1; startBuild(true);          // 世界還原，後面幾段還要用
    return { bw, white, px: W * H };
  });
  ok('黑白混雜的碎料，轉鏡頭時不會黑白亂跳（頂面共面沒有在打架）',
     shimmer.bw < 200 && shimmer.bw < shimmer.white * 12 + 30,
     '每轉 0.023°：黑白相間 ' + shimmer.bw + ' 個像素亮度翻轉、全白的對照組 ' +
     shimmer.white + ' 個（共 ' + shimmer.px + ' 像素；改之前是 380～592）');

  /* ══════════ 視窗縮放 ══════════ */
  await head('視窗縮放');
  await page.setViewportSize({ width: 900, height: 620 });
  await page.waitForTimeout(300);
  const rs = await page.evaluate(() => ({
    w: document.getElementById('cv').width, css: document.getElementById('cv').style.width,
    aspect: ENG.three.camera.aspect, dpr: Math.min(2, window.devicePixelRatio)
  }));
  ok('canvas 跟著視窗變', rs.w === Math.round(900 * rs.dpr) && rs.css === '900px', rs.w + ' / ' + rs.css);
  ok('相機比例跟著更新', Math.abs(rs.aspect - 900 / 620) < 0.01, rs.aspect.toFixed(3));
  const pSmall = await pix(page);
  ok('縮小後畫面仍然畫得出來', pSmall.opaque > 0.2 && pSmall.colors > 20,
     '不透明 ' + (pSmall.opaque * 100).toFixed(0) + '%、' + pSmall.colors + ' 種顏色');

  /* 取景距離跟畫面比例有關：轉成直式之後左右變窄，寬的地標得退更遠才框得住。
     resize 只更新 aspect 不重新取景的話，橫式轉直式就會把建築切掉。
     一定要挑又長又扁的金門大橋——高瘦的建築左右本來就不吃緊，轉向不該動距離，
     拿它來測會量到「沒變」然後誤判成壞掉。 */
  const prevShape = await page.evaluate(() => {
    const p = bp.idx; shapePick = 22; targetCnt = 900; startBuild(true); return p;
  });
  const distWide = await page.evaluate(() => ENG.camTarget.dist);
  await page.setViewportSize({ width: 620, height: 900 });
  await page.waitForTimeout(300);
  const distTall = await page.evaluate(() => ENG.camTarget.dist);
  ok('畫面比例變了會重新取景', distTall > distWide * 1.05,
     '金門大橋：橫式 ' + distWide.toFixed(1) + ' → 直式 ' + distTall.toFixed(1));
  await page.evaluate(i => { shapePick = i; startBuild(true); shapePick = -1; }, prevShape);

  /* 工具收成一顆小窗之後就不會撐寬了，但左上角的建築資訊卡還是會隨數字變寬。
     量之前一定要先把數字灌到最寬的狀態：累計金額變成七位數那一刻，
     資訊卡會從 266px 撐到 354px——用剛開新局的空帳號去量，會量到「沒撞到」的假象。 */
  await page.evaluate(() => {
    stats.destroyed = 128; stats.smashed = 987654; stats.spent = 1234567; stats.wrecked = 9876543;
    renderTools(); hudLast = 0; hudTick(performance.now());
  });
  /* 1025／1024 是斷點兩側的第一格（v1.110 從 1500 降成 1024）：1025 起工具列回到上方中央，
     而那裡剛好要閃過撐到最寬的資訊卡 */
  const widths = [1600, 1440, 1366, 1280, 1100, 1025, 1024, 900, 700];
  const clash = [];
  let statTxt = '', barAt = [];
  for (const w of widths) {
    await page.setViewportSize({ width: w, height: 800 });
    await page.waitForTimeout(120);
    const r = await page.evaluate(() => {
      const box = {};
      // 量的是收起來的小窗（toolbox）：選單平常是藏著的，不占版面
      for (const id of ['head', 'time', 'toolbox', 'panelBtn', 'ver']) {
        const e = document.getElementById(id);
        if (getComputedStyle(e).display !== 'none') box[id] = e.getBoundingClientRect();
      }
      const bad = [], keys = Object.keys(box);
      for (let i = 0; i < keys.length; i++)
        for (let j = i + 1; j < keys.length; j++) {
          const a = box[keys[i]], b = box[keys[j]];
          if (a.right > b.left && b.right > a.left && a.bottom > b.top && b.bottom > a.top)
            bad.push(keys[i] + '×' + keys[j]);
        }
      return { bad, headW: Math.round(box.head.width), top: Math.round(box.toolbox.top),
               out: box.toolbox.left < -1 || box.toolbox.right > window.innerWidth + 1,
               txt: document.getElementById('stat').textContent.replace(/\s+/g, ' ').trim() };
    });
    statTxt = r.txt;
    barAt.push(w + '→' + (r.top < 200 ? '上' : '下'));
    if (r.bad.length) clash.push(w + 'px：' + r.bad.join('、'));
    if (r.out) clash.push(w + 'px：工具列超出畫面');
  }
  ok('量的時候資訊卡確實是最寬的狀態', /累計\s*\$1,234,567/.test(statTxt), statTxt);
  ok('桌機縮視窗，工具列不會壓到資訊卡', clash.length === 0,
     clash.join(' / ') || '工具列位置：' + barAt.join('、'));
  /* v1.110：以前是「窄於 1500 就把工具搬到下緣」，於是一般筆電（1920 開 125% 縮放是 1536、
     150% 是 1280）看到的都是手機那一套版面。現在只有真的很窄才搬。 */
  const barBad = widths.filter((w, i) => barAt[i].endsWith('上') !== (w > 1024));
  ok('工具列只有窄視窗才在下緣，筆電寬度跟桌機一樣在上面', barBad.length === 0,
     barAt.join('、'));
  await page.evaluate(() => { stats = freshStats(); renderTools(); hudLast = 0; hudTick(performance.now()); });

  /* 平板橫放是 1180～1366px，寬度看起來跟筆電沒兩樣——那種要靠「沒有滑鼠」認出來
     （hover:none + pointer:coarse），只看寬度的話工具列會跑到上面去。 */
  const padPage = await newPage({ viewport: { width: 1194, height: 834 }, hasTouch: true });
  await padPage.goto(APP);
  await padPage.waitForFunction(() => typeof ENG !== 'undefined' && typeof bp !== 'undefined' && bp);
  const padUi = await padPage.evaluate(() => ({
    hover: matchMedia('(hover:none)').matches, coarse: matchMedia('(pointer:coarse)').matches,
    top: Math.round(document.getElementById('toolbox').getBoundingClientRect().top),
    h: window.innerHeight,
    panel: Math.round(document.getElementById('panelBtn').getBoundingClientRect().left),
    ver: Math.round(document.getElementById('ver').getBoundingClientRect().left)
  }));
  await padPage.close();
  ok('平板橫放（1194px、沒有滑鼠）工具列還是在下緣',
     padUi.hover && padUi.coarse && padUi.top > padUi.h - 120 &&
     padUi.panel > 1194 / 2 && padUi.ver < 100,
     'hover:none ' + padUi.hover + '、pointer:coarse ' + padUi.coarse +
     '、工具列 top ' + padUi.top + '（視窗高 ' + padUi.h + '）' +
     '、設定鈕 left ' + padUi.panel + '、版本號 left ' + padUi.ver);

  /* ══════════ 手機版 ══════════ */
  await head('手機版 · 觸控');
  await page.setViewportSize({ width: 390, height: 780 });
  await page.waitForTimeout(300);
  const mob = await page.evaluate(() => {
    const hint = getComputedStyle(document.getElementById('hint')).display;
    const panel = document.getElementById('panel').getBoundingClientRect();
    return { hint, panelW: Math.round(panel.width), inside: panel.right <= window.innerWidth + 1 };
  });
  ok('小螢幕會收掉操作提示', mob.hint === 'none', mob.hint);
  ok('設定面板不會超出畫面', mob.inside, '面板寬 ' + mob.panelW + '，視窗寬 390');

  /* 手機版空間很擠，按鈕互相疊到就點不到了——直接量方框有沒有相交 */
  const overlap = await page.evaluate(() => {
    const ids = ['head', 'time', 'toolbox', 'panelBtn', 'ver'];
    const box = {};
    for (const id of ids) {
      const e = document.getElementById(id);
      if (getComputedStyle(e).display === 'none') continue;
      box[id] = e.getBoundingClientRect();
    }
    const bad = [], keys = Object.keys(box);
    for (let i = 0; i < keys.length; i++)
      for (let j = i + 1; j < keys.length; j++) {
        const a = box[keys[i]], b = box[keys[j]];
        if (a.right > b.left && b.right > a.left && a.bottom > b.top && b.bottom > a.top)
          bad.push(keys[i] + '×' + keys[j]);
      }
    // 展開的選單也要留在畫面內——手機上它是往上開的，寬度受限於三欄
    document.getElementById('toolbox').classList.add('open');
    const menu = document.getElementById('tools').getBoundingClientRect();
    document.getElementById('toolbox').classList.remove('open');
    const out = keys.filter(k => box[k].right > window.innerWidth + 1 || box[k].left < -1);
    return { bad, out, toolsW: Math.round(box.toolbox.width),
             menu: { w: Math.round(menu.width), l: Math.round(menu.left),
                     r: Math.round(menu.right), t: Math.round(menu.top) } };
  });
  ok('手機版的 UI 不會互相疊到', overlap.bad.length === 0, overlap.bad.join('、') || '五個區塊都沒相交');
  ok('手機版工具小窗不會超出畫面', overlap.out.length === 0,
     '小窗寬 ' + overlap.toolsW + '，視窗寬 390' + (overlap.out.length ? '；超出：' + overlap.out.join(',') : ''));
  ok('手機版展開的工具選單也在畫面內',
     overlap.menu.l >= 0 && overlap.menu.r <= 390 && overlap.menu.t >= 0,
     '選單寬 ' + overlap.menu.w + '，左 ' + overlap.menu.l + '、右 ' + overlap.menu.r +
     '、上 ' + overlap.menu.t);
  const pMob = await pix(page);
  ok('手機尺寸下照樣畫得出來', pMob.opaque > 0.4, (pMob.opaque * 100).toFixed(0) + '%');
  await page.screenshot({ path: path.join(OUT, '06-手機版.png') });

  const touch = await page.evaluate(() => {
    tool = 'hammer';                     // 同上：拿水桶拖曳是澆水，不是轉視角
    const y0 = ENG.cam.yaw;
    const cv = document.getElementById('cv');
    const mk = (t, x, y) => { const e = new Event(t, { bubbles: true, cancelable: true }); e.touches = [{ clientX: x, clientY: y }]; return e; };
    cv.dispatchEvent(mk('touchstart', 200, 400));
    cv.dispatchEvent(mk('touchmove', 260, 400));
    cv.dispatchEvent(mk('touchmove', 320, 410));
    cv.dispatchEvent(mk('touchend', 320, 410));
    return { d: ENG.cam.yaw - y0 };
  });
  ok('單指拖曳可以轉視角', Math.abs(touch.d) > 0.05, '轉了 ' + (touch.d * 57.3).toFixed(1) + '°');

  /* 觸控之後瀏覽器會補送一組 mousedown／mouseup（給沒寫觸控的網頁用的相容事件）。
     兩組都收的話手機上點一下等於用了兩次道具——同一個位置兩顆隕石、兩台投石機，
     而點兩下才發動的保齡球與龍捲風會在原地立刻發動（第一點就是第二點）。 */
  const ghost = await page.evaluate(() => {
    const keep = tool;
    const cv = document.getElementById('cv');
    const mkT = (t, x, y) => {
      const e = new Event(t, { bubbles: true, cancelable: true });
      e.touches = t === 'touchend' ? [] : [{ clientX: x, clientY: y }];
      return e;
    };
    const mkM = (t, x, y) => new MouseEvent(t, { bubbles: true, clientX: x, clientY: y });
    /* 真的用手指點一下：touchstart → touchend，接著瀏覽器補的那一組滑鼠事件 */
    const tap = (x, y) => {
      cv.dispatchEvent(mkT('touchstart', x, y));
      cv.dispatchEvent(mkT('touchend', x, y));
      cv.dispatchEvent(mkM('mousedown', x, y));
      window.dispatchEvent(mkM('mouseup', x, y));
    };
    tool = 'meteor'; meteors = null;
    tap(195, 470);
    const met = meteors ? meteors.length : 0;
    meteors = null; ENG.putMeteors([]);

    tool = 'treb'; trebs = null;
    tap(195, 470);
    const treb = trebs ? trebs.list.length : 0;
    trebs = null; ENG.putTrebs([]); ENG.putRocks([]);

    /* 手機也要跟桌機同一套操作：兩點式的工具點兩下才發動，
       第一下只是選地點（相容事件如果沒擋掉，第一下就會自己變成兩下）。 */
    tool = 'tornado'; twists = null; aim = null;
    tap(150, 470);
    const midAim = !!aim, mid = twists ? twists.length : 0;
    tap(260, 500);
    const after = twists ? twists.length : 0;
    twists = null; ENG.putTornados([]); aim = null;

    tool = 'ball'; balls = null; aim = null;
    tap(150, 470);
    const ballMid = !!balls;
    tap(260, 500);
    const ballAfter = !!balls;
    balls = null; ENG.putBalls([]); aim = null;
    tool = keep;
    return { met, treb, midAim, mid, after, ballMid, ballAfter };
  });
  ok('手機上點一下地板只算一次，不會變成兩顆隕石、兩台投石機',
     ghost.met === 1 && ghost.treb === 1,
     '點一下 → 隕石 ' + ghost.met + ' 顆、投石機 ' + ghost.treb + ' 台');
  ok('兩點式的工具在手機上也是點兩下（跟桌機同一套操作）',
     ghost.midAim && ghost.mid === 0 && ghost.after === 1 &&
     !ghost.ballMid && ghost.ballAfter,
     '第一下：龍捲風 ' + ghost.mid + ' 道、球還沒出手；第二下：龍捲風 ' + ghost.after + ' 道、球出手了');

  /* 直式手機的水平視角比垂直窄得多，取景只算垂直 fov 的話寬的地標會被切掉：
     修之前 36 座有 24 座出界，金門大橋溢出六成。挑最寬的四座來守。 */
  const portraitFit = await page.evaluate(() => {
    const out = [];
    const v = new THREE.Vector3();
    for (const i of [22, 8, 33, 16]) {          // 金門大橋、萬里長城、嚴島神社鳥居、巨石陣
      shapePick = i; targetCnt = 3000; startBuild(true);
      for (let k = 0; k < bp.slots.length && k < blocks.length; k++) {
        const s = bp.slots[k], b = blocks[k];
        b.st = 3; b.x = s.x; b.y = s.y + HB; b.z = s.z;
      }
      for (let k = 0; k < 6; k++) ENG.updateCamera(1);      // dt=1 一次就收斂到目標距離
      const cam = ENG.three.camera;
      let worst = 0;
      for (let a = 0; a < 4; a++) {
        ENG.cam.yaw = a * Math.PI / 2 + 0.4;                // 長條形建築要轉一圈才量得到最寬那面
        ENG.updateCamera(0); cam.updateMatrixWorld();
        for (const s of bp.slots) {
          v.set(s.x, s.y + HB, s.z).project(cam);
          worst = Math.max(worst, Math.abs(v.x), Math.abs(v.y));
        }
      }
      out.push({ n: bp.name, worst });
    }
    shapePick = -1;
    return out;
  });
  const pWorst = portraitFit.reduce((a, r) => Math.max(a, r.worst), 0);
  ok('直式手機也框得住最寬的地標', pWorst < 1,
     portraitFit.map(r => r.n + ' ' + r.worst.toFixed(2)).join('、') + '（1 = 貼齊畫面邊）');

  /* 手機版的取景**維持原樣**（v1.55 只改桌機）：視線還是放在建築腰間（0.44×高 + 1.5），
     底部中心因此落在畫面中央的下方。畫面高瘦，再把建築整個推到上半部會小到看不清楚。 */
  const mobFit = await page.evaluate(() => {
    const out = [];
    const v = new THREE.Vector3();
    for (const n of ['艾菲爾鐵塔', '台北 101', '大頭像']) {
      shapePick = SHAPES.findIndex(s => s.n === n);
      targetCnt = 3000; startBuild(true);
      for (let k = 0; k < 6; k++) ENG.updateCamera(1);
      const cam = ENG.three.camera; cam.updateMatrixWorld();
      out.push({ n: bp.name, ty: +ENG.camTarget.ty.toFixed(1),
                 want: +(bp.height * 0.44 + 1.5).toFixed(1),
                 y: +v.set(0, 0, 0).project(cam).y.toFixed(2) });
    }
    shapePick = -1;
    return out;
  });
  ok('手機版的視線還是看腰間，底部中心在中央下方',
     mobFit.every(o => Math.abs(o.ty - o.want) < 0.05 && o.y < -0.1),
     mobFit.map(o => o.n + ' 視線高 ' + o.ty + '、底部中心 NDC y=' + o.y).join('、'));

  /* 霧是給遠方地平線的，不能連建築本身一起吃掉。相機退得遠時霧沒跟著往後推的話，
     整座建築會白掉——直式手機的金門大橋要退到 460，而霧原本只到 316，吃霧 100%。
     直式是最嚴苛的情況（退得最遠），這裡守住桌機也不會出事。 */
  const fogHit = await page.evaluate(() => {
    let worst = -Infinity, name = '';       // 全都沒吃到霧時，也要記得住是哪一座最接近
    for (let i = 0; i < SHAPES.length; i++) {
      shapePick = i; targetCnt = 1500; startBuild(true);
      const f = ENG.three.scene.fog;
      // 建築中心到相機的距離就是取景距離，量它落在霧的哪一段
      const amt = (ENG.camTarget.dist - f.near) / (f.far - f.near);
      if (amt > worst) { worst = amt; name = bp.name; }
    }
    shapePick = -1;
    return { worst, name };
  });
  ok('霧不會把建築本身吃掉', fogHit.worst < 0.15,
     '最重的是 ' + fogHit.name + '，建築中心吃霧 ' +
     (Math.max(0, fogHit.worst) * 100).toFixed(0) + '%');

  await page.setViewportSize(VIEW);
  await page.waitForTimeout(200);

  /* ══════════ 效能（CPU 端） ══════════ */
  await head('效能');
  const perf = await page.evaluate(() => {
    running = false;
    const rows = [];
    for (const [cnt, wk] of [[900, 20], [3000, 60], [10000, 20]]) {
      targetCnt = cnt; shapePick = 0; setWorkerCount(wk); startBuild(true);
      for (let i = 0; i < 240; i++) step(0.016);
      let t = performance.now();
      for (let i = 0; i < 120; i++) step(0.016);
      const s = (performance.now() - t) / 120;
      t = performance.now();
      for (let i = 0; i < 120; i++) draw();
      const d = (performance.now() - t) / 120;
      rows.push({ blocks: blocks.length, wk: workers.length, step: s, draw: d });
    }
    return rows;
  });
  for (const r of perf)
    ok(r.blocks + ' 塊積木 + ' + r.wk + ' 小人：CPU 每幀 < 4ms',
       r.step + r.draw < 4,
       'step ' + r.step.toFixed(2) + 'ms + draw ' + r.draw.toFixed(2) + 'ms = ' +
       (r.step + r.draw).toFixed(2) + 'ms（CPU 上限約 ' + Math.round(1000 / (r.step + r.draw)) + ' fps）');

  /* 推土機鏟子前那一坨（v1.151.2，使用者：「9000 塊積木時一排推土機推過去有降 FPS」）。
     一排推土機是照工地寬度鋪滿的（最多 30 台），每台每幀把鏟面前那一坨碎料都
     nudgeApart 一次——實測 9000 塊的泰姬瑪哈陵一幀要 nudge 1300～2500 塊，
     整個 step() 有 93～99% 的時間耗在這條路上。

     **不跑真的整地流程**：那要先蓋 9000 塊再一路砸到換場，一趟二三十秒，
     為了一條效能門檻讓整輪多跑一分半不划算。改成直接對這支函式做微基準——
     造一坨密度跟鏟子前那一坨一樣的碎料（實測每格中位 5～6 塊、最密 12～20 塊），
     量「擠開一塊要幾微秒」。

     **門檻是相對的，不是絕對的**：wall clock 換一台機器就整組平移（見〈九條偶爾飄的
     測試〉）。所以把 v1.151.1 那一版原封不動放進來當**對照組**，同一坨碎料、同一輪
     JIT 之下比兩者的比值——這樣守的是「這個優化沒有被改回去」，跟機器多快無關。
     絕對值那一條放得很寬，只擋「兩邊都變慢」。
     實測（同一坨）：舊 1.58～2.02 µs／次、v1.151.2 是 0.76～0.87。
     v1.160.1 之後同一坨上比舊寫法快 **4.0～5.3 倍**（兩輪各量到 1.6 → 0.40
     與 2.71 → 0.51 µs／次；絕對值兩輪就差這麼多，所以門檻只看比值）。

     v1.160.1 起對照組**讀自己那一份字串 key 的格子表**（strGrid）：那一版的 key 是
     'cx:cz' 字串，而現在 restGrid 存的是整數 key（見 game.js 的 gcell）——
     讓它照舊去查 restGrid 只會一格都查不到，變成「零鄰居的空轉」，比什麼都快。
     同一坨碎料、同樣的順序各建一份，比的才是同一件事。 */
  const nudgePerf = await page.evaluate(() => {
    running = false;
    /* v1.151.1 之前那一版：Math.hypot 算每一對鄰居的距離、ENG.BS 每次現查、
       3×3 的 key 每格重組一次字串、for...of 每格配一個迭代器。 */
    const strGrid = new Map();
    const OLD = function (b, lim) {
      if (lim <= 0) return;
      const cx = Math.floor(b.x / CELL), cz = Math.floor(b.z / CELL);
      let px = 0, pz = 0;
      for (let i = -1; i <= 1; i++) for (let k = -1; k <= 1; k++) {
        const a = strGrid.get((cx + i) + ':' + (cz + k)); if (!a) continue;
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
    };
    targetCnt = 1800; shapePick = 0; startBuild(true); completeNow(); shapePick = -1;
    for (const b of blocks) if (b.cell) gridDel(b);
    const pile = [];
    /* 造一坨。spread 給半徑：11 是一般的碎料場（每格中位 5～6），
       4 是鏟面前被推成一道牆的那一坨（每格幾十塊，見 v1.160.1）。 */
    /* 現在這一版，但鄰居照 **3×3** 掃——其餘一個字都沒改。用來驗「2×2 少掃的
       那五格真的貢獻 0」。**不能拿上面那個 OLD 當對照**：它是 v1.151.1，用的是
       `Math.hypot`，而 v1.151.2 已經換成 `Math.sqrt(d2)`——兩者差在最後一兩個尾數，
       本來就不可能逐位相同（實測拿它比只有 1287/1500，一開始就是這樣誤判的）。 */
    const WIDE = function (b, lim) {
      if (lim <= 0) return;
      const BS = ENG.BS, BS2 = BS * BS;
      const cx = Math.floor(b.x / CELL), cz = Math.floor(b.z / CELL);
      let px = 0, pz = 0;
      for (let i = -1; i <= 1; i++) {
        const pre = (cx + i + 4096) * 8192 + 4097;
        for (let k = -1; k <= 1; k++) {
          const a = restGrid.get(pre + cz + k); if (!a) continue;
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
    };
    const build = spread => {
      /* 格子表整份重建（v1.160.1）。這一段跑在一千多條測試之後，restGrid 裡會有
         別段直接搬過積木留下的殘渣——實測到 271 個「不在這一坨裡、b.cell 也對不上
         自己那一格」的項目（開頭那一輪 gridDel 掃不掉它們，因為它照 b.cell 去找）。
         那些殘渣會讓這一坨的密度失真（實測每格中位掉到 1），量出來的就不是
         「鏟面前那一坨」的成本。 */
      restGrid.clear();
      for (const b of blocks) b.cell = '';
      strGrid.clear();
      for (const b of pile) {
        b.x = (Math.random() * 2 - 1) * spread; b.z = (Math.random() * 2 - 1) * spread;
        gridAdd(b);
      }
      for (const b of pile) {
        const k = Math.floor(b.x / CELL) + ':' + Math.floor(b.z / CELL);
        let a = strGrid.get(k); if (!a) strGrid.set(k, a = []);
        a.push(b);                       // 順序要跟 restGrid 那一份一樣，加總才逐位相同
      }
      const occ = [];
      for (const a of restGrid.values()) if (a.length) occ.push(a.length);
      occ.sort((p, q) => p - q);
      return { med: occ[occ.length >> 1] || 0, max: occ[occ.length - 1] || 0 };
    };
    for (let i = 0; i < 1500 && i < blocks.length; i++) {
      const b = blocks[i];
      b.st = 0; b.rest = true; b.holder = -1; b.slot = -1; b.y = 0.5;
      pile.push(b);
    }
    /* 「結果完全一樣」得自己驗（v1.160.1）：2×2 少掃的那五格，格子邊界本身就離 b
       超過 BS，所以那裡面的東西一律會被 d2 >= BS2 丟掉——鄰居是同一組、加總順序
       也還是「x 由小到大、再 z 由小到大」，所以連浮點的尾數都該一樣。
       每一塊都從快照的位置出發（不讓前一塊的位移影響下一塊），兩種寫法各算一次，
       逐塊比 x 與 z 的**位元**。鬆的、密的各驗一遍。 */
    const equal = spread => {
      const occ = build(spread);
      const snap = pile.map(b => ({ x: b.x, z: b.z }));
      const run = fn => pile.map((b, i) => {
        b.x = snap[i].x; b.z = snap[i].z;
        fn(b, 0.2);
        const r = { x: b.x, z: b.z };
        b.x = snap[i].x; b.z = snap[i].z;
        return r;
      });
      const a = run(WIDE), c = run(nudgeApart);
      let same = 0, moved = 0;
      for (let i = 0; i < pile.length; i++) {
        if (a[i].x !== snap[i].x || a[i].z !== snap[i].z) moved++;
        if (a[i].x === c[i].x && a[i].z === c[i].z) same++;
      }
      return { occ, same, moved, n: pile.length };
    };
    const eqLoose = equal(11), eqTight = equal(4);
    const occ = build(11);
    const bench = (fn, reps) => {
      const t = performance.now();
      for (let r = 0; r < reps; r++) for (let i = 0; i < pile.length; i++) fn(pile[i], 0.2);
      return (performance.now() - t) / (reps * pile.length) * 1000;      // µs／次
    };
    bench(OLD, 1); bench(nudgeApart, 1);            // 暖機：兩邊都讓 JIT 編過
    const oldMs = [], nowMs = [];
    for (let k = 0; k < 3; k++) {
      oldMs.push(+bench(OLD, 3).toFixed(3));
      nowMs.push(+bench(nudgeApart, 3).toFixed(3));
    }
    const med = a => a.slice().sort((p, q) => p - q)[1];
    return { old: oldMs, now: nowMs, oldMed: med(oldMs), nowMed: med(nowMs),
             n: pile.length, occMed: occ.med, occMax: occ.max, eqLoose, eqTight };
  });
  ok('推土機鏟子前那一坨擠開得夠便宜（nudgeApart 比 v1.151.1 快三成以上）',
     nudgePerf.nowMed < nudgePerf.oldMed * 0.7 && nudgePerf.nowMed < 3,
     '一坨 ' + nudgePerf.n + ' 塊（每格中位 ' + nudgePerf.occMed + '、最密 ' +
     nudgePerf.occMax + '）：舊寫法 ' + nudgePerf.old.join('／') + '、現在 ' +
     nudgePerf.now.join('／') + ' µs／次（中位 ' + nudgePerf.oldMed + ' → ' +
     nudgePerf.nowMed + '，快 ' + (nudgePerf.oldMed / nudgePerf.nowMed).toFixed(2) + ' 倍）');
  ok('只掃 2×2 的 nudgeApart 跟同一版的 3×3 算出來逐位相同（鬆的與密的都驗）',
     nudgePerf.eqLoose.same === nudgePerf.eqLoose.n &&
     nudgePerf.eqTight.same === nudgePerf.eqTight.n &&
     nudgePerf.eqLoose.moved > nudgePerf.eqLoose.n * 0.5 &&
     nudgePerf.eqTight.moved > nudgePerf.eqTight.n * 0.9,
     '鬆的（每格最密 ' + nudgePerf.eqLoose.occ.max + '）' + nudgePerf.eqLoose.same + '/' +
     nudgePerf.eqLoose.n + ' 相同、其中 ' + nudgePerf.eqLoose.moved + ' 塊真的被推動；' +
     '密的（最密 ' + nudgePerf.eqTight.occ.max + '）' + nudgePerf.eqTight.same + '/' +
     nudgePerf.eqTight.n + ' 相同、' + nudgePerf.eqTight.moved + ' 塊被推動');

  /* 塵霧最壞的一幕（v1.123）：三朵烏雲（一朵 700 團）＋ 一發核彈的蘑菇雲與火苗煙。
     兩件事一起驗——**都畫得出來**（MAXDUST 3400 是照這一幕訂的；砍在 2200 的話
     第三朵烏雲會整朵不見，因為烏雲接在 dust 後面、被切掉的是清單尾巴），
     以及**畫得起**（顆粒同時變小，覆蓋度沒怎麼動，所以變貴的只有 CPU 那一段）。 */
  const perfDust = await page.evaluate(() => {
    running = false;
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = 3000; setWorkerCount(20); startBuild(true); completeNow(); shapePick = -1;
    for (let i = 0; i < 60; i++) step(0.016);
    /* 量三段取中位（v1.148.1）：這是牆上時鐘，一輪二十分鐘的測試裡總會撞上一次
       排程／GC。同一條在 v1.147 那一輪量到過 2.05、v1.148 那一輪 2.17，而門檻是 2
       ——都是同一份程式碼。一段變慢不算，三段都慢才算。 */
    const bench = () => {
      const got = [];
      for (let k = 0; k < 3; k++) {
        for (let i = 0; i < 20; i++) draw();
        const t = performance.now();
        for (let i = 0; i < 80; i++) draw();
        got.push((performance.now() - t) / 80);
      }
      return got.sort((a, b) => a - b)[1];
    };
    const idle = bench();
    for (const p of [{ x: -20, z: 0 }, { x: 20, z: 0 }, { x: 0, z: 24 }]) callStorm(p);
    startCloud({ x: 0, y: 0, z: 0 }, 30);
    for (let i = 0; i < 200; i++) step(0.016);       // 聚滿三朵雲 ＋ 蘑菇撐開
    const want = dustList().length;
    const full = bench(), drawn = ENG.three.dustMesh.count;
    cleanTools();
    return { idle, full, want, drawn, cap: ENG.MAXDUST };
  });
  ok('三朵烏雲 ＋ 一發核彈，所有塵霧都畫得出來',
     perfDust.want === perfDust.drawn && perfDust.want > 3000,
     '要畫 ' + perfDust.want + ' 顆、實際畫 ' + perfDust.drawn +
     ' 顆（上限 ' + perfDust.cap + '）');
  ok('那一幕的 draw 仍然遠低於每幀預算', perfDust.full < 2,
     '沒有塵霧 ' + perfDust.idle.toFixed(2) + 'ms → 這一幕 ' + perfDust.full.toFixed(2) +
     'ms（每幀預算 4ms）');

  /* 建材開到一萬之後最貴的場面不是靜態，而是「拆到一半」：垮塌連鎖會一直把支撐
     標記成 dirty，於是每幀都要重算一次連通性（一萬塊時單次 4.1ms，三千塊時 1.4ms）。
     單次重算會讓某幾幀超過預算，但它每幀最多跑一次，平均仍然遠低於 4ms。
     實測（吉薩金字塔連續地震）：3000 塊平均 0.78ms／最壞 5.8ms，
     10000 塊平均 2.08ms／最壞 7.2ms——用 60fps 的 16.7ms 看都還很寬。 */
  const perfWreck = await page.evaluate(() => {
    running = false;
    shapePick = SHAPES.findIndex(s => s.n === '吉薩金字塔');
    targetCnt = CNT_MAX; setWorkerCount(20); startBuild(true); completeNow();
    let worst = 0, sum = 0, n = 0;
    for (let k = 0; k < 40; k++) {
      startQuake({ x: 0, y: 0, z: 0 });
      for (let i = 0; i < 6; i++) {
        const t = performance.now();
        step(0.02); draw();
        const ms = performance.now() - t;
        worst = Math.max(worst, ms); sum += ms; n++;
      }
    }
    const r = { blocks: blocks.length, avg: sum / n, worst };
    targetCnt = 3000; shapePick = -1; startBuild(true); completeNow();
    return r;
  });
  /* 門檻放寬到 6ms／60ms：這一段本身就有 ±70% 的機器抖動（同一台機器實測平均
     2.07～3.53ms、最壞單幀 7.2～16.2ms，看有沒有別的 node 行程在跑）。
     要守的是「不要出現數量級的退步」，不是把數字釘在某一次量到的值上。 */
  ok('一萬塊拆到一半（垮塌連鎖 + 支撐重算）：平均每幀還在預算內',
     perfWreck.avg < 6 && perfWreck.worst < 60,
     perfWreck.blocks + ' 塊：平均 ' + perfWreck.avg.toFixed(2) + 'ms、最壞單幀 ' +
     perfWreck.worst.toFixed(1) + 'ms（60fps 的預算是 16.7ms）');

  /* 最貴的一幀是核彈剛炸完：三千塊碎料在飛，加上滿場的火球與蘑菇雲粒子。
     粒子上限從 420 拉到 560、又多了一組火球，這裡守住它沒有把成本翻上去。 */
  const perfBoom = await page.evaluate(() => {
    targetCnt = 3000; shapePick = 0; setWorkerCount(40); startBuild(true); completeNow();
    callNuke({ x: 0, z: 0 });
    for (let i = 0; i < 60; i++) step(0.016 * 3);       // 推到爆炸後不久
    const parts = dust.length + hot.length;
    let t = performance.now();
    for (let i = 0; i < 90; i++) step(0.016);
    const s = (performance.now() - t) / 90;
    t = performance.now();
    for (let i = 0; i < 90; i++) draw();
    const d = (performance.now() - t) / 90;
    return { step: s, draw: d, parts, blocks: blocks.length };
  });
  ok('核彈爆炸當下：CPU 每幀 < 4ms', perfBoom.step + perfBoom.draw < 4,
     perfBoom.blocks + ' 塊積木 + ' + perfBoom.parts + ' 顆粒子：step ' +
     perfBoom.step.toFixed(2) + 'ms + draw ' + perfBoom.draw.toFixed(2) + 'ms = ' +
     (perfBoom.step + perfBoom.draw).toFixed(2) + 'ms');

  const bpTime = await page.evaluate(() => {
    let worst = 0, name = '';
    for (let i = 0; i < SHAPES.length; i++) {
      const t = performance.now();
      makeBlueprint(i, 3000);
      const d = performance.now() - t;
      if (d > worst) { worst = d; name = SHAPES[i].n; }
    }
    return { worst, name };
  });
  ok('換建築不會卡住畫面（最慢的藍圖 < 250ms）', bpTime.worst < 250,
     bpTime.name + ' ' + bpTime.worst.toFixed(0) + 'ms');

  /* ══════════ 連續操作壓力 ══════════ */
  await head('連續操作壓力');
  errors.length = 0;
  const stress = await page.evaluate(() => {
    running = false;
    for (let round = 0; round < 12; round++) {
      shapePick = round % SHAPES.length;
      targetCnt = [400, 900, 1800, 3000][round % 4];
      setWorkerCount([3, 20, 45, 60][round % 4]);
      startBuild(true);
      for (let i = 0; i < 120; i++) step(0.05);
      // 邊蓋邊砸
      const cand = blocks.filter(b => b.st === 3);
      if (cand.length) {
        const t = cand[Math.floor(Math.random() * cand.length)];
        smash(new THREE.Vector3(t.x, t.y, t.z), new THREE.Vector3(0.3, -0.9, 0.2).normalize());
      }
      for (let i = 0; i < 120; i++) step(0.05);
    }
    for (let i = 0; i < 900; i++) step(0.05);
    let bad = 0;
    for (const b of blocks) if (!isFinite(b.x) || !isFinite(b.y) || !isFinite(b.z)) bad++;
    return { pool: blocks.length, total: bp.slots.length, bad,
             fly: blocks.filter(b => b.st === 4).length,
             orphanSlot: bp.slots.filter(s => s.claimed >= 0 && !workers[s.claimed]).length,
             // 家的積木不算在池子裡（v1.97）：那些是從地上挖出來的，不是這一座的建材
             pool2: blocks.filter(b => b.hh < 0).length,
             ghostCarry: blocks.filter(b => b.st === 1 && b.holder < 0).length };
  });
  ok('連換 12 座 + 邊蓋邊砸，沒有例外', errors.length === 0, errors.slice(0, 2).join(' | '));
  ok('積木池沒有失控膨脹', stress.pool2 <= stress.total + 4,
     '池 ' + stress.pool2 + '，藍圖需要 ' + stress.total +
     (stress.pool === stress.pool2 ? '' : '（另有 ' + (stress.pool - stress.pool2) +
      ' 塊是小人的家，不算在池子裡）'));
  ok('沒有座標變成 NaN', stress.bad === 0, stress.bad + ' 塊');
  ok('沒有無主的搬運中積木', stress.ghostCarry === 0, stress.ghostCarry + ' 塊');
  ok('沒有被幽靈小人占住的位置', stress.orphanSlot === 0, stress.orphanSlot + ' 個');

  const memGrow = await page.evaluate(() => {
    const before = blocks.length + workers.length * ENG.WPARTS + dust.length;
    for (let r = 0; r < 6; r++) { startBuild(true); for (let i = 0; i < 200; i++) step(0.05); }
    return { before, after: blocks.length + workers.length * ENG.WPARTS + dust.length };
  });
  ok('反覆重建不會累積物件', memGrow.after < memGrow.before * 2 + 200,
     memGrow.before + ' → ' + memGrow.after);

  /* ══════════ 檔案沒放齊的防呆 ══════════ */
  await head('檔案沒放齊的防呆');
  /* 把遊戲寄給別人，對方直接在壓縮檔裡按兩下 index.html——Windows 只解出那一支檔，
     旁邊的 lib／src 都不在，畫面就只剩 body 的漸層背景，看起來像遊戲自己壞了。
     這裡真的做殘缺的複本去開，驗證會蓋出說明而不是一片空白。 */
  const copyInto = (rel, dir) => {
    const from = path.join(ROOT, rel), to = path.join(dir, rel);
    if (fs.statSync(from).isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      for (const e of fs.readdirSync(from)) copyInto(path.join(rel, e), dir);
    } else fs.copyFileSync(from, to);
  };
  const brokenCase = (tag, build) => {
    const d = path.join(OUT, 'broken-' + tag);
    fs.rmSync(d, { recursive: true, force: true });
    fs.mkdirSync(d, { recursive: true });
    copyInto('index.html', d);
    build(d);
    return 'file:///' + path.join(d, 'index.html').replace(/\\/g, '/');
  };
  const readFatal = async url => {
    const p = await newPage({ viewport: VIEW });
    await p.goto(url);
    await p.waitForTimeout(700);
    const r = await p.evaluate(() => {
      const f = document.getElementById('fatal');
      const mid = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
      return { shown: !!f, text: f ? f.innerText : '',
               /* 掃到 DOM 不等於使用者看得到：畫面正中央點下去要真的落在遮罩裡 */
               onTop: !!(mid && mid.closest && mid.closest('#fatal')) };
    });
    r.page = p;
    return r;
  };

  const zipCase = await readFatal(brokenCase('只有index', () => {}));
  ok('只有 index.html：蓋出說明而不是一片空白', zipCase.shown && zipCase.onTop,
     zipCase.shown ? (zipCase.onTop ? '' : '有元素但被蓋住') : '完全沒有提示');
  ok('八支相依檔全被列出來',
     ['lib/three.min.js', 'src/blueprints.js', 'src/engine.js', 'src/game.js',
      'src/game-workers.js', 'src/game-save.js', 'src/game-tools.js', 'src/game-ui.js']
       .every(f => zipCase.text.includes(f)),
     zipCase.text.replace(/\s+/g, ' ').slice(0, 90));
  ok('有講怎麼救（解壓縮後再開）',
     zipCase.text.includes('解壓縮') && zipCase.text.includes('index.html'));
  await zipCase.page.screenshot({ path: path.join(OUT, '08-檔案沒放齊.png') });
  await zipCase.page.close();

  /* 只缺 three：engine.js 會執行到一半炸掉，ENG 卡在 TDZ 連 typeof 都噴 ReferenceError。
     偵測沒包 try 的話這裡會整段死掉，反而連提示都蓋不出來。 */
  const libCase = await readFatal(brokenCase('缺three', d => {
    copyInto('src', d); copyInto('blueprints', d);
  }));
  ok('只缺 three.min.js 也擋得住（TDZ 不會反過來弄死偵測）', libCase.shown && libCase.onTop);
  ok('缺的那支被點名', libCase.text.includes('lib/three.min.js'),
     libCase.text.replace(/\s+/g, ' ').slice(0, 90));

  /* 檔案齊、但初始化炸掉（對方的瀏覽器不支援 WebGL 就長這樣）：走另一條訊息 */
  const bootCase = await readFatal(brokenCase('啟動失敗', d => {
    copyInto('lib', d); copyInto('src', d); copyInto('blueprints', d);
    /* boot 在 game-ui.js（v1.120.1 拆檔後）。這裡要的是「檔案齊、但初始化就炸」，
       所以只換掉那一支：其他四支照舊在，防呆的檔案檢查會過，接著 boot() 才炸。 */
    fs.writeFileSync(path.join(d, 'src/game-ui.js'),
      '"use strict";\nfunction boot() { throw new Error("測試用：假裝初始化失敗"); }\n');
  }));
  ok('檔案齊但啟動失敗：走「啟動失敗」那條訊息',
     bootCase.shown && bootCase.onTop && bootCase.text.includes('啟動失敗') &&
     !bootCase.text.includes('解壓縮'),
     bootCase.text.replace(/\s+/g, ' ').slice(0, 70));
  ok('原始錯誤訊息有帶出來', bootCase.text.includes('假裝初始化失敗'));
  await bootCase.page.close();
  await libCase.page.close();

  ok('正常開啟時不會誤蓋提示',
     await page.evaluate(() => !document.getElementById('fatal')));

  /* ══════════ 整體 ══════════ */
  await head('整體');
  await page.evaluate(() => { running = true; timeScale = 1; setWorkerCount(20); });
  await reset(page, { shape: '莫斯科克里姆林塔', cnt: 900, workers: 20 });
  await page.evaluate(() => { running = true; });
  await page.waitForTimeout(1500);
  ok('整輪跑完沒有累積任何 console 錯誤', errors.length === 0,
     errors.slice(0, 3).join(' | '));
  await page.screenshot({ path: path.join(OUT, '07-結束畫面.png') });

  await browser.close();
  report(false);
})().catch(async e => {
  /* --until 收工：不是出錯，關掉瀏覽器、照樣印總結（標成部分執行）。 */
  if (e && e.stopRun) {
    if (BROWSER) await BROWSER.close().catch(() => {});
    report(true);
    return;
  }
  console.error('\n測試腳本自己爆了：\n' + (e && e.stack || e));
  process.exit(2);
});

/* ---------- 總結 ---------- */
/* partial＝--until 收工的那一輪。**不能印「全數通過」**：後面幾百條根本沒跑，
   那句話會被當成完整綠燈（自己回頭看紀錄時最容易誤判的就是這個）。 */
function report(partial) {
  const fail = R.filter(r => !r.pass);
  console.log('\n' + '═'.repeat(52));
  console.log('  ' + (R.length - fail.length) + ' / ' + R.length + ' 通過' +
              (fail.length ? '，\x1b[31m' + fail.length + ' 項失敗\x1b[0m'
               : partial ? '  \x1b[33m（--until 只跑到「' + section + '」為止，不是完整一輪）\x1b[0m'
                         : '  \x1b[32m全數通過\x1b[0m'));
  if (fail.length) {
    console.log('');
    for (const f of fail) console.log('  \x1b[31m✗\x1b[0m [' + f.section + '] ' + f.name + (f.detail ? '  → ' + f.detail : ''));
    if (partial) console.log('  \x1b[33m（--until 只跑到「' + section + '」為止）\x1b[0m');
  }
  // 指定的段名打錯就整輪跑完了，要講一聲，不然會以為「跑得好快」
  if (UNTIL && !untilHit) console.log('  \x1b[33m--until「' + UNTIL + '」沒對到任何段名，跑的是完整一輪\x1b[0m');
  /* 種子一定要印：這一輪紅的那幾條，照這個數字重跑才是同一副骰子。 */
  console.log('  種子：--seed ' + SEED);
  console.log('  截圖：' + path.relative(ROOT, OUT));
  if (JSON_OUT) {
    fs.writeFileSync(JSON_OUT, JSON.stringify({ seed: SEED, partial, results: R }, null, 1));
    console.log('  結果：' + JSON_OUT);
  }
  console.log('═'.repeat(52));
  process.exit(fail.length ? 1 : 0);
}
