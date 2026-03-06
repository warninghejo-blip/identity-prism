/**
 * CompositeScoreBreakdown — 5 horizontal progress bars with ⓘ tooltips and expandable detail rows.
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
  { key: 'onchain', label: 'On-Chain', max: 400, color: '#22d3ee', icon: '\u{1F517}', tooltip: 'Based on Identity Score (0\u20131400). Badge holders get bonus points.' },
  { key: 'sybilTrust', label: 'Sybil Trust', max: 250, color: '#a78bfa', icon: '\u{1F6E1}\uFE0F', tooltip: 'Wallet authenticity score. Low sybil risk = high trust.' },
  { key: 'humanProof', label: 'Human Proof', max: 150, color: '#34d399', icon: '\u{1F3AE}', tooltip: 'Play games, unlock achievements, try different game types.' },
  { key: 'social', label: 'Social', max: 100, color: '#fb923c', icon: '\u{1F465}', tooltip: 'Win challenges, explore constellations, compare wallets.' },
  { key: 'engagement', label: 'Engagement', max: 100, color: '#f472b6', icon: '\u26A1', tooltip: 'Complete quests, maintain streaks, scan wallets.' },
];

function DetailRow({ label, raw, pts, max, color }: { label: string; raw: string; pts: number; max?: number; color: string }) {
  return (
    <div className="flex items-center justify-between text-[9px] py-0.5">
      <span className="text-white/40">{label}</span>
      <span className="text-white/30 font-mono">
        {raw && <><span className="text-white/20">{raw}</span>{' \u2192 '}</>}
        <span style={{ color }}>{pts}</span>
        {max != null && <span className="text-white/15">/{max}</span>}
      </span>
    </div>
  );
}

function ExpandedDetails({ barKey, details, color }: { barKey: BarKey; details: ScoreDetails; color: string }) {
  switch (barKey) {
    case 'onchain': {
      const d = details.onchain;
      const badges: string[] = [];
      if (d.hasSeeker) badges.push('Seeker +15');
      if (d.hasPreorder) badges.push('Visionary +15');
      if (d.hasCombo) badges.push('Binary Sun +30');
      return (
        <div className="mt-1.5 ml-6 mr-1 border-t border-white/5 pt-1.5 space-y-0.5">
          <DetailRow label="Identity Score" raw={`${d.identityScore}/${d.identityMax}`} pts={d.basePts} color={color} />
          {d.badgeBonus > 0 && (
            <DetailRow label={`Badge Bonus (${badges.join(', ')})`} raw="" pts={d.badgeBonus} color={color} />
          )}
          <div className="flex justify-end text-[9px] font-mono pt-0.5 border-t border-white/5">
            <span style={{ color }}>Total: {Math.min(400, d.basePts + d.badgeBonus)}/400</span>
          </div>
        </div>
      );
    }
    case 'sybilTrust': {
      const d = details.sybilTrust;
      return (
        <div className="mt-1.5 ml-6 mr-1 border-t border-white/5 pt-1.5 space-y-0.5">
          <DetailRow label="Trust Score" raw={`${d.trustScore}/${d.trustMax}`} pts={Math.min(250, Math.round((d.trustScore / 100) * 250))} max={250} color={color} />
        </div>
      );
    }
    case 'humanProof': {
      const d = details.humanProof;
      return (
        <div className="mt-1.5 ml-6 mr-1 border-t border-white/5 pt-1.5 space-y-0.5">
          <DetailRow label="Game Scores" raw={`${d.gameTypesCount} types`} pts={d.gameScoreTotal} max={80} color={color} />
          <DetailRow label="Game Diversity" raw={`${d.gameTypesCount} types`} pts={d.gameDiversity} max={30} color={color} />
          <DetailRow label="Achievements" raw={`${d.achievementCount} unlocked`} pts={d.achievementPts} max={40} color={color} />
        </div>
      );
    }
    case 'social': {
      const d = details.social;
      return (
        <div className="mt-1.5 ml-6 mr-1 border-t border-white/5 pt-1.5 space-y-0.5">
          <DetailRow label="Challenges Won" raw={`${d.challengesWon}`} pts={d.challengePts} max={40} color={color} />
          <DetailRow label="Constellation" raw={`${d.constellationExplored} explored`} pts={d.constellationPts} max={35} color={color} />
          <DetailRow label="Compares" raw={`${d.compareCount}`} pts={d.comparePts} max={25} color={color} />
        </div>
      );
    }
    case 'engagement': {
      const d = details.engagement;
      return (
        <div className="mt-1.5 ml-6 mr-1 border-t border-white/5 pt-1.5 space-y-0.5">
          <DetailRow label="Quests" raw={`${d.questsCompleted} done`} pts={d.questPts} max={50} color={color} />
          <DetailRow label="Streak" raw={`${d.streakDays} days`} pts={d.streakPts} max={30} color={color} />
          <DetailRow label="Scans" raw={`${d.scanCount}`} pts={d.scanPts} max={20} color={color} />
        </div>
      );
    }
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
      {BARS.map(bar => {
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
                <span>{bar.icon}</span>
                <span>{bar.label}</span>
                <InfoTooltip text={bar.tooltip} color={bar.color} />
                {canExpand && (
                  <span className={`text-white/20 text-[8px] transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}>{'\u25BE'}</span>
                )}
              </span>
              <span style={{ color: bar.color }} className="font-mono">{value}/{bar.max}</span>
            </div>
            <div className={`${compact ? 'h-1.5' : 'h-2'} bg-white/10 rounded-full overflow-hidden`}>
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${pct}%`, backgroundColor: bar.color }}
              />
            </div>
            {isExpanded && details && (
              <ExpandedDetails barKey={bar.key} details={details} color={bar.color} />
            )}
          </div>
        );
      })}
    </div>
  );
}
