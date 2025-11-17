const logger = require('./logger');
const plexClient = require('./plexClient');
const audioFixer = require('./audioFixer');

/**
 * Events that trigger audio stream checking
 */
const RELEVANT_EVENTS = [
    'media.play',       // User starts playback
    'media.resume',     // User resumes playback
    'playback.started'  // Server owner event for shared user playback
];

/**
 * Processes a Plex webhook payload
 * @param {Object} payload - Parsed webhook JSON
 * @param {Object} config - Application configuration
 * @returns {Promise<void>}
 */
async function processWebhook(payload, config) {
    try {
        const event = payload.event;

        // Filter for relevant events only
        if (!RELEVANT_EVENTS.includes(event)) {
            logger.debug(`Ignoring event: ${event}`);
            return;
        }

        logger.info(`Processing webhook event: ${event}`);

        // Extract key information from webhook
        const ratingKey = payload.Metadata?.ratingKey;
        const playerUuid = payload.Player?.uuid;
        const userTitle = payload.Account?.title;

        if (!ratingKey || !playerUuid) {
            logger.warn(`Webhook missing critical data: ratingKey=${ratingKey}, playerUuid=${playerUuid}`);
            return;
        }

        logger.debug(`Looking for session: media=${ratingKey}, player=${playerUuid}, user=${userTitle}`);

        // Check if already processed this media
        if (audioFixer.isProcessed(ratingKey)) {
            logger.debug(`Media ${ratingKey} already processed, skipping`);
            return;
        }

        // Fetch current sessions from Plex to check for transcoding
        // Note: Webhook doesn't tell us if transcoding is happening - we must check
        const sessions = await plexClient.fetchSessions();
        logger.debug(`Current active sessions: ${sessions.length}`);

        // Find the session matching this webhook
        const matchingSession = sessions.find(s =>
            String(s.ratingKey) === String(ratingKey) &&
            String(s.Player?.uuid) === String(playerUuid)
        );

        if (!matchingSession) {
            logger.debug(`No active session found for media ${ratingKey} with player ${playerUuid}`);
            logger.debug(`This is normal - webhook may arrive before session is fully established`);
            return;
        }

        logger.debug(`Found matching session: sessionKey=${matchingSession.sessionKey}`);

        // Check if session is transcoding
        if (!matchingSession.TranscodeSession) {
            logger.info(`Session is direct playing - no action needed`);
            return;
        }

        // Session is transcoding - apply fix
        logger.info(`Transcode detected for media ${ratingKey} - processing...`);
        const success = await audioFixer.processTranscodingSession(matchingSession, config);

        if (success) {
            audioFixer.markAsProcessed(ratingKey);
            logger.info(`Successfully processed transcoding session for media ${ratingKey}`);
        } else {
            logger.warn(`Failed to fix transcoding for media ${ratingKey}`);
        }

    } catch (error) {
        logger.error(`Webhook processing error: ${error.message}`);
        logger.debug(error.stack);
    }
}

module.exports = {
    processWebhook
};
