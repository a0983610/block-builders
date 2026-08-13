/* ============================================================
   藍圖：48 座建築與物件的 voxel 產生器（地標 36 ＋ 動物 4 ＋ 交通工具 4 ＋ 特殊 4）
   每座建築是一個吃尺度參數 s 的函式，畫出一堆 (x,y,z,顏色索引) 格子。
   積木數不是寫死的——makeBlueprint() 會掃 s 找出最接近目標積木數的那個尺寸，
   所以同一座金字塔可以是 300 塊也可以是 3000 塊。
   這支檔案不碰 three.js，純資料，方便單獨測。
   ============================================================ */
'use strict';

/* ── voxel 收集器 ──────────────────────────────────────────
   用 Map 去重，後寫的蓋掉先寫的——很多造型是「先填實心再挖洞」。 */
function VOX() { this.m = new Map(); }
VOX.prototype = {
  constructor: VOX,
  set(x, y, z, c) {
    x = Math.round(x); y = Math.round(y); z = Math.round(z);
    if (y < 0) return;
    this.m.set(x + ':' + y + ':' + z, c);
  },
  del(x, y, z) { this.m.delete(Math.round(x) + ':' + Math.round(y) + ':' + Math.round(z)); },
  has(x, y, z) { return this.m.has(Math.round(x) + ':' + Math.round(y) + ':' + Math.round(z)); },

  /* 實心長方體。x0/z0 是中心，y0 是底面所在層 */
  box(x0, y0, z0, w, h, d, c) {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h)); d = Math.max(1, Math.round(d));
    const hx = (w - 1) / 2, hz = (d - 1) / 2;
    for (let y = 0; y < h; y++) for (let i = 0; i < w; i++) for (let k = 0; k < d; k++)
      this.set(x0 - hx + i, y0 + y, z0 - hz + k, c);
  },
  /* 只留四面牆，t 是牆厚 */
  walls(x0, y0, z0, w, h, d, c, t) {
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
    const hx = (w - 1) / 2, hz = (d - 1) / 2;
    for (let y = 0; y < h; y++) for (let i = 0; i < w; i++) for (let k = 0; k < d; k++)
      this.del(x0 - hx + i, y0 + y, z0 - hz + k);
  },
  /* 圓柱（voxel 近似）。hollow 給牆厚就只留外環 */
  cyl(x0, y0, z0, r, h, c, hollow) {
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
    step = step || 1;
    let w = b, y = 0;
    while (w >= 1) { this.box(x0, y0 + y, z0, w, 1, w, c); w -= step * 2; y++; }
  },
  /* 圓頂（只做殼，實心太吃積木） */
  dome(x0, y0, z0, r, c, squash) {
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
    layers = layers || 2;
    for (let l = 0; l < layers; l++)
      this.walls(x0, y0 + l, z0, w - l * 2, 1, d - l * 2, c, 2);
  },
  /* 兩點之間拉一條線（鐵塔斜撐、吊索用） */
  line(x0, y0, z0, x1, y1, z1, c) {
    const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)));
    for (let i = 0; i <= n; i++) {
      const t = n ? i / n : 0;
      this.set(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, z0 + (z1 - z0) * t, c);
    }
  },
  /* 山牆屋頂（神廟、房子用） */
  gable(x0, y0, z0, w, d, c) {
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
  fn(v, dx, dz); fn(v, -dx, dz); fn(v, dx, -dz); fn(v, -dx, -dz);
}

/* 臥式圓柱（沿 z 軸躺著）。VOX.cyl 畫的是站著的柱子，
   火車鍋爐、飛機機身、引擎這種橫躺的圓柱得另外來。hollow 給牆厚就只留外殼。 */
