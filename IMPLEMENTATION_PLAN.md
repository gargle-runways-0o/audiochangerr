# Implementation Plan: Architecture Fixes

**Based on:** ARCHITECTURE_EVALUATION.md
**Target:** Complete alignment with Architecture Principles
**Estimated Time:** 3-5 days

---

## Phase 1: Critical Fixes (Priority 🔴)

### 1.1 Remove Orphaned Configuration System

**Time:** 30 minutes

**Changes:**
```bash
# Remove files
rm configBuilder.js

# Update package.json - remove:
"ajv": "^8.12.0",
"ajv-formats": "^2.1.1",

# Run
npm install
```

**Validation:**
```bash
npm list ajv  # Should show "not found"
grep -r "configBuilder" .  # Should show no imports
```

---

### 1.2 Fix Fail Fast Violations in plexClient.js

**Time:** 2 hours

#### Change 1.2a: fetchSessions - Throw Instead of Return []

**Current (plexClient.js:18-30):**
```javascript
async function fetchSessions() {
    try {
        const response = await plexApi.get('/status/sessions');
        return response.data.MediaContainer.Metadata || [];
    } catch (error) {
        if (error.response) {
            logger.error(`GET /status/sessions: ${error.response.status} ${error.response.statusText}`);
        } else {
            logger.error(`GET /status/sessions: ${error.message}`);
        }
        return [];  // ← REMOVE THIS
    }
}
```

**New:**
```javascript
async function fetchSessions() {
    try {
        const response = await plexApi.get('/status/sessions');
        return response.data.MediaContainer.Metadata || [];
    } catch (error) {
        if (error.response) {
            logger.error(`GET /status/sessions: ${error.response.status} ${error.response.statusText}`);
            throw new Error(`Plex API error: ${error.response.status} ${error.response.statusText}`);
        } else {
            logger.error(`GET /status/sessions: ${error.message}`);
            logger.debug(error.stack);
            throw error;
        }
    }
}
```

#### Change 1.2b: fetchMetadata - Throw Instead of Return null

**Current (plexClient.js:32-44):**
```javascript
async function fetchMetadata(ratingKey) {
    try {
        const response = await plexApi.get(`/library/metadata/${ratingKey}`);
        return response.data.MediaContainer.Metadata[0];
    } catch (error) {
        if (error.response) {
            logger.error(`GET /library/metadata/${ratingKey}: ${error.response.status} ${error.response.statusText}`);
        } else {
            logger.error(`GET /library/metadata/${ratingKey}: ${error.message}`);
        }
        return null;  // ← REMOVE THIS
    }
}
```

**New:**
```javascript
async function fetchMetadata(ratingKey) {
    try {
        const response = await plexApi.get(`/library/metadata/${ratingKey}`);
        const metadata = response.data.MediaContainer.Metadata[0];
        if (!metadata) {
            throw new Error(`No metadata found for ratingKey ${ratingKey}`);
        }
        return metadata;
    } catch (error) {
        if (error.response) {
            logger.error(`GET /library/metadata/${ratingKey}: ${error.response.status} ${error.response.statusText}`);
            throw new Error(`Plex metadata fetch failed: ${error.response.status}`);
        } else {
            logger.error(`GET /library/metadata/${ratingKey}: ${error.message}`);
            logger.debug(error.stack);
            throw error;
        }
    }
}
```

#### Change 1.2c: fetchManagedUserTokens - Distinguish Auth Failures

**Current (plexClient.js:98-137):**
```javascript
async function fetchManagedUserTokens() {
    try {
        // ... implementation ...
        return managedUserTokens;
    } catch (error) {
        if (error.response) {
            logger.error(`Fetch managed tokens: ${error.response.status} ${error.response.statusText}`);
        } else {
            logger.error(`Fetch managed tokens: ${error.message}`);
        }
        return {};  // ← ONLY RETURN {} ON 404, THROW OTHERWISE
    }
}
```

