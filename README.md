# Audiochangerr

Automatically prevent audio transcoding in Plex by selecting optimal audio tracks for your playback sessions.

## What It Does

Audiochangerr monitors your Plex server for transcoding sessions and automatically switches to compatible audio tracks when available. This helps prevent unnecessary transcoding, reducing server load and improving playback performance.

When Plex transcodes audio (usually due to incompatible codecs or channels), Audiochangerr:
1. Detects the transcoding session
2. Checks available audio streams on the media
3. Selects the best compatible stream based on your preferences
4. Switches the session to that stream
5. Terminates the transcoding session to force a restart with the new stream

## Features

- **Dual Operation Modes**:
  - **Webhook Mode**: Real-time response using Plex webhooks (requires Plex Pass)
  - **Polling Mode**: Periodic checking (works without Plex Pass)

- **Intelligent Audio Selection**: Configurable rules to prioritize audio streams by:
  - Codec (AC3, AAC, DTS, etc.)
  - Channel count (5.1, stereo, etc.)
  - Language (original or specific languages)
  - Keywords (include/exclude commentary, descriptive audio, etc.)

- **Dry Run Mode**: Test configuration without making actual changes

- **Comprehensive Logging**: Track all detection and switching events with Winston logger

- **Docker Support**: Easy deployment with Docker container

## Requirements

- Node.js 14+ (if running standalone)
- Plex Media Server
- Plex authentication token
- **Plex Pass subscription** (optional, only required for webhook mode)

## Installation

### Option 1: Standalone

```bash
# Clone the repository
git clone https://github.com/your-username/audiochangerr.git
cd audiochangerr

# Install dependencies
npm install

# Configure (see Configuration section below)
cp config.yaml.example config.yaml
nano config.yaml

# Run
npm start
```

### Option 2: Docker

```bash
# Clone the repository
git clone https://github.com/your-username/audiochangerr.git
cd audiochangerr

# Build the image
docker build -t audiochangerr .

# Run with volume mounts for configuration
docker run -d \
  --name audiochangerr \
  -v /path/to/config:/config \
  -v /path/to/logs:/logs \
  -p 4444:4444 \
  audiochangerr
```

### Docker Compose

```yaml
version: '3.8'
services:
  audiochangerr:
    build: .
    container_name: audiochangerr
    volumes:
      - ./config:/config
      - ./logs:/logs
    ports:
      - "4444:4444"  # Required for webhook mode
    restart: unless-stopped
```

## Configuration

### Basic Setup

Edit `config.yaml` with your Plex server details:

```yaml
# Plex Server Configuration
plex_server_url: "http://192.168.1.100:32400"  # Your Plex server URL
plex_token: "your-plex-token-here"             # Your Plex authentication token
owner_username: "your-plex-username"           # Plex server owner username

# Operation Mode
mode: "polling"  # Options: "polling" or "webhook"

# Dry Run Mode (recommended for initial testing)
dry_run: true    # Set to false to actually make changes
```

### Getting Your Plex Token

1. Open a media item in Plex Web App
2. Click the three dots (...) → "Get Info"
3. Click "View XML"
4. Look for `X-Plex-Token=` in the URL
5. Copy the token value

