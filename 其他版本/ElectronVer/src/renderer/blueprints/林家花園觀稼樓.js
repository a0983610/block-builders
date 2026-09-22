/* 積木小人 · 匯出的藍圖（林家花園觀稼樓）
   用法二選一：放進 blueprints/ 並把檔名加進 list.js，
   或在遊戲裡按「📥 匯入建築」把整份貼進去。 */

// 檔名：林家花園觀稼樓.js
customBlueprint({
  name: '林家花園觀稼樓',
  pal: [
    '#f5eee4', // 0 白粉牆與立面
    '#53261d', // 1 深褐紅木柱、額枋與匾額
    '#3b3633', // 2 歇山頂黑灰瓦與雲牆瓦壓頂
    '#4aa3b5', // 3 碧藍格扇門窗與二樓綠釉瓶欄杆
    '#b4684c', // 4 庭院紅磚地坪與欄杆磚頂
    '#a69a8b'  // 5 前方雲牆古樸灰泥面
  ],
  lo: 2.4,
  hi: 14.5,

  gen(v, s) {
    // 1. 尺度計算
    const bw = dim(s, 1.90, 9, true);     // 主樓面寬（奇數對稱）
    const bd = dim(s, 1.40, 7);           // 主樓進深
    const h1 = dim(s, 0.95, 4);           // 一樓高度
    const h2 = dim(s, 0.90, 4);           // 二樓高度
    const eaveExt = dim(s, 0.22, 1);      // 出簷量

    // 2. 庭院地坪與台基
    const yardW = bw + dim(s, 0.8, 4);
    const yardD = bd + dim(s, 1.2, 5);
    v.box(0, 0, 1, yardW, 1, yardD, 4);   // 紅磚庭院地坪

    // 3. 一樓主體（白牆與木柱框）
    v.box(0, 1, 0, bw, h1, bd, 0);        // 一樓主體白牆
    // 柱位與木骨架（角柱與正面柱列）
    const colStep = (bw - 1) / 4;
    for (let i = -2; i <= 2; i++) {
      const cx = Math.round(i * colStep);
      v.box(cx, 1, Math.round(-(bd - 1) / 2), 1, h1, 1, 1); // 正面立柱
      v.box(cx, 1, Math.round((bd - 1) / 2), 1, h1, 1, 1);  // 背面立柱
    }
    v.box(0, 1 + h1 - 1, 0, bw, 1, bd, 1); // 一樓上層木額枋

    // 4. 一樓門窗（中央格扇門 + 兩側書卷花窗）
    const doorW = dim(s, 0.85, 3, true);
    const doorH = Math.max(2, h1 - 2);
    const frontZ = Math.round(-(bd - 1) / 2);
    v.box(0, 1, frontZ, doorW, doorH, 1, 3); // 中央格扇門（碧藍木格）
    // 門框與門額匾額「天光雲影」
    v.box(0, 1 + doorH, frontZ, doorW + 2, 1, 1, 1);
    // 兩側書卷/扇形開窗（以 paintFrom / tint 點在白牆立面上）
    const winOffset = Math.round((bw - 1) / 3);
    mirrorX(v, winOffset, (vv, dx) => {
      paintFrom(vv, dx, 2, frontZ - 1, 0, 0, 1, 2, 3);
      paintFrom(vv, dx + 1, 2, frontZ - 1, 0, 0, 1, 2, 3);
      paintFrom(vv, dx - 1, 2, frontZ - 1, 0, 0, 1, 2, 3);
    });

    // 5. 一樓挑簷與二樓平座走廊
    const p1Y = 1 + h1;
    const balW = bw + eaveExt * 2;
    const balD = bd + eaveExt * 2;
    v.box(0, p1Y, 0, balW + 2, 1, balD + 2, 1); // 出挑木樑與簷枋
    v.eave(0, p1Y, 0, balW + 2, balD + 2, 2, 1); // 一樓深色瓦簷

    // 6. 二樓綠釉瓶形望柱欄杆（平座外圍一圈）
    const railY = p1Y + 1;
    const railH = dim(s, 0.30, 2);
    v.walls(0, railY, 0, balW, railH, balD, 3, 1); // 碧綠瓶欄杆主體
    v.walls(0, railY + railH, 0, balW, 1, balD, 1, 1); // 欄杆上木扶手

    // 7. 二樓樓閣主體與連排格扇花窗（觀稼樓精華）
    const u2W = bw - 2;
    const u2D = bd - 2;
    v.box(0, railY, 0, u2W, h2, u2D, 0); // 二樓白牆主體
    // 二樓全立面格扇花窗（青碧色窗櫺）
    const uFrontZ = Math.round(-(u2D - 1) / 2);
    v.box(0, railY, uFrontZ, u2W - 2, h2 - 1, 1, 3);
    // 二樓柱列與「觀稼樓」匾額
    for (let i = -2; i <= 2; i++) {
      const cx = Math.round(i * ((u2W - 1) / 4));
      v.box(cx, railY, uFrontZ, 1, h2, 1, 1);
    }
    v.box(0, railY + h2 - 1, uFrontZ, dim(s, 0.4, 3, true), 1, 1, 1); // 觀稼樓主匾

    // 8. 歇山大屋頂（飛簷與起翹）
    const roofY = railY + h2;
    const rfW = u2W + eaveExt * 2 + 2;
    const rfD = u2D + eaveExt * 2 + 2;
    v.eave(0, roofY, 0, rfW + 2, rfD + 2, 2, 1); // 二樓出簷
    hipRoof(v, 0, roofY + 1, 0, rfW, rfD, 2);    // 歇山頂瓦面收坡
    // 正脊與翹角裝飾
    const ridgeH = Math.max(1, Math.round(rfD / 2));
    const topY = roofY + 1 + ridgeH;
    v.box(0, topY, 0, rfW - ridgeH * 2 + 2, 1, 1, 2);
    mirrorX(v, Math.round((rfW - ridgeH * 2) / 2 + 1), (vv, dx) => {
      vv.box(dx, topY + 1, 0, 1, 1, 1, 2); // 兩側燕尾/起翹脊飾
    });

    // 9. 左側延伸遊廊（廊道走道與歇山雨遮）
    const corLen = dim(s, 0.85, 4);
    const corW = dim(s, 0.60, 3, true);
    const corX = -Math.round((bw + corLen) / 2) - 1;
    v.box(corX, 1, 0, corLen, 1, corW, 4); // 廊道紅磚鋪面
    // 廊柱與斜頂
    mirrorZ(v, Math.round((corW - 1) / 2), (vv, dz) => {
      for (let k = 0; k < 3; k++) {
        const lx = -Math.round((bw - 1) / 2) - 1 - k * Math.round(corLen / 2);
        vv.box(lx, 1, dz, 1, h1 - 1, 1, 1);
      }
    });
    v.gable(corX, 1 + h1 - 1, 0, corLen + 2, corW + 2, 2); // 廊道瓦頂

    // 10. 前景波浪狀特色漏窗雲牆（林家花園代表性造景）
    const wallZ = frontZ - dim(s, 0.70, 3);
    const wallH = dim(s, 0.65, 3);
    const wallSpan = Math.round(bw * 0.65);
    // 雲牆主體粉灰泥面與起伏曲線
    for (let x = -wallSpan; x <= wallSpan; x++) {
      const curve = Math.round(Math.sin((x / wallSpan) * Math.PI * 2) * 1);
      const curH = Math.max(2, wallH + curve);
      v.box(x, 1, wallZ, 1, curH, 1, 5);
      v.box(x, 1 + curH, wallZ, 1, 1, 1, 2); // 黑瓦壓頂（雲牆背脊）
    }
    // 雲牆中央與兩翼幾何透空漏窗
    v.carve(0, 2, wallZ, dim(s, 0.55, 3, true), 1, 1);
    mirrorX(v, Math.round(wallSpan * 0.6), (vv, dx) => {
      vv.carve(dx, 2, wallZ, dim(s, 0.35, 2), 1, 1);
    });
  }
});
