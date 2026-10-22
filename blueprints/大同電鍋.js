// 檔名：大同電鍋.js
// v1.318.0 盲測第十回：子 agent 只拿〈藍圖製作說明〉、從零做出來的第二版（看過一次報告＋9000 四視圖），原樣收進來（只改了 name 與檔名那一行；見 開發筆記〈盲測第十回：新增艋舺龍山寺、白川鄉合掌屋、法國聖米歇爾山、杜拜帆船飯店、大同電鍋（v1.318.0）〉）
// 正面：直筒圓鍋身（經典綠烤漆），頂上一圈不鏽鋼口緣、扣一頂不鏽鋼圓頂蓋、蓋頂一顆黑色蓋鈕；
//       鍋身兩側近頂端各一支黑色把手往外伸；正面下方一塊不鏽鋼開關面板，上面一顆紅色圓指示燈、下面一支往前伸的黑色開關桿
// 側面：一樣是直筒；把手從側面看是一條橫的黑色長條，開關桿從正面往前凸出一小截
// 三樣識別物：①綠色直筒鍋身＋不鏽鋼圓頂蓋（上銀下綠） ②兩側黑色把手 ③正面下方的開關桿＋紅色指示燈
// 比例表（實物，11 人份）：全高 29.5 cm、鍋身直徑 26.5、含把手全寬 34.8；
//   高度分配：底座 1.5、鍋身 19、口緣 1、鍋蓋 6、蓋鈕 3（第二版鍋蓋 5→6，圓頂才拱得起來）
//   把手每側伸出 4.2、高 2.5、前後長 10；開關面板寬 6；開關桿寬 4、伸出 2.5；指示燈放大成直徑 5 格的圓
// 輪廓寬度（正面，以鍋身直徑 ＝ 1）：底座 0.93／鍋身 1.00／把手那一段連把手 1.31／口緣 1.06／鍋蓋半高 0.80／蓋鈕 0.24
// 部件尺寸（9000 塊 s ＝ 15.35（第一版報告）；s 就是鍋身半徑幾格，1 cm ≈ s/13.25 格）：
//   鍋身直徑 31 格、鍋身高 22、底座 2、口緣 1、鍋蓋 7、蓋鈕高 4 寬 7
//   把手伸出 5、高 3、長 12；開關面板 7×12；開關桿寬 5、伸出 3；指示燈直徑 5（21 格的圓）；銘牌 9×2
// 部件：底座(cyl 中空) 鍋身(cyl 中空＋顏色函式) 口緣(cyl 環) 鍋蓋(revolve) 蓋鈕(revolve) 把手(plate 'xz')
//       開關面板(box) 開關溝槽(tint) 開關桿(box) 指示燈(set，貼在平的面板上) 銘牌(paintFrom)
customBlueprint({
  name: '大同電鍋',
  pal: ['#5fa882',   // 0 經典綠烤漆（亮度 0.52）
        '#42855f',   // 1 綠的陰影：鍋身最底那一兩圈（0.39）
        '#bcc0c4',   // 2 不鏽鋼：口緣、鍋蓋、開關面板、銘牌（0.75）
        '#878d93',   // 3 不鏽鋼陰影：鍋蓋最下緣（0.55）
        '#2b2b2e',   // 4 黑色電木：底座、把手、蓋鈕、開關桿（0.17）
        '#d8342a'],  // 5 紅色指示燈
  lo: 2.5, hi: 24,

  gen(v, s) {
    const R = Math.max(2.5, s);                 // 鍋身半徑（不取整，cyl 吃小數）
    const baseH = dim(s, 0.11, 1);              // 底座 1.5 cm
    const bodyH = dim(s, 1.43, 11);             // 鍋身 19 cm（下限要塞得下開關面板）
    const rimH  = dim(s, 0.075, 1);             // 口緣 1 cm
    const lidH  = dim(s, 0.45, 2);              // 鍋蓋 6 cm
    const knobH = dim(s, 0.25, 2);              // 蓋鈕 3 cm
    const bodyY = baseH;                        // 上下疊的一律從下面那件的頂面算
    const rimY  = bodyY + bodyH;
    const lidY  = rimY + rimH;
    const knobY = lidY + lidH;
    const zf = -Math.floor(R + 0.35);           // 鍋身正面最前面那一格的 z（x = 0 那一排）

    // ── 主量體 ──
    v.cyl(0, 0, 0, R - 1, baseH, 4, 2);                                  // 底座：黑色，縮一圈
    const shH = dim(s, 0.1, 1);
    v.cyl(0, bodyY, 0, R, bodyH, (x, y, z) => (y < bodyY + shH ? 1 : 0), 2);  // 鍋身：中空直筒，最底一兩圈陰影綠
    v.cyl(0, rimY, 0, R + 0.8, rimH, 2, 2);                              // 口緣：不鏽鋼一圈，比鍋身寬一格

    // ── 鍋蓋與蓋鈕：鍋蓋剖面照球冠拱起來，每層收的格數比第一版平均 ──
    const lt = lidH - 1;
    revolve(v, { x: 0, y: lidY, z: 0, c: (x, y, z) => (y === lidY ? 3 : 2),
                 prof: [[R + 0.3, 0], [R * 0.95, lt * 0.2], [R * 0.86, lt * 0.42],
                        [R * 0.72, lt * 0.64], [R * 0.52, lt * 0.84], [R * 0.3, lt]] });
    const kr = Math.max(1.5, s * 0.21), kt = knobH - 1;
    revolve(v, { x: 0, y: knobY, z: 0, c: 4,                              // 蓋鈕：短頸＋圓盤
                 prof: [[kr * 0.62, 0], [kr * 0.55, kt * 0.3], [kr, kt * 0.65], [kr * 0.8, kt]] });

    // ── 兩側把手：俯視是一個ㄇ字，兩支腳插進鍋身、外面一條橫桿（第二版變薄一格）──
    const P = dim(s, 0.31, 2), hh = dim(s, 0.19, 2), hz = dim(s, 0.75, 3) / 2;
    const hTop = rimY - 1 - dim(s, 0.06, 1);
    const xa = Math.sqrt(Math.max(0, R * R - hz * hz)) - 1;   // 腳從鍋壁裡面長出來
    const xb = R + P - 1;                                       // 橫桿中心（帶子 3 格寬，外緣 = R + P）
    const hat = hTop - Math.floor(hh / 2);
    mirrorX(v, 1, (vv, sg) => plate(vv, { plane: 'xz', at: hat, t: hh, w: 2.4, c: 4,
      pts: [[sg * xa, -hz], [sg * xb, -hz], [sg * xb, hz], [sg * xa, hz]] }));

    // ── 正面下方：開關面板、溝槽、開關桿、指示燈 ──
    const pw = dim(s, 0.45, 5, true);
    const pb = bodyY + dim(s, 0.12, 1);
    const ph0 = dim(s, 0.68, 7);
    const leverY = pb + 3;                                      // 桿子下面留兩格溝，看得出是往下壓的
    const lh = dim(s, 0.1, 1);
    const lr = s >= 14.5 ? 2 : 1.5, lrI = Math.floor(lr + 0.35);  // 燈：大的時候 21 格的圓，小的時候 3×3
    const ph = Math.max(ph0, (leverY - pb) + lh + 2 * lrI + 3);
    v.box(0, pb, zf, pw, ph, 3, 2);                             // 不鏽鋼面板，凸出鍋身 1 格
    const lw = dim(s, 0.3, 3, true), lp = dim(s, 0.19, 2);
    const sw = Math.max(1, lw - 2);
    for (let x = -(sw - 1) / 2; x <= (sw - 1) / 2; x++)         // 開關桿往下壓走的那條溝
      for (let y = pb + 1; y < leverY; y++) tint(v, x, y, zf - 1, 4);
    const za = zf - 1 - lp, zb = zf - 2;
    v.box(0, leverY, (za + zb) / 2, lw, lh, lp, 4);             // 開關桿：往前伸
    const ly = pb + ph - 2 - lrI;                               // 指示燈在面板上半
    for (let i = -lrI; i <= lrI; i++) for (let j = -lrI; j <= lrI; j++)
      if (Math.hypot(i, j) <= lr + 0.35) v.set(i, ly + j, zf - 2, 5);

    // ── 銘牌：鍋身正面上半一條不鏽鋼小牌（第二版拿掉中間的紅點，免得像第二顆燈）──
    const lbw = dim(s, 0.55, 5, true), lbh = dim(s, 0.13, 2);
    const lbY = Math.max(pb + ph + 2, bodyY + Math.round(bodyH * 0.68));
    if (lbY + lbh <= rimY - 1)
      for (let x = -(lbw - 1) / 2; x <= (lbw - 1) / 2; x++)
        for (let y = lbY; y < lbY + lbh; y++)
          paintFrom(v, x, y, 0, 0, 0, -1, Math.ceil(R) + 2, 2);
  }
});
