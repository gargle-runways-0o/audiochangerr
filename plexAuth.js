/**
 * Plex Authentication
 * Handles PIN-based authentication flow with Plex.tv
 */
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const plexHeaders = require('./plexHeaders');

const PLEX_TV_BASE = 'https://plex.tv';
const PIN_TIMEOUT_MS = 4 * 60 * 1000; // 4 minutes
const POLL_INTERVAL_MS = 2000;        // 2 seconds

/**
 * Generate new client identifier
 * @returns {string} UUID v4
 */
function generateClientId() {
    return uuidv4();
}

/**
 * Request PIN from Plex.tv
 * @param {Object} options
 * @param {string} options.clientId - X-Plex-Client-Identifier
 * @returns {Promise<{code: string, pinId: string}>}
 */
async function requestPin({ clientId }) {
    const headers = plexHeaders.create({
        token: 'none',
        clientId,
        accept: 'application/json' // Changed to JSON
    });
    delete headers['X-Plex-Token'];

    process.stdout.write(`[DEBUG] Client ID: ${clientId}\n`);
    process.stdout.write(`[DEBUG] Requesting PIN from ${PLEX_TV_BASE}/pins.json\n`);

    try {
        // Note: .json extension ensures JSON response, headers reinforce it
        const response = await axios.post(`${PLEX_TV_BASE}/pins.json`, null, { headers });
        
        // JSON response is automatic in axios. 
        // Plex JSON structure is flat: { id: 123, code: 'ABC', ... }
        const { code, id } = response.data;
        const pinId = id; 

        if (!code || !pinId) {
            throw new Error('Plex.tv response missing PIN code or ID');
        }

        process.stdout.write(`[DEBUG] PIN ID: ${pinId}\n`);
        return { code, pinId };
    } catch (error) {
        if (error.response) {
            throw new Error(`Plex.tv PIN request failed: ${error.response.status} ${error.response.statusText}`);
        }
        throw new Error(`Plex.tv PIN request failed: ${error.message}`);
    }
}

/**
 * Poll for auth token after user enters PIN
 * @param {string} pinId - PIN ID from requestPin()
 * @param {Object} options
 * @param {string} options.clientId - X-Plex-Client-Identifier
 * @returns {Promise<string>} Auth token
 */
async function pollForToken(pinId, { clientId }) {
    const headers = plexHeaders.create({
        token: 'none',
        clientId,
        accept: 'application/json' // Changed to JSON
    });
    delete headers['X-Plex-Token'];

    process.stdout.write(`[DEBUG] Starting poll for PIN ID: ${pinId}\n`);
    process.stdout.write(`[DEBUG] Poll URL: ${PLEX_TV_BASE}/pins/${pinId}.json\n`);
    process.stdout.write(`[DEBUG] Poll interval: ${POLL_INTERVAL_MS}ms, timeout: ${PIN_TIMEOUT_MS}ms\n\n`);

    const startTime = Date.now();
    let attempt = 0;

    while (true) {
        attempt++;
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        process.stdout.write(`[${attempt}] ${elapsed}s... `);

        if (Date.now() - startTime > PIN_TIMEOUT_MS) {
            process.stdout.write('\n');
            throw new Error('PIN authentication timeout (4 minutes). Restart to try again.');
        }

        try {
            const response = await axios.get(`${PLEX_TV_BASE}/pins/${pinId}.json`, { headers });
            
            // Access fields directly from JSON object
            const token = response.data.auth_token;
            const tokenPreview = token ? `${token.substring(0, 8)}...` : '(empty)';

            if (token && token.length > 0) {
                process.stdout.write(`✓ TOKEN RECEIVED\n`);
                process.stdout.write(`[DEBUG] Token: ${token.substring(0, 10)}...(${token.length} chars)\n`);
                return token;
            }

            process.stdout.write(`waiting (token: ${tokenPreview})\n`);
        } catch (error) {
            if (error.response) {
                process.stdout.write(`HTTP ${error.response.status}`);
                // Extract error message safely
                if (error.response.data) {
                    const msg = typeof error.response.data === 'object' 
                        ? JSON.stringify(error.response.data) 
                        : error.response.data;
                    process.stdout.write(` (${msg.substring(0, 50)}...)`);
                }
                process.stdout.write('\n');
                
                if (error.response.status !== 404) {
                    throw new Error(`Plex.tv poll failed: ${error.response.status} ${error.response.statusText}`);
                }
            } else {
                process.stdout.write(`NETWORK ERROR: ${error.message}\n`);
                if (attempt === 1) {
                    throw new Error(`Cannot reach plex.tv: ${error.message}`);
                }
            }
        }

        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    }
}

/**
 * Validate token with Plex.tv
 * @param {string} token - Auth token to validate
 * @param {string} clientId - X-Plex-Client-Identifier
 * @returns {Promise<boolean>} True if valid
 */
async function validateToken(token, clientId) {
    const headers = plexHeaders.create({
        token,
        clientId,
        accept: 'application/json'
    });

    try {
        const response = await axios.post(`${PLEX_TV_BASE}/users/sign_in.json`, null, { headers });
        return !!(response.data && response.data.user);
    } catch (error) {
        if (error.response && error.response.status === 401) {
            return false;
        }
        throw new Error(`Token validation failed: ${error.message}`);
    }
}

module.exports = {
    generateClientId,
    requestPin,
    pollForToken,
    validateToken
};
