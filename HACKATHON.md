# Built with Codex + GPT-5.6 — OpenAI Build Week

Identity Prism's game economy was hardened during Build Week using the OpenAI
Codex CLI (GPT-5.6). We used GPT-5.6 not just to generate code, but as an
**adversarial security co-engineer** in a tight spec → build → red-team loop.

## How Codex / GPT-5.6 was used

1. **Audit** — GPT-5.6 (`gpt-5.6-sol`) audited the revive / coins / leaderboard
   flow and surfaced concrete exploits: client-controlled coin deltas, forgeable
   scores, and an unauthenticated metadata-file exposure.
2. **Spec** — it wrote a staged implementation plan (DB schema, atomic
   settlement, on-chain payment verification).
3. **Build** — Codex (`gpt-5.6-terra`) implemented server-authoritative timing,
   a server-derived coin model (the client-supplied coin delta is fully ignored),
   single-use session tokens, and on-chain SKR payment verification for paid
   revives.
4. **Adversarial verify** — GPT-5.6 repeatedly red-teamed its own implementation
   across four rounds, each pass finding narrower bugs (a `Number(null)` timing
   bug, revive-grant ordering by UUID instead of index, a plaintext-token leak in
   a public route) until the money path was provably safe.

## Codex Session IDs

| Phase | Session ID |
|---|---|
| Audit / spec | `019f6ec7-4764-7d43-80b8-20a0e76ea094` |
| Core server build | `019f6eed-e8c8-74a1-b157-7160e189f6a8` |
| Client build | `019f6f48-87b5-7641-8aa4-41f70ab26b17` |
| Hardening round 1 | `019f6f0f-2cd1-7883-924b-f7f66b5e33c2` |
| Hardening round 2 | `019f6f48-8612-7873-9c57-b8b22b7935d3` |
| Hardening round 3 | `019f6f66-c6e6-7fd0-a150-57445a0478d1` |
| Hardening round 4 (metadata LFI) | `019f6f80-56d9-7462-9158-84237465397b` |

## Where to see it in the code

The Codex-driven hardening landed in commit `614d5b2`:

- Server-authoritative game economy — `server/routes/game.js`, `server/services/gameRules.js`
- On-chain SKR paid-revive verification — `server/routes/game.js` (`verifyPaidReviveTransaction`)
- Metadata route allowlist (closes unauthenticated system-JSON exposure) — `server/routes/metadata.js`
- Anti-cheat test suite — `server/__tests__/game-anticheat.test.ts` (10/10 passing)

## Stack

React · Vite · Three.js · Tailwind · Capacitor (Android) · Node.js · SQLite ·
Solana web3.js · Metaplex Core · MagicBlock · Mobile Wallet Adapter / Seed Vault.
