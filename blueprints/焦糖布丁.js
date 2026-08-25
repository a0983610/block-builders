/* 積木小人 · 匯出的藍圖（焦糖布丁）
   用法二選一：放進 blueprints/ 並把檔名加進 list.js，
   或在遊戲裡按「📥 匯入建築」把整份貼進去。 */

// 檔名：焦糖布丁.js
customBlueprint({
  name: '焦糖布丁',
  pal: [
    '#f5f5f7', // 0 白瓷圓盤
    '#fff0a6', // 1 雞蛋布丁本體（鵝黃/嫩黃）
    '#4a1c09', // 2 頂部深色焦糖凍
    '#7d3411', // 3 盤底流淌焦糖醬汁
    '#ffffff', // 4 擠花鮮奶油
    '#d32f2f', // 5 糖漬紅櫻桃
    '#2e7d32'  // 6 櫻桃梗 / 薄荷葉
  ],
  lo: 2.2, hi: 16.0,

  gen(v, s) {
    // 1. 白瓷圓盤底座（圓形厚盤與微翹盤緣）
    const plateR = dim(s, 1.8, 7);
    v.cyl(0, 0, 0, plateR, 1, 0);                 // 盤底實心
    v.cyl(0, 1, 0, plateR, 1, 0, 1);             // 盤外圈邊緣（中空環）

    // 2. 盤底流淌的深琥珀色焦糖糖漿
    const sauceR = Math.max(3, Math.round(plateR * 0.72));
    v.cyl(0, 1, 0, sauceR, 1, 3);

    // 3. 經典梯形布丁本體（由底向上收窄）
    const btmR = dim(s, 0.95, 4);                // 布丁底部半徑
    const topR = dim(s, 0.65, 3);                // 布丁頂部半徑
    const puddingH = dim(s, 1.1, 4);             // 布丁高度
    v.taper(0, 1, 0, btmR, topR, puddingH, 1);

    // 4. 布丁頂部焦糖層（深褐色圓頂片與周圍微垂流醬汁）
    const topY = 1 + puddingH;
    v.cyl(0, topY, 0, topR, 1, 2);
    // 焦糖邊緣自然垂流
    mirrorX(v, topR, (vv, dx) => {
      paintFrom(vv, dx, topY - 1, 0, -1, 0, 0, 2, 2);
    });
    mirrorZ(v, topR, (vv, dz) => {
      paintFrom(vv, 0, topY - 1, dz, 0, 0, -1, 2, 2);
    });

    // 5. 頂部裝飾：擠花鮮奶油（雲朵球體）
    const creamY = topY + 1;
    const creamR = Math.max(1, s * 0.22);
    blob(v, 0, creamY, 0, creamR, creamR * 0.85, creamR, 4);

    // 6. 點睛之筆：糖漬紅櫻桃與櫻桃綠梗
    const cherryY = creamY + Math.max(1, Math.round(creamR * 0.8));
    const cherryR = Math.max(0.8, s * 0.16);
    blob(v, 0, cherryY, 0, cherryR, cherryR, cherryR, 5);

    // 櫻桃綠梗（斜向拉出）
    const stemH = Math.max(2, Math.round(s * 0.25));
    v.line(0, cherryY + 1, 0, 1, cherryY + stemH, 1, 6);
  }
});
