// 檔名：美國白宮.js
// 正面：新古典主義純白宮殿，中央突出宏偉山牆門廊與古典立柱，兩側延展出柱廊連接廊與對稱翼樓
// 側面：主樓平頂環繞古典女兒牆欄杆，南側顯現標誌性的半圓柱廊外凸結構，露台層次分明
// 三樣識別物：中央北門廊三角山形牆與古典六柱、南面半圓外凸柱廊、主樓頂部欄杆女兒牆與星條旗
// 部件：基座平台 北階梯 主樓外牆 分層腰線 簷口壓頂 女兒牆欄杆 屋頂平台 對稱煙囪 旗桿國旗 北門廊基座 北門廊立柱 三角山形牆 正面大門 南半圓露台 南半圓柱廊 南圓弧女兒牆 東西柱廊 連接長廊 柱廊開口 東翼樓 西翼樓 翼樓四坡頂 正背面窗格 南草坪噴泉池 庭園灌木
customBlueprint({
  name: '美國白宮',
  pal: [
    '#f5f7fa', // 0 純白主牆、古典廊柱、山形牆與女兒牆欄杆
    '#d5dae2', // 1 淺灰白簷口、壓頂、分層線腳、煙囪與台階
    '#737984', // 2 深灰石板基座、露台與噴泉池壁
    '#223446', // 3 深藍黑窗玻璃與大門
    '#3b6142', // 4 南草坪灌木深綠
    '#bf2d2d', // 5 國旗紅
    '#1e3d78'  // 6 國旗藍與噴泉水面藍
  ],
  lo: 2.2, hi: 22.0,

  gen(v, s) {
    // 尺度計算（保證中央對稱與奇數對齊）
    const mw = dim(s, 1.35, 7, true);            // 中央主樓面寬
    const md = dim(s, 0.95, 5, true);            // 中央主樓進深
    const mh = dim(s, 0.75, 4);                  // 主樓三層高度
    const colW = dim(s, 0.65, 3);                // 東西柱廊長度
    const colD = Math.max(2, Math.round(md * 0.45)); // 柱廊進深
    const colH = Math.max(2, Math.round(mh * 0.45)); // 柱廊高度
    const wingW = dim(s, 0.65, 3);               // 東西翼樓面寬
    const wingD = dim(s, 0.70, 5, true);         // 東西翼樓進深
    const wingH = Math.max(3, Math.round(mh * 0.55)); // 翼樓高度

    const frontZ = -Math.round((md - 1) / 2);    // 主樓北正立面 z
    const backZ = Math.round((md - 1) / 2);      // 主樓南背立面 z

    // 1. 基座台與南草坪噴泉景觀
    const totalW = mw + colW * 2 + wingW * 2;
    const baseW = totalW + 4;
    const baseD = md + dim(s, 0.75, 5);
    v.box(0, 0, 1, baseW, 1, baseD, 2);

    // 南草坪圓形噴泉池 (朝 +z 方向)
    const fz = backZ + Math.max(3, Math.round((baseD - md) / 2));
    const fr = Math.max(1.5, s * 0.16);
    v.cyl(0, 0, fz, fr + 1, 1, 2);
    v.cyl(0, 1, fz, fr, 1, 6);
    v.box(0, 1, fz, 1, 2, 1, 0); // 中央出水雕塑石柱

    // 2. 中央主樓主體 (Executive Residence)
    v.box(0, 1, 0, mw, 1, md, 1);                // 一樓地坪
    v.walls(0, 1, 0, mw, mh, md, 0, 1);          // 純白外牆
    const beltY = 1 + Math.max(1, Math.round(mh * 0.45));
    v.box(0, beltY, 0, mw + 1, 1, md + 1, 1);   // 樓層間橫向腰線

    // 主樓簷口壓頂與屋頂露台
    v.box(0, 1 + mh, 0, mw + 2, 1, md + 2, 1);   // 外凸主簷口
    v.box(0, 1 + mh, 0, mw, 1, md, 1);           // 屋頂平台
    v.walls(0, 2 + mh, 0, mw, 1, md, 0, 1);      // 頂部整圈古典女兒牆欄杆

    // 屋頂四座對稱磚石煙囪
    const sx = Math.max(1, Math.round((mw - 3) / 2));
    const sz = Math.max(1, Math.round((md - 3) / 2));
    corners4(v, sx, sz, (vv, x, z) => {
      vv.box(x, 2 + mh, z, 1, dim(s, 0.25, 2), 1, 1);
    });

    // 主樓頂部旗桿與星條旗 (朝正中央)
    const flagH = dim(s, 0.35, 3);
    const flagTop = 2 + mh + flagH;
    v.line(0, 2 + mh, 0, 0, flagTop, 0, 1);
    v.box(1, flagTop - 1, 0, 2, 1, 1, 5);        // 國旗紅
    tint(v, 1, flagTop - 1, 0, 6);               // 旗角深藍

    // 3. 北門廊立面 (North Portico - 朝 -z 正立面)
    const porticoW = dim(s, 0.65, 5, true);      // 門廊面寬（奇數）
    const porticoD = dim(s, 0.35, 2);            // 門廊前探深
    const pz = frontZ - Math.round(porticoD / 2);
    const frontEdgeZ = frontZ - porticoD;

    // 門廊基座與向外石階
    v.box(0, 1, pz, porticoW, 1, porticoD, 1);
    const stairN = dim(s, 0.18, 1);
    stairs(v, 0, 0, frontEdgeZ - stairN, stairN, porticoW, 'z', 2);

    // 古典立柱列（北門廊巨柱）
    const numPillars = porticoW >= 7 ? 6 : 4;
    rowOf(v, numPillars, (porticoW - 1) / (numPillars - 1), (vv, px) => {
      vv.box(Math.round(px), 2, frontEdgeZ, 1, mh - 1, 1, 0);
    }, 0);

    // 柱頂橫樑與三角山形牆 (Pediment)
    v.box(0, 1 + mh, pz, porticoW + 2, 1, porticoD + 1, 1);
    v.gable(0, 2 + mh, pz, porticoW + 2, porticoD + 1, 0);

    // 北正門
    arch(v, 0, 1, frontZ, 1, Math.max(2, Math.round(mh * 0.35)), 1, 0);
    v.box(0, 1, frontZ + 1, 1, 2, 1, 3);

    // 4. 南門廊立面 (South Portico - 朝 +z 圓弧門廊)
    const sr = dim(s, 0.30, 2);                  // 半圓外凸半徑
    v.cyl(0, 0, backZ, sr + 2, 1, 2);            // 南階梯弧座
    v.cyl(0, 1, backZ, sr + 1, 1, 1);            // 一樓半圓外凸平台

    // 半圓雙層古典柱列
    const southColR = sr + 0.4;
    const numSouthCols = Math.max(4, Math.round(sr * 2.2));
    ringOf(v, numSouthCols, southColR, (vv, rx, rz) => {
      vv.box(Math.round(rx), 2, Math.round(rz), 1, mh - 1, 1, 0);
    }, 0, backZ, 0, Math.PI);

    // 半圓頂部露台與圓弧女兒牆欄杆
    v.cyl(0, 1 + mh, backZ, sr + 1, 1, 1);
    v.cyl(0, 2 + mh, backZ, sr + 1, 1, 0, 1);    // 頂部圓弧欄杆

    // 5. 主樓正背面古典窗格陣列
    const winSideX = Math.round((mw + porticoW) / 4);
    const winCols = Math.max(1, Math.floor((mw - porticoW) / 4));
    const winH = Math.max(1, Math.round(mh * 0.25));
    const stepY = Math.max(2, Math.round(mh * 0.4));

    // 正面窗 (North facade)
    mirrorX(v, winSideX, (vv, wx) => {
      windowGrid(vv, {
        x: wx, y: 2, z: frontZ,
        cols: winCols, rows: 2,
        stepX: 2, stepY: stepY,
        w: 1, h: winH, c: 3, axis: 'x'
      });
    });

    // 背面窗 (South facade)
    mirrorX(v, winSideX, (vv, wx) => {
      windowGrid(vv, {
        x: wx, y: 2, z: backZ,
        cols: winCols, rows: 2,
        stepX: 2, stepY: stepY,
        w: 1, h: winH, c: 3, axis: 'x'
      });
    });

    // 兩側側牆窗
    const sideX = Math.round((mw - 1) / 2);
    mirrorX(v, sideX, (vv, sxPos) => {
      windowGrid(vv, {
        x: sxPos, y: 2, z: 0,
        cols: Math.max(1, Math.floor(md / 4)), rows: 2,
        stepX: 2, stepY: stepY,
        w: 1, h: winH, c: 3, axis: 'z'
      });
    });

    // 6. 東西連接柱廊 (Colonnades)
    const colX = Math.round((mw + colW) / 2);
    mirrorX(v, colX, (vv, cx) => {
      vv.walls(cx, 1, 0, colW, colH, colD, 0, 1);
      vv.box(cx, 1 + colH, 0, colW + 1, 1, colD + 1, 1); // 簷口
      vv.walls(cx, 2 + colH, 0, colW, 1, colD, 0, 1);    // 屋頂女兒牆

      // 正面通透柱列開口
      const numArch = Math.max(2, Math.floor(colW / 2));
      rowOf(vv, numArch, Math.max(1.8, colW / numArch), (vvv, px) => {
        vvv.carve(Math.round(px), 2, -Math.round(colD / 2), 1, colH - 1, 1);
      }, cx);
    });

    // 7. 東翼樓與西翼樓 (East Wing & West Wing)
    const wingX = Math.round(mw / 2 + colW + wingW / 2);
    mirrorX(v, wingX, (vv, wx) => {
      vv.walls(wx, 1, 0, wingW, wingH, wingD, 0, 1);
      vv.box(wx, 1 + wingH, 0, wingW + 2, 1, wingD + 2, 1); // 簷口
      hipRoof(vv, wx, 2 + wingH, 0, wingW, wingD, 1);       // 翼樓低平四坡屋頂

      const wingFaceZ = Math.round((wingD - 1) / 2);
      // 翼樓正面窗
      windowGrid(vv, {
        x: wx, y: 2, z: -wingFaceZ,
        cols: Math.max(1, Math.floor(wingW / 3)), rows: 1,
        stepX: 2, stepY: 2, w: 1, h: Math.max(1, wingH - 2), c: 3, axis: 'x'
      });

      // 翼樓背面窗
      windowGrid(vv, {
        x: wx, y: 2, z: wingFaceZ,
        cols: Math.max(1, Math.floor(wingW / 3)), rows: 1,
        stepX: 2, stepY: 2, w: 1, h: Math.max(1, wingH - 2), c: 3, axis: 'x'
      });
    });

    // 8. 南花園灌木綠籬（玫瑰園與南草坪意象）
    const bushX = Math.round(mw / 2 + colW * 0.5);
    const bushZ = Math.round(md / 2 + 1);
    mirrorX(v, bushX, (vv, bx) => {
      vv.box(bx, 1, bushZ, Math.max(2, colW - 1), 1, 2, 4);
    });
  }
});