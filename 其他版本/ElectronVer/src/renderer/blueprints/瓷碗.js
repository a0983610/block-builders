// 檔名：瓷碗.js
// v1.263.0：只調色（格子一格沒動）：灰階改成漆黑釉上散著小而密的曜變斑（銀白斑心＋藍光暈＋青綠／藍紫虹彩外圈），外側與口沿黑褐、圈足露胎土褐（見 開發筆記〈自訂藍圖調整一輪（v1.263.0）〉）
// 正面：底部微縮圈足，碗身呈典雅的圓弧拋物線向上開展，碗口微厚微侈
// 側面：旋轉對稱的深弧形半球碗壁，內壁圓滑凹陷，碗底厚實
// 三樣識別物：底部窄巧圈足、大弧度開展的曜變碗身、由底向上由灰白轉深墨黑的雪花星點釉色
// 部件：圈足底環(foot ring) 底足凹心(foot hollow) 碗底厚胎(base) 弧形碗壁(body) 碗口厚唇(rim) 曜變雪花釉與高光(glaze & highlights)
customBlueprint({
  name: '瓷碗',
  pal: [
    '#0b0c10', // 0 曜變深墨黑（碗內的黑釉、外側釉的黑斑）
    '#1f50b0', // 1 曜變藍光暈（斑心外第一圈）
    '#26a596', // 2 青綠虹彩（光暈最外圈）
    '#5d5fd2', // 3 藍紫虹彩（光暈最外圈）
    '#d8e6f0', // 4 曜變斑心（銀白的一點）
    '#2a1a10', // 5 外側黑褐釉、口沿釉薄處
    '#8e6642'  // 6 圈足露胎、碗底胎與壁厚裡的胎土（土褐）
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
    v.cyl(0, 0, 0, fr, fh, 6, footThick);

    // 部件 2: 圈足底心掏空修飾 (foot hollow)
    const carveR = Math.max(1, Math.round(fr - footThick - 0.5));
    if (carveR >= 1) {
      v.carve(0, 0, 0, carveR * 2, fh, carveR * 2);
    }

    // 部件 3: 碗底實心胚心托胎 (bowl base)：外緣露在碗外的那一圈是黑褐釉
    v.cyl(0, fh, 0, fr, botT, 5);

    // 偽隨機雜湊函式，用於生成均勻且自然的結晶曜變斑紋
    function hash(x, y, z) {
      let h = (x * 374761393 + y * 668265263 + z * 314159265) ^ (x * 127 + z * 311);
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    }

    /* 曜變斑（比日式天目那支小而密）：空間切成 3 格見方的方塊，每塊用一次雜湊決定有沒有斑、
       斑心擺哪、光暈多大。斑心銀白一點，外面一圈藍、最外一圈一側青綠一側藍紫。
       碗心正中固定一顆（見込み那一顆，也保證 300 塊時每個顏色都還在）；其餘碗底密、往碗口漸疏。
       每格查自己那塊加上靠過去的七塊（2×2×2），斑才不會在方塊邊上被切成直邊。回傳 -1 是黑釉。 */
    function spot(x, y, z) {
      let sx = x, sy = y - (fh + botT), sz = z, hb = 0;
      let best = (sx * sx + sy * sy + sz * sz) / 2.56;            // 碗心那一顆，半徑 1.6
      const bx = Math.floor(x / 3), by = Math.floor(y / 3), bz = Math.floor(z / 3);
      const ox = x - bx * 3 < 1.5 ? -1 : 1, oy = y - by * 3 < 1.5 ? -1 : 1, oz = z - bz * 3 < 1.5 ? -1 : 1;
      for (let i = 0; i < 8; i++) {
        const gx = bx + (i & 1 ? ox : 0), gy = by + (i & 2 ? oy : 0), gz = bz + (i & 4 ? oz : 0);
        let h = Math.imul(gx, 374761393) ^ Math.imul(gy, 668265263) ^ Math.imul(gz, 1274126177);
        h = Math.imul(h ^ (h >>> 13), 1103515245);
        h = (h ^ (h >>> 16)) >>> 0;
        const tb = (gy * 3 + 1.5 - fh) / Math.max(1, H - fh);      // 這一塊大約在碗的哪個高度
        if ((h & 255) >= 200 - tb * 80) continue;                 // 有斑的方塊：碗底約八成、碗口約四成五
        const ex = x - (gx * 3 + 0.3 + ((h >>> 8) & 7) * 0.34);    // 斑心落在方塊裡 0.3～2.7 格
        const ey = y - (gy * 3 + 0.3 + ((h >>> 11) & 7) * 0.34);
        const ez = z - (gz * 3 + 0.3 + ((h >>> 14) & 7) * 0.34);
        const r = 1.1 + ((h >>> 17) & 3) * 0.2;                    // 光暈半徑 1.1～1.7
        const q = (ex * ex + ey * ey + ez * ez) / (r * r);         // 距離／半徑 的平方
        if (q < best) { best = q; hb = h; sx = ex; sy = ey; sz = ez; }
      }
      if (best >= 1) return -1;
      if (best < 0.25) return 4;                                   // 斑心（半徑五成以內）
      if (best < 0.6) return 1;                                    // 藍光暈
      return (sx - sz + sy) * ((hb >>> 20) & 1 ? 1 : -1) > 0 ? 2 : 3;   // 虹彩外圈：一側青綠、一側藍紫
    }

    // 碗身的內半徑（照下面迴圈裡 rIn 的算法）：拿來判斷哪些格子的頂面露在碗裡
    const innerR = yy => yy < fh + botT ? 0 : Math.max(0.5, (R - wallT) *
      Math.pow((yy - (fh + botT)) / Math.max(1, H - 1 - (fh + botT)), 0.8));

    // 釉色：圈足露胎、外側黑褐釉、碗內漆黑釉上的曜變斑
    function getGlazeColor(x, y, z, r, rOut, rIn, nextInR, isFoot) {
      if (isFoot) return 6;                                        // 圈足露胎
      if (r > rOut - 1) return hash(x, y, z) > 0.75 ? 0 : 5;       // 外側黑褐釉，兩成五更黑的釉
      // 碗內看得到的那一面：貼著內壁、或頂面沒被上一層蓋住
      if (r < rIn + 1 || r < nextInR) {
        const sc = spot(x, y, z);
        return sc < 0 ? 0 : sc;
      }
      return 6;   // 碗底朝下那一面（從圈足裡看得到）與夾在壁厚中間的格子都是胎土，打破了看得到
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

      const nextInR = y === H - 1 ? Infinity : innerR(y + 1);   // 碗口那層上面沒東西，整圈頂面都露
      const ceilR = Math.ceil(rOut);

      for (let x = -ceilR; x <= ceilR; x++) {
        for (let z = -ceilR; z <= ceilR; z++) {
          const d2 = x * x + z * z;
          const r = Math.sqrt(d2);

          // 落在內外壁厚度區間的點即為瓷碗本體
          if (r <= rOut && (r >= rIn || (y < fh + botT && y >= fh && r <= rOut))) {
            if (y < fh && r < rIn) continue;

            const c = getGlazeColor(x, y, z, r, rOut, rIn, nextInR, isFoot);
            v.set(x, y, z, c);
          }
        }
      }
    }

    // 部件 5: 碗口外唇圓緣微侈修飾 (lip rim)：天目的口沿釉薄，露出黑褐色
    v.cyl(0, H - 1, 0, R, 1, 5, Math.max(1, Math.round(wallT * 0.75)));

    // 部件 6: 碗口外緣高光星點微斑 (rim highlights)：v1.263.0 拿掉（白點在口沿上看起來像一排缺口，不像反光）
  }
});