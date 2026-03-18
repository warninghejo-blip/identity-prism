export interface ShipProfile {
  exhausts: { x: number; y: number }[];
  singleGun: { x: number; y: number };
  doubleGuns: [{ x: number; y: number }, { x: number; y: number }];
  cockpitY: number;
}

const PROFILES: Record<string, ShipProfile> = {
  default: {
    exhausts: [
      { x: -0.4, y: -0.95 },
      { x: 0.4, y: -0.95 },
    ],
    singleGun: { x: 0, y: 0.85 },
    doubleGuns: [
      { x: -0.25, y: 0.85 },
      { x: 0.25, y: 0.85 },
    ],
    cockpitY: 0.15,
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
  },
  crystal: {
    exhausts: [{ x: 0, y: -0.85 }],
    singleGun: { x: 0, y: 0.75 },
    doubleGuns: [
      { x: -0.18, y: 0.65 },
      { x: 0.18, y: 0.65 },
    ],
    cockpitY: 0.1,
  },
  crystal_b: {
    exhausts: [{ x: 0, y: -0.8 }],
    singleGun: { x: 0, y: 0.75 },
    doubleGuns: [
      { x: -0.18, y: 0.65 },
      { x: 0.18, y: 0.65 },
    ],
    cockpitY: -0.05,
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
  },
  neon: {
    exhausts: [
      { x: -0.22, y: -0.9 },
      { x: 0.22, y: -0.9 },
    ],
    singleGun: { x: 0, y: 0.8 },
    doubleGuns: [
      { x: -0.28, y: 0.35 },
      { x: 0.28, y: 0.35 },
    ],
    cockpitY: 0.3,
  },
  stealth: {
    exhausts: [{ x: 0, y: -0.65 }],
    singleGun: { x: 0, y: 0.6 },
    doubleGuns: [
      { x: -0.18, y: 0.55 },
      { x: 0.18, y: 0.55 },
    ],
    cockpitY: 0.2,
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
  },
  stealth_v2_b: {
    // Same profile as stealth_v2 — sprites share engine/gun layout, differ only in texture
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
  },
  manta: {
    exhausts: [{ x: 0, y: -1.0 }],
    singleGun: { x: 0, y: 0.45 },
    doubleGuns: [
      { x: -0.35, y: 0.3 },
      { x: 0.35, y: 0.3 },
    ],
    cockpitY: 0.4,
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
  },
  prism: {
    exhausts: [{ x: 0, y: -0.85 }],
    singleGun: { x: 0, y: 0.8 },
    doubleGuns: [
      { x: -0.15, y: 0.7 },
      { x: 0.15, y: 0.7 },
    ],
    cockpitY: 0.0,
  },
  golden: {
    exhausts: [{ x: 0, y: -0.8 }],
    singleGun: { x: 0, y: 0.85 },
    doubleGuns: [
      { x: -0.12, y: 0.75 },
      { x: 0.12, y: 0.75 },
    ],
    cockpitY: -0.05,
  },
};

export function getShipProfile(skinId?: string | null): ShipProfile {
  if (!skinId) return PROFILES.default;
  const key = skinId.replace('ship_', '');
  return PROFILES[key] || PROFILES.default;
}