**New:**
```javascript
async function fetchManagedUserTokens() {
    try {
        // ... existing implementation ...
        logger.info(`Fetched ${Object.keys(managedUserTokens).length} managed user tokens`);
        return managedUserTokens;
    } catch (error) {
        if (error.response) {
            const status = error.response.status;
            logger.error(`Fetch managed tokens: ${status} ${error.response.statusText}`);

            // 404 is expected if no managed users - return empty
            if (status === 404) {
                logger.info('No managed users found (404 expected)');
                return {};
            }

            // Auth or other errors should fail fast
            logger.debug(error.stack);
            throw new Error(`Managed user token fetch failed: ${status}`);
        } else {
            logger.error(`Fetch managed tokens: ${error.message}`);
            logger.debug(error.stack);
            throw error;
        }
    }
}
```

#### Change 1.2d: Add Error Handling to Terminate Functions

**Current (plexClient.js:68-76):**
```javascript
async function terminateTranscode(transcodeKey) {
    await plexApi.delete(transcodeKey);
}

async function terminateSession(sessionId, reason) {
    await plexApi.get('/status/sessions/terminate', {
        params: { sessionId, reason }
    });
}
```

**New:**
```javascript
async function terminateTranscode(transcodeKey) {
    try {
        await plexApi.delete(transcodeKey);
        logger.debug(`Terminated transcode: ${transcodeKey}`);
    } catch (error) {
        logger.error(`Failed to terminate transcode ${transcodeKey}: ${error.message}`);
        logger.debug(error.stack);
        throw error;
    }
}

async function terminateSession(sessionId, reason) {
    try {
        await plexApi.get('/status/sessions/terminate', {
            params: { sessionId, reason }
        });
        logger.debug(`Terminated session: ${sessionId}`);
    } catch (error) {
        logger.error(`Failed to terminate session ${sessionId}: ${error.message}`);
        logger.debug(error.stack);
        throw error;
    }
}
```

---

### 1.3 Fix Webhook Fallback in main.js

**Time:** 15 minutes

