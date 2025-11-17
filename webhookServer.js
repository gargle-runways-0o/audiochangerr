const express = require('express');
const multer = require('multer');
const logger = require('./logger');

let server = null;
let httpServer = null;

function validateWebhookSecret(req, config) {
    if (!config.webhook.secret) {
        return true;  // No secret configured, skip validation
    }

    const providedSecret = req.headers['x-webhook-secret'];
    if (!providedSecret || providedSecret !== config.webhook.secret) {
        logger.warn(`Invalid webhook secret from ${req.ip}`);
        return false;
    }

    return true;
}

/**
 * Maps Tautulli event names to internal event names
 */
function mapTautulliEvent(eventName) {
    const mapping = {
        'play': 'media.play',
        'playback.start': 'media.play',
        'resume': 'media.resume',
        'playback.resume': 'media.resume'
    };

    return mapping[eventName] || eventName;
}

/**
 * Normalizes Tautulli webhook payload to Plex webhook format
 * Tautulli sends different payload structure, we need to convert it
 */
function normalizeTautulliPayload(body) {
    // Tautulli typically sends fields like:
    // - event_type, action
    // - rating_key
    // - user, username
    // - player, machine_id
    // - title, media_type

    const event = body.event_type || body.action;
    const ratingKey = body.rating_key || body.ratingKey;
    const username = body.user || body.username;
    const playerUuid = body.player || body.machine_id || body.player_uuid;
    const mediaType = body.media_type || body.type;
    const title = body.title;

    logger.debug(`[TAUTULLI] Normalizing: event=${event}, ratingKey=${ratingKey}, user=${username}, player=${playerUuid}`);

    return {
        event: mapTautulliEvent(event),
        Account: {
            title: username || 'unknown'
        },
        Player: {
            uuid: playerUuid || 'unknown'
        },
        Metadata: {
            ratingKey: ratingKey,
            type: mediaType,
            title: title
        },
        _source: 'tautulli'
    };
}

/**
 * Detects if the payload is from Tautulli or Plex
 */
function isTautulliPayload(body) {
    // Tautulli indicators: event_type, action, rating_key, machine_id
    return !!(body.event_type || body.action || body.rating_key);
}

function start(config, onWebhook) {
    if (httpServer) {
        logger.warn('Server already running');
        return;
    }

    const app = express();
    const upload = multer({ storage: multer.memoryStorage() });

    // Add JSON body parser for Tautulli webhooks
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // Log all incoming requests for debugging
    app.use((req, res, next) => {
        logger.debug(`[HTTP] ${req.method} ${req.path} from ${req.ip}`);
        next();
    });

    app.get('/health', (req, res) => {
        res.json({ status: 'ok', service: 'audiochangerr-webhook' });
    });

    app.post(config.webhook.path, upload.single('thumb'), (req, res) => {
        try {
            logger.debug(`[WEBHOOK REQUEST] Method: ${req.method}, Path: ${req.path}, IP: ${req.ip}`);
            logger.debug(`[WEBHOOK REQUEST] Headers: ${JSON.stringify(req.headers, null, 2)}`);
            logger.debug(`[WEBHOOK REQUEST] Body keys: ${Object.keys(req.body).join(', ')}`);

            // Validate webhook secret if configured
            if (!validateWebhookSecret(req, config)) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            let payload;

            // Check if this is a Tautulli webhook
            if (isTautulliPayload(req.body)) {
                logger.debug('[WEBHOOK] Detected Tautulli payload format');
                logger.debug(`[WEBHOOK] Raw Tautulli body: ${JSON.stringify(req.body, null, 2)}`);

                payload = normalizeTautulliPayload(req.body);
                logger.info(`Webhook (Tautulli): event=${payload.event}, user=${payload.Account?.title}, ratingKey=${payload.Metadata?.ratingKey}`);
            }
            // Otherwise, try Plex format (multipart with payload field)
            else {
                logger.debug('[WEBHOOK] Detected Plex payload format');
                const payloadJson = req.body.payload;

                if (!payloadJson) {
                    logger.error('Missing payload field (not Plex or Tautulli format)');
                    logger.error(`[WEBHOOK REQUEST] Full body: ${JSON.stringify(req.body, null, 2)}`);
                    return res.status(400).json({ error: 'Missing payload field or unrecognized format' });
                }

                try {
                    payload = JSON.parse(payloadJson);
                    payload._source = 'plex';
                } catch (error) {
                    logger.error(`Parse failed: ${error.message}`);
                    logger.error(`[WEBHOOK REQUEST] Raw payload: ${payloadJson.substring(0, 500)}`);
                    return res.status(400).json({ error: 'Invalid JSON payload' });
                }

                logger.info(`Webhook (Plex): event=${payload.event}, user=${payload.Account?.title}`);
            }

            logger.debug(`Payload: ${JSON.stringify(payload, null, 2)}`);

            if (req.file) {
                logger.debug(`Thumbnail (${req.file.size}b) - discarding`);
            }

            res.status(200).json({ status: 'received', source: payload._source });

            if (onWebhook) {
                onWebhook(payload).catch(error => {
                    logger.error(`Processing error: ${error.message}`);
                });
            }

        } catch (error) {
            logger.error(`Handler error: ${error.message}`);
            logger.error(`Stack: ${error.stack}`);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    const port = config.webhook.port;
    const host = config.webhook.host;

    httpServer = app.listen(port, host, () => {
        logger.info(`Listening: ${host}:${port}${config.webhook.path}`);
        logger.info(`Health: http://${host}:${port}/health`);
        logger.info('Supported webhook sources: Plex, Tautulli');
        if (config.webhook.secret) {
            logger.info('Webhook authentication: ENABLED');
        } else {
            logger.warn('Webhook authentication: DISABLED (consider setting webhook.secret)');
        }
    });

    httpServer.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
            logger.error(`Port ${port} in use`);
        } else {
            logger.error(`Server error: ${error.message}`);
        }
        throw error;
    });

    server = app;
}

function stop() {
    if (httpServer) {
        logger.info('Stopping server');
        httpServer.close(() => {
            logger.info('Stopped');
        });
        httpServer = null;
        server = null;
    }
}

module.exports = { start, stop };
