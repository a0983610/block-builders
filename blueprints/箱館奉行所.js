// 檔名：箱館奉行所.js
// v1.313.0 盲測第七回：子 agent 只拿〈藍圖製作說明〉、從零做出來的第二版（看過一次報告＋9000 四視圖），原樣收進來（只改了 name 與檔名那一行；見 開發筆記〈盲測第七回：金閣寺、銀閣寺、箱館奉行所、京都五重塔（v1.313.0）〉）
// 正面：橫長的白牆平房，上面壓一片又寬又厚的深灰瓦屋頂（入母屋：下段四坡佔大半、上段兩坡小而陡），屋脊正中冒出一座小小的方形太鼓櫓；
//       正中間往前突出一座大玄関，自己帶一個山牆朝前、下緩上陡的三角屋頂（白色妻面、深色破風、木色虹梁）
// 側面：屋頂下段是寬大的四坡斜面，頂上一小片白色三角妻、深色破風、中間一顆懸魚；玄関往 −z 突出
// 三樣識別物：①又大又重、佔將近一半高度的深灰瓦入母屋屋頂 ②屋脊正中的太鼓櫓（白身、暗窗、四坡小屋頂）③突出的大玄関與它朝前的三角山牆
// 比例表（實物）：查到的只有床面積 979.40 m²、木造平屋建（太鼓櫓 5 層）、復元原庁舎約 1/3。
//   其餘照一般認識估：間口約 45 m、奥行約 20 m（45×20≈900 m²，加玄関約 90 m² 對得上 979 m²）；
//   軒高約 4.2 m（另有約 0.7 m 石基壇）、出簷約 2 m、軒→棟約 7.8 m、大棟 1 m；太鼓櫓約 4.5 m 見方、露出棟上約 2.8 m、櫓屋根約 2.2 m，頂端約 19 m；
//   玄関間口約 9.5 m、突出約 5.5 m。換算：1 m ≈ s/10 格。屋頂（軒→大棟）約佔全高 45%。
// 輪廓寬度（正面，以屋簷全寬 ＝ 1）：基壇 0.98／白牆 0.93（玄関 0.21 突在正中）／屋簷 1.00／屋頂上段 0.70／大棟連鬼瓦 0.73／太鼓櫓身 0.09（縁 0.11）／櫓屋根 0.14
// 部件尺寸（v1 報告：9000 塊 s=16.38；這版屋頂與玄関變大，估 s ≈ 16）：牆 dim(s,4.5,21,奇)=73、深 dim(s,2,11,奇)=33、牆高 7、出簷 3；
//   屋頂 79×39，下段 dim(s,0.36,3)=6 層（每層每邊收約 2 格）、上段 dim(s,0.42,4)=7 層（每邊收約 1.2 格）、妻三角約 15 寬 7 高；大棟 2 層；
//   太鼓櫓 7 格見方、棟上露 dim(s,0.28,3)=4 層、櫓窗 3×2、櫓屋根 11→3 寬 4 層；
//   玄関 dim(s,0.95,9,奇)=15 寬、突出 dim(s,0.55,4)=9、山牆 19 寬、下段每邊收 2、上段每邊收 1、共約 6 層；柱距 6、窗 3×3
// 部件：基壇(walls 環＋box) 白牆(walls＋顏色函式：柱、長押、簷下陰影) 格子窗(windowGrid 四面) 出桁(walls 環)
//   屋頂下段四坡(boxTaper t) 屋頂上段兩坡＋妻＋破風(boxTaper w1=w d1=1 t) 懸魚(tint) 大棟(box) 鬼瓦(box)
//   太鼓櫓身(walls) 縁(walls 環) 櫓窗(windowGrid) 櫓屋根(boxTaper) 宝珠(box)
//   玄関牆(walls) 玄関口(carve) 式台(box) 板戸(windowGrid tint) 玄関側窗(windowGrid) 玄関屋根兩段＋妻＋破風＋虹梁(boxTaper ×2, w1 收到 1)
customBlueprint({
  name: '箱館奉行所',
  pal: ['#e4dfd3',   // 0 白漆喰
        '#b8b2a6',   // 1 白壁陰影（簷下那一排）
        '#8b6b4a',   // 2 木柱、長押、虹梁、懸魚、式台
        '#3b2f27',   // 3 暗木：格子窗、板戸、出桁、破風、縁
        '#40454c',   // 4 瓦（本色，深灰）
        '#25282c',   // 5 大棟、鬼瓦、隅棟、軒先
        '#8e8a83',   // 6 基壇石
        '#4a4f56',   // 7 瓦（亮一階，瓦筋）
        '#76726c'],  // 8 基壇石（暗一階）
  lo: 2.5, hi: 24,

  gen(v, s) {
    // ── 小工具（寫在 gen 裡）──
    const par = (n) => ((n % 2) + 2) % 2;
    const tileX = (x) => (par(x) ? 7 : 4);            // 前後坡：瓦筋沿 x 一條一條
    const tileZ = (z) => (par(z) ? 7 : 4);            // 兩端的坡：瓦筋沿 z
    const lw = (a, b, i, h) => (h <= 1 ? a : Math.round(a + (b - a) * i / (h - 1)));  // boxTaper 第 i 層的寬
    const cLo = (w) => -Math.floor((w - 1) / 2);      // 置中寬 w 的最小座標
    const cHi = (w) => Math.ceil((w - 1) / 2);        // 最大座標（偶數多的那格在 +）

    // ── 主量體尺寸 ──
    const W = dim(s, 4.5, 21, true);       // 間口
    const D = dim(s, 2.0, 11, true);       // 奥行
    const H = dim(s, 0.42, 4);             // 牆高
    const bh = dim(s, 0.07, 1);            // 基壇高
    const ov = dim(s, 0.2, 2);             // 出簷
    const hw = (W - 1) / 2, hd0 = (D - 1) / 2;
    const zf = -hd0;                       // 正面牆的 z
    const yT = bh + H - 1;                 // 牆頂那一層
    const ps = 2 * dim(s, 0.2, 2);         // 柱距（偶數：窗正好落在兩柱正中）
    const wh = dim(s, 0.2, 2);             // 窗高
    const ww = (ps / 2) % 2 === 1 ? ps / 2 : ps / 2 - 1;   // 窗寬（奇數）
    const wy = bh + 1 + Math.max(0, Math.floor((H - 2 - wh) / 2));

    // 1 基壇：外露的一圈石（裡面看不到，不填）
    v.walls(0, 0, 0, W + 4, bh, D + 4, (x, y, z) => (hash100(x, y, z) < 25 ? 8 : 6), 3);

    // 2 白牆＋木柱：長押是木色，柱子每 ps 一根，簷下那一排放陰影色（土台不上色，白牆多留一點）
    const wallC = (x, y, z) => {
      if (y === yT) return 2;
      const ax = Math.abs(x), az = Math.abs(z);
      if (ax === hw && az === hd0) return 2;
      if (az === hd0 ? ax % ps === 0 : az % ps === 0) return 2;
      return y === yT - 1 ? 1 : 0;
    };
    v.walls(0, bh, 0, W, H, D, wallC, 1);

    // 3 格子窗：前後兩面、左右兩面，落在兩柱正中
    const kF = Math.floor((hw - 2 - (ww - 1) / 2 - ps / 2) / ps);
    const kS = Math.floor((hd0 - 2 - (ww - 1) / 2 - ps / 2) / ps);
    if (kF >= 0) mirrorZ(v, hd0, (vv, dz) => windowGrid(vv, { x: 0, y: wy, z: dz, cols: 2 * (kF + 1), rows: 1,
                                                                stepX: ps, w: ww, h: wh, c: 3, axis: 'x' }));
    if (kS >= 0) mirrorX(v, hw, (vv, dx) => windowGrid(vv, { x: dx, y: wy, z: 0, cols: 2 * (kS + 1), rows: 1,
                                                               stepX: ps, w: ww, h: wh, c: 3, axis: 'z' }));

    // 4 出桁：牆頂外一圈深色，屋簷接在它上面
    v.walls(0, yT, 0, W + 2, 1, D + 2, 3, 1);

    // 5 屋頂下段（四坡，緩，佔大半）
    const yr = yT + 1;
    const RW = W + 2 * ov, RD = D + 2 * ov;
    const rh1 = dim(s, 0.36, 3), rh2 = dim(s, 0.42, 4);
    const a = ((RD - 1) / 2) * 0.65 / rh1;             // 下段每層每邊收幾格（下段吃掉 65% 的進深）
    const sLo = Math.round(a * (rh1 - 1)), sUp = Math.round(a * rh1);
    const tLo = Math.max(Math.floor(a) + 1, ov);       // 比每層收的多、又碰得到出桁
    const W1 = RW - 2 * sLo, D1 = RD - 2 * sLo;
    const lowC = (x, y, z) => {
      const i = y - yr;
      const wi = lw(RW, W1, i, rh1), di = lw(RD, D1, i, rh1);
      const x0 = cLo(wi), x1 = cHi(wi), z0 = cLo(di), z1 = cHi(di);
      if (i === 0 && (x === x0 || x === x1 || z === z0 || z === z1)) return 5;   // 軒先
      const ex = x < x0 + tLo || x > x1 - tLo, ez = z < z0 + tLo || z > z1 - tLo;
      if (ex && ez) return 5;                                                   // 隅棟
      return ex ? tileZ(z) : tileX(x);
    };
    boxTaper(v, { x: 0, y: yr, z: 0, w: RW, d: RD, w1: W1, d1: D1, h: rh1, t: tLo, c: lowC });

    // 6 屋頂上段（兩坡，陡、小）：兩端自己長出白色妻面，邊緣是深色破風
    const wu = RW - 2 * sUp, du = RD - 2 * sUp;
    const tUp = Math.floor((du - 1) / 2 / (rh2 - 1)) + 1;
    const yu = yr + rh1, yTop = yu + rh2 - 1;
    const xe = (wu - 1) / 2;
    const upC = (x, y, z) => {
      const i = y - yu;
      const di = lw(du, 1, i, rh2);
      const strip = z < cLo(di) + tUp || z > cHi(di) - tUp;
      if (Math.abs(x) > xe - tUp) return strip ? 3 : 0;
      return tileX(x);
    };
    boxTaper(v, { x: 0, y: yu, z: 0, w: wu, d: du, w1: wu, d1: 1, h: rh2, t: tUp, c: upC });

    // 7 懸魚：妻面頂端下面兩格木色
    let ik = rh2 - 1;
    while (ik > 0 && lw(du, 1, ik, rh2) < 2 * tUp + 1) ik--;
    mirrorX(v, xe, (vv, dx) => { tint(vv, dx, yu + ik, 0, 2); tint(vv, dx, yu + ik - 1, 0, 2); });

    // 8 大棟與鬼瓦
    const rdh = dim(s, 0.1, 1);
    v.box(0, yTop + 1, 0, wu + 2, rdh, 3, 5);
    mirrorX(v, (wu + 1) / 2, (vv, dx) => vv.box(dx, yTop + 1, 0, 1, rdh + 1, 3, 5));

    // 9 太鼓櫓：從屋頂裡長出來，棟以下包深色下見板，棟上白身、四角木柱、頂上長押
    const tw = dim(s, 0.45, 5, true), tb = dim(s, 0.28, 3);
    const th = (tw - 1) / 2;
    const ty0 = yTop - 2, tyT = yTop + rdh + tb;
    v.walls(0, ty0, 0, tw, tyT - ty0 + 1, tw, (x, y, z) => {
      if (y <= yTop + rdh) return 3;
      if (y === tyT || (Math.abs(x) === th && Math.abs(z) === th)) return 2;
      return 0;
    }, 1);
    v.walls(0, yTop + rdh + 1, 0, tw + 2, 1, tw + 2, 3, 1);           // 縁
    const twh = Math.max(1, tb - 2), tww = tw - 4;                    // 櫓窗（太鼓的窗）
    mirrorZ(v, th, (vv, dz) => windowGrid(vv, { x: 0, y: tyT - twh, z: dz, w: tww, h: twh, c: 3 }));
    mirrorX(v, th, (vv, dx) => windowGrid(vv, { x: dx, y: tyT - twh, z: 0, w: tww, h: twh, c: 3, axis: 'z' }));
    const tov = dim(s, 0.12, 1), trh = dim(s, 0.22, 3);
    boxTaper(v, { x: 0, y: tyT + 1, z: 0, w: tw + 2 * tov, d: tw + 2 * tov, w1: 3, d1: 3, h: trh,
                  c: (x, y, z) => (y === tyT + 1 || y === tyT + trh ? 5 : 4) });
    v.box(0, tyT + 1 + trh, 0, 1, 1, 1, 5);                           // 宝珠

    // 10 大玄関：往 −z 突出，前面敞開、兩根木柱
    const pw = dim(s, 0.95, 9, true), pd = dim(s, 0.55, 4), ovp = dim(s, 0.12, 1);
    const phw = (pw - 1) / 2, za = zf - pd;
    v.box(0, 0, (za - 1 + zf) / 2, pw + 2, bh, pd + 2, 6);           // 玄関前的基壇
    v.walls(0, bh, (za + zf) / 2, pw, H, pd + 1, (x, y, z) => {
      if (y === bh || y === yT) return 2;
      if (Math.abs(x) === phw && (z === za || z === zf)) return 2;
      return 0;
    }, 1);
    v.carve(0, bh, za, pw - 2, H - 1, 1);                             // 玄関口
    const k = Math.max(1, Math.round(pd / 3));
    v.box(0, bh, (2 * zf - k - 1) / 2, pw - 2, 1, k, 2);              // 式台
    windowGrid(v, { x: 0, y: bh + 1, z: zf, w: pw - 2, h: H - 2, c: 3 });   // 板戸（裡面的大門）
    let pww = Math.max(1, pd - 4); if (pww % 2 === 0) pww--;
    mirrorX(v, phw, (vv, dx) => windowGrid(vv, { x: dx, y: wy, z: Math.round((za + zf) / 2), w: pww, h: wh, c: 3, axis: 'z' }));

    // 11 玄関屋根：山牆朝前（屋脊沿 z），下段每層每邊收 2、上段收 1（兩段都對稱），
    //    白妻面、深色破風、底下一條虹梁，往後插進大屋頂
    const wp = pw + 2 * ovp, halfP = (wp - 1) / 2;
    let halfB = Math.max(1, Math.round(halfP * 0.3));
    if ((halfP - halfB) % 2 !== 0) halfB = halfB > 1 ? halfB - 1 : halfB + 1;
    const hA = (halfP - halfB) / 2, hB = halfB + 1, ph = hA + hB;
    const zr0 = za - ovp;
    const jm = Math.min(ph - 1, rh1 + rh2 - 1);
    const dj = jm < rh1 ? lw(RD, D1, jm, rh1) : lw(du, 1, jm - rh1, rh2);
    const zr1 = cLo(dj) + 1;
    const dR = zr1 - zr0 + 1, zc = (zr0 + zr1) / 2;
    const porRoofC = (x, y, z) => {
      const i = y - yr;
      const hx = i < hA ? halfP - 2 * i : halfB - (i - hA);
      if (z <= zr0 + 1) {
        if (Math.abs(x) > hx - 2) return 3;                    // 破風
        return i === 0 ? 2 : 0;                                // 虹梁／白妻面
      }
      if (i === ph - 1) return 5;                              // 棟
      return tileZ(z);
    };
    if (hA > 0) boxTaper(v, { x: 0, y: yr, z: zc, w: wp, d: dR, w1: wp - 4 * (hA - 1), d1: dR, h: hA,
                              t: Math.max(3, ovp), c: porRoofC });
    boxTaper(v, { x: 0, y: yr + hA, z: zc, w: 2 * halfB + 1, d: dR, w1: 1, d1: dR, h: hB, t: 2, c: porRoofC });
  }
});
