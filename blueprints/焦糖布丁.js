/* 積木小人 · 匯出的藍圖（焦糖布丁）
   用法二選一：放進 blueprints/ 並把檔名加進 list.js，
   或在遊戲裡按「📥 匯入建築」把整份貼進去。 */

// 檔名：焦糖布丁.js
// v1.263.0：只調色（格子一格都沒動）：布丁改成蛋黃色卡士達、下深上淺，側面多幾道焦糖垂流，白瓷盤改灰白配盤緣陰影（見 開發筆記〈自訂藍圖調整一輪（v1.263.0）〉）
customBlueprint({
  name: '焦糖布丁',
  pal: [
    '#e2dfd8', // 0 白瓷圓盤（帶一點暖的灰白，原本 #f5f5f7 在遊戲光照下近乎全白）
    '#f4bd48', // 1 雞蛋布丁本體（蛋黃色卡士達，原本 #fff0a6 太淡；色相偏橘一點，背光面才不會發綠）
    '#4a1c09', // 2 頂部深色焦糖凍
    '#7d3411', // 3 盤底流淌焦糖醬汁、布丁側面的焦糖垂流
    '#ffffff', // 4 擠花鮮奶油
    '#d32f2f', // 5 糖漬紅櫻桃
    '#2e7d32', // 6 櫻桃梗 / 薄荷葉
    '#e0a03a', // 7 卡士達深一階（固定雜湊，越靠盤底越多）
    '#a9a59c'  // 8 盤緣側面的陰影（盤子底下那一圈）
  ],
  lo: 2.2, hi: 16.0,

  gen(v, s) {
    // 固定雜湊（座標的純函式，同一個 s 每次一樣）：0～99
    const hash = (x, y, z) => {
      let h = Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791);
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return ((h ^ (h >>> 16)) >>> 0) % 100;
    };

    // 1. 白瓷圓盤底座（圓形厚盤與微翹盤緣）
    const plateR = dim(s, 1.8, 7);
    v.cyl(0, 0, 0, plateR, 1, 0);                 // 盤底實心
    v.cyl(0, 0, 0, plateR, 1, 8, 1);             // 盤底最外一圈換陰影色（上一行實心盤的子集，只換色、不多蓋格子）
    v.cyl(0, 1, 0, plateR, 1, 0, 1);             // 盤外圈邊緣（中空環）

    // 2. 盤底流淌的深琥珀色焦糖糖漿
    const sauceR = Math.max(3, Math.round(plateR * 0.72));
    v.cyl(0, 1, 0, sauceR, 1, 3);

    // 3. 經典梯形布丁本體（由底向上收窄）
    const btmR = dim(s, 0.95, 4);                // 布丁底部半徑
    const topR = dim(s, 0.65, 3);                // 布丁頂部半徑
    const puddingH = dim(s, 1.1, 4);             // 布丁高度
    v.taper(0, 1, 0, btmR, topR, puddingH, 1);
    // 布丁表面最外一圈照固定雜湊挑深一階：盤底那層 55%、頂端 20%（卡士達越往下顏色越深）。
    // 半徑照 taper 的算法逐層重算，只換已經有的格子
    for (let y = 1; y <= puddingH; y++) {
      const t = puddingH > 1 ? (y - 1) / (puddingH - 1) : 0;
      const r = btmR + (topR - btmR) * t, n = Math.ceil(r);
      const deep = Math.round(55 - 35 * t);
      for (let i = -n; i <= n; i++) for (let k = -n; k <= n; k++) {
        const d = Math.hypot(i, k);
        if (d > r + 0.35 || d < r - 1) continue;
        if (hash(i, y, k) < deep) tint(v, i, y, k, 7);
      }
    }

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
    // 再加一圈長短不一的琥珀色垂流：每一道沿著放射方向從外往裡找第一格實心的上色（只換色）
    const nDrip = Math.max(6, Math.round(topR * 1.6));
    const dripMax = Math.max(2, Math.round(puddingH * 0.55));
    for (let j = 0; j < nDrip; j++) {
      const a = (j + 0.5) / nDrip * Math.PI * 2;
      const len = 1 + hash(j, 7, 3) % dripMax;
      for (let y = puddingH; y > puddingH - len && y >= 1; y--) {
        const t = puddingH > 1 ? (y - 1) / (puddingH - 1) : 0;
        const r = btmR + (topR - btmR) * t;
        for (let q = Math.ceil(r) + 1; q >= 0; q--)
          if (tint(v, Math.round(Math.cos(a) * q), y, Math.round(Math.sin(a) * q), 3)) break;
      }
    }

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
