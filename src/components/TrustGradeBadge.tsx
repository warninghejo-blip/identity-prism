type TrustGradeBadgeSize = 'xs' | 'sm' | 'md' | 'lg';

const TRUST_GRADE_META: Record<string, { color: string; glow: string; label: string }> = {
  'A+': { color: '#22c55e', glow: 'rgba(34,197,94,0.42)', label: 'Elite trust' },
  A: { color: '#22c55e', glow: 'rgba(34,197,94,0.38)', label: 'High trust' },
  'A-': { color: '#4ade80', glow: 'rgba(74,222,128,0.34)', label: 'High trust' },
  'B+': { color: '#86efac', glow: 'rgba(134,239,172,0.30)', label: 'Solid trust' },
  B: { color: '#facc15', glow: 'rgba(250,204,21,0.30)', label: 'Moderate trust' },
  'B-': { color: '#fbbf24', glow: 'rgba(251,191,36,0.30)', label: 'Moderate trust' },
  'C+': { color: '#fb923c', glow: 'rgba(251,146,60,0.32)', label: 'Low trust' },
  C: { color: '#f97316', glow: 'rgba(249,115,22,0.34)', label: 'Low trust' },
  'C-': { color: '#ef4444', glow: 'rgba(239,68,68,0.34)', label: 'Weak trust' },
  D: { color: '#ef4444', glow: 'rgba(239,68,68,0.38)', label: 'Weak trust' },
  F: { color: '#dc2626', glow: 'rgba(220,38,38,0.42)', label: 'Critical trust' },
  'N/A': { color: '#64748b', glow: 'rgba(100,116,139,0.24)', label: 'Trust pending' },
};

const SIZE_CLASS: Record<TrustGradeBadgeSize, { box: string; icon: number; text: string; label: string }> = {
  xs: { box: 'gap-0', icon: 24, text: 'text-[8px]', label: 'hidden' },
  sm: { box: 'gap-1.5', icon: 30, text: 'text-[10px]', label: 'text-[9px]' },
  md: { box: 'gap-2', icon: 36, text: 'text-xs', label: 'text-[10px]' },
  lg: { box: 'gap-0', icon: 36, text: 'text-[8px]', label: 'hidden' },
};

const TRUST_GRADE_ICON: Record<string, string> = {
  'A+': '/icons/trust/trust-grade-a.png',
  A: '/icons/trust/trust-grade-a.png',
  'A-': '/icons/trust/trust-grade-a.png',
  'B+': '/icons/trust/trust-grade-b.png',
  B: '/icons/trust/trust-grade-b.png',
  'B-': '/icons/trust/trust-grade-b.png',
  'C+': '/icons/trust/trust-grade-c.png',
  C: '/icons/trust/trust-grade-c.png',
  'C-': '/icons/trust/trust-grade-c.png',
  D: '/icons/trust/trust-grade-d.png',
  F: '/icons/trust/trust-grade-f.png',
  'N/A': '/icons/trust/trust-grade-unknown.png',
};

function getTrustGradeMeta(grade: string | null | undefined) {
  return TRUST_GRADE_META[grade || 'N/A'] ?? TRUST_GRADE_META['N/A'];
}

export default function TrustGradeBadge({
  grade,
  score,
  size = 'sm',
  className = '',
}: {
  grade: string | null | undefined;
  score?: number | null;
  size?: TrustGradeBadgeSize;
  className?: string;
}) {
  const normalizedGrade = grade || 'N/A';
  const meta = getTrustGradeMeta(normalizedGrade);
  const sizeClass = SIZE_CLASS[size];
  const scoreLabel = typeof score === 'number' && Number.isFinite(score) ? `${Math.round(score)}/100` : null;
  const primaryText = size === 'xs' ? normalizedGrade : (scoreLabel ?? normalizedGrade);
  const icon = TRUST_GRADE_ICON[normalizedGrade] ?? TRUST_GRADE_ICON['N/A'];
  const showText = size !== 'xs' && size !== 'lg';

  return (
    <span
      className={`inline-flex shrink-0 items-center font-mono tabular-nums ${sizeClass.box} ${className}`}
      style={{ color: meta.color }}
      title={scoreLabel ? `Trust: ${scoreLabel} (${normalizedGrade})` : `Trust grade ${normalizedGrade}`}
      aria-label={scoreLabel ? `Trust ${scoreLabel}, grade ${normalizedGrade}` : `Trust grade ${normalizedGrade}`}
    >
      <img
        src={icon}
        alt=""
        width={sizeClass.icon}
        height={sizeClass.icon}
        aria-hidden="true"
        className="shrink-0 object-contain"
        style={{ filter: `drop-shadow(0 0 8px ${meta.glow}) drop-shadow(0 2px 5px rgba(0,0,0,0.45))` }}
        loading="lazy"
      />
      {showText && (
        <span className="flex min-w-0 flex-col leading-none">
          <span className={`font-black tracking-[0.08em] ${sizeClass.text}`}>{primaryText}</span>
          <span className={`mt-0.5 uppercase tracking-[0.12em] text-white/35 ${sizeClass.label}`}>{meta.label}</span>
        </span>
      )}
    </span>
  );
}
