const express = require('express');
const multer = require('multer');
const logger = require('./logger');

let server = null;
let httpServer = null;

/**
 * Starts HTTP server to receive Plex webhooks
 */
function start(config, onWebhook) {
    if (httpServer) {
        logger.warn('Webhook server already running');
        return;
    }

    const app = express();

    // Multer setup for multipart form data (Plex sends JSON + optional JPEG)
    // Store in memory temporarily, then discard thumbnail
    const upload = multer({ storage: multer.memoryStorage() });

    // Health check endpoint
    app.get('/health', (req, res) => {
        res.json({ status: 'ok', service: 'audiochangerr-webhook' });
    });

    // Webhook endpoint
    app.post(config.webhook.path, upload.single('thumb'), (req, res) => {
        try {
            // Extract JSON payload from multipart form field
            const payloadJson = req.body.payload;

            if (!payloadJson) {
                logger.error('Webhook received without payload field');
                return res.status(400).json({ error: 'Missing payload field' });
            }

            // Parse JSON
            let payload;
            try {
                payload = JSON.parse(payloadJson);
            } catch (error) {
                logger.error(`Failed to parse webhook JSON: ${error.message}`);
                return res.status(400).json({ error: 'Invalid JSON payload' });
            }

            // Log webhook receipt
            logger.info(`Webhook received: event=${payload.event}, user=${payload.Account?.title}`);
            logger.debug(`Full webhook payload: ${JSON.stringify(payload, null, 2)}`);

            // Thumbnail is discarded (per requirements)
            if (req.file) {
                logger.debug(`Thumbnail received (${req.file.size} bytes) - discarding`);
            }

            // Respond immediately to Plex (don't wait for processing)
            res.status(200).json({ status: 'received' });

            // Process webhook asynchronously
            if (onWebhook) {
                // Don't await - process in background
                onWebhook(payload).catch(error => {
                    logger.error(`Webhook processing error: ${error.message}`);
                });
            }

        } catch (error) {
            logger.error(`Webhook handler error: ${error.message}`);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // Start server
    const port = config.webhook.port;
    const host = config.webhook.host;

    httpServer = app.listen(port, host, () => {
        logger.info(`Webhook server listening on ${host}:${port}${config.webhook.path}`);
        logger.info(`Health check available at http://${host}:${port}/health`);
    });

    // Error handling
    httpServer.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
            logger.error(`Port ${port} already in use. Please choose a different port.`);
        } else {
            logger.error(`Webhook server error: ${error.message}`);
        }
        throw error;
    });

    server = app;
}

/**
 * Stops the webhook server
 */
function stop() {
    if (httpServer) {
        logger.info('Stopping webhook server...');
        httpServer.close(() => {
            logger.info('Webhook server stopped');
        });
        httpServer = null;
        server = null;
    }
}

module.exports = { start, stop };
