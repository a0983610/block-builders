/* 積木小人 · 匯出的藍圖（特製叉燒拉麵）
   用法二選一：放進 blueprints/ 並把檔名加進 list.js，
   或在遊戲裡按「📥 匯入建築」把整份貼進去。 */

// 檔名：特製叉燒拉麵.js
// v1.263.0：碗身加厚接上碗腳（原本整個碗身懸空）、hi 拉大、白瓷碗配一階灰與陰影（見 開發筆記〈自訂藍圖調整一輪（v1.263.0）〉）
customBlueprint({
  name: '特製叉燒拉麵',
  pal: [
    '#e6e1d6', // 0 陶瓷碗身（白瓷，受光那半圈）／蛋白／白蔥絲
    '#c82b2b', // 1 碗緣紅圈與碗身書法字紅印
    '#b88438', // 2 金黃清透醬油高湯
    '#e2b744', // 3 捲曲黃拉麵條
    '#8d5732', // 4 炙燒叉燒厚肉片（滷肉深褐色）
    '#e58226', // 5 半熟流心糖心蛋黃
    '#1d241d', // 6 黑色大片烤海苔／碗口書法字
    '#88b358', // 7 翠綠青蔥花／菠菜綠葉
    '#c49a5b', // 8 醬漬筍乾（竹筍條）
    '#c7c1b5', // 9 白瓷一階灰（背光那半圈、碗底收進去那一段）
    '#a49d91'  // 10 陰影（圈足、碗底背光那一段）
  ],
  lo: 2.2, hi: 20,

  gen(v, s) {
    // === 尺寸計算 ===
    const bowlR = dim(s, 1.80, 8);      // 碗口半徑
    const bowlH = dim(s, 1.30, 6);      // 碗總高度
    const footR = Math.max(3, Math.round(bowlR * 0.45)); // 碗底圈足半徑

    // 固定雜湊：座標的純函式，同一個 s 每次產出一模一樣
    const hash = (x, y, z) => (((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) >>> 0) % 100;
    /* 白瓷的明暗：受光是 +x、−z 那一側（跟內建骰子同一套），背光那半圈換一階灰，
       交界用雜湊打散；碗底收進去那一段（朝下、照不到光）整圈再暗一階 */
    const lowY = 2 + Math.round((bowlH - 2) * 0.3);
    const bowlC = (i, y, k, d) => {
      const dot = d ? (i - k) / (Math.SQRT2 * d) : 0;
      const back = dot < -0.35 || (dot < -0.05 && hash(i, y, k) < 50);
      if (y <= lowY) return back ? 10 : 9;
      return back ? 9 : 0;
    };

    // 1. 陶瓷拉麵碗（圓形圈足 + 向上收張擴開的碗壁）
    // 碗底圈足（素燒、陰影）
    v.cyl(0, 0, 0, footR, 1, 10, 1);
    // 碗底封板
    v.cyl(0, 1, 0, footR + 1, 1, 10);

    // 碗身向上弧形張開
    /* 碗底那段弧一層往外跨好幾格（sqrt 一開始很陡：3000 塊那檔第 2 層半徑 8、第 3 層就 11），
       一格厚的環上下對不到，整個碗身跟碗腳斷開、懸空成一組。
       所以每一層的牆往內加厚到「上一層的半徑 − 1」，上下兩層一定疊得到。 */
    let prevR = footR;
    for (let y = 2; y <= bowlH; y++) {
      const prog = (y - 2) / Math.max(1, bowlH - 2);
      const currR = Math.round(footR + (bowlR - footR) * Math.sqrt(prog));
      const inner = Math.min(currR, prevR) - 1;
      const n = Math.ceil(currR);
      for (let i = -n; i <= n; i++) for (let k = -n; k <= n; k++) {
        const d = Math.hypot(i, k);
        if (d > currR + 0.35 || d < inner) continue;
        v.set(i, y, k, bowlC(i, y, k, d));
      }
      prevR = currR;
    }

    // 2. 碗緣標誌性「紅色邊圈」與碗身字紋裝飾
    v.cyl(0, bowlH, 0, bowlR, 1, 1, 1);
    // 碗外側書法紅色花紋標記：從外往碗心掃、塗在碗壁表面（原本用 box 擺，會凸出碗外一兩格）
    const markY = Math.round(bowlH * 0.45), markZ = -Math.round(bowlR * 0.55);
    mirrorX(v, Math.round(bowlR * 0.72), (vv, dx) => {
      const len = Math.hypot(dx, markZ), ux = dx / len, uz = markZ / len;
      for (const a of [-0.5, 0.5]) for (let b = 0; b < 2; b++)
        paintFrom(vv, -uz * a, markY + b, ux * a, ux, 0, uz, bowlR + 2, 1);
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
