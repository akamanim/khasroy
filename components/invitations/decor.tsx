import { useId, type CSSProperties } from "react";

/* Hand-drawn SVG motifs for invitation templates. Colours come from CSS variables
   on the invitation root, so every motif follows its template's palette. */

function uid(raw: string) {
  return raw.replace(/[^a-zA-Z0-9_-]/gu, "");
}

const PETAL = "M0 0 C -19 -6 -26 -30 -14 -42 C -8 -48 -3 -44 0 -47 C 3 -44 8 -48 14 -42 C 26 -30 19 -6 0 0Z";
const LEAF = "M0 0 C 12 -18 32 -25 50 -22 C 37 -8 19 1 0 0Z";

function Peony({ x, y, r, rot = 0 }: { x: number; y: number; r: number; rot?: number }) {
  const s = r / 46;
  const ring = (n: number, scale: number, offset: number, cls: string) =>
    Array.from({ length: n }, (_, i) => (
      <path key={`${cls}${i}`} d={PETAL} className={cls} transform={`rotate(${(360 / n) * i + offset}) scale(${scale})`} />
    ));
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${s})`}>
      {ring(9, 1, 0, "petalOuter")}
      {ring(8, 0.78, 20, "petalMid")}
      {ring(6, 0.52, 8, "petalInner")}
      <circle r="7" className="petalHeart" />
    </g>
  );
}

function Leaf({ x, y, rot, s = 1 }: { x: number; y: number; rot: number; s?: number }) {
  return <path d={LEAF} className="leaf" transform={`translate(${x} ${y}) rotate(${rot}) scale(${s})`} />;
}

export function PeonyCluster({ className, flip = false }: { className?: string; flip?: boolean }) {
  return (
    <svg className={className} viewBox="0 0 260 200" aria-hidden="true" style={flip ? { transform: "scale(-1,-1)" } : undefined}>
      <Leaf x={70} y={88} rot={-150} s={1.4} />
      <Leaf x={92} y={70} rot={-60} s={1.3} />
      <Leaf x={150} y={52} rot={-20} s={1.1} />
      <Leaf x={40} y={120} rot={160} s={1.1} />
      <Leaf x={190} y={40} rot={10} s={0.9} />
      <path d="M150 52 C 175 40, 205 30, 240 26" className="stem" />
      <Peony x={70} y={70} r={58} rot={10} />
      <Peony x={150} y={40} r={34} rot={-20} />
      <Peony x={30} y={140} r={26} rot={40} />
      <circle cx="222" cy="30" r="8" className="petalMid" />
      <circle cx="240" cy="25" r="5" className="petalOuter" />
    </svg>
  );
}

/* Kochkor müyüz (ram's horn): the core Kyrgyz ornament. */
const HORN =
  "M0 0 C 0 -22 4 -34 16 -42 C 30 -51 46 -44 46 -30 C 46 -19 36 -14 29 -19 C 24 -23 27 -31 33 -29";

export function HornPair({ size = 1 }: { size?: number }) {
  return (
    <g transform={`scale(${size})`}>
      <path d={HORN} className="horn" />
      <path d={HORN} className="horn" transform="scale(-1,1)" />
      <path d="M0 0 V 18" className="horn" />
      <path d="M0 18 L -7 26 L 0 34 L 7 26 Z" className="hornFill" />
    </g>
  );
}

export function HornCorners({ className }: { className?: string }) {
  const corner = (
    <svg viewBox="-10 -10 80 80" aria-hidden="true">
      <g transform="translate(36 36) rotate(-45)">
        <HornPair size={0.8} />
      </g>
    </svg>
  );
  return (
    <div className={className} aria-hidden="true">
      <span className="hcTL">{corner}</span>
      <span className="hcTR">{corner}</span>
      <span className="hcBL">{corner}</span>
      <span className="hcBR">{corner}</span>
    </div>
  );
}

export function HornBand({ className }: { className?: string }) {
  const id = `hb-${uid(useId())}`;
  return (
    <svg className={className} viewBox="0 0 320 40" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <pattern id={id} width="64" height="40" patternUnits="userSpaceOnUse">
          <g transform="translate(32 30) scale(.55)">
            <HornPair />
          </g>
          <path d="M0 37 H64 M0 3 H64" className="hornThin" />
        </pattern>
      </defs>
      <rect width="320" height="40" fill={`url(#${id})`} />
    </svg>
  );
}

