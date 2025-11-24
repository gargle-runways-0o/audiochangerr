const logger = require('./logger');
const { loadConfig } = require('./config');
const plexClient = require('./plexClient');
const audioFixer = require('./audioFixer');
const webhookServer = require('./webhookServer');
const webhookProcessor = require('./webhookProcessor');
const plexAuth = require('./plexAuth');
const authStorage = require('./authStorage');
const packageJson = require('./package.json');

let config = null;

function findTranscodes(sessions) {
    return sessions.filter(session => session.TranscodeSession);
}

function startPollingMode() {
    logger.info(`Polling: ${config.check_interval}s`);

    setInterval(async () => {
        try {
            const sessions = await plexClient.fetchSessions();
            logger.debug(`Sessions: ${sessions.length}`);

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
        logger.error('Webhook disabled - set webhook.enabled=true or use mode=polling');
        throw new Error('webhook.enabled must be true for webhook mode');
    }

    logger.info(`Endpoint: http://${config.webhook.host}:${config.webhook.port}${config.webhook.path}`);

    const handleWebhook = async (payload) => {
        await webhookProcessor.processWebhook(payload, config);
    };

    webhookServer.start(config, handleWebhook);

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

async function ensureAuthenticated(config) {
    switch (config.auth_method) {
        case 'env':
            if (!process.env.PLEX_TOKEN) {
                throw new Error('auth_method is "env" but PLEX_TOKEN not set');
            }
            logger.info('Auth: env');
            // Generate clientId for env auth
            const envClientId = authStorage.exists() ? authStorage.load().clientId : plexAuth.generateClientId();
            if (!authStorage.exists()) {
                authStorage.save({ clientId: envClientId, token: process.env.PLEX_TOKEN, createdAt: Date.now() });
            }
            return { token: process.env.PLEX_TOKEN, clientId: envClientId };

        case 'token':
            if (!config.plex_token) {
                throw new Error('auth_method is "token" but plex_token not in config');
            }
            logger.info('Auth: token');
            // Generate clientId for token auth
            const tokenClientId = authStorage.exists() ? authStorage.load().clientId : plexAuth.generateClientId();
            if (!authStorage.exists()) {
                authStorage.save({ clientId: tokenClientId, token: config.plex_token, createdAt: Date.now() });
            }
            return { token: config.plex_token, clientId: tokenClientId };

        case 'pin':
            return await authenticateWithPin();

        default:
            throw new Error(`auth_method must be: env, token, or pin (got: ${config.auth_method})`);
    }
}

async function authenticateWithPin() {
    // Check if we have existing auth
    if (authStorage.exists()) {
        const { token, clientId } = authStorage.load();
        const valid = await plexAuth.validateToken(token, clientId);
        if (valid) {
            logger.info('Auth: PIN (cached)');
            return { token, clientId };
        }
        logger.warn('Auth: token invalid - re-authenticating');
    }

    // Interactive PIN flow
    const clientId = authStorage.exists()
        ? authStorage.load().clientId
        : plexAuth.generateClientId();

    const { code, pinId } = await plexAuth.requestPin({ clientId });

    console.log('\n🔐 Plex Authentication Required');
    console.log(`Visit: https://plex.tv/link`);
    console.log(`Code: ${code}\n`);

    const token = await plexAuth.pollForToken(pinId, { clientId });

    authStorage.save({ clientId, token, createdAt: Date.now() });

    logger.info('Auth: complete');
    return { token, clientId };
}

async function main() {
    try {
        config = loadConfig();
        logger.configureConsoleLogging(config.console);

        if (config.logging) {
            logger.configureFileLogging(config.logging);
        }

        logger.info(`Audiochangerr v${packageJson.version}`);
        logger.info(`Mode: ${config.mode}`);
        logger.info(`Dry run: ${config.dry_run ? 'yes' : 'no'}`);

        const auth = await ensureAuthenticated(config);
        plexClient.init(config, auth);
        audioFixer.setValidationTimeout(config.validation_timeout_seconds);

        if (config.mode === 'webhook') {
            startWebhookMode();
        } else if (config.mode === 'polling') {
            startPollingMode();
        } else {
            throw new Error(`Invalid mode: ${config.mode} (must be 'webhook' or 'polling')`);
        }

    } catch (error) {
        logger.error(`Start: ${error.message}`);
        logger.debug(error.stack);
        process.exit(1);
    }
}

let isShuttingDown = false;

function gracefulShutdown(signal) {
    if (isShuttingDown) {
        logger.warn('Shutdown already in progress');
        return;
    }

    isShuttingDown = true;
    logger.info(`${signal} received - shutting down gracefully (${config.graceful_shutdown_seconds}s)`);

    webhookServer.stop();

    const shutdownTimeout = setTimeout(() => {
        logger.warn('Shutdown timeout - forcing exit');
        process.exit(1);
    }, config.graceful_shutdown_seconds * 1000);

    // Allow the timeout to be cleared if we exit cleanly
    shutdownTimeout.unref();

    // Give a moment for any final log writes
    setTimeout(() => {
        logger.info('Shutdown complete');
        process.exit(0);
    }, 100);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

main();
