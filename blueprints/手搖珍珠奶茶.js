// 檔名：手搖珍珠奶茶.js
// v1.264.0：子 agent 只拿〈藍圖製作說明〉、看不到程式碼做出來的第三版（見 開發筆記〈prompt 拿去盲測（v1.264.0）〉）
// 正面：上寬下窄的透明塑膠杯（杯口半徑約杯底的 1.5 倍、杯高約杯口直徑的 1.7 倍）；杯底一層黑珍珠、上面奶茶、液面上一圈透明空隙、頂上一片平封膜，粗吸管從封膜斜插出來
// 側面：跟正面同一個梯形（旋轉對稱），杯口捲邊與封膜比杯身寬一點；吸管往 +x 斜，從側面看是直的
// 三樣識別物：杯底一顆一顆的黑珍珠、斜插出封膜的粉紅粗吸管（平口、看得到洞）、印花封膜（加上液面上那圈看得到塑膠的透明空隙）
// 部件：奶茶杯身(revolve 實心) 杯底透明底座 珍珠層(revolve＋表面點成一顆顆) 珍珠縫隙 奶泡線 冰塊 透明空隙 反光條 杯口捲邊 封膜 封膜印花外圈 封膜印花珍珠點 粗吸管 吸管平口與洞
// v2：吸管加粗到杯口半徑的 0.2、頂端切平並挖出吸管口；珍珠拉開間距、層數照珍珠大小排
// v3：吸管改成一段一段疊（中心都在整數格、截面一樣），斜的地方是規則的階梯；拿掉珍珠上方那條暈開帶，珍珠的上緣才清楚
customBlueprint({
  name: '手搖珍珠奶茶',
  pal: [
    '#c39a6b',  // 0 奶茶
    '#ad7d52',  // 1 深一階的奶茶：珍珠縫隙
    '#2e1d16',  // 2 珍珠（也當吸管口裡面的暗色）
    '#a9b9c0',  // 3 透明塑膠：杯底、液面上的空隙、杯口捲邊
    '#e4dfd5',  // 4 封膜白
    '#3a63b0',  // 5 封膜印花
    '#e33d7f',  // 6 粗吸管
    '#d9bf9b',  // 7 亮一階的奶茶：液面奶泡線、反光條
    '#cddfe4'], // 8 冰塊
  lo: 2.8, hi: 17,

  gen(v, s) {
    const R  = Math.max(3, s);            // 杯口半徑（不取整，塊數才連續）
    const rb = R * 0.66;                  // 杯底半徑
    const h  = dim(s, 3.4, 10);           // 杯身高
    const rAt = y => y < 1 ? rb - 0.6 : rb + (R - rb) * (y - 1) / (h - 1);
    const TAU = Math.PI * 2;
    const ang = (a, b) => ((a - b) % TAU + TAU * 1.5) % TAU - Math.PI;   // a−b 摺回 (−π, π]

    // ① 杯身：整杯奶茶（實心），杯底那一格往內收一點當圓角
    revolve(v, { x: 0, y: 0, z: 0, c: 0, prof: [[rb - 0.6, 0], [rb, 1], [R, h]] });
    let yTop = h + 2;                     // 量出 revolve 實際長到哪一層
    while (yTop > 1 && !v.has(0, yTop, 0)) yTop--;

    // 珍珠：先定一顆多大，層數照它排，珍珠層的頂就是最上面那排的中心
    const pd = Math.max(2, R * 0.26), pr = pd / 2, rowSp = pd;
    const nR = Math.max(1, Math.round(dim(s, 0.75, 2) / rowSp));
    const rows = [];
    for (let j = 0; j < nR; j++) {
      const yj = 0.5 + pr + j * rowSp;
      const n = Math.max(6, Math.floor(TAU * rAt(yj) / (pd * 1.35)));
      rows.push({ yj, n, a0: (j % 2) * Math.PI / n + j * 0.37 });
    }
    const yP = Math.floor(rows[nR - 1].yj);   // 珍珠層頂（y = 1..yP），最上面那排會鼓出來一點
    const hs = dim(s, 0.25, 1);           // 液面到杯口的透明空隙
    const yL = yTop - 1 - hs;             // 液面那一層（奶泡線）

    // ② 珍珠層：杯底那一段整個換成珍珠色，表面等一下再點成一顆一顆
    revolve(v, { x: 0, y: 0, z: 0, c: 2, prof: [[rb - 0.6, 0], [rb, 1], [rAt(yP), yP]] });
    // ③ 杯底：一層透明塑膠底座
    v.cyl(0, 0, 0, rb - 0.6, 1, 3);
    // ④ 液面以上挖空，只留一圈杯壁（看得到塑膠的那段空隙）
    for (let y = yL + 1; y <= yTop; y++) {
      const ri = rAt(y) - 1.1, L = Math.ceil(ri);
      for (let x = -L; x <= L; x++) for (let z = -L; z <= L; z++)
        if (Math.hypot(x, z) < ri) v.del(x, y, z);
    }

    // ⑤ 杯身表面：一顆顆珍珠、縫隙、奶泡線、冰塊、反光條
    const aH = -Math.PI / 2 - 0.55, sw = Math.max(1.2, R * 0.15);   // 反光條：正面（−z）偏一側
    const ice = Math.max(2, R * 0.3), ices = [];
    for (let i = 0; i < 4; i++)
      ices.push({ a: aH + 1.3 + i * 1.25, y: yL - 1 - ice / 2 - (i % 2) * ice * 1.3 });
    const skin = (x, y, z) => {
      const rc = Math.hypot(x, z), a = Math.atan2(z, x);
      for (const r of rows) {
        if (Math.abs(y - r.yj) > pr) continue;
        const st = TAU / r.n, t = (a - r.a0) / st;
        const arc = (t - Math.round(t)) * st * rc;
        if (Math.hypot(arc, y - r.yj) <= pr) return 2;
      }
      if (y <= yP) return 1;
      const inH = Math.abs(ang(a, aH) * rc) <= sw / 2;
      if (y > yL) return inH ? 4 : 3;
      if (y === yL) return 7;
      if (inH) return 7;
      for (const c of ices)
        if (Math.abs(y - c.y) <= ice / 2 && Math.abs(ang(a, c.a) * rc) <= ice / 2) return 8;
      return 0;
    };
    for (let y = 1; y <= yTop; y++) {
      const ry = rAt(y), L = Math.ceil(ry) + 1;
      for (let x = -L; x <= L; x++) for (let z = -L; z <= L; z++) {
        const rc = Math.hypot(x, z);
        if (rc < ry - 2.2 || rc > ry + 1.5) continue;
        if (v.has(x, y, z)) tint(v, x, y, z, skin(x, y, z));
      }
    }

    // ⑥ 杯口捲邊：比杯身寬一點的一圈，往內接回杯壁
    v.cyl(0, yTop, 0, R + 0.8, 1, 3, 2);
    // ⑦ 封膜：蓋在捲邊上的一整片
    const yF = yTop + 1;
    v.cyl(0, yF, 0, R + 0.8, 1, 4);
    // ⑧ 封膜印花：外圈一條色帶＋一圈珍珠點
    const dr = R * 0.52, dR = Math.max(0.8, R * 0.13), LF = Math.ceil(R + 1);
    for (let x = -LF; x <= LF; x++) for (let z = -LF; z <= LF; z++) {
      const rc = Math.hypot(x, z);
      let hit = rc > R - 1.7 && rc <= R - 0.5;
      for (let k = 0; k < 6 && !hit; k++) {
        const a = k * TAU / 6 + 0.3;
        hit = Math.hypot(x - dr * Math.cos(a), z - dr * Math.sin(a)) <= dR;
      }
      if (hit) tint(v, x, yF, z, 5);
    }

    // ⑨ 粗吸管：從奶茶裡斜斜穿過封膜伸出去，往 +x 斜（每往上 4 層挪 1 格）。
    //    一段一段疊、每段中心都在整數格，截面才一樣粗（limb 斜著走時截面在 2 格與 3 格之間跳，看起來是歪扭的）
    const rS = Math.max(1.0, R * 0.2);
    const px = R * 0.18, cz = Math.round(R * 0.1), k = 0.25;          // (px, cz) 是穿過封膜的那一點
    const cxAt = y => Math.round(px + k * (y - yF));
    const y0 = Math.max(yP + 1, Math.round(h * 0.45));
    const y1 = yF + dim(s, 1.45, 5);      // 吸管口的高度
    for (let y = y0; y <= y1; ) {
      const cx = cxAt(y);
      let n = 1;
      while (y + n <= y1 && cxAt(y + n) === cx) n++;
      v.cyl(cx, y, cz, rS, n, 6);
      y += n;
    }
    // ⑩ 吸管口：頂面中心挖一格、洞底塗暗色
    v.del(cxAt(y1), y1, cz);
    tint(v, cxAt(y1), y1 - 1, cz, 2);
  }
});