export function HornDivider({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="-90 -48 180 90" aria-hidden="true">
      <path d="M-88 4 H-30 M30 4 H88" className="hornThin" />
      <g transform="translate(0 8) scale(.85)">
        <HornPair />
      </g>
    </svg>
  );
}

/* Shyrdak: felt mosaic with contrasting stitched outlines. */
export function ShyrdakMedallion({ className }: { className?: string }) {
  const quad = (
    <g>
      <path d="M0 -8 C -8 -40 -38 -46 -50 -30 C -60 -16 -48 2 -34 -4 C -24 -9 -28 -22 -36 -20" className="feltA" />
      <path d="M0 -8 C -8 -40 -38 -46 -50 -30 C -60 -16 -48 2 -34 -4 C -24 -9 -28 -22 -36 -20" className="stitch" />
    </g>
  );
  return (
    <svg className={className} viewBox="-120 -120 240 240" aria-hidden="true">
      <circle r="112" className="feltB" />
      <circle r="104" className="stitch" />
      {[0, 90, 180, 270].map((r) => (
        <g key={r} transform={`rotate(${r})`}>
          {quad}
          <g transform="scale(-1,1)">{quad}</g>
        </g>
      ))}
      <rect x="-18" y="-18" width="36" height="36" transform="rotate(45)" className="feltC" />
      <rect x="-12" y="-12" width="24" height="24" transform="rotate(45)" className="stitch" />
    </svg>
  );
}

export function ShyrdakBorder({ className }: { className?: string }) {
  const id = `sb-${uid(useId())}`;
  return (
    <svg className={className} viewBox="0 0 320 28" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <pattern id={id} width="40" height="28" patternUnits="userSpaceOnUse">
          <path d="M0 28 L20 4 L40 28 Z" className="feltA" />
          <path d="M20 28 L30 16 L40 28 Z M0 28 L10 16 L20 28 Z" className="feltC" />
          <path d="M3 26 L20 6 L37 26" className="stitch" />
        </pattern>
      </defs>
      <rect width="320" height="28" fill={`url(#${id})`} />
    </svg>
  );
}

/* Tunduk: the crown of the yurt. */
export function Tunduk({ className }: { className?: string }) {
  const R = 86;
  const bars = [-30, 0, 30];
  return (
    <svg className={className} viewBox="-160 -160 320 320" aria-hidden="true">
      {Array.from({ length: 36 }, (_, i) => {
        const a = (i / 36) * Math.PI * 2;
        return (
          <line
            key={i}
            x1={Math.cos(a) * 98}
            y1={Math.sin(a) * 98}
            x2={Math.cos(a) * 156}
            y2={Math.sin(a) * 156}
            className="uuk"
          />
        );
      })}
      <circle r="98" className="ringOuter" />
      <circle r={R} className="ringInner" />
      {bars.map((o) => {
        const half = Math.sqrt(R * R - o * o);
        return (
          <g key={o}>
            <path d={`M ${-half} ${o} Q 0 ${o - 16} ${half} ${o}`} className="lattice" />
            <path d={`M ${o} ${-half} Q ${o - 16} 0 ${o} ${half}`} className="lattice" />
          </g>
        );
      })}
    </svg>
  );
}

/* Celestial: deterministic star field, moon and a constellation. */
function seeded(i: number, salt: number) {
  const v = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

export function StarField({ className, count = 70 }: { className?: string; count?: number }) {
  return (
    <svg className={className} viewBox="0 0 400 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <circle
          key={i}
          cx={seeded(i, 1) * 400}
          cy={seeded(i, 2) * 900}
          r={0.5 + seeded(i, 3) * 1.4}
          className="star"
          style={{ animationDelay: `${(seeded(i, 4) * 4).toFixed(2)}s`, animationDuration: `${(2.5 + seeded(i, 5) * 3).toFixed(2)}s` } as CSSProperties}
        />
      ))}
    </svg>
  );
}