**Current (main.js:42-68):**
```javascript
function startWebhookMode() {
    logger.info('Starting WEBHOOK');
    logger.info(`Endpoint: http://${config.webhook.host}:${config.webhook.port}${config.webhook.path}`);

    const handleWebhook = async (payload) => {
        await webhookProcessor.processWebhook(payload, config);
    };

    try {
        webhookServer.start(config, handleWebhook);
        logger.info('Webhook started');
        logger.info('Configure: Plex Web → Account → Webhooks');
    } catch (error) {
        logger.error(`Webhook start failed: ${error.message}`);
        logger.error('Falling back to polling');  // ← REMOVE FALLBACK
        startPollingMode();
    }

    setInterval(async () => {
        // ...
    }, 60000);
}
```

**New:**
```javascript
function startWebhookMode() {
    logger.info('Starting WEBHOOK');
    logger.info(`Endpoint: http://${config.webhook.host}:${config.webhook.port}${config.webhook.path}`);

    const handleWebhook = async (payload) => {
        await webhookProcessor.processWebhook(payload, config);
    };

    // Remove try/catch - let errors propagate to main()
    webhookServer.start(config, handleWebhook);
    logger.info('Webhook started');
    logger.info('Configure: Plex Web → Account → Webhooks');

    // Session cleanup interval
    setInterval(async () => {
        try {
            const sessions = await plexClient.fetchSessions();
            audioFixer.cleanupProcessedMedia(sessions);
        } catch (error) {
            logger.error(`Cleanup error: ${error.message}`);
            logger.debug(error.stack);
        }
    }, 60000);
}
```

---

### 1.4 Update Callers to Handle Errors

**Time:** 1 hour

#### Change 1.4a: Polling Mode Error Handling

**Current (main.js:14-39):**
```javascript
function startPollingMode() {
    logger.info(`Starting POLLING (interval: ${config.check_interval}s)`);

    setInterval(async () => {
        try {
            const sessions = await plexClient.fetchSessions();
            // ... process sessions ...
        } catch (error) {
            logger.error(`Polling error: ${error.message}`);
        }
    }, config.check_interval * 1000);
}
```

**New:**
```javascript
function startPollingMode() {
    logger.info(`Starting POLLING (interval: ${config.check_interval}s)`);

    setInterval(async () => {
        try {
            const sessions = await plexClient.fetchSessions();
            logger.info(`Active sessions: ${sessions.length}`);

            const transcodeSessions = findTranscodes(sessions);
            const newTranscodes = transcodeSessions.filter(s => !audioFixer.isProcessed(s.ratingKey));

            if (newTranscodes.length > 0) {
                for (const session of newTranscodes) {
                    try {
                        const success = await audioFixer.processTranscodingSession(session, config);
                        if (success) {
                            audioFixer.markAsProcessed(session.ratingKey);
                        }
                    } catch (error) {
                        logger.error(`Failed to process session ${session.ratingKey}: ${error.message}`);
                        logger.debug(error.stack);
                        // Continue processing other sessions
                    }
                }
            }

            audioFixer.cleanupProcessedMedia(sessions);

        } catch (error) {
            logger.error(`Polling cycle failed: ${error.message}`);
            logger.debug(error.stack);
            // Interval continues, will retry next cycle
        }
    }, config.check_interval * 1000);
}
```

#### Change 1.4b: audioFixer.js Error Handling

**Current (audioFixer.js:49-58):**
```javascript
async function processTranscodingSession(session, config) {
    try {
        logger.info(`Transcode: ${session.Player.title} on ${session.Player.device}, user ${session.User.title}`);

        const mediaInfo = await plexClient.fetchMetadata(session.ratingKey);
        if (!mediaInfo) {
            logger.error(`No metadata: media ${session.ratingKey}`);
            return false;
        }
        // ...
```

**New (remove null check since function now throws):**
```javascript
async function processTranscodingSession(session, config) {
    try {
        logger.info(`Transcode: ${session.Player.title} on ${session.Player.device}, user ${session.User.title}`);

        const mediaInfo = await plexClient.fetchMetadata(session.ratingKey);
        // No need to check for null - function throws on error

        const currentStream = session.Media[0].Part[0].Stream.find(s => s.streamType === 2 && s.selected);
        // ...
```

---

### 1.5 Fix Dockerfile

**Time:** 10 minutes

**Current:**
```dockerfile
EXPOSE 3189
CMD ["node", "main.js", "/logs", "/config/config.yaml", "/config/last_run_timestamps.json"]
```

**New:**
```dockerfile
EXPOSE 4444
CMD ["node", "main.js"]
```

**Additional Note:** If config path needs to be configurable, update config.js:
```javascript
const configPath = process.env.CONFIG_PATH || path.join(__dirname, 'config.yaml');
```

---

## Phase 2: High Priority Fixes (Priority 🟡)

### 2.1 Eliminate Code Duplication

**Time:** 3 hours

#### Change 2.1a: Extract Axios Client Creator

**New function in plexClient.js:**
```javascript
function createPlexClient(baseURL, token, accept = 'application/json', timeout = 600000) {
    return axios.create({
        baseURL,
        headers: {
            'X-Plex-Token': token,
            'Accept': accept
        },
        timeout
    });
}

function init(config) {
    plexApi = createPlexClient(config.plex_server_url, config.plex_token);
}

async function fetchManagedUserTokens() {
    const plexTvApi = createPlexClient(
        'https://plex.tv',
        plexApi.defaults.headers['X-Plex-Token'],
        'application/xml'
    );
    // ...
}
```

#### Change 2.1b: Extract Media Navigation Helper

**New file: `mediaHelpers.js`:**
```javascript
const logger = require('./logger');

function getStreamsFromSession(session) {
    if (!session?.Media?.[0]?.Part?.[0]?.Stream) {
        throw new Error(`Invalid session structure: missing Media/Part/Stream`);
    }
    return session.Media[0].Part[0].Stream;
}

function getStreamsFromMetadata(metadata) {
    if (!metadata?.Media?.[0]?.Part?.[0]?.Stream) {
        throw new Error(`Invalid metadata structure: missing Media/Part/Stream`);
    }
    return metadata.Media[0].Part[0].Stream;
}

function getPartId(session) {
    if (!session?.Media?.[0]?.Part?.[0]?.id) {
        throw new Error(`Invalid session structure: missing Part id`);
    }
    return session.Media[0].Part[0].id;
}

module.exports = {
    getStreamsFromSession,
    getStreamsFromMetadata,
    getPartId
};
```

**Update audioFixer.js:**
```javascript
const { getStreamsFromSession, getPartId } = require('./mediaHelpers');

// Replace line 59
const currentStream = getStreamsFromSession(session).find(s => s.streamType === 2 && s.selected);

// Replace lines 78-82
const partId = getPartId(session);
```

**Update audioSelector.js:**
```javascript
const { getStreamsFromMetadata } = require('./mediaHelpers');

// Replace lines 7-10
const streams = getStreamsFromMetadata(mediaInfo);
```

---

### 2.2 Add Config Validation

**Time:** 1 hour

**Update config.js:**
```javascript
function validateAudioSelectorRules(rules) {
    const validCodecs = ['aac', 'ac3', 'eac3', 'dts', 'dts-hd', 'truehd', 'flac', 'mp3'];

    for (let i = 0; i < rules.length; i++) {
        const rule = rules[i];

        if (rule.codec && !validCodecs.includes(rule.codec)) {
            throw new Error(`Invalid codec in rule ${i}: "${rule.codec}". Valid: ${validCodecs.join(', ')}`);
        }

        if (rule.channels && (typeof rule.channels !== 'number' || rule.channels < 1 || rule.channels > 8)) {
            throw new Error(`Invalid channels in rule ${i}: ${rule.channels}. Must be 1-8`);
        }

        if (rule.language && rule.language !== 'original' && !/^[a-z]{2,3}$/.test(rule.language)) {
            throw new Error(`Invalid language in rule ${i}: "${rule.language}". Use "original" or ISO code (e.g., "eng")`);
        }

        if (rule.keywords_include && !Array.isArray(rule.keywords_include)) {
            throw new Error(`Invalid keywords_include in rule ${i}: must be array`);
        }

        if (rule.keywords_exclude && !Array.isArray(rule.keywords_exclude)) {
            throw new Error(`Invalid keywords_exclude in rule ${i}: must be array`);
        }
    }
}

function loadConfig() {
    // ... existing code ...

    if (!config.audio_selector || !Array.isArray(config.audio_selector)) {
        throw new Error('audio_selector must be array');
    }

    validateAudioSelectorRules(config.audio_selector);  // ← ADD THIS

    // Add config versioning
    if (config.config_version !== undefined && config.config_version !== 1) {
        throw new Error(`Unsupported config version: ${config.config_version}. This version supports: 1`);
    }

    logger.debug(`Loaded: mode=${config.mode}, dry_run=${config.dry_run}`);

    return config;
}
```

**Update config.yaml to include version:**
```yaml
config_version: 1
plex_server_url: ""
# ... rest of config ...
```

---

### 2.3 Make Logger Level Configurable

**Time:** 15 minutes

**Update logger.js:**
```javascript
const winston = require('winston');

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',  // ← Changed from 'debug'
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level.toUpperCase()}]: ${message}`)
    ),
    transports: [new winston.transports.Console()],
});

module.exports = logger;
```

**Update Dockerfile:**
```dockerfile
ENV LOG_LEVEL=info
```

**Update README.md:**
```markdown
## Environment Variables

- `LOG_LEVEL`: Logging level (default: `info`, options: `error`, `warn`, `info`, `debug`)
```

---

## Phase 3: Medium Priority (Priority 🟢)

### 3.1 Add State Persistence

**Time:** 2 hours

**Option A: Timestamp-based (Recommended)**

Instead of tracking processed items, check if session started recently:

**Update audioFixer.js:**
```javascript
// Remove processedMedia Set entirely

function shouldProcessSession(session) {
    // Only process if session started more than 5 seconds ago
    // This prevents processing the same session multiple times
    const sessionStartTime = new Date(session.viewOffset || 0);
    const now = new Date();
    const elapsedSeconds = (now - sessionStartTime) / 1000;

    return elapsedSeconds > 5;
}
```

---

### 3.2 Add Retry Logic

**Time:** 2 hours

**New file: `retryHelper.js`:**
```javascript
const logger = require('./logger');

async function retryWithBackoff(fn, maxRetries = 3, initialDelayMs = 1000, operationName = 'operation') {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            const isLastAttempt = attempt === maxRetries - 1;

            if (isLastAttempt) {
                logger.error(`${operationName} failed after ${maxRetries} attempts: ${error.message}`);
                throw error;
            }

            const delayMs = initialDelayMs * Math.pow(2, attempt);
            logger.warn(`${operationName} failed (attempt ${attempt + 1}/${maxRetries}), retrying in ${delayMs}ms: ${error.message}`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }
}

module.exports = { retryWithBackoff };
```

**Update plexClient.js for GET requests:**
```javascript
const { retryWithBackoff } = require('./retryHelper');

async function fetchSessions() {
    return retryWithBackoff(
        async () => {
            const response = await plexApi.get('/status/sessions');
            return response.data.MediaContainer.Metadata || [];
        },
        3,
        1000,
        'fetchSessions'
    );
}
```

---

### 3.3 Add Webhook Authentication

**Time:** 2 hours

**Update config.yaml:**
```yaml
webhook:
  enabled: true
  port: 4444
  host: "0.0.0.0"
  path: "/webhook"
  secret: ""  # Optional: shared secret for validation
```

**Update webhookServer.js:**
```javascript
function validateWebhookSecret(req, config) {
    if (!config.webhook.secret) {
        return true;  // No secret configured, skip validation
    }

    const providedSecret = req.headers['x-webhook-secret'];
    if (!providedSecret || providedSecret !== config.webhook.secret) {
        logger.warn(`Invalid webhook secret from ${req.ip}`);
        return false;
    }

    return true;
}

app.post(config.webhook.path, upload.single('thumb'), (req, res) => {
    if (!validateWebhookSecret(req, config)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    // ... rest of handler ...
});
```

---

## Testing Plan

### Unit Tests (Jest)

**Install:**
```bash
npm install --save-dev jest
```

**Test files:**
- `audioSelector.test.js` - Test rule matching logic
- `mediaHelpers.test.js` - Test navigation helpers
- `config.test.js` - Test config validation

### Integration Tests

**Test scenarios:**
1. Plex API unreachable → verify error propagation
2. Invalid audio_selector rule → verify config load fails
3. Webhook with wrong secret → verify 401 response
4. Session with transcode → verify audio switch

---

## Rollout Strategy

1. **Create feature branch:** `fix/architecture-alignment`
2. **Implement Phase 1** (critical fixes)
3. **Test in dry_run mode** for 24 hours
4. **Implement Phase 2** (high priority)
5. **Test in production mode** for 24 hours
6. **Implement Phase 3** (medium priority)
7. **Create PR** with full test results
8. **Merge to main**

---

## Success Criteria

- [ ] No orphaned code (configBuilder.js removed)
- [ ] All errors throw instead of returning empty values
- [ ] No silent fallbacks (webhook → polling removed)
- [ ] All error logs include stack traces
- [ ] Config validation fails on invalid rules
- [ ] Logger level configurable via LOG_LEVEL
- [ ] Dockerfile matches runtime behavior
- [ ] All TODO items in code addressed
- [ ] At least 80% test coverage on new helpers

---

**Last Updated:** 2025-11-17
