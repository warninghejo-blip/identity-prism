/**
 * CosmicHub V3 — Premium Web3 Spatial Hub.
 * 3D rotating glass prism background + Glassmorphism Bento Box navigation grid.
 * Mini Identity Passport replaces the old "My Card" button.
 */
import { useEffect, useState, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { CosmicStarfield } from '@/components/CosmicStarfield';
import { trackInternalNavigation } from '@/lib/safeNavigate';
import { startFadeTransition } from '@/lib/fadeTransition';
import { getHeliusProxyUrl } from '@/constants';
import { getCompositeTierFromScore, getTierIcon } from '@/lib/constants/tierColors';
import { useCompositeScore } from '@/hooks/useCompositeScore';
import { getBoostedCompositeScore } from '@/lib/shipStats';
import { fetchApiJson, fetchSybilAnalysis, getCachedJwt } from '@/components/prism/shared';
import { writeCachedNotifications, type CachedNotification } from '@/lib/notificationCache';
import { prefetchBlackHoleForAddress } from '@/hooks/useBlackHolePrefetch';
import TrustGradeBadge from '@/components/TrustGradeBadge';
import type { PlanetTier } from '@/hooks/useWalletData';
import { ArrowRight, Eye, Zap, LogOut, Bell, ChevronDown, Users } from 'lucide-react';
import { useRangerProgress } from '@/hooks/useRangerProgress';

type DailyLimitsData = {
  game: { earned: number; cap: number };
  hunt: { earned: number; cap: number };
  scan: { earned: number; cap: number };
  quiz: { earned: number; cap: number };
  nonGame: { earned: number; cap: number };
  blackHole?: { earned: number; cap: number };
  blackHoleCap?: number;
};

const dailyLimitsMemory = new Map<string, DailyLimitsData>();
const getDailyLimitsDateKey = () => new Date().toISOString().slice(0, 10);
const getDailyLimitsCacheKey = (address: string) => `identity-prism:daily-limits:${address}:${getDailyLimitsDateKey()}`;

const readCachedDailyLimits = (address: string): DailyLimitsData | null => {
  if (!address) return null;
  const memory = dailyLimitsMemory.get(getDailyLimitsCacheKey(address));
  if (memory) return memory;
  if (typeof window === 'undefined') return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(getDailyLimitsCacheKey(address)) || 'null') as {
      date?: string;
      data?: DailyLimitsData;
    } | null;
    if (parsed?.date !== getDailyLimitsDateKey() || !parsed.data) return null;
    dailyLimitsMemory.set(getDailyLimitsCacheKey(address), parsed.data);
    return parsed.data;
  } catch {
    return null;
  }
};

const writeCachedDailyLimits = (address: string, data: DailyLimitsData) => {
  if (!address) return;
  const key = getDailyLimitsCacheKey(address);
  dailyLimitsMemory.set(key, data);
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify({ date: getDailyLimitsDateKey(), data }));
  } catch {
    /* storage can be unavailable */
  }
};

/* ── Tier color map ── */
const TIER_COLORS: Record<string, { text: string; glow: string; bg: string }> = {
  mercury: { text: '#94a3b8', glow: 'rgba(148,163,184,0.3)', bg: 'from-slate-500/20 to-slate-600/20' },
  mars: { text: '#f87171', glow: 'rgba(248,113,113,0.3)', bg: 'from-red-500/20 to-red-600/20' },
  venus: { text: '#fbbf24', glow: 'rgba(251,191,36,0.3)', bg: 'from-amber-500/20 to-amber-600/20' },
  earth: { text: '#34d399', glow: 'rgba(52,211,153,0.3)', bg: 'from-emerald-500/20 to-emerald-600/20' },
  neptune: { text: '#60a5fa', glow: 'rgba(96,165,250,0.3)', bg: 'from-blue-500/20 to-blue-600/20' },
  uranus: { text: '#67e8f9', glow: 'rgba(103,232,249,0.3)', bg: 'from-cyan-500/20 to-cyan-600/20' },
  saturn: { text: '#c084fc', glow: 'rgba(192,132,252,0.3)', bg: 'from-purple-500/20 to-purple-600/20' },
  jupiter: { text: '#fb923c', glow: 'rgba(251,146,60,0.3)', bg: 'from-orange-500/20 to-orange-600/20' },
  sun: { text: '#fde047', glow: 'rgba(253,224,71,0.4)', bg: 'from-yellow-500/20 to-yellow-600/20' },
  binary_sun: { text: '#f0abfc', glow: 'rgba(240,171,252,0.4)', bg: 'from-fuchsia-500/20 to-fuchsia-600/20' },
};

/* ── Props ── */
export interface CosmicHubProps {
  walletAddress: string;
  prismBalance?: { balance: number } | null;
  onNavigateToCard: () => void;
  onDisconnect?: () => void;
  onSwitchSeedAccount?: () => void;
  seedAccountIndex?: number;
  identityScore?: number;
  planetTier?: PlanetTier;
  jwtDeclined?: boolean;
  onRequestSign?: () => void;
}

/* ── Navigation module definitions ── */
interface ModuleDef {
  id: string;
  label: string;
  route: string;
  desc: string;
  icon: ReactNode;
  iconName: string;
  colorClass: string;
}

