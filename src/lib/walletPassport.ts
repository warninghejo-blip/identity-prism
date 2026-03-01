/**
 * Wallet Passport — generates a shareable identity card image.
 * Uses Canvas 2D API to draw a styled passport card with tier, score, badges, sybil status.
 * No external dependencies — pure Canvas.
 */

import type { WalletTraits } from '@/hooks/useWalletData';

const TIER_COLORS: Record<string, string> = {
  mercury: '#a8a29e', mars: '#fb923c', venus: '#fde047', earth: '#60a5fa',
  neptune: '#22d3ee', uranus: '#7dd3fc', saturn: '#fcd34d', jupiter: '#fdba74',
  sun: '#facc15', binary_sun: '#fbbf24',
};

const TIER_LABELS: Record<string, string> = {
  mercury: 'MERCURY', mars: 'MARS', venus: 'VENUS', earth: 'EARTH',
  neptune: 'NEPTUNE', uranus: 'URANUS', saturn: 'SATURN', jupiter: 'JUPITER',
  sun: 'SUN', binary_sun: 'BINARY SUN',
};

interface PassportData {
  address: string;
  score: number;
  traits: WalletTraits;
  sybilRiskLevel?: string;
  sybilRiskScore?: number;
  forgeTitle?: string;
  prismBalance?: number;
}

/**
 * Generate a wallet passport image as a data URL.
 * Returns a PNG data URL suitable for sharing or downloading.
 */
export async function generatePassportImage(data: PassportData): Promise<string> {
  const W = 600;
  const H = 340;
  const canvas = document.createElement('canvas');
  canvas.width = W * 2; // 2x for retina
  canvas.height = H * 2;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(2, 2);

  const tier = data.traits.planetTier;
  const tierColor = TIER_COLORS[tier] || '#fff';
  const tierLabel = TIER_LABELS[tier] || tier.toUpperCase();

  // Background gradient
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0a0e1a');
  bg.addColorStop(0.5, '#0d1424');
  bg.addColorStop(1, '#060a14');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Stars
  for (let i = 0; i < 60; i++) {
    const x = Math.random() * W;
    const y = Math.random() * H;
    const r = Math.random() * 1.2;
    const alpha = 0.2 + Math.random() * 0.3;
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Border
  ctx.strokeStyle = tierColor + '40';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(8, 8, W - 16, H - 16, 16);
  ctx.stroke();

  // Inner glow border
  ctx.strokeStyle = tierColor + '15';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(14, 14, W - 28, H - 28, 12);
  ctx.stroke();

  // Header — "IDENTITY PRISM PASSPORT"
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.font = 'bold 9px sans-serif';
  ctx.letterSpacing = '3px';
  ctx.textAlign = 'center';
  ctx.fillText('IDENTITY PRISM PASSPORT', W / 2, 36);

  // Tier label
  ctx.fillStyle = tierColor;
  ctx.font = 'bold 36px sans-serif';
  ctx.textAlign = 'center';
  ctx.shadowColor = tierColor;
  ctx.shadowBlur = 20;
  ctx.fillText(tierLabel, W / 2, 80);
  ctx.shadowBlur = 0;

  // Forge title
  if (data.forgeTitle) {
    ctx.fillStyle = '#c084fc99';
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText(`"${data.forgeTitle}"`, W / 2, 96);
  }

  // Score
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 48px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(String(data.score), W / 2, 150);
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.font = '10px sans-serif';
  ctx.fillText('IDENTITY SCORE', W / 2, 166);

  // Stats grid
  const stats = [
    { label: 'SOL', value: data.traits.solBalance.toFixed(2) },
    { label: 'AGE', value: `${data.traits.walletAgeDays}d` },
    { label: 'TX', value: data.traits.txCount.toLocaleString() },
    { label: 'NFTs', value: String(data.traits.nftCount) },
    { label: 'TOKENS', value: String(data.traits.uniqueTokenCount) },
  ];

  const gridY = 190;
  const gridW = 100;
  const gridStartX = (W - stats.length * gridW) / 2;

  stats.forEach((stat, i) => {
    const x = gridStartX + i * gridW + gridW / 2;
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(stat.value, x, gridY);
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.font = '8px sans-serif';
    ctx.fillText(stat.label, x, gridY + 14);
  });

  // Divider
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(40, 220);
  ctx.lineTo(W - 40, 220);
  ctx.stroke();

  // Address
  const shortAddr = data.address.slice(0, 6) + '...' + data.address.slice(-6);
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.font = '11px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(shortAddr, W / 2, 242);

  // Sybil risk badge
  if (data.sybilRiskLevel) {
    const riskColors: Record<string, string> = {
      clean: '#22c55e', low: '#84cc16', medium: '#f59e0b', high: '#ef4444', critical: '#dc2626',
    };
    const riskColor = riskColors[data.sybilRiskLevel] || '#666';
    ctx.fillStyle = riskColor + '20';
    ctx.beginPath();
    ctx.roundRect(40, 258, 120, 26, 6);
    ctx.fill();
    ctx.strokeStyle = riskColor + '40';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = riskColor;
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`🛡️ SYBIL: ${data.sybilRiskLevel.toUpperCase()}`, 50, 275);
  }

  // PRISM balance
  if (data.prismBalance !== undefined) {
    ctx.fillStyle = 'rgba(139,92,246,0.15)';
    ctx.beginPath();
    ctx.roundRect(W - 160, 258, 120, 26, 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(139,92,246,0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#c084fc';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`💎 ${data.prismBalance} PRISM`, W - 50, 275);
  }

  // Badge count
  let badgeCount = 0;
  if (data.traits.isOG) badgeCount++;
  if (data.traits.isWhale) badgeCount++;
  if (data.traits.isCollector) badgeCount++;
  if (data.traits.isEarlyAdopter) badgeCount++;
  if (data.traits.isTxTitan) badgeCount++;
  if (data.traits.isSolanaMaxi) badgeCount++;
  if (data.traits.isBlueChip) badgeCount++;
  if (data.traits.isDeFiKing) badgeCount++;
  if (data.traits.isMemeLord) badgeCount++;
  if (data.traits.diamondHands) badgeCount++;
  if (data.traits.hasSeeker) badgeCount++;
  if (data.traits.hasCombo) badgeCount++;
  if (data.traits.hasPreorder) badgeCount++;

  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`${badgeCount} BADGES`, W / 2, 275);

  // Footer
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  ctx.font = '8px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('identityprism.xyz — Solana On-Chain Identity', W / 2, H - 18);

  // Watermark date
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.font = '7px monospace';
  ctx.textAlign = 'right';
  ctx.fillText(new Date().toISOString().split('T')[0], W - 20, H - 18);

  return canvas.toDataURL('image/png');
}

/**
 * Download the passport image.
 */
export function downloadPassport(dataUrl: string, address: string): void {
  const link = document.createElement('a');
  link.download = `identity-prism-${address.slice(0, 8)}.png`;
  link.href = dataUrl;
  link.click();
}

/**
 * Share passport via Web Share API (mobile) or copy to clipboard (desktop).
 */
export async function sharePassport(dataUrl: string, address: string): Promise<boolean> {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const file = new File([blob], `identity-prism-${address.slice(0, 8)}.png`, { type: 'image/png' });

    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({
        title: 'My Identity Prism Passport',
        text: `Check out my Solana Identity — ${TIER_LABELS[address] || 'Identity Prism'}`,
        files: [file],
      });
      return true;
    }
  } catch {}

  // Fallback: copy image to clipboard
  try {
    const blob = await (await fetch(dataUrl)).blob();
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch {}

  return false;
}
