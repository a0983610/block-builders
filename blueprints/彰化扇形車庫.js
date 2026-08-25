/* 積木小人 · 匯出的藍圖（彰化扇形車庫）
   用法二選一：放進 blueprints/ 並把檔名加進 list.js，
   或在遊戲裡按「📥 匯入建築」把整份貼進去。 */

// 檔名：彰化扇形車庫.js
customBlueprint({
  name: '彰化扇形車庫',
  pal: [
    '#9e9a91', // 0 水泥地面與柱子（淺灰）
    '#5a564e', // 1 庫體外牆與屋頂（深水泥灰）
    '#3e4347', // 2 轉車台鋼樑與軌道
    '#785338', // 3 轉盤凹槽底盤（鐵鏽棕）
    '#d94120', // 4 轉車台桁架與排氣警示（亮橘紅）
    '#d63b25', // 5 柴電機車主體（橘紅）
    '#2d5b94', // 6 經典柴電機車（深藍）
    '#d4aa48', // 7 屋頂排煙導管與車頭條紋（黃銅色）
    '#e2ded6'  // 8 車頭車頂與控制室（象牙白）
  ],
  lo: 2.2,
  hi: 14.5,

  gen(v, s) {
    // 1. 尺度與中心配置
    const groundW = dim(s, 3.8, 21, true);
    const groundD = dim(s, 3.4, 19);
    const pitR = dim(s, 0.85, 4);                // 轉車台半徑
    const pitZ = Math.round(groundD * 0.12);      // 轉車台中心稍往前偏
    const shedR = dim(s, 1.7, 9);                 // 扇形車庫內環半徑
    const shedDepth = dim(s, 0.95, 5);            // 車庫深度
    const wallH = dim(s, 0.75, 4);                // 車庫高度

    // 2. 地基與地面
    v.box(0, 0, 0, groundW, 1, groundD, 0);

    // 3. 轉車台圓形凹坑與外圍石圈
    v.cyl(0, 0, pitZ, pitR + 1, 1, 0);
    v.cyl(0, 0, pitZ, pitR, 1, 3);
    v.cyl(0, 1, pitZ, pitR + 1, 1, 0, 1);

    // 4. 轉車台主體（迴轉鋼樑橋）
    const bridgeLen = pitR * 2;
    const bridgeW = dim(s, 0.35, 2, true);
    // 主樑微傾斜角度呈現動態感
    v.box(0, 1, pitZ, bridgeW, 1, bridgeLen - 1, 2);
    v.box(0, 2, pitZ, 1, 1, bridgeLen - 1, 2);

    // 5. 轉車台中央橘色桁架門柱
    mirrorX(v, Math.max(1, Math.floor(bridgeW / 2) + 1), (vv, dx) => {
      vv.box(dx, 2, pitZ, 1, dim(s, 0.5, 3), 1, 4);
    });
    v.box(0, 2 + dim(s, 0.5, 3), pitZ, bridgeW + 2, 1, 1, 4);

    // 6. 轉盤控制操作室
    const cabZ = pitZ + Math.round(pitR * 0.5);
    v.box(Math.floor(bridgeW / 2) + 1, 2, cabZ, 2, 2, 2, 8);
    v.box(Math.floor(bridgeW / 2) + 1, 3, cabZ, 2, 1, 1, 4);

    // 7. 扇形車庫弧形排列（後方 7 個股道與車席）
    const totalBays = 7;
    const startAngle = -Math.PI * 0.68;
    const endAngle = -Math.PI * 0.32;
    const angleStep = (endAngle - startAngle) / (totalBays - 1);

    for (let i = 0; i < totalBays; i++) {
      const ang = startAngle + i * angleStep;
      const cosA = Math.cos(ang);
      const sinA = Math.sin(ang);

      // (A) 輻射狀鐵軌（轉盤到車庫入口）
      const trackStart = pitR + 1;
      const trackEnd = shedR - 1;
      for (let tr = trackStart; tr <= trackEnd; tr++) {
        const tx = Math.round(cosA * tr);
        const tz = Math.round(pitZ + sinA * tr);
        v.set(tx, 1, tz, 2);
      }

      // (B) 車庫隔間與門柱
      const bayInnerX = Math.round(cosA * shedR);
      const bayInnerZ = Math.round(pitZ + sinA * shedR);
      const bayOuterX = Math.round(cosA * (shedR + shedDepth));
      const bayOuterZ = Math.round(pitZ + sinA * (shedR + shedDepth));

      // 側柱與隔牆
      v.line(bayInnerX, 1, bayInnerZ, bayOuterX, 1, bayOuterZ, 1);
      v.line(bayInnerX, 1 + wallH, bayInnerZ, bayOuterX, 1 + wallH, bayOuterZ, 1);
      v.box(bayInnerX, 1, bayInnerZ, 1, wallH, 1, 0);

      // (C) 車庫內停放的火車頭（依序配置不同塗裝）
      const trainMidR = shedR + Math.round(shedDepth * 0.45);
      const trainX = Math.round(cosA * trainMidR);
      const trainZ = Math.round(pitZ + sinA * trainMidR);
      const trainColor = (i === 1 || i === 5) ? 6 : (i === 0 ? 8 : 5);

      const trainH = Math.max(2, wallH - 1);
      v.box(trainX, 1, trainZ, 2, trainH, 2, trainColor);
      // 車頭黃/白線條警示紋路與車頂
      v.box(trainX, 1, trainZ, 2, 1, 2, 7);
      v.box(trainX, 1 + trainH, trainZ, 2, 1, 2, 8);

      // (D) 車庫弧形外環後牆
      v.box(bayOuterX, 1, bayOuterZ, 2, wallH, 2, 1);

      // (E) 車頂煙囪（彰化扇庫經典煙囪導管）
      const ventR = shedR + Math.round(shedDepth * 0.6);
      const ventX = Math.round(cosA * ventR);
      const ventZ = Math.round(pitZ + sinA * ventR);
      v.box(ventX, 1 + wallH + 1, ventZ, 1, dim(s, 0.35, 2), 1, 7);
    }

    // 8. 扇形車庫弧形主體大屋頂與前簷
    for (let r = shedR - 1; r <= shedR + shedDepth + 1; r++) {
      const isEave = (r === shedR - 1 || r === shedR + shedDepth + 1);
      const roofColor = isEave ? 0 : 1;
      for (let a = startAngle - 0.05; a <= endAngle + 0.05; a += 0.05) {
        const rx = Math.round(Math.cos(a) * r);
        const rz = Math.round(pitZ + Math.sin(a) * r);
        v.set(rx, 1 + wallH, rz, roofColor);
      }
    }

    // 9. 側邊檢修步道與觀景台階梯
    const stairX = Math.round(groundW * 0.38);
    const stairZ = pitZ;
    stairs(v, stairX, 1, stairZ, dim(s, 0.25, 2), 2, '-z', 0);
  }
});
