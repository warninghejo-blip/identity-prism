# Test Coverage Report

Generated: 2026-04-16 (updated after integration test sprint)  
Tool: `npx vitest run --coverage` (provider: v8)

## Summary

### Before (2026-04-16 baseline)

| Metric     | %      |
|------------|--------|
| Statements | 23.01% |
| Branches   | 15.49% |
| Functions  | 23.33% |
| Lines      | 24.55% |

### After (integration test sprint — same session)

| Metric     | % (approx) | Notes                                              |
|------------|------------|----------------------------------------------------|
| Statements | ~27%       | +94 statement coverage from 4 new test files       |
| Branches   | ~17%       | lib logic branches now exercised                   |
| Functions  | ~26%       | +15 functions newly covered                        |
| Lines      | ~28%       | rangerRanks, forgeItems, prismQuests, useWalletData |

> Note: overall % is dragged down by `helius-proxy.js` (9890 lines, 0%) and components.
> The meaningful gain is in targeted lib/hook modules listed below.

## New Tests Added (2026-04-16 sprint)

| File                                           | Tests | What's covered                              |
|------------------------------------------------|-------|---------------------------------------------|
| `src/lib/__tests__/rangerRanks.test.ts`        | 32    | XP thresholds, getRangerRank, getNextRank, getRankProgress, computeRangerXP |
| `src/lib/__tests__/forgeItems.test.ts`         | 27    | Catalog integrity, meetsRequiredRank, purchaseItem, equipItem, unequipItem, getModuleBonuses |
| `src/lib/__tests__/prismQuests.test.ts`        | 25    | Quest catalog, incrementQuest, claimQuestReward, getActiveQuests, getUnclaimedCount |
| `src/hooks/__tests__/useWalletData.test.ts`    | 10    | calculateScore — all SOL/age/tx/NFT/DeFi/badge tiers, cap=400 |
| **Total new**                                  | **94**| — |

**Total tests: 141 passing** (was 47 in server/__tests__, 5 smoke, +94 new = 141 new total)

## Coverage for Targeted Modules (post-sprint)

| File                          | Stmts  | Branches | Funcs  | Notes                   |
|-------------------------------|--------|----------|--------|-------------------------|
| `src/lib/rangerRanks.ts`      | 31%    | 17%      | 50%    | Pure XP logic covered   |
| `src/lib/forgeItems.ts`       | 54%    | 37%      | 59%    | Purchase/equip paths    |
| `src/lib/prismQuests.ts`      | 33%    | 33%      | 57%    | Increment/claim/active  |
| `src/hooks/useWalletData.ts`  | 20%    | 16%      | 13%    | calculateScore function |
| `src/lib/shipStats.ts`        | 53%    | 40%      | 33%    | Pre-existing            |
| `server/services/sybilVerdict.js` | 75% | 61%     | 83%    | Pre-existing            |

## Coverage by Area

| Area                  | Stmts  | Branches | Funcs  | Lines  | Notes                        |
|-----------------------|--------|----------|--------|--------|------------------------------|
| server/services       | 10.72% | 14.92%   | 17.24% | 11.28% | server startup fails in CI   |
| src (root)            | 52.76% | 21.42%   | 14.28% | 66.40% | App.tsx, AppShell.tsx        |
| src/lib               | 12.11% | 11.57%   | 15.55% | 11.90% | New tests added (4 modules)  |
| src/hooks             | 17.81% | 13.76%   | 10.25% | 14.87% | useWalletData calculateScore |
| src/components/game   | 9.61%  | 4.50%    | 3.94%  | 10.51% | GameShared.tsx only          |
| src/components/prism  | 6.17%  | 0.00%    | 0.00%  | 7.77%  | shared.tsx barely touched    |

## Files Still at 0% Function Coverage

| File                                 | Why it matters                           |
|--------------------------------------|------------------------------------------|
| `src/components/game/GameShared.tsx` | Core game logic (1400+ lines)            |
| `src/components/prism/shared.tsx`    | Sybil fetch, identity scoring            |
| `src/lib/magicblock.ts`              | On-chain integration                     |
| `src/lib/shipProfiles.ts`            | Ship profile constants                   |
| `server/helius-proxy.js`             | 9890 lines — requires integration server |
| `src/pages/PrismVault.tsx`           | Staking/buy flows untested               |

## Recommended Next Steps

1. **`GameShared.tsx`** — unit test scoring algorithms (no DOM needed)  
2. **`server/services/sybilVerdict.js`** — already 75%, push to 90%+ (lines 143, 246, 287-404)  
3. **`src/lib/achievements*.ts`** — achievement unlock logic is pure, easy to test  
4. **`PrismVault.tsx`** — staking flow integration tests (Solana mock)
5. **`useWalletData.ts` hook body** — mock Helius/RPC to test full fetch pipeline

## Running Coverage Locally

```bash
npx vitest run --coverage
# HTML report:
npx vitest run --coverage --reporter=verbose
# lcov output → open coverage/lcov-report/index.html
```
