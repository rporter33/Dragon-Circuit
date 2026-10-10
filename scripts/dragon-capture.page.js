// Page-side helpers for scripts/dragon-capture.mjs, installed into every booted page after the
// basic __cap helpers (exact time steps, state labels, projection). Plain browser JavaScript run
// through page.evaluate, so it must not import anything at top level.
//
//   __cap.matte()        wyvern ID-matte luminance report for the frame just rendered (Q1, Q13)
//   __cap.ortho(opts)    same-scale orthographic lineup of every visible wyvern (Q2, Q4, Q5)
//   __cap.aim(opts)      re-aim the camera after the rigs ran (eye macros, dollies, chase-relative)
//   __cap.feet()         per-foot stance/swing and screen position (gait overlays, Q9)
//   __cap.metrics(names) tail bend and wing-stroke geometry of the player's wyvern (Q6, Q7)
//   __cap.spans()        on-screen wingspan and rider height in pixels (Q5, Q13)
//   __cap.gpu(opts)      wyvern draw timing: GPU timer queries, or a SwiftShader wall-clock proxy
(() => {
  const C = window.__cap;
  const g = window.__dw.game;
  const R = g.renderer;
  // Capture-only contact evidence: labels and requested velocities do not prove a landing.
  const contacts = [];
  g.events.on('touchdown', (e) => contacts.push({ t: C.t, impact: e.impact, position: e.position.toArray(), surface: e.surface }));
  C.resetMotion = () => { contacts.length = 0; };
  C.motion = () => ({ screen: g.screen, frozen: g.debug.freeze, mode: g.player.mode, airborne: g.player.wyvernPose.airborne,
    position: g.player.position.toArray(), velocity: g.player.flight.velocity.toArray(),
    contacts: contacts.slice(), animationSink: g.wyvern.animator.frame.sink,
    animationImpact: g.wyvern.animator.frame.landImpact, settle: g.wyvern.animator.frame.dipV,
    stats: g.wyvern.stats, penetration: window.__dw.wyvernPenetration() });

  const LUMA = [0.2126, 0.7152, 0.0722];

  // --- The render hook: lets a capture re-aim the camera after every rig has run -------------
  C.preRender = null;
  if (!R.__capWrapped) {
    const orig = R.render.bind(R);
    R.render = (scene, cam, dt) => {
      if (C.preRender) {
        try {
          C.preRender(scene, cam);
        } catch (e) {
          console.warn('capture preRender hook failed', e);
        }
      }
      orig(scene, cam, dt);
    };
    R.__capWrapped = true;
  }

  /** three.js: the same module instance as the game (the dev server's prebundled dependency). */
  C.loadThree = async () => {
    if (C.T) return C.T;
    const url = performance
      .getEntriesByType('resource')
      .map((e) => e.name)
      .find((n) => /\/node_modules\/\.vite\/deps\/three(\.module)?\.js/.test(n));
    C.T = await import(url ?? '/node_modules/three/build/three.module.js');
    return C.T;
  };

  const visibleChain = (o) => {
    for (let p = o; p; p = p.parent) if (!p.visible) return false;
    return true;
  };

  /** Every wyvern skinned mesh in the scene (by its skeleton: it has a tail). */
  C.wyvernMeshes = (onlyVisible = true) => {
    const out = [];
    g.scene.traverse((o) => {
      if (!o.isSkinnedMesh || !o.skeleton) return;
      if (!o.skeleton.bones.some((b) => b.name === 'tail0')) return;
      if (onlyVisible && !visibleChain(o)) return;
      out.push(o);
    });
    return out;
  };

  /**
   * Put the given wyvern meshes and every light on layer 31 (as well as their own), so a camera
   * on layer 31 alone draws nothing but them. Returns the undo.
   */
  C.isolateWyverns = (meshes) => {
    const touched = [];
    const add = (o) => {
      if (!o.layers.isEnabled(31)) {
        o.layers.enable(31);
        touched.push(o);
      }
    };
    for (const m of meshes) add(m);
    g.scene.traverse((o) => {
      if (o.isLight) add(o);
    });
    return () => {
      for (const o of touched) o.layers.disable(31);
    };
  };

  /** The creature materials (body and membrane) of every visible wyvern. */
  C.wyvernMaterials = () => {
    const s = new Set();
    for (const m of C.wyvernMeshes()) for (const mat of [].concat(m.material)) if (mat.userData?.dwWyvern) s.add(mat);
    return [...s];
  };

  // --- HDR readback -------------------------------------------------------------------------

  C.readTarget = (rt) => {
    const gl3 = R.gl;
    const ctx = gl3.getContext();
    const fb = gl3.properties.get(rt).__webglFramebuffer;
    const w = rt.width;
    const h = rt.height;
    const buf = new Float32Array(w * h * 4);
    gl3.state.bindFramebuffer(ctx.FRAMEBUFFER, fb);
    ctx.readPixels(0, 0, w, h, ctx.RGBA, ctx.FLOAT, buf);
    gl3.state.bindFramebuffer(ctx.FRAMEBUFFER, null);
    return { w, h, buf };
  };

  /**
   * Wyvern ID matte for the frame just rendered. Two extra passes into the scene target: every
   * other object drawn black (depth only, so the rider and grass still occlude), then the
   * wyverns with DW_MATTE materials that write (non-emissive luminance, emissive luminance,
   * -1000 coverage tag, region code). Values are the shader's own lit output after fog, before
   * tone mapping: exactly what the bloom prefilter thresholds. Edges divide by coverage.
   */
  C.matte = async (opts = {}) => {
    const T = await C.loadThree();
    const gl3 = R.gl;
    const rt = R.target;
    const thr = R.bloom.threshold;
    const knee = R.bloom.knee;
    // The composite frame (for NaN checks and the composite maximum).
    const hdr = C.readTarget(rt);
    const mats = C.wyvernMaterials();
    const meshes = C.wyvernMeshes();
    if (!meshes.length) return { error: 'no visible wyvern' };
    const wyvernSet = new Set(meshes);
    const scene = g.scene;
    const saved = [];
    const hide = (o, v) => {
      saved.push([o, o.visible]);
      o.visible = v;
    };
    // Occluders write black with alpha 0, so coverage and region codes do not mix with them at edges.
    const black = C._blackA0 ?? (C._blackA0 = new T.MeshBasicMaterial({ color: 0x000000, side: T.DoubleSide, opacity: 0, transparent: false }));
    const prevOverride = scene.overrideMaterial;
    const prevBg = scene.background;
    const prevAuto = gl3.autoClear;
    const prevShadow = gl3.shadowMap.autoUpdate;
    const prevClear = gl3.getClearColor(new T.Color());
    const prevClearA = gl3.getClearAlpha();
    try {
      gl3.shadowMap.autoUpdate = false;
      gl3.shadowMap.needsUpdate = false;
      // Pass 1: occluders, black. Wyverns and transparent things hidden.
      scene.traverse((o) => {
        if (wyvernSet.has(o)) hide(o, false);
        else if ((o.isMesh || o.isPoints || o.isLine || o.isSprite) && o.visible) {
          const ms = [].concat(o.material);
          if (ms.some((m) => m && (m.transparent || m.depthWrite === false))) hide(o, false);
        }
      });
      scene.overrideMaterial = black;
      scene.background = new T.Color(0, 0, 0);
      gl3.setRenderTarget(rt);
      gl3.setClearColor(0x000000, 0);
      gl3.clear(true, true, true);
      gl3.autoClear = false;
      gl3.render(scene, g.camera);
      for (let i = saved.length - 1; i >= 0; i--) saved[i][0].visible = saved[i][1];
      saved.length = 0;
      scene.overrideMaterial = null;
      // Pass 2: wyverns only, matte materials, over the black occluder depth.
      for (const m of mats) {
        m.defines = { ...(m.defines ?? {}), DW_MATTE: 1 };
        m.needsUpdate = true;
      }
      const undo = C.isolateWyverns(meshes);
      const layers = g.camera.layers.mask;
      g.camera.layers.set(31);
      try {
        gl3.clear(true, false, false); // keep depth from pass 1
        gl3.render(scene, g.camera);
      } finally {
        g.camera.layers.mask = layers;
        undo();
      }
    } finally {
      for (let i = saved.length - 1; i >= 0; i--) saved[i][0].visible = saved[i][1];
      scene.overrideMaterial = prevOverride;
      scene.background = prevBg;
      gl3.autoClear = prevAuto;
      gl3.shadowMap.autoUpdate = prevShadow;
      gl3.setClearColor(prevClear, prevClearA);
      gl3.setRenderTarget(null);
      for (const m of mats) {
        if (m.defines) delete m.defines.DW_MATTE;
        m.needsUpdate = true;
      }
    }
    const mt = C.readTarget(rt);
    return analyseMatte(hdr, mt, thr, knee, opts);
  };

  function analyseMatte(hdr, mt, thr, knee, opts) {
    const { w, h } = mt;
    const A = hdr.buf;
    const M = mt.buf;
    let nan = 0;
    let cov = 0;
    let covPx = 0;
    let x0 = w;
    let x1 = -1;
    let y0 = h;
    let y1 = -1;
    let maxNE = 0;
    let maxNEAt = -1;
    let maxNEReg = -1;
    let maxEm = 0;
    let maxComposite = 0;
    let overT = 0;
    let overK = 0;
    const regMax = {};
    const hist = new Float64Array(200); // non-emissive luminance, 0.01 bins
    for (let i = 0; i < w * h; i++) {
      const k = i * 4;
      if (!Number.isFinite(A[k]) || !Number.isFinite(A[k + 1]) || !Number.isFinite(A[k + 2])) nan++;
      const c = -M[k + 2] / 1000;
      if (!(c > 0.02)) continue;
      cov += Math.min(1, c);
      if (c < 0.25) continue;
      const lit = M[k] / c;
      const em = M[k + 1] / c;
      const regF = M[k + 3] / c;
      const reg = Math.round(regF) - 1;
      // Region codes average across region boundaries and MSAA edges: trust whole codes only.
      const clean = c > 0.9 && Math.abs(regF - reg - 1) < 0.08 && (reg <= 12 || (reg >= 20 && reg <= 23));
      if (c >= 0.5) {
        covPx++;
        const x = i % w;
        const y = h - 1 - Math.floor(i / w);
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
      if (lit > maxNE) {
        maxNE = lit;
        maxNEAt = i;
        maxNEReg = reg;
      }
      if (em > maxEm) maxEm = em;
      if (em < 0.25 * (lit + em) && lit + em > maxComposite) maxComposite = lit + em;
      if (lit >= thr) overT++;
      if (lit >= thr - knee) overK++;
      hist[Math.min(199, Math.floor(lit * 100))] += 1;
      if (clean) {
        const key = reg >= 20 ? `membrane${reg - 20}` : `r${reg}`;
        regMax[key] = Math.max(regMax[key] ?? 0, lit);
      }
    }
    const pct = (q) => {
      let total = 0;
      for (const v of hist) total += v;
      let acc = 0;
      for (let b = 0; b < hist.length; b++) {
        acc += hist[b];
        if (acc >= q * total) return b / 100;
      }
      return 2;
    };
    const r4 = (v) => (Number.isFinite(v) ? +v.toFixed(4) : null);
    const brightestRegion = Object.entries(regMax).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const at = maxNEAt >= 0 ? { x: maxNEAt % w, y: h - 1 - Math.floor(maxNEAt / w) } : null;
    return {
      size: `${w}x${h}`,
      bloomThreshold: r4(thr),
      bloomKnee: r4(knee),
      tod: r4(g.sky.timeOfDay),
      maxNonEmissive: r4(maxNE),
      maxNonEmissiveAt: at,
      maxNonEmissiveRegion: maxNEReg >= 20 ? `membrane${maxNEReg - 20}` : `r${maxNEReg}`,
      p99: pct(0.99),
      p999: pct(0.999),
      pxAtThreshold: overT,
      pxInKnee: overK,
      maxEmissive: r4(maxEm),
      maxCompositeNonEmissive: r4(maxComposite),
      regionMax: Object.fromEntries(Object.entries(regMax).map(([k, v]) => [k, r4(v)])),
      brightestRegion,
      clawsBrightest: brightestRegion === 'r9',
      coverage: r4(cov / (w * h)),
      coveragePx: covPx,
      bbox: x1 >= 0 ? { x0, x1, y0, y1 } : null,
      widthFrac: x1 >= 0 ? r4((x1 - x0 + 1) / w) : 0,
      heightFrac: y1 >= 0 ? r4((y1 - y0 + 1) / h) : 0,
      nanPixels: nan,
      pass: maxNE < thr && nan === 0,
    };
  }

  // --- Camera aim after the rigs (eye macro, dolly, chase-relative views) ----------------------

  const _v = () => new g.camera.position.constructor();

  /** World position of a named target on the player's wyvern: 'eye', a bone name, or 'body'. */
  C.targetPoint = (name, out = _v()) => {
    const W = g.wyvern;
    if (name === 'rider') return g.rider.group.getObjectByName('spine').getWorldPosition(out);
    if (!name || name === 'body') return out.copy(g.player.wyvernPose.position);
    if (name === 'eye' || name === 'eyeR') {
      const rig = W.rigDef;
      const head = W.skinnedMesh.skeleton.bones[rig.idx.head];
      out.subVectors(rig.eye, rig.bones[rig.idx.head].pos);
      if (name === 'eyeR') out.x = -rig.eye.x - rig.bones[rig.idx.head].pos.x;
      return out.applyMatrix4(head.matrixWorld);
    }
    const o = W.group.getObjectByName(name);
    return o ? o.getWorldPosition(out) : out.copy(g.player.wyvernPose.position);
  };

  /**
   * Re-aim the camera every render: orbit `target` at azimuth/elevation (degrees, relative to the
   * wyvern's heading; 0 = in front, 90 = its left) and distance (m, or `dist(t)` over strip time).
   */
  C.aim = (o) => {
    const deg = Math.PI / 180;
    const tgt = _v();
    const fwd = _v();
    let hd0 = null;
    C.preRender = (scene, cam) => {
      C.targetPoint(o.target, tgt);
      fwd.set(0, 0, 1).applyQuaternion(g.player.wyvernPose.orientation);
      // fixed: azimuth from the heading when the aim was set (a world-fixed camera for turns).
      const hd = o.fixed ? (hd0 ??= Math.atan2(fwd.x, fwd.z)) : Math.atan2(fwd.x, fwd.z);
      const dist = typeof o.dist === 'string' ? Number(new Function('t', `return (${o.dist});`)(C.t)) : (o.dist ?? 5);
      const a = hd + (o.az ?? 90) * deg;
      const e = (o.el ?? 5) * deg;
      cam.position.set(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)).multiplyScalar(dist).add(tgt);
      cam.up.set(0, 1, 0);
      cam.lookAt(tgt);
      if (o.fov) {
        if (C._fov0 === undefined) C._fov0 = cam.fov;
        cam.fov = o.fov;
        cam.updateProjectionMatrix();
      }
      cam.updateMatrixWorld();
    };
  };

  /** Drop any re-aim and put the lens back (the rigs cache the field of view they applied). */
  C.resetAim = () => {
    C.preRender = null;
    if (C._fov0 !== undefined) {
      g.camera.fov = C._fov0;
      g.camera.updateProjectionMatrix();
      C._fov0 = undefined;
    }
  };

  // --- Orthographic lineups ---------------------------------------------------------------------

  /**
   * Render every visible wyvern side by side at one scale with an orthographic camera.
   *   view: side (their left flank) | front | top (from above, heads up the image)
   *   matte: true for black silhouettes on white (no post), else colour on a neutral backdrop
   * The wyverns are moved (this frame only) so they stand in a row along the screen's x axis
   * with `gap` metres between bounding boxes, feet on one ground line. Returns the layout (px
   * per metre, each wyvern's screen box) for the grid and the silhouette measurements.
   */
  C.ortho = async (o = {}) => {
    const T = await C.loadThree();
    const view = o.view ?? 'side';
    const gap = o.gap ?? 2.5;
    const meshes = C.wyvernMeshes();
    if (!meshes.length) return { error: 'no visible wyvern' };
    const s = g.renderer.size;
    const W = s.x;
    const H = s.y;
    // Body frame from the first wyvern (the lineup shares one heading).
    const q = meshes[0].parent.getWorldQuaternion(new T.Quaternion());
    const F = new T.Vector3(0, 0, 1).applyQuaternion(q).setY(0).normalize();
    const Lf = new T.Vector3(F.z, 0, -F.x); // the animal's left
    const UP = new T.Vector3(0, 1, 0);
    // dir: from the camera toward the subject; up: screen up; ax: screen right (dir × up).
    let dir;
    let up;
    if (view === 'side') {
      dir = Lf.clone().negate(); // from its left flank
      up = UP.clone();
    } else if (view === 'front') {
      dir = F.clone().negate();
      up = UP.clone();
    } else {
      dir = UP.clone().negate(); // from above, head up the image
      up = F.clone();
    }
    const ax = new T.Vector3().crossVectors(dir, up).normalize();
    // Order the wyverns as the showcase lined them up (left to right on its own camera).
    const camRight = new T.Vector3(1, 0, 0).applyQuaternion(g.camera.quaternion);
    const roots = meshes.map((m) => m.parent);
    const order = roots.map((r, i) => ({ r, m: meshes[i], k: r.getWorldPosition(new T.Vector3()).dot(camRight) })).sort((a, b) => a.k - b.k);
    const boxes = [];
    const saved = [];
    // Corners of the skinned bounding box in the mesh's own (body) frame, in world space: exact
    // extents along the body axes (a world AABB of a turned body would be inflated).
    const corners = (m) => {
      m.computeBoundingBox();
      const b = m.boundingBox;
      const c = [];
      for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) c.push(new T.Vector3(x, y, z).applyMatrix4(m.matrixWorld));
      return c;
    };
    const extent = (cs, v) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (const c of cs) {
        const d = c.dot(v);
        if (d < lo) lo = d;
        if (d > hi) hi = d;
      }
      return [lo, hi];
    };
    // Lay out along ax with `gap` metres between boxes; one ground line (side, front) or one
    // centre line (top); one depth from the camera plane (same fog and shadow for all).
    let cursor = 0;
    let ref = null;
    for (const it of order) {
      const cs = corners(it.m);
      const [lo, hi] = extent(cs, ax);
      const [u0, u1] = extent(cs, up);
      const [d0, d1] = extent(cs, dir);
      const align = view === 'top' ? (u0 + u1) / 2 : u0;
      const depth = (d0 + d1) / 2;
      if (ref === null) ref = { align, depth };
      saved.push([it.r, it.r.position.clone()]);
      it.r.position
        .addScaledVector(ax, cursor - lo)
        .addScaledVector(up, ref.align - align)
        .addScaledVector(dir, ref.depth - depth);
      it.r.updateMatrixWorld(true);
      boxes.push({ root: it.r, mesh: it.m, corners: corners(it.m) });
      cursor += hi - lo + gap;
    }
    const allCorners = boxes.flatMap((b) => b.corners);
    const [ax0, ax1] = extent(allCorners, ax);
    const [up0, up1] = extent(allCorners, up);
    const [dd0, dd1] = extent(allCorners, dir);
    const center = new T.Vector3()
      .addScaledVector(ax, (ax0 + ax1) / 2)
      .addScaledVector(up, (up0 + up1) / 2)
      .addScaledVector(dir, (dd0 + dd1) / 2);
    const radius = Math.hypot(ax1 - ax0, up1 - up0, dd1 - dd0) * 0.5 + 10;
    const cam = new T.OrthographicCamera(-1, 1, 1, -1, 0.1, radius * 4);
    cam.position.copy(center).addScaledVector(dir, -radius * 1.5);
    cam.up.copy(up);
    cam.lookAt(center);
    cam.updateMatrixWorld();
    const margin = o.margin ?? 0.06;
    const ppm = Math.min((W * (1 - 2 * margin)) / (ax1 - ax0), (H * (1 - 2 * margin)) / (up1 - up0));
    const hw = W / 2 / ppm;
    const hh = H / 2 / ppm;
    cam.left = -hw;
    cam.right = hw;
    cam.top = hh;
    cam.bottom = -hh;
    cam.updateProjectionMatrix();
    const toPx = (p) => {
      const v = p.clone().project(cam);
      return { x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H };
    };
    const layout = boxes.map((b) => {
      const c = b.corners.map(toPx);
      return { x0: Math.min(...c.map((p) => p.x)), x1: Math.max(...c.map((p) => p.x)), y0: Math.min(...c.map((p) => p.y)), y1: Math.max(...c.map((p) => p.y)) };
    });
    // The ground line (side/front: the common foot level; top: the bottom of the frame).
    const ground = toPx(center.clone().addScaledVector(up, (view === 'top' ? up0 : ref.align) - center.dot(up)));
    // Only the wyverns and the lights: layer 31 (shadows keep using layer 0).
    const lay31 = C.isolateWyverns(meshes);
    cam.layers.set(31);
    const prevBg = g.scene.background;
    const prevOverride = g.scene.overrideMaterial;
    C._orthoRestore = () => {
      lay31();
      g.scene.background = prevBg;
      g.scene.overrideMaterial = prevOverride;
      for (const [r, p] of saved) {
        r.position.copy(p);
        r.updateMatrixWorld(true);
      }
    };
    if (o.matte) {
      g.scene.background = new T.Color(1, 1, 1);
      g.scene.overrideMaterial = C._black ?? (C._black = new T.MeshBasicMaterial({ color: 0x000000, side: T.DoubleSide }));
      g.renderer.renderRaw(g.scene, cam);
    } else {
      g.scene.background = new T.Color(o.bg ?? '#7d8590');
      R.render(g.scene, cam, 0);
    }
    return { view, ppm: +ppm.toFixed(3), ground, layout, size: `${W}x${H}` };
  };

  C.orthoRestore = () => {
    if (C._orthoRestore) C._orthoRestore();
    C._orthoRestore = null;
  };

  // --- Feet, metrics, spans ---------------------------------------------------------------------

  const FOOT_NAMES = ['LH', 'RH', 'LF', 'RF'];

  /** Per foot (LH, RH, LF, RF): stance or swing, and where it is on screen. */
  C.feet = () => {
    const A = g.wyvern.animator;
    const s = g.renderer.size;
    let feet = null;
    try {
      if (typeof A.footContacts === 'function') {
        const fc = A.footContacts();
        if (Array.isArray(fc) && fc.length === 4) feet = fc.map((f) => ({ swing: !(f.contact ?? f.planted ?? !f.swinging), pos: f.pos ?? f.position }));
      }
    } catch {
      feet = null;
    }
    if (!feet) feet = A.gait.feet.map((f) => ({ swing: f.swinging, pos: f.pos }));
    return feet.map((f, i) => {
      const p = f.pos.clone().project(g.camera);
      return { name: FOOT_NAMES[i], swing: !!f.swing, x: +((p.x * 0.5 + 0.5) * s.x).toFixed(1), y: +((-p.y * 0.5 + 0.5) * s.y).toFixed(1) };
    });
  };

  /** Tail bend and wing-stroke geometry of the player's wyvern this frame. */
  C.metrics = (names = ['tail', 'stroke']) => {
    const W = g.wyvern;
    const rig = W.rigDef;
    const bones = W.skinnedMesh.skeleton.bones;
    const q = W.group.getWorldQuaternion(W.group.quaternion.clone());
    const F = _v().set(0, 0, 1).applyQuaternion(q);
    const U = _v().set(0, 1, 0).applyQuaternion(q);
    const Lt = _v().set(1, 0, 0).applyQuaternion(q);
    const out = {};
    if (names.includes('tail')) {
      const pts = rig.idx.tail.map((i) => bones[i].getWorldPosition(_v()));
      const last = rig.idx.tail[rig.idx.tail.length - 1];
      pts.push(_v().subVectors(rig.tailTip, rig.bones[last].pos).applyMatrix4(bones[last].matrixWorld));
      const seg = [];
      for (let i = 1; i < pts.length; i++) seg.push(_v().subVectors(pts[i], pts[i - 1]).normalize());
      let maxBend = 0;
      let at = -1;
      const bends = [];
      for (let i = 1; i < seg.length; i++) {
        const a = (Math.acos(Math.max(-1, Math.min(1, seg[i - 1].dot(seg[i])))) * 180) / Math.PI;
        bends.push(+a.toFixed(1));
        if (a > maxBend) {
          maxBend = a;
          at = i;
        }
      }
      const d = _v().subVectors(pts[pts.length - 1], pts[0]).normalize();
      out.tail = {
        maxBend: +maxBend.toFixed(1),
        at,
        bends,
        tipPitch: +((Math.asin(Math.max(-1, Math.min(1, d.dot(U)))) * 180) / Math.PI).toFixed(1),
        tipYaw: +((Math.atan2(d.dot(Lt), -d.dot(F)) * 180) / Math.PI).toFixed(1),
      };
    }
    if (names.includes('stroke')) {
      const tl = _v();
      const tr = _v();
      W.getWingtips(tl, tr);
      const sl = bones[rig.idx.wings[0].humerus].getWorldPosition(_v());
      const sr = bones[rig.idx.wings[1].humerus].getWorldPosition(_v());
      const el = (tip, sh, side) => {
        const d = _v().subVectors(tip, sh);
        return { elev: +((Math.atan2(d.dot(U), Math.abs(d.dot(Lt))) * 180) / Math.PI).toFixed(1), fwd: +d.dot(F).toFixed(2), lat: +(d.dot(Lt) * side).toFixed(2) };
      };
      const span = g.player.breed.wingspan;
      out.stroke = { L: el(tl, sl, 1), R: el(tr, sr, -1), sep: +(tl.distanceTo(tr) / span).toFixed(3), phase: +g.player.wyvernPose.flapPhase.toFixed(3) };
    }
    return out;
  };

  /** On-screen wingspan (tip to tip) and the rider's height, in pixels and frame fractions. */
  C.spans = () => {
    const s = g.renderer.size;
    const tl = _v();
    const tr = _v();
    g.wyvern.getWingtips(tl, tr);
    const px = (p) => {
      const v = p.clone().project(g.camera);
      return [(v.x * 0.5 + 0.5) * s.x, (-v.y * 0.5 + 0.5) * s.y];
    };
    const a = px(tl);
    const b = px(tr);
    const spanPx = Math.hypot(a[0] - b[0], a[1] - b[1]);
    let riderPx = null;
    const rm = [];
    g.rider.group.traverse((o) => {
      if (o.isSkinnedMesh && visibleChain(o)) rm.push(o);
    });
    if (rm.length) {
      let y0 = Infinity;
      let y1 = -Infinity;
      for (const m of rm) {
        m.computeBoundingBox();
        const bb = m.boundingBox.clone().applyMatrix4(m.matrixWorld);
        for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) {
          const p = px(_v().set(x, y, z));
          y0 = Math.min(y0, p[1]);
          y1 = Math.max(y1, p[1]);
        }
      }
      riderPx = +(y1 - y0).toFixed(1);
    }
    return { spanPx: +spanPx.toFixed(1), spanFrac: +(spanPx / s.x).toFixed(4), riderPx, width: s.x, height: s.y, breed: g.player.breed.id, wingspan: g.player.breed.wingspan, dist: +g.camera.position.distanceTo(g.player.wyvernPose.position).toFixed(1) };
  };

  // --- GPU timing -------------------------------------------------------------------------------

  /**
   * Time the wyverns' share of a frame. With EXT_disjoint_timer_query_webgl2 (a real GPU): each
   * frame is rendered twice, with and without the wyverns, inside a TIME_ELAPSED query (shadow,
   * scene and post passes), and the main-pass wyvern draws are also timed one by one. Without it
   * (SwiftShader) the same with- and without-wyvern frames are timed on the wall clock after
   * gl.finish(): a CPU-rasterizer proxy, only good for before/after comparisons on one machine.
   */
  C.gpu = async (o = {}) => {
    // `detail`: time the wyvern materials compiled at another shading level (DW_DETAIL 0..2,
    // materials.ts) without the LOD chain having to pick it; restored afterwards.
    if (o.detail !== undefined) {
      const mats = C.wyvernMaterials();
      const saved = mats.map((m) => [m, m.defines?.DW_DETAIL]);
      for (const m of mats) {
        m.defines = { ...(m.defines ?? {}), DW_DETAIL: o.detail };
        m.needsUpdate = true;
      }
      try {
        const r = await C.gpu({ ...o, detail: undefined });
        return { ...r, detail: o.detail };
      } finally {
        for (const [m, d] of saved) {
          if (d === undefined) delete m.defines.DW_DETAIL;
          else m.defines.DW_DETAIL = d;
          m.needsUpdate = true;
        }
      }
    }
    const gl3 = R.gl;
    const ctx = gl3.getContext();
    const ext = ctx.getExtension('EXT_disjoint_timer_query_webgl2');
    const frames = o.frames ?? 60;
    const warm = o.warm ?? 20;
    const meshes = C.wyvernMeshes();
    const roots = [...new Set(meshes.map((m) => m.parent))];
    const setWyv = (v) => {
      for (const r of roots) r.visible = v;
    };
    const renderOnce = () => R.render(g.scene, g.camera, 0);
    for (let i = 0; i < warm; i++) renderOnce();
    const info = { frames, wyverns: meshes.length, size: `${ctx.drawingBufferWidth}x${ctx.drawingBufferHeight}`, quality: g.settings.quality, renderer: null, available: !!ext };
    const dbg = ctx.getExtension('WEBGL_debug_renderer_info');
    info.renderer = dbg ? ctx.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : ctx.getParameter(ctx.RENDERER);
    const median = (a) => {
      const s2 = [...a].sort((x, y) => x - y);
      return s2.length ? s2[Math.floor(s2.length / 2)] : null;
    };
    // Software rasterizers expose the extension but report 0 ns: time them on the wall clock.
    info.software = /swiftshader|llvmpipe|software/i.test(String(info.renderer));
    if (ext && !info.software) {
      const wait = () => new Promise((r) => setTimeout(r, 4));
      const timeFrame = async (withW) => {
        setWyv(withW);
        const qq = ctx.createQuery();
        ctx.beginQuery(ext.TIME_ELAPSED_EXT, qq);
        renderOnce();
        ctx.endQuery(ext.TIME_ELAPSED_EXT);
        setWyv(true);
        for (let n = 0; n < 500; n++) {
          if (ctx.getQueryParameter(qq, ctx.QUERY_RESULT_AVAILABLE)) break;
          await wait();
        }
        const disjoint = ctx.getParameter(ext.GPU_DISJOINT_EXT);
        const ns = ctx.getQueryParameter(qq, ctx.QUERY_RESULT);
        ctx.deleteQuery(qq);
        return disjoint ? null : ns / 1e6;
      };
      const on = [];
      const off = [];
      for (let i = 0; i < frames; i++) {
        const a = await timeFrame(true);
        const b = await timeFrame(false);
        if (a !== null) on.push(a);
        if (b !== null) off.push(b);
      }
      // Per-draw main-pass timing of the wyvern meshes (one query per draw).
      const per = [];
      const pending = [];
      const hooks = meshes.map((m) => [m, m.onBeforeRender, m.onAfterRender]);
      let active = null;
      for (const m of meshes) {
        m.onBeforeRender = () => {
          if (active) return;
          active = ctx.createQuery();
          ctx.beginQuery(ext.TIME_ELAPSED_EXT, active);
        };
        m.onAfterRender = () => {
          if (!active) return;
          ctx.endQuery(ext.TIME_ELAPSED_EXT);
          pending.push(active);
          active = null;
        };
      }
      for (let i = 0; i < Math.min(frames, 30); i++) {
        renderOnce();
        const frameQs = pending.splice(0);
        let sum = 0;
        for (const qq of frameQs) {
          for (let n = 0; n < 500 && !ctx.getQueryParameter(qq, ctx.QUERY_RESULT_AVAILABLE); n++) await wait();
          sum += ctx.getQueryParameter(qq, ctx.QUERY_RESULT) / 1e6;
          ctx.deleteQuery(qq);
        }
        per.push(sum);
      }
      for (const [m, b, a] of hooks) {
        m.onBeforeRender = b;
        m.onAfterRender = a;
      }
      // A driver that answers every query with 0 has no usable timer: fall back to the wall clock.
      if (median(on) > 0) {
        return { ...info, method: 'timer-query', frameMs: median(on), frameWithoutWyvernsMs: median(off), wyvernMs: on.length && off.length ? +(median(on) - median(off)).toFixed(3) : null, mainPassDrawsMs: +median(per).toFixed(3) };
      }
    }
    const px = new Uint8Array(4);
    const timeFrame = (withW) => {
      setWyv(withW);
      const t0 = performance.now();
      renderOnce();
      ctx.readPixels(0, 0, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, px); // forces completion
      const t = performance.now() - t0;
      setWyv(true);
      return t;
    };
    const on = [];
    const off = [];
    // isoOnly: skip the whole-frame timing (slow on a CPU rasterizer) and keep the wyvern-only one.
    for (let i = 0; i < (o.isoOnly ? 0 : frames); i++) {
      on.push(timeFrame(true));
      off.push(timeFrame(false));
    }
    const mOn = on.length ? median(on) : 0;
    const mOff = off.length ? median(off) : 0;
    // The whole-frame difference drowns in the world's cost on a shared CPU rasterizer, so also
    // time the wyverns alone: the camera on the isolation layer, no background, no shadow-map
    // update, scene pass only, against the same render with the wyverns hidden. That isolates the
    // wyvern draws (vertex + fragment work): the proxy to compare shader cost before and after.
    const iso = { on: [], off: [] };
    {
      const undo = C.isolateWyverns(meshes);
      const layers = g.camera.layers.mask;
      const bg = g.scene.background;
      const autoShadow = gl3.shadowMap.autoUpdate;
      try {
        g.camera.layers.set(31);
        g.scene.background = null;
        gl3.shadowMap.autoUpdate = false;
        gl3.setRenderTarget(null);
        const timeIso = (withW) => {
          setWyv(withW);
          const t0 = performance.now();
          gl3.clear(true, true, true);
          gl3.render(g.scene, g.camera);
          ctx.readPixels(0, 0, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, px); // forces completion
          const t = performance.now() - t0;
          setWyv(true);
          return t;
        };
        for (let i = 0; i < 2; i++) timeIso(true);
        for (let i = 0; i < frames * 2; i++) {
          iso.on.push(timeIso(true));
          iso.off.push(timeIso(false));
        }
      } finally {
        gl3.setRenderTarget(null);
        gl3.shadowMap.autoUpdate = autoShadow;
        g.scene.background = bg;
        g.camera.layers.mask = layers;
        undo();
      }
    }
    const isoOn = median(iso.on);
    const isoOff = median(iso.off);
    return {
      ...info,
      method: 'wallclock-swiftshader-proxy',
      frameMs: +mOn.toFixed(2),
      frameWithoutWyvernsMs: +mOff.toFixed(2),
      wyvernMs: +(mOn - mOff).toFixed(2),
      wyvernOnlyMs: +(isoOn - isoOff).toFixed(2),
      wyvernOnlySpread: [+Math.min(...iso.on).toFixed(1), +Math.max(...iso.on).toFixed(1)],
    };
  };

  /** Extra wyverns for timing scenes: copies of the player's look gliding at the given offsets. */
  C.addWyverns = async (offsets) => {
    const T = await C.loadThree();
    const Ctor = g.wyvern.constructor;
    const look = { ...g.save.data.wyvern };
    const P = g.player.wyvernPose;
    const fwd = new T.Vector3(0, 0, 1).applyQuaternion(P.orientation);
    const left = new T.Vector3(1, 0, 0).applyQuaternion(P.orientation);
    C.extra = C.extra ?? [];
    for (const [ahead, side, upm] of offsets) {
      const w = new Ctor(look, {});
      g.scene.add(w.group);
      const pose = { ...P, position: P.position.clone().addScaledVector(fwd, ahead).addScaledVector(left, side).add(new T.Vector3(0, upm ?? 0, 0)), orientation: P.orientation.clone(), velocity: P.velocity.clone(), angularVelocity: P.angularVelocity.clone(), lookTarget: P.lookTarget.clone() };
      for (let i = 0; i < 10; i++) w.update(1 / 30, pose);
      C.extra.push(w);
    }
    return C.extra.length;
  };
})();
