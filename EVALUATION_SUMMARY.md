# Architecture Evaluation Summary

**Date:** 2025-11-17
**Status:** 🔴 **Critical Issues Found**
**Overall Score:** 4.7/10

---

## Quick Assessment

The audiochangerr project has **good modular design** but **critical error handling violations** that can mask production failures.

### 🔴 Critical Issues (Fix Immediately)

1. **Silent Error Swallowing** - API functions return empty values instead of throwing errors
   - `fetchSessions()` returns `[]` on auth/network failures
   - `fetchMetadata()` returns `null` on errors
   - Cannot distinguish "no data" from "error occurred"

2. **Orphaned Code** - 248-line `configBuilder.js` never used
   - Different schema than actual config
   - Wastes dependencies (ajv, ajv-formats)

3. **Dockerfile Mismatch** - Wrong port (3189 vs 4444) and invalid CMD arguments

4. **Silent Fallback** - Webhook mode silently falls back to polling on failure

### Principle Scores

| Principle | Score | Key Issue |
|-----------|-------|-----------|
| Modular | 7/10 | Orphaned configBuilder.js |
| Incremental | 5/10 | Competing config systems |
| DRY | 4/10 | Duplicate error handling, axios creation |
| KISS | 7/10 | Overly complex schema (unused) |
| Forward-Thinking | 5/10 | Hardcoded logger, no persistence |
| **Fail Fast** | **2/10** | 🔴 **Returns empty instead of throwing** |
| Skeptic | 3/10 | Missing stack traces, no root cause analysis |

---

## Impact Analysis

### Production Risks

**HIGH RISK:**
- Authentication failures treated as "no sessions" → silent operation failure
- Network errors indistinguishable from normal operation
- Users think webhook mode is active but polling is running

**MEDIUM RISK:**
- In-memory state lost on restart → re-processes same media
- No retry logic → transient errors become permanent
- Missing stack traces → difficult debugging

**LOW RISK:**
- No webhook authentication → limited attack surface
- Code duplication → maintenance burden but not critical

---

## Fix Priority

### Phase 1: Critical (3-4 hours)
1. Remove `configBuilder.js` and unused deps
2. Make plexClient functions throw errors
3. Remove webhook→polling fallback
4. Fix Dockerfile port and CMD

### Phase 2: High (4-5 hours)
5. Extract helper functions (eliminate duplication)
6. Add config validation for audio rules
7. Make logger level configurable

### Phase 3: Medium (4-6 hours)
8. Add state persistence or timestamp-based detection
9. Add retry logic with exponential backoff
10. Add webhook authentication

**Total Estimated Time:** 3-5 days

---

## Specific Code Issues

### Most Critical

```javascript
// ❌ BAD: plexClient.js:22-29
async function fetchSessions() {
    try {
        const response = await plexApi.get('/status/sessions');
        return response.data.MediaContainer.Metadata || [];
    } catch (error) {
        logger.error(`GET /status/sessions: ${error.message}`);
        return [];  // ← Auth failure looks like empty sessions!
    }
}

// ✅ GOOD: Throw error
async function fetchSessions() {
    try {
        const response = await plexApi.get('/status/sessions');
        return response.data.MediaContainer.Metadata || [];
    } catch (error) {
        logger.error(`GET /status/sessions: ${error.message}`);
        logger.debug(error.stack);
        throw error;  // ← Let caller decide how to handle
    }
}
```

### Code Duplication Examples

```javascript
// ❌ DUPLICATED: axios.create pattern (lines 8-15 and 100-107)
plexApi = axios.create({ baseURL: ..., timeout: 600000 });
plexTvApi = axios.create({ baseURL: ..., timeout: 600000 });

// ✅ BETTER: Extract helper
function createPlexClient(baseURL, token, accept = 'application/json') {
    return axios.create({ baseURL, headers: { 'X-Plex-Token': token, 'Accept': accept }, timeout: 600000 });
}
```

```javascript
// ❌ DUPLICATED: Media navigation (3+ locations)
session.Media[0].Part[0].Stream
mediaInfo.Media[0].Part[0].Stream

// ✅ BETTER: Extract helper
function getStreamsFromSession(session) {
    if (!session?.Media?.[0]?.Part?.[0]?.Stream) {
        throw new Error('Invalid session structure');
    }
    return session.Media[0].Part[0].Stream;
}
```

---

## Files to Review

### Must Fix
- ❌ `configBuilder.js` - Delete (248 lines of unused code)
- 🔴 `plexClient.js` - Critical error handling violations
- 🔴 `main.js` - Remove webhook fallback (lines 54-58)
- 🔴 `Dockerfile` - Fix port and CMD

### Should Refactor
- 🟡 `audioFixer.js` - Duplicate navigation pattern
- 🟡 `audioSelector.js` - Nested complexity
- 🟡 `logger.js` - Hardcoded level
- 🟡 `config.js` - Add rule validation

### Minor Issues
- 🟢 `webhookServer.js` - Add authentication
- 🟢 `webhookProcessor.js` - Add retry logic

---

## Recommended Next Steps

1. **Read Full Reports:**
   - `ARCHITECTURE_EVALUATION.md` - Detailed analysis of all violations
   - `IMPLEMENTATION_PLAN.md` - Step-by-step fix instructions

2. **Start with Phase 1:**
   ```bash
   # Remove orphaned code
   rm configBuilder.js
   npm uninstall ajv ajv-formats

   # Fix critical error handling
   # See IMPLEMENTATION_PLAN.md sections 1.2-1.4
   ```

3. **Test Changes:**
   ```bash
   # Dry run mode for 24h
   LOG_LEVEL=debug npm start

   # Verify errors are surfaced
   # Check logs for stack traces
   ```

4. **Create PR:**
   - Branch: `fix/architecture-alignment`
   - Link to evaluation documents
   - Include test results

---

## Questions?

See detailed documentation:
- **ARCHITECTURE_EVALUATION.md** - Complete analysis with examples
- **IMPLEMENTATION_PLAN.md** - Code changes and testing strategy

---

**Evaluation Tool:** Claude Sonnet 4.5
**Analysis Method:** Static code review against architecture principles
**Coverage:** All 9 .js files, Dockerfile, config structure
