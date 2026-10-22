// 檔名：艋舺龍山寺.js
// v1.318.0 盲測第十回：子 agent 只拿〈藍圖製作說明〉、從零做出來的第二版（看過一次報告＋9000 四視圖），原樣收進來（只改了 name 與檔名那一行；見 開發筆記〈盲測第十回：新增艋舺龍山寺、白川鄉合掌屋、法國聖米歇爾山、杜拜帆船飯店、大同電鍋（v1.318.0）〉）
// ── 設計表 ──
// 正面：三川殿居中、屋脊分三段（中港高、兩側低），每段外端燕尾往上甩；中門兩側兩根銅鑄龍柱；
//       左右較矮的龍門、虎門；後面兩側冒出鐘樓、鼓樓的六角轎頂；正中間再高一截是正殿的重簷歇山頂，脊上雙龍拱寶塔
// 側面：前殿低、正殿最高、後殿再低，護龍的長屋頂把三座連成一排；鐘鼓樓在前段冒出護龍屋頂
// 三樣識別物：①主脊兩端往上翹、尖端分叉的燕尾 ②屋脊上的彩色剪黏（雙龍、寶塔、彩色脊身）
//             ③三川殿正面兩根銅鑄龍柱，加上兩側六角轎頂的鐘鼓樓
// 比例表（一般認識，查不到實測尺寸）：三進回字形——前殿（三川殿＋龍門＋虎門）、正殿、後殿、左右護龍；
//   正殿獨立在中庭正中、四周迴廊、重簷歇山，是全寺最高；鐘鼓樓在護龍前段、轎頂式六角頂，
//   高度介於前殿與正殿之間；全寺平面 寬：深 ≈ 1：1.1；中庭照規矩壓縮、正殿放大（台基約全寬 0.48）
// 輪廓寬度（正面，全寬 39 格 ＝ 1）：y0～5 牆身 1.00（三川殿＋龍虎門）／y6～14 三川殿屋頂 0.54（中港 0.33，比兩側高 3 層）、
//   龍虎門屋頂到兩端／y12～19 兩座鐘鼓樓各 0.18（中心在 ±0.44）＋中間正殿上簷 0.49／
//   y20～25 正殿歇山山頭 0.33／y26～32 正殿屋脊連燕尾 0.54、正中寶塔 0.08
// 部件尺寸（第一版報告：9000 塊 s = 7.67；這一版塊數多一點，估 s ≈ 7.5）：全寬 dim(s,5.1)=39、全深約 50；
//   正殿台基 dim(s,2.4)=19、上簷 19、歇山山頭 13、全高約 32；三川殿 dim(s,2.3)=19 寬、中港 dim(s,1.3)=11；
//   燕尾（正殿）伸出 3、上翹 4、分叉 2，三川殿中港同大；銅龍柱 r=0.23s=1.7 → 5 格寬、高 8；
//   鐘鼓樓六角半徑 3.2（寬 7）、頂高約 24；脊上龍身 4～5 格、寶塔 5 層
// 部件：中庭石板(box) 台基(walls) 正殿台階(stairs) 牆(walls) 門(box) 窗(windowGrid)
//   迴廊石柱(rowOf) 銅龍柱(cyl＋螺旋顏色函式) 屋頂(walls 出簷＋boxTaper 下緩上陡)
//   歇山(boxTaper 兩段) 屋脊(box＋剪黏雜色) 垂脊(屋頂顏色函式) 燕尾(plate 'xy'＋分叉 plate 'zy')
//   翹角(plate＋stampY) 雙龍(plate 'xy') 寶塔(box 疊) 鐘鼓樓(自寫六角層) 轎頂(六角層逐層收)
//   寶頂(cyl/box) 香爐(revolve)
customBlueprint({
  name: '艋舺龍山寺',
  pal: ['#aea89d',   // 0 石牆、迴廊地坪（泉州白石）
        '#5d5952',   // 1 深石：台基、石柱
        '#a8472b',   // 2 屋瓦（紅褐）
        '#3b2a24',   // 3 屋脊、垂脊、燕尾、翹角
        '#3fae68',   // 4 剪黏綠
        '#e3b33c',   // 5 剪黏金黃、匾額、寶頂、龍柱上的龍
        '#5e1d18',   // 6 木作朱紅（門）
        '#4a3e2b',   // 7 銅（龍柱、香爐）
        '#7d786f',   // 8 中庭石板
        '#3d74c4',   // 9 剪黏藍
        '#26211e',   // 10 門洞、窗格、鐘鼓樓開口
        '#ece4d2'],  // 11 剪黏白
  lo: 2, hi: 14,

  gen(v, s) {
    const D = (k, m, odd) => dim(s, k, m, odd);
    const sr = p => Math.sign(p) * Math.round(Math.abs(p));
    // 用兩端的格子畫：剛好佔 xa～xb、za～zb
    const B = (xa, xb, y, h, za, zb, c) => {
      const x0 = Math.min(xa, xb), x1 = Math.max(xa, xb), z0 = Math.min(za, zb), z1 = Math.max(za, zb);
      v.box((x0 + x1) / 2, y, (z0 + z1) / 2, x1 - x0 + 1, h, z1 - z0 + 1, c);
    };
    const Wl = (xa, xb, y, h, za, zb, c) => {
      const x0 = Math.min(xa, xb), x1 = Math.max(xa, xb), z0 = Math.min(za, zb), z1 = Math.max(za, zb);
      v.walls((x0 + x1) / 2, y, (z0 + z1) / 2, x1 - x0 + 1, h, z1 - z0 + 1, c, 1);
    };
    // 剪黏：只撒在主脊上（約一成七），垂脊改純深色，屋面才不會滿身彩點
    const ridgeC = (x, y, z) => { const h = hash100(x, y, z); return h < 7 ? 4 : h < 13 ? 5 : h < 17 ? 9 : 3; };
    const dragC = (x, y, z) => (hash100(x, y, z) < 30 ? 5 : 4);

    const rt = D(0.2, 1, true), rh = D(0.2, 1);   // 屋脊厚（沿 z）、屋脊高

    // 屋頂（屋脊沿 x）：最底一圈是平緩的出簷，往上每層每邊收 1 格到屋脊厚 rt；回傳屋面最頂那一層
    const roofX = (xa, xb, za, zb, y) => {
      const x0 = Math.min(xa, xb), x1 = Math.max(xa, xb);
      const w = x1 - x0 + 1, d = zb - za + 1, xc = (x0 + x1) / 2, zc0 = (za + zb) / 2;
      v.walls(xc, y, zc0, w, 1, d, 2, 3);
      const d2 = d - 4;
      if (d2 < 1) return y;
      const n = Math.max(1, (d2 - rt) / 2 + 1), hd = (d2 - 1) / 2;
      // 兩端山頭沿著斜面那兩排是垂脊（深色）
      const ec = (x, yy, z) => ((x <= x0 + 1 || x >= x1 - 1) && Math.abs(z - zc0) >= hd - (yy - y - 1) - 1) ? 3 : 2;
      if (n >= 2) boxTaper(v, { x: xc, y: y + 1, z: zc0, w, d: d2, w1: w, d1: rt, h: n, c: ec, t: 2 });
      else v.box(xc, y + 1, zc0, w, 1, d2, ec);
      return y + n;
    };
    // 屋頂（屋脊沿 z）：護龍用
    const roofZ = (xc, w, za, zb, y) => {
      const d = zb - za + 1, zc0 = (za + zb) / 2;
      v.walls(xc, y, zc0, w, 1, d, 2, 3);
      const w2 = w - 4;
      if (w2 < 1) return y;
      const n = (w2 - 1) / 2 + 1;
      if (n >= 2) boxTaper(v, { x: xc, y: y + 1, z: zc0, w: w2, d, w1: 1, d1: d, h: n, c: 2, t: 2 });
      else v.box(xc, y + 1, zc0, w2, 1, d, 2);
      return y + n;
    };
    // 燕尾：(x, y) 是屋脊端點最上面那格，dir 往外，k 大小；端面看是一個 V 形分叉
    const swallow = (x, y, z, dir, k) => {
      const e = Math.max(2, Math.round(s * 0.38 * k)), r = Math.max(2, Math.round(s * 0.5 * k));
      const f = Math.max(1, Math.round(s * 0.2 * k));
      plate(v, { plane: 'xy', at: z, t: 1, w: 1.5, c: 3,
                 pts: [[x, y], [x + dir * Math.round(e * 0.6), y + Math.round(r * 0.35)], [x + dir * e, y + r]] });
      plate(v, { plane: 'zy', at: x + dir * e, t: 1, w: 1.5, c: 3,
                 pts: [[z - f, y + r + f], [z, y + r], [z + f, y + r + f]] });
    };
    const ridgeX = (xa, xb, z, y, kL, kR) => {
      const x0 = Math.min(xa, xb), x1 = Math.max(xa, xb);
      B(x0, x1, y, rh, z - (rt - 1) / 2, z + (rt - 1) / 2, ridgeC);
      const yt = y + rh - 1;
      if (kL) swallow(x0, yt, z, -1, kL);
      if (kR) swallow(x1, yt, z, 1, kR);
      return yt + 1;                       // 脊頂上面那一層
    };
    // 剪黏龍：尾巴在外、頭朝中間
    const dragon = (xo, xi, y, z) => {
      const L = xi - xo, at = t => Math.round(xo + L * t);
      plate(v, { plane: 'xy', at: z, t: 1, w: 1.5, c: dragC,
                 pts: [[xo, y + 2], [at(0.33), y], [at(0.66), y + 2], [xi, y + 1]] });
      B(xi, xi, y + 1, 2, z, z, 5);
    };
    const pagoda = (x, y, z, n) => {
      for (let i = 0; i < n; i++) {
        B(x - 1, x + 1, y + 2 * i, 1, z - 1, z + 1, 5);
        B(x, x, y + 2 * i + 1, 1, z, z, 9);
      }
      B(x, x, y + 2 * n, 1, z, z, 11);
    };
    // 翹角：沿 +x 畫一片往上甩的薄片（伸出 L＋1、上翹 L），再繞 (ox, oz) 轉到該去的角
    const qlen = Math.max(2, Math.round(s * 0.28));
    const qiao = (cx, y, cz, ang, ox, oz, L) => stampY(v, ang, w => plate(w, { plane: 'xy', at: cz, t: 1, w: 1.5,
      c: (xx, yy) => (yy >= y + L ? 5 : 3),
      pts: [[cx, y], [cx + L, y + 1], [cx + L + 1, y + L]] }), ox, oz);
    // 六角形（頂點朝 ±x、平邊朝正面）
    const hexIn = (dx, dz, R) => Math.abs(dz) <= R * 0.866 + 0.35 && Math.abs(dx) * 0.866 + Math.abs(dz) * 0.5 <= R * 0.866 + 0.35;
    const hexLayer = (xc, y, zc0, R, c, shell) => {
      const n = Math.ceil(R) + 1;
      for (let dx = -n; dx <= n; dx++) for (let dz = -n; dz <= n; dz++) {
        if (!hexIn(dx, dz, R) || (shell && hexIn(dx, dz, R - shell))) continue;
        v.set(xc + dx, y, zc0 + dz, typeof c === 'function' ? c(xc + dx, y, zc0 + dz) : c);
      }
    };

    // ── 尺寸 ──
    const W = D(5.1, 17, true), hW = (W - 1) / 2;          // 全寬
    const ww = D(0.7, 3, true);                            // 護龍寬
    const sd = D(0.9, 5, true), pd = Math.min(D(0.4, 1), sd - 4);   // 三川殿進深、步口深（龍柱站得下）
    const gd = D(0.7, 3, true), bd = D(0.8, 5, true);      // 龍虎門、後殿進深
    const sw = D(2.3, 7, true), hs = (sw - 1) / 2;         // 三川殿面寬
    const cwid = Math.min(D(1.3, 3, true), sw - 4), hc = (cwid - 1) / 2;    // 中港（升起的那一段）
    const mp = Math.min(D(2.4, 7, true), W - 2 * ww - 4), hm = (mp - 1) / 2; // 正殿台基
    const vr = Math.max(1, Math.min(D(0.3, 1), Math.floor((mp - 5) / 2)));   // 迴廊
    const cw = mp - 2 * vr, hcw = (cw - 1) / 2;            // 正殿殿身
    const bg = D(0.55, 2), cd = Math.max(D(3.9, 11), mp + bg + 4), fg = cd - mp - bg;
    const wh1 = D(0.6, 3), cr = D(0.35, 1), wg = Math.min(D(0.45, 2), wh1 - 1), wW = D(0.45, 2), wb = D(0.6, 3);
    const ph = D(0.22, 1), lw = D(0.75, 2), leh = D(0.33, 2), uw = D(0.22, 1);
    const dw = D(0.33, 3, true), dh = Math.min(wh1 - 1, D(0.55, 2));

    // z 配置（正面 −z）
    const gz0 = pd, gz1 = pd + gd - 1, wz0 = gz1 + 1;
    const zf = Math.max(sd, wz0), zb0 = zf + cd, zb1 = zb0 + bd - 1;
    const zc = zf + fg + hm, z3 = (sd - 1) / 2, zbc = (zb0 + zb1) / 2;

    // ── 中庭石板 ──
    const fx = hW - ww;
    B(-fx, fx, 0, 1, Math.min(sd, wz0), zb0 - 1, 8);

    // ── 左右護龍 ──
    const wxc = hW - (ww - 1) / 2;
    let wingTop = 0;
    mirrorX(v, 1, (vv, sg) => {
      Wl(sg * (hW - ww + 1), sg * hW, 0, 1, wz0, zb0 - 1, 1);
      Wl(sg * (hW - ww + 1), sg * hW, 1, wW, wz0, zb0 - 1, 0);
      const win = { y: 2, z: (wz0 + zb0 - 1) / 2, cols: Math.max(2, Math.floor((zb0 - wz0) / 5)), stepX: 5,
                    w: 2, h: Math.max(1, wW - 2), c: 10, axis: 'z' };
      windowGrid(v, Object.assign({ x: sg * (hW - ww + 1) }, win));
      windowGrid(v, Object.assign({ x: sg * hW }, win));
      const top = roofZ(sg * wxc, ww + 2, wz0, zb0 - 1, 1 + wW);
      B(sg * wxc, sg * wxc, top + 1, rh, wz0, zb0 - 1, ridgeC);
      wingTop = top + rh;
    });

    // ── 龍門、虎門 ──
    mirrorX(v, 1, (vv, sg) => {
      const xa = sg * (hs + 1), xb = sg * hW, gx = sg * Math.round((hs + 1 + hW) / 2);
      Wl(xa, xb, 0, 1, gz0, gz1, 1);
      Wl(xa, xb, 1, wg, gz0, gz1, 0);
      B(gx - 1, gx + 1, 1, Math.max(2, wg - 1), gz0, gz0, 6);
      const top = roofX(xa, sg * (hW + 1), gz0 - 1, gz1 + 1, 1 + wg);
      ridgeX(xa, sg * (hW + 1), (gz0 + gz1) / 2, top + 1, sg < 0 ? 0.65 : 0, sg > 0 ? 0.65 : 0);
    });

    // ── 三川殿 ──
    Wl(-(hs + 1), hs + 1, 0, 1, -1, sd - 1, 1);            // 台基
    B(-(hs + 1), hs + 1, 0, 1, -1, pd - 1, 1);             // 步口地坪
    Wl(-hs, hs, 1, wh1, pd, sd - 1, 0);                    // 牆
    Wl(-hc, hc, 1 + wh1, cr, pd, sd - 1, 0);               // 中港升起
    B(-(dw - 1) / 2, (dw - 1) / 2, 1, dh, pd, pd, 6);      // 中門
    B(-(dw - 1) / 2, (dw - 1) / 2, 1 + dh, 1, pd, pd, 5);  // 匾
    const sdx = Math.floor((hc + 1 + hs) / 2);
    const sdw = (sdx + (dw - 1) / 2 <= hs - 1 && sdx - (dw - 1) / 2 > hc) ? dw : 1;
    mirrorX(v, sdx, (vv, dx) => B(dx - (sdw - 1) / 2, dx + (sdw - 1) / 2, 1, Math.max(2, dh - 1), pd, pd, 6));
    mirrorX(v, 1, (vv, sg) => {                            // 兩側小港（較低）
      const top = roofX(sg * hc, sg * (hs + 1), -2, sd + 1, 1 + wh1);
      const yr = ridgeX(sg * hc, sg * (hs + 1), z3, top + 1, sg < 0 ? 0.75 : 0, sg > 0 ? 0.75 : 0);
      const mx = sg * Math.round((hc + hs + 1) / 2);
      B(mx, mx, yr, 1, z3, z3, 9); B(mx, mx, yr + 1, 1, z3, z3, 5);
    });
    const ctop = roofX(-(hc + 1), hc + 1, -2, sd + 1, 1 + wh1 + cr);   // 中港（升起 cr 層）
    const cyr = ridgeX(-(hc + 1), hc + 1, z3, ctop + 1, 1, 1);
    if (hc + 1 >= 5) mirrorX(v, 1, (vv, sg) => dragon(sg * hc, sg * 2, cyr, z3));
    pagoda(0, cyr, z3, Math.max(1, D(0.3, 1) - 1));
    // 銅鑄龍柱：5 格寬的圓柱，金色那三格每往上一層轉 90°，盤成螺旋；整根落在中港的簷下
    const br = Math.max(0.75, s * 0.23);
    const bx = Math.max(1, Math.min(hc + 1 - Math.ceil(br), (dw - 1) / 2 + Math.ceil(br) + 1));
    mirrorX(v, bx, (vv, dx) => vv.cyl(dx, 1, 0, br, wh1 + cr, (x, y, z) => {
      const k = Math.round((Math.atan2(z, x - dx) + Math.PI) / (Math.PI / 4)) % 8;
      return ((k + 2 * y) % 8) < 3 ? 5 : 7;
    }));
    mirrorX(v, hs, (vv, dx) => vv.box(dx, 1, 0, 1, wh1, 1, 1));       // 角落石柱

    // ── 後殿 ──
    const cwb = Math.min(D(1.5, 5, true), W - 6), hcb = (cwb - 1) / 2;
    Wl(-hW, hW, 0, 1, zb0, zb1, 1);
    Wl(-hW, hW, 1, wb, zb0, zb1, 0);
    Wl(-hcb, hcb, 1 + wb, cr, zb0, zb1, 0);
    windowGrid(v, { x: 0, y: 2, z: zb0, cols: 2 * Math.max(1, Math.floor(hW / 6)), stepX: 6,
                    w: 2, h: Math.max(1, wb - 3), c: 10 });
    B(-(dw - 1) / 2, (dw - 1) / 2, 1, Math.min(wb - 1, dh), zb0, zb0, 6);
    mirrorX(v, 1, (vv, sg) => {
      const top = roofX(sg * hcb, sg * (hW + 1), zb0 - 1, zb1 + 1, 1 + wb);
      ridgeX(sg * hcb, sg * (hW + 1), zbc, top + 1, sg < 0 ? 0.7 : 0, sg > 0 ? 0.7 : 0);
    });
    const btop = roofX(-(hcb + 1), hcb + 1, zb0 - 1, zb1 + 1, 1 + wb + cr);
    const byr = ridgeX(-(hcb + 1), hcb + 1, zbc, btop + 1, 0.9, 0.9);
    if (hcb + 1 >= 5) mirrorX(v, 1, (vv, sg) => dragon(sg * hcb, sg * 2, byr, zbc));
    pagoda(0, byr, zbc, Math.max(1, D(0.3, 1) - 1));

    // ── 正殿（圓通寶殿）：台基、迴廊、殿身、重簷歇山 ──
    v.walls(0, 1, zc, mp, ph, mp, (x, y, z) => (y === ph ? 0 : 1), vr + 1);
    stairs(v, 0, 1, zc - hm - ph, ph, D(0.45, 3, true), 'z', 1);
    const nc = 2 * D(0.3, 1), cs = 2 * (hm - 1) / (nc - 1);
    mirrorZ(v, hm - 1, (vv, dz) => rowOf(vv, nc, cs, (w2, p) => w2.box(sr(p), ph + 1, zc + dz, 1, lw, 1, 1), 0));
    mirrorX(v, hm - 1, (vv, dx) => rowOf(vv, nc, cs, (w2, p) => w2.box(dx, ph + 1, zc + sr(p), 1, lw, 1, 1), 0));
    const cellaH = lw + leh + uw, yU = ph + lw + leh;
    Wl(-hcw, hcw, ph + 1, cellaH, zc - hcw, zc + hcw, (x, y, z) =>
      y > yU ? ((Math.abs(x) + Math.abs(z - zc)) % 3 === 0 ? 6 : 10) : 0);
    windowGrid(v, { x: 0, y: ph + 1, z: zc - hcw, cols: 3, w: dw, h: Math.max(1, lw - 1),
                    stepX: Math.max(dw + 1, Math.round(cw / 3.2)), c: 6 });
    mirrorX(v, hcw, (vv, dx) => windowGrid(vv, { x: dx, y: ph + 2, z: zc, cols: 2, w: 2, h: Math.max(1, lw - 2),
                    stepX: Math.max(3, Math.round(cw / 2.5)), c: 10, axis: 'z' }));
    const yLe = ph + 1 + lw, A = mp + 2, tLe = Math.max(3, 3 - leh + vr);
    boxTaper(v, { x: 0, y: yLe, z: zc, w: A, d: A, w1: A - 2 * (leh - 1), d1: A - 2 * (leh - 1), h: leh, c: 2, t: tLe });
    const yH = ph + 1 + cellaH;
    boxTaper(v, { x: 0, y: yH, z: zc, w: cw + 4, d: cw + 4, w1: cw, d1: cw, h: 3, c: 2, t: 3 });
    const gw = cw - 2, hg = (gw - 1) / 2, yG = yH + 3, ng = (gw - rt) / 2 + 1;
    boxTaper(v, { x: 0, y: yG, z: zc, w: gw, d: gw, w1: gw, d1: rt, h: ng, t: 2,
      c: (x, y, z) => (Math.abs(x) >= hg - 1 && Math.abs(z - zc) >= hg - (y - yG) - 1) ? 3 : 2 });
    const hr = hg + 1, yTop = ridgeX(-hr, hr, zc, yG + ng, 1, 1);
    if (hr >= 5) mirrorX(v, 1, (vv, sg) => dragon(sg * (hr - 1), sg * 2, yTop, zc));
    pagoda(0, yTop, zc, D(0.3, 1));
    const ha = (A - 1) / 2, hh = (cw + 3) / 2;
    corners4(v, ha, ha, (vv, x, z) => qiao(x, yLe, zc + z, Math.atan2(z, x) * 180 / Math.PI, x, zc + z, qlen));
    corners4(v, hh, hh, (vv, x, z) => qiao(x, yH, zc + z, Math.atan2(z, x) * 180 / Math.PI, x, zc + z, qlen));

    // ── 鐘樓、鼓樓：六角，腰簷＋鐘室開口＋轎頂 ──
    const R = Math.max(2.2, s * 0.42), ym = wingTop + 1, th = ym + 1 + D(0.45, 2);
    const tower = (xt, zt) => {
      const tc = (x, y, z) => {
        if (y >= ym + 2 && y < th) {
          const m = ((Math.atan2(z - zt, x - xt) * 180 / Math.PI) % 60 + 60) % 60;
          if (m > 13 && m < 47) return 10;
        }
        return 0;
      };
      for (let y = 1; y <= th; y++) hexLayer(xt, y, zt, R, tc, 1.6);
      hexLayer(xt, ym, zt, R + 2, 2, 2.4);                 // 腰簷
      hexLayer(xt, ym + 1, zt, R + 1, 2, 1.6);
      hexLayer(xt, th + 1, zt, R + 2, 2, 2.4);             // 頂簷
      let y = th + 2;
      for (let r = R + 1; r >= 0.9; r -= 1, y++) hexLayer(xt, y, zt, r, 2, r > 2.5 ? 2 : 0);   // 轎頂
      B(xt, xt, y, 1, zt, zt, 5);                          // 寶頂（葫蘆）
      v.cyl(xt, y + 1, zt, 0.8, 2, 5);
      B(xt, xt, y + 3, 1, zt, zt, 5);
      for (let k = 0; k < 6; k++) qiao(xt + Math.round(R + 1.5), th + 1, zt, k * 60, xt, zt, Math.max(1, qlen - 1));
    };
    mirrorX(v, wxc, (vv, dx) => tower(dx, wz0 + Math.round(R) + 1));

    // ── 中庭香爐 ──
    const ir = Math.max(1.4, s * 0.2);
    revolve(v, { x: 0, y: 1, z: zf + Math.max(2, Math.floor(fg / 2)), c: 7,
                 prof: [[ir * 0.7, 0], [ir, 1], [ir, 2.5], [ir * 1.15, 3]] });
  }
});
