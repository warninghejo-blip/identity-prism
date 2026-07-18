# Identity Prism — On-Chain Reputation & Identity Layer for Solana

> **Your wallet tells a story. Identity Prism reads it.**

[![Solana Mobile](https://img.shields.io/badge/Platform-Solana%20Mobile-blue)](https://solanamobile.com/)
[![MagicBlock](https://img.shields.io/badge/Powered%20by-MagicBlock-purple)](https://magicblock.gg/)
[![Built with Codex + GPT-5.6](https://img.shields.io/badge/Built%20with-Codex%20%2B%20GPT--5.6-black)](./HACKATHON.md)

**Live:** [identityprism.xyz](https://identityprism.xyz) · **Judge Demo (no wallet needed):** [identityprism.xyz/demo.apk](https://identityprism.xyz/demo.apk) · **Twitter:** [@Identity_Prism](https://x.com/Identity_Prism) · **Solana dApp Store:** `com.identityprism2.app`

---

## 🏆 OpenAI Build Week — Codex + GPT-5.6 as an adversarial security co-engineer

Identity Prism's in-app game economy (Prism League) was hardened during OpenAI Build Week using the **OpenAI Codex CLI running GPT-5.6** — not just as a code generator, but as an **adversarial security co-engineer** in a tight audit → spec → build → red-team loop:

- **Audited** the revive/coins/leaderboard flow and surfaced concrete exploits: client-controlled coin deltas, forgeable scores, and an unauthenticated metadata-file exposure.
- **Redesigned** the economy to be **server-authoritative** — client-supplied coin deltas are fully ignored; coins are derived from server-verified play.
- **Built** single-use MagicBlock session tokens, on-chain SKR payment verification for paid revives, and atomic SQLite settlement.
- **Red-teamed itself across 4 rounds**, each pass finding narrower bugs, until the money path was provably safe. Final result: **10/10 anti-cheat tests passing**, deployed to production (v2.0.2).

Full story, Codex session IDs, and code pointers → **[HACKATHON.md](./HACKATHON.md)**. Track: *Apps for Your Life.*

---

## What is Identity Prism?

Identity Prism is an **on-chain reputation and identity scoring system** built on Solana. It analyzes wallet activity — transactions, holdings, NFTs, DeFi positions, and wallet age — to produce a **reputation score**, **celestial tier**, and **achievement badges** that represent a user's true on-chain identity.

Unlike simple wallet trackers, Identity Prism turns raw blockchain data into a **composable reputation layer** — combining on-chain fundamentals with behavioral sybil detection — that dApps, DAOs, and social platforms can query via an API-first design to assess trust and engagement.

### The problem
- Wallets are anonymous addresses — there's no quick way to assess trust or reputation.
- Airdrop farmers, sybil clusters, and low-quality accounts dilute ecosystems.
- dApps lack a standardized way to gate features or rewards based on on-chain behavior.

### The solution
1. **Composite Reputation Score (0–1000)** — blends five signals: on-chain fundamentals (SOL, wallet age, tx count, NFTs, DeFi), sybil-resistance trust, and in-app activity (games, arena, quests). See [Scoring System](#scoring-system).
2. **Sybil Trust Grade & Risk** — behavioral + on-chain sybil detection yields a **trust grade (A+ → F)** and a **risk level (clean → critical)**, so a wallet's reputation reflects that it's *real*, not just wealthy.
3. **Celestial Tiers** — Mercury → Mars → Venus → Earth → Neptune → Uranus → Saturn → Jupiter → Sun, plus the rare **Binary Sun** (Seeker Genesis + Chapter 2 Preorder holders).
4. **Achievement Badges** — identity badges (OG, Whale, Collector, Titan, Maxi, Seeker, Visionary, Early Adopter) plus activity badges (Verified Human, Clean Record, Trust Pillar, Game Master, Arena Champion, and more).
5. **API-first design** — every wallet's reputation is available via a public REST API for integration into any dApp.

---

## Try the Demo (for judges)

No wallet, no signing, no setup:

1. Download the APK: **[identityprism.xyz/demo.apk](https://identityprism.xyz/demo.apk)**
2. Install it on an Android device and open the app.
3. Tap **"Try Demo (no wallet)"** on the landing screen.

This opens the full app, read-only, under a pre-populated demo identity — browse the reputation card, tiers, badges, Prism League, Vault, Arena, and Quests. Games run in Practice mode. Any signature action (mint, buy, stake, save-on-chain, paid revive, challenge stake, forge, quests, Black Hole) prompts you to connect a real wallet. A **DEMO** badge is shown at all times with a one-tap exit; connecting a real wallet clears demo mode automatically.

You can also just use the live web app at **[identityprism.xyz](https://identityprism.xyz)** with any Solana wallet (Phantom, Solflare, or Mobile Wallet Adapter on Seeker/Saga).

---

## Features

### 🌐 Reputation API
A public REST API to query any Solana wallet's reputation:

```bash
# Single wallet
GET https://identityprism.xyz/api/reputation?address=<SOLANA_ADDRESS>

# Compare two wallets
GET https://identityprism.xyz/api/reputation/compare?a=<ADDR_1>&b=<ADDR_2>

# Batch (up to 5 wallets)
POST https://identityprism.xyz/api/reputation/batch
Body: { "addresses": ["addr1", "addr2", ...] }
```

**Response** (fields match the real `/api/reputation` v2.1 payload; values illustrative):
```json
{
  "version": "2.1",
  "onchainScore": 172,
  "compositeScore": 640,
  "compositeTier": "uranus",
  "identity": { "score": 172, "tier": "earth", "badges": ["collector", "titan"], "badgeCount": 2 },
  "stats": { "solBalance": 4.2, "walletAgeDays": 810, "transactionCount": 3982, "tokenCount": 6, "nftCount": 11 },
  "sybilAnalysis": {
    "trustScore": 86, "trustGrade": "A",
    "riskScore": 8, "riskLevel": "clean",
    "verdict": "likely_human",
    "signalsDetected": 1, "totalSignals": 14
  }
}
```

### 🃏 Interactive 3D Identity Card
A Three.js / react-three-fiber celestial card that renders your wallet's identity as a planet — the higher your tier, the more impressive the celestial body. Cards flip to reveal detailed stats, badges, and score history.

### 🔗 Solana Blinks
Share your Identity Prism card directly in any Blink-compatible client (wallets, social feeds):
- **Share Card** — display your identity card as a Solana Action
- **Mint as NFT** — mint your identity card as an on-chain NFT (Metaplex Core)
- **Attest** — publish your score on-chain as a Blink

```
https://identityprism.xyz/api/actions/share?address=<YOUR_WALLET>
https://identityprism.xyz/api/actions/attest?address=<YOUR_WALLET>
```

### ⛓️ On-Chain Attestation
Record your reputation score permanently on Solana via the **Memo Program**. The attestation is co-signed by the Identity Prism authority, creating a verifiable, immutable proof any smart contract or dApp can check.

### 🎮 Prism League — server-verified arcade games
Three browser-based game modes running inside the app, each seeded via **MagicBlock** and scored **server-side**:

| Game | Description |
|---|---|
| **Orbit Survival** | Dodge asteroids, collect powerups, survive as long as possible. |
| **Cosmic Defender** | Top-down shooter — 4 sectors of enemies and bosses, auto-fire, powerups. |
| **Gravity Runner** | Tap to fly, collect crystals, dodge asteroid columns. |

Every run starts with a server-issued MagicBlock session token; the final score and coin reward are computed by the server from verified in-run telemetry, not from client-reported values. Scores land on a global leaderboard, and Prism League also hosts recurring **tournaments** and **text-adventure "Quests"** (branching story chapters, no reflexes required).

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

The Prism League economy is designed so that **the client is never trusted with money-affecting values**. This is the concrete Build Week deliverable (see [HACKATHON.md](./HACKATHON.md) for the full audit → build → red-team story):

- **Server-authoritative economy** — coin rewards are computed server-side from verified play; the client-supplied coin delta is fully ignored, not just validated.
- **Single-use session tokens** — every game run is bound to a server-issued MagicBlock session token that can be redeemed exactly once (`server/routes/game.js`, `server/services/gameRules.js`).
- **On-chain payment verification for paid revives** — a paid revive (5 SKR) is only granted after the server verifies the actual on-chain transaction (`verifyPaidReviveTransaction` in `server/routes/game.js`).
- **Atomic settlement** — score/coin/revive state changes are committed atomically in SQLite so a run can't be partially credited or double-spent.
- **Metadata route allowlist** — closed an unauthenticated system-JSON file exposure in the metadata route (`server/routes/metadata.js`).
- **Anti-cheat test suite** — `server/__tests__/game-anticheat.test.ts`, 10/10 passing.

---

## Tech Stack

| Layer | Technologies |
|---|---|
| **Frontend** | React 18, TypeScript, Vite, Three.js (`@react-three/fiber`, `@react-three/drei`, `@react-three/postprocessing`), Tailwind CSS, shadcn/ui (Radix), Framer Motion |
| **Backend** | Node.js (custom HTTP server, no framework), `better-sqlite3`, Helius DAS API proxy, Metaplex Core / Umi |
| **Blockchain** | Solana (`@solana/web3.js`), Metaplex Core NFTs, SPL Tokens, Solana Actions (Blinks), SKR payments |
| **Gaming** | MagicBlock Ephemeral Rollups (session seeding), Canvas/WebGL game engines |
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
│ Solana        │ │ MagicBlock   │  │ Helius          │
│ mainnet       │ │ Ephemeral    │  │ RPC + DAS       │
│ (Metaplex Core│ │ Rollups      │  │ (holdings, NFTs,│
│  Memo, SKR/SOL│ │ (game seeds) │  │  tx history)    │
│  payments)    │ │              │  │                 │
└──────────────┘ └──────────────┘  └────────────────┘
```

---

## Scoring System

Identity Prism computes a **Composite Reputation Score (0–1000)** that blends five independent signals — so a high score means a wallet is old **and** real **and** active, not just wealthy:

| Pillar | Max | What it measures |
|---|---:|---|
| **On-chain identity** | 400 | Wallet fundamentals — SOL balance, wallet age, transaction count, token/NFT holdings, DeFi protocols, and special traits (OG, Whale, Collector, Seeker Genesis, Chapter 2 Preorder). |
| **Sybil trust** | 250 | Behavioral + on-chain sybil detection (funding graph, clustering, circular flows) → a **trust grade (A+ → F)** and **risk level (clean → critical)**. |
| **Human proof** | 150 | In-app Prism League game activity — scores, game diversity, achievements. |
| **Social** | 100 | Head-to-head Prism Arena challenges, tournaments, community. |
| **Engagement** | 100 | Quests completed, daily streaks, wallet scans. |
| **Composite total** | **1000** | |

The **on-chain identity** pillar (0–400) is itself a composite of SOL balance, wallet age, tx count, token/NFT holdings, and DeFi exposure; it maps a wallet to a **celestial tier** and awards **identity badges** (OG, Whale, Collector, Titan, Maxi, Seeker, Visionary, Early Adopter, Binary). In-app activity unlocks further **badges** — Verified Human, Clean Record, Trust Pillar, Game Master, Arena Champion, Quest Hunter, Streak Lord, Explorer, and more.

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

See `.env.example` for required environment variables (Helius API keys, treasury address, public base URL, etc.).

---

## Links

- **Live app:** [https://identityprism.xyz](https://identityprism.xyz)
- **Judge demo APK (no wallet):** [https://identityprism.xyz/demo.apk](https://identityprism.xyz/demo.apk)
- **Twitter:** [@Identity_Prism](https://x.com/Identity_Prism)
- **Reputation API example:** [identityprism.xyz/api/reputation?address=...](https://identityprism.xyz/api/reputation?address=vines1vzrYbzLMRdu58ou5XTby4qAqVRLmqo36NKPTg)
- **Blink:** `solana-action:https://identityprism.xyz/api/actions/share`
- **Solana dApp Store:** `com.identityprism2.app`
- **Build Week write-up:** [HACKATHON.md](./HACKATHON.md)

---

## License

MIT
