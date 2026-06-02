/**
 * CompositeScoreBreakdown — 5 horizontal progress bars with expandable final score context.
 */
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
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
  // Web mode: the web Identity score is on-chain + sybil only (games/social/
  // engagement are Seeker-app exclusive), so show just those two bars + a note.
  webMode?: boolean;
}

type BarKey = 'onchain' | 'sybilTrust' | 'humanProof' | 'social' | 'engagement';
type SummaryFactor = { label: string; value: string; hint?: string };

const BARS: { key: BarKey; label: string; max: number; color: string; iconSrc: string; tooltip: string }[] = [
  {
    key: 'onchain',
    label: 'On-Chain',
    max: 400,
    color: '#22d3ee',
    iconSrc: '/textures/Solana.png',
    tooltip: 'SOL balance, wallet age, transactions, NFTs, DeFi activity, badges & collection.',
  },
  {
    key: 'sybilTrust',
    label: 'Trust',
    max: 250,
    color: '#a78bfa',
    iconSrc: '/icons/trust/trust-grade-unknown.png',
    tooltip: 'Final trust component used in the Identity Score.',
  },
  {
    key: 'humanProof',
    label: 'Games',
    max: 150,
    color: '#34d399',
    iconSrc: '/hub/league.png',
    tooltip: 'League game scores, achievements, and mode variety.',
  },
  {
    key: 'social',
    label: 'Social',
    max: 100,
    color: '#ef4444',
    iconSrc: '/hub/arena.png',
    tooltip: 'Arena opponents, challenge participation, tournaments, and community reviews.',
  },
  {
    key: 'engagement',
    label: 'Engagement',
    max: 100,
    color: '#f472b6',
    iconSrc: '/hub/quests.png',
    tooltip: 'Personal app activity: quests, streaks, and scans.',
  },
];

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

function SummaryPanel({
  title,
  value,
  max,
  status,
  description,
  factors,
  color,
  action,
}: {
  title: string;
  value: number;
  max: number;
  status: string;
  description: string;
  factors: SummaryFactor[];
  color: string;
  action?: ReactNode;
}) {
  return (
    <div className="mt-1.5 mx-1 border-t border-white/5 pt-2">
      <div className="mb-1.5 flex items-center justify-between gap-3 px-1">
        <div className="min-w-0 truncate text-[8px] font-black uppercase tracking-[0.14em]" style={{ color }}>
          {title}
        </div>
        <div className="shrink-0 text-right font-mono text-[10px] font-black tabular-nums text-white/55">
          <span style={{ color }}>{value}</span>
          <span className="text-white/20">/{max}</span>
          <span className="mx-1 text-white/15">·</span>
          <span className="text-white/35">{status}</span>
        </div>
      </div>
      <div className="rounded-2xl border border-white/[0.045] bg-black/[0.14] px-2 py-2 shadow-inner shadow-black/20">
        <p className="mb-1.5 px-0.5 text-[8.5px] leading-snug text-white/32">{description}</p>
        {factors.length > 0 && (
          <div className="space-y-1.5">
            {factors.map((factor) => (
              <div
                key={factor.label}
                className="flex min-h-7 items-center justify-between gap-3 rounded-xl bg-white/[0.025] px-2.5 py-1.5"
              >
                <div className="min-w-0">
                  <div className="truncate text-[8px] font-bold uppercase tracking-[0.1em] text-white/32">
                    {factor.label}
                  </div>
                  {factor.hint && (
                    <div className="mt-0.5 truncate font-mono text-[8px] text-white/20">{factor.hint}</div>
                  )}
                </div>
                <div className="shrink-0 truncate text-right font-mono text-[10px] font-semibold text-white/65">
                  {factor.value}
                </div>
              </div>
            ))}
          </div>
        )}
        {action && <div className="pt-1.5">{action}</div>}
      </div>
    </div>
  );
}

