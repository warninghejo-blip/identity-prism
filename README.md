# Identity Prism — On-Chain Reputation & Identity Layer for Solana

> **Your wallet tells a story. Identity Prism reads it.**

[![Solana Mobile](https://img.shields.io/badge/Platform-Solana%20Mobile-blue)](https://solanamobile.com/)
[![MagicBlock](https://img.shields.io/badge/Gaming-MagicBlock-purple)](https://magicblock.gg/)
[![Tapestry](https://img.shields.io/badge/Social%20Graph-Tapestry-orange)](https://tapestry.network/)
[![Live](https://img.shields.io/badge/Live-identityprism.xyz-brightgreen)](https://identityprism.xyz)

**Live:** [identityprism.xyz](https://identityprism.xyz) · **Demo v4.0:** [YouTube](https://youtu.be/2JR4UN8-Elo) · **Twitter:** [@Identity_Prism](https://x.com/Identity_Prism) · **Android APK:** [Download](https://identityprism.xyz/app-release.apk) · **Tapestry:** [Explorer](https://explorer.usetapestry.dev/)

---

## What is Identity Prism?

Identity Prism is an **on-chain reputation and identity scoring system** built on Solana. It analyzes wallet activity — transactions, holdings, NFTs, DeFi positions, and wallet age — to produce a **reputation score**, **celestial tier**, **sybil risk grade**, and **achievement badges** that represent your true on-chain identity.

It's not just a wallet tracker. It's a full **gamified identity platform** — with text quests, arcade games, tournaments, a cosmetics shop, an XP progression system, and an AI-powered social agent that generates video content with Veo 3.1.

> **Current code-backed reference:** see [`docs/PROJECT_REFERENCE.md`](docs/PROJECT_REFERENCE.md) for the live route map, feature ownership, PRISM economy, and Ranger XP formulas.

### The Problem

- Wallets are anonymous — no way to quickly assess trust or reputation
- Airdrop farmers, sybil attackers, and low-quality accounts dilute ecosystems
- dApps lack a standardized way to gate features based on on-chain behavior

### The Solution

1. **Reputation Score (0–1400)** — Composite score from SOL balance, wallet age, txn count, NFTs, DeFi, special assets
2. **Composite Score (0–1000)** — 5-category breakdown: On-Chain (400), Sybil Trust (250), Human Proof (150), Social (100), Engagement (100)
3. **Celestial Tiers** — Mercury → Mars → Venus → Earth → Neptune → Uranus → Saturn → Jupiter → Sun → Binary Sun
4. **Sybil Detection** — Risk analysis with trust grade (A+ to F), integrated into the identity card
5. **16 Achievement Badges** across 6 categories — earned through on-chain activity and in-app engagement
6. **API-first** — All data available via REST for integration into any dApp
7. **Tapestry Social Graph** — Composable reputation across the Solana ecosystem

---

## Key Features

### 🪪 Identity Card & Scoring
A Three.js-powered 3D celestial card renders your wallet as a planet — the higher your tier, the more impressive the celestial body. Cards flip to reveal detailed stats, badges, sybil trust grade, and score history sparkline. Customizable with frames, auras, and ship skins from the Stellar Forge shop.

### 🛡️ Sybil Detection
Analyzes wallet behavior patterns to assign a trust grade (A+ to F). Checks for transaction clustering, balance anomalies, and farming patterns. Displayed as a badge on the card front and detailed breakdown on the card back.

### 🎮 Prism League (3 Game Modes)
- **Orbit Survival** — Dodge asteroids, collect powerups. Sessions cryptographically seeded via MagicBlock Ephemeral Rollups; backend validates scores before on-chain commit
- **Cosmic Defender** — Top-down shooter, 4 levels, boss enemies, powerups, 9 dedicated achievements
- **Gravity Runner** — Physics-based obstacle course

All scores recorded on-chain via Solana Memo. Global leaderboard with separate rankings per mode.

### 🏆 Tournament System
3-tier competitive tournaments (Daily / Weekly / Monthly) with entry fees, 15% burn, and prize pool distribution to top-N players across all game modes.

### 📖 Text Quests (16 Adventures)
Branching narrative adventures with skill checks based on your ship stats. 8 original + 8 SR2-style quests with illustrated scenes. Choices matter — your speed, shield, firepower, and luck stats affect outcomes.

### ⚔️ Prism Arena
- **Wallet Battle** — Side-by-side comparison of two wallets with animated stat bars
- **P2P Challenges** — Challenge other wallets with coin wagers, stored on-chain

### 🔨 Stellar Forge (Cosmetics Shop)
- **Armory** — Ship skins, card frames, auras, titles
- **Loadout** — Equip items that affect ship stats (speed, shield, firepower, luck)
- **Bazaar** — Rare items, limited editions

Economy powered by Coins earned through gameplay, quests, and wallet scanning.

### 📋 Quest System
- **Daily Quests** — Daily Scan, Curious Mind, etc.
- **Weekly Quests** — Streak-based challenges
- **Milestone Quests** — One-time achievements (First Contact, etc.)

### 🎖️ Ranger Ranks (XP Progression)
Cadet (0 XP) → Pilot (1,500) → Captain (8,000) → Ace (25,000) → Legend (50,000). XP from game scores, achievements, arena wins, and text quests.

### 💰 Prism Vault
- **Buy Coins** — SOL-to-Coins conversion
- **Staking** — Bracket yields (1.0% → 0.2%) with tier multipliers

### 🕳️ Black Hole
Burn dust tokens and unwanted NFTs in batch, reclaim rent SOL. Real-time price feeds protect valuable assets.

### ♻️ Update Card
Update NFT metadata in-place (~0.0005 SOL) without burning, protected by **Co-Sign Authority Guard**.

### 🔗 Solana Blinks
Share your identity card, mint as NFT, or attest reputation — all as Solana Actions compatible with any Blink-enabled wallet.

### 🌐 Tapestry Social Graph
Publish identity profiles to [Tapestry protocol](https://www.usetapestry.dev/) — scores, tiers, and badges become composable across the Solana ecosystem.

### ⛓️ On-Chain Attestation
Record reputation permanently on Solana via Memo Program, co-signed by our authority for verifiable proof.

### 🌀 Custom GLSL Transitions
Hand-crafted GPU shader wormhole transitions for navigation events — 60 FPS on mobile.

### 🎵 Procedural Audio Engine
All game SFX synthesized in real-time via Web Audio API — lasers, explosions, shields, pickups, boss warnings, victory themes. Zero audio files.

### 🤖 AI Social Agent
Autonomous Twitter bot ([@Identity_Prism](https://x.com/Identity_Prism)) powered by **Gemini 3 Flash** + **Veo 3.1**:
- Generates **AI video posts** with dynamic Solana-themed visuals (cyberpunk aesthetic, Solana logo integration)
- Generates **AI images** via Gemini Imagen
- Auto-replies with real wallet reputation data when mentioned with a Solana address
- Posts provocative identity-focused content with real ecosystem data
- Engages with priority Solana accounts (Jupiter, Phantom, Tensor, etc.)
- Anti-repetition architecture: structural pattern dedup, content type enforcement, 5-level dedup system
- Spam/scam mention filter with Cyrillic homoglyph detection

### 📱 Android App
Native Android via Capacitor with Solana Mobile Wallet Adapter support. Published on Solana dApp Store.

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│           Frontend (React 18 + Three.js + R3F)        │
│  3D Identity Card · CosmicHub · Prism League · Forge  │
│  Text Quests · Arena · Black Hole · Quests · Vault    │
│  Custom GLSL Shaders · Procedural Audio · Canvas 2D   │
└───────────────────────┬──────────────────────────────┘
                        │ HTTPS
┌───────────────────────▼──────────────────────────────┐
│             Backend (Node.js HTTP on port 8787)       │
│  Reputation API · Sybil Detection · Blink Actions    │
│  Coin Economy · Quests · Tournaments · Challenges    │
│  Game Session Validation · NFT Minting · Staking     │
│  Rate Limiting · JWT Auth · Co-Sign Guard            │
└───────────────────────┬──────────────────────────────┘
                        │
┌───────────────────────▼──────────────────────────────┐
│                Solana Blockchain                      │
│  Helius DAS API · Transaction History · SPL Tokens   │
│  Metaplex Core (NFT minting) · Memo Program          │
│  MagicBlock Ephemeral Rollups (game sessions)        │
└──────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│              Tapestry Social Graph                    │
│  Profile creation · Content publishing               │
│  Cross-app reputation discovery                      │
└──────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│         AI Social Agent (Python + Docker)             │
│  Gemini 3 Flash (text) · Veo 3.1 (video generation) │
│  GQL Twitter integration · Anti-repetition engine    │
│  Pattern dedup · Niche keyword filter · Spam guard   │
└──────────────────────────────────────────────────────┘
```

---

## Badge System (16 Badges, 6 Categories)

| Category | Badges | How to Earn |
|----------|--------|-------------|
| **On-Chain** | Veteran, Whale, DeFi Architect | Wallet age, SOL balance, DeFi activity |
| **Sybil Trust** | Verified Human, Clean Record | Low sybil risk score |
| **Human Proof** | Game Master, Achievement Hunter, High Scorer | Game scores, achievements |
| **Identity Prism** | Seeker, Visionary, Binary Sun | Seeker NFT, high tier, combo |
| **Social** | Arena Champion, Star Navigator | Arena wins, social engagement |
| **Engagement** | Quest Hunter, Streak Lord, Explorer | Quests, streaks, exploration |

---

## Scoring System

| Factor | Max Points | Details |
|--------|-----------|---------|
| SOL Balance | 100 | 0.1 → 10+ SOL tiers |
| Wallet Age | 250 | 7 days → 2+ years |
| Transaction Count | 200 | 50 → 5000+ txns |
| NFT Holdings | 80 | 5 → 100+ NFTs |
| Seeker Genesis NFT | 200 | Saga phone holder |
| Chapter 2 Preorder | 150 | Early supporter |
| Combo Bonus | 200 | Both Seeker + Preorder |
| Blue Chip NFT | 50 | Premium collections |
| DeFi King | 30 | LST/DeFi exposure |
| Meme Lord | 30 | Meme coin holdings |
| Diamond Hands | 50 | 60+ day wallet |
| Hyperactive | 50 | 8+ txn/day average |
| **Max Score** | **1400** | |

### Tier Mapping

| Tier | Score Range | Visual |
|------|------------|--------|
| Mercury | 0–100 | Small rocky planet |
| Mars | 101–250 | Red planet |
| Venus | 251–400 | Volcanic world |
| Earth | 401–550 | Blue marble |
| Neptune | 551–700 | Ice giant |
| Uranus | 701–850 | Ringed ice world |
| Saturn | 851–950 | Ringed gas giant |
| Jupiter | 951–1050 | Gas giant king |
| Sun | 1051+ | Stellar body with plasma shader |
| Binary Sun | Combo | Twin star system |

---

## Tech Stack

| Layer | Technologies |
|-------|-------------|
| **Frontend** | React 18, TypeScript, Vite 7, Three.js (R3F), Tailwind CSS, shadcn/ui, Framer Motion |
| **Backend** | Node.js (raw HTTP), Helius DAS API, Metaplex Core/Umi, JWT auth |
| **Blockchain** | Solana, SPL Tokens, Metaplex Core NFTs, Solana Actions (Blinks), Memo Program |
| **Social Graph** | Tapestry Protocol (REST API) |
| **Gaming** | MagicBlock Ephemeral Rollups, Canvas 2D engine, Web Audio API (procedural SFX) |
| **AI Agent** | Python, Google Gemini 3 Flash, Veo 3.1 (video), Imagen (images), Twitter GQL |
| **Shaders** | Custom GLSL (wormhole transitions, plasma sun, procedural planets) |
| **Mobile** | Capacitor 8, Solana Mobile Wallet Adapter, Solana dApp Store |
| **Security** | Rate limiting, game session proofs, co-sign guards, sybil detection |
| **Infrastructure** | Docker, Nginx, Ubuntu, Playwright (bot stealth) |

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/reputation?address=` | GET | Single wallet reputation |
| `/api/reputation/batch` | POST | Batch reputation (up to 5) |
| `/api/reputation/compare?a=&b=` | GET | Compare two wallets |
| `/api/actions/share?address=` | GET/POST | Blink: share identity card |
| `/api/actions/mint-blink` | GET/POST | Blink: mint identity NFT |
| `/api/actions/attest?address=` | GET/POST | Blink: on-chain attestation |
| `/api/market/sol-price` | GET | Current SOL price |
| `/api/market/jupiter-prices` | POST | Token prices via Jupiter |
| `/api/coins/balance?address=` | GET | Coin balance |
| `/api/sybil?address=` | GET | Sybil risk analysis |

---

## Quick Start

### Frontend
```bash
npm install
npm run dev        # Vite dev server on port 7474
```

### Backend
```bash
node server/helius-proxy.js   # API server on port 8787
```

### Full Stack
```bash
npm run dev:all    # Both frontend + backend concurrently
```

See `.env.example` for required environment variables (Helius API keys, Tapestry key, etc.)

---

<details>
<summary><b>Hackathon Submissions</b></summary>

<br/>

### Project Evolution

| Version | Demo | What changed |
|---------|------|--------------|
| **v3.0** | [YouTube Shorts](https://www.youtube.com/shorts/glZBXcYBB-k) | Core reputation engine, 3D planet card, NFT minting, Black Hole, Orbit Survival, Tapestry, Blinks |
| **v4.0** | [YouTube](https://youtu.be/2JR4UN8-Elo) | Cosmic Defender, Update Card + Co-Sign Guard, GLSL wormhole transitions, procedural audio engine, badge redesign |
| **v5.0** | Coming soon | Sybil detection, composite scoring, 16 badges, Ranger Ranks, 16 text quests, tournament system, Stellar Forge shop, quest system, coin economy, staking, Prism Arena, AI video bot (Veo 3.1), security hardening |

### MONOLITH (Solana Mobile Hackathon)
* **Track:** Mobile Track
* **Why it fits:** Mobile-first design with Solana Mobile Wallet Adapter (MWA) for seamless Seed Vault signing. UI, Three.js 3D rendering, Canvas game engine, custom GLSL shader transitions, and touch controls optimized for **Seeker** at 60 FPS. Published on Solana dApp Store.

### Solana Graveyard Hackathon
* **Gaming (MagicBlock):** Three game modes with cryptographic session verification via MagicBlock Ephemeral Rollups + on-chain score attestation
* **Onchain Social (Tapestry):** Tiers and badges published to Tapestry, making Identity Prism a composable reputation layer
* **DeFi / Tooling:** Black Hole (batch burn + rent reclaim), Update Card (in-place NFT update with Co-Sign Guard)
* **Mobile / Consumer:** Native Seeker/Saga PWA/APK with MWA integration

</details>

---

## Links

- **Live App:** [identityprism.xyz](https://identityprism.xyz)
- **Twitter:** [@Identity_Prism](https://x.com/Identity_Prism)
- **Tapestry Explorer:** [explorer.usetapestry.dev](https://explorer.usetapestry.dev/)
- **Reputation API:** [Try it](https://identityprism.xyz/api/reputation?address=vines1vzrYbzLMRdu58ou5XTby4qAqVRLmqo36NKPTg)
- **Blink:** `solana-action:https://identityprism.xyz/api/actions/share`
- **Android APK:** [Download](https://identityprism.xyz/app-release.apk)

---

## License

MIT
