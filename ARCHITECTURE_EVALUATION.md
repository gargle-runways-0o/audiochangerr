# Architecture Evaluation Report

**Date:** 2025-11-17
**Project:** audiochangerr
**Evaluated Against:** Architecture Principles (Modular, Incremental, DRY, KISS, Forward-Thinking, Fail Fast, Skeptic)

---

## Executive Summary

The audiochangerr project demonstrates **good modular design** with clear separation of concerns, but has **critical violations** of the "Fail Fast" principle and several issues with code duplication, orphaned code, and silent error handling. The most pressing issues are:

1. **Silent error swallowing** in API layer (plexClient.js)
2. **Orphaned configuration system** (configBuilder.js)
3. **Code duplication** in error handling and data navigation
4. **Dockerfile/config mismatches** that create deployment confusion
5. **Lack of automated tests** preventing safe refactoring

**Priority:** HIGH - Fail Fast violations can mask critical production issues

---

## Detailed Analysis by Principle

### 1. MODULAR: Clear Separation of Concerns ⚠️

**Score: 7/10**

#### ✅ Strengths
- Clean separation of responsibilities:
  - `plexClient.js` - API layer
  - `audioFixer.js`, `audioSelector.js` - Business logic
  - `webhookServer.js` - Transport layer
  - `config.js` - Configuration
  - `logger.js` - Cross-cutting concerns
- No circular dependencies
- Modules export clear interfaces
- Single responsibility per file

#### ❌ Issues

**Issue 1.1: Orphaned Configuration System**
- **Location:** `configBuilder.js` (entire file, 248 lines)
- **Problem:** Complete configuration validation system that's never imported or used
- **Evidence:**
  - Different schema (requires `plex_client_identifier`, `groups`, `filters`)
  - Current config.yaml uses simple structure with `audio_selector`
  - Dependencies `ajv` and `ajv-formats` only used here
- **Impact:** Code confusion, wasted dependencies, maintenance burden
- **Recommendation:** Remove `configBuilder.js` and unused dependencies

**Issue 1.2: Dockerfile Configuration Mismatch**
- **Location:** `Dockerfile:7,9`
- **Problem:**
  ```dockerfile
  EXPOSE 3189  # ← Wrong port (webhook uses 4444)
  CMD ["node", "main.js", "/logs", "/config/config.yaml", "/config/last_run_timestamps.json"]
  # ← main.js ignores all arguments
  ```
- **Evidence:** `main.js` never accesses `process.argv`; config path hardcoded to `./config.yaml`
- **Impact:** Deployment confusion, port conflicts, broken volume mounts
- **Recommendation:** Fix Dockerfile to match actual runtime behavior

**Issue 1.3: Unused Dependencies**
- **Location:** `package.json:10-11`
- **Problem:** `ajv` and `ajv-formats` only used in orphaned configBuilder.js
- **Impact:** Larger Docker image, security surface, maintenance burden
- **Recommendation:** Remove after deleting configBuilder.js

---

### 2. INCREMENTAL: Each Feature Builds on Previous ⚠️

**Score: 5/10**

#### ❌ Issues

**Issue 2.1: Competing Configuration Systems**
- **Locations:** `config.js` vs `configBuilder.js`
- **Problem:** Two incompatible config schemas suggest incomplete migration
  - `configBuilder.js`: Complex schema with groups/filters/on_match rules
  - `config.js`: Simple schema with audio_selector array
- **Evidence:** Git history shows "Defaulterr" references in configBuilder.js (likely legacy)
- **Impact:** Unclear which is authoritative, blocks future enhancements
- **Recommendation:**
  1. Document decision to use simple schema
  2. Remove configBuilder.js
  3. Add config versioning (`config_version: 1`) for future migrations

**Issue 2.2: No Schema Versioning**
- **Location:** `config.yaml`
- **Problem:** No version field to handle future schema changes
- **Impact:** Breaking changes will require manual migration with no validation
- **Recommendation:** Add `config_version: 1` and validate in config.js

---

### 3. DRY: No Code Duplication 🔴

**Score: 4/10**

#### ❌ Critical Issues

