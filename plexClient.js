const axios = require('axios');
const logger = require('./logger');
const xml2js = require('xml2js');
const { retryWithBackoff } = require('./retryHelper');
const plexHeaders = require('./plexHeaders');

let plexApi;
let clientId;

function createPlexClient(baseURL, token, client, accept = 'application/json', timeout = 600000) {
    const headers = plexHeaders.create({ token, clientId: client, accept });
    return axios.create({
        baseURL,
        headers,
        timeout
    });
}

function init(config, auth) {
    const timeoutMs = config.plex_api_timeout_seconds * 1000;
    clientId = auth.clientId;
    plexApi = createPlexClient(config.plex_server_url, auth.token, clientId, 'application/json', timeoutMs);
    logger.debug(`Plex API timeout: ${config.plex_api_timeout_seconds}s`);
}

async function fetchSessions() {
    return retryWithBackoff(
        async () => {
            try {
                const response = await plexApi.get('/status/sessions');
                return response.data.MediaContainer.Metadata || [];
            } catch (error) {
                if (error.response) {
                    logger.error(`Sessions: ${error.response.status} - check Plex server URL and token`);
                    logger.debug(error.stack);
                    throw new Error(`Plex API: ${error.response.status} ${error.response.statusText}`);
                } else {
                    logger.error(`Sessions: ${error.message} - check Plex server connectivity`);
                    logger.debug(error.stack);
                    throw error;
                }
            }
        },
        3,
        1000,
        'fetchSessions'
    );
}

async function fetchMetadata(ratingKey) {
    return retryWithBackoff(
        async () => {
            try {
                const response = await plexApi.get(`/library/metadata/${ratingKey}`);
                const metadata = response.data.MediaContainer.Metadata[0];
                if (!metadata) {
                    throw new Error(`No metadata found for ratingKey ${ratingKey}`);
                }
                return metadata;
            } catch (error) {
                if (error.response) {
                    logger.error(`Metadata ${ratingKey}: ${error.response.status} - check media exists in Plex`);
                    logger.debug(error.stack);
                    throw new Error(`Plex metadata: ${error.response.status}`);
                } else {
                    logger.error(`Metadata ${ratingKey}: ${error.message} - check Plex connectivity`);
                    logger.debug(error.stack);
                    throw error;
                }
            }
        },
        3,
        1000,
        `fetchMetadata(${ratingKey})`
    );
}

async function setSelectedAudioStream(partId, streamId, userToken, dry_run) {
    const tokenStatus = userToken ? 'user' : 'owner';
    if (dry_run) {
        logger.info(`[DRY] Set audio: part=${partId} stream=${streamId} token=${tokenStatus}`);
        return;
    }

    const headers = userToken ? { 'X-Plex-Token': userToken } : { 'X-Plex-Token': plexApi.defaults.headers['X-Plex-Token'] };

    try {
        const url = `/library/parts/${partId}`;
        const params = { allParts: 1, audioStreamID: streamId };
        const response = await plexApi.put(url, null, { params, headers });
        logger.debug(`Set audio: part=${partId} stream=${streamId} token=${tokenStatus}`);
    } catch (error) {
        logger.error(`Set audio: ${error.message} - check Plex permissions and stream exists`);
        throw error;
    }
}

async function terminateTranscode(transcodeKey) {
    try {
        await plexApi.delete(transcodeKey);
        logger.debug(`Kill transcode: ${transcodeKey}`);
    } catch (error) {
        logger.error(`Kill transcode: ${error.message}`);
        logger.debug(error.stack);
        throw error;
    }
}

async function terminateSession(sessionId, reason) {
    try {
        await plexApi.get('/status/sessions/terminate', {
            params: { sessionId, reason }
        });
        logger.debug(`Kill session: ${sessionId}`);
    } catch (error) {
        logger.error(`Kill session: ${error.message}`);
        logger.debug(error.stack);
        throw error;
    }
}

async function getUserDetailsFromXml(xml) {
    const parser = new xml2js.Parser();
    try {
        const result = await parser.parseStringPromise(xml);
        const sharedServers = result.MediaContainer.SharedServer || [];
        const extractedData = {};
        sharedServers.forEach((server) => {
            const userID = server.$.userID;
            const accessToken = server.$.accessToken;
            if (userID && accessToken) {
                extractedData[userID] = accessToken;
            }
        });
        return extractedData;
    } catch (error) {
        logger.error(`XML: ${error.message}`);
        return {};
    }
}

async function fetchManagedUserTokens() {
    try {
        const plexTvApi = createPlexClient(
            'https://plex.tv',
            plexApi.defaults.headers['X-Plex-Token'],
            clientId,
            'application/xml'
        );

        const resourcesResponse = await plexTvApi.get('/api/resources');
        const parser = new xml2js.Parser();
        const resourcesResult = await parser.parseStringPromise(resourcesResponse.data);

        const server = resourcesResult.MediaContainer.Device.find(
            device => device.$.clientIdentifier && device.$.provides.includes('server')
        );

        if (!server || !server.$.clientIdentifier) {
            logger.error('No clientIdentifier - check Plex.tv access and server registration');
            return {};
        }
        const clientIdentifier = server.$.clientIdentifier;

        const sharedServersResponse = await plexTvApi.get(`/api/servers/${clientIdentifier}/shared_servers`);
        const managedUserTokens = await getUserDetailsFromXml(sharedServersResponse.data);

        logger.info(`Managed users: ${Object.keys(managedUserTokens).length}`);
        return managedUserTokens;

    } catch (error) {
        if (error.response) {
            const status = error.response.status;
            logger.error(`Managed tokens: ${status} - check Plex.tv token has admin access`);

            if (status === 404) {
                logger.info('No managed users');
                return {};
            }

            logger.debug(error.stack);
            throw new Error(`Managed tokens: ${status}`);
        } else {
            logger.error(`Managed tokens: ${error.message} - check Plex.tv connectivity`);
            logger.debug(error.stack);
            throw error;
        }
    }
}

module.exports = {
    init,
    fetchSessions,
    fetchMetadata,
    setSelectedAudioStream,
    terminateTranscode,
    terminateSession,
    fetchManagedUserTokens,
};
