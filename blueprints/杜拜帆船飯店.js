// 檔名：杜拜帆船飯店.js
// v1.318.0 盲測第十回：子 agent 只拿〈藍圖製作說明〉、從零做出來的第二版（看過一次報告＋9000 四視圖），原樣收進來（只改了 name 與檔名那一行；見 開發筆記〈盲測第十回：新增艋舺龍山寺、白川鄉合掌屋、法國聖米歇爾山、杜拜帆船飯店、大同電鍋（v1.318.0）〉）
// 正面（−z，朝岸邊、橋從這邊接出去）：白色帆布立面夾在兩條白色鋼骨弧腿之間，下寬上窄收成帆尖，帆尖上一根細桅杆；
//   高處左右各伸出一樣東西：+x 一側是圓形直升機停機坪，−x 一側是梭形的空中餐廳
// 側面（+x）：背後一根直立的脊柱，前緣從塔底微微往前鼓、約三成高最深、再往上往後收回桅杆——一面吃飽風的帆；
//   側牆是淺藍灰玻璃，外面掛白色鋼骨（橫桁＋X 斜撐）
// 三樣識別物：帆形輪廓（側面的弧＋正面白帆布與兩條白弧腿）、高處兩側伸出的圓形停機坪與梭形餐廳、帆尖上的細桅杆
// 比例表（實物）：全高 321 m（桅杆頂）、最高樓層 197.5 m、56 層、中庭 180 m 高；停機坪離地約 210 m、寬約 27 m；
//   空中餐廳離海面 200 m、懸挑 27 m；桅杆約 60 m（帆尖約 260 m）；人工島離岸 280 m、約 150 m 見方。
//   查不到、照一般印象估的：帆最深處約 78 m、塔底寬約 85 m、兩翼 V 形夾角約 60°（外牆斜率 0.58）
// 輪廓寬度（正面，以帆最寬處 ＝ 1）：人工島 1.4／塔底 0.93／帆腹（約 30% 高）1.0／50% 高 0.94／
//   停機坪那一段（約 80% 高）塔身 0.6、連兩側伸出物 1.3／帆尖 0.3／桅杆 0.13 收到 0.05
// 部件尺寸（v1 報告：9000 塊 s = 16.4；這版變寬，估 s ≈ 15.5，1 格 ≈ 4 m）：帆高 dim(s,4.0,18)=62 格、帆最深 1.2s≈19 格、
//   桅杆 dim(s,0.94,4)=15 格、停機坪半徑 0.33s≈5.1（直徑 10 格，伸出帆外約 6 格）、
//   餐廳長 2×0.4s≈12 格、高 5 格、伸出帆外約 7 格（實物懸挑 27 m ≈ 7 格）、
//   白弧腿 2×2 格、翼端深色玻璃 0.12D≈2 格、帆布橫肋每 4 層一條、人工島 ≈ 31×36 格、橋寬 3 格長約 25 格
// 部件：人工島(blob 扁片＋ellipseRing 護岸石) 入口裙樓(box) 帆形主樓(逐層迴圈：三角平面、前緣鼓出、2 格厚殼)
//   帆布橫肋／翼端玻璃／玻璃樓層帶(迴圈裡挑色) 脊柱(box) 白弧腿(逐層 box) 側面橫桁與 X 斜撐(逐層貼在斜牆外)
//   桅杆(taper) 停機坪(cyl×2＋limb 斜撐) 空中餐廳(blob＋limb 斜撐) 橋(plate 'xz') 橋墩(box) 岸邊(box)＋橋頭柱(box)
customBlueprint({
  name: '杜拜帆船飯店',
  pal: ['#e2dfd7',   // 0 帆布白（大面積，不用純白）
        '#bcb8af',   // 1 帆布橫肋（灰一階）
        '#f6f6f3',   // 2 白色鋼骨、停機坪外圈、餐廳下殼、橋頭柱
        '#8fa9b8',   // 3 側翼玻璃（淺藍灰）
        '#6d8a9c',   // 4 玻璃樓層帶、帆布兩側的翼端玻璃（暗一階）
        '#b3b8bd',   // 5 脊柱、桅杆
        '#474c52',   // 6 停機坪甲板
        '#355f7d',   // 7 餐廳玻璃帶
        '#c2ad86',   // 8 島面沙地、岸邊
        '#857c70',   // 9 護岸石、橋墩
        '#6b6359',   // 10 護岸石（暗）
        '#a3957e',   // 11 入口裙樓石材
        '#d0ccc4',   // 12 橋面
        '#2f3d48'],  // 13 入口深色玻璃
  lo: 2.5, hi: 24,

  gen(v, s) {
    const TAN = 0.58;                             // 兩翼外牆的斜率（V 形夾角約 60°）
    const Hs = dim(s, 4.0, 18);                   // 帆身高（塔底到帆尖）
    const Dm = Math.max(5, s * 1.2);              // 帆最深（側面最寬處）
    const zB = Math.round(s * 0.5);               // 背後脊柱所在的 z
    const y0 = 2;                                 // 塔底那一層（島面在 y = 1）

    // 側面輪廓：塔底 0.93，微微往前鼓到兩三成高最深，再往上往後收回桅杆
    const P = [[0, 0.93], [0.2, 1.0], [0.35, 1.0], [0.5, 0.94], [0.7, 0.75], [0.85, 0.5], [0.95, 0.25], [1, 0.06]];
    const prof = t => {
      for (let i = 1; i < P.length; i++) if (t <= P[i][0]) {
        const a = P[i - 1], b = P[i];
        return a[1] + (b[1] - a[1]) * (t - a[0]) / (b[0] - a[0]);
      }
      return P[P.length - 1][1];
    };
    const DD = [];
    for (let k = 0; k < Hs; k++) DD.push(Dm * prof(k / (Hs - 1)));
    const hxOf = z => Math.floor((zB - z) * TAN + 0.5);           // 那一排 z 的外牆在 |x| ＝ 多少
    const fz = (k, x) => {                                         // 第 k 層、x 那一欄帆布最前面的 z
      if (k >= Hs) return Infinity;
      const D = DD[k], u = Math.min(1, Math.abs(x) / Math.max(1, D * TAN));
      return Math.round(zB - D - 0.06 * D * (1 - u * u));          // 帆布中間往前鼓 0.06 D
    };
    const rib = Math.max(3, Math.round(s * 0.25));                 // 帆布橫肋間距（層）

    // ── 人工島：沙地一層＋外圈兩層護岸石
    const zI = Math.round(-s * 0.15), rxI = Math.max(6, s * 0.95), rzI = Math.max(7, s * 1.1);
    blob(v, 0, 1, zI, rxI * 1.06 - 1.2, 0.5, rzI * 1.06 - 1.2, 8);
    v.ellipseRing(0, 0, zI, rxI, rzI, 2, (x, y, z) => (hash100(x, y, z) < 30 ? 10 : 9), 2);

    // ── 入口裙樓：貼在帆布底下的正面
    const zF0 = fz(0, 0);
    const pw = dim(s, 0.75, 5, true), ph = dim(s, 0.2, 2), pd = dim(s, 0.3, 2);
    const pza = zF0 - pd;
    v.box(0, y0, zF0 - (pd + 1) / 2, pw, ph, pd, (x, y, z) =>
      (z === pza && Math.abs(x) <= pw / 4 && y < y0 + ph - 1 ? 13 : 11));

    // ── 帆形主樓：每一層是一個三角形平面（尖在背後的脊柱，兩翼外牆斜率 TAN，前面是往前鼓的帆布），
    //    只畫 2 格厚的殼＋上一層蓋不到的頂面
    for (let k = 0; k < Hs; k++) {
      const y = y0 + k, D = DD[k];
      const zc = Math.round(zB - D), hxc = hxOf(zc);             // 前緣兩角
      const endW = Math.max(1, Math.round(D * 0.12));           // 帆布兩側露出的翼端玻璃
      for (let z = fz(k, 0); z <= zB; z++) {
        const hx = hxOf(z);
        for (let x = -hx; x <= hx; x++) {
          const f = fz(k, x);
          if (z < f) continue;
          const side = hx - Math.abs(x) <= 1, front = z - f <= 1;
          const top = z < fz(k + 1, x), back = z >= zB - 1;
          if (!(side || front || top || back)) continue;
          let c;
          if (side) c = k % 3 === 0 ? 4 : 3;                                    // 側翼玻璃＋樓層帶
          else if (front || top) c = Math.abs(x) >= hxc - endW ? 4 : (k % rib === rib - 1 ? 1 : 0);
          else c = 5;
          v.set(x, y, z, c);
        }
      }
    }

    // ── 脊柱（背後那一根直立的柱）
    v.box(0, y0, zB + 0.5, 3, Hs, 2, 5);

    // ── 白弧腿：帆布兩側前緣的鋼骨，往外、往前各凸一格
    mirrorX(v, 1, (vv, sg) => {
      for (let k = 0; k < Hs; k++) {
        const zc = Math.round(zB - DD[k]), hxc = hxOf(zc);
        vv.box(sg * (hxc + 0.5), y0 + k, zc - 0.5, 2, 1, 2, 2);
      }
    });

    // ── 側面外露鋼骨：四道橫桁＋三格 X 斜撐，貼在斜牆外一格
    const lv = [0.04, 0.3, 0.56, 0.82].map(t => Math.round(t * (Hs - 1)));
    const band = Math.max(1, Math.round(s * 0.1));
    const onFace = (vv, sg, y, z) => { if (z <= zB - 2) vv.set(sg * (hxOf(z) + 1), y, z, 2); };
    mirrorX(v, 1, (vv, sg) => {
      lv.forEach(kl => {
        for (let k = kl; k < Math.min(Hs, kl + band); k++)
          for (let z = Math.round(zB - DD[k]); z <= zB - 2; z++) onFace(vv, sg, y0 + k, z);
      });
      for (let i = 0; i + 1 < lv.length; i++) {
        const ka = lv[i], kb = lv[i + 1], dB = 2;
        for (let k = ka; k <= kb; k++) {
          const u = (k - ka) / (kb - ka);
          [dB + (DD[kb] - dB) * u, DD[ka] + (dB - DD[ka]) * u].forEach(d => {
            const z = Math.round(zB - Math.min(d, DD[k]));
            onFace(vv, sg, y0 + k, z); onFace(vv, sg, y0 + k, z + 1);
          });
        }
      }
    });

    // ── 桅杆
    const hm = dim(s, 0.94, 4);
    v.taper(0, y0 + Hs, zB, 1.3, 0.4, hm, 5);

    // ── 停機坪（+x 一側，約 81% 高）：深色甲板＋白外圈，底下一圈托架與一根斜撐
    const kH = Math.round(0.81 * (Hs - 1)), yH = y0 + kH;
    const zH = Math.round(zB - 0.6 * DD[kH]), hxH = hxOf(zH);
    const rH = Math.max(2.6, s * 0.33), cxH = hxH + rH;
    v.cyl(cxH, yH - 1, zH, rH - 0.8, 1, 2);
    v.cyl(cxH, yH, zH, rH, 1, (x, y, z) => (Math.hypot(x - cxH, z - zH) > rH - 0.8 ? 2 : 6));
    limb(v, { x: hxH, y: yH - Math.round(rH * 1.3), z: zH, x1: cxH, y1: yH - 1, z1: zH,
              r: Math.max(0.8, s * 0.06), c: 2 });

    // ── 空中餐廳（−x 一側，約 77% 高，跟停機坪一樣掛在側牆中段）：梭形，上半一條藍玻璃帶，底下一根斜撐
    const kR = Math.round(0.765 * (Hs - 1)), yR = y0 + kR;
    const zR = Math.round(zB - 0.55 * DD[kR]), hxR = hxOf(zR);
    const rxR = Math.max(3.3, s * 0.4), ryR = Math.max(1.6, s * 0.15), rzR = Math.max(1.8, s * 0.17);
    const cxR = -(hxR + rxR * 0.7);
    blob(v, cxR, yR, zR, rxR, ryR, rzR, (x, y, z) => (y === yR || y === yR + 1 ? 7 : 2));
    limb(v, { x: -hxR, y: yR - Math.round(rxR * 0.9), z: zR, x1: cxR - rxR * 0.3, y1: yR - 1, z1: zR,
              r: Math.max(0.8, s * 0.06), c: 2 });

    // ── 橋：從島的正面接出去，往 −x 彎，接到岸邊
    const zIF = zI - rzI * 1.06;
    const bp = [[0, zIF + 2], [-0.15 * s, zIF - 0.5 * s], [-0.45 * s, zIF - 0.95 * s], [-0.65 * s, zIF - 1.35 * s]];
    plate(v, { plane: 'xz', at: 1, t: 1, w: Math.max(2, s * 0.18), c: 12, pts: bp });
    const gap = Math.max(3, Math.round(s * 0.3));
    for (let i = 0; i + 1 < bp.length; i++) {
      const [ax, az] = bp[i], [bx, bz] = bp[i + 1];
      const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / gap));
      for (let j = 0; j < n; j++) {
        const px = ax + (bx - ax) * j / n, pz = az + (bz - az) * j / n;
        if ((px / rxI) ** 2 + ((pz - zI) / rzI) ** 2 < 1.2) continue;   // 島上不用橋墩
        v.box(Math.round(px), 0, Math.round(pz), 1, 1, 1, 9);
      }
    }

    // ── 岸邊：一條沙地＋橋頭兩根白柱
    const ex = Math.round(bp[3][0]), ez = Math.round(bp[3][1]);
    const sw = dim(s, 0.6, 5), sd = dim(s, 0.25, 3, true);
    v.box(ex, 0, ez - (sd - 1) / 2, sw, 1, sd, 8);
    mirrorX(v, 2, (vv, dx) => vv.box(ex + dx, 1, ez, 1, dim(s, 0.12, 2), 1, 2));
  }
});
