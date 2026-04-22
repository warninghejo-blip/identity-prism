/**
 * CosmicHub V3 — Premium Web3 Spatial Hub.
 * 3D rotating glass prism background + Glassmorphism Bento Box navigation grid.
 * Mini Identity Passport replaces the old "My Card" button.
 */
import { useCallback, useRef, useEffect, useState, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useWallet } from '@solana/wallet-adapter-react';
import { CosmicStarfield } from '@/components/CosmicStarfield';
import { trackInternalNavigation } from '@/lib/safeNavigate';
import { startFadeTransition } from '@/lib/fadeTransition';
import { getHeliusProxyUrl } from '@/constants';
import { getTierIcon } from '@/lib/constants/tierColors';
import { toast } from 'sonner';
import { useCompositeScore } from '@/hooks/useCompositeScore';
import { getBoostedCompositeScore } from '@/lib/shipStats';
import { fetchSybilAnalysis } from '@/components/prism/shared';
import type { PlanetTier } from '@/hooks/useWalletData';
import {
  Trophy,
  Flame,
  Store,
  Swords,
  Medal,
  ScrollText,
  ArrowRight,
  Shield,
  Eye,
  Search,
  Zap,
  LogOut,
  Bell,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useRangerProgress } from '@/hooks/useRangerProgress';

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

const SYBIL_GRADE_COLORS: Record<string, string> = {
  'A+': '#22c55e',
  A: '#22c55e',
  'A-': '#4ade80',
  'B+': '#86efac',
  B: '#facc15',
  'B-': '#fbbf24',
  'C+': '#fb923c',
  C: '#f97316',
  'C-': '#ef4444',
  D: '#ef4444',
  F: '#dc2626',
  'N/A': '#64748b',
};

/* ── Props ── */
export interface CosmicHubProps {
  walletAddress: string;
  prismBalance?: { balance: number } | null;
  onNavigateToCard: () => void;
  onDisconnect?: () => void;
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
  desc,
  icon,
  iconName,
  colorClass,
  delay,
  onClick,
}: {
  label: string;
  desc: string;
  icon: ReactNode;
  iconName: string;
  colorClass: string;
  delay: number;
  onClick: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25, delay }}
      onClick={onClick}
      className="group flex flex-col items-center gap-1.5 cursor-pointer pointer-events-auto active:scale-90 transition-transform overflow-visible"
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
    </motion.div>
  );
}

