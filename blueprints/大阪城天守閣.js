// 檔名：大阪城天守閣.js
// v1.314.0 盲測第八回：子 agent 只拿〈藍圖製作說明〉、從零做出來的第一版（沒有任何回饋），原樣收進來（只改了 name 與檔名那一行；見 開發筆記〈盲測第八回：倫敦大笨鐘、日本姬路城、大阪城天守閣、莫斯科克里姆林塔（v1.314.0）〉）
// 正面：下緩上陡的高石垣（梯形、兩邊微凹）上站著五重天守，一重比一重窄；四重白牆綠瓦，最上一重黑牆配金色伏虎與一圈廻縁，
//       頂上入母屋屋脊兩端立一對金鯱
// 側面：同樣五重收分、深度比寬度淺一點；每重屋簷都有凸出來的破風（側面看是一個個小屋頂的剖面）
// 三樣識別物：①高石垣＋五重白牆綠銅瓦層層收分的塔形輪廓 ②最上層黑牆上的金色伏虎、屋脊兩端的金鯱
//             ③屋簷上三角形的千鳥破風（初重一對、三重一個）與弧形的唐破風（二重）
// 比例表（實物）：天守台石垣高 13.3 m、石垣上 39.4 m、總高 52.7 m（大阪府資料）；外觀五重、內部八階
//   以下憑一般認識估：初重約 29×25 m、最上重約 14×12 m、每重內縮約 2 m、出簷約 2.2 m、
//   白牆每重露出 3.5～5 m、屋面高 2～2.5 m、石垣底比頂每邊寬約 3 m（下緩上陡）
// 輪廓寬度（正面，以石垣底寬 ＝ 1）：石垣底 1.00／石垣頂 0.84／初重簷 0.84／二重簷 0.73／三重簷 0.62／
//   四重簷 0.57／最上層廻縁 0.41／頂簷 0.46／屋脊連金鯱 0.35
// 部件尺寸（9000 塊估 s ≈ 9）：石垣高 dim(s,1.3)=12、初重牆 27×23、最上重 13×11、出簷 2；
//   千鳥破風寬 dim(s,0.8,5,奇)=7 格、高 4 層；唐破風寬 2·dim(s,0.55,3)+1=11 格、拱高 3 層＋破風板 2 層；
//   伏虎 4×3 格、每面兩隻（照實物只有 2 格高，放大）；虎帶高 dim(s,0.42,4)=4；廻縁＋高欄 2 層；
//   金鯱高 dim(s,0.5,4)=5（實物 2.6 m 只有 2 格，放大一倍多）；花頭窗 1×2 金框
// 部件：石垣(boxTaper×2 中空＋天端 walls，hash100 石紋) 白牆四重(walls，頂排陰影色) 窗(windowGrid)
//   屋簷四重(boxTaper 中空、簷口一圈深綠) 簷角金飾(v.set) 千鳥破風(v.gable＋顏色函式) 唐破風(逐欄 v.box)
//   最上重黑牆(walls) 伏虎(tint) 廻縁・高欄(walls) 花頭窗(windowGrid 金) 入母屋頂(boxTaper 下段四坡＋上段兩坡)
//   妻面懸魚(顏色函式) 金鯱(plate 'xy')
customBlueprint({
  name: '大阪城天守閣',
  pal: ['#8f8b83',   // 0 石垣
        '#77736b',   // 1 石垣（暗）
        '#a7a399',   // 2 石垣（亮）、天端
        '#e3e1d9',   // 3 白漆喰牆
        '#a9a79f',   // 4 簷下陰影
        '#5f9c86',   // 5 綠銅瓦
        '#335a4c',   // 6 深綠：簷口、破風板、屋脊
        '#373c3b',   // 7 窗
        '#232229',   // 8 最上重黑牆
        '#d4a73c',   // 9 金
        '#8a4630'],  // 10 高欄（暗朱）
  lo: 1.5, hi: 16,

  gen(v, s) {
    const odd = n => (n % 2 ? n : n + 1);
    // ---- 尺寸（係數 ≈ 實物公尺 ÷ 10）----
    const BH = dim(s, 1.3, 4);                       // 石垣高 13.3 m
    const mg = dim(s, 0.2, 1);                       // 石垣頂面比初重牆多出來的一圈
    const BB = dim(s, 0.3, 1);                       // 石垣底每邊比頂寬
    const BBu = Math.max(1, Math.round(BB / 3));     // 上段只收三分之一：下緩上陡
    const OH = dim(s, 0.22, 2);                      // 出簷
    const cW = [2.9, 2.5, 2.1, 1.75, 1.45], cD = [2.5, 2.15, 1.8, 1.5, 1.25];
    const W = [], D = [];
    for (let i = 0; i < 5; i++) {
      W[i] = dim(s, cW[i], 5, true);
      D[i] = dim(s, cD[i], 5, true);
      if (i) {                                       // 每重至少內縮 1 格
        W[i] = Math.max(5, Math.min(W[i], W[i - 1] - 2));
        D[i] = Math.max(5, Math.min(D[i], D[i - 1] - 2));
      }
    }
    const H = [dim(s, 0.52, 3), dim(s, 0.42, 3), dim(s, 0.40, 3), dim(s, 0.36, 3)];   // 白牆露出高
    const R = [dim(s, 0.28, 2), dim(s, 0.25, 2), dim(s, 0.24, 2), dim(s, 0.22, 2)];   // 屋面高
    const TB = dim(s, 0.42, 4), TF = dim(s, 0.36, 3);    // 最上重：虎帶、高欄以上
    const RT1 = dim(s, 0.24, 2);                          // 頂層入母屋下段
    const SH = dim(s, 0.5, 4);                            // 金鯱
    const k = Math.max(1, Math.round(s / 10));            // 伏虎圖案放大倍數

    const stone = (x, y, z) => { const h = hash100(x, y, z); return h < 22 ? 1 : h < 34 ? 2 : 0; };
    const eaveC = (w, d, y0) => (x, y, z) =>
      (y === y0 && (Math.abs(x) >= (w - 1) / 2 || Math.abs(z) >= (d - 1) / 2)) ? 6 : 5;
    const goldCorners = (w, d, y0) =>
      corners4(v, (w - 1) / 2, (d - 1) / 2, (vv, x, z) => vv.set(x, y0 + 1, z, 9));
    const grid = (len, per) => {
      let n = Math.max(2, Math.round(len / per));
      let st = Math.max(2, Math.round(len / (n + 0.3)));
      if (n % 2 === 0 && st % 2) st--;
      while (n > 1 && (n - 1) * st + 1 > len - 2) n--;
      return [n, st];
    };
    const windows = (ww, dd, yw, wh, per, c) => {
      const [nx, sx] = grid(ww, per), [nz, sz] = grid(dd, per);
      mirrorZ(v, (dd - 1) / 2, (vv, z) =>
        windowGrid(vv, { x: 0, y: yw, z, cols: nx, rows: 1, stepX: sx, w: 1, h: wh, c }));
      mirrorX(v, (ww - 1) / 2, (vv, x) =>
        windowGrid(vv, { x, y: yw, z: 0, cols: nz, rows: 1, stepX: sz, w: 1, h: wh, c, axis: 'z' }));
    };

    // ---- 台基：天守台石垣（下段收得多、上段收得少 → 扇形勾配）----
    const BW = W[0] + 2 * mg, BD = D[0] + 2 * mg;
    const BHa = Math.max(2, Math.round(BH * 0.45));
    boxTaper(v, { x: 0, y: 0, z: 0, w: BW + 2 * BB, d: BD + 2 * BB,
                  w1: BW + 2 * BBu, d1: BD + 2 * BBu, h: BHa, t: 2, c: stone });
    boxTaper(v, { x: 0, y: BHa, z: 0, w: BW + 2 * BBu, d: BD + 2 * BBu,
                  w1: BW, d1: BD, h: BH - BHa, t: 2, c: stone });
    v.walls(0, BH - 1, 0, BW, 1, BD, 2, mg + 2);     // 天端：頂面一圈亮石，接到初重牆腳

    // ---- 初重～四重：白牆＋窗 ----
    const yt = [];
    let y = BH;
    for (let i = 0; i < 4; i++) {
      const yv = y + (i ? R[i - 1] : 0), top = yv + H[i] - 1;   // 下面被屋簷蓋住的那一段也畫，屋簷才接得上
      v.walls(0, y, 0, W[i], top + 1 - y, D[i], (x, yy, z) => (yy === top ? 4 : 3), 1);
      const wh = Math.min(2, H[i] - 1);
      windows(W[i], D[i], yv + Math.max(0, Math.round((H[i] - 1 - wh) / 2)), wh, 5, 7);
      y = top + 1;
      yt.push(y);                                     // 這一重屋簷的底層
    }

    // ---- 五重：黑牆、伏虎、廻縁高欄、花頭窗 ----
    const yv5 = y + R[3], ybal = yv5 + TB, yt5 = ybal + 1 + TF;
    v.walls(0, y, 0, W[4], yt5 - y, D[4], 8, 1);
    const TIG = ['.X.X', 'XXXX', 'XX.X'];   // 由下往上：腳／身體／頭與翹起的尾巴（第 0 欄是頭，朝中線）
    const ty = yv5 + Math.ceil((TB - 3 * k) / 2);
    const tigers = (half, put) => {
      const tw = 4 * k, A = half - 1;
      if (A < tw) return;
      const st = 1 + Math.ceil((A - tw) / 2);
      for (const sg of [1, -1])
        for (let r = 0; r < 3 * k; r++)
          for (let c = 0; c < tw; c++)
            if (TIG[Math.floor(r / k)][Math.floor(c / k)] === 'X') put(sg * (st + c), ty + r);
    };
    const hx5 = (W[4] - 1) / 2, hz5 = (D[4] - 1) / 2;
    tigers(hx5, (u, yy) => { tint(v, u, yy, -hz5, 9); tint(v, u, yy, hz5, 9); });
    tigers(hz5, (u, yy) => { tint(v, hx5, yy, u, 9); tint(v, -hx5, yy, u, 9); });
    v.walls(0, ybal, 0, W[4] + 2, 1, D[4] + 2, 10, 2);        // 廻縁
    v.walls(0, ybal + 1, 0, W[4] + 2, 1, D[4] + 2, 10, 1);    // 高欄
    windows(W[4], D[4], ybal + 2, Math.max(1, TF - 1), 4.5, 9);   // 金框花頭窗

    // ---- 初重～四重屋簷（綠銅瓦，簷口一圈深綠，四角金飾）----
    for (let i = 0; i < 4; i++) {
      const w = W[i] + 2 * OH, d = D[i] + 2 * OH, w1 = W[i + 1] + 2, d1 = D[i + 1] + 2;
      const sh = Math.max(w - w1, d - d1) / 2 / (R[i] - 1);
      boxTaper(v, { x: 0, y: yt[i], z: 0, w, d, w1, d1, h: R[i],
                    t: Math.max(OH + 1, Math.floor(sh) + 1), c: eaveC(w, d, yt[i]) });
      goldCorners(w, d, yt[i]);
    }

    // ---- 頂層：入母屋（下段四坡、上段兩坡，屋脊沿 x，兩端是山花三角）----
    const wE = W[4] + 2 * OH, dE = D[4] + 2 * OH;
    const wL = Math.max(5, W[4] - 2), dL = Math.max(5, D[4] - 2);
    const shL = Math.max(wE - wL, dE - dL) / 2 / (RT1 - 1);
    boxTaper(v, { x: 0, y: yt5, z: 0, w: wE, d: dE, w1: wL, d1: dL, h: RT1,
                  t: Math.max(OH + 1, Math.floor(shL) + 1), c: eaveC(wE, dE, yt5) });
    goldCorners(wE, dE, yt5);
    const yU = yt5 + RT1, wU = Math.max(3, wL - 2), dU = Math.max(3, dL - 2), hU = (dU + 1) / 2;
    const xe = (wU - 1) / 2;
    boxTaper(v, { x: 0, y: yU, z: 0, w: wU, d: dU, w1: wU, d1: 1, h: hU, t: 2,
      c: (x, yy, z) => {
        const j = yy - yU;
        if (j === hU - 1) return 6;                         // 屋脊
        if (Math.abs(x) !== xe) return 5;
        if (Math.abs(z) >= (dU - 1) / 2 - j) return 6;      // 妻面的破風板
        if (z === 0 && j >= hU - 3) return 9;               // 懸魚
        return 3;                                           // 妻面白壁
      } });

    // ---- 破風：初重正背面一對千鳥破風、兩側各一；二重四面唐破風；三重四面千鳥破風 ----
    const chidori = (w, cx, y0, zf, wd, dd) => {             // 正面朝 −z 的三角形破風，面在 z = zf
      const jt = (wd - 1) / 2;
      w.gable(cx, y0, zf + (dd - 1) / 2, wd, dd, (x, yy, z) => {
        const j = yy - y0;
        if (z !== zf) return j === jt ? 6 : 5;
        if (Math.abs(x - cx) >= jt - j) return 6;           // 破風板
        if (x === cx && j >= jt - 2) return 9;              // 懸魚
        return 3;
      });
    };
    const kara = (w, cx, y0, zf, a, kr, dd) => {             // 弧形唐破風：中間鼓起、兩端反翹拉平
      const e = Math.exp(-2.8);
      for (let dx = -a; dx <= a; dx++) {
        const u = dx / a;
        const f = Math.round(kr * (Math.exp(-2.8 * u * u) - e) / (1 - e));
        const top = y0 + f + 1;
        w.box(cx + dx, y0, zf + (dd - 1) / 2, 1, f + 2, dd, (x, yy, z) => {
          if (z !== zf) return 5;
          if (yy >= top - 1) return dx === 0 && yy === top - 1 ? 9 : 6;   // 弧形破風板，正中一點金
          if (dx === 0 && yy === top - 2) return 9;                        // 懸魚
          return 3;
        });
      }
    };
    const wC1 = dim(s, 0.8, 5, true), wC3 = dim(s, 0.7, 5, true);
    const ka = dim(s, 0.55, 3), kr = dim(s, 0.3, 2);
    for (let i = 0; i < 3; i++) {
      const y0 = yt[i] + 1;
      for (const [rot, side] of [[0, false], [180, false], [90, true], [-90, true]]) {
        const hw = ((side ? W[i] : D[i]) - 1) / 2;           // 這一重牆面到中心
        const hn = ((side ? W[i + 1] : D[i + 1]) - 1) / 2;   // 上一重牆面到中心
        const span = side ? D[i] : W[i];
        const zf = -(hw + OH) + 1;
        const dd = odd(hw + OH - hn + 1);                    // 一路伸進上一重的牆裡
        const draw = w => {
          if (i === 1) kara(w, 0, y0, zf, Math.min(ka, (span - 1) / 2), kr, dd);
          else if (i === 0 && !side && span >= 2 * wC1 + 5) {
            const px = Math.round(span / 4);
            chidori(w, px, y0, zf, wC1, dd);
            chidori(w, -px, y0, zf, wC1, dd);
          } else chidori(w, 0, y0, zf, i === 0 ? wC1 : wC3, dd);
        };
        if (rot) stampY(v, rot, draw); else draw(v);
      }
    }

    // ---- 金鯱：屋脊兩端，頭咬屋脊、身體往外鼓、尾巴往上翹向內 ----
    const yr = yU + hU;
    mirrorX(v, 1, (vv, sg) => plate(vv, { plane: 'xy', at: 0, t: 3, w: 2.2, c: 9, pts: [
      [sg * xe, yr], [sg * (xe + SH * 0.22), yr + SH * 0.4],
      [sg * (xe + SH * 0.05), yr + SH * 0.75], [sg * (xe - SH * 0.3), yr + SH * 0.95]] }));
  }
});
