const logger = require('./logger');
const plexClient = require('./plexClient');
const audioSelector = require('./audioSelector');
const { getStreamsFromSession } = require('./mediaHelpers');

const processedMedia = new Map();
let validationTimeoutMs = null;

// --- HELPER: Safely get Part ID ---
function safelyGetPartId(mediaItem) {
    try {
        // VERBOSE DEBUG
        const hasMedia = mediaItem && mediaItem.Media && mediaItem.Media[0];
        const hasPart = hasMedia && mediaItem.Media[0].Part && mediaItem.Media[0].Part[0];
        
        if (!hasPart) {
            logger.error(`[DEBUG-V] safelyGetPartId: Structure check failed. Media: ${!!hasMedia}, Part: ${!!hasPart}`);
            return null;
        }
        return mediaItem.Media[0].Part[0].id;
    } catch (e) {
        logger.error(`[DEBUG-V] safelyGetPartId Exception: ${e.message}`);
        return null;
    }
}

function validateSessionRestart(session, processingInfo) {
    const ratingKey = session.ratingKey;
    const playerUuid = session.Player?.uuid || session.Player?.machineIdentifier;

    if (String(session.sessionKey) === String(processingInfo.originalSessionKey)) {
        logger.debug(`Same session: ${session.sessionKey}`);
        return null;
    }

    logger.info(`Restarted: ${ratingKey}`);

    if (session.TranscodeSession) {
        logger.warn('Still transcoding - codec incompatible with client, check audio_selector rules');
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
    
    logger.debug(`[DEBUG-V] resolveUserToken: Session User='${sessionUsername}', Config Owner='${config.owner_username}'`);

    // 1. Check Managed Users (verifies connectivity)
    const managedUserTokens = await plexClient.fetchManagedUserTokens();

    // 2. Check Owner
    if (sessionUsername === config.owner_username) {
        logger.debug(`[DEBUG-V] Owner Match. Calling plexClient.getOwnerToken()...`);
        try {
            const token = plexClient.getOwnerToken();
            if (!token) {
                logger.error(`[DEBUG-V] resolveUserToken: getOwnerToken returned falsy value.`);
                return null;
            }
            logger.debug(`[DEBUG-V] Owner token resolved successfully.`);
            return token;
        } catch (e) {
            logger.error(`[DEBUG-V] resolveUserToken: getOwnerToken threw error: ${e.message}`);
            return null;
        }
    }

    // 3. Check Managed
    if (managedUserTokens[session.User.id]) {
        logger.debug(`[DEBUG-V] Managed user match: ${session.User.id}`);
        return managedUserTokens[session.User.id];
    }

    logger.warn(`User ${sessionUsername} not owner/managed`);
    return null;
}

async function terminateStream(session, reason, config) {
    if (!config.terminate_stream) {
        logger.debug('Skip termination');
        return false;
    }

    if (config.dry_run) {
        logger.info(`[DRY] Kill transcode: ${session.TranscodeSession.key}`);
        return false;
    }

    await plexClient.terminateTranscode(session.TranscodeSession.key);
    await plexClient.terminateSession(session.Session.id, reason);
    return true;
}

async function switchToStreamAndRestart(session, bestStream, userToken, config, mediaInfo) {
    logger.debug(`[DEBUG-V] switchToStreamAndRestart: Getting Part ID...`);
    
    // Use clean mediaInfo, fallback to session if mediaInfo is null
    const sourceObject = mediaInfo || session;
    const partId = safelyGetPartId(sourceObject);
    
    if (!partId) {
        logger.error(`[DEBUG-V] ABORT: Could not determine Part ID. Dumping source object keys: ${Object.keys(sourceObject).join(',')}`);
        return false;
    }

    logger.debug(`[DEBUG-V] Part ID found: ${partId}. Calling setSelectedAudioStream...`);
    
    try {
        await plexClient.setSelectedAudioStream(partId, bestStream.id, userToken, config.dry_run);
    } catch (e) {
        logger.error(`[DEBUG-V] setSelectedAudioStream failed: ${e.message}`);
        return false;
    }

    const reason = 'Audio transcode detected. Switched to compatible track. Restart playback.';
    const terminated = await terminateStream(session, reason, config);

    if (terminated) {
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
    } else {
        logger.info(`Switched to ${bestStream.id}`);
    }

    return true;
}

async function processTranscodingSession(session, config) {
    try {
        logger.info(`Player: ${session.Player.title} (${session.Player.device}) user: ${session.User.title}`);

        // 1. Fetch clean metadata
        logger.debug(`[DEBUG-V] Fetching Metadata for ${session.ratingKey}...`);
        const mediaInfo = await plexClient.fetchMetadata(session.ratingKey);
        
        if (!mediaInfo) {
            logger.error(`[DEBUG-V] fetchMetadata returned null/undefined`);
            return false;
        }

        const streams = getStreamsFromSession(session);
        const currentStream = streams.find(s => s.streamType === 2 && s.selected);

        if (!currentStream) {
            logger.warn('No audio stream selected - media may be corrupted or unsupported');
            return false;
        }

        const bestStream = audioSelector.selectBestAudioStream(
            mediaInfo,
            currentStream.id,
            config.audio_selector
        );

        if (!bestStream) {
            logger.warn('No better stream found');
            return false;
        }

        logger.info(`Better: ${bestStream.codec.toUpperCase()} ${bestStream.channels}ch (${bestStream.id})`);

        // 2. Resolve Token
        logger.debug(`[DEBUG-V] Resolving User Token...`);
        const userToken = await resolveUserToken(session, config);
        
        if (!userToken) {
            logger.warn(`ABORT: No valid token found for user ${session.User.title}`);
            return false;
        }

        // 3. Switch
        logger.debug(`[DEBUG-V] Token resolved. Executing Switch...`);
        return await switchToStreamAndRestart(session, bestStream, userToken, config, mediaInfo);

    } catch (error) {
        logger.error(`Process Error: ${error.message}`);
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
    if (validationTimeoutMs === null) throw new Error('validationTimeoutMs not set');
    const processingKey = `${ratingKey}:${playerUuid}`;
    const processingInfo = processedMedia.get(processingKey);
    if (!processingInfo) return null;
    const age = Date.now() - processingInfo.timestamp;
    if (age > validationTimeoutMs) {
        logger.debug(`Timeout: ${processingKey}`);
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
    if (validationTimeoutMs === null) throw new Error('validationTimeoutMs not set');
    for (const [processingKey, processingInfo] of processedMedia.entries()) {
        if (processingInfo.ratingKey === ratingKey) {
            const age = Date.now() - processingInfo.timestamp;
            if (age <= validationTimeoutMs) return true;
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
