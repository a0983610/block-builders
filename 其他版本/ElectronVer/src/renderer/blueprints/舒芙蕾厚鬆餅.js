/* 積木小人 · 匯出的藍圖（舒芙蕾厚鬆餅）
   用法二選一：放進 blueprints/ 並把檔名加進 list.js，
   或在遊戲裡按「📥 匯入建築」把整份貼進去。 */

// 檔名：舒芙蕾厚鬆餅.js
// v1.263.0：只調色（格子一格都沒動）：鬆餅上下兩面都是金褐烤面、側面淡黃配固定雜湊的深淺，白瓷盤改灰白配盤緣陰影（見 開發筆記〈自訂藍圖調整一輪（v1.263.0）〉）
customBlueprint({
  name: '舒芙蕾厚鬆餅',
  pal: [
    '#e2dfd8', // 0 白瓷圓盤（帶一點暖的灰白，原本 #f5f5f7 在遊戲光照下近乎全白）
    '#efd28a', // 1 舒芙蕾鬆餅側面（淡黃，原本 #ffecb3 太淡）
    '#cf8f4a', // 2 鬆餅上下兩面煎烤金褐色
    '#8d4925', // 3 楓糖糖漿（深琥珀色）
    '#fff9c4', // 4 頂部融化奶油方塊
    '#ffffff', // 5 盤邊糖粉 / 擠花鮮奶油
    '#e53935', // 6 新鮮草莓切片
    '#43a047', // 7 薄荷葉
    '#a9a59c', // 8 盤緣側面的陰影（盤子底下那一圈）
    '#e2bf72'  // 9 鬆餅側面深一階（固定雜湊）
  ],
  lo: 2.2, hi: 16.5,

  gen(v, s) {
    // 固定雜湊（座標的純函式，同一個 s 每次一樣）：0～99
    const hash = (x, y, z) => {
      let h = Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791);
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return ((h ^ (h >>> 16)) >>> 0) % 100;
    };

    // 1. 白瓷圓盤底座
    const plateR = dim(s, 2.1, 8);
    v.cyl(0, 0, 0, plateR, 1, 0);                 // 盤底
    v.cyl(0, 0, 0, plateR, 1, 8, 1);             // 盤底最外一圈換陰影色（上一行實心盤的子集，只換色、不多蓋格子）
    v.cyl(0, 1, 0, plateR, 1, 0, 1);             // 盤邊翹起一圈（中空環）

    // 2. 雙層疊放的厚舒芙蕾鬆餅
    const cakeR = dim(s, 1.05, 4);               // 鬆餅半徑
    const cakeH = dim(s, 0.65, 2);               // 單層鬆餅厚度

    // 側面最外一圈照固定雜湊挑深一階（只換已經有的格子；半徑照 cyl 的算法）
    const sideShade = (y0, z0) => {
      const n = Math.ceil(cakeR);
      for (let y = y0; y < y0 + cakeH; y++)
        for (let i = -n; i <= n; i++) for (let k = -n; k <= n; k++) {
          const d = Math.hypot(i, k);
          if (d > cakeR + 0.35 || d < cakeR - 1) continue;
          if (hash(i, y, z0 + k) < 30) tint(v, i, y, z0 + k, 9);
        }
    };

    // 第一層鬆餅（下層）
    v.cyl(0, 1, 0, cakeR, cakeH, 1);             // 側面鬆軟淡黃
    sideShade(1, 0);
    v.cyl(0, 1 + cakeH - 1, 0, cakeR, 1, 2);     // 頂面煎烤金黃
    // 底面也是煎烤面：同一個實心圓柱的最底一層換色（子集，只換色）。
    // 厚度只有 2 層時不換，不然側面的淡黃整片沒了（300 塊那檔就是 2 層）
    if (cakeH >= 3) v.cyl(0, 1, 0, cakeR, 1, 2);

    // 第二層鬆餅（上層，微向側後方偏移疊放）
    const topCakeY = 1 + cakeH;
    const offsetZ = Math.max(1, Math.round(s * 0.15));
    v.cyl(0, topCakeY, offsetZ, cakeR, cakeH, 1);
    sideShade(topCakeY, offsetZ);
    v.cyl(0, topCakeY + cakeH - 1, offsetZ, cakeR, 1, 2);
    if (cakeH >= 3) v.cyl(0, topCakeY, offsetZ, cakeR, 1, 2);   // 上層的底面（同上，只換色）

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
