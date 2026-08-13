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
  let ballMesh, tornadoGroup, hammerGroup, rockMesh, trebMesh, dozMesh;
  let bombMesh, nukeGroup, ringGroup, magSpokeMesh, fireMesh, flashGroup, meteorMesh;
  const magRings = [], magDiscs = [];
  const flashShells = [];
  /* 填滿的圓盤：魔法陣每層一片，再加一片給那顆一直在的火種
     （盤是照 list 的順序發的，只給六片的話火種那圈在滿陣時就分不到） */
  const MAG_DISC = 7;
  /* 火／火星粒子。240 是「一次爆炸的火球 + 幾棟在燒」的量；
     煙火改成一次三發齊射之後，光是天上的火星就要三百顆才不會變成一顆一顆的點。
     這顆是 InstancedMesh，多開instance 不多吃 draw call，只多幾筆矩陣運算。 */
  const MAXFIRE = 320;
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
  const MAXBOMB = 6, BOMB_PARTS = 3;
  const MAXMET = 6;                        // 同時最多幾顆隕石（一顆一個 instance）
  /* 環的總數：魔法陣每層要兩個（亮芯 + 外圈暈染，單一個環太扁看不出是發光的），
     四層就吃掉八個，再加上爆炸衝擊環與蘑菇雲腰環。 */
  /* 同時能畫幾個圓環。魔法陣最多六層×2 個環＝12，那顆一直在的小火圈再吃 3 個，
     剩下的留給爆炸衝擊波、風壓那幾圈與蘑菇雲腰上那圈——不夠的話它們會被截掉
     （陣還在場上時放核彈就是這種情況：15 個先被陣佔走）。
     沒用到的環是 visible = false，不佔 draw call，開多幾個不花錢。 */
  const MAG_MAX = 24;
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
  const MAG_DASH = 26;                                       // 外圈那一圈虛線的段數
  const MAG_SPOKE = MAG_SWIRL.reduce((s, f) => s + f.arms * f.seg, 0) + MAG_DASH;
  const MAG_SP_RINGS = 6;                                    // 最多幾層會帶紋路
  // 推土鏟的半寬與它離車體中心多遠。規則那邊直接取這兩個值，畫面與判定才不會各說各話
  const DOZ_W = 3.2, DOZ_FRONT = 3.6;
  const TW_SEG = 16;                // 龍捲風的分段數
  const TW_MAX = 4;                 // 最多同時畫幾道
  const tornadoSegs = [];
  const _axis = new T.Vector3();
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
  let lastFit = null;                      // 最後一次取景的參數，畫面比例變了要拿它重算

  const BS = 0.94;                         // 積木實際邊長（留 0.06 縫，看得出一塊一塊）
  const MAXB = 4200;                       // 積木池上限
  const MAXW = 80;                         // 小人上限
  /* 每個小人的部位數。7 個身體部位 ＋ 藍圖 ＋ 聊天泡泡兩塊——後面三個是道具，
     沒拿的人整片縮到 0（同一個 InstancedMesh，不多一個 draw call）。 */
  const WPARTS = 10;
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

    /* 核彈：彈體朝 −Y 落下，一次只有一顆，用 Group 就好 */
    nukeGroup = new T.Group();
    const nParts = [
      [[0, 2.6, 0], [1.7, 4.4, 1.7], 0x5c636d],        // 彈體
      [[0, 0.5, 0], [1.25, 1.1, 1.25], 0xb8402f],      // 彈頭
      [[0, 3.7, 0], [1.85, 0.5, 1.85], 0xe8c33c],      // 警戒環
      [[-0.9, 5.2, 0], [0.22, 1.7, 1.6], 0x767d87],    // 尾翼 ×4
      [[0.9, 5.2, 0], [0.22, 1.7, 1.6], 0x767d87],
      [[0, 5.2, -0.9], [1.6, 1.7, 0.22], 0x767d87],
      [[0, 5.2, 0.9], [1.6, 1.7, 0.22], 0x767d87]
    ];
    for (const [p, s, c] of nParts) {
      const m = new T.Mesh(new T.BoxGeometry(s[0], s[1], s[2]), voxelMaterial({ color: c }));
      m.position.set(p[0], p[1], p[2]);
      m.castShadow = true;
      nukeGroup.add(m);
    }
    nukeGroup.scale.setScalar(1.5);
    nukeGroup.visible = false;
    scene.add(nukeGroup);

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

    /* 貼地的發光圓環：魔法陣的每一層、爆炸的衝擊波、蘑菇雲腰上那一圈，
       都是這一組。每層一個扁環 + 一圈紋路——只有環的話它就是一條紅色的帶子，
       盤面的螺旋紋才讓它像「陣」。 */
    ringGroup = new T.Group();
    for (let i = 0; i < MAG_MAX; i++) {
      /* 環用一般混色：加法混色疊在亮綠色草地上會被洗成白的，看不出是紫的。
         輻條那圈小的才用加法，當作陣上的光點。 */
      /* 魔法陣那幾層用一般混色：加法混色疊在亮綠色草地上會被洗成白的，
         看不出是紅的。爆炸的衝擊環才給加法（它就是要發光），逐環切換。 */
      const m = new T.Mesh(new T.RingGeometry(0.93, 1, 64), new T.MeshBasicMaterial({
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

    magSpokeMesh = new T.InstancedMesh(unit, new T.MeshBasicMaterial({
      color: 0xffa028, transparent: true, opacity: 0.3,
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

  /* 核彈：只管畫在哪、轉多少，什麼時候掉、掉多快是規則那邊的事 */
  function setNuke(x, y, z, spin) {
    nukeGroup.visible = true;
    nukeGroup.position.set(x, y, z);
    nukeGroup.rotation.y = spin;
  }
  function hideNuke() { nukeGroup.visible = false; }

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
        dm.material.opacity = r.op * 0.3;
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
      scratch.rotation.set(p.rx, p.ry, 0);
      scratch.scale.setScalar(p.s);
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
  /* 身體各部位（相對小人原點）。x 會左右鏡射，所以只寫一半 */
  const BODY = [
    { p: [0, 0.60, 0], s: [0.50, 0.52, 0.34], c: 'suit' },   // 身體
    { p: [0, 1.02, 0], s: [0.40, 0.36, 0.40], c: 'skin' },   // 頭
    { p: [0, 1.24, 0], s: [0.52, 0.14, 0.52], c: 'hat' },    // 安全帽
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
    { p: [0.11, 1.44, 0], s: [0.18, 0.18, 0.16], c: 'talk', bub: 1 }
  ];
  /* BODY 裡每個部位的 c 都必須在這裡有對應的色組，漏一個就整個 draw 掛掉 */
  const WCOL = {
    skin: [0xf0c39a, 0xd9a173, 0xbb8055, 0xe8b489],
    suit: [0xe8a13c, 0x4a8fd8, 0x54b06a, 0xd66a5a],
    leg: [0x3f4a5c, 0x5a4632, 0x2f3a49, 0x4a4030],
    hat: [0xf5e14b],
    plan: [0x2f6fd0],
    talk: [0xffffff]
  };

  function setWorkerCount(n) { workerMesh.count = Math.min(n, MAXW) * WPARTS; }
  const CHAR = new T.Color(0x2b1d15);        // 燒起來的人往這個焦黑色靠

  /* 打滾時的旋轉中心：身體從腳底 0 長到帽頂 1.31，中段在 0.65。
     小人的原點在腳底，直接繞原點轉的話那是「以腳為軸繞圈」不是打滾——
     tilt 轉過水平之後整個人會插進地面下，實測有大半圈是埋在地裡的，
     看起來就變成「倒下去→消失→從另一邊冒出來」。

     中心離地多高還要跟著姿勢走：站著（或倒立）時是半個身高，橫躺時只有半個身厚。
     固定用半個身高的話，橫躺那半圈整個人浮在草皮上面。 */
  const ROLL_PIVOT = 0.65, ROLL_FLAT = 0.30;
  /* w：{x,y,z,a 朝向,ph 步伐相位,carry 是否舉手,tilt 跌倒角度,tone 膚色/衣色編號,
        burnK 身上燒黑的深淺（0～1，火滅之後會自己褪回 0）,roll 正在打滾,
        hail 慶祝舉手,plan 手上有藍圖,point 指揮動作剩幾秒,talk 說話中,bub 泡泡大小 0～1} */
  function putWorker(i, w) {
    const piv = w.roll ? ROLL_PIVOT : 0;
    const lift = piv && (ROLL_FLAT + (ROLL_PIVOT - ROLL_FLAT) * Math.abs(Math.cos(w.tilt || 0)));
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
      if (b.swing) {                        // 走路時腿前後擺
        const sw = Math.sin(w.ph) * b.swing * w.gait;
        scratchB.rotation.x = sw;
        scratchB.position.z = Math.sin(sw) * 0.2;
        scratchB.position.y = 0.20 - Math.abs(Math.sin(sw)) * 0.05;
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
      scratchB.position.y -= piv;      // 打滾時整具身體往下挪，旋轉中心才落在身體中段
      scratchB.updateMatrix();
      tmpM.multiplyMatrices(scratch.matrix, scratchB.matrix);
      workerMesh.setMatrixAt(i * WPARTS + k, tmpM);
      const pal = WCOL[b.c];
      tmpC.setHex(pal[w.tone % pal.length]);
      if (w.burnK) tmpC.lerp(CHAR, w.burnK);
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
      const R = Math.max(radius * 1.05, height * 0.62) + 2;
      const halfV = camera.fov * Math.PI / 360;
      const halfH = Math.atan(Math.tan(halfV) * camera.aspect);
      camTarget.dist = Math.max(R / Math.sin(halfV),
                                (radius * 1.05 + 2) / Math.sin(halfH)) * FIT_MARGIN;
      camTarget.ty = height * 0.44 + 1.5;
      camTarget.tx = camTarget.tz = 0;        // 取景時把鏡頭帶回工地中心
      if (instant) { cam.dist = camTarget.dist; cam.ty = camTarget.ty; cam.tx = cam.tz = 0; }
    }
    // 陰影相機要蓋住整片工地，不然大建築跟遠處碎料的影子會被裁掉
    const s = Math.max(45, arena + height * 0.5);
    const sc = sun.shadow.camera;
    sc.left = -s; sc.right = s; sc.top = s; sc.bottom = -s;
    sc.updateProjectionMatrix();
    setGroundSize(arena + 26);
    setFog();
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

  /* 爆炸運鏡：鏡頭退開、視線抬高，整朵蘑菇雲才進得了畫面。
     只退不收：退開之後就停在那個視距，要拉回來是玩家自己滾輪的事。
     以前是幾秒後用最後一次取景的參數自己收回去，但那等於每放一發就把鏡頭搶走兩次
     （退開一次、收回一次），連放兩發還會在遠近之間來回跳。
     只退不收也不會越退越遠：距離取的是「現在」與「這一發要的」之中的大者。 */
  function holdWide(dist) {
    camTarget.dist = Math.max(camTarget.dist, dist);
    camTarget.ty = Math.max(camTarget.ty, camTarget.dist * 0.22);
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
    if (cam.shake > 0.001) {                 // 打擊時的畫面震動
      cam.shakeT += dt * 47;
      const k = cam.shake;
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
  function pick(px, py) {
    ndc.set(px / W * 2 - 1, -(py / H * 2 - 1));
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects([blockMesh, workerMesh, ground], false);
    for (const h of hits) {
      if (h.object === blockMesh) return { kind: 'block', idx: h.instanceId, point: h.point, dir: raycaster.ray.direction.clone() };
      if (h.object === workerMesh) return { kind: 'worker', idx: Math.floor(h.instanceId / WPARTS), point: h.point, dir: raycaster.ray.direction.clone() };
      if (h.object === ground) return { kind: 'ground', idx: -1, point: h.point, dir: raycaster.ray.direction.clone() };
    }
    return null;
  }

  function render() { renderer.render(scene, camera); }
  function info() { const r = renderer.info.render; return { calls: r.calls, tris: r.triangles }; }

  return {
    init, resize, render, info, pick,
    setBlockCount, putBlock, commitBlocks,
    setWorkerCount, putWorker, commitWorkers,
    putTrees, putDust, putTrebs, putRocks, putDozers,
    setBall, hideBall, putTornados, setHammer, hideHammer, hammerVisible, hammerPos,
    putBombs, putMeteors, setNuke, hideNuke, setRings, hideRings, putFire, putFlash,
    fitCamera, updateCamera, orbit, pan, zoom, shake, holdWide,
    cam, camTarget, BS, MAXB, MAXW, WPARTS, DOZ_W, DOZ_FRONT,
    get three() { return { renderer, scene, camera, blockMesh, workerMesh }; }
  };
})();
