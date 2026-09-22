// 檔名：商業大樓.js
// 正面：中央內凹迎賓門廊、兩側主翼雄偉前探的對稱現代商業大樓，帶大面積規整天藍玻璃帷幕、通透挑出雨遮與前庭景觀花台
// 側面：穩重沉著的深磚褐實石牆體，排列貫穿樓層的整齊垂直採光長窗，清晰展現前翼突出與後退層次
// 三樣識別物：兩翼與中央三組高聳通透格狀玻璃帷幕、底層現代挑出石材雨遮與感應雙開玻璃大門、屋頂電梯機房與空調散熱排風設備群
// 部件：混凝土基座(box) 前庭灌木景觀花台(box) 左右主翼與中央凹退主樓(box) 外轉角與凹角造型飾柱(box) 層間板結構橫帶(box/set) 格狀天藍玻璃帷幕(set) 迎賓挑出雨遮與感應玻璃大門(box) 側立面垂直採光長窗(windowGrid) 屋頂平臺與石材壓頂女兒牆(box/walls) 電梯機房與進排風百葉(box) 屋頂冷卻塔與空調散熱設備組(box)
customBlueprint({
  name: '商業大樓',
  pal: [
    '#574b49', // 0 建築外牆磚石深褐（主結構柱、側牆與背牆）
    '#383538', // 1 窗框、鋁合金外框骨架、機房百葉、設備支架（深黑灰）
    '#4c6779', // 2 帷幕玻璃深海藍層間板/橫帶（Spandrel Glass）
    '#86a6b9', // 3 帷幕主玻璃（清透藍灰）
    '#b5dcfb', // 4 玻璃反光高光與明亮大門感應門扇（亮淺天藍）
    '#87878a', // 5 混凝土基座、大門挑出雨遮、女兒牆壓頂（淺灰石材）
    '#585a5e', // 6 屋頂地坪防水層、電梯機房外殼與冷卻塔（設備深灰）
    '#578739', // 7 前庭綠化花台灌木與景觀草皮（鮮活草綠）
    '#9bc4cc', // 8 帷幕玻璃天光反光/淡青藍採光帶（淺青天藍）
  ],
  lo: 1.1,
  hi: 11.5,

  gen(v, s) {
    const fw = dim(s, 2.7, 9, true);    // 總面寬（奇數以利中軸對稱）
    const fd = dim(s, 1.8, 5);          // 總深度
    const h  = dim(s, 2.9, 7);          // 主樓高度
    const wingW = Math.max(2, Math.round(fw * 0.33)); // 兩側主翼寬度
    const centerW = fw - wingW * 2;     // 中央凹陷迎賓處寬度
    const offsetZ = Math.max(1, dim(s, 0.28, 1));     // 凹凸進深

    const wingX = Math.round((fw - wingW) / 2);
    const halfD = Math.round(fd / 2);
    const wingFrontZ = -halfD;
    const centerFrontZ = -halfD + offsetZ;
    const backZ = halfD;

    // 1. 底層混凝土基座（四周外凸 1 格，堅固貼地）
    v.box(0, 0, 0, fw + 2, 1, fd + 2, 5);

    // 2. 前庭綠化花台（兩翼前方景觀灌木帶，任何尺寸均有充裕格數）
    const shrubW = Math.max(2, dim(s, 0.55, 2));
    const shrubD = Math.max(2, dim(s, 0.35, 2));
    const shrubZ = wingFrontZ - Math.floor(shrubD / 2) - 1;
    mirrorX(v, wingX, (vv, x) => {
      vv.box(x, 0, shrubZ, shrubW + 2, 1, shrubD + 2, 5); // 淺灰石材矮框
      vv.box(x, 1, shrubZ, shrubW, 1, shrubD, 7);         // 景觀草坪綠灌木
      if (shrubW >= 3 && shrubD >= 3) {
        vv.box(x, 2, shrubZ, shrubW - 2, 1, shrubD - 2, 7); // 修剪灌木頂
      }
    });

    // 3. 主樓量體結構（兩翼向前突出 offsetZ，中央向內退縮）
    v.box(0, 1, 0, centerW, h, fd, 0);
    mirrorX(v, wingX, (vv, x) => {
      vv.box(x, 1, -offsetZ / 2, wingW, h, fd + offsetZ, 0);
    });

    // 外轉角與凹槽立體造型飾柱
    const colW = Math.max(1, dim(s, 0.22, 1));
    mirrorX(v, (fw - colW) / 2, (vv, cx) => {
      vv.box(cx, 1, wingFrontZ + (colW - 1) / 2, colW, h + 1, colW, 0);
      vv.box(cx, 1, backZ - (colW - 1) / 2, colW, h + 1, colW, 0);
    });
    mirrorX(v, Math.round(centerW / 2), (vv, cx) => {
      vv.box(cx, 1, (wingFrontZ + centerFrontZ) / 2, 1, h + 1, offsetZ + 1, 0);
    });

    // 4. 左右兩翼：正面格狀藍色玻璃帷幕
    const wingWinW = Math.max(2, wingW - colW);
    const winBottomY = Math.min(3, Math.max(2, h - 5));
    const winTopY = h - 1;
    const floorH = (h >= 14) ? 3 : 2;

    mirrorX(v, wingX, (vv, x) => {
      const startX = x - Math.floor(wingWinW / 2);
      const endX = x + Math.floor((wingWinW - 1) / 2);

      for (let wy = winBottomY; wy < winTopY; wy++) {
        const isFloorBand = ((wy - winBottomY) % floorH === 0);

        for (let wx = startX; wx <= endX; wx++) {
          if (isFloorBand) {
            // 深海藍層間板（Spandrel Band）：整條水平通長橫帶，任何尺寸均保證穩固存在
            vv.set(wx, wy, wingFrontZ, 2);
          } else {
            // 採光玻璃層：大尺寸保留外框與細梃，小尺寸全留給清透玻璃
            const isSideFrame = (wingWinW >= 4) && (wx === startX || wx === endX);
            const isVertMullion = (wingWinW >= 6) && ((wx - startX) % 3 === 0);

            if (isSideFrame || isVertMullion) {
              vv.set(wx, wy, wingFrontZ, 1); // 黑色鋁合金窗梃
            } else {
              // 玻璃主體：清透藍灰、反光高光與淡青天光反射交錯呈現真實質感
              const pattern = (wx - startX + wy) % 3;
              const glassC = (pattern === 1) ? 4 : (pattern === 2 ? 8 : 3);
              vv.set(wx, wy, wingFrontZ, glassC);
            }
          }
        }
      }
    });

    // 5. 中央量體：垂直通景玻璃帷幕
    const cWinW = Math.max(2, centerW - 2);
    const canopyY = Math.min(3, Math.max(2, Math.round(h * 0.25)));
    const cWinBottomY = Math.min(canopyY + 1, h - 3);
    const cStart = -Math.floor(cWinW / 2);
    const cEnd = Math.floor((cWinW - 1) / 2);

    for (let wy = cWinBottomY; wy < winTopY; wy++) {
      const isFloorBand = ((wy - cWinBottomY) % floorH === 0);
      for (let wx = cStart; wx <= cEnd; wx++) {
        if (isFloorBand) {
          v.set(wx, wy, centerFrontZ, 2); // 深海藍層間板
        } else {
          const isSideFrame = (cWinW >= 4) && (wx === cStart || wx === cEnd);
          const isVertMullion = (cWinW >= 6) && (wx === 0);

          if (isSideFrame || isVertMullion) {
            v.set(wx, wy, centerFrontZ, 1);
          } else {
            const pattern = (wx - cStart + wy) % 3;
            const glassC = (pattern === 1) ? 4 : (pattern === 2 ? 8 : 3);
            v.set(wx, wy, centerFrontZ, glassC);
          }
        }
      }
    }

    // 6. 底層中央迎賓門廊（挑出石材雨遮 + 現代感應玻璃雙開大門）
    const canopyW = Math.min(centerW, dim(s, 0.95, 3, true));
    const canopyD = offsetZ + 1;

    // 挑出石材雨遮
    v.box(0, canopyY, centerFrontZ - Math.floor(canopyD / 2), canopyW, 1, canopyD, 5);

    // 大門黑金屬門框
    const doorW = Math.max(3, canopyW - 2, true);
    const doorH = Math.max(1, canopyY - 1);
    v.box(0, 1, centerFrontZ, doorW, doorH, 1, 1);

    // 清亮淺天藍感應玻璃雙開大門門扇
    const glassDoorW = Math.max(1, doorW - 2);
    v.box(0, 1, centerFrontZ, glassDoorW, doorH, 1, 4);

    // 門楣淡青採光氣窗（保證 pal[8] 具備明確建築構件支撐）
    if (doorH >= 2) {
      v.box(0, doorH, centerFrontZ, glassDoorW, 1, 1, 8);
    } else {
      v.set(-Math.floor(doorW / 2), 1, centerFrontZ, 8);
      v.set(Math.floor(doorW / 2), 1, centerFrontZ, 8);
    }

    // 門前迎賓踏階
    v.box(0, 0, centerFrontZ - Math.floor(canopyD / 2), canopyW + 2, 1, canopyD + 2, 5);

    // 7. 側立面規整垂直採光長窗
    const sideWinRows = Math.max(1, Math.floor((h - 4) / 2));
    const sideWinCols = Math.max(1, Math.floor((fd - 2) / 3));
    if (sideWinRows > 0 && sideWinCols > 0) {
      mirrorX(v, (fw - 1) / 2, (vv, x) => {
        windowGrid(vv, {
          x: x,
          y: 2,
          z: 0,
          cols: sideWinCols,
          rows: sideWinRows,
          stepZ: 3,
          stepY: 2,
          w: 1,
          h: 1,
          c: 3,
          axis: 'z',
        });
      });
    }

    // 8. 屋頂平臺與石材壓頂女兒牆
    // 兩翼平臺與壓頂
    mirrorX(v, wingX, (vv, x) => {
      vv.box(x, h, -offsetZ / 2, wingW, 1, fd + offsetZ, 6);
      vv.walls(x, h + 1, -offsetZ / 2, wingW, 1, fd + offsetZ, 5, 1);
    });
    // 中央平臺與壓頂
    v.box(0, h, 0, centerW, 1, fd, 6);
    v.walls(0, h + 1, 0, centerW, 1, fd, 5, 1);

    // 9. 屋頂電梯機房與空調散熱設備群 (Penthouse & HVAC)
    const phW = Math.max(3, dim(s, 0.75, 3, true));
    const phD = Math.max(3, dim(s, 0.55, 3));
    const phH = Math.max(2, dim(s, 0.45, 2));
    const phZ = Math.round(fd * 0.08);

    // 機房本體與石材挑出壓頂
    v.box(0, h + 1, phZ, phW, phH, phD, 0);
    v.box(0, h + 1 + phH, phZ, phW + 1, 1, phD + 1, 5);

    // 機房正面與背面進排風金屬百葉
    mirrorZ(v, Math.floor(phD / 2), (vv, dz) => {
      vv.box(0, h + 1 + Math.floor(phH / 2), phZ + dz, Math.max(1, phW - 2), 1, 1, 1);
    });

    // 屋頂中央冷卻塔排風機組
    const ctW = Math.max(1, Math.round(phW * 0.6));
    const ctD = Math.max(1, Math.round(phD * 0.5));
    v.box(0, h + 2 + phH, phZ, ctW, 1, ctD, 6);
    v.box(0, h + 3 + phH, phZ, Math.max(1, ctW - 1), 1, Math.max(1, ctD - 1), 1);

    // 兩翼輔助空調室外機組
    if (wingW >= 3) {
      mirrorX(v, wingX, (vv, x) => {
        vv.box(x, h + 1, Math.round(fd * 0.15), 2, 1, 2, 6);
        vv.box(x, h + 2, Math.round(fd * 0.15), 1, 1, 1, 1);
      });
    }
  },
});