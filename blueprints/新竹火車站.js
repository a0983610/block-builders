/* 積木小人 · 匯出的藍圖（新竹火車站）
   用法二選一：放進 blueprints/ 並把檔名加進 list.js，
   或在遊戲裡按「📥 匯入建築」把整份貼進去。 */

// 檔名：新竹火車站.js
customBlueprint({
  name: '新竹火車站',
  pal: [
    '#8f897f', // 0 灰褐洗石子牆面（主色）
    '#615c54', // 1 深色線腳、基座、簷帶
    '#4a5b58', // 2 斜屋頂青灰綠瓦
    '#f5f2e9', // 3 時鐘表面、亮色窗框飾線
    '#2c2b2a', // 4 門窗開口深色陰影
    '#b0aba0'  // 5 鐘塔頂部穹頂與裝飾石材
  ],
  lo: 2.2, hi: 14.5,

  gen(v, s) {
    // 1. 尺度計算（奇偶與比例調整）
    const mw = dim(s, 3.60, 19, true); // 站體總寬（奇數對稱）
    const md = dim(s, 1.40, 7);        // 站體進深
    const mh = dim(s, 1.10, 5);        // 主站體牆高
    const rw = mw + 2, rd = md + 2;    // 屋頂底面覆蓋範圍

    const cw = dim(s, 1.10, 7, true);  // 中央玄關門廊（車寄）寬度
    const cd = dim(s, 0.65, 3);        // 門廊向前凸出深度
    const cz = -Math.round((md + cd) / 2); // 門廊中心 z

    const tw = dim(s, 0.70, 5, true);  // 中央鐘樓邊長
    const th = dim(s, 1.30, 6);        // 鐘塔高度

    // 2. 基座與主站體
    v.box(0, 0, 0, mw + 2, 1, md + 2, 1);
    v.walls(0, 1, 0, mw, mh, md, 0, 1);

    // 3. 立面水平分層線腳與簷口
    v.box(0, 1 + Math.round(mh * 0.45), 0, mw + 1, 1, md + 1, 1);
    v.box(0, 1 + mh, 0, mw + 2, 1, md + 2, 1);

    // 4. 正面門廊（車寄）拱門與階梯山花
    v.box(0, 0, cz, cw + 2, 1, cd + 2, 1);
    v.walls(0, 1, cz, cw, mh + 1, cd, 0, 1);
    
    // 正面主拱門
    const aw = dim(s, 0.50, 3, true);
    const ah = dim(s, 0.45, 2);
    const frontZ = cz - Math.floor(cd / 2);
    arch(v, 0, 1, frontZ, aw, ah, 1, 1);

    // 兩側穿透拱門
    mirrorX(v, Math.floor(cw / 2), (vv, dx) => {
      vv.carve(dx, 1, cz, 1, ah + 1, Math.max(1, cd - 2));
    });

    // 車寄上方階梯山花與裝飾小飾頂
    const gy = 2 + mh;
    v.box(0, gy, frontZ, cw, 1, 1, 1);
    v.box(0, gy + 1, frontZ, Math.max(3, cw - 2), 1, 1, 0);
    v.box(0, gy + 2, frontZ, Math.max(1, cw - 4), 1, 1, 5);
    // 中央圓形牛眼窗飾
    tint(v, 0, gy + 1, frontZ, 3);

    // 5. 兩側翼廊的拱窗與窗陣列
    const sideOffset = Math.round((mw - cw) / 4 + cw / 2);
    mirrorX(v, sideOffset, (vv, dx) => {
      // 一樓窗洞
      windowGrid(vv, {
        x: dx, y: 2, z: -Math.floor(md / 2),
        cols: dim(s, 0.25, 2), rows: 1,
        stepX: dim(s, 0.45, 3), stepY: 1,
        w: 1, h: dim(s, 0.30, 2), c: 4, axis: 'x'
      });
      // 二樓半圓拱窗
      windowGrid(vv, {
        x: dx, y: 1 + Math.round(mh * 0.55), z: -Math.floor(md / 2),
        cols: dim(s, 0.25, 2), rows: 1,
        stepX: dim(s, 0.45, 3), stepY: 1,
        w: 1, h: 1, c: 3, axis: 'x'
      });
    });

    // 6. 前方延伸月台雨遮（簷廊）與立柱
    const canopyY = 1 + Math.round(mh * 0.5);
    const canopyW = Math.max(cw + 4, Math.round(mw * 0.88));
    v.box(0, canopyY, cz - 1, canopyW, 1, cd + 3, 1);
    
    // 雨遮支撐柱
    mirrorX(v, Math.round(canopyW / 2) - 1, (vv, dx) => {
      vv.box(dx, 0, cz - Math.floor(cd / 2) - 1, 1, canopyY, 1, 1);
    });

    // 7. 斜坡屋頂（陡峭的四坡屋面）
    hipRoof(v, 0, 2 + mh, 0, rw, rd, 2);

    // 8. 中央鐘塔
    const towerY = 2 + mh;
    v.box(0, towerY, 0, tw, th, tw, 0);
    v.box(0, towerY + th, 0, tw + 2, 1, tw + 2, 1); // 鐘塔簷口

    // 鐘塔四面大時鐘（白底時鐘與深色指針核心）
    const clockY = towerY + Math.round(th * 0.6);
    const clockRad = Math.max(1, Math.floor(tw / 2));
    
    // 前後鐘面
    mirrorZ(v, clockRad, (vv, dz) => {
      vv.box(0, clockY, dz, Math.min(3, tw), Math.min(3, tw), 1, 3);
      tint(vv, 0, clockY, dz, 4);
    });
    // 左右鐘面
    mirrorX(v, clockRad, (vv, dx) => {
      vv.box(dx, clockY, 0, 1, Math.min(3, tw), Math.min(3, tw), 3);
      tint(vv, dx, clockY, 0, 4);
    });

    // 9. 鐘塔頂部盔頂（圓頂穹頂與尖頂）
    const domeY = towerY + th + 1;
    const domeR = Math.max(1.4, (tw - 1) / 2);
    v.dome(0, domeY, 0, domeR, 5, 0.85);
    
    // 塔尖旗桿
    const spireH = dim(s, 0.25, 2);
    v.box(0, domeY + Math.ceil(domeR * 0.85), 0, 1, spireH, 1, 3);
  }
});
