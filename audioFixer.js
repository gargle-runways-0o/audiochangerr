const logger = require('./logger');
const plexClient = require('./plexClient');
const audioSelector = require('./audioSelector');
const { getStreamsFromSession, getPartId } = require('./mediaHelpers');

const processedMedia = new Set();

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

async function processTranscodingSession(session, config) {
    try {
        logger.info(`Transcode: ${session.Player.title} on ${session.Player.device}, user ${session.User.title}`);

        const mediaInfo = await plexClient.fetchMetadata(session.ratingKey);
        // No need to check for null - function throws on error

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

        const partId = getPartId(session);
        let userTokenToUse = undefined;
        const sessionUsername = session.User.title;

        const managedUserTokens = await plexClient.fetchManagedUserTokens();
        logger.debug(`User: ${JSON.stringify(session.User, null, 2)}`);

        if (sessionUsername === config.owner_username) {
            userTokenToUse = config.plex_token;
            logger.debug(`Owner (${sessionUsername}): using owner token`);
        } else if (managedUserTokens[session.User.id]) {
            userTokenToUse = managedUserTokens[session.User.id];
            logger.debug(`Managed user ${session.User.id}: using fetched token`);
        } else {
            logger.warn(`User '${sessionUsername}' (${session.User.id}): not owner or managed, skipping`);
            return false;
        }

        try {
            await plexClient.setSelectedAudioStream(partId, bestStream.id, userTokenToUse, config.dry_run);

            if (config.dry_run) {
                logger.info(`[DRY RUN] Terminate transcode: ${session.TranscodeSession.key}`);
                logger.info(`[DRY RUN] Terminate session: ${session.Session.id}`);
                return true;
            } else {
                await plexClient.terminateTranscode(session.TranscodeSession.key);
                logger.info(`Terminated transcode: ${session.TranscodeSession.key}`);

                const reason = 'Audio transcode detected. Switched to compatible track. Restart playback.';
                await plexClient.terminateSession(session.Session.id, reason);
                logger.info(`Terminated session: ${session.Session.id}`);

                const validated = await waitForSessionRestart(session, bestStream.id);
                if (validated) {
                    logger.info(`Success: media ${session.ratingKey}`);
                    return true;
                } else {
                    logger.error(`Validation failed: media ${session.ratingKey}, will retry if persists`);
                    return false;
                }
            }
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
    for (const processedKey of processedMedia) {
        if (!currentMediaKeys.has(processedKey)) {
            logger.debug(`Cleanup: ${processedKey}`);
            processedMedia.delete(processedKey);
        }
    }
}

function markAsProcessed(ratingKey) {
    processedMedia.add(ratingKey);
}

function isProcessed(ratingKey) {
    return processedMedia.has(ratingKey);
}

module.exports = {
    processTranscodingSession,
    waitForSessionRestart,
    cleanupProcessedMedia,
    markAsProcessed,
    isProcessed
};
