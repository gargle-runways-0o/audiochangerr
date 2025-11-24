# Audiochangerr

[![Tests](https://github.com/gargle-runways-0o/audiochangerr/actions/workflows/test.yml/badge.svg)](https://github.com/gargle-runways-0o/audiochangerr/actions/workflows/test.yml)
[![Docker](https://github.com/gargle-runways-0o/audiochangerr/actions/workflows/docker.yml/badge.svg)](https://github.com/gargle-runways-0o/audiochangerr/actions/workflows/docker.yml)
[![Docker Hub](https://img.shields.io/docker/v/garglerunways0o/audiochangerr?label=docker)](https://hub.docker.com/r/garglerunways0o/audiochangerr)
[![License](https://img.shields.io/github/license/gargle-runways-0o/audiochangerr)](LICENSE)

Prevent audio transcoding in Plex by auto-selecting compatible audio tracks.

## How It Works

Detects transcoding sessions → finds compatible audio stream → switches track → terminates session to restart without transcoding.

## Features

- **Dual modes**: Webhook (Plex Pass or Tautulli, instant) or Polling (no Plex Pass, 0-10s delay)
- **Multiple webhook sources**: Native Plex webhooks or Tautulli webhooks
- **Audio selection rules**: codec, channels, language, keywords
- **Dry run mode**: test without changes
- **Docker ready**: published to Docker Hub

## Quick Start

### Docker (Recommended)

```bash
# 1. Pull image
docker pull garglerunways0o/audiochangerr:latest

# 2. Create config
curl -o config.yaml https://raw.githubusercontent.com/gargle-runways-0o/audiochangerr/main/config.yaml.example
nano config.yaml  # Edit with your settings

# 3. Run
docker run -d \
  --name audiochangerr \
  -v $(pwd)/config.yaml:/config/config.yaml:ro \
  -v $(pwd)/logs:/logs \
  -p 4444:4444 \
  --restart unless-stopped \
  garglerunways0o/audiochangerr:latest
```

### Standalone

```bash
git clone https://github.com/gargle-runways-0o/audiochangerr.git
cd audiochangerr
npm install
cp config.yaml.example config.yaml
nano config.yaml
npm start
```

## Configuration

### Minimum Required

Create `config.yaml` from the example and configure:

```yaml
plex_server_url: "http://192.168.1.100:32400"
auth_method: "pin"  # "pin", "token", or "env"
owner_username: "your-plex-username"
mode: "polling"     # "polling" or "webhook"
dry_run: true       # false to apply changes

# See config.yaml.example for all options
```

**Authentication setup:** [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md)

### Documentation

- **[config.yaml.example](config.yaml.example)** - Annotated example with all options
- **[docs/AUTHENTICATION.md](docs/AUTHENTICATION.md)** - Plex authentication (PIN/token/env)
- **[docs/CONFIGURATION.md](docs/CONFIGURATION.md)** - Complete field reference
- **[docs/WEBHOOK-SETUP.md](docs/WEBHOOK-SETUP.md)** - Webhook setup (Plex/Tautulli)
- **[docs/SWITCHING-MODES.md](docs/SWITCHING-MODES.md)** - Switch between polling and webhook

## Usage

### First Run (Test Mode)

1. **Start with dry run enabled** (default in example):
   ```yaml
   dry_run: true
   ```

2. **Start the service**:
   ```bash
   # Standalone
   npm start

   # Docker
   docker-compose up -d
   docker logs -f audiochangerr
   ```

3. **Play media that transcodes audio**

4. **Check logs** for detected transcodes and proposed changes:
   ```
   [info] Transcode: 12345
   [info] Better: AC3 6ch (302)
   [info] [DRY] Set audio: part=456 stream=302
   ```

5. **Enable changes** when ready:
   ```yaml
   dry_run: false
   ```

### Health Check

**Webhook mode:**
```bash
curl http://localhost:4444/health
# Returns: {"status":"ok","service":"audiochangerr-webhook","version":"2.0.0"}
```

**Polling mode:** Check startup logs for successful initialization

## Troubleshooting

### Changes not applied
- Verify `dry_run: false` in config.yaml
- Check Plex token is valid:
  ```bash
  curl "http://YOUR_SERVER:32400/status/sessions?X-Plex-Token=YOUR_TOKEN"
  ```
- Review logs for errors

### Webhook not working
- Test health endpoint: `curl http://localhost:4444/health`
- Verify firewall allows port 4444: `sudo ufw allow 4444/tcp`
- Check `allowed_networks` includes Plex/Tautulli IP
- See [docs/WEBHOOK-SETUP.md](docs/WEBHOOK-SETUP.md) for detailed setup

### No sessions detected
- **Polling mode**: Reduce `check_interval` (try 5 seconds)
- **Both modes**: Verify `owner_username` matches Plex exactly (case-sensitive)
- Enable debug logging: `console.level: "debug"`

### Debug Logging

Enable detailed logs for troubleshooting:

```yaml
console:
  enabled: true
  level: "debug"  # error, warn, info, or debug
```

See [docs/CONFIGURATION.md#debug-output-examples](docs/CONFIGURATION.md#debug-output-examples) for log interpretation.

## Architecture

- **Polling Mode**: Checks Plex API every N seconds for transcoding sessions
- **Webhook Mode**: Receives instant notifications from Plex/Tautulli when playback starts
- **Audio Selection**: First-match-wins rules based on codec, channels, language, keywords
- **Session Validation**: Confirms track switch succeeded and transcoding stopped

## Contributing

Contributions welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Run tests: `npm test`
4. Submit a pull request

## License

GNU GPL v3.0 - See [LICENSE](LICENSE)

## Links

- **Docker Hub**: https://hub.docker.com/r/garglerunways0o/audiochangerr
- **GitHub**: https://github.com/gargle-runways-0o/audiochangerr
- **Issues**: https://github.com/gargle-runways-0o/audiochangerr/issues
