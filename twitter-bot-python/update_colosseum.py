"""Update Colosseum project submission with latest features."""
import json
from pathlib import Path
from curl_cffi import requests as r

secrets_path = Path("/opt/identityprism-bot/secrets/colosseum-hackathon.json")
with open(secrets_path) as f:
    secrets = json.load(f)

api_key = secrets["apiKey"]
project_slug = secrets["project_slug"]
headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

updated = {
    "description": (
        "Identity Prism is an on-chain reputation and identity layer for Solana. "
        "Connect any wallet to get a reputation score (0–1400), celestial tier, achievement badges, "
        "and a stunning 3D identity card — all computed from real on-chain data.\n\n"
        "Core Features:\n"
        "- Reputation API (public REST): GET /api/reputation?address=WALLET — any dApp can integrate for trust scoring, sybil detection, or gating\n"
        "- On-Chain Attestation: Record reputation permanently on Solana via Memo program, co-signed by authority. Works as a Solana Blink.\n"
        "- Attestation Verification: https://identityprism.xyz/verify — verify any attestation tx on-chain\n"
        "- AI Twitter Agent (@Identity_Prism): Auto-replies with real reputation data when mentioned with a wallet address. "
        "Posts threads, trend reactions, quotes with AI-generated images (Gemini Imagen).\n"
        "- 3D Solar System Visualization: planets=tokens, moons=NFTs, dust=activity (Three.js)\n"
        "- Multi-Factor Scoring: SOL balance, wallet age, tx count, NFTs, DeFi/LST, meme holdings, blue chips. "
        "14 scoring factors, 13 badge types, 10 celestial tiers.\n"
        "- Solana Blinks/Actions: Share identity card, mint as NFT, attest reputation — all from any Blink-compatible wallet\n"
        "- cNFT Minting: Mint identity as on-chain NFT via Metaplex Core\n"
        "- Black Hole: Burn unwanted SPL tokens, reclaim rent SOL\n"
        "- Mobile: Android app via Capacitor + Solana MWA\n\n"
        "Stack: Vite+React+Three.js, Node.js, Helius DAS API, Gemini AI (text+Imagen), "
        "Metaplex Core, Solana Actions/Blinks, Solana Memo program, curl_cffi, Capacitor.\n"
        "Live: https://identityprism.xyz | API: https://identityprism.xyz/api/reputation?address=YOUR_WALLET"
    ),
    "repoLink": "https://github.com/YourIdentityPrism/identity-prism",
    "solanaIntegration": (
        "1. Helius RPC + DAS API: Wallet tx history, token holdings, NFT collections, DeFi positions — "
        "all fed into 14-factor reputation scoring engine\n"
        "2. Solana Memo Program: On-chain attestation — writes reputation score as JSON memo, "
        "co-signed by treasury authority keypair. Verifiable by any smart contract or dApp.\n"
        "3. Metaplex Core: Mints identity cards as on-chain NFTs with full collection verification\n"
        "4. SPL Token: SOL payments for minting, token balance analysis for scoring\n"
        "5. Solana Actions/Blinks: Three Blink endpoints — share card, mint NFT, attest reputation. "
        "All work from Phantom, Backpack, Dialect, and any Blink-compatible client.\n"
        "6. Black Hole: Burns SPL tokens (TOKEN_PROGRAM + TOKEN_2022), reclaims rent via closeAccount\n"
        "7. Reputation API: Public REST endpoints that any Solana dApp can call to assess wallet trust, "
        "gate features, or detect sybils — no SDK needed, just HTTP GET."
    ),
}

# Try PATCH first, then PUT
for method in ["PATCH", "PUT"]:
    resp = r.request(
        method,
        f"https://agents.colosseum.com/api/projects/{project_slug}",
        headers=headers,
        json=updated,
        impersonate="chrome131",
        timeout=30,
    )
    print(f"{method} /projects/{project_slug}: {resp.status_code}")
    print(resp.text[:1000])
    if resp.status_code in (200, 201, 204):
        print("SUCCESS!")
        break
    print()
