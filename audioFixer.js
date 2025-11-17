const logger = require('./logger');
const plexClient = require('./plexClient');
const audioSelector = require('./audioSelector');

// Track processed media globally (shared between polling and webhook modes)
const processedMedia = new Set();

/**
 * Waits for session to restart with new audio stream and validates the change
 * @param {Object} originalSession - The terminated session
 * @param {string} expectedStreamId - The audio stream ID we expect to be playing
 * @param {number} maxWaitSeconds - Maximum time to wait for restart
 * @returns {Promise<boolean>} True if validated successfully, false otherwise
 */
async function waitForSessionRestart(originalSession, expectedStreamId, maxWaitSeconds = 120) {
    const maxAttempts = maxWaitSeconds / 2;
    logger.info(`Waiting for session restart: media ${originalSession.ratingKey} for up to ${maxWaitSeconds} seconds.`);

    for (let i = 0; i < maxAttempts; i++) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        logger.debug(`Attempt ${i + 1}/${maxAttempts} to find new session for media ${originalSession.ratingKey}`);

        const sessions = await plexClient.fetchSessions();

        const newSession = sessions.find(s =>
            String(s.ratingKey) === String(originalSession.ratingKey) &&
            String(s.Player.machineIdentifier) === String(originalSession.Player.machineIdentifier) &&
            String(s.sessionKey) !== String(originalSession.sessionKey)
        );

        if (newSession) {
            logger.info(`New session detected for media ${originalSession.ratingKey}`);
            logger.debug(`Full newSession object: ${JSON.stringify(newSession, null, 2)}`);

            if (newSession.TranscodeSession) {
                logger.error(`Validation failed: New session is still transcoding. TranscodeSession details: ${JSON.stringify(newSession.TranscodeSession, null, 2)}`);
                return false;
            } else {
                logger.debug(`New session is NOT transcoding.`);
                const activeStream = newSession.Media[0].Part[0].Stream.find(s => s.streamType === 2 && s.selected);
                logger.debug(`Active stream in new session: ${JSON.stringify(activeStream)}`);

                if (activeStream && String(activeStream.id) === String(expectedStreamId)) {
                    logger.info(`Validation success: Direct play with expected stream ${expectedStreamId}`);
                    return true;
                } else {
                    logger.error(`Validation failed: Wrong stream. Active stream ID: ${activeStream?.id}, Expected stream ID: ${expectedStreamId}`);
                    logger.debug(`All streams in new session: ${JSON.stringify(newSession.Media[0].Part[0].Stream, null, 2)}`);
                    return false;
                }
            }
        } else {
            logger.debug(`New session not yet found for media ${originalSession.ratingKey}.`);
        }
    }

    logger.warn(`Timeout waiting for restart. Media ${originalSession.ratingKey}. No new session found or validated within ${maxWaitSeconds} seconds.`);
    return false;
}

/**
 * Processes a single transcoding session by selecting a better audio stream,
 * changing the default, and terminating the transcode
 * @param {Object} session - The Plex session object
 * @param {Object} config - Application configuration
 * @returns {Promise<boolean>} True if successful, false otherwise
 */
