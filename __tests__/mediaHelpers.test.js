const { getStreamsFromSession, getStreamsFromMetadata, getPartId } = require('../mediaHelpers');

describe('mediaHelpers', () => {
    describe('getStreamsFromSession', () => {
        it('should return streams from valid session', () => {
            const session = {
                sessionKey: '123',
                Media: [{
                    Part: [{
                        Stream: [
                            { id: 1, streamType: 2, codec: 'ac3' },
                            { id: 2, streamType: 2, codec: 'aac' }
                        ]
                    }]
                }]
            };

            const streams = getStreamsFromSession(session);
            expect(streams).toHaveLength(2);
            expect(streams[0].codec).toBe('ac3');
        });

        it('should throw error for missing Media', () => {
            const session = { sessionKey: '123' };
            expect(() => getStreamsFromSession(session)).toThrow('Invalid session structure');
        });

        it('should throw error for missing Part', () => {
            const session = {
                sessionKey: '123',
                Media: [{}]
            };
            expect(() => getStreamsFromSession(session)).toThrow('Invalid session structure');
        });

        it('should throw error for missing Stream', () => {
            const session = {
                sessionKey: '123',
                Media: [{
                    Part: [{}]
                }]
            };
            expect(() => getStreamsFromSession(session)).toThrow('Invalid session structure');
        });
    });

    describe('getStreamsFromMetadata', () => {
        it('should return streams from valid metadata', () => {
            const metadata = {
                ratingKey: '456',
                Media: [{
                    Part: [{
                        Stream: [
                            { id: 1, streamType: 2, codec: 'dts' }
                        ]
                    }]
                }]
            };

            const streams = getStreamsFromMetadata(metadata);
            expect(streams).toHaveLength(1);
            expect(streams[0].codec).toBe('dts');
        });

        it('should throw error for invalid metadata structure', () => {
            const metadata = { ratingKey: '456' };
            expect(() => getStreamsFromMetadata(metadata)).toThrow('Invalid metadata structure');
        });
    });

    describe('getPartId', () => {
        it('should return part ID from valid session', () => {
            const session = {
                sessionKey: '789',
                Media: [{
                    Part: [{
                        id: 12345,
                        Stream: []
                    }]
                }]
            };

            const partId = getPartId(session);
            expect(partId).toBe(12345);
        });

        it('should throw error for missing part ID', () => {
            const session = {
                sessionKey: '789',
                Media: [{
                    Part: [{}]
                }]
            };
            expect(() => getPartId(session)).toThrow('Invalid session structure: missing Part id');
        });

        it('should throw error for missing Media', () => {
            const session = { sessionKey: '789' };
            expect(() => getPartId(session)).toThrow('Invalid session structure: missing Part id');
        });
    });
});
