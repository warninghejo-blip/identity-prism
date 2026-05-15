export interface ShipProfile {
  exhausts: { x: number; y: number }[];
  singleGun: { x: number; y: number };
  doubleGuns: [{ x: number; y: number }, { x: number; y: number }];
  cockpitY: number;
  /** Sprite vertical offset for ships with bottom padding */
  spriteYOff?: number;
  /** Trail base color [r, g, b] in 0–1 range */
  trailColor: [number, number, number];
  /** Special trail style */
  trailStyle?: 'bio';
}

const PROFILES: Record<string, ShipProfile> = {
  default: {
    exhausts: [
      { x: -0.28, y: -0.95 },
      { x: 0.28, y: -0.95 },
    ],
    singleGun: { x: 0, y: 0.85 },
    doubleGuns: [
      { x: -0.25, y: 0.85 },
      { x: 0.25, y: 0.85 },
    ],
    cockpitY: 0.15,
    trailColor: [0.3, 0.85, 1.0], // cyan
  },
  cargo: {
    exhausts: [
      { x: -0.32, y: -1.0 },
      { x: 0.32, y: -1.0 },
    ],
    singleGun: { x: 0, y: 0.6 },
    doubleGuns: [
      { x: -0.28, y: 0.55 },
      { x: 0.28, y: 0.55 },
    ],
    cockpitY: 0.0,
    trailColor: [0.9, 0.6, 0.2], // warm orange
  },
  cargo_b: {
    exhausts: [
      { x: -0.28, y: -1.0 },
      { x: 0, y: -1.0 },
      { x: 0.28, y: -1.0 },
    ],
    singleGun: { x: 0, y: 0.65 },
    doubleGuns: [
      { x: -0.22, y: 0.65 },
      { x: 0.22, y: 0.65 },
    ],
    cockpitY: 0.05,
    trailColor: [0.95, 0.7, 0.3], // bright orange
  },
  crystal: {
    exhausts: [{ x: 0, y: -0.85 }],
    singleGun: { x: 0, y: 0.75 },
    doubleGuns: [
      { x: -0.18, y: 0.65 },
      { x: 0.18, y: 0.65 },
    ],
    cockpitY: 0.1,
    trailColor: [0.6, 0.2, 0.9], // purple
  },
  crystal_b: {
    exhausts: [{ x: 0, y: -0.8 }],
    singleGun: { x: 0, y: 0.75 },
    doubleGuns: [
      { x: -0.18, y: 0.65 },
      { x: 0.18, y: 0.65 },
    ],
    cockpitY: -0.05,
    trailColor: [0.3, 0.85, 0.6], // teal-green
  },
  fighter: {
    exhausts: [
      { x: -0.28, y: -0.85 },
      { x: 0.28, y: -0.85 },
    ],
    singleGun: { x: 0, y: 0.8 },
    doubleGuns: [
      { x: -0.38, y: 0.45 },
      { x: 0.38, y: 0.45 },
    ],
    cockpitY: 0.25,
    trailColor: [0.4, 0.95, 1.0], // bright cyan
  },
  fighter_b: {
    exhausts: [
      { x: -0.2, y: -0.95 },
      { x: 0.2, y: -0.95 },
    ],
    singleGun: { x: 0, y: 0.9 },
    doubleGuns: [
      { x: -0.15, y: 0.8 },
      { x: 0.15, y: 0.8 },
    ],
    cockpitY: 0.2,
    trailColor: [0.3, 0.9, 0.95], // icy cyan
  },
  fortress: {
    exhausts: [
      { x: -0.25, y: -0.7 },
      { x: 0.25, y: -0.7 },
    ],
    singleGun: { x: 0, y: 0.8 },
    doubleGuns: [
      { x: -0.3, y: 0.55 },
      { x: 0.3, y: 0.55 },
    ],
    cockpitY: 0.05,
    trailColor: [0.85, 0.7, 0.2], // golden
  },
  fortress_b: {
    exhausts: [
      { x: -0.32, y: -0.85 },
      { x: -0.1, y: -0.85 },
      { x: 0.1, y: -0.85 },
      { x: 0.32, y: -0.85 },
    ],
    singleGun: { x: 0, y: 0.65 },
    doubleGuns: [
      { x: -0.22, y: 0.6 },
      { x: 0.22, y: 0.6 },
    ],
    cockpitY: 0.1,
    trailColor: [0.9, 0.75, 0.25], // bright gold
  },
  chrome: {
    exhausts: [
      { x: -0.55, y: 0.05 },
      { x: -0.55, y: -0.3 },
      { x: 0.55, y: 0.05 },
      { x: 0.55, y: -0.3 },
    ],
    singleGun: { x: 0, y: 0.8 },
    doubleGuns: [
      { x: -0.2, y: 0.7 },
      { x: 0.2, y: 0.7 },
    ],
    cockpitY: 0.15,
    trailColor: [0.3, 0.6, 1.0], // blue
  },
  neon: {
    exhausts: [
      { x: -0.22, y: -0.7 },
      { x: 0.22, y: -0.7 },
    ],
    singleGun: { x: 0, y: 0.8 },
    doubleGuns: [
      { x: -0.28, y: 0.55 },
      { x: 0.28, y: 0.55 },
    ],
    cockpitY: 0.45,
    spriteYOff: 0.15,
    trailColor: [0.8, 0.3, 0.9], // magenta/pink
  },
  stealth: {
    exhausts: [{ x: 0, y: -0.65 }],
    singleGun: { x: 0, y: 0.6 },
    doubleGuns: [
      { x: -0.18, y: 0.55 },
      { x: 0.18, y: 0.55 },
    ],
    cockpitY: 0.2,
    trailColor: [0.15, 0.6, 0.3], // dim green
  },
  stealth_v2: {
    exhausts: [
      { x: -0.38, y: -0.8 },
      { x: 0.38, y: -0.8 },
    ],
    singleGun: { x: 0, y: 0.65 },
    doubleGuns: [
      { x: -0.15, y: 0.6 },
      { x: 0.15, y: 0.6 },
    ],
    cockpitY: 0.2,
    trailColor: [0.5, 0.15, 0.7], // purple
  },
  stealth_v2_b: {
    exhausts: [
      { x: -0.38, y: -0.8 },
      { x: 0.38, y: -0.8 },
    ],
    singleGun: { x: 0, y: 0.65 },
    doubleGuns: [
      { x: -0.15, y: 0.6 },
      { x: 0.15, y: 0.6 },
    ],
    cockpitY: 0.2,
    trailColor: [0.7, 0.15, 0.3], // crimson
  },
  phantom: {
    exhausts: [
      { x: -0.25, y: -0.95 },
      { x: 0.25, y: -0.95 },
    ],
    singleGun: { x: 0, y: 0.9 },
    doubleGuns: [
      { x: -0.28, y: 0.9 },
      { x: 0.28, y: 0.9 },
    ],
    cockpitY: 0.15,
    trailColor: [0.6, 0.2, 0.8], // dark purple
  },
  manta: {
    exhausts: [{ x: 0, y: -1.0 }],
    singleGun: { x: 0, y: 0.45 },
    doubleGuns: [
      { x: -0.35, y: 0.3 },
      { x: 0.35, y: 0.3 },
    ],
    cockpitY: 0.4,
    trailColor: [0.1, 0.9, 0.7], // bioluminescent teal
    trailStyle: 'bio',
  },
  trident: {
    exhausts: [
      { x: -0.32, y: -0.95 },
      { x: 0, y: -1.0 },
      { x: 0.32, y: -0.95 },
    ],
    singleGun: { x: 0, y: 0.95 },
    doubleGuns: [
      { x: -0.32, y: 0.8 },
      { x: 0.32, y: 0.8 },
    ],
    cockpitY: 0.2,
    trailColor: [0.2, 0.85, 0.8], // alien teal
  },
  prism: {
    exhausts: [{ x: 0, y: -0.85 }],
    singleGun: { x: 0, y: 0.8 },
    doubleGuns: [
      { x: -0.15, y: 0.7 },
      { x: 0.15, y: 0.7 },
    ],
    cockpitY: 0.0,
    trailColor: [0.9, 0.9, 1.0], // white/prismatic
  },
  golden: {
    exhausts: [{ x: 0, y: -0.8 }],
    singleGun: { x: 0, y: 0.85 },
    doubleGuns: [
      { x: -0.12, y: 0.75 },
      { x: 0.12, y: 0.75 },
    ],
    cockpitY: -0.05,
    trailColor: [1.0, 0.85, 0.3], // gold
  },
};

export function getShipProfile(skinId?: string | null): ShipProfile {
  if (!skinId) return PROFILES.default;
  const key = skinId.replace('ship_', '');
  return PROFILES[key] || PROFILES.default;
}
