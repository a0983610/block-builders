/* 積木小人 · 匯出的藍圖（總統府）
   用法二選一：放進 blueprints/ 並把檔名加進 list.js，
   或在遊戲裡按「📥 匯入建築」把整份貼進去。 */

// 檔名：總統府.js
customBlueprint({
  name: '總統府',
  pal: [
    '#9b342b', // 0 紅磚主牆
    '#e5ded4', // 1 白色水平飾帶 / 柱身 / 拱券 / 線腳
    '#556270', // 2 屋頂銅瓦 / 塔頂深色屋瓦
    '#877d73', // 3 石造基座 / 平台階梯 / 圍欄
    '#322822', // 4 深色門窗陰影 / 木門
    '#d6b24d'  // 5 避雷針 / 塔尖頂飾
  ],
  lo: 2.2,
  hi: 14.0,

  gen(v, s) {
    // 1. 尺度參數計算
    const bodyW = dim(s, 4.4, 23, true);   // 兩翼總面寬（奇數以利置中）
    const bodyD = dim(s, 1.3, 7);          // 建築縱深
    const bodyH = dim(s, 1.3, 6);          // 翼樓主牆高
    const wingHalf = (bodyW - 1) / 2;

    const towerW = dim(s, 0.9, 5, true);   // 中央主塔面寬
    const towerH = dim(s, 3.8, 16);        // 中央高塔高度
    const cornerW = dim(s, 0.85, 5, true); // 兩端角樓邊長
    const cornerH = bodyH + dim(s, 0.4, 2);// 角樓高過翼樓

    // 2. 基座層 (台基、台階)
    v.box(0, 0, 0, bodyW + 4, 1, bodyD + 4, 3);
    const stepW = dim(s, 1.2, 7, true);
    const stepN = dim(s, 0.25, 2);
    stairs(v, 0, 0, -Math.round(bodyD / 2) - 2 - stepN, stepN, stepW, 'z', 3);

    // 3. 兩翼主體量體與紅白飾帶 (辰野風格水平帶)
    v.walls(0, 1, 0, bodyW, bodyH, bodyD, 0, 1);
    for (let y = 2; y <= bodyH; y += 2) {
      // 每兩格一道白色水平飾帶
      v.box(0, y, 0, bodyW + 0.5, 1, bodyD + 0.5, 1);
    }
    // 挖空內部避免實心積木過量
    v.carve(0, 1, 0, bodyW - 2, bodyH, bodyD - 2);

    // 4. 正面兩翼拱廊與外廊 (左右對稱)
    const spanW = (bodyW - towerW - cornerW * 2) / 2;
    if (spanW >= 5) {
      const archCount = Math.max(2, Math.floor(spanW / 3));
      const pierW = 1;
      const archW = Math.max(1, Math.floor((spanW - pierW * (archCount + 1)) / archCount));
      const archH = Math.max(2, Math.floor(bodyH * 0.4));
      
      mirrorX(v, Math.round(towerW / 2 + spanW / 2), (vv, dx) => {
        // 一樓拱廊
        archRow(vv, dx, 1, -Math.round(bodyD / 2), archCount, archW, archH, 1, pierW, 1);
        // 二樓連拱
        if (bodyH >= 5) {
          archRow(vv, dx, 1 + archH + 1, -Math.round(bodyD / 2), archCount, archW, archH - 1, 1, pierW, 1);
        }
      });
    }

    // 5. 兩側轉角衛塔 (角樓)
    mirrorX(v, wingHalf - Math.floor(cornerW / 2), (vv, cx) => {
      vv.box(cx, 1, 0, cornerW, cornerH, cornerW, 0);
      for (let y = 2; y <= cornerH; y += 2) {
        vv.box(cx, y, 0, cornerW + 0.6, 1, cornerW + 0.6, 1);
      }
      // 角樓頂部女牆與小尖錐
      vv.box(cx, 1 + cornerH, 0, cornerW + 1, 1, cornerW + 1, 1);
      vv.pyramid(cx, 2 + cornerH, 0, cornerW, 2, 1);
    });

    // 6. 主屋頂與屋簷
    v.box(0, 1 + bodyH, 0, bodyW + 2, 1, bodyD + 2, 1); // 簷口線腳
    hipRoof(v, 0, 2 + bodyH, 0, bodyW, bodyD, 2);       // 四坡斜頂

    // 7. 正門車寄 (門廊 Entry Portico)
    const porchW = dim(s, 1.1, 5, true);
    const porchD = dim(s, 0.45, 2);
    const porchH = dim(s, 0.65, 3);
    const porchZ = -Math.round(bodyD / 2) - Math.floor(porchD / 2);
    v.box(0, 1, porchZ, porchW, porchH, porchD, 1);
    arch(v, 0, 1, porchZ - Math.floor(porchD / 2), dim(s, 0.45, 3, true), porchH - 1, 1);
    v.dome(0, 1 + porchH, porchZ, Math.round(porchW / 2), 1, 0.6); // 車寄拱頂

    // 8. 中央衛塔 (高塔本體、層層收分、拱窗)
    const tBaseZ = 0;
    v.box(0, 1, tBaseZ, towerW + 1, bodyH + 2, towerW + 1, 0);
    v.walls(0, bodyH + 2, tBaseZ, towerW, towerH - bodyH, towerW, 0, 1);

    // 塔身高階紅白紋路與中央長窗
    for (let ty = bodyH + 2; ty <= towerH; ty += 2) {
      v.box(0, ty, tBaseZ, towerW + 0.4, 1, towerW + 0.4, 1);
    }
    const winH = dim(s, 0.8, 3);
    v.carve(0, towerH - winH - 2, tBaseZ - Math.floor(towerW / 2), 1, winH, 1);

    // 塔頂瞭望閣、柱列與圓頂
    const capY = 1 + towerH;
    v.box(0, capY, tBaseZ, towerW + 1, 1, towerW + 1, 1); // 塔簷
    v.cyl(0, capY + 1, tBaseZ, (towerW - 1) / 2, dim(s, 0.4, 2), 1, 1); // 圓形柱廊室
    v.dome(0, capY + 1 + dim(s, 0.4, 2), tBaseZ, (towerW - 1) / 2, 2);   // 塔頂穹頂

    // 9. 頂飾與附屬細節 (避雷針桿、屋頂小煙囪)
    const spireY = capY + 1 + dim(s, 0.4, 2) + Math.round((towerW - 1) / 2);
    const spireH = dim(s, 0.4, 2);
    v.box(0, spireY, tBaseZ, 1, spireH, 1, 5); // 塔尖避雷針

    // 屋頂對稱小煙囪/通風孔
    mirrorX(v, Math.round(towerW / 2 + spanW / 2), (vv, sx) => {
      vv.box(sx, 2 + bodyH + 2, 0, 1, dim(s, 0.25, 2), 1, 1);
    });
  }
});
