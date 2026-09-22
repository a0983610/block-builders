// 檔名：應援兔兔.js
customBlueprint({
  name: '應援兔兔',
  pal: [
    '#fff2db', // 0 兔兔米黃色身體
    '#f99db3', // 1 法被粉紅、內耳
    '#222222', // 2 法被黑領襟、黑眼珠、嘴唇外框
    '#ffffff', // 3 螢光棒握柄、眼睛大高光
    '#2cb4ee', // 4 左手藍色螢光棒
    '#ff537b', // 5 右手粉紅螢光棒
    '#ff3b6c', // 6 臉頰粉紅腮紅、愛心
    '#b02846'  // 7 開口嘴巴口腔深色
  ],
  lo: 2.8, hi: 22.0,

  gen(v, s) {
    const hr = s * 0.62;
    const bodyR = hr * 0.85;

    // 1. 基座：雙短足（穩立接地）
    const footR = Math.max(1.2, hr * 0.25);
    const footH = Math.max(2, Math.round(hr * 0.35));
    mirrorX(v, Math.round(bodyR * 0.46), (vv, dx) => {
      vv.cyl(dx, 0, 0, footR, footH, 0);
    });

    // 2. 圓滾下半身軀
    const bodyY = footH + bodyR * 0.72;
    blob(v, 0, bodyY, 0, bodyR * 0.95, bodyR * 0.85, bodyR * 0.85, 0);

    // 3. 寬鬆應援法被
    const coatR = bodyR * 1.06;
    const coatH = bodyR * 1.45;
    blob(v, 0, bodyY, 0, coatR, bodyR * 0.88, coatR * 0.88, 1);
    // 正面大敞開露出肚皮
    v.carve(0, footH + 1, Math.round(coatR * 0.4), Math.max(3, Math.round(coatR * 0.9)), Math.round(coatH * 1.1), Math.round(coatR));
    // 補齊肚皮量體
    blob(v, 0, bodyY, 0, bodyR * 0.94, bodyR * 0.82, bodyR * 0.82, 0);

    // 垂順黑領襟
    const collarX = Math.round(coatR * 0.45);
    const collarZ = Math.round(coatR * 0.65);
    mirrorX(v, collarX, (vv, dx) => {
      vv.box(dx, footH + 1, collarZ, Math.max(1, Math.round(s * 0.12)), Math.round(coatH * 0.88), 2, 2);
    });

    // 下擺愛心
    mirrorX(v, Math.round(coatR * 0.7), (vv, dx) => {
      vv.box(dx, footH + Math.round(coatH * 0.25), collarZ, 2, 2, 1, 6);
    });

    // 4. 頭部大圓球（飽滿呆萌大頭）
    const headY = bodyY + bodyR * 0.62 + hr * 0.72;
    blob(v, 0, headY, 0, hr * 1.16, hr * 1.0, hr * 1.02, 0);

    // 5. 兔子雙耳（耳尖收圓弧，飽滿粉紅內耳）
    const earH = hr * 1.45;
    const earR = hr * 0.26;
    const earSpread = Math.max(2.2, hr * 0.5);
    mirrorX(v, earSpread, (vv, dx) => {
      limb(vv, {
        x: dx, y: headY + hr * 0.65, z: 0,
        x1: dx * 1.05, y1: headY + hr * 0.65 + earH, z1: -0.3,
        r: earR, r1: earR * 0.55, c: 0
      });
      // 正面粉紅長內耳
      limb(vv, {
        x: dx, y: headY + hr * 0.7, z: 0.4,
        x1: dx * 1.05, y1: headY + hr * 0.65 + earH * 0.9, z1: 0.15,
        r: earR * 0.55, r1: earR * 0.3, c: 1
      });
    });

    // 6. 手臂與粗螢光棒（雙持揮舞）
    const armR = Math.max(1.1, hr * 0.22);
    const stickR = Math.max(0.9, s * 0.08);
    const stickLen = hr * 0.95;

    // 右手：粉紅螢光棒
    limb(v, {
      x: -coatR * 0.85, y: bodyY + bodyR * 0.35, z: 0,
      x1: -coatR * 1.25, y1: bodyY + bodyR * 0.75, z1: coatR * 0.25,
      r: armR * 1.3, r1: armR, c: 1
    });
    limb(v, {
      x: -coatR * 1.25, y: bodyY + bodyR * 0.75, z: coatR * 0.25,
      x1: -coatR * 1.42, y1: bodyY + bodyR * 0.9, z1: coatR * 0.35,
      r: armR * 0.9, r1: armR * 0.8, c: 0
    });
    limb(v, {
      x: -coatR * 1.42, y: bodyY + bodyR * 0.6, z: coatR * 0.45,
      x1: -coatR * 1.42, y1: bodyY + bodyR * 0.85, z1: coatR * 0.45,
      r: stickR * 0.9, r1: stickR * 0.9, c: 3
    });
    limb(v, {
      x: -coatR * 1.42, y: bodyY + bodyR * 0.85, z: coatR * 0.45,
      x1: -coatR * 1.42, y1: bodyY + bodyR * 0.85 + stickLen, z1: coatR * 0.45,
      r: stickR, r1: stickR, c: 5
    });

    // 左手：藍色螢光棒
    limb(v, {
      x: coatR * 0.85, y: bodyY + bodyR * 0.25, z: 0,
      x1: coatR * 1.25, y1: bodyY + bodyR * 0.55, z1: coatR * 0.35,
      r: armR * 1.3, r1: armR, c: 1
    });
    limb(v, {
      x: coatR * 1.25, y: bodyY + bodyR * 0.55, z: coatR * 0.35,
      x1: coatR * 1.42, y1: bodyY + bodyR * 0.62, z1: coatR * 0.5,
      r: armR * 0.9, r1: armR * 0.8, c: 0
    });
    limb(v, {
      x: coatR * 1.35, y: bodyY + bodyR * 0.42, z: coatR * 0.55,
      x1: coatR * 1.48, y1: bodyY + bodyR * 0.62, z1: coatR * 0.55,
      r: stickR * 0.9, r1: stickR * 0.9, c: 3
    });
    limb(v, {
      x: coatR * 1.48, y: bodyY + bodyR * 0.62, z: coatR * 0.55,
      x1: coatR * 1.48 + stickLen * 0.55, y1: bodyY + bodyR * 0.62 + stickLen * 0.9, z1: coatR * 0.55,
      r: stickR, r1: stickR, c: 4
    });

    // 7. 正確呆萌五官（直立大圓眼、大亮點、外側腮紅、開口嘴）
    const eyeDx = Math.max(2, Math.round(hr * 0.32));
    const eyeY = Math.round(headY + hr * 0.1);
    const eyeZ = Math.round(hr * 0.95);

    // 垂直直立的大圓眼（去掉生氣眉毛！）
    mirrorX(v, eyeDx, (vv, dx) => {
      vv.box(dx, eyeY, eyeZ, 2, 3, 1, 2); // 正直的黑眼珠
      vv.set(dx, eyeY + 1, eyeZ + 1, 3);   // 晶亮大高光白點
    });

    // 招牌粉紅小圓腮紅（落在雙眼的正外側兩旁！）
    const blushDx = Math.round(hr * 0.68);
    const blushY = eyeY - Math.max(1, Math.round(hr * 0.16));
    const blushZ = Math.round(hr * 0.84);
    mirrorX(v, blushDx, (vv, dx) => {
      vv.box(dx, blushY, blushZ, 2, 2, 1, 6);
    });

    // 兔子開口笑「ω」小嘴（在雙眼中間下方）
    const mouthY = eyeY - Math.max(2, Math.round(hr * 0.28));
    const mouthZ = Math.round(hr * 0.98);
    v.box(0, mouthY, mouthZ, 1, 2, 1, 7);     // 紅色小舌腔
    v.set(0, mouthY - 1, mouthZ, 2);         // 底部嘴線
    v.set(-1, mouthY + 1, mouthZ, 2);        // 左兔唇頂
    v.set(1, mouthY + 1, mouthZ, 2);         // 右兔唇頂
    v.set(0, mouthY + 1, mouthZ - 1, 2);     // 中央分界

    // 8. 圓球小兔尾巴
    blob(v, 0, bodyY - bodyR * 0.2, -bodyR * 0.86, bodyR * 0.35, bodyR * 0.35, bodyR * 0.35, 0);
  }
});
