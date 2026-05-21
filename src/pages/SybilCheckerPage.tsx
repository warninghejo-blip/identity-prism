import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { riskBand, verdictFromScore } from '@/lib/sybilVerdict';
import SiteHeader from '@/components/SiteHeader';
import './SybilCheckerPage.css';

const DEFAULT_WALLET = '2psA2ZHmj8miBjfSqQdjimMCSShVuc2v6yUpSLeLr4RN';
const TOTAL_CHECKS = 23;

type SignalSeverity = 'info' | 'warning' | 'danger';

interface SybilSignal {
  id?: string;
  name?: string;
  category?: 'behavioral' | 'financial' | 'network' | string;
  detected?: boolean;
  weight?: number;
  severity?: SignalSeverity | string;
  value?: string;
  description?: string;
}

interface SybilVerdict {
  key?: string;
  label?: string;
  summary?: string;
  confidence?: string;
  confidenceScore?: number;
  reasons?: string[];
}

interface SybilMetrics {
  walletAgeDays?: number;
  activeDaysCount?: number;
  activeDaysRatio?: number;
  tokenDiversityCount?: number;
  nftCount?: number;
  incomingVolume?: number;
  outgoingVolume?: number;
  incomingCount?: number;
  outgoingCount?: number;
  uniqueSenders?: number;
  uniqueRecipients?: number;
  flowRatio?: number;
  dustRatio?: number;
  uniquePrograms?: number;
  balance?: number;
  txCount?: number;
  clusterSimilarity?: number;
  counterpartyRatio?: number;
  burstRatio?: number;
  fundingChainDepth?: number;
  topFunderTxCount?: number;
  topFunderPct?: number;
  siblingCount?: number;
  siblingAddresses?: string[];
  topPrograms?: { programId?: string; name?: string | null; interactions?: number }[];
  dayBuckets?: Record<string, number> | number[];
}

interface SybilResult {
  riskScore?: number;
  riskLevel?: string;
  trustScore?: number;
  trustGrade?: string;
  signals?: SybilSignal[];
  metrics?: SybilMetrics;
  verdict?: SybilVerdict | null;
  primaryFundingSource?: FundingSource | string | null;
  fundingSources?: FundingSource[];
  timestamp?: string;
}

interface FundingSource {
  address?: string;
  label?: string | null;
  type?: string;
  totalSolReceived?: number;
  transactionCount?: number;
  percentage?: number;
}

interface FundingResponse {
  sources?: FundingSource[];
}

interface GraphNode {
  id: number;
  x: number;
  y: number;
  baseX: number;
  baseY: number;
  r: number;
  type: 'suspect' | 'flagged' | 'neutral' | 'verified';
  risk: number;
  age: number;
  addr: string;
  tx: number;
  hub?: boolean;
  label?: string;
  amt?: string;
  pct?: number;
  side?: 'in' | 'out';
  small?: boolean;
  cluster?: boolean;
}

interface GraphEdge {
  a: number;
  b: number;
  type: 'tx' | 'fund' | 'time';
  amt?: string;
  pct?: number;
  small?: boolean;
}

function getApiBase() {
  const envBase = (import.meta.env.VITE_HELIUS_PROXY_URL || import.meta.env.VITE_APP_BASE_URL || '').trim();
  if (envBase) return envBase.replace(/\/+$/, '');
  if (typeof window === 'undefined') return '';
  return window.location.origin;
}

function shortAddress(address?: string | null, head = 6, tail = 4) {
  if (!address) return 'unknown';
  if (address.length <= head + tail + 2) return address;
  return `${address.slice(0, head)}...${address.slice(-tail)}`;
}

function shortAddressGlyph(address?: string | null, head = 6, tail = 4) {
  if (!address) return 'unknown';
  if (address.length <= head + tail + 2) return address;
  return `${address.slice(0, head)}...${address.slice(-tail)}`;
}

