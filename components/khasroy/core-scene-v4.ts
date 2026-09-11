import * as T from "three";
import type { CoreState, CoreEvolution } from "./core";

export function createCoreScene(
  canvas: HTMLCanvasElement,
  read: () => { state: CoreState; evolution: CoreEvolution },
) {
  const renderer = new T.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;

  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(31, 1, 0.1, 60);
  camera.position.set(0, 0.05, 8.9);
  const root = new T.Group();
  root.scale.set(1.18, 0.92, 0.96);
  scene.add(root);

  const geometries: T.BufferGeometry[] = [];
  const materials: T.Material[] = [];
  const geometry = <G extends T.BufferGeometry>(g: G) => (geometries.push(g), g);
  const material = <M extends T.Material>(m: M) => (materials.push(m), m);
  const additive = { transparent: true, depthWrite: false, blending: T.AdditiveBlending } as const;

  const key = new T.PointLight(0x47c9ff, 15, 15, 1.8);
  key.position.set(2.2, 1.8, 3.5);
  scene.add(key);
  const rim = new T.PointLight(0x465dff, 11, 13, 2);
  rim.position.set(-2.8, -1.1, 2.0);
  scene.add(rim);
  const fill = new T.PointLight(0xd7fbff, 5, 9, 2);
  fill.position.set(0, -2.4, 3.0);
  scene.add(fill);

  // Irregular cognition nodes. The shape is intentionally non-spherical.
  const nodeCount = 112;
  const nodes: T.Vector3[] = [];
  for (let i = 0; i < nodeCount; i++) {
    const a = i * 2.39996323;
    const t = (i + 0.5) / nodeCount;
    const y = (1 - 2 * t) * (1.35 + 0.18 * Math.sin(i * 0.73));
    const radial = Math.sqrt(Math.max(0, 1 - Math.min(1, (y * y) / 2.4)));
    const lobe = 0.72 + 0.25 * Math.sin(i * 1.91) + 0.13 * Math.sin(i * 0.37);
    const x = Math.cos(a) * radial * lobe * 1.55 + 0.34 * Math.sin(y * 2.3) + 0.12 * Math.sin(i * 0.41);
    const z = Math.sin(a) * radial * lobe * 1.05 + 0.28 * Math.cos(y * 2.0) + 0.11 * Math.cos(i * 0.53);
    const curl = 0.18 * Math.sin(i * 0.22 + y * 1.9);
    nodes.push(new T.Vector3(x + curl, y, z - curl * 0.5));
  }

  // Dense synaptic graph: nearest neighbors only, leaving visible cavities.
  const edges: Array<{ a: T.Vector3; b: T.Vector3 }> = [];
  const linePoints: T.Vector3[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const nearest = nodes
      .map((p, j) => ({ j, d: i === j ? Infinity : p.distanceToSquared(nodes[i]) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 3 + (i % 2));
    for (const n of nearest) {
      if (n.j < i || n.d > 0.92) continue;
      edges.push({ a: nodes[i].clone(), b: nodes[n.j].clone() });
      linePoints.push(nodes[i], nodes[n.j]);
    }
  }

  const synapseMaterial = material(new T.LineBasicMaterial({ color: 0x239dff, opacity: 0.26, ...additive }));
  const synapses = new T.LineSegments(geometry(new T.BufferGeometry().setFromPoints(linePoints)), synapseMaterial);
  root.add(synapses);

  const neuronGeometry = geometry(new T.SphereGeometry(0.026, 8, 6));
  const neuronMaterial = material(new T.MeshBasicMaterial({ color: 0xbffaff, opacity: 0.82, ...additive }));
  const neurons = new T.Group();
  root.add(neurons);
  for (let i = 0; i < nodes.length; i++) {
    const m = new T.Mesh(neuronGeometry, neuronMaterial);
    m.position.copy(nodes[i]);
    m.scale.setScalar(i % 13 === 0 ? 2.6 : i % 5 === 0 ? 1.55 : 0.7 + (i % 3) * 0.15);
    neurons.add(m);
  }

  // Volumetric dust follows the same asymmetric field instead of a sphere.
  const compact = window.matchMedia("(max-width: 600px), (pointer: coarse)");
  const dustCount = compact.matches ? 1250 : 3100;
  const dustPositions = new Float32Array(dustCount * 3);
  for (let i = 0; i < dustCount; i++) {
    const base = nodes[(i * 17 + 11) % nodes.length];
    const r = 0.06 + ((i * 37) % 100) / 100 * 0.42;
    const a = i * 1.6180339;
    const b = i * 2.39996323;
    dustPositions.set([
      base.x + Math.cos(a) * Math.sin(b) * r * 1.2,
      base.y + Math.sin(a * 1.3) * r * 0.8,
      base.z + Math.cos(b * 0.9) * r,
    ], i * 3);
  }
  const dustGeometry = geometry(new T.BufferGeometry());
  dustGeometry.setAttribute("position", new T.BufferAttribute(dustPositions, 3));
  const dustMaterial = material(new T.PointsMaterial({ color: 0x54dfff, size: compact.matches ? 0.022 : 0.014, opacity: 0.42, sizeAttenuation: true, ...additive }));
  const dust = new T.Points(dustGeometry, dustMaterial);
  root.add(dust);

  // Semi-transparent membrane sheets crossing the field, not enclosing it.
  const membranes: Array<{ mesh: T.Mesh; mat: T.ShaderMaterial; phase: number }> = [];
  for (let layer = 0; layer < 3; layer++) {
    const g = geometry(new T.PlaneGeometry(3.5 - layer * 0.28, 2.55 - layer * 0.16, 34, 24));
    const pos = g.attributes.position as T.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      const z = Math.sin(x * (1.6 + layer * 0.24) + layer) * 0.18 + Math.cos(y * (2.0 + layer * 0.18)) * 0.13;
      pos.setZ(i, z + Math.sin((x + y) * 2.5) * 0.05);
    }
    g.computeVertexNormals();
    const mat = material(new T.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: T.DoubleSide,
      blending: T.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uEnergy: { value: 0.2 }, uTint: { value: new T.Color(layer === 1 ? 0x626dff : 0x38c9ff) } },
      vertexShader: `uniform float uTime;uniform float uEnergy;varying vec3 vN;varying vec3 vV;varying float vW;void main(){float w=sin(position.x*4.1+uTime*1.3)*cos(position.y*4.7-uTime*.9);vec3 p=position+normal*w*(.012+.035*uEnergy);vec4 mv=modelViewMatrix*vec4(p,1.);vN=normalize(normalMatrix*normal);vV=normalize(-mv.xyz);vW=w;gl_Position=projectionMatrix*mv;}`,
      fragmentShader: `uniform vec3 uTint;uniform float uEnergy;varying vec3 vN;varying vec3 vV;varying float vW;void main(){float fres=pow(1.-abs(dot(normalize(vN),normalize(vV))),2.2);float vein=smoothstep(.72,1.,abs(vW));float a=fres*(.035+.10*uEnergy)+vein*(.012+.045*uEnergy);gl_FragColor=vec4(uTint,a);}`,
    }));
    const mesh = new T.Mesh(g, mat);
    mesh.rotation.set(0.25 + layer * 0.62, 0.4 + layer * 0.78, -0.35 + layer * 0.48);
    mesh.position.set((layer - 1) * 0.18, (layer - 1) * -0.12, (layer - 1) * 0.15);
    root.add(mesh);
    membranes.push({ mesh, mat, phase: layer * 1.7 });
  }

  // Bright cognition clusters: local flashes rather than one central core.
  const glowMaterial = material(new T.ShaderMaterial({
    ...additive,
    uniforms: { uEnergy: { value: 0.2 }, uTint: { value: new T.Color(0x5fe8ff) } },
    vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `varying vec2 vUv;uniform float uEnergy;uniform vec3 uTint;void main(){float r=length(vUv-.5)*2.;float a=exp(-r*r*5.2)*(.16+.54*uEnergy);gl_FragColor=vec4(uTint,a);}`,
  }));
  const hotspots = [nodes[7], nodes[29], nodes[58], nodes[91]].map((p, i) => {
    const m = new T.Mesh(geometry(new T.PlaneGeometry(0.95 + i * 0.08, 0.95 + i * 0.08)), glowMaterial.clone());
    materials.push(m.material as T.Material);
    m.position.copy(p);
    m.position.z += 0.18;
    root.add(m);
    return m;
  });

  // Nerve impulses running through real graph edges.
  const impulseGeometry = geometry(new T.SphereGeometry(0.025, 8, 6));
  const impulses = Array.from({ length: compact.matches ? 18 : 34 }, (_, i) => {
    const route = edges[(i * 11 + 5) % Math.max(1, edges.length)] ?? { a: nodes[0], b: nodes[1] };
    const mat = material(new T.MeshBasicMaterial({ color: i % 7 === 0 ? 0x8d7bff : i % 3 === 0 ? 0xe3fdff : 0x45dfff, opacity: 0.85, ...additive }));
    const mesh = new T.Mesh(impulseGeometry, mat);
    root.add(mesh);
    return { mesh, mat, a: route.a.clone(), b: route.b.clone(), phase: (i * 0.137) % 1, speed: 0.18 + (i % 6) * 0.035 };
  });

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  let frame = 0, last = 0, elapsed = 0, energy = 0.2, visible = true, disposed = false, px = 0, py = 0;

  const pointer = (event: PointerEvent) => {
    if (event.pointerType === "touch") return;
    const rect = canvas.getBoundingClientRect();
    px = (event.clientX - rect.left) / Math.max(1, rect.width) - 0.5;
    py = (event.clientY - rect.top) / Math.max(1, rect.height) - 0.5;
  };
  const leave = () => { px = 0; py = 0; };

  const resize = new ResizeObserver(() => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, compact.matches ? 1.2 : 1.7));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    camera.position.z = Math.max(8.9, 5.0 / camera.aspect);
    wake();
  });

  function draw(now: number) {
    frame = 0;
    if (disposed || !visible || document.hidden) return;
    const interval = compact.matches ? 1000 / 30 : 1000 / 60;
    if (now - last < interval - 1) { frame = requestAnimationFrame(draw); return; }
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    const { state, evolution } = read();
    const target = state === "thinking" ? 1 : state === "responding" ? 0.78 : state === "listening" ? 0.44 : 0.2;
    energy += (target - energy) * (1 - Math.exp(-dt * 5.5));
    const moving = !reduced.matches;
    if (moving) elapsed += dt;

    root.rotation.y += ((moving ? px * 0.28 : 0) - root.rotation.y) * 0.045;
    root.rotation.x += ((moving ? py * 0.20 : 0) - root.rotation.x) * 0.045;
    if (moving) {
      root.rotation.z = Math.sin(elapsed * 0.16) * 0.025;
      synapses.rotation.y += dt * 0.012;
      neurons.rotation.y += dt * 0.012;
      dust.rotation.y -= dt * (0.008 + energy * 0.018);
    }

    synapseMaterial.opacity = 0.16 + energy * 0.30;
    neuronMaterial.opacity = 0.58 + energy * 0.38;
    dustMaterial.opacity = 0.26 + energy * 0.34;
    key.intensity = 10 + energy * 17;
    rim.intensity = 7 + energy * 12;
    fill.intensity = 3 + energy * 6;

    membranes.forEach(({ mesh, mat, phase }, i) => {
      mat.uniforms.uTime.value = elapsed + phase;
      mat.uniforms.uEnergy.value = energy;
      if (moving) {
        mesh.rotation.z += dt * (i % 2 ? -0.012 : 0.009);
        mesh.position.x += (Math.sin(elapsed * 0.31 + phase) * 0.12 - mesh.position.x * 0.06) * dt * 0.45;
      }
    });

    hotspots.forEach((spot, i) => {
      const mat = spot.material as T.ShaderMaterial;
      const local = Math.max(0, Math.sin(elapsed * (1.1 + i * 0.17) + i * 1.9));
      mat.uniforms.uEnergy.value = energy * (0.42 + local * (state === "thinking" ? 1.25 : 0.55));
      const s = 0.82 + local * 0.26 + energy * 0.09;
      spot.scale.setScalar(s);
      spot.lookAt(camera.position);
    });

    impulses.forEach((imp, i) => {
      const speedBoost = state === "thinking" ? 2.8 : state === "responding" ? 1.8 : 0.65;
      const p = (imp.phase + elapsed * imp.speed * speedBoost) % 1;
      imp.mesh.position.lerpVectors(imp.a, imp.b, p);
      const flash = Math.sin(p * Math.PI);
      imp.mat.opacity = (0.28 + energy * 0.72) * flash;
      imp.mesh.scale.setScalar(0.65 + flash * (state === "thinking" ? 2.0 : 1.2));
      if (i % 5 === 0) imp.mesh.position.y += Math.sin(elapsed * 2.2 + i) * 0.008;
    });

    const evolutionBoost = 1 + Math.min(20, evolution.level) * 0.003;
    root.scale.set(1.18 * evolutionBoost, 0.92 * evolutionBoost, 0.96 * evolutionBoost);
    renderer.render(scene, camera);
    if (moving) frame = requestAnimationFrame(draw);
  }

  function wake() {
    if (!disposed && !frame) { last = performance.now() - 34; frame = requestAnimationFrame(draw); }
  }
  const visibility = () => { if (document.hidden) { cancelAnimationFrame(frame); frame = 0; } else wake(); };
  const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (visible) wake(); else { cancelAnimationFrame(frame); frame = 0; } });

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
