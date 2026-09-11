import * as T from "three";
import type { CoreState, CoreEvolution } from "./core";

export function createCoreScene(
  canvas: HTMLCanvasElement,
  read: () => { state: CoreState; evolution: CoreEvolution },
) {
  const renderer = new T.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;

  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(34, 1, 0.1, 60);
  camera.position.set(0, 0, 8.8);

  const root = new T.Group();
  scene.add(root);

  const geometries: T.BufferGeometry[] = [];
  const materials: T.Material[] = [];
  const geometry = <G extends T.BufferGeometry>(g: G) => {
    geometries.push(g);
    return g;
  };
  const material = <M extends T.Material>(m: M) => {
    materials.push(m);
    return m;
  };

  const additive = {
    transparent: true,
    depthWrite: false,
    blending: T.AdditiveBlending,
  } as const;

  const copper = new T.Color(0xff7a22);
  const amber = new T.Color(0xffb04a);
  const hot = new T.Color(0xffe4a3);
  const ember = new T.Color(0xff3b08);

  // Lighting is intentionally warm and directional: the form must feel volumetric,
  // not like a flat HUD graphic.
  const key = new T.PointLight(0xff9c4a, 16, 16, 1.8);
  key.position.set(2.5, 2.2, 4.3);
  scene.add(key);
  const rim = new T.PointLight(0xff4b12, 10, 14, 2);
  rim.position.set(-3.5, -1.3, 1.8);
  scene.add(rim);
  const fill = new T.PointLight(0xffd89a, 5, 10, 2);
  fill.position.set(0, -3, 4);
  scene.add(fill);

  // --- Central singularity -------------------------------------------------
  const singularity = new T.Group();
  root.add(singularity);

  const coreMesh = new T.Mesh(
    geometry(new T.IcosahedronGeometry(0.38, 4)),
    material(
      new T.MeshStandardMaterial({
        color: 0x6d1705,
        emissive: 0xff4f08,
        emissiveIntensity: 3.2,
        metalness: 0.35,
        roughness: 0.22,
        transparent: true,
        opacity: 0.96,
      }),
    ),
  );
  singularity.add(coreMesh);

  const coreWire = new T.Mesh(
    geometry(new T.IcosahedronGeometry(0.47, 2)),
    material(
      new T.MeshBasicMaterial({
        color: hot,
        wireframe: true,
        opacity: 0.8,
        ...additive,
      }),
    ),
  );
  singularity.add(coreWire);

  const innerShell = new T.Mesh(
    geometry(new T.SphereGeometry(0.58, 40, 28)),
    material(
      new T.ShaderMaterial({
        ...additive,
        side: T.DoubleSide,
        uniforms: {
          tint: { value: amber },
          intensity: { value: 0.34 },
        },
        vertexShader: `
          varying vec3 vN;
          varying vec3 vV;
          void main(){
            vec4 mv = modelViewMatrix * vec4(position,1.0);
            vN = normalize(normalMatrix * normal);
            vV = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: `
          varying vec3 vN;
          varying vec3 vV;
          uniform vec3 tint;
          uniform float intensity;
          void main(){
            float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.3);
            gl_FragColor = vec4(tint, fres * intensity);
          }
        `,
      }),
    ),
  );
  singularity.add(innerShell);

  // Bright soft center without postprocessing dependency.
  const glowMaterial = material(
    new T.ShaderMaterial({
      ...additive,
      uniforms: { energy: { value: 0.25 } },
      vertexShader: `
        varying vec2 vUv;
        void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}
      `,
      fragmentShader: `
        varying vec2 vUv;
        uniform float energy;
        void main(){
          float r = length(vUv-.5)*2.0;
          float halo = exp(-r*r*4.8);
          float whiteHot = exp(-r*r*44.0);
          vec3 c = mix(vec3(1.0,.17,.015), vec3(1.0,.90,.58), whiteHot);
          float a = halo * (.30 + energy*.58);
          gl_FragColor = vec4(c,a);
        }
      `,
    }),
  );
  const glow = new T.Mesh(geometry(new T.PlaneGeometry(3.7, 3.7)), glowMaterial);
  scene.add(glow);

  // --- Mechanical energy cages --------------------------------------------
  const orbitGroups: T.Group[] = [];
  const orbitMaterials: T.LineBasicMaterial[] = [];

  function arcPoints(radius: number, start: number, span: number, zWave = 0) {
    return Array.from({ length: 96 }, (_, i) => {
      const a = start + (span * i) / 95;
      return new T.Vector3(
        Math.cos(a) * radius,
        Math.sin(a) * radius,
        zWave ? Math.sin(a * 3.0) * zWave : 0,
      );
    });
  }

  function addArc(
    group: T.Group,
    radius: number,
    start: number,
    span: number,
    opacity: number,
    color: T.ColorRepresentation,
    zWave = 0,
  ) {
    const mat = material(
      new T.LineBasicMaterial({ color, opacity, ...additive }),
    );
    orbitMaterials.push(mat);
    const line = new T.Line(
      geometry(new T.BufferGeometry().setFromPoints(arcPoints(radius, start, span, zWave))),
      mat,
    );
    group.add(line);
    return line;
  }

  for (let i = 0; i < 18; i++) {
    const group = new T.Group();
    group.rotation.set(i * 0.41, i * 0.67, i * 0.29);
    const radius = 0.72 + i * 0.055;
    addArc(group, radius, i * 0.58, Math.PI * (0.72 + (i % 4) * 0.2), 0.46 + (i % 3) * 0.13, i % 4 === 0 ? 0xffdd9a : 0xff7f29, 0.018 + (i % 3) * 0.012);
    addArc(group, radius + 0.025, i * 0.58 + 2.45, 0.26 + (i % 5) * 0.08, 0.78, 0xffc66d, 0.01);
    orbitGroups.push(group);
    root.add(group);
  }

  // Three large tilted structural rings give the core a recognizable silhouette.
  const structural = new T.Group();
  root.add(structural);
  for (let i = 0; i < 3; i++) {
    const torus = new T.Mesh(
      geometry(new T.TorusGeometry(1.38 + i * 0.11, 0.013 + i * 0.002, 6, 180)),
      material(
        new T.MeshBasicMaterial({
          color: i === 1 ? 0xffd493 : 0xff6a1f,
          opacity: 0.4 + i * 0.12,
          ...additive,
        }),
      ),
    );
    torus.rotation.set(i * 1.06 + 0.4, i * 0.78 + 0.18, i * 0.37);
    structural.add(torus);
  }

  // --- Neural filaments ----------------------------------------------------
  const filamentGroup = new T.Group();
  root.add(filamentGroup);
  const filamentPoints: T.Vector3[] = [];
  const filamentCount = 82;
  for (let i = 0; i < filamentCount; i++) {
    const phi = Math.acos(1 - (2 * (i + 0.5)) / filamentCount);
    const theta = i * 2.39996323;
    const radius = 1.48 + (i % 5) * 0.018;
    const end = new T.Vector3().setFromSphericalCoords(radius, phi, theta);
    const mid = end.clone().multiplyScalar(0.62 + (i % 4) * 0.035);
    mid.x += Math.sin(i * 1.7) * 0.11;
    mid.y += Math.cos(i * 1.3) * 0.09;
    filamentPoints.push(
      new T.Vector3(0, 0, 0),
      mid,
      mid,
      end,
    );
  }
  const filamentMaterial = material(
    new T.LineBasicMaterial({
      color: 0xff7c28,
      opacity: 0.24,
      ...additive,
    }),
  );
  filamentGroup.add(
    new T.LineSegments(
      geometry(new T.BufferGeometry().setFromPoints(filamentPoints)),
      filamentMaterial,
    ),
  );

  // --- Energy nodes --------------------------------------------------------
  const nodeGeometry = geometry(new T.SphereGeometry(0.035, 10, 8));
  const nodeMaterial = material(
    new T.MeshBasicMaterial({ color: 0xffd58a, opacity: 0.9, ...additive }),
  );
  const nodeGroup = new T.Group();
  root.add(nodeGroup);
  const nodeCount = 44;
  for (let i = 0; i < nodeCount; i++) {
    const phi = Math.acos(1 - (2 * (i + 0.5)) / nodeCount);
    const theta = i * 2.39996323 + 0.45;
    const radius = 1.42 + ((i % 3) - 1) * 0.07;
    const node = new T.Mesh(nodeGeometry, nodeMaterial);
    node.position.setFromSphericalCoords(radius, phi, theta);
    node.scale.setScalar(i % 7 === 0 ? 1.8 : i % 3 === 0 ? 1.25 : 0.75);
    nodeGroup.add(node);
  }

  // --- Particle shell ------------------------------------------------------
  const compact = window.matchMedia("(max-width: 600px), (pointer: coarse)");
  const particleCount = compact.matches ? 900 : 2100;
  const positions = new Float32Array(particleCount * 3);
  for (let i = 0; i < particleCount; i++) {
    const y = 1 - (2 * (i + 0.5)) / particleCount;
    const theta = i * 2.39996323;
    const radialNoise = 1.62 + 0.19 * Math.sin(i * 11.713) + 0.04 * Math.sin(i * 0.31);
    const xz = Math.sqrt(Math.max(0, 1 - y * y));
    positions.set(
      [Math.cos(theta) * xz * radialNoise, y * radialNoise, Math.sin(theta) * xz * radialNoise],
      i * 3,
    );
  }
  const particleGeometry = geometry(new T.BufferGeometry());
  particleGeometry.setAttribute("position", new T.BufferAttribute(positions, 3));
  const particleMaterial = material(
    new T.PointsMaterial({
      color: 0xff9b4c,
      size: compact.matches ? 0.026 : 0.018,
      opacity: 0.52,
      sizeAttenuation: true,
      ...additive,
    }),
  );
  const particles = new T.Points(particleGeometry, particleMaterial);
  root.add(particles);

  // --- Outer fractured shell ----------------------------------------------
  const shellMaterial = material(
    new T.MeshBasicMaterial({
      color: 0xff6e22,
      wireframe: true,
      opacity: 0.16,
      ...additive,
    }),
  );
  const outerShell = new T.Mesh(
    geometry(new T.IcosahedronGeometry(1.58, compact.matches ? 2 : 3)),
    shellMaterial,
  );
  root.add(outerShell);

  // --- HUD / pulse rings ---------------------------------------------------
  const hud = new T.Group();
  root.add(hud);
  const hudPoints: T.Vector3[] = [];
  for (let i = 0; i < 120; i++) {
    const a = (i / 120) * Math.PI * 2;
    const r = 1.9;
    const len = i % 10 === 0 ? 0.12 : i % 5 === 0 ? 0.065 : 0.022;
    hudPoints.push(
      new T.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0),
      new T.Vector3(Math.cos(a) * (r + len), Math.sin(a) * (r + len), 0),
    );
  }
  hud.add(
    new T.LineSegments(
      geometry(new T.BufferGeometry().setFromPoints(hudPoints)),
      material(new T.LineBasicMaterial({ color: 0xff8c38, opacity: 0.22, ...additive })),
    ),
  );

  const pulses = Array.from({ length: 4 }, (_, i) => {
    const mesh = new T.Mesh(
      geometry(new T.RingGeometry(0.98, 1.0, 128)),
      material(
        new T.MeshBasicMaterial({
          color: i % 2 ? 0xffcc7a : 0xff6f23,
          side: T.DoubleSide,
          opacity: 0,
          ...additive,
        }),
      ),
    );
    mesh.rotation.x = Math.PI / 2;
    root.add(mesh);
    return mesh;
  });

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  let frame = 0;
  let last = 0;
  let elapsed = 0;
  let energy = 0.22;
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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, compact.matches ? 1.2 : 1.7));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    camera.position.z = Math.max(8.8, 4.7 / camera.aspect);
    wake();
  });

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
    const { state, evolution } = read();
    const targetEnergy =
      state === "thinking" ? 1 : state === "responding" ? 0.82 : state === "listening" ? 0.48 : 0.22;
    energy += (targetEnergy - energy) * (1 - Math.exp(-dt * 5.5));

    const moving = !reduced.matches;
    if (moving) elapsed += dt;

    root.rotation.y += ((moving ? px * 0.42 : 0) - root.rotation.y) * 0.055;
    root.rotation.x += ((moving ? py * 0.3 : 0) - root.rotation.x) * 0.055;

    if (moving) {
      orbitGroups.forEach((group, i) => {
        const dir = i % 2 === 0 ? 1 : -1;
        group.rotation.z += dt * dir * (0.05 + energy * (0.28 + (i % 5) * 0.018));
        group.rotation.y += dt * dir * 0.018;
      });
      structural.rotation.y += dt * (0.025 + energy * 0.05);
      structural.rotation.z -= dt * 0.016;
      filamentGroup.rotation.y -= dt * (0.02 + energy * 0.08);
      nodeGroup.rotation.y += dt * (0.035 + energy * 0.1);
      particles.rotation.y += dt * (0.025 + energy * 0.065);
      outerShell.rotation.y -= dt * 0.018;
      outerShell.rotation.x += dt * 0.009;
      hud.rotation.z -= dt * (0.012 + energy * 0.018);
      singularity.rotation.y += dt * (0.18 + energy * 0.7);
      singularity.rotation.x -= dt * (0.06 + energy * 0.18);
    }

    const breath = moving ? 1 + Math.sin(elapsed * (1.6 + energy * 1.8)) * (0.018 + energy * 0.025) : 1;
    const levelBoost = 1 + Math.min(20, evolution.level) * 0.005;
    singularity.scale.setScalar(breath * levelBoost);

    glowMaterial.uniforms.energy.value = energy;
    glow.scale.setScalar(0.92 + energy * 0.18 + Math.sin(elapsed * 1.7) * 0.018);
    coreMesh.scale.setScalar(0.94 + energy * 0.16);
    coreWire.scale.setScalar(1 + energy * 0.09);

    const coreStandard = coreMesh.material as T.MeshStandardMaterial;
    coreStandard.emissiveIntensity = 2.6 + energy * 3.6;
    key.intensity = 12 + energy * 13;
    rim.intensity = 7 + energy * 11;
    fill.intensity = 4 + energy * 4;

    orbitMaterials.forEach((mat, i) => {
      const flicker = moving ? Math.sin(elapsed * (1.3 + (i % 7) * 0.11) + i) * 0.06 : 0;
      mat.opacity = Math.max(0.12, Math.min(0.95, mat.opacity + flicker * energy));
    });
    filamentMaterial.opacity = 0.16 + energy * 0.22;
    particleMaterial.opacity = 0.38 + energy * 0.32;
    shellMaterial.opacity = 0.1 + energy * 0.16;
    nodeMaterial.opacity = 0.64 + energy * 0.32;

    pulses.forEach((pulse, i) => {
      const p = (elapsed * (0.42 + energy * 0.34) + i / pulses.length) % 1;
      pulse.scale.setScalar(0.45 + p * 1.45);
      const mat = pulse.material as T.MeshBasicMaterial;
      const speaking = state === "responding";
      const thinking = state === "thinking";
      const active = speaking || thinking;
      mat.opacity = active && moving ? Math.sin(p * Math.PI) * (speaking ? 0.42 : 0.25) : 0;
    });

    renderer.render(scene, camera);
    if (moving) frame = requestAnimationFrame(draw);
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
    } else {
      wake();
    }
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
