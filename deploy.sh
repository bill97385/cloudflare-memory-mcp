#!/bin/bash
# Automated deployment script for cloudflare-memory-mcp
# Usage: bash deploy.sh
set -e

echo "============================================"
echo "  Cloudflare Memory MCP Server — Deploy"
echo "============================================"
echo ""

# Check prerequisites
for cmd in wrangler node npm; do
  if ! command -v "$cmd" &> /dev/null; then
    echo "Error: '$cmd' not found. Please install it first."
    exit 1
  fi
done

# Check wrangler auth
if ! wrangler whoami &> /dev/null; then
  echo "Not logged in to Cloudflare. Running 'wrangler login'..."
  wrangler login
fi

echo ""
echo "[1/6] Creating D1 database..."
D1_OUTPUT=$(wrangler d1 create memory-mcp 2>&1) || {
  if echo "$D1_OUTPUT" | grep -q "already exists"; then
    echo "  Database 'memory-mcp' already exists, skipping."
    D1_OUTPUT=$(wrangler d1 list 2>&1)
  else
    echo "$D1_OUTPUT"
    exit 1
  fi
}
DB_ID=$(echo "$D1_OUTPUT" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
if [ -z "$DB_ID" ]; then
  echo "Error: Could not extract database ID."
  echo "$D1_OUTPUT"
  exit 1
fi
echo "  Database ID: $DB_ID"

echo ""
echo "[2/6] Creating Vectorize index..."
wrangler vectorize create memory-vectors --dimensions 768 --metric cosine 2>&1 || {
  echo "  Index may already exist, continuing..."
}

echo ""
echo "[3/6] Updating wrangler.toml..."
if grep -q "DATABASE_ID_PLACEHOLDER" wrangler.toml; then
  sed -i.bak "s/DATABASE_ID_PLACEHOLDER/$DB_ID/" wrangler.toml && rm -f wrangler.toml.bak
  echo "  Updated database_id to $DB_ID"
else
  # Update existing ID
  sed -i.bak "s/database_id = \"[^\"]*\"/database_id = \"$DB_ID\"/" wrangler.toml && rm -f wrangler.toml.bak
  echo "  Updated database_id to $DB_ID"
fi

echo ""
echo "[4/6] Running database migrations..."
npm run db:migrate 2>&1

echo ""
echo "[5/6] Deploying Worker..."
DEPLOY_OUTPUT=$(npm run deploy 2>&1)
echo "$DEPLOY_OUTPUT"
WORKER_URL=$(echo "$DEPLOY_OUTPUT" | grep -oE 'https://[^ ]+\.workers\.dev' | head -1)
if [ -z "$WORKER_URL" ]; then
  echo "Error: Could not extract Worker URL from deploy output."
  exit 1
fi
echo "  Worker URL: $WORKER_URL"

echo ""
echo "[6/6] Setting API token..."
TOKEN=$(openssl rand -hex 32)
echo "$TOKEN" | wrangler secret put API_TOKEN 2>&1

echo ""
echo "============================================"
echo "  Deployment Complete!"
echo "============================================"
echo ""
echo "Worker URL: $WORKER_URL"
echo "API Token:  $TOKEN"
echo ""
echo "Save your token somewhere safe — it cannot be retrieved later."
echo ""
echo "--- Connect Claude Code (run this on each computer) ---"
echo ""
echo "claude mcp add --scope user --transport http memory-mcp \\"
echo "  ${WORKER_URL}/mcp \\"
echo "  --header \"Authorization:Bearer ${TOKEN}\""
echo ""
echo "--- Connect claude.ai Web ---"
echo ""
echo "1. Go to claude.ai → Customize → Connectors"
echo "2. Click + → Add custom connector"
echo "3. URL: ${WORKER_URL}/s/${TOKEN}/sse"
echo "4. Authorize with your API token when prompted"
echo ""
