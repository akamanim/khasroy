import * as T from "three";
import type { CoreState, CoreEvolution } from "./core";

type Reader = () => { state: CoreState; evolution: CoreEvolution };
type EdgePair = { a: number; b: number };
type Tendril = {
  line: T.Line;
  attr: T.BufferAttribute;
  a: number;
  b: number;
  phase: number;
  bend: T.Vector3;
};

type Membrane = {
  lines: T.LineSegments;
  attr: T.BufferAttribute;
  base: Float32Array;
  phase: number;
  axis: number;
};

export function createCoreScene(canvas: HTMLCanvasElement, read: Reader) {
  const renderer = new T.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.28;

  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(32, 1, 0.1, 60);
  camera.position.set(0, 0, 9.15);

  const root = new T.Group();
  root.scale.set(1.28, 0.92, 1.0);
  scene.add(root);

  const geometries: T.BufferGeometry[] = [];
  const materials: T.Material[] = [];
  const geometry = <G extends T.BufferGeometry>(g: G) => (geometries.push(g), g);
  const material = <M extends T.Material>(m: M) => (materials.push(m), m);
  const additive = {
    transparent: true,
    depthWrite: false,
    blending: T.AdditiveBlending,
  } as const;

  const compact = window.matchMedia("(max-width: 600px), (pointer: coarse)");
  const nodeCount = compact.matches ? 82 : 132;

  // Four overlapping lobes make one irregular cognition field instead of a ball.
  const lobeCenters = [
    new T.Vector3(-0.78, 0.18, -0.12),
    new T.Vector3(0.72, 0.25, 0.1),
    new T.Vector3(0.04, -0.72, -0.06),
    new T.Vector3(0.0, 0.76, 0.16),
  ];
  const baseNodes: T.Vector3[] = [];
  const currentNodes: T.Vector3[] = [];
  const phases = new Float32Array(nodeCount * 3);

  for (let i = 0; i < nodeCount; i++) {
    const c = lobeCenters[i % lobeCenters.length];
    const u = i * 2.39996323;
    const v = i * 1.61803399;
    const radius = 0.18 + ((i * 37) % 97) / 97 * 0.78;
    const stretch = 0.72 + 0.28 * Math.sin(i * 0.71 + 0.4);
    const p = new T.Vector3(
      c.x + Math.cos(u) * Math.sin(v) * radius * 1.18,
      c.y + Math.sin(u * 1.23) * radius * 0.86,
      c.z + Math.cos(v * 0.91) * radius * stretch,
    );
    p.x += Math.sin(i * 0.31) * 0.12;
    p.y += Math.cos(i * 0.27) * 0.08;
    p.z += Math.sin(i * 0.19) * 0.09;
    baseNodes.push(p);
    currentNodes.push(p.clone());
    phases[i * 3] = (i * 0.173) % (Math.PI * 2);
    phases[i * 3 + 1] = (i * 0.319 + 1.7) % (Math.PI * 2);
    phases[i * 3 + 2] = (i * 0.427 + 3.2) % (Math.PI * 2);
  }

  // Fixed topology, moving geometry. Connections follow moving nodes every frame.
  const edgePairs: EdgePair[] = [];
  for (let i = 0; i < baseNodes.length; i++) {
    const nearest = baseNodes
      .map((p, j) => ({ j, d: i === j ? Infinity : p.distanceToSquared(baseNodes[i]) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 4);
    for (const n of nearest) {
      if (n.j <= i || n.d > 0.86) continue;
      edgePairs.push({ a: i, b: n.j });
    }
  }

  const edgePositions = new Float32Array(edgePairs.length * 6);
  const edgeGeometry = geometry(new T.BufferGeometry());
  const edgeAttr = new T.BufferAttribute(edgePositions, 3);
  edgeGeometry.setAttribute("position", edgeAttr);
  const edgeMaterial = material(
    new T.LineBasicMaterial({ color: 0x42cfff, opacity: 0.2, ...additive }),
  );
  const network = new T.LineSegments(edgeGeometry, edgeMaterial);
  root.add(network);

  // Second, fainter layer of long-range connections creates semi-transparent webs.
  const webPairs: EdgePair[] = [];
  for (let i = 0; i < baseNodes.length; i += 2) {
    const j = (i * 7 + 19) % baseNodes.length;
    if (baseNodes[i].distanceTo(baseNodes[j]) < 1.85) webPairs.push({ a: i, b: j });
  }
  const webPositions = new Float32Array(webPairs.length * 6);
  const webGeometry = geometry(new T.BufferGeometry());
  const webAttr = new T.BufferAttribute(webPositions, 3);
  webGeometry.setAttribute("position", webAttr);
  const webMaterial = material(
    new T.LineBasicMaterial({ color: 0x5578ff, opacity: 0.08, ...additive }),
  );
  const web = new T.LineSegments(webGeometry, webMaterial);
  root.add(web);

  // Neural points are not stars: larger local nodes, concentrated only inside the field.
  const nodePositions = new Float32Array(nodeCount * 3);
  const nodeGeometry = geometry(new T.BufferGeometry());
  const nodeAttr = new T.BufferAttribute(nodePositions, 3);
  nodeGeometry.setAttribute("position", nodeAttr);
  const nodeMaterial = material(
    new T.PointsMaterial({
      color: 0xd8fbff,
      size: compact.matches ? 0.052 : 0.038,
      opacity: 0.76,
      sizeAttenuation: true,
      ...additive,
    }),
  );
  const nodePoints = new T.Points(nodeGeometry, nodeMaterial);
  root.add(nodePoints);

  // Liquid-gravity bridges: thin bezier-like strands sag and drift through the field.
  const tendrils: Tendril[] = [];
  const tendrilCount = compact.matches ? 12 : 24;
  const tendrilSegments = 28;
  for (let i = 0; i < tendrilCount; i++) {
    const a = (i * 9 + 5) % nodeCount;
    const b = (i * 17 + 31) % nodeCount;
    const positions = new Float32Array(tendrilSegments * 3);
    const g = geometry(new T.BufferGeometry());
    const attr = new T.BufferAttribute(positions, 3);
    g.setAttribute("position", attr);
    const m = material(
      new T.LineBasicMaterial({
        color: i % 6 === 0 ? 0x8b76ff : i % 3 === 0 ? 0x9ff7ff : 0x36bfff,
        opacity: 0.12,
        ...additive,
      }),
    );
    const line = new T.Line(g, m);
    root.add(line);
    tendrils.push({
      line,
      attr,
      a,
      b,
      phase: i * 0.71,
      bend: new T.Vector3(
        Math.sin(i * 0.91) * 0.48,
        Math.cos(i * 0.67) * 0.36,
        Math.sin(i * 1.17) * 0.42,
      ),
    });
  }

  // Three open membrane nets. They cross the field; they never enclose it.
  const membranes: Membrane[] = [];
  const rows = compact.matches ? 7 : 10;
  const cols = compact.matches ? 10 : 15;
  for (let layer = 0; layer < 3; layer++) {
    const segments: number[] = [];
    const width = 3.1 - layer * 0.23;
    const height = 2.15 - layer * 0.12;
    const point = (r: number, c: number) => {
      const x = (c / (cols - 1) - 0.5) * width;
      const y = (r / (rows - 1) - 0.5) * height;
      const z = Math.sin(x * (1.4 + layer * 0.2) + layer) * 0.16 + Math.cos(y * 1.7 - layer) * 0.1;
      return [x, y, z] as const;
    };
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols - 1; c++) {
        segments.push(...point(r, c), ...point(r, c + 1));
      }
    }
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows - 1; r++) {
        segments.push(...point(r, c), ...point(r + 1, c));
      }
    }
    const base = new Float32Array(segments);
    const g = geometry(new T.BufferGeometry());
    const attr = new T.BufferAttribute(base.slice(), 3);
    g.setAttribute("position", attr);
    const m = material(
      new T.LineBasicMaterial({
        color: layer === 1 ? 0x6f6dff : 0x50dfff,
        opacity: 0.055 + layer * 0.018,
        ...additive,
      }),
    );
    const lines = new T.LineSegments(g, m);
    lines.rotation.set(0.22 + layer * 0.58, 0.35 + layer * 0.72, -0.3 + layer * 0.44);
    lines.position.set((layer - 1) * 0.16, (1 - layer) * 0.09, (layer - 1) * 0.11);
    root.add(lines);
    membranes.push({ lines, attr, base, phase: layer * 1.91, axis: layer });
  }

  // Local light blooms only at active zones; no single central core.
  const hotspotMaterial = material(
    new T.ShaderMaterial({
      ...additive,
      uniforms: { uEnergy: { value: 0.2 }, uTint: { value: new T.Color(0x66e7ff) } },
      vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader: `varying vec2 vUv;uniform float uEnergy;uniform vec3 uTint;void main(){float r=length(vUv-.5)*2.;float a=exp(-r*r*6.0)*(.10+.48*uEnergy);gl_FragColor=vec4(uTint,a);}`,
    }),
  );
  const hotspotIndices = [7, 29, 53, 81, 104].filter((i) => i < nodeCount);
  const hotspots = hotspotIndices.map((index, i) => {
    const mat = hotspotMaterial.clone();
    materials.push(mat);
    const mesh = new T.Mesh(geometry(new T.PlaneGeometry(0.7 + i * 0.04, 0.7 + i * 0.04)), mat);
    root.add(mesh);
    return { mesh, mat, index, phase: i * 1.67 };
  });

  // Impulses ride the thin liquid bridges.
  const impulseGeometry = geometry(new T.SphereGeometry(0.022, 8, 6));
  const impulses = tendrils.slice(0, compact.matches ? 10 : 20).map((t, i) => {
    const mat = material(
      new T.MeshBasicMaterial({
        color: i % 5 === 0 ? 0xae8cff : i % 3 === 0 ? 0xe5ffff : 0x5ce7ff,
        opacity: 0.76,
        ...additive,
      }),
    );
    const mesh = new T.Mesh(impulseGeometry, mat);
    root.add(mesh);
    return { mesh, mat, tendril: t, phase: (i * 0.149) % 1, speed: 0.16 + (i % 6) * 0.035 };
  });

  const key = new T.PointLight(0x58d6ff, 10, 12, 2);
  key.position.set(2.4, 1.7, 3.5);
  scene.add(key);
  const rim = new T.PointLight(0x5367ff, 7, 11, 2);
  rim.position.set(-2.7, -1.2, 2.0);
  scene.add(rim);

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  let frame = 0;
  let last = 0;
  let elapsed = 0;
  let energy = 0.2;
  let visible = true;
  let disposed = false;
  let px = 0;
  let py = 0;

  const pointer = (event: PointerEvent) => {
    if (event.pointerType === "touch") return;
    const rect = canvas.getBoundingClientRect();
    px = (event.clientX - rect.left) / Math.max(rect.width, 1) - 0.5;
    py = (event.clientY - rect.top) / Math.max(rect.height, 1) - 0.5;
  };
  const leave = () => {
    px = 0;
    py = 0;
  };

  const resize = new ResizeObserver(() => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, compact.matches ? 1.2 : 1.75));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    camera.position.z = Math.max(9.15, 5.15 / camera.aspect);
    wake();
  });

  const tmpA = new T.Vector3();
  const tmpB = new T.Vector3();
  const tmpC = new T.Vector3();

  function updateNodes(time: number, state: CoreState) {
    const thinking = state === "thinking" ? 1 : state === "responding" ? 0.72 : state === "listening" ? 0.42 : 0.18;
    const amp = 0.035 + thinking * 0.105;
    const speed = 0.36 + thinking * 0.94;
    for (let i = 0; i < nodeCount; i++) {
      const b = baseNodes[i];
      const p0 = phases[i * 3];
      const p1 = phases[i * 3 + 1];
      const p2 = phases[i * 3 + 2];
      const driftX = Math.sin(time * speed + p0 + b.y * 1.7) * amp;
      const driftY = Math.cos(time * (speed * 0.83) + p1 + b.x * 1.4) * amp * 0.76;
      const driftZ = Math.sin(time * (speed * 0.69) + p2 + b.x - b.y) * amp * 0.9;
      const breathe = 1 + Math.sin(time * 0.31 + i * 0.07) * (0.012 + energy * 0.02);
      currentNodes[i].set(
        b.x * breathe + driftX,
        b.y * breathe + driftY,
        b.z * breathe + driftZ,
      );
      nodeAttr.setXYZ(i, currentNodes[i].x, currentNodes[i].y, currentNodes[i].z);
    }
    nodeAttr.needsUpdate = true;
  }

  function updateEdges() {
    edgePairs.forEach((pair, i) => {
      const a = currentNodes[pair.a];
      const b = currentNodes[pair.b];
      edgeAttr.setXYZ(i * 2, a.x, a.y, a.z);
      edgeAttr.setXYZ(i * 2 + 1, b.x, b.y, b.z);
    });
    edgeAttr.needsUpdate = true;
    webPairs.forEach((pair, i) => {
      const a = currentNodes[pair.a];
      const b = currentNodes[pair.b];
      webAttr.setXYZ(i * 2, a.x, a.y, a.z);
      webAttr.setXYZ(i * 2 + 1, b.x, b.y, b.z);
    });
    webAttr.needsUpdate = true;
  }

  function tendrilPoint(tendril: Tendril, t: number, time: number, out: T.Vector3) {
    const a = currentNodes[tendril.a];
    const b = currentNodes[tendril.b];
    tmpA.copy(a).lerp(b, t);
    const gravityWave = Math.sin(t * Math.PI) * (0.22 + energy * 0.12);
    const lateral = Math.sin(t * Math.PI * 2 + time * 0.55 + tendril.phase) * 0.075;
    tmpB.copy(tendril.bend).multiplyScalar(gravityWave);
    tmpC.set(
      Math.cos(time * 0.21 + tendril.phase) * lateral,
      -gravityWave * (0.28 + 0.16 * Math.sin(time * 0.17 + tendril.phase)),
      Math.sin(time * 0.19 + tendril.phase) * lateral,
    );
    return out.copy(tmpA).add(tmpB).add(tmpC);
  }

  function updateTendrils(time: number) {
    const p = new T.Vector3();
    tendrils.forEach((tendril) => {
      const count = tendril.attr.count;
      for (let i = 0; i < count; i++) {
        tendrilPoint(tendril, i / Math.max(1, count - 1), time, p);
        tendril.attr.setXYZ(i, p.x, p.y, p.z);
      }
      tendril.attr.needsUpdate = true;
      const mat = tendril.line.material as T.LineBasicMaterial;
      mat.opacity = 0.055 + energy * 0.13;
    });
  }

  function updateMembranes(time: number) {
    membranes.forEach((membrane, layer) => {
      for (let i = 0; i < membrane.attr.count; i++) {
        const x = membrane.base[i * 3];
        const y = membrane.base[i * 3 + 1];
        const z = membrane.base[i * 3 + 2];
        const wave = Math.sin(x * 2.15 + time * 0.58 + membrane.phase) * Math.cos(y * 2.55 - time * 0.44 + layer);
        const pull = Math.sin(time * 0.23 + membrane.phase) * 0.035;
        membrane.attr.setXYZ(
          i,
          x + wave * 0.035,
          y + Math.sin(x * 1.45 + time * 0.34 + layer) * 0.028,
          z + wave * (0.08 + energy * 0.045) + pull,
        );
      }
      membrane.attr.needsUpdate = true;
      const mat = membrane.lines.material as T.LineBasicMaterial;
      mat.opacity = 0.035 + layer * 0.012 + energy * 0.055;
      if (!reduced.matches) {
        membrane.lines.rotation.z += (layer % 2 ? -1 : 1) * 0.0007 * (1 + energy);
      }
    });
  }

  function draw(now: number) {
    frame = 0;
    if (disposed || !visible || document.hidden) return;

    const interval = compact.matches ? 1000 / 30 : 1000 / 60;
    if (now - last < interval - 1) {
      frame = requestAnimationFrame(draw);
      return;
    }

    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    const { state } = read();
    const target = state === "thinking" ? 1 : state === "responding" ? 0.78 : state === "listening" ? 0.45 : 0.2;
    energy += (target - energy) * (1 - Math.exp(-dt * 5.2));
    if (!reduced.matches) elapsed += dt;

    root.rotation.y += ((reduced.matches ? 0 : px * 0.18) - root.rotation.y) * 0.04;
    root.rotation.x += ((reduced.matches ? 0 : py * 0.13) - root.rotation.x) * 0.04;

    updateNodes(elapsed, state);
    updateEdges();
    updateTendrils(elapsed);
    updateMembranes(elapsed);

    edgeMaterial.opacity = 0.11 + energy * 0.22;
    webMaterial.opacity = 0.035 + energy * 0.065;
    nodeMaterial.opacity = 0.5 + energy * 0.42;
    key.intensity = 7 + energy * 12;
    rim.intensity = 5 + energy * 8;

    hotspots.forEach((hotspot, i) => {
      const p = currentNodes[hotspot.index];
      hotspot.mesh.position.copy(p);
      hotspot.mesh.position.z += 0.12;
      hotspot.mesh.lookAt(camera.position);
      const local = Math.max(0, Math.sin(elapsed * (0.9 + i * 0.13) + hotspot.phase));
      hotspot.mat.uniforms.uEnergy.value = energy * (0.34 + local * (state === "thinking" ? 1.45 : 0.62));
      hotspot.mesh.scale.setScalar(0.75 + local * 0.28 + energy * 0.08);
    });

    const impulsePoint = new T.Vector3();
    impulses.forEach((impulse, i) => {
      const boost = state === "thinking" ? 2.8 : state === "responding" ? 1.75 : state === "listening" ? 1.1 : 0.55;
      const t = (impulse.phase + elapsed * impulse.speed * boost) % 1;
      tendrilPoint(impulse.tendril, t, elapsed, impulsePoint);
      impulse.mesh.position.copy(impulsePoint);
      const flare = Math.sin(t * Math.PI);
      impulse.mat.opacity = flare * (0.28 + energy * 0.72);
      impulse.mesh.scale.setScalar(0.5 + flare * (0.65 + energy * 0.9));
      if (state === "thinking" && i % 4 === 0) {
        impulse.mesh.scale.multiplyScalar(1.18 + Math.sin(elapsed * 8 + i) * 0.14);
      }
    });

    renderer.render(scene, camera);
    if (!reduced.matches) frame = requestAnimationFrame(draw);
  }

  function wake() {
    if (!disposed && !frame) {
      last = performance.now() - 34;
      frame = requestAnimationFrame(draw);
    }
  }

  const visibility = () => {
    if (document.hidden) {
      cancelAnimationFrame(frame);
      frame = 0;
    } else wake();
  };

  const observer = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) wake();
    else {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  });

  canvas.addEventListener("pointermove", pointer);
  canvas.addEventListener("pointerleave", leave);
  document.addEventListener("visibilitychange", visibility);
  reduced.addEventListener("change", wake);
  resize.observe(canvas);
  observer.observe(canvas);
  wake();

  return {
    wake,
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      observer.disconnect();
      canvas.removeEventListener("pointermove", pointer);
      canvas.removeEventListener("pointerleave", leave);
      document.removeEventListener("visibilitychange", visibility);
      reduced.removeEventListener("change", wake);
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      renderer.dispose();
    },
  };
}
