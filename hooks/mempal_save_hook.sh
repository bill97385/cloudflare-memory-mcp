#!/bin/bash
# Memory MCP Save Hook for Claude Code
# Triggers auto-save every SAVE_INTERVAL human messages.
# Inspired by MemPalace's save hook mechanism.
#
# Install: add to .claude/settings.local.json under hooks.Stop

SAVE_INTERVAL="${MEMPAL_SAVE_INTERVAL:-15}"
STATE_DIR="${MEMPAL_STATE_DIR:-$HOME/.memory-mcp/hook_state}"
mkdir -p "$STATE_DIR"

# Read hook input from stdin
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('session_id','default'))" 2>/dev/null || echo "default")

STATE_FILE="$STATE_DIR/${SESSION_ID}_last_save"
FLAG_FILE="$STATE_DIR/${SESSION_ID}_hook_active"

# If the hook already fired and AI just finished saving, let it pass
if [ -f "$FLAG_FILE" ]; then
  rm -f "$FLAG_FILE"
  echo '{}'
  exit 0
fi

# Count human messages from transcript
TRANSCRIPT="$HOME/.claude/projects/.transcript.jsonl"
if [ ! -f "$TRANSCRIPT" ]; then
  # Try to find transcript from session
  TRANSCRIPT=$(find "$HOME/.claude" -name "*.jsonl" -newer "$STATE_DIR" 2>/dev/null | head -1)
fi

TOTAL_MSGS=0
if [ -f "$TRANSCRIPT" ]; then
  TOTAL_MSGS=$(python3 -c "
import json, sys
count = 0
for line in open('$TRANSCRIPT'):
    try:
        msg = json.loads(line)
        if msg.get('role') == 'user' and '<command-message>' not in msg.get('content',''):
            count += 1
    except: pass
print(count)
" 2>/dev/null || echo "0")
fi

# Get last save count
LAST_SAVE=0
if [ -f "$STATE_FILE" ]; then
  LAST_SAVE=$(cat "$STATE_FILE")
fi

SINCE_SAVE=$((TOTAL_MSGS - LAST_SAVE))

# Check if save threshold reached
if [ "$SINCE_SAVE" -ge "$SAVE_INTERVAL" ]; then
  # Set flag to prevent infinite loop on next Stop
  touch "$FLAG_FILE"
  # Update last save count
  echo "$TOTAL_MSGS" > "$STATE_FILE"

  cat <<'HOOK_JSON'
{
  "decision": "block",
  "reason": "AUTO-SAVE checkpoint (every 15 messages). Before continuing, save key information from this session to memory:\n\n1. Use memory_store to save important topics, decisions, discoveries, and code changes\n2. Organize into appropriate wings/rooms/halls\n3. Set importance (1-10) for critical items\n4. Use verbatim quotes where possible\n5. After saving, continue the conversation normally"
}
HOOK_JSON
else
  echo '{}'
fi
