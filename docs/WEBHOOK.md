# Webhook Mode

Instant playback detection via Plex or Tautulli webhooks instead of polling.

## Polling vs Webhook

| Feature | Polling | Webhook |
|---------|---------|---------|
| Response | 0-10s delay | <1s (instant) |
| API calls | Constant (360/hr @ 10s) | Event-driven (minimal) |
| Requirements | None | Plex Pass OR Tautulli |
| Setup | Simple | Moderate |
| Resources | Higher (polling) | Lower (events) |

**Use webhook when:** You have Plex Pass or Tautulli, want instant response, prefer event-driven.
**Use polling when:** No Plex Pass/Tautulli, simpler setup preferred.

---

## Quick Setup

### 1. Configure

**config.yaml:**
```yaml
mode: "webhook"

webhook:
  port: 4444
  host: "0.0.0.0"
  path: "/webhook"
  local_only: true
  allowed_networks:
    - "127.0.0.0/8"
    - "192.168.1.0/24"  # Your network
```

### 2. Start

```bash
npm start
# Listen: 0.0.0.0:4444/webhook
# Networks: 127.0.0.0/8, 192.168.1.0/24
```

### 3. Test

```bash
curl http://localhost:4444/health
# {"status":"ok","service":"audiochangerr-webhook","version":"2.0.0"}
```

### 4. Configure Webhook Source

Choose **Plex** (if Plex Pass) or **Tautulli** (if no Plex Pass):

---

## Plex Webhooks

**Requirements:** Active Plex Pass subscription

**Setup:**
1. Open Plex Web App
2. Settings → Your Account → Webhooks
3. Add webhook: `http://YOUR_SERVER_IP:4444/webhook`
4. Save

**Test:** Play media, check logs:
```
[info] Session found: 12345 (1 attempts)
[info] Better: AC3 6ch (302)
```

**Remote Plex Server:**
If Plex runs on different machine, use that machine's IP in allowed_networks.

---

## Tautulli Webhooks

**Requirements:** Tautulli installed

**Setup:**
1. Tautulli → Settings → Notification Agents
2. Add → Webhook
3. Configuration:
   - Webhook URL: `http://YOUR_SERVER_IP:4444/webhook`
   - Method: POST
4. Triggers → Enable:
   - Playback Start
   - Playback Resume
5. Data:
   ```json
   {
     "rating_key": "{rating_key}",
     "player_uuid": "{machine_id}"
   }
   ```
6. Save

**Test:** Play media, check logs.

---

## Network Configuration

### Docker

**Host network (simplest):**
```yaml
docker run --network host audiochangerr
```

**Bridge network:**
```yaml
ports:
  - "4444:4444"
```

**allowed_networks** must include Plex/Tautulli container IP:
```yaml
allowed_networks:
  - "172.17.0.0/16"  # Docker bridge
```

### Firewall

Allow port 4444:
```bash
# UFW
sudo ufw allow 4444/tcp

# firewalld
sudo firewall-cmd --permanent --add-port=4444/tcp
sudo firewall-cmd --reload

# iptables
sudo iptables -A INPUT -p tcp --dport 4444 -j ACCEPT
```

### Reverse Proxy

**Nginx:**
```nginx
location /audiochangerr {
    proxy_pass http://localhost:4444/webhook;
}
```

**Webhook URL:** `http://YOUR_DOMAIN/audiochangerr`

---

## Configuration Reference

### webhook.port
Port for webhook server. Default: 4444

### webhook.host
Bind address. `0.0.0.0` = all interfaces, `127.0.0.1` = localhost only

### webhook.path
Endpoint path. Default: `/webhook`

### webhook.local_only
Restrict to allowed_networks. Default: `true` (recommended)

### webhook.allowed_networks
IP/CIDR ranges allowed. Required when `local_only: true`.

Examples:
```yaml
allowed_networks:
  - "127.0.0.0/8"        # Localhost
  - "192.168.1.0/24"     # Class C
  - "192.168.1.50"       # Single IP
  - "::1/128"            # IPv6 localhost
```

### webhook.secret
Optional header for authentication. Tautulli only.

Tautulli config:
```
Headers: {"X-Webhook-Secret": "your-secret"}
```

### webhook.initial_delay_ms
Delay before session lookup. Allows Plex to update state. Default: 0

Increase if getting "No session" warnings.

### webhook.session_retry
Retry failed session lookups.

```yaml
session_retry:
  max_attempts: 3       # Retry count
  initial_delay_ms: 500 # First retry delay
```

---

## Switching Modes

### To Webhook

**Update config.yaml:**
```yaml
# Remove polling config
# check_interval: 10

# Add webhook config
mode: "webhook"
webhook:
  port: 4444
  host: "0.0.0.0"
  path: "/webhook"
  local_only: true
  allowed_networks:
    - "192.168.1.0/24"
```

**Restart:** Changes require restart

### To Polling

**Update config.yaml:**
```yaml
mode: "polling"
check_interval: 10  # Seconds

# Webhook config ignored in polling mode
```

**Restart**

---

## Troubleshooting

### Webhook not receiving events

**Check health:**
```bash
curl http://localhost:4444/health
```

**Check firewall:**
```bash
# Test from Plex/Tautulli host
curl http://AUDIOCHANGERR_IP:4444/health
```

**Check allowed_networks:**
Logs show: `Blocked X.X.X.X - add to webhook.allowed_networks`

Fix: Add IP to allowed_networks

**Check Plex webhook:**
Settings → Webhooks → Test → Check Recent Webhooks for errors

**Check Tautulli webhook:**
Tautulli logs show connection errors

### "No session" warnings

Webhook arrives before Plex creates session.

**Fix:** Increase initial_delay_ms:
```yaml
webhook:
  initial_delay_ms: 1000  # Try 1 second
```

Or increase retry attempts:
```yaml
session_retry:
  max_attempts: 5
  initial_delay_ms: 500
```

### Port already in use

```
Error: Port 4444 in use
```

**Fix:** Change port or stop conflicting service:
```bash
# Find process using port
sudo lsof -i :4444
# Or
sudo netstat -tulpn | grep 4444
```

### Changes not applied

Verify `dry_run: false` and webhook triggered (check logs).

---

## Security

**Use local_only:**
```yaml
local_only: true
allowed_networks:
  - "192.168.1.0/24"
```

**Use webhook secret (Tautulli):**
```yaml
secret: "random-string-here"
```

**Reverse proxy with auth:**
Better than exposing webhook publicly.

**Don't expose to internet:**
Webhook has no built-in auth (except Tautulli secret).
