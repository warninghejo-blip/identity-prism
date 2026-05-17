import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Search, AlertCircle, CheckCircle, XCircle } from 'lucide-react';

/**
 * SybilCheckerPage - Wallet Sybil verification tool
 * Allows users to check if a wallet has Sybil risk indicators
 *
 * ASCII STORYBOARD:
 * ─────────────────────────────────────────────────────────────
 * Stage 0: Page load                              t=0ms
 * ├─ Header fade in                             t=0ms
 * ├─ Title fade in                              t=100ms
 * ├─ Description fade                           t=200ms
 * ├─ Search box scale in                        t=300ms
 * └─ Example cards stagger                      t=500ms (+100ms each)
 *
 * Stage 1: Search query
 * ├─ Loading spinner                            t=0ms
 * └─ Results appear with stagger                t=800ms
 */

const TIMING = {
  headerFadeIn: 0,
  titleFadeIn: 100,
  descFadeIn: 200,
  searchScaleIn: 300,
  exampleStagger: 500,
  exampleStaggerOffset: 100,
};

interface SybilCheckResult {
  walletAddress: string;
  riskScore: number; // 0-100
  status: 'clear' | 'warning' | 'high_risk';
  indicators: {
    label: string;
    risk: 'low' | 'medium' | 'high';
    explanation: string;
  }[];
  celestialTier: string;
  reputation: number;
  lastUpdated: string;
}

const getRiskColor = (status: string) => {
  switch (status) {
    case 'clear':
      return 'from-green-500 to-emerald-400';
    case 'warning':
      return 'from-yellow-500 to-orange-400';
    case 'high_risk':
      return 'from-red-500 to-rose-400';
    default:
      return 'from-gray-500 to-slate-400';
  }
};

const getRiskIcon = (status: string) => {
  switch (status) {
    case 'clear':
      return <CheckCircle className="w-6 h-6 text-green-400" />;
    case 'warning':
      return <AlertCircle className="w-6 h-6 text-yellow-400" />;
    case 'high_risk':
      return <XCircle className="w-6 h-6 text-red-400" />;
    default:
      return <AlertCircle className="w-6 h-6 text-white/50" />;
  }
};

const mockResults: Record<string, SybilCheckResult> = {
  'fenn.skr': {
    walletAddress: 'fenn.skr',
    riskScore: 15,
    status: 'clear',
    indicators: [
      { label: 'On-chain History', risk: 'low', explanation: 'Rich transaction history (2+ years)' },
      { label: 'Account Age', risk: 'low', explanation: 'Account created 18 months ago' },
      { label: 'Verified Human', risk: 'low', explanation: 'Passed human verification' },
    ],
    celestialTier: 'Earth',
    reputation: 476,
    lastUpdated: new Date().toISOString(),
  },
  example: {
    walletAddress: 'example',
    riskScore: 42,
    status: 'warning',
    indicators: [
      { label: 'Account Age', risk: 'medium', explanation: 'Account created 30 days ago' },
      { label: 'Limited History', risk: 'medium', explanation: 'Few on-chain interactions' },
      { label: 'Verified Human', risk: 'low', explanation: 'Passed human verification' },
    ],
    celestialTier: 'Venus',
    reputation: 120,
    lastUpdated: new Date().toISOString(),
  },
};

