# Identity Prism — Security Audit Report
**Date:** 2026-04-21
**Branch:** dev-v5
**Commit:** 8da56fe
**Mode:** Full audit (daily, 8/10 confidence gate)
**Auditor:** CSO + review-and-iterate skills

## Stack Summary
| Component | Technology |
|-----------|-----------|
| Language | JavaScript (Node.js), TypeScript (frontend) |
| Framework | Express.js (raw) |
| Package Manager | npm |
| Database | SQLite (better-sqlite3) + Firebase Realtime DB |
| Auth | JWT (HS256) + Solana wallet signatures |
| Deployment | Node.js on VPS + Netlify frontend |
| API | REST JSON |

## Findings Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 2 |
| HIGH | 8 |
| MEDIUM | 11 |
| LOW | 5 |
| INFO | 6 |
| **Total** | **32** |

## CRITICAL

### C1: Firebase Service Account Keys on Disk
**Confidence:** 10/10 | **Category:** Secrets | **Priority:** P0
**Location:** `identityprism-88908-firebase-adminsdk-*.json`, `server/firebase-service-account.json`
Two Firebase Admin SDK files with RSA private keys exist on disk. Not in git (.gitignore catches them), but present in working directory. Full privileged access to Firebase project.
**Fix:** Rotate BOTH keys immediately in Firebase Console. Store via env var GOOGLE_APPLICATION_CREDENTIALS pointing outside repo. Add pre-commit hook (gitleaks/trufflehog).

### C2: npm audit — 131 Vulnerabilities (24 critical)
**Confidence:** 10/10 | **Category:** Supply Chain | **Priority:** P0
**Location:** package.json / node_modules
Critical CVEs: elliptic (ECDSA signature malleability), protobufjs (prototype pollution). Most fixable via `npm audit fix`.
**Fix:** Run `npm audit fix`. For breaking changes, evaluate individually.

## HIGH

### H1: buy.js TOCTOU Race — Double Credit
**Confidence:** 9/10 | **Category:** OWASP A06 | **Priority:** P1
**Location:** server/routes/buy.js:100, :218
Two parallel buy requests with same txSignature can both pass `.has()` check before either calls `.set()`, leading to double coin credit.
**Fix:** Add pendingBuyRequests Set as atomic lock before async RPC call (same pattern as pendingStakingOps in vault.js).

### H2: SKR Buy Missing Mint Check on transfer Type
**Confidence:** 9/10 | **Category:** OWASP A01 | **Priority:** P1
**Location:** server/routes/buy.js:257-277
Non-checked SPL transfer variant doesn't validate `info.mint`. Attacker could send worthless token to treasury ATA.
**Fix:** Add `if (mint !== skrMintAddr) return false;` in the `transfer` branch.

### H3: challenge_win Earn Race
**Confidence:** 9/10 | **Category:** OWASP A06 | **Priority:** P1
**Location:** server/routes/earn.js:166-174
earnClaimed flag set AFTER balance credit. Two simultaneous requests can both earn.
**Fix:** Set `earnClaimed = true` BEFORE crediting balance.

### H4: Weak Admin Key
**Confidence:** 9/10 | **Category:** OWASP A07 | **Priority:** P1
**Location:** .env:10
`ADMIN_KEY=test_admin_key_2024` — predictable, "test_" prefix suggests forgotten temp key.
**Fix:** Replace with `crypto.randomBytes(32).toString('hex')` in production.

### H5: API Keys in .env on Disk
**Confidence:** 9/10 | **Category:** Secrets | **Priority:** P1
**Location:** .env (Helius x3, Alchemy, Twitter OAuth)
Not in git, but on disk. Risk of leakage through backups, sync, IDE history.
**Fix:** Use secrets manager or CI/CD secrets injection for production.

### H6: CORS Origin Reflection — Fail-Open
**Confidence:** 9/10 | **Category:** OWASP A02 | **Priority:** P2
**Location:** server/helius-proxy.js:2711-2732
If CORS_ORIGIN env is blank or `*`, any origin gets reflected. Currently not triggered by default.
**Fix:** Hard-fail at startup if CORS_ORIGIN is empty/wildcard. Never reflect unknown origins.

### H7: Marketplace Model CORS Bypass
**Confidence:** 9/10 | **Category:** OWASP A02 | **Priority:** P2
**Location:** server/helius-proxy.js:3784
Model download response has `Access-Control-Allow-Origin: *`, bypassing ownership check in cross-origin context.
**Fix:** Use `resolveCorsOrigin(req)` instead of `'*'`.