function scoreStatus(value: number, max: number) {
  const pct = max > 0 ? value / max : 0;
  if (pct >= 0.8) return 'Strong';
  if (pct >= 0.55) return 'Good';
  if (pct >= 0.3) return 'Limited';
  if (value > 0) return 'Thin';
  return 'Empty';
}

function formatCount(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : '0';
}

function formatPts(pts: unknown, max?: unknown) {
  const safePts = typeof pts === 'number' && Number.isFinite(pts) ? Math.max(0, Math.round(pts)) : 0;
  const safeMax = typeof max === 'number' && Number.isFinite(max) ? Math.max(0, Math.round(max)) : null;
  return safeMax != null ? `${safePts}/${safeMax}` : String(safePts);
}

function scoredFactor(label: string, hint: string, pts: unknown, max: unknown): SummaryFactor & { pts: number } {
  const safePts = typeof pts === 'number' && Number.isFinite(pts) ? Math.max(0, Math.round(pts)) : 0;
  const safeMax = typeof max === 'number' && Number.isFinite(max) ? Math.max(0, Math.round(max)) : 0;
  return { label, hint, pts: safePts, value: formatPts(safePts, safeMax) };
}

function cappedFactors(rows: Array<SummaryFactor & { pts: number }>, cap: number): SummaryFactor[] {
  let remaining = Math.max(0, cap);
  return rows.map((row) => {
    const counted = Math.min(row.pts, remaining);
    remaining -= counted;
    const maxMatch = row.value.match(/\/(\d+)$/);
    const max = maxMatch ? Number(maxMatch[1]) : row.pts;
    return {
      label: row.label,
      hint: counted < row.pts ? `${row.hint} · capped from ${row.pts}` : row.hint,
      value: formatPts(counted, max),
    };
  });
}

function frameBonusFactor(finalValue: number, baseValue: number): SummaryFactor[] {
  const bonusPts = Math.max(0, Math.round(finalValue - baseValue));
  return bonusPts > 0 ? [{ label: 'Card Frame', hint: 'Equipped visual frame', value: `+${bonusPts}` }] : [];
}

function sumPoints(rows: Array<{ pts?: unknown }>) {
  return rows.reduce(
    (total, row) => total + (typeof row.pts === 'number' && Number.isFinite(row.pts) ? row.pts : 0),
    0,
  );
}

function TrustContext({
  details,
  finalValue,
  color,
}: {
  details: ScoreDetails['sybilTrust'] | undefined;
  finalValue: number;
  color: string;
}) {
  if (!details) return null;
  const walletTrust =
    typeof details.effectiveTrust === 'number'
      ? details.effectiveTrust
      : typeof details.adjustedTrust === 'number'
        ? details.adjustedTrust
        : (details.trustScore ?? 0);
  const rawTrust = typeof details.rawTrustScore === 'number' ? details.rawTrustScore : (details.trustScore ?? 0);
  const baseTrust = typeof details.baseCompositeTrust === 'number' ? details.baseCompositeTrust : rawTrust;
  const recoveryBonus = typeof details.recoveryBonus === 'number' ? details.recoveryBonus : 0;
  const badgeBonus = typeof details.badgeBonus === 'number' ? details.badgeBonus : 0;
  const baseTrustImpact = Math.max(0, Math.round((baseTrust / 100) * 250));
  const recoveryImpact = Math.max(0, Math.round(((walletTrust - baseTrust) / 100) * 250));
  const badgeImpact = Math.max(0, badgeBonus);
  const baseImpact = Math.min(250, baseTrustImpact + recoveryImpact + badgeImpact);
  const status =
    details.verdictLabel ||
    (walletTrust >= 80 ? 'Looks organic' : walletTrust >= 50 ? 'Building trust' : 'Needs proof');
  const needsRecovery = rawTrust < 50;

  return (
    <SummaryPanel
      title="Trust"
      value={finalValue}
      max={250}
      status={status}
      description="Only score-point rows below are added. Raw trust stays in hints so it is not counted twice."
      factors={[
        {
          label: 'Verdict Trust',
          hint: `Raw ${Math.round(rawTrust)}/100 · ${status}`,
          value: formatPts(baseTrustImpact, 250),
        },
        {
          label: 'Recovery Impact',
          hint: recoveryBonus > 0 ? `+${recoveryBonus}/100 trust converted to score` : 'No recovery boost',
          value: formatPts(recoveryImpact, 250),
        },
        ...(badgeImpact > 0
          ? [{ label: 'Trust Badges', hint: 'Verified trust badges', value: formatPts(badgeImpact, 250) }]
          : []),
        ...frameBonusFactor(finalValue, baseImpact),
      ]}
      color={color}
      action={
        needsRecovery ? (
          <Link
            to="/recovery"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex h-6 items-center rounded-md border border-amber-400/15 bg-amber-400/[0.06] px-2 text-[9px] font-black uppercase tracking-[0.08em] text-amber-300/80 hover:border-amber-300/25 hover:bg-amber-300/[0.10] hover:text-amber-200"
          >
            Recovery plan →
          </Link>
        ) : undefined
      }
    />
  );
}

