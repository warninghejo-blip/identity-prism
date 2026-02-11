"""Update Colosseum project via their web submission flow."""
import json
from pathlib import Path
from curl_cffi import requests as r

secrets_path = Path("/opt/identityprism-bot/secrets/colosseum-hackathon.json")
with open(secrets_path) as f:
    secrets = json.load(f)

api_key = secrets["apiKey"]
project_id = secrets["project_id"]
team_id = secrets["team_id"]

headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

# First get current project to see all fields
resp = r.get(f"https://agents.colosseum.com/api/projects/identity-prism",
             headers=headers, impersonate="chrome131", timeout=15)
print(f"Current project: {resp.status_code}")
current = resp.json()
proj = current.get("project", {})
print(f"  Keys: {list(proj.keys())}")
print(f"  repoLink: {proj.get('repoLink', '?')}")
print(f"  videoLink: {proj.get('videoLink', '?')}")
print(f"  description length: {len(proj.get('description', ''))}")
print(f"  solanaIntegration length: {len(proj.get('solanaIntegration', ''))}")
# Print full project JSON to see all available fields
for k, v in proj.items():
    if k in ('description', 'solanaIntegration'):
        continue
    print(f"  {k}: {v}")

# Try different update approaches
new_data = {
    "name": "Identity Prism",
    "description": (
        "Identity Prism is an on-chain reputation and identity layer for Solana. "
        "Connect any wallet to get a reputation score (0-1400), celestial tier, achievement badges, "
        "and a stunning 3D identity card — all computed from real on-chain data.\n\n"
        "Core Features:\n"
        "- Reputation API (public REST): /api/reputation?address=WALLET — any dApp can integrate\n"
        "- On-Chain Attestation: Record reputation permanently on Solana via Memo program, co-signed by authority. Works as Solana Blink.\n"
        "- Attestation Verify Page: identityprism.xyz/verify — verify any attestation tx\n"
        "- AI Twitter Agent (@Identity_Prism): Auto-replies with real reputation data when mentioned with a wallet address\n"
        "- 3D Solar System Visualization (Three.js)\n"
        "- 14 scoring factors, 13 badge types, 10 celestial tiers\n"
        "- Solana Blinks/Actions: share card, mint NFT, attest reputation\n"
        "- cNFT Minting via Metaplex Core\n"
        "- Black Hole token burner\n"
        "- Android app via Capacitor + Solana MWA\n\n"
        "Stack: Vite+React+Three.js, Node.js, Helius DAS, Gemini AI, Metaplex Core, Solana Actions/Blinks, Memo program\n"
        "Live: https://identityprism.xyz | API: https://identityprism.xyz/api/reputation?address=YOUR_WALLET"
    ),
    "repoLink": "https://github.com/YourIdentityPrism/identity-prism",
    "solanaIntegration": (
        "1. Helius RPC + DAS API: Wallet tx history, token holdings, NFT collections for 14-factor reputation scoring\n"
        "2. Solana Memo Program: On-chain attestation — writes reputation as JSON memo, co-signed by treasury\n"
        "3. Metaplex Core: Mints identity cards as on-chain NFTs\n"
        "4. SPL Token: SOL payments, token balance analysis\n"
        "5. Solana Actions/Blinks: Three endpoints — share card, mint NFT, attest reputation\n"
        "6. Black Hole: Burns SPL tokens, reclaims rent\n"
        "7. Reputation API: Public REST endpoints for trust assessment"
    ),
}

# Try submitting via /projects endpoint with POST
endpoints_to_try = [
    ("POST", f"/projects"),
    ("POST", f"/projects/identity-prism"),
    ("PUT", f"/projects/identity-prism"),
    ("PATCH", f"/projects/identity-prism"),
    ("POST", f"/projects/{project_id}"),
    ("PUT", f"/projects/{project_id}"),
    ("PATCH", f"/projects/{project_id}"),
    ("POST", f"/teams/{team_id}/project"),
    ("PUT", f"/teams/{team_id}/project"),
    ("POST", f"/hackathons/1/projects/{project_id}"),
    ("PUT", f"/hackathons/1/projects/{project_id}"),
    ("PATCH", f"/hackathons/1/projects/{project_id}"),
]

for method, ep in endpoints_to_try:
    resp = r.request(method, f"https://agents.colosseum.com/api{ep}",
                     headers=headers, json=new_data, impersonate="chrome131", timeout=10)
    if resp.status_code != 404:
        print(f"\n{method} {ep}: {resp.status_code}")
        print(f"  {resp.text[:500]}")
        if resp.status_code in (200, 201):
            print("  >>> SUCCESS!")
            break
