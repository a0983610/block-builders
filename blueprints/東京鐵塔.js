// 檔名：東京鐵塔.js
// v1.315.0 盲測第九回：子 agent 只拿〈藍圖製作說明〉、從零做出來的第二版（看過一次報告＋9000 四視圖），原樣收進來（只改了 name 與檔名那一行；見 開發筆記〈盲測第九回：松前城天守、哆啦A夢重做，新增淺草寺雷門、首里城正殿、東京鐵塔、招財貓、柴犬（v1.315.0）〉）
// 正面：細長的方錐鋼骨格架塔，下段四隻腳往外張開、腳與腳之間一個扁拱；41% 高處一圈白色寬盒（大展望台）、
//       72% 高處一個小白盒（特別展望台），再往上收成細格架、最後一根天線桿
// 側面：跟正面一樣（斷面是正方形，四面同一套格架），底下 FootTown 比正面窄一點
// 三樣識別物：① 往外張開的四隻腳＋腳間大拱 ② 白色的大展望台（兩條深色窗帶） ③ 大展望台以上橘白相間七等分直到天線頂
// 比例表（實物）：全高 333 m；塔腳中心距 88 m；拱頂 40 m；中間步道 88 m；大展望台 138～158 m（兩層，145／150 m 樓面）；
//   特別展望台 243～253 m；253～288 m 細格架；288～333 m 天線桿；FootTown 五層樓（做 16 m 高、寬約腳距 0.6）
//   塗裝：大展望台以下國際橘、大展望台白、以上到塔頂七等分橘白相間（橘起橘止）
// 輪廓寬度（正面，腳中心距 88 m ＝ 1）：地面 1.00／40 m 拱頂 0.75／88 m 0.50／138 m 0.33（大展望台盒放大到 0.5）／
//   243 m 0.15（特別展望台盒 0.23）／288 m 0.07／塔頂 0.02
// 部件尺寸（第一版報告：9000 塊 s = 4.66）：全高 156 格；腳距 41 格；拱頂 19 格；大展望台寬 21（含簷 23）、牆高 7、
//   窗帶 2 條×2 格；特別展望台寬 9、牆高 4；色帶每條約 12 格；上段格架 16 格（寬 5→3）、天線桿 21 格；
//   腳粗 r 1.9→0.98；斜撐兩格粗；拱 r 1.4
// 部件：FootTown(walls＋box) 基礎(box·corners4) 四隻腳(每層一片 cyl 沿收分曲線挪) 上段角柱(limb)
//       交叉斜撐(兩條 v.line 並排，bar 輔助函式) 水平梁(walls 一格高的環) 腳間大拱(limb 串成半橢圓)
//       大展望台(walls＋box，窗帶用顏色函式) 特別展望台(同) 上段格架(taper 中空) 天線桿(taper) 七等分色帶(顏色函式)
customBlueprint({
  name: '東京鐵塔',
  pal: ['#e0491e',   // 0 國際橘：腳、角柱、水平梁、大拱
        '#c03c1b',   // 1 暗橘：斜撐（跟主構件分一階）
        '#e4e0d8',   // 2 白：白色帶的主構件、展望台外牆與屋頂
        '#c8c4bb',   // 3 白的陰影階：白色帶的斜撐、展望台樓板
        '#36414d',   // 4 展望窗、FootTown 窗
        '#d0ccc4',   // 5 FootTown 外牆
        '#8a8781'],  // 6 FootTown 屋頂、混凝土基礎
  lo: 0.8, hi: 7,

  gen(v, s) {
    // ── 高度：上面那件一律從下面那件的頂面往上算
    const yA0    = dim(s, 1.0, 1);              // 拱腳（拱從腳上這一層起拱，10 m）
    const yArch  = dim(s, 4.0, 4);              // 拱頂＝第一道大梁（40 m）
    const yMD0   = dim(s, 13.8, 14);            // 大展望台樓板（138 m）
    const mdWh   = dim(s, 1.5, 3);              // 大展望台外牆（兩層樓）
    const yMDtop = yMD0 + 2 + mdWh;             // 大展望台屋頂的上一層
    const yTD0   = yMDtop + dim(s, 8.5, 8);     // 特別展望台樓板（243 m）
    const tdWh   = dim(s, 0.8, 2);
    const yTDtop = yTD0 + 2 + tdWh;
    const aH1    = dim(s, 3.5, 3);              // 上段細格架（253→288 m）
    const aH2    = dim(s, 4.5, 4);              // 天線桿（288→333 m）
    const yTop   = yTDtop + aH1 + aH2 - 1;      // 塔頂那一層
    const yMid   = Math.round((yArch + yMD0) / 2);

    // ── 收分曲線：每個高度的塔身半寬（腳中心到中線），下段最斜＝腳往外張
    const prof = [[0, Math.max(5.5, s * 4.4)], [yArch, Math.max(4.3, s * 3.3)],
                  [yMid, Math.max(3.2, s * 2.2)], [yMD0, Math.max(2.4, s * 1.45)],
                  [yTD0, Math.max(1.3, s * 0.65)], [yTDtop, Math.max(1.1, s * 0.5)]];
    const lerp = (tab, y) => {
      for (let i = 1; i < tab.length; i++) {
        const [ya, wa] = tab[i - 1], [yb, wb] = tab[i];
        if (y <= yb) return wa + (wb - wa) * (y - ya) / (yb - ya);
      }
      return tab[tab.length - 1][1];
    };
    const hw = y => lerp(prof, y);
    // 面上的點：f 0 正面(−z) 1 背面(+z) 2 右(+x) 3 左(−x)；t 從 −1 到 1 橫過那一面
    const fp = (f, t, y) => { const h = hw(y);
      return f === 0 ? [t * h, -h] : f === 1 ? [t * h, h] : f === 2 ? [h, t * h] : [-h, t * h]; };
    const rod = (a, b, r, r1, c) =>
      limb(v, { x: a[0], y: a[1], z: a[2], x1: b[0], y1: b[1], z1: b[2], r, r1, c });

    // ── 色帶：大展望台以下全橘，以上到塔頂七等分橘白相間
    const span = yTop + 1 - yMDtop;
    const white = y => y >= yMDtop && Math.floor((y - yMDtop) * 7 / span) % 2 === 1;
    const cM = (x, y, z) => (white(y) ? 2 : 0);   // 主構件
    const cS = (x, y, z) => (white(y) ? 3 : 1);   // 斜撐（暗一階）

    // ── 台基：FootTown（腳底下那棟樓，正面中間是入口）＋四個混凝土基礎
    const hw0 = prof[0][1];
    const fx = Math.round(hw0 * 0.62), fz = Math.round(hw0 * 0.4), fH = dim(s, 1.3, 3);
    v.walls(0, 0, 0, 2 * fx + 1, fH, 2 * fz + 1, (x, y, z) =>
      (z === -fz && Math.abs(x) <= 1 && y <= 1) ? 4 : (y % 2 === 1 && y < fH - 1 ? 4 : 5), 1);
    v.box(0, fH, 0, 2 * fx + 1, 1, 2 * fz + 1, 6);
    const fw = dim(s, 1.4, 3, true), fh = dim(s, 0.3, 1);
    corners4(v, Math.round(hw0), Math.round(hw0), (vv, x, z) => vv.box(x, 0, z, fw, fh, fw, 6));

    // ── 四隻腳（地面→大展望台）：每一層一片 cyl，中心沿收分曲線挪——又粗又陡的柱子這樣比 limb 便宜很多
    const legR = [[0, Math.max(1.2, s * 0.4)], [yArch, Math.max(1.1, s * 0.32)],
                  [yMid, Math.max(1.0, s * 0.26)], [yMD0, Math.max(0.85, s * 0.21)]];
    for (let y = 0; y <= yMD0; y++) {
      const h = hw(y), r = Math.max(0.75, lerp(legR, y) - 0.33);   // cyl 收 r＋0.35，扣回來跟 limb 一樣粗
      corners4(v, h, h, (vv, x, z) => vv.cyl(x, y, z, r, 1, cM));
    }
    // 大展望台以上的四根角柱：細，用 limb
    const upY = [yMD0, yTD0, yTDtop - 1];
    const upR = [Math.max(0.85, s * 0.21), Math.max(0.8, s * 0.17), Math.max(0.8, s * 0.15)];
    for (const sx of [-1, 1]) for (const sz of [-1, 1])
      for (let i = 0; i + 1 < upY.length; i++) {
        const ya = upY[i], yb = upY[i + 1];
        rod([sx * hw(ya), ya, sz * hw(ya)], [sx * hw(yb), yb, sz * hw(yb)], upR[i], upR[i + 1], cM);
      }

    // ── 交叉斜撐：兩條 v.line 並排成兩格粗、面相連的斜桿（陡的往內錯一格、緩的往上錯一格）
    const bar = (a, b, f, c) => {
      const A = a.map(Math.round), B = b.map(Math.round);
      const dh = f < 2 ? B[0] - A[0] : B[2] - A[2];
      let o = [0, 1, 0];
      if (Math.abs(B[1] - A[1]) > Math.abs(dh)) {
        const sg = -Math.sign(f < 2 ? A[0] + B[0] : A[2] + B[2]) || 1;
        o = f < 2 ? [sg, 0, 0] : [0, 0, sg];
      }
      v.line(A[0], A[1], A[2], B[0], B[1], B[2], c);
      v.line(A[0] + o[0], A[1] + o[1], A[2] + o[2], B[0] + o[0], B[1] + o[1], B[2] + o[2], c);
    };
    // 每一格面板拉 X，面板太寬就並排兩三個 X（讓斜撐接近 45°）
    const panel = (y0, y1) => {
      const cols = Math.max(1, Math.round(2 * hw((y0 + y1) / 2) / (y1 - y0)));
      for (let f = 0; f < 4; f++) for (let k = 0; k < cols; k++) {
        const ta = -1 + 2 * k / cols, tb = -1 + 2 * (k + 1) / cols;
        const a0 = fp(f, ta, y0), b0 = fp(f, tb, y0), a1 = fp(f, ta, y1), b1 = fp(f, tb, y1);
        bar([a0[0], y0, a0[1]], [b1[0], y1, b1[1]], f, cS);
        bar([b0[0], y0, b0[1]], [a1[0], y1, a1[1]], f, cS);
      }
    };
    // 水平梁：一格高的方環，正好穿過四隻腳
    const ring = (y, h) => { const R = Math.round(hw(y)); v.walls(0, y, 0, 2 * R + 1, h, 2 * R + 1, cM, 1); };
    const nLo = Math.min(4, Math.max(2, Math.round((yMD0 - yArch) / 10)));
    for (let i = 0; i < nLo; i++) {
      const y0 = Math.round(yArch + (yMD0 - yArch) * i / nLo);
      const y1 = Math.round(yArch + (yMD0 - yArch) * (i + 1) / nLo);
      panel(y0, y1);
      if (i > 0) ring(y0, 1);
    }
    ring(yArch, 2);                                   // 拱頂那道大梁（40 m 平台）加厚一層
    const yU0 = yMDtop - 1, nUp = Math.min(3, Math.max(1, Math.round((yTD0 - yU0) / 11)));
    for (let i = 0; i < nUp; i++) {
      const y0 = Math.round(yU0 + (yTD0 - yU0) * i / nUp);
      const y1 = Math.round(yU0 + (yTD0 - yU0) * (i + 1) / nUp);
      panel(y0, y1);
      if (i > 0) ring(y0, 1);
    }

    // ── 腳間大拱：拱腳在腳上 yA0、拱頂在面板正中 yArch，limb 串成半橢圓
    const ra = Math.max(1.0, s * 0.3), nA = Math.max(8, Math.round(yArch * 0.45));
    for (let f = 0; f < 4; f++) {
      let prev = null;
      for (let k = 0; k <= nA; k++) {
        const th = Math.PI * k / nA, y = yA0 + (yArch - yA0) * Math.sin(th), p = fp(f, Math.cos(th), y);
        const cur = [p[0], y, p[1]];
        if (prev) rod(prev, cur, ra, ra, cM);
        prev = cur;
      }
    }

    // ── 大展望台：白色兩層樓的盒子，比塔身每邊多伸出一截，兩條深色窗帶，屋頂四邊出 1 格簷
    const mR = Math.round(hw(yMD0) + Math.max(1.5, s * 0.6)), mW = 2 * mR + 1;
    const sep = mdWh >= 5 ? Math.round((mdWh - 1) / 2) : -1;   // 兩層樓之間那條白帶
    v.walls(0, yMD0, 0, mW, 1, mW, 3, 2);                       // 樓板（外圈）
    v.walls(0, yMD0 + 1, 0, mW, mdWh, mW, (x, y, z) => {
      const j = y - yMD0 - 1;
      return j >= 1 && j <= mdWh - 2 && j !== sep ? 4 : 2;
    }, 1);
    v.box(0, yMD0 + 1 + mdWh, 0, mW + 2, 1, mW + 2, 2);         // 屋頂

    // ── 特別展望台：同樣的白盒，小一號
    const tR = Math.max(2, Math.round(hw(yTD0) + Math.max(0.6, s * 0.15))), tW = 2 * tR + 1;
    v.walls(0, yTD0, 0, tW, 1, tW, 3, 2);
    v.walls(0, yTD0 + 1, 0, tW, tdWh, tW, (x, y, z) => {
      const j = y - yTD0 - 1;
      return j >= 1 && j <= Math.max(1, tdWh - 2) ? 4 : 2;
    }, 1);
    v.box(0, yTD0 + 1 + tdWh, 0, tW + 2, 1, tW + 2, 2);

    // ── 上段細格架（中空收分）＋天線桿，色帶照算
    v.taper(0, yTDtop, 0, Math.max(1.5, hw(yTDtop)), 1.1, aH1, cM, 1);
    v.taper(0, yTDtop + aH1, 0, Math.max(1.1, s * 0.25), 0.4, aH2, cM);
  }
});