export function MoonConstellation({ className }: { className?: string }) {
  const pts = [
    [40, 70],
    [86, 48],
    [130, 64],
    [170, 34],
    [214, 52],
    [196, 92],
  ];
  return (
    <svg className={className} viewBox="0 0 320 130" aria-hidden="true">
      <polyline points={pts.map((p) => p.join(",")).join(" ")} className="constLine" />
      {pts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i === 3 ? 3.2 : 2.2} className="constStar" />
      ))}
      <g transform="translate(270 56)">
        <circle r="30" className="moonGlow" />
        <path d="M0 -24 A24 24 0 1 0 0 24 A30 30 0 0 1 0 -24Z" className="moon" />
      </g>
    </svg>
  );
}

/* Art deco: sunburst fan and stepped corners. */
export function Sunburst({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="-150 -150 300 160" aria-hidden="true">
      {Array.from({ length: 19 }, (_, i) => {
        const a = Math.PI + (i / 18) * Math.PI;
        return <line key={i} x1={Math.cos(a) * 34} y1={Math.sin(a) * 34} x2={Math.cos(a) * 146} y2={Math.sin(a) * 146} className="ray" />;
      })}
      {[34, 70, 108, 146].map((r) => (
        <path key={r} d={`M ${-r} 0 A ${r} ${r} 0 0 1 ${r} 0`} className="arc" />
      ))}
      <path d="M -150 0 H 150" className="arc" />
    </svg>
  );
}

export function DecoCorners({ className }: { className?: string }) {
  const corner = (
    <svg viewBox="0 0 72 72" aria-hidden="true">
      <path d="M1 72 V1 H72 M11 72 V11 H72 M21 46 V21 H46 M1 1 L21 21" className="decoCorner" />
    </svg>
  );
  return (
    <div className={className} aria-hidden="true">
      <span className="hcTL">{corner}</span>
      <span className="hcTR">{corner}</span>
      <span className="hcBL">{corner}</span>
      <span className="hcBR">{corner}</span>
    </div>
  );
}

export function DecoDivider({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="-100 -14 200 28" aria-hidden="true">
      <path d="M-96 0 H-22 M22 0 H96 M-96 -5 H-40 M40 -5 H96" className="arc" />
      <path d="M0 -12 L12 0 L0 12 L-12 0 Z" className="decoGem" />
      <path d="M0 -6 L6 0 L0 6 L-6 0 Z" className="ray" />
    </svg>
  );
}

/* Party: balloons and confetti. */
export function Balloons({ className, colors }: { className?: string; colors: string[] }) {
  const spots = [
    [70, 110, -8],
    [130, 80, 6],
    [190, 118, 12],
  ];
  return (
    <svg className={className} viewBox="0 0 260 260" aria-hidden="true">
      {spots.map(([x, y, r], i) => (
        <g key={i} transform={`rotate(${r} ${x} ${y})`}>
          <g className="balloon" style={{ animationDelay: `${i * 0.7}s` } as CSSProperties}>
          <path d={`M ${x} ${y + 44} C ${x - 6} ${y + 80}, ${x + 10} ${y + 110}, ${x - 2} ${y + 150}`} className="string" />
          <ellipse cx={x} cy={y} rx="34" ry="42" fill={colors[i % colors.length]} />
          <ellipse cx={x - 12} cy={y - 16} rx="7" ry="12" fill="#fff" opacity=".35" />
          <path d={`M ${x - 5} ${y + 45} L ${x + 5} ${y + 45} L ${x} ${y + 39} Z`} fill={colors[i % colors.length]} />
          </g>
        </g>
      ))}
    </svg>
  );
}

export function Confetti({ className, colors, count = 34 }: { className?: string; colors: string[]; count?: number }) {
  return (
    <div className={className} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <i
          key={i}
          style={{
            left: `${(seeded(i, 7) * 100).toFixed(1)}%`,
            background: colors[i % colors.length],
            animationDelay: `${(seeded(i, 8) * -9).toFixed(2)}s`,
            animationDuration: `${(6 + seeded(i, 9) * 6).toFixed(2)}s`,
            width: `${(5 + seeded(i, 10) * 6).toFixed(1)}px`,
            height: `${(8 + seeded(i, 11) * 8).toFixed(1)}px`,
            borderRadius: i % 3 === 0 ? "50%" : "2px",
          }}
        />
      ))}
    </div>
  );
}

