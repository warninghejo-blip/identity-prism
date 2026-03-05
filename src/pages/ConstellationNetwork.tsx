/**
 * Stellar Nexus v3 — Interactive wallet star map.
 *
 * Visualizes transaction connections as an immersive deep-space constellation.
 * Node sizes = transaction volume. Lines = connections.
 * Features: search any wallet, sybil risk overlay, force-directed physics,
 *   pan/zoom/pinch, node dragging, wallet exploration history breadcrumb.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { goBack } from '@/lib/safeNavigate';
import { ArrowLeft, Loader2, ZoomIn, ZoomOut, Maximize2, Search, Shield, AlertTriangle, ChevronRight, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getHeliusProxyUrl } from '@/constants';

// ── Types ──

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
  pinned?: boolean; // true while being dragged
}

interface GraphEdge {
  source: string;
  target: string;
  weight: number;
  totalSol: number;
  /** SOL flowing source → target (0 = unknown/equal split) */
  outSol?: number;
  /** SOL flowing target → source (0 = one-way) */
  inSol?: number;
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

const TIER_COLORS: Record<string, string> = {
  mercury: '#8B8B8B', mars: '#C1440E', venus: '#E8CDA0', earth: '#4B9CD3',
  neptune: '#3F54BE', uranus: '#73C2FB', saturn: '#E8D191', jupiter: '#C88B3A',
  sun: '#FFD700', binary_sun: '#22D3EE',
};

