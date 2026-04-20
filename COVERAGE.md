# Test Coverage Report

Generated: 2026-04-16 (updated after integration test sprint #2)  
Tool: `npx vitest run --coverage` (provider: v8)

## Summary

### Baseline (2026-04-16, sprint #1 — 141 tests)

| Metric     | %      |
|------------|--------|
| Statements | 23.01% |
| Branches   | 15.49% |
| Functions  | 23.33% |
| Lines      | 24.55% |

> Note: codebase grew significantly between sprints (+17k new statements from new features).
> The absolute coverage % dropped but test count and targeted coverage increased.

### After sprint #2 (2026-04-16 — 204 tests)

| Metric     | %     | Notes                                                  |
|------------|-------|--------------------------------------------------------|
| Statements | 8.14% | All files: 26k statements (helius-proxy.js=9560 lines) |
| Branches   | 5.71% | Dominated by unmapped server subprocess code           |
| Functions  | 10.9% | +63 new functions exercised across new test files      |
| Lines      | 8.45% | —                                                      |

> The overall % is deceiving — `helius-proxy.js` (9560 lines, 0% because it runs as
> subprocess) and untested page components drag the number down.
> The targeted modules below show meaningful 14–37% coverage.

## New Tests Added (sprint #2, 2026-04-16)

| File                                                       | Tests | What's covered                                    |
|------------------------------------------------------------|-------|---------------------------------------------------|
| `src/components/prism/__tests__/shared.test.ts`            | 28    | getSessionJwt, getCachedJwt, getApiBase, isServerAvailable, formatAddr, formatWalletAge, timeAgo, getBadgeCount |
| `src/hooks/__tests__/useWalletData.hook.test.ts`           | 8     | Hook state: no-address → null, address → loading, cached data, address change resets state |
| `src/pages/__tests__/PrismVault.flow.test.tsx`             | 6     | Mount, heading visible, SOL/SKR payment buttons, payment method switching |
| `src/pages/__tests__/BlackHole.flow.test.tsx`              | 5     | Mount, wallet-disconnected connect prompt, connected wallet states |
| `src/pages/__tests__/PrismScanner.flow.test.tsx`           | 5     | Mount, address input renders, localStorage scan history, input state |
| `server/__tests__/routes-integration.test.ts`              | 11    | GET /health, GET /api/v1/reputation (200+schema, 404), JWT-401 guards, vault status, balance |
| **Total new sprint #2**                                    | **63**| — |

**Total tests: 204 passing** (up from 141)

## Coverage for Targeted Modules (post sprint #2)

| File                                  | Stmts  | Branches | Funcs  | Lines  | Was 0%? |
|---------------------------------------|--------|----------|--------|--------|---------|
| `src/components/prism/shared.tsx`     | 37.03% | 25.52%   | 24.24% | 37.82% | YES → 37% |
| `src/hooks/useWalletData.ts`          | 33.05% | 20.97%   | 20.51% | 31.47% | 13% → 33% |
| `src/pages/PrismVault.tsx`            | 29.10% | 26.62%   | 37.09% | 29.73% | ~0% → 29% |
| `src/pages/BlackHole.tsx`             | 18.29% | 5.99%    | 12.84% | 20.04% | ~0% → 18% |
| `src/pages/PrismScanner.tsx`          | 14.72% | 12.15%   | 12.76% | 15.10% | ~0% → 15% |

## Files Moved Out of 0%

- `src/components/prism/shared.tsx` — 0% → 37% statements
- `src/pages/PrismVault.tsx` — 0% → 29% statements
- `src/pages/BlackHole.tsx` — 0% → 18% statements
- `src/pages/PrismScanner.tsx` — 0% → 15% statements
- `src/hooks/useWalletData.ts` — 13% → 33% statements (hook flow paths added)

## Note on Overall % vs 45% Target

The 45% target was set when codebase was smaller (~6k statements).
Codebase grew to 26k statements between sprints with:
- `server/helius-proxy.js` (9560 lines, 0% — runs as subprocess, V8 cannot trace)
- `src/lib/textQuests.ts` (4000 lines, 0%)
- Multiple new page components (0%)

Targeted coverage for the 5 priority modules improved from ~0% to 15–37%.
Server route integration tests work correctly (11 pass) but subprocess-based
testing means V8 coverage can't trace server-side execution.

## Files Still at 0% (major gaps)

| File                               | Lines | Why                                 |
|------------------------------------|-------|-------------------------------------|
| `src/lib/textQuests.ts`            | 4043  | Large text content file             |
| `server/helius-proxy.js`           | 9560  | Subprocess-only, V8 can't trace     |
| `src/pages/Compare.tsx`            | 651   | Wallet comparison page              |
| `src/pages/PrismArena.tsx`         | 1661  | Arena battle page                   |
| `src/pages/StellarForge.tsx`       | 1706  | Forge/craft page                    |

## Running Coverage Locally

```bash
npx vitest run --coverage
# View HTML: open coverage/lcov-report/index.html
```
