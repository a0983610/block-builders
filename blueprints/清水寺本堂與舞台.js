/* 積木小人 · 匯出的藍圖（清水寺本堂與舞台）
   用法二選一：放進 blueprints/ 並把檔名加進 list.js，
   或在遊戲裡按「📥 匯入建築」把整份貼進去。 */

// 檔名：清水寺本堂與舞台.js
// v1.263.0：本堂後半與左翼廊底下補上山坡（正面石垣＋兩側與背面土坡、樹叢），本堂整座坐在坡上不再懸空（見 開發筆記〈自訂藍圖調整一輪（v1.263.0）〉）
customBlueprint({
  name: '清水寺本堂與舞台',
  pal: [
    '#3e352f', // 0 懸造高架巨型圓木柱架（棟樑木構）
    '#9e9484', // 1 舞台木地板與迴廊高欄（風化灰木）
    '#54443b', // 2 本堂木造主殿身與外廊樑架
    '#43372f', // 3 巨大寄棟造檜皮葺屋頂瓦
    '#827568', // 4 翼廊出簷與破風木裝飾
    '#c85038', // 5 遠景三重塔朱紅（點綴後方迴廊）
    '#8a8476', // 6 山坡石垣（亮）
    '#696357', // 7 山坡石垣（暗，風化的那幾塊）
    '#5d773b', // 8 山坡草地
    '#3d5a2b'  // 9 坡上樹叢
  ],
  lo: 2.5, hi: 15.0,

  gen(v, s) {
    // 尺度規劃：清水寺以橫長雄偉的檜皮葺大屋頂與高聳懸造（Kakezukuri）舞台著稱
    const mainW = dim(s, 3.2, 13, true);   // 本堂寬度
    const mainD = dim(s, 2.2, 7, true);    // 本堂進深（下限 9 → 7：補了山坡之後最小那一版變大，1600 塊壓不下來，v1.263.0）
    const hallH = dim(s, 1.2, 4);          // 本堂殿身高
    const stageD = dim(s, 1.3, 5, true);   // 懸空向外突出的舞台進深
    const stageH = dim(s, 1.6, 6);         // 懸空崖壁木架高度

    const stageZ = -Math.round((mainD + stageD) / 2) + 2; // 舞台中心位置

    // 1. 懸造舞台木結構（縱橫交錯的貫木與立柱）
    const numPillarsX = dim(s, 0.6, 5, true);
    const numPillarsZ = dim(s, 0.45, 3);
    const stepX = Math.round((mainW - 2) / (numPillarsX - 1));
    const stepZ = Math.round((stageD - 2) / Math.max(1, numPillarsZ - 1));

    // 懸空立柱陣列
    for (let ix = 0; ix < numPillarsX; ix++) {
      const px = -Math.round((mainW - 2) / 2) + ix * stepX;
      for (let iz = 0; iz < numPillarsZ; iz++) {
        const pz = stageZ - Math.round((stageD - 2) / 2) + iz * stepZ;
        v.box(px, 0, pz, 1, stageH, 1, 0); // 粗壯木柱
      }
    }

    // 橫向貫木穿插加固（多層水平樑）
    for (let y = 1; y < stageH; y += 2) {
      // 沿 X 軸貫木
      for (let iz = 0; iz < numPillarsZ; iz++) {
        const pz = stageZ - Math.round((stageD - 2) / 2) + iz * stepZ;
        v.box(0, y, pz, mainW - 1, 1, 1, 0);
      }
      // 沿 Z 軸貫木
      for (let ix = 0; ix < numPillarsX; ix++) {
        const px = -Math.round((mainW - 2) / 2) + ix * stepX;
        v.box(px, y, stageZ, 1, 1, stageD, 0);
      }
    }

    // 2. 清水舞台平板地板與周圍木高欄
    v.box(0, stageH, stageZ, mainW, 1, stageD, 1);
    // 舞台外緣三面高欄（欄杆）
    mirrorX(v, Math.round((mainW - 1) / 2), (vv, dx) => {
      vv.box(dx, stageH + 1, stageZ, 1, 1, stageD, 1);
    });
    v.box(0, stageH + 1, stageZ - Math.round((stageD - 1) / 2), mainW, 1, 1, 1);

    // 3. 後方本堂主體結構
    const hallY = stageH;
    v.walls(0, hallY, 0, mainW - 2, hallH, mainD, 2, 1); // 本堂牆面
    // 正面開放式柱廊通道（堂前木柱）
    for (let ix = 0; ix < numPillarsX; ix++) {
      const px = -Math.round((mainW - 2) / 2) + ix * stepX;
      v.box(px, hallY, -Math.round((mainD - 1) / 2), 1, hallH, 1, 0);
    }

    // 4. 左側連接翼廊與阿彌陀堂引道
    const wingW = dim(s, 1.2, 5);
    const wingY = hallY;
    v.box(-Math.round((mainW + wingW) / 2), wingY, 0, wingW, hallH - 1, dim(s, 0.9, 4), 2);
    v.gable(-Math.round((mainW + wingW) / 2), wingY + hallH, 0, wingW + 2, dim(s, 1.1, 5), 3);

    // 5. 巨大寄棟造（四坡廡殿頂）檜皮葺大屋頂
    const roofY = hallY + hallH;
    v.eave(0, roofY, 0, mainW + 4, mainD + 4, 4, 1); // 寬深大挑簷
    hipRoof(v, 0, roofY + 1, 0, mainW + 6, mainD + 6, 3); // 巨大四坡主屋頂

    // 6. 舞台上方兩側翼角小破風（正面左側與右側抱廈山花）
    const gableW = dim(s, 0.9, 4, true);
    const frontEaveZ = -Math.round((mainD + 4) / 2) + 1;
    mirrorX(v, Math.round((mainW - gableW) / 2), (vv, dx) => {
      vv.gable(dx, roofY + 1, frontEaveZ, gableW, dim(s, 0.7, 3), 3);
    });

    // 7. 正脊延伸木構
    const ridgeLen = Math.max(3, mainW - mainD + 2);
    const roofTopY = roofY + 1 + Math.max(2, Math.round((mainD + 6) / 2));
    v.box(0, roofTopY, 0, ridgeLen, 1, 1, 3);

    /* 8. 山坡（v1.263.0）：本堂後半與左翼廊坐在山坡上，只有前面伸出去的舞台靠柱林撐著（懸造）。
       原本本堂後半底下是空的、左翼廊整組懸空，整座只靠舞台的柱腳站著。
       正面緊貼柱林後面是一道直立的石垣，兩側與背面是越往下越寬的土坡（2:1）；
       只蓋外殼（坡頂除了本堂裡面那塊也鋪滿），看不到的內部不填。
       顏色一邊蓋一邊挑：石垣用固定雜湊挑兩階深淺，土坡用雜湊撒樹叢 */
    const hash = (x, y, z) => (((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) >>> 0) % 100;
    const hz0 = stageZ + (stageD - 1) / 2 + 1;                              // 石垣立面：舞台柱林最後一排的後面
    const hzB = (mainD + 1) / 2;                                            // 坡頂後緣：本堂後牆再往後一格
    const hxL = -Math.round((mainW + wingW) / 2) - Math.ceil(wingW / 2);    // 坡頂左緣：翼廊外側再一格
    const hxR = (mainW - 1) / 2;                                            // 坡頂右緣：本堂側牆再往外一格
    const inX = (mainW - 3) / 2, inZ = (mainD - 1) / 2;                     // 本堂四面牆的位置（牆裡面的坡頂看不到）
    for (let y = 0; y < stageH; y++) {
      const e = Math.round((stageH - 1 - y) * 0.5);
      const xl = hxL - e, xr = hxR + e, zb = hzB + e, top = y === stageH - 1;
      for (let x = xl; x <= xr; x++) for (let z = hz0; z <= zb; z++) {
        if (top ? (Math.abs(x) < inX && Math.abs(z) < inZ && z > hz0)        // 石垣那一排要砌到頂
                : !(x === xl || x === xr || z === hz0 || z === zb)) continue;
        const h = hash(x, y, z);
        v.set(x, y, z, z === hz0 ? (h < 35 ? 7 : 6) : (h < 30 ? 9 : 8));
      }
    }
  }
});
