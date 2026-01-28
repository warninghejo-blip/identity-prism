import { useState } from 'react';
import { motion } from 'framer-motion';
import type { WalletTraits } from '@/hooks/useWalletData';
import { IdentityVisualization } from './IdentityVisualization';

interface IdentityCardProps {
  traits: WalletTraits;
  score: number;
  walletAddress: string;
}

const TIER_NAMES: Record<string, string> = {
  mercury: 'MERCURY TIER',
  mars: 'MARS TIER',
  venus: 'VENUS TIER',
  earth: 'EARTH TIER',
  neptune: 'NEPTUNE TIER',
  uranus: 'URANUS TIER',
  saturn: 'SATURN TIER',
  jupiter: 'JUPITER TIER',
  sun: 'SUN TIER',
  binary_sun: 'BINARY SUN TIER',
};

const TIER_COLORS: Record<string, string> = {
  mercury: '#8C7853',
  mars: '#CD5C5C',
  venus: '#F4D03F',
  earth: '#4169E1',
  neptune: '#4682B4',
  uranus: '#40E0D0',
  saturn: '#F4A460',
  jupiter: '#D2691E',
  sun: '#FFA500',
  binary_sun: 'linear-gradient(135deg, #FFA500, #00CED1)',
};

const TIER_DESCRIPTIONS: Record<string, string> = {
  mercury: 'Tiny, rocky world. Just beginning your cosmic journey.',
  mars: 'Red desert planet. Building your presence in the Solana ecosystem.',
  venus: 'Dense atmosphere world. Growing influence and activity.',
  earth: 'Life-sustaining planet. Established community member.',
  neptune: 'Icy blue giant. Deep ecosystem engagement.',
  uranus: 'Turquoise gas giant. Power user status achieved.',
  saturn: 'Majestic ringed planet. Elite collector and trader.',
  jupiter: 'Largest planet. Dominant force in the ecosystem.',
  sun: 'The Star itself. Legendary status achieved.',
  binary_sun: 'Twin Stars. Ultimate OG - Seeker Genesis + Chapter 2 Preorder.',
};

