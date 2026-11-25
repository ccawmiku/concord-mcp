---
name: concord
description: On-demand Concord multi-agent coordination for Codex. Activate ONLY when the user explicitly asks to enable, open, or use Concord in the current conversation (e.g., "开 concord", "启用 concord", "用 concord 协作"). Keep Concord off by default in normal conversations.
---

# Concord On-Demand Coordination (Codex)

Use this skill **only** when the user explicitly asks to turn on or use Concord in the current conversation.
Do **not** install global adapters (`concord adapters install`) or enable global mode (`concord setup --global`), so future conversations stay off by default.

## 1. Choose & Keep One Session `agent_id`

Pick a stable `agent_id` for the current conversation and reuse it in every Concord call during this session:
- Generate one 8-hex id once (e.g. `node -e "console.log('codex:' + require('crypto').randomBytes(4).toString('hex'))"`) and keep using that exact `codex:<8-hex>` id for the rest of this conversation.

## 2. Activate Concord in This Conversation

Run these steps right after the user asks to enable Concord:

1. **Register presence & drain any queued messages**:
   ```bash
   concord -C "<repo_or_cwd>" inbox register --agent <agent_id> --provider codex
   concord -C "<repo_or_cwd>" inbox drain --agent <agent_id> --provider codex --format json
   ```
2. **Inspect current workspace state** using the bundled stdio bridge (`scripts/concord-call.mjs` next to this `SKILL.md`; pass JSON via stdin `-` so quoting works on both Windows PowerShell and POSIX shells):
   ```bash
   echo '{}' | node "<skill_dir>/scripts/concord-call.mjs" --agent <agent_id> --kind codex --repo "<repo_or_cwd>" inspect_work -
   ```
3. **Optional live inbox check / wait**:
   - Between steps (or before wrapping up), run `concord -C "<repo_or_cwd>" inbox drain --agent <agent_id> --provider codex --format json` to receive messages from peers.
   - When explicitly waiting for a peer response, run `concord -C "<repo_or_cwd>" inbox watch --agent <agent_id> --provider codex --once`.

## 3. Coordinate Work (On-Demand Workflow)

- **Before editing files**: Call `start_work` to claim the task and check for overlapping edits:
  ```bash
  '{"task_id":"TASK-1","title":"Short title","kind":"codex","expected_files":["path/to/file"]}' | node "<skill_dir>/scripts/concord-call.mjs" --agent <agent_id> --kind codex --repo "<repo_or_cwd>" start_work -
  ```
- **During work / messaging peers**:
  - Search/read context: `inspect_work` (`{"query":"..."}` or `{"task_id":"TASK-1"}`)
  - Record findings or prompt/reply to a peer: `update_work` (for `prompt`/`reply`, include a fresh `idempotency_key`)
  - Hand off or reassign: `transfer_work`
- **Before finishing**:
  - Drain inbox once more (`concord -C "<repo_or_cwd>" inbox drain --agent <agent_id> --provider codex --format json`).
  - Call `finish_work` with `task_id`, `expected_version`, `what_changed`, `changed_files`, and `tests_run`.

## 4. Keep Future Sessions Clean

- Never run `concord adapters install` or `concord setup --global`.
- Do not add `[mcp_servers.concord]` or `[[hooks.*]]` back into `~/.codex/config.toml`.
- If the user asks to stop Concord mid-conversation, call `finish_work` (or `transfer_work` `release`) for any active claim and stop checking the inbox.
