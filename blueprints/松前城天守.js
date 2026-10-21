// 檔名：松前城天守.js
// v1.315.0 盲測第九回：子 agent 只拿〈藍圖製作說明〉、從零做出來的第二版（看過一次報告＋9000 四視圖），原樣收進來（只改了 name 與檔名那一行；見 開發筆記〈盲測第九回：松前城天守、哆啦A夢重做，新增淺草寺雷門、首里城正殿、東京鐵塔、招財貓、柴犬（v1.315.0）〉）
// ── 設計表 ──
// 正面（−z，南面＝桁行 45 尺那一面）：灰色石垣（下段外張的扇の勾配）上，白牆三層一層比一層窄，每層上面一圈銅綠色的出簷屋頂；
//   最上面是入母屋屋頂，長長的屋脊兩端各立一隻金鯱，正面看像兩支往外彎的角
// 側面（+x，梁間 39 尺那一面）：同樣三層收分，最頂是入母屋的白色山花三角（銅色破風板鑲邊，中間吊一個小懸魚）
// 三樣識別物：①扇の勾配的石垣台座（四角算木積的淺色隅石）②白牆＋銅綠屋頂的三重層塔（下兩重沒有破風、規規矩矩一層收一層）
//            ③最頂入母屋屋脊兩端的金鯱
// 比例表（實物）：一層 13.6×11.8 m、二層 10.9×9.1 m、三層 8.2×6.4 m（每層四邊各收 1.36 m）；
//   天守台頂約 18 m 四方；石垣高約 5 m（查不到，推估），底部每邊外張約 1.8 m；台上到屋脊 16.5 m：
//   一層牆 3.6、一重屋頂 1.5、二層牆 3.2、二重屋頂 1.5、三層牆 3.0、最上重屋頂約 4（含屋脊）；出簷約 1.3 m；鯱約 2.4 m（誇張一點）
// 輪廓寬度（正面，以一層牆寬 ＝ 1）：石垣底 1.55／石垣頂 1.32／一層 1.00、一重簷 1.19／二層 0.81、二重簷 1.00／
//   三層 0.61、最上重簷 0.81／屋脊 0.55（兩端加金鯱）
// 部件尺寸（9000 塊實測 s ＝ 11.59，1 m ≈ 0.2·s ≈ 2.3 格）：
//   石垣頂 43×39、底 51×47、高 12；一層 33×27 高 8；二層 27×21 高 7；三層 21×15 高 7；出簷 3 格；
//   下兩重屋頂各 4 層（每層四邊收 2 格）；入母屋 下段 2 層＋山花 7 層、山花三角寬 17 高 7；
//   窗 3 寬 × 2 高（一層正面 5 扇）；長押 1 格線；金鯱高 6、寬 3、厚 1（plate）；隅石 4×2 一段一段長短交替
// 部件清單：
//   台基：石垣（每層一圈 walls，退縮量照拋物線＝扇の勾配；顏色函式撒石紋＋算木積隅石）、天守台頂面（walls 一圈）
//   主量體：一～三層牆（walls）
//   開口：各層窗（windowGrid）
//   線腳：每層兩條長押、簷下陰影帶（walls 的顏色函式）
//   屋頂：一重、二重腰屋根（eave 圈 walls＋boxTaper 中空，隅棟用顏色函式描深色斜線，四角反り各翹一格）、
//         最上重入母屋（下段 boxTaper 四坡＋上段 boxTaper 只收深度長出山花）、大棟（box）
//   頂飾：金鯱一對（plate 'xy'，1 格厚）、懸魚（tint）
customBlueprint({
  name: '松前城天守',
  pal: ['#e6e3da',   // 0 白漆喰
        '#c2beb3',   // 1 長押（淺灰）
        '#a29e94',   // 2 簷下陰影
        '#507a6b',   // 3 銅瓦（綠青）
        '#355448',   // 4 大棟、隅棟（深一階）
        '#78746c',   // 5 石垣
        '#66625b',   // 6 石垣（暗）
        '#9c988e',   // 7 隅石（亮）
        '#c9a33e',   // 8 金鯱、懸魚
        '#3a3a37'],  // 9 窗
  lo: 1.5, hi: 20,

  gen(v, s) {
    // ── 尺寸（係數 ＝ 公尺 × 0.2）──
    const stp = dim(s, 0.272, 1);              // 每往上一層四邊各收 4.5 尺
    const W1 = dim(s, 2.72, 7, true);          // 一層桁行 45 尺（正面寬，沿 x）
    const D1 = dim(s, 2.36, 7, true);          // 一層梁間 39 尺（沿 z）
    const W2 = W1 - 2 * stp, D2 = D1 - 2 * stp;
    const W3 = W2 - 2 * stp, D3 = D2 - 2 * stp;
    const OV = dim(s, 0.26, 1);                // 出簷 1.3 m
    const H1 = dim(s, 0.72, 4), H2 = dim(s, 0.64, 4), H3 = dim(s, 0.60, 4);
    const RR = Math.ceil((OV + stp) / 2) + 1;  // 下兩重屋頂的層數：每層四邊收約 2 格
    const SW = dim(s, 3.6, 11, true);          // 天守台頂 18 m
    const SD = dim(s, 3.4, 11, true);
    const SH = dim(s, 1.0, 3);                 // 石垣高 5 m
    const B = dim(s, 0.36, 1);                 // 石垣底部每邊外張 1.8 m

    // ── 石垣：扇の勾配（下段外張、上段近乎垂直），每層一圈；顏色函式撒石紋、四角算木積 ──
    const ins = y => Math.round(B * Math.pow(1 - Math.min(y, SH - 1) / Math.max(1, SH - 1), 2));
    const kL = dim(s, 0.3, 2), kS = dim(s, 0.15, 1), cs = dim(s, 0.16, 1);
    const stoneC = (x, y, z) => {
      const e = ins(y), hx = (SW - 1) / 2 + e, hz = (SD - 1) / 2 + e;
      const p = Math.floor(y / cs) % 2;
      if (Math.abs(x) > hx - (p ? kL : kS) && Math.abs(z) > hz - (p ? kS : kL)) return 7;
      return hash100(x, y, z) < 22 ? 6 : 5;
    };
    for (let y = 0; y < SH - 1; y++) {
      const e = ins(y);
      v.walls(0, y, 0, SW + 2 * e, 1, SD + 2 * e, stoneC, Math.max(1, e - ins(y + 1)));
    }
    const tR = Math.max((SW - W1) / 2, (SD - D1) / 2) + 1;   // 台頂一圈，伸進一層牆底下
    v.walls(0, SH - 1, 0, SW, 1, SD, stoneC, tR);

    // ── 一層樓：白牆、兩條長押、簷下陰影、窗 ──
    const ww = dim(s, 0.22, 1, true), wst = dim(s, 0.52, 3);
    const floorOf = (yb, W, D, H, colsF, colsS) => {
      const wy = yb + Math.max(2, Math.round(H * 0.3)), wh = Math.max(1, Math.round(H * 0.3));
      v.walls(0, yb, 0, W, H, D, (x, y, z) =>
        y === yb + H - 1 ? 2 : (y === wy - 1 || y === wy + wh) ? 1 : 0, 1);
      const nf = Math.max(1, Math.min(colsF, Math.floor((W - 2) / wst)));
      const ns = Math.max(1, Math.min(colsS, Math.floor((D - 2) / wst)));
      mirrorZ(v, (D - 1) / 2, (vv, dz) => windowGrid(vv, { x: 0, y: wy, z: dz, cols: nf, stepX: wst, w: ww, h: wh, c: 9 }));
      mirrorX(v, (W - 1) / 2, (vv, dx) => windowGrid(vv, { x: dx, y: wy, z: 0, cols: ns, stepX: wst, w: ww, h: wh, c: 9, axis: 'z' }));
    };

    // ── 一重屋頂：簷口一圈接回牆面＋中空收分，隅棟描深色、四角反り ──
    const tier = (y, we, de, wt, dt, h) => {
      const sh = Math.max(we - wt, de - dt) / 2 / Math.max(1, h - 1);
      const t = Math.floor(sh) + 1;
      const hip = (x, yy, z) => {
        const f = h > 1 ? (yy - y) / (h - 1) : 0;
        const wi = Math.round(we + (wt - we) * f), di = Math.round(de + (dt - de) * f);
        const hx = x >= 0 ? Math.floor(wi / 2) : Math.ceil(wi / 2) - 1;
        const hz = z >= 0 ? Math.floor(di / 2) : Math.ceil(di / 2) - 1;
        return (hx - Math.abs(x)) === (hz - Math.abs(z)) ? 4 : 3;
      };
      v.walls(0, y, 0, we, 1, de, hip, OV + 2);
      boxTaper(v, { x: 0, y, z: 0, w: we, d: de, w1: wt, d1: dt, h, c: hip, t });
      corners4(v, (we - 1) / 2, (de - 1) / 2, (vv, cx, cz) => {
        const sx = Math.sign(cx), sz = Math.sign(cz);
        vv.set(cx, y + 1, cz, 4); vv.set(cx - sx, y + 1, cz, 4); vv.set(cx, y + 1, cz - sz, 4);
      });
    };

    const y1 = SH;                              // 一層從石垣頂上一層起
    floorOf(y1, W1, D1, H1, 5, 4);
    tier(y1 + H1, W1 + 2 * OV, D1 + 2 * OV, W2, D2, RR);
    const y2 = y1 + H1 + RR;
    floorOf(y2, W2, D2, H2, 4, 3);
    tier(y2 + H2, W2 + 2 * OV, D2 + 2 * OV, W3, D3, RR);
    const y3 = y2 + H2 + RR;
    floorOf(y3, W3, D3, H3, 3, 2);

    // ── 最上重：入母屋（下段四坡、上段只收深度，左右兩端長出山花三角）──
    const yT = y3 + H3, RTa = dim(s, 0.16, 2);
    tier(yT, W3 + 2 * OV, D3 + 2 * OV, W3 + 2, D3 + 2, RTa);
    const yG = yT + RTa, WG = Math.max(3, W3 - 2), DG = D3 + 2;
    const RTb = Math.max(3, Math.ceil((DG - 3) / 2.4) + 1);   // 上段較陡：每層每邊收約 1.2 格
    const tg = Math.floor((DG - 3) / 2 / (RTb - 1)) + 1;
    const hxg = (WG - 1) / 2;
    const gab = (x, yy, z) => {
      const di = Math.round(DG + (3 - DG) * (yy - yG) / (RTb - 1));
      const hz = z >= 0 ? Math.floor(di / 2) : Math.ceil(di / 2) - 1;
      return Math.abs(x) > hxg - tg && hz - Math.abs(z) >= 1 && yy < yG + RTb - 1 ? 0 : 3;   // 山花白、破風板 1 格銅色
    };
    boxTaper(v, { x: 0, y: yG, z: 0, w: WG, d: DG, w1: WG, d1: 3, h: RTb, c: gab, t: tg });
    mirrorX(v, hxg, (vv, dx) => {                          // 懸魚：山花頂下吊一小塊金
      tint(vv, dx, yG + RTb - 2, 0, 8);
      tint(vv, dx, yG + RTb - 3, 0, 8);
    });

    // ── 大棟與金鯱（1 格厚，側面只是一根細條）──
    const yR = yG + RTb;
    v.box(0, yR, 0, WG, 1, 3, 4);
    const SHh = dim(s, 0.48, 3), sw = Math.max(1.5, s * 0.2);
    mirrorX(v, 1, (vv, sg) => {
      plate(vv, { plane: 'xy', at: 0, t: 1, w: sw, c: 8,
        pts: [[sg * (hxg - 1), yR + 1], [sg * (hxg + 1), yR + Math.round(SHh * 0.5)], [sg * hxg, yR + SHh]] });
    });
  }
});
