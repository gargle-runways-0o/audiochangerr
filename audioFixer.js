const logger = require('./logger');
const plexClient = require('./plexClient');
const audioSelector = require('./audioSelector');
const { getStreamsFromSession, getPartId } = require('./mediaHelpers');

// Track processed media with metadata for event-driven validation
// Structure: ratingKey+playerUuid -> { timestamp, playerUuid, expectedStreamId, originalSessionKey }
const processedMedia = new Map();
let validationTimeoutMs = null; // Must be set from config via setValidationTimeout()

/**
 * Validates a session after audio track switch.
 * Called when a webhook arrives for previously processed media.
 */
function validateSessionRestart(session, processingInfo) {
    const ratingKey = session.ratingKey;
    const playerUuid = session.Player?.uuid || session.Player?.machineIdentifier;

    // Check if this is a new session (different sessionKey)
    if (String(session.sessionKey) === String(processingInfo.originalSessionKey)) {
        logger.debug(`Same session key, waiting for restart: ${session.sessionKey}`);
        return null; // Still the old session, not restarted yet
    }

    logger.info(`Session restarted: media ${ratingKey}, validating...`);

    // Check if still transcoding
    if (session.TranscodeSession) {
        logger.warn(`Still transcoding after audio switch - incompatible codec or client limitation`);
        logger.debug(`TranscodeSession: ${JSON.stringify(session.TranscodeSession, null, 2)}`);
        return false; // We tried, but it's still transcoding
    }

    // Check if correct audio stream is selected
    const streams = getStreamsFromSession(session);
    const activeStream = streams.find(s => s.streamType === 2 && s.selected);

    if (activeStream && String(activeStream.id) === String(processingInfo.expectedStreamId)) {
        logger.info(`✓ Validated: direct play with correct audio stream ${processingInfo.expectedStreamId}`);
        return true;
    } else {
        logger.warn(`Wrong audio stream: got ${activeStream?.id}, expected ${processingInfo.expectedStreamId}`);
        return false;
    }
}

/**
 * Sets the validation timeout from config (required)
 */
function setValidationTimeout(timeoutSeconds) {
    if (!timeoutSeconds || typeof timeoutSeconds !== 'number' || timeoutSeconds <= 0) {
        throw new Error(`setValidationTimeout requires a positive number (got: ${timeoutSeconds})`);
    }
    validationTimeoutMs = timeoutSeconds * 1000;
    logger.info(`Validation timeout: ${timeoutSeconds}s`);
}

async function resolveUserToken(session, config) {
    const sessionUsername = session.User.title;
    const managedUserTokens = await plexClient.fetchManagedUserTokens();
    logger.debug(`User: ${JSON.stringify(session.User, null, 2)}`);

    if (sessionUsername === config.owner_username) {
        logger.debug(`Owner (${sessionUsername}): using owner token`);
        return config.plex_token;
    }

    if (managedUserTokens[session.User.id]) {
        logger.debug(`Managed user ${session.User.id}: using fetched token`);
        return managedUserTokens[session.User.id];
    }

    logger.warn(`User '${sessionUsername}' (${session.User.id}): not owner or managed, skipping`);
    return null;
}

async function switchToStreamAndRestart(session, bestStream, userToken, config) {
    const partId = getPartId(session);
    await plexClient.setSelectedAudioStream(partId, bestStream.id, userToken, config.dry_run);

    if (config.dry_run) {
        logger.info(`[DRY RUN] Terminate transcode: ${session.TranscodeSession.key}`);
        logger.info(`[DRY RUN] Terminate session: ${session.Session.id}`);
        return true;
    }

    await plexClient.terminateTranscode(session.TranscodeSession.key);
    logger.info(`Terminated transcode: ${session.TranscodeSession.key}`);

    const reason = 'Audio transcode detected. Switched to compatible track. Restart playback.';
    await plexClient.terminateSession(session.Session.id, reason);
    logger.info(`Terminated session: ${session.Session.id}`);

    // Mark as processed with metadata for event-driven validation
    const playerUuid = session.Player?.uuid || session.Player?.machineIdentifier;
    const processingKey = `${session.ratingKey}:${playerUuid}`;
    processedMedia.set(processingKey, {
        timestamp: Date.now(),
        ratingKey: session.ratingKey,
        playerUuid: playerUuid,
        expectedStreamId: bestStream.id,
        originalSessionKey: session.sessionKey
    });

    logger.info(`Audio switched to stream ${bestStream.id}, waiting for webhook to validate restart...`);
    return true;
}

