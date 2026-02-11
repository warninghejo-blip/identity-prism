import React, { useEffect, useState, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { getHeliusRpcUrl } from '@/constants';

interface AttestationData {
  protocol: string;
  version: number;
  wallet: string;
  score: number;
  maxScore: number;
  tier: string;
  badges: string[];
  stats: Record<string, number>;
  authority: string;
  ts: string;
}

const TIER_COLORS: Record<string, string> = {
  mercury: '#8B8B8B',
  venus: '#E8CDA0',
  earth: '#4B9CD3',
  mars: '#C1440E',
  jupiter: '#C88B3A',
  saturn: '#E8D191',
  uranus: '#73C2FB',
  neptune: '#3F54BE',
  sun: '#FFD700',
  'binary sun': '#FF6B35',
};

const TIER_EMOJI: Record<string, string> = {
  mercury: '☿️',
  venus: '♀️',
  earth: '🌍',
  mars: '♂️',
  jupiter: '♃',
  saturn: '🪐',
  uranus: '⛢',
  neptune: '♆',
  sun: '☀️',
  'binary sun': '🌟',
};

type VerifyState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: AttestationData; slot: number; blockTime: number | null; signature: string }
  | { status: 'error'; message: string };

const Verify: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [state, setState] = useState<VerifyState>({ status: 'idle' });
  const [inputSig, setInputSig] = useState(searchParams.get('tx') || searchParams.get('sig') || '');

  const verify = useCallback(async (signature: string) => {
    if (!signature.trim()) return;
    setState({ status: 'loading' });

    try {
      const rpcUrl = getHeliusRpcUrl() ?? 'https://api.mainnet-beta.solana.com';
      const resp = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getTransaction',
          params: [signature.trim(), { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }],
        }),
      });
      const json = await resp.json();
      if (json.error) throw new Error(json.error.message);
      if (!json.result) throw new Error('Transaction not found. Check the signature and try again.');

      const tx = json.result;
      const instructions = tx.transaction?.message?.instructions || [];

      // Find Memo instruction
      const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
      const memoIx = instructions.find(
        (ix: any) => ix.programId === MEMO_PROGRAM || ix.program === 'spl-memo'
      );

      if (!memoIx) throw new Error('No Memo instruction found in this transaction. This is not an attestation.');

      const memoData = memoIx.parsed || memoIx.data;
      if (!memoData) throw new Error('Could not parse Memo data from transaction.');

      let parsed: any;
      try {
        // Memo data might be a JSON string directly, or base64 encoded
        if (typeof memoData === 'string' && memoData.startsWith('{')) {
          parsed = JSON.parse(memoData);
        } else if (typeof memoData === 'string') {
          // Try base64 decode
          const decoded = atob(memoData);
          parsed = JSON.parse(decoded);
        } else {
          parsed = memoData;
        }
      } catch {
        throw new Error('Memo data is not valid Identity Prism attestation JSON.');
      }

      if (!parsed.protocol || !parsed.protocol.startsWith('identity-prism')) {
        throw new Error(`Not an Identity Prism attestation. Protocol: ${parsed.protocol || 'unknown'}`);
      }

      const attestation: AttestationData = {
        protocol: parsed.protocol,
        version: parsed.version || 1,
        wallet: parsed.wallet || '',
        score: parsed.score || 0,
        maxScore: parsed.maxScore || 1400,
        tier: parsed.tier || 'unknown',
        badges: parsed.badges || [],
        stats: parsed.stats || {},
        authority: parsed.authority || '',
        ts: parsed.ts || '',
      };

      setState({
        status: 'success',
        data: attestation,
        slot: tx.slot,
        blockTime: tx.blockTime,
        signature: signature.trim(),
      });
    } catch (err: any) {
      setState({ status: 'error', message: err.message || 'Verification failed' });
    }
  }, []);

  useEffect(() => {
    const sig = searchParams.get('tx') || searchParams.get('sig');
    if (sig) {
      setInputSig(sig);
      verify(sig);
    }
  }, [searchParams, verify]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputSig.trim()) {
      setSearchParams({ tx: inputSig.trim() });
      verify(inputSig.trim());
    }
  };

  const tierColor = state.status === 'success' ? (TIER_COLORS[state.data.tier.toLowerCase()] || '#888') : '#888';
  const tierEmoji = state.status === 'success' ? (TIER_EMOJI[state.data.tier.toLowerCase()] || '🔮') : '';

  const formatDate = (ts: string | number | null) => {
    if (!ts) return 'Unknown';
    const d = typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts);
    return d.toLocaleString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
    });
  };

  return (
    <div className="relative z-10 min-h-screen flex flex-col items-center px-4 py-12">
      {/* Header */}
      <Link to="/" className="mb-8 flex items-center gap-3 hover:opacity-80 transition-opacity">
        <img src="/assets/icon.png" alt="Identity Prism" className="w-10 h-10 rounded-full" />
        <span className="text-xl font-bold bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">
          Identity Prism
        </span>
      </Link>

      <h1 className="text-3xl md:text-4xl font-bold text-center mb-2">
        Verify On-Chain Attestation
      </h1>
      <p className="text-gray-400 text-center mb-8 max-w-lg">
        Enter a Solana transaction signature to verify an Identity Prism reputation attestation recorded on-chain.
      </p>

      {/* Search form */}
      <form onSubmit={handleSubmit} className="w-full max-w-2xl mb-10">
        <div className="flex gap-2">
          <input
            type="text"
            value={inputSig}
            onChange={(e) => setInputSig(e.target.value)}
            placeholder="Transaction signature (e.g. 5K8s...)"
            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-gray-500 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30 font-mono text-sm"
          />
          <button
            type="submit"
            disabled={state.status === 'loading' || !inputSig.trim()}
            className="px-6 py-3 bg-gradient-to-r from-cyan-500 to-purple-600 rounded-xl font-semibold text-white hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {state.status === 'loading' ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Verifying
              </span>
            ) : 'Verify'}
          </button>
        </div>
      </form>

      {/* Error */}
      {state.status === 'error' && (
        <div className="w-full max-w-2xl bg-red-500/10 border border-red-500/30 rounded-2xl p-6 mb-8">
          <div className="flex items-start gap-3">
            <span className="text-2xl">❌</span>
            <div>
              <h3 className="font-semibold text-red-400 mb-1">Verification Failed</h3>
              <p className="text-red-300/80 text-sm">{state.message}</p>
            </div>
          </div>
        </div>
      )}

      {/* Success */}
      {state.status === 'success' && (
        <div className="w-full max-w-2xl space-y-6">
          {/* Verified banner */}
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-2">
              <span className="text-3xl">✅</span>
              <h2 className="text-xl font-bold text-emerald-400">Attestation Verified</h2>
            </div>
            <p className="text-emerald-300/70 text-sm">
              This reputation score was permanently recorded on the Solana blockchain and co-signed by the Identity Prism authority.
            </p>
          </div>

          {/* Score card */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur-sm">
            <div className="flex items-center justify-between mb-6">
              <div>
                <p className="text-gray-400 text-sm mb-1">Reputation Score</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-5xl font-black" style={{ color: tierColor }}>
                    {state.data.score}
                  </span>
                  <span className="text-gray-500 text-lg">/ {state.data.maxScore}</span>
                </div>
              </div>
              <div className="text-right">
                <p className="text-gray-400 text-sm mb-1">Tier</p>
                <div className="flex items-center gap-2">
                  <span className="text-3xl">{tierEmoji}</span>
                  <span className="text-2xl font-bold uppercase" style={{ color: tierColor }}>
                    {state.data.tier}
                  </span>
                </div>
              </div>
            </div>

            {/* Progress bar */}
            <div className="w-full h-3 bg-white/5 rounded-full overflow-hidden mb-6">
              <div
                className="h-full rounded-full transition-all duration-1000"
                style={{
                  width: `${Math.min(100, (state.data.score / state.data.maxScore) * 100)}%`,
                  background: `linear-gradient(90deg, ${tierColor}88, ${tierColor})`,
                }}
              />
            </div>

            {/* Badges */}
            {state.data.badges.length > 0 && (
              <div className="mb-6">
                <p className="text-gray-400 text-sm mb-2">Badges</p>
                <div className="flex flex-wrap gap-2">
                  {state.data.badges.map((badge) => (
                    <span
                      key={badge}
                      className="px-3 py-1 bg-white/5 border border-white/10 rounded-full text-sm capitalize"
                    >
                      {badge.replace(/_/g, ' ')}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Stats */}
            {Object.keys(state.data.stats).length > 0 && (
              <div className="mb-6">
                <p className="text-gray-400 text-sm mb-2">On-Chain Stats</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {Object.entries(state.data.stats).map(([key, val]) => (
                    <div key={key} className="bg-white/5 rounded-xl p-3">
                      <p className="text-gray-500 text-xs capitalize">{key.replace(/_/g, ' ')}</p>
                      <p className="text-white font-semibold">
                        {typeof val === 'number' ? val.toLocaleString() : String(val)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Wallet */}
            <div className="border-t border-white/5 pt-4 space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-gray-500 text-sm">Wallet</span>
                <code className="text-cyan-400 text-sm font-mono">
                  {state.data.wallet.slice(0, 8)}...{state.data.wallet.slice(-8)}
                </code>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-500 text-sm">Authority</span>
                <code className="text-purple-400 text-sm font-mono">
                  {state.data.authority.slice(0, 8)}...{state.data.authority.slice(-8)}
                </code>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-500 text-sm">Attested At</span>
                <span className="text-gray-300 text-sm">{formatDate(state.data.ts || state.blockTime)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-500 text-sm">Solana Slot</span>
                <span className="text-gray-300 text-sm font-mono">{state.slot.toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-500 text-sm">Transaction</span>
                <a
                  href={`https://solscan.io/tx/${state.signature}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyan-400 text-sm font-mono hover:underline"
                >
                  {state.signature.slice(0, 12)}...
                  <span className="ml-1 text-xs">↗</span>
                </a>
              </div>
            </div>
          </div>

          {/* CTA */}
          <div className="flex flex-col sm:flex-row gap-3">
            <a
              href={`https://identityprism.xyz/?address=${state.data.wallet}`}
              className="flex-1 text-center px-6 py-3 bg-gradient-to-r from-cyan-500 to-purple-600 rounded-xl font-semibold text-white hover:opacity-90 transition-opacity"
            >
              View Full Identity Card
            </a>
            <a
              href={`https://identityprism.xyz/api/actions/attest?address=${state.data.wallet}`}
              className="flex-1 text-center px-6 py-3 bg-white/5 border border-white/10 rounded-xl font-semibold text-white hover:bg-white/10 transition-colors"
            >
              Attest Your Own Wallet
            </a>
          </div>
        </div>
      )}

      {/* Idle state info */}
      {state.status === 'idle' && (
        <div className="w-full max-w-2xl">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-8 text-center">
            <span className="text-5xl mb-4 block">🔍</span>
            <h3 className="text-lg font-semibold mb-2">How it works</h3>
            <div className="text-gray-400 text-sm space-y-2 text-left max-w-md mx-auto">
              <p><strong>1.</strong> A user attests their reputation via Identity Prism Blink or API</p>
              <p><strong>2.</strong> The score, tier, and badges are written on-chain using the Solana Memo program</p>
              <p><strong>3.</strong> The transaction is co-signed by our authority keypair</p>
              <p><strong>4.</strong> Paste the transaction signature above to verify the attestation</p>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="mt-12 text-center text-gray-600 text-xs">
        Identity Prism — On-Chain Reputation Layer for Solana
      </div>
    </div>
  );
};

export default Verify;