function formatNumber(value?: number, digits = 0) {
  if (value == null || Number.isNaN(value)) return '0';
  return value.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function formatSol(value?: number) {
  if (value == null || Number.isNaN(value)) return '0.00';
  const digits = value >= 10 ? 1 : 2;
  return value.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function primaryFundingAsSource(source?: FundingSource | string | null): FundingSource | null {
  if (!source) return null;
  if (typeof source === 'string') return { address: source, label: null, type: 'wallet' };
  if (!source.address && !source.label) return null;
  return source;
}

function yearsFromDays(days?: number) {
  const d = Math.max(0, Number(days) || 0);
  if (d >= 365) return `${(d / 365).toFixed(1)}y`;
  return `${Math.round(d)}d`;
}

function severityLabel(riskLevel?: string, riskScore = 0) {
  const normalized = String(riskLevel || '').toLowerCase();
  if (normalized && normalized !== 'unknown') return normalized;
  return riskBand(riskScore).label.toLowerCase();
}

function normalizeSignal(signal: SybilSignal): Required<SybilSignal> {
  return {
    id: signal.id || signal.name || 'signal',
    name: signal.name || 'Signal',
    category: signal.category || 'network',
    detected: Boolean(signal.detected),
    weight: Number(signal.weight) || 0,
    severity: signal.severity || 'info',
    value: signal.value || '',
    description: signal.description || '',
  };
}

function signalById(signals: SybilSignal[], id: string) {
  return signals.map(normalizeSignal).find((signal) => signal.id === id);
}

function getFlagged(signals: SybilSignal[]) {
  return signals
    .map(normalizeSignal)
    .filter((signal) => signal.detected)
    .sort((a, b) => (b.weight || 0) - (a.weight || 0));
}

function categorySignals(signals: SybilSignal[], category: string, ids: string[]) {
  const normalized = signals.map(normalizeSignal);
  const picked = ids
    .map((id) => normalized.find((signal) => signal.id === id))
    .filter(Boolean) as Required<SybilSignal>[];
  const fallback = normalized.filter((signal) => signal.category === category && !picked.some((item) => item.id === signal.id));
  return [...picked, ...fallback].slice(0, category === 'network' ? 5 : 6);
}

function verdictCopy(data: SybilResult | null, flaggedCount: number) {
  const riskScore = Math.round(data?.riskScore ?? 0);
  const trustScore = Math.round(data?.trustScore ?? Math.max(0, 100 - riskScore));
  const label = verdictFromScore(riskScore);
  if (riskScore >= 80) {
    return {
      tag: `Verdict - ${label}`,
      title: `${label} - hard review recommended.`,
      summary:
        data?.verdict?.summary ||
        `${flaggedCount} active risk signals crossed the threshold. Funding and behavior patterns need manual review.`,
    };
  }
  if (riskScore >= 20 || flaggedCount >= 3) {
    return {
      tag: `Verdict - ${label}`,
      title: `${label} - ${flaggedCount} flag${flaggedCount === 1 ? '' : 's'} worth review.`,
      summary:
        data?.verdict?.summary ||
        `Trust ${trustScore}/100 with ${flaggedCount} flagged checks. Evidence is not strong enough for a hard sybil call.`,
    };
  }
  return {
    tag: `Verdict - ${label}`,
    title: flaggedCount > 0 ? `${label} - ${flaggedCount} soft signal${flaggedCount === 1 ? '' : 's'}.` : `${label} - no active flags.`,
    summary:
      data?.verdict?.summary ||
      'On-chain history, funding graph, and behavior signals do not show a sybil pattern for this wallet.',
  };
}

function buildGraphData(address: string, data: SybilResult | null, funding: FundingSource[]) {
  const metrics = data?.metrics || {};
  const riskScore = Math.round(data?.riskScore ?? 0);
  const walletAge = Math.round(metrics.walletAgeDays ?? 0);
  const txCount = Math.round(metrics.txCount ?? 0);
  const topPrograms = metrics.topPrograms || [];
  const siblings = metrics.siblingAddresses || [];
  const primarySource = primaryFundingAsSource(data?.primaryFundingSource);
  const sources = (funding.length > 0 ? funding : primarySource ? [primarySource] : []).slice(0, 5);
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const addNode = (node: Omit<GraphNode, 'id'>) => {
    const next = { ...node, id: nodes.length };
    nodes.push(next);
    return next;
  };

  const hub = addNode({
    x: 0,
    y: 0,
    baseX: 0,
    baseY: 0,
    r: 18,
    type: riskBand(riskScore).nodeType,
    risk: riskScore,
    age: walletAge,
    addr: shortAddressGlyph(address, 6, 4),
    tx: txCount,
    hub: true,
    label: 'YOUR WALLET',
  });

  sources.forEach((source, index) => {
    const risk = index === 0 && riskScore >= 20 ? Math.max(20, Math.min(78, riskScore + 20)) : Math.max(8, Math.min(60, riskScore + 16 - index * 8));
    const node = addNode({
      x: 0,
      y: 0,
      baseX: 0,
      baseY: 0,
      r: 7 + Math.max(0, Number(source.percentage) || 0) * 0.12,
      type: riskBand(risk).nodeType === 'suspect' ? 'suspect' : riskBand(risk).nodeType === 'flagged' ? 'flagged' : 'neutral',
      risk,
      age: Math.max(1, walletAge - index * 67),
      addr: source.label || shortAddressGlyph(source.address, 6, 4),
      tx: source.transactionCount || 0,
      amt: `${formatSol(source.totalSolReceived)} SOL`,
      pct: source.percentage || 0,
      side: 'in',
    });
    edges.push({ a: node.id, b: hub.id, type: 'fund', amt: node.amt, pct: node.pct });
  });

  topPrograms.slice(0, 4).forEach((program, index) => {
    const risk = index === 0 && riskScore >= 60 ? 78 : Math.max(20, riskScore + 10 - index * 5);
    const node = addNode({
      x: 0,
      y: 0,
      baseX: 0,
      baseY: 0,
      r: 7 + Math.min(12, (program.interactions || 0) / 20),
      type: riskBand(risk).nodeType === 'suspect' ? 'suspect' : riskBand(risk).nodeType === 'flagged' ? 'flagged' : 'neutral',
      risk,
      age: Math.max(30, walletAge),
      addr: program.name || shortAddressGlyph(program.programId, 6, 4),
      tx: program.interactions || 0,
      amt: `${program.interactions || 0} calls`,
      pct: Math.min(40, Math.max(8, program.interactions || 0)),
      label: 'Program interaction',
      side: 'out',
    });
    edges.push({ a: hub.id, b: node.id, type: 'tx', amt: node.amt, pct: node.pct });
  });

  siblings.slice(0, 8).forEach((sibling, index) => {
    const parentId = nodes.find((node) => node.side === 'out' && node.type === 'suspect')?.id ?? hub.id;
    const node = addNode({
      x: 0,
      y: 0,
      baseX: 0,
      baseY: 0,
      r: 2.8,
      type: riskBand(riskScore).nodeType === 'suspect' ? 'suspect' : 'flagged',
      risk: Math.max(30, Math.min(92, riskScore + 10)),
      age: Math.max(1, walletAge - index * 4),
      addr: shortAddressGlyph(sibling, 4, 4),
      tx: 0,
      small: true,
      cluster: true,
    });
    edges.push({ a: parentId, b: node.id, type: 'time', small: true });
  });

  return { nodes, edges };
}

function AmbientCanvas() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let frame = 0;
    let stars: { x: number; y: number; r: number; a: number }[] = [];

    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * ratio;
      canvas.height = window.innerHeight * ratio;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(ratio, ratio);
      stars = Array.from({ length: 180 }, () => ({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        r: Math.random() * 1.2 + 0.2,
        a: Math.random(),
      }));
    };

    const tick = () => {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      const gradient = ctx.createRadialGradient(
        window.innerWidth * 0.2,
        window.innerHeight * 0.3,
        0,
        window.innerWidth * 0.2,
        window.innerHeight * 0.3,
        window.innerWidth * 0.55,
      );
      gradient.addColorStop(0, 'rgba(80,40,120,.05)');
      gradient.addColorStop(1, 'transparent');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
      stars.forEach((star) => {
        star.a += (Math.random() - 0.5) * 0.03;
        star.a = Math.max(0.1, Math.min(1, star.a));
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${star.a})`;
        ctx.fill();
      });
      frame = window.requestAnimationFrame(tick);
    };

    resize();
    window.addEventListener('resize', resize);
    tick();
    return () => {
      window.removeEventListener('resize', resize);
      window.cancelAnimationFrame(frame);
    };
  }, []);

  return <canvas className="sybil-bg-canvas" ref={ref} aria-hidden="true" />;
}

function ClusterGraph({ address, data, funding }: { address: string; data: SybilResult | null; funding: FundingSource[] }) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [viewMode, setViewMode] = useState<'force' | 'radial' | 'time'>('force');
  const [filterType, setFilterType] = useState({ suspect: true, flagged: true, neutral: true, verified: true, hub: true });
  const [filterEdge, setFilterEdge] = useState({ tx: true, fund: true, time: false });
  const [riskFilter, setRiskFilter] = useState(30);
  const [ageFilter, setAgeFilter] = useState(0);
  const [depth, setDepth] = useState(3);
  const [display, setDisplay] = useState({ motion: true, labels: true, packets: true, grid: false });
  const [counts, setCounts] = useState({ nodes: 0, edges: 0 });
  const graphData = useMemo(() => buildGraphData(address, data, funding), [address, data, funding]);
  const stateRef = useRef({ zoom: 1, panX: 0, panY: 0, dragging: false, sx: 0, sy: 0, ox: 0, oy: 0 });

  useEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    const tooltip = tooltipRef.current;
    const ctx = canvas?.getContext('2d');
    if (!stage || !canvas || !ctx || !tooltip) return;

    let W = 0;
    let H = 0;
    let frame = 0;
    let t = 0;
    let hovered: GraphNode | null = null;
    let nodes: GraphNode[] = [];
    let edges: GraphEdge[] = [];
    const edgeFilters = filterEdge;
    const typeFilters = filterType;

    const layout = () => {
      nodes = graphData.nodes.map((node) => ({ ...node }));
      edges = graphData.edges.map((edge) => ({ ...edge }));
      const hub = nodes.find((node) => node.hub);
      if (!hub) return;
      const colL = W * 0.16;
      const colC = W * 0.5;
      const colR = W * 0.84;
      hub.x = colC;
      hub.y = H * 0.5;
      hub.baseX = hub.x;
      hub.baseY = hub.y;
      const inSet = nodes.filter((node) => node.side === 'in');
      const outSet = nodes.filter((node) => node.side === 'out');
      const smallSet = nodes.filter((node) => node.small);
      const lineHeight = Math.max(1, H - 60);
      inSet.forEach((node, index) => {
        node.x = colL;
        node.y = 50 + (lineHeight / Math.max(1, inSet.length - 1 || 1)) * index;
        node.baseX = node.x;
        node.baseY = node.y;
      });
      outSet.forEach((node, index) => {
        node.x = colR;
        node.y = 58 + (lineHeight / Math.max(1, outSet.length - 1 || 1)) * index;
        node.baseX = node.x;
        node.baseY = node.y;
      });
      const clusterParent = outSet.find((node) => node.type === 'suspect') || outSet[0] || hub;
      smallSet.forEach((node, index) => {
        const angle = -Math.PI / 2 + (index / Math.max(1, smallSet.length)) * Math.PI * 2;
        const d = 28;
        node.x = clusterParent.x + Math.cos(angle) * d;
        node.y = clusterParent.y + Math.sin(angle) * d;
        node.baseX = node.x;
        node.baseY = node.y;
      });
      if (viewMode === 'radial') {
        const R = Math.min(W, H) * 0.32;
        inSet.forEach((node, index) => {
          const angle = Math.PI + (-0.45 + (inSet.length > 1 ? index / (inSet.length - 1) : 0.5) * 0.9);
          node.x = hub.x + Math.cos(angle) * R;
          node.y = hub.y + Math.sin(angle) * R;
        });
        outSet.forEach((node, index) => {
          const angle = -0.55 + (outSet.length > 1 ? index / (outSet.length - 1) : 0.5) * 1.1;
          node.x = hub.x + Math.cos(angle) * R;
          node.y = hub.y + Math.sin(angle) * R;
        });
      }
      if (viewMode === 'time') {
        const all = nodes.filter((node) => !node.hub && !node.small);
        const ages = all.map((node) => node.age);
        const minAge = Math.min(...ages, 0);
        const maxAge = Math.max(...ages, 1);
        const pad = 80;
        all.forEach((node, index) => {
          const norm = maxAge === minAge ? 0.5 : (node.age - minAge) / (maxAge - minAge);
          node.x = pad + (W - pad * 2) * norm;
          node.y = (node.side === 'in' ? H * 0.34 : H * 0.62) + (index % 2 === 0 ? -8 : 8);
        });
        hub.x = W * 0.5;
        hub.y = H * 0.12;
      }
    };

    const resize = () => {
      const rect = stage.getBoundingClientRect();
      W = rect.width;
      H = rect.height;
      canvas.width = W * 2;
      canvas.height = H * 2;
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(2, 2);
      layout();
    };

    const color = (node: GraphNode, alpha = 1) => {
      if (node.hub) return `rgba(34,211,238,${alpha})`;
      if (node.type === 'suspect') return `rgba(248,113,113,${alpha})`;
      if (node.type === 'flagged') return `rgba(251,146,60,${alpha})`;
      if (node.type === 'verified') return `rgba(52,211,153,${alpha})`;
      return `rgba(167,139,250,${alpha})`;
    };

    const passesFilter = (node: GraphNode) => {
      if (node.hub) return typeFilters.hub;
      if (!typeFilters[node.type]) return false;
      if (node.risk < riskFilter) return false;
      if (node.age < ageFilter) return false;
      return true;
    };

    const edgeColor = (edge: GraphEdge) => {
      if (edge.type === 'fund') return 'rgba(248,113,113,';
      if (edge.type === 'time') return 'rgba(167,139,250,';
      return 'rgba(255,255,255,';
    };

    const curve = (a: GraphNode, b: GraphNode, edge: GraphEdge) => {
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const amount = edge.type === 'time' ? 0.18 : edge.type === 'fund' ? 0.1 : 0.08;
      return { cx: mx + nx * amount * len, cy: my + ny * amount * len };
    };

    const bezPt = (a: GraphNode, b: GraphNode, c: { cx: number; cy: number }, p: number) => {
      const u = 1 - p;
      return { x: u * u * a.x + 2 * u * p * c.cx + p * p * b.x, y: u * u * a.y + 2 * u * p * c.cy + p * p * b.y };
    };

    const bezDir = (a: GraphNode, b: GraphNode, c: { cx: number; cy: number }, p: number) => {
      const x = 2 * (1 - p) * (c.cx - a.x) + 2 * p * (b.x - c.cx);
      const y = 2 * (1 - p) * (c.cy - a.y) + 2 * p * (b.y - c.cy);
      return Math.atan2(y, x);
    };

    const drawArrow = (x: number, y: number, angle: number, fill: string, size: number) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-size, -size * 0.55);
      ctx.lineTo(-size, size * 0.55);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };

    const roundedRect = (x: number, y: number, w: number, h: number, r: number) => {
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
      else ctx.rect(x, y, w, h);
    };

    const tick = () => {
      const st = stateRef.current;
      ctx.save();
      ctx.clearRect(0, 0, W, H);
      if (display.motion) t += 1;
      ctx.translate(W / 2 + st.panX, H / 2 + st.panY);
      ctx.scale(st.zoom, st.zoom);
      ctx.translate(-W / 2, -H / 2);

      if (display.grid) {
        for (let gy = 0; gy < H; gy += 36) {
          for (let gx = 0; gx < W; gx += 36) {
            let heat = 0;
            nodes.forEach((node) => {
              if (!passesFilter(node)) return;
              const dx = gx + 18 - node.x;
              const dy = gy + 18 - node.y;
              heat += (node.risk / 100) / (1 + (dx * dx + dy * dy) / 2400);
            });
            if (heat < 0.05) continue;
            ctx.fillStyle = `rgba(248,113,113,${Math.min(0.35, heat * 0.22)})`;
            ctx.fillRect(gx, gy, 35, 35);
          }
        }
      }

      ctx.fillStyle = 'rgba(255,255,255,.32)';
      ctx.font = '700 10px Orbitron,monospace';
      ctx.textAlign = 'left';
      ctx.fillText('< FUNDING IN', W * 0.16 - 32, 22);
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(34,211,238,.6)';
      ctx.fillText('TARGET WALLET', W * 0.5, 22);
      ctx.fillStyle = 'rgba(255,255,255,.32)';
      ctx.textAlign = 'right';
      ctx.fillText('OUTGOING >', W * 0.84 + 32, 22);
      ctx.setLineDash([2, 4]);
      ctx.strokeStyle = 'rgba(255,255,255,.06)';
      [W * 0.16, W * 0.5, W * 0.84].forEach((x) => {
        ctx.beginPath();
        ctx.moveTo(x, 38);
        ctx.lineTo(x, H - 26);
        ctx.stroke();
      });
      ctx.setLineDash([]);

      edges.forEach((edge) => {
        if (!edgeFilters[edge.type]) return;
        const a = nodes[edge.a];
        const b = nodes[edge.b];
        if (!a || !b || !passesFilter(a) || !passesFilter(b)) return;
        const cp = curve(a, b, edge);
        const col = edgeColor(edge);
        const baseAlpha = edge.small ? 0.15 : edge.type === 'fund' ? 0.55 : edge.type === 'tx' ? 0.35 : 0.45;
        if (!edge.small) {
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.quadraticCurveTo(cp.cx, cp.cy, b.x, b.y);
          ctx.strokeStyle = `${col}${baseAlpha * 0.25})`;
          ctx.lineWidth = edge.pct ? Math.max(4, edge.pct * 0.4) : 4;
          ctx.stroke();
        }
        const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
        grad.addColorStop(0, `${col}${baseAlpha * 0.4})`);
        grad.addColorStop(0.5, `${col}${baseAlpha})`);
        grad.addColorStop(1, `${col}${baseAlpha * 0.4})`);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(cp.cx, cp.cy, b.x, b.y);
        ctx.strokeStyle = grad;
        ctx.lineWidth = edge.small ? 0.6 : edge.pct ? Math.max(1.2, edge.pct * 0.08) : 1.4;
        if (edge.type === 'fund') {
          ctx.setLineDash([6, 6]);
          ctx.lineDashOffset = -t * 0.6;
        } else if (edge.type === 'time') {
          ctx.setLineDash([2, 4]);
          ctx.lineDashOffset = -t * 0.3;
        }
        ctx.stroke();
        ctx.setLineDash([]);
        if (!edge.small) {
          const arrow = bezPt(a, b, cp, 0.94);
          drawArrow(arrow.x, arrow.y, bezDir(a, b, cp, 0.94), `${col}.95)`, 7);
        }
        if (!edge.small && edge.amt && display.labels) {
          const p = bezPt(a, b, cp, 0.5);
          const label = `${edge.amt}${edge.pct ? `  -  ${edge.pct}%` : ''}`;
          ctx.font = '600 10px "JetBrains Mono",monospace';
          const width = ctx.measureText(label).width + 14;
          ctx.fillStyle = 'rgba(8,6,16,.92)';
          ctx.strokeStyle = `${col}.5)`;
          ctx.lineWidth = 1;
          roundedRect(p.x - width / 2, p.y - 9, width, 18, 6);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#fff';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(label, p.x, p.y);
          ctx.textBaseline = 'alphabetic';
        }
        if (display.packets && display.motion && !edge.small) {
          const seed = (edge.a * 131 + edge.b * 977) % 1000;
          for (let i = 0; i < 3; i += 1) {
            const pct = ((t * (edge.type === 'fund' ? 0.7 : 0.55) + seed + i * 330) % 330) / 330;
            const xy = bezPt(a, b, cp, pct);
            ctx.beginPath();
            ctx.arc(xy.x, xy.y, 2.7, 0, Math.PI * 2);
            ctx.fillStyle = `${col}1)`;
            ctx.shadowColor = `${col}1)`;
            ctx.shadowBlur = 10;
            ctx.fill();
            ctx.shadowBlur = 0;
          }
        }
      });

      const hub = nodes.find((node) => node.hub);
      if (hub && display.motion) {
        const pulse = 24 + (t * 0.4) % 56;
        ctx.beginPath();
        ctx.arc(hub.x, hub.y, pulse, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(34,211,238,${Math.max(0, 1 - (pulse - 24) / 56) * 0.55})`;
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }

      nodes.forEach((node) => {
        if (!passesFilter(node)) return;
        const isHover = hovered === node;
        const gR = node.hub ? 60 : node.r * 3.4;
        const glow = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, gR);
        glow.addColorStop(0, color(node, 0.55));
        glow.addColorStop(1, 'transparent');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(node.x, node.y, gR, 0, Math.PI * 2);
        ctx.fill();
        if (node.hub) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, node.r + 8, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(34,211,238,.5)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        ctx.fillStyle = color(node, 0.97);
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = color(node, 0.95);
        ctx.lineWidth = isHover ? 2 : 1.2;
        ctx.stroke();
        if (isHover) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, node.r + 6, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(255,255,255,.55)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        if (display.labels && !node.small) {
          if (node.hub) {
            ctx.fillStyle = '#fff';
            ctx.font = '800 11px Orbitron,monospace';
            ctx.textAlign = 'center';
            ctx.fillText(`YOU - ${node.addr}`, node.x, node.y - node.r - 12);
            ctx.fillStyle = 'rgba(34,211,238,.7)';
            ctx.font = '600 9px "JetBrains Mono",monospace';
            ctx.fillText(`risk ${node.risk}/100`, node.x, node.y + node.r + 16);
          } else {
            ctx.fillStyle = 'rgba(255,255,255,.85)';
            ctx.font = '600 10px "JetBrains Mono",monospace';
            ctx.textAlign = node.side === 'in' ? 'right' : 'left';
            const px = node.side === 'in' ? node.x - node.r - 8 : node.x + node.r + 8;
            ctx.fillText(node.addr, px, node.y + 3);
            if (node.label) {
              ctx.fillStyle = color(node, 0.7);
              ctx.font = '500 9px "Space Grotesk",sans-serif';
              ctx.fillText(node.label, px, node.y + 17);
            }
          }
        }
      });

      ctx.restore();
      frame = window.requestAnimationFrame(tick);
    };

    const updateTooltip = (event: MouseEvent) => {
      const rect = stage.getBoundingClientRect();
      const st = stateRef.current;
      const mx = (event.clientX - rect.left - W / 2 - st.panX) / st.zoom + W / 2;
      const my = (event.clientY - rect.top - H / 2 - st.panY) / st.zoom + H / 2;
      let found: GraphNode | null = null;
      for (const node of nodes) {
        if (!passesFilter(node)) continue;
        const dx = node.x - mx;
        const dy = node.y - my;
        if (dx * dx + dy * dy < (node.r + 4) * (node.r + 4)) {
          found = node;
          break;
        }
      }
      hovered = found;
      if (!found) {
        tooltip.classList.remove('show');
        return;
      }
      tooltip.classList.add('show');
      tooltip.style.left = `${found.x}px`;
      tooltip.style.top = `${found.y}px`;
      const badgeColor = found.hub ? '#67e8f9' : found.type === 'suspect' ? '#fca5a5' : found.type === 'flagged' ? '#fdba74' : found.type === 'verified' ? '#6ee7b7' : '#c4b5fd';
      const badgeBg = found.hub ? 'rgba(34,211,238,.16)' : found.type === 'suspect' ? 'rgba(248,113,113,.16)' : found.type === 'flagged' ? 'rgba(251,146,60,.16)' : found.type === 'verified' ? 'rgba(52,211,153,.16)' : 'rgba(167,139,250,.16)';
      const fillCol = found.risk >= 70 ? 'linear-gradient(90deg,#dc2626,#f87171)' : found.risk >= 30 ? 'linear-gradient(90deg,#ea580c,#fb923c)' : 'linear-gradient(90deg,#059669,#34d399)';
      tooltip.innerHTML = `
        <div class="tt-head"><span class="addr">${found.addr}</span><span class="badge" style="background:${badgeBg};color:${badgeColor}">${found.hub ? 'Hub - You' : found.type}</span></div>
        <div class="tt-row"><span>Risk score</span><span>${found.risk}/100</span></div>
        <div class="tt-row"><span>Wallet age</span><span>${found.age} days</span></div>
        <div class="tt-row"><span>Tx count</span><span>${found.tx}</span></div>
        <div class="tt-bar"><div class="fill" style="width:${found.risk}%;background:${fillCol}"></div></div>`;
    };

    const startDrag = (event: MouseEvent) => {
      if (hovered) return;
      const st = stateRef.current;
      st.dragging = true;
      st.sx = event.clientX;
      st.sy = event.clientY;
      st.ox = st.panX;
      st.oy = st.panY;
      stage.style.cursor = 'grabbing';
    };
    const stopDrag = () => {
      stateRef.current.dragging = false;
      stage.style.cursor = '';
    };
    const moveDrag = (event: MouseEvent) => {
      const st = stateRef.current;
      if (!st.dragging) return;
      st.panX = st.ox + event.clientX - st.sx;
      st.panY = st.oy + event.clientY - st.sy;
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const d = event.deltaY < 0 ? 1.1 : 0.9;
      stateRef.current.zoom = Math.max(0.5, Math.min(2.4, stateRef.current.zoom * d));
    };

    const countVisible = () => {
      const visible = nodes.filter(passesFilter).length;
      const suspectEdges = edges.filter((edge) => {
        const a = nodes[edge.a];
        const b = nodes[edge.b];
        return a && b && passesFilter(a) && passesFilter(b) && edgeFilters[edge.type] && (edge.type === 'fund' || edge.type === 'time');
      }).length;
      setCounts({ nodes: visible, edges: suspectEdges });
    };

    resize();
    countVisible();
    stage.addEventListener('mousemove', updateTooltip);
    stage.addEventListener('mouseleave', () => {
      hovered = null;
      tooltip.classList.remove('show');
    });
    stage.addEventListener('mousedown', startDrag);
    stage.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('mouseup', stopDrag);
    window.addEventListener('mousemove', moveDrag);
    window.addEventListener('resize', resize);
    tick();
    return () => {
      window.cancelAnimationFrame(frame);
      stage.removeEventListener('mousemove', updateTooltip);
      stage.removeEventListener('mousedown', startDrag);
      stage.removeEventListener('wheel', wheel);
      window.removeEventListener('mouseup', stopDrag);
      window.removeEventListener('mousemove', moveDrag);
      window.removeEventListener('resize', resize);
    };
  }, [address, data, funding, graphData, viewMode, filterType, filterEdge, riskFilter, ageFilter, display]);

  const visibleTypeCount = Object.values(filterType).filter(Boolean).length;
  const riskScore = Math.round(data?.riskScore ?? 0);

  const toggleType = (key: keyof typeof filterType) => setFilterType((prev) => ({ ...prev, [key]: !prev[key] }));
  const toggleEdge = (key: keyof typeof filterEdge) => setFilterEdge((prev) => ({ ...prev, [key]: !prev[key] }));
  const toggleDisplay = (key: keyof typeof display) => setDisplay((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <>
      <aside className="sidebar">
        <h3>Filters</h3>
        <p>Refine the cluster graph by node type, edge type, and detection thresholds.</p>

        <div className="filter-block">
          <div className="filter-label">Node Type <b>{visibleTypeCount}/5</b></div>
          <div className="chip-row">
            <button type="button" className={`chip red ${filterType.suspect ? 'on' : ''}`} onClick={() => toggleType('suspect')}>Suspect</button>
            <button type="button" className={`chip yl ${filterType.flagged ? 'on' : ''}`} onClick={() => toggleType('flagged')}>Flagged</button>
            <button type="button" className={`chip pu ${filterType.neutral ? 'on' : ''}`} onClick={() => toggleType('neutral')}>Neutral</button>
            <button type="button" className={`chip gn ${filterType.verified ? 'on' : ''}`} onClick={() => toggleType('verified')}>Verified</button>
            <button type="button" className={`chip ${filterType.hub ? 'on' : ''}`} onClick={() => toggleType('hub')}>Hubs</button>
          </div>
        </div>

        <div className="filter-block">
          <div className="filter-label">Edge Type</div>
          <div className="chip-row">
            <button type="button" className={`chip ${filterEdge.tx ? 'on' : ''}`} onClick={() => toggleEdge('tx')}>Transactions</button>
            <button type="button" className={`chip red ${filterEdge.fund ? 'on' : ''}`} onClick={() => toggleEdge('fund')}>Shared Funding</button>
            <button type="button" className={`chip pu ${filterEdge.time ? 'on' : ''}`} onClick={() => toggleEdge('time')}>Timing Match</button>
          </div>
        </div>

        <div className="filter-block">
          <label className="filter-label" htmlFor="risk-slider">Risk Threshold <b>≥ {riskFilter}</b></label>
          <div className="slider-wrap">
            <input id="risk-slider" type="range" min="0" max="100" value={riskFilter} onChange={(event) => setRiskFilter(Number(event.target.value))} />
            <div className="slider-tick"><span>0</span><span>50</span><span>100</span></div>
          </div>
        </div>

        <div className="filter-block">
          <label className="filter-label" htmlFor="depth-slider">Cluster Depth <b>{depth} hop{depth > 1 ? 's' : ''}</b></label>
          <div className="slider-wrap">
            <input id="depth-slider" type="range" min="1" max="5" value={depth} onChange={(event) => setDepth(Number(event.target.value))} />
            <div className="slider-tick"><span>1</span><span>3</span><span>5</span></div>
          </div>
        </div>

        <div className="filter-block">
          <label className="filter-label" htmlFor="age-slider">Min Wallet Age <b>{ageFilter} days</b></label>
          <div className="slider-wrap">
            <input id="age-slider" type="range" min="0" max="730" value={ageFilter} onChange={(event) => setAgeFilter(Number(event.target.value))} />
            <div className="slider-tick"><span>0</span><span>1y</span><span>2y</span></div>
          </div>
        </div>

        <div className="filter-block">
          <div className="filter-label">Display</div>
          {(['motion', 'labels', 'packets', 'grid'] as const).map((key) => (
            <button type="button" key={key} className={`toggle-row ${display[key] ? 'on' : ''}`} onClick={() => toggleDisplay(key)} aria-pressed={display[key]}>
              <span>{key === 'motion' ? 'Live motion' : key === 'labels' ? 'Address labels' : key === 'packets' ? 'Data packets' : 'Heatmap overlay'}</span>
              <span className="sw" aria-hidden="true" />
            </button>
          ))}
        </div>
      </aside>

      <div className="graph-card">
        <div className="graph-head">
          <div className="graph-title">
            <div className="ico">
              <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><circle cx="6" cy="6" r="2" /><circle cx="18" cy="6" r="2" /><circle cx="6" cy="18" r="2" /><circle cx="18" cy="18" r="2" /><path d="M12 12L6 6M12 12l6-6M12 12L6 18M12 12l6 6" /></svg>
            </div>
            <div>
              <h2>Cluster Graph</h2>
              <div className="sub">{shortAddressGlyph(address, 6, 6)} - depth {depth} - {counts.nodes} nodes</div>
            </div>
          </div>
          <div className="graph-tabs">
            {(['force', 'radial', 'time'] as const).map((mode) => (
              <button type="button" key={mode} className={`gtab ${viewMode === mode ? 'on' : ''}`} onClick={() => setViewMode(mode)}>
                {mode === 'time' ? 'Timeline' : mode[0].toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="graph-stage" ref={stageRef}>
          <canvas ref={canvasRef} aria-label="Sybil cluster graph" />
          <div className="stage-ctl">
            <button type="button" title="Zoom in" onClick={() => { stateRef.current.zoom = Math.min(2.4, stateRef.current.zoom * 1.2); }}>+</button>
            <button type="button" title="Zoom out" onClick={() => { stateRef.current.zoom = Math.max(0.5, stateRef.current.zoom / 1.2); }}>-</button>
            <button type="button" title="Reset" onClick={() => { stateRef.current.zoom = 1; stateRef.current.panX = 0; stateRef.current.panY = 0; }}>R</button>
          </div>

          <div className="graph-readout">
            <span className="k">Cluster Risk</span>
            <span className={`v ${riskBand(riskScore).color}`}>{riskScore} / 100 - {riskBand(riskScore).label}</span>
            <span className="k">Nodes in Frame</span>
            <span className="v">{counts.nodes}</span>
            <span className="k">Suspect Edges</span>
            <span className={`v ${counts.edges > 0 ? 'yl' : 'gn'}`}>{counts.edges}</span>
          </div>

          <div className="graph-legend">
            <div className="lg-row"><div className="lg-dot hub" />Hub node (target wallet)</div>
            <div className="lg-row"><div className="lg-dot suspect" />Suspect (risk ≥ 60)</div>
            <div className="lg-row"><div className="lg-dot flagged" />Flagged (risk 20-60)</div>
            <div className="lg-row"><div className="lg-dot neutral" />Neutral (unscored)</div>
            <div className="lg-row"><div className="lg-dot verified" />Verified human</div>
            <div className="lg-row"><div className="lg-line l-tx" />Transaction edge</div>
            <div className="lg-row"><div className="lg-line l-fund" />Shared funding source</div>
          </div>

          <div className="tooltip" ref={tooltipRef} />
        </div>
      </div>
    </>
  );
}

function CheckIcon() {
  return <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg>;
}

function WarnIcon() {
  return <svg viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>;
}

function CheckRow({ signal }: { signal: Required<SybilSignal> }) {
  return (
    <div className="check-row">
      <div className={`ci ${signal.detected ? 'warn' : 'ok'}`}>{signal.detected ? <WarnIcon /> : <CheckIcon />}</div>
      <div className="cm">
        <b>{signal.name}</b>
        <span>{signal.description || signal.value}</span>
      </div>
      <div className={`cs ${signal.detected ? 'flag' : 'ok'}`}>{signal.detected ? `+${signal.weight}` : 'ok'}</div>
    </div>
  );
}

function Radar({ metrics }: { metrics?: SybilMetrics }) {
  const age = Math.min(1, (metrics?.walletAgeDays || 0) / 1460);
  const defi = Math.min(1, (metrics?.uniquePrograms || 0) / 30);
  const diversity = Math.min(1, ((metrics?.tokenDiversityCount || 0) + (metrics?.nftCount || 0)) / 120);
  const activity = Math.min(1, (metrics?.activeDaysRatio || 0) * 10);
  const flow = Math.max(0, 1 - Math.abs((metrics?.flowRatio || 50) - 50) / 50);
  const values = [age, defi, diversity, activity, flow].map((v) => 22 + Math.max(0.08, v) * 58);
  const angles = [-Math.PI / 2, -Math.PI / 2 + (2 * Math.PI) / 5, -Math.PI / 2 + (4 * Math.PI) / 5, -Math.PI / 2 + (6 * Math.PI) / 5, -Math.PI / 2 + (8 * Math.PI) / 5];
  const points = angles.map((angle, idx) => `${100 + Math.cos(angle) * values[idx]},${100 + Math.sin(angle) * values[idx]}`).join(' ');
  const dots = angles.map((angle, idx) => ({ x: 100 + Math.cos(angle) * values[idx], y: 100 + Math.sin(angle) * values[idx] }));
  return (
    <div className="radar">
      <svg viewBox="0 0 200 200">
        <g fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="1">
          <polygon points="100,18 178,62 158,148 42,148 22,62" />
          <polygon points="100,38 162,72 146,140 54,140 38,72" />
          <polygon points="100,58 146,82 132,128 68,128 54,82" />
          <polygon points="100,78 130,92 120,116 80,116 70,92" />
        </g>
        <g stroke="rgba(255,255,255,.08)" strokeWidth="1">
          <line x1="100" y1="100" x2="100" y2="18" />
          <line x1="100" y1="100" x2="178" y2="62" />
          <line x1="100" y1="100" x2="158" y2="148" />
          <line x1="100" y1="100" x2="42" y2="148" />
          <line x1="100" y1="100" x2="22" y2="62" />
        </g>
        <polygon points={points} fill="rgba(52,211,153,.25)" stroke="#34d399" strokeWidth="2" style={{ filter: 'drop-shadow(0 0 6px rgba(52,211,153,.5))' }} />
        <g fill="#34d399" style={{ filter: 'drop-shadow(0 0 4px #34d399)' }}>
          {dots.map((dot, idx) => <circle key={idx} cx={dot.x} cy={dot.y} r="3" />)}
        </g>
        <g fill="rgba(255,255,255,.55)" fontFamily="Orbitron,sans-serif" fontSize="9" fontWeight="700" letterSpacing="1">
          <text x="100" y="11" textAnchor="middle">AGE</text>
          <text x="185" y="64" textAnchor="middle">DeFi</text>
          <text x="170" y="162" textAnchor="middle">DIVERSITY</text>
          <text x="32" y="162" textAnchor="middle">ACTIVITY</text>
          <text x="15" y="64" textAnchor="middle">FLOW</text>
        </g>
      </svg>
    </div>
  );
}

function Heatmap({ metrics }: { metrics?: SybilMetrics }) {
  const buckets = metrics?.dayBuckets;
  const heights = useMemo(() => {
    const buckets = metrics?.dayBuckets;
    if (Array.isArray(buckets) && buckets.length > 0) return buckets.slice(-30).map((value) => Math.max(5, Math.min(95, Number(value) * 8)));
    if (buckets && typeof buckets === 'object') {
      return Object.values(buckets).slice(-30).map((value) => Math.max(5, Math.min(95, Number(value) * 8)));
    }
    return [];
  }, [metrics]);
  if (heights.length === 0 || !buckets) return null;
  const activePct = Math.round((metrics?.activeDaysRatio || 0) * 100);
  return (
    <div className="heat">
      <div className="heat-head">
        <div className="l"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>Activity Heatmap - 30 days</div>
        <div className="mono-muted">{activePct}% active days</div>
      </div>
      <div className="heat-bars">
        {heights.map((height, idx) => (
          <div key={idx} className="heat-bar" style={{ height: `${height}%` }} title={`${Math.round(height)}% - day ${idx + 1}`} />
        ))}
      </div>
    </div>
  );
}

export default function SybilCheckerPage() {
  const initialAddress = useMemo(() => {
    if (typeof window === 'undefined') return DEFAULT_WALLET;
    return new URLSearchParams(window.location.search).get('address') || DEFAULT_WALLET;
  }, []);
  const [input, setInput] = useState(initialAddress);
  const [address, setAddress] = useState(initialAddress);
  const [data, setData] = useState<SybilResult | null>(null);
  const [funding, setFunding] = useState<FundingSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadWallet = useCallback(async (wallet: string) => {
    const next = wallet.trim();
    if (!next) return;
    setLoading(true);
    setError('');
    try {
      const base = getApiBase();
      const analysisRes = await fetch(`${base}/api/sybil/analysis?address=${encodeURIComponent(next)}`, {
        headers: { Accept: 'application/json' },
      });
      if (!analysisRes.ok) {
        const body = await analysisRes.json().catch(() => null);
        throw new Error(body?.error || `API ${analysisRes.status}`);
      }
      const analysis = (await analysisRes.json()) as SybilResult;
      let sources = Array.isArray(analysis.fundingSources) ? analysis.fundingSources : [];
      if (sources.length === 0) {
        const fundingRes = await fetch(`${base}/api/sybil/funding-sources?address=${encodeURIComponent(next)}`, {
          headers: { Accept: 'application/json' },
        }).catch(() => null);
        if (fundingRes?.ok) {
          const body = (await fundingRes.json()) as FundingResponse;
          sources = body.sources || [];
        }
      }
      if (sources.length === 0) {
        const primary = primaryFundingAsSource(analysis.primaryFundingSource);
        if (primary) sources = [primary];
      }
      setAddress(next);
      setInput(next);
      setData(analysis);
      setFunding(sources);
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        url.searchParams.set('address', next);
        window.history.replaceState(null, '', url);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sybil analysis');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWallet(initialAddress);
  }, [initialAddress, loadWallet]);

  const metrics = data?.metrics || {};
  const riskScore = Math.round(data?.riskScore ?? 0);
  const trustScore = Math.round(data?.trustScore ?? Math.max(0, 100 - riskScore));
  const trustGrade = data?.trustGrade || (trustScore >= 90 ? 'A+' : trustScore >= 80 ? 'A' : trustScore >= 70 ? 'B' : trustScore >= 60 ? 'C' : trustScore >= 50 ? 'D' : 'F');
  const flagged = getFlagged(data?.signals || []);
  const flaggedCount = flagged.length;
  const verdict = verdictCopy(data, flaggedCount);
  const severity = severityLabel(data?.riskLevel, riskScore);
  const band = riskBand(riskScore);
  const activeRatio = Math.round((metrics.activeDaysRatio || 0) * 100);
  const primarySource = typeof data?.primaryFundingSource === 'string'
    ? shortAddress(data.primaryFundingSource, 6, 4)
    : data?.primaryFundingSource?.label || shortAddress(data?.primaryFundingSource?.address, 6, 4);

  const breakdownRows = [
    {
      name: 'Cluster Membership',
      signal: signalById(data?.signals || [], 'cluster_similarity'),
      value: `${metrics.clusterSimilarity || 0} / 100`,
      width: metrics.clusterSimilarity || 0,
      good: (metrics.clusterSimilarity || 0) < 30,
      note: signalById(data?.signals || [], 'cluster_similarity')?.description || `Cluster similarity ${metrics.clusterSimilarity || 0}%`,
    },
    {
      name: 'Known Sybil Network',
      signal: signalById(data?.signals || [], 'known_sybil_network'),
      value: signalById(data?.signals || [], 'known_sybil_network')?.detected ? `+${signalById(data?.signals || [], 'known_sybil_network')?.weight || 0} risk` : 'clear',
      width: signalById(data?.signals || [], 'known_sybil_network')?.detected ? 45 : 0,
      good: !signalById(data?.signals || [], 'known_sybil_network')?.detected,
      note: signalById(data?.signals || [], 'known_sybil_network')?.description || 'No known sybil graph history matched this wallet',
    },
    {
      name: 'One-Directional Flow',
      signal: signalById(data?.signals || [], 'one_directional_flow'),
      value: signalById(data?.signals || [], 'one_directional_flow')?.detected ? `+${signalById(data?.signals || [], 'one_directional_flow')?.weight || 0} risk` : 'balanced',
      width: Math.min(100, metrics.flowRatio || 0),
      good: !signalById(data?.signals || [], 'one_directional_flow')?.detected,
      note: `In ${formatSol(metrics.incomingVolume)} SOL - Out ${formatSol(metrics.outgoingVolume)} SOL`,
    },
    {
      name: 'Low Activity Ratio',
      signal: signalById(data?.signals || [], 'low_activity_ratio'),
      value: signalById(data?.signals || [], 'low_activity_ratio')?.detected ? `+${signalById(data?.signals || [], 'low_activity_ratio')?.weight || 0} risk` : 'ok',
      width: Math.max(8, 100 - activeRatio),
      good: !signalById(data?.signals || [], 'low_activity_ratio')?.detected,
      note: `Active ${metrics.activeDaysCount || 0} / ${metrics.walletAgeDays || 0} days (${activeRatio}%)`,
    },
    {
      name: 'Wallet Age',
      signal: signalById(data?.signals || [], 'wallet_age'),
      value: (metrics.walletAgeDays || 0) >= 365 ? 'A+' : `${metrics.walletAgeDays || 0}d`,
      width: Math.min(100, ((metrics.walletAgeDays || 0) / 1460) * 100),
      good: (metrics.walletAgeDays || 0) >= 30,
      note: `${metrics.walletAgeDays || 0} days old - ${metrics.walletAgeDays && metrics.walletAgeDays > 365 ? 'strong longevity signal' : 'limited age signal'}`,
    },
  ];

  const checks = [
    { title: 'Behavioral', signals: categorySignals(data?.signals || [], 'behavioral', ['no_history', 'wallet_age', 'timing_pattern', 'low_activity_ratio', 'activity_burst', 'low_dapp_interaction']) },
    { title: 'Financial', signals: categorySignals(data?.signals || [], 'financial', ['low_token_diversity', 'no_nft_holdings', 'one_directional_flow', 'dust_transactions', 'drained_balance', 'rapid_sol_cycling']) },
    { title: 'Network', signals: categorySignals(data?.signals || [], 'network', ['cluster_similarity', 'temporal_cohort', 'counterparty_concentration', 'repeated_funder', 'known_sybil_network']) },
  ];

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void loadWallet(input);
  };

  return (
    <>
      <SiteHeader />
      <div className="sybil-check-page">
        <AmbientCanvas />

      <section className="intro">
        <div className="container">
          <div className="crumb"><a href="/">Home</a><span className="sep">/</span>Tools<span className="sep">/</span>Sybil Checker</div>
          <h1><span className="grad">Scan any wallet.</span> <span className="red">See the truth.</span></h1>
          <p>Paste a Solana address - Identity Prism analyzes on-chain history, transfer graph, funding sources, behavioral patterns, and cluster membership in real time.</p>
          <form className="scanbar" onSubmit={onSubmit}>
            <label className="sr-only" htmlFor="sybil-address">Solana wallet address</label>
            <input
              id="sybil-address"
              type="text"
              placeholder="Enter Solana wallet - 7xKXt...YpA3F - or .sol domain"
              value={input}
              autoComplete="off"
              onChange={(event) => setInput(event.target.value)}
            />
            <button className="scan-btn" type="submit" disabled={loading}>{loading ? 'Scanning...' : '+ Check Wallet'}</button>
          </form>
          {error && (
            <div className="error-banner" role="alert">
              <b>Could not load wallet intelligence.</b>
              <span>{error}</span>
              <button type="button" onClick={() => void loadWallet(address)}>Retry</button>
            </div>
          )}

          <div className="verdict-bar" aria-busy={loading}>
            <div className="v-grade">{loading ? '...' : trustGrade}</div>
            <div className="v-meta">
              <div className="v-tag">{loading ? 'Verdict - Loading' : verdict.tag}</div>
              <h2>{loading ? 'Analyzing live wallet intelligence...' : verdict.title}</h2>
              <div className="v-sub">
                {loading ? 'Fetching Identity Prism sybil analysis from the live API.' : verdict.summary}
                {!loading && primarySource !== 'unknown' && <span className="inline-mono"> Primary funding: {primarySource}</span>}
              </div>
            </div>
            <div className="v-stats">
              <div className="v-stat"><div className="k">Trust</div><div className="val g">{trustScore}/100</div></div>
              <div className="v-stat"><div className="k">Risk</div><div className={`val ${band.color}`}>{riskScore}/100</div></div>
              <div className="v-stat"><div className="k">Flags</div><div className={flaggedCount > 0 ? 'val y' : 'val g'}>{flaggedCount}/{TOTAL_CHECKS}</div></div>
              <div className="v-stat"><div className="k">Severity</div><div className={`val ${band.color}`}>{severity}</div></div>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="container result-wrap">
          <ClusterGraph address={address} data={data} funding={funding} />

          <div className="dossier">
            <div className="profile">
              <div className="prof-head">
                <div className="grade-ring">
                  <svg viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,.06)" strokeWidth="6" />
                    <circle cx="50" cy="50" r="42" fill="none" stroke="#34d399" strokeWidth="6" strokeLinecap="round" strokeDasharray="263" strokeDashoffset={263 - Math.round((trustScore / 100) * 263)} style={{ filter: 'drop-shadow(0 0 6px #34d399)' }} />
                  </svg>
                  <div className="lbl"><span className="g">{trustGrade}</span><span className="v">{trustScore}/100</span></div>
                </div>
                <div className="prof-meta">
                  <div className="prof-addr">
                    <span className="a">{shortAddressGlyph(address, 6, 4)}</span>
                    <button type="button" className="cp" title="Copy" onClick={() => navigator.clipboard?.writeText(address)}>Copy</button>
                  </div>
                  <div className="profile-caption">Wallet metrics from the live sybil analysis API</div>
                </div>
              </div>

              <div className="stat-grid">
                <div className="stat"><div className="k">Age</div><div className="v">{yearsFromDays(metrics.walletAgeDays)}</div></div>
                <div className="stat"><div className="k">TXNS</div><div className="v">{formatNumber(metrics.txCount)}</div></div>
                <div className="stat"><div className="k">Balance</div><div className="v">{formatSol(metrics.balance)}<small>SOL</small></div></div>
                <div className="stat"><div className="k">Tokens</div><div className="v">{formatNumber(metrics.tokenDiversityCount)}</div></div>
                <div className="stat"><div className="k">NFTs</div><div className="v">{formatNumber(metrics.nftCount)}</div></div>
                <div className="stat"><div className="k">Programs</div><div className="v">{formatNumber(metrics.uniquePrograms)}</div></div>
                <div className="stat"><div className="k">Active Days</div><div className="v">{activeRatio}%</div></div>
                <div className="stat"><div className="k">In Vol</div><div className="v">{formatSol(metrics.incomingVolume)}<small>SOL</small></div></div>
                <div className="stat"><div className="k">Out Vol</div><div className="v">{formatSol(metrics.outgoingVolume)}<small>SOL</small></div></div>
                <div className="stat"><div className="k">Dust Ratio</div><div className="v">{formatNumber(metrics.dustRatio)}%</div></div>
                <div className="stat"><div className="k">Cluster Sim</div><div className="v">{formatNumber(metrics.clusterSimilarity)}%</div></div>
                <div className="stat"><div className="k">Siblings</div><div className="v">{formatNumber(metrics.siblingCount)}</div></div>
              </div>
            </div>

            <div className="card">
              <div className="ch">Risk Breakdown</div>
              {breakdownRows.map((row) => (
                <div className="bk-row" key={row.name}>
                  <div className="bk-top">
                    <span className="name"><span className="pip" style={{ background: row.good ? '#34d399' : '#fbbf24' }} />{row.name}</span>
                    <span className="val">{row.value}</span>
                  </div>
                  <div className="bk-bar">
                    <div className="bk-fill" style={{ width: `${Math.max(0, Math.min(100, row.width))}%`, background: row.good ? 'linear-gradient(90deg,#059669,#34d399)' : 'linear-gradient(90deg,#ca8a04,#fbbf24)' }} />
                  </div>
                  <div className="bk-note">{row.note}</div>
                </div>
              ))}
            </div>

            <div className="card">
              <div className="ch">Active Flags - {flaggedCount}/{TOTAL_CHECKS}</div>
              <div className="flag-list">
                {flagged.slice(0, 5).map((signal) => (
                  <div className="flag" key={signal.id}>
                    <div className="icon or">!</div>
                    <div><b>{signal.name}</b><span className="sub">{signal.description}</span></div>
                  </div>
                ))}
                {data?.signals?.map(normalizeSignal).filter((signal) => !signal.detected).slice(0, Math.max(1, 5 - Math.min(5, flagged.length))).map((signal) => (
                  <div className="flag gn" key={signal.id}>
                    <div className="icon gn">✓</div>
                    <div><b>{signal.name}</b><span className="sub">{signal.description}</span></div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <div className="ch">Top Funding Sources</div>
              {funding.length === 0 ? (
                <div className="empty-line">No funding source rows returned by the live API.</div>
              ) : (
                funding.slice(0, 5).map((source, idx) => (
                  <div className="fund-row" key={`${source.address}-${idx}`}>
                    <div className={`dot dot-${idx}`} />
                    <div className="ad">{source.label || shortAddressGlyph(source.address, 6, 4)}</div>
                    <div className="am">{formatSol(source.totalSolReceived)} SOL</div>
                    <div className="pc">{source.percentage || 0}%</div>
                  </div>
                ))
              )}
            </div>

            <div className="card">
              <div className="ch">What to do</div>
              <div className="actions">
                <a className="action" href={`/profile/${address}`}><div className="ai">→</div><div className="at">Open reputation profile</div></a>
                <a className="action" href={`/sybil-hunt?target=${address}`}><div className="ai">+</div><div className="at">Report to community</div></a>
                <a className="action" href={`${getApiBase()}/api/sybil/analysis?address=${address}`}><div className="ai">↗</div><div className="at">Export cluster JSON</div></a>
                <a className="action" href="/app"><div className="ai">⌘</div><div className="at">Query via app</div></a>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="container below">
          <div className="checks-grid">
            {checks.map((group) => (
              <div className="check-card" key={group.title}>
                <div className="check-card-head">
                  <div className="t"><div className="ico"><svg viewBox="0 0 24 24"><path d="M3 3v18h18" /><path d="M7 14l4-4 4 4 5-5" /></svg></div>{group.title}</div>
                  <span className="ct">{group.signals.filter((signal) => signal.detected).length} flagged</span>
                </div>
                {group.signals.map((signal) => <CheckRow signal={signal} key={signal.id} />)}
              </div>
            ))}
          </div>

          <Heatmap metrics={metrics} />
        </div>
      </section>

      <footer>
        <div className="container foot-row">
          <div>© 2026 Identity Prism - Sybil-Resistant Identity on Solana</div>
          <div>
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
            <a href={`${getApiBase()}/api/sybil/analysis?address=${address}`}>API Docs</a>
          </div>
        </div>
      </footer>
      </div>
    </>
  );
}
