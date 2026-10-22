/* ============================================================
   產出夜空的資料（src/sky-data.js）：真實星表＋銀河
   跑法：node tools/build-sky.cjs                 從 GitHub 抓 d3-celestial 的資料檔
         node tools/build-sky.cjs --from 資料夾    用已經下載好的（資料夾裡要有 stars.6.json、mw.json、LICENSE）

   來源是 d3-celestial（Olaf Frohn，BSD-3）的兩個資料檔，釘在固定的 commit（SHA 見 BASE）：
     stars.6.json  6 等以內的星（Hipparcos 編號、座標、星等、B−V 色指數），只取 MAG_MAX 等以內
     mw.json       銀河的輪廓，五層亮度，每層一組多邊形（外框＋暗帶挖的洞）
   BSD-3 要求散布時保留版權聲明與條文：LICENSE 原文照抄進產出檔的開頭。

   銀河不帶多邊形進遊戲（三萬多個點），在這裡先烤成一張灰階 PNG（赤經 × 赤緯的等距柱狀圖），
   做法跟〈星空預覽〉那一頁在瀏覽器裡畫的一樣：五層各 0.2 疊上去、σ 5 像素（2048 寬）糊開，再縮成 OUT_W 寬。
   見 開發筆記〈星空：真實星表、銀河、月亮，跟著鏡頭轉（v1.320.0）〉
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'src/sky-data.js');
const BASE = 'https://raw.githubusercontent.com/ofrohn/d3-celestial/7e720a3de062059d4c5400a379146a601d9010e0/';
const FILES = { stars: 'data/stars.6.json', mw: 'data/mw.json', license: 'LICENSE' };
const MAG_MAX = 5;                    // 使用者定的星等上限（1,627 顆）
const HI_W = 2048, HI_H = 1024;       // 烤的時候的解析度（跟預覽頁的畫布一樣大）
const BLUR = 5;                       // 糊開的 σ（像素，HI_W 那一張）
const DOWN = 4;                       // 縮幾倍存進去：2048 → 512
const LEVEL = 0.2;                    // 一層疊多亮，五層疊滿是 1

async function load(from) {
  const out = {};
  for (const k in FILES) {
    if (from) out[k] = fs.readFileSync(path.join(from, path.basename(FILES[k])), 'utf8');
    else {
      const r = await fetch(BASE + FILES[k]);
      if (!r.ok) throw new Error(FILES[k] + ' 抓不到：HTTP ' + r.status);
      out[k] = await r.text();
    }
  }
  return out;
}

/* ── 星：亮的排前面，[赤經 0~360, 赤緯, 星等, B−V] 攤平成一串，座標留兩位小數（0.01°） ── */
function starList(json) {
  const r2 = x => Math.round(x * 100) / 100;
  const S = JSON.parse(json).features
    .map(f => ({ ra: (f.geometry.coordinates[0] + 360) % 360, dec: f.geometry.coordinates[1], mag: +f.properties.mag,
                 bv: f.properties.bv === '' || f.properties.bv == null ? 0.6 : +f.properties.bv }))   // 沒有色指數的兩顆當黃白色
    .filter(s => s.mag <= MAG_MAX)
    .sort((a, b) => a.mag - b.mag);
  const flat = [];
  for (const s of S) flat.push(r2(s.ra), r2(s.dec), r2(s.mag), r2(s.bv));
  return { n: S.length, flat };
}

/* ── 銀河 ──
   每一圈的經度攤平成連續值。最外層那兩圈各繞天球一整圈（北緣、南緣），帶子夾在中間：
   兩圈都從北天極那一側收口，「南緣以北」加上、「北緣以北」扣掉，剩下的就是帶子。
   其餘的圈：跟外框同向的是亮區、反向的是暗帶挖的洞（每層先填亮區、再挖洞，不靠繞行方向相消） */
