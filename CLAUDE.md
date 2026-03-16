# CLAUDE.md — Identity Prism

## Working Directory
Always use `"/c/solana dapp"` with quotes in bash commands (space in path).

## Commands
- `npm run dev` — Vite dev server (port 7474)
- `npm run server` — backend proxy (port 3000)
- `npm run dev:all` — both concurrently
- `npm run build` — production build
- `npx tsc --noEmit` — typecheck
- `npm run lint` — ESLint

## Stack
- **Frontend**: React 18 + TypeScript + Vite 7 (port 7474)
- **UI**: shadcn/ui (Radix + Tailwind 3), Framer Motion, Three.js / R3F
- **Blockchain**: Solana @solana/web3.js v1, wallet-adapter, Metaplex UMI
- **Server**: Node.js raw HTTP (NO Express), ESM, port 3000
- **Mobile**: Capacitor 8 (Android), appId: com.identityprism.app
- **Path alias**: `@/` → `./src/`

## Architecture
```
src/
  App.tsx              — root layout (QueryClient, Toaster, cleanupOverlays)
  AppShell.tsx         — router, wallet providers, lazy routes

  pages/               — 20 route pages
    Index.tsx          — main scan flow (landing → scanning → ready → hub) [~1500 lines]
    StellarForge.tsx   — Armory/Bazaar/Loadout shop [~1400 lines]
    PrismLeague.tsx    — 5 games + tournament mode [~2200 lines]
    NebulaMarket.tsx   — Prism Arena (Explore/Challenges) [~1100 lines]
    Leaderboard.tsx    — global leaderboard (Overall/Orbit/Destroyer/Gravity)
    QuestsPage.tsx     — daily/weekly/milestone quests
    TextQuestPage.tsx  — SR2-style branching text adventures (16 quests)
    PrismVault.tsx     — BuyCoins + Staking
    BlackHole.tsx      — token burn page
    Compare.tsx        — side-by-side wallet compare (battle mode)
    ConstellationNetwork.tsx — canvas force-directed wallet graph
    Verify.tsx, ScamChecker.tsx, ProfilePage.tsx, etc.

  components/
    CelestialCard.tsx  — identity card renderer (score, badges, aura, frames)
    CosmicHubV3.tsx    — flat grid hub menu with MiniPassport [~900 lines]
    CosmicStarfield.tsx— background stars canvas
    PageShell.tsx      — shared page wrapper (starfield + nebulae bg)
    game/              — game components (OrbitSurvival, CosmicDefender, etc.)
    ui/                — shadcn components
    wallet-adapter/    — wallet connect UI
    prism/             — shared helpers (shared.tsx has WalletPreview, fetch fns)

  lib/                 — 27 core logic files
    prismCoin.ts       — coin balance/earn/spend API
    prismQuests.ts     — quest state management (localStorage + API)
    textQuests.ts      — 16 branching text quests + engine [~2800 lines]
    rangerRanks.ts     — XP progression (Cadet→Legend, 5 ranks)
    shipStats.ts       — 4 ship stats (speed/shield/firepower/luck 0-100)
    forgeItems.ts      — shop items catalog + loadout management
    sybilDetection.ts  — sybil risk analysis
    safeNavigate.ts    — goBack() always → '/' with history tracking
    fadeTransition.ts  — page transition effects (300ms fade)
    walletPassport.ts  — canvas passport image generator

  hooks/
    useWalletData.ts   — wallet data fetcher (Helius DAS) [~500 lines]
    useCompositeScore.ts — composite score with sessionStorage cache

server/
    helius-proxy.js    — ALL backend API [~9000 lines, NEVER read fully!]
```

## Large Files — ALWAYS use offset+limit
| File | Lines | Key sections |
|------|-------|-------------|
| server/helius-proxy.js | ~9000 | 1-100 imports, ~4500-4700 coin API, ~4800-5000 sybil, ~5400-5600 challenges, ~6000-6200 tournament, ~8600-8700 game coin cap |
| src/pages/PrismLeague.tsx | ~2200 | ~1-100 imports/types, ~600-800 state, ~1800 mode selector, ~2000 tournament UI |
| src/pages/Index.tsx | ~1500 | ~1-80 imports, ~200-400 state, ~800 hub render |
| src/pages/StellarForge.tsx | ~1400 | ~1-80 imports, ~100-200 types, ~850 shop grid |
| src/lib/textQuests.ts | ~2800 | 1-50 types, 52-1446 quest data, 1448 array, 1460+ engine |

## API Endpoints (backend :3000)
- `GET /api/prism/balance?address=` — coin balance
- `POST /api/prism/earn` — earn coins (source + amount + JWT)
- `POST /api/prism/spend` — spend coins
- `GET /api/sybil/analysis?address=` — sybil risk
- `GET /api/constellation?address=&depth=2` — wallet graph
- `GET /api/leaderboard` — global leaderboard
- `GET /api/challenge/list|create|my` — P2P challenges
- `GET /api/tournament/active` — tournaments (daily/weekly/monthly)
- `POST /api/tournament/join` — join tournament (JWT)
- `GET /api/reputation?address=` — public reputation
- `GET /api/wallet-database?address=` — full wallet data
- `POST /rpc` — Solana RPC proxy

## Key Systems
- **5 game modes**: Orbit Survival, Cosmic Defender, Gravity Rush, Cosmic Mine (idle), Text Quest
- **Ship Stats**: speed/shield/firepower/luck (0-100), from composite breakdown + equipped modules
- **Ranger Ranks**: Cadet(0) → Pilot(1500) → Captain(8000) → Ace(25000) → Legend(50000 XP)
- **XP sources**: game scores (~70%), achievements ×200, arena wins ×300, quests ×20, text quests ×500
- **Tournaments**: daily(1000)/weekly(5000)/monthly(25000) entry fees, 15% burn, top-N prizes
- **Economy**: "Coins" currency, daily game cap 2000 (server line ~8635)
- **Composite Score**: OnChain(400) + SybilTrust(250) + HumanProof(150) + Social(100) + Engagement(100) = 1000
- **Staking**: bracket yields (1.0%→0.2%), tier multipliers (bronze 1x, silver 1.4x, gold 2x)
- **16 badges**: 6 categories matching composite score categories

## Code Patterns
- Navigation: `goBack(navigate)` from `@/lib/safeNavigate`
- Coins: `prismCoin.ts` (getPrismBalance, earnPrism, spendPrism)
- Toasts: `toast()` from sonner
- Page wrapper: `<PageShell>` for consistent background
- New pages: lazy import + route in AppShell.tsx via `lazyRoute()`
- Transitions: `startFadeTransition()` / `fadeOutTransition()`
- Glass card: `className="glass-card"`
- API calls: always try/catch with graceful fallback

## Do NOT
- Read server/helius-proxy.js fully — use offset+limit
- Modify node_modules or wallet-adapter core
- Commit .env or secrets/
- Generate fake/demo data
- Add unnecessary deps
- Auto-commit without user request

## Scoring & Tiers
- Direct 0-400 pts: SOL(40) + Age(100) + TX(80) + NFT(32) + DeFi(30) + Collection(50) + Badges(68)
- Tiers: mercury → venus → earth → mars → jupiter → saturn → nebula → pulsar → quasar → binary_sun

## Test Wallet
`2psA2ZHmj8miBjfSqQdjimMCSShVuc2v6yUpSLeLr4RN` (also treasury)
