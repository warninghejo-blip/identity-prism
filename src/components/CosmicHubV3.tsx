/**
 * CosmicHub V3 — Premium Web3 Spatial Hub.
 * 3D rotating glass prism background + Glassmorphism Bento Box navigation grid.
 * Mini Identity Passport replaces the old "My Card" button.
 */
import { useCallback, useRef, useEffect, useState, Suspense } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Canvas, useFrame } from '@react-three/fiber';
import { Float, MeshTransmissionMaterial, Sparkles, Stars, Environment } from '@react-three/drei';
import * as THREE from 'three';
import { trackInternalNavigation } from '@/lib/safeNavigate';
import { getHeliusProxyUrl } from '@/constants';
import { useCompositeScore } from '@/hooks/useCompositeScore';
import type { PlanetTier } from '@/hooks/useWalletData';
import {
  Trophy, Flame, Store, Network, Swords, Medal, ScrollText, ArrowRight, Shield, Eye, Clock,
} from 'lucide-react';

/* ── Tier color map ── */
const TIER_COLORS: Record<string, { text: string; glow: string; bg: string }> = {
  mercury:    { text: '#94a3b8', glow: 'rgba(148,163,184,0.3)', bg: 'from-slate-500/20 to-slate-600/20' },
  mars:       { text: '#f87171', glow: 'rgba(248,113,113,0.3)', bg: 'from-red-500/20 to-red-600/20' },
  venus:      { text: '#fbbf24', glow: 'rgba(251,191,36,0.3)',  bg: 'from-amber-500/20 to-amber-600/20' },
  earth:      { text: '#34d399', glow: 'rgba(52,211,153,0.3)',  bg: 'from-emerald-500/20 to-emerald-600/20' },
  neptune:    { text: '#60a5fa', glow: 'rgba(96,165,250,0.3)',  bg: 'from-blue-500/20 to-blue-600/20' },
  uranus:     { text: '#67e8f9', glow: 'rgba(103,232,249,0.3)', bg: 'from-cyan-500/20 to-cyan-600/20' },
  saturn:     { text: '#c084fc', glow: 'rgba(192,132,252,0.3)', bg: 'from-purple-500/20 to-purple-600/20' },
  jupiter:    { text: '#fb923c', glow: 'rgba(251,146,60,0.3)',  bg: 'from-orange-500/20 to-orange-600/20' },
  sun:        { text: '#fde047', glow: 'rgba(253,224,71,0.4)',  bg: 'from-yellow-500/20 to-yellow-600/20' },
  binary_sun: { text: '#f0abfc', glow: 'rgba(240,171,252,0.4)', bg: 'from-fuchsia-500/20 to-fuchsia-600/20' },
};

const SYBIL_GRADE_COLORS: Record<string, string> = {
  'A+': '#22c55e', A: '#22c55e', 'A-': '#4ade80',
  'B+': '#86efac', B: '#facc15', 'B-': '#fbbf24',
  'C+': '#fb923c', C: '#f97316', 'C-': '#ef4444',
  D: '#ef4444', F: '#dc2626', 'N/A': '#64748b',
};

/* ── Props ── */
export interface CosmicHubProps {
  walletAddress: string;
  prismBalance?: { balance: number } | null;
  onNavigateToCard: () => void;
  identityScore?: number;
  planetTier?: PlanetTier;
}

/* ── 3D Components ── */

function LocalEnvironment() {
  return (
    <Environment resolution={128}>
      <group>
        <mesh position={[0, 10, -10]}><planeGeometry args={[20, 20]} /><meshBasicMaterial color="#3b82f6" /></mesh>
        <mesh position={[10, 0, 0]} rotation={[0, -Math.PI / 2, 0]}><planeGeometry args={[20, 20]} /><meshBasicMaterial color="#ec4899" /></mesh>
        <mesh position={[-10, 0, 0]} rotation={[0, Math.PI / 2, 0]}><planeGeometry args={[20, 20]} /><meshBasicMaterial color="#8b5cf6" /></mesh>
        <mesh position={[0, -10, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[20, 20]} /><meshBasicMaterial color="#020617" /></mesh>
      </group>
    </Environment>
  );
}

function PrismCore() {
  const prismRef = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (prismRef.current) {
      prismRef.current.rotation.y += 0.003;
      prismRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.5) * 0.1;
    }
  });

  return (
    <Float speed={2} rotationIntensity={0.5} floatIntensity={2}>
      <mesh ref={prismRef} scale={1.5}>
        <octahedronGeometry args={[2, 0]} />
        <MeshTransmissionMaterial
          backside
          samples={4}
          thickness={1.5}
          chromaticAberration={0.8}
          anisotropy={0.2}
          distortion={0.2}
          distortionScale={0.5}
          temporalDistortion={0.1}
          ior={1.2}
          color="#e0e7ff"
          resolution={256}
        />
      </mesh>
      <mesh scale={0.8}>
        <octahedronGeometry args={[1, 0]} />
        <meshBasicMaterial color="#8b5cf6" wireframe transparent opacity={0.2} />
      </mesh>
    </Float>
  );
}

