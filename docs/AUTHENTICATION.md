# Plex Authentication

Audiochangerr v2.0+ supports three authentication methods for connecting to Plex.

## Method 1: PIN Authentication (Recommended)

Interactive authentication using Plex's official PIN flow. **This is the easiest and most secure method.**

### Setup

1. **Configure auth_method in config.yaml:**
   ```yaml
   auth_method: "pin"
   ```

2. **Start Audiochangerr:**
   ```bash
   npm start
   ```

3. **Follow the prompts:**
   ```
   🔐 Plex Authentication Required
   Visit: https://plex.tv/link
   Code: ABCD
   ```

4. **Authorize:**
   - Visit https://plex.tv/link in your browser
   - Enter the displayed code
   - Click "Use this code" when prompted

5. **Done:**
   - Token automatically saved to `.auth.json`
   - Subsequent starts use cached token (no re-auth needed)

### Token Validation

- Token validated on every startup
- Invalid tokens trigger automatic re-authentication
- No manual intervention needed for token refresh

### Docker Usage

PIN authentication works in Docker containers:

```bash
docker run -it audiochangerr
# Follow prompts interactively

# Or for non-interactive (systemd):
# Use auth_method: "env" instead
```

---

## Method 2: Manual Token (Legacy)

Manually extract and configure Plex token. **Not recommended for new setups.**

### Setup

1. **Get your Plex token:**
   - See [GETTING-PLEX-TOKEN.md](GETTING-PLEX-TOKEN.md) for extraction steps

2. **Configure in config.yaml:**
   ```yaml
   auth_method: "token"
   plex_token: "YOUR_PLEX_TOKEN_HERE"
   ```

### Security Warning

- Token stored in plaintext in `config.yaml`
- Must manually update if token expires
- More error-prone than PIN method

### When to Use

- Existing setups migrating to v2.0
- Automated deployments where PIN flow not feasible
- Consider using `auth_method: "env"` instead

---

## Method 3: Environment Variable

Store token in environment variable instead of config file.

### Setup

1. **Set environment variable:**
   ```bash
   export PLEX_TOKEN="your-token-here"
   ```

2. **Configure in config.yaml:**
   ```yaml
   auth_method: "env"
   ```

3. **Start Audiochangerr:**
   ```bash
   npm start
   ```

### Docker Usage

```bash
docker run -e PLEX_TOKEN="your-token-here" audiochangerr
```

Or in docker-compose.yml:
```yaml
environment:
  - PLEX_TOKEN=your-token-here
```

### When to Use

- CI/CD pipelines
- Containerized deployments
- Secret management systems (Kubernetes secrets, etc.)

---

## Authentication Files

### .auth.json

PIN and environment auth methods create `.auth.json` to persist:
- Client identifier (UUID)
- Auth token
- Creation timestamp

**Security:**
- File has `0600` permissions (owner read/write only)
- **Never commit to git** (already in `.gitignore`)
- Delete to force re-authentication

**Location:**
- Docker: `/config/.auth.json`
- Standalone: `./.auth.json`

### Troubleshooting

**Corrupted .auth.json:**
```
Error: Auth file corrupted: /config/.auth.json. Delete it and restart to re-authenticate.
```

**Solution:**
```bash
rm /config/.auth.json  # or ./.auth.json
npm start              # Re-authenticate
```

**Token invalid:**
```
Cached token invalid - re-authenticating...
```

**Solution:**
- Automatic re-auth triggered (PIN flow)
- No manual action needed

**PIN timeout:**
```
Error: PIN authentication timeout (4 minutes). Restart to try again.
```

**Solution:**
- Restart and complete auth within 4 minutes
- Code expires for security

---

## Migration Guide

### From v1.x to v2.0

Existing `plex_token` in config.yaml continues to work:

**Option 1: Keep existing token (no changes needed)**
```yaml
auth_method: "token"  # Add this line
plex_token: "existing-token"  # Keep existing
```

**Option 2: Migrate to PIN (recommended)**
```yaml
auth_method: "pin"  # Change to pin
# plex_token: "..."  # Remove or comment out
```

Then restart - PIN flow activates automatically.

---

## Security Best Practices

1. **Use PIN authentication** - most secure, auto-managed
2. **Never commit tokens** - `.auth.json` and `config.yaml` in `.gitignore`
3. **Restrict .auth.json permissions** - 0600 (owner only)
4. **Use environment variables for CI/CD** - avoid hardcoding tokens
5. **Rotate tokens periodically** - delete `.auth.json` and re-authenticate
6. **Use managed users carefully** - tokens grant full Plex access

---

## Comparison

| Method | Security | Ease of Use | Auto-Refresh | Best For |
|--------|----------|-------------|--------------|----------|
| **PIN** | ⭐⭐⭐ | ⭐⭐⭐ | ✅ | Most users |
| **Token** | ⭐ | ⭐⭐ | ❌ | Legacy/migration |
| **Env** | ⭐⭐ | ⭐⭐ | ❌ | Automation/CI |

**Recommendation:** Use PIN authentication for all new setups.
