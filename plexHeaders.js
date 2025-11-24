/**
 * Plex API Headers
 * Creates consistent headers for Plex API requests
 */

const packageJson = require('./package.json');

/**
 * Create Plex API headers
 * @param {Object} options - Header options
 * @param {string} options.token - Plex auth token
 * @param {string} options.clientId - X-Plex-Client-Identifier UUID
 * @param {string} [options.accept='application/json'] - Accept header
 * @returns {Object} Headers object
 */
function create({ token, clientId, accept = 'application/json' }) {
    if (!token) {
        throw new Error('token required for Plex API headers');
    }
    if (!clientId) {
        throw new Error('clientId required for Plex API headers');
    }

    return {
        'X-Plex-Token': token,
        'X-Plex-Client-Identifier': clientId,
        'X-Plex-Product': 'audiochangerr',
        'X-Plex-Version': packageJson.version,
        'Accept': accept
    };
}

module.exports = { create };
