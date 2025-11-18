# Switching Between Polling and Webhook Modes

Audiochangerr supports two modes for detecting Plex transcoding sessions:

- **Polling Mode**: Checks for sessions every N seconds (no Plex Pass required)
- **Webhook Mode**: Instant notifications from Plex or Tautulli (requires Plex Pass or Tautulli)

## Mode Comparison

| Feature | Polling | Webhook |
|---------|---------|---------|
| **Response Time** | 0-10s delay | <1s (instant) |
| **API Calls** | Constant (360/hour at 10s interval) | Minimal (only on playback events) |
| **Requirements** | None | Plex Pass OR Tautulli |
| **Setup Complexity** | Simple (config only) | Moderate (webhook URL + network config) |
| **Resource Usage** | Higher (constant polling) | Lower (event-driven) |

## Switching from Polling to Webhook

### Prerequisites

- Active Plex Pass subscription **OR** Tautulli installed
- Network access from Plex/Tautulli to Audiochangerr
- Firewall configured to allow port 4444 (or your custom port)

### Configuration Changes

**Before (Polling):**
```yaml
mode: "polling"
check_interval: 10

# ... other config ...
```

**After (Webhook):**
```yaml
mode: "webhook"

webhook:
  port: 4444
  host: "0.0.0.0"
  path: "/webhook"
  local_only: true
  allowed_networks:
    - "127.0.0.0/8"
    - "192.168.1.0/24"  # Your local network
  initial_delay_ms: 0
  session_retry:
    max_attempts: 3
    initial_delay_ms: 500

# check_interval is ignored in webhook mode (can be removed or left)
```

### Setup Steps

1. **Update config.yaml** with webhook configuration (see above)

2. **Restart Audiochangerr**:
   ```bash
   # Standalone
   npm start

   # Docker
   docker-compose restart audiochangerr
   ```

3. **Verify webhook server started**:
   ```bash
   curl http://localhost:4444/health
   # Expected: {"status":"ok","service":"audiochangerr-webhook","version":"1.0.0"}
   ```

4. **Configure Plex or Tautulli** webhook:
   - See [WEBHOOK-SETUP.md](WEBHOOK-SETUP.md) for detailed instructions

5. **Test webhook reception**:
   ```bash
   ./test-webhook.sh
   ```

6. **Monitor logs** for webhook events during playback

### Troubleshooting

**Webhook server not starting:**
- Check `webhook.enabled: true` (default, can be omitted)
- Verify port 4444 not already in use: `sudo lsof -i :4444`
- Check logs for binding errors

**Webhooks not received:**
- Test health endpoint: `curl http://YOUR_IP:4444/health`
- Check firewall: `sudo ufw allow 4444/tcp`
- Verify Plex/Tautulli can reach the server (same network or reverse proxy)
- Check logs for IP blocking (if using `local_only: true`)

**Webhooks received but sessions not found:**
- Check logs for "No session" warnings
- Increase `webhook.session_retry.max_attempts` to 5
- Increase `webhook.session_retry.initial_delay_ms` to 1000
- Add `webhook.initial_delay_ms: 500` to delay first lookup

## Switching from Webhook to Polling

### When to Switch

- Plex Pass expired
- Tautulli unavailable
- Network complexity (firewall, NAT, VPN issues)
- Troubleshooting webhook timing issues

### Configuration Changes

**Before (Webhook):**
```yaml
mode: "webhook"

webhook:
  port: 4444
  # ... webhook config ...
```

**After (Polling):**
```yaml
mode: "polling"

check_interval: 10  # Seconds between checks (5-30 recommended)

# Webhook config is ignored in polling mode (can be removed or left)
```

### Setup Steps

1. **Update config.yaml** to `mode: "polling"`

2. **Add check_interval** if not present (default: 10 seconds)

3. **Restart Audiochangerr**:
   ```bash
   npm start
   ```

4. **Verify logs show polling mode**:
   ```
   [info] Mode: polling
   [info] Polling: 10s
   ```

5. **Test by starting playback** that triggers transcoding

6. **Monitor logs** - should detect within 0-10 seconds (depending on check_interval)

### Troubleshooting

**High API load:**
- Increase `check_interval` to 15 or 20 seconds
- Monitor Plex server logs for rate limiting

**Slow detection:**
- Decrease `check_interval` to 5 seconds (minimum recommended)
- Consider switching back to webhook mode

## Best Practices

### For Production Use

**Recommended: Webhook Mode**
- Faster response time
- Lower resource usage
- Better user experience

**Use Polling Mode when:**
- No Plex Pass available
- Testing/debugging webhook issues
- Simplified setup requirements

### Configuration Tips

**Webhook Mode:**
- Start with `max_attempts: 3` and `initial_delay_ms: 500`
- Increase if seeing "No session" warnings
- Use `local_only: true` + `allowed_networks` for security
- Consider webhook secret with Tautulli

**Polling Mode:**
- Start with `check_interval: 10`
- Adjust based on API load vs. detection speed trade-off
- 5-10s is good balance for most setups

## Migration Checklist

- [ ] Update `mode` in config.yaml
- [ ] Add mode-specific configuration (check_interval OR webhook section)
- [ ] Restart Audiochangerr
- [ ] Verify startup logs show correct mode
- [ ] Test health endpoint (webhook mode only)
- [ ] Configure Plex/Tautulli webhook URL (webhook mode only)
- [ ] Test with actual transcode scenario
- [ ] Monitor logs for successful processing
- [ ] Adjust retry/interval settings if needed

## Need Help?

- **Webhook Setup**: See [WEBHOOK-SETUP.md](WEBHOOK-SETUP.md)
- **Configuration Reference**: See [CONFIGURATION.md](CONFIGURATION.md)
- **General Setup**: See [README.md](../README.md)
