# Upgrading to v2.0

**Breaking change:** `auth_method` required in config.yaml.

## Quick Fix

Add one line:
```yaml
auth_method: "token"  # Add
plex_token: "..."     # Keep existing
```

## Recommended: Switch to PIN

```yaml
auth_method: "pin"    # Change
# plex_token: "..."   # Remove
```

Then `npm start` and follow prompts.

---

## What's New

- PIN authentication (auto-managed tokens)
- Environment variable auth
- `.auth.json` storage
- Token validation on startup

---

## Errors

| Error | Fix |
|-------|-----|
| `Missing: auth_method` | Add `auth_method: "token"` |
| `plex_token required when auth_method is 'token'` | Add `plex_token` or use `auth_method: "pin"` |

---

**Docs:** [AUTHENTICATION.md](AUTHENTICATION.md) · [CONFIGURATION.md](CONFIGURATION.md)
