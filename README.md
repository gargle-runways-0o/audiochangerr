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
validation_timeout_seconds: 120
mode: "polling"  # or "webhook"
dry_run: true    # false to apply changes
```

**Get Plex token**: Open media in Plex Web → Get Info → View XML → copy `X-Plex-Token` from URL

**validation_timeout_seconds**: Maximum time (in seconds) to wait for session restart validation after switching audio tracks. After this timeout, the processing cache is cleared and the media can be processed again. Recommended: 60-180 seconds.

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
  secret: ""  # Optional: shared secret for authentication
  initial_delay_ms: 0  # Optional: delay before first session lookup
  session_retry:  # Optional: retry if session not found
    max_attempts: 3
    initial_delay_ms: 500
```

**Webhook Sources**:
- **Plex**: Direct integration, requires Plex Pass
- **Tautulli**: No Plex Pass required, requires Tautulli installation

**Security**: Set `webhook.secret` to require `X-Webhook-Secret` header. Recommended for internet-exposed webhooks.

**Advanced Webhook Options**:
- `initial_delay_ms`: Delay (in milliseconds) before first session lookup. Useful if webhooks consistently arrive before Plex creates the session. Omit or set to 0 for no delay.
- `session_retry`: Retry configuration if session not found on first attempt. Webhooks sometimes arrive before Plex has fully created the session in its API.
  - `max_attempts`: Total number of lookup attempts (including first attempt). Recommended: 1-5.
  - `initial_delay_ms`: Base delay for exponential backoff between retries. Delays are: delay × 2^0, delay × 2^1, delay × 2^2, etc. Example: 500ms → 500ms, 1000ms, 2000ms, 4000ms.
  - Omit entire `session_retry` section to disable retries (single attempt only).

See [WEBHOOK-SETUP.md](WEBHOOK-SETUP.md) for detailed webhook configuration (Plex and Tautulli).

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

## Configuration Reference

### Core Settings

#### `plex_server_url`
**Type**: String
**Required**: Yes
**Description**: The full URL to your Plex Media Server, including protocol and port. This is the base URL used for all API communications.
**Example**: `http://192.168.1.100:32400` or `https://plex.example.com`

#### `plex_token`
**Type**: String
**Required**: Yes
**Description**: Authentication token for accessing the Plex API. Required for all operations. To obtain your token, open any media item in Plex Web, click "Get Info", then "View XML". Copy the `X-Plex-Token` parameter from the URL.
**Security**: Keep this token secure. Anyone with this token has full access to your Plex server.

#### `owner_username`
**Type**: String
**Required**: Yes
**Description**: The username of the Plex server owner. Sessions are filtered to only process media played by this user. This is case-sensitive and must match exactly as it appears in Plex.
**Note**: This ensures Audiochangerr only modifies sessions for the server owner, not shared users.

#### `mode`
**Type**: String
**Required**: Yes
**Default**: `polling`
**Options**: `webhook`, `polling`
**Description**: The operational mode for detecting playback sessions.
- `webhook`: Uses HTTP webhooks for instant detection. Requires Plex Pass or Tautulli. No polling overhead, immediate response.
- `polling`: Periodically checks for active sessions. No Plex Pass required. Introduces 0-10 second delay depending on `check_interval`.

#### `dry_run`
**Type**: Boolean
**Required**: Yes
**Default**: `true`
**Description**: When enabled (`true`), Audiochangerr logs all actions it would take without actually modifying any sessions. When disabled (`false`), changes are applied to Plex sessions. Always test with `dry_run: true` before enabling production mode.

### Webhook Settings

All webhook settings only apply when `mode: "webhook"`.

#### `webhook.enabled`
**Type**: Boolean
**Default**: `true`
**Description**: Enables or disables the webhook HTTP server. Must be `true` for webhook mode to function.

#### `webhook.port`
**Type**: Integer
**Default**: `4444`
**Description**: The TCP port the webhook server listens on. Must be accessible from your Plex server or Tautulli instance. Ensure this port is allowed through your firewall if needed.

#### `webhook.host`
**Type**: String
**Default**: `"0.0.0.0"`
**Description**: The network interface to bind the webhook server to.
- `0.0.0.0`: Listen on all network interfaces (recommended for Docker)
- `127.0.0.1`: Listen only on localhost (local connections only)
- Specific IP: Bind to a specific network interface

#### `webhook.path`
**Type**: String
**Default**: `"/webhook"`
**Description**: The URL path for the webhook endpoint. Your Plex/Tautulli webhook URL will be `http://server:port/webhook`. The health check endpoint is always available at `/health`.

#### `webhook.secret`
**Type**: String
**Optional**: Yes
**Description**: Shared secret for webhook authentication. When set, all incoming webhooks must include an `X-Webhook-Secret` header matching this value. Highly recommended for internet-exposed webhooks to prevent unauthorized access.
**Example**: `webhook.secret: "your-random-secret-string-here"`

