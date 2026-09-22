/* ============================================================
   藍圖驗證（後端版）
   跑法：
     node tools/validate-bp.cjs <候選藍圖檔> [後端加驗量哪一檔，預設 9000]
   把 AI 產的那段程式跑一次體檢，結果以 JSON 印到 stdout（UTF-8）。
   那個檔位由 C# 傳 Gemini:ShotSlots 進來，**要跟四視圖拍的是同一檔**（見 SHOT_SLOTS）。
   有必修（fails）或載不進來 → exit 1；其餘 exit 0。

   跟 tools/check-bp.cjs（命令列批次版）的分工：
     check-bp.cjs   人工批次檢查 blueprints/ 裡已存檔的那些，輸出給人看的文字
     validate-bp.cjs 後端自動修復迴圈用，輸出給程式讀的 JSON，一次只驗一份候選

   刻意都不自己實作解析與檢查——wwwroot/src/blueprints.js 匯出的
   importBlueprint()（剝 ```js 圍籬、抓「// 檔名：」、撞名自動編號、把語法／執行
   錯誤翻成人看得懂的訊息）與 checkBlueprint()（產出診斷報告）就是遊戲裡
   「貼上藍圖 → 檢查藍圖」按的那兩顆，兩邊逐字同一份，報告才對得上說明書第 7 節。
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WWW = path.join(ROOT, 'wwwroot');
const BP = require(path.join(WWW, 'src/blueprints.js'));

/* 藍圖檔是給瀏覽器用的 classic script：它看得到 customBlueprint、dim、blob… 是因為
   那些在瀏覽器裡都是全域。importBlueprint 內部用 new Function('customBlueprint', code)
   建 gen()，那個閉包的作用域鏈只有「customBlueprint 這個參數 → global」，
   所以 dim／tint／paintFrom 這些一定要掛上 globalThis，不然 gen() 一跑就 ReferenceError。 */
for (const k of Object.keys(BP)) if (!(k in globalThis)) globalThis[k] = BP[k];

/* ── 攔「靜默失敗」的那三支 ────────────────────────────────
   windowGrid／tint／paintFrom 都是「牆不在那裡就什麼都不做」——不報錯、不丟例外，
   報告上也看不出來（說明書 3.3、以及 paintFrom 方向寫反那一段）。實測產出裡
   「眼睛沒畫上去」「那一排窗戶不存在」就是這樣來的，所以在這裡數。

   只攔 globalThis 上那一份：blueprints.js 內部的 windowGrid 呼叫的是模組作用域裡的
   tint，攔不到——剛好就是我們要的，數到的都是**藍圖自己直接下的那些筆**
   （gen() 是 new Function 建的，作用域鏈只有「參數 → global」，所以它看到的是這裡這份）。 */
const probe = { window: [], tintHit: 0, tintMiss: 0, paintHit: 0, paintMiss: 0 };
function resetProbe() {
  probe.window.length = 0;
  probe.tintHit = probe.tintMiss = probe.paintHit = probe.paintMiss = 0;
}
globalThis.windowGrid = function (v, o) { const n = BP.windowGrid(v, o); probe.window.push(n); return n; };
globalThis.tint = function (v, x, y, z, c) {
  const ok = BP.tint(v, x, y, z, c);
  if (ok) probe.tintHit++; else probe.tintMiss++;
  return ok;
};
globalThis.paintFrom = function (v, x, y, z, dx, dy, dz, n, c) {
  const ok = BP.paintFrom(v, x, y, z, dx, dy, dz, n, c);
  if (ok) probe.paintHit++; else probe.paintMiss++;
  return ok;
};

/* 版本號在 game.js 裡（那支要瀏覽器才跑得起來），用文字撈出來就好 */
let ver = '?';
try {
  const m = fs.readFileSync(path.join(WWW, 'src/game.js'), 'utf8').match(/VERSION\s*=\s*'([^']+)'/);
  if (m) ver = m[1];
} catch (e) { /* 沒有就算了，報告裡寫 ? */ }

function out(o, code) {
  process.stdout.write(JSON.stringify(o, null, 2));
  process.exit(code);
}

