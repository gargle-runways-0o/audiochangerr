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
    logger.info(`Polling: ${config.check_interval}s`);

    setInterval(async () => {
        try {
            const sessions = await plexClient.fetchSessions();
            logger.info(`Sessions: ${sessions.length}`);

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
                        logger.error(`Process: ${session.ratingKey} ${error.message}`);
                        logger.debug(error.stack);
                    }
                }
            }

            audioFixer.cleanupProcessedMedia(sessions);

        } catch (error) {
            logger.error(`Polling: ${error.message}`);
            logger.debug(error.stack);
        }
    }, config.check_interval * 1000);
}

function startWebhookMode() {
    if (config.webhook.enabled === false) {
        logger.error('Webhook disabled in config');
        throw new Error('webhook.enabled must be true for webhook mode');
    }

    logger.info('Webhook mode');
    logger.info(`Endpoint: http://${config.webhook.host}:${config.webhook.port}${config.webhook.path}`);

    const handleWebhook = async (payload) => {
        await webhookProcessor.processWebhook(payload, config);
    };

    webhookServer.start(config, handleWebhook);
    logger.info('Started');
    logger.info('Setup: Plex → Account → Webhooks');

    setInterval(async () => {
        try {
            const sessions = await plexClient.fetchSessions();
            audioFixer.cleanupProcessedMedia(sessions);
        } catch (error) {
            logger.error(`Cleanup: ${error.message}`);
            logger.debug(error.stack);
        }
    }, 60000);
}

async function main() {
    try {
        config = loadConfig();
        logger.info('Config: loaded');

        logger.configureConsoleLogging(config.console);

        if (config.logging) {
            logger.configureFileLogging(config.logging);
        }

        logger.info(`Mode: ${config.mode}`);
        logger.info(`Dry run: ${config.dry_run ? 'yes' : 'no'}`);

        plexClient.init(config);
        logger.info('Plex: ready');

        audioFixer.setValidationTimeout(config.validation_timeout_seconds);

        if (config.mode === 'webhook') {
            startWebhookMode();
        } else if (config.mode === 'polling') {
            startPollingMode();
        } else {
            throw new Error(`Invalid mode: ${config.mode} (must be 'webhook' or 'polling')`);
        }

        logger.info('Running');

    } catch (error) {
        logger.error(`Start: ${error.message}`);
        logger.debug(error.stack);
        process.exit(1);
    }
}

process.on('SIGINT', () => {
    logger.info('SIGINT');
    webhookServer.stop();
    process.exit(0);
});

process.on('SIGTERM', () => {
    logger.info('SIGTERM');
    webhookServer.stop();
    process.exit(0);
});

main();
