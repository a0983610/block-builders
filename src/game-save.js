/* ============================================================
   遊戲層 · 紀錄、成就、存檔
   從 game.js 拆出來的一段（v1.120.1）。classic script、共用同一份全域 scope，
   跟原本寫在同一支檔裡完全等價；五支的分工與載入順序見 src/game.js 檔頭。
   ============================================================ */
'use strict';

/* ── 紀錄 · 成就 · 存檔 ───────────────────────────────── */
const WRECK_AT = 0.25;              // 剩下不到這個比例就算拆完了，換下一座
/* 但不要立刻換：拆完那一下常常是核彈或魔法陣，火球、蘑菇雲、滿地碎料都還在演，
   立刻叫推土機進場等於把那一發的收尾剪掉。先站在原地看這麼久再收拾。 */
const SWAP_WAIT = 3;
let swapWait = 0;                   // 已經等了幾秒（跟著模擬時間走，開快轉就等得短）
const WAGE = 3;                     // 每個小人每秒的人力成本（$）
/* 每塊積木從建築上掉下來，算多少損失。訂在 85 是要讓「拆一座」的數字有份量：
   一千塊的建築拆完約 $85,000，跟蓋它花掉的人力錢是同一個量級。 */
const WRECK_COST = 85;
const SAVE_KEY = 'block-builders/save1';
const SAVE_MAGIC = 'BB1';
const SAVE_XOR = 'winton-block-builders-2026';

const freshStats = () => ({
  destroyed: 0, smashed: 0, carried: 0, poked: 0, spent: 0, wrecked: 0,
  bestHit: 0, bigBuild: 0, miracle: false, built: [], tools: [], badges: []
});
let stats = freshStats();
/* 面板上的設定也一起存，不然每次打開都要重調一輪 */
/* v 是設定檔版本。舊存檔沒有這個欄位，load() 靠它認出「這份存檔是預設值改掉之前存的」 */
const freshPref = () => ({ cnt: 3000, wk: 20, spd: 1, mute: false, spin: false, v: 1 });
let pref = freshPref();
let spentThis = 0;
let lossThis = 0;                   // 這一座造成的損失（換建築時歸零）
let savable = true;                 // 無痕模式之類的存不了，就安靜降級

const BADGES = [
  /* 排列順序＝面板上的顯示順序（兩欄，橫向填）。同一件事的兩個門檻排在一起，
     一眼看得出「這個拿到了、下一階還沒」。 */
  { id: 'first', n: '開工大吉', d: '蓋完第一座建築', chk: s => s.built.length >= 1 },
  { id: 'miracle', n: '奇蹟工程', d: '3 分鐘內蓋完吉薩金字塔', chk: s => !!s.miracle },
  { id: 'bigBuild', n: '大興土木', d: '蓋完一座 2500 塊以上的建築', chk: s => s.bigBuild >= 2500 },
  { id: 'world10', n: '環遊世界', d: '蓋過 10 種不同建築', chk: s => s.built.length >= 10 },
  { id: 'worldAll', n: '地標蒐藏家', d: '蓋過全部 ' + SHAPES.length + ' 種建築',
    chk: s => s.built.length >= SHAPES.length },
  { id: 'move10k', n: '愚公移山', d: '小人累計搬運 10000 塊', chk: s => s.carried >= 10000 },
  { id: 'move100k', n: '工蟻軍團', d: '小人累計搬運 100000 塊', chk: s => s.carried >= 100000 },
  { id: 'demo50', n: '拆遷大隊', d: '一次擊飛超過 50 塊積木', chk: s => s.bestHit > 50 },
  { id: 'hit200', n: '一發清空', d: '一次擊飛超過 200 塊積木', chk: s => s.bestHit > 200 },
  { id: 'smash50k', n: '粉塵滿天', d: '累計擊飛 50000 塊積木', chk: s => s.smashed >= 50000 },
  { id: 'wreck5', n: '拆屋大亨', d: '拆掉 5 座建築', chk: s => s.destroyed >= 5 },
  { id: 'wreck25', n: '都市更新', d: '拆掉 25 座建築', chk: s => s.destroyed >= 25 },
  { id: 'allTools', n: '工具箱清空', d: '十八種道具都用過', chk: s => s.tools.length >= TOOLS.length },
  { id: 'boss20', n: '工頭嚴厲', d: '戳倒小人 20 次', chk: s => s.poked >= 20 },
  { id: 'poke100', n: '工安黑名單', d: '戳倒小人 100 次', chk: s => s.poked >= 100 },
  { id: 'million', n: '百萬工程', d: '累計人力支出破 $1,000,000', chk: s => s.spent >= 1e6 },
  { id: 'spend10m', n: '無底錢坑', d: '累計人力支出破 $10,000,000', chk: s => s.spent >= 1e7 },
  { id: 'loss100k', n: '災情慘重', d: '累計造成 $100,000 損失', chk: s => s.wrecked >= 1e5 },
  { id: 'loss2m', n: '保險公司拒保', d: '累計造成 $2,000,000 損失', chk: s => s.wrecked >= 2e6 }
];