/* ── Navigation module definitions ── */
interface ModuleDef {
  id: string;
  label: string;
  route: string;
  desc: string;
  icon: ReactNode;
  colorClass: string;
}

const MODULES: ModuleDef[] = [
  { id: 'league', label: 'Prism League', route: '/game', desc: 'Compete in arcade games',
    icon: <Trophy size={24} />, colorClass: 'from-cyan-500 to-blue-400' },
  { id: 'constellation', label: 'Stellar Nexus', route: '/constellation', desc: 'Explore wallet connections',
    icon: <Network size={24} />, colorClass: 'from-emerald-500 to-teal-400' },
  { id: 'market', label: 'Prism Arena', route: '/market', desc: 'Battle & explore wallets',
    icon: <Swords size={24} />, colorClass: 'from-pink-500 to-rose-400' },
  { id: 'blackhole', label: 'Black Hole', route: '/blackhole', desc: 'Destroy your identity',
    icon: <Flame size={24} />, colorClass: 'from-purple-500 to-indigo-400' },
  { id: 'shop', label: 'Prism Shop', route: '/forge', desc: 'Customize your card',
    icon: <Store size={24} />, colorClass: 'from-amber-500 to-yellow-400' },
  { id: 'leaderboard', label: 'Leaderboard', route: '/leaderboard', desc: 'Top identity scores',
    icon: <Medal size={24} />, colorClass: 'from-yellow-500 to-orange-400' },
  { id: 'quests', label: 'Quests', route: '/quests', desc: 'Daily missions & rewards',
    icon: <ScrollText size={24} />, colorClass: 'from-violet-500 to-purple-400' },
  { id: 'timewarp', label: 'Score History', route: '/timewarp', desc: 'Track your score over time',
    icon: <Clock size={24} />, colorClass: 'from-sky-500 to-blue-400' },
];

/* ── NavCard component ── */
function NavCard({ label, desc, icon, colorClass, delay, onClick }: {
  label: string; desc: string; icon: ReactNode; colorClass: string; delay: number; onClick: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay }}
      onClick={onClick}
      className="group relative overflow-hidden rounded-2xl bg-white/[0.04] backdrop-blur-xl border border-white/[0.08] p-5 cursor-pointer hover:bg-white/[0.08] transition-all duration-500 hover:scale-[1.02] hover:border-white/[0.15] pointer-events-auto"
    >
      <div className={`absolute top-0 left-0 w-1 h-full bg-gradient-to-b ${colorClass} opacity-40 group-hover:opacity-100 transition-opacity`} />
      <div className="flex justify-between items-start mb-3">
        <div className="p-2.5 rounded-xl bg-white/[0.05] border border-white/[0.08] text-white/80 group-hover:text-white group-hover:scale-110 transition-all duration-500">
          {icon}
        </div>
        <ArrowRight size={18} className="text-white/20 group-hover:text-white/70 group-hover:translate-x-1 transition-all duration-300 mt-1" />
      </div>
      <h3 className="text-base font-bold text-white/90 mb-0.5 tracking-wide">{label}</h3>
      <p className="text-xs text-white/40 font-medium">{desc}</p>
      <div className={`absolute -bottom-8 -right-8 w-28 h-28 bg-gradient-to-br ${colorClass} rounded-full blur-3xl opacity-0 group-hover:opacity-15 transition-opacity duration-500`} />
    </motion.div>
  );
}

/* ── Truncate address ── */
function truncAddr(a: string) {
  return a.length > 8 ? `${a.slice(0, 4)}...${a.slice(-4)}` : a;
}

