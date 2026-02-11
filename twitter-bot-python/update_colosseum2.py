"""Try all possible Colosseum API update endpoints."""
import json
from pathlib import Path
from curl_cffi import requests as r

secrets_path = Path("/opt/identityprism-bot/secrets/colosseum-hackathon.json")
with open(secrets_path) as f:
    secrets = json.load(f)

api_key = secrets["apiKey"]
headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

payload = {
    "description": "test update",
    "repoLink": "https://github.com/YourIdentityPrism/identity-prism",
}

endpoints = [
    ("PUT", "/projects/467"),
    ("PATCH", "/projects/467"),
    ("POST", "/projects/467"),
    ("PUT", "/projects/identity-prism/update"),
    ("POST", "/projects/identity-prism/update"),
    ("PUT", "/teams/476/project"),
    ("PATCH", "/teams/476/project"),
    ("POST", "/teams/476/project"),
]

for method, ep in endpoints:
    resp = r.request(method, f"https://agents.colosseum.com/api{ep}",
                     headers=headers, json=payload, impersonate="chrome131", timeout=15)
    code = resp.status_code
    body = resp.text[:200] if code != 404 else "404"
    print(f"{method} {ep}: {code} — {body}")
