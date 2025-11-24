# Plex Authentication

Three methods: `pin` (recommended), `token` (legacy), `env` (automation).

## PIN (Recommended)

**config.yaml:**
```yaml
auth_method: "pin"
```

**First run:**
```bash
npm start
# Visit: https://plex.tv/link
# Enter displayed code
# Token auto-saved to .auth.json
```

**Subsequent runs:** Auto-validates, re-auths if invalid.

**Docker:** `docker run -it audiochangerr` (interactive required)

---

## Token (Legacy)

**Get token:**
1. Open Plex Web App
2. Play any media
3. Click **···** → **Get Info** → **View XML**
4. Copy `X-Plex-Token=XXX` from URL

**config.yaml:**
```yaml
auth_method: "token"
plex_token: "YOUR_TOKEN"
```

**Use for:** Existing setups, migration. Consider `env` for automation.

---

## Environment Variable

**Setup:**
```bash
export PLEX_TOKEN="your-token"
```

**config.yaml:**
```yaml
auth_method: "env"
```

**Docker:**
```bash
docker run -e PLEX_TOKEN="token" audiochangerr
```

**Use for:** CI/CD, containers, secret management.

---

## .auth.json

Auto-created by `pin` and `env` methods.

**Contains:** clientId (UUID), token, timestamp
**Location:** `/config/.auth.json` (Docker) or `./.auth.json`
**Permissions:** 0600 (owner only)
**Delete to re-auth**

---

## Troubleshooting

| Error | Fix |
|-------|-----|
| `Auth file corrupted` | `rm .auth.json && npm start` |
| `Token invalid` | Auto re-auth (no action needed) |
| `PIN timeout (4 min)` | Restart, complete faster |

---

## Migration from v1.x

**Keep existing token:**
```yaml
auth_method: "token"  # Add this
plex_token: "..."     # Keep existing
```

**Switch to PIN:**
```yaml
auth_method: "pin"    # Change
# plex_token: "..."   # Remove
```

---

## Comparison

| Method | Security | Ease | Auto-Refresh | Best For |
|--------|----------|------|--------------|----------|
| `pin` | High | Easy | ✅ | Most users |
| `token` | Low | Medium | ❌ | Migration |
| `env` | Medium | Medium | ❌ | CI/CD |
