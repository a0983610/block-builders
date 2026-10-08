/* ============================================================
   改版本號：四個地方一次改齊（見 CLAUDE.md〈版本號：三個地方要一致〉）
   跑法：
     node tools/bump-version.cjs           只看：印出四個地方現在各寫什麼、一不一致（不改檔）
     node tools/bump-version.cjs patch     x.y.z → x.y.(z+1)　一般改動
     node tools/bump-version.cjs minor     x.y.z → x.(y+1).0　功能性改動
     node tools/bump-version.cjs 1.2.3     直接指定（四個地方對不齊的時候也可以拿它一次對齊）

   四個地方：
     src/game.js       const VERSION = 'x.y.z';      本尊
     README.md         第一行的 `vx.y.z`             e2e 有一條比對
     藍圖預覽.html      const VIEWER_VER = 'x.y.z';  那一頁不載遊戲層，e2e 另一條比對
     開發筆記.md        第一行的 `vx.y.z`             沒有測試守著，順手跟著寫

   patch／minor 要四個地方本來就一致才動（不一致的話「下一版」是從哪一個算起說不準），
   不一致就整個不改、印出各寫什麼。只換掉版本號那幾個字，檔案其餘部分（含 CRLF）一個位元都不動。
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const V = '(\\d+\\.\\d+\\.\\d+)';
/* re 的第 2 組是版本號，第 1、3 組是前後原封不動接回去的部分 */
const SPOTS = [
  { file: 'src/game.js',    re: new RegExp("^(const VERSION = ')" + V + "(';)", 'm') },
  { file: 'README.md',      re: new RegExp('^(\\uFEFF?#[^\\r\\n]*`v)' + V + '(`)') },
  { file: '藍圖預覽.html',   re: new RegExp("(const VIEWER_VER = ')" + V + "(';)") },
  { file: '開發筆記.md',     re: new RegExp('^(\\uFEFF?#[^\\r\\n]*`v)' + V + '(`)') },
];

const arg = process.argv[2];
const read = s => fs.readFileSync(path.join(ROOT, s.file), 'utf8');
const now = SPOTS.map(s => {
  const m = read(s).match(s.re);
  return m ? m[2] : null;
});

/* 對齊用：全形算兩格（同 e2e-3d.cjs --list 那一支 wide） */
const wide = t => t.replace(/[⺀-〾ぁ-㏿㐀-䶿一-鿿豈-﫿！-｠]/g, '..').length;
const width = Math.max(...SPOTS.map(s => wide(s.file)));
const table = vs => SPOTS.map((s, i) => '  ' + s.file + ' '.repeat(width - wide(s.file)) + '  ' +
                                        (vs[i] || '（找不到版本號）')).join('\n');

if (now.some(v => !v)) {
  console.log('有地方找不到版本號（格式被改過？），一個都沒改：\n' + table(now));
  process.exit(1);
}
const same = now.every(v => v === now[0]);

if (!arg) {
  console.log((same ? '四個地方一致：' + now[0] : '四個地方不一致：') + '\n' + table(now));
  process.exit(same ? 0 : 1);
}

let next;
if (arg === 'patch' || arg === 'minor') {
  if (!same) {
    console.log('四個地方不一致，不知道「下一版」從哪一個算起，一個都沒改。\n' +
                '用 node tools/bump-version.cjs x.y.z 直接指定就能一次對齊：\n' + table(now));
    process.exit(1);
  }
  const [a, b, c] = now[0].split('.').map(Number);
  next = arg === 'patch' ? [a, b, c + 1].join('.') : [a, b + 1, 0].join('.');
} else if (/^\d+\.\d+\.\d+$/.test(arg)) {
  next = arg;
} else {
  console.log('看不懂「' + arg + '」：要 patch、minor，或 x.y.z 這種三段版本號。');
  process.exit(2);
}

for (const s of SPOTS) {
  const f = path.join(ROOT, s.file);
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(s.re, (all, pre, v, post) => pre + next + post));
}
console.log((same ? now[0] : '（原本不一致）') + ' → ' + next + '\n' + table(SPOTS.map(s => read(s).match(s.re)[2])));
