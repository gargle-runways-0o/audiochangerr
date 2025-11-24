# Getting Your Plex Token

> **⚠️ Legacy Method:** As of v2.0, PIN authentication is recommended. This manual token method still works but requires more steps.
>
> **See [AUTHENTICATION.md](AUTHENTICATION.md) for the easier PIN authentication method.**

---

Your Plex token is required when using `auth_method: "token"` in config.yaml.

## Quick Method (Recommended)

1. Open **Plex Web App** in your browser
2. Play any media item
3. Click the **three dots (···)** → **Get Info**
4. Click **View XML** at the bottom
5. Look in the browser's address bar for `X-Plex-Token=XXXXX`
6. Copy everything after `X-Plex-Token=` (before the next `&` if present)

**Example URL:**
```
https://app.plex.tv/...?X-Plex-Token=xyzABC123...&...
                         ^^^^^^^^^^^^^^^^^^^
                         This is your token
```

## Alternative Methods

### Official Plex Support Articles

- **[Finding an authentication token / X-Plex-Token](https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/)** - Official Plex support documentation
- Covers web browser, mobile apps, and desktop apps

### Community Guides

- **[PlexAPI Documentation - Authentication](https://python-plexapi.readthedocs.io/en/latest/introduction.html#getting-a-plextoken)** - Technical reference with code examples
- **[Reddit: r/PleX Wiki](https://www.reddit.com/r/PleX/wiki/index)** - Community-maintained guides

## Security Considerations

**⚠️ Important:** Your Plex token grants **full access** to your Plex server.

- **Never share** your token publicly (GitHub, forums, Discord, etc.)
- **Never commit** config.yaml with your real token to version control
- **Rotate token** if accidentally exposed (by changing your Plex account password)
- **Use environment variables** or secrets management in production

## Troubleshooting

**Token doesn't work:**
- Ensure no extra spaces or characters were copied
- Token should be alphanumeric, typically 20 characters
- Try generating a new token by logging out and back in

**Token not found in URL:**
- Some Plex clients hide the token - use the web app method above
- Ensure you're logged in to the correct Plex account

**Connection refused:**
- Verify `plex_server_url` is correct (e.g., `http://192.168.1.100:32400`)
- Test server accessibility: `curl http://YOUR_SERVER:32400/status/sessions?X-Plex-Token=YOUR_TOKEN`

## Testing Your Token

Once you have your token, test it:

```bash
# Replace with your values
curl "http://YOUR_PLEX_SERVER:32400/status/sessions?X-Plex-Token=YOUR_TOKEN"
```

**Expected result:** JSON or XML response showing current sessions (may be empty if nothing is playing)

**Error result:** 401 Unauthorized = invalid token, connection refused = wrong server URL

## Next Steps

Add your token to `config.yaml`:

```yaml
plex_server_url: "http://192.168.1.100:32400"
auth_method: "token"  # Required in v2.0+
plex_token: "YOUR_TOKEN_HERE"
owner_username: "your-plex-username"
```

See [CONFIGURATION.md](CONFIGURATION.md) for complete configuration reference.

**Better alternative:** Use PIN authentication instead - see [AUTHENTICATION.md](AUTHENTICATION.md).
