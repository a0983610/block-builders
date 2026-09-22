// 檔名：日式天目曜變瓷碗.js
// 正面：倒梯形微弧碗身，底部有明顯收攏的圓形圈足，上深下淺漸層
// 側面：與正面相同，呈圓潤規整的旋轉體瓷碗輪廓，內凹碗腔深邃
// 三樣識別物：高挺厚實的圈足、上黑下灰藍的漸層曜變釉色、釉面如雪花般散佈的窯變結晶斑點
// 部件：圈足露胎環 圈足掏臍 圈足外釉 圈足竹節線 碗底厚胚 碗心茶溜 碗腹灰藍結晶段 碗腰墨藍曜變段 碗肩曜黑厚釉段 碗口厚唇 口沿高光 內壁曜變斑

customBlueprint({
  name: '日式天目曜變瓷碗',
  pal: [
    '#0c0d12', // 0 天目曜黑（碗口與深色釉）
    '#24252b', // 1 曜變深藍黑
    '#474c55', // 2 墨藍過渡釉
    '#74777b', // 3 灰藍窯變斑
    '#94969a', // 4 淺灰雪花結晶
    '#c7c8ca', // 5 灰白陶胎／足圈
    '#fefefe'  // 6 釉面極光斑／反光
  ],
  lo: 2.2, hi: 22.0,

  gen(v, s) {
    // 尺度計算（保持原本精確造型比例）
    const rMax = dim(s, 1.45, 6);         // 碗口外半徑
    const totalH = dim(s, 1.60, 7);       // 瓷碗總高度
    const footH = Math.max(1, Math.round(totalH * 0.16)); // 圈足高度
    const footR = Math.max(2.5, rMax * 0.44);             // 圈足外半徑
    const bowlH = totalH - footH;         // 碗身高度
    const wallThick = Math.max(1, Math.round(rMax * 0.12)); // 碗壁厚度

    // 確定性偽隨機雜訊，用於生成自然的雪花結晶斑
    function hash(x, y, z) {
      let h = (x * 374761393 + y * 668265263 + z * 912384741) ^ 1234567;
      h = (h ^ (h >> 13)) * 1274126177;
      return ((h ^ (h >> 16)) & 0x7fffffff) / 2147483647;
    }

    // 1. 圈足露胎接地環（陶胎無釉底環）
    v.cyl(0, 0, 0, footR, 1, 5, wallThick);

    // 2. 圈足內底掏膛（足臍凹入，深1格）
    v.carve(0, 0, 0, Math.round((footR - wallThick) * 2), 1, Math.round((footR - wallThick) * 2));

    // 3. 圈足外壁過渡釉層（往上微染釉色）
    if (footH > 1) {
      v.cyl(0, 1, 0, footR + 0.2, footH - 1, 4, wallThick);
      v.cyl(0, footH - 1, 0, footR + 0.4, 1, 3, wallThick);
    }

    // 4. 圈足與腹部交界處的竹節收口線腳
    v.cyl(0, footH, 0, footR + 0.6, 1, 3, 1);

    // 5. 碗底厚胚實心底層（圈足頂部封閉胎底）
    v.cyl(0, footH, 0, footR, 1, 2);

    // 6. 碗心深處茶溜（碗底內凹微深之茶池）
    const teaWellR = Math.max(1.2, footR - wallThick * 1.2);
    v.cyl(0, footH + 1, 0, teaWellR, 1, 1);

    // 碗身弧曲面（從圈足向上展開的拋物線微弧輪廓）
    for (let dy = 0; dy <= bowlH; dy++) {
      const y = footH + dy;
      const t = dy / bowlH; // 0 (底部) 到 1 (碗口)
      const curR = footR + (rMax - footR) * Math.pow(t, 0.75);
      const curInR = Math.max(0, curR - wallThick);
      const rCeil = Math.ceil(curR);

      for (let x = -rCeil; x <= rCeil; x++) {
        for (let z = -rCeil; z <= rCeil; z++) {
          const d = Math.hypot(x, z);
          const isSolid = (dy <= 1 && d <= curR);
          const isWall = (d <= curR && d >= curInR);

          if (isSolid || isWall) {
            let baseC;
            if (t > 0.65) {
              baseC = 0; // 7. 碗肩曜黑厚釉段
            } else if (t > 0.45) {
              baseC = 1; // 8. 碗腰墨藍曜變段
            } else if (t > 0.25) {
              baseC = 2; // 9. 碗腹中段過渡段
            } else {
              baseC = 3; // 10. 碗底下段灰藍結晶段
            }

            // 雪花曜變結晶斑點擾動
            const rnd = hash(x, y, z);
            let finalC = baseC;
            const isSurface = (d >= curR - 1.1) || (d <= curInR + 1.1);

            if (isSurface) {
              if (t > 0.65) {
                if (rnd > 0.88) finalC = 1;
                else if (rnd > 0.96) finalC = 2;
              } else if (t > 0.25) {
                if (rnd > 0.84) finalC = 4;
                else if (rnd > 0.62) finalC = 3;
                else if (rnd > 0.35) finalC = 2;
              } else {
                if (rnd > 0.80) finalC = 5;
                else if (rnd > 0.50) finalC = 4;
                else if (rnd > 0.25) finalC = 3;
              }

              // 碗口高光反光斑點
              if (t >= 0.88 && x > curR * 0.3 && z < -curR * 0.3 && rnd > 0.72) {
                finalC = 6;
              }
            }

            v.set(x, y, z, finalC);
          }
        }
      }
    }

    // 11. 碗口厚唇口緣壓圈
    const rimY = footH + bowlH;
    v.cyl(0, rimY, 0, rMax, 1, 0, Math.max(1, Math.round(wallThick * 0.8)));

    // 12. 口沿瓷釉高光弧段（模擬參考圖口緣反光）
    const hlAngleStart = -0.7;
    const hlAngleEnd = 0.2;
    ringOf(v, 7, rMax - 0.2, (vv, x, z) => {
      tint(vv, Math.round(x), rimY, Math.round(z), 6);
    }, 0, 0, hlAngleStart, hlAngleEnd - hlAngleStart);

    // 13. 碗內壁深處曜變光澤亮點微調
    ringOf(v, 6, footR + 0.5, (vv, x, z) => {
      tint(vv, Math.round(x), footH + 2, Math.round(z), 2);
    });
  }
});