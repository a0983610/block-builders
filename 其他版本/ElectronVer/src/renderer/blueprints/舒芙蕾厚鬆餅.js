/* 積木小人 · 匯出的藍圖（舒芙蕾厚鬆餅）
   用法二選一：放進 blueprints/ 並把檔名加進 list.js，
   或在遊戲裡按「📥 匯入建築」把整份貼進去。 */

// 檔名：舒芙蕾厚鬆餅.js
customBlueprint({
  name: '舒芙蕾厚鬆餅',
  pal: [
    '#f5f5f7', // 0 白瓷圓盤
    '#ffecb3', // 1 舒芙蕾鬆餅側面（鬆軟金黃）
    '#d79a5b', // 2 鬆餅表面煎烤金黃焦色
    '#8d4925', // 3 楓糖糖漿（深琥珀色）
    '#fff9c4', // 4 頂部融化奶油方塊
    '#ffffff', // 5 盤邊糖粉 / 擠花鮮奶油
    '#e53935', // 6 新鮮草莓切片
    '#43a047'  // 7 薄荷葉
  ],
  lo: 2.2, hi: 16.5,

  gen(v, s) {
    // 1. 白瓷圓盤底座
    const plateR = dim(s, 2.1, 8);
    v.cyl(0, 0, 0, plateR, 1, 0);                 // 盤底
    v.cyl(0, 1, 0, plateR, 1, 0, 1);             // 盤邊翹起一圈（中空環）

    // 2. 雙層疊放的厚舒芙蕾鬆餅
    const cakeR = dim(s, 1.05, 4);               // 鬆餅半徑
    const cakeH = dim(s, 0.65, 2);               // 單層鬆餅厚度

    // 第一層鬆餅（下層）
    v.cyl(0, 1, 0, cakeR, cakeH, 1);             // 側面鬆軟金黃
    v.cyl(0, 1 + cakeH - 1, 0, cakeR, 1, 2);     // 頂面煎烤金黃

    // 第二層鬆餅（上層，微向側後方偏移疊放）
    const topCakeY = 1 + cakeH;
    const offsetZ = Math.max(1, Math.round(s * 0.15));
    v.cyl(0, topCakeY, offsetZ, cakeR, cakeH, 1);
    v.cyl(0, topCakeY + cakeH - 1, offsetZ, cakeR, 1, 2);

    // 3. 頂部流淌的濃稠楓糖漿（從頂部向下滴落）
    const syrupY = topCakeY + cakeH;
    const syrupR = Math.max(2, Math.round(cakeR * 0.7));
    v.cyl(0, syrupY, offsetZ, syrupR, 1, 3);

    // 楓糖漿順著鬆餅邊緣自然垂流
    mirrorX(v, cakeR, (vv, dx) => {
      paintFrom(vv, dx, topCakeY + 1, offsetZ, -1, 0, 0, 2, 3);
      paintFrom(vv, dx - 1, 1 + cakeH, offsetZ, -1, 0, 0, 2, 3);
    });
    mirrorZ(v, cakeR, (vv, dz) => {
      paintFrom(vv, 0, topCakeY + 1, offsetZ + dz, 0, 0, -1, 2, 3);
    });

    // 4. 頂部正中央微融化的香濃奶油方塊
    const butterSize = Math.max(2, Math.round(s * 0.22));
    v.box(0, syrupY + 1, offsetZ, butterSize, 1, butterSize, 4);

    // 5. 盤邊點綴：鮮奶油球、新鮮草莓切片與薄荷葉
    const sideX = Math.round(plateR * 0.55);
    const sideZ = -Math.round(plateR * 0.45);

    // 擠花鮮奶油
    const creamR = Math.max(1, s * 0.22);
    blob(v, sideX, 1 + Math.round(creamR * 0.8), sideZ, creamR, creamR * 0.9, creamR, 5);

    // 新鮮紅草莓切片
    const berryR = Math.max(1, s * 0.18);
    blob(v, sideX + Math.round(creamR * 0.8), 1 + Math.round(berryR * 0.8), sideZ + 1, berryR, berryR, berryR * 0.8, 6);

    // 鮮綠薄荷葉
    v.set(sideX, 2 + Math.round(creamR * 1.5), sideZ, 7);
  }
});