const HubIcon = ({ name, size = 28 }: { name: string; size?: number }) => {
  return (
    <img
      src={`/hub/${name}.png`}
      alt={name}
      width={256}
      height={256}
      style={{ width: size, height: size }}
      className="object-contain flex-shrink-0"
      loading="lazy"
      draggable={false}
    />
  );
};

const MODULES: ModuleDef[] = [
  {
    id: 'league',
    label: 'League',
    route: '/game',
    desc: 'Compete in arcade games',
    icon: <HubIcon name="league" />,
    iconName: 'league',
    colorClass: 'from-cyan-500 to-blue-400',
  },
  {
    id: 'scanner',
    label: 'Sybil Hunt',
    route: '/scan',
    desc: 'Hunt sybils for bounty',
    icon: <HubIcon name="scanner" />,
    iconName: 'scanner',
    colorClass: 'from-amber-500 to-red-400',
  },
  {
    id: 'arena',
    label: 'Arena',
    route: '/arena',
    desc: 'P2P battles & challenges',
    icon: <HubIcon name="arena" />,
    iconName: 'arena',
    colorClass: 'from-pink-500 to-rose-400',
  },
  {
    id: 'blackhole',
    label: 'Black Hole',
    route: '/blackhole',
    desc: 'Burn dust, salvage SOL',
    icon: <HubIcon name="blackhole" />,
    iconName: 'blackhole',
    colorClass: 'from-red-500 to-orange-400',
  },
  {
    id: 'shop',
    label: 'Shop',
    route: '/forge',
    desc: 'Customize your card',
    icon: <HubIcon name="shop" />,
    iconName: 'shop',
    colorClass: 'from-amber-500 to-yellow-400',
  },
  {
    id: 'leaderboard',
    label: 'Leaderboard',
    route: '/leaderboard',
    desc: 'Top identity scores',
    icon: <HubIcon name="leaderboard" />,
    iconName: 'leaderboard',
    colorClass: 'from-yellow-500 to-orange-400',
  },
  {
    id: 'quests',
    label: 'Quests',
    route: '/quests',
    desc: 'Daily missions & rewards',
    icon: <HubIcon name="quests" />,
    iconName: 'quests',
    colorClass: 'from-violet-500 to-purple-400',
  },
  {
    id: 'vault',
    label: 'Vault',
    route: '/vault',
    desc: 'Buy coins & staking',
    icon: <HubIcon name="vault" />,
    iconName: 'vault',
    colorClass: 'from-emerald-500 to-teal-400',
  },
];

/* ── NavCard component — large icon + label below, no frame ── */
function NavCard({
  label,
  iconName,
  colorClass,
  route,
}: {
  label: string;
  iconName: string;
  colorClass: string;
  route: string;
}) {
  return (
    <motion.div variants={hubItemVariants} className="pointer-events-auto">
      <Link
        to={route}
        onClick={trackInternalNavigation}
        aria-label={label}
        className="group flex min-h-[96px] w-full flex-col items-center justify-center gap-1.5 cursor-pointer pointer-events-auto active:scale-90 transition-transform overflow-visible rounded-lg bg-transparent p-0 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
      >
        <div className="relative">
          <HubIcon name={iconName} size={64} />
          <div
            className={`absolute -inset-3 bg-gradient-to-br ${colorClass} rounded-full blur-xl opacity-0 group-hover:opacity-25 transition-opacity duration-500 -z-10`}
          />
        </div>
        <span className="text-[10px] font-bold text-white/50 group-hover:text-white/80 transition-colors text-center leading-tight tracking-wide">
          {label}
        </span>
      </Link>
    </motion.div>
  );
}

const hubContentVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      delayChildren: 0.06,
      staggerChildren: 0.035,
    },
  },
};

const hubItemVariants = {
  hidden: { opacity: 0, y: 10, filter: 'blur(8px)' },
  show: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { duration: 0.34, ease: [0.22, 1, 0.36, 1] },
  },
};

/* ── Mini Identity Passport (Premium Redesign) ── */

