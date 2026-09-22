/* 積木小人 · 匯出的藍圖（北海道舊本廳舍）
   用法二選一：放進 blueprints/ 並把檔名加進 list.js，
   或在遊戲裡按「📥 匯入建築」把整份貼進去。 */

// 檔名：北海道舊本廳舍.js
customBlueprint({
  name: '北海道舊本廳舍',
  pal: [
    '#9e352b', // 0 主體紅磚牆
    '#d6cebe', // 1 淺灰白石材線腳、窗框、柱頭、基座
    '#395b5c', // 2 八角八面體八角塔與坡屋頂（綠銅色）
    '#223238', // 3 深色基座石、正門內門
    '#91b8c4', // 4 窗戶玻璃
    '#e0a538'  // 5 頂部避雷針/裝飾旗桿（金）
  ],
  lo: 2.2, hi: 15.0,

  gen(v, s) {
    // 尺度計算（主樓寬大對稱、左右翼廊、中央高聳八角穹頂塔與山牆門廊）
    const mw = dim(s, 2.6, 13, true);  // 中央主樓寬
    const md = dim(s, 1.6, 9);         // 中央主樓深
    const mh = dim(s, 1.1, 5);         // 兩層主牆高
    const wingW = dim(s, 1.4, 7, true);// 左右兩翼寬
    const wingD = dim(s, 1.3, 7);      // 左右兩翼深
    const wingH = dim(s, 0.95, 4);     // 翼樓牆高

    const wingX = Math.round((mw + wingW) / 2) - 1; // 翼樓中心 X 偏移

    // 1. 台基層 (基座石)
    v.box(0, 0, 0, mw + 4, 1, md + 4, 3);
    mirrorX(v, wingX, (vv, x) => vv.box(x, 0, 0, wingW + 2, 1, wingD + 2, 3));

    // 2. 主量體（中央紅磚本館 + 左右翼樓）
    v.walls(0, 1, 0, mw, mh, md, 0, 1);
    mirrorX(v, wingX, (vv, x) => vv.walls(x, 1, 0, wingW, wingH, wingD, 0, 1));

    // 3. 橫向石材腰線（新巴洛克美式風格紅白分層）
    const beltY = Math.round(mh * 0.52) + 1;
    v.box(0, beltY, 0, mw + 1, 1, md + 1, 1);
    mirrorX(v, wingX, (vv, x) => vv.box(x, Math.min(beltY, wingH), 0, wingW + 1, 1, wingD + 1, 1));

    // 4. 正立面與背立面窗列 (雙層拱窗/方窗)
    const frontZ = -(md - 1) / 2;
    const winW = dim(s, 0.16, 1);
    const winH = dim(s, 0.35, 2);
    
    // 中央外牆窗
    windowGrid(v, {
      x: 0, y: 2, z: frontZ,
      cols: dim(s, 0.45, 3, true), rows: 2,
      stepX: dim(s, 0.55, 3), stepY: Math.max(3, beltY - 1),
      w: winW, h: winH, c: 4, axis: 'x'
    });

    // 左右翼樓正面窗
    mirrorX(v, wingX, (vv, x) => {
      windowGrid(vv, {
        x: x, y: 2, z: -(wingD - 1) / 2,
        cols: dim(s, 0.28, 2), rows: 2,
        stepX: dim(s, 0.5, 3), stepY: Math.max(3, beltY - 1),
        w: winW, h: winH, c: 4, axis: 'x'
      });
    });

    // 5. 正面門廊 (Portico) 與新巴洛克三角山牆 (Pediment)
    const pw = dim(s, 0.85, 5, true);
    const pd = dim(s, 0.45, 2);
    const pz = frontZ - Math.round(pd / 2);
    // 門廊基座與立柱
    v.box(0, 0, pz, pw + 2, 1, pd + 2, 3);
    arch(v, 0, 1, frontZ - pd, pw, dim(s, 0.6, 3), pd, 1);
    v.box(0, 1, frontZ + 1, pw - 2, dim(s, 0.5, 2), 1, 3); // 門板
    // 入口階梯
    const stCount = dim(s, 0.22, 2);
    stairs(v, 0, 0, frontZ - pd - stCount, stCount, pw + 1, 'z', 1);

    // 門廊上方露台與頂部三角山牆
    v.box(0, mh, pz, pw + 2, 1, pd + 1, 1);
    v.gable(0, mh + 1, frontZ - 1, pw + 2, 2, 0);
    tint(v, 0, mh + 2, frontZ - 2, 1); // 山牆中央徽章飾

    // 6. 屋頂壓頂與主坡屋頂 (Hip Roofs)
    v.box(0, 1 + mh, 0, mw + 2, 1, md + 2, 1);
    hipRoof(v, 0, 2 + mh, 0, mw + 2, md + 2, 2);

    // 左右翼樓屋頂與小簷
    mirrorX(v, wingX, (vv, x) => {
      vv.box(x, 1 + wingH, 0, wingW + 2, 1, wingD + 2, 1);
      hipRoof(vv, x, 2 + wingH, 0, wingW + 2, wingD + 2, 2);
    });

    // 7. 中央標誌性八角圓頂八角塔 (Octagonal Dome Tower)
    const tr = dim(s, 0.48, 3);
    const th = dim(s, 0.7, 3);
    const towerBaseY = 2 + mh + Math.round(md / 3);

    // 塔樓方形過渡座 + 八角鼓座
    v.box(0, towerBaseY, 0, tr * 2 + 2, 1, tr * 2 + 2, 1);
    v.cyl(0, towerBaseY + 1, 0, tr, th, 1, 1); // 淺色觀景鼓座
    
    // 八角塔圓拱窗環
    ringOf(v, 4, tr, (vv, x, z) => {
      paintFrom(vv, x, towerBaseY + 2, z, 0, 0, 0, 1, 4);
    });

    // 綠色八角圓頂收尖
    const domeH = dim(s, 0.75, 4);
    v.taper(0, towerBaseY + 1 + th, 0, tr + 0.5, 0.5, domeH, 2, 1);

    // 8. 頂飾：金黃色避雷針旗桿
    const spireY = towerBaseY + 1 + th + domeH;
    const spireH = dim(s, 0.35, 3);
    v.box(0, spireY, 0, 1, spireH, 1, 5);
    tint(v, 0, spireY + spireH - 1, 0, 5);

    // 9. 屋頂紅磚煙囪 (兩側對稱)
    const chX = Math.round(mw * 0.3);
    const chZ = Math.round(md * 0.2);
    mirrorX(v, chX, (vv, x) => {
      vv.box(x, 2 + mh + 1, chZ, 2, dim(s, 0.45, 3), 2, 0);
      vv.box(x, 2 + mh + 1 + dim(s, 0.45, 3), chZ, 2, 1, 2, 1); // 煙囪白頂
    });
  }
});
