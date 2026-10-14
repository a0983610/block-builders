// 檔名：台灣黑熊.js
// v1.264.0：子 agent 只拿〈藍圖製作說明〉、看不到程式碼做出來的第三版（見 開發筆記〈prompt 拿去盲測（v1.264.0）〉）
// 正面：直立的黑色身影，下寬上窄的梨形身軀、兩條粗短腿微張；前肢舉在胸前、熊掌下垂；大圓頭坐在一圈蓬毛上、頂著兩隻大圓耳；胸口一道米白 V 字
// 側面：身體微微前傾、肚子往前鼓，頭往前探，淺褐色口鼻再往前凸；屁股後面一截小短尾；後腳掌平貼地面、腳尖朝前（−z）
// 三樣識別物：胸前米白 V 字（月牙）、全身黑毛配淺褐色口鼻、兩隻大圓耳
// 部件：後腳掌×2 後腳爪 大腿×2 小腿×2（limb）／臀腹 胸 肩背 頸部蓬毛（毛球）／小尾巴
//       胸前 V 字（paintFrom）／上臂×2 前臂×2（limb） 前掌×2 前爪×6（limb）
//       頭（毛球） 口鼻 鼻頭 嘴線 眼睛 耳朵×2
// v2：黑毛三階全部壓暗、拉近；脖子加粗成一圈蓬毛；頭與耳朵放大；爪子改暗、改細；V 字放大
// v3：耳朵改圓（半徑 2 左右的球會點陣化成十字、正面看像小角）；爪子再壓暗；V 字提亮；口鼻補嘴線
customBlueprint({
  name: '台灣黑熊',
  pal: ['#221e1d',   // 0 黑毛（本色）
        '#1a1716',   // 1 黑毛（陰影：四肢）
        '#2f2927',   // 2 黑毛（亮面：毛的光澤，用雜湊撒在身上）
        '#ece2c8',   // 3 胸前 V 字（米白）
        '#a37c55',   // 4 口鼻（淺褐）
        '#0e0c0c',   // 5 鼻頭、嘴線
        '#6b4428',   // 6 眼睛
        '#5e574d'],  // 7 爪子（暗色角質）
  lo: 3, hi: 20,

  gen(v, s) {
    const R = s * 0.5;   // 頭的半徑：整隻唯一的錨，其餘都寫成 R 的倍數（不取整，塊數才會連續變化）
    const rd = Math.round;
    // 固定雜湊：同一格每次算出來都一樣
    const H = (x, y, z) => (((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) >>> 0) % 100;
    // 毛球：實心橢球，一邊蓋一邊用雜湊挑本色／亮面（毛的光澤），不必事後再掃一遍
    const fur = (cx, cy, cz, rx, ry, rz) => {
      for (let y = Math.max(0, Math.floor(cy - ry)); y <= Math.ceil(cy + ry); y++)
        for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++)
          for (let z = Math.floor(cz - rz); z <= Math.ceil(cz + rz); z++) {
            const q = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + ((z - cz) / rz) ** 2;
            if (q <= 1) v.set(x, y, z, H(x, y, z) < 30 ? 2 : 0);
          }
    };

    // ── 後腿：大腿、小腿各一支（膝蓋往前頂），腳掌平貼地面、腳尖朝 −z ──
    for (const sd of [-1, 1]) {
      const hx = sd * 0.95 * R, kx = sd * 1.0 * R, ax = sd * 0.92 * R;
      limb(v, { x: hx, y: 2.7 * R, z: 0.15 * R, x1: kx, y1: 1.4 * R, z1: -0.35 * R,
                r: 0.8 * R, r1: 0.62 * R, c: 1 });                         // 大腿
      limb(v, { x: kx, y: 1.4 * R, z: -0.35 * R, x1: ax, y1: 0.5 * R, z1: 0.05 * R,
                r: 0.6 * R, r1: 0.48 * R, c: 1 });                         // 小腿
      blob(v, ax, 0.3 * R, -0.45 * R, Math.max(1, 0.55 * R), Math.max(1, 0.38 * R),
           Math.max(1.2, 0.95 * R), 1);                                    // 腳掌
      for (const k of [-1, 0, 1])                                          // 腳爪：腳尖那一面點三格
        paintFrom(v, rd(ax + k * 0.3 * R), rd(0.3 * R), rd(-0.45 * R), 0, 0, -1,
                  Math.ceil(0.95 * R) + 2, 7);
    }

    // ── 軀幹：臀腹最寬、胸口收一點、肩背、脖子一圈蓬毛（頭幾乎直接坐在肩上） ──
    fur(0, 3.1 * R, 0.15 * R, 1.6 * R, 1.5 * R, 1.35 * R);     // 臀腹
    fur(0, 4.75 * R, -0.15 * R, 1.5 * R, 1.5 * R, 1.25 * R);   // 胸腹（微微往前）
    fur(0, 5.9 * R, 0.15 * R, 1.4 * R, 1.0 * R, 1.15 * R);     // 肩背
    fur(0, 6.5 * R, -0.3 * R, 1.25 * R, 0.85 * R, 1.0 * R);    // 頸部蓬毛
    const tr = Math.max(0.8, 0.32 * R);
    blob(v, 0, 3.0 * R, 1.5 * R, tr, tr, tr, 0);               // 小短尾（+z 是背後）

    // ── 胸前 V 字（台灣黑熊的招牌）：月牙形的 V，底尖在胸口中央。先畫，前肢再蓋上去 ──
    const vb = 4.85 * R, vt = 6.0 * R, vw = 1.25 * R, vth = Math.max(1, 0.42 * R);
    for (let x = -rd(vw); x <= rd(vw); x++) {
      const yc = vb + (vt - vb) * Math.pow(Math.abs(x) / vw, 1.2);
      for (let y = rd(yc); y <= rd(yc + vth); y++)
        paintFrom(v, x, y, rd(-0.15 * R), 0, 0, -1, Math.ceil(1.7 * R) + 3, 3);
    }

    // ── 前肢：上臂往外下、前臂往前伸，熊掌下垂，三根爪子往下勾 ──
    for (const sd of [-1, 1]) {
      const sx = sd * 1.2 * R, ex = sd * 1.55 * R, wx = sd * 1.2 * R;
      limb(v, { x: sx, y: 5.75 * R, z: -0.15 * R, x1: ex, y1: 4.55 * R, z1: -0.8 * R,
                r: 0.62 * R, r1: 0.5 * R, c: 1 });                         // 上臂：肩 → 肘
      limb(v, { x: ex, y: 4.55 * R, z: -0.8 * R, x1: wx, y1: 4.35 * R, z1: -1.75 * R,
                r: 0.5 * R, r1: 0.42 * R, c: 1 });                         // 前臂：肘 → 腕
      blob(v, wx, 4.05 * R, -1.95 * R, Math.max(1, 0.5 * R), Math.max(1, 0.55 * R),
           Math.max(1, 0.45 * R), 1);                                      // 前掌（下垂）
      for (const k of [-1, 0, 1])                                          // 前爪
        limb(v, { x: wx + k * 0.3 * R, y: 3.7 * R, z: -2.15 * R,
                  x1: wx + k * 0.32 * R, y1: 3.3 * R, z1: -2.4 * R,
                  r: Math.max(0.5, 0.07 * R), c: 7 });
    }

    // ── 頭：大圓頭、往前探，淺褐色口鼻再往前凸 ──
    const hz = -0.75 * R;
    fur(0, 7.4 * R, hz, 1.1 * R, 0.92 * R, 0.95 * R);                      // 頭
    blob(v, 0, 7.05 * R, -1.62 * R, Math.max(1, 0.55 * R), Math.max(1, 0.44 * R),
         Math.max(1, 0.62 * R), 4);                                        // 口鼻
    // 大圓耳：中心取整數、半徑至少 1.3，點陣化才是圓的（半徑 2 上下會變成十字，正面看像兩支小角）
    const er = Math.max(1.3, 0.56 * R);
    for (const sd of [-1, 1])
      blob(v, sd * rd(0.9 * R), rd(8.05 * R), rd(-0.6 * R), er, er, Math.max(0.6, 0.24 * R), 0);

    // 五官：從頭／口鼻「裡面」往 −z 掃到表面再上色
    const nx = rd(0.2 * R);
    for (let x = -nx; x <= nx; x++)                                        // 鼻頭
      paintFrom(v, x, rd(7.22 * R), rd(-1.62 * R), 0, 0, -1, Math.ceil(0.62 * R) + 2, 5);
    if (R >= 3) {                                                          // 嘴線（太小就不畫，免得整個口鼻變黑）
      const mx = rd(0.18 * R);
      for (let x = -mx; x <= mx; x++)
        paintFrom(v, x, rd(6.78 * R), rd(-1.62 * R), 0, 0, -1, Math.ceil(0.62 * R) + 2, 5);
    }
    for (const sd of [-1, 1])                                              // 眼睛
      paintFrom(v, sd * Math.max(1, rd(0.45 * R)), rd(7.62 * R), rd(hz), 0, 0, -1,
                Math.ceil(R) + 2, 6);
  }
});