/* ── 先把 blueprints/ 裡現有的載進來 ──────────────────────────
   為了撞名判斷：customBlueprint 會擋掉跟現有藍圖同名的那份，而 importBlueprint
   碰到撞名會自動加編號。不先載這些，AI 取了「金閣寺」也會過關，存進去之後
   遊戲載入時才被擋掉、整份靜靜消失。 */
const dir = path.join(WWW, 'blueprints');
const listFile = path.join(dir, 'list.js');
const skipped = [];
let files = [];
if (fs.existsSync(listFile)) {
  const src = fs.readFileSync(listFile, 'utf8');
  try {
    files = new Function('window', src + ';return typeof BP_FILES !== "undefined" ? BP_FILES : [];')({}) || [];
  } catch (e) {
    out({ ok: false, stage: 'list', error: 'list.js 讀不動：' + e.message }, 2);
  }
}
for (const f of files) {
  const p = path.join(dir, f);
  if (!fs.existsSync(p)) { skipped.push(f + '：list.js 列了這個檔名，但檔案不在'); continue; }
  try { new Function(fs.readFileSync(p, 'utf8'))(); }
  catch (e) { skipped.push(f + '：載入時就出錯 → ' + (e && e.message ? e.message : String(e))); }
}

/* ── --names：把現有藍圖的名字全部列出來 ────────────────────
   給後端塞進 prompt 用。customBlueprint 會擋掉撞名的那份，事先把名單告訴 AI
   就少掉一整輪「改個名字再來」。 */
if (process.argv[2] === '--names')
  out({ ok: true, stage: 'names', ver, names: BP.SHAPES.map(s => s.n), skipped }, 0);

/* ── 驗候選那一份 ──────────────────────────────────────────── */
const target = process.argv[2];
if (!target) out({ ok: false, stage: 'arg', error: '沒給候選藍圖的檔案路徑' }, 2);
if (!fs.existsSync(target)) out({ ok: false, stage: 'arg', error: '找不到檔案：' + target }, 2);

/* 第二個參數＝後端加驗要在哪一檔量，由 C# 那邊把 Gemini:ShotSlots 傳進來。
   **一定要跟四視圖拍的是同一檔**：加驗是把「像不像」變成量得出來的東西，而「像不像」
   是看那張圖判斷的——量 10000 檔卻拍 9000 檔，等於評的跟看的不是同一個東西。
   實測 48 支裡有 2 支結論會對不上（見〈調校筆記〉2.6）。
   單獨在命令列跑時不必給，退回 9000＝遊戲面板最大那一檔、也是 ShotSlots 的預設值。
   注意 checkBlueprint 自己那四檔（BP_TARGETS）**不受這個影響**：那份報告是遊戲、
   預覽頁、後端共用的，拿內建 48 座校準過，動它等於改所有人的報告。 */
const SHOT_SLOTS = (() => {
  const n = Number(process.argv[3]);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 9000;
})();

const raw = fs.readFileSync(target, 'utf8');
let added;
try {
  /* own 傳一個空 Set：這一支每次都是新 process，沒有「上一次貼的同名那份」要蓋掉 */
  added = BP.importBlueprint(raw, new Set());
} catch (e) {
  /* 語法錯誤、沒呼叫到 customBlueprint、缺 name、被 customBlueprint 擋掉——
     訊息都是 importBlueprint 翻好的，原文回去給 AI 就是最好的修法提示 */
  out({ ok: false, stage: 'import', error: e && e.message ? e.message : String(e), skipped, ver }, 1);
}

const last = added[added.length - 1];
let r;
try {
  r = BP.checkBlueprint(last.idx, { ver });
} catch (e) {
  out({ ok: false, stage: 'check', name: last.name, file: last.file, code: last.code,
        error: '體檢時出錯：' + (e && e.message ? e.message : String(e)), skipped, ver }, 1);
}

/* ── 後端加驗 ──────────────────────────────────────────────
   上面那份報告（checkBlueprint）是遊戲與預覽頁共用的，門檻拿內建 48 座校準過，
   刻意只留「真的是缺陷」的那幾條。下面這五條是**後端自動流程才需要**的：
   都是實際產出上看得到、而現有報告完全看不到的東西。

   一律走 warns 不走 fails：fails 會觸發自動重跑，而這幾條裡有幾條是「大概錯了」
   而不是「一定錯了」（部件偏少、對稱度低都可能是本來就長那樣）。
   逼模型去修沒壞的東西，換來的是它把對的地方改壞——那是這份報告最初就在避的事。 */
