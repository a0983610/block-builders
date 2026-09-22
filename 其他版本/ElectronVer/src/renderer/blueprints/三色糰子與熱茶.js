/* 積木小人 · 匯出的藍圖（三色糰子與熱茶）
   用法二選一：放進 blueprints/ 並把檔名加進 list.js，
   或在遊戲裡按「📥 匯入建築」把整份貼進去。 */

// 檔名：三色糰子與熱茶.js
customBlueprint({
  name: '三色糰子與熱茶',
  pal: [
    '#f48fb1', // 0 櫻粉糰子
    '#fdfbf7', // 1 白玉糰子
    '#689f38', // 2 艾草綠糰子
    '#d7b377', // 3 竹籤
    '#faf7f0', // 4 懷石墊紙
    '#bcaaa4', // 5 陶杯外壁
    '#795548', // 6 陶杯口沿 / 陰影
    '#8d6e63', // 7 烘焙茶湯
    '#5c3d2e'  // 8 木質托盤底座
  ],
  lo: 2.8, hi: 18.0,

  gen(v, s) {
    // 1. 木質托盤底座與白和紙墊
    const pw = dim(s, 3.4, 13, true);
    const pd = dim(s, 2.6, 11, true);
    v.box(0, 0, 0, pw + 2, 1, pd + 2, 8); // 木托盤
    v.box(2, 1, 1, dim(s, 2.2, 9, true), 1, dim(s, 1.8, 7, true), 4); // 盛放糰子的和紙

    // 2. 左上方熱茶陶杯
    const cr = dim(s, 0.46, 2);
    const ch = dim(s, 1.25, 4);
    const cx = -Math.round(pw * 0.28);
    const cz = -Math.round(pd * 0.24);

    v.cyl(cx, 1, cz, cr, ch, 5, 1);                    // 陶杯身（中空）
    v.cyl(cx, 1 + ch, cz, cr, 1, 6, 1);                // 杯口燒色深緣
    v.cyl(cx, 1 + Math.max(1, ch - 2), cz, cr - 1, 1, 7); // 茶湯表面

    // 3. 兩串三色糰子（粉、白、綠）
    const br = s * 0.28;                               // 糰子半徑（浮點數讓縮放平滑連續）
    const stepZ = br * 1.85;                           // 糰子球心間距
    const stickLen = Math.round(br * 6.8);             // 竹籤總長

    // 兩串竹籤在紙上的排列位置
    const skewers = [
      { x: Math.round(s * 0.05),  z0: Math.round(s * 0.05) },
      { x: Math.round(s * 0.65),  z0: Math.round(s * 0.35) }
    ];

    skewers.forEach(({ x, z0 }) => {
      const by = 1 + Math.round(br);

      // 竹籤本體（穿過三顆糰子並在前方突出握柄）
      v.box(x, by, z0, 1, 1, stickLen, 3);

      // 三顆飽滿糰子：櫻粉（後）、白玉（中）、艾草綠（前）
      blob(v, x, by, z0 - stepZ, br, br * 0.95, br, 0); // 粉色
      blob(v, x, by, z0,         br, br * 0.95, br, 1); // 白色
      blob(v, x, by, z0 + stepZ, br, br * 0.95, br, 2); // 綠色
    });
  }
});
