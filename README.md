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

```bash
cp config.yaml.example config.yaml
nano config.yaml
```

**Minimum required:**
- `plex_server_url`: `http://192.168.1.100:32400`
- `plex_token`: Get from Plex Web → play media → Get Info → View XML → copy from URL
- `owner_username`: Your Plex username
- `console.enabled` and `console.level`: Required
- `mode`: `"polling"` or `"webhook"`
- `dry_run`: `true` to test, `false` to apply changes

**Documentation:**
- **[CONFIGURATION.md](CONFIGURATION.md)** - Complete field reference
- **[WEBHOOK-SETUP.md](WEBHOOK-SETUP.md)** - Webhook setup (Plex/Tautulli)
- **[config.yaml.example](config.yaml.example)** - Working examples

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
