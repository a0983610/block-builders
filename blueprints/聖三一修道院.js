// 檔名：聖三一修道院.js
// v1.312.0 盲測第六回：子 agent 只拿〈藍圖製作說明〉、從零做出來的第二版（看過一次報告＋9000 四視圖），原樣收進來（只改了 name 與檔名那一行；見 開發筆記〈盲測第六回：聖三一修道院、美國白宮、台南孔廟三座建築（v1.312.0）〉）
// 正面：一道白色矮城牆橫過整個畫面（四角圓塔戴綠色尖頂、正中一座門樓），牆後由左到右是
//       高聳的淺藍綠鐘樓、五顆洋蔥頂的大教堂（中間高的金頂、兩旁低一截的藍頂）、右前方一顆金頂的小教堂
// 側面：鐘樓在最前面擋住大教堂的西端，城牆比正面短（院子東西長、南北短）
// 三樣識別物：大教堂的「一金四藍撒金星」五顆洋蔥頂、四層收分的淺藍綠＋白鐘樓、白城牆＋綠尖頂角塔圍出的院子
// 比例表（實物）：鐘樓高 88 m（查到）；城牆周長約 1.5 km、12 座塔、不規則四邊形（查到）；
//   大教堂高度查不到，估約 55 m（含十字架），六柱、長邊四開間、短邊三開間；
//   聖三一教堂查不到，估約 35 m 高、方形平面；城牆高查不到，估約 10 m。
//   建築用同一把尺（s=10 時 1 格 ≈ 1.65 m）；院子不照比例，縮成約四分之一。
// 輪廓寬度（正面，s≈10，以格計）：0～5 層 城牆整排 67（含角塔 73）
//   ／6～12 層 角塔 7、門樓 7、聖三一 9、大教堂 25＋後殿 3、鐘樓一層 11（簷 13）
//   ／13～19 層 大教堂的半圓山牆與五個鼓座（鼓座 7 寬與 5 寬）、聖三一金頂 9、鐘樓二層 9
//   ／20～30 層 中間金頂 11 寬最高、兩旁藍頂 7 寬（頂在 25 層）、鐘樓三層 7
//   ／31～43 層 只剩鐘樓三、四層 7～5 ／44～53 層 鐘樓頂鼓 5、金冠 5、十字架
// 部件尺寸（9000 塊估 s ≈ 10，以下用 s=10 算；上一版 9000 那一檔是 s=10.42）：
//   大教堂 L=dim(s,2.4,9,odd)=25、B=dim(s,1.8,7,odd)=19、牆高 dim(s,1.2,4)=12；半圓山牆半徑 3（7 寬 4 高）
//   中央鼓座 r=3、高 7；中央金洋蔥 r=0.52s=5.2 → 最鼓 10～11 格寬、高 10
//   四角鼓座 r=2、高 5；藍洋蔥 r=0.36s=3.6 → 7 格寬、高 8
//   鐘樓各層寬 11／9／7／5、高 10／10／9／7；拱寬 3／5／3／3（只有第二層挖穿）；金鐘 3 格；金冠 5 寬 6 高；全高約 53
//   聖三一 9×9、牆高 7、金洋蔥 r=4.5 → 9 寬、高 7
//   城牆高 dim(s,0.6,3)=6（頂層綠）、角塔半徑 3、塔身 11＋尖頂 7；門樓 7 寬 12 高、門洞 5 寬 6 高
// 部件：城牆(walls) 牆頂走道(walls t2) 射孔(windowGrid) 角塔(cyl) 塔簷(cyl) 尖頂(taper) 門樓(box) 門洞(arch)
//   門樓屋頂(hipRoof) 院子步道(box)
//   大教堂：台基(walls) 牆(walls) 壁柱(rowOf+box) 半圓山牆(tubeZ；側面 stampY 轉 90°) 屋面(box)
//   後殿(cyl+dome) 窗(tint) 南門(arch) 鼓座(cyl) 洋蔥頂(onion，藍頂用 hash100 撒金星) 鼓座窗(paintFrom) 十字架(box)
//   鐘樓：各層(walls，角柱用顏色函式) 層簷(box) 鐘層的拱(arch；側面照說明書的式子自己 carve)
//   其他層的拱(tint 塗深色拱形) 金鐘(taper) 頂鼓(cyl) 金冠(revolve)
//   聖三一：台基 牆 半圓山牆 屋面 方台 後殿 鼓座 金洋蔥 門(arch) 窗(tint)
customBlueprint({
  name: '聖三一修道院',
  pal: ['#e6e2d8',   // 0 白牆（城牆、兩座教堂、鐘樓的白角柱與白簷）
        '#a8a397',   // 1 白牆的陰影色：台基、壁柱、半圓山牆的邊框、塔簷、步道
        '#d6a935',   // 2 金：中央大金頂、聖三一金頂、十字架、鐘樓金冠與金鐘
        '#25478f',   // 3 洋蔥頂的藍
        '#7cc0b6',   // 4 鐘樓的淺藍綠
        '#4f665a',   // 5 屋面：城牆頂、塔的尖頂、教堂屋面、後殿半圓頂
        '#33343a',   // 6 窗、門洞、射孔
        '#f0c850'],  // 7 藍頂上的金星
  lo: 1.5, hi: 18,

  gen(v, s) {
    const R = Math.round;
    const sr = p => (p < 0 ? -R(-p) : R(p));               // 對稱取整（左右兩邊不差一格）
    const odd = n => (n % 2 ? n : n - 1);

    // ---------- 小工具 ----------
    const cross = (x, y, z, h) => {                         // 十字架：直槓＋橫槓
      v.box(x, y, z, 1, h, 1, 2);
      v.box(x, y + h - 2, z, 3, 1, 1, 2);
    };
    const slit = (x, y, z, h) => { for (let k = 0; k < h; k++) tint(v, x, y + k, z, 6); };
    const sideArch = (x, y, z, w, h) => {                   // ±x 那兩面的拱（說明書 arch 那條式子）
      const r = (w - 1) / 2;
      v.carve(x, y, z, 1, h, w);
      for (let j = 0; j <= r; j++) v.carve(x, y + h + j, z, 1, 1, 2 * R(Math.sqrt(r * r - j * j)) + 1);
    };
    // 在牆面上塗一個深色拱形（不挖穿）：形狀跟 arch 挖出來的一樣
    const archPaint = (xc, y, zc, w, h, alongZ) => {
      const r = (w - 1) / 2;
      for (let k = 0; k < h + r + 1; k++) {
        const hw = k < h ? r : R(Math.sqrt(Math.max(0, r * r - (k - h) * (k - h))));
        for (let d = -hw; d <= hw; d++) {
          if (alongZ) tint(v, xc, y + k, zc + d, 6); else tint(v, xc + d, y + k, zc, 6);
        }
      }
    };
    // 半圓山牆：tubeZ 長 1 格＝一片圓，軸心放在牆頂；下半圓等一下被牆蓋掉。先畫陰影色大圓、再畫白色小圓 → 一圈邊框
    const zakoXY = (xc, y, z, r) => {
      tubeZ(v, xc, y, z, r, 1, r >= 1.5 ? 1 : 0);
      if (r >= 1.5) tubeZ(v, xc, y, z, r - 1, 1, 0);
    };
    // 側面（±x 兩面）的半圓山牆：照正面那樣畫在轉之前的位置，stampY 轉 90° 過去（左右對稱，轉的方向不影響結果）
    const zakoZY = (cx, cz, halfX, zcs, y, r) => stampY(v, 90, w => {
      for (const zc of zcs) for (const sg of [-1, 1]) {
        tubeZ(w, cx + (zc - cz), y, cz + sg * halfX, r, 1, r >= 1.5 ? 1 : 0);
        if (r >= 1.5) tubeZ(w, cx + (zc - cz), y, cz + sg * halfX, r - 1, 1, 0);
      }
    }, cx, cz);

    // ---------- 尺寸與配置（先全部算好，城牆照建築的範圍圍） ----------
    // 大教堂（原點）
    const L = dim(s, 2.4, 9, true), B = dim(s, 1.8, 7, true), H = dim(s, 1.2, 4);
    const x0 = -(L - 1) / 2, x1 = (L - 1) / 2, zA = -(B - 1) / 2, zB = (B - 1) / 2;
    const bx = (L - 1) / 4, bz = (B - 1) / 3;              // 長邊四開間、短邊三開間
    const bayX = [0, 1, 2, 3].map(i => x0 + (i + 0.5) * bx);
    const bayZ = [0, 1, 2].map(j => zA + (j + 0.5) * bz);
    const ra = Math.max(1.4, bz / 2 - 0.3), raE = Math.floor(ra + 0.35);
    const gap = dim(s, 0.3, 2);
    // 鐘樓（大教堂西邊，+x）
    const bw = [dim(s, 1.1, 5, true), dim(s, 0.9, 5, true), dim(s, 0.7, 3, true), dim(s, 0.5, 3, true)];
    const bh = [dim(s, 1.0, 4), dim(s, 1.0, 3), dim(s, 0.85, 3), dim(s, 0.7, 3)];
    const baw = [dim(s, 0.3, 1, true), dim(s, 0.5, 3, true), dim(s, 0.3, 1, true), dim(s, 0.25, 1, true)]
      .map((w, i) => Math.max(1, Math.min(w, bw[i] - 2)));
    const bah = [dim(s, 0.4, 2), dim(s, 0.45, 2), dim(s, 0.4, 2), dim(s, 0.35, 2)];
    const btx = x1 + 1 + gap + (bw[0] + 1) / 2, btz = 0;
    // 聖三一教堂（大教堂東南，−x、−z）
    const Tw = dim(s, 0.9, 5, true), Th = dim(s, 0.65, 3);
    const tX1 = x0 - raE - gap - 1, tcx = tX1 - (Tw - 1) / 2, tcz = zA - R(Tw * 0.35);
    const tX0 = tcx - (Tw - 1) / 2, tZ0 = tcz - (Tw - 1) / 2, tZ1 = tcz + (Tw - 1) / 2;
    const rta = Math.max(1.4, (Tw - 1) / 4), rtaE = Math.floor(rta + 0.35);
    // 城牆範圍
    const m = dim(s, 0.3, 1), mf = dim(s, 0.5, 2);
    const xa = tX0 - rtaE - 1 - m - 1, xb = btx + (bw[0] + 1) / 2 + m + 1;
    const za = Math.min(tZ0 - 1, zA - 2) - mf - 1, zb = Math.max(zB + 1, btz + (bw[0] + 1) / 2) + m + 1;
    const W = xb - xa + 1, D = zb - za + 1, ecx = (xa + xb) / 2, ecz = (za + zb) / 2;
    const gx = sr(ecx);

    // ---------- 城牆、角塔、門樓 ----------
    const wh = dim(s, 0.6, 3);
    v.walls(ecx, 0, ecz, W, wh - 1, D, (x, y) => (y === 0 ? 1 : 0), 1);
    v.walls(ecx, wh - 1, ecz, W, 1, D, 5, s >= 6 ? 2 : 1);  // 牆頂走道的屋面（大尺寸時往內多一格）
    const rt = Math.max(2, s * 0.3), th = wh + dim(s, 0.45, 1), ht = dim(s, 0.7, 3);
    for (const [x, z] of [[xa, za], [xb, za], [xa, zb], [xb, zb]]) {
      v.cyl(x, 0, z, rt, th, (xx, y) => (y === 0 ? 1 : 0), 1);
      v.cyl(x, th, z, rt + 1, 1, 1, 2);                      // 塔簷
      v.taper(x, th + 1, z, rt + 1, 0.4, ht, 5, 1);          // 綠色尖頂
      v.box(x, th + 1 + ht, z, 1, dim(s, 0.15, 1), 1, 2);    // 尖頂上的小金針
      const ys = R(th * 0.6);
      paintFrom(v, x, ys, z, x === xa ? -1 : 1, 0, 0, Math.ceil(rt) + 2, 6);
      paintFrom(v, x, ys, z, 0, 0, z === za ? -1 : 1, Math.ceil(rt) + 2, 6);
    }
    // 正面門樓：實心方塊，門洞內壁用顏色函式塗暗
    const gw = dim(s, 0.7, 5, true), gd = dim(s, 0.3, 3), gh = wh + dim(s, 0.6, 2);
    const aw = dim(s, 0.4, 3, true), ah = dim(s, 0.3, 2), gOpen = ah + (aw - 1) / 2 + 1;
    const gz0 = za - Math.floor(gd / 2), gz1 = gz0 + gd - 1, gzc = (gz0 + gz1) / 2;
    v.box(gx, 0, gzc, gw, gh, gd, (x, y, z) =>
      (z > gz0 && z < gz1 && Math.abs(x - gx) <= (aw + 1) / 2 && y <= gOpen) ? 6 : (y === 0 ? 1 : 0));
    arch(v, gx, 0, za, aw, ah, gd + 2);
    v.box(gx, gh, gzc, gw + 2, 1, gd + 2, 1);
    hipRoof(v, gx, gh + 1, gzc, gw + 2, gd + 2, 5);
    // 射孔：四面牆中段一排
    const sp = dim(s, 0.45, 3), lh = Math.max(1, R((wh - 1) * 0.5));
    const ncx = odd(Math.max(1, Math.floor((W - 2 * rt - 4) / sp)));
    const ncz = odd(Math.max(1, Math.floor((D - 2 * rt - 4) / sp)));
    windowGrid(v, { x: gx, y: lh, z: za, cols: ncx, stepX: sp, c: 6 });
    windowGrid(v, { x: gx, y: lh, z: zb, cols: ncx, stepX: sp, c: 6 });
    windowGrid(v, { x: xa, y: lh, z: sr(ecz), cols: ncz, stepX: sp, c: 6, axis: 'z' });
    windowGrid(v, { x: xb, y: lh, z: sr(ecz), cols: ncz, stepX: sp, c: 6, axis: 'z' });
    // 院子步道：門樓 → 大教堂
    if (zA - 2 >= gz1 + 1) v.box(gx, 0, (gz1 + 1 + zA - 2) / 2, dim(s, 0.3, 3, true), 1, zA - 2 - gz1, 1);

    // ---------- 聖母安息大教堂 ----------
    const Ha = Math.max(3, R(H * 0.55));
    for (const zc of bayZ) {                                 // 東端三個半圓後殿，只留牆外那半
      const zr = sr(zc);
      v.cyl(x0, 0, zr, ra, Ha, 0, 1);
      v.dome(x0, Ha, zr, ra + 0.2, 5);
      v.carve(x0 + 1 + raE / 2, 0, zr, raE + 1, Ha + raE + 3, 2 * raE + 3);
    }
    v.walls(0, 0, 0, L + 2, 1, B + 2, 1, 1);                 // 台基一圈
    for (const xc of bayX) { zakoXY(xc, H, zA, bx / 2); zakoXY(xc, H, zB, bx / 2); }
    zakoZY(0, 0, x1, bayZ, H, bz / 2);
    v.walls(0, 0, 0, L, H, B, 0, 1);                         // 主牆
    v.box(0, H, 0, L - 2, 1, B - 2, 5);                      // 屋面
    rowOf(v, 5, bx, (vv, p) => { vv.box(sr(p), 0, zA - 1, 1, H, 1, 1); vv.box(sr(p), 0, zB + 1, 1, H, 1, 1); }, 0);
    rowOf(v, 4, bz, (vv, p) => { vv.box(x0 - 1, 0, sr(p), 1, H, 1, 1); vv.box(x1 + 1, 0, sr(p), 1, H, 1, 1); }, 0);
    // 窗：每開間上下兩排細長窗
    let pi = 0;
    bayX.forEach((xc, i) => { if (Math.abs(xc - gx) < Math.abs(bayX[pi] - gx)) pi = i; });
    const wwh = dim(s, 0.25, 2), yU = R(H * 0.6), yL = Math.max(1, R(H * 0.22));
    bayX.forEach((xc, i) => {
      const x = sr(xc);
      slit(x, yU, zA, wwh); slit(x, yU, zB, wwh); slit(x, yL, zB, wwh);
      if (i !== pi) slit(x, yL, zA, wwh);
    });
    bayZ.forEach(zc => { const z = sr(zc); slit(x1, yU, z, wwh); slit(x1, yL, z, wwh); slit(x0, yU, z, wwh); });
    // 南門（正面）：陰影色門框＋拱形門洞，後面補深色擋板
    const dw = dim(s, 0.35, 3, true), dh = dim(s, 0.3, 2), dH = dh + (dw - 1) / 2 + 1, px = sr(bayX[pi]);
    v.carve(px, 0, zA - 1, dw, dH, 1);
    arch(v, px, 0, zA, dw, dh, 1, 1);
    v.box(px, 0, zA + 1, dw, dH, 1, 6);
    // 五顆洋蔥頂：中間的放在高鼓座上，最鼓那一圈高過四角藍頂的頂
    const yR = H + 1;
    const rc = Math.max(1.5, s * 0.3), hdc = dim(s, 0.7, 3);
    const ro = Math.max(2.6, s * 0.52), hoc = dim(s, 1.0, 5);
    v.cyl(0, yR, 0, rc, hdc, 0, 1);                          // 中央鼓座
    v.onion(0, yR + hdc, 0, ro, hoc, 2);                     // 中央大金頂
    cross(0, yR + hdc + hoc, 0, dim(s, 0.3, 3));
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
      for (let k = 0; k < 2; k++) paintFrom(v, 0, yR + hdc - 3 + k, 0, dx, 0, dz, Math.ceil(rc) + 2, 6);
    const rsd = Math.max(1.2, s * 0.2), hds = dim(s, 0.45, 2);
    const rso = rsd * 1.8, hos = dim(s, 0.75, 4);
    const dxs = sr((L - 1) * 0.32), dzs = sr((B - 1) * 0.27);
    const star = (x, y, z) => (hash100(x, y, z) < 14 ? 7 : 3);
    corners4(v, dxs, dzs, (vv, x, z) => {
      vv.cyl(x, yR, z, rsd, hds, 0, 1);                      // 四角鼓座
      vv.onion(x, yR + hds, z, rso, hos, star);              // 藍底金星洋蔥頂
      cross(x, yR + hds + hos, z, dim(s, 0.25, 3));
      for (const [ex, ez] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
        paintFrom(vv, x, yR + Math.floor(hds / 2), z, ex, 0, ez, Math.ceil(rsd) + 2, 6);
    });

    // ---------- 鐘樓 ----------
    let y = 0;
    const base = [];
    for (let i = 0; i < 4; i++) {
      const b = bw[i], hh = bh[i], half = (b - 1) / 2, y0 = y;
      base.push(y0);
      v.walls(btx, y0, btz, b, hh, b, (x, yy, z) =>
        (i === 0 && yy === 0) ? 1 : (Math.abs(x - btx) === half && Math.abs(z - btz) === half ? 0 : 4), 1);
      if (i === 1) {                                         // 鐘層：四面挖穿，看得到裡面的鐘
        mirrorZ(v, half, (vv, dz) => arch(vv, btx, y0 + 1, btz + dz, baw[i], bah[i], 1));
        mirrorX(v, half, (vv, dx) => sideArch(btx + dx, y0 + 1, btz, baw[i], bah[i]));
      } else {                                               // 其他層：塗深色拱形，牆面留著淺藍綠
        mirrorZ(v, half, (vv, dz) => archPaint(btx, y0 + 1, btz + dz, baw[i], bah[i], false));
        mirrorX(v, half, (vv, dx) => archPaint(btx + dx, y0 + 1, btz, baw[i], bah[i], true));
      }
      v.box(btx, y0 + hh, btz, b + 2, 1, b + 2, 0);          // 白簷
      y = y0 + hh + 1;
    }
    // 鐘層（第二層）裡吊一口金鐘
    const yC2 = base[1] + bh[1], bellTop = base[1] + Math.max(1, R(bh[1] * 0.65));
    v.taper(btx, bellTop - 2, btz, Math.max(1, s * 0.16), Math.max(0.5, s * 0.08), 3, 2);
    if (yC2 - 1 > bellTop) v.box(btx, bellTop + 1, btz, 1, yC2 - 1 - bellTop, 1, 6);
    // 頂鼓、金冠、十字架
    const r5 = Math.max(0.9, (bw[3] - 1) / 2 - 0.1), h5 = dim(s, 0.4, 2), hc = dim(s, 0.6, 3);
    v.cyl(btx, y, btz, r5, h5, 4);
    revolve(v, { x: btx, y: y + h5, z: btz, c: 2,
      prof: [[r5 + 0.7, 0], [r5 - 0.1, (hc - 1) * 0.3], [r5 + 0.9, (hc - 1) * 0.6], [r5 * 0.45, (hc - 1) * 0.85], [0.8, hc - 1]] });
    cross(btx, y + h5 + hc, btz, dim(s, 0.3, 3));

    // ---------- 聖三一教堂 ----------
    const tb = (Tw - 1) / 3, tOff = [-tb, 0, tb];
    const Hta = Math.max(2, Th - 2);
    v.cyl(tX0, 0, tcz, rta, Hta, 0, 1);                      // 東端後殿
    v.dome(tX0, Hta, tcz, rta + 0.2, 5);
    v.carve(tX0 + 1 + rtaE / 2, 0, tcz, rtaE + 1, Hta + rtaE + 3, 2 * rtaE + 3);
    v.walls(tcx, 0, tcz, Tw + 2, 1, Tw + 2, 1, 1);           // 台基
    for (const o of tOff) { zakoXY(tcx + o, Th, tZ0, tb / 2); zakoXY(tcx + o, Th, tZ1, tb / 2); }
    zakoZY(tcx, tcz, (Tw - 1) / 2, tOff.map(o => tcz + o), Th, tb / 2);
    v.walls(tcx, 0, tcz, Tw, Th, Tw, 0, 1);
    v.box(tcx, Th, tcz, Tw - 2, 1, Tw - 2, 5);               // 屋面
    v.box(tcx, Th + 1, tcz, Math.max(1, Tw - 4), 1, Math.max(1, Tw - 4), 0);   // 鼓座下的方台
    const rtd = Math.max(1.4, s * 0.24), htd = dim(s, 0.3, 2);
    const rto = Math.max(2.6, s * 0.45), hto = dim(s, 0.7, 4);
    v.cyl(tcx, Th + 2, tcz, rtd, htd, 0, 1);
    v.onion(tcx, Th + 2 + htd, tcz, rto, hto, 2);            // 金頂
    cross(tcx, Th + 2 + htd + hto, tcz, dim(s, 0.25, 3));
    const twh = dim(s, 0.25, 2), ty = R(Th * 0.45);
    tOff.forEach((o, i) => {
      const x = sr(tcx + o), z = sr(tcz + o);
      if (i !== 1) slit(x, ty, tZ0, twh);
      slit(x, ty, tZ1, twh); slit(tX1, ty, z, twh);
    });
    const tdw = dim(s, 0.25, 3, true), tdh = dim(s, 0.25, 2), tdH = tdh + (tdw - 1) / 2 + 1;
    arch(v, tcx, 0, tZ0, tdw, tdh, 1, 1);
    v.box(tcx, 0, tZ0 + 1, tdw, tdH, 1, 6);
  }
});
