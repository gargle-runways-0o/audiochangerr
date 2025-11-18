# Audiochangerr

Prevent audio transcoding in Plex by auto-selecting compatible audio tracks.

## How It Works

Detects transcoding sessions → finds compatible audio stream → switches track → terminates session to restart without transcoding.

## Features

- **Dual modes**: Webhook (Plex Pass or Tautulli, instant) or Polling (no Plex Pass, 0-10s delay)
- **Multiple webhook sources**: Native Plex webhooks or Tautulli webhooks
- **Audio selection rules**: codec, channels, language, keywords
- **Dry run mode**: test without changes
- **Docker ready**

## Installation

### Standalone
```bash
git clone https://github.com/your-username/audiochangerr.git
cd audiochangerr
npm install
cp config.yaml.example config.yaml
nano config.yaml
npm start
```

### Docker

**IMPORTANT**: The config.yaml file is NOT included in the Docker image. You must create it from config.yaml.example and provide it via volume mount.

```bash
# 1. Create config.yaml from example
cp config.yaml.example config.yaml
nano config.yaml  # Edit with your settings

# 2. Run container with config volume mount
docker run -d \
  --name audiochangerr \
  -v /path/to/config.yaml:/config/config.yaml:ro \
  -v /path/to/logs:/logs \
  -p 4444:4444 \
  audiochangerr
```

## Configuration

**Quick start:**
```bash
cp config.yaml.example config.yaml
nano config.yaml
```

**Required settings:**
- `plex_server_url`: Your Plex server URL (e.g., `http://192.168.1.100:32400`)
- `plex_token`: Get from Plex Web → play media → Get Info → View XML → copy `X-Plex-Token` from URL
- `owner_username`: Your Plex username (case-sensitive)
- `console.enabled` and `console.level`: Console output settings
- `dry_run`: Set `false` to apply changes (defaults to `true` for safety)

### Modes

**Polling** (default):
```yaml
mode: "polling"
check_interval: 10  # seconds
```

**Webhook** (requires Plex Pass OR Tautulli):
```yaml
mode: "webhook"
webhook:
  port: 4444
  host: "0.0.0.0"
  path: "/webhook"
  local_only: true  # SECURITY: Block external IPs (default: true)
  secret: ""  # Optional: shared secret for authentication
  initial_delay_ms: 0  # Optional: delay before first session lookup
  session_retry:  # Optional: retry if session not found
    max_attempts: 3
    initial_delay_ms: 500
```

**Webhook Sources**:
- **Plex**: Direct integration, requires Plex Pass
- **Tautulli**: No Plex Pass required, requires Tautulli installation

**See [WEBHOOK-SETUP.md](WEBHOOK-SETUP.md) for:**
- Detailed webhook configuration
- Security setup (IP filtering, firewall, authentication)
- Plex and Tautulli setup instructions
- Troubleshooting

**Advanced Webhook Options**:
- `initial_delay_ms`: Delay (in milliseconds) before first session lookup. Useful if webhooks consistently arrive before Plex creates the session. Omit or set to 0 for no delay.
- `session_retry`: Retry configuration if session not found on first attempt. Webhooks sometimes arrive before Plex has fully created the session in its API.
  - `max_attempts`: Total number of lookup attempts (including first attempt). Recommended: 1-5.
  - `initial_delay_ms`: Base delay for exponential backoff between retries. Delays are: delay × 2^0, delay × 2^1, delay × 2^2, etc. Example: 500ms → 500ms, 1000ms, 2000ms, 4000ms.
  - Omit entire `session_retry` section to disable retries (single attempt only).

### Logging

**Console output** (required):
```yaml
console:
  enabled: true   # true/false
  level: "info"   # error, warn, info, debug
```

**File logging** (optional):
```yaml
logging:
  enabled: true
  directory: "/logs"
  max_size: "20m"    # Rotation: 20m, 100k, 1g
  max_files: "14d"   # Retention: 14d, 30d, or file count
  level: "info"
```

Files: `audiochangerr-YYYY-MM-DD.log`. Directory created automatically.

### Audio Selection

Rules process top to bottom. First match wins.

```yaml
audio_selector:
  - codec: "ac3"          # aac, ac3, eac3, dts, dts-hd, truehd, flac, mp3, opus, vorbis, pcm
    channels: 6           # minimum 1-8 (6 matches 6ch or 8ch)
    language: "original"  # "original" or ISO code (eng, jpn, spa)
    keywords_exclude: ["Commentary"]
  - codec: "aac"
    channels: 2
    language: "original"
```

**Full reference:** See [CONFIGURATION.md](CONFIGURATION.md) for complete field documentation and [config.yaml.example](config.yaml.example) for examples.

## Usage

```bash
npm start
```

**Test before production**:
1. Set `dry_run: true`
2. Play media that transcodes
3. Check logs for actions
4. Set `dry_run: false` when ready

**Test webhook**:
```bash
curl http://localhost:4444/health
# Returns: {"status":"ok","service":"audiochangerr-webhook"}
```

## Troubleshooting

**Changes not applied**:
- Check `dry_run: false` in config
- Verify Plex token: `curl "http://plex-server:32400/status/sessions?X-Plex-Token=your-token"`

**Webhook not working**:
- Test endpoint: `curl http://localhost:4444/health`
- Check firewall: `sudo ufw allow 4444/tcp`
- See [WEBHOOK-SETUP.md](WEBHOOK-SETUP.md)

**No sessions detected**:
- Polling: reduce `check_interval`
- Both: verify `owner_username` matches Plex (case-sensitive)

## License

GNU GPL v3.0 - See [LICENSE](LICENSE)
