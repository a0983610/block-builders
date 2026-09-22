/* 積木小人 · 匯出的藍圖（極地雪夜極光）
   用法二選一：放進 blueprints/ 並把檔名加進 list.js，
   或在遊戲裡按「📥 匯入建築」把整份貼進去。 */

// 檔名：極地雪夜極光.js
customBlueprint({
  name: '極地雪夜極光',
  pal: [
    '#eef4f8', // 0 極地厚積雪地
    '#2d3748', // 1 針葉樹幹 / 夜空深色岩石
    '#1a3636', // 2 覆雪針葉松樹冠
    '#5c3d2e', // 3 觀景小木屋原木壁
    '#ffe082', // 4 小木屋溫暖透光窗戶
    '#69f0ae', // 5 亮翡翠綠極光（主要光幕帶）
    '#00e676', // 6 鮮明霓虹綠極光（光幕中層）
    '#b388ff', // 7 夢幻紫粉極光（光幕頂部逸散）
    '#ffffff'  // 8 夜空繁星 / 屋頂白雪
  ],
  lo: 2.4, hi: 17.5,

  gen(v, s) {
    const groundW = dim(s, 3.6, 15, true);
    const groundD = dim(s, 2.8, 11, true);

    // 1. 極地雪原地基（微起伏厚雪）
    v.box(0, 0, 0, groundW, 1, groundD, 0);
    // 雪坡層次
    v.box(-Math.round(groundW * 0.25), 1, Math.round(groundD * 0.15),
          Math.round(groundW * 0.45), 1, Math.round(groundD * 0.4), 0);

    // 2. 溫馨觀景小木屋（帶暖光窗戶與積雪屋頂）
    const cabinW = dim(s, 0.9, 4, true);
    const cabinD = dim(s, 0.9, 4, true);
    const cabinH = dim(s, 0.8, 3);
    const cabinX = -Math.round(groundW * 0.26);
    const cabinZ = Math.round(groundD * 0.2);

    // 木屋實體牆壁
    v.walls(cabinX, 1, cabinZ, cabinW, cabinH, cabinD, 3, 1);
    v.box(cabinX, 1, cabinZ, cabinW, 1, cabinD, 3); // 地板
    // 溫暖燈光窗（正面與側面）
    v.set(cabinX, 2, cabinZ + Math.round(cabinD / 2), 4);
    v.set(cabinX + Math.round(cabinW / 2), 2, cabinZ, 4);
    // 覆雪山牆屋頂
    v.gable(cabinX, 1 + cabinH, cabinZ, cabinW + 2, cabinD + 2, 8);

    // 3. 極地針葉松樹群（兩棵錯落點綴）
    const trees = [
      { x: Math.round(groundW * 0.3),  z: Math.round(groundD * 0.22),  h: dim(s, 1.4, 5) },
      { x: Math.round(groundW * 0.38), z: -Math.round(groundD * 0.1),   h: dim(s, 1.1, 4) }
    ];

    trees.forEach(({ x, z, h }) => {
      v.box(x, 1, z, 1, h, 1, 1); // 樹幹
      // 寶塔狀松樹樹冠
      const tiers = 3;
      for (let t = 0; t < tiers; t++) {
        const ty = 2 + t * Math.max(1, Math.round(h * 0.28));
        const tr = Math.max(1, Math.round((tiers - t) * 0.7));
        v.pyramid(x, ty, z, tr * 2 + 1, 2, 1);
        v.set(x, ty + 1, z, 8); // 樹梢落雪
      }
    });

    // 4. 夜空繁星點點（懸空微星光）
    const stars = [
      { x: -Math.round(groundW * 0.35), y: dim(s, 3.2, 11), z: -Math.round(groundD * 0.2) },
      { x: 0,                           y: dim(s, 3.6, 13), z: -Math.round(groundD * 0.35) },
      { x: Math.round(groundW * 0.32),  y: dim(s, 3.4, 12), z: -Math.round(groundD * 0.25) }
    ];
    stars.forEach(st => v.set(st.x, st.y, st.z, 8));

    // 5. 飄逸舞動的 S 型極光帷幕（Aurora Curtain）
    const curtainLen = Math.round(groundW * 1.1);
    const curtainBaseY = dim(s, 1.6, 6);
    const curtainH = dim(s, 2.2, 8);

    for (let i = -Math.floor(curtainLen / 2); i <= Math.floor(curtainLen / 2); i++) {
      const u = i / (curtainLen / 2);
      // 正弦 S 型流線波浪
      const waveZ = Math.round(Math.sin(u * Math.PI * 1.6) * (groundD * 0.32)) - Math.round(groundD * 0.1);
      const waveH = curtainH + Math.round(Math.cos(u * Math.PI * 2) * 1.5);

      // 極光垂直光柱（底部亮綠 -> 中部鮮綠 -> 頂部紫粉逸散）
      for (let dy = 0; dy < waveH; dy++) {
        const curY = curtainBaseY + dy;
        let auroraColor = 5; // 亮翡翠綠

        if (dy > Math.round(waveH * 0.68)) {
          auroraColor = 7;   // 夢幻紫粉
        } else if (dy > Math.round(waveH * 0.35)) {
          auroraColor = 6;   // 霓虹鮮綠
        }

        v.set(i, curY, waveZ, auroraColor);
        // 主光帶略帶 1 格厚度透光感
        if (Math.abs(i) % 2 === 0) {
          v.set(i, curY, waveZ + 1, auroraColor);
        }
      }
    }
  }
});
