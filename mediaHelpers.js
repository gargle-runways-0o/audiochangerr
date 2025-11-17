const logger = require('./logger');

function getStreamsFromSession(session) {
    if (!session?.Media?.[0]?.Part?.[0]?.Stream) {
        throw new Error(`Invalid session structure: missing Media/Part/Stream (session: ${session?.sessionKey || 'unknown'})`);
    }
    return session.Media[0].Part[0].Stream;
}

function getStreamsFromMetadata(metadata) {
    if (!metadata?.Media?.[0]?.Part?.[0]?.Stream) {
        throw new Error(`Invalid metadata structure: missing Media/Part/Stream (ratingKey: ${metadata?.ratingKey || 'unknown'})`);
    }
    return metadata.Media[0].Part[0].Stream;
}

function getPartId(session) {
    if (!session?.Media?.[0]?.Part?.[0]?.id) {
        throw new Error(`Invalid session structure: missing Part id (session: ${session?.sessionKey || 'unknown'})`);
    }
    return session.Media[0].Part[0].id;
}

module.exports = {
    getStreamsFromSession,
    getStreamsFromMetadata,
    getPartId
};
