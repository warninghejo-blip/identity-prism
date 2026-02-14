# Identity Prism — On-Chain Reputation & Identity Layer for Solana

> **Your wallet tells a story. Identity Prism reads it.**

**Live:** [https://identityprism.xyz](https://identityprism.xyz) · **Twitter:** [@Identity_Prism](https://x.com/Identity_Prism) · **Android APK:** [Download](https://identityprism.xyz/app-release.apk) · **Tapestry Social Graph:** [Explorer](https://explorer.usetapestry.dev/)

---

## What is Identity Prism?

Identity Prism is an **on-chain reputation and identity scoring system** built on Solana. It analyzes wallet activity — transactions, holdings, NFTs, DeFi positions, and wallet age — to produce a **reputation score**, **celestial tier**, and **achievement badges** that represent a user's true on-chain identity.

Unlike simple wallet trackers, Identity Prism transforms raw blockchain data into a **meaningful reputation layer** that can be used by dApps, DAOs, lending protocols, and social platforms to assess trustworthiness and engagement.

### The Problem

- Wallets are anonymous addresses — there's no way to quickly assess trust or reputation.
- Airdrop farmers, sybil attackers, and low-quality accounts dilute ecosystems.
- dApps lack a standardized way to gate features or rewards based on on-chain behavior.

### The Solution

Identity Prism provides:
1. **Reputation Score (0-1400)** — A composite score based on SOL balance, wallet age, transaction count, NFT holdings, DeFi activity, and special assets.
2. **Celestial Tiers** — From Mercury (new wallets) through Mars, Earth, Saturn, Jupiter, to Sun (top-tier OGs). Holders of both Seeker Genesis + Chapter 2 Preorder earn the rare **Binary Sun** tier.
3. **Achievement Badges** — OG, Whale, Collector, Titan, Maxi, Seeker, Visionary, Early Adopter, and more.
4. **API-first Design** — All reputation data is available via REST API for integration into any dApp.
5. **Social Graph Integration** — Publish identity profiles to Tapestry protocol, making reputation composable across the Solana ecosystem.

---

## Key Features

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

**Response:**
```json
{
  "address": "vines1vzrYbzLMRdu58ou5XTby4qAqVRLmqo36NKPTg",
  "score": 230,
  "tier": "mars",
  "badges": ["collector", "titan"],
  "stats": {
    "walletAgeDays": 0,
    "solBalance": 0,
    "txCount": 3982,
    "tokenCount": 6,
    "nftCount": 11
  }
}
```

### 🃏 Interactive 3D Identity Card
A visually stunning, Three.js-powered celestial card that renders your wallet's identity as a planet — the higher your tier, the more impressive your celestial body. Cards can be flipped to reveal detailed stats and badges.

### 🔗 Solana Blinks Integration
Share your Identity Prism card directly in any Blink-compatible client (wallets, social feeds):
- **Share Card** — Displays your identity card as a Solana Action
- **Mint as NFT** — Mint your identity card as an on-chain NFT using Metaplex Core
- **View Stats** — Interactive badge and score exploration

```
https://identityprism.xyz/api/actions/share?address=<YOUR_WALLET>
```

### ⛓️ On-Chain Attestation
Record your reputation score permanently on the Solana blockchain via the **Memo Program**. The attestation is co-signed by our authority, creating a verifiable, immutable proof that any smart contract or dApp can verify.

```
https://identityprism.xyz/api/actions/attest?address=<YOUR_WALLET>
```

Also works as a **Solana Blink** — attest your reputation from any Blink-compatible wallet.

### 🌐 Tapestry Social Graph Integration
Publish wallet identity profiles to the [Tapestry protocol](https://www.usetapestry.dev/) — Solana's leading social graph. This makes Identity Prism scores, tiers, and badges **composable** across the entire ecosystem:
- **Profile creation** — Wallet address, score, tier, and badges are published as a Tapestry profile
- **Content publishing** — Each scan generates content visible to other Tapestry-integrated apps
- **Cross-app discovery** — Other dApps can read Identity Prism reputation data via Tapestry's API
- **Social features** — Followers, following, likes, and comments on identity profiles

### 🤖 AI-Powered Social Agent
An autonomous Twitter bot ([@Identity_Prism](https://x.com/Identity_Prism)) powered by **Official Twitter API v2** + twitterapi.io fallback:
- **Auto-replies with real reputation data** when mentioned with a Solana address
- **Posts threads** about on-chain identity, Solana ecosystem trends, and wallet analysis
- **Engages** with relevant Solana accounts (replies, likes, retweets)
- **Creates trend-reactive content** based on current crypto topics
- **Quote tweets** with identity-focused commentary
- **Generates AI images** using Google Imagen for visual engagement
- **Media upload** via Twitter API v1.1 (official) with automatic fallback
- Uses **weighted random action selection** with human-like timing (1h+ intervals)

### 📱 Android App
Native Android application via Capacitor with Solana Mobile Wallet Adapter support.

### 🏛️ Colosseum Forum Agent
An AI agent that participates in the Colosseum hackathon forum — posting topics, commenting, and engaging with the community.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Frontend (React + Three.js)         │
│  - 3D Celestial Card · Stats Dashboard · Mint UI    │
└──────────────────────┬──────────────────────────────┘
                       │ HTTPS
┌──────────────────────▼──────────────────────────────┐
│              Backend (Node.js on port 8787)          │
│  - Reputation API · Blink Actions · Market Data     │
│  - Helius RPC proxy · NFT Minting · Card Renderer   │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│                  Solana Blockchain                   │
│  - Helius DAS API · Transaction History · NFTs      │
│  - Metaplex Core (minting) · SPL Tokens             │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│            Tapestry Social Graph                     │
│  - Profile creation · Content publishing            │
│  - Cross-app reputation discovery                   │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│              AI Agents (Python)                      │
│  - Twitter Bot (Official API v2 + twitterapi.io)    │
│  - Gemini AI for content generation + Imagen        │
│  - Content: threads, trends, quotes, engagement     │
└─────────────────────────────────────────────────────┘
```

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
| Mercury | 0-100 | Small rocky planet |
| Mars | 101-250 | Red planet |
| Venus | 251-400 | Volcanic world |
| Earth | 401-550 | Blue marble |
| Neptune | 551-700 | Ice giant |
| Uranus | 701-850 | Ringed ice world |
| Saturn | 851-950 | Ringed gas giant |
| Jupiter | 951-1050 | Gas giant king |
| Sun | 1051+ | Stellar body |
| Binary Sun | Combo | Twin star system |

---

## Tech Stack

| Layer | Technologies |
|-------|-------------|
| **Frontend** | React 18, TypeScript, Three.js (react-three-fiber), Tailwind CSS, shadcn/ui, Framer Motion |
| **Backend** | Node.js, Helius DAS API, Metaplex Core/Umi, custom HTTP server |
| **Blockchain** | Solana, SPL Tokens, Metaplex Core NFTs, Solana Actions (Blinks) |
| **Social Graph** | Tapestry Protocol (REST API), on-chain profile + content publishing |
| **AI Agents** | Python, Google Gemini (text + Imagen), Official Twitter API v2 (tweepy), twikit, twitterapi.io |
| **Mobile** | Capacitor, Solana Mobile Wallet Adapter |
| **Infrastructure** | Nginx, systemd services, Squid proxy, logrotate |

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/reputation?address=` | GET | Single wallet reputation |
| `/api/reputation/batch` | POST | Batch reputation (up to 5) |
| `/api/reputation/compare?a=&b=` | GET | Compare two wallets |
| `/api/actions/share?address=` | GET/POST | Blink: share identity card |
| `/api/actions/mint-blink` | GET/POST | Blink: mint identity NFT |
| `/api/actions/attest?address=` | GET/POST | Blink: on-chain reputation attestation |
| `/api/market/sol-price` | GET | Current SOL price |
| `/api/market/jupiter-prices` | POST | Token prices via Jupiter |

---

## Quick Start

### Frontend
```bash
npm install
npm run dev
```

### Backend
```bash
cd server
node helius-proxy.js
```

### Twitter Bot
```bash
cd twitter-bot-python
pip install -r requirements.txt
python main.py
```

---

## Environment Variables

See `.env.example` for all required variables. Key ones:

| Variable | Description |
|----------|-------------|
| `HELIUS_API_KEYS` | Helius RPC API key(s) |
| `VITE_TAPESTRY_API_KEY` | Tapestry social graph API key |
| `GEMINI_API_KEY` | Google Gemini API key |
| `TWITTER_CONSUMER_KEY` | Official Twitter API key |
| `TWITTER_CONSUMER_SECRET` | Official Twitter API secret |
| `TWITTER_ACCESS_TOKEN` | Twitter OAuth access token |
| `TWITTER_ACCESS_TOKEN_SECRET` | Twitter OAuth access token secret |
| `TWITTERAPI_IO_API_KEY` | twitterapi.io key (fallback) |
| `TREASURY_ADDRESS` | SOL treasury for mint payments |
| `PUBLIC_BASE_URL` | Public URL (https://identityprism.xyz) |

---

## Links

- **Live App:** [https://identityprism.xyz](https://identityprism.xyz)
- **Twitter:** [@Identity_Prism](https://x.com/Identity_Prism)
- **Tapestry Explorer:** [https://explorer.usetapestry.dev/](https://explorer.usetapestry.dev/)
- **Reputation API:** [https://identityprism.xyz/api/reputation?address=YOUR_WALLET](https://identityprism.xyz/api/reputation?address=vines1vzrYbzLMRdu58ou5XTby4qAqVRLmqo36NKPTg)
- **Blink:** `solana-action:https://identityprism.xyz/api/actions/share`
- **Android APK:** [https://identityprism.xyz/app-release.apk](https://identityprism.xyz/app-release.apk)
- **Solana Mobile:** Built for Saga & Seeker with native Mobile Wallet Adapter support

---

## License

MIT
