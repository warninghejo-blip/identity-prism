# **Identity Prism Backend - Exhaustive Route Test Documentation**

## **PART 1: FILE-BY-FILE ENDPOINT CATALOG**

### **1. admin.js** — Admin API (requires X-Admin-Key header)
**File:** `server/routes/admin.js` (341 lines)

| Endpoint | Method | Auth | Rate Limit | Key Test Parameters | Success Response | Critical Errors | Caps/Limits |
|----------|--------|------|-----------|-------------------|------------------|-----------------|------------|
| `/api/admin/sybil/feedback` | GET | AdminKey | 20/60s | status (pending/verified/rejected), limit (1-200), offset | {reports, total} | 429 (RL), 500 (DB error) | limit capped at 200 |
| `/api/admin/sybil/feedback/:id/verify` | POST | AdminKey | 20/60s | verified (boolean) | {ok, id, admin_verified} | 400Perfect! Now I have read all the files. Let me compile the comprehensive summary organized by module with test-relevant behavior.

---

## **IDENTITY PRISM BACKEND — E2E QA SUMMARY**

### **MODULE-BY-MODULE TEST REQUIREMENTS**

---

## **1. RATE LIMITS (PARTNER API & IP-BASED)**

**Rate Limit Middleware:** `apiKeyMiddleware.js:10-14`
- **Free tier:** 100 req/day, 10 req/min
- **Pro tier:** 10,000 req/day, 100 req/min  
- **Enterprise tier:** Unlimited daily, 1000 req/min
- **Daily quota reset:** UTC midnight (YYYY-MM-DD slice)
- **Per-minute window:** 60,000ms rolling
- **Usage tracking:** Upsert with conflict resolution on `api_key_usage` table
- **Key revocation:** Via `revoked_at` timestamp in `api_keys` table

**Observable QA cases:**
- Hit free tier daily limit → 429 response
- Hit pro tier per-minute limit → 429 response
- Revoked key → 401 response
- Enterprise key bypasses daily check → 200
- Daily counter persisted across requests → verify with SQL query

**Persistent Store:** `rateLimitStore.js:6-125`
- In-memory cache with 5,000 entry limit (LRU by insertion order)
- SQLite fallback with TTL-based expiration
- Cache pruning every get() if expired or if cache > 5000
- Cleanup job runs on startup (`cleanup()`)

**QA Test Points:**
- Cache miss → DB hit → return value
- Expired entries auto-deleted on access
- Cache exceeds 5000 → oldest key evicted
- Concurrent set/get operations → verify consistency

---

## **2. AUTHENTICATION & SESSION MANAGEMENT**

**JWT Auth:** `auth.js:18-26`
- **JWT TTL:** 24 hours (hardcoded `'24h'`)
- **Token encoding:** HS256, issuer: `'identity-prism'`, audience: `'identity-prism-api'`
- **Token invalidation:** Via `tokenVersion` increment in wallet database (allows mass logout)
- **IP tracking:** Per wallet (max 50 IPs cached, oldest shifted on overflow)
- **Secret management:** Env var `JWT_SECRET` or file fallback `.jwt_secret` (auto-generated if missing)

**Observable QA behavior:**
- Token expires after 24h → 401
- Increment `tokenVersion` → all existing tokens for wallet become invalid
- 51st unique IP for wallet → oldest IP dropped, new IP added
- Missing auth header → 401 with "Missing auth token" message
- Invalid signature → 401 with "Invalid or (bad bool), 404 (not found), 500 (DB) | — |
| `/api/admin/sybil/stats` | GET | AdminKey | 20/60s | — | {totalVerdicts, riskDistribution, last24h, clusters, temporalCohorts, fundingEdges, cacheStats, sqliteSize} | 429 (RL), 500 | 24h lookback = 86400000ms |
| `/api/admin/api-keys` | POST | AdminKey | 20/60s | owner_name, contact_email, tier (free/pro/enterprise), notes | {key, owner_name, tier} | 400 (tier invalid), 500 | tier must be one of 3 values |
| `/api/admin/api-keys` | GET | AdminKey | 20/60s | limit (1-200) | {keys: [{key_hash, owner_name, contact_email, tier, created_at, revoked_at, last_used_at, today_count}]} | 429 (RL), 500 | limit capped at 200 |
| `/api/admin/api-keys/:key/revoke` | POST | AdminKey | 20/60s | — | {ok, key_hash} | 404 (key not found/already revoked) | — |
| `/api/admin/set-coins` | POST | AdminKey | 30/60s | address, coins (number 0-1B) | {ok, address, balance} | 400 (invalid addr/coins range), 500 | coins: 0-1,000,000,000 max |
| `/api/admin/set-wallet` | POST | AdminKey | 30/60s | address, data (settable fields only) | {ok, address, updatedFields} | 400 (invalid fields), 500 | allowlist blocks internal fields (_*) |

**Auth Requirement Detail:** X-Admin-Key header must match `process.env.ADMIN_KEY` (timing-safe comparison). If ADMIN_KEY not set, all endpoints return 501 "Admin API not configured". (**Line 2-3, 18, 281-304**)

**Settable Fields in set-wallet:** coins, coinBalance, score, tier, badges, displayName, avatar, bio, socialLinks, suspended, flagged, notes, scanCount, firstSeenAt, lastSeenAt, source (**Line 313-318**)

---

### **2. auth.js** — Authentication (JWT/nonce flow)
**File:** `server/routes/auth.js` (162 lines)

| Endpoint | Method | Auth | Rate Limit | Key Test Parameters | Success Response | Critical Errors | Cooldowns |
|----------|--------|------|-----------|-------------------|------------------|-----------------|-----------|
| `/api/auth/challenge` | POST | None | 6/60s (enforced via custom RL) | address (required) | {nonce, message} | 400 (no addr, invalid addr), 429 (custom 3s min), 500 | **3-second minimum between challenges per IP** |
| `/api/auth/token` | POST | Nonce+Sig | 5s cooldown per IP | address, nonce, signature | {token, expiresIn} | 400 (missing fields), 401 (invalid/expired nonce, sig fail, addr mismatch), 500 | **5-second rate limit per IP** |

**JWT Details:** 
- Token payload: `{address}` 
- ExpiresIn: `jwtTtl` (from config)
- Challenge TTL: `authChallengeTtlMs` (default behavior)
- Challenge message format: `"Identity Prism auth\nAddress: {address}\nNonce: {nonce}"` (**Line 34**)
- One-time nonce use: deleted after successful auth (**Line 98**)

**Race Condition:** Signature verification falls back to reconstructed message if stored differs (**Line 80-84**)

---

### **3. blackhole.js** — Black Hole Cleanup expired auth token"

**Session tracking:** `auth.js:50-57`
- Per-address IP log stored in `walletIpLog` Map
- Each entry: `{ ips: [...], lastSeen: timestamp }`
- Max 50 IPs per address (shift oldest)

**QA Test Points:**
- Token revocation via tokenVersion increment → subsequent requests rejected
- Multiple concurrent logins from different IPs → all tracked
- 51st IP → 1st IP dropped from array
- lastSeen timestamp updated on every auth check

---

## **3. AUTHENTICATION CHALLENGES**

**Challenge lifecycle:** `scheduler.js:59-64`
- **Cleanup interval:** 60,000ms (1 minute)
- **Challenge expiration:** Based on `expiresAt` timestamp
- Removed from `authChallenges` Map when expired

**QA Test Points:**
- Challenge older than current time → auto-deleted on cleanup
- Challenge used (proof submitted) → must prevent replay

---

## **4. BLACK HOLE (ASSET CLEANUP/LIQUIDATION)**

**Core orchestrator:** `blackHoleOrchestrator.js:81-263`
- **Operation deduplication:** By-signature + by-account+mint+action composite key
- **Max operations per request:** 64 (enforced at line 46)
- **Durable replay protection:** SQLite `black_hole_signatures` table (idempotent insert)
- **In-memory cache cleanup:** 7-day TTL for used signatures (`cleanupBlackHoleUsedSignatures()` at line 23)

**Reward calculation:** `blackHoleRewards.js:1-24`
- **Fungible reward:** 8 PRISM per item
- **NFT reward:** 15 PRISM per item (requires decimals=0, amount=1 for detection)
- **SOL reward:** 8 PRISM per milli Rewards
**File:** `server/routes/blackhole.js` (35 lines)

| Endpoint | Method | Auth | Rate Limit | Key Test Parameters | Success Response | Critical Errors |
|----------|--------|------|-----------|-------------------|------------------|-----------------|
| `/api/blackhole/claim` | POST | JWT | 15/60s | payload (delegated to orchestrator) | {status, body} (delegated) | 400 (bad JSON), 429 (RL) |

**Orchestrator Delegation:** Actual logic in `services/blackHoleOrchestrator.js` — returns `{status, body}` (**Line 28**)

---

### **4. buy.js** — Coin Purchases (SOL & SKR)
**File:** `server/routes/buy.js` (377 lines)

| Endpoint | Method | Auth | Rate Limit | Params | Response | Errors | Limits |
|----------|--------|------|-----------|--------|----------|--------|--------|
| `/api/prism/buy/status` | GET | None | 20/60s | address | {purchasedToday, remainingToday, packages} | 400 (no addr, bad format) | — |
| `/api/prism/buy` | POST | JWT | 10/60s | packageIndex, txSignature | {balance, purchased, solPaid} | 400 (invalid pkg, daily limit), 429 (dup tx in progress), 500 | **Daily coin limit per address (dailyCoinLimit), max transfer = pkg.coins** |
| `/api/prism/buy/skr-quote` | GET | None | 20/60s | — | {quotes, solUsd, skrUsd} | 503 (price unavailable) | — |
| `/api/prism/buy/skr` | POST | JWT | 10/60s | packageIndex, txSignature | {balance, purchased, skrPaid} | 400 (daily limit), 429 (dup tx in progress), 503 (price unavailable) | **Daily limit applies, 95% slippage tolerance on SKR** |

**Transaction Verification:** 
- Pending tracking (`pendingBuyRequests`) prevents concurrent verifications (**Line 101, 103, 139**)
- Used-SOL (`Math.floor(netResolvedSol / 0.001)`)
- **Hard cap:** 500 PRISM per claim
- **Formula:** `Math.min(500, fungibleReward + nftReward + solReward)`

**Rate limiting (daily caps):** `blackHoleOrchestrator.js:178-195`
- **Black Hole cleanup cap:** Keyed `blackhole_cleanup:${address}:${today}` (stored in `prismEarnRateLimit`)
- **Non-game daily cap:** Keyed `nongame_daily:${address}` with `{ date: today, total: amount }`
- **Holder adjustment:** Holder cap = base cap; non-holder cap = base cap / 2 (via `getHolderAdjustedCap()`)

**Transaction verification:** `blackHoleTx.js:83-180`
- **Commission rate:** 10% standard, 2% for holder (checked at line 159)
- **Close operation:** Token program (`closeAccount` instruction) must signer=address, destination=address
- **Burn operation:** Token program (`burn`/`burnChecked`) with matching mint, authority=address
- **Swap operation:** Requires Jupiter program ID in tx accounts, pre-amount > 0, post-amount = 0

**Observable E2E behavior:**
- Duplicate signature → 400 "already claimed" (both in-memory check + DB check)
- Valid claim → coins credited + `addCoinEarned()` called + prism transaction logged + feed item added
- Daily cap hit → earned capped to remaining
- Holder vs non-holder → cap adjusted
- Failed verification → 400 with specific error (commission tx cache (`usedBuyTxSignatures`): 48-hour cleanup window (**Line 52-55**)
- Min SOL transfer = 99% of `pkg.solPrice * 1e9` lamports (**Line 125**)
- SKR transfer requires transferChecked instruction (mint verification) (**Line 289-302**)

**Transaction Aging:** Cleanup on every ~1000th request, removes entries >48h old (**Line 50-62**)

---

### **5. discovery.js** — Leaderboard, Feed, Enhanced Tx, Constellation
**File:** `server/routes/discovery.js` (265 lines)

| Endpoint | Method | Auth | Rate Limit | Params | Response | Notes |
|----------|--------|------|-----------|--------|----------|-------|
| `/api/leaderboard` | GET | None | 10/60s | limit (1-100) | {entries: [{address, totalCoins, score, tier, prismBalance, isMinted, badges, rank}]} | Ranked by coins+score |
| `/api/feed` | GET | None | 30/60s | limit (1-100) | {items} | Capped to 200 items stored |
| `/api/enhanced-tx` | GET | None | 30s rate limit (cached) | address | {swapCount, nftTradeCount, stakingCount, defiProtocols, isDeFiUser, isDeFiKing} | **30s cooldown per addr; 600s cache TTL** |
| `/api/constellation` | GET | Optional JWT | 10s cooldown (client), 10s per addr (server) | address, tier, limit (1-500) | {nodes, edges} | Capped to 200 nodes; constellation explored stat tracked |

**Constellation Mechanics:**
- 10-second per-address rate limit (**Line 133-137/close/burn/swap failed)
- Lamport delta negative (expense) → credited as-is to formula
- 5 NFTs + 10 fungibles + 100 milli-SOL → reward = min(500, 75 + 80 + 80) = 235

**State machine:**
1. Normalize & dedupe operations
2. Fetch transactions from RPC
3. Verify holder perks
4. Verify each operation (commission, close, burn/swap)
5. **Durable insert** into SQLite (transaction fails if signature exists)
6. Mark in-memory cache (fast path for replay within process)
7. Calculate reward with daily caps
8. Update coin balance & record transaction
9. Persist used signatures to JSON

**Replay protection (critical):**
- SQLite insert fails on duplicate → return 400 (line 160)
- In-memory cache cleared on error (releaseLock) BUT SQLite persists
- Signature cleanup: 7-day retention, then deleted

**QA Test Points:**
- Submit same signature twice → 2nd attempt fails with 400
- Submit 65 operations → 400 "array required"
- Missing swapSignature for swap action → 400 "swapSignature required"
- Holder account receives 10% commission, non-holder 10% → commission verification
- Claim expires after 7 days in in-memory cache → still blocked by SQLite
- Daily cap exceeded → reward capped to remaining balance for day

---

## **5. ECONOMY & COIN SYSTEM**

**Coin earning caps (per source):** `economyRules.js:1-14`
- game_orbit: 50/call
- game_defender: 50/call
- game_gravity: 50/call
- scan**)
- Viewer bonus: tracks `constellationExplored` stat for non-owner views (max 10/day) (**Line 244-251**)
- Node cap: 200 nodes max, edges filtered accordingly (**Line 232-234**)

---

### **6. earn.js** — Earn Coins (games, quests, scans, burns)
**File:** `server/routes/earn.js` (327 lines)

| Source | Max Per Call | Cooldown | Daily Cap | Other Limits |
|--------|-------------|----------|-----------|-------------|
| `game_orbit`, `game_defender`, `game_gravity` | `prismEarnMaxPerCall[source]` | Per-source table | `dailyGameCoinCap` (holder-adjusted) | Staking boost applied after cap |
| `first_mint` | Max allowed | Check lock set | Once per wallet | Prevents double-claim |
| `quest_daily`, `quest_weekly`, `quest_milestone` | Max allowed | Per source | Tied to quest cap | One claim per period |
| `text_quest` | Max allowed | Per source | Linked to nongame cap | Completion tracked |
| `challenge_win` | Max allowed | Per source | Linked to nongame cap | Race condition lock on address |
| `scan_wallet` | `scanWalletReward` | Per wallet+target | `dailyScanCap` | 60s cooldown per wallet+target |
| `sybil_hunt` | Computed per count | Once per wallet+target | `dailyHuntCap` | Bounty once per sybil target |

**Rate Limiting:**
- Per-source cooldown: `prismEarnCooldownTable[source] ?? prismEarnCooldownDefault` (**Line 80-82**)
- Global 2s minimum between earn requests (**Line 84-89**)
- Daily earn cap (non-game): `nonGameDailyE_wallet: 5/call
- achievement: 50/call
- quest_daily: 15/call
- quest_weekly: 50/call
- quest_milestone: 100/call
- challenge_win: 30/call
- first_mint: 1000/call
- text_quest: 1200/call
- sybil_hunt: 70/call

**Holder multiplier:** `identityPerks.js:1-4`
- Game coin multiplier: 2x for holder, 1x for non-holder
- Free revives per day: 3 for holder, 0 for non-holder
- Black Hole commission: 2% holder, 10% standard

**Quest reward cap logic:** `economyRules.js:24-30`
- Can award if: `dailyCount < maxDailyAnswers` AND `ngEarned + reward <= nonGameCap`
- Reject if either condition fails

**Staking & yield:** `yieldMath.js:1-82`
- **Staking tiers:** Bronze (10k min, 7-day lock, 0.75x rate), Silver (30k, 30-day, 1.0x), Gold (75k, 90-day, 1.25x)
- **Lock multipliers:** 7d=1.0x, 30d=1.5x, 90d=2.5x, 180d=4.0x (on base daily rate)
- **Yield brackets:** ≤5k @ 0.50%, 5k-20k @ 0.35%, 20k-50k @ 0.20%, 50k-100k @ 0.12%, >100k @ 0.08% daily
- **Unclaimed yield calculation:** `Math.min(90, daysSinceClaim) * dailyYield` (capped at 90 days)
- **Early withdrawal penalty:** 10% (7d), 15% (30d), 20% (90d), 25% (180d)

**Observable QA behavior:**
- Earn 50 coins from game → check coin balance incrementedarnCap` (holder-adjusted) (**Line 253-269**)

**Race Conditions:**
- Pending earn locks on `${address}:${source}` for quest claims (**Line 121-125**)
- Pending earn locks on `${address}:challenge_win` (**Line 174-194**)
- Staking boost applied AFTER daily cap (**Line 113, 269**)

**Sybil Hunt:** Computed reward based on claim count: `computeSybilHuntReward(count + 1)` (**Line 232**)

---

### **7. game.js** — Game Sessions, Coins, Achievements, Revives
**File:** `server/routes/game.js` (26.4 KB) — TWO HANDLERS

#### **registerGameV1Route** (Legacy)
| Endpoint | Method | Auth | Rate Limit | Params | Response |
|----------|--------|------|-----------|--------|----------|
| `/api/game/coins` | POST | JWT | 30/60s | delta (±integer) | {address, coins, earned, dailyRemaining, capped} |
| `/api/game/revives` | GET | None | 30/60s | address, mode (orbit/destroyer/gravity) | {address, mode, left, max, eligible} |
| `/api/game/revives` | POST | JWT | 15/60s | address, mode | {address, mode, success, left, max} |

#### **registerGameRoute** (Current)
| Endpoint | Method | Auth | Rate Limit | Params | Response | Notes |
|----------|--------|------|-----------|--------|----------|-------|
| `/api/game/session` | POST | JWT | 10/60s | payload (normalized) | {session: {..., verified, proofUrl}} | Validates seed+slot via MagicBlock; score delta tolerance ±5s |
| `/api/game/session/:id` | GET | None | 30/60s | — | {session} or {session, verificationWarning} | Re-verifies on fetch
- 2 earnings in same source on same day → sum applies per-call cap
- 100 coins earned + 2x multiplier → 200 coins credited
- Non-holder: 100 coins → 100 coins (no multiplier)
- Staking 50k for 90 days → yield per day = (50k * 0.20%) * 2.5 = 25 coins/day
- Early withdrawal after 30 days → 100 coins - 15% = 85 coins (plus 30-day accrued yield)
- Unclaimed yield >90 days → capped at 90 days worth

**Persistence:** `persistence.js:42-67`
- Wallet database saved debounced (no explicit delay, immediate in current code)
- Firestore batch write (async) with 450-op chunking (Firestore limit 500)
- SQL store replaces all entries in transaction

---

## **6. COMPOSITE SCORING & TIERS**

**Composite score formula:** `compositeScore.js:17-119`
- **On-chain component:** 0-400 (from `scoring.js`)
- **Sybil trust component:** 0-250 (adjusted by verdict)
- **Human proof:** 0-150 (games + achievements)
- **Social engagement:** 0-100 (arena + constellation + scans)
- **Quest engagement:** 0-100 (quests + streak + scans)
- **Hard cap:** 1000 total

**On-chain score breakdown:** `scoring.js:5-121`
- SOL balance: max 40 pts (10 SOL = 40)
- Wallet age: max 100 pts (730+ days = 100)
- Transactions: max 80 pts (>5000 = 80)
- NFTs: max 32 pts (>100 = 32)
- DeFi activity: max 30 pts (swaps + trades + protocols)
- Collection badges (Seeker, Visionary, Binary Sun |
| `/api/game/coins` | GET | None | 30/60s | address | {address, coins} | — |
| `/api/game/coins` | POST | JWT | 30/60s | delta, gameSessionId, mode | {address, coins, earned, dailyRemaining, boost, idMultiplier} | Requires verified session |
| `/api/game/achievements` | GET | None | 30/60s | address | {address, unlocked, claimed} | — |
| `/api/game/achievements` | POST | JWT | 20/60s | achievementId | {success, reward, newly_unlocked} | Claim achievement |

**Game Session Proof:**
- ID = `sha256(canonical).slice(0,16)` of normalized payload (**Line 181-182**)
- Canonical includes: walletAddress, score, survivalTime, seed, slot, timestamps, gameMode (**Line 170-180**)
- Score tolerance: ±5 seconds for orbit mode, <= maxDestroyerScore, <= maxGravityScore (**Line 186-200**)
- Max proofs cached: `maxGameSessionProofs`; evicts non-competitive sessions first (**Line 245-257**)

**Max Scores per Mode:** orbit=600, gravity=600, destroyer=9999, wars=600, territory=600 (**Line 465-466**)

**Coins Per Game:**
- Game cap holder-adjusted: `dailyGameCoinCap` vs half for non-holders (**Line 394**)
- Max delta per mode: `maxDeltaPerGame[gameMode] * gameSessionOnchainBonusMultiplier` (**Line 383**)
- Staking boost applied AFTER cap (**Line 407-408**)
- Identity holder multiplier pinned at session registration (**Line 374-380**)

---

### **8. health.js** — Health Check
**File:** `server/routes/health.js` (51 lines)

| Endpoint | Response |
|----------|----------|
| `/health` | {ok: true, version, uptime_seconds, deps: {wallet): max 50 pts
- Badges (OG, Titan, Whale, etc.): max 68 pts

**Tier mapping:** `compositeScore.js:3-7`
- mercury: 0-99
- mars: 100-219
- venus: 220-349
- earth: 350-479
- neptune: 480-599
- uranus: 600-699
- saturn: 700-799
- jupiter: 800-879
- sun: 880-949
- binary_sun: 950+

**Sybil verdict adjustments:** `sybilVerdict.js:54-62`
- clean: uses raw trust (0-100), recovery cap 25
- unknown: floor 50, ceil 55, recovery cap 10, no badges
- suspicious: floor 45, ceil 60, recovery cap 10, no badges
- cluster_linked: floor 35, ceil 50, recovery cap 6, no badges
- probable_sybil: floor 15, ceil 35, recovery cap 2, no badges
- confirmed_sybil: floor 0, ceil 20, recovery cap 0, no badges

**Badge eligibility (sybil-dependent):** `compositeScore.js:42-56`
- verified_human: sybilBadgeEligible + trustScore ≥ 80 → +10 pts
- cleanRecord: sybilBadgeEligible + trustScore ≥ 50 + riskScore < 10 → +10 pts
- trustPillar: sybilBadgeEligible + trustScore ≥ 95 → +10 pts
- gameMaster: 3+ game types → +10 pts
- achievementHunter: 10+ achievements → +10 pts
- highScorer: gameScoreTotal ≥ 40 → +10 pts
- arenaChampion: 5+ challenge wins → +8 pts
- topHunter: 20+ scans → +8 pts
- questMaster: 15+ quests completed → +8 pts
- questHunter: 10+ quests → +8 pts
- streakLord: 7+ consecutive days → +8 pts
- explorer: 20+ scans → +8 pts

**Observable QA behavior:**
- SOL balance 10 → 40 pts on-chain
- 5000 txs → 80 pts on-chain
- Total on-chain score 400 → appearsDatabase, mintedAddresses, rateLimitStore, sentry}} |

---

### **9. leaderboard.js** — Game Leaderboard Submission
**File:** `server/routes/leaderboard.js` (94 lines)

| Endpoint | Method | Auth | Rate Limit | Params | Response | Limits |
|----------|--------|------|-----------|--------|----------|--------|
| `/api/game/leaderboard` | GET | None | 60/60s | gameType | {entries} (top 50) | Cache 10s per filter |
| `/api/game/leaderboard` | POST | JWT | 20/60s | address, score, txSignature, gameType, gameSessionId | {entry, leaderboard} | Requires verified session, **score ±5 of proof, no reuse** |

**Validation:**
- Session must be unverified + matching wallet (**Line 59-61**)
- Score must be within ±5 of session proof (**Line 62**)
- gameType must match session.gameMode exactly (**Line 65**)
- Session can't be used twice for leaderboard (**Line 66, 76**)
- MAX_SCORES enforced: orbit=600, gravity=600, destroyer=9999, wars=600, territory=600 (**Line 68**)

---

### **10. market.js** — Collection Stats, Swaps (skeleton)
**File:** `server/routes/market.js` (20.6 KB, sample)

| Endpoint | Method | Auth | Rate Limit | Params | Response | Notes |
|----------|--------|------|-----------|--------|----------|-------|
| `/api/market/collection-stats` | GET | None | 20/60s | symbol/collectionId/name/mint | {floor, volume, stats} | Tries ME slug by mint, then candidates |

---

### **11. metadata.js** — Asset/Metadata Upload & Fetch
**File:** `server/routes/metadata.js` (192 lines)

| Endpoint | Method | Auth | Rate Limit | Params | Response | Notes |
|----------|--------|------|-----------|--------|----------|-------|
| `/assets in breakdown
- Sybil verdict "clean" → effectiveTrust = raw trust (no floor/ceil)
- Sybil verdict "confirmed_sybil" → effectiveTrust clamped to 0-20 + recovery (max 0)
- 5 challenge wins + verified_human badge → 8 + 10 = 18 pts from badges
- Composite score 1000 (capped) → tier "binary_sun"

---

## **7. SYBIL SCANNING & DETECTION**

**Scan orchestration:** `scanOrchestrator.js:41-150`
- **RPC batch fetch:** Up to 10 concurrent transaction fetches
- **Signature pagination:** 1000 sigs per page, max 10 pages (10,000 sigs limit)
- **Early transaction sampling:** Fetches last 100 sigs if >1000 exist
- **Enhanced tx history via Helius:** Caching 10-minute TTL, max 200 entries

**Sybil funding edge tracking:** `louvainCommunityDetection.js:14-33`
- **Edge lookback window:** 90 days
- **Edge limit per run:** 10,000 edges max for Louvain clustering
- **Min cluster size:** 3 members

**Louvain community detection:** `louvainCommunityDetection.js:80-88`
- Groups addresses by detected label (community)
- Filters clusters with <3 members
- Stores deterministic cluster ID (SHA256 of sorted members, first 24 chars)

**Sybil verdict derivation:** `sybilVerdict.js:152-228`
- **Verdict keys:** unknown, clean, suspicious, cluster_linked, probable_sybil, confirmed_sybil
- **Strong network signals:** graph_intelligence, fundingChainDepth ≥ 2, strongNetworkCount ≥ 2, sibling ≥ 5
- **Cluster linked` or `/metadata/assets` | POST | JWT | None | image (base64/dataUrl), contentType | {url} | Saves to assetsDir with UUID |
| `/assets/:file` or `/metadata/assets/:file` | GET | None | None | — | Binary image data | Serves stored file |
| `/metadata` | POST | JWT | 10/60s | metadata (object) | {uri} | Saves JSON to metadataDir |
| `/metadata/:file` | GET | None | None | — | JSON metadata | Serves stored metadata |

**File Validation:**
- Image types: png, jpg, jpeg, webp, gif (**Line 62-69**)
- Extension inferred from contentType or dataUrl header (**Line 53-56**)
- Filenames resolved via `resolveAssetFile()` (security: path traversal prevention) (**Line 71**)

