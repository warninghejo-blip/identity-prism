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
    "description": "Identity Prism is an on-chain reputation and identity layer for Solana. Connect any wallet to get a reputation score (0-1400), celestial tier, achievement badges, and a 3D identity card from real on-chain data.\n\nCore Features:\n- Reputation API (public REST): /api/reputation?address=WALLET\n- On-Chain Attestation: Memo program, co-signed by authority. Works as Solana Blink.\n- Verify Page: identityprism.xyz/verify\n- AI Twitter Agent with wallet auto-reply\n- 3D Solar System (Three.js), 14 scoring factors, 13 badges, 10 tiers\n- Solana Blinks: share card, mint NFT, attest reputation\n- cNFT Minting, Black Hole burner, Android app\n\nLive: https://identityprism.xyz",
    "repoLink": "https://github.com/YourIdentityPrism/identity-prism",
    "solanaIntegration": "1. Helius RPC+DAS: 14-factor reputation scoring\n2. Memo Program: On-chain attestation co-signed by treasury\n3. Metaplex Core: NFT minting\n4. SPL Token analysis\n5. Actions/Blinks: share, mint, attest\n6. Black Hole: token burn + rent reclaim\n7. Reputation REST API",
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
