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
  let ballMesh, tornadoMesh;
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
  const camTarget = { dist: 40, ty: 6 };

  const BS = 0.94;                         // 積木實際邊長（留 0.06 縫，看得出一塊一塊）
  const MAXB = 4200;                       // 積木池上限
  const MAXW = 80;                         // 小人上限
  const WPARTS = 7;                        // 每個小人的部位數
  const MAXDUST = 420;

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
      new T.MeshBasicMaterial({ transparent: true, opacity: 0.5, depthWrite: false }), MAXDUST);
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

    tornadoMesh = new T.Mesh(new T.ConeGeometry(1, 1, 18, 6, true),
      new T.MeshBasicMaterial({ color: 0xcfd6dd, transparent: true, opacity: 0.24,
                                side: T.DoubleSide, depthWrite: false }));
    tornadoMesh.visible = false;
    scene.add(tornadoMesh);

    resize();
  }

  /* ── 破壞道具 ───────────────────────────────────── */
  function setBall(x, y, z, r) {
    ballMesh.visible = true;
    ballMesh.position.set(x, y, z);
    ballMesh.scale.setScalar(r);
  }
  function hideBall() { ballMesh.visible = false; }
  /* 圓錐預設是尖端朝上，龍捲風要倒過來（尖端貼地） */
  function setTornado(x, z, r, h, spin) {
    tornadoMesh.visible = true;
    tornadoMesh.position.set(x, h / 2, z);
    tornadoMesh.scale.set(r, h, r);
    tornadoMesh.rotation.set(Math.PI, spin, 0);
  }
  function hideTornado() { tornadoMesh.visible = false; }

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
    { p: [0.34, 0.62, 0], s: [0.16, 0.44, 0.20], c: 'skin', arm: 1 }
  ];
  /* BODY 裡每個部位的 c 都必須在這裡有對應的色組，漏一個就整個 draw 掛掉 */
  const WCOL = {
    skin: [0xf0c39a, 0xd9a173, 0xbb8055, 0xe8b489],
    suit: [0xe8a13c, 0x4a8fd8, 0x54b06a, 0xd66a5a],
    leg: [0x3f4a5c, 0x5a4632, 0x2f3a49, 0x4a4030],
    hat: [0xf5e14b]
  };

  function setWorkerCount(n) { workerMesh.count = Math.min(n, MAXW) * WPARTS; }

  /* w：{x,y,z,a 朝向,ph 步伐相位,carry 是否舉手,tilt 跌倒角度,tone 膚色/衣色編號} */
  function putWorker(i, w) {
    scratch.position.set(w.x, w.y, w.z);
    scratch.rotation.set(w.tilt || 0, w.a, 0, 'YXZ');
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
      if (b.arm) {
        if (w.carry) {                      // 搬東西時雙手舉高
          scratchB.rotation.x = -2.5;
          scratchB.position.y = 0.85; scratchB.position.z = -0.16;
        } else {
          scratchB.rotation.x = -Math.sin(w.ph) * b.arm * w.gait * 0.8;
        }
      }
      scratchB.updateMatrix();
      tmpM.multiplyMatrices(scratch.matrix, scratchB.matrix);
      workerMesh.setMatrixAt(i * WPARTS + k, tmpM);
      const pal = WCOL[b.c];
      tmpC.setHex(pal[w.tone % pal.length]);
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
      tmpC.setRGB(p.c, p.c, p.c * 0.96);
      dustMesh.setColorAt(i, tmpC);
    }
    dustMesh.instanceMatrix.needsUpdate = true;
    if (dustMesh.instanceColor) dustMesh.instanceColor.needsUpdate = true;
  }

  /* ── 相機 ─────────────────────────────────────────── */
  /* radius/height 是建築本身，arena 是碎料散落範圍（決定草地與陰影要多大） */
  function fitCamera(radius, height, arena, instant) {
    // 把建築當成一顆球來取景：距離 = 球半徑 / sin(半視角)
    const R = Math.max(radius * 1.05, height * 0.62) + 2;
    camTarget.dist = R / Math.sin(camera.fov * Math.PI / 360) * 1.06;
    camTarget.ty = height * 0.44 + 1.5;
    if (instant) { cam.dist = camTarget.dist; cam.ty = camTarget.ty; }
    // 陰影相機要蓋住整片工地，不然大建築跟遠處碎料的影子會被裁掉
    const s = Math.max(45, arena + height * 0.5);
    const sc = sun.shadow.camera;
    sc.left = -s; sc.right = s; sc.top = s; sc.bottom = -s;
    sc.updateProjectionMatrix();
    setGroundSize(arena + 26);
    scene.fog.near = arena + 20;
    scene.fog.far = arena * 2.6 + 90;
  }

  function updateCamera(dt) {
    cam.dist += (camTarget.dist - cam.dist) * Math.min(1, dt * 2.2);
    cam.ty += (camTarget.ty - cam.ty) * Math.min(1, dt * 2.2);
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
    putTrees, putDust,
    setBall, hideBall, setTornado, hideTornado,
    fitCamera, updateCamera, orbit, zoom, shake,
    cam, camTarget, BS, MAXB, MAXW, WPARTS,
    get three() { return { renderer, scene, camera, blockMesh, workerMesh }; }
  };
})();
