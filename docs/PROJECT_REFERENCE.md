# Identity Prism Project Reference

This is the **code-backed reference** for the current project structure, routes, economy, and Ranger XP system.

Use this file as the first stop when you need to answer:

- **what each tab/page does**
- **where the client code lives**
- **which backend endpoints power it**
- **where PRISM coin flows come from / go to**
- **how Ranger XP and ranks are computed**

## 1. Start here

| Area | Main file(s) | What it controls |
| --- | --- | --- |
| Router / app shell | `src/AppShell.tsx` | Route map, lazy page loading, wallet providers, top-level app boot |
| Landing → scan → card → hub flow | `src/pages/Index.tsx` | Initial wallet flow, auto-scan, mint entrypoint, transition into hub |
| Identity card UI | `src/components/CelestialCard.tsx` | Front/back card, tier/trust display, Ranger rank widget, cosmetics preview |
| Main hub | `src/components/CosmicHubV3.tsx` | Main module grid, referral panel, daily caps summary, vault snippet |
| Backend entrypoint | `server/helius-proxy.js` | Main REST API, economy, sybil scan, Black Hole claim verification, challenges, tournaments, vault, auth |
| Backend holder perks | `server/services/identityPerks.js` | Identity holder multiplier, revive entitlement snapshot, Black Hole commission rates |
| Backend sybil logic | `server/services/sybilVerdict.js` | Verdict tiers, reward-path selection, composite-trust normalization |
| Black Hole reward math | `server/services/blackHoleRewards.js` | Count-based + net-SOL-derived cleanup reward calculation |

## 2. Main hub modules / tabs

These are the main modules exposed from the hub in `src/components/CosmicHubV3.tsx`.

| UI label | Route | What it does | Main client files | Main backend / external endpoints |
| --- | --- | --- | --- | --- |
| **League** | `/game` | Arcade games, game-session proof flow, coin sync, achievements, revives, tournaments | `src/pages/PrismLeague.tsx`, `src/components/game/*` | `/api/game/session/*`, `/api/game/coins`, `/api/game/leaderboard`, `/api/game/achievements`, `/api/game/revives`, `/api/tournament/*`, `/api/challenge/*`, `/api/identity/perks` |
| **Sybil Hunt** | `/scan` | Wallet analysis, verdict UI, hunt rewards, quiz, suggested targets | `src/pages/PrismScanner.tsx`, `src/components/prism/shared.tsx` | `/api/sybil/analysis`, `/api/sybil/funding-sources`, `/api/sybil/suggested-targets`, `/api/quiz/question`, `/api/quiz/answer`, `/api/prism/earn` |
| **Arena** | `/arena` | P2P challenges, challenge list, accept/cancel flow, arena leaderboard | `src/pages/PrismArena.tsx`, `src/lib/useChallengeNotifier.tsx` | `/api/challenge/list`, `/api/challenge/create`, `/api/challenge/accept`, `/api/challenge/cancel`, `/api/challenge/my`, `/api/challenge/leaderboard`, `/api/prism/balance` |
| **Black Hole** | `/blackhole` | Dust cleanup, swap-or-burn planning, rent reclaim, cleanup reward claim | `src/pages/BlackHole.tsx` | `/api/market/sol-price`, `/api/market/build-swap`, `/api/market/execute-swap`, `/api/blackhole/claim`, `/api/identity/perks`, Helius DAS, DexScreener |
| **Shop** | `/forge` | Cosmetics shop, micromodules, loadout equip/install, server-authoritative spend path | `src/pages/StellarForge.tsx`, `src/lib/forgeItems.ts`, `src/lib/userDataSync.ts`, `server/forge-catalog.json` | `/api/prism/balance`, `/api/prism/spend`, `/api/wallet-database`, `/api/user-data` |
| **Leaderboard** | `/leaderboard` | Overall leaderboard + per-game leaderboard views | `src/pages/Leaderboard.tsx` | `/api/leaderboard`, `/api/game/leaderboard` |
| **Quests** | `/quests` | Daily/weekly/one-time quest XP progression and quest sync | `src/pages/QuestsPage.tsx`, `src/lib/prismQuests.ts` | `/api/quest/sync`, `/api/prism/balance`, `/api/wallet-database`, Helius RPC for mint state |
| **Vault** | `/vault` | Buy coins, SKR quote/purchase, staking status, stake/claim/unstake | `src/pages/PrismVault.tsx` | `/api/prism/buy/status`, `/api/prism/buy`, `/api/prism/buy/skr-quote`, `/api/prism/buy/skr`, `/api/prism/vault/status`, `/api/prism/vault/stake`, `/api/prism/vault/claim`, `/api/prism/vault/unstake`, `/api/prism/balance` |

