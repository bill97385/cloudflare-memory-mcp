#!/bin/bash
# Installer for cloudflare-memory-mcp
# Usage: curl -sL https://raw.githubusercontent.com/bill97385/cloudflare-memory-mcp/main/install.sh | bash

set -e

SERVER_URL="https://memory-mcp-server.bill97385.workers.dev/mcp"

# Check if claude CLI exists
if ! command -v claude &> /dev/null; then
  echo "Error: claude CLI not found. Install Claude Code first."
  exit 1
fi

echo "Memory MCP Server Installer"
echo "==========================="
echo ""
read -rp "Enter your API Token: " TOKEN

if [ -z "$TOKEN" ]; then
  echo "Error: Token cannot be empty."
  exit 1
fi

# Add MCP server
claude mcp add --scope user --transport http memory-mcp \
  "$SERVER_URL" \
  --header "Authorization:Bearer $TOKEN"

echo ""
echo "Done! Restart Claude Code to activate."
echo "Available tools: memory_store, memory_search, memory_list, memory_get, memory_update, memory_delete"
