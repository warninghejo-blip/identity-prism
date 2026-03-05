/**
 * CosmicHub V12 — 3D coin badges with printed icons.
 * Each module = metallic spinning coin with canvas-drawn icon on face.
 */
import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Canvas, useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { PrismBalance } from '@/lib/prismCoin';
import { trackInternalNavigation } from '@/lib/safeNavigate';

/* ── Modules ── */
interface HubModuleDef { id: string; label: string; route: string; color: string; }
const MODULES: HubModuleDef[] = [
  { id: 'league',        label: 'Prism League',  route: '/game',          color: '#22d3ee' },
  { id: 'blackhole',     label: 'Black Hole',    route: '/blackhole',     color: '#a855f7' },
  { id: 'forge',         label: 'Coin Shop',     route: '/forge',         color: '#f59e0b' },
  { id: 'constellation', label: 'Stellar Nexus', route: '/constellation', color: '#10b981' },
  { id: 'market',        label: 'Prism Arena',   route: '/market',        color: '#ec4899' },
  { id: 'leaderboard',   label: 'Leaderboard',   route: '/leaderboard',   color: '#fbbf24' },
];

/* ── Shared coin geometries ── */
const _coinBody = (() => { const g = new THREE.CylinderGeometry(0.44, 0.44, 0.07, 48); g.rotateX(Math.PI / 2); return g; })();
const _coinRim  = (() => { const g = new THREE.TorusGeometry(0.44, 0.035, 12, 48); g.rotateX(Math.PI / 2); return g; })();
const _coinFace = new THREE.CircleGeometry(0.37, 48);

/* ── Icon textures (canvas-drawn, lazy) ── */
type DrawFn = (c: CanvasRenderingContext2D, s: number) => void;

