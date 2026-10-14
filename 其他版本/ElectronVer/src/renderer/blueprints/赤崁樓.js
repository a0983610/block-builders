// 檔名：赤崁樓.js
// v1.264.0：子 agent 只拿〈藍圖製作說明〉、看不到程式碼做出來的第三版（見 開發筆記〈prompt 拿去盲測（v1.264.0）〉）
// 正面：一道低而寬的紅磚城基（中央一道大石階、文昌閣底下一個磚拱），城基上左右並排兩座紅柱灰瓦的樓閣——
//       模型右手邊（+x，從正面看在左）是兩重簷、面寬較寬的海神廟，左手邊（−x）是三重簷、較高較方的文昌閣
// 側面：城基是一道矮厚的紅磚平台；樓閣一層比一層往內退，歇山頂側面露出紅色三角山花，正脊兩端燕尾往上翹
// 三樣識別物：兩座並排的重簷歇山樓閣（燕尾脊、翹角、紅柱）、紅磚城基（荷蘭普羅民遮城遺構，帶磚拱）、
//             城基前一排九座贔屓碑（石龜馱碑）
// 部件：紅磚城基(中空＋頂板＋風化磚色) 城基磚拱 正面大石階＋磚垂帶 城基石欄杆＋望柱 樓閣石基座
//       一樓周圍廊柱 一樓內牆 正面隔扇門 額枋 腰簷（重簷＋翹角） 上層牆 上層窗 匾額
//       歇山頂 山花 正脊 燕尾 脊頂寶珠 九座贔屓碑（龜身、龜頭、碑身）
customBlueprint({
  name: '赤崁樓',
  pal: ['#9c4a33',   // 0 城基紅磚、一樓磚牆
        '#7b3a28',   // 1 紅磚暗階（風化）
        '#b5362b',   // 2 朱紅柱、上層牆、山花
        '#5b5f5e',   // 3 屋瓦深灰
        '#d39a2c',   // 4 正脊、燕尾、寶珠、匾額（金橙）
        '#a69f93',   // 5 石階、欄杆、基座、碑身
        '#4a2f24',   // 6 隔扇門、窗（深木色）
        '#6e6c66'],  // 7 贔屓（石龜）
  lo: 2, hi: 20,

  gen(v, s) {
    const HS = (x, y, z) => (((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) >>> 0) % 100;

    // ── 尺寸（全部跟著 s 長）──
    const O  = dim(s, 0.30, 1);                    // 屋簷每側出挑（v2：0.22 → 0.30，3000 塊那檔出簷從 1 格變 2 格）
    const sb = dim(s, 0.10, 1);                    // 上一層每側往內退
    const over = O + sb;                           // 腰簷簷口比上層牆多出幾格
    const LS = Math.floor((over - 1) / 2);         // 腰簷往上收幾層（v3：每層收 2 格，坡度比頂簷緩，不再吃掉上層牆）
    const H1 = dim(s, 0.80, 3);                    // 一樓高
    const HU = Math.max(dim(s, 0.70, 3), LS + 3);  // 上層每層高（v3：0.60 → 0.70，上層牆與窗要露得出來）
    const D  = dim(s, 1.30, 7, true);              // 樓閣進深（兩座一樣）
    const AW = dim(s, 1.75, 9, true);              // 海神廟面寬
    const BW = dim(s, 1.35, 7, true);              // 文昌閣面寬
    const g  = dim(s, 0.30, 1, true);              // 兩座簷口之間的空隙
    const m  = dim(s, 0.30, 1);                    // 城基左右留邊
    const fz = dim(s, 0.45, 1);                    // 城基前後留邊（前庭）
    const PH = dim(s, 0.75, 2);                    // 城基高（v3：0.75，3000 塊那檔 s≈5.5 時要有 4 格，拱門才放得下）
    const vd = dim(s, 0.10, 1);                    // 一樓廊道深

    // ── 平面：x 由模型的左到右＝文昌閣、空隙、海神廟；兩座都在 z = 0 ──
    const BWe = BW + 2 * O, AWe = AW + 2 * O, De = D + 2 * O;
    const T  = BWe + g + AWe;                      // 連簷口的總寬（奇＋奇＋奇＝奇數）
    const xs = -(T - 1) / 2;
    const xB = xs + (BWe - 1) / 2;                 // 文昌閣中心
    const xA = xs + BWe + g + (AWe - 1) / 2;       // 海神廟中心
    const PW = T + 2 * m, PD = De + 2 * fz;        // 城基（都是奇數，置中在原點）
    const hw = (PW - 1) / 2, zf = -(PD - 1) / 2;   // 城基半寬、正面那片牆的 z

    // ── 台基：紅磚城基（中空，省積木）──
    v.walls(0, 0, 0, PW, PH, PD, 0, 2);
    v.box(0, PH - 1, 0, PW, 1, PD, 0);
    for (let y = 0; y < PH; y++) {                 // 磚面風化：只塗看得到的四面
      for (let x = -hw; x <= hw; x++) for (const z of [zf, -zf]) if (HS(x, y, z) < 22) tint(v, x, y, z, 1);
      for (let z = zf + 1; z < -zf; z++) for (const x of [-hw, hw]) if (HS(x, y, z) < 22) tint(v, x, y, z, 1);
    }
    for (let x = -hw; x <= hw; x++) for (let z = zf; z <= -zf; z++)   // 頂面
      if (HS(x, PH - 1, z) < 22) tint(v, x, PH - 1, z, 1);

    // 城基磚拱（荷蘭時代的拱門，在文昌閣底下）
    const aw = dim(s, 0.35, 3, true), ah = dim(s, 0.20, 1);
    if (ah + (aw - 1) / 2 <= PH - 2) arch(v, xB, 0, zf, aw, ah, 3);

    // 正面大石階：先鋪一道寬 2 格的磚，再把中間蓋成石階 → 兩側留下一條斜的磚垂帶
    const SW = dim(s, 0.70, 3, true);
    stairs(v, 0, 0, zf - PH, PH, SW + 2, 'z', 0);
    stairs(v, 0, 0, zf - PH, PH, SW, 'z', 5);

    // 城基頂的石欄杆：只在四角與石階口立望柱（v3：一排望柱怎麼排都像城堡垛口，拿掉）
    const rh = dim(s, 0.07, 1);
    v.walls(0, PH, 0, PW, rh, PD, 5, 1);
    corners4(v, hw, -zf, (vv, x, z) => vv.box(x, PH + rh, z, 1, 1, 1, 5));
    v.carve(0, PH, zf, SW, rh + 1, 1);             // 石階上來的缺口
    mirrorX(v, (SW + 1) / 2, (vv, dx) => vv.box(dx, PH + rh, zf, 1, 1, 1, 5));   // 石階口兩根望柱

    // ── 屋頂零件 ──
    const tick = (cx, y, cz, w, d, up) =>          // 翹角：簷口四個角往上翹，出簷夠深時尖端再往外甩一格
      corners4(v, (w - 1) / 2, (d - 1) / 2, (vv, x, z) => {
        vv.box(cx + x, y + 1, cz + z, 1, up, 1, 3);
        if (O >= 2) {
          vv.box(cx + x + Math.sign(x), y + up, cz + z, 1, 1, 1, 3);
          vv.box(cx + x, y + up, cz + z + Math.sign(z), 1, 1, 1, 3);
        }
      });

    const skirt = (cx, y, cz, w, d) => {           // 腰簷：一片簷口，再每層收 2 格收到上層牆（w、d 是下層牆）
      v.box(cx, y, cz, w + 2 * O, 1, d + 2 * O, 3);
      const wu = w - 2 * sb, du = d - 2 * sb;      // 上層牆
      for (let i = 1; i <= LS; i++) {
        const oh = over - 2 * i;                   // 這一圈的外緣比上層牆多出幾格
        const t = Math.min(3, oh + 1);             // 厚到跟下一圈疊得上、最後一圈貼到牆
        const wi = wu + 2 * oh, di = du + 2 * oh;
        if (wi <= 2 * t || di <= 2 * t) v.box(cx, y + i, cz, wi, 1, di, 3);
        else v.walls(cx, y + i, cz, wi, 1, di, 3, t);
      }
      tick(cx, y, cz, w + 2 * O, d + 2 * O, 1);
    };

    const hipGable = (cx, y, cz, w, d) => {        // 歇山頂：下段四面收、上段只收前後（兩側露出山花）
      const w0 = w + 2 * O, d0 = d + 2 * O;
      v.box(cx, y, cz, w0, 1, d0, 3);
      tick(cx, y, cz, w0, d0, O >= 3 ? 2 : 1);
      // v3：第一層比簷口一口氣收 2 格（簷口平、上面陡，有一點中式屋頂的凹曲線），之後每層收 1 格
      const nl = (d0 - 1) / 2 - 1, hk = Math.max(1, Math.min(nl - 1, O));
      let wi = w0;
      for (let i = 1; i <= nl; i++) {
        const off = i + 1;
        if (i <= hk) wi = w0 - 2 * off;
        const di = d0 - 2 * off, yy = y + i;
        if (wi <= 4 || di <= 4) v.box(cx, yy, cz, wi, 1, di, 3);
        else v.walls(cx, yy, cz, wi, 1, di, 3, 2);
        if (i > hk) for (let z = -(di - 3) / 2; z <= (di - 3) / 2; z++)        // 山花
          mirrorX(v, (wi - 1) / 2, (vv, dx) => tint(vv, cx + dx, yy, cz + z, 2));
      }
      const yr = y + nl + 1, R = (wi - 3) / 2;
      const rh2 = dim(s, 0.06, 1), tl = dim(s, 0.10, 1);
      v.box(cx, yr, cz, wi - 2, rh2, 1, 4);                                     // 正脊
      for (const sg of [-1, 1]) for (let t = 1; t <= tl; t++) {                 // 燕尾：往外往上翹
        v.box(cx + sg * (R + t - 1), yr + rh2 - 1 + t, cz, 1, 1, 1, 4);
        v.box(cx + sg * (R + t), yr + rh2 - 1 + t, cz, 1, 1, 1, 4);
      }
      v.box(cx, yr + rh2, cz, 1, dim(s, 0.08, 1), 1, 4);                       // 脊頂寶珠
    };

    const windows = (cx, yb, cz, w, d, top) => {   // 上層的窗（四面）＋頂層正面的匾額
      const vis = HU - LS;                         // 腰簷上面露出來的牆高
      const ph = top ? dim(s, 0.06, 1) : 0;
      const ww = dim(s, 0.12, 1, true);
      const wh = Math.max(1, Math.round((vis - ph) * 0.5));
      const wy = yb + LS + Math.max(0, Math.floor((vis - ph - wh) / 2));
      const st = ww + dim(s, 0.20, 1);
      const qx = Math.max(0, Math.floor(((w - 1) / 2 - 1 - (ww - 1) / 2) / st));
      const qz = Math.max(0, Math.floor(((d - 1) / 2 - 1 - (ww - 1) / 2) / st));
      const base = { y: wy, rows: 1, stepX: st, stepY: wh + 1, w: ww, h: wh, c: 6 };
      mirrorZ(v, (d - 1) / 2, (vv, dz) =>
        windowGrid(vv, Object.assign({ x: cx, z: cz + dz, cols: 2 * qx + 1, axis: 'x' }, base)));
      mirrorX(v, (w - 1) / 2, (vv, dx) =>
        windowGrid(vv, Object.assign({ x: cx + dx, z: cz, cols: 2 * qz + 1, axis: 'z' }, base)));
      if (top) v.box(cx, yb + HU - ph - (vis >= 6 ? 1 : 0), cz - (d - 1) / 2,
                     dim(s, 0.30, 1, true), ph, 1, 4);                          // 匾額
    };

    // ── 一座樓閣：石基座 → 一樓（廊柱＋內牆）→（腰簷 → 上層）×(tiers−1) → 歇山頂 ──
    const pavilion = (cx, W, tiers) => {
      const cz = 0;
      let y = PH;
      v.box(cx, y, cz, W + 2, 1, D + 2, 5);                                     // 石基座
      y += 1;
      const hx = (W - 1) / 2, hz = (D - 1) / 2;
      const iw = W - 2 - 2 * vd, id = D - 2 - 2 * vd;
      v.walls(cx, y, cz, iw, H1, id, 0, 1);                                     // 一樓磚牆
      v.box(cx, y, cz - (id - 1) / 2, iw, H1 - 1, 1, 6);                        // 正面整排隔扇門
      const nx = 2 * Math.max(1, Math.round(hx / 3)) + 1;
      const nz = 2 * Math.max(1, Math.round(hz / 3)) + 1;
      rowOf(v, nx, 2 * hx / (nx - 1), (vv, p) =>                                // 前後兩排廊柱
        mirrorZ(vv, hz, (w2, dz) => w2.box(Math.round(p), y, cz + dz, 1, H1, 1, 2)), cx);
      rowOf(v, nz, 2 * hz / (nz - 1), (vv, p) =>                                // 左右兩排廊柱
        mirrorX(vv, hx, (w2, dx) => w2.box(cx + dx, y, Math.round(p), 1, H1, 1, 2)), cz);
      v.walls(cx, y + H1 - 1, cz, W, 1, D, 2, 1);                               // 額枋
      y += H1;
      let w = W, d = D;
      for (let k = 1; k < tiers; k++) {
        skirt(cx, y, cz, w, d);
        w -= 2 * sb; d -= 2 * sb;
        const yb = y + 1;
        v.walls(cx, yb, cz, w, HU, d, 2, 1);
        windows(cx, yb, cz, w, d, k === tiers - 1);
        y = yb + HU;
      }
      hipGable(cx, y, cz, w, d);
    };

    pavilion(xB, BW, 3);   // 文昌閣：三重簷、較方較高
    pavilion(xA, AW, 2);   // 海神廟：兩重簷、面寬較寬

    // ── 九座贔屓碑：海神廟那一側（+x）、城基正前方排成一排，龜頭朝正面 ──
    const tw = 1 + 2 * Math.floor(s * 0.10);              // 碑寬：奇數，s≥10 起 3 格（v3：上萬塊那檔才看得出是碑不是柱）
    const td = dim(s, 0.22, 3, true);
    const th = dim(s, 0.10, 1), sh = dim(s, 0.36, 3);     // v2：碑身加高，才不會跟欄杆混成一排小柱
    const sp = tw + 1;
    const zt = zf - 2 - (td - 1) / 2;
    const x0 = (SW - 1) / 2 + 2 + (tw - 1) / 2;
    rowOf(v, 9, sp, (vv, x) => {
      vv.box(x, 0, zt, tw, th, td, 7);                                          // 龜身
      vv.box(x, 0, zt - (td + 1) / 2, Math.max(1, tw - 2), 1, 1, 7);            // 龜頭
      vv.box(x, th, zt, tw, sh, 1, 5);                                          // 碑身
      if (tw >= 3) {                                                            // 碑首圓角
        vv.del(x - (tw - 1) / 2, th + sh - 1, zt);
        vv.del(x + (tw - 1) / 2, th + sh - 1, zt);
      }
    }, x0 + 4 * sp);
  }
});
