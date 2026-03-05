# CLAUDE.md — Identity Prism

## Working Directory
Always use `"/c/solana dapp"` with quotes in bash commands (space in path).

## Commands
- `npm run dev` — Vite dev server (port 7474)
- `npm run server` — backend proxy (port 3000)
- `npm run dev:all` — both concurrently
- `npm run build` — production build
- `npm run lint` — ESLint

## Architecture
```
src/
  App.tsx              — root layout (QueryClient, Toaster, cleanupOverlays)
  AppShell.tsx         — router, wallet providers, lazy routes with LazyErrorBoundary
  pages/
    Index.tsx          — main scan flow (landing → scanning → ready → hub)
    StellarForge.tsx   — coin shop (Armory/Bazaar/Loadout tabs)
    NebulaMarket.tsx   — Prism Arena (Explore/Compare/Challenges)
    ConstellationNetwork.tsx — canvas force-directed wallet graph with arrows
    PrismLeague.tsx    — games (Orbit/Destroyer/Gravity)
    QuestsPage.tsx     — daily/weekly/milestone quests
    BlackHole.tsx      — token burn page
    Leaderboard.tsx    — global leaderboard
    Compare.tsx        — side-by-side wallet compare
    Verify.tsx         — NFT verification
  components/
    CelestialCard.tsx  — identity card renderer (score, badges, aura)
    CosmicHubV3.tsx    — flat grid hub menu (used in Index)
    StarField.tsx      — background stars
  lib/
    prismCoin.ts       — coin balance/earn/spend API calls
    prismQuests.ts     — quest state management (localStorage + API)
    sybilDetection.ts  — sybil risk analysis
    forgeItems.ts      — shop items catalog + loadout management
    safeNavigate.ts    — goBack() with history tracking + overlay cleanup
    walletPassport.ts  — canvas passport image generator
  hooks/
    useWalletData.ts   — main wallet data fetcher (Helius DAS)
server/
    helius-proxy.js    — ALL backend API (2700+ lines, read with offset+limit!)
```

## Large Files — ALWAYS read with offset+limit
- `server/helius-proxy.js` — ~2700 lines. NEVER read fully. Key sections:
  - Lines 1-100: imports, env config
  - Lines ~5270-5350: constellation API
  - Lines ~4800-5000: sybil analysis
  - Lines ~4500-4700: coin/prism balance
  - Lines ~5400-5600: challenge system
- `src/pages/NebulaMarket.tsx` — ~1100 lines
- `src/pages/PrismLeague.tsx` — ~1500 lines
- `src/pages/Index.tsx` — ~1500 lines

## API Endpoints (backend on :3000)
- `GET /api/prism/balance?address=` — coin balance
- `POST /api/prism/earn` — earn coins
- `POST /api/prism/spend` — spend coins
- `GET /api/sybil/analysis?address=` — sybil risk
- `GET /api/constellation?address=&depth=2` — wallet graph (nodes+edges with outSol/inSol)
- `GET /api/score-history?address=` — scan history
- `POST /api/score-history` — save scan
- `GET /api/leaderboard` — global leaderboard
- `GET /api/market/mint-quote` — NFT mint price
- `GET /api/challenge/list` — open challenges
- `GET /api/challenge/my?address=` — my challenges
- `POST /api/challenge/create` — create challenge (JWT required)
- `GET /api/reputation?address=` — public reputation API
- `GET /api/marketplace/listings` — creator marketplace
- `POST /rpc` — Solana RPC proxy (Alchemy → Helius → public)

## Code Conventions
- TypeScript, path alias `@/` → `./src/`
- shadcn/ui components in `src/components/ui/`
- Tailwind 3 with CSS variables (dark mode only)
- Framer Motion for animations
- React Router v6 with lazy-loaded routes + LazyErrorBoundary
- Solana wallet-adapter for blockchain
- Server: plain Node.js, no framework, ESM

## Important Patterns
- Navigation: use `goBack(navigate)` from `@/lib/safeNavigate`
- Coins: use `prismCoin.ts` helpers (getPrismBalance, earnPrism, spendPrism)
- Toasts: sonner (`toast()`)
- New pages: add lazy import + route in AppShell.tsx, wrap with `lazyRoute()`
- API calls: always try/catch, graceful fallback when server down

## Do NOT
- Read server/helius-proxy.js fully (use offset+limit)
- Modify node_modules
- Commit secrets/ directory
- Change wallet-adapter core setup without explicit request
- Add unnecessary dependencies
- Generate demo/fake data — only real data
