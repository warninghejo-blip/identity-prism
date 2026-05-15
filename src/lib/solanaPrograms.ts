export interface ProgramMeta {
  label: string;
  category: string;
}

export const PROGRAM_LABELS: Record<string, ProgramMeta> = {
  // Staking / Voting
  Vote111111111111111111111111111111111111111: { label: 'Validator Voting', category: 'Staking' },
  Stake11111111111111111111111111111111111111: { label: 'Stake Program', category: 'Staking' },
  StakeConfig11111111111111111111111111111111: { label: 'Stake Config', category: 'Staking' },

  // SPL
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: { label: 'SPL Token', category: 'SPL' },
  ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL: { label: 'Associated Tokens', category: 'SPL' },
  TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: { label: 'Token-2022', category: 'SPL' },

  // NFT infra
  BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY: { label: 'Compressed NFTs', category: 'NFT' },
  metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s: { label: 'Metaplex Metadata', category: 'NFT' },
  cndy3Z4yapfJBmL3ShUp5exZKqR3z33thTzeNMm2gRZ: { label: 'Candy Machine', category: 'NFT' },
  hausS13jsjafwWwGqZTUQRmWyvyxn9EQpqMwV1PBBmk: { label: 'Hausmann (ME)', category: 'NFT' },
  M2mx93ekt1fmXSVkTrUL9xVFHkmME8HTUi5Cyc5aF7K: { label: 'Magic Eden v2', category: 'NFT' },
  TSWAPaqyCSx2KABk68Shruf4rp7CxcAi9oa6Dkwc7R: { label: 'Tensor Swap', category: 'NFT' },
  TCMPhJdwDryooaGtiocG1u3xcYbRpiJzb283XoqBBuh: { label: 'Tensor Cnft', category: 'NFT' },

  // DeFi
  JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4: { label: 'Jupiter v6', category: 'DeFi' },
  JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB: { label: 'Jupiter v4', category: 'DeFi' },
  '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP': { label: 'Orca Whirlpools', category: 'DeFi' },
  whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc: { label: 'Orca v2', category: 'DeFi' },
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': { label: 'Raydium AMM', category: 'DeFi' },
  CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK: { label: 'Raydium CLMM', category: 'DeFi' },
  routeUGWgpgqxRE5FVf3KVNFcTnxqxBqLNLRaSU7FnVo: { label: 'Raydium Routing', category: 'DeFi' },
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P': { label: 'Pump.fun', category: 'DeFi' },
  MFv2hWf31Z9kbCa1snEPdcgp168vLs2YNsAfBFkCbSZ: { label: 'MarginFi', category: 'DeFi' },
  So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo: { label: 'Solend', category: 'DeFi' },
  DjVE6JNiYqPL2QXyCUUh8rNjHrbz9hXHNYt99MQ59qw1: { label: 'Orca v1', category: 'DeFi' },

  // System
  '11111111111111111111111111111111': { label: 'System Program', category: 'System' },
  ComputeBudget111111111111111111111111111111: { label: 'Compute Budget', category: 'System' },
  BPFLoaderUpgradeab1e11111111111111111111111: { label: 'BPF Loader', category: 'System' },
  Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo: { label: 'Memo v1', category: 'System' },
  MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr: { label: 'Memo v2', category: 'System' },
};

export function getProgramLabel(programId: string): string {
  return PROGRAM_LABELS[programId]?.label ?? `${programId.slice(0, 4)}...${programId.slice(-4)}`;
}

export function getProgramCategory(programId: string): string {
  return PROGRAM_LABELS[programId]?.category ?? 'Unknown';
}