## 3. Supporting routes

| Route | Page | Purpose | Main files / endpoints |
| --- | --- | --- | --- |
| `/` / `/app` | Landing + card hub | Entry flow, wallet connect, wallet scan, mint initiation, card/hub shell | `src/pages/Index.tsx`, `src/components/CelestialCard.tsx`, `src/components/CosmicHubV3.tsx`, `/api/prism/balance`, `/api/referral/claim`, `/api/market/mint-quote`, metadata service, Helius RPC |
| `/text-quest` | Text quests | Branching story quests with coin rewards and ship-stat checks | `src/pages/TextQuestPage.tsx`, `src/lib/textQuests.ts`, `/api/prism/earn` |
| `/recovery` | Trust Recovery | Shows recovery recommendations / trust adjustments | `src/pages/TrustRecovery.tsx`, `/api/recovery/status` |
| `/profile/:address` | Public profile | Lightweight wallet profile view | `src/pages/ProfilePage.tsx`, `/api/wallet-database` |
| `/compare` | Wallet compare | Side-by-side wallet comparison UI | `src/pages/Compare.tsx`, shared reputation helpers |
| `/verify` | Verify card / asset | Verification utility page | `src/pages/Verify.tsx`, Helius RPC |
| `/preview` / `/preview/:tier` | Preview deck | Static card/tier previews | `src/pages/PreviewDeck.tsx` |
| `/home` | Marketing / promo page | Static homepage / landing content | `src/pages/HomePage.tsx` |

## 4. Shared systems: where to look

| System | Main files | Notes |
| --- | --- | --- |
| PRISM coin balance / tx history | `src/lib/prismCoin.ts`, `server/helius-proxy.js` | Client read/write helpers; server is authoritative for mutation |
| Ranger XP / ranks | `src/lib/rangerRanks.ts`, `server/helius-proxy.js` | Client and server use mirrored rank ladder and XP formula |
| Quest persistence | `src/lib/prismQuests.ts`, `src/lib/userDataSync.ts`, `server/helius-proxy.js` | Local quest state + server sync (`/api/quest/sync`) |
| Sybil analysis / verdicts | `src/pages/PrismScanner.tsx`, `src/components/prism/shared.tsx`, `server/services/sybilVerdict.js`, `server/helius-proxy.js` | Scanner UI, verdict labels, reward path selection |
| Composite reputation | `src/hooks/useCompositeScore.ts`, `src/components/CompositeScoreBreakdown.tsx`, `server/services/sybilVerdict.js`, `server/helius-proxy.js` | Verdict-adjusted trust is only applied inside composite |
| Holder perks | `src/lib/api.ts`, `src/pages/PrismLeague.tsx`, `src/pages/BlackHole.tsx`, `server/services/identityPerks.js`, `server/helius-proxy.js` | Backend-derived ID holder snapshot, multiplier, commission, revives |
| Forge catalog / loadout | `src/lib/forgeItems.ts`, `server/forge-catalog.json`, `server/helius-proxy.js`, `src/pages/StellarForge.tsx` | Shop catalog is mirrored to the backend for spend validation |
| Game session proof / anti-replay | `src/pages/PrismLeague.tsx`, `server/helius-proxy.js` | Session registration, verification, leaderboard/tournament/challenge reuse guards |
| Referrals | `src/components/CosmicHubV3.tsx`, `src/pages/Index.tsx`, `server/helius-proxy.js` | Referral code creation, claim flow, referrer stats, mint bonus |

## 5. PRISM economy reference

### 5.1 Live inflows

