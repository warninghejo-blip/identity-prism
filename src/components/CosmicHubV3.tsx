/**
 * CosmicHub V3 — Premium Web3 Spatial Hub.
 * 3D rotating glass prism background + Glassmorphism Bento Box navigation grid.
 * Mini Identity Passport replaces the old "My Card" button.
 */
import { useCallback, useRef, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CosmicStarfield } from '@/components/CosmicStarfield';
import { trackInternalNavigation } from '@/lib/safeNavigate';
import { getHeliusProxyUrl } from '@/constants';
import { useCompositeScore } from '@/hooks/useCompositeScore';
import type { PlanetTier } from '@/hooks/useWalletData';
import {
  Trophy, Flame, Store, Swords, Medal, ScrollText, ArrowRight, Shield, Eye, Search, Zap,
} from 'lucide-react';
import { computeRangerXP, getRangerRank, getRankProgress, getNextRank, gatherXPSources } from '@/lib/rangerRanks';

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

/* ── Navigation module definitions ── */
interface ModuleDef {
  id: string;
  label: string;
  route: string;
  desc: string;
  icon: ReactNode;
  colorClass: string;
}

const HubIcon = ({ name }: { name: string }) => (
  <img src={`/hub/${name}.png`} alt={name} className="w-7 h-7 object-contain" loading="lazy" />
);

const MODULES: ModuleDef[] = [
  { id: 'league', label: 'Prism League', route: '/game', desc: 'Compete in arcade games',
    icon: <HubIcon name="league" />, colorClass: 'from-cyan-500 to-blue-400' },
  { id: 'scanner', label: 'Prism Scanner', route: '/scan', desc: 'Scan & explore wallets',
    icon: <HubIcon name="scanner" />, colorClass: 'from-cyan-500 to-sky-400' },
  { id: 'arena', label: 'Prism Arena', route: '/arena', desc: 'P2P battles & challenges',
    icon: <HubIcon name="arena" />, colorClass: 'from-pink-500 to-rose-400' },
  { id: 'blackhole', label: 'Black Hole', route: '/blackhole', desc: 'Destroy your identity',
    icon: <HubIcon name="blackhole" />, colorClass: 'from-purple-500 to-indigo-400' },
  { id: 'shop', label: 'Prism Shop', route: '/forge', desc: 'Customize your card',
    icon: <HubIcon name="shop" />, colorClass: 'from-amber-500 to-yellow-400' },
  { id: 'leaderboard', label: 'Leaderboard', route: '/leaderboard', desc: 'Top identity scores',
    icon: <HubIcon name="leaderboard" />, colorClass: 'from-yellow-500 to-orange-400' },
  { id: 'quests', label: 'Quests', route: '/quests', desc: 'Daily missions & rewards',
    icon: <HubIcon name="quests" />, colorClass: 'from-violet-500 to-purple-400' },
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
      className="group relative overflow-hidden rounded-2xl bg-white/[0.04] backdrop-blur-xl border border-white/[0.08] p-2 lg:p-5 cursor-pointer hover:bg-white/[0.08] transition-all duration-500 hover:scale-[1.02] hover:border-white/[0.15] pointer-events-auto"
    >
      <div className={`absolute top-0 left-0 w-1 h-full bg-gradient-to-b ${colorClass} opacity-40 group-hover:opacity-100 transition-opacity`} />
      {/* Mobile: centered icon + name */}
      <div className="flex flex-col items-center gap-1 lg:hidden">
        <div className="p-1.5 rounded-lg bg-white/[0.05] border border-white/[0.08] text-white/80">
          {icon}
        </div>
        <span className="text-[10px] font-bold text-white/70 text-center leading-tight">{label}</span>
      </div>
      {/* Desktop: full card */}
      <div className="hidden lg:block">
        <div className="flex justify-between items-start mb-3">
          <div className="p-2.5 rounded-xl bg-white/[0.05] border border-white/[0.08] text-white/80 group-hover:text-white group-hover:scale-110 transition-all duration-500">
            {icon}
          </div>
          <ArrowRight size={18} className="text-white/20 group-hover:text-white/70 group-hover:translate-x-1 transition-all duration-300 mt-1" />
        </div>
        <h3 className="text-base font-bold text-white/90 mb-0.5 tracking-wide">{label}</h3>
        <p className="text-xs text-white/40 font-medium">{desc}</p>
      </div>
      <div className={`absolute -bottom-8 -right-8 w-28 h-28 bg-gradient-to-br ${colorClass} rounded-full blur-3xl opacity-0 group-hover:opacity-15 transition-opacity duration-500`} />
    </motion.div>
  );
}

/* ── Truncate address ── */
function truncAddr(a: string) {
  return a.length > 8 ? `${a.slice(0, 4)}...${a.slice(-4)}` : a;
}