---

### **12. notifications.js** — Push Notifications
**File:** `server/routes/notifications.js` (103 lines)

| Endpoint | Method | Auth | Rate Limit | Params | Response |
|----------|--------|------|-----------|--------|----------|
| `/api/notifications` | GET | JWT | 30/60s | — | {notifications, unreadCount} |
| `/api/notifications/read` | POST | JWT | 15/60s | ids (array) or all (boolean) | {ok: true} |
| `/api/notifications/delete` | POST | JWT | 15/60s | ids or all | {ok: true} |
| `/api/notifications/unread-count` | GET | None | None | address | {count} |

---

### **13. quest.js** — Quest Progress Sync
**File:** `server/routes/quest.js` (117 lines)

| Endpoint | Method | Auth | Rate Limit | Params | Response | Details |
|----------|--------|------|-----------|--------|----------|---------|
| `/api/quest/sync` | POST | JWT | 15/60s | address, quests | {ok: true} | Validates vs server snapshot, resets on period change |
| `/api/quest/progress` | GET | None | 30/60s | address | {quests, streakDays, lastStreakDate} | Public progress |

**Valid Quest IDs:** daily:** siblingCount ≥ 2 OR supportingNetworkCount ≥ 1 OR fundingChainDepth ≥ 1 OR topFunderTxCount ≥ 3 OR topFunderPct ≥ 40
- **Insufficient data:** txCount = 0 OR (txCount < 10 AND no strong signals AND riskScore < 60)
- **Network confirmed (probable/confirmed):** graph_intelligence signal OR strongNetworkCount ≥ 2 OR (strongNetworkCount ≥ 1 AND siblingCount ≥ 5) OR (fundingChainDepth ≥ 2 AND supportingNetworkCount ≥ 1)

**Sybil graph caching:** `sybilCluster.js:15-32`
- **Max graph nodes:** 10,000
- **Node TTL:** 90 days
- **Flagged cluster TTL:** 90 days, max 1000 clusters
- **LRU pruning:** Removes oldest (by lastSeen) when >10,000

**Observable QA behavior:**
- Wallet with <10 txs, no network signals → "unknown" verdict
- Wallet with graph_intelligence signal → "confirmed_sybil" or "probable_sybil"
- Wallet with 2 siblings + funding edge → "cluster_linked" minimum
- Sybil score increments on network signals: +15 per flagged funder, +10 per 2+ siblings, +20 if in flagged cluster
- Duplicate cluster detection → uses same cluster ID for same member set
- Graph node pruned after 90 days → no longer contributes to risk score

---

## **8. QUESTS & DAILY SYSTEMS**

**Quiz (question answering):** `scheduler.js:66-71`
- **Expiration check interval:** 300,000ms (5 minutes)
- **Quiz answers cleanup:** Removes expired entries from `quizAnswers` Map based on `expiresAt` timestamp

**Tournament_scan, daily_game, daily_burn, daily_explore, daily_highscore, weekly_burn5, weekly_games5, weekly_arena, weekly_streak, weekly_forge, ot_first_scan, ot_first_mint, ot_first_burn, ot_first_game, ot_reach_sun, ot_burn100, ot_score1000, ot_forge5, ot_arena_wins, ot_text_quest (**Line 23-28**)

**Streak Logic:**
- Requires 5 daily quests completed to increment (**Line 75**)
- Resets if >1 day gap without completion (**Line 73**)
- Sticky claim on period change (**Line 50-52**)

---

### **14. quiz.js** — Quiz Q&A
**File:** `server/routes/quiz.js` (120 lines)

| Endpoint | Method | Auth | Rate Limit | Params | Response | Limits |
|----------|--------|------|-----------|--------|----------|--------|
| `/api/quiz/question` | GET | None | 10/5s (!!) | — | {id (hex), question, options, category, difficulty} | **Tight 5s limit; question expires in 60s** |
| `/api/quiz/answer` | POST | JWT | 10/3s (!!) | id, answer | {correct, correctAnswer, earned} | **Tight 3s limit; daily quiz cap applied** |

**Daily Caps:**
- `dailyQuizCap` = max coins/day from quiz
- `quizCorrectReward` = coins per correct answer
- `maxDailyAnswers` = floor(dailyQuizCap / quizCorrectReward) (**Line 68**)
- Non-game earn cap overlap enforced (**Line 70-84**)

---

### **15. reputation.js** — Reputation/Sybil API
**File:** `server/routes/reputation.js` (33.3 KB, sample)

| Endpoint | Method | Auth | Rate Limit | Response | Notes |
|----------|--------|------|-----------|----------|-------|
| `/api/actions/sybil/:address` | GET | API Key | 20/60s | {type, icon, title, description, label, links.actions} | B checks:** `scheduler.js:73`
- **Interval:** 60,000ms (1 minute)
- `checkTournaments()` called to advance/complete tournaments

**Weekly Arena rewards:** `scheduler.js:75-149`
- **Distribution day:** Monday (UTC weekday 1)
- **Minimum participation:** 3 games per player (line 103)
- **Top 10 ranked:** By earned coins (calculated as `stakeAmount * 2 * 0.95`)
- **Weekly multiplier:** 2x stake for winner
- **Global guard:** `globalThis._lastWeeklyRewardAt` prevents double-run on Mondays

**Observable QA behavior:**
- Quiz answer expires > 5 minutes → auto-deleted on cleanup
- Arena player completes 2 games → excluded from weekly payout (min 3 required)
- Arena player wins 5 games, stakes 100 coins → earned = (100 * 2 * 0.95) = 190 coins per win
- Monday 00:00 UTC → weekly rewards triggered once (guard prevents repeat)
- #1 ranked gets `weeklyRewards[0]` + `weeklyXpRewards[0]` bonus

---

## **9. NOTIFICATIONS**

**Storage:** `dbSchema.js:68-71`
- SQLite table `notifications` with address PK, data (JSON)
- In-memory Map `notificationsDb` with debounced persist

**Persistence:** `persistence.js:73-89`
- `saveNotifications()` syncs Map to JSON or SQL store
- Debounced via `saveNotificationsDebounced()`

**Observable QA behavior:**
- Push notification triggers → added to `notificationsDb[address]`
- Server restart → notifications reloaded from SQL or JSON
- Notification array capped at ~200 per userlink card format |
| `/api/v1/reputation/:address` | GET | None (CORS) | 30/60s | Public reputation snapshot | **1-hour cache; public endpoints** |
| `/api/v1/reputation/:address/history` | GET | None (CORS) | 30/60s | Score history | — |

**API Key Check:** REPUTATION_API_KEYS env var (comma-separated), checked via `checkApiKey()` (**Line 10-12, 46**)

---

### **16. sybil.js** — Sybil Analysis & Detection
**File:** `server/routes/sybil.js` (22 KB, sample)

| Endpoint | Method | Auth | Rate Limit | Params | Response | Notes |
|----------|--------|------|-----------|--------|----------|-------|
| `/api/sybil/analysis` | GET | JWT (optional) | 5/60s (new analyses) | address | Full analysis or cached | In-flight dedup + cache |
| `/api/sybil/batch` | POST | None | 15s cooldown | addresses (array ≤20) | {results, total, analyzed} | Quick verdict from graph if uncached |
| `/api/sybil/stats` | GET | AdminKey | None | — | {totalAnalyzed, gradeDistribution, verdictDistribution} | Graph intelligence |
| `/api/sybil/graph` | GET | None | 6s per IP | address | {riskScore, trustGrade, verdict, walletAgeDays, siblingCount} | Safe subset, no full siblings |
| `/api/sybil/funding-sources` | GET | None (cached), rate limited (fresh) | 3/30s | address | {sources: [{address, label, type, totalSolReceived, %, firstInteraction}]} | Top 20 sources |
| `/api/sybil/cluster` | GET | None | 3 (typical soft limit in similar systems)

---

## **10. PERSISTENT STORAGE & DATA CONSISTENCY**

**Dual-layer storage:** `datastore.js:1-159`
- **L1:** SQLite (primary)
- **L2:** JSON file (fallback)
- **Debounce delay:** 500ms on JSON writes
- **Load precedence:** SQL > JSON (if SQL empty or missing)
- **Migration:** `migrateFromJson()` copies JSON to SQL if SQL is empty

**Critical tables:** `dbSchema.js:26-221`
- wallets: address PK, data (JSON), updated_at
- coin_balances: address PK, balance, earned
- score_history: (address, entry_idx) PK
- achievements: address PK
- revives: address PK
- quest_progress: address PK
- black_hole_signatures: signature PK (durable replay guard)
- sybil_verdicts: address PK, computed_at, ttl_expires_at
- api_keys: key_hash PK, tier, revoked_at
- api_key_usage: (key_hash, day) PK

**WAL mode:** `dbSchema.js:21`
- SQLite pragma `journal_mode = WAL` (write-ahead logging)
- Provides concurrent read + write capabilities
- Foreign keys enabled

**Observable QA behavior:**
- Wallet updated → SQLite + JSON (debounced 500ms)
- JSON file missing → SQL data loads successfully
- SQL query returns NULL, JSON has value → JSON returned (fallback)
- Process crashes mid-write → WAL ensures atomic commits
- Large batch update → transaction wraps 500+ ops in atomic block

**Data consistency risks:**
1. **Debounced JSON flush:** 500ms window where DB not synced
2. **Firestore batch writes:** 450-op chunk/30s | address | {clusterId, clusterSize, sharedFundingSource, siblingWallets, confidence} | 30m cache per addr |
| `/api/sybil/circular-flow` | GET | None | 3/30s | address | Circular funding detection | — |

**In-Flight Dedup:** If address already being analyzed, subsequent requests wait for result (**Line 65-72**)

**Verdict Mapping:** unknown, clean, suspicious, cluster_linked, probable_sybil, confirmed_sybil (**Line 154**)

---

### **17. spend.js** — Coin Spending (Forge items/modules, burns)
**File:** `server/routes/spend.js` (127 lines)

| Endpoint | Method | Auth | Rate Limit | Params | Response | Notes |
|----------|--------|------|-----------|--------|----------|-------|
| `/api/prism/spend` | POST | JWT | 20/60s | source, amount, itemId, moduleId, description | {balance, spent} | 2% burn fee deducted |

**Validation:**
- Amount: 1-1,000,000 coins (**Line 46**)
- Source: forge_module, forge_*, or other (**Line 54-78**)
- Forge module purchase: exact price match (**Line 57**)
- Forge item purchase: requires rank + unlock satisfaction (**Line 70-76**)
- Pending spend lock per address prevents race (**Line 80-83, 102**)

**Burn Fee:** 2% of spent amount (**Line 92, 109**)

---

### **18. tournament.js** — Tournament Entry & Submission
**File:** `server/routes/tournament.js` (164 lines)

| Endpoint | Method | Auth | Rate Limit | Params | Response | Limits |
|----------|--------|------|-----------|--------|----------|--------|
| `/api/tournament/active` | GET | Optional JWT | 20/60s | — | {tournaments: {daily, weekly, monthly, ...}} | User sees full limit, async (failures not retried)
3. **Wallet database + coin balances:** Separate stores, no transaction coordination
4. **Black Hole signature replay:** Relies on SQLite insert+in-memory check (no distributed lock)

---

## **11. RECOVERY (TWITTER VERIFICATION)**

**Recovery bonus calculation:** `reputationBuilder.js:120-168`
- **Twitter bonus:** Base 3 pts
  - Account age ≥3 years: +4 (total 7)
  - Account age ≥1 year: +2 (total 5)
  - 500+ followers: +3
  - 50+ followers: +1
  - 1000+ tweets: +2
  - 100+ tweets: +1
  - Cap: 12 pts
- **Activity bonus:** 0-8 pts
  - 3+ game types: +1
  - 15+ achievements: +2 (5+ achievements: +1)
  - 5+ quests: +1
  - 7+ streak days: +1
  - 10+ scans: +1
  - 3+ challenge wins: +1
  - 500+ coins earned: +1
- **Cross-verification bonus:** Additional conditional bonus
- **Total recovery cap:** 25 pts max on composite score (per verdict rules)

**Observable QA behavior:**
- Twitter verified, 3-year-old account, 500 followers, 1000 tweets → 3+4+3+2 = 12 pts (capped)
- Activity: 3 game types + 15 achievements + 5 quests + 7 days → 1+2+1+1 = 5 pts
- Combined (before cap): 12 + 5 = 17 pts
- Applied to composite (sybil=clean): min(17, 25) = 17 pts boost

---

## **12. SCHEDULER & BACKGROUND JOBS**

**Job state tracking:** `sybilClusterStore.js:65-90`
- Stored in `scheduler_job_runs leaderboard if joined |
| `/api/tournament/join` | POST | JWT | 10/60s | tier | {success, tier, prizePool, burned} | Entry fee deducted, burned per tier rate |
| `/api/tournament/submit` | POST | JWT | 15/60s | score, tier, gameSessionId | {success, tier, score} | Session must match tournament mode, score ±5 of proof |
| `/api/tournament/history` | GET | None | 30/60s | — | {tournaments} (top 20 completed) | — |

**Max Scores:** orbit=600, gravity=600, destroyer=9999 (**Line 137-138**)

**Score Validation:** ±5 of session proof, gameMode must match (**Line 133, 135**)

**Tier Config:** Entry fee + burnRate (%) → prize pool accumulation (**Line 103-104, 108**)

---

### **19. userData.js** — User Data, Perks, XP, Daily Limits
**File:** `server/routes/userData.js` (233 lines)

| Endpoint | Method | Auth | Rate Limit | Params | Response | Notes |
|----------|--------|------|-----------|--------|----------|-------|
| `/api/identity/perks` | GET | None | 30/60s | address | {address, ...perks} | Identity holder benefits |
| `/api/score-history` | GET | None | 30/60s | address | {address, scores, lastUpdated} | Historical composite scores |
| `/api/score-history` | POST | JWT | 20/60s | address | {address, scores, lastUpdated} | Server-computed tier (no client elevation) |
| `/api/prism/balance` | GET | None | 30/60s | address | {coinBalance, prismBalance} | — |
| `/api/xp` | GET | None | 20/60s | address | {sources, computedXP, computedRank} | Ranger XP snapshot |
| `/api/daily-limits` | GET | None | 20/60s | address | {game, hunt, scan, quiz, nonGame, blackHole} | Current day progress |
| `/api/prism/transactions` | GET | JWT | 20/60s | address` table: job_name, last_run_at, last_status, summary_json

**Louvain detection window:** `scheduler.js:53-57`
- Triggered on interval (scheduled separately)
- Uses `getMsUntilNextLouvainWindow()` for smart scheduling

**Startup cleanup:** `scheduler.js:11-19`
- Removes legacy SOL-based challenges from `activeChallenges` array
- Saves cleaned challenges to disk

**Observable QA behavior:**
- Louvain job fails → state marked as failed in DB (retriable)
- Louvain runs every N hours → detected by checking `last_run_at` delta
- Legacy SOL challenges removed → array length decreases, saved to disk

---

## **13. INITIALIZATION & BACKFILLING**

**Startup sequence:** `initOrchestrator.js:45-123`
- Migrates JSON data to SQLite (if SQL empty)
- Loads coin balances, minted addresses, score history, wallet DB
- Loads game sessions, achievements, revives, quests, notifications, challenges, tournaments
- Syncs minted addresses from wallet DB
- Runs sync backfill (wallet DB from score history + coin balances)
- Schedules async backfill (DAS lookup + sybil backfill)

**Sync backfill:** `walletBackfill.js:1-46`
- Only runs if wallet DB is empty
- Copies from score_history (scores array) and coin_balances
- Creates mint entries for all minted addresses

**Async backfill:** `walletBackfill.js:48-146`
- Requires CORE_COLLECTION env var
- Fetches NFT owners from DAS API (1000 per page)
- Updates wallet entries with mint metadata (assetId, score, tier, limit (1-100) | Tx history (last 500 stored) | — |
| `/api/user-data` | GET | JWT | 30/60s | — | {address, userData: {loadout, displayName, ...}} | Sanitizes loadout |
| `/api/user-data` | POST | JWT | 20/60s | userData (client fields only) | {ok, address, userData} | Whitelist: loadout, displayName, avatar, bio, socialLinks, settings, theme |

**Server-Enforced Tier Calculation:** (**Line 81**)
- binary_sun: ≥800
- pulsar: ≥600
- neutron_star: ≥400
- dwarf_star: ≥200
- mercury: <200

**Payload Size Cap:** 512 KB for POST /user-data (**Line 189**)

---

### **20. utility.js** — Utility (Migration, Scam Check)
**File:** `server/routes/utility.js` (94 lines)

| Endpoint | Method | Auth | Rate Limit | Params | Response | Notes |
|----------|--------|------|-----------|--------|----------|-------|
| `/api/migration-status` | GET | JWT | 20/60s | address | {migrated: boolean, migrationData} | Auth wallet must match queried address |
| `/api/scam-check` | POST | None | 10s cooldown per IP | address (contract) | {address, isKnownScam, programInfo, verdict} | Checks knownScamAddresses set, queries on-chain |

---

### **21. vault.js** — Staking (Prism Coins)
**File:** `server/routes/vault.js` (196 lines)

| Endpoint | Method | Auth | Rate Limit | Params | Response | Notes |
|----------|--------|------|-----------|--------|----------|-------|
| `/api/prism/vault/stake` | POST | JWT | 10/60s | amount, tier (bronze/silver/gold), lockDays | {success, staking, newBalance} | Min/max per tier, 500k cap, stats)
- Queues sybil analysis for wallets without analysis (500ms delay between calls)

**Observable QA behavior:**
- Empty wallet DB + populated score_history → backfilled with address + score + tier + coins
- Empty wallet DB + no score_history → wallet DB remains empty until first interaction
- DAS fetch returns 0 items → backfill terminates early
- Sybil backfill starts → polls internal /api/sybil/analysis endpoint (500ms throttle)

---

## **14. PERSISTENCE & FIREBASE SYNC**

**Async persistence:** `persistence.js:42-67`
- Wallet DB saved to JSON file (atomically via tmp file)
- **Firestore optional:** If `fbAvailable()`, batch writes wallets to Firestore (450 ops per batch)
- Failures logged but not retried

**Debounced saves:** 
- `saveWalletDatabaseDebounced()` → immediate (no delay in current code)
- `savePrismDataDebounced()` → debounced N ms
- `saveNotificationsDebounced()` → debounced N ms
- `saveChallenges()` → immediate

**Observable QA behavior:**
- Update wallet → saved to SQL + JSON (concurrent writes)
- Firestore unavailable → JSON still persists (graceful fallback)
- Firestore batch 500+ wallets → chunked into 450-op batches
- Process crash → WAL ensures SQL consistency, JSON may be stale (up to 500ms behind)

---

## **15. HELIUS ENHANCED TRANSACTIONS**

**Cache:** `heliusEnhanced.js:1-3`
- TTL: 600,000ms (10 minutes)
- Max entries: 200
- LRU eviction when cache exceeds 200

**Transaction classification/wallet |
| `/api/prism/vault/claim` | POST | JWT | 10/60s | — | {success, claimed, newBalance} | Yield calc from yield multiplier |
| `/api/prism/vault/unstake` | POST | JWT | 10/60s | — | {success, returned, yield, penalty, burned, early} | Early: earlyPenalty %, burned coins |
| `/api/prism/vault/status` | GET | None | 30/60s | address | {staking, unclaimedYield, timeLeft, dailyYield, effectiveRate} | — |

**Staking Limits:**
- Max stake/wallet: 500,000 coins (**Line 48**)
- Lock days: default 7, configurable
- Tier config: minStake, yieldMultiplier, earlyPenalty, boostRate (**Line 58**)

**Pending Ops Lock:** Prevents concurrent stake/claim/unstake (**Line 37-38, 86-87, 118-119**)

---

### **22. wallet.js** — Wallet Info, Recent Txs, Database Export
**File:** `server/routes/wallet.js` (221 lines)

| Endpoint | Method | Auth | Rate Limit | Params | Response | Notes |
|----------|--------|------|-----------|--------|----------|-------|
| `/api/wallet/tokens` | GET | None | 10s cooldown per IP | address | {solBalance, tokens: [{mint, amount, decimals, isNft}], totalTokens, totalNfts} | Top 30 tokens |
| `/api/wallet/recent-txs` | GET | None | 10s cooldown per IP | address | {transactions: [{signature, blockTime, balanceChange, fee, type, success, programCount}]} | Last 15 txs |
| `/api/wallet-database/stats` | GET | AdminKey | None | — | {totalWallets, totalMinted, avgScore, tierDistribution, sybilDistribution} | — |
| `/api/wallet-database/export` | GET | AdminKey | None | — | {version, exportedAt, totalWallets, wallets} | Full DB dump |
| `/api/wallet-database` | GET | AdminKey (bulk) or None (single) | 30/60s | address (optional), limit, offset, sort | Single: public data; bulk: admin data | Sort: score, scanCount, coins, lastSeenAt |

**Public Wallet Data:** address, tier, score, badges, composite, scoreBreakdown, joinedAt, lastSeenAt, tournamentXP (**Line 184-195**)

---

### **23. arena.js** — Challenges (1v1 Competitive)
**File:** `server/routes/arena.js` (28.9 KB, sample)

| Endpoint | Method | Auth | Rate Limit | Params | Response | Details |
|----------|--------|------|-----------|--------|----------|---------|
| `/api/challenge/create` | POST | JWT | 5/60s | type (score/game), gameMode (orbit/destroyer/gravity), stakeAmount (5-1000), opponent, expiresMinutes |:** `heliusEnhanced.js:5-16`
- defi: SWAP, ADD_LIQUIDITY, etc. (18 types)
- nft: NFT_SALE, NFT_MINT, TRANSFER, etc. (14 types)
- staking: STAKE_SOL, UNSTAKE_SOL, etc. (7 types)
- default: transfer

**Behavioral risk signals:** `heliusEnhanced.js:175-356`
- **Rapid cycling:** Incoming +0.01 SOL within 60s → outgoing -0.8x to 1.2x ratio → flag
- **Farming ratio:** shallow protocols (≤2 interactions) / total protocols
- **Behavior drift:** Jaccard similarity <0.1 (early vs. recent programs)
- **Dust transactions:** <0.001 SOL
- **Self-transfers:** Same source + destination
- **Failed tx ratio:** Count of failed transactions
- **Protocol interaction count:** Unique programs touched

**Observable QA behavior:**
- Fetch enhanced history (first call) → hits Helius API, caches 10 min
- Fetch same address within 10 min → returns cached
- Fetch 11th unique address → evicts oldest cached address
- 5 swaps on Orca, Raydium, Marinade → 3 protocols detected, isDeFiKing=true (≥2)
- Recent behavior (50 txs) only uses Serum, early (100 txs) used Orca + Marinade → drift detected

---

## **16. REPUTATION & PUBLIC REPUTATION API**

**Public reputation response:** `reputationBuilder.js:61-109`
- Includes composite score, tier, sybil risk, confidence, breakdown
- TTL header: `publicReputationTtlSeconds| Endpoint | Method | Auth | Rate Limit | Params | Response | Details |
|----------|--------|------|-----------|--------|----------|---------|
| `/api/challenge/create` | POST | JWT | 5/60s | type (score/game), gameMode (orbit/destroyer/gravity), stakeAmount (5-1000), opponent, expiresMinutes | {ok, challenge} | Validates stake balance, deducts immediately |
| `/api/challenge/leaderboard` | GET | None` (configurable)
- Sybil risk mapped: confirmed/probable → "high", cluster_linked/suspicious → "medium", else → "low"
- Confidence: `min(1, max(0, verdictConfidenceScore / 100))`

**Observable QA behavior:**
- Query address → response includes all components
- Sybil verdict absent → risk = "low", confidence = 0.35 (default)
- Composite score capped at 1000 → always ≤1000
- TTL header sent in response → cache directives followed by client

---

## **CRITICAL E2E DATA CONSISTENCY & RACE CONDITION RISKS**

### **1. Black Hole Signature Replay (Mitigated)**
- **Risk:** Double-spend same cleanup signature
- **Guard 1:** In-memory `blackHoleUsedSignatures` Map (process lifetime)
- **Guard 2:** SQLite `black_hole_signatures` table with PK on (signature)
- **Guard 3:** 7-day in-memory TTL + periodic cleanup
- **QA case:** Restart server, resubmit same signature → **fails** (SQLite guard persists)
- **QA case:** Submit signature twice in same request → first insert succeeds, dedup catches duplicate operations

### **2. Wallet Database Consistency**
- **Risk:** Coin balance updated but wallet entry stale
- **Guard:** Both coin_balances and wallets updated in same `setCoinBalance()` call
- **Debounce:** 500ms JSON flush
- **QA case:** Update coins → both SQL updated immediately, JSON eventually consistent
- **QA case:** Query coin balance immediately after update → SQL guarantees current value

### **3. Daily Cap Resets**
- **Risk:** Date boundary at | 30/60s | — | {ok, weekly, allTime, nextReset, minGames, xpRewards} | Min 3 games/week to rank |
| `/api/challenge/list` | GET | None | 60/60s | — | {ok, challenges} (open/playing, top 50) | Non-expired only |
| `/api/challenge/my` | GET | JWT | None | — | {ok, challenges} (creator or opponent) | Top 50 of user's challenges |
| `/api/challenge/accept` | POST | JWT | 10/60s | challengeId | {ok, challenge} | Auto-completes score challenges, triggers verification |
| `/api/challenge/start` | POST | JWT | None | challengeId | {ok: true} | Records start timestamp |
| `/api/challenge/submit` | POST | JWT | 15/60s | challengeId, score (0-100k), gameSessionId | {ok, challenge} | Game challenges only, requires session proof for high scores |

**Challenge Mechanics:**
- **Stake Range:** 5-1000 coins (**Line 74, 77**)
- **Expiry Options:** 15, 30, 60, 180, 360, 720, 1440 minutes (default 60) (**Line 127-129**)
- **Max Active:** 10,000; old completed/expired/cancelled >24h purged (**Line 134-149**)
- **Max Score No Proof:** 30 points; above requires verified session (**Line 471, 492-493**)
- **Score Tolerance:** ±5 of session proof (**Line 482**)
- **Score Champion Limits:** orbit=600, gravity=600, destroyer=9999, wars=600, territory=600 (**Line 465-466**)
- **Pending Submit Lock:** Per `${challengeId}:${submitter midnight UTC; client submits in different timezone
- **Guard:** All cap keys use UTC date string `YYYY-MM-DD` (hardcoded `new Date().toISOString().slice(0, 10)`)
- **QA case:** Submit claim at 23:59:59 UTC → uses today's cap. At 00:00:01 UTC → uses new day's cap (verified by DB key)

### **4. Sybil Verdict TTL**
- **Risk:** Stale verdict used for composite score
- **Fields:** `ttl_expires_at`, `computed_at`
- **QA case:** Verdict older than TTL → should not be used (check `refreshCachedSybilAnalysis()`)
- **Scheduler:** No automatic refresh visible; caller responsible for checking TTL

### **5. Rate Limit Concurrent Increments**
- **Risk:** 2 requests in same millisecond → increment not atomic
- **Guard:** SQLite with `ON CONFLICT DO UPDATE SET count = count + 1`
- **QA case:** 2 requests in parallel → both hit DB, count incremented twice (correct)
- **QA case:** Rate limit check + increment → sequential (check first, then increment)

### **6. Firestore Batch Write Failures**
- **Risk:** Wallet updated, Firestore write fails
- **Guard:** None; failures logged, not retried
- **QA case:** FB unavailable → JSON persists, FB out of sync
- **QA case:** FB write fails mid-batch (500+ ops) → partial writes possible

### **7. Token Revocation (tokenVersion)**
- **Risk:** Token version check not atomic with DB update
- **Guard:** In-memory walletDatabase check on every request
- **QA case:** Increment tokenVersion → all existing JWT tokens rejected (next request)
- **Race:** Token issued → tokenVersion incremented → request with old token → rejected ✓

---

## **NUMERIC THRESHOLDS & CAPS SUMMARY**

| Component | Threshold | Citation |
|-----------|-----------|----------|
| JWT TTL | 24h | auth.js:18 |
| IP tracking per wallet | 50 max | auth.js:54 |
| API key free tier daily | 100 req | apiKeyMiddleware.js:11 |
| API key free tier per-minute | }` to prevent race (**Line 496-501**)

