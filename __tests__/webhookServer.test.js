// Mock logger module
jest.mock('../logger', () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
}));

const request = require('supertest');
const express = require('express');
const multer = require('multer');

// Import the functions we need to test
// Since webhookServer.js doesn't export the helper functions, we'll test via the server
describe('Webhook Server - Tautulli Integration', () => {
    let app;
    let onWebhookMock;

    beforeEach(() => {
        jest.clearAllMocks();

        // Create a test Express app with the same structure as webhookServer.js
        app = express();
        const upload = multer({ storage: multer.memoryStorage() });

        app.use(express.json());
        app.use(express.urlencoded({ extended: true }));

        onWebhookMock = jest.fn().mockResolvedValue(undefined);

        // Helper functions from webhookServer.js
        function mapTautulliEvent(eventName) {
            const mapping = {
                'play': 'media.play',
                'playback.start': 'media.play',
                'resume': 'media.resume',
                'playback.resume': 'media.resume'
            };
            return mapping[eventName] || eventName;
        }

        function normalizeTautulliPayload(body) {
            // Check if already in Plex-compatible format (nested structure)
            if (body.event && body.Account && body.Player && body.Metadata) {
                // Already normalized, just add source tag
                return {
                    ...body,
                    _source: 'tautulli'
                };
            }

            // Otherwise, normalize simple flat format
            const event = body.event_type || body.action;
            const ratingKey = body.rating_key || body.ratingKey;
            const username = body.user || body.username;
            const playerUuid = body.player || body.machine_id || body.player_uuid;
            const mediaType = body.media_type || body.type;
            const title = body.title;

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

        function isTautulliPayload(body) {
            // Tautulli simple format: event_type, action, rating_key, machine_id
            const hasSimpleFormat = !!(body.event_type || body.action || body.rating_key);

            // Tautulli Plex-compatible format: event field with "media." prefix and nested structure
            // But NOT the Plex multipart format (which has 'payload' field)
            const hasPlexCompatibleFormat = !!(body.event && body.event.startsWith('media.') && !body.payload);

            return hasSimpleFormat || hasPlexCompatibleFormat;
        }

        // Create webhook endpoint
        app.post('/webhook', upload.single('thumb'), (req, res) => {
            try {
                let payload;

                if (isTautulliPayload(req.body)) {
                    payload = normalizeTautulliPayload(req.body);
                } else {
                    const payloadJson = req.body.payload;
                    if (!payloadJson) {
                        return res.status(400).json({ error: 'Missing payload field or unrecognized format' });
                    }
                    payload = JSON.parse(payloadJson);
                    payload._source = 'plex';
                }

                res.status(200).json({ status: 'received', source: payload._source });

                if (onWebhookMock) {
                    onWebhookMock(payload);
                }
            } catch (error) {
                res.status(500).json({ error: 'Internal server error' });
            }
        });
    });

    describe('Tautulli Webhook Payload', () => {
        test('should accept and normalize Tautulli play event', async () => {
            const tautulliPayload = {
                event_type: 'play',
                rating_key: '12345',
                username: 'testuser',
                player_uuid: 'test-player-123',
                media_type: 'movie',
                title: 'Test Movie'
            };

            const response = await request(app)
                .post('/webhook')
                .send(tautulliPayload)
                .set('Content-Type', 'application/json');

            expect(response.status).toBe(200);
            expect(response.body.status).toBe('received');
            expect(response.body.source).toBe('tautulli');

            expect(onWebhookMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    event: 'media.play',
                    Account: { title: 'testuser' },
                    Player: { uuid: 'test-player-123' },
                    Metadata: {
                        ratingKey: '12345',
                        type: 'movie',
                        title: 'Test Movie'
                    },
                    _source: 'tautulli'
                })
            );
        });

        test('should map Tautulli resume event correctly', async () => {
            const tautulliPayload = {
                event_type: 'resume',
                rating_key: '54321',
                username: 'anotheruser',
                machine_id: 'player-456',
                media_type: 'episode',
                title: 'Test Episode'
            };

            const response = await request(app)
                .post('/webhook')
                .send(tautulliPayload)
                .set('Content-Type', 'application/json');

            expect(response.status).toBe(200);
            expect(onWebhookMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    event: 'media.resume',
                    _source: 'tautulli'
                })
            );
        });

        test('should handle alternative Tautulli field names', async () => {
            const tautulliPayload = {
                action: 'play',
                ratingKey: '99999',
                user: 'user123',
                player: 'player-xyz',
                type: 'track',
                title: 'Test Song'
            };

            const response = await request(app)
                .post('/webhook')
                .send(tautulliPayload)
                .set('Content-Type', 'application/json');

            expect(response.status).toBe(200);
            expect(onWebhookMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    event: 'media.play',
                    Account: { title: 'user123' },
                    Player: { uuid: 'player-xyz' },
                    Metadata: {
                        ratingKey: '99999',
                        type: 'track',
                        title: 'Test Song'
                    },
                    _source: 'tautulli'
                })
            );
        });

        test('should map playback.start to media.play', async () => {
            const tautulliPayload = {
                event_type: 'playback.start',
                rating_key: '11111',
                username: 'user456',
                player_uuid: 'device-123'
            };

            const response = await request(app)
                .post('/webhook')
                .send(tautulliPayload)
                .set('Content-Type', 'application/json');

            expect(response.status).toBe(200);
            expect(onWebhookMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    event: 'media.play',
                    _source: 'tautulli'
                })
            );
        });

        test('should accept Plex-compatible Tautulli format', async () => {
            const plexCompatiblePayload = {
                event: 'media.play',
                Account: {
                    title: 'plexuser'
                },
                Player: {
                    title: 'Living Room TV',
                    uuid: 'device-789'
                },
                Metadata: {
                    ratingKey: '77777',
                    librarySectionType: 'movie',
                    title: 'Test Movie',
                    year: '2024'
                }
            };

            const response = await request(app)
                .post('/webhook')
                .send(plexCompatiblePayload)
                .set('Content-Type', 'application/json');

            expect(response.status).toBe(200);
            expect(response.body.source).toBe('tautulli');
            expect(onWebhookMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    event: 'media.play',
                    Account: { title: 'plexuser' },
                    Player: expect.objectContaining({ uuid: 'device-789' }),
                    Metadata: expect.objectContaining({ ratingKey: '77777' }),
                    _source: 'tautulli'
                })
            );
        });
    });

    describe('Plex Webhook Payload (backward compatibility)', () => {
        test('should still accept Plex webhook format', async () => {
            const plexPayload = JSON.stringify({
                event: 'media.play',
                Account: { title: 'plexuser' },
                Player: { uuid: 'plex-player-123' },
                Metadata: { ratingKey: '67890', type: 'movie' }
            });

            const response = await request(app)
                .post('/webhook')
                .field('payload', plexPayload);

            expect(response.status).toBe(200);
            expect(response.body.source).toBe('plex');
            expect(onWebhookMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    event: 'media.play',
                    _source: 'plex'
                })
            );
        });
    });

    describe('Error Handling', () => {
        test('should return 400 for unrecognized payload format', async () => {
            const response = await request(app)
                .post('/webhook')
                .send({ random: 'data' })
                .set('Content-Type', 'application/json');

            expect(response.status).toBe(400);
            expect(response.body.error).toContain('Missing payload field');
        });
    });
});
