// 檔名：舒芙蕾厚鬆餅.js
// v1.287.1 盲測第三回：子 agent 只拿〈藍圖製作說明〉、從零做出來的第一版（沒有任何回饋），原樣收進來（只改了 name 與檔名那一行；見 開發筆記〈盲測第三回：一兩次就要做好（v1.287.0）〉）
// 正面：灰藍色圓盤，偏一邊疊三片很厚的圓餅（側面淡黃、上下兩面金褐，片與片之間一道褐色凹縫），
//       頂上一塊奶油、楓糖漿從頂上往下流；另一邊一球擠花鮮奶油，前面散著紅草莓
// 側面：盤子只有 3～4 層高、外緣微翹；鬆餅疊是高過寬的鼓形圓柱（三片疊起來 ≈ 1.35 倍直徑）
// 三樣識別物：①三層厚到像圓柱的鬆餅（淡黃側面＋金褐夾縫）②頂上奶油＋糖漿滴流＋白色糖粉 ③旁邊白色擠花奶油與紅草莓（綠蒂）
// 比例表（實物）：鬆餅直徑 10 cm、每片厚 4.5 cm（三片疊 13.5 cm；查到：模圈 8～9 cm 寬、三片疊最高約 15 cm）
//   盤子直徑 25 cm、高 2 cm；奶油 3×3×1 cm；鮮奶油直徑 5、高 5 cm；草莓長 3.4、寬 2.9 cm（誇張成長 5、寬 3.6）
// 輪廓寬度（正面，以盤子寬 ＝ 1）：盤子 1.00／盤上 0～0.7R（鬆餅＋草莓）0.74／0.7～1.0R（鬆餅＋鮮奶油）0.63／
//   1.0R 以上（只有鬆餅疊）0.40／奶油 0.12
// 部件尺寸（9000 塊估 s ≈ 8.9，R ＝ s ＝ 鬆餅半徑）：鬆餅直徑 2R ≈ 18 格、每片厚 dim(s,0.92,3) ＝ 8 層、
//   盤子直徑 5R ≈ 45 格、奶油 dim(s,0.6,3,true) ＝ 5 格見方 × dim(s,0.22,2) ＝ 2 層、
//   鮮奶油直徑 R ≈ 9、高 dim(s,1,4) ＝ 9、草莓長 ≈ R ≈ 9、粗 0.72R ≈ 6.4、糖漿流痕寬約 2 格
// 部件：盤足／盤面／翹起的盤緣（自寫圓環）、鬆餅×3（自寫鼓形：上下金褐、側面淡黃、肩部金褐）、頂面微拱、
//   奶油(box)＋融化的奶油、糖漿池＋六道流痕＋盤上一灘(tint)、糖粉（雜湊撒在頂面）、
//   鮮奶油（自寫擠花：8 道扭轉的稜）、草莓×4（自寫錐形膠囊：綠蒂＋黃籽）
customBlueprint({
  name: '舒芙蕾厚鬆餅',
  pal: ['#7f9bb3',   // 0 盤子（灰藍瓷）
        '#566f84',   // 1 盤足、盤口外緣（深一階）
        '#e2bc6a',   // 2 鬆餅側面（淡黃）
        '#b86c2c',   // 3 鬆餅上下兩面的金褐
        '#9c5524',   // 4 金褐的深一階（雜湊撒在烙色上）
        '#6a2e0c',   // 5 楓糖漿
        '#f0cf5e',   // 6 奶油（也當草莓籽）
        '#f2efe8',   // 7 糖粉
        '#ebe4d6',   // 8 鮮奶油
        '#bdb3a1',   // 9 鮮奶油的陰影（擠花的溝、底圈）
        '#cc2a3a',   // 10 草莓
        '#3d8c3a'],  // 11 草莓蒂
  lo: 2.2, hi: 14,

  gen(v, s) {
    const hs = (x, y, z) => (((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) >>> 0) % 100;
    const angDiff = (a, b) => { const d = Math.abs(a - b) % (2 * Math.PI); return d > Math.PI ? 2 * Math.PI - d : d; };
    const DR = Math.PI / 180;

    const R = Math.max(2.5, s);            // 鬆餅半徑：整盤唯一的錨，其餘寫成 R 的倍數
    const H = dim(s, 0.92, 3);             // 每片厚（層）：4.5 cm ÷ 半徑 5 cm
    const base = 2;                        // 盤面在 y=1，盤上的東西從 y=2 放

    // ── 盤子：盤足（暗）＋盤面＋往外翹的盤緣 ──
    const Rp = R * 2.5, Rw = R * 2.05, Rf = R * 1.5;
    const n = Math.ceil(Rp) + 1;
    for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
      const d = Math.hypot(i, j);
      if (d <= Rf + 0.35) v.set(i, 0, j, 1);
      if (d <= Rp - 0.65) v.set(i, 1, j, 0);
      if (d >= Rw && d <= Rp - 0.2) v.set(i, 2, j, 0);
      if (d >= Rp - 1.2 && d <= Rp + 0.3) v.set(i, 3, j, d > Rp - 0.45 ? 1 : 0);
    }

    // ── 鬆餅三片：每一層一個半徑（鼓形：底略收、中間最寬、肩部圓） ──
    const SX = Math.round(-0.65 * R), SZ = Math.round(0.15 * R);
    const offs = [[0, 0], [Math.round(R * 0.07), -Math.round(R * 0.05)], [-Math.round(R * 0.05), Math.round(R * 0.06)]];
    const rad = [];
    for (let ly = 0; ly < H; ly++) {
      const t = (ly + 0.5) / H;
      rad.push(R * Math.sqrt(Math.max(0, 1 - Math.pow(Math.abs(t - 0.45) / 0.62, 4))));
    }
    const domeR = R * 0.55;                // 最上面那片頂面微微拱起
    const topY = base + 3 * H - 1;
    // 糖漿往下流的六道：[角度（0 ＝ +x、−90 ＝ 正面 −z）, 從頂面往下流幾層]
    const drips = [[-95, 3 * H + 2], [-50, Math.round(H * 1.3)], [-140, Math.round(H * 0.7)],
                   [20, Math.round(H * 1.1)], [160, Math.round(H * 0.8)], [85, Math.round(H * 1.6)]];
    const dw = Math.max(0.8, R * 0.1);     // 流痕半寬
    const onDrip = (ang, d, y) => {
      for (const [deg, len] of drips) {
        const arc = angDiff(ang, deg * DR) * d, end = topY - len;
        if (y >= end && arc <= dw) return true;
        if (y >= end - 1 && y <= end + 1 && arc <= dw * 1.6) return true;   // 尾端一滴
      }
      return false;
    };
    const butW = dim(s, 0.6, 3, true), butH = dim(s, 0.22, 2);
    const m = Math.ceil(R) + 1;
    for (let k = 0; k < 3; k++) {
      const cx = SX + offs[k][0], cz = SZ + offs[k][1], y0 = base + k * H, top = k === 2;
      for (let i = -m; i <= m; i++) for (let j = -m; j <= m; j++) {
        const d = Math.hypot(i, j);
        if (d > R + 0.35) continue;
        const ang = Math.atan2(j, i), x = cx + i, z = cz + j;
        const yMax = top && d <= domeR ? H : H - 1;
        for (let ly = 0; ly <= yMax; ly++) {
          const r = ly < H ? rad[ly] : domeR;
          if (d > r + 0.35) continue;
          const y = y0 + ly;
          const upOpen = ly === yMax || (ly === H - 2 && d > rad[H - 1] + 0.35);
          let c = 2;                                                     // 側面淡黃
          if (ly === 0 || ly === H - 1 || upOpen) c = hs(x, y, z) < 30 ? 4 : 3;   // 上下兩面與肩部金褐
          if (d > r - 1.3 && onDrip(ang, d, y)) c = 5;                   // 側面的糖漿流痕
          if (top && upOpen) {                                           // 最上面那片的頂面
            if (d <= butW * 0.85) c = 6;                                 // 融化的奶油
            else {
              const pool = R * (0.6 + 0.1 * Math.sin(3 * ang + 0.7) + 0.06 * Math.sin(5 * ang + 2.1));
              const syr = d <= pool || onDrip(ang, d, y);
              c = hs(x, y, z) < (syr ? 15 : 60 - 30 * d / R) ? 7 : syr ? 5 : c;   // 糖粉撒在上面
            }
          }
          v.set(x, y, z, c);
        }
      }
    }
    // 奶油：放在拱起的頂面上
    v.box(SX + offs[2][0], topY + 2, SZ + offs[2][1], butW, butH, butW, 6);
    // 盤上一灘糖漿（正面那一道流到底）
    const pm = Math.ceil(R * 1.4) + 1, pa = -95 * DR;
    for (let i = -pm; i <= pm; i++) for (let j = -pm; j <= pm; j++) {
      const d = Math.hypot(i, j);
      if (d < R - 0.8 || d > R * 1.4) continue;
      if (angDiff(Math.atan2(j, i), pa) * R <= dw * 1.8 + (d - R) * 0.7) tint(v, SX + i, 1, SZ + j, 5);
    }

    // ── 鮮奶油：擠花，一層一層收、8 道扭轉的稜 ──
    const CX = Math.round(R * 1.0), CZ = Math.round(R * 0.65);
    const Rc = Math.max(1.8, R * 0.5), Hc = dim(s, 1.0, 4);
    const cm = Math.ceil(Rc) + 1;
    for (let ly = 0; ly < Hc; ly++) {
      const t = (ly + 0.5) / Hc;
      const rr = Math.max(1.5, Rc * (1 - Math.pow(t, 1.6)) * (0.93 + 0.07 * Math.cos(t * 4 * Math.PI)));
      for (let i = -cm; i <= cm; i++) for (let j = -cm; j <= cm; j++) {
        const d = Math.hypot(i, j);
        const g = 0.5 + 0.5 * Math.cos(8 * Math.atan2(j, i) + t * 5);   // g 接近 1 是溝
        const lim = rr * (1 - 0.15 * g);
        if (d > lim + 0.35) continue;
        v.set(CX + i, base + ly, CZ + j, ly === 0 || (g > 0.72 && d > lim - 1.3) ? 9 : 8);
      }
    }

    // ── 草莓：錐形膠囊（蒂頭那端粗、尖端細），躺在盤上 ──
    const r0 = Math.max(1.4, R * 0.36), r1 = Math.max(0.8, R * 0.13), BL = Math.max(1.5, R * 0.5);
    const berry = (ax, az, dx, dz) => {     // (ax, az)：蒂頭那端的中心；(dx, dz)：往尖端的方向
      const dl = Math.hypot(dx, dz); dx /= dl; dz /= dl;
      const A = [ax, base + r0 - 0.2, az];
      const B = [ax + dx * BL, base + r1 - 0.2, az + dz * BL];
      const D = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
      const L2 = D[0] * D[0] + D[1] * D[1] + D[2] * D[2], Ld = Math.sqrt(L2);
      const u0 = [D[0] / Ld, D[1] / Ld, D[2] / Ld];
      let e1 = [-u0[1] * u0[0], 1 - u0[1] * u0[1], -u0[1] * u0[2]];      // 垂直於軸、朝上
      const e1l = Math.hypot(e1[0], e1[1], e1[2]); e1 = e1.map(q => q / e1l);
      const e2 = [u0[1] * e1[2] - u0[2] * e1[1], u0[2] * e1[0] - u0[0] * e1[2], u0[0] * e1[1] - u0[1] * e1[0]];
      const xa = Math.floor(Math.min(A[0], B[0]) - r0) - 1, xb = Math.ceil(Math.max(A[0], B[0]) + r0) + 1;
      const za = Math.floor(Math.min(A[2], B[2]) - r0) - 1, zb = Math.ceil(Math.max(A[2], B[2]) + r0) + 1;
      const yb = Math.ceil(A[1] + r0) + 1;
      for (let x = xa; x <= xb; x++) for (let z = za; z <= zb; z++) for (let y = base; y <= yb; y++) {
        const w = [x - A[0], y - A[1], z - A[2]];
        const u = (w[0] * D[0] + w[1] * D[1] + w[2] * D[2]) / L2;
        const uc = Math.min(1, Math.max(0, u));
        const dist = Math.hypot(w[0] - uc * D[0], w[1] - uc * D[1], w[2] - uc * D[2]);
        if (dist > r0 + (r1 - r0) * uc + 0.15) continue;
        const along = u * Ld;                                            // 負的是蒂頭那一端
        const p = [w[0] - u * D[0], w[1] - u * D[1], w[2] - u * D[2]];
        const al = Math.atan2(p[0] * e2[0] + p[1] * e2[1] + p[2] * e2[2], p[0] * e1[0] + p[1] * e1[1] + p[2] * e1[2]);
        let c = 10;
        if (along < -r0 * 0.4 || (along < r0 * 0.3 && Math.cos(5 * al) > 0.35)) c = 11;   // 綠蒂（五片萼）
        else if (hs(x, y, z) < 9) c = 6;                                                    // 黃色的籽
        v.set(x, y, z, c);
      }
    };
    berry(R * 0.55, R * -0.85, -0.95, -0.3);
    berry(R * 1.25, R * -0.65, -0.3, -0.95);
    berry(R * 1.7, R * 0.0, 0.1, 1.0);
    berry(R * 0.4, R * 1.3, 0.3, 0.95);
  }
});
