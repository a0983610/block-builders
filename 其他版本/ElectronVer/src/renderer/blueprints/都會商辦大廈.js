// 檔名：都會商辦大廈.js
// 正面：微凹折的八字形雙翼（環抱前庭廣場），中央為退縮的主入口挑高門廊與通天採光天井玻璃帷幕，兩側巨型深灰褐石材框住大片網格玻璃帷幕立面，頂部有突出的深色機械層女兒牆與百葉機房。
// 側面：深色厚實石材外柱包覆，側面開有深色豎條採光帶，底層有挑出雨遮與商業裙樓。
// 三樣識別物：八字形向內凹折的雙翼展角立面、深灰褐巨型結構外柱與連續方格玻璃帷幕、底層挑高迎賓大門與懸臂鋼構採光雨遮。
// 部件：基座地坪、大門前迎賓踏階、前庭景觀花台、中央核心塔身、挑高玻璃旋轉大門、懸臂玻璃雨遮、斜拉鋼索、通天垂直玻璃天井、左右斜展雙翼(stampY)、端頭巨型結構外柱、雙翼14層水平窗間板(spandrels)、垂直窗欞立柱(mullions)、玻璃高光反光點、一樓商業櫥窗與發光招牌飾帶、雙翼壓頂女兒牆、冷卻水塔、屋頂機電通風箱體、頂部電梯機房塔、散熱百葉格柵、避雷天線立柱。
customBlueprint({
  name: '都會商辦大廈',
  pal: [
    '#494848', // 0 最深暗灰褐（巨型外框結構柱、頂部機房、女兒牆、雨遮鋼架）
    '#595558', // 1 深灰褐石材（主體背牆、外牆實體面、屋頂板）
    '#666569', // 2 中深灰（層間水平窗間飾帶、散熱百葉、花台台面）
    '#969798', // 3 中灰金屬（垂直窗欞豎柱、冷卻水塔、避雷天線）
    '#a6a9a8', // 4 灰青金屬（空調機電箱外殼、設備金屬板）
    '#b6b8b7', // 5 香檳銀灰（大面積帷幕玻璃基底）
    '#c7c7c9', // 6 淺灰反光（反射天空之帷幕玻璃、一樓大商鋪櫥窗）
    '#f6f4f6'  // 7 亮白高光（玻璃反光點、大門透光、發光商業招牌帶）
  ],
  lo: 2.0, hi: 14.5,

  gen(v, s) {
    // 尺度計算（14層現代商辦大樓比例：高聳、雙翼展角寬闊）
    const totalH  = dim(s, 3.60, 16);            // 總樓高
    const baseH   = dim(s, 0.55, 3);             // 1~2樓挑高大廳與商業裙樓高度
    const topH    = dim(s, 0.38, 2);             // 中央機房塔突出高度
    const wingL   = dim(s, 1.80, 8);             // 單側翼樓長度
    const wingD   = dim(s, 1.10, 5);             // 翼樓進深
    const cw      = dim(s, 1.05, 5, true);      // 中央核心塔寬度（奇數便於居中）
    const cd      = dim(s, 1.15, 5);             // 中央核心塔深度
    const colW    = Math.max(1, Math.round(dim(s, 0.22, 1))); // 端頭巨柱厚度
    const angleDeg = 16;                         // 兩翼向前探出的八字展開角

    const rz0     = 0;                           // 建築核心中心 z
    const frontZ  = rz0 - Math.floor(cd / 2);    // 中央大門立面 z
    const backZ   = rz0 + Math.ceil(cd / 2) - 1; // 中央背牆 z
    const midZ    = Math.round((frontZ + backZ) / 2);
    const rx0     = (cw - 1) / 2;                // 翼樓旋轉樞紐 x（緊貼中央塔兩側）

    // ── 1. 前庭迎賓廣場與基座環境 ──
    const plazaD = Math.max(3, Math.round(wingL * 0.35));
    v.box(0, 0, frontZ - Math.floor(plazaD / 2), cw + 6, 1, plazaD, 2); // 廣場地磚
    const doorW = Math.max(3, cw - 2);
    v.box(0, 0, frontZ - 1, doorW + 2, 1, 2, 1);                         // 正門迎賓石階

    // 廣場兩側對稱前庭綠化景觀花台
    const plantX = Math.round(rx0 + wingL * 0.45);
    const plantZ = Math.round(rz0 - wingL * 0.28);
    const plantW = Math.max(2, Math.round(wingL * 0.28));
    mirrorX(v, plantX, (vv, px) => {
      vv.box(px, 0, plantZ, plantW, 1, 3, 0);                           // 花台石框
      vv.box(px, 1, plantZ, Math.max(1, plantW - 2), 1, 1, 2);          // 內部花台面
      vv.box(px, 0, frontZ - 2, 1, 1, 1, 0);                            // 人行道車阻石柱
      vv.box(px, 1, frontZ - 2, 1, 1, 1, 7);                            // 車阻警示反光標
    });

    // ── 2. 中央核心中庭塔（Entrance Core Tower） ──
    // 主體實體框與背牆
    v.box(0, 1, backZ, cw, totalH, 1, 1);
    const halfW = (cw - 1) / 2;
    v.box(-halfW, 1, midZ, 1, totalH, cd, 0);                           // 左過渡角柱
    v.box(halfW, 1, midZ, 1, totalH, cd, 0);                            // 右過渡角柱

    // 一樓挑高玻璃旋轉大門（凹退門廊）
    v.box(0, 1, frontZ + 1, doorW, baseH, 1, 7);                        // 大門明亮玻璃
    v.box(-Math.floor(doorW / 2), 1, frontZ, 1, baseH, 1, 0);           // 門框左立柱
    v.box(Math.floor(doorW / 2), 1, frontZ, 1, baseH, 1, 0);            // 門框右立柱

    // 大門上方懸臂採光玻璃雨遮與斜拉鋼索
    v.box(0, baseH, frontZ - 1, doorW + 2, 1, 2, 0);                    // 鋼構框
    v.box(0, baseH, frontZ - 1, doorW, 1, 1, 7);                         // 採光玻璃面板
    const ropeH = Math.max(1, dim(s, 0.25, 2));
    v.line(-Math.floor(doorW / 2) - 1, baseH + ropeH, frontZ, -Math.floor(doorW / 2) - 1, baseH, frontZ - 2, 0);
    v.line(Math.floor(doorW / 2) + 1, baseH + ropeH, frontZ, Math.floor(doorW / 2) + 1, baseH, frontZ - 2, 0);

    // 3F~14F 中央垂直玻璃採光天井
    const atriumW = Math.max(1, cw - 2);
    v.box(0, baseH + 1, frontZ, atriumW, totalH - baseH - 1, 1, 6);     // 天井帷幕底色
    v.box(0, baseH + 1, frontZ, 1, totalH - baseH - 1, 1, 7);           // 中央高光反光骨架

    // 樓層層間水平分格梁
    const nFloors = Math.max(3, Math.min(12, Math.round((totalH - baseH) / 3)));
    const floorH  = (totalH - baseH - 1) / nFloors;
    for (let fl = 1; fl < nFloors; fl++) {
      const fy = Math.round(baseH + 1 + fl * floorH);
      v.box(0, fy, frontZ, atriumW, 1, 1, 2);
    }

    // 屋頂中央突出之電梯機房與設備塔
    v.box(0, totalH, midZ, cw, topH, cd, 0);                             // 機房深灰本體
    v.box(0, totalH + 1, frontZ, atriumW, topH - 1, 1, 2);               // 正面散熱百葉底
    for (let ly = totalH + 1; ly < totalH + topH; ly += 2) {
      v.box(0, ly, frontZ, atriumW, 1, 1, 0);                           // 百葉隔柵深色條紋
    }
    v.box(0, totalH + topH, midZ, cw + 1, 1, cd + 1, 0);                // 機房壓頂簷飾
    const antH = dim(s, 0.40, 2);
    v.box(0, totalH + topH + 1, midZ, 1, antH, 1, 3);                   // 頂部避雷天線

    // ── 3. 左右兩翼（八字形展開翼樓，使用 stampY） ──
    function buildWing(vv, side) {
      const ang = side > 0 ? -angleDeg : angleDeg;                      // 右翼負角前探，左翼正角前探
      const pivotX = side * rx0;

      stampY(vv, ang, (w) => {
        // 局部座標：x 向外延伸 wingL，根部向內深入中央塔 2 格以確保無縫密合
        const x0 = pivotX - side * 2;
        const x1 = pivotX + side * wingL;
        const xmin = Math.min(x0, x1);
        const xmax = Math.max(x0, x1);
        const xLen = xmax - xmin + 1;
        const xMid = Math.round((xmin + xmax) / 2);

        const fz   = rz0 - Math.floor(wingD / 2);                       // 翼樓正面 z
        const bz   = rz0 + Math.ceil(wingD / 2) - 1;                    // 翼樓背面 z
        const wzMid= Math.round((fz + bz) / 2);

        // 主體背牆與結構角柱
        w.box(xMid, 1, bz, xLen, totalH - 1, 1, 1);                     // 背面厚實牆體
        const colX = (side > 0) ? (xmax - Math.floor(colW / 2)) : (xmin + Math.floor(colW / 2));
        w.box(colX, 1, wzMid, colW, totalH, wingD, 0);                   // 端頭巨型深色外柱
        w.box(pivotX, 1, wzMid, 2, totalH, wingD, 0);                   // 內側連接柱

        // 1F~2F 商業裙樓（大櫥窗與發光招牌橫額帶）
        const curtW = Math.max(2, xLen - colW - 2);
        const curtX = (side > 0) ? Math.round((xmin + 1 + xmax - colW) / 2) : Math.round((xmin + colW + xmax - 1) / 2);
        w.box(curtX, 1, fz, curtW, baseH, 1, 6);                         // 一樓大商鋪櫥窗
        w.box(curtX, baseH, fz - 1, curtW + 1, 1, 1, 0);                 // 招牌深色出挑底框
        w.box(curtX, baseH, fz - 1, Math.max(1, curtW - 1), 1, 1, 7);    // 白色亮面招牌飾帶

        // 3F~14F 大面積格子玻璃帷幕立面
        w.box(curtX, baseH + 1, fz, curtW, totalH - baseH - 1, 1, 5);   // 帷幕底色玻璃

        // 水平層間窗間板（Spandrels）
        for (let fl = 1; fl < nFloors; fl++) {
          const fy = Math.round(baseH + 1 + fl * floorH);
          w.box(curtX, fy, fz, curtW, 1, 1, 2);
        }

        // 垂直窗欞立柱（Vertical Mullions）
        const nBays = Math.max(2, Math.round(curtW / 3));
        for (let b = 1; b < nBays; b++) {
          const bx = Math.round((curtX - curtW / 2) + b * (curtW / nBays));
          w.box(bx, baseH + 1, fz, 1, totalH - baseH - 1, 1, 3);
        }

        // 反光玻璃高光亮點（形成立體光澤感）
        for (let fl = 0; fl < nFloors; fl++) {
          const fy = Math.round(baseH + 1 + fl * floorH + floorH * 0.5);
          if (fy >= totalH - 1) continue;
          for (let b = 0; b < nBays; b++) {
            const bx = Math.round((curtX - curtW / 2) + (b + 0.5) * (curtW / nBays));
            w.set(bx, fy, fz, (fl + b) % 3 === 0 ? 7 : 6);
          }
        }

        // 翼樓頂部與壓頂女兒牆
        w.box(xMid, totalH, wzMid, xLen, 1, wingD, 1);                   // 屋頂樓板
        w.box(xMid, totalH + 1, fz, xLen, 1, 1, 0);                     // 前女兒牆
        w.box(xMid, totalH + 1, bz, xLen, 1, 1, 0);                     // 後女兒牆
        w.box(colX, totalH + 1, wzMid, colW, 1, wingD, 0);              // 端頭女兒牆

        // 屋頂冷卻水塔與空調機電箱
        const coolX = Math.round((side > 0) ? (xmin + xLen * 0.45) : (xmax - xLen * 0.45));
        const coolR = dim(s, 0.22, 1);
        const coolH = dim(s, 0.35, 2);
        w.cyl(coolX, totalH + 1, wzMid, coolR, coolH, 3);               // 冷卻水塔
        const hvacX = Math.round((side > 0) ? (xmin + xLen * 0.72) : (xmax - xLen * 0.72));
        const hvacW = dim(s, 0.35, 2);
        w.box(hvacX, totalH + 1, wzMid, hvacW, dim(s, 0.30, 2), Math.max(2, wingD - 3), 4); // 機電箱體
      }, pivotX, rz0);
    }

    // 分別建構右翼與左翼
    buildWing(v, 1);  // 右翼
    buildWing(v, -1); // 左翼
  }
});