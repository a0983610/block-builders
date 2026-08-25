/* 積木小人 · 匯出的藍圖（松前城天守）
   用法二選一：放進 blueprints/ 並把檔名加進 list.js，
   或在遊戲裡按「📥 匯入建築」把整份貼進去。 */

// 檔名：松前城天守.js
customBlueprint({
  name: '松前城天守',
  pal: [
    '#f5f5f7', // 0 白漆喰牆面
    '#68756d', // 1 石垣台基（灰青色石塊）
    '#394943', // 2 銅板瓦屋頂（青銅灰綠色）
    '#252321', // 3 狹長格子窗框與暗色木構
    '#d6d0c4', // 4 垂木簷底白色細節
    '#d4a73b'  // 5 金色鯱鉾（頂飾）
  ],
  lo: 2.2, hi: 14.5,

  gen(v, s) {
    // 基礎尺度（全部奇數化對齊中線）
    const stoneW = dim(s, 2.2, 9, true);
    const stoneD = dim(s, 2.0, 9, true);
    const stoneH = dim(s, 0.7, 3);

    // 第一層
    const w1 = dim(s, 1.8, 7, true);
    const d1 = dim(s, 1.6, 7, true);
    const h1 = dim(s, 0.65, 3);

    // 第二層
    const w2 = dim(s, 1.45, 5, true);
    const d2 = dim(s, 1.3, 5, true);
    const h2 = dim(s, 0.6, 3);

    // 第三層
    const w3 = dim(s, 1.15, 5, true);
    const d3 = dim(s, 1.05, 5, true);
    const h3 = dim(s, 0.6, 3);

    // 1. 斜面石垣（階梯微收縮，做出扇型斜面）
    for (let dy = 0; dy < stoneH; dy++) {
      const step = Math.floor((stoneH - 1 - dy) * 0.4);
      v.box(0, dy, 0, stoneW - step * 2, 1, stoneD - step * 2, 1);
    }

    let curY = stoneH;

    // --- 第一階（初層）---
    v.walls(0, curY, 0, w1, h1, d1, 0, 1);
    // 初層窗戶（正面與背面配置）
    const winW = dim(s, 0.12, 1);
    const winH = dim(s, 0.35, 2);
    const winStep = dim(s, 0.35, 2);
    mirrorZ(v, (d1 - 1) / 2, (vv, dz) => {
      windowGrid(vv, { x: 0, y: curY + 1, z: dz, cols: dim(s, 0.4, 2), rows: 1, stepX: winStep, w: winW, h: winH, c: 3, axis: 'x' });
    });
    mirrorX(v, (w1 - 1) / 2, (vv, dx) => {
      windowGrid(vv, { x: dx, y: curY + 1, z: 0, cols: 2, rows: 1, stepX: winStep, w: winW, h: winH, c: 3, axis: 'z' });
    });

    // 初層屋簷（帶白色簷底）
    curY += h1;
    v.eave(0, curY, 0, w1 + 2, d1 + 2, 4, 1);
    hipRoof(v, 0, curY + 1, 0, w1 + 3, d1 + 3, 2);
    curY += 2;

    // --- 第二階（二層）---
    v.walls(0, curY, 0, w2, h2, d2, 0, 1);
    mirrorZ(v, (d2 - 1) / 2, (vv, dz) => {
      windowGrid(vv, { x: 0, y: curY + 1, z: dz, cols: dim(s, 0.45, 3), rows: 1, stepX: winStep, w: winW, h: winH, c: 3, axis: 'x' });
    });
    mirrorX(v, (w2 - 1) / 2, (vv, dx) => {
      windowGrid(vv, { x: dx, y: curY + 1, z: 0, cols: 2, rows: 1, stepX: winStep, w: winW, h: winH, c: 3, axis: 'z' });
    });

    // 二層屋簷
    curY += h2;
    v.eave(0, curY, 0, w2 + 2, d2 + 2, 4, 1);
    hipRoof(v, 0, curY + 1, 0, w2 + 3, d2 + 3, 2);
    curY += 2;

    // --- 第三階（頂層）---
    v.walls(0, curY, 0, w3, h3, d3, 0, 1);
    mirrorZ(v, (d3 - 1) / 2, (vv, dz) => {
      windowGrid(vv, { x: 0, y: curY + 1, z: dz, cols: dim(s, 0.5, 3, true), rows: 1, stepX: winStep, w: winW, h: winH, c: 3, axis: 'x' });
    });
    mirrorX(v, (w3 - 1) / 2, (vv, dx) => {
      windowGrid(vv, { x: dx, y: curY + 1, z: 0, cols: 2, rows: 1, stepX: winStep, w: winW, h: winH, c: 3, axis: 'z' });
    });

    // 頂層主屋頂（入母屋造：大屋簷 + 山牆頂）
    curY += h3;
    v.eave(0, curY, 0, w3 + 3, d3 + 3, 4, 1);
    v.gable(0, curY + 1, 0, w3 + 4, d3 + 4, 2);

    // 屋脊與金色鯱鉾
    const ridgeH = Math.max(1, Math.round((w3 + 4) / 2));
    const topY = curY + 1 + ridgeH;
    const ridgeLen = d3 + 4;
    v.box(0, topY, 0, 1, 1, ridgeLen, 2); // 正脊

    // 屋脊前後兩端的鯱鉾（金色尾巴向上微翹）
    const shachiZ = Math.round((ridgeLen - 1) / 2);
    mirrorZ(v, shachiZ, (vv, dz) => {
      const shY = topY + 1;
      const shH = dim(s, 0.25, 2);
      vv.box(0, shY, dz, 1, shH, 1, 5);
      // 朝內側勾起
      vv.set(0, shY + shH - 1, dz > 0 ? dz - 1 : dz + 1, 5);
    });
  }
});