function makeIconTex(bg: string, draw: DrawFn): THREE.CanvasTexture {
  const s = 256, cv = document.createElement('canvas');
  cv.width = s; cv.height = s;
  const c = cv.getContext('2d')!;
  // dark circular background
  c.fillStyle = bg;
  c.beginPath(); c.arc(s / 2, s / 2, s / 2 - 2, 0, Math.PI * 2); c.fill();
  // draw icon
  draw(c, s);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const drawRocket: DrawFn = (c, s) => {
  c.fillStyle = '#fff'; c.shadowColor = '#fff'; c.shadowBlur = 10;
  const x = s / 2;
  c.beginPath(); c.moveTo(x, s * .14); c.lineTo(x - s * .11, s * .4); c.lineTo(x + s * .11, s * .4); c.closePath(); c.fill();
  c.fillRect(x - s * .09, s * .4, s * .18, s * .25);
  c.beginPath(); c.moveTo(x - s * .09, s * .55); c.lineTo(x - s * .19, s * .72); c.lineTo(x - s * .09, s * .65); c.closePath(); c.fill();
  c.beginPath(); c.moveTo(x + s * .09, s * .55); c.lineTo(x + s * .19, s * .72); c.lineTo(x + s * .09, s * .65); c.closePath(); c.fill();
  c.shadowColor = '#f80'; c.fillStyle = '#ff8844';
  c.beginPath(); c.moveTo(x - s * .06, s * .65); c.lineTo(x, s * .83); c.lineTo(x + s * .06, s * .65); c.closePath(); c.fill();
  c.fillStyle = '#ffdd55'; c.beginPath(); c.moveTo(x - s * .03, s * .65); c.lineTo(x, s * .78); c.lineTo(x + s * .03, s * .65); c.closePath(); c.fill();
  c.shadowColor = '#fff'; c.fillStyle = 'rgba(255,255,255,0.6)';
  c.beginPath(); c.arc(x, s * .44, s * .03, 0, Math.PI * 2); c.fill();
};

const drawBlackHole: DrawFn = (c, s) => {
  const x = s / 2, y = s / 2;
  c.fillStyle = '#000'; c.shadowColor = '#a855f7'; c.shadowBlur = 15;
  c.beginPath(); c.arc(x, y, s * .12, 0, Math.PI * 2); c.fill();
  c.strokeStyle = '#c084fc'; c.lineWidth = 3; c.shadowBlur = 20;
  c.beginPath(); c.arc(x, y, s * .14, 0, Math.PI * 2); c.stroke();
  c.strokeStyle = '#fb923c'; c.lineWidth = 5; c.shadowColor = '#f97316'; c.shadowBlur = 12;
  c.beginPath(); c.ellipse(x, y, s * .3, s * .08, -0.25, 0, Math.PI * 2); c.stroke();
  c.strokeStyle = '#a855f7'; c.lineWidth = 2; c.shadowColor = '#a855f7';
  c.beginPath(); c.ellipse(x, y, s * .22, s * .06, -0.25, 0, Math.PI * 2); c.stroke();
  c.fillStyle = '#c4b5fd'; c.shadowBlur = 8; c.globalAlpha = 0.5;
  c.fillRect(x - 2, y - s * .38, 4, s * .2);
  c.fillRect(x - 2, y + s * .18, 4, s * .2);
  c.globalAlpha = 1;
};

const drawDiamond: DrawFn = (c, s) => {
  const x = s / 2;
  c.shadowColor = '#fbbf24'; c.shadowBlur = 12;
  c.fillStyle = '#fef3c7';
  c.beginPath(); c.moveTo(x - s * .22, s * .38); c.lineTo(x, s * .15); c.lineTo(x + s * .22, s * .38); c.closePath(); c.fill();
  c.fillStyle = '#f59e0b';
  c.beginPath(); c.moveTo(x - s * .22, s * .38); c.lineTo(x, s * .85); c.lineTo(x + s * .22, s * .38); c.closePath(); c.fill();
  c.strokeStyle = 'rgba(255,255,255,0.4)'; c.lineWidth = 1;
  c.beginPath(); c.moveTo(x - s * .22, s * .38); c.lineTo(x + s * .22, s * .38); c.stroke();
  c.beginPath(); c.moveTo(x, s * .15); c.lineTo(x, s * .85); c.stroke();
  c.fillStyle = 'rgba(255,255,255,0.6)'; c.beginPath(); c.arc(x, s * .38, s * .03, 0, Math.PI * 2); c.fill();
};

const drawConstellation: DrawFn = (c, s) => {
  const cx = s / 2, cy = s / 2;
  const pts: [number, number][] = [[cx, cy], [cx + s * .18, cy - s * .15], [cx - s * .17, cy - s * .12], [cx + s * .14, cy + s * .18], [cx - s * .16, cy + s * .15], [cx + s * .04, cy - s * .28]];
  c.strokeStyle = 'rgba(110,231,183,0.5)'; c.lineWidth = 2; c.shadowColor = '#10b981'; c.shadowBlur = 6;
  [[0,1],[0,2],[0,3],[0,4],[1,5],[1,2],[3,4]].forEach(([a, b]) => { c.beginPath(); c.moveTo(pts[a][0], pts[a][1]); c.lineTo(pts[b][0], pts[b][1]); c.stroke(); });
  c.fillStyle = '#a7f3d0'; c.shadowBlur = 10;
  pts.forEach(([px, py], i) => { c.beginPath(); c.arc(px, py, i === 0 ? s * .04 : s * .025, 0, Math.PI * 2); c.fill(); });
};

const drawPlanet: DrawFn = (c, s) => {
  const x = s / 2, y = s / 2;
  c.shadowColor = '#ec4899'; c.shadowBlur = 12;
  const g = c.createRadialGradient(x - s * .05, y - s * .05, 0, x, y, s * .18);
  g.addColorStop(0, '#fce7f3'); g.addColorStop(0.5, '#f472b6'); g.addColorStop(1, '#9d174d');
  c.fillStyle = g; c.beginPath(); c.arc(x, y, s * .18, 0, Math.PI * 2); c.fill();
  c.strokeStyle = '#fbcfe8'; c.lineWidth = 4; c.shadowBlur = 8;
  c.beginPath(); c.ellipse(x, y, s * .32, s * .07, -0.4, 0, Math.PI * 2); c.stroke();
  c.strokeStyle = '#f9a8d4'; c.lineWidth = 2;
  c.beginPath(); c.ellipse(x, y, s * .28, s * .05, -0.4, 0, Math.PI * 2); c.stroke();
};

const drawTrophy: DrawFn = (c, s) => {
  const x = s / 2;
  c.shadowColor = '#fbbf24'; c.shadowBlur = 10;
  c.fillStyle = '#fbbf24';
  c.beginPath(); c.moveTo(x - s * .18, s * .2); c.lineTo(x - s * .14, s * .55); c.quadraticCurveTo(x, s * .68, x + s * .14, s * .55);
  c.lineTo(x + s * .18, s * .2); c.closePath(); c.fill();
  c.fillStyle = '#92400e'; c.fillRect(x - s * .04, s * .6, s * .08, s * .12);
  c.fillStyle = '#fbbf24'; c.fillRect(x - s * .12, s * .72, s * .24, s * .08);
  c.strokeStyle = '#fbbf24'; c.lineWidth = 3; c.shadowBlur = 6;
  c.beginPath(); c.arc(x - s * .22, s * .32, s * .07, -1, 1.2); c.stroke();
  c.beginPath(); c.arc(x + s * .22, s * .32, s * .07, Math.PI - 1.2, Math.PI + 1); c.stroke();
  c.fillStyle = 'rgba(255,255,255,0.5)'; c.beginPath(); c.arc(x, s * .38, s * .03, 0, Math.PI * 2); c.fill();
};

const drawCrystal: DrawFn = (c, s) => {
  const x = s / 2, y = s / 2, r = s * .22;
  c.shadowColor = '#22d3ee'; c.shadowBlur = 15; c.fillStyle = '#a5f3fc';
  c.beginPath();
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 - Math.PI / 2; c[i === 0 ? 'moveTo' : 'lineTo'](x + Math.cos(a) * r, y + Math.sin(a) * r); }
  c.closePath(); c.fill();
  c.fillStyle = 'rgba(34,211,238,0.5)';
  c.beginPath();
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 - Math.PI / 2; const r2 = (i % 2 === 0) ? r * .55 : r * .35; c[i === 0 ? 'moveTo' : 'lineTo'](x + Math.cos(a) * r2, y + Math.sin(a) * r2); }
  c.closePath(); c.fill();
  c.fillStyle = 'rgba(255,255,255,0.5)'; c.beginPath(); c.arc(x - s * .06, y - s * .06, s * .03, 0, Math.PI * 2); c.fill();
};

