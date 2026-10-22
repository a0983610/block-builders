// 檔名：淡水紅毛城.js
// v1.319.0 盲測第十一回：子 agent 只拿〈藍圖製作說明〉、從零做出來的第二版（看過一次報告＋9000 四視圖），原樣收進來（只改了 name 與檔名那一行；見 開發筆記〈盲測第十一回：新增倫敦塔橋、泰國鄭王廟、新加坡濱海灣金沙、淡水紅毛城、達摩不倒翁（v1.319.0）〉）
// 【設計表】（v2）
// 正面：左邊是方正的紅色主堡（頂上一圈一格一格的城垛，左前角挑出一座小角樓，堡前露台排四門古砲）；
//       右邊稍退後是兩層紅磚洋樓，正面上下兩排拱廊，中間一條淺色腰線，頂上一片四坡紅瓦屋頂，屋前一片草地。
// 側面（從西側 +x 看）：主堡的方塊＋城垛擋在前面，前角掛著角樓，後面露出洋樓的屋脊。
// 三樣識別物：①紅色方堡頂上一格一格的城垛 ②洋樓一二樓整排拱廊 ③四坡斜屋頂＋屋前草地
// 比例表（實物）：
//   主堡：正方形邊長 15.25 m、高約 13 m（內部兩層）、牆厚約 2 m、外牆朱紅；
//         東北、西南兩角各一座角樓，下面五根石樑托著；南側露台前四尊古砲。
//   官邸：在主堡東側，坐北朝南，兩層紅磚洋樓，台基約 1 m；南側迴廊寬約 3 m、東西兩側約 5 m；
//         一樓弧形拱、二樓半圓拱；四坡斜屋頂（紅瓦）。面寬、進深查不到，估面寬約 24 m、進深約 15 m。
//   換算：1 m ≈ s × 0.1 格（s ≈ 14 時約 1.4 格／m）
// 座標：正面 −z 朝南；+x 是模型右手 ＝ 西 → 主堡放 +x、官邸放 −x（站在正面看：主堡在左、官邸在右）
// 輪廓寬度（正面，9000 塊 s ≈ 14，由下往上）：
//   y=0   草地＋露台一整條 ≈ 66
//   y=5   官邸 33 ＋ 空隙 5 ＋ 主堡 21（底座 23）
//   y=14  官邸簷口 35 ＋ 主堡 21
//   y=17  官邸屋頂中段 ≈ 23 ＋ 主堡城垛 23（每 3 格一個 1 格寬、3 層深的缺口；角樓再凸 2 格）
//   y=20  官邸屋脊 15 ＋ 角樓 5
// 部件尺寸（9000 塊 s = 14，報告實測）：
//   主堡邊長 dim(s,1.52,7,奇)=21、牆高 dim(s,1.15,6)=16、城垛高 dim(s,0.18,2)=3、缺口 1 格每 3 格一個（每邊 7 個）
//   角樓 dim(s,0.3,3,奇)=5 格見方、比城垛高 1 層；下面深紅階梯托座（5→3→1）＋五根淺色石樑頭
//   大門 dim(s,0.2,3,奇)=3 寬、開口 5 層；窗 1×3
//   官邸：拱寬 dim(s,0.33,3,奇)=5、柱 dim(s,0.09,1)=1、角柱 2；正面 5 個拱 × 2 層、兩側各 3 個 × 2 層
//         面寬 33、進深 21、台基 dim(s,0.12,1)=2、每層 dim(s,0.42,4)=6
//         一樓弧形拱 5 層（5,5,5,5,3）、二樓半圓拱 4 層（5,5,3,1）
//         屋頂每層每邊收 2 格（約 27°）共 6 層；煙囪 2×2 只高出屋脊 1 層
//   古砲：砲管半徑 max(0.75, 0.06s)=0.84、長 dim(s,0.3,3)=4；草地深 dim(s,0.55,3)=8
// 部件：
//   台基：主堡底座線腳(walls)、堡前露台(box)、古砲×4(tubeZ＋box)、官邸台基(box＋carve)、台階(box)、草地(box)、步道(box)
//   主量體：主堡牆(walls t2)、官邸外圈拱廊牆(walls)、官邸室內核心(walls，深色＝迴廊陰影)、二樓迴廊樓板(box)
//   開口：主堡大門(arch＋木門 box)、主堡窗(windowGrid)、角樓窗(box)、官邸拱廊(自寫 cut：一樓弧形、二樓半圓)
//   線腳分層：主堡簷口深紅帶(walls)、官邸腰線(顏色函式)、官邸簷口(walls)
//   屋頂：主堡屋頂平台(box)、官邸四坡頂(boxTaper 中空)、煙囪×2(box)
//   頂飾與附屬：城垛(walls＋carve)、角樓×2(walls＋box)、角樓雉堞(carve)、角樓托座(box 階梯)、石樑頭(box)
customBlueprint({
  name: '淡水紅毛城',
  pal: ['#b33a2c',   // 0 主堡朱紅外牆
        '#5f201b',   // 1 主堡深紅（底座、簷口帶、角樓托座）
        '#a65a3f',   // 2 紅磚
        '#8a4630',   // 3 紅磚暗一階（雜色）
        '#c4bdb0',   // 4 花崗石（台基、腰線、簷口、門框、石樑、台階）
        '#6a3b31',   // 5 紅瓦
        '#2b2321',   // 6 陰影（迴廊裡面、窗）
        '#679a3e',   // 7 草地
        '#9d9486',   // 8 露台、步道鋪面
        '#262628',   // 9 古砲鐵
        '#a39b92',   // 10 主堡屋頂平台
        '#5b3b25',   // 11 木（大門、砲架）
        '#552e28',   // 12 紅瓦暗一階
        '#55843a'],  // 13 草地暗一階
  lo: 2, hi: 24,

  gen(v, s) {
    // 用「兩端的格子」畫，偶數寬也不會偏半格
    const B = (x0, x1, y, h, z0, z1, c) =>
      v.box((x0 + x1) / 2, y, (z0 + z1) / 2, x1 - x0 + 1, h, z1 - z0 + 1, c);
    const C = (x0, x1, y, h, z0, z1) =>
      v.carve((x0 + x1) / 2, y, (z0 + z1) / 2, x1 - x0 + 1, h, z1 - z0 + 1);
    const W = (x0, x1, y, h, z0, z1, c, t) =>
      v.walls((x0 + x1) / 2, y, (z0 + z1) / 2, x1 - x0 + 1, h, z1 - z0 + 1, c, t);

    // ===================== 主堡（+x 側，西）=====================
    const FW = dim(s, 1.52, 7, true), hf = (FW - 1) / 2;
    const FH = dim(s, 1.15, 6), mh = dim(s, 0.18, 2), bh = dim(s, 0.12, 2);
    const FX = hf + 1;
    const fx0 = FX - hf, fx1 = FX + hf, fz0 = -hf, fz1 = hf;
    const TD = dim(s, 0.45, 3);
    const lawnF = fz0 - 1 - TD;                                   // 露台與草地的前緣

    W(fx0 - 1, fx1 + 1, 0, bh, fz0 - 1, fz1 + 1, 1, 1);          // 底座線腳（深紅，凸 1 格）
    W(fx0, fx1, 0, FH, fz0, fz1, 0, 2);                           // 主堡牆（中空，牆厚 2）
    B(fx0 + 1, fx1 - 1, FH - 1, 1, fz0 + 1, fz1 - 1, 10);         // 屋頂平台
    W(fx0 - 1, fx1 + 1, FH - 1, 1, fz0 - 1, fz1 + 1, 1, 2);       // 簷口深紅帶（凸 1 格）
    W(fx0 - 1, fx1 + 1, FH, 1 + mh, fz0 - 1, fz1 + 1, 0, 2);      // 女兒牆＋城垛

    // 城垛缺口：每邊以中心為準，每 P 格挖一個
    const P = dim(s, 0.2, 3), hc = Math.floor(P / 6), K = Math.floor((hf - 1 - hc) / P);
    for (let k = -K; k <= K; k++) {
      const o = k * P;
      C(FX + o - hc, FX + o + hc, FH + 1, mh, fz0 - 1, fz0);      // 前
      C(FX + o - hc, FX + o + hc, FH + 1, mh, fz1, fz1 + 1);      // 後
      C(fx0 - 1, fx0, FH + 1, mh, o - hc, o + hc);                // 東
      C(fx1, fx1 + 1, FH + 1, mh, o - hc, o + hc);                // 西
    }

    // 角樓：挑在牆角外，下面一座往下收的深紅托座＋五根淺色石樑頭；比城垛高一層，頂上自己一圈雉堞
    const TW = dim(s, 0.3, 3, true), ht = (TW - 1) / 2;
    const tY0 = FH - 1 - dim(s, 0.3, 3), tTop = FH + mh + 1, sl = dim(s, 0.15, 2);
    const turret = (tx, tz, sx, sz) => {
      W(tx - ht, tx + ht, tY0, tTop - tY0 + 1, tz - ht, tz + ht, (x, y, z) => (y === FH - 1 ? 1 : 0), 1);
      B(tx - ht + 1, tx + ht - 1, tTop - 1, 1, tz - ht + 1, tz + ht - 1, 10);
      for (let o = 1; o < ht; o += 2) for (const g of [-o, o]) {
        C(tx + g, tx + g, tTop, 1, tz - ht, tz - ht);
        C(tx + g, tx + g, tTop, 1, tz + ht, tz + ht);
        C(tx - ht, tx - ht, tTop, 1, tz + g, tz + g);
        C(tx + ht, tx + ht, tTop, 1, tz + g, tz + g);
      }
      B(tx, tx, tY0 + 1, sl, tz + sz * ht, tz + sz * ht, 6);      // 朝外兩面各一道窄窗
      B(tx + sx * ht, tx + sx * ht, tY0 + 1, sl, tz, tz, 6);
      for (let i = 1; ht - i >= 0; i++)                           // 托座：一層收一圈
        B(tx - ht + i, tx + ht - i, tY0 - i, 1, tz - ht + i, tz + ht - i, 1);
      for (const [cx, cz] of [[tx - sx * ht, tz + sz * ht], [tx, tz + sz * ht], [tx + sx * ht, tz + sz * ht],
                              [tx + sx * ht, tz], [tx + sx * ht, tz - sz * ht]])
        B(cx, cx, tY0 - 1, 1, cz, cz, 4);                         // 五根石樑頭，貼著托座
    };
    turret(fx1 + 1, fz0 - 1, 1, -1);                              // 西南角（正面看在左上）
    turret(fx0 - 1, fz1 + 1, -1, 1);                              // 東北角

    // 大門：花崗石框＋拱洞，後面一片木門
    const dw = dim(s, 0.2, 3, true), dr = (dw - 1) / 2, dh = dim(s, 0.2, 2);
    arch(v, FX, 1, fz0, dw, dh, 1, 4);
    B(FX - dr, FX + dr, 1, dh + dr + 1, fz0 + 1, fz0 + 1, 11);
    C(FX - dr, FX + dr, 1, bh - 1, fz0 - 1, fz0 - 1);              // 門前的底座切開

    // 窗：一樓門兩側各一、二樓三扇；側面與背面兩排各三扇
    const wq = Math.min(dim(s, 0.36, 3), hf - 2), wh = dim(s, 0.2, 2), ww = dim(s, 0.05, 1, true);
    const wy1 = 1 + dim(s, 0.22, 2), wy2 = Math.max(wy1 + wh + 1, Math.round(FH * 0.58));
    const upper = wy2 + wh <= FH - 1, rows = upper ? 2 : 1;
    const win = (o) => windowGrid(v, Object.assign({ w: ww, h: wh, c: 6 }, o));
    if (wq > dr + 2) win({ x: FX, y: wy1, z: fz0, cols: 2, stepX: 2 * wq });
    if (upper) win({ x: FX, y: wy2, z: fz0, cols: 3, stepX: wq });
    win({ x: FX, y: wy1, z: fz1, cols: 3, stepX: wq, rows, stepY: wy2 - wy1 });
    win({ x: fx0, y: wy1, z: 0, cols: 3, stepX: wq, rows, stepY: wy2 - wy1, axis: 'z' });
    win({ x: fx1, y: wy1, z: 0, cols: 3, stepX: wq, rows, stepY: wy2 - wy1, axis: 'z' });

    // 堡前露台與四門古砲（砲口朝南 −z）
    B(fx0 - 1, fx1 + 1, 0, 1, lawnF, fz0 - 2, 8);
    const cr = Math.max(0.75, s * 0.06), cl = dim(s, 0.3, 3);
    const ca = Math.round(FW * 0.2), cb = Math.round(FW * 0.4);
    for (const o of [-cb, -ca, ca, cb]) {
      const x = FX + o, z0 = lawnF + 1;
      B(x - 1, x + 1, 1, 1, z0 + 1, z0 + cl - 1, 11);             // 砲架
      tubeZ(v, x, 2, z0, cr, cl, 9);                              // 砲管
    }

    // ===================== 英國領事官邸（−x 側，東）=====================
    // 拱廊照「角柱＋n 個拱＋中間細柱」排，面寬由拱數算回來，左右一定對稱
    const aw = dim(s, 0.33, 3, true), ra = (aw - 1) / 2, pw = dim(s, 0.09, 1), cpm = pw + 1;
    const fit = (len, nMin) => {
      const n = Math.max(nMin, Math.floor((len - 2 * cpm + pw) / (aw + pw)));
      const cp = cpm + Math.max(0, Math.floor((len - 2 * cpm - n * aw - (n - 1) * pw) / 2));
      return [n, cp, 2 * cp + n * aw + (n - 1) * pw];
    };
    const [nF, cpF, RW] = fit(s * 2.45, 3);
    const [nS, cpS, RD] = fit(s * 1.55, 2);
    const G = dim(s, 0.4, 3), LD = dim(s, 0.55, 3);
    const xb = -G - 1, xa = xb - RW + 1;                          // 外圈拱廊牆的 x 範圍
    const zA = lawnF + LD + 1, zB = zA + RD - 1;                   // 正面拱廊牆 z、背牆 z
    const PH = dim(s, 0.12, 1), FL = dim(s, 0.42, 4), y2 = PH + FL, WT = PH + 2 * FL;
    const VS = dim(s, 0.29, 2), VE = dim(s, 0.42, 2);             // 南側迴廊深、東西側迴廊深
    const brick = (x, y, z) => (y === y2 - 1 ? 4 : hash100(x, y, z) < 25 ? 3 : 2);

    B(xa - 1, fx0 - 2, 0, 1, lawnF, zA - 2, (x, y, z) => (hash100(x, y, z) < 15 ? 13 : 7));  // 草地
    B(xa - 1, xb + 1, 0, PH, zA - 1, zB + 1, 4);                  // 台基
    C(xa + VE + 2, xb - VE - 2, 0, PH, zA + VS + 2, zB - 1);      // 台基中間看不到，挖空
    W(xa + VE + 1, xb - VE - 1, PH, 2 * FL, zA + VS + 1, zB, 6, 1);   // 室內核心（從拱洞看進去是陰影）
    W(xa, xb, PH, 2 * FL, zA, zB, brick, 1);                      // 外圈拱廊牆（含腰線）
    B(xa + 1, xb - 1, y2 - 1, 1, zA + 1, zA + VS, 6);             // 二樓迴廊樓板
    B(xa + 1, xa + VE, y2 - 1, 1, zA + VS + 1, zB - 1, 6);
    B(xb - VE, xb - 1, y2 - 1, 1, zA + VS + 1, zB - 1, 6);

    // 拱洞：alongX = 正面（洞沿 x 排、牆在 z = q），否則側面（洞沿 z 排、牆在 x = q）
    // 頂上一層收 2 格：一樓只收一層（弧形拱），二樓一路收到 1 格（半圓拱）
    const cut = (alongX, q, c0, y, hs, seg) => {
      const one = (a0, a1, yy, hh) => (alongX ? C(a0, a1, yy, hh, q, q) : C(q, q, yy, hh, a0, a1));
      one(c0 - ra, c0 + ra, y, hs);
      for (let j = 1; j <= (seg ? 1 : ra); j++) one(c0 - ra + j, c0 + ra - j, y + hs + j - 1, 1);
    };
    const hs1 = FL - 2, yU = y2 + 1, hs2 = Math.max(1, FL - 2 - ra);
    for (let i = 0; i < nF; i++) {
      const c0 = xa + cpF + ra + i * (aw + pw);
      cut(true, zA, c0, PH, hs1, true);
      cut(true, zA, c0, yU, hs2, false);
    }
    for (let j = 0; j < nS; j++) {
      const c0 = zA + cpS + ra + j * (aw + pw);
      for (const q of [xa, xb]) { cut(false, q, c0, PH, hs1, true); cut(false, q, c0, yU, hs2, false); }
    }

    // 簷口、四坡屋頂（中空，每層每邊收 2 格）、煙囪
    W(xa - 1, xb + 1, WT, 1, zA - 1, zB + 1, 4, 2);
    const hR = Math.floor((RD + 1) / 4) + 1;
    boxTaper(v, { x: (xa + xb) / 2, y: WT + 1, z: (zA + zB) / 2,
                  w: RW + 2, d: RD + 2, w1: RW + 2 - 4 * (hR - 1), d1: RD + 2 - 4 * (hR - 1), h: hR, t: 3,
                  c: (x, y, z) => (hash100(x, y, z) < 18 ? 12 : 5) });
    const cs = dim(s, 0.13, 2), chTop = WT + hR + 1;
    const cxo = Math.round(RW * 0.27), czc = zA + Math.round(RD * 0.6);
    const chim = (x0) => B(x0, x0 + cs - 1, WT + 1, chTop - WT, czc, czc + cs - 1,
                           (x, y, z) => (y === chTop ? 4 : hash100(x, y, z) < 25 ? 3 : 2));
    chim(xa + cxo);
    chim(xb - cxo - cs + 1);

    // 正中台階與步道
    const SW = nF % 2 ? aw + 2 : 2 * aw + pw;
    const sx0 = xa + (RW - SW) / 2, sx1 = sx0 + SW - 1;
    for (let k = 1; k <= PH; k++) B(sx0, sx1, 0, k, zA - 2 - PH + k, zA - 2 - PH + k, 4);
    if (zA - 2 - PH >= lawnF) B(sx0 + 1, sx1 - 1, 0, 1, lawnF, zA - 2 - PH, 8);
  }
});
