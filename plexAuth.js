/**
 * Plex Authentication
 * Handles PIN-based authentication flow with Plex.tv
 */
const axios = require('axios');
const { parseStringPromise } = require('xml2js');
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
        accept: 'application/xml'
    });
    delete headers['X-Plex-Token'];

    process.stdout.write(`[DEBUG] Client ID: ${clientId}\n`);
    process.stdout.write(`[DEBUG] Requesting PIN from ${PLEX_TV_BASE}/pins.xml\n`);

    try {
        const response = await axios.post(`${PLEX_TV_BASE}/pins.xml`, null, { headers });
        const parsed = await parseStringPromise(response.data);

        const code = parsed.pin?.code?.[0];
        
        // FIX: Handle xml2js parsing where ID is an object (due to attributes) or a primitive
        const rawId = parsed.pin?.id?.[0];
        const pinId = rawId?._ || rawId;

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
        accept: 'application/xml'
    });
    delete headers['X-Plex-Token'];

    process.stdout.write(`[DEBUG] Starting poll for PIN ID: ${pinId}\n`);
    process.stdout.write(`[DEBUG] Poll URL: ${PLEX_TV_BASE}/pins/${pinId}.xml\n`);
    process.stdout.write(`[DEBUG] Poll interval: ${POLL_INTERVAL_MS}ms, timeout: ${PIN_TIMEOUT_MS}ms\n\n`);

    const startTime = Date.now();
    let attempt = 0;

    while (true) {
        attempt++;
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        process.stdout.write(`[${attempt}] ${elapsed}s... `);

        // Check timeout
        if (Date.now() - startTime > PIN_TIMEOUT_MS) {
            process.stdout.write('\n');
            throw new Error('PIN authentication timeout (4 minutes). Restart to try again.');
        }

        try {
            const response = await axios.get(`${PLEX_TV_BASE}/pins/${pinId}.xml`, { headers });
            const parsed = await parseStringPromise(response.data);

            // Show auth_token field even if empty (for debugging)
            const token = parsed.pin?.auth_token?.[0];
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
                if (error.response.data) {
                    // Try to safely extract string data if possible, else generic message
                    const errMsg = typeof error.response.data === 'string' 
                        ? error.response.data.substring(0, 50) 
                        : 'Error data';
                    process.stdout.write(` (${errMsg}...)`);
                }
                process.stdout.write('\n');
                
                // 404 is expected initially while the PIN is not yet linked
                if (error.response.status !== 404) {
                    throw new Error(`Plex.tv poll failed: ${error.response.status} ${error.response.statusText}`);
                }
            } else {
                process.stdout.write(`NETWORK ERROR: ${error.message}\n`);
                if (attempt === 1) {
                    throw new Error(`Cannot reach plex.tv - check container network/internet: ${error.message}`);
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
        // Network errors or other issues - fail fast
        throw new Error(`Token validation failed: ${error.message}`);
    }
}

module.exports = {
    generateClientId,
    requestPin,
    pollForToken,
    validateToken
};
