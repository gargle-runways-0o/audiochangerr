const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const fs = require('fs');

// Shared format for all transports
const logFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level.toUpperCase()}]: ${message}`)
);

// Create console transport with default settings
const defaultConsoleTransport = new winston.transports.Console({
    level: process.env.LOG_LEVEL || 'info',
});

// Create logger with console transport by default
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: logFormat,
    transports: [defaultConsoleTransport],
});

/**
 * Configure file logging with rotation
 * @param {Object} loggingConfig - Logging configuration from config.yaml or environment variables
 */
function configureFileLogging(loggingConfig) {
    // Return early if file logging is not enabled
    if (!loggingConfig || !loggingConfig.enabled) {
        return;
    }

    const logDir = loggingConfig.directory || process.env.LOG_DIRECTORY || '/logs';
    const maxSize = loggingConfig.max_size || process.env.LOG_MAX_SIZE || '20m';
    const maxFiles = loggingConfig.max_files || process.env.LOG_MAX_FILES || '14d';
    const fileLevel = loggingConfig.level || process.env.LOG_LEVEL || 'info';

    // Ensure log directory exists
    try {
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
            logger.info(`Created log directory: ${logDir}`);
        }
    } catch (error) {
        logger.error(`Failed to create log directory ${logDir}: ${error.message}`);
        return;
    }

    // Add daily rotate file transport
    const fileTransport = new DailyRotateFile({
        filename: path.join(logDir, 'audiochangerr-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        maxSize: maxSize,
        maxFiles: maxFiles,
        level: fileLevel,
        format: logFormat,
    });

    // Handle rotation events
    fileTransport.on('rotate', (oldFilename, newFilename) => {
        logger.debug(`Log rotated: ${oldFilename} -> ${newFilename}`);
    });

    fileTransport.on('error', (error) => {
        logger.error(`File transport error: ${error.message}`);
    });

    logger.add(fileTransport);
    logger.info(`File logging enabled: ${logDir}/audiochangerr-*.log (max: ${maxSize}, retention: ${maxFiles})`);
}

/**
 * Configure console logging
 * @param {Object} consoleConfig - Console configuration from config.yaml (required)
 */
function configureConsoleLogging(consoleConfig) {
    if (!consoleConfig) {
        throw new Error('Console configuration required');
    }

    const consoleLevel = consoleConfig.level;
    const consoleEnabled = consoleConfig.enabled;

    // Remove existing console transport
    logger.remove(defaultConsoleTransport);

    // Add new console transport if enabled
    if (consoleEnabled) {
        const newConsoleTransport = new winston.transports.Console({
            level: consoleLevel,
            format: logFormat,
        });
        logger.add(newConsoleTransport);
        logger.info(`Console logging: level=${consoleLevel}`);
    } else {
        logger.warn('Console logging disabled');
    }
}

/**
 * Configure file logging from environment variables only
 * This is called automatically on module load if LOG_TO_FILE is set
 */
function configureFromEnvironment() {
    if (process.env.LOG_TO_FILE === 'true') {
        configureFileLogging({
            enabled: true,
            directory: process.env.LOG_DIRECTORY,
            max_size: process.env.LOG_MAX_SIZE,
            max_files: process.env.LOG_MAX_FILES,
            level: process.env.LOG_LEVEL,
        });
    }
}

// Auto-configure from environment on module load
configureFromEnvironment();

module.exports = logger;
module.exports.configureFileLogging = configureFileLogging;
module.exports.configureConsoleLogging = configureConsoleLogging;