**Score Challenge Auto-Complete:**
- On accept, fetches composite scores from both wallets (**Line 329-340**)
- Winner determined immediately, prize awarded (**Line 347-373**)
- 10% fee → burned (**Line 343-345**)
- Refunds on tie or score fetch failure (**Line 368-372, 383-390**)

**Game Challenge:**
- Stays `playing` status until both scores submitted (**Line 397**)
- Winner determined when 2nd score in; 5% fee (**Line 528-550**)

**Weekly Leaderboard:** Resets Sunday UTC 00:00; min 3 games to rank (**Line 209, 211**)

---

### **24. blinks.js** — NFT Minting (Solana Actions)
**File:** `server/routes/blinks.js` (66.5 KB, extensive — sample coverage)

Core minting flow involves:
- Identity holder NFT creation via MPL Core
- Custom card generation (front/back)
- Treasury wallet fee management
- SOL/SKR payment options
- Metadata upload to IPFS-compatible service

**Key Mechanics (from samples):**
- Mint price: `mintPriceSol` (configurable)
- SKR as alt payment option
- Collection validation via `coreCollection`
- Keypair signing via `treasurySecret` or file-based `treasurySecretPath` (**Line 74-75, 81**)
- Pending mint tracking to prevent double-mint (**Line 83-84**)

---

## **PART 2: CROSS-MODULE SUMMARY**

### **AUTH**
- **Challenge Creation:** POST `/api/auth/challenge` —## **NUMERIC THRESHOLDS & CAPS SUMMARY (CONTINUED)**

| Component | Threshold | Citation |
|-----------|-----------|----------|
| API key free tier per-minute | 10 req | apiKeyMiddleware.js:11 |
| API key pro tier daily | 10,000 req | apiKeyMiddleware.js:12 |
| API key pro tier per-minute | 100 req | apiKeyMiddleware.js:12 |
| API key enterprise per-minute | 1000 req | apiKeyMiddleware.js:13 |
| Black Hole operations per request | 64 max | blackHoleOrchestrator.js:46 |
| Black Hole fungible reward | nonce issued
- **Token Issuance:** POST `/api/auth/token` — JWT with address
- **Rate Limits:** 3s min between challenges per IP; 5s cooldown on token auth per IP
- **JWT TTL:** Configurable `jwtTtl`
- **Challenge TTL:** `authChallengeTtlMs`
- **One-Time Use:** Nonce deleted after first successful token claim

### **ECONOMY (Coins/Prism)**
**Sources:** game coins, quest rewards, scan_wallet, sybil_hunt, first_mint, text_quest, challenge_win, achievement, burn
- **Per-Source Cooldowns:** Configurable table `prismEarnCooldownTable`; default `prismEarnCooldownDefault`
- **Global Earn Cooldown:** 2 seconds minimum between any earn requests per wallet
- **Daily Caps:**
  - `dailyGameCoinCap` (holder-adjusted: non-holders get 50%)
  - `nonGameDailyEarnCap` (quest, scan, hunt, etc.)
  - `dailyQuizCap` per quiz correct answers
  - `dailyHuntCap` for sybil hunt specifically
  - `dailyScanCap` for wallet scans
  - `dailyBlackHoleCleanupCap` for cleanup rewards
- **Staking Boost:** Applied AFTER daily cap (multiplication)
- **Buy Limits:** `dailyCoinLimit` per address per day (SOL & SKR unified)
- **Max Buy Per Wallet:** 1,000,000,000 coins (admin set-coins only)

### **GAME**
- **Session Registration:** POST `/api/game/session 8 PRISM | blackHoleRewards.js:2 |
| Black Hole NFT reward | 15 PRISM | blackHoleRewards.js:3 |
| Black Hole SOL reward | 8 PRISM/milli-SOL | blackHoleRewards.js:4 |
| Black Hole hard cap | 500 PRISM | blackHoleRewards.js:1 |
| Black Hole standard commission | 10% | identityPerks.js:4 |
| Black Hole holder commission | 2% | identityPerks.js:4 |
| In-memory BH signature TTL | 7 days | blackHoleSignatureStore.js:24 |
| Game coin multiplier (holder) | 2x | identityPerks.js:1 |
| Game coin multiplier (non-holder) | 1x | identityPerks.js:1 |
| Free revives per day (holder) | 3 | identityPerks.js:12-17 |
| Free revives per day (non-holder) | 0 | identityPerks.js:12-17 |
| On-chain score max | 400 | scoring.js:3 |
| Composite score max | 1000 | compositeScore.js:90 |
| SOL balance on-chain pts | 40 max | scoring.js:8 |
| Wallet age on-chain pts | 100 max | scoring.js:17 |
| Transaction count on-chain pts | 80 max | scoring.js:26 |
| NFT count on-chain pts | 32 max | scoring.js:37 |
| DeFi activity on-chain pts | 30 max | scoring.js:44-59 |
| Collection badges on-chain pts | 50 max | scoring.js:60-63 |
| Badge bonus pts | 68 max | scoring.js:65-76 |
| Sybil trust component max | 250 | compositeScore.js:72 |
| Human proof component max | 150 | compositeScore.js:77 |
| Social engagement component max | 100 | compositeScore.js:83 |
| Quest engagement component max | 100 | compositeScore.js:88 |
| Game score component (log-based) | 80 max | compositeScore.js:50 |
| Verified human badge threshold | trustScore ≥ 80 | compositeScore.js:43 |
| Clean record badge threshold | trustScore ≥ 50, riskScore ` — MagicBlock seed validation required
- **Score Tolerance:** ±5 seconds (orbit), bounded by duration for destroyer/gravity
- **Max Score Enforced:** Per mode (orbit=600, gravity=600, destroyer=9999, wars=600, territory=600)
- **Session Reuse:** Can't be used twice for leaderboard, tournament, or challenge
- **Max Pending Sessions:** `maxGameSessionProofs` (evicts oldest non-competitive)
- **Daily Game Coin Cap:** Holder-adjusted (full vs 50%)
- **Staking Boost:** Applied after cap
- **Revives:** `freeRevivesPerDay` (mode-specific)
- **Achievements:** Locked unlock requirements + on-chain verification

### **SYBIL SCAN**
- **Analysis Rate Limit:** 5 new/60s per IP (cache + in-flight dedup)
- **Cache TTL:** 3600s (1 hour) for fresh, longer for own wallet
- **In-Flight Dedup:** Shared promise prevents concurrent duplicate analyses
- **Batch Analysis:** Max 20 addresses per POST, 15s cooldown
- **Funding Sources:** Top 20, 30m cache per address
- **Cluster Detection:** 30m cache; confidence = 30 + (sibling_count * 10), max 100
- **Graph Lookup:** 6s per IP rate limit
- **Verdict Types:** unknown, clean, suspicious, cluster_linked, probable_sybil, confirmed_sybil

### **ARENA (Challenges)**
- **Stake Range:** 5-1000 coins
- **Max Stake/Challenge:** 1000 coins
- **Expiry Options:** 15, 30, 60, 180, 360, 720, 1440 minutes
- **Max Active Challenges:** 10,000 (auto-purges old)
- **Max Score No Proof:** 30 (unverified session)
- **Score Challenge:** Auto-complete< 10 | compositeScore.js:44 |
| Trust pillar badge threshold | trustScore ≥ 95 | compositeScore.js:45 |
| Game master badge threshold | 3+ game types | compositeScore.js:53 |
| Achievement hunter badge threshold | 10+ achievements | compositeScore.js:54 |
| High scorer badge threshold | gameScoreTotal ≥ 40 | compositeScore.js:55 |
| Arena champion badge threshold | 5+ challenge wins | compositeScore.js:58 |
| Top hunter badge threshold | 20+ scans | compositeScore.js:59 |
| Quest master badge threshold | 15+ quests | compositeScore.js:60 |
| On-chain tier thresholds | 99, 219, 349, 479, 599, 699, 799, 879, 949 | compositeScore.js:3-6 |
| Sybil clean verdict floor | 0, ceil 100 | sybilVerdict.js:56 |
| Sybil unknown verdict floor | 50, ceil 55 | sybilVerdict.js:57 |
| Sybil suspicious verdict floor | 45, ceil 60 | sybilVerdict.js:58 |
| Sybil cluster_linked floor | 35, ceil 50 | sybilVerdict.js:59 |
| Sybil probable_sybil floor | 15, ceil 35 | sybilVerdict.js:60 |
| Sybil confirmed_sybil floor | 0, ceil 20 | sybilVerdict.js:61 |
| Sybil recovery cap (clean) | 25 pts | sybilVerdict.js:55 |
| Sybil recovery cap (unknown/suspicious) | 10 pts | sybilVerdict.js:57-58 |
| Sybil recovery cap (cluster_linked) | 6 pts | sybilVerdict.js:59 |
| Sybil recovery cap (probable_sybil) | 2 pts | sybilVerdict.js:60 |
| Sybil recovery cap (confirmed_sybil) | 0 pts | sybilVerdict.js:61 |
| Twitter account bonus base | 3 pts | reputationBuilder.js:127 |
| Twitter 3+ years bonus | +4 pts | reputationBuilder.js:129 |
| Twitter 1+ years bonus | +2 pts | reputationBuilder.js:130 |
| Twitter 500+ followers bonus | +3 pts | reputationBuilder.js:131 |
| Twitter 50+ followers bonus | +1 pt | reputationBuilder.js:132 |
| Twitter 1000 on accept (no replay risk)
- **Game Challenge:** Waits for both scores, then settles
- **Prize Calc:** (stakeAmount × 2) × 0.95 = winner prize; remaining 5% burned
- **Weekly Leaderboard:** Min 3 games to rank; resets Sunday UTC
- **Pending Submit Lock:** Per challenge ID + submitter address

### **BLACK HOLE (Cleanup)**
- Delegated to `blackHoleOrchestrator`
- Daily cap: `dailyBlackHoleCleanupCap`
- Reward structure: TBD in orchestrator

### **FORGE/SHOP (Spend)**
- **Source Categories:** forge_module, forge_* (items by category)
- **2% Burn Fee:** Applied to all spend
- **Rank Requirements:** `requiredRank` per item
- **Unlock Conditions:** Server-validated before purchase
- **Max Spend/Wallet/Tx:** 1,000,000 coins
- **Pending Spend Lock:** Per address prevents race

### **VAULT (Staking)**
- **Tiers:** bronze, silver, gold (configurable min/max)
- **Max Stake/Wallet:** 500,000 coins
- **Lock Days:** Default 7; configurable per stake
- **Yield Multiplier:** Per lock tier
- **Early Unstake Penalty:** Per tier (default ~25%)
- **Pending Staking Ops Lock:** Prevents concurrent operations
- **Daily Yield Calc:** Tied to lock multiplier + tier rate

### **QUESTS**
- **Valid Quest IDs:** 20 total (5 daily, 5 weekly, 10 one-time)
- **Daily Quest Completion:** Any 1 of (daily_scan, daily_game, daily_burn, daily_explore, daily_highscore)
- **Streak Logic:** Requires 5 consecutive days;+ tweets bonus | +2 pts | reputationBuilder.js:133 |
| Twitter 100+ tweets bonus | +1 pt | reputationBuilder.js:134 |
| Twitter bonus cap | 12 pts | reputationBuilder.js:135 |
| Activity 3+ game types bonus | +1 pt | reputationBuilder.js:140 |
| Activity 15+ achievements bonus | +2 pts | reputationBuilder.js:141 |
| Activity 5+ achievements bonus | +1 pt | reputationBuilder.js:142 |
| Activity 5+ quests bonus | +1 pt | reputationBuilder.js:143 |
| Activity 7+ streak days bonus | +1 pt | reputationBuilder.js:144 |
| Activity 10+ scans bonus | +1 pt | reputationBuilder.js:145 |
| Activity 3+ challenge wins bonus | +1 pt | reputationBuilder.js:146 |
| Activity 500+ coins earned bonus | +1 pt | reputationBuilder.js:147 |
| Activity bonus cap | 8 pts | reputationBuilder.js:148 |
| Sybil graph max nodes | 10,000 | sybilCluster.js:15 |
| Sybil graph node TTL | 90 days | sybilCluster.js:16 |
| Flagged cluster TTL | 90 days | sybilCluster.js:25 |
| Flagged cluster max count | 1000 | sybilCluster.js:30 |
| Louvain edge lookback | 90 days | louvainCommunityDetection.js:15 |
| Louvain edge limit | 10,000 | louvainCommunityDetection.js:14 |
| Louvain min cluster size | 3 | louvainCommunityDetection.js:16 |
| Sybil graph funding funder risk bonus | +15 | sybilCluster.js:62 |
| Sybil graph sibling risk bonus (2+) | +10 | sybilCluster.js:72 |
| Sybil graph cluster membership bonus | +20 | sybilCluster.js:77 |
| Sybil graph max risk cap | 40 | sybilCluster.js:82 |
| Rate limit cache max entries | 5,000 | rateLimitStore.js:54 |
| Rate limit default TTL | 86,400s (1 day) | rateLimitStore.js:106 |
| Helius tx cache TTL | 600,000ms (10m) | heliusEnhanced.js:1 |
| Helius tx cache max entries resets if >1 day gap
- **Sticky Claim:** Once claimed per period, stays claimed until period resets
- **Claim Lock:** Per `${address}:${source}:${questId}` prevents race

### **QUIZ**
- **Rate Limit:** 10/5s for question (TIGHT), 10/3s for answer (TIGHT)
- **Question TTL:** 60s
- **Daily Cap:** `dailyQuizCap` (calculated as max_answers = cap / reward)
- **Correct Reward:** `quizCorrectReward` per answer
- **Non-Game Cap Overlap:** Quiz earnings count against `nonGameDailyEarnCap`

### **NFT MINT**
- **Mint Price:** `mintPriceSol` (configurable)
- **SKR Alternative:** Price quoted via `getSkrQuote()`
- **Collection:** Validated via `coreCollection`
- **Card Generation:** Front/back custom images
- **Metadata:** Uploaded to `metadataDir` with UUID
- **Treasury Wallet:** Fee management via keypair signing
- **Pending Mint Tracking:** Prevents double-mint race

### **RANKS/TIERS (Composite Score)**
- **Tier Thresholds:**
  - binary_sun: ≥800
  - pulsar: ≥600
  - neutron_star: ≥400
  - dwarf_star: ≥200
  - mercury: <200
- **Composite Input:** Sybil analysis + on-chain signals
- **Server-Enforced:** No client elevation allowed
- **Score History:** Tracked per wallet

### **LEADERBOARD**
- **Game Leaderboard:** Top 50 per game mode, cached 10s
- **Challenge Leaderboard:** Top 20 weekly (min 3 games), all-time
- **Global Leaderboard:** Ranked by coins+score
- **Submission Validation:** Session proof required, score ±5 match, no reuse

### **COMPOSITE | 200 | heliusEnhanced.js:2 |
| Helius page size | 100 txs | heliusEnhanced.js:3 |
| Helius max fetch limit | 10,000 txs | heliusEnhanced.js:360 |
| Shallow protocol threshold | ≤2 interactions | heliusEnhanced.js:285 |
| Deep protocol threshold | ≥5 interactions | heliusEnhanced.js:286 |
| Behavior drift Jaccard threshold | <0.1 | heliusEnhanced.js:318 |
| Dust transaction threshold | <0.001 SOL | heliusEnhanced.js:270 |
| Rapid cycle time window | 60 seconds | heliusEnhanced.js:295 |
| Rapid cycle ratio range | 0.8-1.2x | heliusEnhanced.js:297 |
| Auth challenge cleanup interval | 60,000ms (1m) | scheduler.js:64 |
| Quiz answer cleanup interval | 300,000ms (5m) | scheduler.js:71 |
| Tournament check interval | 60,000ms (1m) | scheduler.js:73 |
| Weekly arena min games | 3 | scheduler.js:103 |
| Weekly arena top players | 10 | scheduler.js:107 |
| Weekly arena winner multiplier | 2x stake | scheduler.js:92 |
| Weekly arena tax | 5% (0.95x) | scheduler.js:92 |
| Sybil scan version | 1 (configurable) | scanOrchestrator.js:33 |
| Scan signature pagination | 1,000 sigs/page | scanOrchestrator.js:104 |
| Scan max pages | 10 (10,000 sig max) | scanOrchestrator.js:113 |
| Datastore JSON debounce | 500ms | datastore.js:22 |
| Firestore batch chunk size | 450 ops | firebase.js:68 |
| Wallet database max transaction history | 500 txs | blackHoleOrchestrator.js:223 |
| Feed items max | 200 | blackHoleOrchestrator.js:233 |
| Staking bronze min | 10,000 coins | yieldM SCORE**
- **Calculation:** `calculateCompositeScore(buildCompositeInput(address))`
- **Inputs:** Wallet age, sybil verdict, on-chain activity, game scores
- **Update Trigger:** `triggerCompositeUpdate(address)` on challenge/quest completion
- **Cache:** In walletDatabase.get(address).composite

### **RECOVERY (Migration)**
- **Status Check:** GET `/api/migration-status?address=` (JWT only, auth wallet must match)
- **One-Time Claim:** `_v2MigrationResult` deleted after retrieval

### **NOTIFICATIONS**
- **Push Notification Types:** quest_milestone, challenge_win, challenge_loss, etc.
- **Storage:** Per-wallet notification list (notificationsDb)
- **Read/Delete:** Bulk operations (ids array or all flag)
- **Unread Count:** Public endpoint (no auth)

### **RATE LIMITS**
**Global Patterns:**
- **IP-based:** Most endpoints rate limit by getClientIp()
- **Wallet-based:** Earn, spend, vault ops per address
- **Custom Cooldowns:** Auth (3s, 5s), quiz (5s, 3s), certain sybil ops (10s, 15s, 30s)

**Storage:** `reputationRateLimit` (Map), `prismEarnRateLimit` (getPrismEarnRateLimit/setPrismEarnRateLimit), `pendingStakingOps` (Set), `pendingEarnRequests` (Set)

---

## **PART 3: CONCRETE NUMERIC THRESHOLDS & CAPS**

| Parameter | Value | File/Line | Notes |
|-----------|-------|-----------|-------|
| Challenge min stake | 5 coins | arena.js:74 | validationath.js:2 |
| Staking silver min | 30,000 coins | yieldMath.js:3 |
| Staking gold min | 75,000 coins | yieldMath.js:4 |
| Staking bronze lock | 7 days | yieldMath.js:2 |
| Staking silver lock | 30 days | yieldMath.js:3 |
| Staking gold lock | 90 days | yieldMath.js:4 |
| Yield bracket 1 rate | 0.50% daily | yieldMath.js:15 |
| Yield bracket 2 rate | 0.35% daily | yieldMath.js:16 |
| Yield bracket 3 rate | 0.20% daily | yieldMath.js:17 |
| Yield bracket 4 rate | 0.12% daily | yieldMath.js:18 |
| Yield bracket 5 rate | 0.08% daily | yieldMath.js:19 |
| Yield unclaimed days cap | 90 days | yieldMath.js:60 |
| 7-day lock multiplier | 1.0x | yieldMath.js:8 |
| 30-day lock multiplier | 1.5x | yieldMath.js:9 |
| 90-day lock multiplier | 2.5x | yieldMath.js:10 |
| 180-day lock multiplier | 4.0x | yieldMath.js:11 |
| Early withdrawal penalty (7d) | 10% | yieldMath.js:8 |
| Early withdrawal penalty (30d) | 15% | yieldMath.js:9 |
| Early withdrawal penalty (90d) | 20% | yieldMath.js:10 |
| Early withdrawal penalty (180d) | 25% | yieldMath.js:11 |

---

## **DAILY RESET BEHAVIOR & TIME BOUNDARIES**

**UTC-based resets (all use ISO date string YYYY-MM-DD):**
1. **API key daily quota:** Reset at 00:00:00 UTC (midnight)
   - Key: `api_key_usage.day = toISOString().slice(0,10)`
   - QA: Submit 100 requests by 23:59:59 UTC → day's quota used. At 00:00:01 UTC → new quota available

2. **Black Hole daily cap:** Reset daily per `blackhole_cleanup:${address}:${today}`
   - Key generated: `const today = new Date().toISOString().slice(0, 10)`
   - QA: Submit claim at 23:59 UTC using up cap. After midnight → new cap applies

3. **Non-game daily cap:** Reset daily per `nongame_daily: |
| Challenge max stake | 1000 coins | arena.js:77 | validation |
| Challenge expiry max | 1440 minutes | arena.js:127 | 24 hours |
| Max active challenges | 10,000 | arena.js:134 | before purge triggers |
| Challenge max score (no proof) | 30 points | arena.js:471 | game challenge only |
| Max score orbit/gravity | 600 | game.js:465 | leaderboard validation |
| Max score destroyer | 9999 | game.js:465 | leaderboard validation |
| Game score tolerance | ±5 seconds | game.js:200 | vs session proof |
| Max game sessions cached | `maxGameSessionProofs` | game.js:245 | evicts oldest non-competitive |
| Max tokens per wallet query | 30 | wallet.js:58 | sorted by amount |
| Max recent txs per wallet | 15 | wallet.js:82 | sig limit per RPC call |
| Quiz question TTL | 60 seconds | quiz.js:39 | expiration check |
| Quiz rate limit (question) | 10/5s | quiz.js:36 | per client IP (TIGHT) |
| Quiz rate limit (answer) | 10/3s | quiz.js:46 | per JWT wallet (TIGHT) |
| Daily coin limit (buy) | `dailyCoinLimit` | buy.js:35-36 | per address per day |
| Max coins (admin set) | 1,000,000,000 | admin.js:287 | upper bound |
| Max stake per wallet | 500,000 coins | vault.js:48 | staking limit |
| Early unstake penalty | `earlyPenalty` per tier | vault.js:136-137 | % of staked amount |
| Staking lock days (default) | 7 days | vault.js:42 | configurable |
| Challenge prize calc | (stake × 2) × 0.95 | arena.js:181, 344 | 5% fee burned |
| Spend burn fee | 2% | spend.js:92 | flat rate |
| Leaderboard entries shown | 50 max | leaderboard.js:35, 82 | per mode |
| Constellation nodes cap | 200 | discovery.js:232 | for viz performance |
| Constellation edges cap | derived${address}` with date field
   - Stores: `{ date: today, total: amount }`
   - Checked: `if (ngEntry && ngEntry.date === today) { ngEarned = ngEntry.total }`
   - QA: Quiz reward at 23:59 UTC uses current day. At 00:01 UTC next day → previous day data ignored

4. **Weekly rewards:** Triggered on Monday (UTC day 1) at any time, guard prevents duplicate
   - Check: `if (d.getUTCDay() !== 1) return`
   - Guard: `globalThis._lastWeeklyRewardAt >= mondayStart.getTime()`
   - QA: Monday 00:00 UTC → triggered once. Monday 12:00 → already triggered. Tuesday → skipped

---

## **SIGNATURE VERIFICATION & TRANSACTION VALIDATION**

**Black Hole transaction verification:** `blackHoleTx.js:83-180`

**Close operation verification:**
- Must include `closeAccount` instruction from Token program
- Instruction parsed info must have:
  - `account` (account being closed) = operation.account
  - `destination` (recipient of closed account lamports) = address (wallet)
  - `owner` (authority signing close) = address (wallet)
- Wallet must be in transaction's account keys

**Burn operation verification:**
- Requires Close operation to also pass (line 99)
- Must include `burn` or `burnChecked` instruction from Token program
- Instruction parsed info must have:
  - `account` (token account) = operation.account
  - `authority` (signer) = address (wallet)
  - `mint` (token mint) = operation.mint

**Swap operation verification:**
- Must have no meta from nodes | discovery.js:234 | filtered by node membership |
| Max metadata payload | 512 KB | userData.js:189 | POST /api/user-data |
| Sybil batch max addresses | 20 | sybil.js:105 | per request |
| Sybil in-flight dedup | per address | sybil.js:65-79 | shared promise |
| Sybil cache TTL | 3600 seconds | sybil.js:116, 212 | 1 hour fresh |
| Sybil funding sources top N | 20 | sybil.js:224 | max returned |
| Sybil cluster confidence | 30 + (siblings × 10) | sybil.js:288 | capped at 100 |
| Cluster cache TTL | 1800 seconds | sybil.js:249 | 30 minutes |
| Funding sources cache TTL | 3600 seconds | sybil.js:212 | 1 hour |
| Buy tx cleanup window | 48 hours | buy.js:52 | used sig tracking |
| Challenge list shown | 50 max | arena.js:256 | non-expired only |
| Challenge history | 20 max | tournament.js:155 | completed tournaments |
| Wallet DB export limit | no limit | wallet.js:168-174 | admin only |
| Wallet DB query (admin) | 1-500 per page | wallet.js:201 | limit param capped |
| Feed items shown | 100 max | discovery.js:79 | per request |
| Feed items stored | 200 max | discovery.js:307 | in memory |
| Challenge TX list | 200 max | arena.js:46, 109 | per wallet history |
| Prism TX list stored | 500 max | buy.js:187, earn.js:297 | per wallet |
| Prism TX list query | 100 max | userData.js:155 | per request |
| Quest valid IDs | 20 total | quest.js:23-28 | hardcoded list |
| Streak max | 5 days | quest.js:81 | for weekly_streak quest |
| Scan cooldown (clean) | 60000 ms | earn.js:223 | per wallet+target |
| Scan reward amount | `.err (transaction succeeded)
- Wallet must be in transaction's account keys
- Jupiter program ID must be in transaction's account keys
- Token balance before: amount > 0 for (account, mint)
- Token balance after: amount = 0 for (account, mint)
- Swap signature required in payload

**Commission verification:**
- If wallet !== treasury: Calculate closed account lamports sum
- Required commission = `Math.round(closedLamports * commissionRate)`
- Check all top-level `transfer` instructions in transaction
- Sum lamports from address → treasuryAddress
- Must be ≥ required commission

**Observable QA cases:**
- Submit operation without mint → 400 "Invalid Black Hole operation"
- Submit close without owner signature → verification fails → 400 "Close transaction verification failed"
- Burn without burn instruction → verification fails → 400 "Burn transaction verification failed"
- Swap but token not fully disposed (postAmount > 0) → verification fails → 400 "Swap transaction verification failed"
- Commission shortfall (50 lamports needed, 40 sent) → verification fails → 400 "Black Hole commission verification failed"
- NFT swap: preAmount=1, postAmount=0, decimals=0 → classified as NFT → nftResolved += 1
- Fungible swap: preAmount=1000, decimals=6 → classified as fungible → fungibleResolved += 1

---

## **DUPLICATE SUBMISSION PROTECTION**

**Multi-layer replay guards:**

1. **In-memory cache (fast path):** `blackHoleUsedSignatures` Map
   - Checked before RPC calls (line 91)
   - Set after durable insert succeeds (line 166)
   - DeletedscanWalletReward` | earn.js:227 | fixed value |
| Sybil hunt reward curve | dynamic | earn.js:232 | based on count+1 |
| Enhanced tx limit | 1000 | discovery.js:98 | tx history fetch |
| Enhanced tx cache TTL | 600000 ms | discovery.js:90 | 10 minutes |
| Enhanced tx rate limit | 30000 ms | discovery.js:88 | per address per IP |
| Reputation API key check | per-request | reputation.js:46 | via middleware |
| Constellation viewer daily bonus | 10 max | discovery.js:244 | stat increments |
| Auth challenge 3s minimum | 3000 ms | auth.js:25 | between challenges |
| Auth token 5s cooldown | 5000 ms | auth.js:48 | per IP |
| Admin rate limit | 20-30/60s | admin.js:24-30 | varies by endpoint |
| Sybil analysis (new) RL | 5/60s | sybil.js:74 | per IP (with dedup) |
| Sybil batch RL | 15 seconds | sybil.js:97 | per IP cooldown |
| Sybil graph RL | 6000 ms | sybil.js:183 | per IP |
| Sybil funding sources RL | 3/30s | sybil.js:216 | per IP (fresh fetch) |
| Sybil cluster RL | 3/30s | sybil.js:245 | per IP |

