/* 積木小人 · 匯出的藍圖（五稜郭）
   用法二選一：放進 blueprints/ 並把檔名加進 list.js，
   或在遊戲裡按「📥 匯入建築」把整份貼進去。 */

/* v1.114：dim 的下限一律乘 0.7（12 處）。原稿最小就是 3994 塊，面板的
   1800／3000 按下去等於沒反應——跟 v1.66 的新天鵝堡、帕德嫩神廟同一個修法
   （下限撐著的時候 lo 調小也沒用，實測 s 從 1.0 到 3.0 都是 3994 格）。
   9000 那一檔一格都沒動（8893），所以「精細版」還是原稿的樣子。 */
// 檔名：五稜郭.js
customBlueprint({
  name: '五稜郭',
  pal: [
    '#385a3c', // 0 草坡與土壘（深綠）
    '#5c7a4b', // 1 內郭草坪與綠地（明綠）
    '#70685e', // 2 石垣與城牆石基（灰褐）
    '#4a7b7a', // 3 護城河水面（碧青水色）
    '#c8ba9d', // 4 步道、橋面與前庭廣場（砂土色）
    '#5a3d2e', // 5 建築瓦頂與木橋欄杆（深木褐）
    '#dfd7c6', // 6 奉行所白牆與附屬兵糧庫
    '#8d2924'  // 7 半月堡紅頂小屋／遊船碼頭遮棚
  ],
  lo: 2.2, hi: 14.5,

  gen(v, s) {
    // === 尺寸計算 ===
    const moatR = dim(s, 2.70, 11);     // 護城河外圍半徑
    const moatW = dim(s, 0.48, 2);      // 護城河水面寬度
    const rOuter = dim(s, 2.20, 9);    // 五角星芒稜堡外突頂點半徑
    const rInner = dim(s, 1.15, 5);     // 五角星芒稜堡內凹谷點半徑
    const wallH = dim(s, 0.50, 2);      // 石垣與土壘高度

    // 1. 基底大地與全域護城河水面
    const baseW = (moatR + moatW + 2) * 2;
    v.box(0, 0, 0, baseW, 1, baseW, 0); // 廣闊外圍綠地基底
    v.cyl(0, 1, 0, moatR + moatW, 1, 3); // 護城河圓盤水面

    // 2. 幾何核心：判斷任意 (x, z) 座標是否落在五芒星內郭中
    // 5 個頂點角度 (0, 72, 144, 216, 288 度)，正南方稜堡有半月堡入口
    const isInsideStar = (px, pz, ro, ri) => {
      const angle = Math.atan2(px, pz); // 以正南(+z)為基準軸
      const normAngle = ((angle % (Math.PI * 2 / 5)) + (Math.PI * 2 / 5)) % (Math.PI * 2 / 5);
      const halfSector = Math.PI / 5;   // 36 度
      const diff = Math.abs(normAngle - halfSector);
      // 在極座標下，稜堡半徑由 ri 線性過渡到 ro
      const limitR = ri + (ro - ri) * (1 - diff / halfSector);
      return Math.hypot(px, pz) <= limitR;
    };

    // 3. 建造五芒星主郭（石垣底層 + 斜削綠色土壘 + 頂部平坦草坪）
    const scanR = Math.ceil(rOuter + 3);
    for (let x = -scanR; x <= scanR; x++) {
      for (let z = -scanR; z <= scanR; z++) {
        // 主土壘外框
        if (isInsideStar(x, z, rOuter, rInner)) {
          // 石垣基座與土壘斜坡
          v.set(x, 1, z, 2);
          for (let y = 2; y <= 1 + wallH; y++) {
            const shrink = (y - 1) * 0.75;
            if (isInsideStar(x, z, rOuter - shrink, rInner - shrink * 0.6)) {
              v.set(x, y, z, y === 1 + wallH ? 1 : 0);
            }
          }
        }
      }
    }

    // 4. 正南側「半月堡」（馬出 / 三角形前哨土壘衛堡）
    const demiZ = Math.round(rInner + dim(s, 0.45, 2));
    const demiR = dim(s, 0.70, 3);
    for (let dx = -demiR; dx <= demiR; dx++) {
      for (let dz = -demiR; dz <= demiR; dz++) {
        // 三角形外突幾何
        if (dz >= -Math.floor(demiR * 0.3) && (Math.abs(dx) * 1.3 + dz) <= demiR) {
          const px = dx;
          const pz = demiZ + dz;
          v.set(px, 1, pz, 2); // 半月堡石垣
          v.set(px, 2, pz, 0); // 半月堡草坡
          v.set(px, 3, pz, 1); // 頂層綠地
        }
      }
    }

    // 5. 連接木橋與主要出入通路
    // 橋 1：從外側前庭廣場通往半月堡（一之橋）
    const bridge1Z = demiZ + demiR + Math.floor(moatW / 2);
    v.box(0, 2, bridge1Z, 3, 1, moatW + 2, 4);
    v.box(-1, 3, bridge1Z, 1, 1, moatW + 2, 5); // 左側木欄杆
    v.box(1, 3, bridge1Z, 1, 1, moatW + 2, 5);  // 右側木欄杆

    // 橋 2：從半月堡通往五星內郭（二之橋）
    const bridge2Z = Math.round((rInner + demiZ) / 2);
    v.box(0, 2, bridge2Z, 3, 1, Math.max(3, demiZ - rInner + 2), 4);
    v.box(-1, 3, bridge2Z, 1, 1, Math.max(3, demiZ - rInner + 2), 5);
    v.box(1, 3, bridge2Z, 1, 1, Math.max(3, demiZ - rInner + 2), 5);

    // 6. 內郭中心標誌性建築群：縮小版「箱館奉行所」與兵糧庫
    const by = 2 + wallH;
    const houseW = dim(s, 0.42, 2, true);
    const houseD = dim(s, 0.32, 2, true);
    const houseZ = -Math.round(rInner * 0.25);

    // 奉行所主殿
    v.box(0, by, houseZ, houseW + 1, 1, houseD + 1, 2);
    v.walls(0, by + 1, houseZ, houseW, 2, houseD, 6, 1);
    v.gable(0, by + 3, houseZ, houseW + 2, houseD + 2, 5);
    // 屋頂中央望樓（太鼓櫓）
    v.box(0, by + 4, houseZ, 1, 2, 1, 6);
    v.box(0, by + 6, houseZ, 2, 1, 2, 5);

    // 側邊長條形白壁兵糧庫
    const wareX = -Math.round(houseW * 1.8 + 2);
    const wareZ = houseZ + 2;
    v.walls(wareX, by + 1, wareZ, 2, 2, dim(s, 0.45, 3), 6, 1);
    v.gable(wareX, by + 3, wareZ, 3, dim(s, 0.45, 3) + 1, 5);

    // 7. 環城綠化帶與景觀點綴
    // 五角星環形樹冠群（沿稜堡邊緣）
    ringOf(v, 5, Math.round(rOuter * 0.85), (vv, rx, rz) => {
      vv.box(rx, by, rz, 2, 2, 2, 0); // 樹林叢
      vv.box(rx, by + 2, rz, 1, 1, 1, 1);
    }, 0, 0, 0);

    // 半月堡側面的紅頂水上駁船碼頭／遊船售票小屋
    const dockX = Math.round(demiR * 0.95);
    const dockZ = demiZ - 1;
    v.box(dockX, 2, dockZ, 3, 2, 2, 6);
    v.box(dockX, 4, dockZ, 4, 1, 3, 7); // 鮮明紅色遮雨棚屋頂

    // 前庭大廣場（西南入城處土地）
    const plazaZ = demiZ + demiR + moatW + 3;
    v.box(-Math.round(rInner * 0.5), 1, plazaZ, Math.round(rOuter * 0.9), 1, dim(s, 0.5, 3), 4);
  }
});
