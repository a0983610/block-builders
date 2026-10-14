// 檔名：八卦山大佛.js
// v1.286.0 盲測：子 agent 只拿〈藍圖製作說明〉、從零做出來的第二輪定稿，原樣收進來（只改了 name 與檔名那一行；見 開發筆記〈盲測第二回：三座粗糙的自訂藍圖重做、prompt 兩輪對照（v1.286.0）〉）
// 正面：金色蓮座上結跏趺坐，斜圓肩、兩臂順著袈裟垂下、兩手在腹前疊成定印，兩膝往左右撐得最寬——整體是下寬上窄的三角形；頂上螺髮與肉髻，兩耳垂到下巴，座前左右各一隻石獅
// 側面：蓮座比佛身寬一圈、腰收一截再往上翻開；盤起的腿往前伸出一截，背直、頭略往前探（低頭俯視彰化市區）
// 三樣識別物：結跏趺坐＋腹前定印的坐姿、整尊深巧克力色（黑紅、帶金屬光）的佛身、底下一圈往上翻的金色蓮瓣
// 比例：全高約 22～23 m、蓮座約 4 m；仿鎌倉大佛（像高 11.39 m、臉長 2.35 m → 頭含肉髻約 3.3 m、兩膝距 9.1 m）→ 坐高約 3.5 頭、兩膝寬約 3 頭、肩寬約 2.4 頭、蓮座高約 0.75 頭
// 部件：石台基 蓮座(revolve) 下排蓮瓣 上排翻起的蓮瓣 盤腿 兩膝 交疊的小腿 腳掌 腹 胸 背後袈裟 斜肩 上臂 前臂 定印雙手 拇指圈 頸 頭 肉髻 長耳 螺髮 眼 鼻 口 白毫 石獅一對
customBlueprint({
  name: '八卦山大佛',
  pal: ['#3b2a24',   // 0 佛身本色（巧克力黑，亮度 0.19）
        '#33231e',   // 1 佛身暗一階（0.16）
        '#2a1c18',   // 2 佛身最暗一階、螺髮（0.13）
        '#c8962c',   // 3 蓮瓣金
        '#9a6e1e',   // 4 蓮座本體（暗金：花瓣之間的陰影）
        '#e0b84a',   // 5 上排翻起的蓮瓣、白毫（亮金）
        '#8c8780',   // 6 石台基、獅座、鬃毛
        '#b0aaa0',   // 7 石獅
        '#8a6450'],  // 8 眼、唇（比佛身亮兩階，深色的臉上才看得見）
  lo: 2.0, hi: 13,

  gen(v, s) {
    const hd = s;                                    // 頭高（下巴到肉髻頂）：整尊唯一的錨，不取整
    const R = Math.round;
    const H = (x, y, z) => (((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) >>> 0) % 100;
    const skin = (x, y, z) => { const h = H(x, y, z); return h < 55 ? 0 : h < 82 ? 1 : 2; };   // 佛身三階
    const zero = () => 0;

    // 橢球：每一列 (y, z) 用一個 v.box 填底色，只有露在外面的格子才用 v.set 換成雜湊挑的那一階
    const eb = (x0, y0, z0, rx, ry, rz, base = zero, surf = skin) => {
      const span = (y, z) => {
        const k = 1 - ((y - y0) / ry) ** 2 - ((z - z0) / rz) ** 2;
        if (k < 0) return null;
        const h = rx * Math.sqrt(k), a = Math.ceil(x0 - h), b = Math.floor(x0 + h);
        return a <= b ? [a, b] : null;
      };
      for (let y = Math.ceil(y0 - ry); y <= Math.floor(y0 + ry); y++)
        for (let z = Math.ceil(z0 - rz); z <= Math.floor(z0 + rz); z++) {
          const sp = span(y, z);
          if (!sp) continue;
          const a = sp[0], b = sp[1], w = b - a + 1, bc = base(y);
          v.box(w % 2 ? (a + b) / 2 : a + w / 2 - 1, y, z, w, 1, 1, bc);     // 偶數寬：中心往 −x 半格才會剛好佔 a～b
          const nb = [span(y + 1, z), span(y - 1, z), span(y, z + 1), span(y, z - 1)];
          for (let x = a; x <= b; x++) {
            if (x !== a && x !== b && nb.every(q => q && x >= q[0] && x <= q[1])) continue;   // 埋在裡面的不必換色
            const c = surf(x, y, z);
            if (c !== bc) v.set(x, y, z, c);
          }
        }
    };
    // 兩點之間有粗細的棍子（同 limb 的幾何，蓋的當下挑色；只用在手臂、小腿這些小部件）
    const cp = (ax, ay, az, bx, by, bw, r0, r1 = r0, c = skin) => {
      const dx = bx - ax, dy = by - ay, dz = bw - az, L2 = dx * dx + dy * dy + dz * dz || 1e-9, m = Math.max(r0, r1);
      for (let x = Math.ceil(Math.min(ax, bx) - m); x <= Math.floor(Math.max(ax, bx) + m); x++)
        for (let y = Math.ceil(Math.min(ay, by) - m); y <= Math.floor(Math.max(ay, by) + m); y++)
          for (let z = Math.ceil(Math.min(az, bw) - m); z <= Math.floor(Math.max(az, bw) + m); z++) {
            let t = ((x - ax) * dx + (y - ay) * dy + (z - az) * dz) / L2;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const ex = ax + dx * t - x, ey = ay + dy * t - y, ez = az + dz * t - z, r = r0 + (r1 - r0) * t;
            if (ex * ex + ey * ey + ez * ez <= r * r) v.set(x, y, z, c(x, y, z));
          }
    };

    // ── 著地：石台基（中間被蓮座蓋住，只做外圈）＋中空的蓮座加一片蓋 ──
    const pR = hd * 1.85, pH = dim(s, 0.18, 1);
    v.cyl(0, 0, 0, pR, pH, 6, Math.max(2, R(pR - hd * 1.0)));
    const lH = Math.max(3, R(hd * 0.75));
    revolve(v, { x: 0, y: pH, z: 0, c: 4, shell: 2,
                 prof: [[hd * 1.2, 0], [hd * 1.0, lH * 0.3], [hd * 1.3, lH * 0.7], [hd * 1.68, lH]] });
    v.cyl(0, pH + lH, 0, hd * 1.68 - 0.35, 1, 4);                                                  // 蓮座頂面
    const sy = pH + lH + 1;                                                                       // 座面

    // ── 姿勢：結跏趺坐（兩膝是正面最寬處） ──
    eb(0, sy + hd * 0.28, -hd * 0.25, hd * 1.32, hd * 0.36, hd * 0.85);                            // 盤起的雙腿
    for (const g of [-1, 1]) eb(g * hd * 1.1, sy + hd * 0.26, -hd * 0.5, hd * 0.45, hd * 0.33, hd * 0.46);   // 兩膝
    cp(-hd * 1.12, sy + hd * 0.32, -hd * 0.66, hd * 0.55, sy + hd * 0.42, -hd * 0.56, hd * 0.25, hd * 0.19);  // 左小腿（在下）
    cp(hd * 1.12, sy + hd * 0.36, -hd * 0.82, -hd * 0.55, sy + hd * 0.48, -hd * 0.74, hd * 0.26, hd * 0.2);   // 右小腿（在上）
    eb(-hd * 0.62, sy + hd * 0.56, -hd * 0.7, hd * 0.2, hd * 0.12, hd * 0.3);                       // 右腳掌（腳心朝上）
    eb(hd * 0.62, sy + hd * 0.5, -hd * 0.56, hd * 0.2, hd * 0.12, hd * 0.3);                        // 左腳掌

    // ── 軀幹：腹比胸窄、背直 ──
    const tz = hd * 0.1;
    eb(0, sy + hd * 0.85, tz, hd * 0.74, hd * 0.8, hd * 0.64);                                     // 腹
    eb(0, sy + hd * 1.62, tz, hd * 0.95, hd * 0.7, hd * 0.6);                                      // 胸
    eb(0, sy + hd * 1.2, tz + hd * 0.2, hd * 1.05, hd * 0.95, hd * 0.42);                           // 背後垂下的袈裟（腋下有底）
    for (const g of [-1, 1]) eb(g * hd * 0.8, sy + hd * 1.9, tz, hd * 0.38, hd * 0.34, hd * 0.44);  // 斜圓肩

    // ── 四肢：上臂、前臂各一段 ──
    for (const g of [-1, 1]) {
      cp(g * hd * 0.9, sy + hd * 1.92, tz, g * hd * 1.08, sy + hd * 0.98, -hd * 0.05, hd * 0.3, hd * 0.27);          // 肩 → 肘
      cp(g * hd * 1.08, sy + hd * 0.98, -hd * 0.05, g * hd * 0.46, sy + hd * 0.7, -hd * 0.62, hd * 0.26, hd * 0.21);  // 肘 → 腕
    }
    // 定印：兩手掌心朝上疊在腹前，比前臂往前凸一截、露在小腿上面；兩拇指往上合成一個圈
    const qy = sy + hd * 0.76, qz = -hd * 0.86;
    eb(0, qy, qz, hd * 0.44, hd * 0.18, hd * 0.28);
    for (const g of [-1, 1])
      cp(g * hd * 0.24, qy + hd * 0.06, qz - hd * 0.08, g * hd * 0.05, qy + hd * 0.28, qz - hd * 0.08, Math.max(0.75, hd * 0.085));

    // ── 頭：頸、頭（髮際線以上是螺髮）、肉髻、長耳 ──
    const hy = sy + hd * 2.9, hz = -hd * 0.06, hx = hd * 0.46, hry = hd * 0.44, hrz = hd * 0.47;   // 下巴在 sy + 2.46 頭
    const hairY = hy + hd * 0.26;
    const hairBase = y => (y >= hairY ? 2 : 0);
    const hair = (x, y, z) => (y >= hairY ? (H(x, y, z) < 60 ? 2 : 1) : 0);
    cp(0, sy + hd * 1.95, tz - hd * 0.04, 0, sy + hd * 2.62, hz + hd * 0.04, hd * 0.27);            // 頸
    eb(0, hy, hz, hx, hry, hrz, hairBase, hair);                                                  // 頭
    eb(0, hy + hd * 0.38, hz + hd * 0.03, hd * 0.33, hd * 0.18, hd * 0.33, hairBase, hair);        // 肉髻：低而寬的圓丘（頂在 hy + 0.56 頭）
    for (const g of [-1, 1])                                                                      // 長耳：髮際線以下貼著臉頰垂到下巴，耳垂較粗
      cp(g * hd * 0.43, hy + hd * 0.04, hz + hd * 0.08, g * hd * 0.47, hy - hd * 0.4, hz + hd * 0.04,
         Math.max(0.75, hd * 0.1), Math.max(0.9, hd * 0.13));

    // ── 五官：錨點在頭心、往正面（−z）找表面再上色 ──
    const fn = Math.ceil(hrz) + 3, hzr = R(hz);
    const ey = R(hy - hd * 0.04);
    for (const g of [-1, 1])
      for (let x = Math.max(1, R(hd * 0.09)); x <= Math.max(1, R(hd * 0.25)); x++)
        paintFrom(v, g * x, ey, hzr, 0, 0, -1, fn, 8);                                            // 垂目的雙眼
    for (let y = R(hy - hd * 0.19); y <= R(hy - hd * 0.09); y++)                                  // 鼻：表面前面再補一格
      for (let z = hzr - fn; z <= hzr; z++) if (v.has(0, y, z)) { v.set(0, y, z - 1, 0); break; }
    const my = R(hy - hd * 0.31);
    for (let x = -R(hd * 0.08); x <= R(hd * 0.08); x++) paintFrom(v, x, my, hzr, 0, 0, -1, fn, 8); // 口
    paintFrom(v, 0, R(hy + hd * 0.06), hzr, 0, 0, -1, fn, 5);                                      // 白毫（兩眉之間）

    // ── 蓮瓣：下排斜靠在蓮座腰上，上排錯開半格、瓣尖翻過座面 ──
    const pn = 16;
    ringOf(v, pn, 1, (vv, ux, uz) =>
      limb(vv, { x: ux * hd * 1.05, y: pH + lH * 0.12, z: uz * hd * 1.05,
                 x1: ux * hd * 1.46, y1: pH + lH * 0.72, z1: uz * hd * 1.46, r: hd * 0.24, r1: hd * 0.15, c: 3 }));
    ringOf(v, pn, 1, (vv, ux, uz) =>
      limb(vv, { x: ux * hd * 1.3, y: pH + lH * 0.55, z: uz * hd * 1.3,
                 x1: ux * hd * 1.74, y1: pH + lH + hd * 0.18, z1: uz * hd * 1.74, r: hd * 0.23, r1: hd * 0.11, c: 5 }),
      0, 0, Math.PI / pn);

    // ── 座前一對石獅（面朝正面 −z） ──
    for (const g of [-1, 1]) {
      const lx = g * hd * 1.15, lz = -(pR + hd * 0.4), lb = Math.max(1, R(hd * 0.12));
      v.box(lx, 0, lz, dim(s, 0.5, 3, true), lb, dim(s, 0.62, 3), 6);                                                      // 獅座
      blob(v, lx, lb + hd * 0.25, lz + hd * 0.08, Math.max(1.5, hd * 0.19), Math.max(1.6, hd * 0.26), Math.max(1.6, hd * 0.24), 7);  // 坐著的身體
      blob(v, lx, lb + hd * 0.6, lz + hd * 0.02, Math.max(1.8, hd * 0.24), Math.max(1.8, hd * 0.22), Math.max(1.6, hd * 0.18), 6);   // 鬃毛
      blob(v, lx, lb + hd * 0.6, lz - hd * 0.07, Math.max(1.5, hd * 0.17), Math.max(1.5, hd * 0.16), Math.max(1.5, hd * 0.16), 7);   // 臉
      for (const k of [-1, 1])
        limb(v, { x: lx + k * hd * 0.09, y: lb + hd * 0.4, z: lz - hd * 0.1, x1: lx + k * hd * 0.09, y1: lb, z1: lz - hd * 0.18,
                  r: Math.max(0.75, hd * 0.07), c: 7 });                                                                   // 前腳撐地
    }
  }
});
