/* ============================================================
   查「見 開發筆記〈段名〉」有沒有斷線：段名要找得到真的標題
   跑法：node tools/check-notes.cjs　（幾秒；有斷線 exit 1、沒有 exit 0）

   CLAUDE.md〈寫文件〉：程式裡回指筆記一律寫 `見 開發筆記〈段名〉`，之後是拿段名去 grep 找回來的，
   所以段名寫錯就是一條斷掉的線（〈不要寫死會隨改動變動的數字〉被引用了十幾處，標題到 v1.250.1 才補上）。

   查兩種：
     ① 所有程式／文件裡的「開發筆記〈…〉」（中間可以夾「.md」、空白、反引號）→ 對 開發筆記.md 的標題
     ② 開發筆記.md 自己裡面的「見〈…〉」→ 對 開發筆記.md、CLAUDE.md、README.md、藍圖製作說明.md 的標題
   怎樣算對上（v1.271.0 量過現況定的）：**有一個標題包含段名的整串字**——拿段名 grep 會落在那個標題上。
   現有的引用多半省略標題尾巴的（v1.xxx）、或只寫冒號前半，這兩種照這條都算對上。
   對不上的分兩種印：
     標點不同 ＝ 拿掉「」『』` * 和空白之後才對上（grep 找不到，照印出來的標題改就好）
     找不到   ＝ 怎樣都對不上，附上字面最像的那個標題當參考（不一定就是它，要自己看）
   不查的：.md 裡包在反引號裡的（那是在講寫法的範本，例如 `見 開發筆記〈段名〉`）、只有「…」的、
   「…」結尾的只拿前半比。
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const NOTES = '開發筆記.md';
const OTHER_DOCS = ['CLAUDE.md', 'README.md', 'blueprints/藍圖製作說明.md'];

const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const headsOf = f => read(f).split(/\r?\n/).filter(l => /^#{1,6} /.test(l)).map(l => l.replace(/^#+\s+/, '').trim());
const noteHeads = headsOf(NOTES);
const allHeads = noteHeads.concat(...OTHER_DOCS.filter(f => fs.existsSync(path.join(ROOT, f))).map(headsOf));

/* 要掃的檔：程式（src、tools、blueprints）、兩頁 html、幾份文件 */
const files = [];
for (const d of ['src', 'tools', 'blueprints']) {
  for (const f of fs.readdirSync(path.join(ROOT, d))) {
    if (/\.(js|cjs|py|bat|html|md)$/.test(f) && f !== path.basename(__filename)) files.push(d + '/' + f);   // 自己的 regex 不算
  }
}
files.push('index.html', '藍圖預覽.html', 'CLAUDE.md', 'README.md', NOTES);

const loose = s => s.replace(/[「」『』`*\s]/g, '');
/* 字面像不像：兩個字一組的重疊比例（Dice），只拿來挑「最像的那個」當參考 */
const grams = s => { const g = new Map(); for (let i = 0; i < s.length - 1; i++) { const k = s.slice(i, i + 2); g.set(k, (g.get(k) || 0) + 1); } return g; };
const dice = (a, b) => {
  const A = grams(a), B = grams(b);
  let hit = 0, n = 0;
  for (const [k, v] of A) { n += v; hit += Math.min(v, B.get(k) || 0); }
  for (const v of B.values()) n += v;
  return n ? 2 * hit / n : 0;
};
/* .md 的一行裡，哪些位置在反引號裡面 */
const inCode = (line, at) => {
  let open = false;
  for (let i = 0; i < at; i++) if (line[i] === '`') open = !open;
  return open;
};

const bad = [];
let total = 0;
for (const f of files) {
  const md = f.endsWith('.md');
  const lines = read(f).split(/\r?\n/);
  lines.forEach((line, li) => {
    const pats = [{ re: /開發筆記[^〈\n]{0,6}〈([^〉\n]+)〉/g, heads: noteHeads }];
    if (f === NOTES) pats.push({ re: /(?<!開發筆記[^〈\n]{0,6})見〈([^〉\n]+)〉/g, heads: allHeads });
    for (const { re, heads } of pats) {
      let m;
      while ((m = re.exec(line))) {
        const at = m.index + m[0].indexOf('〈');
        if (md && inCode(line, at)) continue;
        let ref = m[1].trim();
        if (/^[…\.]+$/.test(ref)) continue;
        ref = ref.replace(/[…]+$|\.{3}$/, '');
        total++;
        if (heads.some(h => h.includes(ref))) continue;
        const near = heads.find(h => loose(h).includes(loose(ref)));
        if (near) { bad.push({ f, line: li + 1, ref, kind: '標點不同', h: near }); continue; }
        let best = null, bs = 0;
        for (const h of heads) { const s = dice(ref, h); if (s > bs) { bs = s; best = h; } }
        bad.push({ f, line: li + 1, ref, kind: '找不到', h: bs >= 0.3 ? best : null });
      }
    }
  });
}

if (!bad.length) {
  console.log('段名全部對得上：' + total + ' 處引用（' + NOTES + ' ' + noteHeads.length + ' 個標題）');
  process.exit(0);
}
console.log(total + ' 處引用，' + bad.length + ' 處對不上：\n');
for (const b of bad) {
  console.log('  ' + b.f + ':' + b.line + '　〈' + b.ref + '〉　' + b.kind);
  if (b.h) console.log('      ' + (b.kind === '標點不同' ? '真的標題：' : '最像的標題：') + b.h);
}
process.exit(1);
