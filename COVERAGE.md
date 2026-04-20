# Test Coverage Report

Generated: 2026-04-16  
Tool: `npx vitest run --coverage` (provider: v8)

## Summary

| Metric     | %      | Covered / Total |
|------------|--------|-----------------|
| Statements | 23.01% | 1330 / 5780     |
| Branches   | 15.49% | 704 / 4544      |
| Functions  | 23.33% | 231 / 990       |
| Lines      | 24.55% | 1241 / 5053     |

## Coverage by Area

| Area                  | Stmts  | Branches | Funcs  | Lines  | Notes                        |
|-----------------------|--------|----------|--------|--------|------------------------------|
| server/services       | 79.59% | 63.34%   | 89.28% | 84.11% | Best coverage in project     |
| src/components/ui     | 80.55% | 25.00%   | 36.36% | 80.55% | UI primitives mostly covered |
| src (root)            | 52.76% | 21.42%   | 14.28% | 66.40% | App.tsx, AppShell.tsx        |
| src/components        | 30.82% | 13.97%   | 37.83% | 31.93% | CosmicHubV3, WalletProvider  |
| src/pages             | 23.71% | 14.24%   | 24.86% | 24.85% | All pages low coverage       |
| src/lib               | 23.97% | 19.91%   | 18.42% | 25.00% | Heavy logic, sparse tests    |
| src/hooks             | 6.25%  | 0.84%    | 12.28% | 7.41%  | Nearly untested              |
| src/components/game   | 9.61%  | 4.50%    | 3.94%  | 10.51% | GameShared.tsx only          |
| src/components/prism  | 6.17%  | 0.00%    | 0.00%  | 7.77%  | shared.tsx barely touched    |
| src/utils             | 5.88%  | 0.00%    | 0.00%  | 5.88%  | funnyFacts.ts                |
| src/lib/constants     | 26.66% | 0.00%    | 0.00%  | 36.36% | tierColors.ts                |

## Files with 0% Function Coverage (priority targets)

These files have zero tested functions — highest value for future test work:

| File                            | Why it matters                                |
|---------------------------------|-----------------------------------------------|
| `src/components/game/GameShared.tsx` | Core game logic (1400+ lines, 3.94% funcs) |
| `src/components/prism/shared.tsx`    | Sybil fetch, identity scoring              |
| `src/lib/forgeItems.ts`             | Forge item catalogue (841+ lines)          |
| `src/lib/magicblock.ts`             | On-chain integration                       |
| `src/lib/shipProfiles.ts`           | Ship profile constants                     |
| `src/utils/funnyFacts.ts`           | Low priority (static data)                 |
| `src/lib/constants/tierColors.ts`   | Low priority (static mapping)              |
| `src/hooks/useWalletData.ts`        | Critical — main data hook (883 lines)      |
| `src/pages/PrismVault.tsx`          | 5.13% stmts — staking/buy flows untested   |
| `src/pages/NotFound.tsx`            | 0% funcs — trivial but easy win            |

## Recommended Next Steps

1. **`useWalletData.ts`** — mock Helius/RPC calls, test data transform logic  
2. **`GameShared.tsx`** — unit test scoring algorithms (no DOM needed)  
3. **`server/services/sybilVerdict.js`** — already 75%, push to 90%+ (lines 143, 246, 287-404)  
4. **`src/lib/achievements*.ts`** — achievement unlock logic is pure, easy to test  
5. **`PrismVault.tsx`** — staking flow integration tests (Solana mock)

## Running Coverage Locally

```bash
npx vitest run --coverage
# HTML report:
npx vitest run --coverage --reporter=verbose
# lcov output → open coverage/lcov-report/index.html
```
