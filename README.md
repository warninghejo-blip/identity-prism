# Identity Prism — Wallet Reputation & Activity on Solana

> **Your wallet tells a story. Identity Prism reads it.**

[![Solana Mobile](https://img.shields.io/badge/Platform-Solana%20Mobile-blue)](https://solanamobile.com/)
[![Built with Codex + GPT-5.6](https://img.shields.io/badge/Built%20with-Codex%20%2B%20GPT--5.6-black)](./HACKATHON.md)

**Live:** [identityprism.xyz](https://identityprism.xyz) · **Judge Demo (no wallet needed):** [identityprism.xyz/demo.apk](https://identityprism.xyz/demo.apk) · **Official mobile demo:** [YouTube](https://www.youtube.com/watch?v=jI_usQJ_P-E) · **Twitter:** [@Identity_Prism](https://x.com/Identity_Prism) · **Solana dApp Store:** `com.identityprism2.app`

---

## Current security model

Prism League sessions use server-issued tokens and server-side checks before scores or coin rewards are recorded. Paid revives require verification of the corresponding on-chain payment. These controls reduce client-side tampering; they are not a claim that every game action or identity signal is on-chain.

---

## What is Identity Prism?

Identity Prism analyzes public Solana wallet activity — transactions, holdings, NFTs, DeFi positions, and wallet age — together with server-recorded application activity. It produces a **base identity score**, a **composite reputation score**, a **celestial tier**, and **achievement badges**.

Actual product loop: a weak-scoring wallet can improve only through capped, verified gameplay and app activity. Playing earns off-chain **PRISM points**; PRISM can be spent on gameplay gear/modules and PvP or tournament entry and rewards. Purchased gear affects ship stats, but never base reputation or tier. PRISM is not presently an on-chain token, and future token conversion is not guaranteed.

The profile combines on-chain fundamentals with behavioral sybil signals and in-app activity. Integrators can query the available HTTP endpoints and make their own access or reward decisions; the result is not a guarantee about a person's identity.

### The problem
- Wallets are anonymous addresses — there's no quick way to assess trust or reputation.
- Airdrop farmers, sybil clusters, and low-quality accounts dilute ecosystems.
- dApps lack a standardized way to gate features or rewards based on on-chain behavior.

### The solution
1. **Base identity score (0–400)** — wallet fundamentals such as SOL, wallet age, transactions, NFTs, DeFi, and configured identity traits.
2. **Composite Reputation Score (0–1000)** — combines the five contribution categories described in [Scoring System](#scoring-system).
3. **Sybil Trust Grade & Risk** — behavioral and on-chain analysis returns trust/risk signals with a verdict and confidence level; it is evidence, not personhood verification.
4. **Celestial Tiers** — Mercury → Mars → Venus → Earth → Neptune → Uranus → Saturn → Jupiter → Sun, plus Binary Sun for the configured combo.
5. **Achievement Badges** — profile badges derived from wallet, gameplay, and community signals.
6. **Ranger XP and ship stats** — play and quests advance the XP track; purchased or unlocked equipment changes ship gameplay stats only, not base reputation or tier.

---

## Try the Demo (for judges)

No wallet, no signing, no setup:

1. Download the APK: **[identityprism.xyz/demo.apk](https://identityprism.xyz/demo.apk)**
2. Install it on an Android device and open the app.
3. Tap **"Try Demo (no wallet)"** on the landing screen.

This opens the full app, read-only, under a pre-populated demo identity — browse the reputation card, tiers, badges, Prism League, Vault, Arena, and Quests. Games run in Practice mode. Any signature action (mint, buy, stake, save-on-chain, paid revive, challenge stake, forge, quests, Black Hole) prompts you to connect a real wallet. A **DEMO** badge is shown at all times with a one-tap exit; connecting a real wallet clears demo mode automatically.

You can also just use the live web app at **[identityprism.xyz](https://identityprism.xyz)** with any Solana wallet (Phantom, Solflare, or Mobile Wallet Adapter on Seeker/Saga).

---

## OpenAI Build Week

The implemented game-economy hardening keeps money-affecting outcomes server-authoritative: rewards are computed on the server, session tokens are single-use, paid revives require verification of the on-chain payment, and score/coin settlement is atomic in SQLite. A metadata allowlist closes the unauthenticated system-JSON path, with focused anti-cheat tests covering these game flows.

MagicBlock boundary: a devnet RPC blockhash may provide session entropy or verification input, while games and settlement run on the app server, not on an Ephemeral Rollup. See [HACKATHON.md](./HACKATHON.md) for the implementation notes. These controls reduce client-side tampering; they are not proof of perfect security.

Live metrics use separate server and on-chain definitions. In particular, the public `idsMinted` counter is a unique recorded-wallet presence count, not cumulative mint transactions or the current NFT supply. See [Public metrics and on-chain inventory](./docs/METRICS.md) and reproduce the snapshot with `npm run metrics:verify`.

---

## Features

### 🌐 Reputation API
A JSON HTTP API is served from the main application origin:

```bash
# Current composite profile
GET https://identityprism.xyz/api/v2/reputation?address=<SOLANA_ADDRESS>

# Public v1 profile
GET https://identityprism.xyz/api/v1/reputation/<SOLANA_ADDRESS>

# Legacy identity profile
GET https://identityprism.xyz/api/reputation?address=<SOLANA_ADDRESS>

# Legacy comparison and batch routes
GET https://identityprism.xyz/api/reputation/compare?a=<ADDR_1>&b=<ADDR_2>
POST https://identityprism.xyz/api/reputation/batch
Body: { "addresses": ["addr1", "addr2"] }
```

The v2 response separates the on-chain identity pillar from the composite profile:

```json
{
  "version": "2.1",
  "address": "<SOLANA_ADDRESS>",
  "onchainScore": 0,
  "baseScore": 0,
  "baseTier": "mercury",
  "baseMaxScore": 400,
  "compositeScore": 0,
  "compositeTier": "mercury",
  "compositeMaxScore": 1000,
  "scoreBreakdown": { "onchain": 0, "sybilTrust": 0, "humanProof": 0, "social": 0, "engagement": 0 },
  "identity": { "score": 0, "maxScore": 400, "tier": "mercury", "badges": [], "badgeCount": 0 },
  "sybilAnalysis": null
}
```

Composite contribution maxima are `onchain` 400, `sybilTrust` 250, `humanProof` 150, `social` 100, and `engagement` 100. Public reputation responses expose explicit `baseScore`/`baseTier`/`baseMaxScore` and `compositeScore`/`compositeTier`/`compositeMaxScore` fields. For compatibility, `/api/v1/reputation/:address` keeps `score`/`tier` as composite aliases with `maxScore: 1000`; the legacy `/api/reputation`, batch, and compare routes keep `score`/`tier` as base identity aliases with `maxScore: 400`. Attest actions record that base identity score, not the five-pillar composite.

The available sybil and activity routes are `GET /api/sybil/analysis?address=...` (wallet session required), `POST /api/sybil/batch` (up to 20 addresses), and `GET /api/recovery/status?address=...`. Recovery is bounded by the current verdict; gameplay signals do not turn into an unlimited trust score.

### 🃏 Interactive 3D Identity Card
A Three.js / react-three-fiber celestial card that renders your wallet's identity as a planet — the higher your tier, the more impressive the celestial body. Cards flip to reveal detailed stats, badges, and score history.

### 🔗 Solana Blinks
Share your Identity Prism card directly in any Blink-compatible client (wallets, social feeds):
- **Share Card** — display your identity card as a Solana Action
- **Mint as NFT** — mint your identity card as an on-chain NFT (Metaplex Core)
- **Attest** — prepare an explicit user-signed score attestation

```
https://identityprism.xyz/api/actions/share?address=<YOUR_WALLET>
https://identityprism.xyz/api/actions/attest?address=<YOUR_WALLET>
```

### ⛓️ On-Chain Attestation
The attestation action can record a score on Solana through the **Memo Program** after the user reviews and signs it. Ordinary scans, tier changes, game sessions, and badges are not automatically attestations.

### 🎮 Prism League — server-verified arcade games
Browser-based game modes run inside the app and are scored **server-side**:

| Game | Description |
|---|---|
| **Orbit Survival** | Dodge asteroids, collect powerups, survive as long as possible. |
| **Cosmic Defender** | Top-down shooter — 4 sectors of enemies and bosses, auto-fire, powerups. |
| **Gravity Runner** | Tap to fly, collect crystals, dodge asteroid columns. |

Every run starts with a server-issued session token; the final score and coin reward are computed by the server from in-run telemetry, not only from client-reported values. Scores can appear on the global leaderboard, and Prism League also hosts recurring **tournaments** and **text-adventure "Quests"**.

### 🏦 Prism Vault
Stake Identity Prism assets and claim rewards over time, directly from the app (`/api/prism/vault/stake`, `/claim`, `/unstake`, `/status`).

### ⚔️ Prism Arena
Create and accept PvP challenges against other players — stake, compete head-to-head on a game mode, and settle automatically based on server-verified scores (`/api/challenge/create`, `/accept`, `/submit`, leaderboard).

### 🧭 Sybil Detection
**Sybil Hunt** / the Sybil checker analyzes a wallet's funding sources, transaction graph, and clustering signals to flag likely sybil behavior — with cluster views, circular-flow detection, and dark-pool/funding-source analysis exposed via API and UI.

### 🕳️ Black Hole
Batch-burn dust tokens and unwanted NFTs in a single transaction and reclaim the rent SOL locked in each account. Real-time price feeds protect valuable assets from accidental burning.

### 🔨 Stellar Forge
In-app crafting/upgrade surface for Identity Prism collectibles.

### ♻️ Update Card
Update your NFT metadata in place without burning the original (~0.0005 SOL), protected by a **Co-Sign Authority Guard** — the server co-signs the transaction to preserve collection integrity while keeping user sovereignty.

### 📱 Android App
Native Android app via Capacitor with Solana Mobile Wallet Adapter (Seed Vault) support, built for Seeker/Saga, published on the Solana dApp Store as `com.identityprism2.app`.

---

## Security & Anti-Cheat

The Prism League economy keeps money-affecting values under server control:

- **Server-authoritative economy** — coin rewards are computed server-side from verified play; the client-supplied coin delta is fully ignored, not just validated.
- **Single-use session tokens** — a game run is bound to a server-issued session token that can be redeemed exactly once (`server/routes/game.js`, `server/services/gameRules.js`).
- **On-chain payment verification for paid revives** — a paid revive (5 SKR) is only granted after the server verifies the actual on-chain transaction (`verifyPaidReviveTransaction` in `server/routes/game.js`).
- **Atomic settlement** — score/coin/revive state changes are committed atomically in SQLite so a run can't be partially credited or double-spent.
- **Metadata route allowlist** — closed an unauthenticated system-JSON file exposure in the metadata route (`server/routes/metadata.js`).
- **Anti-cheat test suite** — focused server tests cover the money-affecting game paths.

---

## Tech Stack

| Layer | Technologies |
|---|---|
| **Frontend** | React 18, TypeScript, Vite, Three.js (`@react-three/fiber`, `@react-three/drei`, `@react-three/postprocessing`), Tailwind CSS, shadcn/ui (Radix), Framer Motion |
| **Backend** | Node.js (custom HTTP server, no framework), `better-sqlite3`, Helius DAS API proxy, Metaplex Core / Umi |
| **Blockchain** | Solana (`@solana/web3.js`), Metaplex Core NFTs, SPL Tokens, Solana Actions (Blinks), SKR payments |
| **Gaming** | Server-issued sessions, server verification, Canvas/WebGL game engines |
| **Data / RPC** | Helius RPC + DAS (wallet holdings, NFTs, history) |
| **Mobile** | Capacitor (Android), Solana Mobile Wallet Adapter, Seed Vault, Solana dApp Store |
| **Observability** | Sentry (`@sentry/react`, `@sentry/node`), Firebase Analytics |
| **Testing** | Vitest, Testing Library |
| **Tooling** | Codex CLI (GPT-5.6) for the security hardening pass — see [HACKATHON.md](./HACKATHON.md) |

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│      Client — React + Vite + Three.js (Capacitor)    │
│  3D Identity Card · Prism League · Vault · Arena ·   │
│  Quests · Sybil Hunt · Black Hole                    │
└──────────────────────┬──────────────────────────────┘
                       │ HTTPS (nginx + Cloudflare)
┌──────────────────────▼──────────────────────────────┐
│         Backend — Node.js (helius-proxy), SQLite      │
│  Reputation · Sybil · Game/Anti-cheat · Vault ·       │
│  Arena · Quests · Blinks · Attestation · Tournament  │
└──────────────────────┬──────────────────────────────┘
                       │
        ┌──────────────┼───────────────────┐
        ▼              ▼                   ▼
┌──────────────┐ ┌──────────────┐  ┌────────────────┐
│ Solana        │ │ App server   │  │ Helius          │
│ mainnet       │ │ sessions and │  │ RPC + DAS       │
│ (Metaplex Core│ │ verification │  │ (holdings, NFTs,│
│  Memo, SKR/SOL│ │              │  │  tx history)    │
│  payments)    │ │              │  │                 │
└──────────────┘ └──────────────┘  └────────────────┘
```

---

## Scoring System

Identity Prism computes a **Composite Reputation Score (0–1000)** from five contribution categories. It is a product signal, not a proof of a person's identity:

| Pillar | Max | What it measures |
|---|---:|---|
| **On-chain identity** | 400 | Wallet fundamentals — SOL balance, wallet age, transaction count, token/NFT holdings, DeFi protocols, and special traits (OG, Whale, Collector, Seeker Genesis, Chapter 2 Preorder). |
| **Sybil trust** | 250 | Behavioral + on-chain sybil detection (funding graph, clustering, circular flows) → a **trust grade (A+ → F)** and **risk level (clean → critical)**. |
| **Human proof** | 150 | In-app Prism League game activity — scores, game diversity, achievements. |
| **Social** | 100 | Head-to-head Prism Arena challenges, tournaments, community. |
| **Engagement** | 100 | Quests completed, daily streaks, wallet scans. |
| **Composite total** | **1000** | |

The **on-chain identity** pillar (0–400) is a composite of wallet fundamentals and configured traits. It contributes to the celestial tier and profile badges. In-app activity contributes separate gameplay and engagement signals. Equipment can change ship stats in games; it does not change the base reputation score or tier.

### Recovery limits

Recovery activity is capped by the current sybil verdict and cannot raise effective trust above 50 for a low-trust profile. The current recovery caps are: Clean 25, Unknown/Suspicious 10, Cluster Linked 6, Probable Sybil 2, and Confirmed Sybil 0 trust points. The resulting trust contribution is part of the `sybilTrust` composite pillar (maximum 250).

### Tier mapping (by composite score)

| Tier | Composite Score |
|---|---|
| Mercury | 0–99 |
| Mars | 100–219 |
| Venus | 220–349 |
| Earth | 350–479 |
| Neptune | 480–599 |
| Uranus | 600–699 |
| Saturn | 700–799 |
| Jupiter | 800–879 |
| Sun | 880–949 |
| **Binary Sun** | 950+ (or the Seeker Genesis + Chapter 2 Preorder combo) |

---

## Repo Layout

```
src/                Client (React/Vite)
  pages/            IdentityHub, PrismLeague, PrismVault, PrismArena, QuestsPage,
                     SybilHunt / SybilCheckerPage, BlackHole, StellarForge,
                     Leaderboard, Compare, Verify, TrustRecovery, ...
  components/game/   OrbitSurvivalScene, AsteroidDestroyerScene, GravityRunnerScene
server/              Backend (Node.js + better-sqlite3)
  routes/            reputation, sybil, game, leaderboard, tournament, arena,
                     vault, quest, blackhole, blinks, buy/spend/earn, auth, metadata, ...
android/             Capacitor Android project (com.identityprism2.app)
dapp-store/          Solana dApp Store publishing assets
```

---

## Build & Run

### Frontend
```bash
npm install
npm run dev        # local dev server (Vite)
npm run build       # production build
npm run test         # vitest
```

### Backend
```bash
cd server
node helius-proxy.js
```

### Android
```bash
npm run build
npx cap sync android
cd android && ./gradlew assembleRelease
```

See `.env.example` for the backend environment variables used by a local deployment.

---

## Links

- **Live app:** [https://identityprism.xyz](https://identityprism.xyz)
- **Judge demo APK (no wallet):** [https://identityprism.xyz/demo.apk](https://identityprism.xyz/demo.apk)
- **Twitter:** [@Identity_Prism](https://x.com/Identity_Prism)
- **Reputation API example:** `https://identityprism.xyz/api/v2/reputation?address=<SOLANA_ADDRESS>`
- **Blink:** `solana-action:https://identityprism.xyz/api/actions/share`
- **Solana dApp Store:** `com.identityprism2.app`
- **Build Week write-up:** [HACKATHON.md](./HACKATHON.md)

---

## License

MIT
