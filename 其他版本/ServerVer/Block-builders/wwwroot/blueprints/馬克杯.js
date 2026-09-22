/* 積木小人 · 匯出的藍圖（經典馬克杯）
   用法二選一：放進 blueprints/ 並把檔名加進 list.js，
   或在遊戲裡按「📥 匯入建築」把整份貼進去。 */

// 檔名：馬克杯.js
customBlueprint({
  name: '經典馬克杯',
  pal: [
    '#edeae1', // 0 陶瓷杯身（米白）
    '#2d5a7b', // 1 裝飾腰線（深藍）
    '#cfcac0'  // 2 底座杯托（淺灰石色）
  ],
  lo: 2.2, hi: 14.0,

  gen(v, s) {
    const r = dim(s, 0.72, 3);                   // 杯身外半徑
    const h = dim(s, 1.85, 7);                   // 杯身高
    const saucerR = r + dim(s, 0.35, 2);          // 杯托半徑

    // 1. 底層杯托（最底層）
    v.cyl(0, 0, 0, saucerR, 1, 2);

    // 2. 杯底實心底板（杯子內部底部）
    v.cyl(0, 1, 0, r, 1, 0);

    // 3. 杯身主體（中空圓柱，內部完全掏空）
    v.cyl(0, 2, 0, r, h, 0, 1);

    // 4. 杯口微收邊
    v.cyl(0, 2 + h, 0, r, 1, 0, 1);

    // 5. 杯身裝飾腰線（使用 tint 替換杯壁外側顏色）
    const bandY = 2 + Math.round(h * 0.35);
    const bandH = Math.max(1, Math.round(h * 0.22));
    for (let dy = 0; dy < bandH; dy++) {
      const cy = bandY + dy;
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          const dist = Math.hypot(dx, dz);
          if (dist >= r - 0.7 && dist <= r + 0.6) {
            tint(v, dx, cy, dz, 1);
          }
        }
      }
    }

    // 6. 立體圓弧厚杯把（+X 側）
    const hr = Math.max(2, Math.round(h * 0.28));    // 把手上下半徑
    const hy = 2 + Math.round(h * 0.48);             // 把手中心高度
    const ht = Math.max(1, Math.round(s * 0.14));    // 把手厚度
    const reach = Math.max(3, Math.round(r * 0.65)); // 突出寬度

    const xInner = r - 1;
    const xOuter = r + reach;
    const xMid = Math.round((xInner + xOuter) / 2);

    // 上橫臂、下橫臂（緊貼杯壁）
    v.box(xMid, hy + hr, 0, reach + 2, ht, ht + 1, 0);
    v.box(xMid, hy - hr, 0, reach + 2, ht, ht + 1, 0);

    // 外立柱
    v.box(xOuter, hy, 0, ht, hr * 2 + 1, ht + 1, 0);

    // 斜角轉角修飾（讓把手更圓滑自然）
    if (reach >= 4 && hr >= 3) {
      v.box(xOuter - 1, hy + hr - 1, 0, 1, 1, ht + 1, 0);
      v.box(xOuter - 1, hy - hr + 1, 0, 1, 1, ht + 1, 0);
    }
  }
});
