// 檔名：新竹火車站.js
// v1.286.0 盲測：子 agent 只拿〈藍圖製作說明〉、從零做出來的第一輪定稿，原樣收進來（只改了 name 與檔名那一行；見 開發筆記〈盲測第二回：三座粗糙的自訂藍圖重做、prompt 兩輪對照（v1.286.0）〉）
// 正面：橫長、左右對稱的低矮站房；正中央一座方形鐘塔拔高（四面圓鐘、盔形銅頂加尖針），
//       塔腳是往前突出的拱圈門廊、兩側瓶狀圓柱；主站房兩層、兩翼一層，屋簷下一排半圓拱窗，
//       最外兩端是正面朝前的德式階梯山牆。
// 側面：最前面是門廊與鐘塔，主站房是很陡的馬薩式屋頂（下段急斜、上段平緩），
//       前坡開兩個牛眼窗老虎窗；背後（+z）接月台、雨遮與鐵軌。
// 三樣識別物：中央盔形銅頂四面鐘塔、陡斜的灰綠馬薩式屋頂＋牛眼窗、拱圈門廊配瓶狀柱與兩端階梯山牆。
// 部件：台基 門廊前台基 主站房牆 兩翼 端部山牆樓 洗石子雜色 轉角石 腰線 三段簷口
//       馬薩式屋頂(下段急斜環＋上段緩坡) 牛眼窗老虎窗 兩翼緩坡屋頂 階梯山牆＋山尖飾 山牆牛眼窗
//       鐘塔(淺灰鐵皮) 四面鐘 塔簷 盔形銅頂 尖針 拱圈門廊 瓶狀圓柱(revolve) 門廊簷 木門與拱頂氣窗
//       上下兩種拱窗(含窗台、拱心石) 月台 雨遮(柱列) 鐵軌與枕木
customBlueprint({
  name: '新竹火車站',
  pal: ['#a19b8d',   // 0 洗石子牆（本色）
        '#6c675d',   // 1 台基、腰線、簷口、月台（暗一階）
        '#c3bba6',   // 2 窗台、拱心石、轉角石、瓶狀柱（亮一階）
        '#3f5a50',   // 3 屋頂（灰綠銅瓦）、雨遮
        '#5d8b79',   // 4 鐘塔盔形銅頂
        '#29333d',   // 5 窗玻璃
        '#e9e1c9',   // 6 鐘面
        '#5b3f2c',   // 7 木門、枕木
        '#8e887b',   // 8 洗石子雜色（暗）
        '#3b3d41',   // 9 鋼：鐵軌、雨遮柱、尖針、指針
        '#9ba1a3',   // 10 鐘塔淺灰鐵皮
        '#aea899',   // 11 洗石子雜色（亮）
        '#87837a'],  // 12 月台水泥
  lo: 2.5, hi: 11,

  gen(v, s) {
    // ── 輔助（寫在 gen 裡面）
    const boxR = (xa, xb, ya, yb, za, zb, c) =>          // 用「起訖格」畫長方體，免得偶數寬偏半格
      v.box((xa + xb) / 2, ya, (za + zb) / 2, xb - xa + 1, yb - ya + 1, zb - za + 1, c);
    const H = (x, y, z) => (((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) >>> 0) % 100;
    const speck = (x, y, z) => {                          // 洗石子雜色：只換已經有的格子
      const h = H(x, y, z);
      if (h < 20) tint(v, x, y, z, 8); else if (h < 30) tint(v, x, y, z, 11);
    };
    const texZ = (xa, xb, ya, yb, z) => { for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) speck(x, y, z); };
    const texX = (x, za, zb, ya, yb) => { for (let y = ya; y <= yb; y++) for (let z = za; z <= zb; z++) speck(x, y, z); };
    const archWin = (x, y, z, w, h) => {                  // 朝 ±z 的牆上一扇半圓拱窗
      const hw = (w - 1) / 2;
      for (let dy = 0; dy < h; dy++) for (let dx = -hw; dx <= hw; dx++) tint(v, x + dx, y + dy, z, 5);
      if (w >= 3) for (let dx = -hw + 1; dx <= hw - 1; dx++) tint(v, x + dx, y + h, z, 5);
      tint(v, x, y + h + (w >= 3 ? 1 : 0), z, 2);                      // 拱心石
      for (let dx = -hw; dx <= hw; dx++) tint(v, x + dx, y - 1, z, 2);  // 窗台
    };
    const archWinX = (x, y, z, w, h) => {                 // 朝 ±x 的側牆上一扇拱窗
      const hw = (w - 1) / 2;
      for (let dy = 0; dy < h; dy++) for (let dz = -hw; dz <= hw; dz++) tint(v, x, y + dy, z + dz, 5);
      if (w >= 3) for (let dz = -hw + 1; dz <= hw - 1; dz++) tint(v, x, y + h, z + dz, 5);
      tint(v, x, y + h + (w >= 3 ? 1 : 0), z, 2);
    };

    // ── 尺寸（全部跟著 s）
    const mw  = dim(s, 3.4, 11, true);   // 主站房面寬（奇數，中軸對稱）
    const md  = dim(s, 1.9, 7);          // 主站房進深
    const mh  = dim(s, 1.3, 4);          // 主站房牆高（兩層）
    const rh1 = dim(s, 0.75, 2);         // 馬薩式屋頂下段（急斜）層數
    const ww  = dim(s, 0.95, 3);         // 兩翼面寬
    const wd  = Math.max(3, md - 3);     // 兩翼進深（前退 1、後退 2）
    const wh  = dim(s, 0.85, 3);         // 兩翼牆高（一層）
    const ew  = dim(s, 0.9, 3, true);    // 端部山牆樓面寬（奇數：山牆對稱）
    const ed  = wd + 2;                  // 端部山牆樓進深（比兩翼前後各凸 1）
    const eh  = wh + dim(s, 0.3, 1);     // 端部山牆樓牆高
    // 鐘塔邊長（奇數）：小 5、中 7、大 9——只用 dim 的話不是小尺寸太粗、就是大尺寸像城堡
    const tw  = 2 * Math.round((2.5 + 0.7 * s) / 2) + 1;
    const pw  = tw;                      // 門廊面寬 ＝ 塔寬（門廊就是塔腳往前凸）
    const pd  = dim(s, 0.4, 2);          // 門廊往前凸幾格
    const ph  = dim(s, 1.15, 4);         // 門廊高
    const sh  = dim(s, 0.25, 1);         // 階梯山牆每一階的高（小尺寸 1 ＝ 一般三角山牆）

    const X0  = (mw - 1) / 2;            // 主站房側牆的 x
    const XE  = X0 + ww + ew;            // 整排最外緣的 x
    const zF  = Math.round(-(md - 1) / 2);   // 主站房正面那片牆的 z
    const zB  = zF + md - 1;             // 主站房背面那片牆的 z
    const T   = (tw - 1) / 2;
    const zT0 = zF - pd + 1;             // 鐘塔正面的 z（比門廊退 1 格）
    const tz  = zT0 + T;                 // 鐘塔中心 z
    const wcx = X0 + ww / 2 + 0.5;       // 右翼中心 x
    const wzc = zF + 1 + (wd - 1) / 2;   // 兩翼中心 z
    const ex  = X0 + ww + (ew + 1) / 2;  // 右端山牆樓中心 x
    const ezc = zF + (ed - 1) / 2;
    const yr  = 2 + mh;                  // 主屋頂起點

    // ── 月台、雨遮、鐵軌（背面 +z）：先畫，站房蓋上去會蓋掉重疊的格子
    const pdp = dim(s, 0.8, 3);
    const zc0 = zF + wd + 1, zc1 = zB + pdp;
    boxR(-XE, XE, 0, 0, zB + 1, zc1, 12);                       // 月台
    boxR(-XE + 1, XE - 1, wh, wh, zc0, zc1, 3);                  // 雨遮（接在兩翼簷下）
    const csp = dim(s, 1.1, 4);
    rowOf(v, Math.max(2, Math.floor((2 * XE - 2) / csp) + 1), csp,
          (vv, px) => vv.box(Math.round(px), 1, zc1 - 1, 1, wh - 1, 1, 9), 0);   // 雨遮柱
    const g = dim(s, 0.3, 2);                                    // 軌距
    const zr1 = zc1 + 2, zr2 = zr1 + g;
    rowOf(v, XE + 1, 2, (vv, px) => vv.box(Math.round(px), 0, (zr1 + zr2) / 2, 1, 1, g + 3, 7), 0);  // 枕木
    boxR(-XE, XE, 1, 1, zr1, zr1, 9);                            // 鐵軌
    boxR(-XE, XE, 1, 1, zr2, zr2, 9);

    // ── 台基
    boxR(-XE - 1, XE + 1, 0, 0, zF - 1, zB + 1, 1);
    boxR(-(pw + 1) / 2 - 2, (pw + 1) / 2 + 2, 0, 0, zF - pd - 2, zF - 1, 1);

    // ── 主量體：主站房（兩層）、兩翼（一層）、端部山牆樓
    v.walls(0, 1, 0, mw, mh, md, 0, 1);
    mirrorX(v, 1, (vv, sg) => {
      vv.walls(sg * wcx, 1, wzc, ww, wh, wd, 0, 1);
      vv.walls(sg * ex, 1, ezc, ew, eh, ed, 0, 1);
    });

    // ── 洗石子雜色、轉角石（只塗看得到的正面與外側）
    texZ(-X0, X0, 1, mh, zF);
    mirrorX(v, 1, (vv, sg) => {
      const a = sg > 0 ? X0 + 1 : -X0 - ww, b = sg > 0 ? X0 + ww : -X0 - 1;
      texZ(a, b, 1, wh, zF + 1);
      const ea = sg > 0 ? X0 + ww + 1 : -XE, eb = sg > 0 ? XE : -X0 - ww - 1;
      texZ(ea, eb, 1, eh, zF);
      texX(sg * XE, zF, zF + ed - 1, 1, eh);
      for (let y = 1; y <= mh; y += 2) tint(vv, sg * X0, y, zF, 2);
      for (let y = 1; y <= eh; y += 2) { tint(vv, sg * XE, y, zF, 2); tint(vv, sg * (X0 + ww + 1), y, zF, 2); }
    });

    // ── 腰線（主站房上下兩層的分界）
    const yb = 1 + Math.round(mh * 0.5);
    for (let x = -X0; x <= X0; x++) tint(v, x, yb, zF, 1);
    for (let z = zF; z <= zB; z++) { tint(v, X0, yb, z, 1); tint(v, -X0, yb, z, 1); }

    // ── 簷口（深一階，橫過整棟）
    v.box(0, 1 + mh, 0, mw + 2, 1, md + 2, 1);
    mirrorX(v, 1, (vv, sg) => {
      vv.box(sg * wcx, 1 + wh, wzc, ww, 1, wd + 2, 1);
      vv.box(sg * ex, 1 + eh, ezc, ew + 2, 1, ed, 1);
    });

    // ── 主站房馬薩式屋頂：下段急斜（中空環），上段每層四邊各收 2 格的緩坡
    for (let i = 0; i < rh1; i++) {
      const ins = i < rh1 / 2 ? 0 : 1;
      v.walls(0, yr + i, 0, mw - 2 * ins, 1, md - 2 * ins, 3, 2);
    }
    let yy = yr + rh1, uw = mw - 4, ud = md - 4;
    while (uw >= 1 && ud >= 1) { v.box(0, yy, 0, uw, 1, ud, 3); uw -= 4; ud -= 4; yy++; }
    const roofTop = yy;

    // ── 前坡兩個牛眼窗老虎窗
    const dwd = dim(s, 0.45, 3, true), dhw = (dwd - 1) / 2, dhh = Math.max(2, rh1 - 1);
    const dxD = Math.max(T + 2 + dhw, Math.round(X0 * 0.55));
    if (dxD + dhw <= X0 - 1) mirrorX(v, dxD, (vv, dx) => {
      boxR(dx - dhw, dx + dhw, yr, yr + dhh - 1, zF - 1, zF, 0);
      vv.gable(dx, yr + dhh, zF - 0.5, dwd, 2, 3);
      // 圓窗：半徑 1 上下用 ≤ r+0.35 會點陣化成十字 → 放寬到 r+0.5（3×3 方圓）＋一圈亮框
      const cy = yr + Math.floor((dhh - 1) / 2), rr = dwd >= 5 ? 1 : 0;
      for (let i = -dhw; i <= dhw; i++) for (let j = -dhw; j <= dhw; j++) {
        const q = Math.hypot(i, j);
        if (q <= rr + 0.5) tint(vv, dx + i, cy + j, zF - 1, 5);
        else if (rr > 0 && q <= rr + 1.5) tint(vv, dx + i, cy + j, zF - 1, 2);
      }
    });

    // ── 兩翼緩坡屋頂（屋脊沿 x，每層前後各收 2 格）
    mirrorX(v, 1, (vv, sg) => {
      for (let i = 0; ; i++) {
        const d = wd + 2 - 4 * i;
        if (d < 1) break;
        vv.box(sg * wcx, 2 + wh + i, wzc, ww, 1, d, 3);
      }
    });

    // ── 端部山牆樓：兩坡屋頂＋前後德式階梯山牆＋山牆牛眼窗
    mirrorX(v, 1, (vv, sg) => {
      const x = sg * ex;
      vv.gable(x, 2 + eh, ezc, ew, ed, 3);
      for (const z of [zF, zF + ed - 1]) {
        let k = 0, w = ew;
        while (w >= 1) { vv.box(x, 2 + eh + k * sh, z, w, sh, 1, 0); k++; w -= 2 * sh; }
        vv.box(x, 2 + eh + k * sh, z, 1, 1, 1, 2);              // 山尖飾
      }
      tint(vv, x, 2 + eh, zF, 5);
    });

    // ── 鐘塔：淺灰鐵皮塔身、四面鐘、塔簷、盔形銅頂、尖針
    const rc = Math.max(1.5, (tw - 3) / 2);                        // 鐘面半徑：塔面留一圈邊
    const yt = roofTop + Math.max(Math.ceil(2 * rc) + 3, dim(s, 1.0, 4)) - 1;   // 塔身只拔到放得下鐘
    v.walls(0, 1, tz, tw, yt, tw, 10, 1);
    const cyc = yt - Math.ceil(rc) - 1;
    const clock = (put) => {
      const R = Math.floor(rc);
      for (let i = -R - 1; i <= R + 1; i++) for (let j = -R - 1; j <= R + 1; j++) {
        const q = Math.hypot(i, j);
        if (q > rc + 0.35) continue;
        put(i, j, rc >= 2 && q > rc - 0.5 ? 1 : 6);                 // 外圈深色框、裡面鐘面
      }
      put(0, 0, 9);                                                // 指針
      for (let k = 1; k <= Math.floor(rc) - 1; k++) put(0, k, 9);
      for (let k = 1; k <= Math.floor(rc) - 2; k++) put(-k, 0, 9);
    };
    clock((i, j, c) => tint(v, i, cyc + j, zT0, c));               // 正面
    clock((i, j, c) => tint(v, -i, cyc + j, zT0 + tw - 1, c));     // 背面
    clock((i, j, c) => tint(v, T, cyc + j, tz + i, c));            // 右側
    clock((i, j, c) => tint(v, -T, cyc + j, tz - i, c));           // 左側
    v.box(0, yt + 1, tz, tw + 2, 1, tw + 2, 1);                    // 塔簷
    // 盔形頂：高度跟塔寬走（不再是瘦高的錐），剖面先直後圓、最後收成一個小頂
    const hh = Math.max(3, Math.round((T + 1) * 1.3)), yh = yt + 2;
    const HP = [[1, 0], [0.97, 0.3], [0.85, 0.55], [0.6, 0.75], [0.3, 0.9], [0.12, 1]];
    const helm = (t) => {
      for (let k = 1; k < HP.length; k++) if (t <= HP[k][1]) {
        const [f0, t0] = HP[k - 1], [f1, t1] = HP[k];
        return f0 + (f1 - f0) * (t - t0) / (t1 - t0);
      }
      return HP[HP.length - 1][0];
    };
    for (let i = 0; i < hh; i++) {
      const half = Math.max(0, Math.round((T + 0.3) * helm(i / hh)));
      v.box(0, yh + i, tz, 2 * half + 1, 1, 2 * half + 1, 4);
    }
    const fh = dim(s, 0.6, 2), big = tw >= 9 ? 1 : 0;
    if (big) v.box(0, yh + hh, tz, 3, 1, 3, 2);                    // 尖針底座
    v.box(0, yh + hh + big, tz, 1, fh, 1, 9);                      // 尖針

    // ── 拱圈門廊：實心量體挖拱，拱後是主站房正面那片牆 → 塗木門與氣窗
    const pzc = zF - pd / 2 - 0.5;
    v.box(0, 1, pzc, pw, ph, pd, 0);
    texZ(-(pw - 1) / 2, (pw - 1) / 2, 1, ph, zF - pd);
    const aw = pw - 2 - (pw >= 11 ? 2 : 0);
    const ah = Math.max(1, ph - 2 - (aw - 1) / 2);
    arch(v, 0, 1, pzc, aw, ah, pd);
    const oh = ah + (aw - 1) / 2 + 1;
    for (let y = 1; y <= oh; y++) for (let x = -(aw - 1) / 2; x <= (aw - 1) / 2; x++) {
      if (v.has(x, y, zF - 1)) continue;                          // 還有積木 ＝ 不在拱洞裡
      tint(v, x, y, zF, y <= ah ? 7 : 5);
    }
    // 瓶狀圓柱（托斯卡納）：下段鼓、上段收、柱頭再放
    const cr = Math.max(0.75, s * 0.17);
    mirrorX(v, (pw - 1) / 2 + 1, (vv, dx) => revolve(vv, { x: dx, y: 1, z: zF - pd, c: 2,
      prof: [[cr, 0], [cr * 1.35, (ph - 1) * 0.3], [cr * 0.9, (ph - 1) * 0.85], [cr * 1.3, ph - 1]] }));
    boxR(-(pw + 1) / 2 - 1, (pw + 1) / 2 + 1, ph + 1, ph + 1, zF - pd - 1, zF - 1, 1);   // 門廊簷

    // 鐘塔正面的長拱窗：門廊簷上面空一層起，頂到鐘面底下空兩層
    const wT = T >= 4 ? 3 : 1, yw0 = ph + 3;
    const hT = (cyc - Math.ceil(rc) - 2) - yw0 - (wT >= 3 ? 1 : 0);
    if (hT >= 2) archWin(0, yw0, zT0, wT, hT);

    // ── 兩種拱窗：主站房上下兩排（正面、背面）、兩翼一排、山牆樓正面一扇＋外側一排
    const wW = dim(s, 0.16, 1, true), hwW = (wW - 1) / 2, top = wW >= 3 ? 1 : 0;
    const h1 = Math.max(1, yb - 2 - top);
    const h2 = Math.max(1, mh - yb - 1 - top);
    const sp = wW + dim(s, 0.3, 2);
    const xa = (pw - 1) / 2 + 1 + Math.ceil(cr) + 2 + hwW, xb = X0 - 1 - hwW;
    if (xb >= xa) {
      const n = Math.floor((xb - xa) / sp) + 1;
      mirrorX(v, 1, (vv, sg) => rowOf(vv, n, sp, (v2, px) => {
        const x = sg * Math.round(px);
        archWin(x, 2, zF, wW, h1);
        archWin(x, yb + 1, zF, wW, h2);
        archWin(x, 2, zB, wW, h1);
      }, (xa + xb) / 2));
    }
    const sp2 = wW + dim(s, 0.45, 2);
    const hw2 = Math.max(1, wh - 2 - top);
    const n2 = Math.max(1, Math.floor((ww - 2 - 2 * hwW) / sp2) + 1);
    const hE = Math.max(1, eh - 3 - top);
    const nz = Math.max(1, Math.floor((ed - 3 - 2 * hwW) / sp2) + 1);
    mirrorX(v, 1, (vv, sg) => {
      rowOf(vv, n2, sp2, (v2, px) => archWin(sg * Math.round(px), 2, zF + 1, wW, hw2), wcx);
      archWin(sg * ex, 2, zF, wW, hE);
      rowOf(vv, nz, sp2, (v2, pz) => archWinX(sg * XE, 2, Math.round(pz), wW, hE), ezc);
    });
  }
});
