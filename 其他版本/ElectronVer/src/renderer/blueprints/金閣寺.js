/* 積木小人 · 匯出的藍圖（金閣寺）
   用法二選一：放進 blueprints/ 並把檔名加進 list.js，
   或在遊戲裡按「📥 匯入建築」把整份貼進去。 */

// 檔名：金閣寺.js
customBlueprint({
  name: '金閣寺',
  pal: [
    '#dfa837', // 0 閃耀金箔（二層、三層牆面與高欄）
    '#4a3728', // 1 一層法水院寢殿造深色原木柱樑與緣側
    '#f5f5f7', // 2 一層白漆喰障子牆面
    '#362b24', // 3 杮葺深色木瓦屋頂（一層、二層、三層大屋頂）
    '#f6c944', // 4 屋頂頂端金色鳳凰頂飾
    '#1e1814'  // 5 緣側木欄杆與細部陰影
  ],
  lo: 2.4, hi: 15.0,

  gen(v, s) {
    // 三層遞減尺寸規劃
    const w1 = dim(s, 2.3, 9, true);  // 一層 法水院（寢殿造）
    const d1 = dim(s, 2.1, 9, true);
    const h1 = dim(s, 0.7, 3);

    const w2 = dim(s, 1.8, 7, true);  // 二層 潮音洞（武家造金箔）
    const d2 = dim(s, 1.6, 7, true);
    const h2 = dim(s, 0.65, 3);

    const w3 = dim(s, 1.2, 5, true);  // 三層 究竟頂（禪宗佛殿造金箔）
    const d3 = dim(s, 1.1, 5, true);
    const h3 = dim(s, 0.6, 3);

    // 1. 水上基座與迴廊（石基 + 木造緣側）
    v.box(0, 0, 0, w1 + 4, 1, d1 + 4, 1); // 寬闊木緣側平台
    // 緣側邊緣矮欄杆
    mirrorX(v, Math.round((w1 + 3) / 2), (vv, dx) => {
      vv.box(dx, 1, 0, 1, 1, d1 + 4, 5);
    });
    mirrorZ(v, Math.round((d1 + 3) / 2), (vv, dz) => {
      vv.box(0, 1, dz, w1 + 4, 1, 1, 5);
    });

    let curY = 1;

    // --- 第一層：法水院（寢殿造，深色木柱與白牆障子）---
    v.walls(0, curY, 0, w1, h1, d1, 2, 1); // 白色牆面
    // 外圍深色木柱（利用 corners4 與鏡像排柱）
    const halfW1 = Math.round((w1 - 1) / 2);
    const halfD1 = Math.round((d1 - 1) / 2);
    corners4(v, halfW1, halfD1, (vv, x, z) => vv.box(x, curY, z, 1, h1, 1, 1));
    mirrorX(v, halfW1, (vv, dx) => {
      vv.box(dx, curY, 0, 1, h1, 1, 1);
      vv.box(dx, curY + h1 - 1, 0, 1, 1, d1, 1); // 上部橫木
    });
    mirrorZ(v, halfD1, (vv, dz) => {
      vv.box(0, curY, dz, 1, h1, 1, 1);
      vv.box(0, curY + h1 - 1, dz, w1, 1, 1, 1); // 正面橫樑
    });

    // 突出於水面的漱清亭小雨遮附屬結構（左後方水閣特徵）
    const pondW = dim(s, 0.45, 2);
    v.box(-halfW1 - Math.round(pondW / 2) - 1, 0, halfD1 - 1, pondW + 1, 1, 3, 1);
    v.box(-halfW1 - Math.round(pondW / 2) - 1, curY + h1, halfD1 - 1, pondW + 1, 1, 3, 3);

    // 一層出簷屋頂
    curY += h1;
    v.eave(0, curY, 0, w1 + 4, d1 + 4, 1, 1); // 簷下木構
    hipRoof(v, 0, curY + 1, 0, w1 + 5, d1 + 5, 3); // 寬大深色四坡杮葺簷
    curY += 2;

    // --- 第二層：潮音洞（武家造，金箔外壁 + 帶欄杆緣側）---
    // 外圍金色高欄（走廊）
    v.box(0, curY, 0, w2 + 2, 1, d2 + 2, 0);
    mirrorX(v, Math.round((w2 + 1) / 2), (vv, dx) => vv.box(dx, curY + 1, 0, 1, 1, d2 + 2, 0));
    mirrorZ(v, Math.round((d2 + 1) / 2), (vv, dz) => vv.box(0, curY + 1, dz, w2 + 2, 1, 1, 0));

    // 金箔主牆身
    v.walls(0, curY + 1, 0, w2, h2, d2, 0, 1);

    // 二層出簷屋頂（極深遠出簷）
    curY += 1 + h2;
    v.eave(0, curY, 0, w2 + 6, d2 + 6, 0, 1); // 金色簷底
    hipRoof(v, 0, curY + 1, 0, w2 + 7, d2 + 7, 3); // 巨大二層歇山/四坡屋頂
    curY += 2;

    // --- 第三層：究竟頂（禪宗佛殿造，金箔壁 + 圓頭花頭窗）---
    // 頂層金色高欄走廊
    v.box(0, curY, 0, w3 + 2, 1, d3 + 2, 0);
    mirrorX(v, Math.round((w3 + 1) / 2), (vv, dx) => vv.box(dx, curY + 1, 0, 1, 1, d3 + 2, 0));
    mirrorZ(v, Math.round((d3 + 1) / 2), (vv, dz) => vv.box(0, curY + 1, dz, w3 + 2, 1, 1, 0));

    // 金色牆體與花頭窗
    v.walls(0, curY + 1, 0, w3, h3, d3, 0, 1);
    const katomadoW = dim(s, 0.15, 1);
    const katomadoH = dim(s, 0.35, 2);
    mirrorZ(v, Math.round((d3 - 1) / 2), (vv, dz) => {
      windowGrid(vv, { x: 0, y: curY + 2, z: dz, cols: dim(s, 0.45, 3, true), rows: 1, stepX: dim(s, 0.35, 2), w: katomadoW, h: katomadoH, c: 1, axis: 'x' });
    });

    // 頂層主寶形造屋頂（攢尖頂四坡向上收尖）
    curY += 1 + h3;
    v.eave(0, curY, 0, w3 + 3, d3 + 3, 0, 1);
    const pyramidH = Math.max(2, Math.round((w3 + 4) / 2));
    v.pyramid(0, curY + 1, 0, w3 + 4, 3, 1);

    // 屋頂正中央金色寶頂與鳳凰
    const peakY = curY + 1 + pyramidH;
    v.box(0, peakY, 0, 1, 1, 1, 4); // 寶頂露盤
    // 金色鳳凰飾件（雙翼微展、尾羽向上微揚）
    const birdH = dim(s, 0.25, 2);
    v.box(0, peakY + 1, 0, 1, birdH, 1, 4);
    v.set(0, peakY + birdH, -1, 4); // 鳥頭朝前
    v.set(0, peakY + birdH, 1, 4);  // 尾羽朝後
    mirrorX(v, 1, (vv, dx) => vv.set(dx, peakY + birdH - 1, 0, 4)); // 展翅
  }
});
