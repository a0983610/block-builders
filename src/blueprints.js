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
   本來就可以不給）。訊息一律以「參數錯誤：」開頭，報告靠它挑出對應的修法。 */
const BP_KIND = {
  v: [o => !!o && typeof o.set === 'function' && typeof o.has === 'function', '一個 VOX（第一個參數要傳 v）'],
  n: [o => typeof o === 'number' && Number.isFinite(o), '數字'],
  c: [o => typeof o === 'number' && Number.isFinite(o) && o >= 0, '顏色索引（pal 的第幾個，從 0 算）'],
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
    throw new Error('參數錯誤：' + sig + ' 的 ' + k +
                    (v === undefined ? ' 沒給' : ' 收到 ' + bpShow(v)) + '，要的是數字');
  }
}

/* ── voxel 收集器 ──────────────────────────────────────────
   用 Map 去重，後寫的蓋掉先寫的——很多造型是「先填實心再挖洞」。 */
function VOX() { this.m = new Map(); }
VOX.prototype = {
  constructor: VOX,
  set(x, y, z, c) {
    /* 每一格都會走這裡，所以直接比、不配陣列（bpArgs 那條路只有真的出事時才走）。
       上游哪一支算出 NaN、或忘了給顏色，最後都會流到這裡——擋在這裡等於一次守住全部。 */
    if (!(typeof c === 'number' && c >= 0) || !Number.isFinite(x + y + z))
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
   切成好幾段各挪一格——實測倉庫裡三尊人像（自由女神、獅身人面像、八卦山大佛）的四肢
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
   而那個式子很容易寫歪：內建自由女神的正面衣褶用 (n−1) 當分母、背面用 (n−2) 還補
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
   t 是牆厚（沿 z）。開口總高 = h + (w−1)/2。
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

/* ── 48 座 ────────────────────────────────────────────────
   lo/hi 是尺度參數的可用範圍，makeBlueprint 會在其中找最接近目標積木數的值。
   pal 是這座建築的配色，格子的 c 就是 pal 的索引。 */
const SHAPES = [
{ n: '吉薩金字塔', lo: 6, hi: 40, pal: [0xd9c9a3, 0xc4b189, 0xe8dcbb],
  gen(v, s) {
    const b = Math.round(s) | 1;
    v.pyramid(0, 0, 0, b, 0);
    for (let y = 0; y < b / 2; y += 3) v.box(0, y, 0, b - y * 2, 1, b - y * 2, 1);
    v.box(0, Math.floor(b / 2), 0, 1, 1, 1, 2);
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
{ n: '比薩斜塔', lo: 2.3, hi: 15, pal: [0xf7f2ea, 0xded7ca, 0xad9f8c, 0x3a332a, 0xb5763a, 0xa8382c],
  /* 來源：blueprints/比薩斜塔.js（v1.114 換掉原本那份） */
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
    v.cyl(0, 0, 0, r + 3, 1, 2);
    v.cyl(0, 1, 0, r + 2, 1, 1);

    let curY = 2;

    // 2. 第一層：盲拱與實心厚牆底座
    for (let dy = 0; dy < bH; dy++) {
      const y = curY + dy;
      const ox = getX(y);
      v.cyl(ox, y, 0, r, 1, 1, 1);
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
        vv.box(getX(curY + arcH - 1) + rx, curY + arcH - 1, rz, 1, 1, 1, 2);
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
    v.cyl(getX(curY), curY, 0, belfryR + 1, 1, 2);              // 頂部出簷
    v.cyl(getX(curY + 1), curY + 1, 0, belfryR, 1, 0, 1);      // 頂層矮女兒牆
    v.box(getX(curY + 2), curY + 2, 0, 1, dim(s, 0.35, 2), 1, 2); // 旗桿
    v.box(getX(curY + 2) + 1, curY + 2 + Math.max(0, dim(s, 0.15, 1)), 0, 1, 1, 1, 5); // 旗幟
  } },

{ n: '巴黎凱旋門', lo: 2.2, hi: 15, pal: [0xe2d8c3, 0xb8aa95, 0xf5eee1, 0x948573, 0xcfc1ad, 0xfbf9f4],
  /* 來源：blueprints/巴黎凱旋門.js（v1.66 換掉原本那份） */
  gen(v, s) {
    // 1. 尺度與宏偉比例計算（寬厚雄偉）
    const w = dim(s, 2.95, 13, true);                 // 總面寬（奇數）
    const d = dim(s, 1.65, 7, true);                  // 總縱深（奇數）
    const aw = dim(s, 1.30, 5, true);                 // 主拱門開口寬度（奇數）
    const pierW = Math.max(2, Math.floor((w - aw) / 2)); // 兩側主墩寬度
    const px = Math.round((aw + pierW) / 2);          // 主墩中心 X 座標

    const baseH = dim(s, 0.30, 1);                    // 台基高度
    const archH = dim(s, 1.25, 4);                    // 主拱直柱高度
    const archR = Math.floor(aw / 2);                 // 主拱半圓半徑
    const lowerH = archH + archR + dim(s, 0.45, 2);   // 下層主柱體總高
    const atticH = dim(s, 0.85, 3);                   // 頂部閣樓層高度
    const fz = (d - 1) / 2;                           // 外立面 Z 座標

    // 2. 基座台階與地坪（四平八穩）
    v.box(0, 0, 0, w + 2, baseH, d + 2, 1);
    const stepCount = dim(s, 0.22, 2);
    stairs(v, 0, 0, -Math.round((d + 2) / 2) - stepCount + 1, stepCount, w + 2, 'z', 1);
    stairs(v, 0, 0, Math.round((d + 2) / 2) + stepCount - 1, stepCount, w + 2, '-z', 1);

    // 3. 主體石墩建築體
    v.box(0, baseH, 0, w, lowerH, d, 0);

    // 4. 正面主拱門（貫穿 Z 軸）
    arch(v, 0, baseH, 0, aw, archH, d + 2);

    // 5. 兩側橫向貫通拱（貫穿 X 軸）
    const saw = dim(s, 0.55, 3, true);
    const sah = dim(s, 0.65, 2);
    const sar = Math.floor(saw / 2);
    v.carve(0, baseH, 0, w + 2, sah, saw);
    for (let i = 0; i <= sar; i++) {
      const cutW = Math.max(1, saw - i * 2);
      v.carve(0, baseH + sah + i, 0, w + 2, 1, cutW);
    }

    // 6. 拱腳環狀橫向線腳（Impost Cornice）
    const impostY = baseH + archH;
    mirrorX(v, px, (vv, dx) => {
      mirrorZ(vv, 0, (vvv, dz) => {
        vvv.box(dx, impostY, dz, pierW, 1, d, 2);
      });
    });

    // 7. 拱圈外緣飾邊（Archivolt）
    for (let i = -archR - 1; i <= archR + 1; i++) {
      for (let j = 0; j <= archR + 1; j++) {
        const dist = Math.hypot(i, j);
        if (dist >= archR - 0.2 && dist <= archR + 1.1) {
          const ay = impostY + j;
          mirrorZ(v, fz, (vv, dz) => {
            tint(vv, i, ay, dz, 2);
          });
        }
      }
    }

    // 8. 拱肩勝利女神浮雕（Spandrel Fames）
    const spandrelX = Math.round(aw * 0.48);
    const spandrelY = impostY + Math.round(archR * 0.65);
    mirrorX(v, spandrelX, (vv, dx) => {
      mirrorZ(vv, fz, (vvv, dz) => {
        tint(vvv, dx, spandrelY, dz, 4);
      });
    });

    // 9. 下層巨幅高浮雕群像（立體層次雕塑）
    const scW = Math.max(2, pierW - 1);
    const scH = dim(s, 0.65, 3);
    mirrorX(v, px, (vv, dx) => {
      mirrorZ(vv, fz, (vvv, dz) => {
        const outZ = dz > 0 ? dz + 1 : dz - 1;
        // 浮雕托座底台
        vvv.box(dx, baseH + 1, outZ, scW, 1, 1, 1);
        // 浮雕本體群像（深色基底 + 明亮層次）
        vvv.box(dx, baseH + 2, outZ, scW, scH - 1, 1, 3);
        vvv.box(dx, baseH + 2, outZ, Math.max(1, scW - 1), Math.max(1, Math.round((scH - 1) * 0.7)), 1, 4);
      });
    });

    // 10. 上層戰役浮雕矩形框（Bas-relief Panels）
    const panH = dim(s, 0.35, 1);
    const panY = impostY + archR - panH;
    mirrorX(v, px, (vv, dx) => {
      mirrorZ(vv, fz, (vvv, dz) => {
        const outZ = dz > 0 ? dz + 1 : dz - 1;
        vvv.box(dx, panY, outZ, scW, panH, 1, 4);
      });
    });

    // 11. 宏偉主簷壁飾帶與主簷口（Great Entablature & Cornice）
    const entY = baseH + lowerH;
    v.box(0, entY, 0, w + 1, 1, d + 1, 1);                // 柱頂過樑
    v.box(0, entY + 1, 0, w + 1, dim(s, 0.30, 1), d + 1, 4); // 浮雕飾帶（Frieze）
    const mainCorniceY = entY + 1 + dim(s, 0.30, 1);
    v.box(0, mainCorniceY, 0, w + 3, 1, d + 3, 2);        // 挑出主簷口

    // 12. 閣樓層（Attic）
    const atticY = mainCorniceY + 1;
    v.box(0, atticY, 0, w + 1, atticH, d + 1, 0);

    // 13. 閣樓層 30 座戰役勳章圓盾（Medallions）
    const numShields = Math.max(3, Math.floor(w / 2.8));
    const shieldStep = (w - 2) / Math.max(1, numShields - 1);
    const shieldY = atticY + Math.max(1, Math.floor(atticH * 0.45));
    for (let i = 0; i < numShields; i++) {
      const sx = Math.round(-(w - 2) / 2 + i * shieldStep);
      mirrorZ(v, (d + 1) / 2, (vv, dz) => {
        const outZ = dz > 0 ? dz + 1 : dz - 1;
        vv.box(sx, shieldY, outZ, 1, Math.max(1, dim(s, 0.22, 1)), 1, 5);
      });
    }

    // 14. 頂部冠簷與全景觀景女兒牆（Roof Balustrade）
    const topY = atticY + atticH;
    v.box(0, topY, 0, w + 2, 1, d + 2, 2);                // 頂冠簷口
    v.walls(0, topY + 1, 0, w + 2, 1, d + 2, 1, 1);        // 女兒牆圍欄
    v.box(0, topY + 1, 0, w, 1, d, 0);                    // 頂層步道平台
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

{ n: '自由女神', lo: 2.2, hi: 14.5, pal: [0x5ea890, 0x447d6b, 0x82caa8, 0xc7ab88, 0x806a51, 0xf5c238, 0xd97d25],
  /* 來源：blueprints/自由女神像.js（v1.66 換掉原本那份） */
  gen(v, s) {
    // -------------------------------------------------------------
    // 1. 基座尺寸與建造（新古典花崗岩台基）
    // -------------------------------------------------------------
    const baseW = dim(s, 2.2, 9, true);  // 基座底寬（奇數）
    const baseH = dim(s, 1.4, 5);        // 基座主高度
    
    // 台階基底（兩層向下展開）
    v.box(0, 0, 0, baseW + 4, 1, baseW + 4, 4);
    v.box(0, 1, 0, baseW + 2, 1, baseW + 2, 3);

    // 主台身（縮進石壁 + 四角突出壁柱）
    v.box(0, 2, 0, baseW, baseH, baseW, 3);
    const cornerOff = (baseW - 1) / 2;
    corners4(v, cornerOff, cornerOff, (vv, cx, cz) => {
      vv.box(cx, 2, cz, 1, baseH, 1, 4);
    });

    // 台身腰線裝飾
    const midH = 2 + Math.round(baseH * 0.5);
    v.box(0, midH, 0, baseW + 1, 1, baseW + 1, 4);

    // 基座頂簷口與觀景台圍欄
    const topY = 2 + baseH;
    v.box(0, topY, 0, baseW + 2, 1, baseW + 2, 4);
    v.box(0, topY + 1, 0, baseW, 1, baseW, 3);
    v.walls(0, topY + 2, 0, baseW, 1, baseW, 4, 1);

    // -------------------------------------------------------------
    // 2. 雕像踏板與腳部
    // -------------------------------------------------------------
    const statueBaseY = topY + 2;
    const plinthW = dim(s, 1.4, 5, true);
    const plinthD = dim(s, 1.2, 5, true);
    v.box(0, statueBaseY, 0, plinthW, 1, plinthD, 1);

    // -------------------------------------------------------------
    // 3. 羅馬長袍與軀幹（下厚上斂、立體布褶）
    // -------------------------------------------------------------
    const robeY = statueBaseY + 1;
    const bodyW = dim(s, 1.1, 5, true);
    const bodyD = dim(s, 0.95, 4);
    const bodyH = dim(s, 2.6, 9);

    // 長袍主體量體（下層微張、中層厚實）
    const robeLowH = Math.round(bodyH * 0.55);
    v.taper(0, robeY, 0, (bodyW + 2) / 2, bodyW / 2, robeLowH, 0);
    v.box(0, robeY + robeLowH, 0, bodyW, bodyH - robeLowH, bodyD, 0);

    // 左腳前邁意象（長袍左前方微微隆起突出）
    const legX = Math.round(bodyW * 0.22);
    v.box(legX, robeY, Math.round(bodyD * 0.45), Math.max(1, Math.round(bodyW * 0.28)), Math.round(robeLowH * 0.85), 1, 0);
    v.box(legX, robeY, Math.round(bodyD * 0.45) + 1, Math.max(1, Math.round(bodyW * 0.2)), 1, 1, 2);

    // 垂直衣褶條紋（正面與側面加強立體光影）
    const foldCount = dim(s, 0.45, 3);
    const foldSpan = (bodyW - 1) / 2;
    for (let i = 0; i < foldCount; i++) {
      const fx = Math.round(-foldSpan + i * ((foldSpan * 2) / Math.max(1, foldCount - 1)));
      // 正面衣褶（深色暗溝與亮色凸稜交錯）
      v.box(fx, robeY + 1, Math.round(bodyD / 2), 1, robeLowH - 1, 1, (i % 2 === 0) ? 1 : 2);
    }
    // 背面衣褶
    for (let i = 0; i < foldCount - 1; i++) {
      const bx = Math.round(-foldSpan + 0.5 + i * (foldSpan / Math.max(1, foldCount - 2)));
      v.box(bx, robeY + 1, -Math.round(bodyD / 2), 1, robeLowH, 1, 1);
    }

    // 披肩布幔（從右胸下斜向左肩覆蓋，做出立體厚度）
    const chestY = robeY + bodyH - dim(s, 0.75, 3);
    const sashH = dim(s, 0.45, 2);
    v.box(0, chestY, 0, bodyW + 1, sashH, bodyD + 1, 0);
    v.box(-Math.round(bodyW * 0.2), chestY - 1, Math.round(bodyD * 0.4), Math.max(1, Math.round(bodyW * 0.4)), 1, 1, 2);
    v.box(Math.round(bodyW * 0.25), chestY + sashH, 0, Math.max(1, Math.round(bodyW * 0.35)), 1, bodyD + 1, 2);

    // -------------------------------------------------------------
    // 4. 左手與獨立宣言法典
    // -------------------------------------------------------------
    const leftArmX = Math.round(bodyW * 0.55);
    const tabletY = robeY + Math.round(bodyH * 0.42);
    const tabW = dim(s, 0.45, 2);
    const tabH = dim(s, 0.85, 3);
    const tabD = dim(s, 0.35, 1);

    // 左上臂斜下至前臂彎曲
    v.box(leftArmX, chestY - 1, 0, 1, Math.max(2, chestY - tabletY), 2, 0);
    // 獨立宣言法典（斜立於身側的亮色石板）
    v.box(leftArmX + 1, tabletY, Math.round(bodyD * 0.15), tabD, tabH, tabW, 2);
    v.box(leftArmX + 1, tabletY, Math.round(bodyD * 0.15), 1, tabH, 1, 0); // 握住法典的手指

    // -------------------------------------------------------------
    // 5. 右肩、高舉的右臂與自由火炬
    // -------------------------------------------------------------
    const rightArmX = -Math.round(bodyW * 0.52);
    const shoulderY = chestY + 1;
    const torchArmTopY = robeY + bodyH + dim(s, 1.45, 5);
    const armThick = Math.max(1, Math.round(dim(s, 0.35, 2) * 0.6));

    // 右肩往外擴展並斜向上
    v.box(rightArmX, shoulderY, 0, armThick + 1, 2, armThick + 1, 0);
    // 右前臂筆直擎天
    v.box(rightArmX, shoulderY + 2, 0, armThick, torchArmTopY - (shoulderY + 2), armThick, 0);
    // 右手掌
    v.box(rightArmX, torchArmTopY, 0, armThick + 1, 1, armThick + 1, 2);

    // 火炬手柄
    const torchBaseY = torchArmTopY + 1;
    const torchStemH = dim(s, 0.45, 2);
    v.cyl(rightArmX, torchBaseY, 0, 0.8, torchStemH, 1);
    
    // 火炬托盤與金屬杯口（向外擴張）
    const trayY = torchBaseY + torchStemH;
    const trayR = dim(s, 0.5, 2);
    v.cyl(rightArmX, trayY, 0, trayR, 1, 6);
    v.cyl(rightArmX, trayY + 1, 0, trayR + 0.4, 1, 5, 1);

    // 金黃火焰（雙層躍動收尖造型）
    const flameY = trayY + 1;
    const flameH = dim(s, 0.85, 3);
    v.taper(rightArmX, flameY, 0, trayR - 0.2, 0.2, flameH, 5);
    v.box(rightArmX, flameY + 1, 0, 1, Math.max(1, flameH - 2), 1, 6); // 火焰核心深金色

    // -------------------------------------------------------------
    // 6. 頸部、頭部、垂髮與七芒冠冕
    // -------------------------------------------------------------
    const headY = robeY + bodyH;
    const headR = dim(s, 0.45, 2);

    // 頸部
    v.cyl(0, headY, 0, Math.max(1, headR - 1), 1, 0);

    // 垂在雙肩的希臘波浪長髮
    mirrorX(v, headR, (vv, hx) => {
      vv.box(hx, headY - 1, -Math.round(headR * 0.4), 1, 2, Math.max(1, headR), 1);
    });

    // 雕刻頭部與面容輪廓
    blob(v, 0, headY + 1 + headR * 0.6, 0, headR, headR * 1.15, headR * 0.9, 0);
    // 面部立體輪廓（鼻樑微隆）
    v.box(0, headY + 1 + Math.round(headR * 0.5), Math.round(headR * 0.85), 1, Math.max(1, headR - 1), 1, 2);

    // 冠冕基座圓環（Diadem）
    const crownY = headY + 1 + Math.round(headR * 0.85);
    v.cyl(0, crownY, 0, headR + 0.6, 1, 2, 1);
    // 冠冕上的小窗孔（暗色點綴）
    paintFrom(v, 0, crownY, Math.round(headR + 1), 0, 0, -1, 2, 1);

    // 七道光芒刺（放射狀立體尖芒）
    const spikeLen = dim(s, 0.6, 3);
    const spikeAngles = [-120, -80, -40, 0, 40, 80, 120];
    for (let deg of spikeAngles) {
      const rad = (deg * Math.PI) / 180;
      const sx = Math.sin(rad) * (headR + spikeLen);
      const sz = -Math.cos(rad) * (headR + spikeLen) * 0.55;
      v.line(0, crownY, 0, Math.round(sx), crownY + 1 + Math.max(1, Math.round(spikeLen * 0.35)), Math.round(sz), 2);
    }
  } },
{ n: '倫敦大笨鐘', lo: 2, hi: 18, pal: [0xcfc3a5, 0x7d6f5c, 0x2d3a45, 0xf5f6f8, 0x1b324f, 0xd9a838],
  /* 來源：blueprints/大笨鐘.js（v1.66 換掉原本那份） */
  gen(v, s) {
    // -------------------------------------------------------------
    // 1. 基座與修長主塔身（Base & Main Shaft）
    // -------------------------------------------------------------
    const tw = dim(s, 0.88, 5, true);      // 塔身寬度（取奇數保證對稱置中）
    const th = dim(s, 3.90, 16);          // 塔身高聳修長

    // 雙層階梯基座
    v.box(0, 0, 0, tw + 4, 1, tw + 4, 1);
    v.box(0, 1, 0, tw + 2, 1, tw + 2, 0);

    // 塔身中空四面牆
    v.walls(0, 2, 0, tw, th, tw, 0, 1);

    // 四角垂直扶壁立柱（貫穿整座塔身）
    const cOff = (tw - 1) / 2;
    corners4(v, cOff, cOff, (vv, cx, cz) => vv.box(cx, 2, cz, 1, th, 1, 1));

    // 塔身 4 段式水平石線腳
    const nTiers = 4;
    for (let ti = 1; ti < nTiers; ti++) {
      const by = 2 + Math.round((th * ti) / nTiers);
      v.box(0, by, 0, tw + 2, 1, tw + 2, 1);
    }

    // 四立面的垂直哥德細長條窗櫺
    const tierH = Math.floor(th / nTiers);
    const winH = Math.max(2, tierH - 2);
    const ribOff = Math.max(1, Math.floor((tw - 3) / 4));

    for (let ti = 0; ti < nTiers; ti++) {
      const yStart = 2 + ti * tierH + 1;
      mirrorZ(v, (tw - 1) / 2, (vv, fz) => {
        mirrorX(vv, ribOff, (vvv, fx) => vvv.box(fx, yStart, fz, 1, winH, 1, 1));
      });
      mirrorX(v, (tw - 1) / 2, (vv, fx) => {
        mirrorZ(vv, ribOff, (vvv, fz) => vvv.box(fx, yStart, fz, 1, winH, 1, 1));
      });
    }

    // 鐘盤下方的金色紋章橫帶
    const friezeY = 2 + th;
    v.box(0, friezeY, 0, tw + 2, 1, tw + 2, 5);

    // -------------------------------------------------------------
    // 2. 四面大時鐘層（Clock Stage & Dials）
    // -------------------------------------------------------------
    const cw = tw + 2;                     // 鐘樓段外擴一圈
    const ch = dim(s, 1.15, 7, true);      // 鐘樓段高度（奇數）
    const clockY = friezeY + 1;
    v.walls(0, clockY, 0, cw, ch, cw, 0, 1);

    // 鐘樓四角鍍金角柱
    const ccOff = (cw - 1) / 2;
    corners4(v, ccOff, ccOff, (vv, cx, cz) => vv.box(cx, clockY, cz, 1, ch, 1, 5));

    // 四面鐘盤
    const cr = Math.max(1, Math.floor((cw - 3) / 2));
    const cyMid = clockY + Math.floor(ch / 2);

    // 正面與背面鐘盤 (Z 軸)
    mirrorZ(v, ccOff, (vv, fz) => {
      for (let dx = -cr - 1; dx <= cr + 1; dx++) {
        for (let dy = -cr - 1; dy <= cr + 1; dy++) {
          const dist = Math.hypot(dx, dy);
          if (Math.abs(dx) === cr + 1 || Math.abs(dy) === cr + 1) {
            vv.set(dx, cyMid + dy, fz, 5); // 金色方框
          } else if (dist <= cr + 0.5) {
            if (dist >= cr - 0.4) {
              vv.set(dx, cyMid + dy, fz, 4); // 普魯士藍刻度圈
            } else {
              vv.set(dx, cyMid + dy, fz, 3); // 乳白玻璃面
            }
          }
        }
      }
      vv.set(0, cyMid, fz, 4);
      vv.set(0, cyMid + 1, fz, 4); // 分針
      if (cr >= 2) vv.set(1, cyMid, fz, 4); // 時針

      // 鐘盤上方金色山花飾 (Pediment)
      if (cr >= 2) {
        vv.set(0, cyMid + cr + 2, fz, 5);
        vv.set(-1, cyMid + cr + 1, fz, 5);
        vv.set(1, cyMid + cr + 1, fz, 5);
      }
    });

    // 左右兩面鐘盤 (X 軸)
    mirrorX(v, ccOff, (vv, fx) => {
      for (let dz = -cr - 1; dz <= cr + 1; dz++) {
        for (let dy = -cr - 1; dy <= cr + 1; dy++) {
          const dist = Math.hypot(dz, dy);
          if (Math.abs(dz) === cr + 1 || Math.abs(dy) === cr + 1) {
            vv.set(fx, cyMid + dy, dz, 5);
          } else if (dist <= cr + 0.5) {
            if (dist >= cr - 0.4) {
              vv.set(fx, cyMid + dy, dz, 4);
            } else {
              vv.set(fx, cyMid + dy, dz, 3);
            }
          }
        }
      }
      vv.set(fx, cyMid, 0, 4);
      vv.set(fx, cyMid + 1, 0, 4);
      if (cr >= 2) vv.set(fx, cyMid, 1, 4);

      if (cr >= 2) {
        vv.set(fx, cyMid + cr + 2, 0, 5);
        vv.set(fx, cyMid + cr + 1, -1, 5);
        vv.set(fx, cyMid + cr + 1, 1, 5);
      }
    });

    // -------------------------------------------------------------
    // 3. 鐘室百葉開口與四角小尖塔（Belfry & Pinnacles）
    // -------------------------------------------------------------
    const belfryY = clockY + ch;
    v.box(0, belfryY, 0, cw + 2, 1, cw + 2, 5); // 金色簷口陽台

    const bwTop = tw;
    const bhTop = dim(s, 0.70, 4);
    v.walls(0, belfryY + 1, 0, bwTop, bhTop, bwTop, 0, 1);

    // 四面鐘室拱形百葉排音窗
    let bArchW = Math.max(1, bwTop - 4);
    if (bArchW % 2 === 0) bArchW += 1;
    const bArchH = Math.max(2, bhTop - 2);
    const belfryFace = (bwTop - 1) / 2;

    mirrorZ(v, belfryFace, (vv, dz) => vv.carve(0, belfryY + 2, dz, bArchW, bArchH, 1));
    mirrorX(v, belfryFace, (vv, dx) => vv.carve(dx, belfryY + 2, 0, 1, bArchH, bArchW));

    // 鐘室頂部石壓頂
    const pinY = belfryY + 1 + bhTop;
    v.box(0, pinY, 0, bwTop + 2, 1, bwTop + 2, 1);

    // 四角高聳哥德小尖塔（Pinnacles）
    const pOff = (bwTop + 1) / 2;
    const pinH = dim(s, 0.65, 3);
    corners4(v, pOff, pOff, (vv, px, pz) => {
      vv.box(px, pinY + 1, pz, 1, pinH, 1, 1);
      vv.box(px, pinY + 1 + pinH, pz, 1, 1, 1, 5); // 塔頂金飾
    });

    // -------------------------------------------------------------
    // 4. 陡斜四坡屋頂、艾爾頓燈室與中央尖塔（Spire）
    // -------------------------------------------------------------
    const spireBaseY = pinY + 1;
    const roofW = bwTop;
    const roofH1 = dim(s, 0.85, 4);

    // 陡斜四坡屋頂（全奇數寬度保證對稱，並帶金色折脊）
    for (let step = 0; step < roofH1; step++) {
      const t = step / Math.max(1, roofH1 - 1);
      let curW = Math.max(3, Math.round(roofW - t * (roofW - 3)));
      if (curW % 2 === 0) curW -= 1;
      v.box(0, spireBaseY + step, 0, curW, 1, curW, 2);

      const hrOff = (curW - 1) / 2;
      corners4(v, hrOff, hrOff, (vv, rx, rz) => vv.set(rx, spireBaseY + step, rz, 5));
    }

    // 艾爾頓燈室（Ayrton Light，開會時發光的頂部燈塔）
    const lanternY = spireBaseY + roofH1;
    const lanW = Math.max(3, dim(s, 0.35, 3, true));
    const lanH = dim(s, 0.35, 2);
    v.box(0, lanternY, 0, lanW, lanH, lanW, 5); // 金色窗框
    v.box(0, lanternY, 0, Math.max(1, lanW - 2), lanH, Math.max(1, lanW - 2), 3); // 內部白色發光體

    // 上部修長尖針塔頂（嚴格奇數收縮置中）
    const spireTopY = lanternY + lanH;
    const spireH = dim(s, 1.25, 5);
    for (let st = 0; st < spireH; st++) {
      const t = st / Math.max(1, spireH - 1);
      let sw = Math.max(1, Math.round(lanW - t * (lanW - 1)));
      if (sw % 2 === 0) sw -= 1;
      const sc = (st >= spireH - 2) ? 5 : 2;
      v.box(0, spireTopY + st, 0, sw, 1, sw, sc);
    }

    // 塔尖十字飾（Finial & Cross）
    const tipY = spireTopY + spireH;
    v.box(0, tipY, 0, 1, 2, 1, 5);
    v.box(0, tipY + 1, 0, 3, 1, 1, 5);
  } },
{ n: '泰姬瑪哈陵', lo: 2.2, hi: 15.5, pal: [0xf5f3ec, 0xd6d0c2, 0x943b32, 0x1e242b, 0xcca53d, 0xe4dfd3],
  /* 來源：blueprints/泰姬瑪哈陵.js（v1.114 換掉原本那份）。dim 的下限一律乘 0.7（17 處）：
     原稿最小 2492 塊，面板的 1800 按下去等於沒反應（跟 v1.66 的新天鵝堡、帕德嫩同一個修法，
     下限撐著的時候調 lo 沒用）。3000／9000 那兩檔一格都沒動 */
  gen(v, s) {
    // 1. 關鍵比例係數
    const baseW = dim(s, 4.6, 15, true);   // 紅砂岩大基座寬度（奇數，確保四塔有足夠空間）
    const baseH = dim(s, 0.45, 1);         // 紅砂岩基座高度
    const plinthW = dim(s, 3.4, 11, true); // 大理石次基座寬度
    const mainW = dim(s, 2.5, 8, true);   // 陵墓主體寬度（奇數）
    const mainH = dim(s, 1.8, 5);          // 陵墓主牆高
    const minarOff = Math.round((baseW - 1) / 2) - 2; // 宣禮塔中心偏移
    const minarH = dim(s, 3.8, 10);        // 宣禮塔高度（高聳修長）

    // 2. 基座層：紅砂岩大台基 + 白色大理石高台基
    v.box(0, 0, 0, baseW, baseH, baseW, 2);
    v.box(0, baseH, 0, plinthW, 1, plinthW, 1);

    // 3. 陵墓主體（八角切角大理石殿堂）
    const bodyY = baseH + 1;
    v.walls(0, bodyY, 0, mainW, mainH, mainW, 0, 1);
    
    // 四角切角厚實化
    const cornerD = (mainW - 1) / 2;
    corners4(v, cornerD, cornerD, (vv, x, z) => {
      vv.box(x, bodyY, z, 2, mainH, 2, 0);
    });

    // 4. 四面中央突出的門廳（Pishtaq 門框高出屋頂）與伊萬大拱門（Iwan）
    const portalW = dim(s, 1.1, 4, true);
    const portalH = mainH + 1; // 門框略高出屋脊，呈現經典伊斯蘭正立面
    const archW = dim(s, 0.7, 2, true);
    const archH = dim(s, 0.9, 3);

    // 正背面 (±z)
    mirrorZ(v, cornerD, (vv, dz) => {
      const zIn = dz > 0 ? dz - 1 : dz + 1;
      // 凸出的白色外框
      vv.box(0, bodyY, dz, portalW, portalH, 1, 0);
      // 中央深凹拱門
      arch(vv, 0, bodyY, dz, archW, archH, 1, 1);
      vv.box(0, bodyY, zIn, archW - 2, archH + 1, 1, 3);
      // 左右兩側的上下雙層小拱龕（Pishtaq 側翼特徵）
      const sideOff = Math.round((mainW - 1) / 2 - 1);
      if (sideOff > (portalW - 1) / 2) {
        mirrorX(vv, sideOff, (vvv, sx) => {
          vvv.box(sx, bodyY + 1, dz, 1, 2, 1, 3);
          vvv.box(sx, bodyY + mainH - 3, dz, 1, 2, 1, 3);
        });
      }
    });

    // 左右側面 (±x)
    mirrorX(v, cornerD, (vv, dx) => {
      const xIn = dx > 0 ? dx - 1 : dx + 1;
      vv.box(dx, bodyY, 0, 1, portalH, portalW, 0);
      vv.carve(dx, bodyY, 0, 1, archH, archW);
      vv.carve(dx, bodyY + archH, 0, 1, 1, Math.max(1, archW - 2));
      vv.box(xIn, bodyY, 0, 1, archH + 1, archW - 2, 3);
      const sideOff = Math.round((mainW - 1) / 2 - 1);
      if (sideOff > (portalW - 1) / 2) {
        mirrorZ(vv, sideOff, (vvv, sz) => {
          vvv.box(dx, bodyY + 1, sz, 1, 2, 1, 3);
          vvv.box(dx, bodyY + mainH - 3, sz, 1, 2, 1, 3);
        });
      }
    });

    // 5. 屋頂平台與四角小細尖塔（Guldastas）
    const roofY = bodyY + mainH;
    v.box(0, roofY, 0, mainW, 1, mainW, 1);
    corners4(v, cornerD, cornerD, (vv, gx, gz) => {
      vv.box(gx, roofY + 1, gz, 1, dim(s, 0.45, 1), 1, 4);
    });

    // 6. 中央巨大球形洋蔥大穹頂（圓柱高鼓座 + 飽滿球形洋蔥 + 金色長尖頂）
    const drumR = dim(s, 0.75, 2);
    const drumH = dim(s, 0.5, 1);
    const domeR = drumR + 1.2;
    const domeH = dim(s, 2.0, 5);

    // 圓柱形鼓座
    v.cyl(0, roofY + 1, 0, drumR, drumH, 0, 1);
    v.cyl(0, roofY + drumH, 0, drumR + 0.5, 1, 1);
    // 巨大球形洋蔥頂
    v.onion(0, roofY + 1 + drumH, 0, domeR, domeH, 0);
    // 金色長尖頂飾（蓮花托座 + 新月長針）
    const finialY = roofY + 1 + drumH + domeH;
    const finialH = dim(s, 0.7, 2);
    v.box(0, finialY, 0, 1, finialH, 1, 4);
    v.box(0, finialY + 1, 0, 3, 1, 1, 4);

    // 7. 四座角部八角涼亭（Chattris，獨立架空圓頂亭）
    const chatOff = Math.round(mainW * 0.36);
    const chatR = Math.max(1.1, s * 0.16);
    const chatH = dim(s, 0.4, 1);
    corners4(v, chatOff, chatOff, (vv, cx, cz) => {
      // 涼亭基座與四柱架空
      vv.box(cx, roofY + 1, cz, 3, 1, 3, 1);
      vv.box(cx - 1, roofY + 2, cz - 1, 1, chatH, 1, 0);
      vv.box(cx + 1, roofY + 2, cz - 1, 1, chatH, 1, 0);
      vv.box(cx - 1, roofY + 2, cz + 1, 1, chatH, 1, 0);
      vv.box(cx + 1, roofY + 2, cz + 1, 1, chatH, 1, 0);
      // 涼亭簷口與小圓頂
      const chatCapY = roofY + 2 + chatH;
      vv.box(cx, chatCapY, cz, 3, 1, 3, 1);
      vv.dome(cx, chatCapY + 1, cz, chatR, 5, 0.9);
      vv.box(cx, chatCapY + 1 + Math.round(chatR), cz, 1, 1, 1, 4);
    });

    // 8. 四角高聳獨立宣禮塔（三段漸縮 + 雙層外挑環形陽台 + 頂部涼亭頂）
    const minarR = Math.max(0.9, s * 0.11);
    corners4(v, minarOff, minarOff, (vv, mx, mz) => {
      // 八角形底座
      vv.box(mx, 0, mz, 3, baseH + 1, 3, 2);
      // 塔身第一段
      const seg1 = Math.round(minarH * 0.36);
      vv.taper(mx, baseH + 1, mz, minarR + 0.4, minarR + 0.25, seg1, 0);
      vv.cyl(mx, baseH + 1 + seg1, mz, minarR + 0.7, 1, 1); // 第一層陽台
      // 塔身第二段
      const seg2 = Math.round(minarH * 0.33);
      vv.taper(mx, baseH + 1 + seg1 + 1, mz, minarR + 0.25, minarR + 0.1, seg2, 0);
      vv.cyl(mx, baseH + 1 + seg1 + 1 + seg2, mz, minarR + 0.6, 1, 1); // 第二層陽台
      // 塔身第三段
      const seg3 = Math.max(2, minarH - seg1 - seg2 - 2);
      const seg3Y = baseH + 1 + seg1 + 1 + seg2 + 1;
      vv.cyl(mx, seg3Y, mz, minarR + 0.1, seg3, 0);
      // 塔頂八角觀景亭與圓頂
      const topY = seg3Y + seg3;
      vv.cyl(mx, topY, mz, minarR + 0.8, 1, 1); // 頂層平台
      vv.box(mx, topY + 1, mz, 1, 1, 1, 0);    // 涼亭柱
      vv.dome(mx, topY + 2, mz, minarR + 0.3, 5, 0.85); // 塔頂小穹頂
      vv.box(mx, topY + 2 + Math.round(minarR + 0.3), mz, 1, 1, 1, 4); // 金頂
    });

    // 9. 正面紅砂岩迎賓台階
    const stairSteps = dim(s, 0.35, 1);
    stairs(v, 0, 0, Math.round(baseW / 2) + stairSteps - 1, stairSteps, dim(s, 0.9, 4, true), '-z', 2);
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

{ n: '日本姬路城', lo: 2.2, hi: 14.0, pal: [0xf7f8fa, 0x383d45, 0x686259, 0x22252a, 0xd4a23b, 0x4c3d30],
  /* 來源：AgentData/blueprints/姬路城.js（v1.143 換掉原本那份）。dim 的下限一律乘 0.8（32 處）：原稿最小 2734 塊，面板的 1800 按下去等於沒反應
     （跟 v1.114 的泰姬瑪哈陵同一個修法，下限撐著的時候調 lo 沒用）。改完最小 1712、
     1800 那檔 1712、3000 那檔從 2752 變 3074（更準），9000 那檔一格沒動（9174） */
  gen(v, s) {
    // 基礎寬深（加寬主體，降低層高，呈現沉穩壯觀的城堡比例）
    const bW = dim(s, 3.2, 12, true);
    const bD = dim(s, 2.6, 10, true);
    const stoneH = dim(s, 0.8, 2);

    // 1. 正確的「扇之勾配」石垣（底部最寬，向上逐層收縮）
    for (let y = 0; y < stoneH; y++) {
      const margin = (stoneH - 1 - y) * 2;
      // 石垣涵蓋主天守與小天守區域，避免小天守懸空
      v.box(dim(s, 0.4, 2), y, 0, bW + margin + dim(s, 1.2, 5), 1, bD + margin + 4, 2);
    }
    const baseY = stoneH;

    // === 大天守（主體） ===
    // 2. 第一層（大入母屋層）
    const f1W = dim(s, 2.2, 9, true);
    const f1D = dim(s, 1.8, 7, true);
    const f1H = dim(s, 0.65, 2);
    v.walls(0, baseY, 0, f1W, f1H, f1D, 0, 1);

    // 大手門（正門）與射擊孔
    const faceZ1 = -Math.round((f1D - 1) / 2);
    const doorW = dim(s, 0.35, 2, true);
    const doorH = dim(s, 0.45, 2);
    arch(v, 0, baseY, faceZ1, doorW, doorH, 1, 5);

    // 一層正面與側面格子窗（狹間）
    mirrorX(v, Math.round(f1W * 0.32), (vv, dx) => {
      tint(vv, dx, baseY + 1, faceZ1, 3);
      tint(vv, dx, baseY + 2, faceZ1, 3);
    });
    mirrorX(v, (f1W - 1) / 2, (vv, dx) => {
      windowGrid(vv, { x: dx, y: baseY + 1, z: 0, cols: 2, rows: 1, stepX: dim(s, 0.6, 2), w: 1, h: 2, c: 3, axis: 'z' });
    });

    // 一層大屋簷（四坡展開）
    const e1Y = baseY + f1H;
    v.eave(0, e1Y, 0, f1W + 4, f1D + 4, 1, 1);
    hipRoof(v, 0, e1Y + 1, 0, f1W + 2, f1D + 2, 1);

    // 3. 第二層（巨大千鳥破風層）
    const f2W = dim(s, 1.7, 7, true);
    const f2D = dim(s, 1.4, 6, true);
    const f2H = dim(s, 0.65, 2);
    const f2Y = e1Y + 2;
    v.walls(0, f2Y, 0, f2W, f2H, f2D, 0, 1);

    const faceZ2 = -Math.round((f2D - 1) / 2);
    // 正面立體千鳥破風（三角形大山牆突出簷面）
    const gW = dim(s, 0.75, 4, true);
    v.gable(0, f2Y, faceZ2 - 1, gW, 2, 1);
    v.box(0, f2Y, faceZ2, gW - 2, 1, 1, 0); // 破風內白牆
    tint(v, 0, f2Y + 1, faceZ2 - 1, 4);     // 懸魚金飾

    // 二層窗戶
    windowGrid(v, { x: 0, y: f2Y + 1, z: faceZ2, cols: 2, rows: 1, stepX: dim(s, 0.6, 2), w: 1, h: 1, c: 3, axis: 'x' });

    // 二層出簷
    const e2Y = f2Y + f2H;
    v.eave(0, e2Y, 0, f2W + 4, f2D + 4, 1, 1);
    hipRoof(v, 0, e2Y + 1, 0, f2W + 2, f2D + 2, 1);

    // 4. 第三層（弓形唐破風層）
    const f3W = dim(s, 1.3, 6, true);
    const f3D = dim(s, 1.1, 4, true);
    const f3H = dim(s, 0.60, 2);
    const f3Y = e2Y + 2;
    v.walls(0, f3Y, 0, f3W, f3H, f3D, 0, 1);

    const faceZ3 = -Math.round((f3D - 1) / 2);
    // 圓弧唐破風突出
    v.box(0, f3Y + f3H - 1, faceZ3 - 1, dim(s, 0.55, 2, true), 1, 2, 1);
    tint(v, 0, f3Y + f3H, faceZ3 - 1, 4); // 唐破風頂部金飾

    // 三層出簷
    const e3Y = f3Y + f3H;
    v.eave(0, e3Y, 0, f3W + 4, f3D + 4, 1, 1);
    hipRoof(v, 0, e3Y + 1, 0, f3W + 2, f3D + 2, 1);

    // 5. 第四層（頂層望樓與入母屋頂）
    const f4W = dim(s, 0.95, 4, true);
    const f4D = dim(s, 0.85, 4, true);
    const f4H = dim(s, 0.55, 2);
    const f4Y = e3Y + 2;
    v.walls(0, f4Y, 0, f4W, f4H, f4D, 0, 1);

    // 頂層黑色迴廊高欄
    v.box(0, f4Y, 0, f4W + 2, 1, f4D + 2, 3);
    v.carve(0, f4Y, 0, f4W, 1, f4D);

    // 頂部大屋頂
    const topEY = f4Y + f4H;
    v.eave(0, topEY, 0, f4W + 4, f4D + 4, 1, 1);
    hipRoof(v, 0, topEY + 1, 0, f4W + 2, f4D + 2, 1);

    const apexY = topEY + 1 + Math.floor((f4D + 2) / 2);
    const ridgeL = Math.max(3, f4W - 1);
    v.box(0, apexY, 0, ridgeL, 1, 1, 1); // 頂脊

    // 6. 頂飾：南北/東西雙大金鯱瓦
    const scH = dim(s, 0.25, 2);
    mirrorX(v, Math.round((ridgeL - 1) / 2), (vv, dx) => {
      vv.box(dx, apexY + 1, 0, 1, scH, 1, 4);
      vv.set(dx > 0 ? dx - 1 : dx + 1, apexY + scH, 0, 4);
    });

    // === 連立式小天守群（乾小天守 / 西小天守 + 渡櫓） ===
    // 7. 西小天守（座落於延伸石垣上，不懸空）
    const subW = dim(s, 0.9, 4, true);
    const subD = dim(s, 0.9, 4, true);
    const subH = dim(s, 0.9, 2);
    const subX = Math.round((f1W + subW) / 2) + 1;
    const subZ = 0;

    v.walls(subX, baseY, subZ, subW, subH, subD, 0, 1);
    const subEY = baseY + subH;
    v.eave(subX, subEY, subZ, subW + 2, subD + 2, 1, 1);
    hipRoof(v, subX, subEY + 1, subZ, subW, subD, 1);

    // 小天守頂部小望樓
    const subTopH = dim(s, 0.45, 2);
    v.walls(subX, subEY + 2, subZ, subW - 2, subTopH, subD - 2, 0, 1);
    v.eave(subX, subEY + 2 + subTopH, subZ, subW, subD, 1, 1);
    hipRoof(v, subX, subEY + 3 + subTopH, subZ, subW - 2, subD - 2, 1);

    // 8. 渡櫓（走廊）
    const corrW = Math.max(1, subX - (f1W - 1) / 2 - (subW - 1) / 2);
    const corrX = Math.round(((f1W - 1) / 2 + subX - (subW - 1) / 2) / 2);
    v.box(corrX, baseY, subZ, corrW, dim(s, 0.5, 2), 3, 0);
    v.eave(corrX, baseY + dim(s, 0.5, 2), subZ, corrW + 2, 5, 1, 1);

    // 9. 正面登城石階
    const stN = dim(s, 0.25, 2);
    stairs(v, 0, 0, faceZ1 - stN - (stoneH - 1) * 2 - 1, stN + stoneH, dim(s, 0.6, 2, true), 'z', 2);
  } },

{ n: '京都五重塔', lo: 6, hi: 42, pal: [0x8c3b2e, 0x6d2c22, 0x3f4a52, 0xd8c98a],
  gen(v, s) {
    let y = 0, w = Math.round(s * 0.62);
    v.box(0, 0, 0, w + 6, 1, w + 6, 3);
    for (let t = 0; t < 5; t++) {
      const th = Math.max(2, Math.round(s * 0.16));
      v.walls(0, y + 1, 0, w, th, w, t % 2 ? 1 : 0, 1);
      y += 1 + th;
      v.eave(0, y, 0, w + 5, w + 5, 2, 2);
      y += 2; w = Math.max(3, w - 2);
    }
    v.box(0, y, 0, 1, Math.max(3, Math.round(s * 0.28)), 1, 3);   // 相輪
    for (let i = 0; i < 5; i++) v.box(0, y + 1 + i * 2, 0, 3, 1, 3, 3);
  } },

{ n: '帝國大廈', lo: 9, hi: 76, pal: [0xbfb9a8, 0xa39c8c, 0x8b8474, 0xd9d2be],
  gen(v, s) {
    const h = Math.round(s);
    /* 底座要夠寬退縮才看得出來；第一版 0.32 太瘦，整棟像根柱子。
       0.5 又太寬：w 只能是奇數，一跳 2 格乘上五段牆就是 800 塊，目標 3000 只能到 2734。
       0.42 兩邊都顧到——退縮的切法（3/2/2/1 格）沒動，看得出來的階梯還是一樣。 */
    let w = Math.max(7, Math.round(s * 0.42)) | 1, y = 0;
    const steps = [[0.12, 3], [0.26, 2], [0.60, 2], [0.82, 1]];   // 逐段退縮
    for (const [f, cut] of steps) {
      const top = Math.round(h * f);
      v.walls(0, y, 0, w, top - y, w, 0, 2);
      v.box(0, top, 0, w + 1, 1, w + 1, 1);                       // 每段收頭出一圈簷
      y = top + 1; w = Math.max(3, w - cut * 2);
    }
    v.walls(0, y, 0, w, h - y, w, 0, 2);
    v.box(0, h, 0, w + 1, 1, w + 1, 1);
    v.taper(0, h + 1, 0, Math.max(1.6, w * 0.45), 1, Math.max(3, Math.round(h * 0.09)), 2);  // 塔冠
    v.box(0, h + 1 + Math.max(3, Math.round(h * 0.09)), 0, 1, Math.max(3, Math.round(h * 0.11)), 1, 3);
  } },

{ n: '雙子星塔', lo: 8, hi: 62, pal: [0xb9c6d0, 0x93a3b0, 0xdfe7ec],
  gen(v, s) {
    const h = Math.round(s), gap = Math.max(6, Math.round(s * 0.3));
    const r0 = Math.max(3, s * 0.14);
    for (const sx of [-1, 1]) {
      for (let y = 0; y < h; y++) {
        // 上段逐漸收細，最後收成尖塔座
        const t = y < h * 0.72 ? 0 : (y - h * 0.72) / (h * 0.28);
        const r = Math.max(1.2, r0 * (1 - t * 0.72));
        v.cyl(sx * gap, y, 0, r, 1, y % 6 === 0 ? 2 : 0, Math.max(1, r * 0.5));
        if (y % 6 === 0) v.cyl(sx * gap, y, 0, r + 0.7, 1, 2, 1.2);   // 樓層環
      }
      v.box(sx * gap, h, 0, 1, Math.max(4, Math.round(h * 0.16)), 1, 2);   // 尖塔
    }
    const by = Math.round(h * 0.46);                 // 空中天橋：兩層樓板
    for (let x = -gap; x <= gap; x++) for (let z = -1; z <= 1; z++) {
      v.set(x, by, z, 1); v.set(x, by + 3, z, 1);
    }
    for (const x of [-gap, gap]) for (let y = by; y <= by + 3; y++) v.set(x * 0.34, y, 0, 1);
    // 天橋底下的斜撐（第一版誤畫成兩根浮在半空的直柱）
    for (const sx of [-1, 1])
      v.line(sx * gap, by - Math.round(h * 0.12), 0, sx * gap * 0.34, by, 0, 1);
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
{ n: '雪梨歌劇院', lo: 2.2, hi: 15.5, pal: [0xf4efe6, 0x8c7e6d, 0xa89682, 0x2b3d4f, 0x1c1815, 0xdcd3c4],
  /* 來源：blueprints/雪梨歌劇院.js（v1.66 換掉原本那份） */
  gen(v, s) {
    /* 貝殼穹頂繪製函式：
       - cx, cy, cz: 開口底面中心
       - sw: 開口半寬
       - sh: 拱頂最高點高度
       - slen: 縱向延伸跨距
       - dirZ: 縱向收束方向 (1: 往+z收束; -1: 往-z收束)
       - hasGlass: 是否在開口端生成深色帷幕玻璃與結構窗櫺 */
    function drawSail(v, cx, cy, cz, sw, sh, slen, dirZ, hasGlass) {
      if (sw < 1 || sh < 1 || slen < 1) return;
      const zDir = dirZ >= 0 ? 1 : -1;

      for (let k = 0; k <= slen; k++) {
        const t = k / slen;
        const curZ = cz + k * zDir;
        // 脊線高度向後平滑下垂
        const curH = Math.max(1, Math.round(sh * Math.pow(1 - t, 0.65)));
        // 兩翼寬度向後收束
        const curW = Math.max(1, Math.round(sw * Math.pow(1 - t, 0.82)));

        // 迎海開口帷幕玻璃 (嵌於 k=0, 1 的剖面)
        if (hasGlass && (k === 0 || k === 1)) {
          for (let y = 0; y <= curH; y++) {
            const ry = curH > 0 ? y / curH : 0;
            const span = Math.max(0, Math.round(curW * Math.sqrt(Math.max(0, 1 - Math.pow(ry, 1.2)))));
            for (let x = -span; x <= span; x++) {
              const isFrame = (Math.abs(x) === span) || (y === 0) || (x % 2 === 0 && y % 3 === 0);
              v.set(cx + x, cy + y, curZ, isFrame ? 4 : 3);
            }
          }
        }

        // 貝殼外殼曲面
        for (let y = 0; y <= curH; y++) {
          const ry = curH > 0 ? y / curH : 0;
          const span = Math.max(0, Math.round(curW * Math.sqrt(Math.max(0, 1 - Math.pow(ry, 1.2)))));

          // 兩側外緣肋條與頂脊
          v.set(cx - span, cy + y, curZ, (span === 0 || y >= curH - 1) ? 1 : 0);
          v.set(cx + span, cy + y, curZ, (span === 0 || y >= curH - 1) ? 1 : 0);

          // 頂冠收攏補實
          if (span > 1 && y >= curH - 1) {
            for (let x = -span + 1; x <= span - 1; x++) {
              v.set(cx + x, cy + y, curZ, x === 0 ? 1 : 0);
            }
          }
        }
      }
    }

    // ── 1. 尺寸參數計算 ──────────────────────────────────────────────
    const bw = dim(s, 2.20, 13, true);     // 主台基寬度
    const bd = dim(s, 2.90, 17);           // 主台基長度（收短比例）
    const ph = dim(s, 0.30, 2);            // 台基高度
    const fw = dim(s, 1.40, 9, true);      // 前端延伸觀景步道寬
    const fd = dim(s, 0.30, 2);            // 前端延伸步道長（僅保留階梯緩衝）
    const sy = ph + 1;                     // 貝殼離地高度

    // ── 2. 台基與親水步道系統 ──────────────────────────────────────────
    // 最底層整片護岸（確保底層穩固）
    v.box(0, 0, 0, bw + 2, 1, bd + 2, 1);
    v.box(0, 0, -Math.round((bd + fd) / 2), fw + 2, 1, fd + 2, 1);

    // 主花崗岩基座外牆
    v.walls(0, 1, 0, bw, ph, bd, 2, 2);
    v.walls(0, 1, -Math.round((bd + fd) / 2), fw, ph, fd, 2, 2);

    // 頂部懸挑簷邊與廣場鋪面
    v.box(0, ph, 0, bw + 1, 1, bd + 1, 1);
    v.box(0, ph, 0, bw - 1, 1, bd - 1, 5);
    v.box(0, ph, -Math.round((bd + fd) / 2), fw, 1, fd, 5);

    // 前方海港迎賓階梯
    const stSteps = Math.max(2, ph);
    const frontZ = -Math.round((bd + fd) / 2) - Math.round(fd / 2);
    stairs(v, 0, 0, frontZ - stSteps, stSteps, dim(s, 1.00, 5, true), 'z', 2);

    // 後方陸側階梯
    const rearZ = Math.round(bd / 2);
    stairs(v, 0, 0, rearZ + stSteps, stSteps, dim(s, 1.10, 5, true), '-z', 2);

    // ── 3. 音樂廳貝殼群 (Concert Hall - 左側主殿) ──────────────────────
    const hx1 = -Math.round(bw * 0.24);
    // 第1級：前導小貝殼（靠近前端階梯）
    drawSail(v, hx1, sy, -Math.round(bd * 0.40), dim(s, 0.48, 2), dim(s, 1.10, 5), dim(s, 0.75, 3), 1, true);
    // 第2級：次主帆貝殼
    drawSail(v, hx1, sy, -Math.round(bd * 0.24), dim(s, 0.62, 3), dim(s, 1.50, 7), dim(s, 1.05, 5), 1, true);
    // 第3級：主冠峰大貝殼（全館最高點）
    drawSail(v, hx1, sy, -Math.round(bd * 0.05), dim(s, 0.76, 4), dim(s, 1.95, 9), dim(s, 1.35, 6), 1, true);
    // 第4級：後翼反向貝殼（背向收束）
    drawSail(v, hx1, sy, Math.round(bd * 0.38), dim(s, 0.58, 3), dim(s, 1.25, 5), dim(s, 0.90, 4), -1, true);

    // ── 4. 歌劇院廳貝殼群 (Opera Theatre - 右側主殿) ───────────────────
    const hx2 = Math.round(bw * 0.24);
    // 第1級：前導小貝殼
    drawSail(v, hx2, sy, -Math.round(bd * 0.38), dim(s, 0.42, 2), dim(s, 0.95, 4), dim(s, 0.65, 3), 1, true);
    // 第2級：次主帆貝殼
    drawSail(v, hx2, sy, -Math.round(bd * 0.22), dim(s, 0.54, 3), dim(s, 1.30, 6), dim(s, 0.92, 4), 1, true);
    // 第3級：主冠峰貝殼
    drawSail(v, hx2, sy, -Math.round(bd * 0.04), dim(s, 0.66, 3), dim(s, 1.65, 8), dim(s, 1.18, 5), 1, true);
    // 第4級：後翼反向貝殼
    drawSail(v, hx2, sy, Math.round(bd * 0.36), dim(s, 0.50, 2), dim(s, 1.08, 5), dim(s, 0.78, 3), -1, true);

    // ── 5. 附屬貝內隆餐廳 (Bennelong - 右後側雙聯貝殼) ─────────────────
    const hx3 = Math.round(bw * 0.38);
    drawSail(v, hx3, sy, Math.round(bd * 0.06), dim(s, 0.32, 2), dim(s, 0.75, 3), dim(s, 0.55, 2), 1, true);
    drawSail(v, hx3, sy, Math.round(bd * 0.26), dim(s, 0.28, 2), dim(s, 0.62, 3), dim(s, 0.46, 2), -1, true);

    // ── 6. 中央玻璃大廳與觀景矮牆 ──────────────────────────────────────
    const cw = Math.max(1, Math.round(bw * 0.14));
    const cd = Math.round(bd * 0.65);
    v.box(0, sy, 0, cw, dim(s, 0.30, 2), cd, 3);
    v.box(0, sy + dim(s, 0.30, 2), 0, cw + 1, 1, cd + 1, 1);

    // 兩側步道護欄
    mirrorX(v, Math.round(bw / 2) - 1, (vv, dx) => {
      vv.box(dx, sy, 0, 1, 1, bd - 2, 1);
    });
  } },
{ n: '荷蘭風車', lo: 7, hi: 46, pal: [0xd7cdb8, 0x8b5a3c, 0xf0e6d0, 0x6b4a30],
  gen(v, s) {
    const h = Math.round(s * 0.72);
    v.taper(0, 0, 0, Math.max(3, s * 0.28), Math.max(2, s * 0.17), h, 0, 2);
    v.taper(0, h, 0, Math.max(2.4, s * 0.2), 0.8, Math.max(3, Math.round(s * 0.16)), 3);
    /* 風車軸要黏在頂蓋正前方，不能憑空給一個 z——第一版扇葉整組飄在半空中 */
    const capR = Math.max(2.4, s * 0.2);
    const hubZ = -Math.round(capR + 1), cy = h + Math.max(1, Math.round(s * 0.06));
    const R = Math.round(s * 0.5);
    v.box(0, cy, hubZ + 1, 2, 2, 2, 3);                             // 輪轂
    for (let b = 0; b < 4; b++) {                                   // 四片扇葉
      const a = b * Math.PI / 2 + 0.4;
      v.line(0, cy, hubZ, Math.cos(a) * R, cy + Math.sin(a) * R, hubZ, 1);
      for (let i = 3; i <= R; i += 1) {                             // 葉面的骨架
        const px = Math.cos(a) * i, py = cy + Math.sin(a) * i;
        v.set(px - Math.sin(a) * 1.8, py + Math.cos(a) * 1.8, hubZ, 2);
        if (i % 3 === 0) v.line(px, py, hubZ, px - Math.sin(a) * 1.8, py + Math.cos(a) * 1.8, hubZ, 2);
      }
    }
    v.box(0, 0, 0, Math.round(s * 0.9), 1, Math.round(s * 0.9), 3);
  } },

{ n: '巨石陣', lo: 6, hi: 38, pal: [0x9c9689, 0x827d71, 0xb5afa1],
  gen(v, s) {
    const R = Math.round(s * 0.85), h = Math.max(4, Math.round(s * 0.42)), N = Math.max(8, Math.round(s * 0.9));
    for (let i = 0; i < N; i++) {                    // 外圈立石 + 楣石
      const a = i / N * Math.PI * 2;
      const x = Math.cos(a) * R, z = Math.sin(a) * R;
      v.box(x, 0, z, 2, h, 2, 0);
      const a2 = (i + 0.5) / N * Math.PI * 2;
      v.box(Math.cos(a2) * R, h, Math.sin(a2) * R, 3, 1, 3, 2);
    }
    for (let i = 0; i < 5; i++) {                    // 內圈三石塔
      const a = i / 5 * Math.PI * 1.5 + 0.6, r = R * 0.5;
      v.box(Math.cos(a) * r, 0, Math.sin(a) * r, 2, h + 3, 2, 1);
    }
    v.cyl(0, 0, 0, R + 2, 1, 1, 2);
  } },

{ n: '復活節島摩艾', lo: 1.5, hi: 10, pal: [0x322e2b, 0x7d7568, 0x4b453d, 0x9e9484, 0x7a3228],
  /* 來源：blueprints/阿胡湯加里基摩艾石像群.js（v1.66 換掉原本那份） */
  gen(v, s) {
    // 15 尊摩艾的身高係數（嚴格由左至右：左邊第 2、3 尊最高大，右側漸矮，第 13 尊戴帽子）
    const scales = [
      0.96, 1.15, 1.20, 0.94, 0.88,
      0.92, 0.86, 0.80, 0.82, 0.76,
      0.95, 0.74, 0.82, 0.70, 0.68
    ];
    const n = 15;

    // 單尊基準寬度與像距（奇數方便置中刻五官）
    const unitW = dim(s, 0.35, 3, true);
    const gap = Math.max(1, dim(s, 0.18, 1));
    const stepX = unitW + gap;
    const totalW = n * unitW + (n - 1) * gap;

    const platD = dim(s, 1.10, 5);
    const platH = dim(s, 0.30, 2);

    // 1. 阿胡（Ahu）長條祭台（上下兩層分色階）
    v.box(0, 0, 0, totalW + dim(s, 0.8, 4), platH, platD + 2, 0);
    v.box(0, platH - 1, 0, totalW + dim(s, 0.4, 2), 1, platD, 0);

    // 2. 逐一建造 15 尊獨立摩艾
    for (let i = 0; i < n; i++) {
      const posX = Math.round(-totalW / 2 + unitW / 2 + i * stepX);
      const sc = scales[i];

      const w = dim(s, 0.34 * Math.sqrt(sc), 3, true);
      const bD = dim(s, 0.46 * sc, 3); // 軀幹深度
      const bH = dim(s, 0.90 * sc, 4); // 軀幹高
      const hH = dim(s, 1.10 * sc, 4); // 頭部高
      const chinH = dim(s, 0.30 * sc, 2);

      const yBase = platH;

      // 獨立石墊底座
      v.box(posX, yBase, 0, w, 1, bD + 1, 0);

      // (A) 軀幹與微凸腹部
      v.box(posX, yBase + 1, 0, w, bH, bD, 1);
      // 正面腹部雙手交疊浮雕
      const fz = -Math.floor(bD / 2);
      v.box(posX, yBase + 1, fz, Math.max(1, w - 2), Math.max(1, bH - 2), 1, 3);
      // 兩側手臂與陰影
      mirrorX(v, Math.floor(w / 2), (vv, dx) => {
        vv.box(posX + dx, yBase + 1, 0, 1, bH - 1, 1, 2);
      });

      // (B) 頭部與仰角輪廓（頭身厚實且前傾）
      const headY = yBase + 1 + bH;
      const headZ = -1;
      const faceZ = headZ - Math.floor(bD / 2);

      // 頭部主結構
      v.box(posX, headY, headZ, w, hH, bD, 1);

      // 突出下巴（厚道長下巴）
      v.box(posX, headY, faceZ, w, chinH, 1, 1);
      v.box(posX, headY, faceZ - 1, Math.max(1, w - 2), 1, 1, 3);

      // 凸出眉骨與額頭
      const browY = headY + hH - 1;
      v.box(posX, browY, faceZ, w, 1, 1, 3);
      v.box(posX, browY, faceZ - 1, w, 1, 1, 3);

      // 長條高挺鼻樑（從眉骨垂到下巴上方）
      const noseY = headY + chinH;
      const noseH = Math.max(1, browY - noseY);
      v.box(posX, noseY, faceZ - 1, 1, noseH, 1, 3);

      // 深邃眼窩（眉骨下方兩側挖深陰影）
      const eyeY = browY - 1;
      mirrorX(v, 1, (vv, dx) => {
        tint(vv, posX + dx, eyeY, faceZ, 2);
      });

      // 長耳（沿著頭部兩側拉長）
      const earH = Math.max(2, hH - 2);
      mirrorX(v, Math.floor(w / 2), (vv, dx) => {
        vv.box(posX + dx, headY + 1, headZ, 1, earH, 1, 2);
      });

      // (C) 第 13 尊（索引 12）頭頂的紅色普卡奧（Pukao 石冠）
      if (i === 12) {
        const pukaoR = Math.max(1.3, (w / 2) + 0.3);
        const pukaoH = dim(s, 0.45, 2);
        v.cyl(posX, headY + hH, headZ, pukaoR, pukaoH, 4);
        v.cyl(posX, headY + hH + pukaoH, headZ, Math.max(0.7, pukaoR * 0.5), 1, 4);
      }
    }
  } },
{ n: '獅身人面像', lo: 2.2, hi: 15, pal: [0xdfc28d, 0xb89764, 0x8a6d46, 0xcfb078, 0xe2cc9b, 0x5c4528],
  /* 來源：blueprints/獅身人面像.js（v1.66 換掉原本那份） */
  gen(v, s) {
    // 1. 核心比例
    const bw = dim(s, 1.30, 7, true);   // 身寬
    const bl = dim(s, 3.00, 16);        // 身長（拉長，突顯伏臥感）
    const bh = dim(s, 0.95, 5);         // 身高
    const bz = dim(s, 0.60, 3);         // 身軀中心
    const frontZ = bz - Math.round(bl / 2);

    // 2. 基座石台
    v.box(0, 0, bz, bw + 2, 1, bl + 2, 1);

    // 3. 獅身主體（伏臥身軀，兩段層次）
    v.box(0, 1, bz, bw, bh - 1, bl, 0);
    v.box(0, bh, bz + 1, Math.max(3, bw - 2), 1, bl - 2, 0);

    // 4. 後臀弧度與肌肉（後段略高微拱）
    const rearZ = bz + Math.round(bl * 0.3);
    const rearW = bw;
    v.box(0, bh, rearZ, rearW, 2, Math.round(bl * 0.35), 0);
    v.box(0, bh + 2, rearZ + 1, Math.max(3, rearW - 2), 1, Math.round(bl * 0.25), 0);

    // 側面沉積岩橫紋風化層
    for (let y = 2; y <= bh; y += 2) {
      mirrorX(v, (bw - 1) / 2, (vv, dx) => {
        paintFrom(vv, dx + 1, y, bz, -1, 0, 0, 2, 1);
      });
    }

    // 5. 前伸雙爪與肩部厚肉
    const pw = dim(s, 0.32, 2);
    const pl = dim(s, 1.40, 7);
    const ph = dim(s, 0.38, 2);
    const pawX = Math.round((bw - 1) / 2 - pw / 2);
    const pawZ = frontZ - Math.round(pl / 2) + 1;

    mirrorX(v, pawX, (vv, dx) => {
      // 前爪本體
      vv.box(dx, 1, pawZ, pw, ph, pl, 0);
      // 爪尖細部與暗色趾縫
      vv.box(dx, 1, pawZ - Math.round(pl / 2), pw, 1, 1, 1);
      // 肩關節與軀幹斜接
      vv.box(dx, 1 + ph, frontZ, pw, dim(s, 0.4, 2), dim(s, 0.6, 2), 0);
    });

    // 6. 前胸石碑（記夢碑，立於雙爪中間）
    const stW = dim(s, 0.34, 1, true);
    const stH = dim(s, 0.70, 3);
    v.box(0, 1, frontZ - 1, stW, stH, 1, 2);

    // 7. 前胸與頸肩（前挺斜向收至頸部）
    const chestH = dim(s, 0.85, 4);
    const headZ = frontZ + Math.round(bw * 0.30); // 頭部後退，與胸部形成自然斜角
    const neckY = bh + 1;

    // 前挺胸膛（厚實過渡層）
    v.box(0, neckY, frontZ + 1, Math.max(3, bw - 2), chestH - 1, dim(s, 1.0, 4), 0);
    v.box(0, neckY + 1, frontZ + 2, Math.max(3, bw - 4), chestH - 1, dim(s, 0.8, 3), 0);

    // 8. 法老頭部與面容
    const headY = neckY + chestH - 1;
    const hr = dim(s, 0.52, 3); // 頭部半徑

    // 面部基底
    blob(v, 0, headY + hr, headZ, hr * 0.9, hr * 1.05, hr * 0.9, 4);

    // 9. 法老頭巾（Nemes）— 兩側大弧翼展開與頂冠
    const nemesSpan = Math.round(hr * 1.4);
    // 兩側向外撐開的大頭巾褶翼
    mirrorX(v, nemesSpan, (vv, dx) => {
      // 側翼厚片
      vv.box(dx, headY - 1, headZ, 1, Math.round(hr * 2.0), Math.round(hr * 1.3), 3);
      // 外擴邊緣收弧
      vv.box(dx > 0 ? dx - 1 : dx + 1, headY - 2, headZ - 1, 1, Math.round(hr * 1.5), 1, 3);
    });

    // 頭巾頂部圓弧與後腦盔甲
    v.dome(0, headY + Math.round(hr * 1.3), headZ + 1, Math.max(2, Math.round(hr * 1.2)), 3, 0.6);
    v.box(0, headY, headZ + Math.round(hr * 0.7), Math.max(3, Math.round(hr * 1.8)), Math.round(hr * 1.6), 2, 3);

    // 10. 五官特徵（風化雙眼、微突殘鼻、下巴假鬍基座）
    // 雙眼與眉骨
    mirrorX(v, Math.max(1, Math.round(hr * 0.4)), (vv, dx) => {
      paintFrom(vv, dx, Math.round(headY + hr * 1.05), headZ - Math.ceil(hr) - 2, 0, 0, 1, 4, 5);
    });
    // 鼻形（風化殘缺）
    paintFrom(v, 0, Math.round(headY + hr * 0.70), headZ - Math.ceil(hr) - 2, 0, 0, 1, 4, 0);
    // 下巴厚實假鬍殘留處
    v.box(0, headY + Math.round(hr * 0.15), headZ - Math.round(hr * 0.75), Math.max(1, dim(s, 0.22, 1, true)), Math.max(1, dim(s, 0.3, 1)), 2, 1);

    // 11. 盤繞長尾（右後側沿身體環繞）
    const tailX = Math.round((bw - 1) / 2);
    const tailZ = rearZ + 1;
    v.line(tailX + 1, 1, tailZ - 2, tailX + 1, 2, tailZ + 1, 1);
    v.line(tailX + 1, 2, tailZ + 1, tailX - 1, 2, tailZ + 2, 1);
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

{ n: '聖家堂', lo: 1.8, hi: 13.5, pal: [0xc8b99d, 0x9e8c74, 0x5c5346, 0xe5d7ba, 0xd4a246, 0xb44a38],
  /* 來源：AgentData/blueprints/聖家堂.js（v1.143 換掉原本那份） */
  gen(v, s) {
    // 1. 核心尺度參數化
    const baseW = dim(s, 2.2, 9, true);      // 中殿與基座總寬
    const baseD = dim(s, 2.8, 11);          // 中殿總深
    const naveH = dim(s, 1.4, 5);           // 主殿牆高
    const transeptW = dim(s, 3.2, 13, true);// 翼殿寬度（拉丁十字形）
    const transeptD = dim(s, 1.2, 5);       // 翼殿深度

    // 2. 基座與台階（第一層：台基）
    v.box(0, 0, 0, baseW + 4, 1, baseD + 4, 1);
    v.box(0, 0, 0, transeptW + 2, 1, transeptD + 2, 1);
    const stepN = dim(s, 0.25, 2);
    stairs(v, 0, 0, -Math.round(baseD / 2) - 2 - stepN, stepN, dim(s, 0.7, 3, true), 'z', 1);

    // 3. 主體教堂殿堂（第二層：主量體）
    v.walls(0, 1, 0, baseW, naveH, baseD, 0, 1);
    v.walls(0, 1, 0, transeptW, naveH, transeptD, 0, 1);
    v.box(0, 1 + naveH, 0, baseW + 2, 1, baseD + 2, 1); // 壓頂腰線（第四層：線腳分層）

    // 4. 正面「誕生立面」門廊與三座大拱門（第三層：開口）
    const frontZ = -Math.round(baseD / 2);
    const portalW = dim(s, 0.45, 3, true);
    const portalH = dim(s, 0.65, 3);
    // 中央主拱門
    arch(v, 0, 1, frontZ, portalW, portalH, 1, 1);
    v.box(0, 1, frontZ + 1, portalW, portalH + Math.round((portalW - 1) / 2), 1, 2);
    // 左右兩側副拱門
    const sideOffset = Math.round(baseW * 0.26);
    mirrorX(v, sideOffset, (vv, dx) => {
      arch(vv, dx, 1, frontZ, Math.max(3, portalW - 2), Math.max(2, portalH - 1), 1, 1);
      vv.box(dx, 1, frontZ + 1, Math.max(3, portalW - 2), Math.max(2, portalH - 1), 1, 2);
    });

    // 5. 側牆高窗與立面雕飾長窗
    const winConfig = {
      rows: 1, cols: dim(s, 0.35, 2),
      w: 1, h: dim(s, 0.45, 2),
      stepX: dim(s, 0.65, 3), stepY: 3,
      c: 3, axis: 'z'
    };
    mirrorX(v, Math.round(baseW / 2), (vv, dx) => {
      windowGrid(vv, Object.assign({ x: dx, y: 2, z: 0 }, winConfig));
    });

    // 6. 側壁飛扶壁支柱（第六層：附屬部件）
    const buttressN = dim(s, 0.35, 2);
    const bSpan = Math.max(2, Math.round((baseD - 2) / buttressN));
    mirrorX(v, Math.round(baseW / 2) + 1, (vv, dx) => {
      for (let i = 0; i < buttressN; i++) {
        const bz = Math.round(-baseD / 2 + 1 + (i + 0.5) * bSpan);
        vv.box(dx, 1, bz, 1, naveH, 1, 1);
        v.line(dx, 1 + naveH, bz, Math.round(baseW / 2), 1 + naveH + 2, bz, 1);
      }
    });

    // 7. 高聳山牆與屋頂（第五層：屋頂）
    v.gable(0, 2 + naveH, 0, baseW + 2, baseD + 2, 0);

    // 8. 正面誕生立面的四座鏤空鐘樓塔（高迪標誌性錐形網狀塔）
    const fTowerR = dim(s, 0.28, 2);
    const fTowerH = dim(s, 2.8, 8);
    const innerX = Math.round(baseW * 0.16);
    const outerX = Math.round(baseW * 0.38);

    // 內側兩座較高的塔
    mirrorX(v, innerX, (vv, dx) => {
      vv.taper(dx, 1, frontZ - 1, fTowerR + 0.4, 0.8, fTowerH, 0, 1);
      // 塔身開口鏤空效果
      const winRows = dim(s, 0.5, 3);
      for (let w = 0; w < winRows; w++) {
        const wy = 2 + Math.round((w + 1) * (fTowerH / (winRows + 2)));
        paintFrom(vv, dx, wy, frontZ - 3, 0, 0, 1, 3, 2);
      }
      // 頂部主教冠/果實彩陶尖頂（第六層：頂飾）
      const tipY = 1 + fTowerH;
      vv.box(dx, tipY, frontZ - 1, 1, dim(s, 0.35, 2), 1, 5);
      vv.box(dx, tipY + 1, frontZ - 1, 2, 1, 2, 4);
    });

    // 外側兩座略矮的塔
    const outerTowerH = Math.round(fTowerH * 0.85);
    mirrorX(v, outerX, (vv, dx) => {
      vv.taper(dx, 1, frontZ, fTowerR, 0.7, outerTowerH, 0, 1);
      const winRows = dim(s, 0.4, 2);
      for (let w = 0; w < winRows; w++) {
        const wy = 2 + Math.round((w + 1) * (outerTowerH / (winRows + 2)));
        paintFrom(vv, dx, wy, frontZ - 2, 0, 0, 1, 3, 2);
      }
      const tipY = 1 + outerTowerH;
      vv.box(dx, tipY, frontZ, 1, dim(s, 0.3, 2), 1, 5);
      vv.box(dx, tipY + 1, frontZ, 2, 1, 2, 4);
    });

    // 9. 中央基督之塔（全堂最高主塔）與四福音書副塔
    const mainTowerR = dim(s, 0.5, 3);
    const mainTowerH = dim(s, 3.6, 11);
    const mainTowerY = 2 + naveH;
    // 中央主塔本體
    v.taper(0, mainTowerY, 0, mainTowerR + 0.5, 0.9, mainTowerH, 0, 1);
    // 頂部巨型四臂立體十字架
    const crossBaseY = mainTowerY + mainTowerH;
    const crossH = dim(s, 0.45, 3);
    v.box(0, crossBaseY, 0, 1, crossH, 1, 4);
    v.box(0, crossBaseY + Math.max(1, crossH - 2), 0, 3, 1, 1, 4);
    v.box(0, crossBaseY + Math.max(1, crossH - 2), 0, 1, 1, 3, 4);
    tint(v, 0, crossBaseY + crossH, 0, 5);

    // 四福音書環繞副塔
    const subTowerDist = Math.round(mainTowerR + 1.5);
    const subTowerH = Math.round(mainTowerH * 0.6);
    corners4(v, subTowerDist, subTowerDist, (vv, x, z) => {
      vv.taper(x, mainTowerY, z, 0.8, 0.4, subTowerH, 1);
      vv.box(x, mainTowerY + subTowerH, z, 1, 2, 1, 4);
      tint(vv, x, mainTowerY + subTowerH + 2, z, 5);
    });
  } },

{ n: '美國國會大廈', lo: 1.8, hi: 13, pal: [0xf5f5f7, 0xdcdfe3, 0xb8c0c8, 0x4a5568, 0x8b4513, 0xe2b007],
  /* 來源：AgentData/blueprints/美國國會大廈.js（v1.143 換掉原本那份）。
     hi 從原稿的 11.5 調到 13：11.5 的時候 9000 那檔只長到 7820（s 頂到 hi），13 是 9021 */
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
      vv.walls(dx, 1, 0, linkW + 1, bh - 1, linkD, 0, 1);
      vv.box(dx, bh, 0, linkW + 1, 1, linkD, 1); // 走廊頂部壓頂
    });
    // 參眾兩院南北翼 (左右對稱大廳)
    mirrorX(v, (bw - 1) / 2 + linkW + Math.round(wingW / 2), (vv, dx) => {
      vv.walls(dx, 1, 0, wingW, bh, wingD, 0, 1);
      vv.box(dx, 1 + bh, 0, wingW + 2, 1, wingD + 2, 1); // 翼樓頂部簷口
      hipRoof(vv, dx, 2 + bh, 0, wingW + 2, wingD + 2, 2); // 翼樓低矮四坡頂
      
      // 翼樓立面窗戶陣列
      windowGrid(vv, {
        x: dx, y: 2, z: Math.round((wingD - 1) / 2),   // 牆面在 (d-1)/2，原稿的 d/2 在 wingD 是奇數時會落到牆外一格（窗戶整組畫不出來）
        cols: dim(s, 0.3, 2), rows: dim(s, 0.25, 2),
        stepX: 2, stepY: 2, w: 1, h: 1, c: 3, axis: 'x'
      });
    });

    // === 4. 正面門廊與三角山牆柱廊 (Grand Portico & Pediment) ===
    const portW = dim(s, 0.9, 5, true);    // 門廊寬度
    const portD = dim(s, 0.35, 2);         // 門廊突出深度
    const portZ = frontZ + Math.round(portD / 2);
    
    // 前方柱廊（以拱門群或立柱形成開放式門廊）
    v.box(0, 1, portZ, portW, bh, portD, 0);
    arch(v, 0, 1, frontZ + portD, dim(s, 0.4, 3, true), bh - 2, 1); // 門廊正中大開口
    // 門廊正上方經典希臘三角山牆 (Pediment)
    v.gable(0, 1 + bh, portZ, portW + 2, portD + 1, 1);

    // 大階梯 (Grand Steps)
    const stairSteps = dim(s, 0.3, 2);
    stairs(v, 0, 0, frontZ + portD + stairSteps, stairSteps, portW + 2, '-z', 1);

    // 主入口木門與中央立面裝飾
    const doorW = dim(s, 0.25, 1, true);
    v.box(0, 1, frontZ, doorW, 2, 1, 4);

    // === 5. 中央主體頂層壓頂與欄杆線腳 (Cornice & Balustrade) ===
    v.box(0, 1 + bh, 0, bw + 2, 1, bd + 2, 1);

    // === 6. 標誌性中央大圓頂 (The Great Dome) ===
    // 圓頂下層鼓座 (Lower Drum with Colonnade)
    const drumR1 = dim(s, 0.55, 3);
    const drumH1 = dim(s, 0.45, 2);
    const drumY1 = 2 + bh;
    v.cyl(0, drumY1, 0, drumR1, drumH1, 0, 1);
    // 鼓座外圈柱廊裝飾環
    v.ellipseRing(0, drumY1, 0, drumR1 + 1, drumR1 + 1, drumH1, 1, 1);

    // 圓頂上層過渡鼓座 (Upper Peristyle Drum)
    const drumR2 = Math.max(2, drumR1 - 1);
    const drumH2 = dim(s, 0.35, 2);
    const drumY2 = drumY1 + drumH1;
    v.cyl(0, drumY2, 0, drumR2, drumH2, 0, 1);
    // 圓頂下簷線腳
    v.cyl(0, drumY2 + drumH2, 0, drumR2 + 1, 1, 1);

    // 鑄鐵大圓頂主體 (Main Ribbed Dome)
    const domeY = drumY2 + drumH2 + 1;
    const domeR = drumR2;
    v.dome(0, domeY, 0, domeR, 2, 0.85);

    // === 7. 圓頂頂閣、托座與自由女神雕像 (Cupola, Lantern & Statue of Freedom) ===
    const lanternY = domeY + Math.round(domeR * 0.85);
    const lanternH = dim(s, 0.35, 2);
    // 頂部小圓亭 (Lantern)
    v.cyl(0, lanternY, 0, 1, lanternH, 0);
    v.cyl(0, lanternY + lanternH, 0, 2, 1, 1); // 雕像基座線腳

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

{ n: '海岬燈塔', lo: 7, hi: 50, pal: [0xf2efe6, 0xd0473c, 0x3a4a55, 0xf5d76e],
  gen(v, s) {
    const h = Math.round(s);
    v.cyl(0, 0, 0, Math.max(3, s * 0.34), 2, 2, 0);                    // 礁岩基座
    for (let y = 0; y < h; y++) {
      const r = Math.max(1.6, s * 0.2 * (1 - y / h * 0.45));
      v.cyl(0, 2 + y, 0, r, 1, Math.floor(y / Math.max(2, h / 7)) % 2 ? 1 : 0, r * 0.55);
    }
    v.cyl(0, 2 + h, 0, Math.max(2.4, s * 0.15), 1, 2, 0);
    v.cyl(0, 3 + h, 0, Math.max(2, s * 0.12), Math.max(2, Math.round(s * 0.1)), 3, 0);  // 燈室
    v.cyl(0, 3 + h + Math.max(2, Math.round(s * 0.1)), 0, Math.max(2.4, s * 0.15), 1, 2, 0);
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
    y += bH + 1;

    // 第二層（中層）
    v.cyl(0, y, 0, bR2, bH, 0);
    v.cyl(0, y + bH, 0, bR2, 1, 0, 1); // 欄杆
    stairs(v, 0, y, -bR2 - bH, bH + 1, stW, 'z', 0);
    stairs(v, 0, y, bR2 + 1, bH + 1, stW, '-z', 0);
    stairs(v, -bR2 - bH, 0, 0, bH + 1, stW, 'x', 0);
    stairs(v, bR2 + 1, 0, 0, bH + 1, stW, '-x', 0);
    y += bH + 1;

    // 第三層（上層）
    v.cyl(0, y, 0, bR3, bH, 0);
    v.cyl(0, y + bH, 0, bR3, 1, 0, 1); // 欄杆
    stairs(v, 0, y, -bR3 - bH, bH + 1, stW, 'z', 0);
    stairs(v, 0, y, bR3 + 1, bH + 1, stW, '-z', 0);
    stairs(v, -bR3 - bH, 0, 0, bH + 1, stW, 'x', 0);
    stairs(v, bR3 + 1, 0, 0, bH + 1, stW, '-x', 0);
    y += bH + 1;

    // --- 2. 底層殿身（朱紅立柱、金格扇門窗、斗栱青綠彩畫）與下層大藍簷 ---
    // 殿座基腳
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

    // 下層圓形大藍簷（雙層收坡，顯出飛簷出挑的弧度與平緩度）
    v.cyl(0, y, 0, e1, 1, 1);
    v.taper(0, y + 1, 0, e1 - 0.5, r0, dim(s, 0.40, 1), 1, 1);
    y += dim(s, 0.40, 1) + 1;

    // --- 3. 中層殿身與中層藍簷 ---
    const r1 = Math.max(4, r0 - dim(s, 0.35, 1));
    const flH2 = Math.max(2, dim(s, 0.55, 1));

    // 中層殿身朱紅立柱
    v.cyl(0, y, 0, r1, flH2, 2, 2);
    // 中層斗栱青綠金飾帶
    v.cyl(0, y + flH2 - 1, 0, r1 + 0.5, 1, 4, 1);
    y += flH2;

    // 中層圓形藍簷
    v.cyl(0, y, 0, e2, 1, 1);
    v.taper(0, y + 1, 0, e2 - 0.5, r1, dim(s, 0.35, 1), 1, 1);
    y += dim(s, 0.35, 1) + 1;

    // --- 4. 上層殿身、穹頂頂簷與鎏金寶頂 ---
    const r2 = Math.max(3, r1 - dim(s, 0.35, 1));
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

{ n: '吳哥窟', lo: 2.2, hi: 15.0, pal: [0x7a7469, 0x5c5549, 0x9e9687, 0x3a342c, 0xb5ac98, 0x4a453b],
  /* 來源：AgentData/blueprints/吳哥窟.js（v1.143 換掉原本那份） */
  gen(v, s) {
    // 1. 基礎尺度參數化（全部帶下限保證小尺寸不失真）
    const b1 = dim(s, 2.6, 13, true);   // 最底層台基邊長（奇數）
    const b2 = dim(s, 1.9, 9, true);    // 第二層台基邊長（奇數）
    const b3 = dim(s, 1.3, 7, true);    // 最高主殿台基邊長（奇數）

    const h1 = dim(s, 0.4, 2);          // 底層台基高
    const h2 = dim(s, 0.4, 2);          // 第二層高
    const h3 = dim(s, 0.5, 2);          // 第三層高

    const gh = dim(s, 0.55, 2);         // 迴廊柱牆高度
    const gw = dim(s, 0.35, 1);         // 迴廊寬度/厚度

    // 2. 第一層（底層）大台基與外圍十字迴廊線條
    v.box(0, 0, 0, b1 + 2, h1, b1 + 2, 1);
    v.walls(0, h1, 0, b1, gh, b1, 0, gw);
    // 外圍迴廊的盲窗/直欞石窗 (用 windowGrid tint 到外牆)
    const win1 = { rows: 1, w: 1, h: Math.max(1, gh - 1), c: 3, stepX: 2, cols: Math.max(2, Math.floor(b1 / 4)) };
    mirrorX(v, (b1 - 1) / 2, (vv, dx) => windowGrid(vv, Object.assign({ x: dx, y: h1, z: 0, axis: 'z' }, win1)));
    mirrorZ(v, (b1 - 1) / 2, (vv, dz) => windowGrid(vv, Object.assign({ x: 0, y: h1, z: dz, axis: 'x' }, win1)));

    // 四向正面開大門洞
    mirrorX(v, (b1 - 1) / 2, (vv, dx) => vv.carve(dx, h1, 0, gw + 2, gh, dim(s, 0.35, 1, true)));
    mirrorZ(v, (b1 - 1) / 2, (vv, dz) => vv.carve(0, h1, dz, dim(s, 0.35, 1, true), gh, gw + 2));

    // 正面延伸石階與引橋參道 (朝 -z 方向)
    const stairW = dim(s, 0.55, 3, true);
    const bridgeL = dim(s, 0.7, 3);
    stairs(v, 0, 0, -(b1 + 2) / 2 - 1, h1, stairW, '-z', 5);
    v.box(0, 0, -(b1 + 2) / 2 - 1 - bridgeL / 2, stairW + 2, 1, bridgeL, 5);
    // 參道兩側那伽護欄
    mirrorX(v, (stairW + 1) / 2, (vv, dx) => vv.box(dx, 1, -(b1 + 2) / 2 - 1 - bridgeL / 2, 1, 1, bridgeL, 1));

    // 3. 第二層台基與中層迴廊
    const y2 = h1 + gh;
    v.box(0, y2, 0, b2 + 2, h2, b2 + 2, 1);
    v.walls(0, y2 + h2, 0, b2, gh, b2, 0, gw);
    // 第二層四周台階
    stairs(v, 0, y2, -(b2 + 2) / 2, h2, stairW, '-z', 5);
    stairs(v, 0, y2, (b2 + 2) / 2, h2, stairW, 'z', 5);
    stairs(v, -(b2 + 2) / 2, y2, 0, h2, stairW, '-x', 5);
    stairs(v, (b2 + 2) / 2, y2, 0, h2, stairW, 'x', 5);

    // 4. 第三層中央聖殿高台（須彌座）
    const y3 = y2 + h2 + gh;
    v.box(0, y3, 0, b3 + 2, h3, b3 + 2, 1);
    v.walls(0, y3 + h3, 0, b3, gh, b3, 0, gw);
    // 陡峭的通頂台階
    stairs(v, 0, y3, -(b3 + 2) / 2, h3, Math.max(1, stairW - 2), '-z', 5);

    // 5. 吳哥窟標誌性特徵：五座蓮花苞式寶塔（Prasat）
    const yTowers = y3 + h3 + gh;
    const cornerTowerOffset = Math.round((b3 - 1) / 2);

    // 輔助函式：建造單座蓮花苞寶塔（多層向內縮進收尖 + 花瓣凹凸）
    const buildLotusTower = (vx, vy, vz, r, h, isMain) => {
      // 塔座與多重挑簷
      v.box(vx, vy, vz, r * 2 + 1, 1, r * 2 + 1, 1);
      v.taper(vx, vy + 1, vz, r, r * 0.8, Math.round(h * 0.4), 2);
      // 蓮花苞鼓出段與收尖段
      const midY = vy + 1 + Math.round(h * 0.4);
      const topH = Math.max(3, h - Math.round(h * 0.4));
      v.onion(vx, midY, vz, r * 0.9, topH, 2);
      // 塔尖花冠與金頂
      v.taper(vx, midY + topH, vz, Math.max(0.8, r * 0.35), 0.2, dim(s, 0.25, 2), 4);
      // 塔身四面線腳裝飾
      if (isMain) {
        mirrorX(v, r, (vv, dx) => vv.box(vx + dx, vy + 1, vz, 1, Math.round(h * 0.5), 1, 4));
        mirrorZ(v, r, (vv, dz) => vv.box(vx, vy + 1, vz + dz, 1, Math.round(h * 0.5), 1, 4));
      }
    };

    // (A) 四座副塔（衛塔）- 位於第三層台基四角
    const sideR = dim(s, 0.28, 2);
    const sideH = dim(s, 0.85, 4);
    corners4(v, cornerTowerOffset, cornerTowerOffset, (vv, cx, cz) => {
      buildLotusTower(cx, yTowers, cz, sideR, sideH, false);
    });

    // (B) 中央主聖塔（最高大雄偉）
    const mainR = dim(s, 0.42, 3);
    const mainH = dim(s, 1.45, 7);
    buildLotusTower(0, yTowers, 0, mainR, mainH, true);
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
{ n: '倫敦眼摩天輪', lo: 8, hi: 50, pal: [0xdfe6ea, 0x9fb3c0, 0xf0f4f6, 0xe07a3c],
  gen(v, s) {
    const R = Math.round(s * 0.85), cy = R + Math.round(s * 0.2);
    for (let a = 0; a < 360; a += 2) {                       // 輪圈
      const rad = a * Math.PI / 180;
      v.set(Math.cos(rad) * R, cy + Math.sin(rad) * R, 0, 0);
      v.set(Math.cos(rad) * (R - 1.5), cy + Math.sin(rad) * (R - 1.5), 0, 1);
    }
    const N = Math.max(10, Math.round(R * 1.2));
    for (let i = 0; i < N; i++) {                            // 輻條 + 車廂
      const rad = i / N * Math.PI * 2;
      for (let r = 2; r < R - 1; r += 1.5) v.set(Math.cos(rad) * r, cy + Math.sin(rad) * r, 0, 1);
      v.box(Math.cos(rad) * (R + 1.5), cy + Math.sin(rad) * (R + 1.5), 0, 2, 2, 2, 3);
    }
    v.cyl(0, cy - 2, 0, 2, 4, 1, 0);                         // 輪軸
    for (const sz of [-1, 1]) for (let y = 0; y < cy; y++) {  // A 字支架
      v.set(y * 0.12, y, sz * Math.round(s * 0.3) * (1 - y / cy), 2);
      v.set(-y * 0.12, y, sz * Math.round(s * 0.3) * (1 - y / cy), 2);
    }
    v.box(0, 0, 0, Math.round(s * 0.9), 1, Math.round(s * 0.9), 2);
  } },

{ n: '農神五號火箭', lo: 7, hi: 70, pal: [0xf2f2f0, 0xd9443c, 0x4a4a4a, 0xe8b23c],
  gen(v, s) {
    const h = Math.round(s), r = Math.max(3, s * 0.14);
    v.cyl(0, 0, 0, r, Math.round(h * 0.66), 0, Math.max(1.5, r * 0.55));
    // 農神五號的辨識點是白底黑格＋三節之間的黑環，不是燈塔那種紅白橫紋
    for (let k = 0; k < 3; k++) v.cyl(0, Math.round(h * (0.2 + k * 0.23)), 0, r + 0.7, 2, 2, 0);
    for (let y = 2; y < Math.round(h * 0.16); y += 3)                   // 第一節的黑色滾轉標記
      for (const a of [0.3, 0.3 + Math.PI]) v.set(Math.cos(a) * r, y, Math.sin(a) * r, 2);
    let y = Math.round(h * 0.66);
    v.taper(0, y, 0, r, r * 0.6, Math.max(3, Math.round(h * 0.1)), 0);  // 收窄的第三節
    y += Math.max(3, Math.round(h * 0.1));
    v.cyl(0, y, 0, r * 0.6, Math.max(3, Math.round(h * 0.1)), 0, 0);
    y += Math.max(3, Math.round(h * 0.1));
    v.taper(0, y, 0, r * 0.6, 0.6, Math.max(3, Math.round(h * 0.07)), 1);   // 指揮艙錐體
    y += Math.max(3, Math.round(h * 0.07));
    v.box(0, y, 0, 1, Math.max(3, Math.round(h * 0.08)), 1, 2);             // 逃逸塔
    const fh = Math.max(3, Math.round(h * 0.12));                            // 四片尾翼
    for (let i = 0; i < 4; i++) {
      const a = i / 4 * Math.PI * 2 + Math.PI / 4;
      for (let yy = 0; yy < fh; yy++)
        for (let d = Math.floor(r - 1); d <= Math.round(r * 1.8); d++) {
          if (yy > fh * (1 - (d - r + 1) / (r * 0.9 + 1))) continue;
          v.set(Math.cos(a) * d, yy, Math.sin(a) * d, 2);
        }
    }
    for (let i = 0; i < 5; i++) {                                            // 五具引擎噴嘴
      const a = i / 4 * Math.PI * 2, d = i === 4 ? 0 : r * 0.55;
      v.box(Math.cos(a) * d, 0, Math.sin(a) * d, 3, 2, 3, 2);
    }
    const tx = Math.round(r * 2.6);                                          // 發射塔架
    for (let yy = 0; yy < Math.round(h * 0.72); yy++) {
      for (const z of [-2, 2]) { v.set(tx, yy, z, 3); v.set(tx + 4, yy, z, 3); }
      if (yy % 4 === 0) for (let z = -2; z <= 2; z++) { v.set(tx, yy, z, 3); v.set(tx + 4, yy, z, 3); }
      if (yy % 8 === 0) v.line(tx, yy, 0, r, yy, 0, 3);                      // 通往火箭的臂
    }
    v.box(0, 0, 0, Math.round(r * 5.5), 1, Math.round(r * 5.5), 2);
  } },

{ n: '阿姆斯特丹運河屋', lo: 7, hi: 50, pal: [0x8c4a3a, 0xc4a882, 0x6b3f34, 0x3f5468, 0xd9cbb0],
  gen(v, s) {
    const N = Math.max(3, Math.round(s * 0.32)), w = 5;
    for (let i = 0; i < N; i++) {
      const x = (i - (N - 1) / 2) * (w + 1);
      const h = Math.round(s * (0.5 + ((i * 37) % 7) / 14));    // 高矮不一才像一整排
      const col = [0, 2, 3][(i * 5) % 3];
      v.walls(x, 0, 0, w, h, Math.round(s * 0.36), col, 1);
      for (let y = 2; y < h - 2; y += 3) v.box(x, y, Math.round(s * 0.18), 3, 2, 1, 4);  // 窗
      let ww = w, y = h;                                        // 階梯山形牆
      while (ww >= 1) { v.box(x, y, 0, ww, 1, Math.round(s * 0.36), 1); ww -= 2; y++; }
      v.box(x, y, 0, 1, 2, 1, 2);
    }
    v.box(0, 0, Math.round(s * 0.36), N * (w + 1), 1, 3, 4);     // 運河邊道
  } },

{ n: '因紐特冰屋', lo: 6, hi: 40, pal: [0xdcecf5, 0xbcd6e6, 0x9dbfd4],
  gen(v, s) {
    const r = Math.max(4, Math.round(s * 0.62));
    for (let y = 0; y <= r; y++) for (let i = -r; i <= r; i++) for (let k = -r; k <= r; k++) {
      const d = Math.sqrt(i * i + y * y + k * k);
      if (Math.abs(d - r) > 0.62) continue;
      v.set(i, y, k, (y + Math.abs(i) + Math.abs(k)) % 3 === 0 ? 1 : 0);   // 交錯冰磚
    }
    v.cyl(0, 0, 0, r, 1, 2, 0);
    const tl = Math.round(r * 0.75);                                       // 入口通道
    for (let z = 0; z < tl; z++) {
      const rr = Math.max(2, r * 0.34);
      for (let y = 0; y <= rr; y++) for (let i = -rr; i <= rr; i++) {
        if (Math.abs(Math.hypot(i, y) - rr) > 0.6) continue;
        v.set(i, y, r + z - 1, 1);
      }
    }
  } },

{ n: '巴黎聖母院', lo: 2.2, hi: 15.0, pal: [0xe4d8c5, 0xa89c89, 0x5a6b7c, 0xa2c4d9, 0xc8963e, 0x5c3a21],
  /* 來源：AgentData/blueprints/巴黎聖母院.js（v1.143 換掉原本那份） */
  gen(v, s) {
    // 1. 核心比例與尺度計算（依據巴黎聖母院西立面雙塔、長中殿、後殿半圓與中軸尖塔）
    const nw = dim(s, 1.60, 9, true);      // 中殿與後殿寬度（奇數便於對稱屋頂）
    const nd = dim(s, 3.20, 15);           // 整座主教堂長度（深）
    const nh = dim(s, 1.40, 6);            // 中殿牆高
    const tw = dim(s, 0.75, 5, true);      // 正面雙鐘塔邊長（奇數）
    const th = dim(s, 2.60, 11);           // 鐘塔高度（顯著高於主殿）
    const spireH = dim(s, 1.80, 7);        // 中央交叉點哥德尖塔高

    const tz = -Math.round(nd / 2) + Math.round(tw / 2); // 雙塔中心 z 位置（正面）
    const towerX = Math.round((nw - tw) / 2);            // 雙塔左右偏位 x
    const frontFace = tz - Math.floor(tw / 2);           // 西立面正牆面 z 座標
    const halfNw = Math.floor(nw / 2);                   // 中殿側牆 x 座標

    // 2. 台基與地基
    v.box(0, 0, 0, nw + 4, 1, nd + 4, 1);
    stairs(v, 0, 0, frontFace - 2, 2, nw + 2, 'z', 1);

    // 3. 主中殿與後殿量體（中空牆體）
    v.walls(0, 1, 0, nw, nh, nd, 0, 1);

    // 4. 後殿半圓收尾（Chevet / Apse）
    const apseZ = Math.round(nd / 2);
    v.cyl(0, 1, apseZ, halfNw, nh, 0, 1);

    // 5. 側立面飛扶壁（Flying Buttresses）與高窗
    const nButt = dim(s, 0.40, 3);
    const buttStep = Math.max(3, Math.round((nd - tw - 4) / nButt));
    for (let i = 0; i < nButt; i++) {
      const bz = Math.round(-nd / 2 + tw + 2 + i * buttStep);
      mirrorX(v, halfNw + 1, (vv, dx) => {
        // 外側扶壁立柱
        vv.box(dx > 0 ? dx + 1 : dx - 1, 1, bz, 1, nh + 1, 1, 1);
        // 上層斜撐飛券連至主牆
        vv.line(dx > 0 ? dx + 1 : dx - 1, nh, bz, dx, nh - 1, bz, 1);
        // 扶壁頂端小尖塔
        vv.taper(dx > 0 ? dx + 1 : dx - 1, nh + 2, bz, 0.8, 0.3, dim(s, 0.35, 2), 4);
      });
    }

    // 側高窗
    mirrorX(v, halfNw, (vv, dx) => {
      windowGrid(vv, {
        x: dx, y: 2 + dim(s, 0.2, 1), z: 0,
        cols: dim(s, 0.45, 3), rows: 1,
        stepX: buttStep, stepY: 1,
        w: 1, h: dim(s, 0.55, 3),
        c: 3, axis: 'z'
      });
    });

    // 6. 壓頂腰線與陡峭雙坡屋頂
    v.box(0, 1 + nh, 0, nw + 2, 1, nd + 2, 1);
    v.gable(0, 2 + nh, 0, nw + 2, nd + 2, 2);
    // 後殿半圓錐形屋頂
    v.taper(0, 2 + nh, apseZ, halfNw + 1, 0.5, Math.ceil((nw + 2) / 2), 2, 1);

    // 7. 兩座西立面標誌鐘塔（雙塔中空、多層通風開口）
    mirrorX(v, towerX, (vv, tx) => {
      vv.walls(tx, 1, tz, tw, th, tw, 0, 1);
      // 塔身雙層分界腰線
      const midY = 1 + Math.round(th * 0.55);
      vv.box(tx, midY, tz, tw + 1, 1, tw + 1, 1);
      // 上層長條百葉雙連拱窗（鐘室）
      const bArchW = dim(s, 0.22, 1, true);
      const bArchH = dim(s, 0.45, 2);
      vv.carve(tx - 1, midY + 1, tz - Math.floor(tw / 2), bArchW, bArchH, 1);
      vv.carve(tx + 1, midY + 1, tz - Math.floor(tw / 2), bArchW, bArchH, 1);
      // 塔頂平台欄杆與外擴簷口
      vv.box(tx, 1 + th, tz, tw + 2, 1, tw + 2, 1);
      vv.carve(tx, 1 + th, tz, tw, 1, tw);
      // 塔頂四角精緻小尖柱
      corners4(vv, Math.floor(tw / 2) + 0.5, Math.floor(tw / 2) + 0.5, (vvv, cx, cz) => {
        vvv.box(tx + cx, 2 + th, tz + cz, 1, 1, 1, 4);
      });
    });

    // 8. 西立面中央區塊：王者長廊（Galerie des Rois）
    const galleryY = 1 + Math.round(nh * 0.7);
    v.box(0, galleryY, frontFace, nw - 2, 1, 1, 1);
    for (let gx = -Math.floor((nw - 4) / 2); gx <= Math.floor((nw - 4) / 2); gx += 2) {
      tint(v, gx, galleryY, frontFace, 4);
    }

    // 9. 正面標誌性西玫瑰窗（West Rose Window）
    const roseR = dim(s, 0.35, 2);
    const roseY = galleryY + roseR + 2;
    for (let rx = -roseR; rx <= roseR; rx++) {
      for (let ry = -roseR; ry <= roseR; ry++) {
        const d = Math.hypot(rx, ry);
        if (d <= roseR + 0.4) {
          tint(v, rx, roseY + ry, frontFace, d > roseR - 0.8 ? 4 : 3);
        }
      }
    }

    // 10. 正面三座哥德透雕大門（聖母門、最後審判門、聖安妮門）
    const portalW = dim(s, 0.32, 3, true);
    const portalH = dim(s, 0.45, 2);
    // 中央大門
    arch(v, 0, 1, frontFace, portalW, portalH, 1, 1);
    v.box(0, 1, frontFace + 1, portalW, portalH + Math.floor(portalW / 2), 1, 5);
    // 左右兩側大門
    mirrorX(v, towerX, (vv, dx) => {
      arch(vv, dx, 1, frontFace, Math.max(1, portalW - 2), portalH - 1, 1, 1);
      vv.box(dx, 1, frontFace + 1, Math.max(1, portalW - 2), portalH, 1, 5);
    });

    // 11. 中軸屋脊哥德細長尖塔（Spire / Flèche）
    const spireY = 2 + nh + Math.ceil((nw + 2) / 2);
    v.taper(0, spireY, 0, Math.max(1.5, nw * 0.2), 0.3, spireH, 2, 1);
    // 尖塔頂端十字架與風向金雞裝飾
    v.box(0, spireY + spireH, 0, 1, 2, 1, 4);
    v.box(0, spireY + spireH + 1, 0, 3, 1, 1, 4);
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
{ n: '羅浮宮金字塔', lo: 7, hi: 52, pal: [0x9fc4d8, 0x7ba5bd, 0xd8e6ee, 0xc9bfa8],
  gen(v, s) {
    const b = Math.round(s) | 1, hb = (b - 1) / 2;
    for (let y = 0; y <= hb; y++) {                                         // 只有骨架，玻璃是空的
      const r = hb - y;
      for (let i = -r; i <= r; i++) {
        v.set(i, y, -r, 0); v.set(i, y, r, 0); v.set(-r, y, i, 0); v.set(r, y, i, 0);
      }
      for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) v.set(dx * r, y, dz * r, 1);
    }
    for (let i = -hb - 2; i <= hb + 2; i++) for (let k = -hb - 2; k <= hb + 2; k++) {
      if (Math.abs(i) <= hb && Math.abs(k) <= hb) continue;
      if (Math.abs(i) > hb + 2 || Math.abs(k) > hb + 2) continue;
      v.set(i, 0, k, 3);                                                    // 廣場鋪面
    }
    for (const [dx, dz] of [[1.6, 0], [-1.6, 0], [0, 1.6], [0, -1.6]]) {    // 四座小水池金字塔
      const sb = Math.max(3, Math.round(b * 0.22)) | 1, sh = (sb - 1) / 2;
      for (let y = 0; y <= sh; y++) {
        const r = sh - y;
        for (let i = -r; i <= r; i++) {
          v.set(dx * hb * 0.8 + i, y, dz * hb * 0.8 - r, 2); v.set(dx * hb * 0.8 + i, y, dz * hb * 0.8 + r, 2);
          v.set(dx * hb * 0.8 - r, y, dz * hb * 0.8 + i, 2); v.set(dx * hb * 0.8 + r, y, dz * hb * 0.8 + i, 2);
        }
      }
    }
  } },

{ n: '莫斯科克里姆林塔', lo: 2.5, hi: 15.0, pal: [0x9b2d2a, 0xded8cc, 0x2d634d, 0x25332c, 0xd4af37, 0x1c1c1c],
  /* 來源：AgentData/blueprints/克里姆林塔.js（v1.143 換掉原本那份） */
  gen(v, s) {
    // 1. 核心比例尺寸定義
    const bw = dim(s, 1.80, 7, true);   // 底層方塔外寬（奇數以利置中）
    const bh = dim(s, 1.60, 6);         // 底層紅磚方塔高度
    const mw = dim(s, 1.30, 5, true);   // 中層八角鐘樓外寬（奇數）
    const mh = dim(s, 1.40, 5);         // 中層八角鐘樓高
    const sh = dim(s, 3.20, 11);        // 綠色帳篷頂高
    const sr = (mw - 1) / 2;            // 帳篷頂底半徑

    // 2. 台基與下層城牆基座
    v.box(0, 0, 0, bw + 2, 1, bw + 2, 1);
    v.walls(0, 1, 0, bw, bh, bw, 0, 1);

    // 3. 底層正門拱門與穿堂（前後雙向通行拱洞）
    const aw = dim(s, 0.45, 3, true);
    const ah = dim(s, 0.65, 3);
    const frontZ = (bw - 1) / 2;
    mirrorZ(v, frontZ, (vv, dz) => {
      arch(vv, 0, 1, dz, aw, ah, 1, 1);
    });
    // 內部暗色走廊通道
    v.box(0, 1, 0, aw, ah + Math.floor(aw / 2), bw - 2, 5);

    // 4. 下層立面裝飾（四角白石壁柱 + 中段白色腰線）
    corners4(v, (bw - 1) / 2, (bw - 1) / 2, (vv, x, z) => {
      vv.box(x, 1, z, 1, bh, 1, 1);
    });
    const beltY = 1 + Math.floor(bh * 0.55);
    v.box(0, beltY, 0, bw + 1, 1, bw + 1, 1);

    // 5. 下層頂部女牆（城垛齒狀矮牆）與走道
    const cY = 1 + bh;
    v.box(0, cY, 0, bw + 2, 1, bw + 2, 3); // 頂層外凸石台基
    // 四面雉堞城垛
    const step = 2;
    for (let i = -Math.floor(bw / 2); i <= Math.floor(bw / 2); i += step) {
      v.set(i, cY + 1, -Math.floor((bw + 1) / 2), 1);
      v.set(i, cY + 1, Math.floor((bw + 1) / 2), 1);
      v.set(-Math.floor((bw + 1) / 2), cY + 1, i, 1);
      v.set(Math.floor((bw + 1) / 2), cY + 1, i, 1);
    }

    // 6. 中層八角鐘樓主體（自鳴鐘段）
    const mY = cY + 1;
    v.cyl(0, mY, 0, sr + 0.6, mh, 0, 1); // 八角/圓柱過渡紅磚本體
    v.cyl(0, mY + mh, 0, sr + 1.2, 1, 1); // 鐘樓頂端白石飛簷

    // 7. 四面金色自鳴鐘錶盤（紅場克里姆林宮標誌特徵）
    const clockR = dim(s, 0.32, 2);
    const clockY = mY + Math.floor(mh * 0.5);
    // 前後錶盤
    mirrorZ(v, sr + 0.5, (vv, dz) => {
      for (let dx = -clockR; dx <= clockR; dx++) {
        for (let dy = -clockR; dy <= clockR; dy++) {
          if (Math.hypot(dx, dy) <= clockR + 0.2) {
            paintFrom(vv, dx, clockY + dy, dz > 0 ? dz + 2 : dz - 2, 0, 0, dz > 0 ? -1 : 1, 3, 4);
          }
        }
      }
    });
    // 左右錶盤
    mirrorX(v, sr + 0.5, (vv, dx) => {
      for (let dz = -clockR; dz <= clockR; dz++) {
        for (let dy = -clockR; dy <= clockR; dy++) {
          if (Math.hypot(dz, dy) <= clockR + 0.2) {
            paintFrom(vv, dx > 0 ? dx + 2 : dx - 2, clockY + dy, dz, dx > 0 ? -1 : 1, 0, 0, 3, 4);
          }
        }
      }
    });

    // 8. 綠色帳篷式尖頂（經典俄式八角錐長錐尖）
    const spireY = mY + mh + 1;
    v.taper(0, spireY, 0, sr + 1, 0.4, sh, 2, 1);

    // 9. 尖頂肋條（四方白石裝飾線）
    for (let dy = 0; dy < sh; dy += 2) {
      const curR = (sr + 1) * (1 - dy / sh);
      if (curR >= 0.8) {
        mirrorX(v, Math.round(curR), (vv, x) => vv.set(x, spireY + dy, 0, 1));
        mirrorZ(v, Math.round(curR), (vv, z) => vv.set(0, spireY + dy, z, 1));
      }
    }

    // 10. 頂部鍍金五角星與尖塔頂飾
    const starY = spireY + sh;
    const starH = dim(s, 0.40, 3);
    v.box(0, starY, 0, 1, starH, 1, 4);                     // 金色主軸
    v.box(0, starY + Math.max(1, starH - 2), 0, 3, 1, 1, 4); // 十字星芒橫臂 X
    v.box(0, starY + Math.max(1, starH - 2), 0, 1, 1, 3, 4); // 十字星芒橫臂 Z
    v.set(0, starY + starH, 0, 4);                           // 星芒尖端
  } },

/* ── 動物 ─────────────────────────────────────────────────
   一律面向 −z（跟獅身人面像同一個朝向）。
   軀幹、頭這種大塊量體用 blob()：半徑連續，塊數才跟著尺度連續長。
   尾巴、鼻子、脖子這種彎曲的部件一律「沿整數座標一格一格走」——
   用等分的 t 去走，步距會超過一格，中間一斷就變成會掉下來的懸空部件。 */

{ n: '大象', lo: 7, hi: 26, pal: [0x8f9296, 0x757a7e, 0xece5d3, 0x4c5054],
  gen(v, s) {
    const bx = s * 0.32, by = s * 0.36, bz = s * 0.52;         // 軀幹半徑
    const lh = Math.max(3, Math.round(s * 0.44));              // 腿長
    const cy = lh + by * 0.92;
    blob(v, 0, cy, 0, bx, by, bz, 0);
    /* 四條柱腿一層一層畫，半徑從腳掌往上略微變粗。
       整條腿同一個半徑不行：半徑一跨過某條格線，四條腿十幾層會同時多一圈，
       一階就是三百塊，掃描怎麼掃都對不準目標（長頸鹿實測一步跳 588 塊）。 */
    for (const sx of [-1, 1]) for (const sz of [-1, 1])
      for (let y = 0; y <= lh + 1; y++)
        v.cyl(sx * Math.round(bx * 0.58), y, sz * Math.round(bz * 0.6),
              Math.max(1.4, s * (0.1 + 0.04 * y / (lh + 1))), 1, y === 0 ? 2 : 1);
    /* 頭要明顯長在軀幹「前面」，中間留一段收窄的脖子。
       第一版頭後緣比軀幹前緣還深 0.12s，頭跟身黏成一坨，遠看只是一塊大石頭。 */
    const hr = s * 0.25, hz = -Math.round(bz + hr * 1.1), hy = Math.round(cy - by * 0.02);
    blob(v, 0, Math.round(cy - by * 0.15), -Math.round(bz * 0.95), bx * 0.6, by * 0.52, hr * 0.55, 0);   // 脖子
    blob(v, 0, hy, hz, hr * 0.8, hr, hr * 0.7, 0);             // 頭
    for (const sx of [-1, 1]) {
      // 大耳朵是大象的辨識點：薄薄一片、比頭高、往後張開
      blob(v, sx * Math.round(hr * 0.82), hy + hr * 0.1, hz + Math.round(hr * 0.55), 1.3, hr * 1.4, hr * 1.05, 1);
      paintFrom(v, sx * Math.round(hr * 0.45), Math.round(hy + hr * 0.3), hz, 0, 0, -1, Math.ceil(hr) + 2, 3);  // 眼
    }
    /* 長鼻子要甩到軀幹前面去，不然從側面看跟前腳分不出來 */
    const ty0 = Math.round(hy - hr * 0.35), ty1 = Math.max(1, Math.round(lh * 0.22));
    for (let y = ty0; y >= ty1; y--) {                         // 一格一格往下捲
      const t = (ty0 - y) / Math.max(1, ty0 - ty1);
      v.cyl(0, y, hz - Math.round(hr * 0.6 + Math.sin(t * Math.PI * 0.85) * s * 0.24),
            Math.max(1.2, hr * (0.46 - t * 0.28)), 1, 0);
    }
    for (const sx of [-1, 1])                                  // 象牙
      v.line(sx * Math.round(hr * 0.45), Math.round(hy - hr * 0.35), hz - Math.round(hr * 0.55),
             sx * Math.round(hr * 0.7), Math.round(hy - hr * 1.1), hz - Math.round(hr * 1.5), 2);
    /* 尾巴：先從軀幹裡面往後接一小段尾根再垂下來。
       直接在軀幹後面憑空畫一條垂線是不行的——那個高度的軀幹側面已經收窄，
       線會整條離開身體，變成一組會掉下來的懸空部件。 */
    const tz = Math.round(bz) + 1, ty = Math.round(cy + by * 0.45);
    for (let k = Math.round(bz * 0.5); k <= tz; k++) v.set(0, ty, k, 1);
    for (let i = 1; i <= Math.round(s * 0.26); i++) v.set(0, ty - i, tz, i > s * 0.2 ? 3 : 1);
  } },

{ n: '暴龍', lo: 7, hi: 26, pal: [0x6f8a4f, 0x466030, 0xf2ecd8, 0xd08a4a],
  gen(v, s) {
    const bx = s * 0.21, by = s * 0.28, bz = s * 0.38;
    const lh = Math.max(3, Math.round(s * 0.38));              // 腿長（下半身）
    const cy = lh + by * 0.95;
    blob(v, 0, cy, 0, bx, by, bz, 0);                          // 軀幹
    /* 尾巴往後平伸微微上翹，一片一片收細。這條尾巴是配重：
       沒有它整尊就是一隻站著的大蜥蜴，側影完全不像暴龍。 */
    const tl = Math.max(5, Math.round(s * 0.8));
    for (let k = 1; k <= tl; k++) {
      const t = k / tl;
      const r = Math.max(1, bx * (1 - t * 0.86));
      blob(v, 0, cy - by * 0.3 + t * by * 0.5, Math.round(bz * 0.85) + k, r, r * 1.15, 1.1, t > 0.5 ? 1 : 0);
    }
    const nz0 = -Math.round(bz * 0.72), ny0 = Math.round(cy + by * 0.42);
    const hy = ny0 + Math.round(s * 0.3), hz = nz0 - Math.round(s * 0.26);
    const nn = Math.max(4, Math.round(s * 0.44));
    for (let i = 0; i <= nn; i++) {                                  // 脖子：粗一點、往前上方彎
      const t = i / nn;
      blob(v, 0, Math.round(ny0 + (hy - ny0) * t), Math.round(nz0 + (hz - nz0) * t),
           bx * (0.62 - t * 0.2), bx * (0.7 - t * 0.18), 1.4, 0);
    }
    /* 頭要做大：真的暴龍頭長超過軀幹的四分之一。
       第一版頭只有 bx*0.5 寬，整尊看起來就是一隻站著的大蜥蜴。 */
    const hl = s * 0.32;
    blob(v, 0, hy, hz - Math.round(hl * 0.42), bx * 0.8, s * 0.145, hl * 0.6, 0);     // 頭
    v.box(0, Math.round(hy - s * 0.15), Math.round(hz - hl * 0.48),
          Math.max(3, Math.round(bx * 0.95)), Math.max(2, Math.round(s * 0.06)),
          Math.max(4, Math.round(hl)), 0);                                           // 下顎
    for (const sx of [-1, 1]) {
      for (let k = 0; k <= Math.round(hl); k += 2)                                   // 牙齒
        tint(v, sx * Math.round(bx * 0.45), Math.round(hy - s * 0.13), Math.round(hz - hl * 0.95) + k, 2);
      paintFrom(v, 0, hy + Math.round(s * 0.07), hz - Math.round(hl * 0.45), sx, 0, 0, Math.ceil(bx) + 2, 2);  // 眼
    }
    for (const sx of [-1, 1]) {
      for (let y = 0; y <= lh + 1; y++)                                              // 粗腿（逐層漸變，理由同大象）
        v.cyl(sx * Math.round(bx * 0.7), y, Math.round(bz * 0.1),
              Math.max(1.5, s * (0.072 + 0.05 * y / (lh + 1))), 1, 0);
      v.box(sx * Math.round(bx * 0.7), 0, Math.round(bz * 0.1) - Math.round(s * 0.06),
            Math.max(3, Math.round(s * 0.13)), 1, Math.max(3, Math.round(s * 0.2)), 1);              // 腳掌
      v.box(sx * Math.round(bx * 0.62), Math.round(cy + by * 0.1), Math.round(-bz * 0.55),
            2, 2, Math.max(2, Math.round(s * 0.14)), 3);                                             // 小小的前肢
    }
    for (let k = -Math.round(bz * 0.9); k <= Math.round(bz * 0.9); k += 2)           // 背脊：往下找到背那一格再換色
      paintFrom(v, 0, Math.round(cy + by) - 3, k, 0, 1, 0, 5, 1);
    /* 整尊只有一種顏色的話遠看就是一坨綠色的山——第一版 3033 塊裡有 2838 塊同色。
       腹部換淺色、背上加幾道深色橫紋，輪廓才讀得出來。 */
    for (const p of v.cells()) {
      if (p.c !== 0) continue;
      if (p.y < cy - by * 0.2 && p.z < bz * 0.85) { v.set(p.x, p.y, p.z, 3); continue; }
      if (Math.sin(p.z * 0.5) > 0.6 || p.y > cy + by * 0.72) v.set(p.x, p.y, p.z, 1);
    }
  } },

{ n: '長頸鹿', lo: 8, hi: 34, pal: [0xe0b25c, 0x8a5a2b, 0x5a3a1f, 0xf2e6cf],
  gen(v, s) {
    const bx = s * 0.2, by = s * 0.24, bz = s * 0.38;
    const lh = Math.max(4, Math.round(s * 0.62));              // 長腿
    const cy = lh + by * 0.9;
    blob(v, 0, cy, 0, bx, by, bz, 0);                          // 軀幹（前高後低）
    for (const sx of [-1, 1]) for (const sz of [-1, 1])        // 四條長腿（逐層漸變，理由同大象）
      for (let y = 0; y <= lh + 1; y++)
        v.cyl(sx * Math.round(bx * 0.6), y, sz * Math.round(bz * 0.62),
              Math.max(1.1, s * (0.058 + 0.04 * y / (lh + 1))), 1, y === 0 ? 2 : 0);
    /* 脖子：從肩膀斜斜往上前方長，長度是身體的兩倍——比例不誇張就只是隻馬 */
    const ny0 = Math.round(cy + by * 0.55), nz0 = -Math.round(bz * 0.62);
    const hy = ny0 + Math.max(6, Math.round(s * 0.78)), hz = nz0 - Math.max(2, Math.round(s * 0.2));
    for (let y = ny0; y <= hy; y++) {
      const t = (y - ny0) / Math.max(1, hy - ny0);
      v.cyl(0, y, Math.round(nz0 + (hz - nz0) * t), Math.max(1.2, s * 0.095 * (1 - t * 0.28)), 1, 0);
      if (t > 0.15 && y % 2 === 0)                             // 鬃毛：貼在脖子後緣那一格上
        paintFrom(v, 0, y, Math.round(nz0 + (hz - nz0) * t), 0, 0, 1, Math.ceil(s * 0.1) + 2, 2);
    }
    const hcz = hz - Math.round(s * 0.06);
    blob(v, 0, hy + Math.round(s * 0.06), hcz,
         Math.max(1.6, s * 0.09), Math.max(1.6, s * 0.08), Math.max(2, s * 0.13), 0);   // 頭
    for (const sx of [-1, 1]) {
      v.box(sx * Math.max(1, Math.round(s * 0.05)), hy + Math.round(s * 0.1), hcz,
            1, Math.max(2, Math.round(s * 0.08)), 1, 2);                                // 肉角
      paintFrom(v, sx * Math.max(1, Math.round(s * 0.05)), hy + Math.round(s * 0.06), hcz,
                0, 0, -1, Math.ceil(s * 0.13) + 2, 2);                                  // 眼
    }
    const tz = Math.round(bz) + 1, ty = Math.round(cy + by * 0.45);                     // 尾巴（尾根先接進軀幹）
    for (let k = Math.round(bz * 0.5); k <= tz; k++) v.set(0, ty, k, 0);
    for (let i = 1; i <= Math.round(s * 0.26); i++) v.set(0, ty - i, tz, i > s * 0.19 ? 2 : 0);
    /* 斑塊：整尊畫完之後挑一部分表面換成深色。
       用固定的三角函數組合當花紋，同一個尺寸永遠長一樣，不會每次重蓋都不同。 */
    for (const p of v.cells()) {
      if (p.c !== 0) continue;
      if (Math.sin(p.x * 0.8) + Math.cos(p.z * 0.62) + Math.sin(p.y * 0.5 + p.z * 0.3) > 0.85)
        v.set(p.x, p.y, p.z, 1);
    }
  } },

{ n: '貓咪', lo: 6, hi: 24, pal: [0xd99a52, 0xf5efe3, 0x3a3330, 0xb87a38, 0xd98c8c],
  gen(v, s) {
    /* 坐姿：屁股貼地，胸往前上、頭再上去。四腳站著的貓側影跟狗分不出來，
       坐著才有貓的樣子（而且高度撐得起來，不會攤成一片）。 */
    const hx = s * 0.3, hy = s * 0.44, hz = s * 0.32;
    blob(v, 0, hy, Math.round(hz * 0.5), hx, hy, hz, 0);                       // 臀
    const chY = hy * 1.32, chZ = -Math.round(hz * 0.55);
    blob(v, 0, chY, chZ, hx * 0.76, hy * 0.6, hz * 0.72, 0);                    // 胸
    const hr = s * 0.26, hdY = chY + hy * 0.5 + hr * 0.55, hdZ = chZ - Math.round(hr * 0.3);
    blob(v, 0, hdY, hdZ, hr, hr * 0.9, hr * 0.86, 0);                           // 頭
    /* 口鼻的高度先算出來，眼睛才知道自己要閃到哪裡去：兩件事畫在同一片臉上，
       各自從頭心量自己的高度，而口鼻是後畫的，重疊到就把眼睛整個蓋成白的。
       頭大時差得開，但係數是乘上頭半徑的——s 小的時候頭只有五格高，兩者四捨五入
       到同一排，眼睛（唯一的黑色）在 300 塊時整組消失。 */
    const mw = Math.max(1, Math.round(hr * 0.34));                              // 白口鼻的半寬
    const my = Math.round(hdY - hr * 0.1);                                      // 口鼻最上面那排
    const eyY = Math.max(my + 1, Math.round(hdY + hr * 0.12));                  // 眼：至少高過口鼻一排
    const eyX = Math.round(hr * 0.42);
    for (const sx of [-1, 1]) {
      v.pyramid(sx * Math.round(hr * 0.62), Math.round(hdY + hr * 0.78), Math.round(hdZ),
                Math.max(3, Math.round(hr * 0.7)) | 1, 0);                      // 尖耳朵
      for (let y = 0; y < Math.max(2, Math.round(hy * 0.95)); y++)              // 前腳
        v.cyl(sx * Math.round(hx * 0.5), y, Math.round(chZ - hz * 0.45),
              Math.max(1.2, s * (0.07 + 0.03 * y / Math.max(1, hy))), 1, y === 0 ? 1 : 0);
      paintFrom(v, sx * eyX, eyY, Math.round(hdZ), 0, 0, -1, Math.ceil(hr) + 2, 2);   // 眼
    }
    for (let i = -mw; i <= mw; i++)                                             // 白口鼻＋粉紅鼻頭
      for (let j = -Math.max(1, Math.round(hr * 0.22)); j <= 0; j++)
        paintFrom(v, i, my + j, Math.round(hdZ), 0, 0, -1, Math.ceil(hr) + 2, 1);
    paintFrom(v, 0, Math.round(hdY - hr * 0.08), Math.round(hdZ), 0, 0, -1, Math.ceil(hr) + 2, 4);
    /* 尾巴：從臀部側後方的體表出發，一路垂到地面再往前繞。
       起點一定要落在身體裡（第一版起點在體外，尾端三格整組斷開），
       步距也要小於一格——中間一斷就是一組會掉下來的懸空部件。 */
    const tn = Math.max(18, Math.round(s * 2.6));
    for (let i = 0; i <= tn; i++) {
      const t = i / tn, a = t * 2.3, rr = hz * 0.95 + t * hx * 0.5;
      v.set(Math.round(Math.sin(a) * rr), Math.max(0, Math.round(hy * (1 - t * 1.7))),
            Math.round(hz * 0.5 + Math.cos(a) * rr), t > 0.78 ? 1 : 0);
    }
    // 虎斑條紋＋白肚子：畫完之後換色，位置固定不隨機
    for (const p of v.cells()) {
      if (p.c !== 0) continue;
      if (p.z < chZ - hz * 0.25 && p.y < chY && p.y > hy * 0.5) { v.set(p.x, p.y, p.z, 1); continue; }
      if (Math.sin(p.y * 0.9 + Math.abs(p.x) * 0.25) > 0.78) v.set(p.x, p.y, p.z, 3);
    }
  } },

/* ── 交通工具 ─────────────────────────────────────────────
   全部沿 z 前進、車頭在 −z。輪子用 wheelX（圓面立在 y–z 上），
   車身／機身橫躺的圓柱用 tubeZ。 */

{ n: '蒸汽火車', lo: 5, hi: 30, pal: [0x2f3338, 0x8e2f28, 0xd9b96a, 0x6e747a, 0xf2efe6],
  gen(v, s) {
    /* 縱向每一段都從車頭 zF 往後推算，不各自算自己的中心點。
       第一版底盤與排障器各用自己的中心擺，中間差了三格 z 沒接上，
       整台車只有排障器最底那排踩在地上——3010 塊裡 2976 塊被判成懸空。 */
    const R = Math.max(2.2, s * 0.17);                         // 大動輪半徑
    const wy = Math.max(2, Math.round(R));                     // 車軸高＝輪半徑，輪子才踩得到地面
    const r = s * 0.24, hw = Math.round(r) + 1;                // 鍋爐半徑／底盤半寬
    const L = Math.max(6, Math.round(s * 1.05));               // 鍋爐長
    const cd = Math.max(5, Math.round(s * 0.5)) | 1;           // 駕駛室深（奇數，牆才對稱）
    const pl = Math.max(2, Math.round(s * 0.16));              // 排障器長
    const zF = -Math.round(s * 0.86);                          // 底盤最前端
    const fy = wy + 2;                                         // 底盤上緣
    const zC = zF + L + 1 + (cd - 1) / 2;                      // 駕駛室中心
    for (let k = zF; k <= zF + L + cd; k++) v.box(0, wy, k, hw * 2 + 1, 2, 1, 3);       // 底盤大梁
    /* 鍋爐前粗後細一點（真的鍋爐也是煙箱那頭最粗）。整根同一個半徑不行：
       半徑一跨過格線，整根十幾層會同時多一圈，一階就是一兩百塊。 */
    const by = fy + Math.round(r);
    for (let k = 1; k <= L; k++)
      tubeZ(v, 0, by, zF + k, r * (1 - 0.09 * k / L), 1, 0, Math.max(1.5, r * 0.5));
    for (let j = -Math.ceil(r); j <= Math.ceil(r); j++)                                 // 煙箱門（紅圈白心）
      for (let i = -Math.ceil(r); i <= Math.ceil(r); i++) {
        const d = Math.hypot(i, j);
        if (d <= r + 0.35) v.set(i, by + j, zF, d > r * 0.5 ? 1 : 4);
      }
    const ch = Math.max(3, Math.round(s * 0.34)), chZ = zF + Math.max(2, Math.round(s * 0.14));
    v.cyl(0, by, chZ, Math.max(1.4, s * 0.08), Math.round(r) + ch, 3);                   // 煙囪
    v.cyl(0, by + Math.round(r) + ch, chZ, Math.max(2, s * 0.11), 1, 2);
    v.cyl(0, by, zF + Math.round(L * 0.55), Math.max(1.2, s * 0.07),
          Math.round(r) + Math.max(2, Math.round(s * 0.12)), 2);                        // 汽包（銅色）
    const cwd = hw * 2 + 1, cht = Math.max(4, Math.round(s * 0.6));                     // 駕駛室
    v.walls(0, fy, zC, cwd, cht, cd, 0, 1);
    v.box(0, fy + cht, zC, cwd + 2, 1, cd + 2, 3);                                      // 車頂
    for (const sx of [-1, 1])                                                           // 側窗
      v.box(sx * ((cwd - 1) / 2), fy + Math.round(cht * 0.5), zC,
            1, Math.max(2, Math.round(cht * 0.34)), Math.max(2, Math.round(cd * 0.5)), 4);
    const t = 2, wx = sx => sx > 0 ? hw : -hw - t + 1;
    for (let k = 0; k < 3; k++) for (const sx of [-1, 1])                               // 三對大動輪
      wheelX(v, wx(sx), wy, zF + Math.round(L * (0.3 + k * 0.29)), R, t, 1, 4);
    for (const sx of [-1, 1])                                                           // 前導小輪
      wheelX(v, wx(sx), Math.max(1, wy - Math.round(R * 0.45)), chZ,
             Math.max(1.4, R * 0.5), t, 1, 4);
    for (let k = 0; k < pl; k++) {                                                      // 排障器：斜面接到底盤前緣
      const zz = zF - pl + k, top = Math.max(1, Math.round((k + 1) / pl * fy));
      const half = hw - (pl - 1 - k) * 0.7;
      for (let i = -hw; i <= hw; i++) {
        if (Math.abs(i) > half) continue;
        v.set(i, 0, zz, 1); v.set(i, top, zz, 1);
        if (Math.abs(i) > half - 1) for (let y = 0; y <= top; y++) v.set(i, y, zz, 1);
      }
    }
  } },

{ n: '噴射客機', lo: 8, hi: 36, pal: [0xf2f4f6, 0x2f5f9e, 0x9aa3aa, 0x2b3138, 0xc0392b],
  gen(v, s) {
    const r = s * 0.155;                                       // 機身半徑
    const L = Math.max(10, Math.round(s * 1.6));               // 機身長
    const gy = Math.max(2, Math.round(s * 0.15));              // 起落架高
    const cy = gy + Math.round(r) + 1;
    const zF = -Math.round(L * 0.52);
    /* 機身後段微收（真的客機尾錐也是這樣）。整根同一個半徑不行：
       半徑一跨過格線整根四十幾層同時多一圈，一階三百多塊，掃描對不準目標。 */
    for (let k = 0; k < L; k++)
      tubeZ(v, 0, cy, zF + k, r * (1 - 0.3 * Math.max(0, k / (L - 1) - 0.58) / 0.42), 1, 0,
            Math.max(1.5, r * 0.55));
    for (let k = 1; k <= Math.round(r * 1.8); k++) {           // 機鼻收成圓錐
      const rr = r * Math.sqrt(Math.max(0, 1 - (k / (r * 1.9)) ** 2));
      if (rr < 0.7) break;
      blob(v, 0, cy, zF - k, rr, rr, 1.1, 0);
    }
    /* 主翼：往後掠、往外收窄。後掠角是客機的辨識點，
       翼弦不收窄的話遠看是兩塊長方板，像模型飛機不像客機。 */
    const span = Math.max(4, Math.round(s * 0.6));
    for (let i = 1; i <= span; i++) {
      const t = i / span;
      const chord = Math.max(2, Math.round(s * 0.32 * (1 - t * 0.58)));
      const back = Math.round(s * 0.26 * t);
      for (const sx of [-1, 1])
        v.box(sx * (Math.floor(r) + i), Math.round(cy - r * 0.5), Math.round(s * 0.1) + back, 1, 1, chord, 2);
    }
    const ez = Math.round(s * 0.1) + Math.round(s * 0.26 * 0.42);
    for (const sx of [-1, 1])                                  // 兩具吊掛引擎
      tubeZ(v, sx * (Math.floor(r) + Math.round(span * 0.45)), Math.round(cy - r * 0.5) - 2,
            ez - Math.round(s * 0.12), Math.max(1.4, s * 0.065), Math.max(3, Math.round(s * 0.22)), 3);
    const tz = zF + L - 1;
    const fh = Math.max(4, Math.round(s * 0.42));
    /* 尾翼從機身「裡面」起算往上長，不從機身表面起算：
       表面那一格取整之後常常差一格，尾翼就整片浮在機身上方（實測 300 塊時 8 格斷開）。 */
    for (let j = 0; j <= fh + Math.round(r); j++) {
      const t = Math.max(0, j - Math.round(r)) / fh;
      v.box(0, cy + j, tz - Math.round(s * 0.02) + Math.round(t * s * 0.13),
            1, 1, Math.max(2, Math.round(s * 0.24 * (1 - t * 0.6))), 1);
    }
    for (let i = 1; i <= Math.max(3, Math.round(s * 0.24)); i++)  // 水平尾翼
      for (const sx of [-1, 1])
        v.box(sx * (Math.floor(r * 0.7) + i), Math.round(cy + r * 0.4), tz - Math.round(s * 0.04),
              1, 1, Math.max(2, Math.round(s * 0.14)), 2);
    for (let k = zF + Math.round(r * 2.4); k < tz - Math.round(r); k += 2)   // 舷窗＋腰線
      for (const sx of [-1, 1]) {
        paintFrom(v, 0, cy + Math.round(r * 0.35), k, sx, 0, 0, Math.ceil(r) + 2, 3);
        paintFrom(v, 0, cy - Math.round(r * 0.35), k, sx, 0, 0, Math.ceil(r) + 2, 1);
      }
    const gear = [[0, zF + Math.round(r * 2.2)], [-1, ez], [1, ez]];
    for (const [sx, gz] of gear) {                             // 起落架：要撐到地面才站得住
      v.box(sx * Math.round(r * 1.1), 0, gz, 1, cy, 1, 3);
      v.box(sx * Math.round(r * 1.1), 0, gz, 2, 2, 2, 3);
    }
    for (let i = -1; i <= 1; i++)                              // 駕駛艙窗
      paintFrom(v, i, cy + Math.round(r * 0.45), zF, 0, 0, -1, Math.ceil(r * 2) + 2, 4);
  } },

{ n: '大帆船', lo: 7, hi: 28, pal: [0x6b4a2f, 0x8f6440, 0xf7f2e4, 0x33383d, 0xc0392b],
  gen(v, s) {
    const HL = Math.max(6, Math.round(s * 0.78));              // 半船長（沿 z）
    const hw = s * 0.26;                                       // 最寬半寬
    const hh = Math.max(5, Math.round(s * 0.44));              // 船殼高
    for (let k = -HL; k <= HL; k++) {
      const t = Math.abs(k) / HL;
      const w = hw * Math.sqrt(Math.max(0, 1 - t * t * 0.9));   // 兩端收尖
      if (w < 0.7) continue;
      for (let y = 0; y < hh; y++) {
        const ww = w * (0.4 + 0.6 * (y / (hh - 1)));            // V 型船底
        const n = Math.ceil(ww);
        for (let i = -n; i <= n; i++) {
          if (Math.abs(i) > ww) continue;
          // 中間挖空當船艙，只留船殼與甲板——實心的話光船身就吃掉大半積木
          if (y < hh - 1 && y > ww * 0.6 && Math.abs(i) < ww - 1.3) continue;
          v.set(i, y, k, y >= hh - 2 ? 1 : 0);
        }
      }
    }
    for (let k = -HL; k <= HL; k++) {                           // 船舷欄
      const t = Math.abs(k) / HL;
      const w = hw * Math.sqrt(Math.max(0, 1 - t * t * 0.9));
      if (w < 1.2) continue;
      for (const sx of [-1, 1]) v.set(sx * Math.round(w), hh, k, 1);
    }
    v.box(0, hh, Math.round(HL * 0.62), Math.round(hw * 1.2), Math.max(2, Math.round(s * 0.18)),
          Math.round(HL * 0.45), 0);                            // 船尾樓
    const masts = [[-0.42, 0.86], [0.02, 1.06], [0.46, 0.82]];
    for (const [fz, fh] of masts) {
      const mz = Math.round(HL * fz), mh = Math.max(6, Math.round(s * fh));
      v.cyl(0, hh, mz, Math.max(1.1, s * 0.045), mh, 3);        // 桅杆
      for (let q = 0; q < 2; q++) {                             // 兩道橫桁＋兩面方帆
        const yy = hh + Math.round(mh * (0.34 + q * 0.36));
        const sw = Math.max(4, Math.round(hw * (1.9 - q * 0.4))) | 1;
        // 帆高不能吃滿兩道橫桁之間：兩面帆一貼上就連成一整片牆，看不出是幾張帆
        const sh = Math.max(2, Math.round(mh * 0.26));
        v.box(0, yy, mz, sw + 2, 1, 1, 3);                      // 橫桁
        v.box(0, yy - sh, mz, sw, sh, 1, 2);                    // 帆
      }
      v.set(0, hh + mh, mz, 4);                                 // 桅頂旗
      v.set(1, hh + mh, mz, 4);
    }
    for (let i = 0; i <= Math.round(s * 0.4); i++)              // 船首斜桅
      v.set(0, hh + Math.round(i * 0.35), -HL - i, 3);
    for (let k = -HL; k <= HL; k++) {                           // 舷側金線
      const t = Math.abs(k) / HL;
      const w = hw * Math.sqrt(Math.max(0, 1 - t * t * 0.9));
      if (w < 1.2) continue;
      for (const sx of [-1, 1]) v.set(sx * Math.round(w), hh - 2, k, 1);
    }
  } },

{ n: '雙層巴士', lo: 6, hi: 34, pal: [0xc0392b, 0xf2efe6, 0x2b3138, 0x8e2a20, 0x9aa3aa],
  gen(v, s) {
    /* 比例照真的雙層巴士抓（高 : 長 ≈ 1 : 2.5）。第一版是 1 : 1.5，
       又短又胖又頂著白屋頂，遠看就是一棟紅色小樓房。
       底盤與二樓地板都只鋪外圈：從外面根本看不到中間，鋪滿要多花上千塊，
       那些積木寧可拿去把車身拉長。 */
    const w = Math.max(5, Math.round(s * 0.42)) | 1;
    const h = Math.max(7, Math.round(s * 0.58));
    const d = Math.max(9, Math.round(s * 1.45));
    const R = Math.max(1.8, s * 0.12), t = 2;
    const wy = Math.max(2, Math.round(R));                     // 車軸高＝輪半徑，輪子才踩得到地
    const fy = wy + 1;                                         // 車身底板
    const hd = (d - 1) / 2, hw = (w - 1) / 2;
    v.walls(0, fy - 1, 0, w, 1, d, 4, 2);                      // 底盤裙邊
    v.walls(0, fy, 0, w, h, d, 0, 1);                          // 車身四面
    v.box(0, fy + h, 0, w, 1, d, 0);                           // 紅車頂
    v.walls(0, fy + Math.round(h * 0.5), 0, w - 2, 1, d - 2, 4, 2);   // 二樓地板
    /* 車窗直接在牆面上換色，不挖洞：挖穿的話兩層樓板之間只剩幾根柱子撐著，
       蓋到一半就會被垮塌判定判成沒支撐。 */
    for (const deck of [0.72, 0.22]) {
      const y0 = fy + Math.round(h * deck), wh = Math.max(2, Math.round(h * 0.22));
      for (let k = -hd + 1; k <= hd - 1; k++) {
        v.set(-hw, y0 - 1, k, 1); v.set(hw, y0 - 1, k, 1);      // 上下白窗框
        v.set(-hw, y0 + wh, k, 1); v.set(hw, y0 + wh, k, 1);
        if ((k + hd) % 5 === 0) continue;                       // 窗柱
        for (let j = 0; j < wh; j++) { v.set(-hw, y0 + j, k, 2); v.set(hw, y0 + j, k, 2); }
      }
    }
    /* 車頭：兩層各一整片大擋風玻璃，上面一條路線牌。
       這是雙層巴士最好認的一面——不做的話正面跟側面一樣是一片紅牆。 */
    const gw = Math.max(3, w - 2);
    v.box(0, fy + Math.round(h * 0.56), -hd, gw, Math.max(3, Math.round(h * 0.3)), 1, 2);
    v.box(0, fy + Math.round(h * 0.14), -hd, gw, Math.max(3, Math.round(h * 0.3)), 1, 2);
    v.box(0, fy + h - 1, -hd, gw, 1, 1, 1);                    // 路線牌
    v.box(0, fy + Math.round(h * 0.58), hd, gw, Math.max(2, Math.round(h * 0.26)), 1, 2);   // 車尾窗
    for (const zz of [-Math.round(d * 0.3), Math.round(d * 0.28)])    // 四個輪子（胎黑、輪轂灰）
      for (const sx of [-1, 1])
        wheelX(v, sx > 0 ? hw : -hw - t + 1, wy, zz, R, t, 4, 2);
  } },

/* ── 特殊 ─────────────────────────────────────────────────
   不是建築，就是些看著很想拆掉的東西。 */

{ n: '木魚', lo: 6, hi: 26, pal: [0x8a5a3c, 0x5c3a24, 0xb03a2e, 0xd9b26a, 0x3a2416],
  gen(v, s) {
    const r = s * 0.5, ry = r * 0.82;
    const py = Math.max(2, Math.round(s * 0.1));
    /* 魚身底部要正好落在坐墊上緣。第一版用 round() 算中心高，
       結果坐墊在 y=0、魚身從 y=2 起，中間空一格——整顆魚身被判成懸空（951 格）。 */
    const cy = py + Math.floor(ry * 1.02);
    v.cyl(0, 0, 0, r * 1.15, py, 2, 0);                        // 紅坐墊
    blob(v, 0, cy, 0, r, ry, r * 1.05, 0, Math.max(2, r * 0.3));   // 圓鼓的魚身（中空，敲了才響）
    /* 正面那道大開口是木魚的辨識點：從魚嘴往裡挖一道楔形縫，
       前面開得寬、越往裡越窄，所以一格一格挖，不是一次 carve。 */
    const mouth = Math.max(2, Math.round(r * 0.42));
    for (let k = 0; k <= Math.round(r * 1.1); k++) {
      const mh = Math.max(1, Math.round(mouth * (1 - k / (r * 1.5))));
      v.carve(0, cy - Math.round(mouth * 0.5), -Math.round(r * 1.05) + k, Math.round(r * 1.3), mh, 1);
    }
    for (const sx of [-1, 1])                                  // 兩顆魚眼
      paintFrom(v, sx * Math.round(r * 0.5), Math.round(cy + r * 0.3), 0, 0, 0, -1, Math.ceil(r * 1.1) + 2, 1);
    for (let a = 1; a <= 30; a++) {                            // 背上的螺旋刻紋
      const t = a / 30, ang = t * Math.PI * 3.2;
      paintFrom(v, Math.round(Math.cos(ang) * r * 0.5 * t), cy, Math.round(Math.sin(ang) * r * 0.6 * t),
                0, 1, 0, Math.ceil(ry) + 2, 1);
    }
    v.cyl(0, cy, Math.round(r * 0.6), Math.max(1.2, r * 0.16),
          Math.round(ry) + Math.max(2, Math.round(r * 0.22)), 1);          // 尾鰭把手
    /* 木槌擺在旁邊。它跟木魚沒有相連，但槌柄貼著地面，
       所以垮塌判定看得到它連到地，不會被當成懸空部件掉下來。 */
    const mx = Math.round(r * 1.5), ml = Math.max(4, Math.round(s * 0.5));
    for (let k = 0; k < ml; k++) v.set(mx, 0, Math.round(-r * 0.4) + k, 3);
    v.cyl(mx, 0, Math.round(-r * 0.4) - 1, Math.max(1.4, s * 0.09), Math.max(2, Math.round(s * 0.12)), 3);
  } },

{ n: '大頭像', lo: 2.5, hi: 13.5, pal: [0x3a3d40, 0xe2b995, 0x2b201a, 0xffffff, 0xb85d58, 0xc79672],
  /* 來源：AgentData/blueprints/大頭像.js（v1.143 換掉原本那份） */
  gen(v, s) {
    // 1. 尺度參數計算
    const headW = dim(s, 1.40, 7, true);   // 頭寬（奇數以利中線對齊）
    const headD = dim(s, 1.60, 8);         // 頭深
    const headH = dim(s, 1.80, 9);         // 頭高
    const baseW = headW + 4;               // 底座寬
    const baseD = headD + 4;               // 底座深
    const neckW = dim(s, 0.70, 3, true);   // 頸寬
    const neckD = dim(s, 0.70, 3);         // 頸深
    const neckH = dim(s, 0.50, 2);         // 頸高

    // 2. 底座與頸部
    v.box(0, 0, 0, baseW, 1, baseD, 0);     // 展台大底座（保證最底層面積）
    v.box(0, 1, 0, baseW - 2, 1, baseD - 2, 0); // 底座第二層縮進
    v.box(0, 2, 0, neckW, neckH, neckD, 1); // 頸部

    // 3. 頭部核心主體
    const hy = 2 + neckH;
    v.box(0, hy, 0, headW, headH, headD, 1);

    // 4. 定位計算（以面部朝 -z 方向為正面）
    const faceZ = -Math.floor(headD / 2);
    const midY = hy + Math.floor(headH * 0.45); // 眼鼻中心高度基準

    // 5. 五官：鼻子（立體突出 + 陰影底）
    const noseW = dim(s, 0.28, 1, true);
    const noseH = dim(s, 0.45, 2);
    const noseD = dim(s, 0.25, 1);
    v.box(0, midY - 1, faceZ - noseD, noseW, noseH, noseD, 1);
    v.box(0, midY - 1 - 1, faceZ, noseW, 1, 1, 5); // 鼻下陰影線

    // 6. 五官：眼睛（眼白 + 瞳孔）與 眉毛
    const eyeOffsetX = Math.max(2, Math.round(headW * 0.24));
    const eyeY = midY + 1;
    const eyeW = dim(s, 0.25, 1);
    const eyeH = dim(s, 0.20, 1);

    mirrorX(v, eyeOffsetX, (vv, dx) => {
      // 眼白
      vv.box(dx, eyeY, faceZ, eyeW + 1, eyeH, 1, 3);
      // 瞳孔
      vv.box(dx, eyeY, faceZ, 1, eyeH, 1, 2);
      // 眉毛（在眼睛上方 1 格，微突出 1 格增添立體感）
      vv.box(dx, eyeY + eyeH + 1, faceZ - (noseD > 1 ? 1 : 0), eyeW + 2, 1, 1, 2);
    });

    // 7. 五官：嘴唇與人中
    const lipY = hy + Math.max(1, Math.floor(headH * 0.2));
    const lipW = dim(s, 0.45, 3, true);
    v.box(0, lipY, faceZ, lipW, 1, 1, 4);

    // 8. 兩側耳朵
    const earX = Math.floor(headW / 2) + 1;
    const earY = midY - 1;
    const earH = dim(s, 0.50, 3);
    const earD = dim(s, 0.35, 2);
    mirrorX(v, earX, (vv, dx) => {
      vv.box(dx, earY, 0, 1, earH, earD, 1);
      vv.box(dx, earY + 1, 0, 1, Math.max(1, earH - 2), 1, 5); // 耳窩陰影
    });

    // 9. 髮型：頂部蓬鬆層、後腦勺包覆、鬢角與前額瀏海
    const topY = hy + headH;
    const hairCapH = dim(s, 0.40, 2);
    // 頂部主髮量（稍微比頭寬一圈）
    v.box(0, topY, 0, headW + 2, hairCapH, headD + 2, 2);
    
    // 後腦勺整片頭髮
    const backHairZ = Math.floor(headD / 2) + 1;
    v.box(0, hy + 2, backHairZ, headW + 2, headH + hairCapH - 2, 1, 2);

    // 左右鬢角
    mirrorX(v, earX, (vv, dx) => {
      vv.box(dx, hy + Math.floor(headH * 0.5), -1, 1, Math.floor(headH * 0.5) + hairCapH, headD - 1, 2);
    });

    // 前額瀏海層次（斜覆蓋於前額）
    const fringeY = topY - 1;
    v.box(0, fringeY, faceZ - 1, headW, 2, 1, 2);
    // 兩側微垂瀏海細節
    mirrorX(v, eyeOffsetX, (vv, dx) => {
      vv.box(dx, fringeY - 1, faceZ - 1, 1, 1, 1, 2);
    });
  } },

{ n: '聖誕樹', lo: 6, hi: 30, pal: [0x2f7a4a, 0x1f5c36, 0xc0392b, 0xe8c34a, 0x8a5a3c],
  gen(v, s) {
    const pot = Math.max(2, Math.round(s * 0.16));
    v.cyl(0, 0, 0, Math.max(2.4, s * 0.24), pot, 2, 0);                          // 紅花盆
    v.cyl(0, pot, 0, Math.max(1.4, s * 0.075), Math.max(2, Math.round(s * 0.16)), 4);   // 樹幹
    let y = pot + Math.max(1, Math.round(s * 0.1));
    const tiers = [[0.5, 0.5], [0.38, 0.44], [0.26, 0.38]];                      // 三層針葉，一層比一層小
    const rings = [];
    for (const [fr, fh] of tiers) {
      const r0 = Math.max(2.5, s * fr), hgt = Math.max(3, Math.round(s * fh));
      v.taper(0, y, 0, r0, Math.max(0.8, r0 * 0.14), hgt, 0);
      v.cyl(0, y, 0, r0 + 0.4, 1, 1, 1.6);                                       // 每層下緣壓一圈深色
      rings.push({ y, r0, hgt });
      y += hgt - Math.max(1, Math.round(hgt * 0.24));                            // 上一層咬進下一層
    }
    const top = rings[rings.length - 1];
    y = top.y + top.hgt;
    /* 裝飾球用黃金角散開，位置從圓錐外面往內找到第一格實心的再換色。
       照算出來的座標直接 v.set 的話，有一部分會落在樹外面的空氣裡，
       那就是一顆顆會掉下來的孤立格子。 */
    const n = Math.max(6, Math.round(s * 1.1));
    for (let i = 0; i < n; i++) {
      const g = rings[i % rings.length], t = ((i * 7) % 11) / 11 * 0.72 + 0.12;
      const a = i * 2.39996, rr = g.r0 * (1 - 0.86 * t) + 1.5;
      paintFrom(v, 0, g.y + Math.round(t * g.hgt), 0, Math.cos(a), 0, Math.sin(a),
                Math.round(rr), i % 2 ? 2 : 3);
    }
    const arm = Math.max(2, Math.round(s * 0.11));                               // 金星
    v.cyl(0, y, 0, 1.2, arm, 4);                                                 // 星星底下的短枝
    const sy = y + arm;
    for (let i = -arm; i <= arm; i++) {
      v.set(i, sy, 0, 3); v.set(0, sy + i, 0, 3);                                // 十字
      const q = Math.round((arm - Math.abs(i)) * 0.55);                           // 四道斜角
      v.set(i, sy - q, 0, 3);
      if (Math.abs(i) < arm) v.set(i, sy + q, 0, 3);
    }
  } },

{ n: '巨型骰子', lo: 3.5, hi: 22, pal: [0xf4f1e8, 0x2b2b2b, 0xc0392b, 0xdad5c6],
  gen(v, s) {
    /* 正立方體的塊數只能一階一階跳（邊長 14→15 就是 +23%），怎麼掃都對不上目標。
       改成 P 次方範數的「圓角立方」：半徑 R 連續，塊數就連續——
       順帶也才像顆真骰子，真骰子的稜角本來就是圓的。 */
    const R = s, P = 5, t = Math.max(1.6, R * 0.17), n = Math.ceil(R), yc = Math.round(R);
    const norm = (i, j, k) => Math.pow(Math.pow(Math.abs(i), P) + Math.pow(Math.abs(j), P) +
                                       Math.pow(Math.abs(k), P), 1 / P);
    for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) for (let k = -n; k <= n; k++) {
      const d = norm(i, j, k);
      if (d > R || d < R - t) continue;
      const m = [Math.abs(i), Math.abs(j), Math.abs(k)].sort((a, b) => b - a);
      v.set(i, yc + j, k, m[1] > R * 0.74 ? 3 : 0);            // 稜線一圈壓深一點
    }
    const o = Math.max(1.5, R * 0.42), pr = Math.max(1, R * 0.18);
    /* 點數要從外面往裡找到第一格實心再換色：表面是圓角的，
       直接照平面座標點會有一部分點在空氣裡。 */
    const pip = (ax, sg, a, b, c) => {
      const m = Math.ceil(pr);
      for (let u = -m; u <= m; u++) for (let w = -m; w <= m; w++) {
        if (Math.hypot(u, w) > pr) continue;
        for (let q = n + 1; q >= 0; q--) {
          const p = [0, 0, 0];
          p[ax] = sg * q; p[(ax + 1) % 3] = Math.round(a) + u; p[(ax + 2) % 3] = Math.round(b) + w;
          if (v.has(p[0], yc + p[1], p[2])) { v.set(p[0], yc + p[1], p[2], c); break; }
        }
      }
    };
    const A = [[-o, -o], [o, o]], B = [[-o, -o], [-o, o], [o, -o], [o, o]];
    const faces = [[1, 1, [[0, 0]], 2],                        // 上：一點（紅）
                   [1, -1, B.concat([[-o, 0], [o, 0]]), 1],    // 下：六點
                   [2, -1, A, 1],                              // 前：二點
                   [2, 1, B.concat([[0, 0]]), 1],              // 後：五點
                   [0, 1, [[-o, -o], [0, 0], [o, o]], 1],      // 右：三點
                   [0, -1, B, 1]];                             // 左：四點（對面加起來都是七）
    for (const [ax, sg, pts, c] of faces) for (const [a, b] of pts) pip(ax, sg, a, b, c);
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
  const s = String(c).replace('#', '').trim();
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
const BP_SLOW_MS = 250;         // 產一份藍圖的時間預算（換建築不能卡畫面）
/* 輪廓圖的上限：一張最多幾格寬、幾格高（超過就降採樣）。
   一格積木印成**兩個字元**，等寬字型下才是正方形（字元本身高是寬的兩倍）。 */
const BP_ART_W = 32, BP_ART_H = 24;
/* 門檻是拿內建 48 座校準過的，只留「真的是缺陷」的那幾條：
   包圍盒大小與懸空比例都**不**示警——金門大橋單邊 163、京都五重塔懸空 61%、
   倫敦眼有 156 組小孤島，那些是吊索與輻條，本來就長那樣。示警了只會逼 AI
   去「修」沒壞的東西。最小尺寸做不到 300 塊也一樣：48 座裡有 15 座如此，
   而照著那個示警去縮部件，換來的是部件在小尺寸整組消失——反而更糟。 */

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
    /* 最小那一階給得寬：造型的最小可行尺寸本來就可能比 300 塊大（48 座裡 15 座如此），
       那是「這座就是不能再小」，不是缺陷。硬要縮到 300 只會讓部件消失。 */
    const floor300 = r.t === BP_TARGETS[0] && shown > 10;
    const off = Math.abs(shown) > 10 && !floor300;
    if (off) warn(r.t + ' 塊偏差 ' + shown + '%');
    L.push('  ' + pad(r.t, 5) + ' → ' + pad(r.n, 5) + '  ' +
           pad((shown >= 0 ? '+' : '') + shown + '%', 5) +
           '  s=' + r.s.toFixed(2) + '  ' + (off ? '⚠' : '✔') +
           (floor300 ? '（這座最小就是這麼大，設 300 也會拿到 ' + r.n + ' 格）' : ''));
    if (!off) continue;
    if (isLayers)
      L.push('    修法：字元圖的 lo/hi 是自動反推的，改不動。偏差大表示原圖太小或太細，'
           + '要治本得改寫成 gen(v, s)。');
    else if (dev < 0 && r.s > sh.hi - span * 0.05)
      L.push('    修法：s 已經頂到 hi=' + sh.hi + '，塊數追不上目標。把 hi 調大（例如 ' +
             (sh.hi * 1.4).toFixed(0) + '）。');
    else if (dev > 0 && r.s < sh.lo + span * 0.05)
      L.push('    修法：s 已經壓到 lo=' + sh.lo + '，最小的造型還是太大。把 lo 調小（例如 ' +
             (sh.lo * 0.7).toFixed(1) + '），或把各部件的下限（dim 的第三個參數）改小。');
    else
      L.push('    修法：塊數一階一階跳，階距太大。把跳最兇的那個維度係數調小一點，'
           + '讓別的維度連續變化去補；或者只有真的要對稱的那一個取奇數。');
  }

  /* 「參數錯誤：」是畫圖函式自己丟的（見檔案開頭的 bpArgs）——那一類的修法很具體，
     直接指到參數表就好，不必再叫 AI 去猜「undefined 是從哪裡進迴圈的」。 */
  if (threw) {
    const argErr = rows.some(r => r.err && r.err.indexOf('參數錯誤：') === 0);
    L.push(argErr
      ? '  修法：上面那行是「呼叫函式時參數給錯了」，訊息裡已經指出是哪一支的第幾個參數。'
        + '照〈藍圖製作說明〉3.1／3.2 的參數表補齊——最常見的是最後那個顏色索引 c 忘了給，'
        + '或某個尺寸自己算成了 NaN／undefined。'
      : '  修法：照上面的錯誤訊息修。常見原因是尺寸算出 0 或負數、undefined 進了迴圈、'
        + '或用了這份說明文件裡沒有的函式。');
  }

  /* 尺寸、站幾格、配色 */
  const big = rows.filter(r => !r.err).pop();
  if (big) {
    L.push('尺寸 ' + big.w + '×' + big.h + '×' + big.d + ' 格' +
           '　最底層 ' + big.floor + ' 格' + (big.floor < 3 ? '⚠' : '✔'));
    if (big.floor < 3) {
      warn('最底層只有 ' + big.floor + ' 格');
      L.push('  修法：整棟只靠 ' + big.floor + ' 格站在地上，那幾格一掉就整棟報廢。'
           + '底下補一層地板或底座（遊戲會自動把最低那層貼到地面，不必自己保證 y=0）。');
    }
    if (big.ms > BP_SLOW_MS) {
      warn('產一份要 ' + big.ms + 'ms');
      L.push('產生時間 ' + big.ms + 'ms（預算 ' + BP_SLOW_MS + 'ms）⚠');
      L.push('  修法：造型的迴圈太重，換建築時畫面會卡一下。少用逐格計算的巨大實心量體。');
    }
  }
  if (maxC >= sh.pal.length) {
    bad('pal 不夠：用到索引 ' + maxC + '，只有 ' + sh.pal.length + ' 色');
    L.push('✘ 配色：pal 只有 ' + sh.pal.length + ' 色，但格子用到索引 ' + maxC);
    L.push('  修法：pal 至少要 ' + (maxC + 1) + ' 色（索引從 0 算）。');
  } else {
    L.push('配色 ' + sh.pal.length + ' 色，用到最大索引 ' + maxC + ' ✔');
  }

  /* 小尺寸的部件存活：大尺寸有、小尺寸沒有的顏色，就是「那個部件整組消失了」。
     這是自訂藍圖最常見也最難自己看出來的錯（作者只看 3000 塊那版）。 */
  const small = rows[0], last = big;
  if (small && !small.err && last && last !== small) {
    L.push('');
    L.push(small.t + ' 塊時各色還在不在（跟 ' + last.t + ' 塊比）');
    const parts = [];
    for (const k of Object.keys(last.hist).sort((a, b) => a - b)) {
      const a = last.hist[k], b = small.hist[k] || 0;
      if (b === 0) {
        bad('pal[' + k + '] 在 ' + small.t + ' 塊時整組消失');
        L.push('  ✘ pal[' + k + ']　' + a + ' → 0 格，整組消失');
        L.push('    修法：這一組的尺寸下限太小。用 dim(s, 係數, 下限) 把下限提到 2 以上'
             + '（例如 dim(s, 0.35, 2)），不要寫 Math.round(s * 0.35)。');
      } else {
        parts.push('pal[' + k + '] ' + a + '→' + b);
      }
    }
    if (parts.length) L.push('  ✔ ' + parts.join('　'));
  }

  /* 連通性：拿遊戲自己的那份判定（26 鄰居、從最低層往上長），報告才跟實際行為一致。
     這一段**只報數字不示警**：懸空是允許的，48 座裡倫敦眼有 156 組
     小孤島（輻條與車廂），都是故意的。要判斷「這是意外嗎」只有作者自己知道，
     所以附一句怎麼看，讓 AI 自己對照它畫了什麼。 */
  L.push('');
  try {
    const b = makeBlueprint(idx, BP_TARGETS[BP_TARGETS.length - 1]);
    const float = b.floats.reduce((n, g) => n + g.cells.length, 0);
    const tiny = b.floats.filter(g => g.cells.length <= 4);
    L.push('連通性（' + b.count + ' 格）：連到地面 ' + (b.count - float) + ' 格、懸空 ' +
           float + ' 格' + (b.floats.length ? '（' + b.floats.length + ' 組，其中 ' +
           tiny.length + ' 組只有 ≤4 格）' : ''));
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
                     checkBlueprint, bpIndexOf, BP_TARGETS,
                     cleanPaste, bpFileName, importBlueprint,
                     dim, ringOf, rowOf, mirrorX, mirrorZ, stampY, arch, archRow, stairs, hipRoof,
                     boxTaper, windowGrid, lattice, corners4, tubeZ, wheelX,
                     tint, paintFrom, blob, limb };

