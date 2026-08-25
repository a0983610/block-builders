/* 積木小人 · 匯出的藍圖（傳統孔廟建築群）
   用法二選一：放進 blueprints/ 並把檔名加進 list.js，
   或在遊戲裡按「📥 匯入建築」把整份貼進去。 */

// 檔名：孔廟建築群.js
customBlueprint({
  name: '傳統孔廟建築群',
  pal: [
    '#c4baa6', // 0 鋪石庭院、石階、丹墀台基
    '#ad3e2b', // 1 閩南紅磚牆面、紅地磚走道
    '#c84e2e', // 2 歇山頂與廡房紅瓦屋頂
    '#462719', // 3 檐柱、深色木質欞門與梁柱
    '#eae3d2', // 4 欞星門欞條、隔扇白牆
    '#686b6e', // 5 丹墀石欄杆、屋脊灰泥泥塑
    '#d69c3d'  // 6 屋脊剪黏、脊頂寶頂飾點
  ],
  lo: 2.2,
  hi: 13.5,

  gen(v, s) {
    // 總體平面尺度計算
    const yardW = dim(s, 3.8, 17, true);   // 庭院寬（奇數以利中軸對稱）
    const yardD = dim(s, 5.0, 23);         // 庭院總進深
    const pW = yardW + 2, pD = yardD + 2;

    // 0. 大庭院基底與外圍走道鋪面
    v.box(0, 0, 0, pW, 1, pD, 1);
    v.box(0, 0, 0, yardW - 4, 1, yardD - 4, 0);

    // 1. 中軸主要建築：大成殿（主殿）
    const mw = dim(s, 1.4, 7, true);      // 主殿面寬
    const md = dim(s, 1.2, 7);            // 主殿進深
    const mh = dim(s, 0.9, 4);            // 主殿柱高/牆高
    const mz = dim(s, 0.8, 3);            // 主殿 z 軸位置（偏後方）

    // 丹墀（月台：主殿前方突出的石造祭祀台基）
    const tw = mw + dim(s, 0.4, 2, true);
    const td = dim(s, 0.9, 4);
    const tz = mz - Math.round((md + td) / 2);
    v.box(0, 1, tz, tw, 1, td, 0);
    v.box(0, 1, mz, mw + 2, 1, md + 2, 0);

    // 丹墀四周石欄杆與前階梯
    v.box(0, 2, tz - Math.round(td / 2), tw, 1, 1, 5);
    mirrorX(v, Math.round(tw / 2), (vv, dx) => {
      vv.box(dx, 2, tz, 1, 1, td, 5);
    });
    const stairW = dim(s, 0.5, 3, true);
    stairs(v, 0, 0, tz - Math.round(td / 2) - 1, 1, stairW, '-z', 0);

    // 主殿殿身（立柱與紅牆）
    v.walls(0, 2, mz, mw, mh, md, 1, 1);
    mirrorX(v, Math.round((mw - 1) / 2), (vv, dx) => {
      vv.box(dx, 2, mz, 1, mh, md, 3);
    });
    // 正面朱紅大門與欞窗
    v.box(0, 2, mz - Math.round(md / 2), Math.max(1, mw - 4), mh - 1, 1, 3);

    // 主殿重簷歇山屋頂（下層副簷 + 上層主屋頂）
    v.eave(0, 2 + mh, mz, mw + 2, md + 2, 2, 1);
    v.box(0, 3 + mh, mz, mw - 2, 1, md - 2, 1);
    hipRoof(v, 0, 4 + mh, mz, mw + 2, md + 2, 2);
    // 正脊與鴟尾脊飾
    const ridgeH = 4 + mh + Math.round((md + 2) / 2);
    v.box(0, ridgeH, mz, mw - 2, 1, 1, 5);
    mirrorX(v, Math.round((mw - 3) / 2), (vv, dx) => {
      vv.box(dx, ridgeH + 1, mz, 1, 1, 1, 6);
    });

    // 2. 東西兩廡（左右兩側長條形廂房）
    const wingW = dim(s, 0.6, 3, true);
    const wingD = dim(s, 2.8, 11);
    const wingH = dim(s, 0.65, 3);
    const wingX = Math.round((yardW - wingW) / 2) - 1;
    const wingZ = mz - Math.round(wingD / 4);

    mirrorX(v, wingX, (vv, dx) => {
      // 廡房台基與牆身
      vv.box(dx, 1, wingZ, wingW, 1, wingD, 0);
      vv.walls(dx, 2, wingZ, wingW, wingH, wingD, 1, 1);
      // 外側廊柱（朝向庭院一側）
      const inwardX = dx > 0 ? dx - Math.round((wingW - 1) / 2) : dx + Math.round((wingW - 1) / 2);
      const cols = dim(s, 0.6, 3);
      const stepZ = Math.max(2, Math.round(wingD / cols));
      for (let i = 0; i < cols; i++) {
        const cz = wingZ - Math.round(wingD / 2) + 1 + i * stepZ;
        vv.box(inwardX, 2, cz, 1, wingH, 1, 3);
      }
      // 廡房硬山雙坡屋頂
      v.gable(dx, 2 + wingH, wingZ, wingW + 2, wingD + 2, 2);
      v.box(dx, 2 + wingH + Math.round((wingW + 2) / 2), wingZ, 1, 1, wingD + 2, 5);
    });

    // 3. 前殿 / 大成門（三川殿式正面門樓）
    const gateW = dim(s, 1.3, 7, true);
    const gateD = dim(s, 0.7, 3);
    const gateH = dim(s, 0.75, 3);
    const gateZ = -Math.round(yardD / 2) + Math.round(gateD / 2) + 2;

    v.box(0, 1, gateZ, gateW + 2, 1, gateD + 2, 0);
    v.walls(0, 2, gateZ, gateW, gateH, gateD, 1, 1);

    // 三川中門與左右次門
    const doorW = dim(s, 0.35, 1, true);
    v.carve(0, 2, gateZ, doorW, gateH - 1, gateD + 2);
    v.box(0, 2, gateZ, doorW, gateH - 1, 1, 3);
    mirrorX(v, Math.round((gateW - doorW) / 3), (vv, dx) => {
      vv.carve(dx, 2, gateZ, 1, gateH - 1, gateD + 2);
      vv.box(dx, 2, gateZ, 1, gateH - 1, 1, 3);
    });

    // 門殿屋頂（燕尾脊與歇山造型）
    v.eave(0, 2 + gateH, gateZ, gateW + 2, gateD + 2, 2, 1);
    v.gable(0, 3 + gateH, gateZ, gateW + 2, gateD + 2, 2);
    const gateRidgeY = 3 + gateH + Math.round((gateW + 2) / 2);
    v.box(0, gateRidgeY, gateZ, gateW + 2, 1, 1, 5);
    mirrorX(v, Math.round((gateW + 1) / 2), (vv, dx) => {
      vv.box(dx, gateRidgeY + 1, gateZ, 1, 1, 1, 6);
    });

    // 4. 後殿 / 崇聖祠（主殿後方長型殿宇）
    const rearW = dim(s, 1.8, 9, true);
    const rearD = dim(s, 0.6, 3);
    const rearH = dim(s, 0.7, 3);
    const rearZ = mz + Math.round(md / 2) + Math.round(rearD / 2) + dim(s, 0.3, 2);

    if (rearZ + Math.round(rearD / 2) <= Math.round(yardD / 2)) {
      v.box(0, 1, rearZ, rearW + 2, 1, rearD + 2, 0);
      v.walls(0, 2, rearZ, rearW, rearH, rearD, 1, 1);
      v.gable(0, 2 + rearH, rearZ, rearW + 2, rearD + 2, 2);
    }
  }
});