**Issue 3.1: Duplicate Axios Instance Creation**
- **Locations:** `plexClient.js:8-16` and `plexClient.js:100-107`
- **Problem:** Same axios.create pattern with timeout 600000
  ```javascript
  // Line 8-15
  plexApi = axios.create({
      baseURL: config.plex_server_url,
      headers: { 'X-Plex-Token': config.plex_token, 'Accept': 'application/json' },
      timeout: 600000
  });

  // Line 100-107 (inside fetchManagedUserTokens)
  const plexTvApi = axios.create({
      baseURL: 'https://plex.tv',
      headers: { 'X-Plex-Token': plexApi.defaults.headers['X-Plex-Token'], 'Accept': 'application/xml' },
      timeout: 600000
  });
  ```
- **Recommendation:** Extract `createPlexClient(baseURL, token, accept)` helper

**Issue 3.2: Repeated Error Handling Pattern**
- **Locations:** `plexClient.js:22-29`, `36-43`, `129-136`
- **Problem:** Same try/catch/log/return pattern repeated 3+ times
  ```javascript
  try {
      const response = await plexApi.get(...);
      return response.data...;
  } catch (error) {
      if (error.response) {
          logger.error(`GET ...: ${error.response.status} ${error.response.statusText}`);
      } else {
          logger.error(`GET ...: ${error.message}`);
      }
      return []; // or null or {}
  }
  ```
- **Recommendation:** Extract `handlePlexApiCall(fn, errorMsg, fallback)` wrapper

**Issue 3.3: Repeated Media Navigation Pattern**
- **Locations:** `audioFixer.js:59`, `78`, `31`; `audioSelector.js:7`
- **Problem:** `session.Media[0].Part[0].Stream` repeated without helper
- **Impact:** Brittle code, difficult to add null checks
- **Recommendation:** Extract `getStreamsFromSession(session)` helper with validation

**Issue 3.4: Duplicate Session Fetching Logic**
- **Locations:** `main.js:19` (polling) and `main.js:62` (webhook cleanup)
- **Problem:** Both modes fetch and cleanup sessions with same logic
- **Recommendation:** Extract `scheduleSessionCleanup(intervalMs)` function

---

### 4. KISS: Simplicity Over Cleverness ⚠️

**Score: 7/10**

#### ✅ Strengths
- Straightforward function names
- Clear control flow in most modules
- Minimal abstraction where appropriate

#### ❌ Issues

**Issue 4.1: Overly Complex Config Schema**
- **Location:** `configBuilder.js:11-218`
- **Problem:** 180+ line JSON schema for 6 config fields
- **Evidence:** Nested `oneOf`, `patternProperties`, `additionalProperties` combinations
- **Impact:** Impossible to maintain or extend
- **Recommendation:** Already addressed by Issue 1.1 (remove file)

**Issue 4.2: Nested Filter/Find in Audio Selection**
- **Location:** `audioSelector.js:34-93`
- **Problem:** `isStreamMatch` function has 5 levels of nesting
- **Recommendation:** Extract rule validators: `matchesCodec()`, `matchesChannels()`, etc.

---

### 5. FORWARD-THINKING: Consider Future Features ⚠️

**Score: 5/10**

#### ❌ Issues

**Issue 5.1: Hardcoded Logger Level**
- **Location:** `logger.js:4`
- **Problem:** `level: 'debug'` hardcoded, no environment variable support
- **Impact:** Cannot reduce log verbosity in production
- **Recommendation:**
  ```javascript
  level: process.env.LOG_LEVEL || 'info'
  ```

**Issue 5.2: In-Memory State Without Persistence**
- **Location:** `audioFixer.js:5`
- **Problem:** `processedMedia` Set lost on restart
- **Impact:** Re-processes same media after restart, potential user disruption
- **Recommendation:**
  - Option 1: Persist to disk (simplest)
  - Option 2: Use timestamp-based detection instead of Set

**Issue 5.3: No Webhook Authentication**
- **Location:** `webhookServer.js:21`
- **Problem:** POST /webhook accepts any request
- **Impact:** Security vulnerability, future requirement
- **Recommendation:** Add optional HMAC signature validation or shared secret

**Issue 5.4: No Retry Logic**
- **Location:** `plexClient.js` (all API calls)
- **Problem:** Single attempt for all API calls
- **Impact:** Transient network issues cause permanent failures
- **Recommendation:** Add exponential backoff for GET requests

**Issue 5.5: No Config Validation for Audio Rules**
- **Location:** `config.js:38-40`
- **Problem:** Only checks if array, doesn't validate rule structure
- **Impact:** Invalid rules (wrong codec names, negative channels) fail silently
- **Recommendation:** Validate codec against allowlist, channels >= 1, language format

