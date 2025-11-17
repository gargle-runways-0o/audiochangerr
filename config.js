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

    const required = ['plex_server_url', 'plex_token', 'owner_username', 'validation_timeout_seconds'];
    for (const field of required) {
        if (!config[field] || config[field] === '') {
            throw new Error(`Missing: ${field}`);
        }
    }

    // Validate validation_timeout_seconds is a positive number
    if (typeof config.validation_timeout_seconds !== 'number' || config.validation_timeout_seconds <= 0) {
        throw new Error(`validation_timeout_seconds must be a positive number (got: ${config.validation_timeout_seconds})`);
    }

    // Mode must be specified
    if (!config.mode) {
        throw new Error('Missing: mode');
    }
    if (config.mode !== 'webhook' && config.mode !== 'polling') {
        throw new Error(`mode must be 'webhook' or 'polling' (got: ${config.mode})`);
    }

    // Dry run must be specified
    if (config.dry_run === undefined) {
        throw new Error('Missing: dry_run');
    }
    if (typeof config.dry_run !== 'boolean') {
        throw new Error(`dry_run must be boolean (got: ${config.dry_run})`);
    }

    // Check interval required for polling mode
    if (config.mode === 'polling') {
        if (!config.check_interval || typeof config.check_interval !== 'number' || config.check_interval <= 0) {
            throw new Error('check_interval required for polling mode and must be > 0');
        }
    }

    // Webhook config required for webhook mode
    if (config.mode === 'webhook') {
        if (!config.webhook) {
            throw new Error('webhook config required for webhook mode');
        }

        // webhook.enabled defaults to true if not specified
        if (config.webhook.enabled === undefined) {
            config.webhook.enabled = true;
        }
        if (typeof config.webhook.enabled !== 'boolean') {
            throw new Error('webhook.enabled must be boolean');
        }

        if (!config.webhook.port || typeof config.webhook.port !== 'number') {
            throw new Error('webhook.port required and must be a number');
        }
        if (!config.webhook.host || typeof config.webhook.host !== 'string') {
            throw new Error('webhook.host required and must be a string');
        }
        if (!config.webhook.path || typeof config.webhook.path !== 'string') {
            throw new Error('webhook.path required and must be a string');
        }

        // Optional webhook secret
        config.webhook.secret = config.webhook.secret || '';

        // Optional initial delay before session lookup
        if (config.webhook.initial_delay_ms !== undefined) {
            if (typeof config.webhook.initial_delay_ms !== 'number' || config.webhook.initial_delay_ms < 0) {
                throw new Error(`webhook.initial_delay_ms must be >= 0 (got: ${config.webhook.initial_delay_ms})`);
            }
        }

        // Optional webhook retry configuration
        if (config.webhook.session_retry !== undefined) {
            if (typeof config.webhook.session_retry.max_attempts !== 'number' || config.webhook.session_retry.max_attempts < 1) {
                throw new Error(`webhook.session_retry.max_attempts must be >= 1 (got: ${config.webhook.session_retry.max_attempts})`);
            }
            if (typeof config.webhook.session_retry.initial_delay_ms !== 'number' || config.webhook.session_retry.initial_delay_ms < 0) {
                throw new Error(`webhook.session_retry.initial_delay_ms must be >= 0 (got: ${config.webhook.session_retry.initial_delay_ms})`);
            }
        }
    }

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
