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

    if (String(session.sessionKey) === String(processingInfo.originalSessionKey)) {
        logger.debug(`Same session: ${session.sessionKey}`);
        return null;
    }

    logger.info(`Restarted: ${ratingKey}`);

    if (session.TranscodeSession) {
        logger.warn('Still transcoding (incompatible codec/client)');
        return false;
    }

    const streams = getStreamsFromSession(session);
    const activeStream = streams.find(s => s.streamType === 2 && s.selected);

    if (activeStream && String(activeStream.id) === String(processingInfo.expectedStreamId)) {
        logger.info(`Direct play: stream ${processingInfo.expectedStreamId}`);
        return true;
    } else {
        logger.warn(`Wrong stream: ${activeStream?.id} (want ${processingInfo.expectedStreamId})`);
        return false;
    }
}

function setValidationTimeout(timeoutSeconds) {
    if (!timeoutSeconds || typeof timeoutSeconds !== 'number' || timeoutSeconds <= 0) {
        throw new Error(`setValidationTimeout requires a positive number (got: ${timeoutSeconds})`);
    }
    validationTimeoutMs = timeoutSeconds * 1000;
    logger.info(`Validation: ${timeoutSeconds}s`);
}

async function resolveUserToken(session, config) {
    const sessionUsername = session.User.title;
    const managedUserTokens = await plexClient.fetchManagedUserTokens();

    if (sessionUsername === config.owner_username) {
        logger.debug(`Owner: ${sessionUsername}`);
        return config.plex_token;
    }

    if (managedUserTokens[session.User.id]) {
        logger.debug(`Managed: ${session.User.id}`);
        return managedUserTokens[session.User.id];
    }

    logger.warn(`Not owner/managed: ${sessionUsername} (${session.User.id})`);
    return null;
}

async function switchToStreamAndRestart(session, bestStream, userToken, config) {
    const partId = getPartId(session);
    await plexClient.setSelectedAudioStream(partId, bestStream.id, userToken, config.dry_run);

    if (config.dry_run) {
        logger.info(`[DRY] Kill transcode: ${session.TranscodeSession.key}`);
        logger.info(`[DRY] Kill session: ${session.Session.id}`);
        return true;
    }

    await plexClient.terminateTranscode(session.TranscodeSession.key);
    logger.info(`Kill transcode: ${session.TranscodeSession.key}`);

    const reason = 'Audio transcode detected. Switched to compatible track. Restart playback.';
    await plexClient.terminateSession(session.Session.id, reason);
    logger.info(`Kill session: ${session.Session.id}`);

    const playerUuid = session.Player?.uuid || session.Player?.machineIdentifier;
    const processingKey = `${session.ratingKey}:${playerUuid}`;
    processedMedia.set(processingKey, {
        timestamp: Date.now(),
        ratingKey: session.ratingKey,
        playerUuid: playerUuid,
        expectedStreamId: bestStream.id,
        originalSessionKey: session.sessionKey
    });

    logger.info(`Switched to ${bestStream.id}, awaiting validation`);
    return true;
}

async function processTranscodingSession(session, config) {
    try {
        logger.info(`Player: ${session.Player.title} (${session.Player.device}) user: ${session.User.title}`);

        const mediaInfo = await plexClient.fetchMetadata(session.ratingKey);
        const streams = getStreamsFromSession(session);
        const currentStream = streams.find(s => s.streamType === 2 && s.selected);

        if (!currentStream) {
            logger.warn('No audio stream');
            return false;
        }

        const bestStream = audioSelector.selectBestAudioStream(
            mediaInfo,
            currentStream.id,
            config.audio_selector
        );

        if (!bestStream) {
            logger.warn('No better stream');
            return false;
        }

        logger.info(`Better: ${bestStream.codec.toUpperCase()} ${bestStream.channels}ch (${bestStream.id})`);

        const userToken = await resolveUserToken(session, config);
        if (!userToken) {
            return false;
        }

        try {
            return await switchToStreamAndRestart(session, bestStream, userToken, config);
        } catch (error) {
            logger.error(`Fix: ${error.message}`);
            return false;
        }

    } catch (error) {
        logger.error(`Process: ${error.message}`);
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

        if (!currentSessionKeys.has(processingKey) && age > validationTimeoutMs) {
            logger.debug(`Cleanup: ${processingKey} (${Math.round(age / 1000)}s)`);
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

    if (age > validationTimeoutMs) {
        logger.debug(`Timeout: ${processingKey} (${Math.round(age / 1000)}s)`);
        processedMedia.delete(processingKey);
        return null;
    }

    return processingInfo;
}

function clearProcessingInfo(ratingKey, playerUuid) {
    const processingKey = `${ratingKey}:${playerUuid}`;
    processedMedia.delete(processingKey);
    logger.debug(`Clear: ${processingKey}`);
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

function markAsProcessed(ratingKey, playerUuid = 'polling') {
    const processingKey = `${ratingKey}:${playerUuid}`;
    processedMedia.set(processingKey, {
        timestamp: Date.now(),
        ratingKey: ratingKey,
        playerUuid: playerUuid,
        expectedStreamId: null,
        originalSessionKey: null
    });
    logger.debug(`Mark: ${processingKey}`);
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
