/**
 * CompositeScoreBreakdown — 5 horizontal progress bars showing score components.
 */

interface BreakdownProps {
  breakdown: {
    onchain: number;
    sybilTrust: number;
    humanProof: number;
    social: number;
    engagement: number;
  };
  compact?: boolean;
}

const BARS = [
  { key: 'onchain' as const, label: 'On-Chain', max: 400, color: '#22d3ee', icon: '🔗' },
  { key: 'sybilTrust' as const, label: 'Sybil Trust', max: 250, color: '#a78bfa', icon: '🛡️' },
  { key: 'humanProof' as const, label: 'Human Proof', max: 150, color: '#34d399', icon: '🎮' },
  { key: 'social' as const, label: 'Social', max: 100, color: '#fb923c', icon: '👥' },
  { key: 'engagement' as const, label: 'Engagement', max: 100, color: '#f472b6', icon: '⚡' },
];

export default function CompositeScoreBreakdown({ breakdown, compact = false }: BreakdownProps) {
  return (
    <div className={`space-y-${compact ? '2' : '3'}`}>
      {BARS.map(bar => {
        const value = breakdown[bar.key] || 0;
        const pct = Math.min(100, (value / bar.max) * 100);
        return (
          <div key={bar.key}>
            <div className={`flex justify-between items-center ${compact ? 'text-[10px]' : 'text-xs'} mb-1`}>
              <span className="text-white/60 flex items-center gap-1">
                <span>{bar.icon}</span>
                <span>{bar.label}</span>
              </span>
              <span style={{ color: bar.color }}>{value}/{bar.max}</span>
            </div>
            <div className={`${compact ? 'h-1.5' : 'h-2'} bg-white/10 rounded-full overflow-hidden`}>
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${pct}%`, backgroundColor: bar.color }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
