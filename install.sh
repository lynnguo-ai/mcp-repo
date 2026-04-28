#!/bin/bash
set -e

REPO="https://raw.githubusercontent.com/lynnguo-ai/mcp-repo/main"
CACHE="$HOME/.claude/plugins/cache/lynnguo-ai/nova-i18n/0.1.0"
PLUGINS_JSON="$HOME/.claude/plugins/installed_plugins.json"
SETTINGS_JSON="$HOME/.claude/settings.json"
NOW=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

echo "Installing nova-i18n plugin for Claude Code..."

# 1. Download plugin files
mkdir -p "$CACHE/skills/setup"
curl -sSL "$REPO/plugin.json"            -o "$CACHE/plugin.json"
curl -sSL "$REPO/.mcp.json"              -o "$CACHE/.mcp.json"
curl -sSL "$REPO/CLAUDE.md"              -o "$CACHE/CLAUDE.md"
curl -sSL "$REPO/skills/setup/SKILL.md"  -o "$CACHE/skills/setup/SKILL.md"
echo "  ✓ Plugin files downloaded"

# 2. Register in installed_plugins.json
python3 - <<PYEOF
import json, os
path = os.path.expanduser("$PLUGINS_JSON")
data = json.load(open(path)) if os.path.exists(path) else {"version": 2, "plugins": {}}
data.setdefault("plugins", {})["nova-i18n@lynnguo-ai"] = [{
    "scope": "user",
    "installPath": "$CACHE",
    "version": "0.1.0",
    "installedAt": "$NOW",
    "lastUpdated": "$NOW"
}]
json.dump(data, open(path, "w"), indent=2)
print("  ✓ Registered in installed_plugins.json")
PYEOF

# 3. Enable plugin in settings.json
python3 - <<PYEOF
import json, os
path = os.path.expanduser("$SETTINGS_JSON")
data = json.load(open(path)) if os.path.exists(path) else {}
data.setdefault("enabledPlugins", {})["nova-i18n@lynnguo-ai"] = True
json.dump(data, open(path, "w"), indent=2)
print("  ✓ Enabled in settings.json")
PYEOF

echo ""
echo "✅ Done! Restart Claude Code to activate the plugin."
echo "   Then run /setup in your project directory to configure i18n rules."
