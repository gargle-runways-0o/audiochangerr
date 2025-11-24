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
echo "Test Tautulli webhook format (Optional):"
echo ""

TAUTULLI_PAYLOAD='{
  "event_type": "play",
  "rating_key": "67890",
  "username": "TestUser",
  "player_uuid": "tautulli-player",
  "media_type": "movie",
  "title": "Tautulli Test"
}'

echo "Sending mock Tautulli webhook..."
TAUTULLI_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST http://localhost:4444/webhook \
  -H "Content-Type: application/json" \
  -d "$TAUTULLI_PAYLOAD" 2>&1)

TAUTULLI_HTTP_CODE=$(echo "$TAUTULLI_RESPONSE" | tail -n1)
TAUTULLI_BODY=$(echo "$TAUTULLI_RESPONSE" | head -n-1)

if [ "$TAUTULLI_HTTP_CODE" == "200" ]; then
    echo "✓ Tautulli webhook received"
    echo "Response: $TAUTULLI_BODY"
else
    echo "✗ Failed: HTTP $TAUTULLI_HTTP_CODE"
    echo "Response: $TAUTULLI_BODY"
fi

echo ""
echo "================================"
echo "Configuration Instructions:"
echo "================================"
echo ""
echo "Plex (requires Plex Pass):"
echo "  Plex Web → Account → Webhooks → Add"
echo "  URL: http://<server-ip>:4444/webhook"
echo ""
echo "Tautulli (no Plex Pass required):"
echo "  Tautulli → Settings → Notification Agents → Webhook"
echo "  URL: http://<server-ip>:4444/webhook"
echo "  See docs/WEBHOOK.md for payload configuration"
