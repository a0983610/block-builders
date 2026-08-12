/* 範例：小木屋
   照著這支改就能做自己的。重點是 gen(v, s)——每個尺寸都用 s 重新算一次，
   而不是把一張固定的圖放大縮小，這樣 300 塊跟 3000 塊看起來才會是同一棟房子。 */
customBlueprint({
  name: '範例小木屋',
  pal: ['#c8a06a',   // 0 牆（淺木）
        '#8a5a3c',   // 1 地板與壓頂（深木）
        '#c0483c',   // 2 屋頂
        '#f2efe6',   // 3 窗
        '#8d8f92'],  // 4 煙囪（石頭）
  lo: 2.6, hi: 12,   // s 的掃描範圍，遊戲會在這中間找最接近目標塊數的尺寸

  gen(v, s) {
    /* 寬取奇數：屋頂每層縮 2 格，偶數的話屋脊會歪掉。深度不用——
       walls() 對偶數會落在半格上，set() 一 round 就補回整格，不會塌成同一列。
       兩個都逼成奇數的話塊數一跳就是 2 格，中段目標會差到 14%（實測）。 */
    const w = Math.max(5, Math.round(s * 2.0)) | 1;
    const d = Math.max(5, Math.round(s * 1.7));
    const h = Math.max(3, Math.round(s * 0.9));
    const fz = Math.round((d - 1) / 2);           // 正面那面牆的 z

    v.box(0, 0, 0, w, 1, d, 1);                   // 地板（貼地層一定要有，垮塌判定從地面往上找）
    v.walls(0, 1, 0, w, h, d, 0, 1);              // 四面牆，1 格厚（中空才不浪費積木）

    /* 門：在正面牆上挖穿。寬取奇數才會正對中線 */
    const dw = Math.max(1, Math.round(s * 0.5)) | 1;
    v.carve(0, 1, fz, dw, Math.max(2, Math.round(h * 0.62)), 1);

    /* 窗：直接把牆格改成窗色（set 後寫蓋先寫，不必先挖）。
       尺寸跟著 s 長，房子變大時窗戶才不會變成一個小點。 */
    const ww = Math.max(1, Math.round(s * 0.35));
    const wy = 1 + Math.max(1, Math.round(h * 0.42));
    const wx = Math.max(2, Math.round(w * 0.28));
    v.box(wx, wy, fz, ww, ww, 1, 3);
    v.box(-wx, wy, fz, ww, ww, 1, 3);
    v.box((w - 1) / 2, wy, 0, 1, ww, ww, 3);      // 左右兩側各一扇
    v.box(-(w - 1) / 2, wy, 0, 1, ww, ww, 3);

    v.box(0, 1 + h, 0, w, 1, d, 1);               // 壓頂：深色一圈，屋頂與牆之間的分界

    /* 屋頂：山牆頂，每層縮 2 格（45 度）。寬度多 2 格當屋簷 */
    const ry = 2 + h;
    v.gable(0, ry, 0, w + 2, d + 2, 2);

    /* 煙囪：從牆頂長到屋頂之上。屋頂在 x 方向每層縮 1 格，
       所以煙囪擺在 x = w*0.3 處要長到 (w+2)/2 − w*0.3 那麼高才露得出來。 */
    const cw = Math.max(1, Math.round(s * 0.3)) | 1;
    const cx = Math.round(w * 0.3);
    const ch = Math.ceil((w + 2) / 2) - cx + 2;
    v.box(cx, 1 + h, Math.round(d * 0.22), cw, ch, cw, 4);
  }
});