---

### 6. FAIL FAST: Surface Errors Immediately 🔴🔴🔴

**Score: 2/10** ← **CRITICAL**

#### ❌ Critical Violations

**Issue 6.1: Silent Webhook Failure Fallback**
- **Location:** `main.js:50-58`
- **Problem:** Webhook start failure falls back to polling without user awareness
  ```javascript
  try {
      webhookServer.start(config, handleWebhook);
      // ...
  } catch (error) {
      logger.error(`Webhook start failed: ${error.message}`);
      logger.error('Falling back to polling');  // ← MASKS PROBLEM
      startPollingMode();
  }
  ```
- **Impact:** User thinks webhook is active but polling is running (wrong mode)
- **Root Cause:** Violates explicit mode selection
- **Recommendation:** Remove fallback, exit with error code 1

**Issue 6.2: fetchSessions Returns Empty Array on Error**
- **Location:** `plexClient.js:18-30`
- **Problem:** Swallows all errors and returns `[]`
  ```javascript
  } catch (error) {
      logger.error(`GET /status/sessions: ...`);
      return [];  // ← CANNOT DISTINGUISH ERROR FROM EMPTY
  }
  ```
- **Impact:**
  - Authentication failures silently treated as "no sessions"
  - Network errors indistinguishable from normal operation
  - Cleanup logic removes all processed media on transient errors
- **Recommendation:** Throw error, let caller decide how to handle

**Issue 6.3: fetchMetadata Returns null on Error**
- **Location:** `plexClient.js:32-44`
- **Problem:** `null` return value ambiguous
- **Impact:** Caller cannot distinguish "metadata doesn't exist" from "API error"
- **Recommendation:** Throw error with specific message

**Issue 6.4: fetchManagedUserTokens Returns Empty Object on Error**
- **Location:** `plexClient.js:98-137`
- **Problem:** Returns `{}` on authentication/network errors
- **Impact:** Managed users silently skipped instead of surfacing auth issues
- **Recommendation:** Throw error on auth failure, allow empty object only on success with no tokens

**Issue 6.5: terminateTranscode/terminateSession Have No Error Handling**
- **Location:** `plexClient.js:68-76`
- **Problem:**
  ```javascript
  async function terminateTranscode(transcodeKey) {
      await plexApi.delete(transcodeKey);  // ← NO CATCH
  }
  ```
- **Impact:** Unhandled promise rejections crash process or fail silently
- **Recommendation:** Add try/catch, log and re-throw

**Issue 6.6: Async Webhook Processing Errors Swallowed**
- **Location:** `webhookServer.js:46-51`
- **Problem:**
  ```javascript
  if (onWebhook) {
      onWebhook(payload).catch(error => {
          logger.error(`Processing error: ${error.message}`);
          // ← ERROR LOGGED BUT NOT PROPAGATED
      });
  }
  ```
- **Impact:** Processing failures invisible to monitoring/alerting
- **Recommendation:** Emit event or increment error counter for monitoring

**Issue 6.7: Validation Failure Allows Retry Without Root Cause Analysis**
- **Location:** `audioFixer.js:116-123`
- **Problem:**
  ```javascript
  const validated = await waitForSessionRestart(session, bestStream.id);
  if (validated) {
      logger.info(`Success: media ${session.ratingKey}`);
      return true;
  } else {
      logger.error(`Validation failed: media ${session.ratingKey}, will retry if persists`);
      return false;  // ← RETRY ASSUMPTION, NO INVESTIGATION
  }
  ```
- **Impact:** Same error repeats forever without understanding why
- **Recommendation:** Add failure reason return value, log diagnostics before retry

**Issue 6.8: No Validation of Audio Selector Rules**
- **Location:** `audioSelector.js:34-93`
- **Problem:** Invalid rules (e.g., `codec: 'invalid'`) silently fail to match
- **Impact:** User thinks rules are working but they're being skipped
- **Recommendation:** Validate rule structure in config.js, throw on invalid codec/language

---

### 7. SKEPTIC: Always Be Skeptical of Errors 🔴

**Score: 3/10**

#### ❌ Issues

**Issue 7.1: Missing Stack Traces**
- **Locations:** `plexClient.js:24-26`, `38-40`, `131-133`
- **Problem:** Only logs `error.message`, not `error.stack`
- **Impact:** Cannot debug root cause of API failures
- **Recommendation:** Add `logger.debug(error.stack)` to all error handlers

