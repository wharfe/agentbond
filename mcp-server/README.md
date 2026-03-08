# @agentbond/mcp-server

MCP (Model Context Protocol) server for [agentbond](https://github.com/wharfe/agentbond) — AI agent authorization and governance.

## Installation

```bash
npm install @agentbond/mcp-server
```

## Usage with Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "agentbond": {
      "command": "npx",
      "args": ["@agentbond/mcp-server"]
    }
  }
}
```

## Available Tools

| Tool | Description |
|---|---|
| `agentbond_issue_token` | Issue a new authorization token |
| `agentbond_evaluate_action` | Evaluate an action and consume budget if allowed |
| `agentbond_revoke_token` | Permanently revoke a token |
| `agentbond_suspend_token` | Temporarily suspend a token |
| `agentbond_reactivate_token` | Reactivate a suspended token |
| `agentbond_get_token` | Retrieve a token by ID |
| `agentbond_get_audit_log` | Query audit records with filters |
| `agentbond_get_audit_by_action` | Get audit records for an action |
| `agentbond_get_audit_by_token` | Get audit records for a token |

## License

MIT
