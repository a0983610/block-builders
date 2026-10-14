// 檔名：三色糰子與熱茶.js
// v1.286.0 盲測：子 agent 只拿〈藍圖製作說明〉、從零做出來的第二輪定稿，原樣收進來（只改了 name 與檔名那一行；見 開發筆記〈盲測第二回：三座粗糙的自訂藍圖重做、prompt 兩輪對照（v1.286.0）〉）
// 正面（站在前面看）：前排一個深灰長盤，盤上橫躺一串糰子——左粉、中白、右綠，竹籤柄往右伸出；
//                     左後方木茶托上一只藍釉湯呑，杯高約糰子的兩倍半，杯口冒兩縷白色熱氣
// 側面（從右邊看）：前低後高——前面是長盤與一顆糰子的圓，後面是茶托＋筒型湯呑（腰微鼓、口略收），熱氣往上飄
// 三樣識別物：粉白綠三顆串在竹籤上的糰子、湯呑裡黃綠色的茶面、杯口上方的熱氣
// 部件：長盤(box)＋盤腳(walls)＋盤緣(walls)、糰子×3(blob)＋下半陰影(tint)、竹籤(line)、
//       茶托(revolve)＋托緣(cyl)＋木紋(tint)、湯呑杯腳(cyl)＋杯底(cyl)＋杯身(revolve)＋下段深釉(revolve)、
//       內釉(revolve)＋白杯口(tint)、茶面(cyl)、熱氣×2(plate)、杯上的櫻花紋(paintFrom)
// 實物尺寸（cm）：糰子直徑 3（小尺寸放大到約 4.5、大尺寸約 4，讓它當主角）、竹籤約 13、長盤 15×7、茶托直徑 11、湯呑口徑 7.2／高 8.5
customBlueprint({
  name: '三色糰子與熱茶',
  pal: ['#3a3e45',   // 0 長盤（炭灰釉）
        '#24272c',   // 1 盤腳（陰影）
        '#e2708f',   // 2 粉糰子
        '#c2546f',   // 3 粉糰子陰影
        '#ebe5d6',   // 4 白糰子
        '#bdb4a2',   // 5 白糰子陰影
        '#7aa85a',   // 6 綠糰子（艾草）
        '#5a8442',   // 7 綠糰子陰影
        '#c9a26a',   // 8 竹籤
        '#2e5793',   // 9 湯呑藍釉
        '#213e6a',   // 10 湯呑下段深釉
        '#dcd6c8',   // 11 內釉、杯口
        '#9b7454',   // 12 杯腳（素燒土色）
        '#a3ad3c',   // 13 煎茶
        '#7a4a2a',   // 14 茶托（木）
        '#5a341e',   // 15 茶托木紋
        '#e4e8ea',   // 16 熱氣
        '#565b63'],  // 17 盤緣（亮一階）
  lo: 0.6, hi: 5,

  gen(v, s) {
    const k = s;                                       // 1 cm ＝ k 格
    const odd = n => (n % 2 ? n : n + 1);
    const H = (x, y, z) => (((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) >>> 0) % 100;

    // ── 糰子與竹籤的尺寸（先算，盤子才知道要多大） ──
    // 半徑一律是「整數＋0.45」：剛過整數的半徑會在頭頂冒一格尖。
    // 帶截距（1.5 ＋ 1.4k）：小尺寸時放大一點才圓得起來，大尺寸回到接近真實比例
    const r = Math.max(2.45, Math.floor(1.5 + 1.4 * k) + 0.45), ry = r;
    const sp = r * 1.8;                                // 相鄰兩顆的中心距：壓在一起
    const tipOut = Math.max(1, Math.round(0.5 * k));   // 籤尖露出粉糰子
    const L = Math.max(Math.round(13 * k),
                       Math.round(2 * r + 2 * sp + tipOut + Math.max(3, 4 * k)));   // 竹籤全長

    // ── 長盤：盤腳（內縮一圈的環）→ 盤身 → 盤緣 ──
    const PL = Math.max(dim(s, 15, 13, true), odd(L + 4));
    const PW = Math.max(dim(s, 7, 7, true), odd(Math.ceil(2 * r) + 4));
    const fh = dim(s, 0.35, 1), slabT = dim(s, 0.35, 1), rimH = dim(s, 0.35, 1);
    const inset = Math.max(1, Math.round(0.8 * k));
    const px = -Math.round(2 * k), pz = -Math.round(3.5 * k);
    v.walls(px, 0, pz, PL - 2 * inset, fh, PW - 2 * inset, 1, 1);   // 盤腳
    v.box(px, fh, pz, PL, slabT, PW, 0);                            // 盤身
    v.walls(px, fh + slabT, pz, PL, rimH, PW, 17, 1);               // 盤緣
    const top = fh + slabT;                            // 盤面上的第一層

    // ── 三顆糰子：從籤尖往柄排，粉 → 白 → 綠（籤尖在 +x、柄在 −x） ──
    const xa = px - Math.floor(L / 2), xb = xa + L - 1;
    const cy = top - 1 + Math.floor(ry);               // 最底那層壓進盤面一格
    const bx0 = Math.round(xb - tipOut - r);
    const balls = [[bx0, 2, 3], [Math.round(bx0 - sp), 4, 5], [Math.round(bx0 - 2 * sp), 6, 7]];
    for (const [bx, c, cs] of balls) {
      blob(v, bx, cy, pz, r, ry, r, c);
      for (let y = top; y - cy < -0.4 * ry; y++) {     // 下半部一階陰影：每一層只掃那一片圓
        const rr = r * Math.sqrt(Math.max(0, 1 - ((y - cy) / ry) ** 2)), n = Math.floor(rr);
        for (let x = -n; x <= n; x++) {
          const m = Math.floor(Math.sqrt(Math.max(0, rr * rr - x * x)));
          for (let z = -m; z <= m; z++) tint(v, bx + x, y, pz + z, cs);
        }
      }
    }
    v.line(xa, cy, pz, xb, cy, pz, 8);                 // 竹籤：穿過三顆中心，兩端露出來

    // ── 茶托：木頭旋出來的淺托，頂上一圈托緣 ──
    const chR = Math.max(4.5, 5.5 * k);
    const chH = dim(s, 0.8, 3);
    const ccx = px + Math.round(PL / 2 - chR * 0.35);
    const ccz = pz + Math.ceil(PW / 2) + 1 + Math.ceil(chR);
    revolve(v, { x: ccx, y: 0, z: ccz, c: 14, prof: [[chR * 0.86, 0], [chR, chH - 2]] });
    const tyc = chH - 2, CR = Math.floor(chR);        // 托面那一層：木紋，只掃每三排的那一排
    for (let z = -CR + (CR % 3); z <= CR; z += 3) {
      const m = Math.floor(Math.sqrt(chR * chR - z * z));
      for (let x = -m; x <= m; x++)
        if (H(x, tyc, z) < 80) tint(v, ccx + x, tyc, ccz + z, 15);
    }
    v.cyl(ccx, chH - 1, ccz, chR - 0.35, 1, 14, 1);    // 托緣

    // ── 湯呑：杯腳 → 杯底 → 茶面 → 杯身（筒型：腰微鼓、口略收，不往外擴）──
    const y0 = chH - 1;                                // 坐在托緣圍起來的那一層
    const R0 = Math.max(2.7, 3.6 * k);                 // 杯口半徑
    const bh = dim(s, 7.9, 8), ht = bh - 1;            // 杯身層數
    const P = [[R0 * 0.97, 0], [R0 * 1.03, Math.round(ht * 0.3)],
               [R0 * 1.03, Math.round(ht * 0.8)], [R0, ht]];
    const rAt = h => {
      for (let i = 1; i < P.length; i++)
        if (h <= P[i][1]) {
          const [ra, ha] = P[i - 1], [rb, hb] = P[i];
          return ra + (rb - ra) * (h - ha) / (hb - ha);
        }
      return P[P.length - 1][0];
    };
    const fH = dim(s, 0.4, 1);
    const by = y0 + fH;                                // 杯身最底層
    v.cyl(ccx, y0, ccz, P[0][0] * 0.85 - 0.35, fH, 12, 1);   // 杯腳（高台）
    v.cyl(ccx, by, ccz, P[0][0] - 0.35, 1, 10);        // 杯底
    const tl = Math.min(ht - 2, Math.round(ht * 0.78));
    v.cyl(ccx, by + tl, ccz, rAt(tl) - 0.8, 1, 13);    // 茶面：先畫，杯壁再蓋過它的外緣
    revolve(v, { x: ccx, y: by, z: ccz, c: 9, shell: 1, prof: P });                 // 杯身
    const hb = Math.max(1, Math.round(ht * 0.22));
    revolve(v, { x: ccx, y: by, z: ccz, c: 10, shell: 1, prof: [[P[0][0], 0], [rAt(hb), hb]] });  // 下段深釉
    revolve(v, { x: ccx, y: by + tl + 1, z: ccz, c: 11, shell: 1,
                 prof: [[rAt(tl + 1) - 1, 0], [rAt(ht) - 1, ht - tl - 1]] });     // 茶面以上的內釉
    const yr = by + ht, Ro = rAt(ht) + 0.6, Ri = Math.max(0, rAt(ht) - 2.6);   // 杯口那一層塗白：只掃那一圈
    for (let x = -Math.floor(Ro); x <= Math.floor(Ro); x++) {
      const zo = Math.floor(Math.sqrt(Ro * Ro - x * x));
      const zi = Math.abs(x) < Ri ? Math.ceil(Math.sqrt(Ri * Ri - x * x)) : 0;
      for (let z = zi; z <= zo; z++) {
        tint(v, ccx + x, yr, ccz + z, 11);
        if (z) tint(v, ccx + x, yr, ccz - z, 11);
      }
    }

    // ── 杯身正面的櫻花紋（五瓣），從杯心往 −z 找杯面 ──
    const fr = Math.max(1.5, 1.15 * k), pd = fr * 0.6, pr = fr * 0.38;   // 花瓣小、離中心遠，五瓣之間才有缺口
    const fy = by + Math.round(ht * 0.5), F = Math.ceil(fr) + 1;
    for (let i = -F; i <= F; i++)
      for (let j = -F; j <= F; j++) {
        let hit = Math.hypot(i, j) <= Math.max(0.6, fr * 0.3);
        for (let p = 0; p < 5; p++) {
          const a = Math.PI / 2 + p * Math.PI * 2 / 5;
          if (Math.hypot(i - pd * Math.cos(a), j - pd * Math.sin(a)) <= pr + 0.35) hit = true;
        }
        if (hit) paintFrom(v, ccx + i, fy + j, ccz, 0, 0, -1, Math.ceil(rAt(ht)) + 3,
                           Math.hypot(i, j) <= Math.max(0.6, fr * 0.25) ? 3 : 2);   // 花心深一階
      }

    // ── 熱氣：兩縷 S 形，從茶面長出來（接在茶面上，不懸空） ──
    const sw = Math.max(1.6, 0.6 * k), st = Math.max(1, Math.round(0.5 * k));
    const rise = Math.max(5, 4.8 * k), Rt = rAt(ht), ty0 = by + tl;
    plate(v, { plane: 'xy', at: ccz, t: st, w: sw, c: 16,
               pts: [[ccx - 0.35 * Rt, ty0], [ccx - 0.1 * Rt, yr + rise * 0.25],
                     [ccx - 0.5 * Rt, yr + rise * 0.6], [ccx - 0.2 * Rt, yr + rise]] });
    plate(v, { plane: 'xy', at: ccz + Math.round(0.3 * Rt), t: st, w: sw, c: 16,
               pts: [[ccx + 0.35 * Rt, ty0], [ccx + 0.6 * Rt, yr + rise * 0.3],
                     [ccx + 0.25 * Rt, yr + rise * 0.6], [ccx + 0.45 * Rt, yr + rise * 0.8]] });
  }
});
