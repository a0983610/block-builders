// 檔名：俄式白石大教堂.js
// v1.287.1 盲測第三回：子 agent 只拿〈藍圖製作說明〉、從零做出來的第二版（看過一次報告＋9000 四視圖），原樣收進來（只改了 name 與檔名那一行；見 開發筆記〈盲測第三回：一兩次就要做好（v1.287.0）〉）
// 正面（西立面，朝 −z）：方正的白石大方塊，頂上三個同高的半圓山牆（закомары），正中一座層層內縮的拱門；
//   屋頂後面冒出白色高鼓座＋金色頭盔頂：中間最大最高，左右兩個小一號的
// 側面（南／北立面）：四個同高的半圓山牆；五個金頂整組偏向東邊，東端低矮的半圓殼被轉角的厚壁墩擋掉一半
// 三樣識別物：①五個金色頭盔頂（一大四小、擠在一起、偏東）立在開窄窗的白色鼓座上
//             ②每一面頂上一排等高的半圓山牆（正面 3 個、側面 4 個），天際線是一排半圓
//             ③牆身半腰一圈小拱柱腰帶＋上下兩層細長窄窗、三面層層內縮的拱門
// 比例表（實物）：東西長約 43 m、南北寬約 29 m、連十字架全高 45 m；牆高（到山牆頂）11 俄丈 ≈ 23.4 m；
//   中央大頂直徑 5.5 俄丈 ≈ 11.7 m、四個小頂 4 俄丈 ≈ 8.5 m；台基約 1.5 m；小拱腰帶在牆高一半；
//   正立面 3 開間、側立面 4 開間（12 個等大的方形開間）；東端 5 個半圓殼，比山牆低；
//   正門在西、南北兩門偏東；五頂整組偏東
// 輪廓寬度（正面，以牆寬 29 m ＝ 1）：台基 1.07／牆身（含壁柱）1.07／山牆頂 1.07（三個半圓，半圓之間凹下去）／
//   鼓座那一段約 0.8／金頂下半 0.85（三頂並排）／金頂上半 0.4（只剩中央）／十字架 0.1
// 部件尺寸（v1 報告：9000 塊 s ＝ 9.79；這版加長鼓座、放大拱門，估 s ≈ 9.5）：
//   寬 29、長 41～43、牆 17～18、山牆頂 22～24、全高約 45 格
//   中央金頂直徑 2×0.56s ≈ 10.6 格、小金頂 2×0.48s ≈ 9.1 格（5.4 要 9 格起）
//   山牆半徑 4.5～5.5 格、屋面比山牆頂低 dim(s,0.3)=3 格；腰帶 2 格高；窄窗 1×3 格；正門外圈 9 格寬、門洞 5 格
// 部件：台基(walls) 牆身(walls) 半圓山牆＋三格厚的山牆壓頂(逐格) 比山牆低的十字筒形屋面(高度圖) 壁柱(set)
//   小拱腰帶(set 小柱＋tint 暗槽) 窄窗(tint) 三座內縮拱門(逐格畫拱) 台階(stairs)
//   東端五個半圓殼(半圈殼＋dome) 東端轉角厚壁墩(box) 鼓座(從屋面長起的圓環) 鼓座窄窗(paintFrom)
//   鼓座簷口(cyl) 金頂(dome, squash 1.2) 頂尖(taper) 十字架(box)
customBlueprint({
  name: '俄式白石大教堂',
  pal: ['#e4ddcd',   // 0 白石牆（亮度 0.85）
        '#c8bfab',   // 1 淺灰：壁柱、腰帶上下緣、拱門外圈（0.73）
        '#9b927f',   // 2 陰影色：台基、腰帶暗槽、門楣、鼓座簷口、台階（0.55）
        '#d6a73a',   // 3 金頂、十字架（0.53）
        '#56625d',   // 4 屋面：金屬屋頂與山牆壓頂（0.36）
        '#36332f',   // 5 窄窗（0.20）
        '#7b5a33'],  // 6 青銅大門（0.34）
  lo: 3, hi: 15,

  gen(v, s) {
    // ── 主量體（係數 ＝ 實物公尺 ÷ 10）──
    const W  = dim(s, 2.9, 11, true);          // 南北寬 29 m（x）
    const L  = dim(s, 4.3, 15, true);          // 東西長 43 m（z；西立面＝正面在 −z）
    const half = (W - 1) / 2, hl = (L - 1) / 2;
    const hp = dim(s, 0.15, 1);                // 台基 1.5 m
    const Hs = dim(s, 1.8, 7);                 // 牆身到山牆起拱 18 m
    const pb = Math.round(half / 3);           // 正立面三開間：壁柱在 ±pb
    const q  = Math.round(hl / 2);             // 側立面四開間：壁柱在 0、±q
    const BX = [-half, -pb, pb, half];
    const BZ = [-hl, -q, 0, q, hl];
    const ph = Math.floor(s * 0.07);           // 壁柱半寬（0 就是 1 格寬）
    const yb = Math.round(Hs * 0.58);          // 小拱腰帶底：牆高一半
    const hb = dim(s, 0.2, 1);                 // 腰帶高
    const hw = dim(s, 0.3, 2);                 // 窄窗高
    const yw = Math.max(yb + hb + 1, Math.round((yb + hb + Hs) / 2 - hw / 2));  // 上層窄窗底
    const dz = dim(s, 0.3, 2);                 // 屋面比山牆頂低幾格：半圓山牆才在天際線上露得出來
    const mid = (a, b) => { const m = (a + b) / 2; return Math.sign(m) * Math.round(Math.abs(m)); };

    // ── 高度圖：四周那一圈是半圓山牆的頂；裡面是十字筒形屋面，整片壓低 dz 格 ──
    const bay = (B, u) => {
      for (let i = 0; i < B.length - 1; i++) {
        if (u < B[i] || u > B[i + 1]) continue;
        const c = (B[i] + B[i + 1]) / 2, r = (B[i + 1] - B[i]) / 2;
        return Hs + Math.sqrt(Math.max(0, r * r - (u - c) * (u - c)));
      }
      return Hs;
    };
    const T = [];
    let Ht = Hs;
    for (let x = -half; x <= half; x++) {
      const col = [];
      for (let z = -hl; z <= hl; z++) {
        const t = Math.round(Math.max(bay(BX, x), bay(BZ, z)));
        const edge = x === -half || x === half || z === -hl || z === hl;
        col.push(edge ? t : Math.max(Hs + 1, t - dz));
        if (t > Ht) Ht = t;
      }
      T.push(col);
    }
    const tAt = (x, z) => T[Math.max(0, Math.min(W - 1, x + half))][Math.max(0, Math.min(L - 1, z + hl))];

    // ── 台基、牆身 ──
    v.walls(0, 0, 0, W + 2, hp, L + 2, 2, 1);    // 台基：往外凸 1 格
    v.walls(0, 0, 0, W, Hs, L, 0, 1);            // 白石牆身

    // ── 半圓山牆（白）＋三格厚的壓頂（往外出簷、往裡收邊）＋壓低的屋面 ──
    for (let x = -half; x <= half; x++) for (let z = -hl; z <= hl; z++) {
      const t = tAt(x, z);
      const ox = x === -half ? -1 : (x === half ? 1 : 0);
      const oz = z === -hl ? -1 : (z === hl ? 1 : 0);
      let lo = t;
      if (ox || oz) {
        // 山牆：只跟同一面左右相鄰的山牆比，斜的地方往下補，壓頂才是連續的一條弧
        if (oz) { if (x > -half) lo = Math.min(lo, tAt(x - 1, z) + 1); if (x < half) lo = Math.min(lo, tAt(x + 1, z) + 1); }
        if (ox) { if (z > -hl) lo = Math.min(lo, tAt(x, z - 1) + 1); if (z < hl) lo = Math.min(lo, tAt(x, z + 1) + 1); }
        for (let y = Hs; y < lo; y++) v.set(x, y, z, 0);
        for (let y = lo; y <= t; y++) {
          v.set(x, y, z, 4);
          if (ox) { v.set(x + ox, y, z, 4); v.set(x - ox, y, z, 4); }
          if (oz) { v.set(x, y, z + oz, 4); v.set(x, y, z - oz, 4); }
          if (ox && oz) v.set(x + ox, y, z + oz, 4);
        }
      } else {
        lo = Math.min(lo, tAt(x - 1, z) + 1, tAt(x + 1, z) + 1, tAt(x, z - 1) + 1, tAt(x, z + 1) + 1);
        for (let y = lo; y <= t; y++) v.set(x, y, z, 4);
      }
    }

    // ── 四個立面共用：u 沿牆面、d 往外（0 ＝ 牆面那一層）──
    const FAC = [
      { B: BX, P: (u, d) => [u, -hl - d] },       // 西立面（正面，−z）
      { B: BX, P: (u, d) => [u,  hl + d] },       // 東立面
      { B: BZ, P: (u, d) => [-half - d, u] },     // 南立面（−x）
      { B: BZ, P: (u, d) => [ half + d, u] },     // 北立面（+x）
    ];
    const put = (f, u, y, d, c) => { const p = f.P(u, d); v.set(p[0], y, p[1], c); };
    const paint = (f, u, y, d, c) => { const p = f.P(u, d); tint(v, p[0], y, p[1], c); };

    for (const f of FAC) {
      const B = f.B, a = B[B.length - 1];
      for (let i = 0; i < B.length - 1; i++) {
        const cu = mid(B[i], B[i + 1]);
        for (let u = B[i] + ph + 1; u <= B[i + 1] - ph - 1; u++) {
          put(f, u, yb - 1, 1, 1);                         // 腰帶下緣
          put(f, u, yb + hb, 1, 1);                        // 腰帶上緣
          for (let y = yb; y < yb + hb; y++) {
            if (u === cu) paint(f, u, y, 0, 5);            // 腰帶裡的窄窗
            else if ((u - cu) % 2) put(f, u, y, 1, 0);     // 小柱（凸 1 格）
            else paint(f, u, y, 0, 2);                     // 柱間暗槽
          }
        }
        for (let y = yw; y < yw + hw; y++) paint(f, cu, y, 0, 5);   // 上層窄窗
      }
      for (const b of B) {                                  // 壁柱：凸 1 格，轉角包過去
        const u0 = b === -a ? -a - 1 : b - ph, u1 = b === a ? a + 1 : b + ph;
        for (let u = u0; u <= u1; u++) for (let y = hp; y < Hs; y++) put(f, u, y, 1, 1);
      }
    }

    // ── 三座層層內縮的拱門（西正門、南北兩門偏東）＋台階 ──
    const pw = Math.max(1, Math.min(dim(s, 0.3, 1), pb - 2));
    const ysp = Math.max(hp + 1, yb - 3 - pw);
    const inA = (du, y, w) => w >= 0 && ((Math.abs(du) <= w && y <= ysp) ||
                               (y > ysp && Math.hypot(du, y - ysp) <= w + 0.35));
    const portal = (f, uc) => {
      for (let du = -pw - 1; du <= pw + 1; du++)
        for (let y = 0; y <= ysp + pw + 1; y++) {
          if (!inA(du, y, pw + 1)) continue;
          if (!inA(du, y, pw)) { put(f, uc + du, y, 2, 1); put(f, uc + du, y, 1, 1); }  // 外圈拱：凸 2 格
          else if (!inA(du, y, pw - 1)) put(f, uc + du, y, 1, 2);                       // 內圈拱：凸 1 格
          else if (y >= hp) put(f, uc + du, y, 0, y <= ysp ? 6 : 2);                    // 青銅門＋門楣
        }
    };
    const sideU = mid(0, q);                     // 南北兩門在東邊數來第二個開間
    portal(FAC[0], 0);
    portal(FAC[2], sideU);
    portal(FAC[3], sideU);
    const sw = 2 * pw + 1;
    stairs(v, 0, 0, -hl - hp - 1, hp, sw, 'z', 2);
    stairs(v, -half - hp - 1, 0, sideU, hp, sw, 'x', 2);
    stairs(v,  half + hp + 1, 0, sideU, hp, sw, '-x', 2);

    // ── 東端五個半圓殼：比山牆低，只畫牆外那一半 ──
    const ha = yb + hb + 2;
    const yaw = Math.max(hp + 1, yb - 1 - hw);
    const apse = (ax, r) => {
      const R = Math.ceil(r + 1.35);
      for (let i = -R; i <= R; i++) for (let j = 1; j <= R; j++) {
        const d = Math.hypot(i, j), x = ax + i, z = hl + j;
        if (d <= r + 0.35 && d > r - 1) {
          for (let y = 0; y < ha; y++) v.set(x, y, z, (y >= yb && y < yb + hb) ? 2 : 0);
        } else if (d > r + 0.35 && d <= r + 1.35) {
          for (let y = 0; y < hp; y++) v.set(x, y, z, 2);   // 台基
          v.set(x, yb - 1, z, 1);                            // 腰帶上下緣繞過來
          v.set(x, yb + hb, z, 1);
        }
      }
      v.dome(ax, ha, hl, r, 4);
      for (let y = yaw; y < yaw + hw; y++) paintFrom(v, ax, y, hl, 0, 0, 1, R + 1, 5);
    };
    apse(0, Math.max(1.6, pb * 0.8));                        // 中央大半圓殼
    const sb = half - pb;
    for (const sg of [-1, 1]) {
      if (sb >= 6) {                                         // 兩側各一對窄半圓殼
        const k1 = Math.round(sb / 4), ras = Math.max(1.2, sb / 4 - 0.4);
        apse(sg * (pb + k1), ras);
        apse(sg * (half - k1), ras);
      } else apse(sg * mid(pb, half), Math.max(1.2, sb / 2 - 0.6));
    }

    // ── 東端轉角的厚壁墩：從南北兩側擋住半圓殼 ──
    const pyw = dim(s, 0.3, 1, true), pyd = dim(s, 0.3, 1, true);
    for (const sg of [-1, 1]) {
      const px = sg * (half - (pyw - 1) / 2), pz = hl + 1 + (pyd - 1) / 2;
      v.box(px, 0, pz, pyw + 2, hp, pyd + 2, 2);
      v.box(px, 0, pz, pyw, Hs, pyd, 0);
      v.box(px, Hs, pz, pyw, 1, pyd, 4);
    }

    // ── 五個鼓座＋金色頭盔頂＋十字架（一大四小、偏東）──
    const sk = dim(s, 0.12, 1);
    const D8 = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
    const D4 = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    const head = (cx, cz, rd, rt, hd, ch, hwd, dirs) => {
      const yTop = Ht + hd;
      const R = Math.ceil(rd + 0.35);
      for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) {
        const d = Math.hypot(i, j);
        if (d > rd + 0.35 || d <= rd - 1) continue;
        for (let y = tAt(cx + i, cz + j); y <= yTop; y++) v.set(cx + i, y, cz + j, 0);   // 鼓座從屋面長起
      }
      const ywd = Math.round((Ht + yTop) / 2 - hwd / 2);
      for (const [dx, dz2] of dirs)
        for (let y = ywd; y < ywd + hwd; y++) paintFrom(v, cx, y, cz, dx, 0, dz2, R + 2, 5);   // 鼓座窄窗
      v.cyl(cx, yTop + 1, cz, rd + 1, 1, 2, 2);              // 簷口
      v.dome(cx, yTop + 2, cz, rt, 3, 1.2);                  // 金色頭盔頂
      const yd = yTop + 2 + Math.floor(rt * 1.2);            // 頂尖從低一點起，一定接得上金頂
      v.taper(cx, yd, cz, 1, 0.4, sk + 1, 3);                // 頂尖
      const y0 = yd + sk + 1;
      v.box(cx, y0, cz, 1, ch, 1, 3);                        // 十字架
      v.box(cx, y0 + ch - 2, cz, 3, 1, 1, 3);
    };
    const zc = mid(0, q);                                    // 中央大頂：東半那一組開間的中心
    const ds = dim(s, 0.8, 3);
    head(0, zc, Math.max(1.6, s * 0.46), Math.max(2.3, s * 0.56),
         dim(s, 0.8, 3), dim(s, 0.45, 3), dim(s, 0.4, 2), D8);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]])
      head(sx * ds, zc + sz * ds, Math.max(1.2, s * 0.36), Math.max(1.8, s * 0.48),
           dim(s, 0.6, 2), dim(s, 0.38, 3), dim(s, 0.3, 2), D4);
  }
});
