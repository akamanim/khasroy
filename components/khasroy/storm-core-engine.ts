import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

export type StormState = "idle" | "listening" | "thinking" | "responding";

export type StormCore = {
  setState: (state: StormState) => void;
  burst: () => void;
  dispose: () => void;
};

type Tuning = {
  flow: number;
  shimmer: number;
  glow: number;
  density: number;
  bolts: number;
  sheets: number;
  bloom: number;
  tint: number;
  sway: number;
};

const STATES: Record<StormState, Tuning> = {
  idle: { flow: 0.35, shimmer: 1, glow: 0.8, density: 1, bolts: 0.25, sheets: 0.45, bloom: 0.55, tint: 0, sway: 1 },
  listening: { flow: 0.5, shimmer: 1.3, glow: 1.05, density: 1, bolts: 0.45, sheets: 0.9, bloom: 0.65, tint: 0, sway: 0.6 },
  thinking: { flow: 1.4, shimmer: 3.2, glow: 0.95, density: 1.05, bolts: 2.6, sheets: 5, bloom: 0.75, tint: 0.45, sway: 1.6 },
  responding: { flow: 0.7, shimmer: 1.8, glow: 1.1, density: 1, bolts: 1.5, sheets: 1.8, bloom: 0.75, tint: 0, sway: 1 },
};

const BLOBS: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 0.05, 0, 0.62],
  [-0.55, -0.02, 0.05, 0.5],
  [0.56, 0, -0.05, 0.52],
  [-1.0, -0.12, 0, 0.36],
  [1.0, -0.1, 0.05, 0.38],
  [-0.25, 0.36, 0.08, 0.45],
  [0.32, 0.36, -0.05, 0.42],
  [0, 0.12, 0.38, 0.42],
  [-0.6, 0.18, -0.3, 0.38],
  [0.66, 0.12, 0.3, 0.36],
  [1.32, -0.16, 0, 0.25],
  [-1.3, -0.18, 0.05, 0.24],
];

const FLASH_SLOTS = 6;
const BOLT_SEGMENTS = 32;
const BOLT_POOL = 20;

function buildNoiseTexture(): THREE.Data3DTexture {
  const size = 64;
  const octaves = [4, 8, 16, 32];
  const amps = [0.5, 0.25, 0.125, 0.0625];
  const data = new Uint8Array(size * size * size * 4);
  const lattices = [0, 1, 2, 3].map(() =>
    octaves.map((period) => {
      const values = new Float32Array(period * period * period);
      for (let i = 0; i < values.length; i++) values[i] = Math.random();
      return values;
    }),
  );
  const smooth = (f: number) => f * f * (3 - 2 * f);
  for (let z = 0; z < size; z++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const offset = ((z * size + y) * size + x) * 4;
        for (let ch = 0; ch < 4; ch++) {
          let v = 0;
          for (let k = 0; k < octaves.length; k++) {
            const P = octaves[k];
            const a = lattices[ch][k];
            const s = P / size;
            const fx = x * s, fy = y * s, fz = z * s;
            const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
            const tx = smooth(fx - ix), ty = smooth(fy - iy), tz = smooth(fz - iz);
            const x0 = ix % P, x1 = (ix + 1) % P;
            const y0 = (iy % P) * P, y1 = ((iy + 1) % P) * P;
            const z0 = (iz % P) * P * P, z1 = ((iz + 1) % P) * P * P;
            const c00 = a[z0 + y0 + x0] + (a[z0 + y0 + x1] - a[z0 + y0 + x0]) * tx;
            const c10 = a[z0 + y1 + x0] + (a[z0 + y1 + x1] - a[z0 + y1 + x0]) * tx;
            const c01 = a[z1 + y0 + x0] + (a[z1 + y0 + x1] - a[z1 + y0 + x0]) * tx;
            const c11 = a[z1 + y1 + x0] + (a[z1 + y1 + x1] - a[z1 + y1 + x0]) * tx;
            const c0 = c00 + (c10 - c00) * ty;
            const c1 = c01 + (c11 - c01) * ty;
            v += amps[k] * (c0 + (c1 - c0) * tz);
          }
          v = v / 0.9375;
          v = Math.min(1, Math.max(0, (v - 0.5) * 2 + 0.5));
          data[offset + ch] = (v * 255) | 0;
        }
      }
    }
  }
  const texture = new THREE.Data3DTexture(data, size, size, size);
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.UnsignedByteType;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.wrapR = THREE.RepeatWrapping;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

