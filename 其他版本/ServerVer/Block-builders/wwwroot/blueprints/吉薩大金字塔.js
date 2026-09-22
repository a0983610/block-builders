// 檔名：吉薩大金字塔.js
customBlueprint({
  name: '吉薩大金字塔',
  pal: [
    '#d6c19e', // 0 主要風化石灰岩本體
    '#b79c76', // 1 基壇台階、地坪分層石材、陰影
    '#f5ede1', // 2 頂部殘留白色精磨外殼 (Tura Casing) 與入口人字拱石
    '#e5b338', // 3 頂端金色頂石 (Pyramidion)
    '#36281f', // 4 幽深暗黑通道內部
    '#8a7052', // 5 祭殿柱廊立柱與橫樑
    '#ccb898'  // 6 附屬女王小金字塔石材
  ],
  lo: 2.3, hi: 14.0,

  gen(v, s) {
    // --- 1. 尺度計算 ---
    const b = dim(s, 2.70, 15, true);      // 主金字塔底邊長（奇數）
    const ph = Math.floor(b / 2);          // 方錐層數
    const margin = dim(s, 0.35, 2);        // 基壇邊界外擴

    // 東側附屬群尺度
    const qb = dim(s, 0.42, 3, true);      // 女王小金字塔邊長（3 或 5）
    const qSpacing = qb + 2;               // 小金字塔間隔（拉開確保獨立分明）
    const eastExtra = qb + 8;              // 東側平台外擴寬度

    // 整合式大基壇範圍
    const baseW = b + margin * 2;
    const totalEastW = baseW + eastExtra;
    const centerX = Math.floor(eastExtra / 2);

    // --- 2. 宏偉整合式基台地坪 ---
    v.box(centerX, 0, 0, totalEastW, 1, baseW, 1);
    v.box(0, 1, 0, b + 2, 1, b + 2, 0);

    // --- 3. 主金字塔量體 ---
    v.pyramid(0, 2, 0, b, 0, 1);

    // --- 4. 頂部殘留白色外殼 (Casing) 與金頂石 ---
    const capH = dim(s, 0.35, 2);
    const topY = 2 + ph;
    for (let dy = 0; dy < capH; dy++) {
      const cy = topY - capH + dy;
      const r = capH - dy;
      for (let ix = -r; ix <= r; ix++) {
        for (let iz = -r; iz <= r; iz++) {
          if (Math.abs(ix) === r || Math.abs(iz) === r) {
            v.set(ix, cy, iz, 2);
          }
        }
      }
    }
    // 頂尖金頂石 (Pyramidion)
    v.set(0, topY, 0, 3);
    if (s >= 8) {
      v.set(0, topY + 1, 0, 3);
    }

    // --- 5. 北面入口與醒目的人字形巨石卸壓拱 (Double Chevron) ---
    const entStep = dim(s, 0.35, 2);
    const entY = 2 + entStep;
    const entZ = Math.round((b - 1) / 2) - entStep;
    const entW = dim(s, 0.20, 1, true);

    // 挖出幽深通道
    v.carve(0, entY, entZ, entW, 2, 2);
    v.box(0, entY, entZ - 1, entW, 2, 2, 4);

    // 著名人字拱門楣（使用白亮巨石色 pal[2]，清晰分明）
    const archPoints = [
      { dx: 0, dy: 2 },
      { dx: -1, dy: 1 }, { dx: 1, dy: 1 },
      { dx: -2, dy: 0 }, { dx: 2, dy: 0 }
    ];
    archPoints.forEach(pt => {
      paintFrom(v, pt.dx, entY + pt.dy, entZ + 2, 0, 0, -1, 4, 2);
    });

    // --- 6. 北面正門主祭壇通道與石階 ---
    const stairSteps = dim(s, 0.25, 2);
    stairs(v, 0, 0, (baseW - 1) / 2 + stairSteps, stairSteps, dim(s, 0.50, 3, true), '-z', 1);

    // --- 7. 東側附屬祭殿柱廊與三座獨立的女王金字塔 ---
    const eastEdge = Math.round((b - 1) / 2) + 2;

    // 祭殿柱廊（帶橫樑，獨立走道）
    const templeZSpan = dim(s, 0.65, 5, true);
    const colX = eastEdge + 2;
    const colH = dim(s, 0.25, 2);
    v.box(colX, 1, 0, 2, 1, templeZSpan + 2, 1);
    for (let tz = -Math.floor(templeZSpan / 2); tz <= Math.floor(templeZSpan / 2); tz += 2) {
      v.box(colX, 2, tz, 1, colH, 1, 5);
    }
    v.box(colX, 2 + colH, 0, 1, 1, templeZSpan + 2, 5);

    // 三座女王衛星金字塔（拉開間隔，每座獨立立於基壇上）
    const qX = colX + 3 + Math.floor(qb / 2);
    [-qSpacing, 0, qSpacing].forEach(qz => {
      v.box(qX, 1, qz, qb + 2, 1, qb + 2, 1);     // 獨立台基
      v.pyramid(qX, 2, qz, qb, 6, 1);              // 獨立方錐
      v.set(qX, 2 + Math.floor(qb / 2), qz, 0);   // 頂石
    });
  }
});
