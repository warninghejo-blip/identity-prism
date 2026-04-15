/**
 * CompositeScoreBreakdown — 5 horizontal progress bars with expandable detail rows.
 * On-chain and Sybil details shown inline when bars are expanded.
 */
import { useState } from 'react';
import type { ScoreDetails } from '@/hooks/useCompositeScore';

interface BreakdownProps {
  breakdown: {
    onchain: number;
    sybilTrust: number;
    humanProof: number;
    social: number;
    engagement: number;
  };
  details?: ScoreDetails | null;
  compact?: boolean;
}

type BarKey = 'onchain' | 'sybilTrust' | 'humanProof' | 'social' | 'engagement';

const BARS: { key: BarKey; label: string; max: number; color: string; icon: string; tooltip: string }[] = [
  {
    key: 'onchain',
    label: 'On-Chain',
    max: 400,
    color: '#22d3ee',
    icon: '\u{1F517}',
    tooltip: 'SOL balance, wallet age, transactions, NFTs, DeFi activity, badges & collection.',
  },
  {
    key: 'sybilTrust',
    label: 'Sybil Trust',
    max: 250,
    color: '#a78bfa',
    icon: '\u{1F6E1}\uFE0F',
    tooltip: 'Wallet authenticity score. Low sybil risk = high trust.',
  },
  {
    key: 'humanProof',
    label: 'Human Proof',
    max: 150,
    color: '#34d399',
    icon: '\u{1F3AE}',
    tooltip: 'Play games, unlock achievements, try different game types.',
  },
  {
    key: 'social',
    label: 'Social',
    max: 100,
    color: '#fb923c',
    icon: '\u{1F465}',
    tooltip: 'Win challenges, scan wallets, complete quests.',
  },
  {
    key: 'engagement',
    label: 'Engagement',
    max: 100,
    color: '#f472b6',
    icon: '\u26A1',
    tooltip: 'Complete quests, maintain streaks, scan wallets.',
  },
];

function DetailRow({
  label,
  raw,
  pts,
  max,
  color,
}: {
  label: string;
  raw: string;
  pts: number;
  max?: number;
  color: string;
}) {
  return (
    <div className="flex items-center justify-between text-[9px] py-0.5">
      <span className="text-white/40">{label}</span>
      <span className="text-white/30 font-mono">
        {raw && (
          <>
            <span className="text-white/20">{raw}</span>
            {' \u2192 '}
          </>
        )}
        <span style={{ color }}>{pts}</span>
        {max != null && <span className="text-white/15">/{max}</span>}
      </span>
    </div>
  );
}