let _texMap: Record<string, THREE.CanvasTexture> | null = null;
function getTextures() {
  if (_texMap) return _texMap;
  _texMap = {
    league: makeIconTex('#0a2830', drawRocket),
    blackhole: makeIconTex('#1a0828', drawBlackHole),
    forge: makeIconTex('#2a1a05', drawDiamond),
    constellation: makeIconTex('#052018', drawConstellation),
    market: makeIconTex('#2a0818', drawPlanet),
    leaderboard: makeIconTex('#2a2005', drawTrophy),
    __center: makeIconTex('#0a2830', drawCrystal),
  };
  return _texMap;
}

/* ── CoinBadge ── */
function CoinBadge({ position, color, texId, isHovered, onClick, onHover, label }: {
  position: [number, number, number]; color: string; texId: string;
  isHovered: boolean; onClick: (e: any) => void; onHover: (h: boolean) => void; label: string;
}) {
  const outerRef = useRef<THREE.Group>(null);
  const innerRef = useRef<THREE.Group>(null);
  const scaleRef = useRef(1);
  const col = useMemo(() => new THREE.Color(color), [color]);
  const lightCol = useMemo(() => new THREE.Color(color).lerp(new THREE.Color(1, 1, 1), 0.35), [color]);
  const tex = getTextures()[texId];

  useFrame((_, dt) => {
    const target = isHovered ? 1.18 : 1;
    scaleRef.current += (target - scaleRef.current) * Math.min(dt * 10, 1);
    if (outerRef.current) outerRef.current.scale.setScalar(scaleRef.current);
    if (innerRef.current) innerRef.current.rotation.y += dt * 0.5;
  });

  return (
    <group ref={outerRef} position={position}>
      <group ref={innerRef}>
        <mesh geometry={_coinBody}>
          <meshPhysicalMaterial color={col} metalness={0.75} roughness={0.12} clearcoat={1} clearcoatRoughness={0.05} />
        </mesh>
        <mesh geometry={_coinRim}>
          <meshStandardMaterial color={lightCol} metalness={0.85} roughness={0.08} />
        </mesh>
        <mesh geometry={_coinFace} position={[0, 0, 0.036]}>
          <meshBasicMaterial map={tex} />
        </mesh>
        <mesh geometry={_coinFace} position={[0, 0, -0.036]} rotation={[0, Math.PI, 0]}>
          <meshBasicMaterial map={tex} />
        </mesh>
      </group>
      <mesh onClick={onClick} onPointerOver={(e: any) => { e.stopPropagation(); onHover(true); document.body.style.cursor = 'pointer'; }} onPointerOut={() => { onHover(false); document.body.style.cursor = ''; }}>
        <sphereGeometry args={[0.52, 10, 10]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {label && <Html center distanceFactor={5} position={[0, -0.7, 0]} style={{ pointerEvents: 'none', userSelect: 'none' }}>
        <span style={{ color: isHovered ? color : 'rgba(255,255,255,0.35)', fontSize: 9, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' as const, whiteSpace: 'nowrap' as const, textShadow: isHovered ? `0 0 14px ${color}80, 0 0 4px ${color}40` : '0 1px 6px rgba(0,0,0,0.9)', transition: 'color 0.3s', background: 'transparent' }}>{label}</span>
      </Html>}
    </group>
  );
}

/* ── Orbital Rings ── */
function OrbitalRings({ r }: { r: number }) {
  const o1 = useRef<THREE.Mesh>(null);
  const o2 = useRef<THREE.Mesh>(null);
  useFrame(({ clock: { elapsedTime: t } }) => {
    if (o1.current) { const a = t * .35; o1.current.position.set(Math.cos(a) * r * 1.1, Math.sin(a) * r * 1.1, 0); }
    if (o2.current) { const a = -t * .25 + 2; o2.current.position.set(Math.cos(a) * r * .85, Math.sin(a) * r * .85, 0); }
  });
  return (
    <>
      <mesh rotation={[1.2, 0, 0]}><torusGeometry args={[r * 1.1, .008, 8, 120]} /><meshBasicMaterial color="#22d3ee" transparent opacity={.1} /></mesh>
      <mesh rotation={[1.0, .3, 0]}><torusGeometry args={[r * .85, .006, 8, 100]} /><meshBasicMaterial color="#8b5cf6" transparent opacity={.07} /></mesh>
      <mesh rotation={[1.35, -.2, 0]}><torusGeometry args={[r * .95, .005, 8, 100]} /><meshBasicMaterial color="#f59e0b" transparent opacity={.05} /></mesh>
      <group rotation={[1.2, 0, 0]}><mesh ref={o1}><sphereGeometry args={[.04, 12, 12]} /><meshBasicMaterial color="#22d3ee" /></mesh></group>
      <group rotation={[1.0, .3, 0]}><mesh ref={o2}><sphereGeometry args={[.028, 12, 12]} /><meshBasicMaterial color="#8b5cf6" /></mesh></group>
    </>
  );
}

/* ── HubScene ── */
function HubScene({ rot, onBadgeClick, onLogoClick, dragMovedRef, mobile }: {
  rot: { x: number; y: number }; onBadgeClick: (m: HubModuleDef, sx: number, sy: number) => void;
  onLogoClick: () => void; dragMovedRef: React.MutableRefObject<boolean>; mobile: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const [hov, setHov] = useState<string | null>(null);
  const orbitR = mobile ? 1.7 : 2.4;
  useFrame(() => {
    if (!groupRef.current) return;
    groupRef.current.rotation.x += (rot.x * Math.PI / 180 - groupRef.current.rotation.x) * .1;
    groupRef.current.rotation.y += (rot.y * Math.PI / 180 - groupRef.current.rotation.y) * .1;
  });
  return (
    <>
      <ambientLight intensity={.35} />
      <pointLight position={[-6, 5, 8]} intensity={2.5} color="#22d3ee" distance={30} decay={2} />
      <pointLight position={[6, -4, 7]} intensity={1.8} color="#a855f7" distance={25} decay={2} />
      <pointLight position={[0, 6, 10]} intensity={1.2} color="#fff" distance={25} decay={2} />
      <pointLight position={[0, -6, 5]} intensity={.6} color="#f59e0b" distance={20} decay={2} />
      <group ref={groupRef}>
        <OrbitalRings r={orbitR} />
        {/* Center coin */}
        <CoinBadge position={[0, 0, 0]} color="#22d3ee" texId="__center" isHovered={hov === '__c'} label=""
          onClick={(e: any) => { e.stopPropagation(); if (!dragMovedRef.current) onLogoClick(); }}
          onHover={h => setHov(h ? '__c' : null)} />
        <Html center distanceFactor={5} position={[0, -0.75, 0]} style={{ pointerEvents: 'none', userSelect: 'none' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <img src="/phav.png" alt="" style={{ width: 28, height: 28, objectFit: 'contain', filter: 'drop-shadow(0 0 8px rgba(34,211,238,.6))' }} />
            <span style={{ color: hov === '__c' ? 'rgba(34,211,238,.9)' : 'rgba(34,211,238,.5)', fontSize: 7, fontWeight: 800, letterSpacing: 2.5, textTransform: 'uppercase' as const, transition: 'color .3s' }}>MY CARD</span>
          </div>
        </Html>
        {/* Module coins */}
        {MODULES.map((mod, i) => {
          const a = (i / MODULES.length) * Math.PI * 2 - Math.PI / 2;
          return (
            <CoinBadge key={mod.id} position={[Math.cos(a) * orbitR, Math.sin(a) * orbitR, 0]}
              color={mod.color} texId={mod.id} isHovered={hov === mod.id} label={mod.label}
              onClick={(e: any) => { e.stopPropagation(); if (dragMovedRef.current) return; const d = e.nativeEvent as PointerEvent | undefined; onBadgeClick(mod, d?.clientX ?? innerWidth / 2, d?.clientY ?? innerHeight / 2); }}
              onHover={h => setHov(h ? mod.id : null)} />
          );
        })}
      </group>
    </>
  );
}

/* ── Starfield ── */
function useStarfield(ref: React.RefObject<HTMLCanvasElement | null>) {
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const ctx = cv.getContext('2d'); if (!ctx) return;
    const dpr = Math.min(devicePixelRatio, 2);
    let w = 0, h = 0;
    const resize = () => { w = innerWidth; h = innerHeight; cv.width = w * dpr; cv.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    resize(); addEventListener('resize', resize);
    const stars = Array.from({ length: 280 }, () => ({ x: Math.random(), y: Math.random(), r: Math.random() < .65 ? .3 + Math.random() * .5 : .8 + Math.random() * 1.3, a: .08 + Math.random() * .6, ph: Math.random() * Math.PI * 2, sp: .3 + Math.random() * 1.5 }));
    const shoots: { x: number; y: number; vx: number; vy: number; life: number; max: number; len: number }[] = [];
    let ns = 2, t = 0, raf = 0;
    function draw() {
      t += .016; ctx!.clearRect(0, 0, w, h);
      const bg = ctx!.createRadialGradient(w * .5, h * .35, 0, w * .5, h * .5, Math.max(w, h) * .9);
      bg.addColorStop(0, '#0a0e1a'); bg.addColorStop(.3, '#070a14'); bg.addColorStop(1, '#030508');
      ctx!.fillStyle = bg; ctx!.fillRect(0, 0, w, h);
      for (const [nx, ny, nr, c] of [[.15, .25, .45, '90,40,160'], [.8, .6, .4, '20,60,130'], [.5, .8, .35, '34,211,238']] as const) {
        const nb = ctx!.createRadialGradient(w * nx, h * ny, 0, w * nx, h * ny, w * nr);
        nb.addColorStop(0, `rgba(${c},.02)`); nb.addColorStop(.5, `rgba(${c},.006)`); nb.addColorStop(1, 'transparent');
        ctx!.fillStyle = nb; ctx!.fillRect(0, 0, w, h);
      }
      for (const s of stars) {
        const sx = s.x * w, sy = s.y * h, al = s.a * (.45 + Math.sin(t * s.sp + s.ph) * .55);
        if (al < .02) continue;
        if (s.r > 1 && al > .25) { ctx!.strokeStyle = `rgba(200,220,255,${al * .1})`; ctx!.lineWidth = .5; const fl = s.r * 3; ctx!.beginPath(); ctx!.moveTo(sx - fl, sy); ctx!.lineTo(sx + fl, sy); ctx!.moveTo(sx, sy - fl); ctx!.lineTo(sx, sy + fl); ctx!.stroke(); }
        ctx!.fillStyle = `rgba(210,225,255,${al})`; ctx!.beginPath(); ctx!.arc(sx, sy, s.r, 0, Math.PI * 2); ctx!.fill();
      }
      ns -= .016;
      if (ns <= 0) { const a = (20 + Math.random() * 35) * Math.PI / 180; const sp = 7 + Math.random() * 9; shoots.push({ x: Math.random() * w * .7, y: Math.random() * h * .25, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: 35 + Math.random() * 30, len: 50 + Math.random() * 80 }); ns = 2.5 + Math.random() * 5; }
      for (let i = shoots.length - 1; i >= 0; i--) {
        const sh = shoots[i]; sh.x += sh.vx; sh.y += sh.vy; sh.life++;
        if (sh.life > sh.max) { shoots.splice(i, 1); continue; }
        const p = sh.life / sh.max, al = Math.min(p * 5, 1) * (1 - Math.max((p - .4) / .6, 0)) * .9;
        const mg = Math.sqrt(sh.vx ** 2 + sh.vy ** 2) || 1, dx = sh.vx / mg, dy = sh.vy / mg, f = Math.min(p * 5, 1);
        const tX = sh.x - dx * sh.len * f, tY = sh.y - dy * sh.len * f;
        const g = ctx!.createLinearGradient(tX, tY, sh.x, sh.y);
        g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(.6, `rgba(180,210,255,${al * .2})`); g.addColorStop(1, `rgba(255,255,255,${al})`);
        ctx!.strokeStyle = g; ctx!.lineWidth = 1.5; ctx!.beginPath(); ctx!.moveTo(tX, tY); ctx!.lineTo(sh.x, sh.y); ctx!.stroke();
        ctx!.fillStyle = `rgba(255,255,255,${al})`; ctx!.beginPath(); ctx!.arc(sh.x, sh.y, 1.5, 0, Math.PI * 2); ctx!.fill();
      }
      const vig = ctx!.createRadialGradient(w * .5, h * .4, Math.min(w, h) * .25, w * .5, h * .5, Math.max(w, h) * .75);
      vig.addColorStop(0, 'transparent'); vig.addColorStop(1, 'rgba(0,0,0,.3)');
      ctx!.fillStyle = vig; ctx!.fillRect(0, 0, w, h);
      raf = requestAnimationFrame(draw);
    }
    draw();
    return () => { cancelAnimationFrame(raf); removeEventListener('resize', resize); };
  }, [ref]);
}

/* ── Helpers + CSS ── */
function clamp(v: number, a: number, b: number) { return Math.max(a, Math.min(b, v)); }
function speedLines(x: number, y: number, color: string) {
  const s: string[] = [];
  for (let i = 0; i < 24; i++) { const d = (i / 24) * 360; s.push(`transparent ${d}deg ${d + 10}deg`, `${color}22 ${d + 10}deg ${d + 12}deg`, `transparent ${d + 12}deg ${d + 15}deg`); }
  return `conic-gradient(from 0deg at ${x}px ${y}px, ${s.join(',')})`;
}
const HUB_CSS = `@keyframes hwF{0%{transform:translate(-50%,-50%) scale(1);opacity:.9}100%{transform:translate(-50%,-50%) scale(100);opacity:0}}@keyframes hwL{0%{transform:rotate(0);opacity:0}15%{opacity:.6}100%{transform:rotate(25deg);opacity:0}}@keyframes hwB{0%,50%{opacity:0}100%{opacity:1}}`;

/* ── Main ── */
export interface CosmicHubProps { walletAddress: string; prismBalance?: PrismBalance | null; onNavigateToCard: () => void; }
interface WarpState { id: string; x: number; y: number; color: string; route: string; }

export default function CosmicHub({ walletAddress, prismBalance, onNavigateToCard }: CosmicHubProps) {
  const navigate = useNavigate();
  const cvRef = useRef<HTMLCanvasElement>(null);
  const [rot, setRot] = useState({ x: -15, y: 0 });
  const rotRef = useRef({ x: -15, y: 0 });
  const [drag, setDrag] = useState(false);
  const [warp, setWarp] = useState<WarpState | null>(null);
  const ds = useRef({ sx: 0, sy: 0, rx: 0, ry: 0 });
  const dm = useRef(false);
  const vel = useRef({ x: 0, y: 0 });
  const lp = useRef({ x: 0, y: 0, t: 0 });
  const iRef = useRef(0);
  const aRef = useRef(0);
  const wRef = useRef(0);
  const [mobile, setMobile] = useState(typeof window !== 'undefined' && window.innerWidth <= 768);

  useEffect(() => {
    const onResize = () => setMobile(window.innerWidth <= 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  useStarfield(cvRef);

  useEffect(() => {
    if (drag || warp) return;
    const spin = () => { setRot(p => { const next = { ...p, y: p.y + .018 }; rotRef.current = next; return next; }); aRef.current = requestAnimationFrame(spin); };
    aRef.current = requestAnimationFrame(spin);
    return () => cancelAnimationFrame(aRef.current);
  }, [drag, warp]);
  useEffect(() => () => { cancelAnimationFrame(iRef.current); cancelAnimationFrame(aRef.current); clearTimeout(wRef.current); document.body.style.cursor = ''; }, []);

  const onDown = useCallback((e: React.PointerEvent) => {
    if (warp) return; cancelAnimationFrame(iRef.current);
    ds.current = { sx: e.clientX, sy: e.clientY, rx: rotRef.current.x, ry: rotRef.current.y };
    dm.current = false; vel.current = { x: 0, y: 0 }; lp.current = { x: e.clientX, y: e.clientY, t: performance.now() }; setDrag(true);
  }, [warp]);
  const onMove = useCallback((e: React.PointerEvent) => {
    if (!drag || warp) return;
    const dx = e.clientX - ds.current.sx, dy = e.clientY - ds.current.sy;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dm.current = true;
    if (!dm.current) return;
    const now = performance.now(), dt = now - lp.current.t;
    if (dt > 0) vel.current = { x: -(e.clientY - lp.current.y) / dt * 12, y: (e.clientX - lp.current.x) / dt * 12 };
    lp.current = { x: e.clientX, y: e.clientY, t: now };
    const next = { x: clamp(ds.current.rx - dy * .15, -45, 30), y: ds.current.ry + dx * .2 };
    rotRef.current = next;
    setRot(next);
  }, [drag, warp]);
  const onUp = useCallback(() => {
    if (!drag) return; setDrag(false);
    if (dm.current) {
      let vx = vel.current.x, vy = vel.current.y;
      const tick = () => { vx *= .96; vy *= .96; if (Math.abs(vx) < .01 && Math.abs(vy) < .01) return; setRot(p => { const next = { x: clamp(p.x + vx * .15, -45, 30), y: p.y + vy * .15 }; rotRef.current = next; return next; }); iRef.current = requestAnimationFrame(tick); };
      iRef.current = requestAnimationFrame(tick);
    }
  }, [drag]);
  const onBadge = useCallback((m: HubModuleDef, sx: number, sy: number) => {
    if (warp) return;
    if (wRef.current) clearTimeout(wRef.current);
    setWarp({ id: m.id, x: sx, y: sy, color: m.color, route: m.route });
    wRef.current = window.setTimeout(() => { trackInternalNavigation(); navigate(m.route + (walletAddress ? `?address=${walletAddress}` : '')); }, 650);
  }, [navigate, walletAddress, warp]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#030508', overflow: 'hidden' }}>
      <style>{HUB_CSS}</style>
      <canvas ref={cvRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      <div onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}
        style={{ position: 'absolute', inset: 0, zIndex: 10, cursor: drag ? 'grabbing' : 'grab', touchAction: 'none' }}>
        <Canvas camera={{ position: [0, 0, mobile ? 5.5 : 7], fov: mobile ? 54 : 46 }} gl={{ alpha: true, antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.1 }} dpr={[1, mobile ? 1 : 1.5]} style={{ background: 'transparent' }}>
          <HubScene rot={rot} onBadgeClick={onBadge} onLogoClick={() => { if (!dm.current) onNavigateToCard(); }} dragMovedRef={dm} mobile={mobile} />
        </Canvas>
      </div>
      {/* Top bar */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 30, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'max(env(safe-area-inset-top,10px),10px) 16px 8px', background: 'linear-gradient(to bottom,rgba(3,5,8,.8),transparent)', pointerEvents: 'none' }}>
        <div style={{ color: 'rgba(255,255,255,.18)', fontSize: 11, fontFamily: '"SF Mono","Fira Code",monospace', letterSpacing: .5, pointerEvents: 'auto' }}>{walletAddress.slice(0, 4)}...{walletAddress.slice(-4)}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(139,92,246,.06)', border: '1px solid rgba(139,92,246,.1)', borderRadius: 12, padding: '5px 14px', pointerEvents: 'auto' }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#c084fc', boxShadow: '0 0 6px rgba(192,132,252,.4)' }} />
          <span style={{ color: '#c084fc', fontWeight: 700, fontSize: 14, fontFamily: '"SF Mono","Fira Code",monospace' }}>{prismBalance?.balance ?? 0}</span>
          <span style={{ color: 'rgba(255,255,255,.12)', fontSize: 8, fontWeight: 700, letterSpacing: 2.5 }}>COINS</span>
        </div>
      </div>
      {/* Bottom */}
      <div style={{ position: 'absolute', bottom: '6%', left: 0, right: 0, textAlign: 'center', pointerEvents: 'none', zIndex: 20, opacity: warp ? 0 : 1, transition: 'opacity .3s' }}>
        <h1 style={{ margin: 0, fontSize: 16, fontWeight: 800, letterSpacing: 5, textTransform: 'uppercase', background: 'linear-gradient(135deg,#22d3ee,#a78bfa,#22d3ee)', backgroundSize: '200% 100%', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' } as React.CSSProperties}>IDENTITY PRISM</h1>
        <p style={{ margin: '6px 0 0', color: 'rgba(255,255,255,.1)', fontSize: 9, letterSpacing: 2 }}>DRAG TO ROTATE · TAP COIN TO ENTER</p>
      </div>
      {/* Warp */}
      {warp && (<>
        <div style={{ position: 'fixed', inset: 0, zIndex: 55, background: speedLines(warp.x, warp.y, warp.color), animation: 'hwL .6s ease-in forwards', pointerEvents: 'none' }} />
        <div style={{ position: 'fixed', zIndex: 60, left: warp.x, top: warp.y, width: 30, height: 30, borderRadius: '50%', background: `radial-gradient(circle,${warp.color},${warp.color}80,transparent)`, animation: 'hwF .6s cubic-bezier(.4,0,1,1) forwards', pointerEvents: 'none' }} />
        <div style={{ position: 'fixed', inset: 0, zIndex: 65, background: '#030508', animation: 'hwB .65s ease-in forwards', pointerEvents: 'none' }} />
      </>)}
    </div>
  );
}

export { MODULES as HUB_MODULES };
export type { CosmicHubProps };
