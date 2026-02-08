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
const PREVIEW_DIR = path.join(ASSETS_DIR, 'previews');
const BACK_LAYOUT_PATH = path.join(PREVIEW_DIR, 'back-layout.json');

const CARD_WIDTH = 450;
const CARD_HEIGHT = 450;
const CARD_RADIUS = 32;
const CARD_PADDING = 24;

const resolveBadgePath = (badge) => path.join(BADGE_DIR, `${badge}.png`);
const resolvePreviewPath = (tier) => path.join(PREVIEW_DIR, `${tier}.png`);

let backLayoutCache;
const loadBackLayout = () => {
  if (backLayoutCache !== undefined) return backLayoutCache;
  if (!fs.existsSync(BACK_LAYOUT_PATH)) {
    backLayoutCache = null;
    return backLayoutCache;
  }
  try {
    backLayoutCache = JSON.parse(fs.readFileSync(BACK_LAYOUT_PATH, 'utf-8'));
  } catch (error) {
    console.warn('[cardGenerator] Failed to parse back layout', error);
    backLayoutCache = null;
  }
  return backLayoutCache;
};

const BADGE_META = {
  og: {
    label: 'OG Member',
    description: 'Present since the genesis of the system.',
  },
  whale: {
    label: 'Whale',
    description: 'Commands a massive gravitational pull of SOL.',
  },
  collector: {
    label: 'Collector',
    description: 'A museum of NFTs orbits this wallet.',
  },
  binary: {
    label: 'Binary Sun',
    description: 'A rare celestial phenomenon. Dual power.',
  },
  early: {
    label: 'Early Adopter',
    description: 'Arrived before the starlight reached the rest.',
  },
  titan: {
    label: 'Tx Titan',
    description: 'Thousands of transactions. A network pillar.',
  },
  maxi: {
    label: 'Solana Maxi',
    description: 'Bleeds purple and green. Pure loyalty.',
  },
  seeker: {
    label: 'Seeker of Truth',
    description: 'Possesses the ancient Seeker device.',
  },
  visionary: {
    label: 'Visionary',
    description: 'Foresaw the future of the ecosystem.',
  },
};

const BADGE_ORDER = ['og', 'whale', 'collector', 'binary', 'early', 'titan', 'maxi', 'seeker', 'visionary'];

const withAlpha = (color, alpha) => {
  if (!color) return color;
  const match = color.match(/rgba?\(([^)]+)\)/i);
  if (!match) return color;
  const parts = match[1].split(',').map((part) => part.trim());
  const [r, g, b] = parts;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const resolveLayoutTransform = (layout, targetWidth, targetHeight) => {
  const layoutWidth = layout?.width ?? targetWidth;
  const layoutHeight = layout?.height ?? targetHeight;
  const scaleX = layoutWidth ? targetWidth / layoutWidth : 1;
  const scaleY = layoutHeight ? targetHeight / layoutHeight : 1;
  return {
    scaleX,
    scaleY,
    offsetX: 0,
    offsetY: 0,
  };
};

const scaleBox = (box, transform) => {
  if (!box || !transform) return null;
  return {
    x: box.x * transform.scaleX + transform.offsetX,
    y: box.y * transform.scaleY + transform.offsetY,
    width: box.width * transform.scaleX,
    height: box.height * transform.scaleY,
  };
};

const normalizeTextAlign = (align) => {
  if (align === 'start') return 'left';
  if (align === 'end') return 'right';
  return align || 'left';
};

const measureTextWidth = (ctx, text, letterSpacing) => {
  if (!letterSpacing) return ctx.measureText(text).width;
  let width = 0;
  for (const char of String(text)) {
    width += ctx.measureText(char).width + letterSpacing;
  }
  return Math.max(0, width - letterSpacing);
};