export function IdentityCard({ traits, score, walletAddress }: IdentityCardProps) {
  const [isFlipped, setIsFlipped] = useState(false);

  const tierName = TIER_NAMES[traits.planetTier] || 'UNKNOWN TIER';
  const tierColor = TIER_COLORS[traits.planetTier] || '#888888';
  const tierDescription = TIER_DESCRIPTIONS[traits.planetTier] || '';

  return (
    <div className="relative w-full max-w-md mx-auto perspective-1000">
      <motion.div
        className="relative w-full h-[600px] cursor-pointer"
        onClick={() => setIsFlipped(!isFlipped)}
        animate={{ rotateY: isFlipped ? 180 : 0 }}
        transition={{ duration: 0.6, ease: 'easeInOut' }}
        style={{ transformStyle: 'preserve-3d' }}
      >
        {/* Front Side */}
        <motion.div
          className="absolute inset-0 backface-hidden"
          style={{ backfaceVisibility: 'hidden' }}
        >
          <div className="w-full h-full rounded-3xl bg-gradient-to-br from-black/40 via-black/20 to-black/40 backdrop-blur-xl border border-white/10 shadow-2xl overflow-hidden">
            {/* 3D Visualization */}
            <div className="relative h-[400px] overflow-hidden">
              <IdentityVisualization traits={traits} score={score} />
            </div>

            {/* Tier Info */}
            <div className="p-6 space-y-3">
              <div
                className="text-2xl font-bold tracking-wider text-center bg-clip-text text-transparent"
                style={{
                  background: typeof tierColor === 'string' && tierColor.startsWith('linear-') ? tierColor : `linear-gradient(135deg, ${tierColor}, ${tierColor}dd)`,
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                {tierName}
              </div>

              <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-white/5 backdrop-blur-sm border border-white/10">
                <span className="text-sm text-gray-400 uppercase tracking-wide">Score</span>
                <span className="text-2xl font-bold text-white">{score}</span>
              </div>

              <p className="text-xs text-center text-gray-400 italic px-2">
                {tierDescription}
              </p>

              <p className="text-[10px] text-center text-gray-500 mt-2">
                Tap to view details
              </p>
            </div>
          </div>
        </motion.div>

        {/* Back Side */}
        <motion.div
          className="absolute inset-0 backface-hidden"
          style={{ backfaceVisibility: 'hidden', rotateY: 180 }}
        >
          <div className="w-full h-full rounded-3xl bg-gradient-to-br from-black/60 via-black/40 to-black/60 backdrop-blur-xl border border-white/10 shadow-2xl p-6 overflow-y-auto">
            <h3 className="text-xl font-bold text-white mb-4 text-center">IDENTITY STATISTICS</h3>

            <div className="space-y-3 text-sm">
              {/* Wallet Address */}
              <div className="p-3 rounded-lg bg-white/5 border border-white/10">
                <div className="text-xs text-gray-400 mb-1">Wallet Address</div>
                <div className="text-white font-mono text-xs truncate">{walletAddress}</div>
              </div>

              {/* SOL Balance */}
              <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10">
                <span className="text-gray-300">SOL Balance</span>
                <span className="text-white font-bold">{traits.solBalance.toFixed(3)} SOL</span>
              </div>

              {/* Wallet Age */}
              <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10">
                <span className="text-gray-300">Wallet Age</span>
                <span className="text-white font-bold">{traits.walletAgeDays} days</span>
              </div>

              {/* Transactions */}
              <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10">
                <span className="text-gray-300">Transactions</span>
                <span className="text-white font-bold">{traits.txCount.toLocaleString()}</span>
              </div>

              {/* NFT Count */}
              <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10">
                <span className="text-gray-300">NFTs Owned</span>
                <span className="text-white font-bold">{traits.nftCount}</span>
              </div>

              {/* Unique Tokens */}
              <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10">
                <span className="text-gray-300">Unique Tokens</span>
                <span className="text-white font-bold">{traits.uniqueTokenCount}</span>
              </div>

              {/* Achievements */}
              <div className="p-3 rounded-lg bg-white/5 border border-white/10">
                <div className="text-xs text-gray-400 mb-2">ACHIEVEMENTS</div>
                <div className="flex flex-wrap gap-2">
                  {traits.hasSeeker && (
                    <span className="px-2 py-1 rounded-full bg-cyan-500/20 text-cyan-300 text-xs border border-cyan-500/30">
                      🔵 Seeker Genesis
                    </span>
                  )}
                  {traits.hasPreorder && (
                    <span className="px-2 py-1 rounded-full bg-orange-500/20 text-orange-300 text-xs border border-orange-500/30">
                      🟠 Chapter 2 Preorder
                    </span>
                  )}
                  {traits.isBlueChip && (
                    <span className="px-2 py-1 rounded-full bg-purple-500/20 text-purple-300 text-xs border border-purple-500/30">
                      💎 Blue Chip Holder
                    </span>
                  )}
                  {traits.isDeFiKing && (
                    <span className="px-2 py-1 rounded-full bg-green-500/20 text-green-300 text-xs border border-green-500/30">
                      📈 DeFi King
                    </span>
                  )}
                  {traits.isMemeLord && (
                    <span className="px-2 py-1 rounded-full bg-pink-500/20 text-pink-300 text-xs border border-pink-500/30">
                      🐶 Meme Lord
                    </span>
                  )}
                  {traits.diamondHands && (
                    <span className="px-2 py-1 rounded-full bg-blue-500/20 text-blue-300 text-xs border border-blue-500/30">
                      💎 Diamond Hands
                    </span>
                  )}
                  {traits.hyperactiveDegen && (
                    <span className="px-2 py-1 rounded-full bg-red-500/20 text-red-300 text-xs border border-red-500/30">
                      ⚡ Hyperactive Degen
                    </span>
                  )}
                </div>
              </div>
            </div>

            <p className="text-[10px] text-center text-gray-500 mt-4">
              Tap to flip back
            </p>
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}
