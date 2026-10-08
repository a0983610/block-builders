/* ============================================================
   組一頁預覽：真的遊戲（index.html）＋一塊控制面板 → tools/.e2e-out/名稱.html
   跑法：
     node tools/make-preview.cjs 名稱              面板用 tools/.e2e-out/名稱.panel.html；還沒有就先產一份骨架
     node tools/make-preview.cjs 名稱 面板.html    面板放在別的地方

   CLAUDE.md〈一輪是怎麼跑的〉第 3 點：造型／動作類先產一頁預覽給使用者看，他點頭再落地。
   每一頁都是同一個做法——複製 index.html、加 <base href="../../">（頁面在 tools/.e2e-out/ 裡，
   script 的相對路徑要指回 repo 根目錄）、換標題、在 </body> 前面掛一塊面板。這支就是那一段。
   **面板是唯一要自己寫的東西**：遊戲層是 classic script、共用同一份全域，所以面板裡的 script
   可以直接叫遊戲的函式，也可以把要試的函式整支換掉（useTool 照名字叫，道具列自己點也會走到換掉的那一支）。

   遊戲本體每次都從 index.html 當場複製：index.html 改過（多一支 .js 之類），重跑一次就跟上。
   輸出固定在 tools/.e2e-out/（已 gitignore）——<base> 是照這個深度寫的，放別的地方 script 會找不到。
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'tools/.e2e-out');
const name = process.argv[2];
if (!name || name.startsWith('-') || /[\\/]/.test(name)) {
  console.log('要給一個名字（不含路徑）：node tools/make-preview.cjs 某某預覽 [面板.html]');
  process.exit(2);
}
const title = name.replace(/\.html$/, '');
const panelFile = process.argv[3] ? path.resolve(process.argv[3]) : path.join(OUT_DIR, title + '.panel.html');
const outFile = path.join(OUT_DIR, title + '.html');

/* 骨架：面板放在右上那張卡（時鐘、匯入建築）底下，不蓋住它；捲得動，矮螢幕也看得到最下面 */
const SKELETON = `<!-- ${title} 的面板：改完重跑 node tools/make-preview.cjs ${title} -->
<style>
  #pv button{font:12px/1.4 inherit;padding:3px 7px;margin:2px 2px 2px 0;border:1px solid rgba(27,36,48,.25);
    border-radius:6px;background:#fff;color:#1b2430;cursor:pointer}
  #pv button.sel{background:#e8873c;border-color:#e8873c;color:#fff}
  #pv .lb{margin-top:7px;font-weight:600}
</style>
<div id="pv" style="position:fixed;right:12px;top:252px;max-height:calc(100vh - 264px);overflow:auto;z-index:60;
  background:rgba(255,255,255,.95);color:#1b2430;padding:10px 12px;border-radius:10px;width:290px;
  font:13px/1.55 system-ui,'Microsoft JhengHei',sans-serif;box-shadow:0 2px 14px rgba(0,0,0,.25)">
  <div style="font-weight:700;margin-bottom:4px">${title}</div>
  <div style="color:#555">（這一頁在看什麼、要使用者看哪裡）</div>
  <div class="lb">放一次</div>
  <div>
    <button data-f="fix">🔨 建築補滿</button>
  </div>
  <div class="lb">速度
    <button data-s="1">1×</button>
    <button data-s="0.25">¼×</button>
  </div>
  <div id="pvmsg" style="margin-top:6px;color:#3f6e9e;min-height:1.5em;font-size:12px"></div>
</div>
<script>
(function () {
  const msg = t => { document.getElementById('pvmsg').textContent = t; };

  /* 要試的改動寫在這裡：把遊戲的函式整支換掉，例如
       callMeteor = function (point, n) { ... };
     遊戲層是 classic script、共用同一份全域，useTool 照名字叫，所以道具列自己點也會走到這一支。 */

  /* 面板上的按鈕：data-f="名字" 叫這裡同名的那一支 */
  const ACT = {
    fix() { completeNow(); msg('建築補滿了'); }
  };

  function paint() {
    for (const b of document.querySelectorAll('#pv [data-s]')) b.classList.toggle('sel', +b.dataset.s === timeScale);
  }
  document.getElementById('pv').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    e.stopPropagation();                           // 不讓點按鈕變成點到畫面（破壞道具）
    if (b.dataset.f && ACT[b.dataset.f]) ACT[b.dataset.f]();
    else if (b.dataset.s) timeScale = +b.dataset.s;
    paint();
  });
  function setup() {
    savable = false;                               // 預覽不寫存檔（不然會蓋掉使用者真的進度）
    doomT = 1e9;                                   // 不讓天災插進來
    stats.gift = TOOLS.map(t => t.id);             // 道具全解鎖，底下的道具列都能拿
    renderTools();
    completeNow();
    paint();
    msg('準備好了');
  }
  /* 等開場（boot）跑完再擺 */
  let tries = 0;
  (function wait() {
    try { if (typeof bp !== 'undefined' && bp && bp.slots && blocks) { setup(); return; } } catch (e) {}
    if (++tries < 200) setTimeout(wait, 100);
  })();
})();
</script>
`;

fs.mkdirSync(OUT_DIR, { recursive: true });
if (!fs.existsSync(panelFile)) {
  if (process.argv[3]) { console.log('找不到面板：' + panelFile); process.exit(2); }
  fs.writeFileSync(panelFile, SKELETON);
  console.log('先產了一份面板骨架：' + panelFile + '（照著改，再重跑一次）');
}

let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const need = { '<meta charset="utf-8">': 'charset 那一行', '</body>': '</body>', '<title>': '<title>' };
for (const k in need) if (html.indexOf(k) < 0) { console.log('index.html 裡找不到 ' + need[k] + '，沒辦法組（格式被改過？）'); process.exit(1); }
html = html.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<base href="../../">')
           .replace(/<title>[^<]*<\/title>/, () => '<title>' + title + '</title>')
           .replace('</body>', () => '\n' + fs.readFileSync(panelFile, 'utf8') + '\n</body>');
fs.writeFileSync(outFile, html);
console.log('預覽頁：' + outFile);
