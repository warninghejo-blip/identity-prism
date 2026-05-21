# Superteam Agentic Engineering Grant Draft

Submit here: https://superteam.fun/earn/grants/agentic-engineering

## Step 1: Basics

**Project Title**
> Identity Prism

**One Line Description**
> Identity Prism is a sybil-resistant identity and wallet trust layer on Solana, combining gameplay reputation, wallet scoring, mobile-native verification, and safe asset cleanup.

**TG username**
> TODO: add `t.me/<username>`

**Wallet Address**
> TODO: add your Solana wallet address

## Step 2: Details

**Project Details**
> Identity Prism solves a core trust problem on Solana: wallets are easy to create, easy to farm, and hard to evaluate. Reward systems, allowlists, and community incentives are regularly attacked by sybil clusters because most products still lack a portable, user-friendly trust layer that feels native to real users.
>
> Identity Prism is being built as a consumer-facing trust product, not just a backend score. It combines wallet-based reputation scoring, human-verification signals, mobile-native wallet flows, a visible identity card users can mint to their own wallet, and connected gameplay loops that turn reputation into something understandable and sticky. The goal is to make wallet trust legible, useful, and portable across Solana experiences without forcing users into a broken UX.
>
> The product already includes multiple shipped surfaces: a mobile-first identity app, celestial identity cards, a Sybil Check flow for wallet review, and Black Hole, a safe wallet-cleanup system that protects valuable assets while recovering rent from disposable token accounts. The current build work has focused on real-device Seeker hardening, JWT-gated auth flows, Seed Vault wallet handoff stability, Black Hole performance, landing-page storytelling, and production backend compatibility.
>
> This grant would help scale that agentic engineering process into a tighter launch push: finalize production-grade UX, keep hardening the mobile trust flow on real Solana Mobile hardware, polish public-facing demos and landing flows, and ship a stronger proof-and-utility layer that protocols and communities can actually use.

**Deadline**
> 2026-06-30

**Proof of Work**
> Identity Prism already has real shipped work across web, backend, and mobile-native Solana surfaces. Recent execution includes production and staging backend updates, a live `/api/prism/summary` path, repeated release APK rebuilds and installs on a real Seeker device, JWT-backed route hardening, Seed Vault handoff fixes, Black Hole scan/debug/performance work, and a rebuilt premium scrollytelling landing tied to the actual product flows.
>
> Verified product surfaces and artifacts from the current workspace/session include:
> - Live product routes and public site work around `identityprism.xyz`
> - Real Seeker / Seed Vault validation and mobile-wallet flow debugging
> - Black Hole cleanup flow hardening, connected-wallet fixes, Token-2022 backend fixes, metadata/thumbnail pipeline work, and perceived-load improvements
> - Landing/demo overhaul so the public web experience reflects the real app more accurately
> - Release APK builds installed on-device, including hashes recorded during the current work:
>   - `96464B3BF6A226247E61D0BC898C224091CF37C50BEABEDFB2768D893542475B`
>   - `542882E79613C834089B66DB2B6E7D9FD3D6DBCAB97328ACC15A9E08EE23C6D8`
>   - `CE6E77C07FB391FA354A5290CF00DC3D34A108B166A36BE2D780414467BF845D`
>
> The session transcript export prepared for this application is:
> - `C:\solana dapp\codex-session.jsonl`
>
> Note: the current local project snapshot no longer contains `.git`, so this draft does not claim fresh git-log or remote output that could not be verified from the workspace.

**Personal X Profile**
> TODO: add `x.com/<handle>`

**Personal GitHub Profile**
> TODO: add `github.com/<username>` if you want to include it

**Colosseum Crowdedness Score**
> Screenshot generated via Colosseum Copilot API (authenticated, 5,428 projects, 293 winners analysed).
>
> **Primary cluster**: V1-C13 "Solana Privacy & Identity" — 260 projects, 15 winners, 5.8% win rate. Crowdedness: 260/5428.
> **Secondary cluster**: V1-C28 "Web3 Loyalty & Rewards" — 123 projects, 7 winners, 5.7% win rate. Crowdedness: 123/5428.
>
> Most similar existing projects: Solana Reputation Scorer (Crowd:123), ASSAP Anti-Sybil (Crowd:260), Solana Passport (Crowd:260), Proof of Togetherness (Crowd:130).
>
> Winner gap: overindex on oracle (+27%), capital efficiency (+100%), NLP (+24%); underindex on NFTs (−66%), token-gating (−56%), gamification (−57%), tokenized rewards (−100%).
>
> Identity Prism differentiation: only consumer-facing mobile product in its cluster; Black Hole is completely unique; Seeker + Seed Vault hardware-backed identity is absent from all comparable projects.
>
> Screenshot file (upload to Google Drive and replace this line with the link):
> `C:\solana dapp\tmp\colosseum-crowdedness-score.png`
> [PASTE GOOGLE DRIVE SCREENSHOT LINK HERE]

**AI Session Transcript**
> `C:\solana dapp\codex-session.jsonl`

## Step 3: Milestones

**Goals and Milestones**
> 1. Harden the production mobile wallet flow on Seeker and eliminate remaining auth/handoff regressions across JWT, reconnect, and Black Hole entry points.
> 2. Ship the polished public product layer: landing page, card demo, Sybil Check flow, and Black Hole storytelling with strong parity to the real app.
> 3. Finalize Black Hole production quality: candidate quality, loading speed, asset safety guarantees, and clearer reward/cleanup communication.
> 4. Complete launch-grade identity/card UX so wallet trust, rank progression, and mint flows are understandable and usable for real users.
> 5. Package the product for broader launch/demo distribution with stable APK builds, working public web flows, and updated submission materials.

**Primary KPI**
> Proposed KPI: weekly number of wallets that complete wallet verification and receive a live Identity Prism score on mobile.

**Final Tranche Note**
> To receive the final tranche, submit the Colosseum project link, GitHub repo, and AI subscription receipt with the completed grant form.
