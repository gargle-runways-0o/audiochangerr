const axios = require('axios');
const logger = require('./logger');
const xml2js = require('xml2js');

let plexApi;

function createPlexClient(baseURL, token, accept = 'application/json', timeout = 600000) {
    return axios.create({
        baseURL,
        headers: {
            'X-Plex-Token': token,
            'Accept': accept
        },
        timeout
    });
}

function init(config) {
    plexApi = createPlexClient(config.plex_server_url, config.plex_token);
}

async function fetchSessions() {
    try {
        const response = await plexApi.get('/status/sessions');
        return response.data.MediaContainer.Metadata || [];
    } catch (error) {
        if (error.response) {
            logger.error(`GET /status/sessions: ${error.response.status} ${error.response.statusText}`);
            logger.debug(error.stack);
            throw new Error(`Plex API error: ${error.response.status} ${error.response.statusText}`);
        } else {
            logger.error(`GET /status/sessions: ${error.message}`);
            logger.debug(error.stack);
            throw error;
        }
    }
}

async function fetchMetadata(ratingKey) {
    try {
        const response = await plexApi.get(`/library/metadata/${ratingKey}`);
        const metadata = response.data.MediaContainer.Metadata[0];
        if (!metadata) {
            throw new Error(`No metadata found for ratingKey ${ratingKey}`);
        }
        return metadata;
    } catch (error) {
        if (error.response) {
            logger.error(`GET /library/metadata/${ratingKey}: ${error.response.status} ${error.response.statusText}`);
            logger.debug(error.stack);
            throw new Error(`Plex metadata fetch failed: ${error.response.status}`);
        } else {
            logger.error(`GET /library/metadata/${ratingKey}: ${error.message}`);
            logger.debug(error.stack);
            throw error;
        }
    }
}

async function setSelectedAudioStream(partId, streamId, userToken, dry_run) {
    const tokenStatus = userToken ? 'provided' : 'owner';
    if (dry_run) {
        logger.info(`[DRY RUN] Set audio: part ${partId}, stream ${streamId}, token ${tokenStatus}`);
        return;
    }

    const headers = userToken ? { 'X-Plex-Token': userToken } : { 'X-Plex-Token': plexApi.defaults.headers['X-Plex-Token'] };

    try {
        const url = `/library/parts/${partId}`;
        const params = { allParts: 1, audioStreamID: streamId };
        logger.debug(`PUT ${url}: ${JSON.stringify(params)}, token ${tokenStatus}`);
        const response = await plexApi.put(url, null, { params, headers });
        logger.debug(`Response: ${response.status} ${response.statusText}`);
        logger.info(`Set audio: part ${partId}, stream ${streamId}, token ${tokenStatus}`);
    } catch (error) {
        logger.error(`Set audio failed: part ${partId}, ${error.message}`);
        throw error;
    }
}

async function terminateTranscode(transcodeKey) {
    try {
        await plexApi.delete(transcodeKey);
        logger.debug(`Terminated transcode: ${transcodeKey}`);
    } catch (error) {
        logger.error(`Failed to terminate transcode ${transcodeKey}: ${error.message}`);
        logger.debug(error.stack);
        throw error;
    }
}

async function terminateSession(sessionId, reason) {
    try {
        await plexApi.get('/status/sessions/terminate', {
            params: { sessionId, reason }
        });
        logger.debug(`Terminated session: ${sessionId}`);
    } catch (error) {
        logger.error(`Failed to terminate session ${sessionId}: ${error.message}`);
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
        logger.error(`XML parse error: ${error.message}`);
        return {};
    }
}

async function fetchManagedUserTokens() {
    try {
        const plexTvApi = createPlexClient(
            'https://plex.tv',
            plexApi.defaults.headers['X-Plex-Token'],
            'application/xml'
        );

        const resourcesResponse = await plexTvApi.get('/api/resources');
        const parser = new xml2js.Parser();
        const resourcesResult = await parser.parseStringPromise(resourcesResponse.data);

        const server = resourcesResult.MediaContainer.Device.find(
            device => device.$.clientIdentifier && device.$.provides.includes('server')
        );

        if (!server || !server.$.clientIdentifier) {
            logger.error('No clientIdentifier in /api/resources');
            return {};
        }
        const clientIdentifier = server.$.clientIdentifier;

        const sharedServersResponse = await plexTvApi.get(`/api/servers/${clientIdentifier}/shared_servers`);
        const managedUserTokens = await getUserDetailsFromXml(sharedServersResponse.data);

        logger.info(`Fetched ${Object.keys(managedUserTokens).length} managed user tokens`);
        return managedUserTokens;

    } catch (error) {
        if (error.response) {
            const status = error.response.status;
            logger.error(`Fetch managed tokens: ${status} ${error.response.statusText}`);

            // 404 is expected if no managed users - return empty
            if (status === 404) {
                logger.info('No managed users found (404 expected)');
                return {};
            }

            // Auth or other errors should fail fast
            logger.debug(error.stack);
            throw new Error(`Managed user token fetch failed: ${status}`);
        } else {
            logger.error(`Fetch managed tokens: ${error.message}`);
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
