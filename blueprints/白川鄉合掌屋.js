// 檔名：白川鄉合掌屋.js
// v1.318.0 盲測第十回：子 agent 只拿〈藍圖製作說明〉、從零做出來的第二版（看過一次報告＋9000 四視圖），原樣收進來（只改了 name 與檔名那一行；見 開發筆記〈盲測第十回：新增艋舺龍山寺、白川鄉合掌屋、法國聖米歇爾山、杜拜帆船飯店、大同電鍋（v1.318.0）〉）
// 正面（−z，山牆那一頭）：一個又陡又高的 60° 茅草三角，外圈是一道厚厚的茅草切口（底下兩角是垂直切齊的厚簷），
//   裡面縮進去一片深色木板山牆，白色障子一層一層往上 5 扇／3 扇／1 扇／頂上一格氣窗；三角底下是矮矮的一樓木牆、中間一扇木板門。
// 側面（+x）：長長一片 60° 茅草屋面從屋脊斜到簷口，簷口是一道 3 層厚的切口、出簷蓋住一樓；一樓一排障子、靠前一扇出入口；最前面一小塊水田。
// 三樣識別物：① 60° 又陡又厚的茅草三角大屋頂（合掌）② 山牆面一層層的白色障子 ③ 屋前的水田（低低的田埂、映著天光的水面、一點一點的稻苗）
// 比例表（實物）：和田家 主屋桁行 12 間 ≈ 22 m（沿 z）、梁間 7 間 ≈ 13 m（沿 x）；屋面約 60°；
//   一樓牆高 ≈ 2.6 m、長邊出簷 ≈ 1.3 m、山牆面出簷 ≈ 1.2 m（一般認識）；茅草厚約 1 m（查不到，切口做成約 1.4 m，誇張一點才看得出厚）；
//   屋頂底寬（含出簷）≈ 15.6 m → 60° 屋頂高 ≈ 13 m＋簷口厚；全高 ≈ 16～17 m（寬:高 ≈ 1:1.1）；屋架每層樓高 ≈ 2.8 m；
//   水田 ≈ 8 m × 5 m，離屋簷 ≈ 1.4 m；田埂只比水面高一點點
// 輪廓寬度（正面，以屋頂底寬 ＝ 1）：一樓 0.82／屋頂底（簷口那 3 層）1.00／屋頂 1/4 高 0.76／1/2 高 0.52／3/4 高 0.27／屋脊 3 格（≈0.09）
//   第一版實測（10000 那一階）：一樓 29、屋頂底 35（0.83），三角形由下往上 36→30→24→18→12→6，跟表一致
// 部件尺寸（第一版報告：9000 塊 s = 8.36；這版加厚簷口，估 s ≈ 8.15）：一樓寬 27、長 45、牆高 5；
//   出簷 eo=dim(s,0.32,2)=3、go=dim(s,0.3,2)=2；簷口 3 層、屋頂 29 層、屋脊 1 層 → 全高 36、屋頂底寬 33；
//   茅草切口厚 3、屋面厚 2、簷口 4；樓高 6；障子 3 寬 × 4 高、柱 1 格 → 二樓 5 扇、三樓 3 扇、四樓 1 扇、頂上 1×2 氣窗；
//   水田 17 × 11、稻苗 7 × 4 叢（每叢 1 格，間隔 2）
// 部件：石砌基座(walls) 一樓木牆＋障子＋門(walls＋顏色函式) 腰庇(box) 茅草屋面／厚簷口／山牆切口(逐層 box＋顏色函式)
//   山牆木板＋樓板樑＋障子＋氣窗(逐層 box＋顏色函式) 屋脊(box) 田埂(walls) 水面(box) 稻苗(rowOf 兩層＝方陣)
customBlueprint({
  name: '白川鄉合掌屋',
  pal: ['#9a7f55',   // 0 茅草本色
        '#846b46',   // 1 茅草雜色（暗一階）
        '#b39a6e',   // 2 茅草切口（山牆面那一圈、簷口）
        '#5e4e38',   // 3 屋脊
        '#5b4030',   // 4 山牆木板
        '#2f241c',   // 5 樑、地檻、門板、腰庇（最深）
        '#e4dfd2',   // 6 障子（白色紙門）
        '#7a5a3e',   // 7 一樓木牆
        '#8b8a84',   // 8 石砌基座
        '#7aa0ad',   // 9 水田水面（映著天光）
        '#5f9a2e',   // 10 稻苗
        '#7a6446'],  // 11 田埂（泥土）
  lo: 1.0, hi: 14,

  gen(v, s) {
    const K = 0.577;                       // 60° 屋面：每往上一層，每邊收 1/tan60 格
    const W  = dim(s, 3.25, 9, true);      // 一樓寬（梁間 13 m）
    const L  = dim(s, 5.5, 13, true);      // 一樓長（桁行 22 m），屋脊沿 z
    const Hw = dim(s, 0.65, 3);            // 一樓牆高 2.6 m
    const eo = dim(s, 0.32, 2);            // 長邊出簷
    const go = dim(s, 0.3, 2);             // 山牆面出簷（茅草切口往前伸多深）
    const ne = dim(s, 0.33, 2);            // 簷口切口有幾層厚（垂直切齊的那一段）
    const tb = dim(s, 0.2, 2);             // 屋面茅草厚（水平量）
    const fb = dim(s, 0.38, 3);            // 山牆面那一圈茅草切口的厚度
    const fl = dim(s, 0.7, 4);             // 屋架每一層樓高
    const ww = dim(s, 0.3, 3, true);       // 障子寬（奇數，左右對稱）
    const HW1 = (W - 1) / 2, zw = (L - 1) / 2;
    const HWr = HW1 + eo, zE = zw + go;    // 屋頂底邊半寬、屋頂兩端的 z
    const yb = 1 + Hw;                     // 屋頂與山牆的第一層 ＝ 一樓牆頂再上一層
    const hoAt = i => i < ne ? HWr : Math.round(HWr - (i - ne + 1) * K);   // 第 i 層屋面外緣半寬
    let NL = 0; while (hoAt(NL) >= 1) NL++;   // 屋頂層數（收到 3 格寬為止）
    const hw = (ww - 1) / 2, step = ww + 1;   // 障子半寬、障子間距（中間 1 格柱）

    // 兩端是整數格的長方片：剛好佔 xa～xb、za～zb
    const bx = (xa, xb, y, za, zb, c) =>
      v.box((xa + xb) / 2, y, (za + zb) / 2, xb - xa + 1, 1, zb - za + 1, c);

    // ── 顏色函式 ──
    const thC = (x, y, z) => {                       // 茅草
      const h = hash100(x, y, z), i = y - yb;
      if (Math.abs(z) === zE || (i < ne && Math.abs(x) === HWr))
        return h < 25 ? 0 : 2;                       // 切口（山牆面那一圈、長邊簷口）
      return h < 28 ? 1 : 0;
    };
    const gC = (x, y, z) => {                        // 山牆：木板、樓板樑、障子
      const i = y - yb, k = Math.floor(i / fl), r = i - k * fl, u = Math.abs(x);
      if (r === 0) return 5;                         // 每一層樓的樓板樑
      const top = fl >= 5 ? fl - 2 : fl - 1;         // 障子最上面那一排
      if (r > top) return 4;
      const uh = hoAt(k * fl + top) - fb - 1;        // 這層最窄那排、切口內側再留 1 格木板
      if (uh >= hw) {
        const j = Math.round(u / step);
        return Math.abs(u - j * step) <= hw && j * step + hw <= uh ? 6 : 4;
      }
      return u === 0 && r <= 2 && hoAt(i) - fb >= 0 ? 6 : 4;   // 塞不下整扇：一格小氣窗
    };
    const u0 = hw + 2;                               // 一樓門旁第一扇障子
    const f1C = (x, y, z) => {                       // 一樓木牆
      const r = y - 1, u = Math.abs(x);
      if (r === 0) return 5;                         // 地檻
      if (r > Hw - 2) return 7;                      // 最上面一排木牆
      if (Math.abs(z) === zw) {                      // 山牆那兩頭
        if (u <= hw) return 5;                       // 中間木板門
        const g = Math.floor((u - u0) / step);
        return u >= u0 && u - u0 - g * step < ww && u0 + g * step + ww - 1 <= HW1 - 2 ? 6 : 7;
      }
      const q = z + zw, q0 = 3, p = ww + 2, g = Math.floor((q - q0) / p);   // 長邊
      const inW = q >= q0 && q - q0 - g * p < ww && q0 + g * p + ww - 1 <= L - 4;
      if (inW && g === 0 && x > 0) return 5;         // +x 那一側靠前的出入口
      return inW ? 6 : 7;
    };

    // ── 台基與一樓 ──
    v.walls(0, 0, 0, W + 2, 1, L + 2, 8, 2);         // 石砌基座
    v.walls(0, 1, 0, W, Hw, L, f1C, 1);              // 一樓木牆（障子、門用顏色函式）
    const pp = Math.min(2, go);                      // 腰庇：一樓與山牆之間的深色雨遮
    bx(-(HW1 - 1), HW1 - 1, yb, -zw - pp, -zw - 1, 5);
    bx(-(HW1 - 1), HW1 - 1, yb, zw + 1, zw + pp, 5);

    // ── 茅草屋頂與山牆（逐層：兩端要開口、縮進一片山牆，boxTaper 的兩端是封死的） ──
    const slope = (ho, t, y, za, zb) => {            // 一層屋面：左右兩條茅草，窄到碰在一起就整條實心
      const xi = ho - t + 1;
      if (xi <= 1) bx(-ho, ho, y, za, zb, thC);
      else { bx(xi, ho, y, za, zb, thC); bx(-ho, -xi, y, za, zb, thC); }
    };
    for (let i = 0; i < NL; i++) {
      const y = yb + i, ho = hoAt(i);
      const t = i < ne ? Math.max(tb, eo + 1) : tb;  // 簷口那幾層一路接回牆頂
      const tE = Math.max(t, fb);
      slope(ho, t, y, -zw, zw);                      // 中段屋面
      slope(ho, tE, y, -zE, -zw - 1);                // 正面出簷段：厚切口
      slope(ho, tE, y, zw + 1, zE);                  // 背面出簷段
      const gw = ho - t;
      if (gw >= 0) {                                 // 山牆（縮在切口後面 go 格）
        bx(-gw, gw, y, -zw, -zw, gC);
        bx(-gw, gw, y, zw, zw, gC);
      }
    }
    bx(-1, 1, yb + NL, -zE, zE, (x, y, z) => (Math.abs(z) === zE ? 2 : 3));   // 屋脊（兩端用切口色，正面看不會像煙囪）

    // ── 屋前水田（偏模型右手邊，不擋大門） ──
    const pw = dim(s, 2.0, 9, true), pd = dim(s, 1.25, 5, true), gp = dim(s, 0.35, 2);
    const rh = dim(s, 0.15, 1);
    const pxa = hw + 2, pxb = pxa + pw - 1;
    const pzb = -zE - gp, pza = pzb - pd + 1;
    const pxc = (pxa + pxb) / 2, pzc = (pza + pzb) / 2;
    v.walls(pxc, 0, pzc, pw, 1, pd, 11, 1);          // 田埂：只有一層，跟水面一樣低
    v.box(pxc, 0, pzc, pw - 2, 1, pd - 2, 9);        // 水面
    rowOf(v, (pd - 3) / 2, 2, (vv, pz) =>            // 稻苗：一叢一叢排成方陣，叢與叢之間看得到水
      rowOf(vv, (pw - 3) / 2, 2, (w2, px) => w2.box(px, 1, pz, 1, rh, 1, 10), pxc), pzc);
  }
});