| Flow | Live path | Amount / formula | Caps / guards | Main files |
| --- | --- | --- | --- | --- |
| Arcade game coins | **Live** | Client sends game-earned delta; server clamps by verified session allowance and daily cap, then applies holder multiplier semantics + staking boost | Verified `gameSessionId`, per-session allowance, `DAILY_GAME_COIN_CAP = 2000`, no challenge reuse | `src/pages/PrismLeague.tsx`, `server/services/identityPerks.js`, `server/helius-proxy.js` |
| Game achievements | **Live** | Server reward table by achievement ID (`ACHIEVEMENT_REWARDS_BY_ID`) | Non-game daily cap, server ignores client-supplied reward amount | `src/pages/PrismLeague.tsx`, `server/helius-proxy.js` |
| Clean scan reward | **Live** | `5` coins flat (`scan_wallet`) | Requires analyzed target, per-target cooldown, `DAILY_SCAN_CAP = 100`, global non-game cap | `src/pages/PrismScanner.tsx`, `src/pages/Index.tsx`, `server/helius-proxy.js` |
| Sybil bounty | **Live** | `20 + rank bonus` via `computeSybilHuntReward` | Verdict must qualify, one claim per target per hunter, `DAILY_HUNT_CAP = 500`, global non-game cap | `src/pages/PrismScanner.tsx`, `server/services/sybilVerdict.js`, `server/helius-proxy.js` |
| Quiz reward | **Live** | `5` coins per correct answer | `DAILY_QUIZ_CAP = 500` (100 answers), server grades answers | `src/pages/PrismScanner.tsx`, `server/helius-proxy.js` |
| Text quest coin reward | **Live** | Per-quest `reward.coins`, max `1200` per claim | Valid `questId` required, one reward per quest per wallet, 24h server cooldown | `src/pages/TextQuestPage.tsx`, `src/lib/textQuests.ts`, `server/helius-proxy.js` |
| Black Hole cleanup reward | **Live** | `fungibleResolved * 8 + nftResolved * 15 + floor(max(netResolvedSol, 0) / 0.001) * 8`, capped at `500` | Verified close/swap signatures, commission verification, `DAILY_BLACKHOLE_CLEANUP_CAP = 500`, non-game cap | `src/pages/BlackHole.tsx`, `server/services/blackHoleRewards.js`, `server/helius-proxy.js` |
| Tournament placement payout | **Live** | Pool share + base prize by tier/placement | Event-driven, server settlement | `src/pages/PrismLeague.tsx`, `server/helius-proxy.js` |
| Weekly arena ranking payout | **Live** | Top 10 weekly rewards: `2000 / 1200 / 600 / 200 / 200 / 100 / 100 / 100 / 100 / 100` | Monday UTC settlement, `WEEKLY_MIN_GAMES = 3` | `src/pages/PrismArena.tsx`, `server/helius-proxy.js` |
| Vault yield | **Live** | Bracketed daily yield × tier multiplier × days since last claim | Server claim path, max 90 days accrual | `src/pages/PrismVault.tsx`, `server/helius-proxy.js` |
| Referral claim bonuses | **Live** | Claimer gets `+50`; referrer gets `+20` | One claim per claimer, max 50 referrals per referrer | `src/pages/Index.tsx`, `src/components/CosmicHubV3.tsx`, `server/helius-proxy.js` |
| Referral mint bonus | **Live** | Referrer gets `+100` when referred user mints | Firestore-backed, one-time per referral | `server/helius-proxy.js` |
| Coin purchases (SOL / SKR) | **Live purchase flow** | Packages: `5000 / 15000 / 50000 / 150000` coins | `DAILY_COIN_LIMIT = 300000`, tx-signature replay protection | `src/pages/PrismVault.tsx`, `server/helius-proxy.js` |

### 5.2 Live sinks

| Sink | Live path | Cost / formula | Notes | Main files |
| --- | --- | --- | --- | --- |
| Forge item purchases | **Live** | Exact catalog price | Server validates against `forge-catalog.json`; `applyBurnFee()` burns 2% of spend | `src/pages/StellarForge.tsx`, `src/lib/forgeItems.ts`, `server/forge-catalog.json`, `server/helius-proxy.js` |
| Forge micromodule purchases | **Live** | Exact module price | Same server-authoritative validation and 2% burn fee | `src/lib/forgeItems.ts`, `server/helius-proxy.js` |
| Mint ID for coins | **Live** | `10000` coins | Uses `applyBurnFee()` on spend; separate from mint payment-by-SOL/SKR path | `src/pages/Index.tsx`, `server/helius-proxy.js` |
| Tournament entries | **Live** | Daily `1000`, weekly `5000`, monthly `25000` | `burnRate = 10%`, remaining 90% goes to pool | `src/pages/PrismLeague.tsx`, `server/helius-proxy.js` |
| Arena challenge stake | **Live** | User-selected stake | Winner payout / cancel penalties are resolved server-side from the staked pot | `src/pages/PrismArena.tsx`, `server/helius-proxy.js` |
| Marketplace listing fee | **Live legacy path** | `10` coins flat | 2% burn on the listing fee | `server/helius-proxy.js` |

