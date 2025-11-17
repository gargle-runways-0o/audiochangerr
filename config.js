const fs = require('fs');
const yaml = require('js-yaml');
const path = require('path');
const logger = require('./logger');

function validateAudioSelectorRules(rules) {
    const validCodecs = ['aac', 'ac3', 'eac3', 'dts', 'dts-hd', 'truehd', 'flac', 'mp3', 'opus', 'vorbis', 'pcm'];

    for (let i = 0; i < rules.length; i++) {
        const rule = rules[i];

        if (rule.codec && !validCodecs.includes(rule.codec)) {
            throw new Error(`Invalid codec in rule ${i}: "${rule.codec}". Valid: ${validCodecs.join(', ')}`);
        }

        if (rule.channels !== undefined) {
            if (typeof rule.channels !== 'number' || rule.channels < 1 || rule.channels > 8) {
                throw new Error(`Invalid channels in rule ${i}: ${rule.channels}. Must be 1-8`);
            }
        }

        if (rule.language && rule.language !== 'original' && !/^[a-z]{2,3}$/.test(rule.language)) {
            throw new Error(`Invalid language in rule ${i}: "${rule.language}". Use "original" or ISO code (e.g., "eng")`);
        }

        if (rule.keywords_include !== undefined && !Array.isArray(rule.keywords_include)) {
            throw new Error(`Invalid keywords_include in rule ${i}: must be array`);
        }

        if (rule.keywords_exclude !== undefined && !Array.isArray(rule.keywords_exclude)) {
            throw new Error(`Invalid keywords_exclude in rule ${i}: must be array`);
        }
    }
}

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
    config.webhook.secret = config.webhook.secret || ''; // Optional shared secret for auth

    if (!config.audio_selector || !Array.isArray(config.audio_selector)) {
        throw new Error('audio_selector must be array');
    }

    validateAudioSelectorRules(config.audio_selector);

    // Config versioning
    if (config.config_version !== undefined && config.config_version !== 1) {
        throw new Error(`Unsupported config version: ${config.config_version}. This version supports: 1`);
    }

    logger.debug(`Loaded: mode=${config.mode}, dry_run=${config.dry_run}`);

    return config;
}

module.exports = { loadConfig };
