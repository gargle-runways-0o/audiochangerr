const logger = require('./logger');
const { loadConfig } = require('./config');
const plexClient = require('./plexClient');
const audioSelector = require('./audioSelector');

const processedMedia = new Set();

function findTranscodes(sessions) {
    return sessions.filter(session => session.TranscodeSession);
}

function cleanupProcessedMedia(sessions) {
    const currentMediaKeys = new Set(sessions.map(s => s.ratingKey));
    for (const processedKey of processedMedia) {
        if (!currentMediaKeys.has(processedKey)) {
            logger.debug(`Cleaning up stale media key: ${processedKey}`);
            processedMedia.delete(processedKey);
        }
    }
}

async function waitForSessionRestart(originalSession, expectedStreamId, maxWaitSeconds = 120) { // Increased timeout
    const maxAttempts = maxWaitSeconds / 2;
    logger.info(`Waiting for session restart: media ${originalSession.ratingKey} for up to ${maxWaitSeconds} seconds.`);

    for (let i = 0; i < maxAttempts; i++) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        logger.debug(`Attempt ${i + 1}/${maxAttempts} to find new session for media ${originalSession.ratingKey}`);
        const sessions = await plexClient.fetchSessions();
        
        const newSession = sessions.find(s => 
            String(s.ratingKey) === String(originalSession.ratingKey) && // Ensure type-safe comparison
            String(s.Player.machineIdentifier) === String(originalSession.Player.machineIdentifier) && // Ensure type-safe comparison
            String(s.sessionKey) !== String(originalSession.sessionKey) // Ensure type-safe comparison
        );

        if (newSession) {
            logger.info(`New session detected for media ${originalSession.ratingKey}`);
            logger.debug(`Full newSession object: ${JSON.stringify(newSession, null, 2)}`); // Log full session

            if (newSession.TranscodeSession) {
                logger.error(`Validation failed: New session is still transcoding. TranscodeSession details: ${JSON.stringify(newSession.TranscodeSession, null, 2)}`);
                return false;
            } else {
                logger.debug(`New session is NOT transcoding.`);
                const activeStream = newSession.Media[0].Part[0].Stream.find(s => s.streamType === 2 && s.selected);
                logger.debug(`Active stream in new session: ${JSON.stringify(activeStream)}`);

                if (activeStream && String(activeStream.id) === String(expectedStreamId)) {
                    logger.info(`Validation success: Direct play with expected stream ${expectedStreamId}`);
                    return true;
                } else {
                    logger.error(`Validation failed: Wrong stream. Active stream ID: ${activeStream?.id}, Expected stream ID: ${expectedStreamId}`);
                    logger.debug(`All streams in new session: ${JSON.stringify(newSession.Media[0].Part[0].Stream, null, 2)}`);
                    return false;
                }
            }
        } else {
            logger.debug(`New session not yet found for media ${originalSession.ratingKey}.`);
        }
    }
    logger.warn(`Timeout waiting for restart. Media ${originalSession.ratingKey}. No new session found or validated within ${maxWaitSeconds} seconds.`);
    return false;
}