/* ── Mini Identity Passport ── */
function MiniPassport({
  walletAddress, score, tier, coins, sybilGrade, onClick, maxScore = 1400,
}: {
  walletAddress: string;
  score: number;
  tier: string;
  coins: number;
  sybilGrade: string | null;
  onClick: () => void;
  maxScore?: number;
}) {
  const tierColor = TIER_COLORS[tier] ?? TIER_COLORS.mercury;
  const gradeColor = SYBIL_GRADE_COLORS[sybilGrade ?? 'N/A'] ?? '#64748b';
  const tierLabel = tier === 'binary_sun' ? 'BINARY SUN' : tier.toUpperCase();

  // Score ring (SVG)
  const pct = Math.min(score / maxScore, 1);
  const r = 32;
  const circ = 2 * Math.PI * r;
  const strokeDash = circ * pct;

  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className="relative w-full rounded-2xl overflow-hidden bg-white/[0.04] backdrop-blur-xl border border-white/[0.08] cursor-pointer hover:bg-white/[0.07] transition-all duration-500 hover:border-cyan-500/20 text-left pointer-events-auto"
    >
      {/* Top gradient bar */}
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-cyan-500 via-purple-500 to-pink-500" />

      <div className="p-5 pt-4">
        {/* Header: IDENTITY PASSPORT */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Eye size={14} className="text-cyan-400/70" />
            <span className="text-[10px] font-bold tracking-[0.2em] text-white/40 uppercase">Identity Passport</span>
          </div>
          <ArrowRight size={14} className="text-white/20" />
        </div>

        {/* Main content: Score ring + Info */}
        <div className="flex items-center gap-4">
          {/* Score Ring */}
          <div className="relative flex-shrink-0">
            <svg width="80" height="80" viewBox="0 0 80 80">
              {/* Background circle */}
              <circle cx="40" cy="40" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="4" />
              {/* Progress arc */}
              <circle
                cx="40" cy="40" r={r}
                fill="none"
                stroke={tierColor.text}
                strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray={`${strokeDash} ${circ}`}
                transform="rotate(-90 40 40)"
                style={{ filter: `drop-shadow(0 0 6px ${tierColor.glow})`, transition: 'stroke-dasharray 1s ease-out' }}
              />
              {/* Score text */}
              <text x="40" y="36" textAnchor="middle" fill={tierColor.text} fontSize="18" fontWeight="bold" fontFamily="monospace">
                {score}
              </text>
              <text x="40" y="50" textAnchor="middle" fill="rgba(255,255,255,0.35)" fontSize="8" fontWeight="600" letterSpacing="0.5">
                SCORE
              </text>
            </svg>
          </div>

          {/* Info block */}
          <div className="flex-1 min-w-0 space-y-2.5">
            {/* Tier */}
            <div>
              <div className="text-[10px] text-white/30 font-medium tracking-wider mb-0.5">RANK</div>
              <div
                className="text-sm font-black tracking-wider"
                style={{ color: tierColor.text, textShadow: `0 0 12px ${tierColor.glow}` }}
              >
                {tierLabel}
              </div>
            </div>

            {/* Sybil + Coins row */}
            <div className="flex items-center gap-3">
              {/* Sybil Grade */}
              <div className="flex items-center gap-1.5">
                <Shield size={12} style={{ color: gradeColor }} />
                <span className="text-[10px] text-white/30 font-medium">Sybil</span>
                <span
                  className="text-xs font-black"
                  style={{ color: gradeColor }}
                >
                  {sybilGrade ?? '...'}
                </span>
              </div>

              {/* Divider */}
              <div className="w-px h-3 bg-white/10" />

              {/* Coins */}
              <div className="flex items-center gap-1">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="#fbbf24">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M12 6v12M8 10h8M8 14h8" stroke="#000" strokeWidth="1.5"/>
                </svg>
                <span className="text-xs font-bold text-amber-400">{coins}</span>
              </div>
            </div>

            {/* Address */}
            <div className="text-[10px] text-white/25 font-mono tracking-wider">
              {truncAddr(walletAddress)}
            </div>
          </div>
        </div>
      </div>
    </motion.button>
  );
}

/* ── No Card Fallback ── */
function NoCardFallback({ onClick }: { onClick: () => void }) {
  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className="relative w-full rounded-2xl overflow-hidden bg-white/[0.04] backdrop-blur-xl border border-white/[0.08] p-6 cursor-pointer hover:bg-white/[0.07] transition-all duration-500 hover:border-cyan-500/20 text-left pointer-events-auto"
    >
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-slate-500 via-slate-400 to-slate-500 opacity-50" />
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-white/[0.05] to-white/[0.02] border border-white/[0.08] border-dashed flex items-center justify-center">
          <Eye size={22} className="text-white/20" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-white/70 mb-1">Identity Not Scanned</h3>
          <p className="text-[11px] text-white/30">Tap to scan your wallet and reveal your cosmic identity</p>
        </div>
      </div>
      <ArrowRight size={16} className="absolute top-1/2 right-5 -translate-y-1/2 text-white/15" />
    </motion.button>
  );
}

