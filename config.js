const fs = require('fs');
const yaml = require('js-yaml');
const path = require('path');
const logger = require('./logger');

function loadConfig() {
    const configPath = path.join(__dirname, 'config.yaml');

    if (!fs.existsSync(configPath)) {
        throw new Error(`Config not found: ${configPath}`);
    }

    let config;
    try {
        const fileContents = fs.readFileSync(configPath, 'utf8');
        config = yaml.load(fileContents);
    } catch (error) {
        throw new Error(`Parse failed: ${error.message}`);
    }

    const required = ['plex_server_url', 'plex_token', 'owner_username'];
    for (const field of required) {
        if (!config[field] || config[field] === '') {
            throw new Error(`Missing: ${field}`);
        }
    }

    config.check_interval = config.check_interval || 10;
    config.dry_run = config.dry_run !== undefined ? config.dry_run : true;
    config.mode = config.mode || 'polling';

    config.webhook = config.webhook || {};
    config.webhook.enabled = config.webhook.enabled !== undefined ? config.webhook.enabled : true;
    config.webhook.port = config.webhook.port || 4444;
    config.webhook.host = config.webhook.host || '0.0.0.0';
    config.webhook.path = config.webhook.path || '/webhook';

    if (!config.audio_selector || !Array.isArray(config.audio_selector)) {
        throw new Error('audio_selector must be array');
    }

    logger.debug(`Loaded: mode=${config.mode}, dry_run=${config.dry_run}`);

    return config;
}

module.exports = { loadConfig };