function tubeZ(v, x0, y0, z0, r, len, c, hollow) {
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
function tint(v, x, y, z, c) { if (!v.has(x, y, z)) return false; v.set(x, y, z, c); return true; }

/* 從外面往裡掃，找到第一格實心的就換色。曲面（球面的臉、圓角的骰子）
   要在「表面」上畫東西就得這樣找，算不出正確的表面座標。 */
function paintFrom(v, x, y, z, dx, dy, dz, n, c) {
  for (let i = n; i >= 0; i--)
    if (tint(v, x + dx * i, y + dy * i, z + dz * i, c)) return true;
  return false;
}

/* 實心（或帶殼）橢球——動物的軀幹、頭、木魚的身體都靠它。
   半徑刻意不取整：塊數才會隨尺度連續變化。整數邊長的量體會一階一階跳，
   跳幅大到怎麼掃都對不上目標塊數（骰子那座就是為此改用連續半徑的圓角立方）。 */
function blob(v, x0, y0, z0, rx, ry, rz, c, shell) {
  const nx = Math.ceil(rx), ny = Math.ceil(ry), nz = Math.ceil(rz);
  const inner = shell ? 1 - shell / Math.min(rx, ry, rz) : -1;
  for (let i = -nx; i <= nx; i++) for (let j = -ny; j <= ny; j++) for (let k = -nz; k <= nz; k++) {
    const d = Math.hypot(i / rx, j / ry, k / rz);
    if (d > 1.02 || d < inner) continue;
    v.set(x0 + i, y0 + j, z0 + k, c);
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
  const n = Math.max(Math.max(1, min || 1), Math.round(s * k));
  return odd ? (n | 1) : n;
}

/* 平均排成一圈：fn(v, x, z, 角度, 第幾個)。柱廊、環形塔樓、輻條都是這件事
   （48 座裡有 28 處自己寫 cos/sin 迴圈）。a0 是起始角，預設從 +x 出發。 */
function ringOf(v, n, r, fn, x0, z0, a0) {
  n = Math.max(1, Math.round(n));
  for (let i = 0; i < n; i++) {
    const a = (a0 || 0) + i / n * Math.PI * 2;
    fn(v, (x0 || 0) + Math.cos(a) * r, (z0 || 0) + Math.sin(a) * r, a, i);
  }
}

/* 左右／前後對稱各放一次。corners4 是四個角，這兩支是一對。 */
function mirrorX(v, dx, fn) { fn(v, dx); fn(v, -dx); }
function mirrorZ(v, dz, fn) { fn(v, dz); fn(v, -dz); }

/* 拱門：w 是開口寬（會逼成奇數，不然拱心落在兩格之間），h 是直柱段高度，
   t 是牆厚（沿 z）。開口總高 = h + (w−1)/2。
   c 給了就先補一片比開口大一圈的牆再挖；不給就只挖洞（用在已經有牆的立面上）。 */
function arch(v, x0, y0, z0, w, h, t, c) {
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

/* 斜撐格架：兩根柱子之間拉 n 段交叉斜撐（鐵塔、桁架橋、電塔）。
   {x0,z0} 與 {x1,z1} 是兩根柱子的位置，從 y 往上拉 h 高、分 n 段。
   斜線上的格子彼此只在對角相鄰，遊戲的支撐判定認 26 鄰居，所以撐得住。 */
function lattice(v, o) {
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

{ n: '羅馬競技場', lo: 6, hi: 36, pal: [0xd8c9a6, 0xbfae8b, 0x9c8c6d],
  gen(v, s) {
    const rx = Math.round(s), rz = Math.round(s * 0.78), h = Math.max(4, Math.round(s * 0.62));
    v.ellipseRing(0, 0, 0, rx, rz, h, 0, 3);
    // 每層挖一圈拱洞，這是競技場的招牌立面
    for (let tier = 0; tier < 3; tier++) {
      const y0 = 1 + Math.floor(h * tier / 3);
      const hh = Math.max(1, Math.floor(h / 3) - 2);
      if (y0 + hh > h) break;
      const N = Math.max(8, Math.round(rx * 1.6));
      for (let i = 0; i < N; i++) {
        const a = i / N * Math.PI * 2;
        const x = Math.cos(a) * (rx - 1), z = Math.sin(a) * (rz - 1);
        for (let y = 0; y < hh; y++) for (let t = -3; t <= 3; t++)
          v.del(x + Math.cos(a) * t * 0.5, y0 + y, z + Math.sin(a) * t * 0.5);
      }
      for (let i = 0; i < N; i++) {
        const a = i / N * Math.PI * 2;
        for (let t = -3; t <= 3; t++)
          v.set(Math.cos(a) * (rx - 1) + Math.cos(a) * t * 0.5, y0 + hh,
                Math.sin(a) * (rz - 1) + Math.sin(a) * t * 0.5, 2);
      }
    }
    v.ellipseRing(0, 0, 0, rx * 0.55, rz * 0.55, 1, 1, 2); // 場中央的競技場地
  } },

{ n: '比薩斜塔', lo: 6, hi: 56, pal: [0xefe7d2, 0xd9cdb0, 0xbdb094],
  gen(v, s) {
    const h = Math.round(s), r = Math.max(2.5, s * 0.2), lean = 0.1;
    const tiers = 7, th = Math.max(3, Math.floor(h / (tiers + 1)));
    for (let t = 0; t < tiers; t++) {
      for (let k = 0; k < th; k++) {
        const y = t * th + k, cx = y * lean;     // 這個位移讓它「斜」
        if (k === 0) v.cyl(cx, y, 0, r + 0.8, 1, 1, 2);            // 每層樓板出簷
        else {
          // 一圈柱子（不是實心牆）——比薩斜塔的招牌就是這幾層柱廊
          const N = Math.max(9, Math.round(r * 2.8));
          for (let i = 0; i < N; i++) {
            const a = i / N * Math.PI * 2;
            v.set(cx + Math.cos(a) * r, y, Math.sin(a) * r, k === th - 1 ? 1 : 0);
          }
          if (k === th - 1) v.cyl(cx, y, 0, r + 0.4, 1, 1, 1.4);
        }
      }
    }
    const cy = tiers * th, cx = cy * lean;
    v.cyl(cx, cy, 0, r * 0.72, Math.max(2, Math.round(h * 0.1)), 2, 1.5);   // 鐘樓
    v.cyl(cx, cy + Math.max(2, Math.round(h * 0.1)), 0, r * 0.8, 1, 1, 0);
  } },

{ n: '巴黎凱旋門', lo: 6, hi: 38, pal: [0xe3d7bc, 0xcabd9e, 0xb0a184],
  gen(v, s) {
    const w = Math.round(s * 1.05), h = Math.round(s), d = Math.round(s * 0.42);
    v.box(0, 0, 0, w, h, d, 0);
    const aw = Math.round(w * 0.42), ah = Math.round(h * 0.62);
    for (let y = 0; y < ah; y++) {                // 中央大拱：上半圓
      const half = y > ah - aw / 2 ? Math.round(Math.sqrt(Math.max(0, (aw / 2) ** 2 - (y - (ah - aw / 2)) ** 2))) : aw / 2;
      v.carve(0, y, 0, half * 2 + 1, 1, d + 2);
    }
    corners4(v, Math.round(w * 0.34), 0, (vv, dx) => {   // 側面兩個小拱
      const sw = Math.round(w * 0.16), sh = Math.round(h * 0.3);
      for (let y = 0; y < sh; y++) {
        const half = y > sh - sw / 2 ? Math.round(Math.sqrt(Math.max(0, (sw / 2) ** 2 - (y - (sh - sw / 2)) ** 2))) : sw / 2;
        vv.carve(dx, y, 0, d + 2, 1, half * 2 + 1);
      }
    });
    v.box(0, h, 0, w, Math.max(1, Math.round(h * 0.06)), d, 1);
    v.box(0, h - Math.round(h * 0.14), 0, w + 1, 1, d + 1, 2);
  } },

{ n: '艾菲爾鐵塔', lo: 9, hi: 92, pal: [0x9c7b53, 0x7e6242, 0xc9a978],
  gen(v, s) {
    const h = Math.round(s);
    // 底部外張、上部近乎垂直——鐵塔的輪廓全靠這條曲線
    const R = y => Math.max(1, s * 0.24 * Math.pow(1 - y / h, 2.4) + s * 0.022 + 0.9);
    for (let y = 0; y < h; y++) {
      const n = Math.round(R(y));
      /* 下半段的塔腳要粗。真的鐵塔下面是四座巨大的桁架墩，
         整根都只有一格粗的話，尺度一放大就整座空掉——3000 塊的目標
         也永遠填不滿（實測只長到 1806 塊就頂到尺度上限）。
         但只有大版本才加粗：h 不到 45 的時候整座才十幾層高、底邊十來格寬，
         柱子一變 2×2 就跟斜撐黏成實心，400 塊的版本會變成一座階梯金字塔。 */
      const t = h >= 45 && y < h * 0.44 ? 2 : 1;
      corners4(v, n, n, (vv, dx, dz) => {
        for (let a = 0; a < t; a++) for (let b = 0; b < t; b++)
          vv.set(dx - Math.sign(dx) * a, y, dz - Math.sign(dz) * b, y > h * 0.8 ? 2 : 0);
      });
    }
    // 四個面各拉 X 形斜撐。注意不能每隔幾層畫「一整圈」橫桿，
    // 那會讓鐵塔變成千層蛋糕（第一版就是這樣）。
    /* 塔越大斜撐分段越多，才填得滿也才像真的。分段別再更密了：
       試過 s/4.6，3000 塊時下半段的 X 撐整片黏成實心，底下的四道大拱全被埋掉，
       遠看像個階梯金字塔而不是鐵塔。要塊數就讓它長高，不是把面填滿。 */
    const segs = Math.max(7, Math.round(s / 7));
    for (let i = 0; i < segs; i++) {
      const y0 = Math.round(h * i / segs), y1 = Math.round(h * (i + 1) / segs) - 1;
      if (y1 <= y0) continue;
      const n0 = Math.round(R(y0)), n1 = Math.round(R(y1));
      for (const sg of [1, -1]) {
        v.line(-n0, y0, sg * n0, n1, y1, sg * n1, 1);
        v.line(n0, y0, sg * n0, -n1, y1, sg * n1, 1);
        v.line(sg * n0, y0, -n0, sg * n1, y1, n1, 1);
        v.line(sg * n0, y0, n0, sg * n1, y1, -n1, 1);
      }
    }
    [0.30, 0.58].forEach(f => {                   // 兩層觀景台
      const y = Math.round(h * f), n = Math.round(R(y)) + 1;
      v.walls(0, y, 0, n * 2 + 1, 1, n * 2 + 1, 2, 1);
      v.walls(0, y + 1, 0, n * 2 - 1, 1, n * 2 - 1, 2, 1);
    });
    const an = Math.round(R(0)), ay = Math.max(2, Math.round(h * 0.15));
    for (const sg of [1, -1]) for (let t = -an; t <= an; t++) {   // 底部四道大拱
      const yy = Math.round(ay * Math.sqrt(Math.max(0, 1 - (t / an) ** 2)));
      v.set(t, yy, sg * an, 1); v.set(sg * an, yy, t, 1);
    }
    v.box(0, h, 0, 1, Math.max(3, Math.round(h * 0.09)), 1, 2);
  } },

{ n: '自由女神', lo: 8, hi: 56, pal: [0x6ec3a8, 0x9fd8c4, 0x8a7a5e, 0xf5c542],
  gen(v, s) {
    const ped = Math.max(3, Math.round(s * 0.3)), pw = Math.max(5, Math.round(s * 0.42));
    v.box(0, 0, 0, pw, ped, pw, 2);
    v.box(0, ped, 0, pw - 2, Math.max(2, Math.round(ped * 0.3)), pw - 2, 2);
    const y0 = ped + Math.max(2, Math.round(ped * 0.3)), bh = Math.round(s * 0.55);
    v.taper(0, y0, 0, Math.max(2, s * 0.16), Math.max(1.5, s * 0.09), bh, 0);  // 長袍
    const hy = y0 + bh;
    v.box(0, hy, 0, 3, 3, 3, 1);                                              // 頭
    for (let i = 0; i < 7; i++) {                                             // 冠冕七道光芒
      const a = (i / 6 - 0.5) * Math.PI * 1.1;
      v.set(Math.sin(a) * 3, hy + 3 + Math.abs(Math.cos(a)) * 1.5, Math.cos(a) * 3 - 1, 1);
    }
    const ah = Math.round(s * 0.36);                                          // 舉火炬的右手
    for (let i = 0; i < ah; i++) v.set(Math.round(s * 0.14) + i * 0.25, hy - 1 + i, 0, 0);
    v.box(Math.round(s * 0.14) + ah * 0.25, hy - 1 + ah, 0, 2, 2, 2, 3);
    for (let i = 0; i < Math.round(s * 0.2); i++) v.set(-s * 0.13, hy - 2 - i * 0.3, i * 0.5, 0);  // 抱書的左手
  } },

{ n: '倫敦大笨鐘', lo: 8, hi: 70, pal: [0xc9a15c, 0xa8813f, 0x4d6b4a, 0xf2e3b0],
  gen(v, s) {
    /* 塔身寬度只能是奇數（鐘面靠 (w−1)/2 貼在牆面上，偶數會浮出一格），
       所以 w 一跳就是 2 格，塊數跟著一階一階跳。係數 0.2 那階之間差到 1077 塊
       （2687 直接跳 3764），目標 3000 永遠差 10%；改成 0.17 讓塔瘦一點、
       同一個 w 撐得更高，階距縮小到 3000 只差 1%——順帶也更接近真的大笨鐘（高寬比 8:1）。 */
    const h = Math.round(s), w = Math.max(3, Math.round(s * 0.17)) | 1;
    v.walls(0, 0, 0, w, h, w, 0, 1);
    for (let y = 0; y < h; y += Math.max(4, Math.round(h / 7))) v.box(0, y, 0, w + 1, 1, w + 1, 1);
    const cy = Math.round(h * 0.82);              // 四面鐘面
    v.box(0, cy, (w - 1) / 2 + 1, w - 2, w - 2, 1, 3);
    v.box(0, cy, -(w - 1) / 2 - 1, w - 2, w - 2, 1, 3);
    v.box((w - 1) / 2 + 1, cy, 0, 1, w - 2, w - 2, 3);
    v.box(-(w - 1) / 2 - 1, cy, 0, 1, w - 2, w - 2, 3);
    v.box(0, h, 0, w + 2, 1, w + 2, 1);
    v.gable(0, h + 1, 0, w + 2, w + 2, 2);        // 尖屋頂
    v.box(0, h + 1 + Math.ceil((w + 2) / 2), 0, 1, Math.max(2, Math.round(h * 0.08)), 1, 3);
  } },

{ n: '泰姬瑪哈陵', lo: 5, hi: 40, pal: [0xf2ece0, 0xdcd3c2, 0xc0b6a2, 0xb98f4a],
  gen(v, s) {
    const pw = Math.round(s * 1.5);
    v.box(0, 0, 0, pw, 1, pw, 1);                                   // 台基（一層就好，厚了純浪費積木）
    const mw = Math.round(s * 0.82) | 1, mh = Math.max(4, Math.round(s * 0.38));
    v.walls(0, 1, 0, mw, mh, mw, 0, 2);
    v.box(0, 1 + mh, 0, mw, 1, mw, 2);
    // 中央大圓頂用洋蔥頂而不是半球——泰姬的辨識度全在這顆鼓起來又收尖的頂
    const dr = Math.max(3.5, s * 0.3), dy = 2 + mh;
    v.cyl(0, dy, 0, dr * 0.92, Math.max(2, Math.round(s * 0.1)), 2, 0);     // 鼓座
    const dh = Math.max(5, Math.round(dr * 1.7));
    v.onion(0, dy + Math.max(2, Math.round(s * 0.1)), 0, dr, dh, 0);
    v.box(0, dy + Math.max(2, Math.round(s * 0.1)) + dh, 0, 1, Math.max(2, Math.round(s * 0.14)), 1, 3);
    corners4(v, Math.round(mw * 0.34), Math.round(mw * 0.34), (vv, dx, dz) => {  // 四座小圓亭
      vv.cyl(dx, 1 + mh, dz, Math.max(1.6, s * 0.1), 2, 2, 0);
      vv.onion(dx, 3 + mh, dz, Math.max(1.8, s * 0.11), Math.max(3, Math.round(s * 0.14)), 0);
    });
    corners4(v, Math.round(pw * 0.42), Math.round(pw * 0.42), (vv, dx, dz) => {   // 四座尖塔
      const th = Math.round(s * 0.72);
      vv.cyl(dx, 2, dz, Math.max(1.2, s * 0.07), th, 1, 0);
      vv.dome(dx, 2 + th, dz, Math.max(1.5, s * 0.09), 0, 1.2);
    });
    // 正面大拱門
    const aw = Math.round(mw * 0.34), ah = Math.round(mh * 0.7);
    for (let y = 0; y < ah; y++) {
      const half = y > ah - aw / 2 ? Math.round(Math.sqrt(Math.max(0, (aw / 2) ** 2 - (y - (ah - aw / 2)) ** 2))) : aw / 2;
      v.carve(0, 2 + y, (mw - 1) / 2, half * 2 + 1, 1, 5);
    }
  } },

{ n: '萬里長城', lo: 5, hi: 60, pal: [0xa9a396, 0x8d887c, 0xc2bbab],
  gen(v, s) {
    const L = Math.round(s * 2.6), wallH = Math.max(4, Math.round(s * 0.24));
    const towerEvery = Math.max(8, Math.round(L / 4));
    // 步進 0.5 而不是 1：牆蜿蜒起來時每步橫移可能超過一格，
    // 用整數步會在轉彎處留下一個一個缺口（第一版就斷成好幾截）
    for (let i = 0; i < L; i += 0.5) {
      const x = i - L / 2;
      const z = Math.sin(i * 0.1) * s * 0.55;                          // 蜿蜒
      const rise = Math.round(Math.abs(Math.sin(i * 0.045)) * s * 0.34); // 隨山勢起伏
      const H = wallH + rise;
      for (let k = -1; k <= 1; k++) v.box(x, 0, z + k, 1, H, 1, 0);
      if (Math.round(i * 2) % 4 === 0) { v.set(x, H, z - 1, 2); v.set(x, H, z + 1, 2); }  // 女牆
      if (Math.abs(i % towerEvery) < 0.25) {                            // 烽火台
        const th = H + Math.max(4, Math.round(s * 0.3));
        v.walls(x, 0, z, 5, th, 5, 1, 1);
        v.box(x, th, z, 7, 1, 7, 2);
        for (let k = -3; k <= 3; k += 2) { v.set(x + k, th + 1, z - 3, 2); v.set(x + k, th + 1, z + 3, 2); }
      }
    }
  } },

{ n: '日本姬路城', lo: 6, hi: 38, pal: [0xf0ece2, 0xd8d2c4, 0x3f4a52, 0x6b5540],
  gen(v, s) {
    v.box(0, 0, 0, Math.round(s * 1.4), 1, Math.round(s * 1.4), 3);   // 石垣天守台
    let y = 1, w = Math.round(s * 0.95);
    for (let t = 0; t < 5; t++) {                    // 五層天守，每層縮一圈、出一片簷
      const th = Math.max(2, Math.round(s * 0.17));
      v.walls(0, y, 0, w, th, w, t === 4 ? 1 : 0, 1);
      y += th;
      v.eave(0, y, 0, w + 4, w + 4, 2, 2);           // 出簷比牆寬，日式屋頂的重點
      y += 2; w = Math.max(3, w - Math.round(s * 0.16));
      if (w < 3) break;
    }
    v.gable(0, y, 0, w + 2, w + 2, 2);
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

{ n: '台北 101', lo: 6, hi: 72, pal: [0x9fb8ad, 0x7d9a8e, 0xc7dbd2, 0xb0c4bb],
  gen(v, s) {
    const h = Math.round(s), base = Math.max(3, Math.round(s * 0.15));
    const pw = base * 2 + 3;
    v.walls(0, 0, 0, pw, Math.max(3, Math.round(h * 0.13)), pw, 3, 2);   // 裙樓
    let y = Math.max(3, Math.round(h * 0.13));
    v.walls(0, y, 0, pw, 1, pw, 2, 3); y++;                              // 裙樓屋頂（只鋪外圈，中間看不到）
    // 八節是造型的必要條件，所以小尺寸時只能壓薄每節的層數，否則這座的下限降不下來
    const segH = Math.max(2, Math.round(h * 0.085));
    for (let i = 0; i < 8; i++) {
      // 八個斗狀節：每節下窄上寬。收放幅度要夠大（0.68→1.14），
      // 只差一兩格的話遠看就只是一根方柱，完全看不出 101 的特徵。
      for (let k = 0; k < segH; k++) {
        const f = 0.68 + 0.46 * (k / (segH - 1));
        const w = Math.round(base * f) * 2 + 1;
        v.walls(0, y + k, 0, w, 1, w, k === segH - 1 ? 2 : 0, 1);
      }
      y += segH;
    }
    const tw = Math.max(3, base * 2 - 3);
    v.walls(0, y, 0, tw, Math.max(2, Math.round(h * 0.045)), tw, 1, 1);
    y += Math.max(2, Math.round(h * 0.045));
    v.taper(0, y, 0, Math.max(1.6, tw * 0.4), 1, Math.max(2, Math.round(h * 0.05)), 2);
    v.box(0, y + Math.max(2, Math.round(h * 0.05)), 0, 1, Math.max(3, Math.round(h * 0.1)), 1, 2);
  } },

{ n: '雪梨歌劇院', lo: 6, hi: 30, pal: [0xf4f2ec, 0xc8c4b8, 0x8fa5b4],
  gen(v, s) {
    /* 長軸取 x。台座只做側牆＋一層甲板：實心的話光台座就吃掉一千多塊，
       帆殼反而沒積木可用，整座就矮成一坨（實測 1400 塊有 1393 塊在台座上）。 */
    const PW = Math.max(11, Math.round(s * 2.2)), PD = Math.max(7, Math.round(s * 0.9));
    v.walls(0, 0, 0, PW, 2, PD, 1, 1);
    v.box(0, 2, 0, PW, 1, PD, 2);

    /* 一片帆殼＝立在台座上的半個超橢球殼，刻意做成明顯高過寬。

       試過兩種更「忠於原作」的做法，在這個積木尺度下都不行：
       - 斷面是拱、沿長軸長大的號角：從斜上方只看得到兩片側壁，像石柱。
       - 球面切下來的一瓣（真實歌劇院就是這樣蓋的）：一瓣的底邊落在離球心 R 遠的
         地方，切出來是又窄又薄的刀片，不是殼。
       所以改成「排列取勝」——認得出來靠的是一排由小到大、一片比一片高，
       不是單片曲面有多正確。

       P < 2 的超橢球：側面往內凹、頂端收成尖。用正圓（P = 2）的話頂是圓的，
       一排下來像幾顆大石頭，完全沒有帆的感覺。 */
    const P = 1.5;
    const sup = (a, b) => Math.pow(Math.pow(a, P) + Math.pow(b, P), 1 / P);
    const shell = (cx, cz, R, tall, c) => {
      const nr = Math.ceil(R) + 1, nh = Math.ceil(R * tall) + 1;
      // 只留朝 +z 的那一半：背面陡、正面弧線往下鋪 → 這才是「帆」的側面
      for (let i = -nr; i <= nr; i++) for (let k = 0; k <= nr; k++) {
        const flat = Math.hypot(i, k);
        if (flat > R + 1) continue;
        for (let j = 0; j <= nh; j++) {
          if (Math.abs(sup(flat, j / tall) - R) > 0.7) continue;
          v.set(cx + i, 2 + j, cz + k, c);
        }
      }
      // 切面那一圈補上殼邊，不然從側後方看是一個被剖開的碗
      for (let a = 0; a <= 48; a++) {
        const t = a / 48;
        const yy = R * t, fx = Math.pow(Math.max(0, Math.pow(R, P) - Math.pow(yy, P)), 1 / P);
        v.set(cx + fx, 2 + yy * tall, cz, 1);
        v.set(cx - fx, 2 + yy * tall, cz, 1);
      }
    };
    const TALL = 1.75;
    /* 三片，尺寸差距拉到 1 : 1.5 : 2.3，而且底座之間不重疊只相切。
       交疊過多時三片會融成一坨土丘——這點試錯了四五版才確定：
       在這個積木尺度下，「看得出是幾片」比「單片曲面有多正確」重要得多。 */
    const seq = [0.22, 0.34, 0.50];
    let x = -s * 0.62;
    for (let i = 0; i < seq.length; i++) {
      shell(Math.round(x), Math.round(-s * 0.18), s * seq[i], TALL, 0);
      if (i + 1 < seq.length) x += s * (seq[i] + seq[i + 1]);
    }
    // 側前方兩片小殼（歌劇廳與餐廳），破掉「整排一樣大小」的呆板感
    shell(Math.round(-s * 0.34), Math.round(s * 0.22), s * 0.17, TALL, 0);
    shell(Math.round(s * 0.16), Math.round(s * 0.26), s * 0.13, TALL, 0);
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

{ n: '復活節島摩艾', lo: 6, hi: 38, pal: [0x8a8071, 0x6f6659, 0xa39887],
  gen(v, s) {
    const h = Math.round(s);
    v.box(0, 0, 0, Math.round(s * 0.95), Math.max(2, Math.round(h * 0.1)), Math.round(s * 0.75), 1);  // 祭壇基座
    const by = Math.max(2, Math.round(h * 0.1));
    // 摩艾的比例：頭幾乎占整尊的六成，肩窄。第一版頭跟身差不多大，看起來就是塊磚
    const bw = Math.round(s * 0.44) | 1, bd = Math.round(s * 0.3) | 1;
    const bh = Math.round(h * 0.3);
    v.box(0, by, 0, bw, bh, bd, 0);                                                       // 身
    const ny = by + bh;
    v.box(0, ny, 0, Math.round(bw * 0.72) | 1, Math.max(1, Math.round(h * 0.04)), bd, 0);  // 頸（收一圈）
    const hy = ny + Math.max(1, Math.round(h * 0.04)), hh = Math.round(h * 0.44);
    const hw = Math.round(s * 0.38) | 1, hd = Math.round(s * 0.34) | 1;
    v.box(0, hy, 0, hw, hh, hd, 0);                                                        // 頭：又高又長
    const fz = (hd - 1) / 2;
    v.box(0, hy + Math.round(hh * 0.62), fz, hw, Math.max(1, Math.round(hh * 0.1)), 1, 2);  // 厚眉稜
    for (const sx of [-1, 1])                                                              // 深陷的眼窩
      v.carve(sx * Math.round(hw * 0.24), hy + Math.round(hh * 0.5), fz, 2, 2, 2);
    v.box(0, hy + Math.round(hh * 0.3), fz, 2, Math.round(hh * 0.34), 2, 0);               // 長鼻
    v.box(0, hy + Math.round(hh * 0.16), fz, Math.round(hw * 0.4), 2, 1, 2);               // 抿著的嘴
    for (const sx of [-1, 1])                                                              // 長耳
      v.box(sx * ((hw - 1) / 2), hy + Math.round(hh * 0.3), 0, 1, Math.round(hh * 0.4), 2, 0);
    v.cyl(0, hy + hh, 0, Math.max(2, hw * 0.42), Math.max(2, Math.round(h * 0.1)), 2, 0);  // 普卡奧紅石帽
  } },

{ n: '獅身人面像', lo: 7, hi: 40, pal: [0xd6c299, 0xbfa87d, 0xe8dab6],
  gen(v, s) {
    const L = Math.round(s * 1.7), bw = Math.round(s * 0.4) | 1, bh = Math.max(3, Math.round(s * 0.3));
    // 身體壓低、頭抬高——第一版頭跟身同高，整尊看起來就是一根長方條
    v.box(0, 0, Math.round(L * 0.16), bw, bh, Math.round(L * 0.7), 0);          // 獅身
    for (const sx of [-1, 1]) {                                                 // 往前伸的前爪
      v.box(sx * Math.round(bw * 0.32), 0, -Math.round(L * 0.3), 3, Math.max(2, Math.round(bh * 0.45)), Math.round(L * 0.42), 1);
      v.box(sx * Math.round(bw * 0.32), 0, -Math.round(L * 0.5), 3, 1, 3, 1);
    }
    // 頭要抬得夠高、頭巾要往兩側張開，整尊才不會是一條長方磚
    const cz = -Math.round(L * 0.16);
    v.box(0, bh, cz, Math.round(bw * 0.62) | 1, Math.max(3, Math.round(s * 0.2)), Math.round(bw * 0.62) | 1, 0);  // 胸／頸
    const hy = bh + Math.max(3, Math.round(s * 0.2));
    const hw = Math.round(s * 0.34) | 1, hd = Math.round(s * 0.3) | 1, hh = Math.max(4, Math.round(s * 0.38));
    v.box(0, hy, cz, hw, hh, hd, 0);                                            // 法老頭
    const nz = cz - (hd - 1) / 2;
    for (const sx of [-1, 1]) {                                                 // 涅美斯頭巾：往兩側張開
      v.box(sx * ((hw + 3) / 2), hy + Math.round(hh * 0.2), cz, 3, Math.round(hh * 0.8), hd - 2, 2);
      v.box(sx * ((hw + 1) / 2), hy, cz, 1, hh, hd, 2);
    }
    v.box(0, hy + hh, cz, hw + 6, Math.max(2, Math.round(s * 0.1)), hd + 1, 2);  // 頭巾頂
    for (const sx of [-1, 1]) v.carve(sx * Math.round(hw * 0.22), hy + Math.round(hh * 0.6), nz, 2, 2, 2);  // 眼
    v.box(0, hy + Math.round(hh * 0.42), nz, 2, Math.round(hh * 0.3), 2, 0);     // 鼻
    v.box(0, hy + Math.round(hh * 0.86), nz, 3, 2, 2, 2);                        // 眉心聖蛇
    v.box(0, hy - Math.round(hh * 0.1), nz, 3, Math.round(hh * 0.28), 2, 0);      // 假鬍鬚
  } },

{ n: '聖巴索大教堂', lo: 7, hi: 42, pal: [0xc74b3a, 0xe8dfc8, 0x3f7fb5, 0xe0a83c, 0x4a9e6b],
  gen(v, s) {
    v.box(0, 0, 0, Math.round(s * 1.1), 2, Math.round(s * 1.1), 1);
    const mainH = Math.round(s * 0.72);
    v.taper(0, 2, 0, Math.max(2.5, s * 0.2), Math.max(2, s * 0.16), mainH, 1, 2);
    v.onion(0, 2 + mainH, 0, Math.max(3, s * 0.24), Math.max(4, Math.round(s * 0.3)), 3);
    const R = Math.round(s * 0.42);
    for (let i = 0; i < 4; i++) {                    // 四座配塔，洋蔥頂顏色各異
      const a = i / 4 * Math.PI * 2 + Math.PI / 4;
      const x = Math.cos(a) * R, z = Math.sin(a) * R;
      const th = Math.round(mainH * 0.62);
      v.taper(x, 2, z, Math.max(1.8, s * 0.13), Math.max(1.5, s * 0.11), th, 1, 1);
      v.onion(x, 2 + th, z, Math.max(2, s * 0.15), Math.max(3, Math.round(s * 0.2)), [0, 2, 4, 3][i]);
    }
  } },

{ n: '聖家堂', lo: 8, hi: 54, pal: [0xd8c9a8, 0xc0ad86, 0xa8946c, 0xdcb45a],
  gen(v, s) {
    v.walls(0, 0, 0, Math.round(s * 0.8), Math.round(s * 0.3), Math.round(s * 0.9), 0, 2);
    const spires = [[0, 0, 1.0], [-0.3, -0.3, 0.8], [0.3, -0.3, 0.8], [-0.3, 0.3, 0.72], [0.3, 0.3, 0.72],
                    [-0.15, -0.42, 0.62], [0.15, -0.42, 0.62], [-0.15, 0.42, 0.58], [0.15, 0.42, 0.58]];
    for (const [fx, fz, f] of spires) {              // 一叢高低錯落的尖塔
      const x = Math.round(s * 0.75 * fx), z = Math.round(s * 0.9 * fz), h = Math.round(s * f);
      v.taper(x, 0, z, Math.max(1.6, s * 0.09), 0.7, h, 1, 1);
      for (let y = Math.round(h * 0.3); y < h; y += 4) v.cyl(x, y, z, Math.max(1.8, s * 0.1), 1, 2, 0);
      v.box(x, h, z, 1, Math.max(2, Math.round(s * 0.08)), 1, 3);
    }
  } },

{ n: '美國國會大廈', lo: 5, hi: 46, pal: [0xf0ece1, 0xd8d2c3, 0xbdb6a5, 0xc9b98e],
  gen(v, s) {
    const w = Math.round(s * 1.7), d = Math.round(s * 0.62), h = Math.max(4, Math.round(s * 0.3));
    v.box(0, 0, 0, w, 2, d, 2);
    v.walls(0, 2, 0, w, h, d, 0, 2);
    v.box(0, 2 + h, 0, w, 1, d, 1);
    for (let i = 0; i < Math.round(w / 3); i++) {    // 正面列柱
      const x = -w / 2 + 1.5 + i * 3;
      v.box(x, 2, (d - 1) / 2 + 1, 1, h, 1, 0);
    }
    // 圓頂是這棟的主角，要夠大、還要墊高的鼓座才看得到；第一版整顆被屋頂吃掉
    const dy = 3 + h, dr = Math.max(4, s * 0.42), drum = Math.max(3, Math.round(s * 0.26));
    v.cyl(0, dy, 0, dr + 1.2, 1, 1, 0);
    for (let i = 0; i < Math.max(10, Math.round(dr * 2)); i++) {       // 鼓座列柱
      const a = i / Math.max(10, Math.round(dr * 2)) * Math.PI * 2;
      v.box(Math.cos(a) * dr, dy + 1, Math.sin(a) * dr, 1, drum, 1, 0);
    }
    v.cyl(0, dy + 1 + drum, 0, dr + 1, 1, 1, 0);
    v.dome(0, dy + 2 + drum, 0, dr, 1, 1.15);
    const ty = dy + 2 + drum + Math.ceil(dr * 1.15);
    v.cyl(0, ty, 0, Math.max(1.6, dr * 0.3), Math.max(2, Math.round(s * 0.1)), 3, 0);   // 塔燈
    v.box(0, ty + Math.max(2, Math.round(s * 0.1)), 0, 1, Math.max(2, Math.round(s * 0.09)), 1, 3);
  } },

{ n: '金門大橋', lo: 8, hi: 80, pal: [0xc0392b, 0xa02f22, 0x8d8d8d, 0xdd5540],
  gen(v, s) {
    const L = Math.round(s * 2.2), th = Math.round(s * 0.85), tx = Math.round(L * 0.26);
    /* 跨距用整數半跨 hL 來跑，不用 ±L/2：L 是奇數時 −L/2 是 .5，整條橋的 x 都變半格，
       下面的 `x % 3 === 0` 就永遠不成立——那個尺度的橋整座長不出吊索
       （實測 s=56 只有 1636 塊，比小一號的 s=50 的 1847 還少）。 */
    const hL = Math.floor(L / 2);
    /* 橋面鋪滿兩道主纜之間（z 從 −2 到 2）。原本只鋪 3 格寬，兩側的吊索是吊在
       橋面外面的空氣裡，而且橋是六車道的——鋪滿才對，順帶也才吃得動 3000 塊。 */
    for (let x = -hL; x <= hL; x++) for (let z = -2; z <= 2; z++)
      v.set(x, Math.round(s * 0.26), z, 2);                            // 橋面
    for (const sx of [-1, 1]) {                                        // 橋塔
      for (const z of [-2, 2]) v.box(sx * tx, 0, z, 2, th, 2, 0);
      for (let k = 0; k < 3; k++) v.box(sx * tx, th * (0.45 + k * 0.26), 0, 2, 1, 5, 1);
    }
    for (let x = -hL; x <= hL; x++) {                                  // 主纜（懸鏈）
      let y;
      if (Math.abs(x) <= tx) y = th - (th - s * 0.34) * (1 - (x / tx) ** 2);
      else y = th * (1 - (Math.abs(x) - tx) / (hL - tx) * 0.85);
      for (const z of [-2, 2]) v.set(x, Math.round(y), z, 3);
      if (x % 3 === 0) for (const z of [-2, 2])
        for (let yy = Math.round(s * 0.26); yy < y; yy += 2) v.set(x, yy, z, 3);   // 吊索
    }
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

{ n: '中世紀城堡', lo: 7, hi: 42, pal: [0x9a9384, 0x7f786a, 0x6b4a30, 0x8b3a3a],
  gen(v, s) {
    const w = Math.round(s * 1.4), wh = Math.max(4, Math.round(s * 0.3));
    v.walls(0, 0, 0, w, wh, w, 0, 1);
    const hw = (w - 1) / 2;
    for (let i = -hw; i <= hw; i += 2) {             // 雉堞
      v.set(i, wh, -hw, 1); v.set(i, wh, hw, 1); v.set(-hw, wh, i, 1); v.set(hw, wh, i, 1);
    }
    corners4(v, hw, hw, (vv, dx, dz) => {            // 四角塔
      // 這裡的下限刻意壓低：下限訂太高的話，不管尺度參數怎麼調，
      // 四座塔就吃掉七八百塊積木，這座城堡永遠做不出「幾百塊」的版本
      const th = wh + Math.round(s * 0.26);
      vv.cyl(dx, 0, dz, Math.max(1.5, s * 0.16), th, 0, 2);
      vv.taper(dx, th, dz, Math.max(1.9, s * 0.19), 0.8, Math.max(2, Math.round(s * 0.2)), 3);
    });
    const kh = wh + Math.round(s * 0.46);            // 主堡
    v.walls(0, 0, 0, Math.round(s * 0.5), kh, Math.round(s * 0.5), 1, 2);
    v.gable(0, kh, 0, Math.round(s * 0.5) + 2, Math.round(s * 0.5) + 2, 3);
    v.carve(0, 0, hw, 3, Math.round(wh * 0.6), 4);   // 城門
    v.box(0, 0, hw + 2, 5, 2, 3, 2);                 // 吊橋
  } },

{ n: '北京天壇', lo: 6, hi: 44, pal: [0x2f6fa8, 0xe8e2d2, 0xc9302c, 0xd8b44a],
  gen(v, s) {
    for (let t = 0; t < 3; t++)                      // 三層漢白玉圓台（每層一格高，實心圓盤很吃積木）
      v.cyl(0, t, 0, s * (0.78 - t * 0.13), 1, 1, 0);
    let y = 3;
    for (let t = 0; t < 3; t++) {                    // 三重藍瓦簷
      const r = s * (0.52 - t * 0.12);
      v.cyl(0, y, 0, r, Math.max(2, Math.round(s * 0.14)), 2, r * 0.6);
      y += Math.max(2, Math.round(s * 0.14));
      v.taper(0, y, 0, r + 1.6, r * 0.5, Math.max(2, Math.round(s * 0.12)), 0);
      y += Math.max(2, Math.round(s * 0.12));
    }
    v.box(0, y, 0, 1, Math.max(2, Math.round(s * 0.12)), 1, 3);
  } },

{ n: '吳哥窟', lo: 5, hi: 42, pal: [0x9c8f78, 0x82765f, 0xb3a68c, 0x6f6455],
  gen(v, s) {
    for (let t = 0; t < 3; t++)                      // 三層方台
      v.walls(0, t * Math.max(2, Math.round(s * 0.1)), 0, Math.round(s * (1.5 - t * 0.32)),
              Math.max(2, Math.round(s * 0.1)), Math.round(s * (1.5 - t * 0.32)), t === 1 ? 1 : 0, 2);
    const y0 = 3 * Math.max(2, Math.round(s * 0.1));
    // 玉米狀尖塔。半徑要夠粗（0.3×s）塔身才看得出輪廓，
    // 第一版 0.16 又乘上比例係數，五座塔全糊成一團
    const tower = (x, z, f) => {
      const th = Math.max(6, Math.round(s * 1.05 * f));
      for (let y = 0; y < th; y++) {
        const r = Math.max(1.2, s * 0.3 * f * Math.pow(1 - y / th, 0.75));
        v.cyl(x, y0 + y, z, r, 1, y % 3 === 0 ? 3 : 0, y > th * 0.2 ? Math.max(1, r * 0.55) : 0);
      }
      v.taper(x, y0 + th, z, Math.max(1.4, s * 0.1 * f), 0.6, Math.max(3, Math.round(s * 0.16)), 2);
    };
    tower(0, 0, 1);
    const d = Math.round(s * 0.5);
    corners4(v, d, d, (vv, dx, dz) => tower(dx, dz, 0.6));
    for (let z = 0; z < Math.round(s * 1.1); z++) v.box(0, 0, Math.round(s * 0.8) + z, 5, 1, 1, 1);  // 參道
  } },

{ n: '雅典帕德嫩神廟', lo: 7, hi: 44, pal: [0xefe9d8, 0xd6cfba, 0xbdb59e],
  gen(v, s) {
    const w = Math.round(s * 1.25) | 1, d = Math.round(s * 0.72) | 1, ch = Math.max(4, Math.round(s * 0.42));
    // 階基：只畫台階外圈，中間反正被神殿本體壓住
    for (let t = 0; t < 3; t++) v.walls(0, t, 0, w + (2 - t) * 2, 1, d + (2 - t) * 2, 1, 2);
    const hx = (w - 1) / 2, hz = (d - 1) / 2;
    for (let i = -hx; i <= hx; i += 3) for (let k = -hz; k <= hz; k += 3) {
      if (Math.abs(i) < hx && Math.abs(k) < hz) continue;    // 只有外圈立柱
      v.box(i, 3, k, 1, ch, 1, 0);
    }
    v.walls(0, 3, 0, w - 6, ch, d - 6, 2, 1);                // 內殿
    v.box(0, 3 + ch, 0, w + 1, 2, d + 1, 1);                 // 額枋
    let ww = w + 1, y = 5 + ch;                              // 山牆
    while (ww >= 1) { v.box(0, y, -hz - 1, ww, 1, 1, 2); v.box(0, y, hz + 1, ww, 1, 1, 2); ww -= 2; y++; }
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

{ n: '巴黎聖母院', lo: 5, hi: 50, pal: [0xd5cdb8, 0xbdb49d, 0xa39a83, 0x6b8fa8],
  gen(v, s) {
    const w = Math.round(s * 0.66) | 1, L = Math.round(s * 1.3), bh = Math.max(5, Math.round(s * 0.44));
    const front = -Math.round(L / 2);
    const navZ = Math.round(L * 0.16), navD = Math.round(L * 0.68);
    v.walls(0, 0, navZ, w, bh, navD, 0, 2);                                  // 中殿
    v.gable(0, bh, navZ, w, navD, 1);
    /* 正立面是一整片實牆，雙塔從它兩端往上長。
       第一版把牆做成薄殼又加了一排落地扶壁柱，遠看整棟糊成一片柱林。 */
    const fw = Math.round(w * 1.22) | 1, td = Math.max(3, Math.round(s * 0.22)) | 1;
    const fz = front + (td - 1) / 2;
    const tw = Math.max(3, Math.round(fw * 0.36)) | 1;
    const th = bh + Math.max(5, Math.round(s * 0.5));
    v.box(0, 0, fz, fw, bh + Math.max(2, Math.round(s * 0.1)), td, 0);
    for (const sx of [-1, 1]) {                                              // 兩座方塔
      const tx = sx * Math.round((fw - tw) / 2);
      v.box(tx, 0, fz, tw, th, td, 0);
      v.walls(tx, th - Math.round(s * 0.16), fz, tw, Math.round(s * 0.16), td, 1, 1);   // 塔頂鏤空鐘室
      v.box(tx, th, fz, tw + 2, 1, td + 2, 2);
    }
    v.carve(0, 1, fz, Math.max(3, Math.round(fw * 0.2)), Math.round(bh * 0.4), td + 2);  // 中央大門
    v.cyl(0, Math.round(bh * 0.72), front, Math.max(2, s * 0.12), 1, 3, 0);              // 玫瑰窗
    for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) {                   // 飛扶壁：只做拱、不落地成柱
      const z = navZ - navD / 2 + Math.round(navD * (0.2 + i * 0.22));
      const x0 = (w - 1) / 2, top = Math.round(bh * 0.72);
      for (let d = 0; d <= 3; d++) v.set(sx * (x0 + 3 - d), top - d * d * 0.35, z, 2);
      v.box(sx * (x0 + 3), 0, z, 1, Math.round(bh * 0.42), 1, 2);
    }
    const sy = bh + Math.ceil(w / 2);                                         // 十字交叉處的尖塔
    v.taper(0, sy, navZ, Math.max(1.8, s * 0.1), 0.6, Math.max(5, Math.round(s * 0.46)), 2);
  } },

{ n: '嚴島神社鳥居', lo: 7, hi: 44, pal: [0xd0402c, 0xa62f20, 0x2f2f2f, 0xe8654a],
  gen(v, s) {
    const h = Math.round(s), w = Math.round(s * 0.75), r = Math.max(2, Math.round(s * 0.1));
    for (const sx of [-1, 1]) {
      v.taper(sx * w, 0, 0, r, r * 0.82, h, 0);                            // 主柱
      v.taper(sx * (w + Math.round(s * 0.3)), 0, 0, r * 0.6, r * 0.5, Math.round(h * 0.55), 2);  // 稚兒柱
      for (let x = 0; x <= Math.round(s * 0.3); x++)
        v.set(sx * (w + x), Math.round(h * 0.5), 0, 2);
    }
    for (let x = -w - Math.round(s * 0.34); x <= w + Math.round(s * 0.34); x++) {  // 笠木（最上橫樑，兩端翹起）
      const lift = Math.round(Math.abs(x / w) ** 2 * s * 0.08);
      for (let k = -1; k <= 1; k++) { v.set(x, h + lift, k, 2); v.set(x, h + 1 + lift, k, 2); }
    }
    for (let x = -w - 1; x <= w + 1; x++) for (let k = -1; k <= 1; k++)      // 貫（第二道橫樑）
      v.set(x, Math.round(h * 0.78), k, 0);
    v.box(0, Math.round(h * 0.78) + 2, 0, 3, Math.round(h * 0.22), 2, 3);    // 額束
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

{ n: '莫斯科克里姆林塔', lo: 8, hi: 52, pal: [0xb04a3a, 0x8e3a2c, 0x2f7a4a, 0xd8b44a],
  gen(v, s) {
    const h = Math.round(s * 0.62), w = Math.max(5, Math.round(s * 0.3)) | 1;
    v.walls(0, 0, 0, w + 4, Math.round(h * 0.42), w + 4, 0, 2);            // 城牆基座
    const hw = (w + 3) / 2;
    for (let i = -hw; i <= hw; i += 2) {                                    // 燕尾雉堞
      v.box(i, Math.round(h * 0.42), -hw, 1, 2, 1, 1);
      v.box(i, Math.round(h * 0.42), hw, 1, 2, 1, 1);
      v.box(-hw, Math.round(h * 0.42), i, 1, 2, 1, 1);
      v.box(hw, Math.round(h * 0.42), i, 1, 2, 1, 1);
    }
    v.walls(0, 0, 0, w, h, w, 0, 2);
    v.box(0, h, 0, w + 2, 1, w + 2, 1);
    const cy = h + 1;
    v.walls(0, cy, 0, w - 2, Math.round(h * 0.3), w - 2, 0, 1);
    v.gable(0, cy + Math.round(h * 0.3), 0, w, w, 2);                       // 綠色尖頂
    const ty = cy + Math.round(h * 0.3) + Math.ceil(w / 2);
    v.box(0, ty, 0, 1, Math.max(2, Math.round(s * 0.1)), 1, 3);
    v.box(0, ty + Math.max(2, Math.round(s * 0.1)), 0, 3, 3, 3, 3);         // 紅寶石星
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
    for (const sx of [-1, 1]) {
      v.pyramid(sx * Math.round(hr * 0.62), Math.round(hdY + hr * 0.78), Math.round(hdZ),
                Math.max(3, Math.round(hr * 0.7)) | 1, 0);                      // 尖耳朵
      for (let y = 0; y < Math.max(2, Math.round(hy * 0.95)); y++)              // 前腳
        v.cyl(sx * Math.round(hx * 0.5), y, Math.round(chZ - hz * 0.45),
              Math.max(1.2, s * (0.07 + 0.03 * y / Math.max(1, hy))), 1, y === 0 ? 1 : 0);
      paintFrom(v, sx * Math.round(hr * 0.42), Math.round(hdY + hr * 0.12), Math.round(hdZ),
                0, 0, -1, Math.ceil(hr) + 2, 2);                                // 眼
    }
    const mw = Math.max(1, Math.round(hr * 0.34));                              // 白口鼻＋粉紅鼻頭
    for (let i = -mw; i <= mw; i++)
      for (let j = -Math.max(1, Math.round(hr * 0.22)); j <= 0; j++)
        paintFrom(v, i, Math.round(hdY - hr * 0.1) + j, Math.round(hdZ), 0, 0, -1, Math.ceil(hr) + 2, 1);
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

{ n: '大頭像', lo: 6, hi: 24, pal: [0xe3a878, 0x3a3230, 0xf7f3ea, 0xb5544a, 0xc98f62],
  gen(v, s) {
    const r = s * 0.62;
    const nk = Math.max(2, Math.round(s * 0.2));
    v.box(0, 0, 0, Math.round(r * 1.6) | 1, 1, Math.round(r * 1.6) | 1, 4);      // 台座
    v.cyl(0, 1, 0, Math.max(2, r * 0.4), nk, 4);                                 // 脖子
    const cy = 1 + nk + Math.round(r * 0.9);
    /* 頭做成殼：實心的話 3000 塊只夠一顆直徑 18 的頭，
       殼可以做到 30 出頭，五官才畫得開（跟摩艾那尊實心方頭剛好對比）。 */
    blob(v, 0, cy, 0, r * 0.88, r, r * 0.84, 0, Math.max(2, r * 0.24));
    /* 五官一律「從最前面往裡找到第一格實心再換色」——
       頭是球面，直接算座標會把顏色點在空氣裡。 */
    const front = (x, y, c) => {
      for (let k = -Math.ceil(r) - 2; k <= 0; k++) if (v.has(x, y, k)) { v.set(x, y, k, c); return true; }
      return false;
    };
    const er = Math.max(1, Math.round(r * 0.17)), ex = Math.round(r * 0.38), ey = Math.round(cy + r * 0.16);
    for (const sx of [-1, 1]) {
      for (let i = -er; i <= er; i++) for (let j = -er; j <= er; j++) {
        if (Math.hypot(i, j) > er) continue;
        front(sx * ex + i, ey + j, 2);                                           // 眼白
      }
      for (let i = -Math.max(0, er - 1); i <= Math.max(0, er - 1); i++)          // 瞳孔
        for (let j = -Math.max(0, er - 1); j <= Math.max(0, er - 1); j++)
          if (Math.hypot(i, j) <= er - 1) front(sx * ex + i, ey + j, 1);
      for (let i = -Math.round(r * 0.22); i <= Math.round(r * 0.22); i++)        // 眉毛
        front(sx * ex + i, ey + er + Math.max(2, Math.round(r * 0.16)), 1);
      blob(v, sx * Math.round(r * 0.94), cy - r * 0.04, Math.round(r * 0.1), 2.0, r * 0.32, r * 0.24, 0);  // 耳朵
    }
    /* 鼻子要往外凸兩三格才看得出來——只換顏色不改輪廓的話正面是一片平的 */
    const nh = Math.max(3, Math.round(r * 0.34));
    for (let j = 0; j < nh; j++) {
      const out = 1 + Math.round(j / nh * Math.max(1, r * 0.16));
      blob(v, 0, cy + Math.round(r * 0.12) - j, -Math.round(r * 0.8) - out,
           Math.max(1, r * 0.05 + j * 0.18), 1, out + 0.6, j > nh - 2 ? 4 : 0);
    }
    const mw = Math.round(r * 0.34);                                             // 笑起來的嘴
    for (let i = -mw; i <= mw; i++)
      front(i, Math.round(cy - r * 0.42) - Math.round((1 - (i / mw) ** 2) * r * 0.14), 3);
    // 頭髮：頭頂連同兩側鬢角整片換深色，髮線做一點起伏才不像戴安全帽
    for (const p of v.cells()) {
      if (p.c !== 0) continue;
      const lim = cy + r * 0.42 + Math.sin(p.x * 0.55) * r * 0.1 + Math.cos(p.z * 0.4) * r * 0.06;
      if (p.y > lim || (p.z > r * 0.3 && p.y > cy - r * 0.1)) v.set(p.x, p.y, p.z, 1);
    }
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
     它們靠旁邊的結構撐著。把每一組懸空部件、以及附近撐著它的格子記下來，
     旁邊被打掉之後這一組就會整組掉，而不是一律豁免、怎麼打都不動。 */
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
    if (g.cells.length > 2000) continue;           // 太大就不算，props 留空 = 永遠不掉
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
      這裡會把它包成一個會縮放的 gen()，建材數滑桿才推得動。
   2. gen：直接給產生函式，跟內建那 48 座同一套 VOX API（進階用）。 */
const CUSTOM_MIN = 180, CUSTOM_MAX = 3600;   // 縮放範圍要蓋住建材數滑桿的 300–3000

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

/* ── 藍圖體檢 ─────────────────────────────────────────────
   產出一份**純文字報告**，用途是「貼回去給產出這份藍圖的 AI」。
   為什麼要這樣設計：一般玩家手上不會有能跑指令的 AI，流程是把
   〈藍圖製作說明.md〉＋圖片貼進網頁版 AI、拿回一支 .js、放進 blueprints/，
   所以回饋也必須是「一段可以複製貼上的文字」才接得回去。
   因此每個 ✘ 後面都跟一行「修法」——AI 看不到遊戲原始碼，只能靠報告知道要改哪裡。
   遊戲裡的按鈕與 tools/check-bp.cjs 共用這一支，兩邊輸出一模一樣。 */
const BP_TARGETS = [300, 800, 1600, 3000];
const BP_SLOW_MS = 250;         // 產一份藍圖的時間預算（換建築不能卡畫面）
/* 門檻是拿內建 48 座校準過的，只留「真的是缺陷」的那幾條：
   包圍盒大小與懸空比例都**不**示警——金門大橋單邊 163、吳哥窟懸空 83%、
   倫敦眼有 156 組小孤島，那些是吊索與輻條，本來就長那樣。示警了只會逼 AI
   去「修」沒壞的東西。最小尺寸做不到 300 塊也一樣：48 座裡有 15 座如此，
   而照著那個示警去縮部件，換來的是部件在小尺寸整組消失——反而更糟。 */

function bpIndexOf(which) {
  if (typeof which === 'number') return which >= 0 && which < SHAPES.length ? which : -1;
  if (typeof which === 'string' && which) return SHAPES.findIndex(sh => sh.n === which);
  for (let i = SHAPES.length - 1; i >= 0; i--) if (SHAPES[i].custom) return i;   // 預設：最後加進來的自訂藍圖
  return -1;
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
                floor: cells.filter(c => c.y === mny).length });
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

  if (threw)
    L.push('  修法：照上面的錯誤訊息修。常見原因是尺寸算出 0 或負數、undefined 進了迴圈、'
         + '或用了這份說明文件裡沒有的函式。');

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
     這一段**只報數字不示警**：懸空是允許的，48 座裡吳哥窟懸空 83%、倫敦眼有 156 組
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
                     checkBlueprint, bpIndexOf, BP_TARGETS,
                     dim, ringOf, mirrorX, mirrorZ, arch, archRow, stairs, hipRoof,
                     windowGrid, lattice, corners4, tubeZ, wheelX, tint, paintFrom, blob };

