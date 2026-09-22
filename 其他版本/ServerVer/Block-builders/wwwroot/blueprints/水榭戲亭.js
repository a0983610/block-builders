/* 積木小人 · 匯出的藍圖（水榭戲亭）
   用法二選一：放進 blueprints/ 並把檔名加進 list.js，
   或在遊戲裡按「📥 匯入建築」把整份貼進去。 */

// 檔名：水榭戲亭.js
customBlueprint({
  name: '水榭戲亭',
  pal: [
    '#5c4a3e', // 0 深木柱、樑架、屋架
    '#877d73', // 1 水中石基座、石階
    '#3a3c42', // 2 黑灰筒瓦屋頂、脊飾
    '#2d7a6e', // 3 綠釉欄杆、雕花雀替、青綠門窗櫺
    '#ded7c8', // 4 白粉牆、屏門底板
    '#a83e36'  // 5 朱紅匾額、木桌供桌、點綴
  ],
  lo: 2.2, hi: 15.0,

  gen(v, s) {
    // 1. 基本尺度計算（全參數化）
    const pw = dim(s, 2.2, 7, true);   // 亭子寬度
    const pd = dim(s, 2.0, 7, true);   // 亭子深度
    const ph = dim(s, 1.8, 6);         // 亭柱與空間高
    const rbase = dim(s, 0.4, 2);      // 水台基座高度
    const colR = Math.max(1, Math.round(s * 0.1)); // 柱半徑

    // 2. 水中石台基座（含前伸親水平台）
    const deckD = dim(s, 0.9, 3);      // 前凸露台深度
    v.box(0, 0, 0, pw + 2, rbase, pd + 2, 1);
    v.box(0, 0, Math.round((pd + deckD) / 2), pw, rbase, deckD, 1);

    // 3. 親水露台的綠色欄杆（左右與正面開口）
    const ry = rbase;
    const frontZ = Math.round(pd / 2) + deckD;
    const halfW = (pw - 1) / 2;
    // 兩側欄杆
    mirrorX(v, halfW, (vv, dx) => {
      vv.box(dx, ry, Math.round(pd / 2 + deckD / 2), 1, 2, deckD + 1, 3);
    });
    // 前方望柱與欄杆（中央留出通透視野）
    mirrorX(v, halfW, (vv, dx) => {
      vv.box(dx, ry, frontZ, 1, 3, 1, 3); // 角落望柱稍高
    });
    mirrorX(v, Math.round(halfW * 0.6), (vv, dx) => {
      vv.box(dx, ry, frontZ, Math.max(1, Math.round(halfW * 0.4)), 2, 1, 3);
    });

    // 4. 四根深木主柱
    const colX = (pw - 1) / 2;
    const colZ = (pd - 1) / 2;
    corners4(v, colX, colZ, (vv, x, z) => {
      vv.cyl(x, ry, z, colR, ph, 0);
    });

    // 5. 柱頭彩繪雀替（角隅斜撐）
    corners4(v, colX, colZ, (vv, x, z) => {
      const sx = x > 0 ? -1 : 1;
      const sz = z > 0 ? -1 : 1;
      vv.box(x + sx, ry + ph - 1, z, 1, 1, 1, 3);
      vv.box(x, ry + ph - 1, z + sz, 1, 1, 1, 3);
    });

    // 6. 後方隔斷屏風牆與格扇門（古建戲亭的「出將」「入相」門與中央八卦/圓窗屏風）
    const backZ = -colZ;
    v.box(0, ry, backZ, pw - 2, ph - 1, 1, 4); // 白牆底色
    // 中央格扇花窗（青綠色）
    const winW = dim(s, 0.8, 3, true);
    const winH = dim(s, 0.9, 3);
    const winY = ry + Math.round(ph * 0.25);
    v.box(0, winY, backZ, winW, winH, 1, 3);
    v.box(0, winY + 1, backZ, Math.max(1, winW - 2), Math.max(1, winH - 2), 1, 4); // 窗櫺中空
    // 兩側出將、入相朱紅門楣/木門
    mirrorX(v, Math.round(colX * 0.65), (vv, dx) => {
      vv.box(dx, ry, backZ, dim(s, 0.4, 1), Math.round(ph * 0.7), 1, 0);
      vv.box(dx, ry + Math.round(ph * 0.75), backZ, dim(s, 0.45, 2, true), 1, 1, 5); // 紅色門楣題字
    });
    // 亭內一張紅色供桌/茶几
    v.box(0, ry, -Math.round(colZ * 0.3), dim(s, 0.6, 2, true), Math.max(1, Math.round(ph * 0.3)), 2, 5);

    // 7. 額枋、樑架與屋簷分界（深木色）
    const beamY = ry + ph;
    v.box(0, beamY, 0, pw + 2, 1, pd + 2, 0);

    // 8. 歇山飛簷與黑灰筒瓦屋頂
    // 一圈挑出的大屋簷（四角起翹）
    const eaveW = pw + 4;
    const eaveD = pd + 4;
    v.box(0, beamY + 1, 0, eaveW, 1, eaveD, 2);
    // 簷角微翹
    corners4(v, (eaveW - 1) / 2, (eaveD - 1) / 2, (vv, x, z) => {
      vv.box(x, beamY + 2, z, 1, 1, 1, 2);
    });

    // 歇山頂主體收縮
    const roofH = dim(s, 0.75, 3);
    hipRoof(v, 0, beamY + 2, 0, eaveW - 1, eaveD - 1, 2);

    // 正脊與脊獸裝飾
    const ridgeY = beamY + 2 + roofH;
    const ridgeL = Math.max(3, eaveD - roofH * 2);
    v.box(0, ridgeY, 0, 1, 1, ridgeL, 2);
    // 正脊兩端鴟吻/翹頭
    mirrorZ(v, (ridgeL - 1) / 2, (vv, dz) => {
      vv.box(0, ridgeY + 1, dz, 1, 1, 1, 2);
    });

    // 9. 後方延伸的園林遊廊（長廊白牆、青綠木櫺、瓦頂）
    const corrLen = dim(s, 1.8, 6);
    const corrY = ry;
    const corrH = Math.max(3, ph - 2);
    mirrorX(v, Math.round((pw + corrLen) / 2), (vv, dx) => {
      // 廊道後白牆
      vv.box(dx, corrY, backZ, corrLen, corrH, 1, 4);
      // 廊下青綠欄杆與柱子
      vv.box(dx, corrY, backZ + 2, corrLen, 1, 1, 3);
      vv.box(dx, corrY + 1, backZ + 2, corrLen, 1, 1, 4);
      // 廊頂黑瓦雨遮
      vv.box(dx, corrY + corrH, backZ + 1, corrLen, 1, 4, 2);
    });
  }
});
