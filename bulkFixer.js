const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const plexClient = require('./plexClient');
const audioSelector = require('./audioSelector');
const { getStreamsFromSession } = require('./mediaHelpers');

const STATE_FILE = path.resolve(__dirname, 'scan_state.json');

/**
 * Loads the last scan state.
 * Returns empty object if file missing or corrupt.
 */
function loadState() {
    try {
        if (!fs.existsSync(STATE_FILE)) return {};
        const data = fs.readFileSync(STATE_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        logger.warn(`Failed to load state file: ${error.message}. Defaulting to full scan.`);
        return {};
    }
}

/**
 * Saves the scan state.
 */
function saveState(state) {
    try {
        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    } catch (error) {
        logger.error(`Failed to save state file: ${error.message}`);
    }
}

/**
 * Validates the pre-selection configuration.
 * Throws an error if invalid.
 */
function validateConfig(config) {
    if (!config.pre_selection) return;

    if (config.pre_selection.libraries && !Array.isArray(config.pre_selection.libraries)) {
        throw new Error('config.pre_selection.libraries must be an array of strings');
    }
}

/**
 * Helper to safely get the Part ID from media info.
 * Reused pattern from audioFixer.js for consistency.
 */
function safelyGetPartId(mediaItem) {
    try {
        const hasMedia = mediaItem && mediaItem.Media && mediaItem.Media[0];
        const hasPart = hasMedia && mediaItem.Media[0].Part && mediaItem.Media[0].Part[0];

        if (!hasPart) return null;
        return mediaItem.Media[0].Part[0].id;
    } catch (e) {
        return null;
    }
}

/**
 * Helper to check if an item has complete audio stream info.
 */
function hasCompleteMetadata(item) {
    const hasMedia = item && item.Media && item.Media[0];
    const hasPart = hasMedia && item.Media[0].Part && item.Media[0].Part[0];
    const hasStreams = hasPart && item.Media[0].Part[0].Stream && item.Media[0].Part[0].Stream.length > 0;
    return hasStreams;
}

/**
 * Processes a single media item.
 */
async function processItem(item, config) {
    const ratingKey = item.ratingKey;
    try {
        let mediaInfo = item;

        // Optimization: Use existing data if complete, otherwise fetch
        if (hasCompleteMetadata(item)) {
            // logger.debug(`[Opt] Using existing metadata for ${ratingKey}`); 
        } else {
            // logger.debug(`[Opt] Fetching full metadata for ${ratingKey}`);
            mediaInfo = await plexClient.fetchMetadata(ratingKey);
        }

        // 2. Extract current stream
        const media = mediaInfo.Media && mediaInfo.Media[0];
        const part = media && media.Part && media.Part[0];

        if (!part || !part.Stream) {
            // logger.debug(`Skipping ${ratingKey}: No streams found`); // fast path silence
            return;
        }

        const streams = part.Stream;
        const currentStream = streams.find(s => s.streamType === 2 && s.selected);
        const currentStreamId = currentStream ? currentStream.id : null;

        // 3. Select best stream
        const bestStream = audioSelector.selectBestAudioStream(
            mediaInfo,
            currentStreamId,
            config.audio_selector
        );

        if (!bestStream) return;

        // 4. Compare and Action
        if (String(bestStream.id) !== String(currentStreamId)) {
            const partId = safelyGetPartId(mediaInfo);
            if (!partId) {
                logger.warn(`Could not get Part ID for ${ratingKey}`);
                return;
            }

            logger.info(`[Bulk] Updating ${mediaInfo.title} (${ratingKey}): ${currentStreamId} -> ${bestStream.id} (${bestStream.codec})`);

            if (config.dry_run) {
                logger.info(`[DRY] Would set audio stream to ${bestStream.id}`);
            } else {
                await plexClient.setSelectedAudioStream(partId, bestStream.id, null, false);
                logger.info(`[Bulk] Updated successfully`);
            }
        }

    } catch (error) {
        logger.error(`[Bulk] Failed to process ${ratingKey}: ${error.message}`);
    }
}

/**
 * Native batch processor (concurrency limiter).
 * Processes items array in chunks of 'limit'.
 */
async function processBatch(items, config, limit = 5) {
    let index = 0;
    const results = [];

    // We create 'limit' number of workers
    // Each worker picks the next item from the shared 'items' array

    const worker = async () => {
        while (index < items.length) {
            const i = index++; // atomic increment
            const item = items[i];

            // Filter for likely video items (Movie or Episode)
            if (item.type !== 'movie' && item.type !== 'episode') continue;

            try {
                await processItem(item, config);
            } catch (err) {
                logger.error(`Worker error on item ${item.ratingKey}: ${err.message}`);
            }
        }
    };

    const workers = [];
    for (let i = 0; i < limit; i++) {
        workers.push(worker());
    }

    await Promise.all(workers);
}

/**
 * Main entry point for bulk processing.
 */
async function run(config) {
    if (!config.pre_selection || !config.pre_selection.enabled) {
        logger.debug('Pre-selection disabled');
        return;
    }

    logger.info('Starting Bulk Pre-selection...');
    validateConfig(config);

    try {
        // 0. Load State
        const state = loadState();
        const newState = { ...state };
        let totalProcessed = 0;
        let totalSkipped = 0;

        // 1. Fetch all libraries
        const sections = await plexClient.fetchLibraries();
        logger.info(`Found ${sections.length} libraries`);

        const targetLibNames = config.pre_selection.libraries || [];
        const hasTargetLibs = targetLibNames.length > 0;

        // 2. Iterate libraries
        for (const section of sections) {
            if (hasTargetLibs && !targetLibNames.includes(section.title)) {
                logger.debug(`Skipping library: ${section.title}`);
                continue;
            }

            logger.info(`Scanning library: ${section.title} (type: ${section.type})`);

            if (section.type !== 'movie' && section.type !== 'show') {
                logger.debug(`Skipping unsupported library type: ${section.type}`);
                continue;
            }

            // 3. Fetch items
            const items = await plexClient.fetchLibraryItems(section.key);
            const lastScanTime = state[section.title] || 0;

            // 3a. Filter Incremental
            const itemsToProcess = [];
            let maxUpdatedAt = lastScanTime;

            for (const item of items) {
                // Ensure item has updatedAt
                const updatedAt = item.updatedAt || 0;
                if (updatedAt > maxUpdatedAt) maxUpdatedAt = updatedAt;

                if (updatedAt > lastScanTime) {
                    itemsToProcess.push(item);
                }
            }

            const skippedCount = items.length - itemsToProcess.length;
            totalSkipped += skippedCount;

            logger.info(`Library ${section.title}: Found ${items.length} total. Processing ${itemsToProcess.length} changed items. (Skipped ${skippedCount})`);

            if (itemsToProcess.length === 0) {
                continue;
            }

            // 4. Process Items (Optimized Batch)
            await processBatch(itemsToProcess, config, 5); // Hard-coded limit of 5

            // Update state for this library ONLY if we successfully finished the batch
            newState[section.title] = maxUpdatedAt;
            totalProcessed += itemsToProcess.length;
        }

        // 5. Save State
        if (!config.dry_run) {
            saveState(newState);
            logger.info('Scan state saved.');
        } else {
            logger.info('[DRY] Skipping state save.');
        }

        logger.info(`Bulk Pre-selection Complete. Processed: ${totalProcessed}, Skipped: ${totalSkipped}`);

    } catch (error) {
        logger.error(`Bulk Run Error: ${error.message}`);
        // We don't crash main process, just log error and return so regular polling can start
    }
}

module.exports = { run };
