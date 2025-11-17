# Plex Webhook Integration Setup

This guide explains how to configure Audiochangerr to use Plex webhooks instead of polling.

## Requirements

- **Active Plex Pass subscription** (webhooks are a Plex Pass feature)
- **Network access** from Plex server to Audiochangerr (same network or port forwarding)

## Why Use Webhooks?

**Webhook Mode (Recommended)**:
- ✅ Instant response when playback starts (0-second delay)
- ✅ Minimal API calls to Plex server
- ✅ More efficient resource usage
- ❌ Requires Plex Pass

**Polling Mode (Fallback)**:
- ✅ Works without Plex Pass
- ✅ No network configuration needed
- ❌ 0-10 second delay (depending on `check_interval`)
- ❌ Constant API polling creates load

---

## Configuration

### Step 1: Enable Webhook Mode

Edit `config.yaml`:

```yaml
# Change mode from "polling" to "webhook"
mode: "webhook"

# Webhook configuration
webhook:
  enabled: true
  port: 4444              # Choose any available port
  host: "0.0.0.0"        # Listen on all network interfaces
  path: "/webhook"        # URL path (can be customized)
```

### Step 2: Start Audiochangerr

```bash
npm start
```

You should see:
```
[info] Starting WEBHOOK mode
[info] Webhook endpoint will be: http://0.0.0.0:4444/webhook
[info] Webhook server listening on 0.0.0.0:4444/webhook
[info] Configure Plex webhook URL in: Plex Web App → Account → Webhooks
```

### Step 3: Configure Plex Webhook

1. **Open Plex Web App** in your browser
2. **Click your profile icon** (top right) → **Account**
3. **Navigate to Webhooks** section (under "Settings")
4. **Click "Add Webhook"**
5. **Enter the webhook URL**:
   - Same network: `http://<audiochangerr-ip>:4444/webhook`
   - Example: `http://192.168.1.50:4444/webhook`
   - If using reverse proxy: `https://your-domain.com/webhook`
6. **Click "Save Changes"**

### Step 4: Test the Integration

**Option A: Use the test script**
```bash
./test-webhook.sh
```

**Option B: Play media in Plex**
1. Start playing any media in Plex
2. Watch Audiochangerr logs
3. You should see:
   ```
   [info] Webhook received: event=media.play, user=YourUsername
   [info] Looking for session: media=12345, player=...
   ```

---

## Webhook Events Processed

Audiochangerr responds to these webhook events:

| Event | Description | When Triggered |
|-------|-------------|----------------|
| `media.play` | User starts playback | New playback session starts |
| `media.resume` | User resumes paused media | Paused session resumes |
| `playback.started` | Server owner event | Shared user starts playback |

**Ignored events**: `media.pause`, `media.stop`, `media.rate`, `library.new`, etc.

---

## Network Configuration

### Same Network Setup (Easiest)

If Audiochangerr runs on the same network as Plex:
- Use local IP address: `http://192.168.1.50:4444/webhook`
- Ensure firewall allows port 4444
- No additional configuration needed

### Remote Server Setup

If Audiochangerr runs on a different network:

**Option 1: Reverse Proxy** (Recommended)
```nginx
# nginx example
location /webhook {
    proxy_pass http://localhost:4444/webhook;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

**Option 2: Port Forwarding**
- Forward external port (e.g., 4444) to Audiochangerr server
- Use public IP: `http://<your-public-ip>:4444/webhook`
- ⚠️ **Security warning**: Exposes service to internet

---

## Troubleshooting

### Webhook Not Received

**Check 1: Is the server running?**
```bash
curl http://localhost:4444/health
# Should return: {"status":"ok","service":"audiochangerr-webhook"}
```

**Check 2: Is the port accessible from Plex?**
```bash
# From Plex server, test connectivity
curl -X POST http://<audiochangerr-ip>:4444/webhook \
  -F 'payload={"event":"test"}'
```

**Check 3: Firewall blocking the port?**
```bash
# Allow port 4444 (Linux example)
sudo ufw allow 4444/tcp
```

