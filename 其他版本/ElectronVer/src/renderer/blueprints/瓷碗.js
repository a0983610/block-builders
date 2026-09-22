// 檔名：瓷碗.js
// 正面：底部微縮圈足，碗身呈典雅的圓弧拋物線向上開展，碗口微厚微侈
// 側面：旋轉對稱的深弧形半球碗壁，內壁圓滑凹陷，碗底厚實
// 三樣識別物：底部窄巧圈足、大弧度開展的曜變碗身、由底向上由灰白轉深墨黑的雪花星點釉色
// 部件：圈足底環(foot ring) 底足凹心(foot hollow) 碗底厚胎(base) 弧形碗壁(body) 碗口厚唇(rim) 曜變雪花釉與高光(glaze & highlights)
customBlueprint({
  name: '瓷碗',
  pal: [
    '#0c0d12', // 0 曜變深墨黑（碗口與上部主色）
    '#24252b', // 1 墨藍黑次深色
    '#474c55', // 2 深灰藍釉色
    '#74777b', // 3 中灰過渡斑點
    '#94969a', // 4 淺灰星點結晶
    '#c7c8ca', // 5 亮灰白曜變結晶
    '#eef0f2'  // 6 象牙白雪花釉/高光微斑
  ],
  lo: 2.2, hi: 24.0,

  gen(v, s) {
    const R = dim(s, 1.25, 5);                     // 碗口最大半徑
    const H = dim(s, 1.05, 5);                     // 碗總高度
    const fh = Math.max(1, Math.round(H * 0.18));  // 圈足高度
    const fr = Math.max(2, Math.round(R * 0.42));  // 圈足外半徑
    const wallT = Math.max(1.1, R * 0.14);         // 碗壁平均厚度
    const botT = Math.max(1, Math.round(H * 0.16));// 碗底厚度

    // 部件 1: 圈足基座外環 (foot ring)
    const footThick = Math.max(1, Math.round(wallT * 0.75));
    v.cyl(0, 0, 0, fr, fh, 1, footThick);

    // 部件 2: 圈足底心掏空修飾 (foot hollow)
    const carveR = Math.max(1, Math.round(fr - footThick - 0.5));
    if (carveR >= 1) {
      v.carve(0, 0, 0, carveR * 2, fh, carveR * 2);
    }

    // 部件 3: 碗底實心胚心托胎 (bowl base)
    v.cyl(0, fh, 0, fr, botT, 1);

    // 偽隨機雜湊函式，用於生成均勻且自然的結晶曜變斑紋
    function hash(x, y, z) {
      let h = (x * 374761393 + y * 668265263 + z * 314159265) ^ (x * 127 + z * 311);
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    }

    // 釉色映射：由下而上從灰白雪花漸變至曜變深墨黑
    function getGlazeColor(x, y, z, prog, isFoot) {
      if (isFoot) {
        const rnd = hash(x, y, z);
        return rnd > 0.65 ? 3 : (rnd > 0.3 ? 2 : 1);
      }
      const noise = (hash(x, y, z) - 0.5) * 0.38;
      const p = Math.max(0, Math.min(1, prog + noise));

      // 碗口邊緣帶有自然的微光反差
      if (y === H - 1 && hash(x, y, z) > 0.72) return 6;

      if (p > 0.72) return 0;
      if (p > 0.52) return 1;
      if (p > 0.36) return 2;
      if (p > 0.22) return 3;
      if (p > 0.10) return 4;
      if (p > 0.03) return 5;
      return 6;
    }

    // 部件 4: 碗壁主量體與曜變雪花釉 (glaze body)
    for (let y = 0; y < H; y++) {
      let rOut, rIn;
      let isFoot = false;

      if (y < fh) {
        // 圈足部分：微外撇的短圓柱筒
        isFoot = true;
        rOut = fr + (y / fh) * 0.4;
        rIn = Math.max(0, rOut - Math.max(1.0, wallT * 0.8));
      } else {
        // 碗身部分：平滑圓潤的拋物線曲線向上張開
        const prog = (y - fh) / Math.max(1, H - 1 - fh);
        rOut = fr + (R - fr) * Math.pow(prog, 0.75);

        if (y < fh + botT) {
          // 碗底厚度層：實心支撐
          rIn = 0;
        } else {
          // 碗內部凹槽容室：隨高度向外平滑擴展
          const innerProg = (y - (fh + botT)) / Math.max(1, H - 1 - (fh + botT));
          const maxInnerR = R - wallT;
          rIn = Math.max(0.5, maxInnerR * Math.pow(innerProg, 0.8));
        }
      }

      const progForColor = y / Math.max(1, H - 1);
      const ceilR = Math.ceil(rOut);

      for (let x = -ceilR; x <= ceilR; x++) {
        for (let z = -ceilR; z <= ceilR; z++) {
          const d2 = x * x + z * z;
          const r = Math.sqrt(d2);

          // 落在內外壁厚度區間的點即為瓷碗本體
          if (r <= rOut && (r >= rIn || (y < fh + botT && y >= fh && r <= rOut))) {
            if (y < fh && r < rIn) continue;

            const c = getGlazeColor(x, y, z, progForColor, isFoot);
            v.set(x, y, z, c);
          }
        }
      }
    }

    // 部件 5: 碗口外唇圓緣微侈修飾 (lip rim)
    v.cyl(0, H - 1, 0, R, 1, 0, Math.max(1, Math.round(wallT * 0.75)));

    // 部件 6: 碗口外緣高光星點微斑 (rim highlights)
    const topY = H - 1;
    for (let deg = 0; deg < 360; deg += 12) {
      const rad = (deg * Math.PI) / 180;
      const hx = Math.round(R * Math.cos(rad));
      const hz = Math.round(R * Math.sin(rad));
      if (hash(hx, topY, hz) > 0.55) {
        tint(v, hx, topY, hz, 6);
      }
    }
  }
});