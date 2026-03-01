import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useWalletData, calculateScore, type WalletTraits } from "@/hooks/useWalletData";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Wallet, Search, Trophy, ArrowUpDown, Loader2 } from "lucide-react";

const TIER_LABELS: Record<string, string> = {
  mercury: "MERCURY", mars: "MARS", venus: "VENUS", earth: "EARTH",
  neptune: "NEPTUNE", uranus: "URANUS", saturn: "SATURN", jupiter: "JUPITER",
  sun: "SUN", binary_sun: "BINARY SUN",
};

const TIER_COLORS: Record<string, string> = {
  mercury: "text-stone-300", mars: "text-orange-400", venus: "text-yellow-300",
  earth: "text-blue-400", neptune: "text-cyan-400", uranus: "text-sky-300",
  saturn: "text-amber-300", jupiter: "text-orange-300", sun: "text-yellow-400",
  binary_sun: "text-amber-400",
};

const TIER_BG: Record<string, string> = {
  mercury: "from-stone-500/10 to-stone-600/5", mars: "from-orange-500/10 to-red-600/5",
  venus: "from-yellow-500/10 to-amber-600/5", earth: "from-blue-500/10 to-green-600/5",
  neptune: "from-cyan-500/10 to-blue-600/5", uranus: "from-sky-500/10 to-cyan-600/5",
  saturn: "from-amber-500/10 to-yellow-600/5", jupiter: "from-orange-500/10 to-amber-600/5",
  sun: "from-yellow-500/10 to-orange-600/5", binary_sun: "from-amber-400/10 to-yellow-500/5",
};

interface CompareRow {
  label: string;
  valueA: string | number;
  valueB: string | number;
  numA: number;
  numB: number;
  higherIsBetter: boolean;
}

function buildCompareRows(a: WalletTraits, b: WalletTraits): CompareRow[] {
  return [
    { label: "SOL Balance", valueA: a.solBalance.toFixed(2), valueB: b.solBalance.toFixed(2), numA: a.solBalance, numB: b.solBalance, higherIsBetter: true },
    { label: "Wallet Age", valueA: `${a.walletAgeDays}d`, valueB: `${b.walletAgeDays}d`, numA: a.walletAgeDays, numB: b.walletAgeDays, higherIsBetter: true },
    { label: "Transactions", valueA: a.txCount.toLocaleString(), valueB: b.txCount.toLocaleString(), numA: a.txCount, numB: b.txCount, higherIsBetter: true },
    { label: "NFTs", valueA: a.nftCount, valueB: b.nftCount, numA: a.nftCount, numB: b.nftCount, higherIsBetter: true },
    { label: "Tokens", valueA: a.uniqueTokenCount, valueB: b.uniqueTokenCount, numA: a.uniqueTokenCount, numB: b.uniqueTokenCount, higherIsBetter: true },
    { label: "Total Assets", valueA: a.totalAssetsCount, valueB: b.totalAssetsCount, numA: a.totalAssetsCount, numB: b.totalAssetsCount, higherIsBetter: true },
    { label: "Avg Tx/Day", valueA: a.avgTxPerDay30d.toFixed(1), valueB: b.avgTxPerDay30d.toFixed(1), numA: a.avgTxPerDay30d, numB: b.avgTxPerDay30d, higherIsBetter: true },
  ];
}

function getBadgeCount(traits: WalletTraits): number {
  let count = 0;
  if (traits.isOG) count++;
  if (traits.isWhale) count++;
  if (traits.isCollector) count++;
  if (traits.hasCombo) count++;
  if (traits.isEarlyAdopter) count++;
  if (traits.isTxTitan) count++;
  if (traits.isSolanaMaxi) count++;
  if (traits.hasSeeker) count++;
  if (traits.hasPreorder) count++;
  if (traits.isBlueChip) count++;
  if (traits.isDeFiKing) count++;
  if (traits.isMemeLord) count++;
  if (traits.hyperactiveDegen) count++;
  if (traits.diamondHands) count++;
  return count;
}

