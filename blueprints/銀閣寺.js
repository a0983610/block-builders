/* 積木小人 · 匯出的藍圖（銀閣寺）
   用法二選一：放進 blueprints/ 並把檔名加進 list.js，
   或在遊戲裡按「📥 匯入建築」把整份貼進去。 */

// 檔名：銀閣寺.js
customBlueprint({
  name: '銀閣寺',
  pal: [
    '#3c2f25', // 0 二層潮音閣黑漆風化深木色
    '#e8e4dc', // 1 一層心空殿白漆障子紙（障子窗面）
    '#634c38', // 2 一層深色木柱、橫樑與緣側地板
    '#302721', // 3 杮葺深色木瓦屋頂（一層歇山、二層寶形造）
    '#b8d0d8', // 4 二層花頭窗採光白亮玻璃/障子面
    '#201c18', // 5 頂端青銅鳳凰與高欄金屬件
    '#8a7662'  // 6 錦鏡池畔石基座
  ],
  lo: 2.3, hi: 14.5,

  gen(v, s) {
    // 兩層尺寸規劃（銀閣寺為二層二階樓閣，沉穩素雅的東山文化代表）
    const w1 = dim(s, 2.0, 9, true);  // 一層 心空殿（書院造風）
    const d1 = dim(s, 1.8, 9, true);
    const h1 = dim(s, 0.7, 3);

    const w2 = dim(s, 1.4, 7, true);  // 二層 潮音閣（禪宗佛殿造）
    const d2 = dim(s, 1.25, 7, true);
    const h2 = dim(s, 0.65, 3);

    // 1. 池畔石台基與一層木造緣側（走廊）
    v.box(0, 0, 0, w1 + 3, 1, d1 + 3, 6); // 石基底座
    v.box(0, 1, 0, w1 + 2, 1, d1 + 2, 2); // 木緣側

    let curY = 2;

    // --- 第一層：心空殿（白障子紙壁 + 外顯深木柱）---
    v.walls(0, curY, 0, w1, h1, d1, 1, 1); // 白色障子牆

    // 外立面木立柱與橫木架構
    const halfW1 = Math.round((w1 - 1) / 2);
    const halfD1 = Math.round((d1 - 1) / 2);
    corners4(v, halfW1, halfD1, (vv, x, z) => vv.box(x, curY, z, 1, h1, 1, 2));
    mirrorX(v, halfW1, (vv, dx) => {
      vv.box(dx, curY, 0, 1, h1, 1, 2);
      vv.box(dx, curY + h1 - 1, 0, 1, 1, d1, 2);
    });
    mirrorZ(v, halfD1, (vv, dz) => {
      vv.box(0, curY, dz, 1, h1, 1, 2);
      vv.box(0, curY + h1 - 1, dz, w1, 1, 1, 2);
    });

    // 一層出簷大屋頂（寶形/歇山四坡柿葺頂）
    curY += h1;
    v.eave(0, curY, 0, w1 + 4, d1 + 4, 0, 1); // 簷下暗木構
    hipRoof(v, 0, curY + 1, 0, w1 + 5, d1 + 5, 3); // 四坡木瓦頂
    curY += 2;

    // --- 第二層：潮音閣（深黑木造外壁 + 迴廊高欄 + 花頭窗）---
    // 二層跳出之高欄緣側
    v.box(0, curY, 0, w2 + 2, 1, d2 + 2, 0);
    mirrorX(v, Math.round((w2 + 1) / 2), (vv, dx) => vv.box(dx, curY + 1, 0, 1, 1, d2 + 2, 5));
    mirrorZ(v, Math.round((d2 + 1) / 2), (vv, dz) => vv.box(0, curY + 1, dz, w2 + 2, 1, 1, 5));

    // 二層深黑木外壁
    v.walls(0, curY + 1, 0, w2, h2, d2, 0, 1);

    // 正面與側面的經典花頭窗（Katomado 拱形禪宗窗）
    const winW = dim(s, 0.16, 1);
    const winH = dim(s, 0.35, 2);
    const winCols = dim(s, 0.5, 3, true);
    const winStep = dim(s, 0.36, 2);

    mirrorZ(v, Math.round((d2 - 1) / 2), (vv, dz) => {
      windowGrid(vv, { x: 0, y: curY + 2, z: dz, cols: winCols, rows: 1, stepX: winStep, w: winW, h: winH, c: 4, axis: 'x' });
    });
    mirrorX(v, Math.round((w2 - 1) / 2), (vv, dx) => {
      windowGrid(vv, { x: dx, y: curY + 2, z: 0, cols: 2, rows: 1, stepX: winStep, w: winW, h: winH, c: 4, axis: 'z' });
    });

    // 二層寶形造大屋頂（四角起翹攢尖頂）
    curY += 1 + h2;
    v.eave(0, curY, 0, w2 + 3, d2 + 3, 0, 1); // 簷口出挑
    const pyrH = Math.max(2, Math.round((w2 + 4) / 2));
    v.pyramid(0, curY + 1, 0, w2 + 4, 3, 1); // 頂層錐形四坡頂

    // 屋頂寶頂與青銅鳳凰像
    const peakY = curY + 1 + pyrH;
    v.box(0, peakY, 0, 1, 1, 1, 5); // 露盤

    // 青銅鳳凰（向東佇立）
    const phoenixH = dim(s, 0.22, 2);
    v.box(0, peakY + 1, 0, 1, phoenixH, 1, 5);
    v.set(0, peakY + phoenixH, -1, 5); // 鳳首
    v.set(0, peakY + phoenixH, 1, 5);  // 尾翎
  }
});
