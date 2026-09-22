/* 積木小人 · 匯出的藍圖（超商咖啡）
   用法二選一：放進 blueprints/ 並把檔名加進 list.js，
   或在遊戲裡按「📥 匯入建築」把整份貼進去。 */

// 檔名：超商咖啡.js
customBlueprint({
  name: '超商咖啡',
  pal: [
    '#201c1a', // 0 經典黑色紙杯身（外壁與底座）
    '#9d6c46', // 1 瓦楞防燙隔熱紙杯套（牛皮紙原色）
    '#c82424', // 2 標誌暖紅（City Cafe 經典亮紅飾帶）
    '#3c7836', // 3 標誌翠綠（7-11 經典綠色飾線）
    '#181615', // 4 凸起飲用杯蓋（黑色外帶密封蓋）
    '#f5f5f5', // 5 吸管 / 隔熱套文字反光點綴（純白細節）
    '#4e2b17', // 6 濃郁熱咖啡液面（深棕咖啡色）
    '#e8d3b8'  // 7 拿鐵綿密奶泡層（乳白微黃奶沫）
  ],
  lo: 2.2, hi: 16.0,

  gen(v, s) {
    // === 1. 幾何尺寸參數計算 ===
    const rBase = dim(s, 0.46, 3);          // 杯底半徑
    const rTop = dim(s, 0.65, 4);           // 杯口半徑（上寬下窄錐形）
    const cupH = dim(s, 2.2, 7);            // 杯身高
    const sleeveH = dim(s, 0.75, 3);        // 隔熱杯套高度
    const sleeveY = Math.round(cupH * 0.32); // 杯套起點高度
    const lidH = dim(s, 0.38, 2);           // 凸起杯蓋高度

    // === 2. 上寬下窄錐形紙杯身 ===
    // 實心內核打底（確保小尺寸連通與穩固基底）
    v.taper(0, 0, 0, rBase, rTop, cupH, 0);

    // 頂部杯口內部填入咖啡液與細緻奶泡
    const liquidY = cupH - 1;
    v.cyl(0, liquidY, 0, rTop - 1, 1, 6);
    // 拿鐵奶泡微拉花（中央偏心圓沫）
    v.cyl(0, liquidY, 0, Math.max(1, Math.round(rTop * 0.55)), 1, 7);

    // === 3. 瓦楞防燙隔熱紙杯套（中段加厚一圈） ===
    const rSleeve0 = rBase + (rTop - rBase) * (sleeveY / cupH) + 0.5;
    const rSleeve1 = rBase + (rTop - rBase) * ((sleeveY + sleeveH) / cupH) + 0.5;
    v.taper(0, sleeveY, 0, rSleeve0, rSleeve1, sleeveH, 1, 1);

    // 杯套正面商標飾帶（紅綠雙色彩條 + 白色標籤點）
    const frontZ = Math.round(rSleeve0);
    const logoY = sleeveY + Math.floor(sleeveH / 2);
    // 紅色主飾條
    v.line(-Math.max(1, Math.round(rBase * 0.5)), logoY, -frontZ, Math.max(1, Math.round(rBase * 0.5)), logoY, -frontZ, 2);
    // 綠色次飾條
    v.line(-Math.max(1, Math.round(rBase * 0.5)), logoY - 1, -frontZ, Math.max(1, Math.round(rBase * 0.5)), logoY - 1, -frontZ, 3);
    // 中央白色商標塊
    tint(v, 0, logoY, -frontZ, 5);

    // === 4. 立體外帶飲用杯蓋 ===
    const lidY = cupH;
    // 咬合於杯緣的外唇圈（略突出杯身）
    v.cyl(0, lidY, 0, rTop + 1, 1, 4, 1);
    // 向上隆起之杯蓋主台面
    v.cyl(0, lidY + 1, 0, rTop, lidH, 4);
    // 頂部下凹積水槽台階
    v.cyl(0, lidY + lidH, 0, Math.max(1, rTop - 1), 1, 0);

    // 經典飲用突起小吸嘴開口（位於杯蓋邊緣）
    const spoutZ = -(rTop - 1);
    v.box(0, lidY + lidH + 1, spoutZ, dim(s, 0.28, 2, true), 1, dim(s, 0.2, 1), 4);
    // 飲口小空洞
    v.carve(0, lidY + lidH + 1, spoutZ, 1, 1, 1);

    // 杯蓋中央微型通氣針孔 (carve 挖出細孔)
    v.carve(0, lidY + lidH, 0, 1, 1, 1);

    // === 5. 側邊斜插攪拌棒 / 紅白細吸管 ===
    const strawLen = dim(s, 1.3, 5);
    const strawStartX = Math.round(rTop * 0.35);
    const strawStartZ = Math.round(rTop * 0.35);
    v.line(
      strawStartX, lidY + lidH, strawStartZ,
      strawStartX + Math.round(rTop * 0.4), lidY + lidH + strawLen, strawStartZ + Math.round(rTop * 0.4),
      5
    );
    // 吸管頂端微紅警示圈
    paintFrom(v, strawStartX + Math.round(rTop * 0.4), lidY + lidH + strawLen, strawStartZ + Math.round(rTop * 0.4), 0, -1, 0, 2, 2);
  }
});
