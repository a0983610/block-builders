/* 積木小人 · 匯出的藍圖（彰化扇形車庫）
   用法二選一：放進 blueprints/ 並把檔名加進 list.js，
   或在遊戲裡按「📥 匯入建築」把整份貼進去。 */

// 檔名：彰化扇形車庫.js
// v1.263.0：整座重畫成「前方轉車台＋後方 12 股扇形車庫」，放射狀部件改用 stampY，hi 放大到長得到一萬塊（見 開發筆記〈自訂藍圖調整一輪（v1.263.0）〉）
// 正面：前景是圓形轉車台坑（橋上停一輛火車頭）與朝 −z 伸出去的出入線，後面 12 個大門排成一道弧，低矮、橫寬
// 側面：前低後高——轉車台幾乎貼地，車庫是一長條平屋頂，屋頂上一排排氣窗與排煙筒凸出來
// 三樣識別物：扇形排開的 12 間車庫（每間一個朝轉車台的大門）、中央圓形轉車台與從它放射出去的軌道、停在庫裡與轉車台上的蒸汽火車頭
// 部件：台基＝碎石場地、轉車台坑（坑底＋坑底環軌＋坑壁圈）、門檻｜主量體＝車庫前牆、背牆、兩端山牆
//       開口＝12 個大門、背牆窗、端牆窗｜線腳＝勒腳、簷口、前排柱、背牆扶壁柱
//       屋頂＝平屋頂、每股一條排煙氣窗（百葉＋小山形頂）、排煙筒
//       附屬＝轉車台橋（鋼樑＋鋼軌＋護欄＋操作室）、放射鋼軌、出入線（鋼軌＋枕木）、車擋、門楣編號牌、
//             蒸汽火車頭（庫內 3 輛，其中 1 輛探出門外＋轉車台上 1 輛）
// 實物只確定「12 股、有轉車台、鋼筋混凝土」。門的形狀、門楣編號牌、排煙氣窗、柱、窗、扇形每股張多少度、
// 火車頭的樣子，都是照常見扇形車庫的樣子畫的，不是照實物細部。
customBlueprint({
  name: '彰化扇形車庫',
  pal: [
    '#b1aa9e', // 0 混凝土牆（淺灰，L 0.66）
    '#7d776c', // 1 深一階：勒腳、簷口、扶壁柱、氣窗頂、門檻、碎石裡偏灰的那些
    '#5c6062', // 2 屋頂
    '#8c8170', // 3 碎石場地（道碴）
    '#3d4145', // 4 鋼軌、轉車台鋼樑、窗洞、排煙百葉
    '#6b4b33', // 5 枕木、轉車台坑底（鐵鏽）
    '#212326', // 6 蒸汽火車頭（黑）、排煙筒
    '#b33a2c', // 7 火車頭的紅：動輪、排障器、煙室門牌
    '#d8b04a'  // 8 黃：頭燈、門楣編號牌、轉車台護欄與操作室、車擋
  ],
  lo: 4,
  hi: 16,

  gen(v, s) {
    const N = 12, STEP = 13;                          // 12 股；每股 13 度是擠得下門寬的角度，不是實測
    const tn = Math.tan(STEP / 2 * Math.PI / 180);
    const R1 = s * 2.2;                               // 轉車台中心到大門那一圈（不取整，塊數才連續）
    const rt = R1 * 0.38;                             // 轉車台坑半徑
    const zF = Math.round(R1), zB = Math.round(R1 * 1.5);    // 前牆（畫布上的 z）、背牆（半徑）
    const hsh = (x, y, z) => (((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) >>> 0) % 100;

    /* 門寬：12 個門＋12 根柱要擠在大門那一圈上（一股的弧長 A，3000 塊時約 4 格）。
       前牆在畫布上畫 [−HL, HR]，HL＋HR 剛好讓鄰股接上不留縫；
       門要離鄰股轉過來的那根柱至少一格，不然隔壁那一股會把門邊蓋掉。
       轉過去的格子仍會偏半格，有些尺寸會有一兩股的門被鄰股的柱吃掉一排（3000 塊那檔量過是 0 股）。 */
    const A = 2 * zF * tn;
    const K = Math.ceil(A - 1), HL = Math.floor(K / 2), HR = K - HL;
    let dl = Math.max(-HL + 1, Math.ceil(-(A - HR - 1)));
    let dr = Math.min(HR - 1, Math.floor(A - HL - 1));
    if (dr < dl) dl = dr = 0;
    const wd = dr - dl + 1, xc = (dl + dr) / 2, g = (dr - dl) / 2;   // 門寬、門中心、半軌距
    const ch = Math.max(1, Math.round(g * 0.6));      // 火車頭煙囪高
    const hd = wd + ch + 1;                           // 門高：剛好讓火車頭（wd+ch+1 層）進得去
    const H = hd + dim(s, 0.08, 1);                   // 牆高（門楣 1～2 層）
    const mw = dim(s, 0.12, 1, true), mh = dim(s, 0.1, 1);   // 排煙氣窗的寬、高
    const L = Math.max(4, zB - zF - 2);               // 庫裡的火車頭長

    /* 蒸汽火車頭：沿 +z 擺、車頭朝 −z（朝轉車台），寬跟門一樣，高 wd+ch+1 層（剛好進得了門）。
       zf 是排障器那一格、y0 是動輪那一層。門寬 5 以上才有餘裕做「比車架窄的鍋爐＋一顆顆紅動輪＋頭燈」，
       小的時候鍋爐跟車同寬、動輪只是車架兩側的紅格。 */
    const big = wd >= 5;
    const loco = (w, zf, y0, len) => {
      const cabL = Math.max(2, Math.round(len * 0.3)), zc = zf + len - cabL, zm = zf + len / 2;
      const top = y0 + wd, bw = big ? wd - 2 : wd, yb = top - bw + 1;   // 鍋爐頂、鍋爐寬、鍋爐底
      if (big) {
        w.box(xc, y0, zm, wd - 2, 3, len - 1, 6);                     // 車架
        for (let z = zf + 2; z <= zc - 2; z += 3)                     // 動輪（紅），左右各一排
          mirrorX(w, g, (ww, dx) => wheelX(ww, xc + dx, y0 + 1, z, 1, 1, 7));
        w.box(xc, y0, zf, wd, 2, 1, 7);                               // 排障器
      } else {
        w.box(xc, y0, zm, wd, 1, len - 1, 6);
        for (let z = zf + 1; z < zf + len; z++)
          if ((z - zf) % 3) { w.set(xc - g, y0, z, 7); w.set(xc + g, y0, z, 7); }
        w.box(xc, y0, zf, wd, 1, 1, 7);
      }
      w.box(xc, yb, (zf + zc) / 2, bw, bw, zc - zf - 1, 6);          // 鍋爐：方塊削掉四條稜
      if (bw >= 3) for (const [ex, ey] of [[-1, 0], [1, 0], [-1, 1], [1, 1]])
        w.carve(xc + ex * (bw - 1) / 2, yb + ey * (bw - 1), (zf + zc) / 2, 1, 1, zc - zf - 1);
      if (bw >= 3) tint(w, xc, yb + (bw - 1) / 2, zf + 1, 7);         // 煙室門牌
      if (big) w.set(xc, top + 1, zf + 1, 8);                         // 頭燈（坐在煙室上）
      const cw = big ? 2 - (wd % 2) : 1;                              // 煙囪寬（跟車身同奇偶才置中）
      w.box(xc, top + 1, zf + 1 + Math.max(1, Math.round(g)), cw, ch, 1, 6);   // 煙囪
      if (zc - zf > 5) w.box(xc, top + 1, zf + Math.round((zc - zf) * 0.6), cw, 1, big ? 2 : 1, 6);   // 汽包
      w.walls(xc, y0 + 1, zc + (cabL - 1) / 2, wd, wd + ch - 1, cabL, 6, 1);   // 駕駛室（中空）＋頂
      w.box(xc, top + ch, zc + (cabL - 1) / 2, wd, 1, cabL, 6);
    };

    // ── 台基：碎石場地（扇形蓋到大門）＋轉車台四周一圈＋出入線那一條
    const half = N / 2 * STEP * Math.PI / 180;        // 扇形半張角
    const Ra = zF - 0.5, n = Math.ceil(Ra) + 1;
    const ze = Math.floor(rt);                        // 轉車台橋的半長
    const zl0 = -ze - 1, zl1 = zl0 - Math.round(rt * 0.75) - 1;   // 出入線（朝 −z）
    for (let x = -n; x <= n; x++) for (let z = zl1; z <= n; z++) {
      const r = Math.hypot(x, z);
      const fan = r <= Ra && Math.abs(Math.atan2(x, z)) <= half + 0.03;
      const lead = z <= zl0 && Math.abs(x - xc) <= g + 2;
      if (fan || lead || r <= rt + 2.6) v.set(x, 0, z, hsh(x, 0, z) < 22 ? 1 : 3);
    }
    // 出入線：鋼軌＋枕木
    for (let z = zl1; z <= zl0; z++)
      for (let x = Math.round(xc - g - 1); x <= Math.round(xc + g + 1); x++) {
        const d = Math.abs(x - xc);
        if (Math.abs(d - g) < 0.01) v.set(x, 0, z, 4);
        else if (z % 2 === 0) v.set(x, 0, z, 5);
      }
    // 轉車台坑：坑底（鐵鏽）＋坑底環軌，外圈一道比場地高一格的坑壁
    const m = Math.ceil(rt) + 1;
    for (let x = -m; x <= m; x++) for (let z = -m; z <= m; z++) {
      const r = Math.hypot(x, z);
      if (r > rt + 0.35) continue;
      v.set(x, 0, z, Math.abs(r - (rt - 1)) < 0.5 ? 4 : (hsh(x, 0, z) < 25 ? 3 : 5));
    }
    v.cyl(0, 0, 0, rt + 1, 2, 0, 1);

    /* ── 一股車庫：照 0 度畫（畫布上沿 +z 往外），再轉到自己的角度。
       每股各一份的東西才放這裡（大門與柱、排煙氣窗、排煙筒、軌道、火車頭）；
       連成一整片的屋頂、背牆、兩端山牆在後面整片一次鋪——stampY 每轉一格約 0.5µs，
       全放進來的話 9000 塊那檔掃一輪尺寸要 260ms 以上。 */
    const LOCO_AT = { 2: zF + 1, 7: zF - Math.round(L * 0.4), 9: zF + 1 };   // 第 7 股那輛探出門外
    const bay = (w, i) => {
      const k = i * 101;
      // 前牆＋大門＋門楣編號牌；前排柱凸出一格（每股畫自己左邊那根，最外側那股兩根都畫）
      for (let y = 0; y < H; y++)
        for (let x = -HL; x <= HR; x++) w.set(x, y, zF, y === 0 || hsh(x + k, y, zF) < 12 ? 1 : 0);
      w.carve(xc, 0, zF, wd, hd, 1);
      tint(w, xc, hd, zF, 8);
      for (let y = 0; y < H; y++) {
        w.set(-HL, y, zF - 1, y === 0 ? 1 : 0);
        if (i === 0) w.set(HR, y, zF - 1, y === 0 ? 1 : 0);
      }
      // 排煙氣窗：沿這一股屋頂中線一條深色百葉，上面蓋淺一階的頂（寬的話做成小山形）；前端一支排煙筒
      const mz0 = zF + 3, mz1 = zB - 2;
      if (mz1 >= mz0) {
        w.box(0, H + 1, (mz0 + mz1) / 2, Math.max(1, mw - 2), mh, mz1 - mz0 + 1, 4);
        w.gable(0, H + 1 + mh, (mz0 + mz1) / 2, mw, mz1 - mz0 + 1, 1);
      }
      w.box(0, H + 1, zF + 1, 1, mh + 2, 1, 6);
      // 軌道（y=0）：兩條鋼軌從轉車台坑邊一路進到庫裡，門檻那一格補上；盡頭一個車擋
      for (let z = Math.ceil(rt + 1.4); z < zB; z++) {
        if (z === zF) for (let x = dl; x <= dr; x++) w.set(x, 0, z, 1);
        w.set(xc - g, 0, z, 4); w.set(xc + g, 0, z, 4);
      }
      w.box(xc, 0, zB - 1, wd, wd >= 3 ? 2 : 1, 1, 8);
      if (LOCO_AT[i] !== undefined) loco(w, LOCO_AT[i], 0, L);
    };
    for (let i = 0; i < N; i++) stampY(v, (i - (N - 1) / 2) * STEP, w => bay(w, i));

    /* ── 車庫外殼：平屋頂＋簷口、背牆（每股中間開窗）、背牆外的扶壁柱、兩端山牆（開窗）。
       這幾樣是連成一整片的面，跟碎石場地一樣逐格判半徑 r 與角度 th 一次鋪，
       一片連續的屋頂與背牆也就沒有股與股的接縫。 */
    const a = STEP * Math.PI / 180, hbw = zB * tn;    // 一股的張角、背牆處一股的半寬
    const wallC = (x, y, z) => y === 0 || hsh(x, y, z) < 12 ? 1 : 0;
    for (let x = -zB - 2; x <= zB + 2; x++) for (let z = 0; z <= zB + 2; z++) {
      const r = Math.hypot(x, z);
      if (r < zF - 1.5 || r >= zB + 1.6) continue;
      const th = Math.atan2(x, z), out = (Math.abs(th) - half) * r;   // out：離扇形外緣幾格（外正內負）
      if (out > 0.6) continue;
      if (r <= zB + 0.5) v.set(x, H, z, r < zF - 0.5 ? 1 : (hsh(x, H, z) < 10 ? 4 : 2));
      if (r >= zB - 0.6 && r < zB + 0.6) {                        // 背牆，窗開在每一股中間
        const kk = Math.min(N - 1, Math.max(0, Math.round(th / a + (N - 1) / 2)));
        const u = Math.abs(th - (kk - (N - 1) / 2) * a) * r;
        for (let y = 0; y < H; y++) v.set(x, y, z, y >= 2 && y < H - 1 && u <= hbw - 1.5 ? 4 : wallC(x, y, z));
      } else if (r >= zB + 0.6) {                                 // 扶壁柱：背牆外一格、落在股界上
        const j = Math.round(th / a + N / 2);
        if (Math.abs(th - (j - N / 2) * a) * r < 0.55) for (let y = 0; y < H; y++) v.set(x, y, z, 1);
      } else if (r >= zF && Math.abs(out) < 0.55) {               // 兩端山牆
        const win = r > zF + 1.5 && r < zB - 1.5 && Math.round(r) % 3 === 0;
        for (let y = 0; y < H; y++) v.set(x, y, z, win && y >= 2 && y < H - 1 ? 4 : wallC(x, y, z));
      }
    }

    // ── 轉車台橋：鋼樑坐在坑底、橋面與坑壁齊高，兩端黃色護欄柱，後端掛一間操作室；
    //    橋對準出入線（沿 z），橋上停一輛火車頭，車頭朝正面
    const Lt = Math.min(L, 2 * ze - 1);
    v.box(xc, 0, 0, wd + 2, 1, 2 * ze + 1, 4);
    for (let z = -ze; z <= ze; z++) {
      const c = Math.abs(z) === ze ? 8 : 4;
      v.set(xc - g - 1, 1, z, c); v.set(xc + g + 1, 1, z, c);
      v.set(xc - g, 1, z, 4); v.set(xc + g, 1, z, 4);
    }
    const bk = big ? 2 : 1;                           // 操作室寬
    v.box(xc + g + 1 + (bk + 1) / 2, 1, ze - 1.5, bk, bk + 1, 2, 8);
    loco(v, -Math.floor(Lt / 2), 1, Lt);
  }
});
