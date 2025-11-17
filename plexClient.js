const axios = require('axios');
const logger = require('./logger');
const xml2js = require('xml2js'); // Added dependency

let plexApi;

function init(config) {
    plexApi = axios.create({
        baseURL: config.plex_server_url,
        headers: {
            'X-Plex-Token': config.plex_token,
            'Accept': 'application/json',
        },
        timeout: 600000,
    });
}

async function fetchSessions() {
    try {
        const response = await plexApi.get('/status/sessions');
        return response.data.MediaContainer.Metadata || [];
    } catch (error) {
        if (error.response) {
            logger.error(`Plex API request to /status/sessions failed: ${error.response.status} ${error.response.statusText}`);
        } else {
            logger.error(`Plex API request to /status/sessions failed: ${error.message}`);
        }
        return [];
    }
}

async function fetchMetadata(ratingKey) {
    try {
        const response = await plexApi.get(`/library/metadata/${ratingKey}`);
        return response.data.MediaContainer.Metadata[0];
    } catch (error) {
        if (error.response) {
            logger.error(`Plex API request to /library/metadata/${ratingKey} failed: ${error.response.status} ${error.response.statusText}`);
        } else {
            logger.error(`Plex API request to /library/metadata/${ratingKey} failed: ${error.message}`);
        }
        return null;
    }
}

async function setSelectedAudioStream(partId, streamId, userToken, dry_run) {
    const tokenStatus = userToken ? 'provided' : 'owner (default)'; // Clarified status
    if (dry_run) {
        logger.info(`[DRY RUN] Would set selected audio for part ${partId} to stream ${streamId} for user with token: ${tokenStatus}`);
        return;
    }

    // If userToken is not provided, it means main.js determined to use the owner's token
    // or it's an unmanaged user. The headers will be set accordingly.
    const headers = userToken ? { 'X-Plex-Token': userToken } : { 'X-Plex-Token': plexApi.defaults.headers['X-Plex-Token'] }; // Explicitly use owner's token if userToken is undefined

    try {
        const url = `/library/parts/${partId}`;
        const params = {
            allParts: 1,
            audioStreamID: streamId
        };
        logger.debug(`Plex API: PUT ${url} with params: ${JSON.stringify(params)} and headers using token: ${tokenStatus}`);
        const response = await plexApi.put(url, null, { params, headers });
        logger.debug(`Plex API response for setting audio stream: ${response.status} ${response.statusText}`);
        logger.info(`Set audio stream ${streamId} as selected for part ${partId} using token: ${tokenStatus}`);
    } catch (error) {
        logger.error(`Failed to set selected audio for part ${partId}: ${error.message}`);
        throw error;
    }
}

async function terminateTranscode(transcodeKey) {
    await plexApi.delete(transcodeKey);
}

async function terminateSession(sessionId, reason) {
    await plexApi.get('/status/sessions/terminate', {
        params: { sessionId, reason }
    });
}

// Utility to parse user details from XML
async function getUserDetailsFromXml(xml) {
    const parser = new xml2js.Parser();
    try {
        const result = await parser.parseStringPromise(xml);
        const sharedServers = result.MediaContainer.SharedServer || [];
        const extractedData = {};
        sharedServers.forEach((server) => {
            const userID = server.$.userID; // Extract userID
            const accessToken = server.$.accessToken;
            if (userID && accessToken) { // Use userID as key
                extractedData[userID] = accessToken;
            }
        });
        return extractedData;
    } catch (error) {
        logger.error(`Error parsing XML for user details: ${error.message}`);
        return {};
    }
}

async function fetchManagedUserTokens() {
    try {
        const plexTvApi = axios.create({
            baseURL: 'https://plex.tv',
            headers: {
                'X-Plex-Token': plexApi.defaults.headers['X-Plex-Token'], // Use the admin token from the main plexApi instance
                'Accept': 'application/xml', // Expect XML response from plex.tv
            },
            timeout: 600000,
        });

        // 1. Get clientIdentifier from /api/resources
        const resourcesResponse = await plexTvApi.get('/api/resources');
        const resourcesXml = resourcesResponse.data;
        const parser = new xml2js.Parser();
        const resourcesResult = await parser.parseStringPromise(resourcesXml);
        
        const server = resourcesResult.MediaContainer.Device.find(
            device => device.$.clientIdentifier && device.$.provides.includes('server')
        );

        if (!server || !server.$.clientIdentifier) {
            logger.error('Could not find Plex server clientIdentifier from /api/resources.');
            return {};
        }
        const clientIdentifier = server.$.clientIdentifier;

        // 2. Get shared server details from /api/servers/{clientIdentifier}/shared_servers
        const sharedServersResponse = await plexTvApi.get(`/api/servers/${clientIdentifier}/shared_servers`);
        const sharedServersXml = sharedServersResponse.data;
        const managedUserTokens = await getUserDetailsFromXml(sharedServersXml);
        
        logger.info(`Fetched ${Object.keys(managedUserTokens).length} managed user tokens.`);
        return managedUserTokens;

    } catch (error) {
        if (error.response) {
            logger.error(`Plex API request to fetch managed user tokens failed: ${error.response.status} ${error.response.statusText}`);
        } else {
            logger.error(`Plex API request to fetch managed user tokens failed: ${error.message}`);
        }
        return {};
    }
}

module.exports = {
    init,
    fetchSessions,
    fetchMetadata,
    setSelectedAudioStream,
    terminateTranscode,
    terminateSession,
    fetchManagedUserTokens, // Export the new function
};