export function Clouds({ className }: { className?: string }) {
  const cloud = "M0 30 C0 14 16 6 28 12 C34 0 56 -2 64 12 C78 8 92 18 88 32 Z";
  return (
    <svg className={className} viewBox="0 0 400 160" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <path d={cloud} className="cloud" transform="translate(20 40) scale(1.2)" />
      <path d={cloud} className="cloud" transform="translate(280 20) scale(1.4)" />
      <path d={cloud} className="cloud cloudFar" transform="translate(170 100) scale(.8)" />
    </svg>
  );
}

/* Tian Shan: layered ridges at dawn. */
export function Mountains({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 400 220" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <circle cx="292" cy="92" r="34" className="sun" />
      <path d="M0 150 L48 104 L82 128 L140 66 L196 120 L246 84 L300 130 L352 92 L400 118 V220 H0 Z" className="ridge4" />
      <path d="M126 80 L140 66 L154 80 L146 78 L140 84 L133 77 Z M236 94 L246 84 L256 94 L249 92 L244 97 Z" className="snow" />
      <path d="M0 168 L60 128 L110 150 L170 112 L226 152 L284 120 L340 156 L400 136 V220 H0 Z" className="ridge3" />
      <path d="M0 190 L70 158 L130 182 L200 150 L266 186 L330 160 L400 182 V220 H0 Z" className="ridge2" />
      <path d="M0 206 C 80 186, 150 214, 220 198 C 290 184, 340 208, 400 198 V220 H0 Z" className="ridge1" />
      <path d="M86 52 q6 -6 12 0 q6 -6 12 0 M118 38 q5 -5 10 0 q5 -5 10 0" className="bird" />
    </svg>
  );
}

/* Retro postcard: postage stamp and postmark. */
export function Stamp({ className, label }: { className?: string; label: string }) {
  return (
    <div className={className} aria-hidden="true">
      <svg viewBox="0 0 100 120">
        <rect x="8" y="8" width="84" height="104" className="stampInner" />
        <path d="M8 88 L30 58 L46 74 L64 46 L92 88 Z" className="stampMount" />
        <path d="M58 54 L64 46 L70 54 Z" className="stampSnow" />
        <circle cx="30" cy="34" r="10" className="stampSun" />
        <text x="50" y="104" textAnchor="middle" className="stampText">{label}</text>
      </svg>
    </div>
  );
}

export function Postmark({ className, text }: { className?: string; text: string }) {
  const id = `pm-${uid(useId())}`;
  return (
    <svg className={className} viewBox="-70 -70 220 140" aria-hidden="true">
      <defs>
        <path id={id} d="M -44 0 A 44 44 0 1 1 44 0 A 44 44 0 1 1 -44 0" />
      </defs>
      <circle r="52" className="pmRing" />
      <circle r="34" className="pmRing" />
      <text className="pmText">
        <textPath href={`#${id}`} startOffset="0">{text}</textPath>
      </text>
      <path d="M 58 -14 q 10 -8 20 0 t 20 0 t 20 0 t 20 0 M 58 0 q 10 -8 20 0 t 20 0 t 20 0 t 20 0 M 58 14 q 10 -8 20 0 t 20 0 t 20 0 t 20 0" className="pmWave" />
    </svg>
  );
}

