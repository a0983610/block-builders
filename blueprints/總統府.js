/* 積木小人 · 匯出的藍圖（總統府）
   用法二選一：放進 blueprints/ 並把檔名加進 list.js，
   或在遊戲裡按「📥 匯入建築」把整份貼進去。 */

// 檔名：總統府.js
// v1.263.0：只調色（格子一格沒動）：紅白倒過來——紅磚為主（固定雜湊兩階深淺），白只留隔一道的水平飾帶、拱券與簷口，另一道改深一階的磚砌腰線；拱廊後面的牆塗成深色窗洞（見 開發筆記〈自訂藍圖調整一輪（v1.263.0）〉）
customBlueprint({
  name: '總統府',
  pal: [
    '#9b342b', // 0 紅磚主牆
    '#e5ded4', // 1 白色水平飾帶 / 拱券 / 簷口線腳 / 塔頂柱廊
    '#556270', // 2 屋頂銅瓦 / 塔頂深色屋瓦
    '#877d73', // 3 石造基座 / 平台階梯 / 圍欄
    '#322822', // 4 深色門窗陰影（拱廊後面的窗洞）
    '#d6b24d', // 5 避雷針 / 塔尖頂飾
    '#7a2822'  // 6 深一階的紅磚（磚的深淺、磚砌腰線、煙囪）
  ],
  lo: 2.2,
  hi: 14.0,

  gen(v, s) {
    // 1. 尺度參數計算
    const bodyW = dim(s, 4.4, 23, true);   // 兩翼總面寬（奇數以利置中）
    const bodyD = dim(s, 1.3, 7);          // 建築縱深
    const bodyH = dim(s, 1.3, 6);          // 翼樓主牆高
    const wingHalf = (bodyW - 1) / 2;

    const towerW = dim(s, 0.9, 5, true);   // 中央主塔面寬
    const towerH = dim(s, 3.8, 16);        // 中央高塔高度
    const cornerW = dim(s, 0.85, 5, true); // 兩端角樓邊長
    const cornerH = bodyH + dim(s, 0.4, 2);// 角樓高過翼樓

    /* 配色工具（v1.263.0）：紅磚用固定雜湊（座標的純函式，同一個 s 每次一樣）挑兩階深淺。
       boxBy 照 v.box 的排法逐格蓋（t 給了就照 v.walls 只留四面牆），顏色由 pick(x, y, z) 當場挑——
       格子跟原本的 v.box／v.walls 一格不差，又不必蓋完再掃一遍。 */
    const hash = (x, y, z) => (((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) >>> 0) % 100;
    const brickC = (x, y, z) => hash(x, y, z) < 15 ? 6 : 0;          // 一成五深一階
    const boxBy = (x0, y0, z0, w, h, d, pick, t) => {
      const hx = (w - 1) / 2, hz = (d - 1) / 2;
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) for (let k = 0; k < d; k++) {
        if (t && i >= t && i < w - t && k >= t && k < d - t) continue;
        const x = Math.round(x0 - hx + i), y = Math.round(y0 + j), z = Math.round(z0 - hz + k);
        v.set(x, y, z, pick(x, y, z));
      }
    };
    // 每兩層一道的水平線腳：隔一道是白色石帶、另一道是深一階的磚砌腰線（紅磚為主、白是飾帶）
    const bandC = y => (y - 2) % 4 === 0 ? 1 : 6;

    // 2. 基座層 (台基、台階)
    v.box(0, 0, 0, bodyW + 4, 1, bodyD + 4, 3);
    const stepW = dim(s, 1.2, 7, true);
    const stepN = dim(s, 0.25, 2);
    stairs(v, 0, 0, -Math.round(bodyD / 2) - 2 - stepN, stepN, stepW, 'z', 3);

    // 3. 兩翼主體量體與紅白飾帶 (辰野風格水平帶)
    boxBy(0, 1, 0, bodyW, bodyH, bodyD, brickC, 1);   // 四面牆（同 v.walls 牆厚 1）
    for (let y = 2; y <= bodyH; y += 2) {
      // 每兩格一道水平飾帶（白帶與磚砌腰線交替）
      v.box(0, y, 0, bodyW + 0.5, 1, bodyD + 0.5, bandC(y));
    }
    // 挖空內部避免實心積木過量
    v.carve(0, 1, 0, bodyW - 2, bodyH, bodyD - 2);

    // 4. 正面兩翼拱廊與外廊 (左右對稱)
    const spanW = (bodyW - towerW - cornerW * 2) / 2;
    if (spanW >= 5) {
      const archCount = Math.max(2, Math.floor(spanW / 3));
      const pierW = 1;
      const archW = Math.max(1, Math.floor((spanW - pierW * (archCount + 1)) / archCount));
      const archH = Math.max(2, Math.floor(bodyH * 0.4));

      /* 一排拱：拱頭以上是白色拱券、拱腳以下的框改成磚柱；開口後面露出來的那格主牆塗成深色窗洞。
         兩件事都只掃每個拱自己那塊框（照 archRow 的排法算：開口寬取奇數、拱距 = 開口寬 + 柱寬、框比開口寬 2）。 */
      const zs = -Math.round(bodyD / 2);                    // 拱廊那片框在主牆前面一格
      const aw = Math.max(1, Math.round(archW)) | 1, ar = (aw - 1) / 2, pitch = aw + pierW;
      const arcade = (vv, dx, y0, h) => {
        archRow(vv, dx, y0, zs, archCount, archW, h, 1, pierW, 1);
        for (let i = 0; i < archCount; i++) {
          const xc = dx + (i - (archCount - 1) / 2) * pitch;
          for (let x = xc - ar - 1; x <= xc + ar + 1; x++) for (let y = y0; y <= y0 + h + ar; y++) {
            if (y < y0 + h) tint(vv, x, y, zs, brickC(x, y, zs));
            if (!vv.has(x, y, zs) && vv.has(x, y, zs + 1)) tint(vv, x, y, zs + 1, 4);
          }
        }
      };

      mirrorX(v, Math.round(towerW / 2 + spanW / 2), (vv, dx) => {
        // 一樓拱廊
        arcade(vv, dx, 1, archH);
        // 二樓連拱
        if (bodyH >= 5) {
          arcade(vv, dx, 1 + archH + 1, archH - 1);
        }
      });
    }

    // 5. 兩側轉角衛塔 (角樓)
    mirrorX(v, wingHalf - Math.floor(cornerW / 2), (vv, cx) => {
      boxBy(cx, 1, 0, cornerW, cornerH, cornerW, brickC);
      for (let y = 2; y <= cornerH; y += 2) {
        vv.box(cx, y, 0, cornerW + 0.6, 1, cornerW + 0.6, bandC(y));
      }
      // 角樓頂部女牆與小尖錐
      vv.box(cx, 1 + cornerH, 0, cornerW + 1, 1, cornerW + 1, 1);
      vv.pyramid(cx, 2 + cornerH, 0, cornerW, 2, 1);
    });

    // 6. 主屋頂與屋簷
    v.box(0, 1 + bodyH, 0, bodyW + 2, 1, bodyD + 2, 1); // 簷口線腳
    hipRoof(v, 0, 2 + bodyH, 0, bodyW, bodyD, 2);       // 四坡斜頂

    // 7. 正門車寄 (門廊 Entry Portico)
    const porchW = dim(s, 1.1, 5, true);
    const porchD = dim(s, 0.45, 2);
    const porchH = dim(s, 0.65, 3);
    const porchZ = -Math.round(bodyD / 2) - Math.floor(porchD / 2);
    // 車寄跟主牆同一套：紅磚，偶數層是那一道水平線腳（白帶或磚砌腰線）
    boxBy(0, 1, porchZ, porchW, porchH, porchD, (x, y, z) => y >= 2 && y % 2 === 0 ? bandC(y) : brickC(x, y, z));
    arch(v, 0, 1, porchZ - Math.floor(porchD / 2), dim(s, 0.45, 3, true), porchH - 1, 1);
    v.dome(0, 1 + porchH, porchZ, Math.round(porchW / 2), 2, 0.6); // 車寄拱頂（跟屋頂同色）

    /* 正門：照上面那個拱的開口形狀（arch 的算法），從車寄正面那一格往裡找第一格塗成深色門洞。
       車寄深度是偶數的尺寸 arch 挖不到車寄（挖在它前面一格），那就直接塗在車寄正面上。
       只從車寄正面往裡找（再往前會塗到台階）、只塗到車寄頂（再上去會塗到拱頂）。
       這也是最小尺寸唯一的深色（那時兩翼還排不下拱廊）。 */
    const dw = dim(s, 0.45, 3, true), dr = (dw - 1) / 2, dh = porchH - 1;
    const zf = Math.round(porchZ - (porchD - 1) / 2);              // 車寄正面那一格的 z（照 box 的取整）
    for (let y = 1; y <= Math.min(porchH, 1 + dh + dr); y++) {
      const j = y - 1 - dh, half = j < 0 ? dr : Math.round(Math.sqrt(Math.max(0, dr * dr - j * j)));
      for (let x = -half; x <= half; x++)
        for (let z = zf; z <= porchZ; z++) if (tint(v, x, y, z, 4)) break;
    }

    // 8. 中央衛塔 (高塔本體、層層收分、拱窗)
    const tBaseZ = 0;
    boxBy(0, 1, tBaseZ, towerW + 1, bodyH + 2, towerW + 1, brickC);
    boxBy(0, bodyH + 2, tBaseZ, towerW, towerH - bodyH, towerW, brickC, 1);

    // 塔身高階紅白紋路與中央長窗（塔身的線腳從 bodyH+2 起算，同樣白帶與磚砌腰線交替）
    for (let ty = bodyH + 2; ty <= towerH; ty += 2) {
      v.box(0, ty, tBaseZ, towerW + 0.4, 1, towerW + 0.4, (ty - bodyH - 2) % 4 === 0 ? 1 : 6);
    }
    const winH = dim(s, 0.8, 3);
    v.carve(0, towerH - winH - 2, tBaseZ - Math.floor(towerW / 2), 1, winH, 1);

    // 塔頂瞭望閣、柱列與圓頂
    const capY = 1 + towerH;
    v.box(0, capY, tBaseZ, towerW + 1, 1, towerW + 1, 1); // 塔簷
    v.cyl(0, capY + 1, tBaseZ, (towerW - 1) / 2, dim(s, 0.4, 2), 1, 1); // 圓形柱廊室
    v.dome(0, capY + 1 + dim(s, 0.4, 2), tBaseZ, (towerW - 1) / 2, 2);   // 塔頂穹頂

    // 9. 頂飾與附屬細節 (避雷針桿、屋頂小煙囪)
    const spireY = capY + 1 + dim(s, 0.4, 2) + Math.round((towerW - 1) / 2);
    const spireH = dim(s, 0.4, 2);
    v.box(0, spireY, tBaseZ, 1, spireH, 1, 5); // 塔尖避雷針

    // 屋頂對稱小煙囪/通風孔
    mirrorX(v, Math.round(towerW / 2 + spanW / 2), (vv, sx) => {
      vv.box(sx, 2 + bodyH + 2, 0, 1, dim(s, 0.25, 2), 1, 6);
    });
  }
});
