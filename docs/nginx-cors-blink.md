# Nginx CORS for Solana Blink actions

Add to `/etc/nginx/sites-available/identityprism` inside the HTTPS `server { … }` block:

```nginx
    location = /actions.json {
        add_header Access-Control-Allow-Origin "*" always;
        add_header Access-Control-Allow-Methods "GET,OPTIONS" always;
        add_header Access-Control-Allow-Headers "Content-Type, X-Action-Version, X-Blockchain-Ids, X-Wallet-Address, Solana-Client" always;
        if ($request_method = OPTIONS) {
            return 204;
        }
        try_files /actions.json =404;
    }

    location = /.well-known/solana/actions.json {
        add_header Access-Control-Allow-Origin "*" always;
        add_header Access-Control-Allow-Methods "GET,OPTIONS" always;
        add_header Access-Control-Allow-Headers "Content-Type, X-Action-Version, X-Blockchain-Ids, X-Wallet-Address, Solana-Client" always;
        if ($request_method = OPTIONS) {
            return 204;
        }
        try_files /.well-known/solana/actions.json =404;
    }
```

Then:
```bash
nginx -t && systemctl reload nginx
```

Verify:
```bash
curl -s -D - -o /dev/null https://identityprism.xyz/actions.json
curl -s -D - -o /dev/null https://identityprism.xyz/.well-known/solana/actions.json
```
