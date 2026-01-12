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
/**
 * Processes a single media item for all target users.
 */
async function processItem(item, config, users) {
    const ratingKey = item.ratingKey;

    for (const user of users) {
        try {
            // Must fetch metadata as the specific user to see their selected streams
            let mediaInfo;
            try {
                mediaInfo = await plexClient.fetchMetadata(ratingKey, user.token);
            } catch (err) {
                // Squelch 404s or permission errors for specific users (e.g. restrictions)
                // logger.debug(`[Bulk][${user.username}] Skip ${ratingKey}: ${err.message}`);
                continue;
            }

            // 2. Extract current stream
            const media = mediaInfo.Media && mediaInfo.Media[0];
            const part = media && media.Part && media.Part[0];

            if (!part || !part.Stream) {
                continue;
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

            if (!bestStream) continue;

            // 4. Compare and Action
            if (String(bestStream.id) !== String(currentStreamId)) {
                const partId = safelyGetPartId(mediaInfo);
                if (!partId) {
                    logger.warn(`[Bulk][${user.username}] Could not get Part ID for ${ratingKey}`);
                    continue;
                }

                logger.info(`[Bulk][${user.username}] Updating ${mediaInfo.title} (${ratingKey}): ${currentStreamId} -> ${bestStream.id} (${bestStream.codec})`);

                if (config.dry_run) {
                    logger.info(`[DRY][${user.username}] Would set audio stream to ${bestStream.id}`);
                } else {
                    await plexClient.setSelectedAudioStream(partId, bestStream.id, user.token, false);
                    logger.info(`[Bulk][${user.username}] Updated successfully`);
                }
            }

        } catch (error) {
            logger.error(`[Bulk][${user.username}] Failed to process ${ratingKey}: ${error.message}`);
        }
    }
}

/**
 * Native batch processor (concurrency limiter).
 * Processes items array in chunks of 'limit'.
 */
async function processBatch(items, config, users, limit = 5) {
    let index = 0;

    const worker = async () => {
        while (index < items.length) {
            const i = index++; // atomic increment
            const item = items[i];

            // Filter for likely video items (Movie or Episode)
            if (item.type !== 'movie' && item.type !== 'episode') continue;

            try {
                await processItem(item, config, users);
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
 * Helper to fetch all target users (Owner + Managed).
 */
async function getUsers() {
    const ownerToken = plexClient.getOwnerToken();
    const users = [{ id: 'owner', token: ownerToken, username: 'Owner' }];

    try {
        const managedUsers = await plexClient.fetchManagedUserTokens();
        if (Array.isArray(managedUsers)) {
            users.push(...managedUsers);
        }
    } catch (e) {
        logger.warn(`Could not fetch managed users, proceeding with Owner only: ${e.message}`);
    }
    return users;
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
        // 0. Load Users
        const users = await getUsers();
        logger.info(`Target Users (${users.length}): ${users.map(u => u.username).join(', ')}`);

        // 1. Load State
        const state = loadState();
        const newState = { ...state };
        let totalProcessed = 0;
        let totalSkipped = 0;

        // 2. Fetch all libraries
        const sections = await plexClient.fetchLibraries();
        logger.info(`Found ${sections.length} libraries`);

        const targetLibNames = config.pre_selection.libraries || [];
        const hasTargetLibs = targetLibNames.length > 0;

        // 3. Iterate libraries
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

            // 4. Fetch items
            let fetchType = undefined;
            if (section.type === 'show') fetchType = 4;

            const items = await plexClient.fetchLibraryItems(section.key, fetchType);
            logger.info(`Found ${items.length} items in ${section.title}`);
            const lastScanTime = state[section.title] || 0;

            // 4a. Filter Incremental
            const itemsToProcess = [];
            let maxUpdatedAt = lastScanTime;

            for (const item of items) {
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

            // 5. Process Items (Optimized Batch)
            await processBatch(itemsToProcess, config, users, 5);

            // Update state for this library ONLY if we successfully finished the batch
            newState[section.title] = maxUpdatedAt;
            totalProcessed += itemsToProcess.length;
        }

        // 6. Save State
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

module.exports = { run, processItem, getUsers };