---

## **PART 4: E2E MOBILE WALLET CONSIDERATIONS**

### **Real-Phone Solana Seeker / Mobile Wallet Approval Flows**

#### **W1 (Primary Wallet) / W2 (Secondary Dev Mode)**
- JWT auth via challenge-response ties to single `address` at registration time
- **Cross-wallet flow:** Dev mode may test W1 and W2 in same on error cleanup (releaseLock at line 168)

2. **SQLite durable record:** `black_hole_signatures` table
   - Insert-or-ignore at line 159
   - Returns false if insert changes=0 (already exists)
   - Persists across restarts

3. **7-day in-memory cleanup:** Lines 23-27
   - Removes signatures >7 days old from memory
   - But SQLite record remains (permanent block)

**QA test sequence:**
- Submit signature A → insert succeeds → cached in memory + DB
- Submit signature A again (within process lifetime) → in-memory check blocks → 400
- Restart server, submit signature A again → in-memory empty, but DB check blocks → 400
- Wait 7+ days, check memory cleanup → signature A removed from memory, but still in DB
- Submit signature A after 7 days → in-memory check passes, but DB insert fails → 400

**Critical:** Signatures are **permanently blocked** even after 7-day TTL (only in-memory cleanup happens, DB persists)

---

## **GAME & ACHIEVEMENT SYSTEMS**

**Game session proofs:** `initOrchestrator.js:86-92`
- Loaded from `gameSessionProofStore` or JSON fallback
- Normalized via `normalizeStoredGameSessionEntry()`
- Pruned on startup (removes old entries)

**Achievements:** `loaders.js:51-87`
- Loaded as `{ unlocked: Set, claimed: Set }`
- Each address has independent achievement state
- QA: Award achievement → add to `unlocked` set. Claim → add to `claimed` set

**Revives:** `loaders.js:90-118`
- Loaded per session; each needs separate JWT tokens
- **Challenge reuse:** Nonce is one-time use; second wallet must request fresh challenge (**auth.js:35, 98**)
- **Signature mismatch handling:** If W1 signs W2's challenge, `address mismatch` error on token claim (**auth.js:65-67**)

#### **Mobile Wallet Integration Points**
1. **Auth Challenge:** App displays message, wallet signs, signature returned
   - Message format strict: `"Identity Prism auth\nAddress: {address}\nNonce: {nonce}"` (**auth.js:34**)
   - Reconstruct fallback if stored message differs (**auth.js:80-84**)
   - **E2E Risk:** Custom wallet implementations may format differently → signature verify fails

2. **Transaction Approval (Buy, Spend, Stake)**
   - Buy SOL: System program transfer validation (**buy.js:122-128**)
   - Buy SKR: Token transfer with transferChecked validation (**buy.js:285-302**)
   - **Mobile Risk:** Approval UI may not show exact lamports; tolerance at 99% (**buy.js:125**)
   - **SKR Slippage:** 95% minimum accepted (**buy.js:298-299**)

3. **NFT Minting (Blinks)**
   - Requires keypair signer (treasury or collection authority)
   - **E2E Risk:** Keypair file persistence, secret management on dev device
   - Custom card image generation → metadata upload → collection creation
   - **Mobile Risk:** File I/O permissions, image scaling on low-bandwidth

4. **Session Proof Registration**
   - Game sessions must be registered pre-earn or pre-tournament
   - MagicBlock seed validation happens server-side (**game.js:199, 290 wallet
- Free revives per day (holder: 3, non-holder: 0)
- Premium revives available (coin cost)

**Observable QA behavior:**
- Unlock achievement for wallet → appears in `achievements[address].unlocked`
- Claim achievement for 10 coins → cost deducted, achievement in `claimed` set, `achievementCount` increments
- Revive holder (3 free/day) → 1st-3rd free, 4th requires coins
- Revive non-holder → all require coins

---

## **GAME COIN BOOST & NORMALIZATION**

**Holder multiplier logic:** `identityPerks.js:24-39`
- **Game coin normalization for cap:** Requested delta / multiplier = normalized
  - If holder earned 100 coins from game (nominal 50 base) → normalized = 100 / 2 = 50 for cap purposes
- **Applied delta scaling:** If cap allows 40 normalized, scale back to actual delta
  - `appliedActual = requestedDelta * (appliedNormalized / normalizedRequested)`
  - E.g., 100 nominal, 50 normalized, cap allows 40 → applied = 100 * (40 / 50) = 80 actual

**QA cases:**
- Holder earns 100 coins from game → normalized for cap = 50
- Non-game daily cap = 100 → can still earn (50 < 100)
- Holder earns another 120 coins → normalized = 60 → total normalized = 110 > 100 → both capped
  - First 100 applied, second capped at (100-50) = 50 actual coins
- Non-holder earns 100 coins → normalized = 100 (no multiplier)
- Daily cap = 100 → can't earn (100 = 100, at**)
   - **Mobile Risk:** Seed transmission security; slot staleness (**E2E should verify recent slot**)

#### **Two-Wallet Dev Mode (W1 + W2)**
- **Address Mismatch Checks:** Present in earn, spend, vault, leaderboard POST endpoints
  - Reject if bodyAddress ≠ jwtAuth.address (**earn.js:67, spend.js:42, userData.js:77**)
- **Concurrent Locks:**
  - pendingStakingOps per address: W1 and W2 can stake simultaneously (**vault.js:37-38**)
  - pendingEarnRequests per address: quest claims don't block between wallets (**earn.js:121-125**)
  - Challenge accept lock per challengeId (not address): shared lock if both try to accept same challenge (**arena.js:293-294**)
- **Daily Caps Per Wallet:**
  - Each address has separate `nongame_daily:${address}` entry (**earn.js:254**)
  - Each address has separate `quiz:${address}:${date}` counter (**quiz.js:66**)
  - Each address has separate `blackhole_cleanup:${address}:${date}` counter (**userData.js:134**)
- **Race Condition Risk:**
  - If W1 + W2 join same tournament, order matters (entry fee deducted asynchronously)
  - If W1 + W2 try to claim same quest, server snapshot is fetched once; claim logic retries but may have stale state

#### **Sybil Scan on Mobile**
- Optional JWT; non-authenticated scans show cached or graph-only verdict
- **E2E Mobile Risk:** First-run scan takes 5+ seconds; in-flight dedup prevents repeat calls but user sees 429 if retried (**sybil.js boundary)

---

## **QUIZ & ANSWER VALIDATION**

**Quiz answer storage:** `scheduler.js:66-71`
- Stored in `quizAnswers` Map with `expiresAt` timestamp
- Cleanup interval: 5 minutes
- Expired entries auto-deleted on cleanup

**Quiz reward cap:** `economyRules.js:24-30`
- Can award reward if:
  - `dailyCount < maxDailyAnswers` (today's count < max)
  - AND `ngEarned + reward <= nonGameCap` (total non-game earn + reward ≤ cap)
- If either fails → reward rejected

**Observable QA behavior:**
- Submit quiz answer, get reward → answer stored with expiry, reward awarded
- Answer expires > 5 min → auto-deleted, no longer claimable
- Daily answer limit = 5, user submits 6th → reward rejected
- Non-game cap = 100, earned = 80, quiz reward = 30 → rejected (80+30 > 100)
- Non-game cap = 100, earned = 70, quiz reward = 30 → accepted (70+30 = 100)

---

## **WALLET MINT TRACKING**

**Minting system:** `initOrchestrator.js:111-120` + `walletBackfill.js:37-40`
- Tracked in `mintedAddresses` Set
- Wallet entry includes: `{ minted: bool, mintedAt: timestamp, assetId, txSignature, metadataUri, remints, lastRemintAt }`
- Backfilled from DAS lookup during async init

**Observable QA behavior:**
- Mint NFT → address added to `mintedAddresses`, wallet.mint updated
- Query wallet → mint status visible in composite score calculations
- Holder check: `mintedAddresses.has(address)` → true for minted wallets
- Holder perks applied (2x coin multiplier, free revives, 2% commission)

---

## **SYBIL VERDICT DERIVATION THRESHOLDS**

**Verdict determination logic:** `sybilVerdict.js:152-228`

**Confirmed Sybil (strongest):**
- `graph_intelligence` signal present, OR
- `strongNetworkCount >= 2`, OR
- (`strongNetworkCount >= 1` AND `siblingCount >= 5`), OR
- (`fundingChainDepth >= 2` AND `supportingNetworkCount >= 1`)
- Additionally: `legacySybilFlag` (trustScore < 50)

**Probable Sybil:**
- Network confirmed but not all criteria met, OR
- Multiple strong behavior signals (strongBehaviorCount >= 2)

**Cluster Linked:**
- `siblingCount >= 2`, OR
- `supportingNetworkCount >= 1`, OR
- `fundingChainDepth >= 1`, OR
- `topFunderTxCount >= 3`, OR
- `topFunderPct >= 40%`

**Suspicious:**
- Behavioral signals without network confirmation
- At least 1 medium-weight behavior signal

**Unknown:**
- `txCount = 0` (no transaction history)

**Clean (default):**
- All other cases

**Observable QA behavior:**
- Wallet: 1 tx, no signals → "unknown"
- Wallet: 100 txs, no signals → "clean"
- Wallet: 100 txs, 1 graph_intelligence signal → "probable_sybil" or higher
- Wallet: trustScore 40 < 50 → legacySybilFlag → "probable_sybil" minimum
- Wallet: 3 siblings + supportingNetworkCount 1 → "cluster_linked"

---

## **SYBIL SIGNAL WEIGHTS & CATEGORIES**

**Signal categories:74-75**)
- **Own-wallet vs stranger:** Cache TTL differs; own wallet cached shorter (**sybil.js:61**)

#### **Constellation Visualization**
- Requires TX fetch; 10-second cooldown per address (**discovery.js:133-137**)
- Nodes capped at 200 for performance (**discovery.js:232**)
- **E2E Mobile Risk:** Large TX history (>1000) may timeout RPC calls; no pagination support

#### **Quiz on Mobile**
- **Tight rate limits:** 10/5s for question, 10/3s for answer
- **E2E Mobile Risk:** Slow network → 429 before user can read question
- Questions expire in 60s; clock skew between client/server matters (**quiz.js:39**)

#### **Metadata Upload (Avatar, Loadout)**
- Max 512 KB payload (**userData.js:189**)
- Asset upload: base64 images stored in assetsDir (**metadata.js:77**)
- **E2E Mobile Risk:** Image encoding on mobile may exceed size; no streaming support

---

## **PART 5: QA TEST CASES — ORGANIZED BY MODULE**

### **AUTH**
- ✅ Valid challenge: nonce generated, message formatted correctly
- ✅ Challenge expiry: nonce discarded after TTL, sig fails after
- ✅ Signature verification: valid signature → JWT issued
- ✅ Invalid signature: rejected with 401, nonce still deleted
- ✅ Nonce reuse: second sig with same nonce fails (already deleted)
- ✅ Address mismatch: challenge for W1, signed by W2 → 401
- ✅ Challenge 3s min: two challenges <3s apart → 429 on 2nd
- ✅ Token 5s cooldown: two token reqs <5s apart → 429 on 2nd
- ✅ JWT parsing: invalid token format → 401

### **ECONOMY / EARN**
- ✅ Game coin: earn within cap, then capped
- ✅ Game coin holder boost: non-holder gets 50% daily cap
- ✅ Staking boost: applied after daily cap (multiplicative)
- ✅ Quest complete claim: one per period, sticky on period change
- ✅ Text quest: unique claim, completion tracked
- ✅ Challenge win earn: only recent completed challenges (10min window) (**earn.js:181**)
- ✅ Scan cooldown: 60s per wallet+target before re-claim
- ✅ Sybil hunt: once per target, reward scales with count+1
- ✅ Per-source cooldown: enforced per source (**earn.js:80**)
- ✅ Global 2s earn cooldown: enforced per wallet (**earn.js:84-89**)
- ✅ Max per call: respects `prismEarnMaxPerCall[source]`
- ✅ Address mismatch: bodyAddress ≠ jwt.address → 403 (**earn.js:67**)
- ✅ Quest lock race: concurrent quest claims prevented (**earn.js:121-125**)
- ✅ Earn lock race: concurrent challenge_win earn prevented (**earn.js:174-194**)

### **GAME**
- ✅ Session creation: valid payload → session ID + verified flag
- ✅ Session seed validation: MagicBlock check validates seed↔slot (**game.js:199**)
- ✅ Score tolerance: ±5s orbit, destroyer <=duration×100, gravity <=duration×10 (**game.js:186-200**)
- ✅ Session reuse: can't use twice for competitive (leaderboard/tournament/challenge) (**game.js:210*:** network vs. behavioral

**Network signals:** (from `sybilVerdict.js:166-168`)
- graph_intelligence: weight ≥ 12 or severity=danger → strong (counts toward confirmed)
- hub_spoke, funding_chain, cluster_similarity, temporal_cohort, repeated_funder, concentrated_funding: supporting

**Behavior signals:** (from `sybilVerdict.js:170-175`)
- Danger severity or weight ≥ 12 → strong
- Weight ≥ 8 → supporting (for probable/suspicious thresholds)
- LOW_CONTEXT_SIGNAL_IDs (no_history, wallet_age, low_token_diversity, no_nft_holdings) → excluded from suspicious unless weight ≥ 10

**Observable QA behavior:**
- Signal weight = 15, category=network → counts as strong network signal
- Signal weight = 5, category=behavior → ignored (< 8 threshold)
- 3 supporting behavior signals (weight 8 each) → probable_sybil consideration
- no_history signal in suspicious verdict → excluded (low context)

---

## **FINAL COMPREHENSIVE QA CHECKLIST**

### **AUTH & SESSION**
- [ ] JWT expires after 24h → 401
- [ ] Token version increment → all tokens invalid
- [ ] 51st unique IP → oldest IP dropped
- [ ] Missing auth header → 401
- [ ] Invalid JWT signature → 401

### **RATE LIMITING**
- [ ] Free tier: 100 daily → 101st request: 429
- [ ] Free tier: 10 per minute → 11th request: 429
- [ ] Pro tier: 10,000 daily → 10,001st: 429
- [ ] Enterprise tier: unlimited daily, 1*)
- ✅ Session eviction: LRU when cache full, non-competitive evicted first (**game.js:245-257**)
- ✅ Session coins: require gameSessionId, verify wallet match (**game.js:364-367**)
- ✅ Daily game cap: enforced per holder status (**game.js:392-396**)
- ✅ Coins per session: max delta per mode enforced (**game.js:383-385**)
- ✅ Staking boost: applied after cap (**game.js:407-408**)
- ✅ Max score validation: orbit=600, gravity=600, destroyer=9999 (**game.js:465**)
- ✅ Achievement unlock: on-chain verification required for certain unlocks (**game.js:138**)
- ✅ Revive limit: `freeRevivesPerDay` per mode enforced (**game.js:140**)

### **SYBIL SCAN**
- ✅ New analysis RL: 5/60s per IP with dedup (**sybil.js:74-79**)
- ✅ In-flight dedup: shared promise prevents concurrent duplicate (**sybil.js:65-79**)
- ✅ Cache hit: returns cached analysis if <1hr old (**sybil.js:61**)
- ✅ Batch limit: max 20 addresses (**sybil.js:105**)
- ✅ Batch RL: 15s cooldown per IP (**sybil.js:97**)
- ✅ Graph lookup: returns safe subset (no full siblings) (**sybil.js:188-197**)
- ✅ Funding sources: top 20, cached 1hr (**sybil.js:220-236**)
- ✅ Cluster detection: sibling count+confidence calc (**sybil.js:284-289**)
- ✅ Verdict mapping: unknown/clean/suspicious/cluster_linked/probable_sybil/confirmed_sybil (**sybil.js:154**)

### **ARENA / CHALLENGES**
- ✅ Challenge create: stake deducted, balance checked, challenge created (**arena.js:91-152**)
- ✅ Challenge expire: expired challenges removed from list (**arena.js:254**)
- ✅ Challenge accept000 per minute
- [ ] Revoked key → 401
- [ ] Daily quota resets at UTC midnight
- [ ] Rate limit cache: >5000 entries → LRU evict oldest
- [ ] Expired rate limit → auto-deleted on access

### **BLACK HOLE**
- [ ] Submit same signature twice → 2nd: 400 "already claimed"
- [ ] 65 operations in request → 400
- [ ] Missing swapSignature for swap action → 400
- [ ] Close operation verification fails → 400
- [ ] Commission shortfall → 400
- [ ] 5 fungibles + 10 NFTs + 100 milli-SOL → reward = min(500, 40+150+80) = 270
- [ ] Holder daily cap = base; non-holder = base/2
- [ ] Daily earned + claimed = cap → next claim = 0
- [ ] Restart server, resubmit signature → 400 (SQLite guard)
- [ ] NFT: decimals=0, amount=1 → nftResolved += 1
- [ ] Fungible: decimals>0 OR amount>1 → fungibleResolved += 1

### **ECONOMY**
- [ ] Game coin: holder 2x multiplier applied
- [ ] Non-holder: 1x multiplier (no boost)
- [ ] Quiz reward: dailyCount ≥ maxDailyAnswers → rejected
- [ ] Quiz reward: ngEarned + reward > cap → rejected
- [ ] Staking: 50k for 90-day lock → daily yield = (50k * 0.20%) * 2.5
- [ ] Early withdrawal 30-day lock: -15% penalty
- [ ] Unclaimed yield >90 days → capped at 90 days

### **COMPOSITE SCORING**
- [ ] On-chain score: 0-400
- [ ] Composite score: 0-1000 (hard cap)
- [ ] Sybil clean verdict: trustScore floor=0, ceil=100: score challenges auto-complete, game challenges wait (**arena.js:329-397**)
- ✅ Challenge score submit: game challenges only, validates session proof (**arena.js:458-493**)
- ✅ Challenge race: pendingSubmits prevents double-submit (**arena.js:496-501**)
- ✅ Prize calculation: (stake×2)×0.95 winner, 5% burned (**arena.js:344, 530**)
- ✅ Leaderboard weekly: min 3 games to rank (**arena.js:209**)
- ✅ Score limits: orbit=600, destroyer=9999, gravity=600 (**arena.js:465**)

### **BLACKHOLE**
- ✅ Claim endpoint: delegates to orchestrator (**blackhole.js:28**)
- ✅ Daily cap: `dailyBlackHoleCleanupCap` enforced (**userData.js:144**)

### **FORGE / SHOP**
- ✅ Spend validation: amount 1-1M coins (**spend.js:46**)
- ✅ Forge module: exact price match, no duplicates (**spend.js:55-60**)
- ✅ Forge item: rank check, unlock check (**spend.js:70-76**)
- ✅ Burn fee: 2% deducted from spend (**spend.js:92**)
- ✅ Spend race: pendingSpendRequests prevents concurrent (**spend.js:80-83**)

### **VAULT / STAKING**
- ✅ Stake create: min/max per tier, 500k wallet cap (**vault.js:45-69**)
- ✅ Stake claim: yield calculated, balance updated (**vault.js:81-110**)
- ✅ Stake unstake early: penalty applied, burned (**vault.js:128-155**)
- ✅ Stake status: yields, time left, effective rate (**vault.js:157-189**)
- ✅ Pending ops lock: prevents concurrent operations (**vault.js:37-38, 86-87, 118-119**)

### **QUESTS**
- ✅ Quest sync: server snapshot reconciled with client (**quest.js:31-100**)
- ✅ Streak logic: 5 daily complete → streak +1, else reset (**quest.js:64-84**)
- ✅ Period claim sticky: claimed flag persists until period resets (**quest.js:50-52**)
- ✅ Valid quest IDs: 20 total hardcoded (**quest.js:23-28**)

### **QUIZ**
- ✅ Question rate limit: 10/5s per IP (**quiz.js:36**)
- ✅ Question TTL: expires in 60s (**quiz.js:39**)
- ✅ Answer rate limit: 10/3s per JWT wallet (**quiz.js:46**)
- ✅ Correct reward: respects daily cap + nongame overlap (**quiz.js:64-85**), recovery cap=25
- [ ] Sybil confirmed_sybil: trustScore floor=0, ceil=20, recovery cap=0
- [ ] Holder bonus recovery: +25 max (clean verdict), +0 (confirmed_sybil)
- [ ] Tier: 0-99=mercury, 950+=binary_sun
- [ ] Badge eligibility: disabled for sybil verdicts (unknown, suspicious, cluster_linked, probable_sybil, confirmed_sybil)

### **SYBIL DETECTION**
- [ ] Wallet 0 txs → verdict=unknown
- [ ] Wallet 100 txs, graph_intelligence signal → verdict=confirmed_sybil or probable_sybil
- [ ] Wallet with 2+ siblings → verdict ≥ cluster_linked
- [ ] Scan signature pagination: 1,000 sigs/page, max 10 pages
- [ ] Louvain: edge lookback=90 days, min cluster size=3
- [ ] Sybil graph: max 10,000 nodes, node TTL=90 days
- [ ] Behavior drift (early vs. recent programs) Jaccard <0.1 → detected

### **RECOVERY & TRUST**
- [ ] Twitter verified, 3+ years, 500 followers, 1000+ tweets → 12 pts (capped)
- [ ] Activity: 3 game types + 15 achievements → 5 pts
- [ ] Total recovery: min(17, 25 cap) = 17 pts boost
- [ ] Twitter suspended → 0 bonus (no verification)

### **QUESTS & TOURNAMENTS**
- [ ] Weekly arena: min 3 games to rank
- [ ] Weekly winner multiplier: 2x stake
- [ ] Weekly tax: 5% (0.95x multiplier)
- [ ] Top 10 ranked on Monday (UTC) → rewards distributed once (guard prevents repeat)
- [ ] Quiz answer expires >5 min → auto-deleted
- [ ] Quiz daily limit exceeded → subsequent quiz rejected

### **PERSISTENCE & CONSISTENCY**
- [ ] Wallet updated → SQL + JSON (debounced 500ms)
- [ ] Process crash → WAL ensures SQL atomic, JSON may lag up to 500ms
- [ ] Firestore unavailable → JSON persists (async failure not retried)
- [ ] Firestore batch >500 wallets → chunked 450-op per batch
- [ ] SQL migration: JSON → SQL if SQL is empty
- [ ] Load order: SQL > JSON fallback

### **NOTIFICATIONS & FEED**
- [ ] Black Hole claim triggers feed item → added to `feedItems` array
- [ ] Feed items max 200 → oldest dropped on overflow
- [ ] Prism transaction max 500 per wallet → oldest dropped
- [ ] Notification added → synced to SQL/JSON on debounce

### **DATA BOUNDARIES & RESETS**
- [ ] API key daily quota: reset UTC midnight (YYYY-MM-DD)
- [ ] Black Hole daily cap: reset UTC midnight per address
- [ ] Non-game daily cap: reset UTC midnight (stored with date field)
- [ ] Weekly arena: triggered Monday (UTC day 1), guard prevents duplicate
- [ ] Sybil analysis TTL: `ttl_expires_at` field checked on use
- [ ] Black Hole signature: 7-day in-memory TTL, SQLite permanent
- [ ] Rate limit entry: TTL-based, default 86,400s (1 day)

### **HELIUS & ENHANCED TX**
- [ ] Enhanced tx cache: 10-min TTL, max 200 entries
- [ ] Fetch address in cache within TTL → cached### **LEADERBOARD**
- ✅ Submit entry: requires verified session, score ±5 match (**leaderboard.js:59-62**)
- ✅ Session reuse: can't submit leaderboard twice with same session (**leaderboard.js:66, 76**)
- ✅ Game type result
- [ ] Fetch 201st unique address → evict oldest cached
- [ ] Rapid cycling: +0.01 in 60s, -0.8x to 1.2x out → flagged
- [ ] Behavior drift: Jaccard <0.1 (early vs. recent programs) → flagged

### **REPLAY PROTECTION**
- [ ] In-memory guard: fast path within process lifetime
- [ ] SQLite guard: durable across restarts
- [ ] Error recovery: in-memory cleared (releaseLock), SQLite persists
- [ ] Test: submit → accept. Restart → resubmit → 400 (SQLite blocks)

---

## **CROSS-MODULE DATA FLOW RISKS**

| Risk | Module 1 | Module 2 | Mitigation | QA Case |
|------|----------|----------|-----------|---------|
| Coin balance + wallet entry inconsistency | Economy | Wallet DB | Both updated in same call | Update coins → both SQL updated immediately |
| Daily cap key mismatch (TZ) | Economy | Date tracking | UTC date string enforced | Submit 23:59 UTC, then 00:01 UTC → different cap applies |
| Sybil verdict validation: session.gameMode must match (**leaderboard.js:65**)
- ✅ Max score: enforced per game type (**leaderboard.js:68**)
- ✅ Cache: 10s per game type filter (**leaderboard.js:27**)
- ✅ Top 50: capped in response (**leaderboard.js:35, 82**)

### **COMPOSITE SCORE**
- ✅ Tier calculation: server-enforced, not client-settable (**userData.js:81-82**)
- ✅ Tier thresholds:** binary_sun ≥800, pulsar ≥600, neutron_star ≥400, dwarf_star ≥200, mercury <200 (**userData.js:81**)
- ✅ Update trigger: on challenge/quest completion (**userData.js:98**)
- ✅ History tracking: scores array maintained (**userData.js:99**)

### **RECOVERY (Migration)**
- ✅ Status check: auth wallet must match queried address (**utility.js:38**)
- ✅ One-time claim: result deleted after retrieval (**utility.js:47**)

### **NOTIFICATIONS**
- ✅ Unread count: public endpoint, no auth (**notifications.js:88-97**)
- ✅ Read operation: bulk via ids array or all (**notifications.js:31-59**)
- ✅ Delete operation: bulk via ids array or all (**notifications.js:62-86**)
- ✅ Push trigger: quest_milestone, challenge_win, challenge_loss on respective events (**earn.js:316, arena.js:350-366**)

### **RATE LIMITS (Global)**
- ✅ IP-based limits: enforced via getClientIp + ipRateLimit() (**core:ipRateLimit**)
- ✅ Wallet-based limits: earn, spend, vault per address (**earn.js:78-90, spend.js:28-29, vault.js:37-38**)
- ✅ Custom cool## **CROSS-MODULE DATA FLOW RISKS (CONTINUED)**

| Risk | Module 1 | Module 2 | Mitigation | QA Case |
|------|----------|----------|-----------|---------|
| Sybil verdict stale on composite score | Sybil Scan | Composite Score | Caller checks `ttl_expires_at` | Query reputation before TTL → uses fresh verdict |
| Black Hole cap exceeded | Black Hole | Economy | Min(earned, remaining cap) applied | Claim 600 PRISM, cap=500 → credited downs: auth (3s, 5s), quiz (5s, 3s), sybil (6s, 10s, 15s, 30s) (**specific endpoints**)
- ✅ Rate limit cleanup: periodically evicts old entries (**earn.js:91-93, rateLimitStore.cleanup()**)

### **WALLET DATA & DATABASE**
- ✅ User data get: returns sanitized loadout, prevents progression leaks (**userData.js:170**)
- ✅ User data post: whitelist enforces, client can't set score/tier/badges (**userData.js:201-225**)
- ✅ Wallet database get: public returns limited fields; admin returns full (**wallet.js:178-214**)
- ✅ Wallet export: admin only, full DB dump (**wallet.js:165-176**)
- ✅ Wallet stats: admin only, aggregated metrics (**wallet.js:132-163**)