/* ── Truncate address ── */
function truncAddr(a: string) {
  return a.length > 8 ? `${a.slice(0, 4)}...${a.slice(-4)}` : a;
}

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
  const gradeColor = SYBIL_GRADE_COLORS[sybilGrade ?? 'N/A'] ?? '#64748b';
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
                <div className="flex items-center gap-0.5">
                  <Shield size={8} style={{ color: gradeColor, opacity: 0.6 }} />
                  <span className="text-[8px] font-bold" style={{ color: gradeColor, opacity: 0.7 }}>
                    {sybilGrade ?? '...'}
                  </span>
                </div>
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
                { key: 'onchain', label: 'On-Chain', color: '#22d3ee', max: 400 },
                { key: 'sybilTrust', label: 'Trust', color: '#a78bfa', max: 250 },
                { key: 'humanProof', label: 'Human', color: '#34d399', max: 150 },
                { key: 'social', label: 'Social', color: '#fb923c', max: 100 },
                { key: 'engagement', label: 'Activity', color: '#f472b6', max: 100 },
              ] as const
            ).map(({ key, label, color, max }) => {
              const val = breakdown[key] ?? 0;
              const pctBar = Math.min(val / max, 1) * 100;
              return (
                <div key={key} className="flex flex-col items-center gap-0.5">
                  <div className="w-full h-1 rounded-full overflow-hidden" style={{ background: `${color}10` }}>
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${pctBar}%`, background: `linear-gradient(90deg, ${color}60, ${color})` }}
                    />
                  </div>
                  <span className="text-[6px] font-bold uppercase tracking-wide" style={{ color: `${color}80` }}>
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
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl"
            style={{ background: `${gradeColor}10`, border: `1px solid ${gradeColor}20` }}
          >
            <Shield size={11} style={{ color: gradeColor }} />
            <span className="text-[11px] font-black" style={{ color: gradeColor }}>
              {sybilGrade ?? '...'}
            </span>
          </div>
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
  const fallbackPassportBreakdown = useMemo(
    () =>
      fallbackIdentityScore > 0
        ? {
            onchain: Math.min(Math.round(fallbackIdentityScore), 400),
            sybilTrust: 0,
            humanProof: 0,
            social: 0,
            engagement: 0,
          }
        : null,
    [fallbackIdentityScore],
  );
  const passportScore = hasCompositePassport ? boostedComposite.score : fallbackIdentityScore;
  const passportTier = hasCompositePassport ? compositeData.tier : (planetTier ?? 'mercury');
  const passportBreakdown = hasCompositePassport ? boostedComposite.breakdown : fallbackPassportBreakdown;
  const passportMaxScore = hasCompositePassport ? 1000 : 400;

  // Poll unread notification count
  useEffect(() => {
    if (!walletAddress) return;
    const base = getHeliusProxyUrl() || '';
    const fetchCount = () => {
      fetch(`${base}/api/notifications/unread-count?address=${walletAddress}`)
        .then((r) => r.json())
        .then((d) => setUnreadCount(d.count || 0))
        .catch(() => {});
    };
    fetchCount();
    const interval = setInterval(fetchCount, 60000);
    return () => clearInterval(interval);
  }, [walletAddress]);

  // Fetch sybil grade (shared deduped — same promise as CelestialCard)
  useEffect(() => {
    if (!walletAddress) return;
    let cancelled = false;
    fetchSybilAnalysis(walletAddress).then((d) => {
      if (!cancelled && d?.trustGrade) {
        setSybilGrade(d.trustGrade);
        setTimeout(() => refetchComposite(), 500);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [walletAddress, refetchComposite]);

  // Fetch staking boost rate
  useEffect(() => {
    if (!walletAddress) return;
    const base = getHeliusProxyUrl() || (typeof window !== 'undefined' ? window.location.origin : '');
    fetch(`${base}/api/prism/vault/status?address=${walletAddress}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (typeof d?.boostRate === 'number' && d.boostRate > 0) setBoostRate(d.boostRate);
      })
      .catch(() => {});
  }, [walletAddress]);

  // JWT pre-warm moved to Index.tsx — fires at wallet connect time
  const wallet = useWallet();

  const goTo = useCallback(
    (route: string) => {
      trackInternalNavigation();
      startFadeTransition(() => navigate(route));
    },
    [navigate],
  );

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
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[9px] lg:text-[10px] text-white/40 font-medium tracking-wide">ONLINE</span>
            <Link to="/inbox" className="relative p-2 flex items-center justify-center">
              <Bell className="w-5 h-5 text-white/40 hover:text-white/60 transition-colors" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-red-500 text-[9px] font-bold text-white flex items-center justify-center">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </Link>
            {onDisconnect && (
              <button
                onClick={onDisconnect}
                className="ml-1 p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl bg-white/[0.06] hover:bg-red-500/20 border border-white/[0.08] hover:border-red-500/30 transition-colors group focus-visible:ring-2 focus-visible:ring-cyan-400/50 focus-visible:outline-none"
                title="Disconnect wallet"
                aria-label="Disconnect wallet"
              >
                <LogOut className="w-3.5 h-3.5 text-white/40 group-hover:text-red-400 transition-colors" />
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
        <div className="flex-1 w-full max-w-5xl mx-auto px-4 lg:px-5 pt-2 pb-6 lg:pb-8 flex flex-col lg:flex-row gap-2 lg:gap-6 items-start lg:justify-center">
          {/* Passport — top on mobile, left sidebar on desktop */}
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: 0.05 }}
            className="w-full lg:w-72 flex-shrink-0"
          >
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
                  startFadeTransition(() => navigate('/vault'));
                }}
                boostRate={boostRate}
                breakdown={passportBreakdown}
              />
            ) : (
              <NoCardFallback onClick={onNavigateToCard} />
            )}
          </motion.div>

          {/* Navigation Grid — 4 cols icon grid, tight */}
          <div className="w-full lg:flex-1 grid grid-cols-4 gap-y-3 gap-x-0">
            {MODULES.map((m, i) => (
              <NavCard
                key={m.id}
                label={m.label}
                desc={m.desc}
                icon={m.icon}
                iconName={m.iconName}
                colorClass={m.colorClass}
                delay={0.1 + i * 0.03}
                onClick={() => goTo(m.route)}
              />
            ))}
          </div>
        </div>

        {/* Daily Limits Table */}
        {walletAddress && <DailyLimitsTable address={walletAddress} />}

        {/* Daily Earnings Progress */}
        {walletAddress && <DailyEarnings address={walletAddress} />}
      </div>
    </motion.div>
  );
}

