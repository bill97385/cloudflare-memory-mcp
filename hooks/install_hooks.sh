#!/bin/bash
# Install Memory MCP hooks into Claude Code settings.
# Usage: bash install_hooks.sh [path-to-hooks-dir]
set -e

HOOKS_DIR="${1:-$(cd "$(dirname "$0")" && pwd)}"
SAVE_HOOK="$HOOKS_DIR/mempal_save_hook.sh"
PRECOMPACT_HOOK="$HOOKS_DIR/mempal_precompact_hook.sh"

if [ ! -f "$SAVE_HOOK" ] || [ ! -f "$PRECOMPACT_HOOK" ]; then
  echo "Error: hook scripts not found in $HOOKS_DIR"
  exit 1
fi

chmod +x "$SAVE_HOOK" "$PRECOMPACT_HOOK"

SETTINGS_DIR="$HOME/.claude"
SETTINGS_FILE="$SETTINGS_DIR/settings.json"
mkdir -p "$SETTINGS_DIR"

# Create or update settings.json
if [ -f "$SETTINGS_FILE" ]; then
  # Merge hooks into existing settings
  python3 -c "
import json, sys

with open('$SETTINGS_FILE') as f:
    settings = json.load(f)

settings.setdefault('hooks', {})
settings['hooks']['Stop'] = [{
    'matcher': '',
    'hooks': [{'type': 'command', 'command': '$SAVE_HOOK', 'timeout': 30}]
}]
settings['hooks']['PreCompact'] = [{
    'matcher': '',
    'hooks': [{'type': 'command', 'command': '$PRECOMPACT_HOOK', 'timeout': 30}]
}]

with open('$SETTINGS_FILE', 'w') as f:
    json.dump(settings, f, indent=2)
print('Updated ' + '$SETTINGS_FILE')
"
else
  cat > "$SETTINGS_FILE" << SETTINGS_EOF
{
  "hooks": {
    "Stop": [{
      "matcher": "",
      "hooks": [{"type": "command", "command": "$SAVE_HOOK", "timeout": 30}]
    }],
    "PreCompact": [{
      "matcher": "",
      "hooks": [{"type": "command", "command": "$PRECOMPACT_HOOK", "timeout": 30}]
    }]
  }
}
SETTINGS_EOF
  echo "Created $SETTINGS_FILE"
fi

mkdir -p "$HOME/.memory-mcp/hook_state"
echo "Hooks installed. Auto-save every 15 messages + emergency save before compaction."
