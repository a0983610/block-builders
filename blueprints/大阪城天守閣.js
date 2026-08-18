// 檔名：大阪城天守閣.js
customBlueprint({
  name: '大阪城天守閣',
  pal: [
    '#6c645c', // 0 石垣（石基）
    '#f6f4ee', // 1 白漆牆壁（白喰漆）
    '#428070', // 2 銅綠屋瓦
    '#252527', // 3 頂層黑漆牆壁／暗木簷線／窗框
    '#d9a738', // 4 金箔雕飾、金鯱、金虎
    '#394f48'  // 5 連子窗格子（深綠灰）
  ],
  lo: 2.2, hi: 15.5,

  gen(v, s) {
    // -------------------------------------------------------------
    // 1. 石垣（傾斜中空石基座）
    // -------------------------------------------------------------
    const bw = dim(s, 2.7, 13, true);
    const bd = dim(s, 2.3, 11, true);
    const bh = dim(s, 1.2, 4);

    // 外殼式石垣（避免實心吃塊數）
    for (let y = 0; y <= bh; y++) {
      const step = Math.floor((bh - y) * 0.45);
      const w = bw + 2 - step * 2;
      const d = bd + 2 - step * 2;
      if (y === 0 || y === bh) {
        v.box(0, y, 0, w, 1, d, 0);
      } else {
        v.walls(0, y, 0, w, 1, d, 0, 1);
      }
    }

    // -------------------------------------------------------------
    // 2. 第一層（入母屋下層白牆 + 四周出簷）
    // -------------------------------------------------------------
    let curY = bh + 1;
    const l1_w = dim(s, 2.3, 11, true);
    const l1_d = dim(s, 1.9, 9, true);
    const l1_h = dim(s, 0.9, 3);

    // 白牆
    v.walls(0, curY, 0, l1_w, l1_h, l1_d, 1, 1);
    // 連子窗
    windowGrid(v, { x: 0, y: curY + 1, z: -Math.floor(l1_d / 2), cols: dim(s, 0.45, 3, true), rows: 1, stepX: 2, w: 1, h: 1, c: 5, axis: 'x' });
    mirrorX(v, Math.floor(l1_w / 2), (vv, dx) => {
      windowGrid(vv, { x: dx, y: curY + 1, z: 0, cols: dim(s, 0.35, 2), rows: 1, stepX: 2, w: 1, h: 1, c: 5, axis: 'z' });
    });
    curY += l1_h;

    // 第一層屋簷（帶正面小千鳥破風）
    v.eave(0, curY, 0, l1_w + 2, l1_d + 2, 3, 1);
    hipRoof(v, 0, curY + 1, 0, l1_w + 4, l1_d + 4, 2);
    const g1_w = dim(s, 0.9, 5, true);
    v.gable(0, curY + 1, -Math.floor(l1_d / 2) - 1, g1_w, 3, 2);
    v.box(0, curY + 1, -Math.floor(l1_d / 2), g1_w - 2, 1, 1, 1);
    tint(v, 0, curY + 2, -Math.floor(l1_d / 2) - 1, 4); // 破風金懸魚
    curY += 2;

    // -------------------------------------------------------------
    // 3. 第二層（白牆 + 正面大千鳥破風與兩側破風）
    // -------------------------------------------------------------
    const l2_w = dim(s, 1.9, 9, true);
    const l2_d = dim(s, 1.6, 7, true);
    const l2_h = dim(s, 0.8, 3);

    v.walls(0, curY, 0, l2_w, l2_h, l2_d, 1, 1);
    windowGrid(v, { x: 0, y: curY + 1, z: -Math.floor(l2_d / 2), cols: dim(s, 0.4, 3, true), rows: 1, stepX: 2, w: 1, h: 1, c: 5, axis: 'x' });
    curY += l2_h;

    // 第二層大型千鳥破風 + 四坡簷
    v.eave(0, curY, 0, l2_w + 2, l2_d + 2, 3, 1);
    hipRoof(v, 0, curY + 1, 0, l2_w + 4, l2_d + 4, 2);
    const g2_w = dim(s, 1.2, 7, true);
    v.gable(0, curY + 1, -Math.floor(l2_d / 2) - 1, g2_w, 4, 2);
    v.box(0, curY + 1, -Math.floor(l2_d / 2), g2_w - 2, 2, 1, 1);
    // 金色懸魚裝飾與窗洞
    tint(v, 0, curY + 3, -Math.floor(l2_d / 2) - 1, 4);
    tint(v, 0, curY + 2, -Math.floor(l2_d / 2), 5);
    curY += 2;

    // -------------------------------------------------------------
    // 4. 第三層（腰簷白牆 + 唐破風造型）
    // -------------------------------------------------------------
    const l3_w = dim(s, 1.5, 7, true);
    const l3_d = dim(s, 1.3, 5, true);
    const l3_h = dim(s, 0.7, 3);

    v.walls(0, curY, 0, l3_w, l3_h, l3_d, 1, 1);
    windowGrid(v, { x: 0, y: curY + 1, z: -Math.floor(l3_d / 2), cols: 2, rows: 1, stepX: 2, w: 1, h: 1, c: 5, axis: 'x' });
    curY += l3_h;

    // 第三層屋簷
    v.eave(0, curY, 0, l3_w + 2, l3_d + 2, 3, 1);
    hipRoof(v, 0, curY + 1, 0, l3_w + 3, l3_d + 3, 2);
    // 正面小唐破風（拱狀簷飾）
    v.box(0, curY + 2, -Math.floor(l3_d / 2) - 1, 3, 1, 1, 2);
    v.box(0, curY + 1, -Math.floor(l3_d / 2) - 1, 5, 1, 1, 2);
    tint(v, 0, curY + 2, -Math.floor(l3_d / 2) - 1, 4);
    curY += 2;

    // -------------------------------------------------------------
    // 5. 頂層（黑漆金箔望樓 + 迴廊高欄）
    // -------------------------------------------------------------
    const top_w = dim(s, 1.2, 5, true);
    const top_d = dim(s, 1.0, 5, true);
    const top_h = dim(s, 0.9, 3);

    // 迴廊（走道基座）
    v.box(0, curY, 0, top_w + 2, 1, top_d + 2, 3);
    // 迴廊圍欄
    v.walls(0, curY + 1, 0, top_w + 2, 1, top_d + 2, 4, 1);
    v.carve(0, curY + 1, 0, top_w, 1, top_d); // 保持走道空通

    // 黑漆望樓主牆
    v.walls(0, curY + 1, 0, top_w, top_h, top_d, 3, 1);

    // 金虎浮雕裝飾（外牆金色浮雕橫帶）
    mirrorZ(v, Math.floor(top_d / 2), (vv, dz) => {
      vv.box(0, curY + 2, dz, Math.max(1, top_w - 2), 1, 1, 4);
    });
    mirrorX(v, Math.floor(top_w / 2), (vv, dx) => {
      vv.box(dx, curY + 2, 0, 1, 1, Math.max(1, top_d - 2), 4);
    });

    // 頂層望樓連子窗
    windowGrid(v, { x: 0, y: curY + 2, z: -Math.floor(top_d / 2), cols: 2, rows: 1, stepX: 2, w: 1, h: 1, c: 5, axis: 'x' });
    curY += top_h + 1;

    // -------------------------------------------------------------
    // 6. 頂層歇山式大屋頂 + 飛翹簷角 + 屋脊金鯱
    // -------------------------------------------------------------
    const r_w = top_w + 2;
    const r_d = top_d + 2;
    const rh = dim(s, 0.9, 3);

    // 歇山頂底簷
    v.eave(0, curY, 0, r_w, r_d, 3, 1);
    hipRoof(v, 0, curY + 1, 0, r_w + 2, r_d + 2, 2);

    // 主屋脊
    const ridgeY = curY + 1 + rh;
    const ridgeLen = Math.max(3, r_w - rh);
    v.box(0, ridgeY, 0, ridgeLen, 1, 1, 2);
    v.box(0, ridgeY + 1, 0, ridgeLen - 2, 1, 1, 4); // 頂脊金邊

    // 屋脊兩端金鯱（立體大金鯱）
    const shachiX = Math.floor(ridgeLen / 2);
    mirrorX(v, shachiX, (vv, dx) => {
      vv.box(dx, ridgeY, 0, 1, 2, 1, 4);
      vv.box(dx > 0 ? dx + 1 : dx - 1, ridgeY + 1, 0, 1, 2, 1, 4); // 向上微彎的魚尾
    });

    // 屋簷四角飛翹微調（古建築飛簷感）
    corners4(v, Math.floor((r_w + 1) / 2), Math.floor((r_d + 1) / 2), (vv, cx, cz) => {
      vv.set(cx, curY + 2, cz, 4);
    });
  }
});
