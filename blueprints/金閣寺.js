// 檔名：金閣寺.js
// v1.313.0 盲測第七回：子 agent 只拿〈藍圖製作說明〉、從零做出來的第一版（沒有任何回饋），原樣收進來（只改了 name 與檔名那一行；見 開發筆記〈盲測第七回：金閣寺、銀閣寺、箱館奉行所、京都五重塔（v1.313.0）〉）
// 正面：池水在前；一樓素木柱＋白牆（一樓上面沒有屋頂，直接是二樓縁的暗金欄杆），二樓整面金箔，
//       一層出簷很深的深褐檜皮葺屋頂，上面是縮一圈的金色三樓（花頭窗），四角翹起的寶形頂，頂上一隻金鳳凰
// 側面：一二樓同大（正面 5 間、側面 4 間），三樓方 3 間縮在中間；西側（+x）一座伸到池上的小亭「漱清」
// 三樣識別物：二三樓的金箔、兩層深出簷的深色屋頂（翹角＋寶形尖頂）、頂上的金鳳凰（加上前面那片池）
// 比例表（查得：二重三階、一二層正面 5 間 × 側面 4 間同形同大、三層方 3 間、總高約 12.5 m；
//   各層高、出簷是照一般認識估的）：一二樓面寬 10 m、深 8 m；基壇 0.4＋縁 0.4、一樓 2.8、二樓縁 0.4＋牆 2.3、
//   二樓屋頂出簷 1.9、屋面 1.4；三樓 5.6 m 見方、縁 0.7、牆 1.8、出簷 1.6；寶形頂 2.1；露盤 0.3；
//   鳳凰實物約 1 m（放大到 2.4 m 才看得到）；池照實物大幅壓縮成 21 × 13 m
// 輪廓寬度（正面，以二樓屋頂簷口寬 ＝ 1）：一樓 0.74（連縁 0.85）／二樓 0.74（連欄杆 0.85）／
//   二樓簷口 1.00／三樓 0.44（連縁 0.54）／頂層簷口 0.64／寶形頂尖 0.08／鳳凰翅展 0.18
// 部件尺寸（9000 塊估 s ≈ 2.7；s ＝ 每公尺幾格，所以係數就是公尺數）：
//   一二樓 29 × 23 格、一樓牆高 8、二樓 6；二樓簷口 39 × 33、屋面 4 層；三樓 17 格見方（縁 21）、牆高 5；
//   頂層簷口 25、寶形頂 6 層收到 3 格寬；鳳凰高 6、翅展 7；花頭窗 3 寬 3 高；翹角往上 2 格、長 6 格；
//   漱清 5 × 7；池 57 × 37
// 部件：池水(blob ry 0.5) 池岸(ellipseRing) 島(blob) 松(limb＋blob) 基壇(walls) 一樓縁(walls)
//   一樓牆＋素木柱＋長押＋中間開口(walls 顏色函式) 二樓縁板(walls) 二樓欄杆(walls＋box) 二樓金牆＋暗金柱(walls 顏色函式)
//   簷口(walls) 屋面(一層一層的 walls 環，下緩上陡) 翹角(plate t1) 三樓縁(box) 三樓欄杆 三樓金牆
//   花頭窗與桟唐戸(tint) 寶形頂(同屋面) 露盤(box) 鳳凰(limb 身體與頸＋plate 雙翅與尾羽) 漱清(box＋boxTaper)
customBlueprint({
  name: '金閣寺',
  pal: ['#dcd6c8',   // 0 一樓白牆
        '#7a5f44',   // 1 素木：一樓柱、長押、縁、漱清、松幹
        '#d9a62b',   // 2 金箔
        '#93690f',   // 3 暗金：二三樓柱、頭貫、欄杆、桟唐戸
        '#4a382c',   // 4 檜皮葺屋面
        '#2a2320',   // 5 黑：簷口、縁板（黑漆）、花頭窗、門裡的暗處
        '#8e8a80',   // 6 石：基壇、池岸、島
        '#2c5560',   // 7 池水
        '#3d6f78',   // 8 池水（岸邊淺處）
        '#34512c',   // 9 松葉
        '#5d7040'],  // 10 島上的苔
  lo: 0.5, hi: 4.8,

  gen(v, s) {
    // s ＝ 每公尺幾格：下面每個 dim 的係數就是實物的公尺數
    const WH = 0, WD = 1, GD = 2, GD2 = 3, RF = 4, DK = 5, ST = 6, WA = 7, WA2 = 8, PN = 9, MS = 10;

    // ── 平面（都是半寬：寬 ＝ 2·半寬＋1，一定是奇數、左右對稱）
    const hw  = dim(s, 5.0, 4);    // 一二樓正面 5 間 ≈ 10 m
    const hd  = dim(s, 4.0, 3);    // 側面 4 間 ≈ 8 m
    const ve  = dim(s, 0.8, 1);    // 一樓的縁
    const be  = dim(s, 0.8, 1);    // 二樓的縁（外緣是欄杆）
    const e1  = dim(s, 1.9, 3);    // 二樓屋頂出簷
    const hw3 = dim(s, 2.8, 3);    // 三樓方 3 間 ≈ 5.6 m
    const b3  = dim(s, 0.7, 1);    // 三樓的縁
    const e2  = dim(s, 1.6, 3);    // 頂層出簷
    // ── 高度
    const hP  = dim(s, 0.4, 1);    // 基壇
    const h1  = dim(s, 2.8, 4);    // 一樓牆
    const h2  = dim(s, 2.3, 3);    // 二樓牆
    const r1h = dim(s, 1.4, 3);    // 二樓屋頂（簷口以上的屋面層數）
    const h3  = dim(s, 1.8, 3);    // 三樓牆
    const r2h = dim(s, 2.1, 4);    // 寶形頂
    const fin = dim(s, 0.3, 1);    // 露盤
    const ph  = dim(s, 2.4, 6);    // 鳳凰（實物約 1 m，放大）
    const rH  = dim(s, 0.8, 2);    // 欄杆高

    // ── 每一件的底面都從下面那件的頂面算
    const y1  = hP + 1;            // 一樓牆底（hP 那一層是縁板）
    const yB2 = y1 + h1;           // 二樓縁板
    const y2  = yB2 + 1;           // 二樓牆底
    const yR1 = y2 + h2;           // 二樓屋頂的簷口層
    const yB3 = yR1 + r1h + 1;     // 三樓縁板（坐在屋面最上一層上）
    const y3  = yB3 + 1;           // 三樓牆底
    const yR2 = y3 + h3;           // 頂層簷口
    const yF  = yR2 + r2h + 1;     // 露盤
    const yb  = yF + fin;          // 鳳凰腳底

    // 柱位：從 −h 到 h 等分 n 間，左右對稱取整
    const cols = (h, n) => {
      const a = [];
      for (let i = 0; i <= n; i++) { const p = -h + 2 * h * i / n; a.push(Math.sign(p) * Math.round(Math.abs(p))); }
      return a;
    };
    const px = cols(hw, 5), pz = cols(hd, 4), p3 = cols(hw3, 3);
    const onCol = (x, z, H, Hz, ax, az) =>
      ((z === -Hz || z === Hz) && ax.indexOf(x) >= 0) || ((x === -H || x === H) && az.indexOf(z) >= 0);

    // 下緩上陡的屋面：一層一層的環，下面每層收得多、上面收得少（日式屋頂的反り）。
    // 半寬都取整數 → 每層寬度都是奇數、左右對稱；環厚 ＝ 往上一層每邊收的格數 ＋ 1，上下接得起來、從上面看不進去
    const roofStack = (y, x0, z0, xt, zt, n, p, topT, c) => {
      const hx = [], hz = [];
      for (let i = 0; i < n; i++) {
        const f = Math.pow(1 - i / (n - 1), p);
        hx.push(Math.round(xt + (x0 - xt) * f));
        hz.push(Math.round(zt + (z0 - zt) * f));
      }
      for (let i = 0; i < n; i++) {
        const t = i < n - 1 ? Math.max(hx[i] - hx[i + 1], hz[i] - hz[i + 1]) + 1 : topT;
        v.walls(0, y + i, 0, 2 * hx[i] + 1, 1, 2 * hz[i] + 1, c, Math.max(2, t));
      }
    };
    // 翹角：簷口那一條在四個角輕輕往上翹（一格厚的 plate，每個角沿兩條簷邊各一段）
    const sori = (y, Rx, Rz, up, L, c) => mirrorX(v, 1, (vx, sx) => mirrorZ(vx, 1, (vz, sz) => {
      plate(vz, { plane: 'xy', at: sz * Rz, t: 1, w: 1.5, c, pts: [[sx * (Rx - L), y], [sx * Rx, y + up]] });
      plate(vz, { plane: 'zy', at: sx * Rx, t: 1, w: 1.5, c, pts: [[sz * (Rz - L), y], [sz * Rz, y + up]] });
    }));
    // 欄杆：上框一圈＋每 3 格一根短柱
    const rail = (y, H, Hz, n, c) => {
      v.walls(0, y + n - 1, 0, 2 * H + 1, 1, 2 * Hz + 1, c, 1);
      const post = (x, z) => v.box(x, y, z, 1, n - 1, 1, c);
      for (let k = 0; k * 3 < H; k++) mirrorX(v, k * 3, (vv, dx) => { post(dx, -Hz); post(dx, Hz); });
      for (let k = 0; k * 3 < Hz; k++) mirrorZ(v, k * 3, (vv, dz) => { post(-H, dz); post(H, dz); });
      corners4(v, H, Hz, (vv, x, z) => post(x, z));
    };

    // ── 鏡湖池：主池在正面，西側（+x）多一灣給漱清。
    //    先畫池岸、再畫水（水蓋掉池岸的內圈），最後畫建築（基壇蓋掉伸進樓下的那一截）
    const prx = dim(s, 10.5, 9), prz = dim(s, 6.5, 6);
    const pcx = Math.round(hw * 0.2), pcz = -hd - prz;
    const sW = dim(s, 2.0, 3), sD = dim(s, 2.4, 3, true);      // 漱清：方 1 間
    const xa = hw + ve, xb = hw + ve + sW, szc = -hd + (sD - 1) / 2;
    const lrx = sW + 3, lrz = (sD + 1) / 2 + 3;
    v.ellipseRing(pcx, 0, pcz, prx + 1, prz + 1, 1, ST, 3);
    v.ellipseRing(xb - 1, 0, szc, lrx + 1, lrz + 1, 1, ST, 3);
    blob(v, pcx, 0, pcz, prx, 0.5, prz, (x, y, z) => {
      const a = (x - pcx) / prx, b = (z - pcz) / prz;
      return a * a + b * b > 0.7 ? WA2 : WA;
    });
    blob(v, xb - 1, 0, szc, lrx, 0.5, lrz, WA2);

    // 池中的小島與松（放在正面右手邊外側，不擋到樓）
    const ix = pcx - Math.round(prx * 0.75), iz = pcz - Math.round(prz * 0.1);
    const ir = Math.max(2.3, s * 1.4);
    blob(v, ix, 0, iz, ir, 1.2, ir * 0.8, (x, y, z) => (y >= 1 ? MS : ST));
    const th = dim(s, 3.2, 5), lean = Math.round(s * 0.4);
    limb(v, { x: ix, y: 1, z: iz, x1: ix - lean, y1: 1 + th, z1: iz,
              r: Math.max(0.75, s * 0.28), r1: Math.max(0.75, s * 0.2), c: WD });
    const cr = Math.max(2.3, s * 1.3);
    blob(v, ix - lean, 1 + th, iz, cr, Math.max(1, cr * 0.4), cr * 0.85, PN);
    blob(v, ix + Math.round(s * 0.5), 1 + Math.round(th * 0.62), iz, cr * 0.9, Math.max(1, cr * 0.35), cr * 0.8, PN);
    blob(v, ix - Math.round(s * 0.9), 1 + Math.round(th * 0.32), iz, cr * 0.7, Math.max(1, cr * 0.32), cr * 0.65, PN);

    // ── 基壇與一樓（法水院：寢殿造、素木、白壁）
    v.walls(0, 0, 0, 2 * (hw + ve + 1) + 1, hP, 2 * (hd + ve + 1) + 1, ST, ve + 2);    // 基壇（只做外圈）
    v.walls(0, hP, 0, 2 * (hw + ve) + 1, 1, 2 * (hd + ve) + 1, WD, ve + 1);          // 一樓的縁
    const yMid = y1 + Math.max(1, Math.round(h1 * 0.55));
    v.walls(0, y1, 0, 2 * hw + 1, h1, 2 * hd + 1, (x, y, z) => {
      if (y === y1 || y === y1 + h1 - 1 || y === yMid) return WD;                     // 地覆、頭貫、長押
      if (onCol(x, z, hw, hd, px, pz)) return WD;                                       // 素木柱
      if (z === -hd && Math.abs(x) < px[3] && y < yMid) return DK;                      // 正面中間一間：蔀戸掀起，裡面暗
      return WH;
    }, 1);

    // ── 二樓（潮音洞：外面與欄杆整面金箔）
    v.walls(0, yB2, 0, 2 * (hw + be) + 1, 1, 2 * (hd + be) + 1, DK, be + 1);          // 二樓縁板（一路接回牆）
    v.walls(0, y2, 0, 2 * hw + 1, h2, 2 * hd + 1, (x, y, z) =>
      (y === y2 + h2 - 1 || onCol(x, z, hw, hd, px, pz)) ? GD2 : GD, 1);
    rail(y2, hw + be, hd + be, rH, GD2);

    // ── 二樓屋頂：簷口一圈接回牆，上面下緩上陡的屋面收到三樓的縁
    v.walls(0, yR1, 0, 2 * (hw + e1) + 1, 1, 2 * (hd + e1) + 1, DK, e1 + 1);
    roofStack(yR1 + 1, hw + e1 - 1, hd + e1 - 1, hw3 + b3, hw3 + b3, r1h, 1.3, 3, RF);
    sori(yR1, hw + e1, hd + e1, dim(s, 0.6, 1), dim(s, 2.2, 3), DK);

    // ── 三樓（究竟頂：禪宗樣佛殿，內外金箔、縁是黑漆）
    v.box(0, yB3, 0, 2 * (hw3 + b3) + 1, 1, 2 * (hw3 + b3) + 1, DK);
    v.walls(0, y3, 0, 2 * hw3 + 1, h3, 2 * hw3 + 1, (x, y, z) =>
      (y === y3 + h3 - 1 || onCol(x, z, hw3, hw3, p3, p3)) ? GD2 : GD, 1);
    // 四面都一樣：中間桟唐戸、兩旁花頭窗（畫在牆面上用 tint）
    const put4 = (a, y, c) => { tint(v, a, y, -hw3, c); tint(v, a, y, hw3, c); tint(v, hw3, y, a, c); tint(v, -hw3, y, a, c); };
    const wx = Math.round((hw3 + p3[2]) / 2), wH = Math.max(2, h3 - 2);
    for (let j = 0; j < wH; j++) {
      const k = j === wH - 1 ? 0 : 1;                       // 花頭窗：最上一格收成尖
      for (let a = -k; a <= k; a++) { put4(wx + a, y3 + 1 + j, DK); put4(-wx + a, y3 + 1 + j, DK); }
    }
    const dw = Math.max(0, p3[2] - 2);
    for (let j = 0; j < wH; j++) for (let a = -dw; a <= dw; a++) put4(a, y3 + j, GD2);
    rail(y3, hw3 + b3, hw3 + b3, dim(s, 0.6, 2), GD2);

    // ── 寶形頂：簷口一圈、下緩上陡收到 3 格寬，翹角，露盤
    v.walls(0, yR2, 0, 2 * (hw3 + e2) + 1, 1, 2 * (hw3 + e2) + 1, DK, e2 + 1);
    roofStack(yR2 + 1, hw3 + e2 - 1, hw3 + e2 - 1, 1, 1, r2h, 1.6, 2, RF);
    sori(yR2, hw3 + e2, hw3 + e2, dim(s, 0.6, 1), dim(s, 1.6, 3), DK);
    v.box(0, yF, 0, 3, fin, 3, GD);

    // ── 金鳳凰：頭朝正面（−z），雙翅往上張開（正面看得到），尾羽往後上甩（側面看得到）
    const q = ph / 6, P = a => a * q;
    limb(v, { x: 0, y: yb + P(0.6), z: P(0.5), x1: 0, y1: yb + P(2.6), z1: P(-0.4),
              r: Math.max(0.9, P(1.0)), r1: Math.max(0.8, P(0.85)), c: GD });                 // 身體
    limb(v, { x: 0, y: yb + P(2.6), z: P(-0.4), x1: 0, y1: yb + P(4.3), z1: P(-1.6),
              r: Math.max(0.75, P(0.8)), r1: 0.75, c: GD });                                   // 頸與頭
    mirrorX(v, 1, (vv, sg) => plate(vv, { plane: 'xy', at: 0, t: 1, w: 1.6, c: GD,
      pts: [[sg * P(0.8), yb + P(2.2)], [sg * P(2.6), yb + P(3.8)], [sg * P(3.4), yb + P(6)]] }));  // 雙翅
    plate(v, { plane: 'zy', at: 0, t: 1, w: 1.6, c: GD,
      pts: [[P(0.8), yb + P(1.4)], [P(2.8), yb + P(2.2)], [P(4.3), yb + P(4.6)]] });              // 尾羽

    // ── 漱清：一樓西側伸到池上的小亭（方 1 間、切妻、四面不設牆）
    v.box((xa + xb) / 2, hP, szc, xb - xa + 1, 1, sD, WD);                                     // 板敷，接在一樓縁外
    const sh = Math.max(2, h1 - dim(s, 1.0, 2));
    mirrorZ(v, (sD - 1) / 2, (vv, dz) => vv.box(xb, hP + 1, szc + dz, 1, sh, 1, WD));           // 外側兩根柱
    const dS = sD + 2;
    boxTaper(v, { x: (hw + 1 + xb + 1) / 2, y: hP + 1 + sh, z: szc, w: xb - hw + 1, d: dS,
                  w1: xb - hw + 1, d1: 1, h: Math.max(2, Math.round(dS * 0.3)), c: RF });     // 切妻屋頂，屋脊沿 x、貼著一樓側牆
  }
});
