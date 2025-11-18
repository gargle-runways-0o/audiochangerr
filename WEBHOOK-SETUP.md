# Webhook Setup

Configure Audiochangerr to receive instant notifications from Plex or Tautulli instead of polling.

## Requirements

**Plex Webhooks:**
- Active Plex Pass subscription
- Network access from Plex server to Audiochangerr

**Tautulli Webhooks:**
- Tautulli installed and running
- Network access from Tautulli to Audiochangerr
- No Plex Pass required

## Webhook vs Polling

**Webhook**: Instant (<1s), minimal API calls, requires Plex Pass or Tautulli
**Polling**: 0-10s delay, constant API calls, no Plex Pass or Tautulli needed

## Which Webhook Source to Use?

| Source | Pros | Cons |
|--------|------|------|
| **Plex** | Direct integration, no middleware, simpler setup | Requires Plex Pass |
| **Tautulli** | No Plex Pass required, already provides monitoring | Extra dependency, slightly more complex |

**Recommendation**: Use Plex webhooks if you have Plex Pass. Use Tautulli if you don't have Plex Pass but already run Tautulli.

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

### 3a. Configure Plex (Option 1)

1. Open Plex Web App
2. Profile icon → Account → Webhooks
3. Add Webhook
4. Enter URL: `http://<audiochangerr-ip>:4444/webhook`
   - Same network: `http://192.168.1.50:4444/webhook`
   - Reverse proxy: `https://your-domain.com/webhook`
5. Save

### 3b. Configure Tautulli (Option 2)

1. Open Tautulli Web Interface
2. Settings → Notification Agents
3. Click "Add a new notification agent"
4. Select "Webhook"
5. Configure notification:
   - **Webhook URL**: `http://<audiochangerr-ip>:4444/webhook`
     - Same machine: `http://localhost:4444/webhook`
     - Same network: `http://192.168.1.50:4444/webhook`
     - Reverse proxy: `https://your-domain.com/webhook`
   - **Webhook Method**: POST
   - **Description**: audiochangerr

6. **Triggers** tab - Enable:
   - ✓ Playback Start
   - ✓ Playback Resume

7. **Data** tab - Choose one of the payload formats below:

   **Option A: Simple Format (Recommended - Easier)**
   ```json
   {
     "event_type": "{action}",
     "rating_key": "{rating_key}",
     "username": "{username}",
     "player_uuid": "{machine_id}",
     "media_type": "{media_type}",
     "title": "{title}"
   }
   ```

   **Option B: Plex-Compatible Format (More complete)**
   ```json
   {
     "event": "media.{action}",
     "Account": {
       "title": "{username}"
     },
     "Player": {
       "title": "{player}",
       "uuid": "{machine_id}"
     },
     "Metadata": {
       "ratingKey": "{rating_key}",
       "librarySectionType": "{media_type}",
       "title": "{title}",
       "year": "{year}"
     }
   }
   ```

8. **Conditions** tab (optional):
   - Add conditions to filter specific libraries, users, or media types
   - Example: Only trigger for Movies library
   - Example: Only trigger for specific users

9. Click "Save"

**Tautulli JSON Payload Variables:**
- `{action}`: "play" or "resume" - playback action type
- `{rating_key}`: Unique media identifier (required)
- `{machine_id}`: Player UUID (required)
- `{username}`: Plex username
- `{player}`: Player/device name
- `{media_type}`: "movie", "episode", "track", etc.
- `{title}`: Media title
- `{year}`: Release year

Both formats are supported. Use Simple Format for easier configuration.

### 4. Test

```bash
./test-webhook.sh
# or
curl http://localhost:4444/health
# Returns: {"status":"ok","service":"audiochangerr-webhook"}
```

**Test Tautulli webhook:**
```bash
curl -X POST http://localhost:4444/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "event_type": "play",
    "rating_key": "12345",
    "username": "testuser",
    "player_uuid": "test-player-uuid",
    "media_type": "movie",
    "title": "Test Movie"
  }'
```

Check logs for:
```
[info] Webhook (Tautulli): event=media.play, user=testuser, ratingKey=12345
```

## Events Processed

**Plex Webhooks:**
| Event | Trigger |
|-------|---------|
| `media.play` | Playback starts |
| `media.resume` | Resume from pause |
| `playback.started` | Owner event |

**Tautulli Webhooks:**
| Event | Mapped To | Trigger |
|-------|-----------|---------|
| `play` | `media.play` | Playback starts |
| `playback.start` | `media.play` | Playback starts |
| `resume` | `media.resume` | Resume from pause |
| `playback.resume` | `media.resume` | Resume from pause |

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

### Tautulli Webhook Issues

**Webhook not triggering**:
1. Check Tautulli notification agent is enabled
2. Verify triggers are enabled (Playback Start, Playback Resume)
3. Check Tautulli logs: Settings → Logs → Notification logs
4. Test the notification agent using Tautulli's "Send Test Notification" button

**Incorrect payload format**:
- Ensure you're using JSON format in the Data tab
- Verify all required fields are present: `event_type`, `rating_key`, `player_uuid`
- Check audiochangerr logs for `[TAUTULLI] Normalizing:` messages

**Wrong event names**:
- Use `{action}` for event_type (not literal "play" or "resume")
- Tautulli will replace `{action}` with actual event name

**Media not being processed**:
- Verify `rating_key` is being sent correctly (check logs)
- Ensure Plex session exists when webhook arrives
- Check that player UUID matches between Tautulli and Plex session

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