#### `webhook.initial_delay_ms`
**Type**: Integer
**Optional**: Yes
**Default**: `0` (no delay)
**Description**: Delay in milliseconds before the first session lookup after receiving a webhook. Useful if webhooks consistently arrive before Plex has created the session in its API. Only add this if you're experiencing session lookup failures.
**Recommended Range**: 0-2000ms

#### `webhook.session_retry`
**Type**: Object
**Optional**: Yes
**Description**: Retry configuration for session lookups when the session is not found on the first attempt. Webhooks sometimes arrive before Plex has fully created the session in its API. Omit this entire section to disable retries (single attempt only).

#### `webhook.session_retry.max_attempts`
**Type**: Integer
**Optional**: Yes
**Default**: 1 (no retries if section omitted)
**Description**: Total number of session lookup attempts, including the initial attempt. Each retry uses exponential backoff.
**Recommended Range**: 1-5 attempts

#### `webhook.session_retry.initial_delay_ms`
**Type**: Integer
**Optional**: Yes
**Description**: Base delay in milliseconds for exponential backoff between retry attempts. Actual delays follow the pattern: `delay × 2^0`, `delay × 2^1`, `delay × 2^2`, etc.
**Example**: With `initial_delay_ms: 500` and `max_attempts: 4`, retries occur at: 500ms, 1000ms, 2000ms, 4000ms
**Recommended Range**: 100-1000ms

### Polling Settings

#### `check_interval`
**Type**: Integer
**Required**: When `mode: "polling"`
**Default**: `10`
**Description**: Number of seconds between session checks when in polling mode. Lower values reduce detection delay but increase API overhead. Higher values reduce server load but may miss brief transcoding events.
**Recommended Range**: 5-30 seconds
**Trade-off**: 5s = faster detection, more API calls; 30s = fewer API calls, slower detection

### Audio Selection Rules

#### `audio_selector`
**Type**: Array of Objects
**Required**: Yes
**Description**: List of audio track selection rules processed from top to bottom. When a transcoding session is detected, Audiochangerr evaluates each rule in order and selects the first matching audio track. If no tracks match any rule, the session is not modified.

**Rule Processing**:
1. Rules are evaluated sequentially from first to last
2. First rule that matches an available audio track wins
3. Matched track is selected and session is restarted
4. If no rules match, no action is taken

**Rule Fields**:

##### `codec`
**Type**: String
**Required**: Yes
**Options**: `aac`, `ac3`, `eac3`, `dts`, `dts-hd`, `truehd`, `flac`, `mp3`, `opus`, `vorbis`, `pcm`
**Description**: The audio codec to match. Must exactly match the codec identifier from Plex's stream metadata.

##### `channels`
**Type**: Integer
**Required**: Yes
**Options**: 1-8 (common: 2, 6, 8)
**Description**: Number of audio channels to match.
- `2`: Stereo
- `6`: 5.1 surround
- `8`: 7.1 surround

##### `language`
**Type**: String
**Required**: Yes
**Options**: `"original"` or ISO 639-2 language code
**Description**: Language preference for audio tracks.
- `"original"`: Matches the original/default language of the media
- ISO code: Specific language (e.g., `eng`, `jpn`, `spa`, `fra`)

##### `keywords_include`
**Type**: Array of Strings
**Optional**: Yes
**Default**: `[]`
**Description**: Audio track title must contain at least one of these keywords (case-insensitive). Empty array means no keyword filtering. Useful for selecting specific track variants.
**Example**: `["DTS-HD", "TrueHD"]` matches tracks with "DTS-HD" or "TrueHD" in the title

##### `keywords_exclude`
**Type**: Array of Strings
**Optional**: Yes
**Default**: `[]`
**Description**: Audio track title must NOT contain any of these keywords (case-insensitive). Empty array means no exclusions. Useful for avoiding commentary or descriptive audio tracks.
**Example**: `["Commentary", "Descriptive"]` excludes tracks containing these keywords

**Example Rule**:
```yaml
audio_selector:
  - codec: "ac3"                  # Dolby Digital
    channels: 6                   # 5.1 surround
    language: "original"          # Original language
    keywords_include: []          # No keyword requirements
    keywords_exclude: ["Commentary"]  # Skip commentary tracks
```

### Optional Advanced Settings

#### `validation_timeout_seconds`
**Type**: Integer
**Optional**: Yes
**Default**: `120`
**Description**: Maximum time in seconds to wait for session restart validation after switching audio tracks. After switching tracks and terminating the session, Audiochangerr monitors for the session to restart without transcoding. If this timeout is exceeded, the processing cache is cleared and the media can be processed again on next detection.
**Recommended Range**: 60-180 seconds
**Note**: Longer timeouts prevent re-processing during slow session restarts; shorter timeouts allow faster retry on failures.

#### `config_version`
**Type**: Integer
**Optional**: Yes
**Description**: Configuration format version for future compatibility. Currently optional but recommended to future-proof your configuration against format changes in newer versions.
**Current Version**: `1`

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
