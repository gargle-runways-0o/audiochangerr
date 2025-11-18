const logger = require('./logger');

async function retryWithBackoff(fn, maxRetries = 3, initialDelayMs = 1000, operationName = 'operation') {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            const isLastAttempt = attempt === maxRetries - 1;

            if (isLastAttempt) {
                logger.error(`${operationName}: ${maxRetries} attempts failed: ${error.message}`);
                throw error;
            }

            const delayMs = initialDelayMs * Math.pow(2, attempt);
            logger.warn(`${operationName}: retry ${attempt + 1}/${maxRetries} in ${delayMs}ms: ${error.message}`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }
}

module.exports = { retryWithBackoff };
