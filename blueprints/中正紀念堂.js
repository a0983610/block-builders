// 檔名：中正紀念堂.js
// v1.263.0：只調色（格子一格沒動）：屋頂改藍琉璃瓦、簷口深藍，牆身白配簷下陰影，台基灰白帶風化斑，寶頂金；下層簷改成只畫留下的那幾層、不再整座畫完再挖（見 開發筆記〈自訂藍圖調整一輪（v1.263.0）〉）
// 正面：宏偉白色收分堂體坐落於多層寬闊石階之上，正中大拱門與金字門匾，頂覆雙層八角起翹重簷與金寶頂
// 側面：正方對稱收分大理石牆身，雙層八角攢尖頂坡度平緩起翹，基座欄杆層次分明
// 三樣識別物：雙層重簷八角攢尖頂與金寶頂、正面三段式大階梯與中央大理石御路、純白收分牆身與大圓拱門
// 部件：廣闊大理石台基 平台白石欄杆 正面大階梯 中央大理石御路 階梯白石扶手 主堂收分白牆(boxTaper) 正面大拱門(arch) 門額金匾 殿內銅像剪影 側立面窗欞 下層八角重簷(hipRoof) 屋簷斗拱層 八角平座暗樓 上層八角攢尖頂 八方垂脊 金色攢尖寶頂
customBlueprint({
  name: '中正紀念堂',
  pal: [
    '#e1dcd2', // 0 白大理石：堂體收分白牆、平台欄杆與階梯扶手、御路、重簷間平座
    '#aaa59b', // 1 白石陰影：簷下那一圈牆、拱門券框、銅像基座、台基最底層、台基側壁風化斑
    '#c3bfb6', // 2 灰白花崗石：台基側壁、平台鋪面、台階踏步
    '#2c5ca6', // 3 藍色琉璃瓦：八角重簷坡面
    '#1b3a72', // 4 深藍：簷口最外那一層、斗拱層、門額匾底
    '#d8a936', // 5 金：攢尖寶頂與托盤、匾面金字
    '#3f3a36'  // 6 深色：殿內銅像、側立面窗洞
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

    // 固定雜湊（座標的純函式，同一個 s 每次產出一樣）：石材每一塊各自風化，不做一層一色的條紋
    const hash = (x, y, z) => (((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) >>> 0) % 100;

    // 1. 白色大理石寶座台基與平台（中空結構節省積木）
    v.box(0, 0, 0, plW + 4, 1, plD + 4, 1);    // 最底層寬闊基台（貼地那層用陰影色）
    /* 側壁花崗石牆：照 v.walls（牆厚 1）的排法逐格蓋，當場用雜湊挑三成風化斑，
       格子跟 v.walls 一格不差，又不必蓋完再掃一遍 */
    {
      const hx = (plW - 1) / 2, hz = (plD - 1) / 2;
      for (let j = 0; j < baseH; j++) for (let i = 0; i < plW; i++) for (let k = 0; k < plD; k++) {
        if (i >= 1 && i < plW - 1 && k >= 1 && k < plD - 1) continue;
        const x = Math.round(-hx + i), y = 1 + j, z = Math.round(-hz + k);
        v.set(x, y, z, hash(x, y, z) < 30 ? 1 : 2);
      }
    }
    v.box(0, baseH, 0, plW, 1, plD, 2);        // 頂層平台大理石鋪面

    // 平台四周白石欄杆
    v.walls(0, baseH + 1, 0, plW, 1, plD, 0, 1);

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
        vv.box(dx, i + 1, stZ + i, 1, 1, 1, 0);
      }
      vv.box(dx, 1, stZ - 1, 1, 2, 1, 0); // 階前抱鼓石/望柱
    });

    // 3. 純白大理石主堂本體（微收分四方石垣）
    const hallY = baseH + 1;
    boxTaper(v, {
      x: 0, y: hallY, z: 0,
      w: bw, d: bw,
      w1: bwTop, d1: bwTop,
      h: bh, c: 0, t: 1
    });
    // 最上面那一層（boxTaper 的頂層剛好是 bwTop 見方）在簷下，換陰影色
    v.walls(0, hallY + bh - 1, 0, bwTop, 1, bwTop, 1, 1);

    // 兩側立面裝飾窗欞飾線（打破側牆平板感）
    const sideWinH = dim(s, 0.35, 2);
    const sideWinY = hallY + Math.round(bh * 0.35);
    mirrorX(v, Math.floor(bwTop / 2), (vv, dx) => {
      vv.box(dx, sideWinY, 0, 1, sideWinH, dim(s, 0.28, 1, true), 6);
    });

    // 4. 正面大圓拱門、門額金匾與殿內剪影
    const archW = dim(s, 0.42, 3, true);
    const archH = dim(s, 0.50, 3);
    const frontZ = -Math.floor(bw / 2); // 正面牆在 -z 側

    // 正面圓拱門（補一圈陰影色的拱圈並挖出通道）
    arch(v, 0, hallY, frontZ, archW, archH, 2, 1);

    // 大殿正中央銅像神聖坐姿剪影
    const statueH = Math.min(bh - 2, archH + 1);
    v.box(0, hallY, 0, 3, 1, 3, 1);      // 銅像基座
    v.box(0, hallY + 1, 0, 2, Math.max(1, statueH - 1), 2, 6); // 坐姿身軀
    v.set(0, hallY + 1 + Math.max(1, statueH - 1), 0, 6);       // 銅像首

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

    /* 八角屋頂：四坡頂正交一份、轉 45 度一份。逐層照 hipRoof 的寫法畫（每層四邊各縮 1 格），
       最下面那層是簷口用深藍、上面是藍琉璃瓦；layers 給了就只畫最下面那幾層。 */
    const roof8 = (y0, span, layers) => {
      const draw = vv => {
        for (let i = 0, w = span; w >= 1 && i < layers; i++, w -= 2)
          vv.box(0, y0 + i, 0, w, 1, w, i === 0 ? 4 : 3);
      };
      draw(v);
      stampY(v, 45, draw);
    };

    // 5. 下層八角重簷屋頂（正交與45度重疊起翹簷口）
    const e1Span = bwTop + dim(s, 0.45, 4, true);
    const eave1Y = hallY + bh;
    const eave1H = dim(s, 0.22, 2);

    // 下層八角斗拱圈
    v.box(0, eave1Y, 0, bwTop + 1, 1, bwTop + 1, 4);
    stampY(v, 45, vv => vv.box(0, eave1Y, 0, bwTop + 1, 1, bwTop + 1, 4));

    /* 下層八角飛簷坡面：只畫最下面 eave1H 層（露出精確厚度之起翹飛簷）。
       舊版是整座四坡頂畫完（連轉 45 度那份），再挖掉 clearSpan²×e1Span 那一大塊切平：
       10000 塊那檔（s=13.49）一次 gen 要逐格刪 38400 格、寫 29074 次，改成只畫留下的那幾層後
       刪 198、寫 24556，留下的格子一模一樣（lo～hi 每 0.02 比一次，0 處不同）。 */
    roof8(eave1Y + 1, e1Span, eave1H);

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

    // 八角攢尖頂坡面匯聚（整座畫到頂）
    roof8(topRoofY + 1, e2Span, Infinity);

    // 8. 頂部金色攢尖寶頂
    const spireY = topRoofY + 1 + Math.ceil(e2Span / 2);
    const spireR = dim(s, 0.15, 1);
    const spireH = dim(s, 0.22, 2);

    // 寶座托盤
    v.cyl(0, spireY, 0, spireR + 1, 1, 5);
    // 葫蘆金球寶珠頂
    v.cyl(0, spireY + 1, 0, spireR, spireH, 5);
    v.set(0, spireY + 1 + spireH, 0, 5);
  }
});