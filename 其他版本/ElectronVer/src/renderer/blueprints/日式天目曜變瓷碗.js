// 檔名：日式天目曜變瓷碗.js
// v1.263.0：只調色（格子一格沒動）：灰階改成漆黑釉上散著曜變斑（銀藍斑心＋藍光暈＋青／紫虹彩外圈），外側與口沿黑褐、圈足露胎土褐（見 開發筆記〈自訂藍圖調整一輪（v1.263.0）〉）
// 正面：倒梯形微弧碗身，底部有明顯收攏的圓形圈足，上深下淺漸層
// 側面：與正面相同，呈圓潤規整的旋轉體瓷碗輪廓，內凹碗腔深邃
// 三樣識別物：高挺厚實的圈足、上黑下灰藍的漸層曜變釉色、釉面如雪花般散佈的窯變結晶斑點
// 部件：圈足露胎環 圈足掏臍 圈足外釉 圈足竹節線 碗底厚胚 碗心茶溜 碗腹灰藍結晶段 碗腰墨藍曜變段 碗肩曜黑厚釉段 碗口厚唇 口沿高光 內壁曜變斑

customBlueprint({
  name: '日式天目曜變瓷碗',
  pal: [
    '#0c0d12', // 0 天目曜黑（碗內的黑釉、外側釉的黑斑）
    '#2557c0', // 1 曜變藍光暈（斑心外第一圈）
    '#2fb0c6', // 2 青色虹彩（光暈最外圈）
    '#7a52c2', // 3 紫色虹彩（光暈最外圈）
    '#cde0f2', // 4 曜變斑心（銀藍的一點）
    '#22160e', // 5 外側黑褐釉、口沿釉薄處、圈足上方的釉際
    '#7a5236'  // 6 圈足露胎、碗底胎與壁厚裡的胎土（土褐）
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

    /* 曜變斑：空間切成 4 格見方的方塊，每塊用一次雜湊決定有沒有斑、斑心擺哪、光暈多大。
       斑心是銀藍的一點，外面一圈藍、最外一圈一側青一側紫——曜變認得出來的就是這圈虹彩光暈。
       碗底與下半部斑比較密，往碗口漸疏。每格查自己那塊加上靠過去的七塊（2×2×2），
       斑才不會在方塊邊上被切成直邊；斑落在曲面上，看不出是方格排的。回傳 -1 是沒有斑（黑釉）。 */
    function spot(x, y, z) {
      const bx = Math.floor(x / 4), by = Math.floor(y / 4), bz = Math.floor(z / 4);
      const ox = x - bx * 4 < 2 ? -1 : 1, oy = y - by * 4 < 2 ? -1 : 1, oz = z - bz * 4 < 2 ? -1 : 1;
      let best = 1, hb = 0, sx = 0, sy = 0, sz = 0;
      for (let i = 0; i < 8; i++) {
        const gx = bx + (i & 1 ? ox : 0), gy = by + (i & 2 ? oy : 0), gz = bz + (i & 4 ? oz : 0);
        let h = Math.imul(gx, 374761393) ^ Math.imul(gy, 668265263) ^ Math.imul(gz, 1274126177);
        h = Math.imul(h ^ (h >>> 13), 1103515245);
        h = (h ^ (h >>> 16)) >>> 0;
        const tb = (gy * 4 + 2 - footH) / bowlH;                  // 這一塊大約在碗的哪個高度
        if ((h & 255) >= 210 - tb * 100) continue;               // 有斑的方塊：碗底約八成、碗口約四成
        const ex = x - (gx * 4 + 0.4 + ((h >>> 8) & 7) * 0.46);   // 斑心落在方塊裡 0.4～3.6 格
        const ey = y - (gy * 4 + 0.4 + ((h >>> 11) & 7) * 0.46);
        const ez = z - (gz * 4 + 0.4 + ((h >>> 14) & 7) * 0.46);
        const r = 1.3 + ((h >>> 17) & 3) * 0.25;                  // 光暈半徑 1.3～2.05
        const q = (ex * ex + ey * ey + ez * ez) / (r * r);        // 距離／半徑 的平方
        if (q < best) { best = q; hb = h; sx = ex; sy = ey; sz = ez; }
      }
      if (best >= 1) return -1;
      if (best < 0.2) return 4;                                   // 斑心（半徑四成五以內）
      if (best < 0.56) return 1;                                  // 藍光暈（半徑七成五以內）
      return (sx - sz + sy) * ((hb >>> 20) & 1 ? 1 : -1) > 0 ? 2 : 3;   // 虹彩外圈：一側青、一側紫
    }

    // 1. 圈足露胎接地環（陶胎無釉底環）
    v.cyl(0, 0, 0, footR, 1, 6, wallThick);

    // 2. 圈足內底掏膛（足臍凹入，深1格）
    v.carve(0, 0, 0, Math.round((footR - wallThick) * 2), 1, Math.round((footR - wallThick) * 2));

    // 3. 圈足外壁（天目的釉掛不到圈足，整圈露胎）
    if (footH > 1) {
      v.cyl(0, 1, 0, footR + 0.2, footH - 1, 6, wallThick);
      v.cyl(0, footH - 1, 0, footR + 0.4, 1, 6, wallThick);
    }

    // 4. 圈足與腹部交界處的竹節收口線腳（釉流到這裡積成一圈厚的釉際）
    v.cyl(0, footH, 0, footR + 0.6, 1, 5, 1);

    // 5. 碗底厚胚實心底層（圈足頂部封閉胎底）
    v.cyl(0, footH, 0, footR, 1, 5);

    // 6. 碗心深處茶溜（碗底內凹微深之茶池）
    const teaWellR = Math.max(1.2, footR - wallThick * 1.2);
    v.cyl(0, footH + 1, 0, teaWellR, 1, 0);

    // 碗身弧曲面（從圈足向上展開的拋物線微弧輪廓）
    for (let dy = 0; dy <= bowlH; dy++) {
      const y = footH + dy;
      const t = dy / bowlH; // 0 (底部) 到 1 (碗口)
      const curR = footR + (rMax - footR) * Math.pow(t, 0.75);
      const curInR = Math.max(0, curR - wallThick);
      const rCeil = Math.ceil(curR);
      // 上一層的內半徑：比它小的格子頂面露在碗裡（碗口那層上面沒東西，整圈都露）
      const nextInR = dy < bowlH
        ? Math.max(0, footR + (rMax - footR) * Math.pow((dy + 1) / bowlH, 0.75) - wallThick) : Infinity;

      for (let x = -rCeil; x <= rCeil; x++) {
        for (let z = -rCeil; z <= rCeil; z++) {
          const d = Math.hypot(x, z);
          const isSolid = (dy <= 1 && d <= curR);
          const isWall = (d <= curR && d >= curInR);

          if (isSolid || isWall) {
            let finalC;
            if (d > curR - 1) {
              // 7. 碗外側黑褐釉：雜湊點出兩成五更黑的釉，看得出釉面的流痕
              finalC = hash(x, y, z) > 0.75 ? 0 : 5;
            } else if (dy === 0) {
              // 8. 碗底胎（從圈足裡往上看得到的那一面，露胎）
              finalC = 6;
            } else if (d < curInR + 1 || d < nextInR) {
              // 9. 碗內漆黑釉上的曜變斑（碗心與下半部比較密）
              const sc = spot(x, y, z);
              finalC = sc < 0 ? 0 : sc;
            } else {
              finalC = 6;            // 夾在壁厚中間、哪一面都看不到的是胎土（打破了看得到；也省掉一半的 spot）
            }

            v.set(x, y, z, finalC);
          }
        }
      }
    }

    // 11. 碗口厚唇口緣壓圈（天目的口沿釉薄，露出黑褐色）
    const rimY = footH + bowlH;
    v.cyl(0, rimY, 0, rMax, 1, 5, Math.max(1, Math.round(wallThick * 0.8)));

    // 12. 口沿瓷釉高光弧段：v1.263.0 拿掉（白點在口沿上看起來像一排缺口，不像反光）

    // 13. 碗內壁深處曜變光澤亮點微調
    ringOf(v, 6, footR + 0.5, (vv, x, z) => {
      tint(vv, Math.round(x), footH + 2, Math.round(z), 1);
    });

    // 14. 見込み正中一顆曜變斑：斑心＋十字藍光暈＋斜角一側青一側紫（300 塊時每個顏色也都還在）
    const cy = footH + 1;
    tint(v, 0, cy, 0, 4);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) tint(v, dx, cy, dz, 1);
    tint(v, 1, cy, 1, 2); tint(v, -1, cy, -1, 2);
    tint(v, 1, cy, -1, 3); tint(v, -1, cy, 1, 3);
  }
});