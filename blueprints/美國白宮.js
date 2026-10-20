// 檔名：美國白宮.js
// v1.312.0 盲測第六回：子 agent 只拿〈藍圖製作說明〉、從零做出來的第一版（沒有任何回饋），原樣收進來（只改了 name 與檔名那一行；見 開發筆記〈盲測第六回：聖三一修道院、美國白宮、台南孔廟三座建築（v1.312.0）〉）
// ── 設計表 ──
// 正面（北面 −z）：一長條白色主樓，北面看起來只有兩層（地面層被擋牆遮住）；正中間四根通高高柱撐著三角山牆的門廊，
//   牆頂一圈欄杆、後面露出灰色低坡屋頂、旗桿；左右各接一段低矮柱廊，再接兩層的東廂／西廂
// 側面：主樓北邊伸出深深的門廊、南邊鼓出半圓柱廊；東西廂只有主樓一半高
// 三樣識別物：①北門廊（四根通高愛奧尼柱＋三角山牆）②南面半圓柱廊（六根柱＋杜魯門陽台＋兩側樓梯）
//   ③一整排三角／弓形交替窗楣的長窗，牆頂欄杆
// 比例表（實物）：主樓東西 168 ft、南北 85.5 ft（含南北門廊約 152 ft）；高：南面 70 ft、北面 60.3 ft
//   （北面地勢高一層）；地面層約 12 ft、國事層約 20 ft、二樓約 16 ft；北面 11 開間（中間 3 開間在門廊後）；
//   南面中央 3 開間是弧形外凸；北門廊伸出約 40 ft；東西廂兩層，約主樓一半高（柱廊與廂房的長度照比例壓縮）
// 輪廓寬度（正面，以主樓寬 ＝ 1）：
//   地面～柱廊頂（0～4 層）2.06（東廂＋柱廊＋主樓＋柱廊＋西廂）
//   廂房二樓（5～8 層）主樓 1.00 ＋ 兩邊廂房各 0.32（中間隔著柱廊頂的空檔）
//   主樓二樓（9～12 層）1.00
//   欄杆（14～15 層）1.00
//   屋頂（16～17 層）0.91 → 0.66，前面山牆尖 3 格
//   旗（18～24 層）0.17
// 部件尺寸（9000 塊估 s ≈ 11，1 格 ≈ 3.6 ft）：
//   主樓 47 寬 × 24 深，牆高 13（地面層 3＋國事層 6＋二樓 4），屋頂再 4 層
//   北門廊寬 15、伸出 11，柱 1 格粗 10 層高（柱頭 3 格寬），山牆 15→9→3 共 3 層
//   南柱廊：弧牆半徑 6、柱子半徑 9、平台半徑 10；陽台在第 8 層
//   窗 1×3（國事層）／1×2（二樓）／1×2（地面層），窗楣 3 格寬，三角窗楣多一格尖；正門 3×4
//   柱廊 10 長 × 6 深 × 4 高（柱距 2）；東西廂 15 × 18 × 7；國旗 8×5、旗桿 7
// 部件：台基＝北面擋牆(box)、北門廊台座(walls)、門前台階(stairs)、南面雙樓梯(stairs)、地面層粗面石(walls 顏色函式)
//   主量體＝主樓牆(walls)、南面弧形外凸牆(cyl hollow)、柱廊(walls)、東西廂(walls)
//   開口＝窗與門(tint)、弧牆窗(paintFrom)、廂房窗(windowGrid)、橢圓辦公室窗(paintFrom)
//   線腳＝腰線(walls 環)、簷口(walls t=4)、窗楣(box)、牆頂欄杆(walls)、半圓欄杆(ellipseRing)
//   屋頂＝低坡四坡頂(boxTaper 中空)、北門廊山牆(boxTaper)、南柱廊頂(cyl)、廂房平頂(box)
//   頂飾＝北門廊柱(cyl)、南柱廊柱(ringOf＋cyl)、杜魯門陽台(ellipseRing)、煙囪(box)、旗桿與國旗(box 顏色函式)、
//         西廂橢圓辦公室(cyl hollow)、廂房小門廊(cyl＋boxTaper)
customBlueprint({
  name: '美國白宮',
  pal: ['#e2e0d8',   // 0 白牆（白漆砂岩）
        '#b0aca1',   // 1 簷口、腰線、窗楣、欄杆壓頂、台階（灰一階）
        '#8f8b82',   // 2 門廊柱子後面的陰影牆
        '#3b4450',   // 3 窗玻璃、旗桿
        '#7f868e',   // 4 屋頂
        '#4a3a2c',   // 5 大門
        '#cfccc3',   // 6 地面層粗面石（暗一點的白）
        '#b22234',   // 7 國旗紅
        '#3c3b6e'],  // 8 國旗藍
  lo: 1.5, hi: 18,

  gen(v, s) {
    const ft = (f, mn, odd) => dim(s, f / 40, mn, odd);   // 實物英尺 → 格數（s ＝ 每 40 ft 幾格）

    // ── 主樓尺寸 ──
    const W  = ft(168, 15, true);          // 主樓東西長（奇數，門廊置中）
    const D  = ft(85.5, 8);                // 主樓南北深
    const hG = ft(12, 2);                  // 地面層（南面露出；北面被擋牆遮住）
    const hS = ft(20, 3);                  // 國事層
    const h2 = ft(16, 2);                  // 二樓
    const HW = hG + hS + h2;               // 牆頂（簷口在這一層）
    const hx = (W - 1) / 2;                // 東西牆的 x
    const zN = -Math.floor(D / 2), zS = zN + D - 1, zc = (zN + zS) / 2;

    // 開間：北面 2·kx＋1 開間，左右對稱取整
    const m  = ft(10, 2);
    const kx = Math.max(1, Math.min(5, Math.floor((hx - m) / 2)));
    const q  = (hx - m) / kx;
    const bay = k => Math.sign(k) * Math.round(Math.abs(k) * q);

    // 窗
    const ww = ft(4.5, 1, true);
    const yG = 1,          wG = Math.max(1, Math.min(ft(7, 1), hG - 1));
    const yS = hG + 1,     wS = Math.max(1, Math.min(ft(11, 2), hS - 2));
    const y2 = hG + hS + 1, w2 = Math.max(1, Math.min(ft(9, 1), h2 - 1));

    // 北門廊
    const colA = Math.max(1, Math.round(q / 2));
    const qs   = Math.max(2, Math.round(q));
    const colB = colA + qs;
    const PW = 2 * colB + 3;               // 門廊寬（奇數）
    const PD = ft(40, 4);                  // 門廊伸出牆外幾格
    const zF = zN - PD;                    // 門廊最前緣（山牆面）
    const pzc = (zF + zN - 1) / 2;

    // 南柱廊
    const Rb = ft(20, 3);                  // 弧形外凸牆半徑
    const Rc = Rb + ft(12, 2);             // 柱子所在半徑
    const Rd = Rc + 1;                     // 平台、柱廊頂外緣
    const rc = Math.max(0.5, s * 0.045);   // 柱半徑（9000 塊約 1 格粗）
    const hC = hS + h2;                    // 柱高：國事層＋二樓通高
    const col = (x, z) => {                // 一根愛奧尼柱：柱身＋往兩側張開的柱頭
      v.cyl(x, hG, z, rc, hC - 1, 0);
      v.box(x, hG + hC - 1, z, 3, 1, 1, 0);
    };

    const rust = y => (y % 2 ? 0 : 6);     // 地面層粗面石：一層暗一層白，像橫向石縫
    const pIn = (PW - 1) / 2 - 1;
    const wallC = (x, y, z) =>
      y < hG ? rust(y)
      : (z === zN && Math.abs(x) <= pIn) || (z === zS && Math.abs(x) <= Rd) ? 2 : 0;
    const paint = (x, y, z, w, h, c, alongZ) => {   // 在牆面上塗一塊長方形（tint：牆不在就不畫）
      for (let i = -(w - 1) / 2; i <= (w - 1) / 2; i++)
        for (let j = 0; j < h; j++)
          if (alongZ) tint(v, x, y + j, z + i, c); else tint(v, x + i, y + j, z, c);
    };

    // ── 南面半圓柱廊（先畫，最後把伸進主樓裡的北半邊挖掉）──
    v.cyl(0, 0, zS, Rd, hG, (x, y) => rust(y), 1);          // 地面層弧形台座（外環）
    v.cyl(0, hG - 1, zS, Rd, 1, 1);                         // 柱廊地坪
    v.cyl(0, 0, zS, Rb, HW, 2, 1);                          // 弧形外凸牆（陰影色，柱子才分得開）
    const dwS = ft(7, 1, true);
    for (let i = -(dwS - 1) / 2; i <= (dwS - 1) / 2; i++)   // 台座正中的門
      for (let y = 0; y < hG - 1; y++) paintFrom(v, i, y, zS, 0, 0, 1, Rd + 2, 5);
    for (const [dx, dz] of [[0, 1], [1, 1], [-1, 1]]) {     // 弧牆上三開間的窗（畫柱子之前）
      for (let y = yS; y < yS + wS; y++) paintFrom(v, 0, y, zS, dx, 0, dz, Rb + 2, 3);
      for (let y = y2; y < y2 + w2; y++) paintFrom(v, 0, y, zS, dx, 0, dz, Rb + 2, 3);
    }
    ringOf(v, 6, Rc, (vv, x, z) => col(Math.round(x), zS + Math.abs(Math.round(z) - zS)),
           0, zS, Math.PI * 0.1, Math.PI * 0.8);            // 六根柱排在半圓上
    const yB = hG + hS - 1;                                  // 二樓地坪那一層
    v.ellipseRing(0, yB, zS, Rc - 1, Rc - 1, 1, 1, Rc - Rb); // 杜魯門陽台（從弧牆接到柱子內側）
    v.ellipseRing(0, yB + 1, zS, Rc - 1, Rc - 1, 1, 0, 1);   // 陽台欄杆
    v.cyl(0, HW, zS, Rd, 1, 1);                              // 柱廊頂（簷口）
    v.ellipseRing(0, HW + 1, zS, Rd, Rd, 1, 0, 1);           // 頂上欄杆
    v.ellipseRing(0, HW + 2, zS, Rd, Rd, 1, 1, 1);           // 欄杆壓頂
    const sw = ft(8, 2, true), zSt = zS + 1 + (sw - 1) / 2;
    stairs(v, Rd + hG, 0, zSt, hG, sw, '-x', 1);             // 東側樓梯（往柱廊爬）
    stairs(v, -(Rd + hG), 0, zSt, hG, sw, 'x', 1);           // 西側樓梯
    v.carve(0, 0, zS - (Rd + 2) / 2, 2 * Rd + 3, HW + 4, Rd + 1);   // 伸進主樓的北半邊挖掉

    // ── 主樓 ──
    v.walls(0, 0, zc, W, HW, D, wallC, 1);                   // 四面牆
    v.walls(0, hG, zc, W + 2, 1, D + 2, 1, 1);               // 腰線（國事層樓板那一圈）
    mirrorX(v, 1, (vv, sg) => vv.carve(sg * (Rb + 1 + Rd) / 2, hG, zS + 1, Rd - Rb, 1, 1)); // 柱廊裡不要腰線
    v.carve(0, hG, zN - 1, PW, 1, 1);                        // 北門廊裡不要腰線
    v.walls(0, HW, zc, W + 2, 1, D + 2, 1, 4);               // 簷口＋屋頂平台（往內 4 格接住屋頂）
    v.walls(0, HW + 1, zc, W, 1, D, 0, 1);                   // 牆頂欄杆
    v.walls(0, HW + 2, zc, W, 1, D, 1, 1);                   // 欄杆壓頂
    const hR = ft(15, 2), rw = W - 4, rd = D - 4;
    const rw1 = Math.max(3, rw - 4 * (hR - 1)), rd1 = Math.max(3, rd - 4 * (hR - 1));
    boxTaper(v, { x: 0, y: HW + 1, z: zc, w: rw, d: rd, w1: rw1, d1: rd1, h: hR, c: 4, t: 3 });  // 低坡四坡頂
    v.box(0, HW + hR, zc, rw1, 1, rd1, 4);                   // 屋頂最上層封起來
    const chx = Math.round(W * 0.3), chH = hR + ft(7, 2);    // 煙囪
    mirrorX(v, 1, (vv, sg) => {
      for (const z of [zN + Math.round(D * 0.3), zS - Math.round(D * 0.3)])
        vv.box(sg * (chx + 0.5), HW + 1, z, 2, chH, 1, 0);
    });

    // 北、南兩面的窗與窗楣
    const nub = yS + wS + 2 <= y2;                           // 三角窗楣的尖放得下嗎
    for (let k = -kx; k <= kx; k++) {
      const x = bay(k);
      for (const [z, o] of [[zN, -1], [zS, 1]]) {
        if (z === zS && Math.abs(x) <= Rb) continue;         // 南面中間被弧形外凸牆蓋住
        const door = z === zN && k === 0;
        paint(x, yG, z, ww, wG, 3);
        paint(x, y2, z, ww, w2, 3);
        if (door) continue;
        paint(x, yS, z, ww, wS, 3);
        v.box(x, yS + wS, z + o, ww + 2, 1, 1, 1);           // 窗楣
        if (nub && k % 2 === 0) v.box(x, yS + wS + 1, z + o, ww, 1, 1, 1);   // 三角窗楣（隔一個一種）
      }
    }
    // 東、西兩面的窗
    for (let j = -2; j <= 2; j++) {
      const z = Math.round(zc + j * q);
      if (z < zN + m || z > zS - m) continue;
      mirrorX(v, hx, (vv, x) => {
        const o = Math.sign(x);
        paint(x, yG, z, ww, wG, 3, true);
        paint(x, yS, z, ww, wS, 3, true);
        paint(x, y2, z, ww, w2, 3, true);
        vv.box(x + o, yS + wS, z, 1, 1, ww + 2, 1);
      });
    }
    const dw = ft(7, 1, true), dh = Math.min(ft(13, 2), hS - 1);
    paint(0, hG, zN, dw, dh, 5);                             // 北面正門
    paint(0, hG + dh, zN, dw, 1, 3);                         // 門上的扇形窗

    // ── 北面：擋牆把地面層擋住（北草坪比南面高一層），門廊立在台座上 ──
    const ga = ft(8, 2), zP = zN - ga - 1;
    const capC = (x, y) => (y === hG ? 1 : 0);
    v.box(0, 0, zP, W, hG + 1, 1, capC);
    mirrorX(v, hx, (vv, x) => vv.box(x, 0, (zP + zN) / 2, 1, hG + 1, ga, capC));
    v.carve(0, hG, zP, PW, 1, 1);                            // 門廊那一段不要擋牆壓頂
    v.walls(0, 0, pzc, PW, hG, PD, (x, y) => rust(y), 1);     // 門廊台座
    v.box(0, hG - 1, pzc, PW, 1, PD, 1);                     // 門廊地坪
    stairs(v, 0, 0, zF - hG, hG, PW - 4, 'z', 1);            // 門前台階
    for (const x of [-colB, -colA, colA, colB]) col(x, zF + 1);          // 正面四根高柱
    mirrorX(v, colB, (vv, x) => { for (let z = zF + 1 + qs; z <= zN - 2; z += qs) col(x, z); });  // 兩側往後的柱
    v.box(0, HW, pzc, PW, 1, PD, 1);                         // 門廊額枋
    const hP = Math.max(2, Math.floor((PW - 3) / 6) + 1), pw1 = Math.max(3, PW - 6 * (hP - 1));
    const pedC = (x, y) => {                                 // 山牆：邊框灰、三角形的面白
      const L = y - HW - 1, wL = Math.round(PW - (PW - pw1) * L / (hP - 1));
      return L === hP - 1 || Math.abs(x) >= (wL - 1) / 2 - 1 ? 1 : 0;
    };
    boxTaper(v, { x: 0, y: HW + 1, z: (zF + zN) / 2, w: PW, d: PD + 1, w1: pw1, d1: PD + 1, h: hP, c: pedC });

    // ── 東西兩側：低矮柱廊接到兩層的東廂／西廂 ──
    const Lc = ft(36, 4), Dc = ft(22, 4), Hc = hG + 1, cp = Math.max(2, ft(9, 2));
    const Ww = ft(56, 7, true), Dw = ft(64, 7), Hw = Math.max(Hc + 2, ft(26, 4));
    const zWS = zS - Math.max(2, Math.round(D * 0.12)), zWN = zWS - Dw + 1, zCN = zWS - Dc + 1;
    const wz = (zWN + zWS) / 2;
    const f1 = Math.max(2, Math.floor(Hw / 2)), wh = Math.max(1, Math.min(ft(7, 1), f1 - 1));
    const stepW = Math.max(2, Math.round(q));
    const pw = ft(26, 5, true), pd = ft(10, 2), po = (pw - 1) / 2, pc1 = Math.round((pw - 1) / 6);
    mirrorX(v, 1, (vv, sg) => {
      const xa = hx + 1, xb = hx + Lc;                       // 柱廊東西兩端（正值，乘 sg）
      const cx = sg * (xa + xb) / 2;
      vv.walls(cx, 0, (zCN + zWS - 2) / 2, Lc, Hc, Dc - 2, (x, y, z) => (z === zWS - 2 ? 2 : 0), 1);
      vv.box(cx, Hc, (zCN + zWS) / 2, Lc, 1, Dc, 1);          // 柱廊頂
      for (let x = xa + 1; x <= xb; x += cp) vv.box(sg * x, 0, zWS, 1, Hc, 1, 0);   // 南面一排柱

      const x0 = xb + 1, x1 = xb + Ww, wx = sg * (x0 + x1) / 2;   // 廂房
      const wingC = (x, y, z) => (z === zWN && Math.abs(x - wx) <= po && y < Hw - 1 ? 2 : 0);
      vv.walls(wx, 0, wz, Ww, Hw, Dw, wingC, 1);
      vv.walls(wx, Hw, wz, Ww + 2, 1, Dw + 2, 1, 2);           // 簷口
      vv.box(wx, Hw, wz, Ww - 2, 1, Dw - 2, 4);                 // 平屋頂
      vv.walls(wx, Hw + 1, wz, Ww, 1, Dw, 0, 1);                // 女兒牆
      const nWc = Math.max(2, Math.floor((Ww - 3) / stepW) + 1);
      const nWz = Math.max(2, Math.floor((Dw - 3) / stepW) + 1);
      const wg = { y: 1, rows: 2, stepY: f1, w: ww, h: wh, c: 3, stepX: stepW };
      windowGrid(vv, Object.assign({ x: wx, z: zWN, cols: nWc }, wg));
      windowGrid(vv, Object.assign({ x: wx, z: zWS, cols: nWc }, wg));
      windowGrid(vv, Object.assign({ x: sg * x1, z: Math.round(wz), cols: nWz, axis: 'z' }, wg));
      // 北面入口小門廊
      const pz = zWN - pd;
      const cs = pc1 >= 1 && po - pc1 >= 2 ? [-po, -pc1, pc1, po] : [-po, po];
      for (const dx of cs) vv.cyl(wx + dx, 0, pz, rc, Hw - 1, 0);
      vv.box(wx, Hw - 1, zWN - (pd + 1) / 2, pw, 1, pd, 1);
      boxTaper(vv, { x: wx, y: Hw, z: zWN - pd / 2, w: pw, d: pd + 1, w1: 3, d1: pd + 1, h: 2, c: 1 });
      // 西廂南面的橢圓辦公室（靠主樓那一端）
      if (sg < 0) {
        const rO = ft(16, 2) + 0.4, xO = sg * (x0 + Math.round(Ww * 0.3)), hO = f1 + 1;
        vv.cyl(xO, 0, zWS, rO, hO, 0, 1);
        vv.cyl(xO, hO, zWS, rO, 1, 1);
        for (const dx of [-1, 0, 1])
          for (let y = 1; y <= wh; y++) paintFrom(vv, xO, y, zWS, dx, 0, 1, Math.ceil(rO) + 2, 3);
      }
    });

    // ── 屋頂正中的旗桿與國旗（旗面朝正面）──
    const yT = HW + hR, pH = ft(26, 4), fw = ft(30, 5), fh = ft(14, 3, true), fz = Math.round(zc);
    v.box(0, yT + 1, fz, 1, pH, 1, 3);
    v.box((1 + fw) / 2, yT + pH - fh + 1, fz, fw, fh, 1, (x, y) => {
      const r = yT + pH - y;                                   // 從上往下第幾條
      if (r < Math.ceil(fh / 2) && x <= Math.ceil(fw * 0.4)) return 8;
      return r % 2 ? 0 : 7;
    });
  }
});
