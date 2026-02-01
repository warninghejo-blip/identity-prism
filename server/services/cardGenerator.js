import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(MODULE_DIR, '..');
const LOCAL_ASSETS_DIR = path.join(ROOT_DIR, 'assets');
const SERVER_ASSETS_DIR = path.join(ROOT_DIR, 'server', 'assets');
const ASSETS_DIR = fs.existsSync(LOCAL_ASSETS_DIR) ? LOCAL_ASSETS_DIR : SERVER_ASSETS_DIR;
const LIB_DIR = path.join(ROOT_DIR, '.libs');
const FONT_PATH = path.join(ASSETS_DIR, 'fonts', 'font.ttf');
const TEMPLATE_PATH = path.join(ASSETS_DIR, 'card-back-template.png');
const BADGE_DIR = path.join(ASSETS_DIR, 'badges');
const TEXTURE_DIR = path.join(ASSETS_DIR, 'textures');

const CARD_WIDTH = 400;
const CARD_HEIGHT = 600;

const resolveBadgePath = (badge) => path.join(BADGE_DIR, `${badge}.png`);

const ensureLibraryPath = () => {
  const current = process.env.LD_LIBRARY_PATH ?? '';
  const parts = current.split(':').filter(Boolean);
  const candidates = ['/lib', '/usr/lib', LIB_DIR];
  candidates.forEach((dir) => {
    if (fs.existsSync(dir) && !parts.includes(dir)) {
      parts.push(dir);
    }
  });
  if (parts.length) {
    process.env.LD_LIBRARY_PATH = parts.join(':');
  }
};

let canvasModule;
const loadCanvas = async () => {
  if (!canvasModule) {
    ensureLibraryPath();
    canvasModule = await import('canvas');
  }
  return canvasModule;
};

const ensureFont = (registerFont) => {
  if (fs.existsSync(FONT_PATH)) {
    registerFont(FONT_PATH, { family: 'IdentityPrism' });
  }
};

const TIER_TEXTURES = {
  mercury: 'mercury_map.jpg',
  mars: 'mars_map.jpg',
  venus: 'venus_map.jpg',
  earth: 'earth_daymap.jpg',
  neptune: 'neptune_map.jpg',
  uranus: 'uranus_map.jpg',
  saturn: 'saturn_map.jpg',
  jupiter: 'jupiter_map.jpg',
  sun: 'sun_map.jpg',
  binary_sun: 'sun_map.jpg',
};

const resolveTexturePath = (tier) => path.join(
  TEXTURE_DIR,
  TIER_TEXTURES[tier] ?? TIER_TEXTURES.mercury,
);

const frontCache = new Map();

const drawRoundedRect = (ctx, x, y, width, height, radius) => {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
};

export const drawFrontCard = (tier) => {
  const baseUrl = (process.env.PUBLIC_BASE_URL ?? '').replace(/\/+$/, '');
  const texture = TIER_TEXTURES[tier] ?? TIER_TEXTURES.mercury;
  return baseUrl ? `${baseUrl}/textures/${texture}` : `https://identityprism.xyz/textures/${texture}`;
};