function mwRings(json) {
  const out = [];
  for (const f of JSON.parse(json).features) {
    const lv = +String(f.id).replace(/\D/g, '');
    const rings = [];
    for (const p of f.geometry.coordinates) for (const r of p) {
      const xs = [(r[0][0] + 360) % 360];
      for (let i = 1; i < r.length; i++) {
        let d = r[i][0] - r[i - 1][0];
        if (d > 180) d -= 360; else if (d < -180) d += 360;
        xs.push(xs[i - 1] + d);
      }
      let A = 0, lat = 0;
      for (let i = 0; i < r.length - 1; i++) A += xs[i] * r[i + 1][1] - xs[i + 1] * r[i][1];
      for (const q of r) lat += q[1];
      rings.push({ lv, wrap: Math.abs(xs[xs.length - 1] - xs[0]) > 180, area: A, lat: lat / r.length, xs, ys: r.map(q => q[1]) });
    }
    const wraps = rings.filter(r => r.wrap).sort((a, b) => b.lat - a.lat);
    for (const r of rings) {
      r.s = r.wrap ? (r === wraps[0] ? -1 : 1) : (r.area < 0 ? 1 : -1);
      out.push(r);
    }
  }
  return out;
}
/* 多邊形換成像素座標（x 往右是赤經增加、y 往下是赤緯減少），左右各多貼一份（赤經是一圈） */
function ringPolys(r, W, H) {
  const pts = [];
  for (let i = 0; i < r.xs.length; i++) pts.push(r.xs[i] / 360 * W, (90 - r.ys[i]) / 180 * H);
  if (r.wrap) pts.push(pts[pts.length - 2], 0, pts[0], 0);       // 繞一整圈的：從北天極那邊（y=0）收口
  return [-W, 0, W].map(off => pts.map((v, i) => i % 2 ? v : v + off));
}
/* 掃描線填色（nonzero）：取樣點在像素中心 */
function fill(polys, W, H) {
  const mask = new Uint8Array(W * H), rows = Array.from({ length: H }, () => []);
  for (const p of polys) {
    const n = p.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, x0 = p[i * 2], y0 = p[i * 2 + 1], x1 = p[j * 2], y1 = p[j * 2 + 1];
      if (y0 === y1) continue;
      const r0 = Math.max(0, Math.ceil(Math.min(y0, y1) - 0.5)), r1 = Math.min(H - 1, Math.ceil(Math.max(y0, y1) - 0.5) - 1);
      const k = (x1 - x0) / (y1 - y0), dir = y1 > y0 ? 1 : -1;
      for (let y = r0; y <= r1; y++) rows[y].push([x0 + (y + 0.5 - y0) * k, dir]);
    }
  }
  for (let y = 0; y < H; y++) {
    const a = rows[y].sort((u, v) => u[0] - v[0]);
    let w = 0, from = 0;
    for (const [x, d] of a) {
      const was = w; w += d;
      if (!was && w) from = x;
      else if (was && !w) {
        const c0 = Math.max(0, Math.ceil(from - 0.5)), c1 = Math.min(W - 1, Math.ceil(x - 0.5) - 1);
        for (let c = c0; c <= c1; c++) mask[y * W + c] = 1;
      }
    }
  }
  return mask;
}
function blur(src, W, H, s) {
  const R = Math.ceil(s * 3), K = [];
  let sum = 0;
  for (let i = -R; i <= R; i++) { const v = Math.exp(-i * i / (2 * s * s)); K.push(v); sum += v; }
  for (let i = 0; i < K.length; i++) K[i] /= sum;
  const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {       // 橫的繞回去（赤經是一圈）
    let a = 0;
    for (let k = -R; k <= R; k++) a += src[y * W + ((x + k) % W + W) % W] * K[k + R];
    tmp[y * W + x] = a;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {       // 直的夾在兩極
    let a = 0;
    for (let k = -R; k <= R; k++) a += tmp[Math.min(H - 1, Math.max(0, y + k)) * W + x] * K[k + R];
    out[y * W + x] = a;
  }
  return out;
}
function mwImage(json) {
  const W = HI_W, H = HI_H, acc = new Float32Array(W * H), rings = mwRings(json);
  for (let lv = 1; lv <= 5; lv++) {
    const on = fill(rings.filter(r => r.lv === lv && r.s > 0).flatMap(r => ringPolys(r, W, H)), W, H);
    const hole = fill(rings.filter(r => r.lv === lv && r.s < 0).flatMap(r => ringPolys(r, W, H)), W, H);
    for (let i = 0; i < W * H; i++) if (on[i] && !hole[i]) acc[i] += LEVEL;
  }
  const soft = blur(acc, W, H, BLUR);
  const w = W / DOWN, h = H / DOWN, px = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let a = 0;
    for (let j = 0; j < DOWN; j++) for (let i = 0; i < DOWN; i++) a += soft[(y * DOWN + j) * W + x * DOWN + i];
    px[y * w + x] = Math.round(Math.min(1, a / (DOWN * DOWN)) * 255);
  }
  return { w, h, png: png(px, w, h), cover: px.filter(v => v > 0).length / px.length };
}

