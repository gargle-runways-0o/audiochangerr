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

function start(config, onWebhook) {
    if (httpServer) {
        logger.warn('Server already running');
        return;
    }

    const app = express();
    const upload = multer({ storage: multer.memoryStorage() });

    app.get('/health', (req, res) => {
        res.json({ status: 'ok', service: 'audiochangerr-webhook' });
    });

    app.post(config.webhook.path, upload.single('thumb'), (req, res) => {
        try {
            // Validate webhook secret if configured
            if (!validateWebhookSecret(req, config)) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const payloadJson = req.body.payload;

            if (!payloadJson) {
                logger.error('Missing payload field');
                return res.status(400).json({ error: 'Missing payload field' });
            }

            let payload;
            try {
                payload = JSON.parse(payloadJson);
            } catch (error) {
                logger.error(`Parse failed: ${error.message}`);
                return res.status(400).json({ error: 'Invalid JSON payload' });
            }

            logger.info(`Webhook: event=${payload.event}, user=${payload.Account?.title}`);
            logger.debug(`Payload: ${JSON.stringify(payload, null, 2)}`);

            if (req.file) {
                logger.debug(`Thumbnail (${req.file.size}b) - discarding`);
            }

            res.status(200).json({ status: 'received' });

            if (onWebhook) {
                onWebhook(payload).catch(error => {
                    logger.error(`Processing error: ${error.message}`);
                });
            }

        } catch (error) {
            logger.error(`Handler error: ${error.message}`);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    const port = config.webhook.port;
    const host = config.webhook.host;

    httpServer = app.listen(port, host, () => {
        logger.info(`Listening: ${host}:${port}${config.webhook.path}`);
        logger.info(`Health: http://${host}:${port}/health`);
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