const drawTextFromLayout = (ctx, value, layout, overrides = {}, transform) => {
  if (value == null || value === '' || !layout?.box || !layout?.style) return;
  const { box, style } = layout;
  const scaledBox = scaleBox(box, transform);
  if (!scaledBox) return;
  const scale = transform?.scaleY ?? 1;
  const fontSize = (overrides.fontSize ?? style.fontSize ?? 12) * scale;
  const fontWeight = overrides.fontWeight ?? style.fontWeight ?? 'normal';
  const fontFamily = overrides.fontFamily ?? style.fontFamily ?? 'IdentityPrism';
  const textAlign = normalizeTextAlign(overrides.textAlign ?? style.textAlign ?? 'left');
  const letterSpacingRaw = overrides.letterSpacing ?? style.letterSpacing ?? 0;
  const letterSpacing = typeof letterSpacingRaw === 'string'
    ? parseFloat(letterSpacingRaw)
    : Number(letterSpacingRaw) || 0;
  ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  ctx.fillStyle = overrides.color ?? style.color ?? '#FFFFFF';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  const text = String(value);
  const spacing = letterSpacing * scale;
  const textWidth = measureTextWidth(ctx, text, spacing);
  let x = scaledBox.x;
  if (textAlign === 'center') {
    x = scaledBox.x + (scaledBox.width - textWidth) / 2;
  } else if (textAlign === 'right') {
    x = scaledBox.x + scaledBox.width - textWidth;
  }
  const y = scaledBox.y;

  if (spacing) {
    let cursor = x;
    for (const char of text) {
      ctx.fillText(char, cursor, y);
      cursor += ctx.measureText(char).width + spacing;
    }
    return;
  }
  ctx.fillText(text, x, y);
};

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

const TIER_ACCENTS = {
  mercury: '#CBD5F5',
  mars: '#F97316',
  venus: '#FBBF24',
  earth: '#60A5FA',
  neptune: '#38BDF8',
  uranus: '#2DD4BF',
  saturn: '#F59E0B',
  jupiter: '#FB923C',
  sun: '#FACC15',
  binary_sun: '#FDE047',
};

const PLANET_RADII = {
  mercury: 88,
  mars: 94,
  venus: 103,
  earth: 109,
  neptune: 116,
  uranus: 119,
  saturn: 125,
  jupiter: 140,
  sun: 147,
  binary_sun: 106,
};

const getPlanetRadius = (tier) => PLANET_RADII[tier] ?? PLANET_RADII.mercury;

const resolveTexturePath = (tier) => path.join(
  TEXTURE_DIR,
  TIER_TEXTURES[tier] ?? TIER_TEXTURES.mercury,
);

const frontCache = new Map();

const createSeededRandom = (seed) => {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 2147483647;
  }
  return () => {
    hash = (hash * 1103515245 + 12345) % 2147483647;
    return hash / 2147483647;
  };
};

