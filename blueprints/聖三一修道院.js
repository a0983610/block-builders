/* 積木小人 · 匯出的藍圖（聖三一修道院）
   用法二選一：放進 blueprints/ 並把檔名加進 list.js，
   或在遊戲裡按「📥 匯入建築」把整份貼進去。 */

// 檔名：聖三一修道院.js
customBlueprint({
  name: '聖三一修道院',
  pal: [
    '#ede7da', // 0 白石牆面與柱體
    '#4d6e53', // 1 俄式綠屋頂、簷口與城垛
    '#dea728', // 2 主金頂、小尖塔與十字架
    '#1e6db2', // 3 聖母安息大教堂的四座藍色洋蔥頂
    '#5ea399', // 4 皇家大鐘樓湖水綠飾面
    '#82786a', // 5 台基、石磚路面與台階
    '#252b33'  // 6 拱窗、鐘室開口與大門陰影
  ],
  lo: 2.2, hi: 15.0,

  gen(v, s) {
    // === 1. 圍牆基座與整體尺度 ===
    const yardW = dim(s, 3.4, 17, true);
    const yardD = dim(s, 3.4, 17, true);
    const wallH = dim(s, 0.65, 3);
    const halfW = (yardW - 1) / 2;
    const halfD = (yardD - 1) / 2;

    // 院落台基
    v.box(0, 0, 0, yardW + 2, 1, yardD + 2, 5);

    // 四周白色堡壘防禦外牆與綠色壓頂
    v.walls(0, 1, 0, yardW, wallH, yardD, 0, 1);
    v.box(0, 1 + wallH, 0, yardW + 2, 1, yardD + 2, 1);

    // 四角八角形防禦塔樓與尖頂屋頂
    const twR = dim(s, 0.35, 2);
    const twH = wallH + dim(s, 0.45, 2);
    corners4(v, halfW, halfD, (vv, cx, cz) => {
      vv.cyl(cx, 1, cz, twR, twH, 0, 1);
      vv.cyl(cx, 1 + twH, cz, twR + 1, 1, 1, 0);
      vv.taper(cx, 2 + twH, cz, twR + 1, 0.4, dim(s, 0.65, 3), 1, 1);
    });

    // 正面主拱門入口
    const gateW = dim(s, 0.45, 3, true);
    const gateH = dim(s, 0.40, 2);
    arch(v, 0, 1, -halfD, gateW, gateH, 1, 5);
    v.box(0, 1, -halfD, gateW, gateH, 1, 6);

    // === 2. 聖母安息大教堂（中央五頂白石大教堂） ===
    const catX = Math.round(s * 0.35);
    const catZ = Math.round(s * 0.1);
    const catW = dim(s, 1.25, 7, true);
    const catD = dim(s, 1.25, 7, true);
    const catH = dim(s, 1.15, 5);

    // 大教堂本體牆身與基座
    v.box(catX, 1, catZ, catW + 2, 1, catD + 2, 5);
    v.walls(catX, 2, catZ, catW, catH, catD, 0, 1);

    // 側立面高窗
    const winH = dim(s, 0.35, 2);
    mirrorX(v, (catW - 1) / 2, (vv, dx) => {
      vv.box(catX + dx, 3 + Math.round(catH * 0.3), catZ, 1, winH, 1, 6);
    });
    mirrorZ(v, (catD - 1) / 2, (vv, dz) => {
      vv.box(catX, 3 + Math.round(catH * 0.3), catZ + dz, 1, winH, 1, 6);
    });

    // 屋簷與拱形山頭屋頂平台
    const roofY = 2 + catH;
    v.box(catX, roofY, catZ, catW + 2, 1, catD + 2, 1);

    // 中央大鼓座與主金色洋蔥頂
    const cDrumR = dim(s, 0.30, 2);
    const cDrumH = dim(s, 0.35, 2);
    v.cyl(catX, roofY + 1, catZ, cDrumR, cDrumH, 0, 1);
    v.onion(catX, roofY + 1 + cDrumH, catZ, cDrumR + 0.6, dim(s, 0.70, 3), 2);
    // 中央十字架
    v.box(catX, roofY + 1 + cDrumH + dim(s, 0.70, 3) + 1, catZ, 1, dim(s, 0.25, 2), 1, 2);

    // 四個角落的小鼓座與藍色洋蔥頂
    const cOff = Math.max(2, Math.round(catW * 0.32));
    const sDrumR = Math.max(1, Math.round(s * 0.15));
    const sDrumH = dim(s, 0.25, 1);
    const sOnionH = dim(s, 0.45, 2);
    corners4(v, cOff, cOff, (vv, ox, oz) => {
      vv.cyl(catX + ox, roofY + 1, catZ + oz, sDrumR, sDrumH, 0, 0);
      vv.onion(catX + ox, roofY + 1 + sDrumH, catZ + oz, sDrumR + 0.4, sOnionH, 3);
    });

    // === 3. 皇家多層大鐘樓（高聳湖水綠鐘塔） ===
    const bTowerX = -Math.round(s * 0.35);
    const bTowerZ = -Math.round(s * 0.15);
    const bBaseW = dim(s, 0.85, 5, true);
    const bH1 = dim(s, 0.85, 4);

    // 第一層底座（白石基座）
    v.box(bTowerX, 1, bTowerZ, bBaseW + 2, 1, bBaseW + 2, 5);
    v.walls(bTowerX, 2, bTowerZ, bBaseW, bH1, bBaseW, 0, 1);
    v.box(bTowerX, 2 + bH1, bTowerZ, bBaseW + 2, 1, bBaseW + 2, 1);

    // 第二層（湖水綠鐘室，開拱窗）
    const bW2 = Math.max(3, bBaseW - 2);
    const bH2 = dim(s, 0.80, 3);
    const bY2 = 3 + bH1;
    v.walls(bTowerX, bY2, bTowerZ, bW2, bH2, bW2, 4, 1);
    // 四面鐘室大開口
    mirrorX(v, (bW2 - 1) / 2, (vv, dx) => {
      vv.box(bTowerX + dx, bY2 + 1, bTowerZ, 1, Math.max(1, bH2 - 2), 1, 6);
    });
    mirrorZ(v, (bW2 - 1) / 2, (vv, dz) => {
      vv.box(bTowerX, bY2 + 1, bTowerZ + dz, 1, Math.max(1, bH2 - 2), 1, 6);
    });
    v.box(bTowerX, bY2 + bH2, bTowerZ, bW2 + 1, 1, bW2 + 1, 1);

    // 第三層（頂部圓柱收束層與金色冠頂）
    const bY3 = bY2 + bH2 + 1;
    const bR3 = Math.max(1, Math.round(bW2 * 0.4));
    const bH3 = dim(s, 0.55, 2);
    v.cyl(bTowerX, bY3, bTowerZ, bR3, bH3, 0, 1);
    v.taper(bTowerX, bY3 + bH3, bTowerZ, bR3 + 0.5, 0.4, dim(s, 0.65, 3), 2, 0);
    // 頂端十字架
    v.box(bTowerX, bY3 + bH3 + dim(s, 0.65, 3), bTowerZ, 1, dim(s, 0.3, 2), 1, 2);

    // === 4. 聖三一小教堂與長條修道院側殿（附屬殿宇） ===
    // 附屬金頂小教堂（位於大教堂前側）
    const smChapX = 0;
    const smChapZ = Math.round(s * 0.45);
    const smChapW = dim(s, 0.65, 3, true);
    const smChapH = dim(s, 0.60, 3);
    v.walls(smChapX, 1, smChapZ, smChapW, smChapH, smChapW, 0, 1);
    v.box(smChapX, 1 + smChapH, smChapZ, smChapW + 1, 1, smChapW + 1, 1);
    v.onion(smChapX, 2 + smChapH, smChapZ, Math.max(1.2, smChapW * 0.5), dim(s, 0.50, 2), 2);

    // 長條形修道院廂房（沿著側牆延伸的長型斜頂建築）
    const wingX = halfW - 2;
    const wingZ = 0;
    const wingW = dim(s, 0.55, 3);
    const wingD = Math.max(7, Math.round(yardD * 0.55));
    const wingH = dim(s, 0.55, 3);
    v.walls(wingX, 1, wingZ, wingW, wingH, wingD, 0, 1);
    v.gable(wingX, 1 + wingH, wingZ, wingW + 1, wingD, 1);

    // 院內石階步道（大門直通中央廣場）
    const pathL = Math.round(yardD * 0.35);
    v.box(0, 1, -halfD + Math.round(pathL / 2), 3, 1, pathL, 5);
  }
});