### 5.3 Global caps / boosts / modifiers

| Rule | Value | Notes | Main files |
| --- | --- | --- | --- |
| Game daily cap | `2000` | Tracks **pre-boost / normalized** game earnings | `server/helius-proxy.js` |
| Non-game daily cap | `1500` | Shared cap for non-game earn sources | `server/helius-proxy.js` |
| Scan sub-cap | `100` | Inside non-game cap | `server/helius-proxy.js` |
| Hunt sub-cap | `500` | Inside non-game cap | `server/helius-proxy.js` |
| Quiz sub-cap | `500` | Inside non-game cap | `server/helius-proxy.js` |
| Black Hole cleanup cap | `500` | Separate cleanup counter, still clipped by non-game cap | `server/helius-proxy.js`, `server/services/blackHoleRewards.js` |
| SOL/SKR daily buy cap | `300000` | Purchase cap per wallet/day | `server/helius-proxy.js` |
| Holder game multiplier | `2x` | Applied for verified Identity Prism holders; pinned per verified game session | `server/services/identityPerks.js`, `server/helius-proxy.js` |
| Session on-chain allowance multiplier | `1.5x` | Expands per-session max delta allowance, not the balance directly | `server/services/identityPerks.js`, `server/helius-proxy.js` |
| Holder Black Hole commission | `2%` | Standard rate is `10%` | `server/services/identityPerks.js`, `server/helius-proxy.js`, `src/pages/BlackHole.tsx` |
| Staking earn boosts | Bronze `+5%`, Silver `+10%`, Gold `+15%` | Applied **after** cap math so bonus coins do not count toward caps | `server/helius-proxy.js`, `src/pages/PrismVault.tsx` |
| Free revives | `3/day` for holders | Holder-only perk | `server/services/identityPerks.js`, `server/helius-proxy.js`, `src/pages/PrismLeague.tsx` |

### 5.4 Important economy clarifications

| Topic | Current truth |
| --- | --- |
| `PRISM_EARN_RATES.quest_daily / quest_weekly / quest_milestone` | Present in `src/lib/prismCoin.ts`, but the shipped Quests UI currently grants **XP**, not coin payouts |
| `PRISM_EARN_RATES.referral` | Referral rewards are handled by dedicated referral endpoints, not the normal `earnPrism()` client path |
| `PRISM_EARN_RATES.challenge_win` | Arena winner payouts are resolved directly in server challenge logic; do not treat the enum value as the full live payout formula |
| `burn_tokens` / `burn_nfts` | Removed from `/api/prism/earn` as direct reward sources; Black Hole cleanup is the server-authoritative replacement |

## 6. Ranger XP reference

### 6.1 Rank thresholds

| Rank | Min XP | Main file |
| --- | --- | --- |
| Cadet | `0` | `src/lib/rangerRanks.ts`, `server/helius-proxy.js` |
| Pilot | `1500` | `src/lib/rangerRanks.ts`, `server/helius-proxy.js` |
| Captain | `8000` | `src/lib/rangerRanks.ts`, `server/helius-proxy.js` |
| Ace | `25000` | `src/lib/rangerRanks.ts`, `server/helius-proxy.js` |
| Legend | `50000` | `src/lib/rangerRanks.ts`, `server/helius-proxy.js` |

### 6.2 XP sources

