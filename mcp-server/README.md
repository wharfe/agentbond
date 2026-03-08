# @agentbond/mcp-server

MCP (Model Context Protocol) server for [agentbond](https://github.com/wharfe/agentbond) — AI agent authorization and governance.

Exposes 9 tools for authorization token management, action evaluation with atomic budget consumption, and audit logging.

## Installation

### Claude Desktop / Claude Code

Add to your MCP client configuration (`claude_desktop_config.json` or `.mcp.json`):

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

### Other MCP Clients

Any MCP-compatible client can connect via stdio transport:

```bash
npx @agentbond/mcp-server
```

## Available Tools

### Token Management

| Tool | Description |
|---|---|
| `agentbond_issue_token` | Issue a new authorization token with scopes, budget, and expiry. Supports delegation chains via `parentTokenId`. |
| `agentbond_get_token` | Retrieve a token by ID. |
| `agentbond_revoke_token` | Permanently revoke a token. Child tokens are denied via cascade evaluation. |
| `agentbond_suspend_token` | Temporarily suspend a token. Can be reactivated later. |
| `agentbond_reactivate_token` | Reactivate a suspended token. Child tokens become usable again. |

### Action Evaluation

| Tool | Description |
|---|---|
| `agentbond_evaluate_action` | Evaluate an action against a token and consume budget atomically if allowed. Returns an `AuthorizationDecision`. |

### Audit Log

| Tool | Description |
|---|---|
| `agentbond_get_audit_log` | Query audit records with optional filters (layer, outcome, time range, limit). |
| `agentbond_get_audit_by_action` | Get audit records for a specific action ID. |
| `agentbond_get_audit_by_token` | Get audit records for a specific token ID. |

## Example Workflow

An AI agent using agentbond via MCP would typically:

1. **Issue a token** — A principal grants an agent permission to act within defined scopes and budget.

2. **Evaluate actions** — Before performing an action, the agent checks authorization and consumes budget atomically. The response tells the agent whether to proceed and why.

3. **Delegate** — The agent can issue child tokens to sub-agents with narrower scopes and smaller budgets.

4. **Audit** — All decisions (allowed and denied) are recorded and queryable.

### Delegation Chain Example

```
Human (principal)
  └─ issues token-A to Agent-1
       ├─ scope: api.stripe.com [read, write]
       ├─ budget: 10000 credits
       └─ Agent-1 issues token-B to Agent-2
            ├─ scope: api.stripe.com [read]  (narrower)
            ├─ budget: 2000 credits  (smaller)
            └─ If token-A is revoked, token-B is denied automatically
```

## Authorization Decision Codes

| Code | Meaning | Retryable |
|---|---|---|
| `ALLOWED` | Authorization granted | — |
| `TOKEN_NOT_FOUND` | Token does not exist | No |
| `TOKEN_EXPIRED` | Token has expired | No |
| `TOKEN_REVOKED` | Token has been revoked | No |
| `TOKEN_SUSPENDED` | Token is suspended | Yes |
| `SCOPE_MISMATCH` | Action outside authorized scope | No |
| `BUDGET_EXCEEDED` | Insufficient budget | Yes |
| `PARENT_TOKEN_INACTIVE` | Parent token is not active | Yes |
| `PARENT_SCOPE_EXCEEDED` | Action exceeds parent scope | No |
| `PARENT_BUDGET_EXCEEDED` | Budget exceeds parent remaining | No |

## Storage

This server uses in-memory storage. All tokens, ledger entries, and audit records are lost when the process exits. This is suitable for development, testing, and single-session use cases.

For persistent storage, use `@agentbond/auth` directly with custom `TokenStore`, `BudgetLedgerStore`, and `AuditRecordStore` implementations.

## License

MIT
