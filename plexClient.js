const axios = require('axios');
const http = require('http');
const https = require('https');
const logger = require('./logger');
const xml2js = require('xml2js');
const { retryWithBackoff } = require('./retryHelper');
const plexHeaders = require('./plexHeaders');

let plexApi;
let clientId;
let ownerToken; // Module-level variable to store the token

// Keep-Alive Agents
const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true });

function createPlexClient(baseURL, token, client, accept = 'application/json', timeout = 600000) {
    const headers = plexHeaders.create({ token, clientId: client, accept });
    return axios.create({
        baseURL,
        headers,
        timeout,
        httpAgent,
        httpsAgent
    });
}

function init(config, auth) {
    const timeoutMs = config.plex_api_timeout_seconds * 1000;

    clientId = auth.clientId;
    ownerToken = auth.token; // Explicitly store the token string

    // VERBOSE DEBUG: Check if token was actually passed correctly
    if (!ownerToken) {
        logger.error('[DEBUG-V] CRITICAL: init() called but auth.token is missing/undefined!');
    } else {
        const tokenType = typeof ownerToken;
        const tokenPreview = tokenType === 'string' ? `${ownerToken.substring(0, 4)}...` : 'Not a string';
        logger.debug(`[DEBUG-V] plexClient.init: Token stored. Type: ${tokenType}, Value: ${tokenPreview}`);
    }

    plexApi = createPlexClient(config.plex_server_url, ownerToken, clientId, 'application/json', timeoutMs);
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
                    throw new Error(`Plex API: ${error.response.status} ${error.response.statusText}`);
                } else {
                    logger.error(`Sessions: ${error.message} - check Plex server connectivity`);
                    throw error;
                }
            }
        },
        3, 1000, 'fetchSessions'
    );
}

async function fetchMetadata(ratingKey) {
    return retryWithBackoff(
        async () => {
            try {
                const response = await plexApi.get(`/library/metadata/${ratingKey}`);
                const metadata = response.data.MediaContainer.Metadata[0];
                if (!metadata) throw new Error(`No metadata found for ratingKey ${ratingKey}`);
                return metadata;
            } catch (error) {
                if (error.response) {
                    logger.error(`Metadata ${ratingKey}: ${error.response.status}`);
                    throw new Error(`Plex metadata: ${error.response.status}`);
                } else {
                    logger.error(`Metadata ${ratingKey}: ${error.message}`);
                    throw error;
                }
            }
        },
        3, 1000, `fetchMetadata(${ratingKey})`
    );
}

async function setSelectedAudioStream(partId, streamId, userToken, dry_run) {
    const tokenStatus = userToken ? 'user' : 'owner';

    // VERBOSE DEBUG
    logger.debug(`[DEBUG-V] setSelectedAudioStream: Part=${partId}, Stream=${streamId}, Token=${tokenStatus}, UserTokenProvided=${!!userToken}`);

    if (dry_run) {
        logger.info(`[DRY] Set audio: part=${partId} stream=${streamId} token=${tokenStatus}`);
        return;
    }

    const headers = userToken ? { 'X-Plex-Token': userToken } : {};

    try {
        const url = `/library/parts/${partId}`;
        const params = { allParts: 1, audioStreamID: streamId };
        await plexApi.put(url, null, { params, headers });
        logger.debug(`Set audio: part=${partId} stream=${streamId} token=${tokenStatus}`);
    } catch (error) {
        logger.error(`Set audio: ${error.message}`);
        throw error;
    }
}

async function terminateTranscode(transcodeKey) {
    try {
        await plexApi.delete(transcodeKey);
        logger.debug(`Kill transcode: ${transcodeKey}`);
    } catch (error) {
        logger.error(`Kill transcode: ${error.message}`);
        throw error;
    }
}

async function terminateSession(sessionId, reason) {
    try {
        await plexApi.get('/status/sessions/terminate', { params: { sessionId, reason } });
        logger.debug(`Kill session: ${sessionId}`);
    } catch (error) {
        logger.error(`Kill session: ${error.message}`);
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
            if (userID && accessToken) extractedData[userID] = accessToken;
        });
        return extractedData;
    } catch (error) {
        logger.error(`XML: ${error.message}`);
        return {};
    }
}

async function fetchLibraries() {
    return retryWithBackoff(
        async () => {
            try {
                const response = await plexApi.get('/library/sections');
                return response.data.MediaContainer.Directory || [];
            } catch (error) {
                if (error.response) {
                    logger.error(`Fetch Libraries: ${error.response.status}`);
                    throw new Error(`Plex Libraries: ${error.response.status}`);
                } else {
                    logger.error(`Fetch Libraries: ${error.message}`);
                    throw error;
                }
            }
        },
        3, 1000, 'fetchLibraries'
    );
}

async function fetchLibraryItems(sectionId, itemType) {
    return retryWithBackoff(
        async () => {
            try {
                // Fetch items, optionally filtering by type (e.g. 4=Episode)
                const url = `/library/sections/${sectionId}/all`;
                const params = itemType ? { type: itemType } : {};

                const response = await plexApi.get(url, { params });
                return response.data.MediaContainer.Metadata || [];
            } catch (error) {
                if (error.response) {
                    logger.error(`Fetch Items (${sectionId}): ${error.response.status}`);
                    throw new Error(`Plex Library Items: ${error.response.status}`);
                } else {
                    logger.error(`Fetch Items (${sectionId}): ${error.message}`);
                    throw error;
                }
            }
        },
        3, 1000, `fetchLibraryItems(${sectionId})`
    );
}

async function fetchManagedUserTokens() {
    try {
        // VERBOSE DEBUG
        logger.debug(`[DEBUG-V] fetchManagedUserTokens: Using owner token: ${ownerToken ? 'Yes' : 'NO'}`);

        const plexTvApi = createPlexClient('https://plex.tv', ownerToken, clientId, 'application/xml');
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
        logger.error(`Managed tokens error: ${error.message}`);
        return {};
    }
}

function getOwnerToken() {
    // VERBOSE DEBUG
    if (!ownerToken) {
        logger.error('[DEBUG-V] CRITICAL: getOwnerToken() called but ownerToken is undefined/null.');
        // Attempt fallback to see if Axios has it (Legacy check)
        const headerToken = plexApi?.defaults?.headers?.['X-Plex-Token'];
        if (headerToken) {
            logger.debug('[DEBUG-V] Recovered token from Axios headers.');
            return headerToken;
        }
        throw new Error('Owner token not available - check authentication');
    }
    logger.debug(`[DEBUG-V] getOwnerToken returning valid token (len=${ownerToken.length})`);
    return ownerToken;
}

module.exports = {
    init,
    fetchSessions,
    fetchMetadata,
    setSelectedAudioStream,
    terminateTranscode,
    terminateSession,
    fetchManagedUserTokens,
    getOwnerToken,
    fetchLibraries,
    fetchLibraryItems,
};