function MiniPassport({
  walletAddress,
  score,
  tier,
  coins,
  sybilGrade,
  onClick,
  maxScore = 1000,
  onBuyCoins,
  boostRate,
  breakdown,
}: {
  walletAddress: string;
  score: number;
  tier: string;
  coins: number;
  sybilGrade: string | null;
  onClick: () => void;
  maxScore?: number;
  onBuyCoins?: () => void;
  boostRate?: number;
  breakdown?: { onchain: number; sybilTrust: number; humanProof: number; social: number; engagement: number } | null;
}) {
  const tierColor = TIER_COLORS[tier] ?? TIER_COLORS.mercury;
  const rangerProgress = useRangerProgress(walletAddress);
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
      type="button"
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className="passport-holo-shimmer relative w-full rounded-2xl overflow-hidden bg-gradient-to-br from-white/[0.06] via-white/[0.03] to-white/[0.01] backdrop-blur-xl border border-white/[0.1] cursor-pointer hover:bg-white/[0.08] transition-all duration-500 hover:border-white/[0.2] text-left pointer-events-auto group focus-visible:ring-2 focus-visible:ring-cyan-400/50 focus-visible:outline-none"
    >
      <div
        className="absolute -top-12 -right-12 w-32 h-32 rounded-full blur-3xl opacity-20 transition-opacity duration-700 group-hover:opacity-40"
        style={{ background: tierColor.text }}
      />

      {/* ═══ MOBILE: clean compact layout ═══ */}
      <div className="lg:hidden relative p-3">
        {/* Row 1: Score ring + Tier left, Sybil + Coins right */}
        <div className="flex items-start gap-2.5">
          <div className="flex-shrink-0">
            <svg width="44" height="44" viewBox="0 0 44 44">
              <circle cx="22" cy="22" r={rMobile} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="2.5" />
              <circle
                cx="22"
                cy="22"
                r={rMobile}
                fill="none"
                stroke={tierColor.text}
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeDasharray={`${strokeDashMobile} ${circMobile}`}
                transform="rotate(-90 22 22)"
                style={{ filter: `drop-shadow(0 0 6px ${tierColor.glow})` }}
              />
              <text
                x="22"
                y="24"
                textAnchor="middle"
                fill={tierColor.text}
                fontSize="11"
                fontWeight="bold"
                fontFamily="monospace"
              >
                {score}
              </text>
            </svg>
          </div>
          <div className="flex-1 min-w-0 pt-0.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <img
                  src={getTierIcon(tier)}
                  alt=""
                  className="w-4 h-4 object-contain"
                  style={{ filter: `drop-shadow(0 0 4px ${tierColor.glow})` }}
                />
                <span
                  className="text-[11px] font-black tracking-[0.1em] uppercase"
                  style={{ color: tierColor.text, textShadow: `0 0 12px ${tierColor.glow}` }}
                >
                  {tierLabel}
                </span>
                {sybilGrade && <TrustGradeBadge grade={sybilGrade} size="xs" />}
              </div>
              {/* Coins */}
              <div className="flex items-center gap-1">
                <svg width="8" height="8" viewBox="0 0 24 24" fill="#fbbf24">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 6v12M8 10h8M8 14h8" stroke="#000" strokeWidth="1.5" />
                </svg>
                <span className="text-[9px] font-bold text-amber-400/70">{coins.toLocaleString()}</span>
                {onBuyCoins && (
                  <svg
                    onClick={(e) => {
                      e.stopPropagation();
                      onBuyCoins();
                    }}
                    width="10"
                    height="10"
                    viewBox="0 0 10 10"
                    className="cursor-pointer hover:opacity-80 transition-opacity"
                    style={{ flexShrink: 0 }}
                  >
                    <title>Buy Coins</title>
                    <circle
                      cx="5"
                      cy="5"
                      r="4.5"
                      fill="rgba(251,191,36,0.15)"
                      stroke="rgba(251,191,36,0.25)"
                      strokeWidth="0.5"
                    />
                    <text
                      x="5"
                      y="5.5"
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill="#fbbf24"
                      fontSize="7"
                      fontWeight="bold"
                    >
                      +
                    </text>
                  </svg>
                )}
              </div>
            </div>
            <span className="text-[8px] text-white/20 font-mono">
              {walletAddress.slice(0, 4)}...{walletAddress.slice(-4)}
            </span>
          </div>
        </div>

        {/* Stat bars — same categories as identity card */}
        {breakdown && (
          <div className="mt-2.5 grid grid-cols-5 gap-1.5">
            {(
              [
                { key: 'onchain', label: 'On-Chain', icon: '/textures/Solana.png', color: '#22d3ee', max: 400 },
                {
                  key: 'sybilTrust',
                  label: 'Trust',
                  icon: '/icons/trust/trust-grade-unknown.png',
                  color: '#a78bfa',
                  max: 250,
                },
                { key: 'humanProof', label: 'Games', icon: '/hub/league.png', color: '#34d399', max: 150 },
                { key: 'social', label: 'Social', icon: '/hub/arena.png', color: '#ef4444', max: 100 },
                { key: 'engagement', label: 'Engage', icon: '/hub/quests.png', color: '#f472b6', max: 100 },
              ] as const
            ).map(({ key, label, icon, color, max }) => {
              const rawValue = breakdown[key] ?? 0;
              const val = Math.max(0, Math.min(max, Math.round(rawValue)));
              const pctBar = Math.min(val / max, 1) * 100;
              return (
                <div key={key} className="flex flex-col items-center gap-0.5">
                  <div className="w-full h-1 rounded-full overflow-hidden" style={{ background: `${color}10` }}>
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${pctBar}%`, background: `linear-gradient(90deg, ${color}60, ${color})` }}
                    />
                  </div>
                  <span
                    className="flex h-3 items-center justify-center gap-0.5 text-[6px] font-bold uppercase tracking-wide"
                    style={{ color: `${color}80` }}
                  >
                    <img
                      src={icon}
                      alt=""
                      aria-hidden="true"
                      className="h-2 w-2 shrink-0 object-contain"
                      loading="lazy"
                      draggable={false}
                    />
                    {label}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Ranger progress */}
        {(() => {
          const { xp, rank, progress, next } = rangerProgress;
          if (rank.id === 'cadet' && xp === 0) return null;
          return (
            <div className="mt-2 flex items-start gap-2">
              <img
                src={rank.image}
                alt={rank.name}
                className="w-5 h-5 object-contain flex-shrink-0 mt-0.5"
                style={
                  rank.id === 'ace' || rank.id === 'legend'
                    ? { filter: `drop-shadow(0 0 4px ${rank.id === 'legend' ? '#f59e0b' : '#a855f7'})` }
                    : undefined
                }
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-0.5">
                  <span className={`text-[8px] font-bold ${rank.color}`}>{rank.name}</span>
                  {next && (
                    <span className="text-[7px] text-white/20 font-mono">
                      {next.xpNeeded} XP → {next.rank.name}
                    </span>
                  )}
                </div>
                <div className="h-[3px] rounded-full bg-white/[0.06] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-purple-500 transition-all duration-700"
                    style={{ width: `${progress * 100}%` }}
                  />
                </div>
              </div>
            </div>
          );
        })()}

        {/* MRZ */}
        <div className="mt-2 pt-1 border-t border-white/[0.04]">
          <div className="text-[7px] font-mono text-white/[0.06] tracking-[0.08em] truncate select-none">{mrz}</div>
          <div className="mt-1.5 flex items-center justify-center gap-1 text-[8px] font-bold uppercase tracking-[0.18em] text-cyan-200/45 transition-colors group-hover:text-cyan-200/80">
            <span>Tap to reveal full card</span>
            <ArrowRight size={9} aria-hidden="true" />
          </div>
        </div>
      </div>

      {/* ═══ DESKTOP: premium vertical passport ═══ */}
      <div className="hidden lg:block relative p-5 pt-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ color: tierColor.text }}>
              <path d="M12 2L2 20h20L12 2z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
              <path d="M12 8l-4 8h8l-4-8z" fill="currentColor" opacity="0.3" />
            </svg>
            <span className="text-[9px] font-bold tracking-[0.25em] uppercase" style={{ color: `${tierColor.text}99` }}>
              Identity Passport
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[8px] text-white/20 font-mono">{docNo}</span>
            <ArrowRight
              size={12}
              className="text-white/20 group-hover:text-white/50 group-hover:translate-x-0.5 transition-all"
            />
          </div>
        </div>

        <div className="w-full h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent mb-3" />

        {/* Score ring */}
        <div className="flex justify-center mb-3">
          <svg width="96" height="96" viewBox="0 0 96 96">
            <circle cx="48" cy="48" r={r} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="5" />
            <circle
              cx="48"
              cy="48"
              r={r}
              fill="none"
              stroke={tierColor.text}
              strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray={`${strokeDash} ${circ}`}
              transform="rotate(-90 48 48)"
              style={{ filter: `drop-shadow(0 0 8px ${tierColor.glow})`, transition: 'stroke-dasharray 1.2s ease-out' }}
            />
            <text
              x="48"
              y="50"
              textAnchor="middle"
              fill={tierColor.text}
              fontSize="24"
              fontWeight="bold"
              fontFamily="monospace"
              style={{ filter: `drop-shadow(0 0 4px ${tierColor.glow})` }}
            >
              {score}
            </text>
          </svg>
        </div>

        {/* Tier + Rank */}
        <div className="text-center mb-3">
          <div
            className="flex items-center justify-center gap-2 text-base font-black tracking-[0.15em] uppercase"
            style={{ color: tierColor.text, textShadow: `0 0 16px ${tierColor.glow}, 0 0 32px ${tierColor.glow}` }}
          >
            <img
              src={getTierIcon(tier)}
              alt=""
              className="w-6 h-6 object-contain"
              style={{ filter: `drop-shadow(0 0 6px ${tierColor.glow})` }}
            />
            {tierLabel}
          </div>
          <div className="text-[9px] text-white/50 mt-0.5 tracking-wider">COMPOSITE RANK</div>
          {/* Ranger Rank */}
          {(() => {
            const { xp, rank, progress, next } = rangerProgress;
            if (rank.id === 'cadet' && xp === 0) return null;
            return (
              <div className="mt-2 flex items-center justify-center gap-2">
                <img
                  src={rank.image}
                  alt={rank.name}
                  className="w-5 h-5 object-contain"
                  style={
                    rank.id === 'ace' || rank.id === 'legend'
                      ? { filter: `drop-shadow(0 0 4px ${rank.id === 'legend' ? '#f59e0b' : '#a855f7'})` }
                      : undefined
                  }
                />
                <span className={`text-[10px] font-bold ${rank.color}`}>{rank.name}</span>
                <div className="w-16 h-1.5 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-purple-500 transition-all duration-700"
                    style={{ width: `${progress * 100}%` }}
                  />
                </div>
                {next && <span className="text-[8px] text-white/15 font-mono">{xp} XP</span>}
              </div>
            );
          })()}
        </div>

        {/* Divider */}
        <div className="w-full h-px bg-gradient-to-r from-transparent via-white/[0.06] to-transparent mb-3" />

        {/* Stats row: Grade / Coins / Boost */}
        <div className="flex items-center justify-center gap-3 mb-3">
          <TrustGradeBadge grade={sybilGrade} size="xs" />
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl"
            style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.15)' }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="#fbbf24">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6v12M8 10h8M8 14h8" stroke="#000" strokeWidth="1.5" />
            </svg>
            <span className="text-[11px] font-bold text-amber-400">{coins.toLocaleString()}</span>
            {onBuyCoins && (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  onBuyCoins();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.stopPropagation();
                    onBuyCoins();
                  }
                }}
                className="w-4 h-4 aspect-square rounded-full bg-amber-400/20 border border-amber-400/30 flex items-center justify-center text-amber-400 text-[10px] leading-none font-bold hover:bg-amber-400/30 transition-colors cursor-pointer"
                title="Buy Coins"
              >
                +
              </span>
            )}
          </div>
          {boostRate != null && boostRate > 0 && (
            <div
              className="flex items-center gap-1 px-2 py-1 rounded-xl"
              style={{
                background: 'linear-gradient(135deg, rgba(168,85,247,0.15), rgba(251,146,60,0.15))',
                border: '1px solid rgba(168,85,247,0.3)',
                boxShadow: '0 0 8px rgba(168,85,247,0.2)',
              }}
              title={`Staking boost: +${Math.round(boostRate * 100)}% to earn rate`}
            >
              <Zap size={10} style={{ color: '#fb923c', filter: 'drop-shadow(0 0 4px rgba(251,146,60,0.8))' }} />
              <span
                className="text-[10px] font-black tracking-tight"
                style={{
                  background: 'linear-gradient(90deg, #a855f7, #fb923c)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                +{Math.round(boostRate * 100)}%
              </span>
            </div>
          )}
        </div>

        {/* MRZ line */}
        <div className="pt-2.5 border-t border-white/[0.04]">
          <div className="text-[8px] font-mono text-white/[0.1] tracking-[0.06em] truncate select-none">{mrz}</div>
          <div className="mt-2 flex items-center justify-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.2em] text-cyan-200/45 transition-colors group-hover:text-cyan-200/85">
            <span>Tap to reveal full card</span>
            <ArrowRight size={10} aria-hidden="true" />
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
      className="relative w-full rounded-2xl overflow-hidden bg-white/[0.04] backdrop-blur-xl border border-white/[0.08] p-6 cursor-pointer hover:bg-white/[0.07] transition-all duration-500 hover:border-cyan-500/20 text-left pointer-events-auto focus-visible:ring-2 focus-visible:ring-cyan-400/50 focus-visible:outline-none"
    >
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-slate-500 via-slate-400 to-slate-500 opacity-50" />
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-white/[0.05] to-white/[0.02] border border-white/[0.08] border-dashed flex items-center justify-center">
          <Eye size={22} className="text-white/20" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-white/70 mb-1">Identity Not Scanned</h3>
          <p className="text-[11px] text-white/50">Tap to scan your wallet and reveal your cosmic identity</p>
        </div>
      </div>
      <ArrowRight size={16} className="absolute top-1/2 right-5 -translate-y-1/2 text-white/15" />
    </motion.button>
  );
}

/* ── Component ── */
export default function CosmicHub({
  walletAddress,
  prismBalance,
  onNavigateToCard,
  onDisconnect,
  onSwitchSeedAccount,
  seedAccountIndex,
  identityScore,
  planetTier,
  jwtDeclined,
  onRequestSign,
}: CosmicHubProps) {
  const navigate = useNavigate();
  const [sybilGrade, setSybilGrade] = useState<string | null>(null);
  const [boostRate, setBoostRate] = useState<number>(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const compositeData = useCompositeScore(walletAddress || null);
  const refetchComposite = compositeData.refetch;

  // Apply Forge Frame boost to match CelestialCard display
  const [forgeFrame, setForgeFrame] = useState<string | null>(null);
  useEffect(() => {
    if (!walletAddress) return;
    try {
      const raw = localStorage.getItem(`prism_forge_loadout_v1_${walletAddress}`);
      if (raw) {
        const loadout = JSON.parse(raw);
        if (loadout.equippedFrame) setForgeFrame(loadout.equippedFrame);
      }
    } catch {}
  }, [walletAddress]);
  const frameLoadout = useMemo(
    () => (forgeFrame ? { equippedShipSkin: null, equippedFrame: forgeFrame, equippedAura: null } : null),
    [forgeFrame],
  );
  const boostedComposite = useMemo(() => {
    const result = getBoostedCompositeScore(compositeData.breakdown, frameLoadout);
    return result ?? { score: compositeData.score, breakdown: compositeData.breakdown };
  }, [compositeData.breakdown, compositeData.score, frameLoadout]);
  const hasCompositePassport = compositeData.hasComposite;
  const fallbackIdentityScore = typeof identityScore === 'number' ? Math.max(identityScore, 0) : 0;
  const hasCompositeScaleFallback = !hasCompositePassport && fallbackIdentityScore > 400;
  const fallbackPassportBreakdown = useMemo(
    () =>
      fallbackIdentityScore > 0 && !hasCompositeScaleFallback
        ? {
            onchain: Math.min(Math.round(fallbackIdentityScore), 400),
            sybilTrust: 0,
            humanProof: 0,
            social: 0,
            engagement: 0,
          }
        : null,
    [fallbackIdentityScore, hasCompositeScaleFallback],
  );
  const passportScore = hasCompositePassport ? boostedComposite.score : fallbackIdentityScore;
  const passportTier =
    hasCompositePassport || hasCompositeScaleFallback
      ? getCompositeTierFromScore(passportScore, planetTier ?? 'mercury')
      : (planetTier ?? 'mercury');
  const passportBreakdown = hasCompositePassport ? boostedComposite.breakdown : fallbackPassportBreakdown;
  const passportMaxScore = hasCompositePassport || hasCompositeScaleFallback ? 1000 : 400;
  const addressQuery = walletAddress ? `?address=${encodeURIComponent(walletAddress)}` : '';

  // Poll unread notification count
  useEffect(() => {
    if (!walletAddress) return;
    const base = getHeliusProxyUrl() || '';
    const fetchCount = () => {
      const jwt = getCachedJwt(walletAddress);
      fetchApiJson<{ count?: number }>(`${base}/api/notifications/unread-count?address=${walletAddress}`, {
        headers: jwt ? { Authorization: `Bearer ${jwt}` } : undefined,
        timeoutMs: 4_500,
      })
        .then((d) => setUnreadCount(d.count || 0))
        .catch(() => {});
      if (jwt) {
        fetchApiJson<{ notifications?: CachedNotification[] }>(`${base}/api/notifications?address=${walletAddress}`, {
          headers: { Authorization: `Bearer ${jwt}` },
          timeoutMs: 2_500,
        })
          .then((d) => {
            if (Array.isArray(d.notifications)) writeCachedNotifications(walletAddress, d.notifications);
          })
          .catch(() => {});
      }
    };
    fetchCount();
    const interval = setInterval(fetchCount, 60000);
    return () => clearInterval(interval);
  }, [walletAddress]);

  useEffect(() => {
    if (!walletAddress) return;
    const timeout = window.setTimeout(() => {
      void prefetchBlackHoleForAddress(walletAddress, { source: 'hub' }).catch((error) => {
        console.warn('[BH prefetch] hub failed', error);
      });
    }, 100);
    return () => window.clearTimeout(timeout);
  }, [walletAddress]);

  // Fetch sybil grade (shared deduped — same promise as CelestialCard)
  useEffect(() => {
    if (!walletAddress) return;
    let cancelled = false;
    fetchSybilAnalysis(walletAddress).then((d) => {
      if (!cancelled && d?.trustGrade) {
        setSybilGrade(d.trustGrade);
        if (!compositeData.hasComposite) {
          setTimeout(() => refetchComposite(), 500);
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [walletAddress, refetchComposite, compositeData.hasComposite]);

  // Fetch staking boost rate
  useEffect(() => {
    if (!walletAddress) return;
    const base = getHeliusProxyUrl() || (typeof window !== 'undefined' ? window.location.origin : '');
    const jwt = getCachedJwt(walletAddress);
    fetchApiJson<{ boostRate?: number }>(`${base}/api/prism/vault/status?address=${walletAddress}`, {
      headers: jwt ? { Authorization: `Bearer ${jwt}` } : undefined,
      timeoutMs: 4_500,
    })
      .then((d) => {
        if (typeof d?.boostRate === 'number' && d.boostRate > 0) setBoostRate(d.boostRate);
      })
      .catch(() => {});
  }, [walletAddress]);

  const hasIdentity = typeof identityScore === 'number' && identityScore >= 0 && planetTier;

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
      <div
        className="absolute inset-0 z-10 flex flex-col pointer-events-none overflow-y-auto"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        {/* Header — compact single line */}
        <motion.header
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="w-full px-4 py-2 lg:px-5 lg:pt-5 lg:pb-3 flex justify-between items-center pointer-events-auto"
        >
          <div className="flex items-center gap-2 lg:gap-3">
            <img
              src="/phav.png"
              alt="Identity Prism"
              className="w-7 h-7 lg:w-8 lg:h-8 rounded-lg flex-shrink-0 object-contain"
            />
            <span className="text-xs lg:text-sm font-bold tracking-wider text-white/90">IDENTITY PRISM</span>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to={`/inbox${addressQuery}`}
              onClick={trackInternalNavigation}
              aria-label={unreadCount > 0 ? `${unreadCount > 9 ? '9+' : unreadCount} notifications` : 'Notifications'}
              title="Notifications"
              className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.06] transition-colors hover:border-cyan-400/25 hover:bg-cyan-400/[0.10] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
            >
              <Bell className="h-4 w-4 text-white/45 transition-colors" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-red-500 text-[9px] font-bold text-white flex items-center justify-center">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </Link>
            {onDisconnect && (
              <button
                type="button"
                onClick={onDisconnect}
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.06] transition-colors hover:border-red-500/30 hover:bg-red-500/20 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
                title="Disconnect wallet"
                aria-label="Disconnect wallet"
              >
                <LogOut className="h-4 w-4 text-white/45 transition-colors group-hover:text-red-400" />
              </button>
            )}
          </div>
        </motion.header>

        {jwtDeclined && (
          <div className="mx-4 mt-2 p-2.5 rounded-xl bg-amber-500/[0.08] border border-amber-500/20 flex items-center justify-between gap-2">
            <span className="text-[11px] text-amber-400/80 font-medium">
              Sign wallet to earn coins and save progress
            </span>
            <button
              onClick={onRequestSign}
              className="px-3 py-1 text-[10px] font-bold rounded-full bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 transition-colors flex-shrink-0 focus-visible:ring-2 focus-visible:ring-cyan-400/50 focus-visible:outline-none"
            >
              Sign Now
            </button>
          </div>
        )}

        {/* Main Content — mobile: vertical stack, desktop: side-by-side */}
        <motion.div
          variants={hubContentVariants}
          initial="hidden"
          animate="show"
          className="flex-1 w-full max-w-5xl mx-auto px-4 lg:px-5 pt-2 pb-6 lg:pb-8 flex flex-col lg:flex-row gap-2 lg:gap-6 items-start lg:justify-center"
        >
          {/* Passport — top on mobile, left sidebar on desktop */}
          <motion.div variants={hubItemVariants} className="w-full lg:w-72 flex-shrink-0">
            {hasIdentity ? (
              <MiniPassport
                walletAddress={walletAddress}
                score={passportScore}
                tier={passportTier}
                coins={prismBalance?.balance ?? 0}
                sybilGrade={sybilGrade}
                onClick={onNavigateToCard}
                maxScore={passportMaxScore}
                onBuyCoins={() => {
                  startFadeTransition(() => navigate(`/vault${addressQuery}`));
                }}
                boostRate={boostRate}
                breakdown={passportBreakdown}
              />
            ) : (
              <NoCardFallback onClick={onNavigateToCard} />
            )}
          </motion.div>

          {/* Navigation Grid — 4 cols icon grid, tight */}
          <motion.div
            className="w-full lg:flex-1 grid grid-cols-4 gap-y-3 gap-x-0 pointer-events-auto"
            variants={hubContentVariants}
          >
            {MODULES.map((m) => (
              <NavCard
                key={m.id}
                label={m.label}
                iconName={m.iconName}
                colorClass={m.colorClass}
                route={`${m.route}${addressQuery}`}
              />
            ))}
          </motion.div>
        </motion.div>

        {/* Daily Limits Table */}
        {walletAddress && (
          <DailyLimitsTable
            address={walletAddress}
            initialValue={readCachedDailyLimits(walletAddress)}
            onData={(nextData) => writeCachedDailyLimits(walletAddress, nextData)}
          />
        )}
      </div>
    </motion.div>
  );
}

/* ── Daily Limits Table ── */
function DailyLimitsTable({
  address,
  initialValue,
  onData,
}: {
  address: string;
  initialValue?: DailyLimitsData | null;
  onData?: (data: DailyLimitsData) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [data, setData] = useState<DailyLimitsData | null>(() => initialValue ?? readCachedDailyLimits(address));

  useEffect(() => {
    const base = getHeliusProxyUrl() || '';
    if (!base || !address) return;
    const cached = readCachedDailyLimits(address);
    if (cached) setData(cached);
    const jwt = getCachedJwt(address);
    fetch(`${base}/api/daily-limits?address=${encodeURIComponent(address)}`, {
      headers: jwt ? { Authorization: `Bearer ${jwt}` } : undefined,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          setData(d);
          writeCachedDailyLimits(address, d);
          onData?.(d);
        }
      })
      .catch(() => {});
  }, [address, onData]);

  const fmt = (n: number | null | undefined) => (n != null ? n.toLocaleString() : '—');

  // Static caps as fallback
  const game = data?.game ?? { earned: 0, cap: 1000 };
  const scan = data?.scan ?? { earned: 0, cap: 100 };
  const hunt = data?.hunt ?? { earned: 0, cap: 500 };
  const quiz = data?.quiz ?? { earned: 0, cap: 500 };
  const nonGame = data?.nonGame ?? { earned: 0, cap: 750 };
  const blackHole = data?.blackHole ?? { earned: 0, cap: data?.blackHoleCap ?? 500 };

  const nonGameRemaining = Math.max(0, nonGame.cap - nonGame.earned);
  const gameRow = { label: 'Game rewards', earned: game.earned, cap: game.cap };
  const nonGameRow = { label: 'Non-game pool', earned: nonGame.earned, cap: nonGame.cap };
  const subRows: { label: string; earned: number; cap: number }[] = [
    { label: 'Scans', earned: scan.earned, cap: scan.cap },
    { label: 'Sybil Hunt', earned: hunt.earned, cap: hunt.cap },
    { label: 'Quiz', earned: quiz.earned, cap: quiz.cap },
    { label: 'Black Hole', earned: blackHole.earned, cap: blackHole.cap },
  ];

  const colorMap: Record<string, string> = {
    'Game rewards': '#22d3ee',
    'Non-game pool': '#a78bfa',
    Scans: '#34d399',
    'Sybil Hunt': '#f87171',
    Quiz: '#c084fc',
    'Black Hole': '#fb923c',
  };

  const getLimitState = (r: { earned: number; cap: number }, fallback: string) => {
    const ratio = r.cap > 0 ? r.earned / r.cap : 0;
    const atLimit = ratio >= 1;
    const nearLimit = !atLimit && ratio >= 0.8;
    const pct = Math.min(100, ratio * 100);
    return {
      ratio,
      pct,
      barColor: atLimit ? '#f87171' : nearLimit ? '#fbbf24' : fallback,
      valueClass: atLimit ? 'text-red-300' : nearLimit ? 'text-amber-300' : 'text-white/85',
      status: atLimit ? 'FULL' : nearLimit ? 'NEAR' : 'OK',
    };
  };

  const renderSourceRow = (r: { label: string; earned: number; cap: number }) => {
    const state = getLimitState(r, colorMap[r.label] ?? '#22d3ee');
    const sourceRemaining = Math.max(0, r.cap - r.earned);
    const effectiveRemaining = Math.min(sourceRemaining, nonGameRemaining);
    return (
      <div key={r.label} className="border-l border-white/[0.08] pl-2.5 py-1">
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-[9px] font-semibold text-white/58">{r.label}</span>
          <span className="shrink-0 font-mono text-[9px] tabular-nums">
            <span className={state.valueClass}>{fmt(r.earned)}</span>
            <span className="text-white/28">/{fmt(r.cap)}</span>
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/[0.07]">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${state.pct}%`,
                background: `linear-gradient(90deg, ${state.barColor}66, ${state.barColor})`,
              }}
            />
          </div>
          <span className="shrink-0 font-mono text-[7px] text-white/38">left {fmt(effectiveRemaining)}</span>
        </div>
      </div>
    );
  };

  const renderCompactPill = (label: string, row: { earned: number; cap: number }) => {
    const state = getLimitState(row, '#22d3ee');

    return (
      <span className="inline-flex min-w-0 items-baseline gap-1 rounded-md bg-white/[0.035] px-1.5 py-0.5">
        <span className="text-[8px] font-bold uppercase tracking-[0.1em] text-white/42">{label}</span>
        <span className={`font-mono text-[10px] font-bold tabular-nums ${state.valueClass}`}>
          {fmt(row.earned)}
          <span className="text-white/25">/{fmt(row.cap)}</span>
        </span>
      </span>
    );
  };

  const renderSummaryCard = (label: string, caption: string, row: { earned: number; cap: number }, color: string) => {
    const state = getLimitState(row, color);
    const remaining = Math.max(0, row.cap - row.earned);
    return (
      <div className="py-1">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-[9px] font-bold uppercase tracking-[0.1em] text-white/68">{label}</div>
            <div className="truncate text-[7px] font-semibold uppercase tracking-[0.08em] text-white/28">{caption}</div>
          </div>
          <div className="shrink-0 text-right">
            <div className={`font-mono text-[10px] font-black tabular-nums ${state.valueClass}`}>
              {fmt(row.earned)}
              <span className="text-[9px] text-white/28">/{fmt(row.cap)}</span>
            </div>
            <div className="font-mono text-[7px] text-white/36">left {fmt(remaining)}</div>
          </div>
        </div>
        <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-white/[0.07]">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${state.pct}%`,
              background: `linear-gradient(90deg, ${state.barColor}66, ${state.barColor})`,
            }}
          />
        </div>
      </div>
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="relative mx-4 mt-2 mb-2 overflow-hidden rounded-xl border border-white/[0.1] bg-[#0b1020]/86 shadow-[0_12px_28px_rgba(0,0,0,0.28)] backdrop-blur-xl pointer-events-auto"
    >
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="daily-limits-details"
            initial={{ height: 0, opacity: 0, y: 8 }}
            animate={{ height: 'auto', opacity: 1, y: 0 }}
            exit={{ height: 0, opacity: 0, y: 8 }}
            transition={{ duration: 0.22 }}
            className="overflow-hidden"
          >
            <div className="border-b border-white/[0.07] bg-white/[0.025]">
              <button
                type="button"
                data-testid="daily-limits-collapse-top"
                onClick={() => setExpanded(false)}
                className="flex h-8 w-full items-center justify-between gap-3 border-b border-white/[0.055] px-3 text-left transition-colors hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_10px_rgba(103,232,249,0.65)]" />
                  <span className="truncate text-[9px] font-black uppercase tracking-[0.12em] text-white/78">
                    Daily Limits
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-mono text-[8px] font-bold text-violet-200/75">
                    pool left {fmt(nonGameRemaining)}
                  </span>
                  <ChevronDown size={15} className="text-white/42" />
                </span>
              </button>
              <div className="px-3 pt-1.5">
                {renderSummaryCard('Game rewards', 'all game modes', gameRow, colorMap['Game rewards'])}
                <div className="my-0.5 border-t border-white/[0.06]" />
                {renderSummaryCard('Non-game pool', 'shared daily cap', nonGameRow, colorMap['Non-game pool'])}
              </div>
              <div className="px-3 pb-1.5">{subRows.map((r) => renderSourceRow(r))}</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {!expanded && (
        <button
          type="button"
          aria-expanded={expanded}
          data-testid="daily-limits-toggle"
          onClick={() => setExpanded(true)}
          className="flex min-h-10 w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-white/[0.055] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40"
        >
          <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_10px_rgba(103,232,249,0.65)]" />
              <span className="truncate text-[9px] font-black uppercase tracking-[0.12em] text-white/78">
                Daily Limits
              </span>
            </span>
            <span className="flex min-w-0 shrink-0 flex-wrap justify-end gap-x-2.5 gap-y-0.5">
              {renderCompactPill('Games', gameRow)}
              {renderCompactPill('Pool', nonGameRow)}
            </span>
          </span>
          <ChevronDown size={16} className="shrink-0 rotate-180 text-white/35 transition-transform duration-200" />
        </button>
      )}
    </motion.div>
  );
}