### Multi-Layered Security Approach (Recommended)

Audiochangerr implements defense-in-depth security with multiple layers:

#### Layer 1: Application-Level IP Filtering (Default: Enabled)

**Automatic protection against external access:**

```yaml
webhook:
  local_only: true  # Default: blocks IPs not in allowed_networks

  # Optional: customize allowed networks (defaults to private ranges)
  allowed_networks:
    - "192.168.1.0/24"   # Your home network
    - "10.0.0.5"         # Specific VPN server
```

**What it does:**
- ✅ Allows IPs/networks in `allowed_networks` list
- ✅ Default: 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, ::1/128, fe80::/10
- ✅ Supports CIDR notation and individual IPs
- ❌ Blocks all IPs not in allowed list with 403 Forbidden
- 📝 Logs blocked attempts: `[SECURITY] Blocked webhook from <IP> (not in allowed networks)`
- 📋 Logs allowed networks on startup

**When to disable:**
- ⚠️ Only if using authenticated reverse proxy (e.g., nginx with basic auth, OAuth)
- ⚠️ Only if reverse proxy handles IP filtering/authentication

**Customizing allowed networks:**
```yaml
# Example: Restrict to specific subnet only
webhook:
  local_only: true
  allowed_networks:
    - "192.168.1.0/24"   # Only this subnet

# Example: Multiple networks
webhook:
  local_only: true
  allowed_networks:
    - "192.168.1.0/24"   # Home network
    - "10.8.0.0/24"      # VPN network
    - "172.20.0.5"       # Specific server

# Example: Default behavior (all private ranges)
webhook:
  local_only: true
  # allowed_networks not specified = uses defaults
```

#### Layer 2: Docker Network Isolation

**Bind to specific network interface:**

```bash
# Option A: Localhost only (most secure, requires reverse proxy)
docker run -p 127.0.0.1:4444:4444 audiochangerr

# Option B: Specific local IP (recommended for LAN access)
docker run -p 192.168.1.50:4444:4444 audiochangerr

# Option C: All interfaces (relies on app-level filtering)
docker run -p 4444:4444 audiochangerr  # or -p 0.0.0.0:4444:4444
```

**Recommendation:** Use Option B (specific IP) for best balance of security and accessibility.

#### Layer 3: Firewall Rules (Defense in Depth)

**Restrict at OS level:**

```bash
# UFW (Ubuntu/Debian)
sudo ufw allow from 192.168.1.0/24 to any port 4444 proto tcp
sudo ufw deny 4444/tcp

# iptables
sudo iptables -A INPUT -p tcp --dport 4444 -s 192.168.1.0/24 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 4444 -j DROP

# Make iptables persistent (Ubuntu/Debian)
sudo apt-get install iptables-persistent
sudo netfilter-persistent save
```

**Adjust subnet:** Replace `192.168.1.0/24` with your network (e.g., `10.0.0.0/8`, `172.16.0.0/12`)

#### Layer 4: Authentication (Optional, Additional Layer)

**Webhook secret for request validation:**

```yaml
webhook:
  secret: "your-secure-random-string-here"
```

**How to use:**
1. Generate secure random string: `openssl rand -base64 32`
2. Add to config.yaml
3. Configure Plex/Tautulli to send `X-Webhook-Secret: your-secret` header

**Plex:** Does not support custom headers (use other layers)
**Tautulli:** Add custom header in webhook configuration

### Security Levels

| Level | Configuration | Use Case |
|-------|---------------|----------|
| **High** (recommended) | `local_only: true` + Docker IP binding + Firewall | Home networks, general use |
| **Medium** | `local_only: true` + webhook secret | Home networks without firewall access |
| **Low** (not recommended) | `local_only: false` | Only behind authenticated reverse proxy |

### Security Monitoring

**Check logs for blocked attempts:**

```bash
# Docker
docker logs audiochangerr | grep SECURITY

# Standalone
npm start 2>&1 | grep SECURITY
```

**Log examples:**
```
[info] [SECURITY] Network filtering: ENABLED
[info] [SECURITY] Allowed networks: 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, ::1/128, fe80::/10
[warn] [SECURITY] Blocked webhook from 203.0.113.45 (not in allowed networks)
[info] [SECURITY] Webhook authentication: ENABLED
```

### Public Deployment (Advanced)

**If you must expose webhooks publicly** (generally NOT recommended):

1. **Use reverse proxy with authentication:**
   ```nginx
   location /webhook {
       auth_basic "Restricted";
       auth_basic_user_file /etc/nginx/.htpasswd;
       proxy_pass http://localhost:4444/webhook;
   }
   ```

2. **Disable app-level filtering** (proxy handles it):
   ```yaml
   webhook:
     host: "127.0.0.1"
     local_only: false
   ```

3. **Enable HTTPS** (required for public exposure)

4. **Set webhook secret** for additional validation

### Network Testing

**Verify local-only mode is working:**

```bash
# From local machine (should succeed)
curl http://192.168.1.50:4444/webhook

# From external IP (should fail with 403)
curl http://your-public-ip:4444/webhook
# Expected: {"error":"Forbidden: IP not in allowed networks"}
```

**Test with Docker:**
```bash
# Check container network binding
docker port audiochangerr

# Should show:
# 4444/tcp -> 192.168.1.50:4444  (secure)
# NOT:
# 4444/tcp -> 0.0.0.0:4444  (exposed to all interfaces)
```

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
