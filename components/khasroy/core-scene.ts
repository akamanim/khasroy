import * as T from "three";
import type { CoreState, CoreEvolution } from "./core";

// All GPU resources belong to one mounted scene; no textures or postprocessing passes.
export function createCoreScene(
  canvas: HTMLCanvasElement,
  read: () => { state: CoreState; evolution: CoreEvolution },
) {
  const renderer = new T.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: false,
    powerPreference: "low-power",
  });
  renderer.setClearColor(0x000000, 0);
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(38, 1, 0.1, 50);
  camera.position.z = 7.8;
  const root = new T.Group();
  root.position.y = 0.35;
  scene.add(root);
  const materials: T.Material[] = [];
  const geometries: T.BufferGeometry[] = [];
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
  };
  const copper = 0xf58638;
  const rings: T.Group[] = [];
  function arc(
    radius: number,
    start: number,
    span: number,
    opacity: number,
    color = copper,
  ) {
    const points = Array.from({ length: 81 }, (_, i) => {
      const a = start + (span * i) / 80;
      return new T.Vector3(Math.cos(a) * radius, Math.sin(a) * radius, 0);
    });
    return new T.Line(
      geometry(new T.BufferGeometry().setFromPoints(points)),
      material(new T.LineBasicMaterial({ color, opacity, ...additive })),
    );
  }
  for (let i = 0; i < 12; i++) {
    const ring = new T.Group();
    ring.rotation.set(i * 0.53, i * 0.79, i * 0.34);
    const radius = 0.64 + i * 0.086;
    ring.add(
      arc(radius, i, Math.PI * (1.1 + (i % 3) * 0.25), 0.6 + (i % 3) * 0.15),
    );
    ring.add(arc(radius + 0.025, i + 2.9, 0.42, 0.7, 0xffce7c));
    rings.push(ring);
    root.add(ring);
  }
  // Sparse translucent shells expose the interior instead of hiding it.
  for (let i = 0; i < 3; i++) {
    const shell = new T.Mesh(
      geometry(new T.SphereGeometry(0.93 + i * 0.25, 32, 20)),
      material(
        new T.ShaderMaterial({
          ...additive,
          side: T.FrontSide,
          uniforms: {
            tint: { value: new T.Color(copper) },
            strength: { value: 0.1 - i * 0.018 },
          },
          vertexShader: `varying vec3 n; varying vec3 v; void main(){vec4 p=modelViewMatrix*vec4(position,1.);n=normalize(normalMatrix*normal);v=normalize(-p.xyz);gl_Position=projectionMatrix*p;}`,
          fragmentShader: `varying vec3 n; varying vec3 v; uniform vec3 tint; uniform float strength; void main(){float rim=pow(1.-abs(dot(normalize(n),normalize(v))),3.);gl_FragColor=vec4(tint,rim*strength);}`,
        }),
      ),
    );
    root.add(shell);
  }
  // Khasroy's signature: three interlocked, broken meridians around a faceted heart.
  const heart = new T.Group();
  root.add(heart);
  for (let i = 0; i < 3; i++) {
    const meridian = arc(0.37 + i * 0.065, 0.22, Math.PI * 1.75, 0.9, 0xffd48c);
    meridian.rotation.set((i * Math.PI) / 3, (i * Math.PI) / 3, 0.4);
    heart.add(meridian);
  }
  heart.add(
    new T.Mesh(
      geometry(new T.IcosahedronGeometry(0.19, 1)),
      material(
        new T.MeshBasicMaterial({
          color: 0xffc775,
          wireframe: true,
          ...additive,
        }),
      ),
    ),
  );
  const glowMaterial = material(
    new T.ShaderMaterial({
      ...additive,
      uniforms: { energy: { value: 0.2 } },
      vertexShader: `varying vec2 uvp; void main(){uvp=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader: `varying vec2 uvp; uniform float energy; void main(){float r=length(uvp-.5)*2.;float a=exp(-r*r*9.)*(1.-smoothstep(.65,1.,r));vec3 c=mix(vec3(1.,.24,.035),vec3(1.,.86,.5),exp(-r*r*55.));gl_FragColor=vec4(c,a*(.5+energy*.4));}`,
    }),
  );
  const glow = new T.Mesh(
    geometry(new T.PlaneGeometry(2.6, 2.6)),
    glowMaterial,
  );
  glow.position.y = root.position.y;
  scene.add(glow);
  const compact = window.matchMedia("(max-width: 600px), (pointer: coarse)");
  const count = compact.matches ? 650 : 1400;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const y = 1 - (2 * (i + 0.5)) / count,
      a = i * 2.39996323;
    const r = 1.32 + 0.18 * Math.sin(i * 17.17);
    positions.set(
      [
        Math.cos(a) * Math.sqrt(1 - y * y) * r,
        y * r,
        Math.sin(a) * Math.sqrt(1 - y * y) * r,
      ],
      i * 3,
    );
  }
  const pointsGeometry = geometry(new T.BufferGeometry());
  pointsGeometry.setAttribute("position", new T.BufferAttribute(positions, 3));
  const sparksMaterial = material(
    new T.PointsMaterial({
      color: 0xffb866,
      size: 0.022,
      opacity: 0.7,
      ...additive,
    }),
  );
  const sparks = new T.Points(pointsGeometry, sparksMaterial);
  root.add(sparks);
  // Segmented circuit traces follow the spherical surface in one draw call.
  const traces: T.Vector3[] = [];
  for (let i = 0; i < (compact.matches ? 72 : 144); i++) {
    const latitude = Math.acos(1 - 2 * (i + .5) / (compact.matches ? 72 : 144));
    const longitude = i * 2.39996323;
    const radius = 1.39 + (i % 3) * .045;
    const point = (a: number, b: number) => new T.Vector3().setFromSphericalCoords(radius, a, b);
    const start = point(latitude, longitude);
    const elbow = point(latitude + .045, longitude);
    const end = point(latitude + .045, longitude + .06 + (i % 5) * .016);
    traces.push(start, elbow, elbow, end);
  }
  const circuits = new T.LineSegments(geometry(new T.BufferGeometry().setFromPoints(traces)), material(new T.LineBasicMaterial({color: 0xffa65b, opacity: .64, ...additive})));
  root.add(circuits);
  const hud = new T.Group();
  root.add(hud);
  const hudPoints: T.Vector3[] = [];
  for (let i = 0; i < 96; i++) {
    const a = (i / 96) * Math.PI * 2,
      r = 1.66;
    const length = i % 8 === 0 ? 0.09 : 0.027;
    hudPoints.push(
      new T.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0),
      new T.Vector3(Math.cos(a) * (r + length), Math.sin(a) * (r + length), 0),
    );
    if (i % 12 === 0) {
      const x = Math.cos(a) * 1.2,
        y = Math.sin(a) * 1.2;
      hudPoints.push(
        new T.Vector3(x, y, 0.15),
        new T.Vector3(x * 1.3, y * 1.3, 0.15),
        new T.Vector3(x * 1.3, y * 1.3, 0.15),
        new T.Vector3(x * 1.3 + 0.12, y * 1.3, 0.15),
      );
    }
  }
  hud.add(
    new T.LineSegments(
      geometry(new T.BufferGeometry().setFromPoints(hudPoints)),
      material(
        new T.LineBasicMaterial({ color: copper, opacity: 0.36, ...additive }),
      ),
    ),
  );
  const pulses = Array.from({ length: 3 }, () => {
    const line = arc(1, 0, Math.PI * 2, 0, 0xffc47b);
    root.add(line);
    return line;
  });
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  let frame = 0,
    last = 0,
    elapsed = 0,
    energy = 0.2,
    visible = true,
    disposed = false;
  let px = 0,
    py = 0;
  const pointer = (event: PointerEvent) => {
    if (event.pointerType === "touch") return;
    const rect = canvas.getBoundingClientRect();
    px = (event.clientX - rect.left) / rect.width - 0.5;
    py = (event.clientY - rect.top) / rect.height - 0.5;
  };
  const leave = () => {
    px = 0;
    py = 0;
  };
  const resize = new ResizeObserver(() => {
    const w = canvas.clientWidth,
      h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, compact.matches ? 1.25 : 1.75),
    );
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    camera.position.z = Math.max(7.8, 4.2 / camera.aspect);
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
    const target =
      state === "thinking"
        ? 1
        : state === "responding"
          ? 0.7
          : state === "listening"
            ? 0.4
            : 0.2;
    energy += (target - energy) * (1 - Math.exp(-dt * 5));
    const moving = !reduced.matches;
    if (moving) elapsed += dt;
    root.rotation.y += ((moving ? px * 0.3 : 0) - root.rotation.y) * 0.07;
    root.rotation.x += ((moving ? py * 0.22 : 0) - root.rotation.x) * 0.07;
    rings.forEach((ring, i) => {
      if (moving) {
        ring.rotation.z += dt * (0.07 + energy * 0.4) * (i % 2 ? 1 : -1);
        ring.rotation.y += dt * 0.025;
      }
    });
    if (moving) {
      sparks.rotation.y += dt * (0.035 + energy * 0.1);
      circuits.rotation.y = sparks.rotation.y;
      heart.rotation.y += dt * (0.2 + energy * 0.7);
      hud.rotation.z -= dt * 0.015;
    }
    sparksMaterial.opacity = 0.5 + energy * 0.3;
    glowMaterial.uniforms.energy.value = energy;
    heart.scale.setScalar(
      1 +
        Math.min(10, evolution.level) * 0.012 +
        (moving ? Math.sin(elapsed * 2) * 0.025 : 0),
    );
    pulses.forEach((pulse, i) => {
      const p = (elapsed * 0.65 + i / 3) % 1;
      pulse.scale.setScalar(0.4 + p * 1.3);
      (pulse.material as T.LineBasicMaterial).opacity =
        state === "responding" && moving ? Math.sin(p * Math.PI) * 0.42 : 0;
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
