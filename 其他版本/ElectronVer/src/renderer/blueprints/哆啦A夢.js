// 檔名：哆啦A夢.js
customBlueprint({
  name: '哆啦A夢',
  pal: [
    '#0b88d8', // 0 哆啦藍（頭、身、手臂）
    '#ffffff', // 1 純白（臉、腹、袋、圓手、腳掌、眼白）
    '#d62828', // 2 紅色（鼻、項圈、尾巴、嘴巴內部）
    '#f4d35e', // 3 黃色（鈴鐺）
    '#222222', // 4 墨黑（瞳孔、鬍鬚、人中、嘴唇輪廓、口袋線）
  ],
  lo: 6.5, hi: 26.5,

  gen(v, s) {
    // 1. 基準錨定：2 頭身大頭 Q 版比例
    const hr = s * 0.46;                       // 頭部半徑
    const tr = hr * 0.85;                      // 身體半徑
    const footH = Math.max(2, Math.round(hr * 0.26));
    const by = footH + tr * 0.82;              // 身體中心 Y
    const hy = by + tr * 0.78 + hr * 0.84;     // 頭部中心 Y

    // 2. 雙腳（貼地白色扁圓球）
    const footSep = hr * 0.44;
    mirrorX(v, footSep, (vv, dx) => {
      blob(vv, dx, footH * 0.5, hr * 0.1, hr * 0.44, footH * 0.5, hr * 0.58, 1);
    });

    // 3. 身體軀幹（藍色微扁球）
    blob(v, 0, by, 0, tr, tr * 0.95, tr * 0.86, 0);

    // 4. 白肚皮（正面大白圓）
    const bellyZ = -tr * 0.35;
    blob(v, 0, by - tr * 0.05, bellyZ, tr * 0.76, tr * 0.72, tr * 0.72, 1);

    // 5. 紅色圓尾巴（背部 +z 方向）
    blob(v, 0, by - tr * 0.32, tr * 0.88, hr * 0.20, hr * 0.20, hr * 0.20, 2);

    // 6. 雙手（兩側對稱張開 + 純白圓手）
    mirrorX(v, tr * 0.82, (vv, dx) => {
      const side = Math.sign(dx);
      const ex = dx + side * hr * 0.45;
      const ey = by - tr * 0.12;
      const ez = -hr * 0.08;
      limb(vv, {
        x: dx, y: by + tr * 0.36, z: 0,
        x1: ex, y1: ey, z1: ez,
        r: hr * 0.24, r1: hr * 0.21, c: 0
      });
      blob(vv, ex + side * hr * 0.06, ey, ez, hr * 0.26, hr * 0.26, hr * 0.26, 1);
    });

    // 7. 項圈與鈴鐺
    const collarY = (by + tr * 0.82 + hy - hr * 0.82) / 2;
    const collarR = tr * 0.82;
    v.cyl(0, Math.round(collarY - 0.5), 0, collarR, Math.max(1, Math.round(hr * 0.18)), 2, 2);
    const bellY = collarY - hr * 0.12;
    const bellZ = -collarR - hr * 0.12;
    // 半徑給下限：300 塊時 hr*0.24 只有 0.8，blob 只長得出中心那一格，
    // 而下面第 15 步的黑色開孔正好把它塗掉，整組黃色就消失了（體檢的必修項）
    const bellR = Math.max(1.3, hr * 0.24);
    blob(v, 0, bellY, bellZ, bellR, bellR, Math.max(1.2, hr * 0.22), 3);

    // 8. 哆啦A夢大頭（橫向飽滿大球）
    blob(v, 0, hy, 0, hr * 1.05, hr * 0.98, hr * 0.96, 0);

    // 9. 白色臉盤（略微偏下與往前突出）
    const faceZ = -hr * 0.30;
    blob(v, 0, hy - hr * 0.14, faceZ, hr * 0.86, hr * 0.74, hr * 0.78, 1);

    // 10. 大雙眼（飽滿純白大橢球，兩眼相切並排）
    const eyeR = hr * 0.30;
    const eyeY = hy + hr * 0.32;
    const eyeX = hr * 0.24;
    const eyeZ = -hr * 0.82;
    mirrorX(v, eyeX, (vv, dx) => {
      blob(vv, dx, eyeY, eyeZ, eyeR * 0.86, eyeR * 1.18, eyeR * 0.55, 1);
    });

    // 11. 紅鼻子（小巧正圓球，嵌在兩眼正下方交界處）
    const noseY = hy + hr * 0.12;
    const noseZ = -hr * 0.98;
    blob(v, 0, noseY, noseZ, hr * 0.18, hr * 0.18, hr * 0.18, 2);

    // 表面掃描換色函式（保證準確貼合曲面）
    function tintSurface(px, py, color) {
      const ix = Math.round(px);
      const iy = Math.round(py);
      const zMin = -Math.ceil(hr * 1.6);
      const zMax = Math.ceil(hr * 1.6);
      for (let iz = zMin; iz <= zMax; iz++) {
        if (v.has(ix, iy, iz)) {
          v.set(ix, iy, iz, color);
          return true;
        }
      }
      return false;
    }

    // 12. 黑色黑眼珠（點在白眼球正前中央偏內側，圓形小黑點）
    mirrorX(v, eyeX * 0.75, (vv, dx) => {
      tintSurface(dx, eyeY, 4);
    });

    // 13. 人中直線（從紅鼻下緣到嘴巴上沿）
    const mouthTop = noseY - hr * 0.18;
    const mouthMid = hy - hr * 0.22;
    const mouthBottom = hy - hr * 0.52;
    for (let y = Math.round(mouthMid); y <= Math.round(mouthTop); y++) {
      tintSurface(0, y, 4);
    }

    // 14. 經典張口大笑嘴（大 D 型紅嘴巴 + 黑色唇線）
    const mw = hr * 0.62;
    for (let x = -Math.round(mw); x <= Math.round(mw); x++) {
      const norm = x / mw;
      const bottomCurve = mouthBottom + (norm * norm) * (mouthMid - mouthBottom);
      // 嘴內填紅
      for (let y = Math.round(bottomCurve); y <= Math.round(mouthMid); y++) {
        tintSurface(x, y, 2);
      }
      // 嘴巴底弧黑色唇線
      tintSurface(x, bottomCurve, 4);
      // 嘴巴頂部水平微笑線
      tintSurface(x, mouthMid, 4);
    }

    // 15. 兩側六根鬍鬚（向外放射展開，避開嘴巴）
    mirrorX(v, hr * 0.36, (vv, dx) => {
      const whiskLen = Math.round(hr * 0.44);
      const dir = Math.sign(dx);
      const whisks = [
        { yOffset: hr * 0.14, slope: 0.28 },  // 上斜
        { yOffset: hr * 0.02, slope: 0 },     // 水平
        { yOffset: -hr * 0.10, slope: -0.28 } // 下斜
      ];
      whisks.forEach(w => {
        for (let k = 0; k < whiskLen; k++) {
          const px = dx + dir * k;
          const py = noseY + w.yOffset + (k * w.slope);
          tintSurface(px, py, 4);
        }
      });
    });

    // 16. 百寶袋（貼在肚皮上的半圓口袋 + 黑色開口）
    const pY = Math.round(by - tr * 0.08);
    const pR = Math.round(tr * 0.46);
    for (let x = -pR; x <= pR; x++) {
      tintSurface(x, pY, 4); // 袋口橫線
      const dy = -Math.round(Math.sqrt(Math.max(0, pR * pR - x * x)));
      tintSurface(x, pY + dy, 4); // 袋底弧線
    }

    // 鈴鐺黑色中央開孔
    tintSurface(0, bellY, 4);
    tintSurface(0, bellY - 1, 4);
  }
});