**Issue 7.2: Validation Failure Assumes Transient Error**
- **Location:** `audioFixer.js:121`
- **Problem:** "will retry if persists" assumes error is temporary
- **Evidence:** Could be wrong codec, permission issue, or client bug
- **Recommendation:** Distinguish between retryable and permanent failures

**Issue 7.3: Empty Return Values Hide Failure Modes**
- **Location:** `plexClient.js` (multiple functions)
- **Problem:** Cannot differentiate between "legitimately empty" and "error occurred"
- **Impact:** Debugging requires correlating logs instead of checking return values
- **Recommendation:** Use Result type or throw errors

**Issue 7.4: processedMedia Cleanup May Remove Retryable Items**
- **Location:** `audioFixer.js:137-145`
- **Problem:** If fetchSessions fails, all items removed from processedMedia
- **Impact:** Same media re-processed after transient error recovery
- **Recommendation:** Only cleanup if sessions fetch succeeded (Issue 6.2 dependency)

---

## Priority Recommendations

### 🔴 CRITICAL (Fix Immediately)

1. **Remove Orphaned Code**
   - Delete `configBuilder.js`
   - Remove `ajv`, `ajv-formats` from package.json
   - **Files:** configBuilder.js, package.json:10-11

2. **Fix Fail Fast Violations**
   - Remove webhook→polling fallback in main.js:54-58
   - Make plexClient functions throw errors instead of returning empty values
   - Add error handling to terminateTranscode/terminateSession
   - **Files:** main.js, plexClient.js

3. **Fix Dockerfile Mismatches**
   - Change EXPOSE to 4444 or make configurable
   - Fix CMD to remove unused arguments
   - **Files:** Dockerfile:7,9

### 🟡 HIGH (Fix Soon)

4. **Eliminate Code Duplication**
   - Extract `createPlexClient()` helper
   - Extract `handlePlexApiCall()` error handler
   - Extract `getStreamsFromSession()` navigation helper
   - **Files:** plexClient.js, audioFixer.js, audioSelector.js

5. **Add Config Validation**
   - Validate audio_selector rules (codec allowlist, channel range)
   - Add config_version field
   - **Files:** config.js

6. **Add Logging Improvements**
   - Make log level configurable via LOG_LEVEL env var
   - Add error.stack to all error logs
   - **Files:** logger.js, plexClient.js

### 🟢 MEDIUM (Backlog)

7. **Add State Persistence**
   - Save processedMedia to disk or use timestamps
   - **Files:** audioFixer.js

8. **Add Retry Logic**
   - Exponential backoff for API calls
   - **Files:** plexClient.js

9. **Add Security**
   - Optional webhook authentication
   - **Files:** webhookServer.js, config.yaml

10. **Add Testing**
    - Unit tests for audioSelector logic
    - Integration tests for plexClient
    - **Files:** New test/ directory

---

## Metrics Summary

| Principle | Score | Status |
|-----------|-------|--------|
| Modular | 7/10 | ⚠️ Warning |
| Incremental | 5/10 | ⚠️ Warning |
| DRY | 4/10 | 🔴 Poor |
| KISS | 7/10 | ⚠️ Warning |
| Forward-Thinking | 5/10 | ⚠️ Warning |
| **Fail Fast** | **2/10** | 🔴🔴 **Critical** |
| Skeptic | 3/10 | 🔴 Poor |
| **Overall** | **4.7/10** | 🔴 **Needs Work** |

---

## Conclusion

The audiochangerr project has a **solid modular foundation** but suffers from **critical architectural violations**, particularly around error handling (Fail Fast principle). The presence of orphaned code (configBuilder.js) and Dockerfile mismatches suggests incomplete refactoring.

**Immediate Action Required:**
1. Fix Fail Fast violations (remove error swallowing)
2. Remove orphaned configuration system
3. Fix Dockerfile configuration

**Estimated Effort:** 1-2 days for critical fixes, 1 week for all high-priority improvements

**Risk Assessment:**
- **Production Risk:** HIGH - Silent error swallowing can mask authentication, network, or permission issues
- **Maintenance Risk:** MEDIUM - Code duplication and lack of tests make refactoring risky
- **Security Risk:** LOW - No webhook auth, but limited attack surface

---

**Evaluator:** Claude (Sonnet 4.5)
**Report Version:** 1.0
