// Mock modules before requiring config module
jest.mock('../logger', () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
}));

// Mock fs module with auto-mocking
jest.mock('fs', () => ({
    existsSync: jest.fn(),
    readFileSync: jest.fn()
}));

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

describe('config validation', () => {
    let loadConfig;

    beforeEach(() => {
        // Clear module cache to get fresh config module
        jest.resetModules();
        loadConfig = require('../config').loadConfig;
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('audio_selector validation', () => {
        const validConfig = {
            plex_server_url: 'http://localhost:32400',
            plex_token: 'test_token',
            owner_username: 'test_user',
            audio_selector: []
        };

        it('should accept valid codec', () => {
            const config = {
                ...validConfig,
                audio_selector: [{ codec: 'ac3' }]
            };
            fs.existsSync.mockReturnValue(true);
            fs.readFileSync.mockReturnValue(yaml.dump(config));

            expect(() => loadConfig()).not.toThrow();
        });

        it('should reject invalid codec', () => {
            const config = {
                ...validConfig,
                audio_selector: [{ codec: 'invalid_codec' }]
            };
            fs.existsSync.mockReturnValue(true);
            fs.readFileSync.mockReturnValue(yaml.dump(config));

            expect(() => loadConfig()).toThrow(/Invalid codec in rule 0.*invalid_codec/);
        });

        it('should accept valid channels', () => {
            const config = {
                ...validConfig,
                audio_selector: [{ channels: 6 }]
            };
            fs.existsSync.mockReturnValue(true);
            fs.readFileSync.mockReturnValue(yaml.dump(config));

            expect(() => loadConfig()).not.toThrow();
        });

        it('should reject channels less than 1', () => {
            const config = {
                ...validConfig,
                audio_selector: [{ channels: 0 }]
            };
            fs.existsSync.mockReturnValue(true);
            fs.readFileSync.mockReturnValue(yaml.dump(config));

            expect(() => loadConfig()).toThrow(/Invalid channels in rule 0.*Must be 1-8/);
        });

        it('should reject channels greater than 8', () => {
            const config = {
                ...validConfig,
                audio_selector: [{ channels: 10 }]
            };
            fs.existsSync.mockReturnValue(true);
            fs.readFileSync.mockReturnValue(yaml.dump(config));

            expect(() => loadConfig()).toThrow(/Invalid channels in rule 0.*Must be 1-8/);
        });

        it('should accept "original" language', () => {
            const config = {
                ...validConfig,
                audio_selector: [{ language: 'original' }]
            };
            fs.existsSync.mockReturnValue(true);
            fs.readFileSync.mockReturnValue(yaml.dump(config));

            expect(() => loadConfig()).not.toThrow();
        });

        it('should accept ISO language code', () => {
            const config = {
                ...validConfig,
                audio_selector: [{ language: 'eng' }]
            };
            fs.existsSync.mockReturnValue(true);
            fs.readFileSync.mockReturnValue(yaml.dump(config));

            expect(() => loadConfig()).not.toThrow();
        });

        it('should reject invalid language code', () => {
            const config = {
                ...validConfig,
                audio_selector: [{ language: 'invalid123' }]
            };
            fs.existsSync.mockReturnValue(true);
            fs.readFileSync.mockReturnValue(yaml.dump(config));

            expect(() => loadConfig()).toThrow(/Invalid language in rule 0/);
        });

        it('should accept keywords_include as array', () => {
            const config = {
                ...validConfig,
                audio_selector: [{ keywords_include: ['Surround', '5.1'] }]
            };
            fs.existsSync.mockReturnValue(true);
            fs.readFileSync.mockReturnValue(yaml.dump(config));

            expect(() => loadConfig()).not.toThrow();
        });

        it('should reject keywords_include as non-array', () => {
            const config = {
                ...validConfig,
                audio_selector: [{ keywords_include: 'not_an_array' }]
            };
            fs.existsSync.mockReturnValue(true);
            fs.readFileSync.mockReturnValue(yaml.dump(config));

            expect(() => loadConfig()).toThrow(/Invalid keywords_include in rule 0.*must be array/);
        });

        it('should accept keywords_exclude as array', () => {
            const config = {
                ...validConfig,
                audio_selector: [{ keywords_exclude: ['Commentary'] }]
            };
            fs.existsSync.mockReturnValue(true);
            fs.readFileSync.mockReturnValue(yaml.dump(config));

            expect(() => loadConfig()).not.toThrow();
        });

        it('should reject keywords_exclude as non-array', () => {
            const config = {
                ...validConfig,
                audio_selector: [{ keywords_exclude: 'not_an_array' }]
            };
            fs.existsSync.mockReturnValue(true);
            fs.readFileSync.mockReturnValue(yaml.dump(config));

            expect(() => loadConfig()).toThrow(/Invalid keywords_exclude in rule 0.*must be array/);
        });
    });

    describe('config_version validation', () => {
        const validConfig = {
            plex_server_url: 'http://localhost:32400',
            plex_token: 'test_token',
            owner_username: 'test_user',
            audio_selector: []
        };

        it('should accept config_version 1', () => {
            const config = {
                ...validConfig,
                config_version: 1
            };
            fs.existsSync.mockReturnValue(true);
            fs.readFileSync.mockReturnValue(yaml.dump(config));

            expect(() => loadConfig()).not.toThrow();
        });

        it('should accept missing config_version', () => {
            fs.existsSync.mockReturnValue(true);
            fs.readFileSync.mockReturnValue(yaml.dump(validConfig));

            expect(() => loadConfig()).not.toThrow();
        });

        it('should reject unsupported config_version', () => {
            const config = {
                ...validConfig,
                config_version: 2
            };
            fs.existsSync.mockReturnValue(true);
            fs.readFileSync.mockReturnValue(yaml.dump(config));

            expect(() => loadConfig()).toThrow(/Unsupported config version: 2/);
        });
    });

    describe('required fields', () => {
        it('should reject missing plex_server_url', () => {
            const config = {
                plex_token: 'test_token',
                owner_username: 'test_user',
                audio_selector: []
            };
            fs.existsSync.mockReturnValue(true);
            fs.readFileSync.mockReturnValue(yaml.dump(config));

            expect(() => loadConfig()).toThrow(/Missing: plex_server_url/);
        });

        it('should reject missing plex_token', () => {
            const config = {
                plex_server_url: 'http://localhost:32400',
                owner_username: 'test_user',
                audio_selector: []
            };
            fs.existsSync.mockReturnValue(true);
            fs.readFileSync.mockReturnValue(yaml.dump(config));

            expect(() => loadConfig()).toThrow(/Missing: plex_token/);
        });

        it('should reject missing owner_username', () => {
            const config = {
                plex_server_url: 'http://localhost:32400',
                plex_token: 'test_token',
                audio_selector: []
            };
            fs.existsSync.mockReturnValue(true);
            fs.readFileSync.mockReturnValue(yaml.dump(config));

            expect(() => loadConfig()).toThrow(/Missing: owner_username/);
        });

        it('should reject missing audio_selector', () => {
            const config = {
                plex_server_url: 'http://localhost:32400',
                plex_token: 'test_token',
                owner_username: 'test_user'
            };
            fs.existsSync.mockReturnValue(true);
            fs.readFileSync.mockReturnValue(yaml.dump(config));

            expect(() => loadConfig()).toThrow(/audio_selector must be array/);
        });
    });
});