/* ── Component ── */
export default function CosmicHub({ walletAddress, prismBalance, onNavigateToCard, identityScore, planetTier }: CosmicHubProps) {
  const navigate = useNavigate();
  const [sybilGrade, setSybilGrade] = useState<string | null>(null);
  const compositeData = useCompositeScore(walletAddress || null);

  // Fetch sybil grade
  useEffect(() => {
    if (!walletAddress) return;
    const base = getHeliusProxyUrl() || (typeof window !== 'undefined' ? window.location.origin : '');
    fetch(`${base}/api/sybil/analysis?address=${walletAddress}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.trustGrade) setSybilGrade(d.trustGrade);
      })
      .catch(() => {});
  }, [walletAddress]);

  const goTo = useCallback((route: string) => {
    trackInternalNavigation();
    navigate(route);
  }, [navigate]);

  const hasIdentity = typeof identityScore === 'number' && identityScore > 0 && planetTier;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 0.95, filter: 'blur(10px)' }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="fixed inset-0 bg-[#030308] overflow-hidden font-sans text-white selection:bg-purple-500/30"
    >
      {/* --- 3D Background --- */}
      <div className="absolute inset-0 z-0">
        <Canvas camera={{ position: [0, 0, 8], fov: 50 }} dpr={[1, 1.5]}>
          <color attach="background" args={['#030308']} />
          <fog attach="fog" args={['#030308', 5, 20]} />
          <Suspense fallback={null}>
            <LocalEnvironment />
            <PrismCore />
            <Stars radius={50} depth={50} count={2000} factor={3} saturation={1} fade speed={1} />
            <Sparkles count={60} scale={10} size={3} speed={0.2} opacity={0.4} color="#a78bfa" />
          </Suspense>
        </Canvas>
      </div>

      {/* --- 2D UI Overlay --- */}
      <div className="absolute inset-0 z-10 flex flex-col pointer-events-none overflow-y-auto">

        {/* Header */}
        <motion.header
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="w-full px-5 pt-5 pb-3 flex justify-between items-center pointer-events-auto"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-purple-500 flex items-center justify-center">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M12 2L2 9L12 16L22 9L12 2Z"/><path d="M2 15L12 22L22 15" fill="none" stroke="white" strokeWidth="2"/></svg>
            </div>
            <div>
              <span className="text-sm font-bold tracking-wider text-white/90">IDENTITY PRISM</span>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-[10px] text-white/40 font-medium tracking-wide">SYSTEM ONLINE</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] border border-white/[0.08] px-3 py-1.5 text-xs font-mono text-white/60 select-all">
              {truncAddr(walletAddress)}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] border border-white/[0.08] px-3 py-1.5 text-xs font-bold text-amber-400">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/><path d="M12 6v12M8 10h8M8 14h8" stroke="#000" strokeWidth="1.5"/></svg>
              {prismBalance?.balance ?? 0}
            </span>
          </div>
        </motion.header>

        {/* Main Content */}
        <div className="flex-1 w-full max-w-5xl mx-auto px-5 pb-8 flex flex-col lg:flex-row gap-6 items-start justify-center">

          {/* Left: Mini Passport */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="w-full lg:w-72 flex flex-col gap-4 flex-shrink-0"
          >
            {hasIdentity ? (
              <MiniPassport
                walletAddress={walletAddress}
                score={compositeData.score > 0 ? compositeData.score : identityScore}
                tier={compositeData.score > 0 ? compositeData.tier : planetTier}
                coins={prismBalance?.balance ?? 0}
                sybilGrade={sybilGrade}
                onClick={onNavigateToCard}
                maxScore={compositeData.score > 0 ? 1000 : 1400}
              />
            ) : (
              <NoCardFallback onClick={onNavigateToCard} />
            )}
          </motion.div>

          {/* Right: Navigation Grid */}
          <div className="w-full lg:flex-1 grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {MODULES.map((m, i) => (
              <NavCard
                key={m.id}
                label={m.label}
                desc={m.desc}
                icon={m.icon}
                colorClass={m.colorClass}
                delay={0.3 + i * 0.08}
                onClick={() => goTo(m.route)}
              />
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
