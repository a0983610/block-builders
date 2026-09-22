// 檔名：現代商業大樓.js
// 正面：兩翼高聳深灰金屬框架包夾通透天藍玻璃帷幕，中央梯廳挑高通透，向前大幅懸挑現代玻璃雨遮
// 側面：均勻排列水平橫向遮陽飾帶與連續辦公窗，展現現代摩天商辦的整齊立面
// 三樣識別物：高透天藍格狀玻璃帷幕、向前延伸的挑高懸挑大雨遮、屋頂通信天線塔與機房格柵
// 部件：廣場人行道 挑高迎賓大廳 懸挑玻璃雨遮 兩翼玻璃帷幕 結構外框飾條 側面連續窗 背面立面窗 屋頂女兒牆 機房設施 通訊天線 廣場綠化
customBlueprint({
  name: '現代商業大樓',
  pal: [
    '#4b5058', // 0 現代深灰金屬柱與外牆
    '#2f333a', // 1 結構暗色陰影/柱腳壓條
    '#b8d8e8', // 2 亮天藍反光玻璃帷幕
    '#4c6272', // 3 深色窗框與橫向飾條
    '#c43232', // 4 企業標誌紅（招牌燈箱）
    '#f2f5f8', // 5 象牙白標誌字體與大廳明亮頂棚
    '#9ea3aa', // 6 廣場地坪花崗岩灰
    '#3e5c32'  // 7 廣場景觀樹綠
  ],
  lo: 2.2, hi: 13.5,

  gen(v, s) {
    const totalW = dim(s, 2.2, 11, true);   // 總寬度（奇數對齊軸線）
    const totalD = dim(s, 1.4, 7);          // 總深度
    const totalH = dim(s, 4.6, 16);         // 主樓高度

    const wingW = Math.max(3, Math.floor(totalW * 0.36)); // 兩側主塔寬
    const midW = totalW - wingW * 2;                       // 中央退縮梯廳寬
    const wingD = totalD;                                  // 塔身進深
    const midD = Math.max(4, totalD - dim(s, 0.3, 2));     // 中央凹進適度平緩，加強空間採光
    const wingX = Math.floor((totalW - wingW) / 2);        // 側翼中心 x
    const floor1H = Math.max(3, dim(s, 0.65, 3));          // 一樓挑高挑空大廳

    const frontZ = -Math.floor(wingD / 2);
    const backZ = Math.floor(wingD / 2);
    const midFrontZ = frontZ + (totalD - midD);
    const midOffsetZ = Math.floor((totalD - midD) / 2);

    // 0. 人行道廣場基座（四邊延伸）
    v.box(0, 0, 0, totalW + 6, 1, totalD + 6, 6);

    // 1. 建築主量體結構外壁
    mirrorX(v, wingX, (vv, x) => {
      vv.walls(x, 1, 0, wingW, totalH, wingD, 0, 1);
    });
    v.walls(0, 1, midOffsetZ, midW + 2, totalH + 1, midD, 0, 1);

    // 2. 正面（-z）帷幕玻璃與外框架飾條
    mirrorX(v, wingX, (vv, x) => {
      const winW = wingW - 2;
      for (let wy = 1 + floor1H; wy < totalH - 1; wy++) {
        const isSpandrel = (wy % 3 === 0);
        for (let wx = -Math.floor(winW / 2); wx <= Math.floor(winW / 2); wx++) {
          const isMullion = (wx === -Math.floor(winW / 2) || wx === Math.floor(winW / 2) || wx === 0);
          vv.set(x + wx, wy, frontZ, (isSpandrel || isMullion) ? 3 : 2);
        }
      }
      // 兩側立體結構巨柱凸線（強化建築剛硬筆挺輪廓）
      vv.box(x - Math.floor(wingW / 2), 1, frontZ - 1, 1, totalH, 1, 1);
      vv.box(x + Math.floor(wingW / 2), 1, frontZ - 1, 1, totalH, 1, 1);
    });

    // 中央採光垂直玻璃帷幕
    for (let wy = 1 + floor1H; wy < totalH; wy++) {
      const isBeam = (wy % 4 === 0);
      for (let wx = -Math.floor(midW / 2); wx <= Math.floor(midW / 2); wx++) {
        v.set(wx, wy, midFrontZ, isBeam ? 3 : 2);
      }
    }

    // 3. 背面（+z）辦公窗系統（解決原版背面全黑問題）
    mirrorX(v, wingX, (vv, x) => {
      const winW = wingW - 2;
      for (let wy = 1 + floor1H; wy < totalH - 1; wy++) {
        const isBand = (wy % 3 === 1 || wy % 3 === 2);
        if (isBand) {
          for (let wx = -Math.floor(winW / 2); wx <= Math.floor(winW / 2); wx++) {
            vv.set(x + wx, wy, backZ, 2);
          }
        } else {
          for (let wx = -Math.floor(winW / 2); wx <= Math.floor(winW / 2); wx++) {
            vv.set(x + wx, wy, backZ, 3);
          }
        }
      }
    });
    // 中央背立面垂直採光梯窗
    for (let wy = 1 + floor1H; wy < totalH - 1; wy++) {
      if (wy % 2 === 0) {
        v.set(0, wy, backZ, 2);
      }
    }

    // 4. 側面（+x / -x）水平連續窗與遮陽橫線
    mirrorX(v, Math.floor(totalW / 2), (vv, x) => {
      for (let wy = 1 + floor1H; wy < totalH - 2; wy++) {
        const isFloorEdge = (wy % 3 === 0);
        for (let wz = -Math.floor(totalD / 2) + 1; wz <= Math.floor(totalD / 2) - 1; wz++) {
          vv.set(x, wy, wz, isFloorEdge ? 3 : 2);
        }
      }
    });

    // 5. 一樓通透大門、紅商標帶與現代挑高外伸雨遮
    // 紅色精緻企業招牌橫帶
    mirrorX(v, wingX, (vv, x) => {
      vv.box(x, 1 + floor1H - 1, frontZ - 1, wingW, 1, 1, 4);
      // 白色商標字標誌點綴
      vv.set(x, 1 + floor1H - 1, frontZ - 1, 5);
      // 一樓落地展示窗
      for (let wy = 1; wy < 1 + floor1H - 1; wy++) {
        for (let wx = -Math.floor(wingW / 2) + 1; wx <= Math.floor(wingW / 2) - 1; wx++) {
          vv.set(x + wx, wy, frontZ, 2);
        }
      }
    });

    // 中央挑高大門入口
    const canopyH = Math.max(2, floor1H - 1);
    v.carve(0, 1, midFrontZ, midW, canopyH, 2);
    for (let wy = 1; wy <= canopyH; wy++) {
      for (let wx = -Math.floor(midW / 2); wx <= Math.floor(midW / 2); wx++) {
        v.set(wx, wy, midFrontZ + 1, 2);
      }
    }

    // 入口大雨遮向前延伸突出至主立面之外（強化迎賓氣勢）
    const canopyOutZ = frontZ - Math.max(2, dim(s, 0.35, 2));
    const canopyLen = midFrontZ - canopyOutZ;
    const canopyCenterZ = Math.round((midFrontZ + canopyOutZ) / 2);
    const canopyW = midW + 4;
    v.box(0, 1 + canopyH, canopyCenterZ, canopyW, 1, canopyLen, 0); // 頂蓋深灰鋼構
    v.box(0, canopyH, canopyCenterZ, canopyW - 2, 1, canopyLen - 1, 5); // 內藏明亮照明平板
    // 雨遮前端兩側立柱支撐到地面
    mirrorX(v, Math.floor((canopyW - 2) / 2), (vv, cx) => {
      vv.box(cx, 1, canopyOutZ + 1, 1, canopyH, 1, 1);
    });

    // 6. 屋頂封頂、女兒牆與頂部電梯設備機房
    mirrorX(v, wingX, (vv, x) => {
      vv.box(x, totalH, 0, wingW, 1, wingD, 1);
      vv.walls(x, totalH + 1, 0, wingW, 1, wingD, 0, 1); // 女兒牆
    });
    v.box(0, totalH, midOffsetZ, midW + 2, 1, midD, 1);

    // 電梯與空調機房
    const rfW = Math.max(3, dim(s, 0.65, 3, true));
    const rfD = Math.max(3, dim(s, 0.55, 3));
    const rfH = Math.max(2, dim(s, 0.5, 3));
    const rfY = totalH + 1;
    v.box(0, rfY, midOffsetZ, rfW, rfH, rfD, 0);
    // 機房通風散熱格柵線條
    for (let gy = rfY + 1; gy < rfY + rfH; gy++) {
      v.box(0, gy, midOffsetZ - Math.floor(rfD / 2), rfW - 2, 1, 1, 3);
      v.box(0, gy, midOffsetZ + Math.floor(rfD / 2), rfW - 2, 1, 1, 3);
    }
    // 機房屋頂簷口
    v.box(0, rfY + rfH, midOffsetZ, rfW + 2, 1, rfD + 2, 1);

    // 7. 頂樓通訊天線避雷針（標誌性現代摩天樓天際線）
    const antH = Math.max(3, dim(s, 0.7, 4));
    const antY = rfY + rfH + 1;
    v.box(0, antY, midOffsetZ, 1, antH, 1, 3);
    v.box(0, antY + antH, midOffsetZ, 1, 1, 1, 5); // 避雷針頂端航空障礙發光燈

    // 8. 廣場前庭綠化行道樹
    const treeZ = frontZ - 2;
    const treeX = Math.floor(totalW / 2) + 2;
    mirrorX(v, treeX, (vv, x) => {
      vv.box(x, 1, treeZ, 1, 2, 1, 1); // 樹幹
      blob(vv, x, 3.6, treeZ, 1.3, 1.5, 1.3, 7); // 樹冠
    });
  }
});