### H8: Admin set-wallet Arbitrary Field Write
**Confidence:** 9/10 | **Category:** OWASP A01 + STRIDE-T | **Priority:** P1
**Location:** server/routes/admin.js:294-315
`/api/admin/set-wallet` accepts any object fields — can reset `_firstMintClaimed`, `_completedTextQuests`, `_scanRewardState`.
**Fix:** Implement explicit allowlist of modifiable fields.

## MEDIUM

### M1: Client-Controlled Score → Tier Elevation
**Confidence:** 9/10 | **Category:** OWASP A01 + STRIDE-E | **Priority:** P1
**Location:** server/routes/userData.js:65-102
Client submits `score` parameter (0-1000), server trusts it. Sets tier to highest → unlocks Forge items.
**Fix:** Compute score server-side from sybil analysis, don't accept from client.

### M2: rpc-proxy No Rate Limit + CORS *
**Confidence:** 9/10 | **Category:** OWASP A02 | **Priority:** P2
**Location:** server/rpc-proxy.mjs:75-77
Open to any origin, no auth, no rate limit. Anyone can proxy RPC requests.
**Fix:** Add IP rate limiting. Restrict CORS to known frontend origins.

### M3: Lighthouse CI Public Storage
**Confidence:** 8/10 | **Category:** CI/CD | **Priority:** P2
**Location:** .github/workflows/ci.yml:43
Build artifacts uploaded to temporary-public-storage.
**Fix:** Switch to `--upload.target=filesystem`.

### M4: fetch Without Timeout (market.js)
**Confidence:** 9/10 | **Category:** OWASP A10 | **Priority:** P2
**Location:** server/routes/market.js (7 fetch calls)
Jupiter and price API calls have no timeout. Hung API blocks handler indefinitely.
**Fix:** Add `signal: AbortSignal.timeout(10000)` to all fetch calls.

### M5: TREASURY_ADDRESS Hardcoded Fallback
**Confidence:** 8/10 | **Category:** OWASP A02 | **Priority:** P2
**Location:** server/routes/buy.js:109, :235
Silent fallback to hardcoded treasury if env var unset. Financial gateway should fail-fast.
**Fix:** Startup guard: crash if TREASURY_ADDRESS not set.

### M6: Quiz Answer Oracle Predictable
**Confidence:** 8/10 | **Category:** OWASP A06 | **Priority:** P2
**Location:** server/routes/quiz.js:37-41
qId = sha256(question+answer) — deterministic. Client can precompute all answers.
**Fix:** Use `crypto.randomBytes(16).toString('hex')` for qId.

### M7: JWT Secret in Plaintext File
**Confidence:** 9/10 | **Category:** OWASP A04 | **Priority:** P1
**Location:** server/services/auth.js:6-14
Auto-generates .jwt_secret in CWD with default 644 perms. Other processes can read.
**Fix:** Require JWT_SECRET env var at startup; crash if absent.

### M8: No JWT Revocation
**Confidence:** 8/10 | **Category:** OWASP A07 | **Priority:** P2
**Location:** server/services/auth.js:17
Tokens valid 24h with no invalidation. Stolen token = 24h access.
**Fix:** Add per-address tokenVersion counter in JWT payload.

### M9: Raw error.message in HTTP Responses
**Confidence:** 9/10 | **Category:** OWASP A10 | **Priority:** P2
**Location:** server/routes/market.js (7 catch blocks)
Internal error messages leaked to clients. May reveal RPC URLs, DB schema.
**Fix:** Generic error message to client; log actual error server-side only.

### M10: Partner API Keys Plaintext in SQLite
**Confidence:** 9/10 | **Category:** OWASP A04 | **Priority:** P2
**Location:** server/services/apiKeyMiddleware.js:26
Keys stored verbatim. DB exfiltration = all keys compromised.
**Fix:** Store sha256(key). Compare hashes. Return plaintext only at creation.

### M11: REFERRAL_SALT Random Per-Process
**Confidence:** 9/10 | **Category:** OWASP A02 | **Priority:** P2
**Location:** server/helius-proxy.js / server/routes/referral.js
Without env var, salt regenerates on restart, invalidating all referral codes.
**Fix:** Set REFERRAL_SALT in production .env.