function ExpandedDetails({
  barKey,
  details,
  color,
  finalValue,
}: {
  barKey: BarKey;
  details: ScoreDetails;
  color: string;
  finalValue: number;
}) {
  try {
    switch (barKey) {
      case 'sybilTrust':
        return <TrustContext details={details?.sybilTrust} finalValue={finalValue} color={color} />;
      case 'onchain': {
        const d = details?.onchain;
        if (!d) return null;
        const sb = d.scoreBreakdown;
        const defi = sb?.defiActivity as Record<string, unknown> | undefined;
        const rows = [
          {
            label: 'SOL Balance',
            hint: `${formatCount(sb?.solBalance?.raw)} SOL`,
            value: formatPts(sb?.solBalance?.pts, sb?.solBalance?.max),
            pts: sb?.solBalance?.pts,
          },
          {
            label: 'Wallet Age',
            hint: `${formatCount(sb?.walletAge?.raw)} days`,
            value: formatPts(sb?.walletAge?.pts, sb?.walletAge?.max),
            pts: sb?.walletAge?.pts,
          },
          {
            label: 'Transactions',
            hint: formatCount(sb?.transactions?.raw),
            value: formatPts(sb?.transactions?.pts, sb?.transactions?.max),
            pts: sb?.transactions?.pts,
          },
          {
            label: 'NFTs',
            hint: formatCount(sb?.nfts?.raw),
            value: formatPts(sb?.nfts?.pts, sb?.nfts?.max),
            pts: sb?.nfts?.pts,
          },
          {
            label: 'DeFi Activity',
            hint: `${formatCount(defi?.swaps)} swaps · ${formatCount(defi?.protocols)} protocols`,
            value: formatPts(sb?.defiActivity?.pts, sb?.defiActivity?.max),
            pts: sb?.defiActivity?.pts,
          },
          {
            label: 'Badges',
            hint: (sb?.badges?.items || []).join(', ') || 'None',
            value: formatPts(sb?.badges?.pts, sb?.badges?.max),
            pts: sb?.badges?.pts,
          },
          {
            label: 'Collection',
            hint: (sb?.collection?.items || []).join(', ') || 'None',
            value: formatPts(sb?.collection?.pts, sb?.collection?.max),
            pts: sb?.collection?.pts,
          },
        ];
        const basePts = Math.round(sumPoints(rows));
        return (
          <SummaryPanel
            title="On-Chain"
            value={finalValue}
            max={400}
            status={scoreStatus(finalValue, 400)}
            description="SOL, age, transaction history, NFTs, DeFi, badges and collection points."
            factors={[
              ...rows.map(({ label, hint, value }) => ({ label, hint, value })),
              ...frameBonusFactor(finalValue, basePts),
            ]}
            color={color}
          />
        );
      }
      case 'humanProof': {
        const d = details?.humanProof;
        if (!d) return null;
        return (
          <SummaryPanel
            title="Games"
            value={finalValue}
            max={150}
            status={scoreStatus(finalValue, 150)}
            description="League results only: scores, played modes and unlocked game achievements."
            factors={[
              {
                label: 'Game Scores',
                hint: `${formatCount(d.gameTypesCount)} modes`,
                value: formatPts(d.gameScoreTotal, 80),
              },
              {
                label: 'Mode Diversity',
                hint: `${formatCount(d.gameTypesCount)} modes`,
                value: formatPts(d.gameDiversity, 30),
              },
              {
                label: 'Achievements',
                hint: `${formatCount(d.achievementCount)} unlocked`,
                value: formatPts(d.achievementPts, 40),
              },
              {
                label: 'Game Badges',
                hint: (d.badgeBonus ?? 0) > 0 ? 'Game badge active' : 'None',
                value: formatPts(d.badgeBonus, 30),
              },
              ...frameBonusFactor(
                finalValue,
                sumPoints([
                  { pts: d.gameScoreTotal },
                  { pts: d.gameDiversity },
                  { pts: d.achievementPts },
                  { pts: d.badgeBonus },
                ]),
              ),
            ]}
            color={color}
          />
        );
      }
      case 'social': {
        const d = details?.social;
        if (!d) return null;
        const socialRows = cappedFactors(
          [
            scoredFactor('Arena Wins', `${formatCount(d.challengesWon)} wins`, d.arenaWinPts ?? d.challengePts, 30),
            scoredFactor('Arena Matches', `${formatCount(d.challengesPlayed)} completed`, d.arenaActivityPts, 20),
            scoredFactor('Opponents', `${formatCount(d.uniqueOpponents)} wallets`, d.opponentPts, 20),
            scoredFactor('Tournaments', `${formatCount(d.tournamentsPlayed)} joined`, d.tournamentPts, 20),
            scoredFactor('Community Reviews', `${formatCount(d.communityReviews)} reports`, d.communityPts, 20),
            scoredFactor('Arena Badge', (d.badgeBonus ?? 0) > 0 ? 'Arena badge active' : 'None', d.badgeBonus, 10),
          ],
          100,
        );
        return (
          <SummaryPanel
            title="Social"
            value={finalValue}
            max={100}
            status={scoreStatus(finalValue, 100)}
            description="Interaction with other participants: Arena matches, opponents, tournaments and Sybil Hunt reviews."
            factors={[
              ...socialRows,
              ...frameBonusFactor(
                finalValue,
                Math.min(
                  100,
                  sumPoints([
                    { pts: d.arenaWinPts ?? d.challengePts },
                    { pts: d.arenaActivityPts },
                    { pts: d.opponentPts },
                    { pts: d.tournamentPts },
                    { pts: d.communityPts },
                    { pts: d.badgeBonus },
                  ]),
                ),
              ),
            ]}
            color={color}
          />
        );
      }
      case 'engagement': {
        const d = details?.engagement;
        if (!d) return null;
        return (
          <SummaryPanel
            title="Engagement"
            value={finalValue}
            max={100}
            status={scoreStatus(finalValue, 100)}
            description="Personal product activity only: quests, scan usage and streak consistency."
            factors={[
              { label: 'Quests', hint: `${formatCount(d.questsCompleted)} done`, value: formatPts(d.questPts, 40) },
              { label: 'Streak', hint: `${formatCount(d.streakDays)} days`, value: formatPts(d.streakPts, 22) },
              { label: 'Scans', hint: formatCount(d.scanCount), value: formatPts(d.scanPts, 14) },
              {
                label: 'Activity Badges',
                hint: (d.badgeBonus ?? 0) > 0 ? 'Activity badge active' : 'None',
                value: formatPts(d.badgeBonus, 24),
              },
              ...frameBonusFactor(
                finalValue,
                sumPoints([{ pts: d.questPts }, { pts: d.streakPts }, { pts: d.scanPts }, { pts: d.badgeBonus }]),
              ),
            ]}
            color={color}
          />
        );
      }
      default:
        return null;
    }
  } catch (err) {
    console.error('[CompositeBreakdown] ExpandedDetails crash:', barKey, err);
    return null;
  }
}

