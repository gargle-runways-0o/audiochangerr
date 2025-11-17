const logger = require('./logger');
const plexClient = require('./plexClient');
const audioFixer = require('./audioFixer');

const RELEVANT_EVENTS = ['media.play', 'media.resume', 'playback.started'];

/**
 * Searches for a matching session with retry logic.
 * Webhooks often arrive before Plex creates the session, so we retry with backoff.
 */
async function findSessionWithRetry(ratingKey, playerUuid, maxRetries = 5, initialDelayMs = 500) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        const sessions = await plexClient.fetchSessions();

        if (attempt === 0) {
            logger.debug(`Active sessions: ${sessions.length}`);
        }

        const matchingSession = sessions.find(s => {
            const ratingKeyMatch = String(s.ratingKey) === String(ratingKey);
            // Plex sessions use Player.machineIdentifier, webhooks may use uuid
            const playerMatch = String(s.Player?.uuid || s.Player?.machineIdentifier) === String(playerUuid);
            return ratingKeyMatch && playerMatch;
        });

        if (matchingSession) {
            if (attempt > 0) {
                logger.info(`Session found after ${attempt + 1} attempts (${ratingKey})`);
            }
            return matchingSession;
        }

        // Debug: Log what sessions we actually have when no match found
        if (attempt === 0 && sessions.length > 0) {
            logger.debug(`No match found. Wanted: ratingKey=${ratingKey}, player=${playerUuid}`);
            logger.debug(`Actual sessions (${sessions.length}):`);
            sessions.forEach((s, idx) => {
                logger.debug(`  [${idx}] Full session: ${JSON.stringify({
                    ratingKey: s.ratingKey,
                    sessionKey: s.sessionKey,
                    type: s.type,
                    title: s.title,
                    grandparentTitle: s.grandparentTitle,
                    Player: s.Player,
                    User: s.User,
                    TranscodeSession: s.TranscodeSession ? 'present' : 'absent'
                }, null, 2)}`);
            });
        }

        // Not the last attempt, wait and retry
        if (attempt < maxRetries - 1) {
            const delayMs = initialDelayMs * Math.pow(2, attempt);
            logger.debug(`Session not found (attempt ${attempt + 1}/${maxRetries}), retrying in ${delayMs}ms...`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }

    logger.warn(`No session found for ${ratingKey} after ${maxRetries} attempts (webhook may have arrived too early)`);
    return null;
}

async function processWebhook(payload, config) {
    try {
        const event = payload.event;

        logger.debug(`[PROCESSOR] Received event: ${event}, Metadata type: ${payload.Metadata?.type}`);

        if (!RELEVANT_EVENTS.includes(event)) {
            logger.debug(`Ignoring: ${event} (not in ${RELEVANT_EVENTS.join(', ')})`);
            return;
        }

        logger.info(`Webhook: ${event}`);

        const ratingKey = payload.Metadata?.ratingKey;
        const playerUuid = payload.Player?.uuid;
        const userTitle = payload.Account?.title;

        if (!ratingKey || !playerUuid) {
            logger.warn(`Missing data: ratingKey=${ratingKey}, playerUuid=${playerUuid}`);
            return;
        }

        logger.debug(`Session search: media=${ratingKey}, player=${playerUuid}, user=${userTitle}`);

        if (audioFixer.isProcessed(ratingKey)) {
            logger.debug(`Already processed: ${ratingKey}`);
            return;
        }

        const matchingSession = await findSessionWithRetry(ratingKey, playerUuid);

        if (!matchingSession) {
            return;
        }

        logger.debug(`Found: ${matchingSession.sessionKey}`);

        if (!matchingSession.TranscodeSession) {
            logger.info(`Direct play - skipping`);
            return;
        }

        logger.info(`Transcode: ${ratingKey}`);
        const success = await audioFixer.processTranscodingSession(matchingSession, config);

        if (success) {
            audioFixer.markAsProcessed(ratingKey);
            logger.info(`Success: ${ratingKey}`);
        } else {
            logger.warn(`Failed: ${ratingKey}`);
        }

    } catch (error) {
        logger.error(`Webhook error: ${error.message}`);
        logger.debug(error.stack);
    }
}

module.exports = {
    processWebhook
};