async function main() {
    try {
        const config = loadConfig();
        logger.info('Config loaded.');
        logger.info(`Mode: ${config.dry_run ? 'Dry Run' : 'Live'}`);

        plexClient.init(config);

        setInterval(async () => {
            try {
                const sessions = await plexClient.fetchSessions();
                logger.info(`Active sessions: ${sessions.length}`);

                const transcodeSessions = findTranscodes(sessions);
                const newTranscodes = transcodeSessions.filter(s => !processedMedia.has(s.ratingKey));

                if (newTranscodes.length > 0) {
                    for (const session of newTranscodes) {
                        logger.info(`Transcode detected: ${session.Player.title} on ${session.Player.device} for user ${session.User.title}`);
                        
                        const mediaInfo = await plexClient.fetchMetadata(session.ratingKey);
                        if (!mediaInfo) continue;

                        const currentStream = session.Media[0].Part[0].Stream.find(s => s.streamType === 2 && s.selected);
                        if (!currentStream) {
                            logger.warn(`No current audio stream for ${session.Player.title}`);
                            continue;
                        }

                        const bestStream = audioSelector.selectBestAudioStream(mediaInfo, currentStream.id, config.audio_selector);
                        if (bestStream) {
                            logger.info(`Better stream: ${bestStream.codec.toUpperCase()} ${bestStream.channels}ch (ID: ${bestStream.id})`);
                            
                            // Defensive check for session.Media[0].Part[0]
                            if (!session.Media || !session.Media[0] || !session.Media[0].Part || !session.Media[0].Part[0]) {
                                logger.error(`Missing media part information for session ${session.sessionKey}. Full session object: ${JSON.stringify(session, null, 2)}`);
                                continue; // Skip this session if essential media info is missing
                            }
                            const partId = session.Media[0].Part[0].id;
                            let userTokenToUse = undefined; // This will be the token passed to setSelectedAudioStream
                            const sessionUsername = session.User.title;

                            // Fetch managed user tokens dynamically for this session
                            const managedUserTokens = await plexClient.fetchManagedUserTokens();

                            logger.debug(`Session User object: ${JSON.stringify(session.User, null, 2)}`);

                            if (sessionUsername === config.owner_username) {
                                userTokenToUse = config.plex_token;
                                logger.debug(`Session for owner (${sessionUsername}). Using owner's token.`);
                            } else if (managedUserTokens[session.User.id]) { // Use session.User.id for lookup
                                // This is a managed user whose token was fetched
                                userTokenToUse = managedUserTokens[session.User.id];
                                logger.debug(`Using dynamically fetched managed user token for user ID ${session.User.id}`);
                            } else {
                                // This user is neither the owner nor a dynamically fetched managed user
                                logger.warn(`User '${sessionUsername}' (ID: ${session.User.id}) is not the configured owner and not identified as a managed user. Skipping audio stream selection for this user.`);
                                continue; // Skip this session entirely
                            }
                            
                            try {
                                // 1. Set selected audio
                                await plexClient.setSelectedAudioStream(partId, bestStream.id, userTokenToUse, config.dry_run);

                                // 2. Kill transcode & terminate session
                                if (config.dry_run) {
                                    logger.info(`[DRY RUN] Would terminate transcode: ${session.TranscodeSession.key}`);
                                    logger.info(`[DRY RUN] Would terminate session: ${session.Session.id}`);
                                    processedMedia.add(session.ratingKey);
                                } else {
                                    await plexClient.terminateTranscode(session.TranscodeSession.key);
                                    logger.info(`Terminated transcode: ${session.TranscodeSession.key}`);
                                    
                                    const reason = 'Audio transcode detected. Switched to compatible audio track. Please restart movie.';
                                    await plexClient.terminateSession(session.Session.id, reason);
                                    logger.info(`Terminated session: ${session.Session.id}`);

                                    // 3. Wait for restart & validate
                                    const validated = await waitForSessionRestart(session, bestStream.id);
                                    if (validated) {
                                        processedMedia.add(session.ratingKey);
                                    } else {
                                        logger.error(`Validation failed for media ${session.ratingKey}. Will retry if transcode persists.`);
                                    }
                                }
                            } catch (error) {
                                logger.error(`Failed to fix transcode: ${error.message}`);
                            }
                        } else {
                            logger.warn(`No better stream for ${session.Player.title}`);
                        }
                    }
                }

                cleanupProcessedMedia(sessions);

            } catch (error) {
                logger.error(`Main loop error: ${error.message}`);
            }
        }, config.check_interval * 1000);

    } catch (error) {
        logger.error(`Failed to start: ${error.message}`);
        process.exit(1);
    }
}

main();
