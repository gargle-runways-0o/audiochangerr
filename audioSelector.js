const logger = require('./logger');

function selectBestAudioStream(mediaInfo, currentStreamId, audioSelectorConfig) {
    logger.debug(`--- Starting audio stream selection for media ${mediaInfo.ratingKey} ---`);
    logger.debug(`Current Stream ID: ${currentStreamId}`);

    if (!mediaInfo.Media || !mediaInfo.Media[0].Part || !mediaInfo.Media[0].Part[0].Stream) {
        logger.warn(`Media info for item ${mediaInfo.ratingKey} is missing stream data.`);
        return undefined;
    }

    const streams = mediaInfo.Media[0].Part[0].Stream;
    const allAudioStreams = streams.filter(s => s.streamType === 2);
    const audioStreams = allAudioStreams.filter(s => String(s.id) !== String(currentStreamId));

    logger.debug('All available audio streams:');
    allAudioStreams.forEach(s => {
        logger.debug(`  ID: ${s.id}, Codec: ${s.codec}, Channels: ${s.channels}, Language: ${s.language}, Title: ${s.extendedDisplayTitle || 'N/A'}, Selected: ${String(s.id) === String(currentStreamId)}`);
    });

    if (audioStreams.length === 0) {
        logger.debug('No alternative audio streams available after filtering out current stream.');
        return undefined;
    }

    // Find the original/default stream's language if 'original' is specified in a rule
    let originalStreamLanguage = undefined;
    const currentAudioStream = streams.find(s => String(s.id) === String(currentStreamId));
    logger.debug(`Inspecting currentAudioStream: ${JSON.stringify(currentAudioStream)}`); // ADDED DEBUG
    if (currentAudioStream && currentAudioStream.language) {
        originalStreamLanguage = currentAudioStream.language.toLowerCase();
        logger.debug(`Original stream language detected: ${originalStreamLanguage}`);
    } else {
        logger.debug('Could not determine original stream language.');
    }

    // Helper function to check if a stream matches a given rule
    const isStreamMatch = (stream, rule) => {
        logger.debug(`  Evaluating stream ID ${stream.id} against rule: ${JSON.stringify(rule)}`);

        // Apply keywords_exclude first
        if (rule.keywords_exclude && rule.keywords_exclude.length > 0) {
            const streamTitle = stream.extendedDisplayTitle ? stream.extendedDisplayTitle.toLowerCase() : '';
            const matchedKeyword = rule.keywords_exclude.find(keyword => streamTitle.includes(keyword.toLowerCase()));
            if (matchedKeyword) {
                logger.debug(`    Stream ID ${stream.id} excluded by keyword: "${matchedKeyword}" in title "${stream.extendedDisplayTitle}"`);
                return false; // Exclude if any keyword matches
            }
        }

        // Apply positive filters
        if (rule.codec) {
            if (stream.codec !== rule.codec) {
                logger.debug(`    Stream ID ${stream.id} failed codec match. Expected: "${rule.codec}", Got: "${stream.codec}"`);
                return false;
            } else {
                logger.debug(`    Stream ID ${stream.id} passed codec match: "${rule.codec}"`);
            }
        }
        if (rule.channels) { // 'channels' is minimum
            if (stream.channels < rule.channels) {
                logger.debug(`    Stream ID ${stream.id} failed channels match. Expected min: ${rule.channels}, Got: ${stream.channels}`);
                return false;
            } else {
                logger.debug(`    Stream ID ${stream.id} passed channels match. Expected min: ${rule.channels}, Got: ${stream.channels}`);
            }
        }
        if (rule.language) {
            if (rule.language.toLowerCase() === 'original') {
                if (!originalStreamLanguage) {
                    logger.debug(`    Stream ID ${stream.id} failed language match (original). Original language not determined.`);
                    return false;
                }
                if (stream.language.toLowerCase() !== originalStreamLanguage) {
                    logger.debug(`    Stream ID ${stream.id} failed language match (original). Expected: "${originalStreamLanguage}", Got: "${stream.language}"`);
                    return false;
                } else {
                    logger.debug(`    Stream ID ${stream.id} passed language match (original): "${originalStreamLanguage}"`);
                }
            } else if (stream.language.toLowerCase() !== rule.language.toLowerCase()) {
                logger.debug(`    Stream ID ${stream.id} failed language match. Expected: "${rule.language}", Got: "${stream.language}"`);
                return false;
            } else {
                logger.debug(`    Stream ID ${stream.id} passed language match: "${rule.language}"`);
            }
        }
        if (rule.keywords_include && rule.keywords_include.length > 0) {
            const streamTitle = stream.extendedDisplayTitle ? stream.extendedDisplayTitle.toLowerCase() : '';
            const matchedKeyword = rule.keywords_include.find(keyword => streamTitle.includes(keyword.toLowerCase()));
            if (!matchedKeyword) {
                logger.debug(`    Stream ID ${stream.id} failed keywords_include match. Expected any of: ${rule.keywords_include.join(', ')} in title "${stream.extendedDisplayTitle}"`);
                return false; // Include only if any keyword matches
            } else {
                logger.debug(`    Stream ID ${stream.id} passed keywords_include match: "${matchedKeyword}" in title "${stream.extendedDisplayTitle}"`);
            }
        }

        logger.debug(`  Stream ID ${stream.id} successfully matched all criteria for this rule.`);
        return true;
    };

    logger.debug('Evaluating audio streams against configured rules:');
    for (const rule of audioSelectorConfig) {
        logger.debug(`Attempting to find stream for rule: ${JSON.stringify(rule)}`);
        const matchedStream = audioStreams.find(stream => isStreamMatch(stream, rule));
        if (matchedStream) {
            logger.debug(`Found stream (ID: ${matchedStream.id}, Codec: ${matchedStream.codec}, Channels: ${matchedStream.channels}, Language: ${matchedStream.language}, Title: ${matchedStream.extendedDisplayTitle}) matching rule: ${JSON.stringify(rule)}`);
            logger.debug('--- Audio stream selection complete ---');
            return matchedStream;
        } else {
            logger.debug(`No stream found for rule: ${JSON.stringify(rule)}`);
        }
    }

    logger.debug('No streams matched any rule in the audio selector configuration.');
    logger.debug('--- Audio stream selection complete ---');
    return undefined;
}

module.exports = {
    selectBestAudioStream,
};