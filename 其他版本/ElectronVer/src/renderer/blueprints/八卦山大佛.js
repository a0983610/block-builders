// 檔名：八卦山大佛.js
/* 彰化八卦山大佛（修正版）
   1. 台基與蓮座：玄黑石階底座、中空金黃蓮台、朱紅底緣、一圈透光圓窗、頂部翠綠葉緣。
   2. 結跏趺坐下身：寬穩大跨度盤腿、兩側飽滿膝部、正面交疊衣褶。
   3. 寬厚身軀：厚實胸膛、寬闊平直肩膀、胸前袒領（膚色亮部）。
   4. 雙臂與禪定印：自雙肩垂下的厚實雙臂、前臂環抱、腹前相疊平放之手印與拇指。
   5. 慈悲佛首與垂耳：方圓端莊佛面、雙側垂肩長耳、眉心白毫（朱紅）、慈目與佛鼻。
   6. 肉髻與螺髮：頭頂隆起之玄黑肉髻、頂髻寶珠、頭側螺髮。
   7. 前庭綠銅香爐：座前經典寶塔青銅香爐。 */
customBlueprint({
  name: '八卦山大佛',
  pal: [
    '#523c34', // 0 佛身與袈裟主色（古銅深褐）
    '#8c6653', // 1 袒胸、面部亮部與手印（暖褐膚色）
    '#d8a228', // 2 蓮花寶座（金黃）
    '#2b663b', // 3 蓮台葉緣與香爐（翠綠）
    '#a6281e', // 4 蓮座底緣描邊、白毫與頂珠（朱紅）
    '#201b19'  // 5 石階台基、螺髮、五官與圓窗（玄黑）
  ],
  lo: 2.2, hi: 15.0,

  gen(v, s) {
    // ── 1. 石階台基與中空蓮花座 ───────────────────────────
    const br = dim(s, 1.25, 6);                     // 底座半徑
    const bh = dim(s, 0.20, 1);                     // 台基厚度
    v.cyl(0, 0, 0, br + 1, bh, 5);                  // 最底層玄黑石階

    const lr = dim(s, 1.15, 5);                     // 蓮座半徑
    const lh = dim(s, 0.55, 3);                     // 蓮座高
    const lWall = Math.max(1, Math.round(lr * 0.35));
    v.cyl(0, bh, 0, lr, lh, 2, lWall);              // 金黃蓮座（中空，保留積木給大佛）

    // 蓮瓣下緣朱紅描邊
    v.cyl(0, bh, 0, lr + 0.5, 1, 4, 1);

    // 蓮座身一圈圓形黑窗
    ringOf(v, 8, lr - 0.2, (vv, wx, wz) => {
      vv.box(Math.round(wx), bh + Math.round(lh * 0.4), Math.round(wz), 1, 1, 1, 5);
    });

    // 蓮座頂部翠綠葉緣與封頂台面
    v.cyl(0, bh + lh, 0, lr + 0.5, 1, 3);           // 翠綠葉緣
    v.cyl(0, bh + lh + 1, 0, lr - 0.5, 1, 2);       // 金黃台面

    const seatY = bh + lh + 2;                      // 佛身起始高度

    // ── 2. 結跏趺坐（大跨度盤腿下盤） ─────────────────────
    const kw = dim(s, 1.85, 9, true);               // 盤腿總寬（膝到膝，極寬穩）
    const kd = dim(s, 1.25, 6);                     // 盤腿深度
    const kh = dim(s, 0.40, 2);                     // 盤腿厚度

    v.box(0, seatY, 0, kw - 2, kh, kd, 0);          // 腿盤主體
    // 兩側雙膝圓弧收邊
    mirrorX(v, (kw - 1) / 2, (vv, x) => {
      vv.box(x, seatY, 0, 1, kh, Math.max(2, kd - 2), 0);
    });
    // 正面雙足與交疊衣褶
    v.box(0, seatY, -Math.round(kd / 2) + 1, dim(s, 0.65, 3, true), kh, 2, 0);

    // ── 3. 寬厚身軀與寬肩 ─────────────────────────────────
    const tw = dim(s, 1.15, 5, true);               // 腰胸寬
    const th = dim(s, 1.10, 5);                     // 軀幹高
    const td = dim(s, 0.75, 4);                     // 軀幹厚度
    const shw = dim(s, 1.65, 7, true);              // 寬肩跨度

    v.box(0, seatY + kh, 0, tw, th, td, 0);         // 軀幹本體

    // 寬闊肩膀
    const shy = seatY + kh + th - 2;
    v.box(0, shy, 0, shw, 2, td, 0);

    // 袒胸領口（暖褐亮部膚色）
    const chestZ = -Math.round(td / 2);
    v.box(0, shy, chestZ, dim(s, 0.35, 1, true), 2, 1, 1);

    // ── 4. 雙臂與腹前禪定印 ───────────────────────────────
    // 上臂自雙肩垂下
    mirrorX(v, (shw - 1) / 2, (vv, ax) => {
      vv.box(ax, seatY + kh + 1, 0, 1, th - 1, td - 1, 0);
    });

    // 前臂往前環抱
    const armInX = Math.round(tw * 0.45);
    mirrorX(v, armInX, (vv, fx) => {
      vv.box(fx, seatY + kh, -Math.round(td * 0.4), 1, 1, dim(s, 0.35, 2), 0);
    });

    // 腹前雙手相疊手印（禪定印）
    const handZ = -Math.round(td * 0.4) - 1;
    v.box(0, seatY + kh, handZ, dim(s, 0.55, 3, true), 1, 2, 1);
    v.box(0, seatY + kh + 1, handZ, 1, 1, 1, 1);    // 拇指相觸

    // ── 5. 佛首、五官與垂肩長耳 ───────────────────────────
    const hy = seatY + kh + th;                     // 頭部起始高度
    const hw = dim(s, 0.70, 3, true);               // 頭寬
    const hh = dim(s, 0.85, 4);                     // 頭高
    const hd = dim(s, 0.65, 3);                     // 頭深

    v.box(0, hy, 0, hw, hh, hd, 0);                 // 佛首本體

    const fz = -Math.round(hd / 2);                 // 面部所在 Z 平面

    // 雙側垂肩長耳（大佛標誌性特徵）
    mirrorX(v, (hw + 1) / 2, (vv, ex) => {
      vv.box(ex, hy - 1, 0, 1, hh + 1, 1, 0);
    });

    // 眉心白毫（朱紅）
    tint(v, 0, hy + hh - 2, fz, 4);

    // 慈目（玄黑微閉）
    if (hw >= 3) {
      mirrorX(v, 1, (vv, mx) => tint(vv, mx, hy + hh - 3, fz, 5));
    }

    // 佛鼻（亮部）與慈唇（暗線）
    tint(v, 0, hy + hh - 3, fz, 1);
    tint(v, 0, hy + hh - 4, fz, 5);

    // ── 6. 肉髻、頂珠與螺髮 ───────────────────────────────
    const ushY = hy + hh;
    const ushH = Math.max(1, Math.round(hh * 0.35));
    v.box(0, ushY, 0, Math.max(1, hw - 1), ushH, Math.max(1, hd - 1), 5); // 玄黑肉髻
    v.box(0, ushY + ushH, 0, 1, 1, 1, 4);                                  // 頂髻寶珠（朱紅）

    // 髮線螺髮（頂部四周黑化）
    mirrorX(v, (hw - 1) / 2, (vv, x) => tint(vv, x, ushY - 1, fz, 5));

    // ── 7. 前庭青銅寶塔香爐 ───────────────────────────────
    const burnerZ = -Math.round(br + dim(s, 0.25, 1));
    const burnerH = dim(s, 0.50, 3);
    v.box(0, 0, burnerZ, 1, burnerH, 1, 5);         // 爐柱
    v.box(0, burnerH, burnerZ, dim(s, 0.35, 3, true), 1, dim(s, 0.35, 3), 3); // 寶塔簷口
    v.set(0, burnerH + 1, burnerZ, 3);              // 塔尖
  }
});
