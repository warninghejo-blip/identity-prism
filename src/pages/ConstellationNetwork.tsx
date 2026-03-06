/**
 * Stellar Nexus v4 — Interactive wallet flow visualization.
 *
 * Visualizes transaction connections as an immersive deep-space constellation.
 * Features: tx type filters, inflow/outflow rings, flow particles, right panel
 *   with Top Connections & node detail card, colored edges, search, sybil overlay,
 *   force-directed physics, pan/zoom/pinch, node dragging, wallet exploration.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { goBack } from '@/lib/safeNavigate';
import { trackConstellationSearch } from '@/lib/analytics';
import { ArrowLeft, Loader2, ZoomIn, ZoomOut, Maximize2, Search, Shield, AlertTriangle, ChevronRight, Home, X, Copy, ExternalLink, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { getHeliusProxyUrl } from '@/constants';

// ── Types ──

type TxType = 'transfer' | 'defi' | 'nft' | 'staking';

interface GraphNode {
  id: string;
  label: string;
  tier?: string;
  score?: number;
  size: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  isCenter: boolean;
  solVolume: number;
  txCount: number;
  pinned?: boolean;
  inSol?: number;
  outSol?: number;
}

interface GraphEdge {
  source: string;
  target: string;
  weight: number;
  totalSol: number;
  outSol?: number;
  inSol?: number;
  firstTx?: number | null;
  lastTx?: number | null;
  txTypes?: TxType[];
}

interface ConstellationData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface SybilSignal {
  id: string;
  name: string;
  detected: boolean;
  weight: number;
  severity: string;
}

interface SybilResult {
  riskScore: number;
  riskLevel: string;
  signals: (SybilSignal | string)[];
}

interface HistoryEntry {
  address: string;
  label: string;
}

// ── Constants ──

const TIER_COLORS: Record<string, string> = {
  mercury: '#8B8B8B', mars: '#C1440E', venus: '#E8CDA0', earth: '#4B9CD3',
  neptune: '#3F54BE', uranus: '#73C2FB', saturn: '#E8D191', jupiter: '#C88B3A',
  sun: '#FFD700', binary_sun: '#22D3EE',
};

const RISK_COLORS: Record<string, string> = {
  low: '#10b981', medium: '#f59e0b', high: '#ef4444',
  critical: '#dc2626', clean: '#22d3ee', unknown: '#6b7280',
};

const TX_TYPE_COLORS: Record<TxType | 'all', string> = {
  all: '#6b7280',
  transfer: '#22d3ee',
  defi: '#22c55e',
  nft: '#a855f7',
  staking: '#f59e0b',
};

const TX_TYPE_LABELS: Record<TxType | 'all', string> = {
  all: 'All', transfer: 'Transfers', defi: 'DeFi', nft: 'NFT', staking: 'Staking',
};

// ── Helpers ──

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}

function getEdgeColor(edge: GraphEdge): string {
  const types = edge.txTypes || ['transfer'];
  if (types.length === 1) return TX_TYPE_COLORS[types[0]] || TX_TYPE_COLORS.transfer;
  return '#ffffff'; // mixed
}

// ── Mini planet rendering on canvas (matches CelestialCard tiers) ──

const TIER_PLANET_PARAMS: Record<string, { baseColor: string; highlight: string; darkSpot?: string; hasRings?: boolean; isSun?: boolean; isBinary?: boolean }> = {
  mercury: { baseColor: '#a8a29e', highlight: '#d6d3d1' },
  mars: { baseColor: '#c1440e', highlight: '#fb923c', darkSpot: '#7c2d12' },
  venus: { baseColor: '#e8cda0', highlight: '#fde68a' },
  earth: { baseColor: '#2563eb', highlight: '#60a5fa', darkSpot: '#16a34a' },
  neptune: { baseColor: '#3F54BE', highlight: '#818cf8', darkSpot: '#1e3a8a' },
  uranus: { baseColor: '#73C2FB', highlight: '#bae6fd' },
  saturn: { baseColor: '#e8d191', highlight: '#fcd34d', hasRings: true },
  jupiter: { baseColor: '#c88b3a', highlight: '#fdba74', darkSpot: '#92400e' },
  sun: { baseColor: '#fbbf24', highlight: '#fef08a', isSun: true },
  binary_sun: { baseColor: '#22d3ee', highlight: '#fbbf24', isSun: true, isBinary: true },
};

function drawMiniPlanet(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, tier: string, frame: number) {
  const params = TIER_PLANET_PARAMS[tier] || TIER_PLANET_PARAMS.mercury;
  const rgb = hexToRgb(params.baseColor);

  ctx.save();

  if (params.isSun) {
    const coronaR = radius * 2.5;
    const coronaPulse = 1 + Math.sin(frame * 0.03) * 0.15;
    const corona = ctx.createRadialGradient(x, y, radius * 0.6, x, y, coronaR * coronaPulse);
    corona.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},0.4)`);
    corona.addColorStop(0.5, `rgba(${rgb.r},${rgb.g},${rgb.b},0.1)`);
    corona.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = corona;
    ctx.beginPath();
    ctx.arc(x, y, coronaR * coronaPulse, 0, Math.PI * 2);
    ctx.fill();

    if (params.isBinary) {
      const offset = radius * 0.6;
      for (const dx of [-offset, offset]) {
        const sx = x + dx;
        const grad = ctx.createRadialGradient(sx - radius * 0.2, y - radius * 0.2, radius * 0.1, sx, y, radius * 0.9);
        grad.addColorStop(0, '#fff');
        grad.addColorStop(0.3, dx < 0 ? '#22d3ee' : '#fbbf24');
        grad.addColorStop(1, dx < 0 ? '#0e7490' : '#b45309');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(sx, y, radius * 0.75, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      const sunGrad = ctx.createRadialGradient(x - radius * 0.2, y - radius * 0.2, radius * 0.1, x, y, radius);
      sunGrad.addColorStop(0, '#fff');
      sunGrad.addColorStop(0.25, '#fef08a');
      sunGrad.addColorStop(0.6, '#fbbf24');
      sunGrad.addColorStop(1, '#b45309');
      ctx.fillStyle = sunGrad;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    const grad = ctx.createRadialGradient(x - radius * 0.3, y - radius * 0.3, radius * 0.1, x, y, radius);
    grad.addColorStop(0, params.highlight);
    grad.addColorStop(0.6, params.baseColor);
    grad.addColorStop(1, `rgba(${rgb.r * 0.3 | 0},${rgb.g * 0.3 | 0},${rgb.b * 0.3 | 0},1)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    if (params.darkSpot) {
      const spotAngle = frame * 0.01;
      const spotX = x + Math.cos(spotAngle) * radius * 0.3;
      const spotY = y + Math.sin(spotAngle) * radius * 0.15;
      ctx.fillStyle = params.darkSpot;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.ellipse(spotX, spotY, radius * 0.25, radius * 0.2, spotAngle, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    const haze = ctx.createRadialGradient(x, y, radius * 0.7, x, y, radius * 1.1);
    haze.addColorStop(0, 'rgba(255,255,255,0)');
    haze.addColorStop(0.8, `rgba(${rgb.r},${rgb.g},${rgb.b},0.15)`);
    haze.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = haze;
    ctx.beginPath();
    ctx.arc(x, y, radius * 1.1, 0, Math.PI * 2);
    ctx.fill();

    if (params.hasRings) {
      ctx.strokeStyle = params.highlight;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(x, y, radius * 1.6, radius * 0.35, -0.2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(x, y, radius * 1.85, radius * 0.4, -0.2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.arc(x - radius * 0.25, y - radius * 0.3, radius * 0.15, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// ── Force-directed graph simulation ──

function applyForces(nodes: GraphNode[], edges: GraphEdge[], centerNode: string, nodeMap: Map<string, GraphNode>): void {
  const REPULSION = 6000;
  const ATTRACTION = 0.004;
  const DAMPING = 0.82;
  const CENTER_PULL = 0.012;

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[i].x - nodes[j].x;
      const dy = nodes[i].y - nodes[j].y;
      const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const force = REPULSION / (dist * dist);
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      nodes[i].vx += fx;
      nodes[i].vy += fy;
      nodes[j].vx -= fx;
      nodes[j].vy -= fy;
    }
  }

  for (const edge of edges) {
    const source = nodeMap.get(edge.source);
    const target = nodeMap.get(edge.target);
    if (!source || !target) continue;
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    const force = dist * ATTRACTION * Math.log1p(edge.weight ?? 0);
    source.vx += (dx / dist) * force;
    source.vy += (dy / dist) * force;
    target.vx -= (dx / dist) * force;
    target.vy -= (dy / dist) * force;
  }

  for (const node of nodes) {
    node.vx -= node.x * CENTER_PULL;
    node.vy -= node.y * CENTER_PULL;
  }

  for (const node of nodes) {
    if (node.id === centerNode) {
      node.x = 0; node.y = 0; node.vx = 0; node.vy = 0;
      continue;
    }
    if (node.pinned) { node.vx = 0; node.vy = 0; continue; }
    node.vx *= DAMPING;
    node.vy *= DAMPING;
    node.x += node.vx;
    node.y += node.vy;
  }
}

// ── Offscreen star / nebula background ──

function createStarfieldBackground(w: number, h: number): HTMLCanvasElement {
  const offscreen = document.createElement('canvas');
  offscreen.width = w;
  offscreen.height = h;
  const ctx = offscreen.getContext('2d')!;

  const bgGrad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7);
  bgGrad.addColorStop(0, '#0a0e1a');
  bgGrad.addColorStop(0.35, '#070a14');
  bgGrad.addColorStop(0.7, '#050810');
  bgGrad.addColorStop(1, '#03050a');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, w, h);

  const nebulaColors = [
    { x: w * 0.3, y: h * 0.25, r: w * 0.35, color: '40, 20, 80' },
    { x: w * 0.75, y: h * 0.65, r: w * 0.3, color: '20, 50, 80' },
    { x: w * 0.5, y: h * 0.8, r: w * 0.25, color: '60, 20, 40' },
    { x: w * 0.15, y: h * 0.7, r: w * 0.2, color: '15, 40, 60' },
  ];
  for (const neb of nebulaColors) {
    const nebGrad = ctx.createRadialGradient(neb.x, neb.y, 0, neb.x, neb.y, neb.r);
    nebGrad.addColorStop(0, `rgba(${neb.color}, 0.04)`);
    nebGrad.addColorStop(0.5, `rgba(${neb.color}, 0.015)`);
    nebGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = nebGrad;
    ctx.fillRect(0, 0, w, h);
  }

  const starCount = Math.floor((w * h) / 2500);
  for (let i = 0; i < starCount; i++) {
    const sx = Math.random() * w;
    const sy = Math.random() * h;
    const starSize = 0.5 + Math.random() * 1.5;
    const opacity = 0.1 + Math.random() * 0.4;
    ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
    ctx.beginPath();
    ctx.arc(sx, sy, starSize, 0, Math.PI * 2);
    ctx.fill();
  }

  return offscreen;
}

// ── Arrow head helper ──

function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  fromX: number, fromY: number,
  toX: number, toY: number,
  nodeRadius: number,
  color: string,
  alpha: number,
  size: number,
) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return;
  const ux = dx / len;
  const uy = dy / len;
  const tipX = toX - ux * (nodeRadius + 3);
  const tipY = toY - uy * (nodeRadius + 3);
  const headLen = size;
  const headW = size * 0.55;
  const baseX = tipX - ux * headLen;
  const baseY = tipY - uy * headLen;

  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(baseX - uy * headW, baseY + ux * headW);
  ctx.lineTo(baseX + uy * headW, baseY - ux * headW);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
}

// ── Canvas renderer ──

function renderGraph(
  ctx: CanvasRenderingContext2D,
  nodes: GraphNode[],
  edges: GraphEdge[],
  width: number,
  height: number,
  zoom: number,
  offset: { x: number; y: number },
  selectedId: string | null,
  frame: number,
  nodeMap: Map<string, GraphNode>,
  bgCanvas: HTMLCanvasElement | null,
  activeFilter: TxType | 'all',
  showFlow: boolean,
  highlightEdgeKey: string | null,
) {
  ctx.clearRect(0, 0, width, height);

  if (bgCanvas) {
    ctx.drawImage(bgCanvas, 0, 0, width, height);
  } else {
    ctx.fillStyle = '#050810';
    ctx.fillRect(0, 0, width, height);
  }

  ctx.save();
  ctx.translate(width / 2 + offset.x, height / 2 + offset.y);
  ctx.scale(zoom, zoom);

  // Build visible set based on filter
  const visibleEdges: GraphEdge[] = [];
  const visibleNodeIds = new Set<string>();

  for (const edge of edges) {
    if (activeFilter === 'all' || (edge.txTypes || ['transfer']).includes(activeFilter)) {
      visibleEdges.push(edge);
      visibleNodeIds.add(edge.source);
      visibleNodeIds.add(edge.target);
    }
  }

  // Center node always visible
  const centerNode = nodes.find(n => n.isCenter);
  if (centerNode) visibleNodeIds.add(centerNode.id);

  const visibleNodes = nodes.filter(n => visibleNodeIds.has(n.id));

  // ── Draw edges ──
  for (const edge of visibleEdges) {
    const source = nodeMap.get(edge.source);
    const target = nodeMap.get(edge.target);
    if (!source || !target) continue;

    const edgeKey = `${edge.source}-${edge.target}`;
    const isHighlighted = highlightEdgeKey === edgeKey;
    const isSelected = selectedId != null && (edge.source === selectedId || edge.target === selectedId);
    const w = edge.weight ?? 0;
    const alpha = isHighlighted ? 0.8 : isSelected ? 0.55 : Math.min(0.65, 0.20 + w * 0.015);

    // Edge color based on tx type
    const edgeColor = getEdgeColor(edge);
    const edgeRgb = hexToRgb(edgeColor);

    // Soft glow line
    const glowLineW = isHighlighted ? 10 : isSelected ? Math.min(8, 3 + w * 0.2) : Math.min(5, 1.5 + w * 0.12);
    const glowAlpha = alpha * 0.45;
    ctx.strokeStyle = `rgba(${edgeRgb.r},${edgeRgb.g},${edgeRgb.b},${glowAlpha})`;
    ctx.lineWidth = glowLineW;
    ctx.beginPath();
    ctx.moveTo(source.x, source.y);
    ctx.lineTo(target.x, target.y);
    ctx.stroke();

    // Main edge line
    const lineW = isHighlighted ? 3 : isSelected ? Math.min(2.5, 0.8 + w * 0.08) : Math.min(1.5, 0.3 + w * 0.05);
    ctx.strokeStyle = `rgba(${edgeRgb.r},${edgeRgb.g},${edgeRgb.b},${alpha})`;
    ctx.lineWidth = lineW;
    if (w < 3) ctx.setLineDash([4, 6]);
    else ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(source.x, source.y);
    ctx.lineTo(target.x, target.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Diamond midpoint on strong connections
    if (w >= 8) {
      const mx = (source.x + target.x) / 2;
      const my = (source.y + target.y) / 2;
      const diamondSize = Math.min(4, 2 + w * 0.05);
      ctx.fillStyle = `rgba(${edgeRgb.r},${edgeRgb.g},${edgeRgb.b},${isSelected ? 0.7 : 0.4})`;
      ctx.beginPath();
      ctx.moveTo(mx, my - diamondSize);
      ctx.lineTo(mx + diamondSize, my);
      ctx.lineTo(mx, my + diamondSize);
      ctx.lineTo(mx - diamondSize, my);
      ctx.closePath();
      ctx.fill();
    }

    // SOL amount
    if ((edge.totalSol ?? 0) > 0.5 && zoom > 0.8) {
      const mx = (source.x + target.x) / 2;
      const my = (source.y + target.y) / 2;
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = '8px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${(edge.totalSol ?? 0).toFixed(1)} SOL`, mx, my - 5);
    }

    // Directional arrows
    const outSol = edge.outSol ?? edge.totalSol ?? 0;
    const inSolVal = edge.inSol ?? 0;
    const arrowAlpha = isSelected ? 0.7 : Math.min(0.5, 0.15 + w * 0.02);
    const arrowSize = isSelected ? 10 : Math.min(8, 5 + w * 0.15);

    if (outSol > 0) {
      drawArrowHead(ctx, source.x, source.y, target.x, target.y, target.size, edgeColor, arrowAlpha, arrowSize);
    }
    if (inSolVal > 0) {
      drawArrowHead(ctx, target.x, target.y, source.x, source.y, source.size, edgeColor, arrowAlpha * 0.7, arrowSize * 0.85);
    }

    // ── Flow particles ──
    if (showFlow && outSol > 0) {
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 10) {
        const particleCount = Math.min(3, 1 + Math.floor(w / 5));
        const speed = 0.0005 + Math.min(0.002, edge.totalSol * 0.0001);
        for (let p = 0; p < particleCount; p++) {
          const t = ((frame * speed + p / particleCount) % 1);
          const px = source.x + dx * t;
          const py = source.y + dy * t;
          ctx.fillStyle = edgeColor;
          ctx.globalAlpha = 0.8;
          ctx.beginPath();
          ctx.arc(px, py, 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
    }
  }

  // ── Draw nodes ──
  for (const node of visibleNodes) {
    const isSelected = node.id === selectedId;
    const isCenter = node.isCenter;
    const pulseScale = isCenter
      ? 1 + Math.sin(frame * 0.04) * 0.08
      : isSelected
        ? 1 + Math.sin(frame * 0.06) * 0.05
        : 1;
    const r = node.size * pulseScale;
    const rgb = hexToRgb(node.color);

    // Outer soft glow
    const outerGlowR = r * (isCenter ? 7 : isSelected ? 5.5 : 4);
    const outerAlpha = isCenter ? 0.12 : isSelected ? 0.08 : 0.04;
    const outerGrad = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, outerGlowR);
    outerGrad.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},${outerAlpha})`);
    outerGrad.addColorStop(0.4, `rgba(${rgb.r},${rgb.g},${rgb.b},${outerAlpha * 0.3})`);
    outerGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = outerGrad;
    ctx.beginPath();
    ctx.arc(node.x, node.y, outerGlowR, 0, Math.PI * 2);
    ctx.fill();

    // Mid glow
    const midGlowR = r * (isCenter ? 3.5 : 2.5);
    const midAlpha = isCenter ? 0.2 : isSelected ? 0.15 : 0.08;
    const midGrad = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, midGlowR);
    midGrad.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},${midAlpha})`);
    midGrad.addColorStop(0.6, `rgba(${rgb.r},${rgb.g},${rgb.b},${midAlpha * 0.2})`);
    midGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = midGrad;
    ctx.beginPath();
    ctx.arc(node.x, node.y, midGlowR, 0, Math.PI * 2);
    ctx.fill();

    // Diffraction spikes
    if (isCenter || isSelected) {
      const spikeLen = r * (isCenter ? 6 : 4);
      const spikeAlpha = isCenter ? 0.25 : 0.15;
      const spikeFlicker = 1 + Math.sin(frame * 0.03 + (isCenter ? 0 : 1.5)) * 0.15;
      ctx.strokeStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${spikeAlpha * spikeFlicker})`;
      ctx.lineWidth = isCenter ? 1.2 : 0.8;
      ctx.beginPath();
      ctx.moveTo(node.x - spikeLen, node.y);
      ctx.lineTo(node.x + spikeLen, node.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(node.x, node.y - spikeLen);
      ctx.lineTo(node.x, node.y + spikeLen);
      ctx.stroke();
    }

    // Star body
    if (isCenter && node.tier) {
      drawMiniPlanet(ctx, node.x, node.y, r * 1.8, node.tier, frame);
    } else {
      ctx.fillStyle = node.color;
      ctx.shadowColor = node.color;
      ctx.shadowBlur = isSelected ? 18 : isCenter ? 14 : 8;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.fillStyle = `rgba(255,255,255,${isSelected ? 0.6 : 0.45})`;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r * 0.35, 0, Math.PI * 2);
      ctx.fill();
    }

    // ── Inflow/outflow ring ──
    const nodeInSol = node.inSol ?? 0;
    const nodeOutSol = node.outSol ?? 0;
    const totalFlow = nodeInSol + nodeOutSol;
    if (totalFlow > 0 && !isCenter) {
      const ringR = r + 4;
      const ringW = 3;
      const inRatio = nodeInSol / totalFlow;
      const startAngle = -Math.PI / 2;

      // Green arc (inflow)
      if (inRatio > 0) {
        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth = ringW;
        ctx.beginPath();
        ctx.arc(node.x, node.y, ringR, startAngle, startAngle + Math.PI * 2 * inRatio);
        ctx.stroke();
      }
      // Red arc (outflow)
      if (inRatio < 1) {
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = ringW;
        ctx.beginPath();
        ctx.arc(node.x, node.y, ringR, startAngle + Math.PI * 2 * inRatio, startAngle + Math.PI * 2);
        ctx.stroke();
      }
    } else if (isCenter) {
      // Center node: cyan ring
      ctx.strokeStyle = '#22d3ee';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + 4, 0, Math.PI * 2);
      ctx.stroke();

      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Selection ring (non-center only since center has its own)
    if (isSelected && !isCenter) {
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + 8, 0, Math.PI * 2);
      ctx.stroke();
    }

    // ID star marker
    if ((node as any).hasMintedId) {
      const starY = node.y - r - 8;
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fbbf24';
      ctx.shadowColor = '#fbbf24';
      ctx.shadowBlur = 6;
      ctx.fillText('★', node.x, starY);
      ctx.shadowBlur = 0;
    }

    // Labels
    if (zoom > 0.5 || isCenter || isSelected) {
      const fontSize = isCenter ? 12 : isSelected ? 10 : 9;
      const fontWeight = isCenter ? 'bold ' : '';
      ctx.font = `${fontWeight}${fontSize}px monospace`;
      ctx.textAlign = 'center';
      ctx.shadowColor = node.color;
      ctx.shadowBlur = isCenter ? 12 : isSelected ? 8 : 4;
      ctx.fillStyle = isSelected ? 'rgba(255,255,255,0.92)' : isCenter ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.65)';
      ctx.fillText(node.label, node.x, node.y + r + 15);
      ctx.shadowBlur = 0;

      if (node.tier) {
        const tierText = node.tier.toUpperCase();
        const tierFontSize = isCenter ? 10 : 7;
        ctx.font = `bold ${tierFontSize}px monospace`;
        ctx.shadowColor = node.color;
        ctx.shadowBlur = isCenter ? 10 : 6;
        ctx.fillStyle = node.color;
        ctx.fillText(tierText, node.x, node.y + r + (isCenter ? 28 : 26));
        ctx.shadowBlur = 0;
      }

      if (node.solVolume > 0 && (isSelected || zoom > 1.2)) {
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = '8px monospace';
        ctx.fillText(`${(node.solVolume ?? 0).toFixed(1)} SOL`, node.x, node.y + r + (node.tier ? 38 : 26));
      }
    }
  }

  ctx.restore();
}

// ── Main component ──

export default function ConstellationNetwork() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const address = searchParams.get('address');
  const { publicKey } = useWallet();
  const walletAddress = address || publicKey?.toBase58() || '';

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<GraphNode[]>([]);
  const edgesRef = useRef<GraphEdge[]>([]);
  const nodeMapRef = useRef<Map<string, GraphNode>>(new Map());
  const animRef = useRef<number>(0);
  const frameRef = useRef(0);
  const bgCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Interaction refs
  const viewOffsetRef = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const panOffsetStartRef = useRef({ x: 0, y: 0 });
  const dragNodeRef = useRef<GraphNode | null>(null);
  const pointerDownPosRef = useRef({ x: 0, y: 0 });
  const didDragRef = useRef(false);
  const selectedIdRef = useRef<string | null>(null);
  const pinchDistRef = useRef<number | null>(null);
  const pinchZoomStartRef = useRef(1);
  const activeFilterRef = useRef<TxType | 'all'>('all');
  const showFlowRef = useRef(false);
  const highlightEdgeRef = useRef<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [zoomDisplay, setZoomDisplay] = useState(1);
  const [nodeCount, setNodeCount] = useState(0);
  const [edgeCount, setEdgeCount] = useState(0);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [sybilResult, setSybilResult] = useState<SybilResult | null>(null);
  const [sybilLoading, setSybilLoading] = useState(false);
  const [targetAddress, setTargetAddress] = useState(walletAddress);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [activeFilter, setActiveFilter] = useState<TxType | 'all'>('all');
  const [showFlow, setShowFlow] = useState(false);
  const [showPanel, setShowPanel] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 768);
  const [sortBy, setSortBy] = useState<'sol' | 'count'>('sol');
  const [highlightEdgeKey, setHighlightEdgeKey] = useState<string | null>(null);
  const [txCount, setTxCount] = useState(0);

  // Sync refs
  useEffect(() => { selectedIdRef.current = selectedNode?.id ?? null; }, [selectedNode]);
  useEffect(() => { activeFilterRef.current = activeFilter; }, [activeFilter]);
  useEffect(() => { showFlowRef.current = showFlow; }, [showFlow]);
  useEffect(() => { highlightEdgeRef.current = highlightEdgeKey; }, [highlightEdgeKey]);

  // Compute node inSol/outSol from edges
  const computeNodeFlows = useCallback((nodes: GraphNode[], edges: GraphEdge[]) => {
    const flowMap = new Map<string, { inSol: number; outSol: number }>();
    for (const edge of edges) {
      // From center's perspective: outSol = center sent to target, inSol = target sent to center
      // For target node: inSol from center = edge.outSol, outSol to center = edge.inSol
      const targetFlow = flowMap.get(edge.target) || { inSol: 0, outSol: 0 };
      targetFlow.inSol += edge.outSol ?? 0;
      targetFlow.outSol += edge.inSol ?? 0;
      flowMap.set(edge.target, targetFlow);
    }
    for (const node of nodes) {
      const flow = flowMap.get(node.id);
      if (flow) {
        node.inSol = flow.inSol;
        node.outSol = flow.outSol;
      }
    }
  }, []);

  // Top connections sorted
  const topConnections = useMemo(() => {
    const edges = edgesRef.current;
    if (!edges.length) return [];
    const sorted = [...edges].sort((a, b) => {
      if (sortBy === 'sol') return (b.totalSol ?? 0) - (a.totalSol ?? 0);
      return (b.weight ?? 0) - (a.weight ?? 0);
    });
    return sorted.slice(0, 15);
  }, [edgeCount, sortBy]); // edgeCount as dependency trigger

  // Helper: screen coords → graph coords
  const screenToGraph = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { gx: 0, gy: 0 };
    const rect = canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const z = zoomRef.current;
    const off = viewOffsetRef.current;
    const gx = (sx - rect.width / 2 - off.x) / z;
    const gy = (sy - rect.height / 2 - off.y) / z;
    return { gx, gy };
  }, []);

  const hitTestNode = useCallback((gx: number, gy: number): GraphNode | null => {
    let closest: GraphNode | null = null;
    let closestDist = Infinity;
    for (const node of nodesRef.current) {
      const dx = node.x - gx;
      const dy = node.y - gy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const hitR = node.size * 3 + 10;
      if (dist < hitR && dist < closestDist) {
        closest = node;
        closestDist = dist;
      }
    }
    return closest;
  }, []);

  // ── Pointer handlers ──

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { gx, gy } = screenToGraph(e.clientX, e.clientY);
    pointerDownPosRef.current = { x: e.clientX, y: e.clientY };
    didDragRef.current = false;
    const hitNode = hitTestNode(gx, gy);
    if (hitNode) {
      dragNodeRef.current = hitNode;
      hitNode.pinned = true;
      canvas.setPointerCapture(e.pointerId);
    } else {
      isPanningRef.current = true;
      panStartRef.current = { x: e.clientX, y: e.clientY };
      panOffsetStartRef.current = { ...viewOffsetRef.current };
      canvas.setPointerCapture(e.pointerId);
    }
  }, [screenToGraph, hitTestNode]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragNodeRef.current) {
      didDragRef.current = true;
      const { gx, gy } = screenToGraph(e.clientX, e.clientY);
      dragNodeRef.current.x = gx;
      dragNodeRef.current.y = gy;
    } else if (isPanningRef.current) {
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) didDragRef.current = true;
      viewOffsetRef.current = {
        x: panOffsetStartRef.current.x + dx,
        y: panOffsetStartRef.current.y + dy,
      };
    }
  }, [screenToGraph]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragNodeRef.current) {
      dragNodeRef.current.pinned = false;
      dragNodeRef.current = null;
    }
    isPanningRef.current = false;
    if (!didDragRef.current) {
      const { gx, gy } = screenToGraph(e.clientX, e.clientY);
      const hitNode = hitTestNode(gx, gy);
      setSelectedNode(hitNode);
      setHighlightEdgeKey(null);
    }
  }, [screenToGraph, hitTestNode]);

  // Mouse wheel zoom
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const oldZoom = zoomRef.current;
      const newZoom = Math.max(0.3, Math.min(3.0, oldZoom * (e.deltaY < 0 ? 1.1 : 0.9)));
      const scale = newZoom / oldZoom;
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      viewOffsetRef.current.x = viewOffsetRef.current.x * scale + (mx - centerX) * (1 - scale);
      viewOffsetRef.current.y = viewOffsetRef.current.y * scale + (my - centerY) * (1 - scale);
      zoomRef.current = newZoom;
      setZoomDisplay(newZoom);
    };
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [loading]);

  // Pinch zoom
  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchDistRef.current = Math.sqrt(dx * dx + dy * dy);
      pinchZoomStartRef.current = zoomRef.current;
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length === 2 && pinchDistRef.current != null) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const scale = dist / pinchDistRef.current;
      const newZoom = Math.min(3.0, Math.max(0.3, pinchZoomStartRef.current * scale));
      zoomRef.current = newZoom;
      setZoomDisplay(newZoom);
    }
  }, []);

  const handleTouchEnd = useCallback(() => { pinchDistRef.current = null; }, []);

  // Fetch sybil
  const fetchSybil = useCallback(async (addr: string) => {
    if (!addr) return;
    setSybilLoading(true);
    try {
      const base = getHeliusProxyUrl() || window.location.origin;
      const res = await fetch(`${base}/api/sybil/analysis?address=${addr}`);
      if (res.ok) {
        const data = await res.json();
        setSybilResult({ riskScore: data.riskScore ?? 0, riskLevel: data.riskLevel ?? 'unknown', signals: data.signals ?? [] });
      }
    } catch {}
    setSybilLoading(false);
  }, []);

  // Explore wallet
  const exploreWallet = useCallback((addr: string) => {
    if (addr === targetAddress) return;
    setHistory((prev) => {
      if (prev.length > 0 && prev[prev.length - 1].address === targetAddress) return [...prev];
      return [...prev, { address: targetAddress, label: targetAddress.slice(0, 4) + '...' + targetAddress.slice(-4) }];
    });
    setTargetAddress(addr);
    setSelectedNode(null);
    setHighlightEdgeKey(null);
    viewOffsetRef.current = { x: 0, y: 0 };
    zoomRef.current = 1;
    setZoomDisplay(1);
  }, [targetAddress]);

  // Navigate breadcrumb
  const navigateBreadcrumb = useCallback((index: number) => {
    if (index < 0) {
      setTargetAddress(walletAddress);
      setHistory([]);
    } else {
      const entry = history[index];
      setTargetAddress(entry.address);
      setHistory((prev) => prev.slice(0, index));
    }
    setSelectedNode(null);
    setHighlightEdgeKey(null);
    viewOffsetRef.current = { x: 0, y: 0 };
    zoomRef.current = 1;
    setZoomDisplay(1);
  }, [history, walletAddress]);

  // Fetch constellation data
  useEffect(() => {
    if (!targetAddress) { setLoading(false); return; }

    const rebuildNodeMap = (nodes: GraphNode[]) => {
      const map = new Map<string, GraphNode>();
      for (const n of nodes) map.set(n.id, n);
      nodeMapRef.current = map;
    };

    const fetchData = async () => {
      setLoading(true);
      nodesRef.current = [];
      edgesRef.current = [];
      nodeMapRef.current = new Map();

      try {
        const base = getHeliusProxyUrl() || window.location.origin;
        let tier: string | null = null;
        try {
          let repRes = await fetch(`${base}/api/reputation?address=${targetAddress}`);
          if (repRes.status === 429) {
            await new Promise(r => setTimeout(r, 2000));
            repRes = await fetch(`${base}/api/reputation?address=${targetAddress}`);
          }
          if (repRes.ok) {
            const rep = await repRes.json();
            tier = rep?.tier || null;
          }
        } catch {}

        const constUrl = `${base}/api/constellation?address=${targetAddress}&depth=2${tier ? `&tier=${tier}` : ''}`;
        let constRes = await fetch(constUrl);
        // Retry once on 429 (React strict mode double-fires effects in dev)
        if (constRes.status === 429) {
          await new Promise(r => setTimeout(r, 3000));
          constRes = await fetch(constUrl);
        }
        if (constRes.ok) {
          const data: ConstellationData = await constRes.json();
          if (tier) {
            const centerNode = data.nodes.find(n => n.isCenter);
            if (centerNode && !centerNode.tier) centerNode.tier = tier;
          }
          let totalTx = 0;
          for (const e of data.edges) totalTx += e.weight ?? 0;
          setTxCount(totalTx);

          computeNodeFlows(data.nodes, data.edges);
          nodesRef.current = data.nodes;
          edgesRef.current = data.edges;
          rebuildNodeMap(data.nodes);
          setNodeCount(data.nodes.length);
          setEdgeCount(data.edges.length);
        }
      } catch {}

      setLoading(false);
      if (nodesRef.current.length > 0) fetchSybil(targetAddress);
    };

    fetchData();
  }, [targetAddress, fetchSybil, computeNodeFlows]);

  // Reactive mobile detection
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Track panel width in a ref so animation loop always has current value
  const panelWRef = useRef(0);
  useEffect(() => {
    panelWRef.current = (!isMobile && showPanel) ? 300 : 0;
  }, [isMobile, showPanel]);

  // Animation loop
  useEffect(() => {
    if (loading || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio, 2);
    const resize = () => {
      const w = window.innerWidth - panelWRef.current;
      const h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      bgCanvasRef.current = createStarfieldBackground(w, h);
    };
    resize();
    window.addEventListener('resize', resize);

    const animate = () => {
      const w = window.innerWidth - panelWRef.current;
      const h = window.innerHeight;
      frameRef.current++;
      const map = nodeMapRef.current;
      applyForces(nodesRef.current, edgesRef.current, targetAddress, map);
      renderGraph(
        ctx, nodesRef.current, edgesRef.current,
        w, h,
        zoomRef.current, viewOffsetRef.current,
        selectedIdRef.current, frameRef.current,
        map, bgCanvasRef.current,
        activeFilterRef.current,
        showFlowRef.current,
        highlightEdgeRef.current,
      );
      animRef.current = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener('resize', resize);
    };
  }, [loading, targetAddress, showPanel, isMobile]);

  const handleSearch = useCallback(() => {
    const addr = searchInput.trim();
    if (addr.length >= 32 && addr.length <= 44) {
      trackConstellationSearch();
      exploreWallet(addr);
      setSearchInput('');
      setShowSearch(false);
    }
  }, [searchInput, exploreWallet]);

  const handleZoomIn = useCallback(() => { zoomRef.current = Math.min(3, zoomRef.current + 0.3); setZoomDisplay(zoomRef.current); }, []);
  const handleZoomOut = useCallback(() => { zoomRef.current = Math.max(0.3, zoomRef.current - 0.3); setZoomDisplay(zoomRef.current); }, []);
  const handleZoomReset = useCallback(() => { zoomRef.current = 1; viewOffsetRef.current = { x: 0, y: 0 }; setZoomDisplay(1); }, []);

  const riskColor = RISK_COLORS[sybilResult?.riskLevel ?? 'unknown'] ?? '#6b7280';
  const showBreadcrumb = history.length > 0;
  const panelW = (!isMobile && showPanel) ? 300 : 0;

  // Get selected node's edge info for detail card
  const selectedEdge = selectedNode && !selectedNode.isCenter
    ? edgesRef.current.find(e => e.target === selectedNode.id || e.source === selectedNode.id)
    : null;
  const selOutSol = selectedEdge?.outSol ?? 0;
  const selInSol = selectedEdge?.inSol ?? 0;
  const selNetVol = selInSol - selOutSol;

  return (
    <div className="fixed inset-0 bg-[#050510] flex">
      {/* Canvas area */}
      <div className="flex-1 relative" style={{ width: `calc(100% - ${panelW}px)` }}>
        {/* Header */}
        <div className="absolute top-0 left-0 right-0 z-10 bg-black/60 backdrop-blur-md border-b border-white/[0.04]">
          <div className="flex items-center justify-between px-4 py-3">
            <button onClick={() => goBack(navigate)} className="flex items-center gap-2 text-white/50 hover:text-white text-sm transition-colors">
              <ArrowLeft className="w-4 h-4" />
            </button>
            <h1 className="text-sm font-bold text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-cyan-300">
              Stellar Nexus
            </h1>
            <div className="flex items-center gap-2">
              <button onClick={() => setShowSearch(!showSearch)} className="text-white/40 hover:text-white/70 transition-colors">
                <Search className="w-4 h-4" />
              </button>
              {isMobile && (
                <button onClick={() => setShowPanel(!showPanel)} className="text-white/40 hover:text-white/70 transition-colors">
                  {showPanel ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
                </button>
              )}
            </div>
          </div>

          {showSearch && (
            <div className="px-4 pb-3 flex gap-2">
              <input
                type="text" value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="Enter wallet address..."
                className="flex-1 bg-white/[0.05] border border-white/[0.08] rounded-lg px-3 py-2 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-cyan-500/30"
              />
              <Button size="sm" onClick={handleSearch} className="bg-cyan-600/30 hover:bg-cyan-600/40 text-cyan-300 border border-cyan-500/20">
                Scan
              </Button>
            </div>
          )}

          {showBreadcrumb && (
            <div className="px-4 pb-2 flex items-center gap-1 overflow-x-auto scrollbar-none">
              <button onClick={() => navigateBreadcrumb(-1)} className="flex items-center gap-1 px-2 py-1 rounded bg-white/[0.04] hover:bg-white/[0.08] text-[10px] text-cyan-300/70 hover:text-cyan-300 transition-colors whitespace-nowrap flex-shrink-0">
                <Home className="w-3 h-3" /><span>Home</span>
              </button>
              {history.map((entry, i) => (
                <div key={i} className="flex items-center gap-1 flex-shrink-0">
                  <ChevronRight className="w-3 h-3 text-white/15" />
                  <button onClick={() => navigateBreadcrumb(i)} className="px-2 py-1 rounded bg-white/[0.04] hover:bg-white/[0.08] text-[10px] text-white/40 hover:text-white/70 font-mono transition-colors whitespace-nowrap">
                    {entry.label}
                  </button>
                </div>
              ))}
              <ChevronRight className="w-3 h-3 text-white/15 flex-shrink-0" />
              <span className="px-2 py-1 text-[10px] text-white/70 font-mono font-bold whitespace-nowrap flex-shrink-0">
                {targetAddress.slice(0, 4)}...{targetAddress.slice(-4)}
              </span>
            </div>
          )}
        </div>

        {/* Sybil risk badge */}
        {sybilResult && !sybilLoading && (
          <div className="absolute z-10 left-4" style={{ top: showBreadcrumb ? '5.5rem' : '4rem' }}>
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-black/70 backdrop-blur-sm border border-white/[0.06]">
              {sybilResult.riskLevel === 'clean' || sybilResult.riskLevel === 'low' ? (
                <Shield className="w-3.5 h-3.5" style={{ color: riskColor }} />
              ) : (
                <AlertTriangle className="w-3.5 h-3.5" style={{ color: riskColor }} />
              )}
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: riskColor }}>
                {sybilResult.riskLevel} risk
              </span>
              <span className="text-[10px] text-white/30">({sybilResult.riskScore}/100)</span>
            </div>
          </div>
        )}
        {sybilLoading && (
          <div className="absolute z-10 left-4" style={{ top: showBreadcrumb ? '5.5rem' : '4rem' }}>
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-black/70 border border-white/[0.06]">
              <Loader2 className="w-3 h-3 animate-spin text-white/30" />
              <span className="text-[10px] text-white/30">Analyzing...</span>
            </div>
          </div>
        )}

        {/* Filter panel — bottom left overlay */}
        {nodeCount > 0 && (
          <div className="absolute bottom-16 left-4 z-10">
            <div className="rounded-xl bg-black/70 backdrop-blur-sm border border-white/[0.06] p-3">
              <p className="text-[9px] text-white/30 uppercase tracking-widest mb-2 font-bold">Filter</p>
              {(['all', 'transfer', 'defi', 'nft', 'staking'] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setActiveFilter(type)}
                  className={`flex items-center gap-2 w-full px-2 py-1.5 rounded text-left text-[10px] transition-colors ${
                    activeFilter === type ? 'bg-white/[0.08] text-white' : 'text-white/40 hover:text-white/60 hover:bg-white/[0.03]'
                  }`}
                >
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: TX_TYPE_COLORS[type], opacity: activeFilter === type ? 1 : 0.5 }}
                  />
                  <span>{TX_TYPE_LABELS[type]}</span>
                </button>
              ))}
              {/* Flow toggle */}
              <div className="mt-2 pt-2 border-t border-white/[0.06]">
                <button
                  onClick={() => setShowFlow(!showFlow)}
                  className={`flex items-center gap-2 w-full px-2 py-1.5 rounded text-left text-[10px] transition-colors ${
                    showFlow ? 'bg-cyan-500/10 text-cyan-300' : 'text-white/40 hover:text-white/60'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${showFlow ? 'bg-cyan-400' : 'bg-white/20'}`} />
                  <span>Flow</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Status bar — bottom left under filters */}
        <div className="absolute bottom-6 left-4 z-10">
          <span className="text-[10px] text-white/15 font-mono">
            {txCount} transactions | {nodeCount} wallets
            {activeFilter !== 'all' && (
              <span style={{ color: TX_TYPE_COLORS[activeFilter] }}> · {TX_TYPE_LABELS[activeFilter]}</span>
            )}
          </span>
        </div>

        {/* Zoom controls */}
        <div className="absolute bottom-6 right-4 z-10 flex flex-col gap-2">
          <Button size="sm" variant="outline" className="w-9 h-9 p-0 border-white/10 bg-black/40" onClick={handleZoomIn}>
            <ZoomIn className="w-4 h-4" />
          </Button>
          <Button size="sm" variant="outline" className="w-9 h-9 p-0 border-white/10 bg-black/40" onClick={handleZoomOut}>
            <ZoomOut className="w-4 h-4" />
          </Button>
          <Button size="sm" variant="outline" className="w-9 h-9 p-0 border-white/10 bg-black/40" onClick={handleZoomReset}>
            <Maximize2 className="w-4 h-4" />
          </Button>
          <span className="text-[8px] text-white/20 text-center font-mono">{(zoomDisplay * 100).toFixed(0)}%</span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <Loader2 className="w-8 h-8 animate-spin text-cyan-500/30 mx-auto mb-3" />
              <p className="text-xs text-white/20">Building stellar nexus...</p>
            </div>
          </div>
        ) : nodeCount === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center px-6">
              <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center bg-cyan-500/[0.06] border border-cyan-500/10">
                <Search className="w-7 h-7 text-cyan-400/25" />
              </div>
              <p className="text-white/30 text-sm font-medium mb-1">No connections found</p>
              <p className="text-white/15 text-xs mb-4">Start the backend server or try a different wallet address</p>
              <button onClick={() => setShowSearch(true)} className="px-4 py-2 rounded-lg bg-cyan-600/15 border border-cyan-500/20 text-cyan-300 text-xs font-bold hover:bg-cyan-600/25 transition-all">
                Search another wallet
              </button>
            </div>
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            className="w-full h-full cursor-crosshair touch-none"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          />
        )}
      </div>

      {/* Right Panel — Top Connections + Node Detail */}
      {(showPanel || !isMobile) && (
        <div
          className={`${
            isMobile
              ? 'absolute inset-y-0 right-0 z-20 w-[300px] shadow-2xl'
              : 'relative w-[300px] flex-shrink-0'
          } bg-[#0a0a0f] border-l border-white/[0.06] flex flex-col overflow-hidden`}
        >
          {/* Panel header */}
          <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
            <h2 className="text-[10px] font-bold uppercase tracking-widest text-white/40">Top Connections</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSortBy(sortBy === 'sol' ? 'count' : 'sol')}
                className="text-[9px] text-white/30 hover:text-white/50 transition-colors px-2 py-1 rounded bg-white/[0.03] border border-white/[0.06]"
              >
                by {sortBy === 'sol' ? 'SOL' : 'Count'}
              </button>
              {isMobile && (
                <button onClick={() => setShowPanel(false)} className="text-white/30 hover:text-white/50">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Connection list */}
          <div className="flex-1 overflow-y-auto scrollbar-none">
            {topConnections.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-[10px] text-white/20">No connections yet</p>
              </div>
            ) : (
              <div className="py-1">
                {topConnections.map((edge, i) => {
                  const sourceNode = nodeMapRef.current.get(edge.source);
                  const targetNode = nodeMapRef.current.get(edge.target);
                  if (!sourceNode || !targetNode) return null;
                  const edgeKey = `${edge.source}-${edge.target}`;
                  const isActive = highlightEdgeKey === edgeKey;
                  const edgeColor = getEdgeColor(edge);

                  return (
                    <button
                      key={edgeKey}
                      onClick={() => {
                        setHighlightEdgeKey(isActive ? null : edgeKey);
                        setSelectedNode(isActive ? null : targetNode);
                      }}
                      className={`w-full px-3 py-2 flex items-center gap-2 text-left transition-colors ${
                        isActive ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'
                      }`}
                    >
                      <span className="text-[9px] text-white/20 w-4 text-right font-mono flex-shrink-0">{i + 1}</span>
                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: edgeColor }} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1 text-[10px] font-mono">
                          <span className="text-cyan-300/70 truncate">{sourceNode.label}</span>
                          <span className="text-white/15">→</span>
                          <span className="truncate" style={{ color: targetNode.color }}>{targetNode.label}</span>
                        </div>
                      </div>
                      <span className="text-[10px] font-mono text-white/50 flex-shrink-0">
                        {sortBy === 'sol'
                          ? `${(edge.totalSol ?? 0).toFixed(1)}`
                          : `${edge.weight}x`
                        }
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Node detail card — bottom of panel */}
          {selectedNode && !selectedNode.isCenter && (
            <div className="border-t border-white/[0.06] p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: selectedNode.color, boxShadow: `0 0 8px ${selectedNode.color}60` }} />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-bold text-white/80 truncate">
                    {selectedNode.tier ? selectedNode.tier.charAt(0).toUpperCase() + selectedNode.tier.slice(1) : 'Unknown'}
                  </p>
                </div>
                <button
                  onClick={() => { setSelectedNode(null); setHighlightEdgeKey(null); }}
                  className="text-white/30 hover:text-white/50"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="space-y-1.5 mb-3">
                <div className="flex justify-between text-[10px]">
                  <span className="text-white/30">Tier</span>
                  <span className="text-white/60 capitalize">{selectedNode.tier ?? '—'}</span>
                </div>
                <div className="flex justify-between text-[10px]">
                  <span className="text-white/30">Transactions</span>
                  <span className="text-white/60">{selectedNode.txCount ?? 0}</span>
                </div>
                <div className="flex justify-between text-[10px]">
                  <span className="text-white/30">Inflow Vol</span>
                  <span className="text-green-400/80">{selInSol.toFixed(2)} SOL</span>
                </div>
                <div className="flex justify-between text-[10px]">
                  <span className="text-white/30">Outflow Vol</span>
                  <span className="text-red-400/80">{selOutSol.toFixed(2)} SOL</span>
                </div>
                <div className="flex justify-between text-[10px]">
                  <span className="text-white/30">Net Volume</span>
                  <span className={selNetVol >= 0 ? 'text-green-400/80' : 'text-red-400/80'}>
                    {selNetVol >= 0 ? '+' : ''}{selNetVol.toFixed(2)} SOL
                  </span>
                </div>
                <div className="flex justify-between items-center text-[10px]">
                  <span className="text-white/30">Address</span>
                  <button
                    onClick={() => { navigator.clipboard.writeText(selectedNode.id); toast?.('Address copied'); }}
                    className="flex items-center gap-1 text-white/50 hover:text-white/70 transition-colors"
                  >
                    <span className="font-mono">{selectedNode.id.slice(0, 4)}...{selectedNode.id.slice(-4)}</span>
                    <Copy className="w-3 h-3" />
                  </button>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => exploreWallet(selectedNode.id)}
                  className="flex-1 py-2 rounded-lg bg-cyan-600/20 border border-cyan-500/20 text-cyan-300 text-[10px] font-bold tracking-wider uppercase hover:bg-cyan-600/30 transition-colors flex items-center justify-center gap-1"
                >
                  <ExternalLink className="w-3 h-3" />
                  Explore
                </button>
                <button
                  onClick={() => { setSelectedNode(null); setHighlightEdgeKey(null); }}
                  className="py-2 px-3 rounded-lg bg-white/[0.03] border border-white/[0.06] text-white/40 text-[10px] hover:bg-white/[0.06] transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          )}

          {/* Panel footer */}
          {!selectedNode && (
            <div className="border-t border-white/[0.06] px-4 py-3">
              <p className="text-[9px] text-white/15 text-center">Click a node or connection for details</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
