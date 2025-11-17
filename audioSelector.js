const logger = require('./logger');

function selectBestAudioStream(mediaInfo, currentStreamId, audioSelectorConfig) {
    logger.debug(`Stream selection: media ${mediaInfo.ratingKey}`);
    logger.debug(`Current stream: ${currentStreamId}`);

    if (!mediaInfo.Media || !mediaInfo.Media[0].Part || !mediaInfo.Media[0].Part[0].Stream) {
        logger.warn(`No stream data: ${mediaInfo.ratingKey}`);
        return undefined;
    }

    const streams = mediaInfo.Media[0].Part[0].Stream;
    const allAudioStreams = streams.filter(s => s.streamType === 2);
    const audioStreams = allAudioStreams.filter(s => String(s.id) !== String(currentStreamId));

    logger.debug('Available streams:');
    allAudioStreams.forEach(s => {
        logger.debug(`  ${s.id}: ${s.codec} ${s.channels}ch ${s.language} "${s.extendedDisplayTitle || 'N/A'}" ${String(s.id) === String(currentStreamId) ? '(current)' : ''}`);
    });

    if (audioStreams.length === 0) {
        logger.debug('No alternatives');
        return undefined;
    }

    let originalStreamLanguage = undefined;
    const currentAudioStream = streams.find(s => String(s.id) === String(currentStreamId));
    logger.debug(`Current: ${JSON.stringify(currentAudioStream)}`);
    if (currentAudioStream && currentAudioStream.language) {
        originalStreamLanguage = currentAudioStream.language.toLowerCase();
        logger.debug(`Original language: ${originalStreamLanguage}`);
    }

    const isStreamMatch = (stream, rule) => {
        logger.debug(`  Eval ${stream.id}: ${JSON.stringify(rule)}`);

        if (rule.keywords_exclude && rule.keywords_exclude.length > 0) {
            const streamTitle = stream.extendedDisplayTitle ? stream.extendedDisplayTitle.toLowerCase() : '';
            const matchedKeyword = rule.keywords_exclude.find(keyword => streamTitle.includes(keyword.toLowerCase()));
            if (matchedKeyword) {
                logger.debug(`    Excluded: "${matchedKeyword}"`);
                return false;
            }
        }

        if (rule.codec) {
            if (stream.codec !== rule.codec) {
                logger.debug(`    Codec fail: want ${rule.codec}, got ${stream.codec}`);
                return false;
            }
            logger.debug(`    Codec ok: ${rule.codec}`);
        }

        if (rule.channels) {
            if (stream.channels < rule.channels) {
                logger.debug(`    Channels fail: want ${rule.channels}, got ${stream.channels}`);
                return false;
            }
            logger.debug(`    Channels ok: ${stream.channels} >= ${rule.channels}`);
        }

        if (rule.language) {
            if (rule.language.toLowerCase() === 'original') {
                if (!originalStreamLanguage) {
                    logger.debug(`    Language fail: original not determined`);
                    return false;
                }
                if (stream.language.toLowerCase() !== originalStreamLanguage) {
                    logger.debug(`    Language fail: want ${originalStreamLanguage}, got ${stream.language}`);
                    return false;
                }
                logger.debug(`    Language ok: ${originalStreamLanguage}`);
            } else if (stream.language.toLowerCase() !== rule.language.toLowerCase()) {
                logger.debug(`    Language fail: want ${rule.language}, got ${stream.language}`);
                return false;
            } else {
                logger.debug(`    Language ok: ${rule.language}`);
            }
        }

        if (rule.keywords_include && rule.keywords_include.length > 0) {
            const streamTitle = stream.extendedDisplayTitle ? stream.extendedDisplayTitle.toLowerCase() : '';
            const matchedKeyword = rule.keywords_include.find(keyword => streamTitle.includes(keyword.toLowerCase()));
            if (!matchedKeyword) {
                logger.debug(`    Include fail: want [${rule.keywords_include.join(', ')}]`);
                return false;
            }
            logger.debug(`    Include ok: "${matchedKeyword}"`);
        }

        logger.debug(`  Match: ${stream.id}`);
        return true;
    };

    logger.debug('Evaluating rules:');
    for (const rule of audioSelectorConfig) {
        logger.debug(`Rule: ${JSON.stringify(rule)}`);
        const matchedStream = audioStreams.find(stream => isStreamMatch(stream, rule));
        if (matchedStream) {
            logger.debug(`Selected: ${matchedStream.id} (${matchedStream.codec} ${matchedStream.channels}ch ${matchedStream.language} "${matchedStream.extendedDisplayTitle}")`);
            return matchedStream;
        }
        logger.debug(`No match`);
    }

    logger.debug('No streams matched');
    return undefined;
}

module.exports = {
    selectBestAudioStream,
};
