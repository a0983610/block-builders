/* ============================================================
   繪製層：three.js 場景、光影、相機、InstancedMesh 積木池
   規則只有一條——這支檔案只管「怎麼畫」，不碰遊戲規則。
   遊戲邏輯在 game.js，它把每個積木／小人的位置塞進這裡的 buffer。

   效能關鍵：所有積木共用一個 BoxGeometry，走 InstancedMesh，
   不管畫 300 塊還是 3000 塊都只有 1 個 draw call。
   小人也一樣——每個小人 7 個部位，全部塞進同一個 InstancedMesh。
   ============================================================ */
'use strict';

const ENG = (function () {
  const T = THREE;

  let renderer, scene, camera, canvas;
  let sun, ground, dirtPad, grassRim, blockMesh, workerMesh, trunkMesh, leafMesh, dustMesh;
  let ballMesh, tornadoGroup, hammerGroup, rockMesh, trebMesh, dozMesh, trkMesh, poolMesh;
  let bombMesh, nukeMesh, ringGroup, magSpokeMesh, fireMesh, flashGroup, meteorMesh;
  let starMesh, boltMesh;
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
  const MAXDOZ = 6, DOZ_PARTS = 10;
  const MAXTRUCK = 2, TRK_PARTS = 11;       // 消防車：最多兩台，一台 11 個部位
  const MAXPOOL = 8000;                     // 積水：同時最多幾格（規則那邊的 POOL_MAX 跟它綁在一起）
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
  // 推土鏟的半寬與它離車體中心多遠。規則那邊直接取這兩個值，畫面與判定才不會各說各話
  const DOZ_W = 3.2, DOZ_FRONT = 3.6;
  const TW_SEG = 16;                // 龍捲風的分段數
  const TW_MAX = 4;                 // 最多同時畫幾道
  const tornadoSegs = [];
  const _axis = new T.Vector3();
  const _xAxis = new T.Vector3(1, 0, 0);    // 閃電：每一段都是從 +X 轉過去的
  const _zAxis = new T.Vector3(0, 0, 1);    // 星光：公告板繞自己的法線自轉
  const _spin = new T.Quaternion();
  let W = 1, H = 1;

  const scratch = new T.Object3D();       // 借來組矩陣用，不進場景
  const scratchB = new T.Object3D();
  const tmpM = new T.Matrix4();
  const tmpC = new T.Color();
  const raycaster = new T.Raycaster();
  const ndc = new T.Vector2();

  /* 軌道相機：自己寫，不引 OrbitControls（那支在 examples/jsm，
     還得多打包一份 ESM，而我們要的功能就這幾行） */
  const cam = { tx: 0, ty: 6, tz: 0, dist: 40, yaw: 0.9, pitch: 0.42, shake: 0, shakeT: 0 };
  const camTarget = { dist: 40, ty: 6, tx: 0, tz: 0 };
  /* 平移速度跟目前視距成正比——拉遠之後還用同一個速度會像在爬。
     視距 60 時約每秒 36 單位，橫越整片工地約兩秒。 */
  const PAN_SPD = 0.6;
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
  /* 積木池上限。要比面板最大那一檔（9000）再高一截：fitScale 挑的是「最接近目標」
     的那一階，可能落在目標之上——實測吉薩金字塔要 10000 時給出 10660（+7%）。
     池子不夠的話 reconcilePool 會夾住，那座就永遠少幾百塊、蓋不完。
     留到 11500 是照體檢量的 10000 抓的（含那 7% 超額），面板改檔位就不必跟著動。
     成本：instanceMatrix 是 16 個 float ×11500 ≈ 736KB，一次性配置，不影響每幀。 */
  const MAXB = 11500;
  const MAXW = 80;                         // 小人上限
  /* 每個小人的部位數，要跟 BODY 的長度一模一樣。7 個身體部位 ＋ 藍圖 ＋ 聊天泡泡兩塊
     ＋ v1.51 補的七塊細節（帽頂、帽舌、兩顆眼睛、兩隻鞋、腰帶）
     ＋ v1.64 魔法師的五塊（巫師帽三塊、法杖、寶珠）。
     道具沒拿的人整片縮到 0；全部共用同一個 InstancedMesh，不多一個 draw call。
     實測 60 個人擺一輪：10 塊時 0.106ms、17 塊時 0.150ms——每幀預算 4ms，加得起。 */
  const WPARTS = 22;
  /* 蘑菇雲一朵就吃掉三百多顆，420 會把爆炸的煙擠掉。
     核彈還會一次點著整棟的碎料（那些煙又是兩百多顆），兩邊要同時演得下才夠。 */
  const MAXDUST = 720;

  /* ── 材質：在 Lambert 上加一圈深色邊，voxel 才有實體感 ──
     邊緣判定不靠 uv（不同 three 版本 uv attribute 有沒有宣告不一定），
     改用 local position：單位方塊的座標是 ±0.5，
     「離面內邊緣的距離」＝ 0.5 −（三軸絕對值的第二大者）。 */
  function voxelMaterial(opt) {
    const m = new T.MeshLambertMaterial(opt);
    m.onBeforeCompile = sh => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vLocalPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocalPos = position;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vLocalPos;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          vec3 ap = abs(vLocalPos);
          float mx = max(ap.x, max(ap.y, ap.z));
          float mn = min(ap.x, min(ap.y, ap.z));
          float second = ap.x + ap.y + ap.z - mx - mn;
          float edge = smoothstep(0.0, 0.055, 0.5 - second);
          diffuseColor.rgb *= mix(0.62, 1.0, edge);
        `);
    };
    m.customProgramCacheKey = () => 'voxel-edge';
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
    ground = new T.Mesh(unitBox, new T.MeshLambertMaterial({ color: 0x5f8f3e }));
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

    /* 破壞道具：鐵球與龍捲風。兩個都只有一顆，不用 instancing */
    ballMesh = new T.Mesh(new T.SphereGeometry(1, 18, 14),
      new T.MeshLambertMaterial({ color: 0x3a3f47 }));
    ballMesh.castShadow = true; ballMesh.visible = false;
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

    /* 水窪（v1.69）。水桶倒下去的水積在凹處、流到地面攤成一攤，都是這一顆網格：
       一攤水就是一片壓扁的方塊，透明、不寫深度、**不投影**——所以它在場時只吃
       1 個 draw call（會投影的才要多跑一趟陰影，見消防車那段），沒水的時候
       visible=false 一個都不吃。
       用方塊不用圓盤：這座城市每一樣東西都是方的，圓形的水窪反而突兀。 */
    poolMesh = new T.InstancedMesh(unit, new T.MeshBasicMaterial({
      color: 0x4aa6de, transparent: true, opacity: 0.62, depthWrite: false
    }), MAXPOOL);
    poolMesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    poolMesh.count = 0; poolMesh.frustumCulled = false; poolMesh.visible = false;
    scene.add(poolMesh);

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

    /* 紋路走亮黃白（v1.62.1，原本 #ffc83c 偏金）：參考圖裡盤是桃紅的場，
       線條與邊上的筆觸是**接近白的黃**——黃得不夠就跟盤糊在一起。
       濃度 0.3 → 0.42：邊上那幾道筆觸是整座陣最亮的東西，0.3 在大白天的綠地上壓不住。
       中心那顆亮核也是這些臂的內端加法混色疊出來的，越黃越像燒白的核。 */
    magSpokeMesh = new T.InstancedMesh(unit, new T.MeshBasicMaterial({
      color: 0xffe9a0, transparent: true, opacity: 0.42,
      depthWrite: false, blending: T.AdditiveBlending
    }), MAG_SP_RINGS * MAG_SPOKE);
    magSpokeMesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    magSpokeMesh.count = 0; magSpokeMesh.frustumCulled = false;
    ringGroup.add(magSpokeMesh);
    ringGroup.visible = false;
    scene.add(ringGroup);

    resize();
  }

  /* ── 破壞道具 ───────────────────────────────────── */
  /* (ax,az) 是滾動軸（水平、垂直於前進方向），ang 是已滾過的角度 */
  function setBall(x, y, z, r, ax, az, ang) {
    ballMesh.visible = true;
    ballMesh.position.set(x, y, z);
    ballMesh.scale.setScalar(r);
    if (ax !== undefined) {
      _axis.set(ax, 0, az);
      if (_axis.lengthSq() > 1e-6) ballMesh.setRotationFromAxisAngle(_axis.normalize(), ang);
    }
  }
  function hideBall() { ballMesh.visible = false; }

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
  /* 一攤水：p = {x, y, z, r 半徑, h 厚度}。壓扁的方塊，貼在它積水的那一格上。
     厚度是規則那邊照水量算好的——水多就滿到那一格的頂，看得出水位在漲。 */
  function putPools(list) {
    const n = Math.min(list.length, MAXPOOL);
    poolMesh.visible = n > 0;
    poolMesh.count = n;
    for (let i = 0; i < n; i++) {
      const p = list[i];
      scratch.position.set(p.x, p.y, p.z);
      scratch.rotation.set(0, 0, 0);
      scratch.scale.set(p.r * 2, p.h, p.r * 2);
      scratch.updateMatrix();
      poolMesh.setMatrixAt(i, scratch.matrix);
    }
    poolMesh.instanceMatrix.needsUpdate = true;
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
    ground.scale.set(r * 2, 1.2, r * 2);
    ground.position.set(0, -0.6, 0);
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
  }

  /* ── 小人 ───────────────────────────────────────────── */
  /* 法杖的尺寸（v1.64）。杖身中心在 STAFF_MID、杖頭（寶珠）在它上面 STAFF_TIP 處，
     施法時整根往上抬 CAST_LIFT、杖頭往前傾 CAST_TILT——抬完手掌那個高度剛好落在杖身上。
     這幾個值 BODY、putWorker、WAND_TIP 三處都要用，所以擺在最前面只寫一次。 */
  const STAFF_X = 0.42, STAFF_MID = 0.78, STAFF_Z = 0.02, STAFF_TIP = 0.86;
  const CAST_LIFT = 0.34, CAST_TILT = 0.24;
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
        mage 是不是魔法師（戴巫師帽、拿法杖）,cast 施法深淺 0～1（杖抬多高、寶珠多亮）} */
  function putWorker(i, w) {
    const piv = w.roll ? ROLL_PIVOT : 0;
    /* 沒在打滾但身體是斜的（被戳倒、被震倒、飛在半空翻滾）也要抬——
       原點在腳底，倒到水平時整個身體剛好落在草皮那一層，半個身厚是埋在地裡的。
       抬 |sin(傾角)| × 半個身厚：站直時 0，躺平時剛好把人托在草地上（v1.60）。 */
    const lift = piv ? (ROLL_FLAT + (ROLL_PIVOT - ROLL_FLAT) * Math.abs(Math.cos(w.tilt || 0)))
                     : FLAT_LIFT * Math.abs(Math.sin(w.tilt || 0));
    scratch.position.set(w.x, w.y + lift * (w.scale || 1), w.z);
    /* 順序用 YZX：R = Ry(朝向)·Rz(打滾)·Rx(躺平)。z 那一軸轉的是「躺平之後的身體長軸」，
       也就是滾木頭那個滾法。沒在打滾時 z 給 0，跟原本的 YXZ 完全等價。 */
    scratch.rotation.set(w.tilt || 0, w.a, w.roll ? (w.rspin || 0) : 0, 'YZX');
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
      scratch.scale.setScalar(p.s);
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
     只退不收也不會越退越遠：距離取的是「現在」與「這一發要的」之中的大者。 */
  function holdWide(top, radius) {
    const halfV = camera.fov * Math.PI / 360;
    const halfH = Math.atan(Math.tan(halfV) * camera.aspect);
    const need = Math.max(top * 0.5 / Math.sin(halfV), radius / Math.sin(halfH)) * HOLD_MARGIN;
    camTarget.dist = Math.max(camTarget.dist, need);
    camTarget.ty = Math.max(camTarget.ty, top * 0.5);
    setFog();
  }

  function updateCamera(dt) {
    cam.dist += (camTarget.dist - cam.dist) * Math.min(1, dt * 2.2);
    cam.ty += (camTarget.ty - cam.ty) * Math.min(1, dt * 2.2);
    /* 平移跟得比縮放緊。用 2.2 的話等速平移時鏡頭會落後目標約 16 單位——
       那跟整座建築的半徑同一個量級，按下去會有一段明顯的空檔。8 大約落後 4.5 單位。 */
    cam.tx += (camTarget.tx - cam.tx) * Math.min(1, dt * 8);
    cam.tz += (camTarget.tz - cam.tz) * Math.min(1, dt * 8);
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

  function orbit(dx, dy) { cam.yaw -= dx * 0.006; cam.pitch += dy * 0.005; }

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
        point: h.point, dir: raycaster.ray.direction.clone()
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
    setWorkerCount, putWorker, commitWorkers,
    putTrees, putDust, putTrebs, putRocks, putDozers, putTrucks, putPools,
    setBall, hideBall, putTornados, setHammer, hideHammer, hammerVisible, hammerPos,
    putBombs, putMeteors, putNukes, setRings, hideRings, putFire, putFlash,
    putStars, putBolts,
    fitCamera, updateCamera, orbit, pan, zoom, shake, holdWide,
    cam, camTarget, BS, MAXB, MAXW, WPARTS, DOZ_W, DOZ_FRONT, MAG_RIM_OUT, WAND_TIP,
    get three() { return { renderer, scene, camera, blockMesh, workerMesh }; }
  };
})();
