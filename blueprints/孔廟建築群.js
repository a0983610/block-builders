// 檔名：孔廟建築群.js
// v1.312.0 盲測第六回：子 agent 只拿〈藍圖製作說明〉、從零做出來的第一版（沒有任何回饋；題目是台南孔廟），原樣收進來（只改了 name 與檔名那一行；見 開發筆記〈盲測第六回：聖三一修道院、美國白宮、台南孔廟三座建築（v1.312.0）〉）
// 正面：最前面是大成門（三川脊：中段屋頂高、兩側低，三樘門），兩側紅色圍牆接到東西廡的山牆；門後露出大成殿的上簷與兩端翹起的正脊
// 側面：西廡一長條紅牆＋兩坡瓦頂從前排到後，後段上方冒出大成殿的重簷
// 三樣識別物：①大成殿重簷歇山（下簷四坡＋上簷山花三角，正脊兩端燕尾上翹、中央寶塔）②大成門三川脊與三樘門 ③東西廡夾出的鋪石院子（廊柱面向院子）
// 比例表（查不到台南孔廟的實測尺寸，照一般閩南孔廟的規模估）：
//   院落寬約 48 m、深約 46 m；大成殿殿身 20×14 m、台基 25×19×1.3 m、下層牆高 4.6 m、上層每邊縮進 3 m、兩重簷之間 2.4 m，
//   正脊約離地 15 m、寶塔 3 m；月臺 17×6 m；大成門 17×7 m、牆高 4 m；東西廡深 5.5 m、牆高 3.3 m、從大成門排到後牆；大成門到月臺 9 m
// 輪廓寬度（正面，9000 塊估 s≈12 的格數）：地面～圍牆頂 59（廡＋圍牆＋大成門）／廡屋頂 59 收到兩條廡脊／大成門頂 13～21／
//   殿下簷 29→19／殿上簷 21→17／正脊連燕尾 23、寶塔 3
// 部件尺寸（9000 塊估 s≈12，1 m ≈ 1.2 格）：殿身 25×17、下簷 4 層、上簷四坡 2 層＋山花 5 層、正脊 17 長 2 高、燕尾外伸 3 上翹 4、
//   寶塔 3×4、匾 3×2、大成門 21×9、中門 5×4、側門 3×3、廡深 7 長 55、廡柱 10 根、院子 43×49
// 部件：院子鋪石(box＋hash 顏色函式) 中軸甬道(同一支顏色函式) 台基(walls) 月臺(walls＋box) 御路台階(stairs)
//   殿身(walls) 前廊柱(box) 五間格扇門(tint) 簷底(walls) 下簷(boxTaper t) 上層牆(walls) 匾(tint) 上簷四坡(boxTaper t)
//   山花段(boxTaper d1=1＋顏色函式) 正脊(box) 燕尾(limb 兩段) 寶塔(taper) 垂脊與翹角(limb)
//   大成門台基(box) 門身(walls) 中段升起(walls) 三川屋頂(boxTaper×3) 三樘門(tint)
//   東西廡(walls) 廡頂(boxTaper) 廊柱(box) 格扇(tint) 外牆小窗(tint) 前後圍牆(box) 牆頂瓦(box)
customBlueprint({
  name: '傳統孔廟建築群',
  pal: ['#cc5e42',   // 0 紅牆、紅柱、山牆
        '#7e2e20',   // 1 紅瓦
        '#7a736a',   // 2 台基石、甬道、牆腳
        '#b0aa9e',   // 3 院子鋪石
        '#d97a52',   // 4 屋脊、垂脊、燕尾、博風
        '#5e1c14',   // 5 木門、格扇
        '#d2a43c',   // 6 寶塔（金）
        '#2e4660',   // 7 匾額（藍底）
        '#a29c90'],  // 8 鋪石深一階
  lo: 2, hi: 24,

  gen(v, s) {
    // 1 m ≈ 0.1·s 格
    const m = (meters, min, odd) => (odd ? dim(s, meters * 0.1, min, true) : dim(s, meters * 0.1, min));

    // ---- 大成殿 ----
    const HW = m(20, 9, true), HD = m(14, 7, true);     // 殿身寬、深（奇數）
    const pm = m(2.5, 1);                                // 台基比殿身每邊多出
    const PW = HW + 2 * pm, PD = HD + 2 * pm;
    const PH = m(1.3, 1);                                // 台基高（院子鋪石以上）
    const H1 = m(4.6, 3), O1 = m(2, 1), ui = m(3, 2);    // 下層牆高、下簷出簷、上層每邊縮進
    const UW = HW - 2 * ui, UD = HD - 2 * ui;
    const h1 = m(3, 2);                                  // 下簷層數
    const t1 = Math.floor((ui + O1 - 1) / (h1 - 1)) + 1; // 殼厚要大於每層每邊收的格數
    const H2 = m(2.4, 2), O2 = m(1.8, 1), hh = m(1.5, 2);
    const t2 = Math.floor(O2 / (hh - 1)) + 1;
    const hg = (UD - 1) / 2 + 1;                         // 山花段：深度每層收 2 格到 1
    const RH = dim(s, 0.14, 1);                          // 屋脊高
    // ---- 大成門 ----
    const GW = m(17, 9, true), GD = m(7, 5, true), GH = m(4, 3);
    const CW = m(8.5, 5, true), Og = Math.min(2, m(1.4, 1)), rc = m(1.2, 1);
    // ---- 東西廡、院子 ----
    const LD = m(5.5, 3, true), LH = m(3.3, 2), Ol = Math.min(2, m(1.2, 1));
    const cg = m(4, 1), gapZ = m(9, 3), YD = m(6, 2), YW = m(17, 7, true), bg = m(3, 1);
    const WH = m(3.2, 2), sw = m(4, 3, true);

    // ---- 位置：大成門正面在 z = 0，往 +z 是後面 ----
    const zGc = (GD - 1) / 2;                 // 大成門中心
    const zY0 = GD + gapZ;                    // 月臺前緣
    const zP0 = zY0 + YD;                     // 大成殿台基前緣
    const zH = zP0 + (PD - 1) / 2;            // 大成殿中心
    const zP1 = zP0 + PD - 1;                 // 台基後緣
    let zB = zP1 + bg + 1; if (zB % 2) zB += 1;   // 後牆（偶數：廡長 zB+1 是奇數，置中不偏）
    const xP = (PW - 1) / 2;
    const xLi = xP + cg + 2;                  // 廡朝院子那片牆的 x（廊柱在 xLi-1）
    const LX = xLi + (LD - 1) / 2;            // 廡中心

    // ---- 屋脊＋燕尾 ----
    const tr = Math.max(0.75, s * 0.065), tout = m(2.2, 1), trise = m(3, 2);
    const seg = (a, b) => limb(v, { x: a[0], y: a[1], z: a[2], x1: b[0], y1: b[1], z1: b[2], r: tr, c: 4 });
    const tail = (axis, e, sg, y, o) => {     // 從脊端往外、往上翹
      const P = (a, yy) => (axis === 'x' ? [a, yy, o] : [o, yy, a]);
      const p1 = P(e + sg * tout * 0.5, y + 1);
      seg(P(e - sg, y), p1);
      seg(p1, P(e + sg * tout, y + trise));
    };
    const ridge = (axis, a0, a1, y, o, tA, tB) => {   // a0～a1 是脊的兩端
      if (axis === 'x') v.box((a0 + a1) / 2, y, o, a1 - a0 + 1, RH, 1, 4);
      else v.box(o, y, (a0 + a1) / 2, 1, RH, a1 - a0 + 1, 4);
      if (tA) tail(axis, a0, -1, y + RH - 1, o);
      if (tB) tail(axis, a1, 1, y + RH - 1, o);
    };

    // ① 院子鋪石＋中軸甬道（先鋪，台基、門會蓋過去）
    const pz0 = zGc + 1, pz1 = zB - 1, pathH = (sw - 1) / 2;
    v.box(0, 0, (pz0 + pz1) / 2, 2 * xLi - 1, 1, pz1 - pz0 + 1,
      (x, y, z) => (Math.abs(x) <= pathH && z < zY0 ? 2 : hash100(x, y, z) < 18 ? 8 : 3));
    v.carve(0, 0, zH, HW - 2, 1, HD - 2);     // 殿裡面看不到，挖掉

    // ② 大成殿台基、月臺、御路台階
    v.walls(0, 0, zH, PW, PH, PD, 2, 1);
    v.walls(0, PH, zH, PW, 1, PD, 2, pm + 1);   // 台基頂面一圈，接到殿牆底下
    const zYc = (zY0 + zP0 - 1) / 2;
    if (PH > 1) v.walls(0, 1, zYc, YW, PH - 1, YD, 2, 1);
    v.box(0, PH, zYc, YW, 1, YD, 2);
    stairs(v, 0, 1, zY0 - PH, PH, sw, 'z', 2);

    // ③ 殿身：正面五間格扇門＋前廊柱，其他三面紅牆
    const yW = PH + 1;
    v.walls(0, yW, zH, HW, H1, HD, 0, 1);
    const zF = zH - (HD - 1) / 2;
    const bx = i => Math.round(-(HW - 1) / 2 + i * (HW - 1) / 5);
    for (let i = 0; i < 5; i++)
      for (let x = bx(i) + 1; x < bx(i + 1); x++)
        for (let y = yW; y < yW + H1 - 1; y++) tint(v, x, y, zF, 5);
    const co = Math.max(1, Math.min(pm, O1) - 1);
    for (let i = 0; i <= 5; i++) v.box(bx(i), yW, zF - co, 1, H1, 1, 0);

    // ④ 下簷：牆頂先鋪一圈簷底接到簷口，再蓋四坡
    const yL = yW + H1;
    v.walls(0, yL, zH, HW + 2 * O1, 1, HD + 2 * O1, 1, O1 + 1);
    boxTaper(v, { x: 0, y: yL, z: zH, w: HW + 2 * O1, d: HD + 2 * O1, w1: UW + 2, d1: UD + 2, h: h1, c: 1, t: t1 });

    // ⑤ 兩重簷之間的上層牆＋匾
    const yU = yL + h1;
    v.walls(0, yU, zH, UW, H2, UD, 0, 1);
    const zU = zH - (UD - 1) / 2, pw = m(2.5, 3, true);
    for (let x = -(pw - 1) / 2; x <= (pw - 1) / 2; x++)
      for (let y = yU; y < yU + 2; y++) tint(v, x, y, zU, 7);

    // ⑥ 上簷：四坡一段＋山花一段（歇山）；山花三角塗紅牆、邊上一圈博風
    const yU2 = yU + H2;
    v.walls(0, yU2, zH, UW + 2 * O2, 1, UD + 2 * O2, 1, O2 + 1);
    boxTaper(v, { x: 0, y: yU2, z: zH, w: UW + 2 * O2, d: UD + 2 * O2, w1: UW, d1: UD, h: hh, c: 1, t: t2 });
    const yG = yU2 + hh, xe = (UW - 1) / 2;
    boxTaper(v, { x: 0, y: yG, z: zH, w: UW, d: UD, w1: UW, d1: 1, h: hg, t: 2,
      c: (x, y, z) => (Math.abs(x) !== xe ? 1 : Math.abs(z - zH) < (UD - 1) / 2 - (y - yG) ? 0 : 4) });

    // ⑦ 正脊（兩端燕尾）＋中央寶塔
    const yR = yG + hg;
    ridge('x', -xe, xe, yR, zH, true, true);
    v.taper(0, yR + RH, zH, 1.6, 0.6, m(3, 3), 6);

    // ⑧ 垂脊＋翹角：上下兩簷的四個角
    const hr = Math.max(0.75, s * 0.06), fr = m(1.3, 1);
    const hips = (yT, xT, zT, yB, xB, zB2) => mirrorX(v, 1, (vv, sx) => mirrorZ(vv, 1, (w, sz) => {
      limb(w, { x: sx * xT, y: yT, z: zH + sz * zT, x1: sx * xB, y1: yB, z1: zH + sz * zB2, r: hr, c: 4 });
      limb(w, { x: sx * xB, y: yB, z: zH + sz * zB2, x1: sx * (xB + 1), y1: yB + fr, z1: zH + sz * (zB2 + 1), r: hr, c: 4 });
    }));
    hips(yL + h1 - 1, (UW + 1) / 2, (UD + 1) / 2, yL, (HW - 1) / 2 + O1, (HD - 1) / 2 + O1);
    hips(yU2 + hh - 1, xe, (UD - 1) / 2, yU2, xe + O2, (UD - 1) / 2 + O2);

    // ⑨ 大成門：台基、門身、中段升起、三川屋頂（兩側先、中段後蓋過去）、前後三樘門
    v.box(0, 0, zGc, GW + 2, 1, GD + 2, 2);
    v.walls(0, 1, zGc, GW, GH, GD, 0, 1);
    const xc = (CW - 1) / 2, xg = (GW - 1) / 2;
    v.walls(0, 1 + GH, zGc, CW, rc, GD, 0, 1);
    const gd = GD + 2 * Og;
    const gh = Math.round((gd - 1) / 3) + 1;
    const gt = Math.floor((gd - 1) / 2 / (gh - 1)) + 1;
    mirrorX(v, 1, (vv, sg) => {
      const xa = (xg - xc + 1) % 2 ? xc : xc - 1;     // 寬度取奇數
      boxTaper(vv, { x: sg * (xa + xg) / 2, y: GH, z: zGc, w: xg - xa + 1, d: gd, w1: xg - xa + 1, d1: 1, h: gh, t: gt,
        c: x => (Math.abs(x) === xg ? 0 : 1) });   // 外端是紅山牆
    });
    boxTaper(v, { x: 0, y: GH + rc, z: zGc, w: CW + 2, d: gd, w1: CW + 2, d1: 1, h: gh, t: gt,
      c: x => (Math.abs(x) === xc + 1 ? 0 : 1) });
    ridge('x', -(xc + 1), xc + 1, GH + rc + gh, zGc, true, true);
    ridge('x', xc + 2, xg, GH + gh, zGc, false, true);
    ridge('x', -xg, -(xc + 2), GH + gh, zGc, true, false);
    const dw = m(3.2, 3, true), dh = Math.min(GH - 1, m(3, 2));
    const sdw = m(2.2, 1, true), sdh = Math.min(GH - 1, m(2.4, 2));
    const sdx = Math.min(Math.round((xc + 1 + xg) / 2), xg - 1 - (sdw - 1) / 2);
    const door = (x0, w, h, z) => {
      for (let x = x0 - (w - 1) / 2; x <= x0 + (w - 1) / 2; x++)
        for (let y = 1; y <= h; y++) tint(v, x, y, z, 5);
    };
    for (const z of [0, GD - 1]) { door(0, dw, dh, z); door(sdx, sdw, sdh, z); door(-sdx, sdw, sdh, z); }

    // ⑩ 東西廡：紅牆＋石牆腳、面院子一排廊柱與格扇、外牆小窗、兩坡瓦頂（兩端紅山牆）、燕尾脊
    const LL = zB + 1, lw = LD + 2 * Ol;
    const lh = Math.round((lw - 1) / 3) + 1;
    const lt = Math.floor((lw - 1) / 2 / (lh - 1)) + 1;
    const za = zGc + 2, zb = zB - 2;
    const nb = Math.max(3, Math.round((zb - za) / m(3.8, 2)));
    const bz = i => Math.round(za + i * (zb - za) / nb);
    const ww = Math.floor(m(1.4, 1) / 2), wh = m(1.5, 1), wy = Math.max(1, LH - wh);
    mirrorX(v, 1, (vv, sg) => {
      const cx = sg * LX;
      vv.walls(cx, 0, zB / 2, LD, LH + 1, LL, (x, y) => (y === 0 ? 2 : 0), 1);
      for (let i = 0; i <= nb; i++) vv.box(sg * (xLi - 1), 1, bz(i), 1, LH, 1, 0);
      for (let i = 0; i < nb; i++) {
        for (let z = bz(i) + 1; z < bz(i + 1); z++)
          for (let y = 1; y < LH; y++) tint(vv, sg * xLi, y, z, 5);
        const zm = Math.round((bz(i) + bz(i + 1)) / 2);
        for (let dz = -ww; dz <= ww; dz++)
          for (let y = wy; y < wy + wh; y++) tint(vv, sg * (xLi + LD - 1), y, zm + dz, 5);
      }
      boxTaper(vv, { x: cx, y: LH, z: zB / 2, w: lw, d: LL, w1: 1, d1: LL, h: lh, t: lt,
        c: (x, y, z) => (z === 0 || z === zB ? 0 : 1) });
      ridge('z', 0, zB, LH + lh, cx, true, true);
    });

    // ⑪ 前後圍牆：紅牆、石牆腳、牆頂一排瓦
    const wallC = (x, y) => (y === 0 ? 2 : 0);
    mirrorX(v, 1, (vv, sg) => {
      const xa = xg + 1, xb = xLi - 1;
      vv.box(sg * (xa + xb) / 2, 0, zGc, xb - xa + 1, WH, 1, wallC);
      vv.box(sg * (xa + xb) / 2, WH, zGc, xb - xa + 1, 1, 3, 1);
    });
    v.box(0, 0, zB, 2 * xLi - 1, WH, 1, wallC);
    v.box(0, WH, zB, 2 * xLi - 1, 1, 3, 1);
  }
});