| Source | Formula | Cap / behavior | Main files |
| --- | --- | --- | --- |
| Orbit best score | `min(floor(bestScore * 5), 2000)` | Per-mode cap `2000` | `src/lib/rangerRanks.ts`, `server/helius-proxy.js` |
| Defender best score | `min(floor(bestScore * 1.5), 2000)` | Per-mode cap `2000` | `src/lib/rangerRanks.ts`, `server/helius-proxy.js` |
| Gravity best score | `min(floor(bestScore * 5), 2000)` | Per-mode cap `2000` | `src/lib/rangerRanks.ts`, `server/helius-proxy.js` |
| Cosmic Mine best score | `min(floor(bestScore * 3), 1500)` | Per-mode cap `1500` | `src/lib/rangerRanks.ts`, `server/helius-proxy.js` |
| Cosmic Runner best score | `min(floor(bestScore * 3), 1500)` | Per-mode cap `1500` | `src/lib/rangerRanks.ts`, `server/helius-proxy.js` |
| Games played (orbit / defender / gravity) | `min(gamesPlayed * 5, 1000)` each | Volume XP | `src/lib/rangerRanks.ts`, `server/helius-proxy.js` |
| Orbit total survival time | `min(floor(totalSurvivalTime / 10), 500)` | Volume XP | `src/lib/rangerRanks.ts`, `server/helius-proxy.js` |
| Gravity total time | `min(floor(totalTime / 10), 500)` | Volume XP | `src/lib/rangerRanks.ts`, `server/helius-proxy.js` |
| Defender total kills | `min(floor(totalKills / 5), 500)` | Volume XP | `src/lib/rangerRanks.ts`, `server/helius-proxy.js` |
| Achievements | `achievementCount * 200` | No explicit hard cap in formula | `src/lib/rangerRanks.ts`, `server/helius-proxy.js` |
| Arena challenge wins | `min(challengeWins * 300, 5000)` | Hard cap `5000` | `src/lib/rangerRanks.ts`, `server/helius-proxy.js` |
| Quest XP | `questXPEarned` | Whatever has been claimed in quest state | `src/lib/prismQuests.ts`, `src/lib/rangerRanks.ts`, `server/helius-proxy.js` |
| Completed text quests | `completedTextQuests * 500` | 16 quest IDs → theoretical `8000` total | `src/lib/textQuests.ts`, `src/lib/rangerRanks.ts`, `server/helius-proxy.js` |
| Tournament XP | `tournamentXP` | Uncapped accumulated placement XP | `src/pages/PrismLeague.tsx`, `src/lib/rangerRanks.ts`, `server/helius-proxy.js` |
| Weekly arena XP | `arenaWeeklyXP` | Uncapped accumulated weekly ranking XP | `src/pages/PrismArena.tsx`, `src/lib/rangerRanks.ts`, `server/helius-proxy.js` |
| Total coins earned bonus | `min(floor(totalEarned / 200), 1000)` | Hard cap `1000` | `src/lib/rangerRanks.ts`, `server/helius-proxy.js` |

### 6.3 Quest XP breakdown

| Quest bucket | Total possible XP | Where defined |
| --- | --- | --- |
| Daily quests | `135 / day` | `src/lib/prismQuests.ts` |
| Weekly quests | `670 / week` | `src/lib/prismQuests.ts` |
| One-time quests | `1875 total` | `src/lib/prismQuests.ts` |
| Text quests | `500` each | `src/lib/textQuests.ts`, `src/lib/rangerRanks.ts` |

### 6.4 Server authority rules

| Rule | Current behavior |
| --- | --- |
| Canonical XP endpoint | `/api/xp?address=...` in `server/helius-proxy.js` |
| Client merge strategy | `gatherXPSourcesMerged()` takes `Math.max(local, server)` per source |
| Rank UI hooks | `src/hooks/useRangerProgress.ts`, `src/lib/rangerRanks.ts` |
| Hub/card/rank widgets | `src/components/CosmicHubV3.tsx`, `src/components/CelestialCard.tsx`, `src/pages/QuestsPage.tsx`, `src/pages/StellarForge.tsx` |

## 7. Audit notes for the current state

### 7.1 Fixed in this pass

| Fix | What changed |
| --- | --- |
| Black Hole reward floor | Count-based cleanup rewards no longer zero out when net SOL becomes non-positive after fees/slippage |
| Holder claim resilience | Black Hole claim verification now returns a temporary availability error instead of silently downgrading holder commission checks on ownership lookup failure |
| Token-2022 verification robustness | Black Hole verification now scans both outer and inner parsed token instructions for close/burn checks |
| Session holder stability | Game sessions now pin the holder multiplier on first earn so cap math stays stable inside the same verified session |

### 7.2 Remaining documentation guidance

| Topic | Guidance |
| --- | --- |
| README economy numbers | Treat `README.md` as product overview, not the canonical source for live caps / fees / XP math |
| Legacy `PRISM_EARN_RATES` entries | Prefer this file + backend routes over the enum when you need the current live economy |
| First place to search | Start with `src/AppShell.tsx`, `src/components/CosmicHubV3.tsx`, and `server/helius-proxy.js`, then jump into the feature-specific files listed above |
