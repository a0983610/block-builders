// 檔名：柴犬.js
// v1.315.0 盲測第九回：子 agent 只拿〈藍圖製作說明〉、從零做出來的第二版（看過一次報告＋9000 四視圖），原樣收進來（只改了 name 與檔名那一行；見 開發筆記〈盲測第九回：松前城天守、哆啦A夢重做，新增淺草寺雷門、首里城正殿、東京鐵塔、招財貓、柴犬（v1.315.0）〉）
// 正面：下寬上窄的梨形——最底下兩條摺起來的後腿最寬，往上收到胸前一片白圍兜、兩條直直的紅前腿（腳掌白），
//       脖子最窄，頂上一顆比脖子寬的頭：額頭與鼻樑紅、兩頰白（白色沿臉側往上斜到眼尾）、黑鼻頭、小黑眼，頭頂兩隻立耳（耳內白）
// 側面：坐姿直角三角形——胸口與前腿垂直、背從脖子斜下到著地的屁股，吻部往前（−z）凸出，
//       背後下段捲著一圈甜甜圈似的尾巴（外緣白、圈內暗）；背脊一條暗赤，前腿後側白
// 三樣識別物：立起來的三角耳（耳內白）、捲在背上的圈尾、赤柴配色（橘褐身體＋白臉頰嘴邊胸腹＋黑鼻頭）
// 比例表（實物：公犬鬐甲高 39.5 cm、身高:身長 ＝ 10:11、胸深約鬐甲高一半、吻長佔頭長 40%；頭放大 1.15 倍）：
//   坐姿全高 ≈ 63 cm（耳尖）、頭頂 57、鬐甲 ≈ 40；全寬 ≈ 25（後腿外側）；全深 ≈ 46（鼻尖 → 尾圈後緣）
//   頭：寬 15（含臉頰 16）、高 13.6、吻部從頭前緣再凸出 ≈ 6；耳：底寬 6、露出高 7.5、底厚 3 收到 1
//   前腿粗 5、長 24；尾：捲圈外徑 16、尾粗 5.4、圈中洞徑 5.6
// 輪廓寬度（正面，cm）：y 2 → 22（四隻腳掌）／y 9 → 25（後腿，最寬）／y 20 → 21／y 30 → 17（胸）／
//   y 40 → 13（脖子，最窄）／y 47 → 16（臉頰）／y 53 → 15（頭）／y 56～63 → 兩隻耳朵各 5～6、中間空 3
// 部件尺寸（第一版報告：9000 塊 s ＝ 8.76；這版挖空大腿與脖子，估 s ≈ 9，k ＝ s/10 ≈ 0.9 格/cm）：
//   頭寬 14 格（含頰 15～16）、吻部凸出 5、眼 2×2 缺一角、鼻 3×2、耳 5 寬 7 高（埋進頭裡那層 7 寬）、
//   前腿粗 5 腿縫 3、尾圈外徑 15 洞徑 5、臉頰凸出頭側 1
// 部件：屁股/背/胸(blob 中空) 大腿(blob 中空) 後腳(limb＋blob) 前腿(cyl) 前腳掌(blob) 脖子(blob 中空) 頭(blob 中空)
//   臉頰(blob) 吻部(blob) 立耳(逐層 box 疊三角，底厚頂薄) 尾巴(limb 串成捲圈) 眼睛/鼻頭(paintFrom) 裏白與背脊(顏色函式)
customBlueprint({
  name: '柴犬',
  pal: ['#c8692c',   // 0 赤毛（橘褐）主色 L≈0.48
        '#9a4a20',   // 1 暗赤：背脊、大腿下後緣、屁股貼地處、尾圈內側 L≈0.36
        '#ece2cc',   // 2 裏白（奶油白）L≈0.86
        '#b5a385',   // 3 裏白的陰影：吻部下緣、下巴與臉頰底下 L≈0.62
        '#1c1816'],  // 4 黑：鼻頭、眼睛 L≈0.10
  lo: 2, hi: 18,

  gen(v, s) {
    const k = s / 10;                       // 實物 1 cm ＝ k 格：整隻狗唯一的錨，所有尺寸都是 cm × k
    const R = 0, D = 1, W = 2, WS = 3, BK = 4;
    const sq = a => a * a;

    // —— 軀幹：屁股、背、胸三顆橢球（中空，殼 2 格）——
    const ru = { y: 10 * k, z: 7 * k, rx: 10.5 * k, ry: 11 * k, rz: 11 * k };
    const md = { y: 24 * k, z: 4 * k, rx: 9 * k, ry: 10 * k, rz: 9.5 * k };
    const ch = { y: 29 * k, z: -3 * k, rx: 8.5 * k, ry: 11 * k, rz: 8.5 * k };
    blob(v, 0, ru.y, ru.z, ru.rx, ru.ry, ru.rz, (x, y, z) => {
      const ax = Math.abs(x) / ru.rx, dy = (y - ru.y) / ru.ry, dz = (z - ru.z) / ru.rz;
      if (dz < -0.4 && ax < 0.55) return W;                 // 肚子
      if (dz > 0.5 && ax < 0.4 && dy < 0.3) return W;       // 屁股（尾下）的裏白
      if (dy < -0.55 + 0.3 * dz) return D;                  // 貼地的下緣陰影（前低後高）
      if (dz > 0.3 && dy > 0.3 && ax < 0.45) return D;      // 腰上的背脊
      return R;
    }, 2);
    blob(v, 0, md.y, md.z, md.rx, md.ry, md.rz, (x, y, z) => {
      const ax = Math.abs(x) / md.rx, dz = (z - md.z) / md.rz;
      if (dz < -0.45 && ax < 0.5) return W;                 // 肚子
      if (dz > 0.25 && ax < 0.5) return D;                  // 背脊
      return R;
    }, 2);
    blob(v, 0, ch.y, ch.z, ch.rx, ch.ry, ch.rz, (x, y, z) => {
      const ax = Math.abs(x) / ch.rx, dy = (y - ch.y) / ch.ry, dz = (z - ch.z) / ch.rz;
      if (dz < -0.25 && ax < 0.5 + 0.2 * dy) return W;      // 白圍兜：上寬下窄
      if (dy < -0.7) return ax < 0.5 ? W : D;               // 胸底：中間接肚子白、兩側陰影
      if (dz > 0.3 && dy > 0.1 && ax < 0.5) return D;       // 肩背的背脊
      return R;
    }, 2);

    // —— 後腿：摺起來的大腿鼓在屁股兩側（下後緣暗一階，側面才看得出大腿），後腳平貼地面往前伸 ——
    const ty = 9 * k, tz = 7.5 * k, try_ = 7.5 * k, trz = 8.5 * k;
    mirrorX(v, Math.round(8 * k), (vv, dx) => blob(vv, dx, ty, tz, 4.8 * k, try_, trz,
      (x, y, z) => ((y - ty) / try_ - 0.4 * (z - tz) / trz < -0.6 ? D : R), 2));
    mirrorX(v, Math.round(8.2 * k), (vv, dx) => {
      limb(vv, { x: dx, y: 2.2 * k, z: 12 * k, x1: dx, y1: 2.2 * k, z1: -0.5 * k, r: 2.3 * k,
                 c: (x, y, z) => (z > 9.5 * k ? W : R) });                   // 後腳，腳跟後面白
      blob(vv, dx, 1.9 * k, -2 * k, 2.8 * k, 1.9 * k, 3.0 * k, W);           // 後腳掌（白襪）
    });

    // —— 前腿：垂直的柱子插進胸口，前紅後白，腳掌白 ——
    const lz = Math.round(-6.3 * k);
    mirrorX(v, Math.round(4.3 * k), (vv, dx) => {
      vv.cyl(dx, 0, lz, 2.5 * k, Math.max(3, Math.round(24 * k)), (x, y, z) => (z > lz ? W : R));
      blob(vv, dx, 1.9 * k, lz - 1.5 * k, 2.9 * k, 1.9 * k, 3.6 * k, W);
    });

    // —— 脖子（中空）：前面喉嚨白、頸背暗赤 ——
    const nk = { y: 41 * k, z: -4 * k, rx: 6.5 * k, ry: 7 * k, rz: 6.5 * k };
    blob(v, 0, nk.y, nk.z, nk.rx, nk.ry, nk.rz, (x, y, z) => {
      const ax = Math.abs(x) / nk.rx, dz = (z - nk.z) / nk.rz;
      if (dz < -0.2 && ax < 0.65) return W;
      if (dz > 0.35 && ax < 0.5) return D;
      return R;
    }, 2);

    // —— 頭（中空）：額頭、眼周、後腦紅；臉頰白，交界從眼下沿臉側往上斜到眼尾 ——
    const hd = { y: 50 * k, z: -6 * k, rx: 7.5 * k, ry: 6.8 * k, rz: 7 * k };
    blob(v, 0, hd.y, hd.z, hd.rx, hd.ry, hd.rz, (x, y, z) => {
      const u = Math.abs(x) / hd.rx, w = (y - hd.y) / hd.ry, q = (z - hd.z) / hd.rz;
      if (q > 0.3 - 0.4 * w) return R;          // 後腦、頸背
      if (w < -0.6) return WS;                  // 下巴底下的陰影，跟喉嚨的白分開
      if (w < -0.3 + 0.8 * u) return W;         // 臉頰白
      return R;
    }, 2);

    // —— 臉頰：往內收，只比頭側凸出 1 格（第一版凸太多，正面像一條白色橫槓）——
    const cyy = 46.5 * k, cry = 3.1 * k;
    mirrorX(v, Math.round(4.5 * k), (vv, dx) =>
      blob(vv, dx, cyy, -10 * k, 3.6 * k, cry, 3.7 * k, (x, y, z) => (y - cyy < -0.55 * cry ? WS : W)));

    // —— 吻部：鼻樑一條紅，其餘白；下緣與兩側下半描陰影，正面才看得出吻部 ——
    const mz = { y: 47.2 * k, z: -14.1 * k, rx: 3.6 * k, ry: 2.9 * k, rz: 4.8 * k };
    blob(v, 0, mz.y, mz.z, mz.rx, mz.ry, mz.rz, (x, y, z) => {
      const u = Math.abs(x) / mz.rx, w = (y - mz.y) / mz.ry;
      if (w > 0.35 && u < 0.5) return R;                    // 鼻樑紅（裏白不越過鼻樑）
      if (w < -0.4 || (u > 0.75 && w < 0.1)) return WS;
      return W;
    });

    // —— 立耳：逐層收窄的三角板（奇數寬、左右對稱），底厚頂薄（側面也是三角），耳根埋進頭裡，
    //      正面那層塗耳內的白，微微前傾 ——
    const ex = Math.round(4.6 * k), ebf = 3.0 * k, eb = Math.max(1, Math.round(ebf));
    const eh = Math.max(3, Math.round(8.5 * k)), et0 = Math.max(2, Math.round(3.2 * k));
    const ys = hd.y + hd.ry * 1.02 * Math.sqrt(Math.max(0, 1 - sq(ex / (hd.rx * 1.02))));
    const yb = Math.floor(ys), yr = Math.round(hd.y + 0.3 * hd.ry);
    const ez = Math.round(hd.z + 0.3 * k);
    mirrorX(v, 1, (vv, sg) => {
      const xc = sg * ex, rw = Math.max(0, eb - 1);
      for (let y = yr; y < yb; y++)                                       // 耳根（比耳底窄一圈，不伸出頭外）
        vv.box(xc, y, ez + (et0 - 1) / 2, 2 * rw + 1, 1, et0,
               (x, yy, z) => (z === ez && Math.abs(x - xc) <= rw - 1 ? W : R));
      for (let j = 0; j < eh; j++) {                                      // 三角耳
        const hw = Math.max(0, Math.round(ebf * (1 - j / eh)));
        const tj = Math.max(1, Math.round(et0 * (1 - 0.6 * j / eh)));
        const zf = ez - Math.round(j * 0.2);
        vv.box(xc, yb + j, zf + (tj - 1) / 2, 2 * hw + 1, 1, tj,
               (x, yy, z) => (z === zf && Math.abs(x - xc) <= hw - 1 && j < eh - 1 ? W : R));
      }
    });

    // —— 尾巴：從屁股上緣長出來，往上、往前捲一圈壓在背上（外緣白、圈內暗、側面紅）——
    const tcz = 18.6 * k, tcy = 25.5 * k, TR = 5.5 * k, tr0 = 2.7 * k, tr1 = 1.9 * k;
    const tailC = (x, y, z) => {
      const d = Math.sqrt(sq(y - tcy) + sq(z - tcz));
      return d > TR + 0.2 * tr0 ? W : d < TR - 0.35 * tr0 ? D : R;
    };
    const tp = deg => { const a = deg * Math.PI / 180; return [tcy + TR * Math.sin(a), tcz + TR * Math.cos(a)]; };
    let [py, pz] = tp(-60);
    limb(v, { x: 0, y: 15.5 * k, z: 16.5 * k, x1: 0, y1: py, z1: pz, r: tr0, c: R });   // 尾根
    const N = 8;
    for (let i = 1; i <= N; i++) {
      const [qy, qz] = tp(-60 + 300 * i / N);
      limb(v, { x: 0, y: py, z: pz, x1: 0, y1: qy, z1: qz,
                r: tr0 + (tr1 - tr0) * (i - 1) / N, r1: tr0 + (tr1 - tr0) * i / N, c: tailC });
      py = qy; pz = qz;
    }

    // —— 五官最後畫：小眼睛（往外上斜的三角，缺內上角）、黑鼻頭 ——
    const ew = Math.max(2, Math.round(2 * k)), eh2 = Math.max(2, Math.round(1.5 * k));
    const exi = Math.round(2.8 * k), eyy = Math.round(hd.y + 1.5 * k);
    const pn = Math.ceil(hd.rz * 1.1) + 2;
    mirrorX(v, 1, (vv, sg) => {
      for (let i = 0; i < ew; i++) for (let j = 0; j < eh2; j++) {
        if (i === 0 && j === eh2 - 1) continue;
        paintFrom(vv, sg * (exi + i), eyy + j, Math.round(hd.z), 0, 0, -1, pn, BK);
      }
    });
    const nwh = Math.max(1, Math.round(1.3 * k)), nh = Math.max(2, Math.round(1.8 * k));
    const ny0 = Math.round(mz.y + 0.15 * mz.ry), mzr = Math.round(mz.z);
    for (let i = -nwh; i <= nwh; i++) {
      for (let j = 0; j < nh; j++)
        paintFrom(v, i, ny0 + j, mzr, 0, 0, -1, Math.ceil(mz.rz) + 2, BK);           // 鼻頭正面
      paintFrom(v, i, Math.round(mz.y), Math.round(mz.z - 0.8 * mz.rz), 0, 1, 0, Math.ceil(mz.ry) + 2, BK);  // 鼻頭頂面
    }
  }
});
