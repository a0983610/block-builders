/* ============================================================
   把官方 three.js 的 ES module build 轉成 classic script。
   跑法：node tools/build-three.cjs
   來源：three.js-master/build/three.core.min.js + three.module.min.js
   產出：lib/three.min.js（掛在 window.THREE）

   為什麼要轉：這支遊戲的前提是「雙擊 HTML 就能玩、不用開 server」，
   而 ES module 走 file:// 會被瀏覽器擋掉：
     Access to script at 'file:///...' from origin 'null' has been blocked by CORS policy
   classic script（<script src>）沒有這個限制，所以把 ESM 包成 IIFE。

   轉換規則只有三條，對應 three build 檔裡實際出現的三種語法：
     import{A as x}from"..."        → const{"A":x}=上游;
     export{A,B}from"..."（再匯出）  → 從上游取 A,B，同時放進回傳物件
     export{x as A}                 → 放進回傳物件
   任何一條對不上就直接丟例外，寧可打包失敗也不要產出壞檔。
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'three.js-master');
const BUILD = path.join(SRC, 'build');
const OUTFILE = path.join(ROOT, 'lib', 'three.min.js');

if (!fs.existsSync(BUILD)) {
  console.error('找不到 ' + BUILD +
    '\n請把 three.js 原始碼解壓到 block-builders/three.js-master/（此目錄不進 git）');
  process.exit(2);
}

/* `A as B` → {local:'A', name:'B'}；沒有 as 就兩邊同名 */
const items = s => s.split(',').map(x => x.trim()).filter(Boolean).map(x => {
  const m = x.match(/^(.+?)\s+as\s+(.+)$/);
  return m ? { local: m[1], name: m[2] } : { local: x, name: x };
});

/* 一個 ESM 檔 → 一段 IIFE 運算式，回傳它的對外物件 */
function toIIFE(src, upstream) {
  const ret = [];    // 對外名單
  const take = [];   // 要從上游拉進區域作用域的名字（再匯出用）
  let hits = 0;

  const body = src
    .replace(/export\{([^}]*)\}from"[^"]+";?/g, (s, g) => {
      hits++;
      for (const it of items(g)) {
        // 再匯出如果有改名，下面的 take 就不能直接用原名，先擋下來
        if (it.local !== it.name) throw new Error('再匯出出現改名，轉換規則要補：' + s.slice(0, 80));
        take.push(it.name);
        ret.push(JSON.stringify(it.name) + ':' + it.name);
      }
      return '';
    })
    .replace(/import\{([^}]*)\}from"[^"]+";?/g, (s, g) => {
      hits++;
      return 'const{' + items(g).map(it => JSON.stringify(it.local) + ':' + it.name).join(',') + '}=' + upstream + ';';
    })
    .replace(/export\{([^}]*)\};?/g, (s, g) => {
      hits++;
      for (const it of items(g)) ret.push(JSON.stringify(it.name) + ':' + it.local);
      return '';
    });

  if (!hits) throw new Error('整個檔找不到 import/export，three 的 build 格式可能換了');
  if (/\b(?:import|export)\s*[{*]/.test(body)) throw new Error('還有沒處理掉的 import/export');
  const head = take.length ? 'const{' + take.join(',') + '}=' + upstream + ';\n' : '';
  return '(function(){' + head + body + '\nreturn{' + ret.join(',') + '};})()';
}

const core = fs.readFileSync(path.join(BUILD, 'three.core.min.js'), 'utf8');
const mod = fs.readFileSync(path.join(BUILD, 'three.module.min.js'), 'utf8');
const ver = JSON.parse(fs.readFileSync(path.join(SRC, 'package.json'), 'utf8')).version;

const out =
  '/* three.js ' + ver + ' — 由官方 build/three.core.min.js + three.module.min.js 轉成 classic script。\n' +
  '   ES module 走 file:// 會被 CORS 擋掉，雙擊開檔會整支掛掉，所以包成 window.THREE。\n' +
  '   請勿手改此檔；要更新請重跑 node tools/build-three.cjs。\n' +
  '   授權：MIT，Copyright Three.js Authors，見 https://github.com/mrdoob/three.js */\n' +
  '(function(){"use strict";\n' +
  'var __core=' + toIIFE(core, 'null') + ';\n' +
  'window.THREE=' + toIIFE(mod, '__core') + ';\n' +
  '})();\n';

fs.mkdirSync(path.dirname(OUTFILE), { recursive: true });
fs.writeFileSync(OUTFILE, out);

/* 對外名單要跟官方 CommonJS build 完全一致，少一個都代表轉換漏了東西 */
const cjs = fs.readFileSync(path.join(BUILD, 'three.cjs'), 'utf8');
const expect = [...cjs.matchAll(/^exports\.([A-Za-z0-9_$]+)\s*=/gm)].map(x => x[1]).sort();
const got = [...out.matchAll(/"([A-Za-z0-9_$]+)":/g)].map(x => x[1]);
const gotSet = new Set(got);
const missing = expect.filter(k => !gotSet.has(k));

console.log('three.js ' + ver + ' → ' + path.relative(ROOT, OUTFILE) +
            '（' + Math.round(out.length / 1024) + ' KB）');
if (missing.length) {
  console.error('對外名稱少了 ' + missing.length + ' 個：' + missing.slice(0, 20).join(','));
  process.exit(1);
}
console.log('對外名稱 ' + expect.length + ' 個，與官方 three.cjs 一致。');
console.log('注意：這只是靜態比對，實際能不能跑由 tools/e2e-3d.cjs 在真瀏覽器驗。');
