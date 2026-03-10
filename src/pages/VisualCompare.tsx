/**
 * Visual Compare Page — side-by-side current vs SR2-style planet/sun renders.
 * Left: existing Three.js components. Right: pure CSS SR2-inspired variants.
 * Dev tool for visual comparison.
 */

import { useState, Suspense, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { goBack } from '@/lib/safeNavigate';
import { ArrowLeft } from 'lucide-react';
import PageShell from '@/components/PageShell';
import { Planet3D } from '@/components/Planet3D';
import { Canvas } from '@react-three/fiber';
import type { PlanetTier } from '@/hooks/useWalletData';

// ── Tier Palettes ──

const TIER_PALETTES: Record<string, {
  base: string; mid: string; light: string; atmo: string; rings?: boolean;
  core?: string; outer?: string; corona?: string;
}> = {
  mercury:    { base: '#8c8c8c', mid: '#a0a0a0', light: '#c0c0c0', atmo: 'rgba(255,255,255,0.08)' },
  mars:       { base: '#993322', mid: '#cc5533', light: '#dd7744', atmo: 'rgba(255,136,68,0.12)' },
  venus:      { base: '#cc9944', mid: '#ddbb66', light: '#eedd88', atmo: 'rgba(255,221,102,0.18)' },
  earth:      { base: '#2266aa', mid: '#44aadd', light: '#66ccff', atmo: 'rgba(68,170,255,0.25)' },
  neptune:    { base: '#224488', mid: '#3366aa', light: '#5588cc', atmo: 'rgba(68,136,255,0.18)' },
  uranus:     { base: '#44aaaa', mid: '#66cccc', light: '#88dddd', atmo: 'rgba(102,221,221,0.18)' },
  saturn:     { base: '#aa8844', mid: '#ccaa66', light: '#ddcc88', atmo: 'rgba(221,204,136,0.18)', rings: true },
  jupiter:    { base: '#aa6633', mid: '#cc8855', light: '#ddaa77', atmo: 'rgba(204,136,85,0.25)' },
  sun:        { base: '#ff8800', mid: '#ffdd44', light: '#ffffff', atmo: 'rgba(255,136,0,0.35)', core: '#ffffff', outer: '#ff8800', corona: 'rgba(255,68,0,0.37)' },
  binary_sun: { base: '#6688ff', mid: '#aabbff', light: '#eeeeff', atmo: 'rgba(68,102,255,0.35)', core: '#eeeeff', outer: '#6688ff', corona: 'rgba(68,102,255,0.37)' },
};

const PLANET_TIERS: PlanetTier[] = ['mercury', 'mars', 'venus', 'earth', 'neptune', 'uranus', 'saturn', 'jupiter'];
const SUN_TIERS: PlanetTier[] = ['sun', 'binary_sun'];

// ── SR2 Original Assets ──

const SR2_STAR_MAP: Record<string, string> = {
  sun: '/sr2/Star00.png',
  binary_sun: '/sr2/StarBlue.png',
};

const SR2_STAR_VARIANTS = [
  { id: 'Star00', label: 'Yellow Star', src: '/sr2/Star00.png' },
  { id: 'StarBlue', label: 'Blue Star', src: '/sr2/StarBlue.png' },
  { id: 'StarRed', label: 'Red Star', src: '/sr2/StarRed.png' },
  { id: 'StarGreen', label: 'Green Star', src: '/sr2/StarGreen.png' },
  { id: 'star01', label: 'Star 01', src: '/sr2/star01.png' },
  { id: 'star02', label: 'Star 02', src: '/sr2/star02.png' },
  { id: 'Terron', label: 'Terron', src: '/sr2/Terron.png' },
];

const SR2_PLANET_TEXTURE: Record<string, string> = {
  mercury: '/sr2/mercury.jpg',
  mars: '/sr2/planet_01.jpg',
  venus: '/sr2/planet_05.jpg',
  earth: '/sr2/planet_10.jpg',
  neptune: '/sr2/neptune.jpg',
  uranus: '/sr2/planet_20.jpg',
  saturn: '/sr2/saturn.jpg',
  jupiter: '/sr2/jupiter.jpg',
};

// ── SR2 Original Star Image ──

function SR2OriginalStar({ src, size }: { src: string; size: number }) {
  return (
    <div className="relative flex items-center justify-center" style={{ width: size + 40, height: size + 40 }}>
      <img
        src={src}
        alt="SR2 Star"
        className="object-contain"
        style={{ width: size, height: size }}
      />
    </div>
  );
}

// ── SR2 Original Planet (texture on CSS sphere) ──

function SR2OriginalPlanet({ tier, size, rotate, atmosphere }: { tier: string; size: number; rotate: boolean; atmosphere: boolean }) {
  const p = TIER_PALETTES[tier] || TIER_PALETTES.mercury;
  const texture = SR2_PLANET_TEXTURE[tier];

  return (
    <div className="relative flex items-center justify-center" style={{ width: size + 40, height: size + 40 }}>
      {atmosphere && (
        <div className="absolute rounded-full" style={{
          width: size + 20,
          height: size + 20,
          background: `radial-gradient(circle, ${p.atmo}, transparent 70%)`,
          boxShadow: `0 0 ${size / 3}px ${size / 6}px ${p.atmo}`,
        }} />
      )}
      <div className="relative rounded-full overflow-hidden" style={{
        width: size,
        height: size,
        backgroundImage: texture ? `url(${texture})` : undefined,
        backgroundColor: texture ? undefined : p.base,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        boxShadow: `inset -${size / 5}px -${size / 8}px ${size / 4}px rgba(0,0,0,0.6), 0 0 ${size / 4}px ${p.atmo}`,
      }}>
        {/* Sphere lighting overlay */}
        <div className="absolute inset-0 rounded-full" style={{
          background: 'radial-gradient(circle at 35% 35%, rgba(255,255,255,0.15), transparent 60%, rgba(0,0,0,0.4))',
        }} />
        {/* Terminator */}
        <div className="absolute inset-0 rounded-full" style={{
          background: 'linear-gradient(to right, transparent 35%, rgba(0,0,0,0.15) 55%, rgba(0,0,0,0.6) 100%)',
        }} />
        {/* Rotation animation for texture */}
        {rotate && (
          <div className="absolute inset-0 rounded-full" style={{
            backgroundImage: texture ? `url(${texture})` : undefined,
            backgroundSize: '200% 100%',
            animation: 'sr2-texture-scroll 20s linear infinite',
            opacity: 0.5,
            mixBlendMode: 'overlay',
          }} />
        )}
      </div>
      {/* Rings (Saturn) */}
      {p.rings && (
        <div className="absolute" style={{
          width: size * 1.6,
          height: size * 0.4,
          borderRadius: '50%',
          border: `2px solid ${p.mid}40`,
          boxShadow: `0 0 8px ${p.mid}30, inset 0 0 6px ${p.mid}20`,
          transform: 'rotateX(70deg)',
          top: '50%', left: '50%',
          marginTop: -(size * 0.2),
          marginLeft: -(size * 0.8),
        }} />
      )}
    </div>
  );
}

// ── SR2-Style CSS Planet ──

function SR2Planet({ tier, size, rotate, atmosphere }: { tier: string; size: number; rotate: boolean; atmosphere: boolean }) {
  const p = TIER_PALETTES[tier] || TIER_PALETTES.mercury;
  const hasRings = p.rings;

  return (
    <div className="relative flex items-center justify-center" style={{ width: size + 40, height: size + 40 }}>
      {/* Atmosphere glow */}
      {atmosphere && (
        <div className="absolute rounded-full" style={{
          width: size + 20,
          height: size + 20,
          background: `radial-gradient(circle, ${p.atmo}, transparent 70%)`,
          boxShadow: `0 0 ${size / 3}px ${size / 6}px ${p.atmo}`,
        }} />
      )}
      {/* Planet sphere */}
      <div className="relative rounded-full overflow-hidden" style={{
        width: size,
        height: size,
        background: `radial-gradient(circle at 35% 35%, ${p.light}, ${p.mid} 50%, ${p.base} 100%)`,
        boxShadow: `inset -${size / 5}px -${size / 8}px ${size / 4}px rgba(0,0,0,0.6), 0 0 ${size / 4}px ${p.atmo}`,
      }}>
        {/* Cloud layer */}
        <div className="absolute inset-0 rounded-full" style={{
          background: `
            repeating-linear-gradient(
              ${tier === 'jupiter' ? '0deg' : '15deg'},
              transparent,
              transparent ${size / 8}px,
              rgba(255,255,255,0.06) ${size / 8}px,
              rgba(255,255,255,0.06) ${size / 6}px
            )
          `,
          animation: rotate ? 'sr2-cloud-rotate 30s linear infinite' : 'none',
        }} />
        {/* Terminator shadow */}
        <div className="absolute inset-0 rounded-full" style={{
          background: 'linear-gradient(to right, transparent 35%, rgba(0,0,0,0.15) 55%, rgba(0,0,0,0.6) 100%)',
        }} />
      </div>
      {/* Rings (Saturn) */}
      {hasRings && (
        <div className="absolute" style={{
          width: size * 1.6,
          height: size * 0.4,
          borderRadius: '50%',
          border: `2px solid ${p.mid}40`,
          boxShadow: `0 0 8px ${p.mid}30, inset 0 0 6px ${p.mid}20`,
          transform: 'rotateX(70deg)',
          top: '50%',
          left: '50%',
          marginTop: -(size * 0.2),
          marginLeft: -(size * 0.8),
        }} />
      )}
    </div>
  );
}

// ── SR2-Style CSS Sun ──

function SR2Sun({ tier, size, rotate }: { tier: string; size: number; rotate: boolean }) {
  const p = TIER_PALETTES[tier] || TIER_PALETTES.sun;
  const core = p.core || '#ffffff';
  const mid = p.mid;
  const outer = p.outer || p.base;
  const corona = p.corona || 'rgba(255,68,0,0.37)';
  const isBinary = tier === 'binary_sun';

  const sunElement = (offset = 0) => (
    <div className="relative" style={{
      width: size,
      height: size,
      transform: offset ? `translateX(${offset}px)` : undefined,
    }}>
      {/* Corona layers */}
      <div className="absolute rounded-full" style={{
        inset: -size * 0.3,
        background: `radial-gradient(circle, ${corona}, transparent 70%)`,
        animation: rotate ? 'sr2-corona-pulse 4s ease-in-out infinite' : 'none',
      }} />
      <div className="absolute rounded-full" style={{
        inset: -size * 0.15,
        background: `radial-gradient(circle, ${outer}30, transparent 60%)`,
        animation: rotate ? 'sr2-corona-pulse 3s ease-in-out infinite reverse' : 'none',
      }} />
      {/* Core */}
      <div className="rounded-full" style={{
        width: size,
        height: size,
        background: `radial-gradient(circle at 40% 40%, ${core}, ${mid} 50%, ${outer})`,
        boxShadow: `
          0 0 ${size / 3}px ${size / 6}px ${outer}50,
          0 0 ${size}px ${size / 3}px ${corona},
          inset 0 0 ${size / 4}px ${core}40
        `,
      }} />
      {/* Flare */}
      <div className="absolute" style={{
        width: size * 0.15,
        height: size * 0.6,
        borderRadius: '50%',
        background: `radial-gradient(ellipse, ${core}30, transparent)`,
        top: -size * 0.15,
        left: size * 0.6,
        transform: 'rotate(25deg)',
        animation: rotate ? 'sr2-flare-pulse 5s ease-in-out infinite' : 'none',
      }} />
    </div>
  );

  if (isBinary) {
    return (
      <div className="relative flex items-center justify-center" style={{ width: size * 2 + 20, height: size + 60 }}>
        <div className="absolute" style={{ left: 0 }}>{sunElement()}</div>
        <div className="absolute" style={{ left: size * 0.8 }}>{sunElement()}</div>
        {/* Energy bridge */}
        <div className="absolute" style={{
          width: size * 0.6,
          height: 4,
          background: `linear-gradient(90deg, transparent, ${mid}60, transparent)`,
          top: '50%',
          left: '35%',
          animation: rotate ? 'sr2-bridge-pulse 2s ease-in-out infinite' : 'none',
          boxShadow: `0 0 12px ${mid}40`,
        }} />
      </div>
    );
  }

  return (
    <div className="relative flex items-center justify-center" style={{ width: size + 60, height: size + 60 }}>
      {sunElement()}
    </div>
  );
}

// ── Three.js Planet Wrapper ──

function ThreeJSPlanet({ tier, size }: { tier: PlanetTier; size: number }) {
  return (
    <div style={{ width: size + 40, height: size + 40 }}>
      <Canvas
        camera={{ position: [0, 0, 3.5], fov: 50 }}
        style={{ width: '100%', height: '100%', background: 'transparent' }}
        gl={{ alpha: true, antialias: true }}
      >
        <ambientLight intensity={0.3} />
        <directionalLight position={[5, 3, 5]} intensity={1.2} />
        <Suspense fallback={null}>
          <Planet3D tier={tier} />
        </Suspense>
      </Canvas>
    </div>
  );
}

// ── Main Component ──

export default function VisualCompare() {
  const navigate = useNavigate();
  const [selectedTier, setSelectedTier] = useState<PlanetTier>('earth');
  const [size, setSize] = useState(180);
  const [rotate, setRotate] = useState(true);
  const [atmosphere, setAtmosphere] = useState(true);

  const isSun = SUN_TIERS.includes(selectedTier);
  const isPlanet = PLANET_TIERS.includes(selectedTier);

  return (
    <PageShell className="text-white">
      {/* Header */}
      <div className="sticky top-0 z-20 backdrop-blur-xl bg-[#050510]/80 border-b border-white/[0.06]">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => goBack(navigate)} className="flex items-center gap-2 text-white/50 hover:text-white text-sm">
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <h1 className="text-sm font-bold">Planet/Sun Visual Compare</h1>
          <span className="text-[9px] text-white/20 bg-white/5 px-2 py-0.5 rounded">DEV</span>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* Controls */}
        <div className="mb-6 space-y-4">
          {/* Tier selector */}
          <div>
            <p className="text-white/30 text-[10px] uppercase tracking-wider mb-2">Select Tier</p>
            <div className="flex flex-wrap gap-1.5">
              {[...PLANET_TIERS, ...SUN_TIERS].map((t) => {
                const p = TIER_PALETTES[t];
                const active = t === selectedTier;
                return (
                  <button
                    key={t}
                    onClick={() => setSelectedTier(t)}
                    className="px-3 py-1.5 rounded-lg text-[11px] font-bold capitalize transition-all"
                    style={{
                      background: active ? `${p.mid}25` : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${active ? p.mid + '50' : 'rgba(255,255,255,0.06)'}`,
                      color: active ? p.mid : 'rgba(255,255,255,0.35)',
                    }}
                  >
                    {t === 'binary_sun' ? 'Binary Sun' : t}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Size + toggles */}
          <div className="flex items-center gap-6 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-white/30 text-[10px]">Size:</span>
              <input
                type="range"
                min={80}
                max={300}
                value={size}
                onChange={(e) => setSize(Number(e.target.value))}
                className="w-32 accent-purple-500"
              />
              <span className="text-white/40 text-[10px] font-mono w-8">{size}</span>
            </div>
            <label className="flex items-center gap-1.5 text-white/30 text-[10px] cursor-pointer">
              <input type="checkbox" checked={rotate} onChange={(e) => setRotate(e.target.checked)} className="accent-purple-500" />
              Rotation
            </label>
            <label className="flex items-center gap-1.5 text-white/30 text-[10px] cursor-pointer">
              <input type="checkbox" checked={atmosphere} onChange={(e) => setAtmosphere(e.target.checked)} className="accent-purple-500" />
              Atmosphere
            </label>
          </div>
        </div>

        {/* Comparison Grid — 3 columns */}
        <div className="grid grid-cols-3 gap-3">
          {/* Left: Current Three.js */}
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3">
            <div className="text-center mb-3">
              <span className="text-[10px] font-bold text-cyan-400/60 uppercase tracking-widest">Current (Three.js)</span>
            </div>
            <div className="flex items-center justify-center min-h-[220px]" style={{ background: 'radial-gradient(ellipse, rgba(10,15,30,0.5), transparent)' }}>
              {isPlanet ? (
                <ThreeJSPlanet tier={selectedTier} size={Math.min(size, 160)} />
              ) : (
                <div className="text-center text-white/20 text-xs p-6">
                  <p>Sun requires StellarProfile</p>
                  <p className="text-[10px] mt-1">See SR2 panels →</p>
                </div>
              )}
            </div>
            <div className="text-center mt-2 text-white/15 text-[9px]">
              Three.js + GLSL + R3F
            </div>
          </div>

          {/* Middle: SR2-style CSS */}
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3">
            <div className="text-center mb-3">
              <span className="text-[10px] font-bold text-amber-400/60 uppercase tracking-widest">SR2 Style (CSS)</span>
            </div>
            <div className="flex items-center justify-center min-h-[220px]" style={{ background: 'radial-gradient(ellipse, rgba(10,15,30,0.5), transparent)' }}>
              {isSun ? (
                <SR2Sun tier={selectedTier} size={Math.min(size, 140) * 0.8} rotate={rotate} />
              ) : (
                <SR2Planet tier={selectedTier} size={Math.min(size, 160)} rotate={rotate} atmosphere={atmosphere} />
              )}
            </div>
            <div className="text-center mt-2 text-white/15 text-[9px]">
              CSS gradients + animations
            </div>
          </div>

          {/* Right: SR2 Original Assets */}
          <div className="rounded-2xl border border-green-500/10 bg-green-500/[0.02] p-3">
            <div className="text-center mb-3">
              <span className="text-[10px] font-bold text-green-400/60 uppercase tracking-widest">SR2 Original</span>
            </div>
            <div className="flex items-center justify-center min-h-[220px]" style={{ background: 'radial-gradient(ellipse, rgba(10,15,30,0.5), transparent)' }}>
              {isSun ? (
                <SR2OriginalStar src={SR2_STAR_MAP[selectedTier] || '/sr2/Star00.png'} size={Math.min(size, 160)} />
              ) : (
                <SR2OriginalPlanet tier={selectedTier} size={Math.min(size, 160)} rotate={rotate} atmosphere={atmosphere} />
              )}
            </div>
            <div className="text-center mt-2 text-white/15 text-[9px]">
              Game assets (GI → PNG)
            </div>
          </div>
        </div>

        {/* SR2 Star Gallery (when sun selected) */}
        {isSun && (
          <div className="mt-6 p-4 rounded-xl bg-white/[0.02] border border-white/[0.06]">
            <p className="text-white/20 text-[10px] uppercase tracking-wider mb-3">SR2 Star Gallery</p>
            <div className="flex gap-3 overflow-x-auto pb-2">
              {SR2_STAR_VARIANTS.map((star) => (
                <div key={star.id} className="flex-shrink-0 text-center">
                  <img src={star.src} alt={star.label} className="w-24 h-24 object-contain rounded-xl bg-black/30" />
                  <p className="text-white/25 text-[9px] mt-1">{star.label}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* SR2 Planet Texture Preview (when planet selected) */}
        {isPlanet && SR2_PLANET_TEXTURE[selectedTier] && (
          <div className="mt-6 p-4 rounded-xl bg-white/[0.02] border border-white/[0.06]">
            <p className="text-white/20 text-[10px] uppercase tracking-wider mb-3">SR2 Planet Texture: {selectedTier}</p>
            <img
              src={SR2_PLANET_TEXTURE[selectedTier]}
              alt={`${selectedTier} texture`}
              className="w-full max-w-md h-32 object-cover rounded-xl"
            />
            <p className="text-white/15 text-[9px] mt-2">Equirectangular projection from game DATA/PUMaps/</p>
          </div>
        )}

        {/* Palette info */}
        <div className="mt-6 p-4 rounded-xl bg-white/[0.02] border border-white/[0.06]">
          <p className="text-white/20 text-[10px] uppercase tracking-wider mb-2">Palette: {selectedTier}</p>
          <div className="flex gap-3">
            {(() => {
              const p = TIER_PALETTES[selectedTier];
              const colors = [
                { label: 'Base', color: p.base },
                { label: 'Mid', color: p.mid },
                { label: 'Light', color: p.light },
              ];
              if (p.core) colors.push({ label: 'Core', color: p.core });
              if (p.outer) colors.push({ label: 'Outer', color: p.outer });
              return colors.map((c) => (
                <div key={c.label} className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded border border-white/10" style={{ background: c.color }} />
                  <div>
                    <div className="text-white/40 text-[9px]">{c.label}</div>
                    <div className="text-white/20 text-[8px] font-mono">{c.color}</div>
                  </div>
                </div>
              ));
            })()}
          </div>
        </div>
      </div>

      {/* CSS Animations */}
      <style>{`
        @keyframes sr2-cloud-rotate {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes sr2-corona-pulse {
          0%, 100% { opacity: 0.7; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.05); }
        }
        @keyframes sr2-flare-pulse {
          0%, 100% { opacity: 0.3; transform: rotate(25deg) scale(1); }
          50% { opacity: 0.7; transform: rotate(25deg) scale(1.3); }
        }
        @keyframes sr2-bridge-pulse {
          0%, 100% { opacity: 0.4; height: 3px; }
          50% { opacity: 0.8; height: 6px; }
        }
        @keyframes sr2-texture-scroll {
          from { background-position: 0% center; }
          to { background-position: 200% center; }
        }
      `}</style>
    </PageShell>
  );
}