### **TOKEN/NFT HOLDINGS**
- ✅ Tokens endpoint: top 30, sorted by amount (**wallet.js:22-66**)
- ✅ Recent txs: last 15, categorized by program (**wallet.js:68-130**)
- ✅ TX type classification: transfer, swap, nft_trade, lending, staking, contract (**wallet.js:107-113**)
- ✅ Balance change calc: per-account lamport delta / 1e9 (**wallet.js:102**)

### **BUY (SOL & SKR)**
- ✅ Buy status: daily limit and remaining shown (**buy.js:64-78**)
- ✅ Buy SOL: validates transfer to treasury at 99%+ of expected (**buy.js:122-132**)
- ✅ Buy SKR: validates transferChecked with mint verification (**buy.js:285-306**)
- ✅ Daily limit enforcement: per address per day (**buy.js:94-98, 143500 |
| Token revocation not atomic | Auth | Session | In-memory check on every request | Increment tokenVersion → next request rejected ✓ |
| Firestore batch write fails mid-batch | Persistence | Firestore | No retry, async fire-and-forget | FB unavailable → JSON persists, FB out of sync |
| Holder status check race | Black Hole | Minted Addresses | Checked once per claim at start | Mint NFT, then claim → holder perks applied |
| Game coin cap with multiplier | Games | Holder Perks | Normalize before cap, scale on apply | Holder earn 100 → normalized 50 → capped 40 → scaled back 80 |
| Weekly rewards guard double-trigger | Scheduler | Challenges | globalThis._lastWeeklyRewardAt guard | Monday 12:00 UTC → already triggered, no repeat |
| Achievement claimed twice | Achievements | Economy | Set-based tracking (claimed set) | Claim → added to `claimed` set, can't re-claim |
| Rate limit concurrent increments | API Key | SQLite | ON CONFLICT DO UPDATE SET count = count + 1 | 2 parallel requests → both increment (atomic in DB) |
| Wallet IP tracking overflow | Auth | Session | Cap 50 IPs per wallet, shift oldest | 51st IP → 1st IP dropped |

---

## **ACTIONABLE QA TEST CASES BY FEATURE**

### **BLACK HOLE CLEANUP (PRIORITY HIGH)**
1. **Replay protection triple-layer-145**)
- ✅ TX already used: rejected with 400 (**buy.js:102**)
- ✅ TX pending: rejected with 429 (**buy.js:101**)
- ✅ TX cleanup: 48h window, stale entries removed (**buy.js:50-62**)

### **METADATA & ASSETS**
- ✅ Asset upload: base64 → file store → URL returned (**metadata.js:26-89**)
- ✅ Asset types: png, jpg, webp, gif (**metadata.js:62-69**)
- ✅ Metadata POST: JSON object → file → URI returned (**metadata.js:114-162**)
- ✅ Metadata GET: serves JSON with content-type (**metadata.js:165-181**)
- ✅ File resolution: security check via resolveAssetFile/resolveMetadataFile (**metadata.js:71, 145**)

### **DISCOVERY (Leaderboard, Feed, Enhanced Tx, Constellation)**
- ✅ Global leaderboard: ranked by coins+score (**discovery.js:36-75**)
- ✅ Feed: activity stream, capped at 200 items (**discovery.js:77-82**)
- ✅ Enhanced tx: DeFi classification (swap, nft_trade, staking, etc.) (**discovery.js:84-114**)
- ✅ Constellation: social graph, capped at 200 nodes (**discovery.js:116-258**)
- ✅ Constellation rate limit: 10s per address + 10s per IP (**discovery.js:121, 133-137**)
- ✅ Constellation viewer stat: tracks explorer count (max 10/day) (**discovery.js:240-251**)

### **MARKET (Collection Stats, Pricing)**
- ✅ Collection stats: ME → Tensor → token price fallback (**market.js:50-100**)
- ✅ Candidate matching: symbol, ID, name, mint tried in order (**market.js:62-89**)**
   - Submit valid BH claim → accepted
   - Submit same signature immediately → 400 "already claimed" (in-memory guard)
   - Restart server, resubmit → 400 (SQLite guard persists)
   - Wait 7+ days, check memory cleanup → signature still blocked by DB

2. **Reward formula edge cases**
   - 1 fungible + 0 NFTs + 0 SOL → 8 PRISM
   - 0 fungible + 1 NFT + 0 SOL → 15 PRISM
   - 0 fungible + 0 NFT + 1 SOL → 8 PRISM
   - 64 fungibles (max) → 64 * 8 = 512 PRISM → capped 500
   - 1 fungible + 1 NFT + 1 SOL → 8 + 15 + 8 = 31 PRISM

3. **Daily cap enforcement**
   - Holder: cap = base cap
   - Non-holder: cap = base cap / 2
   - Claim 1: earned 300 → remaining 200 (base=500)
   - Claim 2: request 300 → capped to 200
   - Claim 3: request 100 → rejected (0 remaining)
   - Next day (UTC reset): claim 100 → accepted (new cap applies)

4. **Commission verification**
   - Standard holder (10%): claim requires 10% commission
   - Identity holder (2%): claim requires 2% commission
   - Shortfall: 100 lamports needed, 99 sent → 400 "commission verification failed"
   - Treasury address = wallet → bypass commission check (line 156)

5. **Operation deduplication**
   - Submit [op1, op1, op2] → deduped to [op1, op2]
   - Same sig, same action, same account/mint → dedupe key prevents duplicate reward

6. **NFT vs. Fungible classification**
   - Token decimals=0, amount=1 → NFT →

### **UTILITY (Migration, Scam Check)**
- ✅ Migration status: auth wallet match enforced (**utility.js:38**)
- ✅ Scam check: known list + on-chain executable check (**utility.js:53-87**)
- ✅ Scam check rate limit: 10s cooldown per IP (**utility.js:56-58**)

### **REPUTATION/SYBIL BLINKS**
- ✅ Sybil actions endpoint: API key required (**reputation.js:46**)
- ✅ Blink payload: score/tier/risk formatted for card (**reputation.js:99-113**)
- ✅ CORS preflight: OPTIONS returns headers (**reputation.js:51-60**)

### **ADMIN**
- ✅ Admin key validation: timing-safe compare, 501 if unset (**admin.js:18-28**)
- ✅ Sybil feedback list: status filter + pagination (**admin.js:23-58**)
- ✅ Sybil feedback verify: boolean update only (**admin.js:60-98**)
- ✅ Sybil stats: 24h window metrics (**admin.js:101-179**)
- ✅ API key create: tier validation (free/pro/enterprise) (**admin.js:182-217**)
- ✅ API key revoke: one-time operation, already revoked → 404 (**admin.js:248-273**)
- ✅ Set coins: 0-1B range, valid address (**admin.js:275-296**)
- ✅ Set wallet: whitelist enforced, internal fields blocked (**admin.js:298-336**)

---

## **PART 6: CRITICAL RACE CONDITIONS & STATE TRANSITIONS**

### **High-Risk Race Conditions**

**1. Quest Claim + Earn Overlap (earn.js:115-159)**
- **Scenario:** User claims quest reward while simultaneously requesting earn from another source
- **Risk:** Both lock on address, but nftResolved += 1, reward 15
   - Token decimals=6, amount=1 → fungible → fungibleResolved += 1, reward 8
   - Token decimals=0, amount=2 → fungible (not 1:1) → fungibleResolved += 1, reward 8

### **SYBIL DETECTION & SCORING (PRIORITY HIGH)**
1. **Verdict determination flow**
   - Zero txs → "unknown" verdict
   - 100 txs, no signals → "clean" verdict
   - 100 txs + graph_intelligence signal → "confirmed_sybil" or "probable_sybil"
   - 100 txs + 2 supporting network signals (no graph_intelligence) → "cluster_linked" minimum
   - trustScore < 50 (legacy) → "probable_sybil" minimum

2. **Recovery bonus caps by verdict**
   - clean: +25 pts max → effectiveTrust = raw + 25 (clamped 0-100)
   - unknown: +10 pts max, floor 50, ceil 55
   - cluster_linked: +6 pts max, floor 35, ceil 50
   - confirmed_sybil: +0 pts, floor 0, ceil 20
   - Test: recovery bonus 50, clean verdict → applied 25 (capped). confirmed_sybil → applied 0 (capped)

3. **Badge eligibility by verdict**
   - clean: badges allowed ✓
   - confirmed_sybil: badges disabled ✗
   - Test: confirmed_sybil + 10 achievements → no achievementHunter badge

4. **Sybil graph risk scoring**
   - Flagged funder (risk ≥50) → +15 risk points
   - 2+ siblings flagged → +10 risk points
   - In flagged cluster → +20 risk points
   - Cap: 40 points max
   - Test: 2 flagged funders + 3 quest uses separate pendingQuestClaims set
- **Mitigation:** Quest claim lock per `${address}:${source}:${questId}`; earn lock per address
- **Test:** POST /api/prism/earn (quest_daily) + POST /api/prism/earn (quiz) concurrently → second should wait or fail gracefully

**2. Challenge Accept + Score Fetch (arena.js:329-395)**
- **Scenario:** Accept triggers composite score fetch; network lag causes timeout
- **Risk:** Coins deducted but scores not retrieved; challenge cancelled but refund may race with other operations
- **Mitigation:** Try-catch refunds on scoreError; pendingAccepts lock per challengeId
- **Test:** Accept challenge, simulate RPC failure → stakes refunded, status = cancelled

**3. Game Session Coin Credit + Daily Cap (game.js:362-432)**
- **Scenario:** Two requests credit coins from same session within milliseconds
- **Risk:** Dual credit exceeds session allowance or daily cap
- **Mitigation:** Session.coinsCredited updated atomically; daily cap checked before applying
- **Test:** Two rapid POST /api/game/coins (same session) → second should fail or return partial credit

**4. Stake Operations (vault.js:37-155)**
- **Scenario:** Claim + unstake concurrently
- **Risk:** Double-calculation of yield if not guarded
- **Mitigation:** pendingStakingOps.has(addr) blocks concurrent operations
- **Test:** POST /api/prism/vault/claim + POST /api/prism/vault/unstake concurrently → 429 on one

**5. Transaction Reuse (buy.js:101-103)**
- **Scenario:** Two requests submit same txSign siblings + in cluster → (15+15+10+20) capped 40

5. **Behavior drift detection**
   - Early programs (last 100 txs): Orca, Marinade, Serum (3 unique)
   - Recent programs (first 50 txs): Phantom swap only (1 unique)
   - Jaccard = 1 / (3+1-1) = 0.33 → no drift
   - Test: early 10 programs, recent 1 program → Jaccard <0.1 → drift detected

### **COMPOSITE SCORING & TIERS (PRIORITY HIGH)**
1. **On-chain score max**
   - SOL 10 → 40, Age 730d → 100, Txs 5000 → 80, NFTs 100 → 32, DeFi → 30, Badges → 68, Collection → 50
   - Total: 40+100+80+32+30+68+50 = 400 ✓

2. **Composite score max**
   - On-chain: 400
   - Sybil trust: 250
   - Human proof: 150
   - Social: 100
   - Engagement: 100
   - Total: 1000 (hard cap enforced at line 90)
   - Test: 400+250+150+100+100 = 1000 ✓

3. **Tier boundaries**
   - Score 0 → mercury
   - Score 100 → mars
   - Score 220 → venus
   - Score 350 → earth
   - Score 480 → neptune
   - Score 600 → uranus
   - Score 700 → saturn
   - Score 800 → jupiter
   - Score 880 → sun
   - Score 950 → binary_sun

4. **Game score component (logarithmic)**
   - gameScores = [10] → log2(1+10)*8 = log2(11)*8 = 3.46*8 ≈ 27 pts
   - gameScores = [50, 50, 50] → log2(1+150)*8 = log2(151)*8 = 7.24*8 ≈ 57 pts → capped 80

