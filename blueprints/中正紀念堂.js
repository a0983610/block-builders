// 檔名：中正紀念堂.js
// 正面：宏偉白色收分堂體坐落於多層寬闊石階之上，正中大拱門與金字門匾，頂覆雙層八角起翹重簷與金寶頂
// 側面：正方對稱收分大理石牆身，雙層八角攢尖頂坡度平緩起翹，基座欄杆層次分明
// 三樣識別物：雙層重簷八角攢尖頂與金寶頂、正面三段式大階梯與中央大理石御路、純白收分牆身與大圓拱門
// 部件：廣闊大理石台基 平台白石欄杆 正面大階梯 中央大理石御路 階梯白石扶手 主堂收分白牆(boxTaper) 正面大拱門(arch) 門額金匾 殿內銅像剪影 側立面窗欞 下層八角重簷(hipRoof) 屋簷斗拱層 八角平座暗樓 上層八角攢尖頂 八方垂脊 金色攢尖寶頂
customBlueprint({
  name: '中正紀念堂',
  pal: [
    '#b4b5b9', // 0 白大理石主體、堂體收分白牆、御路石雕
    '#acadb2', // 1 次級台基底座、石階扶手與護欄
    '#aeb1b4', // 2 台階踏步、大理石地坪鋪面
    '#8c8884', // 3 八角攢尖頂青瓦面、屋簷坡面
    '#938d87', // 4 拱門券框、門額底板、斗拱陰影層、內部坐像剪影
    '#99938b'  // 5 金色攢尖寶珠頂、門匾金色字體
  ],
  lo: 2.4,
  hi: 18.5,

  gen(v, s) {
    // 核心量體尺寸計算
    const bw = dim(s, 1.4, 9, true);       // 主堂底寬（奇數確保中線對齊）
    const bwTop = dim(s, 1.15, 7, true);   // 主堂頂寬（微收分梯形）
    const bh = dim(s, 1.05, 5);            // 主堂牆身高
    const baseH = dim(s, 0.45, 3);         // 台基高度
    const plW = bw + dim(s, 0.85, 4, true);// 大理石平台寬
    const plD = bw + dim(s, 0.85, 4, true);// 大理石平台深

    // 1. 白色大理石寶座台基與平台（中空結構節省積木）
    v.box(0, 0, 0, plW + 4, 1, plD + 4, 1);    // 最底層寬闊基台
    v.walls(0, 1, 0, plW, baseH, plD, 1, 1);    // 側壁白石牆
    v.box(0, baseH, 0, plW, 1, plD, 2);        // 頂層平台大理石鋪面

    // 平台四周白石欄杆
    v.walls(0, baseH + 1, 0, plW, 1, plD, 1, 1);

    // 2. 正面宏偉大階梯與中央大理石御路（正面朝向 -z）
    const frontEdgeZ = -Math.floor(plD / 2);
    const stSteps = baseH;                     // 階梯高程正好銜接至平台表面
    const stW = dim(s, 0.95, 5, true);         // 階梯寬度
    const rampW = dim(s, 0.32, 1, true);       // 正中御路雕刻寬度
    const stZ = frontEdgeZ - stSteps;          // 階梯前緣起點（朝 -z 伸展）

    // 在平台正面欄杆開闢登階通道
    v.carve(0, baseH + 1, frontEdgeZ, stW + 2, 2, 2);

    // 階梯群本體（向 +z 方向攀升至台基表面）
    stairs(v, 0, 0, stZ, stSteps, stW, 'z', 2);
    // 中央大理石雕刻御路覆蓋
    stairs(v, 0, 0, stZ, stSteps, rampW, 'z', 0);

    // 階梯兩側白石扶手與端頭望柱
    const halfStW = Math.floor(stW / 2);
    mirrorX(v, halfStW + 1, (vv, dx) => {
      for (let i = 0; i < stSteps; i++) {
        vv.box(dx, i + 1, stZ + i, 1, 1, 1, 1);
      }
      vv.box(dx, 1, stZ - 1, 1, 2, 1, 1); // 階前抱鼓石/望柱
    });

    // 3. 純白大理石主堂本體（微收分四方石垣）
    const hallY = baseH + 1;
    boxTaper(v, {
      x: 0, y: hallY, z: 0,
      w: bw, d: bw,
      w1: bwTop, d1: bwTop,
      h: bh, c: 0, t: 1
    });

    // 兩側立面裝飾窗欞飾線（打破側牆平板感）
    const sideWinH = dim(s, 0.35, 2);
    const sideWinY = hallY + Math.round(bh * 0.35);
    mirrorX(v, Math.floor(bwTop / 2), (vv, dx) => {
      vv.box(dx, sideWinY, 0, 1, sideWinH, dim(s, 0.28, 1, true), 4);
    });

    // 4. 正面大圓拱門、門額金匾與殿內剪影
    const archW = dim(s, 0.42, 3, true);
    const archH = dim(s, 0.50, 3);
    const frontZ = -Math.floor(bw / 2); // 正面牆在 -z 側

    // 正面圓拱門（補深色拱圈並挖出通道）
    arch(v, 0, hallY, frontZ, archW, archH, 2, 4);

    // 大殿正中央銅像神聖坐姿剪影
    const statueH = Math.min(bh - 2, archH + 1);
    v.box(0, hallY, 0, 3, 1, 3, 4);      // 銅像基座
    v.box(0, hallY + 1, 0, 2, Math.max(1, statueH - 1), 2, 4); // 坐姿身軀
    v.set(0, hallY + 1 + Math.max(1, statueH - 1), 0, 4);       // 銅像首

    // 正門上方「中正紀念堂」金字門匾
    const plaqueY = hallY + archH + Math.floor(archW / 2) + 1;
    if (plaqueY < hallY + bh - 1) {
      const t = (plaqueY - hallY) / bh;
      const curW = bw - (bw - bwTop) * t;
      const fz = -Math.round(curW / 2);
      const plaqueW = dim(s, 0.45, 3, true);
      v.box(0, plaqueY, fz, plaqueW, 1, 1, 4); // 藍底/深底匾額
      v.set(0, plaqueY, fz - 1, 5);           // 匾面正中金字
    }

    // 5. 下層八角重簷屋頂（正交與45度重疊起翹簷口）
    const e1Span = bwTop + dim(s, 0.45, 4, true);
    const eave1Y = hallY + bh;
    const eave1H = dim(s, 0.22, 2);

    // 下層八角斗拱圈
    v.box(0, eave1Y, 0, bwTop + 1, 1, bwTop + 1, 4);
    stampY(v, 45, vv => vv.box(0, eave1Y, 0, bwTop + 1, 1, bwTop + 1, 4));

    // 下層八角飛簷坡面
    hipRoof(v, 0, eave1Y + 1, 0, e1Span, e1Span, 3);
    stampY(v, 45, vv => hipRoof(vv, 0, eave1Y + 1, 0, e1Span, e1Span, 3));

    // 切平下層飛簷上方多餘坡度，露出精確厚度之起翹飛簷
    const clearSpan = Math.round(e1Span * 1.5) + 4;
    v.carve(0, eave1Y + 1 + eave1H, 0, clearSpan, e1Span, clearSpan);

    // 6. 重簷間八角平座暗樓（白色八角過渡頸部）
    const midY = eave1Y + 1 + eave1H;
    const midH = dim(s, 0.28, 2);
    const midW = Math.max(5, bwTop - 2);
    v.box(0, midY, 0, midW, midH, midW, 0);
    stampY(v, 45, vv => vv.box(0, midY, 0, midW, midH, midW, 0));

    // 7. 上層八角攢尖頂主坡面（八方垂脊向頂端收攏）
    const topRoofY = midY + midH;
    const e2Span = midW + dim(s, 0.45, 4, true);

    // 上層八角斗拱圈
    v.box(0, topRoofY, 0, midW + 1, 1, midW + 1, 4);
    stampY(v, 45, vv => vv.box(0, topRoofY, 0, midW + 1, 1, midW + 1, 4));

    // 八角攢尖頂坡面匯聚
    hipRoof(v, 0, topRoofY + 1, 0, e2Span, e2Span, 3);
    stampY(v, 45, vv => hipRoof(vv, 0, topRoofY + 1, 0, e2Span, e2Span, 3));

    // 8. 頂部金色攢尖寶頂
    const spireY = topRoofY + 1 + Math.ceil(e2Span / 2);
    const spireR = dim(s, 0.15, 1);
    const spireH = dim(s, 0.22, 2);

    // 寶座托盤
    v.cyl(0, spireY, 0, spireR + 1, 1, 4);
    // 葫蘆金球寶珠頂
    v.cyl(0, spireY + 1, 0, spireR, spireH, 5);
    v.set(0, spireY + 1 + spireH, 0, 5);
  }
});