const RISK_COLORS: Record<string, string> = {
  low: '#10b981',
  medium: '#f59e0b',
  high: '#ef4444',
  critical: '#dc2626',
  clean: '#22d3ee',
  unknown: '#6b7280',
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
      node.x = 0;
      node.y = 0;
      node.vx = 0;
      node.vy = 0;
      continue;
    }
    if (node.pinned) {
      node.vx = 0;
      node.vy = 0;
      continue;
    }
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

  // Deep space multi-gradient
  const bgGrad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7);
  bgGrad.addColorStop(0, '#0a0e1a');
  bgGrad.addColorStop(0.35, '#070a14');
  bgGrad.addColorStop(0.7, '#050810');
  bgGrad.addColorStop(1, '#03050a');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, w, h);

  // Subtle nebula clouds — a few large semi-transparent radial gradients
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

  // Scattered star dots
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
  // Place arrow at edge of target node
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
) {
  ctx.clearRect(0, 0, width, height);

  // Blit cached starfield background
  if (bgCanvas) {
    ctx.drawImage(bgCanvas, 0, 0, width, height);
  } else {
    ctx.fillStyle = '#050810';
    ctx.fillRect(0, 0, width, height);
  }

  // Set up transform for graph content
  ctx.save();
  ctx.translate(width / 2 + offset.x, height / 2 + offset.y);
  ctx.scale(zoom, zoom);

  // ── Draw edges ──
  for (const edge of edges) {
    const source = nodeMap.get(edge.source);
    const target = nodeMap.get(edge.target);
    if (!source || !target) continue;

    const isSelected = selectedId != null && (edge.source === selectedId || edge.target === selectedId);
    const w = edge.weight ?? 0;
    const alpha = isSelected ? 0.55 : Math.min(0.35, 0.04 + w * 0.015);

    // Parse node colors for gradient
    const srcRgb = hexToRgb(source.color);
    const tgtRgb = hexToRgb(target.color);

    // Soft glow line behind (wider, low opacity)
    const glowLineW = isSelected ? Math.min(8, 3 + w * 0.2) : Math.min(5, 1.5 + w * 0.12);
    const glowGrad = ctx.createLinearGradient(source.x, source.y, target.x, target.y);
    const glowAlpha = alpha * 0.25;
    glowGrad.addColorStop(0, `rgba(${srcRgb.r},${srcRgb.g},${srcRgb.b},${glowAlpha})`);
    glowGrad.addColorStop(1, `rgba(${tgtRgb.r},${tgtRgb.g},${tgtRgb.b},${glowAlpha})`);
    ctx.strokeStyle = glowGrad;
    ctx.lineWidth = glowLineW;
    ctx.beginPath();
    ctx.moveTo(source.x, source.y);
    ctx.lineTo(target.x, target.y);
    ctx.stroke();

    // Main edge line (thinner, brighter)
    const lineW = isSelected ? Math.min(2.5, 0.8 + w * 0.08) : Math.min(1.5, 0.3 + w * 0.05);
    const edgeGrad = ctx.createLinearGradient(source.x, source.y, target.x, target.y);
    edgeGrad.addColorStop(0, `rgba(${srcRgb.r},${srcRgb.g},${srcRgb.b},${alpha})`);
    edgeGrad.addColorStop(1, `rgba(${tgtRgb.r},${tgtRgb.g},${tgtRgb.b},${alpha})`);
    ctx.strokeStyle = edgeGrad;
    ctx.lineWidth = lineW;

    // Dashed for weak connections
    if (w < 3) ctx.setLineDash([4, 6]);
    else ctx.setLineDash([]);

    ctx.beginPath();
    ctx.moveTo(source.x, source.y);
    ctx.lineTo(target.x, target.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Diamond midpoint on strong connections (weight >= 8)
    if (w >= 8) {
      const mx = (source.x + target.x) / 2;
      const my = (source.y + target.y) / 2;
      const diamondSize = Math.min(4, 2 + w * 0.05);
      const midAlpha = isSelected ? 0.7 : 0.4;
      const midR = Math.round((srcRgb.r + tgtRgb.r) / 2);
      const midG = Math.round((srcRgb.g + tgtRgb.g) / 2);
      const midB = Math.round((srcRgb.b + tgtRgb.b) / 2);
      ctx.fillStyle = `rgba(${midR},${midG},${midB},${midAlpha})`;
      ctx.beginPath();
      ctx.moveTo(mx, my - diamondSize);
      ctx.lineTo(mx + diamondSize, my);
      ctx.lineTo(mx, my + diamondSize);
      ctx.lineTo(mx - diamondSize, my);
      ctx.closePath();
      ctx.fill();
    }

    // SOL amount on strong connections
    if ((edge.totalSol ?? 0) > 0.5 && zoom > 0.8) {
      const mx = (source.x + target.x) / 2;
      const my = (source.y + target.y) / 2;
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.font = '7px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${(edge.totalSol ?? 0).toFixed(1)} SOL`, mx, my - 5);
    }

    // ── Directional arrows ──
    const outSol = edge.outSol ?? edge.totalSol ?? 0;
    const inSolVal = edge.inSol ?? 0;
    const arrowAlpha = isSelected ? 0.7 : Math.min(0.5, 0.15 + w * 0.02);
    const arrowSize = isSelected ? 10 : Math.min(8, 5 + w * 0.15);
    const midColor = `rgb(${Math.round((srcRgb.r + tgtRgb.r) / 2)},${Math.round((srcRgb.g + tgtRgb.g) / 2)},${Math.round((srcRgb.b + tgtRgb.b) / 2)})`;

    // Arrow source → target (main direction)
    if (outSol > 0) {
      drawArrowHead(ctx, source.x, source.y, target.x, target.y, target.size, midColor, arrowAlpha, arrowSize);
    }
    // Arrow target → source (reverse / bidirectional)
    if (inSolVal > 0) {
      drawArrowHead(ctx, target.x, target.y, source.x, source.y, source.size, midColor, arrowAlpha * 0.7, arrowSize * 0.85);
    }
  }

  // ── Draw nodes (stars) ──
  for (const node of nodes) {
    const isSelected = node.id === selectedId;
    const isCenter = node.isCenter;
    const pulseScale = isCenter
      ? 1 + Math.sin(frame * 0.04) * 0.08
      : isSelected
        ? 1 + Math.sin(frame * 0.06) * 0.05
        : 1;
    const r = node.size * pulseScale;
    const rgb = hexToRgb(node.color);

    // Outer soft glow (large, low opacity radial gradient)
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

    // Mid glow layer
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

    // Diffraction spikes for center / selected node — 4 thin bright lines in + pattern
    if (isCenter || isSelected) {
      const spikeLen = r * (isCenter ? 6 : 4);
      const spikeAlpha = isCenter ? 0.25 : 0.15;
      const spikeFlicker = 1 + Math.sin(frame * 0.03 + (isCenter ? 0 : 1.5)) * 0.15;
      ctx.strokeStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${spikeAlpha * spikeFlicker})`;
      ctx.lineWidth = isCenter ? 1.2 : 0.8;
      // Horizontal
      ctx.beginPath();
      ctx.moveTo(node.x - spikeLen, node.y);
      ctx.lineTo(node.x + spikeLen, node.y);
      ctx.stroke();
      // Vertical
      ctx.beginPath();
      ctx.moveTo(node.x, node.y - spikeLen);
      ctx.lineTo(node.x, node.y + spikeLen);
      ctx.stroke();
    }

    // Star body — filled circle with color
    ctx.fillStyle = node.color;
    ctx.shadowColor = node.color;
    ctx.shadowBlur = isSelected ? 18 : isCenter ? 14 : 8;
    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Inner bright core — white center
    const coreAlpha = isCenter ? 0.7 : isSelected ? 0.6 : 0.45;
    ctx.fillStyle = `rgba(255,255,255,${coreAlpha})`;
    ctx.beginPath();
    ctx.arc(node.x, node.y, r * 0.35, 0, Math.PI * 2);
    ctx.fill();

    // Selection ring
    if (isSelected || isCenter) {
      ctx.strokeStyle = isCenter ? '#22d3ee' : '#fbbf24';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + 4, 0, Math.PI * 2);
      ctx.stroke();

      if (isCenter) {
        ctx.globalAlpha = 0.3;
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // ── Labels with glow shadow ──
    if (zoom > 0.5 || isCenter || isSelected) {
      const fontSize = isCenter ? 12 : isSelected ? 10 : 9;
      const fontWeight = isCenter ? 'bold ' : '';
      ctx.font = `${fontWeight}${fontSize}px monospace`;
      ctx.textAlign = 'center';

      // Glow shadow for text
      ctx.shadowColor = node.color;
      ctx.shadowBlur = isCenter ? 12 : isSelected ? 8 : 4;

      ctx.fillStyle = isSelected
        ? 'rgba(255,255,255,0.92)'
        : isCenter
          ? 'rgba(255,255,255,0.8)'
          : 'rgba(255,255,255,0.45)';
      ctx.fillText(node.label, node.x, node.y + r + 15);
      ctx.shadowBlur = 0;

      // SOL volume under label
      if (node.solVolume > 0 && (isSelected || zoom > 1.2)) {
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.font = '7px monospace';
        ctx.fillText(`${(node.solVolume ?? 0).toFixed(1)} SOL`, node.x, node.y + r + 26);
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

  // Interaction refs (avoid re-renders during animation)
  const viewOffsetRef = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const panOffsetStartRef = useRef({ x: 0, y: 0 });
  const dragNodeRef = useRef<GraphNode | null>(null);
  const pointerDownPosRef = useRef({ x: 0, y: 0 });
  const didDragRef = useRef(false);
  const selectedIdRef = useRef<string | null>(null);
  // Pinch state
  const pinchDistRef = useRef<number | null>(null);
  const pinchZoomStartRef = useRef(1);

  const [loading, setLoading] = useState(true);
  const [zoomDisplay, setZoomDisplay] = useState(1); // for button UI only
  const [nodeCount, setNodeCount] = useState(0);
  const [edgeCount, setEdgeCount] = useState(0);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [sybilResult, setSybilResult] = useState<SybilResult | null>(null);
  const [sybilLoading, setSybilLoading] = useState(false);
  const [targetAddress, setTargetAddress] = useState(walletAddress);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  // Sync selectedNode state → ref
  useEffect(() => {
    selectedIdRef.current = selectedNode?.id ?? null;
  }, [selectedNode]);

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

  // Helper: hit test — find node at graph coords
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
      // Start dragging this node
      dragNodeRef.current = hitNode;
      hitNode.pinned = true;
      canvas.setPointerCapture(e.pointerId);
    } else {
      // Start panning
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

    // If no significant movement → treat as click
    if (!didDragRef.current) {
      const { gx, gy } = screenToGraph(e.clientX, e.clientY);
      const hitNode = hitTestNode(gx, gy);
      setSelectedNode(hitNode);
    }
  }, [screenToGraph, hitTestNode]);

  // ── Mouse wheel zoom (centered on cursor) ──
  // Imperative listener with { passive: false } so preventDefault() works
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

      // Adjust offset so the point under cursor stays fixed
      // Screen pos of graph point: sx = w/2 + offset.x + gx * zoom
      // Solve for newOffset so (mx, my) maps to same graph point:
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

  // ── Touch pinch zoom ──
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

  const handleTouchEnd = useCallback(() => {
    pinchDistRef.current = null;
  }, []);

  // Fetch sybil data
  const fetchSybil = useCallback(async (addr: string) => {
    if (!addr) return;
    setSybilLoading(true);
    try {
      const base = getHeliusProxyUrl() || window.location.origin;
      const res = await fetch(`${base}/api/sybil/analysis?address=${addr}`);
      if (res.ok) {
        const data = await res.json();
        setSybilResult({
          riskScore: data.riskScore ?? 0,
          riskLevel: data.riskLevel ?? 'unknown',
          signals: data.signals ?? [],
        });
      }
    } catch {}
    setSybilLoading(false);
  }, []);

  // ── Explore wallet (push history) ──
  const exploreWallet = useCallback((addr: string) => {
    if (addr === targetAddress) return;
    setHistory((prev) => {
      // If we're already viewing this address, don't duplicate
      if (prev.length > 0 && prev[prev.length - 1].address === targetAddress) {
        return [...prev];
      }
      return [...prev, { address: targetAddress, label: targetAddress.slice(0, 4) + '...' + targetAddress.slice(-4) }];
    });
    setTargetAddress(addr);
    setSelectedNode(null);
    // Reset view
    viewOffsetRef.current = { x: 0, y: 0 };
    zoomRef.current = 1;
    setZoomDisplay(1);
  }, [targetAddress]);

  // Navigate breadcrumb
  const navigateBreadcrumb = useCallback((index: number) => {
    if (index < 0) {
      // Home
      setTargetAddress(walletAddress);
      setHistory([]);
    } else {
      const entry = history[index];
      setTargetAddress(entry.address);
      setHistory((prev) => prev.slice(0, index));
    }
    setSelectedNode(null);
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
        const res = await fetch(`${base}/api/constellation?address=${targetAddress}&depth=2`);
        if (res.ok) {
          const data: ConstellationData = await res.json();
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
  }, [targetAddress, fetchSybil]);

  // Animation loop
  useEffect(() => {
    if (loading || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio, 2);
    const resize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Regenerate starfield background at new size
      bgCanvasRef.current = createStarfieldBackground(w, h);
    };
    resize();
    window.addEventListener('resize', resize);

    const animate = () => {
      frameRef.current++;
      const map = nodeMapRef.current;
      applyForces(nodesRef.current, edgesRef.current, targetAddress, map);
      renderGraph(
        ctx,
        nodesRef.current,
        edgesRef.current,
        window.innerWidth,
        window.innerHeight,
        zoomRef.current,
        viewOffsetRef.current,
        selectedIdRef.current,
        frameRef.current,
        map,
        bgCanvasRef.current,
      );
      animRef.current = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener('resize', resize);
    };
  }, [loading, targetAddress]);

  const handleSearch = useCallback(() => {
    const addr = searchInput.trim();
    if (addr.length >= 32 && addr.length <= 44) {
      exploreWallet(addr);
      setSearchInput('');
      setShowSearch(false);
    }
  }, [searchInput, exploreWallet]);

  // Zoom button handlers
  const handleZoomIn = useCallback(() => {
    zoomRef.current = Math.min(3, zoomRef.current + 0.3);
    setZoomDisplay(zoomRef.current);
  }, []);
  const handleZoomOut = useCallback(() => {
    zoomRef.current = Math.max(0.3, zoomRef.current - 0.3);
    setZoomDisplay(zoomRef.current);
  }, []);
  const handleZoomReset = useCallback(() => {
    zoomRef.current = 1;
    viewOffsetRef.current = { x: 0, y: 0 };
    setZoomDisplay(1);
  }, []);

  const riskColor = RISK_COLORS[sybilResult?.riskLevel ?? 'unknown'] ?? '#6b7280';

  // Determine if we have breadcrumb history
  const showBreadcrumb = history.length > 0;

  return (
    <div className="fixed inset-0 bg-[#050510]">
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 z-10 bg-black/60 backdrop-blur-md border-b border-white/[0.04]">
        <div className="flex items-center justify-between px-4 py-3">
          <button
            onClick={() => goBack(navigate)}
            className="flex items-center gap-2 text-white/50 hover:text-white text-sm transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h1 className="text-sm font-bold text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-cyan-300">
            Stellar Nexus
          </h1>
          <button
            onClick={() => setShowSearch(!showSearch)}
            className="text-white/40 hover:text-white/70 transition-colors"
          >
            <Search className="w-4 h-4" />
          </button>
        </div>

        {/* Search bar */}
        {showSearch && (
          <div className="px-4 pb-3 flex gap-2">
            <input
              type="text"
              value={searchInput}
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

        {/* Wallet history breadcrumb */}
        {showBreadcrumb && (
          <div className="px-4 pb-2 flex items-center gap-1 overflow-x-auto scrollbar-none">
            <button
              onClick={() => navigateBreadcrumb(-1)}
              className="flex items-center gap-1 px-2 py-1 rounded bg-white/[0.04] hover:bg-white/[0.08] text-[10px] text-cyan-300/70 hover:text-cyan-300 transition-colors whitespace-nowrap flex-shrink-0"
            >
              <Home className="w-3 h-3" />
              <span>Home</span>
            </button>
            {history.map((entry, i) => (
              <div key={i} className="flex items-center gap-1 flex-shrink-0">
                <ChevronRight className="w-3 h-3 text-white/15" />
                <button
                  onClick={() => navigateBreadcrumb(i)}
                  className="px-2 py-1 rounded bg-white/[0.04] hover:bg-white/[0.08] text-[10px] text-white/40 hover:text-white/70 font-mono transition-colors whitespace-nowrap"
                >
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
        <div className="absolute top-16 left-4 z-10" style={{ top: showBreadcrumb ? '5.5rem' : undefined }}>
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-black/70 backdrop-blur-sm border border-white/[0.06]">
            {sybilResult.riskLevel === 'clean' || sybilResult.riskLevel === 'low' ? (
              <Shield className="w-3.5 h-3.5" style={{ color: riskColor }} />
            ) : (
              <AlertTriangle className="w-3.5 h-3.5" style={{ color: riskColor }} />
            )}
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: riskColor }}>
              {sybilResult.riskLevel} risk
            </span>
            <span className="text-[10px] text-white/30">
              ({sybilResult.riskScore}/100)
            </span>
          </div>
          {sybilResult.signals.length > 0 && (
            <div className="mt-1 px-3 py-1.5 rounded-lg bg-black/50 border border-white/[0.04]">
              {sybilResult.signals.slice(0, 3).map((sig, i) => (
                <p key={i} className="text-[8px] text-white/25 leading-relaxed">
                  {typeof sig === 'string' ? sig : sig.name}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
      {sybilLoading && (
        <div className="absolute top-16 left-4 z-10" style={{ top: showBreadcrumb ? '5.5rem' : undefined }}>
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-black/70 border border-white/[0.06]">
            <Loader2 className="w-3 h-3 animate-spin text-white/30" />
            <span className="text-[10px] text-white/30">Analyzing...</span>
          </div>
        </div>
      )}

      {/* Selected node details */}
      {selectedNode && !selectedNode.isCenter && (
        <div className="absolute bottom-20 left-4 right-4 z-10 max-w-sm mx-auto">
          <div className="rounded-xl bg-black/80 backdrop-blur-md border border-white/[0.08] p-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: selectedNode.color, boxShadow: `0 0 8px ${selectedNode.color}60` }} />
              <span className="text-xs font-mono text-white/70">{selectedNode.id.slice(0, 8)}...{selectedNode.id.slice(-8)}</span>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="text-[10px] text-white/30 uppercase">Volume</p>
                <p className="text-xs font-bold text-white/70">{(selectedNode.solVolume ?? 0).toFixed(2)} SOL</p>
              </div>
              <div>
                <p className="text-[10px] text-white/30 uppercase">Txns</p>
                <p className="text-xs font-bold text-white/70">{selectedNode.txCount ?? 0}</p>
              </div>
              <div>
                <p className="text-[10px] text-white/30 uppercase">Tier</p>
                <p className="text-xs font-bold capitalize" style={{ color: selectedNode.color }}>{selectedNode.tier ?? 'Unknown'}</p>
              </div>
            </div>
            <button
              onClick={() => exploreWallet(selectedNode.id)}
              className="mt-3 w-full py-1.5 rounded-lg bg-cyan-600/20 border border-cyan-500/20 text-cyan-300 text-[10px] font-bold tracking-wider uppercase hover:bg-cyan-600/30 transition-colors"
            >
              Explore this wallet
            </button>
          </div>
        </div>
      )}

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

      {/* Node count */}
      <div className="absolute bottom-6 left-4 z-10">
        <span className="text-[10px] text-white/15 font-mono">{nodeCount} nodes · {edgeCount} connections</span>
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
            <button
              onClick={() => setShowSearch(true)}
              className="px-4 py-2 rounded-lg bg-cyan-600/15 border border-cyan-500/20 text-cyan-300 text-xs font-bold hover:bg-cyan-600/25 transition-all"
            >
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
  );
}
