const logger = require('./logger');
const plexClient = require('./plexClient');
const audioFixer = require('./audioFixer');

const RELEVANT_EVENTS = ['media.play', 'media.resume', 'playback.started', 'media.transcode_decision'];

async function findSessionWithRetry(ratingKey, playerUuid, config) {
    const initialDelay = config.webhook?.initial_delay_ms || 0; // Delay before first attempt
    const maxRetries = config.webhook?.session_retry?.max_attempts || 1; // Number of attempts
    const retryDelayMs = config.webhook?.session_retry?.initial_delay_ms || 0; // Base delay for exponential backoff

    if (initialDelay > 0) {
        await new Promise(resolve => setTimeout(resolve, initialDelay));
    }

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        const sessions = await plexClient.fetchSessions();


        const matchingSession = sessions.find(s => {
            const ratingKeyMatch = String(s.ratingKey) === String(ratingKey);
            // Plex sessions use Player.machineIdentifier, webhooks may use uuid
            const playerMatch = String(s.Player?.uuid || s.Player?.machineIdentifier) === String(playerUuid);
            return ratingKeyMatch && playerMatch;
        });

        if (matchingSession) {
            if (attempt > 0) {
                logger.info(`Session found: ${ratingKey} (${attempt + 1} attempts)`);
            }
            return matchingSession;
        }

        if (attempt === 0 && sessions.length > 0) {
            logger.debug(`No match: want ratingKey=${ratingKey} player=${playerUuid}`);
            logger.debug(`Sessions: ${sessions.map((s, i) => `[${i}] ${s.ratingKey}:${s.sessionKey}`).join(', ')}`);
        }

        if (attempt < maxRetries - 1) {
            const delayMs = retryDelayMs * Math.pow(2, attempt);
            logger.debug(`Retry ${attempt + 1}/${maxRetries} in ${delayMs}ms`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }

    if (maxRetries > 1) {
        logger.warn(`No session: ${ratingKey} (${maxRetries} attempts) - webhook too early, increase initial_delay_ms/max_attempts`);
    } else {
        logger.debug(`No session: ${ratingKey}`);
    }
    return null;
}

async function processWebhook(payload, config) {
    try {
        const event = payload.event;

        if (!RELEVANT_EVENTS.includes(event)) {
            return;
        }

        const ratingKey = payload.Metadata?.ratingKey;
        const playerUuid = payload.Player?.uuid;
        const userTitle = payload.Account?.title;

        if (!ratingKey || !playerUuid) {
            logger.warn(`Malformed webhook: missing ratingKey=${ratingKey} playerUuid=${playerUuid} - check Plex webhook config`);
            return;
        }

        logger.debug(`Search: media=${ratingKey} player=${playerUuid} user=${userTitle}`);

        // Handle transcode decision webhooks
        if (event === 'media.transcode_decision') {
            logger.debug(`Transcode decision webhook received`);
            const processingInfo = audioFixer.getProcessingInfo(ratingKey, playerUuid);

            if (processingInfo && !processingInfo.terminated) {
                logger.debug(`Found processing info for non-terminated session`);
                const validationResult = audioFixer.validateTranscodeDecision(payload, processingInfo);

                if (validationResult === true) {
                    audioFixer.clearProcessingInfo(ratingKey, playerUuid);
                    logger.info(`Validated: ${ratingKey}`);
                    return;
                } else if (validationResult === false) {
                    audioFixer.clearProcessingInfo(ratingKey, playerUuid);
                    logger.warn(`Validation failed: ${ratingKey}`);
                    return;
                } else {
                    logger.debug(`Validation returned null, keeping tracking`);
                    return;
                }
            } else if (processingInfo && processingInfo.terminated) {
                logger.debug(`Ignoring transcode decision - session was terminated`);
                return;
            } else {
                logger.debug(`No processing info found for transcode decision`);
                return;
            }
        }

        const processingInfo = audioFixer.getProcessingInfo(ratingKey, playerUuid);
        if (processingInfo) {
            const matchingSession = await findSessionWithRetry(ratingKey, playerUuid, config);
            if (matchingSession) {
                const validationResult = audioFixer.validateSessionRestart(matchingSession, processingInfo);

                if (validationResult === true) {
                    audioFixer.clearProcessingInfo(ratingKey, playerUuid);
                    logger.info(`Validated: ${ratingKey}`);
                    return;
                } else if (validationResult === false) {
                    audioFixer.clearProcessingInfo(ratingKey, playerUuid);
                    logger.warn(`Validation failed: ${ratingKey} - still transcoding or wrong stream selected`);
                    return;
                }
                logger.debug(`Same session, waiting`);
                return;
            } else {
                logger.debug(`Validation pending`);
                return;
            }
        }

        if (audioFixer.isProcessed(ratingKey)) {
            logger.debug(`Processed: ${ratingKey}`);
            return;
        }

        const matchingSession = await findSessionWithRetry(ratingKey, playerUuid, config);

        if (!matchingSession) {
            return;
        }

        if (!matchingSession.TranscodeSession) {
            return;
        }

        logger.info(`Transcode: ${ratingKey}`);
        const success = await audioFixer.processTranscodingSession(matchingSession, config);

        if (success) {
            logger.info(`Switched: ${ratingKey}`);
        } else {
            logger.warn(`Switch failed: ${ratingKey}`);
        }

    } catch (error) {
        logger.error(`Webhook: ${error.message}`);
        logger.debug(error.stack);
    }
}

module.exports = {
    processWebhook
};