/* ── Daily Limits Table ── */
function DailyLimitsTable({ address }: { address: string }) {
  const [data, setData] = useState<{
    game: { earned: number; cap: number };
    hunt: { earned: number; cap: number };
    scan: { earned: number; cap: number };
    quiz: { earned: number; cap: number };
    nonGame: { earned: number; cap: number };
  } | null>(null);

  useEffect(() => {
    const base = getHeliusProxyUrl() || '';
    if (!base || !address) return;
    fetch(`${base}/api/daily-limits?address=${encodeURIComponent(address)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setData(d);
      })
      .catch(() => {});
  }, [address]);

  const fmt = (n: number | null | undefined) => (n != null ? n.toLocaleString() : '—');

  // Static caps as fallback
  const game = data?.game ?? { earned: 0, cap: 2000 };
  const scan = data?.scan ?? { earned: 0, cap: 100 };
  const hunt = data?.hunt ?? { earned: 0, cap: 500 };
  const quiz = data?.quiz ?? { earned: 0, cap: 500 };
  const nonGame = data?.nonGame ?? { earned: 0, cap: 1500 };

  // Black Hole cap is not tracked by the endpoint — static
  const bhCap = 500;

  const gameRow = { label: 'Games', earned: game.earned, cap: game.cap };
  const nonGameRow = { label: 'Non-game total', earned: nonGame.earned, cap: nonGame.cap };
  const subRows: { label: string; earned: number; cap: number }[] = [
    { label: 'Scans', earned: scan.earned, cap: scan.cap },
    { label: 'Sybil Hunt', earned: hunt.earned, cap: hunt.cap },
    { label: 'Quiz', earned: quiz.earned, cap: quiz.cap },
    { label: 'Black Hole', earned: 0, cap: bhCap },
  ];

  const renderRow = (r: { label: string; earned: number; cap: number }, variant: 'main' | 'header' | 'sub') => {
    const atLimit = r.earned >= r.cap && r.cap > 0;
    const nearLimit = !atLimit && r.cap > 0 && r.earned / r.cap >= 0.8;
    const earnColor = atLimit ? 'text-red-400' : nearLimit ? 'text-amber-400' : 'text-white';
    const labelClass =
      variant === 'header' ? 'text-white/80 font-semibold' : variant === 'sub' ? 'text-white/55 pl-3' : 'text-white/70';
    return (
      <div key={r.label} className="flex justify-between items-center text-[10px]">
        <span className={labelClass}>{r.label}</span>
        <span className="font-mono">
          <span className={earnColor}>{fmt(r.earned)}</span>
          <span className="text-white/40"> / {fmt(r.cap)}</span>
        </span>
      </div>
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: 0.35 }}
      className="bg-white/[0.02] rounded-xl p-3 mx-4 mt-3 mb-2 pointer-events-auto"
    >
      <p className="text-[10px] font-bold text-white/50 mb-2 uppercase tracking-[0.12em]">Daily Limits</p>
      <div className="space-y-0.5">
        {renderRow(gameRow, 'header')}
        <div className="mt-1.5 pt-1.5 border-t border-white/[0.08]" />
        {renderRow(nonGameRow, 'header')}
        {subRows.map((r) => renderRow(r, 'sub'))}
      </div>
    </motion.div>
  );
}

/* ── Daily Earnings Widget ── */
function DailyEarnings({ address }: { address: string }) {
  const [data, setData] = useState<{
    game: { earned: number; cap: number };
    hunt: { earned: number; cap: number };
    scan: { earned: number; cap: number };
    quiz: { earned: number; cap: number };
    nonGame: { earned: number; cap: number };
  } | null>(null);

  useEffect(() => {
    const base = getHeliusProxyUrl() || '';
    if (!base || !address) return;
    fetch(`${base}/api/daily-limits?address=${encodeURIComponent(address)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setData(d);
      })
      .catch(() => {});
  }, [address]);

  if (!data) return null;
  const totalEarned = data.game.earned + data.nonGame.earned;
  if (totalEarned === 0) return null;

  const huntTotal = data.hunt.earned + data.scan.earned;
  const huntCap = data.hunt.cap; // scan is part of hunt activity
  const otherEarned = Math.max(0, data.nonGame.earned - huntTotal - data.quiz.earned);
  const bars = [
    { label: 'Games', earned: data.game.earned, cap: data.game.cap, color: '#22d3ee' },
    { label: 'Sybil Hunt', earned: huntTotal, cap: huntCap, color: '#f87171' },
    { label: 'Quiz', earned: data.quiz.earned, cap: data.quiz.cap, color: '#a78bfa' },
    { label: 'Other', earned: otherEarned, cap: data.nonGame.cap - huntCap - data.quiz.cap, color: '#34d399' },
  ].filter((b) => b.earned > 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.5 }}
      className="w-full max-w-xs mx-auto rounded-2xl p-3.5 pointer-events-auto mb-3"
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-[10px] font-bold uppercase tracking-widest text-white/50">Today's Earnings</span>
        <span className="text-[11px] font-black text-amber-300">
          {totalEarned} <span className="text-[9px] text-white/50 font-normal">coins today</span>
        </span>
      </div>
      <div className="space-y-2">
        {bars.map((b) => {
          const pct = b.cap > 0 ? Math.min(100, (b.earned / b.cap) * 100) : 0;
          return (
            <div key={b.label} className="flex items-center gap-2.5">
              <span className="text-[9px] font-bold w-11 text-right" style={{ color: b.color }}>
                {b.label}
              </span>
              <div className="flex-1 h-[6px] rounded-full overflow-hidden bg-white/[0.06]">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${b.color}60, ${b.color})` }}
                />
              </div>
              <span className="text-[9px] w-16 font-mono text-right">
                <span className="text-white/50 font-bold">{b.earned}</span>
                <span className="text-white/50">/{b.cap}</span>
              </span>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