**Check 4: Correct webhook URL in Plex?**
- Verify URL in Plex Web App → Account → Webhooks
- Must include `http://` or `https://`
- Must include port number if not 80/443
- Path must match config.yaml (`/webhook` by default)

### Webhook Received But Nothing Happens

**Check 1: Enable debug logging**

Edit `logger.js` to set level to 'debug':
```javascript
level: 'debug',  // Change from 'info' to 'debug'
```

**Check 2: View detailed logs**
```bash
npm start 2>&1 | tee audiochangerr.log
```

Look for:
- `[debug] Full webhook payload: ...` - Webhook structure
- `[debug] Looking for session: ...` - Session matching
- `[debug] No active session found...` - Session not yet established (normal)

**Check 3: Timing issues**

Webhooks may arrive before Plex establishes the session in `/status/sessions`:
- This is **normal behavior**
- Webhook arrives → Session not found → Ignored
- Polling cleanup will catch it on next check (webhook mode still polls every 60s for cleanup)

---

## Switching Between Modes

### Webhook → Polling
```yaml
mode: "polling"  # Change in config.yaml
```
Restart the application. Webhook server stops, polling begins.

### Polling → Webhook
```yaml
mode: "webhook"  # Change in config.yaml
```
Restart the application. Configure Plex webhook URL as described above.

---

## Advanced Configuration

### Custom Port

If port 4444 is already in use:
```yaml
webhook:
  port: 8080  # Choose any available port
```

Update Plex webhook URL accordingly.

### Custom Endpoint Path

For security through obscurity:
```yaml
webhook:
  path: "/my-secret-webhook-path-12345"
```

Plex URL becomes: `http://your-ip:4444/my-secret-webhook-path-12345`

### Bind to Specific Interface

To only listen on localhost (requires reverse proxy):
```yaml
webhook:
  host: "127.0.0.1"
```

---

## Security Considerations

Since you're running on a **private server** (as noted in setup):
- ✅ No authentication is required on the webhook endpoint
- ✅ Plex webhook payloads are trusted
- ✅ No webhook signature validation implemented

For **public-facing deployments**:
- ⚠️ Consider adding reverse proxy with authentication
- ⚠️ Use HTTPS with valid certificate
- ⚠️ Implement webhook signature validation (future enhancement)
- ⚠️ Use firewall rules to restrict access to Plex server IPs only

---

## Webhook Payload Example

For reference, here's what Plex sends for a `media.play` event:

```json
{
  "event": "media.play",
  "user": true,
  "owner": true,
  "Account": {
    "id": 1,
    "thumb": "https://plex.tv/users/1234/avatar",
    "title": "username"
  },
  "Server": {
    "title": "My Plex Server",
    "uuid": "abc123..."
  },
  "Player": {
    "local": true,
    "publicAddress": "192.168.1.100",
    "title": "Plex Web (Chrome)",
    "uuid": "player-uuid"
  },
  "Metadata": {
    "ratingKey": "12345",
    "type": "movie",
    "title": "Example Movie",
    ...
  }
}
```

The payload is sent as multipart form data with:
- Field `payload`: JSON string (shown above)
- Field `thumb`: JPEG image (discarded by Audiochangerr)

---

## Performance Comparison

| Metric | Polling (10s) | Webhook |
|--------|---------------|---------|
| Detection latency | 0-10 seconds | <1 second |
| API calls/hour (idle) | 360 | 1 (cleanup) |
| API calls/hour (1 session) | 360+ | 1-3 |
| Resource usage | Medium | Low |
| Plex Pass required | No | Yes |

---

## Support

If you encounter issues:
1. Check this troubleshooting guide first
2. Enable debug logging in `logger.js`
3. Run `./test-webhook.sh` to verify endpoint works
4. Review application logs for detailed error messages
5. Verify Plex webhook configuration in Plex Web App

---

## Migration Notes

**From polling-only version**:
1. Update code (includes new webhook files)
2. Run `npm install` (installs express, multer)
3. Update `config.yaml` with webhook settings
4. Keep `mode: "polling"` initially to test nothing broke
5. Switch to `mode: "webhook"` when ready
6. Configure Plex webhook URL
7. Monitor logs to confirm webhooks received
