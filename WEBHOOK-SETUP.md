# Webhook Setup

Configure Audiochangerr to receive instant Plex notifications instead of polling.

## Requirements

- Active Plex Pass subscription
- Network access from Plex server to Audiochangerr

## Webhook vs Polling

**Webhook**: Instant (<1s), minimal API calls, requires Plex Pass
**Polling**: 0-10s delay, constant API calls, no Plex Pass needed

## Setup

### 1. Configure Mode

Edit `config.yaml`:
```yaml
mode: "webhook"

webhook:
  port: 4444
  host: "0.0.0.0"
  path: "/webhook"
```

### 2. Start Server

```bash
npm start
```

Expected output:
```
[info] Starting WEBHOOK mode
[info] Webhook endpoint will be: http://0.0.0.0:4444/webhook
```

### 3. Configure Plex

1. Open Plex Web App
2. Profile icon → Account → Webhooks
3. Add Webhook
4. Enter URL: `http://<audiochangerr-ip>:4444/webhook`
   - Same network: `http://192.168.1.50:4444/webhook`
   - Reverse proxy: `https://your-domain.com/webhook`
5. Save

### 4. Test

```bash
./test-webhook.sh
# or
curl http://localhost:4444/health
# Returns: {"status":"ok","service":"audiochangerr-webhook"}
```

## Events Processed

| Event | Trigger |
|-------|---------|
| `media.play` | Playback starts |
| `media.resume` | Resume from pause |
| `playback.started` | Owner event |

Ignored: `media.pause`, `media.stop`, `media.rate`, `library.new`

## Network Configuration

### Same Network
```
URL: http://192.168.1.50:4444/webhook
Firewall: allow port 4444
```

### Remote/Different Network

**Reverse proxy** (recommended):
```nginx
location /webhook {
    proxy_pass http://localhost:4444/webhook;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

**Port forwarding**: Forward 4444 to Audiochangerr (⚠️ exposes service)

## Troubleshooting

### Webhook Not Received

**Server running?**
```bash
curl http://localhost:4444/health
```

**Port accessible from Plex?**
```bash
curl -X POST http://<audiochangerr-ip>:4444/webhook -F 'payload={"event":"test"}'
```

**Firewall blocking?**
```bash
sudo ufw allow 4444/tcp
```

**Correct URL in Plex?**
- Must include `http://` or `https://`
- Must include port if not 80/443
- Path must match config (`/webhook` default)

### Webhook Received, Nothing Happens

**Enable debug logging**: Edit `logger.js`, set `level: 'debug'`

**Check logs**:
```bash
npm start 2>&1 | tee audiochangerr.log
```

Look for:
- `[debug] Full webhook payload: ...`
- `[debug] Looking for session: ...`
- `[debug] No active session found...` (normal - timing issue)

**Timing**: Webhook may arrive before session established in `/status/sessions`. This is normal. Background cleanup polls every 60s.

## Mode Switching

**To polling**:
```yaml
mode: "polling"
```
Restart app.

**To webhook**:
```yaml
mode: "webhook"
```
Restart app, configure Plex URL.

## Advanced

**Custom port**:
```yaml
webhook:
  port: 8080
```

**Custom path**:
```yaml
webhook:
  path: "/my-secret-path"
```

**Localhost only** (requires reverse proxy):
```yaml
webhook:
  host: "127.0.0.1"
```

## Security

**Private server**: No authentication needed.

**Public deployment**:
- Use reverse proxy with authentication
- Enable HTTPS
- Restrict firewall to Plex server IPs

## Performance

| Metric | Polling (10s) | Webhook |
|--------|---------------|---------|
| Latency | 0-10s | <1s |
| API calls/hour (idle) | 360 | 1 |
| Plex Pass | No | Yes |

## Migration from Polling

```bash
npm install  # Installs express, multer
# Edit config.yaml, set mode: "webhook"
npm start
# Configure Plex webhook URL
```
