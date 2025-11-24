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
const POLL_INTERVAL_MS = 2000; // 2 seconds

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
        token: 'none', // No token needed for PIN request
        clientId,
        accept: 'application/xml'
    });
    delete headers['X-Plex-Token']; // Remove token header

    try {
        const response = await axios.post(`${PLEX_TV_BASE}/pins.xml`, null, { headers });
        const parsed = await parseStringPromise(response.data);

        const code = parsed.pin?.code?.[0];
        const pinId = parsed.pin?.id?.[0];

        if (!code || !pinId) {
            throw new Error('Plex.tv response missing PIN code or ID');
        }

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

    const startTime = Date.now();
    let attempt = 0;

    while (true) {
        attempt++;

        // Check timeout
        if (Date.now() - startTime > PIN_TIMEOUT_MS) {
            throw new Error('PIN authentication timeout (4 minutes). Restart to try again.');
        }

        try {
            const response = await axios.get(`${PLEX_TV_BASE}/pins/${pinId}.xml`, { headers });
            const parsed = await parseStringPromise(response.data);

            const token = parsed.pin?.auth_token?.[0];

            if (token && token.length > 0) {
                console.log(`Auth token received after ${attempt} attempts`);
                return token;
            }

            if (attempt % 10 === 0) {
                console.log(`Still waiting for PIN entry (${attempt} attempts, ${Math.floor((Date.now() - startTime) / 1000)}s)...`);
            }
        } catch (error) {
            if (error.response && error.response.status !== 404) {
                throw new Error(`Plex.tv PIN poll failed: ${error.response.status} ${error.response.statusText}`);
            }
            // 404 or network errors - continue polling
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
        return response.data && response.data.user;
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
