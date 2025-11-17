const logger = require('./logger');
const plexClient = require('./plexClient');
const audioFixer = require('./audioFixer');

const RELEVANT_EVENTS = ['media.play', 'media.resume', 'playback.started'];

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

        const sessions = await plexClient.fetchSessions();
        logger.debug(`Active sessions: ${sessions.length}`);

        const matchingSession = sessions.find(s =>
            String(s.ratingKey) === String(ratingKey) &&
            String(s.Player?.uuid) === String(playerUuid)
        );

        if (!matchingSession) {
            logger.debug(`No session for ${ratingKey} (webhook may arrive before session)`);
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