/* ── Mini Identity Passport (Elite Passport) ── */
const MINI_BARS = [
  { key: 'onchain' as const, label: 'On-Chain', max: 400, color: '#22d3ee' },
  { key: 'sybilTrust' as const, label: 'Trust', max: 250, color: '#a78bfa' },
  { key: 'humanProof' as const, label: 'Human', max: 150, color: '#34d399' },
  { key: 'social' as const, label: 'Social', max: 100, color: '#fb923c' },
  { key: 'engagement' as const, label: 'Activity', max: 100, color: '#f472b6' },
];

function MiniPassport({
  walletAddress, score, tier, coins, sybilGrade, onClick, maxScore = 1000,
  breakdown, onBuyCoins, boostRate,
}: {
  walletAddress: string;
  score: number;
  tier: string;
  coins: number;
  sybilGrade: string | null;
  onClick: () => void;
  maxScore?: number;
  breakdown?: { onchain: number; sybilTrust: number; humanProof: number; social: number; engagement: number };
  onBuyCoins?: () => void;
  boostRate?: number;
}) {
  const tierColor = TIER_COLORS[tier] ?? TIER_COLORS.mercury;
  const gradeColor = SYBIL_GRADE_COLORS[sybilGrade ?? 'N/A'] ?? '#64748b';
  const tierLabel = tier === 'binary_sun' ? 'BINARY SUN' : tier.toUpperCase();
  const docNo = walletAddress.slice(0, 8).toUpperCase();

  // Score ring (SVG)
  const pct = Math.min(score / maxScore, 1);
  const r = 36;
  const circ = 2 * Math.PI * r;
  const strokeDash = circ * pct;

  // MRZ line
  const mrzTier = tierLabel.replace(/\s/g, '');
  const mrzAddr = walletAddress.slice(0, 8).toUpperCase();
  const mrz = `P<SLNA${mrzTier}<<<${mrzAddr}<<<`;

  // Small ring for mobile
  const rMobile = 20;
  const circMobile = 2 * Math.PI * rMobile;
  const strokeDashMobile = circMobile * pct;

  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className="passport-holo-shimmer relative w-full rounded-2xl overflow-hidden bg-gradient-to-br from-white/[0.06] via-white/[0.03] to-white/[0.01] backdrop-blur-xl border border-white/[0.1] cursor-pointer hover:bg-white/[0.08] transition-all duration-500 hover:border-white/[0.2] text-left pointer-events-auto group"
    >
      {/* Security band */}
      <div className="absolute top-0 left-0 w-full h-[3px]" style={{ background: `linear-gradient(90deg, ${tierColor.text}60, #a78bfa80, ${tierColor.text}60)` }} />
      <div className="absolute -top-12 -right-12 w-32 h-32 rounded-full blur-3xl opacity-20 transition-opacity duration-700 group-hover:opacity-40" style={{ background: tierColor.text }} />

      {/* ═══ MOBILE: compact horizontal layout ═══ */}
      <div className="lg:hidden relative p-3 flex items-center gap-3">
        {/* Score ring 48x48 */}
        <div className="flex-shrink-0">
          <svg width="48" height="48" viewBox="0 0 48 48">
            <circle cx="24" cy="24" r={rMobile} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="3" />
            <circle cx="24" cy="24" r={rMobile} fill="none" stroke={tierColor.text} strokeWidth="3" strokeLinecap="round" strokeDasharray={`${strokeDashMobile} ${circMobile}`} transform="rotate(-90 24 24)" style={{ filter: `drop-shadow(0 0 6px ${tierColor.glow})` }} />
            <text x="24" y="26" textAnchor="middle" fill={tierColor.text} fontSize="12" fontWeight="bold" fontFamily="monospace">{score}</text>
          </svg>
        </div>
        {/* Tier + score + coins */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-xs font-black tracking-[0.12em] uppercase" style={{ color: tierColor.text, textShadow: `0 0 12px ${tierColor.glow}` }}>
              {tierLabel}
            </span>
            {(() => {
              const xp = computeRangerXP(gatherXPSources(walletAddress));
              const r = getRangerRank(xp);
              if (r.id === 'cadet' && xp === 0) return null;
              return <span className="text-[9px]" title={r.name}>{r.icon}</span>;
            })()}
          </div>
          <div className="text-[9px] text-white/30 mb-1">{score}/{maxScore}</div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="#fbbf24"><circle cx="12" cy="12" r="10"/><path d="M12 6v12M8 10h8M8 14h8" stroke="#000" strokeWidth="1.5"/></svg>
              <span className="text-[10px] font-bold text-amber-400">{coins}</span>
            </div>
            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-md" style={{ background: `${gradeColor}15`, border: `1px solid ${gradeColor}25` }}>
              <Shield size={9} style={{ color: gradeColor }} />
              <span className="text-[9px] font-black" style={{ color: gradeColor }}>{sybilGrade ?? '...'}</span>
            </div>
            {boostRate != null && boostRate > 0 && (
              <div className="flex items-center gap-0.5 px-1 py-0.5 rounded-md" style={{ background: 'linear-gradient(135deg, rgba(168,85,247,0.25), rgba(251,146,60,0.25))', border: '1px solid rgba(168,85,247,0.45)' }}>
                <Zap size={8} style={{ color: '#fb923c' }} />
                <span className="text-[8px] font-black" style={{ background: 'linear-gradient(90deg, #a855f7, #fb923c)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>+{boostRate}%</span>
              </div>
            )}
          </div>
        </div>
        <div className="flex-shrink-0 text-[8px] text-white/20 font-mono">{truncAddr(walletAddress)}</div>
        <ArrowRight size={14} className="flex-shrink-0 text-white/20 group-hover:text-white/50 transition-all" />
      </div>

      {/* ═══ DESKTOP: full vertical passport ═══ */}
      <div className="hidden lg:block relative p-5 pt-4">
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ color: tierColor.text }}>
              <path d="M12 2L2 20h20L12 2z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
              <path d="M12 8l-4 8h8l-4-8z" fill="currentColor" opacity="0.3" />
            </svg>
            <span className="text-[9px] font-bold tracking-[0.25em] uppercase" style={{ color: `${tierColor.text}99` }}>Identity Passport</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[8px] text-white/20 font-mono">{docNo}</span>
            <ArrowRight size={12} className="text-white/20 group-hover:text-white/50 group-hover:translate-x-0.5 transition-all" />
          </div>
        </div>

        <div className="w-full h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent mb-3" />

        <div className="flex justify-center mb-3">
          <svg width="96" height="96" viewBox="0 0 96 96">
            <circle cx="48" cy="48" r={r} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="5" />
            <circle cx="48" cy="48" r={r} fill="none" stroke={tierColor.text} strokeWidth="5" strokeLinecap="round" strokeDasharray={`${strokeDash} ${circ}`} transform="rotate(-90 48 48)" style={{ filter: `drop-shadow(0 0 8px ${tierColor.glow})`, transition: 'stroke-dasharray 1.2s ease-out' }} />
            <text x="48" y="43" textAnchor="middle" fill={tierColor.text} fontSize="22" fontWeight="bold" fontFamily="monospace" style={{ filter: `drop-shadow(0 0 4px ${tierColor.glow})` }}>{score}</text>
            <text x="48" y="57" textAnchor="middle" fill="rgba(255,255,255,0.25)" fontSize="9" fontWeight="600" letterSpacing="0.5">/ {maxScore}</text>
          </svg>
        </div>

        <div className="text-center mb-3">
          <div className="text-base font-black tracking-[0.15em] uppercase" style={{ color: tierColor.text, textShadow: `0 0 16px ${tierColor.glow}, 0 0 32px ${tierColor.glow}` }}>{tierLabel}</div>
          <div className="text-[9px] text-white/20 mt-0.5 tracking-wider">COMPOSITE RANK</div>
          {/* Ranger Rank */}
          {(() => {
            const sources = gatherXPSources(walletAddress);
            const xp = computeRangerXP(sources);
            const rank = getRangerRank(xp);
            const progress = getRankProgress(xp);
            if (rank.id === 'cadet' && xp === 0) return null;
            return (
              <div className="mt-1.5 flex items-center justify-center gap-1.5">
                <span className="text-sm">{rank.icon}</span>
                <span className={`text-[10px] font-bold ${rank.color}`}>{rank.name}</span>
                <div className="w-12 h-1 bg-white/5 rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-purple-500" style={{ width: `${progress * 100}%` }} />
                </div>
              </div>
            );
          })()}
        </div>

        {breakdown && (
          <div className="space-y-1.5 mb-3">
            {MINI_BARS.map(bar => {
              const val = breakdown[bar.key] || 0;
              const barPct = Math.min(100, (val / bar.max) * 100);
              return (
                <div key={bar.key} className="flex items-center gap-2">
                  <span className="text-[8px] text-white/30 w-[38px] text-right font-medium truncate">{bar.label}</span>
                  <div className="flex-1 h-1 rounded-full bg-white/[0.06] overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-1000" style={{ width: `${barPct}%`, backgroundColor: bar.color }} />
                  </div>
                  <span className="text-[8px] font-mono w-[28px]" style={{ color: bar.color }}>{val}</span>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 px-2 py-0.5 rounded-md" style={{ background: `${gradeColor}15`, border: `1px solid ${gradeColor}25` }}>
              <Shield size={10} style={{ color: gradeColor }} />
              <span className="text-[10px] font-black" style={{ color: gradeColor }}>{sybilGrade ?? '...'}</span>
            </div>
            <div className="flex items-center gap-1">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="#fbbf24"><circle cx="12" cy="12" r="10"/><path d="M12 6v12M8 10h8M8 14h8" stroke="#000" strokeWidth="1.5"/></svg>
              <span className="text-[10px] font-bold text-amber-400">{coins}</span>
              {onBuyCoins && (
                <button onClick={(e) => { e.stopPropagation(); onBuyCoins(); }} className="w-4 h-4 rounded-full bg-amber-400/20 border border-amber-400/30 flex items-center justify-center text-amber-400 text-[10px] font-bold hover:bg-amber-400/30 transition-colors ml-0.5" title="Buy Coins">+</button>
              )}
              {boostRate != null && boostRate > 0 && (
                <div className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-md ml-1" style={{ background: 'linear-gradient(135deg, rgba(168,85,247,0.25), rgba(251,146,60,0.25))', border: '1px solid rgba(168,85,247,0.45)', boxShadow: '0 0 8px rgba(168,85,247,0.35), 0 0 16px rgba(251,146,60,0.15)' }} title={`Staking boost: +${boostRate}%`}>
                  <Zap size={8} style={{ color: '#fb923c', filter: 'drop-shadow(0 0 4px rgba(251,146,60,0.8))' }} />
                  <span className="text-[9px] font-black tracking-tight" style={{ background: 'linear-gradient(90deg, #a855f7, #fb923c)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>+{boostRate}%</span>
                </div>
              )}
            </div>
          </div>
          <div className="text-[9px] text-white/20 font-mono tracking-wider">{truncAddr(walletAddress)}</div>
        </div>

        <div className="mt-2.5 pt-2 border-t border-white/[0.04]">
          <div className="text-[8px] font-mono text-white/[0.1] tracking-[0.06em] truncate select-none">{mrz}</div>
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
  const [boostRate, setBoostRate] = useState<number>(0);
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

  // Fetch staking boost rate
  useEffect(() => {
    if (!walletAddress) return;
    const base = getHeliusProxyUrl() || (typeof window !== 'undefined' ? window.location.origin : '');
    fetch(`${base}/api/prism/vault/status?address=${walletAddress}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (typeof d?.boostRate === 'number' && d.boostRate > 0) setBoostRate(d.boostRate);
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
      {/* --- 2D Starfield + Nebula Background --- */}
      <div className="absolute inset-0 z-0">
        <CosmicStarfield mode="drift" />
        <div className="absolute inset-0 pointer-events-none">
          <div className="landing-nebula landing-nebula-1" />
          <div className="landing-nebula landing-nebula-2" />
        </div>
      </div>

      {/* --- 2D UI Overlay --- */}
      <div className="absolute inset-0 z-10 flex flex-col pointer-events-none overflow-y-auto">

        {/* Header — compact single line */}
        <motion.header
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="w-full px-4 py-2 lg:px-5 lg:pt-5 lg:pb-3 flex justify-between items-center pointer-events-auto"
        >
          <div className="flex items-center gap-2 lg:gap-3">
            <div className="w-7 h-7 lg:w-8 lg:h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-purple-500 flex items-center justify-center flex-shrink-0">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="white"><path d="M12 2L2 9L12 16L22 9L12 2Z"/><path d="M2 15L12 22L22 15" fill="none" stroke="white" strokeWidth="2"/></svg>
            </div>
            <span className="text-xs lg:text-sm font-bold tracking-wider text-white/90">IDENTITY PRISM</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[9px] lg:text-[10px] text-white/40 font-medium tracking-wide">ONLINE</span>
          </div>
        </motion.header>

        {/* Main Content — mobile: vertical stack, desktop: side-by-side */}
        <div className="flex-1 w-full max-w-5xl mx-auto px-4 lg:px-5 pb-6 lg:pb-8 flex flex-col lg:flex-row gap-3 lg:gap-6 items-start justify-center">

          {/* Passport — top on mobile, left sidebar on desktop */}
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="w-full lg:w-72 flex-shrink-0"
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
                breakdown={compositeData.score > 0 ? compositeData.breakdown : undefined}
                onBuyCoins={() => navigate('/forge')}
                boostRate={boostRate}
              />
            ) : (
              <NoCardFallback onClick={onNavigateToCard} />
            )}
          </motion.div>

          {/* Navigation Grid — 4 cols mobile, 3 cols desktop */}
          <div className="w-full lg:flex-1 grid grid-cols-4 lg:grid-cols-3 gap-2 lg:gap-3">
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
