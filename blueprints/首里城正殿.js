// 檔名：首里城正殿.js
// v1.315.0 盲測第九回：子 agent 只拿〈藍圖製作說明〉、從零做出來的第一版（沒有任何回饋），原樣收進來（只改了 name 與檔名那一行；見 開發筆記〈盲測第九回：松前城天守、哆啦A夢重做，新增淺草寺雷門、首里城正殿、東京鐵塔、招財貓、柴犬（v1.315.0）〉）
// 正面：橫長的朱紅木造宮殿，兩層紅瓦屋頂（下層一圈腰簷、上層入母屋大屋頂），正中央一個鐘形的大唐破風從下簷頂到上簷，
//       底下是門廊，石台階最下面兩側一對龍柱，屋脊兩端龍頭往上翹
// 側面：上層屋頂的山牆（妻）三角朝左右、朱紅板；唐破風往前凸出約 3 公尺像一個門廊
// 三樣識別物：正面中央的大唐破風（鐘形曲線＋山花板中央金飾）、屋脊兩端的龍頭棟飾、台階前那一對大龍柱
// 比例表（實物，公尺）：正殿間口約 29、奧行約 17、地面到屋脊約 17.5（戰前木模型 高 1.7／寬 3／深 2.3，高寬比約 0.57）；
//   石基壇高約 1.6、外緣比牆寬 1.8；一層牆高 4.3；下層腰簷出簷 2、坡高 3；二層量體 22×10、外露 2.4；
//   上層出簷 2、四坡段收 3、山牆段約 4；唐破風寬約 10、從下簷頂到上簷、往前凸 3；大龍柱實物約 3.1（誇大到約 4＋龍頭）
// 輪廓寬度（正面，以下簷寬 33m ＝ 1）：基壇 1.00／一層牆 0.88／下簷 1.00／二層 0.67／上簷 0.79／屋脊（含龍頭）0.6／唐破風 0.30
// 部件尺寸（9000 塊估 s ≈ 16，1 公尺 ≈ 1.6 格）：下簷寬 53 格、一層牆高 7、唐破風寬 17 高 8、中央金飾半徑 2、
//   屋脊長 31、龍頭 R≈2.3（頭連嘴長約 9 格、高約 7）、大龍柱 柱身 3×3 高 4＋龍頭約 5、台階 3 階寬 9
// 部件：基壇(walls 兩段) 門廊台(box) 台階(stairs) 欄杆(box) 大龍柱(cyl＋螺旋顏色函式、龍頭 blob＋limb)
//   一層牆(walls) 門扇(windowGrid) 正門(windowGrid) 腰簷簷下(walls) 下層腰簷(boxTaper t) 二層牆(walls) 二層窗(windowGrid)
//   上簷簷下(walls) 上層四坡段(boxTaper t) 上層山牆段(boxTaper t、d1=1) 山牆朱板(顏色函式) 懸魚(tint) 屋脊白灰泥(box)
//   龍頭棟飾(blob＋limb) 唐破風屋面(plate 'xy') 唐破風山花板(逐欄 box) 中央金飾(顏色函式) 門廊柱(box) 虹梁(box)
customBlueprint({
  name: '首里城正殿',
  pal: ['#8e241c',   // 0 朱漆（牆、柱、山花板）
        '#cf6a52',   // 1 赤瓦
        '#d98068',   // 2 赤瓦灰縫那一行（淡一階）
        '#4a1c16',   // 3 簷下陰影
        '#aaa294',   // 4 琉球石灰岩
        '#7e776b',   // 5 石材暗階
        '#d9a63a',   // 6 金飾、龍頭棟飾
        '#3a140f',   // 7 門扇格子、窗（暗）
        '#e4dccf'],  // 8 屋脊白灰泥
  lo: 2.5, hi: 26,

  gen(v, s) {
    const M = (m, lo, odd) => dim(s, m / 10, lo, odd);      // 公尺 → 格（s ≈ 每 10 公尺幾格）
    const av = r => (r > 2.9 && r < 3.15 ? 3.15 : r > 3.88 && r < 4.08 ? 4.08 : r);  // blob 半徑避開冒尖帶
    const stone = (x, y, z) => (hash100(x, y, z) < 18 ? 5 : 4);
    const tile = (hw, hd) => (x, y, z) => {                  // 赤瓦：灰縫順著坡往下（前後坡沿 x 排、左右坡沿 z 排）
      const k = (hd - Math.abs(z)) <= (hw - Math.abs(x)) ? x : z;
      return ((k % 3) + 3) % 3 === 0 ? 2 : 1;
    };
    // 龍頭：(x0,y0,z0) 是脖子根（插在下面那件裡），sg = 嘴朝 +x(1)／−x(−1)
    const dragon = (x0, y0, z0, sg, R, c, ce) => {
      const hx = x0 + sg * 0.35 * R, hy = y0 + 1.5 * R;
      limb(v, { x: x0 - sg * 0.3 * R, y: y0, z: z0, x1: hx, y1: hy, z1: z0,
                r: Math.max(0.8, 0.6 * R), r1: Math.max(0.75, 0.5 * R), c });              // 脖子
      blob(v, hx, hy, z0, av(1.05 * R), av(0.85 * R), av(0.8 * R), c);                     // 頭
      limb(v, { x: hx, y: hy - 0.1 * R, z: z0, x1: hx + sg * 1.9 * R, y1: hy + 0.05 * R, z1: z0,
                r: Math.max(0.8, 0.5 * R), r1: Math.max(0.75, 0.42 * R), c });             // 上顎
      limb(v, { x: hx + sg * 0.2 * R, y: hy - 0.65 * R, z: z0, x1: hx + sg * 1.5 * R, y1: hy - 1.25 * R, z1: z0,
                r: Math.max(0.75, 0.36 * R), c });                                         // 下顎（張嘴）
      mirrorZ(v, 1, (vv, sz) => limb(vv, { x: hx - sg * 0.3 * R, y: hy + 0.5 * R, z: z0 + sz * 0.35 * R,
                x1: hx - sg * 1.5 * R, y1: hy + 1.5 * R, z1: z0 + sz * 0.55 * R, r: Math.max(0.75, 0.3 * R), c })); // 角
      mirrorZ(v, 1, (vv, sz) => paintFrom(vv, Math.round(hx + sg * 0.35 * R), Math.round(hy + 0.25 * R), z0,
                0, 0, sz, Math.ceil(R) + 2, ce));                                          // 眼
    };

    // ── 尺寸（全部從公尺換算）──
    const W1 = M(29, 15, true), D1 = M(17, 9, true), H1 = M(4.3, 4);
    const BH = M(1.6, 2), BM = M(1.8, 2), OV1 = M(2.0, 2);
    const W2 = M(22, 11, true), D2 = M(10, 5, true);
    const hL = M(3.0, 2), H2v = M(2.4, 2), OV2 = M(2.0, 2);
    const BW = W1 + 2 * BM, BD = D1 + 2 * BM;
    const zF1 = -(D1 - 1) / 2, zF2 = -(D2 - 1) / 2;          // 一層、二層正面牆的 z
    const yL0 = BH + H1;                                      // 下層腰簷最底層
    const yU0 = yL0 + hL + H2v;                               // 上層屋頂最底層
    const KW = M(10, 7, true), hw = (KW - 1) / 2, PD = M(3.0, 2);
    const zK = zF1 - PD;                                      // 唐破風正面
    const za = zK - 1;                                        // 門廊台前緣
    const SW = M(5.5, 5, true);

    // ── 台基：石基壇（外皮兩格＋頂面一圈）、門廊台、台階、欄杆 ──
    v.walls(0, 0, 0, BW, BH - 1, BD, stone, 2);
    v.walls(0, BH - 1, 0, BW, 1, BD, stone, BM + 1);
    v.box(0, 0, (za + zF1) / 2, KW + 2, BH, zF1 - za + 1, stone);
    stairs(v, 0, 0, za - BH, BH, SW, 'z', stone);
    const hb = M(1.0, 1), zB = zF1 - BM;
    mirrorX(v, 1, (vv, sg) => {
      const xa = (KW + 3) / 2, xb = (BW - 1) / 2;
      vv.box(sg * (xa + xb) / 2, BH, zB, xb - xa + 1, hb, 1, 4);
      const xc = (SW + 1) / 2, xd = (KW + 1) / 2;
      vv.box(sg * (xc + xd) / 2, BH, za, xd - xc + 1, hb, 1, 4);
    });

    // ── 大龍柱：台階最下面兩側，柱身螺旋紋，龍頭相對 ──
    const pr = Math.max(1.1, s * 0.075), PH = M(2.4, 3), Rp = Math.max(1.4, s * 0.13);
    const px = (SW - 1) / 2 + 3, pz = za - BH;
    mirrorX(v, 1, (vv, sg) => {
      const x0 = sg * px, pw = 2 * Math.round(pr) + 3;
      vv.box(x0, 0, pz, pw, 1, pw, 5);
      vv.cyl(x0, 1, pz, pr, PH, (x, y, z) => {
        const f = ((Math.atan2(z - pz, x - x0) / (2 * Math.PI) + y / 4) % 1 + 1) % 1;
        return f < 0.35 ? 5 : 4;
      });
      dragon(x0, PH, pz, -sg, Rp, 4, 7);
    });

    // ── 一層：朱紅牆、門扇、正門 ──
    v.walls(0, BH, 0, W1, H1, D1, 0, 1);
    const bayW = M(1.6, 1), bayS = M(2.9, 3), bayH = Math.max(1, H1 - 3);
    const colsX = 2 * Math.floor(((W1 - 1) / 2 - 2) / bayS) + 1;
    const colsZ = 2 * Math.floor(((D1 - 1) / 2 - 2) / bayS) + 1;
    mirrorZ(v, -zF1, (vv, dz) => windowGrid(vv, { x: 0, y: BH + 1, z: dz, cols: colsX, rows: 1,
                                                  stepX: bayS, w: bayW, h: bayH, c: 7 }));
    mirrorX(v, (W1 - 1) / 2, (vv, dx) => windowGrid(vv, { x: dx, y: BH + 1, z: 0, cols: colsZ, rows: 1,
                                                  stepX: bayS, w: bayW, h: bayH, c: 7, axis: 'z' }));
    windowGrid(v, { x: 0, y: BH, z: zF1, w: M(3.6, 3, true), h: H1 - 2, c: 7 });   // 正門（門廊後面）

    // ── 下層腰簷：簷下一圈接回牆面，再疊中空的收分屋面 ──
    const wL = W1 + 2 * OV1, dL = D1 + 2 * OV1;
    v.walls(0, yL0 - 1, 0, wL, 1, dL, 3, OV1 + 1);
    const runL = Math.max(wL - W2 - 2, dL - D2 - 2) / 2;
    const tL = Math.ceil(runL / Math.max(1, hL - 1)) + 1;
    boxTaper(v, { x: 0, y: yL0, z: 0, w: wL, d: dL, w1: W2 + 2, d1: D2 + 2, h: hL, t: tL, c: tile(wL / 2, dL / 2) });

    // ── 二層：外露一段朱紅牆與窗 ──
    v.walls(0, yL0, 0, W2, yU0 - yL0, D2, 0, 1);
    const winS = M(2.6, 3), cols2 = 2 * Math.floor(((W2 - 1) / 2 - 2) / winS) + 1;
    mirrorZ(v, -zF2, (vv, dz) => windowGrid(vv, { x: 0, y: yL0 + hL + 1, z: dz, cols: cols2, rows: 1,
                                                  stepX: winS, w: M(1.2, 1), h: Math.max(1, H2v - 3), c: 7 }));

    // ── 上層入母屋：簷下、四坡段、山牆段（兩端長出朱紅山牆三角）、屋脊、懸魚 ──
    const wU = W2 + 2 * OV2, dU = D2 + 2 * OV2;
    v.walls(0, yU0 - 1, 0, wU, 1, dU, 3, OV2 + 1);
    const r1 = Math.min(M(3.0, 2), (dU - 5) / 2);
    boxTaper(v, { x: 0, y: yU0, z: 0, w: wU, d: dU, w1: wU - 2 * r1, d1: dU - 2 * r1, h: r1 + 1, t: 2,
                  c: tile(wU / 2, dU / 2) });
    const wG = wU - 2 * r1, dG = dU - 2 * r1, hG = (wG - 1) / 2;
    const yG = yU0 + r1 + 1, nG = (dG - 1) / 2;
    boxTaper(v, { x: 0, y: yG, z: 0, w: wG, d: dG - 2, w1: wG, d1: 1, h: nG, t: 2,
                  c: (x, y, z) => (Math.abs(x) >= hG - 1 ? 0 : (((x % 3) + 3) % 3 === 0 ? 2 : 1)) });
    const yR = yG + nG;                                        // 屋脊白灰泥那一層
    v.box(0, yR, 0, wG, 1, 1, 8);
    mirrorX(v, hG, (vv, dx) => { tint(vv, dx, yR - 2, 0, 6); tint(vv, dx, yR - 3, 0, 6); });   // 懸魚

    // ── 龍頭棟飾：屋脊兩端，相對而望 ──
    const Rd = Math.max(1.6, s * 0.145);
    mirrorX(v, 1, (vv, sg) => dragon(sg * (hG - 1), yR, 0, -sg, Rd, 6, 7));

    // ── 唐破風：山花板（中央金飾）→ 鐘形屋面（往後一路接到二層牆）→ 門廊柱與虹梁 ──
    const yK = yL0, KH = yU0 - yL0;
    const kc = x => yK + KH * (1 + Math.cos(Math.PI * Math.min(1, Math.abs(x) / hw))) / 2;
    const yDisc = yK + Math.round(KH * 0.42), rd = Math.max(1.5, KH * 0.25);
    for (let x = -hw + 1; x <= hw - 1; x++) {
      const top = Math.round(kc(x)) - 1;
      if (top < yK) continue;
      v.box(x, yK, zK + 1, 1, top - yK + 1, 1, (xx, yy) => (Math.hypot(xx, yy - yDisc) <= rd + 0.35 ? 6 : 0));
    }
    let zBk = zF2;
    if ((zBk - zK + 1) % 2 === 0) zBk += 1;
    const pts = [];
    for (let i = -6; i <= 6; i++) pts.push([hw * i / 6, kc(hw * i / 6)]);
    plate(v, { plane: 'xy', at: (zK + zBk) / 2, t: zBk - zK + 1, w: 1.8, pts,
               c: (x, y, z) => ((((z - zK) % 3) + 3) % 3 === 2 ? 2 : 1) });
    v.box(0, yK - 1, zK + 1, KW, 1, 1, 0);                                     // 虹梁
    for (const cx of [hw - 1, Math.round((hw - 1) * 0.42)])
      mirrorX(v, cx, (vv, dx) => vv.box(dx, BH, zK + 1, 1, yK - 1 - BH, 1, 0)); // 門廊柱
  }
});
