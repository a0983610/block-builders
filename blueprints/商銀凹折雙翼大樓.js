// 檔名：商銀凹折雙翼大樓.js
// 正面：高聳雙翼向內凹折，中央八角切角退縮筒，整面方格玻璃帷幕與深灰立柱，右側一樓橫向鮮紅商銀長條招牌
// 側面：縱深厚實且滿佈垂直磁磚柱與規律長方窗格的商辦立面
// 三樣識別物：中央切角凹折雙翼玻璃帷幕大樓、一樓平整鮮紅商業銀行橫額招牌、挑高二層玻璃門廳與外探深色鋼構雨遮
// 部件：人行地基 挑高二層柱廊大廳 突出鋼構深色雨遮 一樓鮮紅長條銀行招牌 左右向前延伸雙翼 中央八角切角凹折筒 密佈垂直磁磚柱 樓層橫樑窗格方格網 縱深側面窗格柱列 頂樓退縮女兒牆與機房 前方綠化花台與行道樹

customBlueprint({
  name: '商銀凹折雙翼大樓',
  pal: [
    '#383436', // 0 深褐黑磁磚立柱與外露立面骨架
    '#595558', // 1 樓層橫樑、窗框與退縮背牆深灰
    '#8fa0a8', // 2 玻璃帷幕灰藍反射面
    '#e2e8ec', // 3 玻璃高光細窗櫺與白色商銀標誌字樣
    '#c82532', // 4 一樓上海商銀標誌性平整鮮紅招牌橫額
    '#c7c7c9', // 5 淺灰花崗岩人行道、台階與花台邊石
    '#4b6b33', // 6 行道樹與門前灌木綠蔭
    '#1e2024'  // 7 挑高玻璃大廳深色金屬結構、雨遮與陰影
  ],
  lo: 1.4,
  hi: 14.5,

  gen(v, s) {
    // 尺度計算：塑造高聳商辦大樓的挺拔比例（高寬比達 1.8:1 以上）
    // 下限一律是原稿的 0.7 倍（原本 17／24／13／4／5／3／4）：原稿最小就是 5988 塊，
    // 面板的 1800／3000 按下去等於沒反應，跟 v1.66 的新天鵝堡同一個修法（見 開發筆記〈兩座的 `dim` 下限乘 0.7〉）
    const totalW = dim(s, 2.2, 12, true);  // 總寬（奇數置中）
    const totalH = dim(s, 4.0, 17);        // 總高（高聳商辦大樓）
    const totalD = dim(s, 1.8, 9);         // 縱深
    const lobbyH = dim(s, 0.65, 3);        // 一樓至二樓挑高大廳高度

    const frontZ = -Math.floor(totalD / 2); // 兩翼最前端 z 座標
    const recess = Math.max(2, Math.round(totalW * 0.12)); // 中央凹折退縮深度
    const centerW = dim(s, 0.65, 3, true); // 中央切角筒正面寬度

    // 1. 基座地坪（寬闊人行道）
    const baseW = totalW + 6;
    const baseD = totalD + 6;
    v.box(0, 0, 0, baseW, 1, baseD, 5);

    // 2. 主樓本體實心結構
    v.box(0, 1, 0, totalW, totalH, totalD, 1);

    // 3. 正面凹折切角造型雕刻（塑造中央凹折與八角切角筒）
    // 先切掉中央正面區域，形成倒八字形向內凹折空間
    for (let dy = 1; dy <= totalH; dy++) {
      // 中央退縮凹槽
      v.carve(0, dy, frontZ + Math.floor(recess / 2), centerW + recess * 2, 1, recess);
      // 斜向 45 度切角過渡面（向兩翼展開）
      for (let step = 0; step < recess; step++) {
        const cutW = centerW + step * 2;
        v.carve(0, dy, frontZ + step, cutW, 1, 1);
      }
    }

    // 4. 中央八角切角筒與玻璃帷幕補齊
    const octZ = frontZ + recess;
    v.box(0, 1, octZ + 1, centerW, totalH, 2, 1);
    // 中央切角筒玻璃帷幕面
    v.box(0, 1 + lobbyH, octZ, centerW, totalH - lobbyH, 1, 2);
    // 兩側斜切過渡角之玻璃面
    for (let step = 1; step <= recess; step++) {
      const curZ = frontZ + step;
      const curX = Math.floor(centerW / 2) + step;
      mirrorX(v, curX, (vv, x) => {
        vv.box(x, 1 + lobbyH, curZ, 1, totalH - lobbyH, 1, 2);
      });
    }

    // 5. 兩翼向前延伸之正面玻璃帷幕面
    const wingW = Math.floor((totalW - centerW - recess * 2) / 2);
    const wingCenterX = Math.floor(totalW / 2) - Math.floor(wingW / 2);
    mirrorX(v, wingCenterX, (vv, wx) => {
      vv.box(wx, 1 + lobbyH, frontZ, wingW, totalH - lobbyH, 1, 2);
    });

    // 6. 正面垂直磁磚壁柱與樓層橫樑（形成嚴整方格帷幕網）
    // (a) 垂直深黑磁磚立柱
    const pillarSpacing = Math.max(3, Math.round(totalW * 0.16));
    const numPillars = Math.floor((totalW - 2) / pillarSpacing) + 1;
    rowOf(v, numPillars, pillarSpacing, (vv, px) => {
      // 依位置決定立柱深淺 z
      const absX = Math.abs(px);
      let pz = frontZ;
      if (absX < Math.floor(centerW / 2)) {
        pz = octZ;
      } else if (absX <= Math.floor(centerW / 2) + recess) {
        pz = frontZ + (absX - Math.floor(centerW / 2));
      }
      vv.box(px, 1 + lobbyH, pz - 1, 1, totalH - lobbyH, 1, 0);
    }, 0);

    // 外側轉角粗柱包覆
    mirrorX(v, Math.floor(totalW / 2), (vv, ex) => {
      vv.box(ex, 1, frontZ, 1, totalH, 2, 0);
    });

    // (b) 樓層橫樑分界線（橫向窗格分割條）
    const floorStep = Math.max(2, Math.round(totalH * 0.08));
    for (let fy = 1 + lobbyH + floorStep; fy < totalH; fy += floorStep) {
      // 兩翼橫樑
      mirrorX(v, wingCenterX, (vv, wx) => {
        vv.box(wx, fy, frontZ - 1, wingW, 1, 1, 0);
      });
      // 中央八角筒橫樑
      v.box(0, fy, octZ - 1, centerW, 1, 1, 0);
      // 斜切段橫樑
      for (let step = 1; step <= recess; step++) {
        mirrorX(v, Math.floor(centerW / 2) + step, (vv, sx) => {
          vv.box(sx, fy, frontZ + step - 1, 1, 1, 1, 0);
        });
      }
    }

    // 7. 側面立面細化：規律垂直立柱與長方窗格反覆排列
    const sideLen = totalD - 2;
    const sidePillars = Math.max(3, Math.floor(sideLen / 3));
    const sideStep = Math.floor(sideLen / sidePillars);
    mirrorX(v, Math.floor(totalW / 2), (vv, sx) => {
      // 側牆打底鋪設整面窗景
      vv.box(sx, 1 + lobbyH, 1, 1, totalH - lobbyH, sideLen, 2);
      // 垂直分線磁磚柱
      for (let i = 0; i <= sidePillars; i++) {
        const cz = -Math.floor(sideLen / 2) + 1 + i * sideStep;
        vv.box(sx, 1 + lobbyH, cz, 1, totalH - lobbyH, 1, 0);
      }
      // 側面各樓層橫樑分界
      for (let fy = 1 + lobbyH + floorStep; fy < totalH; fy += floorStep) {
        vv.box(sx, fy, 1, 1, 1, sideLen, 1);
      }
    });

    // 8. 一樓挑高大廳與入口設計
    // 大廳後退空間與玻璃大門
    v.box(0, 1, octZ, centerW + recess * 2, lobbyH, 1, 7);
    v.box(0, 1, octZ - 1, centerW, lobbyH, 1, 2);

    // 突出的深色鋼構雨遮（外挑向前延伸）
    const canopyW = centerW + 2;
    const canopyD = recess + 2;
    const canopyZ = octZ - Math.floor(canopyD / 2);
    v.box(0, lobbyH, canopyZ, canopyW, 1, canopyD, 0);
    v.box(0, lobbyH, canopyZ, canopyW - 2, 1, canopyD - 1, 7);

    // 入口柱廊支撐柱與迎賓階梯
    mirrorX(v, Math.floor(canopyW / 2) - 1, (vv, cx) => {
      vv.box(cx, 1, octZ - canopyD + 1, 1, lobbyH - 1, 1, 0);
    });
    stairs(v, 0, 0, octZ - canopyD - 1, 2, canopyW, '-z', 5);

    // 9. 一樓平整鮮紅銀行招牌橫額
    // 正立面視角（面向 -z）：右側即 +x 側
    // 招牌緊貼於右翼一樓挑高立面頂部，為連續平整長條紅色條帶
    const signW = wingW + 1;
    const signX = wingCenterX;
    const signY = lobbyH;
    // 平整長條鮮紅招牌板
    v.box(signX, signY, frontZ - 1, signW, 1, 1, 4);
    // 招牌下方深色大門與落地窗門面
    v.box(signX, 1, frontZ, signW, lobbyH - 1, 1, 7);
    v.box(signX, 1, frontZ, signW - 2, lobbyH - 2, 1, 2);
    // 招牌上的細緻商銀白色橫線與字樣微點綴（平整貼附，絕不凸出遮陽棚）
    for (let k = -Math.floor(signW / 2) + 1; k < Math.floor(signW / 2); k += 2) {
      tint(v, signX + k, signY, frontZ - 1, 3);
    }

    // 左翼（-x 側）一樓商業/車道入口
    v.box(-wingCenterX, 1, frontZ, wingW, lobbyH, 1, 0);
    v.box(-wingCenterX, 1, frontZ, wingW - 2, lobbyH - 1, 1, 7);

    // 10. 頂部深色退縮女兒牆與中央機房
    const roofY = 1 + totalH;
    // 頂層粗獷壓頂簷口
    v.box(0, roofY - 1, 0, totalW + 1, 1, totalD + 1, 0);
    // 女兒牆圍欄
    v.walls(0, roofY, 0, totalW, 2, totalD, 0, 1);

    // 頂樓核心機房與設備塔
    const equipW = Math.max(5, Math.floor(totalW * 0.45));
    const equipD = Math.max(5, Math.floor(totalD * 0.45));
    const equipH = dim(s, 0.45, 2);
    v.box(0, roofY, 0, equipW, equipH, equipD, 1);
    v.box(0, roofY + equipH, 0, equipW - 2, 1, equipD - 2, 0);

    // 11. 前庭景觀：綠化花台與挺拔行道樹
    // 門前兩側長條綠化灌木花台
    const curbZ = frontZ - 3;
    mirrorX(v, Math.floor(totalW * 0.36), (vv, fx) => {
      vv.box(fx, 0, curbZ, 4, 1, 2, 5); // 石材花台邊框
      vv.box(fx, 1, curbZ, 3, 1, 1, 6); // 修剪平整之矮綠灌木
    });

    // 參考圖前方的茂密大型行道樹（偏左側，不遮擋右側鮮紅銀行招牌）
    const treeX = -Math.floor(totalW * 0.18);
    const treeZ = frontZ - 4;
    const trunkH = dim(s, 0.5, 3);
    const crownR = Math.max(1.8, s * 0.24);
    v.cyl(treeX, 1, treeZ, 0.6, trunkH, 0);
    blob(v, treeX, 1 + trunkH + Math.round(crownR * 0.7), treeZ, crownR * 1.3, crownR * 1.0, crownR * 1.1, 6);
  }
});