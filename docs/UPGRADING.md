# Upgrading to v2.0

## Breaking Changes

v2.0 requires `auth_method` field in `config.yaml`.

## Quick Migration

### Existing Users (Keep Current Token)

Add one line to `config.yaml`:

```yaml
auth_method: "token"  # Add this
plex_token: "existing-token"  # Keep existing
```

**Done.** No other changes needed.

---

### New Authentication (Recommended)

Migrate to PIN authentication for better security:

1. **Update config.yaml:**
   ```yaml
   auth_method: "pin"  # Change this
   # plex_token: "..."  # Remove this line
   ```

2. **Restart:**
   ```bash
   npm start
   ```

3. **Follow prompts:**
   - Visit https://plex.tv/link
   - Enter displayed code
   - Done - token auto-saved

---

## What Changed

### v2.0.0

**Added:**
- PIN-based authentication (recommended)
- Environment variable auth support
- `.auth.json` for token storage
- Client identifier tracking
- Automatic token validation

**Changed:**
- **BREAKING:** `auth_method` now required in config.yaml
- `plex_token` now optional (only for `auth_method: token`)

**Migration:**
- Add `auth_method: "token"` to keep existing setup working
- Or switch to `auth_method: "pin"` for better security

---

## Troubleshooting

**Error: Missing: auth_method**
```
throw new Error('Missing: auth_method')
```

**Fix:** Add `auth_method: "token"` to config.yaml

---

**Error: plex_token required when auth_method is 'token'**

**Fix:** Either:
1. Add `plex_token` to config.yaml, or
2. Change to `auth_method: "pin"`

---

## Full Documentation

- [Authentication Guide](AUTHENTICATION.md) - All auth methods
- [Configuration Reference](CONFIGURATION.md) - All config options
- [Getting Plex Token](GETTING-PLEX-TOKEN.md) - Manual token extraction (legacy)
