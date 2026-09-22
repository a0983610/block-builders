/* 積木小人 · 匯出的藍圖（特製叉燒拉麵）
   用法二選一：放進 blueprints/ 並把檔名加進 list.js，
   或在遊戲裡按「📥 匯入建築」把整份貼進去。 */

// 檔名：特製叉燒拉麵.js
customBlueprint({
  name: '特製叉燒拉麵',
  pal: [
    '#f6f4ed', // 0 陶瓷碗身（白瓷）
    '#c82b2b', // 1 碗緣紅圈與碗身書法字紅印
    '#b88438', // 2 金黃清透醬油高湯
    '#e2b744', // 3 捲曲黃拉麵條
    '#8d5732', // 4 炙燒叉燒厚肉片（滷肉深褐色）
    '#e58226', // 5 半熟流心糖心蛋黃
    '#1d241d', // 6 黑色大片烤海苔／碗口書法字
    '#88b358', // 7 翠綠青蔥花／菠菜綠葉
    '#c49a5b'  // 8 醬漬筍乾（竹筍條）
  ],
  lo: 2.2, hi: 14.5,

  gen(v, s) {
    // === 尺寸計算 ===
    const bowlR = dim(s, 1.80, 8);      // 碗口半徑
    const bowlH = dim(s, 1.30, 6);      // 碗總高度
    const footR = Math.max(3, Math.round(bowlR * 0.45)); // 碗底圈足半徑

    // 1. 陶瓷拉麵碗（圓形圈足 + 向上收張擴開的碗壁）
    // 碗底圈足
    v.cyl(0, 0, 0, footR, 1, 0, 1);
    // 碗底封板
    v.cyl(0, 1, 0, footR + 1, 1, 0);

    // 碗身向上弧形張開
    for (let y = 2; y <= bowlH; y++) {
      const prog = (y - 2) / Math.max(1, bowlH - 2);
      const currR = Math.round(footR + (bowlR - footR) * Math.sqrt(prog));
      v.cyl(0, y, 0, currR, 1, 0, 1);
    }

    // 2. 碗緣標誌性「紅色邊圈」與碗身字紋裝飾
    v.cyl(0, bowlH, 0, bowlR, 1, 1, 1);
    // 碗外側書法紅色花紋標記
    mirrorX(v, Math.round(bowlR * 0.72), (vv, dx) => {
      vv.box(dx, Math.round(bowlH * 0.45), -Math.round(bowlR * 0.55), 2, 2, 1, 1);
    });

    // 3. 醬油高湯與浸於湯中的拉麵層
    const soupY = bowlH - 2;
    const soupR = bowlR - 2;
    // 琥珀色醇厚高湯面
    v.cyl(0, soupY, 0, soupR, 1, 2);
    // 湯底微微露出的捲曲黃麵條（左上區域）
    const noodleR = Math.max(2, Math.round(soupR * 0.5));
    for (let i = -noodleR; i <= 0; i++) {
      for (let j = -noodleR; j <= 0; j++) {
        if ((i + j) % 2 === 0 && Math.hypot(i, j) <= noodleR) {
          v.set(i - 1, soupY, j - 1, 3);
        }
      }
    }

    // 4. 厚切炙燒叉燒（右下長條厚肉片）
    const porkW = dim(s, 0.75, 4, true);
    const porkL = dim(s, 1.15, 6);
    const porkX = Math.round(soupR * 0.28);
    const porkZ = Math.round(soupR * 0.28);
    // 叉燒肉排本體（斜置於右下）
    v.box(porkX, soupY + 1, porkZ, porkW, 1, porkL, 4);
    // 叉燒炙燒油脂層（微露亮色）
    v.box(porkX - 1, soupY + 1, porkZ, 1, 1, porkL - 2, 8);

    // 5. 溏心蛋（左下方，蛋白切面 + 橙紅流心蛋黃）
    const eggX = -Math.round(soupR * 0.45);
    const eggZ = Math.round(soupR * 0.25);
    const eggR = dim(s, 0.38, 2);
    // 蛋白半球切面
    blob(v, eggX, soupY + 1, eggZ, eggR + 0.4, 0.8, eggR + 0.2, 0);
    // 橙紅半熟流心蛋黃
    blob(v, eggX, soupY + 1, eggZ, Math.max(0.8, eggR * 0.55), 0.9, Math.max(0.8, eggR * 0.55), 5);

    // 6. 醬漬筍乾（左上高湯邊緣排列）
    const bNum = dim(s, 0.35, 3);
    const bLen = dim(s, 0.45, 3);
    for (let i = 0; i < bNum; i++) {
      v.box(-Math.round(soupR * 0.35) + i * 2, soupY + 1, -Math.round(soupR * 0.55) + i, 1, 1, bLen, 8);
    }

    // 7. 菠菜與大片斜插黑海苔（右上方）
    // 鮮綠燙菠菜堆
    const vegX = Math.round(soupR * 0.25);
    const vegZ = -Math.round(soupR * 0.32);
    v.box(vegX, soupY + 1, vegZ, Math.max(2, dim(s, 0.4, 2)), 1, Math.max(2, dim(s, 0.4, 2)), 7);

    // 黑色香脆大片烤海苔（斜插在右上碗緣）
    const noriX = Math.round(soupR * 0.55);
    const noriZ = -Math.round(soupR * 0.55);
    const noriW = dim(s, 0.80, 4);
    const noriH = dim(s, 0.90, 4);
    for (let h = 0; h < noriH; h++) {
      v.box(noriX - Math.floor(h / 2), soupY + 1 + h, noriZ + Math.floor(h / 2), noriW, 1, 1, 6);
    }

    // 8. 碗中央大份量白蔥絲與翠綠蔥花山
    const leekR = dim(s, 0.38, 2);
    // 白蔥絲蓬鬆堆疊
    blob(v, 0, soupY + 1, 0, leekR + 0.3, 1.2, leekR + 0.3, 0);
    // 頂端點綴青翠細蔥花
    v.box(0, soupY + 2, 0, Math.max(1, leekR), 1, Math.max(1, leekR), 7);
    v.set(0, soupY + 3, 0, 7);
  }
});
