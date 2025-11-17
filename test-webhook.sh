#!/bin/bash
# Test script for Plex webhook integration
# This simulates a Plex webhook POST request to test the endpoint

echo "Testing Audiochangerr Webhook Endpoint"
echo "======================================="
echo ""

# Check if server is running
if ! curl -s http://localhost:4444/health > /dev/null 2>&1; then
    echo "ERROR: Webhook server is not running on port 4444"
    echo "Start the server with: npm start"
    echo "(Make sure config.yaml has mode: 'webhook')"
    exit 1
fi

echo "✓ Server is running"
echo ""

# Sample Plex webhook payload (media.play event)
PAYLOAD='{
  "event": "media.play",
  "user": true,
  "owner": true,
  "Account": {
    "id": 1,
    "thumb": "https://plex.tv/users/test/avatar",
    "title": "TestUser"
  },
  "Server": {
    "title": "TestServer",
    "uuid": "test-server-uuid"
  },
  "Player": {
    "local": true,
    "publicAddress": "192.168.1.100",
    "title": "Plex Web (Chrome)",
    "uuid": "test-player-uuid"
  },
  "Metadata": {
    "librarySectionType": "movie",
    "ratingKey": "12345",
    "key": "/library/metadata/12345",
    "guid": "plex://movie/test",
    "type": "movie",
    "title": "Test Movie",
    "summary": "A test movie for webhook testing",
    "addedAt": 1000000000,
    "updatedAt": 1000000000
  }
}'

echo "Sending mock Plex webhook (media.play event)..."
echo ""

# Send webhook with multipart form data (like Plex does)
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST http://localhost:4444/webhook \
  -F "payload=$PAYLOAD" \
  2>&1)

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

if [ "$HTTP_CODE" == "200" ]; then
    echo "✓ Webhook received successfully!"
    echo "Response: $BODY"
    echo ""
    echo "Check the application logs to see webhook processing."
else
    echo "✗ Webhook failed with HTTP $HTTP_CODE"
    echo "Response: $BODY"
    exit 1
fi

echo ""
echo "Test completed successfully!"
echo ""
echo "Next steps:"
echo "1. Configure your Plex webhook URL: http://<your-server-ip>:4444/webhook"
echo "2. Navigate to: Plex Web App → Account (top right) → Webhooks"
echo "3. Add the webhook URL above"
echo "4. Start playing media in Plex to trigger real webhooks"
