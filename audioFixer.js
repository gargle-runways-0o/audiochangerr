const logger = require('./logger');
const plexClient = require('./plexClient');
const audioSelector = require('./audioSelector');
const { getStreamsFromSession, getPartId } = require('./mediaHelpers');

// Track processed media with timestamps to allow re-processing after cooldown
const processedMedia = new Map(); // ratingKey -> timestamp
const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes cooldown before re-processing

async function waitForSessionRestart(originalSession, expectedStreamId, maxWaitSeconds = 120) {
    const maxAttempts = maxWaitSeconds / 2;
    logger.info(`Waiting for restart: media ${originalSession.ratingKey}, max ${maxWaitSeconds}s`);

    for (let i = 0; i < maxAttempts; i++) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        logger.debug(`Attempt ${i + 1}/${maxAttempts}: media ${originalSession.ratingKey}`);

        const sessions = await plexClient.fetchSessions();
        const newSession = sessions.find(s =>
            String(s.ratingKey) === String(originalSession.ratingKey) &&
            String(s.Player.machineIdentifier) === String(originalSession.Player.machineIdentifier) &&
            String(s.sessionKey) !== String(originalSession.sessionKey)
        );

        if (newSession) {
            logger.info(`New session found: media ${originalSession.ratingKey}`);
            logger.debug(`Session: ${JSON.stringify(newSession, null, 2)}`);

            if (newSession.TranscodeSession) {
                logger.error(`Still transcoding: ${JSON.stringify(newSession.TranscodeSession, null, 2)}`);
                return false;
            }

            const streams = getStreamsFromSession(newSession);
            const activeStream = streams.find(s => s.streamType === 2 && s.selected);
            logger.debug(`Active stream: ${JSON.stringify(activeStream)}`);

            if (activeStream && String(activeStream.id) === String(expectedStreamId)) {
                logger.info(`Validated: direct play with stream ${expectedStreamId}`);
                return true;
            } else {
                logger.error(`Wrong stream: got ${activeStream?.id}, expected ${expectedStreamId}`);
                logger.debug(`All streams: ${JSON.stringify(streams, null, 2)}`);
                return false;
            }
        }
    }

    logger.warn(`Timeout: no restart for media ${originalSession.ratingKey} in ${maxWaitSeconds}s`);
    return false;
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

    const validated = await waitForSessionRestart(session, bestStream.id);
    if (validated) {
        logger.info(`Success: media ${session.ratingKey}`);
        return true;
    }

    logger.error(`Validation failed: media ${session.ratingKey}, will retry if persists`);
    return false;
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
    const currentMediaKeys = new Set(currentSessions.map(s => s.ratingKey));
    const now = Date.now();

    for (const [ratingKey, timestamp] of processedMedia.entries()) {
        // Remove if not in current sessions AND cooldown has expired
        if (!currentMediaKeys.has(ratingKey)) {
            const age = now - timestamp;
            if (age > COOLDOWN_MS) {
                logger.debug(`Cleanup: ${ratingKey} (age: ${Math.round(age / 1000)}s)`);
                processedMedia.delete(ratingKey);
            }
        }
    }
}

function markAsProcessed(ratingKey) {
    processedMedia.set(ratingKey, Date.now());
    logger.debug(`Marked as processed: ${ratingKey}`);
}

function isProcessed(ratingKey) {
    if (!processedMedia.has(ratingKey)) {
        return false;
    }

    const processedTime = processedMedia.get(ratingKey);
    const age = Date.now() - processedTime;

    // Allow re-processing after cooldown period
    if (age > COOLDOWN_MS) {
        logger.debug(`Cooldown expired for ${ratingKey} (age: ${Math.round(age / 1000)}s)`);
        processedMedia.delete(ratingKey);
        return false;
    }

    return true;
}

module.exports = {
    processTranscodingSession,
    waitForSessionRestart,
    cleanupProcessedMedia,
    markAsProcessed,
    isProcessed
};
