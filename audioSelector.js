const logger = require('./logger');
const { getStreamsFromMetadata } = require('./mediaHelpers');

function selectBestAudioStream(mediaInfo, currentStreamId, audioSelectorConfig) {
    logger.debug(`Select: ${mediaInfo.ratingKey} current=${currentStreamId}`);

    const streams = getStreamsFromMetadata(mediaInfo);
    const allAudioStreams = streams.filter(s => s.streamType === 2);
    const audioStreams = allAudioStreams.filter(s => String(s.id) !== String(currentStreamId));

    logger.debug(`Streams: ${allAudioStreams.map(s => `${s.id}:${s.codec}${String(s.id) === String(currentStreamId) ? '*' : ''}`).join(', ')}`);

    if (audioStreams.length === 0) {
        logger.debug('No alternatives');
        return undefined;
    }

    let originalStreamLanguage = undefined;
    const currentAudioStream = streams.find(s => String(s.id) === String(currentStreamId));
    if (currentAudioStream && currentAudioStream.language) {
        originalStreamLanguage = currentAudioStream.language.toLowerCase();
        logger.debug(`Original lang: ${originalStreamLanguage}`);
    }

    const getStreamTitle = (stream) => stream.extendedDisplayTitle ? stream.extendedDisplayTitle.toLowerCase() : '';

    const checkKeywordsExclude = (stream, rule, streamTitle) => {
        if (!rule.keywords_exclude || rule.keywords_exclude.length === 0) return true;
        const matchedKeyword = rule.keywords_exclude.find(keyword => streamTitle.includes(keyword.toLowerCase()));
        if (matchedKeyword) {
            logger.debug(`  Exclude: ${matchedKeyword}`);
            return false;
        }
        return true;
    };

    const checkCodec = (stream, rule) => {
        if (!rule.codec) return true;
        if (stream.codec !== rule.codec) {
            logger.debug(`  Codec: want ${rule.codec} got ${stream.codec}`);
            return false;
        }
        return true;
    };

    const checkChannels = (stream, rule) => {
        if (!rule.channels) return true;
        if (stream.channels < rule.channels) {
            logger.debug(`  Ch: want ${rule.channels} got ${stream.channels}`);
            return false;
        }
        return true;
    };

    const checkLanguage = (stream, rule) => {
        if (!rule.language) return true;
        const ruleLanguage = rule.language.toLowerCase();
        const streamLanguage = stream.language.toLowerCase();

        if (ruleLanguage === 'original') {
            if (!originalStreamLanguage) {
                logger.debug(`  Lang: original unknown`);
                return false;
            }
            if (streamLanguage !== originalStreamLanguage) {
                logger.debug(`  Lang: want ${originalStreamLanguage} got ${stream.language}`);
                return false;
            }
            return true;
        }

        if (streamLanguage !== ruleLanguage) {
            logger.debug(`  Lang: want ${rule.language} got ${stream.language}`);
            return false;
        }
        return true;
    };

    const checkKeywordsInclude = (stream, rule, streamTitle) => {
        if (!rule.keywords_include || rule.keywords_include.length === 0) return true;
        const matchedKeyword = rule.keywords_include.find(keyword => streamTitle.includes(keyword.toLowerCase()));
        if (!matchedKeyword) {
            logger.debug(`  Include: want [${rule.keywords_include.join(', ')}]`);
            return false;
        }
        return true;
    };

    const isStreamMatch = (stream, rule) => {
        logger.debug(`Eval ${stream.id}`);
        const streamTitle = getStreamTitle(stream);

        if (!checkKeywordsExclude(stream, rule, streamTitle)) return false;
        if (!checkCodec(stream, rule)) return false;
        if (!checkChannels(stream, rule)) return false;
        if (!checkLanguage(stream, rule)) return false;
        if (!checkKeywordsInclude(stream, rule, streamTitle)) return false;

        logger.debug(`Match: ${stream.id}`);
        return true;
    };

    for (const rule of audioSelectorConfig) {
        const matchedStream = audioStreams.find(stream => isStreamMatch(stream, rule));
        if (matchedStream) {
            logger.debug(`Selected: ${matchedStream.id} ${matchedStream.codec} ${matchedStream.channels}ch`);
            return matchedStream;
        }
    }

    logger.debug('No match');
    return undefined;
}

module.exports = {
    selectBestAudioStream,
};
