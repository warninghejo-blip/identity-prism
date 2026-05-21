export type SybilNodeType = 'verified' | 'flagged' | 'suspect';

const clampScore = (score: number) => Math.max(0, Math.min(100, Number.isFinite(score) ? score : 0));

export function riskBand(score: number): {
  label: string;
  color: string;
  nodeType: SybilNodeType;
} {
  const risk = clampScore(score);
  if (risk >= 80) return { label: 'Probable Sybil', color: 'red', nodeType: 'suspect' };
  if (risk >= 60) return { label: 'High Risk', color: 'red', nodeType: 'suspect' };
  if (risk >= 40) return { label: 'Medium Risk', color: 'yl', nodeType: 'flagged' };
  if (risk >= 20) return { label: 'Low Risk', color: 'yl', nodeType: 'flagged' };
  return { label: 'Trusted', color: 'gn', nodeType: 'verified' };
}

export function verdictFromScore(score: number): string {
  return riskBand(score).label;
}
