import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { goBack } from '@/lib/safeNavigate';
import { startFadeTransition, fadeOutTransition } from '@/lib/fadeTransition';
import { getHeliusProxyUrl } from '@/constants';
import { getTierIcon, TIER_HEX, TIER_LABELS } from '@/lib/constants/tierColors';

interface WalletData {
  address: string;
  score?: number;
  tier?: string;
  scanCount?: number;
  firstSeenAt?: string;
  lastSeenAt?: string;
  coins?: number;
  sybil?: { trustScore?: number; trustGrade?: string };
  composite?: {
    compositeScore: number;
    compositeTier: string;
    breakdown: { onchain: number; sybilTrust: number; humanProof: number; social: number; engagement: number };
  };
  stats?: { tokens?: number; nfts?: number; transactions?: number; solBalance?: number };
}

export default function ProfilePage() {
  const { address } = useParams<{ address: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<WalletData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fadeOutTransition();
  }, []);

  useEffect(() => {
    if (!address) return;
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
      setError('Invalid address');
      setLoading(false);
      return;
    }
    setLoading(true);
    const proxyUrl = getHeliusProxyUrl() || '';
    fetch(`${proxyUrl}/api/wallet-database?address=${encodeURIComponent(address)}`)
      .then((r) => {
        if (!r.ok) throw new Error('Wallet not found');
        return r.json();
      })
      .then((d) => {
        setData(d);
        setError('');
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [address]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-white/50 animate-pulse">Loading profile...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <p className="text-white/50">{error || 'Profile not found'}</p>
        <button onClick={() => startFadeTransition(() => goBack(navigate))} className="text-cyan-400 hover:underline">
          Go back
        </button>
      </div>
    );
  }

  const tier = data.composite?.compositeTier || data.tier || 'mercury';
  const tierColor = TIER_HEX[tier] || '#94a3b8';
  const compositeScore = data.composite?.compositeScore ?? 0;
  const breakdown = data.composite?.breakdown;

  const barData = breakdown
    ? [
        { label: 'On-Chain', value: breakdown.onchain, max: 400, color: '#22d3ee' },
        { label: 'Sybil Trust', value: breakdown.sybilTrust, max: 250, color: '#a78bfa' },
        { label: 'Human Proof', value: breakdown.humanProof, max: 150, color: '#34d399' },
        { label: 'Social', value: breakdown.social, max: 100, color: '#fb923c' },
        { label: 'Engagement', value: breakdown.engagement, max: 100, color: '#f472b6' },
      ]
    : [];

  return (
    <div className="max-w-lg mx-auto px-4 py-8 space-y-6">
      <button
        onClick={() => startFadeTransition(() => goBack(navigate))}
        className="text-white/40 hover:text-white/70 text-sm"
      >
        ← Back
      </button>

      <div className="text-center space-y-2">
        <div className="w-16 h-16 mx-auto" style={{ filter: `drop-shadow(0 0 12px ${tierColor}60)` }}>
          <img src={getTierIcon(tier)} alt={TIER_LABELS[tier] || tier} className="w-full h-full object-contain" />
        </div>
        <h1 className="text-xl font-bold text-white">{TIER_LABELS[tier] || tier}</h1>
        <p className="text-white/40 text-xs font-mono">{address}</p>
        <div className="text-3xl font-bold" style={{ color: tierColor }}>
          {compositeScore}
          <span className="text-sm text-white/30">/1000</span>
        </div>
      </div>

      {barData.length > 0 && (
        <div className="space-y-3 bg-white/5 rounded-xl p-4">
          {barData.map((b) => (
            <div key={b.label}>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-white/60">{b.label}</span>
                <span style={{ color: b.color }}>
                  {b.value}/{b.max}
                </span>
              </div>
              <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${(b.value / b.max) * 100}%`, backgroundColor: b.color }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="On-Chain Score" value={`${data.score || 0}/400`} />
        <StatCard label="Sybil Grade" value={data.sybil?.trustGrade || '—'} />
        {data.sybil?.trustGrade && ['D', 'F'].includes(data.sybil.trustGrade) && (
          <Link to="/recovery" className="text-xs text-amber-400 hover:underline ml-2">
            Improve →
          </Link>
        )}
        <StatCard label="Scans" value={String(data.scanCount || 0)} />
        <StatCard label="Coins" value={String(data.coins || 0)} />
        {data.stats && (
          <>
            <StatCard label="Tokens" value={String(data.stats.tokens || 0)} />
            <StatCard label="NFTs" value={String(data.stats.nfts || 0)} />
          </>
        )}
      </div>

      <div className="text-center">
        <Link
          to={`/compare?b=${address}`}
          className="inline-block px-6 py-2 rounded-lg bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 transition"
        >
          Compare with me
        </Link>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white/5 rounded-lg p-3 text-center">
      <div className="text-xs text-white/40">{label}</div>
      <div className="text-lg font-semibold text-white">{value}</div>
    </div>
  );
}