const blobGLSL = `const vec4 BL[${BLOBS.length}]=vec4[${BLOBS.length}](${BLOBS.map(
  (b) => `vec4(${b.map((v) => v.toFixed(3)).join(",")})`,
).join(",")});`;

const CLOUD_FRAGMENT = `precision highp sampler3D;
uniform sampler3D uN;
uniform mat4 uInvProj, uCamW, uW2L;
uniform vec3 uCamPos;
uniform float uPhase, uSh, uGlow, uTint, uDen;
uniform vec4 uF[${FLASH_SLOTS}];
varying vec2 vUv;
${blobGLSL}
float hash(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
float smin(float a,float b,float k){float h=clamp(0.5+0.5*(b-a)/k,0.0,1.0);return mix(b,a,h)-k*h*(1.0-h);}
float sdf(vec3 p){
  float d=1e3;
  for(int i=0;i<${BLOBS.length};i++){
    vec4 b=BL[i];
    vec3 c=b.xyz+vec3(0.0,sin(uPhase*0.6+float(i)*1.7)*0.035,cos(uPhase*0.5+float(i))*0.02);
    d=smin(d,length(p-c)-b.w,0.24);
  }
  float floorPlane=-(p.y+0.4);
  return -smin(-d,-floorPlane,0.12);
}
float dens(vec3 p){
  vec3 q=p*0.85+vec3(uPhase*0.035,uPhase*0.02,-uPhase*0.015);
  vec3 w=texture(uN,q*0.3).rgb-0.5;
  float n1=texture(uN,q*0.75+w*0.4).a;
  float n2=texture(uN,q*2.1+w*0.7+0.37).r;
  float s=sdf(p)-(n1-0.5)*0.3-(n2-0.5)*0.13;
  return clamp(-s*7.5,0.0,1.0)*uDen;
}
vec3 shimmer(vec3 p,out float pw){
  vec4 cn=texture(uN,p*0.42+vec3(uSh*0.05,-uSh*0.035,uSh*0.045)+0.53);
  vec4 cm=texture(uN,p*0.9-vec3(uSh*0.07,0.0,uSh*0.05)+0.21);
  float hue=clamp(cn.b*0.75+cm.a*0.25,0.0,1.0);
  pw=0.45+1.1*smoothstep(0.32,0.78,cn.g*0.6+cm.r*0.4);
  vec3 c1=vec3(0.5,0.72,1.0),c2=vec3(0.42,0.95,1.0),c3=vec3(0.74,0.6,1.0),c4=vec3(0.9,0.95,1.0);
  vec3 a=mix(c1,c2,smoothstep(0.15,0.45,hue));
  vec3 b=mix(c3,c4,smoothstep(0.55,0.85,hue));
  return mix(a,b,smoothstep(0.4,0.62,hue));
}
void main(){
  vec2 ndc=vUv*2.0-1.0;
  vec4 v=uInvProj*vec4(ndc,1.0,1.0);
  vec3 dirWorld=normalize((uCamW*vec4(normalize(v.xyz/v.w),0.0)).xyz);
  vec3 ro=(uW2L*vec4(uCamPos,1.0)).xyz;
  vec3 rd=normalize((uW2L*vec4(dirWorld,0.0)).xyz);
  float b=dot(ro,rd);float c=dot(ro,ro)-2.56;float h=b*b-c;
  if(h<0.0){gl_FragColor=vec4(0.0);return;}
  h=sqrt(h);
  float t0=max(-b-h,0.0),t1=-b+h;
  if(t1<=0.0){gl_FragColor=vec4(0.0);return;}
  const int N=60;
  float st=(t1-t0)/float(N);
  float t=t0+st*hash(gl_FragCoord.xy);
  float T=1.0;vec3 col=vec3(0.0);
  vec3 violet=vec3(0.72,0.58,1.0);
  vec3 flashColor=mix(vec3(0.8,0.9,1.0),vec3(0.75,0.62,1.0),uTint);
  for(int i=0;i<N;i++){
    vec3 p=ro+rd*t;
    float d=dens(p);
    if(d>0.004){
      vec3 lp=vec3(clamp(p.x,-0.85,0.85),0.0,0.0);
      vec3 dv=lp-p;float dist=length(dv);vec3 dir=dv/max(dist,0.001);
      float occ=dens(p+dir*min(0.1,dist*0.5))+dens(p+dir*min(0.26,dist*0.85))*0.8;
      float inner=uGlow*exp(-occ*1.9)/(1.0+dist*dist*5.0);
      float pw;vec3 lc=mix(shimmer(p,pw),violet,uTint*0.7);
      float lum=0.0;
      for(int k=0;k<${FLASH_SLOTS};k++){vec3 fv=p-uF[k].xyz;lum+=uF[k].w*exp(-occ*0.8)/(1.0+10.0*dot(fv,fv));}
      vec3 amb=vec3(0.025,0.04,0.085)*(0.6+0.4*clamp(p.y+0.5,0.0,1.0));
      vec3 L=amb+lc*inner*1.6*pw+flashColor*lum;
      float a=1.0-exp(-d*st*14.0);
      col+=T*a*L;T*=1.0-a;
      if(T<0.015)break;
    }
    t+=st;
  }
  gl_FragColor=vec4(col,1.0-T);
}`;

