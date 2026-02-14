import { useMemo } from 'react';
import type { PlanetTier } from '@/hooks/useWalletData';

interface CSSPlanetProps {
  tier: PlanetTier;
  isCapture?: boolean;
}

type PlanetVisual = {
  surface: string;
  highlight: string;
  atmosphere: string;
  glowColor: string;
  size: number;
  hasRings?: boolean;
  isStar?: boolean;
  bands?: string;
};

const PLANETS: Record<PlanetTier, PlanetVisual> = {
  mercury: {
    surface: 'radial-gradient(circle at 36% 30%, #c4b8a8 0%, #8c7e6f 40%, #5a5048 75%, #3a3330 100%)',
    highlight: 'rgba(196,184,168,0.25)',
    atmosphere: 'rgba(180,165,149,0.08)',
    glowColor: 'rgba(180,165,149,0.05)',
    size: 110,
  },
  mars: {
    surface: 'radial-gradient(circle at 36% 30%, #e8956a 0%, #c1440e 35%, #8b2500 70%, #4a1200 100%)',
    highlight: 'rgba(232,149,106,0.3)',
    atmosphere: 'rgba(255,107,74,0.12)',
    glowColor: 'rgba(255,80,40,0.08)',
    size: 120,
    bands: 'repeating-linear-gradient(2deg, transparent 0px, transparent 18px, rgba(0,0,0,0.06) 18px, rgba(0,0,0,0.06) 20px)',
  },
  venus: {
    surface: 'radial-gradient(circle at 36% 30%, #ffe4a8 0%, #e6c170 30%, #c9a84c 60%, #8a7030 100%)',
    highlight: 'rgba(255,228,168,0.3)',
    atmosphere: 'rgba(255,209,102,0.15)',
    glowColor: 'rgba(255,209,102,0.08)',
    size: 128,
    bands: 'repeating-linear-gradient(12deg, transparent 0px, transparent 14px, rgba(255,255,255,0.03) 14px, rgba(255,255,255,0.03) 16px)',
  },
  earth: {
    surface: 'radial-gradient(circle at 36% 30%, #6ab7f0 0%, #2d87c7 25%, #1a6b4e 50%, #1b4d7a 75%, #0a2540 100%)',
    highlight: 'rgba(106,183,240,0.3)',
    atmosphere: 'rgba(95,168,255,0.18)',
    glowColor: 'rgba(95,168,255,0.1)',
    size: 136,
  },
  neptune: {
    surface: 'radial-gradient(circle at 36% 30%, #6bd4ff 0%, #2857a4 40%, #1a3d7a 70%, #0d1f4a 100%)',
    highlight: 'rgba(107,212,255,0.25)',
    atmosphere: 'rgba(76,201,240,0.15)',
    glowColor: 'rgba(76,201,240,0.08)',
    size: 144,
    bands: 'repeating-linear-gradient(3deg, transparent 0px, transparent 22px, rgba(255,255,255,0.025) 22px, rgba(255,255,255,0.025) 24px)',
  },
  uranus: {
    surface: 'radial-gradient(circle at 36% 30%, #b8f4ff 0%, #5bc0de 35%, #3a96b0 65%, #1d5a6e 100%)',
    highlight: 'rgba(184,244,255,0.25)',
    atmosphere: 'rgba(128,237,255,0.12)',
    glowColor: 'rgba(128,237,255,0.06)',
    size: 140,
  },
  saturn: {
    surface: 'radial-gradient(circle at 36% 30%, #ffe4a0 0%, #d4a84b 30%, #a07b2f 60%, #6a5020 100%)',
    highlight: 'rgba(255,228,160,0.3)',
    atmosphere: 'rgba(252,191,73,0.12)',
    glowColor: 'rgba(252,191,73,0.06)',
    size: 120,
    hasRings: true,
    bands: 'repeating-linear-gradient(0deg, transparent 0px, transparent 7px, rgba(180,140,60,0.1) 7px, rgba(180,140,60,0.1) 9px)',
  },
  jupiter: {
    surface: 'radial-gradient(circle at 36% 30%, #f0c888 0%, #c17d3e 30%, #8b5e2b 60%, #4a2e10 100%)',
    highlight: 'rgba(240,200,136,0.3)',
    atmosphere: 'rgba(244,162,97,0.15)',
    glowColor: 'rgba(244,162,97,0.08)',
    size: 156,
    bands: 'repeating-linear-gradient(0deg, transparent 0px, transparent 5px, rgba(200,140,60,0.12) 5px, transparent 7px, transparent 12px, rgba(160,100,40,0.08) 12px, transparent 14px)',
  },
  sun: {
    surface: 'radial-gradient(circle at 42% 38%, #fffbe6 0%, #ffd050 18%, #ff9500 42%, #ff6b00 68%, #cc4400 100%)',
    highlight: 'rgba(255,251,230,0.4)',
    atmosphere: 'rgba(255,200,100,0.3)',
    glowColor: 'rgba(255,150,50,0.15)',
    size: 150,
    isStar: true,
  },
  binary_sun: {
    surface: 'radial-gradient(circle at 42% 38%, #fffbe6 0%, #ffd050 18%, #ff9500 42%, #ff6b00 68%, #cc4400 100%)',
    highlight: 'rgba(255,251,230,0.4)',
    atmosphere: 'rgba(255,204,51,0.3)',
    glowColor: 'rgba(255,150,50,0.15)',
    size: 115,
    isStar: true,
  },
};

