"""Update Colosseum project — try all remaining approaches including submit."""
import json
from pathlib import Path
from curl_cffi import requests as r

secrets_path = Path("/opt/identityprism-bot/secrets/colosseum-hackathon.json")
with open(secrets_path) as f:
    secrets = json.load(f)

api_key = secrets["apiKey"]
headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

new_desc = (
    "Identity Prism is a wallet reputation and identity experience for Solana. "
    "It uses public on-chain data and server-recorded application signals. The legacy/base identity score spans 0-400; "
    "the current five-pillar composite spans 0-1000, its tier follows that composite, and wallet values are dynamic.\n\n"
    "Core Features:\n"
    "- Reputation API (public REST): /api/reputation?address=WALLET — any dApp can integrate\n"
    "- Optional On-Chain Attestation: explicitly sign a separate Memo snapshot, co-signed by authority. Badge, tier, and game events are not written automatically.\n"
    "- Attestation Verify Page: identityprism.xyz/verify — verify any attestation tx\n"
    "- AI Twitter Agent (@Identity_Prism): Auto-replies with real reputation data when mentioned with a wallet address\n"
    "- 3D Solar System Visualization (Three.js)\n"
    "- Current composite tiers and 13 in-app badge assets\n"
    "- Solana Blinks/Actions: share card, mint NFT, attest reputation\n"
    "- Metaplex Core identity NFT minting\n"
    "- Black Hole token burner\n"
    "- Android app via Capacitor + Solana MWA\n\n"
    "Stack: Vite+React+Three.js, Node.js, Helius DAS, Gemini AI, Metaplex Core, Solana Actions/Blinks, Memo program\n"
    "Live: https://identityprism.xyz"
)

new_solana = (
    "1. Helius RPC + DAS API: Public wallet-data inputs for reputation analysis\n"
    "2. Solana Memo Program: Optional user-signed reputation snapshot, co-signed by treasury authority\n"
    "3. Metaplex Core: Mints identity cards as on-chain NFTs\n"
    "4. SPL Token: SOL payments, token balance analysis for scoring\n"
    "5. Solana Actions/Blinks: Three Blink endpoints — share card, mint NFT, attest reputation\n"
    "6. Black Hole: Burns SPL tokens (TOKEN_PROGRAM + TOKEN_2022), reclaims rent\n"
    "7. Reputation API: Public REST endpoints exposing wallet-analysis signals, not definitive personhood verification"
)

payload = {
    "name": "Identity Prism",
    "slug": "identity-prism",
    "description": new_desc,
    "repoLink": "https://github.com/YourIdentityPrism/identity-prism",
    "solanaIntegration": new_solana,
    "technicalDemoLink": "https://identityprism.xyz",
    "twitterHandle": "Identity_Prism",
    "tags": ["identity", "ai", "consumer", "defi"],
}

# The projects endpoint accepts GET for listing — POST might be for creating
# Try POST /projects (create/update)
resp = r.post("https://agents.colosseum.com/api/projects",
              headers=headers, json=payload, impersonate="chrome131", timeout=15)
print(f"POST /projects: {resp.status_code}")
print(f"  {resp.text[:500]}")

if resp.status_code not in (200, 201):
    # Try submit
    resp2 = r.post("https://agents.colosseum.com/api/projects/identity-prism/submit",
                   headers=headers, json=payload, impersonate="chrome131", timeout=15)
    print(f"\nPOST /projects/identity-prism/submit: {resp2.status_code}")
    print(f"  {resp2.text[:500]}")

# Verify update
resp3 = r.get("https://agents.colosseum.com/api/projects/identity-prism",
              headers=headers, impersonate="chrome131", timeout=15)
proj = resp3.json().get("project", {})
print(f"\nVerification:")
print(f"  repoLink: {proj.get('repoLink')}")
print(f"  desc starts: {proj.get('description', '')[:100]}")
