// 檔名：招財貓.js
// v1.315.0 盲測第九回：子 agent 只拿〈藍圖製作說明〉、從零做出來的第二版（看過一次報告＋9000 四視圖），原樣收進來（只改了 name 與檔名那一行；見 開發筆記〈盲測第九回：松前城天守、哆啦A夢重做，新增淺草寺雷門、首里城正殿、東京鐵塔、招財貓、柴犬（v1.315.0）〉）
// 正面：大頭坐在梨形身體上，右手（+x，正面看在畫面左邊）舉到臉旁、掌心朝前；左手按著肚子前一枚直立的橢圓金色小判
// 側面：頭與身體前後差不多深，項圈正前方掛金鈴鐺、肚子前立著小判，背後一條橘尾巴沿背往上翹
// 三樣識別物：舉到臉旁的右掌（粉紅肉球）、紅項圈＋金鈴鐺、左手抱的金色小判（暗金邊＋橫細紋）
// 比例表（常滑燒樣式的招財貓：頭跟身體差不多大，約 2 頭身；以頭寬 ＝ 1）：
//   全高 1.9（含耳）、身體（座面到下巴）0.87、頭高 0.82（下巴到頭頂，不含耳）、耳朵露出頭頂 ≈ 0.35
//   身體寬 0.95、頭深 0.72、身體深 0.85；小判照萬延小判 33.6 × 19.9 mm，長寬比約 1.6～1.7，立著抱
// 輪廓寬度（正面，以頭寬 ＝ 1）：
//   腳底／後腿 1.05、肚子 0.95、肩與項圈 0.80（左右手肘往外再凸，那一段連手肘 1.15）、
//   臉頰那一段連舉起的右掌 1.35、耳尖那一段兩耳合起來 0.70
// 部件尺寸（第一版報告：9000 塊 s ＝ 24.63，這一版加了一點塊數，估 s ≈ 24，R ＝ 0.5·s ≈ 12）：
//   頭寬 2R ≈ 25 格、全高 ≈ 48 格、全寬 ≈ 34 格；眼睛 5×5（黑框＋金虹膜＋黑瞳孔）、
//   鈴鐺直徑 2·0.3R ≈ 7 格、小判 2·0.33R × 2·0.52R ≈ 9×13 格、鈴鐺與小判之間空 2 層、
//   右掌直徑 2·0.33R ≈ 8 格（肉球 3×3）、耳朵露出 ≈ 7 寬 × 8 高、耳根前後 6 格、項圈 2 層高、花斑半徑 ≈ 4～6 格
// 部件：身體(blob 殼) 底板(blob 一層) 後腿(blob×2) 後腳掌(blob×2) 尾巴(limb×2)
//       項圈(ellipseRing) 頭(blob 殼) 耳朵(boxTaper×2) 內耳(paintFrom)
//       小判(blob 扁＋顏色函式描邊與細紋) 鈴鐺(blob＋顏色函式) 右上臂／右前臂(limb×2) 右掌(blob) 肉球(paintFrom)
//       左上臂／左前臂(limb×2) 左掌(blob) 眼睛／鼻子／嘴／鬍鬚(paintFrom) 花斑(顏色函式)
customBlueprint({
  name: '招財貓',
  pal: ['#e8e2d6',   // 0 白毛（略暖的淺灰白）
        '#c9c0b2',   // 1 灰一階：底面、脖子
        '#a89b8b',   // 2 陰影：手臂下緣、鬍鬚
        '#a81e24',   // 3 紅項圈
        '#ecc04a',   // 4 金：鈴鐺、小判、虹膜
        '#8c6814',   // 5 暗金：小判邊、鈴鐺的縫
        '#d86f8a',   // 6 粉紅：內耳、肉球、鼻子
        '#2a2523',   // 7 黑：花斑、眼框、嘴
        '#c97a35',   // 8 橘：花斑、尾巴
        '#d2a33a'],  // 9 小判的橫細紋（比金暗一點點）
  lo: 3.5, hi: 36,

  gen(v, s) {
    const R = s * 0.5;                                   // 頭的水平半徑：整隻唯一的錨
    const bcy = R * 0.9, brx = R * 0.95, bry = R * 1.1, brz = R * 0.85;   // 身體
    const hy = R * 2.55, hrx = R, hry = R * 0.82, hrz = R * 0.72;         // 頭（臉要平：rz 比 rx 小）
    const colY = Math.round(R * 1.52), colH = Math.max(2, Math.round(R * 0.16));
    const colTop = colY + colH - 1;

    // 花斑：幾顆球的聯集，落在球裡的格子換色（[x, y, z, 半徑, 色]，都是 R 的倍數）
    const SP = [
      [-0.5, 3.1, 0.1, 0.44, 8], [-0.25, 3.3, 0.3, 0.32, 8],     // 頭頂左（左耳那一側）橘
      [0.5, 3.1, 0.15, 0.4, 7],                                    // 頭頂右（右耳那一側）黑
      [0.62, 1.2, 0.5, 0.48, 7], [0.35, 1.5, 0.7, 0.33, 7],        // 右背 黑
      [0.78, 0.68, -0.3, 0.32, 8],                                 // 右腰側一塊橘（正面看得到邊）
      [-0.72, 0.55, 0.3, 0.45, 8], [-0.45, 0.3, 0.62, 0.34, 8],    // 左後腿 橘
    ].map(p => [p[0] * R, p[1] * R, p[2] * R, (p[3] * R) ** 2, p[4]]);
    const spot = (x, y, z, base) => {
      for (const p of SP) {
        const dx = x - p[0], dy = y - p[1], dz = z - p[2];
        if (dx * dx + dy * dy + dz * dz <= p[3]) return p[4];
      }
      return base;
    };

    // ── 著地與軀幹 ──
    const bodyC = (x, y, z) => (y <= 0 || y > colTop) ? 1 : spot(x, y, z, 0);
    blob(v, 0, bcy, 0, brx, bry, brz, bodyC, 2);                          // 身體（梨形殼，底下被地面切平）
    blob(v, 0, 0, 0, R * 0.55, 0.5, R * 0.48, 1);                         // 底板：封住切平的底
    const legC = (x, y, z) => y <= 0 ? 1 : spot(x, y, z, 0);
    mirrorX(v, Math.round(R * 0.58), (vv, dx) =>                           // 後腿（坐姿的大腿，底部比肩寬）
      blob(vv, dx, R * 0.36, R * 0.05, R * 0.42, R * 0.38, R * 0.6, legC, 2));
    const fry = R * 0.2;
    mirrorX(v, Math.round(R * 0.56), (vv, dx) =>                           // 後腳掌：從大腿前面露出來，讓出中間給小判
      blob(vv, dx, Math.round(fry * 0.75), -R * 0.72, R * 0.27, fry, R * 0.32, legC));
    const tA = [R * 0.2, R * 0.3, R * 0.6], tB = [R * 0.55, R * 0.3, R * 0.92], tC = [R * 0.6, R * 0.95, R * 0.98];
    limb(v, { x: tA[0], y: tA[1], z: tA[2], x1: tB[0], y1: tB[1], z1: tB[2], r: R * 0.16, c: 8 });   // 尾巴根
    limb(v, { x: tB[0], y: tB[1], z: tB[2], x1: tC[0], y1: tC[1], z1: tC[2], r: R * 0.16, r1: R * 0.13,
              c: (x, y, z) => y > tC[1] - R * 0.18 ? 7 : 8 });              // 沿背往上翹，尖端黑

    // ── 項圈 ──
    const cth = Math.max(1, Math.min(Math.round(R * 0.28), Math.floor(R * 0.72) - 1));
    v.ellipseRing(0, colY, 0, R * 0.8, R * 0.72, colH, 3, cth);

    // ── 頭與耳朵 ──
    blob(v, 0, hy, 0, hrx, hry, hrz, (x, y, z) => spot(x, y, z, 0), 2);  // 頭（下緣伸進身體約 1/3 個頭半徑）
    const ew = dim(s, 0.40, 3, true), ed = dim(s, 0.24, 3);
    const exc = Math.round(R * 0.5), ez = Math.round(-R * 0.05);
    const headTop = x => hy + hry * Math.sqrt(Math.max(0, 1 - (x / hrx) ** 2));
    const ey0 = Math.round(headTop(exc + (ew - 1) / 2)) - 1;              // 耳根從外緣碰到頭的那一層起
    const eh = Math.max(3, Math.round(hy + R * 1.15) - ey0 + 1);
    mirrorX(v, exc, (vv, dx) => {
      boxTaper(vv, { x: dx, y: ey0, z: ez, w: ew, d: ed, w1: 1, d1: 1, h: eh, c: dx > 0 ? 7 : 8 });
      for (let i = 0; i < eh; i++) {                                       // 內耳：正面塗粉紅，留一格邊
        const wi = Math.round(ew + (1 - ew) * i / (eh - 1));
        const hw = Math.floor((wi - 1) / 2) - 1;
        for (let k = -hw; k <= hw; k++) {
          if (ey0 + i < headTop(dx + k) + 0.5) continue;                   // 埋在頭裡的那一段不塗
          paintFrom(vv, dx + k, ey0 + i, ez, 0, 0, -1, ed + 2, 6);
        }
      }
    });

    // ── 鈴鐺（掛在項圈正前方：中間一圈縫、下半一條直縫）──
    const bR = Math.max(1.6, R * 0.3), bY = colY - 1, bZ = Math.round(-R * 0.84);
    blob(v, 0, bY, bZ, bR, bR, bR, (x, y, z) =>
      y === bY ? 5 : (x === 0 && y < bY - 1 && z < bZ) ? 5 : 4);

    // ── 小判（直立的扁橢圓，坐在兩腳之間；頂端跟鈴鐺之間空 2 層）──
    const krx = R * 0.33, kry = R * 0.52, kz = -R * 0.88;
    const ky = Math.min(R * 0.45, bY - bR * 1.02 - 1.5 - kry * 1.02);
    const kyR = Math.round(ky);
    const kout = (a, b) => (a / krx) ** 2 + (b / kry) ** 2 > 1.04;
    blob(v, 0, ky, kz, krx, kry, Math.max(0.9, R * 0.12), (x, y, z) => {
      const dx = Math.abs(x), dy = Math.abs(y - ky);
      if (kout(dx + 1, dy) || kout(dx, dy + 1)) return 5;                 // 外圈一格暗金邊
      return (y - kyR) % 2 === 0 ? 9 : 4;                                  // 茣蓙目：隔一層一條細紋
    });

    // ── 手臂：上臂一支、前臂一支；貼著身體的那幾段下緣上陰影色才分得開 ──
    const shade = (a, b, r) => (x, y, z) => {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      let t = ((x - a[0]) * ux + (y - a[1]) * uy + (z - a[2]) * uz) / (ux * ux + uy * uy + uz * uz);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      return y < a[1] + t * uy - Math.max(1, r * 0.45) ? 2 : 0;
    };
    const arm = (a, b, r, r1) => limb(v, { x: a[0], y: a[1], z: a[2], x1: b[0], y1: b[1], z1: b[2],
                                           r, r1, c: shade(a, b, r) });
    // 右手（+x）舉起：上臂往外、前臂直立到臉旁，掌心朝前
    const rS = [R * 0.6, R * 1.45, -R * 0.15], rE = [R * 1.0, R * 1.45, -R * 0.38], rW = [R * 1.16, R * 2.4, -R * 0.42];
    arm(rS, rE, R * 0.25, R * 0.23);
    limb(v, { x: rE[0], y: rE[1], z: rE[2], x1: rW[0], y1: rW[1], z1: rW[2], r: R * 0.23, r1: R * 0.22, c: 0 });
    const pX = Math.round(R * 1.18), pY = Math.round(R * 2.62), pZ = Math.round(-R * 0.42);
    blob(v, pX, pY, pZ, R * 0.33, R * 0.31, R * 0.28, 0);                 // 舉起的右掌
    // 左手（−x）往前彎，掌蓋在小判的左上緣
    const lS = [-R * 0.6, R * 1.38, -R * 0.25], lE = [-R * 0.9, R * 1.05, -R * 0.5];
    const lP = [-R * 0.3, ky + R * 0.32, kz - R * 0.12];
    arm(lS, lE, R * 0.25, R * 0.23);
    arm(lE, lP, R * 0.23, R * 0.21);
    blob(v, lP[0], lP[1], lP[2], R * 0.27, R * 0.24, R * 0.22, 0);       // 左掌

    // ── 五官（最後畫，從頭心往臉外找表面）──
    const fn = Math.ceil(hrz) + 2;
    const face = (x, y, c) => paintFrom(v, x, y, 0, 0, 0, -1, fn, c);
    const eax = Math.max(1.5, R * 0.19), eay = Math.max(1.8, R * 0.24);
    const eyY = Math.round(hy + R * 0.1);
    mirrorX(v, 1, (vv, sg) => {                                            // 眼睛：黑框、金虹膜、黑瞳孔
      const cx = Math.round(sg * R * 0.36);
      for (let i = -Math.ceil(eax); i <= Math.ceil(eax); i++)
        for (let j = -Math.ceil(eay); j <= Math.ceil(eay); j++) {
          const d = (i / eax) ** 2 + (j / eay) ** 2;
          if (d > 1) continue;
          face(cx + i, eyY + j, (d > 0.42 || i === 0) ? 7 : 4);
        }
    });
    const ny = Math.round(hy - R * 0.12);                                  // 鼻子：倒三角
    for (let i = -1; i <= 1; i++) face(i, ny, 6);
    face(0, ny - 1, 6);
    face(0, ny - 2, 7); face(-1, ny - 3, 7); face(1, ny - 3, 7);         // 嘴：小小的「人」字
    mirrorX(v, 1, (vv, sg) => {                                            // 鬍鬚：每邊一根，在鼻尖那一層
      for (let x = Math.round(R * 0.6); x <= Math.round(R * 0.9); x++) face(sg * x, ny - 1, 2);
    });
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++)          // 右掌的粉紅肉球（掌心朝前）
      paintFrom(v, pX + i, pY + j - Math.round(R * 0.06), pZ, 0, 0, -1, Math.ceil(R * 0.28) + 2, 6);
  }
});
