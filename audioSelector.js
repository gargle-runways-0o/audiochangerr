const logger = require('./logger');
const { getStreamsFromMetadata } = require('./mediaHelpers');

function selectBestAudioStream(mediaInfo, currentStreamId, audioSelectorConfig) {
    logger.debug(`Stream selection: media ${mediaInfo.ratingKey}`);
    logger.debug(`Current stream: ${currentStreamId}`);

    const streams = getStreamsFromMetadata(mediaInfo);
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

    const getStreamTitle = (stream) => stream.extendedDisplayTitle ? stream.extendedDisplayTitle.toLowerCase() : '';

    const checkKeywordsExclude = (stream, rule, streamTitle) => {
        if (!rule.keywords_exclude || rule.keywords_exclude.length === 0) return true;
        const matchedKeyword = rule.keywords_exclude.find(keyword => streamTitle.includes(keyword.toLowerCase()));
        if (matchedKeyword) {
            logger.debug(`    Excluded: "${matchedKeyword}"`);
            return false;
        }
        return true;
    };

    const checkCodec = (stream, rule) => {
        if (!rule.codec) return true;
        if (stream.codec !== rule.codec) {
            logger.debug(`    Codec fail: want ${rule.codec}, got ${stream.codec}`);
            return false;
        }
        logger.debug(`    Codec ok: ${rule.codec}`);
        return true;
    };

    const checkChannels = (stream, rule) => {
        if (!rule.channels) return true;
        if (stream.channels < rule.channels) {
            logger.debug(`    Channels fail: want ${rule.channels}, got ${stream.channels}`);
            return false;
        }
        logger.debug(`    Channels ok: ${stream.channels} >= ${rule.channels}`);
        return true;
    };

    const checkLanguage = (stream, rule) => {
        if (!rule.language) return true;
        const ruleLanguage = rule.language.toLowerCase();
        const streamLanguage = stream.language.toLowerCase();

        if (ruleLanguage === 'original') {
            if (!originalStreamLanguage) {
                logger.debug(`    Language fail: original not determined`);
                return false;
            }
            if (streamLanguage !== originalStreamLanguage) {
                logger.debug(`    Language fail: want ${originalStreamLanguage}, got ${stream.language}`);
                return false;
            }
            logger.debug(`    Language ok: ${originalStreamLanguage}`);
            return true;
        }

        if (streamLanguage !== ruleLanguage) {
            logger.debug(`    Language fail: want ${rule.language}, got ${stream.language}`);
            return false;
        }
        logger.debug(`    Language ok: ${rule.language}`);
        return true;
    };

    const checkKeywordsInclude = (stream, rule, streamTitle) => {
        if (!rule.keywords_include || rule.keywords_include.length === 0) return true;
        const matchedKeyword = rule.keywords_include.find(keyword => streamTitle.includes(keyword.toLowerCase()));
        if (!matchedKeyword) {
            logger.debug(`    Include fail: want [${rule.keywords_include.join(', ')}]`);
            return false;
        }
        logger.debug(`    Include ok: "${matchedKeyword}"`);
        return true;
    };

    const isStreamMatch = (stream, rule) => {
        logger.debug(`  Eval ${stream.id}: ${JSON.stringify(rule)}`);
        const streamTitle = getStreamTitle(stream);

        if (!checkKeywordsExclude(stream, rule, streamTitle)) return false;
        if (!checkCodec(stream, rule)) return false;
        if (!checkChannels(stream, rule)) return false;
        if (!checkLanguage(stream, rule)) return false;
        if (!checkKeywordsInclude(stream, rule, streamTitle)) return false;

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
