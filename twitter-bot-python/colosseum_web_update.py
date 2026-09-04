"""Try Colosseum main site API for project updates."""
import json
from pathlib import Path
from curl_cffi import requests as r

secrets_path = Path("/opt/identityprism-bot/secrets/colosseum-hackathon.json")
with open(secrets_path) as f:
    secrets = json.load(f)

api_key = secrets["apiKey"]
claim_code = secrets["claimCode"]

# Try the main colosseum.com site endpoints
base_urls = [
    "https://colosseum.com/api",
    "https://www.colosseum.com/api",
    "https://colosseum.com",
]

new_data = {
    "description": "Identity Prism is a wallet reputation and identity experience for Solana, using public on-chain data and server-recorded application signals. The legacy/base identity score spans 0-400; the current five-pillar composite spans 0-1000, its tier follows that composite, and wallet values are dynamic.\n\nCore Features:\n- Reputation API (public REST): /api/reputation?address=WALLET\n- Optional On-Chain Attestation: separate, explicit user-signed Memo snapshot, co-signed by authority; badge, tier, and game events are not written automatically\n- Verify Page: identityprism.xyz/verify\n- AI Twitter Agent with wallet auto-reply\n- 3D Solar System (Three.js), 13 in-app badge assets, current composite tiers\n- Solana Blinks: share card, mint NFT, attest reputation\n- Metaplex Core identity NFT minting, Black Hole burner, Android app\n\nLive: https://identityprism.xyz",
    "repoLink": "https://github.com/warninghejo-blip/identity-prism",
    "solanaIntegration": "1. Helius RPC+DAS: public wallet-data inputs for reputation analysis\n2. Memo Program: optional user-signed attestation snapshot, co-signed by treasury\n3. Metaplex Core: identity NFT minting\n4. SPL Token analysis\n5. Actions/Blinks: share, mint, attest\n6. Black Hole: token burn + rent reclaim\n7. Reputation REST API",
}

# Auth variations
auth_headers_variants = [
    {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
    {"x-api-key": api_key, "Content-Type": "application/json"},
    {"Authorization": api_key, "Content-Type": "application/json"},
    {"Cookie": f"agent_token={api_key}", "Content-Type": "application/json"},
]

# Try agents.colosseum.com with different methods and paths
agent_paths = [
    ("PUT", "/projects/identity-prism"),
    ("PATCH", "/projects/identity-prism"), 
    ("POST", "/projects/identity-prism/update"),
    ("PUT", "/agents/957/project"),
    ("PATCH", "/agents/957/project"),
    ("POST", "/agents/957/project"),
]

print("=== agents.colosseum.com ===")
for method, path in agent_paths:
    for i, h in enumerate(auth_headers_variants):
        resp = r.request(method, f"https://agents.colosseum.com/api{path}",
                        headers=h, json=new_data, impersonate="chrome131", timeout=10)
        if resp.status_code != 404:
            print(f"{method} {path} (auth#{i}): {resp.status_code} — {resp.text[:200]}")
            break

# Check if there's an OpenAPI/swagger
print("\n=== API Discovery ===")
for path in ["/api-docs", "/swagger.json", "/openapi.json", "/docs", "/api"]:
    resp = r.get(f"https://agents.colosseum.com{path}", impersonate="chrome131", timeout=10)
    if resp.status_code == 200:
        print(f"GET {path}: {resp.status_code} — {resp.text[:300]}")
