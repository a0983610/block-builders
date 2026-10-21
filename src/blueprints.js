/* ============================================================
   藍圖：48 座建築與物件的 voxel 產生器（地標 36 ＋ 動物 4 ＋ 交通工具 4 ＋ 特殊 4）
   每座建築是一個吃尺度參數 s 的函式，畫出一堆 (x,y,z,顏色索引) 格子。
   積木數不是寫死的——makeBlueprint() 會掃 s 找出最接近目標積木數的那個尺寸，
   所以同一座金字塔可以是 300 塊也可以是 3000 塊。
   這支檔案不碰 three.js，純資料，方便單獨測。
   ============================================================ */
'use strict';

/* ── 參數檢查 ──────────────────────────────────────────────
   AI 產的藍圖最常見的死法是「呼叫畫圖函式時少給一個參數」，而它幾乎都是**靜默**的：
   少一個尺寸 → NaN 進迴圈 → Math.ceil(NaN) 讓迴圈一次都不跑 → 那個部件整組不見；
   少最後那個顏色 → 格子的 c 是 undefined → 配色算不出來、畫出來是黑的。
   兩種都不丟例外，體檢報告只看得到「塊數少了一截」，看不出原因，AI 也就修不到點上。
   所以每支畫圖函式進來先驗一次參數，把它變成一句講得清楚的例外——報告會把訊息
   原封不動印出來（checkBlueprint 的「gen() 出錯」那行），那是 AI 唯一的線索。

   kinds 一個字元對一個參數：v=VOX、n=數字、c=顏色索引、f=函式、s=字串、o=物件。
   只寫到「最後一個必要參數」為止，後面的可選參數不驗（arch 的 c、blob 的 shell 這種
   本來就可以不給）。訊息一律以「參數錯誤：」開頭，報告靠它挑出對應的修法。
   c 也收「顏色函式」(x, y, z) => 索引，真正的索引在 VOX.set 逐格算（見那裡的註解）。 */
const BP_KIND = {
  v: [o => !!o && typeof o.set === 'function' && typeof o.has === 'function', '一個 VOX（第一個參數要傳 v）'],
  n: [o => typeof o === 'number' && Number.isFinite(o), '數字'],
  c: [o => (typeof o === 'number' && Number.isInteger(o) && o >= 0) || typeof o === 'function',
      '顏色索引（pal 的第幾個，從 0 算，要整數），或回傳顏色索引的函式 (x, y, z) => …'],
  f: [o => typeof o === 'function', '函式'],
  s: [o => typeof o === 'string' && !!o, '字串'],
  o: [o => !!o && typeof o === 'object', '物件（具名參數）']
};
function bpShow(v) {
  if (typeof v === 'string') return "'" + v + "'";
  if (Array.isArray(v)) return '一個陣列';
  if (v !== null && typeof v === 'object') return '一個物件';
  return String(v);                       // undefined／null／NaN／true 都直接寫出來
}
function bpArgs(sig, kinds, vals) {
  for (let i = 0; i < kinds.length; i++) {
    const k = BP_KIND[kinds[i]];
    if (k[0](vals[i])) continue;
    const names = sig.slice(sig.indexOf('(') + 1, -1).split(',');
    throw new Error('參數錯誤：' + sig + ' 的第 ' + (i + 1) + ' 個參數 ' + names[i].trim() +
                    (vals[i] === undefined ? ' 沒給' : ' 收到 ' + bpShow(vals[i])) +
                    '，要的是' + k[1]);
  }
}
/* 吃具名物件的那兩支（windowGrid／lattice）：少一個鍵跟少一個位置參數一樣靜默。 */
function bpKeys(sig, o, keys) {
  for (const k of keys.split(' ')) {
    const v = o[k];
    if (typeof v === 'number' && Number.isFinite(v)) continue;
    if (k === 'c' && typeof v === 'function') continue;        // 顏色函式，同 BP_KIND.c
    throw new Error('參數錯誤：' + sig + ' 的 ' + k +
                    (v === undefined ? ' 沒給' : ' 收到 ' + bpShow(v)) +
                    (k === 'c' ? '，要的是' + BP_KIND.c[1] : '，要的是數字'));
  }
}

/* ── voxel 收集器 ──────────────────────────────────────────
   用 Map 去重，後寫的蓋掉先寫的——很多造型是「先填實心再挖洞」。 */
function VOX() { this.m = new Map(); }
VOX.prototype = {
  constructor: VOX,
  set(x, y, z, c) {
    /* 每一格都會走這裡，所以直接比、不配陣列（bpArgs 那條路只有真的出事時才走）。
       上游哪一支算出 NaN、或忘了給顏色，最後都會流到這裡——擋在這裡等於一次守住全部。

       c 要求**整數**，而且是在這裡擋、不是在上面補 Math.round(c)：座標有取整，
       所以「c 也會被取整」看起來很合理，但 pal[2.5] 是 undefined，遊戲那邊
       (undefined >> 16) & 255 算出 0 → 畫成一塊純黑積木（game.js 上色那段），
       而體檢的「索引超出 pal」查的是 maxC >= pal.length，2.5 < 3 過得去。
       補 round 只是從「作者算錯索引」變成「靜默畫上一個沒人指定的顏色」——
       那正是這一整段驗證在避的事（見檔頭與 ellipseRing 的 thick）。

       c 也可以是**顏色函式** (x, y, z) => 索引：每支畫圖函式最後都走到這裡，所以在這裡
       逐格算一次，二十支工具就全都「蓋的當下就挑色」——拿到的是取整之後真正落格的座標。
       為什麼要它：blob／limb／revolve 一格只能給一個顏色，石牆的雜色、旋轉體上下兩面不同色、
       毛皮的明暗都只能自己寫逐格迴圈或蓋完再掃（內建動物為此另做了 voxGrid 的 E／L，
       43 支自訂藍圖有 16 支各寫一份雜湊、說明書得附兩段手寫迴圈）。
       回傳值照樣要是整數索引，不是就丟例外，不默默跳過——理由同上面那段。
       見 開發筆記〈顏色函式：畫圖工具的 c 可以給函式〉。 */
    if (typeof c === 'function') {
      if (!Number.isFinite(x + y + z)) bpArgs('v.set(x, y, z, c)', 'nnn', [x, y, z]);
      x = Math.round(x); y = Math.round(y); z = Math.round(z);
      if (y < 0) return;
      const got = c(x, y, z);
      if (!(typeof got === 'number' && Number.isInteger(got) && got >= 0))
        throw new Error('參數錯誤：顏色函式在 (' + x + ', ' + y + ', ' + z + ') 回傳 ' + bpShow(got) +
                        '，要的是顏色索引（pal 的第幾個，從 0 算，要整數）');
      this.m.set(x + ':' + y + ':' + z, got);
      return;
    }
    if (!(typeof c === 'number' && Number.isInteger(c) && c >= 0) || !Number.isFinite(x + y + z))
      bpArgs('v.set(x, y, z, c)', 'nnnc', [x, y, z, c]);
    x = Math.round(x); y = Math.round(y); z = Math.round(z);
    if (y < 0) return;
    this.m.set(x + ':' + y + ':' + z, c);
  },
  del(x, y, z) { this.m.delete(Math.round(x) + ':' + Math.round(y) + ':' + Math.round(z)); },
  has(x, y, z) { return this.m.has(Math.round(x) + ':' + Math.round(y) + ':' + Math.round(z)); },

  /* 實心長方體。x0/z0 是中心，y0 是底面所在層 */
  box(x0, y0, z0, w, h, d, c) {
    bpArgs('v.box(x0, y0, z0, w, h, d, c)', 'nnnnnnc', [x0, y0, z0, w, h, d, c]);
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h)); d = Math.max(1, Math.round(d));
    const hx = (w - 1) / 2, hz = (d - 1) / 2;
    for (let y = 0; y < h; y++) for (let i = 0; i < w; i++) for (let k = 0; k < d; k++)
      this.set(x0 - hx + i, y0 + y, z0 - hz + k, c);
  },
  /* 只留四面牆，t 是牆厚 */
  walls(x0, y0, z0, w, h, d, c, t) {
    bpArgs('v.walls(x0, y0, z0, w, h, d, c, t)', 'nnnnnnc', [x0, y0, z0, w, h, d, c]);
    t = t || 1;
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h)); d = Math.max(1, Math.round(d));
    const hx = (w - 1) / 2, hz = (d - 1) / 2;
    for (let y = 0; y < h; y++) for (let i = 0; i < w; i++) for (let k = 0; k < d; k++) {
      if (i >= t && i < w - t && k >= t && k < d - t) continue;
      this.set(x0 - hx + i, y0 + y, z0 - hz + k, c);
    }
  },
  /* 挖空一塊長方體 */
  carve(x0, y0, z0, w, h, d) {
    bpArgs('v.carve(x0, y0, z0, w, h, d)', 'nnnnnn', [x0, y0, z0, w, h, d]);
    const hx = (w - 1) / 2, hz = (d - 1) / 2;
    for (let y = 0; y < h; y++) for (let i = 0; i < w; i++) for (let k = 0; k < d; k++)
      this.del(x0 - hx + i, y0 + y, z0 - hz + k);
  },
  /* 圓柱（voxel 近似）。hollow 給牆厚就只留外環 */
  cyl(x0, y0, z0, r, h, c, hollow) {
    bpArgs('v.cyl(x0, y0, z0, r, h, c, hollow)', 'nnnnnc', [x0, y0, z0, r, h, c]);
    const R = Math.max(0.5, r), ri = hollow ? R - hollow : -1;
    const n = Math.ceil(R);
    for (let y = 0; y < h; y++) for (let i = -n; i <= n; i++) for (let k = -n; k <= n; k++) {
      const d = Math.hypot(i, k);
      if (d > R + 0.35 || d < ri) continue;
      this.set(x0 + i, y0 + y, z0 + k, c);
    }
  },
  /* 橢圓環（競技場、摩天輪底座用） */
  ellipseRing(x0, y0, z0, rx, rz, h, c, thick) {
    /* thick 沒給的話 rx - thick 是 NaN，內圈判定整個失效——畫出來會是一坨實心橢圓
       而不是環。這種「有畫東西、但畫錯」比不畫還難查，所以它是必要參數。 */
    bpArgs('v.ellipseRing(x0, y0, z0, rx, rz, h, c, thick)', 'nnnnnncn',
           [x0, y0, z0, rx, rz, h, c, thick]);
    const nx = Math.ceil(rx), nz = Math.ceil(rz);
    for (let y = 0; y < h; y++) for (let i = -nx; i <= nx; i++) for (let k = -nz; k <= nz; k++) {
      const o = Math.hypot(i / rx, k / rz);
      const inn = Math.hypot(i / (rx - thick), k / (rz - thick));
      if (o > 1.06 || inn < 1) continue;
      this.set(x0 + i, y0 + y, z0 + k, c);
    }
  },
  /* 收斂柱體：底半徑 r0 收到頂半徑 r1。shell 給牆厚就中空 */
  taper(x0, y0, z0, r0, r1, h, c, shell) {
    bpArgs('v.taper(x0, y0, z0, r0, r1, h, c, shell)', 'nnnnnnc', [x0, y0, z0, r0, r1, h, c]);
    for (let y = 0; y < h; y++) {
      const r = r0 + (r1 - r0) * (h <= 1 ? 0 : y / (h - 1));
      const n = Math.ceil(r);
      for (let i = -n; i <= n; i++) for (let k = -n; k <= n; k++) {
        const d = Math.hypot(i, k);
        if (d > r + 0.35) continue;
        if (shell && d < r - shell) continue;
        this.set(x0 + i, y0 + y, z0 + k, c);
      }
    }
  },
  /* 方錐（階梯金字塔）。step 是每層縮幾格 */
  pyramid(x0, y0, z0, b, c, step) {
    bpArgs('v.pyramid(x0, y0, z0, b, c, step)', 'nnnnc', [x0, y0, z0, b, c]);
    step = step || 1;
    let w = b, y = 0;
    while (w >= 1) { this.box(x0, y0 + y, z0, w, 1, w, c); w -= step * 2; y++; }
  },
  /* 圓頂（只做殼，實心太吃積木） */
  dome(x0, y0, z0, r, c, squash) {
    bpArgs('v.dome(x0, y0, z0, r, c, squash)', 'nnnnc', [x0, y0, z0, r, c]);
    squash = squash || 1;
    const n = Math.ceil(r);
    for (let y = 0; y <= Math.ceil(r * squash); y++) for (let i = -n; i <= n; i++) for (let k = -n; k <= n; k++) {
      const d = Math.sqrt(i * i + k * k + (y / squash) * (y / squash));
      if (Math.abs(d - r) > 0.6) continue;
      this.set(x0 + i, y0 + y, z0 + k, c);
    }
  },
  /* 洋蔥頂（聖巴索、天壇用）：先鼓出來再收尖 */
  onion(x0, y0, z0, r, h, c) {
    bpArgs('v.onion(x0, y0, z0, r, h, c)', 'nnnnnc', [x0, y0, z0, r, h, c]);
    for (let y = 0; y < h; y++) {
      const t = y / (h - 1);
      const rr = r * Math.sin(Math.PI * (0.18 + t * 0.78)) * (1 - t * 0.15);
      const n = Math.ceil(rr);
      for (let i = -n; i <= n; i++) for (let k = -n; k <= n; k++) {
        const d = Math.hypot(i, k);
        if (Math.abs(d - rr) > 0.6 && !(t > 0.93 && d <= rr)) continue;
        this.set(x0 + i, y0 + y, z0 + k, c);
      }
    }
  },
  /* 屋簷（東方建築的關鍵造型）：一圈比下面寬的簷邊。
     只畫外圈不填滿——中間會被上一層塔身蓋住，填實心純粹浪費幾百塊積木。 */
  eave(x0, y0, z0, w, d, c, layers) {
    bpArgs('v.eave(x0, y0, z0, w, d, c, layers)', 'nnnnnc', [x0, y0, z0, w, d, c]);
    layers = layers || 2;
    for (let l = 0; l < layers; l++)
      this.walls(x0, y0 + l, z0, w - l * 2, 1, d - l * 2, c, 2);
  },
  /* 兩點之間拉一條線（鐵塔斜撐、吊索用） */
  line(x0, y0, z0, x1, y1, z1, c) {
    bpArgs('v.line(x0, y0, z0, x1, y1, z1, c)', 'nnnnnnc', [x0, y0, z0, x1, y1, z1, c]);
    const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)));
    for (let i = 0; i <= n; i++) {
      const t = n ? i / n : 0;
      this.set(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, z0 + (z1 - z0) * t, c);
    }
  },
  /* 山牆屋頂（神廟、房子用） */
  gable(x0, y0, z0, w, d, c) {
    bpArgs('v.gable(x0, y0, z0, w, d, c)', 'nnnnnc', [x0, y0, z0, w, d, c]);
    let ww = w, y = 0;
    while (ww >= 1) { this.box(x0, y0 + y, z0, ww, 1, d, c); ww -= 2; y++; }
  },
  cells() {
    const out = [];
    for (const [k, c] of this.m) {
      const p = k.split(':');
      out.push({ x: +p[0], y: +p[1], z: +p[2], c: c });
    }
    return out;
  }
};

/* 對稱擺放小工具：在四個角各放一次 */
function corners4(v, dx, dz, fn) {
  bpArgs('corners4(v, dx, dz, fn)', 'vnnf', [v, dx, dz, fn]);
  fn(v, dx, dz); fn(v, -dx, dz); fn(v, dx, -dz); fn(v, -dx, -dz);
}

/* 臥式圓柱（沿 z 軸躺著）。VOX.cyl 畫的是站著的柱子，
   火車鍋爐、飛機機身、引擎這種橫躺的圓柱得另外來。hollow 給牆厚就只留外殼。 */
function tubeZ(v, x0, y0, z0, r, len, c, hollow) {
  bpArgs('tubeZ(v, x0, y0, z0, r, len, c, hollow)', 'vnnnnnc', [v, x0, y0, z0, r, len, c]);
  const n = Math.ceil(r), ri = hollow ? r - hollow : -1;
  for (let k = 0; k < len; k++)
    for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
      const d = Math.hypot(i, j);
      if (d > r + 0.35 || d < ri) continue;
      v.set(x0 + i, y0 + j, z0 + k, c);
    }
}

/* 車輪：圓面立在 y–z 平面上、厚度沿 x（車軸方向），x0 是靠外那一面。
   rim 給了就把外圈一圈換成輪箍色。 */
function wheelX(v, x0, y0, z0, r, t, c, rim) {
  bpArgs('wheelX(v, x0, y0, z0, r, t, c, rim)', 'vnnnnnc', [v, x0, y0, z0, r, t, c]);
  const n = Math.ceil(r);
  for (let a = 0; a < t; a++)
    for (let j = -n; j <= n; j++) for (let k = -n; k <= n; k++) {
      const d = Math.hypot(j, k);
      if (d > r + 0.35) continue;
      v.set(x0 + a, y0 + j, z0 + k, rim !== undefined && d > r - 1.2 ? rim : c);
    }
}

/* 只在「已經有積木」的格子上換色。眼睛、斑紋、骰子點數這種裝飾一律用它，
   不要用 v.set：曲面上算出來的座標常常落在空氣裡，那就長出一顆孤立的懸空格。 */
function tint(v, x, y, z, c) {
  bpArgs('tint(v, x, y, z, c)', 'vnnnc', [v, x, y, z, c]);
  if (!v.has(x, y, z)) return false;
  v.set(x, y, z, c);
  return true;
}

/* 從外面往裡掃，找到第一格實心的就換色。曲面（球面的臉、圓角的骰子）
   要在「表面」上畫東西就得這樣找，算不出正確的表面座標。 */
function paintFrom(v, x, y, z, dx, dy, dz, n, c) {
  bpArgs('paintFrom(v, x, y, z, dx, dy, dz, n, c)', 'vnnnnnnnc', [v, x, y, z, dx, dy, dz, n, c]);
  for (let i = n; i >= 0; i--)
    if (tint(v, x + dx * i, y + dy * i, z + dz * i, c)) return true;
  return false;
}

/* 實心（或帶殼）橢球——動物的軀幹、頭、木魚的身體都靠它。
   半徑刻意不取整：塊數才會隨尺度連續變化。整數邊長的量體會一階一階跳，
   跳幅大到怎麼掃都對不上目標塊數（骰子那座就是為此改用連續半徑的圓角立方）。 */
function blob(v, x0, y0, z0, rx, ry, rz, c, shell) {
  bpArgs('blob(v, x0, y0, z0, rx, ry, rz, c, shell)', 'vnnnnnnc', [v, x0, y0, z0, rx, ry, rz, c]);
  const nx = Math.ceil(rx), ny = Math.ceil(ry), nz = Math.ceil(rz);
  const inner = shell ? 1 - shell / Math.min(rx, ry, rz) : -1;
  for (let i = -nx; i <= nx; i++) for (let j = -ny; j <= ny; j++) for (let k = -nz; k <= nz; k++) {
    const d = Math.hypot(i / rx, j / ry, k / rz);
    if (d > 1.02 || d < inner) continue;
    v.set(x0 + i, y0 + j, z0 + k, c);
  }
}

/* 兩點之間長出一根**有粗細**的東西（膠囊／圓錐）：斜的手臂、大腿、脖子、尾巴、斜撐。
   為什麼要專門一支：box／cyl／taper 都只能站著或沿著某一軸躺著，斜的部件只能自己
   切成好幾段各挪一格——實測倉庫裡三尊人像（自由女神、獅身人面像、八卦山大佛；都是重畫前的版本，前兩尊 v1.285.0、大佛 v1.286.0 重畫）的四肢
   全是軸對齊的方塊疊起來的，而「人像不像」的第一名就是這個。

   做法是掃包圍盒、算每一格到那條線段的距離：先把格子投影到線段上（t 夾在 0～1，
   所以兩端是圓的、不會超出去），再拿那一點的半徑（r 線性收到 r1）去比。
   半徑刻意不取整，塊數才會隨尺度連續變化（跟 blob 同一個道理）。

   為什麼先拉一條 v.line 當骨幹：半徑小的時候（一節手指、細尾巴）光靠距離判定會斷成
   一截一截——線段上任一點到最近的格子中心最遠有 √3/2 ≈ 0.87 格，比 r 還大就整段沒東西。
   v.line 是照最長那一軸一格一格走的，補上去就保證接得起來。 */
function limb(v, o) {
  bpArgs('limb(v, { … })', 'vo', [v, o]);
  bpKeys('limb(v, { x, y, z, x1, y1, z1, r, c })', o, 'x y z x1 y1 z1 r c');
  const bx = o.x1 - o.x, by = o.y1 - o.y, bz = o.z1 - o.z;
  const len2 = bx * bx + by * by + bz * bz;
  /* r1 是選配的（不給就等粗），所以照慣例不驗——但算成 NaN 的話距離比對會全部落空，
     整根只剩骨幹那一條線。寧可退回「等粗」，也不要靜靜地只畫出一條線。 */
  const r0 = Math.max(0.5, o.r);
  const r1 = Math.max(0.5, Number.isFinite(o.r1) ? o.r1 : r0);
  const rm = Math.max(r0, r1);
  const x0 = Math.floor(Math.min(o.x, o.x1) - rm), xe = Math.ceil(Math.max(o.x, o.x1) + rm);
  const y0 = Math.floor(Math.min(o.y, o.y1) - rm), ye = Math.ceil(Math.max(o.y, o.y1) + rm);
  const z0 = Math.floor(Math.min(o.z, o.z1) - rm), ze = Math.ceil(Math.max(o.z, o.z1) + rm);
  v.line(o.x, o.y, o.z, o.x1, o.y1, o.z1, o.c);       // 骨幹：保證整根接得起來
  for (let x = x0; x <= xe; x++)
    for (let y = Math.max(0, y0); y <= ye; y++)       // y<0 的格子遊戲本來就會忽略，不用白掃
      for (let z = z0; z <= ze; z++) {
        const px = x - o.x, py = y - o.y, pz = z - o.z;
        let t = len2 ? (px * bx + py * by + pz * bz) / len2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        if (Math.hypot(px - bx * t, py - by * t, pz - bz * t) <= r0 + (r1 - r0) * t + 0.02)
          v.set(x, y, z, o.c);
      }
}

/* 沿折線的**薄片**：立在指定平面上、有寬度也有厚度的一條帶子。
   為什麼要專門一支：limb 是圓的（斜手臂、尾巴、脖子），box／cyl／taper 只能站著或
   沿某一軸躺著，而「平的、彎的、薄的」那一類——閃電形的尾巴、魚鰭、翅膜、旗子、
   招牌、緞帶、爪子——兩邊都做不出來。實測踩過：皮卡丘的閃電尾拿 box 一格一格疊，
   疊出來的是一片**躺在 x–z 平面的鋸齒板**（俯視圖一看就知道），而它該立在 y 方向。

   plane 決定薄片立在哪個平面，厚度就往剩下那一軸長：
     'xy' 正面那一片（厚度沿 z）　'zy' 側面那一片（厚度沿 x）　'xz' 躺平那一片（厚度沿 y）
   pts 是那個平面上的折線，**照 plane 的兩個字母順序給**（'zy' 就是 [[z, y], …]）；
   at 是第三軸的**中心**、t 是厚度、w 是帶子寬度。
   轉折處是圓的（跟 limb 一樣夾 t 在 0～1），所以折線在轉角接得起來、不會缺一塊。
   每一層都先拉一條 v.line 當骨幹：w 小的時候光靠距離判定會斷成一截一截。 */
function plate(v, o) {
  bpArgs('plate(v, { … })', 'vo', [v, o]);
  bpKeys('plate(v, { pts, plane, at, w, t, c })', o, 'at c');
  const pts = o.pts;
  if (!Array.isArray(pts) || pts.length < 2)
    throw new Error('參數錯誤：plate(v, { … }) 的 pts 要是至少兩個點的陣列，' +
                    '像 [[0, 0], [3, 5], [0, 9]]（照 plane 的字母順序給）');
  for (const p of pts)
    if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1]))
      throw new Error('參數錯誤：plate(v, { … }) 的 pts 每一個點都要是兩個數字，收到 ' + bpShow(p));
  const plane = o.plane || 'xy';
  if (plane !== 'xy' && plane !== 'zy' && plane !== 'xz')
    throw new Error('參數錯誤：plate(v, { … }) 的 plane 收到 ' + bpShow(o.plane) +
                    "，只能是 'xy'（正面）／'zy'（側面）／'xz'（躺平）");
  const w = Math.max(1, o.w || 1), t = Math.max(1, Math.round(o.t || 1));
  const hw = w / 2;
  /* 平面座標 (u, q) ＋ 第三軸偏移 k → 真正的 x/y/z。三種平面只差這個對應。 */
  const put = (u, q, k) => {
    if (plane === 'xy') v.set(u, q, o.at + k, o.c);
    else if (plane === 'zy') v.set(o.at + k, q, u, o.c);
    else v.set(u, o.at + k, q, o.c);
  };
  const spine = (au, aq, bu, bq, k) => {
    if (plane === 'xy') v.line(au, aq, o.at + k, bu, bq, o.at + k, o.c);
    else if (plane === 'zy') v.line(o.at + k, aq, au, o.at + k, bq, bu, o.c);
    else v.line(au, o.at + k, aq, bu, o.at + k, bq, o.c);
  };
  for (let s = 0; s + 1 < pts.length; s++) {
    const au = pts[s][0], aq = pts[s][1], bu = pts[s + 1][0], bq = pts[s + 1][1];
    const du = bu - au, dq = bq - aq, len2 = du * du + dq * dq;
    for (let i = 0; i < t; i++) spine(au, aq, bu, bq, i - (t - 1) / 2);
    const u0 = Math.floor(Math.min(au, bu) - hw), u1 = Math.ceil(Math.max(au, bu) + hw);
    const q0 = Math.floor(Math.min(aq, bq) - hw), q1 = Math.ceil(Math.max(aq, bq) + hw);
    for (let u = u0; u <= u1; u++)
      for (let q = q0; q <= q1; q++) {
        const pu = u - au, pq = q - aq;
        let tt = len2 ? (pu * du + pq * dq) / len2 : 0;
        tt = tt < 0 ? 0 : tt > 1 ? 1 : tt;
        if (Math.hypot(pu - du * tt, pq - dq * tt) > hw + 0.02) continue;
        for (let i = 0; i < t; i++) put(u, q, i - (t - 1) / 2);
      }
  }
}

/* 剖面線繞 y 軸轉一圈：杯子、瓶子、碗、鐘、燈罩、花瓶、棋子、香爐、輪胎。
   prof 是 [[半徑, 高度], …]，高度相對 y（會自己照小到大排），轉折點之間線性內插——
   所以給幾個點就夠：一個馬克杯大約四點（杯底、腰、杯口下緣、外翻的厚邊）。
   為什麼要專門一支：這一類東西現在只能一段一段疊 cyl／taper，疊出來的接縫是硬階，
   而且每加一節就多一行、尺度一縮就對不齊。
   半徑刻意不取整，塊數才會隨尺度連續變化（跟 blob／limb 同一個道理）。
   shell 給了就只留外壁（中空的容器）；**杯底自己補一片 v.cyl**——跟 cyl 的 hollow 一致。 */
function revolve(v, o) {
  bpArgs('revolve(v, { … })', 'vo', [v, o]);
  bpKeys('revolve(v, { x, y, z, prof, c, shell })', o, 'x y z c');
  const prof = Array.isArray(o.prof) ? o.prof.slice() : null;
  if (!prof || prof.length < 2)
    throw new Error('參數錯誤：revolve(v, { … }) 的 prof 要是至少兩個 [半徑, 高度] 的陣列，' +
                    '像 [[3, 0], [3, 8], [4, 9]]');
  for (const p of prof)
    if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1]))
      throw new Error('參數錯誤：revolve(v, { … }) 的 prof 每一項都要是 [半徑, 高度] 兩個數字，' +
                      '收到 ' + bpShow(p));
  prof.sort((a, b) => a[1] - b[1]);
  const base = prof[0][1], top = Math.round(prof[prof.length - 1][1] - base);
  let k = 0;
  for (let j = 0; j <= top; j++) {
    const hy = base + j;
    while (k + 2 < prof.length && hy > prof[k + 1][1]) k++;   // j 只增不減，所以往前推就好
    const a = prof[k], b = prof[k + 1], span = b[1] - a[1];
    const tt = span > 0 ? Math.min(1, Math.max(0, (hy - a[1]) / span)) : 0;
    const r = Math.max(0, a[0] + (b[0] - a[0]) * tt);
    const n = Math.ceil(r);
    const inner = o.shell ? r - o.shell : -1;
    for (let i = -n; i <= n; i++)
      for (let m = -n; m <= n; m++) {
        const d = Math.hypot(i, m);
        if (d > r + 0.02 || d < inner) continue;
        v.set(o.x + i, o.y + j, o.z + m, o.c);
      }
  }
}

/* ── 組合工具（藍圖作者用）─────────────────────────────────
   下面這些不是 VOX 的方法，是包在外面的組合函式：48 座裡反覆手刻的那幾件事
   （尺寸下限、排成一圈、拱門、對稱、階梯、四坡頂、立面開窗、斜撐）收在這裡。
   自訂藍圖直接叫得到——`blueprints/` 的檔案是 <script> 載進來的，同一個全域。 */

/* 尺寸：dim(s, 係數, 下限, 要不要奇數)。
   48 座裡 `Math.max(下限, Math.round(s * 係數))` 這個樣板出現 193 次，
   而「忘了給下限」就是自訂藍圖最常見的失敗——s 小的時候算出 0 或 1，
   那個部件在 300 塊時整組消失。靠中線對稱的東西（屋脊、正門、塔尖）給 odd。 */
function dim(s, k, min, odd) {
  /* min 照舊可以不給（有預設值 1），只驗 s 與係數：這兩個算錯的話後面每個尺寸都是 NaN */
  bpArgs('dim(s, 係數, 下限, 奇數?)', 'nn', [s, k]);
  const n = Math.max(Math.max(1, min || 1), Math.round(s * k));
  return odd ? (n | 1) : n;
}

/* 平均排成一圈：fn(v, x, z, 角度, 第幾個)。柱廊、環形塔樓、輻條都是這件事
   （48 座裡有 28 處自己寫 cos/sin 迴圈）。a0 是起始角，預設從 +x 出發。
   span（弧度，選配）給了就只排**一段弧**：這時頭尾兩個都會落在弧的端點上
   （間隔是 span/(n−1)），整圈那個模式反而不能這樣算——不然最後一個會疊在第一個上面。 */
function ringOf(v, n, r, fn, x0, z0, a0, span) {
  bpArgs('ringOf(v, n, r, fn, x0, z0, a0, span)', 'vnnf', [v, n, r, fn]);
  n = Math.max(1, Math.round(n));
  const arc = Number.isFinite(span);
  for (let i = 0; i < n; i++) {
    const a = (a0 || 0) + (arc ? (n > 1 ? i / (n - 1) * span : 0) : i / n * Math.PI * 2);
    fn(v, (x0 || 0) + Math.cos(a) * r, (z0 || 0) + Math.sin(a) * r, a, i);
  }
}

/* 沿一條軸等距排 n 份：fn(v, 位置, 第幾個)，位置以 c0（預設 0）為中心左右攤開。
   回傳整排的總長。要沿 x 就把位置填進 x、沿 z 就填進 z——跟 mirrorX／mirrorZ 一樣
   只給偏移量，軸由呼叫的人決定；要排成方陣就套兩層。

   全倉庫有 20 處自己寫 `-總寬/2 + i * 間距`（柱廊、欄杆、扶壁、衣褶、一排摩艾），
   而那個式子很容易寫歪：v1.285.0 重畫前的內建自由女神，正面衣褶用 (n−1) 當分母、背面用 (n−2) 還補
   了 +0.5——同一份藍圖裡同一件事寫了兩種，其中一種是湊出來的。 */
function rowOf(v, n, step, fn, c0) {
  bpArgs('rowOf(v, n, 間距, fn, 中心)', 'vnnf', [v, n, step, fn]);
  n = Math.max(1, Math.round(n));
  for (let i = 0; i < n; i++) fn(v, (c0 || 0) + (i - (n - 1) / 2) * step, i);
  return (n - 1) * step;
}

/* 左右／前後對稱各放一次。corners4 是四個角，這兩支是一對。 */
function mirrorX(v, dx, fn) {
  bpArgs('mirrorX(v, dx, fn)', 'vnf', [v, dx, fn]);
  fn(v, dx); fn(v, -dx);
}
function mirrorZ(v, dz, fn) {
  bpArgs('mirrorZ(v, dz, fn)', 'vnf', [v, dz, fn]);
  fn(v, dz); fn(v, -dz);
}

/* 把一整組東西**轉一個角度**蓋上去：deg 是繞 y 軸轉幾度（正的是從 +x 轉向 +z），
   (x0, z0) 是旋轉中心（預設原點）。fn 拿到的是一塊乾淨的畫布，照 0 度畫就好。

   為什麼要專門一支：mirrorX／mirrorZ／corners4／ringOf 全都只給 0／90／180 度，
   任何「斜著擺的一整組東西」都得自己算三角函數——實測五稜郭自己寫了一支
   isInsideStar() 加兩層 41×41 的掃描才排出星形，彰化扇形車庫手刻兩組 cos/sin 掃角度
   （連弧形屋頂都是 0.05 弧度一格一格掃出來的）。

   正反兩趟都做，兩趟各守一件事（三種版本都量過）：
   ① 正向：把來源每一格轉過去，保證來源每一格都有落點。**中空的四面牆轉 45 度時，
      只做反向取樣會少 8 格**（原本 56 → 反向 40、兩趟 48）——牆會變得斑斑駁駁。
   ② 反向：掃目的地的包圍盒、逆轉回來取樣，保證**轉完不會出現一格一格的縫**。
      12×12 的實心量體只做正向的話，轉 15／30／45／60 度分別留下 6／16／20／16 處縫，
      兩趟都是 0。
   聯集才是「既沒少東西也沒有洞」。斜著的線本來就會變短（21 格的牆轉 45 度剩 15 格，
   因為對角線一步跨的是 √2），那是格子的事，不是漏畫。 */
function stampY(v, deg, fn, x0, z0) {
  bpArgs('stampY(v, 幾度, fn, x0, z0)', 'vnf', [v, deg, fn]);
  const src = new VOX();
  fn(src, deg);
  const cells = src.cells();
  if (!cells.length) return;
  const cx = x0 || 0, cz = z0 || 0;
  const a = deg * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
  let mnx = Infinity, mxx = -Infinity, mnz = Infinity, mxz = -Infinity;
  const col = new Map();                       // 同一根柱子上的格子收在一起，反向那趟才不必逐格查
  for (const c of cells) {
    if (c.x < mnx) mnx = c.x; if (c.x > mxx) mxx = c.x;
    if (c.z < mnz) mnz = c.z; if (c.z > mxz) mxz = c.z;
    const k = c.x + ':' + c.z, got = col.get(k);
    if (got) got.push(c); else col.set(k, [c]);
    const dx = c.x - cx, dz = c.z - cz;         // ① 正向
    v.set(cx + dx * ca - dz * sa, c.y, cz + dx * sa + dz * ca, c.c);
  }
  let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
  for (const p of [[mnx, mnz], [mnx, mxz], [mxx, mnz], [mxx, mxz]]) {
    const dx = p[0] - cx, dz = p[1] - cz;
    const px = cx + dx * ca - dz * sa, pz = cz + dx * sa + dz * ca;
    if (px < bx0) bx0 = px; if (px > bx1) bx1 = px;
    if (pz < bz0) bz0 = pz; if (pz > bz1) bz1 = pz;
  }
  for (let x = Math.floor(bx0); x <= Math.ceil(bx1); x++)          // ② 反向
    for (let z = Math.floor(bz0); z <= Math.ceil(bz1); z++) {
      const dx = x - cx, dz = z - cz;
      const list = col.get(Math.round(cx + dx * ca + dz * sa) + ':' +
                           Math.round(cz - dx * sa + dz * ca));
      if (!list) continue;
      for (const c of list) v.set(x, c.y, z, c.c);
    }
}

/* 拱門：w 是開口寬（會逼成奇數，不然拱心落在兩格之間），h 是直柱段高度，
   t 是牆厚（沿 z）。開口總高 = h + (w−1)/2 + 1（拱頂那一格也算）。
   c 給了就先補一片比開口大一圈的牆再挖；不給就只挖洞（用在已經有牆的立面上）。 */
function arch(v, x0, y0, z0, w, h, t, c) {
  // t 有預設值、c 不給就只挖洞（用在已經有牆的立面上），所以這兩個都可以不給
  bpArgs('arch(v, x0, y0, z0, w, h, t, c)', 'vnnnnn', [v, x0, y0, z0, w, h]);
  w = Math.max(1, Math.round(w)) | 1;
  t = Math.max(1, Math.round(t || 1));
  h = Math.max(0, Math.round(h));
  const r = (w - 1) / 2;
  if (c !== undefined) v.box(x0, y0, z0, w + 2, h + r + 2, t, c);
  if (h > 0) v.carve(x0, y0, z0, w, h, t);
  for (let j = 0; j <= r; j++) {
    const half = Math.round(Math.sqrt(Math.max(0, r * r - j * j)));
    v.carve(x0, y0 + h + j, z0, half * 2 + 1, 1, t);
  }
}

/* 連拱：沿 x 排 n 個拱，中間隔著寬 pier 的柱子（競技場、水道橋、迴廊）。
   回傳整排的總寬，接著要算旁邊的東西時直接用。 */
function archRow(v, x0, y0, z0, n, w, h, t, pier, c) {
  bpArgs('archRow(v, x0, y0, z0, n, w, h, t, pier, c)', 'vnnnnnn', [v, x0, y0, z0, n, w, h]);
  n = Math.max(1, Math.round(n));
  w = Math.max(1, Math.round(w)) | 1;
  pier = Math.max(1, Math.round(pier || 1));
  const pitch = w + pier;
  for (let i = 0; i < n; i++)
    arch(v, x0 + (i - (n - 1) / 2) * pitch, y0, z0, w, h, t, c);
  return n * pitch - pier;
}

/* 階梯。dir 是往哪邊爬：'x' / '-x' / 'z' / '-z'。
   每一階都從 y0 往上填實，不是只鋪一片踏面——踏面懸空的話會變成一組孤島。 */
function stairs(v, x0, y0, z0, n, wide, dir, c) {
  bpArgs('stairs(v, x0, y0, z0, n, wide, dir, c)', 'vnnnnnsc', [v, x0, y0, z0, n, wide, dir, c]);
  /* dir 打錯字（'X'、'+x'）不會報錯，只會靜靜地往 +z 爬——階梯長在別的方向上，
     作者看圖才發現。認得的就那四個，其餘擋掉。 */
  if (dir !== 'x' && dir !== '-x' && dir !== 'z' && dir !== '-z')
    throw new Error('參數錯誤：stairs(...) 的 dir 收到 ' + bpShow(dir) +
                    "，只能是 'x'／'-x'／'z'／'-z'");
  n = Math.max(1, Math.round(n));
  wide = Math.max(1, Math.round(wide));
  const alongX = dir === 'x' || dir === '-x';
  const sg = (dir === '-x' || dir === '-z') ? -1 : 1;
  for (let i = 0; i < n; i++) {
    const o = sg * i;
    if (alongX) v.box(x0 + o, y0, z0, 1, i + 1, wide, c);
    else v.box(x0, y0, z0 + o, wide, i + 1, 1, c);
  }
}

/* 四坡屋頂：每層四邊各縮 1 格。gable 只收寬不收深（兩坡），這支兩邊一起收。 */
function hipRoof(v, x0, y0, z0, w, d, c) {
  bpArgs('hipRoof(v, x0, y0, z0, w, d, c)', 'vnnnnnc', [v, x0, y0, z0, w, d, c]);
  let ww = Math.max(1, Math.round(w)), dd = Math.max(1, Math.round(d)), y = 0;
  while (ww >= 1 && dd >= 1) {
    v.box(x0, y0 + y, z0, ww, 1, dd, c);
    ww -= 2; dd -= 2; y++;
  }
}

/* 這兩支參數多，改吃**具名物件**（其餘都是 x, y, z 開頭的位置參數）：
   十個位置參數排錯一個就整片跑掉，而且看不出來哪裡錯。 */

/* 立面窗陣列。{x,y,z} 是第一排最中間那格所在的牆面位置，
   cols／rows 是橫向幾個、往上幾排，stepX／stepY 是間距，w／h 是每個窗的大小，
   axis:'x'（預設，窗沿 x 排在朝 ±z 的那面牆上）或 'z'（沿 z 排，側面那兩片牆）。
   走 tint 只換「已經有積木」的格子——牆上沒有的地方不會長出一片懸空的窗。
   回傳真的畫上去幾格：0 表示那面牆不在你以為的位置。 */
function windowGrid(v, o) {
  bpArgs('windowGrid(v, { … })', 'vo', [v, o]);
  bpKeys('windowGrid(v, { x, y, z, cols, rows, stepX, stepY, w, h, c, axis })', o, 'x y z c');
  const cols = Math.max(1, Math.round(o.cols || 1)), rows = Math.max(1, Math.round(o.rows || 1));
  const w = Math.max(1, Math.round(o.w || 1)), h = Math.max(1, Math.round(o.h || 1));
  const sx = o.stepX || (w + 1), sy = o.stepY || (h + 1);
  const alongZ = o.axis === 'z';
  let n = 0;
  for (let r = 0; r < rows; r++) for (let i = 0; i < cols; i++) {
    const base = (i - (cols - 1) / 2) * sx;
    for (let dy = 0; dy < h; dy++) for (let da = 0; da < w; da++) {
      const pa = base - (w - 1) / 2 + da, py = (o.y || 0) + r * sy + dy;
      if (tint(v, alongZ ? o.x : o.x + pa, py, alongZ ? o.z + pa : o.z, o.c)) n++;
    }
  }
  return n;
}

/* 方形收分：底面 w×d 一層一層收到頂面 w1×d1。城郭石垣、方尖碑、退縮式高樓
   （帝國大廈那種）都是這件事——`taper` 只收圓的、`pyramid` 只給等速階梯，
   中間這一格本來是空的：全倉庫有 13 處自己寫
   `for y … step = floor((h−y) × 係數); box(w − step×2, …)`（大阪城的石垣、
   松前城天守、吉薩大金字塔的收頂、五稜郭、總統府）。
   t 給了就只留四面牆（中空的方塔），不給是實心的。 */
function boxTaper(v, o) {
  bpArgs('boxTaper(v, { … })', 'vo', [v, o]);
  bpKeys('boxTaper(v, { x, y, z, w, d, w1, d1, h, c })', o, 'x y z w d w1 d1 h c');
  const h = Math.max(1, Math.round(o.h));
  for (let i = 0; i < h; i++) {
    const t = h > 1 ? i / (h - 1) : 0;
    const w = Math.max(1, Math.round(o.w + (o.w1 - o.w) * t));
    const d = Math.max(1, Math.round(o.d + (o.d1 - o.d) * t));
    if (o.t) v.walls(o.x, o.y + i, o.z, w, 1, d, o.c, o.t);
    else v.box(o.x, o.y + i, o.z, w, 1, d, o.c);
  }
}

/* 斜撐格架：兩根柱子之間拉 n 段交叉斜撐（鐵塔、桁架橋、電塔）。
   {x0,z0} 與 {x1,z1} 是兩根柱子的位置，從 y 往上拉 h 高、分 n 段。
   斜線上的格子彼此只在對角相鄰，遊戲的支撐判定認 26 鄰居，所以撐得住。 */
function lattice(v, o) {
  bpArgs('lattice(v, { … })', 'vo', [v, o]);
  bpKeys('lattice(v, { x0, z0, x1, z1, y, h, n, c })', o, 'x0 z0 x1 z1 c');
  const n = Math.max(1, Math.round(o.n || 1)), dy = (o.h || 1) / n, y0 = o.y || 0;
  for (let i = 0; i < n; i++) {
    const ya = y0 + i * dy, yb = y0 + (i + 1) * dy;
    v.line(o.x0, ya, o.z0, o.x1, yb, o.z1, o.c);
    v.line(o.x1, ya, o.z1, o.x0, yb, o.z0, o.c);
  }
}

/* ── 內建動物用的畫布（不是給自訂藍圖的工具，說明文件沒有列）──────────
   大象、暴龍、長頸鹿、貓咪四座共用（v1.257.0）：先蓋在一塊 Uint8Array 上，最後一次寫進 v。
   為什麼不直接用 blob／limb：軀幹、腿、頭彼此疊很多，一萬格的大象要寫一萬七千次 v.set，
   fitScale 掃一輪（約六十次 gen）9000 那一檔就量到 256ms；而且 blob／limb 一格只能給一個顏色，
   皮膚的明暗、皺紋、虎斑、網紋都得「蓋的時候就挑色」，不然要蓋完再整份掃一遍
   （見 開發筆記〈舊版 21 座重畫、偏白的 5 座調色〉）。
   框是 x∈[−bx, bx]、y∈[0, by]、z∈[bz0, bz1]；框外的格子照常走 v.set（out 給了就先換色）。
     put(x, y, z, c)／has(x, y, z)／get(x, y, z)（沒有就是 −1）
     paint(x, y, z, dx, dy, dz, n, c)            同 paintFrom：錨點在裡面、方向指往外
     E(x0, y0, z0, rx, ry, rz, cf)               帶顏色函式的 blob：cf(x, y, z, ny, d2)
     L(ax, ay, az, bx, by, bz, r0, r1, cf)       帶顏色函式的 limb（先拉骨幹線保證接得起來）：
                                                 cf(x, y, z, ny, d2, t)
       ny ＝ 這一格相對中心／軸線的垂直偏移（−1 底 … 1 頂），d2 ＝ 離中心的距離平方（1 是表面）
     flush(map)    寫進 v；map(c, i, x, y, z) 給了就由它決定最後的顏色
     G、NY、NZ     陣列本體與兩個維度（長頸鹿的網紋要看鄰格是不是露在外面） */
function voxGrid(v, bx, by, bz0, bz1, out) {
  const NY = by + 1, NZ = bz1 - bz0 + 1, G = new Uint8Array((2 * bx + 1) * NY * NZ);
  const at = (x, y, z) => (x < -bx || x > bx || y < 0 || y > by || z < bz0 || z > bz1) ? -1
                          : ((x + bx) * NY + y) * NZ + (z - bz0);
  const touched = [];                       // 第一次蓋到的格子記下來，最後只寫這些（不必掃整個框）
  const put = (x, y, z, c) => {
    const i = at(x, y, z);
    if (i < 0) { if (y >= 0) v.set(x, y, z, out ? out(c) : c); return; }
    if (!G[i]) touched.push(i);
    G[i] = c + 1;
  };
  const has = (x, y, z) => { const i = at(x, y, z); return i >= 0 ? G[i] > 0 : v.has(x, y, z); };
  const get = (x, y, z) => { const i = at(x, y, z); return i >= 0 ? G[i] - 1 : -1; };
  const paint = (x, y, z, dx, dy, dz, n, c) => {
    for (let i = n; i >= 0; i--) {
      const X = Math.round(x + dx * i), Y = Math.round(y + dy * i), Z = Math.round(z + dz * i);
      if (has(X, Y, Z)) { put(X, Y, Z, c); return true; }
    }
    return false;
  };
  const E = (x0, y0, z0, rx, ry, rz, cf) => {
    const nx = Math.ceil(rx), ny = Math.ceil(ry), nz = Math.ceil(rz);
    for (let i = -nx; i <= nx; i++) {
      const a = i / rx, a2 = a * a; if (a2 > 1.0404) continue;
      for (let j = -ny; j <= ny; j++) {
        const b = j / ry, ab = a2 + b * b; if (ab > 1.0404) continue;
        const y = Math.round(y0 + j); if (y < 0) continue;
        const kz = Math.min(nz, Math.floor(rz * Math.sqrt(1.0404 - ab)) + 1);   // 這一排 z 的範圍直接算（邊上那格照樣逐格驗）
        for (let k = -kz; k <= kz; k++) {
          const c = k / rz, d2 = ab + c * c; if (d2 > 1.0404) continue;
          const x = Math.round(x0 + i), z = Math.round(z0 + k);
          put(x, y, z, cf(x, y, z, b, d2));
        }
      }
    }
  };
  const L = (ax, ay, az, bx2, by2, bz2, r0, r1, cf) => {
    r0 = Math.max(0.5, r0); r1 = Math.max(0.5, r1);
    const dx = bx2 - ax, dy = by2 - ay, dz = bz2 - az, len2 = dx * dx + dy * dy + dz * dz, rm = Math.max(r0, r1);
    const n = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)));
    for (let i = 0; i <= n; i++) {
      const t = n ? i / n : 0, x = Math.round(ax + dx * t), y = Math.round(ay + dy * t), z = Math.round(az + dz * t);
      if (y >= 0) put(x, y, z, cf(x, y, z, 0, 0, t));
    }
    const xa = Math.floor(Math.min(ax, bx2) - rm), xb = Math.ceil(Math.max(ax, bx2) + rm);
    const ya = Math.max(0, Math.floor(Math.min(ay, by2) - rm)), yb = Math.ceil(Math.max(ay, by2) + rm);
    const za = Math.floor(Math.min(az, bz2) - rm), zb = Math.ceil(Math.max(az, bz2) + rm);
    const lxy = dx * dx + dy * dy, RM2 = (rm + 0.02) * (rm + 0.02);
    for (let x = xa; x <= xb; x++) for (let y = ya; y <= yb; y++) {
      // 這一整根 z 柱離線段在 x–y 平面上的投影就超過半徑的話，整根都不會有格子（斜的部件省很多）
      const qx = x - ax, qy = y - ay;
      let u = lxy ? (qx * dx + qy * dy) / lxy : 0;
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      const fx = qx - dx * u, fy = qy - dy * u;
      if (fx * fx + fy * fy > RM2) continue;
      for (let z = za; z <= zb; z++) {
        const pz = z - az;
        let t = len2 ? (qx * dx + qy * dy + pz * dz) / len2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = qx - dx * t, ey = qy - dy * t, ez = pz - dz * t, R = r0 + (r1 - r0) * t + 0.02;
        const e2 = ex * ex + ey * ey + ez * ez;
        if (e2 <= R * R) put(x, y, z, cf(x, y, z, ey / R, e2 / (R * R), t));
      }
    }
  };
  const flush = map => {
    for (const i of touched) {
      const z = i % NZ, r = (i - z) / NZ, y = r % NY, x = (r - y) / NY - bx;
      v.set(x, y, z + bz0, map ? map(G[i] - 1, i, x, y, z + bz0) : G[i] - 1);
    }
  };
  return { put, has, get, paint, E, L, flush, G, NY, NZ };
}
/* 0～99 的固定雜湊：皮膚斑駁、虎斑邊緣這種「看起來隨機、每次長得一樣」的挑色。
   v1.288.0 起〈藍圖製作說明〉也列給自訂藍圖用（配顏色函式撒石牆雜色），
   所以**輸出不能再改**——改了內建動物與每一支用到它的自訂藍圖都會換一身花色。 */
function hash100(x, y, z) {
  let h = Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) % 100;
}

/* ── 48 座 ────────────────────────────────────────────────
   lo/hi 是尺度參數的可用範圍，makeBlueprint 會在其中找最接近目標積木數的值。
   pal 是這座建築的配色，格子的 c 就是 pal 的索引。 */
const SHAPES = [
{ n: '吉薩金字塔', lo: 6, hi: 40,
  // v1.257.0 格子一格都沒動，只換色與細節（見 開發筆記〈舊版 21 座重畫、偏白的 5 座調色〉）
  // 吉薩金字塔：e2e 最重的固定場景，格子一格都不動（實心階梯方錐，跟舊版同一組格子），只重新上色
  // 識別物：金黃石灰岩的層層石階、塔頂的金色頂石、北面（正面 −z）離地一段的入口與上方的人字形石樑
  pal: [0xcfa868,   // 0 石灰岩（主色，金黃）
        0xa47c45,   // 1 深一階：風化的石塊、最底一層基石
        0xe6c88e,   // 2 亮一階：被太陽曬白的石塊、入口上方的人字形石樑
        0xe9be3c,   // 3 金色頂石
        0x2f251b],  // 4 入口的黑洞
  gen(v, s) {
    const b = Math.round(s) | 1, hw = (b - 1) / 2, top = Math.floor(b / 2);
    /* 跟 v.pyramid(0, 0, 0, b, …) 同一組格子，但一邊蓋一邊挑顏色——蓋完再掃一遍重上色的話，
       fitScale 每試一個 s 就多跑一整趟，9000 那一檔產生時間從兩百多 ms 再往上加。
       石塊的深淺照座標雜湊挑：一層一色看起來是條紋布，真的金字塔是每一塊各自風化。 */
    for (let y = 0; y <= top; y++) {
      const r = hw - y;
      for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) {
        let h = (x * 73856093) ^ (y * 19349663) ^ (z * 83492791);
        h = (h ^ (h >>> 13)) * 1274126177;
        const k = ((h ^ (h >>> 16)) >>> 0) % 100;
        const edge = y === 0 && Math.max(Math.abs(x), Math.abs(z)) === r;   // 最底一圈基石，像埋進沙裡
        v.set(x, y, z, edge || k < 18 ? 1 : k < 40 ? 2 : 0);
      }
    }
    // 頂石：最上面兩層換成金色
    for (let y = Math.max(0, top - 1); y <= top; y++) {
      const r = hw - y;
      for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) v.set(x, y, z, 3);
    }
    /* 入口在北面（正面 −z），離地約一成多的高度（真的入口偏東 7 公尺，這裡置中）。
       階梯面上同一個 x 每往上一層就往裡退一格，所以每層各自塗那一層最外面那一排。 */
    const ey = Math.max(1, Math.round(top * 0.16)), eh = Math.max(2, Math.round(top * 0.12));
    const ew = Math.max(0, Math.round(b * 0.03));
    for (let y = ey; y < ey + eh; y++)
      for (let x = -ew; x <= ew; x++) tint(v, x, y, -(hw - y), 4);
    // 人字形石樑：入口上方兩層，越上面越窄
    for (let j = 0; j < 2; j++) {
      const y = ey + eh + j, w = ew + 1 - j;
      for (let x = -w; x <= w; x++) tint(v, x, y, -(hw - y), 2);
    }
  } },

{ n: '羅馬競技場', lo: 2.2, hi: 14, pal: [0xe2d3b4, 0xb3a282, 0x7d6748, 0x2e3033, 0x787d85, 0x2c6e43, 0x573d26],
  /* 來源：blueprints/羅馬競技場.js（v1.66 換掉原本那份） */
  gen(v, s) {
    // ── 尺度與高度層次計算 ──────────────────────────────────────
    const rx = dim(s, 2.40, 8);               // 外環長軸半徑 (x)
    const rz = dim(s, 1.85, 6);               // 外環短軸半徑 (z)
    const h1 = dim(s, 0.42, 2);               // 第1層（多立克）拱券高
    const h2 = dim(s, 0.42, 2);               // 第2層（愛奧尼）拱券高
    const h3 = dim(s, 0.40, 2);               // 第3層（科林斯）拱券高
    const h4 = dim(s, 0.52, 2);               // 第4層（頂層閣樓實牆）高

    const yBase = 2;                          // 建築立面起步高度（y=0 為黑底座、y=1 為廣場鋪面）
    const y2 = yBase + h1;                    // 第1層腰線高度
    const y3 = y2 + 1 + h2;                   // 第2層腰線高度（前方殘垣頂端）
    const y4 = y3 + 1 + h3;                   // 第3層腰線高度
    const y5 = y4 + 1 + h4;                   // 第4層頂冠簷口高度（後方完整高牆頂端）

    // ── 1. 台基：黑灰底座與廣場鋪面 ─────────────────────────────
    const prx = rx + 3, prz = rz + 3;
    for (let x = -prx; x <= prx; x++) {
      for (let z = -prz; z <= prz; z++) {
        const d = (x * x) / ((prx + 0.4) * (prx + 0.4)) + (z * z) / ((prz + 0.4) * (prz + 0.4));
        if (d <= 1.0) {
          v.set(x, 0, z, 3); // 黑色底座地台
          v.set(x, 1, z, 4); // 灰色鋪石廣場
        }
      }
    }

    // ── 2. 中央地下室隔間 (Hypogeum) 與半沙地木台 ────────────────
    const arx = Math.max(2, Math.round(rx * 0.38));
    const arz = Math.max(2, Math.round(rz * 0.38));
    for (let x = -arx; x <= arx; x++) {
      for (let z = -arz; z <= arz; z++) {
        const ad = (x * x) / ((arx + 0.2) * (arx + 0.2)) + (z * z) / ((arz + 0.2) * (arz + 0.2));
        if (ad <= 1.0) {
          // 地下室隔間牆
          if (x % 2 === 0 || z === 0) {
            v.set(x, yBase, z, 1);
          }
          // 樂高版特色：東半部覆蓋的半邊木質沙地競技場地板
          if (x >= 0 && ad <= 0.85) {
            v.set(x, yBase + 1, z, 0);
          }
        }
      }
    }

    // ── 3. 內圈階梯看台 (Cavea) ──────────────────────────────────
    const mrx = Math.max(4, Math.round(rx * 0.68));
    const mrz = Math.max(3, Math.round(rz * 0.68));
    const steps = Math.max(2, Math.round(s * 0.35));
    for (let st = 0; st < steps; st++) {
      const rxi = Math.round(arx + (mrx - arx) * (st / steps));
      const rzi = Math.round(arz + (mrz - arz) * (st / steps));
      const sty = yBase + st;
      if (sty < y3) {
        v.ellipseRing(0, sty, 0, rxi + 1, rzi + 1, 1, 1, 1);
      }
    }

    // ── 4. 中圈環廊支撐牆 ────────────────────────────────────────
    v.ellipseRing(0, yBase, 0, mrx, mrz, Math.max(1, y3 - yBase), 0, 1);

    // ── 5. 外圈多層拱廊與階梯破壁殘垣 (Outer Arcade) ─────────────
    const nb = dim(s, 2.7, 18); // 外圈柱跨數
    const pts = [];
    for (let i = 0; i < nb; i++) {
      const ang = (i / nb) * Math.PI * 2;
      const px = Math.round(rx * Math.cos(ang));
      const pz = Math.round(rz * Math.sin(ang));

      // 重現經典外型：北/後側為 4 層完整高牆，南/前側為 2 層低矮殘垣，兩側為斜面扶壁過渡
      let wallH = y3; // 前方低矮拱廊
      if (pz <= -Math.round(rz * 0.18)) {
        wallH = y5; // 後方完整 4 層頂層閣樓
      } else if (pz <= Math.round(rz * 0.20)) {
        wallH = y4; // 側邊 3 層過渡段斜坡
      }
      pts.push({ x: px, z: pz, h: wallH, ang: ang });
    }

    // 建造外環立柱、拱頂、閣樓實牆與徑向隔牆
    for (let i = 0; i < nb; i++) {
      const p = pts[i];
      const next = pts[(i + 1) % nb];

      // 外環主立柱
      v.box(p.x, yBase, p.z, 1, p.h - yBase, 1, 0);

      // 徑向隔牆：連接外圈與中圈，形成拱頂迴廊
      const mx = Math.round(mrx * Math.cos(p.ang));
      const mz = Math.round(mrz * Math.sin(p.ang));
      v.line(p.x, yBase, p.z, mx, yBase, mz, 1);
      if (p.h > y2) {
        v.line(p.x, y2, p.z, mx, y2, mz, 1);
      }

      // 各層拱頂連接
      const minH = Math.min(p.h, next.h);
      if (minH >= y2) v.line(p.x, y2 - 1, p.z, next.x, y2 - 1, next.z, 0); // 1層拱券
      if (minH >= y3) v.line(p.x, y3 - 1, p.z, next.x, y3 - 1, next.z, 0); // 2層拱券
      if (minH >= y4) v.line(p.x, y4 - 1, p.z, next.x, y4 - 1, next.z, 0); // 3層拱券

      // 第4層閣樓實牆 (Attic Wall) + 方窗與遮陽篷插孔托座 (Corbels)
      if (minH >= y5) {
        for (let y = y4; y < y5; y++) {
          v.line(p.x, y, p.z, next.x, y, next.z, 0);
        }
        // 採光方窗
        const midX = Math.round((p.x + next.x) / 2);
        const midZ = Math.round((p.z + next.z) / 2);
        const winY = y4 + Math.max(1, Math.floor(h4 / 2));
        v.set(midX, winY, midZ, 2);
        // 頂部挑簷突榫
        v.set(p.x, y5, p.z, 2);
      }
    }

    // ── 6. 深色水平分層腰線 (Cornices) ───────────────────────────
    v.ellipseRing(0, y2, 0, rx, rz, 1, 2, 1); // 第1層頂部腰線
    v.ellipseRing(0, y3, 0, rx, rz, 1, 2, 1); // 第2層頂部腰線

    // 第3層與頂部冠簷腰線（僅在後方完整高牆段）
    for (let i = 0; i < nb; i++) {
      const p = pts[i];
      const next = pts[(i + 1) % nb];
      if (p.h >= y4 && next.h >= y4) {
        v.line(p.x, y4, p.z, next.x, y4, next.z, 2);
      }
      if (p.h >= y5 && next.h >= y5) {
        v.line(p.x, y5, p.z, next.x, y5, next.z, 2);
      }
    }

    // ── 7. 周邊造景：微縮羅馬絲柏樹與街角鋪飾 ───────────────────
    const treeCount = dim(s, 0.9, 6);
    for (let t = 0; t < treeCount; t++) {
      const tang = (t / treeCount) * Math.PI * 2 + 0.25;
      const tx = Math.round((rx + 2.2) * Math.cos(tang));
      const tz = Math.round((rz + 2.2) * Math.sin(tang));
      const trH = dim(s, 0.45, 3);

      v.set(tx, yBase, tz, 6); // 樹幹
      for (let th = 1; th <= trH; th++) {
        v.set(tx, yBase + th, tz, 5); // 墨綠絲柏樹冠
      }
      if (t % 2 === 0) {
        v.set(tx + 1, yBase, tz, 2); // 廣場小路樁
      }
    }
  } },
{ n: '比薩斜塔', lo: 2.3, hi: 15,
  // v1.257.0 只調色、格子一格都沒動（見 開發筆記〈舊版 21 座重畫、偏白的 5 座調色〉）
  // 比薩斜塔：使用者交的那一份，造型一格都不動（格子集合跟舊版完全一樣），只重新上色
  // 正面：細長圓筒往 +x 斜，八層：一樓實牆盲柱、六層通透環形柱廊、頂上縮小一圈的鐘室
  // 側面：同一根圓筒，層與層之間一圈外挑的簷口
  // 三樣識別物：往一邊斜的整根塔身、一層一層的環形拱廊（外柱亮、裡面的牆暗）、頂上開拱的鐘室
  // 部件（照舊）：台基兩階 一樓盲柱牆 正面拱門 六層樓板簷口 內筒牆 採光窗 外柱 柱頂拱圈
  //              觀景台 護欄 鐘室 鐘室拱 大鐘 頂簷 女兒牆 旗桿 旗
  // 上色：外柱與盲柱用亮的米白大理石；迴廊裡的內筒牆是陰影，深兩階，拱廊才看得出是空的；
  //       層間簷口深一階、柱頂拱圈介於兩者之間；一樓實牆的盲拱凹面深一階、最上一圈亮一點，盲柱就浮出來；
  //       台基底階與鐘室頂簷、女兒牆用帶灰的舊石色（鐘室頂另一色）；旗桿改深色。
  /* 來源：blueprints/比薩斜塔.js（v1.114 換掉原本那份） */
  pal: [0xdccdab,   // 0 外柱、盲柱、鐘室牆、觀景台護欄（亮的米白大理石）
        0x675d4f,   // 1 迴廊裡的內筒牆（陰影面，深兩階）
        0xa8936f,   // 2 層間簷口與樓板、一樓盲拱凹面、第二階台基（深一階）
        0x352e26,   // 3 開口：拱門、採光窗、鐘室拱、旗桿
        0xa86f35,   // 4 青銅大鐘
        0xa8382c,   // 5 旗
        0xcbbb98,   // 6 柱頂拱圈、一樓實牆最上一圈（介於柱子與簷口之間）
        0x857a6b],  // 7 底階石、鐘室頂簷與女兒牆（帶灰的舊石色）
  gen(v, s) {
    // 尺度係數：兼顧高聳感與細緻拱圈
    const r = dim(s, 0.95, 4);           // 外柱廊半徑
    const coreR = Math.max(2, r - 2);     // 內筒核心牆半徑
    const bH = dim(s, 0.90, 4);          // 第 1 層底座盲拱牆高
    const arcH = dim(s, 0.55, 2);        // 2~7 層每層迴廊柱高
    const bfrH = dim(s, 1.05, 4);        // 第 8 層鐘樓高度
    const nCols = dim(s, 1.6, 12);       // 柱子數量（密集才能表現羅曼式拱廊）

    // 傾斜斜率（傾斜角度約 5 度，每上升 1 格 y，x 軸平移 0.09 格）
    const tilt = 0.09;
    const getX = (y) => Math.round(y * tilt);

    // 1. 地面基座石階（水平台基）
    v.cyl(0, 0, 0, r + 3, 1, 7);                 // 舊：2
    v.cyl(0, 1, 0, r + 2, 1, 2);                 // 舊：1

    let curY = 2;

    // 2. 第一層：盲拱與實心厚牆底座
    for (let dy = 0; dy < bH; dy++) {
      const y = curY + dy;
      const ox = getX(y);
      v.cyl(ox, y, 0, r, 1, dy < bH - 1 ? 2 : 6, 1);   // 舊：1。一樓實牆：盲拱凹進去那段深一階、頂上一圈拱圈亮一點
      v.cyl(ox, y, 0, coreR, 1, 0);
    }
    // 第一層正面拱門
    arch(v, getX(curY), curY, r, dim(s, 0.38, 3, true), Math.max(2, bH - 1), 1, 3);
    // 第一層外壁盲柱浮雕
    ringOf(v, Math.max(8, Math.round(nCols * 0.75)), r, (vv, rx, rz) => {
      for (let dy = 0; dy < bH; dy++) {
        const y = curY + dy;
        vv.box(getX(y) + rx, y, rz, 1, 1, 1, 0);
      }
    });
    curY += bH;

    // 3. 第二層至第七層：6 層通透環形柱廊
    for (let f = 0; f < 6; f++) {
      // (a) 層間外挑簷口與走廊樓板
      v.cyl(getX(curY), curY, 0, r + 1, 1, 2);
      curY += 1;

      // (b) 中心中空實牆
      for (let dy = 0; dy < arcH; dy++) {
        const y = curY + dy;
        v.cyl(getX(y), y, 0, coreR, 1, 1, 1);
      }

      // (c) 核心牆上的採光小窗（交錯排列）
      if (f % 2 === 0) {
        windowGrid(v, {
          x: getX(curY),
          y: curY,
          z: -coreR,
          cols: 1,
          rows: 1,
          w: 1,
          h: Math.max(1, arcH - 1),
          c: 3,
          axis: 'x'
        });
      }

      // (d) 外圍獨立柱廊
      ringOf(v, nCols, r, (vv, rx, rz) => {
        for (let dy = 0; dy < arcH; dy++) {
          const y = curY + dy;
          vv.box(getX(y) + rx, y, rz, 1, 1, 1, 0);
        }
        // 柱頂拱圈橫樑
        vv.box(getX(curY + arcH - 1) + rx, curY + arcH - 1, rz, 1, 1, 1, 6);   // 舊：2
      });

      curY += arcH;
    }

    // 4. 第八層：頂部鐘室（Belfry）與平台
    const topFloorY = curY;
    const belfryR = Math.max(2, coreR);

    // 觀景台大底板
    v.cyl(getX(topFloorY), topFloorY, 0, r + 1, 1, 2);
    // 觀景台護欄
    v.cyl(getX(topFloorY + 1), topFloorY + 1, 0, r + 1, 1, 0, 1);
    curY += 1;

    // 鐘樓主體圓柱
    for (let dy = 0; dy < bfrH; dy++) {
      const y = curY + dy;
      v.cyl(getX(y), y, 0, belfryR, 1, 0, 1);
    }

    // 鐘樓四向開口拱門
    const archW = dim(s, 0.32, 3, true);
    const archH = Math.max(2, bfrH - 2);
    mirrorZ(v, belfryR, (vv, dz) => {
      arch(vv, getX(curY), curY, dz, archW, archH, 1, 3);
    });
    mirrorX(v, belfryR, (vv, dx) => {
      vv.carve(getX(curY) + dx, curY, 0, 1, archH, archW);
      vv.carve(getX(curY + archH) + dx, curY + archH, 0, 1, 1, Math.max(1, archW - 2));
    });

    // 鐘室內部青銅大鐘
    const bellY = curY + Math.max(1, Math.round(bfrH * 0.35));
    const bellSize = Math.max(1, dim(s, 0.28, 1));
    v.box(getX(bellY), bellY, 0, bellSize, bellSize, bellSize, 4);

    curY += bfrH;

    // 5. 頂層護欄、壓頂線腳與旗幟
    v.cyl(getX(curY), curY, 0, belfryR + 1, 1, 7);              // 頂部出簷（舊：2）
    v.cyl(getX(curY + 1), curY + 1, 0, belfryR, 1, 7, 1);      // 頂層矮女兒牆（舊：0）
    v.box(getX(curY + 2), curY + 2, 0, 1, dim(s, 0.35, 2), 1, 3); // 旗桿（舊：2）
    v.box(getX(curY + 2) + 1, curY + 2 + Math.max(0, dim(s, 0.15, 1)), 0, 1, 1, 1, 5); // 旗幟
  } },

{ n: '巴黎凱旋門',
  // v1.306.0 整座重畫：盲測第五回的子 agent 只拿〈藍圖製作說明〉、從零做出來的第二版（看過一次報告＋9000 四視圖），
  // 原樣收進來，只改了名字與 pal 的寫法（見 開發筆記〈盲測第五回：三座粗糙的內建重做（v1.306.0）〉）
  // 正面：一個方正的大石塊，正中挖一個又高又大的半圓拱（寬約全寬 1/3、拱頂在全高約 6 成），
  //       兩側是兩根寬墩柱，墩柱腳下各有一組深色雕像群坐在台座上；上面是浮雕帶、厚簷口、高頂樓。
  // 側面：寬只有正面一半，正中一個比較小的半圓拱（拱頂約全高 38%），雕像群從正面、背面往外凸。
  // 三樣識別物：①正面大拱＋側面小拱（十字交叉、裡面是深的陰影） ②四根墩柱腳下的雕像群（台座＋金字塔形群像＋有翅膀的女神）
  //             ③頂上厚簷口＋高頂樓（一排圓章）
  // 比例表（實物）：全高 49.54 m、全寬 44.82、全深 22.21。大拱寬 14.62、高 29.19（起拱約 21.9）；
  //   小拱寬 8.44、高 18.68（起拱約 14.5）；正面墩柱寬 15.1、側面墩柱 6.9。
  //   雕像台座約 5.5 m、雕像群頂約 17 m；第一道簷約 19.5 m；大簷部 31.2～37.5（浮雕帶 2.6＋簷口 2.4）；頂樓到 48.3；頂簷到約 49.5。
  // 輪廓寬度（正面，以牆面全寬 ＝ 1）：地坪 1.14／勒腳 1.07／0～19 m 墩柱 1.00（中間拱洞 0.33）／
  //   第一道簷 1.07／19～31 m 1.00（拱洞收成半圓）／大簷口 1.14（兩層外挑）／頂樓 1.00／頂簷 1.07
  // 部件尺寸（第一版報告：9000 塊 s = 16.43，每公尺 0.66 格）：
  //   全寬 29、全深 15、牆身高 33；大拱 9 寬 × 19 高（直段 14）；小拱 5 寬 × 12 高（直段 9）；
  //   台座 8×4×3；雕像群 8 寬 × 7 高；浮雕板 8×5；浮雕帶 2 層；大簷口 2 層；頂樓 7 層；圓章半徑 2（5 格寬，正面 4、側面 2）
  // 部件：台基＝地坪(box)、勒腳(walls 環)、雕像台座(box)／主量體＝牆身(box 實心，拱道內壁用顏色函式上陰影色)、
  //   上段(walls 中空 2 格殼)／開口＝大拱、小拱(carve 逐層半圓)、起拱線腳(box)、拱心石(box)／
  //   線腳＝第一道簷(walls 環)、大浮雕帶(walls＋顏色函式)、大簷口(walls 兩層)、頂簷(walls 環)／屋頂＝平台(box)／
  //   頂飾與附屬＝雕像群(limb＋plate 翅膀)、浮雕板(tint)、圓章(tint＋rowOf)、無名戰士墓與長明火(tint＋set)
  pal: [0xb8ac90,   // 0 石材本色（亮度 0.64）
        0xada185,   // 1 石材暗一階（淡雜色）
        0xc2b79d,   // 2 石材亮一階（淡雜色、圓章的圓心）
        0x756e5e,   // 3 線腳：勒腳、簷口、浮雕框、圓章外圈（0.41）
        0x5c564c,   // 4 雕像群、浮雕裡的人影（0.33）
        0xa99e85,   // 5 浮雕底（0.59）
        0x7e7c78,   // 6 地坪
        0xe8842c,   // 7 長明火
        0x3a3631,   // 8 無名戰士墓板
        0x645e53],  // 9 拱道內壁的陰影（0.36）
  lo: 3, hi: 26,

  gen(v, s) {
    const k = s * 0.04;                                        // 每公尺幾格
    const m = (meter, lo) => Math.max(lo, Math.round(meter * k));
    const mo = (meter, lo) => { const x = Math.max(lo, meter * k); return 2 * Math.round((x - 1) / 2) + 1; };
    const bx = (xa, xb, y, h, za, zb, c) =>                    // 用兩端的格子畫長方體
      v.box((xa + xb) / 2, y, (za + zb) / 2, Math.abs(xb - xa) + 1, h, Math.abs(zb - za) + 1, c);
    const stone = (x, y, z) => { const q = hash100(x, y, z); return q < 14 ? 1 : q < 22 ? 2 : 0; };
    const relief = (x, y, z) => (hash100(x, y, z) < 35 ? 4 : 5);

    // ── 尺寸（都照實物公尺換算）──
    const W = mo(44.82, 11), D = mo(22.21, 7);
    const aw = mo(14.62, 3), sw = mo(8.44, 3);
    const xL = (W - 1) / 2, zL = (D - 1) / 2;
    const pin = (aw + 1) / 2;                                  // 正面墩柱內緣的 x
    const AH = m(29.19, 7), h = AH - (aw - 1) / 2 - 1, RA = aw / 2 + 0.3;   // 大拱總高、直段高、半圓半徑
    const SH = m(18.68, 5), hr = SH - (sw - 1) / 2 - 1, RS = sw / 2 + 0.3;  // 小拱
    const yb = 1;                                              // 地坪一層之上
    const c1y = yb + SH + 1;                                   // 第一道簷
    const eb = yb + Math.max(AH + 1, SH + 4, m(31.2, 9));      // 大浮雕帶底
    const coY = eb + m(2.6, 1);                                // 大簷口底
    const coH = m(2.4, 2);
    const at0 = coY + coH;                                     // 頂樓底
    const atTop = Math.max(at0 + 4, yb + m(48.3, 0));          // 屋頂平台那一層
    const atH = atTop - at0;
    const pd = m(4.0, 2), ph = m(5.5, 3);                      // 雕像台座深、高
    const gm = Math.max(1, Math.round((xL - pin + 1) * 0.12)); // 台座離墩柱兩邊的空

    // 拱道內壁（開口外一圈）上陰影色，洞才看得出深度與寬度
    const lining = (x, y, z) => {
      if (y < yb) return false;
      if (Math.abs(z) < zL && (y < yb + h ? Math.abs(x) <= pin : Math.hypot(x, y - yb - h + 0.5) <= RA + 1.1)) return true;
      return Math.abs(x) < xL && (y < yb + hr ? Math.abs(z) <= (sw + 1) / 2 : Math.hypot(z, y - yb - hr + 0.5) <= RS + 1.1);
    };
    const body = (x, y, z) => (lining(x, y, z) ? 9 : stone(x, y, z));

    // ── 台基 ──
    bx(-(xL + 2), xL + 2, 0, 1, -(zL + pd + 2), zL + pd + 2, 6);

    // ── 主量體：下段實心；上段（簷部＋頂樓）只留 2 格殼 ──
    v.box(0, yb, 0, W, eb - yb, D, body);
    v.walls(0, yb, 0, W + 2, m(1.5, 1), D + 2, 3, 1);           // 勒腳
    v.walls(0, c1y, 0, W + 2, 1, D + 2, 3, 1);                  // 第一道簷（回紋帶）
    v.walls(0, eb, 0, W, coY - eb, D, relief, 2);               // 大浮雕帶
    v.walls(0, coY, 0, W + 2, 1, D + 2, 3, 2);                  // 大簷口：下層外挑 1
    v.walls(0, coY + 1, 0, W + 4, coH - 1, D + 4, 3, 3);        //         上層外挑 2
    v.walls(0, at0, 0, W, atH, D, stone, 2);                    // 頂樓
    v.box(0, atTop, 0, W, 1, D, stone);                         // 屋頂平台
    v.walls(0, atTop, 0, W + 2, 1, D + 2, 3, 1);                // 頂簷

    // ── 開口：直段＋半圓，逐層挖（大拱沿 z、小拱沿 x，兩個用同一條弧線，內壁的陰影色才對得上）──
    const vault = (alongX, w, hs, R, len) => {
      const cut = (y, n, ww) => (alongX ? v.carve(0, y, 0, len, n, ww) : v.carve(0, y, 0, ww, n, len));
      cut(yb, hs, w);
      for (let j = 0; j <= (w - 1) / 2; j++)
        cut(yb + hs + j, 1, 2 * Math.floor(Math.sqrt(Math.max(0, R * R - (j + 0.5) * (j + 0.5)))) + 1);
    };
    vault(false, aw, h, RA, D + 2);                             // 正面大拱，前後挖穿（連勒腳、第一道簷一起切）
    vault(true, sw, hr, RS, W + 2);                             // 側面小拱，左右挖穿

    // 看不到的墩柱內部挖空（外殼留 2 格）
    const cx0 = pin + 2, cx1 = xL - 2, cy0 = yb + SH + 2;
    if (cx1 >= cx0 && zL >= 3 && eb - 1 >= cy0)
      for (const sx of [-1, 1])
        v.carve(sx * (cx0 + cx1) / 2, cy0, 0, cx1 - cx0 + 1, eb - cy0, 2 * (zL - 2) + 1);

    // 起拱線腳：直段最上面一層往洞裡凸一格
    for (const sx of [-1, 1]) {
      v.box(sx * (aw - 1) / 2, yb + h - 1, 0, 1, 1, D, 3);
      for (const sz of [-1, 1]) bx(sx * pin, sx * xL, yb + hr - 1, 1, sz * (sw - 1) / 2, sz * (sw - 1) / 2, 3);
    }
    // 拱心石：往外凸一格
    const kh = Math.max(1, Math.min(2, eb - (yb + AH)));
    for (const sz of [-1, 1]) v.box(0, yb + AH, sz * (zL + 1), 1, kh, 1, 3);
    for (const sx of [-1, 1]) v.box(sx * (xL + 1), yb + SH, 0, 1, 1, 1, 3);

    // ── 雕像群：四根墩柱的正面、背面腳下，金字塔形 ──
    const group = (sx, sz) => {
      const fz = sz * zL;                                       // 這一面牆的 z
      const xa = sx * (pin + gm), xb = sx * (xL - gm);
      bx(xa - sx, xb + sx, yb, 1, fz + sz, fz + sz * (pd + 1), 3);            // 台座底
      bx(xa, xb, yb + 1, ph - 2, fz + sz, fz + sz * pd, stone);                // 台座身
      bx(xa - sx, xb + sx, yb + ph - 1, 1, fz + sz, fz + sz * (pd + 1), 3);    // 台座頂
      const gx = sx * (pin + xL) / 2, gz = fz + sz * (pd + 1) / 2;
      const gy0 = yb + ph, gyT = Math.max(gy0 + 3, Math.min(c1y - 2, yb + m(17.3, 0)));
      const gH = gyT - gy0, gw = (Math.abs(xb - xa) + 1) / 2;
      const rf = Math.max(1.05, s * 0.072);
      const fig = (x0, x1, top, dz) => limb(v, { x: x0, y: gy0 + rf * 0.8, z: gz + dz,
        x1, y1: gy0 + gH * top, z1: gz + dz, r: rf, r1: rf * 0.9, c: 4 });
      for (const q of [-1, 1]) {
        fig(gx + q * gw * 0.7, gx + q * gw * 0.9, 0.38, sz * 0.5);              // 外側兩個矮、往外斜
        fig(gx + q * gw * 0.28, gx + q * gw * 0.32, 0.58, 0);                  // 內側兩個高
      }
      limb(v, { x: gx, y: gy0 + gH * 0.5, z: gz, x1: gx, y1: gy0 + gH * 0.88, z1: gz + sz * 0.3,
                r: rf * 1.1, r1: rf * 0.85, c: 4 });                           // 最上面的勝利女神
      limb(v, { x: gx, y: gy0 + gH * 0.82, z: gz + sz * 0.3,
                x1: gx - sx * gw * 0.55, y1: gyT + 0.8, z1: gz + sz, r: 0.85, c: 4 });   // 舉起的手臂
      for (const q of [-1, 1])                                                 // 兩片翅膀斜著張開，貼著牆面
        plate(v, { plane: 'xy', at: fz + sz, t: 1, w: 2.2, c: 4,
                   pts: [[gx + q * 0.5, gy0 + gH * 0.68], [gx + q * gw, gyT + 0.5]] });
    };
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) group(sx, sz);

    // ── 浮雕板：第一道簷與大浮雕帶之間（正背面在墩柱上、側面在小拱上方）──
    const py0 = c1y + 2, py1 = eb - 2;
    const panel = (ax, p, q, face) => {
      if (py1 - py0 < 2) return;
      const a0 = Math.min(p, q), a1 = Math.max(p, q);
      for (let a = a0; a <= a1; a++) for (let y = py0; y <= py1; y++) {
        const x = ax === 'z' ? a : face, z = ax === 'z' ? face : a;
        const edge = a === a0 || a === a1 || y === py0 || y === py1;
        tint(v, x, y, z, edge ? 3 : relief(x, y, z));
      }
    };
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) panel('z', sx * (pin + gm), sx * (xL - gm), sz * zL);
    for (const sx of [-1, 1]) panel('x', -(zL - 2), zL - 2, sx * xL);

    // ── 頂樓的圓章：深色外圈＋淺色圓心（實物 30 面，格子不夠就排疏一點）──
    const rs = Math.max(1.5, Math.min(s * 0.12, (atH - 2) / 2));
    const st = 2 * Math.floor(rs + 0.35) + 2;
    const sy = at0 + Math.floor(atH / 2);
    const shield = (ax, a, face) => {
      const n = Math.ceil(rs);
      for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
        const d = Math.hypot(i, j);
        if (d > rs + 0.35) continue;
        const c = d > rs - 0.5 ? 3 : 2;
        if (ax === 'z') tint(v, a + i, sy + j, face, c); else tint(v, face, sy + j, a + i, c);
      }
    };
    const nf = Math.max(3, Math.floor((W - 2) / st)), ns = Math.max(1, Math.floor((D - 2) / st));
    for (const sz of [-1, 1]) rowOf(v, nf, st, (vv, x) => shield('z', x, sz * zL), 0);
    for (const sx of [-1, 1]) rowOf(v, ns, st, (vv, z) => shield('x', z, sx * xL), 0);

    // ── 無名戰士墓與長明火（大拱正下方）──
    for (let x = -1; x <= 1; x++) for (let z = -2; z <= 2; z++) tint(v, x, 0, z, 8);
    v.set(0, yb, -3, 7);
  } },
{ n: '艾菲爾鐵塔', lo: 2.5, hi: 14.5, pal: [0x4a4237, 0x685f52, 0x8a8070, 0xf2d06b, 0x322c25],
  /* 來源：blueprints/艾菲爾鐵塔.js（v1.114 換掉原本那份） */
  gen(v, s) {
    // === 尺寸參數 ===
    const baseSpan = dim(s, 3.2, 14, true);    // 底層四腳總跨度（寬闊大底）
    const footW = Math.max(2, Math.round(s * 0.45)); // 腳座粗度
    const y1 = dim(s, 1.4, 5);                // 一樓平台高度
    const y2 = dim(s, 3.0, 11);               // 二樓平台高度
    const y3 = dim(s, 7.2, 26);               // 三樓頂部高度
    const spireH = dim(s, 2.2, 8);            // 頂部尖塔天線高

    const p1W = dim(s, 2.0, 9, true);         // 一樓平台寬
    const p2W = dim(s, 1.2, 5, true);         // 二樓平台寬
    const p3W = dim(s, 0.45, 2, true);        // 三樓頂平台寬

    // 1. 底座：四個混凝土獨立基座
    corners4(v, (baseSpan - footW) / 2, (baseSpan - footW) / 2, (vv, x, z) => {
      vv.box(x, 0, z, footW + 2, 1, footW + 2, 4);
    });

    // 2. 一樓四根大傾斜拱腿（由粗漸細內收）
    for (let y = 1; y < y1; y++) {
      const t = y / y1;
      const curSpan = (baseSpan - footW) * (1 - t) + (p1W - footW) * t;
      const w = Math.max(1, Math.round(footW * (1 - t * 0.35)));
      corners4(v, curSpan / 2, curSpan / 2, (vv, x, z) => {
        vv.box(x, y, z, w, 1, w, 0);
      });
    }

    // 3. 一樓大跨距圓拱（貼在四腳內側，形成標誌性懸空大拱）
    const archR = Math.max(2, Math.round((baseSpan - footW * 2) * 0.45));
    const archY = Math.round(y1 * 0.65);
    mirrorZ(v, (baseSpan - footW * 1.2) / 2, (vv, dz) => {
      for (let y = 1; y <= archY; y++) {
        const curW = Math.round(archR * 2 * Math.sqrt(Math.max(0, 1 - Math.pow((archY - y) / archY, 2))));
        if (curW > 0) vv.box(0, y, dz, curW, 1, 1, 1);
      }
    });
    mirrorX(v, (baseSpan - footW * 1.2) / 2, (vv, dx) => {
      for (let y = 1; y <= archY; y++) {
        const curW = Math.round(archR * 2 * Math.sqrt(Math.max(0, 1 - Math.pow((archY - y) / archY, 2))));
        if (curW > 0) vv.box(dx, y, 0, 1, 1, curW, 1);
      }
    });

    // 4. 一樓大平台（線腳、護欄與支撐層）
    v.box(0, y1, 0, p1W + 2, 1, p1W + 2, 2);
    v.walls(0, y1 + 1, 0, p1W, 1, p1W, 0, 1);

    // 5. 一樓至二樓梯形塔身（四角收攏 + 桁架交叉支撐）
    for (let y = y1 + 2; y < y2; y++) {
      const t = (y - y1 - 2) / (y2 - y1 - 2);
      const curSpan = p1W * (1 - t) + p2W * t;
      const w = Math.max(1, Math.round(footW * 0.55 * (1 - t * 0.3)));
      corners4(v, (curSpan - w) / 2, (curSpan - w) / 2, (vv, x, z) => {
        vv.box(x, y, z, w, 1, w, 0);
      });
      // 中層腰線連繫環
      if (y === Math.round((y1 + y2) / 2)) {
        v.walls(0, y, 0, curSpan, 1, curSpan, 1, 1);
      }
    }

    // 6. 二樓平台（雙層突出觀景台）
    v.box(0, y2, 0, p2W + 2, 1, p2W + 2, 2);
    v.walls(0, y2 + 1, 0, p2W, 1, p2W, 0, 1);

    // 7. 二樓至三樓主塔身（流暢中空收尖）
    const h3 = y3 - y2 - 2;
    v.taper(0, y2 + 2, 0, (p2W + 1) / 2, (p3W + 1) / 2, h3, 0, 1);

    // 塔身外壁 X 桁架與每層加固圈（使用亮色鋼樑）
    const ringStep = Math.max(3, Math.round(h3 / 5));
    for (let y = y2 + 2 + ringStep; y < y3; y += ringStep) {
      const t = (y - y2 - 2) / h3;
      const curW = Math.round(p2W * (1 - t) + p3W * t);
      v.walls(0, y, 0, curW + 1, 1, curW + 1, 1, 1);
    }

    // 8. 三樓頂層觀景台、圓形雙層燈塔艙
    v.box(0, y3, 0, p3W + 2, 1, p3W + 2, 2);
    v.cyl(0, y3 + 1, 0, (p3W + 1) / 2, 2, 0, 1);
    v.dome(0, y3 + 3, 0, (p3W + 1) / 2, 1, 0.7);

    // 9. 頂端細長天線避雷針與金色探照燈頂點
    const antBase = y3 + 4;
    v.taper(0, antBase, 0, 0.9, 0.3, spireH, 0);
    v.box(0, antBase + spireH, 0, 1, 1, 1, 3);
  } },

{ n: '自由女神', lo: 2.0, hi: 13.5,
  // v1.285.0 整座重畫（見 開發筆記〈還很粗糙的七座重畫〉）
  pal: [0x5f9e88,   // 0 銅綠本色
        0x86c2a8,   // 1 銅綠亮面：衣褶凸稜、臉、銘牌正面
        0x3d6e60,   // 2 銅綠暗面：褶子裡、眼睛、冠冕的窗、鎖鏈
        0xe8b33a,   // 3 鍍金火焰
        0xa8958a,   // 4 花崗岩基座（偏暖的灰粉）
        0x6f6660,   // 5 深一階石：線腳、簷口、柱廊凹面、石縫
        0x8e8f8c,   // 6 星形堡壘與混凝土基礎的灰石
        0x5d8a3e],  // 7 星形台地上的草地
  gen(v, s) {
    // 正面：細高的銅綠立像站在方形花崗岩基座上，右手（畫面左邊）把細長的金色火焰舉過頭頂，
    //   左手把一塊斜擺的銘牌抱在左側；基座下是兩三階往外放寬的灰色基礎，最底下一圈星形矮城牆。
    // 側面：雕像前後薄（約寬的六成），長袍下襬往後拖、右腳跟在背後抬起；
    //   基座比雕像寬一截、高度跟雕像到下巴差不多；星形堡壘又寬又矮。
    // 三樣識別物：高舉的細長金色火炬、七道光芒的冠冕、星形堡壘上的方形基座（加上斜抱的銘牌）
    // 部件：著地＝星形堡壘（城牆、壓頂、女兒牆、台地鋪面與尖角草地）、階梯狀混凝土基礎、
    //       花崗岩基座（台階、粗石柱身、陽台腰線、柱廊凹窗、圓盤飾帶、簷口、頂上欄杆）、雕像矮台、腳邊斷鍊；
    //       姿勢＝右手高舉、左手屈肘抱銘牌、右膝彎、右腳在後腳跟抬起、左腳尖從下襬探出；
    //       軀幹＝下襬外張、膝部收、高腰、胸、斜肩；四肢＝兩臂各分上臂／前臂；
    //       頭＝頸、頭、後腦的髮髻、臉（亮面）、眼、冠冕（窗）、七道光芒；
    //       衣物＝長袍細直褶、從左肩斜披到右腰的斗篷（粗斜褶、下襬斜切）、火炬（柄、杯、欄杆、火焰）、銘牌
    const H = (x, y, z) => (((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) >>> 0) % 100;
    const hd = s * 0.6;              // 頭高（下巴到頭頂）：整尊唯一的錨，不取整
    const prof = (P, t) => {         // 折線內插：剖面表 [[t, 值], …]
      if (t <= P[0][0]) return P[0][1];
      for (let i = 1; i < P.length; i++) if (t <= P[i][0]) {
        const [t0, a0] = P[i - 1], [t1, a1] = P[i];
        return a0 + (a1 - a0) * (t - t0) / (t1 - t0);
      }
      return P[P.length - 1][1];
    };
    // 方環：切比雪夫距離 a < d ≤ b 的格子，顏色交給 cf 挑（一邊蓋一邊挑石色）
    const sq = (y, a, b, cf) => {
      for (let x = -b; x <= b; x++) for (let z = -b; z <= b; z++) {
        if (Math.max(Math.abs(x), Math.abs(z)) <= a) { z = a; continue; }
        const c = cf(x, y, z);
        if (c >= 0) v.set(x, y, z, c);            // 回傳 −1 ＝ 這格留空
      }
    };
    const stone = (c0, c1, p) => (x, y, z) => (H(x, y, z) < p ? c1 : c0);   // 石材：本色 c0，固定雜湊挑 p% 換成 c1

    // ── 垂直分段：每一段的 y0 都從下一段的頂面算 ──
    const hf = dim(s, 0.42, 2);                 // 星形堡壘城牆高（實物 9 m，壓成約 0.7 頭）
    const fh = dim(s, 0.6, 2);                  // 混凝土基礎露出台地的那一段（實物約 11 m，壓成約 1 頭）
    const pw = dim(s, 0.88, 3);                 // 基座柱身半寬（全寬約 2.9 頭，比雕像的 2.3 頭寬一截）
    const nt = fh >= 6 ? 3 : 2;                 // 基礎分幾階（每階至少兩層高，才是「階」不是斜坡）
    const ft = pw + 2 + (s >= 8 ? 1 : 0);       // 最上一階的半寬：跟基座台階齊平，大尺寸才多留一圈走道
    const fb = ft + nt - 1;                     // 最下一階的半寬：一階往內收一格

    // ── 1. 星形堡壘：十一角星，正面（−z）對著兩個尖角中間的凹口，背面是一個尖角 ──
    // 凹口半徑：要包得住基礎的四個角。拿沒取整的半寬算——基座半寬每跳一格，整圈星形一起跳的話塊數一階差一成
    const ri = (Math.max(3, s * 0.88) + (fb - pw)) * 1.42 + 1.5;
    const ro = ri * 1.36;                       // 尖角半徑
    const T = Math.PI / 11;
    const NX = ri * Math.cos(T), NZ = ri * Math.sin(T), EL = Math.hypot(NX - ro, NZ);
    const inStar = (x, z) => {
      const r = Math.sqrt(x * x + z * z);
      if (r <= NX * 0.98) return true;
      if (r > ro + 0.6) return false;
      let a = Math.atan2(x, -z) % (2 * T); if (a < 0) a += 2 * T;
      const w = Math.abs(a - T);                // 0 ＝ 尖角方向、T ＝ 凹口方向
      const qx = r * Math.cos(w), qz = r * Math.sin(w);
      return ((NX - ro) * qz - NZ * (qx - ro)) / EL >= -0.45;
    };
    // 先把星形填成一張遮罩（外圍多留一圈 0，查鄰格不用判邊界）；星形左右對稱，只算 x ≥ 0 那半邊
    const RS = Math.ceil(ro + 1), SW = RS * 2 + 3, at = (x, z) => (x + RS + 1) * SW + z + RS + 1;
    const star = new Uint8Array(SW * SW);
    for (let x = 0; x <= RS; x++) for (let z = -RS; z <= RS; z++)
      if (inStar(x, z)) star[at(x, z)] = star[at(-x, z)] = 1;
    const lawn = ri * 1.06;                     // 尖角裡（離中心比凹口遠）留草地
    for (let x = -RS; x <= RS; x++) for (let z = -RS; z <= RS; z++) {
      const i = at(x, z);
      if (!star[i]) continue;
      const edge = !star[i + SW] || !star[i - SW] || !star[i + 1] || !star[i - 1];
      if (edge) {
        for (let y = 0; y < hf - 1; y++) v.set(x, y, z, H(x, y, z) < 22 ? 5 : 6);   // 灰花崗岩方石城牆
        v.set(x, hf - 1, z, 5);                 // 壓頂
        v.set(x, hf, z, 6);                     // 女兒牆
      } else if (Math.max(Math.abs(x), Math.abs(z)) >= fb) {
        v.set(x, hf - 1, z, x * x + z * z > lawn * lawn ? 7 : (H(x, 0, z) < 18 ? 5 : 6));  // 台地：鋪面＋尖角草地
      }
    }

    // ── 2. 混凝土基礎：階梯狀，一階往內收一格；每階頂層鋪滿到上一階的牆腳，最上面是接住基座台階的走道 ──
    for (let j = 0; j < fh; j++) {
      const k = Math.min(nt - 1, Math.floor(j * nt / fh)), h = fb - k;
      const top = j === fh - 1 || Math.floor((j + 1) * nt / fh) !== k;
      sq(hf + j, top ? (k === nt - 1 ? pw + 1 : h - 2) : h - 1, h, stone(6, 5, 12));
    }
    const yP = hf + fh;                         // 基座底面

    // ── 3. 花崗岩基座：台階、粗石柱身、陽台腰線、柱廊凹窗、圓盤飾帶、簷口、頂上欄杆 ──
    // 基座（台階到欄杆）約 4.4 頭（實物 27 m ≈ 5.6 頭，只壓到八成），雕像才不會像站在一塊矮墩上；
    // 堡壘與基礎壓得多（合起來 1.6 頭，實物 4.1 頭）——省下的積木留給雕像刻姿勢與衣褶
    const pl = dim(s, 0.15, 2), hl = dim(s, 1.25, 3), hg = dim(s, 0.75, 2), hz = dim(s, 0.2, 1);
    sq(yP, pw - 1, pw + 2, stone(5, 4, 30));                    // 台階
    for (let j = 1; j < pl; j++) sq(yP + j, pw - 1, pw + 1, stone(5, 4, 30));
    const ys = yP + pl;                         // 柱身底
    for (let j = 0; j < hl; j++) sq(ys + j, pw - 1, pw, stone(4, 5, 16));         // 粗石柱身
    const yb = ys + hl;
    sq(yb, pw - 1, pw + 1, () => 5);            // 陽台腰線（往外凸 1 格）
    const pier = Math.max(2, Math.round(pw * 0.3)), rw = pw - pier;
    for (let j = 1; j <= hg; j++) {
      sq(yb + j, pw - 1, pw, (x, y, z) => {
        const t = Math.abs(z) === pw ? x : z;
        if (Math.abs(t) > rw) return 4;
        return ((t + rw) % 2 === 0) ? 4 : -1;   // 柱子留著，柱間挖成凹窗
      });
      for (let t = -rw; t <= rw; t++) {         // 凹窗：柱間往裡退一格、塗深色
        if ((t + rw) % 2 === 0) continue;
        for (const [x, z] of [[t, -pw], [t, pw], [-pw, t], [pw, t]])
          v.set(x === t ? x : x - Math.sign(x), yb + j, z === t ? z : z - Math.sign(z), 5);
      }
    }
    const yz = yb + hg + 1;
    for (let j = 0; j < hz; j++) sq(yz + j, pw - 1, pw, (x, y, z) => {
      const t = Math.abs(z) === pw ? x : z;
      return j === hz - 1 && Math.abs(t) < pw && (t + pw) % 2 === 0 ? 5 : 4;      // 圓盤飾帶
    });
    const yc = yz + hz;                         // 簷口兼頂面陽台的地板
    sq(yc, -1, pw + 1, (x, y, z) => (Math.max(Math.abs(x), Math.abs(z)) === pw + 1 ? 5 : 4));
    sq(yc + 1, pw, pw + 1, (x, y, z) => {       // 欄杆柱：每隔一格一根
      const t = Math.abs(z) === pw + 1 ? x : z;
      return Math.abs(t) === pw + 1 || t % 2 === 0 ? 4 : -1;
    });
    sq(yc + 2, pw, pw + 1, () => 5);            // 欄杆扶手

    // ── 4. 雕像：腳跟在 y0，頭身比 7（下巴在 6 頭高、頭頂在 7 頭高） ──
    // 雕像自己的矮台：墊高一層，下襬才不會整圈躲在欄杆後面
    v.box(0, yc + 1, 0, 2 * Math.min(pw - 1, Math.round(1.25 * hd)) + 1, 1, 2 * Math.min(pw - 1, Math.round(0.95 * hd)) + 1, 5);
    const y0 = yc + 2;
    // 長袍剖面（半寬、半深，頭高為單位）：下襬外張、膝部收、高腰最細、斜肩收到頸
    const PXs = [[0, 1.15], [0.3, 1.08], [1.2, 1.02], [2.2, 0.98], [3.4, 0.97], [4.4, 0.88],
                 [5.0, 0.88], [5.25, 0.82], [5.45, 0.7], [5.6, 0.52], [5.75, 0.3]];
    const PZs = [[0, 0.82], [0.3, 0.72], [1.2, 0.64], [2.2, 0.62], [3.4, 0.62], [4.4, 0.56],
                 [5.0, 0.6], [5.25, 0.56], [5.45, 0.5], [5.6, 0.42], [5.75, 0.28]];
    /* 斗篷（palla）蓋在哪裡：背面整片垂到腳邊；正面是一條從左肩斜到右腰的帶子，下襬斜切（右高左低）。
       正面那條帶子＝ xc（正規化的 x，−1 左緣～+1 右緣）落在 [下襬線, 上緣線) 之間，兩條線每層先解成 x 的門檻 */
    const pallaRow = t => ({ on: t > 0.35 && t < 5.6, hem: (t - 1.95) / 0.85, top: (5.75 - t) / 1.1 - 0.55 });
    const isPal = (P, xc, zn) => P.on && (zn > 0.25 || (xc <= P.hem && xc < P.top));
    const robeTop = Math.round(5.75 * hd), dt = 1 / hd;
    // 方位角只跟 (x, z) 有關，整件袍子共用一張表（gen 一輪要跑六十次，atan2 省下來很可觀）
    const RX = Math.ceil(1.15 * hd + 2.6), RZ = Math.ceil(0.82 * hd + 2.6), TW = 2 * RZ + 1;
    const TH = new Float32Array((2 * RX + 1) * TW);
    for (let x = -RX; x <= RX; x++) for (let z = -RZ; z <= RZ; z++) TH[(x + RX) * TW + z + RZ] = Math.atan2(x, -z);
    for (let j = 0; j <= robeTop; j++) {
      const t = j / hd, y = y0 + j;
      const ax = prof(PXs, t) * hd, az = prof(PZs, t) * hd;
      const Rx = Math.ceil(ax + 2.6);
      // 褶距：一道褶至少要「暗、本色、亮」三格才排得出來，再密就變成一格一格的棋盤雜訊
      const Ns = Math.max(6, Math.round(Math.PI * (ax + az) / 3.0));     // 長袍細褶
      const Np = Math.max(4, Math.round(Math.PI * (ax + az) / 4.2));     // 斗篷粗褶
      const hollow = ax > 5.5 && t > 0.3 && t < 5.2;                     // 大尺寸挖空，省下看不到的格子
      // 四處局部鼓起（高度方向的權重每層先算好）：右膝往前頂、左腳往前踏、胸、
      // 左前臂上垂下來的那一大片斗篷（左側略偏後鼓出來，正面看左右才不對稱）
      const gs = q => Math.exp(-q * q);
      const kn = t > 0.6 && t < 3.4 ? 0.9 * gs((t - 2.0) / 0.6) : 0;
      const lf = t < 2.2 ? 0.8 * gs((t - 0.5) / 0.7) : 0;
      const ch = t > 4.3 && t < 5.7 ? 0.6 * gs((t - 5.0) / 0.3) : 0;
      const dr = t > 1.2 && t < 4.6 ? 0.28 * hd * Math.min(1, (t - 1.2) / 0.8, (4.6 - t) / 0.4) : 0;
      const P = pallaRow(t), P1 = pallaRow(t + dt);
      /* 離基本橢圓表面的格數 d ＝ 該方向的半徑 ×（r − 1），那個半徑介於 az 與 ax 之間，
         所以 r 落在門檻外的格子不用細算就知道：一定在外面／一定在深處。表面最多凹進 0.75 格、
         上色只看表面往裡 1.05 格，所以 d < −1.8 的一律是看不到的本色、直接填；
         挖空時改成 d < −2.2 的整段不要，其餘照「表面往裡 1.9 格」留殼。
         每一排 x 先解出 z 的門檻，只有中間那一圈帶子逐格算褶子 */
      const cut = Math.min(2.6, 1.3 + Math.max(kn, lf, ch, dr)), rOut = (1 + cut / az) * (1 + cut / az);
      const deep = hollow ? 2.2 : 1.8, rIn = az > deep ? (1 - deep / az) * (1 - deep / az) : -1;
      for (let x = -Rx; x <= Rx; x++) {
        const xn = x / ax, q = xn * xn;
        if (q > rOut) continue;
        const zo = Math.floor(az * Math.sqrt(rOut - q));               // 這一排的外緣
        const zi = q < rIn ? Math.ceil(az * Math.sqrt(rIn - q)) : 0;  // |z| < zi：深處
        for (let z = -zo; z <= zo; z++) {
          if (z > -zi && z < zi) {
            if (hollow) z = zi - 1; else v.set(x, y, z, 0);
            continue;
          }
          const zn = z / az, r = Math.sqrt(q + zn * zn);
          const d = r > 0 ? Math.sqrt(x * x + z * z) * (1 - 1 / r) : -az;   // 離基本橢圓表面幾格（負的在裡面）
          if (d > cut) continue;
          if (d < -deep) { if (!hollow) v.set(x, y, z, 0); continue; }
          const th = TH[(x + RX) * TW + z + RZ];  // 0 ＝ 正前方，往 +x（右手邊）為正
          const xc = xn > 1 ? 1 : xn < -1 ? -1 : xn;
          const pal = isPal(P, xc, zn);
          const g = pal ? 0.5 - 0.5 * Math.cos(Np * th + (zn < 0.25 ? 1.6 * t : 0))   // 斗篷：正面斜褶、背面直褶
                        : 0.5 - 0.5 * Math.cos(Ns * th + 0.2 * t);                   // 長袍：細直褶
          let off = 0.35 - (pal ? 1.0 : 1.1) * Math.max(0, (g - 0.4) / 0.6) + (pal ? 0.9 : 0);
          if (kn && th > -0.6 && th < 1.6) off += kn * gs((th - 0.5) / 0.4);
          if (lf && th > -1.6 && th < 0.9) off += lf * gs((th + 0.35) / 0.45);
          if (ch && th > -2 && th < 2) off += ch * gs(th / 0.9);
          if (dr && th < -0.4) off += dr * gs((th + 1.75) / 0.5);
          if (d > off || (hollow && d < off - 1.9)) continue;
          let c = 0;
          if (d > off - 1.05) {
            // 溝底暗、凸稜亮；長袍的亮稜寬、斗篷的暗溝寬——斜披的那條帶子才跟底下的長袍分得開
            c = pal ? (g > 0.55 ? 2 : g < 0.08 ? 1 : 0) : (g > 0.78 ? 2 : g < 0.45 ? 1 : 0);
            if (!pal && zn <= 0.25 && isPal(P1, xc, zn)) c = 2;          // 斗篷下襬底下的陰影
          }
          v.set(x, y, z, c);
        }
      }
    }
    // 腳：左腳尖從下襬前面探出來；右腳在後、腳跟抬起（小尺寸時收在欄杆裡面，不要壓到欄杆）
    const az0 = 0.82 * hd, fr0 = Math.max(0.75, 0.17 * hd);
    blob(v, -0.35 * hd, y0 + 0.12 * hd, -az0 - 0.15 * hd, 0.2 * hd, 0.16 * hd, 0.28 * hd, 0);
    limb(v, { x: 0.4 * hd, y: y0, z: az0 * 0.6, x1: 0.45 * hd, y1: y0 + 0.55 * hd,
              z1: Math.min(az0 + 0.3 * hd, pw - 1 - fr0), r: fr0, c: 0 });
    // 腳邊斷掉的鎖鏈：右腳前一小截
    const cz = -Math.min(pw - 1, Math.round(az0 + 0.35 * hd + 1));
    for (let i = 0; i < Math.max(3, Math.round(hd * 0.9)); i++)
      v.set(Math.round(0.15 * hd) + i, y0 + (i % 2), cz - (i % 3 === 2 ? 1 : 0), 2);

    // 頸與頭（臉朝 −z，頭心略往前）：頸短，頭兩側有波浪髮把頭撐寬
    const hz0 = -0.08 * hd, fz = Math.round(hz0), hy = y0 + 6.5 * hd;
    // 頸從袍子頂一路接進頭裡：頸與頭各自取整的話，小尺寸會在下巴底下空一層（實測 3000 那檔空過，頭只靠光芒搭在右臂上）
    const yN = y0 + robeTop - 1;
    v.cyl(0, yN, fz, Math.max(0.9, 0.24 * hd), Math.round(hy - 0.25 * hd) - yN + 1, 0);
    blob(v, 0, hy, hz0, 0.4 * hd, 0.52 * hd, 0.47 * hd, 0);
    blob(v, 0, hy - 0.02 * hd, hz0 + 0.12 * hd, 0.46 * hd, 0.36 * hd, 0.4 * hd, 0);    // 兩側與後面的頭髮
    blob(v, 0, hy - 0.12 * hd, hz0 + 0.36 * hd, 0.28 * hd, 0.28 * hd, 0.24 * hd, 0);   // 後腦髮髻
    // 臉：亮一階，眼睛點暗色（眼睛那一排一定落在冠冕底下，小尺寸時兩者只差一格）
    const yk = Math.round(hy + 0.3 * hd), kh = Math.max(1, Math.round(0.28 * hd)), kr = 0.48 * hd;
    const fn = Math.ceil(0.6 * hd) + 2, ye = Math.min(Math.round(hy + 0.05 * hd), yk - 1);
    for (let x = -Math.round(0.22 * hd); x <= Math.round(0.22 * hd); x++)
      for (let y = Math.round(hy - 0.42 * hd); y <= ye; y++)
        paintFrom(v, x, y, fz, 0, 0, -1, fn, 1);
    mirrorX(v, Math.max(1, Math.round(0.16 * hd)), (vv, dx) => paintFrom(vv, dx, ye, fz, 0, 0, -1, fn, 2));

    // 冠冕：一圈帶窗的冠，七道光芒往外往上放射（排在前半圈，最外兩道在耳朵上方）
    v.cyl(0, yk, fz, kr, kh, 0);
    /* 光芒約半個頭長（實物 2.7 m）。小尺寸刻意畫細（半徑 0.55 ＝ 一格寬的斜線，支撐算斜角相鄰、不會懸空）：
       粗到 0.75 的話七道在九格寬裡擠成一整片帽簷，正面看不出是一根一根的尖刺。 */
    const L = Math.max(2.6, 0.58 * hd), ev = 45 * Math.PI / 180, yr = yk + kh * 0.5;
    const Lh = L * Math.cos(ev), Lv = L * Math.sin(ev);
    for (let i = -3; i <= 3; i++) {
      const a = i * 30 * Math.PI / 180, ca = Math.sin(a), sa = -Math.cos(a);
      limb(v, { x: ca * (kr - 0.3), y: yr, z: fz + sa * (kr - 0.3),
                x1: ca * (kr + Lh), y1: yr + Lv, z1: fz + sa * (kr + Lh),
                r: hd < 5 ? 0.55 : 0.15 * hd, r1: Math.max(0.5, 0.04 * hd), c: 0 });
    }
    // 冠冕正面一排小窗（光芒根部會蓋到冠冕，所以最後才點）
    for (let x = -Math.round(kr) + 1; x < Math.round(kr); x += 2)
      paintFrom(v, x, yk, fz, 0, 0, -1, Math.ceil(kr) + 2, 2);

    // 右手（+x）高舉火炬：上臂、前臂兩段，手在頭頂右上方
    const sh = [0.78 * hd, y0 + 5.35 * hd, 0.05 * hd];
    const el = [1.05 * hd, y0 + 6.65 * hd, -0.02 * hd];
    const hn = [1.16 * hd, y0 + 7.9 * hd, -0.1 * hd];
    limb(v, { x: sh[0], y: sh[1], z: sh[2], x1: el[0], y1: el[1], z1: el[2], r: 0.32 * hd, r1: 0.22 * hd, c: 0 });
    limb(v, { x: el[0], y: el[1], z: el[2], x1: hn[0], y1: hn[1], z1: hn[2], r: 0.22 * hd, r1: 0.19 * hd, c: 0 });
    blob(v, hn[0], hn[1] + 0.05 * hd, hn[2], 0.22 * hd, 0.24 * hd, 0.22 * hd, 0);
    // 火炬：柄（銅）、杯（亮面）、一圈欄杆台（暗）、細長金焰（大約一個頭高、一個頭寬的六成）
    const tx = Math.round(hn[0]), tz = Math.round(hn[2]);
    const yt = Math.round(hn[1] + 0.2 * hd), th0 = Math.max(1, Math.round(0.3 * hd));
    v.cyl(tx, yt, tz, Math.max(0.6, 0.12 * hd), th0, 0);
    const ycup = yt + th0, cuh = Math.max(1, Math.round(0.22 * hd));
    v.taper(tx, ycup, tz, Math.max(0.7, 0.16 * hd), Math.max(1, 0.3 * hd), cuh, 1);
    const fr = Math.max(1.5, 0.3 * hd);
    v.cyl(tx, ycup + cuh, tz, fr + 0.4, 1, 2);
    v.taper(tx, ycup + cuh + 1, tz, fr, 0.3, Math.max(3, Math.round(1.0 * hd)), 3);

    /* 左手（−x）抱銘牌。Bartholdi 1879 年的設計專利：左臂垂靠身體、銘牌斜靠在左側髖部以上，
       斜著擺讓字朝向觀者，左手四指橫過銘牌正面——所以板面大半朝前、只偏左一點，頂端往外斜；
       上臂貼著身側垂下，前臂從肘往前繞到銘牌外緣。 */
    const lsh = [-0.78 * hd, y0 + 5.3 * hd, 0.05 * hd];
    const lel = [-1.02 * hd, y0 + 4.05 * hd, 0.12 * hd];
    const nb = 60 * Math.PI / 180, gm = 10 * Math.PI / 180, lean = 18 * Math.PI / 180;
    const N = [-Math.cos(nb), 0, -Math.sin(nb)];                  // 銘牌正面朝前、偏左
    let W = [-Math.sin(lean), Math.cos(gm), Math.sin(gm)];        // 長邊：頂端往外斜、略往後靠
    const wn = W[0] * N[0] + W[1] * N[1] + W[2] * N[2];
    W = W.map((q, i) => q - wn * N[i]);
    const wl = Math.sqrt(W[0] * W[0] + W[1] * W[1] + W[2] * W[2]); W = W.map(q => q / wl);
    const U = [N[1] * W[2] - N[2] * W[1], N[2] * W[0] - N[0] * W[2], N[0] * W[1] - N[1] * W[0]];   // 板寬方向（+ 朝身體）
    const TC = [-1.0 * hd, y0 + 4.45 * hd, -0.36 * hd];
    const hu = 0.44 * hd, hw = 0.75 * hd, hn2 = Math.max(0.75, 0.08 * hd);
    const ex = [0, 1, 2].map(k => Math.ceil(hu * Math.abs(U[k]) + hw * Math.abs(W[k]) + hn2 * Math.abs(N[k])) + 1);
    for (let x = Math.round(TC[0]) - ex[0]; x <= Math.round(TC[0]) + ex[0]; x++)
      for (let y = Math.round(TC[1]) - ex[1]; y <= Math.round(TC[1]) + ex[1]; y++)
        for (let z = Math.round(TC[2]) - ex[2]; z <= Math.round(TC[2]) + ex[2]; z++) {
          const dx = x - TC[0], dy = y - TC[1], dz = z - TC[2];
          const c = dx * N[0] + dy * N[1] + dz * N[2];
          if (c > hn2 || c < -hn2) continue;
          const a = dx * U[0] + dy * U[1] + dz * U[2], b = dx * W[0] + dy * W[1] + dz * W[2];
          if (Math.abs(a) > hu || Math.abs(b) > hw) continue;
          // 亮面板身；大尺寸才描本色的邊框、刻一行字（小尺寸板子只有三格寬，描了邊就整塊變回本色、跟袍子分不開）
          const rim = hd >= 5 && (Math.abs(a) > hu - 0.9 || Math.abs(b) > hw - 0.9);
          v.set(x, y, z, rim ? 0 : (hd >= 5 && Math.abs(b) < 0.5 && c > 0 ? 2 : 1));
        }
    // 左手：銘牌外緣偏下、壓在板面前面（四指橫過正面）
    const hk = [-0.75 * hu, -0.25 * hw, hn2 + 0.4];
    const lhn = [0, 1, 2].map(k => TC[k] + U[k] * hk[0] + W[k] * hk[1] + N[k] * hk[2]);
    limb(v, { x: lsh[0], y: lsh[1], z: lsh[2], x1: lel[0], y1: lel[1], z1: lel[2], r: 0.28 * hd, r1: 0.22 * hd, c: 0 });
    limb(v, { x: lel[0], y: lel[1], z: lel[2], x1: lhn[0], y1: lhn[1], z1: lhn[2], r: 0.22 * hd, r1: 0.19 * hd, c: 0 });
  } },
{ n: '倫敦大笨鐘',
  // v1.314.0 整座重畫：盲測第八回的子 agent 只拿〈藍圖製作說明〉、從零做出來的第一版（沒有任何回饋），
  // 原樣收進來，只改了名字與 pal 的寫法（見 開發筆記〈盲測第八回：倫敦大笨鐘、日本姬路城、大阪城天守閣、莫斯科克里姆林塔（v1.314.0）〉）
  // 正面：一根細長的方柱（寬：高約 1：8），上段鐘面那一截往外凸一格、正中一個白色大圓鐘面；
  //       鐘面上方是開尖拱口的鐘室，再上去是陡峭的深色尖頂，中段一圈燈籠，頂上一根金色細尖
  // 側面：四面相同的正方塔，側面跟正面一樣（四面都有鐘）
  // 三樣識別物：四面白色大圓鐘面＋金框（含方框四角暗金）、鐘面上方的尖拱鐘室開口、
  //             陡峭深色鑄鐵尖頂＋四角小尖塔＋頂端細尖
  // 比例表（實物）：全高 96 m；塔身 12 m 見方；石砌到 61 m，以上是鑄鐵框架的尖頂（鐘面以上約 30 m）；
  //                 鐘面直徑 6.9 m（含框）、中心離地 55 m；鐘室約 61～68 m；尖頂約 68～96 m
  //                 （s 的單位約等於「每 10 m 幾格」：塔身寬 1.2·s、全高約 9.7·s）
  // 輪廓寬度（正面，以塔身寬 ＝ 1）：台基 1.3／塔身 1.0（含角柱 1.15）／鐘面段 1.15（簷 1.3）／
  //                 鐘室 1.0（簷 1.15，簷角小尖塔）／尖頂底 0.85 → 燈籠 0.38 → 頂 0.23 → 細尖 0.08
  // 部件尺寸（9000 塊估 s ≈ 10）：塔身寬 dim(s,1.2,7,奇)=13 格、鐘面段 15 格、高 13 層；
  //                 鐘面半徑 R=(7−1.6)×0.78≈4.2 → 直徑約 9 格（≥ 2 ✓），金框 1 格、指針 3／2 格；
  //                 塔身每層窗格 T=dim(s,0.8,4)=8 層、窗 1 格寬 4 層高；鐘室高 8 層、尖拱口寬 3 高 6；
  //                 尖頂 22 層：底寬 11 → 燈籠 5 → 3，細尖 5 格；簷角小尖塔底 3×3、高 10
  // 部件：台基(box＋walls) 塔身(walls＋顏色函式畫垂直窗格) 角柱(corners4＋box) 腰線(walls 一圈)
  //       鐘面段(walls) 鐘面(自畫小圓＋tint) 鐘面段簷(walls) 鐘面段小尖塔(taper)
  //       鐘室(walls＋深色內襯 walls＋自寫尖拱 carve) 鐘室簷(walls) 簷角小尖塔(taper)
  //       下段尖頂(逐層 walls，寬度取奇數) 燈籠(box＋顏色函式) 燈籠簷(box) 上段尖頂(逐層 box) 細尖(box)
  pal: [0xc2a878,   // 0 Anston 石灰岩（淺黃褐，主色）
        0x9e8660,   // 1 窗格凹板（暗一階）
        0x7d6848,   // 2 腰線、簷、台基（再暗一階）
        0x2c3038,   // 3 窗玻璃、鐘室開口裡、指針
        0xe6e1d0,   // 4 鐘面白
        0xd4a52c,   // 5 金（鐘面框、小尖塔尖、燈籠窗、細尖）
        0x8f6e24,   // 6 暗金（鐘面方框四角、燈籠簷）
        0x3a4150,   // 7 鑄鐵屋頂（深藍灰）
        0x2a2f3a,   // 8 鑄鐵暗帶
        0xb49b6d],  // 9 石材雜色
  lo: 1.5, hi: 16,

  gen(v, s) {
    const W = dim(s, 1.2, 7, true), hw = (W - 1) / 2;       // 塔身寬（奇數）
    const Wc = W + 2, hwc = hw + 1;                          // 鐘面段外凸一格
    const hp = dim(s, 0.3, 2);                               // 台基高
    const yC = dim(s, 4.8, 14);                              // 塔身頂 ＝ 鐘面段底（約 48 m）
    const T = dim(s, 0.8, 4);                                // 塔身一層窗格的高
    const R = Math.max(2.3, (hwc - 1.6) * 0.78);             // 鐘面半徑（含金框）
    const Q = Math.min(Math.round(R) + 1, hwc - 1);          // 鐘面外方框半寬
    const hc = 2 * Q + 3;                                    // 鐘面段高
    const yD = yC + Q + 1;                                   // 鐘面中心
    const yCc = yC + hc;                                     // 鐘面段簷
    const yB = yCc + 1, hb = dim(s, 0.75, 5);                // 鐘室
    const yBc = yB + hb;                                     // 鐘室簷
    const yS = yBc + 1;                                      // 尖頂底
    const hsp = dim(s, 2.2, 9), h1 = Math.round(hsp * 0.55); // 尖頂總高、下段高
    const hlt = dim(s, 0.3, 2), h2 = Math.max(2, hsp - h1 - hlt - 1);
    const hb0 = (W - 3) / 2, hl0 = Math.max(1, Math.round(hb0 * 0.45));   // 尖頂底、燈籠的半寬

    const stone = (x, y, z) => (hash100(x, y, z) < 12 ? 9 : 0);

    // ── 台基 ──
    v.box(0, 0, 0, W + 4, 1, W + 4, 2);
    v.walls(0, 1, 0, W + 4, hp - 1, W + 4, 2, 2);

    // ── 塔身：垂直窗格。每面中間奇數欄是暗一階的凹板、偶數欄是石框；正中兩欄開窗 ──
    const wlo = T >= 6 ? 2 : 1, whi = T >= 6 ? T - 3 : T - 2;
    const shaftC = (x, y, z) => {
      const ax = Math.abs(x), az = Math.abs(z);
      if (ax >= hw - 1 && az >= hw - 1) return stone(x, y, z);      // 轉角
      const u = Math.abs(az >= hw - 1 ? x : z);
      if (u > hw - 2) return stone(x, y, z);
      const ly = T - 1 - ((yC - 1 - y) % T);                         // 從塔身頂往下數的層內位置
      if (ly === T - 1 || u % 2 === 0) return stone(x, y, z);        // 窗格頂、直櫺
      if (u === 1 && ly >= wlo && ly <= whi) return 3;               // 窗
      return 1;                                                      // 盲窗凹板
    };
    v.walls(0, hp, 0, W, yC - hp, W, shaftC, 2);
    corners4(v, hw + 0.5, hw + 0.5, (vv, x, z) => vv.box(x, hp, z, 2, yC - hp, 2, stone));   // 角柱
    for (let y = yC - T; y >= hp; y -= T) v.walls(0, y, 0, W + 2, 1, W + 2, 2, 1);           // 腰線

    // ── 鐘面段 ──
    v.walls(0, yC, 0, Wc, hc, Wc, (x, y, z) => (y === yC ? 2 : stone(x, y, z)), 2);
    const hands = R >= 3, mh = Math.floor(R - 0.85), hh = Math.max(1, Math.round(mh * 0.6));
    const put = [
      (i, y, c) => tint(v, -i, y, -hwc, c),   // 正面（−z）：站在正面看，右手邊是 −x
      (i, y, c) => tint(v, i, y, hwc, c),     // 背面
      (i, y, c) => tint(v, hwc, y, -i, c),    // +x 面
      (i, y, c) => tint(v, -hwc, y, i, c)];   // −x 面
    for (let i = -Q; i <= Q; i++) for (let j = -Q; j <= Q; j++) {
      const q = Math.hypot(i, j);
      let c = q > R + 0.35 ? 6 : q > R - 0.65 ? 5 : 4;               // 方框四角／金框／白鐘面
      if (hands && c === 4 && ((i === 0 && j >= 0 && j <= mh) || (j === 0 && i >= 0 && i <= hh))) c = 3;   // 三點整
      for (const f of put) f(i, yD + j, c);
    }
    v.walls(0, yCc, 0, Wc + 2, 1, Wc + 2, 2, 3);                    // 鐘面段簷
    const hcp = dim(s, 0.6, 3), rcp = Math.max(0.9, s * 0.09);
    corners4(v, hwc + 1, hwc + 1, (vv, x, z) =>
      vv.taper(x, yB, z, rcp, 0.4, hcp, (X, Y, Z) => (Y >= yB + hcp - 1 ? 5 : 0)));

    // ── 鐘室：石牆＋深色內襯，四面開尖拱口 ──
    v.walls(0, yB, 0, W, hb, W, stone, 2);
    v.walls(0, yB, 0, W - 4, hb, W - 4, 3, 1);
    const wo = dim(s, 0.3, 3, true), ho = Math.max(1, hb - 2 - (wo - 1) / 2);
    const nO = Math.min(3, Math.max(1, Math.floor((W - 3) / (wo + 1))));
    const cut = (f, p, y, w, h) => {
      if (f === 0) v.carve(p, y, -hw + 0.5, w, h, 2);
      else if (f === 1) v.carve(p, y, hw - 0.5, w, h, 2);
      else if (f === 2) v.carve(hw - 0.5, y, p, 2, h, w);
      else v.carve(-hw + 0.5, y, p, 2, h, w);
    };
    for (let f = 0; f < 4; f++) rowOf(v, nO, wo + 1, (vv, p) => {
      cut(f, p, yB + 1, wo, ho);                                     // 直段
      for (let k = 1; k <= (wo - 1) / 2; k++) cut(f, p, yB + ho + k, wo - 2 * k, 1);   // 尖拱頭
    }, 0);
    v.walls(0, yBc, 0, W + 2, 1, W + 2, 2, 3);                      // 鐘室簷
    const hrp = dim(s, 1.0, 4), rrp = Math.max(0.9, s * 0.11);      // 簷角小尖塔
    corners4(v, hw + 1, hw + 1, (vv, x, z) =>
      vv.taper(x, yS, z, rrp, 0.4, hrp, (X, Y, Z) => (Y >= yS + hrp - 2 ? 5 : 7)));

    // ── 尖頂：下段逐層收（寬度一律奇數，左右才對稱），稜線上每三層一顆金色捲葉飾 ──
    for (let k = 0; k < h1; k++) {
      const hk = Math.round(hb0 + (hl0 - hb0) * k / (h1 - 1));
      const croc = k % 3 === 1, band = k % 4 === 3;
      v.walls(0, yS + k, 0, 2 * hk + 1, 1, 2 * hk + 1,
        (x, y, z) => (croc && Math.abs(x) === hk && Math.abs(z) === hk ? 5 : band ? 8 : 7), 2);
    }
    // 燈籠（Ayrton Light）：四面金色小窗
    const yL = yS + h1, wl = 2 * hl0 + 1;
    const wy0 = yL + (hlt >= 3 ? 1 : 0), wy1 = yL + hlt - (hlt >= 3 ? 2 : 1);
    v.box(0, yL, 0, wl, hlt, wl, (x, y, z) => {
      const ax = Math.abs(x), az = Math.abs(z);
      if (Math.max(ax, az) !== hl0 || y < wy0 || y > wy1) return 7;
      const u = ax === hl0 ? az : ax;
      if (u === hl0) return 7;
      return (hl0 >= 2 ? u % 2 === 1 : u === 0) ? 5 : 7;
    });
    v.box(0, yL + hlt, 0, wl + 2, 1, wl + 2, 6);                    // 燈籠簷
    const yU = yL + hlt + 1;
    for (let k = 0; k < h2; k++) {                                   // 上段尖頂，收到 3 格寬
      const hk = Math.round(hl0 + (1 - hl0) * k / (h2 - 1));
      v.box(0, yU + k, 0, 2 * hk + 1, 1, 2 * hk + 1, 7);
    }
    v.box(0, yU + h2, 0, 1, dim(s, 0.45, 3), 1, 5);                 // 頂端金色細尖
  } },
{ n: '泰姬瑪哈陵', lo: 1.5, hi: 7.2,
  // v1.285.0 整座重畫（見 開發筆記〈還很粗糙的七座重畫〉）
  // 泰姬瑪哈陵（整座重畫）
  // 正面（−z）：紅砂岩平台上一座寬而矮的白色大理石台基，正中一座切角方殿，
  //   殿身正中一個比兩側高的長方形框（pishtaq）、框裡一道深凹的尖拱（iwan），兩側與斜切角各上下兩層小拱龕；
  //   殿頂鼓座上一顆先鼓出再收尖的洋蔥圓頂＋金色尖飾，四周四座小圓頂涼亭；台基四角四根細高的宣禮塔。
  // 側面：跟正面一樣（四面對稱）。全高（含尖飾）約台基寬的 0.77，宣禮塔頂齊圓頂下半、比 pishtaq 高一截。
  // 三樣識別物：白色洋蔥大圓頂＋金色尖飾、台基四角四根三段（兩圈陽台＋頂上小涼亭）的宣禮塔、
  //   pishtaq 框＋黑色書法帶裡深凹的尖拱門
  // 部件：紅砂岩平台 大理石台基（盲拱廊、壓頂線、正面嵌入的台階） 主殿八邊形殼（勒腳線、簷口線）
  //   四面 pishtaq（倒 U 書法帶、頂上壓頂） 伊萬尖拱（側壁、拱頂內面、門＋門楣＋上層格窗） 兩側上下兩層小拱龕
  //   切角面上下兩層小拱龕 屋頂與女兒牆 小尖塔 guldasta（pishtaq 兩角＋八個轉角） 鼓座（盲拱、頂線）
  //   洋蔥圓頂（雜湊深淺） 金色尖飾（直桿＋新月） 四座屋頂涼亭（底座、四柱、出簷、小洋蔥頂、金頂）
  //   四根宣禮塔（八角座、三段塔身、兩圈陽台、頂層陽台、涼亭四柱、出簷、小圓頂、金頂）
  /* 尺寸照實物換算，s 大約是「每 10 m 幾格」：台基 95 m、高 7 m；主殿 57 m 見方、切角 9 m、
     牆高 26 m、pishtaq 33 m（寬 21 m）；圓頂最寬半徑約 12 m（取 13）、高約 25 m（取 27.5）、鼓座比圓頂細兩成；
     尖飾 9.6 m；宣禮塔 40 m、直徑 6.2 m。圓頂放大一成是為了 3000 那檔：照實物的話圓頂只從 pishtaq 後面冒出
     一個尖，跟涼亭、小尖塔疊成一座階梯金字塔，看不出是洋蔥頂（全高因此約 80 m，實物 73 m）。
     佔地刻意只到台基＋四座塔：e2e〈整地推土機〉拿這一座 1200 塊當工地（半徑要 ≤ 16）。 */
  pal: [0xd9d0c0,   // 0 大理石本色（偏暖的白）
        0xbdb19d,   // 1 大理石暗一階：雜湊撒的深淺、勒腳線、簷口、壓頂、陽台、出簷
        0x8e8576,   // 2 陰影灰：拱龕裡面、伊萬側壁、台基盲拱
        0x2b2a2f,   // 3 深色鑲嵌：書法帶、伊萬深處的門與格窗
        0xcfa23e,   // 4 金色尖飾
        0x9b4a38,   // 5 紅砂岩平台
        0xe6e0d4],  // 6 圓頂亮面大理石（全座最亮的是圓頂）
  gen(v, s) {
    const H = (x, y, z) => (((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) >>> 0) % 100;
    const mar = (x, y, z) => (H(x, y, z) < 30 ? 1 : 0);       // 大理石：三成暗一階，遠看才不是一片白
    /* 四心尖拱：半跨 a，兩個圓心各往內 0.4a、半徑 1.4a。drop 是離中線 d 的那一欄比拱心矮多少，
       inArch 判斷 (d, ly) 落不落在「總高 hn、底在 ly = 0」的拱形開口裡。 */
    const drop = (d, a) => 1.34 * a - Math.sqrt(Math.max(0, 1.96 * a * a - (Math.abs(d) + 0.4 * a) ** 2));
    const inArch = (d, ly, a, hn) => Math.abs(d) < a && ly >= 0 && ly < hn - drop(d, a);

    // ── 尺寸 ─────────────────────────────────────────────
    const P = dim(s, 9.5, 13, true), hP = (P - 1) / 2;      // 大理石台基 95 m 見方
    const PH = dim(s, 0.7, 2);                              // 台基高 7 m
    const RB = dim(s, 0.3, 1);                              // 紅砂岩平台露在台基外的寬（真的平台大得多，只露一圈）
    const TW = dim(s, 5.7, 9, true), hT = (TW - 1) / 2;     // 主殿 57 m
    const C = dim(s, 0.9, 2);                               // 四角斜切 9 m
    const K = 2 * hT - C;                                   // |x|+|z| ≤ K 就是切掉角的正方形
    const TH = dim(s, 2.6, 5);                              // 主殿牆高 26 m（到屋頂）
    const PQ = Math.max(TH + 1, dim(s, 3.3, 6));            // pishtaq 33 m，一定比兩側高
    const PW = dim(s, 2.1, 5, true), ph = (PW - 1) / 2;     // pishtaq 寬 21 m
    /* 書法帶是一個倒 U 字框住拱口。小尺寸只畫上面一橫的話，正面看是拱門上方一條黑縫（像一扇窗，第一版踩過），
       所以一律畫成倒 U：pishtaq 窄的時候就貼著 pishtaq 外緣畫（mg = 0），拱口寬度從框往內留一格白反推。
       真的拱口約佔 pishtaq 寬的六成，9000 那檔對得上；小尺寸拱口窄一點，換框看得出來。 */
    const mg = ph >= 7 ? 1 : 0;                             // 書法帶離 pishtaq 外緣幾格
    const IW = Math.max(1, 2 * (ph - mg - 2) + 1), ia = IW / 2;     // 伊萬拱口寬
    const topBand = PQ - 2;                                 // 書法帶上橫那一層（再上面一層是壓頂）
    const apexH = Math.min(TH - 1, topBand - 1, dim(s, 2.45, 3));   // 伊萬拱心高（離書法帶至少一格）
    const D = dim(s, 0.55, 1);                              // 伊萬凹進去幾格
    /* 小尺寸（3000 以下，s < 4）另外一套：圓頂相對放大、鼓座收細、腰部幾層等寬，省掉 pishtaq 與轉角的小尖塔，
       宣禮塔改成十字斷面的細柱。格子少的時候照實物比例，圓頂是一座階梯尖錐、塔是一疊盤子（看過四視圖才改的）。
       門檻 4 落在 3000（s≈2.9）與 9000（s≈5.3）之間，9000 那檔一格都不受影響。 */
    const sm = s < 4;
    const yT = PH + 1;                                      // 主殿底層
    const yRoof = yT + TH - 1, yR = yT + TH;                // 屋頂那一層、屋頂上第一層

    // ── 1. 紅砂岩平台：台基外一圈＋台基牆腳底下（台基是空心的，裡面不鋪），四角跟著斜切（佔地半徑不比台基角大） ──
    for (let x = -hP - RB; x <= hP + RB; x++) for (let z = -hP - RB; z <= hP + RB; z++)
      if (Math.max(Math.abs(x), Math.abs(z)) >= hP && Math.abs(x) + Math.abs(z) <= 2 * hP) v.set(x, 0, z, 5);

    // ── 2. 大理石台基：中空的四面牆＋頂面；主殿正下方被殿身蓋住，不鋪 ──
    const inO = (x, z) => Math.abs(x) <= hT && Math.abs(z) <= hT && Math.abs(x) + Math.abs(z) <= K;
    const hide = D + 2;                                     // 伊萬地板要留著，往內縮幾格才開始省
    /* 宣禮塔塔身半徑分三檔，不跟著 s 連續長：r + 0.35 落在 1.0～1.41 是十字形（5 格）、2.0～2.24 是
       「3×3 加四個尖」，塔身與陽台一疊就是一串十字，看起來刺刺的（第二版踩過）。
       所以只用十字（最小那檔）、3×3、5 寬圓三種塔身，陽台一律比塔身大一圈圓。 */
    const rm = sm ? 0.75 : s < 6.2 ? 1.1 : 1.95;            // 真的直徑 6.2 m：9000 是 3 格寬；小尺寸用十字斷面才細
    const rBal = rm + 0.85, rPed = rBal;                    // 陽台、八角座（台基角上那一塊不開盲拱）
    const cornerU = hP - Math.floor(rPed + 0.35) * 2 - 1;
    const SW = dim(s, 0.6, 3, true), sw = (SW - 1) / 2;     // 正面嵌進台基的台階寬
    const pa = Math.max(2, Math.round(s * 0.7));            // 台基盲拱的間距
    for (let y = 1; y <= PH; y++)
      for (let x = -hP; x <= hP; x++) for (let z = -hP; z <= hP; z++) {
        const ax = Math.abs(x), az = Math.abs(z), edge = ax === hP || az === hP;
        if (!edge && y < PH) { z = hP - 1; continue; }      // 中間只有頂面那一層：直接跳到這一排的尾巴
        if (!edge && ax <= hT - hide && az <= hT - hide && ax + az <= K - hide) continue;
        // 台基頂面是大片地坪：暗一階只撒一成五（三成的話俯視是一片椒鹽）
        let c = y === PH ? (edge ? 1 : H(x, y, z) < 15 ? 1 : 0) : mar(x, y, z);
        if (edge && y < PH) {
          // 盲拱廊：沿著台基四面一排淺色凹龕（角上宣禮塔那一段、正面台階那一段不開）
          const u = az === hP ? x : z, au = Math.abs(u);
          const m = ((u + 1000 * pa) % pa + pa) % pa;
          const top = PH >= 3 && y === PH - 1;                 // 高的台基：最上一排只留拱心，拱頂才是尖的
          if (au <= cornerU && !(z === -hP && au <= sw + 1) && m !== 0 &&
              (!top || (pa >= 4 && m !== 1 && m !== pa - 1))) c = 2;
        }
        v.set(x, y, z, c);
      }
    // 正面台階：嵌進台基正面，從平台一階一階爬到台基頂
    v.carve(0, 1, -hP + (PH - 1) / 2, SW, PH, PH);
    stairs(v, 0, 1, -hP, PH, SW, 'z', 1);
    mirrorX(v, sw + 1, (vv, dx) => vv.box(dx, 1, -hP + (PH - 1) / 2, 1, PH, PH, 1));

    // ── 3. 主殿：切角正方形的殼，一層一層蓋、一邊蓋一邊挑色 ──
    /* 外殼取「八鄰居有一格在外面」：斜切那一面是階梯形，只取四鄰居的話相鄰兩格只有角碰角，
       看得穿到殿裡面。這樣斜面是兩格厚的階梯，從哪個角度看都密。 */
    const ring = [];
    for (let x = -hT; x <= hT; x++) for (let z = -hT; z <= hT; z++) {
      if (!inO(x, z)) continue;
      let edge = false;
      for (let i = -1; i <= 1 && !edge; i++) for (let k = -1; k <= 1; k++) if (!inO(x + i, z + k)) { edge = true; break; }
      if (!edge) continue;
      const ax = Math.abs(x), az = Math.abs(z);
      const u = az === hT && ax <= hT - C ? x : ax === hT && az <= hT - C ? z : null;   // 主立面上的橫向座標
      const nx = u === null ? 0 : az === hT ? 0 : -Math.sign(x), nz = u === null ? 0 : az === hT ? -Math.sign(z) : 0;
      ring.push([x, z, u, (ax - az) / 2, ax + az, nx, nz]);
    }
    // 兩側開間與切角面：上下兩層小尖拱龕（下層高一點）
    const bw = hT - C - ph, ucB = ph + (bw + 1) / 2;
    const aB = bw >= 3 ? (bw - 1) / 2 : 0.6, aD = C >= 3 ? C / 2 - 0.5 : 0.5;
    const avail = TH - 3, hl = Math.max(1, Math.round(avail * 0.55)), hu = avail - hl;
    const niche = (d, ly, a) => inArch(d, ly - 1, a, hl) || (hu > 0 && inArch(d, ly - hl - 2, a, hu));
    const band = (u, ly) => {
      const au = Math.abs(u), b = ph - mg;
      return (ly === topBand && au <= b) || (au === b && ly >= 1 && ly < topBand);
    };
    const backs = [], seals = [];
    for (let ly = 0; ly < TH; ly++) {
      const y = yT + ly;
      for (const [x, z, u, t, sm, nx, nz] of ring) {
        let c = ly === 0 || ly === TH - 1 ? 1 : mar(x, y, z);       // 勒腳線、簷口線
        if (u !== null) {
          const au = Math.abs(u);
          if (au <= ph && inArch(u, ly, ia, apexH)) continue;         // 伊萬拱口，凹進去的部分後面補
          if (au > ph && niche(au - ucB, ly, aB)) { backs.push([x, y, z, nx, nz]); continue; }
          if (au <= ph && band(u, ly)) c = 3;
        } else if (niche(t, ly, aD)) {                                 // 切角面的拱龕：外面那排挖掉、裡面那排當龕底
          if (sm === K) continue;
          c = 2;
          seals.push([x, y, z]);
        }
        v.set(x, y, z, c);
      }
    }
    for (let x = -hT + 1; x < hT; x++) for (let z = -hT + 1; z < hT; z++)    // 屋頂
      if (inO(x, z) && !v.has(x, yRoof, z)) v.set(x, yRoof, z, mar(x, yRoof, z));
    // 小拱龕的龕底：往殿內退一格，連上下左右一起補（斜著看才不會從縫裡看到殿裡面）
    for (const [x, y, z, nx, nz] of backs)
      for (let j = -1; j <= 1; j++) for (let dy = -1; dy <= 1; dy++) {
        const bx = x + nx + (nz !== 0 ? j : 0), bz = z + nz + (nx !== 0 ? j : 0);
        if (!v.has(bx, y + dy, bz)) v.set(bx, y + dy, bz, 2);
      }
    for (const [x, y, z] of seals) {
      const sx = Math.sign(x), sz = Math.sign(z);
      if (!v.has(x - sx, y, z)) v.set(x - sx, y, z, 2);
      if (!v.has(x, y, z - sz)) v.set(x, y, z - sz, 2);
    }

    // ── 4. 四面 pishtaq 與伊萬 ──
    const faceXZ = (f, u, k) => f === 0 ? [u, -hT + k] : f === 1 ? [hT - k, u] : f === 2 ? [-u, hT - k] : [-hT + k, -u];
    const doorH = Math.max(1, Math.round(apexH * 0.4)), doorW = Math.max(0, (IW - 1) / 2 - 1);
    const backC = (u, ly) => {
      if (ia < 2) return 3;                                                // 窄的拱口整片深色，才看得出是開口
      if (ly < doorH) return Math.abs(u) <= doorW ? 3 : 2;                  // 下層：門
      if (ly === doorH) return 2;                                          // 門楣
      if (inArch(u, ly - doorH - 1, ia - 1, apexH - doorH - 2))            // 上層：格窗（大的才排格子）
        return ia >= 3 && ((u + ly) & 1) ? 2 : 3;
      return 2;                                                            // 半穹頂內面
    };
    // 伊萬的形狀四面都一樣，先算一次：1 是拱口裡、2 是貼著拱口的一圈（側壁與拱頂內面）
    const iwan = [];
    for (let u = -ph; u <= ph; u++) for (let ly = 0; ly < TH - 1; ly++) {
      if (inArch(u, ly, ia, apexH)) { iwan.push([u, ly, 1]); continue; }
      let near = false;
      for (let du = -1; du <= 1 && !near; du++) for (let dl = -1; dl <= 1; dl++) if (inArch(u + du, ly + dl, ia, apexH)) { near = true; break; }
      if (near) iwan.push([u, ly, 2]);
    }
    for (let f = 0; f < 4; f++) {
      // pishtaq 冒出屋頂那一截：兩格厚，頂上一層壓頂
      for (let u = -ph; u <= ph; u++) for (let ly = TH; ly < PQ; ly++) for (let k = 0; k <= 1; k++) {
        const [x, z] = faceXZ(f, u, k), y = yT + ly;
        v.set(x, y, z, ly === PQ - 1 ? 1 : k === 0 && band(u, ly) ? 3 : mar(x, y, z));
      }
      // 伊萬：拱口往裡退 D 格，側壁與拱頂內面是陰影灰，最裡面是門＋格窗
      for (const [u, ly, m] of iwan)
        for (let k = 1; k <= D; k++) {
          const [x, z] = faceXZ(f, u, k);
          if (k < D && m === 2) v.set(x, yT + ly, z, 2);
          if (k === D) v.set(x, yT + ly, z, m === 1 ? backC(u, ly) : 2);
        }
    }

    // ── 5. 屋頂女兒牆與小尖塔 guldasta ──
    for (const [x, z] of ring) if (!v.has(x, yR, z)) v.set(x, yR, z, 1);
    const gH = dim(s, 0.35, 1);
    if (!sm) {                                                           // 小尺寸不做：一格一根，只會把天際線弄雜、擋住圓頂
      for (let f = 0; f < 4; f++) for (const u of [-ph, ph]) {           // pishtaq 兩角冒出頂的細柱
        const [x, z] = faceXZ(f, u, 0);
        v.box(x, yT + PQ, z, 1, gH, 1, 1);
        v.set(x, yT + PQ + gH, z, 6);
      }
      corners4(v, hT - C, hT, (vv, x, z) => { vv.box(x, yR + 1, z, 1, gH, 1, 1); vv.set(x, yR + 1 + gH, z, 6); });
      corners4(v, hT, hT - C, (vv, x, z) => { vv.box(x, yR + 1, z, 1, gH, 1, 1); vv.set(x, yR + 1 + gH, z, 6); });
    }

    // ── 6. 鼓座：一圈中空圓柱，比 pishtaq 頂高出一截；一圈盲拱、頂上一圈線腳 ──
    const BR = s * (sm ? 1.5 : 1.3);                        // 圓頂最寬的半徑（真的約 12 m，放大一成；小尺寸放大兩成半，見檔頭）
    const DR = Math.max(1.6, BR * (sm ? 0.58 : 0.78));      // 鼓座比圓頂細一圈：圓頂往外鼓出去，才是洋蔥（小的要細兩格才看得出）
    const DH = (PQ - TH) + dim(s, 0.25, 1) + (sm ? 1 : 0);  // 小尺寸多露一層細鼓座，正面才看得到「頸子細、上面鼓出去」
    const nA = Math.max(8, Math.round(DR * 2.4) * 2);
    for (let j = 0; j < DH; j++) {
      const y = yR + j, n = Math.ceil(DR + 0.5);
      for (let x = -n; x <= n; x++) for (let z = -n; z <= n; z++) {
        const d = Math.hypot(x, z);
        if (d > DR + 0.35 || d < DR - 1.2) continue;
        let c = j === DH - 1 ? 1 : mar(x, y, z);
        if (DH >= 4 && j >= 1 && j < DH - 1) {
          const q = ((Math.atan2(z, x) / (Math.PI * 2) + 1) * nA) % 1;
          if (Math.abs(q - 0.5) < (j === DH - 2 ? 0.12 : 0.26)) c = 2;
        }
        v.set(x, y, z, c);
      }
    }

    /* ── 7. 洋蔥圓頂：剖面先鼓出（最寬在 3 成高）、上半段照圓球收，到最上面一成才收成尖；
       一層一層的殼，內徑取上下兩層較小的那個，殼才接得起來（舊版用 onion 的 0.6 殼，坑坑疤疤就是這樣來的） ── */
    /* 小尺寸的剖面：底口收得更細、最寬那段拉長（3000 那檔腰部四層等寬），收尖留到最後三層——
       照大尺寸那條收的話 8 層裡只有兩層是最寬的，看起來是尖錐不是球。 */
    const PROF = sm
      ? [[0.6, 0], [0.86, 0.1], [1, 0.24], [1, 0.46], [0.92, 0.6], [0.74, 0.72], [0.5, 0.82], [0.26, 0.91], [0.05, 1]]
      : [[0.80, 0], [0.94, 0.09], [1, 0.25], [0.98, 0.42], [0.92, 0.56], [0.8, 0.68],
         [0.62, 0.77], [0.43, 0.84], [0.25, 0.91], [0.12, 0.96], [0.04, 1]];
    const rAt = t => {
      let i = 0;
      while (i + 2 < PROF.length && t > PROF[i + 1][1]) i++;
      const a = PROF[i], b = PROF[i + 1];
      return a[0] + (b[0] - a[0]) * Math.min(1, Math.max(0, (t - a[1]) / (b[1] - a[1])));
    };
    const bulb = (x0, y0, z0, R, BH, cf) => {
      for (let j = 0; j < BH; j++) {
        const T = j2 => R * rAt(BH > 1 ? j2 / (BH - 1) : 0);
        const r = T(j), ri = Math.min(r, j > 0 ? T(j - 1) : r, j < BH - 1 ? T(j + 1) : 0) - 1.1;
        const n = Math.ceil(r + 0.35);
        for (let x = -n; x <= n; x++) for (let z = -n; z <= n; z++) {
          const d = Math.hypot(x, z);
          if (d > r + 0.35 || d < ri) continue;
          v.set(x0 + x, y0 + j, z0 + z, cf(x0 + x, y0 + j, z0 + z));
        }
      }
    };
    const BH = dim(s, 2.75, 4), yB = yR + DH;
    bulb(0, yB, 0, BR, BH, (x, y, z) => (H(x, y, z) < 22 ? 0 : 6));
    /* 金色尖飾：一根直桿，大的才有頂上往上翹的新月（正面看是一個 Y）。真的桿上有幾顆寶珠，
       但一格粗的桿子上任何一圈加寬，正面看都是「十」字或劍柄，整座變成教堂（前三版都踩過），所以不做。 */
    const FH = dim(s, 0.95, 2), yF = yB + BH;
    v.box(0, yF, 0, 1, FH, 1, 4);
    if (FH >= 5) {                                           // 新月：碗＋往上翹的兩個尖
      const yc = yF + FH - 1;
      v.del(0, yc, 0); v.set(-1, yc - 1, 0, 4); v.set(1, yc - 1, 0, 4); v.set(-1, yc, 0, 4); v.set(1, yc, 0, 4);
    }

    // ── 8. 屋頂四座涼亭 chattri：底座、柱、出簷、小圓頂、金頂 ──
    /* 涼亭頂（金頂）齊大圓頂的下三成：真的約高 14 m，比這個高的話跟小尖塔、圓頂疊成一座階梯金字塔 */
    const cc = Math.round(s * 1.8), rc = Math.max(1, s * 0.42), cpH = dim(s, 0.35, 1);
    corners4(v, cc, cc, (vv, cx, cz) => {
      vv.cyl(cx, yR, cz, rc, 1, 1);
      // 四根柱子之間留空：真的是八根細柱，但格子上八根挨在一起就是一圈實牆，看不出是涼亭
      const pp = Math.max(1, Math.round(rc * 0.55));
      corners4(vv, pp, pp, (w, px, pz) => w.box(cx + px, yR + 1, cz + pz, 1, cpH, 1, 0));
      vv.cyl(cx, yR + 1 + cpH, cz, rc + (rc >= 2 ? 0.5 : 0), 1, 1);
      const cbH = dim(s, 0.75, 2);
      bulb(cx, yR + 2 + cpH, cz, rc * 1.05, cbH, () => 6);
      vv.set(cx, yR + 2 + cpH + cbH, cz, 4);
    });

    // ── 9. 宣禮塔：八角座、三段塔身（兩圈陽台）、頂層陽台、涼亭（柱、出簷、小圓頂、金頂） ──
    /* 3000 那檔整根塔只有 12 格高：八角座、三圈陽台、出簷全做成比塔身寬的盤子，就是一疊碟子（第二版踩過），
       所以小的時候八角座跟塔身一樣粗（只換深一階的色）、頂上不做出簷，比塔身寬的只剩三圈陽台。 */
    const mo = hP - Math.floor(rPed + 0.35);
    const MH = dim(s, 4.0, 8);
    const pedH = dim(s, 0.2, 1);
    const mpH = s >= 3 ? dim(s, 0.3, 1) : 0, mEave = s >= 4 ? 1 : 0, mdH = dim(s, 0.3, 1), mfH = 1;
    const b3 = MH - (mpH + mEave + mdH + mfH) - 1;
    const b1 = Math.max(pedH + 1, Math.round(pedH + (b3 - pedH) * 0.34)), b2 = Math.max(b1 + 2, Math.round(pedH + (b3 - pedH) * 0.67));
    corners4(v, mo, mo, (vv, mx, mz) => {
      const y0 = yT;
      vv.cyl(mx, y0, mz, s >= 4 ? rPed : rm, pedH, 1);                       // 八角座
      for (let j = pedH; j < b3; j++) {                                      // 塔身（收分在格子上看不出來，不收）
        const n = Math.ceil(rm + 0.35), y = y0 + j;
        for (let x = -n; x <= n; x++) for (let z = -n; z <= n; z++)
          if (Math.hypot(x, z) <= rm + 0.35) vv.set(mx + x, y, mz + z, mar(mx + x, y, mz + z));
      }
      // 兩圈陽台＋頂層陽台：只有一層薄薄的一圈（下面再墊托架就變成一串線軸，第二版踩過）
      for (const b of [b1, b2, b3]) vv.cyl(mx, y0 + b, mz, rBal, 1, 1);
      let y = y0 + b3 + 1;
      if (mpH) {                                                             // 頂上涼亭：四根柱、出簷、小圓頂
        corners4(vv, 1, 1, (w, px, pz) => w.box(mx + px, y, mz + pz, 1, mpH, 1, 0));
        y += mpH;
      }
      if (mEave) { vv.cyl(mx, y, mz, rBal, 1, 1); y += 1; }
      bulb(mx, y, mz, Math.max(sm ? 1.3 : 0.9, rm * 1.05), mdH, () => 6);   // 小尺寸的剖面底口細，半徑要給夠才不會只剩一格
      vv.box(mx, y + mdH, mz, 1, mfH, 1, 4);
    });
  } },

{ n: '萬里長城', lo: 2.5, hi: 15, pal: [0xa39b8c, 0x70695d, 0x4a443b, 0x9e2a2b, 0xd4a373, 0x2b2823],
  /* 來源：blueprints/萬里長城.js（v1.114 換掉原本那份） */
  gen(v, s) {
    // ===== 1. 核心尺度參數計算 =====
    // 中央主敵樓
    const tw = dim(s, 1.3, 7, true);   // 敵樓寬度（x 軸，奇數）
    const td = dim(s, 1.2, 7, true);   // 敵樓深度（z 軸，奇數）
    const f1H = dim(s, 0.85, 4);       // 敵樓一層石基高度
    const f2H = dim(s, 0.75, 3);       // 敵樓二層木石樓閣高度

    // 長城兩側延展段（分為兩段階梯起伏，模擬山脊盤旋）
    const span1W = dim(s, 1.3, 6);     // 第一延展段長度
    const span2W = dim(s, 1.5, 7);     // 第二延展段（爬坡高段）長度
    const wallD = dim(s, 0.65, 3, true);// 馬道寬度（奇數）
    const baseWallH = dim(s, 0.65, 3); // 基礎城牆高

    // 兩端烽火副台（高處瞭望角台）
    const beaconW = dim(s, 0.75, 4, true);
    const beaconD = dim(s, 0.75, 4, true);

    // ===== 2. 地基與山勢基座 =====
    const totalHalfW = (tw - 1) / 2 + span1W + span2W + beaconW;
    v.box(0, 0, 0, totalHalfW * 2 + 3, 1, td + 4, 1);

    // ===== 3. 中央主敵樓（一層磚石墩台與連續拱券） =====
    v.walls(0, 1, 0, tw, f1H, td, 0, 1);
    
    // 正面與背面穿心拱門（前後暢通）
    const gateW = dim(s, 0.35, 3, true);
    const gateH = dim(s, 0.45, 2);
    mirrorZ(v, (td - 1) / 2, (vv, dz) => {
      arch(vv, 0, 1, dz, gateW, gateH, 1, 1);
      vv.box(0, 1, dz > 0 ? dz - 1 : dz + 1, gateW, gateH + 1, 1, 5); // 門洞深色內襯
    });

    // 敵樓正面與背面的多孔箭窗（三孔拱券採光射孔）
    if (tw >= 9) {
      mirrorZ(v, (td - 1) / 2, (vv, dz) => {
        const offX = Math.floor(tw / 3);
        mirrorX(vv, offX, (vvv, dx) => {
          vvv.carve(dx, 2, dz, 1, 2, 1);
          vvv.box(dx, 2, dz, 1, 1, 1, 5);
        });
      });
    }

    // 敵樓腰線平台（出挑飛石）
    const platY = 1 + f1H;
    v.box(0, platY, 0, tw + 2, 1, td + 2, 2);

    // 敵樓一層頂部周圍雉堞（齒狀垛口）
    corners4(v, (tw + 1) / 2, (td + 1) / 2, (vv, cx, cz) => {
      vv.box(cx, platY + 1, cz, 1, 1, 1, 1);
    });
    mirrorX(v, (tw + 1) / 2, (vv, dx) => {
      for (let z = -Math.floor(td / 2); z <= Math.floor(td / 2); z += 2) {
        vv.box(dx, platY + 1, z, 1, 1, 1, 1);
      }
    });
    mirrorZ(v, (td + 1) / 2, (vv, dz) => {
      for (let x = -Math.floor(tw / 2); x <= Math.floor(tw / 2); x += 2) {
        vv.box(x, platY + 1, dz, 1, 1, 1, 1);
      }
    });

    // ===== 4. 中央主敵樓二層（歇山頂樓閣） =====
    const b2W = Math.max(5, tw - 2);
    const b2D = Math.max(5, td - 2);
    const b2Y = platY + 1;
    v.walls(0, b2Y, 0, b2W, f2H, b2D, 0, 1);

    // 二層瞭望方窗
    const winH = Math.max(1, f2H - 2);
    mirrorZ(v, (b2D - 1) / 2, (vv, dz) => {
      vv.carve(0, b2Y + 1, dz, 1, winH, 1);
      vv.box(0, b2Y + 1, dz, 1, winH, 1, 5);
    });
    mirrorX(v, (b2W - 1) / 2, (vv, dx) => {
      vv.carve(dx, b2Y + 1, 0, 1, winH, 1);
      vv.box(dx, b2Y + 1, 0, 1, winH, 1, 5);
    });

    // 二層歇山大屋頂
    const roofY = b2Y + f2H;
    v.eave(0, roofY, 0, b2W + 2, b2D + 2, 2, 1); // 斗拱簷口
    hipRoof(v, 0, roofY + 1, 0, b2W + 4, b2D + 4, 3); // 四坡瓦頂

    // 正脊與金頂
    const rStep = Math.ceil(Math.min(b2W + 4, b2D + 4) / 2);
    const topY = roofY + 1 + rStep;
    const topLen = Math.max(1, (b2W + 4) - rStep * 2);
    v.box(0, topY, 0, topLen, 1, 1, 4);
    if (topLen > 2) {
      mirrorX(v, Math.floor(topLen / 2), (vv, rx) => {
        vv.box(rx, topY + 1, 0, 1, 1, 1, 4);
      });
    }

    // ===== 5. 兩側蜿蜒起伏長城牆身（階梯式爬坡山勢） =====
    mirrorX(v, 1, (vv, sideSign) => {
      // --- 段落一：緩坡出發段 ---
      const s1StartX = (tw - 1) / 2 + 1;
      const s1CenterX = s1StartX + Math.floor(span1W / 2);
      const s1Z = sideSign > 0 ? 0 : -1; // 輕微 Z 軸錯位蜿蜒
      const s1H = baseWallH;

      // 牆身與馬道鋪石
      vv.box(sideSign * s1CenterX, 1, s1Z, span1W, s1H, wallD, 0);
      vv.box(sideSign * s1CenterX, 1 + s1H, s1Z, span1W, 1, wallD, 1);

      // 外側高雉堞（齒狀垛口＋射孔）
      for (let i = 0; i < span1W; i++) {
        const cx = sideSign * (s1StartX + i);
        // 外側垛口（隔一格有一齒）
        if (i % 2 === 0) {
          vv.box(cx, 2 + s1H, s1Z - Math.floor(wallD / 2), 1, 1, 1, 1);
        }
        // 內側宇牆（較矮連續護欄）
        vv.box(cx, 2 + s1H, s1Z + Math.floor(wallD / 2), 1, 1, 1, 1);
      }

      // --- 段落二：高階爬坡段（向上攀升 2~3 格，強化山勢） ---
      const s2StartX = s1StartX + span1W;
      const s2CenterX = s2StartX + Math.floor(span2W / 2);
      const s2Z = sideSign > 0 ? 1 : -2; // 沿山脊進一步彎折
      const climbH = dim(s, 0.35, 2);
      const s2H = baseWallH + climbH;

      // 階梯連接過渡（台階踏步）
      stairs(vv, sideSign * s2StartX, 1 + s1H, s2Z, climbH, wallD, sideSign > 0 ? 'x' : '-x', 1);

      // 段落二牆身與馬道
      vv.box(sideSign * s2CenterX, 1, s2Z, span2W, s2H, wallD, 0);
      vv.box(sideSign * s2CenterX, 1 + s2H, s2Z, span2W, 1, wallD, 1);

      // 段落二雉堞與垛口
      for (let i = 0; i < span2W; i++) {
        const cx = sideSign * (s2StartX + i);
        if (i % 2 === 0) {
          vv.box(cx, 2 + s2H, s2Z - Math.floor(wallD / 2), 1, 1, 1, 1);
        }
        vv.box(cx, 2 + s2H, s2Z + Math.floor(wallD / 2), 1, 1, 1, 1);
      }

      // ===== 6. 兩端高處烽火副台（角台） =====
      const bTowerX = sideSign * (s2StartX + span2W + Math.floor(beaconW / 2));
      const bTowerZ = s2Z;
      const bTowerH = s2H + dim(s, 0.3, 2);

      // 實心石砌烽火墩台
      vv.box(bTowerX, 1, bTowerZ, beaconW, bTowerH, beaconD, 0);
      vv.box(bTowerX, 1 + bTowerH, bTowerZ, beaconW + 2, 1, beaconD + 2, 2); // 出挑頂台

      // 頂台四角垛口
      corners4(vv, Math.floor(beaconW / 2) + 1, Math.floor(beaconD / 2) + 1, (vvv, ocx, ocz) => {
        vvv.box(bTowerX + ocx, 2 + bTowerH, bTowerZ + ocz, 1, 1, 1, 1);
      });

      // 烽火台中央烽燧火堆裝飾
      vv.box(bTowerX, 2 + bTowerH, bTowerZ, 1, 1, 1, 4);
    });

    // ===== 7. 主敵樓正面石階登城梯 =====
    const stepCount = Math.max(2, Math.round(f1H * 0.5));
    stairs(v, 0, 1, (td - 1) / 2 + 1, stepCount, gateW, 'z', 1);
  } },

{ n: '日本姬路城',
  // v1.314.0 整座重畫：盲測第八回的子 agent 只拿〈藍圖製作說明〉、從零做出來的第二版（看過一次報告＋9000 四視圖），
  // 原樣收進來，只改了名字與 pal 的寫法（見 開發筆記〈盲測第八回：倫敦大笨鐘、日本姬路城、大阪城天守閣、莫斯科克里姆林塔（v1.314.0）〉）
  // 【設計表】（第二版）
  // 正面（南，−z）：高石垣上，畫面右邊（東）是外觀五重的大天守，一重一重往上收小；畫面左邊（西）是矮一截的西小天守，
  //   中間用二層的ニ渡櫓接起來；乾小天守在左後方露出上半截。
  // 側面（西，+x）：前面西小天守、後面乾小天守，中間ハ渡櫓；大天守在後方高高聳起，看得到二重東西的大入母屋破風。
  // 三樣識別物：①一重一重收小的五重白壁＋灰瓦出簷（簷口一圈白） ②屋簷上交錯的三角千鳥破風（白三角＋灰框）與弧形唐破風
  //   ③高石垣上四座天守用渡櫓連成一圈（連立式），最頂屋脊兩端的鯱
  // 比例表（實物）：石垣 14.85 m（往上收約 5 m、下緩上陡）、大天守建物 31.5 m；大天守一樓 13×10 間（約 27×21 m）、
  //   三樓 11×8 間、四五樓 9×6 間、六樓 7×5 間（約 13×9 m）；小天守外觀三重（乾最大、東最小）；渡櫓二層。
  //   破風（照資料）：初重東面唐破風；二重南面唐破風＋東西大入母屋破風；三重南北比翼入母屋破風；
  //   四重南北千鳥破風＋東西唐破風；五重南北唐破風、東西入母屋（屋脊沿東西）。
  //   平面（大天守在東南角）：西小天守在西南、乾小天守在西北、東小天守在東北，渡櫓イ（大↔東）ロ（東↔乾）ハ（乾↔西）ニ（西↔大）。
  // 輪廓寬度（正面，以石垣頂寬 ＝ 1）：石垣底 1.2／石垣頂 1.0／一重（大天守＋ニ渡櫓＋西小天守）0.9／
  //   大天守二重 0.55（西小天守上半 0.25，中間分開）／三重 0.45／四重 0.38／五重屋頂 0.38／屋脊 0.33＋兩端鯱
  // 部件尺寸（第一版報告：9000 塊 s ＝ 7.92；這版牆加高、石垣加寬，估 s ≈ 7.5，1 m ≈ 0.75 格）：
  //   石垣高 12、往上收 4 格、大天守一重 21×17 高 5、頂重 11×7、出簷 2、唐破風半徑 max(2.3,0.42s)=3.2（7 格寬、4 層高）、
  //   千鳥破風寬 7、比翼破風每片 7、大入母屋破風寬 9、小天守一重 9～11 格寬、渡櫓寬 5、鯱 2 格高（＋頭尾各 1 格）
  // 部件：石垣(boxTaper 兩段、中空、hash100 雜色) 中庭碎石(box) 各重白壁(walls) 窗(windowGrid)
  //   各重屋簷(boxTaper 中空，最底一圈是白色簷口) 最頂入母屋屋頂(boxTaper 兩段，山花三角塗白)
  //   千鳥／入母屋破風(gable／boxTaper＋白三角) 唐破風(自己算半圓，逐格 set) 鯱(box＋set)
  //   小天守三座(同一支 keep) 渡櫓四條(walls＋boxTaper 兩坡頂)
  pal: [0xe4e2da,   // 0 白漆喰（亮度 0.87）
        0xb8b7b0,   // 1 簷口（白漆喰的陰面，0.71）
        0x787d85,   // 2 灰瓦（0.50）
        0x3c3f44,   // 3 鯱（0.25）
        0x8e877a,   // 4 石垣（0.52）
        0x756f65,   // 5 石垣暗（0.43）
        0xa59f92,   // 6 石垣亮（0.61）
        0x2e2c2a,   // 7 窗（0.17）
        0xb5ad9b],  // 8 中庭碎石（0.66）
  lo: 1.2, hi: 14,

  gen(v, s) {
    const M = (m, lo, odd) => dim(s, m * 0.1, lo, odd);   // 公尺 → 格（1 m ＝ 0.1·s 格）
    const P = m => Math.round(m * s * 0.1);
    const WH = 0, SH = 1, RF = 2, DK = 3, ST = 4, ST2 = 5, ST3 = 6, WIN = 7, GR = 8;
    const odd = n => Math.max(1, n % 2 ? n : n - 1);
    const hx = b => (b.W - 1) / 2, hz = b => (b.D - 1) / 2;

    // 各重尺寸（寬、深取奇數；往上不會比下面大）。牆高比第一版加高，白壁才露得出來
    const tiersOf = L => { let pw = 1e9, pd = 1e9;
      return L.map(([w, d, h, lw, ld], i) => {
        pw = Math.min(pw, M(w, lw, true)); pd = Math.min(pd, M(d, ld, true));
        return { W: pw, D: pd, H: M(h, i === 0 ? 3 : 2) };
      }); };
    const MT = tiersOf([[27, 21, 6.5, 9, 7], [25, 19, 5.5, 9, 7], [20.5, 15, 5, 7, 5], [16.5, 11, 5.5, 5, 5], [13, 8.5, 4.5, 5, 3]]);
    const WT = tiersOf([[13, 11, 6, 5, 5], [11, 9, 5, 5, 3], [9, 7, 4, 3, 3]]);          // 西小天守
    const IT = tiersOf([[14, 12, 6.5, 5, 5], [12, 10, 5.5, 5, 3], [9.5, 8, 4.5, 3, 3]]); // 乾小天守
    const ET = tiersOf([[11, 9, 5.5, 5, 5], [9, 7, 4.5, 3, 3], [7, 5.5, 4, 3, 3]]);      // 東小天守
    const e1 = M(2.4, 1), eT = M(2.6, 1), es = M(2, 1);
    const PB = M(14.85, 4);                       // 石垣高；各天守從 PB 起蓋

    // 平面配置：大天守在原點（東南角），x+ 是西、z+ 是北
    const B = MT[0], Wk = WT[0], Ik = IT[0], Ek = ET[0];
    const gap = M(4, 2), gapH = M(10, 3);
    const WX = hx(B) + gap + 1 + hx(Wk), WZ = -hz(B) + P(1) + hz(Wk);
    const IX = WX, IZ = WZ + hz(Wk) + gapH + 1 + hz(Ik);
    const EX = -hx(B) + P(4) + hx(Ek), EZ = hz(B) + gap + 1 + hz(Ek);
    const mid = (a0, a1, b0, b1) => Math.round((Math.max(a0, b0) + Math.min(a1, b1)) / 2);

    // ── 台基：石垣（往上收約 5 m：下段緩、上段陡）＋頂面碎石 ──
    const mg = M(1, 1), g = M(5, 2), gm = Math.max(1, Math.round(g * 0.3));
    const xa = Math.min(-hx(B), EX - hx(Ek)) - mg, xb = Math.max(hx(B), WX + hx(Wk), IX + hx(Ik)) + mg;
    const za = Math.min(-hz(B), WZ - hz(Wk)) - mg, zb = Math.max(IZ + hz(Ik), EZ + hz(Ek)) + mg;
    const pcx = (xa + xb) / 2, pcz = (za + zb) / 2, pw = xb - xa + 1, pd = zb - za + 1;
    const h1 = Math.max(2, Math.round(PB * 0.55)), h2 = PB - h1 + 1;
    const stone = (x, y, z) => { const q = hash100(x, y, z); return q < 20 ? ST2 : q < 32 ? ST3 : ST; };
    v.box(pcx, PB - 1, pcz, pw, 1, pd, GR);
    boxTaper(v, { x: pcx, y: 0, z: pcz, w: pw + 2 * g, d: pd + 2 * g, w1: pw + 2 * gm, d1: pd + 2 * gm, h: h1, c: stone, t: 1 });
    boxTaper(v, { x: pcx, y: h1 - 1, z: pcz, w: pw + 2 * gm, d: pd + 2 * gm, w1: pw, d1: pd, h: h2, c: stone, t: 1 });
    [[0, 0, B], [WX, WZ, Wk], [IX, IZ, Ik], [EX, EZ, Ek]].forEach(([x, z, b]) =>   // 天守底下看不到，挖掉省塊數
      v.carve(x, PB - 1, z, b.W - 2, 1, b.D - 2));

    // ── 共用：白壁、屋簷、入母屋頂、鯱 ──
    const body = (cx, y, cz, W, D, H) => {
      v.walls(cx, y, cz, W, H, D, WH, 1);
      const wh = Math.max(1, Math.min(2, H - 3));
      mirrorZ(v, (D - 1) / 2, (vv, dz) => windowGrid(vv, { x: cx, y: y + 1, z: cz + dz,
        cols: odd(Math.floor((W - 1) / 3)), stepX: 3, w: 1, h: wh, c: WIN }));
      mirrorX(v, (W - 1) / 2, (vv, dx) => windowGrid(vv, { x: cx + dx, y: y + 1, z: cz,
        cols: odd(Math.floor((D - 1) / 3)), stepX: 3, w: 1, h: wh, c: WIN, axis: 'z' }));
    };
    const eaveC = y0 => (x, y, z) => (y === y0 ? SH : RF);   // 屋簷最底一圈是白漆喰的簷口
    const skirt = (cx, y, cz, W, D, e, W2, D2) => {      // 從牆頂那層往外出簷，收到上一重的牆
      const w0 = W + 2 * e, d0 = D + 2 * e;
      const sm = Math.max(w0 - W2, d0 - D2) / 2;
      const R = Math.max(2, Math.ceil(sm / 2) + 1);
      const t = Math.max(2, e, Math.ceil(sm / (R - 1)));
      boxTaper(v, { x: cx, y, z: cz, w: w0, d: d0, w1: W2, d1: D2, h: R, c: eaveC(y), t });
      return y + R - 1;                                  // 上一重的牆從屋簷頂層起
    };
    const irimoya = (cx, y, cz, W, D, e, alongX) => {   // 最頂：下段四坡＋上段兩坡（山花三角塗白）
      const w0 = W + 2 * e, d0 = D + 2 * e;
      boxTaper(v, { x: cx, y, z: cz, w: w0, d: d0, w1: w0 - 2, d1: d0 - 2, h: 2, c: eaveC(y), t: Math.max(2, e) });
      const wu = w0 - 2, du = d0 - 2, yg = y + 1, span = alongX ? du : wu, h = (span + 1) / 2;
      const ex = (wu - 1) / 2, ez = (du - 1) / 2;
      const col = (x, yy, z) => {
        const half = (Math.round(span + (1 - span) * (yy - yg) / (h - 1)) - 1) / 2;
        return alongX ? (Math.abs(x - cx) === ex && Math.abs(z - cz) < half ? WH : RF)
                      : (Math.abs(z - cz) === ez && Math.abs(x - cx) < half ? WH : RF);
      };
      boxTaper(v, alongX ? { x: cx, y: yg, z: cz, w: wu, d: du, w1: wu, d1: 1, h, c: col, t: 2 }
                         : { x: cx, y: yg, z: cz, w: wu, d: du, w1: 1, d1: du, h, c: col, t: 2 });
      const yr = yg + h - 1, sh = M(3, 2);
      const shachi = (x, z, ox, oz) => {                 // (ox, oz) 指向屋脊外
        v.box(x, yr + 1, z, 1, sh, 1, DK);
        v.set(x - ox, yr + 1, z - oz, DK);               // 頭朝內
        v.set(x + ox, yr + sh, z + oz, DK);              // 尾巴往外翹
      };
      if (alongX) { shachi(cx + ex, cz, 1, 0); shachi(cx - ex, cz, -1, 0); }
      else { shachi(cx, cz + ez, 0, 1); shachi(cx, cz - ez, 0, -1); }
    };
    const keep = (cx, cz, T, e, eT2, alongX) => {        // 一座天守：牆→屋簷→上一重…→入母屋頂
      let y = PB; const K = [];
      T.forEach((b, i) => {
        body(cx, y, cz, b.W, b.D, b.H);
        const ys = y + b.H - 1, nb = T[i + 1];
        if (nb) { K.push({ ys, W: b.W, D: b.D, e, nW: nb.W, nD: nb.D }); y = skirt(cx, ys, cz, b.W, b.D, e, nb.W, nb.D); }
        else { K.push({ ys, W: b.W, D: b.D, e: eT2, nW: b.W, nD: b.D }); irimoya(cx, ys, cz, b.W, b.D, eT2, alongX); }
      });
      return K;
    };

    // ── 破風：直接畫在那一面（不包 stampY，省產生時間） ──
    const at = (cx, cz, q, dir, inset, off) => {         // 那一重屋簷、那一面外緣的中點
      const isZ = dir === 'S' || dir === 'N', sg = (dir === 'S' || dir === 'E') ? -1 : 1;
      const half = (isZ ? (q.D - 1) / 2 : (q.W - 1) / 2) + q.e - inset;
      const dist = q.e + (isZ ? q.D - q.nD : q.W - q.nW) / 2;
      return isZ ? { x: cx + off, z: cz + sg * half, dist } : { x: cx + sg * half, z: cz + off, dist };
    };
    const hafu = (cx, cz, q, dir, w, off = 0) => {       // 千鳥／入母屋破風：灰框白三角，往屋內長 d 格
      const a = at(cx, cz, q, dir, 1, off), d = Math.max(3, a.dist | 1), y = q.ys + 1;
      if (dir === 'S' || dir === 'N') {
        const k = dir === 'S' ? 1 : -1;
        v.gable(a.x, y, a.z + k * (d - 1) / 2, w, d, RF);
        if (w >= 5) v.gable(a.x, y, a.z, w - 2, 1, WH);
      } else {
        const k = dir === 'E' ? 1 : -1;
        boxTaper(v, { x: a.x + k * (d - 1) / 2, y, z: a.z, w: d, d: w, w1: d, d1: 1, h: (w + 1) / 2, c: RF });
        if (w >= 5) boxTaper(v, { x: a.x, y, z: a.z, w: 1, d: w - 2, w1: 1, d1: 1, h: (w - 1) / 2, c: WH });
      }
    };
    const kara = (cx, cz, q, dir, r) => {                // 唐破風：簷口正中往上拱的半圓（灰框、白面）
      const a = at(cx, cz, q, dir, 0, 0), len = Math.max(3, q.e + 1) | 1, n = Math.ceil(r);
      const put = (i, j, k, c) => {                      // i 沿那一面橫向、j 往上、k 往屋內
        if (dir === 'S') v.set(a.x + i, q.ys + j, a.z + k, c);
        else if (dir === 'N') v.set(a.x - i, q.ys + j, a.z - k, c);
        else if (dir === 'E') v.set(a.x + k, q.ys + j, a.z - i, c);
        else v.set(a.x - k, q.ys + j, a.z + i, c);
      };
      for (let i = -n; i <= n; i++) for (let j = 0; j <= n; j++) {
        const q2 = Math.hypot(i, j);
        if (q2 > r + 0.35) continue;
        for (let k = 0; k < len; k++) put(i, j, k, k === 0 && q2 <= r - 0.65 ? WH : RF);
      }
    };

    // ── 渡櫓（二層、兩坡頂），先畫，天守蓋在上面 ──
    const WD = M(7, 3, true), WHt = M(6.5, 3);
    const watari = (x0, x1, z0, z1, alongX) => {
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0 + 1, d = z1 - z0 + 1, top = PB + WHt - 1;
      v.walls(cx, PB, cz, w, WHt, d, WH, 1);
      if (alongX) mirrorZ(v, (d - 1) / 2, (vv, dz) => windowGrid(vv, { x: cx, y: PB + 1, z: cz + dz,
        cols: odd(Math.floor((w - 1) / 3)), stepX: 3, c: WIN }));
      else mirrorX(v, (w - 1) / 2, (vv, dx) => windowGrid(vv, { x: cx + dx, y: PB + 1, z: cz,
        cols: odd(Math.floor((d - 1) / 3)), stepX: 3, c: WIN, axis: 'z' }));
      boxTaper(v, alongX ? { x: cx, y: top, z: cz, w: w + 2, d: d + 2, w1: w + 2, d1: 1, h: (d + 3) / 2, c: eaveC(top), t: 2 }
                         : { x: cx, y: top, z: cz, w: w + 2, d: d + 2, w1: 1, d1: d + 2, h: (w + 3) / 2, c: eaveC(top), t: 2 });
    };
    const hw = (WD - 1) / 2;
    let m = mid(-hz(B), hz(B), WZ - hz(Wk), WZ + hz(Wk));
    watari(hx(B), WX - hx(Wk), m - hw, m + hw, true);                       // ニ：大天守 ↔ 西小天守
    m = mid(WX - hx(Wk), WX + hx(Wk), IX - hx(Ik), IX + hx(Ik));
    watari(m - hw, m + hw, WZ + hz(Wk), IZ - hz(Ik), false);                // ハ：西小天守 ↔ 乾小天守
    m = mid(EZ - hz(Ek), EZ + hz(Ek), IZ - hz(Ik), IZ + hz(Ik));
    watari(EX + hx(Ek), IX - hx(Ik), m - hw, m + hw, true);                 // ロ：東小天守 ↔ 乾小天守
    m = mid(-hx(B), hx(B), EX - hx(Ek), EX + hx(Ek));
    watari(m - hw, m + hw, hz(B), EZ - hz(Ek), false);                      // イ：大天守 ↔ 東小天守

    // ── 大天守（屋脊沿東西）＋破風 ──
    const MK = keep(0, 0, MT, e1, eT, true);
    const kr = Math.max(2.3, s * 0.42), kr2 = Math.max(2.3, s * 0.3);
    kara(0, 0, MK[0], 'E', kr);                                            // 初重：東唐破風
    kara(0, 0, MK[1], 'S', kr);                                            // 二重：南唐破風
    const bw = Math.min(M(12.5, 5, true), MK[1].nD);
    hafu(0, 0, MK[1], 'E', bw); hafu(0, 0, MK[1], 'W', bw);                // 二重：東西大入母屋破風
    const tw = M(8, 3, true);
    for (const dir of ['S', 'N']) for (const sg of [-1, 1])
      hafu(0, 0, MK[2], dir, tw, sg * (tw + 1) / 2);                       // 三重：南北比翼入母屋破風
    const cw = M(9, 3, true);
    hafu(0, 0, MK[3], 'S', cw); hafu(0, 0, MK[3], 'N', cw);                // 四重：南北千鳥破風
    kara(0, 0, MK[3], 'E', kr); kara(0, 0, MK[3], 'W', kr);                // 四重：東西唐破風
    kara(0, 0, MK[4], 'S', kr); kara(0, 0, MK[4], 'N', kr);                // 五重：南北唐破風

    // ── 三座小天守 ──
    const sw = M(6, 3, true);
    const WKq = keep(WX, WZ, WT, es, es, false);                           // 西小天守（山花朝南）
    hafu(WX, WZ, WKq[0], 'S', sw); kara(WX, WZ, WKq[0], 'W', kr2); kara(WX, WZ, WKq[1], 'S', kr2);
    const IKq = keep(IX, IZ, IT, es, es, true);                            // 乾小天守（最大）
    kara(IX, IZ, IKq[0], 'W', kr2); hafu(IX, IZ, IKq[1], 'W', sw); hafu(IX, IZ, IKq[1], 'S', sw);
    const EKq = keep(EX, EZ, ET, es, es, false);                           // 東小天守（最小）
    hafu(EX, EZ, EKq[0], 'S', sw);
  } },

{ n: '京都五重塔',
  // v1.313.0 整座重畫：盲測第七回的子 agent 只拿〈藍圖製作說明〉、從零做出來的第二版（看過一次報告＋9000 四視圖），
  // 原樣收進來，只改了名字與 pal 的寫法（見 開發筆記〈盲測第七回：金閣寺、銀閣寺、箱館奉行所、京都五重塔（v1.313.0）〉）
  // 正面：石造基壇上疊五層方形深出簷，簷寬由下往上每層每邊收 1 格（頂層約初層的 0.72），塔身比簷窄一半，頂上一根細長的黑色相輪
  // 側面：方形平面、四面相同（四面都有門、都有台階），跟正面一樣
  // 三樣識別物：五層深灰瓦的深出簷（屋角微微上翹）、頂上九個圈的金屬相輪、白牆配深色木柱與初層的板門
  // 比例表（實物）：全高 54.8 m（木造塔日本最高，1644 年再建）；平面方三間
  //   以下為一般認識的估值：基壇高約 1.2 m、寬約 15.6 m；初層塔身一邊約 9.5 m、五層約 7.1 m；
  //   初層簷寬約 19 m；基壇上到頂層屋頂約 41 m；相輪約 12 m
  //   九個輪要一圈一圈分得開（輪 1 格＋縫 1 格），相輪拉長到全高約 30%（實物約 22%），塔身照實物
  // 輪廓寬度（正面，以初層簷寬 ＝ 1）：基壇 0.79／初層塔身 0.52／初層簷 1.00／三層簷 0.86／五層簷 0.72／九輪 0.17
  //   （第一版實測 9000 塊 s = 8.77、10000 塊 29×91×29；二、三層簷一樣寬 → 這一版改成每層固定收 1 格）
  // 部件尺寸（9000 塊估 s ≈ 8.6～8.8，每公尺 f = 0.16·s ≈ 1.4 格）：
  //   簷寬 29／27／25／23／21 格；塔身 15／13／13／11／11 格；出簷 5～7 格；初層牆高 dim(s,0.8,4)=7 格；上層牆高 5 格
  //   初層板門 3 寬×5 高；連子窓 3 寬×3 高（三條直櫺）、上下留白壁；上層板門 1 寬×3 高
  //   屋頂每層 3 層積木、每層每邊收 2 格；屋角上翹 1 格、從角落往回 3 格
  //   九輪：每輪直徑 5 格、輪距 2 格，9 輪共 17 格；相輪全長約 29 格；風鐸 2 格長
  // 部件：基壇(walls＋box，hash 雜色) 四面台階(stairs) 塔身×5(walls＋顏色函式：柱、頭貫、板扉、連子窓、白壁)
  //   組物(walls 環×2) 軒裏(walls 環，接回組物) 屋頂×5(boxTaper 中空，隅棟用顏色函式) 屋角反り(box) 風鐸(set)
  //   高欄(walls t=1) 露盤(box) 伏鉢(cyl) 請花(cyl) 九輪(cyl×9) 擦管(cyl) 水煙(box 十字) 竜車(cyl) 宝珠(blob)
  pal: [0xe2dccf,   // 0 白壁
        0x3b2a1e,   // 1 深色木：柱、頭貫、軒裏、高欄
        0x575b61,   // 2 瓦（深灰）
        0x2f3236,   // 3 隅棟（更深一階的灰）
        0x86603e,   // 4 板扉、組物、連子
        0xa8a398,   // 5 基壇石
        0x8d887e,   // 6 基壇石（暗一階）、台階
        0x2c2925],  // 7 相輪、風鐸（黑褐的青銅）
  lo: 1.5, hi: 15,

  gen(v, s) {
    const f = s * 0.16;                                     // 每公尺幾格
    const M = (m, lo) => Math.max(lo, Math.round(f * m));
    const tile = (x, y, z) => (Math.abs(x) === Math.abs(z) ? 3 : 2);   // 對角線上是隅棟
    const stone = (x, y, z) => (hash100(x, y, z) < 25 ? 6 : 5);

    // 各層塔身半寬 HB；簷半寬 EV 每層至少收 1 格（往上一層一層小），簷至少比塔身多 3 格
    const HB = [], EV = [];
    for (let i = 0; i < 5; i++) {
      const hb = M(4.75 - 0.3 * i, 2);
      HB.push(i ? Math.min(HB[i - 1], hb) : hb);
    }
    const E0 = Math.round(f * 9.8), es = Math.max(1, f * 0.5);
    for (let i = 0; i < 5; i++) {
      const e = Math.max(HB[i] + 3, E0 - Math.round(i * es));
      EV.push(i ? Math.min(EV[i - 1], e) : e);
    }

    // ── 台基：石造基壇（中空，上面一片實心）＋四面台階
    const bh = M(1.2, 2);
    const B = Math.min(EV[0] - 1, Math.max(HB[0] + 2, Math.round(f * 7.8)));
    v.walls(0, 0, 0, 2 * B + 1, bh - 1, 2 * B + 1, stone, 1);
    v.box(0, bh - 1, 0, 2 * B + 1, 1, 2 * B + 1, stone);
    const sw = dim(s, 0.55, 3, true);
    stairs(v, 0, 0, -B - bh, bh, sw, 'z', 6);
    stairs(v, 0, 0, B + bh, bh, sw, '-z', 6);
    stairs(v, -B - bh, 0, 0, bh, sw, 'x', 6);
    stairs(v, B + bh, 0, 0, bh, sw, '-x', 6);

    // 塔身的牆：柱與頭貫（最上一層）是深色木，其餘白壁；中央間板扉、初層兩脇間連子窓
    const wallC = (y0, Hw, hb, ci, dh, win) => {
      const dTop = y0 + Math.max(1, Hw - 3);              // 門最上面那一層
      return (x, y, z) => {
        if (y === y0 + Hw - 1) return 1;                  // 頭貫
        const ax = Math.abs(x), az = Math.abs(z);
        const a = az === hb ? ax : az;                    // 沿著這面牆的位置
        if (a === hb || a === ci) return 1;               // 柱（方三間 → 每面四根）
        if (y <= dTop) {
          if (a <= dh) return 4;                          // 板扉（落地）
          if (win && y >= y0 + 2 && a > ci) return (a - ci) % 2 ? 4 : 1;   // 連子窓的直櫺
        }
        return 0;
      };
    };

    const nb = dim(s, 0.24, 1);                     // 組物幾層
    const rb = dim(s, 0.22, 1);                     // 露盤半寬
    const up = dim(s, 0.1, 1), L = dim(s, 0.35, 2); // 屋角上翹：高幾格、從角落往回幾格
    const bell = dim(s, 0.25, 1);                   // 風鐸長
    let y = bh;
    for (let i = 0; i < 5; i++) {
      const hb = HB[i], E = EV[i], W = 2 * hb + 1, last = i === 4;
      const Hw = i ? dim(s, 0.53, 3) : dim(s, 0.8, 4);
      const ci = hb >= 3 ? Math.max(1, Math.round(hb * 0.38)) : -1;  // 塔身太窄就只留角柱
      const dh = Math.max(0, ci - (i ? 3 : 2));                       // 門半寬：初層寬、上層窄
      v.walls(0, y, 0, W, Hw, W, wallC(y, Hw, hb, ci, dh, i === 0 && Hw >= 6), 1);   // 塔身
      y += Hw;
      for (let k = 1; k <= nb; k++)                                   // 組物：一層往外推一格
        v.walls(0, y + k - 1, 0, W + 2 * k, 1, W + 2 * k, 4, 2);
      y += nb;
      v.walls(0, y, 0, 2 * E - 1, 1, 2 * E - 1, 1, E - hb - nb + 1);   // 軒裏：從組物一路接到簷口
      y += 1;

      // 屋頂：每層每邊收 2 格，收到上一層的縁（最上一層收到露盤）
      const hn = last ? rb : HB[i + 1], gap = last ? 0 : 2;
      const hr = Math.max(2, Math.floor((E - hn - gap) / 2) + 1);
      const top = E - 2 * (hr - 1);
      const ry = y;
      boxTaper(v, { x: 0, y: ry, z: 0, w: 2 * E + 1, d: 2 * E + 1, w1: 2 * top + 1, d1: 2 * top + 1,
                    h: hr, t: Math.max(3, top - hn + 1), c: tile });

      // 屋角微微上翹＋角下的風鐸
      mirrorX(v, 1, (vx, sx) => mirrorZ(vx, 1, (vz, sz) => {
        for (let k = 1; k <= up; k++) {
          const len = Math.max(1, Math.round(L * (up - k + 1) / up));
          const mid = E - (len - 1) / 2;
          vz.box(sx * mid, ry + k, sz * (E - 0.5), len, 1, 2, tile);
          vz.box(sx * (E - 0.5), ry + k, sz * mid, 2, 1, len, tile);
        }
        for (let k = 1; k <= bell; k++) vz.set(sx * E, ry - k, sz * E, 7);
      }));

      y = ry + hr;
      if (!last && top - hn >= 2) v.walls(0, y, 0, 2 * top + 1, 1, 2 * top + 1, 1, 1);   // 上一層的高欄
    }

    // ── 相輪：露盤 → 伏鉢 → 請花 → 九輪 → 水煙 → 竜車 → 宝珠，中間一根擦管
    const lh = dim(s, 0.16, 1);
    v.box(0, y, 0, 2 * rb + 1, lh, 2 * rb + 1, 7);  y += lh;          // 露盤
    const fh = dim(s, 0.14, 1);
    v.cyl(0, y, 0, Math.max(1.2, s * 0.17), fh, 7);  y += fh;         // 伏鉢
    const rr = Math.max(1.9, s * 0.22);
    v.cyl(0, y, 0, rr, 1, 7);  y += 1;                                // 請花
    const y0s = y;
    const n = Math.min(9, Math.max(3, Math.round(s * 1.2)));
    for (let k = 0; k < n; k++) v.cyl(0, y + 1 + 2 * k, 0, rr, 1, 7); // 九輪：輪 1 格、縫 1 格
    y += 2 * n + 1;
    const rw = Math.round(rr + 1), hw = dim(s, 0.4, 2);
    for (let j = 0; j < hw; j++) {                                    // 水煙：十字交叉的兩片
      const wj = j === 0 || j === hw - 1 ? 2 * rw - 1 : 2 * rw + 1;
      v.box(0, y + j, 0, wj, 1, 1, 7);
      v.box(0, y + j, 0, 1, 1, wj, 7);
    }
    y += hw;
    v.cyl(0, y, 0, 1.2, 1, 7);  y += 1;                               // 竜車
    const pr = Math.max(1.5, s * 0.17), pry = pr * 1.15;
    const pc = y + Math.floor(pry * 1.02);
    blob(v, 0, pc, 0, pr, pry, pr, 7);                                // 宝珠
    v.cyl(0, y0s, 0, 0.5, pc - y0s, 7);                               // 擦管
  } },

{ n: '帝國大廈',
  // v1.257.0 整座重畫（見 開發筆記〈舊版 21 座重畫、偏白的 5 座調色〉）
  // 帝國大廈
  // 正面（−z，第五大道那一面）：方正的五層裙樓 → 6～30 樓三段退台一階一階往裡收 → 細長的主塔身（30～72 樓）
  //   → 72、81 樓兩次退台 → 86 樓觀景台 → 燈塔冠（方座、豎鰭圓筒、102 樓觀景室）→ 正中央一根細天線
  // 側面（+x）：同樣的退台階梯，略窄一點（塔身長邊朝正面）
  // 三樣識別物：Art Deco 層層退台、立面上石柱與鋁色豎框交錯的垂直線條、頂端收分的燈塔冠＋細桅杆
  // 部件：深色勒腳 裙樓（齊平的窗） 正門（金色門廳＋門楣） 6～21 樓（四角內凹） 21～25 樓 25～30 樓
  //       主塔身（四角內凹、凹窗） 72～81 樓 81～86 樓 每段退台的深色露台 86 樓觀景台女兒牆
  //       桅杆方座＋四角鋁鰭 鋁鰭圓筒 102 樓觀景室 小圓帽 天線 紅色航空燈
  /* e2e 把它當固定場景，三件事要守（都照 e2e 那幾條的量法在遊戲頁上量過）：
     ① 頂端正中央 x=0,z=0 一根細天線，下面是退台平頂：鐵球丟在正中央要「撞到、彈一下、落地」；
     ② 塔身是面貼面疊起來的雙層牆：石頭打牆腳（1500 塊、siteR×0.5、貼地）之後還要站得住 >100 塊；
     ③ 高而細：3000 塊時高 50 上下、底邊 20 上下。 */
  lo: 8, hi: 68,
  pal: [0xb3ab9a,   // 0 石灰岩（主色：石柱、牆）
        0x6e675c,   // 1 深色花崗岩：勒腳、每段退台的露台、牆體內層
        0xa7b1b9,   // 2 鋁色窗間板（垂直線條的亮帶）
        0x2c3742,   // 3 窗玻璃
        0x585f66,   // 4 天線鋼構
        0xc9a24a,   // 5 金色：正門門廳與門楣
        0xd2412f],  // 6 紅色航空燈
  gen(v, s) {
    const ST = 0, DK = 1, AL = 2, GL = 3, MS = 4, AU = 5, RD = 6;
    /* 一段塔身：y0 蓋到 y1−1，最上面那一層是屋頂板（填實：外圈石材收頭、裡面深色露台）。
       平面是 (2hx+1)×(2hz+1) 的長方形，四角各缺 n 格（帝國大廈塔身四角是內凹的）。
       牆厚 t（預設 2），內層是深色結構。顏色一邊蓋一邊挑（不蓋完再掃一遍）。
       立面節奏沿牆面每 4 格一輪：石柱｜窗｜鋁色豎框｜窗（面的正中央一定是石柱，左右對稱）。
       窗那一格外皮挖掉、內層換成玻璃與鋁色窗間板（逐層交替），凹進去一格；
       鋁色豎框跟石柱齊平——遠看就是一條一條從 6 樓拉到頂的亮線。
       o.base：裙樓（深色勒腳、窗跟牆齊平）；o.t：牆厚。 */
    const tier = (y0, y1, hx, hz, n, o) => {
      const t = o.t || 2;
      for (let y = y0; y < y1; y++) {
        const roof = y === y1 - 1;
        for (let x = -hx; x <= hx; x++) for (let z = -hz; z <= hz; z++) {
          const ax = Math.abs(x), az = Math.abs(z);
          const dA = Math.min(hx - ax, hz - n - az), dB = Math.min(hx - n - ax, hz - az);
          const dep = Math.max(dA, dB);
          if (dep < 0) continue;
          if (roof) { v.set(x, y, z, dep === 0 ? ST : DK); continue; }
          if (dep >= t) continue;
          if (dep > 0) { if (!v.has(x, y, z)) v.set(x, y, z, DK); continue; }
          if (o.base && y === y0) { v.set(x, y, z, DK); continue; }     // 裙樓的深色勒腳
          const sx = (dA === 0 && ax === hx) || (dB === 0 && ax === hx - n);
          const sz = (dA === 0 && az === hz - n) || (dB === 0 && az === hz);
          const k = ((sx && !sz ? z : x) % 4 + 4) % 4;
          if ((sx && sz) || k === 0) { v.set(x, y, z, ST); continue; }   // 石柱（轉角一律是柱）
          if (k === 2) { v.set(x, y, z, AL); continue; }                // 鋁色豎框
          if (o.base) { v.set(x, y, z, y % 2 ? GL : AL); continue; }    // 裙樓的窗跟牆齊平：貼地那圈牆不能被凹窗削薄
          const nx = sx && !sz ? Math.sign(x) : 0, nz = sx && !sz ? 0 : Math.sign(z);
          v.set(x - nx, y, z - nz, y % 2 ? AL : GL);                   // 窗：凹進去一格
        }
      }
    };

    // ── 平面尺寸：以主塔身為錨，其餘寫成「比主塔身寬幾格」 ──
    /* 底下這三段（裙樓、6～21 樓）的尺寸是 e2e〈炸穿牆腳〉那一條量出來的，不只是長相：
       那一發石頭（半徑 4.6，丟在 x＝建築半徑的一半、貼地）炸完還會點著六塊，
       火 15 秒大約燒掉 700～800 塊，**只要燒穿最靠近火源的那一圈牆，上面整棟就垮**、剩不到兩成五就換場（剩 0）。
       1500 塊、每種各打 6 發量過（後面是 >100 塊的發數；舊版正方形 6/6：三發剩 620 多、三發剩 125～141）：
         扁長的裙樓（進深 ±5）              0/6：一發就從前牆切到後牆，只剩 −x 半邊撐
         裙樓填實                           0/6：實心裙樓整塊都是火的燃料，燒光了一樣斷
         裙樓比 6～21 樓只寬 1 格            1/6
         6～21 樓牆厚 3                     1/6
         裙樓高 6 層                        4/6
         裙樓比 6～21 樓寬 2 格（係數 0.09） 5/6
         再加 6～21 樓牆厚 3                6/6 ← 用這組
       用這組再打 24 發：17 發剩 600 多塊、5 發塔身垮掉剩 110～140 塊、2 發剩 99，
       只靠對角勾著的一律 0 塊。e2e 是三發取剩最多的那一發 >100。
       寬出來的裙樓屋頂是一大片火要先吃掉的燃料，火源也離 6～21 樓那圈牆遠一點。 */
    const hxS = dim(s, 0.125, 2), hzS = dim(s, 0.11, 2);
    const hx1 = hxS + dim(s, 0.08, 2), hz1 = hzS + dim(s, 0.07, 2);       // 6～21 樓
    const hx0 = hx1 + dim(s, 0.09, 1), hz0 = hz1 + dim(s, 0.09, 1);       // 裙樓
    const hx2 = hxS + dim(s, 0.05, 1), hz2 = hzS + dim(s, 0.04, 1);       // 21～25 樓
    const hx3 = hxS + dim(s, 0.025, 1), hz3 = hzS + dim(s, 0.02, 1);     // 25～30 樓
    const hx5 = hxS - dim(s, 0.03, 1), hz5 = hzS - dim(s, 0.02, 1);      // 72～81 樓
    const hx6 = Math.max(1, hxS - dim(s, 0.055, 2)), hz6 = Math.max(1, hzS - dim(s, 0.045, 2));   // 81～86 樓
    // ── 高度：s 就是 86 樓屋頂的高度，各段照樓層比例切 ──
    const up = (prev, k) => Math.max(prev + 2, Math.round(s * k));
    const y0 = dim(s, 0.16, 5);            // 裙樓頂（5 樓；比真的高一點，火才不會一下就爬上塔身）
    const y1 = up(y0, 0.25);               // 21 樓
    const y2 = up(y1, 0.295);              // 25 樓
    const y3 = up(y2, 0.35);               // 30 樓
    const y4 = up(y3, 0.84);               // 72 樓
    const y5 = up(y4, 0.935);              // 81 樓
    const y6 = up(y5, 1.0);                // 86 樓（觀景台）

    tier(0, y0, hx0, hz0, 0, { base: true });                       // 裙樓
    tier(y0, y1, hx1, hz1, dim(s, 0.05, 1), { t: 3 });              // 6～21 樓（四角內凹，牆厚 3）
    tier(y1, y2, hx2, hz2, 1, {});
    tier(y2, y3, hx3, hz3, 1, {});
    tier(y3, y4, hxS, hzS, 1, {});                                  // 主塔身
    tier(y4, y5, hx5, hz5, 1, {});
    tier(y5, y6, hx6, hz6, 0, {});

    // ── 正門（第五大道）：裙樓正面正中央挖一個高門洞，裡面是金色門廳，上面一條金色門楣 ──
    const dw = dim(s, 0.03, 1), dh = Math.max(2, y0 - 2);
    for (let x = -dw; x <= dw; x++) {
      for (let y = 1; y < 1 + dh; y++) { v.del(x, y, -hz0); v.set(x, y, -hz0 + 1, AU); }
    }
    for (let x = -dw - 1; x <= dw + 1; x++) tint(v, x, 1 + dh, -hz0, AU);

    // ── 86 樓觀景台：屋頂外圈一圈女兒牆 ──
    v.walls(0, y6, 0, hx6 * 2 + 1, 1, hz6 * 2 + 1, ST, 1);

    // ── 燈塔冠（原本是飛船繫泊塔）：方座 → 豎鰭圓筒 → 102 樓觀景室 → 小圓帽 ──
    const c = dim(s, 0.035, 1);
    const hb = dim(s, 0.05, 2);
    v.box(0, y6, 0, c * 2 + 1, hb, c * 2 + 1, ST);                         // 方座
    corners4(v, c, c, (vv, x, z) => vv.box(x, y6, z, 1, hb + 1, 1, AL));   // 四角鋁色豎鰭
    const ym = y6 + hb, hm = dim(s, 0.10, 3), rm = c + 0.2;
    for (let y = ym; y < ym + hm; y++) {                                  // 圓筒：鋁鰭與窗交錯
      const n = Math.ceil(rm);
      for (let x = -n; x <= n; x++) for (let z = -n; z <= n; z++) {
        if (Math.hypot(x, z) > rm + 0.35) continue;
        // 鋁鰭為主，正前後左右那一條是窗
        v.set(x, y, z, (x === 0) !== (z === 0) && y % 2 ? GL : AL);
      }
    }
    const yo = ym + hm, ho = dim(s, 0.03, 1);
    v.cyl(0, yo, 0, Math.max(0.9, c * 0.7), ho, GL);                     // 102 樓觀景室
    v.box(0, yo + ho, 0, 1, 1, 1, ST);                                   // 小圓帽
    // ── 天線：正中央一根細桿，頂端紅色航空燈 ──
    const ya = yo + ho + 1, ha = dim(s, 0.17, 4);
    v.box(0, ya, 0, 1, ha, 1, MS);
    v.set(0, ya + ha, 0, RD);
  } },

{ n: '雙子星塔', lo: 1.8, hi: 11.5,
  // v1.257.0 只調色、格子一格都沒動（見 開發筆記〈舊版 21 座重畫、偏白的 5 座調色〉）
  // 雙子星塔：使用者交的那一份，造型一格都不動（格子集合跟舊版完全一樣），只重新上色
  // 正面：兩根並排的細高圓塔，分四段往上退縮，塔頂收成尖錐再拉一根細針；兩塔之間半腰一座懸空天橋，下面倒 V 斜撐
  // 側面：一根細長的塔（後面那根被擋住），底下一圈低矮裙樓
  // 三樣識別物：兩根一模一樣的退縮圓塔、半腰的天橋＋倒 V 斜撐、塔頂的銀色尖針
  // 部件（照舊）：基座 裙樓 裙樓玻璃 四段塔身 八瓣凸壁柱 橫向飾環 退縮環 塔冠收錐 尖塔 天橋 天橋窗帶 天橋飾線 斜撐 斜撐頂座
  // 上色：塔身從近白改成不鏽鋼的中銀灰；原本一亮一暗交錯的橫向飾環（亮的那圈是近白、暗的是近黑）
  //       兩種都換成偏藍灰的玻璃窗帶（一深一淺），塔身就是一層鋼一層玻璃的橫紋；凸壁柱之間凹進去的內圈深一階；
  //       退縮環、塔冠是亮銀，每一段退縮都有一圈亮邊；尖針是全座最亮的銀；
  //       天橋本體換成深一階的鐵灰（1800／3000 那兩檔幾乎被窗帶與飾線蓋滿，9000 才看得到），窗帶是藍玻璃；
  //       基座是偏暖的花崗岩灰，跟不鏽鋼分開。
  /* 來源：blueprints/吉隆坡雙子塔.js（v1.216 換掉原本那份）。
     檔案叫「吉隆坡雙子塔」、內建這一格叫「雙子星塔」，是同一座建築——
     照 v1.143 姬路城那次的裁示換掉內建、名字沿用內建那一個。 */
  pal: [0x9aa5b1,   // 0 八瓣凸壁柱、裙樓（不鏽鋼中銀灰，主色）
        0x3e5265,   // 1 玻璃窗帶（深，原本最暗的那圈飾環）
        0xc3cad2,   // 2 亮銀：退縮環、塔冠收錐、尖針座、天橋飾線、斜撐頂座
        0x454d57,   // 3 倒 V 斜撐鋼樑（深鋼）
        0x6e6a64,   // 4 基座花崗岩（偏暖的灰）
        0x6f97b5,   // 5 裙樓與天橋的玻璃（藍）
        0x5b636e,   // 6 天橋本體（深一階的鐵灰）
        0xdfe4ea,   // 7 尖針（全座最亮的銀）
        0x6c7784,   // 8 塔身內圈（凸壁柱之間凹進去的那一圈，深一階，看得出八瓣的直向溝）
        0x5a7189],  // 9 玻璃窗帶（淺，原本亮的那圈飾環）
  gen(v, s) {
    const r0 = dim(s, 0.38, 2.6);                // 主塔底半徑（保持修長）
    const dx = dim(s, 0.95, 6, true);             // 雙塔中心間距（半距 dx，雙塔完全筆直平行）
    const totalH = dim(s, 6.20, 26);             // 塔身高度（顯著拉長，體現摩天大樓挺拔感）
    const spireH = dim(s, 1.80, 8);              // 尖頂避雷針高度

    // 1. 基座地基
    const baseW = (dx + r0 + 2) * 2;
    const baseD = (r0 + 3) * 2;
    v.box(0, 0, 0, baseW, 1, baseD, 4);

    // 2. 正面低矮入口裙樓（壓低高度，使天橋下方留出大幅懸空挑高視野）
    const podR = Math.max(2.5, Math.round(dx * 0.62));
    const podH = Math.max(2, Math.round(dim(s, 0.22, 2)));
    const podZ = -Math.round(r0 * 0.75);
    v.cyl(0, 1, podZ, podR, podH, 0, 1);
    v.cyl(0, 1 + podH, podZ, podR + 0.6, 1, 2);
    // 裙樓玻璃大門入口
    v.cyl(0, 1, podZ, podR - 0.8, podH - 1, 5, 1);

    // 3. 雙塔主體高度劃分（逐段退縮）
    const h1 = Math.round(totalH * 0.42);         // 第1段：基底至天橋上方
    const h2 = Math.round(totalH * 0.26);         // 第2段：中高層
    const h3 = Math.round(totalH * 0.18);         // 第3段：高層退縮段
    const hCrown = totalH - (h1 + h2 + h3);       // 第4段：頂部金字塔階梯過渡

    // 雙塔左右對稱生成（雙塔中心嚴格固定在 ±dx，各段 360 度均勻旋轉對稱，保證絕對平行無外撇）
    mirrorX(v, dx, (vv, tx) => {
      let curY = 1;
      const ringStep = Math.max(2, Math.round(dim(s, 0.35, 2)));

      // 輔助函式：生成雙子星標誌性的 8 瓣凸壁柱（完全旋轉對稱）
      const buildSection = (r, h, lobeR, isFirst) => {
        vv.cyl(tx, curY, 0, r, h, 8, 1);                               // 舊：0（內圈）
        if (lobeR > 0.5) {
          ringOf(vv, 8, r * 0.82, (lv, lx, lz) => {
            lv.cyl(lx, curY, lz, lobeR, h, 0, 1);
          }, tx, 0);
        }
        for (let y = curY + 1; y < curY + h; y += ringStep) {
          vv.cyl(tx, y, 0, r + 0.45, 1, (y % (ringStep * 2) === 0) ? 9 : 1, 1);   // 舊：? 2 : 1（兩種都改成玻璃窗帶，一深一淺）
        }
        curY += h;
        // 退縮環邊界
        vv.cyl(tx, curY, 0, r + 0.7, 1, 2);
        curY += 1;
      };

      // --- 第 1 段 ---
      buildSection(r0, h1, Math.max(1.0, r0 * 0.42), true);

      // --- 第 2 段 ---
      const r1 = Math.max(2.2, r0 * 0.86);
      buildSection(r1, h2, Math.max(0.8, r1 * 0.38), false);

      // --- 第 3 段 ---
      const r2 = Math.max(1.7, r0 * 0.72);
      buildSection(r2, h3, Math.max(0.6, r2 * 0.35), false);

      // --- 第 4 段：塔冠逐階收縮圓錐（Crown） ---
      const crownH = Math.max(3, hCrown);
      vv.taper(tx, curY, 0, r2, 0.8, crownH, 2, 1);
      curY += crownH;

      // --- 第 5 段：尖塔避雷天線（Spire） ---
      const spireBaseH = Math.max(2, Math.round(spireH * 0.35));
      vv.cyl(tx, curY, 0, 0.9, spireBaseH, 2);                       // 舊：0
      vv.cyl(tx, curY + spireBaseH, 0, 0.45, spireH - spireBaseH, 7); // 舊：2
      vv.set(tx, curY + spireH, 0, 7);                                // 舊：2
    });

    // 4. 懸空天橋（Skybridge）與倒 V 字形斜撐支柱
    const bridgeY = 1 + Math.round(totalH * 0.40);
    const bridgeH = Math.max(2, Math.round(dim(s, 0.30, 2)));
    const bridgeW = (dx - r0 + 1) * 2;
    const bridgeD = Math.max(2, Math.round(r0 * 0.65));

    // 雙層懸空天橋本體
    v.box(0, bridgeY, 0, bridgeW, bridgeH, bridgeD, 6);                // 舊：0
    // 天橋兩側觀景窗帶
    v.box(0, bridgeY + 1, 0, bridgeW - 2, Math.max(1, bridgeH - 2), bridgeD + 0.2, 5);
    // 天橋上下金屬飾線
    v.box(0, bridgeY, 0, bridgeW, 1, bridgeD + 0.4, 2);
    v.box(0, bridgeY + bridgeH, 0, bridgeW, 1, bridgeD + 0.4, 2);

    // 倒 V 字形斜撐鋼樑（起點高於裙樓頂部，在空中形成舒展的懸空支撐）
    const strutStartY = Math.round(bridgeY * 0.58);
    const strutSpreadX = Math.round(dx * 0.72);
    mirrorX(v, 1, (vv, sign) => {
      vv.line(sign * strutSpreadX, strutStartY, 0, 0, bridgeY, 0, 3);
      if (bridgeD >= 3) {
        vv.line(sign * strutSpreadX, strutStartY, 1, 0, bridgeY, Math.floor(bridgeD / 2), 3);
        vv.line(sign * strutSpreadX, strutStartY, -1, 0, bridgeY, -Math.floor(bridgeD / 2), 3);
      }
    });
    // 斜撐頂點金屬基座
    v.box(0, bridgeY - 1, 0, Math.max(1, Math.round(dim(s, 0.2, 1))), 1, bridgeD, 2);
  } },

{ n: '台北 101', lo: 2.2, hi: 13.5, pal: [0x37686b, 0x588f91, 0xd0dad6, 0x224244, 0xd4a743, 0x7d8d91, 0x535c61],
  /* 來源：blueprints/台北101.js（v1.66 換掉原本那份） */
  gen(v, s) {
    // ── 尺寸參數計算 ───────────────────────────────────────────────
    // 靠中線對稱的部件寬度一律取奇數，避免屋脊與中心偏半格
    const bw = dim(s, 1.8, 9, true);      // 基座裙樓寬度
    const bh = dim(s, 1.4, 6);            // 基座裙樓高度
    const mw0 = dim(s, 1.2, 7, true);     // 竹節模組底部寬度
    const flare = dim(s, 0.25, 2, false); // 每節向外擴展格數
    const mw1 = mw0 + (flare % 2 === 0 ? flare : flare + 1); // 頂部寬度（保持奇數）
    const sh = dim(s, 0.72, 3);           // 單一竹節高度
    const crH = dim(s, 0.9, 4);           // 頂部退縮塔冠高度
    const spH = dim(s, 1.8, 7);           // 塔尖天線總高

    // ── 1. 台基與裙樓商場（1F–25F） ──────────────────────────────
    // 基礎實心石台（確保底層穩固貼地）
    v.box(0, 0, 0, bw + 4, 1, bw + 4, 6);
    v.box(0, 1, 0, bw + 2, 1, bw + 2, 6);

    // 裙樓四面包覆牆體
    v.walls(0, 2, 0, bw, bh, bw, 0, 1);

    // 四角巨柱與水平分層橫樑線腳
    corners4(v, (bw - 1) / 2, (bw - 1) / 2, (vv, x, z) => {
      vv.box(x, 2, z, 1, bh, 1, 2);
    });
    for (let y = 3; y < 2 + bh; y += 2) {
      v.box(0, y, 0, bw + 1, 1, bw + 1, 2);
    }

    // 正背出入口雨遮門廊
    const entW = dim(s, 0.5, 3, true);
    mirrorZ(v, (bw + 1) / 2, (vv, dz) => {
      vv.box(0, 2, dz, entW, 1, 2, 2);
      vv.carve(0, 2, dz, entW - 2, 2, 1);
    });

    // ── 2. 第26層：四面巨型乾坤古錢幣與如意裝飾 ───────────────────
    const coinY = 1 + bh;
    v.box(0, coinY, 0, bw + 2, 1, bw + 2, 2); // 裙樓壓頂大簷

    const coinR = dim(s, 0.28, 2);
    mirrorZ(v, (bw - 1) / 2, (vv, dz) => {
      for (let i = -coinR; i <= coinR; i++) {
        for (let j = -coinR; j <= coinR; j++) {
          if (Math.hypot(i, j) <= coinR + 0.3) {
            const isCenter = Math.abs(i) <= 1 && Math.abs(j) <= 1;
            vv.set(i, coinY + j, dz, isCenter ? 3 : 4);
          }
        }
      }
    });
    mirrorX(v, (bw - 1) / 2, (vv, dx) => {
      for (let i = -coinR; i <= coinR; i++) {
        for (let j = -coinR; j <= coinR; j++) {
          if (Math.hypot(i, j) <= coinR + 0.3) {
            const isCenter = Math.abs(i) <= 1 && Math.abs(j) <= 1;
            vv.set(dx, coinY + j, i, isCenter ? 3 : 4);
          }
        }
      }
    });

    // ── 3. 八節倒梯形斗狀竹節模組（8 Pagoda Modules） ───────────
    let curY = coinY + 1;

    for (let seg = 0; seg < 8; seg++) {
      const segBaseY = curY;

      // 模組每層向上向外漸層擴展（斗狀）
      for (let dy = 0; dy < sh; dy++) {
        const progress = dy / Math.max(1, sh - 1);
        let cw = mw0 + Math.round(progress * (mw1 - mw0));
        if (cw % 2 === 0) cw += 1;

        const cy = segBaseY + dy;
        v.walls(0, cy, 0, cw, 1, cw, 0, 1);

        // 玻璃帷幕橫向採光反光窗帶
        if (dy % 2 === 1) {
          mirrorZ(v, (cw - 1) / 2, (vv, dz) => {
            for (let wx = -Math.floor(cw / 2) + 1; wx <= Math.floor(cw / 2) - 1; wx++) {
              tint(vv, wx, cy, dz, 1);
            }
          });
          mirrorX(v, (cw - 1) / 2, (vv, dx) => {
            for (let wz = -Math.floor(cw / 2) + 1; wz <= Math.floor(cw / 2) - 1; wz++) {
              tint(vv, dx, cy, wz, 1);
            }
          });
        }
      }

      const segTopY = segBaseY + sh;
      // 節頂外突挑簷陽台（外凸 2 格）
      v.box(0, segTopY, 0, mw1 + 2, 1, mw1 + 2, 2);

      // 四角如意斗拱金飾
      corners4(v, (mw1 + 1) / 2, (mw1 + 1) / 2, (vv, x, z) => {
        vv.set(x, segTopY, z, 4);
        vv.set(x, segTopY - 1, z, 2);
      });

      // 正面與側面中央祥雲金飾
      mirrorZ(v, (mw1 + 1) / 2, (vv, dz) => {
        vv.set(0, segTopY - 1, dz, 4);
        vv.set(0, segTopY, dz, 4);
      });
      mirrorX(v, (mw1 + 1) / 2, (vv, dx) => {
        vv.set(dx, segTopY - 1, 0, 4);
        vv.set(dx, segTopY, 0, 4);
      });

      curY = segTopY + 1;
    }

    // ── 4. 觀景台與階梯退縮塔冠（89F–101F） ─────────────────────────
    // 觀景台量體
    const obW = mw0;
    v.walls(0, curY, 0, obW, crH, obW, 0, 1);

    // 觀景台環景採光窗
    for (let y = curY + 1; y < curY + crH - 1; y++) {
      mirrorZ(v, (obW - 1) / 2, (vv, dz) => {
        for (let wx = -Math.floor(obW / 2) + 1; wx <= Math.floor(obW / 2) - 1; wx++) tint(vv, wx, y, dz, 1);
      });
      mirrorX(v, (obW - 1) / 2, (vv, dx) => {
        for (let wz = -Math.floor(obW / 2) + 1; wz <= Math.floor(obW / 2) - 1; wz++) tint(vv, dx, y, wz, 1);
      });
    }
    curY += crH;

    // 三階退縮塔冠
    let crownW = obW;
    for (let step = 0; step < 3; step++) {
      v.box(0, curY, 0, crownW, 1, crownW, 2);
      curY += 1;
      crownW = Math.max(3, crownW - 2);
      v.walls(0, curY, 0, crownW, 2, crownW, 0, 1);
      curY += 2;
    }
    v.box(0, curY, 0, crownW + 2, 1, crownW + 2, 2);
    curY += 1;

    // ── 5. 頂部尖塔與避雷針天線 ────────────────────────────────────
    const spireBaseW = Math.max(3, dim(s, 0.45, 3, true));
    v.taper(0, curY, 0, (spireBaseW + 1) / 2, 1, dim(s, 0.4, 3), 5);
    curY += dim(s, 0.4, 3);

    // 圓柱段過渡
    const mastH = dim(s, 0.6, 3);
    v.cyl(0, curY, 0, 1.2, mastH, 5);
    curY += mastH;

    // 細長避雷針天線
    const needleH = Math.max(4, spH - dim(s, 0.4, 3) - mastH);
    v.box(0, curY, 0, 1, needleH, 1, 5);

    // 避雷針中段通訊環與信標光環
    const ringY = curY + Math.floor(needleH * 0.4);
    v.box(0, ringY, 0, 3, 1, 3, 2);
    v.del(0, ringY, 0);
    v.set(0, ringY, 0, 5);
  } },
{ n: '雪梨歌劇院',
  // v1.306.0 整座重畫：盲測第五回的子 agent 只拿〈藍圖製作說明〉、從零做出來的第二版（看過一次報告＋9000 四視圖），
  // 原樣收進來，只改了名字與 pal 的寫法（見 開發筆記〈盲測第五回：三座粗糙的內建重做（v1.306.0）〉）
  // ── 設計表（第二版）──
  // 三句話
  //   正面（−z，南邊、大階梯那一側）：一整片寬台基，前面幾乎全寬的大階梯；台上左右兩組白色貝殼，
  //     每組是一個開口朝前（白框＋玻璃）的小貝殼，後面頂著一個很高的尖拱形大貝殼；左前角（西南）一組小的（Bennelong 餐廳）。
  //   側面（+x，西邊）：一串白色帆往後（北、港口那一側）傾，最高那片在前段，往後一片比一片矮；
  //     每片的帆尖往前探、懸在下一片的背上，帆尖底下靠地面那一段是深色玻璃三角；最前面一片小帆反過來朝南。
  //   三樣識別物：①一前一後層疊、尖端前傾的白色帆形貝殼 ②貝殼開口的深色玻璃牆 ③寬大的台基與幾乎全寬的大階梯
  // 比例表（實物；★是查到的，其餘是估的）
  //   ★全長 183 m、★最寬 120 m、★最高點海拔 67 m（基地約海拔 4 m → 離地約 63 m）
  //   台基高約 12 m（查不到，估）；大階梯寬約 84 m（★有一說近 100 m，這裡西南角讓給餐廳）、深約 30 m
  //   音樂廳（西）最高貝殼離台基 51 m、開口寬 46 m；歌劇廳（東）取音樂廳 0.88 倍；餐廳貝殼約 22 m 高
  //   每組四片（以最高那片 = 1）：朝南小殼 0.55、最高殼 1、第二 0.78、第三 0.51；朝南小殼與最高殼背靠背，交會的凹谷約 12 m 高
  // 輪廓寬度表（正面，以台基寬 106 m = 1）
  //   y 0～12 m（台基＋階梯）：1.00（兩側海水再各 0.08）
  //   y 20 m：兩組貝殼＋餐廳 0.97（兩組中間留 5 m 的縫）
  //   y 30 m：音樂廳 0.39＋歌劇廳 0.33＋餐廳 0.08
  //   y 45 m：音樂廳 0.26＋歌劇廳 0.18
  //   y 63 m：只剩音樂廳最高殼的尖
  // 部件尺寸（第一版報告 9000 塊 s = 18.0；這版殼變寬、玻璃變少，估 s ≈ 17.5 → c = s×0.025 ≈ 0.44 格/公尺）
  //   台基 48×5×62 格；階梯 4 階、每階 3 格深、37 格寬
  //   音樂廳最高殼：高 22.4、開口寬 21、帆尖比玻璃多探出 3.2；朝南小殼：高 12.3、開口寬 17（白框 2 格、玻璃 13 寬）
  //   歌劇廳最高殼：高 19.7、開口寬 19；餐廳兩片：高 8～10、開口寬 9～11
  //   海水帶 4 格寬；玻璃直櫺每 3 格一條
  // 部件清單（工具）
  //   台基：v.walls（中空）＋頂面 v.box；女兒牆 v.box；海水 v.box ×3
  //   大階梯：每階一片 v.box 踏面＋後緣深色一排＋兩側擋牆（stairs 每階只有 1 格深又填實到底，這裡要 3 格深的緩階）
  //   貝殼 ×10：自己寫的 sail（斷面是尖拱、沿軸一路長高、開口那一面前傾；只畫外殼，逐列 v.box；開口邊緣 2 格厚當白框）
  //   玻璃牆：退在開口裡、垂直落到台基的一片 v.box（顏色函式畫直櫺）＋下段兩側玻璃
  //   線腳：貝殼底一圈陰影色、台基邊的女兒牆
  pal: [0xe6e2d5,   // 0 貝殼白磁磚（亮度 0.87）
        0xb8b09e,   // 1 貝殼底緣陰影（米色霧面磚，0.67）
        0x4a3d31,   // 2 玻璃牆（茶色玻璃，0.24）
        0x7d6a55,   // 3 玻璃直櫺（亮一階當反光，0.41）
        0xb39b86,   // 4 台基頂面、階梯踏面（粉紅花崗岩鋪面，0.61）
        0x8f6f5c,   // 5 台基側牆、女兒牆、階梯陰影線（0.46）
        0x2f6b93],  // 6 港灣海水（0.38）
  lo: 2, hi: 26,

  gen(v, s) {
    const c = Math.max(0.075, s * 0.025);            // 每公尺幾格（整座只靠它縮放，比例不會變）
    const m = x => x * c;                             // 公尺 → 格
    const B = (x0, x1, y, h, z0, z1, col) =>          // 用兩端的格子畫長方體
      v.box((x0 + x1) / 2, y, (z0 + z1) / 2, x1 - x0 + 1, h, z1 - z0 + 1, col);

    // ── 台基（x −50～+56 m、z 0～138 m）──
    const P = Math.max(2, Math.round(m(12)));         // 台基高（含頂面那一層）
    const px0 = Math.round(m(-50)), px1 = Math.round(m(56));
    const pz1 = Math.max(8, Math.round(m(138)));
    const pxc = (px0 + px1) / 2, pzc = pz1 / 2, PW = px1 - px0 + 1, PD = pz1 + 1;
    v.walls(pxc, 0, pzc, PW, P - 1, PD, 5, 1);       // 中空四面牆
    v.box(pxc, P - 1, pzc, PW, 1, PD, 4);            // 頂面鋪面

    // ── 大階梯（南面，x −50～+34 m）──
    const sx1 = Math.round(m(34));
    const n = P - 1, run = Math.max(1, Math.round(m(30) / n));
    for (let i = 0; i < n; i++) {
      const za = -(n - i) * run, zb = za + run - 1;
      B(px0, sx1, i, 1, za, zb, 4);                   // 踏面
      if (run >= 2) B(px0 + 1, sx1 - 1, i, 1, zb, zb, 5);   // 後緣一排深色（下一階腳下的陰影線）
      B(px0, px0, 0, i + 1, za, zb, 5);               // 兩側擋牆
      B(sx1, sx1, 0, i + 1, za, zb, 5);
    }

    // ── 女兒牆（線腳）與港灣 ──
    B(px0, px0, P, 1, 0, pz1, 5); B(px1, px1, P, 1, 0, pz1, 5);
    B(px0, px1, P, 1, pz1, pz1, 5); B(sx1 + 1, px1, P, 1, 0, 0, 5);
    const wv = Math.max(1, Math.round(m(8)));
    B(px0 - wv, px0 - 1, 0, 1, 0, pz1 + wv, 6);
    B(px1 + 1, px1 + wv, 0, 1, 0, pz1 + wv, 6);
    B(px0, px1, 0, 1, pz1 + 1, pz1 + wv, 6);

    // ── 貝殼 ──
    /* 一片貝殼：從後端（zb）往開口方向（dir）長 L，開口那一面前傾 ov（帆尖在 L + ov）。
       斷面是尖拱：高 h 時半寬 = w × (1 − (y/h)²)；h 沿軸照 sin 長到帆尖 H，w 從 0.45W 長到開口的 W。
       先把每個 (軸向 i, 高度 j) 的半寬算成表，再只畫「鄰格在外面」的那幾格（外殼一格厚，開口邊 2 格）。 */
    const y0 = P;
    const TH = Math.PI * 0.4, ST = Math.sin(TH);
    const prep = (cxm, zbm, dir, Lm, ovm, Hm, Wm) => {
      const cx = Math.round(m(cxm)), zb = Math.round(m(zbm));
      const L = Math.max(1, m(Lm)), ov = Math.max(0.6, m(ovm));
      const H = Math.max(2, m(Hm)), W = Math.max(1.2, m(Wm));
      const U = L + ov, nU = Math.max(2, Math.round(U)), nY = Math.floor(H);
      const kf = [], kn = [];              // kf：開口斜面切掉；kn：不切（當作裡面，開口由玻璃封）
      for (let i = 0; i <= nU + 1; i++) {
        const h = i <= 0 ? 0 : H * Math.sin(TH * Math.min(1, i / U)) / ST;
        const w = W * (0.45 + 0.55 * Math.min(1, i / L));
        const a = [], b = [];
        for (let j = 0; j <= nY + 1; j++) {
          let k = -1;
          if (h > 0 && j <= h) { const q = j / h; k = Math.floor(w * (1 - q * q) + 0.5); }
          b.push(k);
          a.push(i <= L + ov * j / H ? k : -1);
        }
        kf.push(a); kn.push(b);
      }
      return { cx, zb, dir, L, ov, H, W, nU, nY, kf, kn };
    };

    // 玻璃牆：退在開口裡（開口底往前 0.4×ov 那一片），垂直落到台基；比殼的斷面每邊縮 2 格，留白框。
    // 開口斜面在玻璃後面的那一段（下半）兩側補玻璃封起來；上半的帆尖就探出玻璃外面。
    const glass = S => {
      const { cx, zb, dir, L, ov, H, nU, nY, kn } = S;
      const iC = Math.min(nU, Math.max(1, Math.round(L + 0.4 * ov)));
      const zc = zb + dir * iC;
      const gf = (x, y, z) => ((x - cx) % 3 === 0 ? 3 : 2);
      for (let j = 0; j <= nY; j++) {
        const kc = kn[iC][j] - 2;
        if (kc < 0) continue;
        v.box(cx, y0 + j, zc, 2 * kc + 1, 1, 1, gf);
        const iA = Math.floor(L + ov * j / H);
        if (kc >= 1 && iA < iC) {
          const z1 = zb + dir * iA, z2 = zb + dir * (iC - 1);
          v.box(cx + kc, y0 + j, (z1 + z2) / 2, 1, 1, Math.abs(z2 - z1) + 1, 2);
          v.box(cx - kc, y0 + j, (z1 + z2) / 2, 1, 1, Math.abs(z2 - z1) + 1, 2);
        }
      }
    };

    // 白色外殼：每一列只畫左右兩端「鄰格比我窄」的那一段；開口那一圈多畫 1 格當白框
    const shell = S => {
      const { cx, zb, dir, L, ov, H, nU, nY, kf, kn } = S;
      for (let i = 1; i <= nU; i++) {
        const z = zb + dir * i;
        for (let j = 0; j <= nY; j++) {
          const k = kf[i][j];
          if (k < 0) continue;
          const nb = Math.min(kf[i][j + 1], j > 0 ? kn[i][j - 1] : 99, kf[i - 1][j], kn[i + 1][j]);
          const atFace = i + 1 > L + ov * j / H && kn[i + 1][j] >= 0;
          const lo = Math.max(0, Math.min(k, nb + 1, atFace ? k - 1 : k));
          const col = j === 0 ? 1 : 0;                 // 貼台基那一圈放陰影色
          if (lo === 0) v.box(cx, y0 + j, z, 2 * k + 1, 1, 1, col);
          else {
            const wd = k - lo + 1, off = (lo + k) / 2;
            v.box(cx + off, y0 + j, z, wd, 1, 1, col);
            v.box(cx - off, y0 + j, z, wd, 1, 1, col);
          }
        }
      }
    };

    // 一組廳：朝南小殼與最高殼背靠背（各往對方伸 9 m，凹谷才不會掉到地面），
    // 再往北兩片一片比一片矮，後端只塞進前一片開口 2 m——帆尖懸在下一片的背上
    const hall = (cxm, zm, k) => {
      const d = 9 * k;
      const z1 = zm - d, o1 = z1 + 38 * k, z2 = o1 - 2 * k, o2 = z2 + 30 * k, z3 = o2 - 2 * k;
      return [prep(cxm, zm + d, -1, 20 * k, 7 * k, 28 * k, 18 * k),
              prep(cxm, z1, 1, 38 * k, 12 * k, 51 * k, 23 * k),
              prep(cxm, z2, 1, 30 * k, 10 * k, 40 * k, 21 * k),
              prep(cxm, z3, 1, 22 * k, 8 * k, 26 * k, 17 * k)];
    };
    const S = [...hall(24, 45, 1),                    // 音樂廳（西，+x）
               ...hall(-24, 40, 0.88),                // 歌劇廳（東，−x）
               prep(44, 12, -1, 8, 3.5, 18, 10),      // Bennelong 餐廳：朝南那片
               prep(44, 10, 1, 9, 3.5, 22, 11)];      //                朝北那片
    S.forEach(glass);                                 // 玻璃先畫，後面的貝殼蓋過去才不會被玻璃切一刀
    S.forEach(shell);
  } },
{ n: '荷蘭風車',
  // v1.257.0 整座重畫（見 開發筆記〈舊版 21 座重畫、偏白的 5 座調色〉）
  // 荷蘭風車（迴廊式磨坊 stellingmolen）
  // 正面（−z）：紅磚八角底座 → 一圈木造迴廊 → 收分的八角茅草塔身 → 船形帽頂，帽頂前方伸出風車軸，
  //   四片扇葉擺成十字：左右兩片張著奶油色帆布（紅色外框），上下兩片只剩紅色格柵、帆布捲在桿邊
  // 側面（+x）：塔身收分明顯；帽頂往後拖一根尾桿斜斜落到迴廊上，尾端一個絞盤輪；扇葉是貼在正面的一片薄板
  // 三樣識別物：四片格柵扇葉＋帆布、收分的八角茅草塔身、半腰那一圈迴廊（磚底座在下）
  // 部件：石砌勒腳 紅磚八角底座 正門／後門（綠色） 底座的窗與綠色百葉 迴廊平台 迴廊欄杆 迴廊斜撐
  //       八角茅草塔身（轉角深色稜線） 塔身小窗 帽座 船形帽頂 帽頂正面綠色鼻板 風車軸 軸頭
  //       四根主桿 前緣板 紅色格柵 帆布（張開／捲起） 尾桿 尾桿斜撐 絞盤輪
  lo: 7, hi: 70,
  pal: [0x7d6c4f,   // 0 茅草（塔身主色）
        0x564838,   // 1 深茅草：轉角稜線、帽頂、勒腳與磚縫
        0x8a4535,   // 2 紅磚底座
        0x3b2f27,   // 3 深色木料：迴廊、主桿、前緣板、尾桿、窗洞
        0xe0d2ae,   // 4 帆布（奶油色）
        0xa63a2c,   // 5 紅色格柵框
        0x2e5e46],  // 6 荷蘭綠：門、百葉、帽頂鼻板
  gen(v, s) {
    const TH = 0, TD = 1, BR = 2, WD = 3, CL = 4, RD = 5, GR = 6;
    /* 扇葉擺正十字（0°）。試過 X 形（45°）：格柵與帆布斜著走全變成鋸齒，帆布糊成一片看不出來；
       擺正之後格柵、外框、帆布都是直邊，三千塊也分得出來。 */
    const SAIL_A = 0;
    const hash = (x, y, z) => {
      let h = (x * 73856093) ^ (y * 19349663) ^ (z * 83492791);
      h = (h ^ (h >>> 13)) * 1274126177;
      return ((h ^ (h >>> 16)) >>> 0) % 100;
    };
    /* 八角形的「距離」：正八角形邊心距 a 的邊界就是 onorm = a（四個正面朝 ±x/±z，四個斜面朝 45°）。
       c1 = max(|x|,|z|) 是正面那一組、c2 = (|x|+|z|)/√2 是斜面那一組，兩個差不多大的地方就是轉角。 */
    const c1 = (x, z) => Math.max(Math.abs(x), Math.abs(z));
    const c2 = (x, z) => (Math.abs(x) + Math.abs(z)) / Math.SQRT2;
    // 八角殼：從 y0 起 h 層，邊心距 a0 收到 a1（連續值，塊數才會連續），牆厚 t（0＝實心）
    const oct = (y0, h, a0, a1, t, pick) => {
      for (let j = 0; j < h; j++) {
        const a = a0 + (a1 - a0) * (h > 1 ? j / (h - 1) : 0), n = Math.ceil(a + 0.5);
        for (let x = -n; x <= n; x++) for (let z = -n; z <= n; z++) {
          const d = Math.max(c1(x, z), c2(x, z));
          if (d > a + 0.35 || (t && d < a + 0.35 - t)) continue;
          const c = pick(x, y0 + j, z);
          if (c !== null) v.set(x, y0 + j, z, c);                      // null＝這格留空（欄杆的間隙）
        }
      }
    };

    // ── 尺寸：s 就是帽頂的高度 ──
    const hB = dim(s, 0.30, 4);                               // 磚造底座高（迴廊在它頂上）
    const aB0 = Math.max(3.2, s * 0.215), aB1 = Math.max(3, s * 0.195);
    const hS = dim(s, 0.50, 6);                               // 茅草塔身高
    const aS0 = aB1 - 0.4, aS1 = Math.max(1.9, s * 0.112);
    const yC = hB + hS;                                       // 帽座那一層
    const aSt = aB1 + Math.max(1.6, s * 0.10);                // 迴廊外緣

    // ── 磚造底座：石砌勒腳＋紅磚（固定雜湊挑幾塊深色磚） ──
    oct(0, 1, aB0 + 0.6, aB0 + 0.6, 1.6, () => TD);
    oct(1, hB - 1, aB0, aB1, 2, (x, y, z) => hash(x, y, z) < 14 ? TD : BR);
    // ── 茅草塔身：轉角是深色稜線，其餘茅草夾雜深淺 ──
    oct(hB, hS, aS0, aS1, 1.7, (x, y, z) =>
      Math.abs(c1(x, z) - c2(x, z)) < 0.45 || hash(x, y, z) < 20 ? TD : TH);

    // ── 門：正面與背面各一扇（綠色），沿 ±z 從裡往外找牆面 ──
    const dw = Math.max(1, Math.round(s * 0.03)), dh = dim(s, 0.12, 2);
    for (const sz of [-1, 1]) {
      for (let x = -dw; x <= dw; x++) for (let y = 1; y <= dh; y++)
        paintFrom(v, x, y, 0, 0, 0, sz, Math.ceil(aB0) + 2, GR);
      for (let x = -dw + 1; x <= dw - 1; x++) paintFrom(v, x, dh + 1, 0, 0, 0, sz, Math.ceil(aB0) + 2, GR);
    }
    // ── 底座的窗（深色窗洞＋兩側綠色百葉），在左右與四個斜面 ──
    const wy = Math.max(2, Math.round(hB * 0.6));
    for (const [nx, nz] of [[1, 0], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const lx = -nz, lz = nx, L = Math.ceil(aB0) + 2;
      paintFrom(v, 0, wy, 0, nx, 0, nz, L, WD);
      paintFrom(v, 0, wy + 1, 0, nx, 0, nz, L, WD);
      for (const k of [-1, 1]) {
        paintFrom(v, lx * k, wy, lz * k, nx, 0, nz, L, GR);
        paintFrom(v, lx * k, wy + 1, lz * k, nx, 0, nz, L, GR);
      }
    }
    // ── 塔身的小窗：正面兩扇、左右各一扇 ──
    for (const f of [0.28, 0.62]) {
      const y = hB + Math.round(hS * f);
      paintFrom(v, 0, y, 0, 0, 0, -1, Math.ceil(aS0) + 2, WD);
      paintFrom(v, 0, y + 1, 0, 0, 0, -1, Math.ceil(aS0) + 2, WD);
    }
    for (const nx of [-1, 1]) paintFrom(v, 0, hB + Math.round(hS * 0.45), 0, nx, 0, 0, Math.ceil(aS0) + 2, WD);

    // ── 迴廊：木板平台、外緣欄杆（一根一根的柱＋扶手）、下面八根斜撐 ──
    oct(hB, 1, aSt, aSt, aSt - aB1 + 1.2, () => WD);
    oct(hB + 1, 1, aSt, aSt, 0.9, (x, y, z) => ((x + z) & 1) ? WD : null);
    oct(hB + 2, 1, aSt, aSt, 0.9, () => WD);
    /* 斜撐、尾桿都是細木條，用 v.line 不用 limb：limb 要逐格掃包圍盒算距離，而 fitScale 一次要叫 gen 64 遍。
       實測 9000 塊那一檔單次 gen：這十幾根 limb 換成 v.line、帽頂的 Math.hypot 換成 sqrt，2.9ms → 2.1ms。 */
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4, ca = Math.cos(a), sa = Math.sin(a);
      const yl = Math.round(hB * 0.5), al = aB0 + (aB1 - aB0) * (yl / hB);
      v.line(ca * (aSt - 0.6), hB - 1, sa * (aSt - 0.6), ca * (al + 0.6), yl, sa * (al + 0.6), WD);
    }

    // ── 帽頂：深色木框的帽座 → 沿 z 拉長的船形帽（茅草），正面一塊綠色鼻板 ──
    const capA = aS1 + 0.7;
    oct(yC, 1, capA, capA, 0, () => WD);
    const rx = aS1 + 0.9, rz = aS1 + 1.9, ry = Math.max(2.5, s * 0.12);
    for (let y = 0; y <= Math.ceil(ry); y++) {
      const nx = Math.ceil(rx), nz = Math.ceil(rz);
      for (let x = -nx; x <= nx; x++) for (let z = -nz; z <= nz; z++) {
        const d = Math.sqrt((x / rx) ** 2 + (y / ry) ** 2 + (z / rz) ** 2);
        if (d > 1.02 || d < 1.02 - 1.6 / Math.min(rx, ry)) continue;
        v.set(x, yC + 1 + y, z, z < -rz * 0.62 ? GR : TD);
      }
    }
    // ── 風車軸：從帽頂裡斜斜往前上方伸出去，前端一顆軸頭 ──
    const yH = yC + 1 + Math.max(1, ry * 0.3), zH = -(rz + Math.max(1.5, s * 0.05));
    limb(v, { x: 0, y: yC + 1, z: -rz * 0.2, x1: 0, y1: yH, z1: zH, r: Math.max(0.6, s * 0.024), c: WD });
    blob(v, 0, yH, zH, Math.max(1, s * 0.035), Math.max(1, s * 0.035), Math.max(0.8, s * 0.025), WD);

    // ── 四片扇葉（十字）：主桿、前緣板、紅色格柵；左右兩片張帆、上下兩片把帆捲在桿邊 ──
    /* 每一片在自己的座標裡想：u 沿主桿往外、w 垂直主桿（正的那一側是格柵與帆，負的是前緣板）。
       反過來掃：把扇葉包圍盒裡每一格轉回 (u, w) 再判它是哪一種——每格只寫一次，
       不會像「沿 u、w 細步取樣再四捨五入」那樣同一格寫好幾遍
       （第一版就是細步取樣，連同尾桿那些 limb，9000 塊那一檔產生時間量到 187ms）。 */
    /* 張帆的那兩片：帆布鋪在格柵前面，正面看只剩外框（紅）；收帆的兩片才看得到一格一格的橫檔。
       兩種並排，一眼就分得出「格柵」與「帆布」（第一版四片都畫橫檔，帆布只剩 44 格，整片看起來是深色的）。 */
    const R = s * 0.47, r0 = R * 0.16, wS = Math.max(3, R * 0.3), wL = Math.max(1, R * 0.05);
    const step = Math.max(2.6, R * 0.17);
    for (let b = 0; b < 4; b++) {
      const a = SAIL_A + b * Math.PI / 2, ca = Math.cos(a), sa = Math.sin(a);
      const cloth = b % 2 === 0;
      const xs = [0, R * ca - wS * sa, R * ca + wL * sa, -wS * sa, wL * sa];
      const ys = [0, R * sa + wS * ca, R * sa - wL * ca, wS * ca, -wL * ca];
      for (let x = Math.floor(Math.min(...xs)) - 1; x <= Math.ceil(Math.max(...xs)) + 1; x++)
        for (let j = Math.floor(Math.min(...ys)) - 1; j <= Math.ceil(Math.max(...ys)) + 1; j++) {
          const u = x * ca + j * sa, w = -x * sa + j * ca;
          if (u < -0.5 || u > R + 0.5 || w < -wL - 0.5 || w > wS + 0.5) continue;
          let c = -1;
          if (Math.abs(w) <= 0.5) c = WD;                                    // 主桿
          else if (u < r0 - 0.5) continue;
          else if (w < 0) c = WD;                                            // 前緣板
          else if (w > wS - 0.5 || u > R - 0.5 || u < r0 + 0.5) c = RD;          // 外框：邊條、尖端、根部
          else if (cloth) c = CL;                                            // 張開的帆布
          else if (Math.abs((u - r0) / step - Math.round((u - r0) / step)) * step < 0.5) c = RD;   // 橫檔
          else if (w < 1.7) c = CL;                                          // 捲起來捆在桿邊的帆
          if (c >= 0) v.set(x, yH + j, zH, c);
        }
    }

    // ── 尾桿：從帽座後緣斜斜落到迴廊外緣上方，兩根斜撐，尾端一個絞盤輪 ──
    const zT0 = aS1 * 0.6, yT1 = hB + 2, zT1 = aSt - 0.4;
    v.line(0, yC, zT0, 0, yT1, zT1, WD);
    v.line(0, yC + 1, zT0, 0, yT1 + 1, zT1, WD);                      // 尾桿兩格粗
    const ym = yT1 + (yC - yT1) * 0.4, zm = zT1 + (zT0 - zT1) * 0.4;
    mirrorX(v, Math.max(1.4, aS1 * 0.85), (vv, dx) => vv.line(dx, yC, 0, 0, ym, zm, WD));
    const kr = Math.max(1.3, s * 0.045);
    for (let i = 0; i < 24; i++) {                                    // 輪框
      const t = i / 24 * Math.PI * 2;
      v.set(Math.cos(t) * kr, yT1 + 1 + Math.sin(t) * kr, zT1 + 1, WD);
    }
    v.line(-kr, yT1 + 1, zT1 + 1, kr, yT1 + 1, zT1 + 1, WD);          // 輪輻
    v.line(0, yT1 + 1 - kr, zT1 + 1, 0, yT1 + 1 + kr, zT1 + 1, WD);
  } },

{ n: '巨石陣',
  // v1.257.0 整座重畫（見 開發筆記〈舊版 21 座重畫、偏白的 5 座調色〉）
  // 巨石陣（整座重畫）
  // 正面（−z，東北方，日出那一側）：外圈一排立石扛著連成一圈的楣石，中間冒出更高的三石塔，
  //   最前面是土堤的缺口、往外延伸的大道與孤零零的 Heel Stone
  // 側面：低矮的一圈（楣石頂高約外圈半徑的 0.4），三石塔往後（+z）一組比一組高（0.47／0.53／0.60），
  //   土堤是貼地的一圈，前面拖出大道
  // 三樣識別物：外圈立石＋上方連成一圈的楣石、內圈開口朝前的馬蹄形五組三石塔（最後面那組最高）、
  //   外面那一圈土堤與壕溝＋大道上的 Heel Stone
  // 部件：外圈立石(極座標) 楣石環(極座標) 缺掉的立石與倒下的立石/楣石 五組三石塔(轉角度的長方體)
  //   藍砂岩圈 藍砂岩馬蹄 祭壇石 土堤(兩層：草頂＋土側) 壕溝 東北缺口 大道(兩道矮堤＋溝)
  //   Heel Stone(limb) 屠宰石 站石
  lo: 4, hi: 29,
  pal: [0x7f7a6e,   // 0 砂岩（中灰，主色）
        0x5d5951,   // 1 砂岩（暗一階：風化、陰影面、貼地那一層）
        0x9d978a,   // 2 砂岩（亮一階：被太陽曬白的石面、楣石頂）
        0x9a9a48,   // 3 地衣的黃綠斑點
        0x56657a,   // 4 藍砂岩（bluestone，偏藍的灰）
        0x4f7a2c,   // 5 土堤與大道的草
        0x5e4631],  // 6 壕溝與土堤側面的土
  gen(v, s) {
    const TAU = Math.PI * 2;
    const R = s;                                       // 外圈立石的中線半徑（不取整，塊數才連續）
    const hsh = (x, y, z) => {
      let h = (x * 73856093) ^ (y * 19349663) ^ (z * 83492791);
      h = (h ^ (h >>> 13)) * 1274126177;
      return ((h ^ (h >>> 16)) >>> 0) % 100;
    };
    /* 石頭一邊蓋一邊挑色：每一塊石頭有自己的底色（tone 0/1/2），上面再撒深淺斑與地衣。
       一塊一個底色，遠看才分得出是一顆一顆的石頭，而不是一圈灰色的布。 */
    const pick = (x, y, z, tone) => {
      x = Math.round(x); z = Math.round(z);
      const k = hsh(x, y, z);
      if (y > 0 && k < 7) return 3;                    // 地衣
      if (y === 0 && k < 55) return 1;                 // 貼地那層沾了土，偏暗
      if (k < 22) return (tone + 1 + (k & 1)) % 3;     // 斑駁
      return tone;
    };
    const sbox = (w, x0, y0, z0, wd, ht, dp, tone) => {
      wd = Math.max(1, Math.round(wd)); ht = Math.max(1, Math.round(ht)); dp = Math.max(1, Math.round(dp));
      const hx = (wd - 1) / 2, hz = (dp - 1) / 2;
      for (let y = 0; y < ht; y++) for (let i = 0; i < wd; i++) for (let k = 0; k < dp; k++) {
        const x = x0 - hx + i, z = z0 - hz + k;
        w.set(x, y0 + y, z, pick(x, y0 + y, z, tone));
      }
    };
    const toneOf = i => [0, 2, 0, 1, 2, 0, 1, 0, 2, 1][((i % 10) + 10) % 10];

    // ── 尺寸 ─────────────────────────────────────────────
    const N = Math.max(10, Math.min(30, Math.round(TAU * R / 2.95)));   // 外圈立石數（真的是 30）
    const th = Math.max(1.25, R * 0.12);              // 立石的徑向厚度
    const sw = 0.55;                                  // 一個間距裡石頭佔的比例（真的約 2.1 m 石、1.2 m 縫）
    const h = dim(s, 0.33, 3);                        // 外圈立石高
    const lh = dim(s, 0.075, 1);                      // 楣石厚
    const rk = R * 1.45;                              // 土堤中線半徑（真的約 3.3 倍，壓近一點）
    const bkW = Math.max(2.2, R * 0.14);              // 土堤寬
    const bkH = dim(s, 0.10, 2);                      // 土堤高
    const dW = Math.max(1.4, R * 0.09);               // 壕溝寬
    const rd = rk + bkW / 2 + dW / 2;                 // 壕溝中線
    const ea = 0.16;                                  // 東北缺口的半角（弧度）

    /* 方位：α 從正面（−z）起算，往 +x 轉為正；q = α/TAU 落在 0~1，0 是正面、0.5 是背面。
       真的巨石陣西南面（背面）缺得最兇，東北面（正面）的楣石還連成一長串。 */
    const angOf = (x, z) => { let a = Math.atan2(x, -z); if (a < 0) a += TAU; return a; };
    const qOf = i => (((i % N) + N) % N) / N;
    const upright = i => {
      const q = qOf(i);
      if (q > 0.40 && q < 0.62) return (i % 3) === 1;                  // 背面只剩三分之一
      if (Math.abs(q - 0.27) < 0.5 / N || Math.abs(q - 0.78) < 0.5 / N) return false;
      return true;
    };
    const lintel = j => {
      if (!upright(j) || !upright(j + 1)) return false;
      const q = qOf(j);
      if (q > 0.33 && q < 0.69) return false;                          // 背面半圈的楣石都掉了
      return true;
    };

    // ── 1. 外圈立石＋楣石環（極座標一格一格判） ──────────────
    const n1 = Math.ceil(R + th);
    for (let x = -n1; x <= n1; x++) for (let z = -n1; z <= n1; z++) {
      const d = Math.sqrt(x * x + z * z);             // 不用 Math.hypot：慢一個數量級，fitScale 每試一個 s 都跑一遍
      if (Math.abs(d - R) > th / 2) continue;
      const u = angOf(x, z) / TAU * N;
      const i = Math.round(u), f = u - i;
      if (Math.abs(f) <= sw / 2 && upright(i))
        for (let y = 0; y < h; y++) v.set(x, y, z, pick(x, y, z, toneOf(i)));
      const j = Math.floor(u);
      if (lintel(j)) {
        const tn = toneOf(j + 3) === 1 ? 0 : 2;       // 楣石頂偏亮，一段一個色
        for (let y = h; y < h + lh; y++) v.set(x, y, z, pick(x, y, z, tn));
      }
    }

    // ── 2. 倒下的石頭：背面缺口躺著一根立石、一根楣石 ─────────
    /* 轉了角度的長方體：(px, pz) 是中心，長軸 u 是 +x 往 +z 轉 ang（跟 stampY 同向）。
       每一格拿中心點轉回去判在不在裡面——stampY 每呼叫一次就開一份暫存畫布再正反各轉一趟，
       七組石頭在 9000 那一檔吃掉整支 gen 一半的時間（fitScale 每試一個 s 就跑一次）。 */
    const obox = (px, pz, ang, L, D, y0, H, tone) => {
      L = Math.max(1, Math.round(L)); D = Math.max(1, Math.round(D)); H = Math.max(1, Math.round(H));
      const ca = Math.cos(ang), sa = Math.sin(ang), hu = L / 2, hw = D / 2;
      const ex = Math.ceil(Math.abs(ca) * hu + Math.abs(sa) * hw), ez = Math.ceil(Math.abs(sa) * hu + Math.abs(ca) * hw);
      for (let x = Math.floor(px - ex); x <= Math.ceil(px + ex); x++)
        for (let z = Math.floor(pz - ez); z <= Math.ceil(pz + ez); z++) {
          const dx = x - px, dz = z - pz;
          if (Math.abs(dx * ca + dz * sa) > hu || Math.abs(-dx * sa + dz * ca) > hw) continue;
          for (let y = y0; y < y0 + H; y++) v.set(x, y, z, pick(x, y, z, tone));
        }
    };
    const fallen = (q, rr, along, tone, len, wd, ht) => {
      const a = q * TAU, px = Math.sin(a) * rr, pz = -Math.cos(a) * rr;
      obox(px, pz, a + (along ? Math.PI / 2 : 0), len, wd, 0, ht, tone);   // 沿切線＝轉 α；沿半徑再加 90 度
    };
    const pitch = TAU * R / N;
    fallen(0.47, R - h * 0.55, true, 1, h, Math.max(2, pitch * sw), Math.max(1, Math.round(th * 0.7)));    // 往內倒的立石
    fallen(0.56, R + 2.2, false, 2, Math.max(3, pitch * 1.6), Math.max(1, th * 0.8), lh);               // 掉在外面的楣石

    // ── 3. 馬蹄形五組三石塔（開口朝正面，最後面那組最高） ──────
    const uw = Math.max(1.6, R * 0.15), ut = Math.max(1.6, R * 0.13), gap = Math.max(1, Math.round(R * 0.05));
    const tl = dim(s, 0.08, 1);
    const tri = [[0, 0.60, 0.50], [0.95, 0.53, 0.47], [-0.95, 0.53, 0.47], [1.95, 0.47, 0.44], [-1.95, 0.47, 0.44]];
    tri.forEach(([b, hk, rr], k) => {
      const px = Math.sin(b) * R * rr * 0.86, pz = Math.cos(b) * R * rr;
      const H = dim(s, hk, 4);
      const tn = [2, 0, 0, 2, 1][k];
      const ang = -b, ca = Math.cos(ang), sa = Math.sin(ang);      // 面朝圓心：長軸沿切線
      const off = (gap + Math.round(uw)) / 2;
      obox(px - ca * off, pz - sa * off, ang, uw, ut, 0, H, tn);
      obox(px + ca * off, pz + sa * off, ang, uw, ut, 0, H, (tn + 1) % 3);
      obox(px, pz, ang, Math.round(uw) * 2 + gap, ut, H, tl, 2);
    });

    // ── 4. 藍砂岩：外圈與三石塔之間一圈小石、三石塔裡面一道馬蹄 ───
    const rb = R * 0.72, nb = Math.max(8, Math.round(TAU * rb / 2.4));
    const hb = dim(s, 0.17, 2), bw = R >= 20 ? 2 : 1;
    ringOf(v, nb, rb, (w, x, z, a, i) => {
      const k = hsh(i, 7, 3);
      if (k < 30) return;                                       // 缺了三成
      w.box(Math.round(x), 0, Math.round(z), bw, k < 45 ? 1 : hb, bw, 4);   // 有的只剩殘樁
    }, 0, 0, 0.13);
    const nh = Math.max(5, Math.round(R * 0.75)), hb2 = dim(s, 0.25, 2);
    ringOf(v, nh, 1, (w, x, z, a, i) => {
      const bx = Math.sin(a) * R * 0.25, bz = Math.cos(a) * R * 0.31;
      w.box(Math.round(bx), 0, Math.round(bz), 1, i % 4 === 2 ? Math.max(1, hb2 - 1) : hb2, 1, 4);
    }, 0, 0, -2.15, 4.3);

    // ── 5. 祭壇石：最高那組三石塔前面平躺的一塊 ───────────────
    sbox(v, 0, 0, Math.round(R * 0.2), dim(s, 0.30, 3), 1, Math.max(1, Math.round(R * 0.07)), 2);

    // ── 6. 土堤＋壕溝（正面留東北缺口） ──────────────────────
    const n2 = Math.ceil(rd + dW);
    for (let x = -n2; x <= n2; x++) for (let z = -n2; z <= n2; z++) {
      const d = Math.sqrt(x * x + z * z);
      if (d < rk - bkW / 2 - 0.5 || d > rd + dW / 2) continue;
      let a = angOf(x, z); if (a > Math.PI) a -= TAU;
      if (Math.abs(a) < ea) continue;
      const e = Math.abs(d - rk);
      if (e <= bkW / 2) {
        const top = e < bkW * 0.28 ? bkH : Math.max(1, bkH - 1);       // 中間高、兩肩低
        for (let y = 0; y < top; y++) v.set(x, y, z, y === top - 1 ? 5 : 6);   // 草頂、土側
      } else if (Math.abs(d - rd) <= dW / 2) {
        v.set(x, 0, z, hsh(x, 0, z) < 7 ? 5 : 6);                    // 壕溝：翻起來的土，零星長了草
      }
    }

    // ── 7. 大道：從缺口往東北拉出去的兩道矮堤，外側各一條溝 ─────
    const aw = Math.max(2, Math.round(R * 0.36));
    const z0 = -Math.round(rk - 1), z1 = -Math.round(rk + R * 0.78);
    mirrorX(v, aw, (w, dx) => {
      for (let z = z1; z <= z0; z++) {
        w.set(dx, 0, z, 5);
        w.set(dx + Math.sign(dx), 0, z, 6);
      }
    });

    // ── 8. Heel Stone：大道上、偏一邊，一顆沒修整過的歪斜巨石 ───
    const hz = -(rk + R * 0.34), hx = R * 0.1, hr = Math.max(1.1, R * 0.1), hy = R * 0.32;
    limb(v, { x: hx, y: 0, z: hz, x1: hx + R * 0.04, y1: hy, z1: hz + R * 0.09, r: hr * 1.1, r1: hr * 0.75, c: 1 });
    for (let x = Math.floor(hx - hr * 1.1 - 1); x <= Math.ceil(hx + hr * 1.1 + R * 0.04 + 1); x++)
      for (let y = 0; y <= Math.ceil(hy + hr); y++)
        for (let z = Math.floor(hz - hr * 1.1 - 1); z <= Math.ceil(hz + R * 0.09 + hr * 1.1 + 1); z++)
          if (v.has(x, y, z)) v.set(x, y, z, pick(x, y, z, 1));
    // 屠宰石：缺口裡平躺的一塊
    sbox(v, -R * 0.12, 0, -(rk - 0.3), Math.max(2, R * 0.12), 1, Math.max(3, R * 0.26), 1);
    // 站石：土堤內緣兩顆小石
    for (const q of [0.20, 0.70]) {
      const a = q * TAU, rr = rk - bkW / 2 - 1.2;
      v.box(Math.round(Math.sin(a) * rr), 0, Math.round(-Math.cos(a) * rr), 1, Math.max(2, hb), 1, 1);
    }
  } },

{ n: '復活節島摩艾', lo: 5, hi: 34,
  // v1.285.0 整座重畫（見 開發筆記〈還很粗糙的七座重畫〉）
  // 阿胡湯加里基（Ahu Tongariki）整座重畫
  // 正面（−z，內陸那一側）：一條長長的低石台上一排 15 尊摩艾，高矮不一、一尊一尊分得開；
  //   每尊是「大頭＋短身」，臉上壓著一條眉骨、底下兩個深色眼窩、中間一條長鼻子；第二尊（畫面右邊數來）戴紅帽
  // 側面：背面一條直線，臉那一側三段往前突——眉骨、鼻頭、下巴，中間夾著鼻根與嘴唇兩個凹口；
  //   下巴底下縮回脖子，胸口比臉薄、肚子微鼓；石台前面拖一段鋪圓石的緩坡
  // 三樣識別物：一排 15 尊大頭石像（頭佔五分之三）、眉骨／長鼻／方下巴的側面輪廓、一尊頭上的紅色圓柱帽 pukao
  // 部件（人像六層）：
  //   著地　石台 ahu（背面砌整齊的石板牆、頂面鋪石、兩端低一階的翼）、正面鋪圓石的緩坡
  //   姿勢　15 尊並排站直、面向內陸，高矮照一張表
  //   軀幹　在臀部截斷的短身、微鼓的肚子、往下收的肩、喉嚨的凹口
  //   四肢　手臂淺浮雕貼在身體兩側（側面一道深色溝）、長手指在肚子前相合（一條亮帶＋上緣一道溝）
  //   頭與五官　下巴、嘴唇（深色一條）、鼻頭（大尊鼻翼外張）、鼻樑、深色眼窩、眉骨、往後收的額頭、長耳朵
  //   識別物　紅色 pukao（帽頂一顆小鈕）、平台前地上躺著的幾顆 pukao、凝灰岩的深淺與黃色地衣斑
  pal: [0x6f675b,   // 0 凝灰岩（本色，灰褐）
        0x544d44,   // 1 凝灰岩（暗一階：陰影、溝、嘴）
        0x8b8273,   // 2 凝灰岩（亮一階：風化發白的面、手指）
        0x9c8b4a,   // 3 黃色地衣斑
        0x2b2723,   // 4 眼窩的深色
        0x8e3b26,   // 5 pukao 紅色火山渣
        0x4a4a4c,   // 6 石台的玄武岩（深灰）
        0x77736c],  // 7 緩坡的圓石、石台石板的亮面
  gen(v, s) {
    const hsh = (x, y, z) => {
      let h = (x * 73856093) ^ (y * 19349663) ^ (z * 83492791);
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return ((h ^ (h >>> 16)) >>> 0) % 100;
    };
    // 凝灰岩一邊蓋一邊挑色：每尊一個底色（tone），上面撒少量深淺斑與地衣——
    // 相鄰兩尊底色不同，遠看才分得出是一尊一尊；斑撒太密的話臉上的眼窩、嘴縫會被吃掉
    const tuff = (x, y, z, bt) => {
      const k = hsh(x, y, z);
      if (k < 4) return 3;
      if (k < 14) return (bt + 1 + (k & 1)) % 3;
      return bt;
    };

    // ── 尺寸 ─────────────────────────────────────────────
    /* 15 尊的身高係數（由 −x 端排起；站在正面看 −x 在畫面右邊）。實物約 5.6～8.7 m，
       戴帽那尊在畫面右邊數來第二尊（i = 1），身子矮一截、帽子補回來。
       +x 那一端（右側視圖、45° 視圖最近的那一尊）給高的：側面看到的就是它一整個輪廓，
       矮的話後面幾尊的頭從它頭上冒出來，輪廓疊成一團 */
    const SC = [0.84, 0.74, 0.90, 0.80, 0.95, 0.86, 0.78, 1.00, 0.88, 0.82, 0.92, 0.76, 0.84, 0.90, 0.97];
    // 胖瘦：正中最高那尊是島上立起來最重的一尊（86 噸），特別壯
    const WF = [1.0, 1.0, 0.95, 1.0, 1.0, 0.95, 1.0, 1.12, 1.0, 0.95, 1.05, 1.0, 0.95, 1.0, 1.0];
    const TONE = [0, 2, 0, 1, 2, 0, 1, 0, 2, 0, 1, 2, 0, 2, 1];
    const HAT = 1;
    const tipOf = h => h >= 17 ? 3 : h >= 8 ? 2 : 1;                 // 鼻頭比臉頰多突幾格
    const Hs = SC.map(f => dim(s, f, 6));                            // 每尊身高（s 就是最高那尊的身高）
    const Ws = Hs.map((h, i) => Math.max(3, Math.round(h * 0.36 * WF[i])));   // 寬：實物約 0.35～0.4
    const Fs = Hs.map(h => Math.max(3, Math.round(h * 0.30)));       // 臉頰那一面離背面幾格
    const Ds = Hs.map((h, i) => Fs[i] + tipOf(h));                   // 最前面（鼻頭）離背面幾格
    /* 像與像之間的空隙：至少 1 格，頭才一顆一顆分得開。實物的空隙比這寬得多（約半個像寬），
       但 1800 那一檔場地上限 65，15 尊排下來長度已經 64，空隙只能壓到 1 格（9000 那一檔才長到 2） */
    const g = dim(s, 0.09, 1);
    let rowLen = g * 14;
    for (const w of Ws) rowLen += w;
    const P = dim(s, 0.17, 2);                                       // 石台高
    const mx = dim(s, 0.22, 2);                                      // 兩端多出去的翼（實物連翼 220 m，這裡只留一小截）
    const rr = dim(s, 0.08, 1);                                      // 緩坡每降一層往前幾格
    let Dmax = 0;
    for (const d of Ds) Dmax = Math.max(Dmax, d);
    const zb = 0, zr = 1, zf = zb - Dmax;                            // 雕像背面 zb、石台背面 zr、石台正面 zf
    const xL = -Math.floor(rowLen / 2) - mx, xR = xL + rowLen - 1 + 2 * mx;

    // ── 1. 石台 ahu：背面是一塊一塊砌齊的石板，頂面鋪石，兩端低一階當翼 ──
    /* 只蓋頂面與四面牆、裡面是空的：石台是整座最長的東西。第一版實心石台＋寬緩坡在 3000 那一檔
       吃掉四成五（1282／2875），雕像只剩 9～12 格高、臉刻不出來；改空心、緩坡收窄後降到三成三 */
    for (let x = xL; x <= xR; x++) {
      const wing = x < xL + mx || x > xR - mx;
      const ph = wing ? Math.max(1, P - 1) : P;
      const xe = x === xL || x === xR || x === xL + mx || x === xR - mx;
      for (let y = 0; y < ph; y++) for (let z = zf; z <= zr; z++) {
        if (y < ph - 1 && !xe && z !== zf && z !== zr) continue;
        let c = 6;
        if (z === zr) {                                              // 背牆：錯縫的石板，一塊一個色
          const slab = Math.floor((x + (y & 1) * 2) / 3);
          c = hsh(slab, y, 11) < 45 ? 7 : 6;
        } else if (y === ph - 1) c = hsh(x, y, z) < 22 ? 7 : 6;      // 頂面鋪石
        v.set(x, y, z, c);
      }
    }

    // ── 2. 正面鋪圓石的緩坡：一層一層往前多鋪 rr 格 ──
    for (let y = 0; y < P; y++) {
      const dz = rr * (P - y);
      for (let x = xL + mx; x <= xR - mx; x++)
        for (let z = zf - dz; z < zf; z++) v.set(x, y, z, hsh(x, y, z) < 62 ? 7 : 6);
    }

    // ── 3. 摩艾：同一支函式畫，吃身高；一列一列照側面輪廓給深度 ──
    /* 頭佔五分之三，頭裡由下往上分六段：下巴、嘴唇、鼻頭、鼻樑＋眼窩、眉骨、額頭。
       列數用「每段至少 1 列、餘數照比例分」去切——照 t = y/H 取樣的話，眉骨那一段只有 0.06 個身高，
       某些尺寸會剛好落在兩列中間整段不見。頭太矮（< 6 列）先拿掉嘴唇、鼻樑兩段。 */
    const ZF = [0.14, 0.11, 0.13, 0.27, 0.12, 0.23];
    const zones = hh => {
      const on = hh >= 6 ? [1, 1, 1, 1, 1, 1] : hh === 5 ? [1, 0, 1, 1, 1, 1] : [1, 0, 1, 0, 1, 1];
      const n = on.slice();
      let left = hh - n.reduce((a, b) => a + b, 0);
      while (left-- > 0) {
        let bi = 0, bv = -1e9;
        for (let i = 0; i < 6; i++) if (on[i] && ZF[i] * hh - n[i] > bv) { bv = ZF[i] * hh - n[i]; bi = i; }
        n[bi]++;
      }
      const rows = [];
      for (let z = 0; z < 6; z++) for (let r = 0; r < n[z]; r++) rows.push([z, r, n[z]]);
      return rows;
    };
    const moai = (xa, w, H, F, bt, hat) => {
      /* 側面輪廓：胸口（T）比臉頰那一面（F）薄一截，下巴、鼻頭、眉骨再各往前突——
         胸口跟臉一樣厚的話，側面看就是一根上下一樣粗的木樁 */
      const T = Math.max(2, Math.round(H * 0.21));
      const tipOut = tipOf(H), chinOut = H >= 17 ? 2 : 1;
      const hh = Math.max(4, Math.round(H * 0.58)), tr = H - hh;      // 頭的列數、身體的列數
      const rows = zones(hh);
      const hasMid = rows.some(q => q[0] === 3);
      const y0 = P;
      const mid = (w - 1) / 2, narrow = w >= 5;
      const coreW = narrow ? w - 2 : w;                               // 臉的寬（寬的那幾尊兩側讓給耳朵）
      const earD = Math.max(1, Math.round(F * 0.45));
      const hr = Math.max(0, Math.round(tr * 0.22));                  // 手指相合的那一列
      const ka = Math.max(1, Math.round(T * 0.5));                    // 手臂後緣那道溝離背面幾格
      const mc = bt === 1 ? 4 : 1;                                    // 嘴縫：底色本來就暗的那幾尊用更深的
      for (let j = 0; j < H; j++) {
        const y = y0 + j;
        for (let i = 0; i < w; i++) {
          const x = xa + i, dx = Math.abs(i - mid), edge = i === 0 || i === w - 1;
          let d, k0 = 0, fc = -1, sideK = -1, head = false;
          if (j < tr) {                                               // 身體
            d = T;
            if (j <= hr && H >= 12) d++;                              // 肚子（手放的地方）微鼓
            if (edge && w >= 5) d--;                                  // 前面兩角削圓
            if (j === tr - 1 && tr >= 3) {                            // 喉嚨凹口＋往下收的肩
              if (T >= 3 && !edge) d--;
              if (edge && w >= 4) k0 = 1;
            }
            if (j === hr) fc = dx < 0.6 ? 1 : 2;                      // 長手指在肚子前相合
            else if (j === hr + 1 && dx >= 0.6 && !edge) fc = 1;      // 前臂上緣的溝
            if (edge && j > hr && j < tr - 1) sideK = ka;             // 手臂後緣：側面一道深色直溝
          } else {
            const [zo, r, n] = rows[j - tr];
            head = true;
            if (narrow && edge) {
              /* 頭最外那一欄：耳朵從下巴（耳垂）長到眉骨，貼在頭兩側偏後；額頭那幾列是頭的側面，跟耳朵一樣寬——
                 額頭也縮進去的話頭頂變成圓的，正面看是一排鬼，不是平頂的方頭 */
              if (zo === 5) { d = r === 0 ? F - 1 : F - 2; if (r === n - 1 && H >= 12) k0 = 1; }
              else { d = earD + 1; k0 = 1; if (zo === 0 && r === 0) d = earD; else fc = 1; }   // 耳朵前緣一道暗色，把臉框出來
            } else {
              const nose = dx < 0.6, cedge = dx > (coreW - 1) / 2 - 0.1;
              const eyeOk = !nose && !(cedge && coreW >= 7);          // 眼窩：鼻子以外整片挖；臉很寬時最外那一欄留給顴骨
              if (!narrow && edge && zo >= 0 && zo <= 4) sideK = earD + 1;   // 窄的那幾尊：耳朵畫在側面
              switch (zo) {
                case 0: d = cedge && coreW >= 3 ? F : F + chinOut; break;     // 下巴：中間往前突
                case 1:                                               // 嘴唇＋嘴縫（跟鼻翼一樣寬的一條深色）
                  d = F;
                  if ((n === 1 || r === n - 1) && dx < (coreW >= 5 ? 1.6 : 0.6)) fc = mc;
                  break;
                case 2:                                               // 鼻頭（大尊鼻翼外張，鼻翼比鼻尖退一格）
                  if (nose) d = F + tipOut;
                  else if (coreW >= 5 && dx < 1.6) d = F + tipOut - (H >= 14 ? 1 : 0);
                  else if (!hasMid && eyeOk) { d = F - 1; fc = 4; }  // 頭太矮沒有鼻樑段：眼窩落在這一列
                  else d = F;
                  break;
                case 3: {                                             // 鼻樑＋眼窩
                  const ne = Math.max(1, Math.ceil(n * 0.6));
                  if (nose) { d = F + 1 + (H >= 16 && r < n / 2 ? 1 : 0); fc = 2; }   // 鼻樑亮一階，夾在兩個眼窩中間才跳得出來
                  else if (r >= n - ne && eyeOk) { d = F - (H >= 14 ? 2 : 1); fc = 4; }
                  else d = F;
                  break;
                }
                case 4: d = cedge && coreW >= 7 ? F : F + 1; break;  // 眉骨：橫過整張臉往前突
                default:                                              // 額頭往後收、頭頂後緣削圓
                  d = r === 0 ? F : F - 1;
                  if (r === n - 1 && H >= 12) k0 = 1;
              }
            }
          }
          for (let k = k0; k < d; k++) {
            const z = zb - k;
            let c = tuff(x, y, z, bt);
            if (k === d - 1 && fc >= 0) c = fc;
            else if (k === sideK) c = 1;
            else if (head && k === d - 1 && c !== 3) c = bt;          // 臉上不撒深淺斑（只留地衣），五官才不會被吃掉
            v.set(x, y, z, c);
          }
        }
      }
      if (hat) {                                                      // 紅色 pukao：跟頭頂差不多寬的圓柱，帽頂一顆小鈕
        /* 半徑跟著整個頭頂寬（含兩側耳朵那一欄）：只跟臉寬的話寬的那幾尊帽子比頭窄一圈；
           再寬半格就在正中間多凸出一格，從正面看成一頂十字形的草帽 */
        const xc = xa + mid, zc = zb - (F - 1) / 2, r0 = w / 2 - 0.1;
        const ph = Math.max(2, Math.round(H * 0.28)), yt = y0 + H;
        const R = Math.ceil(r0) + 1;
        for (let x = Math.floor(xc - R); x <= Math.ceil(xc + R); x++)
          for (let z = Math.floor(zc - R); z <= Math.ceil(zc + R); z++) {
            const q = Math.sqrt((x - xc) * (x - xc) + (z - zc) * (z - zc));
            if (q <= r0 + 0.35) for (let y = yt; y < yt + ph; y++) v.set(x, y, z, 5);
            if (q <= r0 * 0.5 + 0.35) v.set(x, yt + ph, z, 5);
          }
      }
    };
    let xa = xL + mx;
    for (let i = 0; i < 15; i++) {
      moai(xa, Ws[i], Hs[i], Fs[i], TONE[i], i === HAT);
      xa += Ws[i] + g;
    }

    // ── 4. 平台前地上的 pukao（1960 年海嘯沖散的帽子）：兩顆正放的矮圓柱、一顆橫躺 ──
    /* 半徑避開 1.65～2.3 那一段：圓面算的是「離中心 ≤ r ＋ 0.35」，r＋0.35 落在 2～2.24 之間時
       只收進正上下左右各一格尖、收不進 (2, 1)，圓面點陣成十字形（9000 那一檔原本 r 1.7 就是這樣）。
       小的取 3×3 方塊、大的取 5 格寬的圓，中心一律取整數 */
    let pr = s * 0.125;
    if (pr > 1.6 && pr < 2.3) pr = pr < 1.95 ? 1.6 : 2.3;
    pr = Math.max(1.1, pr);
    const ph = dim(s, 0.14, 2), pl = dim(s, 0.14, 2);
    const pz = zf - rr * P - 2 - Math.ceil(pr);
    const Lp = xR - xL, pr2 = (pr + 0.35) * (pr + 0.35), R = Math.ceil(pr + 0.35);
    for (const [fx, lie] of [[-0.30, false], [0.10, true], [0.33, false]]) {
      const cx = Math.round(xL + mx + (Lp - 2 * mx) * (0.5 + fx));
      if (!lie) { v.cyl(cx, 0, pz, pr, ph, 5); continue; }            // 正放：跟頭上那頂一樣的矮鼓
      /* 橫躺：圓面朝 ±x。圓心高度取「圓面往下真的收得到幾格」——用 round(pr) 的話 pr 1.56 會取 2、
         圓面只往下長 1 格，整顆浮在地上一格（3000 那一檔實測懸空 18 格） */
      const yc = Math.floor(pr + 0.35);
      for (let a = -R; a <= R; a++) for (let b = -R; b <= R; b++) {
        if (a * a + b * b > pr2 || yc + b < 0) continue;
        for (let l = 0; l < pl; l++) v.set(cx - (pl >> 1) + l, yc + b, pz + a, 5);
      }
    }
  } },
{ n: '獅身人面像',
  // v1.285.0 整座重畫（見 開發筆記〈還很粗糙的七座重畫〉）
  // 吉薩的人面獅身像（整座重畫）：照實物 73 m 長、20 m 高、19 m 寬，臉朝東＝正面 −z；現況石色，不上彩
  // 正面：平頂、兩翼往肩上撐開的頭巾罩著一張 4 m 寬的臉，兩片條紋垂飾垂到胸前；
  //   底下是比頭寬的胸與肩，兩隻前爪平行往前伸，中間夾一塊灰粉色的夢碑
  // 側面：低而長的伏臥獅身（背高約頭頂的 0.55），背平、臀部微微隆起，前爪往前平伸約 15 m；
  //   頭與粗脖子明顯冒出背上，身側一層一層的岩棚與風化溝，最下緣一圈整齊的修補石塊
  // 三樣識別物：條紋 nemes 頭巾（平頂＋撐開的兩翼＋垂飾）、往前平伸的兩隻前爪夾著夢碑、
  //   身側橫向的風化岩層（下段硬而深、中段被蝕凹進去、上段背脊受光）
  // 部件（動物六層）：
  //   著地：前爪（含趾縫）、後腳掌、腹底貼地（不加台基）
  //   姿勢：伏臥、頭朝正前方、前爪平伸、後腿收在身側
  //   軀幹：剖面表拉出的獅身（背平、腰略收、臀部隆起、臀尾收圓）、往前挺的胸、肩、粗脖子、後腿臀
  //   四肢與關節：肩→肘（肩的隆起）、肘→爪（前臂平伸）、後腿臀→後腳掌、繞過右臀的尾巴
  //   頭與五官：臉（下巴往後收一格）、耳朵、凹進去的眼窩、缺掉的鼻子（平的斷面）、嘴縫、聖蛇的斷痕
  //   衣物與識別物：nemes 頭頂平台、額上的頭帶、撐開的兩翼、披到背上的後擺、兩片垂飾、
  //     深淺兩階的橫條紋、頰上的紅色殘跡、風化溝與岩棚、下緣與爪子的修補石塊、夢碑
  lo: 3.0, hi: 26.0,
  pal: [0xae8a56,   // 0 石灰岩本色（獅身的主色）
        0x6f5638,   // 1 風化溝的暗面、頭巾深條紋、眼窩、嘴縫、尾巴
        0xcfac72,   // 2 亮面：背脊、頭與臉（上段硬岩）、頭巾淺條紋
        0x8f7552,   // 3 下段硬岩、修補石的接縫
        0xd0b88c,   // 4 後代修補的整齊石塊（偏淺）
        0xa0603f,   // 5 臉上偏紅的暖色殘跡
        0x8c7b7d],  // 6 夢碑的灰粉花崗岩
  gen(v, s) {
    const m = s * 0.1, M = q => q * m, R = Math.round;          // m：每公尺幾格（不取整，塊數才連續）
    const H = (x, y, z) => (((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) >>> 0) % 100;
    const lerpP = (P, t) => {
      if (t <= P[0][0]) return P[0][1];
      for (let i = 1; i < P.length; i++)
        if (t <= P[i][0]) { const a = P[i - 1], b = P[i]; return a[1] + (b[1] - a[1]) * (t - a[0]) / (b[0] - a[0]); }
      return P[P.length - 1][1];
    };

    /* ── 1. 獅身（含胸、肩、脖子、後腿臀）：先填一張佔位表，再挖成兩格厚的殼 ──
       z 以公尺計，0 是胸口、58 是臀尾；爪子另外往前伸 15 m。
       為什麼不直接疊 blob：幾顆橢球疊出來的是一團圓滾滾的塊（改前就是這樣），背不平、側面也刻不出岩層。
       改成每一格 z 查剖面表（背高、半寬），上緣倒圓角，岩層就是「某幾層整圈往內縮」。
       挖成殼是為了把塊數花在看得到的表面：實測填實心的話 3000 塊只有 51 格長、9000 塊 74 格，
       3000 那檔露在外面的只有 1245 格；挖空之後同樣塊數是 60、97 格長，露在外面 2637 格。
       佔位表一列一列用區間填（不逐格算橢球），9000 那檔才壓得進時限。 */
    const TOP = [[0, 7.5], [1.5, 10.0], [4, 11.2], [10, 11.6], [20, 11.0], [32, 10.5],
                 [41, 10.9], [47, 11.3], [52, 10.6], [55, 9.3], [57, 6.8], [58.3, 3.2]];
    /* 半寬：獅身要比頭巾寬（實物身寬約 19 m、頭巾約 10.5 m），俯視才是「身體比頭寬」。
       上一版半寬只給 6～6.6 m，加上中段內縮一格，俯視的軀幹比頭巾兩翼還窄，像一條長板 */
    const WID = [[0, 5.4], [1.5, 6.6], [4, 7.5], [10, 7.9], [20, 7.7], [30, 7.3],
                 [40, 7.6], [51, 7.4], [55, 6.5], [57, 5.0], [58.3, 2.8]];
    const zc = R(M(0)), zb0 = R(M(-1.6)), zb1 = R(M(58.3)), NZ = zb1 - zb0 + 1;   // zc 胸口；zb0 留給往前挺的胸
    const Tz = new Float64Array(NZ), Wz = new Float64Array(NZ);
    for (let i = 0; i < NZ; i++) {
      const zm = (zb0 + i) / m;
      Tz[i] = zb0 + i < zc ? -1 : M(lerpP(TOP, zm)); Wz[i] = M(lerpP(WID, zm));
    }
    const r0 = M(3.6);                          // 背脊兩側的圓角（獅背是寬而平的，不是圓筒）
    /* 岩層由下往上：修補石塊（yR 以下）→ 比較硬、比較深的下段（到 yM）→ 被蝕得最兇的中段
       （整圈往內縮一格，再一層一層刻出風化溝）→ 上段（yIII 以上，背脊與脖子）。
       中段縮進去、上段沒縮，從側面看就是一條一條往外凸的岩棚。 */
    const yR = Math.max(1, R(M(2.4)));
    const yM = Math.max(yR + 1, R(M(4.0)));
    const yIII = Math.max(yM + 2, R(M(9.0)));
    const P = Math.max(2, R(M(2.1)));           // 風化溝的間距
    const groove = y => y > yM && y < yIII && (y - yM) % P === P - 1;
    const inset = y => (y >= yM && y < yIII ? 1 : 0) + (groove(y) ? 1 : 0);
    const hx = M(7.0), hy = M(5.0), hz = M(46), hrx = M(2.7), hry = M(4.9), hrz = M(8.6);   // 後腿臀（最寬 9.7 m）
    const sx = M(6.8), sy = M(4.4), sz = M(6.5), srx = M(1.7), sry = M(4.2), srz = M(4.4);  // 肩
    const nkx = M(3.6), nkz = M(4.6), nkrz = M(4.4), nky0 = M(7), nky1 = M(14);            // 脖子
    const cy = M(4.6), cz = M(2.0), crx = M(5.4), cry = M(4.6), crz = M(3.1);              // 往前挺的胸
    const pad = 2, xm = Math.ceil(M(10)) + 1, NY = Math.ceil(M(14)) + 2;
    const NXp = 2 * xm + 1 + 2 * pad, NYp = NY + 2 * pad, SY = NXp, SZ = NXp * NYp;
    const occ = new Uint8Array(SZ * (NZ + 2 * pad));
    const rowOf = (y, z) => (z - zb0 + pad) * SZ + (y + pad) * SY + xm + pad;       // x = 0 那一格的索引
    const fill = (row, a, b) => { for (let x = Math.max(-xm, Math.ceil(a)), e = Math.min(xm, Math.floor(b)); x <= e; x++) occ[row + x] = 1; };
    for (let z = zb0; z <= zb1; z++) {
      const i = z - zb0, T = Tz[i], W = Wz[i], rr = Math.min(r0, T, W);
      for (let y = 0; y < NY; y++) {
        const g = groove(y) ? 1 : 0, row = rowOf(y, z);   // 風化溝那一層整圈往內縮一格
        if (y <= T) { const yy = y - (T - rr); const hw = yy > 0 ? W - rr + Math.sqrt(rr * rr - yy * yy) : W - inset(y); fill(row, -hw, hw); }
        let q = 1 - ((y - hy) / hry) ** 2 - ((z - hz) / (hrz - g)) ** 2;
        if (q >= 0) { const a = (hrx - g) * Math.sqrt(q); fill(row, hx - a, hx + a); fill(row, -hx - a, -hx + a); }
        q = 1 - ((y - sy) / sry) ** 2 - ((z - sz) / (srz - g)) ** 2;
        if (q >= 0) { const a = (srx - g) * Math.sqrt(q); fill(row, sx - a, sx + a); fill(row, -sx - a, -sx + a); }
        if (y >= nky0 && y <= nky1 && (q = 1 - ((z - nkz) / nkrz) ** 2) >= 0) { const a = nkx * Math.sqrt(q); fill(row, -a, a); }
        if ((q = 1 - ((y - cy) / cry) ** 2 - ((z - cz) / crz) ** 2) >= 0) { const a = crx * Math.sqrt(q); fill(row, -a, a); }
      }
    }
    const brick = (u, y) => ((u + ((y & 1) << 1)) & 3) === 0 ? 3 : 4;
    for (let z = zb0; z <= zb1; z++) for (let y = 0; y < NY; y++) {
      const row = rowOf(y, z);
      for (let x = -xm; x <= xm; x++) {
        const k = row + x;
        if (!occ[k]) continue;
        const ex = !occ[k - 1] || !occ[k + 1], ez = !occ[k - SZ] || !occ[k + SZ];
        const up = !occ[k + SY], dn = y > 0 && !occ[k - SY];
        if (!ex && !ez && !up && !dn && occ[k - 2] && occ[k + 2] && occ[k - 2 * SZ] && occ[k + 2 * SZ] && occ[k + 2 * SY])
          continue;                                                          // 殼裡面挖空
        const h = H(x, y, z);
        let c = 0;
        if (y < yR) c = ex ? brick(z, y) : ez ? brick(x, y) : 3;              // 下緣的修補石塊
        else if (ex || ez) c = groove(y) ? 1 : y >= yIII ? (h < 30 ? 0 : 2) : y < yM ? (h < 35 ? 0 : 3)
                             : h < 14 ? 2 : h < 22 ? 1 : 0;
        else if (up) c = h < 25 ? 0 : 2;                                       // 背脊受光
        v.set(x, y, z, c);
      }
    }

    // ── 2. 前腿與爪：從肘一路平伸到爪尖；後腳掌收在身側。整條包著修補石塊 ──
    const paw = (cx, zA, zB, hA, hB, w, tipLen, toes) => {
      for (let z = zA; z <= zB; z++) {
        const f = (z - zA) / Math.max(1, zB - zA), tp = (z - zA) / Math.max(1, tipLen);
        let hh = hA + (hB - hA) * f, ww = w;
        if (tp < 1) { const k = Math.sqrt(1 - (1 - tp) * (1 - tp)); hh *= 0.65 + 0.35 * k; ww *= 0.75 + 0.25 * k; }
        const top = Math.max(1, R(hh));
        for (let x = Math.ceil(cx - ww); x <= Math.floor(cx + ww); x++) {
          const edge = Math.abs(x - cx) > ww - 0.9 && ww >= 1.5;
          const toe = toes && tp < 2 && toes.indexOf(x) >= 0;
          const sd = Math.abs(x - cx) > ww - 1;
          for (let y = 0; y < top; y++) {
            if (y === top - 1 && (edge || toe) && top > 1) continue;            // 圓肩、趾縫
            v.set(x, y, z, sd ? brick(z, y) : y === top - 1 ? brick(z + x * 2, 0) : 3);
          }
        }
      }
    };
    const fw = M(2.2), fcx = M(4.3);              // 前腿在肩的正下方，兩爪內緣相距約 4.2 m（中間放夢碑）
    mirrorX(v, 1, (vv, sg) => {
      const cx = sg * fcx;
      const toes = fw >= 2.4 ? [-1, 0, 1].map(k => R(cx + k * fw * 0.5)) : null;
      paw(cx, R(M(-15)), R(M(7)), M(2.7), M(4.0), fw, M(1.4), toes);
      paw(sg * M(8.6), R(M(36.5)), R(M(49)), M(2.0), M(2.5), M(1.25), M(1.2), null);   // 後腳掌收在身側
    });

    /* ── 3. 頭：臉、頭巾、垂飾、耳朵 ──
       臉比實物（約 4 m）放寬到 4.9 m：照實寸 1800 那檔半寬 1.3 格、臉只有 3 格寬，眼睛落在臉的邊上；
       放寬後 1800／3000 那檔 5 格、9000 那檔 7 格。頭頂仍在 20 m，整座高度不變。
       臉往前凸出頭巾兩翼 2.3 m（約兩格），側面才看得到臉的側面與耳朵。 */
    const fz = R(M(-1.4)), fy0 = R(M(12.3)), fy1 = R(M(17.4)), fwh = M(2.45);
    const chinH = Math.max(1, R(M(0.9)));
    for (let y = fy0; y < fy1; y++) {
      const chin = y < fy0 + chinH, w = chin ? fwh - Math.max(0.5, M(0.6)) : fwh;
      for (let x = -R(w); x <= R(w); x++)                              // 半寬四捨五入：3000 那檔才是 5 格不是 3 格
        for (let z = chin ? fz + 1 : fz; z <= R(M(2.5)); z++) v.set(x, y, z, H(x, y, z) < 22 ? 0 : 2);
    }
    /* 頭巾 nemes 分三塊：
       ・頭殼與頭頂：頭頂平，額上一條素面頭帶
       ・後擺：固定寬度（±3.6 m）的一整片，從頭頂後緣沿一條直線斜到頸背、接上背脊
       ・兩翼：太陽穴往肩上撐開的薄片（只有 2.6 m 厚），貼在臉與耳朵後面
       上一版每一層各算寬度、兩翼一路延伸到後腦，從後面／45° 看是一疊逐層往後退又逐層變寬的盤子。
       現在後擺寬度不變、後緣是一條直線，條紋只換顏色，不改形狀。 */
    const ny0 = R(M(13.2)), nyC = fy1, nyT = Math.max(nyC + 2, R(M(20))), nyB = R(M(11.2));
    const sp = Math.max(1, R(M(0.75)));
    const stripe = y => (((nyT - y) / sp | 0) & 1) ? 1 : 2;
    const bandTop = nyC + Math.max(1, R(M(0.6)));
    const bh = M(3.6), wz0 = R(M(0.9)), wz1 = R(M(3.5));
    const zBack = y => R(M(5.4 + (20 - y / m) / 8.8 * 3.6));           // 頭頂 (z 5.4, 20 m) → 頸背 (z 9.0, 11.2 m)
    for (let y = nyB; y <= nyT; y++) {
      const crown = y >= nyC, wing = !crown && y >= ny0, zb = zBack(y);
      const hc = crown ? M(3.7) - (y - nyC) / Math.max(1, nyT - nyC) * M(0.4) : bh;
      const zf = crown ? R(M(-1.0)) : wing ? wz0 : zb - Math.max(2, R(M(2.6)));   // 頸背那段只要一片布的厚度
      for (let x = Math.ceil(-hc); x <= Math.floor(hc); x++)
        for (let z = zf; z <= zb; z++) {
          let c = stripe(y);
          if (y === nyT) c = H(x, y, z) < 20 ? 0 : 2;                     // 頭頂平台
          else if (crown && y < bandTop && z === zf) c = 2;              // 額上的頭帶
          v.set(x, y, z, c);
        }
      if (!wing) continue;
      const hw = M(5.4) - (y - ny0) / Math.max(1, nyC - ny0) * M(1.7);  // 兩翼：往下撐開到 ±5.4 m
      for (let x = Math.ceil(-hw); x <= Math.floor(hw); x++)
        if (Math.abs(x) > Math.floor(hc)) for (let z = wz0; z <= wz1; z++) v.set(x, y, z, stripe(y));
    }
    // 垂飾 lappets：從耳後垂到胸前，一樣是橫條紋
    const lw = Math.max(0.5, M(0.9)), lcx = M(3.6);
    mirrorX(v, 1, (vv, sg) => {
      for (let y = R(M(8.4)); y < ny0; y++)
        for (let x = Math.ceil(sg * lcx - lw); x <= Math.floor(sg * lcx + lw); x++)
          for (let z = R(M(-0.8)); z <= R(M(1.0)); z++) vv.set(x, y, z, stripe(y));
      blob(vv, sg * M(2.9), M(15.4), M(0.0), Math.max(0.7, M(0.6)), Math.max(1.0, M(0.9)), Math.max(0.7, M(0.8)), 2);  // 耳朵（約 1.4 m 高）
    });

    // ── 4. 五官：一律從頭裡往臉外找表面 ──
    const hcz = R(M(2)), nn = hcz - fz + 2;
    const ex = Math.max(1, R(M(1.1))), ey = R(M(16.0));
    mirrorX(v, ex, (vv, dx) => {                                         // 眼窩：往裡凹一格、塗暗
      if (vv.has(dx, ey, fz) && vv.has(dx, ey, fz + 1)) { vv.del(dx, ey, fz); tint(vv, dx, ey, fz + 1, 1); }
      else paintFrom(vv, dx, ey, hcz, 0, 0, -1, nn, 1);
    });
    for (let y = R(M(14.7)); y < ey; y++) paintFrom(v, 0, y, hcz, 0, 0, -1, nn, 0);        // 缺掉的鼻子：一片平的斷面
    const mw = Math.floor(M(1.15)), my = R(M(13.6));                 // 嘴寬約 2.3 m
    for (let x = -mw; x <= mw; x++) paintFrom(v, x, my, hcz, 0, 0, -1, nn, 1);             // 嘴縫
    /* 頰上的紅色殘跡：小尺寸時眼睛與嘴之間沒有空的一層，就退到嘴角兩邊（不然會蓋掉眼睛） */
    let ry = Math.max(my + 1, R(M(14.8))), rx = Math.max(1, R(M(1.6)));
    if (ry >= ey) { ry = my; rx = mw + 1; }
    mirrorX(v, rx, (vv, dx) => paintFrom(vv, dx, ry, hcz, 0, 0, -1, nn, 5));
    paintFrom(v, 0, Math.min(nyT - 1, R(M(17.9))), hcz, 0, 0, -1, nn + 2, 1);                // 聖蛇斷掉的痕

    // ── 5. 夢碑：兩爪中間、貼著胸口的花崗岩碑，頂端圓弧 ──
    const stW = dim(s, 0.24, 3, true), stH = dim(s, 0.36, 4), stT = Math.max(1, R(M(0.8)));
    const sh = (stW - 1) / 2, ys = Math.min(stH - 1, Math.max(0, R(cy)));
    const stZ = Math.min(zc, Math.ceil(cz - crz * Math.sqrt(Math.max(0, 1 - ((ys - cy) / cry) ** 2))));  // 胸口挺出來最前面那一格
    for (let y = 0; y < stH; y++) for (let x = -sh; x <= sh; x++) {
      if (y === stH - 1 && Math.abs(x) === sh && sh > 0) continue;
      for (let z = stZ - stT; z < stZ; z++) v.set(x, y, z, 6);
    }

    // ── 6. 尾巴：從臀尾貼地繞到右臀，尾端搭在臀側 ──
    /* 尾巴是淺浮雕，顏色跟身體一樣的話整條看不見（實測用 pal[3] 拍出來找不到），
       塗成風化溝那一階的暗色，斜斜一條才跟橫向的岩層分得開 */
    const tr = Math.max(0.8, M(0.6));
    const TP = [[1.5, 1.0, 58.0], [6.0, 1.0, 57.6], [9.0, 1.4, 54.5], [9.5, 2.8, 50.0], [9.8, 4.4, 45.0]];
    for (let i = 1; i < TP.length; i++)
      limb(v, { x: M(TP[i - 1][0]), y: M(TP[i - 1][1]), z: M(TP[i - 1][2]),
                x1: M(TP[i][0]), y1: M(TP[i][1]), z1: M(TP[i][2]), r: tr, c: 1 });
  } },
{ n: '聖巴索大教堂', lo: 2.2, hi: 14.0, pal: [0x9e2a2b, 0xf4f1de, 0x3a6b35, 0xe09f3e, 0x1d3557, 0x540b0e],
  /* 來源：AgentData/blueprints/聖巴索大教堂.js（v1.143 換掉原本那份）。dim 的下限一律乘 0.8（22 處）：原稿最小 2067 塊，面板的 1800 按下去等於沒反應。
     改完最小 1600、1800 那檔 1808、3000 那檔 3076，9000 那檔一格沒動（8856） */
  gen(v, s) {
    // === 1. 主要尺寸計算 (全部參數化) ===
    const baseW = dim(s, 3.4, 12, true);  // 總基座寬
    const baseH = dim(s, 0.45, 2);        // 基座高度
    
    // 中央主塔 (八角形/高聳帳篷頂)
    const cW = dim(s, 1.1, 4, true);      // 中央主塔寬度
    const cH = dim(s, 2.6, 7);            // 中央主塔牆高
    const spireH = dim(s, 1.8, 5);        // 帳篷頂尖高度
    
    // 四座大型側塔 (正前後左右)
    const tW = dim(s, 0.85, 2, true);     // 大側塔寬度
    const tH = dim(s, 1.7, 5);            // 大側塔牆高
    const tDist = Math.round(baseW * 0.28); // 大側塔離中心距離
    
    // 四座小型角塔 (對角線方位)
    const sW = dim(s, 0.65, 2, true);     // 小角塔寬度
    const sH = dim(s, 1.25, 3);           // 小角塔牆高
    const sDist = Math.round(baseW * 0.26); // 小角塔離中心距離
    
    const domeR = dim(s, 0.55, 2);        // 大洋蔥頂半徑
    const domeH = dim(s, 0.95, 2);        // 大洋蔥頂高度

    // === 2. 宏偉台基與台階 (底座層) ===
    v.box(0, 0, 0, baseW + 2, 1, baseW + 2, 1);
    v.box(0, 1, 0, baseW, baseH, baseW, 0);
    // 台基腰線分層
    v.box(0, 1 + baseH, 0, baseW + 1, 1, baseW + 1, 1);
    
    // 正面主入口台階 (朝 -z 方向)
    const stepW = dim(s, 0.8, 4, true);
    const stepN = dim(s, 0.35, 2);
    stairs(v, 0, 0, -Math.round(baseW / 2) - stepN + 1, stepN, stepW, '-z', 1);

    // === 3. 中央主塔 (高聳核心) ===
    const cY = 2 + baseH;
    // 主塔八角形身（以方塊交疊模擬）
    v.walls(0, cY, 0, cW, cH, cW, 0, 1);
    v.walls(0, cY, 0, cW - 2 > 0 ? cW - 2 : 1, cH, cW + 2, 0, 1);
    
    // 主塔立面白色裝飾與窗洞
    mirrorX(v, 0, (vv) => {
      windowGrid(vv, { x: 0, y: cY + 2, z: -Math.floor(cW / 2), cols: 1, rows: dim(s, 0.4, 2), stepY: 3, w: 1, h: 2, c: 5, axis: 'x' });
    });
    
    // 主塔簷口線腳
    v.box(0, cY + cH, 0, cW + 2, 1, cW + 2, 1);
    
    // 中央帳篷頂 (八角高尖錐)
    v.pyramid(0, cY + cH + 1, 0, cW + 2, 2, 1);
    const spireTopY = cY + cH + 1 + Math.floor((cW + 2) / 2);
    v.taper(0, spireTopY, 0, Math.max(1.5, cW * 0.4), 0.5, spireH, 3, 1);
    
    // 中央主塔金色頂飾洋蔥與十字架
    const cDomeY = spireTopY + spireH;
    v.onion(0, cDomeY, 0, Math.max(1.5, domeR * 0.8), Math.max(2, domeH * 0.8), 3);
    v.box(0, cDomeY + Math.max(2, domeH * 0.8), 0, 1, dim(s, 0.3, 2), 1, 3);

    // === 4. 四座大型側塔 (前後左右，色彩各異的洋蔥頭) ===
    const bigTowers = [
      { dx: 0, dz: -tDist, cRoof: 3, cAccent: 4 }, // 正前：金/藍相間
      { dx: 0, dz: tDist,  cRoof: 2, cAccent: 1 }, // 正後：綠/白相間
      { dx: -tDist, dz: 0, cRoof: 0, cAccent: 1 }, // 正左：紅/白螺旋
      { dx: tDist,  dz: 0, cRoof: 4, cAccent: 3 }  // 正右：藍/金相間
    ];

    bigTowers.forEach(t => {
      // 側塔基座與牆身
      v.walls(t.dx, cY, t.dz, tW, tH, tW, 0, 1);
      // 白色簷口與壁柱修飾
      v.box(t.dx, cY + tH, t.dz, tW + 2, 1, tW + 2, 1);
      // 洋蔥頂下方拱形過渡鼓座 (Tambour)
      v.cyl(t.dx, cY + tH + 1, t.dz, Math.max(1, Math.floor(tW / 2)), 2, 1, 1);
      
      // 標誌性洋蔥圓頂
      const bDomeY = cY + tH + 3;
      v.onion(t.dx, bDomeY, t.dz, domeR, domeH, t.cRoof);
      
      // 洋蔥頂條紋彩繪 (使用 tint 上色避免懸空格)
      for (let oy = 0; oy < domeH; oy++) {
        tint(v, t.dx + 1, bDomeY + oy, t.dz, t.cAccent);
        tint(v, t.dx - 1, bDomeY + oy, t.dz, t.cAccent);
      }
      
      // 頂部小金色十字架
      v.box(t.dx, bDomeY + domeH, t.dz, 1, dim(s, 0.25, 2), 1, 3);
    });

    // === 5. 四座小型角塔 (對角線方位，俄式星形交錯) ===
    corners4(v, sDist, sDist, (vv, x, z) => {
      // 小角塔牆身
      vv.walls(x, cY, z, sW, sH, sW, 0, 1);
      // 簷口
      vv.box(x, cY + sH, z, sW + 1, 1, sW + 1, 1);
      // 小型多棱洋蔥頭 (綠金相間)
      const sDomeY = cY + sH + 1;
      vv.onion(x, sDomeY, z, Math.max(1.2, domeR * 0.7), Math.max(2, domeH * 0.7), 2);
      vv.box(x, sDomeY + Math.max(2, domeH * 0.7), z, 1, 1, 1, 3);
    });

    // === 6. 迴廊拱門與入口山形雨遮 ===
    // 前方入口拱門門廳
    const porchZ = -Math.round(baseW / 2) + 1;
    arch(v, 0, cY, porchZ, dim(s, 0.4, 2, true), dim(s, 0.45, 2), 1, 1);
    v.box(0, cY, porchZ + 1, dim(s, 0.4, 2, true), dim(s, 0.45, 2) + 1, 1, 5); // 內門
    v.gable(0, cY + dim(s, 0.5, 2), porchZ, dim(s, 0.6, 4, true), 2, 2);     // 門廳三角山牆
  } },

{ n: '聖家堂', lo: 2.4, hi: 10.5,
  // v1.285.0 整座重畫（見 開發筆記〈還很粗糙的七座重畫〉）
  pal: [0xae9a7a,   // 0 砂岩（主殿、翼廊、受難立面與它的四座鐘樓）
        0x7a6650,   // 1 舊砂岩（誕生立面與它的四座鐘樓：最早蓋、風化偏褐偏暗）；側廊屋頂那條腰線
        0xd6d0c4,   // 2 新石材的淺白（中央六塔：耶穌塔、福音書作者塔、聖母塔）、尖頂飾的白、十字架
        0x35302b,   // 3 開口（鐘樓螺旋開口、大門、窗）
        0xb83a2e,   // 4 紅馬賽克（尖頂飾、主殿果實尖塔）
        0xe0a82e,   // 5 黃／金（尖頂飾、福音書作者象徵物、後殿小尖塔）
        0x3d7034,   // 6 柏樹綠
        0xa9d4ea],  // 7 淡藍（聖母塔的星、中央塔燈籠的玻璃）
  gen(v, s) {
    // 正面（−z，誕生立面）：四根拋物線收尖的紡錘鐘樓一字排開（中間兩根較高），塔腳之間三座暗色尖拱門，
    //   正中那座最高、門頂山牆上一棵綠柏樹；鐘樓後面是一叢更高的淺色尖塔，往中央愈來愈高，
    //   正中耶穌塔最高、頂上四臂十字架
    // 側面（+x）：拉丁十字的長邊在 z：左（−z）誕生四塔、右（+z）受難四塔，中央一叢尖塔；
    //   主殿往 +x 伸到還在施工的榮耀立面，後殿在 −x、頂著聖母塔（頂上一顆星）
    // 三樣識別物：一排四根紡錘鐘樓（塔身螺旋開口、頂上紅黃白尖頂飾）、往中央愈來愈高的一叢尖塔、
    //   耶穌塔頂的十字架
    // 部件：台基 主殿側廊 主殿中廊 翼廊側廊 翼廊中廊 半圓後殿 高後殿 兩坡屋頂 側廊窗 中廊窗
    //       側廊／中廊頂的果實小尖塔 主殿屋脊的雙曲面小天窗塔 後殿一圈小尖塔
    //       誕生立面（三座尖拱門＋山牆＋柏樹＋白鴿） 誕生鐘樓×4（螺旋開口、尖頂飾）
    //       受難立面（斜柱門廊＋門廊頂＋骨頭柱列） 受難鐘樓×4 榮耀立面（未完工：三座門＋前庭）
    //       耶穌塔（石身＋白色燈籠＋玻璃）＋十字架 福音書作者塔×4（象徵物） 聖母塔＋星
    const SA = 0, OLD = 1, WH = 2, DK = 3, RD = 4, YE = 5, GR = 6, BL = 7;
    const H = (x, y, z) => (((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) >>> 0) % 100;
    /* 尺寸照真實公尺換：高度 0.04 s 格／公尺；平面放寬一成多（0.046 s）。
       鐘樓另外加粗、立面上四根塔的間距另外拉開（見 rb、xi、xo），不然紡錘的收分刻不出來、四根擠成一片。 */
    const V = (m, mn) => dim(s, m * 0.04, mn);
    const P = (m, mn) => dim(s, m * 0.046, mn);
    const kP = s * 0.046;
    // 整數邊界的長方體與四面牆，顏色一邊蓋一邊挑（c 可以是函式）
    const B = (x0, x1, y0, y1, z0, z1, c) => {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++)
        v.set(x, y, z, typeof c === 'function' ? c(x, y, z) : c);
    };
    const W = (x0, x1, y0, y1, z0, z1, c) => {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++)
        if (x === x0 || x === x1 || z === z0 || z === z1) v.set(x, y, z, c(x, y, z));
    };
    const sand = (x, y, z) => H(x, y, z) < 16 ? OLD : SA;                       // 新一點的砂岩
    const old = (x, y, z) => H(x, y, z) < 18 ? SA : OLD;                        // 誕生立面與它的鐘樓：舊砂岩
    const pale = (x, y, z) => H(x, y, z) < 22 ? SA : WH;                         // 中央六塔的淺色新石材
    // 旋轉體（自己掃，顏色一邊蓋一邊挑）：prof [[半徑, 高度], …]，pick(x, y, z, 角度｜null)
    const spin = (cx, y0, cz, prof, shell, pick) => {
      const top = Math.round(prof[prof.length - 1][1]);
      let k = 0;
      for (let j = 0; j <= top; j++) {
        while (k + 2 < prof.length && j > prof[k + 1][1]) k++;
        const a = prof[k], b = prof[k + 1], sp = b[1] - a[1];
        const t = sp > 0 ? Math.min(1, Math.max(0, (j - a[1]) / sp)) : 0;
        const r = a[0] + (b[0] - a[0]) * t, n = Math.ceil(r + 0.3);
        for (let i = -n; i <= n; i++) for (let m = -n; m <= n; m++) {
          const d = Math.sqrt(i * i + m * m);                  // 不用 Math.hypot：fitScale 一輪六十次，它慢一截
          if (d > r + 0.3 || (shell && r > 2.5 && d < r - shell)) continue;
          v.set(cx + i, y0 + j, cz + m, pick(cx + i, y0 + j, cz + m, d > r - 0.7 ? Math.atan2(m, i) : null));
        }
      }
    };
    const disc = (cx, y, cz, r, pick) => {
      const n = Math.ceil(r + 0.3);
      for (let i = -n; i <= n; i++) for (let m = -n; m <= n; m++)
        if (i * i + m * m <= (r + 0.3) ** 2) v.set(cx + i, y, cz + m, pick(i, m));
    };
    // 拋物線尖拱門：u0 中線、hw 半寬、h 高，f(u, y) 處理每一格（挖洞或點暗）
    const portal = (u0, hw, h, f) => {
      for (let j = 0; j < h; j++) {
        const w = hw * Math.sqrt(1 - j / h);
        for (let u = Math.ceil(u0 - w - 0.01); u <= Math.floor(u0 + w + 0.01); u++) f(u, j);
      }
    };

    // ── 平面骨架（真實：主殿含後殿 90 m、五廊寬 45 m；翼廊 60 m、三廊寬 30 m；側廊 30 m、中廊 45 m 高）
    const hA = V(30, 3), hC = V(45, 5);
    const xT = P(15, 2), xC = P(7.5, 1), zN = P(22.5, 3), zC = xC;
    const xG = P(52, 6), zT = P(30, 4);
    const xA = -xT, rA = zN;                       // 後殿半圓：圓心在翼廊西牆
    const xM = -P(26, 4), rH = P(11, 2);           // 聖母塔與它底下的高後殿
    /* 兩坡屋頂只蓋兩格厚的斜面（山牆端整片）：實心的三角柱裡面看不到，
       塊數省下來給鐘樓長高。屋頂用淺砂岩，誕生立面的深褐鐘樓才從背景跳得出來。 */
    const roof = (x, y, z) => H(x, y, z) < 25 ? OLD : SA;
    const gableAlong = (axis, a0, a1, y0, hw0) => {
      for (let j = 0; j <= hw0; j++) for (let a = a0; a <= a1; a++) for (let b = j - hw0; b <= hw0 - j; b++) {
        if (a !== a0 && a !== a1 && Math.abs(b) < hw0 - j - 1) continue;
        if (axis === 'x') v.set(a, y0 + j, b, roof(a, y0 + j, b)); else v.set(b, y0 + j, a, roof(b, y0 + j, a));
      }
    };

    // ── 主殿（+x）：側廊外牆 → 側廊屋頂（深一階，兼腰線）→ 中廊高牆 → 兩坡屋頂（屋脊沿 x）
    W(xT, xG, 0, hA, -zN, zN, sand);
    for (let z = -zN; z <= zN; z++) if (Math.abs(z) >= zC) B(xT, xG, hA + 1, hA + 1, z, z, OLD);
    W(xT, xG, hA + 2, hC, -zC, zC, sand);
    gableAlong('x', xT, xG, hC + 1, zC + 1);
    const ridgeN = hC + zC + 2;
    // ── 翼廊（沿 z）：同一套斷面，屋脊沿 z
    W(-xT, xT, 0, hA, -zT, zT, sand);
    for (let x = -xT; x <= xT; x++) if (Math.abs(x) >= xC) B(x, x, hA + 1, hA + 1, -zT, zT, OLD);
    W(-xC, xC, hA + 2, hC, -zT, zT, sand);
    gableAlong('z', -zT, zT, hC + 1, xC + 1);
    // ── 後殿（−x）：半圓外圈（側廊高）＋屋頂；中間一圈高後殿，屋頂收成圓錐托著聖母塔
    for (let y = 0; y <= hA + 1; y++)
      for (let x = Math.floor(xA - rA - 1); x < xA; x++) for (let z = -zN; z <= zN; z++) {
        const d = Math.sqrt((x - xA) ** 2 + z * z);
        if (d > rA + 0.35 || (y <= hA && d < rA - 1)) continue;
        v.set(x, y, z, y > hA ? OLD : sand(x, y, z));
      }
    v.cyl(xM, hA + 2, 0, rH, hC - hA - 1, SA, 1);
    v.taper(xM, hC + 1, 0, rH + 1, Math.max(1, rH * 0.45), V(10, 2), OLD, 1);

    // ── 窗：側廊、中廊一開間一道長窗（開間 7.5 m）
    const bay = Math.max(2, Math.round(kP * 7.5));
    for (let x = xT + 2; x <= xG - 1; x += bay) for (const sg of [-1, 1]) {
      for (let y = 2; y <= hA - 2; y++) tint(v, x, y, sg * zN, DK);
      for (let y = hA + 3; y <= hC - 1; y++) tint(v, x, y, sg * zC, DK);
    }
    // 側廊頂、中廊簷上的果實小尖塔（紅黃馬賽克）
    let q = 0;
    for (let x = xT + 2; x <= xG - 1; x += bay, q++) for (const sg of [-1, 1]) {
      v.set(x, hA + 2, sg * zN, SA); v.set(x, hA + 3, sg * zN, q & 1 ? RD : YE);
      v.set(x, hC + 2, sg * (zC + 1), SA); v.set(x, hC + 3, sg * (zC + 1), q & 1 ? YE : RD);
    }
    // 主殿屋脊上一排雙曲面小天窗塔（腰細、頂端金點）
    const rl = Math.max(1, kP * 2.4), hl = V(12, 2);
    const nl = Math.max(2, Math.round((xG - xT) / Math.max(4, kP * 13)));
    rowOf(v, nl, (xG - xT) / nl, (vv, x) => {
      const lx = Math.round(x);
      revolve(vv, { x: lx, y: ridgeN + 1, z: 0, c: WH, prof: [[rl, 0], [rl * 0.5, hl * 0.5], [rl, hl * 0.8], [0.4, hl]] });
      vv.set(lx, ridgeN + 1 + hl, 0, YE);
    }, (xT + xG) / 2);
    // 後殿外牆的長窗：落在兩座小尖塔中間，從圓心往外打一條線找到牆面
    for (let k = 0; k < 6; k++) {
      const a = Math.PI / 2 + (k + 0.5) * Math.PI / 6;
      for (let y = 2; y <= hA - 2; y++) paintFrom(v, xA, y, 0, Math.cos(a), 0, Math.sin(a), Math.ceil(rA) + 2, DK);
    }
    // 後殿一圈七座小尖塔（禮拜堂頂）
    ringOf(v, 7, rA, (vv, x, z) => {
      const px = Math.round(x), pz = Math.round(z), hp = V(16, 2);
      spin(px, hA + 2, pz, [[Math.max(0.9, kP * 2), 0], [0.4, hp - 1]], 0, () => SA);
      vv.set(px, hA + 2 + hp, pz, YE);
    }, xA, 0, Math.PI / 2, Math.PI);

    // ── 鐘樓：下段埋在立面裡，出了立面頂就是拋物線收尖的紡錘；塔身螺旋排列的開口；頂上彩色尖頂飾
    const rb = Math.max(1.2, s * 0.25);                     // 3000 塊是 3×3、9000 塊是五格寬的圓
    const xi = dim(s, 0.68, 2), xo = dim(s, 1.6, 6);        // 內塔、外塔的 x：塔與塔之間要看得到天空
    const bell = (cx, cz, ht, yF, body) => {
      /* 出了立面頂一路收：五格寬 → 3×3 → 十字 → 一格，各佔一段（照拋物線取 sqrt 的話
         整段幾乎等寬、最後一下收尖，看起來是一根直筒加一顆頭） */
      const yS = Math.round(ht * 0.77);
      const prof = [[rb * 0.7, 0], [rb * 0.75, yF * 0.6], [rb, yF]];
      for (const [f, k] of [[0.35, 0.9], [0.65, 0.72], [0.85, 0.55], [1, 0.4]]) prof.push([rb * k, yF + (yS - yF) * f]);
      spin(cx, 0, cz, prof, 1.2, (x, y, z, a) => {
        if (a !== null && y > yF && y < yS - 1 && !((y - yF) % 2)) {
          const ph = a / (2 * Math.PI) * 3 - (y - yF) / 6;    // 三道螺旋往上繞，一層開口一層實牆
          if (ph - Math.floor(ph) < 0.3) return DK;
        }
        return body(x, y, z);
      });
      // 尖頂飾：細頸（白）→ 主教冠（紅黃相間）→ 一圈白球 → 權杖／十字（金）
      let y = yS + 1;
      v.set(cx, y++, cz, WH);
      const nc = Math.max(1, Math.round((ht - yS) * 0.3)), rc = Math.max(1.1, rb * 0.6);
      for (let k = 0; k < nc; k++, y++) disc(cx, y, cz, rc, (i, m) => (i + m + k) & 1 ? RD : YE);
      if (s < 5) { for (; y <= ht; y++) v.set(cx, y, cz, y < ht ? WH : YE); return; }   // 小尺寸：白球圈、十字橫臂都只剩一格寬
      disc(cx, y++, cz, 1, () => WH);
      for (; y <= ht; y++) v.set(cx, y, cz, YE);
      v.set(cx - 1, ht - 1, cz, YE); v.set(cx + 1, ht - 1, cz, YE);
    };

    /* ── 誕生立面（−z）：兩格厚的牆，三座門各頂一片尖山牆——正門那片最高、一路尖到柏樹腳下，
          兩側的矮一截。牆頂在塔身那裡最低（塔從這裡開始獨立），往兩座塔中間拉高。 */
    const zF = -zT - 1;
    const fS = V(30, 3), fC = V(36, 4), pS = V(40, 4), pC = V(50, 5);
    B(-xo - 1, xo + 1, 0, 0, zF - P(5, 2), zF - 1, OLD);                // 前庭台基
    for (let x = -xo; x <= xo; x++) {
      const ax = Math.abs(x), mid = (xi + xo) / 2, half = (xo - xi) / 2;
      const top = ax < xi ? Math.round(fC + (pC - fC) * (1 - ax / xi))
                          : Math.round(fS + (pS - fS) * Math.max(0, 1 - Math.abs(ax - mid) / half));
      B(x, x, 0, top, zF, zF + 1, old);
      // 門頂以上滿是雕刻：前面再黏一層零零落落的凸塊，平板才有凹凸
      for (let y = (ax < xi ? V(30, 3) : V(24, 2)) + 1; y < top; y++)
        if (H(x, y, zF - 1) < 14) v.set(x, y, zF - 1, old(x, y, zF - 1));
    }
    const cutF = (u, j) => { v.del(u, j, zF); v.set(u, j, zF + 1, DK); };
    portal(0, Math.max(1, xi - rb * 0.7 - 0.2), V(30, 3), cutF);               // 正門（慈愛之門）
    for (const sg of [-1, 1]) portal(sg * (xi + xo) / 2, Math.max(0.5, (xo - xi) / 2 - rb * 0.7 - 0.2), V(24, 2), cutF);
    for (const sg of [-1, 1]) {
      bell(sg * xi, zF, V(107.5, 10), fC, old);
      bell(sg * xo, zF, V(98, 9), fS, old);
    }
    // 正門山牆頂上的柏樹（生命之樹）與白鴿
    const yCy = pC + 1, hCy = V(20, 3);
    v.taper(0, yCy, zF, Math.max(1.2, kP * 4.8), 0.4, hCy, GR);
    paintFrom(v, 0, yCy + Math.round(hCy * 0.35), zF, 0, 0, -1, 4, WH);
    paintFrom(v, 0, yCy + Math.round(hCy * 0.6), zF, 1, 0, 0, 4, WH);
    paintFrom(v, 0, yCy + Math.round(hCy * 0.6), zF, -1, 0, 0, 4, WH);

    /* ── 受難立面（+z）：比誕生立面平直、乾硬的淺色立面。門廊底下整片是暗的門洞，
          前面六根往外斜的淺色骨頭柱撐著一片厚門廊頂，頂上一排高低不齊的骨頭柱（山牆） */
    const zP = zT + 1, fP = V(40, 4);
    const dP = P(9, 2), yCan = V(24, 3), rc6 = Math.max(0.75, s * 0.13);
    B(-xo, xo, 0, fP, zT, zP, sand);
    for (let x = 2 - xo; x <= xo - 2; x++) for (let y = 0; y < yCan; y++) { v.del(x, y, zP); v.set(x, y, zT, DK); }
    for (const sg of [-1, 1]) {
      bell(sg * xi, zP, V(112, 11), fP, sand);
      bell(sg * xo, zP, V(103, 10), fP, sand);
    }
    rowOf(v, 6, (2 * xo - 3) / 5, (vv, x) =>
      limb(vv, { x: x * 0.6, y: 0, z: zP + 1, x1: x * 1.05, y1: yCan, z1: zP + dP, r: rc6, c: WH }));
    B(-xo, xo, yCan, yCan + 1, zP + 1, zP + dP, sand);                    // 門廊頂（兩層厚）
    for (let x = 1 - xo, k = 0; x <= xo - 1; x += 2, k++)                  // 骨頭柱列：中間高、兩邊低、一高一低
      B(x, x, yCan + 2, yCan + 1 + V(6, 1) + Math.round((xo - Math.abs(x)) * 0.5) + (k & 1), zP + dP, zP + dP, WH);

    // ── 榮耀立面（+x，主殿東端）：2026 年還在施工，鐘樓沒蓋，只有門與前庭
    const hG = V(24, 3);
    portal(0, Math.max(1, zC - 0.5), hG, (z, y) => tint(v, xG, y, z, DK));
    for (const sg of [-1, 1]) portal(sg * (zC + zN) / 2, Math.max(0.5, (zN - zC) / 2 - 1), V(18, 2), (z, y) => tint(v, xG, y, z, DK));
    B(xG + 1, xG + P(6, 2), 0, 0, -zN, zN, OLD);

    // ── 中央：耶穌塔（最高）＋四座福音書作者塔＋聖母塔，淺色新石材，上段白色燈籠＋玻璃
    /* 塔身不點暗窗：正面看過去中央這一叢要是乾淨的淺色，才分得出前排深褐的誕生鐘樓 */
    const central = (yL) => (x, y, z, a) => {
      if (a === null) return WH;
      if (y >= yL) return Math.round(a / (2 * Math.PI) * 12) % 3 ? WH : BL;   // 燈籠：白瓷夾玻璃直條
      return pale(x, y, z);
    };
    const taperProf = (r0, h) => [[r0, 0], [r0 * 0.86, h * 0.45], [r0 * 0.6, h * 0.78], [r0 * 0.4, h * 0.92], [0.5, h]];
    // 耶穌塔：172.5 m，頂上十字架高 17 m、寬 13.5 m（四臂立體十字，白瓷＋玻璃，2026 年 2 月裝完）
    const rJ = Math.max(1.6, kP * 9.5), yJ0 = hC + 1, yX1 = V(172.5, 18);
    const hX = Math.max(3, V(17, 3)), yJ1 = yX1 - hX;
    spin(0, yJ0, 0, taperProf(rJ, yJ1 - yJ0), 1.3, central(V(135, 14)));
    B(0, 0, yJ1 + 1, yX1, 0, 0, WH);
    const ax = Math.max(1, Math.round(hX * 0.28)), yArm = yJ1 + Math.max(2, Math.round(hX * 0.55));
    B(-ax, ax, yArm, yArm, 0, 0, WH); B(0, 0, yArm, yArm, -ax, ax, WH);
    v.set(0, yArm, 0, BL);
    // 福音書作者塔：135 m，頂上各一個金色象徵物（人、獅、牛、鷹），每一格都面貼面接回塔尖
    const e = P(14, 2), rE = Math.max(1.2, kP * 5.5), yE1 = V(130, 14);
    /* 塔腳是翼廊交叉處的四根大墩（砂岩，從側廊屋頂長到中廊頂），淺色塔身從中廊頂以上才露出來——
       照實是從交叉部屋頂（60 多 m）才露出來；直接從側廊屋頂長的話，正面看過去下半截全疊在誕生鐘樓後面 */
    [[1, -1], [-1, -1], [1, 1], [-1, 1]].forEach(([sx, sz], i) => {
      const x = sx * e, z = sz * e;
      B(x - 1, x + 1, hA + 2, hC, z - 1, z + 1, sand);
      spin(x, hC + 1, z, taperProf(rE, yE1 - hC - 1), 1.2, central(V(115, 12)));
      const y = yE1 + 1;
      v.set(x, y, z, YE);
      if (s < 6) return;                                                                     // 小尺寸只留一點金
      v.set(x, y + 1, z, YE);
      if (i === 0 || i === 3) { v.set(x - 1, y + 1, z, YE); v.set(x + 1, y + 1, z, YE); }   // 天使、鷹：張開的翅膀
      else if (i === 2) { v.set(x, y + 2, z, YE); v.set(x - 1, y + 2, z, YE); v.set(x + 1, y + 2, z, YE); }  // 牛：兩支角
      else { v.set(x, y + 1, z - 1, YE); v.set(x, y + 2, z, YE); }                           // 獅：頭往前探
    });
    // 聖母塔：138 m，頂上一顆十二角星（白天是玻璃，晚上會亮）
    const rM = Math.max(1.3, kP * 7), L = Math.max(1, Math.round(kP * 5));    // 星照實直徑 7 m 多，放大才看得到
    const yM1 = V(138, 15) - 2 * L - 1, ySt = yM1 + 1 + L;
    spin(xM, hC + 1, 0, taperProf(rM, yM1 - hC - 1), 1.2, central(V(118, 12)));
    for (let k = -L; k <= L; k++) { v.set(xM + k, ySt, 0, BL); v.set(xM, ySt + k, 0, BL); v.set(xM, ySt, k, BL); }
    if (L >= 2) for (const a of [-1, 1]) for (const b of [-1, 1]) for (const c of [-1, 1]) v.set(xM + a, ySt + b, c, BL);
  } },

{ n: '美國國會大廈', lo: 1.8, hi: 13,
  // v1.257.0 只調色、格子一格都沒動（見 開發筆記〈舊版 21 座重畫、偏白的 5 座調色〉）
  // 美國國會大廈：使用者交的那一份，造型一格都不動（格子集合跟舊版完全一樣），只重新上色
  // 正面：很寬很矮的一長條：中央主殿、兩段退縮連廊、兩端兩翼（四坡頂），正中央一座兩層鼓座＋圓頂＋頂閣＋雕像
  // 側面：主殿前面凸出一座三角山牆門廊與大階梯（這一份的門廊在 +z 那面，照舊不動）
  // 三樣識別物：正中央高起的白色圓頂（下面一圈柱廊鼓座）、橫向對稱展開的主殿＋兩翼、門廊的三角山牆與大階梯
  // 部件（照舊）：台基 主殿 連廊 兩翼 翼樓簷口 翼樓四坡頂 翼樓窗 門廊 門廊拱 山牆 大階梯 木門 主殿簷口
  //              下層鼓座 鼓座柱廊環 上層鼓座 圓頂簷 圓頂 頂閣 雕像基座 自由女神像
  // 上色：大理石從近白改成帶一點灰的白；簷口、山牆、連廊深一階（退縮的連廊在陰影裡）；
  //       台基與大階梯是灰褐花崗岩；（新增，只 tint）主殿／連廊／兩翼四面都開兩層深色窗，
  //       門廊正面一欄柱子一欄陰影、拱裡是木門；鼓座柱廊環同樣一柱一影，上層鼓座一圈窗；
  //       圓頂是全座最亮的白，加上一條條肋條；翼樓屋頂鉛灰；自由女神像是青銅色。
  /* 來源：AgentData/blueprints/美國國會大廈.js（v1.143 換掉原本那份）。
     hi 從原稿的 11.5 調到 13：11.5 的時候 9000 那檔只長到 7820（s 頂到 hi），13 是 9021 */
  pal: [0xcdcac1,   // 0 外牆大理石：主殿、兩翼、門廊、鼓座、頂閣（帶一點灰的白）
        0x86827a,   // 1 台基、大階梯（灰褐花崗岩）、柱廊後方的陰影、圓頂肋條
        0x868c94,   // 2 兩翼的四坡屋頂（鉛灰）
        0x363e4b,   // 3 窗
        0x6b4226,   // 4 木門（門廊拱裡）
        0x6e5a3c,   // 5 自由女神像（青銅）
        0xb4b0a6,   // 6 簷口、山牆、連廊（深一階的大理石）
        0xe0ded7],  // 7 圓頂（全座最亮）
  gen(v, s) {
    // === 1. 基礎尺度定義（維持新古典主義的壯闊橫向比例與高聳圓頂） ===
    const bw = dim(s, 2.2, 9, true);       // 中央主體寬度（奇數，利於對稱）
    const bd = dim(s, 1.3, 7);             // 中央主體深度
    const bh = dim(s, 0.75, 4);            // 主體牆高

    const wingW = dim(s, 1.4, 6);          // 左右兩翼寬度
    const wingD = dim(s, 1.1, 5);          // 左右兩翼深度
    const linkW = dim(s, 0.6, 3);          // 連接兩翼的走廊寬度
    const linkD = Math.max(3, bd - 2);     // 連接走廊深度

    const totalHalfW = (bw - 1) / 2 + linkW + wingW;
    const baseExtra = 1;
    const frontZ = Math.round(bd / 2);

    // === 2. 台基層 (Base) ===
    // 展開式大台基，確保結構厚實且最底層支撐面積充裕
    v.box(0, 0, 0, totalHalfW * 2 + 2, 1, bd + baseExtra * 2, 1);

    // === 3. 主量體：中央建築與左右翼 (Wings & Main Block) ===
    // 中央主廳
    v.walls(0, 1, 0, bw, bh, bd, 0, 1);
    // 連接走廊 (左右對稱)
    mirrorX(v, (bw - 1) / 2 + Math.round(linkW / 2), (vv, dx) => {
      vv.walls(dx, 1, 0, linkW + 1, bh - 1, linkD, 6, 1);             // 舊：0（退縮的連廊深一階）
      vv.box(dx, bh, 0, linkW + 1, 1, linkD, 6); // 走廊頂部壓頂（舊：1）
    });
    // 參眾兩院南北翼 (左右對稱大廳)
    mirrorX(v, (bw - 1) / 2 + linkW + Math.round(wingW / 2), (vv, dx) => {
      vv.walls(dx, 1, 0, wingW, bh, wingD, 0, 1);
      vv.box(dx, 1 + bh, 0, wingW + 2, 1, wingD + 2, 6); // 翼樓頂部簷口（舊：1）
      hipRoof(vv, dx, 2 + bh, 0, wingW + 2, wingD + 2, 2); // 翼樓低矮四坡頂

      // 翼樓立面窗戶陣列
      windowGrid(vv, {
        x: dx, y: 2, z: Math.round((wingD - 1) / 2),   // 牆面在 (d-1)/2，原稿的 d/2 在 wingD 是奇數時會落到牆外一格（窗戶整組畫不出來）
        cols: dim(s, 0.3, 2), rows: dim(s, 0.25, 2),
        stepX: 2, stepY: 2, w: 1, h: 1, c: 3, axis: 'x'
      });
    });

    /* 3b.（新增，只上色）主殿、連廊、兩翼四面的兩層窗。全部走 tint，只換牆上已經有的格子。
       牆面的位置照 walls() 的取整算（寬或深是偶數時，中心落在半格上，兩片牆的座標要各自 round）。 */
    {
      const wh = Math.max(1, Math.round(bh * 0.18)), gap = Math.max(1, Math.round(bh * 0.2));
      const rows = [2, 2 + wh + gap];
      const faces = (cx, w, d, top) => {          // 一個 walls() 量體的四面
        const x0 = Math.round(cx - (w - 1) / 2), x1 = Math.round(cx + (w - 1) / 2);
        const z0 = Math.round(-(d - 1) / 2), z1 = Math.round((d - 1) / 2);
        for (const y0 of rows) for (let dy = 0; dy < wh; dy++) {
          const y = y0 + dy;
          if (y > top) continue;
          for (let x = x0 + 2; x <= x1 - 2; x += 2) { tint(v, x, y, z0, 3); tint(v, x, y, z1, 3); }
          for (let z = z0 + 2; z <= z1 - 2; z += 2) { tint(v, x0, y, z, 3); tint(v, x1, y, z, 3); }
        }
      };
      faces(0, bw, bd, bh);
      for (const sg of [1, -1]) {
        faces(sg * ((bw - 1) / 2 + Math.round(linkW / 2)), linkW + 1, linkD, bh - 1);
        faces(sg * ((bw - 1) / 2 + linkW + Math.round(wingW / 2)), wingW, wingD, bh);
      }
    }

    // === 4. 正面門廊與三角山牆柱廊 (Grand Portico & Pediment) ===
    const portW = dim(s, 0.9, 5, true);    // 門廊寬度
    const portD = dim(s, 0.35, 2);         // 門廊突出深度
    const portZ = frontZ + Math.round(portD / 2);

    // 前方柱廊（以拱門群或立柱形成開放式門廊）
    v.box(0, 1, portZ, portW, bh, portD, 0);
    arch(v, 0, 1, frontZ + portD, dim(s, 0.4, 3, true), bh - 2, 1); // 門廊正中大開口
    /* 4b.（新增，只上色）門廊正面一欄柱子一欄陰影（最上一層留著當楣樑），拱裡看進去那層是木門 */
    {
      const zP = frontZ + portD, ph = (portW - 1) / 2;
      for (let x = -ph + 1; x <= ph - 1; x += 2) for (let y = 1; y < bh; y++) tint(v, x, y, zP, 1);
      const aw = dim(s, 0.4, 3, true), ar = (aw - 1) / 2;
      for (let x = -ar; x <= ar; x++) for (let y = 1; y <= bh - 1 + ar; y++) tint(v, x, y, zP - 1, 4);
    }
    // 門廊正上方經典希臘三角山牆 (Pediment)
    v.gable(0, 1 + bh, portZ, portW + 2, portD + 1, 6);                // 舊：1

    // 大階梯 (Grand Steps)
    const stairSteps = dim(s, 0.3, 2);
    stairs(v, 0, 0, frontZ + portD + stairSteps, stairSteps, portW + 2, '-z', 1);

    // 主入口木門與中央立面裝飾
    const doorW = dim(s, 0.25, 1, true);
    v.box(0, 1, frontZ, doorW, 2, 1, 4);

    // === 5. 中央主體頂層壓頂與欄杆線腳 (Cornice & Balustrade) ===
    v.box(0, 1 + bh, 0, bw + 2, 1, bd + 2, 6);                          // 舊：1

    // === 6. 標誌性中央大圓頂 (The Great Dome) ===
    // 圓頂下層鼓座 (Lower Drum with Colonnade)
    const drumR1 = dim(s, 0.55, 3);
    const drumH1 = dim(s, 0.45, 2);
    const drumY1 = 2 + bh;
    v.cyl(0, drumY1, 0, drumR1, drumH1, 0, 1);
    // 鼓座外圈柱廊裝飾環
    v.ellipseRing(0, drumY1, 0, drumR1 + 1, drumR1 + 1, drumH1, 0, 1);  // 舊：1
    /* 6b.（新增，只上色）柱廊環照角度一格柱子一格陰影，最上一層留著當簷。
       格子照 ellipseRing 的判斷重算一遍（只掃這一圈，幾十格） */
    {
      const rx = drumR1 + 1, n = Math.ceil(rx);
      const N = 2 * Math.max(4, Math.round(Math.PI * rx / 1.6));
      for (let i = -n; i <= n; i++) for (let k = -n; k <= n; k++) {
        const o = Math.hypot(i / rx, k / rx), inn = Math.hypot(i / (rx - 1), k / (rx - 1));
        if (o > 1.06 || inn < 1) continue;
        const sec = Math.floor(((Math.atan2(k, i) / (2 * Math.PI)) + 1) * N) % N;
        if (sec % 2) for (let y = drumY1; y < drumY1 + drumH1 - 1; y++) tint(v, i, y, k, 1);
      }
    }

    // 圓頂上層過渡鼓座 (Upper Peristyle Drum)
    const drumR2 = Math.max(2, drumR1 - 1);
    const drumH2 = dim(s, 0.35, 2);
    const drumY2 = drumY1 + drumH1;
    v.cyl(0, drumY2, 0, drumR2, drumH2, 0, 1);
    /* 6c.（新增，只上色）上層鼓座中段一圈窗 */
    {
      const n = Math.ceil(drumR2), N = 3 * Math.max(4, Math.round(2 * Math.PI * drumR2 / 3));   // 一扇窗大約一格寬、隔兩格
      const wy = drumY2 + Math.floor((drumH2 - 1) / 2);
      for (let i = -n; i <= n; i++) for (let k = -n; k <= n; k++) {
        const sec = Math.floor(((Math.atan2(k, i) + Math.PI / 2) / (2 * Math.PI) + 1) * N + 0.5) % N;   // 第 0 扇正對 −z
        if (sec % 3 === 0) tint(v, i, wy, k, 3);
      }
    }
    // 圓頂下簷線腳
    v.cyl(0, drumY2 + drumH2, 0, drumR2 + 1, 1, 6);                    // 舊：1

    // 鑄鐵大圓頂主體 (Main Ribbed Dome)
    const domeY = drumY2 + drumH2 + 1;
    const domeR = drumR2;
    v.dome(0, domeY, 0, domeR, 7, 0.85);                                // 舊：2
    /* 6d.（新增，只上色）圓頂肋條：照 dome() 的判斷重算殼上的格子，落在肋條角度上的換深一階 */
    {
      const sq = 0.85, n = Math.ceil(domeR), N = Math.max(8, 2 * Math.round(Math.PI * domeR / 2.4));
      for (let y = 0; y <= Math.ceil(domeR * sq); y++) for (let i = -n; i <= n; i++) for (let k = -n; k <= n; k++) {
        const d = Math.sqrt(i * i + k * k + (y / sq) * (y / sq));
        if (Math.abs(d - domeR) > 0.6 || Math.hypot(i, k) < 1.5) continue;
        const f = ((Math.atan2(k, i) / (2 * Math.PI)) + 1) * N % 1;
        if (f < 0.34) tint(v, i, domeY + y, k, 1);
      }
    }

    // === 7. 圓頂頂閣、托座與自由女神雕像 (Cupola, Lantern & Statue of Freedom) ===
    const lanternY = domeY + Math.round(domeR * 0.85);
    const lanternH = dim(s, 0.35, 2);
    // 頂部小圓亭 (Lantern)
    v.cyl(0, lanternY, 0, 1, lanternH, 0);
    v.cyl(0, lanternY + lanternH, 0, 2, 1, 6); // 雕像基座線腳（舊：1）

    // 自由女神像 (Statue of Freedom)
    const statueH = dim(s, 0.25, 2);
    v.box(0, lanternY + lanternH + 1, 0, 1, statueH, 1, 5);
  } },

{ n: '金門大橋', lo: 1.8, hi: 11.5, pal: [0xc0362c, 0x8f2820, 0x5c5f66, 0xe2e8f0, 0x828894, 0xf59e0b],
  /* 來源：AgentData/blueprints/金門大橋.js（v1.143 換掉原本那份）。dim 的下限一律乘 0.8（8 處）：原稿最小 2142 塊，面板的 1800 按下去等於沒反應。
     改完最小 1566、1800 那檔 1795，3000／9000 兩檔一格沒動（2978／9322） */
  gen(v, s) {
    // 1. 尺度參數計算（金門大橋主體細長，沿 z 軸延展）
    const span = dim(s, 6.0, 24);                // 半跨距離（中心到主塔）
    const fullLen = span * 2 + dim(s, 2.5, 11); // 橋面總長
    const deckW = dim(s, 0.9, 4, true);         // 橋面寬度（取奇數）
    const deckY = dim(s, 0.9, 3);               // 橋面離地/水面高度
    const towerH = dim(s, 3.8, 13);             // 主塔自橋面往上的高度
    const towerTopY = deckY + towerH;           // 塔頂 Y 座標
    const legThick = dim(s, 0.35, 2);           // 塔柱厚度
    const halfDeck = (deckW - 1) / 2;

    // 2. 水下/水上大型混凝土橋墩（左右各一座）
    mirrorZ(v, span, (vv, tz) => {
      vv.box(0, 0, tz, deckW + 4, deckY - 1, legThick + 4, 4);
      vv.box(0, deckY - 1, tz, deckW + 2, 1, legThick + 2, 1); // 橋墩頂部壓頂
    });

    // 3. 橋面主體（鋼桁架底層 + 瀝青車道 + 兩側防撞護欄）
    v.box(0, deckY - 1, 0, deckW, 1, fullLen, 0); // 鋼結構下層托架
    v.box(0, deckY, 0, deckW - 2, 1, fullLen, 2);     // 柏油路面
    mirrorX(v, halfDeck, (vv, dx) => {
      vv.box(dx, deckY + 1, 0, 1, 1, fullLen, 0);     // 兩側護欄/側桁架
    });

    // 4. 雙主塔結構（門型塔、分層橫梁、裝飾造型）
    mirrorZ(v, span, (vv, tz) => {
      // 兩根主塔立柱
      mirrorX(vv, halfDeck, (vvv, dx) => {
        vvv.box(dx, deckY, tz, legThick, towerH, legThick, 0);
      });

      // 主塔分層橫梁（門型橫向斜撐分段）
      const beamCount = dim(s, 0.5, 2);
      const beamStep = Math.floor(towerH / (beamCount + 1));
      for (let i = 1; i <= beamCount; i++) {
        const by = deckY + i * beamStep;
        vv.box(0, by, tz, deckW, Math.max(1, Math.round(legThick * 0.8)), legThick, 1);
      }

      // 塔頂橫梁、收分線腳、頂冠與航空警示燈
      vv.box(0, towerTopY, tz, deckW + 2, 1, legThick + 1, 1);
      mirrorX(vv, halfDeck, (vvv, dx) => {
        vvv.box(dx, towerTopY + 1, tz, legThick, 1, legThick, 0);
        vvv.box(dx, towerTopY + 2, tz, 1, 1, 1, 5); // 塔頂航標燈
      });
    });

    // 5. 主纜（拋物線懸索）與 垂直吊索（吊桿）
    // 兩側主纜沿 z 軸對稱拉出
    const cableSag = towerH * 0.75; // 懸垂弧度深度
    const cableSteps = fullLen;     // 逐格平滑取樣
    const zStart = -Math.floor(fullLen / 2);
    const zEnd = Math.floor(fullLen / 2);

    mirrorX(v, halfDeck, (vv, dx) => {
      for (let z = zStart; z <= zEnd; z++) {
        let cy;
        // 中跨 (塔與塔之間) 與 邊跨 (塔往兩端錨碇)
        if (Math.abs(z) <= span) {
          const u = z / span; // -1 ~ 1
          cy = Math.round(towerTopY - cableSag * (1 - u * u));
        } else {
          // 邊跨向兩端錨碇點下降
          const dist = Math.abs(z) - span;
          const sideSpan = (fullLen / 2) - span;
          const u = Math.min(1, dist / Math.max(1, sideSpan));
          cy = Math.round(towerTopY - (towerTopY - (deckY + 1)) * (u * 0.9));
        }

        // 繪製主纜節點
        vv.set(dx, cy, z, 3);

        // 垂直吊索：每隔一定間距且在主纜高於橋面時拉一條吊桿
        const hangerSpacing = Math.max(2, dim(s, 0.35, 2));
        if (Math.abs(z) % hangerSpacing === 0 && cy > deckY + 1) {
          vv.line(dx, deckY + 1, z, dx, cy - 1, z, 3);
        }
      }
    });

    // 6. 兩端引橋端墩與錨碇座（Anchorages）
    mirrorZ(v, Math.floor(fullLen / 2) - 1, (vv, ez) => {
      vv.box(0, 0, ez, deckW + 2, deckY, 3, 4);
      vv.box(0, deckY, ez, deckW + 2, 1, 3, 1);
    });
  } },

{ n: '海岬燈塔',
  // v1.257.0 整座重畫（見 開發筆記〈舊版 21 座重畫、偏白的 5 座調色〉）
  // 海岬燈塔
  // 正面（−z）：一座草頂的岩岸台地，左邊站著紅白橫紋、往上收的圓塔：塔腳石砌基座與小門、塔身一路幾扇小窗，
  //   塔頂往外挑出一圈走道與黑鐵欄杆 → 紅色值班室 → 黃色燈光的燈室（黑色窗櫺）→ 黑色圓頂、通風球、風向標；
  //   右邊一間白牆紅瓦的守塔人小屋（煙囪、門窗），用一段矮廊接到塔腳
  // 側面（+x）：小屋在前、塔在後；台地邊緣幾顆大石頭往外散
  // 三樣識別物：紅白相間收分的塔身、塔頂發黃光的玻璃燈室＋黑圓頂、外挑一圈的欄杆走道
  // 部件：岩岸台地（兩種灰）草皮 邊緣大石 石砌塔基 紅白塔身 塔門 塔窗 挑簷托座 走道 欄杆
  //       值班室（小窗） 燈室底座 燈室玻璃＋窗櫺 圓頂 通風球 風向標
  //       小屋石基 白牆 灰色轉角柱 門 窗 紅瓦屋頂 煙囪 連接矮廊
  lo: 7, hi: 64,
  pal: [0xe6e1d5,   // 0 白：塔身白段、小屋牆
        0xc0392f,   // 1 紅：塔身紅段、值班室、小屋屋瓦
        0x6d6a64,   // 2 岩石
        0x2a3035,   // 3 黑鐵：欄杆、窗櫺、圓頂、門窗
        0xf2c84b,   // 4 燈光（燈室玻璃）
        0x5d8a43,   // 5 草皮
        0xa9a59b],  // 6 淺灰石：塔基、走道、小屋石基與轉角、亮面岩石
  gen(v, s) {
    const WH = 0, RE = 1, RK = 2, IR = 3, LT = 4, GS = 5, LG = 6;
    const hash = (x, y, z) => {
      let h = (x * 73856093) ^ (y * 19349663) ^ (z * 83492791);
      h = (h ^ (h >>> 13)) * 1274126177;
      return ((h ^ (h >>> 16)) >>> 0) % 100;
    };
    // 站著的圓環（自己掃，顏色一邊蓋一邊挑）：半徑 r、牆厚 t（0＝實心），pick(x, y, z, 角度) 回傳顏色或 null
    const ring = (cx, y0, cz, r, h, t, pick) => {
      const n = Math.ceil(r + 0.5);
      for (let y = y0; y < y0 + h; y++)
        for (let x = -n; x <= n; x++) for (let z = -n; z <= n; z++) {
          const d = Math.sqrt(x * x + z * z);
          if (d > r + 0.35 || (t && d < r + 0.35 - t)) continue;
          const c = pick(cx + x, y, cz + z, Math.atan2(z, x));
          if (c !== null) v.set(cx + x, y, cz + z, c);
        }
    };

    // ── 岩岸台地：中央高、邊緣低的一坨，頂面鋪草，側面兩種灰 ──
    const rx = s * 0.38, rz = s * 0.31, cxR = s * 0.05;
    const hR = Math.max(2, s * 0.10);
    for (let x = Math.floor(cxR - rx); x <= Math.ceil(cxR + rx); x++)
      for (let z = Math.floor(-rz); z <= Math.ceil(rz); z++) {
        const q = ((x - cxR) / rx) ** 2 + (z / rz) ** 2;
        if (q > 1) continue;
        const top = Math.round(hR * Math.min(1, 1.6 * (1 - q)) + (hash(x, 7, z) % 3 - 1) * 0.5);
        for (let y = 0; y <= top; y++)
          v.set(x, y, z, y === top && q < 0.8 ? GS : hash(x, y, z) < 22 ? LG : RK);
      }
    const yR = Math.round(hR);                                  // 台地頂（塔與小屋站的那一層的下一層）
    // 邊緣幾顆大石頭（朝外散）
    for (const [a, k] of [[-2.2, 0.95], [-1.4, 1.0], [-0.5, 0.97], [2.6, 0.92], [3.4, 1.0], [1.3, 0.98]]) {
      const bx = cxR + Math.cos(a) * rx * k, bz = Math.sin(a) * rz * k, br = Math.max(1, s * 0.04);
      blob(v, bx, br * 0.6, bz, br * 1.2, br * 0.9, br, RK);
    }

    // ── 塔身：紅白相間、往上收分的圓塔（中空） ──
    const tx = -Math.round(s * 0.06), tz = 0;
    const y0 = yR + 1;                                         // 塔基底
    const hT = dim(s, 0.66, 8);                                // 塔身高
    const r0 = Math.max(2.2, s * 0.10), r1 = Math.max(1.6, s * 0.07);
    ring(tx, y0, tz, r0 + 0.8, 1, 0, () => LG);                // 石砌塔基
    const nb = 6, bh = hT / nb;                                // 六段，紅白相間
    for (let j = 0; j < hT; j++) {
      const r = r0 + (r1 - r0) * j / (hT - 1), band = Math.floor(j / bh);
      ring(tx, y0 + 1 + j, tz, r, 1, 1.5, () => band % 2 ? RE : WH);
    }
    const yT = y0 + 1 + hT;                                    // 塔頂（走道那一層）
    // 塔門（正面）與一路往上的小窗（錯開左右，像沿著螺旋梯開的）
    const dh = dim(s, 0.06, 2);
    for (let y = y0 + 1; y < y0 + 1 + dh; y++) for (const dx of [0, 1])
      paintFrom(v, tx + dx, y, tz, 0, 0, -1, Math.ceil(r0) + 2, IR);
    const nw = Math.max(2, Math.round(hT / 6));
    for (let i = 1; i < nw; i++) {
      const y = y0 + 1 + Math.round(hT * i / nw), dx = i % 2 ? -1 : 1;
      paintFrom(v, tx + dx, y, tz, 0, 0, -1, Math.ceil(r0) + 2, IR);
      paintFrom(v, tx + dx, y + 1, tz, 0, 0, -1, Math.ceil(r0) + 2, IR);
    }
    // 門上一片小雨遮：貼著那一層塔牆的最外一格（塔身往上收，照塔腳的半徑擺會差一格懸空）
    const rdh = r0 + (r1 - r0) * dh / (hT - 1);
    v.box(tx + 0.5, y0 + 1 + dh, tz - Math.floor(rdh + 0.35) - 1, 4, 1, 1, LG);

    // ── 塔頂：挑簷托座 → 走道 → 黑鐵欄杆 ──
    const rg = r1 + Math.max(1.4, s * 0.05);
    ring(tx, yT - 1, tz, r1 + 0.9, 1, 0, () => LG);            // 托座（比塔身寬一圈）
    ring(tx, yT, tz, rg, 1, 0, () => LG);                      // 走道
    ring(tx, yT + 1, tz, rg, 1, 0.9, (x, y, z) => ((x + z) & 1) ? IR : null);   // 欄杆柱
    ring(tx, yT + 2, tz, rg, 1, 0.9, () => IR);                // 扶手
    // ── 值班室（紅）→ 燈室底座 → 燈室（黃色玻璃、黑色窗櫺）→ 圓頂 ──
    const rw = Math.max(1.3, r1 * 0.85), hw = dim(s, 0.045, 1);
    ring(tx, yT + 1, tz, rw, hw, 0, (x, y, z, a) => RE);
    paintFrom(v, tx, yT + 1, tz, 0, 0, -1, Math.ceil(rw) + 2, IR);   // 值班室的小窗
    const yL = yT + 1 + hw, hl = dim(s, 0.085, 2), rl = Math.max(1.2, r1 * 0.78);
    ring(tx, yL, tz, rl + 0.3, 1, 0, () => IR);                // 燈室底座
    const mull = Math.max(6, Math.round(rl * 4));              // 窗櫺數（大塔多一些）
    ring(tx, yL + 1, tz, rl, hl, 1.2, (x, y, z, a) => {
      const k = (a / (Math.PI * 2) * mull + mull) % 1;
      return k < 0.18 || k > 0.82 ? IR : LT;
    });
    ring(tx, yL + 1, tz, Math.max(0.6, rl - 1.2), hl, 0, () => LT);   // 燈（從玻璃縫看得到的亮芯）
    const yD = yL + 1 + hl;
    ring(tx, yD, tz, rl + 0.6, 1, 0, () => IR);                // 屋簷
    const rd = rl + 0.4;
    v.dome(tx, yD + 1, tz, rd, IR, 0.9);                       // 黑色圓頂（殼，頂心那一格接得住上面的球）
    const yB = yD + 2 + Math.round(rd * 0.9);
    blob(v, tx, yB, tz, 0.9, 0.9, 0.9, IR);                    // 通風球
    // ── 風向標：細桿＋一支箭（箭頭朝 −x，尾翼一小片） ──
    const hv = dim(s, 0.06, 2), yv = yB + 1;
    v.box(tx, yv, tz, 1, hv, 1, IR);
    const al = Math.max(1, Math.round(s * 0.035));
    v.line(tx - al, yv + hv - 1, tz, tx + al, yv + hv - 1, tz, IR);
    v.set(tx - al + 1, yv + hv, tz, IR); v.set(tx - al + 1, yv + hv - 2, tz, IR);    // 箭頭
    v.set(tx + al, yv + hv, tz, RE);                                                   // 尾翼（紅）

    // ── 守塔人小屋（+x 側）：石基、白牆、灰色轉角柱、門窗、紅瓦兩坡頂（屋脊沿 x）、煙囪 ──
    const hw2 = dim(s, 0.13, 3), hd2 = dim(s, 0.09, 2);        // 半寬、半深
    const hx = Math.round(r0 + s * 0.06) + hw2 + tx, hz = Math.round(s * 0.04);
    const wh = dim(s, 0.09, 3);
    v.box(hx, yR + 1, hz, hw2 * 2 + 3, 1, hd2 * 2 + 3, LG);    // 石基
    v.walls(hx, yR + 2, hz, hw2 * 2 + 1, wh, hd2 * 2 + 1, WH, 1);
    corners4(v, hw2, hd2, (vv, x, z) => vv.box(hx + x, yR + 2, hz + z, 1, wh, 1, LG));
    // 門（正面中央）與窗
    for (let y = yR + 2; y < yR + 2 + Math.min(wh - 1, 3); y++) tint(v, hx, y, hz - hd2, IR);
    const wy = yR + 2 + Math.max(1, Math.round(wh * 0.45));
    for (const dx of [-1, 1]) {
      const wx = hx + dx * Math.max(2, Math.round(hw2 * 0.6));
      tint(v, wx, wy, hz - hd2, IR); tint(v, wx, wy, hz + hd2, IR);
    }
    tint(v, hx + hw2, wy, hz, IR);
    // 屋頂：每往上一層前後各收一格，屋簷比牆寬一格
    const yr = yR + 2 + wh;
    for (let i = 0; i <= hd2 + 1; i++) v.box(hx, yr + i, hz, hw2 * 2 + 3, 1, Math.max(1, hd2 * 2 + 3 - i * 2), RE);
    // 山牆（兩端補白牆，屋頂下的三角）
    for (let i = 0; i <= hd2; i++) for (const sx of [-1, 1])
      v.box(hx + sx * hw2, yr + i, hz, 1, 1, Math.max(1, hd2 * 2 + 1 - i * 2), WH);
    v.box(hx + Math.round(hw2 * 0.5), yr, hz + Math.max(1, Math.round(hd2 * 0.5)), 1, hd2 + 3, 1, LG);   // 煙囪
    // 連接矮廊：小屋到塔腳
    const lx0 = tx + Math.round(r0), lx1 = hx - hw2;
    v.box((lx0 + lx1) / 2, yR + 1, hz - Math.round(hd2 * 0.3), Math.max(1, lx1 - lx0 + 1), dim(s, 0.06, 2), 3, WH);
    v.box((lx0 + lx1) / 2, yR + 1 + dim(s, 0.06, 2), hz - Math.round(hd2 * 0.3), Math.max(1, lx1 - lx0 + 1), 1, 3, RE);
  } },

{ n: '新天鵝堡', lo: 2.2, hi: 15.5, pal: [0xebe6dc, 0x948d82, 0x324250, 0x5c6e7e, 0x1d242a, 0xcba658, 0x685443],
  /* 來源：blueprints/新天鵝堡.js（v1.66 換掉原本那份）。
     dim 的下限一律乘 0.7：原稿的下限撐著，最小就是 4450／4055 塊，
     連預設的 3000 那一檔都做不到（面板的 1800／3000 按下去沒反應）。
     下限只在 s 小的時候綁得住，所以 9000 那一檔的造型一格都沒變。 */
  gen(v, s) {
    // === 1. 尺度定義：長寬拉伸、主塔修長化 ===
    // 主宮殿 (Palas) - 寬度大、進深適中、高聳
    const mw = dim(s, 4.40, 12, true); // 主宮殿正面總寬 (X軸)
    const md = dim(s, 1.80, 5, true);  // 主宮殿進深 (Z軸)
    const mh = dim(s, 3.40, 9);       // 主宮殿牆高
    const mx = -dim(s, 1.60, 4);       // 主宮殿偏左

    // 附屬多層門樓 (右側低翼)
    const aw = dim(s, 2.60, 6, true);  // 附屬樓寬
    const ad = dim(s, 1.40, 4);        // 附屬樓深
    const ah = dim(s, 1.60, 4);        // 附屬樓高 (明顯低於主樓)
    const ax = mx + (mw + aw) / 2 - 1; // 銜接主樓
    const az = dim(s, 0.40, 1);

    // 右側獨立守衛圓塔 (Gate Tower - 纖細挺拔)
    const gr = dim(s, 0.38, 1);        // 守衛塔半徑
    const gh = dim(s, 2.80, 8);       // 守衛塔高
    const gx = ax + Math.round(aw / 2) + gr + 1;
    const gz = az;

    // 後方最高主塔 (Main Bergfried - 纖細、超高、尖刺錐頂)
    const tr = dim(s, 0.46, 1);        // 塔身半徑 (收細)
    const th = dim(s, 5.20, 14);       // 極高塔身
    const tx = mx - Math.round(mw * 0.26);
    const tz = -Math.round((md - 1) / 2) - 1;

    // 基座高度
    const baseH = dim(s, 0.80, 2);

    // === 2. 粗石高台基座 ===
    v.box(mx, 0, 0, mw + 4, baseH + 1, md + 4, 1);
    v.box(ax, 0, az, aw + 3, baseH + 2, ad + 3, 1);
    v.cyl(gx, 0, gz, gr + 2, baseH + 3, 1);

    // === 3. 建築主體牆面 ===
    v.walls(mx, baseH, 0, mw, mh, md, 0, 1);
    v.walls(ax, baseH + 1, az, aw, ah, ad, 0, 1);

    // 水平腰線（主樓雙層線腳）
    const y1 = baseH + Math.round(mh * 0.35);
    const y2 = baseH + Math.round(mh * 0.70);
    v.box(mx, y1, 0, mw + 1, 1, md + 1, 1);
    v.box(mx, y2, 0, mw + 1, 1, md + 1, 1);
    v.box(ax, baseH + Math.round(ah * 0.55), az, aw + 1, 1, ad + 1, 1);

    // === 4. 立面窗列（密集羅曼式雙聯拱窗） ===
    const frontZ = Math.round((md - 1) / 2);
    const wCols = dim(s, 1.00, 4);
    const wStep = dim(s, 0.55, 2);

    [baseH + 2, y1 + 2, y2 + 2].forEach(wy => {
      windowGrid(v, {
        x: mx, y: wy, z: frontZ,
        cols: wCols, rows: 1,
        stepX: wStep, stepY: 3,
        w: 1, h: dim(s, 0.32, 1), c: 4, axis: 'x'
      });
    });

    // 附屬樓正面窗
    const affFrontZ = az + Math.round((ad - 1) / 2);
    windowGrid(v, {
      x: ax, y: baseH + 2, z: affFrontZ,
      cols: dim(s, 0.50, 1), rows: 2,
      stepX: dim(s, 0.55, 2), stepY: dim(s, 0.55, 2),
      w: 1, h: 2, c: 4, axis: 'x'
    });

    // === 5. 正面凸窗/觀景陽台 (Erker) ===
    const erkW = dim(s, 0.55, 2, true);
    const erkH = dim(s, 0.65, 2);
    const erkX = mx - Math.round(mw * 0.28);
    v.box(erkX, y1, frontZ + 1, erkW, erkH, 2, 0);
    v.box(erkX, y1 - 1, frontZ + 1, erkW, 1, 2, 1); // 下方托架
    v.box(erkX, y1 + erkH, frontZ + 1, erkW, 1, 2, 5); // 上方金色欄杆

    // === 6. 屋頂系統（修正山牆方向與去除浮空格） ===
    const roofY = baseH + mh;
    v.box(mx, roofY, 0, mw + 2, 1, md + 2, 1); // 頂層壓頂

    // 正確的雙坡斜頂（進深方向收縮，坡面朝向正面）
    const rH = Math.round((md + 2) / 2);
    for (let r = 0; r < rH; r++) {
      const curD = (md + 2) - r * 2;
      if (curD > 0) {
        v.box(mx, roofY + 1 + r, 0, mw + 2, 1, curD, 2);
      }
    }

    // 左側尖頂山牆裝飾（只在左端面生長，完全服貼不懸空）
    for (let r = 0; r < rH + 1; r++) {
      const curD = (md + 2) - r * 2;
      if (curD > 0) {
        v.box(mx - Math.round((mw + 1) / 2), roofY + 1 + r, 0, 1, 1, curD, 1);
      }
    }

    // 附屬樓四坡頂 (Hip Roof)
    const affRoofY = baseH + 1 + ah;
    v.box(ax, affRoofY, az, aw + 2, 1, ad + 2, 1);
    hipRoof(v, ax, affRoofY + 1, az, aw + 2, ad + 2, 2);

    // 正面老虎窗陣列 (Dormers)
    const dCount = dim(s, 0.55, 1);
    const dSpacing = Math.max(3, Math.floor((mw - 6) / dCount));
    for (let i = 0; i < dCount; i++) {
      const dx = mx - Math.floor(mw / 2) + 3 + i * dSpacing;
      v.box(dx, roofY + 2, frontZ - 1, 2, 2, 2, 0);
      v.gable(dx, roofY + 4, frontZ - 1, 2, 2, 2);
      tint(v, dx, roofY + 2, frontZ + 1, 4);
    }

    // === 7. 樓梯側塔 (Stair Tower - 纖細圓錐頂) ===
    const strR = dim(s, 0.38, 1);
    const strH = mh + dim(s, 1.10, 3);
    const strX = mx + Math.round(mw * 0.28);
    const strZ = frontZ;
    v.cyl(strX, baseH, strZ, strR, strH, 0, 1);
    v.cyl(strX, baseH + strH, strZ, strR + 0.8, 1, 3);
    const strSpireH = dim(s, 1.40, 4);
    v.taper(strX, baseH + strH + 1, strZ, strR + 0.8, 0.2, strSpireH, 2);
    v.box(strX, baseH + strH + 1 + strSpireH, strZ, 1, 2, 1, 5);

    // === 8. 後方最高主塔 (Main Bergfried - 哥德式細高針塔) ===
    v.cyl(tx, baseH, tz, tr + 0.8, 2, 1); // 粗厚石基
    v.cyl(tx, baseH + 2, tz, tr, th, 0, 1); // 纖細塔身

    // 塔腰觀景腰線
    v.cyl(tx, baseH + Math.round(th * 0.65), tz, tr + 0.6, 1, 3);

    // 塔頂雙層挑出平台與頂閣
    const topY = baseH + 2 + th;
    v.cyl(tx, topY, tz, tr + 0.8, 1, 1); // 下層外挑平台
    v.cyl(tx, topY + 1, tz, tr, dim(s, 0.70, 2), 0, 1); // 頂層閣樓
    v.cyl(tx, topY + 1 + dim(s, 0.70, 2), tz, tr + 0.8, 1, 3); // 頂層簷口

    // 極尖主錐頂與避雷針
    const mainSpireH = dim(s, 2.60, 6);
    v.taper(tx, topY + 2 + dim(s, 0.70, 2), tz, tr + 0.8, 0.1, mainSpireH, 2);
    v.box(tx, topY + 2 + dim(s, 0.70, 2) + mainSpireH, tz, 1, dim(s, 0.40, 2), 1, 5);

    // === 9. 右側守衛圓塔 (Gate Tower) ===
    v.cyl(gx, baseH + 3, gz, gr, gh, 0, 1);
    const gTopY = baseH + 3 + gh;
    v.cyl(gx, gTopY, gz, gr + 0.8, 1, 1); // 護牆挑簷
    const gSpireH = dim(s, 1.20, 3);
    v.taper(gx, gTopY + 1, gz, gr + 0.8, 0.2, gSpireH, 2);
    v.box(gx, gTopY + 1 + gSpireH, gz, 1, 2, 1, 5);

    // === 10. 主殿角落懸塔 (Bartizans) ===
    const bRad = 0.6;
    const bH = dim(s, 0.60, 1);
    corners4(v, Math.round((mw - 1) / 2), Math.round((md - 1) / 2), (vv, cx, cz) => {
      if (cx > 0 && cz > 0) return; // 避免撞到側塔
      const cornerX = mx + cx;
      const cornerZ = cz;
      vv.cyl(cornerX, roofY - 1, cornerZ, bRad + 0.4, 1, 1);
      vv.cyl(cornerX, roofY, cornerZ, bRad, bH, 0);
      vv.taper(cornerX, roofY + bH, cornerZ, bRad + 0.4, 0.1, dim(s, 0.65, 2), 2);
    });

    // === 11. 門廊與台階 ===
    const gateW = dim(s, 0.40, 2, true);
    const gateH = dim(s, 0.50, 1);
    arch(v, ax - 1, baseH + 1, affFrontZ, gateW, gateH, 1, 1);
    v.box(ax - 1, baseH + 1, affFrontZ + 1, gateW, gateH, 1, 6);
    const nStairs = dim(s, 0.25, 1);
    stairs(v, ax - 1, 0, affFrontZ + 1, nStairs, gateW + 2, 'z', 1);
  } },
{ n: '北京天壇', lo: 2.0, hi: 12.0, pal: [0xe5e1d8, 0x1e4b8f, 0xa82d22, 0xd6a838, 0x20737a, 0x1b1c24],
  /* 來源：AgentData/blueprints/北京天壇.js（v1.143 換掉原本那份）。dim 的下限一律乘 0.7（22 處）：原稿最小 3073 塊，1800 與 3000 兩檔按下去都沒反應。
     改完最小 1691、1800 那檔 1691、3000 那檔 2941，9000 那檔一格沒動（9031） */
  gen(v, s) {
    // === 尺寸參數（整體加寬、壓低高寬比，貼合真實圓形重簷攢尖比例） ===
    const bR1 = dim(s, 3.40, 9); // 下層漢白玉台基半徑（寬大宏偉）
    const bR2 = dim(s, 2.80, 8); // 中層台基半徑
    const bR3 = dim(s, 2.20, 6);  // 上層台基半徑
    const bH = dim(s, 0.35, 1);   // 每層台基高度

    const r0 = dim(s, 1.70, 4);   // 底層殿身主體半徑
    const flH = dim(s, 0.70, 2);  // 底層柱廊與格扇牆高

    const e1 = dim(s, 2.35, 6);   // 下層藍色重簷半徑（大幅外挑）
    const e2 = dim(s, 1.95, 5);   // 中層藍簷半徑
    const e3 = dim(s, 1.55, 4);   // 上層頂簷半徑

    /* 收坡的藍簷：一層一層的環（原本是 v.taper 給 shell 1），照原本的半徑算法。
       每一層的內緣伸到往上那一層的外緣，最上面那一層伸到接著要蓋的殿身（rNext）（v1.263.0）。
       原本一格厚的殼，相鄰兩層半徑一縮超過一格就上下疊不到：9000 那一檔中層藍簷以上 875 格
       懸空；收坡只有一層的小尺寸（s 2.84～3.22 那一段）頂層殿身也是浮的。
       試過「斜角碰得到就好、差兩格以內維持 1 格厚」：圓的取整讓那個估法不準，還有 343 個 s 懸空。
       見 開發筆記〈自訂藍圖調整一輪（v1.263.0）〉 */
    const slope = (y0, rA, rB, h, rNext) => {
      for (let k = 0; k < h; k++) {
        const r = rA + (rB - rA) * (h <= 1 ? 0 : k / (h - 1));
        const up = k < h - 1 ? rA + (rB - rA) * ((k + 1) / (h - 1)) : rNext;
        v.taper(0, y0 + k, 0, r, r, 1, 1, Math.max(1, r - up));
      }
    };

    // --- 1. 三層漢白玉圓形台基（含外圍欄杆望柱與四方踏道） ---
    let y = 0;
    const stW = dim(s, 0.65, 2, true);

    // 第一層（底層）
    v.cyl(0, y, 0, bR1, bH, 0);
    v.cyl(0, y + bH, 0, bR1, 1, 0, 1); // 欄杆
    stairs(v, 0, 0, -bR1 - bH, bH + 1, stW, 'z', 0);
    stairs(v, 0, 0, bR1 + 1, bH + 1, stW, '-z', 0);
    stairs(v, -bR1 - bH, 0, 0, bH + 1, stW, 'x', 0);
    stairs(v, bR1 + 1, 0, 0, bH + 1, stW, '-x', 0);
    /* 上一層從這一層的欄杆那一層起蓋，坐在這一層的實心頂面上，欄杆與上一層之間留著走道
       （v1.263.0）。原本是 y += bH + 1，上一層浮在欄杆那一層的上面——欄杆只是一圈環、
       裡面是空的，所以每一層都跟下一層空了一層：欄杆離得近的小尺寸靠斜角接著，s 一大就斷，
       整座殿連同上面的台基與三層藍簷懸空（10000 那一檔 3661 格；9000 那一檔是靠側面
       從地面蓋上來的踏道剛好接住）。殿座基腳也是同一件事，所以三處一起改。 */
    y += bH;

    // 第二層（中層）
    v.cyl(0, y, 0, bR2, bH, 0);
    v.cyl(0, y + bH, 0, bR2, 1, 0, 1); // 欄杆
    stairs(v, 0, y, -bR2 - bH, bH + 1, stW, 'z', 0);
    stairs(v, 0, y, bR2 + 1, bH + 1, stW, '-z', 0);
    stairs(v, -bR2 - bH, 0, 0, bH + 1, stW, 'x', 0);
    stairs(v, bR2 + 1, 0, 0, bH + 1, stW, '-x', 0);
    y += bH;

    // 第三層（上層）
    v.cyl(0, y, 0, bR3, bH, 0);
    v.cyl(0, y + bH, 0, bR3, 1, 0, 1); // 欄杆
    stairs(v, 0, y, -bR3 - bH, bH + 1, stW, 'z', 0);
    stairs(v, 0, y, bR3 + 1, bH + 1, stW, '-z', 0);
    stairs(v, -bR3 - bH, 0, 0, bH + 1, stW, 'x', 0);
    stairs(v, bR3 + 1, 0, 0, bH + 1, stW, '-x', 0);
    y += bH;

    // --- 2. 底層殿身（朱紅立柱、金格扇門窗、斗栱青綠彩畫）與下層大藍簷 ---
    // 殿座基腳（坐在上層台基面上，跟欄杆同一層）
    v.cyl(0, y, 0, r0, 1, 1);
    y += 1;

    // 朱紅外牆/立柱
    v.cyl(0, y, 0, r0, flH, 2, 2);

    // 外圈格扇窗的金色窗櫺紋理 (ringOf 點綴金框)
    const nPillars = Math.max(8, Math.round(r0 * 3));
    ringOf(v, nPillars, r0, (vv, px, pz, ang, idx) => {
      if (idx % 2 === 1) {
        for (let dy = 0; dy < Math.max(1, flH - 2); dy++) {
          tint(vv, px, y + 1 + dy, pz, 3);
        }
      }
    });

    // 正南主殿大門（石額框 + 門洞）
    const dw = dim(s, 0.45, 2, true);
    const dh = Math.max(2, flH - 1);
    arch(v, 0, y, -r0, dw, dh, 1, 5);

    // 簷下青綠斗栱彩畫飾帶 + 金色彩畫
    v.cyl(0, y + flH - 2, 0, r0 + 0.5, 1, 4, 1);
    v.cyl(0, y + flH - 1, 0, r0 + 0.8, 1, 3, 1);
    y += flH;

    // 中層、上層殿身半徑（收坡要知道上面接的是多大的殿身，所以先算）
    const r1 = Math.max(4, r0 - dim(s, 0.35, 1));
    const r2 = Math.max(3, r1 - dim(s, 0.35, 1));

    // 下層圓形大藍簷（雙層收坡，顯出飛簷出挑的弧度與平緩度）
    v.cyl(0, y, 0, e1, 1, 1);
    slope(y + 1, e1 - 0.5, r0, dim(s, 0.40, 1), r1);
    y += dim(s, 0.40, 1) + 1;

    // --- 3. 中層殿身與中層藍簷 ---
    const flH2 = Math.max(2, dim(s, 0.55, 1));

    // 中層殿身朱紅立柱
    v.cyl(0, y, 0, r1, flH2, 2, 2);
    // 中層斗栱青綠金飾帶
    v.cyl(0, y + flH2 - 1, 0, r1 + 0.5, 1, 4, 1);
    y += flH2;

    // 中層圓形藍簷
    v.cyl(0, y, 0, e2, 1, 1);
    slope(y + 1, e2 - 0.5, r1, dim(s, 0.35, 1), r2);
    y += dim(s, 0.35, 1) + 1;

    // --- 4. 上層殿身、穹頂頂簷與鎏金寶頂 ---
    const flH3 = Math.max(2, dim(s, 0.50, 1));

    // 上層殿身
    v.cyl(0, y, 0, r2, flH3, 2, 2);
    // 上層青綠彩畫
    v.cyl(0, y + flH3 - 1, 0, r2 + 0.5, 1, 4, 1);
    y += flH3;

    // 上層攢尖頂藍簷（深遠出挑簷口）
    v.cyl(0, y, 0, e3, 1, 1);
    y += 1;

    // 圓頂天穹（平緩圓弧形收尖屋脊）
    const domeH = dim(s, 0.90, 2);
    v.taper(0, y, 0, e3 - 0.5, 1.5, domeH, 1, 1);
    y += domeH;

    // 鎏金寶頂座（黃金承盤座）
    const goldSeatR = dim(s, 0.35, 1.8);
    v.cyl(0, y, 0, goldSeatR, 1, 3);
    y += 1;

    // 鎏金寶頂（圓潤金球）
    const goldR = dim(s, 0.40, 1.4);
    blob(v, 0, y + goldR, 0, goldR, goldR * 1.25, goldR, 3);
  } },

{ n: '吳哥窟', lo: 2.0, hi: 13,
  // v1.285.0 整座重畫（見 開發筆記〈還很粗糙的七座重畫〉）
  pal: [0x7f786b,   // 0 砂岩（灰，主色）
        0x5d574d,   // 1 砂岩暗一階：地衣流痕、迴廊裡背光的內牆
        0x9d9584,   // 2 砂岩亮一階：線腳、塔身一圈圈的收分、踏面
        0x8a5a3e,   // 3 紅土石（laterite）：台基、池岸
        0x4e4b46,   // 4 迴廊屋頂（深灰）
        0x2f2c28,   // 5 門洞、窗洞
        0x3e6f69],  // 6 水：參道兩側的倒影池、十字迴廊的四個水池
  gen(v, s) {
    /* 正面（−z，西）：最前面一條長參道（兩側那伽護欄）接十字形榮譽台，後面是又長又低的第一層迴廊
         （柱廊＋深灰屋頂，中間三座門樓），再往後第二層、第三層一層比一層高，頂上五座蓮苞塔
         （正面看得到三座，中央那座最高）；整體寬約中央塔高的 3 倍
       側面：三層台一路往後（+z）爬高，Bakan 台基又陡又高，塔群偏在整座的後半段，前面拖著參道
       三樣識別物：梅花形五座蓮苞塔（松果輪廓、一圈圈水平線腳）、三層一圈套一圈的長方形迴廊、
         正門前的長參道＋那伽護欄＋十字形榮譽台
       部件：參道(台＋鋪面) 那伽護欄(兩側＋前端昂起的蛇頭) 藏經閣×2(台＋十字形殿身＋疊頂) 倒影池×2
         十字形榮譽台(台＋護欄) 第一層台基(紅土石) 第一層迴廊(柱廊＋暗內牆＋疊澀屋頂) 西面三座門樓
         南北東三座門樓 四角角亭 十字迴廊 Preah Poan(田字形四條廊＋四個水池)
         第二層台基(紅土石＋線腳＋三面階梯) 第二層迴廊(外牆窗洞＋內側柱列＋屋頂) 四座門樓 四角截頂角塔
         Bakan 陡台基(分階、每面三道陡梯) 第三層迴廊 四座門樓 十字軸廊 中央聖殿台 五座蓮苞塔(殿身＋松果塔) */

    // 尺寸一律用實物公尺換算：M(公尺, 下限)；係數之間的比例就是吳哥窟的長相
    const M = (m, lo, odd) => dim(s, m * 0.04, lo, odd);
    const Mf = (m, lo) => Math.max(lo, s * m * 0.04);     // 不取整：塔的半徑（塊數才連續）
    // 固定雜湊：同一格每次都一樣。石頭一邊蓋一邊挑色，不整份重掃
    const H = (x, y, z) => (((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) >>> 0) % 100;
    /* 砂岩：(x, z) 同一直行抽到的整條偏暗＝從上往下的地衣流痕（吳哥窟最明顯的質感）；
       其餘逐格挑亮／暗。t = 2 是線腳那一層，亮為主 */
    const st = (x, y, z, t) => {
      const h = H(x, y, z);
      if (H(x, 7, z) < 11 && h < 80) return 1;
      if (t === 2) return h < 28 ? 0 : 2;
      return h < 20 ? 2 : h < 31 ? 1 : 0;
    };
    const lat = (x, y, z) => H(x, y, z) < 18 ? 1 : 3;
    const roof = (x, y, z) => H(x, y, z) < 20 ? 1 : 4;
    const S = (x, y, z, t) => v.set(x, y, z, st(x, y, z, t || 0));

    /* 長方形環：x∈[xa,xb]、z∈[za,zb]，k ＝ 離外緣第幾格，a ＝ 沿著那一邊走的座標（排柱子用）。
       只走環上的格子，中庭直接跳過 */
    const ring = (xa, xb, za, zb, T, ya, yb, prof) => {
      for (let z = za; z <= zb; z++) {
        const kz = Math.min(z - za, zb - z);
        for (let x = xa; x <= xb; x++) {
          const kx = Math.min(x - xa, xb - x);
          if (kz >= T && kx >= T) { x = xb - T; continue; }
          const k = Math.min(kx, kz), a = kx <= kz ? z : x;
          for (let y = ya; y <= yb; y++) { const c = prof(k, a, y, x, z); if (c >= 0) v.set(x, y, z, c); }
        }
      }
    };
    /* 迴廊斷面：外側（柱列 col／有窗洞的牆 wall）→ 走道 → 內側。
       屋頂是一層一層往中線收的疊澀頂：第一層整片、往上每層兩邊各收一格 */
    const nrOf = T => T >= 5 ? 3 : T >= 3 ? 2 : 1;
    const gal = (y0, hc, T, out, inn) => (k, a, y, x, z) => {
      const yb = y - y0;
      if (yb < hc) {
        // 只有一格厚（小尺寸）時，柱間塗暗色當成看進去的廊道，不挖空——挖了會直接看穿到中庭
        if (k === 0) return out === 'col' ? ((a & 1) ? (T === 1 ? (H(x, y, z) < 40 ? 5 : 1) : -1) : st(x, y, z, 0))
          : (yb === Math.max(0, hc - 2) && ((a % 3) + 3) % 3 === 0 ? 5 : st(x, y, z, 0));
        if (k === T - 1) return inn === 'col' ? ((a & 1) ? -1 : st(x, y, z, 0)) : (H(x, y, z) < 35 ? 5 : 1);
        return -1;
      }
      const r = yb - hc;
      if (r === 0) return roof(x, y, z);
      if (k >= r && k <= T - 1 - r) return roof(x, y, z);
      if (r === 1 && T === 2 && k === 1) return roof(x, y, z);
      return -1;
    };
    /* 一條直的廊（十字迴廊、Bakan 頂上的軸廊）：寬 gw（奇數），hp 層紅土石台、兩側柱列、屋頂 */
    const lineGal = (ax, c, t0, t1, gw, y0, hp, hc) => {
      const hg = (gw - 1) / 2;
      for (let t = t0; t <= t1; t++) for (let u = -hg; u <= hg; u++) {
        const x = ax === 'z' ? c + u : t, z = ax === 'z' ? t : c + u;
        for (let y = y0; y < y0 + hp; y++) v.set(x, y, z, lat(x, y, z));
        const yb = y0 + hp;
        if (Math.abs(u) === hg && !(t & 1)) for (let y = yb; y < yb + hc; y++) S(x, y, z, 0);
        v.set(x, yb + hc, z, roof(x, yb + hc, z));
        if (hg >= 1 && Math.abs(u) < hg) v.set(x, yb + hc + 1, z, roof(x, yb + hc + 1, z));
      }
    };
    /* 門樓／角亭：四角各缺一格的十字形殿身（門廊往四面伸），上面一層一層收的十字疊頂、頂上一顆蓮苞。
       門洞用暗色塗，不挖穿——挖穿會看到後面的草地。base 給了就從地面墊到 y0（伸出台基的門廊才站得住） */
    const pav = (xc, zc, y0, hx, hz, hb, tiers, door, base) => {
      const notch = (ax, az, X, Z) => X > 1 && Z > 1 && ax === X && az === Z;
      for (let dx = -hx; dx <= hx; dx++) for (let dz = -hz; dz <= hz; dz++) {
        const ax = Math.abs(dx), az = Math.abs(dz), x = xc + dx, z = zc + dz;
        if (notch(ax, az, hx, hz)) continue;
        if (base) for (let y = 0; y < y0; y++) v.set(x, y, z, lat(x, y, z));
        for (let y = y0; y < y0 + hb; y++)
          v.set(x, y, z, (door === 'z' ? az === hz && ax <= (hx >= 3 ? 1 : 0)
                                       : door === 'x' && ax === hx && az <= (hz >= 3 ? 1 : 0)) && y < y0 + hb - 1 ? 5
                         : st(x, y, z, y === y0 + hb - 1 ? 2 : 0));
      }
      let y = y0 + hb;
      for (let i = 0; i < tiers; i++, y++) {
        const X = hx - i, Z = hz - i;
        if (X < 0 || Z < 0) break;
        for (let dx = -X; dx <= X; dx++) for (let dz = -Z; dz <= Z; dz++) {
          if (notch(Math.abs(dx), Math.abs(dz), X, Z)) continue;
          v.set(xc + dx, y, zc + dz, roof(xc + dx, y, zc + dz));
        }
      }
      v.set(xc, y, zc, st(xc, y, zc, 2));                     // 頂上的蓮苞
    };
    // 塔的殿身：四角缺角的方塊，四面門洞
    const body = (xc, y0, zc, hw, hb) => {
      for (let dx = -hw; dx <= hw; dx++) for (let dz = -hw; dz <= hw; dz++) {
        const ax = Math.abs(dx), az = Math.abs(dz);
        if (hw >= 2 && ax === hw && az === hw) continue;
        for (let y = y0; y < y0 + hb; y++) {
          const door = ((ax === hw && dz === 0) || (az === hw && dx === 0)) && y < y0 + hb - 1;
          v.set(xc + dx, y, zc + dz, door ? 5 : st(xc + dx, y, zc + dz, y === y0 + hb - 1 ? 2 : 0));
        }
      }
    };
    /* 蓮苞塔（prasat）：平面是四角一階一階切掉的十字（|x|+|z| 的上限切出階梯角），
       立面每 tb 層一圈往外凸的亮色線腳，輪廓先微鼓再收成松果尖。cut 給了就截頂（第二層的角塔）。
       半徑大的時候中空（看不到裡面）：一格一格往上收，上一層一定蓋得住下一層的洞 */
    const inPlan = (ax, az, r) => (ax > az ? ax : az) <= r + 0.35 && ax + az <= r * 1.45 + 0.45;
    const spire = (xc, y0, zc, R, hs, cut) => {
      const tb = R >= 3 ? 3 : 2, top = cut ? Math.max(2, Math.round(hs * cut)) : hs;
      for (let j = 0; j < top; j++) {
        const t = hs > 1 ? j / (hs - 1) : 1;
        let r = R * (1 + 0.1 * Math.sin(Math.PI * t)) * Math.pow(Math.max(0, 1 - Math.pow(t, 1.6)), 0.7);
        const mold = j % tb === tb - 1 && j < top - 1;
        if (mold) r += 0.5;
        const n = Math.ceil(r + 0.5), ri = r - 1.5, y = y0 + j;
        for (let dx = -n; dx <= n; dx++) for (let dz = -n; dz <= n; dz++) {
          const ax = Math.abs(dx), az = Math.abs(dz);
          if (!inPlan(ax, az, r)) continue;
          if (ri > 0.8 && j < top - 1 && inPlan(ax, az, ri)) continue;
          v.set(xc + dx, y, zc + dz, st(xc + dx, y, zc + dz, mold ? 2 : 0));
        }
      }
    };

    // ── 尺寸 ─────────────────────────────────────────────
    /* 第三層（Bakan）：實物 60 m 見方，坐在很陡的台基上，台頂離地約 23 m。
       取 64 m、下限 9 格：再小的話角塔（3 格寬）跟中央塔中間空不出一格，五座塔糊成一座小山（1800 檔實測過） */
    const A3 = M(64, 9, true), h3 = (A3 - 1) / 2, G3 = M(7, 1), hc3 = M(4.6, 1), cl3 = Math.floor((G3 - 1) / 2);
    const run3 = M(6, 1), hB = h3 + run3;
    // 第二層：100 × 115 m，台基約 9 m；中庭在地面高度（只畫迴廊底下那一圈台基）
    const G2 = M(8, 1), hc2 = M(5.5, 1), ht2 = M(9, 1), cl2 = Math.floor((G2 - 1) / 2);
    const HB = ht2 + M(14, 2);                              // Bakan 台基從地面算的總高
    const Ls = Math.max(1, Math.round(HB * 0.25));          // Bakan 陡梯伸出台基外幾格
    const gap2 = hB + Ls + G2;                              // 中庭至少留得下 Bakan 的梯腳
    const hw2 = Math.max((M(100, 9, true) - 1) / 2, gap2);
    const b2 = Math.max(gap2, M(49.5, 1));                 // Bakan 偏東：西側的中庭比較深
    const f2 = Math.min(-gap2 - 1, b2 - M(115, 10) + 1);
    // 第一層：187 × 215 m（正面寬 187、深 215）
    const G1 = M(9, 1), T1 = G1, hp1 = M(3.5, 1), hc1 = M(5.2, 1), cl1 = Math.floor((G1 - 1) / 2);
    const hw1 = Math.max((M(187, 17, true) - 1) / 2, hw2 + 3 + T1);
    const b1 = b2 + Math.max(M(40, 1), T1 + 3);
    const f1 = Math.min(b1 - M(215, 19) + 1, f2 - T1 - 6);
    // 榮譽台與參道（參道實物 350 m，壓成 85 m，不然整座被拉得太長、場地也放不下）
    const Lt = M(32, 3), zT1 = f1 - 1, zT0 = zT1 - Lt + 1;
    const Lc = M(85, 7), zC1 = zT0 - 1, zC0 = zC1 - Lc + 1;
    const hcw = (M(9.5, 3, true) - 1) / 2;

    // ── 1. 倒影池（參道兩側、榮譽台前）：紅土石池岸＋水面 ─────────
    const pz1 = zT0 - M(8, 1), pz0 = pz1 - M(46, 4) + 1;
    const px0 = hcw + M(20, 2), px1 = px0 + M(42, 3) - 1;
    for (let x = px0; x <= px1; x++) for (let z = pz0; z <= pz1; z++) {
      const rim = x === px0 || x === px1 || z === pz0 || z === pz1;
      v.set(x, 0, z, rim ? 3 : 6); v.set(-x, 0, z, rim ? 3 : 6);
    }
    // 藏經閣：實物在參道半路上、比倒影池更前面；這裡貼在池子前面，空間不夠（最小那幾檔）就不蓋
    const hxL = M(9, 1), hzL = M(6, 1), zL = pz0 - 2 - hzL, libOk = zL - hzL > zC0;
    const xL = hcw + M(16, 2) + hxL;

    // ── 2. 參道：一層高的石台、兩側那伽護欄（隔一段留一個側梯口）、前端蛇頭昂起 ─────────
    for (let z = zC0; z <= zC1; z++) for (let x = -hcw; x <= hcw; x++) S(x, 0, z, Math.abs(x) < hcw ? 2 : 0);
    const gStep = Math.max(4, M(50, 4));
    for (let z = zC0 + 1; z <= zC1; z++) {
      if (libOk && z === zL) continue;                          // 通往藏經閣的步道口
      if ((zC1 - z) % gStep === Math.floor(gStep / 2)) {        // 側梯口：護欄斷開、外面一格踏步
        S(hcw + 1, 0, z, 1); S(-hcw - 1, 0, z, 1); continue;
      }
      S(hcw, 1, z, 2); S(-hcw, 1, z, 2);
    }
    const fh = M(4, 2), fw = M(2, 1);                         // 七頭那伽：前端往上昂、往外張開的扇
    for (let sg = -1; sg <= 1; sg += 2) {
      for (let y = 1; y <= fh; y++) S(sg * hcw, y, zC0, 2);
      for (let i = 1; i <= fw; i++) { S(sg * (hcw + i), fh, zC0, 2); S(sg * (hcw + i), fh - 1, zC0, 2); }
    }

    // ── 3. 藏經閣（參道兩側）：小台座、十字形殿身、兩層疊頂，一條步道接回參道 ─────────
    if (libOk) for (let sg = -1; sg <= 1; sg += 2) {
      for (let x = hcw + 1; x < xL - hxL; x++) S(sg * x, 0, zL, 2);
      pav(sg * xL, zL, 1, hxL, hzL, M(5, 1), 2, 'x', true);
    }

    // ── 4. 十字形榮譽台：與迴廊台基同高，邊上一圈那伽護欄（正面中間、橫臂兩端留梯口） ─────────
    const hst = (M(14, 3, true) - 1) / 2, har = (M(46, 7, true) - 1) / 2, dar = M(12, 2);
    const zA0 = Math.round((zT0 + zT1 - dar) / 2), zA1 = zA0 + dar - 1;
    const inT = (x, z) => z > zT1 || (z >= zT0 && ((Math.abs(x) <= hst) || (Math.abs(x) <= har && z >= zA0 && z <= zA1)));
    for (let z = zT0; z <= zT1; z++) for (let x = -har; x <= har; x++) {
      if (!inT(x, z)) continue;
      for (let y = 0; y < hp1; y++) v.set(x, y, z, y === hp1 - 1 ? st(x, y, z, 2) : lat(x, y, z));
      const edge = !inT(x - 1, z) || !inT(x + 1, z) || !inT(x, z - 1) || !inT(x, z + 1);
      const open = (z === zT0 && Math.abs(x) <= Math.max(0, hst - 1)) || Math.abs(x) === har;
      if (edge && !open) S(x, hp1, z, 2);
    }

    // ── 5. 第一層：紅土石台基＋迴廊（外側柱廊、背光的內牆、疊澀屋頂） ─────────
    ring(-hw1, hw1, f1, b1, T1, 0, hp1 - 1, (k, a, y, x, z) => (y === hp1 - 1 && hp1 > 1) ? st(x, y, z, 2) : lat(x, y, z));
    ring(-hw1, hw1, f1, b1, T1, hp1, hp1 + hc1 + nrOf(T1) - 1, gal(hp1, hc1, T1, 'col', 'wall'));
    // 西面正門：中間一座大門樓（三層疊頂）、兩側各一座小的；南北東各一座；四角角亭
    const hxW = M(14, 2), xS = M(30, 4), hxS = M(7, 1);
    pav(0, f1 + cl1, hp1, hxW, M(9, 1), hc1 + M(3, 1), 3, 'z', true);
    for (let sg = -1; sg <= 1; sg += 2) {
      // 兩側小門樓：跟中間那座之間至少要空一格才擺（小尺寸擠在一起只會糊成一塊）
      if (xS - hxS >= hxW + 2) pav(sg * xS, f1 + cl1, hp1, hxS, M(6, 1), hc1 + 1, 2, 'z', true);
      pav(sg * (hw1 - cl1), 0, hp1, M(6, 1), M(10, 1), hc1 + 1, 2, 'x', true);
      pav(sg * (hw1 - cl1), f1 + cl1, hp1, M(8, 1), M(8, 1), hc1 + 1, 2, '', true);
      pav(sg * (hw1 - cl1), b1 - cl1, hp1, M(8, 1), M(8, 1), hc1 + 1, 2, '', true);
    }
    pav(0, b1 - cl1, hp1, M(10, 1), M(6, 1), hc1 + 1, 2, 'z', true);

    // ── 6. 十字迴廊 Preah Poan：田字形四條廊，圍出四個水池 ─────────
    const zc0 = f1 + T1, zc1 = f2 - 2, hwC = Math.max(3, M(27, 3)), zMid = Math.round((zc0 + zc1) / 2);
    const gc = M(7, 1, true), hgc = (gc - 1) / 2;
    for (let x = -hwC + hgc + 1; x <= hwC - hgc - 1; x++) for (let z = zc0; z <= zc1 - hgc - 1; z++) {
      if (Math.abs(x) <= hgc || Math.abs(z - zMid) <= hgc) continue;
      v.set(x, 0, z, 6);
    }
    for (const c of [-hwC, 0, hwC]) lineGal('z', c, zc0, zc1, gc, 0, hp1, hc1);
    lineGal('x', zMid, -hwC, hwC, gc, 0, hp1, hc1);
    lineGal('x', zc1 - hgc, -hwC, hwC, gc, 0, hp1, hc1);

    // ── 7. 第二層：迴廊底下一圈台基（外緣多一格台階）＋迴廊（外牆開窗、內側柱列） ─────────
    const T2 = G2 + 1;
    ring(-hw2 - 1, hw2 + 1, f2 - 1, b2 + 1, T2, 0, ht2 - 1, (k, a, y, x, z) =>
      (k === 0 || k === T2 - 1) ? (y === ht2 - 1 ? st(x, y, z, 2) : lat(x, y, z)) : (y === ht2 - 1 ? st(x, y, z, 0) : -1));
    const sw2 = M(6, 1, true);
    stairs(v, 0, 0, b2 + 1 + ht2, ht2, sw2, '-z', 2);
    stairs(v, hw2 + 1 + ht2, 0, 0, ht2, sw2, '-x', 2);
    stairs(v, -hw2 - 1 - ht2, 0, 0, ht2, sw2, 'x', 2);
    ring(-hw2, hw2, f2, b2, G2, ht2, ht2 + hc2 + nrOf(G2) - 1, gal(ht2, hc2, G2, 'wall', 'col'));
    pav(0, f2 + cl2, ht2, M(8, 1), M(6, 1), hc2 + 1, 2, 'z');
    pav(0, b2 - cl2, ht2, M(8, 1), M(6, 1), hc2 + 1, 2, 'z');
    /* 四角的角塔（第二層迴廊四角確實有塔，見 Notre Dame 建築圖庫的老照片說明）。
       實際高度查不到可靠數字，這裡做成殿身加半截塔、明顯比上面的梅花五塔矮，免得正面多冒出兩座搶戲 */
    const R2 = Mf(4.5, 1), hw2T = Math.max(1, Math.round(R2));
    for (let sg = -1; sg <= 1; sg += 2) {
      pav(sg * (hw2 - cl2), 0, ht2, M(6, 1), M(8, 1), hc2 + 1, 2, 'x');
      for (const zz of [f2 + cl2, b2 - cl2]) {
        body(sg * (hw2 - cl2), ht2, zz, hw2T, hc2 + 1);
        spire(sg * (hw2 - cl2), ht2 + hc2 + 1, zz, R2, M(16, 2), 0.55);
      }
    }

    // ── 8. Bakan：分階的陡台基（每階頂一圈亮線腳），每面三道陡梯 ─────────
    const yT = HB;
    const topK = k => Math.round(HB * Math.min(k + 1, run3 + 1) / (run3 + 1)) - 1;
    for (let x = -hB; x <= hB; x++) for (let z = -hB; z <= hB; z++) {
      const k = Math.min(hB - Math.abs(x), hB - Math.abs(z));
      const y1 = topK(k), ya = k === 0 ? 0 : Math.min(topK(k - 1), y1);
      for (let y = ya; y <= y1; y++) S(x, y, z, y === y1 ? 2 : 0);
    }
    // 陡梯：每面中間一道寬的、對著角塔兩道窄的（實物 12 道，爬起來幾乎是垂直的）
    const L3 = Ls + run3, swC = (M(5, 1, true) - 1) / 2, sOff = h3 - cl3;
    for (let d = 0; d < L3; d++) {
      const top = Math.ceil(HB * (d + 1) / L3) - 1, q = -hB - Ls + d;
      for (const o of HB >= 4 ? [-sOff, 0, sOff] : [0]) {      // 台太矮（最小那幾檔）只留中間那道
        const hw = o === 0 ? swC : 0;
        for (let w = -hw; w <= hw; w++) for (let y = 0; y <= top; y++) {
          const c = y === top ? 2 : 1;
          v.set(o + w, y, q, c); v.set(o + w, y, -q, c); v.set(q, y, o + w, c); v.set(-q, y, o + w, c);
        }
      }
    }

    // ── 9. 第三層迴廊、四座門樓、十字軸廊、中央聖殿台 ─────────
    ring(-h3, h3, -h3, h3, G3, yT, yT + hc3 + nrOf(G3) - 1, gal(yT, hc3, G3, 'wall', 'col'));
    const hwP = Math.max(1, Math.min(M(12, 1), h3 - G3 - 1)), hpc = M(3, 1);
    const ga = M(6, 1, true);
    for (let sg = -1; sg <= 1; sg += 2) {
      if (h3 - G3 > hwP) {
        lineGal('z', 0, sg < 0 ? -(h3 - G3) : hwP + 1, sg < 0 ? -(hwP + 1) : h3 - G3, ga, yT, 0, hc3);
        lineGal('x', 0, sg < 0 ? -(h3 - G3) : hwP + 1, sg < 0 ? -(hwP + 1) : h3 - G3, ga, yT, 0, hc3);
      }
      pav(0, sg * (h3 - cl3), yT, M(6, 1), M(5, 1), hc3 + 1, 2, 'z');
      pav(sg * (h3 - cl3), 0, yT, M(5, 1), M(6, 1), hc3 + 1, 2, 'x');
    }
    for (let x = -hwP; x <= hwP; x++) for (let z = -hwP; z <= hwP; z++)
      for (let y = yT; y < yT + hpc; y++) S(x, y, z, y === yT + hpc - 1 ? 2 : 0);

    // ── 10. 梅花形五塔：四角四座、中央一座最高 ─────────
    const R3 = Mf(5.2, 1.1), hw3T = Math.max(1, Math.round(R3)), hs3 = M(24, 4);
    corners4(v, h3 - cl3, h3 - cl3, (vv, x, z) => {
      body(x, yT, z, hw3T, hc3 + 2);
      spire(x, yT + hc3 + 2, z, R3, hs3);
    });
    const RC = Mf(7, 1.4), hwCT = Math.max(1, Math.round(RC)), hbC = M(9, 2), hsC = M(32, 6);
    body(0, yT + hpc, 0, hwCT, hbC);
    spire(0, yT + hpc + hbC, 0, RC, hsC);
  } },

{ n: '雅典帕德嫩神廟', lo: 1.5, hi: 14, pal: [0xd6be92, 0x9e8760, 0x682a20, 0xebd8b7, 0x807869, 0x4a3f33],
  /* 來源：blueprints/帕德嫩神廟.js（v1.66 換掉原本那份）。
     dim 的下限一律乘 0.7：原稿的下限撐著，最小就是 4450／4055 塊，
     連預設的 3000 那一檔都做不到（面板的 1800／3000 按下去沒反應）。
     下限只在 s 小的時候綁得住，所以 9000 那一檔的造型一格都沒變。 */
  gen(v, s) {
    // 1. 希臘神殿經典黃金比例（寬:長約 4:9，柱身修長，低平山牆）
    const w = dim(s, 1.80, 11, true);        // 正面柱廊外寬（奇數）
    const d = dim(s, 4.00, 22, true);        // 側面柱廊長度（奇數）
    const ch = dim(s, 1.20, 4);              // 柱高（神廟立柱修長挺拔）
    const cr = Math.max(0.4, s * 0.05);      // 柱半徑

    // 2. 三層台基（Crepidoma：低層立階階梯）
    v.box(0, 0, 0, w + 4, 1, d + 4, 1);
    v.box(0, 1, 0, w + 2, 1, d + 2, 1);
    v.box(0, 2, 0, w, 1, d, 0);

    // 正面中央專屬參拜踏步
    const stepW = dim(s, 0.50, 4, true);
    v.box(0, 0, (d + 4) / 2, stepW + 2, 1, 1, 1);
    v.box(0, 1, (d + 2) / 2, stepW, 1, 1, 0);

    // 3. 內殿核心（Cella）—— 深縮在柱廊內，保留外圈迴廊（Peristyle）空間
    const cw = dim(s, 0.95, 5, true);
    const cd = dim(s, 2.70, 13, true);
    v.walls(0, 3, 0, cw, ch + 2, cd, 5, 1);
    // 前後內殿神門
    const gw = dim(s, 0.30, 1, true), gh = dim(s, 0.60, 2);
    mirrorZ(v, (cd - 1) / 2, (vv, dz) => {
      vv.carve(0, 3, dz, gw, gh, 2);
    });

    // 4. 周壁多立克柱群（前後 8 柱、兩側 17 柱經典排佈）
    const colY = 3;
    const spanX = (w - 2) / 2;
    const spanZ = (d - 2) / 2;

    // 前後 8 柱（等距排佈）
    const colsFront = 8;
    for (let i = 0; i < colsFront; i++) {
      const cx = -spanX + (i / (colsFront - 1)) * (spanX * 2);
      mirrorZ(v, spanZ, (vv, dz) => {
        vv.cyl(cx, colY, dz, cr, ch, 0);
        // 柱頭托座（Echinus）
        vv.box(cx, colY + ch, dz, 1, 1, 1, 3);
      });
    }

    // 兩側長邊柱列（補足 17 柱間距）
    const colsSide = 15;
    for (let j = 1; j <= colsSide; j++) {
      const cz = -spanZ + (j / (colsSide + 1)) * (spanZ * 2);
      mirrorX(v, spanX, (vv, dx) => {
        vv.cyl(dx, colY, cz, cr, ch, 0);
        vv.box(dx, colY + ch, cz, 1, 1, 1, 3);
      });
    }

    // 5. 柱頂楣樑（Architrave）與 飾帶層（Frieze）
    const entY = colY + ch + 1;
    v.walls(0, entY, 0, w, 1, d, 0, 2);
    v.walls(0, entY + 1, 0, w, 1, d, 2, 2);

    // 三歧角雕節奏（Triglyph & Metope）
    const numTrig = dim(s, 0.75, 5);
    for (let i = 0; i <= numTrig; i++) {
      const tx = -spanX + (i / numTrig) * (spanX * 2);
      mirrorZ(v, spanZ + 0.5, (vv, dz) => {
        vv.box(tx, entY + 1, dz, 1, 1, 1, 0);
      });
    }

    // 6. 簷口壓頂（Cornice）
    const corniceY = entY + 2;
    v.walls(0, corniceY, 0, w + 2, 1, d + 2, 0, 2);

    // 7. 古希臘低斜度雙坡屋頂（Classical Low-pitch Roof）
    // 希臘神廟屋頂為平緩三角（約 14°），每上升 1 格寬度大幅收縮
    const roofY = corniceY + 1;
    const roofH = Math.max(2, Math.round(w / 5));

    for (let y = 0; y < roofH; y++) {
      // 坡度平緩收縮：每層縮 3~4 格寬度
      const curW = Math.max(1, (w + 2) - Math.round(y * ((w + 2) / roofH)));
      v.box(0, roofY + y, 0, curW, 1, d + 2, 4);

      // 前後山牆三角形填壁（Tympanum）與高光雕像
      mirrorZ(v, (d + 2) / 2, (vv, dz) => {
        vv.box(0, roofY + y, dz, curW, 1, 1, 2);
        // 浮雕群像（正面中央）
        if (curW >= 3) {
          vv.box(0, roofY + y, dz + Math.sign(dz) * 1, curW - 2, 1, 1, 3);
        }
      });
    }

    // 8. 希臘神廟頂飾與角飾（Acroteria）
    const peakY = roofY + roofH;
    // 前後山尖中央大角飾
    mirrorZ(v, (d + 2) / 2 + 0.5, (vv, dz) => {
      vv.box(0, peakY, dz, 1, 2, 1, 3);
      vv.box(0, peakY + 1, dz, 3, 1, 1, 3);
    });

    // 屋簷四角羽狀小角飾
    corners4(v, (w + 2) / 2, (d + 2) / 2, (vv, x, z) => {
      vv.box(x, roofY, z, 1, 2, 1, 3);
    });
  } },
{ n: '倫敦眼摩天輪',
  // v1.257.0 整座重畫（見 開發筆記〈舊版 21 座重畫、偏白的 5 座調色〉）
  // 倫敦眼摩天輪（整座重畫）
  // 正面（−z，泰晤士河那一側）：一個正圓大輪，外圈掛一圈蛋形玻璃車廂，輻條細細地收到中心的輪轂；
  //   輪子後面露出兩支往下張開的斜撐腳；最底下是伸進河裡的上下客平台與河水
  // 側面（+x）：輪子很薄，車廂沿輪軸方向前後凸出；輪軸往後（+z）接到 A 字形斜撐的頂點，
  //   斜撐腳往後下方斜插進岸上，再拉兩條背索到更後面的錨座——整個輪子是從一側懸臂撐出去的
  // 三樣識別物：白色大輪圈＋細輻條、只在一側（岸那邊）的 A 字斜撐腳、掛在輪圈外側的 32 個蛋形玻璃車廂
  // 部件：輪圈外弦（前後兩圈） 輪圈內弦 桁架斜桿 輻條（前後交錯收到輪轂兩端） 輪轂 輪軸
  //   車廂（玻璃＋白色底座與端環） 車廂吊架 A 字斜撐兩腳(limb) 斜撐橫桿 頂點軸套 背索 錨座 腳座
  //   上下客平台（棧橋＋樁＋欄杆） 河堤 泰晤士河 岸上的行道樹
  lo: 6, hi: 46,
  pal: [0xe6ebee,   // 0 白：輪圈外弦、斜撐腳、車廂底座與端環
        0xa3afb8,   // 1 淺灰：輻條、內弦、桁架、欄杆、吊架（白色結構的陰影色階）
        0x56616b,   // 2 深鋼灰：輪轂、輪軸、背索、樹幹
        0x7cc4de,   // 3 車廂玻璃
        0x2d5f86,   // 4 泰晤士河
        0xa5947a,   // 5 河堤石、棧橋、錨座
        0x4d7d38],  // 6 岸上的行道樹
  gen(v, s) {
    const TAU = Math.PI * 2;
    const R = s;                                        // 輪圈外弦半徑（不取整）
    const cr = Math.max(1.45, R * 0.055);               // 車廂半徑（截面；1.45 起跳，正面看才是方圓而不是十字）
    const cl = Math.max(1.7, R * 0.085);                // 車廂半長（沿輪軸 z）
    const cy = Math.round(R + 0.6 + cr * 2 + 2);        // 輪心高：最底下那節車廂剛好落在平台上
    const rdz = R >= 30 ? 2 : 1;                        // 外弦前後各離中面幾格
    const rt = Math.max(2, R * 0.085);                  // 內弦往內縮多少
    const hl = Math.max(1.5, R * 0.11);                 // 輪轂半長（輻條從兩端出發）
    const rh = Math.max(1.2, R * 0.065);                // 輪轂半徑
    const az = Math.max(3, R * 0.24);                   // A 字頂點在輪子後面多遠
    const ring = (rr, z, hw, c) => {                    // 立在 x–y 平面上的一圈（帶狀判定，塊數連續）
      const n = Math.ceil(rr + hw) + 1, lo2 = (rr - hw) * (rr - hw), hi2 = (rr + hw) * (rr + hw);
      for (let x = -n; x <= n; x++) for (let y = -n; y <= n; y++) {
        const d2 = x * x + y * y;
        if (d2 < lo2 || d2 > hi2) continue;
        v.set(x, cy + y, z, c);
      }
    };
    const P = (rr, a, z) => [Math.cos(a) * rr, cy + Math.sin(a) * rr, z];

    // ── 1. 泰晤士河、河堤、上下客平台 ─────────────────────────
    const zWall = Math.round(cl + 2.5);                 // 河堤線：前面是河、後面是岸
    const xr = Math.round(R * 1.05);
    const dx = Math.max(3, Math.round(R * 0.42)), dz0 = -Math.round(cl + 1.5);
    const zf = Math.round(dz0 - Math.max(3, R * 0.28));
    for (let x = -xr; x <= xr; x++) for (let z = zf; z < zWall; z++) {
      if (Math.abs(x) <= dx && z >= dz0) continue;     // 平台底下看不到，不鋪水
      v.set(x, 0, z, 4);
    }
    v.box(0, 0, zWall, xr * 2 + 1, 2, 1, 5);            // 河堤
    v.box(0, 1, dz0 + (zWall - dz0) / 2, dx * 2 + 1, 1, zWall - dz0 + 1, 5);   // 棧橋平台
    rowOf(v, Math.max(2, Math.round(dx / 2.5)), (dx * 2) / Math.max(1, Math.round(dx / 2.5) - 1) || 1,
      (w, x) => { w.set(x, 0, dz0, 5); w.set(x, 0, zWall - 1, 5); });          // 樁
    for (let x = -dx; x <= dx; x++) if ((x + dx) % 2 === 0) v.set(x, 2, dz0, 1);   // 前緣欄杆
    v.box(0, 3, dz0, dx * 2 + 1, 1, 1, 1);

    // ── 2. 輪圈：前後兩圈外弦（白）＋中間一圈內弦（灰）＋之字形桁架 ───
    const hw = Math.max(0.62, R * 0.024);
    ring(R, -rdz, hw, 0);
    ring(R, rdz, hw, 0);
    ring(R - rt, 0, hw, 1);
    const ncap = Math.max(12, Math.min(32, Math.round(R * 1.45)));   // 真的是 32 節；3000 塊那一檔就湊滿
    for (let k = 0; k < ncap; k++) {
      const a0 = k / ncap * TAU, a1 = (k + 0.5) / ncap * TAU, a2 = (k + 1) / ncap * TAU;
      const m = P(R - rt, a1, 0), f = P(R, a0, -rdz), b = P(R, a2, rdz);
      v.line(m[0], m[1], m[2], f[0], f[1], f[2], 1);
      v.line(m[0], m[1], m[2], b[0], b[1], b[2], 1);
    }

    // ── 3. 輻條：像腳踏車輪，前後兩組交錯收到輪轂兩端 ───────────
    const nsp = 2 * Math.max(6, Math.round(R * 0.32));
    for (let k = 0; k < nsp; k++) {
      const a = (k + 0.25) / nsp * TAU, zh = k % 2 ? hl : -hl;
      const p0 = P(rh, a, zh), p1 = P(R - rt, a, 0);
      v.line(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], 1);
    }

    // ── 4. 輪轂＋輪軸（往後一路接到 A 字頂點） ─────────────────
    tubeZ(v, 0, cy, -Math.round(hl), rh, Math.round(hl) * 2 + 1, 2);
    const ra = Math.max(0.9, R * 0.04);
    tubeZ(v, 0, cy, -Math.round(hl) - 1, ra, Math.round(az + hl) + 3, 2);
    tubeZ(v, 0, cy, -Math.round(hl) - 1, Math.max(0.6, ra * 0.6), 1, 0);      // 輪軸前端的白色端蓋

    // ── 5. 車廂：掛在輪圈外側，長軸沿輪軸（z），玻璃為主、底座與兩端是白的 ───
    const rc = R + 0.6 + cr;
    for (let k = 0; k < ncap; k++) {
      const a = k / ncap * TAU - Math.PI / 2;           // 第 0 節在正下方（平台上）
      const c = P(rc, a, 0), r0 = P(R, a, 0);
      v.line(r0[0], r0[1], 0, c[0], c[1], 0, 1);         // 吊架
      const nx = Math.ceil(cr), nz = Math.ceil(cl);
      const cx0 = Math.round(c[0]), cy0 = Math.round(c[1]);
      for (let i = -nx; i <= nx; i++) for (let j = -nx; j <= nx; j++) for (let q = -nz; q <= nz; q++) {
        const e = (i * i + j * j) / (cr * cr) + (q * q) / (cl * cl);
        if (e > 1.06) continue;
        const col = j <= -cr * 0.55 ? 0 : Math.abs(q) >= cl - 0.5 ? 0 : 3;   // 底座、兩端白，其餘玻璃
        v.set(cx0 + i, cy0 + j, q, col);
      }
    }

    // ── 6. A 字斜撐：兩腳只在岸那一側（+z），從輪軸往後下方張開 ─────
    const fz = Math.round(az + cy * 0.45), fx = Math.max(3, R * 0.48);
    const rl = Math.max(1.0, R * 0.06);
    /* 斜撐腳是一根幾乎站著的斜柱：一層一層畫水平截面的圓，比 limb 掃整個包圍盒快十倍
       （limb 在 9000 那一檔吃掉整支 gen 三分之二的時間，fitScale 每試一個 s 就跑一次）。 */
    const leg = (x0, z0, x1, z1, yTop, r0, r1, c) => {
      for (let y = 0; y <= yTop; y++) {
        const t = y / yTop, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t, r = r0 + (r1 - r0) * t;
        const n = Math.ceil(r);
        for (let i = -n; i <= n; i++) for (let k = -n; k <= n; k++)
          if (i * i + k * k <= (r + 0.3) * (r + 0.3)) v.set(Math.round(x) + i, y, Math.round(z) + k, c);
      }
    };
    mirrorX(v, 1, (w, sx) => {
      leg(sx * fx, fz, sx * rl * 0.6, az, cy, rl * 1.15, rl * 0.9, 0);
      w.box(sx * fx, 0, fz, Math.round(rl * 2) + 2, 1, Math.round(rl * 2) + 2, 5);   // 腳座
    });
    for (const t of [0.42, 0.72]) {                    // 兩道橫桿（從腳往上算的比例）
      const yb = cy * t, xb = fx * (1 - t) + rl * 0.6 * t, zb = fz * (1 - t) + az * t;
      limb(v, { x: -xb, y: yb, z: zb, x1: xb, y1: yb, z1: zb, r: Math.max(0.6, rl * 0.55), c: 1 });
    }
    tubeZ(v, 0, cy, Math.round(az) - 1, ra + 1, 3, 2);  // 頂點軸套

    // ── 7. 背索：從 A 字頂點往後拉到岸上的錨座 ─────────────────
    const anz = Math.round(fz + Math.max(4, R * 0.36));
    mirrorX(v, Math.max(1, Math.round(R * 0.12)), (w, x) => w.line(0, cy, az, x, 1, anz, 2));
    v.box(0, 0, anz, Math.round(R * 0.24) * 2 + 3, 2, 3, 5);

    // ── 8. 岸上的行道樹（Jubilee Gardens 的懸鈴木） ──────────────
    const tr = Math.max(1.3, R * 0.075), tH = dim(s, 0.12, 2);
    for (const tx of [-0.78, -0.55, 0.55, 0.78]) {
      const x = Math.round(R * tx), z = zWall + 2 + Math.round(tr) + (Math.abs(tx) > 0.6 ? Math.round(tr * 1.6) : 0);
      v.box(x, 0, z, 1, tH, 1, 2);
      blob(v, x, tH + tr * 0.8, z, tr, tr * 0.85, tr, 6);
    }
  } },

{ n: '農神五號火箭',
  // v1.257.0 整座重畫（見 開發筆記〈舊版 21 座重畫、偏白的 5 座調色〉）
  // 農神五號火箭（在發射台上，旁邊是臍帶塔）
  // 正面（−z）：灰色的活動發射平台（底下幾根墩柱），台面正中央站著白色箭身：第一節下段黑白相間的滾轉紋、
  //   中段直寫的 USA 與一面國旗、級間段黑白相間；第二節、第三節（細一圈）之間各一圈分節環；
  //   往上是收窄的登月艙轉接段、服務艙、指揮艙錐、紅色逃生塔與逃生火箭；底下四片尾翼、五具 F-1 噴嘴垂進台面的排焰口
  // 側面（+x）：箭身在前，後面（−x，箭身的左手邊）一座紅橘色桁架的臍帶塔（比火箭高），一路伸出好幾支擺臂接到箭身，
  //   最上面那支末端是白色的白房間；塔頂一支錘頭吊臂
  // 三樣識別物：白箭身上的黑白滾轉紋與分節環、頂端逃生塔、旁邊紅色臍帶塔＋擺臂
  // 部件：墩柱 發射平台（排焰口） 壓緊臂 F-1 噴嘴×5 尾翼×4 整流罩 第一節（滾轉紋、USA、國旗、級間段） 分節環
  //       第二節（面板接縫） 級間收窄段 第三節（尾段黑白、姿控艙） 儀器環 登月艙轉接段 服務艙 指揮艙
  //       逃生塔桁架 逃生火箭 鼻錐 臍帶塔（柱、樓層框、斜撐） 擺臂×6 白房間 錘頭吊臂
  lo: 8, hi: 120,
  pal: [0xe4e3de,   // 0 白（箭身）
        0xb3b5b4,   // 1 淺灰：白色的陰影階、級間段、轉接段、儀器環、面板接縫
        0x23262a,   // 2 黑：滾轉紋、分節環、噴嘴、字
        0xc4502e,   // 3 紅橘：臍帶塔、擺臂、逃生塔、國旗紅條
        0x6c7178,   // 4 發射平台鋼灰
        0x2b4f9c],  // 5 國旗藍
  gen(v, s) {
    const WH = 0, LG = 1, BK = 2, RD = 3, PG = 4, BL = 5;
    const H = s;                                               // 箭身高（底到鼻錐）
    const r = Math.max(2.2, s * 0.06);                         // 第一、二節半徑（真的是 0.045，粗一點才刻得出條紋）
    // ── 發射平台：墩柱 → 兩層鋼板台面（正中央排焰口） ──
    const hp = dim(s, 0.035, 2), tD = dim(s, 0.022, 2);
    const yTop = hp + tD - 1;                                  // 台面頂那一層
    /* 臍帶塔擺在 −x（箭身的左手邊）：預覽與遊戲的 45° 鏡頭是從 +x、−z 那一側看過來的，
       塔擺在 +x 會整座擋在火箭前面（第一版就是這樣，45° 只看得到一座紅塔）。 */
    const SX = -1;
    const wL = dim(s, 0.10, 5, true), xL = SX * Math.round(r * 3.3 + wL / 2);   // 臍帶塔寬、中心
    const ea = -SX * Math.round(r + s * 0.07), eb = xL + SX * Math.round(wL / 2 + s * 0.04);
    const px0 = Math.min(ea, eb), px1 = Math.max(ea, eb);
    const pz = Math.round(Math.max(r, wL / 2) + s * 0.07);
    v.box((px0 + px1) / 2, hp, 0, px1 - px0 + 1, tD, pz * 2 + 1, PG);
    for (let x = -Math.ceil(r); x <= Math.ceil(r); x++) for (let z = -Math.ceil(r); z <= Math.ceil(r); z++)
      if (Math.hypot(x, z) < r * 0.85) for (let y = hp; y <= yTop; y++) v.del(x, y, z);    // 排焰口
    for (const fx of [0, 0.5, 1]) for (const sz of [-1, 1])                 // 六根墩柱
      v.box(Math.round(px0 + 1 + (px1 - px0 - 2) * fx), 0, sz * (pz - 1), 2, hp, 2, PG);

    // ── 箭身：一層一層掃，半徑與顏色都照「在箭身的哪個高度」挑 ──
    const yB = yTop + 1;
    const rIV = r * 0.66, rSM = Math.max(1, r * 0.39);
    const radius = f =>
      f < 0.62 ? r :
      f < 0.665 ? r + (rIV - r) * (f - 0.62) / 0.045 :          // 第二、三節之間收窄
      f < 0.78 ? rIV :
      f < 0.855 ? rIV + (rSM - rIV) * (f - 0.78) / 0.075 :      // 登月艙轉接段
      f < 0.895 ? rSM :
      rSM * (1 - (f - 0.895) / 0.035 * 0.75);                 // 指揮艙錐
    const top = Math.round(H * 0.93);
    for (let j = 0; j < top; j++) {
      const f = j / H, rr = radius(f), n = Math.ceil(rr + 0.5), y = yB + j;
      for (let x = -n; x <= n; x++) for (let z = -n; z <= n; z++) {
        const d = Math.sqrt(x * x + z * z);
        if (d > rr + 0.35 || d < rr - 0.95) continue;
        const sec = Math.floor((Math.atan2(z, x) + Math.PI * 1.125) / (Math.PI / 4)) & 1;   // 八等分，正面正中是一塊
        let c = WH;
        if (f < 0.06) c = LG;                                  // 推力結構段（整流罩後面）
        else if (f < 0.13) c = sec ? BK : WH;                  // 第一節下段滾轉紋
        else if (f < 0.27) c = WH;                             // 燃料箱（USA、國旗另外畫）
        else if (f < 0.31) c = sec ? WH : BK;                  // 級間段：跟下段錯開，像棋盤
        else if (f < 0.37) c = WH;                             // 液氧箱
        else if (f < 0.39) c = BK;                             // 第一節頂的分節環
        else if (f < 0.42) c = LG;                             // 一、二節級間段
        else if (f < 0.62) c = (j % Math.max(3, Math.round(H * 0.065)) === 0) ? LG : WH;  // 第二節（面板接縫）
        else if (f < 0.665) c = LG;                            // 二、三節級間收窄段
        else if (f < 0.70) c = BK;                             // 第三節底的分節環
        else if (f < 0.735) c = (Math.floor((Math.atan2(z, x) + Math.PI * 1.25) / (Math.PI / 2)) & 1) ? BK : WH;  // 第三節尾段
        else if (f < 0.77) c = WH;
        else if (f < 0.78) c = BK;                             // 儀器環
        else if (f < 0.855) c = LG;                            // 登月艙轉接段
        else if (f < 0.895) c = WH;                            // 服務艙
        else c = WH;                                           // 指揮艙（保護罩）
        v.set(x, y, z, c);
      }
    }
    // 第三節尾段的兩個姿控艙（黑色小鼓包，左右各一）
    mirrorX(v, Math.round(rIV + 0.6), (vv, dx) =>
      vv.box(dx, yB + Math.round(H * 0.70), 0, 1, Math.max(1, Math.round(H * 0.025)), 2, BK));
    // ── USA 與國旗：畫在第一節燃料箱的正面（從軸心往 −z 找箭身表面） ──
    /* 直寫的 USA：燃料箱那一段只有 0.14 個箭高，3×5 的字疊三個要 17 層，9000 塊也塞不下，
       所以一律用三段黑色短劃代表（上面一面國旗）。 */
    const face = (x, y, c) => paintFrom(v, x, y, 0, 0, 0, -1, Math.ceil(r) + 2, c);
    // 國旗先擺（最小那一號也要在）：頂齊燃料箱上緣，左上藍、其餘紅白相間
    const big = r >= 3.4, fw = big ? 5 : 3, fh = big ? 3 : 2;
    const yF = yB + Math.max(1, Math.round(H * 0.27) - fh);
    for (let i = 0; i < fh; i++) for (let k = 0; k < fw; k++) {
      const x = Math.floor(fw / 2) - k, y = yF + fh - 1 - i;
      face(x, y, (k < Math.ceil(fw / 2) && i < Math.ceil(fh / 2)) ? BL : (i % 2 ? WH : RD));
    }
    // USA：國旗底下三段直寫的黑色短劃（塞得下幾段就畫幾段）
    const dl = Math.max(1, Math.round(H * 0.018)), dg = Math.max(1, Math.round(H * 0.01));
    for (let i = 0, y = yF - dg - dl; i < 3 && y >= yB + Math.round(H * 0.13); i++, y -= dl + dg)
      for (let k = 0; k < dl; k++) face(0, y + k, BK);

    // ── 尾翼與整流罩（斜 45° 四片）、五具 F-1 噴嘴垂進排焰口 ──
    const fl = Math.max(1.5, r * 0.6), hf = Math.max(2, H * 0.07);
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + k * Math.PI / 2, ca = Math.cos(a), sa = Math.sin(a);
      for (let u = r - 0.5; u <= r + fl; u += 0.5) {
        const h = Math.round(hf * (1 - 0.55 * (u - r + 0.5) / (fl + 0.5)));
        for (let y = 0; y < h; y++) v.set(Math.round(u * ca), yB + y, Math.round(u * sa), y < h * 0.4 ? BK : WH);
      }
      blob(v, (r - 0.2) * ca, yB + hf * 0.35, (r - 0.2) * sa, r * 0.32, hf * 0.45, r * 0.32, BK);   // 整流罩
    }
    /* 箭底一片實心的隔熱底板：噴嘴吊在它下面。沒有它的話大尺寸時噴嘴頂端落在中空箭身的「裡面」，
       五具噴嘴整組碰不到任何東西（10000 塊實測懸空 205 格）。 */
    v.cyl(0, yB, 0, r - 0.5, 1, BK);
    const he = Math.max(2, Math.round(H * 0.035)), rb = Math.max(0.9, r * 0.33);
    for (let k = 0; k < 5; k++) {
      const a = Math.PI / 4 + k * Math.PI / 2, d = k === 4 ? 0 : r * 0.5;
      revolve(v, { x: Math.round(Math.cos(a) * d), y: yB - he, z: Math.round(Math.sin(a) * d), c: BK,
                   prof: [[rb, 0], [rb * 0.45, he]] });
    }
    // 四支壓緊臂（排焰口邊上的灰色墩子，頂住箭身底緣）
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2;
      v.box(Math.round(Math.cos(a) * (r + 0.6)), yB, Math.round(Math.sin(a) * (r + 0.6)), 1, 2, 1, PG);
    }

    // ── 逃生塔：指揮艙錐頂上一座紅色小桁架 → 逃生火箭 → 黑色鼻錐 ──
    const yE = yB + top, hE = Math.max(2, Math.round(H * 0.03)), hM = Math.max(2, Math.round(H * 0.035));
    const le = Math.max(1, Math.round(rSM * 0.55));
    for (const [ex, ez] of [[le, le], [-le, le], [le, -le], [-le, -le]]) v.line(ex, yE, ez, 0, yE + hE, 0, RD);
    v.box(0, yE, 0, 1, hE, 1, RD);
    v.box(0, yE + hE, 0, 1, hM, 1, LG);
    v.set(0, yE + hE + hM, 0, RD);
    v.set(0, yE + hE + hM + 1, 0, BK);

    // ── 臍帶塔：四根角柱、每隔幾層一圈樓層框、外側三面斜撐 ──
    /* 第一版樓層框每 3 層一圈、三面都拉斜撐，3000 塊那一檔紅色（塔＋擺臂）961 塊、箭身才 1189 塊，
       整座看起來是一座紅塔旁邊站一根白棍。現在框拉到每 ~0.08 個箭高一圈、斜撐只拉正背兩面（之字形），
       塔是「看得穿的格架」。 */
    const hL = Math.round(H * 1.04), lv = Math.max(4, Math.round(s * 0.08)), hw = (wL - 1) / 2;
    const yL0 = yTop + 1;
    corners4(v, hw, hw, (vv, x, z) => vv.box(xL + x, yL0, z, 1, hL, 1, RD));
    for (let y = yL0; y <= yL0 + hL - 1; y += lv) v.walls(xL, y, 0, wL, 1, wL, RD, 1);
    v.box(xL, yL0 + hL - 1, 0, wL, 1, wL, RD);                            // 塔頂平台（吊臂站在上面）
    for (let y = yL0, k = 0; y + lv <= yL0 + hL - 1; y += lv, k++) {
      const d = k & 1 ? 1 : -1;
      v.line(xL - hw * d, y, -hw, xL + hw * d, y + lv, -hw, RD);          // 正面
      v.line(xL - hw * d, y, hw, xL + hw * d, y + lv, hw, RD);            // 背面
    }
    // ── 擺臂：從塔朝火箭那一面伸到箭身，最上面那支末端是白房間 ──
    const arms = [0.30, 0.43, 0.58, 0.69, 0.80, 0.905];
    for (const f of arms) {
      const y = yB + Math.round(H * f);
      const xa = SX * (Math.round(radius(f)) + 1), xb = xL - SX * (hw + 1);
      const x0 = Math.min(xa, xb), x1 = Math.max(xa, xb);
      v.box((x0 + x1) / 2, y, 0, Math.max(1, x1 - x0 + 1), 1, 2, RD);
      for (let x = x0; x <= x1; x += 2) v.set(x, y + 1, 0, RD);            // 扶手柱
    }
    const yW = yB + Math.round(H * 0.905), ww = dim(s, 0.035, 2), xw = SX * (Math.round(rSM) + 1 + Math.ceil(ww / 2));
    v.box(xw, yW, 0.5, ww, ww, ww, WH);                                   // 白房間（小尺寸只有 2 格，不要比指揮艙還大）
    // ── 錘頭吊臂：塔頂一根橫梁，長的那頭伸向火箭 ──
    const yC = yL0 + hL;
    v.box(xL, yC, 0, 1, 2, 1, RD);
    v.box(xL - SX * Math.round(wL * 0.3), yC + 2, 0, Math.round(wL * 1.6), 1, 1, RD);
    v.box(xL + SX * Math.round(wL * 0.45), yC + 1, 0, 2, 1, 2, PG);       // 配重
  } },

{ n: '阿姆斯特丹運河屋',
  // v1.257.0 整座重畫（見 開發筆記〈舊版 21 座重畫、偏白的 5 座調色〉）
  // 阿姆斯特丹運河屋
  // 正面（−z，臨運河）：五棟窄而高的房子肩並肩貼成一排，牆頂高低錯落，每棟頂上一個不同造型的山牆
  //   （階梯、鐘形、頸狀、尖頂、平簷），白框大窗一層一層往上疊；最前面是一條水藍色運河。
  // 側面：房子窄而深、屋脊沿 z 前後走，山牆比屋頂高出一截（假立面）；前面是河岸街道、駁岸、運河與小船。
  // 三樣識別物：每棟不一樣的山牆（含白色石飾收邊）、山牆頂伸出來的吊貨橫樑、門前的運河（小船、腳踏車）
  // 部件：運河水面 對岸駁岸 河岸紅磚街道 白色駁岸壓石 路燈 房身（共用隔牆） 墊高的一樓與門前台階 門與白門楣
  //       白框深玻璃窗（前後兩面） 五款山牆 山牆白色石飾 頂窗 屋頂（中空兩坡） 背面山尖 吊貨橫樑與吊鉤 小船 腳踏車
  lo: 6, hi: 30,
  pal: [0x8e3b2c,   // 0 深紅磚：磚造房、河岸街道的紅磚鋪面、駁岸
        0x2f5a45,   // 1 墨綠：漆成墨綠的房子、門
        0x2c4a6e,   // 2 深藍：漆成深藍的房子、門、船身吃水線
        0xc4903c,   // 3 赭黃：漆成赭黃的房子、船艙木板、路燈
        0x2a2a2e,   // 4 黑：黑房子、屋頂、窗玻璃、吊貨橫樑、腳踏車
        0xe9e3d6,   // 5 白：窗框、山牆收邊與石飾、門楣、駁岸壓石、船舷
        0x5b9cc0],  // 6 水藍：運河
  gen(v, s) {
    const hd = dim(s, 0.50, 5);           // 房子進深（往 +z）
    const sd = dim(s, 0.17, 2);           // 河岸街道寬
    const cw = dim(s, 0.36, 4);           // 運河寬
    const st = dim(s, 0.06, 1);           // 門前台階幾階＝一樓墊高幾格
    const yg = 1 + st;                    // 一樓地板（街面在 y=0）
    /* 五棟：g 山牆款式、c 牆色、k 寬度倍率、kf 樓高倍率、nf 樓數、nb 開間數、dr 門在哪一間（L／C／R）、dc 門色。
       寬度與樓高每棟各差一點：真的運河屋本來就寬窄不一、樓板也不對齊；
       而且每棟換階的 s 錯開，塊數才不會一跳幾百塊（寬度要取奇數，一換就是兩格）。 */
    const HS = [
      { g: 'step',    c: 0, k: 1.00, kf: 1.00, nf: 4, nb: 3, dr: 'L', dc: 1 },
      { g: 'bell',    c: 1, k: 0.92, kf: 1.07, nf: 4, nb: 3, dr: 'R', dc: 4 },
      { g: 'neck',    c: 3, k: 1.25, kf: 0.94, nf: 5, nb: 3, dr: 'C', dc: 1 },
      { g: 'spout',   c: 4, k: 0.72, kf: 1.12, nf: 4, nb: 2, dr: 'L', dc: 2 },
      { g: 'cornice', c: 2, k: 1.08, kf: 0.90, nf: 3, nb: 3, dr: 'R', dc: 4 }
    ];
    const fws = HS.map(h => dim(s, 0.50 * h.k, 5, true));
    const W = fws.reduce((a, b) => a + b, 0) - (HS.length - 1);   // 隔牆共用
    const X0 = -Math.floor(W / 2);

    // ── 1. 運河與河岸：街道與水面同高，中間隔一道白色壓石的駁岸 ──
    const xa = X0 - 2, xb = X0 + W + 1, LW = xb - xa + 1, xm = (xa + xb) / 2;
    v.box(xm, 0, -(sd + 1) / 2, LW, 1, sd, 0);                 // 河岸街道（紅磚鋪面）
    v.box(xm, 0, -sd, LW, 1, 1, 0);
    v.box(xm, 1, -sd, LW, 1, 1, 5);                             // 駁岸壓石
    v.box(xm, 0, -sd - (cw + 1) / 2, LW, 1, cw, 6);             // 運河水面
    v.box(xm, 0, -sd - cw - 1, LW, 1, 1, 0);                    // 對岸駁岸
    v.box(xm, 1, -sd - cw - 1, LW, 1, 1, 5);

    // ── 2. 山牆剖面：每一層的半寬 a[j]、哪些格子是白色石飾、吊貨橫樑在哪一層 ──
    const gable = (g, hw, fh) => {
      const a = [];
      let white, beam, w0 = 0;
      if (g === 'step') {                       // 階梯山牆：三四階往內收，階頂一塊白壓頂石
        const sw = hw <= 4 ? 1 : 2, sh = sw === 1 ? 2 : 3, qt = Math.max(1, Math.round(hw * 0.2));
        for (let q = hw; q >= qt; q -= sw) for (let k = 0; k < sh; k++) a.push(q);
        a.push(0);                              // 頂上一塊尖石
        white = (j, ax) => ax === a[j] && (j === a.length - 1 || a[j + 1] < a[j]);
        beam = a.length - 2;
      } else if (g === 'spout') {               // 尖山牆：比屋頂陡的三角形，白色收邊
        const gh = Math.round(hw * 1.7) + 1;
        for (let j = 0; j < gh; j++) a.push(Math.floor(hw * (gh - 1 - j) / (gh - 1) + 0.5));
        white = (j, ax) => ax === a[j];
        beam = gh - 2;
      } else if (g === 'bell') {                // 鐘形山牆：肩部收進去、鐘身直立、圓頂，白色收邊
        const nb = Math.max(1, Math.round(hw * 0.62));
        for (let q = hw; q > nb; q--) a.push(q);
        w0 = a.length;
        const body = Math.max(2, Math.round(fh * 0.9));
        for (let k = 0; k < body; k++) a.push(nb);
        beam = a.length - 1;
        for (let k = 1; k <= nb; k++) a.push(Math.round(Math.sqrt(nb * nb - (k - 0.5) * (k - 0.5))));
        a.push(0);
        white = (j, ax) => ax === a[j];
      } else if (g === 'neck') {                // 頸狀山牆：窄而高的頸、肩上兩塊白爪飾、頂上白山花
        const nh = Math.max(1, Math.round(hw * 0.5));
        for (let q = hw; q > nh; q--) a.push(q);
        const cl = w0 = a.length;
        const nl = Math.max(2, Math.round(fh * 1.1));
        for (let k = 0; k < nl; k++) a.push(nh);
        beam = a.length - 1;
        a.push(nh + 1);                         // 山花底下挑出來的簷
        for (let q = nh; q >= 0; q--) a.push(q);
        white = (j, ax) => (j < cl && ax > nh) || j >= cl + nl;
      } else {                                  // 平簷（簷口山牆）：一道白色大簷口，中間一塊小山花
        const ph = Math.max(1, Math.round(hw * 0.4));
        a.push(hw);
        for (let q = ph; q >= 0; q--) a.push(q);
        white = () => true;
        beam = -2;                              // 橫樑在頂樓那一層的牆上
        w0 = 99;
      }
      return { a, white, beam, w0 };
    };

    // 一扇窗：深色玻璃、白窗楣（樓高夠再加白窗台）；寬窗中間一根白窗櫺，高窗中間一道白橫櫺
    const win = (x, y0, z, ww, gc, fh) => {
      const wr = Math.max(1, Math.round(fh * 0.3));               // 上下兩扇窗之間留幾層牆
      const g0 = y0 + wr, g1 = y0 + fh - 1, mid = Math.round((g0 + g1) / 2);
      for (let y = g0; y <= g1; y++) for (let d = -(ww - 1) / 2; d <= (ww - 1) / 2; d++) {
        const fr = (fh >= 7 && y === g0) || y === g1 || (ww > 1 && d === 0) || (fh >= 8 && y === mid);
        tint(v, x + d, y, z, fr ? 5 : gc);
      }
    };

    // ── 3. 一棟一棟蓋，隔牆共用 ──
    const fhs = HS.map(h => dim(s, 0.27 * h.kf, 3));               // 每一棟的樓高
    const tops = HS.map((h, i) => yg + h.nf * fhs[i]);             // 牆頂（山牆從這一層開始）
    /* 隔牆只蓋一次：高度取兩邊比較高的那棟、顏色也跟那棟。
       每棟各蓋四面牆的話，共用的那面會被蓋兩遍（9000 那一檔多兩千多次寫入）。 */
    for (let k = 0, x = X0; k <= HS.length; k++) {
      const a = Math.max(0, k - 1), b = Math.min(HS.length - 1, k);
      const hi = tops[a] >= tops[b] ? a : b;
      v.box(x, 0, (hd - 1) / 2, 1, tops[hi], hd, HS[hi].c);
      if (k < HS.length) x += fws[k] - 1;
    }
    let xl = X0;
    HS.forEach((h, i) => {
      const fw = fws[i], hw = (fw - 1) / 2, xc = xl + hw, fh = fhs[i], top = tops[i];
      xl += fw - 1;
      v.box(xc, 0, 0, fw - 2, top, 1, h.c);                        // 正面
      v.box(xc, 0, hd - 1, fw - 2, top, 1, h.c);                   // 背面

      // 屋頂：中空兩坡，屋脊沿 z，從山牆後面一格開始
      const rh = Math.round(hw * 1.3) + 1;
      for (let j = 0; j < rh; j++) {
        const q = Math.round(hw * (1 - j / (rh - 1)));
        v.box(xc, top + j, hd - 1, q * 2 + 1, 1, 1, h.c);           // 背面山尖
        mirrorX(v, q, (vv, dx) => vv.box(xc + dx, top + j, hd / 2, 1, 1, hd - 1, 4));
      }

      // 山牆（立在正面那片牆的延長面上）
      const G = gable(h.g, hw, fh);
      G.a.forEach((q, j) => {
        for (let d = -q; d <= q; d++) v.set(xc + d, top + j, 0, G.white(j, Math.abs(d)) ? 5 : h.c);
      });
      if (h.g === 'cornice') v.box(xc, top, -1, fw, 1, 1, 5);      // 簷口往前挑出一格
      // 山牆上的頂窗（吊貨門）
      const gw = Math.max(1, fh - 3);
      for (let k = 0; k <= gw + 1; k++) {
        const j = G.w0 + k;
        if (j >= G.a.length || G.a[j] < 1) break;
        tint(v, xc, top + j, 0, k === 0 || k === gw + 1 ? 5 : 4);
      }
      // 吊貨橫樑：從山牆頂往運河那邊伸出去，末端掛一個吊鉤
      const hb = dim(s, 0.09, 2), by = top + G.beam;
      v.box(xc, by, -(hb + 1) / 2, 1, 1, hb, 4);
      if (fh >= 5) v.set(xc, by - 1, -hb, 4);

      // 前後立面的窗、一樓的門
      const bs = Math.round((fw - 1) / h.nb), ww = bs >= 4 ? 3 : 1;
      const lim = hw - 1 - (ww - 1) / 2;
      const gc = h.c === 4 ? 2 : 4;                                 // 玻璃：黑，黑房子才用深藍
      const door = h.dr === 'L' ? 0 : h.dr === 'R' ? h.nb - 1 : Math.floor((h.nb - 1) / 2);
      for (let b = 0; b < h.nb; b++) {
        const o = (b - (h.nb - 1) / 2) * bs;
        const bx = xc + Math.sign(o) * Math.min(Math.round(Math.abs(o)), lim);
        for (let f = 0; f < h.nf; f++) {
          const y0 = yg + f * fh;
          win(bx, y0, hd - 1, ww, gc, fh);                          // 背面
          if (f === 0 && b === door) {
            for (let y = yg; y < yg + fh - 1; y++)
              for (let d = -(ww - 1) / 2; d <= (ww - 1) / 2; d++) tint(v, bx + d, y, 0, h.dc);
            for (let d = -(ww - 1) / 2; d <= (ww - 1) / 2; d++) tint(v, bx + d, yg + fh - 1, 0, 5);   // 白門楣
            stairs(v, bx, 1, -st, st, ww, 'z', 4);                  // 門前台階
          } else win(bx, y0, 0, ww, gc, fh);
        }
      }
      // 一排的頭尾兩棟：外側山牆上開兩列窗，不然側面是一整片空牆
      if (i === 0 || i === HS.length - 1) {
        const ex = i === 0 ? xc - hw : xc + hw;
        for (const zz of [Math.round(hd * 0.3), Math.round(hd * 0.7)])
          for (let f = 1; f < h.nf; f++) {
            const y0 = yg + f * fh;
            for (let y = y0 + Math.max(1, Math.round(fh * 0.3)); y < y0 + fh; y++) tint(v, ex, y, zz, y === y0 + fh - 1 ? 5 : gc);
          }
      }
    });

    // ── 4. 河岸上的東西：路燈、腳踏車；河裡一艘小船 ──
    const lh = dim(s, 0.32, 4);
    for (const lx of [Math.round(X0 + W * 0.30), Math.round(X0 + W * 0.78)]) {
      v.box(lx, 2, -sd, 1, lh, 1, 4);                               // 燈柱
      v.box(lx, 2 + lh, -sd, 1, 1, 1, 3);                           // 燈
      v.set(lx, 3 + lh, -sd, 4);
    }
    const rr = dim(s, 0.055, 1);                                    // 輪子半徑
    const bike = (bx, c) => {
      for (const wx of [bx - rr - 1, bx + rr + 1])
        for (let i = -rr; i <= rr; i++) for (let j = -rr; j <= rr; j++)
          if (Math.abs(Math.hypot(i, j) - rr) <= 0.5) v.set(wx + i, 2 + rr + j, -sd, 4);
      v.line(bx - rr - 1, 2 + rr, -sd, bx, 2 + rr, -sd, c);          // 下管
      v.line(bx, 2 + rr, -sd, bx + rr + 1, 3 + 2 * rr, -sd, c);      // 前叉
      v.set(bx - 1, 3 + 2 * rr, -sd, c);                            // 座墊
      v.set(bx + rr + 1, 4 + 2 * rr, -sd, 4);                       // 把手
    };
    bike(Math.round(X0 + W * 0.12), 4);
    bike(Math.round(X0 + W * 0.55), 0);

    const bl = dim(s, 0.55, 7), bw = Math.min(cw - 2, dim(s, 0.16, 3, true));
    const bz = Math.round(-sd - (cw + 1) / 2), bx0 = Math.round(X0 + W * 0.18);
    for (let i = 0; i < bl; i++) {
      const t = i / (bl - 1);                                       // 0 船尾 → 1 船頭（+x）
      const q = (bw - 1) / 2 * (t > 0.7 ? Math.max(0, 1 - (t - 0.7) / 0.32) : 1);
      const n = Math.round(q);
      for (let k = -n; k <= n; k++) {
        const edge = Math.abs(k) === n || i === 0;
        v.set(bx0 + i, 0, bz + k, edge ? 2 : 3);                    // 船底：外圈吃水線、裡面木板
        if (edge) v.set(bx0 + i, 1, bz + k, 5);                     // 白船舷
      }
    }
    for (const t of [0.3, 0.55]) v.box(bx0 + Math.round(t * (bl - 1)), 1, bz, 1, 1, bw - 2, 3);  // 坐板
    v.box(bx0 - 1, 1, bz, 1, 2, 1, 4);                              // 船外機
  } },

{ n: '因紐特冰屋',
  // v1.257.0 整座重畫（見 開發筆記〈舊版 21 座重畫、偏白的 5 座調色〉）
  // 因紐特冰屋（整座重畫：照實物，主體白、加色階與配件）
  // 正面（−z）：半圓的雪磚圓頂，正前方伸出一條低矮的半圓入口通道、口子是黑的；
  //   門上方的圓頂開一塊透光的冰窗；前面雪地上有雪橇、拴著的雪橇犬、冰上釣魚洞
  // 側面：圓頂高約等於半徑，入口通道只有圓頂四成高、往前（−z）拖出去；右後方有晾魚架
  // 三樣識別物：雪磚螺旋疊起的圓頂（磚縫是灰藍的線）、前方低矮的入口通道＋黑色門洞、門上方的冰窗
  // 部件：雪地(不規則橢圓，白與淺灰藍兩階) 圓頂(螺旋磚縫、磚面兩階) 底部培雪 入口通道(磚縫) 門洞(深色)
  //   冰窗(冰藍＋灰框) 通風孔 結冰的湖面 釣魚洞(深藍)＋碎冰 釣竿與釣線 釣上來的魚
  //   雪橇(兩條滑板、翹起的前端、橫板、綑好的貨) 扇形拖繩 雪橇犬(腿、身、白胸、頭、白臉黑鼻、眼、尖耳、捲尾)
  //   晾毛皮的木框＋毛皮 晾魚架＋一排魚乾
  lo: 3.5, hi: 22,
  pal: [0xeef3f6,   // 0 雪白：亮面的雪磚、雪地上的積雪、狗的白胸白臉
        0xbccbd8,   // 1 淺灰藍：暗一階的雪磚、雪地、底部培雪
        0x93a9bb,   // 2 灰藍陰影：磚縫、窗框、拖繩、釣線、魚
        0x86cfe3,   // 3 冰藍：冰窗、結冰的湖面
        0x1d3047,   // 4 深藍：門洞、釣魚洞、通風孔、狗的眼鼻
        0x8b5a33,   // 5 木頭：雪橇、晾架、釣竿
        0x6e6255],  // 6 灰褐：雪橇犬、毛皮、魚乾、雪橇上的貨
  gen(v, s) {
    const TAU = Math.PI * 2;
    const R = s;                                       // 圓頂外半徑（不取整）
    const hsh = (a, b, c) => {
      let h = (a * 73856093) ^ (b * 19349663) ^ (c * 83492791);
      h = (h ^ (h >>> 13)) * 1274126177;
      return ((h ^ (h >>> 16)) >>> 0) % 100;
    };
    const hb = Math.max(2.4, R * 0.29);                // 一層雪磚的高（沿經線量）
    const bl = hb * 2.1;                               // 一塊雪磚的長（沿緯線量）
    const tk = Math.max(1.2, R * 0.075);               // 牆厚（看不到的內層越薄，同樣塊數圓頂越大）
    const y0 = 1;                                      // y=0 是雪地，房子從 1 起

    // ── 1. 雪地：不規則的橢圓，兩階雪色一片一片的（風吹出來的積雪） ───
    const fxc = R * 0.16, fzc = -R * 0.5, frx = R * 1.62, frz = R * 1.6;
    const nx = Math.ceil(frx * 1.15), nz = Math.ceil(frz * 1.15);
    const inner2 = (R - tk - 0.5) * (R - tk - 0.5);   // 圓頂裡面的地板看不到，不鋪（省一成積木）
    for (let x = Math.floor(fxc - nx); x <= Math.ceil(fxc + nx); x++) for (let z = Math.floor(fzc - nz); z <= Math.ceil(fzc + nz); z++) {
      if (x * x + z * z < inner2) continue;
      const q = ((x - fxc) / frx) * ((x - fxc) / frx) + ((z - fzc) / frz) * ((z - fzc) / frz);
      if (q > 1.3) continue;
      if (q > 0.75) {                                  // 只有外緣那一圈才需要算抖動的邊
        const a = Math.atan2(z - fzc, x - fxc);
        const lim = 1 + 0.08 * Math.sin(3 * a + 1) + 0.05 * Math.sin(7 * a + 2);
        if (q > lim * lim) continue;
      }
      v.set(x, 0, z, hsh(x >> 2, 0, (z + 64) >> 2) < 62 ? 0 : 1);
    }

    // ── 2. 結冰的湖面＋釣魚洞（左前方） ──────────────────────────
    const ix = -R * 0.98, iz = -R * 1.12, irx = Math.max(2.5, R * 0.42), irz = Math.max(2, R * 0.34);
    const hr = Math.max(1, R * 0.12);
    for (let x = Math.floor(ix - irx); x <= Math.ceil(ix + irx); x++)
      for (let z = Math.floor(iz - irz); z <= Math.ceil(iz + irz); z++) {
        const q = ((x - ix) / irx) ** 2 + ((z - iz) / irz) ** 2;
        if (q > 1) continue;
        const d = Math.sqrt((x - ix) ** 2 + (z - iz) ** 2);
        v.set(x, 0, z, d <= hr + 0.3 ? 4 : 3);
        if (d > hr + 0.3 && d <= hr + 1.4 && hsh(x, 1, z) < 40) v.set(x, 1, z, 0);   // 鑿出來的碎冰
      }
    // 釣竿：一根短木桿斜插在洞邊，尖端伸到洞口上方，垂一條線下去
    const rtx = Math.round(ix), rtz = Math.round(iz), rodH = Math.max(2, Math.round(R * 0.2));
    v.line(rtx + Math.round(hr) + 2, 1, rtz + 1, rtx, 1 + rodH, rtz, 5);
    for (let y = 1; y < 1 + rodH; y++) v.set(rtx, y, rtz, 2);
    // 釣上來的魚：躺在冰上，身體＋尾巴
    const fsx = Math.round(ix + irx * 0.45), fsz = Math.round(iz - irz * 0.4), fsl = Math.max(2, Math.round(R * 0.16));
    v.box(fsx, 1, fsz, fsl, 1, 1, 2);
    v.set(fsx + Math.ceil(fsl / 2), 1, fsz + 1, 2);

    // ── 3. 圓頂：雪磚螺旋往上疊，磚縫是灰藍的線、磚面兩階 ──────────
    /* 只掃殼那一層：每一根 (x, z) 直接算出殼的上下緣，不掃整個立方體——
       整個立方體掃的話 9000 那一檔產生要 270ms（fitScale 每試一個 s 就跑一次）。 */
    const Ro = R + 0.45, Ri = R - tk;
    const nR = Math.ceil(Ro);
    for (let x = -nR; x <= nR; x++) for (let z = -nR; z <= nR; z++) {
      const r2 = x * x + z * z;
      if (r2 > Ro * Ro) continue;
      const rxz = Math.sqrt(r2);
      const yLo = r2 < Ri * Ri ? Math.ceil(Math.sqrt(Ri * Ri - r2)) : 0;
      const yHi = Math.floor(Math.sqrt(Ro * Ro - r2));
      if (yHi < yLo) continue;
      const th = (Math.atan2(x, -z) + TAU) % TAU;     // 從正面起算的方位
      const circ = TAU * Math.max(1, rxz);
      const nb = Math.max(3, Math.round(circ / bl));
      for (let yy = yLo; yy <= yHi; yy++) {
        if (r2 + yy * yy < (R - 0.75) * (R - 0.75)) { v.set(x, y0 + yy, z, 1); continue; }   // 內層（屋裡的陰面）不必算磚縫
        const L = R * Math.atan2(yy, rxz);             // 沿經線從地面量上去的弧長
        const Lc = L - hb * th / TAU;                   // 螺旋：繞一圈升一層
        const c = Math.floor(Lc / hb), fc = Lc - c * hb;
        const u = th / TAU * nb + (c & 1) * 0.5;
        const j = Math.floor(u), fu = (u - j) * circ / nb;
        let col;
        if (fc < 0.7 || fu < 0.7) col = 2;              // 磚縫
        else col = hsh(c, j, 7) < 26 ? 1 : 0;           // 一塊磚一個色
        v.set(x, y0 + yy, z, col);
      }
    }
    // 底部培雪：一圈斜斜堆在牆腳
    const sk = Math.max(1.2, R * 0.12);
    for (let x = -Math.ceil(R + sk); x <= Math.ceil(R + sk); x++)
      for (let z = -Math.ceil(R + sk); z <= Math.ceil(R + sk); z++) {
        const d2 = x * x + z * z;
        if (d2 < (R - 0.3) * (R - 0.3) || d2 > (R + sk) * (R + sk)) continue;
        v.set(x, 1, z, hsh(x, 1, z) < 35 ? 0 : 1);
      }
    // 通風孔：頂上一小格黑
    tint(v, 0, y0 + Math.floor(Ro), 0, 4) || tint(v, 0, y0 + Math.floor(Ro) - 1, 0, 4);

    // ── 4. 入口通道：低矮的半圓管往前伸，口子塞一片深色（看進去是黑的） ──
    const rt = Math.max(2.3, R * 0.4), tk2 = Math.max(1.1, R * 0.09);
    const tz0 = -Math.round(R * 0.8), tz1 = -Math.round(R + Math.max(3, R * 0.55));
    const nT = Math.ceil(rt + 0.4), ringStep = Math.max(2, Math.round(bl * 0.7));
    for (let z = tz1; z <= tz0; z++) for (let x = -nT; x <= nT; x++) for (let yy = 0; yy <= nT; yy++) {
      const d = Math.sqrt(x * x + yy * yy);
      if (d > rt + 0.4) continue;
      if (d < rt - tk2) {                               // 管子裡面：只在口子後一格塞深色
        if (z === tz1 + 1) v.set(x, y0 + yy, z, 4);
        continue;
      }
      const ring = (z - tz1) % ringStep === 0;                                // 一圈一圈的磚縫
      const arc = Math.abs(Math.atan2(yy, x) - Math.PI / 2) * rt;
      const course = Math.abs(arc - rt * 0.8) < 0.5;                          // 拱上的一道橫縫
      v.set(x, y0 + yy, z, ring || course ? 2 : (hsh(x, yy, z >> 1) < 26 ? 1 : 0));
    }

    // ── 5. 冰窗：門上方的圓頂開一塊透光的冰，外圍一圈灰藍框 ─────────
    const ww = Math.max(2, Math.round(R * 0.26)), wh = Math.max(2, Math.round(R * 0.2));
    const wy = y0 + Math.round(R * 0.5), wx0 = -Math.floor(ww / 2), wx1 = wx0 + ww - 1;
    for (let x = wx0 - 1; x <= wx1 + 1; x++)
      for (let y = wy - 1; y <= wy + wh; y++) {
        const inside = x >= wx0 && x <= wx1 && y >= wy && y < wy + wh;
        paintFrom(v, x, y, 0, 0, 0, -1, Math.ceil(R) + 2, inside ? 3 : 2);
      }

    // ── 6. 雪橇（右前方，車頭朝 −z）＋扇形拖繩＋雪橇犬 ───────────────
    /* 配件底下各墊一塊雪（y=0）：配件是站在 y=1 的，雪地的邊是抖動的，
       沒墊的話落在邊外那幾格就是懸空的孤島。 */
    const pad = (x, z, w, d) => {
      const hx = (Math.round(w) - 1) / 2, hz = (Math.round(d) - 1) / 2;
      for (let i = 0; i < Math.round(w); i++) for (let q = 0; q < Math.round(d); q++)
        if (!v.has(x - hx + i, 0, z - hz + q)) v.set(x - hx + i, 0, z - hz + q, 1);
    };
    const sx = Math.round(R * 1.1), sw = Math.max(3, Math.round(R * 0.34)) | 1;
    const zb = -Math.round(R * 0.08), zfr = -Math.round(R * 0.08 + Math.max(5, R * 0.8));
    const half = (sw - 1) / 2;
    pad(sx, (zb + zfr) / 2, sw + 2, zb - zfr + 4);
    mirrorX(v, half, (w, dxr) => {
      for (let z = zfr; z <= zb; z++) w.set(sx + dxr, 1, z, 5);              // 滑板
      w.set(sx + dxr, 2, zfr - 1, 5); w.set(sx + dxr, 3, zfr - 1, 5);         // 前端往上翹
    });
    for (let z = zfr + 1; z <= zb; z += 2) v.box(sx, 2, z, sw, 1, 1, 5);      // 橫板
    const lz = Math.round(zb - (zb - zfr) * 0.3), ll = Math.max(2, Math.round((zb - zfr) * 0.45));
    const lh = Math.max(1, Math.round(R * 0.12));
    v.box(sx, 3, lz, Math.max(1, sw - 2), lh, ll, 6);                         // 綑好的貨（毛皮包）
    v.box(sx, 3, lz, Math.max(1, sw - 2), lh, 1, 2);                          // 綑繩
    v.box(sx, 3 + lh, lz, Math.max(1, sw - 2), 1, 1, 2);

    /* 雪橇犬用一份固定的小圖（一格一格排），整數倍放大：連續半徑的 blob 在三千塊時
       只有 3×3×5，頭、耳、尾全糊成一團（實測第一版就是一堆灰塊加兩顆黑點）。
       朝 −z（頭在前），y 從雪地上一層起算。 */
    const k = R >= 24 ? 2 : 1;
    const dog = (x, z) => {
      const B = (x0, x1, y0b, y1b, z0, z1, c) => {
        for (let a = x0 * k; a < (x1 + 1) * k; a++) for (let b = y0b * k; b < (y1b + 1) * k; b++)
          for (let q = z0 * k; q < (z1 + 1) * k; q++) v.set(x + a, 1 + b, z + q, c);
      };
      pad(x, z, 3 * k + 2, 5 * k + 2);                             // 只墊四隻腳底下
      for (const lx of [-1, 1]) for (const lzz of [-2, 2]) B(lx, lx, 0, 0, lzz, lzz, 6);   // 四條腿
      B(-1, 1, 1, 2, -2, 2, 6);                                    // 身體
      B(0, 0, 1, 1, -2, -2, 0);                                    // 白胸
      B(-1, 1, 2, 3, -4, -3, 6);                                   // 頭
      B(-1, 1, 2, 2, -4, -4, 0);                                   // 白色口鼻那一圈（哈士奇的白臉）
      B(0, 0, 2, 2, -5, -5, 4);                                    // 黑鼻
      if (k > 1) { B(-1, -1, 3, 3, -4, -4, 4); B(1, 1, 3, 3, -4, -4, 4); }   // 眼（一倍時跟鼻子一樣大，看起來像戴眼罩，不畫）
      B(-1, -1, 4, 4, -3, -3, 6); B(1, 1, 4, 4, -3, -3, 6);        // 尖耳
      B(0, 0, 2, 3, 3, 3, 6); B(0, 0, 3, 3, 2, 2, 0);              // 捲到背上的尾巴（白尾尖）
      return [x, z + 3 * k];
    };
    const harness = [];
    harness.push(dog(sx - Math.round(R * 0.1) - 2, zfr - 5 * k - 1));
    if (R >= 6.5) harness.push(dog(sx + Math.round(R * 0.08) + 2, zfr - 5 * k - 1 - Math.max(2, Math.round(R * 0.12))));
    for (const [x, z] of harness) v.line(sx, 1, zfr - 1, x, 1, z, 2);          // 扇形拖繩（因紐特式一狗一條）

    // ── 7. 晾毛皮的木框（左邊，面朝正面） ─────────────────────────
    const fxL = -Math.round(R * 1.22), fzL = -Math.round(R * 0.2);
    const fw = Math.max(3, Math.round(R * 0.42)), fh = Math.max(3, Math.round(R * 0.42));
    pad(fxL, fzL, fw + 4, 3);
    mirrorX(v, (fw + 1) / 2, (w, ox) => w.box(fxL + ox, 1, fzL, 1, fh + 2, 1, 5));   // 兩根柱
    v.box(fxL, fh + 2, fzL, fw + 2, 1, 1, 5);                                        // 上橫木
    v.box(fxL, 2, fzL, fw + 2, 1, 1, 5);                                             // 下橫木
    for (let y = 3; y < fh + 2; y++) for (let i = 0; i < fw; i++) {
      const x = fxL - (fw - 1) / 2 + i;
      const corner = (i === 0 || i === fw - 1) && (y === 3 || y === fh + 1);
      if (!corner) v.set(x, y, fzL, 6);                                             // 毛皮（四角收圓）
    }

    // ── 8. 晾魚架（右後方）：兩根柱一根橫桿，下面一排魚乾 ─────────────
    const rx0 = Math.round(R * 1.15), rz0 = Math.round(R * 0.4);
    const rH = Math.max(3, Math.round(R * 0.48)), rL = Math.max(4, Math.round(R * 0.62));
    pad(rx0, rz0, 3, rL + 3);
    mirrorZ(v, Math.round(rL / 2), (w, oz) => w.box(rx0, 1, rz0 + oz, 1, rH, 1, 5));
    v.box(rx0, rH + 1, rz0, 1, 1, rL + 1, 5);
    const fl = Math.max(2, Math.round(R * 0.2));
    for (let z = rz0 - Math.round(rL / 2) + 1; z < rz0 + Math.round(rL / 2); z++)
      if ((z - rz0) % 2 === 0) v.box(rx0, rH + 1 - fl, z, 1, fl, 1, 6);
  } },

{ n: '巴黎聖母院', lo: 0.8, hi: 7,
  // v1.285.0 整座重畫（見 開發筆記〈還很粗糙的七座重畫〉）
  pal: [0xd2c8b0,   // 0 石灰岩（亮）
        0xaea38b,   // 1 石灰岩（暗一階）：線腳、扶壁墩、門框、玫瑰窗外框、欄杆
        0x4c5866,   // 2 鉛皮屋頂（深藍灰）、鐘室百葉、國王廊與大迴廊的陰影
        0x6e7a88,   // 3 鉛皮（亮一階）：屋頂雜色、尖塔
        0x26457e,   // 4 彩繪玻璃深藍
        0xa8322c,   // 5 玫瑰窗的紅
        0x4e3424,   // 6 木門深褐
        0xd6a93a],  // 7 金：尖塔頂的十字與公雞、尖塔細部
  gen(v, s) {
    // 正面（−z）：寬而方的西立面，兩座平頂方塔（69 m）夾著中段（45 m），三條橫帶切成三層——
    //   底層三座深凹的尖拱門（中間最大）、門上一整排國王廊、中層正中的圓玫瑰窗（兩側塔面各一對尖拱窗）、
    //   上層橫過整面的大迴廊細柱，塔頂一圈欄杆；中段後面看不到屋頂。
    // 側面（+x）：很長（128 m），矮的側廊外一整排扶壁墩，飛扶壁從墩頂斜撐到主殿高牆，
    //   上面壓一條陡的鉛灰屋頂；中段翼廊山牆往外突、交叉點上一根細長尖塔（96 m）；東端半圓後殿。
    // 三樣識別物：雙方塔＋玫瑰窗＋三層橫帶的西立面、兩側一整排飛扶壁、翼廊交叉點上的細尖塔
    // 部件：台基線（最底一層暗石）｜主量體：雙塔、中段立面、側廊外牆、主殿高牆、翼廊、半圓後殿（內外兩圈）
    //       ｜開口：三座尖拱門（外框＋門板＋山花）、西玫瑰窗、塔面成對尖拱窗、鐘室成對長開口、高窗、
    //         小禮拜堂窗、翼廊門與兩扇翼廊玫瑰窗、山牆小圓窗
    //       ｜線腳：國王廊（雕像＋壁龕）、聖母廊欄杆帶、大迴廊（細柱＋拱頂帶＋欄杆）、塔頂簷口與欄杆
    //       ｜屋頂：主殿／翼廊十字交叉的陡屋頂、後殿半圓錐、側廊與迴廊的鉛皮露台、塔頂平台
    //       ｜頂飾：立面四道扶壁與鐘樓轉角扶壁、扶壁墩＋小尖塔＋飛扶壁（後殿一圈放射排開）、
    //         翼廊兩角小塔、交叉點尖塔（八角亭＋細尖＋金十字與公雞）
    const M = (m, lo, odd) => dim(s, m / 10, lo, odd);     // 真實公尺 → 格（s ＝ 每 10 m 幾格）
    const H = (x, y, z) => (((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) >>> 0) % 100;
    const ST = -1, LD = -2;                                 // 石材、鉛皮：一邊蓋一邊用雜湊挑兩階
    const col = (c, x, y, z) => c === ST ? (y === 0 || H(x, y, z) < 27 ? 1 : 0)
                              : c === LD ? (H(x, y, z) < 16 ? 3 : 2) : c;
    const put = (x, y, z, c) => v.set(x, y, z, col(c, x, y, z));
    const F = (x0, x1, y0, y1, z0, z1, c) => {              // 含端點的長方塊
      const xa = Math.min(x0, x1), xb = Math.max(x0, x1), zA = Math.min(z0, z1), zB = Math.max(z0, z1);
      for (let x = xa; x <= xb; x++) for (let y = y0; y <= y1; y++) for (let z = zA; z <= zB; z++) put(x, y, z, c);
    };
    const ring = (x0, x1, z0, z1, y0, y1, c) => {           // 一格厚的四面牆（四個角不重複寫）
      const zA = Math.min(z0, z1), zB = Math.max(z0, z1);
      F(x0, x1, y0, y1, zA, zA, c); F(x0, x1, y0, y1, zB, zB, c);
      F(x0, x0, y0, y1, zA + 1, zB - 1, c); F(x1, x1, y0, y1, zA + 1, zB - 1, c);
    };
    // 尖拱：寬 w（奇數）、直段 h 層，上面每層兩邊各收一格收到 1 格——積木裡的哥德尖拱
    const pArch = (w, h, fn) => {
      const r = (w - 1) / 2;
      for (let y = 0; y < h; y++) for (let i = -r; i <= r; i++) fn(i, y);
      for (let k = 1; k <= r; k++) for (let i = k - r; i <= r - k; i++) fn(i, h + k - 1);
    };
    // 玫瑰窗：深藍為底、中心一格紅，大的才排得出一圈紅色花瓣；外面一圈石框
    const roseAt = (r, fn) => {
      const n = Math.ceil(r) + 2;
      for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
        const d = Math.hypot(i, j);
        if (d <= r + 0.35) {
          const sec = Math.floor((Math.atan2(j, i) + Math.PI) / (Math.PI / 8));
          fn(i, j, true, d < 0.7 || (r >= 2.2 && d > r * 0.4 && d < r * 0.75 && sec % 2 === 0) ? 5 : 4);
        } else if (d <= r + 1.1) fn(i, j, false, 1);
      }
    };

    /* ── 平面：雙塔決定西立面；主殿兩道側牆就是兩塔的內牆，側廊外牆比塔的外側面多出一格 ──
       寬度全跟著塔寬（奇數）一階一階跳，長度、高度跟著 s 連續長：塊數才掃得到每一檔 */
    const tw = M(14, 3, true);                  // 鐘樓邊長（奇數：塔面中線落在整數格）
    const nh = Math.max(2, (tw - 1) / 2);       // 主殿側牆 |x|：主殿外寬 2nh+1 ≈ 立面寬的 0.37（實物 16／43.5 m）
    const to = nh + tw - 1, tx = nh + (tw - 1) / 2;   // 鐘樓外側面、中線
    const ah = to + 1, xT = ah + 1;             // 側廊（含小禮拜堂）外牆、翼廊端牆（只比小禮拜堂多突出一點）
    const L = M(128, 20);                       // 全長 128 m
    const zf = -Math.floor(L / 2);
    const zb = zf + tw, zm = zf + (tw - 1) / 2; // 鐘樓背面後一格（側廊從這裡開始）、鐘樓中線
    const zc = Math.max(zf + M(67, 11), zb + nh + 3);   // 翼廊中線：離正面 67 m
    const zt0 = zc - nh, zt1 = zc + nh;         // 翼廊寬＝主殿寬：交叉處正方形、兩條屋脊一樣高
    const ze = Math.max(zf + L - 1, zt1 + 3 + ah);       // 東端（唱詩班至少留兩格直段）
    const za = ze - ah;                         // 後殿半圓的圓心
    const inT = z => z > zt0 && z < zt1;

    // ── 高度 ──
    const hA = M(12, 2);                        // 小禮拜堂外牆
    const yAi = hA + M(4, 1);                   // 側廊屋頂幾乎是平的露台，靠主殿那邊高一兩格
    const hN = M(31, 6);                        // 主殿牆頂
    const R0 = nh + 1, Rh = Math.round(R0 * 1.15);      // 屋頂半寬（含出簷）、屋頂高：比 45° 陡
    const ridge = hN + Rh;
    const hwR = j => Math.round(R0 * (1 - j / Rh));      // 第 j 層屋面的半寬
    // 扶壁墩頂在側廊與主殿牆頂中間：小尖塔要矮過屋簷，飛扶壁才斜得出來（墩太高看起來是一排木樁）
    const pH = hA + Math.max(2, Math.round((hN - hA) * 0.45));
    const gk = M(17, 4), kh = M(3.5, 1);        // 國王廊（實物約 19 m；壓低一點，玫瑰窗那一層才排得下 5×5 的圓）
    const gt = Math.max(M(45, 9), ridge + 1);   // 西立面中段頂：要高過屋脊，正面才看不到屋頂
    const gg = gt - M(8, 2);                    // 大迴廊底
    const tt = Math.max(M(69, 13), gt + 5);     // 鐘樓頂

    // ── 1. 側廊外牆、主殿高牆（底下的拱廊從外面看不到，省掉）、側廊鉛皮露台 ──
    const yr = a => hA + Math.round((ah - a) * (yAi - hA) / Math.max(1, ah - nh - 1));
    for (let z = zb - 1; z <= za; z++) for (const sg of [1, -1]) {
      if (!inT(z)) F(sg * ah, sg * ah, 0, hA - 1, z, z, ST);
      if (z < zb) continue;
      if (!inT(z)) F(sg * nh, sg * nh, yAi - 1, hN - 1, z, z, ST);
      if (z >= zt0 && z <= zt1) continue;
      for (let a = nh + 1; a <= ah; a++) put(sg * a, yr(a), z, LD);
    }
    // ── 2. 東端半圓後殿：外圈迴廊牆＋迴廊露台、內圈高牆 ──
    for (let x = -ah - 1; x <= ah + 1; x++) for (let z = za + 1; z <= za + ah + 1; z++) {
      const d = Math.hypot(x, z - za);
      if (d > ah + 0.35) continue;
      if (d > ah - 1) F(x, x, 0, hA - 1, z, z, ST);
      if (d > nh + 0.35) put(x, hA + Math.round((ah - d) * (yAi - hA) / Math.max(1, ah - nh - 1)), z, LD);
      else if (d > nh - 1) F(x, x, yAi - 1, hN - 1, z, z, ST);
    }
    // ── 3. 翼廊：南北端牆、伸出側廊外那一截側牆、側廊露台以上的高牆 ──
    for (const sg of [1, -1]) {
      F(sg * xT, sg * xT, 0, hN - 1, zt0, zt1, ST);
      for (const z of [zt0, zt1]) {
        F(sg * (ah + 1), sg * xT, 0, hN - 1, z, z, ST);
        for (let a = nh + 1; a <= ah; a++) F(sg * a, sg * a, yr(a), hN - 1, z, z, ST);
      }
    }
    // ── 4. 屋頂：主殿與翼廊兩條陡屋頂十字交叉、東端半圓錐；只做一層殼，第一層就坐在牆頂上 ──
    const shell = (a, j) => a <= hwR(j) && (j === Rh || a >= hwR(j + 1));
    for (let j = 0; j <= Rh; j++) {
      const y = hN + j;
      for (let z = zf + 1; z <= za; z++) {
        const lim = z < zb ? nh - 1 : R0;                  // 兩塔之間只到塔的內牆
        for (let x = -lim; x <= lim; x++) if (shell(Math.abs(x), j)) put(x, y, z, LD);
      }
      for (let x = -xT; x <= xT; x++) for (let u = -R0; u <= R0; u++) {
        const end = Math.abs(x) === xT, a = Math.abs(u);   // 翼廊兩端是實心的石砌山牆
        if (end ? a <= hwR(j) : shell(a, j)) put(x, y, zc + u, end ? ST : LD);
      }
      for (let x = -R0; x <= R0; x++) for (let z = za + 1; z <= za + R0; z++) {
        const d = Math.hypot(x, z - za);
        if (d <= hwR(j) + 0.35 && (j === Rh || d > hwR(j + 1) - 0.65)) put(x, y, z, LD);
      }
    }

    // ── 5. 西立面：兩座方塔、中段立面 ──
    for (const sg of [1, -1]) ring(sg * nh, sg * to, zf, zb - 1, 0, tt - 1, ST);
    F(-(nh - 1), nh - 1, 0, gt - 1, zf, zf, ST);
    /* 三座尖拱大門：外框突出一格、門洞挖兩層，門板與尖拱裡的山花退在最裡面。
       山花用暗色：門洞深、背光，石色的山花跟外框是同一色，尖拱的輪廓就看不出來 */
    const portal = (cx, w, h) => {
      pArch(w + 2, h, (i, y) => put(cx + i, y, zf - 1, 1));
      pArch(w, h, (i, y) => {
        v.del(cx + i, y, zf - 1); v.del(cx + i, y, zf);
        put(cx + i, y, zf + 1, y < h ? 6 : 2);
      });
    };
    const wc = Math.min(M(7, 3, true), 2 * nh - 1), ws = Math.min(M(5.5, 3, true), tw - 2);
    const hc = Math.max(2, gk - (wc + 1) / 2);           // 中門外框頂剛好在國王廊下一層
    portal(0, wc, hc);
    for (const sg of [1, -1]) portal(sg * tx, ws, Math.max(2, hc - M(2.5, 1)));
    // 立面四道扶壁（到大迴廊下）、往上接成鐘樓四角的扶壁
    for (const sg of [1, -1]) {
      for (const bx of [nh, to]) {
        F(sg * bx, sg * bx, 0, gg - 1, zf - 1, zf - 1, 1);
        F(sg * bx, sg * bx, gt + 1, tt - 2, zf - 1, zf - 1, 1);
      }
      for (const z of [zf, zb - 1]) F(sg * (to + 1), sg * (to + 1), 0, tt - 2, z, z, 1);
    }
    // 國王廊：整面一排雕像站在暗的壁龕前，上面一條突出的欄杆帶（聖母廊）——第一條橫帶
    for (let x = -to; x <= to; x++) {
      for (let y = gk; y < gk + kh; y++) {
        put(x, y, zf, 2);
        if ((x + to) % 2 === 0) put(x, y, zf - 1, 0); else v.del(x, y, zf - 1);
      }
      put(x, gk + kh, zf - 1, 1);
      if (kh >= 2 && (x + to) % 2 === 0) put(x, gk + kh + 1, zf - 1, 1);
    }
    /* 西玫瑰窗（9.6 m）：中段正中，外框突出一格。照比例在三千塊只有 3×3 格，看起來是一扇方窗，
       所以半徑至少給到 1.9（5×5 的圓），寧可壓到兩側塔的內緣 */
    const rc = Math.round((gk + kh + gg) / 2);
    const rr = Math.min(Math.max(1.9, s * 0.48), (gg - gk - kh - 2) / 2, nh - 0.1);
    roseAt(rr, (i, j, g, c) => {                 // 玻璃前面的扶壁讓開
      if (g) { put(i, rc + j, zf, c); v.del(i, rc + j, zf - 1); }
      else put(i, rc + j, zf - 1, c);
    });
    /* 鐘室每面一對細長開口；塔寬 9 格起每扇兩格寬（一格寬的長縫在大尺寸看起來像箭孔）。
       塔面中層的尖拱窗在塔寬 5 格時只放正中一扇：放一對的話內側那扇緊貼玫瑰窗，
       兩者連成一條藍帶，玫瑰窗就不圓了（試過） */
    const pair = tw >= 9 ? [-2, -1, 1, 2] : tw >= 5 ? [-1, 1] : [0];
    const pair2 = tw >= 7 ? pair : [0];
    for (const sg of [1, -1]) for (const dx of pair2)
      for (let y = gk + kh + 2; y <= gg - 2; y++) put(sg * (tx + dx), y, zf, 4);
    // 大迴廊：一排細柱站在暗的廊道前，拱頂一條、頂上一條突出的欄杆——第三條橫帶
    for (let x = -to; x <= to; x++) {
      for (let y = gg; y < gt - 1; y++) {
        put(x, y, zf, 2);
        if ((x + to) % 2 === 0) put(x, y, zf - 1, ST); else v.del(x, y, zf - 1);
      }
      put(x, gt - 1, zf - 1, 1);
      put(x, gt, zf - 1, 1);
    }
    for (let x = -(nh - 1); x <= nh - 1; x++) if (((x + nh) & 1) === 0) put(x, gt, zf, 1);
    // 鐘室：每一面一對細長開口（暗色百葉）
    for (const sg of [1, -1]) for (const dd of pair) for (let y = gt + 2; y <= tt - 3; y++) {
      put(sg * (tx + dd), y, zf, 2); put(sg * (tx + dd), y, zb - 1, 2);
      put(sg * to, y, zm + dd, 2); put(sg * nh, y, zm + dd, 2);
    }
    /* 塔頂：外伸一格的簷口、鉛皮平台、一圈欄杆。欄杆做成實心的一圈、退回牆面：
       隔一格留一格的話這個尺寸就是城堡的雉堞，跟著簷口外伸的話整頂像一頂厚帽子（都試過）。
       內側不外伸（兩塔之間的空隙是輪廓的一半）；三格寬的小塔外伸的話像一根 T 字樁，就不外伸 */
    const ov = tw >= 5 ? 1 : 0;
    for (const sg of [1, -1]) {
      F(sg * nh, sg * (to + ov), tt, tt, zf - ov, zb - 1 + ov, 1);
      F(sg * (nh + 1), sg * (to - 1), tt, tt, zf + 1, zb - 2, 2);
      ring(sg * nh, sg * to, zf, zb - 1, tt + 1, tt + 1, 1);
    }

    // ── 6. 扶壁墩＋小尖塔＋飛扶壁：墩站在側廊外牆上，飛扶壁從墩頂斜撐到主殿牆頂 ──
    const pin = M(5, 2);
    const unit = (w, sg, z, full) => {
      const P = (x, y, c) => w.set(sg * x, y, z, col(c, sg * x, y, z));
      for (let y = full ? 0 : hA; y < pH + pin; y++) P(ah, y, 1);
      const xa = ah - 1, xb = nh + 1, ya = pH - 1, yb = hN - 1;
      for (let x = xa; x >= xb; x--) {
        const y = Math.round(ya + (yb - ya) * (xa === xb ? 1 : (xa - x) / (xa - xb)));
        P(x, y, ST); P(x, y - 1, ST);
      }
    };
    const bs = M(8, 3);
    const spread = (a, b) => {
      const n = Math.max(1, Math.floor((b - a) / bs) + 1), out = [];
      for (let i = 0; i < n; i++) out.push(n === 1 ? Math.round((a + b) / 2) : a + Math.round(i * (b - a) / (n - 1)));
      return out;
    };
    const nave = spread(zb + 1, zt0 - 2), choir = spread(zt1 + 2, za);
    for (const sg of [1, -1]) for (const z of [...nave, ...choir]) unit(v, sg, z, false);
    const nr = ah >= 9 ? 7 : 5;                 // 後殿一圈放射排開
    for (let k = 1; k <= nr; k++) stampY(v, k * 180 / (nr + 1), w => unit(w, 1, za, true), 0, za);
    // 窗：每兩道扶壁之間，主殿高牆一扇高窗、小禮拜堂牆一扇窗
    const mids = [];
    for (const row of [nave, choir]) for (let i = 0; i + 1 < row.length; i++) mids.push(Math.floor((row[i] + row[i + 1]) / 2));
    for (const sg of [1, -1]) for (const z of mids) {
      for (let y = yAi + 1; y <= hN - 2; y++) tint(v, sg * nh, y, z, 4);
      for (let y = 1; y <= hA - 2; y++) tint(v, sg * ah, y, z, 4);
    }
    for (let k = 0; k <= nr; k++) {
      const a = (k + 0.5) * Math.PI / (nr + 1);
      const at = (r, y) => tint(v, Math.round(Math.cos(a) * r), y, za + Math.round(Math.sin(a) * r), 4);
      for (let y = 1; y <= hA - 2; y++) at(ah, y) || at(ah - 0.5, y);
      for (let y = yAi + 1; y <= hN - 2; y++) at(nh, y) || at(nh - 0.5, y);
    }

    // ── 7. 翼廊南北兩端：尖拱門、玫瑰窗（12.9 m）、山牆小圓窗、兩角小塔 ──
    const wT = M(5.5, 3, true), hT = M(8, 2);
    for (const sg of [1, -1]) {
      const xe = sg * xT;
      pArch(wT + 2, hT, (i, y) => put(xe + sg, y, zc + i, 1));
      pArch(wT, hT, (i, y) => {
        v.del(xe + sg, y, zc + i); v.del(xe, y, zc + i);
        put(xe - sg, y, zc + i, y < hT ? 6 : 2);
      });
      const fTop = hT + (wT - 1) / 2;
      const rT = Math.min(s * 0.62, nh - 0.65, (hN - 2 - fTop) / 2);
      const ry = Math.round((fTop + hN) / 2);
      roseAt(rT, (i, j, g, c) => put(g ? xe : xe + sg, ry + j, zc + i, c));
      for (let y = hN + 1; y <= hN + Math.max(1, Math.round(Rh * 0.35)); y++) tint(v, xe, y, zc, 4);
      const th = hN + Math.round(Rh * 0.6);
      for (const z of [zt0 - 1, zt1 + 1]) { F(xe, xe, 0, th, z, z, 1); put(xe, th + 1, z, 2); }
    }
    // 翼廊東西兩面的高窗（側廊露台以上）
    const wx = Math.round((nh + 1 + ah) / 2);
    for (const sg of [1, -1]) for (const z of [zt0, zt1])
      for (let y = yAi + 1; y <= hN - 2; y++) tint(v, sg * wx, y, z, 4);

    // ── 8. 交叉點尖塔：八角亭（暗色開口、四角金飾）＋細尖＋金十字與公雞 ──
    const rs = Math.max(1.2, s * 0.38), dTop = ridge + M(9, 3);
    const spTop = Math.max(M(93, 16), dTop + 5);
    v.cyl(0, ridge - 2, zc, rs, dTop - ridge + 2, 3);
    const rf = Math.floor(rs + 0.35);
    for (let y = ridge + 1; y < dTop - 1; y++)
      for (const [i, k] of [[rf, 0], [-rf, 0], [0, rf], [0, -rf]]) tint(v, i, y, zc + k, 2);
    for (const [i, k] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) tint(v, i, dTop - 1, zc + k, 7);
    v.taper(0, dTop, zc, Math.max(0.9, rs * 0.65), 0.3, spTop - dTop, 3);
    for (let y = dTop + 2; y < spTop - 2; y += 3)
      for (const [i, k] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) tint(v, i, y, zc + k, 2);
    v.box(0, spTop, zc, 1, 3, 1, 7);
    v.box(0, spTop + 1, zc, 3, 1, 1, 7);
  } },

{ n: '嚴島神社鳥居', lo: 2.2, hi: 15.5, pal: [0xea4a20, 0x544d47, 0x2d695c, 0x231c18, 0xdba435, 0x9e2f14],
  /* 來源：blueprints/嚴島神社大鳥居.js（v1.66 換掉原本那份） */
  gen(v, s) {
    // === 核心尺度：大幅拉高主柱高度、拉寬左右跨距，並將 Z 軸深度薄化 ===
    const span = dim(s, 1.70, 6);                   // 主柱中心左右偏移（拉寬跨度）
    const rMain = dim(s, 0.28, 2);                  // 主柱半徑（修長化）
    const hMain = dim(s, 3.10, 11);                 // 主柱頂高（顯著拉高）
    const baseH = dim(s, 0.40, 2);                  // 水下石根高度

    const rSub = Math.max(1, Math.round(rMain * 0.65)); // 控柱半徑
    const hSub = dim(s, 1.75, 6);                   // 控柱高度
    const dzSub = dim(s, 1.15, 4);                  // 控柱前後 Z 偏移量（向外拉開距離）

    // 1. 台基：主柱與四根控柱的水下石根柱墩
    mirrorX(v, span, (vv, x) => {
      vv.cyl(x, 0, 0, rMain + 0.8, baseH, 1);
    });
    corners4(v, span, dzSub, (vv, x, z) => {
      vv.cyl(x, 0, z, rSub + 0.8, baseH, 1);
    });

    // 2. 主量體：主柱與四根控柱
    mirrorX(v, span, (vv, x) => {
      // 主柱身
      vv.cyl(x, baseH, 0, rMain, hMain - baseH, 0);
      // 柱頂台輪（環狀暗色挑出線腳）
      vv.cyl(x, hMain - 1, 0, rMain + 0.4, 1, 5);
    });

    corners4(v, span, dzSub, (vv, x, z) => {
      // 控柱身
      vv.cyl(x, baseH, z, rSub, hSub - baseH, 0);
      // 控柱頂端四坡小黑瓦屋頂
      const capW = rSub * 2 + 1;
      vv.box(x, hSub, z, capW, 1, capW, 3);
      vv.pyramid(x, hSub + 1, z, capW, 2, 1);
    });

    // 3. 控貫（連接主柱與袖柱的前後雙層橫梁 + 木楔）
    const connT = Math.max(1, Math.round(rSub * 0.8));
    const lowerY = baseH + dim(s, 0.35, 1);
    const upperY = hSub - dim(s, 0.45, 2);

    mirrorX(v, span, (vv, x) => {
      // 下層控貫
      vv.box(x, lowerY, 0, connT, dim(s, 0.25, 1), dzSub * 2, 0);
      // 上層控貫
      vv.box(x, upperY, 0, connT, dim(s, 0.32, 2), dzSub * 2, 0);

      // 控貫穿出處的金黃木楔
      mirrorZ(vv, dzSub + rSub, (vvv, z) => {
        vvv.box(x, lowerY, z, connT + 1, dim(s, 0.25, 1), 1, 4);
        vvv.box(x, upperY, z, connT + 1, dim(s, 0.32, 2), 1, 4);
      });
    });

    // 4. 主貫（穿透兩大主柱的下層大梁）
    const nukiW = (span + rMain + dim(s, 0.75, 3)) * 2 + 1;
    const nukiH = dim(s, 0.40, 2);
    const nukiY = Math.round(hMain * 0.68);
    const nukiD = Math.max(1, rMain * 2 - 1);

    v.box(0, nukiY, 0, nukiW, nukiH, nukiD, 0);

    // 貫梁外伸端部的金黃楔子
    mirrorX(v, (nukiW - 1) / 2 - 1, (vv, x) => {
      vv.box(x, nukiY - 1, 0, 1, nukiH + 2, nukiD + 1, 4);
    });

    // 5. 額束（中央神額扁額）
    const gakuY = nukiY + nukiH;
    const gakuH = Math.max(2, hMain - gakuY);
    const gakuW = dim(s, 0.45, 3, true);
    const gakuD = Math.max(1, rMain);

    // 扁額框與黑色底板
    v.box(0, gakuY, 0, gakuW + 2, gakuH, gakuD, 0);
    v.box(0, gakuY, 0, gakuW, gakuH, gakuD + 1, 3);
    // 扁額金色字體
    v.box(0, gakuY + Math.floor(gakuH / 2), 0, 1, Math.max(1, gakuH - 2), gakuD + 2, 4);

    // 6. 島木（Shimaki，主柱頂部的第二層大橫梁，兩端微翹）
    const shimaW = (span + rMain + dim(s, 1.25, 4)) * 2 + 1;
    const shimaH = dim(s, 0.40, 2);
    const shimaD = rMain * 2 + 1;

    v.box(0, hMain, 0, shimaW, shimaH, shimaD, 0);
    v.box(0, hMain, 0, shimaW + 2, 1, shimaD, 5); // 下沿分色線腳

    // 7. 笠木（Kasagi，最頂層銅綠屋頂）：精確塑造反り（向兩側自然延伸與翹角）
    const roofY = hMain + shimaH;
    const roofD = shimaD + 2;
    const halfW = (shimaW - 1) / 2 + dim(s, 0.45, 2);

    // 簷底暗色遮光板
    v.box(0, roofY, 0, halfW * 2 + 1, 1, roofD, 3);

    // 笠木弧形屋面：從中央向兩端逐段擡高，做出鳥居特有的上弦月弧線
    const tipStep1 = dim(s, 0.8, 3);
    const tipStep2 = dim(s, 0.4, 2);

    // 中央主要平緩段
    v.box(0, roofY + 1, 0, (halfW - tipStep1) * 2 + 1, 1, roofD, 2);

    // 兩側微翹段 1
    mirrorX(v, halfW - Math.floor(tipStep1 / 2), (vv, x) => {
      vv.box(x, roofY + 1, 0, tipStep1, 1, roofD, 2);
      vv.box(x, roofY + 2, 0, tipStep1, 1, roofD, 2);
    });

    // 兩側最外端翹角段 2（翼角向上挑起並包金物）
    mirrorX(v, halfW - Math.floor(tipStep2 / 2) + 1, (vv, x) => {
      vv.box(x, roofY + 2, 0, tipStep2, 1, roofD, 2);
      vv.box(x + 1, roofY + 3, 0, 1, 1, roofD, 2);
      // 兩側端部金黃金物包角
      vv.box(x + 1, roofY + 1, 0, 1, 3, roofD + 1, 4);
    });
  } },
{ n: '羅浮宮金字塔',
  // v1.257.0 整座重畫（見 開發筆記〈舊版 21 座重畫、偏白的 5 座調色〉）
  // 羅浮宮金字塔
  // 正面（−z，U 字開口那一側）：廣場正中一座陡的玻璃金字塔，菱形骨架格線，兩旁各一座小金字塔；
  //   後面一道淺砂岩的宮殿翼樓當背景，中間一座方穹頂的鐘樓閣、兩端轉角閣，深灰藍石板屋頂上一排天窗。
  // 側面：金字塔（高約底寬的六成）在前，宮殿比金字塔矮一截，屋頂是平頂的芒薩爾屋頂。
  // 三樣識別物：淺藍綠玻璃＋金屬骨架菱形格的金字塔、三座小金字塔與三角形深藍水池、後方砂岩宮殿與石板屋頂
  // 部件：廣場石鋪地 廣場外框與金字塔周圍石框 八塊三角水池 噴泉水柱 主金字塔（骨架稜線、菱形格、
  //       兩階玻璃反光） 三座小金字塔 宮殿後翼與左右短翼 一樓拱廊 樓層腰線與簷口 上層長窗
  //       芒薩爾石板屋頂 屋頂天窗 中央鐘樓閣與方穹頂、頂上小燈籠 轉角閣與高四坡頂
  lo: 4, hi: 36,
  pal: [0x8cb8c0,   // 0 玻璃（淡藍綠）
        0xb3d6d8,   // 1 玻璃反光（亮一階）、噴泉水柱
        0x47535b,   // 2 金屬骨架、宮殿石板屋頂（深灰藍）
        0x9d978c,   // 3 廣場石鋪地（灰）
        0x1f3d5c,   // 4 水池深藍水面、宮殿窗與拱廊
        0xcdbd98,   // 5 宮殿砂岩立面
        0x6f6a60],  // 6 深一階石：廣場框線、樓層腰線與簷口
  gen(v, s) {
    const hb = s * 0.7;                          // 主金字塔半底寬（不取整，塊數才連續）
    const h = Math.round(hb * 1.25);             // 高：真的約 21.6 m／底 35 m
    const lat = Math.max(3.6, 3 + hb * 0.12);    // 菱形格間距
    const rb = Math.round(hb);
    const P = Math.max(rb + 4, Math.round(hb * 1.6) + 1);       // 廣場半寬

    /* 中空的玻璃金字塔：每層一圈，四面各自照「平行兩條斜稜」的兩組線畫骨架，
       兩組線一交就是菱形；格子落在線上是骨架色，其餘是玻璃，每一片菱形各自挑一階反光。 */
    const pyr = (cx, cz, b, ph, d) => {
      for (let y = 0; y <= ph; y++) {
        const R = b * (1 - y / ph), r = Math.round(R);
        if (r === 0) { v.set(cx, y, cz, 2); continue; }
        for (let k = 0; k < 4; k++) for (let u = -r; u < r; u++) {
          let c;
          if (u === -r || (y === 0 && d < 99)) c = 2;                       // 四條稜線、底框（小的不畫底框）
          else {
            const pa = (u + R) / d, pb = (R - u) / d;
            if (pa - Math.floor(pa) < 1 / d || pb - Math.floor(pb) < 1 / d) c = 2;
            else {
              let q = (Math.floor(pa) * 73856093) ^ (Math.floor(pb) * 19349663) ^ (k * 83492791);
              q = (q ^ (q >>> 13)) * 1274126177;
              c = ((q ^ (q >>> 16)) >>> 0) % 100 < 20 + 30 * y / ph ? 1 : 0;   // 越高越常映到天光
            }
          }
          const x = k === 0 ? u : k === 1 ? r : k === 2 ? -u : -r;
          const z = k === 0 ? -r : k === 1 ? u : k === 2 ? r : -u;
          v.set(cx + x, y, cz + z, c);
        }
      }
    };

    // ── 1. 廣場：石鋪地＋三角水池（八塊，尖端指向金字塔的四個角） ──
    const b0 = rb + 2, b1 = P - 1;                              // 水池從金字塔外兩格排到廣場邊框內
    const aw = Math.max(1, Math.round(hb * 0.12)), dw = Math.max(1, Math.round(hb * 0.1));
    const span = Math.max(1, b1 - b0);
    const pool = (x, z) => {
      const ax = Math.abs(x), az = Math.abs(z);
      const b = Math.max(ax, az), a = Math.min(ax, az);
      if (b < b0 || b > b1 || ax === az) return false;
      return a <= b - dw - 1 && a >= aw + (b1 - b) * (b0 - dw - 1 - aw) / span;
    };
    for (let x = -P; x <= P; x++) for (let z = -P; z <= P; z++) {
      const b = Math.max(Math.abs(x), Math.abs(z));
      if (b < rb) continue;                                     // 金字塔底下是空的（底下是地下大廳）
      // 廣場外框、金字塔周圍的石框；水池直接是深藍水面（池緣另做一圈的話，窄的三角形整塊都變成池緣）
      v.set(x, 0, z, b === P || b === rb + 1 ? 6 : pool(x, z) ? 4 : 3);
    }
    // 噴泉：每塊水池靠外那一段各一道水柱
    const jh = dim(s, 0.06, 1), bm = Math.round(b0 + (b1 - b0) * 0.7);
    const am = Math.round(((bm - dw - 1) + (aw + (b1 - bm) * (b0 - dw - 1 - aw) / span)) / 2);
    for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const sg of [1, -1]) {
      const x = sx ? sx * bm : sg * am, z = sz ? sz * bm : sg * am;
      if (pool(x, z)) v.box(x, 1, z, 1, jh, 1, 1);
    }

    // ── 2. 主金字塔與三座小金字塔（小的在左右與後方，U 字開口那一側留空） ──
    pyr(0, 0, hb, h, lat);
    const hs = Math.max(1.6, hb * 0.2), dsm = rb + 2 + Math.round(hs) + 1;
    for (const [px, pz] of [[dsm, 0], [-dsm, 0], [0, dsm]])
      pyr(px, pz, hs, Math.max(2, Math.round(hs * 1.25)), 99);   // 小的只畫稜線，每一面一整片玻璃

    // ── 3. 後方宮殿：後翼＋左右兩段短翼（U 字的一部分），開口朝前 ──
    const dp = dim(s, 0.12, 3, true);           // 翼樓進深（奇數，閣樓才對得到中線）
    const Hf = Math.max(4, Math.round(h * 0.42));               // 立面高（到簷口），比金字塔矮
    const Hr = dim(s, 0.08, 2);                 // 芒薩爾屋頂高
    const zb = P + 1, xs = P + 1;               // 後翼正面的 z、短翼內側面的 x
    const zs = zb - Math.max(2, Math.round(hb * 0.35));         // 短翼往前伸到哪裡
    const wingX = xs + dp - 1;                  // 整座宮殿的半寬
    const wing = (x0, x1, z0, z1) => {          // 一段翼樓：中空牆＋芒薩爾屋頂
      const w = x1 - x0 + 1, d = z1 - z0 + 1, xc = (x0 + x1) / 2, zc = (z0 + z1) / 2;
      v.walls(xc, 0, zc, w, Hf, d, 5, 1);
      v.walls(xc, Hf - 1, zc, w, 1, d, 6, 1);                  // 簷口
      for (let j = 0; j < Hr; j++) {
        const iw = Math.max(1, w - 2 * j), id = Math.max(1, d - 2 * j);
        if (j === Hr - 1 || iw <= 2 || id <= 2) v.box(xc, Hf + j, zc, iw, 1, id, 2);
        else v.walls(xc, Hf + j, zc, iw, 1, id, 2, 1);
      }
    };
    wing(-wingX, wingX, zb, zb + dp - 1);                       // 後翼
    wing(xs, wingX, zs, zb - 1);                                // 右短翼
    wing(-wingX, -xs, zs, zb - 1);                              // 左短翼

    // 立面（只做朝廣場那幾面）：一樓拱廊、腰線、上層長窗
    const fy = Math.max(2, Math.round(Hf * 0.4));               // 一樓高
    const bayS = Math.max(2, Math.round(s * 0.12));             // 開間
    const face = (fixed, from, to, alongX) => {
      for (let t = from; t <= to; t++) {
        const put = (y, c) => tint(v, alongX ? t : fixed, y, alongX ? fixed : t, c);
        put(fy, 6);                                             // 一樓與上層之間的腰線
        if (((t - from) % bayS) !== Math.floor(bayS / 2)) continue;
        for (let y = 0; y < fy - 1; y++) put(y, 4);             // 拱廊開口
        for (let y = fy + 1; y < Hf - 1; y++) put(y, 4);         // 上層長窗
      }
    };
    face(zb, -xs + 1, xs - 1, true);                            // 後翼正面
    face(xs, zs, zb - 1, false);                                // 右短翼內側
    face(-xs, zs, zb - 1, false);                               // 左短翼內側
    // 屋頂天窗：後翼前坡上一排，深色窗、砂岩頂
    for (let x = -xs + 1; x <= xs - 1; x++) {
      if (((x + xs - 1) % bayS) !== Math.floor(bayS / 2)) continue;
      v.set(x, Hf, zb, 4);
      v.set(x, Hf + 1, zb, 5);
    }

    // 中央鐘樓閣：比翼樓高一截，方穹頂＋頂上小燈籠
    const pw = dim(s, 0.4, 5, true), ph = Hf + dim(s, 0.08, 2), cz = zb + (dp - 1) / 2;
    v.walls(0, 0, cz, pw, ph, dp + 2, 5, 1);
    v.walls(0, ph - 1, cz, pw, 1, dp + 2, 6, 1);
    for (let y = fy + 1; y < ph - 1; y++) for (let x = -(pw - 3) / 2; x <= (pw - 3) / 2; x += 2) tint(v, x, y, zb - 1, 4);
    const dh = dim(s, 0.16, 3), hp = (pw - 1) / 2, hq = (dp + 1) / 2;
    for (let j = 0; j < dh; j++) {
      const f = Math.cos(j / dh * Math.PI / 2);
      v.box(0, ph + j, cz, Math.round(hp * f) * 2 + 1, 1, Math.round(hq * f) * 2 + 1, 2);
    }
    v.box(0, ph + dh, cz, 1, dim(s, 0.06, 1), 1, 5);

    // 轉角閣：U 字兩個角上，比翼樓高、四坡高屋頂
    mirrorX(v, xs + (dp - 1) / 2, (vv, cx) => {
      const cwid = dp + 2;
      vv.walls(cx, 0, cz, cwid, ph, cwid, 5, 1);
      vv.walls(cx, ph - 1, cz, cwid, 1, cwid, 6, 1);
      hipRoof(vv, cx, ph, cz, cwid, cwid, 2);
    });
  } },

{ n: '莫斯科克里姆林塔',
  // v1.314.0 整座重畫：盲測第八回的子 agent 只拿〈藍圖製作說明〉、從零做出來的第一版（沒有任何回饋），
  // 原樣收進來，只改了名字與 pal 的寫法（見 開發筆記〈盲測第八回：倫敦大笨鐘、日本姬路城、大阪城天守閣、莫斯科克里姆林塔（v1.314.0）〉）
  // 正面：底下一座寬厚的紅磚方塔，正前方再凸出一座較矮、頂上有燕尾城垛的城門樓（拱門洞開著、裡面是暗的）；
  //       往上是一圈白石尖拱廊加小尖塔的「冠」，四角各一根白尖塔；再上面縮成較窄的鐘樓方塊（四面大鐘）、
  //       白欄杆、八角鐘亭、綠色八角帳篷頂，最頂一顆紅寶石五角星
  // 側面：同樣一段一段收細；前凸城門樓在正面那側凸出去一截，高度不到主塔身的一半
  // 三樣識別物：①四面黑底、金框金指針的大鐘 ②綠色八角尖帳篷頂＋頂上的紅寶石五角星 ③紅磚塔身頂上那圈白石尖拱廊與四角白尖塔
  // 比例表（實物）：全高 71 m（含星；不含星 67.3）；塔身底邊約 15.5 m（底周 29 俄丈≈62 m）；
  //   下段（1491 年的方塔）約 14 俄丈、上段（1625 年加的哥德式多層頂）約 20 俄丈；鐘面直徑 6.12 m；星跨度 3.75 m
  //   我的高度分配：台基 0–1.5／下層塔身 1.5–27／白石拱廊冠 27–31（角尖塔再高 6）／鐘樓方塊 27–42（寬 11）／
  //   欄杆 42–43.5／八角鐘亭 43.5–50（邊心距 4.2）／八角簷 50–51／帳篷頂 51–65／尖柱與星 65–72
  //   前凸城門樓：寬 10、凸出 7、高 11＋燕尾垛 1.8；城門洞寬 3.8、高約 6
  // 輪廓寬度（正面，以下層塔身寬 15.5 m ＝ 1）：台基 1.10／塔身 1.00（前面城門樓 0.65）／白石冠 1.00＋尖塔／
  //   鐘樓 0.71／欄杆 0.77／八角鐘亭 0.55／帳篷底 0.62 → 收成一點／星 0.42（實物 0.24，放大）
  // 部件尺寸（9000 塊估 s ≈ 1.43，s ＝ 每公尺幾格）：塔身寬 dim(s,15.5,11,奇)=23、塔身牆高 dim(s,25.5,12)=36、
  //   鐘面半徑 max(2.5, 3.7s)=5.3 → 直徑 11 格（照實物只有 9 格，放大到約 7.4 m）、鐘樓寬 dim(s,11,7,奇)=17、
  //   八角邊心距 dim(s,4.2,3)=6 → 寬 13、帳篷高 dim(s,14,8)=20、星外半徑 max(3,3.3s)=4.7 → 跨 9～10 格、
  //   城門洞寬 dim(s,3.8,3,奇)=5、高 9、角尖塔 2+8+1=11 格高、拱廊尖拱 3 寬 4 高、山花 5 寬 3 高
  // 部件：台基(walls) 塔身(walls＋hash100 磚色) 小窗／七個拱窗(windowGrid) 白帶與外凸白簷口(walls 環)
  //   前凸城門樓(walls＋box 屋面) 燕尾垛(box＋set) 城門隧道(arch 給 c 當暗內壁＋深處暗色擋板) 白石門框(arch)
  //   背面城門(arch＋擋板) 聖像龕(box 顏色函式＋階梯尖山花) 平台(walls 環) 白石拱廊(walls＋arch／carve)
  //   山花(box 疊) 小尖塔(box＋set) 四角大尖塔(box 台座＋taper＋金頂) 鐘樓方塊(walls 顏色函式：白轉角)
  //   鐘面 ×4(自己畫的小圓＋tint) 欄杆(walls) 欄杆角尖塔(taper) 八角鐘亭(自己寫的八角形逐層迴圈，顏色函式畫拱洞)
  //   八角簷、帳篷頂(同一支八角迴圈逐層收) 尖柱(cyl) 紅寶石星(自己寫的五角星迴圈，正面一片、側面一片十字交叉)
  pal: [0xa9432f,   // 0 紅磚
        0x8a3424,   // 1 暗紅磚（雜色、台基、平台）
        0xe3ddce,   // 2 白石
        0xa8a091,   // 3 白石陰影
        0x18181e,   // 4 鐘面黑底
        0xd6a536,   // 5 金（鐘框、指針、尖塔金頂、聖像、尖柱）
        0x357552,   // 6 帳篷頂綠
        0x285a3f,   // 7 帳篷頂暗綠
        0xe0203f,   // 8 紅寶石星
        0x2a2220,   // 9 開口暗色（窗、鐘亭拱洞、門洞深處）
        0x5a2a20],  // 10 城門隧道內壁
  lo: 0.3, hi: 2.2,

  gen(v, s) {
    const BR = 0, BRD = 1, WH = 2, WHS = 3, BLK = 4, GOLD = 5, GR = 6, GRD = 7, RUBY = 8, DARK = 9, TUN = 10;
    const brick = (x, y, z) => (hash100(x, y, z) < 16 ? BRD : BR);

    // ── 尺寸（s ＝ 每公尺幾格）──
    const W0 = dim(s, 15.5, 11, true), h0 = (W0 - 1) / 2;   // 下層塔身寬
    const PH = dim(s, 1.5, 2);                               // 台基高
    const H0 = dim(s, 25.5, 12);                             // 下層塔身牆高
    const Y1 = PH + H0;                                      // 平台那一層
    const AH = dim(s, 4, 5);                                 // 白石拱廊冠高
    const pier = dim(s, 2, 1), P = 3 + pier;                 // 拱距（拱寬 3）
    const g0 = Math.min(5, P - 1), gw = g0 % 2 ? g0 : g0 - 1, GH = (gw + 1) / 2;   // 山花寬、高
    const nA = P + (gw - 1) / 2 <= h0 - 2 ? 3 : 1;           // 每面幾個拱

    let CR = Math.max(2.5, s * 3.7);                         // 鐘面半徑
    let W2 = Math.max(dim(s, 11, 7, true), 2 * Math.ceil(CR + 0.35) + 3);
    if (W2 % 2 === 0) W2++;
    W2 = Math.min(W2, W0 - 2);
    const h2 = (W2 - 1) / 2;
    CR = Math.min(CR, h2 - 1.4);
    const cr = Math.round(CR);
    const cy = Y1 + AH + GH + 1 + cr;                        // 鐘心那一層（要高過前面的拱廊山花）
    const topC = cy + cr + dim(s, 1.5, 2);                   // 鐘樓方塊最頂層
    const H2 = topC - Y1 + 1;

    const a = Math.min(dim(s, 4.2, 3), h2 - 1);              // 八角鐘亭邊心距
    const Yo = topC + 1, OH = dim(s, 7, 5);
    const yc = Yo + OH;                                      // 八角簷
    const yt = yc + 1, TH = dim(s, 14, 8);                   // 帳篷頂
    const ys = yt + TH, SH = dim(s, 1.2, 1);                 // 尖柱
    const Ro = Math.max(3, s * 3.3), Ri = Ro * 0.5;          // 星
    const yS = ys + SH + Math.ceil(Ri);

    const DW = dim(s, 10, 7, true), dh = (DW - 1) / 2;       // 前凸城門樓
    const DD = dim(s, 7, 4), DH = dim(s, 11, 9), MH = dim(s, 1.8, 2);
    const fz = -h0, zF = fz - DD;
    const GW = dim(s, 3.8, 3, true), GHs = dim(s, 4.3, 2);   // 城門洞
    const gTop = GHs + (GW - 1) / 2 + 1;

    // ── 台基與下層塔身 ──
    v.walls(0, 0, 0, W0 + 2, PH, W0 + 2, (x, y, z) => (y === PH - 1 ? WHS : BRD), 2);
    v.walls(0, PH, 0, W0, H0, W0, brick, 1);

    // 小窗：側面、背面兩排，正面只有上排（下排被城門樓擋住）
    const lw = { cols: 3, stepX: dim(s, 4.5, 3), stepY: dim(s, 8, 5), w: 1, h: dim(s, 2, 2), c: DARK };
    const ly = PH + dim(s, 7, 4);
    mirrorX(v, h0, (vv, dx) => windowGrid(vv, Object.assign({ x: dx, y: ly, z: 0, rows: 2, axis: 'z' }, lw)));
    windowGrid(v, Object.assign({ x: 0, y: ly, z: h0, rows: 2 }, lw));
    windowGrid(v, Object.assign({ x: 0, y: ly + lw.stepY, z: -h0, rows: 1 }, lw));

    // 白石腰帶下的七個拱窗、白帶、外凸的白簷口
    const sh = dim(s, 2.6, 2), ncol = W0 >= 19 ? 7 : 5;
    const stp = Math.max(2, Math.floor((W0 - 2) / ncol)), slotY = Y1 - 2 - sh;
    const sw = { y: slotY, cols: ncol, stepX: stp, w: 1, h: sh, c: DARK };
    mirrorZ(v, h0, (vv, dz) => windowGrid(vv, Object.assign({ x: 0, z: dz }, sw)));
    mirrorX(v, h0, (vv, dx) => windowGrid(vv, Object.assign({ x: dx, z: 0, axis: 'z' }, sw)));
    v.walls(0, Y1 - 2, 0, W0, 1, W0, WH, 1);
    v.walls(0, Y1 - 1, 0, W0 + 2, 1, W0 + 2, WH, 2);

    // ── 前凸城門樓（紅場那側）──
    const dzc = (zF + fz) / 2, dd = fz - zF + 1;
    v.walls(0, 0, dzc, DW, DH, dd, brick, 1);
    v.box(0, DH - 1, dzc, DW, 1, dd, (x, y, z) => (Math.abs(x) === dh || z === zF ? WH : BRD));
    const merl = (x, z, alongX) => {          // 燕尾垛：3 格寬，頂層只留兩隻角
      v.box(x, DH, z, alongX ? 3 : 1, MH - 1, alongX ? 1 : 3, BR);
      if (alongX) { v.set(x - 1, DH + MH - 1, z, BR); v.set(x + 1, DH + MH - 1, z, BR); }
      else { v.set(x, DH + MH - 1, z - 1, BR); v.set(x, DH + MH - 1, z + 1, BR); }
    };
    const nF = Math.max(1, Math.round((DW - 3) / 5)) + 1, pF = (DW - 3) / (nF - 1);
    for (let i = 0; i < nF; i++) {
      const p = -dh + 1 + i * pF;
      merl(Math.sign(p) * Math.round(Math.abs(p)), zF, true);
    }
    for (let zc = zF + 3; zc + 1 <= fz - 1; zc += 5) { merl(-dh, zc, false); merl(dh, zc, false); }

    // 城門：隧道內壁塗暗、深處一片暗色擋板；正面一圈白石門框
    const zE = fz + 2;
    arch(v, 0, 0, (zF + zE) / 2, GW, GHs, zE - zF + 1, TUN);
    v.box(0, 0, zE + 1, GW + 2, gTop + 1, 1, DARK);
    arch(v, 0, 0, zF, GW + 2, GHs, 1, WH);
    // 背面（克里姆林宮內側）城門
    arch(v, 0, 0, h0 + 0.5, GW, GHs, 2, WH);
    v.box(0, 0, h0 - 1, GW + 2, gTop + 1, 1, DARK);

    // 正面聖像龕（城門樓上方）：白框金心、頂上尖山花
    const IW = dim(s, 3.4, 3, true), IH = dim(s, 4.2, 4), iy = DH + MH + dim(s, 1.5, 1);
    if (iy + IH + (IW - 1) / 2 < slotY - 1) {
      v.box(0, iy, fz - 1, IW, IH, 1, (x, y, z) =>
        (Math.abs(x) === (IW - 1) / 2 || y === iy || y === iy + IH - 1 ? WH : GOLD));
      for (let k = 0; 2 * k < IW; k++) v.box(0, iy + IH + k, fz - 1, IW - 2 * k, 1, 1, WH);
    }

    // ── 平台、白石尖拱廊冠 ──
    v.walls(0, Y1, 0, W0, 1, W0, BRD, (W0 - W2) / 2 + 1);
    v.walls(0, Y1, 0, W0, AH, W0, (x, y, z) => (y === Y1 ? WHS : WH), 1);
    const aPos = nA === 3 ? [-P, 0, P] : [0];
    const ah = AH - 4;                       // 尖拱直段（3 格寬的拱頂只剩 1 格，像尖拱）
    for (const p of aPos) {
      mirrorZ(v, h0, (vv, dz) => arch(vv, p, Y1 + 1, dz, 3, ah, 1));
      mirrorX(v, h0, (vv, dx) => {
        vv.carve(dx, Y1 + 1, p, 1, ah + 1, 3);
        vv.carve(dx, Y1 + 2 + ah, p, 1, 1, 1);
      });
    }
    const gy = Y1 + AH;                      // 拱廊頂上一層
    const gable = (x, z, alongX) => {
      for (let k = 0; k < GH; k++)
        v.box(x, gy + k, z, alongX ? gw - 2 * k : 1, 1, alongX ? 1 : gw - 2 * k, WH);
    };
    for (const p of aPos) { gable(p, -h0, true); gable(p, h0, true); gable(-h0, p, false); gable(h0, p, false); }
    if (nA === 3) {                          // 山花之間的小尖塔
      const pp = Math.round(P / 2), PS = dim(s, 2.5, 2);
      for (const q of [-pp, pp]) for (const [x, z] of [[q, -h0], [q, h0], [-h0, q], [h0, q]]) {
        v.box(x, gy, z, 1, PS, 1, WH);
        v.set(x, gy + PS, z, GOLD);
      }
    }
    // 四角白尖塔（金頂）
    const PB = dim(s, 1.4, 2), PT = dim(s, 5.5, 4);
    corners4(v, h0, h0, (vv, x, z) => {
      vv.box(x, gy, z, 3, PB, 3, WHS);
      vv.taper(x, gy + PB, z, 1.3, 0.4, PT, WH);
      vv.box(x, gy + PB + PT, z, 1, dim(s, 1, 1), 1, GOLD);
    });

    // ── 鐘樓方塊（白轉角）與四面大鐘 ──
    const quadCol = (x, y, z) => {
      const ax = Math.abs(x), az = Math.abs(z);
      return (ax === h2 && az >= h2 - 1) || (az === h2 && ax >= h2 - 1) ? WH : brick(x, y, z);
    };
    v.walls(0, Y1, 0, W2, H2, W2, quadCol, 1);

    const RR = Math.ceil(CR + 0.35);
    const mLen = Math.max(0, Math.round(CR - 2.2)), hLen = CR >= 3.5 ? Math.round(CR * 0.45) : 0;
    const ticks = new Set();
    if (CR - 2 >= 2) for (let k = 0; k < 12; k++) {
      const t = k * Math.PI / 6;
      ticks.add(Math.round((CR - 2) * Math.sin(t)) + ',' + Math.round((CR - 2) * Math.cos(t)));
    }
    const dial = (i, j) => {                 // i 往看的人的右手、j 往上
      if (Math.hypot(i, j) > CR - 0.65) return GOLD;                                   // 金框
      if ((i === 0 && j >= 0 && j <= mLen) || (j === 0 && i >= 0 && i <= hLen)) return GOLD;  // 分針指 12、時針指 3
      return ticks.has(i + ',' + j) ? GOLD : BLK;                                      // 十二個刻度
    };
    const faces = [i => [-i, -h2], i => [i, h2], i => [h2, -i], i => [-h2, i]];
    for (const f of faces) for (let i = -RR; i <= RR; i++) for (let j = -RR; j <= RR; j++) {
      if (Math.hypot(i, j) > CR + 0.35) continue;
      const [x, z] = f(i);
      tint(v, x, cy + j, z, dial(i, j));
    }

    // 鐘樓頂、白欄杆、欄杆四角小尖塔
    const q = Math.max(0, Math.floor(a * 0.7) - 1);
    v.walls(0, topC, 0, W2, 1, W2,
      (x, y, z) => (Math.abs(x) === h2 || Math.abs(z) === h2 ? quadCol(x, y, z) : BRD), Math.max(1, h2 - q));
    v.walls(0, topC + 1, 0, W2 + 2, 2, W2 + 2, (x, y, z) => (y === topC + 1 ? WHS : WH), 2);
    const PS2 = dim(s, 3.5, 3);
    corners4(v, h2 + 1, h2 + 1, (vv, x, z) => {
      vv.taper(x, topC + 3, z, 0.9, 0.4, PS2, WH);
      vv.set(x, topC + 3 + PS2, z, GOLD);
    });

    // ── 八角鐘亭、八角簷、帳篷頂（自己寫的八角形逐層迴圈）──
    const octD = (dx, dz) => Math.max(Math.abs(dx), Math.abs(dz), (Math.abs(dx) + Math.abs(dz)) / Math.SQRT2);
    const octLayer = (y, A, t, cf) => {
      const R = Math.ceil(A);
      for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) {
        const d = octD(dx, dz);
        if (d > A || d <= A - t) continue;
        v.set(dx, y, dz, cf(dx, y, dz));
      }
    };
    const ow = Math.max(0.5, a * 0.25), oc = Math.max(0.9, a * 0.32);
    const ob = Yo + 1, ot = Yo + OH - 3;
    const octCol = (x, y, z) => {
      const k = Math.round(Math.atan2(z, x) / (Math.PI / 4)), ph = k * Math.PI / 4;
      const lat = Math.abs(-x * Math.sin(ph) + z * Math.cos(ph));    // 離這一面中線多遠
      if (lat > oc || y >= Yo + OH - 2) return WH;                  // 轉角白柱、頂上白簷
      if (y === Yo) return WHS;
      if ((y >= ob && y < ot && lat <= ow) || (y === ot && lat <= 0.5)) return DARK;   // 拱洞
      return BR;
    };
    for (let y = Yo; y < Yo + OH; y++) octLayer(y, a, 1.6, octCol);
    octLayer(yc, a + 1, 2, () => WH);
    const tent = (x, y, z) => (hash100(x, y, z) < 20 ? GRD : GR);
    for (let i = 0; i < TH; i++) octLayer(yt + i, (a + 1) - (a + 0.5) * i / (TH - 1), 1.6, tent);

    // ── 尖柱與紅寶石星（正面一片、側面一片，十字交叉）──
    v.cyl(0, ys, 0, 0.4, yS - ys + 1, GOLD);
    const c36 = Math.cos(Math.PI / 5), s36 = Math.sin(Math.PI / 5);
    const ex = Ri * c36 - Ro, ey = Ri * s36;
    const RS = Math.ceil(Ro) + 1;
    for (let u = -RS; u <= RS; u++) for (let w = -RS; w <= RS; w++) {
      const r = Math.hypot(u, w);
      let th = Math.atan2(u, w) * 180 / Math.PI;
      th = ((th % 72) + 72) % 72;
      const g = (th > 36 ? 72 - th : th) * Math.PI / 180;     // 離最近的尖角幾度
      const rb = Ro * ey / (Math.cos(g) * ey - Math.sin(g) * ex);
      if (r > rb + 0.3) continue;
      v.set(u, yS + w, 0, RUBY);
      v.set(0, yS + w, u, RUBY);
    }
  } },

/* ── 動物 ─────────────────────────────────────────────────
   一律面向 −z（跟獅身人面像同一個朝向），比例以頭為錨（其餘寫成頭的倍數）。
   v1.257.0 起四座都蓋在 voxGrid 上：軀幹、頭用 E（帶顏色函式的 blob），四肢、脖子、尾巴、
   鼻子用 L（帶顏色函式的 limb，先拉骨幹線，中間不會斷成懸空的一截）。
   半徑一律不取整，塊數才跟著尺度連續長。 */

{ n: '大象', lo: 3.6, hi: 26,
  // v1.257.0 整座重畫（見 開發筆記〈舊版 21 座重畫、偏白的 5 座調色〉）
  // 大象（非洲象）
  // 正面：大頭居中、兩片大耳朵往兩側張開（比頭還高、往下垂到下巴以下），長鼻子從臉中央垂到快碰地、
  //       末端往前捲，兩根象牙從鼻根兩側往前下方伸出再微微上翹；四根柱子般的腿，前腿之間看得到縫
  // 側面：肩高臀低的厚實軀幹、腹部下垂；大頭在軀幹前上方、額頭隆起、臉往下收成鼻根；
  //       尾巴細細垂到膝蓋，末端一撮黑毛
  // 三樣識別物：張開的大耳朵（內側粉）、垂地的長鼻（一圈圈皺紋）、米白象牙
  // 部件（動物六層）：
  //   姿勢：四腳站立、頭微抬、鼻子垂下末端前捲
  //   軀幹：主軀幹＋隆起的肩胛＋圓臀（三顆橢球，背線肩高臀低）
  //   四肢：前後腿各分上下兩段（limb），後腿大腿較粗；腳掌外擴、底緣暗、三片米白趾甲
  //   頭與五官：短粗脖子、頭、額頭隆起、臉頰、眼睛（側前方）、下唇（粉）
  //   識別物：大耳朵（雙層：前粉後灰、外緣一圈灰）、長鼻（皺紋環、末端深）、象牙兩段、細尾＋黑毛穗
  //   皮膚：背上亮灰、側腹灰、腹側暗灰，加一點固定雜湊的斑駁；腿上一圈圈斷續的皺紋
  pal: [0x8b8783,   // 0 灰皮（側腹、頭側、腿）
        0xaaa59e,   // 1 亮灰：背脊、頭頂（受光面）
        0x625e5a,   // 2 暗灰：腹側、皺紋、腳底、鼻端
        0xc99490,   // 3 耳朵內側的粉、下唇
        0xece2c9,   // 4 象牙、腳趾甲（米白）
        0x2a2623],  // 5 眼睛、尾巴末端的毛
  gen(v, s) {
    /* 比例以頭為錨：H ＝ 頭高。肩高約 2.7H、身長約 3H、腿到腹底約 1.1H。
       有機造型的半徑一律不取整（塊數才連續）。顏色一邊蓋一邊挑，不蓋完再掃。 */
    const H = s * 0.5;

    /* ── 局部格子：先蓋在陣列上，最後一次寫進 v（理由見 voxGrid） ── */
    const BX = Math.ceil(1.6 * H) + 4, BY = Math.ceil(3.2 * H) + 4;
    const BZ0 = -Math.ceil(3.3 * H) - 4, BZ1 = Math.ceil(2.2 * H) + 4;
    const { put, has, paint, E, L, flush } = voxGrid(v, BX, BY, BZ0, BZ1);
    const H3 = hash100;

    /* 皮膚：背上亮、側腹灰、腹側暗。分界加一點固定雜湊，才是斑駁的皮而不是三條色帶 */
    const skin = (x, y, z, ny) => {
      const h = H3(x, y, z), t = ny + (h < 14 ? 0.2 : h > 86 ? -0.2 : 0);
      return t > 0.3 ? 1 : t < -0.32 ? 2 : 0;
    };
    const wr = Math.max(2, Math.round(H * 0.3));          // 腿上皺紋的間距
    const legC = (x, y, z) => y === 0 ? 2 : (y % wr === 0 && H3(x, y, z) < 72) ? 2 : 0;

    // ── 軀幹：主軀幹＋肩胛隆起＋圓臀（背線肩高臀低） ──
    E(0, 1.86 * H, 0, 0.68 * H, 0.74 * H, 1.42 * H, skin);
    E(0, 1.98 * H, -0.72 * H, 0.66 * H, 0.76 * H, 0.78 * H, skin);
    E(0, 1.84 * H, 0.82 * H, 0.64 * H, 0.7 * H, 0.72 * H, skin);

    // ── 四條柱腿：上下兩段，前腿直、後腿大腿較粗；腳掌外擴 ──
    const lx = 0.42 * H, fz = -0.82 * H, rz = 0.92 * H;
    const feet = [];
    for (const sx of [-1, 1]) {
      const x = sx * lx;
      L(x, 0, fz, x, 0.8 * H, fz - 0.03 * H, 0.31 * H, 0.27 * H, legC);                       // 前腿下段
      L(x, 0.8 * H, fz - 0.03 * H, sx * 0.4 * H, 1.75 * H, fz + 0.06 * H, 0.27 * H, 0.34 * H, legC); // 前腿上段
      L(x, 0, rz + 0.05 * H, x, 0.85 * H, rz - 0.02 * H, 0.3 * H, 0.26 * H, legC);              // 後腿下段
      L(x, 0.85 * H, rz - 0.02 * H, sx * 0.4 * H, 1.82 * H, rz - 0.1 * H, 0.27 * H, 0.37 * H, legC); // 後腿大腿
      feet.push([x, fz], [x, rz + 0.05 * H]);
    }
    // 腳趾甲：每隻腳前緣三片（小尺寸時疊成一片），大一點的尺寸兩格高
    const nr = 0.3 * H, ny0 = Math.round(Math.max(0, 0.06 * H)), nh = H >= 6 ? 2 : 1;
    for (const [x, z] of feet)
      for (const o of [-0.55, 0, 0.55])
        for (let j = 0; j < nh; j++)
          paint(Math.round(x + o * nr), ny0 + j, Math.round(z), 0, 0, -1, Math.ceil(nr) + 2, 4);

    // ── 頭：短粗的脖子、大頭、額頭隆起、臉往下收成鼻根 ──
    const hz = -1.86 * H, hy = 2.18 * H;
    E(0, 2.02 * H, -1.42 * H, 0.56 * H, 0.62 * H, 0.46 * H, skin);   // 脖子
    E(0, hy, hz, 0.56 * H, 0.6 * H, 0.5 * H, skin);                 // 頭
    E(0, hy + 0.32 * H, hz + 0.04 * H, 0.46 * H, 0.38 * H, 0.42 * H, skin);  // 額頭隆起
    E(0, hy - 0.3 * H, hz - 0.18 * H, 0.36 * H, 0.36 * H, 0.36 * H, skin);   // 臉頰收向鼻根
    E(0, 1.72 * H, hz - 0.2 * H, Math.max(0.6, 0.17 * H), Math.max(0.6, 0.1 * H), Math.max(0.6, 0.15 * H), () => 3);  // 下唇

    // ── 長鼻：從臉中央一路垂到快碰地，末端往前捲；一圈圈皺紋，末端深色 ──
    const tr = [[0, 2.0, -2.3, 0.27], [0, 1.5, -2.5, 0.22], [0, 0.92, -2.56, 0.17],
                [0, 0.42, -2.6, 0.13], [0, 0.2, -2.84, 0.11], [0, 0.34, -3.08, 0.1]];
    const tw = Math.max(2, Math.round(H * 0.18));
    for (let i = 0; i + 1 < tr.length; i++) {
      const a = tr[i], b = tr[i + 1], tip = i >= tr.length - 2;
      L(a[0] * H, a[1] * H, a[2] * H, b[0] * H, b[1] * H, b[2] * H, a[3] * H, b[3] * H,
        (x, y, z, ny, d2, t) => tip && t > 0.5 ? 2 : (d2 > 0.3 && y % tw === 0) ? 2 : 0);
    }

    // ── 象牙：鼻根兩側往前下方伸出，再微微往上翹 ──
    for (const sx of [-1, 1]) {
      L(sx * 0.24 * H, 1.86 * H, -2.1 * H, sx * 0.32 * H, 1.36 * H, -2.58 * H, 0.11 * H, 0.09 * H, () => 4);
      L(sx * 0.32 * H, 1.36 * H, -2.58 * H, sx * 0.27 * H, 1.5 * H, -2.98 * H, 0.09 * H, 0.06 * H, () => 4);
    }

    // ── 眼睛：頭的側前方，從頭裡往外斜斜找表面 ──
    for (const sx of [-1, 1])
      paint(sx * 0.1 * H, Math.round(hy + 0.08 * H), Math.round(hz - 0.12 * H), sx, 0, -0.55, Math.ceil(0.8 * H) + 2, 5);

    /* ── 大耳朵：一片兩格厚的橢圓板，從頭側往外、往後張開 40 度，下緣垂成耳垂。
       前面那層粉（耳內）、後面那層灰，外緣一圈灰、上緣受光。
       已經有積木的格子不碰——耳根埋在頭裡，頭側的皮不會被塗成粉的。 ── */
    const th = 40 * Math.PI / 180, ct = Math.cos(th), st = Math.sin(th);
    const uc = 0.56 * H, wc = -0.22 * H, au = 0.62 * H, aw = 0.86 * H, T = 1.0;
    for (const sx of [-1, 1]) {
      const Rx = sx * 0.4 * H, Ry = hy + 0.14 * H, Rz = hz + 0.22 * H;
      const ux = sx * ct, uz = st, nxv = -sx * st, nzv = ct;
      const uMax = uc + au;
      const x0 = Math.floor(Math.min(Rx, Rx + ux * uMax) - 2), x1 = Math.ceil(Math.max(Rx, Rx + ux * uMax) + 2);
      const z0 = Math.floor(Math.min(Rz, Rz + uz * uMax) - 2), z1 = Math.ceil(Math.max(Rz, Rz + uz * uMax) + 2);
      const y0 = Math.max(0, Math.floor(Ry + wc - aw)), y1 = Math.ceil(Ry + wc + aw);
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
        const px = x - Rx, pz = z - Rz, uu = px * ux + pz * uz, nn = px * nxv + pz * nzv;
        if (uu < 0 || nn > T || nn < -T) continue;
        const qu = (uu - uc) / au;
        for (let y = y0; y <= y1; y++) {
          const qw = (y - Ry - wc) / aw;
          // 下半圈往內收一點：耳垂尖、上緣寬（非洲象的耳朵像一片往下垂的葉子）
          const e = qu * qu * (qw < 0 ? 1 - qw * 0.35 : 1) + qw * qw;
          if (e > 1 || has(x, y, z)) continue;
          put(x, y, z, e > 0.6 ? (qw > 0.25 ? 1 : 0) : nn < 0 ? 3 : 0);
        }
      }
    }

    // ── 尾巴：尾根埋進臀部，細細垂到膝蓋高度，末端一撮黑毛 ──
    L(0, 2.05 * H, 1.45 * H, 0, 2.0 * H, 1.72 * H, 0.1 * H, 0.08 * H, () => 0);
    L(0, 2.0 * H, 1.72 * H, 0, 1.1 * H, 1.8 * H, 0.07 * H, 0.06 * H, () => 0);
    E(0, 1.0 * H, 1.8 * H, Math.max(0.6, 0.1 * H), Math.max(0.9, 0.17 * H), Math.max(0.6, 0.1 * H), () => 5);

    // 陣列裡的格子一次寫進 v
    flush();
  } },

{ n: '暴龍', lo: 3, hi: 26,
  // v1.257.0 整座重畫（見 開發筆記〈舊版 21 座重畫、偏白的 5 座調色〉）
  // 暴龍
  // 正面：窄長的大頭正對前方、張著嘴露出兩排白牙與紅色口腔，頭下兩隻小小的前肢，
  //       後面兩條粗壯的後腿分得很開，三根腳趾往前抓地
  // 側面：身體前傾、背線幾乎水平——大頭與長脖子在前、粗尾巴在後平伸當配重，
  //       髖部最高，大腿是一整塊雞腿狀的肌肉，小腿與蹠骨往後折（趾行）
  // 三樣識別物：張開的大嘴與白牙、迷你的兩指前肢、水平前傾的姿勢加上粗長的尾巴
  // 部件（動物六層）：
  //   姿勢：前傾、背線水平、頭微抬、尾巴平伸末端微垂並往右擺
  //   軀幹：主軀幹＋下垂的胸腔＋高起的髖部（三顆橢球）、粗脖子（limb）
  //   四肢：後腿分大腿肌肉（blob）＋大腿／小腿／蹠骨三段（limb），三根腳趾＋黑爪；
  //         前肢上臂／前臂兩段＋兩根黑爪
  //   頭與五官：後腦＋長吻（兩顆橢球）、張開的下顎、紅色口腔、上下兩排白牙、
  //             黃眼（大尺寸有瞳孔）、眉骨隆起、鼻孔
  //   配色：背部橄欖綠＋深色橫紋、側面黃褐、腹部米色（一邊蓋一邊照部件的上下位置挑）
  pal: [0x5f6a36,   // 0 背部橄欖綠
        0x8b8551,   // 1 側面黃褐
        0x33321f,   // 2 深色橫紋、爪、瞳孔、鼻孔、眉骨
        0xcdbf90,   // 3 腹部、喉嚨、下巴底的米色
        0xf1ece0,   // 4 牙齒
        0xe8bf2a,   // 5 黃眼
        0xa3302a],  // 6 嘴裡的紅
  gen(v, s) {
    /* 比例以頭為錨：K ＝ 頭長。真的暴龍頭長約 1.4 公尺、全長約 12 公尺、髖高約 3.2 公尺；
       這裡全長約 6.8K、髖高約 2.3K（尾巴略短、身體略粗，整尊才不會細長到取景拉得太遠：
       照真實比例的第一版 3000 塊時長 64 格、身體只剩一條）。 */
    const K = s * 0.5;

    /* ── 局部格子：先蓋在陣列上，最後一次寫進 v（理由見 voxGrid） ── */
    const BX = Math.ceil(0.9 * K) + 4, BY = Math.ceil(3.5 * K) + 4;
    const BZ0 = -Math.ceil(3.2 * K) - 4, BZ1 = Math.ceil(3.9 * K) + 4;
    const { put, get, paint, E, L, NZ, flush } = voxGrid(v, BX, BY, BZ0, BZ1);
    const H3 = hash100;
    // 一串點連成一條漸細的 limb（脖子、尾巴、腳趾）
    const chain = (pts, cf) => {
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i], b = pts[i + 1];
        L(a[0] * K, a[1] * K, a[2] * K, b[0] * K, b[1] * K, b[2] * K, a[3] * K, b[3] * K, cf);
      }
    };

    /* 配色：照部件自己的上下位置挑（ny），背上橄欖綠＋深色橫紋、側面黃褐、肚子米色。
       橫紋沿 z 等距，背上整條、側面只到一半，遠看才是「一道一道」不是斑點。 */
    const P = Math.max(3, 0.42 * K), sw = P * 0.36;
    const BAND = new Uint8Array(NZ + 1);                     // 每個 z 是不是橫紋，先查好表（每格都算浮點取餘數太慢）
    for (let q = 0; q <= NZ; q++) { const z = q + BZ0; BAND[q] = ((z % P) + P) % P < sw ? 1 : 0; }
    const band = z => BAND[z - BZ0] === 1;
    const rex = (x, y, z, ny) => {
      const h = H3(x, y, z), t = ny + (h < 12 ? 0.15 : h > 88 ? -0.15 : 0);
      if (t < -0.4) return 3;
      if (t > 0.05 && band(z + (t > 0.45 ? 0 : 1))) return 2;
      return t > 0.3 ? 0 : 1;
    };
    const leg = (x, y, z) => H3(x, y, z) < 16 ? 0 : 1;
    const dark = () => 2;

    // ── 軀幹：主軀幹、下垂的胸腔、高起的髖部 ──
    E(0, 2.15 * K, -0.3 * K, 0.58 * K, 0.72 * K, 1.25 * K, rex);
    E(0, 1.92 * K, -0.85 * K, 0.52 * K, 0.7 * K, 0.62 * K, rex);
    E(0, 2.38 * K, 0.55 * K, 0.55 * K, 0.6 * K, 0.66 * K, rex);

    // ── 尾巴：從髖部往後平伸、末端微垂並往右擺（配重） ──
    chain([[0, 2.45, 0.85, 0.48], [0, 2.5, 1.7, 0.34], [0.05, 2.35, 2.5, 0.21],
           [0.2, 2.1, 3.2, 0.11], [0.42, 1.88, 3.7, 0.055]], rex);

    // ── 脖子＋頭：粗脖子往前上方、後腦寬、長吻往前收 ──
    L(0, 2.4 * K, -1.15 * K, 0, 2.9 * K, -1.85 * K, 0.5 * K, 0.4 * K, rex);
    const head = (x, y, z, ny) => { const t = ny + (H3(x, y, z) < 12 ? 0.15 : 0); return t > 0.35 ? 0 : t < -0.55 ? 3 : 1; };
    E(0, 2.48 * K, -2.55 * K, 0.22 * K, 0.17 * K, 0.42 * K, () => 6);  // 口腔（先畫，顎骨蓋上去後只剩縫裡的紅）
    E(0, 3.02 * K, -2.12 * K, 0.4 * K, 0.37 * K, 0.38 * K, head);      // 後腦
    E(0, 2.93 * K, -2.58 * K, 0.3 * K, 0.28 * K, 0.5 * K, head);       // 長吻
    L(0, 2.6 * K, -1.98 * K, 0, 2.1 * K, -2.88 * K, 0.25 * K, 0.15 * K,   // 下顎（張開約 25 度）
      (x, y, z, ny) => ny < -0.25 ? 3 : 1);

    /* 牙齒：沿上顎下緣、下顎上緣隔一格塗白。顎的邊緣先找出來再換色（不另外長格子），
       找的時候跳過口腔的紅：由上往下第一個「下面是紅或空」的格子就是上顎的下緣。
       搜尋範圍只到上下顎交界那一帶，不然嘴角（上下顎疊在一起）會找到下巴底下去。 */
    const tx = Math.max(1, Math.round(0.17 * K));
    const zt0 = Math.round(-3.08 * K), zt1 = Math.round(-2.35 * K);
    const yu0 = Math.round(3.2 * K), yu1 = Math.round(2.56 * K), yl0 = Math.round(1.9 * K), yl1 = Math.round(2.58 * K);
    for (let z = zt0; z <= zt1; z++) {
      if ((z - zt0) % 2) continue;
      for (const x of [-tx, 0, tx]) {
        if (x === 0 && z > zt0 + 1) continue;                   // 正中間只有吻尖那一顆
        for (let y = yu0; y >= yu1; y--) {
          const c = get(x, y, z), b = get(x, y - 1, z);
          if (c >= 0 && c !== 6 && (b < 0 || b === 6)) { put(x, y, z, 4); break; }
        }
        for (let y = yl0; y <= yl1; y++) {
          const c = get(x, y, z), u = get(x, y + 1, z);
          if (c >= 0 && c !== 6 && (u < 0 || u === 6)) { put(x, y, z, 4); break; }
        }
      }
    }

    // ── 眼睛、眉骨、鼻孔 ──
    for (const sx of [-1, 1]) {
      const ey = Math.round(3.08 * K), ez = Math.round(-2.32 * K);
      E(sx * 0.27 * K, 3.24 * K, -2.3 * K, Math.max(0.6, 0.1 * K), Math.max(0.6, 0.07 * K), Math.max(0.7, 0.13 * K), dark);  // 眉骨
      paint(sx * 0.05 * K, ey, ez, sx, 0.1, -0.35, Math.ceil(0.6 * K) + 2, 5);
      if (K >= 8.5) {                                         // 大尺寸：黃眼 2×2，中間一格瞳孔
        paint(sx * 0.05 * K, ey + 1, ez, sx, 0.1, -0.35, Math.ceil(0.6 * K) + 2, 5);
        paint(sx * 0.05 * K, ey, ez - 1, sx, 0.1, -0.35, Math.ceil(0.6 * K) + 2, 2);
        paint(sx * 0.05 * K, ey + 1, ez - 1, sx, 0.1, -0.35, Math.ceil(0.6 * K) + 2, 5);
      }
      paint(sx * Math.max(1, 0.08 * K), Math.round(3.0 * K), Math.round(-2.8 * K), 0, 0.35, -1, Math.ceil(0.6 * K) + 2, 2);  // 鼻孔
    }

    // ── 迷你前肢：上臂往下外、前臂往前，兩根黑爪 ──
    for (const sx of [-1, 1]) {
      L(sx * 0.36 * K, 1.78 * K, -1.25 * K, sx * 0.5 * K, 1.5 * K, -1.38 * K, 0.12 * K, 0.1 * K, leg);
      L(sx * 0.5 * K, 1.5 * K, -1.38 * K, sx * 0.44 * K, 1.52 * K, -1.78 * K, 0.1 * K, 0.08 * K, leg);
      for (const o of [-0.05, 0.05])
        L(sx * (0.44 + o) * K, 1.52 * K, -1.78 * K, sx * (0.44 + o) * K, 1.4 * K, -1.88 * K, 0.04 * K, 0.04 * K, dark);
    }

    // ── 後腿：大腿肌肉、大腿、小腿、蹠骨（往後折），三根腳趾＋黑爪 ──
    for (const sx of [-1, 1]) {
      const x = sx * 0.54 * K;
      E(sx * 0.5 * K, 1.98 * K, 0.45 * K, 0.32 * K, 0.62 * K, 0.5 * K, rex);        // 大腿肌肉（雞腿）
      L(sx * 0.48 * K, 2.2 * K, 0.52 * K, x, 1.25 * K, 0.08 * K, 0.34 * K, 0.24 * K, rex); // 大腿 → 膝
      L(x, 1.25 * K, 0.08 * K, x, 0.5 * K, 0.55 * K, 0.24 * K, 0.15 * K, leg);        // 小腿 → 踝
      L(x, 0.5 * K, 0.55 * K, x, 0.15 * K, 0.32 * K, 0.15 * K, 0.13 * K, leg);        // 蹠骨 → 腳掌
      for (const o of [-0.17, 0, 0.17]) {
        const tx2 = x + o * K, tz = (o === 0 ? -0.16 : -0.05) * K;
        L(x, 0.12 * K, 0.3 * K, tx2, 0.1 * K, tz, 0.11 * K, 0.08 * K, leg);           // 腳趾
        L(tx2, 0.1 * K, tz, tx2, 0.06 * K, tz - 0.11 * K, 0.06 * K, 0.045 * K, dark);  // 爪
      }
    }

    // 陣列裡的格子一次寫進 v
    flush();
  } },

{ n: '長頸鹿', lo: 3, hi: 24,
  // v1.257.0 整座重畫（見 開發筆記〈舊版 21 座重畫、偏白的 5 座調色〉）
  // 長頸鹿（網紋長頸鹿）
  // 正面：四條細長的腿撐著不算寬的身體，長脖子從胸口往上直直升到頭，頭頂兩根短角、兩側一對橫伸的耳朵
  // 側面：背線前高後低（肩隆起、臀部低），脖子從肩往前上方斜伸約 60 度、長度跟身體差不多，
  //       頭往前下方收成口鼻；前腿比後腿長，後腿在膝與跗關節往後折；尾巴垂到跗關節，末端一撮黑毛
  // 三樣識別物：棕色多邊形斑塊＋淺米色網線（網紋）、比身體還長的脖子＋後頸的短鬃、頭頂兩根末端黑毛的短角
  // 部件（動物六層）：
  //   姿勢：四腳站立、脖子斜伸、頭微低
  //   軀幹：主軀幹＋隆起的肩＋較低的臀（三顆橢球）
  //   四肢：前腿（前臂、腕節、管骨、蹄）、後腿（大腿、小腿、跗關節、管骨、蹄），各分段用 limb；
  //         膝以下淺色、蹄深色
  //   頭與五官：頭骨、口鼻（淺色）、鼻孔、眼睛、橫伸的耳朵、兩根角（ossicones）＋黑毛尖
  //   識別物：網紋（建造時用三維 Voronoi 挑色）、後頸短鬃（沿脖子背緣一條）、細尾＋黑毛穗
  pal: [0xb0682e,   // 0 斑塊（橘棕）
        0x7c4520,   // 1 斑塊（深棕）
        0xe6d2a6,   // 2 網線、腿下段、腹側的淺米色
        0x2b211a,   // 3 蹄、角尖黑毛、尾穗、眼睛、鼻孔
        0x4e2812,   // 4 後頸短鬃
        0xd2a868],  // 5 臉、耳朵、角的淡黃褐
  gen(v, s) {
    /* 比例以頭為錨：K ＝ 頭長。肩高約 5.3K、角尖約 8.8K、身長約 3.3K、脖子約 3.6K
       （真的長頸鹿頭長約 0.6 公尺、總高約 5 公尺）。 */
    const K = s * 0.5;

    /* ── 局部格子：先蓋在陣列上，最後一次寫進 v（理由見 voxGrid） ── */
    const BX = Math.ceil(0.8 * K) + 4, BY = Math.ceil(9.0 * K) + 4;
    const BZ0 = -Math.ceil(4.0 * K) - 4, BZ1 = Math.ceil(2.4 * K) + 4;
    const { paint, E, L, flush, G, NY, NZ } = voxGrid(v, BX, BY, BZ0, BZ1, c => c === 6 ? 0 : c);   // 6 ＝ 下面的 COAT（框外不會發生，保險）
    const H3 = hash100;
    const k = a => a * K;

    /* ── 網紋：三維 Voronoi（不蓋完再到 v 裡掃一遍重上色）──
       空間切成邊長 C 的格子，每格用雜湊放一個特徵點；一格積木找最近與次近的兩個點，
       兩個距離差不多（落在兩塊斑塊的交界上）就是網線，否則是那一塊斑塊的顏色。
       只看相鄰 2×2×2 個格子（特徵點只在格子中間六成裡抖動，最近的點幾乎都在這八格裡），
       特徵點先整批算好放進陣列（整隻也才幾百格），每一格積木只查表、不再算雜湊。
       蓋的時候只先記一個「這格是毛皮」（COAT），最後寫進 v 那一趟才挑色：
       六個面有一面露在外面的才算網紋，看不到的內部照斑塊兩色的比例挑一色就好——
       網紋只算真正看得到的那三千多格（蓋的時候就算的話，三顆軀幹橢球疊在一起要算六千多次）。 */
    const C = Math.max(3.2, 0.82 * K), W = 0.8;
    const LX0 = Math.floor(-BX / C) - 1, LY0 = -1, LZ0 = Math.floor(BZ0 / C) - 1;
    const LNX = Math.ceil(BX / C) - LX0 + 2, LNY = Math.ceil(BY / C) - LY0 + 2, LNZ = Math.ceil(BZ1 / C) - LZ0 + 2;
    const FP = new Float64Array(LNX * LNY * LNZ * 3), FC = new Uint8Array(LNX * LNY * LNZ);
    for (let a = 0; a < LNX; a++) for (let b = 0; b < LNY; b++) for (let c = 0; c < LNZ; c++) {
      let h = Math.imul(LX0 + a, 73856093) ^ Math.imul(LY0 + b, 19349663) ^ Math.imul(LZ0 + c, 83492791);
      h = Math.imul(h ^ (h >>> 13), 1274126177); h = (h ^ (h >>> 16)) >>> 0;
      const i = (a * LNY + b) * LNZ + c;
      FP[3 * i] = LX0 + a + 0.2 + (h & 255) / 425;
      FP[3 * i + 1] = LY0 + b + 0.2 + ((h >>> 8) & 255) / 425;
      FP[3 * i + 2] = LZ0 + c + 0.2 + ((h >>> 16) & 255) / 425;
      FC[i] = (h >>> 24) % 5 < 2 ? 1 : 0;                     // 四成是深棕的斑塊
    }
    const net = (x, y, z) => {
      const fx = x / C, fy = y / C, fz = z / C;
      const ix = Math.floor(fx - 0.5) - LX0, iy = Math.floor(fy - 0.5) - LY0, iz = Math.floor(fz - 0.5) - LZ0;
      if (ix < 0 || iy < 0 || iz < 0 || ix + 1 >= LNX || iy + 1 >= LNY || iz + 1 >= LNZ) return 0;
      let d1 = 9, dd = 9, col = 0;
      for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let c = 0; c < 2; c++) {
        const i = ((ix + a) * LNY + iy + b) * LNZ + iz + c, p = 3 * i;
        const ex = fx - FP[p], ey = fy - FP[p + 1], ez = fz - FP[p + 2], d = ex * ex + ey * ey + ez * ez;
        if (d < d1) { dd = d1; d1 = d; col = FC[i]; } else if (d < dd) dd = d;
      }
      return (Math.sqrt(dd) - Math.sqrt(d1)) * C < W ? 2 : col;
    };
    const COAT = 6;                                           // 暫記「毛皮」：不是 pal 的顏色，寫進 v 之前一定換掉
    const coat = () => COAT;
    const shin = (x, y, z) => H3(x, y, z) < 10 ? 0 : 2;       // 膝以下：淺色，零星小斑
    const hoof = () => 3, tan = () => 5;

    // ── 軀幹：主軀幹、隆起的肩、較低的臀（背線前高後低） ──
    E(0, k(3.95), 0, k(0.64), k(0.82), k(1.58), coat);
    E(0, k(4.3), k(-0.85), k(0.62), k(0.97), k(0.82), coat);
    E(0, k(3.95), k(0.95), k(0.6), k(0.76), k(0.72), coat);

    // ── 四條長腿：前腿長而直、後腿在膝與跗關節往後折；膝以下淺色、蹄深色 ──
    for (const sx of [-1, 1]) {
      const x = sx * k(0.36), fz = k(-1.25), rz = k(1.3);
      L(x, k(4.0), k(-1.1), x, k(1.75), fz, k(0.24), k(0.15), coat);         // 前臂
      E(x, k(1.72), fz, k(0.17), k(0.2), k(0.17), shin);                      // 腕節
      L(x, k(1.72), fz, x, k(0.3), fz + k(0.03), k(0.14), k(0.11), shin);     // 管骨
      L(x, 0, fz + k(0.03), x, k(0.28), fz + k(0.03), k(0.15), k(0.13), hoof); // 蹄
      L(x, k(4.1), k(1.0), x, k(2.9), k(0.85), k(0.3), k(0.2), coat);         // 大腿
      L(x, k(2.9), k(0.85), x, k(1.75), rz + k(0.1), k(0.19), k(0.13), coat);  // 小腿
      E(x, k(1.75), rz + k(0.1), k(0.15), k(0.19), k(0.17), shin);            // 跗關節
      L(x, k(1.75), rz + k(0.1), x, k(0.3), rz, k(0.13), k(0.11), shin);      // 管骨
      L(x, 0, rz, x, k(0.28), rz, k(0.15), k(0.13), hoof);                    // 蹄
    }

    /* ── 脖子：從肩往前上方兩段，粗到細；後頸一條短鬃。
       鬃沿著每一段的「背緣」拉：段的方向 (0, dy, dz) 轉 90 度得到朝後上方的 (0, −dz, dy)，
       脖子中心線往那個方向推出半徑那麼遠就是背緣。 ── */
    const neck = [[k(4.55), k(-1.1), k(0.55)], [k(6.3), k(-2.05), k(0.36)], [k(7.75), k(-2.7), k(0.27)]];
    for (let i = 0; i + 1 < neck.length; i++) {
      const a = neck[i], b = neck[i + 1];
      L(0, a[0], a[1], 0, b[0], b[1], a[2], b[2], coat);
    }
    const mr = Math.max(0.6, k(0.1));
    for (let i = 0; i + 1 < neck.length; i++) {
      const a = neck[i], b = neck[i + 1], dy = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dy, dz);
      const py = -dz / l, pz = dy / l, ra = (i === 0 ? a[2] * 0.75 : a[2]) + mr * 0.7, rb = b[2] + mr * 0.7;
      L(0, a[0] + py * ra, a[1] + pz * ra, 0, b[0] + py * rb, b[1] + pz * rb, mr, mr, () => 4);
    }

    // ── 頭：頭骨、往前下方收的口鼻（淺色）、鼻孔、眼睛 ──
    const face = (x, y, z, ny) => ny > 0.55 && H3(x, y, z) < 40 ? 0 : 5;
    E(0, k(7.92), k(-2.86), k(0.3), k(0.32), k(0.32), face);                  // 頭骨（後腦）
    L(0, k(7.9), k(-2.95), 0, k(7.55), k(-3.6), k(0.29), k(0.2), face);       // 臉往口鼻收
    E(0, k(7.5), k(-3.62), k(0.21), k(0.2), k(0.22), () => 2);               // 口鼻
    for (const sx of [-1, 1]) {
      paint(sx * k(0.06), Math.round(k(7.56)), Math.round(k(-3.6)), 0, 0.25, -1, Math.ceil(k(0.4)) + 2, 3);  // 鼻孔
      paint(sx * k(0.08), Math.round(k(7.98)), Math.round(k(-3.02)), sx, 0, -0.35, Math.ceil(k(0.5)) + 2, 3); // 眼睛
      // 耳朵：從頭側往外、微微往後橫伸
      L(sx * k(0.2), k(8.02), k(-2.7), sx * k(0.6), k(8.1), k(-2.55), k(0.11), k(0.055), tan);
      // 兩根角（ossicones）：短柱、末端一撮黑毛
      L(sx * k(0.13), k(8.1), k(-2.82), sx * k(0.18), k(8.62), k(-2.74), k(0.08), k(0.07), tan);
      E(sx * k(0.18), k(8.68), k(-2.74), Math.max(0.6, k(0.1)), Math.max(0.6, k(0.09)), Math.max(0.6, k(0.1)), hoof);
    }

    // ── 尾巴：尾根埋進臀部，細細垂到跗關節，末端一撮黑毛 ──
    L(0, k(4.45), k(1.5), 0, k(4.3), k(1.95), k(0.1), k(0.08), coat);
    L(0, k(4.3), k(1.95), 0, k(2.75), k(2.1), k(0.07), k(0.055), () => 0);
    E(0, k(2.45), k(2.1), Math.max(0.6, k(0.12)), Math.max(1.0, k(0.35)), Math.max(0.6, k(0.12)), hoof);

    /* 陣列裡的格子一次寫進 v。毛皮格（COAT）在這裡才挑色：六個面有一面是空的（露在外面）
       就走網紋，否則是看不到的內部。貼地那一層的下面是地面，不算露出來。 */
    const SX = NY * NZ;
    flush((c, i, x, y, z) => {
      if (c !== COAT) return c;
      const open = !G[i + 1] || !G[i - 1] || !G[i + NZ] || (y > 0 && !G[i - NZ]) || !G[i + SX] || !G[i - SX];
      return open ? net(x, y, z) : H3(x, y, z) < 40 ? 1 : 0;
    });
  } },

{ n: '貓咪', lo: 8, hi: 36,
  // v1.257.0 整座重畫（見 開發筆記〈舊版 21 座重畫、偏白的 5 座調色〉）
  // 貓咪（橘色虎斑貓，坐姿）
  // 正面：圓頭兩頰外擴、頭頂兩隻三角耳（內側粉），綠眼、粉鼻、白口鼻，兩頰外側各伸出兩根短鬍鬚；
  //       白色胸口往下接兩隻併攏的前腳與白腳掌，屁股兩側鼓起摺著的後腿，尾巴從右後方繞到前腳邊
  // 側面：屁股圓圓地貼地、胸口往前上方挺、頭在最上面略往前；前腳直直撐地、後腳掌平貼在前腳旁
  // 三樣識別物：三角耳＋綠眼粉鼻的貓臉、橘色身上一道道深色虎斑（額頭有 M 字紋）、繞到前腳邊的捲尾
  // 部件（動物六層）：
  //   姿勢：坐姿，重心在屁股，頭正對前方
  //   軀幹：屁股（地面切平）＋兩側摺起的大腿＋挺起的胸＋肩頸
  //   四肢：前腳兩支直柱（limb）＋白腳掌、後腳掌平貼地面（白）
  //   頭與五官：圓頭＋外擴的兩頰、白口鼻＋下巴、粉鼻、綠眼（大尺寸有瞳孔）、三角耳（內粉外橘）、鬍鬚
  //   識別物：虎斑條紋（身上沿脊椎的垂直方向一道道、腿上一圈圈、額頭 M 字）、白胸口與白腳掌、
  //           沿地面繞一圈的尾巴（一圈圈深色環、末端深色）
  pal: [0xd9893b,   // 0 橘色毛（主色）
        0xa4561f,   // 1 深橘虎斑條紋
        0xf3eee4,   // 2 白：胸口、腳掌、口鼻、鬍鬚
        0xe89ca0,   // 3 粉：鼻子、耳朵內側
        0x63b23a,   // 4 綠眼
        0x2b2522,   // 5 瞳孔、嘴線
        0xf2c48c],  // 6 淺奶油橘：兩頰下緣、肚子、大腿內側
  gen(v, s) {
    /* 比例以頭為錨：W ＝ 頭寬（不含兩頰）。坐著的貓頭頂約 2.3W、耳尖約 2.5W、屁股寬約 1.4W。 */
    const W = s * 0.5;

    /* ── 局部格子：先蓋在陣列上，最後一次寫進 v（理由見 voxGrid） ── */
    const BX = Math.ceil(1.0 * W) + 4, BY = Math.ceil(2.6 * W) + 4;
    const BZ0 = -Math.ceil(1.0 * W) - 4, BZ1 = Math.ceil(1.15 * W) + 4;
    const { put, has, paint, E, L, flush } = voxGrid(v, BX, BY, BZ0, BZ1);
    const H3 = hash100;
    const w = a => a * W;

    /* ── 虎斑：條紋垂直於脊椎。坐著的貓脊椎從尾根（低、後）斜到肩（高、前），
       沿脊椎的座標 q ＝ 0.8y − 0.6z，加一點 |x| 讓條紋在側面往下彎、再加一點雜湊讓邊緣不齊。 */
    const P = Math.max(2.6, w(0.26)), sw = 0.44;
    const stripe = (x, y, z) => {
      const q = (y * 0.8 - z * 0.6 + Math.abs(x) * 0.35 + (H3(x, y, z) % 3 - 1) * 0.35) / P;
      return q - Math.floor(q) < sw;
    };
    const fur = (x, y, z, ny) => stripe(x, y, z) ? 1 : ny < -0.55 ? 6 : 0;
    // 胸口：正面那一片白（只塗表面，裡面照樣是橘的）
    const chest = (x, y, z, ny, d2) => d2 > 0.5 && z < w(-0.44) && Math.abs(x) < w(0.3) ? 2 : fur(x, y, z, ny, d2);
    // 腿：一圈圈的環，腳踝以下白襪
    const legC = (x, y, z) => y < w(0.26) ? 2 : ((y / P) - Math.floor(y / P) < 0.34 ? 1 : 0);
    const white = () => 2;

    // ── 軀幹：屁股（地面切平）、兩側摺起的大腿、挺起的胸、肩頸 ──
    E(0, w(0.5), w(0.3), w(0.64), w(0.58), w(0.66), fur);
    for (const sx of [-1, 1]) E(sx * w(0.42), w(0.42), w(0.32), w(0.3), w(0.42), w(0.52), fur);
    E(0, w(1.0), w(-0.22), w(0.44), w(0.58), w(0.42), chest);
    E(0, w(1.42), w(-0.28), w(0.38), w(0.32), w(0.36), chest);

    // ── 四肢：前腳兩支直柱＋白腳掌、後腳掌平貼地面 ──
    for (const sx of [-1, 1]) {
      L(sx * w(0.2), w(0.95), w(-0.42), sx * w(0.2), w(0.16), w(-0.52), w(0.15), w(0.13), legC);
      E(sx * w(0.2), w(0.13), w(-0.6), w(0.17), w(0.13), w(0.2), white);
      L(sx * w(0.42), w(0.13), w(0.05), sx * w(0.4), w(0.13), w(-0.36), w(0.15), w(0.14), white);
    }

    // ── 頭：圓頭、外擴的兩頰、白口鼻與下巴 ──
    const hy = w(1.86), hz = w(-0.42);
    const headC = (x, y, z, ny, d2) => {
      if (d2 < 0.4) return 0;
      // 額頭 M 字：頭頂前半部一條條直紋
      if (ny > 0.3 && z < hz + w(0.1)) return (Math.abs(x) + w(0.06)) % (2 * Math.max(1.4, w(0.11))) < Math.max(1.4, w(0.11)) * 0.9 ? 1 : 0;
      // 後腦：橫紋
      if (z > hz + w(0.1)) return stripe(x, y, z) ? 1 : 0;
      return 0;
    };
    const cheekC = (x, y, z, ny, d2) => d2 < 0.4 ? 0 : ny < -0.35 ? 6 :
      (Math.abs(x) > w(0.38) && ((y / P) - Math.floor(y / P)) < 0.35) ? 1 : 0;
    E(0, hy, hz, w(0.5), w(0.43), w(0.42), headC);
    E(0, w(1.74), w(-0.48), w(0.56), w(0.3), w(0.36), cheekC);
    for (const sx of [-1, 1]) E(sx * w(0.08), w(1.67), w(-0.79), w(0.11), w(0.1), w(0.1), white);   // 兩側鬍鬚墊
    E(0, w(1.57), w(-0.72), Math.max(0.6, w(0.12)), Math.max(0.6, w(0.07)), Math.max(0.6, w(0.08)), white);  // 下巴

    // ── 三角耳：一層一層往上收的薄板，兩格厚；前面那層內粉、外緣與後面那層橘 ──
    const eb = Math.max(1.5, w(0.18)), eh = Math.max(2, w(0.4)), ez = w(-0.4);
    for (const sx of [-1, 1]) {
      const n = Math.round(eh);
      for (let j = 0; j <= n; j++) {
        const t = j / n, half = eb * (1 - t), cx = sx * (w(0.27) + w(0.06) * t), y = Math.round(w(2.1)) + j;
        const zb = Math.round(ez + w(0.1) * t), deep = t > 0.6 ? 1 : 2;    // 耳尖往後微傾、上半變薄
        for (let x = Math.round(cx - half); x <= Math.round(cx + half); x++)
          for (let dz = 0; dz < deep; dz++) {
            const zz = zb + dz, rim = x === Math.round(cx - half) || x === Math.round(cx + half) || j === n;
            if (has(x, y, zz)) continue;                     // 耳根埋在頭裡的那幾格不碰（頭頂不會被塗成粉的）
            put(x, y, zz, dz === 0 && !rim ? 3 : t > 0.5 && dz === 1 && H3(x, y, zz) < 40 ? 1 : 0);
          }
      }
    }

    // ── 五官：綠眼（大尺寸 2×2、內下角一格瞳孔）、粉鼻、嘴線 ──
    const ex = Math.max(1, Math.round(w(0.2))), ey = Math.round(w(1.9)), big = W >= 9;
    for (const sx of [-1, 1]) {
      paint(sx * ex, ey, hz, 0, 0, -1, Math.ceil(w(0.6)) + 2, 4);
      if (big) {
        paint(sx * ex, ey + 1, hz, 0, 0, -1, Math.ceil(w(0.6)) + 2, 4);
        paint(sx * (ex + 1), ey + 1, hz, 0, 0, -1, Math.ceil(w(0.6)) + 2, 4);
        paint(sx * (ex + 1), ey, hz, 0, 0, -1, Math.ceil(w(0.6)) + 2, 5);
      }
    }
    const ny0 = Math.round(w(1.74));
    paint(0, ny0, hz, 0, 0, -1, Math.ceil(w(0.6)) + 3, 3);                       // 鼻子
    if (big) for (const sx of [-1, 1]) paint(sx, ny0 + 1, hz, 0, 0, -1, Math.ceil(w(0.6)) + 3, 3);
    paint(0, ny0 - 1, hz, 0, 0, -1, Math.ceil(w(0.6)) + 3, 5);                   // 嘴線（人中）

    /* ── 鬍鬚：兩頰外側各兩根，只伸出臉頰一兩格。
       從臉頰裡面往外拉一條線，只在空氣裡長格子（不蓋掉臉）——
       第一版從口鼻前面橫拉過去，整根浮在臉前面，遠看是一根橫過臉的白棍子。 ── */
    for (const sx of [-1, 1])
      for (const yy of [1.75, 1.6]) {
        const x0 = sx * w(0.42), x1 = sx * (w(0.56) + 1.5), Y = Math.round(w(yy)), Z = Math.round(w(-0.62));
        for (let X = Math.round(x0); X !== Math.round(x1) + sx; X += sx) if (!has(X, Y, Z)) put(X, Y, Z, 2);
      }

    // ── 尾巴：從屁股後面沿地面繞到右前方、末端停在前腳邊；一圈圈深色環、末端深色 ──
    const tail = [[0, 0.3, 0.88, 0.13], [0.45, 0.14, 0.98, 0.12], [0.8, 0.12, 0.58, 0.115],
                  [0.84, 0.12, 0.0, 0.11], [0.64, 0.12, -0.46, 0.1], [0.4, 0.14, -0.74, 0.095]];
    let acc = 0;
    const seg = [];
    for (let i = 0; i + 1 < tail.length; i++) {
      const a = tail[i], b = tail[i + 1];
      seg.push(acc); acc += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    }
    const ring = Math.max(2.2, w(0.2));
    for (let i = 0; i + 1 < tail.length; i++) {
      const a = tail[i], b = tail[i + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      L(w(a[0]), w(a[1]), w(a[2]), w(b[0]), w(b[1]), w(b[2]), w(a[3]), w(b[3]), (x, y, z, ny, d2, t) => {
        const u = (seg[i] + l * t) / acc;
        if (u > 0.92) return 1;
        const r = w((seg[i] + l * t)) / ring;
        return r - Math.floor(r) < 0.4 ? 1 : 0;
      });
    }

    // 陣列裡的格子一次寫進 v
    flush();
  } },

/* ── 交通工具 ─────────────────────────────────────────────
   全部沿 z 前進、車頭在 −z。輪子用 wheelX（圓面立在 y–z 上），
   車身／機身橫躺的圓柱用 tubeZ。 */

{ n: '蒸汽火車', lo: 3, hi: 31,
  // v1.257.0 整座重畫（見 開發筆記〈舊版 21 座重畫、偏白的 5 座調色〉）
  // 蒸汽火車
  // 正面（−z）：紅色楔形排障器貼著鐵軌，上面是黑色圓煙箱＋灰色煙箱門，煙箱頂上一盞方形大車頭燈，後面高高的喇叭口煙囪
  // 側面：美式 4-4-0——前導轉向架兩對小輪、兩對紅色大動輪連著鋼連桿與主連桿、汽缸；黑鍋爐上依序頂著煙囪／鐘／沙箱／銅汽包，
  //       駕駛室騎在後動輪上，後面拖一節裝滿煤的煤水車；整台站在一段鐵軌＋枕木上（底物：火車本來就站在鐵軌上）
  // 三樣識別物：紅色大動輪（輪輻＋連桿）、喇叭口煙囪＋方形車頭燈、車頭的紅色排障器
  // 部件：枕木 鐵軌｜前導輪 動輪(輪箍、輪輻、輪轂) 連桿 主連桿 導桿 汽缸｜大梁 步道板(紅邊) 緩衝樑 排障器｜
  //       煙箱 煙箱門 鍋爐 銅腰帶｜煙囪(銅口) 車頭燈 鐘 沙箱 汽包 安全閥｜駕駛室(前窗、側窗、拱頂)｜
  //       聯結器｜煤水車(車身、金線框、煤堆、水艙蓋、車輪、後緩衝樑)
  pal: [0x2c3036,   // 0 鍋爐黑：鍋爐、煙箱、煙囪、煤水車車身
        0x666d75,   // 1 鋼灰：鐵軌、連桿、煙箱門、輪箍、車頂
        0xa8312a,   // 2 紅：動輪、排障器、緩衝樑、駕駛室、步道板紅邊
        0xd1a147,   // 3 黃銅：汽包、鐘、腰帶、輪轂、窗框、金線
        0x6b4a31,   // 4 枕木
        0xf7de86,   // 5 車頭燈
        0x18191c],  // 6 煤、窗裡的暗處、輪輻間
  gen(v, s) {
    const B = (x0, x1, y0, y1, z0, z1, c) => {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) v.set(x, y, z, c);
    };
    const r = Math.max(1.7, s * 0.24), br = Math.floor(r + 0.35);     // 鍋爐半徑
    const R = Math.max(1.5, r * 0.85), wR = Math.floor(R + 0.35);     // 大動輪：跟鍋爐差不多粗
    const rp = Math.max(1, R * 0.5), pR = Math.floor(rp + 0.35);    // 前導小輪
    const rt = Math.max(1, R * 0.45), tR = Math.floor(rt + 0.35);   // 煤水車輪
    const hw = Math.max(2, Math.round(r * 0.72));                      // 輪子內側那一面的 x（鐵軌也在這）
    const ow = hw + 2;                                                 // 步道板／駕駛室／煤水車半寬
    const wy = 2 + wR, fy = wy + wR + 1, by = fy + br, py = 2 + pR;    // 動輪軸、步道板、鍋爐中心、小輪軸
    /* 縱向全部從車頭緩衝樑 zF 往後推（舊版各段各算中心，差三格沒接上） */
    const zF = 0;
    const pl = Math.max(2, Math.round(R * 0.8));
    const pp = 2 * pR + 2, dp = 2 * wR + 2;
    const zb = [zF + 1 + pR, zF + 1 + pR + pp];                        // 前導轉向架兩軸
    const zd = [zb[1] + pR + wR + 2, zb[1] + pR + wR + 2 + dp];        // 兩對動輪
    const sb = Math.max(3, Math.round(r * 1.5));                       // 煙箱長
    const zc0 = zd[1] - Math.max(1, Math.round(wR * 0.4));             // 駕駛室騎在後動輪上
    const cd = Math.max(3, Math.round(r * 1.5)), zc1 = zc0 + cd - 1;
    const zt0 = zc1 + 2, tl = Math.max(6, Math.round(r * 2.5)), zt1 = zt0 + tl - 1;
    const tfy = 3 + 2 * tR;                                            // 煤水車車底
    const tTop = by + 1;                                               // 煤水車車身頂

    // ── 鐵軌＋枕木（底物）
    const zA = zF - pl - 2, zB = zt1 + 2;
    const sp = Math.max(3, Math.round(R * 1.1)), sd = Math.max(1, Math.round(sp * 0.4));
    for (let z = zA; z <= zB; z += sp) B(-(hw + 3), hw + 3, 0, 0, z, Math.min(zB, z + sd - 1), 4);
    B(hw, hw, 1, 1, zA, zB, 1); B(-hw, -hw, 1, 1, zA, zB, 1);

    // ── 大梁（輪子內側兩片）：輪子都靠它與步道板接在一起
    B(hw - 1, hw - 1, wy - 1, wy + 1, zF + 1, zc1, 0); B(1 - hw, 1 - hw, wy - 1, wy + 1, zF + 1, zc1, 0);

    // ── 輪子：右輪在 hw..hw+1、左輪在 -hw-1..-hw，貼地那一格踩在鐵軌上
    const wheel = (z, y, rr, big) => {
      const n = Math.ceil(rr);
      for (const sx of [-1, 1]) {
        const fx = sx > 0 ? hw + 1 : -hw - 1, ix = sx > 0 ? hw : -hw;     // 外側面／內側面
        for (let j = -n; j <= n; j++) for (let k = -n; k <= n; k++) {
          const d = Math.hypot(j, k);
          if (d > rr + 0.35) continue;
          const tire = d > rr - 0.75 && rr >= 2;
          v.set(ix, y + j, z + k, tire ? 1 : 2);
          let c = tire ? 1 : 2;
          if (big && !tire && d > 1.2) {                               // 輪輻：輻條之間塗暗
            const a = Math.atan2(j, k) / (Math.PI / 4);
            if (Math.abs(a - Math.round(a)) > 0.24) c = 6;
          }
          v.set(fx, y + j, z + k, c);
        }
        v.set(fx, y, z, 3);                                            // 輪轂
      }
    };
    for (const z of zd) wheel(z, wy, R, wR >= 3);
    for (const z of zb) wheel(z, py, rp, false);

    // ── 汽缸＋導桿＋連桿＋主連桿（鋼灰）
    const rc = Math.max(1.1, R * 0.42), cl = Math.max(3, Math.round(R * 1.2));
    const zcy = Math.round((zb[0] + zb[1]) / 2) - Math.floor(cl / 2), cyY = wy + 1;
    B(2 - hw, hw - 2, wy - 1, fy, zcy, zcy + cl - 1, 0);               // 汽缸座（接到煙箱底）
    for (const sx of [-1, 1]) {
      tubeZ(v, sx * (hw + 1), cyY, zcy, rc, cl, 0);
      v.set(sx * (hw + 1), cyY, zcy, 1);                               // 汽缸前蓋
      const rx = sx * (hw + 2), zx = zcy + cl + Math.max(1, wR - 1);
      v.line(rx, cyY, zcy + cl, rx, cyY, zx, 1);                       // 導桿
      v.line(rx, wy - 1, zd[0], rx, wy - 1, zd[1], 1);                 // 連桿：兩個曲柄銷連成一條
      v.line(rx, cyY, zx, rx, wy - 1, zd[0], 1);                       // 主連桿
    }

    // ── 步道板（紅邊）＋緩衝樑＋排障器
    B(-ow, ow, fy, fy, zF + 1, zc0 - 1, 0);
    B(ow, ow, fy, fy, zF + 1, zc0 - 1, 2); B(-ow, -ow, fy, fy, zF + 1, zc0 - 1, 2);
    B(-ow, ow, fy - 2, fy, zF, zF, 2);
    for (let k = 1; k <= pl; k++) {                                    // 楔形：越往前越低越窄
      const top = Math.max(2, fy - 1 - Math.round((fy - 3) * k / (pl + 0.5)));
      const half = Math.max(1, Math.round(ow - (ow - 1) * k / (pl + 0.8)));
      B(-half, half, 2, top, zF - k, zF - k, 2);
      for (let x = 1 - half; x <= half - 1; x += 2) B(x, x, 2, top, zF - k, zF - k, 6);   // 牛擋的柵條縫
    }

    // ── 煙箱＋煙箱門
    const rs = r + 0.45;
    tubeZ(v, 0, by, zF + 1, rs, sb, 0, 1.5);
    {
      const n = Math.ceil(rs);
      for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) {
        const d = Math.hypot(i, j);
        if (d > rs + 0.35) continue;
        v.set(i, by + j, zF + 1, d > rs * 0.75 ? 0 : 1);
      }
      v.set(0, by, zF + 1, 3);                                         // 門把
    }
    // ── 鍋爐（中空）＋黃銅腰帶
    const zb0 = zF + sb + 1, Lb = zc0 - zb0;
    tubeZ(v, 0, by, zb0, r, Lb, 0, 1.5);
    for (const t of [0, 0.5, 1]) tubeZ(v, 0, by, zb0 + Math.round((Lb - 1) * t), r, 1, 3, 1.5);

    // ── 車頭燈：方形大燈箱坐在煙箱頂的最前緣
    const top = by + br;                                               // 鍋爐頂那一層
    const lw = Math.max(1, Math.round(r * 0.45)), lh = Math.max(2, Math.round(r * 0.55));
    const ld = Math.max(2, Math.round(r * 0.5));
    B(-lw, lw, top, top + lh - 1, zF, zF + ld - 1, 0);                // 往前凸出煙箱一格
    B(-lw, lw, top + lh, top + lh, zF, zF + ld - 1, 3);
    const le = lw >= 2 ? lw - 1 : lw;                                  // 燈面：大的時候留一圈黑框
    B(-le, le, top + (lh >= 3 ? 1 : 0), top + lh - 1, zF, zF, 5);

    // ── 煙囪（喇叭口、銅口）
    const zch = zF + ld + Math.max(2, Math.round(r * 0.55)), cr = Math.max(1, r * 0.3);
    const chh = Math.max(4, Math.round(r * 1.35));
    revolve(v, { x: 0, y: top - 1, z: zch, c: 0,
                 prof: [[cr * 1.3, 0], [cr, chh * 0.3], [cr * 1.1, chh * 0.55], [cr * 2, chh * 0.9], [cr * 2, chh]] });
    v.cyl(0, top - 1 + chh, zch, cr * 2, 1, 3, 1);
    v.cyl(0, top - 1 + chh, zch, Math.max(0.5, cr * 2 - 1), 1, 6);

    // ── 鍋爐頂上：鐘、沙箱、汽包、安全閥
    const dome = (z, rr, hh, c, capC) => {
      revolve(v, { x: 0, y: top - 1, z, c, prof: [[rr * 1.15, 0], [rr, hh * 0.55], [rr * 0.6, hh * 0.9], [rr * 0.2, hh]] });
      if (capC !== undefined) v.set(0, top - 1 + Math.round(hh), z, capC);
    };
    dome(zb0 + Math.max(1, Math.round(Lb * 0.12)), Math.max(0.8, r * 0.2), Math.max(2, r * 0.5), 3);        // 鐘
    dome(zb0 + Math.round(Lb * 0.4), Math.max(1, r * 0.3), Math.max(2, r * 0.6), 0, 3);                     // 沙箱
    dome(zb0 + Math.round(Lb * 0.72), Math.max(1.1, r * 0.36), Math.max(2.2, r * 0.75), 3);                 // 汽包
    v.cyl(0, top - 1, zc0 - 1, 0.6, Math.max(2, Math.round(r * 0.5)) + 1, 3);                             // 安全閥／汽笛

    // ── 駕駛室（紅）：前牆兩側開窗、側窗、拱頂
    const roofY = top + Math.max(2, Math.round(r * 0.6));
    for (let y = fy; y < roofY; y++)
      for (let x = -ow; x <= ow; x++) for (let z = zc0; z <= zc1; z++)
        if (Math.abs(x) === ow || z === zc0 || z === zc1) v.set(x, y, z, 2);
    const wy0 = by, wy1 = roofY - 2;
    for (let y = wy0; y <= wy1; y++) {
      for (let x = 2 - ow; x <= ow - 2; x++)                           // 前窗：鍋爐兩肩上方
        if (Math.abs(x) > r * 0.55 || y > top) tint(v, x, y, zc0, 6);
      for (let z = zc0 + 1; z <= zc1 - 1; z++) { tint(v, ow, y, z, 6); tint(v, -ow, y, z, 6); }
    }
    if (cd >= 6) for (let y = wy0; y <= wy1; y++) {                    // 側窗中間的窗柱
      const zm = Math.round((zc0 + zc1) / 2);
      tint(v, ow, y, zm, 2); tint(v, -ow, y, zm, 2);
    }
    for (let z = zc0; z <= zc1; z++) { tint(v, ow, wy0 - 1, z, 3); tint(v, -ow, wy0 - 1, z, 3); }   // 窗下金線
    B(-ow - 1, ow + 1, roofY, roofY, zc0 - 1, zc1 + 1, 1);
    B(-ow + 1, ow - 1, roofY + 1, roofY + 1, zc0, zc1, 1);

    // ── 聯結器
    B(-1, 1, tfy, tfy, zc1 + 1, zc1 + 1, 1);

    // ── 煤水車：車輪、車身（金線框）、煤堆、水艙蓋、後緩衝樑
    const nt = Math.max(2, Math.floor((tl - 1) / (2 * tR + 2)));
    rowOf(v, nt, (tl - 2 * tR - 2) / Math.max(1, nt - 1), (vv, z) => wheel(Math.round(z), 2 + tR, rt, false), (zt0 + zt1) / 2);
    for (let y = tfy; y <= tTop; y++)
      for (let x = -ow; x <= ow; x++) for (let z = zt0; z <= zt1; z++)
        if (y === tfy || Math.abs(x) === ow || z === zt0 || z === zt1) v.set(x, y, z, 0);
    const ly0 = tfy + 1, ly1 = tTop - 1;
    if (ly1 > ly0 + 1)
      for (const sx of [-1, 1]) for (let y = ly0; y <= ly1; y++) for (let z = zt0 + 1; z <= zt1 - 1; z++)
        if (y === ly0 || y === ly1 || z === zt0 + 1 || z === zt1 - 1) tint(v, sx * ow, y, z, 3);
    B(-ow, ow, tTop, tTop, zt0, zt1, 0);
    const coalEnd = zt0 + Math.round(tl * 0.66);
    for (let z = zt0 + 1; z <= coalEnd; z++)
      for (let x = 1 - ow; x <= ow - 1; x++) {
        const hx = 1 - (x / ow) ** 2, hz = Math.min(1, (z - zt0) / 2, (coalEnd + 1 - z) / 2.5);
        const h = Math.round(Math.max(0, r * 0.55 * hx * hz));
        B(x, x, tTop, tTop + h, z, z, 6);
      }
    v.cyl(0, tTop + 1, Math.round((coalEnd + zt1) / 2) + 1, Math.max(0.8, r * 0.25), 1, 3);    // 水艙蓋
    B(-ow, ow, tfy - 1, tfy, zt1 + 1, zt1 + 1, 2);                                              // 後緩衝樑
  } },

{ n: '噴射客機', lo: 6, hi: 54,
  // v1.257.0 整座重畫（見 開發筆記〈舊版 21 座重畫、偏白的 5 座調色〉）
  // 噴射客機
  // 正面（−z）：圓機身＋上方一排黑色駕駛艙窗，兩側微微上反的灰色長翼、翼下兩具藍色發動機（黑色進氣口），翼尖紅色小翼上翹，
  //       中央一片高高的藍色垂直尾翼，機身靠三組起落架站在地上
  // 側面：細長機身，機鼻圓鈍略往下收、機尾往上翹收成尾錐；上白、一排客艙窗、窗下藍色色帶、機腹灰；
  //       主翼後掠、發動機凸出翼前緣；尾翼大幅後掠、上面有紅圈金心的航空標誌；水平尾翼在尾錐兩側
  // 三樣識別物：後掠主翼＋翼下兩具發動機、藍色垂直尾翼上的航空標誌、白機身上的客艙窗列與藍色色帶
  // 部件：機身(機鼻、等徑段、上翹尾錐) 駕駛艙窗 客艙窗列 色帶 機腹灰 機翼整流罩 APU 排氣口｜
  //       主翼(後掠、上反、襟翼後緣) 翼尖小翼 發動機(吊艙、進氣口、唇口、尾噴) ｜
  //       垂直尾翼(標誌) 水平尾翼｜鼻輪 主輪(支柱、輪胎)
  pal: [0xe6eaee,   // 0 機身白
        0xaeb6bf,   // 1 淺灰：機翼、水平尾翼、機腹、進氣口唇口
        0x1f4f8f,   // 2 塗裝深藍：色帶、垂直尾翼、發動機吊艙
        0xd5402f,   // 3 紅：尾翼標誌、翼尖小翼
        0x252b33,   // 4 深色：駕駛艙窗、客艙窗、進氣口、輪胎
        0x737c86,   // 5 中灰：起落架支柱、襟翼、整流罩、尾噴、APU
        0xf0b52f],  // 6 金：標誌中心
  gen(v, s) {
    const fr = Math.max(1.6, s * 0.14);                     // 機身半徑：整架的錨
    const fb = Math.floor(fr + 0.35);
    const gh = Math.max(2, Math.round(fr * 1.0));           // 機腹離地（起落架高）
    const cy = gh + fb;                                     // 機身中心線
    const L = Math.max(14, Math.round(fr * 13));            // 機身長
    const zN = -Math.round(L * 0.5), zT = zN + L - 1;
    const nl = Math.max(3, Math.round(fr * 1.7));           // 機鼻段
    const tlen = Math.max(4, Math.round(fr * 3.2));         // 尾錐段
    /* 每一個 z 切片的半徑與中心高：機鼻是弧形收尖、中心往下沉；尾錐上緣幾乎拉平、下緣往上翹 */
    const prof = z => {
      const k = z - zN, q = zT - z;
      if (k < nl) { const t = (k + 0.6) / nl, rr = fr * Math.sqrt(Math.max(0.05, 1 - (1 - t) ** 2)); return [rr, cy - (fr - rr) * 0.4]; }
      if (q < tlen) { const t = (q + 0.5) / tlen, rr = fr * (0.26 + 0.74 * Math.pow(t, 0.8)); return [rr, cy + (fr - rr) * 0.88]; }
      return [fr, cy];
    };
    const sh = 1.5;
    const zW = zN + Math.round(L * 0.37);                   // 主翼翼根前緣
    const c0 = Math.max(4, fr * 2.7);                       // 翼根弦長
    const wy0 = cy - Math.max(1, Math.round(fr * 0.55));    // 翼根高度（下單翼）
    const ck0 = Math.round(nl * 0.45), ck1 = nl;            // 駕駛艙窗的 z 範圍（從機鼻算）
    const textZ0 = zN + nl + 3, textZ1 = zN + nl + 3 + Math.round(L * 0.18);
    const dw = Math.max(1, fr * 0.22), doorF = zN + nl + 1, doorR = zT - Math.round(tlen * 0.62);

    // ── 機身：一片一片切片畫殼，顏色照高度分區
    let prev = prof(zN - 1);
    for (let z = zN; z <= zT; z++) {
      const [rr, yc] = prof(z), nx = prof(z + 1);
      const end = z === zN || z === zT;
      /* 內圈要蓋住隔壁切片的外圈，機鼻／尾錐收得快的地方才不會從正面看到破洞 */
      const inner = end ? -1 : Math.min(rr - sh, prev[0] - 1 - Math.abs(prev[1] - yc), z < zT ? nx[0] - 1 - Math.abs(nx[1] - yc) : rr);
      prev = [rr, yc];
      const ycR = Math.round(yc), n = Math.ceil(rr + 0.35);
      const winRow = ycR + Math.max(1, Math.round(rr * 0.3));
      const bandHi = winRow - 1, bandLo = winRow - Math.max(1, Math.round(rr * 0.4));
      const k = z - zN, q = zT - z;
      const cabin = k >= nl + 1 && q >= Math.round(tlen * 0.55);
      const door = rr >= 2.5 && (Math.abs(z - doorF) < dw || Math.abs(z - doorR) < dw);
      const belly = z >= zW - 1 && z <= zW + Math.round(c0);
      for (let y = Math.ceil(yc - rr - 0.35); y <= Math.floor(yc + rr + 0.35); y++)
        for (let x = -n; x <= n; x++) {
          const d = Math.hypot(x, y - yc);
          if (d > rr + 0.35 || d < inner) continue;
          let c = 0;
          const jn = (y - yc) / rr;
          if (q < 1) c = 5;                                                    // APU 排氣口
          else if (k >= ck0 && k < ck1 && jn > 0.12 && jn < 0.62 && Math.abs(x) <= rr * 0.9) c = 4;   // 駕駛艙窗
          else if (door && y >= bandLo - 1 && y <= winRow + 1 && Math.abs(x) > rr * 0.6) c = 5;    // 前後登機門
          else if (y === winRow && cabin && Math.abs(x) > rr * 0.4) c = (z & 1) ? 4 : 0;           // 客艙窗
          else if (y <= bandHi && y >= bandLo && k >= Math.round(nl * 0.6)) c = 2;                 // 藍色帶
          else if (y < bandLo && jn < -0.3) c = belly && jn < -0.6 ? 5 : 1;                       // 機腹灰／翼身整流罩
          else if (y === winRow + 1 && rr >= 3 && z >= textZ0 && z <= textZ1 && (z - textZ0) % 4 !== 3 && Math.abs(x) > rr * 0.6) c = 2;  // 機身上的航空公司字樣
          v.set(x, y, z, c);
        }
    }

    // ── 主翼：後掠、上反、往外收窄；翼根埋進機身，後緣一排襟翼
    const xw0 = Math.max(1, Math.floor(fr * 0.8) - 1);     // 翼根從機身殼裡面起
    const b = Math.max(5, Math.round(fr * 5.2));            // 半翼展（機身外）
    const xr = Math.max(1, Math.round(fr * 0.85));
    const c1 = Math.max(1.5, c0 * 0.3), sweep = b * 0.52, dih = b * 0.09;
    const wing = i => { const t = Math.max(0, (i - xr) / b); return { t, le: zW + t * sweep, ch: c0 + (c1 - c0) * t, y: wy0 + Math.round(t * dih) }; };
    for (let i = xw0; i <= xr + b; i++) {
      const w = wing(i), zs = Math.round(w.le), ze = Math.max(zs, Math.round(w.le + w.ch) - 1);
      for (const sx of [-1, 1])
        for (let z = zs; z <= ze; z++) {
          v.set(sx * i, w.y, z, z === ze && w.t > 0.1 && ze - zs >= 2 ? 5 : 1);
          if (w.t < 0.3 && z < ze) v.set(sx * i, w.y - 1, z, 1);              // 內段翼比較厚
        }
    }
    // ── 翼尖小翼（紅）
    const tip = wing(xr + b), wlh = Math.max(2, Math.round(fr * 0.9));
    for (let j = 1; j <= wlh; j++) {
      const zs = Math.round(tip.le + j * 0.6), ze = zs + Math.max(0, Math.round(tip.ch * (1 - j / wlh * 0.5)) - 1);
      for (const sx of [-1, 1]) for (let z = zs; z <= ze; z++) v.set(sx * (xr + b), tip.y + j, z, 3);
    }

    // ── 發動機：吊在翼下 1/3 翼展處，凸出前緣；藍色吊艙、銀色唇口、黑色進氣口、灰色尾噴
    const ie = xr + Math.max(2, Math.round(b * 0.33)), we = wing(ie);
    const re = Math.max(1, fr * 0.5), rn = Math.floor(re + 0.35);
    const ye = we.y - 1 - rn, le = Math.max(3, Math.round(fr * 2.1));
    const ze0 = Math.round(we.le - le * 0.5);
    for (const sx of [-1, 1]) {
      const ex = sx * ie;
      tubeZ(v, ex, ye, ze0, re, le, 2);
      for (let j = -rn; j <= rn; j++) for (let i = -rn; i <= rn; i++) {
        const d = Math.hypot(i, j);
        if (d > re + 0.35) continue;
        v.set(ex + i, ye + j, ze0, d < re - 0.5 ? 4 : 1);                    // 進氣口
      }
      tubeZ(v, ex, ye, ze0 + le, Math.max(0.6, re * 0.6), 1, 5);            // 尾噴
      for (let z = ze0 + 1; z < ze0 + le; z++)                                // 吊架
        if (z >= Math.round(we.le) - 1) v.set(ex, ye + rn + 1, z, 5);
    }

    // ── 水平尾翼：尾錐兩側、後掠
    const zH = zT - Math.round(tlen * 0.78), ph = prof(zH);
    const hb = Math.max(3, Math.round(fr * 2.5)), hc0 = Math.max(3, fr * 1.6), hc1 = hc0 * 0.45;
    const hy = Math.round(ph[1]);
    for (let i = 0; i <= Math.round(ph[0]) + hb; i++) {
      const t = Math.max(0, (i - ph[0]) / hb);
      const zs = Math.round(zH + t * hb * 0.6), ze = Math.max(zs, Math.round(zH + t * hb * 0.6 + hc0 + (hc1 - hc0) * t) - 1);
      for (const sx of [-1, 1]) for (let z = zs; z <= ze; z++) v.set(sx * i, hy + Math.round(t * 1.2), z, 1);
    }

    // ── 垂直尾翼（藍）＋航空標誌（紅圈金心）
    const fh = Math.max(4, Math.round(fr * 2.6)), fc0 = Math.max(4, fr * 2.7), fc1 = fc0 * 0.42;
    const zf0 = zT - Math.round(fc0) - Math.max(0, Math.round(fr * 0.3)), fsw = fh * 0.85;
    const fy0 = Math.round(cy + fr * 0.4), fyTop = Math.round(cy + fr) + fh;
    for (let y = fy0; y <= fyTop; y++) {
      const t = Math.max(0, (y - (fyTop - fh)) / fh);
      const zs = Math.round(zf0 + t * fsw), ze = Math.max(zs, Math.round(zf0 + t * fsw + fc0 + (fc1 - fc0) * t) - 1);
      for (let z = zs; z <= ze; z++) v.set(0, y, z, 2);
    }
    {
      const ly = Math.round(fyTop - fh * 0.45), lz = Math.round(zf0 + fsw * 0.55 + fc0 * 0.42);
      const lr = Math.max(1.2, fh * 0.26);
      for (let j = -Math.ceil(lr); j <= Math.ceil(lr); j++) for (let k = -Math.ceil(lr); k <= Math.ceil(lr); k++) {
        const d = Math.hypot(j, k);
        if (d > lr + 0.3) continue;
        tint(v, 0, ly + j, lz + k, d < lr * 0.45 ? 6 : 3);
      }
    }

    // ── 起落架：鼻輪一組、主輪兩組，支柱接到機身底／翼根底
    const th = Math.max(2, Math.round(fr * 0.45));                       // 輪胎高
    const zng = zN + Math.round(nl * 1.15), png = prof(zng);
    const nb = Math.ceil(png[1] - png[0] - 0.35);                         // 那一片機身最低的一格
    for (let y = 1; y < nb; y++) v.set(0, y, zng, 5);
    for (const sx of [-1, 1]) for (let y = 0; y < th; y++) for (let z = zng; z < zng + th; z++) v.set(sx, y, z, 4);
    const xm = Math.max(2, Math.round(fr * 1.0)), zm = zW + Math.round(c0 * 0.62);
    for (const sx of [-1, 1]) {
      for (let y = th; y <= wy0 - 2; y++) v.set(sx * xm, y, zm, 5);
      for (let x = xm - 1; x <= xm + 1; x++) for (let y = 0; y < th; y++) for (let z = zm - 1; z < zm - 1 + th; z++) v.set(sx * x, y, z, 4);
      v.set(sx * xm, th - 1, zm, 5);
    }
  } },

{ n: '大帆船', lo: 6, hi: 41,
  // v1.257.0 整座重畫（見 開發筆記〈舊版 21 座重畫、偏白的 5 座調色〉）
  // 大帆船
  // 正面（−z）：尖船首往前伸出斜桅與船首像，三根桅杆的方帆一層層往上收窄，帆往前鼓；船殼窄底寬腰
  // 側面：船首樓略高、腰部低、船尾樓兩階高高翹起；吃水線以下紅色船底，深木色船殼上一條淺色炮門帶、一排黑炮門；
  //       前桅主桅各三面方帆（主桅最高），後桅一面三角縱帆＋小頂帆；桅頂紅色長旗、船尾一面紅金紅國旗；
  //       整艘坐在船台的龍骨墩上、兩側斜撐木頂著（底物：在船台上，船底的紅色才看得到）
  // 三樣識別物：三桅多層鼓起的米白方帆（主帆上紅色十字）、高聳的船尾樓與金框船尾窗、紅色船底＋一排炮門
  // 部件：龍骨墩 斜撐｜船殼(尖船首、V 型船底、內傾舷側) 紅船底 炮門帶 炮門 甲板 船首樓 後甲板 艉樓 舷牆 金色欄杆｜
  //       船尾窗(金框) 船尾燈 舵 船首像 船首平台｜桅杆 戰鬥台 橫桁 方帆(陰影色階、紅十字) 三角縱帆 斜桅帆｜
  //       側支索 前支索 斜桅｜桅頂長旗 船尾國旗
  pal: [0x5a3920,   // 0 深木：船殼、桅杆、橫桁、斜撐
        0xb08452,   // 1 淺木：甲板、炮門帶、龍骨墩
        0xe9ddbb,   // 2 帆布
        0xc2ae84,   // 3 帆布陰影
        0x9a2a22,   // 4 紅：船底、長旗、帆上的十字
        0xd8aa3c,   // 5 金：欄杆、船尾窗框、船首像、船尾燈
        0x1e1b19],  // 6 黑：炮門、船尾窗、索具
  gen(v, s) {
    const B = (x0, x1, y0, y1, z0, z1, c) => {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) v.set(x, y, z, c);
    };
    const L = Math.max(16, Math.round(s * 1.9));             // 船殼長：整艘的錨
    const W = Math.max(2.6, L * 0.135);                      // 半船寬
    const D = Math.max(5, L * 0.2);                          // 龍骨到主甲板
    const kh = Math.max(1, Math.round(L * 0.035));           // 龍骨墩高
    const ky = kh, dk = ky + Math.round(D), wl = ky + Math.round(D * 0.36);
    const zB = -Math.round(L / 2), zS = zB + L - 1;
    const fcH = Math.max(1, Math.round(D * 0.28)), qdH = Math.max(1, Math.round(D * 0.3)), pH = Math.max(1, Math.round(D * 0.24));
    const T = z => (z - zB) / (L - 1);
    const wz = z => {
      const t = T(z);
      return W * (t < 0.3 ? Math.sqrt(Math.max(0, 1 - ((0.3 - t) / 0.3) ** 2)) : t > 0.8 ? 1 - 0.3 * ((t - 0.8) / 0.2) ** 1.5 : 1);
    };
    const kz = z => { const t = T(z); return ky + (t < 0.2 ? Math.round(((0.2 - t) / 0.2) ** 2 * D * 0.6) : 0); };
    const deckOf = z => { const t = T(z); return dk + (t < 0.16 ? fcH : 0) + (t > 0.62 ? qdH : 0) + (t > 0.82 ? pH : 0); };
    /* 某一片某一層的船殼半寬；不在船殼範圍回 -1（拿來當「隔壁沒有東西」的判斷） */
    const hwAt = (z, y) => {
      if (z < zB || z > zS) return -1;
      const k0 = kz(z);
      if (y < k0 || y > deckOf(z) + 1) return -1;
      const w = wz(z);
      if (y <= dk) return w * (0.32 + 0.68 * Math.sqrt((y - k0) / Math.max(1, dk - k0)));
      return w * (1 - 0.045 * (y - dk));                       // 甲板以上微微內傾
    };
    const bandHi = dk - 1, bandLo = dk - Math.max(1, Math.round(D * 0.2));

    // ── 船殼：一片一片畫外殼；內圈要蓋住上一層與前後片的外圈，船首收尖、樓梯狀的艙壁才不會破洞
    for (let z = zB; z <= zS; z++) {
      const top = deckOf(z) + 1, dTop = top - 1, t = T(z);
      for (let y = kz(z); y <= top; y++) {
        const hw = hwAt(z, y);
        const inner = Math.min(hw - 1.2, hwAt(z, y - 1) - 1, hwAt(z - 1, y) - 1, hwAt(z + 1, y) - 1);
        const n = Math.floor(hw + 0.3);
        for (let x = -n; x <= n; x++) {
          const ax = Math.abs(x), wall = ax >= inner;
          if (!wall && y !== dTop) continue;
          let c = 0;
          if (!wall || (y === dTop && ax < hw - 0.5 && hwAt(z, y + 1) >= 0)) c = 1;            // 甲板
          else if (y < wl) c = 4;                                                              // 吃水線下紅船底
          else if (y >= bandLo && y <= bandHi && t > 0.06 && t < 0.97) c = 1;                  // 炮門帶
          else if (y === top && t > 0.62) c = 5;                                               // 船尾樓金欄杆
          v.set(x, y, z, c);
        }
      }
    }
    // ── 炮門：炮門帶上一排黑方格
    const gsp = Math.max(3, Math.round(L * 0.075)), gw = Math.max(1, Math.round(L * 0.02));
    const pr0 = bandLo + ((bandHi - bandLo) >= 2 ? 1 : 0);
    for (let z = zB + Math.round(L * 0.2); z <= zB + Math.round(L * 0.8); z += gsp)
      for (let y = pr0; y <= bandHi; y++) for (let k = 0; k < gw; k++)
        for (const sx of [-1, 1]) paintFrom(v, 0, y, z + k, sx, 0, 0, Math.ceil(W) + 2, 6);
    // 船尾樓側面的小窗
    for (let z = zB + Math.round(L * 0.68); z <= zS - 2; z += 2)
      for (const sx of [-1, 1]) paintFrom(v, 0, dk + qdH - 1, z, sx, 0, 0, Math.ceil(W) + 2, 6);

    // ── 船尾：金框船尾窗、舵、船尾燈
    const sTop = deckOf(zS) + 1;
    for (let y = dk + 1; y < sTop; y++) {
      const hw = hwAt(zS, y);
      for (let x = -Math.floor(hw - 0.7); x <= Math.floor(hw - 0.7); x++)
        tint(v, x, y, zS, (y - dk) % 3 === 0 ? 5 : (x & 1) ? 5 : 6);
    }
    for (let y = wl; y <= dk; y++) tint(v, 0, y, zS, 5);                                      // 船尾中線金飾
    B(0, 0, kz(zS), dk, zS + 1, zS + 1, 0);                                                   // 舵
    const lant = (x, h) => { B(x, x, sTop + 1, sTop + h, zS, zS, 5); v.set(x, sTop + h + 1, zS, 6); };
    lant(0, Math.max(2, Math.round(D * 0.22)));
    const lx = Math.max(1, Math.floor(hwAt(zS, sTop) - 0.7));
    lant(lx, Math.max(1, Math.round(D * 0.14))); lant(-lx, Math.max(1, Math.round(D * 0.14)));

    // ── 船首平台＋船首像＋斜桅＋斜桅帆
    const bk = Math.max(2, Math.round(L * 0.06)), by0 = dk - 1;
    B(0, 0, by0, by0, zB - bk, zB, 0);
    B(-1, 1, by0, by0, zB - bk + 1, zB - 1, 0);
    B(0, 0, by0 - Math.max(1, Math.round(D * 0.18)), by0 - 1, zB - bk, zB - bk, 5);            // 船首像
    v.set(0, by0 + 1, zB - bk, 5);
    const bsL = Math.max(4, Math.round(L * 0.3)), bs0 = dk + fcH;
    const bsTip = [0, bs0 + Math.round(bsL * 0.42), zB - bsL];
    limb(v, { x: 0, y: bs0, z: zB + 2, x1: bsTip[0], y1: bsTip[1], z1: bsTip[2], r: Math.max(0.5, L * 0.012), c: 0 });
    {
      const f = 0.55, pz = Math.round(zB + 2 + (bsTip[2] - zB - 2) * f), py = Math.round(bs0 + (bsTip[1] - bs0) * f);
      const hw = Math.max(1, Math.round(W * 0.5)), sh = Math.max(2, Math.round(D * 0.4));
      B(-hw - 1, hw + 1, py - 1, py - 1, pz, pz, 0);
      for (let y = py - 1 - sh; y <= py - 2; y++)
        for (let x = -hw; x <= hw; x++) v.set(x, y, pz, y < py - 1 - sh * 0.4 ? 3 : 2);
    }

    // ── 桅杆、戰鬥台、方帆、側支索、桅頂長旗
    const mr = Math.max(0.5, L * 0.011);
    const masts = [{ t: 0.25, h: 0.55 }, { t: 0.48, h: 0.64 }, { t: 0.74, h: 0.44 }];
    /* 方帆＋橫桁整組繞桅杆轉 BR 度（轉帆迎風）：正對 −z 的帆從正側面只看得到一條線。
       直接算轉過去的座標，不走 stampY——stampY 要另開一份格子再反向掃，9000 那檔產生時間會超過 150ms。
       轉過去之後 x = u·0.91 + (1+鼓深)·0.41：往中間走、鼓深加一格的那一步 x 會跳 1.32，可能整欄跳過
       （9000 那檔正面看得到一條條縫），所以只在那一步多補半格；全部走半格的話多出兩成的 set。 */
    const BR = 24 * Math.PI / 180, ca = Math.cos(BR), sa = Math.sin(BR);
    const sail = (mz, y0, y1, halfW, cross) => {               // y1 是最上面那一排，橫桁在 y1+1
      const put = (u, y, rz, c) => v.set(Math.round(u * ca - rz * sa), y, Math.round(mz + u * sa + rz * ca), c);
      const sh = y1 - y0 + 1, n = Math.round(halfW), bm = Math.max(1, Math.round(halfW * 0.22));
      for (let u = -n - 1; u <= n + 1; u++) put(u, y1 + 1, -1, 0);                  // 橫桁
      for (let y = y0; y <= y1; y++) {
        const kk = y1 - y, fy = Math.sin(Math.PI * (kk + 0.6) / (sh + 0.6));
        const dzOf = u => Math.round(bm * (1 - (u / (n + 1)) ** 2) * fy);
        const colOf = u => {
          let c = kk >= sh * 0.62 || Math.abs(u) > n - 0.75 ? 3 : 2;  // 下半與兩側是陰影
          if (cross) {                                         // 主帆上的紅色斜十字
            const q = u / n, w2 = (kk / Math.max(1, sh - 1)) * 2 - 1;
            if (Math.abs(q - w2) < 1.4 / n + 0.12 || Math.abs(q + w2) < 1.4 / n + 0.12) c = 4;
          }
          return c;
        };
        let dz = dzOf(-n);
        for (let u = -n; u <= n; u++) {
          put(u, y, -1 - dz, colOf(u));
          if (u < n) {
            const nd = dzOf(u + 1);
            if (nd > dz) put(u + 0.5, y, -1 - dzOf(u + 0.5), colOf(u + 0.5));
            dz = nd;
          }
        }
      }
    };
    masts.forEach((m, mi) => {
      const mz = Math.round(zB + m.t * (L - 1)), mh = Math.round(L * m.h), topY = dk + mh;
      v.cyl(0, dk - 1, mz, mr, mh + 2, 0);
      const lowTop = dk + Math.round(mh * 0.44);
      const pw = Math.max(1, Math.round(mr + 1));
      B(-pw, pw, lowTop, lowTop, mz - pw, mz + pw, 0);          // 戰鬥台
      const sw = W * (mi === 2 ? 1.1 : 1.5);
      const rows = mi === 2 ? [[0.6, 0.86, 0.7]] : [[0.12, 0.4, 1], [0.47, 0.7, 0.82], [0.75, 0.9, 0.6]];
      rows.forEach(([a, b2, f], ri) =>
        sail(mz, dk + Math.round(mh * a), dk + Math.round(mh * b2) - 1, Math.max(1.5, sw * f), mi === 1 && ri === 0));
      // 側支索：舷牆到戰鬥台，每邊三條
      const dTop = deckOf(mz), rx = Math.max(1, Math.floor(hwAt(mz, dTop + 1) + 0.3));
      for (const sx of [-1, 1]) for (const dz of [0, 1, 2])
        v.line(sx * rx, dTop + 1, mz + dz * Math.max(1, Math.round(L * 0.02)), sx * pw, lowTop, mz, 6);
      // 桅頂長旗：往船尾飄
      const pl = Math.max(2, Math.round(L * (mi === 1 ? 0.12 : 0.08))), ph = Math.max(1, Math.round(L * 0.035));
      for (let k = 1; k <= pl; k++) {
        const rws = Math.max(1, Math.round(ph * (1 - (k - 1) / pl * 0.6)));
        B(0, 0, topY - rws + 1, topY, mz + k, mz + k, 4);
      }
      m.mz = mz; m.topY = topY; m.mh = mh;
    });
    // 後桅三角縱帆：斜橫桁前低後高，帆掛在下面
    {
      const m = masts[2], base = deckOf(m.mz) + 2;
      const aZ = m.mz - Math.round(L * 0.1), bZ = m.mz + Math.round(L * 0.12);
      const aY = base + 1, bY = dk + Math.round(m.mh * 0.56);
      for (let z = aZ + 1; z <= bZ; z++) {
        const yy = Math.round(aY + (bY - aY) * (z - aZ) / (bZ - aZ));
        for (let y = base; y < yy; y++) v.set(0, y, z, y < base + (yy - base) * 0.4 ? 3 : 2);
      }
      v.line(0, aY, aZ, 0, bY, bZ, 0);
    }
    // 前支索：前桅頂到斜桅尖
    v.line(0, masts[0].topY - 1, masts[0].mz, bsTip[0], bsTip[1], bsTip[2], 6);
    // 船尾國旗：紅金紅
    {
      const fs = Math.max(4, Math.round(D * 0.7)), fh = Math.max(3, Math.round(D * 0.3)), fl = Math.max(3, Math.round(D * 0.45));
      const fz = zS - 2;
      B(0, 0, sTop, sTop + fs, fz, fz, 0);
      for (let k = 1; k <= fl; k++) for (let j = 0; j < fh; j++) {
        const y = sTop + fs - j, band = j / fh;
        v.set(0, y, fz + k, band > 0.3 && band < 0.7 ? 5 : 4);
      }
    }

    // ── 船台：龍骨墩＋兩側斜撐（底物）
    const nk = Math.max(3, Math.round(L / 8));
    rowOf(v, nk, (L * 0.6) / (nk - 1), (vv, z) => B(-1, 1, 0, ky - 1, Math.round(z), Math.round(z) + 1, 1), zB + L * 0.55);
    for (const t of [0.32, 0.55, 0.78]) {
      const z = Math.round(zB + t * (L - 1)), ys = ky + Math.round(D * 0.38);
      const hx = Math.floor(hwAt(z, ys) + 0.3);
      for (const sx of [-1, 1]) v.line(sx * (hx + Math.round(D * 0.45)), 0, z, sx * hx, ys, z, 1);
    }
  } },

{ n: '雙層巴士', lo: 6, hi: 57,
  // v1.257.0 整座重畫（見 開發筆記〈舊版 21 座重畫、偏白的 5 座調色〉）
  // 雙層巴士
  // 正面（−z）：倫敦紅的高瘦方盒，上層兩片前窗，兩層之間一塊黑底白字目的地看板＋奶油色腰線，
  //       下層右邊（駕駛座在右）一片擋風窗，最下面往前凸出的引擎蓋：灰色直條水箱罩、兩側擋泥板上的白色大燈、黑保險桿
  // 側面：長方盒，上下兩條深色窗帶（紅色窗柱隔開），中間一條奶油色腰線；黑輪胎灰輪轂嵌在黑色輪拱裡，
  //       車尾左側是開放式上車平台（灰色扶桿、平台地板、往上爬的樓梯）
  // 三樣識別物：上下兩層窗帶＋奶油色腰線、車尾左側的開放式上車平台與樓梯、車頭凸出的水箱罩＋目的地看板
  // 部件：車身(底緣深紅線) 車頂(內縮一圈的圓角) 車頂通風口｜下層窗帶 上層窗帶 窗柱 駕駛室側窗 前窗 擋風窗 後窗｜
  //       奶油色腰線 目的地看板(黑底白字) 路線號｜引擎蓋 水箱罩 擋泥板 大燈 保險桿 後照鏡｜
  //       輪胎 輪轂 輪拱｜上車平台(地板、扶桿、踏階) 平台隔牆(門) 樓梯 平台天花板
  pal: [0xb8262b,   // 0 倫敦紅
        0xe6d8a8,   // 1 奶油：腰線
        0x2b3946,   // 2 車窗
        0x18191c,   // 3 黑：輪胎、輪拱、目的地看板、保險桿
        0x9aa2aa,   // 4 灰：輪轂、水箱罩、扶桿、平台地板、後照鏡
        0xf3f1e8,   // 5 白：看板上的字、大燈
        0x7a1a1e],  // 6 深紅：車頂、底緣、平台隔牆、樓梯
  gen(v, s) {
    const B = (x0, x1, y0, y1, z0, z1, c) => {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) v.set(x, y, z, c);
    };
    const W = dim(s, 0.42, 7, true), hw = (W - 1) / 2;          // 車寬（奇數，車頭中線對稱）
    const Lb = dim(s, 1.45, 21);                                 // 車身長
    const R = Math.max(1.5, s * 0.095), wy = Math.floor(R + 0.35);  // 輪半徑、輪軸高（輪底貼地）
    const lp = dim(s, 0.14, 2), wh = dim(s, 0.17, 2), cb = dim(s, 0.045, 1);
    const yb = wy;                                               // 車身底緣＝輪軸高，輪子上半嵌進車身
    const yl0 = yb + lp, yh1 = yl0 + wh;                         // 下層窗帶、窗上緣那一排
    const yc0 = yh1 + 1, yu0 = yc0 + cb + 1, yt = yu0 + wh;      // 腰線、上層窗帶、牆頂
    const zF = -Math.floor(Lb / 2), zR = zF + Lb - 1;
    const bd = Math.max(1, Math.round(s * 0.06));                // 引擎蓋往前凸
    const pw = Math.max(2, Math.round(W * 0.32)), pd = Math.max(3, Math.round(s * 0.17));   // 上車平台
    const cabL = Math.max(3, Math.round(Lb * 0.15));
    const wp = Math.max(3, Math.round(Lb / 8.5));                // 窗距（含一根窗柱）

    // ── 車身四面牆
    /* 只走四面牆那一圈（掃整個方盒再 continue 的話，9000 那檔產生時間會逼近 150ms） */
    for (let y = yb; y <= yt; y++)
      for (let z = zF; z <= zR; z++) for (let x = -hw; x <= hw; x += (z === zF || z === zR) ? 1 : 2 * hw) {
        let c = 0;
        if (y === yb) c = 6;                                                     // 底緣深紅線
        else if (y >= yc0 && y < yc0 + cb) c = 1;                                // 奶油色腰線
        else if (Math.abs(x) === hw) {                                           // 側面窗帶
          const lower = y >= yl0 && y < yh1, upper = y >= yu0 && y < yt;
          if (upper && z > zF && z < zR - 1 && (z - zF) % wp !== 0) c = 2;
          if (lower && z >= zF + cabL && z < zR - pd && (z - zF - cabL) % wp !== 0) c = 2;
          if (lower && x > 0 && z > zF && z < zF + cabL - 1) c = 2;              // 駕駛室側窗（右邊）
        }
        v.set(x, y, z, c);
      }
    // ── 車頂：內縮一圈當圓角，中間一個通風口
    B(1 - hw, hw - 1, yt + 1, yt + 1, zF + 1, zR - 1, 0);
    B(-1, 1, yt + 2, yt + 2, zF + Math.round(Lb * 0.3), zF + Math.round(Lb * 0.3) + 1, 6);

    // ── 車頭：上層兩片前窗、目的地看板、擋風窗
    for (let y = yu0; y < yt; y++) for (let x = 1 - hw; x <= hw - 1; x++) if (x !== 0) v.set(x, y, zF, 2);
    const dbw = Math.max(1, Math.round(hw * 0.65));
    for (let y = yh1; y <= yc0 + cb; y++) for (let x = -dbw; x <= dbw; x++) {
      const mid = y === yh1 + Math.floor((yc0 + cb - yh1) / 2);
      v.set(x, y, zF, mid && x > -dbw && x < dbw && (x + dbw) % 3 !== 0 ? 5 : 3);   // 黑底白字
    }
    for (let y = yl0; y < yh1; y++) for (let x = 1; x <= hw - 1; x++) v.set(x, y, zF, 2);   // 擋風窗（駕駛在右）
    // 路線號：看板右上方一小格
    if (hw >= 4) { v.set(hw - 1, yu0 - 1, zF, 3); v.set(hw - 1, yh1, zF, 5); }

    // ── 引擎蓋＋水箱罩＋擋泥板＋大燈＋保險桿
    const bw = Math.max(1, Math.round(hw * 0.42)), bTop = yl0 - 1;
    B(-bw, bw, yb, bTop, zF - bd, zF - 1, 0);
    for (let y = yb + 1; y <= bTop; y++) for (let x = 1 - bw; x <= bw - 1; x++) v.set(x, y, zF - bd, (x & 1) ? 3 : 4);
    if (bw === 1) for (let y = yb + 1; y <= bTop; y++) v.set(0, y, zF - bd, 4);
    const wTop = yb + Math.max(1, Math.round(lp * 0.6));
    for (const sx of [-1, 1]) {
      B(sx > 0 ? bw + 1 : -hw, sx > 0 ? hw : -bw - 1, yb, wTop, zF - 1, zF - 1, 0);       // 擋泥板
      v.set(sx * (hw - 1), wTop, zF - 1, 5);                                               // 大燈
      if (hw >= 5) v.set(sx * (hw - 2), wTop, zF - 1, 5);
      v.set(sx * (hw + 1), yh1 - 1, zF + 1, 3);                                            // 後照鏡
      v.set(sx * (hw + 1), yh1, zF + 1, 4);
    }
    B(-hw, hw, yb, yb, zF - bd - (bd > 1 ? 0 : 0), zF - bd, 3);                             // 保險桿
    B(-hw, hw, yb, yb, zF - 1, zF - 1, 3);

    // ── 輪子：黑胎灰轂，外圈一圈黑色輪拱
    const zA = [zF + Math.round(R) + 2, zR - pd - Math.round(R) - 1];
    for (const z of zA) for (const sx of [-1, 1]) {
      const fx = sx * hw, ix = sx * (hw - 1), n = Math.ceil(R) + 1;
      for (let j = -n; j <= n; j++) for (let k = -n; k <= n; k++) {
        const d = Math.hypot(j, k);
        if (d <= R + 0.35) { v.set(ix, wy + j, z + k, 3); v.set(fx, wy + j, z + k, d < R * 0.5 ? 4 : 3); }
        else if (d < R + 1.3 && wy + j >= yb) tint(v, fx, wy + j, z + k, 3);                // 輪拱
      }
    }

    // ── 車尾：上層後窗、下層右側後窗
    for (let y = yu0; y < yt; y++) for (let x = 2 - hw; x <= hw - 2; x++) v.set(x, y, zR, 2);
    for (let y = yl0; y < yh1; y++) for (let x = Math.max(1, -hw + pw + 1); x <= hw - 1; x++) v.set(x, y, zR, 2);

    // ── 開放式上車平台（左後角）：挖開、地板、扶桿、隔牆、樓梯、天花板
    const px1 = -hw + pw - 1, pz0 = zR - pd + 1;
    v.carve((-hw + px1) / 2, yb + 1, (pz0 + zR) / 2, pw, yh1 - yb - 1, pd);
    B(-hw, px1 + 1, yb, yb, pz0, zR, 4);                                                     // 平台地板
    B(-hw, -hw, yb + 1, yh1 - 1, zR, zR, 4);                                                 // 扶桿
    B(1 - hw, hw - 1, yb, yh1, pz0 - 1, pz0 - 1, 6);                                         // 平台隔牆
    v.carve(-hw + Math.max(1, Math.floor(pw / 2)), yb + 1, pz0 - 1, 1, Math.max(2, yh1 - yb - 2), 1);   // 隔牆上的門
    B(-hw, px1 + 1, yh1, yh1, pz0, zR, 6);                                                   // 平台天花板（上層地板）
    const sx0 = px1 + 1, ns = Math.max(2, hw - 1 - sx0);
    for (let i = 0; i <= ns; i++) {                                                          // 樓梯：往右爬
      const top = yb + Math.max(1, Math.round((i + 1) * (yh1 - yb) / (ns + 1)));
      B(sx0 + i, sx0 + i, yb, top - 1, pz0, zR - 1, 6);
      B(sx0 + i, sx0 + i, top, top, pz0, zR - 1, 4);
    }
  } },

/* ── 特殊 ─────────────────────────────────────────────────
   不是建築，就是些看著很想拆掉的東西。 */

{ n: '木魚', lo: 5, hi: 36,
  // v1.257.0 整座重畫（見 開發筆記〈舊版 21 座重畫、偏白的 5 座調色〉）
  // 木魚
  // 正面：扁圓的魚身坐在方形座布團上；腰下一道兩頭收尖的黑橫縫（魚嘴），
  //       縫的上方兩顆浮雕魚頭面對面、中間咬著一顆金寶珠（雙魚戲珠）
  // 側面：魚身比坐墊窄一圈、底比頂扁；魚嘴的縫一路繞到兩側；兩條魚身（鱗紋帶）從前上方的魚頭往後繞到背後；
  //       木槌斜斜擱在布團前緣：球頭在右前角、柄往左前方躺著
  // 三樣識別物：深紅褐漆的圓胖木身（帶木紋）、正面那道黑色魚嘴橫縫、雙魚戲珠浮雕＋鱗紋
  // 部件：座布團(超橢圓) 布團滾邊 四角流蘇(blob＋limb) 魚身(殼，一邊蓋一邊挑色) 木紋
  //       魚身鱗紋帶(亮底＋深色 U 形鱗＋上下刻線) 魚嘴橫縫(挖) 口緣 縫口切面與肚裡(深)
  //       浮雕魚頭(limb) 魚眼(paintFrom) 鰓線(paintFrom) 寶珠(blob) 木槌柄(limb) 槌頭(blob)
  // 底物的理由：木魚本來就擺在座布團上（不墊的話敲起來會滑、聲音也悶）。
  // e2e 的小工地：1800 塊時 60 個小人圍著它慶祝，佔地半徑不比舊版大
  // （量過：1800 塊 半徑 12.3／舊版 12.6，3000 塊 13.7／舊版 15.4）。
  // 試過沒留下的：背後翹一片尾鰭（俯視像蘋果梗）、四角流蘇斜拉到地上（像蜘蛛腳）、
  // 木槌球頭靠在魚身側面（像一根插在旁邊的棍子）、橫向木紋（跟殼的台階疊成一圈圈，像蜂窩）。
  pal: [0x74261a,   // 0 漆身主色：深紅褐
        0x42140c,   // 1 深一階：鱗紋、魚身邊線、鰓線、口緣
        0x9a4429,   // 2 亮一階：木紋、浮雕魚頭與鱗紋帶（凸起處先被磨亮）
        0x1d0e09,   // 3 魚嘴深縫與木魚肚裡（從縫看進去是黑的）
        0xa81f26,   // 4 座布團紅
        0xd9a032,   // 5 金：布團滾邊、四角流蘇、寶珠、魚眼
        0xd2ab78],  // 6 木槌（原木柄、布包的球頭）
  gen(v, s) {
    const R = s * 0.5;                                     // 魚身半徑：整座唯一的錨
    /* ── 座布團：圓角方形（超橢圓），外緣低一格看起來是鼓的；最外一圈頂上壓金色滾邊 ── */
    const W = R * 1.06, ct = Math.max(2, Math.round(R * 0.26));
    const P = 3.5, nW = Math.ceil(W), pw = [];
    for (let x = 0; x <= nW; x++) pw.push(Math.pow(x / W, P));
    for (let x = -nW; x <= nW; x++) for (let z = -nW; z <= nW; z++) {
      const q = Math.pow(pw[Math.abs(x)] + pw[Math.abs(z)], 1 / P);
      if (q > 1) continue;
      const h = q > 0.86 ? ct - 1 : ct;
      const rim = q > 1 - 1.25 / W;
      for (let y = 0; y < Math.max(1, h); y++) v.set(x, y, z, rim && y === h - 1 ? 5 : 4);
    }
    // 四角的金流蘇：角上一顆結，底下一撮垂到地上
    const cq = W * 0.80, tr = Math.max(0.7, R * 0.08);
    corners4(v, cq, cq, (vv, x, z) => {
      blob(vv, x, ct - 1, z, tr * 1.2, tr * 1.2, tr * 1.2, 5);
      limb(vv, { x: x * 1.03, y: ct - 1, z: z * 1.03, x1: x * 1.05, y1: 0, z1: z * 1.05, r: tr * 0.8, r1: tr, c: 5 });
    });

    /* ── 魚身：扁圓的殼（底比頂扁），一邊蓋一邊挑色——蓋完再掃一遍的話，fitScale 每試一個 s 就多一趟 ──
       最外一層：木紋（亮一階的斜帶子、帶一點波動）；兩條魚身是一圈從前上方的魚頭往後繞的帶子，
       帶子亮一階、上面是深一階的 U 形鱗紋、上下緣各一條深色刻線。
       殼的內層塗黑：只有從魚嘴那道縫看得進去，看起來是挖空的肚子。 */
    const rx = R, rz = R * 0.95, ryt = R * 0.84, ryb = R * 0.72;
    const yb = ct - 1, cy = yb + Math.floor(ryb * 1.02);    // 魚身底壓進布團一格（整數，才不會空一層）
    const t = Math.max(1.4, R * 0.16), inn = 1 - t / ryb;
    const outer = 1 - 1.1 / ryb, inner2 = inn + 1.1 / ryb;
    const js = -R * 0.1, hs = Math.max(1, R * 0.11), thM = 1.3;    // 魚嘴：高度、半高、兩端角度
    const gp = Math.max(2.6, R * 0.3), sp = Math.max(3, R * 0.36);  // 木紋間距、鱗片大小
    const thH = 0.45, eH = 0.42, bw = 0.27, eb = 1.15 / R;         // 魚頭的方位與高度、魚身帶半寬、邊線寬
    const nx = Math.ceil(rx), nt = Math.ceil(ryt), nb = Math.ceil(ryb), in2 = inn > 0 ? inn * inn : 0;
    for (let j = -nb; j <= nt; j++) {
      if (cy + j < 0) continue;
      const ry = j < 0 ? ryb : ryt, e = j / ry, jy2 = e * e;
      for (let i = -nx; i <= nx; i++) {
        const a2 = (i / rx) * (i / rx) + jy2;
        if (a2 > 1.0404) continue;
        /* 只掃殼：這一根 (i, j) 上 |k| 在 [km, kx] 之間的才是殼，中間那段空心不必逐格算 */
        const kx = Math.floor(rz * Math.sqrt(1.0404 - a2));
        const km = a2 < in2 ? Math.ceil(rz * Math.sqrt(in2 - a2) - 1e-9) : 0;
        for (let k = -kx; k <= kx; k++) {
          if (k > -km && k < km) { k = km - 1; continue; }
          const d = Math.sqrt(a2 + (k / rz) * (k / rz));
          if (d > 1.02 || d < inn) continue;
          const at = Math.abs(Math.atan2(i, -k));            // 0 ＝ 正面（−z）
          let gap = 99;
          if (at < thM) {                                    // 兩頭收尖的橫縫
            const half = hs * Math.pow(Math.cos(at / thM * Math.PI / 2), 0.6);
            gap = Math.abs(j - js) - half;
            if (gap <= 0) continue;
          }
          let c = 0;
          if (d < inner2 || (gap < 1 && d < outer)) c = 3;  // 肚裡、縫口的切面
          else if (d >= outer) {
            const ec = eH - 0.1 * (at - thH), de = Math.abs(e - ec);
            if (gap < 1) c = 1;                              // 口緣
            else if (at > thH && de < bw) {                  // 魚身帶
              if (de > bw - eb) c = 1;                       // 上下緣：深色刻線
              else {
                const u = at * R, w = (e - ec + bw) * ry, row = Math.floor(w / sp);
                const lu = ((u + (row & 1) * sp / 2) % sp) - sp / 2, lw = w - row * sp;
                const q = Math.sqrt(lu * lu + (lw - sp) * (lw - sp));
                c = Math.abs(q - sp * 0.6) < 0.5 ? 1 : 2;    // 鱗紋：一片一片往下的 U（帶子本身亮一階）
              }
            }
            if (c === 0 && !(at > thH && de < bw)) {
              const g = (j * 0.75 + i * 0.45 + 1.3 * Math.sin(k * 0.33 + j * 0.21)) / gp;
              if (g - Math.floor(g) < 0.17) c = 2;           // 木紋：斜的、帶波動（橫的會跟殼的台階疊成一圈圈）
            }
          }
          v.set(i, cy + j, k, c);
        }
      }
    }

    /* ── 雙魚戲珠：前上方兩顆浮雕魚頭（左右對稱、面向中線），中間一顆金寶珠 ── */
    /* 魚頭是浮雕：亮一階（漆面上凸起的地方先被磨亮），往中線拉長、嘴尖咬著寶珠。 */
    const cl = Math.sqrt(1 - eH * eH), hy = cy + ryt * eH;
    const fh = Math.max(1.2, R * 0.2), pr = Math.max(1, R * 0.16);
    mirrorX(v, 1, (vv, sg) => {
      const x = sg * R * Math.sin(thH) * cl, z = -rz * Math.cos(thH) * cl;
      limb(vv, { x, y: hy, z, x1: sg * pr * 0.9, y1: hy - fh * 0.15, z1: -rz * cl * 0.98,
                 r: fh, r1: fh * 0.55, c: 2 });                                  // 魚頭：後粗前尖
      const n = Math.ceil(fh) + 4;
      paintFrom(vv, Math.round(x), Math.round(hy + fh * 0.35), Math.round(z * 0.8), 0, 0, -1, n, 5);  // 魚眼
      paintFrom(vv, Math.round(x + sg * fh * 0.5), Math.round(hy - fh * 0.1), Math.round(z * 0.8),
                0, 0, -1, n, 1);                                                  // 鰓線
    });
    blob(v, 0, Math.round(hy + fh * 0.05), -rz * cl, pr, pr, pr, 5);               // 寶珠

    /* ── 木槌：斜斜擱在布團前緣——球頭在右前角，柄往左前方躺在布團上 ── */
    const mb = Math.max(1.4, R * 0.22), hr = Math.max(0.5, R * 0.065);
    const bxp = W * 0.55, byp = ct - 1 + Math.floor(mb * 1.02), bzp = -W * 0.7;
    limb(v, { x: bxp, y: ct, z: bzp, x1: -W * 0.55, y1: ct, z1: -W * 0.86, r: hr, c: 6 });  // 槌柄
    blob(v, bxp, byp, bzp, mb, mb, mb, 6);                                                 // 槌頭（布包的球）
  } },

{ n: '大頭像',
  // v1.306.0 整座重畫：盲測第五回的子 agent 只拿〈藍圖製作說明〉、從零做出來的第二版（看過一次報告＋9000 四視圖），
  // 原樣收進來，只改了名字與 pal 的寫法（見 開發筆記〈盲測第五回：三座粗糙的內建重做（v1.306.0）〉）
  // 正面：大頭（含捲髮寬 0.72H，臉寬 0.57H，捲髮從額頭兩側垂到耳朵框住臉）→ 脖子（0.43H）→ 往兩側展開到最寬的雙肩（1.62H）
  //       → 胸像下緣收成 U 形 → 細立柱＋銘牌 → 往下張開的圓柱腳（0.94H）
  // 側面：胸像前後 0.72H，頭往前探、鼻尖最前但只比嘴唇凸 0.10H（直鼻）；下巴底下懸出一截；柱腳是收腰的喇叭形
  // 三樣識別物：①一顆顆凸起的捲髮（白色髮捲、捲與捲之間露出深色鑽孔，瀏海＋兩鬢框住臉）
  //             ②寬肩＋U 形切口的半身輪廓（左肩搭一片斜斜往右下垂的披布衣褶）
  //             ③灰紋大理石的圓形柱腳＋前面一塊刻字銘牌（羅馬胸像的 index tabula）
  // 比例表（實物）：以頭高 H（下巴到髮頂，真人約 26 cm）為唯一的錨。羅馬胸像四段：柱腳／銘牌／胸像本體／頭。
  //   實例：頭 26.5 cm、連柱腳全高 82.5 cm → 全高約 3.1H；另一尊不含柱腳 55.9 cm、頭 30.5 cm → 胸像約 1.8H
  //   本作：柱腳 0.53H、銘牌 0.24H、胸像本體（U 形下緣到肩頂）約 1.0H、脖子前面露出 0.22H、頭 1.0H，全高約 2.85H（頭佔 35%）
  //   肩寬 1.62H（比真人稍窄，讓頭顯大）、胸厚 0.72H、脖子直徑 0.43H、臉寬 0.57H、含髮頭寬 0.72H
  //   臉（由下往上，單位 H）：下巴 0 → 嘴 0.13 → 鼻底 0.19 → 眼 0.355 → 眉 0.42 → 瀏海下緣 0.54 → 髮頂 1.0
  // 輪廓寬度（正面，H ＝ 1）：柱腳底盤 0.94／柱腳腰 0.32／銘牌 0.44／胸像最下緣 約 0.4／胸口中段 1.5／肩（最寬）1.62／
  //   脖子 0.43／臉 0.57（含兩鬢捲髮 0.66）／捲髮 0.72
  // 第一版實測（9000 塊 s = 20.96）：全高 60、寬 39、深 22（10000 那階）；頭像戴毛帽（髮 0.72 對臉 0.50）、脖子偏長、鼻子鷹勾、肩像飛碟
  // 部件尺寸（9000 塊估 s ≈ 21.5，H ＝ s）：頭高 21、含髮寬 15、臉寬 12、肩寬 35、全高約 61；
  //   髮捲半徑 0.13s ≈ 2.8（直徑約 5.5，頂上與兩側凸出 0.08s ≈ 1.7 格、額頭那排只凸 0.05s ≈ 1 格，共 23 顆，含兩鬢 2 顆）；
  //   鼻子凸出 0.10s ≈ 2.1、寬 3；眼睛 3 格寬（中間 1 格瞳孔）、左右 ±3；嘴 5 格寬；
  //   衣褶粗 2r ≈ 2.4、間距 0.16s ≈ 3.4（溝約 1 格）；銘牌 9×5、兩行刻字；柱腳底盤直徑 21、高 10
  // 部件：柱腳底盤(v.cyl) 圓盤線腳(v.cyl 深色) 喇叭形柱身(revolve) 頂環(v.cyl 深色) 立柱(v.box) 銘牌(v.box)＋刻字(tint)
  //   胸像下半(blob 殼) 胸像上半與肩(blob 殼) 三角肌兩顆(blob 殼) 披布衣褶 3 道(limb，沿胸面分 6 段) 衣褶之間的溝(blob 顏色函式)
  //   脖子(revolve 殼) 腦殼(blob 殼) 臉＋下顎(blob 殼，寬而平) 下巴(blob) 鼻子(limb) 耳朵(blob)＋耳洞(paintFrom)
  //   捲髮(小 blob 排在腦殼表面，下半陰影色) 髮根深色(腦殼的顏色函式) 眼睛＋瞳孔(paintFrom) 嘴縫(paintFrom)
  pal: [0xe8e3d8,   // 0 大理石白（亮度 0.88）
        0xcbc4b7,   // 1 大理石陰影（0.76）：下巴底、鼻底、胸像朝下的那一面、髮捲下半
        0xaaa294,   // 2 深陰影（0.62）：髮捲之間的鑽孔、衣褶的溝、眼角、嘴縫、耳洞
        0x8d939a,   // 3 灰紋大理石柱腳、立柱（0.58）
        0x6e747b,   // 4 柱腳深一階（0.46）：圓盤線腳、頂環、紋路
        0x57534d],  // 5 最深（0.32）：瞳孔鑽孔、銘牌刻字
  lo: 3.8, hi: 34,

  gen(v, s) {
    const sq = a => a * a;
    const deg = Math.PI / 180;

    // ── 1. 圓形柱腳（像柱礎：底盤 → 深色圓盤線腳 → 收腰的喇叭形柱身 → 深色頂環）──
    const plH = dim(s, 0.10, 2), toH = dim(s, 0.06, 1), boH = dim(s, 0.32, 4), coH = dim(s, 0.05, 1);
    const soc = (x, y, z) => (hash100(x, y, z) < 22 ? 4 : 3);           // 灰紋大理石
    v.cyl(0, 0, 0, s * 0.47, plH, soc);                                   // 底盤
    v.cyl(0, plH, 0, s * 0.41, toH, 4);                                   // 圓盤線腳
    const yBo = plH + toH, bt = boH - 1;
    revolve(v, { x: 0, y: yBo, z: 0, c: soc,                              // 柱身：往上收腰再微微張開
      prof: [[s * 0.36, 0], [s * 0.28, bt * 0.18], [s * 0.20, bt * 0.42],
             [s * 0.16, bt * 0.66], [s * 0.17, bt * 0.82], [s * 0.21, bt]] });
    const yCo = yBo + boH;
    v.cyl(0, yCo, 0, s * 0.22, coH, 4);                                   // 頂環
    const ySoc = yCo + coH;                                               // 柱腳頂面上一層

    // ── 2. 立柱＋銘牌（白色石板、兩行深色刻字）──
    const thH = dim(s, 0.24, 3), tbW = dim(s, 0.44, 5, true);
    const poW = dim(s, 0.26, 3, true), poD = dim(s, 0.22, 3, true);
    v.box(0, ySoc - 1, 0, poW, thH + 4, poD, 3);                          // 立柱：從頂環裡一路伸進胸像底
    const zT1 = -(poD - 1) / 2 - 1, zT0 = Math.min(-Math.round(s * 0.20), zT1 - 1);
    v.box(0, ySoc, (zT0 + zT1) / 2, tbW, thH, zT1 - zT0 + 1, 0);          // 銘牌貼在立柱正面
    const half = (tbW - 1) / 2;
    for (const r of (thH >= 5 ? [1, 3] : [1]))
      for (let x = -half + 1; x <= half - 1; x++)
        if (hash100(x, r, 7) < 62) tint(v, x, ySoc + r, zT0, 5);

    // ── 3. 胸像本體：下半（U 形下緣）＋上半（肩）＋兩顆三角肌（手臂切口），都是 2 格殼 ──
    const yBot = ySoc + thH;                                              // 胸像最低那層，貼在銘牌頂上
    const L = { x: 0, z: -s * 0.02, rx: s * 0.48, ry: s * 0.40, rz: s * 0.33 };
    L.y = yBot + Math.floor(L.ry * 1.02);
    const U = { x: 0, y: L.y + Math.round(s * 0.16), z: 0, rx: s * 0.80, ry: s * 0.42, rz: s * 0.36 };
    const dX = Math.round(s * 0.66);
    const D = [-dX, dX].map(x => ({ x, y: U.y + s * 0.02, z: s * 0.02, rx: s * 0.15, ry: s * 0.21, rz: s * 0.20 }));
    const B = [L, U, D[0], D[1]];

    // 披布：搭在左肩（−x），三道褶從肩頂後方翻過來、斜斜往右下垂到胸前
    const nF = 3, fr = Math.max(0.75, s * 0.055), fe = fr * 0.4;
    const xa = k => -s * (0.28 + 0.16 * k), fSpan = s * 0.46;
    const yEnd = L.y - s * 0.30;
    const frontZ = (x, y) => {                    // 胸前表面的 z（四顆橢球裡最前面那一顆）
      let z = Infinity;
      for (const b of B) {
        const q = 1 - sq((x - b.x) / b.rx) - sq((y - b.y) / b.ry);
        if (q > 0) z = Math.min(z, b.z - b.rz * Math.sqrt(q));
      }
      return z;
    };
    const pathT = (y, z) => {                     // 這一格在衣褶路徑上的位置 t（0 肩頂後方 → 1 胸前下端），不在路徑上回 -1
      const a = Math.atan2((y - U.y) / U.ry, -(z - U.z) / U.rz) / deg;
      if (a >= 0) return a > 110 ? -1 : (110 - a) / 220;
      if (a < -90) return -1;
      const u = (U.y - y) / (U.y - yEnd);
      return u > 1 ? -1 : 0.5 + 0.5 * u;
    };
    const inBand = (x, y, z) => {                 // 落在三道褶的範圍內 → 溝的顏色（褶本身之後蓋上白色）
      const t = pathT(y, z);
      if (t < 0) return false;
      const off = fSpan * t;
      return x >= xa(nF - 1) + off - s * 0.07 && x <= xa(0) + off + s * 0.07;
    };
    const chestC = b => (x, y, z) => {
      if (inBand(x, y, z)) return 2;
      const nx = (x - b.x) / sq(b.rx), ny = (y - b.y) / sq(b.ry), nz = (z - b.z) / sq(b.rz);
      return ny < -0.45 * Math.hypot(nx, ny, nz) ? 1 : 0;                  // 朝下的面（U 形下緣、手臂切口底）放陰影
    };
    for (const b of B) blob(v, b.x, b.y, b.z, b.rx, b.ry, b.rz, chestC(b), 2);

    const foldP = (k, t) => {                     // 第 k 道褶在 t 的位置（貼著胸面、往外推 fe）
      const x = xa(k) + fSpan * t;
      if (t <= 0.5) {
        const a = (110 - 220 * t) * deg, kk = Math.sqrt(Math.max(0, 1 - sq(x / U.rx)));
        return [x, U.y + (U.ry * kk + fe) * Math.sin(a), U.z - (U.rz * kk + fe) * Math.cos(a)];
      }
      const y = U.y - (t - 0.5) * 2 * (U.y - yEnd);
      return [x, y, frontZ(x, y) - fe];
    };
    for (let k = 0; k < nF; k++) {
      let p = foldP(k, 0);
      for (let i = 1; i <= 6; i++) {
        const q = foldP(k, i / 6);
        if (isFinite(p[2]) && isFinite(q[2]))
          limb(v, { x: p[0], y: p[1], z: p[2], x1: q[0], y1: q[1], z1: q[2], r: fr, c: 0 });
        p = q;
      }
    }

    // ── 4. 脖子（下粗上細，底部張開接進斜方肌，從胸像裡長出來、伸進頭裡）──
    const yC = U.y + Math.round(s * 0.47), zH = -s * 0.06;               // 下巴底那一層、頭的前後基準
    const hairAt = (y, z) => {                    // 髮際線：前額 0.60H → 兩鬢往下 → 耳上 0.42H → 後頸 0.20H
      const yr = (y - yC) / s, zr = (z - zH) / s;
      const hl = zr <= -0.20 ? 0.60 : zr <= -0.05 ? 0.60 - 1.2 * (zr + 0.20)
               : zr <= 0.05 ? 0.42 : zr <= 0.22 ? 0.42 - 1.3 * (zr - 0.05) : 0.20;
      return yr >= hl;
    };
    const yNB = U.y + Math.round(s * 0.12), yNT = yC + Math.round(s * 0.40), nH = yNT - yNB;
    revolve(v, { x: 0, y: yNB, z: Math.round(-s * 0.02), shell: 2, c: (x, y, z) => (hairAt(y, z) ? 2 : 0),
      prof: [[s * 0.31, 0], [s * 0.25, nH * 0.25], [s * 0.22, nH * 0.45], [s * 0.21, nH]] });

    // ── 5. 頭：腦殼＋臉與下顎（寬而平的正面）＋下巴＋鼻子 ──
    const C = { y: yC + s * 0.58, z: zH + s * 0.04, rx: s * 0.28, ry: s * 0.35, rz: s * 0.37 };
    const F = { y: yC + s * 0.31, z: zH - s * 0.11, rx: s * 0.285, ry: s * 0.31, rz: s * 0.25 };
    const headC = (x, y, z) => (hairAt(y, z) ? 2 : y <= yC ? 1 : 0);     // 髮根深色、下顎底一層陰影
    blob(v, 0, C.y, C.z, C.rx, C.ry, C.rz, headC, 2);
    blob(v, 0, F.y, F.z, F.rx, F.ry, F.rz, headC, 2);
    blob(v, 0, yC + s * 0.04, zH - s * 0.24, s * 0.11, s * 0.08, s * 0.08, headC);    // 下巴
    const nTy = yC + s * 0.25;                                            // 希臘式直鼻：鼻樑接額頭、鼻底一層陰影
    limb(v, { x: 0, y: yC + s * 0.44, z: zH - s * 0.31, x1: 0, y1: nTy, z1: zH - s * 0.39,
              r: Math.max(0.75, s * 0.05), r1: Math.max(0.9, s * 0.065), c: (x, y, z) => (y < nTy - 0.5 ? 1 : 0) });

    // ── 6. 捲髮：小球排在腦殼表面，上半白、下半陰影，球與球之間露出深色髮根 ──
    //    球心往內收 0.05s（朝正面的那幾顆再多收 0.03s，額頭那排才不會凸成帽簷）
    let cr = s * 0.13;
    if (cr > 2.9 && cr < 3.15) cr = 3.15;                                 // 避開頂端冒尖的半徑
    if (cr > 3.88 && cr < 4.08) cr = 4.08;
    for (const [ph, n, a0] of [[0, 1, 0], [36, 5, -54], [72, 8, -90], [108, 8, -67.5], [144, 7, 90]]) {
      const sp = Math.sin(ph * deg), cp = Math.cos(ph * deg);
      for (let i = 0; i < n; i++) {
        const th = (a0 + i * 360 / n) * deg;
        const ins = s * (0.05 + 0.03 * Math.max(0, -Math.sin(th) * sp));
        const x = Math.round((C.rx - ins) * sp * Math.cos(th));
        const y = Math.round(C.y + (C.ry - ins) * cp);
        const z = Math.round(C.z + (C.rz - ins) * sp * Math.sin(th));
        if (!hairAt(y, z)) continue;                                      // 臉的範圍不放
        blob(v, x, y, z, cr, cr, cr, (xx, yy, zz) => (yy < y ? 1 : 0));
      }
    }

    // ── 7. 耳朵（畫在捲髮之後，才不會被蓋住）──
    const eX = Math.round(s * 0.25), eY = Math.round(yC + s * 0.33), eZ = Math.round(zH + s * 0.04);
    mirrorX(v, eX, (vv, dx) => {
      blob(vv, dx, eY, eZ, s * 0.07, s * 0.12, s * 0.08, 0);
      paintFrom(vv, dx, eY, eZ, Math.sign(dx), 0, 0, 3, 2);              // 耳洞
    });

    // ── 8. 五官最後點：眼睛（中間一格瞳孔鑽孔）、嘴縫 ──
    const fz = Math.round(F.z), fn = Math.ceil(F.rz) + 4;
    const ex = Math.max(2, Math.round(s * 0.15)), ew = Math.round(s * 0.05), ey = yC + Math.round(s * 0.355);
    mirrorX(v, ex, (vv, dx) => {
      for (let i = -ew; i <= ew; i++) paintFrom(vv, dx + i, ey, fz, 0, 0, -1, fn, i === 0 ? 5 : 2);
    });
    const mw = Math.max(1, Math.round(s * 0.09)), my = yC + Math.round(s * 0.13);
    for (let i = -mw; i <= mw; i++) paintFrom(v, i, my, fz, 0, 0, -1, fn, 2);
  } },

{ n: '聖誕樹', lo: 9, hi: 62,
  // v1.257.0 整座重畫（見 開發筆記〈舊版 21 座重畫、偏白的 5 座調色〉）
  // 聖誕樹
  // 正面：細長的圓錐，四層枝一層比一層窄、每層下緣的枝尖往下垂；頂上一顆金色五角星（面向正面），
  //       金彩帶一圈圈斜繞上去，枝尖底下吊著紅金藍銀的球；最下層枝底下露出樹幹與紅盆，盆邊散著綁緞帶的禮物
  // 側面：同一個圓錐（星星是一片薄的，側面只看得到一條）；禮物偏在前方與兩側
  // 三樣識別物：層層下垂的深綠／亮綠樅樹枝、樹頂金星、繞樹的金彩帶＋彩色吊球
  // 部件：紅樹盆(revolve) 盆口金邊 盆土 樹幹 四層枝(自己掃：中空的傘、外緣扇貝形、枝尖下垂)
  //       枝尖亮綠 針葉雜點 金彩帶(從外往裡找表面的螺旋) 吊球(掛在枝尖下面) 枝面小球(同上找表面)
  //       金星(五角星多邊形) 星座 禮物盒×4(盒＋十字緞帶＋蝴蝶結)
  // 試過沒留下的：樹幹最後蓋（把樹尖蓋成一截棕色）、最下層枝壓得太低（盆與禮物整個被枝蓋住看不到）、
  // 星星半徑 0.075H（3000 塊時只有一個十字，認不出五個角）。
  pal: [0x184a2a,   // 0 深綠：樹枝主體
        0x2f7a36,   // 1 亮綠：每層下緣垂下來的枝尖、針葉亮點
        0xe2b13a,   // 2 金：星星、彩帶、盆口、金球、緞帶
        0xc0262c,   // 3 紅：樹盆、紅球、禮物
        0x2f5fb8,   // 4 藍：藍球、禮物
        0xc8cdd6,   // 5 銀：銀球、禮物、緞帶
        0x6b4426],  // 6 棕：樹幹、盆土
  gen(v, s) {
    const H = s;                                        // 全高：整座唯一的錨
    /* ── 樹盆：底窄口寬的紅盆，口緣一圈金、裡面一層土 ── */
    const hp = Math.max(2, Math.round(H * 0.11)), rp = Math.max(1.8, H * 0.125);
    revolve(v, { x: 0, y: 0, z: 0, c: 3, prof: [[rp * 0.78, 0], [rp, hp - 1]] });
    v.cyl(0, hp - 1, 0, rp + 0.5, 1, 2, 1);                                   // 盆口金邊
    v.cyl(0, hp - 1, 0, rp - 0.5, 1, 6);                                      // 盆土

    /* ── 樹幹：先蓋，後面的枝會把埋在裡面的部分蓋掉（反過來的話樹尖會露出一截棕色）。
       一路通到樹頂，每一層傘頂都靠它接到地面；上半段只要一格粗。 ── */
    const y0 = hp + Math.max(2, Math.round(H * 0.09));    // 最下層枝的下緣：底下露出一截樹幹與盆
    const Hf = H * 0.7, Rb = Hf * 0.45;                  // 枝的總高、最下層的半徑
    const yTop = Math.round(y0 + Hf);
    v.cyl(0, hp, 0, Math.max(0.8, H * 0.035), y0 - hp + 2, 6);
    v.box(0, y0 + 2, 0, 1, yTop - y0 - 2, 1, 6);

    /* ── 四層枝：每層是一把中空的傘（看不到的裡面不填，省下來的積木給外形），
       外緣照角度做成扇貝形——凸出去的地方就是一根枝尖，枝尖比這一層的下緣再垂低一點。
       一邊蓋一邊挑色：下緣那一圈與枝尖亮綠，其餘深綠，再撒一點亮綠雜點當針葉。
       每一列只掃圓環那一段 z（中間空心不逐格算），9000 塊那一檔才壓得進時間預算。 ── */
    const sh = Math.max(1.5, H * 0.05), amp = 0.1, dr = Math.max(1, H * 0.035);
    const rimH = Math.max(1.5, H * 0.05);
    const F0 = [0, 0.25, 0.47, 0.67], F1 = [0.45, 0.66, 0.84, 1], RB = [1, 0.79, 0.58, 0.37];
    const tiers = [];
    for (let ti = 0; ti < 4; ti++) {
      const yb = y0 + F0[ti] * Hf, yt = y0 + F1[ti] * Hf, rb = RB[ti] * Rb;
      const nbr = 9 - ti, ph = ti * 0.7, cph = Math.cos(ph), sph = Math.sin(ph);
      tiers.push({ yb, yt, rb, nbr, ph });
      /* cos(nbr·θ + ph)：(cosθ + i·sinθ) 自乘 nbr 次就是 cos nθ ＋ i·sin nθ，不必 atan2 再 cos。
         而且同一層的每一個高度都用同一張 (x, z) 表——這一層先把整個方格算一次存起來，
         逐格查表就好（9000 那一檔每一次 gen 少算幾千次）。 */
      const N = Math.ceil(rb * (1 + amp) + 0.4) + 1, NW = 2 * N + 1, WV = new Float32Array(NW * NW);
      for (let x = -N; x <= N; x++) for (let z = -N; z <= N; z++) {
        const q = Math.sqrt(x * x + z * z);
        let w = 1;
        if (q > 1e-6) {
          const c = x / q, sn = z / q;
          let re = c, im = sn;
          for (let m = 1; m < nbr; m++) { const r2 = re * c - im * sn; im = re * sn + im * c; re = r2; }
          w = re * cph - im * sph;
        }
        WV[(x + N) * NW + z + N] = w;
      }
      for (let y = Math.floor(yb - dr); y <= Math.ceil(yt); y++) {
        const f = Math.max(0, (y - yb) / (yt - yb));
        if (f > 1) continue;
        const r = rb * Math.pow(1 - f, 1.15) + 0.6;     // 微微內凹：傘緣往外撇
        const rmax = r * (1 + amp) + 0.4, n = Math.floor(rmax), rm2 = rmax * rmax;
        const rin = r * (1 - amp) - sh, rin2 = rin > 0 ? rin * rin : 0;
        /* 扇貝的波只影響：外緣與內緣那兩圈、下緣以下的枝尖、下緣那一圈的顏色。
           其餘的格子不管 wv 是多少都在殼裡、都是深綠，不必算。 */
        const sureLo = r * (1 + amp) - sh, sureHi = r * (1 - amp) + 0.35, rimZone = y - yb < 2 * rimH;
        for (let x = -n; x <= n; x++) {
          const zx = Math.floor(Math.sqrt(rm2 - x * x));
          const zn = rin2 > x * x ? Math.ceil(Math.sqrt(rin2 - x * x)) : 0;
          for (let z = -zx; z <= zx; z++) {
            if (z > -zn && z < zn) { z = zn - 1; continue; }
            const q = Math.sqrt(x * x + z * z);
            let c = 0;
            if (rimZone || q < sureLo || q > sureHi) {
              const wv = WV[(x + N) * NW + z + N], rr = r * (1 + amp * wv);
              if (q > rr + 0.35 || q < rr - sh) continue;
              if (y < yb - dr * Math.max(0, wv)) continue;  // 下緣以下只留垂下來的枝尖
              if ((y - yb < rimH + rimH * wv) && q > rr - 1.2) c = 1;
            }
            let hh = (x * 73856093) ^ (y * 19349663) ^ (z * 83492791);
            hh = ((hh ^ (hh >>> 13)) * 1274126177) >>> 0;
            if (hh % 100 < 9) c = 1 - c;                // 針葉雜點
            v.set(x, y, z, c);
          }
        }
      }
    }

    /* 某個高度上樹最外緣的半徑（四層取大）。下面從外往裡找表面的時候從這裡起掃，
       不必從整棵樹的最大半徑一路掃進來——9000 那一檔光彩帶就有上萬次查格子。 */
    const RA = [];
    for (let y = 0; y <= yTop + 2; y++) {
      let m = 0;
      for (const t of tiers) {
        const f = (y - t.yb) / (t.yt - t.yb);
        if (f > 1 || y < t.yb - dr) continue;
        m = Math.max(m, t.rb * Math.pow(1 - Math.max(0, f), 1.15) + 0.6);
      }
      RA.push(Math.ceil(m * (1 + amp)) + 1);
    }
    /* 從外往裡找表面那一格換色——跟 paintFrom 同一件事（只換「已經有積木」的格子，不會長出懸空格），
       但彩帶一檔就要找上千次，paintFrom／tint 每次進來都驗一次參數，9000 那一檔光這段就多 0.3ms。 */
    const surf = (y, a, c) => {
      const ca = Math.cos(a), sa = Math.sin(a);
      for (let q = RA[Math.max(0, Math.min(RA.length - 1, y))]; q >= 0; q--) {
        const x = Math.round(ca * q), z = Math.round(sa * q);
        if (v.has(x, y, z)) { v.set(x, y, z, c); return; }
      }
    };

    /* ── 金彩帶：從下往上斜繞三圈，從外往裡找第一格實心的塗金 ── */
    const turns = 3, steps = Math.ceil(turns * Math.PI * 2 * Rb * 0.55) + 8;  // 約一格一步（平均半徑 ×0.55 就夠密）
    const gw = H >= 34 ? 2 : 1;                                                // 彩帶寬（格）
    for (let k = 0; k <= steps; k++) {
      const t = k / steps, a = t * turns * Math.PI * 2 + 0.6;
      const y = Math.round(y0 + Hf * (0.06 + 0.86 * t));
      for (let g = 0; g < gw; g++) surf(y + g, a, 2);
    }

    /* ── 吊球：每層枝尖底下掛一顆（先從外往裡找到枝尖那一格，球就掛在它正下方，不會懸空）；
       枝面上再用 paintFrom 點幾顆。紅、金、藍、銀輪流。 ── */
    const BALL = [3, 2, 4, 5];
    let bi = 0;
    for (const tr of tiers) {
      const yy = Math.ceil(tr.yb - dr * 0.999);
      for (let k = 0; k < tr.nbr; k++) {
        if ((k + tr.nbr) % 3 === 2) continue;                                 // 隔幾根才掛，不要每根都掛
        const a = (Math.PI * 2 * k - tr.ph) / tr.nbr;
        for (let q = Math.ceil(tr.rb * (1 + amp)) + 1; q >= 0; q--) {
          const x = Math.round(Math.cos(a) * q), z = Math.round(Math.sin(a) * q);
          if (!v.has(x, yy, z)) continue;
          const c = BALL[bi++ % 4];
          v.set(x, yy - 1, z, c);
          if (H >= 28) v.set(x, yy - 2, z, c);                                // 大一點的時候球是兩格
          if (H >= 48) { v.set(x + Math.sign(x), yy - 1, z, c); v.set(x + Math.sign(x), yy - 2, z, c); }
          break;
        }
      }
    }
    const nb = Math.max(6, Math.round(H * 0.5));
    for (let k = 0; k < nb; k++) {
      const tr = tiers[k % 4], t = 0.3 + ((k * 7) % 10) / 10 * 0.35;
      surf(Math.round(tr.yb + t * (tr.yt - tr.yb)), k * 2.39996 + 0.3, BALL[(k + 1) % 4]);
    }

    /* ── 樹頂金星：一片面向正面（−z）的五角星，大尺寸時中間加厚 ── */
    const Rs = Math.max(2.4, H * 0.12), scy = yTop + Math.round(Rs * 0.42) + 1;
    const SP = [];
    for (let k = 0; k < 10; k++) {
      const a = Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? Rs * 0.45 : Rs;
      SP.push([Math.cos(a) * rr, Math.sin(a) * rr]);
    }
    const inStar = (x, y) => {
      let ins = false;
      for (let a = 0, b = 9; a < 10; b = a++) {
        const xa = SP[a][0], ya = SP[a][1], xb = SP[b][0], yb = SP[b][1];
        if ((ya > y) !== (yb > y) && x < (xb - xa) * (y - ya) / (yb - ya) + xa) ins = !ins;
      }
      return ins;
    };
    const ns = Math.ceil(Rs);
    for (let x = -ns; x <= ns; x++) for (let y = -ns; y <= ns; y++) {
      if (!inStar(x, y)) continue;
      v.set(x, scy + y, 0, 2);
      if (H >= 30 && Math.abs(x) + Math.abs(y) < Rs * 0.45) { v.set(x, scy + y, -1, 2); v.set(x, scy + y, 1, 2); }
    }
    v.box(0, yTop, 0, 1, scy - yTop, 1, 2);                                   // 星座：樹尖接到星心

    /* ── 禮物：樹下前方與兩側四盒，十字緞帶繞過盒頂、上面一個蝴蝶結 ── */
    const gift = (x, z, w, h, d, cb, cr) => {
      x = Math.round(x); z = Math.round(z);
      v.box(x, 0, z, w, h, d, cb);
      v.box(x, 0, z, 1, h, d, cr);
      v.box(x, 0, z, w, h, 1, cr);
      v.set(x, h, z, cr);                                                      // 蝴蝶結
      if (w >= 5) { v.set(x - 1, h, z, cr); v.set(x + 1, h, z, cr); v.set(x - 1, h + 1, z, cr); v.set(x + 1, h + 1, z, cr); }
      else v.set(x, h + 1, z, cr);
    };
    const g1 = dim(H, 0.13, 3, true), g2 = dim(H, 0.11, 3, true), g3 = dim(H, 0.09, 3, true);
    gift(-Rb * 0.42, -Rb * 0.72, g1, Math.max(2, Math.round(H * 0.08)), g1, 3, 2);       // 紅盒金帶
    gift(Rb * 0.5, -Rb * 0.66, g2, Math.max(3, Math.round(H * 0.11)), g2, 4, 5);         // 藍盒銀帶（高的）
    gift(Rb * 0.78, Rb * 0.12, g3, Math.max(2, Math.round(H * 0.07)), g3 + 2, 5, 3);     // 銀盒紅帶（扁長）
    gift(-Rb * 0.8, -Rb * 0.08, g3, Math.max(2, Math.round(H * 0.09)), g3, 2, 4);        // 金盒藍帶
  } },

{ n: '巨型骰子', lo: 3, hi: 18,
  // v1.257.0 整座重畫（見 開發筆記〈舊版 21 座重畫、偏白的 5 座調色〉）
  // 巨型骰子
  // 正面：一顆圓角的白骰子方方正正坐在地上，正面是二點（斜對角兩顆黑點）
  // 側面：同樣是圓角正方形，右面是三點；頂面是一顆大紅的一點
  // 三樣識別物：圓角的白色立方體、凹進去的黑點（排列照真的骰子，對面相加為 7）、亞洲骰子那顆大紅一點
  // 部件：圓角殼(6 次方範數，半徑連續→塊數連續) 受光三面(白) 背光三面(灰一階) 圓角稜線(灰)
  //       點的凹洞(挖掉表面一格) 點底(黑／紅) 點的內緣一圈(灰，讓凹洞讀得出來) 底面整片著地
  // 斜放（一條稜著地）試過：轉 20 度之後頂面與側面變成一階一階不規則的台階，45° 看像一座金字塔，
  // 骰子的「方」反而認不出來，所以維持平放。
  pal: [0xdad5c9,   // 0 白：受光的三面（頂、正面、右面）
        0xa9a49a,   // 1 灰一階：背光的三面（底、背面、左面）、殼裡
        0xbfbaae,   // 2 稜線灰：圓角那一圈、每個點的內緣
        0x1c1c21,   // 3 黑點
        0xc41e2a],  // 4 紅點：亞洲骰子的一點
  gen(v, s) {
    /* 正立方體的塊數一階一階跳（邊長 14→15 就是 +23%），怎麼掃都對不上目標，
       所以照舊用 P 次方範數的圓角立方：半徑 R 連續，塊數就連續。P 取 6：x⁶ 用乘的就算得出來。
       舊版 P=5 每格三次 Math.pow、而且整個包圍盒逐格掃，9000 那一檔產一份要 400 多 ms；
       這版每一根 (x, y) 柱子先解出殼在 z 的哪兩段，只掃那兩段。 */
    const R = s, t = Math.max(1.6, R * 0.15);                  // 半徑、殼厚
    const p6 = x => { const x2 = x * x; return x2 * x2 * x2; };
    const R6 = p6(R), Rin6 = R > t ? p6(R - t) : 0, R1 = p6(R - 1), Rp6 = p6(Math.max(0, R - 2.2));
    const n = Math.floor(R), yc = n;                           // 底面那一層落在 y = 0，整片著地
    const E = R * 0.8;                                         // 第二大的座標超過它就是圓角稜線
    /* 點：每一面的 [a, b, 半徑, 顏色]，點心對齊格子中心（不然圓會取樣成歪的十字）。
       面的兩個座標：x 面用 (y, z)、y 面用 (x, z)、z 面用 (x, y)。
       上 1、下 6、前 2、後 5、右 3、左 4——對面相加都是 7。 */
    /* 點的大小：圓在格子上取樣，半徑 1.5～1.7 會取成一顆菱形（十字再多四格），難看；
       所以照尺寸挑三種形狀之一：3×3 方塊 → 5×5 去四角 → 真的圓。存的是「距離平方的上限」。 */
    const o = Math.max(1, Math.round(R * 0.5)), rr = R * 0.19, p1 = Math.max(1.3, R * 0.3);
    const pr2 = rr < 1.6 ? 2 : rr < 2.6 ? 5 : (rr + 0.5) * (rr + 0.5), pr = Math.sqrt(pr2);
    const dot = (a, b) => [a * o, b * o, pr, 3];
    const C4 = [dot(-1, -1), dot(-1, 1), dot(1, -1), dot(1, 1)];
    const FACE = [];                                           // 索引：軸 × 2 ＋（正向 ? 1 : 0）
    FACE[0] = C4;                                              // −x 左：四
    FACE[1] = [dot(1, -1), dot(0, 0), dot(-1, 1)];             // +x 右：三
    FACE[2] = C4.concat([dot(-1, 0), dot(1, 0)]);              // −y 底：六
    FACE[3] = [[0, 0, p1, 4]];                                 // +y 頂：一（大紅點）
    FACE[4] = [dot(-1, 1), dot(1, -1)];                        // −z 前：二
    FACE[5] = C4.concat([dot(0, 0)]);                          // +z 後：五
    const LIT = [false, true, false, true, true, false];       // 受光：右、頂、前
    for (let x = -n; x <= n; x++) for (let y = -n; y <= n; y++) {
      const a6 = p6(x) + p6(y);
      if (a6 > R6) continue;
      const kx = Math.floor(Math.pow(R6 - a6, 1 / 6) + 1e-9);
      const km = a6 < Rp6 ? Math.ceil(Math.pow(Rp6 - a6, 1 / 6) - 1e-9) : 0;
      const ax = Math.abs(x), ay = Math.abs(y);
      for (let z = -kx; z <= kx; z++) {
        if (z > -km && z < km) { z = km - 1; continue; }
        const s6 = a6 + p6(z), az = Math.abs(z);
        if (s6 > R6 || s6 < Rp6) continue;
        let f, a, b, m2;
        if (ax >= ay && ax >= az) { f = x > 0 ? 1 : 0; a = y; b = z; m2 = Math.max(ay, az); }
        else if (ay >= az) { f = y > 0 ? 3 : 2; a = x; b = z; m2 = Math.max(ax, az); }
        else { f = z > 0 ? 5 : 4; a = x; b = y; m2 = Math.max(ax, ay); }
        let pip = -1, rim = false, d2p = 0;
        for (const P of FACE[f]) {
          const d2 = (a - P[0]) * (a - P[0]) + (b - P[1]) * (b - P[1]);
          if (d2 <= P[2] * P[2] + 1e-6) { pip = P[3]; d2p = d2; break; }
          if (d2 <= (P[2] + 1) * (P[2] + 1)) rim = true;
        }
        if (pip < 0 && s6 < Rin6) continue;                    // 殼只有點底那裡加深
        if (pip >= 0) {
          /* 點：表面那一格挖掉、底塗色，凹進去一格。大紅一點太寬，整片挖下去從斜上方看是個
             陰影裡的洞、紅色幾乎看不到，所以它只挖中間、外圈一環留在表面塗紅（淺碗）。 */
          if (s6 > R1 && (pip === 3 || d2p < (p1 - 1) * (p1 - 1))) continue;
          v.set(x, yc + y, z, pip);
          continue;
        }
        let c = 1;
        if (s6 > R1) c = m2 > E || rim ? 2 : LIT[f] ? 0 : 1;   // 表面那一層才分受光／背光／稜線
        v.set(x, yc + y, z, c);
      }
    }
  } }
];

/* ── 依目標積木數挑尺寸 ────────────────────────────────────
   積木數對 s 不見得單調（挖洞、取整都會讓它上下跳），所以用實際格數掃描，
   而不是套公式估。掃粗的一輪找到大概位置，再在附近細掃一輪。 */
function genCells(sh, s) { const v = new VOX(); sh.gen(v, s); return v; }

/* 支撐關係用 26 鄰居（含斜角），不是只有上下左右前後 6 面。
   voxel 造型很多是用斜線畫的——鐵塔的斜撐、螺旋、圓弧——
   那些格子彼此只在對角相鄰。只認 6 面的話，艾菲爾鐵塔會有 1205/1225 塊
   被判成「懸空」，垮塌判定等於整個失效。 */
const NBR = [];
for (let dx = -1; dx <= 1; dx++)
  for (let dy = -1; dy <= 1; dy++)
    for (let dz = -1; dz <= 1; dz++)
      if (dx || dy || dz) NBR.push([dx, dy, dz]);

/* 只有六個面的鄰居。**不是拿來當一般支撐判定用的**（那樣艾菲爾鐵塔會自己解體），
   只用來偵測「本來好好疊著、現在只剩對角勾著」這種退化——見 slots[i].f6。 */
const NBR6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
/* 一組懸空部件要留幾成的靠山才撐得住。規則那邊的 computeSupport 與這裡的「完好時撐不住
   就豁免」共用同一個數字——兩邊各寫一份的話，改了一邊就會出現「這邊說垮、那邊照蓋」。 */
const PROP_ALIVE = 0.25;

/* 鄰居查表用的數值鍵。+1 是為了讓 −1 的鄰居也落在非負範圍，
   不然 gx=-1 會跟 (1023, gy-1, gz) 撞在同一個鍵上。 */
const gkeyOf = (x, y, z) => (x + 1) + (y + 1) * 1024 + (z + 1) * 1048576;

function fitScale(sh, target) {
  let best = sh.lo, bd = Infinity;
  const scan = (from, to, step) => {
    for (let s = from; s <= to + 1e-9; s += step) {
      if (s < sh.lo || s > sh.hi) continue;
      const n = genCells(sh, s).m.size;
      const d = Math.abs(n - target);
      if (d < bd) { bd = d; best = s; }
      if (n > target * 2.6) return true;      // 已經遠遠超過，不用再往上掃
    }
    return false;
  };
  const coarse = (sh.hi - sh.lo) / 22;
  scan(sh.lo, sh.hi, coarse);
  /* 細掃的步長要夠小。造型參數大多會經過 round()／|1 取整，塊數是一階一階跳的，
     兩階之間的邊界很窄——步長 coarse/6 會整階跨過去，挑到偏差 7% 的那一階
     （實測京都五重塔挑到 3205，其實同一段裡有 2978；雙子星塔 3176 vs 2856）。 */
  scan(best - coarse, best + coarse, coarse / 20);
  return best;
}

/* 產生一份藍圖。回傳的 slots 已經排好施工順序：由下往上、同層由中心往外。 */
function makeBlueprint(idx, target) {
  const sh = SHAPES[idx];
  const cells = genCells(sh, fitScale(sh, target)).cells();

  let minX = Infinity, maxX = -Infinity, minY = Infinity, minZ = Infinity, maxZ = -Infinity, maxY = -Infinity;
  for (const c of cells) {
    if (c.x < minX) minX = c.x; if (c.x > maxX) maxX = c.x;
    if (c.z < minZ) minZ = c.z; if (c.z > maxZ) maxZ = c.z;
    if (c.y < minY) minY = c.y; if (c.y > maxY) maxY = c.y;
  }
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;

  /* 除了世界座標，也留一份整數格座標 gx/gy/gz。
     世界座標置中之後可能是 .5，當不了鄰居查表的鍵；垮塌判定要靠整數格找上下左右。 */
  const slots = cells.map(c => ({
    x: c.x - cx, y: c.y - minY, z: c.z - cz, c: c.c,
    gx: c.x - minX, gy: c.y - minY, gz: c.z - minZ,
    filled: false, claimed: -1, anchor: false, fg: -1, f6: false
  }));
  // 先低後高；同一層先蓋中間——這樣建築是從核心長出來的，看起來比較像在蓋
  slots.sort((a, b) => a.y - b.y || (a.x * a.x + a.z * a.z) - (b.x * b.x + b.z * b.z));

  const at = new Map();
  for (let i = 0; i < slots.length; i++) at.set(gkeyOf(slots[i].gx, slots[i].gy, slots[i].gz), i);

  /* 整份藍圖都在的時候，哪些格子連得到地面。
     有些造型本來就有懸空的部件（風車的扇葉、摩天輪的車廂），
     那些不該因為「沒有支撐」就掉下來，所以垮塌判定只管有 anchor 的格子。 */
  const stack = [];
  for (let i = 0; i < slots.length; i++)
    if (slots[i].gy === 0) { slots[i].anchor = true; stack.push(i); }
  while (stack.length) {
    const s = slots[stack.pop()];
    for (let k = 0; k < NBR.length; k++) {
      const d = NBR[k];
      const j = at.get(gkeyOf(s.gx + d[0], s.gy + d[1], s.gz + d[2]));
      if (j === undefined || slots[j].anchor) continue;
      slots[j].anchor = true; stack.push(j);
    }
  }

  /* 再算一次「只靠六個面連不連得到地面」。這份不是支撐判定，是**退化偵測的基準線**：
     完好時就靠對角相連的格子（艾菲爾鐵塔的斜撐、螺旋梯）本來就長那樣，怎麼打都不該
     因為「只剩對角」被判掉；只有本來六面疊得好好的、被打到剩下對角勾著，才是該掉的。 */
  const st6 = [];
  for (let i = 0; i < slots.length; i++)
    if (slots[i].gy === 0) { slots[i].f6 = true; st6.push(i); }
  while (st6.length) {
    const s = slots[st6.pop()];
    for (let k = 0; k < NBR6.length; k++) {
      const d = NBR6[k];
      const j = at.get(gkeyOf(s.gx + d[0], s.gy + d[1], s.gz + d[2]));
      if (j === undefined || slots[j].f6) continue;
      slots[j].f6 = true; st6.push(j);
    }
  }

  /* 懸空部件（扇葉、車廂、吊索）不連到地面，但也不是憑空浮著——
     它們靠旁邊的結構撐著。把每一組懸空部件、以及附近撐著它的格子（props）記下來，
     旁邊被打掉之後這一組就會整組掉，而不是一律豁免、怎麼打都不動。

     v1.91 之前這裡有一條「一組超過 2000 格就不算，props 留空 ＝ 永遠不掉」，
     等於「大到一定程度就無敵」：吳哥窟 3000 塊那一檔的第三層台加五座塔是一整團 2176 格
     （整座的 72%——三層方台彼此差 1 格沒接上，所以它們從一開始就是懸空的），剛好落在
     這一條裡，於是把底下三層 676 塊全部敲掉，站著的 2336 塊六秒後還是 2336 塊，
     一塊都不垮（實測）。現在不看大小，一律算 props；「該不該豁免」改由下面那一關判。
     成本量過：48 座 @9000 全部產一遍 3510 ms → 3546 ms（最慢的巨型骰子 414 ms
     根本沒有懸空部件，這一段不是瓶頸）。 */
  const comp = new Int32Array(slots.length).fill(-1);
  let nComp = 0;
  for (let i = 0; i < slots.length; i++) {
    if (comp[i] >= 0) continue;
    const id = nComp++;
    const st2 = [i]; comp[i] = id;
    while (st2.length) {
      const s = slots[st2.pop()];
      for (let k = 0; k < NBR.length; k++) {
        const d = NBR[k];
        const j = at.get(gkeyOf(s.gx + d[0], s.gy + d[1], s.gz + d[2]));
        if (j === undefined || comp[j] >= 0) continue;
        comp[j] = id; st2.push(j);
      }
    }
  }
  const groups = new Map();
  for (let i = 0; i < slots.length; i++) {
    if (slots[i].anchor) continue;                 // anchor 的由連通性判定管
    let g = groups.get(comp[i]);
    if (!g) groups.set(comp[i], g = { cells: [], props: [] });
    g.cells.push(i);
  }
  for (const g of groups.values()) {
    const set = new Set();
    // 先找半徑 2 以內的鄰居；真的找不到再放寬到 3
    for (let r = 2; r <= 3 && set.size === 0; r++) {
      for (const i of g.cells) {
        const s = slots[i];
        for (let dx = -r; dx <= r; dx++)
          for (let dy = -r; dy <= r; dy++)
            for (let dz = -r; dz <= r; dz++) {
              const j = at.get(gkeyOf(s.gx + dx, s.gy + dy, s.gz + dz));
              if (j === undefined || comp[j] === comp[i]) continue;
              set.add(j);
            }
      }
    }
    g.props = [...set];
  }
  const floats = [...groups.values()];
  for (let gi = 0; gi < floats.length; gi++)
    for (const i of floats[gi].cells) slots[i].fg = gi;   // 反查：這格屬於哪一組懸空部件

  /* 哪幾組「完好時就撐不住」——那是作者畫的自由懸空件（整份藍圖都在也找不到通到地面的
     路徑），永遠豁免，props 清空。判準與遊戲裡的 computeSupport 一字不差：同一個
     PROP_ALIVE 門檻、同樣從「全部先當作沒支撐」往上長，只是拿「整份藍圖都在」算一次。

     為什麼一定要有這一關：v1.91 拿掉「超過 2000 格就豁免」之後，吳哥窟 9000 那一檔的
     兩團塔會互相當對方的靠山，而兩團都碰不到地面（第三層台在 4 格外，本來就沒有東西
     撐著它們），於是**完好的建築自己掉了** 7084 塊（實測 9044 → 1960）。
     那種造型只能豁免——地面上本來就沒有東西撐著它。
     反過來，吳哥窟 3000 那一檔是 anchor → 第二層台 → 上面那一大團的正常鏈，
     所以不會被這一關豁免，底座打掉就會垮（這才是這一版要修的那個症狀）。 */
  const standOk = new Uint8Array(floats.length);
  for (let ch = true; ch;) {
    ch = false;
    for (let gi = 0; gi < floats.length; gi++) {
      if (standOk[gi]) continue;
      const g = floats[gi];
      if (!g.props.length) { standOk[gi] = 1; ch = true; continue; }
      let alive = 0;
      for (const j of g.props)
        if (slots[j].anchor || (slots[j].fg >= 0 && standOk[slots[j].fg])) alive++;
      if (alive > g.props.length * PROP_ALIVE) { standOk[gi] = 1; ch = true; }
    }
  }
  for (let gi = 0; gi < floats.length; gi++) if (!standOk[gi]) floats[gi].props = [];

  let radius = 0;
  for (const s of slots) radius = Math.max(radius, Math.hypot(s.x, s.z));

  return {
    idx, name: sh.n, pal: sh.pal, slots, at, floats,
    height: maxY - minY + 1,
    radius: radius + 1,
    count: slots.length
  };
}

/* ── 自訂藍圖 ──────────────────────────────────────────────
   `blueprints/` 資料夾裡的檔案呼叫這個函式，把自己接到 SHAPES 後面，
   之後跟內建的 48 座走完全一樣的路（下拉選單、隨機挑、成就都算）。
   寫法與規則見 `blueprints/藍圖製作說明.md`——那份是寫給 AI 看的。

   兩種給法：
   1. layers：一層一層的字元圖（最直觀，AI 看著圖片畫得出來）。
      這裡會把它包成一個會縮放的 gen()，換了建材檔位才推得動。
   2. gen：直接給產生函式，跟內建那 48 座同一套 VOX API（進階用）。 */
const CUSTOM_MIN = 180, CUSTOM_MAX = 12000;  // 縮放範圍要蓋住體檢量的 300–10000（含超額餘裕）

function bpColor(c) {
  if (typeof c === 'number') return c;
  let s = String(c).replace('#', '').trim();
  /* 3 位簡寫與帶透明度的 8 位（v1.264.0）：AI 很常寫 '#fff'，以前 parseInt('fff') ＝ 0x000fff，
     靜靜畫成藍色；'#rrggbbaa' 整串讀進來也是亂的。簡寫展開成 6 位，透明度直接丟掉（積木一律不透明）。
     見 開發筆記〈prompt 拿去盲測（v1.264.0）〉 */
  if (/^[0-9a-f]{3,4}$/i.test(s)) s = s.slice(0, 3).split('').map(h => h + h).join('');
  else if (/^[0-9a-f]{8}$/i.test(s)) s = s.slice(0, 6);
  const n = parseInt(s, 16);
  return Number.isFinite(n) ? n : 0xcfc7b8;
}
function customBlueprint(def) {
  const who = (def && def.name) || '(沒有 name)';
  const bad = m => { console.warn('[自訂藍圖] ' + who + '：' + m + '，這一份跳過'); return -1; };
  if (!def || !def.name) return bad('缺 name');
  if (SHAPES.some(s => s.n === def.name)) return bad('名字跟現有的藍圖撞號');
  const pal = (Array.isArray(def.pal) && def.pal.length ? def.pal : ['#cfc7b8']).map(bpColor);

  if (typeof def.gen === 'function') {          // 進階：自己寫產生函式
    SHAPES.push({ n: def.name, lo: def.lo || 6, hi: def.hi || 30, pal, gen: def.gen, custom: true });
    return SHAPES.length - 1;
  }

  if (!Array.isArray(def.layers) || !def.layers.length) return bad('缺 layers');
  // 一層可以給字串陣列，也可以給一整段含換行的字串
  const rows = def.layers.map(l => (typeof l === 'string' ? l.split(/\r?\n/) : (l || []).slice()));
  const H = rows.length;
  let W = 0, D = 0;
  for (const r of rows) { D = Math.max(D, r.length); for (const line of r) W = Math.max(W, (line || '').length); }
  if (!W || !D) return bad('layers 是空的');

  /* -1 = 空。長短不齊的列自動補空白：AI 產的圖常常尾巴少幾個點，
     為了那個把整份丟掉太脆弱，補完照用就好。 */
  const src = new Int8Array(W * H * D).fill(-1);
  const unknown = new Set();
  let n = 0;
  for (let y = 0; y < H; y++) {
    for (let z = 0; z < rows[y].length; z++) {
      const line = rows[y][z] || '';
      for (let x = 0; x < line.length; x++) {
        const ch = line[x];
        if (ch === '.' || ch === ' ' || ch === '0') continue;
        const ci = '123456789'.indexOf(ch);
        if (ci < 0) { unknown.add(ch); continue; }
        src[(y * D + z) * W + x] = Math.min(ci, pal.length - 1);
        n++;
      }
    }
  }
  if (!n) return bad('layers 裡一格實心的都沒有');
  if (unknown.size)
    console.warn('[自訂藍圖] ' + who + '：不認得的字元「' + [...unknown].join('') + '」當成空白處理');

  /* 縮放：輸出格回頭取樣來源格（最近鄰）。放大是複製、縮小是抽樣，
     兩個方向共用同一段程式。座標不置中——makeBlueprint 會自己抓包圍盒置中。

     取樣點是輸出格的「中心」（+0.5），不是左邊界。差別在縮小的時候：
     用左邊界的話最後一列永遠取不到（D=9 縮成 8 列時，來源第 8 列直接消失），
     而那一列剛好就是最外面那面牆——牆只有 1 格厚，掉一列就整面不見。
     取中心會改成漏掉中間某一列，中空建築的內部本來就是空的，看不出來。 */
  const gen = (v, s) => {
    const ow = Math.max(1, Math.round(W * s));
    const oh = Math.max(1, Math.round(H * s));
    const od = Math.max(1, Math.round(D * s));
    for (let y = 0; y < oh; y++) {
      const sy = Math.min(H - 1, Math.floor((y + 0.5) * H / oh));
      for (let z = 0; z < od; z++) {
        const sz = Math.min(D - 1, Math.floor((z + 0.5) * D / od));
        for (let x = 0; x < ow; x++) {
          const c = src[(sy * D + sz) * W + Math.min(W - 1, Math.floor((x + 0.5) * W / ow))];
          if (c >= 0) v.set(x, y, z, c);
        }
      }
    }
  };
  /* 格數大約隨 s³ 走，所以尺度範圍直接由「基準模型有幾格」反推。
     藍圖作者因此不必自己算 lo/hi——那是內建那 48 座才需要手調的東西。 */
  const cube = t => Math.cbrt(t / n);
  const lo = Math.max(0.34, cube(CUSTOM_MIN));
  const hi = Math.max(lo + 0.3, cube(CUSTOM_MAX));
  SHAPES.push({ n: def.name, lo, hi, pal, gen, custom: true, base: { W, H, D, n } });
  return SHAPES.length - 1;
}

/* ── 匯入一段貼上來的藍圖 ─────────────────────────────────
   「把 AI 給的整段 customBlueprint({...}) 貼進來」有兩個入口：藍圖預覽.html 的貼上框、
   遊戲的「匯入建築」。兩邊的清洗、撞名規則、錯誤訊息都必須一模一樣，所以收在這裡一份。

   這等於執行使用者自己貼進來的程式碼——跟把 .js 丟進 blueprints/ 同一個信任等級。
   own 是「這個入口自己貼進來的那幾份」在 SHAPES 的索引：只有自己貼的才准蓋掉，
   撞到內建或 blueprints/ 裡的一律擋下來（不然會愈貼愈多，或蓋掉別人的檔案）。 */
function cleanPaste(t) {
  return String(t)
    .replace(/```[a-zA-Z]*\n?/g, '')     // AI 很愛加的 markdown 圍籬
    .replace(/^\s*檔名[：:].*$/gm, '')    // 「檔名：我的塔.js」那一行（沒有 // 的那種）
    .trim();
}
/* 存檔要用的檔名。AI 照〈藍圖製作說明〉會在第一行寫 `// 檔名：xxx.js`（那行是合法的
   註解，所以留在程式裡不必清掉）；沒寫就拿藍圖名字當檔名。
   路徑分隔字元與 Windows 不收的字要濾掉——檔名是從貼進來的文字撈的，不是我們給的。 */
function bpFileName(code, name) {
  const m = code.match(/檔名\s*[：:]\s*([^\r\n]+?\.js)\s*$/m);
  const raw = m ? m[1] : name + '.js';
  return raw.replace(/[\\/:*?"<>|]/g, '').trim() || (name + '.js');
}
/* 找一個沒人用的名字：後面接編號。已經結尾有數字的就從那個數字往上加
   （羅馬競技場 → 羅馬競技場2、馬克杯2 → 馬克杯3）。SHAPES 是有限的、每一圈都是
   不同的候選名，所以一定會停。 */
function freeBpName(name) {
  const m = /^(.*?)(\d+)$/.exec(name);
  const base = m ? m[1] : name;
  let n = m ? +m[2] + 1 : 2;
  while (SHAPES.some(s => s.n === base + n)) n++;
  return base + n;
}

function importBlueprint(raw, own) {
  const code = cleanPaste(raw);
  if (!code) throw new Error('貼上的內容是空的。');
  if (code.indexOf('customBlueprint') < 0)
    throw new Error('看不到 customBlueprint(...)。要貼的是 blueprints/ 裡那種檔案的整段內容。');

  /* 先用一個攔截版的 customBlueprint 把定義接下來：這樣能先看名字，
     決定要不要蓋掉上一次貼的同名那份，再交給真正的 customBlueprint 走它的驗證。
     其他工具（dim／blob／tint…）都是全域，貼進來的程式直接看得到。 */
  const defs = [];
  let fn;
  try { fn = new Function('customBlueprint', code); }
  catch (e) { throw new Error('程式有語法錯誤：' + e.message); }
  try { fn(d => { defs.push(d); return 0; }); }
  catch (e) { throw new Error('執行時出錯：' + e.message); }
  if (!defs.length) throw new Error('這段程式沒有真的呼叫到 customBlueprint(...)。');

  const added = [];
  for (const def of defs) {
    if (!def || !def.name) throw new Error('customBlueprint 少了 name。');
    /* 撞名怎麼處理（v1.111 改）：
         撞到自己上一次貼的那份 → 蓋掉（「換一版」，貼上→看→改→再貼的節奏靠這個）
         撞到內建或 blueprints/ 的名字 → **自動加編號**。以前是退回去叫人「改個 name
           再貼」，但那個 name 是寫在 AI 給的程式裡的，要改就得回去翻那段程式。
           順便也解掉「程式更新後多了同名的內建」：那一份以前會在開場載入時被擋掉、
           整份消失（只留一行 console.warn），現在是改名留下來。
       加編號的那條要先找「上一次同一個 name 進來時被改成的那一份」（name＋編號）並蓋掉它，
       不然同一份改一版再貼一次就多一座，會 2、3、4 一直長。有好幾份符合就取最早貼進來的。 */
    const src = def.name;
    const hit = SHAPES.findIndex(s => s.n === def.name);
    let take = -1;                       // 要蓋掉的「自己那一份」在 SHAPES 的位置
    if (hit >= 0 && own.has(hit)) take = hit;
    else if (hit >= 0) {
      const pre = new RegExp('^' + src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\d+$');
      for (const i of own) if (pre.test(SHAPES[i].n)) { take = i; break; }
      def.name = take >= 0 ? SHAPES[take].n : freeBpName(src);
    }
    if (take >= 0) {
      /* 只蓋掉自己貼的那份。splice 會讓後面的索引往前挪一格，所以整組重算 */
      SHAPES.splice(take, 1);
      const moved = [];
      for (const i of own) if (i !== take) moved.push(i > take ? i - 1 : i);
      own.clear();
      for (const i of moved) own.add(i);
    }
    // customBlueprint 擋掉時的理由只走 console.warn，借過來當錯誤訊息
    let why = '';
    const orig = console.warn;
    console.warn = m => { why = String(m); };
    let idx;
    try { idx = customBlueprint(def); } finally { console.warn = orig; }
    if (idx < 0) throw new Error(why || '這份藍圖被 customBlueprint 擋掉了。');
    own.add(idx);
    // was：被改過名的才有值，兩邊的 UI 拿它講「原名撞號，自動加了編號」
    added.push({ idx: idx, name: def.name, was: def.name === src ? '' : src,
                 file: bpFileName(code, def.name), code: code });
  }
  return added;
}

/* ── 藍圖體檢 ─────────────────────────────────────────────
   產出一份**純文字報告**，用途是「貼回去給產出這份藍圖的 AI」。
   為什麼要這樣設計：一般玩家手上不會有能跑指令的 AI，流程是把
   〈藍圖製作說明.md〉＋圖片貼進網頁版 AI、拿回一支 .js、放進 blueprints/，
   所以回饋也必須是「一段可以複製貼上的文字」才接得回去。
   因此每個 ✘ 後面都跟一行「修法」——AI 看不到遊戲原始碼，只能靠報告知道要改哪裡。
   遊戲裡的按鈕與 tools/check-bp.cjs 共用這一支，兩邊輸出一模一樣。 */
/* 體檢要量的四個尺寸：比面板那三檔（1800／3000／9000）再往兩端多量一階。上限 10000：
   自訂藍圖的 hi 如果只算到 3000，10000 那一階就會頂在 hi 上，
   報告會直接說「s 已經頂到 hi」——那正是要給 AI 的訊號。 */
const BP_TARGETS = [300, 1600, 3000, 10000];
/* 面板三檔（game.js 的 CNT_OPTS）裡 BP_TARGETS 沒量到的那兩檔（v1.286.0）。不進塊數那一表，
   只量兩件事：一大組懸空、部件整組消失。
   · 懸空：盲測時一顆佛頭在 9000 那一檔跟肩膀斷開、10000 那一檔剛好接上，報告寫「懸空 0 格」——
     玩家拿得到的是 9000，那一檔沒量就等於沒量。
   · 整組消失改在 1800（面板最小的一檔）判：300 玩家選不到（舊存檔也會被 snapOpt 吸到三檔裡），
     盲測時 AI 花了兩版去追「300 塊才消失」的一格眼睛、一格嘴，玩家根本看不到那個尺寸。
   見 開發筆記〈盲測第二回：三座粗糙的自訂藍圖重做、prompt 兩輪對照（v1.286.0）〉 */
const BP_PANEL = [1800, 9000];
const BP_SLOW_MS = 250;         // 產一份藍圖的時間預算（換建築不能卡畫面）
/* 輪廓圖的上限：一張最多幾格寬、幾格高（超過就降採樣）。
   一格積木印成**兩個字元**，等寬字型下才是正方形（字元本身高是寬的兩倍）。 */
const BP_ART_W = 32, BP_ART_H = 24;
/* 門檻是拿內建 48 座校準過的，只留「真的是缺陷」的那幾條：
   包圍盒大小與懸空**總量**都**不**示警——金門大橋單邊 163、京都五重塔懸空 61%、
   倫敦眼有 156 組小孤島，那些是吊索與輻條，本來就長那樣。示警了只會逼 AI
   去「修」沒壞的東西。最小尺寸做不到 300 塊也一樣：48 座裡有 15 座如此，
   而照著那個示警去縮部件，換來的是部件在小尺寸整組消失——反而更糟。

   **唯一示警的是「一大組」**（v1.263.0）：單獨一組連不到地面的格子佔整座 BP_FLOAT_BIG 以上。
   拿 87 座（48 內建＋39 自訂）在 1800／3000／10000 三檔重量過：小組懸空最大一組
   只佔 0.6%（俄式白石大教堂一組金色 10 格、大頭像 55 格），而接縫沒接上的是 9%～88%
   （特製叉燒拉麵整個碗身沒接到碗腳 88%、林家花園觀稼樓的屋頂 23%、日式醬油糰子只在
   3000 那一檔浮起來 16%、清水寺的左翼廊 9%）。中間空得很開，5% 不會誤報吊索與裝飾。
   內建的北京天壇（27%）與京都五重塔（22%）在 10000 那一檔也是這一類（五重塔 9000 那一檔
   9353 格裡 8105 格懸空），是加了這一條才看到的，同一版一起修了。
   這一類以前報告只寫「懸空 N 格」，下面還接一句「懸空本身沒問題」——AI 照字面就略過了。
   見 開發筆記〈自訂藍圖調整一輪（v1.263.0）〉。 */
const BP_FLOAT_BIG = 0.05;

/* 連不到地面的格子分組（26 鄰居、從最低那層往上長——跟 makeBlueprint 的 anchor 同一個判法），
   由大到小排。體檢四個尺寸都要量：醬油糰子那種「只在某幾個 s 差一格」的，只看 10000 那一檔抓不到。
   鍵自己算（+512）：cells 是 gen 的原始座標，x／z 可以是負的，gkeyOf 只收非負的整數格。 */
function bpFloatGroups(cells) {
  const key = (x, y, z) => (x + 512) + (y + 512) * 1024 + (z + 512) * 1048576;
  let minY = Infinity;
  for (const c of cells) if (c.y < minY) minY = c.y;
  const at = new Map();
  cells.forEach((c, i) => at.set(key(c.x, c.y, c.z), i));
  const seen = new Uint8Array(cells.length);
  const grow = (st, g) => {
    while (st.length) {
      const c = cells[st.pop()];
      if (g) { g.n++; g.lo = Math.min(g.lo, c.y - minY); g.hi = Math.max(g.hi, c.y - minY);
               g.hist[c.c] = (g.hist[c.c] || 0) + 1; }
      for (const d of NBR) {
        const j = at.get(key(c.x + d[0], c.y + d[1], c.z + d[2]));
        if (j === undefined || seen[j]) continue;
        seen[j] = 1; st.push(j);
      }
    }
  };
  const ground = [];
  cells.forEach((c, i) => { if (c.y === minY) { seen[i] = 1; ground.push(i); } });
  grow(ground, null);
  const groups = [];
  for (let i = 0; i < cells.length; i++) {
    if (seen[i]) continue;
    seen[i] = 1;
    const g = { n: 0, lo: Infinity, hi: -Infinity, hist: {} };
    grow([i], g);
    groups.push(g);
  }
  return groups.sort((a, b) => b.n - a.n);
}

function bpIndexOf(which) {
  if (typeof which === 'number') return which >= 0 && which < SHAPES.length ? which : -1;
  if (typeof which === 'string' && which) return SHAPES.findIndex(sh => sh.n === which);
  for (let i = SHAPES.length - 1; i >= 0; i--) if (SHAPES[i].custom) return i;   // 預設：最後加進來的自訂藍圖
  return -1;
}

/* 把格子投影成一張字元圖。`h`／`v` 是這張圖的橫軸與縱軸（'x'／'y'／'z'），
   `bb` 是包圍盒、`step` 是一格字元代表幾格積木，`vDown` 給 true 就把 v 小的畫在上面。

   降採樣一律取「這一格區塊裡**有沒有**積木」，不是取樣中心點那一格：
   1 格厚的牆、1 格寬的手臂在取樣式縮小裡會整片消失（附錄那條字元圖的老毛病），
   而輪廓要的正是「這裡有沒有東西」。三張圖共用同一個 step，比例才不會被拉長壓扁
   ——比例本身就是要看的東西之一。 */
function bpArtView(cells, h, v, bb, step, vDown) {
  const hn = Math.max(1, Math.ceil((bb[h][1] - bb[h][0] + 1) / step));
  const vn = Math.max(1, Math.ceil((bb[v][1] - bb[v][0] + 1) / step));
  const g = [];
  for (let i = 0; i < vn; i++) g.push(new Array(hn).fill(0));
  for (const c of cells)
    g[Math.floor((c[v] - bb[v][0]) / step)][Math.floor((c[h] - bb[h][0]) / step)] = 1;
  const out = [];
  for (let i = 0; i < vn; i++) {
    const row = g[vDown ? i : vn - 1 - i];
    let line = '';
    for (const f of row) line += f ? '##' : '..';
    out.push('    ' + line);
  }
  return out;
}

function checkBlueprint(which, opt) {
  const ver = (opt && opt.ver) || (typeof VERSION !== 'undefined' ? VERSION : '?');
  const L = [], fails = [], warns = [];
  const bad = m => { fails.push(m); };
  const warn = m => { warns.push(m); };
  const pad = (v, n) => String(v).padStart(n);
  L.push('=== 積木小人 · 藍圖診斷 v' + ver + ' ===');

  const idx = bpIndexOf(which);
  if (idx < 0) {
    L.push('✘ 找不到藍圖：' + (which === undefined || which === '' ? '（沒有任何自訂藍圖）' : which));
    L.push('  修法：確認 customBlueprint 的 name 跟要檢查的名字一致，'
         + '而且檔名已經加進 blueprints/list.js。');
    return { idx: -1, name: '', fails: ['找不到藍圖'], warns: [], text: L.join('\n') };
  }
  const sh = SHAPES[idx];
  const isLayers = !!sh.base;
  L.push('藍圖：' + sh.n + (sh.custom ? (isLayers ? '（自訂 · 字元圖）' : '（自訂 · gen）') : '（內建）'));

  /* 每個尺寸各產一次：塊數、實際用到的尺度、包圍盒、各色格數。
     gen() 丟例外是自訂藍圖的頭號死法（算出負數、undefined 進了迴圈），
     所以每一輪都包起來，把錯誤訊息原封不動寫進報告——那是 AI 唯一的線索。 */
  const rows = [];
  let maxC = -1, threw = false;
  for (const t of BP_TARGETS) {
    const t0 = Date.now();
    let s, cells;
    try {
      s = fitScale(sh, t);
      cells = genCells(sh, s).cells();
    } catch (e) {
      bad(t + ' 塊時 gen() 出錯');
      threw = true;
      rows.push({ t, err: (e && e.message) ? e.message : String(e) });
      continue;
    }
    const hist = {};
    let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity, mnz = Infinity, mxz = -Infinity;
    for (const c of cells) {
      hist[c.c] = (hist[c.c] || 0) + 1;
      if (c.c > maxC) maxC = c.c;
      if (c.x < mnx) mnx = c.x; if (c.x > mxx) mxx = c.x;
      if (c.y < mny) mny = c.y; if (c.y > mxy) mxy = c.y;
      if (c.z < mnz) mnz = c.z; if (c.z > mxz) mxz = c.z;
    }
    rows.push({ t, s, n: cells.length, hist, ms: Date.now() - t0,
                w: cells.length ? mxx - mnx + 1 : 0,
                h: cells.length ? mxy - mny + 1 : 0,
                d: cells.length ? mxz - mnz + 1 : 0,
                floor: cells.filter(c => c.y === mny).length,
                cells, bb: { x: [mnx, mxx], y: [mny, mxy], z: [mnz, mxz] } });
  }

  /* 面板那兩檔（BP_PANEL）：不進塊數那一表，只拿來量懸空與顏色在不在。
     gen 在這兩檔丟例外的話，四階那邊幾乎一定也丟了、已經報過，這裡不重複。 */
  const prow = {};
  for (const t of BP_PANEL) {
    try {
      const s = fitScale(sh, t), cells = genCells(sh, s).cells(), hist = {};
      for (const c of cells) hist[c.c] = (hist[c.c] || 0) + 1;
      prow[t] = { t, s, n: cells.length, hist, cells };
    } catch (e) { /* 見上 */ }
  }
  const pMin = prow[BP_PANEL[0]];
  const pMinDev = pMin ? Math.round((pMin.n / pMin.t - 1) * 100) : null;

  /* s 壓在 lo 還太大的時候，是 lo 卡住還是各部件的下限撐著？產一份 lo×0.7 比塊數就知道。
     v1.66（新天鵝堡、帕德嫩）與 v1.286.0 的盲測（新竹火車站）都照「把 lo 調小」做了，
     結果一格都沒少——s 到 lo 的時候每個 dim 早就落在下限。只在真的要給這條修法時才量（一次）。 */
  let loTest;                                     // undefined ＝ 還沒量；null ＝ 量不了（gen 在那裡丟例外）
  const loShrinks = () => {
    if (loTest === undefined) {
      try { loTest = { a: genCells(sh, sh.lo).m.size, b: genCells(sh, sh.lo * 0.7).m.size }; }
      catch (e) { loTest = null; }
    }
    return loTest;
  };

  /* 塊數 */
  L.push('');
  L.push('塊數（目標 → 實得，偏差）');
  const span = sh.hi - sh.lo;
  for (const r of rows) {
    if (r.err) { L.push('  ' + pad(r.t, 5) + ' → ✘ gen() 出錯：' + r.err); continue; }
    const dev = r.n / r.t - 1;
    /* 門檻拿「印出來的那個整數百分比」去比，不是拿原始值——不然報告上會出現
       「+10% ✔」跟「+10% ⚠」兩種，讀報告的 AI 只會覺得規則不一致。 */
    const shown = Math.round(dev * 100);
    const atLo = !isLayers && dev > 0 && r.s < sh.lo + span * 0.05;
    /* 最小那一階給得寬：造型的最小可行尺寸本來就可能比 300 塊大（48 座裡 15 座如此），
       那是「這座就是不能再小」，不是缺陷。硬要縮到 300 只會讓部件消失。 */
    const floor300 = r.t === BP_TARGETS[0] && shown > 10;
    /* 比面板最小那一檔（1800）還小的那幾階（1600）也一樣（v1.286.0）：s 已經壓到最小、
       而面板的 1800 拿到的跟 1800 差不到 10%，玩家選得到的每一檔都沒事——
       以前照樣 ⚠，盲測時 AI 為了 1600 +17%（面板那一檔其實 +4%）去縮部件。 */
    const floorPanel = !floor300 && shown > 10 && atLo && r.t < BP_PANEL[0] && pMin && pMinDev <= 10;
    const off = Math.abs(shown) > 10 && !floor300 && !floorPanel;
    if (off) warn(r.t + ' 塊偏差 ' + shown + '%');
    L.push('  ' + pad(r.t, 5) + ' → ' + pad(r.n, 5) + '  ' +
           pad((shown >= 0 ? '+' : '') + shown + '%', 5) +
           '  s=' + r.s.toFixed(2) + '  ' + (off ? '⚠' : '✔') +
           (floor300 ? '（這座最小就是這麼大，設 300 也會拿到 ' + r.n + ' 格）' : '') +
           (floorPanel ? '（這座最小就是這麼大；面板最小那一檔 ' + pMin.t + ' 拿到 ' + pMin.n +
                         ' 格、' + (pMinDev >= 0 ? '+' : '') + pMinDev + '%，沒問題）' : ''));
    if (!off) continue;
    if (isLayers)
      L.push('    修法：字元圖的 lo/hi 是自動反推的，改不動。偏差大表示原圖太小或太細，'
           + '要治本得改寫成 gen(v, s)。');
    else if (dev < 0 && r.s > sh.hi - span * 0.05)
      L.push('    修法：s 已經頂到 hi=' + sh.hi + '，塊數追不上目標。把 hi 調大（例如 ' +
             (sh.hi * 1.4).toFixed(0) + '）。');
    else if (atLo) {
      const lt = loShrinks(), lo7 = (sh.lo * 0.7).toFixed(1);
      const panel = r.t < BP_PANEL[0] && pMin
        ? '面板最小那一檔是 ' + pMin.t + '，這座在那一檔拿到 ' + pMin.n + ' 格（' +
          (pMinDev >= 0 ? '+' : '') + pMinDev + '%）。' : '';
      if (lt && lt.b < lt.a)
        L.push('    修法：s 已經壓到 lo=' + sh.lo + '，最小的造型還是太大。把 lo 調小（例如 ' + lo7 +
               '：同一份 gen 在那裡是 ' + lt.b + ' 格）。' + panel);
      else if (lt)
        L.push('    修法：s 已經壓到 lo=' + sh.lo + '，但 lo 調小沒有用——s 縮到 ' + lo7 + ' 還是 ' + lt.b +
               ' 格，是各部件的下限（dim 的第三個參數）撐著。' + panel +
               '真要更小，就把佔最多格的那幾個部件的下限改小（例如乘 0.7）；部件會跟著變細，'
               + '縮過頭的會在小尺寸整組消失。');
      else
        L.push('    修法：s 已經壓到 lo=' + sh.lo + '，最小的造型還是太大。把 lo 調小（例如 ' + lo7 +
               '），或把各部件的下限（dim 的第三個參數）改小。' + panel);
    }
    else
      L.push('    修法：塊數一階一階跳，階距太大。把跳最兇的那個維度係數調小一點，'
           + '讓別的維度連續變化去補；或者只有真的要對稱的那一個取奇數。');
  }

  /* 「參數錯誤：」是畫圖函式自己丟的（見檔案開頭的 bpArgs）——那一類的修法很具體，
     直接指到參數表就好，不必再叫 AI 去猜「undefined 是從哪裡進迴圈的」。 */
  if (threw) {
    const argErr = rows.some(r => r.err && r.err.indexOf('參數錯誤：') === 0);
    const cfErr = rows.some(r => r.err && r.err.indexOf('參數錯誤：顏色函式') === 0);   // 見 VOX.set
    L.push(cfErr
      ? '  修法：顏色函式的每一條路都要回傳 pal 的整數索引——算出來的要 Math.round() 包起來，'
        + '每個分支都要有 return（漏掉的那一支回傳的就是 undefined）。見〈藍圖製作說明〉3.4。'
      : argErr
      ? '  修法：上面那行是「呼叫函式時參數給錯了」，訊息裡已經指出是哪一支的第幾個參數。'
        + '照〈藍圖製作說明〉3.1／3.2 的參數表補齊——最常見的是最後那個顏色索引 c 忘了給，'
        + '或某個尺寸自己算成了 NaN／undefined。'
      : '  修法：照上面的錯誤訊息修。常見原因是尺寸算出 0 或負數、undefined 進了迴圈、'
        + '或用了這份說明文件裡沒有的函式。');
  }

  /* 面板那兩檔各挑到的 s（v1.287.0）：說明書請玩家拍 9000 那一檔的四視圖回來，
     AI 要算「這個部件在圖上幾格」得拿那一檔的 s 代進公式——上面那一表只有 3000 與 10000。
     只印、不判。字元圖的 s 是自動反推的，AI 用不到，不印。
     見 開發筆記〈盲測第三回：一兩次就要做好（v1.287.0）〉 */
  const pShown = BP_PANEL.map(t => prow[t]).filter(Boolean);
  if (!isLayers && pShown.length === BP_PANEL.length)
    L.push('  面板 ' + pShown.map(p => p.t + ' → ' + p.n + ' s=' + p.s.toFixed(2)).join('　') +
           '（四視圖拍的那一檔，部件在圖上幾格拿這個 s 算）');

  /* 尺寸、站幾格、配色 */
  const big = rows.filter(r => !r.err).pop();
  if (big) {
    // 寬×高×深（v1.286.0 補上）：盲測時 AI 拿範例的輪廓圖倒推，才確定三個數字是 x×y×z
    L.push('尺寸（寬×高×深）' + big.w + '×' + big.h + '×' + big.d + ' 格' +
           '　最底層 ' + big.floor + ' 格' + (big.floor < 3 ? '⚠' : '✔'));
    if (big.floor < 3) {
      warn('最底層只有 ' + big.floor + ' 格');
      L.push('  修法：整棟只靠 ' + big.floor + ' 格站在地上，那幾格一掉就整棟報廢。'
           + '底下補一層地板或底座（遊戲會自動把最低那層貼到地面，不必自己保證 y=0）。');
    }
    /* 沒超過也印（v1.286.0）：以前只有超過才出現，AI 改完看不出還剩多少餘裕；
       也寫明量的是哪一檔、量了什麼（找尺寸的那幾十次 gen 也算在裡面）。
       修法以前只講「巨大實心量體」，盲測那支 566ms 的病其實是自己寫的 tint 迴圈掃了整個外接方形。 */
    /* 超過預算就再量兩次取最快的：單次量測跟著機器忙不忙飄——盲測時同一份迴圈一版 140ms、
       下一版（迴圈一行沒動）425ms，AI 花了一整版去追一個量測波動。沒超過的就不重量（不多花時間）。 */
    let ms = big.ms, tries = 1;
    while (ms > BP_SLOW_MS && tries < 3) {
      const t0 = Date.now();
      try { genCells(sh, fitScale(sh, big.t)).cells(); } catch (e) { break; }
      ms = Math.min(ms, Date.now() - t0);
      tries++;
    }
    const slow = ms > BP_SLOW_MS;
    big.ms = ms;
    L.push('產生時間 ' + ms + 'ms（' + big.t + ' 塊那一檔，找尺寸＋產一份' + (tries > 1 ? '，量 ' + tries + ' 次取最快' : '') +
           '；預算 ' + BP_SLOW_MS + 'ms）' + (slow ? '⚠' : '✔'));
    if (slow) {
      warn('產一份要 ' + big.ms + 'ms');
      L.push('  修法：換建築時畫面會卡一下。遊戲為了找最接近的尺寸會呼叫 gen 幾十次，gen 裡每一圈迴圈都跟著乘幾十倍。'
           + '最常見的是自己寫的逐格迴圈掃了整個包圍盒（蓋完再逐格重上色、tint 掃整個外接方形）——'
           + '改成只掃看得到的那一面或那一圈；其次是很大的實心量體（裡面看不到的可以挖空）。');
    }
  }
  if (maxC >= sh.pal.length) {
    bad('pal 不夠：用到索引 ' + maxC + '，只有 ' + sh.pal.length + ' 色');
    L.push('✘ 配色：pal 只有 ' + sh.pal.length + ' 色，但格子用到索引 ' + maxC);
    L.push('  修法：pal 至少要 ' + (maxC + 1) + ' 色（索引從 0 算）。');
  } else {
    L.push('配色 ' + sh.pal.length + ' 色，用到最大索引 ' + maxC + ' ✔');
  }

  /* 配色比例（v1.264.0）：產藍圖的 AI 看不到程式，「主色不超過五成五」「有顏色的材質亮度壓在 0.65 以下」
     這兩條它自己量不到——報告是它唯一量得到的地方。量遊戲預設的 3000 那一階。
     **只印數字不示警**：白宮、白瓷碗本來就白，示警只會逼 AI 把白的東西塗成灰褐色。
     只有主色或淺色佔一半以上時多一句話指到說明書的規則。
     **只算露在外面的格子**（六個面至少有一面是空的）：盲測時一杯裝滿的奶茶，杯裡看不到的奶茶
     把主色撐到五成七，照規則怎麼改都改不掉。見 開發筆記〈prompt 拿去盲測（v1.264.0）〉 */
  const mid = rows.find(r => r.t === 3000 && !r.err);
  if (mid && mid.n) {
    const lum = c => (Math.max((c >> 16) & 255, (c >> 8) & 255, c & 255) +
                      Math.min((c >> 16) & 255, (c >> 8) & 255, c & 255)) / 510;
    const key = (x, y, z) => x + ':' + y + ':' + z;
    const all = new Set(mid.cells.map(c => key(c.x, c.y, c.z)));
    const seen = {};
    let nSeen = 0;
    for (const c of mid.cells) {
      if (all.has(key(c.x + 1, c.y, c.z)) && all.has(key(c.x - 1, c.y, c.z)) &&
          all.has(key(c.x, c.y + 1, c.z)) && (c.y === mid.bb.y[0] || all.has(key(c.x, c.y - 1, c.z))) &&
          all.has(key(c.x, c.y, c.z + 1)) && all.has(key(c.x, c.y, c.z - 1))) continue;   // 貼地那一面不算露出來
      seen[c.c] = (seen[c.c] || 0) + 1;
      nSeen++;
    }
    // 「不到 1%」而不是 '<1%'：報告是純文字，e2e 守著裡面不能有 '<'（防 HTML 混進來）
    const pct = k => { const p = k / nSeen * 100; return p > 0 && p < 1 ? '不到 1%' : Math.round(p) + '%'; };
    let top = -1, light = 0;
    const parts = [];
    for (const k of Object.keys(seen).map(Number).sort((a, b) => a - b)) {
      const c = sh.pal[k];
      if (c === undefined) continue;                 // pal 不夠那一條上面已經報過
      if (top < 0 || seen[k] > seen[top]) top = k;
      if (lum(c) > 0.75) light += seen[k];
      parts.push('pal[' + k + '] ' + pct(seen[k]) + ' 亮度 ' + lum(c).toFixed(2));
    }
    if (top >= 0) {
      const topShare = seen[top] / nSeen, lightShare = light / nSeen;
      L.push('配色比例（3000 塊那一階、只算露在外面的 ' + nSeen + ' 格；亮度 ＝ (RGB 最大 ＋ 最小) ÷ 2 ÷ 255，0 黑～1 白）');
      L.push('  ' + parts.join('　'));
      L.push('  主色 pal[' + top + '] 佔 ' + pct(seen[top]) + '、亮度 ' + lum(sh.pal[top]).toFixed(2) +
             '；淺色（亮度 > 0.75）佔 ' + pct(light));
      if (topShare >= 0.55 || lightShare >= 0.5)
        L.push('  主色或淺色佔了一半以上：受光的那幾面會被光照洗淡（飽和度被吃掉、往灰白靠），蓋出來容易是一團分不出面的顏色。'
             + '見〈藍圖製作說明〉第 5 節的配色規則（本來就白的東西照實物，但要配一階灰與陰影色）。');
    }
  }

  /* 小尺寸的部件存活：大尺寸有、小尺寸沒有的顏色，就是「那個部件整組消失了」。
     這是自訂藍圖最常見也最難自己看出來的錯（作者只看 3000 塊那版）。
     v1.286.0 起在面板最小那一檔（1800）判，不是 300——理由見 BP_PANEL。
     300 那一階也不見的只記一行、不算必修，讓 AI 知道它看得到、但不用為它改。 */
  const small = pMin, last = big;
  if (small && last && last !== small) {
    L.push('');
    L.push(small.t + ' 塊時各色還在不在（面板最小那一檔，跟 ' + last.t + ' 塊比）');
    const parts = [];
    for (const k of Object.keys(last.hist).sort((a, b) => a - b)) {
      const a = last.hist[k], b = small.hist[k] || 0;
      if (b === 0) {
        bad('pal[' + k + '] 在 ' + small.t + ' 塊時整組消失');
        L.push('  ✘ pal[' + k + ']　' + a + ' → 0 格，整組消失');
        L.push('    修法：這一組的尺寸下限太小。用 dim(s, 係數, 下限) 把下限提到 2 以上'
             + '（例如 dim(s, 0.35, 2)），不要寫 Math.round(s * 0.35)。'
             + '這個顏色如果是 tint／paintFrom 點上去的（眼睛、嘴、招牌字），多半是底下那個部件在小尺寸太小、'
             + '點的位置落到別的部件上，或被後面才畫的部件、塗色蓋掉：給那個部件一個尺寸下限，五官與圖案放在最後畫。'
             // v1.288.0 盲測：糰子的亮光（法向量 > 0.9）、縫（|dx| > 0.84R）在 R≈2.7 時一格都不剩
             + '是顏色函式挑出來的（亮光、縫、斑）：門檻用格數（例如離表面 1 格內），不要用半徑的比例——'
             + '小尺寸時那個比例的範圍裡一格都落不進去。');
      } else {
        parts.push('pal[' + k + '] ' + a + '→' + b);
      }
    }
    if (parts.length) L.push('  ✔ ' + parts.join('　'));
    const tiny = rows[0];
    if (tiny && !tiny.err && tiny.t < small.t) {
      const lost = Object.keys(last.hist).filter(k => small.hist[k] && !tiny.hist[k]);
      if (lost.length)
        L.push('  （' + tiny.t + ' 塊那一階 ' + lost.map(k => 'pal[' + k + ']').join('、') +
               ' 不見了——面板選不到 ' + tiny.t + ' 塊，不算必修，不用為它改）');
    }
  }

  /* 連通性：拿遊戲自己的那份判定（26 鄰居、從最低層往上長），報告才跟實際行為一致。
     總量**只報數字不示警**：懸空是允許的，48 座裡倫敦眼有 156 組
     小孤島（輻條與車廂），都是故意的。要判斷「這是意外嗎」只有作者自己知道，
     所以附一句怎麼看，讓 AI 自己對照它畫了什麼。
     例外是「一大組」（BP_FLOAT_BIG，見上面）：四個尺寸加上面板那兩檔（BP_PANEL）裡任一檔
     有一組佔整座 5% 以上，就示警並附修法——那幾乎都是接縫差一格，不是刻意的懸空件。 */
  L.push('');
  try {
    const b = makeBlueprint(idx, BP_TARGETS[BP_TARGETS.length - 1]);
    const float = b.floats.reduce((n, g) => n + g.cells.length, 0);
    const tiny = b.floats.filter(g => g.cells.length <= 4);
    L.push('連通性（' + b.count + ' 格）：連到地面 ' + (b.count - float) + ' 格、懸空 ' +
           float + ' 格' + (b.floats.length ? '（' + b.floats.length + ' 組，其中 ' +
           tiny.length + ' 組只有 ≤4 格）' : ''));
    /* 六個尺寸裡最嚴重的那一組（佔比最高）。只報一次：同一條接縫在好幾檔都會出現。 */
    let worst = null;
    for (const r of rows.concat(BP_PANEL.map(t => prow[t]).filter(Boolean))) {
      if (r.err || !r.n) continue;
      const g = bpFloatGroups(r.cells)[0];
      if (g && g.n / r.n >= BP_FLOAT_BIG && (!worst || g.n / r.n > worst.g.n / worst.r.n))
        worst = { r, g };
    }
    if (worst) {
      const pct = Math.round(worst.g.n / worst.r.n * 100);
      const top = Object.keys(worst.g.hist).sort((a, c) => worst.g.hist[c] - worst.g.hist[a])[0];
      warn('一大組懸空 ' + worst.g.n + ' 格（' + worst.r.t + ' 塊那一檔，佔 ' + pct + '%）');
      L.push('  ⚠ ' + worst.r.t + ' 塊那一檔有一組 ' + worst.g.n + ' 格連不到地面（佔整座 ' + pct +
             '%，在第 ' + worst.g.lo + '～' + worst.g.hi + ' 層，大多是 pal[' + top + ']）');
      L.push('    修法：這麼大一組多半不是故意的懸空件，而是接縫差了一格——兩個部件各自算位置，'
           + '取整之後中間空了一層（常常只在某幾個尺寸出現）。讓上面那一件從下面那一件的頂面往上量'
           + '（y0 ＝ 下面那件的 y0 ＋ 它的高），或往下多疊一層壓住接縫，再看一次這一行還在不在。'
           + '真的是故意懸空的（吊著的招牌、浮在空中的雲）才不必改。');
    }
    if (tiny.length)
      L.push('  懸空本身沒問題（扇葉、吊索、拱下的空洞都是）。但如果你沒有故意做懸空部件，'
           + '那些幾格的小孤島通常是在曲面上用 v.set 點裝飾造成的——改用 tint() / paintFrom()，'
           + '它們只換「已經有積木」的格子。');
  } catch (e) {
    bad('makeBlueprint 出錯');
    L.push('✘ 排施工順序時出錯：' + ((e && e.message) ? e.message : String(e)));
  }

  /* 三視圖輪廓：報告量得出塊數、配色、連通性，就是**量不出「像不像」**，
     而產這份藍圖的 AI 看不到畫面——除非玩家自己截圖貼回去。
     投影成字元圖是唯一能夾在純文字報告裡帶回去的形狀，所以印最大那一階
     （細節最全的那一版）的三個方向。這一段**只給圖不示警**：像不像沒有門檻，
     只有作者拿參考圖對照才判斷得出來，示警只會逼 AI 去修沒壞的東西。 */
  if (big && big.cells.length) {
    const step = Math.max(1, Math.ceil(big.h / BP_ART_H),
                          Math.ceil(big.w / BP_ART_W), Math.ceil(big.d / BP_ART_W));
    L.push('');
    L.push('輪廓（' + big.t + ' 塊那一階，' + big.n + ' 格；一格字元 ＝ ' +
           step + '×' + step + ' 格積木，# 有積木、. 沒有）');
    L.push('  ① 正面（x 往右、y 往上）');
    L.push(...bpArtView(big.cells, 'x', 'y', big.bb, step, false));
    L.push('  ② 側面（z 往右 ＝ 正面往後，y 往上）');
    L.push(...bpArtView(big.cells, 'z', 'y', big.bb, step, false));
    L.push('  ③ 俯視（x 往右、z 往下 ＝ 正面往後）');
    L.push(...bpArtView(big.cells, 'x', 'z', big.bb, step, true));
    /* 「正面在哪一邊」講清楚（v1.160）：報告的數字看不出臉朝哪，弄反了只會在圖上看得到。
       ① 的 +x 印在右邊，那是站在背後的左右——輪廓沒有深度，正面背面本來就只差鏡像，
       但拿參考圖的正面照比左右時不講這件事就會比反。 */
    L.push('  藍圖的正面是 z 小的那一側（臉、五官、大門一律朝 −z，+x 是它自己的右手邊）。');
    L.push('  ① 把 +x 印在右邊 ＝ 站在建築「背後」的左右；輪廓沒有深度，正面與背面只差左右鏡像，'
         + '拿參考圖的正面照比左右時要反過來看。');
    L.push('  這三張圖是報告裡唯一講得出「像不像」的東西：跟參考圖比整體輪廓、'
         + '比各部位的長短與粗細比例（人物與動物先比頭身比），對不上就調係數、補部件。');
  }

  L.push('');
  L.push('結論：' + (fails.length ? fails.length + ' 個必修 ✘' : '沒有必修') +
         '、' + (warns.length ? warns.length + ' 個提醒 ⚠' : '沒有提醒'));
  if (fails.length || warns.length)
    L.push('（把整段複製、貼回產出這份藍圖的 AI，它就知道要改哪裡）');
  return { idx, name: sh.n, fails, warns, text: L.join('\n') };
}

/* node 也要能 require 這支檔來單獨測藍圖 */
if (typeof module !== 'undefined' && module.exports)
  module.exports = { SHAPES, VOX, makeBlueprint, genCells, fitScale, NBR, gkeyOf, customBlueprint,
                     PROP_ALIVE,
                     checkBlueprint, bpIndexOf, BP_TARGETS, BP_PANEL,
                     cleanPaste, bpFileName, importBlueprint,
                     dim, ringOf, rowOf, mirrorX, mirrorZ, stampY, arch, archRow, stairs, hipRoof,
                     boxTaper, windowGrid, lattice, corners4, tubeZ, wheelX,
                     tint, paintFrom, blob, limb, plate, revolve, hash100 };

