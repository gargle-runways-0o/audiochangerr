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
- `LOG_TO_FILE`: Enable file logging (default: `false`, set to `true` to enable)
- `LOG_DIRECTORY`: Log file directory (default: `/logs`)
- `LOG_MAX_SIZE`: Max log file size before rotation (default: `20m`, e.g., `100k`, `50m`, `1g`)
- `LOG_MAX_FILES`: Log retention (default: `14d`, e.g., `7d` for 7 days, `10` for 10 files)

Example:
```bash
LOG_LEVEL=debug npm start
```

Docker with file logging:
```bash
docker run -d \
  --name audiochangerr \
  -e LOG_LEVEL=debug \
  -e LOG_TO_FILE=true \
  -e LOG_DIRECTORY=/logs \
  -e LOG_MAX_SIZE=20m \
  -e LOG_MAX_FILES=14d \
  -v /path/to/config:/config \
  -v /path/to/logs:/logs \
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

### Webhook Security

**Multi-layered protection (recommended approach):**

1. **Application-level IP filtering** (default: enabled)
   ```yaml
   webhook:
     local_only: true  # Blocks IPs not in allowed_networks
     # REQUIRED when local_only: true
     allowed_networks:
       - "127.0.0.0/8"       # Localhost
       - "192.168.1.0/24"    # Your home network
       - "10.0.0.5"          # Specific IP
   ```
   - **Must specify** `allowed_networks` when `local_only: true` (fails fast if missing)
   - Supports CIDR notation and individual IPs
   - Blocks IPs not in allowed list with 403 Forbidden
   - Set `local_only: false` only if using reverse proxy with own authentication

2. **Docker port binding** (local network only)
   ```bash
   # Localhost only (requires reverse proxy for Plex/Tautulli access)
   docker run -p 127.0.0.1:4444:4444 ...

   # Specific local IP (recommended for LAN access)
   docker run -p 192.168.1.50:4444:4444 ...
   ```

3. **Firewall rules** (defense in depth)
   ```bash
   # UFW: Allow local network only
   sudo ufw allow from 192.168.1.0/24 to any port 4444 proto tcp
   sudo ufw deny 4444/tcp

   # iptables
   sudo iptables -A INPUT -p tcp --dport 4444 -s 192.168.1.0/24 -j ACCEPT
   sudo iptables -A INPUT -p tcp --dport 4444 -j DROP
   ```

4. **Authentication** (optional, additional layer)
   ```yaml
   webhook:
     secret: "your-secure-random-string"  # Requires X-Webhook-Secret header
   ```

**Security levels:**
- **High** (recommended): `local_only: true` + firewall rules + Docker IP binding
- **Medium**: `local_only: true` + webhook secret
- **Low** (not recommended): `local_only: false` (only use behind authenticated reverse proxy)

**Advanced Webhook Options**:
- `initial_delay_ms`: Delay (in milliseconds) before first session lookup. Useful if webhooks consistently arrive before Plex creates the session. Omit or set to 0 for no delay.
- `session_retry`: Retry configuration if session not found on first attempt. Webhooks sometimes arrive before Plex has fully created the session in its API.
  - `max_attempts`: Total number of lookup attempts (including first attempt). Recommended: 1-5.
  - `initial_delay_ms`: Base delay for exponential backoff between retries. Delays are: delay × 2^0, delay × 2^1, delay × 2^2, etc. Example: 500ms → 500ms, 1000ms, 2000ms, 4000ms.
  - Omit entire `session_retry` section to disable retries (single attempt only).

See [WEBHOOK-SETUP.md](WEBHOOK-SETUP.md) for detailed webhook configuration (Plex and Tautulli).

### Console Logging

Configure console/terminal output (required):

```yaml
console:
  enabled: true
  level: "info"
```

**Required fields**:
- `enabled`: `true` to show console output, `false` to disable (no default - must specify)
- `level`: Minimum log level for console: `error`, `warn`, `info`, `debug` (no default - must specify)

**Fails fast if not specified**: Config will not load without explicit console configuration

### File Logging

Enable persistent logging to files with automatic rotation:

```yaml
logging:
  enabled: true
  directory: "/logs"
  max_size: "20m"
  max_files: "14d"
  level: "info"