/* Tushoo toi: baby footprints and the black-and-white cord. */
function Foot({ x, y, rot, left }: { x: number; y: number; rot: number; left: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${left ? -1 : 1},1)`} className="foot">
      <path d="M0 0 C -9 -2 -11 -16 -8 -26 C -5 -36 6 -38 9 -28 C 12 -18 8 -8 6 0 C 5 6 2 9 0 8 C -3 7 0 3 0 0 Z" />
      <circle cx="-8" cy="-34" r="3" />
      <circle cx="-2" cy="-38" r="2.6" />
      <circle cx="3.5" cy="-38" r="2.3" />
      <circle cx="8" cy="-35" r="2" />
      <circle cx="11" cy="-31" r="1.7" />
    </g>
  );
}

export function Footprints({ className }: { className?: string }) {
  const steps = [
    [40, 190, 18],
    [78, 160, 24],
    [104, 120, 20],
    [142, 96, 30],
    [170, 58, 34],
    [210, 40, 40],
  ];
  return (
    <svg className={className} viewBox="0 0 260 220" aria-hidden="true">
      {steps.map(([x, y, r], i) => (
        <Foot key={i} x={x} y={y} rot={r} left={i % 2 === 0} />
      ))}
    </svg>
  );
}

export function Cord({ className }: { className?: string }) {
  const id = `cd-${uid(useId())}`;
  return (
    <svg className={className} viewBox="0 0 240 18" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <pattern id={id} width="10" height="18" patternUnits="userSpaceOnUse">
          <path d="M-2 16 L5 2 L10 2 L3 16 Z" className="cordDark" />
          <path d="M8 16 L15 2 L20 2 L13 16 Z" className="cordDark" />
        </pattern>
      </defs>
      <rect x="1" y="2" width="238" height="14" rx="7" className="cordLight" />
      <rect x="1" y="2" width="238" height="14" rx="7" fill={`url(#${id})`} />
      <rect x="1" y="2" width="238" height="14" rx="7" className="cordEdge" />
    </svg>
  );
}

/* Minimal: a thin double-ring for the monogram. */
export function Rings({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="-60 -60 120 120" aria-hidden="true">
      <circle r="56" className="ring" />
      <circle r="50" className="ringThin" />
    </svg>
  );
}

export function NeonHorizon({ className }: { className?: string }) {
  return (
    <div className={className} aria-hidden="true">
      <span className="neonSun" />
      <span className="neonGrid" />
    </div>
  );
}

/* Generic drifting particles: position and timing come from CSS variables,
   the look and the motion from each template's stylesheet. */
export function Particles({ className, count }: { className?: string; count: number }) {
  return (
    <div className={className} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <i
          key={i}
          style={
            {
              "--x": `${(seeded(i, 21) * 100).toFixed(1)}%`,
              "--y": `${(seeded(i, 22) * 100).toFixed(1)}%`,
              "--d": `${(seeded(i, 23) * -14).toFixed(2)}s`,
              "--t": `${(7 + seeded(i, 24) * 8).toFixed(2)}s`,
              "--s": (0.6 + seeded(i, 25) * 0.8).toFixed(2),
              "--r": `${Math.round(seeded(i, 26) * 360)}deg`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

/* Evening steppe: low sun, rolling hills, yurts with smoke from the tunduk. */
function Yurt({ x, y, s }: { x: number; y: number; s: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} className="yurt">
      <path d="M-30 0 V-14 Q-30 -20 -24 -22 L0 -34 L24 -22 Q30 -20 30 -14 V0 Z" className="yurtBody" />
      <path d="M-24 -22 L0 -34 L24 -22" className="yurtTrim" />
      <path d="M-30 -11 H30" className="yurtBand" />
      <rect x="-5" y="-11" width="10" height="11" className="yurtDoor" />
      <path d="M0 -36 C -3 -46 4 -52 0 -62 C -4 -72 3 -78 0 -88" className="smoke" />
    </g>
  );
}

export function SteppeSunset({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 400 260" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <circle cx="270" cy="150" r="54" className="steppeSun" />
      <circle cx="270" cy="150" r="80" className="steppeSunHalo" />
      <path d="M70 70 q6 -6 12 0 q6 -6 12 0 M104 56 q5 -5 10 0 q5 -5 10 0 M330 60 q5 -5 10 0 q5 -5 10 0" className="steppeBird" />
      <path d="M0 176 C 70 150, 130 168, 200 158 C 270 148, 330 170, 400 156 V260 H0 Z" className="hill3" />
      <path d="M0 198 C 80 178, 150 196, 230 186 C 300 178, 350 196, 400 188 V260 H0 Z" className="hill2" />
      <Yurt x={118} y={196} s={0.9} />
      <Yurt x={162} y={200} s={0.62} />
      <path d="M0 222 C 90 208, 170 228, 250 216 C 320 206, 360 224, 400 216 V260 H0 Z" className="hill1" />
    </svg>
  );
}