5. **Badge bonuses**
   - Sybil badges (verified_ature milliseconds apart
- **Risk:** Both validate against RPC, both think it's fresh
- **Mitigation:** pendingBuyRequests set blocks concurrent verification; usedBuyTxSignatures marked before validation completes
- **Test:** Two POST /api/prism/buy (same txSignature) → first succeeds, second gets 400 "already used"

**6. NFT Mint Double-Claim (blinks.js:83-84)**
- **Scenario:** Two mint requests for same address within seconds
- **Risk:** Pending mint tracking (`storePendingMint`/`consumePendingMint`) may not prevent this in high concurrency
- **Mitigation:** Relies on `storePendingMint()` to gate; test coverage needed
- **Test:** Rapid POST /api/nft/mint (same wallet) → second blocked or fails

**7. Tournament Entry + Join Close (tournament.js:81-111)**
- **Scenario:** Tournament closes while user joins
- **Risk:** Entry added after tournament.status = 'ended'
- **Mitigation:** checkTournaments() called at endpoint start; state checked before entry added
- **Test:** POST /api/tournament/join at tournament endTime boundary → may be added or rejected depending on timing

### **State Transitions & Assertions**

**Challenge State Machine (arena.js)**
```
create → open/playing
accept → (score: auto-complete) → completed OR (game: playing)
playing → (both scores) → completed
completed → (earnClaimed) → (eligible for earn via challenge_win source)
expired/cancelled → purged (>24h old)
```
- **Assertion:** Challenge can't accept if already accepted by someone else
- **Assertion:** Score can't resubhuman, cleanRecord, trustPillar): +10 each
   - Human badges (gameMaster, achievementHunter, highScorer): +10 each
   - Social badges (arenaChampion, topHunter, questMaster): +8 each
   - Engagement badges (questHunter, streakLord, explorer): +8 each
   - Max total: 30+30+24+24 = 108 (hard cap on each component prevents overflow)

### **RATE LIMITING & API (PRIORITY MEDIUM)**
1. **Tier quota enforcement**
   - Free: 100 daily, 10 per minute
   - Pro: 10,000 daily, 100 per minute
   - Enterprise: unlimited daily, 1000 per minute
   - Test: free tier 101st request → 429. Pro tier 100 per minute + 1 → 429

2. **Daily quota reset**
   - Reset at UTC midnight (YYYY-MM-DD)
   - Test: 23:59:59 UTC submit 100 requests (free) → used. 00:00:01 UTC submit 1 → accepted

3. **Per-minute window**
   - Rolling 60-second window
   - Test: 10 requests at t=0s → accepted. Request at t=1s → accepted. Request at t=60s → accepted. Request at t=59s → rejected

4. **Key revocation**
   - revoked_at set → subsequent requests → 401
   - Test: revoke key → existing JWT still valid (JWT doesn't check revoked_at). Next API call with key → 401

5. **Cache behavior**
   - Cache >5,000 entries → LRU evict oldest
   - Test: add 5,001 entries → oldest evicted

### **AUTHENTICATION & SESSION (PRIORITY MEDIUM)**
1. **JWT expiration**
   - TTL: 24 hours
   - Test: token issued atmit after first submission
- **Assertion:** Winner can't be null if both scores submitted and not equal

**Game Session State (game.js)**
```
register → (MagicBlock verify) → verified/unverified
verified → (use for earn) → coinsCredited updated
earn → (use for leaderboard) → usedForLeaderboard set
tournament → (usedForTournament) → set
challenge → (usedForChallenge) → set
```
- **Assertion:** Session can't be used for multiple competitive purposes
- **Assertion:** If session used for challenge, can't later be used for leaderboard

**Quest Progress (quest.js)**
```
incomplete → (daily complete) → completed
completed → (claim during period) → claimed
period resets → claimed flag sticky, progress reset
period keeps → claimed flag stays true
```
- **Assertion:** Can't claim same quest twice in same period
- **Assertion:** Period reset clears progress but not claimed flag if period changed

**Staking (vault.js)**
```
none → (stake) → staking
staking → (claim) → (yield credited, lastClaimTime updated)
staking → (unstake early) → (penalty applied, burned, balance restored)
staking → (unstake after lock) → (no penalty, full amount + yield)
```
- **Assertion:** Can't have concurrent stake/claim/unstake
- **Assertion:** Can't stake if already staking (must unstake first)

---

## **PART 7: ACTIONABLE QA CHECKLIST (PRIORITY-ORDERED)**

### **TIER 0: CRITICAL PATH (Security + Core Earn)**

- [ ] **Auth JWT**
  - [ ] Valid signature → JWT issued with correct address
  - [ ] Invalid signature → 401 "Invalid signature"
  - [ ] Nonce expiry → 401 "Challenge expired"
  - [ ] Address mismatch (W1 00:00 → still valid at 23:59. Request at 24:00:01 → 401 "expired"

2. **Token invalidation via tokenVersion**
   - Increment `tokenVersion` in wallet DB → all existing tokens invalid
   - Test: issue token A (v=0) → use successfully. Admin increments tokenVersion (v=1) → token A rejected. Issue new token (v=1) → accepted

3. **IP tracking per wallet**
   - Cap: 50 IPs per wallet
   - Test: login from 50 unique IPs → all tracked. Login from 51st IP → oldest IP dropped

4. **Auth header parsing**
   - Requires "Bearer " prefix
   - Test: "Authorization: Bearer xyz" → parsed. "Authorization: xyz" → missing token → 401

### **ECONOMY & COIN SYSTEM (PRIORITY MEDIUM)**
1. **Game coin multiplier**
   - Holder: 2x
   - Non-holder: 1x
   - Test: holder earn 50 coins from game → credited 100. Non-holder earn 50 → credited 50

2. **Daily non-game cap**
   - Holder cap = base
   - Non-holder cap = base / 2
   - Test: holder cap=100 → can earn 100 non-game. Non-holder cap=100 → can earn 50

3. **Quiz reward cap logic**
   - Can award if: dailyCount < maxDailyAnswers AND ngEarned + reward <= nonGameCap
   - Test: max=5, ngEarned=80, cap=100, reward=30 → (4 < 5) AND (80+30 <= 100) → accepted. 6th answer → rejected

4. **Staking yield calculation**
   - Bronze 10k/7d: daily = 10k * (0.75 * bracket rate)
   - Silver 30k/30d: daily = 30k * (1.0 * bracket rate) * 1.5 ( challenge, W2 signature) → 401 "Address mismatch"
  - [ ] Nonce reuse → 401 "Invalid or expired nonce" (nonce deleted)

- [ ] **Admin Key Security**
  - [ ] Valid X-Admin-Key → endpoints work
  - [ ] Invalid X-Admin-Key → 401 "Admin key invalid" or 501
  - [ ] Timing-safe compare verified (no timing leak)

- [ ] **Earn Core (Game + Quest + Scan)**
  - [ ] Game coin earn respects daily cap (non-holder = 50%)
  - [ ] Game coin earn respects per-session allowance
  - [ ] Quest daily claim (one per period) → sticky on period change
  - [ ] Quest weekly streak (5 consecutive days) → increments and resets correctly
  - [ ] Scan wallet earn (60s cooldown per target) → enforced
  - [ ] Sybil hunt earn (once per target, reward scales) → verified
  - [ ] Global 2s earn cooldown → enforced per wallet
  - [ ] Per-source cooldown → enforced per source table
  - [ ] Staking boost applied AFTER cap (multiplicative)

- [ ] **Daily Limits Aggregation**
  - [ ] GET /api/daily-limits shows correct earned/cap for game, hunt, scan, quiz, nonGame, blackHole
  - [ ] All earn sources count toward appropriate cap

- [ ] **Balance Integrity**
  - [ ] Coin balance == sum of earned - spent (spot check)
  - [ ] Buy (SOL): balance incremented by coins, daily limit incremented
  - [ ] Buy (SKR): same as SOL
  - [ ] Spend (forge): balance decremented, 2% burned
  - [ ] Challenge create: coins deducted immediately
  - [ ] Challenge settle: prize awarded to winner, 5% fee burned
  - [ ] Stake: balance reduced by amount, restored onlock mult)
   - Gold 75k/90d: daily = 75k * (1.25 * bracket rate) * 2.5 (lock mult)
   - Test: 50k silver (0.35% bracket, 1.5x lock) → daily = 50k * 0.0035 * 1.0 * 1.5 = 262.5

5. **Early withdrawal penalty**
   - 7d: -10%
   - 30d: -15%
   - 90d: -20%
   - 180d: -25%
   - Test: 100 coins locked 30d → early withdraw = 100 * (1 - 0.15) = 85

### **PERSISTENCE & DATA (PRIORITY MEDIUM)**
1. **Dual-store consistency**
   - Update → SQL + JSON (debounced)
   - Test: update wallet → query SQL (immediate). Query JSON (may be stale up to 500ms)

2. **JSON fallback**
   - SQL empty → load from JSON
   - Test: delete SQL rows, restart → JSON data loads ✓

3. **Migration**
   - migrateFromJson() only runs if SQL empty
   - Test: empty SQL, populated JSON → migrated. SQL already populated → migration skipped

4. **WAL mode atomicity**
   - Concurrent reads + writes supported
   - Test: read while write in progress → consistent snapshot

5. **Firestore batch chunking**
   - Max 500 ops per batch → chunk into 450 ops
   - Test: update 1,000 wallets → 3 batches (450+450+100)

### **QUESTS & TOURNAMENTS (PRIORITY LOW)**
1. **Weekly arena ranking**
   - Minimum 3 games to rank
   - Test: 2 games → not ranked. 3 games → ranked

2. **Weekly reward calculation**
   - Earned = stakeAmount * 2 * 0.95
   - Winner multiplier: 2x stake
   - Tax: 5% (0.95x)
   - Test: stake 100 coins, win → earned = 100 * 2 * unstake
  - [ ] Earn: balance increased by earned amount

### **TIER 1: CORE GAMEPLAY (Game, Tournament, Leaderboard)**

- [ ] **Game Session Proof**
  - [ ] Valid session created with MagicBlock verification
  - [ ] Session ID derived from canonical hash (reproducible)
  - [ ] Score tolerance: ±5 orbit, destroyer/gravity enforced
  - [ ] Session reuse prevented (can't use for leaderboard + tournament)
  - [ ] Max concurrent sessions: evicts oldest non-competitive

- [ ] **Game Coins**
  - [ ] Require verified gameSessionId for earning
  - [ ] Respect daily cap (holder-adjusted)
  - [ ] Respect session allowance (max per mode)
  - [ ] Staking boost applied after cap
  - [ ] Mode mismatch with session → 400

- [ ] **Leaderboard**
  - [ ] Submit requires verified session, score ±5 match
  - [ ] Session can't be reused for 2nd leaderboard entry
  - [ ] gameType must match session.gameMode
  - [ ] Max score enforced (orbit=600, destroyer=9999)
  - [ ] Top 50 returned, cached 10s per filter

- [ ] **Tournament**
  - [ ] Join entry fee deducted, burned per tier rate
  - [ ] Submit requires verified session, score ±5 match
  - [ ] Session mode must match tournament mode
  - [ ] Max score enforced (orbit=600, destroyer=9999)
  - [ ] History shows top 20 completed

### **TIER 2: ECONOMY (Challenges, Quests, Quiz)**

- [ ] **Challenges**
  - [ ] Create: stake 5-1000, balance checked, immediately deducted
  - [ ] Expiry: 15-1440 min options, enforced on list/accept
  - [ ] Accept 0.95 = 190

3. **Weekly distribution guard**
   - globalThis._lastWeeklyRewardAt prevents duplicate on same Monday
   - Test: Monday 00:00 → triggered. Monday 12:00 → not triggered again. Tuesday → skipped

4. **Tournament participation tracking**
   - Counts unique tournament entries per wallet
   - Test: enter daily tournament → count += 1. Enter weekly → count += 1. Re-enter daily → count stays same

### **NOTIFICATIONS & FEED (PRIORITY LOW)**
1. **Feed item creation**
   - Black Hole claim → feed item added
   - Max 200 items → oldest dropped
   - Test: 200 items + add 1 → 1st item dropped

2. **Transaction history**
   - Max 500 per wallet
   - Test: 500 transactions + add 1 → 1st dropped

3. **Notification persistence**
   - Stored per address in SQL/JSON
   - Test: push notification → stored in `notificationsDb[address]`. Restart → reloaded

---

## **CRITICAL BUGS & EDGE CASES TO TEST**

### **Potential Issues (No Fixes)**
1. **Black Hole: Holder status not rechecked per operation**
   - Fetched once at claim start (line 117)
   - If holder status changes mid-claim (unlikely), old status used
   - **QA:** Not a practical issue (holder status stable), but document as assumption

2. **Sybil verdict: No automatic refresh**
   - TTL checked on load, but no background refresh
   - Stale verdict used until next manual scan
   - **QA:** Query reputation, verify `ttl_expires_at` handling in UI

3. **Rate limit: Per-minute check uses rolling window**
   - First 10 requests at t=0-1s → all accepted
   - Request at t=60s → accepted (outside window)
   - No (score): auto-completes with composite score fetch
  - [ ] Accept (game): stays playing until both scores in
  - [ ] Prize: (stake × 2) × 0.95 to winner, 5% burned
  - [ ] Max active: 10,000 before purge triggers
  - [ ] Max score (no proof): 30; above requires session (**arena.js:471**)
  - [ ] Weekly leaderboard: min 3 games, resets Sunday UTC

- [ ] **Quests**
  - [ ] Valid quest IDs: 20 total (5 daily, 5 weekly, 10 one-time)
  - [ ] Daily complete: any 1 of (scan, game, burn, explore, highscore)
  - [ ] Streak: 5 consecutive → progress 5, else 0
  - [ ] Sticky claim: once claimed per period, stays until reset
  - [ ] Text quest: one-time per questId, completion tracked
  - [ ] Quest lock: prevents race on claim (**earn.js:121-125**)

- [ ] **Quiz**
  - [ ] Question RL: 10/5s per IP (tight)
  - [ ] Answer RL: 10/3s per JWT wallet (tight)
  - [ ] Question TTL: 60s, expiry enforced
  - [ ] Correct reward: `quizCorrectReward` coins (non-game cap enforced)
  - [ ] Daily cap: `dailyQuizCap`, max_answers = cap / reward

### **TIER 3: SYBIL & REPUTATION (Analysis, Verdicts)**

- [ ] **Sybil Analysis**
  - [ ] New analysis RL: 5/60s per IP with dedup
  - [ ] In-flight dedup: shared promise prevents concurrent duplicate
  - [ ] Cache hit: <1hr returns cached, else fresh fetch
  - [ ] Own wallet: shorter cache TTL than smoothing across second boundaries
   - **QA:** Burst traffic within 1s → all accepted even if > per-minute limit

4. **JSON debounce: No flush on graceful shutdown**
   - Process terminates before 500ms debounce fires
   - Last changes may not be written to JSON
   - **Guard:** SQLite WAL persists (JSON is fallback)
   - **QA:** Verify SQL consistency after crash

5. **Firestore batch: No retry on failure**
   - Batch write fails → logged, not retried
   - Wallet DB out of sync with Firestore
   - **QA:** Monitor logs for batch write failures

6. **Game coin cap: Multiplier normalization assumes holder status correct**
   - If holder status incorrect in wallet DB, normalization wrong
   - **QA:** Verify holder status is correct before game earning

---

## **PERFORMANCE & SCALABILITY THRESHOLDS**

| Component | Limit | Action | QA Threshold |
|-----------|-------|--------|--------------|
| Wallet database entries | Unbounded | Causes memory/load growth | Monitor size at >100k |
| Score history entries | Unbounded | SQLite index performance | Monitor at >1M entries |
| Sybil graph nodes | 10,000 | Auto-prune oldest (TTL 90d) | Verify pruning at 10,100 nodes |
| Flagged clusters | 1,000 | Auto-prune to 1,000 | Verify at 1,001+ clusters |
| Rate limit cache entries | 5,000 | LRU evict oldest | Verify at 5,001+ entries |
| Helius tx cache | 200 | LRU evict oldest | Verify at 201+ addresses |
| Feed items | 200 | Trim length | Verify at 201+ items |
| Transaction history | 500 | Trim length | Verify at 501+ txs |
| Louvain edges stranger
  - [ ] Verdict mapping: unknown/clean/suspicious/cluster_linked/probable_sybil/confirmed_sybil

- [ ] **Sybil Batch**
  - [ ] Max 20 addresses per request
  - [ ] RL: 15s cooldown per IP
  - [ ] Quick verdict from graph if uncached
  - [ ] Results include trustGrade, riskScore, riskLevel, verdict

- [ ] **Sybil Graph**
  - [ ] Lookup returns safe subset (no full siblings list)
  - [ ] RL: 6s per IP
  - [ ] Includes: riskScore, trustGrade, verdict, walletAgeDays, siblingCount

- [ ] **Funding Sources**
  - [ ] Cached: no RL if <1hr and cached
  - [ ] Fresh: RL 3/30s per IP
  - [ ] Top 20 sources returned
  - [ ] Includes: address, label, type, totalSolReceived, %, firstInteraction

- [ ] **Cluster Detection**
  - [ ] RL: 3/30s per IP
  - [ ] Cache: 30min per address
  - [ ] Confidence: 30 + (siblings × 10), capped at 100
  - [ ] Includes: clusterId, clusterSize, sharedFundingSource, siblingWallets

### **TIER 4: STAKING & VAULT**

- [ ] **Vault Stake**
  - [ ] Tier validation: bronze/silver/gold
  - [ ] Min/max per tier enforced
  - [ ] Max 500k/wallet cap
  - [ ] Lock days: 7 default, configurable
  - [ ] Balance deducted, staking state created

- [ ] **Vault Claim**
  - [ ] Yield calculated correctly
  - [ ] Balance updated, lastClaimTime set
  - [ ] Can't claim if no active stake

- [ ] **Vault Unstake**
  - [ ] Early (before lockEnd): penalty applied, burned
  - [ ] After lockEnd: no penalty
  - [ ] Yield added to returned amount
  - [ ] Staking state cleared

- | 10,000 | Hard limit on query | Test with >10k edges |
| Firestore batch | 450 | Chunk into 450-op batches | Test with 500+ wallet update |
| API key usage key length | Unbounded | Daily reset (cleanup) | Monitor DB size |

---

## **FINAL SUMMARY TABLE: MODULES & QA OWNERS**

| Module | File(s) | Key Behavior | Risks | QA Owner |
|--------|---------|--------------|-------|----------|
| **AUTH** | auth.js | JWT 24h TTL, tokenVersion revocation, IP tracking (50 max) | Token not checked against revoked_at in middleware | TBD |
| **RATE LIMITS** | apiKeyMiddleware.js, rateLimitStore.js | Tiered quotas, daily reset UTC, per-minute rolling | Burst traffic not smoothed, cache > 5k LRU | TBD |
| **BLACK HOLE** | blackHoleOrchestrator.js, blackHoleRewards.js, blackHoleTx.js, blackHoleSignatureStore.js | Replay protection (3-layer), reward formula, daily caps, tx verification | Holder status not re-checked per operation, in-memory cleanup vs. DB persistence | TBD |
| **ECONOMY** | economyRules.js, identityPerks.js, yieldMath.js | Coin multipliers, daily caps, staking yields, early withdrawal penalties | Multiplier normalization assumes correct holder status, no transaction coordination | TBD |
| **COMPOSITE SCORE** | compositeScore.js, scoring.js | 4-component formula, 1000 cap, tier mapping, badge eligibility | Sybil verdict may be stale (no auto-refresh), recovery cap applied per verdict | TBD |
| **SYBIL DETECTION** | scanOr [ ] **Vault Status**
  - [ ] Staking details returned (amount, tier, lockEnd, lockDays, yieldMultiplier)
  - [ ] Unclaimed yield calculated
  - [ ] Time left calculated (0 if past lockEnd)
  - [ ] Daily yield shown
  - [ ] Effective rate shown

- [ ] **Pending Ops Lock**
  - [ ] Can't concurrent stake/claim/unstake on same address
  - [ ] 429 "Staking operation in progress" returned on conflict

### **TIER 5: DISCOVERY & VISUALIZATION**

- [ ] **Global Leaderboard**
  - [ ] Ranked by coins + score
  - [ ] Top 50 returned
  - [ ] Includes: address, totalCoins, score, tier, prismBalance, isMinted, badges, rank

- [ ] **Feed**
  - [ ] Activity stream, capped 200 items
  - [ ] Types: achievement, scan, burn (from source)
  - [ ] Limit: 1-100 per request

- [ ] **Enhanced Tx**
  - [ ] Fetches tx history, classifies (swap, nft_trade, staking, defi)
  - [ ] RL: 30s per address (cached 10min)
  - [ ] Returns: swapCount, nftTradeCount, stakingCount, defiProtocols, isDeFiUser, isDeFiKing

- [ ] **Constellation**
  - [ ] RL: 10s per address + 10s per IP
  - [ ] Cache: 10min per address
  - [ ] Nodes capped at 200, edges filtered by node membership
  - [ ] Viewer stat: constellationExplored tracked (max 10/day for non-owner)
  - [ ] Includes: nodes (id, label, size, x, y, color, solVolume, txCount) and edges (source, target, weight, totalSol, txTypeschestrator.js, sybilVerdict.js, sybilCluster.js, louvainCommunityDetection.js | Verdict derivation, signal weighting, graph clustering | Verdict TTL requires caller check, graph node LRU may evict recent nodes | TBD |
| **QUESTS** | scheduler.js (partial) | Daily answer limit, quiz expiry (5m), tournament participation | No transaction coordination between quest completion + reward | TBD |
| **TOURNAMENTS** | scheduler.js | Weekly rewards on Monday, min 3 games, top 10 ranked, guard against double-trigger | Guard prevents repeat only on same Monday, Tuesday skips | TBD |
| **PERSISTENCE** | persistence.js, datastore.js, dbSchema.js, firebase.js | SQL + JSON dual-store, debounce (500ms), migration, Firestore batch (450 ops) | Debounce not flushed on crash, Firestore batch not retried, no transaction coordination | TBD |
| **NOTIFICATIONS** | persistence.js (partial), scheduler.js | Push notifications, feed items (200 max), tx history (500 max) | No ordering guarantee on notifications, may be out of sync with wallet state | TBD |
| **RECOVERY** | reputationBuilder.js | Twitter bonus (12 max), activity bonus (8 max), recovery cap (verdict-dependent) | Cross-verification bonus logic not visible in snippet | TBD |
| **INITIALIZATION** | initOrchestrator.js, walletBackfill.js, loaders.js | Startup migration, sync backfill, async backfill (DAS + sybil), pruning | Async backfill uses internal API (500ms throttle), DAS fetch may fail mid-page | TBD |
| **ENHANCED TRANSACTIONS** | heliusEnhanced.js | Cache)

### **TIER 6: BUY & ASSETS**

- [ ] **Buy SOL**
  - [ ] Daily limit enforced per address
  - [ ] TX validation: transfer to treasury at 99%+ of expected
  - [ ] Duplicate TX rejected: 400 "Transaction already used"
  - [ ] Pending TX: 429 "Transaction verification in progress"
  - [ ] Cleanup: 48h window, stale entries removed

- [ ] **Buy SKR**
  - [ ] Same daily limit as SOL (unified)
  - [ ] TX validation: transferChecked instruction with mint verification
  - [ ] Slippage tolerance: 95% minimum
  - [ ] Price quote: via `getSkrQuote()`, solUsd + skrUsd

- [ ] **Metadata Upload**
  - [ ] Asset types: png, jpg, webp, gif
  - [ ] UUID filename, stored in assetsDir
  - [ ] Returns URL: `${baseUrl}/metadata/assets/${fileName}`

- [ ] **Metadata Fetch**
  - [ ] Serves JSON with content-type application/json
  - [ ] Path traversal prevented via `resolveMetadataFile()`

### **TIER 7: DATA & ADMIN**

- [ ] **User Data**
  - [ ] GET returns sanitized userData (loadout only if valid)
  - [ ] POST whitelist enforced (no score, tier, badges from client)
  - [ ] Payload max 512 KB
  - [ ] Forge loadout sanitized

- [ ] **Wallet Database**
  - [ ] GET (no auth): single address returns public data only
  - [ ] GET (admin): full export or paginated list
  - [ ] Stats (admin): totalWallets, totalMinted, avgScore, distributions
  - [ ] Sort options: score, scanCount, coins, lastSeenAt

- [ ] **Admin Set-Coins**
  - [ ] 0-1B range validated (10m TTL, 200 max), classification (defi/nft/staking), behavior signals | Behavior drift (Jaccard <0.1) assumes sufficient early/recent history | TBD |
| **REPUTATION** | reputationBuilder.js (partial) | Public API response, TTL header, sybil risk mapping | No validation of input parameters | TBD |

---

## **RUSSIAN MARKDOWN CHECKLIST TEMPLATE**

```markdown
# Identity Prism E2E QA Checklist

## AUTH & SESSION
- [ ] JWT token expires after 24 hours → 401 "Invalid or expired auth token"
- [ ] Increment tokenVersion in wallet DB → all existing tokens become invalid
- [ ] Login from 51st unique IP → oldest IP dropped from 50-IP tracking
- [ ] Missing Authorization header → 401 "Missing auth token"
- [ ] Invalid JWT signature → 401 "Invalid or expired auth token"
- [ ] Bearer prefix required → no prefix parsed as missing token

## RATE LIMITING
- [ ] Free API key: 100 req/day, 101st → 429 "Daily quota exceeded"
- [ ] Free API key: 10 req/min, 11th within 60s → 429 "Rate limit exceeded"
- [ ] Pro API key: 10,000 req/day limit enforced
- [ ] Enterprise API key: unlimited daily, 1000 req/min enforced
- [ ] Revoked API key → 401 "Invalid API key"
- [ ] Daily quota resets at UTC midnight (00:00:00 UTC)
- [ ] Rate limit cache >5,000 entries → oldest evicted (LRU)
- [ ] Expired rate limit entry → auto-deleted on access

## BLACK HOLE CLEANUP
- [ ] Submit valid BH claim → coins credited, feed item added, tx logged
- [ ] Submit same signature twice → 2nd request: 400 "signatures were
  - [ ] Valid Solana address required
  - [ ] Balance returned

- [ ] **Admin Set-Wallet**
  - [ ] Whitelist enforced: coins, score, tier, badges, displayName, avatar, bio, socialLinks, suspended, flagged, notes, scanCount, firstSeenAt, lastSeenAt, source
  - [ ] Internal fields (_*) blocked
  - [ ] At least one valid field required

- [ ] **Admin Sybil Feedback**
  - [ ] List: status filter (pending/verified/rejected), pagination
  - [ ] Verify: boolean update, returns updated state
  - [ ] Stats: 24h window (newScans, incrementalRescans, falsePositivesReported)

### **TIER 8: EDGE CASES & RACE CONDITIONS**

- [ ] **Quest + Earn Concurrent**
  - [ ] POST /api/prism/earn (quest_daily) + POST /api/prism/earn (quiz) concurrently
  - [ ] Expected: second request queued or fails gracefully; no double-claim

- [ ] **Challenge Accept + Score Fetch Timeout**
  - [ ] Accept triggers composite score fetch; RPC times out
  - [ ] Expected: stakes refunded, status = cancelled

- [ ] **Game Session Double-Credit**
  - [ ] Two rapid POST /api/game/coins (same session) within milliseconds
  - [ ] Expected: second fails (session allowance exhausted) or partial credit

- [ ] **Buy TX Reuse**
  - [ ] Two POST /api/prism/buy (same txSignature) concurrently
  - [ ] Expected: first succeeds, second gets 400 "already used"

- [ ] **Tournament Entry at Boundary**
  - [ ] POST /api/tournament/join at tournament endTime
  - [ ] Expected: either accepted or rejected, not race condition

- [ ] **Challenge Accept Race**
  - [ ] Two POST /api/challenge/accept (same challengeId) concurrently
  - [ ] Expected: first succeeds, second gets 409 already claimed"
- [ ] Submit 65 operations (>64 max) → 400 "operations array is required"
- [ ] Missing swapSignature for swap action → 400 "swapSignature required for swap"
- [ ] Close operation verification fails (wrong signer) → 400 "Close transaction verification failed"
- [ ] Burn operation fails (mint mismatch) → 400 "Burn transaction verification failed"
- [ ] Swap operation fails (token not fully disposed) → 400 "Swap transaction verification failed"
- [ ] Commission shortfall → 400 "Black Hole commission verification failed"
- [ ] Standard holder (non-NFT): 10% commission required
- [ ] Identity holder (NFT): 2% commission required
- [ ] Reward formula: 1 fungible + 0 NFTs + 0 SOL → 8 PRISM
- [ ] Reward formula: 0 fungible + 1 NFT + 0 SOL → 15 PRISM
- [ ] Reward formula: 0 fungible + 0 NFTs + 1 SOL (1000 milli) → 8 PRISM
- [ ] Reward capped at 500 PRISM (64 fungibles → 512 capped to 500)
- [ ] Holder daily cap = base; non-holder = base / 2
- [ ] Daily cap incremented per address per day (YYYY-MM-DD key)
- [ ] Claim at 23:59 UTC using up cap → next claim at 00:01 UTC uses new cap
- [ ] NFT classification: decimals=0, amount=1 → NFT, reward +15
- [ ] Fungible classification: decimals>0 OR amount>1 → fungible, reward +8
- [ ] Restart server, resubmit same signature → 400 (SQLite guard persists)
- [ ] Signature cleaned from in-memory after 7 days, but SQLite blocks forever

## ECONOMY & COINS
- [ ] Holder game coin multiplier: 2x applied (100 earned → 200 credited)
- [ ] Non-holder game coin multiplier: 1x ( "Challenge no longer available" or 429 from lock

- [ ] **Stake Concurrent Ops**
  - [ ] POST /api/prism/vault/claim + POST /api/prism/vault/unstake concurrently
  - [ ] Expected: 429 "Staking operation in progress" on second

- [ ] **Address Mismatch Enforcement**
  - [ ] POST /api/prism/earn with address ≠ jwt.address
  - [ ] Expected: 403 "Address mismatch"
  - [ ] POST /api/prism/spend with address ≠ jwt.address
  - [ ] Expected: 403 "Address mismatch"

### **TIER 9: VALIDATION & ERROR HANDLING**

- [ ] **Invalid Addresses**
  - [ ] Malformed base58 → 400 "Invalid address"
  - [ ] Empty address → 400 "address required"

- [ ] **Invalid JSON**
  - [ ] Unparseable JSON → 400 "Invalid JSON body"
  - [ ] Missing required fields → 400 "field required"

- [ ] **Type Validation**
  - [ ] amount as string → 400 "amount must be number"
  - [ ] delta = 0 → 400 "delta (non-zero integer) required"
  - [ ] score < 0 or > 100k → 400 "Invalid score"

- [ ] **Insufficient Balance**
  - [ ] Spend > balance → 400 "insufficient balance"
  - [ ] Buy > remaining daily limit → 400 "Daily limit reached"
  - [ ] Tournament entry > balance → 400 "Insufficient balance"

- [ ] **Rate Limit 429 Responses**
  - [ ] Trigger via rapid repeated requests
  - [ ] Verify cooldown enforced (wait, retry succeeds)

- [ ] **Not Found 404 Responses**
  - [ ] Challenge ID not found → 404 "Challenge not found"
  - [ ] Session ID not found → 404 "Session proof not found"
  - [ ] Wallet not in database → 404 "Wallet not found"

- [ ] **Forbidden 403 Responses**
  - [ ] Address mismatch → 403 "Address mismatch"
  - [ ] Challenge specific opponent → 403 "This challenge is for a specific opponent"
  - [ ] Session wallet mismatch → 403 "Session wallet mismatch"

---

## **PART 8: MOBILE E2E TESTno boost)
- [ ] Game coin cap (holder): normalized for dailies cap, scaled back on apply
- [ ] Non-game daily cap: holder = base, non-holder = base / 2
- [ ] Quiz reward: rejected if dailyCount ≥ maxDailyAnswers
- [ ] Quiz reward: rejected if ngEarned + reward > nonGameCap
- [ ] Quiz answer expires >5 minutes → auto-deleted by cleanup job
- [ ] Staking bronze: 10k min, 7-day lock, 0.75x multiplier, 0.05 boost rate
- [ ] Staking silver: 30k min, 30-day lock, 1.0x multiplier, 0.10 boost rate
- [ ] Staking gold: 75k min, 90-day lock, 1.25x multiplier, 0.15 boost rate
- [ ] Staking yield bracket 1 (≤5k): 0.50% daily
- [ ] Staking yield bracket 5 (>100k): 0.08% daily
- [ ] Lock multiplier 7d: 1.0x; 30d: 1.5x; 90d: 2.5x; 180d: 4.0x
- [ ] Unclaimed yield capped at 90 days (even if locked longer)
- [ ] Early withdrawal penalty 7d: -10%; 30d: -15%; 90d: -20%; 180d: -25%

## COMPOSITE SCORING & TIERS
- [ ] On-chain score max: 400 (all categories: SOL 40 + age 100 + tx 80 + NFT 32 + DeFi 30 + badges 68 + collection 50)
- [ ] Composite score max: 1000 (hard cap enforced)
- [ ] Tier mercury: 0-99; mars: 100-219; venus: 220-349; earth: 350-479
- [ ] Tier neptune: 480-599; uranus: 600-699; saturn: 700-799; jupiter: 800-879
- [ ] Tier sun: 880-949; binary_sun: 950+
- [ ] SOL balance: 10 SOL → 40 pts (max)
- [ ] Wallet age 730+ days → 100 pts (max)
- [ ] Transactions SCENARIOS**

### **Real-Phone Solana Seeker Integration**
- [ ] **W1 Auth Flow**
  - [ ] W1 requests challenge → nonce issued
  - [ ] W1 signs message (mobile wallet UI) → signature captured
  - [ ] POST token with signature → JWT issued
  - [ ] JWT stored in localStorage/secure storage
  - [ ] Subsequent requests use JWT header

- [ ] **W1 Game Session**
  - [ ] Game plays, records seed + slot
  - [ ] POST /api/game/session with payload → verified or unverified
  - [ ] If verified, session proofUrl included
  - [ ] POST /api/game/coins (with gameSessionId) → coins credited

- [ ] **W1 Buy (SOL)**
  - [ ] Mobile wallet opens system approval dialog
  - [ ] User approves transfer (at least 99% of expected SOL)
  - [ ] Signature returned to app
  - [ ] POST /api/prism/buy with txSignature → coins added
  - [ ] Balance updated in UI immediately

- [ ] **W1 Buy (SKR)**
  - [ ] Price quote shown (SOL + SKR options)
  - [ ] Mobile wallet approves SPL token transfer
  - [ ] Signature captured
  - [ ] POST /api/prism/buy/skr → coins added
  - [ ] Verify 95% slippage tolerance applied

- [ ] **W1 Challenge**
  - [ ] Create challenge (5-1000 coins) → balance deducted immediately
  - [ ] Accept as opponent → balance deducted
  - [ ] Play game (score challenge) → composite scores fetched, winner determined
  - [ ] Prize awarded to winner
  - [ ] Loser sees loss notification

- [ ] **W1 Constellation View**
  - [ ] Fetch constellation (address) → nodes + edges returned
  - [ ] Render on mobile (200 nodes max)
  - [ ] Viewer stat incremented (up to 10/day)

- [ ] **W1 Sybil Scan**
  - [ ] Request analysis (address) → in-flight dedup, cache hit, or fresh fetch
  - [ ] Verdict displayed (trustGrade, riskLevel)
  - [ ] Funding sources shown (top 20)
  - [ ] Cluster info shown (if applicable)

### **W1 + W2 Two-Wallet Dev Mode**
- [ ] **Auth W1 + W2**
  - [ ] W1 challenge/token flow → JWT_W1
  - [ ] W2 challenge/token flow (separate nonce) → JWT_W2
  - [ ] Both JWTs stored separately

- [ ] **Concurrent Earn (W1 + W2)**
  - [ ] W1 POST /api/prism/earn (quiz) → coins earned
  - [ ] W2 POST /api/prism/earn (quiz) → coins earned independently
  - [ ] Verify separate daily counters: `quiz:W1:date` ≠ `quiz:W2:date`

- [● Explore Analyze server routes
  │ Read sybil.js
  │   │ server\routes\sybil.js
  │   └ L1:150 (150 lines read)
  └ Read sybil.js
      │ server\routes\sybil.js
      └ L151:300 (150 lines read)

 >5,000 → 80 pts (max)
- [ ] NFTs >100 → 32 pts (max)
- [ ] DeFi activity (swaps + trades + protocols) → 30 pts max
- [ ] Sybil verdicts (unknown, suspicious, cluster_linked, probable_sybil, confirmed_sybil) → badges disabled
- [ ] Sybil clean verdict: floor 0, ceil 100, recovery cap +25
- [ ] Sybil confirmed_sybil verdict: floor 0, ceil 20, recovery cap +0 (no recovery)
- [ ] Verified human badge: trustScore ≥ 80 + sybilBadgeEligible → +10
- [ ] Game master badge: 3+ game types → +10
- [ ] Achievement hunter badge: 10+ achievements → +10
- [ ] Arena champion badge: 5+ challenge wins → +8

## SYBIL DETECTION
- [ ] Wallet 0 transactions → verdict "unknown"
- [ ] Wallet 100 txs, no signals, trustScore > 50 → verdict "clean"
- [ ] Wallet with graph_intelligence signal → verdict "probable_sybil" or higher
- [ ] Wallet with strongNetworkCount ≥ 2 → verdict "probable_sybil" or higher
- [ ] Wallet with 2+ siblings → verdict ≥ "cluster_linked"
- [ ] Wallet with fundingChainDepth ≥ 1 → verdict ≥ "cluster_linked"
- [ ] Wallet with topFunderPct ≥ 40% → verdict ≥ "cluster_linked"
- [ ] Sybil scan pagination: 1,000 sigs/page, max 10 pages (10,000 sig limit)
- [ ] Louvain edge lookback: 90 days
- [ ] Louvain min cluster size: 3 members
- [ ] Sybil graph max nodes: 10,000; prune oldest when exceeded
- [ ] Sybil graph node TTL: 90 days
- [ ] Flagged cluster TTL: 90 days; max 1,000 clusters
- [ ] Behavior drift (early vs. recent programs): Jaccard <0.1 → detected
- [ ] Hub-spoke pattern: one funder fans to 5+ siblings → network signal
- [ ] Funding chain depth: tracked up to 4 levels

## RECOVERY & TRUST
- [ ] Twitter verified + 3+ years old + 500 followers + 1,000 tweets → 12 pts (capped)
- [ ] Twitter suspended → 0 bonus (no verification)
- [ ] Activity bonus: 3 game types +1, 15 achievements +2, 5 quests +1, 7 streak +1, 10 scans +1
- [ ] Activity bonus cap: 8 pts
- [ ] Total recovery bonus cap: 25 pts (for clean verdict)
- [ ] Confirmed sybil verdict recovery cap: 0 pts (no recovery allowed)

## QUESTS & TOURNAMENTS
- [ ] Quiz answer expires >5 minutes → auto-deleted by cleanup
- [ ] Weekly arena: min 3 games per player to rank
- [ ] Weekly arena ranking: top 10 by coins earned
- [ ] Weekly reward multiplier: 2x stake (stakeAmount * 2)
- [ ] Weekly reward tax: 5% (0.95x multiplier)
- [ ] Weekly distribution: triggered Monday (UTC day 1) once per Monday
- [ ] Weekly guard: globalThis._lastWeeklyRewardAt prevents Monday repeat
- [ ] Tournament participation: unique tournament count per wallet tracked

## PERSISTENCE & DATA CONSISTENCY
- [ ] Wallet updated → SQL updated immediately + JSON debounced 500ms
- [ ] Process crash → WAL ensures SQL atomic, JSON may lag ≤500ms
- [ ] JSON fallback: if SQL empty, load from JSON
- [ ] Migration: migrateFromJson() runs only if SQL is empty
- [ ] Firestore batch: ≤500 wallets → 1 batch; >500 → chunked (450 ops max per batch)
- [ ] Firestore batch failure → logged, not retried (JSON persists, FB out of sync)
- [ ] Rate limit storage: dual cache (in-memory + SQLite) with TTL expiry

## NOTIFICATIONS & FEED
- [ ] Black Hole claim → feed item added to feedItems array
- [ ] Feed items max: 200 (oldest dropped on overflow)
- [ ] Transaction history max: 500 per wallet (oldest dropped on overflow)
- [ ] Notification pushed → stored in notificationsDb per address
- [ ] Notification persisted to SQL/JSON on debounce

## INITIALIZATION & BACKFILL
- [ ] Startup migration: JSON → SQL if SQL empty
- [ ] Sync backfill: wallet DB populated from scoreHistory + coinBalances
- [ ] Async backfill: DAS lookup for CORE_COLLECTION (requires env var)
- [ ] Async backfill: sybil analysis queued for wallets without sybil data (500ms throttle)● Explore Analyze server services
  │ Read yieldMath.js
  │   │ server\services\yieldMath.js
  │   └ 82 lines read
  └ Read cardGenerator.js
      │ server\services\cardGenerator.js
      └ L1:100 (100 lines read)

Бэкенд-сводки готовы; теперь дотягиваю фронтенд-логику и конкретные места, где кошелёк, JWT, скан, минт и награды соединяются в один пользовательский флоу.

● Read 1777181934431-copilot-tool-output-xz388c.txt
  │ C:\Temp\1777181934431-copilot-tool-output-xz388c.txt
  └ L1:280 (280 lines read)

● Read 1777181944148-copilot-tool-output-g0hlku.txt
  │ C:\Temp\1777181944148-copilot-tool-output-g0hlku.txt
  └ L1:280 (279 lines read)

● Search (grep)
  │ "ensureJwt|jwt|challenge|refresh|expire|scan|sybil|bounty|quest|quiz|mint|bu
  │ y|stake|notification|toast|hub|wallet=|wallet\=|W1|W2|dev|admin|coins|earnPr
  │ ism|spendPrism|canEarnFromScan|markScanEarned|rank|tier|leaderboard|composit
  │ e" (src\pages\Index.tsx, src\components\CosmicHubV3.tsx,
  │ src\lib\prismCoin.ts, src\lib\mintIdentityPrism.ts)
  └ 10 lines found

● Count frontend file lines (shell)
  │ Set-Location 'C:\solana dapp'; @('src\components\CosmicHubV3.tsx','src\pages
  │ \Index.tsx','src\lib\prismCoin.ts','src\lib\mintIdentityPrism.ts') |
  │ ForEach-Object { $lines = (Get-Content $_ | Measure-Object -Line).Lines;
  │ "$($_)`t$lines" }
  └ 5 lines...

Уже видно много деталей по лимитам и гонкам. Я дополнительно открываю ключевые участки напрямую, чтобы финальный чеклист по каждому модулю был привязан к конкретной серверной логике, а не только к агрегированной сводке.

● Read prismCoin.ts
  │ src\lib\prismCoin.ts
  └ L1:320 (319 lines read)

● Read CosmicHubV3.tsx
  │ src\components\CosmicHubV3.tsx
  └ L250:700 (451 lines read)

● Read mintIdentityPrism.ts
  │ src\lib\mintIdentityPrism.ts
  └ L100:520 (421 lines read)

● Read auth.js
  │ server\routes\auth.js
  └ L1:220 (161 lines read)

● Read auth.js
  │ server\services\auth.js
  └ L1:200 (94 lines read)

● Read Index.tsx
  │ src\pages\Index.tsx
  └ L250:700 (450 lines read)

Ниже добираю именно те серверные места, которые определяют тестовые предусловия: капы, штрафы, статусы challenge, required proof, JWT и дневные лимиты.

● Read game.js
  │ server\routes\game.js
  └ L1:260 (260 lines read)

● Read earn.js
  │ server\routes\earn.js
  └ L1:260 (260 lines read)

● Read sybil.js
  │ server\routes\sybil.js
  └ L1:260 (260 lines read)

● Read arena.js
  │ server\routes\arena.js
  └ L1:320 (320 lines read)

● Read vault.js
  │ server\routes\vault.js
  └ L1:220 (195 lines read)

● Read buy.js
  │ server\routes\buy.js
  └ L1:220 (220 lines read)

● Read quiz.js
  │ server\routes\quiz.js
  └ L1:180 (119 lines read)

● Read earn.js
  │ server\routes\earn.js
  └ L260:380 (67 lines read)

● Read game.js
  │ server\routes\game.js
  └ L260:620 (316 lines read)

● Read buy.js
  │ server\routes\buy.js
  └ L220:380 (157 lines read)

● Read notifications.js
  │ server\routes\notifications.js
  └ L1:160 (103 lines read)

● Read leaderboard.js
  │ server\routes\leaderboard.js
  └ L1:140 (93 lines read)

● Read quest.js
  │ server\routes\quest.js
  └ L1:180 (116 lines read)

● Read spend.js
  │ server\routes\spend.js
  └ L1:180 (126 lines read)

● Read arena.js
  │ server\routes\arena.js
  └ L320:700 (364 lines read)

Самые важные route-правила уже видны. Теперь беру сервисы, где зашиты формулы и серверные state-machine: Black Hole, sybil verdict, composite score, staking yield и holder/per-source cap logic.

● Read economyRules.js
  │ server\services\economyRules.js
  └ L1:120 (30 lines read)

● Read blackHoleRewards.js
  │ server\services\blackHoleRewards.js
  └ L1:120 (24 lines read)

● Read blackHoleTx.js
  │ server\services\blackHoleTx.js
  └ L1:240 (182 lines read)

● Read yieldMath.js
  │ server\services\yieldMath.js
  └ L1:140 (82 lines read)

● Read compositeScore.js
  │ server\services\compositeScore.js
  └ L1:180 (121 lines read)

● Read blackHoleOrchestrator.js
  │ server\services\blackHoleOrchestrator.js
  └ L1:320 (266 lines read)

● Read sybilVerdict.js
  │ server\services\sybilVerdict.js
  └ L1:260 (260 lines read)

Осталось закрыть recovery/composite/reputation и фронтовой UX-флоу: где именно после скана меняется состояние, когда даётся награда, где открывается минт и как ведёт себя mobile wallet на Seeker.

● Read utility.js
  │ server\routes\utility.js
  └ L1:140 (93 lines read)

● Read userData.js
  │ server\routes\userData.js
  └ L1:260 (232 lines read)

● Read blackhole.js
  │ server\routes\blackhole.js
  └ L1:120 (34 lines read)

● Read reputation.js
  │ server\routes\reputation.js
  └ L1:240 (240 lines read)

● Read mintIdentityPrism.ts
  │ src\lib\mintIdentityPrism.ts
  └ L520:920 (401 lines read)

● Read Index.tsx
  │ src\pages\Index.tsx
  └ L1250:1906 (498 lines read)

● Read Index.tsx
  │ src\pages\Index.tsx
  └ L700:1250 (551 lines read)

Проверю ещё два узких вопроса перед финальным планом: есть ли отдельный refresh endpoint/JWT-refresh логика и где именно задействован dev-mode `?wallet=0/?wallet=1`, чтобы корректно включить это в предусловия E2E.

● Read CosmicHubV3.tsx
  │ src\components\CosmicHubV3.tsx
  └ L700:980 (281 lines read)

● Search (grep)
  │ "refresh|expiresIn|expiresAt|tokenVersion|ip_auth_jwt|obtainJwt|getCachedJwt
  │ |ensureJwt" (server\routes, server\services, src\pages\Index.tsx,
  │ src\lib\mintIdentityPrism.ts, src\lib\prismCoin.ts)
  └ 58 lines found

● Search (grep)
  │ "wallet=0|wallet=1|\?wallet|searchParams\.get\('wallet'\)|dev.?mode|W1|W2"
  │ in *.{ts,tsx,js,md}
  └ 7 lines found

Нашёл dev-wallet реализацию отдельно от основных файлов. Быстро дочитаю её, чтобы секция с W1/W2 и `?wallet=0/?wallet=1` была практичной для ADB-прогона на Seeker.

● Read devWallet.ts
  │ src\lib\devWallet.ts
  └ L1:220 (61 lines read)

● Read DevWalletProvider.tsx
  │ src\components\DevWalletProvider.tsx
  └ L1:260 (155 lines read)

● Search (grep)
  │ "authChallengeTtlMs|dailyGameCoinCap|nonGameDailyEarnCap|dailyHuntCap|dailyS
  │ canCap|dailyBlackHoleCleanupCap|dailyQuizCap|quizCorrectReward|cleanScanRewa
  │ rdCooldownMs|scanWalletReward|prismEarnCooldownTable|prismEarnCooldownDefaul
  │ t|dailyCoinLimit|coinPackages|weeklyRewards|weeklyXpRewards|maxDeltaPerGame|
  │ gameSessionOnchainBonusMultiplier|freeRevivesPerDay" in *.{js,ts,tsx}
  │ (server, src)
  └ 133 lines found

У большинства лимитов уже есть места использования, но не все численные значения видны из route/service файлов. Возьму только узкий фрагмент `server/helius-proxy.js` с объявлениями констант — без чтения большого файла целиком.

● Search (grep)
  │ "const (AUTH_CHALLENGE_TTL_MS|NON_GAME_DAILY_EARN_CAP|DAILY_QUIZ_CAP|QUIZ_CO
  │ RRECT_REWARD|DAILY_GAME_COIN_CAP|DAILY_HUNT_CAP|DAILY_SCAN_CAP|FREE_REVIVES_
  │ PER_DAY|MAX_DELTA_PER_GAME|GAME_SESSION_ONCHAIN_BONUS_MULTIPLIER|PRISM_EARN_
  │ COOLDOWN_TABLE|PRISM_EARN_COOLDOWN_DEFAULT|COIN_PACKAGES|DAILY_COIN_LIMIT|DA
  │ ILY_BLACKHOLE_CLEANUP_CAP|CLEAN_SCAN_REWARD_COOLDOWN_MS|SCAN_WALLET_REWARD|W
  │ EEKLY_REWARDS|WEEKLY_XP_REWARDS)" (server\helius-proxy.js)
  └ 18 lines found

● Read helius-proxy.js
  │ server\helius-proxy.js
  └ L4571:4605 (35 lines read)

● Read helius-proxy.js
  │ server\helius-proxy.js
  └ L4798:4812 (15 lines read)

● Read helius-proxy.js
  │ server\helius-proxy.js
  └ L5128:5140 (13 lines read)

● Search (grep)
  │ "GAME_SESSION_ONCHAIN_BONUS_MULTIPLIER" (server\helius-proxy.js)
  └ 2 lines found

● Read constants.ts
  │ src\constants.ts
  └ L1:80 (80 lines read)

● Search (grep)
  │ "GAME_SESSION_ONCHAIN_BONUS_MULTIPLIER" in *.{js,ts,tsx}
  └ 5 lines found

● Read identityPerks.js
  │ server\services\identityPerks.js
  └ L1:120 (39 lines read)

● Read scheduler.js
  │ server\services\scheduler.js
  └ L150:230 (81 lines read)

● Read scheduler.js
  │ server\services\scheduler.js
  └ L230:320 (91 lines read)

● Search (grep)
  │ "ttl_expires_at|scanCount|explorer|questMaster|streakLord|topHunter|trustGra
  │ de|trustScore" (server\services\scanOrchestrator.js)
  └ 10 lines found

● Search (grep)
  │ "MARKET/mint-quote|mint-for-coins|mint-cnft|update-card|/api/v2/migration-st
  │ atus|/api/migration-status" in *.{js,ts,tsx}
  └ 45 lines found

NFT-модуль сильно завязан на `blinks.js`. Возьму только куски про `mint-for-coins`, `mint-cnft` и `update-card`, чтобы раздел NFT MINT включал реальные серверные гарантии, а не только UI-флоу.

● Read market.js
  │ server\routes\market.js
  └ L1:120 (119 lines read)

● Read blinks.js
  │ server\routes\blinks.js
  └ L140:220 (81 lines read)

● Read blinks.js
  │ server\routes\blinks.js
  └ L640:860 (221 lines read)

● Read blinks.js
  │ server\routes\blinks.js
  └ L860:1128 (269 lines read)

● Read blinks.js
  │ server\routes\blinks.js
  └ L1267:1480 (214 lines read)

● Search (grep)
  │ "mint-quote|skrAmount|mintPriceSol" (server\routes\market.js)
  └ 5 lines found

● Search (grep)
  │ "updateFeeSol" (server\routes\blinks.js)
  └ 3 lines found

● Read market.js
  │ server\routes\market.js
  └ L160:190 (31 lines read)

● Read blinks.js
  │ server\routes\blinks.js
  └ L80:100 (21 lines read)

Для Sybil Hunt мне нужен только один недостающий кусок — формула bounty и TTL/кэш-логика свежего скана. Добираю это точечно, чтобы edge cases по bounty и перескану были корректными.

● Read scanOrchestrator.js
  │ server\services\scanOrchestrator.js
  └ L60:120 (61 lines read)

● Read scanOrchestrator.js
  │ server\services\scanOrchestrator.js
  └ L1180:1275 (96 lines read)

● Search (grep)
  │ "computeSybilHuntReward|getSybilRewardPath|getSybilCacheTtlMs|ttl_expires_at
  │ |persistSybilAnalysis|rewardPath" (server\helius-proxy.js,
  │ server\services\scanOrchestrator.js, server\services\sybilVerdict.js,
  │ server\routes\sybil.js)
  └ 30 lines found

