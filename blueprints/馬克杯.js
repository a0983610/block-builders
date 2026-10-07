/* 積木小人 · 匯出的藍圖（經典馬克杯）
   用法二選一：放進 blueprints/ 並把檔名加進 list.js，
   或在遊戲裡按「📥 匯入建築」把整份貼進去。 */

// 檔名：馬克杯.js
// v1.263.0：把手重做成兩端貼在杯壁上的 D 形把手、hi 拉大、白瓷配一階灰與陰影（見 開發筆記〈自訂藍圖調整一輪（v1.263.0）〉）
customBlueprint({
  name: '經典馬克杯',
  pal: [
    '#e2ddd2', // 0 陶瓷杯身（暖白釉，受光那半圈）
    '#2d5a7b', // 1 裝飾腰線與杯口一圈（深藍）
    '#b5b0a6', // 2 底座杯托（淺灰石色）
    '#c8c1b4', // 3 釉面一階灰（背光那半圈、杯內底、把手背面）
    '#a59e92', // 4 陰影（杯腳一圈、杯托上貼著杯腳那一圈）
    '#22465f'  // 5 腰線背光那半圈（深藍再暗一階）
  ],
  lo: 2.2, hi: 25.0,

  gen(v, s) {
    const r = dim(s, 0.72, 3);                   // 杯身外半徑
    const h = dim(s, 1.85, 7);                   // 杯身高
    const saucerR = r + dim(s, 0.35, 2);          // 杯托半徑
    const n = Math.ceil(r);
    // 固定雜湊：座標的純函式，同一個 s 每次產出一模一樣
    const hash = (x, y, z) => (((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) >>> 0) % 100;

    /* 下面三段的取格條件照抄 v.cyl（d > R + 0.35 不要、hollow 時 d < R − 1 不要），
       格子跟原本的 v.cyl 一格不差（水的測試吃杯內每層 193 格），只是一邊蓋一邊挑色。 */

    // 1. 底層杯托（最底層）：貼著杯腳那一圈是陰影，其餘灰石色
    const sn = Math.ceil(saucerR);
    for (let i = -sn; i <= sn; i++) for (let k = -sn; k <= sn; k++) {
      const d = Math.hypot(i, k);
      if (d > saucerR + 0.35) continue;
      v.set(i, 0, k, d > r + 0.35 && d <= r + 1.4 ? 4 : 2);
    }

    // 2. 杯底實心底板：杯裡看得到的那片是一階灰，外圈露在杯腳的那一圈是陰影
    for (let i = -n; i <= n; i++) for (let k = -n; k <= n; k++) {
      const d = Math.hypot(i, k);
      if (d > r + 0.35) continue;
      v.set(i, 1, k, d < r - 1 ? 3 : 4);
    }

    // 3. 杯身主體＋4. 杯口一圈（中空圓柱，牆厚 1，內部完全掏空）
    // 5. 杯身裝飾腰線：只塗牆的外側那一格（d ≥ r − 0.7），杯裡看不到藍
    const bandY = 2 + Math.round(h * 0.35);
    const bandH = Math.max(1, Math.round(h * 0.22));
    for (let i = -n; i <= n; i++) for (let k = -n; k <= n; k++) {
      const d = Math.hypot(i, k);
      if (d > r + 0.35 || d < r - 1) continue;
      const out = d >= r - 0.7;
      /* 受光是 +x、−z 那一側（跟內建骰子同一套：右面、正面、頂面受光），
         背光那半圈換一階灰；交界那一段用雜湊打散，不要切出一條直線 */
      const dot = (i - k) / (Math.SQRT2 * d);
      for (let y = 2; y <= 2 + h; y++) {
        const back = dot < -0.35 || (dot < -0.05 && hash(i, y, k) < 50);
        let c = back ? 3 : 0;
        if (y === 2 + h) c = 1;                                   // 杯口一圈深藍
        else if (out && y >= bandY && y < bandY + bandH) c = back ? 5 : 1;
        v.set(i, y, k, c);
      }
    }

    // 6. D 形杯把（+x 側）：立在 xy 平面的一條帶子，上下兩端貼在杯壁外側
    const hw = Math.max(0.8, s * 0.1);               // 帶子半寬（把手粗細）
    const ht = dim(s, 0.2, 1, true);                 // 把手厚度（沿 z，奇數才左右對稱）
    // 兩端貼牆的那一點：帶子內緣剛好落在杯壁最外那一格（x ≥ r），不會伸進杯裡
    const xa = r - 1 + hw + 0.05;
    const reach = r * 0.62;                          // 往外伸多遠
    const hy = 2 + h * 0.52, hr = h * 0.29;          // 把手中心高度、上下半徑
    const pts = [];
    for (let j = 0; j <= 12; j++) {
      const a = Math.PI / 2 - Math.PI * j / 12;      // 從上端繞到下端
      const ca = Math.max(0, Math.cos(a)), sa = Math.sin(a);
      // 次方 < 1：比半個橢圓方一點，是 D 形不是半圓
      pts.push([xa + reach * Math.pow(ca, 0.7), hy + hr * Math.sign(sa) * Math.pow(Math.abs(sa), 0.8)]);
    }
    plate(v, { plane: 'xy', at: 0, t: ht, w: hw * 2, c: 3, pts });                // 整支先塗背光那一階
    if (ht > 1) plate(v, { plane: 'xy', at: -0.5, t: ht - 1, w: hw * 2, c: 0, pts }); // 正面那幾層白釉
  }
});