/* ── 灰階 PNG（每一列挑一種濾波，挑「差值絕對值總和最小」的那種） ── */
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(px, w, h) {
  const raw = Buffer.alloc((w + 1) * h);
  const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  for (let y = 0; y < h; y++) {
    let best = null, bestSum = Infinity;
    for (let f = 0; f < 5; f++) {
      const row = Buffer.alloc(w);
      let sum = 0;
      for (let x = 0; x < w; x++) {
        const v = px[y * w + x], a = x ? px[y * w + x - 1] : 0, b = y ? px[(y - 1) * w + x] : 0, c = x && y ? px[(y - 1) * w + x - 1] : 0;
        const d = (v - [0, a, b, (a + b) >> 1, paeth(a, b, c)][f]) & 0xff;
        row[x] = d; sum += d < 128 ? d : 256 - d;
      }
      if (sum < bestSum) { bestSum = sum; best = [f, row]; }
    }
    raw[y * (w + 1)] = best[0]; best[1].copy(raw, y * (w + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;   // 8 位元灰階
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr),
                        chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

(async () => {
  const i = process.argv.indexOf('--from');
  const src = await load(i > 0 ? process.argv[i + 1] : null);
  const st = starList(src.stars), mw = mwImage(src.mw);
  const lic = src.license.replace(/\r\n/g, '\n').trim().split('\n').map(l => '   ' + l).join('\n');
  const js =
    '/* 這支檔是 tools/build-sky.cjs 產出來的，不要手改（要換星等上限、銀河的解析度就改那支再重跑）。\n' +
    '   夜空的資料（見 engine.js 的 makeSky）：\n' +
    '     SKY_STARS  ' + MAG_MAX + ' 等以內的 ' + st.n + ' 顆星，亮的排前面，每顆四個數：赤經（0～360°）、赤緯、星等、B−V 色指數\n' +
    '     SKY_MW     銀河，一張 ' + mw.w + '×' + mw.h + ' 灰階 PNG：左→右是赤經 0→360°、上→下是赤緯 +90→−90°\n' +
    '   資料來源：d3-celestial（https://github.com/ofrohn/d3-celestial）的 data/stars.6.json、data/mw.json，\n' +
    '   原始出處見該專案說明：星表 XHIP（Anderson & Francis 2012）、銀河輪廓 Milky Way Outline Catalog（Jose R. Vieira）。\n' +
    '   d3-celestial 的授權（BSD-3，散布時要保留這段）：\n\n' + lic + '\n*/\n' +
    "'use strict';\n" +
    'const SKY_STARS = [' + st.flat.join(',') + '];\n' +
    "const SKY_MW = 'data:image/png;base64," + mw.png.toString('base64') + "';\n";
  fs.writeFileSync(OUT, js);
  console.log('src/sky-data.js：' + st.n + ' 顆星（' + MAG_MAX + ' 等以內）、銀河 ' + mw.w + '×' + mw.h + ' PNG ' +
              mw.png.length + ' 位元組（有顏色的格子 ' + (mw.cover * 100).toFixed(1) + '%）、整支 ' + js.length + ' 字');
})().catch(e => { console.error(e.message); process.exit(1); });
