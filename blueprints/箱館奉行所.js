/* 積木小人 · 匯出的藍圖（箱館奉行所）
   用法二選一：放進 blueprints/ 並把檔名加進 list.js，
   或在遊戲裡按「📥 匯入建築」把整份貼進去。 */

// 檔名：箱館奉行所.js
customBlueprint({
  name: '箱館奉行所',
  pal: [
    '#dfd7c6', // 0 白漆喰牆面（主體上段）
    '#3e3228', // 1 深色下見板張（基座與下段外牆）
    '#9c6e42', // 2 原木柱、樑柱骨架、格柵與簷底
    '#4e3b3e', // 3 和風紅褐／黑瓦屋頂
    '#252022', // 4 屋脊、鬼瓦與頂飾深色收邊
    '#f4f0e6', // 5 障子拉門／紙窗
    '#827c73', // 6 台基石階與石造水井座
    '#d6a543'  // 7 破風懸魚金飾與銅件
  ],
  lo: 2.2, hi: 14.5,

  gen(v, s) {
    // === 尺寸計算 ===
    // 主殿（大廣間／書院造量體）
    const mw = dim(s, 2.60, 13, true);  // 主建築寬度（奇數便於中脊對齊）
    const md = dim(s, 1.90, 9, true);   // 主建築深度
    const mh = dim(s, 0.95, 4);         // 牆體高度

    // 1. 石台基與基礎
    v.box(0, 0, 0, mw + 2, 1, md + 2, 6);

    // 2. 主殿牆體（下段深色板壁，上段白漆喰）
    const halfH = Math.max(1, Math.floor(mh / 2));
    v.walls(0, 1, 0, mw, halfH, md, 1, 1);
    v.walls(0, 1 + halfH, 0, mw, mh - halfH, md, 0, 1);

    // 原木橫樑壓頂分界線
    v.box(0, 1 + mh, 0, mw + 1, 1, md + 1, 2);

    // 柱廊與外牆木柱立面（四周立柱裝飾）
    const postStep = Math.max(3, Math.round(dim(s, 0.65, 3)));
    const halfW = Math.floor(mw / 2);
    const halfD = Math.floor(md / 2);
    for (let x = -halfW; x <= halfW; x += postStep) {
      v.box(x, 1, -halfD, 1, mh, 1, 2);
      v.box(x, 1, halfD, 1, mh, 1, 2);
    }
    for (let z = -halfD; z <= halfD; z += postStep) {
      v.box(-halfW, 1, z, 1, mh, 1, 2);
      v.box(halfW, 1, z, 1, mh, 1, 2);
    }

    // 3. 正面開口與障子門窗（白拉門 + 木格柵）
    const winW = dim(s, 0.45, 2);
    const winH = Math.max(2, mh - 1);
    // 正面窗格
    v.box(-Math.round(halfW * 0.45), 1, -halfD, winW, winH, 1, 5);
    v.box(Math.round(halfW * 0.45), 1, -halfD, winW, winH, 1, 5);
    // 窗框原木細節
    v.box(-Math.round(halfW * 0.45), 1, -halfD, 1, winH, 1, 2);
    v.box(Math.round(halfW * 0.45), 1, -halfD, 1, winH, 1, 2);

    // 4. 左側玄關／式台（突出量體、千鳥／切妻破風與向拜）
    const gw = dim(s, 0.90, 5, true);
    const gd = dim(s, 0.70, 4);
    const gh = Math.max(3, mh - 1);
    const gx = -Math.round(halfW * 0.35);
    const gz = -halfD - Math.floor(gd / 2);

    // 玄關台基與地面式台木地板
    v.box(gx, 0, gz, gw + 2, 1, gd + 2, 6);
    v.box(gx, 1, gz, gw, 1, gd, 2);
    // 玄關障子門與木隔扇
    v.box(gx, 2, -halfD, Math.max(3, gw - 2), gh - 1, 1, 5);
    v.box(gx, 2, -halfD, 1, gh - 1, 1, 2);

    // 玄關前柱（左右木柱）
    const gColZ = -halfD - gd;
    v.box(gx - Math.floor(gw / 2), 1, gColZ, 1, gh, 1, 2);
    v.box(gx + Math.floor(gw / 2), 1, gColZ, 1, gh, 1, 2);
    // 柱頭貫木橫樑
    v.box(gx, 1 + gh, gColZ, gw + 2, 1, 1, 2);

    // 玄關精緻切妻屋頂與屋簷
    v.eave(gx, 1 + gh, gz, gw + 2, gd + 2, 3, 1);
    v.gable(gx, 2 + gh, gz, gw + 2, gd + 2, 3);
    // 玄關破風金飾（懸魚）
    v.box(gx, 2 + gh, gColZ - 1, 1, 1, 1, 7);

    // 5. 右側大車寄（寬敞的接引向拜長廊屋簷）
    const kw = dim(s, 1.20, 7, true);
    const kd = dim(s, 0.85, 4);
    const kx = Math.round(halfW * 0.42);
    const kz = -halfD - Math.floor(kd / 2);
    const kColZ = -halfD - kd;

    // 車寄基座與多根支撐列柱
    v.box(kx, 0, kz, kw + 2, 1, kd + 2, 6);
    const numKCols = 3;
    const kStep = Math.floor(kw / (numKCols - 1));
    for (let i = 0; i < numKCols; i++) {
      const cx = kx - Math.floor(kw / 2) + i * kStep;
      v.box(cx, 1, kColZ, 1, gh, 1, 2);
    }
    // 車寄大樑與寬披簷
    v.box(kx, 1 + gh, kColZ, kw + 2, 1, 1, 2);
    v.eave(kx, 1 + gh, kz, kw + 4, kd + 3, 3, 1);
    v.gable(kx, 2 + gh, kz, kw + 2, kd + 2, 3);

    // 6. 主建築宏偉入母屋大屋頂（四坡轉雙坡屋脊）
    const ry = 2 + mh;
    // 下層大屋簷出挑
    v.eave(0, ry, 0, mw + 4, md + 4, 3, 1);
    // 四坡大屋頂主體
    const roofH = dim(s, 0.75, 4);
    hipRoof(v, 0, ry + 1, 0, mw + 2, md + 2, 3);

    // 主屋脊（黑瓦大脊與鬼瓦）
    const ridgeY = ry + roofH;
    const ridgeL = Math.max(5, mw - roofH * 2);
    v.box(0, ridgeY, 0, ridgeL, 1, 2, 4);
    // 兩端大鬼瓦
    v.box(-Math.floor(ridgeL / 2), ridgeY + 1, 0, 1, 1, 2, 4);
    v.box(Math.floor(ridgeL / 2), ridgeY + 1, 0, 1, 1, 2, 4);

    // 7. 屋頂中央標誌性太鼓櫓（望樓／天守式鐘鼓閣）
    const tw = dim(s, 0.65, 5, true);
    const td = dim(s, 0.60, 5, true);
    const th = dim(s, 0.65, 3);
    const ty = ridgeY - 1;

    // 櫓閣基座收斜木裙板
    v.box(0, ty, 0, tw + 2, 1, td + 2, 1);
    // 櫓閣白漆喰牆身與窗櫺
    v.walls(0, ty + 1, 0, tw, th, td, 0, 1);
    v.box(0, ty + 2, -Math.floor(td / 2), Math.max(1, tw - 2), 1, 1, 2);
    v.box(0, ty + 2, Math.floor(td / 2), Math.max(1, tw - 2), 1, 1, 2);

    // 櫓閣屋簷與四坡尖錐頂
    v.eave(0, ty + 1 + th, 0, tw + 2, td + 2, 3, 1);
    hipRoof(v, 0, ty + 2 + th, 0, tw + 2, td + 2, 3);
    // 望樓頂部相輪寶珠脊飾
    v.box(0, ty + 4 + th, 0, 1, 2, 1, 4);

    // 8. 附屬前庭石水槽（洗手舍／水井景觀座）
    const wellX = Math.round(halfW * 0.18);
    const wellZ = -halfD - kd - 2;
    v.box(wellX, 0, wellZ, 3, 1, 3, 6);
    v.box(wellX, 1, wellZ, 3, 1, 3, 1);
    v.carve(wellX, 1, wellZ, 1, 1, 1);

    // 9. 正面石階（玄關門前階梯）
    const stepCount = dim(s, 0.22, 2);
    stairs(v, gx, 0, -halfD - gd - 1, stepCount, Math.max(3, gw - 2), '-z', 6);
  }
});