/** 每個顏色有幾格、其中幾格**露在外面**（六面不是全被包住）。存在 ≠ 看得見。 */
function surfaceOf(cells) {
  const at = new Set();
  for (const c of cells) at.add(c.x + ',' + c.y + ',' + c.z);
  const tot = new Map(), vis = new Map();
  for (const c of cells) {
    tot.set(c.c, (tot.get(c.c) || 0) + 1);
    if (!at.has((c.x + 1) + ',' + c.y + ',' + c.z) || !at.has((c.x - 1) + ',' + c.y + ',' + c.z)
     || !at.has(c.x + ',' + (c.y + 1) + ',' + c.z) || !at.has(c.x + ',' + (c.y - 1) + ',' + c.z)
     || !at.has(c.x + ',' + c.y + ',' + (c.z + 1)) || !at.has(c.x + ',' + c.y + ',' + (c.z - 1)))
      vis.set(c.c, (vis.get(c.c) || 0) + 1);
  }
  return { tot, vis };
}

const extra = { lines: [], warns: [] };
try {
  const big = SHOT_SLOTS;                         // ＝四視圖那一檔，見上面 SHOT_SLOTS 的註解
  const sh = BP.SHAPES[last.idx];
  /* fitScale 是**掃描**：它為了找最接近目標塊數的 s，會把 gen() 跑幾十次。
     所以 resetProbe() 一定要放在它後面，只讓下面那一次 genCells 的呼叫被數到——
     不然數出來的是幾十輪、各種尺度混在一起的總和（實測金閣寺被數成 130 次 windowGrid，
     真正的答案是 8 次）。 */
  const b = BP.makeBlueprint(last.idx, big);      // 連通性（懸空分組）要用它自己那份判定
  const s = BP.fitScale(sh, big);
  /* 小檔位那一份也要（第 6 條要比兩個檔位）。**一定要在 resetProbe 之前跑完**——
     它又是一次 fitScale ＋ genCells，放在 reset 後面會把計數器灌爆。 */
  const smallT = BP.BP_TARGETS[2];                // 3000＝面板中間那一檔
  let smallSurf = null;
  try { smallSurf = surfaceOf(BP.genCells(sh, BP.fitScale(sh, smallT)).cells()); } catch (e) { /* 算不出來就跳過那一條 */ }
  /* 上面幾支裡面都有掃描，所以 reset 要壓到最後——只留下面那一次 genCells */
  resetProbe();
  const cells = BP.genCells(sh, s).cells();
  const slots = cells.length ? cells : (b.slots || []);
  const E = extra.lines, W = extra.warns;
  E.push('');
  E.push('── 後端加驗（' + big + ' 塊那一階，' + slots.length + ' 格）──');

  /* 1. 靜默沒畫上去的：那個部件其實不存在，但報告的塊數與配色都很漂亮 */
  const zeroWin = probe.window.filter(n => n === 0).length;
  if (probe.window.length) {
    const shown = probe.window.slice(0, 12).join('、')
                + (probe.window.length > 12 ? '…' : '');
    E.push('windowGrid 呼叫 ' + probe.window.length + ' 次，畫上去的格數：' + shown);
    if (zeroWin) {
      W.push('windowGrid 有 ' + zeroWin + ' 次畫了 0 格');
      E.push('  ✘ 其中 ' + zeroWin + ' 次畫了 0 格 —— 那一整組窗戶**不存在**');
      E.push('    修法：windowGrid 走 tint，只換「已經有積木」的格子。{x,y,z} 要落在牆面上，'
           + '而且 axis 要跟那面牆對得上（朝 ±z 的牆用 axis:\'x\'，側面兩片用 \'z\'）。');
    }
  }
  if (probe.paintMiss) {
    W.push('paintFrom 有 ' + probe.paintMiss + ' 次沒找到表面');
    E.push('✘ paintFrom 呼叫 ' + (probe.paintHit + probe.paintMiss) + ' 次，其中 '
         + probe.paintMiss + ' 次一路掃到底都沒碰到實心格 —— 那幾個裝飾**沒有畫上去**');
    E.push('  修法：錨點 (x,y,z) 要在身體**裡面**、(dx,dy,dz) 指**往外**，n 要夠長。'
         + '臉在 −z，所以通常是 (0, 0, -1)。方向寫反不會報錯，只會塗在皮下看不見的地方。');
  } else if (probe.paintHit) {
    E.push('paintFrom 呼叫 ' + probe.paintHit + ' 次，都有找到表面 ✔');
  }
  if (probe.tintMiss && !probe.tintHit) {
    W.push('tint 全部 ' + probe.tintMiss + ' 次都沒換到色');
    E.push('✘ tint 呼叫 ' + probe.tintMiss + ' 次，**一次都沒換到色** —— 那些裝飾全部不存在');
    E.push('  修法：tint 只換已經有積木的格子。座標算錯、或那面牆的位置跟你想的不一樣。');
  } else if (probe.tintHit) {
    E.push('tint 換到 ' + probe.tintHit + ' 格'
         + (probe.tintMiss ? '（另有 ' + probe.tintMiss + ' 次落在空氣裡，'
                           + '整片掃過去的話正常）' : ' ✔'));
  }

  /* 2. 左右對稱度：只報數字。建築有不對稱的翼樓、動物有姿勢，沒有客觀門檻——
        但「做的是對稱的東西卻只有六七成」幾乎都是 mirrorX 只鏡射了起點（說明書 3.3）。 */
  if (slots.length) {
    const has = new Set(slots.map(c => c.x + ':' + c.y + ':' + c.z));
    /* 鏡射軸要自己找，而且**要從質心找起，不是包圍盒中心**：
       一個伸出去的握把（或尾巴、翅膀、伸長的手）會把包圍盒拉歪一大截——
       實測一個杯身在 x=0、握把伸到 x=24 的馬克杯，包圍盒中心在 x≈5.5，
       在它附近掃 ±4 永遠碰不到真正的中軸，量出來 39%（同一時間 馬克杯.js 是 95%，
       兩個數字互相矛盾才發現的）。質心受小握把的影響小得多，所以從質心掃。
       mir 是「軸 ×2」，用整數存才不會有半格誤差（軸可能落在格線上或格中央）。 */
    let sum = 0;
    for (const c of slots) sum += c.x;
    const mid = Math.round(2 * sum / slots.length);
    let paired = 0, bestMir = mid;
    for (let mir = mid - 12; mir <= mid + 12; mir++) {
      let n = 0;
      for (const c of slots) if (has.has((mir - c.x) + ':' + c.y + ':' + c.z)) n++;
      if (n > paired) { paired = n; bestMir = mir; }
    }
    const pc = Math.round(paired / slots.length * 100);
    E.push('左右對稱度 ' + pc + '%（' + paired + '/' + slots.length +
           ' 格有對稱的另一半，鏡射軸 x=' + (bestMir / 2) + '）');
    E.push('  臉、四肢、正立面該對稱的東西會在 90% 以上。做的是對稱的東西卻只有六七成，'
         + '通常是 mirrorX 只鏡射了起點、終點的 x1 忘了跟著鏡射（兩隻手臂指向同一邊）。');
  }

  /* 3. 幾塊小碎片飄在旁邊：多半是接不上的爪子、尖端差一格。
        組數多（扇葉、輻條、吊索）或體積大（故意的懸空部件）都不示警——48 座裡就有。 */
  const fl = (b.floats || []).map(g => g.cells.length).sort((a, z) => z - a);
  if (fl.length && fl.length <= 4 && fl[0] <= 12) {
    W.push('有 ' + fl.length + ' 小組積木飄在旁邊（' + fl.join('、') + ' 格）');
    E.push('⚠ 懸空的小碎片：' + fl.length + ' 組，各 ' + fl.join('、') + ' 格');
    E.push('  修法：如果不是故意做懸空部件，就是那一組差一格沒接上（爪子離手、尖端離頂），'
         + '把它的起點往主體裡挪一格。曲面上的裝飾要用 tint／paintFrom 而不是 v.set。');
  }

  /* 4. 部件數：說明書兩處寫「像不像幾乎全靠部件數」，卻沒有一條檢查在數。
        數的是**呼叫的筆數**（一筆 rowOf 排出八根柱子算一件事，那才是一個部件）。 */
  const bare = String(last.code || '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const draws = bare.match(/\b(?:v\.(?:box|walls|carve|cyl|taper|pyramid|gable|dome|onion|eave|ellipseRing|line|set|del)|archRow|arch|stairs|hipRoof|tubeZ|wheelX|blob|limb|plate|revolve|windowGrid|lattice|boxTaper|corners4|mirrorX|mirrorZ|ringOf|rowOf|stampY|tint|paintFrom)\s*\(/g) || [];
  E.push('畫圖呼叫 ' + draws.length + ' 處');
  if (draws.length < 8) {
    W.push('畫圖呼叫只有 ' + draws.length + ' 處，部件偏少');
    E.push('  ⚠ 只有 ' + draws.length + ' 處。像不像幾乎全靠部件數——同樣的塊數，'
         + '「四面牆＋一個屋頂」看起來就是個盒子。照說明書第 5 節那三套六層清單'
         + '（建築／人物動物／器物食物）每一層至少挑一件補上去；範例小教堂是十四件。');
    E.push('  （如果這個東西真的就這麼簡單，忽略這一條。）');
  }

  /* 5.5 只有一面有東西：窗格／飾條／五官全畫在朝 −z 那一面，側面與背面是空白牆。
        實測「亞洲商業中心」只給一張正面參考照，帷幕玻璃就只畫在正面那一片。

        量的是**花紋密度**（那一面的表面上，相鄰兩格顏色不同的比例），不是「表面有幾種顏色」——
        空白側牆照樣會有基座、女兒牆好幾個色，色數分不出來（實測亞洲商業中心四面色數是
        6／4／4／4，看不出問題；花紋密度是 48%／7%／9%／9%，一眼就看得出來）。

        拿現有 76 支校準：中位數倍率 1.2，最高的是阿姆斯特丹運河屋 6.5、亞洲商業中心 5.8，
        第三名荷蘭風車只有 3.2。所以門檻 4 只會打到那兩支。
        角色與動物不會誤報（正面有五官、背面平坦是正常的）：大頭像 3.0、復活節島摩艾 1.9、
        獅身人面像 2.0，全在門檻下。 */
  const faceNames = ['正面 −z', '背面 +z', '左 −x', '右 +x'];
  const density = [['z', 1], ['z', -1], ['x', 1], ['x', -1]].map(([ax, dir]) => {
    const first = new Map();                 // 每一條射線只留最外面那一格
    for (const c of slots) {
      const k = ax === 'z' ? c.x + '_' + c.y : c.z + '_' + c.y;
      const depth = (ax === 'z' ? c.z : c.x) * dir;
      const o = first.get(k);
      if (!o || depth < o.d) first.set(k, { d: depth, c: c.c });
    }
    let pairs = 0, diff = 0;
    for (const [k, v] of first) {
      const [a, bb] = k.split('_').map(Number);
      for (const nk of [(a + 1) + '_' + bb, a + '_' + (bb + 1)]) {
        const o = first.get(nk);
        if (!o) continue;
        pairs++;
        if (o.c !== v.c) diff++;
      }
    }
    return pairs ? diff / pairs : 0;
  });
  const sorted = density.slice().sort((a, z) => z - a);
  const restAvg = sorted.slice(1).reduce((a, z) => a + z, 0) / 3;
  const ratio = restAvg > 0.005 ? sorted[0] / restAvg : 1;
  E.push('四面花紋密度 ' + density.map(d => Math.round(d * 100) + '%').join('／')
       + '（' + faceNames.join('／') + '）');
  if (ratio >= 4) {
    const top = faceNames[density.indexOf(sorted[0])];
    W.push('只有「' + top + '」那一面有花紋，其餘三面接近空白（相差 ' + ratio.toFixed(1) + ' 倍）');
    E.push('  ⚠ 立面的處理只做了一面。窗格、飾條、開口、紋理都集中在「' + top + '」，'
         + '其餘三面是整片同色的牆——轉到側面看就露餡了。');
    E.push('  修法：四面都要做。windowGrid 的 axis 給 \'x\' 是朝 ±z 的牆、給 \'z\' 是側面兩片牆；'
         + '側牆與背面照樣要有窗、腰線、開口。真的只有正面有東西（浮雕、半身像、'
         + '貼牆的排屋）就忽略這一條。');
  }

  /* 5. 宣告了卻沒出現的顏色：現有報告只查反方向（用到的索引超出 pal）。
        pal 給了 6 色而只有 5 色有格子 ＝ 那個部件被後寫蓋掉了，或根本沒畫。 */
  const used = new Set(slots.map(s => s.c));
  const dead = [];
  for (let i = 0; i < (b.pal || []).length; i++) if (!used.has(i)) dead.push(i);
  if (dead.length) {
    W.push('pal[' + dead.join('、') + '] 宣告了但一格都沒用到');
    E.push('✘ pal[' + dead.join('、') + '] 宣告了顏色，但 ' + big + ' 塊時一格都沒有');
    E.push('  修法：那個部件沒畫、或被後面畫的量體整片蓋掉了（同一格後寫蓋先寫）。'
         + '要嘛把它畫出來、要嘛從 pal 拿掉——留著會讓人以為有那個部件。');
  }

  /* 6. 檔位越大反而越看不到：某個顏色的**格數**跟著尺度長大了，**露在外面的卻沒變多**——
        那個部件被後畫的量體吞進去了。使用者實際回報的病徵就是這個：
        「3000 塊跟 9000 塊蓋出來不一樣，表面細節被原本在內部的蓋掉」。

        **存在 ≠ 看得見**，而現有報告從頭到尾只數格數（「300 塊時各色還在不在」也是數格數），
        所以這種缺陷在報告上完全是隱形的：塊數漂亮、配色齊全、連通性滿分。

        比的是同一支在 3000 檔與 10000 檔的「露在外面的格數」。用比值不用絕對值，
        因為格數本來就會跟著尺度長（48→456 是正常放大，不是缺陷）。
        拿現有 79 支校準：門檻 1.3 只打到 2 支（章魚燒 pal[3] 可見率 88%→13%、
        微笑女青年肖像 pal[3] 69%→35%），兩支都是真的被埋掉。 */
  if (smallSurf) {
    const bigSurf = surfaceOf(slots);
    const buried = [];
    for (let c = 0; c < (b.pal || []).length; c++) {
      const ta = smallSurf.tot.get(c) || 0, tb = bigSurf.tot.get(c) || 0;
      const va = smallSurf.vis.get(c) || 0, vb = bigSurf.vis.get(c) || 0;
      if (ta < 3 || tb < ta * 2) continue;        // 格數沒有明顯長大就沒得比
      if (vb > va * 1.3) continue;
      buried.push('pal[' + c + ']（格數 ' + ta + '→' + tb + '，但露在外面的只有 '
        + va + '→' + vb + '，可見率 ' + Math.round(va / ta * 100) + '%→'
        + Math.round(vb / tb * 100) + '%）');
    }
    if (buried.length) {
      W.push('大檔位反而看不到：' + buried.map(t => t.slice(0, t.indexOf('（'))).join('、')
           + ' 被後畫的量體埋起來了');
      E.push('⚠ 檔位放大之後反而被埋掉：' + buried.join('；'));
      E.push('  意思是那個部件在 ' + smallT + ' 塊時露在表面，到 ' + big
           + ' 塊時被後面畫的量體整個包進去了——**格子還在，但看不到**，'
           + '所以塊數與配色檢查都查不出來。');
      E.push('  修法：那一片是裝飾（高光、斑紋、色帶、髮絲反光）的話，'
           + '**改用 `tint`／`paintFrom` 貼在表面**，不要用 `blob`／`box` 疊一塊實心的上去——'
           + '疊上去的東西會被後面畫的部件蓋住，而 `paintFrom` 是「從外面掃到第一格實心的才上色」，'
           + '不管尺度多大都會落在看得到的那一面。'
           + '如果它是真的量體，就把它的位置往外挪（或把包住它的那個部件縮小）。');
    }
  }
} catch (e) {
  extra.lines.push('');
  extra.lines.push('（後端加驗跑不起來：' + ((e && e.message) || String(e)) + '，不影響上面的結果）');
}

/* 併回報告與 warns：報告全文就是要貼回給模型的那一段，所以加驗要寫在裡面。

   加驗要插在「結論」**之前**，而且結論要重算：直接接在後面的話，報告會先寫
   「結論：沒有必修、沒有提醒」再列出一串 ✘，前後矛盾——實測第一版就是這樣，
   模型讀到的是自相牴觸的兩段話。
   （順手也拿掉「把整段複製貼回給 AI」那一行：那是人工流程的指示，後端自己會送。） */
const warns = r.warns.concat(extra.warns);

/* ── ⚠ 分三層 ──────────────────────────────────────────────
   實測 28 支現有藍圖的 16 個 ⚠：**10 個是塊數偏差**。使用者照重要性排過：

     重要（important）＝ 東西沒畫上去、有小碎塊飄著。**這兩種才有資格自己觸發一次呼叫。**
                        部件偏少也放這裡：說明書兩處寫「像不像幾乎全靠部件數」，
                        而實測產出裡「皮卡丘沒有手腳」就是這一條。
                        「只有一面有花紋」也放這裡——那本質上就是「另外三面什麼都沒畫」，
                        而且 28 支現有藍圖 0 誤報（只打到亞洲商業中心）。
                        放 fixable 的話它永遠不會自己觸發，等於白做。
     普通（fixable）  ＝ 宣告的顏色沒出現、最底層太少格、只有一面有花紋、
                        **頂到 lo／hi 的那種塊數偏差**（見下）。自己不值得花一次呼叫，
                        但既然已經要跑那一輪了就順手一起修。
     不修             ＝ 純階距的塊數偏差、產生時間。

   **塊數偏差要分兩種，修法完全不同**（原本一律不修，那是錯的）：

     階距太大        修法是「把跳最兇的那個維度係數調小」，而〈藍圖製作說明〉第 5 節寫著
                     「係數之間的比例就是這棟建築的長相」——為了追一個數字去改係數，
                     換來的是它變得更不像。**這一種不修。**
     頂到 lo／hi     修法是「把 lo/hi 調一調，或把各部件的下限（dim 第三個參數）改小」，
                     **完全不動係數比例**，改了不會變得更不像。這一種要修。
                     實測「亞洲商業中心」1600 那一階 +133%：各部件下限給到 18／17／11，
                     最小的造型也要 3,735 格，玩家挑小檔位永遠拿到一棟塞不下的大樓。

   分得出來的方法：checkBlueprint 把修法寫在報告裡那一階的下一行，比對那一行就知道
   是哪一種（warn 字串本身只有「1600 塊偏差 133%」，看不出來）。

   三層都照樣寫進報告全文給人看與給模型看，分層只決定「要不要主動花錢修」。 */

/** 報告裡那一階的下一行是不是「s 已經頂到 hi／壓到 lo」。 */
function pinned(text, tier) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++)
    if (new RegExp('^\\s*' + tier + '\\s*→').test(lines[i]))
      return /s 已經頂到 hi|s 已經壓到 lo/.test(lines[i + 1] || '');
  return false;
}

