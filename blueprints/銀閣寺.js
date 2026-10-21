// 檔名：銀閣寺.js
// v1.313.0 盲測第七回：子 agent 只拿〈藍圖製作說明〉、從零做出來的第一版（沒有任何回饋），原樣收進來（只改了 name 與檔名那一行；見 開發筆記〈盲測第七回：金閣寺、銀閣寺、箱館奉行所、京都五重塔（v1.313.0）〉）
// 正面：兩層樓閣。一樓寬（素木柱＋白障子，前面一條落緣），一圈下層屋簷；二樓縮一圈、黑漆牆、外繞高欄、牆上花頭窗；
//       最上面一大頂方形攢尖（寶形造）屋頂，出簷深、四角微翹，頂上一隻銅鳳凰。前景是白砂的銀沙灘（低平台）、右前方一座向月台（圓台）
// 側面：同樣是「寬一樓＋窄二樓＋大屋頂」三段收分；二樓側面中間是桟唐戶、兩旁花頭窗；向月台在建築前方
// 三樣識別物：①二樓黑牆上的花頭窗（上緣火焰形）②深出簷的寶形造屋頂＋頂上鳳凰 ③前庭白砂：有條紋的銀沙灘＋平頂圓台的向月台
// 比例表（實物，查到的）：一樓東、西面 8.2 m，北面 7.0 m、南面 5.9 m（取深 6.5 m）；東面是正面（有落緣）；二樓三間四方、四周有緣與高欄；
//   屋頂寶形造、杮葺（木片）；向月台高約 1.8 m
//   （查不到、照一般認識估的）：石基 0.4 m、一樓地面到簷口 3.0 m、下層出簷 1.5 m、二樓見方 6.0 m、二樓牆 2.9 m、二樓出簷 1.7 m、
//   屋頂高約 3.4 m、鳳凰約 2.4 m（實物小，刻意放大）；銀沙灘高 0.6 m（實物很大，壓縮成 10×4 m）、向月台底徑 4.8 m、頂徑 3.4 m
//   換算：1 m ＝ 0.5·s 格
// 輪廓寬度（正面，以下層屋簷寬 ＝ 1）：一樓牆 0.72／下層簷 1.00／二樓高欄 0.67／二樓牆 0.53／上層簷 0.81／屋頂收到頂 0.12／鳳凰翼 0.16
//   前景一列：銀沙灘 0.88（偏 +x）＋向月台 0.42（−x 那一側），整列約 1.35 倍屋簷寬
// 部件尺寸（9000 塊估 s ≈ 7.6）：一樓 31×25 格、牆高 11；下層出簷 6、屋面 4 層；二樓 23 見方、牆高 11；緣寬 3、高欄高 3；
//   花頭窗身寬 dim(s,0.6,3,奇)=5、身高 dim(s,0.5,2)=4、窗耳 7 格寬、連尖頂共 8 格高，一面兩扇＋中間一片板壁（側面是門）；
//   上層出簷 6、屋頂 4＋9＝13 層、四角翹 2 格；鳳凰 P=0.4s≈3 → 約 9 格高、翼展約 7 格；
//   銀沙灘 38×15×2 格、砂紋每 3 格一條；向月台底徑約 18、頂徑約 13、高 7
// 部件：石基(walls) 落緣(box)＋束(box)＋沓脫石(box) 一樓牆＝腰壁／障子／土壁(walls＋顏色函式) 一樓柱(box) 長押(walls)
//   下層屋頂(boxTaper 中空)＋隅棟(顏色函式)＋翹角(plate t1) 二樓緣(walls) 高欄(walls＋rowOf) 二樓黑牆(walls) 花頭窗與板壁、桟唐戶(tint)
//   上層屋頂下緩段＋上陡段(boxTaper×2)＋隅棟＋翹角(plate) 露盤(box) 鳳凰(limb 身頸頭＋plate 尾翼) 銀沙灘(walls＋box 砂紋顏色函式) 向月台(taper＋cyl)
customBlueprint({
  name: '銀閣寺',
  pal: ['#7a6a55',   // 0 素木（一樓柱、腰壁、落緣、高欄）
        '#e6e2d6',   // 1 障子白
        '#26221f',   // 2 黑漆（二樓外牆）
        '#5f5852',   // 3 木片葺屋頂
        '#9c8448',   // 4 銅鳳凰、露盤
        '#d8d4c8',   // 5 白砂
        '#a9a497',   // 6 砂紋、白砂陰影
        '#8b8a84',   // 7 石基、沓脫石
        '#4e4236',   // 8 深木（長押、簷口、隅棟、二樓緣板、板壁與門）
        '#b9ad98',   // 9 花頭窗
        '#b5ae9f',   // 10 障子框（白的灰一階）
        '#9a8a70'],  // 11 土壁（一樓北面西半）
  lo: 1.5, hi: 14,

  gen(v, s) {
    const K = 2, T = 3;                                   // 屋面每層每邊收 K 格、殼厚 T（T 要比 K 大）
    const jc = e => { let j = 0; while (e - K * j > T - 1) j++; return j; };  // 出簷 e 時，牆要伸進屋頂幾層才接得到屋面
    const rs = p => Math.sign(p) * Math.round(Math.abs(p));                   // 左右對稱的取整

    // ── 台基與一樓（心空殿，書院造）
    const W1 = dim(s, 4.1, 13, true), D1 = dim(s, 3.25, 11, true);
    const hw = (W1 - 1) / 2, hd = (D1 - 1) / 2;
    const hb = dim(s, 0.2, 1);                            // 石基高
    const H1 = dim(s, 1.5, 6);                            // 地面到下層簷口
    const e1 = dim(s, 0.75, 2);                           // 下層出簷
    const j1 = jc(e1), hL = j1 + 2;                       // 下層屋面層數
    const y1r = hb + H1;                                  // 下層簷口那一層
    const wsF = dim(s, 0.25, 1), wsS = dim(s, 0.5, 2);    // 腰壁高：正面低、側背面高

    const postsX = [0, 1, 2, 3, 4].map(i => rs(-(hw + 1) + i * (W1 + 1) / 4));   // 正面四間
    const postsZ = [0, 1, 2, 3].map(i => rs(-(hd + 1) + i * (D1 + 1) / 3));      // 側面三間
    const midX = [0, 1, 2, 3].map(i => rs((postsX[i] + postsX[i + 1]) / 2));    // 每間兩扇障子的分隔
    const midZ = [0, 1, 2].map(i => rs((postsZ[i] + postsZ[i + 1]) / 2));

    v.walls(0, 0, 0, W1 + 2, hb, D1 + 2, 7, 1);           // 石基

    const dv = dim(s, 0.45, 2);                           // 落緣（東面＝正面）
    const za = -(hd + 1 + dv), zb = -(hd + 2);
    v.box(0, hb - 1, (za + zb) / 2, W1 + 2, 1, zb - za + 1, 0);
    if (hb >= 2) for (const px of postsX) v.box(px, 0, za, 1, hb - 1, 1, 8);      // 緣下的束
    v.box(0, 0, za - 1, dim(s, 0.5, 3, true), 1, 1, 7);  // 沓脫石

    const wall1 = (x, y, z) => {
      if (y >= y1r - 1) return 8;                         // 長押與簷下
      const ry = y - hb;
      if (z === -hd) return ry < wsF ? 0 : (midX.includes(x) ? 10 : 1);           // 正面：低腰壁＋高障子
      if (x === -hw && z > 0) return 11;                  // 北面西半是土壁
      if (ry < wsS) return 0;                             // 側背面：腰壁入障子窗
      if (z === hd) return midX.includes(x) ? 10 : 1;
      return midZ.includes(z) ? 10 : 1;
    };
    v.walls(0, hb, 0, W1, H1 + j1 + 1, D1, wall1, 1);     // 牆往上伸進屋頂，接得到屋面

    for (const px of postsX) {                            // 柱子凸出牆面一格
      v.box(px, hb, -(hd + 1), 1, H1 - 1, 1, 0);
      v.box(px, hb, hd + 1, 1, H1 - 1, 1, 0);
    }
    for (const pz of postsZ) {
      v.box(-(hw + 1), hb, pz, 1, H1 - 1, 1, 0);
      v.box(hw + 1, hb, pz, 1, H1 - 1, 1, 0);
    }
    v.walls(0, y1r - 1, 0, W1 + 2, 1, D1 + 2, 8, 1);      // 長押：柱頂橫過一圈深色

    // 翹角：簷口四角往外上甩一點（正面一片 'xy'、側面一片 'zy'）
    const upturn = (E, F, y, L, R) => mirrorX(v, 1, (vx, sx) => mirrorZ(vx, 1, (vz, sz) => {
      plate(vz, { plane: 'xy', at: sz * F, t: 1, w: 1.2, c: 8,
                  pts: [[sx * (E - L), y], [sx * (E - 1), y + R * 0.4], [sx * (E + 1), y + R]] });
      plate(vz, { plane: 'zy', at: sx * E, t: 1, w: 1.2, c: 8,
                  pts: [[sz * (F - L), y], [sz * (F - 1), y + R * 0.4], [sz * (F + 1), y + R]] });
    }));

    // ── 下層屋頂（一圈裙屋頂）
    const Wo = W1 + 2 * e1, Do = D1 + 2 * e1, Ex = (Wo - 1) / 2, Ez = (Do - 1) / 2;
    boxTaper(v, { x: 0, y: y1r, z: 0, w: Wo, d: Do,
                  w1: Wo - 2 * K * (hL - 1), d1: Do - 2 * K * (hL - 1), h: hL, t: T,
                  c: (x, y, z) => ((y === y1r || Math.abs(x) - Math.abs(z) === hw - hd) ? 8 : 3) });
    upturn(Ex, Ez, y1r, dim(s, 0.45, 2), 1);

    // ── 二樓（潮音閣，禪宗樣）
    const W2 = dim(s, 3.0, 9, true), h2 = (W2 - 1) / 2;
    const ev = dim(s, 0.45, 2), Wv = W2 + 2 * ev, hv = (Wv - 1) / 2;
    const yv = y1r + hL;                                  // 緣板那一層（壓在下層屋頂最上一圈上）
    v.walls(0, yv, 0, Wv, 1, Wv, 8, ev + 1);              // 緣板：從高欄一路接到二樓牆
    const rh = dim(s, 0.4, 3);                            // 高欄高
    v.walls(0, yv + 1, 0, Wv, 1, Wv, 0, 1);               // 地覆
    v.walls(0, yv + rh, 0, Wv, 1, Wv, 0, 1);              // 架木（扶手）
    const np = Math.max(3, Math.round(Wv / 3));
    rowOf(v, np, (Wv - 1) / (np - 1), (vv, p) => {        // 欄杆柱
      const q = rs(p);
      vv.box(q, yv + 2, -hv, 1, rh - 2, 1, 0); vv.box(q, yv + 2, hv, 1, rh - 2, 1, 0);
      vv.box(-hv, yv + 2, q, 1, rh - 2, 1, 0); vv.box(hv, yv + 2, q, 1, rh - 2, 1, 0);
    }, 0);

    const wk = dim(s, 0.6, 3, true), a = (wk - 1) / 2;    // 花頭窗身寬（奇數）
    const hk = dim(s, 0.5, 2);                            // 花頭窗直身高
    const wRows = hk + 2 + a, wb = rh - 1;                // 窗總高、窗底在牆的第幾層（高欄扶手那一層）
    const H2 = Math.max(wb + wRows + 1, dim(s, 1.2, 5));
    const e2 = dim(s, 0.85, 3), j2 = jc(e2), hA = j2 + 2;
    const y2 = yv + 1, y2r = y2 + H2;                     // 二樓牆底、上層簷口
    v.walls(0, y2, 0, W2, H2 + j2 + 1, W2, 2, 1);         // 黑漆牆（往上伸進屋頂）

    const cw = rs((W2 - 1) / 3);                          // 三間：兩側那兩間的中心
    const paint = (u, y, at, ax, c) => (ax === 'x' ? tint(v, u, y, at, c) : tint(v, at, y, u, c));
    const kato = (u0, at, ax) => {                        // 花頭窗：直身 → 窗耳外張一格 → 往上收成火焰尖
      for (let r = 0; r < wRows; r++) {
        const hf = r < hk ? a : r === hk ? a + 1 : a - (r - hk - 1);
        for (let i = -hf; i <= hf; i++) paint(u0 + i, y2 + wb + r, at, ax, 9);
      }
    };
    const panel = (at, ax) => {                           // 中間那一間：正背面是板壁、側面是桟唐戶
      for (let r = 0; r <= wb + hk; r++) for (let i = -a; i <= a; i++) paint(i, y2 + r, at, ax, 8);
    };
    for (const sg of [-1, 1]) for (const ax of ['x', 'z']) {
      kato(-cw, sg * h2, ax); kato(cw, sg * h2, ax); panel(sg * h2, ax);
    }

    // ── 上層屋頂：寶形造，下緩上陡
    const Wu = W2 + 2 * e2, Eu = (Wu - 1) / 2, WA = Wu - 2 * K * (hA - 1);
    const roof2 = (x, y, z) => ((y === y2r || Math.abs(x) === Math.abs(z)) ? 8 : 3);   // 簷口與四條隅棟深一階
    boxTaper(v, { x: 0, y: y2r, z: 0, w: Wu, d: Wu, w1: WA, d1: WA, h: hA, t: T, c: roof2 });
    const wB = WA - 2, hB = Math.max(2, (wB - 5) / 2 + 1);
    boxTaper(v, { x: 0, y: y2r + hA, z: 0, w: wB, d: wB, w1: Math.min(5, wB), d1: Math.min(5, wB),
                  h: hB, t: 2, c: roof2 });
    upturn(Eu, Eu, y2r, dim(s, 0.6, 3), dim(s, 0.22, 1));
    const yTop = y2r + hA + hB - 1;

    // ── 露盤與鳳凰（頭朝正面 −z）
    v.box(0, yTop + 1, 0, 3, 1, 3, 4);
    const P = Math.max(1.6, s * 0.4), yb = yTop + 2;
    limb(v, { x: 0, y: yb, z: 0, x1: 0, y1: yb + 0.6 * P, z1: 0, r: 0.75, c: 4 });                       // 腳
    limb(v, { x: 0, y: yb + 0.8 * P, z: 0.5 * P, x1: 0, y1: yb + 1.0 * P, z1: -0.5 * P,
              r: Math.max(1, 0.42 * P), r1: Math.max(0.8, 0.34 * P), c: 4 });                              // 身
    limb(v, { x: 0, y: yb + 1.0 * P, z: -0.5 * P, x1: 0, y1: yb + 1.9 * P, z1: -0.9 * P,
              r: Math.max(0.75, 0.28 * P), r1: 0.75, c: 4 });                                              // 頸
    limb(v, { x: 0, y: yb + 1.9 * P, z: -0.9 * P, x1: 0, y1: yb + 1.75 * P, z1: -1.45 * P, r: 0.75, c: 4 }); // 頭與喙
    plate(v, { plane: 'zy', at: 0, t: 3, w: Math.max(1.2, 0.45 * P), c: 4,                                // 尾羽往後再往上捲
               pts: [[0.4 * P, yb + 0.85 * P], [1.3 * P, yb + 1.5 * P], [1.45 * P, yb + 2.4 * P], [0.9 * P, yb + 3.0 * P]] });
    mirrorX(v, 1, (vv, sg) => plate(vv, { plane: 'xy', at: 0, t: 1, w: Math.max(1.2, 0.45 * P), c: 4,    // 兩翼往上張
               pts: [[sg * 0.3 * P, yb + 1.0 * P], [sg * 1.2 * P, yb + 1.8 * P], [sg * 1.05 * P, yb + 2.6 * P]] }));

    // ── 前庭：銀沙灘（有砂紋的低平台）與向月台（平頂圓台）
    const Wg = dim(s, 5.0, 15), Dg = dim(s, 2.0, 6), hg = dim(s, 0.3, 2), gap = dim(s, 0.8, 3);
    const gxa = -(hw + 2), gxb = gxa + Wg - 1;
    const gzb = -(Ez + gap), gza = gzb - Dg + 1;
    const gx = (gxa + gxb) / 2, gz = (gza + gzb) / 2;
    v.walls(gx, 0, gz, Wg, hg - 1, Dg, 6, 1);
    v.box(gx, hg - 1, gz, Wg, 1, Dg, (x, y, z) => {       // 砂紋：沿 x 的波浪條紋，每 3 格一條
      const o = Math.round(Math.sin(x * 0.45) * 1.2);
      return ((z + o) % 3 + 3) % 3 === 0 ? 6 : 5;
    });
    const kb = Math.max(2.5, s * 1.2), kt = Math.max(1.8, s * 0.85), kh = dim(s, 0.9, 3);
    const kx = gxa - 2 - Math.round(kb), kz = Math.round(gz);
    v.taper(kx, 0, kz, kb, kt, kh, (x, y, z) => (y === 0 ? 6 : 5), 2);
    v.cyl(kx, kh - 1, kz, kt, 1, 5);                      // 平平的頂面
  }
});