```

**Options**:
- `enabled`: `true` to enable file logging, `false` for console only (default: `false`)
- `directory`: Log file location (default: `/logs`). Created automatically if missing.
- `max_size`: Max file size before rotation. Format: `20m` (20 MB), `100k` (100 KB), `1g` (1 GB)
- `max_files`: Retention policy. Format: `14d` (14 days), `30d` (30 days), or `10` (keep 10 files)
- `level`: Minimum log level for files: `error`, `warn`, `info`, `debug` (default: `info`)

**Log file naming**: `audiochangerr-YYYY-MM-DD.log` (e.g., `audiochangerr-2025-11-17.log`)

**Environment variable alternative**: Use `LOG_TO_FILE=true` instead of config.yaml (see Environment Variables section)

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
- `channels`: minimum count 1-8 (matches >= specified, e.g., 6 matches 6ch or 8ch)
- `language`: "original" or ISO code (eng, jpn, spa, etc.)
- `keywords_include`: match any keyword (array)
- `keywords_exclude`: exclude any keyword (array)

Rules process top to bottom. First match wins.

**Config versioning**: Add `config_version: 1` to future-proof config format.

## Configuration Reference

### Core Settings

#### `plex_server_url`
**Type**: String | **Required**: Yes
**Description**: Plex server URL for API communications.
**Example**: `http://192.168.1.100:32400`

#### `plex_token`
**Type**: String | **Required**: Yes
**Description**: Plex API authentication token. Get from media item → Get Info → View XML → copy `X-Plex-Token` from URL.
**Security**: Keep secure. Grants full server access.

#### `owner_username`
**Type**: String | **Required**: Yes
**Description**: Plex server owner username (case-sensitive). Processes sessions for owner and managed users.

#### `mode`
**Type**: String | **Required**: Yes | **Default**: `polling`
**Options**: `webhook`, `polling`
**Description**: Session detection mode.
- `webhook`: Instant detection via HTTP webhooks. Requires Plex Pass or Tautulli.
- `polling`: Periodic checks. 0-10s delay based on `check_interval`.

#### `dry_run`
**Type**: Boolean | **Required**: Yes | **Default**: `true`
**Description**: `true` = log only, `false` = apply changes. Test with `true` before production.

#### `validation_timeout_seconds`
**Type**: Integer | **Required**: Yes | **Default**: `120`
**Description**: Max wait time for session restart after track switch. Timeout clears processing cache, allows retry.
**Range**: 60-180s

### Webhook Settings

Applies only when `mode: "webhook"`.

#### `webhook.enabled`
**Type**: Boolean | **Default**: `true`
**Description**: Enable webhook server. Must be `true` for webhook mode.

#### `webhook.port`
**Type**: Integer | **Default**: `4444`
**Description**: Webhook server port. Must be accessible from Plex/Tautulli.

#### `webhook.host`
**Type**: String | **Default**: `"0.0.0.0"`
**Description**: Network interface to bind.
- `0.0.0.0`: All interfaces (Docker)
- `127.0.0.1`: Localhost only
- Specific IP: Single interface

#### `webhook.path`
**Type**: String | **Default**: `"/webhook"`
**Description**: Webhook endpoint path. Health check at `/health`.

#### `webhook.local_only`
**Type**: Boolean | **Default**: `true`
**Description**: IP filtering based on `allowed_networks`. When enabled, blocks requests from IPs not in the allowed list.
- `true`: Allow only IPs/networks in `allowed_networks` (RECOMMENDED)
- `false`: Allow all IPs (NOT RECOMMENDED - only use behind authenticated reverse proxy)
**Blocked IPs**: Returns 403 Forbidden with logged warning

#### `webhook.allowed_networks`
**Type**: Array of Strings | **Required**: When `local_only: true`
**Description**: List of allowed IP addresses and CIDR ranges. **Required** when `local_only: true` - config will fail to load if not specified.
**Format**: CIDR notation (`192.168.1.0/24`) or individual IPs (`10.0.0.5`)
**Validation**: Must be non-empty array with at least one valid IP/CIDR entry

**Example** (typical home network):
```yaml
allowed_networks:
  - "127.0.0.0/8"      # Localhost
  - "192.168.1.0/24"   # Home network
  - "10.0.0.0/8"       # Private Class A (if using)
  - "::1/128"          # IPv6 localhost
```

**Example** (restrictive, specific subnet only):
```yaml
allowed_networks:
  - "192.168.1.0/24"   # Only this subnet
```

**Example** (multiple networks):
```yaml
allowed_networks:
  - "192.168.1.0/24"   # Home network
  - "10.8.0.0/24"      # VPN network
  - "172.20.0.5"       # Specific server IP
```

#### `webhook.secret`
**Type**: String | **Optional**: Yes
**Description**: Shared secret for authentication. Requires `X-Webhook-Secret` header. Provides additional security layer beyond IP filtering.

#### `webhook.initial_delay_ms`
**Type**: Integer | **Optional**: Yes | **Default**: `0`
**Description**: Delay before first session lookup. Use if webhooks arrive before Plex creates session.
**Range**: 0-2000ms

#### `webhook.session_retry`
**Type**: Object | **Optional**: Yes
**Description**: Retry config for session lookups. Use if webhooks arrive before session exists. Omit to disable retries.

