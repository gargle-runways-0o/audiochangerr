# Configuration Reference

Complete reference for all `config.yaml` options.

**Quick start:** See [README.md](../README.md#configuration) for minimal setup. See [config.yaml.example](../config.yaml.example) for examples.

## Core Settings

### `plex_server_url`
**Type**: String | **Required**: Yes
**Description**: Plex server URL for API communications.
**Example**: `http://192.168.1.100:32400`

### `auth_method`
**Type**: String | **Required**: Yes
**Options**: `pin`, `token`, `env`
**Description**: Plex authentication method.
- `pin`: Interactive PIN authentication (recommended). Visit https://plex.tv/link on first run.
- `token`: Manual token in `plex_token` field (legacy).
- `env`: Token from `PLEX_TOKEN` environment variable.

**See**: [AUTHENTICATION.md](AUTHENTICATION.md) for detailed setup guide.

### `plex_token`
**Type**: String | **Required**: Only when `auth_method: "token"`
**Description**: Plex API authentication token. Get from media item → Get Info → View XML → copy `X-Plex-Token` from URL.
**Security**: Keep secure. Grants full server access.
**Note**: Not needed for `auth_method: "pin"` or `auth_method: "env"`.

### `owner_username`
**Type**: String | **Required**: Yes
**Description**: Plex server owner username (case-sensitive). Processes sessions for owner and managed users.

### `mode`
**Type**: String | **Required**: Yes | **Default**: `polling`
**Options**: `webhook`, `polling`
**Description**: Session detection mode.
- `webhook`: Instant detection via HTTP webhooks. Requires Plex Pass or Tautulli.
- `polling`: Periodic checks. 0-10s delay based on `check_interval`.

### `dry_run`
**Type**: Boolean | **Required**: Yes | **Default**: `true`
**Description**: `true` = log only, `false` = apply changes. Test with `true` before production.

### `terminate_stream`
**Type**: Boolean | **Optional**: Yes | **Default**: `true`
**Description**: Kill playback session after switching audio track. `true` = force restart (validates track switch), `false` = switch only (no restart, no validation).

### `validation_timeout_seconds`
**Type**: Integer | **Required**: Yes
**Description**: Max wait time for session restart after track switch. Timeout clears processing cache, allows retry.
**Example**: `120`
**Range**: 60-180s (recommended)

### `plex_api_timeout_seconds`
**Type**: Integer | **Required**: Yes
**Description**: Timeout for Plex API requests (sessions, metadata, etc.). Prevents indefinite hangs on slow/unresponsive Plex servers.
**Example**: `30`
**Range**: 10-120s (30s recommended for most networks)

### `graceful_shutdown_seconds`
**Type**: Integer | **Required**: Yes
**Description**: Maximum time to wait for in-progress operations to complete during shutdown (SIGTERM/SIGINT). After timeout, forces exit.
**Example**: `30`
**Range**: 10-60s (30s recommended)

## Webhook Settings

Applies only when `mode: "webhook"`.

### `webhook.enabled`
**Type**: Boolean | **Default**: `true`
**Description**: Enable webhook server. Must be `true` for webhook mode.

### `webhook.port`
**Type**: Integer | **Default**: `4444`
**Description**: Webhook server port. Must be accessible from Plex/Tautulli.

### `webhook.host`
**Type**: String | **Default**: `"0.0.0.0"`
**Description**: Network interface to bind.
- `0.0.0.0`: All interfaces (Docker)
- `127.0.0.1`: Localhost only
- Specific IP: Single interface

### `webhook.path`
**Type**: String | **Default**: `"/webhook"`
**Description**: Webhook endpoint path. Health check at `/health`.

### `webhook.local_only`
**Type**: Boolean | **Default**: `true`
**Description**: IP filtering based on `allowed_networks`. When enabled, blocks requests from IPs not in the allowed list.
- `true`: Allow only IPs/networks in `allowed_networks` (RECOMMENDED)
- `false`: Allow all IPs (NOT RECOMMENDED - only use behind authenticated reverse proxy)

**Blocked IPs**: Returns 403 Forbidden with logged warning

### `webhook.allowed_networks`
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

### `webhook.secret`
**Type**: String | **Optional**: Yes
**Description**: Shared secret for authentication. Requires `X-Webhook-Secret` header. Provides additional security layer beyond IP filtering.
**Note**: Plex does not support custom headers. Only works with Tautulli.

### `webhook.initial_delay_ms`
**Type**: Integer | **Optional**: Yes | **Default**: `0`
**Description**: Delay before first session lookup. Use if webhooks arrive before Plex creates session.
**Range**: 0-2000ms

### `webhook.session_retry`
**Type**: Object | **Optional**: Yes
**Description**: Retry config for session lookups. Use if webhooks arrive before session exists. Omit to disable retries.

### `webhook.session_retry.max_attempts`
**Type**: Integer | **Optional**: Yes | **Default**: 1
**Description**: Total lookup attempts (includes first). Exponential backoff.
**Range**: 1-5

### `webhook.session_retry.initial_delay_ms`
**Type**: Integer | **Optional**: Yes
**Description**: Base delay for exponential backoff. Pattern: `delay × 2^n`.
**Example**: 500ms → 500ms, 1000ms, 2000ms, 4000ms
**Range**: 100-1000ms

## Polling Settings

### `check_interval`
**Type**: Integer | **Required**: When `mode: "polling"` | **Default**: `10`
**Description**: Seconds between session checks. Lower = faster detection + more API calls. Higher = slower detection + fewer API calls.
**Range**: 5-30s

## Logging Settings

### `console`
**Type**: Object | **Required**: Yes
**Description**: Console logging configuration. Controls terminal/stdout output. **Required** - config fails to load if not specified.

### `console.enabled`
**Type**: Boolean | **Required**: Yes
**Description**: Enable console output. `false` disables all console logging (useful when only file logging desired). Must be explicitly set to `true` or `false`.

### `console.level`
**Type**: String | **Required**: Yes
**Options**: `error`, `warn`, `info`, `debug`
**Description**: Minimum log level for console output. Must be explicitly specified (no defaults).

### `logging`
**Type**: Object | **Optional**: Yes
**Description**: File logging configuration with automatic rotation. Omit entire section to disable file logging (console only).

### `logging.enabled`
**Type**: Boolean | **Required**: Yes (if `logging` specified) | **Default**: `false`
**Description**: Enable file logging. `true` = logs to both console and files, `false` = console only.

### `logging.directory`
**Type**: String | **Optional**: Yes | **Default**: `/logs`
**Description**: Directory for log files. Created automatically if missing. Use absolute path.
**Example**: `/var/log/audiochangerr`, `./logs`, `/logs`

### `logging.max_size`
**Type**: String | **Optional**: Yes | **Default**: `20m`
**Description**: Maximum file size before rotation.
**Format**: Number + unit (`k` = KB, `m` = MB, `g` = GB)
**Examples**: `20m` (20 MB), `100k` (100 KB), `1g` (1 GB)

### `logging.max_files`
**Type**: String | **Optional**: Yes | **Default**: `14d`
**Description**: Log retention policy.
**Format**: Days (`Xd`) or file count (number)
**Examples**: `14d` (keep 14 days), `30d` (30 days), `10` (keep 10 files)

### `logging.level`
**Type**: String | **Optional**: Yes | **Default**: `info`
**Options**: `error`, `warn`, `info`, `debug`
**Description**: Minimum log level for file output.

**Log File Format**: `audiochangerr-YYYY-MM-DD.log` (daily rotation)

## Audio Selection Rules

### `audio_selector`
**Type**: Array of Objects | **Required**: Yes
**Description**: Track selection rules. First match wins. No matches = no action.

**Processing**:
1. Evaluate rules top to bottom
2. First matching track wins
3. Select track and restart session

**Rule Fields**:

#### `codec`
**Type**: String | **Required**: Yes
**Options**: `aac`, `ac3`, `eac3`, `dts`, `dts-hd`, `truehd`, `flac`, `mp3`, `opus`, `vorbis`, `pcm`
**Description**: Audio codec to match.

#### `channels`
**Type**: Integer | **Required**: Yes
**Options**: 1-8 (2=stereo, 6=5.1, 8=7.1)
**Description**: Minimum channel count (matches streams with >= channels).

#### `language`
**Type**: String | **Required**: Yes
**Options**: `"original"` or ISO 639-2 code
**Description**: Language preference.
- `"original"`: Default media language
- ISO code: Specific language (`eng`, `jpn`, `spa`, `fra`)

#### `keywords_include`
**Type**: Array | **Optional**: Yes | **Default**: `[]`
**Description**: Track title must contain any keyword (case-insensitive). Empty = no filtering.
**Example**: `["DTS-HD", "TrueHD"]`

#### `keywords_exclude`
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

## Advanced Settings

### `config_version`
**Type**: Integer | **Optional**: Yes | **Current**: `1`
**Description**: Config format version for future compatibility.

## Examples

### Multiple Languages
```yaml
audio_selector:
  - codec: "ac3"
    language: "eng"
    channels: 6
  - codec: "ac3"
    language: "original"
    channels: 6
```

### DTS Preference
```yaml
audio_selector:
  - codec: "dts"
    channels: 6
    keywords_include: ["DTS-HD"]
  - codec: "dts"
    channels: 6
```

### Complete Webhook Config
```yaml
mode: "webhook"

webhook:
  port: 4444
  host: "0.0.0.0"
  path: "/webhook"
  local_only: true
  allowed_networks:
    - "127.0.0.0/8"
    - "192.168.1.0/24"
  secret: "your-secure-secret"
  initial_delay_ms: 0
  session_retry:
    max_attempts: 3
    initial_delay_ms: 500
```

### Complete Polling Config
```yaml
mode: "polling"
check_interval: 10
```

### Complete Logging Config
```yaml
console:
  enabled: true
  level: "info"

logging:
  enabled: true
  directory: "/logs"
  max_size: "20m"
  max_files: "14d"
  level: "info"
```

## Debug Output Examples

Setting `console.level: "debug"` or `logging.level: "debug"` provides detailed operational logs. Use for troubleshooting.

### Startup (Info Level)
```
2025-11-18 12:00:00 [INFO]: Audiochangerr v1.0.0
2025-11-18 12:00:00 [INFO]: Mode: webhook
2025-11-18 12:00:00 [INFO]: Dry run: no
2025-11-18 12:00:00 [INFO]: Validation: 120s
2025-11-18 12:00:00 [INFO]: Endpoint: http://0.0.0.0:4444/webhook
2025-11-18 12:00:00 [INFO]: Networks: 127.0.0.0/8, 192.168.1.0/24
```

### Webhook Processing (Debug Level)
```
2025-11-18 12:05:30 [DEBUG]: POST /webhook 192.168.1.50
2025-11-18 12:05:30 [DEBUG]: Search: media=12345 player=abc-123 user=john
2025-11-18 12:05:30 [INFO]: Transcode: 12345
2025-11-18 12:05:30 [INFO]: Player: Plex Web (Chrome) user: john
2025-11-18 12:05:30 [DEBUG]: Select: 12345 current=301
2025-11-18 12:05:30 [DEBUG]: Streams: 301:aac*, 302:ac3, 303:dts
2025-11-18 12:05:30 [DEBUG]: Eval 302
2025-11-18 12:05:30 [DEBUG]: Match: 302
2025-11-18 12:05:30 [DEBUG]: Selected: 302 ac3 6ch (rule #1)
2025-11-18 12:05:30 [INFO]: Better: AC3 6ch (302)
2025-11-18 12:05:30 [DEBUG]: Kill transcode: /transcode/sessions/xyz
2025-11-18 12:05:30 [DEBUG]: Kill session: abc-123
2025-11-18 12:05:30 [INFO]: Switched to 302, awaiting validation
```

### Session Validation (Debug Level)
```
2025-11-18 12:05:35 [DEBUG]: Search: media=12345 player=abc-123 user=john
2025-11-18 12:05:35 [DEBUG]: Same session: old-key
2025-11-18 12:05:40 [INFO]: Restarted: 12345
2025-11-18 12:05:40 [INFO]: Direct play: stream 302
2025-11-18 12:05:40 [INFO]: Validated: 12345
```

### Audio Selection Failure (Debug Level)
```
2025-11-18 12:10:00 [DEBUG]: Select: 12345 current=301
2025-11-18 12:10:00 [DEBUG]: Streams: 301:aac*, 302:mp3
2025-11-18 12:10:00 [DEBUG]: Eval 302
2025-11-18 12:10:00 [DEBUG]:   Codec: want ac3 got mp3
2025-11-18 12:10:00 [DEBUG]: No match
2025-11-18 12:10:00 [WARN]: No better stream - check audio_selector rules match available streams
```

### Webhook Retry (Debug Level)
```
2025-11-18 12:15:00 [DEBUG]: Search: media=12345 player=abc-123 user=john
2025-11-18 12:15:00 [DEBUG]: No match: want ratingKey=12345 player=abc-123
2025-11-18 12:15:00 [DEBUG]: Sessions: [0] 12340:101, [1] 12341:102
2025-11-18 12:15:00 [DEBUG]: Retry 1/3 in 500ms
2025-11-18 12:15:01 [INFO]: Session found: 12345 (2 attempts)
```

### Common Debug Patterns

**Normal operation:**
- `[INFO]` for major events (transcode detected, switched, validated)
- No `[WARN]` or `[ERROR]` messages
- Each webhook results in "Transcode" → "Better" → "Switched" → "Validated"

**Issues to investigate:**
- `[WARN]: No better stream` - Audio selector rules don't match available streams
- `[WARN]: Still transcoding` - Selected codec incompatible with client
- `[WARN]: Wrong stream` - Stream switched but different one selected
- `[ERROR]: Sessions: 401` - Invalid Plex token
- `[ERROR]: Metadata: 404` - Invalid rating key or deleted media

**Timing issues:**
- Multiple "Retry X/Y" messages - Increase `session_retry.initial_delay_ms`
- "No session (5 attempts)" - Increase `session_retry.max_attempts` or add `initial_delay_ms`

See [WEBHOOK.md](WEBHOOK.md) for webhook mode setup and troubleshooting.
