/* ============================================================
   藍圖：36 座世界地標的 voxel 產生器
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

/* ── 36 座地標 ────────────────────────────────────────────
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
    filled: false, claimed: -1, anchor: false, fg: -1
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

/* node 也要能 require 這支檔來單獨測藍圖 */
if (typeof module !== 'undefined' && module.exports)
  module.exports = { SHAPES, VOX, makeBlueprint, genCells, fitScale, NBR, gkeyOf };

