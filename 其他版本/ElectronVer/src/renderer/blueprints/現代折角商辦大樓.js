// 檔名：現代折角商辦大樓.js
// 正面：折角內凹的現代雙翼商辦立面，中央為退縮斜角玻璃帷幕大廳與迎賓雨遮
// 側面：整齊排列的橫向連續帷幕窗格與結構層間線，展現俐落現代立面
// 三樣識別物：前方中央缺角的內凹轉角中庭、深褐灰石材垂直框架、四周連續的深淺反光玻璃帷幕
// 部件：基座行人道、左右翼主樓量體、轉角斜面帷幕核心、垂直外框巨柱、四面帷幕窗格網、挑高入口雨遮、大廳玻璃門、商業招牌金屬飾帶、頂樓女兒牆與電梯機房、行道樹

customBlueprint({
  name: '現代折角商辦大樓',
  pal: [
    '#484648', // 0 深色石材巨柱與外框
    '#686669', // 1 結構主體與背側石牆
    '#868788', // 2 窗框橫帶與中度陰影石材
    '#a5a8a8', // 3 玻璃帷幕主要反射面（淺灰青）
    '#d5dbea', // 4 玻璃帷幕高光與天空反光（冷白）
    '#2b3724', // 5 門前行道樹植栽
    '#d9a441', // 6 沿街商業招牌與金屬飾帶
    '#c7c6c8'  // 7 人行道鋪面與入口挑高頂部
  ],
  lo: 1.2,
  hi: 13.5,

  gen(v, s) {
    // 樓體基本尺度
    const totalW = dim(s, 2.6, 7, true);  // 建築總寬 (x 軸)
    const totalD = dim(s, 2.4, 7);        // 建築總深 (z 軸，正面向 -z)
    const h = dim(s, 4.2, 10);            // 大樓總高度
    const notchW = dim(s, 0.95, 3, true); // 前方缺角的寬度
    const notchD = dim(s, 0.85, 2);       // 前方缺角的深度

    // 1. 基底人行道鋪面 (包覆整棟建築外圍，確保底層堅固連通)
    v.box(0, 0, 0, totalW + 4, 1, totalD + 4, 7);

    // 2. 主樓量體（實心背體 + 凹角造型）
    const backD = totalD - notchD;
    const backZ = Math.round(notchD / 2);
    v.box(0, 1, backZ, totalW, h, backD, 1);

    // 左翼與右翼前伸部（構成前方中間缺角造型）
    const wingW = Math.max(2, Math.round((totalW - notchW) / 2));
    const leftX = -Math.round(totalW / 2) + Math.round(wingW / 2);
    const rightX = Math.round(totalW / 2) - Math.round(wingW / 2);
    const frontZ = -Math.round(totalD / 2) + Math.round(notchD / 2);

    v.box(leftX, 1, frontZ, wingW, h, notchD, 1);
    v.box(rightX, 1, frontZ, wingW, h, notchD, 1);

    // 3. 轉角內凹處：斜向過渡的玻璃中庭帷幕面
    const cornerZ = -Math.round(totalD / 2) + notchD;
    const stepCount = Math.max(1, Math.floor(notchW / 2));
    for (let i = 0; i <= stepCount; i++) {
      const cz = cornerZ - Math.round(i * (notchD / (stepCount + 1)));
      const cw = Math.max(1, notchW - i * 2);
      v.box(0, 1, cz, cw, h, 1, 3);
    }

    // 4. 正立面石材巨柱與框架 (左翼與右翼正面 -z 側)
    const colThick = Math.max(1, Math.round(dim(s, 0.2, 1)));
    const frontFaceZ = -Math.round(totalD / 2);

    // 左右兩側正面垂直邊柱與中柱
    [leftX, rightX].forEach((wx) => {
      v.box(wx, 1, frontFaceZ, wingW, h, colThick, 0);

      // 挖出兩道縱向帷幕窗井（形成被石柱分割的巨大玻璃面）
      const subBayW = Math.max(1, Math.floor((wingW - 2) / 2));
      const bayOffset = Math.max(1, Math.floor(subBayW / 2) + 1);
      v.carve(wx - bayOffset, 2, frontFaceZ, subBayW, h - 3, colThick);
      v.carve(wx + bayOffset, 2, frontFaceZ, subBayW, h - 3, colThick);

      // 補上玻璃帷幕
      v.box(wx - bayOffset, 2, frontFaceZ, subBayW, h - 3, 1, 3);
      v.box(wx + bayOffset, 2, frontFaceZ, subBayW, h - 3, 1, 3);

      // 細分橫向樓層線與反光格線
      const floorH = Math.max(2, Math.round(dim(s, 0.45, 2)));
      for (let y = 2; y < h - 2; y += floorH) {
        v.box(wx - bayOffset, y, frontFaceZ, subBayW, 1, 1, 2);
        v.box(wx + bayOffset, y, frontFaceZ, subBayW, 1, 1, 2);
        if ((y / floorH) % 2 === 0) {
          tint(v, wx - bayOffset, y + 1, frontFaceZ, 4);
          tint(v, wx + bayOffset, y + 1, frontFaceZ, 4);
        }
      }
    });

    // 5. 中間凹角的垂直轉角巨柱
    const pillarR = Math.max(1, Math.round(dim(s, 0.35, 1)));
    const pillarZ = frontFaceZ + notchD - 1;
    v.box(-Math.round(notchW / 2), 1, pillarZ, pillarR * 2 + 1, h + 1, pillarR * 2 + 1, 0);
    v.box(Math.round(notchW / 2), 1, pillarZ, pillarR * 2 + 1, h + 1, pillarR * 2 + 1, 0);
    for (let y = 3; y < h - 1; y += 2) {
      tint(v, -Math.round(notchW / 2), y, pillarZ - pillarR, 4);
      tint(v, Math.round(notchW / 2), y, pillarZ - pillarR, 4);
    }

    // 6. 中間凹角正面：入口雨遮與迎賓門廳
    const canopyH = Math.max(2, Math.round(dim(s, 0.4, 2)));
    const canopyZ = frontFaceZ + Math.round(notchD / 2);
    v.box(0, canopyH + 1, canopyZ, notchW + 1, 1, notchD, 0);
    v.box(0, canopyH + 2, canopyZ, notchW - 1, 1, notchD - 1, 2);
    v.box(0, 1, cornerZ + 1, Math.max(1, notchW - 2), canopyH, 1, 4);
    v.box(-Math.round(notchW / 2) + 1, 1, canopyZ - Math.round(notchD / 4), 1, canopyH, 1, 0);
    v.box(Math.round(notchW / 2) - 1, 1, canopyZ - Math.round(notchD / 4), 1, canopyH, 1, 0);

    // 7. 一樓沿街立面：商業招牌與金屬飾帶（使用 dim 確保各尺度下限至少 2 格）
    const signW = dim(s, 0.6, 2);
    v.box(leftX, 2, frontFaceZ - 1, signW, 1, 1, 6);
    v.box(rightX, 2, frontFaceZ - 1, signW, 1, 1, 6);
    // 中央挑高雨遮正面的金屬招牌飾帶
    v.box(0, canopyH + 1, frontFaceZ + 1, signW, 1, 1, 6);

    // 8. 外側立面（側面 +x, -x 牆面窗格與橫帶）
    const sideX = (totalW - 1) / 2;
    const sideWinRows = Math.max(2, Math.floor((h - 5) / 3));
    const sideWinCols = Math.max(2, Math.floor((totalD - 3) / 3));
    mirrorX(v, sideX, (vv, dx) => {
      windowGrid(vv, {
        x: dx,
        y: 3,
        z: 0,
        cols: sideWinCols,
        rows: sideWinRows,
        stepX: 3,
        stepY: 3,
        w: 1,
        h: 2,
        c: 3,
        axis: 'z'
      });
      // 側面樓層分界線
      for (let y = 5; y < h - 2; y += 3) {
        for (let cz = -Math.floor(totalD / 2) + 1; cz <= Math.floor(totalD / 2) - 1; cz += 2) {
          tint(vv, dx, y, cz, 2);
        }
      }
    });

    // 9. 背側立面（+z 側牆面開窗與結構線）
    const backFaceZ = backZ + Math.floor(backD / 2);
    const backWinCols = Math.max(2, Math.floor((totalW - 4) / 3));
    windowGrid(v, {
      x: 0,
      y: 3,
      z: backFaceZ,
      cols: backWinCols,
      rows: sideWinRows,
      stepX: 3,
      stepY: 3,
      w: 1,
      h: 2,
      c: 3,
      axis: 'x'
    });
    // 背面橫向深色層間石材橫帶
    for (let y = 5; y < h - 2; y += 3) {
      for (let bx = -Math.floor(totalW / 2) + 2; bx <= Math.floor(totalW / 2) - 2; bx += 2) {
        tint(v, bx, y, backFaceZ, 0);
      }
    }

    // 10. 屋頂女兒牆與電梯機房設備層
    v.walls(0, h + 1, backZ, totalW, 1, backD, 0, 1);
    v.walls(leftX, h + 1, frontZ, wingW, 1, notchD, 0, 1);
    v.walls(rightX, h + 1, frontZ, wingW, 1, notchD, 0, 1);

    const coreW = Math.max(3, Math.round(totalW * 0.35));
    const coreD = Math.max(3, Math.round(backD * 0.45));
    const coreH = Math.max(2, Math.round(dim(s, 0.6, 2)));
    v.box(0, h + 1, backZ, coreW, coreH, coreD, 0);
    v.box(0, h + coreH + 1, backZ, coreW + 1, 1, coreD + 1, 2);

    // 11. 門前行道樹
    const treeZ = frontFaceZ - 1;
    const treeR = dim(s, 0.28, 1.3);
    [-Math.round(totalW * 0.42), Math.round(totalW * 0.42)].forEach((tx) => {
      v.box(tx, 1, treeZ, 1, 3, 1, 0);
      blob(v, tx, 4 + treeR, treeZ, treeR, treeR * 0.9, treeR, 5);
    });
  }
});