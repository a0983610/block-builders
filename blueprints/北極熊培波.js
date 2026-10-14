// 檔名：北極熊培波.js
// v1.287.1 盲測第三回：子 agent 只拿〈藍圖製作說明〉、從零做出來的第二版（看過一次報告＋9000 四視圖），原樣收進來（只改了 name 與檔名那一行；見 開發筆記〈盲測第三回：一兩次就要做好（v1.287.0）〉）
// 正面：圓滾滾的白熊頭直接壓在梨形的橘色身體上（幾乎沒有脖子），兩臂垂在肚子兩側、略往外張，下面兩條短腿踩棕色小靴
// 側面：白色吻部往前凸出一截、肚子往前鼓，屁股後面一小團白尾巴
// 三樣識別物：①白色北極熊頭（小圓耳、往前凸的吻部、黑鼻頭、黑豆眼）
//             ②全身橘色連身工作服（暗橘衣領、袖口、褲腳），只露出白頭與白手掌
//             ③左胸的黑色紅心海賊團海賊旗標誌（黑圓盤裡一張橘色笑臉、四角露出骨頭）
// 比例表（實物）：身高 240 cm（與佛朗基同高）。頭身比查不到官方數字，照角色造型估約 3.5 頭身（含耳朵），頭高 ≈ 68 cm；
//   腿＋靴約佔全高 23%；肚子是身體最寬處（不含手臂約 1.1 個頭寬）、胸口收窄；頭寬 ≈ 1.2 頭高
// 輪廓寬度（正面，以頭寬 ＝ 1）：靴 0.97／腿 0.93／肚子（含垂下的手掌）1.9／胸口（含肩膀上臂）1.3／頭 1.00／耳朵那層 1.05
// 部件尺寸（9000 塊估 s ≈ 12.9，頭高 1.1·s）：頭高 15、頭寬 18、吻部凸出 4 寬 9、鼻頭 3×2、嘴 3 格、眼睛 2×2、
//   耳朵寬 7 凸出頭頂 4、胸前標誌圓盤 7 格寬（裡面笑臉：眼 1 格、嘴 5 格）連骨頭 9～10 格寬、手掌直徑 7、手臂粗 5～6、
//   袖口與褲腳 1～2 格高、靴子直徑 8 高 3、尾巴直徑 5、前臂與肚子之間留約 1 格縫
// 部件：靴筒(cyl) 靴頭(blob) 褲腳(cyl) 褲管(cyl) 肚子(自寫橢球，下緣陰影) 胸口(自寫橢球) 衣領(扁橢球)
//   上臂(limb) 前臂(limb) 手掌(blob) 袖口(cyl) 頭(自寫橢球＋下巴陰影) 吻部(自寫橢球，下半淡灰)
//   鼻頭／嘴(paintFrom) 眼睛(paintFrom) 耳朵(blob) 耳內(paintFrom) 尾巴(blob) 胸前海賊旗(paintFrom)
customBlueprint({
  name: '北極熊培波',
  pal: ['#f0eee8',   // 0 白毛（亮度 0.93：0.88 在正面看起來是灰的）
        '#b4b0a6',   // 1 白毛陰影：下巴底、耳朵內側（0.68）
        '#e8732b',   // 2 橘色連身工作服（0.54）
        '#b8561d',   // 3 工作服暗一階：衣領、袖口、褲腳、肚子下緣（0.42）
        '#1f1d1c',   // 4 黑：眼睛、鼻頭、嘴、海賊旗標誌（0.12）
        '#7a4e2c',   // 5 棕色小靴子（0.33）
        '#d6d3cb'],  // 6 白毛淡灰一階：吻部下半圈（0.82）
  lo: 3.2, hi: 21,

  gen(v, s) {
    const H = s;                 // 錨（頭高 ＝ 1.1·H）；其餘全寫成 H 的倍數
    const R = Math.round;
    // 自己寫的橢球：直接算每一列的 z 範圍、每格只寫一次、順便挑顏色（pick 拿到 fy：−1 最底、+1 最頂）
    // skip 給了的話，落在 skip 裡的格子不寫（已經被別的量體寫過了）
    const ell = (cx, cy, cz, rx, ry, rz, pick, skip) => {
      const ax = rx + 0.3, ay = ry + 0.3, az = rz + 0.3;
      for (let y = Math.max(0, Math.ceil(cy - ay)); y <= Math.floor(cy + ay); y++) {
        const fy = (y - cy) / ay;
        for (let x = Math.ceil(cx - ax); x <= Math.floor(cx + ax); x++) {
          const fx = (x - cx) / ax, q = fx * fx + fy * fy;
          if (q > 1) continue;
          const zr = az * Math.sqrt(1 - q);
          for (let z = Math.ceil(cz - zr); z <= Math.floor(cz + zr); z++)
            if (!skip || !skip(x, y, z)) v.set(x, y, z, pick(x, y, z, fy));
        }
      }
    };
    const inEll = (cx, cy, cz, rx, ry, rz) => (x, y, z) => {
      const a = (x - cx) / (rx + 0.3), b = (y - cy) / (ry + 0.3), c = (z - cz) / (rz + 0.3);
      return a * a + b * b + c * c <= 1;
    };

    // ── 著地：棕色小靴（靴筒＋往前凸的靴頭）＋暗橘褲腳＋橘色褲管（伸進肚子裡）
    const lx = 0.34 * H, bootH = dim(s, 0.26, 2);
    mirrorX(v, 1, (vv, sg) => {
      vv.cyl(sg * lx, 0, 0, 0.30 * H, bootH, 5);
      blob(vv, R(sg * lx), bootH * 0.45, -0.24 * H, 0.27 * H, bootH * 0.55, 0.26 * H, 5);
      vv.cyl(sg * lx, bootH, 0, 0.27 * H, R(1.2 * H) - bootH, 2);
      vv.cyl(sg * lx, bootH, 0, 0.29 * H, dim(s, 0.08, 1), 3);
    });

    // ── 軀幹：梨形，肚子最寬（下緣一圈暗橘當陰影）、胸口收窄
    const belly = [0, 1.62 * H, 0.02 * H, 0.70 * H, 0.82 * H, 0.64 * H];
    ell(...belly, (x, y, z, fy) => (fy < -0.6 ? 3 : 2));
    ell(0, 2.30 * H, 0, 0.63 * H, 0.55 * H, 0.54 * H, () => 2, inEll(...belly));
    // 衣領：一片扁橢球，比胸口凸出約 1 格；頭畫在後面，把中間蓋掉
    ell(0, 2.66 * H, 0, 0.56 * H, 0.06 * H, 0.49 * H, () => 3);

    // ── 手臂：上臂、前臂兩段 limb，前臂跟肚子之間留一格縫；白色手掌、暗橘袖口
    mirrorX(v, 1, (vv, sg) => {
      limb(vv, { x: sg * 0.56 * H, y: 2.42 * H, z: 0.02 * H,
                 x1: sg * 0.95 * H, y1: 1.86 * H, z1: 0.04 * H, r: 0.23 * H, r1: 0.20 * H, c: 2 });  // 肩 → 肘
      limb(vv, { x: sg * 0.95 * H, y: 1.86 * H, z: 0.04 * H,
                 x1: sg * 0.97 * H, y1: 1.36 * H, z1: -0.08 * H, r: 0.20 * H, r1: 0.18 * H, c: 2 }); // 肘 → 腕
      blob(vv, R(sg * 0.98 * H), R(1.18 * H), R(-0.09 * H), 0.25 * H, 0.26 * H, 0.21 * H, 0);       // 手掌
      vv.cyl(sg * 0.97 * H, R(1.38 * H), -0.075 * H, 0.22 * H, dim(s, 0.12, 1), 3);                // 袖口
    });

    // ── 頭：寬扁的熊頭（下巴底陰影色），往前凸的吻部（下半圈淡灰）
    const hy = 3.17 * H, hz = -0.06 * H;
    ell(0, hy, hz, 0.66 * H, 0.55 * H, 0.57 * H, (x, y, z, fy) => (fy < -0.62 ? 1 : 0));
    const my = 3.02 * H, mz = -0.58 * H;
    ell(0, my, mz, 0.33 * H, 0.26 * H, 0.32 * H, (x, y, z, fy) => (fy < -0.25 ? 6 : 0));

    // 耳朵：小圓耳，伸進頭裡約一半；正面點一塊陰影色當耳內
    mirrorX(v, 1, (vv, sg) => {
      const ex = R(sg * 0.45 * H), ey = R(3.66 * H), ez = R(0.02 * H);
      blob(vv, ex, ey, ez, 0.25 * H, 0.22 * H, 0.13 * H, 0);
      const iw = Math.max(0, R(0.08 * H));
      for (let i = -iw; i <= iw; i++) for (let j = 0; j <= 1; j++)
        paintFrom(vv, ex + i, ey + j, ez, 0, 0, -1, Math.ceil(0.13 * H) + 3, 1);
    });

    // 尾巴：屁股後面一小團白毛
    blob(v, 0, R(1.20 * H), R(0.60 * H), 0.18 * H, 0.18 * H, 0.17 * H, 0);

    // ── 五官（最後畫）：鼻頭在吻部前端上緣，下面一格人中、兩格嘴角；黑豆眼在吻部兩側上方
    const pf = (vv, x, y, z, n, c) => paintFrom(vv, x, y, z, 0, 0, -1, n, c);
    const mn = Math.ceil(0.35 * H) + 3;
    const nw = Math.max(1, R(0.09 * H)), nh = Math.max(2, R(0.12 * H)), ny = R(my + 0.10 * H);
    for (let i = -nw; i <= nw; i++) for (let j = 0; j < nh; j++) pf(v, i, ny + j, R(mz), mn, 4);
    pf(v, 0, ny - 1, R(mz), mn, 4);
    mirrorX(v, 1, (vv, sg) => pf(vv, sg, ny - 2, R(mz), mn, 4));
    const ew = Math.max(1, R(0.12 * H)), eh = Math.max(1, R(0.16 * H)), ey = R(3.30 * H);
    mirrorX(v, 1, (vv, sg) => {
      const x0 = R(sg * 0.27 * H);
      for (let i = 0; i < ew; i++) for (let j = 0; j < eh; j++)
        pf(vv, x0 + sg * i, ey + j, R(hz), Math.ceil(0.66 * H) + 3, 4);
    });

    // ── 左胸（−x，培波自己的左邊）的紅心海賊團海賊旗：黑圓盤裡留一張橘色笑臉，四角露出短短的骨頭
    const ecx = R(-0.26 * H), ecy = R(2.15 * H);
    const er = Math.max(1.5, 0.26 * H), eb = Math.max(1, 0.12 * H), ER = Math.ceil(er + eb);
    const face = er >= 2.9 ? new Set(['-1,1', '1,1', '-2,0', '2,0', '-1,-1', '0,-1', '1,-1']) : new Set();
    for (let i = -ER; i <= ER; i++) for (let j = -ER; j <= ER; j++) {
      const q = Math.hypot(i, j);
      const disc = q <= er + 0.35;
      const bone = q <= er + eb + 0.35 && Math.abs(Math.abs(i) - Math.abs(j)) <= 1;
      if ((disc || bone) && !face.has(i + ',' + j)) pf(v, ecx + i, ecy + j, 0, Math.ceil(0.75 * H) + 3, 4);
    }
  }
});