let toasts = [];
function toast(txt, sub) {
  toasts.push({ txt, sub: sub || '', t: 4 });
  if (toasts.length > 3) toasts.shift();
  renderToasts();
}
function checkBadges() {
  let got = false;
  for (const b of BADGES) {
    if (stats.badges.indexOf(b.id) >= 0) continue;
    if (!b.chk(stats)) continue;
    stats.badges.push(b.id);
    toast('🏅 ' + b.n, b.d);
    got = true;
  }
  if (got) { sndBadge(); save(); renderBadges(); }
  return got;
}
function noteBuilt() {
  if (!bp) return;
  if (stats.built.indexOf(bp.name) < 0) stats.built.push(bp.name);
  if (bp.slots.length > stats.bigBuild) stats.bigBuild = bp.slots.length;
  if (bp.name === '吉薩金字塔' && buildElapsed > 0 && buildElapsed <= 180) stats.miracle = true;
  checkBadges();
  save();
}

/* 存檔：JSON → 校驗碼 → UTF-8 → XOR → base64。
   不是真的加密（前端沒有真加密可言），目的是讓存檔不能隨手改，
   改壞了校驗碼對不上就當作沒有存檔，不會讓程式吃到爛資料。 */
function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
function xorBytes(bytes) {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] ^ SAVE_XOR.charCodeAt(i % SAVE_XOR.length);
  return out;
}
function packSave(obj) {
  const body = JSON.stringify(obj);
  const bytes = xorBytes(new TextEncoder().encode(SAVE_MAGIC + '|' + hashStr(body) + '|' + body));
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function unpackSave(txt) {
  const bin = atob(txt);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const raw = new TextDecoder().decode(xorBytes(bytes));
  const p = raw.split('|');
  if (p[0] !== SAVE_MAGIC) return null;
  const body = p.slice(2).join('|');
  if (hashStr(body) !== p[1]) return null;      // 被動過手腳
  return JSON.parse(body);
}
let saveT = 0;
/* 只把存檔裡型別對得上的欄位搬過來，其他一律用預設值。
   這樣舊版存檔、被改過的存檔都不會讓程式吃到奇怪的東西。 */
function merge(fresh, src) {
  const out = fresh;
  if (src) for (const k in out) if (src[k] !== undefined && typeof src[k] === typeof out[k]) out[k] = src[k];
  return out;
}
function save() {
  if (!savable) return;
  try { localStorage.setItem(SAVE_KEY, packSave({ s: stats, p: pref })); }
  catch (e) { savable = false; }
}
function load() {
  try {
    const txt = localStorage.getItem(SAVE_KEY);
    if (!txt) return;
    const o = unpackSave(txt);
    if (!o || !o.s) return;
    applySave(o);
  } catch (e) { savable = false; }
}
/* 把一份解包好的存檔套進 stats／pref。開場的 load() 與「匯入存檔」都走這裡——
   兩邊都要做同一套整理（認不得的成就丟掉、舊版設定吸到最近的一檔），
   各寫一份的話遲早會有一邊漏掉。這一層不碰 DOM，畫面由呼叫端自己刷。 */
function applySave(o) {
  const f = merge(freshStats(), o.s);
  // 認得的才留：存檔被改過、或舊版留下已經不存在的 id，都不要讓它影響成就判定
  f.badges = f.badges.filter(id => BADGES.some(b => b.id === id));
  f.tools = f.tools.filter(id => TOOLS.some(t => t.id === id));
  stats = f;
  const g = merge(freshPref(), o.p);
  /* 沒有版本欄位＝預設建材還是 900 那個年代存的。那時候的 900 分不出是玩家挑的
     還是預設值，所以一次性換成新預設，不然改了預設的人永遠看不到 3000。 */
  if (o.p && o.p.v === undefined) g.cnt = freshPref().cnt;
  /* 面板改成三檔按鈕之後，中間值選不出來了：舊存檔（還有被改壞的存檔）
     一律吸到最近的一檔。不吸的話畫面上會三顆都不亮，跑的卻是第四個數字。 */
  g.cnt = snapOpt(g.cnt, CNT_OPTS);
  g.wk = snapOpt(g.wk, WK_OPTS);
  g.spd = snapOpt(g.spd, SPD_OPTS);
  pref = g;
}
/* 數字吸到最近的一檔。壞掉的存檔（NaN、字串）當 0 處理，會吸到最小的那一檔 */
function snapOpt(v, opts) {
  const n = +v || 0;
  return opts.reduce((a, b) => Math.abs(b - n) < Math.abs(a - n) ? b : a);
}
/* 把存回來的設定套進變數與面板 */
function applyPref() {
  targetCnt = pref.cnt; timeScale = pref.spd; muted = pref.mute; spinOn = pref.spin;
  setWorkerCount(pref.wk);
  $('mute').checked = pref.mute;
  $('spin').checked = pref.spin;
  syncHud();
}
function resetSave() {
  stats = freshStats(); spentThis = 0;
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* 存不了就算了 */ }
  renderBadges(); renderTools(); syncHud();
}

