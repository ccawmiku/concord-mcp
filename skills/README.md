# On-Demand Concord Skills (Antigravity & Codex)

These two skills keep Concord **disabled by default** in every new conversation (no global lifecycle hooks, no persistent `concord-mcp` process, no always-on instructions), and activate Concord **on demand** only when you explicitly ask to enable or use Concord in the current conversation.

## Directory Layout

- `skills/antigravity/concord/` — On-demand skill + stdio bridge for Antigravity (`~/.gemini/config/skills/concord/`)
- `skills/codex/concord/` — On-demand skill + stdio bridge for Codex (`~/.codex/skills/concord/`)

## Installation

1. Disable global auto-start (if previously enabled):
   ```bash
   concord setup --no-global
   concord adapters uninstall
   ```
   (Verify `~/.gemini/config/hooks.json`, `~/.gemini/config/rules/concord.md`, `~/.gemini/config/mcp_config.json`, and `~/.codex/config.toml` no longer contain Concord auto-hooks or global MCP entries.)

2. Copy the skill folders into your local agent skill directories:
   - Antigravity: `skills/antigravity/concord` -> `~/.gemini/config/skills/concord`
   - Codex: `skills/codex/concord` -> `~/.codex/skills/concord`

3. Usage:
   - Normal conversations stay 100% clean with zero Concord overhead.
   - Say `"开 concord"` / `"启用 concord"` / `"use concord"` in any conversation when you want to collaborate across agents.
