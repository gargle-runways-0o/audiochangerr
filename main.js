const logger = require('./logger');
const { loadConfig } = require('./config');
const plexClient = require('./plexClient');
const audioFixer = require('./audioFixer');
const webhookServer = require('./webhookServer');
const webhookProcessor = require('./webhookProcessor');

let config = null;

/**
 * Finds sessions that are actively transcoding
 */
function findTranscodes(sessions) {
    return sessions.filter(session => session.TranscodeSession);
}

/**
 * Polling mode: Periodically checks for transcoding sessions
 */
function startPollingMode() {
    logger.info(`Starting POLLING mode (interval: ${config.check_interval}s)`);

    setInterval(async () => {
        try {
            const sessions = await plexClient.fetchSessions();
            logger.info(`Active sessions: ${sessions.length}`);

            const transcodeSessions = findTranscodes(sessions);
            const newTranscodes = transcodeSessions.filter(s => !audioFixer.isProcessed(s.ratingKey));

            if (newTranscodes.length > 0) {
                for (const session of newTranscodes) {
                    const success = await audioFixer.processTranscodingSession(session, config);
                    if (success) {
                        audioFixer.markAsProcessed(session.ratingKey);
                    }
                }
            }

            // Cleanup stale entries
            audioFixer.cleanupProcessedMedia(sessions);

        } catch (error) {
            logger.error(`Polling loop error: ${error.message}`);
        }
    }, config.check_interval * 1000);
}

/**
 * Webhook mode: Starts HTTP server to receive Plex webhook notifications
 */
function startWebhookMode() {
    logger.info('Starting WEBHOOK mode');
    logger.info(`Webhook endpoint will be: http://${config.webhook.host}:${config.webhook.port}${config.webhook.path}`);

    // Handler for incoming webhooks
    const handleWebhook = async (payload) => {
        await webhookProcessor.processWebhook(payload, config);
    };

    // Start webhook server
    try {
        webhookServer.start(config, handleWebhook);
        logger.info('Webhook server started successfully');
        logger.info('Configure Plex webhook URL in: Plex Web App → Account → Webhooks');
    } catch (error) {
        logger.error(`Failed to start webhook server: ${error.message}`);
        logger.error('Falling back to polling mode...');
        startPollingMode();
    }

    // Optional: Periodic cleanup of processed media even in webhook mode
    // This ensures the set doesn't grow indefinitely if sessions end without cleanup
    setInterval(async () => {
        try {
            const sessions = await plexClient.fetchSessions();
            audioFixer.cleanupProcessedMedia(sessions);
        } catch (error) {
            logger.debug(`Cleanup error: ${error.message}`);
        }
    }, 60000); // Every 60 seconds
}

/**
 * Main entry point
 */
async function main() {
    try {
        // Load configuration
        config = loadConfig();
        logger.info('Configuration loaded successfully');
        logger.info(`Mode: ${config.mode}`);
        logger.info(`Dry run: ${config.dry_run ? 'ENABLED' : 'DISABLED'}`);

        // Initialize Plex client
        plexClient.init(config);
        logger.info('Plex client initialized');

        // Start appropriate mode
        if (config.mode === 'webhook') {
            startWebhookMode();
        } else if (config.mode === 'polling') {
            startPollingMode();
        } else {
            throw new Error(`Invalid mode: ${config.mode}. Must be 'webhook' or 'polling'`);
        }

        logger.info('Audiochangerr is now running');

    } catch (error) {
        logger.error(`Failed to start: ${error.message}`);
        logger.debug(error.stack);
        process.exit(1);
    }
}

// Graceful shutdown
process.on('SIGINT', () => {
    logger.info('Received SIGINT, shutting down gracefully...');
    webhookServer.stop();
    process.exit(0);
});

process.on('SIGTERM', () => {
    logger.info('Received SIGTERM, shutting down gracefully...');
    webhookServer.stop();
    process.exit(0);
});

main();