● Read helius-proxy.js
  │ server\helius-proxy.js
  └ L1138:1155 (18 lines read)

● Read helius-proxy.js
  │ server\helius-proxy.js
  └ L3899:3988 (90 lines read)

● Search (grep)
  │ "SYBIL_HUNT_BASE_REWARD" (server\helius-proxy.js)
  └ 2 lines found

● Search (grep)
  │ "challenge_win|earnPrism\(.*challenge_win|api/prism/earn.*challenge_win" in
  │ *.{ts,tsx} (src)
  └ 5 lines found

● Search (grep)
  │ "10,000|hasExistingId|Update|Mint|paymentToken|coins
  │ spent|SKR|SOL|mintState|remintState" (src\pages\Index.tsx)
  └ 106 lines found

Ниже — **подробный E2E-план Identity Prism** под **реальный телефон Solana Seeker + ADB**.

**Критичная оговорка из кода:** dev-mode `?wallet=0` / `?wallet=1` удобен для двух тестовых кошельков **W1/W2**, но `DevWalletProvider` умеет только `signMessage` и **не умеет** `signTransaction/sendTransaction`. Значит:
| Режим | Что можно гонять |
|---|---|
| **Dev W1/W2** | AUTH/JWT, scan, arena, leaderboard, quests, quiz, server-side economy, notifications, composite/ranks |
| **Реальный Seeker wallet** | BLACK HOLE, buy for SOL/SKR, NFT mint/remint/update, любые сценарии с wallet approval / dismiss |

**Базовые оракулы для проверки результата:** UI/toasts, Hub passport, Inbox badge, `/api/prism/balance`, `/api/prism/transactions`, `/api/daily-limits`, `/api/xp`, `/api/game/session/:id`, `/api/challenge/my`, `/api/game/leaderboard`, `/api/sybil/analysis`, серверные логи.

---

# 0. Общая подготовка стенда

- [ ] **SETUP-01. Базовая инициализация**
  **Что тестируем:** корректность стартового стенда для E2E.  
  **Предусловия:** dev server доступен с телефона; включён `VITE_DEV_WALLET=true` для сценариев W1/W2; для on-chain сценариев есть отдельный реальный Seeker wallet с SOL/SKR/пылью/NFT.  
  **Шаги:** 1) открыть `...?wallet=0`; 2) убедиться, что внизу есть плашка `DEV #1`; 3) открыть `...?wallet=1`; 4) убедиться, что адрес сменился; 5) открыть обычный режим без dev-wallet для tx-сценариев.  
  **Ожидаемый результат:** W1 и W2 стабильно переключаются URL-параметром; dev wallet автоподключён; для real Seeker открывается реальный wallet flow.  
  **Edge cases:** dev-wallet не должен попадать в production build; переключение `wallet` должно менять JWT-контекст; stale `ip_auth_jwt` после смены W1/W2 не должен приводить к Address mismatch.

- [ ] **SETUP-02. Сбор baseline перед каждым модулем**
  **Что тестируем:** воспроизводимость теста.  
  **Предусловия:** выбран нужный кошелёк.  
  **Шаги:** перед каждым модулем фиксировать: текущий PRISM баланс, `/api/daily-limits`, `/api/prism/transactions`, `/api/xp`, текущий sybil grade/tier/rank, наличие Identity Prism NFT.  
  **Ожидаемый результат:** у каждого кейса есть baseline, от которого виден дельта-эффект.  
  **Edge cases:** дневные лимиты считаются по **UTC-дню**; если тест около полуночи UTC, baseline снять повторно.

---

# 1. AUTH

- [ ] **AUTH-01. Подключение кошелька и автополучение JWT**
  **Что тестируем:** connect flow + prewarm JWT после подключения.  
  **Предусловия:** W1 (`?wallet=0`) или реальный Seeker; sessionStorage очищен.  
  **Шаги:** 1) открыть приложение; 2) подключить кошелёк; 3) дождаться перехода landing -> scanning -> hub; 4) выполнить действие, требующее JWT (например earn/notifications/inbox).  
  **Ожидаемый результат:** JWT выдаётся после challenge+signature; действия, требующие auth, проходят без дополнительной ошибки; баланс/уведомления доступны.  
  **Edge cases:** challenge rate limit — не чаще 1 раза в 3 сек/IP; token exchange — не чаще 1 раза в 5 сек/IP; nonce живёт **5 минут**.

- [ ] **AUTH-02. Отказ от подписи и ручной retry**
  **Что тестируем:** сценарий `jwtDeclined` и кнопку **Sign Now** в Hub.  
  **Предусловия:** реальный Seeker или окружение, где можно отклонить `signMessage`.  
  **Шаги:** 1) подключить кошелёк; 2) отклонить подпись challenge; 3) перейти в hub; 4) нажать **Sign Now**; 5) согласиться на подпись.  
  **Ожидаемый результат:** появляется amber-баннер `Sign wallet to earn coins and save progress`; после retry баннер исчезает, JWT получен, earn/save-progress работают.  
  **Edge cases:** repeated decline не должен ломать app-state; stale JWT другого кошелька должен быть очищен при смене адреса.

- [ ] **AUTH-03. Неверная подпись / nonce reuse / address mismatch**
  **Что тестируем:** защиту challenge/token exchange.  
  **Предусловия:** W1 и W2 доступны.  
  **Шаги:** 1) взять challenge для W1; 2) попытаться подписать W2; 3) повторно использовать уже использованный nonce; 4) попробовать обмен после истечения TTL nonce.  
  **Ожидаемый результат:** ошибки `Address mismatch`, `Invalid or expired nonce`, `Challenge expired`, `Invalid signature`; новый JWT не выдаётся.  
  **Edge cases:** nonce одноразовый; reuse после успешной выдачи должен стабильно падать; истёкший challenge должен удаляться.

- [ ] **AUTH-04. Expire / revoke / refresh-модель**
  **Что тестируем:** поведение при истечении и ревокации JWT.  
  **Предусловия:** валидный JWT; доступ к админ-инструменту или DB для увеличения `tokenVersion` — если есть.  
  **Шаги:** 1) использовать валидный JWT; 2) дождаться/эмулировать expiry; 3) повторить auth-only запрос; 4) если доступно — инкрементнуть `tokenVersion`; 5) повторить запрос.  
  **Ожидаемый результат:** серверный TTL JWT — **24h**; после expiry/ревокации получаем `401 Invalid or expired auth token` или `401 Token revoked`.  
  **Edge cases:** отдельного `/refresh` endpoint **нет** — refresh для E2E трактовать как **повторный challenge -> token**; клиент может кешировать токен примерно на сессию, но истина — сервер.

---

# 2. ECONOMY

- [ ] **ECONOMY-01. Баланс, транзакции, дневные лимиты**
  **Что тестируем:** целостность PRISM-экономики на чтение.  
  **Предусловия:** кошелёк авторизован.  
  **Шаги:** 1) открыть Hub; 2) сверить passport coins; 3) запросить `/api/prism/balance`; 4) запросить `/api/prism/transactions`; 5) запросить `/api/daily-limits`.  
  **Ожидаемый результат:** UI и API показывают одинаковый баланс; история отражает последние earn/spend; caps соответствуют holder/non-holder статусу.  
  **Edge cases:** history может хранить до 500 tx; badge unread/poll может обновляться не мгновенно.

- [ ] **ECONOMY-02. Глобальный non-game cap и sub-caps**
  **Что тестируем:** ограничения для non-game earn.  
  **Предусловия:** кошелёк без достижения дневного лимита.  
  **Шаги:** набрать награды из non-game источников: scan, hunt, quiz, black hole, quest; следить за `/api/daily-limits`.  
  **Ожидаемый результат:** общий non-game cap = **1500/day для holder**, **750/day для non-holder**; sub-caps: **scan 100/day**, **sybil hunt 500/day**, **quiz 500/day**, **black hole 500/day**.  
  **Edge cases:** verified reward не должен “частично” пройти, если из-за него превышается verified sub-cap; reset идёт по UTC.

- [ ] **ECONOMY-03. Per-source cooldowns и глобальный burst-limit**
  **Что тестируем:** антиспам по earn.  
  **Предусловия:** JWT валиден.  
  **Шаги:** быстро подряд вызывать earn из разных и одинаковых источников.  
  **Ожидаемый результат:** глобальный cooldown на earn — **2 секунды на wallet**; per-source cooldowns: game_* **60s**, quest_daily **24h**, quest_weekly **7d**, quest_milestone **24h**, challenge_win **10m**, scan_wallet **60s**, sybil_hunt **120s**, text_quest **24h**, first_mint ~ one-time.  
  **Edge cases:** burst >30 запросов/min по IP должен давать 429; лимитер должен чиститься и не расти бесконечно.

- [ ] **ECONOMY-04. Spend integrity и burn fee**
  **Что тестируем:** корректное списание монет.  
  **Предусловия:** достаточно PRISM.  
  **Шаги:** купить forge item/module; затем сверить баланс/tx/history.  
  **Ожидаемый результат:** spend полностью сервер-authoritative; списание происходит один раз; в истории есть `spend`; на spend применяется **2% burn fee**.  
  **Edge cases:** duplicate tap / parallel spend -> `Spend in progress`; price mismatch / invalid source / duplicate item ownership должны отвергаться.

- [ ] **ECONOMY-05. Per-call caps**
  **Что тестируем:** max reward per action.  
  **Предусловия:** подготовлены действия разных типов.  
  **Шаги:** попробовать запросить/спровоцировать payout выше лимита на один вызов.  
  **Ожидаемый результат:** caps: `game_*` **50**, `scan_wallet` **5**, `quest_daily` **15**, `quest_weekly` **50**, `quest_milestone` **100**, `challenge_win` **30**, `first_mint` **1000**, `text_quest` **1200**, `sybil_hunt` **70**.  
  **Edge cases:** сервер должен отклонять oversized amount, а не тихо принимать.

---

# 3. GAME / LEAGUE

- [ ] **GAME-01. Регистрация session proof**
  **Что тестируем:** создание `/api/game/session` и верификация seed/slot/score.  
  **Предусловия:** JWT валиден; есть доступ к игре League.  
  **Шаги:** 1) сыграть Orbit/Destroyer/Gravity; 2) завершить сессию; 3) дождаться регистрации session proof; 4) проверить `/api/game/session/:id`.  
  **Ожидаемый результат:** session создаётся; verified=true для валидной сессии; `proofUrl`/id доступны; server tolerance соблюдён.  
  **Edge cases:** tolerances — Orbit score delta до **±5**; Destroyer max score = duration*100; Gravity max score = duration*10; duplicate competitive reuse не допускается.

- [ ] **GAME-02. Начисление монет за игру**
  **Что тестируем:** `/api/game/coins` с обязательным `gameSessionId`.  
  **Предусловия:** есть verified session; баланс/лимиты сняты.  
  **Шаги:** 1) завершить игру; 2) получить coins; 3) сверить баланс, tx, daily limits.  
  **Ожидаемый результат:** без `gameSessionId` earn не проходит; unverified session отвергается; session wallet/gameMode must match; баланс растёт; `dailyRemaining` уменьшается.  
  **Edge cases:** дневной game cap = **2000/day holder**, **1000/day non-holder**; session allowance исчерпывается; `Delta exceeds maximum for game mode`; `Session coin allowance exhausted`.

- [ ] **GAME-03. Holder multiplier + staking boost**
  **Что тестируем:** влияние Identity holder perks и Vault boost на game earn.  
  **Предусловия:** один кошелёк-holder, второй non-holder; при необходимости активный stake bronze/silver/gold.  
  **Шаги:** 1) сыграть одинаковый сценарий на holder и non-holder; 2) сравнить payout; 3) повторить со stake.  
  **Ожидаемый результат:** holder multiplier для game coins = **2x**; staking boost применяется **после cap**; boost rates: bronze **+5%**, silver **+10%**, gold **+15%**.  
  **Edge cases:** cap должен считаться по normalized delta, а не по бустнутому payout.

- [ ] **GAME-04. Reuse запрет между competitive flows**
  **Что тестируем:** одноразовость competitive session.  
  **Предусловия:** 1 verified session.  
  **Шаги:** использовать одну и ту же session сначала для leaderboard, потом для arena/tournament; затем наоборот.  
  **Ожидаемый результат:** session нельзя повторно использовать в нескольких competitive сценариях.  
  **Edge cases:** `usedForLeaderboard`, `usedForChallenge`, `usedForTournament` должны блокировать reuse даже после refresh страницы.

- [ ] **GAME-05. Free revives**
  **Что тестируем:** perk free revives.  
  **Предусловия:** holder и non-holder; режим orbit/destroyer/gravity.  
  **Шаги:** запросить `/api/game/revives`, затем израсходовать revive до лимита.  
  **Ожидаемый результат:** holder eligible=true и максимум **3 free revives/day**; non-holder eligible=false или 403 на POST.  
  **Edge cases:** после исчерпания -> `No free revives left today`; invalid mode -> 400.

---

# 4. SYBIL SCAN

- [ ] **SYBIL-01. Базовый скан своего кошелька**
  **Что тестируем:** GET `/api/sybil/analysis`, отображение grade/risk/verdict, награда за clean scan.  
  **Предусловия:** JWT желательно валиден; кошелёк ещё не получал reward за scan в последний час.  
  **Шаги:** 1) открыть приложение; 2) дождаться scanning; 3) после перехода в hub проверить sybil grade; 4) сверить баланс и `/api/daily-limits`.  
  **Ожидаемый результат:** анализ возвращается; в Hub обновляется sybil grade; если cooldown открыт — начисляется **5 coins** за `scan_wallet`; `daily scan cap` растёт.  
  **Edge cases:** клиентский cooldown и серверный cooldown по clean scan — **1 час**; scan reward не должен дублироваться при reopen/reload.

- [ ] **SYBIL-02. Sybil Hunt bounty по flagged target**
  **Что тестируем:** переход reward path `scan_wallet` -> `sybil_hunt`.  
  **Предусловия:** есть адрес-цель с verdict `probable_sybil` или `confirmed_sybil`; скан уже выполнен.  
  **Шаги:** 1) проанализировать target; 2) claim bounty; 3) проверить баланс, tx, daily limits.  
  **Ожидаемый результат:** clean target не даёт bounty; flagged target требует `sybil_hunt`; self-bounty запрещён; первая bounty = **20**, затем бонусы: 3-й catch **30**, 10-й **40**, 20-й **50**, 50-й+ **70**.  
  **Edge cases:** bounty за один target — только один раз; self target -> error; target без свежего анализа -> reject.

- [ ] **SYBIL-03. Freshness / TTL / rescan**
  **Что тестируем:** freshness sybil cache и повторное вычисление composite после скана.  
  **Предусловия:** кошелёк с уже сохранённым analysis.  
  **Шаги:** 1) запросить analysis повторно в пределах TTL; 2) подождать expiry/эмулировать новый tx activity; 3) сделать новый scan; 4) открыть Hub.  
  **Ожидаемый результат:** own-wallet cache TTL = **2h**; адреса с `txCount >=100` — до **6h**; `txCount >1000` — до **24h**; после нового анализа composite и passport breakdown обновляются.  
  **Edge cases:** in-flight dedup должен не запускать 2 параллельных анализа на один адрес; >5 новых analyses/min/IP -> 429.

- [ ] **SYBIL-04. Границы verdict и recovery influence**
  **Что тестируем:** корректность verdict/rewardPath для разных risk profiles.  
  **Предусловия:** набор адресов: clean, unknown/thin-data, cluster-linked, probable/confirmed sybil.  
  **Шаги:** поочерёдно прогнать scan этих адресов и сверить UI + API.  
  **Ожидаемый результат:** `rewardPath` = `sybil_hunt` только для `probable_sybil` / `confirmed_sybil`; остальные идут по `scan_wallet`.  
  **Edge cases:** very-thin-data wallet не должен внезапно стать bounty-eligible; clean wallet с высоким trust не должен скрывать badges.

---

# 5. ARENA — отдельная секция W1/W2

## Роли
- **W1** = creator
- **W2** = acceptor/opponent

- [ ] **ARENA-01. Score challenge: create -> accept -> auto-settle**
  **Что тестируем:** полный fast-path score challenge.  
  **Предусловия:** W1 и W2 авторизованы; у обоих достаточно PRISM; challenge type=`score`.  
  **Шаги:** 1) W1 создаёт challenge со stake; 2) W2 открывает list и принимает; 3) система подтягивает composite score W1/W2; 4) проверить итоговый статус.  
  **Ожидаемый результат:** W1 stake списан при create; W2 stake списан при accept; challenge авто-завершается сразу после accept; winner получает `stake*2*(1-0.10)`; loser получает loss; при tie оба stake возвращаются.  
  **Edge cases:** stake диапазон **5..1000**; challenge expiry только из списка **15/30/60/180/360/720/1440 min**; accept parallel -> `Accept in progress`/409.

- [ ] **ARENA-02. Game challenge: create -> start -> submit score -> settle**
  **Что тестируем:** P2P game challenge с двумя submit.  
  **Предусловия:** W1/W2 авторизованы; есть `type=game`; creator сначала должен сыграть и задать `creatorScore`; mode orbit/destroyer/gravity.  
  **Шаги:** 1) W1 создаёт game challenge; 2) W1 играет и публикует creator score; 3) W2 принимает; 4) W1/W2 жмут start; 5) оба сабмитят score; 6) проверить settle.  
  **Ожидаемый результат:** до creator score challenge не ready; после двух submit challenge -> completed; winner получает `stake*2*0.95`; fee 5% burn.  
  **Edge cases:** без proof score > **30** запрещён; с proof score должен совпадать с session в пределах **±5**; wrong gameMode/session reuse -> reject.

- [ ] **ARENA-03. Tie**
  **Что тестируем:** возврат ставок при равном результате.  
  **Предусловия:** challenge в режиме score или game; у W1/W2 равный final score.  
  **Шаги:** провести матч/авто-compare так, чтобы scores были равны.  
  **Ожидаемый результат:** `winner=null`; обе ставки возвращены; challenge завершён как completed/tie.  
  **Edge cases:** tie не должен начислять win/loss notification; fee не должен сгореть при tie.

- [ ] **ARENA-04. Cancel open challenge**
  **Что тестируем:** creator cancel до начала матча.  
  **Предусловия:** W1 создал challenge; W2 ещё не принял.  
  **Шаги:** W1 жмёт cancel.  
  **Ожидаемый результат:** status=cancelled; creator получает refund; fee на cancel = **10%**, а если уже был `creatorScore != null` — **20%**.  
  **Edge cases:** cancel после accept/playing запрещён; не creator -> 403.

- [ ] **ARENA-05. Abandon**
  **Что тестируем:** abandon открытого/ещё не сыгранного challenge.  
  **Предусловия:** challenge open либо playing, но **без submit score**.  
  **Шаги:** W1 или W2 жмёт abandon.  
  **Ожидаемый результат:** stakes возвращены; status=cancelled.  
  **Edge cases:** если уже есть хотя бы один submitted score -> abandon запрещён; для open challenge abandon доступен только creator.

