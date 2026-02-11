"""Extract all Colosseum credentials and explore update mechanisms."""
import json
from pathlib import Path
from curl_cffi import requests as r

secrets_path = Path("/opt/identityprism-bot/secrets/colosseum-hackathon.json")
with open(secrets_path) as f:
    secrets = json.load(f)

print("=== COLOSSEUM CREDENTIALS ===")
for k, v in secrets.items():
    print(f"  {k}: {v}")

api_key = secrets["apiKey"]
headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

# Try to find project update endpoints
print("\n=== TESTING ENDPOINTS ===")

# Try claim URL
claim_url = secrets.get("claimUrl", "")
if claim_url:
    resp = r.get(claim_url, impersonate="chrome131", timeout=15, allow_redirects=False)
    print(f"GET claimUrl: {resp.status_code}")
    if resp.status_code in (301, 302, 303, 307):
        print(f"  Redirects to: {resp.headers.get('location', '?')}")
    else:
        print(f"  Body: {resp.text[:300]}")

# Try submissions endpoint
for ep in [
    "/submissions",
    "/submissions/467",
    f"/agents/957/project",
    "/hackathons/1/projects/467",
    "/hackathons/1/submissions",
    "/projects",
    "/projects/identity-prism/edit",
]:
    resp = r.get(f"https://agents.colosseum.com/api{ep}", headers=headers, impersonate="chrome131", timeout=10)
    if resp.status_code != 404:
        print(f"GET {ep}: {resp.status_code} — {resp.text[:200]}")

# Try POST to update project with ID
for ep in [
    "/projects/467/update",
    "/projects/identity-prism/submit",
    "/submissions/467",
]:
    resp = r.post(f"https://agents.colosseum.com/api{ep}", headers=headers,
                  json={"repoLink": "https://github.com/YourIdentityPrism/identity-prism"},
                  impersonate="chrome131", timeout=10)
    if resp.status_code != 404:
        print(f"POST {ep}: {resp.status_code} — {resp.text[:200]}")

# Check Colosseum main site for project edit
print("\n=== COLOSSEUM WEB UI ===")
resp = r.get("https://www.colosseum.com/hackathon/agent/submit",
             headers={"Cookie": f"token={api_key}"}, impersonate="chrome131", timeout=15, allow_redirects=False)
print(f"GET /hackathon/agent/submit: {resp.status_code}")
if resp.status_code in (301, 302):
    print(f"  Redirects to: {resp.headers.get('location', '?')}")