async function processTranscodingSession(session, config) {
    try {
        logger.info(`Transcode: ${session.Player.title} on ${session.Player.device}, user ${session.User.title}`);

        const mediaInfo = await plexClient.fetchMetadata(session.ratingKey);
        const streams = getStreamsFromSession(session);
        const currentStream = streams.find(s => s.streamType === 2 && s.selected);

        if (!currentStream) {
            logger.warn(`No current audio stream: ${session.Player.title}`);
            return false;
        }

        const bestStream = audioSelector.selectBestAudioStream(
            mediaInfo,
            currentStream.id,
            config.audio_selector
        );

        if (!bestStream) {
            logger.warn(`No better stream: ${session.Player.title}`);
            return false;
        }

        logger.info(`Better stream: ${bestStream.codec.toUpperCase()} ${bestStream.channels}ch (ID: ${bestStream.id})`);

        const userToken = await resolveUserToken(session, config);
        if (!userToken) {
            return false;
        }

        try {
            return await switchToStreamAndRestart(session, bestStream, userToken, config);
        } catch (error) {
            logger.error(`Fix failed: ${error.message}`);
            return false;
        }

    } catch (error) {
        logger.error(`Processing error: ${error.message}`);
        logger.debug(error.stack);
        return false;
    }
}

function cleanupProcessedMedia(currentSessions) {
    if (validationTimeoutMs === null) {
        throw new Error('validationTimeoutMs not set - call setValidationTimeout() first');
    }

    const now = Date.now();
    const currentSessionKeys = new Set(
        currentSessions.map(s => {
            const playerUuid = s.Player?.uuid || s.Player?.machineIdentifier;
            return `${s.ratingKey}:${playerUuid}`;
        })
    );

    for (const [processingKey, processingInfo] of processedMedia.entries()) {
        const age = now - processingInfo.timestamp;

        // Remove if not in current sessions AND validation timeout has expired
        if (!currentSessionKeys.has(processingKey) && age > validationTimeoutMs) {
            logger.debug(`Cleanup: ${processingKey} (age: ${Math.round(age / 1000)}s, expired)`);
            processedMedia.delete(processingKey);
        }
    }
}

function getProcessingInfo(ratingKey, playerUuid) {
    if (validationTimeoutMs === null) {
        throw new Error('validationTimeoutMs not set - call setValidationTimeout() first');
    }

    const processingKey = `${ratingKey}:${playerUuid}`;
    const processingInfo = processedMedia.get(processingKey);

    if (!processingInfo) {
        return null;
    }

    const age = Date.now() - processingInfo.timestamp;

    // Check if validation timeout has expired
    if (age > validationTimeoutMs) {
        logger.debug(`Validation timeout expired for ${processingKey} (age: ${Math.round(age / 1000)}s)`);
        processedMedia.delete(processingKey);
        return null;
    }

    return processingInfo;
}

function clearProcessingInfo(ratingKey, playerUuid) {
    const processingKey = `${ratingKey}:${playerUuid}`;
    processedMedia.delete(processingKey);
    logger.debug(`Cleared processing info: ${processingKey}`);
}

function isProcessed(ratingKey) {
    if (validationTimeoutMs === null) {
        throw new Error('validationTimeoutMs not set - call setValidationTimeout() first');
    }

    // Check if ANY processing info exists for this ratingKey (any player)
    for (const [processingKey, processingInfo] of processedMedia.entries()) {
        if (processingInfo.ratingKey === ratingKey) {
            const age = Date.now() - processingInfo.timestamp;
            if (age <= validationTimeoutMs) {
                return true;
            }
        }
    }
    return false;
}

/**
 * Simple mark as processed (for polling mode or when validation not needed)
 * Creates a minimal processing entry without expecting webhook validation
 */
function markAsProcessed(ratingKey, playerUuid = 'polling') {
    const processingKey = `${ratingKey}:${playerUuid}`;
    processedMedia.set(processingKey, {
        timestamp: Date.now(),
        ratingKey: ratingKey,
        playerUuid: playerUuid,
        expectedStreamId: null,
        originalSessionKey: null
    });
    logger.debug(`Marked as processed: ${processingKey}`);
}

module.exports = {
    processTranscodingSession,
    validateSessionRestart,
    setValidationTimeout,
    cleanupProcessedMedia,
    getProcessingInfo,
    clearProcessingInfo,
    markAsProcessed,
    isProcessed
};
