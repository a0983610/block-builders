// 檔名：達摩不倒翁.js
// v1.319.0 盲測第十一回：子 agent 只拿〈藍圖製作說明〉、從零做出來的第二版（看過一次報告＋9000 四視圖），原樣收進來（只改了 name 與檔名那一行；見 開發筆記〈盲測第十一回：新增倫敦塔橋、泰國鄭王廟、新加坡濱海灣金沙、淡水紅毛城、達摩不倒翁（v1.319.0）〉）
// 正面：圓滾滾、肩膀飽滿的蛋形，最寬那一圈在 38% 高、底面平而寬、頭頂圓；上半是一張白臉（上緣有紅頭巾），下半紅肚子上一個金色「福」
// 側面：跟正面幾乎一樣圓（實物深 9.5 ≈ 寬 10），臉只長在正面；兩肩各有一行直書的金字「大吉」
// 三樣識別物：①白臉上的粗黑眉與 U 形黑鬍，兩個大白眼圈，其中一隻（達摩自己的左眼＝面對它時的右邊）畫了黑眼珠
//            ②紅色、底部比較重的不倒翁身體　③肚子上的金色「福」
// 比例表（實物：高崎達摩一款 高 12 cm × 寬 10 × 深 9.5）：高／寬 1.2；最寬處在 38% 高；底面直徑 ≈ 寬的 0.62；
//   臉（白色區）寬 ≈ 全寬的 0.70、高 ≈ 全高的 0.47、中心在 64% 高（比實物大一點，五官才塞得下）；福字在 9～36% 高
// 輪廓寬度（正面，最寬 = 1）：底面 0.62／10% 高 0.82／38% 1.00／60% 0.95／80% 0.80／95% 0.52／頂 ≈ 0.23
// 部件尺寸（第一版報告：9000 塊 s = 18.76；這一版肩膀加飽滿，估 s ≈ 18.3）：全寬 2s ≈ 37、全高 2.4s ≈ 44；臉 27×21；
//   眼圈直徑 ≈ 9（黑框 1 格、白圈 1 格）、黑眼珠直徑 5；眉粗 1～3 格、長 9 格，上面留一排白；八字鬍粗 2～3 格；
//   兩頰鬍帶 3 格、下巴鬍 3 層；福字 13×13（一筆一格、筆間留一格）；肩上「大吉」7 寬 × 17 高
// 部件：身體(revolve, shell 2) 頭頂封頂(revolve 實心) 底面(cyl) 底緣暗紅(顏色函式)
//       臉／眼圈／黑眼珠／眉／八字鬍／嘴／下巴與兩頰的鬍(身體的顏色函式，正面投影)
//       福字(顏色函式，點陣) 肩上大吉(顏色函式，繞著身體貼字)
customBlueprint({
  name: '達摩不倒翁',
  pal: ['#c0201f',   // 0 達摩紅（身體、嘴）
        '#861517',   // 1 暗紅（底緣）
        '#e6dfd0',   // 2 臉（暖白）
        '#221c1c',   // 3 墨黑（眉、鬍、眼圈、黑眼珠）
        '#f4d060',   // 4 金（福字、肩上的字）
        '#f2efe8'],  // 5 眼白
  lo: 3, hi: 27,

  gen(v, s) {
    const R = s;                               // 最寬那一圈的半徑：整尊唯一的錨
    const Ht = dim(s, 2.4, 8);                 // 全高（高／寬 = 1.2）
    const yc = Ht * 0.38;                      // 最寬那一圈的高度（底部比較重）
    const bL = yc / 0.785, bU = Ht - yc;       // 下半、上半的縱半軸（底面半徑 = 0.62R）
    const rad = h => {                         // 剖面：高度 h 處的半徑
      const hh = Math.min(h, Ht - 0.5);        // 頂上留一小塊平面，不冒尖
      if (hh <= yc) { const t = (yc - hh) / bL; return R * Math.sqrt(Math.max(0, 1 - t * t)); }
      const t = (hh - yc) / bU;                // 上半比橢圓飽滿（指數 2.2）：肩膀鼓、頭頂圓
      return R * Math.pow(Math.max(0, 1 - Math.pow(t, 2.2)), 1 / 2.2);
    };

    // ---- 臉（正面投影：只看 x、y，z < 0 的格子才上色） ----
    const yf = Math.round(Ht * 0.64);                     // 臉中心的高度
    const hw = R * 0.70, hh = R * 0.56;                   // 臉的半寬、半高
    const inFace = (a, b) => b >= 0                       // 上半額頭平（指數 4）、下半圓（指數 2.6）
      ? Math.pow(a / hw, 4) + Math.pow(b / hh, 4)
      : Math.pow(a / hw, 2.6) + Math.pow(-b / hh, 2.6);
    const ex = Math.max(2, Math.round(R * 0.37));         // 眼睛離中線
    const ey = Math.round(R * 0.06);                      // 眼睛比臉中心高幾格
    const re = Math.max(2.4, R * 0.22);                   // 眼圈半徑
    const rp = Math.max(1.2, re - 1.9);                   // 黑眼珠半徑：跟黑框之間留一整圈白
    const bx0 = ex - re * 0.95, bx1 = ex + re * 1.1;      // 眉的內端、外端
    const bht = Math.max(0.8, R * 0.075);                 // 眉的半粗
    const by0 = ey + re + 0.9 + bht * 0.6;                // 眉內端的中線高度
    const bA = Math.max(0.5, R * 0.06), bT = Math.max(0.4, R * 0.04);   // 眉的拱、外端上揚
    const m0 = -R * 0.20, m1 = -R * 0.33, mx = R * 0.40;  // 八字鬍：中間高、往外往下垂
    const mh = Math.max(0.7, R * 0.07);
    const mouthY = Math.round(-R * 0.39), mouthW = Math.max(1, Math.round(R * 0.09));
    const chin = -R * 0.42, cheekTop = -R * 0.22;         // 下巴鬍的上緣、兩頰鬍帶的上緣

    const face = (x, y) => {                   // 回傳顏色索引，-1 ＝ 不在臉上
      const dy = y - yf, ax = Math.abs(x);
      if (ax > hw + 1 || dy > hh + 1 || dy < -hh - 1) return -1;
      const q = inFace(ax, dy);
      if (q > 1) return -1;
      // 眼睛：+x 是達摩自己的右眼（空白），-x 是左眼（畫了黑眼珠，面對它是右邊）
      const d = Math.hypot(ax - ex, dy - ey);
      if (d <= re + 0.35) {
        if (x < 0 && d <= rp + 0.35) return 3;
        return d > re - 0.65 ? 3 : 5;
      }
      // 眉：內低外高、中段拱起，中段粗兩端細；上面一律留一排白（不跟紅頭巾連成一條黑邊）
      if (ax >= bx0 && ax <= bx1 && inFace(ax, dy + 1) <= 1) {
        const u = (ax - bx0) / (bx1 - bx0);
        const cy = by0 + bA * 4 * u * (1 - u) + bT * u;
        if (Math.abs(dy - cy) <= Math.max(0.6, bht * (0.6 + 0.4 * Math.sin(Math.PI * u)))) return 3;
      }
      // 八字鬍
      if (ax <= mx) {
        const u = ax / mx;
        const cy = m0 + (m1 - m0) * Math.pow(u, 1.6);
        if (Math.abs(dy - cy) <= Math.max(0.6, mh * (1 - 0.45 * u))) return 3;
      }
      if (dy === mouthY && ax <= mouthW) return 0;        // 嘴
      if (dy <= chin) return 3;                            // 下巴的鬍
      if (dy <= cheekTop && q >= 0.55) return 3;           // 兩頰的鬍帶（連成 U 形）
      return 2;
    };

    // ---- 肚子上的「福」（點陣；正面看 +x 在左邊，所以字的第 0 欄放在 +x） ----
    const BIG = ['..#...#######',
                 '..#..........',
                 '####...#####.',
                 '...#...#...#.',
                 '..#....#####.',
                 '.###.........',
                 '#.#.#.#######',
                 '..#...#..#..#',
                 '..#...#..#..#',
                 '..#...#######',
                 '..#...#..#..#',
                 '..#...#..#..#',
                 '..#...#######'];
    const SMALL = ['.#..#####',
                   '###......',
                   '..#..###.',
                   '.##......',
                   '#.#.#####',
                   '..#.#.#.#',
                   '..#.#####'];
    const yDark = Math.max(1, Math.round(Ht * 0.09));     // 底緣暗紅
    const faceBot = Math.floor(yf - hh);
    const useBig = faceBot - 2 - 12 >= 2;
    const G = useBig ? BIG : SMALL;
    const gTop = useBig ? faceBot - 2 : faceBot - 1;
    const gHalf = (G[0].length - 1) / 2;
    const fuku = (x, y) => {
      const r = gTop - y, c = gHalf - x;
      return r >= 0 && r < G.length && c >= 0 && c < G[0].length && G[r][c] === '#';
    };

    // ---- 兩肩直書的金字「大吉」（繞著身體貼：角度 × 半徑 ＝ 弧長） ----
    const DAI = ['...#...', '...#...', '#######', '...#...', '..#.#..', '.#...#.', '#.....#'];
    const KICHI = ['...#...', '#######', '...#...', '.#####.', '.......', '.#####.', '.#...#.', '.#####.'];
    const SIDE = R >= 15 ? DAI.concat(['.......', '.......'], KICHI) : R >= 10 ? DAI : [];
    const sTop = Math.round(yf + R * 0.36);
    const thC = 76 * Math.PI / 180;            // 從正面往側面轉 76°
    const side = (x, y, z) => {
      const r = sTop - y;
      if (r < 0 || r >= SIDE.length) return false;
      const u = Math.round((Math.atan2(Math.abs(x), -z) - thC) * Math.hypot(x, z)) + 3;
      return u >= 0 && u <= 6 && SIDE[r][u] === '#';
    };

    const col = (x, y, z) => {
      if (z < 0) {
        const f = face(x, y);
        if (f >= 0) return f;
        if (fuku(x, y)) return 4;
      }
      if (Math.abs(x) > 1 && side(x, y, z)) return 4;
      return y <= yDark ? 1 : 0;
    };

    // 身體：蛋形旋轉體，兩格厚的殼
    const F = [0, 0.04, 0.09, 0.15, 0.22, 0.3, 0.38, 0.47, 0.56, 0.65, 0.73, 0.8, 0.86, 0.91, 0.95, 0.98, 1];
    revolve(v, { x: 0, y: 0, z: 0, c: col, shell: 2, prof: F.map(f => [rad(f * Ht), f * Ht]) });
    // 頭頂封頂：越往上每層收得越多，殼會漏，最上面一小段做實心
    const yCap = Math.floor(yc + bU * 0.84);
    revolve(v, { x: 0, y: yCap, z: 0, c: col,
                 prof: [0, 0.3, 0.6, 0.85, 1].map(f => { const h = yCap + f * (Ht - yCap); return [rad(h), h - yCap]; }) });
    // 底面：平而寬，整片封起來（不倒翁的重心）
    v.cyl(0, 0, 0, rad(0) - 0.5, 1, 1);
  }
});
