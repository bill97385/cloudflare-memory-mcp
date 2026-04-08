#!/bin/bash
# Add an existing cloudflare-memory-mcp server to Claude Code on this computer.
# Usage: bash install.sh
set -e

if ! command -v claude &> /dev/null; then
  echo "Error: claude CLI not found. Install Claude Code first."
  exit 1
fi

echo "Memory MCP — Connect to existing server"
echo "========================================="
echo ""
read -rp "Worker URL (e.g. https://memory-mcp-server.xxx.workers.dev): " SERVER_URL
read -rp "API Token: " TOKEN

if [ -z "$SERVER_URL" ] || [ -z "$TOKEN" ]; then
  echo "Error: Both URL and token are required."
  exit 1
fi

# Strip trailing slash
SERVER_URL="${SERVER_URL%/}"

claude mcp add --scope user --transport http memory-mcp \
  "${SERVER_URL}/mcp" \
  --header "Authorization:Bearer ${TOKEN}"

echo ""
echo "Done! Restart Claude Code to activate."
echo "Available tools: memory_store, memory_search, memory_list, memory_get, memory_update, memory_delete"