function ExpandedDetails({ barKey, details, color }: { barKey: BarKey; details: ScoreDetails; color: string }) {
  try {
    switch (barKey) {
      case 'onchain': {
        const d = details?.onchain;
        if (!d)
          return (
            <div className="mt-1.5 mx-1 border-t border-white/5 pt-1.5">
              <span className="text-[8px] text-white/20">Scan wallet to see on-chain breakdown</span>
            </div>
          );
        const sb = d.scoreBreakdown;
        const cappedScore = Math.min(d.identityScore ?? 0, 400);
        const rows: { label: string; raw: string; pts: number; max: number }[] = [];
        if (sb && typeof sb === 'object') {
          if (sb.solBalance && typeof sb.solBalance.pts === 'number')
            rows.push({
              label: 'SOL Balance',
              raw: `${sb.solBalance.raw ?? 0} SOL`,
              pts: sb.solBalance.pts,
              max: sb.solBalance.max ?? 40,
            });
          if (sb.walletAge && typeof sb.walletAge.pts === 'number')
            rows.push({
              label: 'Wallet Age',
              raw: `${sb.walletAge.raw ?? 0} days`,
              pts: sb.walletAge.pts,
              max: sb.walletAge.max ?? 100,
            });
          if (sb.transactions && typeof sb.transactions.pts === 'number')
            rows.push({
              label: 'Transactions',
              raw: `${sb.transactions.raw ?? 0}`,
              pts: sb.transactions.pts,
              max: sb.transactions.max ?? 80,
            });
          if (sb.nfts && typeof sb.nfts.pts === 'number')
            rows.push({ label: 'NFTs', raw: `${sb.nfts.raw ?? 0}`, pts: sb.nfts.pts, max: sb.nfts.max ?? 32 });
          if (sb.defiActivity && typeof sb.defiActivity.pts === 'number')
            rows.push({
              label: 'DeFi Activity',
              raw: `${(sb.defiActivity as Record<string, unknown>).swaps ?? 0} swaps, ${(sb.defiActivity as Record<string, unknown>).protocols ?? 0} proto`,
              pts: sb.defiActivity.pts,
              max: sb.defiActivity.max ?? 30,
            });
          if (sb.badges && sb.badges.pts > 0)
            rows.push({
              label: `Badges (${sb.badges.items?.join(', ') || ''})`,
              raw: '',
              pts: sb.badges.pts,
              max: sb.badges.max ?? 68,
            });
          if (sb.collection && sb.collection.pts > 0)
            rows.push({
              label: `Collection (${sb.collection.items?.join(', ') || ''})`,
              raw: '',
              pts: sb.collection.pts,
              max: sb.collection.max ?? 50,
            });
        }
        return (
          <div className="mt-1.5 mx-1 border-t border-white/5 pt-1.5 space-y-0.5">
            {rows.length > 0 ? (
              <>
                {rows.map((r) => (
                  <DetailRow key={r.label} label={r.label} raw={r.raw} pts={r.pts} max={r.max} color={color} />
                ))}
                <div className="flex justify-end text-[9px] font-mono pt-0.5 border-t border-white/5">
                  <span style={{ color }}>On-Chain: {cappedScore}/400</span>
                </div>
              </>
            ) : (
              <>
                <DetailRow label="Identity Score" raw="" pts={cappedScore} max={400} color={color} />
                {d.hasSeeker && <DetailRow label="Seeker NFT" raw="owned" pts={20} max={20} color={color} />}
                {d.hasPreorder && <DetailRow label="Visionary NFT" raw="owned" pts={15} max={15} color={color} />}
                {d.hasCombo && <DetailRow label="Binary Sun Combo" raw="both NFTs" pts={15} max={15} color={color} />}
              </>
            )}
          </div>
        );
      }
      case 'sybilTrust': {
        const d = details?.sybilTrust;
        if (!d) return null;
        const rawTrust = typeof d.rawTrustScore === 'number' ? d.rawTrustScore : (d.trustScore ?? 0);
        const baseCompositeTrust =
          typeof d.baseCompositeTrust === 'number'
            ? d.baseCompositeTrust
            : Math.max(
                0,
                (typeof d.effectiveTrust === 'number' ? d.effectiveTrust : (d.adjustedTrust ?? rawTrust)) -
                  (d.recoveryBonus ?? 0),
              );
        const effectiveTrust =
          typeof d.effectiveTrust === 'number'
            ? d.effectiveTrust
            : typeof d.adjustedTrust === 'number'
              ? d.adjustedTrust
              : rawTrust;
        const rawPts = Math.min(250, Math.round((rawTrust / 100) * 250));
        const basePts = Math.min(250, Math.round((baseCompositeTrust / 100) * 250));
        const effectiveBasePts = Math.min(250, Math.round((effectiveTrust / 100) * 250));
        const badgeBonus = d.badgeBonus ?? 0;
        const finalPts = Math.min(250, Math.max(0, effectiveBasePts + badgeBonus));
        return (
          <div className="mt-1.5 mx-1 border-t border-white/5 pt-1.5 space-y-0.5">
            <DetailRow label="Raw Detector Trust" raw={`${rawTrust}/100`} pts={rawPts} max={250} color={color} />
            {d.verdictLabel && (
              <DetailRow
                label={`Verdict Base (${d.verdictLabel})`}
                raw={`${baseCompositeTrust}/100`}
                pts={basePts}
                max={250}
                color={color}
              />
            )}
            <DetailRow
              label="Recovery Bonus"
              raw={
                typeof d.recoveryBonus === 'number'
                  ? `+${d.recoveryBonus}${typeof d.recoveryCap === 'number' ? ` (cap ${d.recoveryCap})` : ''}`
                  : ''
              }
              pts={d.recoveryBonus ?? 0}
              max={typeof d.recoveryCap === 'number' ? d.recoveryCap : 25}
              color={color}
            />
            <DetailRow
              label="Effective Trust"
              raw={`${effectiveTrust}/100`}
              pts={effectiveBasePts}
              max={250}
              color={color}
            />
            <DetailRow label="Badge Bonus" raw="" pts={badgeBonus} max={30} color={color} />
            <div className="flex justify-end text-[9px] font-mono pt-0.5 border-t border-white/5">
              <span style={{ color }}>Sybil Trust: {finalPts}/250</span>
            </div>
          </div>
        );
      }
      case 'humanProof': {
        const d = details?.humanProof;
        if (!d)
          return (
            <div className="mt-1.5 mx-1 border-t border-white/5 pt-1.5">
              <span className="text-[8px] text-white/20">No game data yet</span>
            </div>
          );
        return (
          <div className="mt-1.5 mx-1 border-t border-white/5 pt-1.5 space-y-0.5">
            <DetailRow
              label="Game Scores"
              raw={`${d.gameTypesCount ?? 0} types`}
              pts={d.gameScoreTotal ?? 0}
              max={80}
              color={color}
            />
            <DetailRow
              label="Game Diversity"
              raw={`${d.gameTypesCount ?? 0} types`}
              pts={d.gameDiversity ?? 0}
              max={30}
              color={color}
            />
            <DetailRow
              label="Achievements"
              raw={`${d.achievementCount ?? 0} unlocked`}
              pts={d.achievementPts ?? 0}
              max={40}
              color={color}
            />
            {<DetailRow label="Badge Bonus" raw="" pts={d.badgeBonus ?? 0} max={30} color={color} />}
          </div>
        );
      }
      case 'social': {
        const d = details?.social;
        if (!d)
          return (
            <div className="mt-1.5 mx-1 border-t border-white/5 pt-1.5">
              <span className="text-[8px] text-white/20">No social data yet</span>
            </div>
          );
        return (
          <div className="mt-1.5 mx-1 border-t border-white/5 pt-1.5 space-y-0.5">
            <DetailRow
              label="Challenges Won"
              raw={`${d.challengesWon ?? 0}`}
              pts={d.challengePts ?? 0}
              max={32}
              color={color}
            />
            <DetailRow
              label="Scans Done"
              raw={`${details?.social?.scanCount ?? details?.engagement?.scanCount ?? 0}`}
              pts={details?.social?.scanPts ?? details?.engagement?.scanPts ?? 0}
              max={28}
              color={color}
            />
            <DetailRow
              label="Quests Done"
              raw={`${d.questsCompleted ?? details?.engagement?.questsCompleted ?? 0}`}
              pts={d.questPts ?? 0}
              max={16}
              color={color}
            />
            {<DetailRow label="Badge Bonus" raw="" pts={d.badgeBonus ?? 0} max={24} color={color} />}
          </div>
        );
      }
      case 'engagement': {
        const d = details?.engagement;
        if (!d)
          return (
            <div className="mt-1.5 mx-1 border-t border-white/5 pt-1.5">
              <span className="text-[8px] text-white/20">No engagement data yet</span>
            </div>
          );
        return (
          <div className="mt-1.5 mx-1 border-t border-white/5 pt-1.5 space-y-0.5">
            <DetailRow
              label="Quests"
              raw={`${d.questsCompleted ?? 0} done`}
              pts={d.questPts ?? 0}
              max={40}
              color={color}
            />
            <DetailRow label="Streak" raw={`${d.streakDays ?? 0} days`} pts={d.streakPts ?? 0} max={22} color={color} />
            <DetailRow label="Scans" raw={`${d.scanCount ?? 0}`} pts={d.scanPts ?? 0} max={14} color={color} />
            {<DetailRow label="Badge Bonus" raw="" pts={d.badgeBonus ?? 0} max={24} color={color} />}
          </div>
        );
      }
      default:
        return null;
    }
  } catch (err) {
    console.error('[CompositeBreakdown] ExpandedDetails crash:', barKey, err);
    return (
      <div className="mt-1.5 mx-1 border-t border-red-500/20 pt-1.5">
        <span className="text-[8px] text-red-400">Error loading {barKey} details</span>
      </div>
    );
  }
}

