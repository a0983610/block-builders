// 檔名：倫敦塔橋.js
// v1.319.0 盲測第十一回：子 agent 只拿〈藍圖製作說明〉、從零做出來的第二版（看過一次報告＋9000 四視圖），原樣收進來（只改了 name 與檔名那一行；見 開發筆記〈盲測第十一回：新增倫敦塔橋、泰國鄭王廟、新加坡濱海灣金沙、淡水紅毛城、達摩不倒翁（v1.319.0）〉）
// 正面（−z，從泰晤士河下游看）：左右對稱的兩座哥德式石塔，塔頂四角各一支細尖塔、中間一頂更高的尖屋頂；
//   兩塔上段由藍白格架的高架步道連起來，下段中間兩片橋面往上掀成 V 字；塔外側各一條藍色鋼索往下垂、拉到岸邊的矮塔
// 側面（+x）：岸邊矮塔在最前面、主塔在後面高起，路面從拱門穿進塔裡；頂上看得到前後並排的兩條步道
// 三樣識別物：①兩座四角帶尖塔的石造高塔 ②塔上段兩條藍白格架高架步道 ③中間掀起的開合橋面＋兩側下垂的藍色鋼索
//
// 比例表（實物）：全長 290 m（含岸墩）；主塔高 65 m；兩塔間主跨 61 m；兩側吊橋跨各 82 m；
//   主塔沿橋寬約 21 m（橋墩 70 ft 寬）；高架步道在高潮水面上 44 m；路面約在水面上 10 m、寬 18 m；
//   開合橋兩片各伸出 30 m。石材：下段花崗岩、上段波特蘭石；鋼構漆藍白
//   取捨：主角是塔 → 兩側吊橋縮成 0.55 倍、主跨縮成 0.9 倍；步道高度誇張到約 2 倍（格架才看得見）；
//         塔頂尖帽與中央尖頂也誇張一點（第一版照比例做，正面看是平頂）
//   換算：1 單位 s ＝ 10 m（係數 ＝ 公尺 ÷ 10）
//
// 輪廓寬度（正面，以全長 ＝ 1）：
//   地面（橋墩那層）：兩座主塔墩各 0.13、兩座岸塔各 0.06，中間是空的
//   路面那層：整條連起來 1.00（岸塔 → 吊橋 → 主塔 → 掀起的橋面 → 主塔 → 吊橋 → 岸塔）
//   塔身中段：兩座主塔各 0.13（含角塔），之間是 V 字橋面；外側是往下垂的鋼索
//   步道那層：兩塔＋步道連成一條 0.47（第一版報告實測 52／105）
//   塔頂：兩座主塔各 0.13，每座五根尖（四角細尖、中間最高）
//
// 部件尺寸（第一版報告：9000 塊 s＝4.50，這一版塊數多一點，估 s ≈ 4.4）：
//   主塔 TX=dim(s,2.2,7,奇)=11 × TZ=dim(s,2.6,9,奇)=11～13、塔身到簷口 29 層；主跨 2·dim(s,2.75,6)−1=23；
//   吊橋跨 dim(s,4.5,8)=20；全長約 103 格；步道高 dim(s,1.1,3)=5（上下弦各 1、中間格架 3）、深 3；
//   角塔 3×3、凸出塔面 1 格、高出簷口 3 層；角塔尖帽 dim(s,1.5,3)=7 層；中央尖屋頂 dim(s,1.9,4)=8～9 層＋金頂飾 3；
//   開合橋每片長 11.5、厚 3、掀 40°；鋼索粗 3、最低點離路面 4 格；岸塔 5×11、高 12；窗 1×3、間距 5；拱門洞 7 寬 × 6 高
//
// 部件：
//   台基　　 主塔橋墩(walls t2)、前後破水尖(box 一層層收)、岸塔花崗岩腳(顏色函式)
//   主量體　 主塔塔身(walls 中空)、四角塔(cyl)、岸塔(walls)與岸塔角塔(cyl)、高架步道(box)
//   開口　　 立面長窗(windowGrid)、側面窗(windowGrid axis z)、路面拱門洞(tint 自己照 arch 公式畫)、角塔窄窗(tint)
//   線腳分層 花崗岩下段(顏色函式)、步道那層腰線(walls 一層)、塔頂簷口(box)、步道上下白弦(box)、橋面白欄杆(box)
//   屋頂　　 中央尖屋頂(boxTaper 中空)、角塔尖帽(taper)、屋頂老虎窗(box)、岸塔四坡頂(boxTaper)
//   頂飾附屬 金色頂飾(box/set)、步道藍色格架(lattice)、開合橋面(plate 'xy')、吊橋路面(box)、鋼索(plate 'xy')、吊桿(box)
customBlueprint({
  name: '倫敦塔橋',
  pal: ['#b2a996',   // 0 波特蘭石（塔身主色）
        '#a39a86',   // 1 石材暗一階（雜色）
        '#7a776f',   // 2 花崗岩（橋墩、塔腳、腰線、簷口）
        '#3f4752',   // 3 石板瓦屋頂、尖塔帽
        '#2b323c',   // 4 窗、步道玻璃、拱門洞
        '#346aa8',   // 5 鋼構藍
        '#d6d9dc',   // 6 鋼構白（步道上下弦、欄杆、吊桿）
        '#56585b',   // 7 路面
        '#c9a13b'],  // 8 尖頂金飾
  lo: 1.0, hi: 8,

  gen(v, s) {
    // ── 平面：x 沿橋、z 前後，正面 −z ──
    const TX = dim(s, 2.2, 7, true);                     // 主塔沿橋寬
    const TZ = dim(s, 2.6, 9, true);                     // 主塔前後深
    const DW = Math.min(dim(s, 1.6, 5, true), TZ - 4);   // 路面寬（奇數）
    const hg = dim(s, 2.75, 6);                          // 中線到主塔內側面（主跨 2·hg−1）
    const SL = dim(s, 4.5, 8);                           // 吊橋跨
    const AX = dim(s, 1.2, 5, true);                     // 岸塔沿橋寬
    const AZ = Math.max(dim(s, 2.2, 7, true), DW + 4);   // 岸塔前後深
    const zh = (TZ - 1) / 2, ze = (DW - 1) / 2, azh = (AZ - 1) / 2;
    const xi = hg, xo = hg + TX - 1, cx = hg + (TX - 1) / 2;   // 主塔內側面、外側面、中心
    const ai = hg + TX + SL, ao = ai + AX - 1, ax = ai + (AX - 1) / 2;  // 岸塔

    // ── 高度：每一段從下面那段的頂算 ──
    const ph = dim(s, 0.4, 1);                // 橋墩
    const dk = ph + dim(s, 0.55, 2);          // 路面最上層
    const yw = dk + dim(s, 3.8, 5);           // 步道底
    const wh = dim(s, 1.1, 3);                // 步道高
    const yc = yw + wh + dim(s, 0.6, 1);      // 主塔簷口層
    const tt = yc + 1 + dim(s, 0.6, 2);       // 角塔頂（尖帽從這一層起）
    const rh = dim(s, 1.9, 4);                // 中央尖屋頂
    const sh = dim(s, 1.5, 3);                // 角塔尖帽
    const yA = dk + dim(s, 1.8, 4);           // 岸塔簷口層
    const ash = dim(s, 0.8, 2);               // 岸塔角塔尖帽
    const ww = dim(s, 0.6, 2);                // 步道前後深
    const rt = Math.max(0.9, s * 0.28);       // 主塔角塔半徑
    const rt2 = Math.max(0.9, s * 0.25);      // 岸塔角塔半徑
    const ah = dim(s, 0.5, 1);                // 拱門直柱段

    const stone = (x, y, z) => (hash100(x, y, z) < 20 ? 1 : 0);
    const wallC = (x, y, z) => (y <= dk ? 2 : stone(x, y, z));
    const deckC = (x, y, z) => (Math.abs(z) === ze ? 5 : 7);

    // ── 開合橋面：兩片從塔內側面往中間掀起 40° ──
    const L = hg - 0.5, th = 40 * Math.PI / 180;
    mirrorX(v, 1, (vv, sg) => plate(vv, { plane: 'xy', at: 0, t: DW, w: 2, c: deckC,
      pts: [[sg * (hg - 0.5), dk - 0.5],
            [sg * (hg - 0.5 - L * Math.cos(th)), dk - 0.5 + L * Math.sin(th)]] }));

    // ── 兩側吊橋路面＋白欄杆 ──
    mirrorX(v, 1, (vv, sg) => {
      const xm = sg * (xo + ai) / 2;
      vv.box(xm, dk - 1, 0, SL, 2, DW, deckC);
      mirrorZ(vv, ze, (w, z) => w.box(xm, dk + 1, z, SL, 1, 1, 6));
    });

    // ── 高架步道：前後各一條，深色玻璃＋外側藍色格架＋上下白弦 ──
    const wl = 2 * hg - 1;
    mirrorZ(v, 1, (vv, sz) => {
      const za = sz * zh, zb = sz * (zh - ww + 1), zm = (za + zb) / 2;
      vv.box(0, yw, zm, wl, wh, ww, 4);
      if (wh >= 4) lattice(vv, { x0: -(hg - 1), z0: za, x1: hg - 1, z1: za, y: yw + 1, h: wh - 2,
                                 n: Math.max(3, Math.round((wl - 1) / Math.max(3, wh - 1))), c: 5 });
      vv.box(0, yw, zm, wl, 1, ww, 6);
      vv.box(0, yw + wh - 1, zm, wl, 1, ww, 6);
    });

    // ── 鋼索：從主塔步道那一層垂下來、拉到岸塔簷下（拋物線，最低點離路面 4 格上下）──
    const ym = dk + dim(s, 0.8, 3);
    const cy0 = yw, cy1 = yA - 1;
    const d0 = Math.sqrt(cy0 - ym), d1 = Math.sqrt(Math.max(0.5, cy1 - ym));
    const xv = xo + (ai - xo) * d0 / (d0 + d1);
    const ka = (cy0 - ym) / ((xv - xo) * (xv - xo));
    const fy = x => ym + ka * (x - xv) * (x - xv);
    const np = Math.max(4, Math.round((ai - xo) / 2));
    const pts = [];
    for (let i = 0; i <= np; i++) { const x = xo + (ai - xo) * i / np; pts.push([x, fy(x)]); }
    const hs = dim(s, 0.6, 2);
    mirrorX(v, 1, (vv, sg) => mirrorZ(vv, ze, (w, z) => {
      plate(w, { plane: 'xy', at: z, t: 1, w: 2, c: 5, pts: pts.map(p => [sg * p[0], p[1]]) });
      for (let x = xo + 2; x <= ai - 2; x += hs) {              // 白色吊桿
        const top = Math.round(fy(x)) - 2;
        if (top >= dk + 2) w.box(sg * x, dk + 2, z, 1, top - dk - 1, 1, 6);
      }
    }));

    // ── 主塔 ──
    const tower = (vv, c0) => {
      vv.walls(c0, 0, 0, TX + 2, ph, TZ + 2, 2, 2);                       // 橋墩
      for (let k = 1; TX + 2 - 4 * k >= 3; k++)                           // 前後破水尖
        mirrorZ(vv, zh + 1 + k, (w, z) => w.box(c0, 0, z, TX + 2 - 4 * k, ph, 1, 2));
      vv.walls(c0, ph, 0, TX, yc - ph, TZ, wallC, 1);                     // 塔身（中空）
      vv.walls(c0, yw - 1, 0, TX + 2, 1, TZ + 2, 2, 1);                   // 步道那層的腰線
      vv.box(c0, yc, 0, TX + 2, 1, TZ + 2, 2);                            // 簷口
      corners4(vv, (TX - 1) / 2, zh, (w, x, z) => {                       // 四角塔＋尖帽＋金頂
        if (rt >= 1.9) w.cyl(c0 + x, ph, z, rt, tt - ph, wallC, 1);
        else w.cyl(c0 + x, ph, z, rt, tt - ph, wallC);
        w.taper(c0 + x, tt, z, rt + 0.3, 0.4, sh, 3);
        w.set(c0 + x, tt + sh, z, 8);
      });
      boxTaper(vv, { x: c0, y: yc + 1, z: 0, w: TX - 2, d: TZ - 2, w1: 1, d1: 1, h: rh, c: 3, t: 2 });
      vv.box(c0, yc + 1 + rh, 0, 1, dim(s, 0.6, 2), 1, 8);              // 中央金頂飾
      if (TX >= 9) mirrorZ(vv, (TZ - 3) / 2, (w, z) => {                  // 前後老虎窗
        w.box(c0, yc + 1, z, 3, 2, 1, 0);
        w.set(c0, yc + 3, z, 0);
        tint(w, c0, yc + 1, z, 4);
        tint(w, c0, yc + 2, z, 4);
      });
    };
    mirrorX(v, cx, tower);

    // ── 岸塔 ──
    const abut = (vv, c0) => {
      vv.walls(c0, 0, 0, AX, yA, AZ, wallC, 1);
      vv.box(c0, yA, 0, AX + 2, 1, AZ + 2, 2);
      corners4(vv, (AX - 1) / 2, azh, (w, x, z) => {
        w.cyl(c0 + x, 0, z, rt2, yA + 2, wallC);
        w.taper(c0 + x, yA + 2, z, rt2 + 0.3, 0.4, ash, 3);
        w.set(c0 + x, yA + 2 + ash, z, 8);
      });
      boxTaper(vv, { x: c0, y: yA + 1, z: 0, w: AX, d: AZ, w1: 1, d1: AZ - AX + 1, h: (AX + 1) / 2, c: 3 });
    };
    mirrorX(v, ax, abut);

    // ── 路面穿過的拱門洞（塗深色，照 arch 的公式）──
    const archPaint = (xf, a2) => {
      for (let j = 0; j < a2; j++) for (let z = -ze; z <= ze; z++) tint(v, xf, dk + 1 + j, z, 4);
      for (let j = 0; j <= ze; j++) {
        const hw = Math.round(Math.sqrt(ze * ze - j * j));
        for (let z = -hw; z <= hw; z++) tint(v, xf, dk + 1 + a2 + j, z, 4);
      }
    };
    mirrorX(v, 1, (vv, sg) => {
      archPaint(sg * xi, ah); archPaint(sg * xo, ah);
      archPaint(sg * ai, Math.max(0, ah - 1)); archPaint(sg * ao, Math.max(0, ah - 1));
    });

    // ── 窗（哥德長窗 1×3）──
    const wh2 = dim(s, 0.65, 2), wsy = dim(s, 1.1, 3);
    const wsx = 2 * Math.max(1, Math.round((TX - 1) / 2 * 0.4));
    const lo1 = dk + 2, hi1 = yw - 2;
    const rows = Math.max(1, Math.floor((hi1 - lo1 + 1 + (wsy - wh2)) / wsy));
    const y1 = lo1 + Math.max(0, Math.floor((hi1 - lo1 + 1 - (rows * wsy - (wsy - wh2))) / 2));
    mirrorX(v, cx, (vv, x) => mirrorZ(vv, zh, (w, z) => {               // 主塔正背面
      windowGrid(w, { x, y: y1, z, cols: 2, rows, stepX: wsx, stepY: wsy, w: 1, h: wh2, c: 4, axis: 'x' });
      windowGrid(w, { x, y: yw + wh, z, cols: 2, rows: 1, stepX: wsx, w: 1,
                      h: Math.min(wh2, yc - yw - wh), c: 4, axis: 'x' });
    }));
    const sy0 = dk + 1 + ah + ze + 2;                                     // 主塔兩側面（拱門上方）
    const srows = Math.floor((yw - 2 - sy0 + 1 + (wsy - wh2)) / wsy);
    const wsz = 2 * Math.max(1, Math.round(zh * 0.4));
    if (srows >= 1) mirrorX(v, 1, (vv, sg) => [xi, xo].forEach(xf =>
      windowGrid(vv, { x: sg * xf, y: sy0, z: 0, cols: 2, rows: srows, stepX: wsz, stepY: wsy,
                       w: 1, h: wh2, c: 4, axis: 'z' })));
    const arows = Math.max(1, Math.floor((yA - 2 - (dk + 2) + 1 + (wsy - wh2)) / wsy));
    mirrorX(v, ax, (vv, x) => mirrorZ(vv, azh, (w, z) =>                 // 岸塔正背面
      windowGrid(w, { x, y: dk + 2, z, cols: 1, rows: arows, stepY: wsy, w: 1, h: wh2, c: 4, axis: 'x' })));

    // ── 角塔窄窗 ──
    const ro = Math.floor(rt + 0.35);
    mirrorX(v, cx, (vv, x) => corners4(vv, (TX - 1) / 2, zh, (w, ox, oz) => {
      for (let y = dk + 3; y < yc - 1; y += wsy) {
        tint(w, x + ox, y, oz + Math.sign(oz) * ro, 4);
        tint(w, x + ox + Math.sign(ox) * ro, y, oz, 4);
      }
    }));
  }
});
