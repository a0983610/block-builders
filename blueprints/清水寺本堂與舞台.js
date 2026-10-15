// 檔名：清水寺本堂與舞台.js
// v1.288.0 盲測第四回：子 agent 只拿〈藍圖製作說明〉、從零做出來的第二版（看過一次報告＋9000 四視圖），原樣收進來（只改了 name 與檔名那一行；見 開發筆記〈盲測第四回：清水寺、御手洗糰子、水榭戲亭（v1.288.0）〉）
// 正面：下半是一整片「柱＋貫」組成的方格木架，站在往後升高的山坡上；上面是寬寬的舞台與欄杆，
//       左右兩座較低的翼廊、淺色山牆夾著舞台，後面壓著一個巨大的四坡屋頂（簷口平緩、越往上越陡）
// 側面：山坡（樹林）從前方谷底斜升到本堂中段；舞台和本堂前半懸在木架上往前伸，本堂後半坐在山上
// 三樣識別物：①往前伸出、有高欄的木造舞台（淺色檜木地板）
//             ②舞台底下縱橫交錯的欅木柱與貫（懸造）
//             ③檜皮葺的大寄棟屋頂（下緩上陡的反り，深褐色，邊緣一圈淺色軒付）
// 比例表（實物）：本堂含翼廊間口 36 m、奧行 31 m；本堂高約 18 m（地板到屋脊）；
//   舞台高約 13 m、面積約 200 m²；舞台前排柱長約 12 m；身舍桁行 9 間、梁間 7 間；
//   正面左右各一座入母屋造、妻入的翼廊（楽舎），舞台夾在中間；屋頂寄棟造、檜皮葺
//   設計取值（查不到的自己定）：一間 3.6 m；軸部 6 m、屋頂 12 m；翼廊軸部為本堂的 0.7；
//   舞台 6 間寬 × 3 間深 ≈ 21.6 × 10.8 m；翼廊 2 間寬、往前伸 2 間；山坡從舞台前緣斜升到本堂前 3 間
// 輪廓寬度（正面，以大屋頂屋簷全寬 ＝ 1）：山腳 0.91／舞台前排柱 0.51／本堂＋翼廊 0.87／
//   屋簷 1.00／屋頂半高 約 0.6／屋脊 0.33
// 部件尺寸（第一版報告：9000 塊 s = 10.86；這一版估 s ≈ 11）：本堂寬 2·dim(s,1.8)+1 = 41、
//   深 dim(s,2.52) = 28；舞台面高 dim(s,1.3) = 14；柱間約 4 格、柱 1 格、貫 1 格、貫上下間距 3
//   （前排柱上 4 層貫）；軸部 7、屋頂 13 層、出簷 3；翼廊軸部 5；舞台 25 寬 × 14 深；
//   翼廊 9×9 格、山牆 9 格寬 5 層、比大屋頂屋簷高出 4 層；懸魚 2 格；高欄 2 層
// 部件：山坡（逐 z 一條 box＋兩側與背面山壁，樹林色 hash）、礎石（柱的顏色函式）、柱（box）、
//   貫（box 長條，兩端各凸 1 格）、舞台地板（box）、高欄（box 橫木＋短柱）、
//   本堂軸部（walls＋顏色函式：柱／板壁／開著的禮堂／頭貫）、翼廊（walls）、
//   大屋頂（逐層 walls 環，內縮量照 1.6t−0.6t² 做出反り）、軒付（第一層外緣換色）、
//   箱棟與鬼板（box）、翼廊入母屋（walls 裙兩層＋中空兩坡）、破風與淺色妻壁（顏色函式）、懸魚（tint）
customBlueprint({
  name: '清水寺本堂與舞台',
  pal: [
    '#bc9c7a',   // 0 柱、立柱、妻壁（風化的欅木）
    '#957556',   // 1 貫、大引、頭貫（暗一階的木）
    '#523d2f',   // 2 檜皮葺屋頂
    '#2b2420',   // 3 箱棟、鬼板、翼廊屋脊
    '#b89268',   // 4 軒付（屋頂邊緣的檜皮切口）、破風
    '#caa97a',   // 5 舞台地板（檜木板）
    '#33271e',   // 6 開著的禮堂、翼廊內側（暗）
    '#5e4634',   // 7 板壁、蔀戸
    '#3d5530',   // 8 山坡樹林
    '#2f4527',   // 9 樹林暗一階
    '#7a6a58',   // 10 土石
    '#5c5044',   // 11 土石暗一階
    '#d4a640',   // 12 懸魚（金）
    '#8f8a82',   // 13 礎石
    '#7a5c40'],  // 14 高欄
  lo: 1.5, hi: 22,

  gen(v, s) {
    // 範圍寫法的 box／walls：給兩端（含），自動換成中心＋寬
    const B = (xa, xb, y0, y1, za, zb, c) => {
      const x0 = Math.min(xa, xb), x1 = Math.max(xa, xb), z0 = Math.min(za, zb), z1 = Math.max(za, zb);
      if (y1 < y0) return;
      v.box((x0 + x1) / 2, y0, (z0 + z1) / 2, x1 - x0 + 1, y1 - y0 + 1, z1 - z0 + 1, c);
    };
    const W = (xa, xb, y0, y1, za, zb, c, t) => {
      const x0 = Math.min(xa, xb), x1 = Math.max(xa, xb), z0 = Math.min(za, zb), z1 = Math.max(za, zb);
      if (y1 < y0) return;
      v.walls((x0 + x1) / 2, y0, (z0 + z1) / 2, x1 - x0 + 1, y1 - y0 + 1, z1 - z0 + 1, c, t);
    };
    const sym = (k, f) => Math.sign(k) * Math.round(Math.abs(k) * f);

    const hw = dim(s, 1.80, 7);     // 本堂半寬（間口 36 m）
    const D  = dim(s, 2.52, 10);    // 本堂進深（7 間）
    const F  = dim(s, 1.30, 5);     // 舞台面高（13 m）
    const E  = dim(s, 0.60, 3);     // 軸部高（6 m）
    const Hr = dim(s, 1.20, 4);     // 大屋頂高（12 m）
    const oh = dim(s, 0.25, 1);     // 大屋頂出簷
    const ow = dim(s, 0.15, 1);     // 翼廊出簷
    const nt = dim(s, 0.27, 2);     // 貫的上下間距
    const pw = dim(s, 0.09, 1);     // 柱粗
    const Ew = Math.max(2, Math.round(E * 0.7));   // 翼廊軸部高（比本堂低）

    const X = k => sym(k, hw / 5);          // 第 k 條柱列（k = -5…5）
    const Z = r => sym(r, D / 7);           // 第 r 排柱（0 = 本堂正面，負的往前）
    const zs = Z(-3) - 1;                   // 舞台前緣
    const z0 = Z(-3) - 2, z1 = Z(3);        // 山坡：z0 落地，z1 升到舞台面下
    const hx = hw + 1, zb = D + 2;          // 山的兩側與背面
    const ys = z => z <= z0 ? 0 : z >= z1 ? F - 1 : Math.round((F - 1) * (z - z0) / (z1 - z0));
    const PX = new Set(), PZ = new Set();
    for (let k = -5; k <= 5; k++) PX.add(X(k));
    for (let r = -3; r <= 7; r++) PZ.add(Z(r));

    // ── 台基：山坡（頂面與山壁都是樹林，山壁夾一點土石）──
    const green = (x, y, z) => (hash100(x, y, z) < 35 ? 9 : 8);
    const bank = (x, y, z) => { const h = hash100(x, y, z); return h < 15 ? 11 : h < 25 ? 10 : h < 55 ? 9 : 8; };
    for (let z = z0; z <= zb; z++) {
      const y = ys(z);
      if (z < z1 || z >= D) B(-hx, hx, y, y, z, z, green);             // 斜坡、本堂後面
      else { B(-hx, -hw, y, y, z, z, green); B(hw, hx, y, y, z, z, green); }  // 本堂兩側
      B(-hx, -hx, 0, y - 1, z, z, bank); B(hx, hx, 0, y - 1, z, z, bank);      // 兩側山壁
    }
    B(-hx, hx, 0, F - 2, zb, zb, bank);                                  // 背面山壁

    // ── 懸造：先畫貫（每隔 nt 層一圈，沿 x、沿 z，兩端凸出 1 格）──
    const rowK = r => (r === -3 ? 3 : 5);
    for (let y = F - 1; y >= 1; y -= nt) {
      for (let r = -3; r <= 2; r++) {
        if (ys(Z(r)) + 1 > y) continue;
        B(X(-rowK(r)) - 1, X(rowK(r)) + 1, y, y, Z(r), Z(r), 1);
      }
      for (let k = -5; k <= 5; k++) {
        const r0 = Math.abs(k) <= 3 ? -3 : -2;
        if (ys(Z(r0)) + 1 > y) continue;
        let r1 = r0;
        while (r1 < 2 && ys(Z(r1 + 1)) + 1 <= y) r1++;
        const zEnd = y === F - 1 ? z1 : Z(r1) + 1;
        if (r1 > r0 || y === F - 1) B(X(k), X(k), y, y, Z(r0) - 1, zEnd, 1);
      }
    }
    // ── 再畫柱：蓋過貫，從礎石一路通到舞台下 ──
    const pl = Math.floor((pw - 1) / 2), ph = pw - 1 - pl;
    for (let r = -3; r <= 2; r++) {
      const z = Z(r), b = ys(z) + 1;
      if (b > F - 1) continue;
      for (let k = -rowK(r); k <= rowK(r); k++) {
        const x = X(k);
        B(x - pl, x + ph, b, F - 1, z - pl, z + ph, (xx, y) => (y === b ? 13 : 0));
      }
    }

    // ── 舞台地板與高欄 ──
    B(X(-3), X(3), F, F, zs, 0, (x, y, z) => (z === zs ? 1 : 5));
    const zw = Z(-2);                                                    // 翼廊正面
    B(X(-3), X(3), F + 2, F + 2, zs, zs, 14);
    for (let x = X(-3); x <= X(3); x += 2) B(x, x, F + 1, F + 1, zs, zs, 14);
    mirrorX(v, 1, (vv, sg) => {
      const x = sg * X(3);
      B(x, x, F + 2, F + 2, zs, zw - 1, 14);
      for (let z = zs; z < zw; z += 2) B(x, x, F + 1, F + 1, z, z, 14);
    });

    // ── 本堂軸部：柱、板壁、正面開著的禮堂、頭貫 ──
    const wallC = (x, y, z) => {
      if (y === F + E - 1) return 1;
      if ((z === 0 || z === D) ? PX.has(x) : PZ.has(z)) return 0;
      if (y === F) return 1;
      return z === 0 ? 6 : 7;
    };
    W(-hw, hw, F, F + E - 1, 0, D, wallC, 1);

    // ── 翼廊軸部（比本堂低）──
    const wingC = (x, y, z) => {
      if (y === F + Ew - 1) return 1;
      if ((z === zw || z === 0) ? PX.has(x) : PZ.has(z)) return 0;
      return Math.abs(x) === X(3) ? 6 : 7;
    };
    mirrorX(v, 1, (vv, sg) => W(sg * X(3), sg * hw, F, F + Ew - 1, zw, 0, wingC, 1));

    // ── 大屋頂：一層一層的環，往上內縮量 1.6t − 0.6t²（簷口緩、上面陡）──
    const Y0 = F + E;
    const rx = hw + oh, rz0 = -oh, rz1 = D + oh;
    const I = Math.floor((rz1 - rz0 + 1 - 3) / 2);
    const ins = k => { const t = k / (Hr - 1); return Math.round(I * (1.6 * t - 0.6 * t * t)); };
    const eaveC = (x, y, z) => (Math.abs(x) === rx || z === rz0 || z === rz1 ? 4 : 2);
    for (let k = 0; k < Hr; k++) {
      const i = ins(k), y = Y0 + k;
      if (k === Hr - 1) { B(-rx + i, rx - i, y, y, rz0 + i, rz1 - i, 2); break; }
      let t = Math.max(2, ins(k + 1) - i + 1);
      if (k === 0) t = Math.max(t, oh + 1);                              // 第一層要碰到牆頂
      W(-rx + i, rx - i, y, y, rz0 + i, rz1 - i, k === 0 ? eaveC : 2, t);
    }
    const yt = Y0 + Hr, rl = rx - I;
    const zc0 = Math.floor((rz0 + rz1) / 2), zc1 = Math.ceil((rz0 + rz1) / 2);
    B(-rl, rl, yt, yt, zc0, zc1, 3);                                     // 箱棟
    mirrorX(v, rl, (vv, x) => B(x, x, yt + 1, yt + 1, zc0, zc1, 3));     // 鬼板

    // ── 翼廊屋頂：入母屋（下段四坡裙兩層＋上段兩坡，淺色山牆朝正面），往後插進大屋頂 ──
    mirrorX(v, 1, (vv, sg) => {
      const Yw = F + Ew;
      const a = X(3) - ow, b = hw + ow, wz0 = zw - ow, wz1 = Z(1);
      W(sg * a, sg * b, Yw, Yw, wz0, 0,
        (x, y, z) => (Math.abs(x) === a || Math.abs(x) === b || z === wz0 ? 4 : 2), ow + 1);
      W(sg * (a + 1), sg * (b - 1), Yw + 1, Yw + 1, wz0 + 1, 0, 2, 2);
      let L0 = a + 2, R0 = b - 2;
      if ((R0 - L0) % 2) R0 -= 1;                                        // 山牆寬取奇數
      const gz0 = wz0 + 2, jm = (R0 - L0) / 2;
      for (let j = 0; j <= jm; j++) {
        const L = L0 + j, R = R0 - j;
        W(sg * L, sg * R, Yw + 2 + j, Yw + 2 + j, gz0, wz1, (x, y, z) => {
          if (z === gz0) return (Math.abs(x) <= L || Math.abs(x) >= R) ? 4 : 0;  // 破風／妻壁
          return j === jm ? 3 : 2;
        }, 2);
      }
      const gc = sg * (L0 + jm);
      tint(v, gc, Yw + 2 + jm - 1, gz0, 12);                             // 懸魚
      tint(v, gc, Yw + 2 + jm - 2, gz0, 12);
    });
  }
});
