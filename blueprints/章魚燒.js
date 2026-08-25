/* 積木小人 · 匯出的藍圖（章魚燒）
   用法二選一：放進 blueprints/ 並把檔名加進 list.js，
   或在遊戲裡按「📥 匯入建築」把整份貼進去。 */

// 檔名：章魚燒.js
customBlueprint({
  name: '章魚燒',
  pal: [
    '#e2d7c5', // 0 木舟船皿（淺木紋紙盤）
    '#d9822b', // 1 麵糊金黃外皮（章魚燒本體）
    '#3a1d11', // 2 濃厚章魚燒醬（深褐醬汁）
    '#fffce0', // 3 美乃滋（乳白細條紋）
    '#345c27', // 4 海苔粉（翠綠點綴）
    '#b88a5d', // 5 柴魚片（輕薄木質薄片）
    '#d6b28d', // 6 牙籤 / 竹籤（原木色）
    '#a8383b'  // 7 章魚塊切丁紅皮（內餡微微露出）
  ],
  lo: 2.5, hi: 18,

  gen(v, s) {
    // === 1. 木舟船皿（長橢圓形木盤底座） ===
    const pw = s * 0.95;  // 船皿半寬 (X 軸)
    const pd = s * 1.55;  // 船皿半深 (Z 軸)
    const ph = Math.max(1.2, s * 0.18); // 船皿深度

    // 船皿外殼
    blob(v, 0, ph, 0, pw + 0.5, ph + 0.6, pd + 0.5, 0, true);
    // 船皿內凹實心托底
    v.box(0, 0, 0, Math.round(pw * 1.4), 1, Math.round(pd * 1.4), 0);

    // === 2. 經典 2x3 六顆章魚燒丸子 ===
    const br = s * 0.38; // 章魚燒半徑（不取整以保持平滑與連續尺寸）
    const spacingX = br * 1.65;
    const spacingZ = br * 1.75;
    const ballY = ph + br * 0.72;

    const zOffsets = [-spacingZ, 0, spacingZ];
    const xOffsets = [-spacingX * 0.5, spacingX * 0.5];

    for (let zi = 0; zi < zOffsets.length; zi++) {
      for (let xi = 0; xi < xOffsets.length; xi++) {
        const bx = xOffsets[xi];
        const bz = zOffsets[zi];

        // 圓滾金黃丸子本體
        blob(v, bx, ballY, bz, br, br * 0.94, br, 1);

        // 頂部濃厚醬汁塗層 (pal[2])
        blob(v, bx, ballY + br * 0.28, bz, br * 0.88, br * 0.68, br * 0.88, 2);

        // 美乃滋拉線 (pal[3])
        v.line(
          Math.round(bx - br * 0.6), Math.round(ballY + br * 0.75), Math.round(bz - br * 0.4),
          Math.round(bx + br * 0.6), Math.round(ballY + br * 0.75), Math.round(bz + br * 0.4),
          3
        );
        v.line(
          Math.round(bx - br * 0.5), Math.round(ballY + br * 0.78), Math.round(bz + br * 0.3),
          Math.round(bx + br * 0.5), Math.round(ballY + br * 0.78), Math.round(bz - br * 0.3),
          3
        );

        // 青海苔粉散落點綴 (pal[4])
        paintFrom(v, Math.round(bx - br * 0.2), Math.round(ballY + br * 1.1), Math.round(bz + br * 0.15), 0, -1, 0, 4, 4);
        paintFrom(v, Math.round(bx + br * 0.25), Math.round(ballY + br * 1.1), Math.round(bz - br * 0.2), 0, -1, 0, 4, 4);

        // 輕薄柴魚片翹起層 (pal[5])
        const fkY = Math.round(ballY + br * 0.85);
        v.box(Math.round(bx - br * 0.1), fkY, Math.round(bz - br * 0.1), dim(s, 0.15, 1), 1, dim(s, 0.25, 2), 5);
        v.box(Math.round(bx + br * 0.15), fkY + 1, Math.round(bz + br * 0.05), dim(s, 0.22, 2), 1, dim(s, 0.15, 1), 5);
      }
    }

    // === 3. 內餡小彩蛋：邊緣微露的鮮紅章魚切丁 (pal[7]) ===
    const tX = xOffsets[0] - br * 0.55;
    const tZ = zOffsets[1];
    tint(v, Math.round(tX), Math.round(ballY - br * 0.2), Math.round(tZ), 7);
    tint(v, Math.round(tX), Math.round(ballY - br * 0.1), Math.round(tZ), 7);

    // === 4. 斜插的雙竹籤 (pal[6]) ===
    const pLen = dim(s, 0.9, 4);
    const startX = xOffsets[1] + br * 0.2;
    const startZ = zOffsets[2] + br * 0.2;
    const startY = ballY + br * 0.4;
    // 籤 1
    v.line(
      Math.round(startX), Math.round(startY), Math.round(startZ),
      Math.round(startX + pLen * 0.55), Math.round(startY + pLen * 1.1), Math.round(startZ + pLen * 0.4),
      6
    );
    // 籤 2
    v.line(
      Math.round(startX - 1), Math.round(startY), Math.round(startZ + 1),
      Math.round(startX + pLen * 0.5), Math.round(startY + pLen * 1.15), Math.round(startZ + pLen * 0.5),
      6
    );
  }
});