const fixable = warns.filter(w => {
  if (/產一份要/.test(w)) return false;                  // 純效能，跟像不像無關
  const m = w.match(/^(\d+) 塊偏差/);
  if (m) return pinned(r.text, m[1]);                    // 只有「頂到 lo／hi」那種才修
  return true;
});
const important = fixable.filter(w =>
  /windowGrid|paintFrom|tint 全部|飄在旁邊|畫圖呼叫|那一面有花紋|大檔位反而看不到/.test(w));

const cut = r.text.lastIndexOf('\n結論：');
const body = cut >= 0 ? r.text.slice(0, cut) : r.text;
const report = body + '\n' + extra.lines.join('\n')
  + '\n\n結論：' + (r.fails.length ? r.fails.length + ' 個必修 ✘' : '沒有必修')
  + '、' + (warns.length ? warns.length + ' 個提醒 ⚠' : '沒有提醒');

out({
  ok: r.fails.length === 0,
  stage: 'done',
  ver,
  name: last.name,
  renamedFrom: last.was || null,      // 有值＝原名撞號，importBlueprint 自動加了編號
  file: last.file,
  code: last.code,                    // 圍籬已清掉的乾淨程式，存檔就是存這段
  fails: r.fails,
  warns,
  fixable,                            // warns 的子集：值得順手修掉的（不含塊數偏差與效能）
  important,                           // fixable 的子集：夠嚴重、有資格自己觸發一輪打磨的
  report,                             // 診斷報告全文（含後端加驗），要貼回給 AI 的那一段
  skipped                             // blueprints/ 裡本來就載不動的，不影響這次結果
}, r.fails.length ? 1 : 0);
