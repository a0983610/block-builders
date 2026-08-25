/* 積木小人 · 匯出的藍圖（日式醬油糰子）
   用法二選一：放進 blueprints/ 並把檔名加進 list.js，
   或在遊戲裡按「📥 匯入建築」把整份貼進去。 */

// 檔名：日式醬油糰子.js
customBlueprint({
  name: '日式醬油糰子',
  pal: [
    '#f8f9fa', // 0 白瓷方盤（右側主體）
    '#2b2d30', // 1 黑陶盤邊（左側跳色）
    '#c87a28', // 2 醬油葛汁裹色（亮金琥珀）
    '#5c2206', // 3 炙燒焦香斑紋 / 盤底濃醬汁
    '#d6b882', // 4 竹籤
    '#fffae8'  // 5 醬汁高光反光點
  ],
  lo: 2.6, hi: 18.0,

  gen(v, s) {
    // 1. 和風雙色方盤（左黑右白、四邊微翹）
    const pw = dim(s, 3.8, 15, true);
    const pd = dim(s, 2.8, 11, true);
    const splitX = -Math.round(pw * 0.22); // 黑白分界位置

    // 盤底實心
    v.box(0, 0, 0, pw, 1, pd, 0);
    v.box(-Math.round(pw / 2) + Math.round((splitX - (-Math.round(pw / 2))) / 2), 0, 0,
          splitX - (-Math.round(pw / 2)) + 1, 1, pd, 1);

    // 盤緣一圈微翹圍邊
    v.walls(0, 1, 0, pw, 1, pd, 0, 1);
    v.box(-Math.round(pw / 2) + Math.round((splitX - (-Math.round(pw / 2))) / 2), 1, 0,
          splitX - (-Math.round(pw / 2)) + 1, 1, pd, 1);
    v.carve(0, 1, 0, pw - 2, 1, pd - 2); // 保持內部平坦

    // 2. 兩串醬油糰子（每串 4 顆、淋上濃郁醬汁）
    const br = s * 0.26;                               // 糰子半徑
    const stepX = br * 1.72;                           // 橫向排開（左到右 4 顆）
    const stickLen = Math.round(br * 9.2);             // 竹籤長度

    const skewers = [
      { z: -Math.round(s * 0.32), x0: -Math.round(br * 2.6) }, // 後排串
      { z:  Math.round(s * 0.28), x0: -Math.round(br * 3.2) }  // 前排串
    ];

    skewers.forEach(({ z, x0 }, skewerIdx) => {
      const by = 1 + Math.round(br * 0.95);

      // 竹籤本體（穿過 4 顆糰子並向右延伸握柄）
      v.box(x0 + Math.round(br * 3.6), by, z, stickLen, 1, 1, 4);

      // 盤底溢流的焦糖濃醬汁（前排較多）
      if (skewerIdx === 1) {
        v.box(x0 + Math.round(br * 2.2), 1, z + Math.round(br * 0.6), Math.round(br * 5.2), 1, Math.round(br * 1.8), 3);
      }

      // 連續 4 顆飽滿的琥珀醬油糰子
      for (let i = 0; i < 4; i++) {
        const cx = x0 + Math.round(i * stepX);

        // 糰子主體（有機球體，外層均勻裹上琥珀金醬油葛汁）
        blob(v, cx, by, z, br * 0.96, br * 0.88, br * 0.92, 2);

        // 表面炙燒焦點（頂部焦痕）
        paintFrom(v, cx, by + Math.ceil(br) + 1, z, 0, -1, 0, 3, 3);
        paintFrom(v, cx + 1, by + Math.ceil(br) + 1, z, 0, -1, 0, 3, 3);

        // 醬汁高光反光點（斜上方微光澤）
        paintFrom(v, cx - 1, by + Math.ceil(br * 0.6), z - Math.ceil(br * 0.6), 0, -1, 1, 3, 5);
      }
    });
  }
});
