#!/bin/bash
# Memory MCP PreCompact Hook for Claude Code
# Emergency save before context compression.
# Inspired by MemPalace's precompact hook mechanism.
#
# Install: add to .claude/settings.local.json under hooks.PreCompact

STATE_DIR="${MEMPAL_STATE_DIR:-$HOME/.memory-mcp/hook_state}"
mkdir -p "$STATE_DIR"

# Log compaction event
echo "$(date -Iseconds) precompact triggered" >> "$STATE_DIR/hook.log"

cat <<'HOOK_JSON'
{
  "decision": "block",
  "reason": "EMERGENCY SAVE — Context compression imminent. Save ALL important information from this session to memory NOW:\n\n1. Use memory_store for each important topic, decision, discovery, or code change\n2. Be thorough — detailed context will be lost after compression\n3. Organize into wings/rooms/halls with appropriate importance levels\n4. Include specific details: file paths, line numbers, error messages, decisions made\n5. After saving, acknowledge completion so compression can proceed"
}
HOOK_JSON
