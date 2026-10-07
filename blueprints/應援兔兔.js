// 檔名：應援兔兔.js
// v1.263.0：整隻繞 y 轉 180°（臉、肚皮、領襟改朝 −z 正面，尾巴到背面）、身體配一階米灰與陰影（見 開發筆記〈自訂藍圖調整一輪（v1.263.0）〉）
customBlueprint({
  name: '應援兔兔',
  pal: [
    '#ece0c9', // 0 兔兔米白色身體（亮面：臉、正面、頭頂）
    '#f99db3', // 1 法被粉紅、內耳
    '#222222', // 2 法被黑領襟、黑眼珠、嘴唇外框
    '#ffffff', // 3 螢光棒握柄、眼睛大高光
    '#2cb4ee', // 4 左手藍色螢光棒
    '#ff537b', // 5 右手粉紅螢光棒
    '#ff3b6c', // 6 臉頰粉紅腮紅、愛心
    '#b02846', // 7 開口嘴巴口腔深色
    '#cfc1a8', // 8 身體米灰（側面、底下、腳、尾巴）
    '#b3a287'  // 9 身體陰影（後腦、耳朵與手朝後的那一面）
  ],
  lo: 2.8, hi: 22.0,

  gen(v, s) {
    /* 正面是 −z（臉、肚皮、領襟、螢光棒都在 −z 那側），尾巴在 +z；
       +x 是兔兔自己的右手（粉紅螢光棒），−x 是左手（藍色螢光棒）。 */
    const hr = s * 0.62;
    const bodyR = hr * 0.85;
    const SIDE = 8, SHADE = 9;

    /* 身體的亮／灰／陰影是蓋的當下就挑（不要蓋完再整份掃一遍）：
       光從正面偏上方來，朝前、朝上的亮，側面與底下灰，背面陰影。
       (a, b, c) 是這一格離中心（或離骨幹）的方向；內部的格子也照方向分，色比才跟外觀一致。 */
    const lit = (a, b, c) => {
      const n = Math.sqrt(a * a + b * b + c * c) || 1;
      const d = (0.5 * b - 0.87 * c) / n;            // 跟光的方向 (0, 0.5, −0.87) 的夾角餘弦
      return d > -0.1 ? 0 : d > -0.55 ? SIDE : SHADE;
    };
    // 帶顏色的 blob：判定跟 blob 一樣（d > 1.02 不畫），每一格照 lit 挑色
    const egg = (x0, y0, z0, rx, ry, rz) => {
      const nx = Math.ceil(rx), ny = Math.ceil(ry), nz = Math.ceil(rz), lim = 1.02 * 1.02;
      for (let i = -nx; i <= nx; i++) for (let j = -ny; j <= ny; j++) for (let k = -nz; k <= nz; k++) {
        const a = i / rx, b = j / ry, c = k / rz;
        if (a * a + b * b + c * c > lim) continue;
        v.set(x0 + i, y0 + j, z0 + k, lit(a, b, c));
      }
    };
    // 帶顏色的 limb：判定跟 limb 一樣（骨幹 + 到線段的距離），每一格照「離骨幹的方向」挑色
    const cap = o => {
      const bx = o.x1 - o.x, by = o.y1 - o.y, bz = o.z1 - o.z;
      const len2 = bx * bx + by * by + bz * bz;
      const r0 = Math.max(0.5, o.r), r1 = Math.max(0.5, o.r1), rm = Math.max(r0, r1);
      v.line(o.x, o.y, o.z, o.x1, o.y1, o.z1, 0);    // 骨幹：細的地方才接得起來
      const xe = Math.ceil(Math.max(o.x, o.x1) + rm), ye = Math.ceil(Math.max(o.y, o.y1) + rm),
            ze = Math.ceil(Math.max(o.z, o.z1) + rm);
      for (let x = Math.floor(Math.min(o.x, o.x1) - rm); x <= xe; x++)
        for (let y = Math.max(0, Math.floor(Math.min(o.y, o.y1) - rm)); y <= ye; y++)
          for (let z = Math.floor(Math.min(o.z, o.z1) - rm); z <= ze; z++) {
            const px = x - o.x, py = y - o.y, pz = z - o.z;
            let t = len2 ? (px * bx + py * by + pz * bz) / len2 : 0;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const dx = px - bx * t, dy = py - by * t, dz = pz - bz * t, R = r0 + (r1 - r0) * t + 0.02;
            if (dx * dx + dy * dy + dz * dz <= R * R) v.set(x, y, z, lit(dx, dy, dz));
          }
    };

    // 1. 基座：雙短足（穩立接地）
    const footR = Math.max(1.2, hr * 0.25);
    const footH = Math.max(2, Math.round(hr * 0.35));
    mirrorX(v, Math.round(bodyR * 0.46), (vv, dx) => {
      vv.cyl(dx, 0, 0, footR, footH, SIDE);
    });

    // 2. 圓滾下半身軀：整顆都在法被裡面（法被是實心的、每一軸都比它大），
    //    露出來的只有下面補回去的肚皮——所以不另外畫，省掉一整顆的掃描（v1.263.0）
    const bodyY = footH + bodyR * 0.72;

    // 3. 寬鬆應援法被
    const coatR = bodyR * 1.06;
    const coatH = bodyR * 1.45;
    blob(v, 0, bodyY, 0, coatR, bodyR * 0.88, coatR * 0.88, 1);
    /* 正面大敞開露出肚皮。轉 180° 時盒子的中心要多挪半格：box／carve 的格子是照 round 取整
       （.5 往 + 進位），中心只取負號的話偶數邊長那一軸會整排偏一格 */
    v.carve(-0.5, footH + 1, -Math.round(coatR * 0.4) - 0.5,
            Math.max(3, Math.round(coatR * 0.9)), Math.round(coatH * 1.1), Math.round(coatR));
    // 補齊肚皮量體
    egg(0, bodyY, 0, bodyR * 0.94, bodyR * 0.82, bodyR * 0.82);

    // 垂順黑領襟（深 2 格：同上，中心多挪半格才是原本那兩格）
    const collarX = Math.round(coatR * 0.45);
    const collarZ = Math.round(coatR * 0.65);
    mirrorX(v, collarX, (vv, dx) => {
      vv.box(dx, footH + 1, -collarZ - 0.5, Math.max(1, Math.round(s * 0.12)), Math.round(coatH * 0.88), 2, 2);
    });

    // 下擺愛心
    mirrorX(v, Math.round(coatR * 0.7), (vv, dx) => {
      vv.box(dx, footH + Math.round(coatH * 0.25), -collarZ, 2, 2, 1, 6);
    });

    // 4. 頭部大圓球（飽滿呆萌大頭）
    const headY = bodyY + bodyR * 0.62 + hr * 0.72;
    egg(0, headY, 0, hr * 1.16, hr * 1.0, hr * 1.02);

    // 5. 兔子雙耳（耳尖收圓弧，飽滿粉紅內耳）：耳背往 +z 微傾，內耳在正面（−z）
    const earH = hr * 1.45;
    const earR = hr * 0.26;
    const earSpread = Math.max(2.2, hr * 0.5);
    mirrorX(v, earSpread, (vv, dx) => {
      cap({
        x: dx, y: headY + hr * 0.65, z: 0,
        x1: dx * 1.05, y1: headY + hr * 0.65 + earH, z1: 0.3,
        r: earR, r1: earR * 0.55
      });
      // 正面粉紅長內耳
      limb(vv, {
        x: dx, y: headY + hr * 0.7, z: -0.4,
        x1: dx * 1.05, y1: headY + hr * 0.65 + earH * 0.9, z1: -0.15,
        r: earR * 0.55, r1: earR * 0.3, c: 1
      });
    });

    // 6. 手臂與粗螢光棒（雙持揮舞，螢光棒舉在身體前方 −z）
    const armR = Math.max(1.1, hr * 0.22);
    const stickR = Math.max(0.9, s * 0.08);
    const stickLen = hr * 0.95;

    // 右手（+x）：粉紅螢光棒
    limb(v, {
      x: coatR * 0.85, y: bodyY + bodyR * 0.35, z: 0,
      x1: coatR * 1.25, y1: bodyY + bodyR * 0.75, z1: -coatR * 0.25,
      r: armR * 1.3, r1: armR, c: 1
    });
    cap({
      x: coatR * 1.25, y: bodyY + bodyR * 0.75, z: -coatR * 0.25,
      x1: coatR * 1.42, y1: bodyY + bodyR * 0.9, z1: -coatR * 0.35,
      r: armR * 0.9, r1: armR * 0.8
    });
    limb(v, {
      x: coatR * 1.42, y: bodyY + bodyR * 0.6, z: -coatR * 0.45,
      x1: coatR * 1.42, y1: bodyY + bodyR * 0.85, z1: -coatR * 0.45,
      r: stickR * 0.9, r1: stickR * 0.9, c: 3
    });
    limb(v, {
      x: coatR * 1.42, y: bodyY + bodyR * 0.85, z: -coatR * 0.45,
      x1: coatR * 1.42, y1: bodyY + bodyR * 0.85 + stickLen, z1: -coatR * 0.45,
      r: stickR, r1: stickR, c: 5
    });

    // 左手（−x）：藍色螢光棒
    limb(v, {
      x: -coatR * 0.85, y: bodyY + bodyR * 0.25, z: 0,
      x1: -coatR * 1.25, y1: bodyY + bodyR * 0.55, z1: -coatR * 0.35,
      r: armR * 1.3, r1: armR, c: 1
    });
    cap({
      x: -coatR * 1.25, y: bodyY + bodyR * 0.55, z: -coatR * 0.35,
      x1: -coatR * 1.42, y1: bodyY + bodyR * 0.62, z1: -coatR * 0.5,
      r: armR * 0.9, r1: armR * 0.8
    });
    limb(v, {
      x: -coatR * 1.35, y: bodyY + bodyR * 0.42, z: -coatR * 0.55,
      x1: -coatR * 1.48, y1: bodyY + bodyR * 0.62, z1: -coatR * 0.55,
      r: stickR * 0.9, r1: stickR * 0.9, c: 3
    });
    limb(v, {
      x: -coatR * 1.48, y: bodyY + bodyR * 0.62, z: -coatR * 0.55,
      x1: -coatR * 1.48 - stickLen * 0.55, y1: bodyY + bodyR * 0.62 + stickLen * 0.9, z1: -coatR * 0.55,
      r: stickR, r1: stickR, c: 4
    });

    // 7. 正確呆萌五官（直立大圓眼、大亮點、外側腮紅、開口嘴），全在正面 −z
    const eyeDx = Math.max(2, Math.round(hr * 0.32));
    const eyeY = Math.round(headY + hr * 0.1);
    const eyeZ = -Math.round(hr * 0.95);

    // 垂直直立的大圓眼（去掉生氣眉毛！）
    mirrorX(v, eyeDx, (vv, dx) => {
      vv.box(dx, eyeY, eyeZ, 2, 3, 1, 2); // 正直的黑眼珠
      vv.set(dx, eyeY + 1, eyeZ - 1, 3);   // 晶亮大高光白點
    });

    // 招牌粉紅小圓腮紅（落在雙眼的正外側兩旁！）
    const blushDx = Math.round(hr * 0.68);
    const blushY = eyeY - Math.max(1, Math.round(hr * 0.16));
    const blushZ = -Math.round(hr * 0.84);
    mirrorX(v, blushDx, (vv, dx) => {
      vv.box(dx, blushY, blushZ, 2, 2, 1, 6);
    });

    // 兔子開口笑「ω」小嘴（在雙眼中間下方）
    const mouthY = eyeY - Math.max(2, Math.round(hr * 0.28));
    const mouthZ = -Math.round(hr * 0.98);
    v.box(0, mouthY, mouthZ, 1, 2, 1, 7);     // 紅色小舌腔
    v.set(0, mouthY - 1, mouthZ, 2);         // 底部嘴線
    v.set(-1, mouthY + 1, mouthZ, 2);        // 左兔唇頂
    v.set(1, mouthY + 1, mouthZ, 2);         // 右兔唇頂
    v.set(0, mouthY + 1, mouthZ + 1, 2);     // 中央分界

    // 8. 圓球小兔尾巴（背面 +z）
    blob(v, 0, bodyY - bodyR * 0.2, bodyR * 0.86, bodyR * 0.35, bodyR * 0.35, bodyR * 0.35, SIDE);
  }
});
