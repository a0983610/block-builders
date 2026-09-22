// 檔名：商銀柱列大樓.js
// 正面：深褐黑柱列框架，中央切角內折入口，大面積方格玻璃帷幕，一樓右側延伸鮮紅銀行招牌橫額
// 側面：縱深厚實的現代商辦大樓，立面由垂直磁磚柱與規律長方窗格反覆構成
// 三樣識別物：暗棕黑色外露立柱框架、大片亮灰藍鏡面玻璃帷幕網格、一樓鮮紅色商業銀行招牌帶與綠蔭行道樹
// 部件：人行地坪 基座柱廊 挑高大廳入口 鋼構深色雨遮 一樓紅色銀行招牌 左右翼玻璃帷幕 中央八角切角筒 垂直深色磁磚壁柱 樓層橫樑分界 頂樓機房 退縮女兒牆 門前綠化灌木 行道樹

customBlueprint({
  name: '商銀柱列大樓',
  pal: [
    '#383335', // 0 深棕黑磁磚柱與外露框架
    '#585355', // 1 次深色橫樑、窗框與退縮背牆
    '#b8c4cb', // 2 玻璃帷幕反光淺灰藍
    '#e2e8ec', // 3 玻璃反光高光與窗櫺
    '#c82532', // 4 一樓上海商銀標誌性紅色招牌橫額
    '#d2d5d8', // 5 人行道地坪、入口台階與花台邊石
    '#4b6b33', // 6 門前綠化植栽與行道樹冠
    '#25282d'  // 7 挑高玻璃大門、金屬雨遮結構
  ],
  lo: 2.2,
  hi: 15.0,

  gen(v, s) {
    // 尺度計算：以大樓寬高深為基準
    const totalW = dim(s, 2.4, 15, true);  // 大樓正面總寬（奇數置中）
    const totalD = dim(s, 1.6, 9);         // 大樓進深
    const totalH = dim(s, 3.2, 16);        // 主樓總高
    const lobbyH = dim(s, 0.55, 3);        // 一樓挑高挑空區高度
    const floorH = Math.max(1, Math.round(totalH * 0.08)); // 樓層分界線厚度

    // 1. 基座地坪（人行道與花台基地）
    const baseW = totalW + 4;
    const baseD = totalD + 4;
    v.box(0, 0, 1, baseW, 1, baseD, 5);

    // 2. 主樓底層實心核心（防止中空浮空，加強結構）
    v.box(0, 1, 0, totalW, totalH, totalD, 1);

    // 3. 兩翼主立面與玻璃帷幕覆蓋（正面 -z 側）
    const wingW = Math.floor((totalW - 3) / 2);
    const zFront = -Math.floor(totalD / 2);

    // 兩翼玻璃帷幕牆面（底層鋪設反光淺藍玻璃，再由窗櫺與磁磚柱分割）
    mirrorX(v, Math.floor(totalW / 4) + 1, (vv, wx) => {
      // 帷幕背景
      vv.box(wx, 1 + lobbyH, zFront, wingW, totalH - lobbyH, 1, 2);

      // 規律窗格與反光格線 (windowGrid 走 tint)
      const cols = Math.max(2, Math.floor(wingW / 2));
      const rows = Math.max(3, Math.floor((totalH - lobbyH) / 3));
      windowGrid(vv, {
        x: wx,
        y: 2 + lobbyH,
        z: zFront,
        cols: cols,
        rows: rows,
        stepX: 2,
        stepY: 3,
        w: 1,
        h: 2,
        c: 3,
        axis: 'x'
      });
    });

    // 4. 垂直磁磚柱（建築最鮮明的深色垂直立體肋骨）
    const colCount = Math.max(3, Math.round(totalW / 4));
    rowOf(v, colCount, Math.floor(totalW / (colCount - 1 || 1)), (vv, cx) => {
      vv.box(cx, 1 + lobbyH, zFront - 1, 1, totalH - lobbyH, 2, 0);
    }, 0);

    // 5. 大樓中央內凹切角轉角塔身（八角轉角形態）
    const centerW = dim(s, 0.5, 3, true);
    v.box(0, 1, zFront + 1, centerW, totalH + 1, 2, 0);
    // 中央切角處之垂直深色裝飾窗帶
    v.box(0, 1 + lobbyH, zFront, Math.max(1, centerW - 2), totalH - lobbyH - 1, 1, 2);

    // 6. 一樓大廳與商業門面
    // 大樓一樓深色框架與退縮柱廊
    v.box(0, 1, zFront, totalW, lobbyH, 1, 0);
    // 挖出透明挑高玻璃落地窗
    v.box(0, 1, zFront, totalW - 2, lobbyH - 1, 1, 7);

    // 一樓右側：標誌性的鮮紅色銀行招牌橫額（上海商業儲蓄銀行紅底招牌帶）
    const signW = Math.floor(totalW * 0.45);
    const signX = Math.floor(totalW / 4) + 1;
    const signY = lobbyH;
    v.box(signX, signY, zFront - 1, signW, 1, 1, 4);
    // 招牌上的亮色字體微裝飾
    tint(v, signX, signY, zFront - 1, 3);
    tint(v, signX - 2, signY, zFront - 1, 3);
    tint(v, signX + 2, signY, zFront - 1, 3);

    // 一樓左側/中央：挑高玻璃主入口與外探鋼構雨遮
    const canopyW = dim(s, 0.7, 5, true);
    const canopyD = dim(s, 0.35, 2);
    v.box(0, lobbyH, zFront - Math.floor(canopyD / 2), canopyW, 1, canopyD, 7);
    // 主門廳玻璃大門入口
    v.box(0, 1, zFront, canopyW - 2, lobbyH - 1, 1, 2);
    // 入口迎賓台階
    stairs(v, 0, 0, zFront - canopyD, 2, canopyW, '-z', 5);

    // 7. 頂樓女兒牆、機房與屋頂設備
    const roofY = 1 + totalH;
    // 頂層壓頂深色橫樑線腳
    v.box(0, roofY - 1, 0, totalW + 1, 1, totalD + 1, 0);
    // 外圍女兒牆（四面護欄）
    v.walls(0, roofY, 0, totalW, 2, totalD, 0, 1);
    // 中央機房核心筒（頂部退縮矩形塔體）
    const equipW = Math.max(3, Math.floor(totalW * 0.5));
    const equipD = Math.max(3, Math.floor(totalD * 0.45));
    const equipH = dim(s, 0.4, 2);
    v.box(0, roofY, 0, equipW, equipH, equipD, 1);
    // 機房頂部散熱百葉格柵
    v.box(0, roofY + equipH, 0, equipW - 2, 1, equipD - 2, 0);

    // 8. 側面與後方立面細化（避免側面單調）
    const sideW = Math.floor(totalD * 0.7);
    mirrorX(v, Math.floor(totalW / 2), (vv, sx) => {
      // 側牆窗格
      windowGrid(vv, {
        x: sx,
        y: 2 + lobbyH,
        z: 0,
        cols: Math.max(2, Math.floor(sideW / 3)),
        rows: Math.max(2, Math.floor((totalH - lobbyH) / 4)),
        stepX: 3,
        stepY: 4,
        w: 1,
        h: 2,
        c: 2,
        axis: 'z'
      });
    });

    // 9. 街道前庭綠化設施（參考圖前方的大型行道樹與修剪矮灌木）
    // 前方矮灌木綠化花台（沿人行道邊緣排列）
    const shrubCount = Math.max(2, Math.floor(totalW / 5));
    const streetZ = zFront - 2;
    mirrorX(v, Math.floor(totalW * 0.35), (vv, kx) => {
      // 綠化矮灌木叢
      vv.box(kx, 1, streetZ, 3, 1, 2, 6);
      vv.box(kx, 0, streetZ, 4, 1, 3, 5); // 矮灌木花台石邊界
    });

    // 標誌性行道樹（在入口斜前方、生氣蓬勃的茂密綠樹）
    const treeX = -Math.floor(totalW * 0.2);
    const treeZ = zFront - 3;
    const treeTrunkH = dim(s, 0.45, 3);
    const crownR = Math.max(1.6, s * 0.22);
    // 樹幹
    v.cyl(treeX, 1, treeZ, 0.6, treeTrunkH, 0);
    // 茂密樹冠（使用球體 blob 堆疊出自然的綠樹樹蔭）
    blob(v, treeX, 1 + treeTrunkH + Math.round(crownR * 0.7), treeZ, crownR * 1.2, crownR * 0.9, crownR * 1.1, 6);
  }
});