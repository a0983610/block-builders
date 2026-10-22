// 檔名：法國聖米歇爾山.js
// v1.318.0 盲測第十回：子 agent 只拿〈藍圖製作說明〉、從零做出來的第二版（看過一次報告＋9000 四視圖），原樣收進來（只改了 name 與檔名那一行；見 開發筆記〈盲測第十回：新增艋舺龍山寺、白川鄉合掌屋、法國聖米歇爾山、杜拜帆船飯店、大同電鍋（v1.318.0）〉）
// 【三句話】
// 正面（南面，−z）：灘地上一段有塔樓的矮城牆，牆後石頭房子一層層往上疊成三角形的山，山頂是兩段往上收、有扶壁的修道院，最上面是教堂，鐘塔上拔起一根細長尖塔，塔頂是金色天使。
// 側面（西面，+x）：三角形；北邊（畫面左邊）奇蹟樓的高牆貼著修道院直落到長樹的北坡，南邊（畫面右邊）是城牆和房子。
// 三樣識別物：①細長的哥德式尖塔加塔頂的金色大天使 ②山頂方正高聳、有扶壁和長窗的修道院 ③山腳有塔樓的城牆，牆後層層疊疊的灰石板屋頂
// 【比例表（實物）】島周長約 960 m（直徑約 300 m，含外圍灘地），岩石最高 92 m，教堂地坪約 80 m；
//   塔頂天使像離海約 155～170 m，像高 4.5 m（鍍金銅像，1897，Frémiet）；城牆約 12 m 高，塔樓 16～20 m
//   換算：k ≈ 每 10 m 幾格。城牆圈半徑 11k（取 220 m：島壓縮、主角放大）；岩頂平台 4.3k
//   修道院下段 3.2k～6.8k，上段到 9k（教堂地坪），屋脊 ~12.6k，鐘塔頂 ~14k，尖塔頂 ~19k
//   天使像 ~2.5k 高（實物只有 0.45k，放大約五倍）
// 【輪廓寬度（正面，以整座寬 ≈ 2×11k＋灘地 ＝ 1.00）】
//   城牆 y 0～1.2k：1.00 ／ 下層房子 y≈1.8k：0.72 ／ 上層房子 y≈3.6k：0.47 ／ 修道院下段 0.40 ／ 上段 0.32
//   教堂（含後殿）0.30 ／ 鐘塔 0.09 ／ 尖塔 0.09 收到 1 格 ／ 天使 0.09
// 【部件尺寸（9000 塊估 s ≈ 2.2；第一版實測 s=2.28，這一版島縮、修道院加大，估計差不多）】
//   城牆圈半徑 24、牆高 3；塔樓 5 格寬、高 5～7；房子 3 寬 × 2 深 × 2～4 高，加 2 層屋頂
//   修道院下段 21×8×17、上段 17×5×11（寬×高×深）；奇蹟樓 12 寬 × 7 深、到教堂地坪
//   教堂長 14、寬 5、牆高 4；鐘塔 5×5、高出屋脊 3；尖塔 11 高（5 格寬收到 1）
//   天使像 5 寬 × 6 高（肩 3 格、翅尖 ±2 到頭的高度、劍高出頭 2 格）
// 【部件】灘地(cyl 環) 城牆(ringOf 排 box 成一段弧) 城垛(ringOf+box) 7 座塔樓(ringOf+cyl+taper) 城門樓(box+arch+gable)
//   岩山(revolve 中空殼，顏色函式撒雜色、北坡綠) 岩頂平台(cyl 環) 房子 4 排(ringOf+box+gable，窗 tint)
//   修道院下段／上段(walls＋深色屋面帶) 扶壁(box) 長窗(windowGrid) 小堡門雙圓塔(cyl+taper)
//   奇蹟樓(walls+boxTaper 屋頂+rowOf 扶壁)
//   教堂中殿(walls+boxTaper 屋頂) 袖廊(walls+gable) 半圓後殿(cyl+taper) 飛扶壁(box) 長窗(windowGrid/tint)
//   鐘塔(walls+塔頂深色帶 box+corners4 小尖塔) 尖塔(taper) 金色大天使(box 疊)
customBlueprint({
  name: '法國聖米歇爾山',
  pal: ['#74695a',   // 0 岩石
        '#5c5347',   // 1 岩石暗面
        '#4f6338',   // 2 北坡、西坡樹林
        '#a0978a',   // 3 城牆、塔樓花崗岩
        '#b5aa93',   // 4 房子石牆（亮）
        '#3f444c',   // 5 石板瓦屋頂
        '#aaa08f',   // 6 修道院花崗岩
        '#7d756a',   // 7 深一階：塔簷、平台、扶壁
        '#2b2826',   // 8 窗、門洞
        '#e2b23e',   // 9 金色大天使
        '#4e5662',   // 10 教堂屋頂、尖塔（鉛灰）
        '#c9b98f',   // 11 灘地
        '#958a76',   // 12 房子石牆（暗）
        '#5a4030'],  // 13 木門
  lo: 0.7, hi: 4.5,

  gen(v, s) {
    const k = Math.max(s, 0.75);              // 整座一起縮，小於 0.75 就不再縮（比例不走樣）
    const R = Math.round(11 * k);             // 城牆圈外半徑

    // ── 顏色函式 ──
    const vegY = Math.round(3.2 * k);
    const rockC = (x, y, z) => {
      const h = hash100(x, y, z);
      const wood = y < vegY && ((z > R * 0.2 && x > -R * 0.6) || (x > R * 0.55 && z > -R * 0.25));
      if (wood) return h < 70 ? 2 : (h < 88 ? 1 : 0);
      return h < 30 ? 1 : 0;
    };
    const stoneC = (x, y, z) => (hash100(x, y, z) < 18 ? 7 : 3);
    const abbC = (x, y, z) => (hash100(x, y, z) < 12 ? 7 : 6);

    // ── 台基：灘地 ──
    v.cyl(0, 0, 0, R + 1.6, 1, 11, 2.6);

    // ── 城牆：只沿東、南那一段弧排（北塔 → 東 → 南 → 加百列塔），西北是直落的岩壁 ──
    const WH = dim(k, 1.2, 3);
    const A0 = -3.93, SPR = 3.63;
    ringOf(v, Math.ceil(R * SPR * 1.4), R - 0.5, (vv, x, z) => vv.box(x, 0, z, 2, WH, 2, stoneC), 0, 0, A0, SPR);

    // ── 岩山：中空的圓錐殼，靠城牆那段陡 ──
    const PR = [[10.7 * k, 0], [9.9 * k, 0.8 * k], [8.5 * k, 1.9 * k], [6.9 * k, 2.9 * k],
                [5.5 * k, 3.75 * k], [4.6 * k, 4.3 * k]];
    revolve(v, { x: 0, y: 0, z: 0, c: rockC, shell: 2, prof: PR });
    const capY = Math.round(4.3 * k);
    v.cyl(0, capY, 0, 4.6 * k, 1, rockC, 1.8 * k);           // 岩頂平台（中間被修道院蓋住，只畫外圈）
    const profY = r => {                                     // 半徑 r 處的地面高度
      if (r >= PR[0][0]) return 0;
      for (let i = 1; i < PR.length; i++) {
        const a = PR[i - 1], b = PR[i];
        if (r >= b[0]) return a[1] + (b[1] - a[1]) * (a[0] - r) / (a[0] - b[0]);
      }
      return PR[PR.length - 1][1];
    };

    // ── 村子：南坡、東坡 4 排房子，一排比一排高 ──
    const HW = dim(k, 1.2, 3, true), HD = dim(k, 0.9, 2), HH = dim(k, 1.0, 2);
    const AV0 = -3.65, SPV = 3.05;                           // 從東北偏東經東、南到西南
    [9.45, 8.1, 6.7, 5.4].forEach((t, ti) => {
      const r = t * k;
      const n = Math.max(3, Math.floor(r * SPV / (HW + 1)));
      const off = (ti % 2) * SPV / n / 2;                    // 隔排錯開半間
      ringOf(v, n, r, (vv, x, z, a) => {
        const hx = Math.round(x), hz = Math.round(z);
        const g = profY(r + HD / 2 + 0.5);
        const y0 = Math.max(0, Math.floor(g) - 1);
        const top = Math.round(g) + HH + (ti === 0 ? 1 : 0) + (hash100(hx, ti, hz) < 35 ? 1 : 0);
        vv.box(hx, y0, hz, HW, top - y0, HD, hash100(hz, ti + 7, hx) < 40 ? 12 : 4);
        vv.gable(hx, top, hz, HW, HD, 5);
        if (hash100(hx, hz, ti + 3) < 60) {                  // 朝外那一面開一扇窗
          const ca = Math.cos(a), sa = Math.sin(a);
          if (Math.abs(sa) >= Math.abs(ca))
            tint(vv, hx, top - 1, sa < 0 ? hz - Math.floor((HD - 1) / 2) : hz + Math.floor(HD / 2), 8);
          else tint(vv, ca < 0 ? hx - (HW - 1) / 2 : hx + (HW - 1) / 2, top - 1, hz, 8);
        }
      }, 0, 0, AV0 + off, SPV);
    });

    // ── 城垛、7 座塔樓、城門樓 ──
    ringOf(v, Math.round(R * SPR / 2), R - 0.5, (vv, x, z) => vv.box(x, WH, z, 1, 1, 1, 3), 0, 0, A0, SPR);
    const TR = Math.max(1.5, 0.8 * k), TH = dim(k, 2.4, 4);
    ringOf(v, 7, R - 1, (vv, x, z, a, i) => {
      const tx = Math.round(x), tz = Math.round(z);
      const h = TH + (i === 0 || i === 6 ? 2 : (i === 1 ? 1 : 0));
      vv.cyl(tx, 0, tz, TR, h, stoneC);
      vv.cyl(tx, h, tz, TR + 1, 1, 7);                        // 往外凸的塔簷
      if (i === 3 || i === 6) vv.taper(tx, h + 1, tz, TR + 1, 0.4, dim(k, 1.3, 3), 5);   // 尖帽
      else ringOf(vv, 8, TR + 0.6, (w, x2, z2) => w.box(x2, h + 1, z2, 1, 1, 1, 3), tx, tz);  // 城垛
    }, 0, 0, A0, SPR);
    const aG = -1.8, GW = dim(k, 0.5, 3, true), GH = dim(k, 0.5, 1);
    const gx = Math.round(R * Math.cos(aG)), gz = Math.round(R * Math.sin(aG)) - 1;
    v.box(gx, 0, gz, GW + 4, WH + 2, 3, stoneC);              // 城門樓
    v.gable(gx, WH + 2, gz, GW + 4, 3, 5);
    v.box(gx, 0, gz, GW, GH + (GW - 1) / 2 + 1, 1, 13);       // 門板（中間那層）
    arch(v, gx, 0, gz - 1, GW, GH, 1);                        // 前面那層挖拱形門洞

    // ── 修道院：兩段往上收 ──
    const az = Math.round(0.5 * k);
    const AW1 = dim(k, 9.4, 11, true), AD1 = dim(k, 7.4, 9, true), AH1 = dim(k, 3.6, 4);
    const AW2 = dim(k, 7.8, 9, true), AD2 = dim(k, 5.2, 7, true), AH2 = dim(k, 2.2, 3);
    const y1 = Math.round(3.2 * k), y2 = y1 + AH1, y3 = y2 + AH2;   // y3 ＝ 教堂地坪
    v.walls(0, y1, az, AW1, AH1, AD1, abbC, 2);
    v.walls(0, y2 - 1, az, AW1, 1, AD1, 5, Math.max(AW1 - AW2, AD1 - AD2) / 2 + 2);  // 下段頂一圈石板屋面
    v.walls(0, y2, az, AW2, AH2, AD2, abbC, 2);
    v.box(0, y3 - 1, az, AW2, 1, AD2, 7);                     // 上段頂：教堂前的平台
    const WWH = dim(k, 1.0, 2), wx1 = (AW1 - 1) / 2, f1 = az - (AD1 - 1) / 2;
    const cols4 = n => 2 * Math.max(0, Math.floor((n - 3) / 8)) + 1;
    const odd3 = n => 2 * Math.max(0, Math.floor((n - 3) / 6)) + 1;
    // 下段：長窗夾在扶壁之間（正面、西面）
    windowGrid(v, { x: 0, y: y2 - 2 - WWH, z: f1, cols: cols4(AW1), stepX: 4, w: 1, h: WWH, c: 8 });
    windowGrid(v, { x: wx1, y: y2 - 2 - WWH, z: az, cols: cols4(AD1), stepX: 4, w: 1, h: WWH, c: 8, axis: 'z' });
    for (let p = 2; p <= wx1 - 1; p += 4) mirrorX(v, p, (vv, dx) => vv.box(dx, y1, f1 - 1, 1, AH1 - 2, 1, 7));
    for (let p = 2; p <= (AD1 - 1) / 2 - 1; p += 4) mirrorZ(v, p, (vv, dz) => vv.box(wx1 + 1, y1, az + dz, 1, AH1 - 2, 1, 7));
    // 上段：一排小窗
    windowGrid(v, { x: 0, y: y2 + 1, z: az - (AD2 - 1) / 2, cols: odd3(AW2), stepX: 3, w: 1, h: WWH, c: 8 });
    windowGrid(v, { x: (AW2 - 1) / 2, y: y2 + 1, z: az, cols: odd3(AD2), stepX: 3, w: 1, h: WWH, c: 8, axis: 'z' });

    // 奇蹟樓（北面偏東）：貼著上段北面，從北坡疊到教堂地坪，上面一片石板屋頂
    const MD = dim(k, 3.0, 5, true), zN0 = az + (AD2 + 1) / 2, zN1 = zN0 + MD - 1;
    const xM0 = -wx1, xM1 = Math.round(0.6 * k), MW = xM1 - xM0 + 1;
    const yM = Math.round(2.2 * k), MT = y3 - 1, mzc = (zN0 + zN1) / 2, mxc = (xM0 + xM1) / 2;
    v.walls(mxc, yM, mzc, MW, MT - yM + 1, MD, abbC, 2);
    boxTaper(v, { x: mxc, y: MT + 1, z: mzc, w: MW, d: MD, w1: MW, d1: 1, h: (MD + 1) / 2, c: 10 });
    const nb = Math.max(3, Math.floor(MW / 3)), bst = Math.floor((MW - 1) / (nb - 1));
    rowOf(v, nb, bst, (vv, p) => vv.box(Math.round(p), yM, zN1 + 1, 1, MT - yM, 1, abbC), mxc);
    windowGrid(v, { x: xM1, y: MT - 2 - 2 * WWH, z: mzc, cols: odd3(MD), rows: 2, stepX: 3, stepY: WWH + 2,
                    w: 1, h: WWH, c: 8, axis: 'z' });

    // 小堡門（東面）：兩座小圓塔夾著門
    const xC = -wx1 - 1, rC = Math.max(1.2, 0.55 * k), dC = dim(k, 0.9, 2);
    mirrorZ(v, dC, (vv, dz) => {
      vv.cyl(xC, y1, az - 1 + dz, rC, AH1 + 1, abbC);
      vv.taper(xC, y1 + AH1 + 1, az - 1 + dz, rC + 0.6, 0.4, dim(k, 1.0, 2), 5);
    });
    for (let j = 1; j <= 2; j++) tint(v, -wx1, capY + j, az - 1, 8);

    // ── 教堂：十字形，祭壇在東（−x），西立面在 +x ──
    const W = dim(k, 1.8, 5, true), CH = dim(k, 2.0, 4), cz = az;
    const xE = -Math.max(4, Math.round(2.7 * k)), xW = Math.max(4, Math.round(3.2 * k));
    const L = xW - xE + 1, cx = (xE + xW) / 2;
    v.walls(cx, y3, cz, L, CH, W, abbC, 1);                                   // 中殿＋祭壇
    boxTaper(v, { x: cx, y: y3 + CH, z: cz, w: L, d: W + 2, w1: L, d1: 1, h: (W + 3) / 2, c: 10 });
    const TL = dim(k, 3.8, 9, true);
    v.walls(0, y3, cz, W, CH, TL, abbC, 1);                                   // 袖廊
    v.gable(0, y3 + CH, cz, W + 2, TL + 2, 10);
    v.cyl(xE, y3, cz, (W - 1) / 2, CH, abbC);                                 // 半圓後殿
    v.taper(xE, y3 + CH, cz, (W + 1) / 2, 0.5, (W + 1) / 2, 10);
    for (let x = -(W + 1) / 2 - 1; x >= xE; x -= 2)                           // 祭壇兩側的飛扶壁
      mirrorZ(v, 1, (vv, sg) => {
        const zp = cz + sg * ((W - 1) / 2 + 2);
        vv.box(x, y3, zp, 1, CH + 1, 1, abbC);
        vv.box(x, y3 + CH - 1, cz + sg * ((W + 1) / 2), 1, 1, 1, abbC);
        vv.box(x, y3 + CH + 1, zp, 1, 1, 1, 10);
      });
    windowGrid(v, { x: cx, y: y3 + 1, z: cz - (W - 1) / 2, cols: Math.max(2, Math.floor((L - 1) / 3)),
                    stepX: 3, w: 1, h: Math.max(1, CH - 2), c: 8 });
    for (let j = 1; j <= Math.max(1, CH - 2); j++) tint(v, 0, y3 + j, cz - (TL - 1) / 2, 8);   // 袖廊南面長窗
    for (let j = 0; j < 2; j++) tint(v, xW, y3 + j, cz, 8);                                    // 西立面的門

    // ── 鐘塔、尖塔：塔頂不外凸，尖塔從塔身全寬收成一根細針 ──
    const T = dim(k, 1.6, 5, true);
    const ridge = y3 + CH + (W + 3) / 2 - 1;
    const tTop = ridge + dim(k, 1.3, 3);
    v.walls(0, y3 + CH, cz, T, tTop - y3 - CH + 1, T, abbC, 1);
    const bh = dim(k, 0.8, 2);
    mirrorZ(v, (T - 1) / 2, (vv, dz) => windowGrid(vv, { x: 0, y: tTop - bh, z: cz + dz, cols: 2, stepX: 2, w: 1, h: bh, c: 8 }));
    mirrorX(v, (T - 1) / 2, (vv, dx) => windowGrid(vv, { x: dx, y: tTop - bh, z: cz, cols: 2, stepX: 2, w: 1, h: bh, c: 8, axis: 'z' }));
    v.box(0, tTop, cz, T, 1, T, 7);                                           // 塔頂一圈深色欄杆帶
    corners4(v, (T - 1) / 2, (T - 1) / 2, (vv, x, z) => vv.box(x, tTop + 1, cz + z, 1, dim(k, 0.9, 2), 1, 10));  // 四角小尖塔
    const SP = dim(k, 5.0, 10);
    v.taper(0, tTop + 1, cz, (T - 1) / 2 + 0.2, 0.4, SP, 10);                 // 細長尖塔

    // ── 金色大天使：張開翅膀、高舉著劍 ──
    const st0 = tTop + 1 + SP, SB = dim(k, 1.4, 3);
    v.box(0, st0, cz, 1, SB + 1, 1, 9);                                       // 身體＋頭
    v.box(0, st0 + SB - 1, cz, 3, 1, 1, 9);                                   // 肩膀
    v.box(0, st0 + SB + 1, cz, 1, dim(k, 0.9, 2), 1, 9);                      // 高舉的劍，比翅尖高
    mirrorX(v, 1, (vv, sg) => {
      vv.box(sg, st0 + SB - 2, cz + 1, 1, 2, 1, 9);                           // 翅膀（貼在背後）
      vv.box(2 * sg, st0 + SB - 1, cz + 1, 1, 2, 1, 9);                       // 翅尖往外上揚，到頭的高度
    });
  }
});