#### `webhook.session_retry.max_attempts`
**Type**: Integer | **Optional**: Yes | **Default**: 1
**Description**: Total lookup attempts (includes first). Exponential backoff.
**Range**: 1-5

#### `webhook.session_retry.initial_delay_ms`
**Type**: Integer | **Optional**: Yes
**Description**: Base delay for exponential backoff. Pattern: `delay × 2^n`.
**Example**: 500ms → 500ms, 1000ms, 2000ms, 4000ms
**Range**: 100-1000ms

### Polling Settings

#### `check_interval`
**Type**: Integer | **Required**: When `mode: "polling"` | **Default**: `10`
**Description**: Seconds between session checks. Lower = faster detection + more API calls. Higher = slower detection + fewer API calls.
**Range**: 5-30s

### Logging Settings

#### `console`
**Type**: Object | **Required**: Yes
**Description**: Console logging configuration. Controls terminal/stdout output. **Required** - config fails to load if not specified.

#### `console.enabled`
**Type**: Boolean | **Required**: Yes
**Description**: Enable console output. `false` disables all console logging (useful when only file logging desired). Must be explicitly set to `true` or `false`.

#### `console.level`
**Type**: String | **Required**: Yes
**Options**: `error`, `warn`, `info`, `debug`
**Description**: Minimum log level for console output. Must be explicitly specified (no defaults).

#### `logging`
**Type**: Object | **Optional**: Yes
**Description**: File logging configuration with automatic rotation. Omit entire section to disable file logging (console only).

#### `logging.enabled`
**Type**: Boolean | **Required**: Yes (if `logging` specified) | **Default**: `false`
**Description**: Enable file logging. `true` = logs to both console and files, `false` = console only.

#### `logging.directory`
**Type**: String | **Optional**: Yes | **Default**: `/logs`
**Description**: Directory for log files. Created automatically if missing. Use absolute path.
**Example**: `/var/log/audiochangerr`, `./logs`, `/logs`

#### `logging.max_size`
**Type**: String | **Optional**: Yes | **Default**: `20m`
**Description**: Maximum file size before rotation.
**Format**: Number + unit (`k` = KB, `m` = MB, `g` = GB)
**Examples**: `20m` (20 MB), `100k` (100 KB), `1g` (1 GB)

#### `logging.max_files`
**Type**: String | **Optional**: Yes | **Default**: `14d`
**Description**: Log retention policy.
**Format**: Days (`Xd`) or file count (number)
**Examples**: `14d` (keep 14 days), `30d` (30 days), `10` (keep 10 files)

#### `logging.level`
**Type**: String | **Optional**: Yes | **Default**: `info`
**Options**: `error`, `warn`, `info`, `debug`
**Description**: Minimum log level for file output. Console uses `LOG_LEVEL` environment variable.

**Log File Format**: `audiochangerr-YYYY-MM-DD.log` (daily rotation)

### Audio Selection Rules

#### `audio_selector`
**Type**: Array of Objects | **Required**: Yes
**Description**: Track selection rules. First match wins. No matches = no action.

**Processing**:
1. Evaluate rules top to bottom
2. First matching track wins
3. Select track and restart session

**Rule Fields**:

##### `codec`
**Type**: String | **Required**: Yes
**Options**: `aac`, `ac3`, `eac3`, `dts`, `dts-hd`, `truehd`, `flac`, `mp3`, `opus`, `vorbis`, `pcm`
**Description**: Audio codec to match.

##### `channels`
**Type**: Integer | **Required**: Yes
**Options**: 1-8 (2=stereo, 6=5.1, 8=7.1)
**Description**: Minimum channel count (matches streams with >= channels).

##### `language`
**Type**: String | **Required**: Yes
**Options**: `"original"` or ISO 639-2 code
**Description**: Language preference.
- `"original"`: Default media language
- ISO code: Specific language (`eng`, `jpn`, `spa`, `fra`)

##### `keywords_include`
**Type**: Array | **Optional**: Yes | **Default**: `[]`
**Description**: Track title must contain any keyword (case-insensitive). Empty = no filtering.
**Example**: `["DTS-HD", "TrueHD"]`

##### `keywords_exclude`
**Type**: Array | **Optional**: Yes | **Default**: `[]`
**Description**: Track title must NOT contain any keyword (case-insensitive). Empty = no exclusions.
**Example**: `["Commentary", "Descriptive"]`

**Example**:
```yaml
audio_selector:
  - codec: "ac3"
    channels: 6
    language: "original"
    keywords_include: []
    keywords_exclude: ["Commentary"]
```

### Optional Advanced Settings

#### `config_version`
**Type**: Integer | **Optional**: Yes | **Current**: `1`
**Description**: Config format version for future compatibility.

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
