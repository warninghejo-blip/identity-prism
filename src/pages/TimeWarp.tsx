/**
 * Time Warp — Historical score timeline for Identity Prism v5.
 * Slide through time to see how your wallet's identity evolved.
 * Shows tier changes, milestone markers, and score progression.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { ArrowLeft, Loader2, Clock, TrendingUp, Star } from 'lucide-react';
import { getHeliusProxyUrl } from '@/constants';

// ── Types ──

interface ScoreSnapshot {
  date: string;
  score: number;
  tier: string;
}

interface Milestone {
  date: string;
  label: string;
  type: 'tier_up' | 'achievement' | 'mint' | 'first_scan';
  tier?: string;
}

const TIER_COLORS: Record<string, string> = {
  mercury: '#8B8B8B', mars: '#C1440E', venus: '#E8CDA0', earth: '#4B9CD3',
  neptune: '#3F54BE', uranus: '#73C2FB', saturn: '#E8D191', jupiter: '#C88B3A',
  sun: '#FFD700', binary_sun: '#22D3EE',
};

const TIER_ORDER = ['mercury', 'mars', 'venus', 'earth', 'neptune', 'uranus', 'saturn', 'jupiter', 'sun', 'binary_sun'];

// ── Chart renderer ──

function renderTimeline(
  ctx: CanvasRenderingContext2D,
  snapshots: ScoreSnapshot[],
  milestones: Milestone[],
  width: number,
  height: number,
  hoveredIndex: number | null,
) {
  const dpr = Math.min(window.devicePixelRatio, 2);
  const w = width;
  const h = height;
  const padding = { top: 40, right: 30, bottom: 60, left: 50 };
  const chartW = w - padding.left - padding.right;
  const chartH = h - padding.top - padding.bottom;

  ctx.clearRect(0, 0, w * dpr, h * dpr);
  ctx.fillStyle = '#050510';
  ctx.fillRect(0, 0, w * dpr, h * dpr);

  if (snapshots.length < 2) return;

  const maxScore = Math.max(...snapshots.map((s) => s.score), 200);
  const minDate = new Date(snapshots[0].date).getTime();
  const maxDate = new Date(snapshots[snapshots.length - 1].date).getTime();
  const dateRange = maxDate - minDate || 1;

  const toX = (date: string) => padding.left + ((new Date(date).getTime() - minDate) / dateRange) * chartW;
  const toY = (score: number) => padding.top + chartH - (score / maxScore) * chartH;

  // Grid lines
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const y = padding.top + (i / 5) * chartH;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(padding.left + chartW, y);
    ctx.stroke();

    const scoreLabel = Math.round(maxScore * (1 - i / 5));
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(String(scoreLabel), padding.left - 8, y + 3);
  }

  // Tier background bands
  const tierThresholds = [0, 100, 200, 350, 500, 650, 800, 900, 1000, 1100];
  for (let i = 0; i < tierThresholds.length - 1; i++) {
    const tier = TIER_ORDER[i];
    const color = TIER_COLORS[tier] ?? '#333';
    const y1 = toY(Math.min(tierThresholds[i + 1], maxScore));
    const y2 = toY(tierThresholds[i]);
    ctx.fillStyle = color + '08';
    ctx.fillRect(padding.left, y1, chartW, y2 - y1);
  }

  // Score line — gradient fill
  ctx.beginPath();
  ctx.moveTo(toX(snapshots[0].date), toY(snapshots[0].score));
  for (let i = 1; i < snapshots.length; i++) {
    ctx.lineTo(toX(snapshots[i].date), toY(snapshots[i].score));
  }
  // Fill area under line
  const lineEnd = { x: toX(snapshots[snapshots.length - 1].date), y: toY(snapshots[snapshots.length - 1].score) };
  ctx.lineTo(lineEnd.x, padding.top + chartH);
  ctx.lineTo(toX(snapshots[0].date), padding.top + chartH);
  ctx.closePath();
  const gradient = ctx.createLinearGradient(0, padding.top, 0, padding.top + chartH);
  gradient.addColorStop(0, 'rgba(34, 211, 238, 0.15)');
  gradient.addColorStop(1, 'rgba(34, 211, 238, 0.0)');
  ctx.fillStyle = gradient;
  ctx.fill();

  // Score line — stroke
  ctx.beginPath();
  ctx.moveTo(toX(snapshots[0].date), toY(snapshots[0].score));
  for (let i = 1; i < snapshots.length; i++) {
    ctx.lineTo(toX(snapshots[i].date), toY(snapshots[i].score));
  }
  ctx.strokeStyle = '#22d3ee';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Score dots
  for (let i = 0; i < snapshots.length; i++) {
    const x = toX(snapshots[i].date);
    const y = toY(snapshots[i].score);
    const isHovered = hoveredIndex === i;
    const tierColor = TIER_COLORS[snapshots[i].tier] ?? '#22d3ee';

    ctx.fillStyle = tierColor;
    ctx.beginPath();
    ctx.arc(x, y, isHovered ? 6 : 3, 0, Math.PI * 2);
    ctx.fill();

    if (isHovered) {
      // Tooltip
      ctx.fillStyle = 'rgba(0,0,0,0.85)';
      const tooltipW = 140;
      const tooltipH = 48;
      const tx = Math.min(x - tooltipW / 2, w - tooltipW - 10);
      const ty = y - tooltipH - 12;
      ctx.beginPath();
      ctx.roundRect(tx, ty, tooltipW, tooltipH, 6);
      ctx.fill();
      ctx.strokeStyle = tierColor + '60';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = '#fff';
      ctx.font = 'bold 13px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${snapshots[i].score} pts`, tx + tooltipW / 2, ty + 20);
      ctx.fillStyle = tierColor;
      ctx.font = '10px sans-serif';
      ctx.fillText(snapshots[i].tier.toUpperCase().replace('_', ' '), tx + tooltipW / 2, ty + 36);
    }
  }

  // Milestone markers
  for (const m of milestones) {
    const x = toX(m.date);
    ctx.strokeStyle = '#f59e0b60';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(x, padding.top);
    ctx.lineTo(x, padding.top + chartH);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#f59e0b';
    ctx.font = 'bold 14px serif';
    ctx.textAlign = 'center';
    ctx.fillText('★', x, padding.top - 8);

    ctx.fillStyle = 'rgba(245,158,11,0.5)';
    ctx.font = '9px sans-serif';
    ctx.fillText(m.label, x, padding.top + chartH + 20);
  }

  // Date axis labels
  const dateStep = Math.max(1, Math.floor(snapshots.length / 6));
  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  ctx.font = '9px monospace';
  ctx.textAlign = 'center';
  for (let i = 0; i < snapshots.length; i += dateStep) {
    const x = toX(snapshots[i].date);
    const d = new Date(snapshots[i].date);
    ctx.fillText(`${d.getMonth() + 1}/${d.getDate()}`, x, padding.top + chartH + 40);
  }
}

// ── Main component ──

export default function TimeWarp() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const address = searchParams.get('address');
  const { publicKey } = useWallet();
  const walletAddress = address || publicKey?.toBase58() || '';

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loading, setLoading] = useState(true);
  const [snapshots, setSnapshots] = useState<ScoreSnapshot[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // Fetch data
  useEffect(() => {
    if (!walletAddress) { setLoading(false); return; }

    const fetchData = async () => {
      try {
        const base = getHeliusProxyUrl() || window.location.origin;
        const res = await fetch(`${base}/api/score-history?address=${walletAddress}`);
        if (res.ok) {
          const data = await res.json();
          if (data.scores?.length) {
            const sorted = [...data.scores].sort((a: any, b: any) =>
              new Date(a.date).getTime() - new Date(b.date).getTime()
            );
            setSnapshots(sorted);

            // Detect tier changes as milestones
            const ms: Milestone[] = [];
            for (let i = 1; i < sorted.length; i++) {
              if (sorted[i].tier !== sorted[i - 1].tier) {
                ms.push({
                  date: sorted[i].date,
                  label: `→ ${sorted[i].tier.replace('_', ' ').toUpperCase()}`,
                  type: 'tier_up',
                  tier: sorted[i].tier,
                });
              }
            }
            setMilestones(ms);
            setLoading(false);
            return;
          }
        }
      } catch {}

      // Fallback: generate demo timeline
      const now = Date.now();
      const demo: ScoreSnapshot[] = [];
      let score = 50;
      for (let i = 30; i >= 0; i--) {
        score = Math.min(1200, score + Math.floor(Math.random() * 40));
        const tier = TIER_ORDER[Math.min(TIER_ORDER.length - 1, Math.floor(score / 130))];
        demo.push({
          date: new Date(now - i * 24 * 60 * 60 * 1000).toISOString(),
          score,
          tier,
        });
      }
      setSnapshots(demo);
      setMilestones([
        { date: demo[5].date, label: 'First Scan', type: 'first_scan' },
        { date: demo[15].date, label: '→ EARTH', type: 'tier_up', tier: 'earth' },
        { date: demo[25].date, label: '→ SATURN', type: 'tier_up', tier: 'saturn' },
      ]);
      setLoading(false);
    };

    fetchData();
  }, [walletAddress]);

  // Render chart
  useEffect(() => {
    if (loading || !canvasRef.current || snapshots.length < 2) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio, 2);
    const w = window.innerWidth;
    const h = window.innerHeight - 80;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    renderTimeline(ctx, snapshots, milestones, w, h, hoveredIndex);
  }, [loading, snapshots, milestones, hoveredIndex]);

  // Mouse interaction
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (snapshots.length < 2) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const padding = { left: 50, right: 30 };
    const chartW = rect.width - padding.left - padding.right;
    const minDate = new Date(snapshots[0].date).getTime();
    const maxDate = new Date(snapshots[snapshots.length - 1].date).getTime();
    const dateRange = maxDate - minDate || 1;

    let closest = -1;
    let closestDist = Infinity;
    for (let i = 0; i < snapshots.length; i++) {
      const x = padding.left + ((new Date(snapshots[i].date).getTime() - minDate) / dateRange) * chartW;
      const dist = Math.abs(x - mx);
      if (dist < closestDist) {
        closestDist = dist;
        closest = i;
      }
    }
    setHoveredIndex(closestDist < 30 ? closest : null);
  }, [snapshots]);

  const currentTier = snapshots.length > 0 ? snapshots[snapshots.length - 1].tier : '—';
  const currentScore = snapshots.length > 0 ? snapshots[snapshots.length - 1].score : 0;
  const startScore = snapshots.length > 0 ? snapshots[0].score : 0;
  const scoreDelta = currentScore - startScore;

  return (
    <div className="fixed inset-0 bg-[#050510] text-white">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#050510]/80 backdrop-blur-sm border-b border-white/5">
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-white/50 hover:text-white text-sm">
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
        <h1 className="text-sm font-bold flex items-center gap-2">
          <Clock className="w-4 h-4 text-cyan-400" />
          Time Warp
        </h1>
        <div className="flex items-center gap-3 text-xs">
          <span style={{ color: TIER_COLORS[currentTier] }}>{currentTier.replace('_', ' ').toUpperCase()}</span>
          <span className="font-mono font-bold">{currentScore}</span>
          {scoreDelta > 0 && (
            <span className="text-green-400 flex items-center gap-0.5">
              <TrendingUp className="w-3 h-3" />
              +{scoreDelta}
            </span>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-full">
          <Loader2 className="w-8 h-8 animate-spin text-white/20" />
        </div>
      ) : snapshots.length < 2 ? (
        <div className="flex flex-col items-center justify-center h-full text-white/20">
          <Clock className="w-12 h-12 mb-4 opacity-30" />
          <p>Not enough history data yet</p>
          <p className="text-xs mt-1">Scan your wallet a few times to see your timeline</p>
        </div>
      ) : (
        <canvas
          ref={canvasRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoveredIndex(null)}
          className="w-full cursor-crosshair"
        />
      )}
    </div>
  );
}
