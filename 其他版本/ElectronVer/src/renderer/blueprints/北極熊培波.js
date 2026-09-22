// 檔名：北極熊培波.js
// 正面：圓滾滾的白熊大頭，身穿高立領橘色連身工裝服，醒目黑圓眼與沮喪呆萌黑八字嘴
// 側面：圓潤微凸的肚腩，脖圍著厚實大翻領帶扣帶，雙臂自然前垂，身後露出小圓白尾巴
// 三樣識別物：圓耳白熊黑色呆萌表情、厚實外翻橘色高立領帶搭扣、圓滾橘色工裝連身服
// 部件：褲腿與白腳掌(cyl) 圓胖軀幹(blob) 飽滿肚腩(blob) 厚高翻領(taper) 領口扣帶與鈕扣(box+paintFrom) 白熊大頭(blob) 凸吻部(blob) 圓耳朵(blob) 純黑眼鼻與八字嘴(paintFrom) 橘袖雙臂(limb) 白熊掌(blob) 短圓尾巴(blob)
customBlueprint({
  name: '北極熊培波',
  pal: [
    '#eef2f1', // 0 白毛皮主色（純白）
    '#e38633', // 1 亮橘色連身工裝主色
    '#da8435', // 2 深橘色（領口扣帶、褶皺、拉鍊縫）
    '#1b1c1e', // 3 純黑深色（醒目黑眼珠、黑鼻子、八字嘴角、金屬鈕扣）
    '#e7eae9', // 4 耳窩陰影、微張口腔、熊掌肉球
    '#d57c2c'  // 5 褲腳收邊、鞋底暗橘
  ],
  lo: 2.6, hi: 32,

  gen(v, s) {
    // 比例以頭為唯一基準（呆萌 Q 版 2.5 頭身比）
    const hd = dim(s, 0.72, 5, true);
    const hr = hd / 2;

    const headRx = hr;
    const headRy = hr * 0.88;
    const headRz = hr * 0.90;

    const bodyRx = hr * 1.06;
    const bodyRy = hr * 1.18;
    const bodyRz = hr * 0.95;

    const legR = Math.max(1.5, hr * 0.46);
    const legH = Math.max(2, Math.round(hr * 0.82));
    const legX = hr * 0.54;

    const torsoY = legH + bodyRy * 0.76;
    const torsoZ = 0;

    const collarH = Math.max(2, Math.round(hr * 0.42));
    const collarY = torsoY + bodyRy * 0.72;
    const collarR0 = bodyRx * 0.65;
    const collarR1 = bodyRx * 0.82;

    const headY = collarY + collarH * 0.55 + headRy * 0.68;
    const headZ = -Math.round(hr * 0.12);

    // 1. 雙腿與白色熊腳掌（穩固接觸地面 y=0）
    for (const sign of [-1, 1]) {
      const lx = sign * legX;
      // 橘色工裝褲管
      v.cyl(lx, 1, 0, legR, legH, 1);
      // 褲腳深橘色收邊
      v.cyl(lx, 1, 0, legR + 0.35, 1, 5);
      // 底部露出的白色熊掌（略向前突出）
      v.cyl(lx, 0, -legR * 0.25, legR * 0.95, 1, 0);
      // 腳掌底部暗色墊
      paintFrom(v, lx, 0, 0, 0, -1, 0, 2, 5);
    }

    // 2. 圓滾滾的軀幹與微凸小腹（橘色連身服）
    blob(v, 0, torsoY, torsoZ, bodyRx, bodyRy, bodyRz, 1);
    blob(v, 0, torsoY - hr * 0.18, torsoZ - hr * 0.22, bodyRx * 0.86, bodyRy * 0.65, bodyRz * 0.75, 1);

    // 前胸拉鍊中縫（深橘色縫線）
    const zipTop = Math.round(collarY);
    const zipBottom = Math.round(legH + 1);
    for (let zy = zipBottom; zy <= zipTop; zy++) {
      paintFrom(v, 0, zy, torsoZ, 0, 0, -1, Math.ceil(bodyRz * 1.5) + 3, 2);
    }

    // 3. 核心識別物：厚實外翻大立領與金屬扣帶
    const collarThick = Math.max(1, Math.round(hr * 0.18));
    v.taper(0, collarY, torsoZ, collarR0, collarR1, collarH, 1, collarThick);
    v.cyl(0, collarY + collarH - 1, torsoZ, collarR1, 1, 2, 1);

    const strapY = Math.round(collarY + collarH * 0.45);
    const strapW = dim(s, 0.48, 5, true);
    const strapZ = Math.round(torsoZ - collarR1 * 0.95);
    v.box(0, strapY, strapZ, strapW, Math.max(1, Math.round(collarH * 0.35)), 1, 2);
    // 扣帶上的黑色金屬鈕扣
    paintFrom(v, Math.round(strapW * 0.22), strapY, torsoZ, 0, 0, -1, Math.ceil(collarR1) + 4, 3);

    // 4. 白熊大頭與微凸吻部
    blob(v, 0, headY, headZ, headRx, headRy, headRz, 0);

    const muzY = headY - headRy * 0.22;
    const muzZ = headZ - headRz * 0.65;
    blob(v, 0, muzY, muzZ, headRx * 0.44, headRy * 0.36, headRz * 0.46, 0);

    // 5. 兩隻小圓耳朵（外白內暗）
    const earX = Math.round(headRx * 0.72);
    const earY = Math.round(headY + headRy * 0.78);
    const earZ = Math.round(headZ - headRz * 0.08);
    const earR = hr * 0.35;
    for (const sign of [-1, 1]) {
      const ex = sign * earX;
      blob(v, ex, earY, earZ, earR, earR * 0.95, earR * 0.65, 0);
      paintFrom(v, ex, earY, earZ, 0, 0, -1, Math.ceil(earR) + 2, 4);
    }

    // 6. 五官刻畫：純黑色黑豆豆眼、醒目黑鼻、經典八字嘴角
    const eyeDx = Math.max(2, headRx * 0.46);
    const eyeY = Math.round(headY + headRy * 0.12);
    const eyeSize = Math.max(0, Math.round(hr * 0.10));

    // 黑色雙眼（隨尺度自動擴展，確保高塊數時清晰飽滿）
    for (const sign of [-1, 1]) {
      const ex = Math.round(sign * eyeDx);
      for (let dx = -eyeSize; dx <= eyeSize; dx++) {
        for (let dy = -eyeSize; dy <= eyeSize; dy++) {
          if (dx * dx + dy * dy <= eyeSize * eyeSize + 0.5) {
            paintFrom(v, ex + dx, eyeY + dy, headZ, 0, 0, -1, Math.ceil(headRz * 1.5) + 4, 3);
          }
        }
      }
    }

    // 黑色鼻子（吻部中央偏上的圓潤倒三角）
    const noseY = Math.round(headY - headRy * 0.08);
    const noseW = Math.max(0, Math.round(hr * 0.14));
    for (let nx = -noseW; nx <= noseW; nx++) {
      paintFrom(v, nx, noseY, headZ, 0, 0, -1, Math.ceil(headRz * 1.5) + 4, 3);
      if (noseW >= 1 && Math.abs(nx) < noseW) {
        paintFrom(v, nx, noseY + 1, headZ, 0, 0, -1, Math.ceil(headRz * 1.5) + 4, 3);
      }
    }
    paintFrom(v, 0, noseY - 1, headZ, 0, 0, -1, Math.ceil(headRz * 1.5) + 4, 3);

    // 人中垂直黑線
    const mouthY = noseY - Math.max(2, Math.round(headRy * 0.28));
    for (let my = mouthY + 1; my < noseY; my++) {
      paintFrom(v, 0, my, headZ, 0, 0, -1, Math.ceil(headRz * 1.5) + 4, 3);
    }

    // 黑色八字嘴巴（微張下垂沮喪唇形）
    const mw = Math.max(1, Math.round(hr * 0.26));
    for (let mx = -mw; mx <= mw; mx++) {
      paintFrom(v, mx, mouthY, headZ, 0, 0, -1, Math.ceil(headRz * 1.5) + 4, 3);
    }
    paintFrom(v, -mw - 1, mouthY - 1, headZ, 0, 0, -1, Math.ceil(headRz * 1.5) + 4, 3);
    paintFrom(v, mw + 1, mouthY - 1, headZ, 0, 0, -1, Math.ceil(headRz * 1.5) + 4, 3);

    // 下唇邊線形成清晰開口
    if (s >= 7) {
      for (let mx = -mw; mx <= mw; mx++) {
        paintFrom(v, mx, mouthY - 2, headZ, 0, 0, -1, Math.ceil(headRz * 1.5) + 4, 3);
      }
      paintFrom(v, -mw, mouthY - 1, headZ, 0, 0, -1, Math.ceil(headRz * 1.5) + 4, 3);
      paintFrom(v, mw, mouthY - 1, headZ, 0, 0, -1, Math.ceil(headRz * 1.5) + 4, 3);

      // 口腔內襯
      for (let mx = -Math.max(0, mw - 2); mx <= Math.max(0, mw - 2); mx++) {
        paintFrom(v, mx, mouthY - 1, headZ, 0, 0, -1, Math.ceil(headRz * 1.5) + 4, 4);
      }
    }

    // 7. 雙臂與白色熊掌（分上臂、前臂兩段 limb，手腕露出白手掌）
    const shoulderX = bodyRx * 0.88;
    const shoulderY = torsoY + bodyRy * 0.42;
    const shoulderZ = torsoZ - hr * 0.05;

    const elbowX = bodyRx * 0.96;
    const elbowY = torsoY - bodyRy * 0.08;
    const elbowZ = torsoZ - hr * 0.18;

    const wristX = bodyRx * 0.68;
    const wristY = torsoY - bodyRy * 0.62;
    const wristZ = torsoZ - hr * 0.32;

    const armR0 = Math.max(1.5, hr * 0.36);
    const armR1 = Math.max(1.3, hr * 0.32);
    const armR2 = Math.max(1.1, hr * 0.28);
    const pawR = Math.max(1.4, hr * 0.30);

    for (const sign of [-1, 1]) {
      const sx = sign * shoulderX;
      const ex = sign * elbowX;
      const wx = sign * wristX;

      limb(v, {
        x: sx, y: shoulderY, z: shoulderZ,
        x1: ex, y1: elbowY, z1: elbowZ,
        r: armR0, r1: armR1, c: 1
      });
      limb(v, {
        x: ex, y: elbowY, z: elbowZ,
        x1: wx, y1: wristY, z1: wristZ,
        r: armR1, r1: armR2, c: 1
      });

      // 袖口邊緣
      blob(v, wx, wristY, wristZ, armR2 * 1.05, armR2 * 0.8, armR2 * 1.05, 2);

      // 圓圓白熊掌
      const px = sign * (bodyRx * 0.58);
      const py = wristY - armR2 * 0.7;
      const pz = wristZ - armR2 * 0.6;
      blob(v, px, py, pz, pawR, pawR * 0.9, pawR * 1.1, 0);
      paintFrom(v, px, py, pz, 0, 0, -1, Math.ceil(pawR) + 2, 4);
    }

    // 8. 背後短短的圓白尾巴
    const tailY = torsoY - bodyRy * 0.40;
    const tailZ = torsoZ + bodyRz * 0.88;
    const tailR = Math.max(1.2, hr * 0.24);
    blob(v, 0, tailY, tailZ, tailR, tailR * 0.9, tailR * 0.9, 0);
  }
});