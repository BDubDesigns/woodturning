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
    var woodCanvas = null, grainCanvas = null;   // base wood, and the grain streaks alone (laid over paint so it shows through)
    function makeWoodTexture() {
      var c = document.createElement("canvas"); c.width = 1024; c.height = 512;
      var gc = document.createElement("canvas"); gc.width = 1024; gc.height = 512;
      var g = c.getContext("2d"), gg = gc.getContext("2d");
      var grad = g.createLinearGradient(0, 0, 1024, 0);
      grad.addColorStop(0, "#a9763e"); grad.addColorStop(0.5, "#b5854a"); grad.addColorStop(1, "#a06c36");
      g.fillStyle = grad; g.fillRect(0, 0, 1024, 512);
      // Grain runs along the length of the blank: on the lathe UV, length is V,
      // circumference is U, so grain streaks are vertical lines on this canvas.
      for (var i = 0; i < 210; i++) {
        var x = Math.random() * 1024;
        var dark = Math.random() > 0.42;
        var style = dark ? "rgba(105,62,26," + (0.1 + Math.random() * 0.24) + ")"
                         : "rgba(238,196,138," + (0.07 + Math.random() * 0.16) + ")";
        var lw = 0.6 + Math.random() * 2.4, wob = (Math.random() - 0.5) * 14, endX = x + (Math.random() - 0.5) * 8;
        [g, gg].forEach(function (cx) {
          cx.strokeStyle = style; cx.lineWidth = lw;
          cx.beginPath();
          cx.moveTo(x, -10);
          cx.bezierCurveTo(x + wob, 150, x - wob, 340, endX, 522);
          cx.stroke();
        });
      }
      for (var k = 0; k < 5; k++) {        // a few knots make the spin readable
        var kx = Math.random() * 1024, ky = Math.random() * 512;
        [g, gg].forEach(function (cx) {
          for (var r = 9; r > 1; r -= 2) {
            cx.strokeStyle = "rgba(110,66,28," + (0.16 + (9 - r) * 0.03) + ")";
            cx.lineWidth = 1.4;
            cx.beginPath(); cx.ellipse(kx, ky, r * 1.5, r, 0.3, 0, Math.PI * 2); cx.stroke();
          }
          cx.fillStyle = "rgba(84,48,20,0.85)";
          cx.beginPath(); cx.ellipse(kx, ky, 2.4, 1.7, 0.3, 0, Math.PI * 2); cx.fill();
        });
      }
      woodCanvas = c; grainCanvas = gc;
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
    var ambient = new THREE.AmbientLight(0x604c33, 0.5);
    scene.add(ambient);

    /* ---------------- the work light ----------------
       A lamp over the lathe, raking down across the piece so beads and coves
       read as light and shadow. It comes in tiers (S.lightLevel, 0 up), so
       the workshop can buy better ones: each is brighter, whiter and wider.
       [intensity, colour, cone angle, ambient, name]. */
    var WORK_LIGHTS = [
      [38, 0xffd9a8, 0.62, 0.5, "Bare bulb"],
      [54, 0xffe9c8, 0.7, 0.55, "Halogen work light"],
      [70, 0xfff3e2, 0.8, 0.58, "LED shop panel"],
      [86, 0xfffaf2, 0.9, 0.62, "Studio light bar"]
    ];
    L.WORK_LIGHTS = WORK_LIGHTS.map(function (w) { return w[4]; });
    var workLight = new THREE.SpotLight(0xffd9a8, 0, 18, 0.62, 0.6, 1.4);
    workLight.position.set(0.4, CENTER_Y + 4.8, 2.6);
    workLight.target.position.set(0, CENTER_Y - 0.2, 0);
    scene.add(workLight); scene.add(workLight.target);
    var lightShown = -1;
    function syncLight() {
      var lv = Math.max(0, Math.min(WORK_LIGHTS.length - 1, S.lightLevel | 0));
      if (lv === lightShown) return;
      lightShown = lv;
      var w = WORK_LIGHTS[lv];
      workLight.intensity = w[0]; workLight.color.setHex(w[1]); workLight.angle = w[2]; ambient.intensity = w[3];
      if (fixtureLevel !== lv) { fixtureLevel = lv; buildFixture(lv); }
    }

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

    /* ---------------- the lathe machine ----------------
       Built from a few dozen cheap primitives: a cast-iron stand with a timber
       shelf, twin bed ways, a rounded headstock with its belt cover, spindle,
       spur drive, outboard handwheel, motor and switch box, a tailstock with
       quill, live centre and handwheel, and the banjo under the tool rest.
       Castings wear a hammertone finish (one small noise texture as a bump
       map). Only the big parts cast shadows. */
    var lathe = new THREE.Group();
    scene.add(lathe);
    var hammer = (function () {
      var c = document.createElement("canvas"); c.width = c.height = 128;
      var g = c.getContext("2d"), img = g.createImageData(128, 128), d = img.data;
      for (var i = 0; i < d.length; i += 4) { var v = 110 + Math.random() * 90; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
      g.putImageData(img, 0, 0);
      g.globalAlpha = 0.35;
      for (var k = 0; k < 260; k++) { g.fillStyle = Math.random() < 0.5 ? "#000" : "#fff"; g.beginPath(); g.arc(Math.random() * 128, Math.random() * 128, 1 + Math.random() * 3, 0, Math.PI * 2); g.fill(); }
      var t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 3);
      return t;
    })();
    var castMat = new THREE.MeshStandardMaterial({ color: 0x46625a, roughness: 0.58, metalness: 0.35, bumpMap: hammer, bumpScale: 0.6 });
    var castDark = new THREE.MeshStandardMaterial({ color: 0x2b3532, roughness: 0.62, metalness: 0.3, bumpMap: hammer, bumpScale: 0.4 });
    var waysMat = new THREE.MeshStandardMaterial({ color: 0x8c949a, roughness: 0.34, metalness: 0.8 });
    var blackMat = new THREE.MeshStandardMaterial({ color: 0x15181a, roughness: 0.5, metalness: 0.2 });
    var timberMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.9, metalness: 0 });
    var ironMat = castMat, ironDark = castDark;
    function add(mesh, x, y, z, shadow) {
      mesh.position.set(x, y, z);
      if (shadow) { mesh.castShadow = true; mesh.receiveShadow = true; }
      lathe.add(mesh); return mesh;
    }
    function box(w, h, d, mat, x, y, z, shadow) { return add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat), x, y, z, shadow); }
    /* a box with rounded edges: a rounded rectangle (w x h, corner r) extruded d deep, centred */
    function rbox(w, h, d, r, mat, x, y, z, shadow) {
      var sh = new THREE.Shape(), hw = w / 2 - r, hh = h / 2 - r;
      sh.moveTo(-hw, -h / 2); sh.lineTo(hw, -h / 2); sh.quadraticCurveTo(w / 2, -h / 2, w / 2, -hh);
      sh.lineTo(w / 2, hh); sh.quadraticCurveTo(w / 2, h / 2, hw, h / 2); sh.lineTo(-hw, h / 2);
      sh.quadraticCurveTo(-w / 2, h / 2, -w / 2, hh); sh.lineTo(-w / 2, -hh); sh.quadraticCurveTo(-w / 2, -h / 2, -hw, -h / 2);
      var bev = Math.min(r, d * 0.2);
      var geo = new THREE.ExtrudeGeometry(sh, { depth: d - bev * 2, bevelEnabled: true, bevelThickness: bev, bevelSize: bev * 0.6, bevelSegments: 2, curveSegments: 4 });
      geo.translate(0, 0, -(d - bev * 2) / 2);
      return add(new THREE.Mesh(geo, mat), x, y, z, shadow);
    }
    function cylX(r0, r1, len, mat, x, y, z, seg, shadow) {
      var m = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, len, seg || 20), mat);
      m.rotation.z = Math.PI / 2; return add(m, x, y, z, shadow);
    }
    function wheel(rad, x, y, z) {               // a handwheel seen side-on along the axis: rim, hub, spokes, crank knob
      var g = new THREE.Group();
      var rim = new THREE.Mesh(new THREE.TorusGeometry(rad, rad * 0.11, 8, 28), castDark); rim.rotation.y = Math.PI / 2; g.add(rim);
      var hub = new THREE.Mesh(new THREE.CylinderGeometry(rad * 0.22, rad * 0.22, rad * 0.4, 14), castDark); hub.rotation.z = Math.PI / 2; g.add(hub);
      for (var k = 0; k < 3; k++) {
        var sp = new THREE.Mesh(new THREE.BoxGeometry(rad * 0.08, rad * 1.9, rad * 0.1), castDark);
        sp.rotation.x = k * Math.PI / 3; g.add(sp);
      }
      var knob = new THREE.Mesh(new THREE.CylinderGeometry(rad * 0.09, rad * 0.09, rad * 0.55, 10), blackMat);
      knob.rotation.z = Math.PI / 2; knob.position.set(rad * 0.28, rad * 0.8, 0); g.add(knob);
      g.position.set(x, y, z); lathe.add(g); return g;
    }

    // the stand: a splayed cast leg at each end, feet, a stretcher and a timber shelf with offcuts on it
    var BED_Y = 1.2;
    [-3.55, 3.55].forEach(function (lx) {
      var leg = new THREE.Shape();
      leg.moveTo(-0.72, 0); leg.lineTo(0.72, 0); leg.lineTo(0.42, BED_Y - 0.24); leg.lineTo(-0.42, BED_Y - 0.24); leg.closePath();
      var hole = new THREE.Path(); hole.moveTo(-0.3, 0.22); hole.lineTo(0.3, 0.22); hole.lineTo(0.17, 0.7); hole.lineTo(-0.17, 0.7); hole.closePath();
      leg.holes.push(hole);
      var lg = new THREE.ExtrudeGeometry(leg, { depth: 0.2, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1 });
      lg.translate(0, 0, -0.1);
      var m = new THREE.Mesh(lg, castDark); m.rotation.y = Math.PI / 2; add(m, lx, 0, 0.05, true);
      box(0.34, 0.07, 1.6, castDark, lx, 0.035, 0.05, false);
    });
    box(6.9, 0.12, 0.16, castDark, 0, 0.36, -0.15, false);
    box(6.9, 0.07, 1.0, timberMat, 0, 0.45, 0.05, true);
    box(1.6, 0.16, 0.24, timberMat, -1.6, 0.57, 0.1, false).rotation.y = 0.12;
    box(1.1, 0.13, 0.2, timberMat, -1.5, 0.71, -0.02, false).rotation.y = -0.2;
    cylX(0.17, 0.17, 1.2, timberMat, 1.4, 0.66, 0.15, 14, false);

    // the bed: two ground ways on a cast girder
    box(8.6, 0.26, 0.5, castMat, 0, BED_Y - 0.13, 0.02, true);
    box(8.5, 0.12, 0.2, waysMat, 0, BED_Y + 0.06, -0.17, true);
    box(8.5, 0.12, 0.2, waysMat, 0, BED_Y + 0.06, 0.21, true);
    var WAY_TOP = BED_Y + 0.12;

    // headstock (left): a rounded casting, the belt cover domed over it, the spindle boss and spur drive
    rbox(1.2, 1.25, 1.25, 0.14, castMat, -3.95, WAY_TOP + 0.62, 0.02, true);
    var dome = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.56, 1.1, 28), castMat);   // the belt cover: half sunk in the casting
    dome.rotation.x = Math.PI / 2; add(dome, -3.98, WAY_TOP + 1.1, 0.02, true);
    cylX(0.3, 0.36, 0.34, castMat, -3.22, CENTER_Y, 0, 24, true);        // spindle boss
    var chuck = cylX(0.2, 0.2, 0.16, steelDark, -3.0, CENTER_Y, 0, 18, false);   // spur drive
    var spur = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 10), steelMat);
    spur.rotation.z = -Math.PI / 2; add(spur, -2.88, CENTER_Y, 0, false);
    wheel(0.36, -4.7, CENTER_Y, 0.02);                                      // outboard handwheel
    // the motor slung behind and below, and the switch box on the front of the headstock
    cylX(0.3, 0.3, 0.9, castDark, -3.75, 0.82, -0.45, 20, true);
    cylX(0.31, 0.31, 0.08, blackMat, -3.27, 0.82, -0.45, 20, false);
    var sw = rbox(0.56, 0.44, 0.16, 0.05, blackMat, -3.95, WAY_TOP + 0.62, 0.72, false);
    var stopBtn = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.07, 14), new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.4 }));
    stopBtn.rotation.x = Math.PI / 2; add(stopBtn, -4.08, WAY_TOP + 0.62, 0.82, false);
    var goBtn = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.06, 14), new THREE.MeshStandardMaterial({ color: 0x3f8a3c, roughness: 0.4 }));
    goBtn.rotation.x = Math.PI / 2; add(goBtn, -3.86, WAY_TOP + 0.72, 0.82, false);
    var dial = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.07, 16), steelDark);
    dial.rotation.x = Math.PI / 2; add(dial, -3.84, WAY_TOP + 0.52, 0.82, false);

    // tailstock (right): casting, quill, live centre, handwheel, lock lever
    rbox(0.95, 0.92, 1.0, 0.12, castMat, 3.95, WAY_TOP + 0.46, 0.02, true);
    cylX(0.3, 0.26, 0.9, castMat, 3.9, CENTER_Y, 0.02, 22, true);         // the barrel the quill runs in
    var tailBar = cylX(0.11, 0.11, 0.5, steelMat, 3.33, CENTER_Y, 0, 16, false);   // quill
    var tailCone = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.4, 20), steelDark);
    tailCone.rotation.z = Math.PI / 2; add(tailCone, 2.95 + 0.2 - 0.05, CENTER_Y, 0, false);
    cylX(0.06, 0.06, 0.4, steelDark, 4.5, CENTER_Y, 0.02, 10, false);
    wheel(0.3, 4.7, CENTER_Y, 0.02);
    var lever = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.55, 8), blackMat);
    lever.rotation.z = -0.6; add(lever, 3.7, CENTER_Y + 0.42, 0.25, false);

    // the banjo slides under the ways and carries the post; the tool rest bar sits on it
    box(0.55, 0.2, 1.5, castMat, 1.7, BED_Y - 0.36, 0.55, true);
    var restBar = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 5.4, 14), steelMat);
    restBar.rotation.z = Math.PI / 2; restBar.position.set(0, CENTER_Y - 0.92, 1.28);
    restBar.castShadow = true; lathe.add(restBar);
    var restPost = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.36, 12), castMat);
    add(restPost, 1.7, CENTER_Y - 1.1, 1.28, false);
    var banjoLock = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 8), blackMat);
    banjoLock.rotation.x = 1.0; add(banjoLock, 1.95, BED_Y - 0.36, 1.32, false);

    /* ---------------- the work light, hung from the rafters ----------------
       A small fixture at the very top of the frame, on a cord that runs up out
       of sight. It is drawn for the tier the workshop owns (S.lightLevel), and
       the spot light shines from it, so the light the piece gets comes from
       the lamp the player can see. */
    var fixture = new THREE.Group(), fixtureLevel = -1;
    scene.add(fixture);
    var glowTex = (function () {
      var c = document.createElement("canvas"); c.width = c.height = 64;
      var g = c.getContext("2d"), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, "rgba(255,240,205,1)"); gr.addColorStop(0.35, "rgba(255,220,160,0.45)"); gr.addColorStop(1, "rgba(255,200,120,0)");
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    })();
    function buildFixture(lv) {
      while (fixture.children.length) fixture.remove(fixture.children[0]);
      var lit = new THREE.MeshBasicMaterial({ color: [0xffe2a8, 0xfff0d0, 0xfff8ee, 0xffffff][lv] });
      var glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      function part(geo, mat, x, y, z) { var m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); fixture.add(m); return m; }
      function cord(x, len) { part(new THREE.CylinderGeometry(0.012, 0.012, len, 5), blackMat, x, len / 2, 0); }
      if (lv === 0) {                       // a bare bulb in a socket on a flex
        cord(0, 3);
        part(new THREE.CylinderGeometry(0.05, 0.06, 0.14, 10), blackMat, 0, -0.06, 0);
        part(new THREE.SphereGeometry(0.11, 14, 10), lit, 0, -0.2, 0);
        glow.scale.set(0.9, 0.9, 1); glow.position.set(0, -0.2, 0.05);
      } else if (lv === 1) {                // a yellow halogen work light on a short pipe, face down
        cord(0, 3);
        var body = part(new THREE.BoxGeometry(0.46, 0.16, 0.3), new THREE.MeshStandardMaterial({ color: 0xe0b321, roughness: 0.45, metalness: 0.2 }), 0, -0.1, 0);
        body.rotation.x = 0.35;
        var face = part(new THREE.PlaneGeometry(0.38, 0.22), lit, 0, -0.185, 0.03); face.rotation.x = Math.PI / 2 + 0.35;
        glow.scale.set(1.3, 0.9, 1); glow.position.set(0, -0.24, 0.08);
      } else {                              // a long LED panel (or two) on chains
        var wide = lv === 2 ? 1.7 : 2.6;
        cord(-wide * 0.4, 3); cord(wide * 0.4, 3);
        part(new THREE.BoxGeometry(wide, 0.06, 0.26), new THREE.MeshStandardMaterial({ color: 0xd8dadc, roughness: 0.4, metalness: 0.5 }), 0, -0.03, 0);
        var strip = part(new THREE.PlaneGeometry(wide - 0.08, 0.2), lit, 0, -0.065, 0); strip.rotation.x = Math.PI / 2;
        if (lv >= 3) { var strip2 = part(new THREE.BoxGeometry(wide, 0.06, 0.26), new THREE.MeshStandardMaterial({ color: 0xd8dadc, roughness: 0.4, metalness: 0.5 }), 0, -0.03, -0.34); var s2 = part(new THREE.PlaneGeometry(wide - 0.08, 0.2), lit, 0, -0.065, -0.34); s2.rotation.x = Math.PI / 2; }
        glow.scale.set(wide * 1.5, 0.7, 1); glow.position.set(0, -0.1, 0.05);
      }
      fixture.add(glow);
    }
    var _ray = new THREE.Vector3();
    function hangFixture() {               // just inside the top edge of the frame, a little in front of the lathe
      camera.updateMatrixWorld();
      _ray.set(0, 0.94, 0.5).unproject(camera).sub(camera.position).normalize();
      var zf = 0.9, t = (zf - camera.position.z) / _ray.z;
      fixture.position.set(0, camera.position.y + _ray.y * t, zf);
      workLight.position.set(0.2, fixture.position.y - 0.25, zf);
    }

    /* ---------------- the workpiece ---------------- */
    var woodTex = makeWoodTexture();

    /* Paint lives in a second canvas: the bare wood, then each slice's coat over it, then the
       grain streaks laid back on top of the painted rows so the wood still shows through.
       On the lathe's UV, V runs along the length (slice 0 at V=0, the bottom of the canvas). */
    var PAINT_W = 1024, PAINT_H = 512, PNT = L.Paint, coat = S.coat;
    var paintCanvas = document.createElement("canvas"); paintCanvas.width = PAINT_W; paintCanvas.height = PAINT_H;
    var pg = paintCanvas.getContext("2d");
    pg.drawImage(woodCanvas, 0, 0);
    var paintTex = new THREE.CanvasTexture(paintCanvas);
    paintTex.wrapS = paintTex.wrapT = THREE.RepeatWrapping;
    paintTex.anisotropy = 4;
    paintTex.colorSpace = THREE.SRGBColorSpace;

    /* Roughness per slice: matte wood is rough, a sprayed finish is smooth. One column of
       texels per slice, so the gloss can differ along the length. */
    var ROUGH_MATTE = 0.74, ROUGH_GLOSS = 0.1;
    var roughCanvas = document.createElement("canvas"); roughCanvas.width = 4; roughCanvas.height = SEG;
    var rg = roughCanvas.getContext("2d");
    var roughTex = new THREE.CanvasTexture(roughCanvas);
    roughTex.wrapS = roughTex.wrapT = THREE.ClampToEdgeWrapping;

    /* A bright softbox and a window strip for the finish to reflect. Only the finished wood
       takes this reflection (envMapIntensity follows the gloss), so unfinished wood is unchanged. */
    var envCanvas = document.createElement("canvas"); envCanvas.width = 1024; envCanvas.height = 512;
    (function () {
      var e = envCanvas.getContext("2d");
      var bg = e.createLinearGradient(0, 0, 0, 512);
      bg.addColorStop(0, "#2e2318"); bg.addColorStop(0.5, "#201710"); bg.addColorStop(1, "#0f0a06");
      e.fillStyle = bg; e.fillRect(0, 0, 1024, 512);
      function box(x, y, w, h, c) {
        var gr = e.createLinearGradient(0, y, 0, y + h);
        gr.addColorStop(0, c); gr.addColorStop(1, "rgba(255,235,190,0.55)");
        e.fillStyle = gr; e.fillRect(x, y, w, h);
      }
      box(560, 92, 300, 70, "#fffaf0");     // softbox above and in front
      box(900, 150, 70, 150, "#ffe9b8");    // window strip off to the side
      box(120, 170, 60, 130, "#ffd89a");
    })();
    var envTex = new THREE.CanvasTexture(envCanvas);
    envTex.mapping = THREE.EquirectangularReflectionMapping;
    envTex.colorSpace = THREE.SRGBColorSpace;

    var woodMat = new THREE.MeshStandardMaterial({ map: paintTex, roughness: 1, roughnessMap: roughTex, metalness: 0.0, bumpMap: woodTex, bumpScale: 0.6, envMap: envTex, envMapIntensity: 0 });
    var paintSeen = -1, roughSeen = -1, paintFrame = 0;
    function cssRgb(c) { return "rgb(" + Math.round(c[0] * 255) + "," + Math.round(c[1] * 255) + "," + Math.round(c[2] * 255) + ")"; }
    function syncPaint(force) {
      if (!force && coat.version === paintSeen) return;
      if (!force && (++paintFrame % 2)) return;            // repaint at most every other frame while painting
      paintSeen = coat.version;
      pg.globalCompositeOperation = "source-over"; pg.globalAlpha = 1;
      pg.drawImage(woodCanvas, 0, 0);
      var step = PAINT_H / (SEG - 1), tmp = [0, 0, 0];
      for (var j = 0; j < SEG; j++) {
        var a = coat.coat[j];
        if (a < 0.01) continue;
        var y1 = Math.max(0, PAINT_H - (j + 0.5) * step), y2 = Math.min(PAINT_H, PAINT_H - (j - 0.5) * step), h = y2 - y1 + 0.8;
        tmp[0] = coat.color[j * 3]; tmp[1] = coat.color[j * 3 + 1]; tmp[2] = coat.color[j * 3 + 2];
        pg.globalAlpha = Math.min(1, a * 1.02);
        pg.fillStyle = cssRgb(tmp);
        pg.fillRect(0, y1, PAINT_W, h);
        pg.globalAlpha = Math.min(1, a) * 0.8;
        pg.drawImage(grainCanvas, 0, y1, PAINT_W, h, 0, y1, PAINT_W, h);
      }
      pg.globalAlpha = 1;
      paintTex.needsUpdate = true;
      // roughness map from the gloss
      var avg = 0;
      for (var r = 0; r < SEG; r++) {
        var gl = coat.gloss[r]; avg += gl;
        var v = Math.round((ROUGH_MATTE + (ROUGH_GLOSS - ROUGH_MATTE) * Math.pow(gl, 0.85)) * 255);
        rg.fillStyle = "rgb(" + v + "," + v + "," + v + ")";
        rg.fillRect(0, SEG - 1 - r, 4, 1);
      }
      roughTex.needsUpdate = true;
      woodMat.envMapIntensity = 0.6 * Math.pow(avg / SEG, 0.9);
      renderer.shadowMap.needsUpdate = true;
    }
    syncPaint(true);
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
      var tip = L.TIPS[S.tip] || L.TIPS.gouge, z = tip.size || 1;   // the look of the tip, at its size
      gougeTip.visible = tip.look === "gouge";
      skewTip.visible = tip.look === "skew";
      gougeTip.scale.set(z, 1, z); skewTip.scale.set(z, 1, 1);
      blade.scale.x = (tip.look === "gouge" ? 1 : 0.92) * Math.max(0.5, Math.min(1.3, z));
    }

    /* ---------------- the brush and the spray bottle ----------------
       Same convention as the chisel: origin at the working end (bristle tip,
       nozzle), the body runs up local +Y toward the hand. */
    var brushG = new THREE.Group();
    brushG.scale.setScalar(1.22);
    brushG.visible = false;
    scene.add(brushG);
    var brushHandle = new THREE.Mesh(new THREE.LatheGeometry(handleProfile, 22), new THREE.MeshStandardMaterial({ color: 0x7c4a22, roughness: 0.5, metalness: 0 }));
    brushHandle.position.y = 0.72; brushHandle.castShadow = true;
    brushG.add(brushHandle);
    var brushFerrule = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.09, 0.42, 18), steelMat);
    brushFerrule.position.y = 0.5; brushFerrule.castShadow = true;
    brushG.add(brushFerrule);
    var tuftMat = new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.55 });
    var tuft = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.34, 16), tuftMat);
    tuft.rotation.x = Math.PI;            // cone point down at the origin
    tuft.position.y = 0.17;
    brushG.add(tuft);
    function showBrush() {
      var wide = S.paintTool === "brush";
      tuft.scale.set(wide ? 1.9 : 0.5, wide ? 1 : 1.25, wide ? 0.55 : 0.5);
      tuft.position.y = wide ? 0.17 : 0.21;
      tuftMat.color.set(L.Paint.PALETTE[S.color].hex);
    }

    var bottleG = new THREE.Group();
    bottleG.scale.setScalar(1.22);
    bottleG.visible = false;
    scene.add(bottleG);
    var bottleMat = new THREE.MeshStandardMaterial({ color: 0xa9d3e8, roughness: 0.18, metalness: 0.05, transparent: true, opacity: 0.82 });
    var bBody = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.95, 24), bottleMat);
    bBody.position.y = 1.12; bBody.castShadow = true; bottleG.add(bBody);
    var bShoulder = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.2, 0.2, 24), bottleMat);
    bShoulder.position.y = 0.55; bottleG.add(bShoulder);
    var bHead = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.38), new THREE.MeshStandardMaterial({ color: 0xe8a33d, roughness: 0.4, metalness: 0.2 }));
    bHead.position.set(0, 0.34, -0.1); bHead.castShadow = true; bottleG.add(bHead);
    var bTrigger = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 0.05), new THREE.MeshStandardMaterial({ color: 0xcf8c2a, roughness: 0.4 }));
    bTrigger.position.set(0, 0.36, 0.14); bTrigger.rotation.x = -0.35; bottleG.add(bTrigger);
    var bNozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 0.2, 14), steelDark);
    bNozzle.position.set(0, 0.1, -0.2); bNozzle.rotation.x = 0.0; bottleG.add(bNozzle);
    var liquid = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.19, 0.7, 20), new THREE.MeshStandardMaterial({ color: 0xf3e4b0, roughness: 0.3, transparent: true, opacity: 0.9 }));
    liquid.position.y = 1.0; bottleG.add(liquid);

    var activeTool = chisel, shownMode = "cut", shownBrushKey = "";
    var toolFor = { cut: chisel, paint: brushG, finish: bottleG };
    function showTool() {
      if (shownMode !== S.mode) {
        var next = toolFor[S.mode];
        next.position.copy(activeTool.position); next.quaternion.copy(activeTool.quaternion);
        activeTool.visible = false; next.visible = true;
        activeTool = next; shownMode = S.mode;
      }
      if (S.mode === "paint") {
        var key = S.paintTool + ":" + S.color;
        if (key !== shownBrushKey) { shownBrushKey = key; showBrush(); }
      }
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

    /* ---------------- paint drops (flung off the spinning piece) and spray mist ---------------- */
    var DROP_N = 320;
    var dropMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.045, 8, 6), new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0 }), DROP_N);
    dropMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    dropMesh.frustumCulled = false;
    scene.add(dropMesh);
    var drops = [], dropCursor = 0, dropColor = new THREE.Color();
    for (var dI = 0; dI < DROP_N; dI++) {
      drops.push({ p: new THREE.Vector3(0, -10, 0), v: new THREE.Vector3(), life: 0, scale: 1 });
      dropMesh.setColorAt(dI, dropColor.set(0xffffff));
    }
    dropMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    function spawnDrops(origin, n) {
      dropColor.set(L.Paint.PALETTE[S.color].hex);
      for (var i = 0; i < n; i++) {
        var d = drops[dropCursor], idx = dropCursor; dropCursor = (dropCursor + 1) % DROP_N;
        d.p.copy(origin);
        d.p.x += (Math.random() - 0.5) * 0.12;
        // a spinning piece throws paint off along the surface's direction of travel, down and out
        d.v.copy(T3).multiplyScalar(0.8 + Math.random() * 1.8);
        d.v.addScaledVector(N3, 0.3 + Math.random() * 1.0);
        d.v.x += (Math.random() - 0.5) * 1.8;
        d.v.z += 0.2 + Math.random() * 0.6;
        d.life = 0.5 + Math.random() * 0.6;
        d.scale = 0.5 + Math.random() * 1.1;
        dropMesh.setColorAt(idx, dropColor);
      }
      dropMesh.instanceColor.needsUpdate = true;
    }
    function updateDrops(dt) {
      for (var i = 0; i < DROP_N; i++) {
        var d = drops[i];
        if (d.life > 0) {
          d.life -= dt;
          d.v.y -= 4.6 * dt;
          d.p.addScaledVector(d.v, dt);
          if (d.p.y < 0.03) { d.p.y = 0.03; d.v.set(0, 0, 0); }
          var sc = d.scale * Math.min(1, d.life * 4);
          chipDummy.position.copy(d.p); chipDummy.rotation.set(0, 0, 0);
          chipDummy.scale.set(sc * (1 + Math.min(0.8, Math.abs(d.v.y) * 0.12)), sc, sc);
        } else {
          chipDummy.position.set(0, -10, 0); chipDummy.scale.set(0.001, 0.001, 0.001);
        }
        chipDummy.updateMatrix();
        dropMesh.setMatrixAt(i, chipDummy.matrix);
      }
      dropMesh.instanceMatrix.needsUpdate = true;
    }
    var MIST_N = 420;
    var mistPos = new Float32Array(MIST_N * 3), mistDat = [];
    for (var mI = 0; mI < MIST_N; mI++) { mistDat.push({ life: 0, vx: 0, vy: 0, vz: 0 }); mistPos[mI * 3 + 1] = -10; }
    var mistGeo = new THREE.BufferGeometry();
    mistGeo.setAttribute("position", new THREE.BufferAttribute(mistPos, 3).setUsage(THREE.DynamicDrawUsage));
    var mist = new THREE.Points(mistGeo, new THREE.PointsMaterial({ map: makeChipSprite(), size: 0.2, transparent: true, opacity: 0.55, depthWrite: false, color: 0xe2f2ff, sizeAttenuation: true }));
    mist.frustumCulled = false;
    scene.add(mist);
    var mistCursor = 0;
    function spawnMist(origin, n) {
      for (var i = 0; i < n; i++) {
        var d = mistDat[mistCursor], idx = mistCursor; mistCursor = (mistCursor + 1) % MIST_N;
        d.life = 0.2 + Math.random() * 0.14;
        var sp = 1.8 + Math.random() * 1.4;      // leaves the nozzle toward the wood, in a narrow cone
        d.vx = (Math.random() - 0.5) * 1.1;
        d.vy = -N3.y * sp + (Math.random() - 0.5) * 0.5; d.vz = -N3.z * sp + (Math.random() - 0.5) * 0.5;
        mistPos[idx * 3] = origin.x + (Math.random() - 0.5) * 0.04; mistPos[idx * 3 + 1] = origin.y; mistPos[idx * 3 + 2] = origin.z;
      }
    }
    function updateMist(dt) {
      for (var i = 0; i < MIST_N; i++) {
        var d = mistDat[i];
        if (d.life > 0) {
          d.life -= dt;
          mistPos[i * 3] += d.vx * dt; mistPos[i * 3 + 1] += d.vy * dt; mistPos[i * 3 + 2] += d.vz * dt;
          if (d.life <= 0) mistPos[i * 3 + 1] = -10;
        }
      }
      mistGeo.attributes.position.needsUpdate = true;
    }

    /* ---------------- the target ghost: a commission's shape, drawn over the piece ----------------
       A bright silhouette in the plane through the axis, drawn on top of everything
       so the player can turn down to it. Only in cut mode, and only with a target. */
    var ghostPos = new Float32Array(SEG * 2 * 3), ghostGeo = new THREE.BufferGeometry();
    ghostGeo.setAttribute("position", new THREE.BufferAttribute(ghostPos, 3));
    var ghostIdx = [];
    for (var gi = 0; gi < SEG - 1; gi++) { ghostIdx.push(gi, gi + 1, SEG + gi, SEG + gi + 1); }
    ghostGeo.setIndex(ghostIdx);
    var ghost = new THREE.LineSegments(ghostGeo, new THREE.LineBasicMaterial({ color: 0xfff6dc, transparent: true, opacity: 0.95, depthTest: false }));
    ghost.renderOrder = 10; ghost.visible = false; ghost.frustumCulled = false;
    scene.add(ghost);
    var ghostFor = null;
    function syncGhost() {
      var tg = S.target, on = !!tg && S.mode === "cut";
      ghost.visible = on;
      if (!on || ghostFor === tg) return;
      ghostFor = tg;
      for (var k = 0; k < SEG; k++) {
        var x = axialX(k / (SEG - 1));
        ghostPos[k * 3] = x; ghostPos[k * 3 + 1] = CENTER_Y + tg[k]; ghostPos[k * 3 + 2] = 0.02;
        ghostPos[(SEG + k) * 3] = x; ghostPos[(SEG + k) * 3 + 1] = CENTER_Y - tg[k]; ghostPos[(SEG + k) * 3 + 2] = 0.02;
      }
      ghostGeo.attributes.position.needsUpdate = true;
      ghostGeo.computeBoundingSphere();
    }

    /* ---------------- the finishing lamp: swings along the piece so the gloss catches it ---------------- */
    var lamp = new THREE.Group();
    lamp.visible = false;
    scene.add(lamp);
    var lampLight = new THREE.PointLight(0xfff0d2, 0, 18, 1.4);
    lamp.add(lampLight);
    var lampBulb = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), new THREE.MeshBasicMaterial({ color: 0xfff6dc }));
    lamp.add(lampBulb);
    var lampShade = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.5, 0.42, 22, 1, true), new THREE.MeshStandardMaterial({ color: 0x2c3234, roughness: 0.5, metalness: 0.5, side: THREE.DoubleSide }));
    lampShade.position.y = 0.3; lamp.add(lampShade);
    var lampRod = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 4, 8), ironDark);
    lampRod.position.y = 2.5; lamp.add(lampRod);
    var lampGlow = new THREE.Mesh(new THREE.CircleGeometry(0.65, 24), new THREE.MeshBasicMaterial({ map: makeChipSprite(), transparent: true, opacity: 0.0, depthWrite: false, color: 0xfff0c8 }));
    lampGlow.position.z = 0.0; lamp.add(lampGlow);
    var lampOn = 0, lampPhase = 0, lampX = 0;

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
        // the spray bottle stands off the wood; the chisel and brush touch it
        if (S.mode === "finish") rr += 0.5;
        chiselTarget.set(axialX(tool.t), CENTER_Y + CONTACT_N.y * rr, CONTACT_N.z * rr + (tool.mode === "hover" ? 0.25 : 0));
      }
      chiselPos.lerp(chiselTarget, 1 - Math.exp(-dt * 38));
      if (S.cutIntensity > 0.03) {   // cutting judder
        chiselPos.x += (Math.random() - 0.5) * 0.02 * S.cutIntensity;
        chiselPos.y += (Math.random() - 0.5) * 0.026 * S.cutIntensity;
      }
      activeTool.position.copy(chiselPos);
      handDir.set(chiselPos.x * 0.14 + 0.55, chiselPos.y - 2.5, chiselPos.z + 1.85).normalize();
      _q.setFromUnitVectors(YAXIS, handDir);
      activeTool.quaternion.slerp(_q, Math.min(1, dt * 14 + 0.2));
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
      hangFixture();
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
      onPaint: function (pr, dt) {
        var t = S.tool.t, r = work.sample(t);
        contactPoint.set(axialX(t), CENTER_Y + CONTACT_N.y * r, CONTACT_N.z * r);
        spawnDrops(contactPoint, Math.floor(pr * dt * 70 + Math.random()));
      },
      onSpray: function (pr, dt) {
        var t = S.tool.t, r = work.sample(t) + 0.45;
        contactPoint.set(axialX(t), CENTER_Y + CONTACT_N.y * r, CONTACT_N.z * r);
        spawnMist(contactPoint, Math.floor(pr * dt * 220 + Math.random()));
      },
      frame: function (dt) {
        syncGhost();
        syncLight();
        frameN++;
        showTip();
        showTool();
        syncWork();
        syncPaint(false);
        // the lamp lights up for the finish and sweeps end to end so the gloss catches it
        lampOn += ((S.mode === "finish" ? 1 : 0) - lampOn) * Math.min(1, dt * 5);
        if (S.mode === "finish") { lampPhase += dt * 0.55; lampX = S.reduceMotion ? 0 : Math.sin(lampPhase) * LOG_LEN * 0.4; }
        lamp.visible = lampOn > 0.02;
        if (lamp.visible) {
          lamp.position.set(lampX, CENTER_Y + 2.35, 2.2);
          lampLight.intensity = lampOn * 42;
          lampGlow.material.opacity = lampOn * 0.8;
          lampGlow.quaternion.copy(camera.quaternion);
        }
        spinGroup.rotation.x = S.spinAngle;
        poseChisel(dt);
        updateChips(dt);
        updateDust(dt);
        updateDrops(dt);
        updateMist(dt);
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
