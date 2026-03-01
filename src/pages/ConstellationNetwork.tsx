/**
 * Constellation Network — Interactive wallet relationship graph.
 * Visualizes transaction connections between wallets as a force-directed star map.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { ArrowLeft, Loader2, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
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
}

interface GraphEdge {
  source: string;
  target: string;
  weight: number;  // transaction count
  totalSol: number;
}

interface ConstellationData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const TIER_COLORS: Record<string, string> = {
  mercury: '#8B8B8B', mars: '#C1440E', venus: '#E8CDA0', earth: '#4B9CD3',
  neptune: '#3F54BE', uranus: '#73C2FB', saturn: '#E8D191', jupiter: '#C88B3A',
  sun: '#FFD700', binary_sun: '#22D3EE',
};

// ── Force-directed graph simulation ──

function applyForces(nodes: GraphNode[], edges: GraphEdge[], centerNode: string): void {
  const REPULSION = 5000;
  const ATTRACTION = 0.005;
  const DAMPING = 0.85;
  const CENTER_PULL = 0.01;

  // Repulsion between all nodes
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

  // Attraction along edges
  for (const edge of edges) {
    const source = nodes.find((n) => n.id === edge.source);
    const target = nodes.find((n) => n.id === edge.target);
    if (!source || !target) continue;
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const force = dist * ATTRACTION * Math.log1p(edge.weight);
    source.vx += (dx / dist) * force;
    source.vy += (dy / dist) * force;
    target.vx -= (dx / dist) * force;
    target.vy -= (dy / dist) * force;
  }

  // Center pull
  for (const node of nodes) {
    node.vx -= node.x * CENTER_PULL;
    node.vy -= node.y * CENTER_PULL;
  }

  // Apply velocities with damping
  for (const node of nodes) {
    if (node.id === centerNode) {
      node.x = 0;
      node.y = 0;
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

// ── Canvas renderer ──

function renderGraph(
  ctx: CanvasRenderingContext2D,
  nodes: GraphNode[],
  edges: GraphEdge[],
  width: number,
  height: number,
  zoom: number,
  offset: { x: number; y: number },
) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#050510';
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.translate(width / 2 + offset.x, height / 2 + offset.y);
  ctx.scale(zoom, zoom);

  // Draw edges
  for (const edge of edges) {
    const source = nodes.find((n) => n.id === edge.source);
    const target = nodes.find((n) => n.id === edge.target);
    if (!source || !target) continue;

    const alpha = Math.min(0.6, 0.1 + edge.weight * 0.02);
    ctx.strokeStyle = `rgba(100, 180, 255, ${alpha})`;
    ctx.lineWidth = Math.min(3, 0.5 + edge.weight * 0.1);
    ctx.beginPath();
    ctx.moveTo(source.x, source.y);
    ctx.lineTo(target.x, target.y);
    ctx.stroke();
  }

  // Draw nodes
  for (const node of nodes) {
    // Glow
    const gradient = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, node.size * 3);
    gradient.addColorStop(0, node.color + '40');
    gradient.addColorStop(1, 'transparent');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(node.x, node.y, node.size * 3, 0, Math.PI * 2);
    ctx.fill();

    // Node circle
    ctx.fillStyle = node.color;
    ctx.beginPath();
    ctx.arc(node.x, node.y, node.size, 0, Math.PI * 2);
    ctx.fill();

    // Border for center node
    if (node.isCenter) {
      ctx.strokeStyle = '#22d3ee';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.size + 3, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Label
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = `${node.isCenter ? 'bold ' : ''}${node.isCenter ? 11 : 9}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(node.label, node.x, node.y + node.size + 14);
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
  const animRef = useRef<number>(0);

  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [nodeCount, setNodeCount] = useState(0);

  // Fetch constellation data
  useEffect(() => {
    if (!walletAddress) { setLoading(false); return; }

    const fetchData = async () => {
      try {
        const base = getHeliusProxyUrl() || window.location.origin;
        const res = await fetch(`${base}/api/constellation?address=${walletAddress}&depth=2`);
        if (res.ok) {
          const data: ConstellationData = await res.json();
          nodesRef.current = data.nodes;
          edgesRef.current = data.edges;
          setNodeCount(data.nodes.length);
        }
      } catch {}

      // Fallback: generate demo data if API not available
      if (nodesRef.current.length === 0) {
        const centerNode: GraphNode = {
          id: walletAddress,
          label: walletAddress.slice(0, 4) + '...' + walletAddress.slice(-4),
          size: 12,
          x: 0, y: 0, vx: 0, vy: 0,
          color: '#22d3ee',
          isCenter: true,
        };

        const connected: GraphNode[] = [];
        const demoEdges: GraphEdge[] = [];

        // Generate 8-15 random connected wallets for demo
        const count = 8 + Math.floor(Math.random() * 8);
        for (let i = 0; i < count; i++) {
          const angle = (i / count) * Math.PI * 2;
          const dist = 80 + Math.random() * 120;
          const tier = ['mercury', 'mars', 'venus', 'earth', 'neptune', 'saturn'][Math.floor(Math.random() * 6)];
          const fakeAddr = Array.from({ length: 44 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789'[Math.floor(Math.random() * 58)]).join('');

          connected.push({
            id: fakeAddr,
            label: fakeAddr.slice(0, 4) + '...' + fakeAddr.slice(-4),
            tier,
            size: 4 + Math.random() * 6,
            x: Math.cos(angle) * dist + (Math.random() - 0.5) * 40,
            y: Math.sin(angle) * dist + (Math.random() - 0.5) * 40,
            vx: 0, vy: 0,
            color: TIER_COLORS[tier] ?? '#666',
            isCenter: false,
          });

          demoEdges.push({
            source: walletAddress,
            target: fakeAddr,
            weight: 1 + Math.floor(Math.random() * 20),
            totalSol: Math.random() * 10,
          });
        }

        // Add some cross-connections
        for (let i = 0; i < count / 2; i++) {
          const a = Math.floor(Math.random() * connected.length);
          const b = Math.floor(Math.random() * connected.length);
          if (a !== b) {
            demoEdges.push({
              source: connected[a].id,
              target: connected[b].id,
              weight: 1 + Math.floor(Math.random() * 5),
              totalSol: Math.random() * 2,
            });
          }
        }

        nodesRef.current = [centerNode, ...connected];
        edgesRef.current = demoEdges;
        setNodeCount(nodesRef.current.length);
      }

      setLoading(false);
    };

    fetchData();
  }, [walletAddress]);

  // Animation loop
  useEffect(() => {
    if (loading || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio, 2);
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = window.innerWidth + 'px';
      canvas.style.height = window.innerHeight + 'px';
      ctx.scale(dpr, dpr);
    };
    resize();
    window.addEventListener('resize', resize);

    const animate = () => {
      applyForces(nodesRef.current, edgesRef.current, walletAddress);
      renderGraph(ctx, nodesRef.current, edgesRef.current, window.innerWidth, window.innerHeight, zoom, { x: 0, y: 0 });
      animRef.current = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener('resize', resize);
    };
  }, [loading, walletAddress, zoom]);

  return (
    <div className="fixed inset-0 bg-[#050510]">
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 z-10 backdrop-blur-sm bg-[#050510]/50">
        <div className="flex items-center justify-between px-4 py-3">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-white/50 hover:text-white text-sm"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <h1 className="text-sm font-bold text-white/80">✨ Constellation Network</h1>
          <div className="text-white/30 text-xs">{nodeCount} nodes</div>
        </div>
      </div>

      {/* Zoom controls */}
      <div className="absolute bottom-6 right-4 z-10 flex flex-col gap-2">
        <Button size="sm" variant="outline" className="w-9 h-9 p-0 border-white/10" onClick={() => setZoom((z) => Math.min(3, z + 0.3))}>
          <ZoomIn className="w-4 h-4" />
        </Button>
        <Button size="sm" variant="outline" className="w-9 h-9 p-0 border-white/10" onClick={() => setZoom((z) => Math.max(0.3, z - 0.3))}>
          <ZoomOut className="w-4 h-4" />
        </Button>
        <Button size="sm" variant="outline" className="w-9 h-9 p-0 border-white/10" onClick={() => setZoom(1)}>
          <Maximize2 className="w-4 h-4" />
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-full">
          <Loader2 className="w-8 h-8 animate-spin text-white/20" />
        </div>
      ) : (
        <canvas ref={canvasRef} className="w-full h-full" />
      )}
    </div>
  );
}
