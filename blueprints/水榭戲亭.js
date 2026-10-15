// 檔名：水榭戲亭.js
// v1.288.0 盲測第四回：子 agent 只拿〈藍圖製作說明〉、從零做出來的第二版（看過一次報告＋9000 四視圖），原樣收進來（只改了 name 與檔名那一行；見 開發筆記〈盲測第四回：清水寺、御手洗糰子、水榭戲亭（v1.288.0）〉）
// 正面：一條石砌池岸橫過整個底部，中央一座方形戲台站在水裡——石台基＋木台面、左右兩根紅柱框住開敞的台口，
//       白色後牆上兩扇深色門（出將／入相），柱頂一道金色額枋＋雀替＋匾額；上面是歇山頂：簷口四個角往上翹、正脊兩端燕尾上捲
// 側面：同樣的翹角屋頂，上段看得到白色山花三角，正脊兩端的燕尾分叉成 V 形；戲台背後一座石平橋＋踏階接回池岸；左後角一座假山
// 三樣識別物：①四角上翹的歇山頂（簷口起翹＋翼角＋燕尾正脊）②蓋在方池中央的戲台（四周一圈深綠水面、石砌池岸）
//            ③開敞的台口（紅柱、金額枋、雀替、白後牆上的出將入相兩門）
// 比例表（查不到實測尺寸，照一般閩南園林水榭戲亭估）：台面約 5 m 見方、台面高出水面約 0.8 m、柱高約 2.8 m、
//        額枋約 0.5 m、出簷（超出台面）約 0.7 m、屋頂（簷口到正脊）約 2.8 m、燕尾再翹 0.6 m；
//        水池寬約台面的 2 倍，前方水面最寬（戲台面向方鑑齋）、後方最窄（接橋）
// 輪廓寬度（正面，以池岸全寬 ＝ 1；v1 報告 10000 那一階實測 61 格）：
//        池岸：1.00／台基：0.48／柱外緣：0.44／簷口：0.61、翹角尖：0.67／上段山牆：0.31／正脊＋燕尾尖：0.54
// 部件尺寸（v1 報告：9000 塊 s ＝ 12.95）：台面 27；台基 4 層；柱高 16、柱粗 2；額枋 dim(s,0.22,2)=3；簷寬 35；
//        緩坡 5 層；上段 17 寬 9 層；簷口抬起 4、翼角再外伸 2 上翹 2；燕尾外伸 4 上翹 3、分叉 ±1.6；
//        門 3×7；匾額 7×4；雀替 dim(s,0.25,1)=3 格；水面：兩側 13、前 16、後 10；石橋寬 5；荷葉半徑 2.6
// 部件：池岸(walls) 水面(box，靠岸一圈陰影色) 台基(walls+carve，石色 hash) 台面(box) 柱(box×4)＋柱珠(box)
//       額枋(walls t=1) 雀替(set 三角) 匾額(box) 後牆(box，裙堵用顏色函式) 出將入相兩門＋門楣(box) 側欄杆(rowOf+box)
//       天花環(walls) 下段緩坡(boxTaper t=3) 上段歇山(boxTaper 只收深度 t=2，山花顏色函式) 懸魚(tint) 正脊(box)
//       燕尾(limb 兩股分叉) 簷口起翹(plate 'xy'／'zy') 戧脊與翼角(limb) 石平橋(box)＋踏階(stairs)＋橋欄(box)
//       假山(blob shell＋尖石 blob) 荷葉(blob ry 0.5) 荷花苞(box)
customBlueprint({
  name: '水榭戲亭',
  pal: ['#2f5d55',   // 0 池水（深綠）
        '#9a958a',   // 1 石（池岸、台基、橋、柱珠）
        '#6f6a60',   // 2 石（深一階：雜色、橋欄）
        '#6b4428',   // 3 木台面
        '#a33226',   // 4 紅柱、欄杆
        '#dab45c',   // 5 金色額枋、雀替、門楣、懸魚
        '#e2dccd',   // 6 白灰牆、山花
        '#45494d',   // 7 屋瓦
        '#bdbcb4',   // 8 正脊、簷口、戧脊、翼角、燕尾
        '#a39d90',   // 9 牆腳裙堵（白牆的陰影階）
        '#8fb850',   // 10 荷葉
        '#6e665a',   // 11 假山
        '#e07a9a',   // 12 荷花苞
        '#3a2a22',   // 13 門、匾額、假山石縫
        '#22433d'],  // 14 靠池岸那一圈水面的陰影
  lo: 2, hi: 22,

  gen(v, s) {
    // ---- 戲台與屋頂的尺寸 ----
    const B   = dim(s, 2.1, 9, true);     // 台面寬＝深（奇數）
    const hB  = (B - 1) / 2;              // 台面半寬
    const cx  = hB - 1;                   // 柱子外緣（比台面內縮 1 格）
    const cw  = dim(s, 0.13, 1);          // 柱粗
    const cc  = cx - (cw - 1) / 2;        // 柱中心（偶數粗時落在兩格中間，剛好佔 cx-cw+1～cx）
    const ci  = cx - cw;                  // 柱子內側第一格
    const Hp  = dim(s, 0.3, 2);           // 台基層數（y=0 是水面那層）
    const Hc  = dim(s, 1.2, 5);           // 柱高
    const hb  = dim(s, 0.22, 2);          // 額枋高（v1 的 2 層被出簷擋掉，加到 3 層）
    const ov  = dim(s, 0.35, 2);          // 出簷
    const h1  = dim(s, 0.36, 2);          // 下段緩坡層數
    const We  = B + 2 * (ov - 1);         // 簷口外緣寬（奇數）
    const X   = (We - 1) / 2;
    const Wm  = We - 4 * (h1 - 1);        // 緩坡頂寬：每層每邊收 2 格
    const wz  = Wm - 2;                   // 上段寬＝深（奇數）
    const eg  = (wz - 1) / 2;             // 山花所在的 x
    const hu  = (wz + 1) / 2;             // 上段層數（45°）
    const yct = Hp + 1 + Hc;              // 柱頂上面那一層
    const yb  = yct - hb;                 // 額枋底
    const yg  = yct + h1;                 // 上段底
    const yr  = yg + hu - 1;              // 正脊底

    // ---- 方池：深綠水面（靠岸一圈陰影）＋石砌池岸（戲台在原點，前方水面最寬） ----
    const gS = dim(s, 1.0, 4), gF = dim(s, 1.2, 5), gB = dim(s, 0.8, 4), cw2 = dim(s, 0.18, 1);
    const xIn = hB + gS, zF = -(hB + gF), zB = hB + gB, zc = (zF + zB) / 2;
    const stone = (x, y, z) => (hash100(x, y, z) < 22 ? 2 : 1);
    v.box(0, 0, zc, 2 * xIn + 1, 1, zB - zF + 1,
          (x, y, z) => (Math.abs(x) === xIn || z === zF || z === zB ? 14 : 0));
    v.walls(0, 0, zc, 2 * (xIn + cw2) + 1, 2, zB - zF + 1 + 2 * cw2, stone, cw2);

    // ---- 台基、台面 ----
    v.walls(0, 0, 0, B, Hp, B, stone, 2);
    v.carve(0, 0, 0, B - 4, Hp, B - 4);
    v.box(0, Hp, 0, B, 1, B, 3);

    // ---- 額枋（先畫，柱子再穿過去） ----
    v.walls(0, yb, 0, 2 * cx + 1, hb, 2 * cx + 1, 5, 1);

    // ---- 後牆＋出將入相兩門 ----
    const wallH = Hc - hb, dado = dim(s, 0.15, 1);
    v.box(0, Hp + 1, cx, 2 * ci + 1, wallH, 1, (x, y, z) => (y <= Hp + dado ? 9 : 6));
    const dw = dim(s, 0.25, 1, true);
    const dh = Math.min(dim(s, 0.55, 3), wallH - 2);
    const dxD = ci - 1 - (dw - 1) / 2;
    mirrorX(v, dxD, (vv, dx) => {
      vv.box(dx, Hp + 1, cx, dw, dh, 1, 13);
      vv.box(dx, Hp + 1 + dh, cx, dw + 2, 1, 1, 5);
    });

    // ---- 四根紅柱＋柱珠 ----
    corners4(v, cc, cc, (vv, x, z) => {
      vv.box(x, Hp + 1, z, cw, 1, cw, 1);
      vv.box(x, Hp + 2, z, cw, Hc - 1, cw, 4);
    });

    // ---- 匾額、雀替 ----
    v.box(0, yb - 1, -cx, dim(s, 0.45, 3, true), hb + 1, 1, 13);
    const q = dim(s, 0.25, 1);
    const bracket = (x0, z0, ddx, ddz) => {
      for (let j = 0; j < q; j++)
        for (let i = 0; i < q - j; i++) v.set(x0 + ddx * i, yb - 1 - j, z0 + ddz * i, 5);
    };
    mirrorX(v, 1, (vv, sg) => {
      bracket(sg * ci, -cx, -sg, 0);      // 台口
      bracket(sg * cx, -ci, 0, 1);        // 側面靠前柱
      bracket(sg * cx, ci, 0, -1);        // 側面靠後柱
    });

    // ---- 左右兩側欄杆（台口正面不設） ----
    const rh = dim(s, 0.22, 2), ps = 3;
    const np = 2 * Math.floor(ci / ps) + 1;
    mirrorX(v, cx, (vv, x) => {
      vv.box(x, Hp + rh, 0, 1, 1, 2 * ci + 1, 4);
      rowOf(vv, np, ps, (w, z) => w.box(x, Hp + 1, Math.round(z), 1, rh - 1, 1, 4), 0);
    });

    // ---- 屋頂：天花環 → 下段緩坡 → 上段歇山 ----
    v.walls(0, yct, 0, We - 4, 1, We - 4, 7, ov - 1);
    boxTaper(v, { x: 0, y: yct, z: 0, w: We, d: We, w1: Wm, d1: Wm, h: h1, t: 3, c: 7 });
    boxTaper(v, { x: 0, y: yg, z: 0, w: wz, d: wz, w1: wz, d1: 1, h: hu, t: 2,
                  c: (x, y, z) => (Math.abs(x) === eg && Math.abs(z) < eg - (y - yg) ? 6 : 7) });
    const fish = dim(s, 0.2, 1);                                       // 懸魚
    mirrorX(v, eg, (vv, x) => { for (let i = 1; i <= fish; i++) tint(vv, x, yr - i, 0, 5); });

    // 正脊＋燕尾：每一端分成前後兩股往外上捲（正面看是一道上捲，側面看是 V 形，不再像一根煙囪）
    v.box(0, yr, 0, wz + 2, 2, 3, 8);
    const tl = dim(s, 0.32, 2), tr = dim(s, 0.25, 2), re = eg + 1;
    corners4(v, 1, 1, (vv, sg, sz) => {
      limb(vv, { x: sg * (re - 1), y: yr + 1, z: 0,
                 x1: sg * (re + tl * 0.55), y1: yr + 1.3, z1: sz * 0.6, r: 0.8, c: 8 });
      limb(vv, { x: sg * (re + tl * 0.55), y: yr + 1.3, z: sz * 0.6,
                 x1: sg * (re + tl), y1: yr + 1 + tr, z1: sz * 1.6, r: 0.8, r1: 0.75, c: 8 });
    });

    // 簷口起翹：四邊各一條往兩端翹起的簷口線
    const L = dim(s, 0.28, 2), k = dim(s, 0.5, 3), kk = Math.max(1, Math.round(k * 0.35));
    const eaveCurve = [[-X, yct + L], [-X + kk, yct + 1 + (L - 1) * 0.45], [-X + k, yct + 1],
                       [X - k, yct + 1], [X - kk, yct + 1 + (L - 1) * 0.45], [X, yct + L]];
    mirrorZ(v, X, (vv, z) => plate(vv, { plane: 'xy', at: z, t: 1, w: 1.5, c: 8, pts: eaveCurve }));
    mirrorX(v, X, (vv, x) => plate(vv, { plane: 'zy', at: x, t: 1, w: 1.5, c: 8, pts: eaveCurve }));

    // 戧脊＋翼角：四個角沿斜脊下來，到簷角往外甩出去再微微上翹（v1 太直立，像鹿角）
    const hm = (Wm - 1) / 2, tipO = dim(s, 0.18, 1), tipR = dim(s, 0.16, 1);
    corners4(v, 1, 1, (vv, sx, sz) => {
      limb(vv, { x: sx * hm, y: yg, z: sz * hm, x1: sx * (X - 1), y1: yct + 1, z1: sz * (X - 1), r: 0.8, c: 8 });
      limb(vv, { x: sx * (X - 1), y: yct + 1, z: sz * (X - 1),
                 x1: sx * (X + 0.5), y1: yct + L, z1: sz * (X + 0.5), r: 1.0, r1: 0.85, c: 8 });
      limb(vv, { x: sx * (X + 0.5), y: yct + L, z: sz * (X + 0.5),
                 x1: sx * (X + 0.5 + tipO), y1: yct + L + tipR, z1: sz * (X + 0.5 + tipO), r: 0.85, r1: 0.75, c: 8 });
    });

    // ---- 戲台背後的石平橋＋踏階 ----
    const bw = dim(s, 0.35, 3, true), n = Hp - 1;
    v.box(0, 1, (hB + 1 + zB) / 2, bw, 1, zB - hB, 1);
    stairs(v, 0, 1, hB + n, n, bw, '-z', 1);
    const rl = zB - (hB + n);
    if (rl > 0) mirrorX(v, (bw - 1) / 2, (vv, x) => vv.box(x, 2, (hB + n + 1 + zB) / 2, 1, 1, rl, 2));

    // ---- 左後角的假山（壓暗，石縫用最深那一色） ----
    const rk = (x, y, z) => { const h = hash100(x, y, z); return h < 15 ? 13 : h < 35 ? 2 : h < 43 ? 1 : 11; };
    const rx0 = -(xIn - Math.round(gS * 0.3)), rz0 = zB - Math.round(gB * 0.25);
    blob(v, rx0, 1, rz0, Math.max(2.3, gS * 0.42), Math.max(2.3, gS * 0.45), Math.max(2.3, gB * 0.5), rk, 2);
    blob(v, rx0 + Math.round(gS * 0.15), 1, rz0 - Math.round(gB * 0.15),
         Math.max(1.6, gS * 0.19), Math.max(3, gS * 0.75), Math.max(1.6, gS * 0.17), rk);
    blob(v, rx0 + Math.round(gS * 0.4), 1, rz0 - Math.round(gB * 0.35),
         Math.max(1.6, gS * 0.2), Math.max(1.6, gS * 0.22), Math.max(1.6, gS * 0.2), rk);

    // ---- 荷葉與荷花苞 ----
    const lr = Math.max(1.6, s * 0.2), bud = dim(s, 0.12, 1);
    [[xIn - gS * 0.3, zF + gF * 0.3, 1], [xIn - gS * 0.62, zF + gF * 0.22, 0],
     [-(xIn - gS * 0.4), zF + gF * 0.35, 1], [xIn - gS * 0.3, zB - gB * 0.4, 0]].forEach(([px, pz, b]) => {
      const x = Math.round(px), z = Math.round(pz);
      blob(v, x, 1, z, lr, 0.5, lr, 10);
      if (b) v.box(x, 2, z, 1, bud, 1, 12);
    });
  }
});