function InfoTooltip({ text, color }: { text: string; color: string }) {
  return (
    <span
      className="relative group/tip inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border cursor-help select-none flex-shrink-0 ml-0.5"
      style={{ borderColor: `${color}40`, color: `${color}80` }}
      onClick={(e) => e.stopPropagation()}
    >
      <span className="text-[8px] font-bold leading-none">i</span>
      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-[#0a0a0a] border border-white/15 rounded-xl text-[10px] text-white/80 leading-relaxed w-48 text-center opacity-0 pointer-events-none group-hover/tip:opacity-100 group-hover/tip:pointer-events-auto transition-opacity duration-200 z-50 shadow-2xl shadow-black/50">
        {text}
        <span className="absolute top-full left-1/2 -translate-x-1/2 -mt-px w-2 h-2 bg-[#0a0a0a] border-r border-b border-white/15 rotate-45" />
      </span>
    </span>
  );
}

export default function CompositeScoreBreakdown({ breakdown, details, compact = false }: BreakdownProps) {
  const [expandedBar, setExpandedBar] = useState<BarKey | null>(null);
  const canExpand = Boolean(details);

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      {BARS.map((bar) => {
        const value = breakdown[bar.key] || 0;
        const pct = Math.min(100, (value / bar.max) * 100);
        const isExpanded = expandedBar === bar.key;

        return (
          <div
            key={bar.key}
            className={canExpand ? 'cursor-pointer' : ''}
            onClick={() => canExpand && setExpandedBar(isExpanded ? null : bar.key)}
          >
            <div className={`flex justify-between items-center ${compact ? 'text-[10px]' : 'text-xs'} mb-1`}>
              <span className="text-white/60 flex items-center gap-1">
                {canExpand && (
                  <span
                    className={`text-white/20 text-[8px] transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                  >
                    {'\u25BE'}
                  </span>
                )}
                <span>{bar.icon}</span>
                <span>{bar.label}</span>
              </span>
              <span className="flex items-center gap-1">
                <InfoTooltip text={bar.tooltip} color={bar.color} />
                <span style={{ color: bar.color }} className="font-mono">
                  {Math.min(value, bar.max)}/{bar.max}
                </span>
              </span>
            </div>
            <div className={`${compact ? 'h-1.5' : 'h-2'} bg-white/10 rounded-full overflow-hidden`}>
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${pct}%`, backgroundColor: bar.color }}
              />
            </div>
            {isExpanded && details && <ExpandedDetails barKey={bar.key} details={details} color={bar.color} />}
          </div>
        );
      })}
    </div>
  );
}
