/**
 * CosmicHub V3 — Flat grid menu (pure CSS + Framer Motion).
 * Replaces V2's 3D orbital hub with a clean, fast 2-column/3-column grid.
 */
import { useCallback } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
// Coins balance type (unified economy — no separate PRISM)
interface CoinBalanceInfo { balance: number; }
import { trackInternalNavigation } from '@/lib/safeNavigate';

/* ── Props (same as V2) ── */
export interface CosmicHubProps {
  walletAddress: string;
  prismBalance?: CoinBalanceInfo | null;
  onNavigateToCard: () => void;
}

/* ── Module definitions ── */
interface ModuleDef {
  id: string; label: string; route: string; color: string;
  desc: string; icon: ReactNode;
}

const ico = (d: string, stroke = 'currentColor') => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{
    d.split('|').map((p, i) => <path key={i} d={p} />)
  }</svg>
);

const MODULES: ModuleDef[] = [
  { id: 'league', label: 'Prism League', route: '/game', color: '#06b6d4',
    desc: 'Compete in arcade games',
    icon: ico('M12 2L8 10H3L7 14L5 22L12 17L19 22L17 14L21 10H16L12 2') },
  { id: 'blackhole', label: 'Black Hole', route: '/blackhole', color: '#a855f7',
    desc: 'Destroy your identity',
    icon: ico('M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0|M12 12m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0|M12 2C6.5 2 2 6.5 2 12|M22 12c0 5.5-4.5 10-10 10') },
  { id: 'shop', label: 'Coin Shop', route: '/forge', color: '#f59e0b',
    desc: 'Customize your card',
    icon: ico('M12 2L2 9L12 16L22 9L12 2|M2 15L12 22L22 15|M2 12L12 19L22 12') },
  { id: 'constellation', label: 'Stellar Nexus', route: '/constellation', color: '#10b981',
    desc: 'Explore wallet connections',
    icon: ico('M5 5L12 3L19 5|M5 5L3 12L5 19|M19 5L21 12L19 19|M5 19L12 21L19 19|M5 5L19 19|M19 5L5 19|M12 3L12 21') },
  { id: 'market', label: 'Prism Arena', route: '/market', color: '#ec4899',
    desc: 'Battle & explore wallets',
    icon: ico('M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20|M2 12h20|M12 2a15 15 0 0 1 0 20|M12 2a15 15 0 0 0 0 20') },
  { id: 'leaderboard', label: 'Leaderboard', route: '/leaderboard', color: '#eab308',
    desc: 'Top identity scores',
    icon: ico('M6 9H2v12h4V9|M14 4h-4v17h4V4|M22 13h-4v8h4v-8') },
  { id: 'quests', label: 'Quests', route: '/quests', color: '#8b5cf6',
    desc: 'Daily missions & rewards',
    icon: ico('M4 4h16v16H4V4|M4 9h16|M4 14h16|M9 4v16') },
];

/* ── Framer Motion variants ── */
const containerV = { hidden: {}, visible: { transition: { staggerChildren: 0.06 } } };
const itemV = { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' } } };

/* ── Truncate address ── */
function truncAddr(a: string) {
  return a.length > 8 ? `${a.slice(0, 4)}...${a.slice(-4)}` : a;
}

/* ── Component ── */
export default function CosmicHub({ walletAddress, prismBalance, onNavigateToCard }: CosmicHubProps) {
  const navigate = useNavigate();

  const goTo = useCallback((route: string) => {
    trackInternalNavigation();
    navigate(route);
  }, [navigate]);

  return (
    <div className="fixed inset-0 overflow-y-auto"
      style={{ background: 'radial-gradient(ellipse at 50% 0%, #0c1222 0%, #050510 50%), radial-gradient(ellipse at 80% 80%, #0a0a1a 0%, #050510 70%)' }}
    >
      <div className="mx-auto max-w-xl px-4 pb-10 pt-8 flex flex-col gap-6">

        {/* ── Top bar: address + Coins ── */}
        <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
          className="flex items-center justify-between"
        >
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] border border-white/[0.08] px-3 py-1.5 text-xs font-mono text-white/60 select-all">
            {truncAddr(walletAddress)}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] border border-white/[0.08] px-3 py-1.5 text-xs font-bold text-amber-400">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/><path d="M12 6v12M8 10h8M8 14h8" stroke="#000" strokeWidth="1.5"/></svg>
            {prismBalance?.balance ?? 0} Coins
          </span>
        </motion.div>

        {/* ── MY CARD button ── */}
        <motion.button
          initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.4, delay: 0.1 }}
          whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
          onClick={onNavigateToCard}
          className="w-full rounded-2xl py-5 text-center font-bold text-lg tracking-wide text-white border border-cyan-500/20 cursor-pointer"
          style={{ background: 'linear-gradient(135deg, rgba(6,182,212,0.12) 0%, rgba(168,85,247,0.10) 100%)' }}
        >
          MY CARD
        </motion.button>

        {/* ── Module grid ── */}
        <motion.div
          variants={containerV} initial="hidden" animate="visible"
          className="grid grid-cols-2 sm:grid-cols-3 gap-3"
        >
          {MODULES.map((m) => (
            <motion.button
              key={m.id} variants={itemV}
              whileHover={{ scale: 1.02, borderColor: m.color }}
              whileTap={{ scale: 0.97 }}
              onClick={() => goTo(m.route)}
              className="flex flex-col items-start gap-2 rounded-2xl p-4 text-left cursor-pointer bg-white/[0.03] border transition-colors duration-200"
              style={{ borderColor: 'rgba(255,255,255,0.06)' }}
            >
              <span style={{ color: m.color }}>{m.icon}</span>
              <span className="text-sm font-semibold text-white/90">{m.label}</span>
              <span className="text-[11px] leading-tight text-white/40">{m.desc}</span>
            </motion.button>
          ))}
        </motion.div>
      </div>
    </div>
  );
}