Alternatively, see [Plex's official guide](https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/).

### Operation Modes

#### Polling Mode (Default)

```yaml
mode: "polling"
check_interval: 10  # Check every 10 seconds
```

**Pros**: Works without Plex Pass, no network configuration needed
**Cons**: 0-10 second delay, constant API polling

#### Webhook Mode (Recommended)

```yaml
mode: "webhook"

webhook:
  enabled: true
  port: 4444
  host: "0.0.0.0"
  path: "/webhook"
```

**Pros**: Instant response (<1 second), minimal API calls, efficient
**Cons**: Requires Plex Pass subscription

See [WEBHOOK-SETUP.md](WEBHOOK-SETUP.md) for detailed webhook configuration instructions.

### Audio Selection Rules

Configure your preferred audio streams with the `audio_selector` array:

```yaml
audio_selector:
  # Rule 1: Prefer AC3 5.1 in original language
  - codec: "ac3"
    channels: 6
    language: "original"
    keywords_exclude: ["Commentary", "commentary"]

  # Rule 2: Fall back to AC3 stereo
  - codec: "ac3"
    channels: 2
    language: "original"
    keywords_exclude: ["Commentary", "commentary"]

  # Rule 3: AAC 5.1 if AC3 not available
  - codec: "aac"
    channels: 6
    language: "original"
    keywords_exclude: ["Commentary", "commentary"]
```

**Rule Processing**:
- Rules are evaluated top to bottom
- First matching stream wins
- If no rules match, no change is made

**Available Options**:
- `codec`: Audio codec (e.g., "ac3", "aac", "dts", "truehd")
- `channels`: Minimum channel count (2 = stereo, 6 = 5.1, 8 = 7.1)
- `language`: Language code (e.g., "eng", "jpn") or "original" for media's default
- `keywords_include`: Stream title must contain at least one keyword
- `keywords_exclude`: Stream title must NOT contain any of these keywords

## Usage

### Starting Audiochangerr

```bash
npm start
```

You should see output like:

```
[info] Configuration loaded successfully
[info] Mode: polling
[info] Dry run: ENABLED
[info] Plex client initialized
[info] Starting POLLING mode (interval: 10s)
[info] Audiochangerr is now running
```

### Testing Before Production

1. Start with `dry_run: true` in config.yaml
2. Play media that would normally transcode audio
3. Check logs to see what Audiochangerr would do:
   ```
   [info] Active sessions: 1
   [info] Found transcoding session: ratingKey=12345, user=username
   [info] [DRY RUN] Would select: AC3 5.1 (English)
   [info] [DRY RUN] Would terminate session to apply changes
   ```
4. Once satisfied, set `dry_run: false` and restart

### Webhook Testing

For webhook mode, test the endpoint:

```bash
./test-webhook.sh
```

Or manually:

```bash
curl http://localhost:4444/health
```

Expected response: `{"status":"ok","service":"audiochangerr-webhook"}`

## How It Works

### Polling Mode Flow

```
1. Every N seconds (check_interval):
   → Fetch active sessions from Plex
   → Find sessions that are transcoding
   → For each transcoding session:
     → Fetch media metadata
     → Find available audio streams
     → Apply selection rules
     → Switch to best compatible stream
     → Terminate session to force restart
```

### Webhook Mode Flow

```
1. Plex sends webhook when media plays/resumes
   → Parse webhook payload
   → Fetch active sessions
   → Match webhook event to session
   → For transcoding sessions:
     → Fetch media metadata
     → Find available audio streams
     → Apply selection rules
     → Switch to best compatible stream
     → Terminate session to force restart

2. Background cleanup (every 60 seconds):
   → Remove processed entries for ended sessions
```

## Troubleshooting

### Changes Not Applied

**Check 1**: Verify dry run is disabled
```yaml
dry_run: false
```

**Check 2**: Check logs for errors
```
[error] Failed to switch audio stream: ...
```

**Check 3**: Ensure Plex token is valid
```bash
curl "http://your-plex-server:32400/status/sessions?X-Plex-Token=your-token"
```

### Webhook Not Working

See the comprehensive [WEBHOOK-SETUP.md](WEBHOOK-SETUP.md) guide for webhook troubleshooting.

Quick checks:
```bash
# Test endpoint is accessible
curl http://localhost:4444/health

# Test from Plex server network
curl http://audiochangerr-ip:4444/health

# Check firewall allows port 4444
sudo ufw allow 4444/tcp
```

### No Sessions Detected

**Polling mode**: Ensure `check_interval` is short enough (try 5-10 seconds)

**Both modes**: Verify username matches Plex owner:
```yaml
owner_username: "exact-plex-username"  # Case-sensitive
```

## Advanced Configuration

### Multiple Audio Languages

```yaml
audio_selector:
  # Prefer English AC3
  - codec: "ac3"
    language: "eng"
    channels: 6

  # Fall back to original language AC3
  - codec: "ac3"
    language: "original"
    channels: 6
```

### DTS Preference

```yaml
audio_selector:
  # Prefer DTS-HD
  - codec: "dts"
    channels: 6
    keywords_include: ["DTS-HD"]

  # Fall back to regular DTS
  - codec: "dts"
    channels: 6
```

### Exclude Commentary Tracks

```yaml
audio_selector:
  - codec: "ac3"
    channels: 6
    language: "original"
    keywords_exclude: ["Commentary", "commentary", "Director", "Cast"]
```

## Logging

Logs include:
- Session detection and transcoding status
- Audio stream selection decisions
- API communication with Plex
- Errors and warnings

Log levels can be adjusted in `logger.js`:
```javascript
level: 'info',  // Options: 'debug', 'info', 'warn', 'error'
```

Enable debug logging for detailed troubleshooting:
```javascript
level: 'debug',
```

## Project Structure

```
audiochangerr/
├── main.js              # Application entry point
├── config.js            # Configuration loader
├── configBuilder.js     # Config validation and building
├── plexClient.js        # Plex API client
├── audioFixer.js        # Session processing logic
├── audioSelector.js     # Audio stream selection rules
├── webhookServer.js     # Express HTTP server for webhooks
├── webhookProcessor.js  # Webhook payload processing
├── logger.js            # Winston logger configuration
├── config.yaml          # User configuration
├── package.json         # Dependencies
├── Dockerfile           # Docker container definition
└── WEBHOOK-SETUP.md     # Detailed webhook guide
```

## Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

This project is licensed under the GNU General Public License v3.0. See [LICENSE](LICENSE) for details.

## Acknowledgments

- Built for the Plex community
- Webhook integration inspired by Plex Pass features
- Audio detection logic based on Plex API capabilities

## Support

For issues, questions, or feature requests:
- Open an issue on GitHub
- Check [WEBHOOK-SETUP.md](WEBHOOK-SETUP.md) for webhook-specific problems
- Enable debug logging for detailed diagnostics

---

**Note**: This tool modifies active Plex sessions. Always test with `dry_run: true` before production use.
