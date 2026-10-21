// 檔名：哆啦A夢.js
// v1.315.0 盲測第九回：子 agent 只拿〈藍圖製作說明〉、從零做出來的第二版（看過一次報告＋9000 四視圖），原樣收進來（只改了 name 與檔名那一行；見 開發筆記〈盲測第九回：松前城天守、哆啦A夢重做，新增淺草寺雷門、首里城正殿、東京鐵塔、招財貓、柴犬（v1.315.0）〉）
// 正面：大圓頭（藍邊包著一張大白臉）坐在稍窄的藍色圓筒身體上，兩臂往外下垂、末端是白色圓手，腳是兩片白色扁橢圓
// 側面：頭是一顆圓球、白臉從正面一路包到兩頰（側面看約佔頭的前三分之一）；身體圓筒，口袋略往前鼓；腳往前伸出一點；背後一條小尾巴頂著紅球
// 三樣識別物：白臉上兩顆併在一起的大眼睛＋紅鼻子＋左右各三根鬍鬚；紅項圈正中的金鈴鐺；白肚子上半圓形的四次元口袋
// 比例表（實物設定）：身高 129.3 cm，約 2 頭身（頭的圓 ≈ 全高一半多一點）；頭寬略大於頭高（約 1.06 倍）；
//   身體寬 ≈ 頭寬 0.75；腳高 ≈ 全高 8%；項圈在頭的圓最下緣；白肚子約佔身體正面寬的 3/4、高的 4/5；
//   口袋寬 ≈ 白肚子寬 0.6、上緣在白肚子中線；眼睛兩顆合起來比實物放大（約臉寬一半），上緣超出白臉、伸進藍色裡
// 錨：R ＝ 頭的垂直半徑（＝ s），其餘一律寫成 R 的倍數。全高 ≈ 3.9R、頭 2R
// 輪廓寬度（正面，以頭寬 2.12R ＝ 1）：
//   腳（0～0.25R）0.75／肚子＋兩手（≈1.0R）1.25／胸＋手臂（≈1.5R）1.00／項圈（≈1.85R）0.78／頭最寬（≈2.8R）1.00／頭頂附近（≈3.6R）0.55
// 部件尺寸（上一版報告：9000 塊 s ＝ 13.08；這一版身體縮短、手放大，估 s ≈ 13.3，R ＝ 13.3）：全高 52、頭 28 寬 × 27 高；
//   眼睛每顆 7 寬 × 9 高（中間共用一條黑線）、瞳孔 2 × 3、瞳孔與黑框之間各留 1 格白；鼻子半徑 1.6（3 格）；
//   鬍鬚每根 6 格長、內端間隔 1.6 格、外端間隔 4 格（扇形張開）；嘴 13 寬 × 4 深；項圈 3 層高、外徑 21；鈴鐺半徑 2.7（5 格）；
//   白肚子 16 寬 × 18 高；口袋 10 寬 × 5 高；手半徑 4.1（9 格）；腳 10 寬 × 4 高 × 14 深
// 部件：腳(blob×2) 腿縫(carve) 身體(revolve 殼，白肚子用顏色函式) 項圈(ellipseRing) 頭(blob 殼，白臉用顏色函式：頭與前移的橢球相交)
//   上臂／前臂(limb×2×2) 手(blob×2) 尾巴(limb)＋尾巴球(blob) 鈴鐺(blob，橫帶用顏色函式)
//   眼睛／瞳孔／嘴／人中／鬍鬚(從正面往裡找表面塗色) 鼻子(blob) 鈴鐺縫(塗色) 口袋(貼在肚皮外一格，外框黑)
customBlueprint({
  name: '哆啦A夢',
  pal: ['#1a8fd8',   // 0 哆啦A夢藍（身體、頭、手臂）
        '#d9dee3',   // 1 白（臉、肚子、手、腳、眼白）
        '#a3abb5',   // 2 白的陰影（腳底、手的下緣）
        '#d9252e',   // 3 紅（項圈、鼻子、尾巴球）
        '#e9b425',   // 4 金（鈴鐺）
        '#9c6b12',   // 5 暗金（鈴鐺橫帶）
        '#1e2126',   // 6 黑（眼框、瞳孔、鬍鬚、人中、口袋線、鈴鐺縫）
        '#861a22',   // 7 嘴裡的暗紅
        '#e5606c'],  // 8 舌頭
  lo: 2.4, hi: 20,

  gen(v, s) {
    const R = s;                                   // 頭的垂直半徑：整尊唯一的錨
    // 看得到的小球半徑避開 2.94～3.10、3.92～4.04（頂端會冒一格尖）
    const safe = r => (r > 2.9 && r < 3.12 ? 3.14 : r > 3.88 && r < 4.06 ? 4.08 : r);

    // —— 著地：兩片白色扁腳（球心往下沉一格，最底那層被地面切掉 → 平底、接地面大）——
    const fry = Math.max(1.2, R * 0.17);
    const fk = Math.floor(fry * 1.02);
    const fy = fk - 1;
    const feetTop = fy + fk;
    const fxp = Math.max(1, Math.round(R * 0.42));
    const frx = Math.max(1.3, R * 0.38), frz = Math.max(1.6, R * 0.52);
    const fz = -Math.round(R * 0.25);
    mirrorX(v, 1, (vv, sg) => blob(vv, sg * fxp, fy, fz, frx, fry, frz, (x, y, z) => (y === 0 ? 2 : 1)));

    // —— 軀幹：藍色圓筒（revolve 殼），白肚子用顏色函式畫在正面 ——
    const yb0 = feetTop - 1;                       // 身體底伸進腳裡一層
    const yc0 = yb0 + Math.round(R * 1.7);         // 項圈底
    const H = yc0 + 1 - yb0;                       // 身體高（頂端伸進項圈一層）
    const bcy = yb0 + H * 0.46, bhy = H * 0.40, bhx = R * 0.6;
    revolve(v, { x: 0, y: yb0, z: 0, shell: 2,
      prof: [[R * 0.62, 0], [R * 0.75, H * 0.2], [R * 0.80, H * 0.5], [R * 0.76, H * 0.78], [R * 0.66, H]],
      c: (x, y, z) => (z < -R * 0.25 && (x / bhx) ** 2 + ((y - bcy) / bhy) ** 2 <= 1 ? 1 : 0) });

    // 兩腿之間的縫（倒 U）：從地面往上挖一道窄縫，前後挖穿
    const gw = 2 * Math.round(R * 0.06) + 1;
    v.carve(0, 0, 0, gw, feetTop + Math.max(1, Math.round(R * 0.18)), 2 * Math.ceil(R) + 7);

    // —— 項圈：紅色橢圓環，包住頭與身體的接縫 ——
    const ch = Math.max(2, Math.round(R * 0.2));
    const crx = Math.max(2.5, R * 0.8), crz = Math.max(2.3, R * 0.74);
    const cth = Math.min(Math.max(1, Math.round(R * 0.32)), Math.floor(Math.min(crx, crz)) - 1);
    v.ellipseRing(0, yc0, 0, crx, crz, ch, 3, cth);

    // —— 頭：藍色大球（殼）。白臉 ＝ 頭跟一顆往前、往下挪的橢球相交的那一塊：
    //      正面看藍邊只剩頭頂一大片、兩側細細一圈；側面看白臉包到兩頰，約佔頭的前三分之一 ——
    const hy = yc0 + ch + Math.round(R * 0.78);    // 頭的圓最下緣落在項圈底
    const hrx = R * 1.06, hrz = R * 0.94;
    const fcy = hy - R * 0.22, fcz = -R * 0.5;
    const isFace = (x, y, z) => (x / R) ** 2 + ((y - fcy) / (R * 0.84)) ** 2 + ((z - fcz) / (R * 1.05)) ** 2 <= 1;
    blob(v, 0, hy, 0, hrx, R, hrz, (x, y, z) => (isFace(x, y, z) ? 1 : 0), 2);

    // —— 四肢：上臂、前臂各一支 limb，末端白色圓手（直徑 9 格起才圓）——
    const shY = yc0 - R * 0.15, elY = yc0 - R * 0.45, haY = yc0 - R * 0.8;
    const ar = Math.max(0.9, R * 0.19), hr = safe(Math.max(2.3, R * 0.30));
    const hcy = Math.round(haY - R * 0.05);
    mirrorX(v, 1, (vv, sg) => {
      limb(vv, { x: sg * R * 0.6, y: shY, z: 0, x1: sg * R * 0.86, y1: elY, z1: -R * 0.04, r: ar, r1: ar * 0.95, c: 0 });   // 肩 → 肘
      limb(vv, { x: sg * R * 0.86, y: elY, z: -R * 0.04, x1: sg * R * 0.97, y1: haY, z1: -R * 0.1, r: ar * 0.95, r1: ar * 0.9, c: 0 }); // 肘 → 手
      blob(vv, sg * Math.round(R * 1.0), hcy, -Math.round(R * 0.1), hr, hr, hr,
        (x, y, z) => (y < hcy - hr * 0.5 ? 2 : 1));                                                                 // 白色圓手
    });

    // —— 尾巴：背後一小截，頂著紅球 ——
    const ty = Math.round(yb0 + H * 0.28);
    limb(v, { x: 0, y: ty, z: Math.round(R * 0.6), x1: 0, y1: ty - R * 0.08, z1: R * 0.95, r: Math.max(0.75, R * 0.07), c: 0 });
    blob(v, 0, Math.round(ty - R * 0.1), Math.round(R * 1.02), Math.max(1.3, R * 0.12), Math.max(1.3, R * 0.12), Math.max(1.3, R * 0.12), 3);

    // —— 鈴鐺：項圈正前方，上半蓋在項圈上、往前凸出一半 ——
    const br = safe(Math.max(1.3, R * 0.2));
    const bly = yc0;
    const blz = -Math.round(crz * 1.02);
    blob(v, 0, bly, blz, br, br, br, (x, y, z) => (y === bly + 1 ? 5 : 4));

    // —— 臉上的東西：從正面往裡找第一格表面，往裡塗 deep 格（斜面上俯視、45° 才不會露出沒塗到的台階）——
    const zS = -Math.ceil(R * 1.4) - 4;
    const frontZ = (x, y) => { for (let z = zS; z <= R; z++) if (v.has(x, y, z)) return z; return null; };
    const paint = (x, y, c, deep) => {
      const z = frontZ(x, y);
      if (z === null) return;
      for (let k = 0; k < deep; k++) tint(v, x, y, z + k, c);
    };

    // 眼睛：兩顆直立的大橢圓併在一起，黑框、中間共用一條黑線；瞳孔 2×3 偏內側，跟黑框之間各留一格白
    const ey = hy + R * 0.44, eh = Math.max(1.6, R * 0.33), ew = Math.max(1.3, R * 0.25), ex = ew * 0.88;
    const pcx = Math.max(1, R * 0.19), pw = Math.max(0.6, R * 0.09), ph = Math.max(0.9, R * 0.15), pcy = ey - eh * 0.08;
    const inEye = (ax, y) => ((ax - ex) / ew) ** 2 + ((y - ey) / eh) ** 2 <= 1;
    const EX = Math.ceil(ex + ew);
    for (let x = -EX; x <= EX; x++) for (let y = Math.floor(ey - eh); y <= Math.ceil(ey + eh); y++) {
      const ax = Math.abs(x);
      if (!inEye(ax, y)) continue;
      const edge = x === 0 || !inEye(Math.abs(x + 1), y) || !inEye(Math.abs(x - 1), y) || !inEye(ax, y + 1) || !inEye(ax, y - 1);
      const pupil = ((ax - pcx) / pw) ** 2 + ((y - pcy) / ph) ** 2 <= 1;
      paint(x, y, edge || pupil ? 6 : 1, 3);
    }

    // 嘴：上緣是兩端微微上揚的弧（黑線），下面是深的半橢圓（暗紅），底部一塊舌頭
    const ym = hy - R * 0.44, mw = Math.max(1.6, R * 0.46), mh = Math.max(1.2, R * 0.30);
    const inMouth = (x, y) => (x / mw) ** 2 + ((y - ym) / mh) ** 2 <= 1 && y <= ym + R * 0.06 * (x / mw) ** 2;
    const MX = Math.ceil(mw);
    for (let x = -MX; x <= MX; x++) for (let y = Math.floor(ym - mh); y <= Math.ceil(ym + R * 0.06); y++) {
      if (!inMouth(x, y)) continue;
      const tongue = (x / (mw * 0.55)) ** 2 + ((y - (ym - mh * 0.72)) / (mh * 0.45)) ** 2 <= 1;
      paint(x, y, !inMouth(x, y + 1) ? 6 : tongue ? 8 : 7, 2);
    }

    // 人中：鼻子到嘴的一條直線
    const ny = Math.round(hy + R * 0.12), nr = Math.max(1.0, R * 0.12);
    let topM = Math.floor(ym); while (inMouth(0, topM + 1)) topM++;
    for (let y = topM + 1; y < ny; y++) paint(0, y, 6, 2);

    // 鬍鬚：左右各三根，從鼻子旁邊扇形張開（內端擠、外端開），外端停在白臉裡
    const wx0 = R * 0.36, wx1 = R * 0.80;
    for (const [a, b] of [[0.04, 0.22], [-0.08, -0.08], [-0.20, -0.40]]) {
      for (let x = Math.round(wx0); x <= Math.round(wx1); x++) {
        const t = Math.min(1, Math.max(0, (x - wx0) / (wx1 - wx0)));
        const y = Math.round(hy + R * (a + (b - a) * t));
        paint(x, y, 6, 2); paint(-x, y, 6, 2);
      }
    }

    // 紅鼻子：球心放在臉的表面上，凸出半顆；下緣碰到兩顆眼睛的底
    const nz = frontZ(0, ny);
    blob(v, 0, ny, nz === null ? -Math.round(hrz) : nz, nr, nr, nr, 3);

    // 鈴鐺下半的縫
    for (let k = 1; k <= Math.max(1, Math.round(br * 0.6)); k++) paint(0, bly - k, 6, 1);

    // —— 四次元口袋：上緣平、下緣半圓，貼在白肚子外一格，外框黑 ——
    const py = Math.round(bcy), pr = Math.max(1.6, R * 0.38), pd = pr * 0.95;
    const inP = (x, y) => y <= py && (x / pr) ** 2 + ((py - y) / pd) ** 2 <= 1;
    const PX = Math.ceil(pr);
    for (let x = -PX; x <= PX; x++) for (let y = py - Math.ceil(pd); y <= py; y++) {
      if (!inP(x, y)) continue;
      const edge = y === py || !inP(x - 1, y) || !inP(x + 1, y) || !inP(x, y - 1);
      const z = frontZ(x, y);
      if (z !== null) v.set(x, y, z - 1, edge ? 6 : 1);
    }
  }
});
