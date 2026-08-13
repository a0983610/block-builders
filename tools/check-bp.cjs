/* ============================================================
   藍圖體檢（命令列版）
   跑法：
     node tools/check-bp.cjs              檢查 blueprints/ 裡所有自訂藍圖
     node tools/check-bp.cjs 我的塔        只檢查這一份
     node tools/check-bp.cjs --all        連內建 48 座一起，只印一行摘要
   有 ✘ 就 exit 1，全過 exit 0。

   跟遊戲裡「檢查藍圖」按鈕共用 src/blueprints.js 的 checkBlueprint()，
   兩邊輸出一模一樣——一般玩家用按鈕複製報告貼回給 AI，
   要批次驗幾十座時用這支，不必開瀏覽器。
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BP = require(path.join(ROOT, 'src/blueprints.js'));

/* 版本號在 game.js 裡（那支要瀏覽器才跑得起來），用文字撈出來就好 */
let ver = '?';
try {
  const m = fs.readFileSync(path.join(ROOT, 'src/game.js'), 'utf8').match(/VERSION\s*=\s*'([^']+)'/);
  if (m) ver = m[1];
} catch (e) { /* 沒有就算了，報告裡寫 ? */ }

/* 自訂藍圖檔是給瀏覽器用的 classic script，靠全域看到 customBlueprint 與那些組合工具。
   node 這邊 require 回來的是模組物件，所以把每個匯出名字當參數注入進去。 */
const NAMES = Object.keys(BP);
function runScript(file) {
  const src = fs.readFileSync(file, 'utf8');
  try {
    new Function(...NAMES, src)(...NAMES.map(n => BP[n]));
    return null;
  } catch (e) {
    return (e && e.message) ? e.message : String(e);
  }
}

const dir = path.join(ROOT, 'blueprints');
const listFile = path.join(dir, 'list.js');
let files = [];
if (fs.existsSync(listFile)) {
  const src = fs.readFileSync(listFile, 'utf8');
  try {
    files = new Function('window', src + ';return typeof BP_FILES !== "undefined" ? BP_FILES : [];')({}) || [];
  } catch (e) {
    console.error('list.js 讀不動：' + e.message);
    process.exit(2);
  }
}

const loadErr = [];
for (const f of files) {
  const p = path.join(dir, f);
  if (!fs.existsSync(p)) { loadErr.push(f + '：list.js 列了這個檔名，但檔案不在'); continue; }
  const e = runScript(p);
  if (e) loadErr.push(f + '：載入時就出錯 → ' + e);
}

const arg = process.argv[2];
const custom = [];
for (let i = 0; i < BP.SHAPES.length; i++) if (BP.SHAPES[i].custom) custom.push(i);

let bad = 0;
if (loadErr.length) {
  bad += loadErr.length;
  console.log('=== 載入 ===');
  for (const e of loadErr) console.log('✘ ' + e);
  console.log('');
}

if (arg === '--all') {
  console.log('=== 全部 ' + BP.SHAPES.length + ' 座摘要（v' + ver + '）===');
  for (let i = 0; i < BP.SHAPES.length; i++) {
    const r = BP.checkBlueprint(i, { ver });
    if (r.fails.length) bad++;
    console.log((r.fails.length ? '✘' : (r.warns.length ? '⚠' : '✔')) + ' ' +
                BP.SHAPES[i].n +
                (r.fails.length ? '　必修：' + r.fails.join('；') : '') +
                (r.warns.length ? '　提醒：' + r.warns.join('；') : ''));
  }
} else {
  const list = arg ? [BP.bpIndexOf(arg)] : custom;
  if (!list.length) {
    console.log('blueprints/ 裡沒有自訂藍圖（list.js 是空的？）');
    process.exit(bad ? 1 : 0);
  }
  for (const i of list) {
    const r = BP.checkBlueprint(i < 0 ? arg : i, { ver });
    if (r.fails.length) bad++;
    console.log(r.text);
    console.log('');
  }
}
process.exit(bad ? 1 : 0);