export default function SybilCheckerPage() {
  const [walletInput, setWalletInput] = useState('');
  const [result, setResult] = useState<SybilCheckResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const query = walletInput.trim().toLowerCase();

    if (!query) return;

    setIsLoading(true);
    setError('');

    // Simulate API call
    await new Promise((r) => setTimeout(r, 800));

    const mockResult = mockResults[query];
    if (mockResult) {
      setResult(mockResult);
    } else {
      setError('Wallet not found in Sybil database. Create a celestial card to get verified.');
    }

    setIsLoading(false);
  };

  return (
    <div className="relative w-full min-h-screen bg-black text-white overflow-x-hidden">
      {/* Background */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-red-900/3 to-transparent" />
      </div>

      {/* Header */}
      <motion.header
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: TIMING.headerFadeIn / 1000, duration: 0.6 }}
        className="relative z-10 border-b border-white/10 backdrop-blur-lg bg-black/50 py-4"
      >
        <div className="container mx-auto px-8 flex items-center justify-between">
          <a href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <div className="w-8 h-8 rounded bg-gradient-to-br from-purple-500 to-cyan-400 flex items-center justify-center text-xs font-bold">
              IP
            </div>
            <span className="font-orbitron text-sm font-700 tracking-wider">IDENTITY PRISM</span>
          </a>
          <a
            href="/app"
            className="px-6 py-2 bg-purple-600 hover:bg-purple-700 text-white font-600 text-sm rounded-lg transition-colors"
          >
            Launch App
          </a>
        </div>
      </motion.header>

      {/* Main Content */}
      <div className="relative z-10 min-h-[calc(100vh-100px)] flex items-center py-16">
        <div className="container mx-auto px-8 w-full">
          <div className="max-w-3xl mx-auto">
            {/* Header */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: TIMING.titleFadeIn / 1000, duration: 0.6 }}
              className="text-center mb-12"
            >
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-500/10 border border-red-400/25 mb-6">
                <div className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                <span className="font-orbitron text-xs tracking-widest text-red-300 uppercase">Sybil Detector</span>
              </div>

              <h1 className="font-space-grotesk text-5xl md:text-6xl font-900 mb-4">Catch Sybils</h1>

              <motion.p
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: TIMING.descFadeIn / 1000, duration: 0.6 }}
                className="text-white/60 text-lg leading-relaxed"
              >
                Search any wallet to check Sybil risk indicators. Real players get cleared. Suspicious patterns get
                flagged.
              </motion.p>
            </motion.div>

            {/* Search Box */}
            <motion.form
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: TIMING.searchScaleIn / 1000, duration: 0.6 }}
              onSubmit={handleSearch}
              className="mb-12"
            >
              <div className="relative">
                <input
                  type="text"
                  placeholder="Enter wallet address or username..."
                  value={walletInput}
                  onChange={(e) => setWalletInput(e.target.value)}
                  className="w-full px-6 py-4 rounded-xl bg-white/5 border border-white/10 text-white placeholder-white/40 focus:outline-none focus:border-purple-500/50 focus:ring-2 focus:ring-purple-500/20 transition-all font-jetbrains"
                />
                <button
                  type="submit"
                  disabled={isLoading}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 p-2 hover:bg-white/10 rounded-lg transition-colors disabled:opacity-50"
                >
                  {isLoading ? (
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
                      className="w-5 h-5 border-2 border-purple-500/30 border-t-purple-500 rounded-full"
                    />
                  ) : (
                    <Search className="w-5 h-5 text-white/60" />
                  )}
                </button>
              </div>
            </motion.form>

            {/* Error Message */}
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-8 p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300"
              >
                {error}
              </motion.div>
            )}

            {/* Results */}
            {result && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6 }}
                className="mb-12"
              >
                {/* Risk Card */}
                <div
                  className={`p-8 rounded-2xl bg-gradient-to-br ${getRiskColor(
                    result.status,
                  )} bg-opacity-5 border border-white/10 mb-8`}
                >
                  <div className="flex items-center justify-between mb-6">
                    <div>
                      <h2 className="font-space-grotesk text-2xl font-900 mb-2">{result.walletAddress}</h2>
                      <p className="text-sm text-white/60">
                        Last updated: {new Date(result.lastUpdated).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="text-right">
                      <div className="flex items-center gap-2 mb-2">{getRiskIcon(result.status)}</div>
                      <div className="font-orbitron text-3xl font-900">
                        {result.riskScore}
                        <span className="text-lg text-white/50">/100</span>
                      </div>
                      <p className="text-xs font-orbitron tracking-widest text-white/50 uppercase mt-1">
                        {result.status === 'clear' && 'Clear'}
                        {result.status === 'warning' && 'Warning'}
                        {result.status === 'high_risk' && 'High Risk'}
                      </p>
                    </div>
                  </div>

                  {/* Reputation */}
                  <div className="grid grid-cols-2 gap-4 pt-6 border-t border-white/10">
                    <div>
                      <p className="text-xs font-orbitron tracking-widest text-white/40 uppercase mb-2">Tier</p>
                      <p className="text-lg font-600">{result.celestialTier}</p>
                    </div>
                    <div>
                      <p className="text-xs font-orbitron tracking-widest text-white/40 uppercase mb-2">Reputation</p>
                      <p className="text-lg font-600">{result.reputation} EARTH</p>
                    </div>
                  </div>
                </div>

                {/* Indicators */}
                <div className="space-y-3">
                  {result.indicators.map((indicator, idx) => (
                    <motion.div
                      key={indicator.label}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.1 }}
                      className="p-4 rounded-lg bg-white/5 border border-white/10"
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={`mt-1 px-2 py-0.5 rounded text-xs font-700 uppercase tracking-wide flex-shrink-0 ${
                            indicator.risk === 'low'
                              ? 'bg-green-500/20 text-green-300'
                              : indicator.risk === 'medium'
                                ? 'bg-yellow-500/20 text-yellow-300'
                                : 'bg-red-500/20 text-red-300'
                          }`}
                        >
                          {indicator.risk}
                        </div>
                        <div className="flex-1">
                          <p className="font-600 text-white mb-1">{indicator.label}</p>
                          <p className="text-sm text-white/60">{indicator.explanation}</p>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* Example Searches */}
            {!result && (
              <motion.div className="mb-12">
                <p className="text-sm font-orbitron tracking-widest text-white/40 uppercase mb-4">Try searching</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {['fenn.skr', 'example'].map((example, idx) => (
                    <motion.button
                      key={example}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        delay: (TIMING.exampleStagger + idx * TIMING.exampleStaggerOffset) / 1000,
                        duration: 0.4,
                      }}
                      onClick={() => {
                        setWalletInput(example);
                        setTimeout(() => handleSearch({ preventDefault: () => {} } as any), 0);
                      }}
                      className="p-4 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all text-left"
                    >
                      <p className="font-jetbrains text-sm text-white font-600">{example}</p>
                      <p className="text-xs text-white/50 mt-1">Example wallet</p>
                    </motion.button>
                  ))}
                </div>
              </motion.div>
            )}
          </div>
        </div>
      </div>

      {/* Info Section */}
      <motion.section
        className="relative z-10 py-16 px-8 border-t border-white/10 bg-white/5"
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
      >
        <div className="container mx-auto">
          <h2 className="font-space-grotesk text-3xl font-900 mb-8 text-center">How Sybil Detection Works</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
            {[
              {
                title: 'Gameplay History',
                desc: 'Real players accumulate verifiable gameplay records over time.',
              },
              {
                title: 'On-Chain Footprint',
                desc: 'Genuine wallet activity shows diverse interactions and natural patterns.',
              },
              {
                title: 'Human Verification',
                desc: 'Verified humans pass identity checks that bots and stolen accounts cannot.',
              },
            ].map((item, idx) => (
              <motion.div
                key={item.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.1 }}
                viewport={{ once: true }}
                className="p-6 rounded-lg bg-white/5 border border-white/10"
              >
                <h3 className="font-space-grotesk font-700 text-white mb-2">{item.title}</h3>
                <p className="text-sm text-white/60">{item.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </motion.section>

      {/* Footer CTA */}
      <motion.section
        className="relative z-10 py-16 px-8 text-center"
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
      >
        <h2 className="font-space-grotesk text-3xl font-900 mb-4">Build Your Identity</h2>
        <p className="text-white/60 mb-8">Get verified and earn your celestial card today.</p>
        <a
          href="/app"
          className="inline-block px-10 py-3 bg-gradient-to-r from-cyan-400 to-purple-500 text-black font-700 rounded-lg hover:scale-105 transition-transform"
        >
          Launch App & Get Started
        </a>
      </motion.section>
    </div>
  );
}
