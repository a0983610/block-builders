/* 積木小人 · 匯出的藍圖（俄式白石大教堂）
   用法二選一：放進 blueprints/ 並把檔名加進 list.js，
   或在遊戲裡按「📥 匯入建築」把整份貼進去。 */

// 檔名：俄式白石大教堂.js
customBlueprint({
  name: '俄式白石大教堂',
  pal: [
    '#eef2f5', // 0 主體白石牆面
    '#9ea8b3', // 1 淺灰底座、盲柱廊飾帶、線腳
    '#d4a23b', // 2 主金頂與小金頂
    '#3c4146', // 3 圓拱深色窗洞 / 陰影
    '#704a2c', // 4 入口拱門框與細部裝飾
    '#e0c460'  // 5 十字架與頂部亮金飾條
  ],
  lo: 2.2, hi: 15.0,

  gen(v, s) {
    // 1. 尺度參數計算
    const mw = dim(s, 2.0, 9, true);     // 主殿寬度（奇數便於中軸對稱）
    const md = dim(s, 2.0, 9);           // 主殿深度
    const mh = dim(s, 1.8, 7);           // 主殿牆高
    const aw = dim(s, 1.2, 5, true);     // 前側附屬前廳寬
    const ad = dim(s, 0.7, 3);           // 前廳進深
    const ah = dim(s, 1.1, 4);           // 前廳牆高

    // 2. 台基與基礎
    v.box(0, 0, 0, mw + 2, 1, md + 2, 1);
    v.box(0, 0, -Math.round((md + ad) / 2), aw + 2, 1, ad + 2, 1);

    // 3. 主殿與前廳牆體
    v.walls(0, 1, 0, mw, mh, md, 0, 1);
    const az = -Math.round(md / 2 + ad / 2);
    v.walls(0, 1, az, aw, ah, ad, 0, 1);

    // 4. 正面入口拱門與側壁拱券線腳
    const dw = dim(s, 0.45, 3, true);
    const dh = dim(s, 0.55, 2);
    const frontZ = az - Math.round(ad / 2);
    arch(v, 0, 1, frontZ, dw, dh, 1, 4); // 正門拱
    v.box(0, 1, frontZ + 1, dw, dh, 1, 3); // 門洞內部深色

    // 側牆盲拱柱廊飾帶（立面腰線裝飾）
    const sideX = Math.round((mw - 1) / 2);
    const bandY = 1 + Math.round(mh * 0.45);
    mirrorX(v, sideX + 1, (vv, dx) => {
      vv.box(dx, bandY, 0, 1, 1, md, 1);
      const arcCols = dim(s, 0.4, 3);
      const stepZ = Math.round(md / (arcCols + 1));
      for (let i = 1; i <= arcCols; i++) {
        const cz = -Math.round(md / 2) + i * stepZ;
        vv.box(dx, bandY + 1, cz, 1, dim(s, 0.4, 2), 1, 1);
      }
    });

    // 5. 側牆與立面拱窗 (windowGrid)
    const winParam = {
      w: dim(s, 0.15, 1),
      h: dim(s, 0.45, 2),
      c: 3,
      cols: dim(s, 0.3, 2),
      rows: 1,
      stepX: dim(s, 0.5, 3),
      y: 1 + Math.round(mh * 0.6),
      axis: 'z'
    };
    mirrorX(v, sideX, (vv, dx) => windowGrid(vv, Object.assign({ x: dx, z: 0 }, winParam)));

    // 6. 屋頂壓頂與拱券山牆 (Zakomar 装飾拱)
    v.box(0, 1 + mh, 0, mw + 2, 1, md + 2, 1);
    v.box(0, 1 + ah, az, aw + 1, 1, ad + 1, 1);

    // 主殿中央與四角鼓座 + 金頂
    const drumR = dim(s, 0.5, 2);
    const drumH = dim(s, 0.8, 3);
    const mainDrumY = 2 + mh;

    // 中央主鼓座與大洋蔥金頂
    v.cyl(0, mainDrumY, 0, drumR + 1, drumH + 1, 0, 1);
    // 鼓座窄拱窗
    ringOf(v, 4, drumR + 1, (vv, rx, rz) => {
      paintFrom(vv, rx, mainDrumY + Math.round(drumH * 0.4), rz, -Math.sign(rx || 1), 0, -Math.sign(rz || 1), 2, 3);
    });
    v.cyl(0, mainDrumY + drumH + 1, 0, drumR + 2, 1, 2); // 金頂托盤
    v.onion(0, mainDrumY + drumH + 2, 0, drumR + 2, dim(s, 0.9, 4), 2); // 主洋蔥金頂
    
    // 中央十字架
    const crossY = mainDrumY + drumH + 2 + dim(s, 0.9, 4);
    const crossH = dim(s, 0.35, 3);
    v.box(0, crossY, 0, 1, crossH, 1, 5);
    v.box(0, crossY + Math.max(1, crossH - 2), 0, 3, 1, 1, 5);

    // 四角小鼓座與小金頂
    const cornerOffset = Math.round(mw * 0.32);
    if (cornerOffset >= 2) {
      corners4(v, cornerOffset, cornerOffset, (vv, cx, cz) => {
        const subR = Math.max(1, Math.round(drumR * 0.65));
        const subH = Math.max(2, Math.round(drumH * 0.8));
        vv.cyl(cx, mainDrumY, cz, subR, subH, 0, 1);
        vv.cyl(cx, mainDrumY + subH, cz, subR + 1, 1, 2);
        vv.onion(cx, mainDrumY + subH + 1, cz, subR + 1, dim(s, 0.5, 3), 2);
        // 小十字架
        const subCrossY = mainDrumY + subH + 1 + dim(s, 0.5, 3);
        vv.box(cx, subCrossY, cz, 1, 2, 1, 5);
        vv.box(cx, subCrossY + 1, cz, 3, 1, 1, 5);
      });
    }

    // 7. 正面台階
    const stairLen = dim(s, 0.25, 2);
    stairs(v, 0, 0, frontZ - stairLen, stairLen, dim(s, 0.6, 3, true), 'z', 1);
  }
});
