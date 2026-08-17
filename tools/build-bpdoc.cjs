/* ============================================================
   把〈blueprints/藍圖製作說明.md〉包成一支 JS（src/bpdoc.js）
   跑法：node tools/build-bpdoc.cjs　（改過那份 .md 之後就要重跑一次）

   為什麼要包一份：遊戲是 file:// 直接開的，fetch 讀不到旁邊的 .md（CORS 擋掉），
   而遊戲裡「匯入建築 → 取得 prompt」要把整份說明放進剪貼簿——玩家拿它去餵
   網頁版 AI，AI 才知道要產出什麼格式的藍圖。

   e2e 有一條測試比對 BP_DOC 與那份 .md 逐字相同，忘了重跑會被擋下來。
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'blueprints/藍圖製作說明.md');
const OUT = path.join(ROOT, 'src/bpdoc.js');

/* 統一成 \n：工作區是 CRLF、git 存 LF，不統一的話這支檔會隨著誰跑而變動 */
const md = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');

const js =
  '/* 這支檔是 tools/build-bpdoc.cjs 產出來的，不要手改。\n' +
  '   來源：blueprints/藍圖製作說明.md（改了那邊就重跑一次那支工具）。\n' +
  '   為什麼要包一份：遊戲是 file:// 開的，fetch 讀不到旁邊的 .md（CORS 擋掉），\n' +
  '   而「匯入建築 → 取得 prompt」要把整份說明放進剪貼簿。 */\n' +
  'const BP_DOC = ' + JSON.stringify(md) + ';\n';

fs.writeFileSync(OUT, js);
console.log('src/bpdoc.js ← blueprints/藍圖製作說明.md（' + md.length + ' 字）');
