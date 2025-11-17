# Audiochangerr

Prevent audio transcoding in Plex by auto-selecting compatible audio tracks.

## How It Works

Detects transcoding sessions → finds compatible audio stream → switches track → terminates session to restart without transcoding.

## Features

- **Dual modes**: Webhook (Plex Pass, instant) or Polling (no Plex Pass, 0-10s delay)
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
```bash
docker run -d \
  --name audiochangerr \
  -v /path/to/config:/config \
  -v /path/to/logs:/logs \
  -p 4444:4444 \
  audiochangerr
```

## Environment Variables

- `LOG_LEVEL`: Logging verbosity (default: `info`, options: `error`, `warn`, `info`, `debug`)

Example:
```bash
LOG_LEVEL=debug npm start
```

Docker:
```bash
docker run -d \
  --name audiochangerr \
  -e LOG_LEVEL=debug \
  -v /path/to/config:/config \
  -p 4444:4444 \
  audiochangerr
```

## Configuration

**Minimal setup** (`config.yaml`):
```yaml
plex_server_url: "http://192.168.1.100:32400"
plex_token: "your-token"
owner_username: "your-username"
mode: "polling"  # or "webhook"
dry_run: true    # false to apply changes
```

**Get Plex token**: Open media in Plex Web → Get Info → View XML → copy `X-Plex-Token` from URL

### Modes

**Polling** (default):
```yaml
mode: "polling"
check_interval: 10  # seconds
```

**Webhook** (requires Plex Pass):
```yaml
mode: "webhook"
webhook:
  port: 4444
  host: "0.0.0.0"
  path: "/webhook"
  secret: ""  # Optional: shared secret for authentication
```

**Security**: Set `webhook.secret` to require `X-Webhook-Secret` header. Recommended for internet-exposed webhooks.

See [WEBHOOK-SETUP.md](WEBHOOK-SETUP.md) for webhook configuration.

### Audio Selection

```yaml
audio_selector:
  - codec: "ac3"
    channels: 6
    language: "original"
    keywords_exclude: ["Commentary"]
  - codec: "aac"
    channels: 2
    language: "original"
```

**Options**:
- `codec`: aac, ac3, eac3, dts, dts-hd, truehd, flac, mp3, opus, vorbis, pcm
- `channels`: 1-8 (2=stereo, 6=5.1, 8=7.1)
- `language`: "original" or ISO code (eng, jpn, spa, etc.)
- `keywords_include`: match any keyword (array)
- `keywords_exclude`: exclude any keyword (array)

Rules process top to bottom. First match wins.

**Config versioning**: Add `config_version: 1` to future-proof config format.

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

## Advanced Examples

**Multiple languages**:
```yaml
audio_selector:
  - codec: "ac3"
    language: "eng"
    channels: 6
  - codec: "ac3"
    language: "original"
    channels: 6
```

**DTS preference**:
```yaml
audio_selector:
  - codec: "dts"
    channels: 6
    keywords_include: ["DTS-HD"]
  - codec: "dts"
    channels: 6
```

**Debug logging**: Set `LOG_LEVEL=debug` environment variable

## Project Structure

```
main.js              # Entry point
config.js            # Config loader
plexClient.js        # Plex API
audioFixer.js        # Session processor
audioSelector.js     # Stream selection
webhookServer.js     # HTTP server
webhookProcessor.js  # Webhook handler
```

## License

GNU GPL v3.0 - See [LICENSE](LICENSE)
