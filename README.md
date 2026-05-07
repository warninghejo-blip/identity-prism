# Identity Prism

**A living reputation passport for Solana wallets.**

Identity Prism reads a Solana wallet, explains its reputation, detects sybil risk, and gives the user a path to prove humanity through action. It is not just another wallet scorer: the score becomes useful inside games, quests, arena challenges, tournaments, shop upgrades, and a community-driven Sybil Hunt loop.

Live app: [identityprism.xyz](https://identityprism.xyz)
Demo script: [docs/DEMO_VIDEO_SCRIPT_EN.md](docs/DEMO_VIDEO_SCRIPT_EN.md)
Demo plan: [docs/DEMO_VIDEO_PLAN.md](docs/DEMO_VIDEO_PLAN.md)

## Core Idea

Most wallets look anonymous from the outside: address, balance, transactions. Identity Prism turns that into a compact identity artifact:

- a public identity card;
- a unified reputation score;
- a trust grade;
- category breakdowns;
- badges and ranks;
- wallet dossier;
- gameplay stats;
- utility loops around coins, XP, shop items, quests, tournaments, and arena challenges.

The important product principle: **a weak or suspicious wallet is not a dead end**. A user can improve reputation through activity: playing games, completing quests, participating in Sybil Hunt, recovering trust, building engagement proof, and earning verifiable in-app history.

## Why It Exists

Solana apps need better context about wallets:

- airdrops and quests are attacked by sybil farms;
- new users often look weak on-chain even when they are real;
- reputation products often become one-way judgments;
- users rarely get a clear path to improve;
- games and consumer apps need trust, progression, and retention loops that are not just wallet balance checks.

Identity Prism combines wallet intelligence, anti-sybil analysis, and product utility in one mobile-first app.

## Product Loop

1. **Scan a wallet**
   Prism reads on-chain data, wallet history, holdings, activity, and internal Prism state.

2. **Create a passport**
   The user gets a score, tier, trust grade, badges, rank, and visual identity card.

3. **Explain the score**
   The score is split into five understandable categories: On-Chain, Sybil Trust, Human Proof, Social, and Engagement.

4. **Let the user prove humanity**
   Games, quests, recovery actions, and engagement can improve the profile instead of leaving the wallet permanently flagged.

5. **Grow the sybil database**
   Users scan suspicious wallets in Sybil Hunt. Strong signals can earn rewards and improve the shared evidence base.

6. **Turn reputation into utility**
   Score categories affect ship stats: speed, shield, firepower, and luck.

7. **Close the economy loop**
   Activity earns Coins and XP. Coins are spent in the shop, arena, tournaments, and utility modules. Server-side rules validate rewards, spend paths, caps, and tournament entries.

## Main Features

### Identity Card

A mobile-first wallet passport with:

- unified score out of 1000;
- trust grade;
- celestial tier;
- badges;
- rank and XP;
- wallet dossier;
- card front/back views;
- score breakdown summaries;
- compact mini-passport for hub screens;
- custom frames, auras, titles, and ship cosmetics.

### Sybil Hunt

Community-facing anti-sybil workflow:

- scan suspicious wallets;
- see verdict, confidence, risk factors, and evidence;
- report false flags;
- earn bounty-style in-app rewards when the signal is strong;
- grow scan history and future detection quality.

The goal is not only to classify wallets, but to make sybil discovery part of the product loop.

### Unified Reputation Score

Current composite score:

| Category | Max | Purpose |
| --- | ---: | --- |
| On-Chain | 400 | Wallet age, SOL, transactions, NFTs, DeFi, collections, assets |
| Sybil Trust | 250 | Risk, funding patterns, clusters, clean record, trust recovery |
| Human Proof | 150 | Games, achievements, quests, active participation |
| Social | 100 | Social / public identity signals and ecosystem participation |
| Engagement | 100 | Streaks, actions, scans, shop, arena, tournaments |
| **Total** | **1000** | Wallet reputation passport score |

The UI should avoid exposing too many raw metrics. Users see one score, one trust grade, and clear category summaries.

### Prism League

Five game surfaces connected to identity and progression:

- Orbit Survival;
- Cosmic Defender;
- Gravity Rush;
- Cosmic Mine;
- Text Quest mode;
- tournament participation per mode;
- game rewards, XP, achievements, and daily caps.

Ship stats are derived from reputation and equipped modules:

- speed;
- shield;
- firepower;
- luck.

### Tournaments

Daily, weekly, and monthly tournament flow:

- entry fees;
- prize pools;
- 15% burn/sink logic;
- top-N rewards;
- mode-specific participation;
- notification and reward history.

### Stellar Forge

Shop and loadout system:

- card frames;
- auras;
- ship skins;
- titles;
- stat modules;
- rank-gated items;
- equipped loadout changes ship stats.

### Prism Arena

Competitive wallet layer:

- wallet-vs-wallet challenges;
- wagers with in-app Coins;
- challenge state and notifications;
- leaderboard-style competitive loop.

### Quests

Retention and proof layer:

- daily quests;
- weekly quests;
- milestone quests;
- branching text adventures;
- rewards through XP and Coins.

### Prism Vault

Economy and wallet utility surface:

- Coins balance;
- buy flow UI;
- staking / yield-style utility;
- payment-related paths kept separate from the core demo flow.

For hackathon/demo recording, real payments are intentionally not executed.

### Black Hole

Wallet cleanup and burn utility:

- dust token / unwanted asset burn flows;
- rent reclaim utility;
- safety checks around valuable assets.

### Notifications

In-app inbox for:

- rewards;
- arena events;
- tournament events;
- system feedback;
- progression updates.

## Mobile And Seeker Support

Identity Prism is mobile-first:

- React + Vite frontend;
- Capacitor 8 Android shell;
- Solana Mobile Wallet Adapter;
- Seeker / Solana Mobile compatibility path;
- Phantom and Solflare adapters for browser use.

The APK is not attached in this repository release because local builds can contain dev-wallet helpers. Build and release APKs should be produced through a dedicated clean release pass.

## Architecture

```text
React 18 + TypeScript + Vite
  |
  |  Mobile-first UI, wallet adapters, card renderer, games, shop, arena
  v
Node.js raw HTTP backend
  |
  |  Reputation, sybil analysis, economy, quests, tournaments,
  |  notifications, wallet data, spend/earn validation
  v
Solana / Helius / Metaplex / SPL
  |
  |  Wallet history, DAS data, token/NFT metadata, mint/update flows,
  |  transaction verification, public reputation context
  v
Identity Prism state
  |
  |  SQLite / server stores / local fallback data for app economy,
  |  scan history, sybil clusters, scores, leaderboards, quests
```

## Tech Stack

| Layer | Stack |
| --- | --- |
| Frontend | React 18, TypeScript, Vite 7, Tailwind, shadcn/ui, Radix, Framer Motion |
| Visuals | Three.js / React Three Fiber, Canvas, custom textures, generated bitmap assets |
| Mobile | Capacitor 8, Solana Mobile Wallet Adapter |
| Wallets | Solana Mobile Wallet Adapter, Phantom, Solflare |
| Solana | `@solana/web3.js`, SPL Token, Metaplex UMI / Token Metadata |
| Backend | Node.js raw HTTP server, no Express |
| Data | SQLite via `better-sqlite3`, JSON fallback stores |
| Tests | Vitest, Testing Library |
| Tooling | ESLint, TypeScript, Vite build, Playwright scripts |

## API Surface

Common local backend endpoints:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/prism/balance?address=` | Coin balance |
| `POST /api/prism/earn` | Earn Coins with server validation |
| `POST /api/prism/spend` | Spend Coins with server validation |
| `GET /api/sybil/analysis?address=` | Sybil risk and trust analysis |
| `GET /api/constellation?address=&depth=2` | Wallet graph |
| `GET /api/leaderboard` | Global leaderboard |
| `GET /api/challenge/list` | Arena challenge list |
| `GET /api/challenge/my` | User challenges |
| `POST /api/challenge/create` | Create arena challenge |
| `GET /api/tournament/active` | Active tournaments |
| `POST /api/tournament/join` | Join tournament |
| `GET /api/reputation?address=` | Public reputation |
| `GET /api/wallet-database?address=` | Full wallet data |
| `POST /rpc` | Solana RPC proxy |

## Quick Start

Requirements:

- Node.js 20+ recommended;
- npm;
- Solana RPC / Helius configuration through local environment variables for full wallet data;
- no real secrets committed to the repository.

Install:

```bash
npm install
```

Run frontend:

```bash
npm run dev
```

Run backend:

```bash
npm run server
```

Run both:

```bash
npm run dev:all
```

Default local ports:

- frontend: `http://127.0.0.1:7474`
- backend: `http://127.0.0.1:3000`

## Verification

```bash
npx tsc --noEmit
npm test
npm run build
npm run lint
```

Current known state:

- TypeScript passes.
- Vitest suite passes.
- Production build passes.
- Lint currently has warnings but no errors.
- `npm audit` still reports high advisories in upstream transitive packages; no forced breaking downgrades are applied.

## Security Notes

The repository is configured to ignore:

- `.env` and `.env.*`;
- `secrets/`;
- `keys/`;
- `*.keypair`;
- APKs;
- local DB/runtime files;
- generated archives;
- local bot/session/cookie files.

Do not commit:

- private keys;
- Solana keypairs;
- GitHub tokens;
- JWT secrets;
- Firebase service accounts;
- Helius/API keys;
- Android signing keys;
- APKs built with dev wallets.

## Demo Positioning

For a short hackathon demo, the cleanest narrative is:

> Identity Prism turns a wallet into a living reputation passport. It reads the wallet, explains trust, lets risky users prove humanity through action, and turns community sybil hunting into a growing anti-sybil database.

What to show:

- wallet opens into identity card;
- score/trust/badges are understandable;
- weak wallet can improve;
- Sybil Hunt adds community verification;
- reputation affects ship stats;
- games, quests, shop, arena, and tournaments close the product loop.

What not to focus on:

- future TGE;
- token price;
- financial upside;
- real payment execution during the demo.

Coins are currently an in-app utility and progression currency. The demo focuses on identity, anti-sybil, and product utility.

## Repository Scope

This repository intentionally keeps the current product code and public assets, while excluding local-only material such as old bot experiments, private agent files, generated archives, raw source dumps, APKs, and secrets.
