/**
 * Auth Storage
 * Manages persistence of Plex authentication data
 */

const fs = require('fs');
const path = require('path');

// Docker path (volume mount) vs local path
const dockerAuthPath = '/config/.auth.json';
const localAuthPath = path.join(__dirname, '.auth.json');

/**
 * Get auth file path (Docker first, fallback to local)
 * @returns {string} Path to .auth.json
 */
function getPath() {
    // Check if Docker path exists (parent directory must exist)
    if (fs.existsSync('/config')) {
        return dockerAuthPath;
    }
    return localAuthPath;
}

/**
 * Check if auth file exists
 * @returns {boolean} True if .auth.json exists
 */
function exists() {
    return fs.existsSync(getPath());
}

/**
 * Load auth data from .auth.json
 * @returns {Object} Auth data {clientId, token, createdAt}
 * @throws {Error} If file doesn't exist or is corrupted
 */
function load() {
    const authPath = getPath();

    if (!fs.existsSync(authPath)) {
        throw new Error(`Auth file not found: ${authPath}`);
    }

    let data;
    try {
        const fileContents = fs.readFileSync(authPath, 'utf8');
        data = JSON.parse(fileContents);
    } catch (error) {
        throw new Error(`Auth file corrupted: ${authPath}. Delete it and restart to re-authenticate.`);
    }

    if (!data.clientId || !data.token) {
        throw new Error(`Auth file invalid: ${authPath}. Delete it and restart to re-authenticate.`);
    }

    return data;
}

/**
 * Save auth data to .auth.json
 * @param {Object} data - Auth data
 * @param {string} data.clientId - X-Plex-Client-Identifier
 * @param {string} data.token - Plex auth token
 * @param {number} data.createdAt - Unix timestamp
 */
function save(data) {
    if (!data.clientId || !data.token || !data.createdAt) {
        throw new Error('save() requires clientId, token, and createdAt');
    }

    const authPath = getPath();
    const json = JSON.stringify(data, null, 2);

    try {
        fs.writeFileSync(authPath, json, { mode: 0o600 });
    } catch (error) {
        throw new Error(`Failed to save auth: ${error.message}`);
    }
}

/**
 * Delete auth file
 */
function clear() {
    const authPath = getPath();
    if (fs.existsSync(authPath)) {
        fs.unlinkSync(authPath);
    }
}

module.exports = {
    getPath,
    exists,
    load,
    save,
    clear
};
