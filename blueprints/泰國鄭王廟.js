// 檔名：泰國鄭王廟.js
// v1.319.0 盲測第十一回：子 agent 只拿〈藍圖製作說明〉、從零做出來的第二版（看過一次報告＋9000 四視圖），原樣收進來（只改了 name 與檔名那一行；見 開發筆記〈盲測第十一回：新增倫敦塔橋、泰國鄭王廟、新加坡濱海灣金沙、淡水紅毛城、達摩不倒翁（v1.319.0）〉）
// 正面：正中一根很高的白色玉米形尖塔（一層一層連續往上收成子彈頭，每節一圈灰簷、角上冒小尖），
//       腳下三層往上收的折角方台，台座正中一道很陡的梯子爬上兩層；左右各一座約四成高的同款角塔；塔頂細針加三叉戟
// 側面：四面對稱，跟正面一樣（四面都有陡梯；四座角塔在對角，側面也是一左一右）
// 三樣識別物：①玉米形、子彈頭輪廓的塔身（一節節的灰簷＋角上小尖，越往上越尖）
//             ②台座與塔身貼滿彩色瓷片小花（黃花心、粉／藍／綠花瓣，白灰泥底）
//             ③台座四面的陡梯（一階兩層高、深淺相間）＋塔頂的三叉戟
// 比例表（實物）：主塔高 67～86 m（取約 70 m）；台座周長 234 m（邊長約 58 m → 台座寬／全高約 0.6～0.8）；
//   四座角塔約主塔四成高（查不到數字，照一般印象）；台座三層、陡梯爬到第二層（約全高三成）；
//   高度分配：三層台座 0.32、塔室（四面壁龕供因陀羅騎三頭白象）0.08、玉米身 0.44、塔針＋三叉戟 0.16
// 輪廓寬度（正面，全高 H ＝ 1）：地面那一段連兩座角塔 0.95／第一層台 0.55／第三層台 0.28／塔室 0.25／
//   玉米身底 0.21 → 半高 0.16 → 八成高 0.10 → 頂 0.05／三叉戟 0.09
// 部件尺寸（第一版報告：9000 塊 s ＝ 5.86；這版台座加高、塔身加長，估 s ≈ 5.0，主塔 H ≈ 53 格）：
//   第一層台 29 寬、7 層；第二層 19 寬、6 層；第三層 15 寬、4 層；塔室 13 寬、4 層（門廊 5 寬，壁龕 3×2、白象 1 格）
//   玉米身底 11 寬、23 層、6 節：每一層照子彈頭曲線各算各的寬（11 → 9 → 5 → 3），節簷外凸 1 格、角上小尖 1 格
//   塔針 1 格粗 5 層；三叉戟 5 格寬 4 層（三根齒中間隔 1 格縫）；陡梯 3 格寬＋兩側扶牆、每階 2 層高
//   瓷片花 3×3 十字（花心 1 格）：看不出花瓣，目標是看得出「彩色拼花帶」；第一層台放兩列
//   角塔 s×0.45 ≈ 2.3：13 格寬、約 20 層高
// 部件：台座三層（rlayer 折角方殼，自己寫的：boxTaper 做不出泰式「折角」平面）
//       地坪（rlayer 實心環）欄杆（rlayer 一格環）陡梯（box 逐階＋扶牆）
//       塔室（rlayer 兩格殼）門廊（box）壁龕與白象（tint）
//       玉米身（rlayer 兩格殼，每層照曲線）節簷（rlayer）角上小尖（box）
//       塔針（box）金環（cyl）三叉戟（box）四座角塔（同一支函式縮小，corners4）瓷片花（顏色函式）
customBlueprint({
  name: '泰國鄭王廟',
  pal: ['#d9d3c7',   // 0 白灰泥底（瓷片的底色）
        '#9a9388',   // 1 灰：節簷、欄杆、塔室簷、扶牆
        '#3f74c4',   // 2 瓷片藍
        '#d4566a',   // 3 瓷片粉紅
        '#4f9a5e',   // 4 瓷片綠
        '#e6b730',   // 5 瓷片黃（花心）、塔頂金飾
        '#3b3631',   // 6 壁龕深色、階梯陰影
        '#857a6c',   // 7 台座地坪、階梯石
        '#f2efe8'],  // 8 白象（壁龕裡的因陀羅騎象）
  lo: 1.2, hi: 10,

  gen(v, s) {
    const PET = [3, 2, 4];
    const md = (a, m) => ((a % m) + m) % m;

    /* 瓷片花紋（顏色函式用）：u 是沿牆面的橫向座標，ly 是這一段牆從下往上第幾層、rows 是這一段有幾層。
       一朵花是 3×3 的十字：花心黃、四瓣輪流粉／藍／綠；放得下幾列就放幾列（每列 3 層＋1 層空），置中、一列一列錯開半朵。
       太矮放不下一整朵（rows < 3）就只排一列小色點。 */
    const deco = (u, ly, rows, salt) => {
      if (rows >= 3) {
        const nf = Math.floor((rows + 1) / 4), c0 = Math.floor((rows - (4 * nf - 1)) / 2) + 1;
        const m = Math.round((ly - c0) / 4), cy = c0 + 4 * m, d = ly - cy;
        if (m < 0 || m >= nf || d < -1 || d > 1) return 0;
        const q = u + 2 * m + salt, a = md(q, 4);
        const pet = PET[md(Math.floor(q / 4) + m, 3)];
        if (d === 0) return a === 0 ? 5 : a === 2 ? 0 : pet;
        return a === 0 ? pet : 0;
      }
      if (ly !== rows - 1) return 0;
      const q = u + salt;
      return md(q, 3) === 0 ? PET[md(Math.floor(q / 3), 3)] : 0;
    };
    // 牆面上的橫向座標：正背兩面用 x、左右兩面用 z（牆面一層層往內收時花不會歪掉）
    const pat = (cx, cz, y0, rows, sl) => (x, y, z) => {
      const lx = x - cx, lz = z - cz;
      return deco(Math.abs(lz) >= Math.abs(lx) ? lx : lz, y - y0, rows, sl);
    };

    /* 泰式「折角」方形（ย่อมุม）：四個角各往內折兩階，k 是每階幾格。
       zmx(ax) ＝ 離中心 ax 那一欄，z 方向最遠到幾格。 */
    const kOf = hw => (hw >= 5 ? Math.max(1, Math.round(hw * 0.16)) : hw >= 3 ? 1 : 0);
    const zmx = (ax, hw, k) => (ax > hw ? -99 : ax <= hw - 2 * k ? hw : ax <= hw - k ? hw - k : hw - 2 * k);
    // 一層折角方殼：半寬 hw、殼厚 t（t 大到碰在一起就是實心），一欄一欄用 box 畫
    const rlayer = (cx, y, cz, hw, t, c) => {
      const k = kOf(hw);
      for (let x = -hw; x <= hw; x++) {
        const ax = Math.abs(x), zm = zmx(ax, hw, k);
        const zi = ax + t > hw ? 0 : Math.max(0, zmx(ax + t, hw, k) - t + 1);
        if (zi === 0) v.box(cx + x, y, cz, 1, 1, 2 * zm + 1, c);
        else {
          v.box(cx + x, y, cz - (zm + zi) / 2, 1, 1, zm - zi + 1, c);
          v.box(cx + x, y, cz + (zm + zi) / 2, 1, 1, zm - zi + 1, c);
        }
      }
    };
    // 折角方形的 12 個外凸角上各立一根小尖（玉米粒那種一顆顆的凸點）
    const spikes = (cx, y, cz, hw, h, c) => {
      const k = kOf(hw);
      const pts = k > 0 ? [[hw, hw - 2 * k], [hw - k, hw - k], [hw - 2 * k, hw]] : [[hw, hw]];
      for (const [a, b] of pts) for (const sx of [-1, 1]) for (const sz of [-1, 1])
        v.box(cx + sx * a, y, cz + sz * b, 1, h, 1, c);
    };

    // 四個面：di 0 正面（−z）、1 右（+x）、2 背（+z）、3 左（−x）；a 沿牆橫向、d 離中心往外幾格
    const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    const fxz = (cx, cz, di, a, d) => {
      const [ox, oz] = DIRS[di];
      return ox === 0 ? [cx + a, cz + oz * d] : [cx + ox * d, cz + a];
    };
    const fbox = (cx, cz, di, a, d, y, wa, h, c) => {
      const [x, z] = fxz(cx, cz, di, a, d);
      if (DIRS[di][0] === 0) v.box(x, y, z, wa, h, 1, c); else v.box(x, y, z, 1, h, wa, c);
    };
    const fcarve = (cx, cz, di, a, d, y, wa, h) => {
      const [x, z] = fxz(cx, cz, di, a, d);
      if (DIRS[di][0] === 0) v.carve(x, y, z, wa, h, 1); else v.carve(x, y, z, 1, h, wa);
    };

    // 一座塔的尺寸（主塔與角塔共用，角塔吃縮小的 S）
    const size = (S, main) => {
      const o = {};
      o.h1 = dim(S, main ? 1.5 : 1.1, 2);          // 台座各層高（主塔的台座高大、梯子長）
      o.h2 = dim(S, main ? 1.15 : 0.85, 2);
      o.h3 = dim(S, 0.8, 2);
      o.sw = dim(S, 0.55, 1, true);                 // 陡梯寬（奇數）
      o.n2 = Math.ceil(o.h2 / 2);                   // 第二段梯子往外伸幾格（一階兩層高）
      o.hs0 = dim(S, 1.1, main ? 2 : 1);            // 玉米身底的半寬
      o.hwc = o.hs0 + 1;                            // 塔室半寬
      o.hc = main ? dim(S, 0.9, 4) : dim(S, 0.8, 2);// 塔室高（主塔至少 4 層：壁龕與白象在最小那檔也留得住）
      o.hs = dim(S, 4.6, main ? 6 : 4);             // 玉米身高
      o.hf = dim(S, 1.0, main ? 3 : 2);             // 塔針高
      const st = f => Math.max(1, Math.round(S * f));
      if (main) {
        o.hw3 = o.hwc + st(0.3);
        o.hw2 = o.hw3 + st(0.35);
        o.hw1 = o.hw2 + o.n2 + (S >= 4 ? 2 : 1);   // 第一層台要留得下第二段梯子＋走道
        o.ters = [[o.h1, o.hw1], [o.h2, o.hw2], [o.h3, o.hw3]];
      } else if (S >= 1.4) {
        o.hw2 = o.hwc + st(0.35);
        o.hw1 = o.hw2 + st(0.35);
        o.ters = [[o.h1, o.hw1], [o.h2, o.hw2]];
      } else {
        o.hw1 = o.hwc + 1;
        o.ters = [[o.h1, o.hw1]];
      }
      o.bal = main || S >= 1.8;
      return o;
    };

    const prang = (cx, cz, S, main, salt) => {
      const o = size(S, main);

      // ── 台座：一層一層往上收的折角方台，頂面一圈地坪、外緣一圈欄杆
      let y = 0;
      const yb = [];
      o.ters.forEach(([h, hw], i) => {
        const inner = i + 1 < o.ters.length ? o.ters[i + 1][1] : o.hwc;
        const p = pat(cx, cz, y, h - 1, salt + 2 * i);
        for (let j = 0; j < h - 1; j++) rlayer(cx, y + j, cz, hw, 1, p);
        rlayer(cx, y + h - 1, cz, hw, hw - inner + 1, 7);   // 地坪：一路鋪進上一層的牆底下
        if (o.bal) rlayer(cx, y + h, cz, hw, 1, 1);         // 欄杆
        yb.push(y);
        y += h;
      });

      // ── 陡梯（只有主塔）：四面各兩段，一階兩層高；兩側扶牆比踏步高一層
      if (main) {
        const half = (o.sw + 1) / 2;
        const fl = [[yb[0], o.h1, o.hw1], [yb[1], o.h2, o.hw2]];
        for (let di = 0; di < 4; di++) for (const [y0, R, hw] of fl) {
          const n = Math.ceil(R / 2);
          const sc = (x, yy, z) => ((yy - y0) % 2 === 1 ? 7 : 6);
          for (let j = 0; j < n; j++) {
            const hj = Math.min(R, 2 * (j + 1)), d = hw + n - j;
            fbox(cx, cz, di, 0, d, y0, o.sw, hj, sc);
            fbox(cx, cz, di, half, d, y0, 1, hj + 1, 1);
            fbox(cx, cz, di, -half, d, y0, 1, hj + 1, 1);
          }
          fcarve(cx, cz, di, 0, hw, y0 + R, o.sw, 1);      // 欄杆在梯子頂端開口
        }
      }

      // ── 塔室：兩格殼＋一圈灰簷；四面門廊，主塔的壁龕裡一尊白象
      const yc = y;
      const pc = pat(cx, cz, yc, o.hc - 1, salt + 8);
      for (let j = 0; j < o.hc - 1; j++) rlayer(cx, yc + j, cz, o.hwc, 2, pc);
      rlayer(cx, yc + o.hc - 1, cz, o.hwc, o.hwc - o.hs0 + 2, 1);
      if (o.hc >= 3) {
        const pw = dim(S, 0.75, main ? 5 : 3, true), nw = pw - 2, nh = o.hc - 2, d = o.hwc + 1;
        for (let di = 0; di < 4; di++) {
          fbox(cx, cz, di, 0, d, yc, pw, o.hc - 1, 0);              // 門廊
          fbox(cx, cz, di, 0, d, yc + o.hc - 1, pw - 2, 1, 1);      // 門廊頂
          for (let a = -(nw - 1) / 2; a <= (nw - 1) / 2; a++) for (let j = 0; j < nh; j++) {
            const [x, z] = fxz(cx, cz, di, a, d);
            tint(v, x, yc + j, z, main && nw >= 3 && a === 0 && j < nh - 1 ? 8 : 6);
          }
        }
      }

      /* ── 玉米身：每一層照子彈頭曲線算寬（下段微鼓、往上越收越快，頂端收到 3 格），
            切成 N 節，每節頂上一圈外凸一格的灰簷＋角上小尖。 */
      const ys = yc + o.hc;
      const N = Math.max(2, Math.min(9, Math.floor(o.hs / (o.hs >= 16 ? 4 : 3))));
      const hwY = j => (j >= o.hs ? 0 : Math.max(1, Math.round(o.hs0 * Math.pow(1 - Math.pow(j / o.hs, 1.6), 0.7))));
      const sh = Math.max(1, Math.round(S * 0.15));
      for (let i = 0; i < N; i++) {
        const y0 = Math.round(i * o.hs / N), y1 = Math.round((i + 1) * o.hs / N);
        const p = pat(cx, cz, ys + y0, y1 - y0 - 1, salt + 12 + 2 * i);
        for (let j = y0; j < y1 - 1; j++) rlayer(cx, ys + j, cz, hwY(j), 2, p);
        const hl = hwY(y1 - 1);
        if (hl >= 2 || i < N - 1) {
          rlayer(cx, ys + y1 - 1, cz, hl + 1, hl + 3 - hwY(y1), 1);   // 節簷：往內一路鋪到下一節的殼底下
          if (hl + 1 >= 3) spikes(cx, ys + y1, cz, hl + 1, sh, 0);
        } else rlayer(cx, ys + y1 - 1, cz, hl, 2, 0);                // 最頂那一節已經收到 3 格：不再加簷
      }

      // ── 塔針＋金環；主塔頂上一支三叉戟（三根齒中間各隔一格）
      const yf = ys + o.hs;
      v.box(cx, yf, cz, 1, o.hf, 1, (x, y2, z) => (y2 >= yf + Math.round(o.hf * 0.5) ? 5 : 0));
      v.cyl(cx, yf + 1, cz, 1, 1, 5);
      if (main) {
        const yt = yf + o.hf;
        v.box(cx, yt, cz, 5, 1, 1, 5);
        v.box(cx, yt, cz, 1, 1, 5, 5);
        v.box(cx, yt + 1, cz, 1, 3, 1, 5);
        for (const [a, b] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) v.box(cx + a, yt + 1, cz + b, 1, 2, 1, 5);
      }
    };

    // 主塔在中央；四座角塔縮成 0.45 倍，擺在主塔第一層台折角的外面（剛好卡進折角，不重疊）
    const om = size(s, true);
    const ss = s * 0.45, os = size(ss, false);
    const D = om.hw1 - kOf(om.hw1) + os.hw1;
    prang(0, 0, s, true, 0);
    corners4(v, D, D, (vv, x, z) => prang(x, z, ss, false, 4));
  }
});
