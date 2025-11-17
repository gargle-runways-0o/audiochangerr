#!/bin/bash
# Test Plex webhook endpoint

echo "Testing Webhook Endpoint"
echo "========================"
echo ""

# Check server
if ! curl -s http://localhost:4444/health > /dev/null 2>&1; then
    echo "ERROR: Server not running on port 4444"
    echo "Start: npm start (config.yaml mode: 'webhook')"
    exit 1
fi

echo "✓ Server running"
echo ""

# Mock Plex payload
PAYLOAD='{
  "event": "media.play",
  "user": true,
  "owner": true,
  "Account": {"id": 1, "title": "TestUser"},
  "Server": {"title": "TestServer", "uuid": "test-uuid"},
  "Player": {"local": true, "title": "Plex Web", "uuid": "player-uuid"},
  "Metadata": {
    "ratingKey": "12345",
    "type": "movie",
    "title": "Test Movie"
  }
}'

echo "Sending mock webhook (media.play)..."
echo ""

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST http://localhost:4444/webhook \
  -F "payload=$PAYLOAD" 2>&1)

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

if [ "$HTTP_CODE" == "200" ]; then
    echo "✓ Webhook received"
    echo "Response: $BODY"
    echo ""
    echo "Check logs for processing details"
else
    echo "✗ Failed: HTTP $HTTP_CODE"
    echo "Response: $BODY"
    exit 1
fi

echo ""
echo "Configure Plex:"
echo "Plex Web → Account → Webhooks → Add"
echo "URL: http://<server-ip>:4444/webhook"