function generateStars(count: number, seed: number) {
  const stars: string[] = [];
  let s = seed;
  const next = () => { s = (s * 16807 + 0) % 2147483647; return (s & 0x7fffffff) / 0x7fffffff; };
  for (let i = 0; i < count; i++) {
    const x = next() * 100;
    const y = next() * 100;
    const size = 0.5 + next() * 1.2;
    const opacity = 0.3 + next() * 0.6;
    stars.push(`radial-gradient(${size}px ${size}px at ${x}% ${y}%, rgba(255,255,255,${opacity}) 50%, transparent 100%)`);
  }
  return stars.join(', ');
}

export function CSSPlanet({ tier, isCapture = false }: CSSPlanetProps) {
  const v = PLANETS[tier] ?? PLANETS.earth;
  const scale = isCapture ? 0.82 : 1;
  const sz = v.size * scale;

  const starsBg = useMemo(() => generateStars(120, 42), []);

  const planetBg = v.bands
    ? `${v.bands}, ${v.surface}`
    : v.surface;

  return (
    <div className="css-planet-wrap">
      <div className="css-planet-stars" style={{ background: starsBg }} />
      <div className="css-planet-orbit">
        <div
          className={`css-planet${v.isStar ? ' css-planet--star' : ''}`}
          style={{
            width: sz,
            height: sz,
            background: planetBg,
            boxShadow: [
              `0 0 ${sz * 0.25}px ${sz * 0.06}px ${v.atmosphere}`,
              `0 0 ${sz * 0.6}px ${sz * 0.18}px ${v.glowColor}`,
              `inset -${sz * 0.12}px -${sz * 0.08}px ${sz * 0.22}px rgba(0,0,0,0.55)`,
            ].join(', '),
          }}
        >
          <div
            className="css-planet__highlight"
            style={{
              background: `radial-gradient(circle at 32% 26%, ${v.highlight} 0%, transparent 45%)`,
            }}
          />
        </div>
        {v.hasRings && (
          <div
            className="css-planet__rings"
            style={{
              width: sz * 2,
              height: sz * 0.5,
              marginTop: -(sz * 0.25),
              marginLeft: -(sz),
              borderColor: 'rgba(210,170,80,0.35)',
              boxShadow: '0 0 0 5px rgba(210,170,80,0.12), 0 0 0 10px rgba(210,170,80,0.06)',
            }}
          />
        )}
      </div>
    </div>
  );
}
