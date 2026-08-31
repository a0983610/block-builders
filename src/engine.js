/* ============================================================
   繪製層：three.js 場景、光影、相機、InstancedMesh 積木池
   規則只有一條——這支檔案只管「怎麼畫」，不碰遊戲規則。
   遊戲邏輯在 src/game*.js 那五支（分工見 game.js 檔頭），它們把每個積木／小人的位置
   塞進這裡的 buffer。

   效能關鍵：所有積木共用一個 BoxGeometry，走 InstancedMesh，
   不管畫 300 塊還是 3000 塊都只有 1 個 draw call。
   小人也一樣——每個小人 7 個部位，全部塞進同一個 InstancedMesh。
   ============================================================ */
'use strict';

const ENG = (function () {
  const T = THREE;

  let renderer, scene, camera, canvas;
  let sun, ground, dirtPad, grassRim, blockMesh, workerMesh, beastMesh, trunkMesh, leafMesh, dustMesh;
  let ballMesh, tornadoGroup, hammerGroup, rockMesh, trebMesh, dozMesh, trkMesh, poolMesh;
  let poolGeo, poolPos, poolFoam, poolUni;
  let markMesh, markGeo, markPos, markCol;
  let groundHalf = 0;               // 草皮的半邊長（草地島是一塊方的，見 setGroundSize）
  let bombMesh, nukeMesh, ringGroup, magSpokeMesh, fireMesh, flashGroup, meteorMesh;
  let starMesh, boltMesh;
  let emoMesh, emoGeo, emoPos, emoUv;      // 頭上的表情圖示（v1.122，見 paintEmoAtlas／putEmotes）
  /* 最多同時幾顆核彈在天上（規則那邊 NUKE_MAX 跟這個數字一致）。
     一顆七個部位，全部在同一顆 InstancedMesh 裡。 */
  const NUKE_MAX = 4;
  let NUKE_PARTS = null;                     // [[位移], [尺寸], 顏色]，init 時填
  const _nOuter = new T.Object3D(), _nMat = new T.Matrix4();
  const magRings = [], magDiscs = [];
  const flashShells = [];
  /* 填滿的圓盤：魔法陣每層一片。×3 是因為 v1.59 起最多同時三個陣。
     （v1.62 起那顆火種不再墊盤——參考圖裡的火圈中間是空的，見規則那邊的火種註解，
     所以從 7×3 收成 6×3。） */
  const MAG_DISC = 18;
  /* 火／火星粒子。240 是「一次爆炸的火球 + 幾棟在燒」的量；
     煙火改成一次三發齊射之後，光是天上的火星就要三百顆才不會變成一顆一顆的點。
     v1.58 再放大到 960：煙火的每一顆火星自己就是一條拖線（一顆 instance），
     一場齊射約 500 顆火星，加上還在燒的建築與爆炸火球才擠得下。
     這顆是 InstancedMesh，多開 instance 不多吃 draw call，只多幾筆矩陣運算。 */
  const MAXFIRE = 960;
  /* 爆炸中心的火球。一顆球撐不起來：加法混色的單一顆球是「整片同亮度」，
     邊緣硬得像顆塑膠球。改用幾層同心殼各給低濃度疊起來——中心被五層疊到爆白，
     往外一層層淡出去，才是參考圖那種糊掉的光。
     每層的濃度都壓得很低是因為加法混色會累加：中心是五層疊起來的（總和約 1.26，
     剛好過曝成白），各層給高一點整顆就平成一片死白，黃橘的漸層全看不見。
     r 半徑倍率、op 這層的濃度、c 平常的顏色、mc 魔法版的顏色。 */
  const FLASH_SHELL = [
    { r: 0.40, op: 0.50, c: 0xfffdf2, mc: 0xfff2f8 },
    { r: 0.58, op: 0.30, c: 0xffeda6, mc: 0xffc9e0 },
    { r: 0.75, op: 0.22, c: 0xffc44a, mc: 0xff86b6 },
    { r: 0.92, op: 0.15, c: 0xff9a22, mc: 0xff4f86 },
    { r: 1.10, op: 0.09, c: 0xff6d12, mc: 0xe22f6e }
  ];
  const FLASH_MAX = 4;                     // 最多同時幾顆（好幾發一起炸）
  const FLASH_SQUASH = 0.82;               // 壓扁一點：貼地炸開的火球是扁的，不是正球
  const MAXROCK = 48, MAXTREB = 8, TREB_PARTS = 5;
  /* 鐵球最多同時幾顆（v1.116）。要跟規則那邊的 BALL_MAX 一樣大——
     小於它的話多出來的球會整顆不見（規則還在算，畫面上沒有）。 */
  const MAXBALL = 6;
  const MAXDOZ = 6, DOZ_PARTS = 10;
  const MAXTRUCK = 2, TRK_PARTS = 11;       // 消防車：最多兩台，一台 11 個部位
  /* 水：同時最多幾格。**要跟規則那邊的 WT_CELLS 一樣大**——小於它的話多出來的格子
     整格不會被畫（而且被丟掉的是清單後面那些＝最新的水），實測就是「破口在流水，
     可是看不到水柱」：一個裝滿的馬克杯已經 4463 格，超過舊的 4000 格上限。 */
  const MAXPOOL = 9000;
  const MAXPOOLV = 150000;                  // 水的頂點上限（一格最多 6 面 × 6 頂點）
  /* 地面痕跡（焦黑／坑洞）：同時最多幾塊、一塊切幾片、一塊最多幾圈。
     一塊痕跡是幾個同心圈疊出來的，圈與圈之間鋪一圈四邊形，
     所以頂點上限＝塊數 × 片數 × (圈數−1) × 6。 */
  const MARK_MAX = 24, MARK_SEG = 18, MARK_RING = 5;
  const MARKV = MARK_MAX * MARK_SEG * (MARK_RING - 1) * 6;
  const MAXBOMB = 6, BOMB_PARTS = 3;
  const MAXMET = 6;                        // 同時最多幾顆隕石（一顆一個 instance）
  /* 環的總數：魔法陣每層要兩個（亮芯 + 外圈暈染，單一個環太扁看不出是發光的），
     四層就吃掉八個，再加上爆炸衝擊環與蘑菇雲腰環。 */
  /* 同時能畫幾個圓環。一個魔法陣最多六層×2 個環＝12，那顆一直在的小火圈再吃 3 個
     ＝ 15；v1.59 起最多可以同時有三個陣（45），剩下的留給爆炸衝擊波、風壓那幾圈
     與蘑菇雲腰上那圈——不夠的話它們會被截掉。
     沒用到的環是 visible = false，不佔 draw call，開多幾個不花錢
     （真的三個陣同時滿版時 draw call 才會衝上去，那是玩家自己按出來的畫面）。 */
  const MAG_MAX = 54;
  /* 盤面的紋路：兩組反向的螺旋臂 + 一圈虛線。
     直的放射線看起來像車輪，參考圖是**捲進去的漩渦**——每條臂切成幾段短棒
     沿著曲線擺，段數夠多就連成一道弧。臂的內端都收在中心附近，
     那一小塊被上百段疊在一起，加法混色自然亮成一顆核，不用另外畫。
     arms 幾條臂、seg 每條切幾段、turn 一條臂繞幾弧度（負的就是反向捲）、
     r0 內端從哪裡起（半徑倍率）、w 粗細、spin 這一組的角度倍率。
     spin 一律取正：陣會轉之後，這個倍率就是「這一組相對於陣的轉速」，
     給負的那一組會逆著整個陣往回轉——指定的方向是逆時針，只有它反著轉會很突兀。
     兩組給不同的正倍率，一樣有錯開的效果（起始角度也就不同）。 */
  const MAG_SWIRL = [
    { arms: 7, seg: 9, turn: 2.0, r0: 0.14, w: 0.030, spin: 1 },
    { arms: 5, seg: 8, turn: -1.5, r0: 0.28, w: 0.022, spin: 0.62 }
  ];
  /* 十字星光：魔法陣長層時撒的那種四角星（參考圖裡那些一閃一閃的星芒）。
     一顆一個 instance，每幀轉向鏡頭當公告板——粒子那顆方塊做不出尖角。
     48 顆是「六層各撒七顆、前後幾層還疊著沒熄」的量。 */
  const MAXSTAR = 48;
  /* 藍色閃電的線段上限。一道電折六段、可能再帶一條分岔，一處爆點同時最多六道 → 不到 60；
     96 留了餘裕，反正是一顆 InstancedMesh，多開 instance 不多吃 draw call。
     ×3 跟上面那些圓環同一個理由（v1.67）：三個陣可以同時爆，額度是每一處各算的，
     三處一起放電最多 3×42＝126 段——留在 96 的話會被 putBolts 的 Math.min 默默切掉。 */
  const MAXBOLT = 96 * 3;
  const MAG_DASH = 26;                                       // 外圈那一圈虛線的段數
  /* 邊上的螺旋筆觸（v1.62.1，照參考圖）。使用者要的邊緣不規則是**螺旋狀**的：
     參考圖裡那一圈不是一條被弄皺的圓弧，是**幾道沿著邊掃出去的粗筆觸疊在一起**——
     每一道從內側起筆、一路往外掃，收筆時已經在環外，尾巴伸出去那一截就是邊上
     鼓出來的那幾處。上一版是把環的外緣本身加正弦波弄皺（歪歪扭扭的阿米巴），
     使用者看了說不對，整個換掉：環本身回到正圓，不規則交給這些筆觸。
     arcs 幾道、seg 每道切幾段、sweep 一道掃幾弧度、r0→r1 起筆到收筆的半徑（倍率）、
     w 粗細、spin 相對於陣的轉速。兩組給不同的轉速：它們會互相滑過去，
     疊出來的形狀一直在變，看起來才像在燒而不是一個固定的花邊。
     第二組往內收（r0 > r1），跟第一組交叉才有「捲」的感覺。 */
  /* 盤的濃度。v1.54 是 0.42（深紅在大白天的綠地上要這麼濃才讀得出是紅的）；
     v1.62.1 改成桃紅之後再提一階：桃紅的藍多、綠地把它拉得更兇。 */
  const DISC_OP = 0.5;
  const MAG_RIM = [
    { arcs: 3, seg: 14, sweep: 2.4, r0: 0.92, r1: 1.20, w: 0.060, spin: 1.35 },
    { arcs: 2, seg: 12, sweep: 1.7, r0: 1.08, r1: 0.92, w: 0.038, spin: 0.55 }
  ];
  /* 筆觸掃得最遠到幾倍半徑。規則那邊算「這一陣要退多遠才進得了畫面」要用它——
     只照環本身算的話，掃出去那一截會被切在畫面外。 */
  const MAG_RIM_OUT = Math.max(...MAG_RIM.map(f => Math.max(f.r0, f.r1)));
  let ringSmooth = null;
  const MAG_SPOKE = MAG_SWIRL.reduce((s, f) => s + f.arms * f.seg, 0) +
                    MAG_RIM.reduce((s, f) => s + f.arcs * f.seg, 0) + MAG_DASH;
  const MAG_SP_RINGS = 18;             // 最多幾層會帶紋路（六層 × 最多三個陣）
  /* ── 王之財寶（v1.132）─────────────────────────────
     金色的空間門：一片**正對鏡頭**的四邊形，貼上啟動時畫好的漣漪圖（見 paintGateTex）。
     一個門畫兩層（外圈的漣漪 ＋ 內圈的核，兩層反向轉），所以上限是門數的兩倍多一點——
     規則那邊一組 GATE_N（100）個，v1.136 起同時最多 GATE_KEEP（5）組
     （三組還在開新門 ＋ 兩組在收尾），1040 留了一點餘裕。
     不用魔法陣那組環：那組是**貼地**的（rotation.x 寫死 −π/2），而這個要立在半空正對鏡頭。 */
  const GATE_MAX = 1040;
  const GATE_TEX = 256;                    // 貼圖幾像素見方
  let gateMesh = null;
  /* 兵器：一把最多 WEAP_PARTS 塊方塊，全部塞進同一顆 InstancedMesh（跟核彈同一個做法）。
     600 把是「門裡待發的 ＋ 飛在半空的 ＋ 掉在地上還沒淡完的」的量（見規則那邊的
     WEAP_KEEP）——v1.136 同時最多三組在射，光門裡待發的就有三百把。造型表 WEAP_KIND 每一種的長度都正規化成 1、刃尖朝 +Y、原點在正中間，
     所以規則那邊只要給「多長、指向哪」就好，等比縮放不會把比例弄歪。 */
  const WEAP_MAX = 600, WEAP_PARTS = 8;
  let weapMesh = null;
  /* 兩個逐 instance 的屬性（v1.132.1）。
     aCut＝一個**世界座標的切面** vec4(法線 xyz, 面上任一點與法線的內積)：
       比這個面「後面」的片元直接 discard。兵器是從虛空的波紋裡探出來的，
       還沒伸出來的那一段本來就不該看得見——靠門那片圖擋只擋得住它蓋得到的地方，
       斜著看時柄還是會從邊上露出來（使用者回報的第一點）。
       給 vec4(0,0,0,-1) 就是不切（dot=0，0 < −1 不成立）。
     aFade＝這一把的不透明度。插在地上／躺著的要**慢慢變淡**消失（使用者回報的第五點），
       不是縮小——縮小看起來像被吸走，不像化掉。 */
  let weapCut = null, weapFade = null;
  /* 這一格上次畫的是哪一種。顏色只在換種時重寫——每幀重寫 360×8 筆是白花的
     （淡出走的是縮放不是顏色，見規則那邊的 fade）。 */
  const weapSlotKind = new Int16Array(WEAP_MAX).fill(-1);
  /* 一把兵器的組成。p 位移、s 尺寸（都相對於「全長 1」）、c 顏色、r 這一塊自己轉多少
     （刀的弧度、戟的側刃靠它，沒給就是不轉）。
     金色是主調（出自 Fate 系列的王之財寶），刃面壓成偏白的米黃、脊與護手是飽和的金、
     握把是深色——三段分明，遠看才不會糊成一根金條。 */
  /* 刃的寬度是**照參考圖量的**：那張圖裡一柄劍的刃寬約是全長的 6%（刃 6px／全長 100px）。
     第一版憑感覺給 14%，截圖出來每一把都像一片木板不像刀劍——遠看只讀得到「一塊淺色
     的長方形」。所以刃、脊、護手、柄一律收到原本的六成左右。
     顏色分三段：刃是偏白的金（受光材質，白一點才有金屬的高光）、脊與護手是飽和的金、
     柄是深色。三段分明，遠看才不會糊成一根金條。 */
  /* v1.132.2 **拿小人當比例尺再收一次**（使用者：「部分兵器太粗了（粗度可以拿小人做
     對照 小人用兵器的粗度）」）。量出來的世界單位：小人連帽子 2.18 高、他手上那根
     法杖 0.15 見方、鏟柄 0.12。兵器全長 3.6～6.6（門的半徑決定），照舊值換算成世界單位是

       長劍柄 0.20、矛桿 0.17、戟桿 0.20  ← 跟法杖同一個量級，沒問題
       騎槍桿 0.34、騎槍的環 0.66、大劍刃 0.46、刀的鐔 0.35  ← 兩到四倍，就是「部分太粗」

     所以**只收那幾種的橫斷面**（長度一概不動：使用者說的是粗細，而且長度是照參考圖
     訂的，見規則那邊的 GATE_LONG）。收完每一把的桿／柄都落在 0.14～0.22，
     ＝ 法杖的一到一點五倍；最粗的環也從 0.66 收到 0.42。
     看過那一版的截圖之後，使用者說「可以更細一點 長度也縮小一點」，所以橫斷面再乘 0.85、
     全長那邊再收一成（GATE_LONG／GATE_RAD 一起收，門與兵器的比例才不會跑掉）。
     護手與斧面的**寬度**不跟著收：那是輪廓不是粗細，收了會變成一根光禿禿的棒子。 */
  const G_BLADE = 0xf6ecc6, G_SILV = 0xdfe3ea, G_GOLD = 0xe8c33c, G_DEEP = 0xc9922a,
        G_GRIP = 0x6b3a1a, G_DARK = 0x2e2a26;
  const WEAP_KIND = [
    /* 長劍 */
    [{ p: [0, 0.14, 0], s: [0.038, 0.60, 0.015], c: G_BLADE },
     { p: [0, 0.475, 0], s: [0.021, 0.13, 0.013], c: G_BLADE },
     { p: [0, 0.14, 0], s: [0.014, 0.58, 0.021], c: G_DEEP },
     { p: [0, -0.185, 0], s: [0.19, 0.028, 0.030], c: G_GOLD },
     { p: [0, -0.30, 0], s: [0.029, 0.20, 0.029], c: G_GRIP },
     { p: [0, -0.425, 0], s: [0.054, 0.046, 0.046], c: G_GOLD }],
    /* 大劍 */
    [{ p: [0, 0.10, 0], s: [0.053, 0.66, 0.018], c: G_SILV },
     { p: [0, 0.475, 0], s: [0.031, 0.15, 0.016], c: G_SILV },
     { p: [0, 0.10, 0], s: [0.018, 0.64, 0.025], c: G_DEEP },
     { p: [0, -0.25, 0], s: [0.22, 0.030, 0.033], c: G_GOLD },
     { p: [0, -0.205, 0], s: [0.048, 0.040, 0.043], c: G_DEEP },
     { p: [0, -0.36, 0], s: [0.031, 0.20, 0.031], c: G_GRIP },
     { p: [0, -0.47, 0], s: [0.058, 0.044, 0.050], c: G_GOLD }],
    /* 刀：刃切成三段、一段比一段斜，弧度就是這樣折出來的（單一塊方塊只會是直的） */
    [{ p: [0.010, 0.05, 0], s: [0.036, 0.30, 0.015], c: G_BLADE, r: [0, 0, -0.06] },
     { p: [0.046, 0.30, 0], s: [0.034, 0.26, 0.014], c: G_BLADE, r: [0, 0, -0.17] },
     { p: [0.100, 0.465, 0], s: [0.024, 0.13, 0.013], c: G_BLADE, r: [0, 0, -0.32] },
     { p: [0, -0.12, 0], s: [0.10, 0.022, 0.046], c: G_GOLD },
     { p: [-0.02, -0.29, 0], s: [0.031, 0.28, 0.031], c: G_DARK, r: [0, 0, 0.05] },
     { p: [-0.035, -0.45, 0], s: [0.042, 0.036, 0.036], c: G_GOLD }],
    /* 矛 */
    [{ p: [0, -0.16, 0], s: [0.026, 0.66, 0.026], c: G_GRIP },
     { p: [0, 0.30, 0], s: [0.042, 0.24, 0.017], c: G_SILV },
     { p: [0, 0.455, 0], s: [0.021, 0.12, 0.015], c: G_SILV },
     { p: [0, 0.155, 0], s: [0.042, 0.030, 0.042], c: G_GOLD },
     { p: [0, -0.475, 0], s: [0.035, 0.040, 0.035], c: G_GOLD }],
    /* 戟（v1.132.2 重做，使用者圈了這一把說「造型很奇怪」）。兩個原因，截圖比對過：
       ① 斧面只有 0.017 厚 ＝ 全長的 1.7%，轉到邊上看就是一片紙；
       ② **插在地上是頭朝下的**（刃尖沒入地面），所以露在外面的整段都是柄——
          柄佔了全長 78%，畫面上就是一根深棕色的棍子。
       現在：斧面加厚到 3%，柄縮到 70% 並在中間加一道金箍（插在地上時露出來的那一段
       有東西可看），柄色改成跟矛同一個木色——深棕在草地上讀不出是兵器。
       斧面**用三塊折成月牙**（使用者第二次回報：「那一片正方形也是滿怪的」）：
       一塊方板貼在柄上讀起來像鏟子或告示牌。試過三種都拍出來比對過——
       「頸窄刃寬」是兩片高矮不同的板子、「上寬下窄的階梯」像一座小樓梯，
       都不像刃；上下兩塊各轉 ±0.30 弧度、中間一塊直的，折出一個開口朝柄的月牙，
       這個才讀得出是彎刃（同刀那三段折弧度的做法，單一塊方塊只會是方的）。
       八個部位滿了，所以拿掉頭下那道環——月牙中間那塊本來就蓋在那個位置。 */
    [{ p: [0, -0.14, 0], s: [0.026, 0.70, 0.026], c: G_GRIP },
     { p: [0, 0.395, 0], s: [0.024, 0.23, 0.020], c: G_SILV },
     { p: [0.078, 0.372, 0], s: [0.115, 0.055, 0.026], c: G_SILV, r: [0, 0, -0.30] },
     { p: [0.115, 0.298, 0], s: [0.075, 0.115, 0.026], c: G_SILV },
     { p: [0.078, 0.224, 0], s: [0.115, 0.055, 0.026], c: G_SILV, r: [0, 0, 0.30] },
     { p: [-0.070, 0.30, 0], s: [0.095, 0.030, 0.024], c: G_GOLD },
     { p: [0, -0.18, 0], s: [0.040, 0.032, 0.040], c: G_GOLD },
     { p: [0, -0.465, 0], s: [0.036, 0.034, 0.036], c: G_GOLD }],
    /* 騎槍：整支就是一根收尖的金柱，環一圈一圈往下變粗 */
    [{ p: [0, 0.05, 0], s: [0.039, 0.62, 0.039], c: G_GOLD },
     { p: [0, 0.44, 0], s: [0.022, 0.20, 0.022], c: G_BLADE },
     { p: [0, 0.16, 0], s: [0.055, 0.030, 0.055], c: G_DEEP },
     { p: [0, -0.02, 0], s: [0.062, 0.030, 0.062], c: G_DEEP },
     { p: [0, -0.28, 0], s: [0.073, 0.040, 0.073], c: G_GOLD },
     { p: [0, -0.40, 0], s: [0.032, 0.20, 0.032], c: G_GRIP }],
    /* 雙刃短劍：一樣正規化成長度 1，規則那邊給它比較短的全長 */
    [{ p: [0, 0.10, 0], s: [0.051, 0.56, 0.016], c: G_BLADE },
     { p: [0, 0.46, 0], s: [0.029, 0.16, 0.015], c: G_BLADE },
     { p: [0, 0.10, 0], s: [0.016, 0.54, 0.023], c: G_DEEP },
     { p: [0, -0.22, 0], s: [0.155, 0.034, 0.038], c: G_GOLD },
     { p: [0, -0.34, 0], s: [0.032, 0.20, 0.032], c: G_DARK },
     { p: [0, -0.455, 0], s: [0.056, 0.044, 0.046], c: G_GOLD }]
  ];
  // 推土鏟的半寬與它離車體中心多遠。規則那邊直接取這兩個值，畫面與判定才不會各說各話
  const DOZ_W = 3.2, DOZ_FRONT = 3.6;
  const TW_SEG = 16;                // 龍捲風的分段數
  const TW_MAX = 4;                 // 最多同時畫幾道
  const tornadoSegs = [];
  const _axis = new T.Vector3();
  const _xAxis = new T.Vector3(1, 0, 0);    // 閃電：每一段都是從 +X 轉過去的
  const _zAxis = new T.Vector3(0, 0, 1);    // 星光：公告板繞自己的法線自轉
  const _yAxis = new T.Vector3(0, 1, 0);    // 兵器：造型是刃尖朝 +Y，轉到指向哪
  const _spin = new T.Quaternion();
  let W = 1, H = 1;

  const scratch = new T.Object3D();       // 借來組矩陣用，不進場景
  const scratchB = new T.Object3D();
  const tmpM = new T.Matrix4();
  const tmpC = new T.Color();
  const _emoR = new T.Vector3(), _emoU = new T.Vector3();   // 鏡頭的右／上向量（表情圖示用）
  const raycaster = new T.Raycaster();
  const ndc = new T.Vector2();

  /* 軌道相機：自己寫，不引 OrbitControls（那支在 examples/jsm，
     還得多打包一份 ESM，而我們要的功能就這幾行） */
  const cam = { tx: 0, ty: 6, tz: 0, dist: 40, yaw: 0.9, pitch: 0.42, shake: 0, shakeT: 0 };
  const camTarget = { dist: 40, ty: 6, tx: 0, tz: 0 };
  /* 開場的角度留一份給復位用（C）。只寫在 cam 那行一處，兩邊不會對不起來 */
  const CAM0 = { yaw: cam.yaw, pitch: cam.pitch };
  let camGo = null;                        // 復位中的角度過渡，見 resetCamera
  /* 平移速度跟目前視距成正比——拉遠之後還用同一個速度會像在爬。
     視距 60 時約每秒 36 單位，橫越整片工地約兩秒。 */
  const PAN_SPD = 0.6;
  /* 升降（Z／X）比平移慢一半：上下要走的路本來就比橫越整片工地短得多。
     視距 312（艾菲爾鐵塔的取景距離）時每秒 94 單位，整段上下界走完約 1.4 秒。 */
  const LIFT_SPD = 0.3;
  /* 取景留白。1 = 建築剛好貼齊畫面邊，越大退越遠、四周留白越多。
     1.27 是量出來的：36 座 × 4 個角度掃過去，最擠的一座（3000 塊的美國國會大廈）
     佔畫面 0.80，一般的落在 0.74，上緣不會頂到工具列。 */
  const FIT_MARGIN = 1.27;
  /* 手機版的斷點，跟 index.html 那條 @media (max-width:640px) 同一個數字：
     版面切成手機那一套的同時，取景也切回原本的「看腰間」（見 fitCamera）。 */
  const MOBILE_W = 640;
  /* 爆炸運鏡的留白。比 FIT_MARGIN 小：那個是給建築的（四周要留白才好看），
     這裡只要求「效果整個進得了畫面」，留太多等於白白把鏡頭往後推。 */
  const HOLD_MARGIN = 1.15;
  /* 畫面震動要看視距才算數：位移是固定的世界座標（最多 2.6 單位），
     換算到畫面上，視距 10 時那 2.6 單位是偏 14.6°、視距 66 只剩 2.3°。
     貼著建築看的時候同一發爆炸會晃到看不清楚，所以視距 SHAKE_NEAR 以下完全不震，
     到 SHAKE_FULL 才是全額，中間線性接起來——硬切的話滾輪停在門檻附近會忽晃忽不晃。 */
  const SHAKE_NEAR = 24, SHAKE_FULL = 48;
  let lastFit = null;                      // 最後一次取景的參數，畫面比例變了要拿它重算

  const BS = 0.94;                         // 積木實際邊長（留 0.06 縫，看得出一塊一塊）
  /* 積木池上限。**地標 ＋ 小人的村子兩份都要塞得下**，因為它們共用這一個池子：
       · 地標：面板最大那一檔是 9000，但 fitScale 挑的是「最接近目標」的那一階，
         可能落在目標之上——76 座裡最大的是萬里長城 9932（+10%）。
         池子不夠的話 reconcilePool 會夾住，那座就永遠少幾百塊、蓋不完。
       · 村子：閒晃事件蓋的小房子（見 game-workers.js 的 homes）是**從地上挖出來的新積木**，
         不佔地標那一份。每個人最多一間，所以人數決定上限——實測 60 人跑到飽是
         43 間 5405 格（20 人是 12 間 1661 格）。
     11500（v1.42）只夠 9932 ＋ 1568，於是 9000 那一檔配 40／60 人時池子會撐滿：
     digBlock 開頭的 blocks.length >= MAXB 一直回 false，小人對著地面挖不出東西，
     房子永遠差幾百格（實測 60 人第一座就失敗 7629 次、之後每座 13000+ 次全失敗，
     留下 41 間蓋不完的空屋）。所以改成「最大的地標 ＋ 最大的村子」9932 ＋ 5405
     ＝ 15337，再留五間房子的餘裕：16000。
     成本：instanceMatrix 是 16 個 float ×16000 ≈ 1.0MB，一次性配置，不影響每幀；
     每幀成本看的是**實際有幾塊**，不是這個上限（量到的數字見 README〈積木池上限〉）。 */
  const MAXB = 16000;
  const MAXW = 80;                         // 小人上限
  /* 每個小人的部位數，要跟 BODY 的長度一模一樣。7 個身體部位 ＋ 藍圖 ＋ 聊天泡泡兩塊
     ＋ v1.51 補的七塊細節（帽頂、帽舌、兩顆眼睛、兩隻鞋、腰帶）
     ＋ v1.64 魔法師的五塊（巫師帽三塊、法杖、寶珠）
     ＋ v1.112 肌肉小人的五塊（胸膛、兩塊肩、兩塊胸肌）
     ＋ v1.129 挖料的鏟子兩塊（柄、鏟面）
     （v1.121 曾經有表情圖示的八塊，v1.122 換成貼圖之後收掉了，見 paintEmoAtlas）。
     道具沒拿的人整片縮到 0；全部共用同一個 InstancedMesh，不多一個 draw call。
     實測 60 個人擺一輪：10 塊時 0.106ms、17 塊時 0.150ms——每幀預算 4ms，加得起。 */
  const WPARTS = 29;
  /* 蘑菇雲一朵就吃掉三百多顆，420 會把爆炸的煙擠掉。
     核彈還會一次點著整棟的碎料（那些煙又是兩百多顆），兩邊要同時演得下才夠。
     v1.118 從 720 加到 900：打雷的烏雲也借這顆 mesh 畫（一朵 150 團），
     三朵同時在場加上塵霧本身實測峰值 851 顆——留在 720 的話第三朵會被默默切掉三成。
     成本只有容量（多 180 個 instance 的記憶體）：每幀的迴圈是照實際顆數跑的。
     v1.123 再加到 3400：烏雲一朵從 150 團變 700 團（面積放大一倍 ＋ 顆粒細一級，
     見 STORM_PUFF），蘑菇雲也一起變細（傘蓋 112 → 440 顆、柱子與煙裙的每秒生成量
     各加一倍多，見 CLOUD_TOP）。
     3400 是照**最壞的一幕**訂的：三朵烏雲（2100 團）＋ 一發核彈的蘑菇雲與火苗煙
     （1069 顆）＝ 3169 顆。這個數字非留不可——被切掉的是清單尾巴，而烏雲接在
     dust 後面（見 game-tools.js 的 dustList），砍到 2200 的話第三朵會整朵不見。
     顆數變多不等於變貴：兩邊的**覆蓋度**都幾乎沒動（顆粒同時變小），GPU 那邊的
     填色量就差不多；CPU 那邊量過那一幕 draw() 0.29ms → 0.57ms（每幀預算 4ms）。 */
  const MAXDUST = 3400;

  /* ── 草皮的花紋（v1.90）─────────────────────────────────
     使用者要「地面綠色增加草地感」。整片單色綠讀起來是一塊綠地板，不是草。
     做法是程式現畫一張貼圖平鋪上去，不用外部圖檔——「雙擊 HTML 就能玩」的前提下
     多一個要載入的資產就多一種載不到的失敗，而且 file:// 讀圖也會被 CORS 擋。
     一格 GRASS_TILE 個世界單位，所以草的顆粒大小跟草地島多大無關
     （島的邊長跟著建築走，見 setGroundSize）。
     畫三層：底色 → 低頻的深淺斑塊（一塊一塊的草皮）→ 細碎的草葉。 */
  const GRASS_TILE = 30;            // 一張貼圖鋪幾個世界單位
  let grassTex = null;
  function grassTexture() {
    const S = 512, cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const g = cv.getContext('2d');
    g.fillStyle = '#5f8f3e';        // 底色沿用 v1.89 之前那片純綠，整體色調不變
    g.fillRect(0, 0, S, S);
    /* 斑塊要畫九份（自己＋八個方向的鄰居）才接得起來：只畫一份的話，
       平鋪之後每一格的邊緣都會出現一條硬邊，看起來像鋪了地磚。 */
    const blotch = (x, y, r, c) => {
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const cx = x + dx * S, cy = y + dy * S;
        const grd = g.createRadialGradient(cx, cy, 0, cx, cy, r);
        grd.addColorStop(0, 'rgba(' + c + ',0.5)');
        grd.addColorStop(1, 'rgba(' + c + ',0)');
        g.fillStyle = grd;
        g.fillRect(cx - r, cy - r, r * 2, r * 2);
      }
    };
    for (let i = 0; i < 70; i++)
      blotch(Math.random() * S, Math.random() * S, 30 + Math.random() * 70,
             Math.random() < 0.5 ? '116,162,74' : '58,110,44');
    for (let i = 0; i < 140; i++)
      blotch(Math.random() * S, Math.random() * S, 8 + Math.random() * 22,
             Math.random() < 0.5 ? '134,176,86' : '52,100,40');
    /* 草葉：一到兩像素寬、兩到四像素高的短撇。密度是量出來的——
       少於三千顆看起來像雜訊、多於一萬二會糊成一片深綠。 */
    for (let i = 0; i < 9000; i++) {
      const t = Math.random();
      g.fillStyle = t < 0.45 ? 'rgba(124,170,84,0.55)'
                  : t < 0.8 ? 'rgba(62,112,46,0.5)' : 'rgba(152,180,92,0.4)';
      g.fillRect(Math.random() * S, Math.random() * S,
                 1 + Math.random(), 2 + Math.random() * 2);
    }
    const tx = new T.CanvasTexture(cv);
    tx.wrapS = tx.wrapT = T.RepeatWrapping;
    // 草地是斜看過去的一大片，不開非等向過濾的話遠處會糊成一條一條的摩爾紋
    tx.anisotropy = renderer.capabilities.getMaxAnisotropy();
    tx.colorSpace = T.SRGBColorSpace;
    return tx;
  }

  /* shader 注入的小工具。注入的做法是對 three 的 chunk 名字做字串取代，而
     **取代不到是靜默的**：哪天 three 把某個 chunk 改名（`output_fragment` →
     `opaque_fragment` 就發生過），那一刀什麼都不會發生、也不會報錯，畫面默默退回
     沒注入的樣子（積木沒有深色邊、水變回死板的藍）。所以每一刀都記一筆有沒有真的換到，
     材質把數字放在 userData.cuts，測試盯著它。 */
  function injector() {
    let n = 0;
    const cut = (src, anchor, add) => {
      const out = src.replace(anchor, anchor + add);
      if (out !== src) n++;
      return out;
    };
    cut.count = () => n;
    return cut;
  }

  /* ── 材質：在 Lambert 上加一圈深色邊，voxel 才有實體感 ──
     邊緣判定不靠 uv（不同 three 版本 uv attribute 有沒有宣告不一定），
     改用 local position：單位方塊的座標是 ±0.5，
     「離面內邊緣的距離」＝ 0.5 −（三軸絕對值的第二大者）。 */
  /* extra：這一份材質要在四刀之外再注入什麼（v1.132.1 的兵器用）。
     **加了 extra 就一定要換一把 program cache key**——同一把 key 的材質 three 只編一次
     program 然後共用，沿用 'voxel-edge' 的話它會直接拿積木那份編好的來用，
     這裡注入的東西會靜默消失（畫面看起來像沒寫過，也不會報錯）。 */
  function voxelMaterial(opt, extra) {
    const m = new T.MeshLambertMaterial(opt);
    m.onBeforeCompile = sh => {
      const cut = injector();
      sh.vertexShader = cut(sh.vertexShader, '#include <common>', '\nvarying vec3 vLocalPos;');
      sh.vertexShader = cut(sh.vertexShader, '#include <begin_vertex>', '\nvLocalPos = position;');
      sh.fragmentShader = cut(sh.fragmentShader, '#include <common>', '\nvarying vec3 vLocalPos;');
      sh.fragmentShader = cut(sh.fragmentShader, '#include <color_fragment>', `
          vec3 ap = abs(vLocalPos);
          float mx = max(ap.x, max(ap.y, ap.z));
          float mn = min(ap.x, min(ap.y, ap.z));
          float second = ap.x + ap.y + ap.z - mx - mn;
          float edge = smoothstep(0.0, 0.055, 0.5 - second);
          diffuseColor.rgb *= mix(0.62, 1.0, edge);
        `);
      if (extra) extra(sh, cut);
      m.userData.cuts = cut.count();               // 給測試看：四刀都換到了嗎
    };
    m.customProgramCacheKey = () => (extra ? 'voxel-edge-weapon' : 'voxel-edge');
    return m;
  }

  /* ── 水面材質（v1.94）──
     v1.69～v1.93 用的是 MeshBasicMaterial：**不吃光**，所以不管從哪個角度看、
     頂面還是側壁，都是同一片均勻的藍——使用者看到的是「藍色果凍／玻璃罩」。
     換成 Phong 之後三件事同時解決：頂面吃到天光（HemisphereLight 的頂面本來就比側面亮）
     ＋太陽的漫射，側壁自然暗一階（**頂／側分色不必自己刷色**）；再加上高光，
     轉視角時水面會有一塊亮的移過去。

     **flatShading 是這裡的關鍵**：這顆網格每幀重寫頂點，只有 position 一條 attribute，
     多一條 normal 就多 3 個 float／頂點的上傳。three.js 的 flatShading 走的是
     `normal_fragment_begin` 裡的 `cross(dFdx(vViewPosition), dFdy(vViewPosition))`
     ——法線是 fragment 端從螢幕微分算出來的，**用不到 normal attribute**。
     這顆網格全都是軸對齊的平面，微分算出來的就是那個面真正的法線，一毛頂點成本都沒加。 */
  function poolMaterial() {
    const m = new T.MeshPhongMaterial({
      /* 光分成「常數底（emissive）＋ 較弱的漫射（color）」，不是全部走漫射（v1.94.1）。
         為什麼要這樣拆：水面是一格一個水位、每一拍都在改的東西，**頂面與側壁的亮度差
         越大，那些一格一格的變化就越搶眼**。使用者回報「水面會一跳一跳」，實測
         （同一份水面狀態、同一個機位，連續 12 幀變動的像素）：
           全走漫射　　　　平均 4805、最高 15286
           常數底 ＋ 半漫射 平均 3080、最高 10504　← 這一版
           v1.93 不吃光　　平均 1625、最高　6013
         動的一直都在動（幾何完全相同），差別只在看不看得出來；拆成常數底之後
         少掉四成，而**高光、波紋、泡沫、菲涅耳全部留著**——那些才是「像水」的來源，
         頂／側分色只是附帶的。要完全回到 v1.93 那麼平靜只能不吃光，那就整片死藍了。
         這兩個數字是配著調的：0x2e5a74 是 0x5cb4e8 的一半、0x336380 是它的 0.55，
         加起來的亮度跟全走漫射時差不多（實測 112 vs 123.8，v1.93 是 141.4）。 */
      color: 0x2e5a74, emissive: 0x336380,
      specular: 0x9ad9f6, shininess: 130, flatShading: true,
      /* 透明度從 0.62 降到這裡：有了光照與高光，水面看得出來是水面，
         就不必靠「濃」來讓人看見它了——淡一點反而通透（水底的草看得到）。
         底色補亮＋這裡調淡之後，跟 v1.93 比是 0.81 倍亮（同上實測 116.1 vs 144）。 */
      transparent: true, opacity: 0.52, depthWrite: false,
      /* 兩面都畫（從水面下往上看也要看得到），但**要 forceSinglePass**：
         three.js 對「透明 + DoubleSide」預設會拆成背面／正面兩趟畫，
         那就變成 2 個 draw call（實測 11 → 13）。 */
      side: T.DoubleSide, forceSinglePass: true
    });
    m.onBeforeCompile = sh => {
      poolUni = sh.uniforms;
      sh.uniforms.uWTime = { value: 0 };
      /* 六刀，一刀都不能靜默失效——見 injector 那段。畫面像素那條哨兵擋不住
         單一注入點失效（實測只死掉波紋那一刀，泡沫那道波還在動，變的像素只從
         8% 掉到 5%，門檻抓不到），所以直接數刀數。 */
      const cut = injector();
      /* position 存的就是**世界座標**（putPools 直接填世界座標、這顆網格沒有位移），
         所以世界座標的波紋不用乘任何矩陣，vWPos = position 就是了。 */
      sh.vertexShader = cut(sh.vertexShader, '#include <common>', `
          attribute float aFoam;
          varying float vFoam;
          varying vec3 vWPos;`);
      sh.vertexShader = cut(sh.vertexShader, '#include <begin_vertex>', `
          vFoam = aFoam;
          vWPos = position;`);
      sh.fragmentShader = cut(sh.fragmentShader, '#include <common>', `
          uniform float uWTime;
          varying float vFoam;
          varying vec3 vWPos;`);
      /* 波紋：**不動頂點，只動法線**。
         動頂點（把水面那幾個頂點上下推）的話，側壁的上緣不會跟著動——水面與側壁
         之間就會裂開一條縫，而側壁只畫在水體外緣，那正是最顯眼的地方。
         改成在 fragment 端擾動法線：幾何一格都沒變（三角形數量不變，
         「水想畫幾面 × 2」那條測試才還成立），但高光會跟著波跑，看起來就是波光粼粼。
         波高 h 是三道不同方向、不同波長的正弦疊起來（單一方向會看得出是一條一條在跑），
         法線就是它的斜率：n = normalize(−∂h/∂x, 1, −∂h/∂z)。三道波往不同方向漂，
         所以水面看起來是「在流」的，不必貼流動的法線貼圖（也就不必多一張圖與 uv）。 */
      sh.fragmentShader = cut(sh.fragmentShader, '#include <normal_fragment_begin>', `
          /* 這裡的 normal 是 view space，所以「哪一面朝上」要拿世界的上方向去比 */
          vec3 wUp = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
          float wFace = dot(normal, wUp);
          float wFres = 0.0;
          if (abs(wFace) > 0.5) {                       // 只有水面（頂面／底面）起波，側壁不起
            vec2 q = vWPos.xz;
            float a1 = dot(q, vec2( 1.9, 0.7)) + uWTime * 2.3;
            float a2 = dot(q, vec2(-0.8, 2.4)) + uWTime * 1.7;
            float a3 = dot(q, vec2( 4.3, 4.3)) - uWTime * 3.1;
            float dx = 0.045 *  1.9 * cos(a1) + 0.040 * -0.8 * cos(a2) + 0.012 * 4.3 * cos(a3);
            float dz = 0.045 *  0.7 * cos(a1) + 0.040 *  2.4 * cos(a2) + 0.012 * 4.3 * cos(a3);
            vec3 wn = normalize(vec3(-dx, 1.0, -dz)) * (wFace > 0.0 ? 1.0 : -1.0);
            normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
          }
          /* 菲涅耳：越是斜著看，水面越反光也越不透。垂直往下看得到水底，
             斜著看幾乎只看得到反光——這一項就是「水」跟「有顏色的玻璃」的差別。 */
          wFres = pow(1.0 - clamp(abs(dot(normalize(vViewPosition), normal)), 0.0, 1.0), 3.0);`);
      /* 泡沫：水體外緣那一圈的水面刷白，而且更不透明（真的泡沫是白的、不透光）。
         一格一格的旗標會露出方格的直角，所以再乘一道波——邊界就變成會抖的、
         有濃有淡的一條，不是描邊。 */
      sh.fragmentShader = cut(sh.fragmentShader, '#include <color_fragment>', `
          if (vFoam > 0.0) {
            float fw = 0.5 * sin(vWPos.x * 3.1 + uWTime * 2.2)
                     + 0.5 * sin(vWPos.z * 2.7 - uWTime * 1.9);
            float foam = clamp(vFoam * (0.16 + 0.48 * fw), 0.0, 0.55);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.95, 1.0), foam);
            diffuseColor.a = mix(diffuseColor.a, min(1.0, diffuseColor.a * 1.3), foam);
          }`);
      sh.fragmentShader = cut(sh.fragmentShader, '#include <dithering_fragment>', `
          gl_FragColor.a = min(1.0, gl_FragColor.a + wFres * 0.30);`);
      m.userData.cuts = cut.count();               // 給測試看：六刀都換到了嗎
    };
    m.customProgramCacheKey = () => 'pool-wave';
    return m;
  }

  function init(cvs) {
    canvas = cvs;
    renderer = new T.WebGLRenderer({ canvas: cvs, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;

    scene = new T.Scene();
    scene.fog = new T.Fog(0xbcd3e0, 90, 320);

    camera = new T.PerspectiveCamera(48, 1, 0.5, 900);

    scene.add(new T.HemisphereLight(0xd8ecff, 0x5b7a48, 1.25));  // 天光：頂面自然比側面亮
    sun = new T.DirectionalLight(0xfff3dd, 1.75);
    sun.position.set(38, 60, 26);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 260;
    sun.shadow.bias = -0.0012;
    sun.shadow.normalBias = 0.03;
    scene.add(sun, sun.target);

    /* 草地島：草皮一塊、土層一塊。
       用兩個 mesh 而不是「一個 box 配 6 個材質」——後者會變成 6 個 draw call，
       前者只要 2 個，畫面完全一樣。草皮比土層外擴一點，邊緣才有草蓋住土的層次。 */
    const unitBox = new T.BoxGeometry(1, 1, 1);
    dirtPad = new T.Mesh(unitBox, new T.MeshLambertMaterial({ color: 0x6f5134 }));
    grassRim = new T.Mesh(unitBox, new T.MeshLambertMaterial({ color: 0x8a6b3f }));  // 草皮與土層之間的切邊
    grassTex = grassTexture();
    ground = new T.Mesh(unitBox, new T.MeshLambertMaterial({ color: 0xffffff, map: grassTex }));
    ground.receiveShadow = true;
    scene.add(dirtPad, grassRim, ground);
    setGroundSize(120);

    const unit = new T.BoxGeometry(1, 1, 1);

    blockMesh = new T.InstancedMesh(unit, voxelMaterial({}), MAXB);
    blockMesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    blockMesh.castShadow = blockMesh.receiveShadow = true;
    blockMesh.count = 0;
    blockMesh.frustumCulled = false;   // 整池共用一個包圍球，交給我們自己管
    scene.add(blockMesh);
    // 先配置 instanceColor，之後 setColorAt 才不會每次重建
    blockMesh.setColorAt(0, tmpC.setHex(0xffffff));

    workerMesh = new T.InstancedMesh(unit, voxelMaterial({}), MAXW * WPARTS);
    workerMesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    workerMesh.castShadow = true;
    workerMesh.count = 0;
    workerMesh.frustumCulled = false;
    scene.add(workerMesh);
    workerMesh.setColorAt(0, tmpC.setHex(0xffffff));

    /* 天災那幾隻（v1.138）。跟小人同一個做法：一隻一疊方塊，全部塞進同一顆
       InstancedMesh。場上同時最多 MAXBEAST 個（含飛在半空的香蕉炸彈）。 */
    beastMesh = new T.InstancedMesh(unit, voxelMaterial({}), MAXBEAST * BEAST_PARTS);
    beastMesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    beastMesh.castShadow = true;
    beastMesh.count = 0;
    beastMesh.frustumCulled = false;
    scene.add(beastMesh);
    beastMesh.setColorAt(0, tmpC.setHex(0xffffff));

    trunkMesh = new T.InstancedMesh(unit, voxelMaterial({ color: 0x6b4a2f }), 64);
    leafMesh = new T.InstancedMesh(unit, voxelMaterial({}), 64 * 3);
    for (const m of [trunkMesh, leafMesh]) {
      m.instanceMatrix.setUsage(T.DynamicDrawUsage);
      m.castShadow = true; m.count = 0; m.frustumCulled = false;
      scene.add(m);
    }
    leafMesh.setColorAt(0, tmpC.setHex(0xffffff));

    /* 塵霧：不投影、不受光，用 Basic 才不會被陰影吃掉 */
    dustMesh = new T.InstancedMesh(unit,
      new T.MeshBasicMaterial({ transparent: true, opacity: 0.62, depthWrite: false }), MAXDUST);
    dustMesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    dustMesh.count = 0;
    dustMesh.frustumCulled = false;
    scene.add(dustMesh);
    dustMesh.setColorAt(0, tmpC.setHex(0xffffff));

    /* 破壞道具：鐵球。v1.116 起可以同時有好幾顆（使用者：「保齡球可以多顆」），
       所以跟龍捲風一樣走 instancing——幾顆都是同一個 draw call；
       沒球的時候 visible = false，一個 call 都不吃（見 README〈效能〉）。 */
    ballMesh = new T.InstancedMesh(new T.SphereGeometry(1, 18, 14),
      new T.MeshLambertMaterial({ color: 0x3a3f47 }), MAXBALL);
    ballMesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    ballMesh.castShadow = true; ballMesh.count = 0;
    ballMesh.visible = false; ballMesh.frustumCulled = false;
    scene.add(ballMesh);

    /* 槌子：槌頭朝 local +Z，握把往 −Z 拖在後面。
       擺位時用 lookAt 對準落點——three 的 lookAt 對非相機物件是讓 +Z 指向目標。 */
    hammerGroup = new T.Group();
    // 尺寸抓得跟衝擊半徑（5.5）相稱，太小的話砸下去的份量感對不上散開的範圍
    const hHandle = new T.Mesh(new T.BoxGeometry(0.44, 0.44, 5), voxelMaterial({ color: 0x8a5a34 }));
    hHandle.position.z = -2.8;
    const hHead = new T.Mesh(new T.BoxGeometry(3, 3, 1.9), voxelMaterial({ color: 0x474e57 }));
    hHead.position.z = 0.2;
    const hFace = new T.Mesh(new T.BoxGeometry(3.2, 3.2, 0.35), voxelMaterial({ color: 0x707a85 }));
    hFace.position.z = 1.3;
    for (const m of [hHandle, hHead, hFace]) { m.castShadow = true; hammerGroup.add(m); }
    hammerGroup.visible = false;
    scene.add(hammerGroup);

    /* 龍捲風：用一疊會各自轉、各自偏移的開口圓筒疊出扭曲的漏斗。
       單一個圓錐太乾淨，看起來只是個半透明三角形。

       一層一顆 InstancedMesh、每道龍捲風在每層各占一個 instance：
       濃淡是逐層不同的（材質不同，沒辦法併成一顆），但同一層不管場上有幾道
       都只吃一個 draw call——所以總成本固定是 TW_SEG，不隨龍捲風數量增加。 */
    tornadoGroup = new T.Group();
    const twGeo = new T.CylinderGeometry(1, 1, 1, 20, 1, true);
    for (let i = 0; i < TW_SEG; i++) {
      const t = i / (TW_SEG - 1);
      // 下濃上淡：整條才有「往上散開」的層次，全部同一個透明度會像一片平板
      const m = new T.InstancedMesh(twGeo, new T.MeshBasicMaterial({
        color: t < 0.35 ? 0xb9c4cd : 0xdde6ee,
        transparent: true, opacity: 0.30 - t * 0.19,
        // forceSinglePass：透明的雙面材質 three 預設分兩趟畫，draw call 直接翻倍。
        // 這是一層薄霧，用不到那個排序
        side: T.DoubleSide, depthWrite: false, forceSinglePass: true
      }), TW_MAX);
      m.instanceMatrix.setUsage(T.DynamicDrawUsage);
      m.count = 0; m.frustumCulled = false;
      tornadoSegs.push(m); tornadoGroup.add(m);
    }
    tornadoGroup.visible = false;
    scene.add(tornadoGroup);

    /* 投石機：每台三個部位（底座、立柱、拋臂）全塞進同一個 InstancedMesh，
       四台machine 也只吃 1 個 draw call。飛石另開一個。 */
    trebMesh = new T.InstancedMesh(unit, voxelMaterial({}), MAXTREB * TREB_PARTS);
    rockMesh = new T.InstancedMesh(unit, voxelMaterial({ color: 0x6b6660 }), MAXROCK);
    dozMesh = new T.InstancedMesh(unit, voxelMaterial({}), MAXDOZ * DOZ_PARTS);
    for (const m of [trebMesh, rockMesh, dozMesh]) {
      m.instanceMatrix.setUsage(T.DynamicDrawUsage);
      m.castShadow = true; m.count = 0; m.frustumCulled = false;
      scene.add(m);
    }
    trebMesh.setColorAt(0, tmpC.setHex(0xffffff));
    dozMesh.setColorAt(0, tmpC.setHex(0xffffff));

    /* 消防車（v1.68）。跟推土機同一套：整台車的部位塞進一顆 InstancedMesh，
       所以**一台跟兩台一樣貴**（它會投影，在場時是 2 個 draw call：主畫面 + 陰影那一趟）。
       差別是它照新規矩「沒車就 visible=false」——建造中沒火的時候一台都不在場，
       不該為了它固定付這個錢。 */
    trkMesh = new T.InstancedMesh(unit, voxelMaterial({}), MAXTRUCK * TRK_PARTS);
    trkMesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    trkMesh.castShadow = true; trkMesh.count = 0;
    trkMesh.frustumCulled = false; trkMesh.visible = false;
    trkMesh.setColorAt(0, tmpC.setHex(0xffffff));
    scene.add(trkMesh);

    /* 水窪（v1.69，v1.80 從「一格一個方塊」換成**一整片網格**）。
       透明、不寫深度、不投影——在場時只吃 1 個 draw call（會投影的才要多跑一趟陰影，
       見消防車那段），沒水的時候 visible=false 一個都不吃。

       為什麼不用 instancing 疊方塊：水是透明又不寫深度的，一格一個方塊的話**每一格的
       側面都會透過鄰居的水面疊上去**，一整片水面看起來像鋪磁磚（使用者截圖）。
       v1.76～1.79 的擋法是「被水包住的柱子只畫貼著水面的一層」，方格紋沒了，
       但水面以下就整個不見了——泡在水裡的積木看起來是乾的（使用者：「水面下的水體
       看不見」）。現在改成規則那邊算好「哪幾面露在外面」，這裡只把那些面組成三角形：
       水有厚度、泡在水裡的東西有水色，而且**內部的面根本不存在**，沒有方格紋。
       頂點資料每幀重寫（水面會漲會退），所以是 DynamicDrawUsage。 */
    poolGeo = new T.BufferGeometry();
    poolPos = new Float32Array(MAXPOOLV * 3);
    const poolAttr = new T.BufferAttribute(poolPos, 3);
    poolAttr.setUsage(T.DynamicDrawUsage);
    poolGeo.setAttribute('position', poolAttr);
    /* 泡沫旗標（v1.94）：每個頂點一個 0／1——「這一面是水體外緣的水面」。
       一個 float 就夠，比法線（3 個）便宜；法線根本不用傳，見下面 flatShading。 */
    poolFoam = new Float32Array(MAXPOOLV);
    const foamAttr = new T.BufferAttribute(poolFoam, 1);
    foamAttr.setUsage(T.DynamicDrawUsage);
    poolGeo.setAttribute('aFoam', foamAttr);
    poolGeo.setDrawRange(0, 0);
    poolMesh = new T.Mesh(poolGeo, poolMaterial());
    poolMesh.frustumCulled = false; poolMesh.visible = false;
    scene.add(poolMesh);

    /* 地面痕跡（v1.88）：炸過的地方一塊焦黑、隕石一個坑，都會漸漸淡掉。
       跟水那顆網格同一套做法——**每幀重組一份三角形**，不是一塊痕跡一顆網格：
       一顆網格就是一個 draw call，二十幾塊痕跡等於二十幾個；合成一份之後
       不管幾塊都只吃 1 個，沒痕跡時 visible=false 一個都不吃。
       濃淡與柔邊都靠**逐頂點的 RGBA**（外圈 alpha 給 0，邊就是糊的）——
       這一版整支程式沒有任何貼圖，柔邊只能這樣做。
       材質用 Lambert 不用 Basic：草地是 Lambert，兩邊吃同一顆太陽，
       痕跡才不會在建築的陰影裡變成一塊比草地還亮的補丁。 */
    markGeo = new T.BufferGeometry();
    markPos = new Float32Array(MARKV * 3);
    markCol = new Float32Array(MARKV * 4);          // RGBA：alpha 就是「淡到什麼程度」
    const markNrm = new Float32Array(MARKV * 3);
    for (let i = 0; i < MARKV; i++) markNrm[i * 3 + 1] = 1;   // 全部朝上，開場填一次就好
    const markPosAttr = new T.BufferAttribute(markPos, 3);
    const markColAttr = new T.BufferAttribute(markCol, 4);
    markPosAttr.setUsage(T.DynamicDrawUsage);
    markColAttr.setUsage(T.DynamicDrawUsage);
    markGeo.setAttribute('position', markPosAttr);
    markGeo.setAttribute('color', markColAttr);
    markGeo.setAttribute('normal', new T.BufferAttribute(markNrm, 3));
    markGeo.setDrawRange(0, 0);
    markMesh = new T.Mesh(markGeo, new T.MeshLambertMaterial({
      vertexColors: true, transparent: true, depthWrite: false
    }));
    markMesh.receiveShadow = true;
    markMesh.frustumCulled = false; markMesh.visible = false;
    scene.add(markMesh);

    /* 定時炸彈：可以同時放好幾顆，走 instancing。
       新道具的網格一律「沒在用就 visible=false」——InstancedMesh 就算 count=0
       還是會吃掉一個 draw call，平常不該為了沒放的道具付這個錢。 */
    bombMesh = new T.InstancedMesh(unit, voxelMaterial({}), MAXBOMB * BOMB_PARTS);
    bombMesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    bombMesh.castShadow = true; bombMesh.count = 0;
    bombMesh.frustumCulled = false; bombMesh.visible = false;
    scene.add(bombMesh);
    bombMesh.setColorAt(0, tmpC.setHex(0xffffff));

    /* 隕石：一顆一個 instance。石頭本體走 instance color，越接近落地燒得越紅
       （火焰本身是 hot 那批粒子拖出來的，這裡只負責那顆石頭）。 */
    meteorMesh = new T.InstancedMesh(unit, voxelMaterial({}), MAXMET);
    meteorMesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    meteorMesh.castShadow = true; meteorMesh.count = 0;
    meteorMesh.frustumCulled = false; meteorMesh.visible = false;
    scene.add(meteorMesh);
    meteorMesh.setColorAt(0, tmpC.setHex(0xffffff));

    /* 核彈：彈體朝 −Y 落下。v1.59 起可以同時有好幾顆，所以七個部位全部塞進
       同一顆 InstancedMesh（跟小人一樣的做法）——四顆核彈 28 個 instance、
       還是 1 個 draw call，比原本一顆就吃 7 個 Mesh 還省。 */
    const nParts = [
      [[0, 2.6, 0], [1.7, 4.4, 1.7], 0x5c636d],        // 彈體
      [[0, 0.5, 0], [1.25, 1.1, 1.25], 0xb8402f],      // 彈頭
      [[0, 3.7, 0], [1.85, 0.5, 1.85], 0xe8c33c],      // 警戒環
      [[-0.9, 5.2, 0], [0.22, 1.7, 1.6], 0x767d87],    // 尾翼 ×4
      [[0.9, 5.2, 0], [0.22, 1.7, 1.6], 0x767d87],
      [[0, 5.2, -0.9], [1.6, 1.7, 0.22], 0x767d87],
      [[0, 5.2, 0.9], [1.6, 1.7, 0.22], 0x767d87]
    ];
    nukeMesh = new T.InstancedMesh(unit, voxelMaterial({ color: 0xffffff }),
                                   NUKE_MAX * nParts.length);
    nukeMesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    nukeMesh.castShadow = true;
    nukeMesh.count = 0; nukeMesh.frustumCulled = false; nukeMesh.visible = false;
    scene.add(nukeMesh);
    /* 部位的顏色一顆核彈裡是固定的，開場一次寫完就好——每幀重寫等於白花一次上傳 */
    for (let i = 0; i < NUKE_MAX; i++)
      for (let k = 0; k < nParts.length; k++)
        nukeMesh.setColorAt(i * nParts.length + k, tmpC.setHex(nParts[k][2]));
    NUKE_PARTS = nParts;

    /* 火球：跟塵霧分開一個 mesh。塵霧那顆材質固定 50% 透明（煙就是要透），
       火球用同一顆的話永遠亮不起來，爆炸看起來就只是幾片橘色玻璃。
       這顆幾乎不透明、而且寫深度，才會像實體的火。 */
    fireMesh = new T.InstancedMesh(unit,
      new T.MeshBasicMaterial({ transparent: true, opacity: 0.95 }), MAXFIRE);
    fireMesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    fireMesh.count = 0; fireMesh.frustumCulled = false; fireMesh.visible = false;
    scene.add(fireMesh);
    fireMesh.setColorAt(0, tmpC.setHex(0xffffff));

    /* 火球的球殼：一層一顆 InstancedMesh，同時炸幾發都只吃 FLASH_SHELL.length 個
       draw call。顏色走 instance color——加法混色下 instance color 就是亮度旋鈕，
       亮度衰減與魔法版的粉紅都靠它，材質不用每幀改。
       不寫深度但照樣測深度：埋在地面下的那半自然被草地擋掉，剩下的就是一頂圓罩。 */
    flashGroup = new T.Group();
    const flGeo = new T.SphereGeometry(1, 20, 14);
    for (const sh of FLASH_SHELL) {
      const m = new T.InstancedMesh(flGeo, new T.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: sh.op,
        depthWrite: false, blending: T.AdditiveBlending
      }), FLASH_MAX);
      m.instanceMatrix.setUsage(T.DynamicDrawUsage);
      m.count = 0; m.frustumCulled = false;
      m.setColorAt(0, tmpC.setHex(0xffffff));
      flashShells.push(m); flashGroup.add(m);
    }
    flashGroup.visible = false;
    scene.add(flashGroup);

    /* 十字星光：一片薄薄的四角星（中心一點 + 外圈八個尖凹交錯的點接成扇形）。
       畫成平面而不是方塊，是因為要的就是那四道尖角；每幀轉向鏡頭，
       所以不管軌道相機轉到哪，看到的都是正面那個十字。 */
    const stPos = [0, 0, 0], stIdx = [], stN = 8;
    for (let i = 0; i < stN; i++) {
      const a = i / stN * Math.PI * 2;
      const r = i % 2 === 0 ? 1 : 0.11;         // 尖端拉到 1、腰收到 0.11，才是十字不是八角形
      stPos.push(Math.cos(a) * r, Math.sin(a) * r, 0);
    }
    for (let i = 0; i < stN; i++) stIdx.push(0, 1 + i, 1 + (i + 1) % stN);
    const stGeo = new T.BufferGeometry();
    stGeo.setAttribute('position', new T.Float32BufferAttribute(stPos, 3));
    stGeo.setIndex(stIdx);
    starMesh = new T.InstancedMesh(stGeo, new T.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.95,
      side: T.DoubleSide, depthWrite: false, blending: T.AdditiveBlending
    }), MAXSTAR);
    starMesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    starMesh.count = 0; starMesh.frustumCulled = false; starMesh.visible = false;
    starMesh.setColorAt(0, tmpC.setHex(0xffffff));
    scene.add(starMesh);

    /* 表情圖示（v1.122）：一片正對鏡頭的四邊形，貼上啟動時畫好的那張橫條圖。
       頂點每幀重寫（跟水、地面痕跡同一套做法）所以是 DynamicDrawUsage；
       沒有人在冒表情的時候 visible=false，一個 draw call 都不吃。
       四種表情共用同一份材質（同一張圖的四格），所以在場時也只吃 1 個。
       alphaTest 是把格子裡的空白**挖掉**：不挖的話那一整片透明區也會進混色，
       跟後面的煙、水疊起來會看得出一塊方形的邊。 */
    const emoTex = new T.CanvasTexture(paintEmoAtlas());
    emoTex.colorSpace = T.SRGBColorSpace;    // 不設的話 canvas 畫的顏色會被當成線性值，整片偏亮
    emoGeo = new T.BufferGeometry();
    emoPos = new Float32Array(MAXW * 4 * 3);
    emoUv = new Float32Array(MAXW * 4 * 2);
    const emoPosAttr = new T.BufferAttribute(emoPos, 3);
    const emoUvAttr = new T.BufferAttribute(emoUv, 2);
    emoPosAttr.setUsage(T.DynamicDrawUsage);
    emoUvAttr.setUsage(T.DynamicDrawUsage);
    emoGeo.setAttribute('position', emoPosAttr);
    emoGeo.setAttribute('uv', emoUvAttr);
    const emoIdx = [];
    for (let i = 0; i < MAXW; i++) {
      const v = i * 4;
      emoIdx.push(v, v + 3, v + 2, v, v + 2, v + 1);
    }
    emoGeo.setIndex(emoIdx);
    emoGeo.setDrawRange(0, 0);
    emoMesh = new T.Mesh(emoGeo, new T.MeshBasicMaterial({
      map: emoTex, transparent: true, alphaTest: 0.1, depthWrite: false, side: T.DoubleSide
    }));
    emoMesh.frustumCulled = false; emoMesh.visible = false;
    scene.add(emoMesh);

    /* 藍色閃電：每一段就是一根被拉長的細方塊。
       **不用加法混色**——理由跟魔法陣那幾層一樣：這片天空是白的、草地是亮綠的，
       加法疊上去只會被洗成背景色，量過整道電幾乎看不見。實色的藍在白天空與
       綠草地上都讀得出來。不透明也省掉跟煙塵排序的麻煩。 */
    boltMesh = new T.InstancedMesh(unit, new T.MeshBasicMaterial({ color: 0xffffff }), MAXBOLT);
    boltMesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    boltMesh.count = 0; boltMesh.frustumCulled = false; boltMesh.visible = false;
    boltMesh.setColorAt(0, tmpC.setHex(0xffffff));
    scene.add(boltMesh);

    /* 貼地的發光圓環：魔法陣的每一層、爆炸的衝擊波、蘑菇雲腰上那一圈，
       都是這一組。每層一個扁環 + 一圈紋路——只有環的話它就是一條紅色的帶子，
       盤面的螺旋紋才讓它像「陣」。 */
    ringGroup = new T.Group();
    /* 幾何體共用一份：54 顆環各自 new 一顆 RingGeometry 是白花的（形狀完全一樣，
       大小是逐環 scale 出來的）。 */
    ringSmooth = new T.RingGeometry(0.93, 1, 64);
    for (let i = 0; i < MAG_MAX; i++) {
      /* 環用一般混色：加法混色疊在亮綠色草地上會被洗成白的，看不出是紫的。
         輻條那圈小的才用加法，當作陣上的光點。 */
      /* 魔法陣那幾層用一般混色：加法混色疊在亮綠色草地上會被洗成白的，
         看不出是紅的。爆炸的衝擊環才給加法（它就是要發光），逐環切換。 */
      const m = new T.Mesh(ringSmooth, new T.MeshBasicMaterial({
        color: 0xff2d20, transparent: true, opacity: 0.7,
        side: T.DoubleSide, depthWrite: false, forceSinglePass: true
      }));
      m.rotation.x = -Math.PI / 2;        // RingGeometry 生在 XY 平面，要放平
      m.frustumCulled = false;
      magRings.push(m); ringGroup.add(m);
    }
    /* 每層底下墊一片填滿的圓盤。只有環與紋路的話，看起來是「地上畫了一個圈」，
       參考圖那種是一整片在發光的盤。 */
    for (let i = 0; i < MAG_DISC; i++) {
      /* forceSinglePass：透明的雙面材質，three 預設會分兩趟畫（先背面再正面），
         draw call 直接翻倍。這些是貼平的薄片，用不到那個排序，關掉省一半。 */
      const d = new T.Mesh(new T.CircleGeometry(1, 56), new T.MeshBasicMaterial({
        color: 0xff5a18, transparent: true, opacity: 0.28,
        side: T.DoubleSide, depthWrite: false, forceSinglePass: true
      }));
      d.rotation.x = -Math.PI / 2;
      d.frustumCulled = false; d.visible = false;
      magDiscs.push(d); ringGroup.add(d);
    }

    /* 紋路走亮黃（v1.93 起 #fcf534，使用者從參考圖挑的那個黃；v1.62.1～v1.92 是
       接近白的 #ffe9a0）：線條要靠「比盤黃」跟盤分開，盤 v1.93 起是暗紅的 #cb2306，
       換成飽和的亮黃分得更開，也才是參考圖裡那些捲進去的線條的顏色。
       濃度 0.3 → 0.42：邊上那幾道筆觸是整座陣最亮的東西，0.3 在大白天的綠地上壓不住。
       中心那顆亮核也是這些臂的內端加法混色疊出來的，越黃越像燒白的核。 */
    magSpokeMesh = new T.InstancedMesh(unit, new T.MeshBasicMaterial({
      color: 0xfcf534, transparent: true, opacity: 0.42,
      depthWrite: false, blending: T.AdditiveBlending
    }), MAG_SP_RINGS * MAG_SPOKE);
    magSpokeMesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    magSpokeMesh.count = 0; magSpokeMesh.frustumCulled = false;
    ringGroup.add(magSpokeMesh);
    ringGroup.visible = false;
    scene.add(ringGroup);

    /* 王之財寶的門（v1.132）：一片正對鏡頭的四邊形，貼上啟動時畫好的金色漣漪。
       ① **一般混色，不是加法**。第一版寫加法，截圖出來一百個門全是白色的漩渦——
          這片天空是亮藍的、草地是亮綠的，加法混色把什麼顏色疊上去都會被推到過曝
          （金 0.9/0.65/0.2 加天空 0.55/0.75/0.95 就是 1.45/1.4/1.15，三個通道一起打頂
          ＝白）。魔法陣那幾層踩過同一個雷，理由寫在 setRings 上面。
          改一般混色之後金色才留得住，而且**門會把身後的東西擋住**——參考圖裡
          兵器留在門裡的那一半本來就看不見，加法版是整把透出來的。
       ② **不寫深度**：一百個門互相重疊，寫深度的話先畫到的會把後面的整片切掉；
          照樣**測**深度，所以真的擋在門前面的積木還是遮得住它。
       ③ alphaTest 不設：這張圖的邊緣是化開的暈，硬挖一刀會留一圈方形的邊。 */
    const gateTex = new T.CanvasTexture(paintGateTex());
    gateTex.colorSpace = T.SRGBColorSpace;   // 不設的話 canvas 畫的顏色會被當成線性值，整片偏亮
    /* forceSinglePass：透明的雙面材質，three 預設會分兩趟畫（先背面再正面），
       draw call 直接翻倍——這是一片正對鏡頭的薄片，兩趟排序買不到任何東西
       （魔法陣墊底那幾片圓盤也是為了這個開的）。測試量到過 2 個，開了之後 1 個。 */
    gateMesh = new T.InstancedMesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({
      map: gateTex, transparent: true, depthWrite: false,
      side: T.DoubleSide, forceSinglePass: true
    }), GATE_MAX);
    gateMesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    gateMesh.count = 0; gateMesh.frustumCulled = false; gateMesh.visible = false;
    gateMesh.setColorAt(0, tmpC.setHex(0xffffff));
    scene.add(gateMesh);

    /* 兵器（v1.132）：一把 WEAP_PARTS 塊，全部在同一顆 InstancedMesh 裡。
       走 voxelMaterial ＝ 跟積木、炸彈、核彈同一種受光的方塊材質，
       金色要靠光影才立體（用 MeshBasicMaterial 的話整把是一片死板的黃）。
       **不能共用 unit 那顆幾何體**：aCut／aFade 是掛在幾何體上的 instanced attribute，
       掛上去積木、炸彈那幾顆就跟著要求同一批屬性了。 */
    const weapGeo = new T.BoxGeometry(1, 1, 1);
    weapCut = new T.InstancedBufferAttribute(new Float32Array(WEAP_MAX * WEAP_PARTS * 4), 4);
    weapFade = new T.InstancedBufferAttribute(new Float32Array(WEAP_MAX * WEAP_PARTS), 1);
    weapCut.setUsage(T.DynamicDrawUsage);
    weapFade.setUsage(T.DynamicDrawUsage);
    weapGeo.setAttribute('aCut', weapCut);
    weapGeo.setAttribute('aFade', weapFade);
    const weapShader = (sh, cut) => {
      sh.vertexShader = cut(sh.vertexShader, '#include <common>',
        '\nattribute vec4 aCut;\nattribute float aFade;' +
        '\nvarying vec4 vCut;\nvarying float vFade;\nvarying vec3 vWPos;');
      sh.vertexShader = cut(sh.vertexShader, '#include <begin_vertex>',
        '\nvCut = aCut; vFade = aFade;' +
        '\nvWPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = cut(sh.fragmentShader, '#include <common>',
        '\nvarying vec4 vCut;\nvarying float vFade;\nvarying vec3 vWPos;');
      sh.fragmentShader = cut(sh.fragmentShader, '#include <color_fragment>',
        '\nif (dot(vWPos, vCut.xyz) < vCut.w) discard;\ndiffuseColor.a *= vFade;');
    };
    weapMesh = new T.InstancedMesh(weapGeo,
      voxelMaterial({ color: 0xffffff, transparent: true }, weapShader),
      WEAP_MAX * WEAP_PARTS);
    weapMesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    weapMesh.castShadow = true;
    weapMesh.count = 0; weapMesh.frustumCulled = false; weapMesh.visible = false;
    weapMesh.setColorAt(0, tmpC.setHex(0xffffff));
    /* 陰影那一趟走的是另一顆材質（three 內建的深度材質），它不知道 aCut／aFade——
       不換掉的話「還埋在門裡那一段」跟「已經淡到快看不見的那幾把」照樣在地上投影。
       淡到 45% 以下就整把不投影：再淡下去影子比本體還明顯。 */
    const weapDepth = new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking });
    weapDepth.onBeforeCompile = sh => {
      const cut = injector();
      sh.vertexShader = cut(sh.vertexShader, '#include <common>',
        '\nattribute vec4 aCut;\nattribute float aFade;' +
        '\nvarying vec4 vCut;\nvarying float vFade;\nvarying vec3 vWPos;');
      sh.vertexShader = cut(sh.vertexShader, '#include <begin_vertex>',
        '\nvCut = aCut; vFade = aFade;' +
        '\nvWPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = cut(sh.fragmentShader, '#include <common>',
        '\nvarying vec4 vCut;\nvarying float vFade;\nvarying vec3 vWPos;');
      sh.fragmentShader = cut(sh.fragmentShader, '#include <clipping_planes_fragment>',
        '\nif (dot(vWPos, vCut.xyz) < vCut.w || vFade < 0.45) discard;');
      weapDepth.userData.cuts = cut.count();       // 給測試看：四刀都換到了嗎
    };
    weapDepth.customProgramCacheKey = () => 'weapon-depth';
    weapMesh.customDepthMaterial = weapDepth;
    scene.add(weapMesh);

    resize();
  }

  /* ── 破壞道具 ───────────────────────────────────── */
  /* 鐵球。list 是規則那邊的球本體 {x, y, z, r, ax, az, ang}，一次可以給好幾顆
     （v1.116）：(ax,az) 是滾動軸（水平、垂直於前進方向），ang 是已滾過的角度。 */
  function putBalls(list) {
    const n = Math.min(list.length, MAXBALL);
    ballMesh.visible = n > 0;
    ballMesh.count = n;
    for (let i = 0; i < n; i++) {
      const b = list[i];
      _axis.set(b.ax, 0, b.az);
      if (_axis.lengthSq() > 1e-6) scratch.quaternion.setFromAxisAngle(_axis.normalize(), b.ang);
      else scratch.quaternion.identity();
      scratch.position.set(b.x, b.y, b.z);
      scratch.scale.setScalar(b.r);
      scratch.updateMatrix();
      ballMesh.setMatrixAt(i, scratch.matrix);
    }
    ballMesh.instanceMatrix.needsUpdate = true;
  }

  /* 漏斗：越往上越粗，每一段各自轉、各自往旁邊偏一點，整條才會扭起來。
     list 是規則那邊的龍捲風本體 {x,z,r,h,spin}，一次可以給好幾道。 */
  function putTornados(list) {
    const n = Math.min(list.length, TW_MAX);
    tornadoGroup.visible = n > 0;
    for (let i = 0; i < TW_SEG; i++) {
      const t = i / (TW_SEG - 1);
      const seg = tornadoSegs[i];
      seg.count = n;
      for (let k = 0; k < n; k++) {
        const w = list[k];
        // 漏斗畫得比作用範圍細一點：邊緣的積木先被吸進來才碰到雲柱，看起來才像被風捲走
        const r = w.r * 0.9, h = w.h, spin = w.spin;
        /* 上緣張得比以前開：漏斗拉高之後還用原本的錐度，整條會細成一根針。
           底細頂寬才是漏斗，錐度大致跟著高度一起放大。 */
        const rad = r * (0.18 + t * t * 1.25 + t * 0.55);
        const wob = Math.sin(spin * 1.3 + t * 5.2) * r * 0.3 * t;
        const wob2 = Math.cos(spin * 1.1 + t * 4.4) * r * 0.3 * t;
        scratch.position.set(w.x + wob, h * t + h / TW_SEG * 0.5, w.z + wob2);
        scratch.rotation.set(0, spin * (1 + t * 0.7), 0);
        /* 段與段刻意只疊 35%：接縫留下來的一圈圈橫紋就是「它在轉」的線索，
           疊到糊掉會變成一個乾淨的半透明圓錐，反而看不出是龍捲風。 */
        scratch.scale.set(rad, h / TW_SEG * 1.35, rad);
        scratch.updateMatrix();
        seg.setMatrixAt(k, scratch.matrix);
      }
      seg.instanceMatrix.needsUpdate = true;
    }
  }
  /* (x,y,z) 是槌子擺放的位置，(tx,ty,tz) 是它要對準的落點，
     spin 是揮動時的側傾，sc 是整支槌子的倍率（大槌用） */
  function setHammer(x, y, z, tx, ty, tz, spin, sc) {
    hammerGroup.visible = true;
    hammerGroup.position.set(x, y, z);
    hammerGroup.lookAt(tx, ty, tz);
    hammerGroup.rotateZ(spin);
    hammerGroup.scale.setScalar(sc || 1);
  }
  function hideHammer() { hammerGroup.visible = false; }
  function hammerVisible() { return hammerGroup.visible; }

  /* 投石機。t：{x, z, a 面向, arm 拋臂角度}
     底座與立柱固定，拋臂繞立柱頂端擺——發射時從後仰掃到前傾。 */
  const CW_ARM = 3.4;               // 配重掛在拋臂後端多遠
  const TREB_PART = [
    { p: [0, 0.35, 0], s: [3.8, 0.7, 2.9], c: 0x7a5334 },        // 底座
    { p: [-1.05, 2.1, 0], s: [0.5, 3.6, 0.5], c: 0x8a5f3c },     // 左立柱
    { p: [1.05, 2.1, 0], s: [0.5, 3.6, 0.5], c: 0x8a5f3c },      // 右立柱
    { p: [0, 3.85, 0], s: [0.45, 0.45, 7.4], c: 0x5f4126, arm: 1 },   // 拋臂
    { p: [0, 3.85, 0], s: [1.6, 1.6, 1.6], c: 0x494440, cw: 1 }       // 配重
  ];
  function putTrebs(list) {
    const n = Math.min(list.length, MAXTREB);
    trebMesh.count = n * TREB_PARTS;
    for (let i = 0; i < n; i++) {
      const t = list[i];
      scratch.position.set(t.x, 0, t.z);
      scratch.rotation.set(0, t.a, 0);
      scratch.scale.setScalar(1);
      scratch.updateMatrix();
      for (let k = 0; k < TREB_PARTS; k++) {
        const b = TREB_PART[k];
        // 配重要跟著拋臂繞支點轉：把 (0,0,-CW_ARM) 繞 X 軸轉 arm 角度
        if (b.cw) scratchB.position.set(b.p[0], b.p[1] + Math.sin(t.arm) * CW_ARM, -Math.cos(t.arm) * CW_ARM);
        else scratchB.position.set(b.p[0], b.p[1], b.p[2]);
        scratchB.rotation.set(b.arm ? t.arm : 0, 0, 0);
        scratchB.scale.set(b.s[0], b.s[1], b.s[2]);
        scratchB.updateMatrix();
        tmpM.multiplyMatrices(scratch.matrix, scratchB.matrix);
        trebMesh.setMatrixAt(i * TREB_PARTS + k, tmpM);
        trebMesh.setColorAt(i * TREB_PARTS + k, tmpC.setHex(b.c));
      }
    }
    trebMesh.instanceMatrix.needsUpdate = true;
    if (trebMesh.instanceColor) trebMesh.instanceColor.needsUpdate = true;
  }
  /* 推土機。d：{x, z, a 朝向, bob 引擎抖動}
     車頭（推土鏟）朝 local +Z，跟投石機同一套擺位方式。
     鏟子的寬度就是規則那邊 DOZ_W 的兩倍——畫面上推得到的寬度必須跟判定一致，
     不然玩家會看到鏟子明明掃過去卻有積木沒動。 */
  const DOZ_PART = [
    { p: [-1.75, 0.5, -0.4], s: [1.15, 1.0, 6.0], c: 0x2f3238 },      // 左履帶
    { p: [1.75, 0.5, -0.4], s: [1.15, 1.0, 6.0], c: 0x2f3238 },       // 右履帶
    { p: [0, 1.35, -0.7], s: [2.8, 1.3, 4.4], c: 0xefa81c },          // 車體（比履帶窄，履帶才露得出來）
    { p: [0, 2.5, -1.8], s: [2.1, 1.2, 2.1], c: 0x3f4650 },           // 駕駛室：深色才看得出是座艙
    { p: [0, 3.2, -1.8], s: [2.4, 0.25, 2.4], c: 0xefa81c },          // 車頂
    { p: [0.95, 2.5, 0.7], s: [0.35, 1.8, 0.35], c: 0x2f3238 },       // 排氣管
    { p: [-1.55, 0.95, 1.9], s: [0.36, 0.36, 3.4], c: 0x565c65 },     // 左推臂
    { p: [1.55, 0.95, 1.9], s: [0.36, 0.36, 3.4], c: 0x565c65 },      // 右推臂
    /* 鏟子畫得比推得到的寬度窄一點點：畫到一樣寬的話，並肩的機器會連成一道長牆，
       看起來只是一片會動的牆。高度也要壓在車身以下，不然整台被自己的鏟子擋光。 */
    { p: [0, 0.95, DOZ_FRONT], s: [DOZ_W * 1.86, 1.5, 0.45], c: 0xc2c8d0, r: 0.13, bl: 1 },
    { p: [0, 0.25, DOZ_FRONT + 0.18], s: [DOZ_W * 1.86, 0.55, 0.8], c: 0x8a9098, bl: 1 }  // 鏟刃
  ];
  /* d.bl：鏟子抬起來的程度（0 貼地推、1 抬高趕路）。
     空車趕路時鏟子還鏟在地上的話，看起來像是一路都在推東西。 */
  function putDozers(list) {
    const n = Math.min(list.length, MAXDOZ);
    dozMesh.count = n * DOZ_PARTS;
    for (let i = 0; i < n; i++) {
      const d = list[i];
      const up = d.bl || 0;
      scratch.position.set(d.x, d.bob || 0, d.z);
      scratch.rotation.set(0, d.a, 0);
      scratch.scale.setScalar(1);
      scratch.updateMatrix();
      for (let k = 0; k < DOZ_PARTS; k++) {
        const b = DOZ_PART[k];
        const lift = b.bl ? up : 0;
        scratchB.position.set(b.p[0], b.p[1] + lift * 1.25, b.p[2] - lift * 0.5);
        scratchB.rotation.set((b.r || 0) - lift * 0.55, 0, 0);
        scratchB.scale.set(b.s[0], b.s[1], b.s[2]);
        scratchB.updateMatrix();
        tmpM.multiplyMatrices(scratch.matrix, scratchB.matrix);
        dozMesh.setMatrixAt(i * DOZ_PARTS + k, tmpM);
        dozMesh.setColorAt(i * DOZ_PARTS + k, tmpC.setHex(b.c));
      }
    }
    dozMesh.instanceMatrix.needsUpdate = true;
    if (dozMesh.instanceColor) dozMesh.instanceColor.needsUpdate = true;
  }
  /* 消防車。m：{x, z, a 朝向, bob 引擎抖動, bk 警示燈亮不亮}
     車頭朝 local +Z，跟推土機、投石機同一套擺位。水砲固定朝車頭——
     車子停下來會先把車頭轉向火場，所以砲口自然對著要噴的地方，不必再單獨轉砲塔。 */
  const TRK_PART = [
    { p: [-1.45, 0.55, -2.0], s: [0.75, 1.1, 1.1], c: 0x23262b },   // 左後輪
    { p: [1.45, 0.55, -2.0], s: [0.75, 1.1, 1.1], c: 0x23262b },    // 右後輪
    { p: [-1.45, 0.55, 1.9], s: [0.75, 1.1, 1.1], c: 0x23262b },    // 左前輪
    { p: [1.45, 0.55, 1.9], s: [0.75, 1.1, 1.1], c: 0x23262b },     // 右前輪
    { p: [0, 1.5, -0.9], s: [2.9, 1.7, 5.4], c: 0xd8262c },         // 車廂
    { p: [0, 1.35, 2.1], s: [2.8, 1.4, 2.4], c: 0xd8262c },         // 引擎蓋
    { p: [0, 2.45, 1.7], s: [2.6, 1.3, 2.2], c: 0x2b3038 },         // 駕駛室：深色才看得出是座艙
    { p: [0, 1.05, -0.9], s: [2.96, 0.34, 5.46], c: 0xf2f4f6 },     // 車身那道白線（比車廂窄一點，才是線不是底板）
    { p: [0, 2.55, -1.4], s: [1.3, 0.6, 1.3], c: 0xc2c8d0 },        // 水砲底座
    { p: [0, 2.9, 0.1], s: [0.34, 0.34, 2.6], c: 0x8a9098 },        // 水砲管（朝車頭）
    /* 警示燈。閃是靠顏色換，不是靠位置動——一顆 instance 只有一個顏色，
       換色最省事，而且遠遠看就是那一點在跳。 */
    { p: [0, 3.25, 1.7], s: [1.7, 0.32, 0.6], c: 0xff2f24, bk: 1 }
  ];
  const TRK_DARK = 0x5c1512;                   // 警示燈暗掉那一格的顏色
  function putTrucks(list) {
    const n = Math.min(list.length, MAXTRUCK);
    trkMesh.visible = n > 0;
    trkMesh.count = n * TRK_PARTS;
    for (let i = 0; i < n; i++) {
      const d = list[i];
      scratch.position.set(d.x, d.bob || 0, d.z);
      scratch.rotation.set(0, d.a, 0);
      scratch.scale.setScalar(1);
      scratch.updateMatrix();
      for (let k = 0; k < TRK_PARTS; k++) {
        const b = TRK_PART[k];
        scratchB.position.set(b.p[0], b.p[1], b.p[2]);
        scratchB.rotation.set(0, 0, 0);
        scratchB.scale.set(b.s[0], b.s[1], b.s[2]);
        scratchB.updateMatrix();
        tmpM.multiplyMatrices(scratch.matrix, scratchB.matrix);
        trkMesh.setMatrixAt(i * TRK_PARTS + k, tmpM);
        trkMesh.setColorAt(i * TRK_PARTS + k,
                           tmpC.setHex(b.bk && !d.bk ? TRK_DARK : b.c));
      }
    }
    trkMesh.instanceMatrix.needsUpdate = true;
    if (trkMesh.instanceColor) trkMesh.instanceColor.needsUpdate = true;
  }
  /* 一格水：p = {x, z 那一格的中心, y0 水底, y1 水面, f 哪幾面要畫（位元）,
     sb 四道側面各自從多高開始畫（相對格底）, rim 是不是水體外緣}。
     只畫規則那邊標出來「旁邊不是水」的那幾面——被水包住的面根本不存在，
     一大片水才不會疊出方格紋（見上面 poolGeo 那段）。
     位元跟規則那邊的 DIR4 同順序：1=+x　2=−x　4=+z　8=−z，再加 16=底面　32=頂面。
     **側面不見得從格底畫起**：旁邊也是水的時候只畫「它的水面到我的水面」那一段
     （低於它水面的部分在它的水體裡面）。規則那邊算 sb 用的是那一拍的高度，
     這裡的 y1 是每幀補過的高度，兩者差一個補間的量——所以要夾住，
     不然差反了會畫出上下顛倒的面。 */
  function putPools(list, wt) {
    const n = Math.min(list.length, MAXPOOL);
    const P = poolPos, F = poolFoam;
    let v = 0;                                     // 已經寫到第幾個 float
    let fm = 0;                                    // 這幾個三角形要不要泡沫
    const tri = (ax, ay, az, bx, by, bz, cx, cy, cz) => {
      const q = v / 3;
      F[q] = fm; F[q + 1] = fm; F[q + 2] = fm;
      P[v++] = ax; P[v++] = ay; P[v++] = az;
      P[v++] = bx; P[v++] = by; P[v++] = bz;
      P[v++] = cx; P[v++] = cy; P[v++] = cz;
    };
    for (let i = 0; i < n; i++) {
      const p = list[i];
      if (v + 90 > P.length) break;                // 一格最多 5 面 × 2 三角形 × 9 float
      const x0 = p.x - 0.5, x1 = p.x + 0.5, z0 = p.z - 0.5, z1 = p.z + 0.5, ya = p.y0, yb = p.y1;
      /* 泡沫只長在**水體外緣的水面**上（規則那邊算好的 rim：旁邊那格根本沒有水）。
         這裡曾經拿「有側面」（f & 15）當外緣——側面只要旁邊比自己低就會標出來，
         一片還在攤開的水幾乎每格都有，於是整片水變成一格一塊的白磁磚（踩過，見截圖）。 */
      fm = p.rim ? 1 : 0;
      if (p.f & 32) { tri(x0, yb, z0, x1, yb, z0, x1, yb, z1); tri(x0, yb, z0, x1, yb, z1, x0, yb, z1); }
      fm = 0;                                      // 底面與側壁不刷白（那是水體內部與水下）
      if (p.f & 16) { tri(x0, ya, z0, x1, ya, z0, x1, ya, z1); tri(x0, ya, z0, x1, ya, z1, x0, ya, z1); }
      const sb = p.sb;
      const base = k => (sb ? Math.min(ya + sb[k], yb) : ya);
      if (p.f & 1) { const s = base(0); tri(x1, s, z0, x1, yb, z0, x1, yb, z1); tri(x1, s, z0, x1, yb, z1, x1, s, z1); }
      if (p.f & 2) { const s = base(1); tri(x0, s, z0, x0, yb, z0, x0, yb, z1); tri(x0, s, z0, x0, yb, z1, x0, s, z1); }
      if (p.f & 4) { const s = base(2); tri(x0, s, z1, x0, yb, z1, x1, yb, z1); tri(x0, s, z1, x1, yb, z1, x1, s, z1); }
      if (p.f & 8) { const s = base(3); tri(x0, s, z0, x0, yb, z0, x1, yb, z0); tri(x0, s, z0, x1, yb, z0, x1, s, z0); }
    }
    poolMesh.visible = v > 0;
    poolGeo.setDrawRange(0, v / 3);
    // 波紋與泡沫的相位：規則那邊累出來的水時間（跟畫面幀率無關，4× 速也是同一支波）
    if (poolUni) poolUni.uWTime.value = wt || 0;
    const at = poolGeo.attributes.position;
    // 只上傳真的有用到的那一段（整條 66000 頂點每幀傳一次太浪費）
    if (at.clearUpdateRanges) { at.clearUpdateRanges(); at.addUpdateRange(0, v); }
    else if (at.updateRange) { at.updateRange.offset = 0; at.updateRange.count = v; }
    at.needsUpdate = true;
    const fa = poolGeo.attributes.aFoam;           // 泡沫那一條同理，只傳用到的頂點數
    if (fa.clearUpdateRanges) { fa.clearUpdateRanges(); fa.addUpdateRange(0, v / 3); }
    else if (fa.updateRange) { fa.updateRange.offset = 0; fa.updateRange.count = v / 3; }
    fa.needsUpdate = true;
  }
  /* 整組濃度的旋鈕（v1.88.1，使用者回饋「都淡淡的就好，太深原本的煙都看不清楚了」）。
     表裡的 a 維持原來的相對比例（中心深、外圈淡），統一乘這個數字調濃淡——
     一格一格改的話下次要再調就得動十行。 */
  const MARK_INK = 0.45;
  /* 一塊痕跡＝幾個同心圈，圈與圈之間鋪一圈四邊形；每一圈有自己的顏色與 alpha
     （最外圈 alpha 給 0，邊緣就糊掉了）。r 是半徑倍率、c 顏色、
     a 濃度倍率（還要再乘上這塊自己淡到剩幾成）。
     顏色開場就換算成 rgb 存著：每個頂點都 setHex 一次的話，
     二十幾塊痕跡每幀要換算一萬次色，白花的。 */
  const markPrep = t => t.map(o => {
    const c = new T.Color(o.c);
    return { r: o.r, a: o.a * MARK_INK, cr: c.r, cg: c.g, cb: c.b };
  });
  /* 焦黑：中心接近黑（真的被燒過的地），往外一圈煙燻過的土色，最後 8% 才收掉。
     中心不夠黑會跟樹影長得太像（分不出是影子還是燒過的地）；
     收邊那一截也不能太寬——整支程式都是硬邊的方塊，一團糊開的霧看起來像貼歪的貼圖。 */
  const MARK_SCORCH = markPrep([
    { r: 0, c: 0x141009, a: 0.92 },
    { r: 0.5, c: 0x181309, a: 0.9 },
    { r: 0.8, c: 0x241d13, a: 0.82 },
    { r: 0.92, c: 0x30281b, a: 0.5 },
    { r: 1, c: 0x3a3122, a: 0 }
  ]);
  /* 坑洞：坑底最深 → 坑壁開始有土色 → 一圈翻出來的土（最亮）→ 收邊。
     那一圈亮的是關鍵：少了它就只是一塊深色的斑，有了才讀得出「地被砸凹了」。
     土色刻意偏灰褐，不要太橘——太陽是暖色的（0xfff3dd），橘褐色照下去會像在燒。 */
  const MARK_CRATER = markPrep([
    { r: 0, c: 0x0f0a05, a: 0.96 },
    { r: 0.5, c: 0x150e07, a: 0.95 },
    { r: 0.75, c: 0x3a2c1c, a: 0.93 },
    { r: 0.9, c: 0x6b573d, a: 0.9 },
    { r: 1, c: 0x6b573d, a: 0 }
  ]);
  const MARK_Y = 0.04;              // 離地一點點：貼在 0 會跟草皮頂面搶深度，糊成一片
  /* list 每一項 {x, z, r 半徑, a 濃度 0–1, crater 是不是坑洞,
     j 每一片的半徑倍率（生的時候抽好存著——每幀重抽輪廓會一直抖）}。 */
  function putMarks(list) {
    const n = Math.min(list.length, MARK_MAX);
    const P = markPos, C = markCol;
    let v = 0;                                     // 已經寫到第幾個頂點
    /* 夾在草皮裡面：痕跡是浮在地面上方 MARK_Y 的一片三角形，超出草皮邊緣的部分
       底下什麼都沒有，會變成一塊飄在天空上的黑影（實測核彈炸在邊緣、或換到小建築
       之後草地縮小，就會看到）。夾住之後多出來的部分會擠在邊上收成一條直邊，
       看起來就是「燒到邊就沒了」。 */
    const lim = groundHalf - 0.4;
    const put = (m, ring, ang, jj) => {
      const rad = m.r * ring.r * jj;
      P[v * 3] = Math.max(-lim, Math.min(lim, m.x + Math.cos(ang) * rad));
      P[v * 3 + 1] = MARK_Y;
      P[v * 3 + 2] = Math.max(-lim, Math.min(lim, m.z + Math.sin(ang) * rad));
      C[v * 4] = ring.cr; C[v * 4 + 1] = ring.cg; C[v * 4 + 2] = ring.cb;
      C[v * 4 + 3] = ring.a * m.a;
      v++;
    };
    for (let i = 0; i < n; i++) {
      const m = list[i];
      const rings = m.crater ? MARK_CRATER : MARK_SCORCH;
      for (let s = 0; s < MARK_SEG; s++) {
        const a0 = s / MARK_SEG * Math.PI * 2, a1 = (s + 1) / MARK_SEG * Math.PI * 2;
        const j0 = m.j[s], j1 = m.j[(s + 1) % MARK_SEG];
        for (let k = 0; k + 1 < rings.length; k++) {
          if ((v + 6) * 3 > P.length) break;
          const A = rings[k], B = rings[k + 1];
          /* 這兩個三角形的頂點順序算出來的法線是朝上的（+Y）。順序寫反的話面朝下，
             從上面看就只看到背面——Lambert 會拿翻過來的法線算光，畫成一團黑。 */
          put(m, A, a0, j0); put(m, A, a1, j1); put(m, B, a1, j1);
          put(m, A, a0, j0); put(m, B, a1, j1); put(m, B, a0, j0);
        }
      }
    }
    markMesh.visible = v > 0;
    markGeo.setDrawRange(0, v);
    const pa = markGeo.attributes.position, ca = markGeo.attributes.color;
    // 只上傳真的用到的那一段（跟水那顆同一個理由）
    if (pa.clearUpdateRanges) {
      pa.clearUpdateRanges(); pa.addUpdateRange(0, v * 3);
      ca.clearUpdateRanges(); ca.addUpdateRange(0, v * 4);
    } else if (pa.updateRange) {
      pa.updateRange.offset = 0; pa.updateRange.count = v * 3;
      ca.updateRange.offset = 0; ca.updateRange.count = v * 4;
    }
    pa.needsUpdate = true; ca.needsUpdate = true;
  }
  function putRocks(list) {
    const n = Math.min(list.length, MAXROCK);
    rockMesh.count = n;
    for (let i = 0; i < n; i++) {
      const r = list[i];
      scratch.position.set(r.x, r.y, r.z);
      scratch.rotation.set(r.rx, r.ry, 0);
      scratch.scale.setScalar(r.s);
      scratch.updateMatrix();
      rockMesh.setMatrixAt(i, scratch.matrix);
    }
    rockMesh.instanceMatrix.needsUpdate = true;
  }
  function hammerPos() { const p = hammerGroup.position; return { x: p.x, y: p.y, z: p.z }; }

  /* 定時炸彈。b：{x, y, z, blink 0/1 閃燈亮不亮}
     頂端那顆燈直接切換顏色而不是漸變——真的引信燈就是這樣一明一滅，
     漸變反而看起來像在呼吸。 */
  const BOMB_PART = [
    { p: [0, 0.62, 0], s: [1.5, 1.24, 1.5], c: 0x2b2f36 },      // 本體
    { p: [0, 1.32, 0], s: [1.0, 0.26, 1.0], c: 0x555c66 },      // 頸環
    { p: [0, 1.6, 0], s: [0.44, 0.44, 0.44], c: 0x4a1a12, lamp: 1 }   // 閃燈
  ];
  function putBombs(list) {
    const n = Math.min(list.length, MAXBOMB);
    bombMesh.visible = n > 0;
    bombMesh.count = n * BOMB_PARTS;
    for (let i = 0; i < n; i++) {
      const b = list[i];
      scratch.position.set(b.x, b.y, b.z);
      scratch.rotation.set(0, b.a || 0, 0);
      scratch.scale.setScalar(1);
      scratch.updateMatrix();
      for (let k = 0; k < BOMB_PARTS; k++) {
        const p = BOMB_PART[k];
        scratchB.position.set(p.p[0], p.p[1], p.p[2]);
        scratchB.rotation.set(0, 0, 0);
        scratchB.scale.set(p.s[0], p.s[1], p.s[2]);
        scratchB.updateMatrix();
        tmpM.multiplyMatrices(scratch.matrix, scratchB.matrix);
        bombMesh.setMatrixAt(i * BOMB_PARTS + k, tmpM);
        bombMesh.setColorAt(i * BOMB_PARTS + k,
          tmpC.setHex(p.lamp && b.blink ? 0xff6a4a : p.c));
      }
    }
    bombMesh.instanceMatrix.needsUpdate = true;
    if (bombMesh.instanceColor) bombMesh.instanceColor.needsUpdate = true;
  }

  /* 隕石。m：{x, y, z, rx, ry, s, hot 0–1 燒得多紅}
     只畫真的在天上飛的那幾顆——還在倒數的那些由規則那邊自己濾掉，
     這裡收到的就是要畫的。 */
  function putMeteors(list) {
    const n = Math.min(list.length, MAXMET);
    meteorMesh.visible = n > 0;
    meteorMesh.count = n;
    for (let i = 0; i < n; i++) {
      const m = list[i];
      scratch.position.set(m.x, m.y, m.z);
      scratch.rotation.set(m.rx, m.ry, 0);
      scratch.scale.setScalar(m.s);
      scratch.updateMatrix();
      meteorMesh.setMatrixAt(i, scratch.matrix);
      /* 焦黑的石頭 → 燒紅。材質色是白的，所以 instance color 就是最終顏色。
         刻意壓暗：亮橘的石頭在陽光下就只是一個橘色箱子，火要交給拖在後面的火苗去演，
         這顆的角色是「一塊燒紅的岩石」。 */
      const k = m.hot || 0;
      meteorMesh.setColorAt(i, tmpC.setRGB(0.16 + 0.30 * k, 0.14 + 0.06 * k, 0.13 + 0.01 * k));
    }
    meteorMesh.instanceMatrix.needsUpdate = true;
    if (meteorMesh.instanceColor) meteorMesh.instanceColor.needsUpdate = true;
  }

  /* 核彈：只管畫在哪、轉多少，什麼時候掉、掉多快是規則那邊的事。
     list 每一項 {x, y, z, spin}。整顆的變換（位置＋自轉＋放大 1.5）套在外層，
     每個部位自己的位移與尺寸套在內層，兩個矩陣相乘就是那個 instance 的矩陣。 */
  function putNukes(list) {
    const P = NUKE_PARTS, n = Math.min(list.length, NUKE_MAX);
    nukeMesh.visible = n > 0;
    nukeMesh.count = n * P.length;
    for (let i = 0; i < n; i++) {
      const o = list[i];
      _nOuter.position.set(o.x, o.y, o.z);
      _nOuter.rotation.set(0, o.spin, 0);
      _nOuter.scale.setScalar(1.5);
      _nOuter.updateMatrix();
      for (let k = 0; k < P.length; k++) {
        scratch.position.set(P[k][0][0], P[k][0][1], P[k][0][2]);
        scratch.rotation.set(0, 0, 0);
        scratch.scale.set(P[k][1][0], P[k][1][1], P[k][1][2]);
        scratch.updateMatrix();
        _nMat.multiplyMatrices(_nOuter.matrix, scratch.matrix);
        nukeMesh.setMatrixAt(i * P.length + k, _nMat);
      }
    }
    nukeMesh.instanceMatrix.needsUpdate = true;
  }

  /* 貼地圓環。list 每一項 {x, z, y, r 半徑, spin 轉到哪, op 濃度,
     c 顏色, sp 要不要輻條, add 要不要加法混色}。
     魔法陣的每一層、爆炸衝擊波、蘑菇雲腰上那一圈都走這裡，所以位置逐環給，
     不是共用一個圓心——不然衝擊波還在擴散時再放一個魔法陣就會互相拉走。 */
  function setRings(list) {
    const n = Math.min(list.length, MAG_MAX);
    ringGroup.visible = n > 0;
    let s = 0, disc = 0;
    for (let i = 0; i < MAG_MAX; i++) {
      const r = i < n ? list[i] : null;
      const m = magRings[i];
      m.visible = !!r;
      if (!r) continue;
      m.position.set(r.x, r.y, r.z);
      m.scale.set(r.r, r.r, 1);
      m.rotation.z = r.spin || 0;         // 放平之後，繞自己的法線轉就是 local Z
      m.material.opacity = r.op * 0.85;
      m.material.color.setHex(r.c === undefined ? 0x8b3ff0 : r.c);
      // 混色模式只在真的變了才動：每幀設 needsUpdate 會逼 three 重建 shader
      const bl = r.add ? T.AdditiveBlending : T.NormalBlending;
      if (m.material.blending !== bl) { m.material.blending = bl; m.material.needsUpdate = true; }
      // 墊在底下那片盤
      if (r.fill && disc < MAG_DISC) {
        const dm = magDiscs[disc++];
        dm.visible = true;
        dm.position.set(r.x, r.y - 0.015, r.z);        // 壓在環下面一點，免得 z-fighting
        dm.scale.set(r.r * 0.97, r.r * 0.97, 1);
        dm.material.opacity = r.op * DISC_OP;
        /* 盤的顏色跟著那一圈走（v1.54，原本是引擎裡寫死的橘，陣改色之後就糊了）。
           v1.62.1 起可以用 fc 另外指定：照參考圖，那一圈本身是亮黃的鑲邊、
           盤是桃紅的場——同色的話整片會變成一大片黃，鑲邊就不見了。 */
        dm.material.color.setHex(r.fc !== undefined ? r.fc
                                 : r.c === undefined ? 0xff5a18 : r.c);
      }
      // 盤面的紋路（見 MAG_SWIRL）
      if (!r.sp || s + MAG_SPOKE > MAG_SP_RINGS * MAG_SPOKE) continue;
      for (let fi = 0; fi < MAG_SWIRL.length; fi++) {
        const F = MAG_SWIRL[fi];
        const base = (r.spin || 0) * F.spin + fi * 0.2;
        for (let arm = 0; arm < F.arms; arm++) {
          const a0 = base + arm / F.arms * Math.PI * 2;
          for (let i = 0; i < F.seg; i++) {
            // 這一段的兩端：半徑線性往外、角度同時往前捲，就是一條螺旋
            const t0 = i / F.seg, t1 = (i + 1) / F.seg;
            const p0 = F.r0 + (1 - F.r0) * t0, p1 = F.r0 + (1 - F.r0) * t1;
            const h0 = a0 + F.turn * t0, h1 = a0 + F.turn * t1;
            const x0 = Math.cos(h0) * p0, z0 = Math.sin(h0) * p0;
            const dx = Math.cos(h1) * p1 - x0, dz = Math.sin(h1) * p1 - z0;
            scratch.position.set(r.x + (x0 + dx / 2) * r.r, r.y + fi * 0.02,
                                 r.z + (z0 + dz / 2) * r.r);
            // 繞 Y 轉 atan2(−dz, dx)，local +X 才會對齊這一段的方向
            scratch.rotation.set(0, Math.atan2(-dz, dx), 0);
            // 長度多給一成半，段與段之間才不會有縫；越外面越粗，像被甩開的尾巴
            scratch.scale.set(Math.hypot(dx, dz) * 1.15 * r.r, 0.04,
                              r.r * F.w * (0.5 + t0));
            scratch.updateMatrix();
            magSpokeMesh.setMatrixAt(s++, scratch.matrix);
          }
        }
      }
      /* 邊上的螺旋筆觸（見 MAG_RIM）。跟盤面的螺旋臂同一套組法：切成短棒沿曲線擺，
         差別在半徑是「起筆 → 收筆」在跑（掃出去的同時往外／往內滑），
         而且粗細兩端收尖（`sin(πt)`）——這樣才是一道筆觸，不是一截等寬的圓弧。 */
      for (let fi = 0; fi < MAG_RIM.length; fi++) {
        const F = MAG_RIM[fi];
        const base = (r.spin || 0) * F.spin + fi * 1.1;
        for (let arc = 0; arc < F.arcs; arc++) {
          const a0 = base + arc / F.arcs * Math.PI * 2;
          for (let i = 0; i < F.seg; i++) {
            const t0 = i / F.seg, t1 = (i + 1) / F.seg;
            const p0 = F.r0 + (F.r1 - F.r0) * t0, p1 = F.r0 + (F.r1 - F.r0) * t1;
            const h0 = a0 + F.sweep * t0, h1 = a0 + F.sweep * t1;
            const x0 = Math.cos(h0) * p0, z0 = Math.sin(h0) * p0;
            const dx = Math.cos(h1) * p1 - x0, dz = Math.sin(h1) * p1 - z0;
            scratch.position.set(r.x + (x0 + dx / 2) * r.r, r.y + 0.06 + fi * 0.02,
                                 r.z + (z0 + dz / 2) * r.r);
            scratch.rotation.set(0, Math.atan2(-dz, dx), 0);
            scratch.scale.set(Math.hypot(dx, dz) * 1.15 * r.r, 0.04,
                              r.r * F.w * (0.25 + 0.75 * Math.sin(Math.PI * (t0 + t1) / 2)));
            scratch.updateMatrix();
            magSpokeMesh.setMatrixAt(s++, scratch.matrix);
          }
        }
      }
      /* 外圈那一圈虛線：長邊沿著圓周擺，連起來像一圈細框。
         倍率 0.4 是正的，跟盤面同向、只是慢一點——負的會變成外框倒著轉。 */
      for (let k = 0; k < MAG_DASH; k++) {
        const a = (r.spin || 0) * 0.4 + k / MAG_DASH * Math.PI * 2;
        scratch.position.set(r.x + Math.cos(a) * r.r * 0.88, r.y + 0.05,
                             r.z + Math.sin(a) * r.r * 0.88);
        scratch.rotation.set(0, -a + Math.PI / 2, 0);
        scratch.scale.set(r.r * 0.13, 0.04, r.r * 0.009);
        scratch.updateMatrix();
        magSpokeMesh.setMatrixAt(s++, scratch.matrix);
      }
    }
    for (let i = disc; i < MAG_DISC; i++) magDiscs[i].visible = false;
    magSpokeMesh.count = s;
    magSpokeMesh.instanceMatrix.needsUpdate = true;
  }
  function hideRings() { ringGroup.visible = false; }

  /* 王之財寶的門長什麼樣（v1.132）。照使用者給的參考圖畫，三件事：
     ① **中心是過曝的白**，不是黃——參考圖裡每個門的核都白到看不出顏色，
        黃只出現在往外化開的那一圈。
     ② **一圈一圈不等寬的亮環**，環與環之間留暗帶。等寬的話看起來像靶紙；
        參考圖那是「水面泛起的漣漪」，一圈粗一圈細才對。
     ③ **最外圈化開成一團暈，沒有硬邊**。門是虛空裂開的波紋，不是一片圓貼紙。
     再加幾道**只掃過一段角度的弧**（不是整圈），對稱才會被打破——參考圖裡那些環
     本來就是斷開、錯位的。亂數走自己的 LCG 而不是 Math.random：這張圖是開場畫一次
     就固定的東西，每次開遊戲長得不一樣沒有好處，測試也會抓不住。 */
  function paintGateTex() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = GATE_TEX;
    const g = cv.getContext('2d');
    const C = GATE_TEX / 2, R = C * 0.98;
    let seed = 20250828;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    /* 底：中心亮、往外一路轉成濃金、再化成透明。
       **v1.132.1 把核放小、壓薄**：v1.132.0 的核是「幾乎不透明的白」，因為那時候
       兵器留在門裡的那一半是靠它擋住的；現在那件事由 shader 的切面做（見 aCut），
       核就不必再當遮板了——核一大一實，探出來的刃反而被自己的門洗白，
       參考圖裡刃是清楚讀得出來的深色剪影。 */
    const bg = g.createRadialGradient(C, C, 0, C, C, R);
    bg.addColorStop(0, 'rgba(255,252,232,0.86)');
    bg.addColorStop(0.18, 'rgba(255,238,176,0.80)');
    bg.addColorStop(0.38, 'rgba(255,206,88,0.74)');
    bg.addColorStop(0.58, 'rgba(248,166,28,0.52)');
    bg.addColorStop(0.76, 'rgba(214,118,12,0.22)');
    bg.addColorStop(0.90, 'rgba(168,84,6,0.055)');
    bg.addColorStop(1, 'rgba(120,54,0,0)');
    g.fillStyle = bg;
    g.beginPath(); g.arc(C, C, R, 0, Math.PI * 2); g.fill();
    // 漣漪：一圈粗一圈細，越外面越淡。每一圈畫兩趟（寬而淡的當光暈、細而亮的當芯）
    const RING = [[0.30, 0.052, 0.95], [0.42, 0.026, 0.72], [0.52, 0.040, 0.62],
                  [0.63, 0.020, 0.46], [0.73, 0.030, 0.34], [0.84, 0.016, 0.21],
                  [0.93, 0.022, 0.12]];
    for (const [rr0, w, a] of RING) {
      g.strokeStyle = 'rgba(255,222,132,' + (a * 0.40).toFixed(3) + ')';
      g.lineWidth = w * R * 2.6;
      g.beginPath(); g.arc(C, C, rr0 * R, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = 'rgba(255,250,222,' + a.toFixed(3) + ')';
      g.lineWidth = w * R;
      g.beginPath(); g.arc(C, C, rr0 * R, 0, Math.PI * 2); g.stroke();
    }
    // 斷開、錯位的短弧：對稱一被打破，一百個門才不會每個長得一模一樣
    for (let i = 0; i < 14; i++) {
      const rad = (0.22 + rnd() * 0.72) * R;
      const a0 = rnd() * Math.PI * 2, sp = 0.5 + rnd() * 1.9;
      g.strokeStyle = 'rgba(255,243,196,' + (0.10 + rnd() * 0.26).toFixed(3) + ')';
      g.lineWidth = (0.010 + rnd() * 0.028) * R;
      g.beginPath(); g.arc(C, C, rad, a0, a0 + sp); g.stroke();
    }
    // 核：中間一小點亮，光才有「源頭」——小而不厚，蓋不掉從裡面探出來的刃
    const cr = g.createRadialGradient(C, C, 0, C, C, R * 0.26);
    cr.addColorStop(0, 'rgba(255,255,255,0.92)');
    cr.addColorStop(0.5, 'rgba(255,252,236,0.70)');
    cr.addColorStop(1, 'rgba(255,236,170,0)');
    g.fillStyle = cr;
    g.beginPath(); g.arc(C, C, R * 0.26, 0, Math.PI * 2); g.fill();
    return cv;
  }

  /* 王之財寶的門。list 每一項 {x, y, z, r 半徑, rot 自轉角, op 亮度,
     dx/dy/dz 兵器從這個門探出來的方向}。

     **法線＝兵器的方向**（v1.132.1 改，本來是一律正對鏡頭的公告板）。門是虛空裂開的
     一個洞，兵器從洞裡垂直探出來，所以洞的朝向就是兵器的朝向——斜著看的時候它本來
     就該是個橢圓而不是正圓（使用者：「同心波紋 不一定是正對鏡頭的圓」，參考圖裡那些
     也都是各種角度的橢圓）。兵器整體朝鏡頭飛，所以多數的門仍然大致面向玩家。
     instance color 是亮度旋鈕（貼圖本身已經是金色的）。 */
  function putGates(list) {
    const n = Math.min(list.length, GATE_MAX);
    gateMesh.visible = n > 0;
    gateMesh.count = n;
    if (!n) return;
    for (let i = 0; i < n; i++) {
      const p = list[i];
      scratch.position.set(p.x, p.y, p.z);
      /* 這片四邊形生在 XY 平面、法線是 +Z，所以把 +Z 轉到兵器的方向就對了；
         再繞自己的法線轉 rot（那是每個門各自的自轉，順序不能反）。 */
      _axis.set(p.dx || 0, p.dy || 0, p.dz || 0);
      if (_axis.lengthSq() < 1e-9) _axis.set(0, 0, 1);
      _axis.normalize();
      scratch.quaternion.setFromUnitVectors(_zAxis, _axis);
      _spin.setFromAxisAngle(_zAxis, p.rot || 0);
      scratch.quaternion.multiply(_spin);
      scratch.scale.setScalar(p.r * 2);          // 給的是半徑，貼圖鋪滿的是直徑
      scratch.updateMatrix();
      gateMesh.setMatrixAt(i, scratch.matrix);
      const o = p.op === undefined ? 1 : p.op;
      gateMesh.setColorAt(i, tmpC.setRGB(o, o, o));
    }
    gateMesh.instanceMatrix.needsUpdate = true;
    if (gateMesh.instanceColor) gateMesh.instanceColor.needsUpdate = true;
  }

  /* 兵器。list 每一項 {x, y, z, dx, dy, dz 刃尖指向（單位向量）, roll 繞自己轉多少,
     len 全長, k 第幾種（WEAP_KIND）, fade 不透明度, cut 世界座標的切面 [nx,ny,nz,d]}。
     造型是刃尖朝 +Y、長度 1，所以這裡就是「把 +Y 轉到指向、再等比放大到 len」。
     淡出與切面都走逐 instance 的屬性（見 weapCut／weapFade 的說明），
     不是靠縮放假裝——縮小看起來像被吸走，而且「埋在門裡那一段」根本不能用縮放表示。 */
  function putWeapons(list) {
    const n = Math.min(list.length, WEAP_MAX);
    weapMesh.visible = n > 0;
    weapMesh.count = n * WEAP_PARTS;
    if (!n) return;
    let colDirty = false;
    for (let i = 0; i < n; i++) {
      const w = list[i];
      const K = WEAP_KIND[w.k] || WEAP_KIND[0];
      _axis.set(w.dx, w.dy, w.dz);
      if (_axis.lengthSq() < 1e-9) _axis.set(0, -1, 0);
      _axis.normalize();
      scratch.position.set(w.x, w.y, w.z);
      scratch.quaternion.setFromUnitVectors(_yAxis, _axis);
      _spin.setFromAxisAngle(_yAxis, w.roll || 0);
      scratch.quaternion.multiply(_spin);
      scratch.scale.setScalar(w.len);
      scratch.updateMatrix();
      const fresh = weapSlotKind[i] !== w.k;
      /* 切面與不透明度是「整把一個值」，但屬性是逐 instance（一把 WEAP_PARTS 個），
         所以每一塊都要寫同一份。 */
      const c = w.cut, fd = w.fade === undefined ? 1 : Math.max(0, Math.min(1, w.fade));
      const cx = c ? c[0] : 0, cy = c ? c[1] : 0, cz = c ? c[2] : 0, cw = c ? c[3] : -1;
      for (let j = 0; j < WEAP_PARTS; j++) {
        const P = K[j];
        if (P) {
          scratchB.position.set(P.p[0], P.p[1], P.p[2]);
          scratchB.rotation.set(P.r ? P.r[0] : 0, P.r ? P.r[1] : 0, P.r ? P.r[2] : 0);
          scratchB.scale.set(P.s[0], P.s[1], P.s[2]);
        } else {
          // 這一種沒用到的塊：縮成一個點，畫不出東西（不足的部位一律這樣塞掉）
          scratchB.position.set(0, 0, 0);
          scratchB.rotation.set(0, 0, 0);
          scratchB.scale.setScalar(0);
        }
        scratchB.updateMatrix();
        tmpM.multiplyMatrices(scratch.matrix, scratchB.matrix);
        const at = i * WEAP_PARTS + j;
        weapMesh.setMatrixAt(at, tmpM);
        weapCut.array[at * 4] = cx; weapCut.array[at * 4 + 1] = cy;
        weapCut.array[at * 4 + 2] = cz; weapCut.array[at * 4 + 3] = cw;
        weapFade.array[at] = fd;
        if (fresh) weapMesh.setColorAt(at, tmpC.setHex(P ? P.c : 0xffffff));
      }
      if (fresh) { weapSlotKind[i] = w.k; colDirty = true; }
    }
    weapMesh.instanceMatrix.needsUpdate = true;
    weapCut.needsUpdate = true; weapFade.needsUpdate = true;
    if (colDirty && weapMesh.instanceColor) weapMesh.instanceColor.needsUpdate = true;
  }

  /* 火球粒子。跟塵霧同一套資料格式，只是走那顆不透明的材質 */
  function putFire(parts) {
    const n = Math.min(parts.length, MAXFIRE);
    fireMesh.visible = n > 0;
    fireMesh.count = n;
    for (let i = 0; i < n; i++) {
      const p = parts[i];
      scratch.position.set(p.x, p.y, p.z);
      /* ln 有值＝這顆要拉成一條（煙火的火星尾）：沿著它飛的方向拉長、橫向壓細。
         連續幾顆首尾接起來就是一條線，而不是一串點——參考圖那種放射狀的細線
         靠的就是這個。dx/dy/dz 要先正規化好（單位向量轉單位向量）。
         其他粒子照舊給隨機角度，那要的是亂翻的碎火。 */
      if (p.ln) {
        _axis.set(p.dx, p.dy, p.dz);
        scratch.quaternion.setFromUnitVectors(_xAxis, _axis);
        scratch.scale.set(p.ln, p.s, p.s);
      } else {
        scratch.rotation.set(p.rx, p.ry, 0);
        scratch.scale.setScalar(p.s);
      }
      scratch.updateMatrix();
      fireMesh.setMatrixAt(i, scratch.matrix);
      fireMesh.setColorAt(i, tmpC.setRGB(p.cr, p.cg, p.cb));
    }
    fireMesh.instanceMatrix.needsUpdate = true;
    if (fireMesh.instanceColor) fireMesh.instanceColor.needsUpdate = true;
  }

  /* 爆炸中心那顆火球。list 每一項 {x, y, z, r 現在的半徑, op 亮度, magic 要不要粉紅} */
  function putFlash(list) {
    const n = Math.min(list.length, FLASH_MAX);
    flashGroup.visible = n > 0;
    if (!n) return;
    for (let i = 0; i < FLASH_SHELL.length; i++) {
      const sh = FLASH_SHELL[i], m = flashShells[i];
      m.count = n;
      for (let k = 0; k < n; k++) {
        const f = list[k];
        const r = f.r * sh.r;
        scratch.position.set(f.x, f.y, f.z);
        scratch.rotation.set(0, 0, 0);
        scratch.scale.set(r, r * FLASH_SQUASH, r);
        scratch.updateMatrix();
        m.setMatrixAt(k, scratch.matrix);
        m.setColorAt(k, tmpC.setHex(f.magic ? sh.mc : sh.c).multiplyScalar(f.op));
      }
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  /* 十字星光。list 每一項 {x, y, z, s 大小, rot 自轉角, op 亮度, cr/cg/cb 顏色}。
     公告板：直接抄鏡頭的旋轉，再繞自己的法線轉 rot——這樣星芒永遠正對著看的人，
     而 rot 才是「每顆星各自斜著」的那個角度。順序不能反，反了就變成先斜再面向鏡頭。 */
  function putStars(list) {
    const n = Math.min(list.length, MAXSTAR);
    starMesh.visible = n > 0;
    starMesh.count = n;
    for (let i = 0; i < n; i++) {
      const p = list[i];
      scratch.position.set(p.x, p.y, p.z);
      scratch.quaternion.copy(camera.quaternion);
      _spin.setFromAxisAngle(_zAxis, p.rot);
      scratch.quaternion.multiply(_spin);
      scratch.scale.setScalar(p.s);
      scratch.updateMatrix();
      starMesh.setMatrixAt(i, scratch.matrix);
      // 加法混色下 instance color 就是亮度旋鈕：顏色乘上濃度，一顆星的明滅全靠它
      starMesh.setColorAt(i, tmpC.setRGB(p.cr * p.op, p.cg * p.op, p.cb * p.op));
    }
    starMesh.instanceMatrix.needsUpdate = true;
    if (starMesh.instanceColor) starMesh.instanceColor.needsUpdate = true;
  }

  /* 藍色閃電。list 每一項是一小段 {x1,y1,z1 → x2,y2,z2, w 粗細, op 亮度}。
     一段一個 instance：把單位方塊沿 X 拉成這一段的長度，再把 +X 轉到這一段的方向。
     顏色固定淺藍（0.32/0.58/1）——這是「藍色閃電」，顏色不是每段可調的參數。
     深淺有個窄窗，而且要連遠處都還看得出是藍的（場景有霧，越遠越往天空色洗）：
     綠 0.72 在畫面上藍綠只差 3/255，是青白色的；0.5 很藍但偏重（使用者要淺一點）；
     0.68 在遠鏡頭下被霧洗到只差 19，所以停在 0.58。
     op 是明滅用的亮度旋鈕（實色材質，所以它調的是顏色深淺不是透明度）。 */
  function putBolts(list) {
    const n = Math.min(list.length, MAXBOLT);
    boltMesh.visible = n > 0;
    boltMesh.count = n;
    for (let i = 0; i < n; i++) {
      const s = list[i];
      const dx = s.x2 - s.x1, dy = s.y2 - s.y1, dz = s.z2 - s.z1;
      const len = Math.hypot(dx, dy, dz) || 0.001;
      _axis.set(dx / len, dy / len, dz / len);
      scratch.position.set((s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2, (s.z1 + s.z2) / 2);
      scratch.quaternion.setFromUnitVectors(_xAxis, _axis);
      scratch.scale.set(len, s.w, s.w);
      scratch.updateMatrix();
      boltMesh.setMatrixAt(i, scratch.matrix);
      boltMesh.setColorAt(i, tmpC.setRGB(0.32 * s.op, 0.58 * s.op, s.op));
    }
    boltMesh.instanceMatrix.needsUpdate = true;
    if (boltMesh.instanceColor) boltMesh.instanceColor.needsUpdate = true;
  }

  /* 草地島做成三層：草皮 → 一圈淺土切邊 → 深土層，邊緣才有等角風格的層次 */
  function setGroundSize(r) {
    groundHalf = r;                    // 地面痕跡要拿它把自己夾在草皮上（見 putMarks）
    ground.scale.set(r * 2, 1.2, r * 2);
    ground.position.set(0, -0.6, 0);
    /* 草的顆粒要跟島一樣大小地長：貼圖鋪幾次＝島的邊長 ÷ 一格幾個單位（見 GRASS_TILE）。
       固定 repeat 的話，小島的草會被放大成一坨一坨的斑點。 */
    if (grassTex) grassTex.repeat.set(r * 2 / GRASS_TILE, r * 2 / GRASS_TILE);
    grassRim.scale.set(r * 1.985, 1.1, r * 1.985);
    grassRim.position.set(0, -1.65, 0);
    dirtPad.scale.set(r * 1.95, 7, r * 1.95);
    dirtPad.position.set(0, -5.2, 0);
  }

  function resize() {
    W = Math.max(1, window.innerWidth);
    H = Math.max(1, window.innerHeight);
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(W, H);          // 要讓 three 一併設 style 寬高，canvas 的內建尺寸靠不住
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    // 取景距離跟畫面比例有關，轉向或拉視窗都要重算：不然直式轉橫式會空一大片，反過來會被切掉
    if (lastFit) fitCamera(lastFit.radius, lastFit.height, lastFit.arena, true);
  }

  /* ── 積木 ───────────────────────────────────────────── */
  function setBlockCount(n) { blockMesh.count = Math.min(n, MAXB); }
  /* 每幀把 InstancedMesh 的包圍球丟掉（v1.98）。

     three 的 InstancedMesh.raycast **第一件事是拿 this.boundingSphere 擋一次**，
     而那顆球是第一次射線判定時算出來、之後就一直用同一顆——這一池的東西卻是一直在動的
     （換一座建築、碎料被轟到場外、小人走到碎料場外緣、v1.97 起小人的家蓋在外圍一帶）。
     於是「射線沒穿過那顆舊球」的方向整池都被跳過，點下去直接落到地板上。
     實測：拿一塊積木擺到半徑 24／28／32／36／40，五個位置**全部**回報打到地板；
     把球丟掉重算之後五個全部正常。使用者是在小房子上遇到的（「用槌子砸好像容易點到地板」）。

     丟掉是 O(1)，重算是 O(n) 而且**只在真的做射線判定時才發生**（three 看到 null 才算），
     也就是只有玩家點下去那一幀——不是每幀。畫面那邊不受影響：
     這兩個 mesh 都 frustumCulled = false，本來就不靠包圍球決定畫不畫。 */
  function dropSphere(m) { m.boundingSphere = null; }

  /* 遊戲層每幀對每塊積木呼叫一次。rot 是 THREE.Euler，s 是縮放（放置彈跳用） */
  function putBlock(i, x, y, z, rot, s, r, g, b) {
    scratch.position.set(x, y, z);
    scratch.rotation.copy(rot);
    scratch.scale.setScalar(BS * s);
    scratch.updateMatrix();
    blockMesh.setMatrixAt(i, scratch.matrix);
    tmpC.setRGB(r, g, b);
    blockMesh.setColorAt(i, tmpC);
  }
  function commitBlocks() {
    blockMesh.instanceMatrix.needsUpdate = true;
    if (blockMesh.instanceColor) blockMesh.instanceColor.needsUpdate = true;
    dropSphere(blockMesh);
  }

  /* ── 小人 ───────────────────────────────────────────── */
  /* 法杖的尺寸（v1.64）。杖身中心在 STAFF_MID、杖頭（寶珠）在它上面 STAFF_TIP 處，
     施法時整根往上抬 CAST_LIFT、杖頭往前傾 CAST_TILT——抬完手掌那個高度剛好落在杖身上。
     這幾個值 BODY、putWorker、WAND_TIP 三處都要用，所以擺在最前面只寫一次。 */
  const STAFF_X = 0.42, STAFF_MID = 0.78, STAFF_Z = 0.02, STAFF_TIP = 0.86;
  const CAST_LIFT = 0.34, CAST_TILT = 0.24;
  /* 肌肉小人的手臂（v1.112）：粗 MUS_ARM 倍、往外挪到 MUS_ARM_X。
     不另開部位是因為手的姿勢有六種分支（搬、歡呼、施法、讀圖、比劃、走路擺手），
     複製一份就得跟著維護兩份。往外挪是因為胸膛比工作服寬：半寬 0.35，
     原本的手掛在 0.34，不挪的話整隻手埋在胸膛裡。 */
  const MUS_ARM_X = 0.46, MUS_ARM = 1.5;
  /* 挖料的鏟子（v1.129，v1.130 照使用者給的照片重做動作）。
     照片上的用法是：**人彎腰，兩手握在近乎垂直的柄上，鏟面插在腳前面的地裡**——
     不是把長柄舉在身體前方橫掃（v1.129 就是那樣，鏟面落在身體前方 1.18 格）。
     所以整支縮短（柄頭到鏟尖 DIG_OVER + DIG_REACH + DIG_PAN/2 = 1.15，
     小人連帽子高 1.31，比例上約 1.5 公尺；v1.129 是 1.36）、手握的位置收到腰邊、
     插到底那一下把身體壓下去 DIG_LEAN。

     一鏟有兩個關鍵格，w.dig（0～1，這一鏟挖到哪了）在它們之間 lerp：
       撬起來（dgS 0）：手在 DIG_GRIP_A、鏟面中心抬到 DIG_UP
       插到底（dgS 1）：手在 DIG_GRIP_B、鏟面中心落到 DIG_DEEP（略低於地面）
     柄的角度**不寫死**，照「手到鏟面的高度差」用 acos 反算——柄一改長角度自己跟著對。
     而且要在**世界座標**算：地面在 y=0，而身體前傾會把整支鏟子帶著往下轉，
     所以先把手的位置轉到世界座標、算完角度再轉回身體座標（見 putWorker 的 digA）。 */
  const DIG_GRIP_A = [0.74, 0.04], DIG_GRIP_B = [0.62, 0.10];   // 手的位置（身體座標 y/z）
  /* 柄要**伸出手的上方** DIG_OVER（照片上柄頭在胸口）：不伸出去的話柄從手掌開始，
     整支被兩隻手臂的方塊蓋掉，畫面上只剩腳邊一小截 ＋ 一塊鐵（試過，看起來像鎯頭）。
     所以柄長是「手上方那截 ＋ 手到鏟面」推出來的，鏟面自己接在柄的下端。 */
  const DIG_OVER = 0.30, DIG_REACH = 0.66, DIG_PAN = 0.38;   // 伸出手上方／手到鏟面中心／鏟面長
  const DIG_LEN = DIG_OVER + DIG_REACH - DIG_PAN * 0.5;      // 柄長
  const DIG_ROD = (DIG_REACH - DIG_PAN * 0.5 - DIG_OVER) / 2;  // 柄中心離手多遠（沿著柄往下）
  const DIG_DEEP = -0.06, DIG_UP = 0.24;          // 鏟面中心：插到底（埋一半）／撬起來
  const DIG_LEAN = 0.30;                          // 插到底那一下整個人往前傾多少
  const digClamp = v => Math.max(-1, Math.min(1, v));
  /* 鏟尖插到最深時在哪（相對小人原點、還沒乘身高），跟法杖的 WAND_TIP 同一個用途：
     規則那邊要拿它決定「積木從哪裡冒出來、土痕與土塵留在哪」。兩邊各寫一份的話，
     鏟子插在腳前面、積木卻從腳底冒出來（v1.129 就是這樣，使用者：「積木出現的位置
     也要合理(目前看起來都固定在小人腳下)」）。 */
  const DIG_TIP = (() => {
    const gy = DIG_GRIP_B[0], gz = DIG_GRIP_B[1];
    const wy = gy * Math.cos(DIG_LEAN) - gz * Math.sin(DIG_LEAN);
    const wz = gy * Math.sin(DIG_LEAN) + gz * Math.cos(DIG_LEAN);
    const ang = Math.acos(digClamp((wy - DIG_DEEP) / DIG_REACH));
    return [0, DIG_DEEP - Math.cos(ang) * DIG_PAN * 0.5,
            wz + Math.sin(ang) * (DIG_REACH + DIG_PAN * 0.5)];
  })();
  /* ── 頭上的表情圖示（v1.121，v1.122 從方塊換成貼圖）─────────────
     使用者：「增加小人表達力，例如驚嘆號 愛心 問號 生氣（一個小圖示 像交談那樣在
     小人旁邊表示）」。哪個情境冒哪一個是規則那邊決定的（見 game-workers.js 的 showEmo），
     這裡只管「長什麼樣、擺哪裡」。

     v1.121 是拿五～八塊小方塊排出形狀的（同小人的身體，共用那顆 InstancedMesh）。
     排到第三版還是不像，使用者：「生氣符號不像 或是能用類似貼圖的方式去做?」——
     方塊排不出弧線，而愛心與怒氣符號的形狀就是弧線，所以整個換掉：**一張程式畫出來的
     貼圖 ＋ 一片永遠正對鏡頭的四邊形**。

     貼圖是啟動時用 canvas 現畫的，不是外部檔案：
       · 這支遊戲要能 file:// 雙擊開（見檔頭），外部圖片在 file:// 下拿去當 WebGL 貼圖
         會被當成跨來源而失敗；自己畫的 canvas 是同源的，一定能用。
       · 也不必多帶一個檔案（「整個資料夾一起打包」那條就不會多一個踩雷點）。
     四種畫在同一張橫條圖上（一格 EMO_CELL 像素），所以只有一份材質、一個 draw call。

     畫的部分故意只用「平塗的路徑」：這個遊戲整個是平面著色的方塊，貼圖要是帶漸層
     或描邊陰影，那一片會像貼了張別的遊戲的圖。 */
  const EMO_KINDS = ['bang', 'quest', 'heart', 'anger'];   // 貼圖上的順序，規則那邊用這幾個字
  const EMO_IDX = {};
  EMO_KINDS.forEach((k, i) => { EMO_IDX[k] = i; });
  const EMO_CELL = 128;              // 貼圖一格幾像素（圖示在畫面上最多四十幾像素，128 夠）
  const EMO_Y = 1.80;                // 圖示底邊的高度（帽頂 1.31、巫師帽尖 1.75）
  const EMO_SIZE = 0.62;             // 那一片有多大（模型單位）。圖只占格子的八成，看起來約 0.5
  const EMO_BOB = 0.03;              // 上下浮多少（跟聊天泡泡一樣會呼吸）
  const EMO_COL = { bang: '#ffd23c', quest: '#54c7f0', heart: '#ff5f8a', anger: '#e8342a' };
  /* 一格一格畫。座標都以「這一格的左上角」為原點，格子是 EMO_CELL 見方，
     圖的實際範圍留在 14～114 之間（四邊各留一成的邊，縮放時才不會被鄰格切到）。 */
  function paintEmo(g, kind, x0) {
    const cx = x0 + EMO_CELL / 2, TAU = Math.PI * 2;
    g.fillStyle = g.strokeStyle = EMO_COL[kind];
    g.lineCap = 'round'; g.lineJoin = 'round';
    if (kind === 'bang') {
      /* 驚嘆號：上寬下窄的一豎 ＋ 一點。梯形比方方正正的一條有精神，
         而且上寬下窄看得出是「!」不是「l」。 */
      g.beginPath();
      g.moveTo(cx - 15, 16); g.lineTo(cx + 15, 16);
      g.lineTo(cx + 9, 80); g.lineTo(cx - 9, 80);
      g.closePath(); g.fill();
      g.beginPath(); g.arc(cx, 102, 13, 0, TAU); g.fill();
    } else if (kind === 'quest') {
      /* 問號：一條粗線畫出「從左邊繞過上面、右邊轉下來、收回中線」的鉤，再點一點。
         用畫的不用字型：字型在別台機器上不一定同一套，形狀會跟著跑。 */
      g.lineWidth = 17;
      g.beginPath();
      g.arc(cx, 46, 23, Math.PI, Math.PI * 2 + 0.55, false);   // 左 → 上 → 右下
      g.quadraticCurveTo(cx + 6, 72, cx, 84);                  // 收回中線
      g.stroke();
      g.beginPath(); g.arc(cx, 104, 10, 0, TAU); g.fill();
    } else if (kind === 'heart') {
      /* 愛心：兩條三次曲線接成的實心心形（使用者給的是 emoji 的實心心）。
         上緣的凹在 (cx, 40)、下尖在 (cx, 108)，寬到 ±50——emoji 的心差不多是正方的。 */
      g.beginPath();
      g.moveTo(cx, 40);
      g.bezierCurveTo(cx + 8, 22, cx + 26, 14, cx + 40, 20);
      g.bezierCurveTo(cx + 58, 28, cx + 58, 54, cx + 44, 72);
      g.bezierCurveTo(cx + 32, 87, cx + 12, 99, cx, 108);
      g.bezierCurveTo(cx - 12, 99, cx - 32, 87, cx - 44, 72);
      g.bezierCurveTo(cx - 58, 54, cx - 58, 28, cx - 40, 20);
      g.bezierCurveTo(cx - 26, 14, cx - 8, 22, cx, 40);
      g.fill();
    } else {
      /* 生氣：漫畫的怒氣符號（💢）。四道弧圍成一圈、缺口在四個斜角——但**弧是往內凹的**：
         每一道的中間凹向圓心、兩頭往斜角撐出去，整體是一個「角在斜角、邊往內縮」的方框，
         不是一個圓圈。v1.122 第一版畫成「貼著圓周的四段弧」，使用者：「生氣圖案現在
         看起來像個圓形 不對」——貼著圓周畫出來的當然就是一個圓。

         這一版的數字是**從使用者給的那張圖量出來的**（每 5° 掃一次，量每個角度上著色像素的
         內外半徑，R＝那張圖的半寬）：
           · 正上下左右：內 0.48、外 0.77（線寬 0.29R，中間那個洞占直徑的一半）
           · 斜角附近：外緣撐到 1.09R——正好是 0.77×√2，也就是**外框是個方的**
           · 45° 整整空白：缺口就開在斜角上
         照這三筆反推：兩頭在離軸 ±32° 的地方、半徑 0.94R（加上半個圓頭剛好撐到 1.09R，
         而且 49° 之後就沒有東西了，跟量到的缺口對得起來），中點要落在 0.625R
         （＝(0.48+0.77)÷2），所以二次曲線的控制點擺在 2×0.625R − 0.94R×cos32° = 0.453R。 */
      const cy = 64, R = 46, TIP = 0.94 * R, CTRL = 0.453 * R, SPAN = 0.5585;   // 32°
      g.lineWidth = 0.29 * R;
      for (let i = 0; i < 4; i++) {
        const th = i * Math.PI / 2, a0 = th - SPAN, a1 = th + SPAN;
        g.beginPath();
        g.moveTo(cx + Math.cos(a0) * TIP, cy + Math.sin(a0) * TIP);
        g.quadraticCurveTo(cx + Math.cos(th) * CTRL, cy + Math.sin(th) * CTRL,
                           cx + Math.cos(a1) * TIP, cy + Math.sin(a1) * TIP);
        g.stroke();
      }
    }
  }
  function paintEmoAtlas() {
    const cv = document.createElement('canvas');
    cv.width = EMO_CELL * EMO_KINDS.length;
    cv.height = EMO_CELL;
    const g = cv.getContext('2d');
    for (let i = 0; i < EMO_KINDS.length; i++) paintEmo(g, EMO_KINDS[i], i * EMO_CELL);
    return cv;
  }
  /* 身體各部位（相對小人原點）。x 會左右鏡射，所以只寫一半 */
  const BODY = [
    { p: [0, 0.60, 0], s: [0.50, 0.52, 0.34], c: 'suit' },   // 身體
    { p: [0, 1.02, 0], s: [0.40, 0.36, 0.40], c: 'skin' },   // 頭
    /* 安全帽拆成「帽緣一圈 + 帽頂一塊 + 前面帽舌」三塊（v1.51）。
       本來是一塊 0.52×0.14×0.52 的平板，遠看是頭上蓋了張紙。
       帽頂的上緣仍然停在 1.31——那個高度是搬運時積木擱的位置，改了積木就會陷進帽子。 */
    { p: [0, 1.19, 0], s: [0.54, 0.06, 0.54], c: 'hat', hard: 1 },   // 帽緣（比帽頂寬一圈）
    { p: [-0.14, 0.20, 0], s: [0.20, 0.42, 0.24], c: 'leg', swing: -1 },
    { p: [0.14, 0.20, 0], s: [0.20, 0.42, 0.24], c: 'leg', swing: 1 },
    { p: [-0.34, 0.62, 0], s: [0.16, 0.44, 0.20], c: 'skin', arm: -1 },
    { p: [0.34, 0.62, 0], s: [0.16, 0.44, 0.20], c: 'skin', arm: 1 },
    /* 以下三塊是道具。p/s 只是預設值，真正的位置在 putWorker 裡按姿勢重算；
       沒拿的人 scale 設 0（退化成一個點，畫不出東西）。 */
    /* 藍圖畫得比肩膀寬（身體 0.50，圖 0.80），而且斜立起來——工程師是面向建築站的，
       玩家多半從他背後看過去，圖只有露出身體兩側的那一截看得到。 */
    { p: [0, 0.80, 0.26], s: [0.80, 0.05, 0.50], c: 'plan', plan: 1 },   // 工程師的藍色設計圖
    /* 聊天泡泡要兩塊：頭上一顆白方塊自己看起來只是一塊飄在半空的積木，
       加一顆小的把它跟頭連起來，才讀得出是對話框。 */
    { p: [0.20, 1.68, 0], s: [0.46, 0.34, 0.38], c: 'talk', bub: 1 },
    { p: [0.11, 1.44, 0], s: [0.18, 0.18, 0.16], c: 'talk', bub: 1 },
    /* ── 細節（v1.51，接在最後面：前面那幾塊的索引被測試拿來認部位）──────
       小人放大 1.5 倍之後，原本那七塊看起來就是一疊方塊。這六塊補的是
       「一眼看出他面朝哪邊、腳踩在哪裡」——臉、鞋、腰各一件事。 */
    /* 帽頂要夠厚：帽緣只比它寬 0.05，才是工地安全帽；帽緣太寬會變成一頂草帽。 */
    { p: [0, 1.25, 0], s: [0.44, 0.12, 0.44], c: 'hat', hard: 1 },       // 帽頂（上緣停在 1.31）
    { p: [0, 1.185, 0.32], s: [0.34, 0.05, 0.20], c: 'hat', hard: 1 },   // 帽舌（只有前面有，指出朝向）
    /* 眼睛貼在臉皮外面一點點（頭的前緣在 z=0.20，眼睛中心也在 0.20，凸出去 0.015）：
       完全切齊的話兩個面共平面，會閃爍。 */
    { p: [-0.10, 1.06, 0.20], s: [0.08, 0.10, 0.03], c: 'eye' },
    { p: [0.10, 1.06, 0.20], s: [0.08, 0.10, 0.03], c: 'eye' },
    /* 鞋子比腿寬一點、往前多一點，而且要跟著腿擺（swing 跟同一邊的腿同號）。 */
    { p: [-0.14, 0.05, 0.03], s: [0.23, 0.11, 0.30], c: 'shoe', swing: -1 },
    { p: [0.14, 0.05, 0.03], s: [0.23, 0.11, 0.30], c: 'shoe', swing: 1 },
    { p: [0, 0.40, 0], s: [0.53, 0.10, 0.37], c: 'belt' },      // 腰帶：把長條的身體斷開
    /* ── 肌肉小人（v1.112）───────────────────────────────────────
       裸上半身：工作服（第 0 塊，'suit'）在他身上縮成 0，換成這一塊膚色的胸膛——
       比工作服寬 0.20、厚 0.10，底面抬到腰帶上面（0.45）：一路蓋到腰的話腰身就沒了，
       遠看是一個桶子。肩與胸肌各兩塊補在胸膛的外側與前面：一塊放大的方塊讀不出是肌肉，
       要有「肩比胸寬、胸往前鼓」這兩個轉折才看得出來。手臂不另開部位（見 MUS_ARM）。
       擺在魔法師那一段**前面**：測試靠「BODY 最後一塊是寶珠」認寶珠。 */
    { p: [0, 0.68, 0], s: [0.70, 0.46, 0.44], c: 'skin', mus: 1 },        // 胸膛（取代工作服）
    { p: [-0.35, 0.82, 0], s: [0.28, 0.24, 0.42], c: 'skin', mus: 1 },    // 左肩（比胸膛再寬 0.14）
    { p: [0.35, 0.82, 0], s: [0.28, 0.24, 0.42], c: 'skin', mus: 1 },     // 右肩
    { p: [-0.17, 0.78, 0.24], s: [0.30, 0.20, 0.10], c: 'skin', mus: 1 }, // 左胸肌（往前鼓 0.07）
    { p: [0.17, 0.78, 0.24], s: [0.30, 0.20, 0.10], c: 'skin', mus: 1 },  // 右胸肌
    /* ── 挖料的鏟子（v1.129，使用者：「先用鏟子挖出積木」）─────────
       只有在挖的那幾秒拿在手上（w.dig > 0），其他時候縮成 0。
       位置與角度在 putWorker 裡按那一鏟的深淺重算，這裡寫的是預設值。
       柄借法杖那個木色，鏟面借推土機那片鏟刃的鐵色——場上本來就有這兩種材質。 */
    { p: [0, DIG_GRIP_A[0], DIG_GRIP_A[1]], s: [0.07, DIG_LEN, 0.07], c: 'staff', dig: 1 },
    { p: [0, DIG_GRIP_A[0], DIG_GRIP_A[1]], s: [0.32, DIG_PAN, 0.05], c: 'blade', dig: 1, pan: 1 },
    /* ── 魔法師（v1.64，一樣接在最後面）───────────────────────────
       巫師帽是三塊往上收的方塊（帽簷 → 帽身 → 帽尖），voxel 世界裡的圓錐就長這樣；
       只有兩塊的話收得不夠急，遠看跟安全帽分不出來。戴這頂的人不戴安全帽
       （hard 那三塊縮到 0），兩頂疊著會直接穿模。 */
    { p: [0, 1.21, 0], s: [0.66, 0.07, 0.66], c: 'wiz', wiz: 1 },   // 帽簷（比安全帽寬得多）
    { p: [0, 1.40, 0], s: [0.38, 0.32, 0.38], c: 'wiz', wiz: 1 },   // 帽身
    { p: [0, 1.64, 0], s: [0.17, 0.22, 0.17], c: 'wiz', wiz: 1 },   // 帽尖
    /* 法杖：一根長方塊 ＋ 頂端一顆寶珠。位置在 putWorker 裡按施法深淺重算，
       這裡寫的是垂在右手邊的常態姿勢。 */
    { p: [STAFF_X, STAFF_MID, STAFF_Z], s: [0.09, 1.56, 0.09], c: 'staff', wiz: 1, staff: 1 },
    { p: [STAFF_X, STAFF_MID + STAFF_TIP, STAFF_Z], s: [0.22, 0.22, 0.22], c: 'orb', wiz: 1, orb: 1 }
  ];
  /* 施法時杖頭在世界座標的位置（相對小人原點、還沒乘身高）。規則那邊要拿它撒星，
     兩邊各寫一份的話改了傾角星星就飄到別的地方去。 */
  const WAND_TIP = [STAFF_X, STAFF_MID + CAST_LIFT + Math.cos(CAST_TILT) * STAFF_TIP,
                    STAFF_Z + Math.sin(CAST_TILT) * STAFF_TIP];
  /* BODY 裡每個部位的 c 都必須在這裡有對應的色組，漏一個就整個 draw 掛掉。
     只有一個顏色的色組是「所有人都一樣」（w.tone % 1 永遠是 0）。 */
  const WCOL = {
    skin: [0xf0c39a, 0xd9a173, 0xbb8055, 0xe8b489],
    suit: [0xe8a13c, 0x4a8fd8, 0x54b06a, 0xd66a5a],
    leg: [0x3f4a5c, 0x5a4632, 0x2f3a49, 0x4a4030],
    hat: [0xf5e14b],
    plan: [0x2f6fd0],
    talk: [0xffffff],
    eye: [0x2a231d],
    shoe: [0x3b332c],
    belt: [0x4a4039],
    /* 魔法師的配色照場上既有的「魔法」語彙走：陣是桃紅、星是粉與金，
       所以帽子給深紫（安全帽的亮黃旁邊一眼認得出不是同一種人）、寶珠給金。 */
    wiz: [0x4a3b8c],
    staff: [0x6a4a30],
    blade: [0x6f7780],      // 鏟面：鐵（v1.130 壓深一階，亮灰看起來像鎯頭）
    orb: [0xffd66b]
  };
  const ORB_LIT = new T.Color(0xffffff);   // 施法時寶珠往這個亮色靠（要跟金色差得夠開才看得出亮起來）

  function setWorkerCount(n) { workerMesh.count = Math.min(n, MAXW) * WPARTS; }
  const CHAR = new T.Color(0x2b1d15);        // 燒起來的人往這個焦黑色靠

  /* 打滾時的旋轉中心：身體從腳底 0 長到帽頂 1.31，中段在 0.65。
     小人的原點在腳底，直接繞原點轉的話那是「以腳為軸繞圈」不是打滾——
     tilt 轉過水平之後整個人會插進地面下，實測有大半圈是埋在地裡的，
     看起來就變成「倒下去→消失→從另一邊冒出來」。

     中心離地多高還要跟著姿勢走：站著（或倒立）時是半個身高，橫躺時只有半個身厚。
     固定用半個身高的話，橫躺那半圈整個人浮在草皮上面。 */
  const ROLL_PIVOT = 0.65, ROLL_FLAT = 0.30;
  /* 仰躺時最深的那一塊是安全帽的帽緣（0.54 深的一片，半深 0.27）。
     抬這麼多，整個人剛好躺在草皮上，一塊都不埋（v1.60）。 */
  const FLAT_LIFT = 0.27;
  const HIP = 0.41;                          // 髖關節高度（腿的上緣），走路擺動的圓心
  /* w：{x,y,z,a 朝向,ph 步伐相位,carry 是否舉手,tilt 跌倒角度,tone 膚色/衣色編號,
        burnK 身上燒黑的深淺（0～1，火滅之後會自己褪回 0）,roll 正在打滾,
        hail 慶祝舉手,plan 手上有藍圖,point 指揮動作剩幾秒,talk 說話中,bub 泡泡大小 0～1,
        mage 是不是魔法師（戴巫師帽、拿法杖）,cast 施法深淺 0～1（杖抬多高、寶珠多亮）,
        mus 是不是肌肉小人（裸上半身、肩臂粗一圈）,
        dig 挖料的深淺（0＝沒拿鏟子，0～1＝這一鏟挖到哪了，見 DIG_GRIP_A）,
        emo 頭上的表情圖示是哪一種（EMO_KINDS 裡的字，空的就是沒有）,emoK 圖示大小 0～1
        ——這兩個是 putEmotes 在用的，putWorker 本身不畫圖示} */
  function putWorker(i, w) {
    const piv = w.roll ? ROLL_PIVOT : 0;
    /* 這一鏟的相位（v1.129）：一鏟的頭尾都是 0（鏟子撬起來）、中間是 1（插到底），
       所以一塊挖完接下一塊時是連續的。手、鏟子、身體前傾三處共用同一個值。 */
    const dgS = w.dig ? Math.sin(w.dig * Math.PI) : 0;
    /* 鏟子這一鏟擺在哪（v1.130）。手的位置在兩個關鍵格之間 lerp；柄的角度照
       「手到鏟面的高度差」反算，而且是在**世界座標**算的（地面在 y=0），
       算完再加回身體前傾轉成身體座標——身體轉了 lean，同一支鏟子的世界角度就是
       身體座標角度減掉 lean。 */
    let digA = 0, digGy = 0, digGz = 0;
    if (w.dig) {
      const lean = DIG_LEAN * dgS;
      digGy = DIG_GRIP_A[0] + (DIG_GRIP_B[0] - DIG_GRIP_A[0]) * dgS;
      digGz = DIG_GRIP_A[1] + (DIG_GRIP_B[1] - DIG_GRIP_A[1]) * dgS;
      const wy = digGy * Math.cos(lean) - digGz * Math.sin(lean);   // 手的世界高度
      const by = DIG_UP + (DIG_DEEP - DIG_UP) * dgS;                // 鏟面該落在哪個高度
      digA = Math.acos(digClamp((wy - by) / DIG_REACH)) + lean;
    }
    /* 沒在打滾但身體是斜的（被戳倒、被震倒、飛在半空翻滾）也要抬——
       原點在腳底，倒到水平時整個身體剛好落在草皮那一層，半個身厚是埋在地裡的。
       抬 |sin(傾角)| × 半個身厚：站直時 0，躺平時剛好把人托在草地上（v1.60）。 */
    const lift = piv ? (ROLL_FLAT + (ROLL_PIVOT - ROLL_FLAT) * Math.abs(Math.cos(w.tilt || 0)))
                     : FLAT_LIFT * Math.abs(Math.sin(w.tilt || 0));
    scratch.position.set(w.x, w.y + lift * (w.scale || 1), w.z);
    /* 順序用 YZX：R = Ry(朝向)·Rz(打滾)·Rx(躺平)。z 那一軸轉的是「躺平之後的身體長軸」，
       也就是滾木頭那個滾法。沒在打滾時 z 給 0，跟原本的 YXZ 完全等價。 */
    scratch.rotation.set((w.tilt || 0) + DIG_LEAN * dgS, w.a,
                         w.roll ? (w.rspin || 0) : 0, 'YZX');
    scratch.scale.setScalar(w.scale || 1);
    scratch.updateMatrix();
    for (let k = 0; k < WPARTS; k++) {
      const b = BODY[k];
      scratchB.position.set(b.p[0], b.p[1], b.p[2]);
      scratchB.rotation.set(0, 0, 0);
      scratchB.scale.set(b.s[0], b.s[1], b.s[2]);
      /* 走路時腿前後擺。擺的是「以髖關節為圓心」，所以往前挪多少要看這一塊離髖多遠——
         鞋子掛在腳底（離髖 0.36），照腿的 0.21 挪的話鞋會從腿上掉出來。 */
      if (b.swing) {
        const sw = Math.sin(w.ph) * b.swing * w.gait;
        scratchB.rotation.x = sw;
        scratchB.position.z = b.p[2] + Math.sin(sw) * (HIP - b.p[1]);
        scratchB.position.y = b.p[1] - Math.abs(Math.sin(sw)) * 0.05;
      }
      /* 手的姿勢有先後：搬東西 → 歡呼 → 拿藍圖（含指揮）→ 說話比劃 → 走路擺手。
         負的 rotation.x 是把手往前上方抬（-1.5 是水平前伸，-2.8 幾乎舉直）。 */
      if (b.arm) {
        if (w.carry) {                      // 搬東西時雙手舉高
          scratchB.rotation.x = -2.5;
          scratchB.position.y = 0.85; scratchB.position.z = -0.16;
        } else if (w.dig) {
          /* 挖料（v1.130）：兩手握在鏟柄上，一隻握上端、另一隻往下握一截
             （照使用者給的照片；兩隻手擺一樣的話看起來是抱著柄，不是握著）。
             手掛在肩上、伸長只有 0.22，搆不到柄的最上端——所以柄的上端本來就
             畫在腰邊（DIG_GRIP_A），兩隻手朝它斜下去就對得上。 */
          const hi = b.arm > 0;
          scratchB.rotation.x = (hi ? -0.45 : -0.80) - 0.20 * dgS;
          scratchB.position.y = (hi ? 0.76 : 0.66) - 0.03 * dgS;
          scratchB.position.z = hi ? 0.02 : 0.08;
        } else if (w.hail) {                // 慶祝：雙手舉高、跟著跳的節奏晃
          scratchB.rotation.x = -2.75 + Math.sin(w.ph) * 0.22;
          scratchB.rotation.z = b.arm * 0.30;
          scratchB.position.y = 0.82;
        } else if (w.cast > 0.02 && b.arm > 0) {   // 施法：拿杖那隻手抬起來扶著杖身
          scratchB.rotation.x = -1.15 * w.cast;
          scratchB.position.y = b.p[1] + 0.16 * w.cast;
        } else if (w.plan) {
          if (w.point > 0 && b.arm > 0) {   // 指揮：右手抬起來朝建築指，左手還端著圖
            scratchB.rotation.x = -2.05 - Math.sin(w.ph * 2.2) * 0.28;
            scratchB.position.y = 0.80;
          } else {                          // 讀圖：雙手前伸把圖端在胸前
            scratchB.rotation.x = -1.25;
            scratchB.position.y = 0.70; scratchB.position.z = 0.14;
          }
        } else if (w.talk && b.arm > 0) {   // 說話的人單手比劃
          scratchB.rotation.x = -1.0 - Math.sin(w.ph * 2.6) * 0.45;
          scratchB.position.y = 0.66; scratchB.position.z = 0.10;
        } else {
          scratchB.rotation.x = -Math.sin(w.ph) * b.arm * w.gait * 0.8;
        }
      }
      /* 肌肉小人（v1.112）：工作服那一塊收掉（裸上半身），胸膛／肩／胸肌那五塊只有他有，
         手臂加粗並往外挪（見 MUS_ARM）。挪的是 x——手的六種姿勢都只動 rotation 與 y／z，
         所以擺在它們後面不會被蓋掉。 */
      if (w.mus) {
        if (b.c === 'suit') scratchB.scale.setScalar(0);
        else if (b.arm) {
          scratchB.position.x = b.arm * MUS_ARM_X;
          scratchB.scale.set(b.s[0] * MUS_ARM, b.s[1], b.s[2] * MUS_ARM);
        }
      } else if (b.mus) scratchB.scale.setScalar(0);
      /* 藍圖跟著手走：指揮時收到左手邊垂著，平常端在胸前、斜著朝自己 */
      if (b.plan) {
        if (!w.plan) scratchB.scale.setScalar(0);
        else if (w.point > 0) {
          scratchB.position.set(-0.34, 0.56, 0.14);
          scratchB.rotation.set(-0.35, 0, 0.55);
        } else {
          scratchB.rotation.x = -1.0;
        }
      }
      /* 聊天泡泡：說話的那一方才鼓起來，還會隨語氣上下浮 */
      if (b.bub) {
        const k = w.bub || 0;
        if (k < 0.02) scratchB.scale.setScalar(0);
        else {
          scratchB.scale.set(b.s[0] * k, b.s[1] * k, b.s[2] * k);
          scratchB.position.y = b.p[1] + Math.sin(w.ph * 2.6) * 0.05;
        }
      }
      /* 鏟子（v1.129）：沒在挖的人縮成 0。柄與鏟面都掛在同一個握把上（digGy／digGz），
         沿著柄的方向各自往外挪自己的距離——所以只要一個角度就把兩塊擺好。
         角度與握把的位置在上面算（digA），這裡只負責擺。 */
      if (b.dig) {
        if (!w.dig) scratchB.scale.setScalar(0);
        else {
          const d = b.pan ? DIG_REACH : DIG_ROD;           // 鏟面在柄的下端、柄自己的中心偏下
          scratchB.position.set(0, digGy - Math.cos(digA) * d, digGz + Math.sin(digA) * d);
          scratchB.rotation.x = -digA;
        }
      }
      /* 魔法師戴巫師帽，安全帽那三塊收掉——兩頂疊在同一顆頭上會直接穿模。 */
      if (b.hard && w.mage) scratchB.scale.setScalar(0);
      /* 巫師帽與法杖只有魔法師有。杖與寶珠跟著施法深淺（w.cast 0～1）抬起來，
         寶珠的位置是用杖的傾角算出來的：寫死的話一抬杖它就脫離杖頂飄在旁邊。 */
      if (b.wiz) {
        if (!w.mage) scratchB.scale.setScalar(0);
        else if (b.staff || b.orb) {
          const k = w.cast || 0, tl = CAST_TILT * k;
          if (b.staff) {
            scratchB.rotation.x = tl;
            scratchB.position.y = b.p[1] + CAST_LIFT * k;
          } else {
            scratchB.position.y = STAFF_MID + CAST_LIFT * k + Math.cos(tl) * STAFF_TIP;
            scratchB.position.z = b.p[2] + Math.sin(tl) * STAFF_TIP;
          }
        }
      }
      scratchB.position.y -= piv;      // 打滾時整具身體往下挪，旋轉中心才落在身體中段
      scratchB.updateMatrix();
      tmpM.multiplyMatrices(scratch.matrix, scratchB.matrix);
      workerMesh.setMatrixAt(i * WPARTS + k, tmpM);
      const pal = WCOL[b.c];
      tmpC.setHex(pal[w.tone % pal.length]);
      // 寶珠在施法時亮起來，還帶一點明滅——這是「他正在施法」最省事的那個訊號
      if (b.orb && w.cast) tmpC.lerp(ORB_LIT, w.cast * (0.55 + 0.3 * Math.sin(w.ph * 3)));
      if (w.burnK) tmpC.lerp(CHAR, w.burnK);
      // wetK：被水噴到之後整個人要乘的倍率（沒濕就不給）。深淺是規則那邊定的，不在這裡寫死
      if (w.wetK) tmpC.multiplyScalar(w.wetK);
      workerMesh.setColorAt(i * WPARTS + k, tmpC);
    }
  }
  function commitWorkers() {
    workerMesh.instanceMatrix.needsUpdate = true;
    if (workerMesh.instanceColor) workerMesh.instanceColor.needsUpdate = true;
    dropSphere(workerMesh);
  }

  /* ── 頭上的表情圖示（v1.122）───────────────────────────────
     list 就是小人那個陣列（規則那邊直接丟 workers 進來），一個人最多畫一片。
     每一片是四個頂點，位置直接用**鏡頭的右向量與上向量**拼出來——這樣它永遠正對鏡頭，
     連俯角都跟著（十字星光是同一套，只是那邊用四元數轉整個 instance）。
     用鏡頭的**四元數**不是 matrixWorld：矩陣要等 render() 才重算，
     這裡是 render 之前跑的，拿到的會是上一幀的角度，轉鏡頭時圖示會慢一拍。 */
  const EMO_SX = [-1, 1, 1, -1], EMO_SY = [1, 1, -1, -1];   // 左上、右上、右下、左下
  function putEmotes(list) {
    let n = 0;
    _emoR.set(1, 0, 0).applyQuaternion(camera.quaternion);
    _emoU.set(0, 1, 0).applyQuaternion(camera.quaternion);
    for (let i = 0; i < list.length && n < MAXW; i++) {
      const w = list[i];
      const k = w.emoK || 0, cell = EMO_IDX[w.emo];
      /* 身體不是站直的就不畫：圖示是「掛在頭上」的，人躺著、打滾的時候那一片還飄在
         原處會很突兀。規則那邊也會在被炸飛／著火／倒下時把 emoK 收掉
         （見 game-workers.js 的 stepEmo），這裡再擋一次是因為「站不站得直」
         本來就是畫面上的事。 */
      if (k < 0.02 || cell === undefined || w.roll || Math.abs(w.tilt || 0) > 0.15) continue;
      /* 大小與高度**都**乘上 emoK：底邊固定在 EMO_Y，所以是從錨點長出來的，
         不是原地放大（半高 = 中心高 − EMO_Y，兩個都乘 k 就永遠對得起來）。
         整組再乘上這個人的身高——矮的人頭上那個圖也該小一點。 */
      const s = w.scale || 1, hs = EMO_SIZE * 0.5 * k * s;
      const cy = w.y + (EMO_Y + EMO_SIZE * 0.5 * k) * s + Math.sin(w.ph * 2.2) * EMO_BOB * s;
      const u0 = cell / EMO_KINDS.length, u1 = (cell + 1) / EMO_KINDS.length;
      const o = n * 12, t = n * 8;
      for (let c = 0; c < 4; c++) {
        const a = EMO_SX[c] * hs, b = EMO_SY[c] * hs;
        emoPos[o + c * 3] = w.x + _emoR.x * a + _emoU.x * b;
        emoPos[o + c * 3 + 1] = cy + _emoR.y * a + _emoU.y * b;
        emoPos[o + c * 3 + 2] = w.z + _emoR.z * a + _emoU.z * b;
        emoUv[t + c * 2] = c === 1 || c === 2 ? u1 : u0;
        emoUv[t + c * 2 + 1] = c < 2 ? 1 : 0;      // canvas 的上緣是 v=1（貼圖預設 flipY）
      }
      n++;
    }
    emoGeo.setDrawRange(0, n * 6);
    emoGeo.attributes.position.needsUpdate = true;
    emoGeo.attributes.uv.needsUpdate = true;
    emoMesh.visible = n > 0;
  }

  /* ── 天災的生物（v1.138）───────────────────────
     地標蓋完之後會有東西從場邊走進來砸場（什麼時候來、來了做什麼是規則那邊的事，
     見 game-tools.js 的 DOOMS）。這裡只管「長什麼樣、怎麼擺」。

     部位表的欄位跟小人的 BODY 幾乎一樣，差在兩處：
       · c 直接寫色碼。小人的 c 是色組名，因為每個人的膚色衣色不同；
         這幾隻沒有個體差異，多一層查表只是多一個要維護的地方。
       · 擺動改成「繞關節轉」：sw 是腰下那兩條、am 是手，pv 是那個關節的高度。
         小人的手腳各只有一塊，繞自己中心轉看不太出來；這幾隻的手腳是三塊接起來的
         （上臂／前臂／手），各轉各的中心會散開成三截，所以要指定關節。
     右手（am > 0）還會跟著 m.arm 抬起來 m.raise 那麼多：黑獸獵把火把送到牆邊、
     白猴子把香蕉舉過頭。這一段平常是 0，只有站定要動手那兩秒才有值。 */
  const JOINT_Z = 0.03;                    // 關節的 z（肩與髖都在身體中線附近）
  /* 左右對稱的部位只寫右半邊（x 為正），左半邊鏡射出來：
     x 取負、繞 Y／Z 的角度取負、手腳擺動的正負號也跟著翻。 */
  function bmir(list) {
    const out = [];
    for (const b of list) {
      out.push(b);
      const m = Object.assign({}, b, { p: [-b.p[0], b.p[1], b.p[2]] });
      if (b.r) m.r = [b.r[0], -b.r[1], -b.r[2]];
      if (b.sw) m.sw = -b.sw;
      if (b.am) m.am = -b.am;
      out.push(m);
    }
    return out;
  }
  /* 把一組部位掛到別的地方去（白猴子手上那根香蕉炋彈）。位置、大小、角度
     在載入時就先乘進去，畫的時候就不必多一層矩陣。掛上去的轉法只有 Y 與 Z、
     部位自己的轉法只有 Z，而預設的 XYZ 順序就是 R = Rx·Ry·Rz——
     所以兩個 Z 相加、x 那一格留給擺動，合起來剛好是「先掛上去、再跟著手擺」。 */
  function attach(list, o) {
    const cy = Math.cos(o.ry), sy = Math.sin(o.ry);
    const cz = Math.cos(o.rz || 0), sz = Math.sin(o.rz || 0);
    return list.map(b => {
      const x = b.p[0] * o.sc, y = b.p[1] * o.sc, z = b.p[2] * o.sc;
      const x1 = x * cz - y * sz, y1 = x * sz + y * cz;        // Rz
      const x2 = x1 * cy + z * sy, z2 = -x1 * sy + z * cy;     // Ry
      return { p: [o.x + x2, o.y + y1, o.z + z2],
               s: [b.s[0] * o.sc, b.s[1] * o.sc, b.s[2] * o.sc],
               c: b.c, r: [0, o.ry, (o.rz || 0) + (b.r ? b.r[2] : 0)],
               am: o.am, hold: o.hold, pv: o.pv, bomb: o.bomb };
    });
  }

  /* 香蕉形狀的炋彈。方塊排不出弧線，所以是六塊沿著半徑 NANA_ARC 的弧
     各自轉到那一點的切線方向：兩頭翘、中間低。純黃的香蕉在場上只是一根水果，
     所以綁兩圈紅膠帶、蒂頭上接一截冒火花的引信——一眼要看得出是炋彈。 */
  const NANA_ARC = 0.42;
  const NANA = (() => {
    const TH = [-0.90, -0.54, -0.18, 0.18, 0.54, 0.90];
    const W = [0.13, 0.16, 0.17, 0.17, 0.16, 0.13];
    const at = t => [Math.sin(t) * NANA_ARC, 0.34 - Math.cos(t) * NANA_ARC];
    const out = [];
    for (let i = 0; i < TH.length; i++) {
      const q = at(TH[i]);
      out.push({ p: [q[0], q[1], 0], s: [0.17, W[i], W[i]], c: 0xf0c53a, r: [0, 0, TH[i]] });
    }
    const a = at(-1.08), b = at(1.08), t1 = at(-0.18), t2 = at(0.18);
    out.push({ p: [a[0], a[1], 0], s: [0.11, 0.085, 0.085], c: 0x6b4a22, r: [0, 0, -1.08] });
    out.push({ p: [b[0], b[1], 0], s: [0.10, 0.09, 0.09], c: 0x3a2a18, r: [0, 0, 1.08] });
    out.push({ p: [t1[0], t1[1], 0], s: [0.05, 0.185, 0.185], c: 0xc8322a, r: [0, 0, -0.18] });
    out.push({ p: [t2[0], t2[1], 0], s: [0.05, 0.185, 0.185], c: 0xc8322a, r: [0, 0, 0.18] });
    out.push({ p: [-0.46, 0.30, 0], s: [0.038, 0.22, 0.038], c: 0x2c2620, r: [0, 0, -0.42] });
    out.push({ p: [-0.545, 0.43, 0], s: [0.10, 0.10, 0.10], c: 0xff8a24 });
    out.push({ p: [-0.585, 0.51, 0], s: [0.06, 0.06, 0.06], c: 0xffe98a });
    return out;
  })();

  /* 黑獸獵：頭頂 1.31——跟小人連安全帽一樣高（使用者：「小人大小」）。
     跟小人區隔靠的是剪影不是顏色：駝背前傾、手垂過膝、頭頂一撮冠毛、一條翘起來的尾巴。 */
  const APE_SH = 0.90, APE_HIP = 0.51;          // 肩／髀的高度
  const FUR = 0x24242a, FUR2 = 0x33333c, PAW = 0x17171b, FACE = 0xc0625c;
  const APE = [
    { p: [0, 0.66, 0.02], s: [0.44, 0.46, 0.36], c: FUR, r: [0.20, 0, 0] },      // 軀幹（前傾）
    { p: [0, 0.62, 0.21], s: [0.26, 0.32, 0.05], c: 0x3d3a42, r: [0.20, 0, 0] }, // 胸腹淡毛
    { p: [0, 0.90, 0], s: [0.40, 0.18, 0.30], c: FUR },                          // 肩背
    { p: [0, 1.06, 0.10], s: [0.34, 0.32, 0.32], c: FUR },                       // 頭
    { p: [0, 1.245, 0.08], s: [0.11, 0.13, 0.22], c: FUR2 },                     // 冠毛（頂到 1.31）
    { p: [0, 1.04, 0.265], s: [0.26, 0.24, 0.04], c: FACE },                     // 臉盤（紅的）
    { p: [0, 0.985, 0.315], s: [0.18, 0.13, 0.10], c: 0xd08a7e },                // 吻部
    { p: [0, 0.945, 0.365], s: [0.10, 0.03, 0.02], c: 0x8a4a44 },                // 嘴縫
    { p: [0, 1.15, 0.27], s: [0.28, 0.05, 0.07], c: FUR2 },                      // 眉脊
    { p: [0, 0.74, -0.24], s: [0.11, 0.11, 0.16], c: FUR },                      // 尾巴四節
    { p: [0, 0.86, -0.31], s: [0.09, 0.17, 0.10], c: FUR },
    { p: [0, 1.00, -0.32], s: [0.08, 0.15, 0.09], c: FUR },
    { p: [0, 1.10, -0.26], s: [0.07, 0.08, 0.13], c: FUR2 }
  ].concat(bmir([
    { p: [0.07, 1.09, 0.285], s: [0.06, 0.07, 0.03], c: 0x140f0d },                   // 眼
    { p: [0.185, 1.07, 0.08], s: [0.05, 0.11, 0.10], c: FACE },                       // 耳
    { p: [0.27, 0.72, 0.02], s: [0.13, 0.36, 0.16], c: FUR, am: 1, pv: APE_SH },      // 上臂
    { p: [0.29, 0.44, 0.06], s: [0.12, 0.30, 0.14], c: FUR2, am: 1, pv: APE_SH },     // 前臂
    { p: [0.29, 0.245, 0.08], s: [0.13, 0.11, 0.17], c: PAW, am: 1, pv: APE_SH },     // 手（垂過膝）
    { p: [0.15, 0.36, -0.02], s: [0.19, 0.30, 0.22], c: FUR, sw: 1, pv: APE_HIP },    // 大腿
    { p: [0.15, 0.15, 0.02], s: [0.16, 0.22, 0.19], c: FUR, sw: 1, pv: APE_HIP },     // 小腿
    { p: [0.15, 0.05, 0.08], s: [0.17, 0.10, 0.26], c: PAW, sw: 1, pv: APE_HIP }      // 腳
  ])).concat([
    /* 手上那支火把（「對地標點火」總要有個火源）。掛在右手上，
       所以跟那隻手一起擺、一起抬。 */
    { p: [0.29, 0.44, 0.14], s: [0.05, 0.52, 0.05], c: 0x6a4a30, r: [0.30, 0, 0], am: 1, pv: APE_SH },
    { p: [0.29, 0.63, 0.20], s: [0.09, 0.09, 0.09], c: 0x5a3a22, am: 1, pv: APE_SH },
    { p: [0.29, 0.75, 0.24], s: [0.13, 0.14, 0.13], c: 0xff7a1e, am: 1, pv: APE_SH },
    { p: [0.29, 0.85, 0.25], s: [0.08, 0.10, 0.08], c: 0xffd24a, am: 1, pv: APE_SH }
  ]);

  /* 白猴子：頭頂 1.45（黑獸獵 ×1.11，使用者：「比黑獸獵略大」）。
     **毛一樣是黑的**，白的是皮膚——臉、耳、手、腳（使用者指定）。
     所以兩隻的分野不在毛色，在「白臉配深眼 vs 紅臉」、「白手白腳 vs 黑手黑腳」，
     再加上頸圈長毛（黑獸獵沒有）、頭頂是平的沒冠毛、尾巴長一截。
     拿炋彈的那隻手不跟著走路擺（沒有 am）：手上有東西的人本來就不會甲手。 */
  const SNOW_SH = 1.00, SNOW_HIP = 0.55;
  const B1 = 0x22222a, B2 = 0x3c3c46, SK = 0xf2ece0, SK2 = 0xe3d8c6;
  const SNOW = [
    { p: [0, 0.74, 0.02], s: [0.50, 0.52, 0.40], c: B1, r: [0.16, 0, 0] },
    { p: [0, 0.70, 0.23], s: [0.30, 0.36, 0.05], c: B2, r: [0.16, 0, 0] },
    { p: [0, 1.00, 0], s: [0.46, 0.20, 0.34], c: B1 },
    { p: [0, 1.06, 0.05], s: [0.58, 0.16, 0.50], c: B2 },      // 頸圈長毛
    { p: [0, 1.24, 0.10], s: [0.36, 0.34, 0.34], c: B1 },      // 頭
    { p: [0, 1.42, 0.09], s: [0.32, 0.06, 0.30], c: B2 },      // 頭頂平毛（頂到 1.45）
    { p: [0, 1.22, 0.285], s: [0.28, 0.26, 0.04], c: SK },     // 白臉
    { p: [0, 1.15, 0.335], s: [0.19, 0.13, 0.10], c: SK2 },    // 吻部
    { p: [0, 1.11, 0.385], s: [0.11, 0.03, 0.02], c: 0x5a4c42 },
    { p: [0, 1.335, 0.29], s: [0.30, 0.05, 0.07], c: B2 },     // 眉脊（黑毛壓在白臉上緣）
    { p: [0, 0.82, -0.30], s: [0.12, 0.12, 0.18], c: B1 },     // 尾巴五節
    { p: [0, 0.96, -0.39], s: [0.10, 0.18, 0.11], c: B1 },
    { p: [0, 1.14, -0.41], s: [0.09, 0.19, 0.10], c: B1 },
    { p: [0, 1.30, -0.36], s: [0.08, 0.11, 0.14], c: B2 },
    { p: [0, 1.36, -0.24], s: [0.07, 0.09, 0.13], c: B2 },
    /* 左手（空的）跟著走路擺；右手拿炋彈，不擺，但要能抬——
       所以還是給 am，只是加上 hold（只抬不擺，見 putBeasts）。 */
    { p: [-0.31, 0.80, 0.02], s: [0.14, 0.40, 0.17], c: B1, am: -1, pv: SNOW_SH },
    { p: [-0.33, 0.47, 0.06], s: [0.13, 0.34, 0.15], c: B2, am: -1, pv: SNOW_SH },
    { p: [-0.33, 0.25, 0.08], s: [0.14, 0.11, 0.18], c: SK2, am: -1, pv: SNOW_SH },
    { p: [0.31, 0.80, 0.02], s: [0.14, 0.40, 0.17], c: B1, am: 1, hold: 1, pv: SNOW_SH },
    { p: [0.33, 0.47, 0.06], s: [0.13, 0.34, 0.15], c: B2, am: 1, hold: 1, pv: SNOW_SH },
    { p: [0.33, 0.25, 0.08], s: [0.14, 0.11, 0.18], c: SK2, am: 1, hold: 1, pv: SNOW_SH }
  ].concat(bmir([
    { p: [0.075, 1.27, 0.305], s: [0.06, 0.07, 0.03], c: 0x1a1620 },                  // 眼（白臉上要深眼）
    { p: [0.20, 1.25, 0.08], s: [0.05, 0.12, 0.11], c: SK },                          // 耳（皮膚）
    { p: [0.17, 0.39, -0.02], s: [0.21, 0.32, 0.24], c: B1, sw: 1, pv: SNOW_HIP },
    { p: [0.17, 0.16, 0.02], s: [0.18, 0.24, 0.20], c: B1, sw: 1, pv: SNOW_HIP },
    { p: [0.17, 0.05, 0.09], s: [0.19, 0.10, 0.28], c: SK2, sw: 1, pv: SNOW_HIP }     // 腳（皮膚）
  ])).concat(attach(NANA, { x: 0.40, y: 0.20, z: 0.13, sc: 0.62, ry: 1.15, rz: 0.2,
                            am: 1, hold: 1, pv: SNOW_SH, bomb: 1 }));


  /* ── 飛龍（v1.139）───────────────────────────────────────
     使用者給了一張參考圖：緋紅的身體、深色的棘刺與爪、大片翼膜、頭上一叢冠刺、
     背脊一排刺、尾巴末端一片扇。造型是先做成 3D 預覽給使用者看過才落地的。

     **翅膀是一條骨架鏈，不是一片繞翼根轉的硬板**（使用者第一版回饋：「飛的翅膀跟身體
     太過僵硬」）。每一幀先沿著翼展把方向角積分成一條弧線（wingArc），每一塊再照
     自己離翼根多遠掛上去——所以拍下去時翼面是彎的，翼尖還會甩在後面。
     中間試過「每一塊各自繞翼根轉不同角度」：角度一差開，相鄰兩段就在關節處裂開
     （翼尖那一段整個斷掉），所以才改成沿弧線走——每一段本來就接在前一段的末端。 */
  const WING_PX = 0.30, WING_PY = 0.46, WING_TIP = 4.85;   // 翼根 x／y、翼尖 x
  const FLAP_MID = 0.18, FLAP_A = 0.62, FLAP_LAG = 1.05;   // 中位角、擺幅、翼尖落後多少
  const TAIL_SW = 0.60, TAIL_K = 0.52, TAIL_W = 0.62;      // 尾巴：擺幅、波長、比翅膀慢幾成
  const NECK_SW = 0.22, NECK_W = 0.45;                     // 脖子：擺幅、快慢
  const ARC_N = 14, WING_L = WING_TIP - WING_PX;
  const arcX = new Float64Array(ARC_N + 1), arcY = new Float64Array(ARC_N + 1),
        arcA = new Float64Array(ARC_N + 1);
  const wingAng = (u, ph) => FLAP_MID + FLAP_A * Math.sin(ph - FLAP_LAG * u);
  /* 這一幀的翼弧。積分出來的是「右半邊」，左半邊照 wg 的正負號鏡射。 */
  function wingArc(ph) {
    const ds = WING_L / ARC_N;
    let x = WING_PX, y = WING_PY;
    arcX[0] = x; arcY[0] = y; arcA[0] = wingAng(0, ph);
    for (let i = 1; i <= ARC_N; i++) {
      const a = wingAng((i - 0.5) / ARC_N, ph);
      x += Math.cos(a) * ds; y += Math.sin(a) * ds;
      arcX[i] = x; arcY[i] = y; arcA[i] = wingAng(i / ARC_N, ph);
    }
  }
  /* 翼上那幾塊：掛 wg（左右）與 u（離翼根多遠，0 肩 1 翼尖，拍翅的相位落後照它算）。 */
  function wing(list) {
    return list.map(b => Object.assign({}, b, { wg: 1,
      u: Math.min(1, Math.max(0, (Math.abs(b.p[0]) - WING_PX) / WING_L)) }));
  }
  const D_RED = 0xb8443c, D_RED2 = 0x8e2c2a, D_BELLY = 0xcf7a52,
        D_SPIKE = 0x3c2b28, D_DK = 0x2a201e, D_MEMB = 0xd4685a,
        D_EYE = 0xf2c14a, D_CLAW = 0x241c1a;
  /* 翼膜：五條各有各的前後緣（zf/zr）的薄片接起來，所以前緣是掃過去的、後緣自然是
     鋸齒的。**五條共平面**（y 全是 0.40）：上反角完全交給拍翅角度，
     自己先帶角度的話一拍就散成五層樓梯。 */
  const D_WING = [[0.95, 1.05, 0.78, -1.60], [1.95, 1.05, 0.88, -2.00],
                  [2.95, 1.05, 0.78, -1.62], [3.80, 0.85, 0.58, -0.98],
                  [4.50, 0.70, 0.32, -0.36]].map(q =>
    ({ p: [q[0], 0.40, (q[2] + q[3]) / 2], s: [q[1], 0.10, q[2] - q[3]], c: D_MEMB }));
  const DRAGON = [
    { p: [0, 0, 0.65], s: [1.10, 0.95, 1.35], c: D_RED },            // 胸
    { p: [0, -0.03, -0.45], s: [0.92, 0.82, 1.25], c: D_RED },       // 腹
    { p: [0, -0.02, -1.25], s: [0.66, 0.60, 0.80], c: D_RED2 },      // 腰
    /* 腹甲給暖銅色不給米白：從下面看只吃得到草地的反光（天光的地面色是草綠），
       米白會被染成橄欖綠——而玩家看這條龍多半是從下往上看。 */
    { p: [0, -0.40, 0.55], s: [0.72, 0.18, 1.70], c: D_BELLY },
    { p: [0, 0.36, 1.35], s: [0.66, 0.66, 0.75], c: D_RED, nk: 1 },  // 頸 ×2
    { p: [0, 0.66, 1.92], s: [0.58, 0.60, 0.68], c: D_RED, nk: 1 },
    { p: [0, 0.86, 2.48], s: [0.76, 0.62, 0.92], c: D_RED, nk: 1 },  // 頭
    { p: [0, 0.76, 3.10], s: [0.50, 0.38, 0.52], c: D_RED2, nk: 1 }, // 吻
    { p: [0, 0.58, 3.00], s: [0.42, 0.18, 0.60], c: D_DK, nk: 1 },   // 下顎
    { p: [0, 0.82, 3.36], s: [0.20, 0.14, 0.18], c: D_DK, nk: 1 },   // 鼻尖
    { p: [0, 1.34, 2.20], s: [0.17, 0.72, 0.20], c: D_SPIKE, r: [-0.50, 0, 0], nk: 1 },  // 冠刺（中）
    { p: [0, 1.12, 2.66], s: [0.52, 0.14, 0.34], c: D_DK, nk: 1 },   // 眉脊
    { p: [0, 0.76, 0.95], s: [0.19, 0.62, 0.24], c: D_SPIKE, r: [-0.30, 0, 0] },   // 背脊五刺
    { p: [0, 0.74, 0.35], s: [0.19, 0.70, 0.24], c: D_SPIKE, r: [-0.26, 0, 0] },
    { p: [0, 0.66, -0.25], s: [0.17, 0.62, 0.22], c: D_SPIKE, r: [-0.22, 0, 0] },
    { p: [0, 0.54, -0.80], s: [0.15, 0.48, 0.20], c: D_SPIKE, r: [-0.20, 0, 0] },
    { p: [0, 0.44, -1.30], s: [0.13, 0.38, 0.18], c: D_SPIKE, r: [-0.18, 0, 0] },
    { p: [0, -0.02, -1.85], s: [0.58, 0.56, 0.75], c: D_RED, tl: 1 },    // 尾四節
    { p: [0, 0.02, -2.55], s: [0.48, 0.46, 0.72], c: D_RED, tl: 1 },
    { p: [0, 0.08, -3.22], s: [0.38, 0.36, 0.68], c: D_RED2, tl: 1 },
    { p: [0, 0.16, -3.82], s: [0.30, 0.28, 0.56], c: D_RED2, tl: 1 },
    { p: [0, 0.24, -4.34], s: [0.78, 0.12, 0.72], c: D_SPIKE, tl: 1 },   // 尾扇
    { p: [0, 0.26, -4.86], s: [0.46, 0.10, 0.50], c: D_SPIKE, tl: 1 },
    { p: [0, 0.44, -4.10], s: [0.18, 0.38, 0.34], c: D_SPIKE, tl: 1 }
  ].concat(bmir([
    { p: [0.40, 0.98, 2.74], s: [0.11, 0.14, 0.13], c: D_EYE, nk: 1 },                       // 眼
    { p: [0.38, 0.90, 2.44], s: [0.14, 0.14, 0.46], c: D_DK, r: [0, -0.35, 0], nk: 1 },      // 頰角
    { p: [0.28, 1.26, 2.16], s: [0.14, 0.58, 0.17], c: D_SPIKE, r: [-0.50, 0, 0.26], nk: 1 },
    { p: [0.50, 1.12, 2.06], s: [0.12, 0.44, 0.15], c: D_SPIKE, r: [-0.50, 0, 0.46], nk: 1 }
  ])).concat(bmir(wing(D_WING))).concat(bmir(wing([
    { p: [0.80, 0.42, 0.74], s: [1.10, 0.30, 0.38], c: D_RED2 },                  // 上臂
    { p: [1.95, 0.46, 0.84], s: [1.30, 0.26, 0.32], c: D_RED2 },                  // 前臂
    { p: [3.30, 0.48, 0.60], s: [1.60, 0.18, 0.24], c: D_DK },                    // 翼指
    { p: [4.55, 0.48, 0.34], s: [0.30, 0.20, 0.38], c: D_CLAW },                  // 翼爪
    { p: [2.20, 0.47, -0.55], s: [2.20, 0.09, 0.13], c: D_DK, r: [0, 0.42, 0] },  // 膜上的指骨
    { p: [1.90, 0.47, -1.25], s: [1.80, 0.08, 0.12], c: D_DK, r: [0, 0.72, 0] }
  ]))).concat(bmir([
    { p: [0.46, -0.42, -0.55], s: [0.36, 0.52, 0.46], c: D_RED, r: [0.50, 0, 0] },   // 後腿
    { p: [0.50, -0.78, -0.14], s: [0.28, 0.44, 0.32], c: D_RED2, r: [-0.55, 0, 0] },
    { p: [0.52, -0.98, 0.22], s: [0.30, 0.20, 0.44], c: D_CLAW }
  ]));
  /* 火球：亮芯 ＋ 外焰 ＋ 兩節尾焰。大小比照隕石（使用者指定）。 */
  const FBALL = [
    { p: [0, 0, 0], s: [0.62, 0.62, 0.62], c: 0xff7a1e },
    { p: [0.26, 0.16, -0.10], s: [0.34, 0.34, 0.34], c: 0xff9a2e },
    { p: [-0.22, -0.14, -0.16], s: [0.36, 0.36, 0.36], c: 0xff5a12 },
    { p: [0.05, 0.28, -0.20], s: [0.30, 0.30, 0.30], c: 0xffb340 },
    { p: [0, 0, 0.06], s: [0.36, 0.36, 0.36], c: 0xffe08a },
    { p: [0, -0.04, -0.55], s: [0.30, 0.30, 0.34], c: 0xff6a12 },
    { p: [0, -0.08, -0.88], s: [0.18, 0.18, 0.26], c: 0xd8451a }
  ];

  const BEASTS = { ape: APE, snow: SNOW, nana: NANA, dragon: DRAGON, fball: FBALL };
  const MAXBEAST = 8;
  const BEAST_PARTS = Math.max(APE.length, SNOW.length, NANA.length, DRAGON.length);
  const BEAST_RAISE = 2.6;                 // 右手抬到底是幾度（規則那邊給 0～1 的 m.arm）

  /* m：{kind 哪一種（BEASTS 的 key）, x, y, z, a 朝向, ph 步伐相位,
        gait 走得多快（0＝站著）, sc 放多大, arm 右手抬多高（0～1）,
        raise 抬到底是幾度（省略就用 BEAST_RAISE）, spin 翻滾角（飛在半空的香蕉才有）} */
  function putBeasts(list) {
    const n = Math.min(list.length, MAXBEAST);
    beastMesh.count = n * BEAST_PARTS;
    for (let i = 0; i < n; i++) {
      const m = list[i], parts = BEASTS[m.kind];
      scratch.position.set(m.x, m.y || 0, m.z);
      /* 順序跟小人一樣用 YZX：R = Ry(朝向)·Rz(側傾)·Rx(俯仰／翻滾)。
         香蕉飛出去時是繞自己橫軸翻，所以翻滾放 x；飛龍的俯仰也放 x、
         轉彎往內側傾斜放 z（那兩個值是規則那邊算的，見 game-tools.js 的 stepDragon）。 */
      scratch.rotation.set(m.spin || 0, m.a || 0, m.roll || 0, 'YZX');
      scratch.scale.setScalar(m.sc || 1);
      scratch.updateMatrix();
      if (m.kind === 'dragon') wingArc(m.ph || 0);      // 這一幀的翼弧，整條龍共用
      for (let k = 0; k < BEAST_PARTS; k++) {
        const b = parts[k];
        /* 這一種沒那麼多塊，或者手上那根香蕉已經丟出去了（m.bomb 收掉）：
           縮成一點，畫不出東西 */
        if (!b || (b.bomb && !m.bomb)) {
          scratchB.scale.setScalar(0);
          scratchB.updateMatrix();
          tmpM.multiplyMatrices(scratch.matrix, scratchB.matrix);
          beastMesh.setMatrixAt(i * BEAST_PARTS + k, tmpM);
          continue;
        }
        scratchB.position.set(b.p[0], b.p[1], b.p[2]);
        scratchB.rotation.set(b.r ? b.r[0] : 0, b.r ? b.r[1] : 0, b.r ? b.r[2] : 0);
        scratchB.scale.set(b.s[0], b.s[1], b.s[2]);
        /* 腰下那兩條前後擺、手反相擺（跟小人同一個式子），右手再加上抬起來那一段。
           轉完要把位置也繞著關節轉過去，不然三塊手臂各自繞自己中心轉會散開。 */
        /* 飛龍那三種擺動（見上面 wingArc）。翼上那幾塊掛在弧線上、尾巴與脖子
           各走一道自己的行進波——尾巴越往末端擺幅越大（S 形，不是整條硬甩）。 */
        if (b.wg) {
          const t = b.u * ARC_N, kk = Math.min(ARC_N - 1, Math.floor(t)), f = t - kk;
          const ax = arcX[kk] + (arcX[kk + 1] - arcX[kk]) * f;
          const ay = arcY[kk] + (arcY[kk + 1] - arcY[kk]) * f;
          const aa = arcA[kk] + (arcA[kk + 1] - arcA[kk]) * f;
          const off = b.p[1] - WING_PY;               // 這一塊原本離翼面多高，沿法線掛回去
          scratchB.position.x = (ax - Math.sin(aa) * off) * b.wg;
          scratchB.position.y = ay + Math.cos(aa) * off;
          scratchB.rotation.z = ((b.r ? b.r[2] : 0) + aa) * b.wg;
          scratchB.updateMatrix();
          tmpM.multiplyMatrices(scratch.matrix, scratchB.matrix);
          beastMesh.setMatrixAt(i * BEAST_PARTS + k, tmpM);
          beastMesh.setColorAt(i * BEAST_PARTS + k, tmpC.setHex(b.c));
          continue;
        }
        if (b.tl || b.nk) {
          const z = b.p[2];
          const amp = b.tl ? TAIL_SW * Math.max(0, (-z - 1.2) / 3.6)
                           : NECK_SW * Math.max(0, (z - 1.0) / 2.4);
          const th = b.tl ? (m.ph || 0) * TAIL_W + TAIL_K * z : (m.ph || 0) * NECK_W + 1.2;
          scratchB.position.x = b.p[0] + amp * Math.sin(th);
          scratchB.rotation.y = (b.r ? b.r[1] : 0) -
                                amp * (b.tl ? TAIL_K * 1.6 : 0.9) * Math.cos(th);
        }
        let ang = 0;
        if (b.sw) ang = Math.sin(m.ph || 0) * b.sw * (m.gait || 0);
        else if (b.am) {
          if (!b.hold) ang = -Math.sin(m.ph || 0) * b.am * (m.gait || 0) * 0.8;
          if (b.am > 0 && m.arm) ang -= (m.raise === undefined ? BEAST_RAISE : m.raise) * m.arm;
        }
        if (ang) {
          const dy = b.p[1] - b.pv, dz = b.p[2] - JOINT_Z;
          const c = Math.cos(ang), s2 = Math.sin(ang);
          scratchB.position.y = b.pv + dy * c - dz * s2;
          scratchB.position.z = JOINT_Z + dy * s2 + dz * c;
          scratchB.rotation.x = (b.r ? b.r[0] : 0) + ang;
        }
        scratchB.updateMatrix();
        tmpM.multiplyMatrices(scratch.matrix, scratchB.matrix);
        beastMesh.setMatrixAt(i * BEAST_PARTS + k, tmpM);
        beastMesh.setColorAt(i * BEAST_PARTS + k, tmpC.setHex(b.c));
      }
    }
    beastMesh.instanceMatrix.needsUpdate = true;
    if (beastMesh.instanceColor) beastMesh.instanceColor.needsUpdate = true;
    dropSphere(beastMesh);
  }

  /* ── 樹 ───────────────────────────────────────────── */
  const LEAF = [0x4e8a3c, 0x5fa04a, 0x3f7a34, 0x6cae52];
  function putTrees(trees) {
    trunkMesh.count = trees.length;
    leafMesh.count = trees.length * 3;
    for (let i = 0; i < trees.length; i++) {
      const t = trees[i];
      const lean = t.wob * 0.14;
      scratch.position.set(t.x, t.h * 0.5, t.z);
      scratch.rotation.set(lean, 0, lean * 0.6);
      scratch.scale.set(0.5, t.h, 0.5);
      scratch.updateMatrix();
      trunkMesh.setMatrixAt(i, scratch.matrix);
      for (let k = 0; k < 3; k++) {
        const y = t.h + k * t.r * 0.62;
        const rr = t.r * (1 - k * 0.28);
        scratch.position.set(t.x + lean * y * 1.4, y, t.z + lean * 0.6 * y * 1.4);
        scratch.rotation.set(lean, t.rot, lean * 0.6);
        scratch.scale.set(rr, t.r * 0.72, rr);
        scratch.updateMatrix();
        leafMesh.setMatrixAt(i * 3 + k, scratch.matrix);
        tmpC.setHex(LEAF[(i + k) % LEAF.length]);
        leafMesh.setColorAt(i * 3 + k, tmpC);
      }
    }
    trunkMesh.instanceMatrix.needsUpdate = true;
    leafMesh.instanceMatrix.needsUpdate = true;
    if (leafMesh.instanceColor) leafMesh.instanceColor.needsUpdate = true;
  }

  /* ── 塵霧 ─────────────────────────────────────────── */
  function putDust(parts) {
    const n = Math.min(parts.length, MAXDUST);
    dustMesh.count = n;
    for (let i = 0; i < n; i++) {
      const p = parts[i];
      scratch.position.set(p.x, p.y, p.z);
      scratch.rotation.set(p.rx, p.ry, 0);
      /* sy 給了就是非等比：彩帶那種薄紙片（v1.96，見 game-workers.js 的 spawnConfetti）。
         紙片借塵霧這個池子畫，不另開一個 InstancedMesh——多一個池子就多一個
         draw call，而彩帶只在完工那七秒出現。 */
      if (p.sy === undefined) scratch.scale.setScalar(p.s);
      else scratch.scale.set(p.s, p.sy, p.sz);
      scratch.updateMatrix();
      dustMesh.setMatrixAt(i, scratch.matrix);
      // 預設是灰白煙塵；火球那種要自己指定顏色的才給 cr/cg/cb
      if (p.cr === undefined) tmpC.setRGB(p.c, p.c, p.c * 0.96);
      else tmpC.setRGB(p.cr, p.cg, p.cb);
      dustMesh.setColorAt(i, tmpC);
    }
    dustMesh.instanceMatrix.needsUpdate = true;
    if (dustMesh.instanceColor) dustMesh.instanceColor.needsUpdate = true;
  }

  /* ── 相機 ─────────────────────────────────────────── */
  /* radius/height 是建築本身，arena 是碎料散落範圍（決定草地與陰影要多大） */
  /* keepView：只更新草地／陰影／霧，不動鏡頭。換建築時用這個——
     玩家自己轉好、拉近、平移過的視角不該被搶走。 */
  function fitCamera(radius, height, arena, instant, keepView) {
    lastFit = { radius, height, arena };
    /* 把建築當成一顆球來取景：距離 = 球半徑 / sin(半視角)。
       上下用球半徑（高度通常是大的那邊），左右另外用真正的水平半徑再算一次，取遠的那個。
       兩邊都用球半徑的話，又高又細的建築（艾菲爾鐵塔）會被自己的高度推到天邊；
       左右完全不算的話，直式手機（畫面高瘦）裝不下，36 座有 24 座被切掉、金門大橋溢出六成。 */
    if (!keepView) {
      /* 桌機（v1.55）：視線放在**建築底部中心**（工地原點），那一點就是畫面正中央。
         看的範圍因此變成「原點往上整個 height」，不再是以腰間為中心的上下各一半——
         上下的取景半徑要用整個高度，不然視線降下來之後上緣會被切掉。
         代價是建築整個被推到畫面上半部，看起來比以前小一截：底部要落在正中央，
         建築就只剩上半部可以站，這是換來的，不是取景壞了。
         手機（直式、畫面高瘦）維持原本的**看腰間**：那種畫面再把建築推到上半部
         會小到看不清楚。斷點跟 index.html 那條 @media (max-width:640px) 同一個數字。 */
      const atBase = window.innerWidth > MOBILE_W;
      const R = Math.max(radius * 1.05, height * (atBase ? 1 : 0.62)) + 2;
      const halfV = camera.fov * Math.PI / 360;
      const halfH = Math.atan(Math.tan(halfV) * camera.aspect);
      camTarget.dist = Math.max(R / Math.sin(halfV),
                                (radius * 1.05 + 2) / Math.sin(halfH)) * FIT_MARGIN;
      camTarget.ty = atBase ? 0 : height * 0.44 + 1.5;
      camTarget.tx = camTarget.tz = 0;        // 取景時把鏡頭帶回工地中心
      /* 重新取景就把「等一下要還的高度」作廢（見 holdWide 的 temp）。
         換場不收道具（v1.59），所以煙火可能跨場繼續放——那時候記著的是**上一座**
         的視線高，還回去等於拿舊建築的取景蓋掉新的。重新取景本來就蓋過一切。 */
      tyHold = 0; tyBack = 0; tyTop = 0;
      if (instant) { cam.dist = camTarget.dist; cam.ty = camTarget.ty; cam.tx = cam.tz = 0; }
    }
    // 陰影相機要蓋住整片工地，不然大建築跟遠處碎料的影子會被裁掉
    const s = Math.max(45, arena + height * 0.5);
    const sc = sun.shadow.camera;
    sc.left = -s; sc.right = s; sc.top = s; sc.bottom = -s;
    sc.updateProjectionMatrix();
    /* 島還要大到蓋住畫面下緣（v1.55）。視線落到地面之後，下緣那兩個角會打在很外面——
       量過：艾菲爾鐵塔打到島半徑的 2.07 倍、台北 101 是 1.21 倍，畫面左下角就直接看到
       島的邊與底下那層土。島變大不多花 draw call（就那三個盒子），遠處交給霧。 */
    setGroundSize(Math.max(arena + 26, groundReach()));
    setFog();
  }

  /* 畫面下緣（左下角、正下方、右下角）三條射線打到地面的落點，離工地中心最遠那個。
     相機朝原點看，所以只有俯角、視角與視距在決定它，跟 yaw 無關；島是正方形，
     用「半徑」當半邊長是刻意保守——轉視角時最短的是邊心不是角。 */
  function groundReach() {
    const tanV = Math.tan(camera.fov * Math.PI / 360);
    const tanH = tanV * camera.aspect;
    const sp = Math.sin(cam.pitch), cp = Math.cos(cam.pitch);
    const down = sp + cp * tanV;                       // 下緣射線往前一單位就往下這麼多
    if (down < 0.01) return 0;                         // 幾乎平視：下緣打不到地面
    const t = (camTarget.ty + sp * camTarget.dist) / down;
    const fwd = cp * camTarget.dist - t * (cp - sp * tanV);
    return Math.hypot(fwd, t * tanH);
  }

  /* 霧是給遠方地平線的，不該把建築本身吃掉，所以起霧處要跟著目前的取景距離走。
     只綁 arena 的話，相機退得遠時建築會泡在霧裡——直式手機看金門大橋要退到 460，
     而霧只到 316，整座橋會白掉。爆炸運鏡拉開視距時也是同一個問題，所以獨立成一支。 */
  function setFog() {
    const arena = lastFit ? lastFit.arena : 40;
    const fogAt = Math.max(arena + 20, camTarget.dist);
    scene.fog.near = fogAt;
    scene.fog.far = Math.max(arena * 2.6 + 90, fogAt * 3);
  }

  /* 爆炸運鏡：把鏡頭退到「這個效果整個進得了畫面」的距離，順便把視線抬到它的腰間。
     top＝效果會長到多高、radius＝它有多寬，都以爆點為原點量。
     要看的是 0～top 這一段，所以視線抬到 top 的一半，距離就照 fitCamera 那一套算：
     垂直要塞得下半個高度、水平要塞得下寬度，取遠的那個（只算高度的話，
     直式手機那種高瘦畫面會把魔法陣切掉兩側）。
     以前是各家自己抓一個倍率當距離（煙火 FW_TOP×2.6＝109），跟畫面實際裝得下多少無關，
     矮建築被拉到兩倍遠都還在退；而視線抬起來之後，同樣看得完整反而不用退那麼遠。
     只退不收：退開之後就停在那個視距，要拉回來是玩家自己滾輪的事。
     以前是幾秒後用最後一次取景的參數自己收回去，但那等於每放一發就把鏡頭搶走兩次
     （退開一次、收回一次），連放兩發還會在遠近之間來回跳。
     只退不收也不會越退越遠：距離取的是「現在」與「這一發要的」之中的大者。

     **temp＝true 的那些用完會把視線高度還回去**（v1.123，使用者：「如果是會讓鏡頭
     往高的方向調整的運鏡 結束後高度要調回來（煙火一起調整）」）。只退不收對核彈
     那種「炸完就換場」的很合理，但煙火放完只有幾秒，收工之後鏡頭卻一直仰著看天空
     ——量過：羅馬競技場的取景視線高 0，放一發煙火之後變成 29，然後就停在那裡，
     自己的建築被推到畫面下緣。
     **只還高度不還視距**：退遠了本來就看得到全景，而且視距是玩家滾輪在管的
     （見上面「只退不收」的理由）；會把建築推出畫面的是仰角不是距離。
     用計數不用旗標：一次點下去就是三發煙火、連放兩次會有好幾個效果同時抬著，
     每個結束都收的話第一發打完就把鏡頭壓回去了。
     中途要是有「不還」的效果也抬高了（核彈的蘑菇雲），把落點一起抬上去，
     免得煙火放完連核彈要的高度都一起壓掉。
     最後，玩家自己按 Z／X 把視線抬得比我們更高的話就不要動它——那是他的視角。 */
  let tyHold = 0, tyBack = 0, tyTop = 0;
  function holdWide(top, radius, temp) {
    const halfV = camera.fov * Math.PI / 360;
    const halfH = Math.atan(Math.tan(halfV) * camera.aspect);
    const need = Math.max(top * 0.5 / Math.sin(halfV), radius / Math.sin(halfH)) * HOLD_MARGIN;
    camTarget.dist = Math.max(camTarget.dist, need);
    if (temp) { if (!tyHold) { tyBack = camTarget.ty; tyTop = 0; } tyHold++; }
    else if (tyHold) tyBack = Math.max(tyBack, top * 0.5);
    camTarget.ty = Math.max(camTarget.ty, top * 0.5);
    if (tyHold) tyTop = Math.max(tyTop, camTarget.ty);
    setFog();
  }
  /* 一個 temp 的效果結束了。最後一個結束時才真的把高度還回去。 */
  function releaseWide() {
    if (tyHold <= 0 || --tyHold > 0) return;
    if (camTarget.ty <= tyTop + 0.01) camTarget.ty = Math.min(camTarget.ty, tyBack);
    tyTop = 0;
  }

  function updateCamera(dt) {
    cam.dist += (camTarget.dist - cam.dist) * Math.min(1, dt * 2.2);
    cam.ty += (camTarget.ty - cam.ty) * Math.min(1, dt * 2.2);
    /* 平移跟得比縮放緊。用 2.2 的話等速平移時鏡頭會落後目標約 16 單位——
       那跟整座建築的半徑同一個量級，按下去會有一段明顯的空檔。8 大約落後 4.5 單位。 */
    cam.tx += (camTarget.tx - cam.tx) * Math.min(1, dt * 8);
    cam.tz += (camTarget.tz - cam.tz) * Math.min(1, dt * 8);
    if (camGo) {                             // 復位中：角度也滑回去（見 resetCamera）
      /* yaw 是一路累加下去的（轉三圈就是 +6π），差值要先折回 ±π 才會走近的那一邊 */
      let d = (camGo.yaw - cam.yaw + Math.PI) % (Math.PI * 2);
      if (d < 0) d += Math.PI * 2;
      d -= Math.PI;
      const dp = camGo.pitch - cam.pitch;
      if (Math.abs(d) < 0.004 && Math.abs(dp) < 0.004) {
        cam.yaw = camGo.yaw; cam.pitch = camGo.pitch; camGo = null;
      } else {
        const k = Math.min(1, dt * 5);
        cam.yaw += d * k; cam.pitch += dp * k;
      }
    }
    cam.pitch = Math.max(0.06, Math.min(1.45, cam.pitch));
    const cp = Math.cos(cam.pitch);
    let x = cam.tx + Math.cos(cam.yaw) * cp * cam.dist;
    let y = cam.ty + Math.sin(cam.pitch) * cam.dist;
    let z = cam.tz + Math.sin(cam.yaw) * cp * cam.dist;
    if (cam.shake > 0.001) {                 // 打擊時的畫面震動（太近就不震，見 SHAKE_NEAR）
      cam.shakeT += dt * 47;
      const k = cam.shake * Math.max(0, Math.min(1, (cam.dist - SHAKE_NEAR) / (SHAKE_FULL - SHAKE_NEAR)));
      x += Math.sin(cam.shakeT) * k; y += Math.cos(cam.shakeT * 1.37) * k; z += Math.sin(cam.shakeT * 0.83) * k;
      cam.shake *= Math.pow(0.02, dt);
    }
    camera.position.set(x, Math.max(1.2, y), z);
    camera.lookAt(cam.tx, cam.ty, cam.tz);
    sun.position.set(cam.tx + 46, 74, cam.tz + 32);
    sun.target.position.set(cam.tx, 0, cam.tz);
    sun.target.updateMatrixWorld();
  }

  // 玩家自己轉視角＝接手，復位的角度過渡當場取消（不然會跟他搶）
  function orbit(dx, dy) { camGo = null; cam.yaw -= dx * 0.006; cam.pitch += dy * 0.005; }

  /* 平移旋轉中心。fwd/side 是 −1..1，方向以**畫面**為準而不是世界軸——
     相機在旋轉中心的 (cos yaw, sin yaw) 方向上，所以畫面的「往前」是它的反向。
     照世界軸走的話，轉過視角之後按 W 會往螢幕的斜後方跑。 */
  function pan(fwd, side, dt) {
    const fx = -Math.cos(cam.yaw), fz = -Math.sin(cam.yaw);   // 畫面往前
    const k = PAN_SPD * cam.dist * dt;
    let x = camTarget.tx + (fx * fwd - fz * side) * k;        // 往右 = 往前轉 90°
    let z = camTarget.tz + (fz * fwd + fx * side) * k;
    /* 草地是有限的圓島，中心固定在原點（setGroundSize 只設 scale，位置永遠是 0），
       不夾住就會平移出去看到虛空。夾在碎料散落範圍內，剛好能看到料場。 */
    const lim = lastFit ? lastFit.arena : 40;
    const d = Math.hypot(x, z);
    if (d > lim) { x = x / d * lim; z = z / d * lim; }
    camTarget.tx = x; camTarget.tz = z;
  }
  /* 上下升降視線（Z／X）。跟 pan 同一套：吃真實時間、速度跟視距成正比，
     動的是**旋轉中心**——相機高度 = 視線高 + sin(pitch) × 視距，中心升上去相機也跟著升，
     像搭電梯，不是抬頭。上下界跟著這一座建築走：上界是頂端再高一點（要能俯視屋頂），
     下界只給高度的四分之一——視線落到地面以下之後看到的就只剩草地與天空，
     不必跟上面一樣多。下界一定要是負的：桌機取景是「看建築底部」（ty = 0），
     夾在 0 的話按 Z 會整個沒反應。 */
  function liftRange() {
    const h = lastFit ? lastFit.height : 40;
    return [-(h * 0.25 + 4), h + 4];
  }
  function lift(dir, dt) {
    const [lo, hi] = liftRange();
    const y = camTarget.ty + dir * LIFT_SPD * cam.dist * dt;
    /* 只夾住「往界外走」的那半邊：爆炸運鏡（holdWide）本來就會把視線抬到上界之上，
       那時候按 X 不動、按 Z 照樣降得下來，不會被硬拉回界內閃一下。 */
    camTarget.ty = dir > 0 ? Math.min(y, Math.max(hi, camTarget.ty))
                           : Math.max(y, Math.min(lo, camTarget.ty));
  }

  /* 回到開場的鏡頭（C）。距離／視線高／中心交給 fitCamera 重算——跟開場走同一支，
     所以換過建築就是回到「現在這一座」的取景，而不是回到上一座的舊數字。
     角度另外處理：yaw／pitch 沒有 camTarget 可以慢慢追（拖曳要即時，多一層延遲就黏手），
     所以開一個只在復位時用的過渡 camGo，每幀往開場角度靠，玩家一轉視角就取消。 */
  function resetCamera() {
    if (lastFit) fitCamera(lastFit.radius, lastFit.height, lastFit.arena, false, false);
    camGo = { yaw: CAM0.yaw, pitch: CAM0.pitch };
  }

  function zoom(f) { camTarget.dist = Math.max(6, Math.min(360, camTarget.dist * f)); }
  function shake(a) { cam.shake = Math.min(2.6, cam.shake + a); }

  /* ── 點選 ─────────────────────────────────────────── */
  /* 回傳 {kind:'block'|'worker'|'ground', idx, point}；point 一定有值 */
  /* 點到什麼的優先序不是「誰比較近」（v1.58），而且**看手上拿的是哪一把**（v1.60）：

       mode 'man'（手指）  小人 > 建築 > 地板   手指只戳人，別的都不做，人當然排第一
       mode 'skip'（多數） 建築 > 地板          小人整個當透明，射線直接穿過去
       預設（火把）        建築 > 小人 > 地板    對著人點是要點著他，對著建築點是放火

     照距離排的話，拿槌子對著建築點下去、剛好有小人走在前面，那一下就變成戳人——
     破壞道具都是對著建築用的，被路過的小人擋掉最惱人。地板排最後同理：
     從側面點建築的下緣時，射線常常先擦過建築前面那片草地。
     反過來，v1.58 把小人排在建築後面之後，「站在建築正前方的小人戳不到」——
     手指改成小人優先就解決了：那把工具本來就只有戳人一種用途。 */
  const PICK_RANK = { block: 0, worker: 1, ground: 2 };
  const PICK_MAN = { worker: 0, block: 1, ground: 2 };
  const PICK_SKIP = { block: 0, ground: 1 };
  function pick(px, py, mode) {
    const rankOf = mode === 'man' ? PICK_MAN : mode === 'skip' ? PICK_SKIP : PICK_RANK;
    ndc.set(px / W * 2 - 1, -(py / H * 2 - 1));
    raycaster.setFromCamera(ndc, camera);
    // intersectObjects 是照距離排好的，所以同一種裡先遇到的就是最近的那個
    const hits = raycaster.intersectObjects([blockMesh, workerMesh, ground], false);
    let best = null, rank = 9;
    for (const h of hits) {
      const kind = h.object === blockMesh ? 'block'
                 : h.object === workerMesh ? 'worker'
                 : h.object === ground ? 'ground' : null;
      if (kind === null || !(rankOf[kind] < rank)) continue;
      rank = rankOf[kind];
      best = {
        kind: kind,
        idx: kind === 'block' ? h.instanceId
           : kind === 'worker' ? Math.floor(h.instanceId / WPARTS) : -1,
        /* dist ＝ 射線飛了多遠才打到。規則那邊要拿它沿著射線往回走
           （水桶就靠這個把出水點退到牆的正確那一側，見 pourWater）。 */
        point: h.point, dir: raycaster.ray.direction.clone(), dist: h.distance
      };
      if (rank === 0) break;                    // 已經是這一把的最優先，不必再看了
    }
    return best;
  }

  function render() { renderer.render(scene, camera); }
  function info() { const r = renderer.info.render; return { calls: r.calls, tris: r.triangles }; }

  return {
    init, resize, render, info, pick,
    setBlockCount, putBlock, commitBlocks,
    setWorkerCount, putWorker, commitWorkers, putEmotes,
    putTrees, putDust, putTrebs, putRocks, putDozers, putTrucks, putPools,
    putBalls, putTornados, setHammer, hideHammer, hammerVisible, hammerPos,
    putBombs, putMeteors, putNukes, setRings, hideRings, putFire, putFlash,
    putStars, putBolts, putMarks, putGates, putWeapons, putBeasts,
    fitCamera, updateCamera, orbit, pan, lift, zoom, resetCamera, shake, holdWide, releaseWide,
    cam, camTarget, BS, MAXB, MAXW, WPARTS, DOZ_W, DOZ_FRONT, MAG_RIM_OUT, WAND_TIP, DIG_TIP,
    MARK_SEG, EMO_KINDS, EMO_Y, EMO_SIZE, MAXDUST, WEAP_KIND, WEAP_MAX, GATE_MAX,
    MAXBEAST, BEAST_PARTS, BEASTS,          /* 造型表也開出來：測試要驗尺寸與配色 */
    /* 內部物件的門：測試從這裡讀真的畫出去的東西（頂點、材質、尺寸），
       比讀規則那邊的狀態嚴格。ground 與 markMesh 是為了驗「痕跡有沒有畫到草皮外面」。 */
    get three() { return { renderer, scene, camera, blockMesh, workerMesh, beastMesh, ground, markMesh, poolMesh, emoMesh, dustMesh, gateMesh, weapMesh }; }
  };
})();
