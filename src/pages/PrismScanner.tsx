/**
 * Prism Scanner — Wallet search, card preview, auto-compare.
 * Extracted from NebulaMarket.tsx ExploreTab.
 */

import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  ArrowLeft, Search, Loader2, Swords, ChevronRight,
  Shield, Wallet, Hash, Layers, Image, Calendar, Activity,
  ExternalLink, Network,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import PageShell from '@/components/PageShell';
import { goBack } from '@/lib/safeNavigate';
import { useWalletData, calculateScore } from '@/hooks/useWalletData';
import {
  fetchWalletPreview,
  buildCompareRows,
  MiniPlanet,
  BattleBar,
  StatPill,
  TIER_COLORS_HEX,
  TIER_LABELS,
  TRUST_GRADE_COLORS,
  formatWalletAge,
  type WalletPreview,
} from '@/components/prism/shared';

export default function PrismScanner() {
  const navigate = useNavigate();
  const { publicKey } = useWallet();
  const myAddress = publicKey?.toBase58() || '';

  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<WalletPreview | null>(null);
  const [error, setError] = useState('');
  const [showNetwork, setShowNetwork] = useState(false);

  const myData = useWalletData(myAddress || undefined);
  const scannedData = useWalletData(result?.address || undefined);

  const handleSearch = useCallback(async () => {
    const addr = query.trim();
    if (!addr || addr.length < 32) {
      setError('Enter a valid Solana wallet address');
      return;
    }
    setLoading(true);
    setError('');
    setResult(null);
    setShowNetwork(false);

    const data = await fetchWalletPreview(addr);
    setLoading(false);
    if (!data) {
      setError('Could not load wallet data');
      return;
    }
    setResult(data);

    if (myAddress) {
      import('@/lib/prismQuests').then(({ getQuestState, incrementQuest }) => {
        const qs = getQuestState(myAddress);
        incrementQuest(qs, 'daily_explore');
      }).catch(() => {});
    }
  }, [query, myAddress]);

  // Composite score logic: use composite if available, else identity
  const displayScore = result
    ? (result.compositeScore > 0 ? result.compositeScore : result.score)
    : 0;
  const maxScore = result
    ? (result.compositeScore > 0 ? 1000 : 1400)
    : 1400;
  const displayTier = result
    ? (result.compositeScore > 0 && result.compositeTier ? result.compositeTier : result.tier)
    : '';

  const tierColor = displayTier ? (TIER_COLORS_HEX[displayTier] ?? '#888') : '#888';
  const gradeStyle = result?.trustGrade ? (TRUST_GRADE_COLORS[result.trustGrade] ?? TRUST_GRADE_COLORS['C']) : null;

  return (
    <PageShell>
      {/* Header */}
      <div className="sticky top-0 z-20 backdrop-blur-xl bg-[#050510]/80 border-b border-white/[0.06]">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <button
            onClick={() => goBack(navigate)}
            className="flex items-center gap-2 text-white/50 hover:text-white transition-colors text-sm min-h-[44px]"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <h1 className="text-sm font-bold bg-gradient-to-r from-cyan-500 to-sky-400 bg-clip-text text-transparent">
            PRISM SCANNER
          </h1>
          <div className="w-16" />
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
        {/* Search bar */}
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Enter any Solana wallet address..."
              className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-white/20 focus:outline-none focus:border-cyan-500/50"
            />
          </div>
          <Button
            onClick={handleSearch}
            disabled={loading}
            className="bg-cyan-500 hover:bg-cyan-400 text-black font-bold px-6"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Scan'}
          </Button>
        </div>

        {error && <p className="text-red-400 text-sm text-center">{error}</p>}

        {/* Scan Result */}
        {result && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">

            {/* Card Preview */}
            <div className="glass-card overflow-hidden" style={{ borderColor: `${tierColor}20` }}>
              <div className="p-5">
                <div className="flex items-center gap-4">
                  {/* Score ring — uses composite */}
                  <div className="relative flex-shrink-0">
                    <svg width="72" height="72" viewBox="0 0 72 72">
                      <circle cx="36" cy="36" r="30" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="4" />
                      <circle
                        cx="36" cy="36" r="30"
                        fill="none"
                        stroke={tierColor}
                        strokeWidth="4"
                        strokeLinecap="round"
                        strokeDasharray={`${(Math.min(displayScore / maxScore, 1)) * 2 * Math.PI * 30} ${2 * Math.PI * 30}`}
                        transform="rotate(-90 36 36)"
                        style={{ filter: `drop-shadow(0 0 6px ${tierColor}80)` }}
                      />
                      <text x="36" y="33" textAnchor="middle" fill={tierColor} fontSize="16" fontWeight="bold" fontFamily="monospace">
                        {displayScore}
                      </text>
                      <text x="36" y="44" textAnchor="middle" fill="rgba(255,255,255,0.2)" fontSize="8">
                        / {maxScore}
                      </text>
                    </svg>
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-white/40 text-xs font-mono truncate mb-0.5">
                      {result.address.slice(0, 6)}...{result.address.slice(-4)}
                    </p>
                    <p className="font-bold text-lg" style={{ color: tierColor }}>
                      {TIER_LABELS[displayTier] ?? displayTier.toUpperCase()}
                    </p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {gradeStyle && (
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold border ${gradeStyle.bg} ${gradeStyle.border} ${gradeStyle.text}`}>
                          <Shield className="w-3 h-3" />
                          Trust {result.trustGrade}
                        </span>
                      )}
                      {result.badges.length > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold text-amber-400 border border-amber-400/20 bg-amber-400/10">
                          {result.badges.length} badges
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Stats pills */}
                <div className="flex flex-wrap gap-2 mt-4">
                  <StatPill icon={<Wallet className="w-3 h-3" />} label="SOL" value={result.solBalance.toFixed(2)} color="text-yellow-400" />
                  <StatPill icon={<Layers className="w-3 h-3" />} label="Tokens" value={String(result.tokenCount)} color="text-blue-400" />
                  <StatPill icon={<Image className="w-3 h-3" />} label="NFTs" value={String(result.nftCount)} color="text-purple-400" />
                  <StatPill icon={<Hash className="w-3 h-3" />} label="Txns" value={result.txCount.toLocaleString()} color="text-cyan-400" />
                  <StatPill icon={<Calendar className="w-3 h-3" />} label="Age" value={formatWalletAge(result.walletAgeDays)} color="text-green-400" />
                  <StatPill icon={<Activity className="w-3 h-3" />} label="Tx/Day" value={result.walletAgeDays > 0 ? (result.txCount / result.walletAgeDays).toFixed(1) : '—'} color="text-orange-400" />
                </div>
              </div>

              <button
                onClick={() => navigate(`/?address=${result.address}`)}
                className="w-full flex items-center justify-center gap-2 py-3 border-t border-white/[0.06] text-sm font-bold transition-all hover:bg-white/[0.03]"
                style={{ color: tierColor }}
              >
                <ExternalLink className="w-4 h-4" />
                View Full Identity Card
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {/* Auto-Compare */}
            {myAddress && result.address !== myAddress && myData.traits && scannedData.traits && (
              <div className="glass-card p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-bold text-white/50 uppercase tracking-wider flex items-center gap-1.5">
                    <Swords className="w-3.5 h-3.5 text-white/30" />
                    You vs Scanned
                  </h3>
                  <div className="flex items-center gap-3 text-[10px]">
                    <span className="text-cyan-400 font-bold">You</span>
                    <span className="text-purple-400 font-bold">Them</span>
                  </div>
                </div>

                <div className="flex items-center justify-between mb-4">
                  <div className="text-center">
                    <MiniPlanet tier={myData.traits.planetTier} size={28} />
                    <p className="text-lg font-black text-white mt-1 tabular-nums">{calculateScore(myData.traits)}</p>
                  </div>
                  <div className="text-center px-3">
                    <span className="text-xs text-white/20 font-bold">VS</span>
                  </div>
                  <div className="text-center">
                    <MiniPlanet tier={displayTier} size={28} />
                    <p className="text-lg font-black text-white mt-1 tabular-nums">{displayScore}</p>
                  </div>
                </div>

                <div className="space-y-2.5">
                  {buildCompareRows(myData.traits, scannedData.traits).map(row => (
                    <BattleBar
                      key={row.label}
                      label={row.label}
                      valA={row.numA}
                      valB={row.numB}
                      displayA={String(row.valueA)}
                      displayB={String(row.valueB)}
                    />
                  ))}
                </div>

                <button
                  onClick={() => navigate(`/compare?a=${myAddress}&b=${result.address}`)}
                  className="w-full mt-3 py-2 text-xs font-bold text-white/30 hover:text-white/60 transition-colors flex items-center justify-center gap-1"
                >
                  Full Compare View
                  <ChevronRight className="w-3 h-3" />
                </button>
              </div>
            )}

            {/* Network Toggle */}
            <button
              onClick={() => setShowNetwork(!showNetwork)}
              className="w-full glass-card py-3 px-4 flex items-center justify-center gap-2 text-sm font-bold text-emerald-400 hover:bg-white/[0.06] transition-colors"
            >
              <Network className="w-4 h-4" />
              {showNetwork ? 'Hide Network' : 'View Network'}
            </button>

            {showNetwork && (
              <div className="glass-card overflow-hidden">
                <div className="h-[220px] sm:h-[280px] flex items-center justify-center text-white/20 text-sm">
                  <div className="text-center">
                    <Network className="w-10 h-10 mx-auto mb-2 opacity-30" />
                    <p>Wallet connections preview</p>
                    <button
                      onClick={() => navigate(`/constellation?address=${result.address}`)}
                      className="mt-3 inline-flex items-center gap-1 text-emerald-400 text-xs font-bold hover:text-emerald-300 transition-colors"
                    >
                      Full Stellar Nexus View
                      <ChevronRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Empty state */}
        {!result && !loading && !error && (
          <div className="text-center py-16 text-white/20">
            <Search className="w-12 h-12 mx-auto mb-4 opacity-20" />
            <p className="text-sm">Search any Solana wallet to explore its identity</p>
            <p className="text-xs text-white/10 mt-1">Score, tier, trust grade, NFTs, protocols & more</p>
          </div>
        )}
      </div>
    </PageShell>
  );
}