const drawStarfield = (ctx, width, height, seed, count) => {
  const rand = createSeededRandom(seed);
  for (let i = 0; i < count; i += 1) {
    const x = rand() * width;
    const y = rand() * height;
    const radius = rand() * 1.6 + 0.3;
    const alpha = rand() * 0.55 + 0.15;
    ctx.fillStyle = `rgba(226, 232, 240, ${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
};

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

const drawPlanetGlow = (ctx, centerX, centerY, radius, color, intensity = 1) => {
  const glow = ctx.createRadialGradient(
    centerX,
    centerY,
    radius * 0.35,
    centerX,
    centerY,
    radius * 1.35,
  );
  glow.addColorStop(0, `${color}${Math.round(70 * intensity).toString(16).padStart(2, '0')}`);
  glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius * 1.35, 0, Math.PI * 2);
  ctx.fill();
};

const drawPlanetShading = (ctx, centerX, centerY, radius) => {
  const shade = ctx.createRadialGradient(
    centerX - radius * 0.35,
    centerY - radius * 0.35,
    radius * 0.2,
    centerX,
    centerY,
    radius,
  );
  shade.addColorStop(0, 'rgba(255, 255, 255, 0.5)');
  shade.addColorStop(0.6, 'rgba(255, 255, 255, 0)');
  shade.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
  ctx.fillStyle = shade;
  ctx.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2);
};

const drawTexturedPlanet = (ctx, centerX, centerY, radius, texture, glowColor) => {
  ctx.save();
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(
    texture,
    centerX - radius,
    centerY - radius,
    radius * 2,
    radius * 2,
  );
  drawPlanetShading(ctx, centerX, centerY, radius);
  ctx.restore();

  drawPlanetGlow(ctx, centerX, centerY, radius, glowColor, 1);

  ctx.strokeStyle = 'rgba(226, 232, 240, 0.32)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius + 2, 0, Math.PI * 2);
  ctx.stroke();
};

const drawFallbackPlanet = (ctx, centerX, centerY, radius, glowColor) => {
  const planetGlow = ctx.createRadialGradient(
    centerX - radius * 0.25,
    centerY - radius * 0.35,
    radius * 0.2,
    centerX,
    centerY,
    radius,
  );
  planetGlow.addColorStop(0, '#FFFFFF');
  planetGlow.addColorStop(0.4, glowColor);
  planetGlow.addColorStop(1, '#1E293B');
  ctx.fillStyle = planetGlow;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.fill();
};

const drawStarBody = (ctx, centerX, centerY, radius, colors) => {
  const gradient = ctx.createRadialGradient(
    centerX - radius * 0.25,
    centerY - radius * 0.25,
    radius * 0.2,
    centerX,
    centerY,
    radius,
  );
  gradient.addColorStop(0, colors.core);
  gradient.addColorStop(0.65, colors.mid);
  gradient.addColorStop(1, colors.edge);

  ctx.save();
  ctx.shadowColor = colors.glow;
  ctx.shadowBlur = radius * 0.45;
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  drawPlanetGlow(ctx, centerX, centerY, radius, colors.glow, 1.1);
};

const drawSaturnRing = (ctx, centerX, centerY, radius, front = false) => {
  const ringOuter = radius * 1.75;
  const ringInner = radius * 1.15;
  ctx.save();
  ctx.translate(centerX, centerY + radius * 0.22);
  ctx.rotate(-0.22);
  ctx.scale(1, 0.35);
  if (front) {
    ctx.beginPath();
    ctx.rect(-ringOuter, 0, ringOuter * 2, ringOuter);
    ctx.clip();
  }
  ctx.beginPath();
  ctx.arc(0, 0, ringOuter, 0, Math.PI * 2);
  ctx.arc(0, 0, ringInner, 0, Math.PI * 2, true);
  ctx.closePath();
  const ringGradient = ctx.createLinearGradient(-ringOuter, 0, ringOuter, 0);
  ringGradient.addColorStop(0, 'rgba(196, 166, 118, 0)');
  ringGradient.addColorStop(0.2, 'rgba(228, 208, 172, 0.6)');
  ringGradient.addColorStop(0.5, 'rgba(250, 231, 198, 0.85)');
  ringGradient.addColorStop(0.8, 'rgba(196, 166, 118, 0.6)');
  ringGradient.addColorStop(1, 'rgba(196, 166, 118, 0)');
  ctx.fillStyle = ringGradient;
  ctx.globalAlpha = front ? 0.8 : 0.55;
  ctx.fill();
  ctx.restore();
};

export const drawFrontCard = (tier) => {
  const baseUrl = (process.env.PUBLIC_BASE_URL ?? '').replace(/\/+$/, '');
  const texture = TIER_TEXTURES[tier] ?? TIER_TEXTURES.mercury;
  return baseUrl ? `${baseUrl}/textures/${texture}` : `https://identityprism.xyz/textures/${texture}`;
};

export const drawFrontCardImage = async (tier = 'mercury', badges = []) => {
  const normalizedTier = String(tier || 'mercury');
  const badgeKey = Array.isArray(badges) && badges.length ? badges.join(',') : '';
  const cacheKey = badgeKey ? `${normalizedTier}:${badgeKey}` : normalizedTier;
  if (frontCache.has(cacheKey)) {
    return frontCache.get(cacheKey);
  }

  const { createCanvas, loadImage, registerFont } = await loadCanvas();
  ensureFont(registerFont);
  const canvas = createCanvas(CARD_WIDTH, CARD_HEIGHT);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const accent = TIER_ACCENTS[normalizedTier] ?? '#60A5FA';
  const previewPath = resolvePreviewPath(normalizedTier);

  if (fs.existsSync(previewPath)) {
    const previewImage = await loadImage(previewPath);
    ctx.drawImage(previewImage, 0, 0, CARD_WIDTH, CARD_HEIGHT);
  } else {
    const background = ctx.createLinearGradient(0, 0, 0, CARD_HEIGHT);
    background.addColorStop(0, '#05070F');
    background.addColorStop(0.55, '#0B1020');
    background.addColorStop(1, '#020617');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

    const nebula = ctx.createRadialGradient(
      CARD_WIDTH * 0.25,
      CARD_HEIGHT * 0.25,
      40,
      CARD_WIDTH * 0.25,
      CARD_HEIGHT * 0.25,
      CARD_WIDTH * 0.9,
    );
    nebula.addColorStop(0, `${accent}55`);
    nebula.addColorStop(0.4, `${accent}22`);
    nebula.addColorStop(1, 'rgba(15, 23, 42, 0)');
    ctx.fillStyle = nebula;
    ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

    drawStarfield(ctx, CARD_WIDTH, CARD_HEIGHT, `${normalizedTier}-front`, 140);

    drawRoundedRect(
      ctx,
      CARD_PADDING,
      CARD_PADDING,
      CARD_WIDTH - CARD_PADDING * 2,
      CARD_HEIGHT - CARD_PADDING * 2,
      CARD_RADIUS,
    );
    ctx.fillStyle = 'rgba(3, 7, 18, 0.96)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
    ctx.lineWidth = 2;
    ctx.stroke();

    const headerLabelY = Math.round(CARD_HEIGHT * 0.11);
    const headerTitleY = Math.round(CARD_HEIGHT * 0.16);
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(186, 230, 253, 0.55)';
    ctx.font = 'bold 12px IdentityPrism';
    ctx.fillText('TIER LEVEL', CARD_WIDTH / 2, headerLabelY);
    ctx.fillStyle = accent;
    ctx.font = 'bold 26px IdentityPrism';
    ctx.fillText(normalizedTier.replace(/_/g, ' ').toUpperCase(), CARD_WIDTH / 2, headerTitleY);

    const isBinary = normalizedTier === 'binary_sun';
    const planetY = Math.round(CARD_HEIGHT * 0.56);
    const baseRadius = getPlanetRadius(normalizedTier);
    const texturePath = resolveTexturePath(normalizedTier);

    if (isBinary) {
      const leftRadius = baseRadius + 10;
      const rightRadius = baseRadius - 8;
      const offset = 95;
      const leftX = CARD_WIDTH / 2 - offset;
      const rightX = CARD_WIDTH / 2 + offset;

      drawStarBody(ctx, leftX, planetY, leftRadius, {
        core: '#FFF6C9',
        mid: '#FFCF5C',
        edge: '#FF8A1D',
        glow: '#FFB200',
      });
      drawStarBody(ctx, rightX, planetY, rightRadius, {
        core: '#E6F7FF',
        mid: '#8DD3FF',
        edge: '#2B8CFF',
        glow: '#7CC7FF',
      });

      const bridgeStart = leftX + leftRadius * 0.6;
      const bridgeEnd = rightX - rightRadius * 0.6;
      const bridge = ctx.createLinearGradient(bridgeStart, planetY, bridgeEnd, planetY);
      bridge.addColorStop(0, 'rgba(255, 196, 94, 0)');
      bridge.addColorStop(0.2, 'rgba(255, 210, 120, 0.7)');
      bridge.addColorStop(0.5, 'rgba(255, 255, 255, 0.95)');
      bridge.addColorStop(0.8, 'rgba(124, 199, 255, 0.7)');
      bridge.addColorStop(1, 'rgba(124, 199, 255, 0)');
      ctx.save();
      ctx.strokeStyle = bridge;
      ctx.lineWidth = 10;
      ctx.lineCap = 'round';
      ctx.shadowColor = 'rgba(255, 255, 255, 0.65)';
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.moveTo(bridgeStart, planetY);
      ctx.lineTo(bridgeEnd, planetY);
      ctx.stroke();
      ctx.restore();
    } else if (normalizedTier === 'sun') {
      drawStarBody(ctx, CARD_WIDTH / 2, planetY, baseRadius, {
        core: '#FFF7C4',
        mid: '#FFD36A',
        edge: '#FF9F1C',
        glow: '#FFB703',
      });
    } else if (fs.existsSync(texturePath)) {
      const planetTexture = await loadImage(texturePath);
      if (normalizedTier === 'saturn') {
        drawSaturnRing(ctx, CARD_WIDTH / 2, planetY, baseRadius, false);
      }
      drawTexturedPlanet(ctx, CARD_WIDTH / 2, planetY, baseRadius, planetTexture, accent);
      if (normalizedTier === 'saturn') {
        drawSaturnRing(ctx, CARD_WIDTH / 2, planetY, baseRadius, true);
      }
    } else {
      drawFallbackPlanet(ctx, CARD_WIDTH / 2, planetY, baseRadius, accent);
    }
  }

  const frontBadges = Array.isArray(badges) ? badges.filter(Boolean).slice(0, 5) : [];
  if (frontBadges.length) {
    const badgeSize = 40;
    const badgeGap = 10;
    const badgeRowWidth = frontBadges.length * badgeSize + (frontBadges.length - 1) * badgeGap;
    const startX = (CARD_WIDTH - badgeRowWidth) / 2;
    const badgeY = Math.round(CARD_HEIGHT * 0.82);
    const dividerY = badgeY - 28;
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(CARD_PADDING + 16, dividerY);
    ctx.lineTo(CARD_WIDTH - CARD_PADDING - 16, dividerY);
    ctx.stroke();

    for (let i = 0; i < frontBadges.length; i += 1) {
      const badge = frontBadges[i];
      const badgePath = resolveBadgePath(badge);
      if (!fs.existsSync(badgePath)) continue;
      const image = await loadImage(badgePath);
      const x = startX + i * (badgeSize + badgeGap);
      ctx.drawImage(image, x, badgeY, badgeSize, badgeSize);
    }
  }

  const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
  frontCache.set(cacheKey, dataUrl);
  return dataUrl;
};

export const drawBackCard = async (stats, badges, options = {}) => {
  const { createCanvas, loadImage, registerFont } = await loadCanvas();
  ensureFont(registerFont);
  const width = CARD_WIDTH;
  const height = CARD_HEIGHT;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const tab = options?.tab === 'badges' ? 'badges' : 'stats';
  const layoutBundle = loadBackLayout();
  const layout = layoutBundle?.[tab];
  const backPreviewPath = path.join(PREVIEW_DIR, `back-${tab}.png`);
  if (layout && fs.existsSync(backPreviewPath)) {
    const backPreview = await loadImage(backPreviewPath);
    ctx.drawImage(backPreview, 0, 0, width, height);
    const transform = resolveLayoutTransform(layout, width, height);

    if (tab === 'stats') {
      const scoreValue = stats?.score != null ? String(stats.score) : '';
      const addressValue = stats?.address ?? '';
      drawTextFromLayout(ctx, scoreValue, layout.score, {}, transform);
      drawTextFromLayout(ctx, addressValue, layout.address, {}, transform);

      const activityValue = stats
        ? (stats.txCount / Math.max(stats.ageDays ?? 1, 1)).toFixed(2)
        : '';
      const statValues = {
        sol: stats?.solBalance != null ? Number(stats.solBalance).toFixed(2) : '',
        age: stats?.ageDays != null ? `${stats.ageDays}d` : '',
        tx: stats?.txCount != null ? String(stats.txCount) : '',
        nfts: stats?.nftCount != null ? String(stats.nftCount) : '',
        activity: activityValue,
        dormancy: 'Active',
      };

      if (layout.stats) {
        Object.entries(layout.stats).forEach(([key, statLayout]) => {
          drawTextFromLayout(ctx, statValues[key] ?? '', statLayout, { textAlign: 'center' }, transform);
        });
      }
    } else if (tab === 'badges' && layout.badges) {
      const badgeSet = new Set((badges ?? []).map((badge) => String(badge)));
      const orderedBadges = [
        ...BADGE_ORDER.filter((badge) => badgeSet.has(badge)),
        ...BADGE_ORDER.filter((badge) => !badgeSet.has(badge)),
      ];

      for (let i = 0; i < layout.badges.length; i += 1) {
        const badgeKey = orderedBadges[i];
        if (!badgeKey) continue;
        const badgeMeta = BADGE_META[badgeKey];
        if (!badgeMeta) continue;
        const isActive = badgeSet.has(badgeKey);
        const alpha = isActive ? 1 : 0.35;
        const rowLayout = layout.badges[i];

        if (rowLayout?.icon?.box) {
          const iconBox = scaleBox(rowLayout.icon.box, transform);
          const badgePath = resolveBadgePath(badgeKey);
          if (iconBox && fs.existsSync(badgePath)) {
            const iconImage = await loadImage(badgePath);
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.drawImage(iconImage, iconBox.x, iconBox.y, iconBox.width, iconBox.height);
            ctx.restore();
          }
        }

        const labelColor = isActive
          ? rowLayout?.label?.style?.color
          : withAlpha(rowLayout?.label?.style?.color, 0.45);
        drawTextFromLayout(
          ctx,
          badgeMeta.label,
          rowLayout?.label,
          { color: labelColor, textAlign: 'center' },
          transform,
        );

        const descColor = isActive
          ? rowLayout?.desc?.style?.color
          : withAlpha(rowLayout?.desc?.style?.color, 0.35);
        drawTextFromLayout(
          ctx,
          badgeMeta.description,
          rowLayout?.desc,
          { color: descColor, textAlign: 'center' },
          transform,
        );
      }
    }

    return canvas.toDataURL('image/jpeg', 0.92);
  }
  const background = ctx.createLinearGradient(0, 0, 0, height);
  background.addColorStop(0, '#030712');
  background.addColorStop(0.6, '#0B1020');
  background.addColorStop(1, '#020617');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  drawStarfield(ctx, width, height, 'back', 100);

  drawRoundedRect(
    ctx,
    CARD_PADDING,
    CARD_PADDING,
    width - CARD_PADDING * 2,
    height - CARD_PADDING * 2,
    CARD_RADIUS,
  );
  ctx.fillStyle = 'rgba(6, 12, 26, 0.95)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = '#E0F2FE';
  ctx.font = 'bold 20px IdentityPrism';
  ctx.textAlign = 'center';
  ctx.fillText('IDENTITY PRISM', width / 2, 52);

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

  const labelX = 34;
  const slotX = 182;
  const slotWidth = width - slotX - 34;
  const slotHeight = 20;
  const statStartY = 96;
  const rowGap = 30;

  statRows.forEach((row, index) => {
    const y = statStartY + index * rowGap;
    ctx.fillStyle = '#BAE6FD';
    ctx.font = '12px IdentityPrism';
    ctx.textAlign = 'left';
    ctx.fillText(row.label, labelX, y);

    ctx.strokeStyle = 'rgba(226, 232, 240, 0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(slotX, y - 12, slotWidth, slotHeight);

    if (row.value) {
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'right';
      ctx.font = '12px IdentityPrism';
      ctx.fillText(row.value, slotX + slotWidth - 8, y);
    }
  });

  const badgeSize = 46;
  const badgeGap = 12;
  const badgesPerRow = 4;
  const startX = (width - badgesPerRow * badgeSize - (badgesPerRow - 1) * badgeGap) / 2;
  const badgeStartY = height - 140;

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
