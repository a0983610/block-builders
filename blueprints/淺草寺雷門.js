// 檔名：淺草寺雷門.js
// v1.315.0 盲測第九回：子 agent 只拿〈藍圖製作說明〉、從零做出來的第二版（看過一次報告＋9000 四視圖），原樣收進來（只改了 name 與檔名那一行；見 開發筆記〈盲測第九回：松前城天守、哆啦A夢重做，新增淺草寺雷門、首里城正殿、東京鐵塔、招財貓、柴犬（v1.315.0）〉）
// 正面：四根朱紅柱撐起一片很寬的深灰瓦屋頂（切妻造，屋脊沿左右，正面看是一整片斜屋面，左右再伸出妻側出簷）；
//       中間間掛一顆大紅燈籠、黑字「雷門」；兩邊脇間是暗色的龕：畫面右邊風神（綠身、頭上一道風袋），左邊雷神（紅身、背後一圈連鼓）
// 側面：屋頂是 ∧ 形的山牆，簷下內縮一片白色妻壁、中間一根朱紅束；下面是白牆配朱紅柱，前後出簷很深
// 三樣識別物：①正中間的大紅燈籠＋黑字「雷門」 ②朱紅柱＋深色瓦的切妻大屋頂 ③兩側龕裡的風神（風袋）雷神（連鼓）
// 比例表（實物）：間口 11.4 m、高 11.7 m、柱間進深 5.4 m；切妻造本瓦葺、三間一戶八腳門（12 根柱）；
//   大燈籠高 3.9 m、直徑 3.3 m，掛在中間間；門に向かって右に風神、左に雷神
//   沒查到、照一般山門估：柱高約 6.5 m、簷口約 7.8 m、屋面起高約 3.6 m、大棟約 0.7 m；
//   前後簷出約 2.4 m、妻側出簷約 1.4 m；中間間約 5.6 m、脇間約 3.3 m（燈籠要塞得進中間間）
// 輪廓寬度（正面，以屋頂全寬 ＝ 1）：地面石床 0.82／柱身 0.82／頭貫兩端木鼻 0.85／簷口 1.00／屋面 1.00／大棟 1.00（兩端鬼瓦冒高一層）
//   高度分段：柱身佔下 52%、頭貫＋組物帶 11%、屋面＋大棟 37%（第一版實測輪廓：屋頂約 41%）
// 部件尺寸（s ＝ 每公尺幾格；第一版報告 9000 塊 s ＝ 3.66，這版部件多一點，估 s ≈ 3.55）：
//   屋頂寬 2·(xo+dim(s,1.4,2))+1 ＝ 55、深 2·halfD+1 ＝ 39、起高 dim(s,3.6,4) ＝ 13 層（下緩 6 層每邊收 2、上陡 7 層每邊收 1）
//   柱高 dim(s,6.5,8) ＝ 23、中間間柱心 ±dim(s,2.8,4) ＝ ±10、脇間 dim(s,3.3,4) ＝ 12、進深柱心 ±dim(s,2.7,4) ＝ ±10
//   燈籠高 19（字區 17 層：上留 1 層空、「雷」9 層＋空 1＋「門」6 層）、寬 15；字寬 7 格，一筆 1 格
//   神像：龕高到飛貫 dim(s,5.5,6) ＝ 20，岩座 2 層＋像身約 17 格（含風袋／連鼓），頭半徑 2.38、連鼓圈半徑約 3.6、鼓 3×3
// 部件：脇間石床(box) 柱(cyl 十字斷面) 本柱(cyl 3×3) 頭貫與繫梁(box) 組物帶(box＋顏色函式)
//   側牆(box＋顏色函式：白壁、朱腰板、長押) 龕內暗色襯板(box) 龕背板(box) 龕前飛貫、白小壁、腰欄(box)
//   屋頂(boxTaper 兩段：下緩上陡，給 t 中空) 屋頂兩端挖開(carve 逐層) 螻羽(box 逐層) 妻壁(box 逐層＋顏色函式)
//   大棟(box) 鬼瓦(box) 燈籠(revolve shell 1＋顏色函式上下黑框) 「雷門」字(paintFrom)
//   岩座(boxTaper) 神像軀幹(blob＋顏色函式腰布) 頭(blob) 四肢(limb 兩段) 風袋(limb 串成弧) 連鼓(tubeZ＋limb 圈) 鼓面(tint) 眼睛(paintFrom)
customBlueprint({
  name: '淺草寺雷門',
  pal: ['#c8452c',   // 0 朱（柱、梁）
        '#8e2f20',   // 1 朱（暗）：腰板、欄杆下段
        '#5a5e63',   // 2 瓦
        '#3f4247',   // 3 瓦（暗）：瓦壟、大棟、螻羽、鬼瓦
        '#d12f25',   // 4 燈籠紅（比第一版亮，簷下陰影裡也還是紅）
        '#7a1c16',   // 5 鼓面
        '#1c1a19',   // 6 黑：字、燈籠上下框
        '#e4dfd3',   // 7 白漆喰
        '#a8a194',   // 8 漆喰陰影
        '#3a2d27',   // 9 龕內暗色
        '#8d8a83',   // 10 石
        '#58a079',   // 11 風神綠（比第一版亮一階）
        '#d35a42',   // 12 雷神紅
        '#d9ab42',   // 13 金：腰布、連鼓、鼓槌
        '#ddd5b6',   // 14 風袋布
        '#6f6b64'],  // 15 石（暗）
  lo: 0.8, hi: 6.5,

  gen(v, s) {
    // 用兩端的格子畫長方體（偶數寬也不會偏半格）
    const B = (xa, xb, ya, yb, za, zb, c) => {
      const x0 = Math.min(xa, xb), x1 = Math.max(xa, xb), z0 = Math.min(za, zb), z1 = Math.max(za, zb);
      v.box((x0 + x1) / 2, ya, (z0 + z1) / 2, x1 - x0 + 1, yb - ya + 1, z1 - z0 + 1, c);
    };
    const CB = (xa, xb, ya, yb, za, zb) => {
      const x0 = Math.min(xa, xb), x1 = Math.max(xa, xb), z0 = Math.min(za, zb), z1 = Math.max(za, zb);
      v.carve((x0 + x1) / 2, ya, (z0 + z1) / 2, x1 - x0 + 1, yb - ya + 1, z1 - z0 + 1);
    };
    const SG = [-1, 1];

    // ---------- 尺寸（s ＝ 每公尺幾格） ----------
    const xi = dim(s, 2.8, 4);            // 中間間的柱心（±）
    const sb = dim(s, 3.3, 4);            // 脇間寬
    const xo = xi + sb;                   // 外側柱心
    const dz = dim(s, 2.7, 4);            // 前、後柱列（中間一列在 z = 0）
    const yb = dim(s, 6.5, 8);            // 頭貫底（柱子 1 ～ yb−1）
    const yl = Math.min(dim(s, 5.5, 6), yb - 2);   // 龕前飛貫（拉高，神像大一點）
    const nb = dim(s, 0.75, 2);           // 組物帶層數
    const yR = yb + 2 + nb;               // 屋頂最下一層（簷口）
    const rise = dim(s, 3.6, 4);          // 屋面起高（第一版 3.2：上陡段太短，側面像斗笠）
    const halfD = dz + dim(s, 2.4, 3);    // 簷口離中心（前後出簷）
    const rw = xo + dim(s, 1.4, 2);       // 屋頂半寬（含妻側出簷）
    let hL = Math.max(2, halfD - rise), hU = Math.max(2, rise - hL);   // 下緩段（每層每邊收 2）、上陡段（收 1）
    let top = halfD + 2 - 2 * hL - hU;                                  // 最頂一層的半深
    while (top < 1 && hL > 2) { hL--; top += 2; }
    while (top < 1 && hU > 2) { hU--; top += 1; }
    const eU0 = halfD - 2 * (hL - 1) - 1;                               // 上陡段第一層的半深

    // ---------- 台基：脇間石床 ----------
    const stoneC = (x, y, z) => (hash100(x, y, z) < 22 ? 15 : 10);
    for (const sg of SG) B(sg * xi, sg * xo, 0, 0, -dz - 1, dz + 1, stoneC);

    // ---------- 側牆、龕背板、龕的正背面 ----------
    const sideC = (x, y) => (y <= 2 ? 1 : (y === yl || y === yl + 1) ? 0 : (y === yb - 1 ? 8 : 7));
    for (const sg of SG) {
      B(sg * xo, sg * xo, 1, yb - 1, -dz, dz, sideC);                      // 側牆：白壁＋朱腰板＋長押
      B(sg * (xo - 1), sg * (xo - 1), 1, yl - 1, -dz + 1, -1, 9);          // 前龕內側的暗色襯板（第一版從正面看得到白牆內面）
      B(sg * (xi + 1), sg * (xo - 1), 1, yb - 1, 0, 0, 9);                 // 龕背板（前後龕共用）
      for (const fz of [-dz, dz]) {
        B(sg * (xi + 1), sg * (xo - 1), yl, yl + 1, fz, fz, 0);            // 飛貫
        if (yl + 2 <= yb - 1) B(sg * (xi + 1), sg * (xo - 1), yl + 2, yb - 1, fz, fz, 7);   // 白小壁
        B(sg * (xi + 1), sg * (xo - 1), 1, 2, fz, fz, (x, y) => (y === 2 ? 0 : 1));        // 腰欄
      }
    }

    // ---------- 柱：12 根（八腳門），中間列夾著燈籠的兩根本柱較粗 ----------
    const pr = Math.max(0.75, s * 0.22), pm = Math.max(1.2, s * 0.36);
    for (const x of [-xo, -xi, xi, xo]) for (const z of [-dz, 0, dz])
      v.cyl(x, 1, z, (z === 0 && Math.abs(x) === xi) ? pm : pr, yb - 1, 0);

    // ---------- 頭貫、繫梁、組物帶 ----------
    for (const z of [-dz, 0, dz]) B(-xo - 1, xo + 1, yb, yb + 1, z, z, 0);
    for (const x of [-xo, -xi, xi, xo]) B(x, x, yb, yb + 1, -dz, dz, 0);
    const brC = (x, y) => (y === yb + 2 || Math.abs(x) % 4 < 2 ? 0 : 9);
    for (const z of [-dz, dz]) B(-xo - 1, xo + 1, yb + 2, yR - 1, z, z, brC);

    // ---------- 屋頂：切妻，下緩上陡（boxTaper 兩段，只收深度） ----------
    const roofC = (x) => (Math.abs(x) % 3 === 1 ? 3 : 2);              // 本瓦的瓦壟
    boxTaper(v, { x: 0, y: yR, z: 0, w: 2 * rw + 1, d: 2 * halfD + 1, w1: 2 * rw + 1,
                  d1: 2 * (eU0 + 1) + 1, h: hL, t: 2, c: roofC });
    boxTaper(v, { x: 0, y: yR + hL, z: 0, w: 2 * rw + 1, d: 2 * eU0 + 1, w1: 2 * rw + 1,
                  d1: 2 * top + 1, h: hU, t: 1, c: roofC });
    // 妻壁：白漆喰，中間一根朱紅束、前後柱列的位置是朱紅
    const gableC = (x, y, z) => (Math.abs(z) === dz || (z === 0 && y >= yR) || y === yb + 2) ? 0 : (y < yR ? 8 : 7);
    for (const sg of SG) B(sg * xo, sg * xo, yb + 2, yR - 1, -dz, dz, gableC);
    for (let k = 0; k < hL + hU; k++) {
      const y = yR + k, t = k < hL ? 2 : 1;
      const e = k < hL ? halfD - 2 * k : eU0 - (k - hL);
      const inner = e - t;
      for (const sg of SG) {
        CB(sg * (rw - t + 1), sg * rw, y, y, -inner, inner);              // boxTaper 兩端是封死的三角，挖開露出簷下
        B(sg * (rw - 1), sg * rw, y + 1, y + 1, inner + 1, e, 3);         // 螻羽：兩端沿斜邊加高一層
        B(sg * (rw - 1), sg * rw, y + 1, y + 1, -e, -inner - 1, 3);
        const g = Math.min(inner, dz);
        B(sg * xo, sg * xo, y, y, -g, g, gableC);                         // 內縮在外側柱列上的妻壁
      }
    }
    // 大棟與鬼瓦（鬼瓦縮成 3 格深、只比大棟高一層：第一版側面看像一根煙囪）
    const yT = yR + hL + hU, rh = dim(s, 0.7, 2);
    B(-rw, rw, yT, yT, -top, top, 3);
    if (rh > 1) B(-rw, rw, yT + 1, yT + rh - 1, -1, 1, 3);
    for (const sg of SG) B(sg * (rw - 1), sg * rw, yT, yT + rh, -1, 1, 3);

    // ---------- 大燈籠：掛在中間列的頭貫下 ----------
    // 「雷門」直書（雷在上），一格一筆；字的頂上留一層空，不然雨字頭的橫跟黑框黏成一條
    const GL = ['#######', '#..#..#', '#.#.#.#', '.......', '.#####.', '.#.#.#.', '.#####.', '.#.#.#.', '.#####.',
                '.......',
                '###.###', '#.#.#.#', '###.###', '#.....#', '#.....#', '#.....#'];
    const rimB = dim(s, 0.3, 1);
    const HL0 = dim(s, 5.0, 6);
    const HL = Math.min(HL0 >= GL.length + 1 ? Math.max(HL0, GL.length + 2 + rimB) : HL0, yb - 3);
    const R = Math.max(1.5, Math.min(xi - 2.2, HL / 2.36));
    const yTop = yb - 1, yBot = yTop - HL + 1;
    revolve(v, { x: 0, y: yBot, z: 0, shell: 1,
                 prof: [[R * 0.86, 0], [R, (HL - 1) * 0.25], [R, (HL - 1) * 0.75], [R * 0.86, HL - 1]],
                 c: (x, y) => (y < yBot + rimB || y === yTop) ? 6 : 4 });
    const Z = HL - 1 - rimB, yZ = yTop - 1;                 // 字區層數、最上面那層
    const maxW = 2 * Math.floor(R * 0.8) + 1;
    const p = Math.max(1, Math.min(Math.floor(Z / GL.length), Math.floor(maxW / 7)));
    const rows = Z >= GL.length ? GL.length * p : Z;
    const cols = Math.min(7 * p, maxW);
    const off = Z > rows ? Math.max(1, Math.floor((Z - rows) / 2)) : 0;
    for (let i = 0; i < rows; i++) {
      const g = Z >= GL.length ? Math.floor(i / p) : Math.floor(i * GL.length / Z);
      for (let k = 0; k < cols; k++) {
        const gc = cols >= 7 * p ? Math.floor(k / p) : Math.floor(k * 7 / cols);
        if (GL[g][gc] !== '#') continue;
        paintFrom(v, Math.floor((cols - 1) / 2) - k, yZ - off - i, 0, 0, 0, -1, Math.ceil(R) + 2, 6);
      }
    }

    // ---------- 風神、雷神（前龕，面向 −z；往前挪，少吃一點簷下的影子） ----------
    const ph = dim(s, 0.5, 2);                     // 岩座高
    const yp = ph + 1;                             // 腳底
    const u = (yl - 1 - ph) / 8.2;                 // 像的單位：整尊（含風袋）約 8.2u，剛好塞進飛貫下
    const sxC = Math.round((xi + xo) / 2), sz = -dz + 3;
    const avail = Math.min(xo - 1 - sxC, sxC - xi - 1);   // 像中心到龕邊還有幾格
    const rr = a => Math.max(0.5, a);
    const hr = Math.max(1.15 * u, Math.min(2.35, 1.3 * u));
    const hy = Math.round(yp + 5.0 * u);
    const figure = (cx, skin) => {
      boxTaper(v, { x: cx, y: 1, z: sz, w: Math.max(3, sb - 3), d: Math.max(3, dz - 4),
                    w1: Math.max(3, sb - 5), d1: Math.max(3, dz - 6), h: ph, c: stoneC });   // 岩座
      for (const k of SG) {                                                                // 跨開的兩腿
        limb(v, { x: cx + k * 0.7 * u, y: yp + 2.7 * u, z: sz, x1: cx + k * 1.5 * u, y1: yp + 1.5 * u, z1: sz - 0.3 * u,
                  r: rr(0.5 * u), r1: rr(0.42 * u), c: skin });
        limb(v, { x: cx + k * 1.5 * u, y: yp + 1.5 * u, z: sz - 0.3 * u, x1: cx + k * 1.9 * u, y1: yp + 0.1 * u, z1: sz,
                  r: rr(0.42 * u), r1: rr(0.38 * u), c: skin });
      }
      const ty = yp + 3.7 * u;
      blob(v, cx, ty, sz, 1.2 * u, 1.25 * u, 0.85 * u, (x, y) => (y < ty - 0.5 * u ? 13 : skin));   // 軀幹＋腰布
      blob(v, cx, hy, sz, hr, hr, hr * 0.95, skin);                                                 // 頭
    };
    const eyes = (cx) => { for (const k of SG) paintFrom(v, cx + k, hy, sz, 0, 0, -1, Math.ceil(hr) + 2, 7); };

    // 風神：畫面右邊（−x），雙手高舉一道弧形的風袋（加粗）
    {
      const cx = -sxC, Rb = Math.min(2.1 * u, avail - 0.65 * u), by = yp + 5.2 * u, bz = sz + 0.4 * u;
      figure(cx, 11);
      for (const k of SG) {
        limb(v, { x: cx + k * u, y: yp + 4.4 * u, z: sz, x1: cx + k * (Rb + 0.2 * u), y1: yp + 3.9 * u, z1: sz - 0.4 * u,
                  r: rr(0.42 * u), r1: rr(0.36 * u), c: 11 });
        limb(v, { x: cx + k * (Rb + 0.2 * u), y: yp + 3.9 * u, z: sz - 0.4 * u, x1: cx + k * Rb, y1: by, z1: bz,
                  r: rr(0.36 * u), r1: rr(0.34 * u), c: 11 });
      }
      const th = a => rr((0.55 + 0.2 * Math.abs(Math.cos(a))) * u);     // 兩端鼓、頂上細
      for (let i = 1; i <= 6; i++) {
        const a0 = Math.PI * (i - 1) / 6, a1 = Math.PI * i / 6;
        limb(v, { x: cx + Rb * Math.cos(a0), y: by + Rb * Math.sin(a0), z: bz,
                  x1: cx + Rb * Math.cos(a1), y1: by + Rb * Math.sin(a1), z1: bz, r: th(a0), r1: th(a1), c: 14 });
      }
      eyes(cx);
    }

    // 雷神：畫面左邊（+x），背後一圈連鼓（圈加粗）、兩手拿鼓槌
    {
      const cx = sxC, rd = Math.max(0.9, 0.65 * u), Rr = Math.max(1.0, Math.min(2.4 * u, avail - rd));
      const cy = hy - 0.3 * u, rz = sz + Math.max(2, Math.round(1.1 * u));
      const n = 6, a0 = -Math.PI / 6, a1 = Math.PI * 7 / 6;
      let prev = null;
      for (let i = 0; i < n; i++) {
        const a = a0 + (a1 - a0) * i / (n - 1);
        const px = cx + Rr * Math.cos(a), py = cy + Rr * Math.sin(a);
        if (prev) limb(v, { x: prev[0], y: prev[1], z: rz, x1: px, y1: py, z1: rz, r: rr(0.42 * u), c: 13 });
        tubeZ(v, px, py, rz - 1, rd, 2, 13);
        tint(v, Math.round(px), Math.round(py), rz - 1, 5);
        prev = [px, py];
      }
      figure(cx, 12);
      limb(v, { x: cx + u, y: yp + 4.4 * u, z: sz, x1: cx + 2.0 * u, y1: yp + 5.3 * u, z1: sz - 0.4 * u,
                r: rr(0.42 * u), r1: rr(0.36 * u), c: 12 });                                         // 舉起的上臂
      limb(v, { x: cx + 2.0 * u, y: yp + 5.3 * u, z: sz - 0.4 * u, x1: cx + 1.7 * u, y1: yp + 6.4 * u, z1: sz - 0.7 * u,
                r: rr(0.36 * u), r1: rr(0.34 * u), c: 12 });                                         // 前臂
      limb(v, { x: cx + 1.7 * u, y: yp + 6.4 * u, z: sz - 0.7 * u, x1: cx + 2.3 * u, y1: yp + 7.5 * u, z1: sz - 0.9 * u,
                r: rr(0.28 * u), c: 13 });                                                           // 鼓槌
      limb(v, { x: cx - u, y: yp + 4.4 * u, z: sz, x1: cx - 2.1 * u, y1: yp + 3.7 * u, z1: sz - 0.5 * u,
                r: rr(0.42 * u), r1: rr(0.36 * u), c: 12 });                                         // 另一手往下張
      limb(v, { x: cx - 2.1 * u, y: yp + 3.7 * u, z: sz - 0.5 * u, x1: cx - 2.4 * u, y1: yp + 4.8 * u, z1: sz - 1.0 * u,
                r: rr(0.36 * u), r1: rr(0.34 * u), c: 12 });
      limb(v, { x: cx - 2.4 * u, y: yp + 4.8 * u, z: sz - 1.0 * u, x1: cx - 2.0 * u, y1: yp + 5.9 * u, z1: sz - 1.1 * u,
                r: rr(0.28 * u), c: 13 });                                                           // 鼓槌
      eyes(cx);
    }
  }
});
