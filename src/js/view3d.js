/* ============================================================
   3D view (Three.js). Draws the workshop, the lathe, the spinning
   blank revolved from the live radius profile, the chisel and the
   chips. Reads shared state, never changes the cutting model.

   Axis convention: profile slice 0 is the LEFT end of the log on
   screen, matching the input mapping and the 2D view. The blank's
   LatheGeometry runs along its local +Y, and spinGroup turns local
   +Y onto world +X (rotation.z = -PI/2). The Nov 12 prototype used
   +PI/2, which put slice 0 on the right and mirrored every cut.
   ============================================================ */
(function (root) {
  "use strict";
  var L = root.Lathe;
  var THREE = root.THREE;

  /* front-lower contact normal on the blank (the tool rest side) and the
     surface travel direction there (front face moving down) */
  var CONTACT_N = { y: -0.42 / Math.hypot(0.42, 0.907), z: 0.907 / Math.hypot(0.42, 0.907) };

  function createView3D(stage, S, onFail) {
    if (!THREE) return null;
    var C = L.CFG, work = S.work;
    var LOG_LEN = C.LOG_LEN, R0 = C.R0, CENTER_Y = C.CENTER_Y, SEG = C.SEG;

    /* ---- WebGL, opaque: alpha off sidesteps a known webview compositing bug ---- */
    var renderer = null;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance", failIfMajorPerformanceCaveat: false });
    } catch (e1) {
      try { renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false }); }
      catch (e2) { renderer = null; }
    }
    if (!renderer) return null;
    renderer.setPixelRatio(Math.min(root.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x17110c, 1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    stage.appendChild(renderer.domElement);
    renderer.domElement.addEventListener("webglcontextlost", function (e) { e.preventDefault(); onFail(); }, false);

    /* ---------------- textures (procedural canvas) ---------------- */
    function makeWoodTexture() {
      var c = document.createElement("canvas"); c.width = 1024; c.height = 512;
      var g = c.getContext("2d");
      var grad = g.createLinearGradient(0, 0, 1024, 0);
      grad.addColorStop(0, "#a9763e"); grad.addColorStop(0.5, "#b5854a"); grad.addColorStop(1, "#a06c36");
      g.fillStyle = grad; g.fillRect(0, 0, 1024, 512);
      // Grain runs along the length of the blank: on the lathe UV, length is V,
      // circumference is U, so grain streaks are vertical lines on this canvas.
      for (var i = 0; i < 210; i++) {
        var x = Math.random() * 1024;
        var dark = Math.random() > 0.42;
        g.strokeStyle = dark ? "rgba(105,62,26," + (0.1 + Math.random() * 0.24) + ")"
                             : "rgba(238,196,138," + (0.07 + Math.random() * 0.16) + ")";
        g.lineWidth = 0.6 + Math.random() * 2.4;
        g.beginPath();
        g.moveTo(x, -10);
        var wob = (Math.random() - 0.5) * 14;
        g.bezierCurveTo(x + wob, 150, x - wob, 340, x + (Math.random() - 0.5) * 8, 522);
        g.stroke();
      }
      for (var k = 0; k < 5; k++) {        // a few knots make the spin readable
        var kx = Math.random() * 1024, ky = Math.random() * 512;
        for (var r = 9; r > 1; r -= 2) {
          g.strokeStyle = "rgba(110,66,28," + (0.16 + (9 - r) * 0.03) + ")";
          g.lineWidth = 1.4;
          g.beginPath(); g.ellipse(kx, ky, r * 1.5, r, 0.3, 0, Math.PI * 2); g.stroke();
        }
        g.fillStyle = "rgba(84,48,20,0.85)";
        g.beginPath(); g.ellipse(kx, ky, 2.4, 1.7, 0.3, 0, Math.PI * 2); g.fill();
      }
      var tex = new THREE.CanvasTexture(c);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = 4;
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    }
    function makeEndTexture() {
      var c = document.createElement("canvas"); c.width = c.height = 256;
      var g = c.getContext("2d");
      g.fillStyle = "#dcb57e"; g.fillRect(0, 0, 256, 256);
      for (var r = 120; r > 4; r -= 5 + Math.random() * 6) {
        g.strokeStyle = "rgba(130,84,40," + (0.24 + Math.random() * 0.2) + ")";
        g.lineWidth = 1.6;
        g.beginPath();
        g.arc(118 + Math.random() * 4, 122 + Math.random() * 4, r, 0, Math.PI * 2);
        g.stroke();
      }
      g.fillStyle = "rgba(96,58,24,0.9)";
      g.beginPath(); g.arc(120, 124, 4, 0, Math.PI * 2); g.fill();
      var tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    }
    function makeChipSprite() {
      var c = document.createElement("canvas"); c.width = c.height = 64;
      var g = c.getContext("2d");
      var rg = g.createRadialGradient(32, 32, 2, 32, 32, 30);
      rg.addColorStop(0, "rgba(255,235,200,0.9)");
      rg.addColorStop(0.6, "rgba(240,205,150,0.35)");
      rg.addColorStop(1, "rgba(240,205,150,0)");
      g.fillStyle = rg; g.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    }

    /* ---------------- scene ---------------- */
    var scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x17110c, 14, 30);
    var camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    var camBase = new THREE.Vector3();

    var keyLight = new THREE.DirectionalLight(0xffd9a8, 2.1);
    keyLight.position.set(4.5, 8, 6);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.left = -6; keyLight.shadow.camera.right = 6;
    keyLight.shadow.camera.top = 7; keyLight.shadow.camera.bottom = -3;
    keyLight.shadow.bias = -0.0004;
    scene.add(keyLight);
    var fillLight = new THREE.DirectionalLight(0xbfd0e0, 0.55);
    fillLight.position.set(-6, 3.5, 4);
    scene.add(fillLight);
    var rimLight = new THREE.DirectionalLight(0xffb066, 0.9);
    rimLight.position.set(-2, 4, -6);
    scene.add(rimLight);
    scene.add(new THREE.AmbientLight(0x604c33, 0.5));

    var ironMat = new THREE.MeshStandardMaterial({ color: 0x46524c, roughness: 0.52, metalness: 0.45 });
    var ironDark = new THREE.MeshStandardMaterial({ color: 0x2c3234, roughness: 0.46, metalness: 0.5 });
    var steelMat = new THREE.MeshStandardMaterial({ color: 0xd6dde1, roughness: 0.3, metalness: 0.75 });
    var steelDark = new THREE.MeshStandardMaterial({ color: 0x99a1a6, roughness: 0.38, metalness: 0.7 });

    var floor = new THREE.Mesh(
      new THREE.CircleGeometry(16, 40),
      new THREE.MeshStandardMaterial({ color: 0x241a11, roughness: 0.95, metalness: 0 })
    );
    floor.rotation.x = -Math.PI / 2; floor.position.y = 0; floor.receiveShadow = true;
    scene.add(floor);

    (function addWall() {  // plank wall with a lamplit window and hanging tools
      var c = document.createElement("canvas"); c.width = 1024; c.height = 512;
      var g = c.getContext("2d");
      g.fillStyle = "#2b1f13"; g.fillRect(0, 0, 1024, 512);
      for (var x = 0; x < 1024; x += 86) {
        g.fillStyle = "rgba(0,0,0,0.35)"; g.fillRect(x, 0, 3, 512);
        g.fillStyle = "rgba(255,205,140," + (0.02 + Math.random() * 0.04) + ")"; g.fillRect(x + 3, 0, 80, 512);
        for (var s = 0; s < 7; s++) {
          g.strokeStyle = "rgba(16,10,5," + (0.1 + Math.random() * 0.14) + ")";
          g.lineWidth = 1 + Math.random() * 1.6;
          var y0 = Math.random() * 512;
          g.beginPath(); g.moveTo(x + 4, y0); g.lineTo(x + 84, y0 + (Math.random() - 0.5) * 22); g.stroke();
        }
      }
      g.fillStyle = "#0f0a05"; g.fillRect(726, 52, 196, 236);
      var wg = g.createRadialGradient(824, 160, 12, 824, 160, 190);
      wg.addColorStop(0, "rgba(255,196,105,0.95)"); wg.addColorStop(0.55, "rgba(214,138,52,0.55)"); wg.addColorStop(1, "rgba(120,70,26,0.12)");
      g.fillStyle = wg; g.fillRect(734, 60, 180, 220);
      g.fillStyle = "rgba(20,12,6,0.9)";
      g.fillRect(818, 60, 10, 220); g.fillRect(734, 164, 180, 10);
      g.strokeStyle = "#120b05"; g.lineWidth = 10; g.strokeRect(730, 56, 188, 228);
      g.fillStyle = "rgba(12,8,4,0.88)";
      g.beginPath();
      g.moveTo(90, 84); g.lineTo(300, 104); g.lineTo(292, 142); g.lineTo(120, 128); g.lineTo(96, 152); g.lineTo(74, 148); g.lineTo(80, 108);
      g.closePath(); g.fill();
      g.fillRect(430, 70, 66, 66); g.fillRect(452, 92, 120, 20);
      for (var tI = 0; tI < 4; tI++) {
        var tx = 560 + tI * 36;
        g.fillRect(tx, 78, 9, 74);
        g.beginPath(); g.ellipse(tx + 4.5, 168, 11, 17, 0, 0, Math.PI * 2); g.fill();
      }
      g.fillStyle = "rgba(0,0,0,0.5)"; g.fillRect(0, 452, 1024, 60);
      var tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      var wall = new THREE.Mesh(new THREE.PlaneGeometry(34, 17), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0 }));
      wall.position.set(0, 6.4, -6.2);
      wall.receiveShadow = true;
      scene.add(wall);
    })();
    (function scatterCurls() {  // shavings on the floor from earlier work
      var geo = new THREE.TorusGeometry(0.09, 0.016, 6, 14, Math.PI * 1.4);
      var mat = new THREE.MeshStandardMaterial({ color: 0xd9b47c, roughness: 0.85 });
      var inst = new THREE.InstancedMesh(geo, mat, 46);
      var m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
      for (var i = 0; i < 46; i++) {
        var a = Math.random() * Math.PI * 2, d = 1.4 + Math.random() * 3.6;
        p.set(Math.cos(a) * d, 0.02, 1.1 + Math.sin(a) * d * 0.55);
        e.set(-Math.PI / 2 + (Math.random() - 0.5) * 0.7, 0, Math.random() * Math.PI * 2);
        q.setFromEuler(e);
        var sc = 0.6 + Math.random() * 0.9; s.set(sc, sc, sc);
        m.compose(p, q, s); inst.setMatrixAt(i, m);
      }
      scene.add(inst);
    })();

    /* ---------------- the lathe machine ---------------- */
    var lathe = new THREE.Group();
    scene.add(lathe);
    function box(w, h, d, mat, x, y, z) {
      var ms = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      ms.position.set(x, y, z); ms.castShadow = true; ms.receiveShadow = true;
      lathe.add(ms); return ms;
    }
    box(8.6, 0.34, 0.62, ironMat, 0, 0.92, -0.28);
    box(8.6, 0.34, 0.62, ironMat, 0, 0.92, 0.34);
    box(8.9, 0.16, 1.5, ironDark, 0, 1.12, 0.02);
    box(0.34, 0.95, 1.15, ironMat, -3.7, 0.48, 0);
    box(0.34, 0.95, 1.15, ironMat, 3.7, 0.48, 0);
    box(1.4, 0.12, 1.3, ironDark, -3.7, 0.05, 0);
    box(1.4, 0.12, 1.3, ironDark, 3.7, 0.05, 0);
    box(1.15, 1.65, 1.3, ironMat, -3.95, 1.95, 0);   // headstock (left)
    box(1.3, 0.3, 1.44, ironDark, -3.95, 2.9, 0);
    box(1.0, 1.35, 1.1, ironMat, 3.95, 1.8, 0);      // tailstock (right)
    box(1.14, 0.26, 1.24, ironDark, 3.95, 2.58, 0);
    var chuck = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.38, 0.55, 24), ironDark);
    chuck.rotation.z = Math.PI / 2; chuck.position.set(-3.28, CENTER_Y, 0); chuck.castShadow = true;
    lathe.add(chuck);
    var tailCone = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.62, 20), steelDark);
    tailCone.rotation.z = Math.PI / 2; tailCone.position.set(3.42, CENTER_Y, 0); tailCone.castShadow = true;
    lathe.add(tailCone);
    var tailBar = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.5, 14), steelMat);
    tailBar.rotation.z = Math.PI / 2; tailBar.position.set(3.78, CENTER_Y, 0);
    lathe.add(tailBar);
    var restBar = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 5.4, 14), steelMat);
    restBar.rotation.z = Math.PI / 2; restBar.position.set(0, CENTER_Y - 0.92, 1.28);
    restBar.castShadow = true; lathe.add(restBar);
    box(0.5, 0.85, 0.5, ironMat, 1.7, 0.72, 1.28);
    var restPost = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.55, 12), steelDark);
    restPost.position.set(1.7, 1.32, 1.28); lathe.add(restPost);

    /* ---------------- the workpiece ---------------- */
    var woodTex = makeWoodTexture();
    var woodMat = new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.72, metalness: 0.0, bumpMap: woodTex, bumpScale: 0.6 });
    var endMat = new THREE.MeshStandardMaterial({ map: makeEndTexture(), roughness: 0.85 });

    var spinGroup = new THREE.Group();
    spinGroup.rotation.z = -Math.PI / 2;   // local +Y (slice 0 -> SEG-1) runs along world +X, left to right
    spinGroup.position.set(0, CENTER_Y, 0);
    scene.add(spinGroup);

    // Built once, then positions and normals are rewritten in place as the
    // profile changes: no per-frame geometry allocation, no GC hitches.
    var RADIAL = 72;
    var pts = [];
    for (var pi = 0; pi < SEG; pi++) pts.push(new THREE.Vector2(work.radius[pi], -LOG_LEN / 2 + (pi / (SEG - 1)) * LOG_LEN));
    var workGeo = new THREE.LatheGeometry(pts, RADIAL);
    workGeo.attributes.position.setUsage(THREE.DynamicDrawUsage);
    workGeo.attributes.normal.setUsage(THREE.DynamicDrawUsage);
    var workMesh = new THREE.Mesh(workGeo, woodMat);
    workMesh.castShadow = true; workMesh.receiveShadow = true;
    spinGroup.add(workMesh);
    var sinT = new Float32Array(RADIAL + 1), cosT = new Float32Array(RADIAL + 1);
    for (var ti = 0; ti <= RADIAL; ti++) { var ph = (ti / RADIAL) * Math.PI * 2; sinT[ti] = Math.sin(ph); cosT[ti] = Math.cos(ph); }
    var dyStep = LOG_LEN / (SEG - 1);
    var nrm = new Float32Array(SEG * 2);   // per-slice (radial, axial) normal
    var seenVersion = -1;
    function syncWork() {
      if (work.version === seenVersion) return;
      seenVersion = work.version;
      var r = work.radius, pos = workGeo.attributes.position.array, nor = workGeo.attributes.normal.array;
      for (var j = 0; j < SEG; j++) {
        var a = j > 0 ? j - 1 : j, b = j < SEG - 1 ? j + 1 : j;
        var dr = r[b] - r[a], dy = (b - a) * dyStep;
        var inv = 1 / Math.sqrt(dr * dr + dy * dy);
        nrm[j * 2] = dy * inv; nrm[j * 2 + 1] = -dr * inv;
      }
      for (var v = 0; v <= RADIAL; v++) {
        var s = sinT[v], c = cosT[v], base = v * SEG * 3;
        for (var k = 0; k < SEG; k++) {
          var o = base + k * 3, rr = Math.max(r[k], 0.02);
          pos[o] = rr * s; pos[o + 2] = rr * c;
          nor[o] = nrm[k * 2] * s; nor[o + 1] = nrm[k * 2 + 1]; nor[o + 2] = nrm[k * 2] * c;
        }
      }
      workGeo.attributes.position.needsUpdate = true;
      workGeo.attributes.normal.needsUpdate = true;
      renderer.shadowMap.needsUpdate = true;
    }
    syncWork();
    var capGeo = new THREE.CircleGeometry(R0 * 0.9, 36);
    var capA = new THREE.Mesh(capGeo, endMat);
    capA.rotation.x = -Math.PI / 2; capA.position.y = LOG_LEN / 2 - 0.001;
    var capB = new THREE.Mesh(capGeo, endMat);
    capB.rotation.x = Math.PI / 2; capB.position.y = -LOG_LEN / 2 + 0.001;
    spinGroup.add(capA); spinGroup.add(capB);

    /* ---------------- the chisel ---------------- */
    var chisel = new THREE.Group();
    chisel.scale.setScalar(1.22);
    scene.add(chisel);
    var handleProfile = [];
    [[0.001, 0], [0.13, 0.02], [0.155, 0.22], [0.125, 0.52], [0.15, 0.86], [0.165, 1.12], [0.12, 1.32], [0.001, 1.36]]
      .forEach(function (pr) { handleProfile.push(new THREE.Vector2(pr[0], pr[1])); });
    var handle = new THREE.Mesh(new THREE.LatheGeometry(handleProfile, 22), new THREE.MeshStandardMaterial({ color: 0x7c4a22, roughness: 0.55, metalness: 0 }));
    handle.position.y = 1.06; handle.castShadow = true;
    chisel.add(handle);
    var ferrule = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.115, 0.16, 18),
      new THREE.MeshStandardMaterial({ color: 0xd9ae4e, roughness: 0.35, metalness: 0.6 }));
    ferrule.position.y = 0.99; chisel.add(ferrule);
    var blade = new THREE.Mesh(new THREE.BoxGeometry(0.21, 1.0, 0.075), steelMat);
    blade.position.y = 0.48; blade.castShadow = true;
    chisel.add(blade);
    var gougeTip = new THREE.Group();   // tips: origin at the cutting edge, blade runs up local +Y
    var gougeSteel = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.105, 0.2, 18, 1, true, Math.PI * 0.85, Math.PI * 1.3), steelMat);
    gougeSteel.rotation.x = Math.PI / 2; gougeSteel.position.y = -0.06;
    gougeTip.add(gougeSteel);
    var gougeEdge = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.016, 8, 20, Math.PI), steelMat);
    gougeEdge.position.y = -0.16; gougeEdge.rotation.z = Math.PI;
    gougeTip.add(gougeEdge);
    chisel.add(gougeTip);
    var skewTip = new THREE.Group();
    var skewSteel = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.24, 0.07), steelMat);
    skewSteel.position.y = -0.1; skewSteel.rotation.z = 0.5;
    skewTip.add(skewSteel);
    chisel.add(skewTip);
    var shownTip = null;
    function showTip() {
      if (shownTip === S.tip) return;
      shownTip = S.tip;
      gougeTip.visible = S.tip === "gouge";
      skewTip.visible = S.tip === "skew";
      blade.scale.x = S.tip === "gouge" ? 1 : 0.92;
    }

    /* ---------------- chips + dust ---------------- */
    var CHIP_N = 420;
    var chipMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.085, 0.02, 0.045), new THREE.MeshStandardMaterial({ color: 0xe6c184, roughness: 0.9 }), CHIP_N);
    chipMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    chipMesh.frustumCulled = false;
    scene.add(chipMesh);
    var chips = [];
    for (var ci = 0; ci < CHIP_N; ci++) chips.push({ p: new THREE.Vector3(0, -10, 0), v: new THREE.Vector3(), rot: Math.random() * 6.28, rv: 0, life: 0, scale: 1 });
    var chipCursor = 0, chipDummy = new THREE.Object3D();
    var N3 = new THREE.Vector3(0, CONTACT_N.y, CONTACT_N.z);
    var T3 = new THREE.Vector3(0, -CONTACT_N.z, CONTACT_N.y);   // surface travel at the contact (front face moving down)
    var contactPoint = new THREE.Vector3();

    function spawnChips(origin, amount) {
      var n = Math.min(10, 2 + Math.floor(amount * 260));
      for (var i = 0; i < n; i++) {
        var c = chips[chipCursor]; chipCursor = (chipCursor + 1) % CHIP_N;
        c.p.copy(origin);
        c.p.x += (Math.random() - 0.5) * 0.14;
        c.v.copy(T3).multiplyScalar(0.7 + Math.random() * 1.5);
        c.v.addScaledVector(N3, 0.5 + Math.random() * 1.6);
        c.v.x += (Math.random() - 0.5) * 0.7;
        c.v.z += 0.4 + Math.random() * 0.9;
        c.rv = (Math.random() - 0.5) * 22;
        c.life = 0.55 + Math.random() * 0.5;
        c.scale = 0.55 + Math.random() * 1.15;
      }
    }
    function updateChips(dt) {
      for (var i = 0; i < CHIP_N; i++) {
        var c = chips[i];
        if (c.life > 0) {
          c.life -= dt;
          c.v.y -= 5.2 * dt;
          c.v.multiplyScalar(1 - 0.6 * dt);
          c.p.addScaledVector(c.v, dt);
          if (c.p.y < 0.03) { c.p.y = 0.03; c.v.set(0, 0, 0); c.rv *= 0.9; }
          c.rot += c.rv * dt;
          var s = c.scale * Math.min(1, c.life * 3);
          chipDummy.position.copy(c.p);
          chipDummy.rotation.set(c.rot, c.rot * 1.7, c.rot * 0.6);
          chipDummy.scale.set(s, s, s);
        } else {
          chipDummy.position.set(0, -10, 0); chipDummy.scale.set(0.001, 0.001, 0.001);
        }
        chipDummy.updateMatrix();
        chipMesh.setMatrixAt(i, chipDummy.matrix);
      }
      chipMesh.instanceMatrix.needsUpdate = true;
    }
    var DUST_N = 260;
    var dustPos = new Float32Array(DUST_N * 3), dustDat = [];
    for (var di = 0; di < DUST_N; di++) { dustDat.push({ life: 0, vx: 0, vy: 0, vz: 0 }); dustPos[di * 3 + 1] = -10; }
    var dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3).setUsage(THREE.DynamicDrawUsage));
    var dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ map: makeChipSprite(), size: 0.17, transparent: true, opacity: 0.5, depthWrite: false, color: 0xeed9ae, sizeAttenuation: true }));
    dust.frustumCulled = false;
    scene.add(dust);
    var dustCursor = 0;
    function spawnDust(origin, n) {
      for (var i = 0; i < n; i++) {
        var d = dustDat[dustCursor], idx = dustCursor; dustCursor = (dustCursor + 1) % DUST_N;
        d.life = 0.5 + Math.random() * 0.5;
        d.vx = (Math.random() - 0.5) * 0.5; d.vy = 0.25 + Math.random() * 0.5; d.vz = 0.4 + Math.random() * 0.6;
        dustPos[idx * 3] = origin.x; dustPos[idx * 3 + 1] = origin.y; dustPos[idx * 3 + 2] = origin.z;
      }
    }
    function updateDust(dt) {
      for (var i = 0; i < DUST_N; i++) {
        var d = dustDat[i];
        if (d.life > 0) {
          d.life -= dt;
          dustPos[i * 3] += d.vx * dt; dustPos[i * 3 + 1] += d.vy * dt; dustPos[i * 3 + 2] += d.vz * dt;
          if (d.life <= 0) dustPos[i * 3 + 1] = -10;
        }
      }
      dustGeo.attributes.position.needsUpdate = true;
    }

    /* ---------------- chisel posing ---------------- */
    var chiselPos = new THREE.Vector3(0.5, CENTER_Y - R0 - 0.35, 1.6);
    var chiselTarget = new THREE.Vector3(), handDir = new THREE.Vector3();
    var YAXIS = new THREE.Vector3(0, 1, 0), _q = new THREE.Quaternion();
    function axialX(t) { return -LOG_LEN / 2 + t * LOG_LEN; }
    function poseChisel(dt) {
      var tool = S.tool;
      if (tool.mode === "rest") {
        chiselTarget.set(0.5, CENTER_Y - R0 - 0.3, 1.8);
      } else {
        // Contact: the tip sits on the wood at the bottom of the cut, so it
        // stays visible and rides down as the cut deepens. Hover: just off it.
        var rr = tool.r + tool.lift;
        chiselTarget.set(axialX(tool.t), CENTER_Y + CONTACT_N.y * rr, CONTACT_N.z * rr + (tool.mode === "hover" ? 0.25 : 0));
      }
      chiselPos.lerp(chiselTarget, 1 - Math.exp(-dt * 38));
      if (S.cutIntensity > 0.03) {   // cutting judder
        chiselPos.x += (Math.random() - 0.5) * 0.02 * S.cutIntensity;
        chiselPos.y += (Math.random() - 0.5) * 0.026 * S.cutIntensity;
      }
      chisel.position.copy(chiselPos);
      handDir.set(chiselPos.x * 0.14 + 0.55, chiselPos.y - 2.5, chiselPos.z + 1.85).normalize();
      _q.setFromUnitVectors(YAXIS, handDir);
      chisel.quaternion.slerp(_q, Math.min(1, dt * 14 + 0.2));
    }

    /* ---------------- layout: screen <-> axis ---------------- */
    var _v = new THREE.Vector3();
    function project(wx, wy, wz) {
      _v.set(wx, wy, wz).project(camera);
      var w = stage.clientWidth, h = stage.clientHeight;
      return { x: (_v.x * 0.5 + 0.5) * w, y: (-_v.y * 0.5 + 0.5) * h };
    }
    var lay = { left: 0, right: 0, cy: 0, rPx: 100 };
    function computeLayout() {
      // Measure along the contact line on the front of the blank, where the
      // tip actually touches, so the chisel lands under the finger end to end.
      var cy = CENTER_Y + CONTACT_N.y * R0, cz = CONTACT_N.z * R0;
      var a = project(-LOG_LEN / 2, cy, cz), b = project(LOG_LEN / 2, cy, cz);
      var ax = project(0, CENTER_Y, 0), top = project(0, CENTER_Y + R0, 0);
      lay.left = a.x; lay.right = b.x; lay.cy = ax.y; lay.rPx = Math.max(20, ax.y - top.y);
    }
    function resize() {
      var w = stage.clientWidth, h = stage.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      var halfW = LOG_LEN / 2 + 1.15;
      var vfov = camera.fov * Math.PI / 180;
      var hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
      var dist = Math.max(halfW / Math.tan(hfov / 2), 3.4 / Math.tan(vfov / 2)) * 1.04;
      camera.position.set(0, CENTER_Y + 1.15, dist);
      camBase.copy(camera.position);
      camera.lookAt(0, CENTER_Y - 0.12, 0);
      camera.updateProjectionMatrix();
      computeLayout();
    }

    /* A webview can hand back a WebGL canvas that never composites (blank
       white). Read back a few pixels from the first frames; if they stay
       pure white, report failure so main swaps to the 2D view. */
    var glVerified = false, glBadFrames = 0;
    function verify() {
      if (glVerified) return;
      try {
        var gl = renderer.getContext();
        if (!gl || gl.isContextLost()) { onFail(); return; }
        var bw = gl.drawingBufferWidth, bh = gl.drawingBufferHeight;
        if (!bw || !bh) return;
        var buf = new Uint8Array(4 * 4 * 4);
        gl.readPixels(Math.max(0, (bw >> 1) - 2), Math.max(0, (bh >> 1) - 2), 4, 4, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        var allWhite = true;
        for (var i = 0; i < buf.length; i += 4) {
          if (!(buf[i] === 255 && buf[i + 1] === 255 && buf[i + 2] === 255)) { allWhite = false; break; }
        }
        if (allWhite) { if (++glBadFrames >= 3) onFail(); }
        else glVerified = true;
      } catch (e) {
        if (++glBadFrames >= 6) onFail();
      }
    }

    var frameN = 0;
    var view = {
      kind: "3d",
      canvas: renderer.domElement,
      layout: function () { return lay; },
      resize: resize,
      show: function () { renderer.domElement.style.display = "block"; glVerified = false; glBadFrames = 0; resize(); },
      hide: function () { renderer.domElement.style.display = "none"; },
      onCut: function (amount) {
        var t = S.tool.t, r = work.sample(t);
        contactPoint.set(axialX(t), CENTER_Y + CONTACT_N.y * r, CONTACT_N.z * r);
        spawnChips(contactPoint, amount);
        if (Math.random() < 0.6) spawnDust(contactPoint, 2);
      },
      frame: function (dt) {
        frameN++;
        showTip();
        syncWork();
        spinGroup.rotation.x = S.spinAngle;
        poseChisel(dt);
        updateChips(dt);
        updateDust(dt);
        if (S.shake > 0 && !S.reduceMotion) {
          camera.position.set(camBase.x + (Math.random() - 0.5) * 0.07 * S.shake, camBase.y + (Math.random() - 0.5) * 0.07 * S.shake, camBase.z);
        } else if (camera.position.x !== camBase.x) {
          camera.position.copy(camBase);
        }
        if (frameN % 2 === 0) renderer.shadowMap.needsUpdate = true;
        renderer.render(scene, camera);
        verify();
        if (frameN % 30 === 0) computeLayout();
      },
      // exposed for tests: where on screen a profile slice is drawn
      sliceToScreenX: function (i) {
        // the slice's place on the axis, through the mesh's real transform,
        // projected at the contact line where the chisel touches
        _v.set(0, -LOG_LEN / 2 + (i / (SEG - 1)) * LOG_LEN, 0);
        workMesh.localToWorld(_v);
        var r = work.radius[i];
        return project(_v.x, CENTER_Y + CONTACT_N.y * r, CONTACT_N.z * r).x;
      }
    };
    resize();
    return view;
  }

  L.createView3D = createView3D;
})(window);