type Bolt = {
  main: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  over: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  life: number;
  max: number;
  base: number;
};

type Flash = { life: number; max: number; amp: number; pos: THREE.Vector3 };

export function createStormCore(
  canvas: HTMLCanvasElement,
  options: { reducedMotion?: boolean } = {},
): StormCore {
  const reduced = Boolean(options.reducedMotion);
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: true,
    powerPreference: "high-performance",
  });
  const pixelRatio = Math.min(1.25, window.devicePixelRatio || 1);
  renderer.setPixelRatio(pixelRatio);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  camera.position.set(0, 0.05, 5.2);
  const root = new THREE.Group();
  scene.add(root);
  const frame = new THREE.Object3D();
  root.add(frame);

  const noise = buildNoiseTexture();
  const flashUniforms = Array.from({ length: FLASH_SLOTS }, () => new THREE.Vector4());
  const uniforms = {
    uN: { value: noise },
    uInvProj: { value: new THREE.Matrix4() },
    uCamW: { value: new THREE.Matrix4() },
    uW2L: { value: new THREE.Matrix4() },
    uCamPos: { value: new THREE.Vector3() },
    uPhase: { value: 0 },
    uSh: { value: 0 },
    uGlow: { value: 1 },
    uTint: { value: 0 },
    uDen: { value: 1 },
    uF: { value: flashUniforms },
  };
  const cloudMaterial = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    vertexShader: "varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}",
    fragmentShader: CLOUD_FRAGMENT,
  });
  const quadGeometry = new THREE.PlaneGeometry(2, 2);
  const quad = new THREE.Mesh(quadGeometry, cloudMaterial);
  quad.frustumCulled = false;
  quad.renderOrder = 1;
  scene.add(quad);

  const randomDirection = () => {
    const u = Math.random() * 2 - 1;
    const a = Math.random() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    return new THREE.Vector3(s * Math.cos(a), u, s * Math.sin(a));
  };

  const bolts: Bolt[] = [];
  for (let i = 0; i < BOLT_POOL; i++) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array((BOLT_SEGMENTS + 1) * 3), 3));
    const material = new THREE.LineBasicMaterial({
      color: 0xe2f4ff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    const main = new THREE.Line(geometry, material);
    const over = new THREE.Line(geometry, material.clone());
    main.renderOrder = 0;
    over.renderOrder = 3;
    main.frustumCulled = false;
    over.frustumCulled = false;
    frame.add(main, over);
    bolts.push({ main, over, life: 0, max: 1, base: 1 });
  }

  const pathPoints = Array.from({ length: BOLT_SEGMENTS + 1 }, () => new THREE.Vector3());
  const buildPath = (from: THREE.Vector3, to: THREE.Vector3, displacement: number) => {
    pathPoints[0].copy(from);
    pathPoints[BOLT_SEGMENTS].copy(to);
    const subdivide = (i0: number, i1: number, d: number) => {
      if (i1 - i0 < 2) return;
      const mid = (i0 + i1) >> 1;
      pathPoints[mid]
        .copy(pathPoints[i0])
        .lerp(pathPoints[i1], 0.5)
        .add(randomDirection().multiplyScalar(d * (0.4 + Math.random() * 0.6)));
      subdivide(i0, mid, d * 0.55);
      subdivide(mid, i1, d * 0.55);
    };
    subdivide(0, BOLT_SEGMENTS, displacement);
  };
  const emit = (bolt: Bolt, from: THREE.Vector3, to: THREE.Vector3, life: number, base: number) => {
    buildPath(from, to, from.distanceTo(to) * 0.28);
    const attribute = bolt.main.geometry.getAttribute("position") as THREE.BufferAttribute;
    pathPoints.forEach((p, i) => attribute.setXYZ(i, p.x, p.y, p.z));
    attribute.needsUpdate = true;
    bolt.life = life;
    bolt.max = life;
    bolt.base = base;
  };

  const flashes: Flash[] = flashUniforms.map(() => ({ life: 0, max: 1, amp: 0, pos: new THREE.Vector3() }));
  const flash = (pos: THREE.Vector3, amp: number, duration: number) => {
    const slot = flashes.find((f) => f.life <= 0) ?? flashes.reduce((a, b) => (a.life < b.life ? a : b));
    slot.pos.copy(pos);
    slot.amp = amp;
    slot.life = duration;
    slot.max = duration;
  };
  const insidePoint = () => {
    const b = BLOBS[Math.floor(Math.random() * 8)];
    return new THREE.Vector3(b[0], b[1], b[2]).add(randomDirection().multiplyScalar(b[3] * 0.4));
  };
  const strike = (strength = 1) => {
    const bolt = bolts.find((b) => b.life <= 0);
    if (!bolt) return;
    const start = insidePoint();
    const escapes = Math.random() < 0.5 * strength + 0.3;
    const direction = randomDirection();
    direction.y = -Math.abs(direction.y) * 1.2 - 0.35;
    direction.x += Math.sign(start.x || 1) * 0.3;
    direction.normalize();
    const end = escapes
      ? start.clone().addScaledVector(direction, 1.0 + Math.random() * 0.9 * strength)
      : insidePoint();
    const life = 0.16 + Math.random() * 0.3;
    emit(bolt, start, end, life, escapes ? 1 : 0.55);
    const trunk = pathPoints.map((p) => p.clone());
    const branches = escapes ? 1 + Math.floor(Math.random() * 3) : 0;
    for (let k = 0; k < branches; k++) {
      const branch = bolts.find((b) => b.life <= 0);
      if (!branch) break;
      const origin = trunk[10 + Math.floor(Math.random() * 18)];
      const branchDirection = direction.clone().add(randomDirection().multiplyScalar(0.9)).normalize();
      emit(branch, origin, origin.clone().addScaledVector(branchDirection, 0.25 + Math.random() * 0.4), life * 0.8, 0.5);
    }
    flash(start, (2.4 + Math.random() * 2) * strength, life * 1.7);
  };
  const sheet = (amp = 1) => flash(insidePoint(), (1.4 + Math.random() * 1.8) * amp, 0.18 + Math.random() * 0.4);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.6, 0.6, 0.32);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // A wide canvas (the owner console's full-width cloud) stretches the cloud sideways instead of
  // leaving empty sky on both sides. Narrow canvases keep the original shape (stretch 1).
  let stretch = 1;
  const resize = () => {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    renderer.setSize(width, height, false);
    composer.setSize(width, height);
    camera.aspect = width / height;
    camera.position.z = camera.aspect < 1.1 ? (5.2 / Math.max(0.55, camera.aspect)) * 1.05 : 5.2;
    // Edge to edge at the console size (aspect ~2.9 → stretch ~3.4).
    stretch = camera.aspect > 1.7 ? Math.min(4, 1 + (camera.aspect - 1.7) * 2.05) : 1;
    camera.updateProjectionMatrix();
  };
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);

  let pointerX = 0, pointerY = 0, targetX = 0, targetY = 0;
  const onPointerMove = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    targetX = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
    targetY = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
  };
  const onPointerLeave = () => {
    targetX = 0;
    targetY = 0;
  };
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerleave", onPointerLeave);

  let state: StormState = "idle";
  const current: Tuning = { ...STATES.idle };
  const speed = reduced ? 0.35 : 1;
  let phase = 0, shimmerPhase = 0, pulse = 0, boltAccumulator = 0, sheetAccumulator = 0;
  let time = 0, speech = 0, lastSpeech = 0, sway = 0;
  let last = performance.now();
  let raf = 0;
  const inverse = new THREE.Matrix4();

  const tick = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000) * speed;
    last = now;
    time += dt;
    const target = STATES[state];
    const blend = Math.min(1, dt * 2);
    (Object.keys(current) as (keyof Tuning)[]).forEach((key) => {
      current[key] += (target[key] - current[key]) * blend;
    });

    const speechTarget = state === "responding"
      ? Math.max(0, (0.5 + 0.5 * Math.sin(time * 9.3)) * (0.55 + 0.45 * Math.sin(time * 3.9 + 1.3)) * (0.7 + 0.3 * Math.sin(time * 17.1)))
      : 0;
    speech += (speechTarget - speech) * Math.min(1, dt * 14);
    if (state === "responding" && speech > 0.6 && lastSpeech <= 0.6) {
      sheet(1.3);
      if (Math.random() < 0.35) strike(1);
      pulse = Math.max(pulse, 0.3);
    }
    lastSpeech = speech;

    phase += dt * current.flow;
    shimmerPhase += dt * current.shimmer;
    pulse *= Math.exp(-dt * 3);
    const boltRate = reduced ? current.bolts * 0.3 : current.bolts;
    boltAccumulator += dt * boltRate;
    while (boltAccumulator > 1) {
      boltAccumulator -= 1;
      strike(state === "thinking" ? 0.85 : 1);
    }
    sheetAccumulator += dt * current.sheets;
    while (sheetAccumulator > 1) {
      sheetAccumulator -= 1;
      sheet(state === "thinking" ? 1.1 : 0.9);
    }

    flashes.forEach((f, i) => {
      if (f.life > 0) {
        f.life -= dt;
        const envelope = Math.max(0, f.life / f.max);
        const flicker = Math.random() < 0.25 ? 0.3 : 1;
        flashUniforms[i].set(f.pos.x, f.pos.y, f.pos.z, f.amp * envelope * flicker);
      } else {
        flashUniforms[i].w = 0;
      }
    });
    bolts.forEach((b) => {
      if (b.life > 0) {
        b.life -= dt;
        const envelope = Math.max(0, b.life / b.max);
        const flicker = Math.random() < 0.3 ? 0.25 : 1;
        b.main.material.opacity = envelope * flicker * b.base;
        b.over.material.opacity = envelope * flicker * 0.5 * b.base;
      } else {
        b.main.material.opacity = 0;
        b.over.material.opacity = 0;
      }
    });

    const breath = state === "listening" ? 0.22 * Math.sin(time * 1.5) : 0;
    uniforms.uPhase.value = phase;
    uniforms.uSh.value = shimmerPhase;
    uniforms.uGlow.value = Math.max(0.2, current.glow + breath + speech * 0.45 + pulse * 0.25);
    uniforms.uTint.value = current.tint;
    uniforms.uDen.value = current.density;

    frame.scale.setScalar(1 + 0.012 * Math.sin(time * 1.1) + pulse * 0.025 + speech * 0.015);
    frame.scale.x *= stretch;
    pointerX += (targetX - pointerX) * dt * 2.5;
    pointerY += (targetY - pointerY) * dt * 2.5;
    sway += dt * current.sway;
    // A stretched cloud turns less, so its far end does not swing into depth.
    root.rotation.y = (Math.sin(sway * 0.25) * 0.45 + pointerX * 0.6) / (stretch * stretch);
    root.rotation.x = pointerY * 0.25 + Math.sin(sway * 0.2) * 0.05;
    root.position.y = Math.sin(time * 0.8) * 0.03;

    camera.updateMatrixWorld();
    root.updateMatrixWorld(true);
    uniforms.uInvProj.value.copy(camera.projectionMatrixInverse);
    uniforms.uCamW.value.copy(camera.matrixWorld);
    uniforms.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
    uniforms.uW2L.value.copy(inverse.copy(frame.matrixWorld).invert());
    bloom.strength = current.bloom + pulse * 0.2;

    composer.render(dt);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return {
    setState(next) {
      if (next === state) return;
      state = next;
      pulse = 1;
      strike(1.3);
    },
    burst() {
      pulse = 1;
      for (let i = 0; i < 3; i++) strike(1.5);
      sheet(3);
    },
    dispose() {
      cancelAnimationFrame(raf);
      observer.disconnect();
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      bolts.forEach((b) => {
        b.main.geometry.dispose();
        b.main.material.dispose();
        b.over.material.dispose();
      });
      quadGeometry.dispose();
      cloudMaterial.dispose();
      noise.dispose();
      bloom.dispose();
      composer.dispose();
      renderer.dispose();
    },
  };
}