export default function CompositeScoreBreakdown({ breakdown, details, compact = false, webMode = false }: BreakdownProps) {
  const [expandedBar, setExpandedBar] = useState<BarKey | null>(null);
  const canExpand = Boolean(details);
  // Web: on-chain + sybil trust are scaled to the 0-1000 web ladder (raw max 650)
  // so the two bars SUM to the headline web score; the other three stay visible
  // for reference but are dimmed and tagged "in app" (Seeker-only, not counted).
  const WEB_SCALE = 1000 / 650;
  const isWebCounted = (k: BarKey) => k === 'onchain' || k === 'sybilTrust';

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      {BARS.map((bar) => {
        const scaled = webMode && isWebCounted(bar.key);
        const rawValue = breakdown[bar.key] || 0;
        const value = scaled ? Math.round(rawValue * WEB_SCALE) : rawValue;
        const max = scaled ? Math.round(bar.max * WEB_SCALE) : bar.max;
        const appOnly = webMode && !isWebCounted(bar.key);
        // App-only metrics (Games/Social/Engagement on web) aren't earned on the web —
        // show no number/progress, just an "In app" tag so it's clear they're Seeker-only.
        const pct = appOnly ? 0 : Math.min(100, (value / max) * 100);
        const finalValue = Math.min(value, max);
        const rowExpandable = canExpand && !appOnly;
        const isExpanded = expandedBar === bar.key;
        const barLabel = webMode && bar.key === 'sybilTrust' ? 'Sybil Trust' : bar.label;

        return (
          <div key={bar.key} style={appOnly ? { opacity: 0.45 } : undefined}>
            <button
              type="button"
              data-testid={`score-row-${bar.key}`}
              aria-expanded={isExpanded}
              disabled={!rowExpandable}
              className={`w-full text-left ${rowExpandable ? 'cursor-pointer' : 'cursor-default'}`}
              onClick={() => rowExpandable && setExpandedBar(isExpanded ? null : bar.key)}
            >
              <div className={`flex justify-between items-center ${compact ? 'text-[10px]' : 'text-xs'} mb-1`}>
                <span className="text-white/60 flex items-center gap-1">
                  {rowExpandable && (
                    <span
                      className={`text-white/20 text-[8px] transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                    >
                      {'\u25BE'}
                    </span>
                  )}
                  <img
                    src={bar.iconSrc}
                    alt=""
                    aria-hidden="true"
                    className={`${compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} shrink-0 object-contain`}
                    loading="lazy"
                    draggable={false}
                    style={{ filter: `drop-shadow(0 0 5px ${bar.color}66)` }}
                  />
                  <span>{barLabel}</span>
                </span>
                <span className="flex items-center gap-1">
                  {appOnly ? (
                    <span className="rounded border border-white/15 px-1.5 py-px text-[8.5px] font-bold uppercase tracking-wider text-white/45">
                      In app only
                    </span>
                  ) : (
                    <>
                      <InfoTooltip text={bar.tooltip} color={bar.color} />
                      <span style={{ color: bar.color }} className="font-mono">
                        {finalValue}/{max}
                      </span>
                    </>
                  )}
                </span>
              </div>
              <div className={`${compact ? 'h-1.5' : 'h-2'} bg-white/10 rounded-full overflow-hidden`}>
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${pct}%`, backgroundColor: bar.color }}
                />
              </div>
            </button>
            {isExpanded && details && (
              <ExpandedDetails barKey={bar.key} details={details} color={bar.color} finalValue={finalValue} />
            )}
          </div>
        );
      })}
      {webMode && (
        <p className={`${compact ? 'text-[8.5px]' : 'text-[10px]'} leading-snug text-white/35 pt-0.5`}>
          On-chain + Sybil Trust make up your web score. Games, Social &amp; Engagement are earned in the Seeker app \u2014 shown for reference, not counted here.
        </p>
      )}
    </div>
  );
}