function formatAddr(addr: string) {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

function WinIndicator({ isWinner }: { isWinner: boolean }) {
  if (!isWinner) return null;
  return <span className="ml-1 text-green-400 text-[10px] font-bold">▲</span>;
}

export default function Compare() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const wallet = useWallet();
  const { setVisible: setWalletModalVisible } = useWalletModal();

  const paramA = searchParams.get("a") || "";
  const paramB = searchParams.get("b") || "";

  const [inputA, setInputA] = useState(paramA || wallet.publicKey?.toBase58() || "");
  const [inputB, setInputB] = useState(paramB);
  const [addrA, setAddrA] = useState(paramA || wallet.publicKey?.toBase58() || "");
  const [addrB, setAddrB] = useState(paramB);

  // Sync wallet connection to input A if empty
  useEffect(() => {
    if (wallet.publicKey && !addrA) {
      const addr = wallet.publicKey.toBase58();
      setInputA(addr);
      setAddrA(addr);
    }
  }, [wallet.publicKey]);

  const dataA = useWalletData(addrA || undefined);
  const dataB = useWalletData(addrB || undefined);

  const handleCompare = useCallback(() => {
    const a = inputA.trim();
    const b = inputB.trim();
    if (!a || !b) return;
    setAddrA(a);
    setAddrB(b);
    setSearchParams({ a, b });
  }, [inputA, inputB, setSearchParams]);

  const handleSwap = useCallback(() => {
    setInputA(inputB);
    setInputB(inputA);
    setAddrA(inputB);
    setAddrB(inputA);
    if (inputA && inputB) setSearchParams({ a: inputB, b: inputA });
  }, [inputA, inputB, setSearchParams]);

  const scoreA = dataA.traits ? calculateScore(dataA.traits) : 0;
  const scoreB = dataB.traits ? calculateScore(dataB.traits) : 0;
  const tierA = dataA.traits?.planetTier || "mercury";
  const tierB = dataB.traits?.planetTier || "mercury";

  const rows = useMemo(() => {
    if (!dataA.traits || !dataB.traits) return [];
    return buildCompareRows(dataA.traits, dataB.traits);
  }, [dataA.traits, dataB.traits]);

  const badgesA = dataA.traits ? getBadgeCount(dataA.traits) : 0;
  const badgesB = dataB.traits ? getBadgeCount(dataB.traits) : 0;

  const bothLoaded = dataA.traits && dataB.traits && !dataA.isLoading && !dataB.isLoading;
  const isLoading = (addrA && dataA.isLoading) || (addrB && dataB.isLoading);

  return (
    <div className="h-screen flex flex-col bg-[#05070a] text-white">
      {/* Header */}
      <header className="flex-none sticky top-0 z-20 bg-black/80 backdrop-blur-xl border-b border-white/[0.06]">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => navigate("/app")} className="text-white/50 hover:text-white transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-lg font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-400">
            Compare Wallets
          </h1>
          <div className="flex-1" />
          {!wallet.connected && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs bg-cyan-950/50 border-cyan-800/60 text-cyan-400"
              onClick={() => setWalletModalVisible(true)}
            >
              <Wallet className="w-3 h-3 mr-1" /> Connect
            </Button>
          )}
        </div>
      </header>

      <main className="flex-1 overflow-y-auto max-w-3xl mx-auto w-full px-4 py-6 pb-24 space-y-6">
        {/* Input Section */}
        <div className="space-y-3">
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-[10px] uppercase tracking-widest text-cyan-400/60 font-bold mb-1 block">Wallet A</label>
              <input
                type="text"
                value={inputA}
                onChange={(e) => setInputA(e.target.value)}
                placeholder="Solana address..."
                className="w-full h-10 px-3 rounded-lg bg-white/[0.04] border border-white/[0.08] text-sm text-white/80 placeholder:text-white/20 focus:outline-none focus:border-cyan-500/40 font-mono"
              />
            </div>
            <button
              onClick={handleSwap}
              className="self-end h-10 w-10 flex items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06] transition-colors"
              title="Swap wallets"
            >
              <ArrowUpDown className="w-4 h-4 text-white/40" />
            </button>
            <div className="flex-1">
              <label className="text-[10px] uppercase tracking-widest text-purple-400/60 font-bold mb-1 block">Wallet B</label>
              <input
                type="text"
                value={inputB}
                onChange={(e) => setInputB(e.target.value)}
                placeholder="Solana address..."
                className="w-full h-10 px-3 rounded-lg bg-white/[0.04] border border-white/[0.08] text-sm text-white/80 placeholder:text-white/20 focus:outline-none focus:border-purple-500/40 font-mono"
              />
            </div>
          </div>
          <Button
            className="w-full h-11 bg-gradient-to-r from-cyan-500 to-purple-500 hover:from-cyan-400 hover:to-purple-400 text-black font-bold"
            onClick={handleCompare}
            disabled={!inputA.trim() || !inputB.trim() || isLoading}
          >
            {isLoading ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Scanning...</>
            ) : (
              <><Search className="w-4 h-4 mr-2" /> Compare</>
            )}
          </Button>
        </div>

        {/* Results */}
        {bothLoaded && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Score Cards */}
            <div className="grid grid-cols-2 gap-3">
              {/* Wallet A */}
              <div className={`rounded-xl border p-4 text-center bg-gradient-to-br ${TIER_BG[tierA]} ${scoreA >= scoreB ? "border-green-500/30" : "border-white/[0.06]"}`}>
                <div className="text-[10px] uppercase tracking-widest text-cyan-400/60 font-bold mb-1">Wallet A</div>
                <div className="font-mono text-xs text-white/50 mb-2">{formatAddr(addrA)}</div>
                <div className="text-4xl font-black tabular-nums text-white mb-1">{scoreA}</div>
                <div className={`text-sm font-bold uppercase tracking-wider ${TIER_COLORS[tierA]}`}>
                  {TIER_LABELS[tierA]}
                  {scoreA > scoreB && <span className="ml-1.5 text-green-400 text-[10px]">👑</span>}
                </div>
                <div className="text-[10px] text-white/30 mt-1">{badgesA} badges</div>
              </div>
              {/* Wallet B */}
              <div className={`rounded-xl border p-4 text-center bg-gradient-to-br ${TIER_BG[tierB]} ${scoreB >= scoreA ? "border-green-500/30" : "border-white/[0.06]"}`}>
                <div className="text-[10px] uppercase tracking-widest text-purple-400/60 font-bold mb-1">Wallet B</div>
                <div className="font-mono text-xs text-white/50 mb-2">{formatAddr(addrB)}</div>
                <div className="text-4xl font-black tabular-nums text-white mb-1">{scoreB}</div>
                <div className={`text-sm font-bold uppercase tracking-wider ${TIER_COLORS[tierB]}`}>
                  {TIER_LABELS[tierB]}
                  {scoreB > scoreA && <span className="ml-1.5 text-green-400 text-[10px]">👑</span>}
                </div>
                <div className="text-[10px] text-white/30 mt-1">{badgesB} badges</div>
              </div>
            </div>

            {/* Score Difference Banner */}
            {scoreA !== scoreB && (
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-2 flex items-center justify-center gap-2">
                <Trophy className="w-4 h-4 text-yellow-400" />
                <span className="text-sm text-white/60">
                  <span className="font-bold text-white/80">{formatAddr(scoreA > scoreB ? addrA : addrB)}</span>
                  {" "}wins by{" "}
                  <span className="font-bold text-green-400">+{Math.abs(scoreA - scoreB)}</span>
                  {" "}points
                </span>
              </div>
            )}

            {/* Detailed Comparison Table */}
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
              <div className="grid grid-cols-[1fr_80px_80px] px-4 py-2 border-b border-white/[0.05] text-[10px] uppercase tracking-wider font-bold">
                <span className="text-white/30">Metric</span>
                <span className="text-cyan-400/60 text-right">A</span>
                <span className="text-purple-400/60 text-right">B</span>
              </div>

              {/* Score row */}
              <div className="grid grid-cols-[1fr_80px_80px] px-4 py-2.5 border-b border-white/[0.03] bg-white/[0.01]">
                <span className="text-xs font-bold text-white/70">Score</span>
                <span className={`text-xs font-bold text-right tabular-nums ${scoreA >= scoreB ? "text-green-400" : "text-white/50"}`}>
                  {scoreA}<WinIndicator isWinner={scoreA > scoreB} />
                </span>
                <span className={`text-xs font-bold text-right tabular-nums ${scoreB >= scoreA ? "text-green-400" : "text-white/50"}`}>
                  {scoreB}<WinIndicator isWinner={scoreB > scoreA} />
                </span>
              </div>

              {/* Tier row */}
              <div className="grid grid-cols-[1fr_80px_80px] px-4 py-2.5 border-b border-white/[0.03]">
                <span className="text-xs font-bold text-white/70">Tier</span>
                <span className={`text-xs font-bold text-right ${TIER_COLORS[tierA]}`}>{TIER_LABELS[tierA]}</span>
                <span className={`text-xs font-bold text-right ${TIER_COLORS[tierB]}`}>{TIER_LABELS[tierB]}</span>
              </div>

              {/* Badge count row */}
              <div className="grid grid-cols-[1fr_80px_80px] px-4 py-2.5 border-b border-white/[0.03] bg-white/[0.01]">
                <span className="text-xs font-bold text-white/70">Badges</span>
                <span className={`text-xs font-bold text-right tabular-nums ${badgesA >= badgesB ? "text-green-400" : "text-white/50"}`}>
                  {badgesA}<WinIndicator isWinner={badgesA > badgesB} />
                </span>
                <span className={`text-xs font-bold text-right tabular-nums ${badgesB >= badgesA ? "text-green-400" : "text-white/50"}`}>
                  {badgesB}<WinIndicator isWinner={badgesB > badgesA} />
                </span>
              </div>

              {/* Data rows */}
              {rows.map((row, i) => {
                const aWins = row.higherIsBetter ? row.numA > row.numB : row.numA < row.numB;
                const bWins = row.higherIsBetter ? row.numB > row.numA : row.numB < row.numA;
                const tied = row.numA === row.numB;
                return (
                  <div
                    key={row.label}
                    className={`grid grid-cols-[1fr_80px_80px] px-4 py-2.5 ${i < rows.length - 1 ? "border-b border-white/[0.03]" : ""} ${i % 2 === 0 ? "" : "bg-white/[0.01]"}`}
                  >
                    <span className="text-xs text-white/50">{row.label}</span>
                    <span className={`text-xs text-right tabular-nums ${aWins ? "text-green-400 font-bold" : tied ? "text-white/60" : "text-white/40"}`}>
                      {row.valueA}{!tied && <WinIndicator isWinner={aWins} />}
                    </span>
                    <span className={`text-xs text-right tabular-nums ${bWins ? "text-green-400 font-bold" : tied ? "text-white/60" : "text-white/40"}`}>
                      {row.valueB}{!tied && <WinIndicator isWinner={bWins} />}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Badge Comparison */}
            {dataA.traits && dataB.traits && (
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                <h3 className="text-xs font-bold text-white/50 uppercase tracking-wider mb-3">Badge Comparison</h3>
                <div className="space-y-1.5">
                  {([
                    ["OG Member", dataA.traits.isOG, dataB.traits.isOG],
                    ["Whale", dataA.traits.isWhale, dataB.traits.isWhale],
                    ["Collector", dataA.traits.isCollector, dataB.traits.isCollector],
                    ["Binary Sun", dataA.traits.hasCombo, dataB.traits.hasCombo],
                    ["Early Adopter", dataA.traits.isEarlyAdopter, dataB.traits.isEarlyAdopter],
                    ["Tx Titan", dataA.traits.isTxTitan, dataB.traits.isTxTitan],
                    ["Solana Maxi", dataA.traits.isSolanaMaxi, dataB.traits.isSolanaMaxi],
                    ["Blue Chip", dataA.traits.isBlueChip, dataB.traits.isBlueChip],
                    ["DeFi King", dataA.traits.isDeFiKing, dataB.traits.isDeFiKing],
                    ["Meme Lord", dataA.traits.isMemeLord, dataB.traits.isMemeLord],
                    ["Diamond Hands", dataA.traits.diamondHands, dataB.traits.diamondHands],
                    ["Hyperactive", dataA.traits.hyperactiveDegen, dataB.traits.hyperactiveDegen],
                    ["Seeker", dataA.traits.hasSeeker, dataB.traits.hasSeeker],
                    ["Visionary", dataA.traits.hasPreorder, dataB.traits.hasPreorder],
                  ] as [string, boolean, boolean][]).map(([name, hasA, hasB]) => (
                    <div key={name} className="grid grid-cols-[20px_1fr_20px] gap-2 items-center text-xs">
                      <span className={hasA ? "text-green-400" : "text-white/15"}>●</span>
                      <span className={`text-center ${hasA || hasB ? "text-white/60" : "text-white/20"}`}>{name}</span>
                      <span className={hasB ? "text-green-400 text-right" : "text-white/15 text-right"}>●</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Empty state */}
        {!bothLoaded && !isLoading && (
          <div className="text-center py-12 text-white/20">
            <ArrowUpDown className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p className="text-sm">Enter two Solana wallet addresses to compare their identity scores</p>
          </div>
        )}
      </main>
    </div>
  );
}
