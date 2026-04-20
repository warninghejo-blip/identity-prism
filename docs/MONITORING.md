# Monitoring Setup

## Uptime Monitoring

Use UptimeRobot, Better Uptime, or Atlas Uptime.

### Endpoints to monitor

| Endpoint | Environment |
|----------|-------------|
| `https://staging.identityprism.xyz/health` | Staging |
| `https://identityprism.xyz/health` | Production |

### Alert thresholds

- Check interval: **5 minutes**
- Alert after: **2 consecutive failures**
- Expected response: HTTP 200, `{ "ok": true }`

### UptimeRobot quick setup

1. Create a free account at https://uptimerobot.com
2. Add Monitor → HTTP(s)
3. URL: `https://identityprism.xyz/health`
4. Monitoring Interval: 5 minutes
5. Alert Contacts: add email/Telegram
6. Repeat for staging URL

---

## Sentry Error Tracking

### Environment variables required

```
# Server (.env)
SENTRY_DSN=https://<key>@oXXXXXX.ingest.sentry.io/<project-id>
RELEASE=v1.0.33   # optional, for release tracking

# Frontend (.env or Vite build env)
VITE_SENTRY_DSN=https://<key>@oXXXXXX.ingest.sentry.io/<project-id>
VITE_APP_VERSION=v1.0.33   # optional
```

Both DSNs can point to the same Sentry project or separate projects (recommended for server/client separation).

### Sentry dashboard

URL pattern: `https://sentry.io/organizations/<your-org>/projects/<project>/`

### Key metrics to watch

- **Error rate** — Issues tab, filter by `environment:staging` or `environment:production`
- **Performance** — Transactions tab, trace sample rate is 10% (`tracesSampleRate: 0.1`)
- **Alerts** — Configure in Alerts → Create Alert Rule

### Recommended alert rules

1. **Error spike** — trigger when error count > 10 in 5 minutes
2. **New issue** — trigger on any new issue type in production

---

## On-Call Rotation

Placeholder — assign team members here:

| Week | Primary | Secondary |
|------|---------|-----------|
| TBD  | —       | —         |

Update this table when the team grows.

---

## SQLite Persistence

### Primary DB file

- Default path: `server/data/app.db`
- Override path: `APP_DB_PATH=/absolute/path/to/app.db`
- Rate limits stay separate in `ratelimit.db`

### Backup strategy

- Keep dual-write enabled until cutover is explicitly approved
- Back up the live DB daily to `/opt/identityprism/backups/`
- Use copy-based snapshots while the process is running (`app.db`, `app.db-wal`, `app.db-shm`)

### Migration/versioning

- Schema version is tracked with `PRAGMA user_version`
- Additive schema changes only during dual-write
- Seed rule: if a table is empty on startup, it is cold-seeded from the existing JSON file before serving traffic

### Cutover criteria

1. Run dual-write for at least 7 days
2. Compare SQLite rows vs JSON payload counts with no divergence
3. Verify startup migration logs stay at zero on steady-state restarts
4. Remove JSON writes only after a dedicated cutover PR

---

## Health Response Shape

The `/health` endpoint returns:

```json
{
  "ok": true,
  "version": "v1.0.33",
  "uptime_seconds": 3600,
  "deps": {
    "walletDatabase": "loaded",
    "mintedAddresses": "loaded-41",
    "rateLimitStore": "ok",
    "sentry": "configured"
  }
}
```

- `walletDatabase`: `loaded` / `empty` / `unavailable`
- `mintedAddresses`: `loaded-N` (N = count) / `unavailable`
- `rateLimitStore`: `ok` / `unavailable`
- `sentry`: `configured` / `not-configured`
