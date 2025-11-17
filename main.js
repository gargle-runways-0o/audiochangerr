const logger = require('./logger');
const { loadConfig } = require('./config');
const plexClient = require('./plexClient');
const audioFixer = require('./audioFixer');
const webhookServer = require('./webhookServer');
const webhookProcessor = require('./webhookProcessor');

let config = null;

function findTranscodes(sessions) {
    return sessions.filter(session => session.TranscodeSession);
}

function startPollingMode() {
    logger.info(`Starting POLLING (interval: ${config.check_interval}s)`);

    setInterval(async () => {
        try {
            const sessions = await plexClient.fetchSessions();
            logger.info(`Active sessions: ${sessions.length}`);

            const transcodeSessions = findTranscodes(sessions);
            const newTranscodes = transcodeSessions.filter(s => !audioFixer.isProcessed(s.ratingKey));

            if (newTranscodes.length > 0) {
                for (const session of newTranscodes) {
                    try {
                        const success = await audioFixer.processTranscodingSession(session, config);
                        if (success) {
                            audioFixer.markAsProcessed(session.ratingKey);
                        }
                    } catch (error) {
                        logger.error(`Failed to process session ${session.ratingKey}: ${error.message}`);
                        logger.debug(error.stack);
                        // Continue processing other sessions
                    }
                }
            }

            audioFixer.cleanupProcessedMedia(sessions);

        } catch (error) {
            logger.error(`Polling cycle failed: ${error.message}`);
            logger.debug(error.stack);
            // Interval continues, will retry next cycle
        }
    }, config.check_interval * 1000);
}

function startWebhookMode() {
    logger.info('Starting WEBHOOK');
    logger.info(`Endpoint: http://${config.webhook.host}:${config.webhook.port}${config.webhook.path}`);

    const handleWebhook = async (payload) => {
        await webhookProcessor.processWebhook(payload, config);
    };

    // Remove try/catch - let errors propagate to main()
    webhookServer.start(config, handleWebhook);
    logger.info('Webhook started');
    logger.info('Configure: Plex Web → Account → Webhooks');

    // Session cleanup interval
    setInterval(async () => {
        try {
            const sessions = await plexClient.fetchSessions();
            audioFixer.cleanupProcessedMedia(sessions);
        } catch (error) {
            logger.error(`Cleanup error: ${error.message}`);
            logger.debug(error.stack);
        }
    }, 60000);
}

async function main() {
    try {
        config = loadConfig();
        logger.info('Config loaded');
        logger.info(`Mode: ${config.mode}`);
        logger.info(`Dry run: ${config.dry_run ? 'ENABLED' : 'DISABLED'}`);

        plexClient.init(config);
        logger.info('Plex initialized');

        if (config.mode === 'webhook') {
            startWebhookMode();
        } else if (config.mode === 'polling') {
            startPollingMode();
        } else {
            throw new Error(`Invalid mode: ${config.mode} (must be 'webhook' or 'polling')`);
        }

        logger.info('Audiochangerr running');

    } catch (error) {
        logger.error(`Start failed: ${error.message}`);
        logger.debug(error.stack);
        process.exit(1);
    }
}

process.on('SIGINT', () => {
    logger.info('SIGINT - shutting down');
    webhookServer.stop();
    process.exit(0);
});

process.on('SIGTERM', () => {
    logger.info('SIGTERM - shutting down');
    webhookServer.stop();
    process.exit(0);
});

main();