- [ ] **ARENA-06. Timeout / expire**
  **Что тестируем:** авто-expire по scheduler.  
  **Предусловия:** открытый challenge с близким `expiresAt`; либо playing without opponent; либо застрявший accepted/playing.  
  **Шаги:** 1) создать short-expiry challenge; 2) не принимать; 3) дождаться expire; 4) отдельно оставить challenge зависшим >24h.  
  **Ожидаемый результат:** open/playing без opponent -> expired + refund creator; stuck accepted/playing >24h safety-resolve: либо completed по имеющимся scores, либо expired с refund.  
  **Edge cases:** timeout должен слать `challenge_expired` notification; старые completed/cancelled/expired чистятся scheduler’ом.

- [ ] **ARENA-07. Уведомления и weekly leaderboard**
  **Что тестируем:** уведомления и weekly ranking.  
  **Предусловия:** минимум 3 завершённых challenge за неделю для одного wallet.  
  **Шаги:** 1) выиграть challenge; 2) проверить win/loss inbox; 3) сыграть >=3 матча; 4) открыть `/api/challenge/leaderboard`.  
  **Ожидаемый результат:** leaderboard weekly ранжирует только игроков с **minGames=3**; rewards top-10 = **[2000,1200,600,200,200,100,100,100,100,100]**, XP rewards top-3 = **[500,300,200]**.  
  **Edge cases:** reset недели — понедельник UTC; кеш/пересчёт не должен задваивать weekly rewards.

---

# 6. BLACK HOLE

- [ ] **BH-01. Verified close / burn / swap claim**
  **Что тестируем:** `/api/blackhole/claim` после реальных on-chain операций.  
  **Предусловия:** **реальный Seeker wallet**; есть пыльные fungible tokens, хотя бы один NFT, либо asset для swap/close; JWT валиден.  
  **Шаги:** 1) выполнить в UI операции close / burn / swap; 2) отправить claim; 3) сверить balance/tx/feed/daily-limits.  
  **Ожидаемый результат:** сервер верифицирует close tx, burn tx, swap tx; reward начисляется только после успешной проверки подписей/инструкций.  
  **Edge cases:** max **64 operations** в одном claim; дубликаты операций должны dedupe’иться; missing tx / unconfirmed tx -> reject.

- [ ] **BH-02. Reward formula**
  **Что тестируем:** формулу награды.  
  **Предусловия:** контролируемый набор операций.  
  **Шаги:** провести по отдельности: 1 fungible close, 1 NFT burn, cleanup с net SOL, смешанный набор.  
  **Ожидаемый результат:** reward = **8 за fungible**, **15 за NFT**, **8 за каждые 0.001 SOL netResolved**, hard cap **500 за claim/day-path**.  
  **Edge cases:** decimals=0 и amount=1 трактуется как NFT; decimals=0 и amount>1 уже fungible; итоговый credited reward дополнительно может умножаться на staking boost.

- [ ] **BH-03. Комиссия и holder perks**
  **Что тестируем:** проверку комиссии в treasury.  
  **Предусловия:** один holder wallet и один non-holder wallet.  
  **Шаги:** выполнить одинаковый cleanup на holder и non-holder.  
  **Ожидаемый результат:** standard commission = **10%** от reclaimed lamports; holder commission = **2%**; если treasury==wallet — bypass.  
  **Edge cases:** shortfall даже на 1 lamport должен валить claim; holder status берётся на старте claim.

- [ ] **BH-04. Replay protection**
  **Что тестируем:** anti-replay по сигнатурам.  
  **Предусловия:** уже успешно заклейменный набор tx signatures.  
  **Шаги:** повторить тот же claim сразу и после перезапуска сервера.  
  **Ожидаемый результат:** повторный claim падает как already claimed; защита должна жить и в памяти, и durable store.  
  **Edge cases:** если сервер умер после верификации, но до ответа, подписи не должны стать повторно-клеймимыми.

- [ ] **BH-05. Взаимодействие с daily caps**
  **Что тестируем:** black hole cap + non-game cap.  
  **Предусловия:** baseline limits сняты.  
  **Шаги:** 1) сделать claim на крупную сумму; 2) добить дневной лимит; 3) повторить claim.  
  **Ожидаемый результат:** black hole режется cap’ом **500/day** и ещё сверху non-game cap’ом; `/api/daily-limits` отражает рост blackHole earned.  
  **Edge cases:** в Hub Daily Limits table Black Hole может отображаться отдельно и требует отдельной сверки с API, а не только с UI.

---

# 7. FORGE / SHOP

- [ ] **FORGE-01. Успешная покупка обычного item**
  **Что тестируем:** покупку frame/aura/ship skin/title.  
  **Предусловия:** достаточно PRISM; item ещё не куплен.  
  **Шаги:** 1) открыть Shop; 2) выбрать item; 3) купить; 4) обновить страницу/вернуться в Hub.  
  **Ожидаемый результат:** баланс уменьшается ровно на цену item; tx пишется; item становится owned и доступен в loadout.  
  **Edge cases:** повторная покупка того же item должна падать; server-authoritative spend не должен зависеть от localStorage.

- [ ] **FORGE-02. Rank gate**
  **Что тестируем:** серверную проверку `requiredRank`.  
  **Предусловия:** один кошелёк ниже порога rank, другой на пороге/выше.  
  **Шаги:** попытаться купить gated item до и после достижения нужного ранга.  
  **Ожидаемый результат:** до порога сервер возвращает `Requires <rank> rank`; после порога покупка проходит.  
  **Edge cases:** UI может открыть кнопку раньше, но финальное решение — сервер; проверять после refresh и после `/api/xp`.

- [ ] **FORGE-03. Unlock condition + price mismatch**
  **Что тестируем:** unlock prerequisites и price validation.  
  **Предусловия:** выбран item с дополнительным unlock condition.  
  **Шаги:** 1) попытаться купить без unlock; 2) затем выполнить условие; 3) повторить покупку.  
  **Ожидаемый результат:** без unlock -> `Forge unlock condition not met`; неверная цена -> `Forge item price mismatch`; валидный путь списывает coins.  
  **Edge cases:** module purchase и обычный item идут по разным путям; module duplicate ownership запрещён.

---

# 8. VAULT

- [ ] **VAULT-01. Buy coins for SOL**
  **Что тестируем:** `/api/prism/buy` по валидному SOL transfer.  
  **Предусловия:** **реальный Seeker wallet**, достаточно SOL, JWT валиден.  
  **Шаги:** 1) открыть Vault; 2) выбрать пакет 5k/15k/50k/150k; 3) отправить SOL в treasury; 4) передать txSignature; 5) сверить баланс и daily purchase status.  
  **Ожидаемый результат:** пакет начисляется, если treasury transfer >= **99%** ожидаемой суммы; packages: **5000/0.015**, **15000/0.038**, **50000/0.11**, **150000/0.23**.  
  **Edge cases:** same tx reuse -> 400; pending verification -> 429; tx failed/not found -> reject.

- [ ] **VAULT-02. Buy coins for SKR**
  **Что тестируем:** `/api/prism/buy/skr`.  
  **Предусловия:** реальный Seeker wallet; достаточно SKR; quote получен.  
  **Шаги:** 1) запросить `/api/market/mint-quote` или buy quote; 2) перевести SKR `transferChecked`; 3) передать txSignature; 4) сверить баланс.  
  **Ожидаемый результат:** сервер верифицирует именно `transferChecked`, mint и treasury ATA; пакет начисляется.  
  **Edge cases:** обычный `transfer` без mint verification должен быть отклонён; treasury ATA может создаваться автоматически.

- [ ] **VAULT-03. Daily purchase limit**
  **Что тестируем:** лимит покупок монет в сутки.  
  **Предусловия:** baseline `/api/prism/buy/status`.  
  **Шаги:** покупать пакеты до упора.  
  **Ожидаемый результат:** суточный лимит = **300,000 coins/day**; `remainingToday` убывает; попытка превысить лимит даёт 400/429.  
  **Edge cases:** лимит должен считаться суммарно для SOL и SKR покупок; reset по UTC.

- [ ] **VAULT-04. Stake / claim / unstake**
  **Что тестируем:** основной staking flow.  
  **Предусловия:** достаточно PRISM; нет active stake.  
  **Шаги:** 1) сделать stake bronze/silver/gold; 2) дождаться accrual; 3) claim; 4) unstake.  
  **Ожидаемый результат:** min stake: bronze **10000**, silver **30000**, gold **75000**; max stake **500000**; claim начисляет yield; status показывает `boostRate`, `dailyYield`, `effectiveRate`.  
  **Edge cases:** only one active stake per wallet; concurrent stake/claim/unstake -> `Staking operation in progress`.

- [ ] **VAULT-05. Early withdrawal penalty**
  **Что тестируем:** штраф за досрочный unstake.  
  **Предусловия:** stake с lock 7/30/90/180 дней.  
  **Шаги:** сделать unstake до `lockEnd`.  
  **Ожидаемый результат:** penalty: **10% / 15% / 20% / 25%** соответственно; burned учитывается; yield до момента unstake всё равно считается и возвращается вместе с остатком.  
  **Edge cases:** after lockEnd penalty=0; no active stake -> 400.

---

# 9. QUESTS

- [ ] **QUESTS-01. Daily quest sync**
  **Что тестируем:** `/api/quest/sync` и серверную нормализацию квестов.  
  **Предусловия:** JWT валиден; выполнен daily_scan/daily_game/daily_burn/daily_explore/daily_highscore.  
  **Шаги:** выполнить действие, затем вызвать sync через UI; открыть progress.  
  **Ожидаемый результат:** сервер пересчитывает прогресс и completion по whitelist из 20 quest IDs; claimed для daily/weekly sticky только в пределах периода.  
  **Edge cases:** мусорные quest keys должны игнорироваться; client не должен сам выставлять claimed/completed в обход сервера.

- [ ] **QUESTS-02. Claim reward**
  **Что тестируем:** claim через `/api/prism/earn` для quest_daily / weekly / milestone.  
  **Предусловия:** quest completed на сервере.  
  **Шаги:** заклеймить daily, weekly и milestone reward.  
  **Ожидаемый результат:** reward’ы: daily **15**, weekly **50**, milestone **100**; второй claim в том же periodKey запрещён; tx/history/balance обновляются.  
  **Edge cases:** pendingQuestClaims должен защищать от двойного тапа; invalid questId для source -> 400.

- [ ] **QUESTS-03. Weekly streak**
  **Что тестируем:** 5-day streak logic.  
  **Предусловия:** возможность симулировать/дождаться 5 последовательных UTC-дней.  
  **Шаги:** в 5 последовательных дней выполнять хотя бы один daily quest; затем пропустить день.  
  **Ожидаемый результат:** `weekly_streak.progress` растёт до **5**, `completed=true` на 5-м; после пропуска streak сбрасывается.  
  **Edge cases:** повторный sync в тот же день не должен искусственно наращивать streak; граница yesterday/today по UTC.

- [ ] **QUESTS-04. One-time / text quest**
  **Что тестируем:** одноразовость `ot_*` и `text_quest`.  
  **Предусловия:** выбран валидный text quest id.  
  **Шаги:** пройти text quest и заклеймить reward; повторить.  
  **Ожидаемый результат:** первый claim проходит, повторный — `Quest reward already claimed`; валидны только заранее разрешённые text quest IDs.  
  **Edge cases:** перезагрузка/перелогин не должна позволять re-claim.

---

# 10. QUIZ

- [ ] **QUIZ-01. Получение вопроса**
  **Что тестируем:** `/api/quiz/question`.  
  **Предусловия:** сеть стабильна.  
  **Шаги:** запросить вопрос несколько раз с интервалом.  
  **Ожидаемый результат:** приходит `id`, `question`, `options`, `category`, `difficulty`; вопрос живёт **60 секунд**.  
  **Edge cases:** >10 запросов за 5 секунд/IP -> 429; варианты должны перемешиваться.

- [ ] **QUIZ-02. Правильный ответ**
  **Что тестируем:** `/api/quiz/answer` с reward.  
  **Предусловия:** валидный JWT; baseline limits снят.  
  **Шаги:** ответить правильно в пределах TTL.  
  **Ожидаемый результат:** `correct=true`, `earned=5`; баланс, tx, `daily-limits.quiz` и `nonGame` увеличиваются.  
  **Edge cases:** reward не должен выдаваться, если `dailyQuizCap` исчерпан или non-game cap не позволяет.

- [ ] **QUIZ-03. Неправильный / истёкший / повторный ответ**
  **Что тестируем:** отрицательные ветки quiz.  
  **Предусловия:** получен question id.  
  **Шаги:** 1) ответить неверно; 2) попробовать тем же id повторно; 3) дождаться >60 сек и ответить.  
  **Ожидаемый результат:** неверный ответ -> `correct=false`, `earned=0`; повторно тот же id не работает; expired -> `Time expired` / `Question expired or invalid`.  
  **Edge cases:** answer rate limit — **10 ответов/3 сек**; invalid body/address mismatch -> error.

---

# 11. NFT MINT

- [ ] **NFT-01. Mint for SOL**
  **Что тестируем:** полный SOL mint flow.  
  **Предусловия:** **реальный Seeker wallet**, есть traits/score, достаточно SOL, metadata service и core mint backend доступны.  
  **Шаги:** 1) открыть карточку; 2) выбрать SOL; 3) нажать `MINT · 0.03 SOL`; 4) подписать tx; 5) дождаться finalize.  
  **Ожидаемый результат:** metadata загружается, `/mint-cnft` prepare+finalize проходят, NFT появляется в кошельке, toast `Identity minted!`, wallet помечается как minted, composite server-side recompute вызывается.  
  **Edge cases:** preflight требует SOL на цену + fee buffer; client min required ~ не меньше **0.02 SOL**, а фактически для mint — цена **0.03 SOL** + fee; simulation failure должен показывать понятную ошибку.

- [ ] **NFT-02. Mint for Coins**
  **Что тестируем:** reservation + finalize без раннего burn coins.  
  **Предусловия:** реальный Seeker wallet; минимум **10,000 PRISM**; JWT валиден.  
  **Шаги:** 1) выбрать `COINS`; 2) запустить mint; 3) проверить баланс до finalize; 4) завершить mint; 5) сверить tx/history.  
  **Ожидаемый результат:** `/api/prism/mint-for-coins` только резервирует слот на **10 минут**; coins списываются **только на finalize**; после успешного finalize появляется spend tx `mint_for_coins`.  
  **Edge cases:** повторный `mint-for-coins` в течение TTL должен быть idempotent и вернуть существующий reservation; если finalize не случился — coins не сгорают.

- [ ] **NFT-03. Remint**
  **Что тестируем:** burn старой карты + новый mint.  
  **Предусловия:** у wallet уже есть Identity Prism NFT; лучше Core asset.  
  **Шаги:** 1) инициировать remint; 2) убедиться, что backend проверяет burnSignature; 3) подписать tx; 4) проверить новый asset.  
  **Ожидаемый результат:** remint требует валидный `burnSignature`; burn tx должен быть finalized и подписан тем же wallet; после remint счётчик remints увеличивается.  
  **Edge cases:** если burnAssetId не совпадает с tx, fee payer не совпадает с JWT wallet, burn tx has err — remint отвергается.

- [ ] **NFT-04. Update Card**
  **Что тестируем:** in-place update существующего Core NFT.  
  **Предусловия:** уже есть mpl-core Identity Prism NFT; real Seeker wallet.  
  **Шаги:** 1) нажать `UPDATE CARD · 0.0005 SOL`; 2) подписать tx; 3) дождаться finalize; 4) проверить обновление metadata URI/name/image.  
  **Ожидаемый результат:** backend сначала готовит tx, затем дозаписывает подпись collection authority и сабмитит; toast `Card updated!`; assetId остаётся тем же.  
  **Edge cases:** update работает только для **MplCoreAsset**; asset not owned by wallet -> 403; body >2MB -> 413.

- [ ] **NFT-05. User cancel / dismiss wallet sheet**
  **Что тестируем:** мобильную обработку закрытия approval dialog в Seeker.  
  **Предусловия:** real Seeker wallet.  
  **Шаги:** во время mint/update свайпнуть/закрыть wallet approval вместо approve.  
  **Ожидаемый результат:** приложение возвращается в foreground, спиннер сбрасывается, показывается `Transaction cancelled`/`Update cancelled`; зависшего состояния нет.  
  **Edge cases:** hard timeout в mint flow не должен оставлять UI в `minting` навсегда.

---

# 12. RANKS / TIERS

- [ ] **RANK-01. Composite tier thresholds**
  **Что тестируем:** переходы tier по composite score.  
  **Предусловия:** набор кошельков/состояний на границах score.  
  **Шаги:** добиться score вблизи порогов 99/219/349/479/599/699/799/879/949.  
  **Ожидаемый результат:** tiers: `mercury` <=99, `mars` <=219, `venus` <=349, `earth` <=479, `neptune` <=599, `uranus` <=699, `saturn` <=799, `jupiter` <=879, `sun` <=949, `binary_sun` >949.  
  **Edge cases:** не путать это с legacy tier-логикой score-history (`dwarf_star/neutron_star/pulsar`) — если UI/history расходятся, это отдельный баг.

- [ ] **RANK-02. Ranger XP / rank**
  **Что тестируем:** `/api/xp` и progression, влияющий на Forge rank gate.  
  **Предусловия:** baseline XP известен.  
  **Шаги:** пройти игры/quests/arena и сверить `/api/xp` до/после.  
  **Ожидаемый результат:** rank растёт вместе с computedXP; forge server gate начинает пропускать покупки после достижения нужного ранга.  
  **Edge cases:** refresh/relogin не должен откатывать XP; purchase должен опираться на серверный snapshot, а не на UI.

---

# 13. LEADERBOARD

- [ ] **LB-01. Валидный submit**
  **Что тестируем:** `/api/game/leaderboard` POST.  
  **Предусловия:** verified game session, JWT валиден.  
  **Шаги:** 1) сыграть матч; 2) отправить score с `gameSessionId`; 3) открыть leaderboard.  
  **Ожидаемый результат:** score принимается, entry попадает в leaderboard, `usedForLeaderboard` проставляется.  
  **Edge cases:** `score` должен совпадать с session proof в пределах **±5**.

- [ ] **LB-02. Невалидный submit**
  **Что тестируем:** защита leaderboard.  
  **Предусловия:** есть невалидные комбинации: wrong session, wrong gameType, reused session.  
  **Шаги:** сабмитить с mismatched `gameType`, reused `gameSessionId`, score выше лимита.  
  **Ожидаемый результат:** reject с понятной ошибкой; max scores: orbit **600**, gravity **600**, destroyer **9999**.  
  **Edge cases:** unverified session, чужой wallet, missing gameSessionId должны блокироваться.

- [ ] **LB-03. GET leaderboard**
  **Что тестируем:** чтение таблицы лидеров.  
  **Предусловия:** есть несколько записей.  
  **Шаги:** открыть общий leaderboard и фильтр по gameType несколько раз подряд.  
  **Ожидаемый результат:** возвращается максимум **50** entries; кеш на один gameType около **10 секунд**.  
  **Edge cases:** в пределах кеша недавний submit может не отобразиться мгновенно; это не должно ломать final consistency.

---

# 14. COMPOSITE SCORE

- [ ] **COMP-01. Breakdown maxes**
  **Что тестируем:** структуру composite breakdown.  
  **Предусловия:** есть кошельки с разной активностью.  
  **Шаги:** сравнить UI passport breakdown и публичный reputation/composite response.  
  **Ожидаемый результат:** max по компонентам: onchain **400**, sybilTrust **250**, humanProof **150**, social **100**, engagement **100**, total **1000**.  
  **Edge cases:** score не должен превысить 1000; overflow по badge bonuses должен быть ограничен caps компонента.

- [ ] **COMP-02. Recompute after scan / action**
  **Что тестируем:** автоматический пересчёт после действий.  
  **Предусловия:** открыт Hub.  
  **Шаги:** 1) выполнить новый sybil scan; 2) завершить quest/arena/game; 3) вернуться в Hub; 4) сравнить passport breakdown и tier.  
  **Ожидаемый результат:** sybil grade fetch вызывает refetch composite; после actions passport score/tier/breakdown обновляются без “ручного кеш-удара”.  
  **Edge cases:** stale cache не должен держать старый score после успешного server-side recompute слишком долго.

- [ ] **COMP-03. Badge-sensitive trust rules**
  **Что тестируем:** влияние verdict на badges и effective trust.  
  **Предусловия:** адреса с verdict clean / unknown / cluster / probable / confirmed.  
  **Шаги:** открыть breakdown и сравнить effective trust/badge eligibility.  
  **Ожидаемый результат:** clean может получать sybil badges; `confirmed_sybil/probable/cluster/unknown` badge eligibility режется; effective trust ограничивается правилами verdict.  
  **Edge cases:** confirmed sybil не должен получать recovery badge uplift.

---

# 15. RECOVERY (Improve Sybil Score)

- [ ] **RECOVERY-01. Точка входа**
  **Что тестируем:** появление recovery CTA.  
  **Предусловия:** кошелёк с sybil grade `D` или `F`.  
  **Шаги:** открыть Hub passport.  
  **Ожидаемый результат:** рядом с Sybil Grade появляется ссылка **Improve Score -> /recovery**.  
  **Edge cases:** для хороших grade CTA не должен показываться; после улучшения grade CTA может исчезнуть.

- [ ] **RECOVERY-02. Применение recovery bonuses**
  **Что тестируем:** влияние recovery flow на effective trust.  
  **Предусловия:** recovery page/flow доступен; есть способ добавить `twitterBonus`, `activityBonus`, `crossVerifBonus`.  
  **Шаги:** 1) выполнить recovery actions; 2) инициировать rescan/refresh composite; 3) сравнить sybilTrust до/после.  
  **Ожидаемый результат:** recovery влияет не на rawTrust, а на `effectiveTrust`; caps по verdict: clean **+25**, unknown **+10**, suspicious **+10**, cluster_linked **+6**, probable_sybil **+2**, confirmed_sybil **+0**.  
  **Edge cases:** бонусы не должны вытащить wallet выше разрешённого ceil verdict-правил.

- [ ] **RECOVERY-03. Recompute UX**
  **Что тестируем:** пользовательский флоу “улучшил -> увидел результат”.  
  **Предусловия:** recovery action завершён.  
  **Шаги:** вернуться в Hub, Inbox, reputation view.  
  **Ожидаемый результат:** новый sybil grade/composite passport виден после refresh/rescan; старое состояние не висит вечно.  
  **Edge cases:** если verdict = confirmed_sybil, UI не должен обещать recovery uplift, которого сервер не даст.

---

# 16. NOTIFICATIONS

- [ ] **NOTIF-01. Challenge notifications**
  **Что тестируем:** уведомления по arena.  
  **Предусловия:** W1/W2 играют challenge.  
  **Шаги:** завершить матч с win/loss, затем создать отдельный challenge и дать ему истечь.  
  **Ожидаемый результат:** winner получает `challenge_win`, loser — `challenge_loss`, creator/opponent при expire — `challenge_expired`.  
  **Edge cases:** unread badge в Hub опрашивается раз в **60 сек**, поэтому Inbox может обновиться раньше, чем badge.

- [ ] **NOTIF-02. Quest milestone notification**
  **Что тестируем:** notification после `quest_milestone`.  
  **Предусловия:** milestone quest completed.  
  **Шаги:** claim milestone reward и открыть Inbox.  
  **Ожидаемый результат:** появляется `quest_milestone`; unread count увеличивается.  
  **Edge cases:** duplicate claim не должен плодить дубликаты notifs.

- [ ] **NOTIF-03. Read / delete / unread-count**
  **Что тестируем:** inbox management.  
  **Предусловия:** есть непрочитанные уведомления.  
  **Шаги:** 1) запросить unread count; 2) открыть notifications; 3) mark single read; 4) mark all read; 5) delete one; 6) delete all.  
  **Ожидаемый результат:** count корректно уменьшается; `GET /api/notifications` требует JWT; `/api/notifications/unread-count` работает по адресу.  
  **Edge cases:** bulk ids и all=true должны вести себя одинаково предсказуемо; invalid JWT -> 401 на protected inbox routes.

---

# 17. RATE LIMITS

- [ ] **RL-01. AUTH limits**
  **Что тестируем:** auth anti-spam.  
  **Предусловия:** один IP, один или несколько wallet.  
  **Шаги:** быстро спамить challenge/token запросами.  
  **Ожидаемый результат:** challenge чаще чем раз в **3 сек/IP** -> 429; token exchange чаще чем раз в **5 сек/IP** -> 429.  
  **Edge cases:** после cooldown запрос должен снова проходить.

- [ ] **RL-02. EARN limits**
  **Что тестируем:** per-wallet и per-source лимиты на earn.  
  **Предусловия:** JWT валиден.  
  **Шаги:** вызвать earn 2 раза <2 сек и затем повторять один source до per-source cooldown.  
  **Ожидаемый результат:** глобальный wallet cooldown **2 сек**; per-source cooldowns из таблицы выше соблюдаются; daily caps режут payout.  
  **Edge cases:** verified reward path (`scan_wallet`, `sybil_hunt`) не должен проходить частично, если кап уже превышен.

- [ ] **RL-03. QUIZ / SYBIL / CONstellation / scam-check**
  **Что тестируем:** IP-based endpoint throttling.  
  **Предусловия:** один IP.  
  **Шаги:** быстро дергать `quiz/question`, `quiz/answer`, `sybil/analysis`, `sybil/batch`, `sybil/graph`, `scam-check`, constellation.  
  **Ожидаемый результат:** quiz question **10/5s**, quiz answer **10/3s**, sybil new analysis **5/min**, sybil batch **15s cooldown**, sybil graph **6s cooldown**, scam-check **10s cooldown**, constellation ~ **10s per address/IP**.  
  **Edge cases:** cached/in-flight sybil analysis не должен считать лишний rate-limited call.

- [ ] **RL-04. BUY / VAULT / ARENA concurrency**
  **Что тестируем:** гонки на конкурентных операциях.  
  **Предусловия:** один wallet, два быстрых нажатия.  
  **Шаги:** параллельно инициировать buy с одним tx, stake+claim, accept challenge 2 устройствами, submit one score twice.  
  **Ожидаемый результат:** `Transaction verification in progress`, `Staking operation in progress`, `Accept in progress`, `Submission in progress` или duplicate reject.  
  **Edge cases:** replay/duplicate не должен приводить к двойному credit/debit.

- [ ] **RL-05. Daily reset**
  **Что тестируем:** сброс всех дневных лимитов по UTC.  
  **Предусловия:** лимиты частично/полностью выбраны.  
  **Шаги:** проверить поведение до и после UTC midnight.  
  **Ожидаемый результат:** game, nonGame, hunt, scan, quiz, blackHole, daily purchase limit reset’ятся новым UTC-днём.  
  **Edge cases:** streak logic и quest periodKey должны правильно жить на границе суток/недели.

---

# 18. Приоритет прогона

- [ ] **P0:** AUTH, GAME session proof, ECONOMY caps, SYBIL SCAN, ARENA score/game, BLACK HOLE, NFT mint-for-SOL, mint-for-coins, Vault buy SOL/SKR.  
- [ ] **P1:** QUESTS, QUIZ, LEADERBOARD, COMPOSITE recompute, NOTIFICATIONS.  
- [ ] **P2:** RECOVERY caps, weekly arena rewards, revive perks, update-card/remint edge cases, legacy/modern tier consistency.

Если прогон делать по-настоящему “боевым” порядком, я бы шёл так: **AUTH -> scan -> game -> leaderboard -> arena -> forge -> vault -> black hole -> NFT mint/update -> quests/quiz -> notifications -> rate limits -> UTC reset checks**.


Changes   +0 -0
Requests  1 Premium (12m 31s)
Tokens    ↑ 4.5m • ↓ 84.3k • 4.0m (cached) • 12.2k (reasoning)
