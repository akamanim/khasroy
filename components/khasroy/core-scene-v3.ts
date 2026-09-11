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
  renderer.toneMappingExposure = 1.28;

  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(34, 1, 0.1, 60);
  camera.position.set(0, 0, 8.8);

  const root = new T.Group();
  scene.add(root);

  const geometries: T.BufferGeometry[] = [];
  const materials: T.Material[] = [];
  const geometry = <G extends T.BufferGeometry>(value: G) => {
    geometries.push(value);
    return value;
  };
  const material = <M extends T.Material>(value: M) => {
    materials.push(value);
    return value;
  };

  const additive = {
    transparent: true,
    depthWrite: false,
    blending: T.AdditiveBlending,
  } as const;

  const electric = new T.Color(0x238cff);
  const cyan = new T.Color(0x52eaff);
  const ice = new T.Color(0xd9fbff);
  const violet = new T.Color(0x7b5cff);

  const key = new T.PointLight(0x34b9ff, 18, 17, 1.8);
  key.position.set(2.7, 2.3, 4.5);
  scene.add(key);
  const rim = new T.PointLight(0x4a5cff, 13, 15, 2);
  rim.position.set(-3.5, -1.2, 2.0);
  scene.add(rim);
  const fill = new T.PointLight(0xb6f6ff, 7, 11, 2);
  fill.position.set(0, -3.2, 4.2);
  scene.add(fill);

  // Central cognition core.
  const singularity = new T.Group();
  root.add(singularity);

  const coreMesh = new T.Mesh(
    geometry(new T.IcosahedronGeometry(0.36, 4)),
    material(
      new T.MeshStandardMaterial({
        color: 0x031b4f,
        emissive: 0x147cff,
        emissiveIntensity: 4.2,
        metalness: 0.5,
        roughness: 0.16,
        transparent: true,
        opacity: 0.97,
      }),
    ),
  );
  singularity.add(coreMesh);

  const coreWire = new T.Mesh(
    geometry(new T.IcosahedronGeometry(0.48, 2)),
    material(
      new T.MeshBasicMaterial({
        color: ice,
        wireframe: true,
        opacity: 0.82,
        ...additive,
      }),
    ),
  );
  singularity.add(coreWire);

  const glowMaterial = material(
    new T.ShaderMaterial({
      ...additive,
      uniforms: { energy: { value: 0.22 } },
      vertexShader: `
        varying vec2 vUv;
        void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}
      `,
      fragmentShader: `
        varying vec2 vUv;
        uniform float energy;
        void main(){
          float r=length(vUv-.5)*2.0;
          float halo=exp(-r*r*4.2);
          float whiteHot=exp(-r*r*50.0);
          vec3 base=vec3(.015,.22,1.0);
          vec3 hot=vec3(.78,.98,1.0);
          vec3 c=mix(base,hot,whiteHot);
          gl_FragColor=vec4(c,halo*(.28+energy*.62));
        }
      `,
    }),
  );
  const glow = new T.Mesh(geometry(new T.PlaneGeometry(3.8, 3.8)), glowMaterial);
  scene.add(glow);

  // Living membranes: deform slightly and expose fresnel edges.
  const membraneGroup = new T.Group();
  root.add(membraneGroup);
  const membraneMaterials: T.ShaderMaterial[] = [];
  for (let i = 0; i < 3; i++) {
    const membraneMaterial = material(
      new T.ShaderMaterial({
        ...additive,
        side: T.DoubleSide,
        uniforms: {
          uTime: { value: 0 },
          uEnergy: { value: 0.2 },
          uTint: { value: i === 1 ? violet.clone() : electric.clone() },
          uBase: { value: 0.055 + i * 0.018 },
          uFreq: { value: 5.0 + i * 2.0 },
        },
        vertexShader: `
          uniform float uTime;
          uniform float uEnergy;
          uniform float uFreq;
          varying vec3 vN;
          varying vec3 vV;
          varying float vWave;
          void main(){
            float wave=sin(position.x*uFreq+uTime*1.6)*sin(position.y*(uFreq*.83)-uTime*1.2)*sin(position.z*(uFreq*.71)+uTime);
            vec3 displaced=position+normal*wave*(.018+.028*uEnergy);
            vec4 mv=modelViewMatrix*vec4(displaced,1.0);
            vN=normalize(normalMatrix*normal);
            vV=normalize(-mv.xyz);
            vWave=wave*.5+.5;
            gl_Position=projectionMatrix*mv;
          }
        `,
        fragmentShader: `
          uniform vec3 uTint;
          uniform float uEnergy;
          uniform float uBase;
          varying vec3 vN;
          varying vec3 vV;
          varying float vWave;
          void main(){
            float fres=pow(1.0-abs(dot(normalize(vN),normalize(vV))),2.8);
            float cells=smoothstep(.62,.94,vWave)*(.12+.34*uEnergy);
            float alpha=fres*(uBase+.14*uEnergy)+cells*.13;
            gl_FragColor=vec4(uTint,alpha);
          }
        `,
      }),
    );
    membraneMaterials.push(membraneMaterial);
    const membrane = new T.Mesh(
      geometry(new T.SphereGeometry(0.72 + i * 0.31, 42, 30)),
      membraneMaterial,
    );
    membrane.rotation.set(i * 0.7, i * 0.4, i * 0.55);
    membraneGroup.add(membrane);
  }

  // Mechanical cognition orbits.
  const orbitGroups: T.Group[] = [];
  const orbitMaterials: T.LineBasicMaterial[] = [];
  function arcPoints(radius: number, start: number, span: number, zWave = 0) {
    return Array.from({ length: 92 }, (_, index) => {
      const a = start + (span * index) / 91;
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
    const lineMaterial = material(new T.LineBasicMaterial({ color, opacity, ...additive }));
    orbitMaterials.push(lineMaterial);
    const line = new T.Line(
      geometry(new T.BufferGeometry().setFromPoints(arcPoints(radius, start, span, zWave))),
      lineMaterial,
    );
    group.add(line);
  }
  for (let i = 0; i < 18; i++) {
    const group = new T.Group();
    group.rotation.set(i * 0.41, i * 0.67, i * 0.29);
    const radius = 0.74 + i * 0.055;
    addArc(
      group,
      radius,
      i * 0.58,
      Math.PI * (0.72 + (i % 4) * 0.2),
      0.38 + (i % 3) * 0.14,
      i % 5 === 0 ? 0xbaf8ff : 0x2495ff,
      0.018 + (i % 3) * 0.012,
    );
    addArc(group, radius + 0.026, i * 0.58 + 2.45, 0.26 + (i % 5) * 0.08, 0.72, 0x55e9ff, 0.01);
    orbitGroups.push(group);
    root.add(group);
  }

  const structural = new T.Group();
  root.add(structural);
  for (let i = 0; i < 3; i++) {
    const torus = new T.Mesh(
      geometry(new T.TorusGeometry(1.41 + i * 0.12, 0.013 + i * 0.002, 6, 180)),
      material(
        new T.MeshBasicMaterial({
          color: i === 1 ? 0x7c62ff : 0x31b7ff,
          opacity: 0.34 + i * 0.12,
          ...additive,
        }),
      ),
    );
    torus.rotation.set(i * 1.06 + 0.4, i * 0.78 + 0.18, i * 0.37);
    structural.add(torus);
  }

  // Synaptic network: distributed neurons and explicit connections.
  const synapseGroup = new T.Group();
  root.add(synapseGroup);
  const synapseNodes: T.Vector3[] = [];
  const synapseCount = 38;
  for (let i = 0; i < synapseCount; i++) {
    const phi = Math.acos(1 - (2 * (i + 0.5)) / synapseCount);
    const theta = i * 2.39996323 + Math.sin(i * 1.37) * 0.22;
    const radius = 0.88 + (i % 5) * 0.09;
    synapseNodes.push(new T.Vector3().setFromSphericalCoords(radius, phi, theta));
  }

  const synapseEdges: Array<{ a: T.Vector3; b: T.Vector3 }> = [];
  const synapseLinePoints: T.Vector3[] = [];
  for (let i = 0; i < synapseNodes.length; i++) {
    const links = [1 + (i % 4), 5 + (i % 3)];
    for (const offset of links) {
      const a = synapseNodes[i];
      const b = synapseNodes[(i + offset) % synapseNodes.length];
      if (a.distanceTo(b) > 1.5) continue;
      synapseEdges.push({ a: a.clone(), b: b.clone() });
      synapseLinePoints.push(a, b);
    }
  }
  const synapseMaterial = material(
    new T.LineBasicMaterial({ color: 0x2e9cff, opacity: 0.18, ...additive }),
  );
  synapseGroup.add(
    new T.LineSegments(
      geometry(new T.BufferGeometry().setFromPoints(synapseLinePoints)),
      synapseMaterial,
    ),
  );

  const neuronGeometry = geometry(new T.SphereGeometry(0.035, 9, 7));
  const neuronMaterial = material(
    new T.MeshBasicMaterial({ color: 0xaef6ff, opacity: 0.78, ...additive }),
  );
  for (let i = 0; i < synapseNodes.length; i++) {
    const neuron = new T.Mesh(neuronGeometry, neuronMaterial);
    neuron.position.copy(synapseNodes[i]);
    neuron.scale.setScalar(i % 7 === 0 ? 1.75 : i % 3 === 0 ? 1.2 : 0.72);
    synapseGroup.add(neuron);
  }

  // Nerve impulses travel along synaptic routes.
  const impulseGroup = new T.Group();
  root.add(impulseGroup);
  const impulseGeometry = geometry(new T.SphereGeometry(0.027, 8, 6));
  const impulses = Array.from({ length: 20 }, (_, i) => {
    const route = synapseEdges[(i * 7 + 3) % Math.max(1, synapseEdges.length)] ?? {
      a: new T.Vector3(-0.5, 0, 0),
      b: new T.Vector3(0.5, 0, 0),
    };
    const impulseMaterial = material(
      new T.MeshBasicMaterial({
        color: i % 6 === 0 ? 0x9c74ff : i % 3 === 0 ? 0xd8feff : 0x54e7ff,
        opacity: 0.7,
        ...additive,
      }),
    );
    const mesh = new T.Mesh(impulseGeometry, impulseMaterial);
    impulseGroup.add(mesh);
    return {
      mesh,
      material: impulseMaterial,
      a: route.a.clone(),
      b: route.b.clone(),
      phase: (i * 0.173) % 1,
      speed: 0.28 + (i % 5) * 0.055,
    };
  });

  // Radial neural filaments between cognition core and outer membrane.
  const filamentGroup = new T.Group();
  root.add(filamentGroup);
  const filamentPoints: T.Vector3[] = [];
  const filamentCount = 74;
  for (let i = 0; i < filamentCount; i++) {
    const phi = Math.acos(1 - (2 * (i + 0.5)) / filamentCount);
    const theta = i * 2.39996323;
    const radius = 1.49 + (i % 5) * 0.018;
    const end = new T.Vector3().setFromSphericalCoords(radius, phi, theta);
    const mid = end.clone().multiplyScalar(0.64 + (i % 4) * 0.035);
    mid.x += Math.sin(i * 1.7) * 0.1;
    mid.y += Math.cos(i * 1.3) * 0.08;
    filamentPoints.push(new T.Vector3(), mid, mid, end);
  }
  const filamentMaterial = material(
    new T.LineBasicMaterial({ color: 0x258dff, opacity: 0.16, ...additive }),
  );
  filamentGroup.add(
    new T.LineSegments(
      geometry(new T.BufferGeometry().setFromPoints(filamentPoints)),
      filamentMaterial,
    ),
  );

  const compact = window.matchMedia("(max-width: 600px), (pointer: coarse)");
  const particleCount = compact.matches ? 800 : 1900;
  const positions = new Float32Array(particleCount * 3);
  for (let i = 0; i < particleCount; i++) {
    const y = 1 - (2 * (i + 0.5)) / particleCount;
    const theta = i * 2.39996323;
    const radialNoise = 1.64 + 0.18 * Math.sin(i * 11.713) + 0.04 * Math.sin(i * 0.31);
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
      color: 0x4fc8ff,
      size: compact.matches ? 0.024 : 0.017,
      opacity: 0.44,
      sizeAttenuation: true,
      ...additive,
    }),
  );
  const particles = new T.Points(particleGeometry, particleMaterial);
  root.add(particles);

  const shellMaterial = material(
    new T.MeshBasicMaterial({
      color: 0x315cff,
      wireframe: true,
      opacity: 0.12,
      ...additive,
    }),
  );
  const outerShell = new T.Mesh(
    geometry(new T.IcosahedronGeometry(1.6, compact.matches ? 2 : 3)),
    shellMaterial,
  );
  root.add(outerShell);

  const hud = new T.Group();
  root.add(hud);
  const hudPoints: T.Vector3[] = [];
  for (let i = 0; i < 120; i++) {
    const a = (i / 120) * Math.PI * 2;
    const r = 1.92;
    const len = i % 10 === 0 ? 0.12 : i % 5 === 0 ? 0.065 : 0.022;
    hudPoints.push(
      new T.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0),
      new T.Vector3(Math.cos(a) * (r + len), Math.sin(a) * (r + len), 0),
    );
  }
  hud.add(
    new T.LineSegments(
      geometry(new T.BufferGeometry().setFromPoints(hudPoints)),
      material(new T.LineBasicMaterial({ color: 0x3aa9ff, opacity: 0.2, ...additive })),
    ),
  );

  const pulses = Array.from({ length: 4 }, (_, i) => {
    const pulse = new T.Mesh(
      geometry(new T.RingGeometry(0.98, 1.0, 128)),
      material(
        new T.MeshBasicMaterial({
          color: i % 2 ? 0x69ecff : 0x6c63ff,
          side: T.DoubleSide,
          opacity: 0,
          ...additive,
        }),
      ),
    );
    pulse.rotation.x = Math.PI / 2;
    root.add(pulse);
    return pulse;
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
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, compact.matches ? 1.2 : 1.7));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
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
      state === "thinking"
        ? 1
        : state === "responding"
          ? 0.82
          : state === "listening"
            ? 0.48
            : 0.22;
    energy += (targetEnergy - energy) * (1 - Math.exp(-dt * 5.5));

    const moving = !reduced.matches;
    if (moving) elapsed += dt;

    root.rotation.y += ((moving ? px * 0.42 : 0) - root.rotation.y) * 0.055;
    root.rotation.x += ((moving ? py * 0.3 : 0) - root.rotation.x) * 0.055;

    if (moving) {
      orbitGroups.forEach((group, i) => {
        const direction = i % 2 === 0 ? 1 : -1;
        group.rotation.z += dt * direction * (0.05 + energy * (0.28 + (i % 5) * 0.018));
        group.rotation.y += dt * direction * 0.018;
      });
      structural.rotation.y += dt * (0.025 + energy * 0.05);
      structural.rotation.z -= dt * 0.016;
      membraneGroup.rotation.y += dt * (0.014 + energy * 0.03);
      synapseGroup.rotation.y -= dt * (0.018 + energy * 0.05);
      impulseGroup.rotation.y = synapseGroup.rotation.y;
      filamentGroup.rotation.y += dt * (0.012 + energy * 0.04);
      particles.rotation.y += dt * (0.025 + energy * 0.065);
      outerShell.rotation.y -= dt * 0.018;
      outerShell.rotation.x += dt * 0.009;
      hud.rotation.z -= dt * (0.012 + energy * 0.018);
      singularity.rotation.y += dt * (0.18 + energy * 0.72);
      singularity.rotation.x -= dt * (0.06 + energy * 0.18);
    }

    const breath = moving
      ? 1 + Math.sin(elapsed * (1.6 + energy * 1.8)) * (0.018 + energy * 0.025)
      : 1;
    const levelBoost = 1 + Math.min(20, evolution.level) * 0.005;
    singularity.scale.setScalar(breath * levelBoost);

    glowMaterial.uniforms.energy.value = energy;
    glow.scale.setScalar(0.92 + energy * 0.2 + Math.sin(elapsed * 1.7) * 0.018);
    coreMesh.scale.setScalar(0.94 + energy * 0.17);
    coreWire.scale.setScalar(1 + energy * 0.1);

    const coreStandard = coreMesh.material as T.MeshStandardMaterial;
    coreStandard.emissiveIntensity = 3.2 + energy * 4.7;
    key.intensity = 13 + energy * 15;
    rim.intensity = 8 + energy * 13;
    fill.intensity = 4 + energy * 5;

    membraneMaterials.forEach((membraneMaterial, i) => {
      membraneMaterial.uniforms.uTime.value = elapsed + i * 0.73;
      membraneMaterial.uniforms.uEnergy.value = energy;
    });

    const thoughtFactor = state === "thinking" ? 1 : state === "responding" ? 0.72 : 0.25;
    synapseMaterial.opacity = 0.11 + energy * 0.28;
    neuronMaterial.opacity = 0.5 + energy * 0.46;
    filamentMaterial.opacity = 0.1 + energy * 0.26;
    particleMaterial.opacity = 0.3 + energy * 0.36;
    shellMaterial.opacity = 0.07 + energy * 0.14;

    impulses.forEach((impulse, i) => {
      const progress = (elapsed * impulse.speed * (0.65 + energy * 1.7) + impulse.phase) % 1;
      impulse.mesh.position.lerpVectors(impulse.a, impulse.b, progress);
      const flare = Math.sin(progress * Math.PI);
      const active = 0.16 + thoughtFactor * 0.84;
      impulse.material.opacity = flare * active;
      impulse.mesh.scale.setScalar(0.5 + flare * (0.7 + thoughtFactor * 1.1));
      if (i % 5 === 0 && state === "thinking") {
        impulse.mesh.scale.multiplyScalar(1.25 + 0.25 * Math.sin(elapsed * 8 + i));
      }
    });

    orbitMaterials.forEach((orbitMaterial, i) => {
      const base = 0.26 + (i % 3) * 0.08;
      const flicker = moving ? Math.sin(elapsed * (1.5 + (i % 7) * 0.16) + i) * 0.07 : 0;
      orbitMaterial.opacity = Math.max(0.12, Math.min(0.92, base + energy * 0.34 + flicker * energy));
    });

    pulses.forEach((pulse, i) => {
      const progress = (elapsed * (0.42 + energy * 0.38) + i / pulses.length) % 1;
      pulse.scale.setScalar(0.45 + progress * 1.48);
      const pulseMaterial = pulse.material as T.MeshBasicMaterial;
      const active = state === "thinking" || state === "responding";
      pulseMaterial.opacity = active && moving
        ? Math.sin(progress * Math.PI) * (state === "thinking" ? 0.31 : 0.42)
        : 0;
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
      geometries.forEach((item) => item.dispose());
      materials.forEach((item) => item.dispose());
      renderer.dispose();
    },
  };
}