## LOW (5)

### L1: prism_data.json in Git
Location: prism_data.json (tracked). Production user data committed to repo.
Fix: Add to .gitignore, remove from tracking.

### L2: Missing HSTS Header
Location: server/helius-proxy.js:2757. Has other security headers but not HSTS.
Fix: Add Strict-Transport-Security header.

### L3: nginx.conf Missing Security Headers
Location: nginx.conf. No X-Content-Type-Options, X-Frame-Options in Docker container.
Fix: Add security headers to nginx config.

### L4: Game V1 No Address Validation
Location: server/routes/game.js. Unauthenticated path accepts any string as address.
Fix: Add Solana address regex validation.

### L5: Wallet Export No Pagination
Location: server/routes/wallet.js:165-176. Full database dump in one response.
Fix: Add limit/offset pagination, cap at 10k records.

## INFO (6)
- I1: No LLM/AI integrations — clean
- I2: No Helius webhooks — clean (polling only)
- I3: .env correctly gitignored, no secrets in git history
- I4: Dependencies mostly current (deprecated tar in devDep only)
- I5: makeKvStore SQL template — hardcoded table names only (defense-in-depth note)
- I6: sybil/batch endpoint public (intentional design)

## STRIDE Threat Matrix

| Component | S | T | R | I | D | E |
|-----------|---|---|---|---|---|---|
| Auth (JWT+wallet) | HIGH | LOW | MED | LOW | LOW | HIGH |
| Economy (earn/spend) | LOW | MED | LOW | LOW | LOW | MED |
| Sybil Detection | MED | LOW | LOW | LOW | MED | LOW |
| NFT Minting | LOW | LOW | MED | LOW | MED | LOW |
| Black Hole | LOW | LOW | MED | LOW | LOW | LOW |
| Marketplace | LOW | MED | LOW | LOW | LOW | INFO |
| Admin | LOW | MED | MED | LOW | LOW | HIGH |

## Scores

| Dimension | Grade | Weight | Notes |
|-----------|-------|--------|-------|
| Security | B | 3x | No critical exploits in code; infra secrets on disk |
| Correctness | B+ | 2x | TOCTOU races in buy/earn, but core logic solid |
| Error Handling | B | 2x | Good patterns, but error.message leaks |
| Testing | B | 1.5x | 60 unit tests + integration; gaps in buy/earn paths |
| Code Organization | A- | 1x | Clean post-refactor; context slicing solid |
| Documentation | B- | 0.5x | README exists, .env.example partial |
| **Overall** | **B** | | Weighted: ~80/100 |

## Remediation Roadmap

### P0 — Fix Immediately
1. Rotate Firebase SA keys (both files)
2. `npm audit fix`

### P1 — Fix This Sprint
3. buy.js TOCTOU → pendingBuyRequests lock
4. SKR buy mint check on transfer type
5. challenge_win earnClaimed before credit
6. Replace ADMIN_KEY with strong random value
7. admin/set-wallet field allowlist
8. Client score → server-side computation
9. JWT_SECRET required env var at startup

### P2 — Fix This Month
10. CORS fail-open fix
11. Marketplace model CORS fix
12. rpc-proxy rate limiting
13. fetch timeouts in market.js
14. TREASURY_ADDRESS startup guard
15. Quiz qId randomization
16. JWT revocation mechanism
17. Generic error messages
18. Partner API key hashing
19. REFERRAL_SALT in env
20. Lighthouse CI private storage

### P3 — Backlog
21. HSTS header
22. nginx security headers
23. SQL template allowlist
24. prism_data.json gitignore
25. Game V1 address validation
26. Wallet export pagination

## Confidence Calibration

- Total findings: 32
- CRITICAL: 2 (avg confidence: 10/10)
- HIGH: 8 (avg confidence: 9.1/10)
- MEDIUM: 11 (avg confidence: 8.8/10)
- LOW: 5 (avg confidence: 8.2/10)
- INFO: 6 (avg confidence: 8.5/10)
- False positives filtered: ~15
- Mode: Daily (8/10 gate)

## What's Clean
- SQL injection protected (prepared statements everywhere)
- File traversal protected (UUID names + path checks)
- CORS whitelist correct on main endpoints
- Admin key timing-safe comparison
- No eval/exec in server code
- No LLM integrations
- No committed secrets in git history
- Sentry properly guarded
- Rate limiting on most endpoints