async function processTranscodingSession(session, config) {
    try {
        logger.info(`Transcode detected: ${session.Player.title} on ${session.Player.device} for user ${session.User.title}`);

        // Fetch full metadata for the media item
        const mediaInfo = await plexClient.fetchMetadata(session.ratingKey);
        if (!mediaInfo) {
            logger.error(`Failed to fetch metadata for media ${session.ratingKey}`);
            return false;
        }

        // Find current audio stream
        const currentStream = session.Media[0].Part[0].Stream.find(s => s.streamType === 2 && s.selected);
        if (!currentStream) {
            logger.warn(`No current audio stream found for ${session.Player.title}`);
            return false;
        }

        // Select best alternative audio stream
        const bestStream = audioSelector.selectBestAudioStream(
            mediaInfo,
            currentStream.id,
            config.audio_selector
        );

        if (!bestStream) {
            logger.warn(`No better audio stream found for ${session.Player.title}`);
            return false;
        }

        logger.info(`Better stream found: ${bestStream.codec.toUpperCase()} ${bestStream.channels}ch (ID: ${bestStream.id})`);

        // Defensive check for session.Media[0].Part[0]
        if (!session.Media || !session.Media[0] || !session.Media[0].Part || !session.Media[0].Part[0]) {
            logger.error(`Missing media part information for session ${session.sessionKey}`);
            return false;
        }

        const partId = session.Media[0].Part[0].id;
        let userTokenToUse = undefined;
        const sessionUsername = session.User.title;

        // Fetch managed user tokens dynamically for this session
        const managedUserTokens = await plexClient.fetchManagedUserTokens();
        logger.debug(`Session User object: ${JSON.stringify(session.User, null, 2)}`);

        // Determine which token to use for API calls
        if (sessionUsername === config.owner_username) {
            userTokenToUse = config.plex_token;
            logger.debug(`Session for owner (${sessionUsername}). Using owner's token.`);
        } else if (managedUserTokens[session.User.id]) {
            userTokenToUse = managedUserTokens[session.User.id];
            logger.debug(`Using dynamically fetched managed user token for user ID ${session.User.id}`);
        } else {
            logger.warn(`User '${sessionUsername}' (ID: ${session.User.id}) is not the configured owner and not a managed user. Skipping.`);
            return false;
        }

        // Apply the fix
        try {
            // 1. Set selected audio stream
            await plexClient.setSelectedAudioStream(partId, bestStream.id, userTokenToUse, config.dry_run);

            // 2. Terminate transcode & session
            if (config.dry_run) {
                logger.info(`[DRY RUN] Would terminate transcode: ${session.TranscodeSession.key}`);
                logger.info(`[DRY RUN] Would terminate session: ${session.Session.id}`);
                return true; // Success in dry run mode
            } else {
                await plexClient.terminateTranscode(session.TranscodeSession.key);
                logger.info(`Terminated transcode: ${session.TranscodeSession.key}`);

                const reason = 'Audio transcode detected. Switched to compatible audio track. Please restart playback.';
                await plexClient.terminateSession(session.Session.id, reason);
                logger.info(`Terminated session: ${session.Session.id}`);

                // 3. Wait for restart & validate
                const validated = await waitForSessionRestart(session, bestStream.id);
                if (validated) {
                    logger.info(`Successfully fixed and validated media ${session.ratingKey}`);
                    return true;
                } else {
                    logger.error(`Validation failed for media ${session.ratingKey}. Will retry if transcode persists.`);
                    return false;
                }
            }
        } catch (error) {
            logger.error(`Failed to fix transcode: ${error.message}`);
            return false;
        }

    } catch (error) {
        logger.error(`Error processing transcoding session: ${error.message}`);
        logger.debug(error.stack);
        return false;
    }
}

/**
 * Cleans up the processed media set by removing entries for sessions that are no longer active
 * @param {Array} currentSessions - Array of current active sessions
 */
function cleanupProcessedMedia(currentSessions) {
    const currentMediaKeys = new Set(currentSessions.map(s => s.ratingKey));
    for (const processedKey of processedMedia) {
        if (!currentMediaKeys.has(processedKey)) {
            logger.debug(`Cleaning up stale media key: ${processedKey}`);
            processedMedia.delete(processedKey);
        }
    }
}

/**
 * Marks media as processed to avoid duplicate processing
 * @param {string} ratingKey - The media's ratingKey
 */
function markAsProcessed(ratingKey) {
    processedMedia.add(ratingKey);
}

/**
 * Checks if media has already been processed
 * @param {string} ratingKey - The media's ratingKey
 * @returns {boolean}
 */
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