export const drawFrontCardImage = async (tier = 'mercury') => {
  const normalizedTier = String(tier || 'mercury');
  if (frontCache.has(normalizedTier)) {
    return frontCache.get(normalizedTier);
  }

  const { createCanvas, loadImage, registerFont } = await loadCanvas();
  ensureFont(registerFont);
  const canvas = createCanvas(CARD_WIDTH, CARD_HEIGHT);
  const ctx = canvas.getContext('2d');

  const background = ctx.createLinearGradient(0, 0, 0, CARD_HEIGHT);
  background.addColorStop(0, '#0B1120');
  background.addColorStop(0.55, '#0F172A');
  background.addColorStop(1, '#020617');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  drawRoundedRect(ctx, 18, 18, CARD_WIDTH - 36, CARD_HEIGHT - 36, 26);
  ctx.fillStyle = 'rgba(8, 15, 30, 0.92)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.fillStyle = '#E0F2FE';
  ctx.font = 'bold 26px IdentityPrism';
  ctx.fillText('IDENTITY PRISM', CARD_WIDTH / 2, 70);

  const planetRadius = 140;
  const planetY = 300;
  const texturePath = resolveTexturePath(normalizedTier);
  if (fs.existsSync(texturePath)) {
    const planetTexture = await loadImage(texturePath);
    ctx.save();
    ctx.beginPath();
    ctx.arc(CARD_WIDTH / 2, planetY, planetRadius, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(
      planetTexture,
      CARD_WIDTH / 2 - planetRadius,
      planetY - planetRadius,
      planetRadius * 2,
      planetRadius * 2,
    );
    ctx.restore();
  } else {
    const planetGlow = ctx.createRadialGradient(
      CARD_WIDTH / 2 - 40,
      planetY - 60,
      20,
      CARD_WIDTH / 2,
      planetY,
      planetRadius,
    );
    planetGlow.addColorStop(0, '#FFFFFF');
    planetGlow.addColorStop(0.4, '#60A5FA');
    planetGlow.addColorStop(1, '#1E293B');
    ctx.fillStyle = planetGlow;
    ctx.beginPath();
    ctx.arc(CARD_WIDTH / 2, planetY, planetRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.strokeStyle = 'rgba(226, 232, 240, 0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(CARD_WIDTH / 2, planetY, planetRadius + 6, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = '#BAE6FD';
  ctx.font = 'bold 20px IdentityPrism';
  ctx.fillText(normalizedTier.replace(/_/g, ' ').toUpperCase(), CARD_WIDTH / 2, 520);

  ctx.fillStyle = 'rgba(226, 232, 240, 0.7)';
  ctx.font = '14px IdentityPrism';
  ctx.fillText('COSMIC IDENTITY CARD', CARD_WIDTH / 2, 548);

  const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
  frontCache.set(normalizedTier, dataUrl);
  return dataUrl;
};

export const drawBackCard = async (stats, badges) => {
  const { createCanvas, loadImage, registerFont } = await loadCanvas();
  ensureFont(registerFont);
  const template = await loadImage(TEMPLATE_PATH);
  const width = template.width || CARD_WIDTH;
  const height = template.height || CARD_HEIGHT;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.drawImage(template, 0, 0, width, height);

  ctx.fillStyle = '#E0F2FE';
  ctx.font = 'bold 30px IdentityPrism';
  ctx.textAlign = 'center';
  ctx.fillText('IDENTITY PRISM', width / 2, 60);

  const safeStats = stats ?? {};
  const statRows = [
    { label: 'Score', value: safeStats.score != null ? String(safeStats.score) : '' },
    { label: 'Address', value: safeStats.address ?? '' },
    { label: 'Age (days)', value: safeStats.ageDays != null ? String(safeStats.ageDays) : '' },
    { label: 'Tx Count', value: safeStats.txCount != null ? String(safeStats.txCount) : '' },
    { label: 'SOL', value: safeStats.solBalance != null ? Number(safeStats.solBalance).toFixed(2) : '' },
    { label: 'Tokens', value: safeStats.tokenCount != null ? String(safeStats.tokenCount) : '' },
    { label: 'NFTs', value: safeStats.nftCount != null ? String(safeStats.nftCount) : '' },
  ];

  const labelX = 40;
  const slotX = 165;
  const slotWidth = width - slotX - 40;
  const slotHeight = 22;
  const startY = 130;
  const rowGap = 34;

  statRows.forEach((row, index) => {
    const y = startY + index * rowGap;
    ctx.fillStyle = '#BAE6FD';
    ctx.font = '16px IdentityPrism';
    ctx.textAlign = 'left';
    ctx.fillText(row.label, labelX, y);

    ctx.strokeStyle = 'rgba(226, 232, 240, 0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(slotX, y - 16, slotWidth, slotHeight);

    if (row.value) {
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'right';
      ctx.font = '16px IdentityPrism';
      ctx.fillText(row.value, slotX + slotWidth - 8, y);
    }
  });

  const badgeSize = 64;
  const badgeGap = 14;
  const badgesPerRow = 4;
  const startX = (width - badgesPerRow * badgeSize - (badgesPerRow - 1) * badgeGap) / 2;
  const badgeStartY = height - 150;

  for (let i = 0; i < 8; i += 1) {
    const row = Math.floor(i / badgesPerRow);
    const col = i % badgesPerRow;
    const x = startX + col * (badgeSize + badgeGap);
    const y = badgeStartY + row * (badgeSize + badgeGap);
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, badgeSize, badgeSize);
  }

  const badgesToDraw = (badges ?? []).slice(0, 8);
  for (let i = 0; i < badgesToDraw.length; i += 1) {
    const badge = badgesToDraw[i];
    const badgePath = resolveBadgePath(badge);
    if (!fs.existsSync(badgePath)) continue;
    const image = await loadImage(badgePath);
    const row = Math.floor(i / badgesPerRow);
    const col = i % badgesPerRow;
    const x = startX + col * (badgeSize + badgeGap);
    const y = badgeStartY + row * (badgeSize + badgeGap);
    ctx.drawImage(image, x, y, badgeSize, badgeSize);
  }

  return canvas.toDataURL('image/jpeg', 0.92);
};
